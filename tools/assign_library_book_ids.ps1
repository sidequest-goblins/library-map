[CmdletBinding()]
param(
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"


# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

$WorkbookPath = (
    "C:\Users\cjade\OneDrive\Shared Workbooks\MyLibrary\LIBRARY.xlsx"
)

$ListViewSheetName = "List View"

$BoundaryHeader = (
    "SYSTEM COLUMNS - AUTOMATION ONLY"
)

$BookIdHeader = "Book ID"

$ExpectedHeaders = @(
    "LGBTQ+",
    "ISBN",
    "Year",
    "Pages",
    "Title",
    "Series",
    "First",
    "Last",
    "Genre",
    "Subgenre",
    "Publisher",
    "Origin",
    "Bookcase",
    "Shelf",
    "Position",
    "SYSTEM COLUMNS - AUTOMATION ONLY",
    "Book ID",
    "Series Sort",
    "Volume Sort",
    "Last Sort",
    "First Sort"
)

$BookIdPattern = (
    "^book-[0-9a-f]{8}-" +
    "[0-9a-f]{4}-" +
    "[0-9a-f]{4}-" +
    "[0-9a-f]{4}-" +
    "[0-9a-f]{12}$"
)

$BackupDirectory = Join-Path `
    $PSScriptRoot `
    "book-id-backups"

$xlUp = -4162
$xlToLeft = -4159


# -----------------------------------------------------------------------------
# General helpers
# -----------------------------------------------------------------------------

function Release-ComObject {
    param(
        [object]$ComObject
    )

    if ($null -eq $ComObject) {
        return
    }

    try {
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject(
            $ComObject
        )
    }
    catch {
        # Cleanup should never replace the original error.
    }
}


function Get-ExpectedColumnNumber {
    param(
        [Parameter(Mandatory)]
        [string]$HeaderName
    )

    for (
        $index = 0;
        $index -lt $ExpectedHeaders.Count;
        $index += 1
    ) {
        if (
            $ExpectedHeaders[$index] -ceq
            $HeaderName
        ) {
            return $index + 1
        }
    }

    throw (
        "The expected header list does not contain " +
        "'$HeaderName'."
    )
}


function Convert-ToStableText {
    param(
        [object]$Value
    )

    if ($null -eq $Value) {
        return "<NULL>"
    }

    return [System.Convert]::ToString(
        $Value,
        [System.Globalization.CultureInfo]::InvariantCulture
    )
}

function Convert-ToCellText {
    param(
        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value) {
        return ""
    }

    return [System.Convert]::ToString(
        $Value,
        [System.Globalization.CultureInfo]::InvariantCulture
    )
}

function Get-RangeArrayValue {
    param(
        [Parameter(Mandatory)]
        [object]$Array,

        [Parameter(Mandatory)]
        [int]$RowNumber,

        [Parameter(Mandatory)]
        [int]$ColumnNumber
    )

    $rowIndex = (
        $Array.GetLowerBound(0) +
        $RowNumber -
        1
    )

    $columnIndex = (
        $Array.GetLowerBound(1) +
        $ColumnNumber -
        1
    )

    return $Array[
        $rowIndex,
        $columnIndex
    ]
}


function Get-RangeDigest {
    param(
        [Parameter(Mandatory)]
        [object]$FormulaArray,

        [Parameter(Mandatory)]
        [int]$RowCount,

        [Parameter(Mandatory)]
        [int]$ColumnCount,

        [int]$SkippedDataColumn = 0
    )

    $builder = New-Object System.Text.StringBuilder

    for (
        $rowNumber = 1;
        $rowNumber -le $RowCount;
        $rowNumber += 1
    ) {
        for (
            $columnNumber = 1;
            $columnNumber -le $ColumnCount;
            $columnNumber += 1
        ) {
            # Include the Book ID header in the protected snapshot,
            # but exclude Book ID data cells because those are the
            # only cells this script is allowed to change.
            if (
                $SkippedDataColumn -gt 0 -and
                $columnNumber -eq $SkippedDataColumn -and
                $rowNumber -ge 2
            ) {
                continue
            }

            $value = Get-RangeArrayValue `
                -Array $FormulaArray `
                -RowNumber $rowNumber `
                -ColumnNumber $columnNumber

            $stableText = Convert-ToStableText `
                -Value $value

            [void]$builder.Append(
                $rowNumber
            )

            [void]$builder.Append(
                [char]31
            )

            [void]$builder.Append(
                $columnNumber
            )

            [void]$builder.Append(
                [char]31
            )

            [void]$builder.Append(
                $stableText.Length
            )

            [void]$builder.Append(
                [char]31
            )

            [void]$builder.Append(
                $stableText
            )

            [void]$builder.Append(
                [char]30
            )
        }
    }

    $sha256 = (
        [System.Security.Cryptography.SHA256]::Create()
    )

    try {
        $bytes = (
            [System.Text.Encoding]::UTF8.GetBytes(
                $builder.ToString()
            )
        )

        $hashBytes = $sha256.ComputeHash(
            $bytes
        )

        return (
            [System.BitConverter]::ToString(
                $hashBytes
            )
        ).Replace(
            "-",
            ""
        ).ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}


function Get-NewBookId {
    return (
        "book-" +
        [System.Guid]::NewGuid().
            ToString("D").
            ToLowerInvariant()
    )
}


function Get-WorkbookLockPath {
    $workbookDirectory = Split-Path `
        -Parent `
        $WorkbookPath

    $workbookFilename = Split-Path `
        -Leaf `
        $WorkbookPath

    return Join-Path `
        $workbookDirectory `
        (
            '~$' +
            $workbookFilename
        )
}


function Assert-WorkbookIsAvailable {
    if (
        -not (
            Test-Path -LiteralPath $WorkbookPath
        )
    ) {
        throw (
            "Could not find the workbook:`n" +
            $WorkbookPath
        )
    }

    $lockPath = Get-WorkbookLockPath

    if (
        Test-Path -LiteralPath $lockPath
    ) {
        throw (
            "Excel appears to have LIBRARY.xlsx open.`n`n" +
            "Close the workbook completely before running " +
            "the Book ID tool.`n`n" +
            "Detected lock file:`n" +
            $lockPath
        )
    }
}


# -----------------------------------------------------------------------------
# Excel helpers
# -----------------------------------------------------------------------------

function Open-WorkbookContext {
    param(
        [Parameter(Mandatory)]
        [bool]$ReadOnly
    )

    $excel = $null
    $workbook = $null
    $sheet = $null

    try {
        $excel = New-Object `
            -ComObject Excel.Application

        $excel.Visible = $false
        $excel.DisplayAlerts = $false
        $excel.EnableEvents = $false
        $excel.ScreenUpdating = $false
        $excel.AskToUpdateLinks = $false

        # Force-disable any workbook automation during this operation.
        try {
            $excel.AutomationSecurity = 3
        }
        catch {
            # LIBRARY.xlsx is not macro-enabled, so failure to set
            # this optional property is not fatal.
        }

        $workbook = $excel.Workbooks.Open(
            $WorkbookPath,
            0,
            $ReadOnly
        )

        if (
            -not $ReadOnly -and
            $workbook.ReadOnly
        ) {
            throw (
                "Excel opened the workbook as read-only. " +
                "No Book IDs can be assigned safely."
            )
        }

        try {
            $sheet = $workbook.Worksheets.Item(
                $ListViewSheetName
            )
        }
        catch {
            throw (
                "Could not find the exact worksheet " +
                "'$ListViewSheetName'."
            )
        }

        return [PSCustomObject]@{
            Excel = $excel
            Workbook = $workbook
            Sheet = $sheet
        }
    }
    catch {
        if ($null -ne $workbook) {
            try {
                $workbook.Close($false)
            }
            catch {
            }
        }

        if ($null -ne $excel) {
            try {
                $excel.Quit()
            }
            catch {
            }
        }

        Release-ComObject -ComObject $sheet
        Release-ComObject -ComObject $workbook
        Release-ComObject -ComObject $excel

        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()

        throw
    }
}


function Close-WorkbookContext {
    param(
        [object]$Context
    )

    if ($null -eq $Context) {
        return
    }

    try {
        if ($null -ne $Context.Workbook) {
            $Context.Workbook.Close(
                $false
            )
        }
    }
    catch {
    }

    try {
        if ($null -ne $Context.Excel) {
            $Context.Excel.Quit()
        }
    }
    catch {
    }

    Release-ComObject `
        -ComObject $Context.Sheet

    Release-ComObject `
        -ComObject $Context.Workbook

    Release-ComObject `
        -ComObject $Context.Excel

    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}


# -----------------------------------------------------------------------------
# Workbook inspection
# -----------------------------------------------------------------------------

function Get-WorkbookInspection {
    param(
        [Parameter(Mandatory)]
        [object]$Sheet
    )

    $headerRange = $null
    $dataRange = $null

    try {
        $expectedColumnCount = (
            $ExpectedHeaders.Count
        )

        $titleColumn = (
            Get-ExpectedColumnNumber `
                -HeaderName "Title"
        )

        $boundaryColumn = (
            Get-ExpectedColumnNumber `
                -HeaderName $BoundaryHeader
        )

        $bookIdColumn = (
            Get-ExpectedColumnNumber `
                -HeaderName $BookIdHeader
        )

        if (
            $boundaryColumn -ge
            $bookIdColumn
        ) {
            throw (
                "The safety boundary must appear before " +
                "the Book ID column."
            )
        }

        # Read the exact expected header range directly.
        # Hidden columns are still accessible through Excel automation;
        # we do not use End(xlToLeft), because that navigation method
        # can stop at the last visible column.
        $lastHeaderColumn = $expectedColumnCount

        $headerRange = $Sheet.Range(
            $Sheet.Cells.Item(1, 1),
            $Sheet.Cells.Item(
                1,
                $expectedColumnCount
            )
        )

        $headerValues = (
            $headerRange.Value2
        )

        for (
            $columnNumber = 1;
            $columnNumber -le $expectedColumnCount;
            $columnNumber += 1
        ) {
            $actualHeader = (
                Convert-ToStableText (
                    Get-RangeArrayValue `
                        -Array $headerValues `
                        -RowNumber 1 `
                        -ColumnNumber $columnNumber
                )
            ).Trim()

            $expectedHeader = (
                $ExpectedHeaders[
                    $columnNumber - 1
                ]
            )

            if (
                $actualHeader -cne
                $expectedHeader
            ) {
                throw (
                    "List View header mismatch at column " +
                    "$columnNumber.`n`n" +
                    "Expected: '$expectedHeader'`n" +
                    "Found:    '$actualHeader'`n`n" +
                    "No workbook cells were changed."
                )
            }
        }

        $lastTitleRow = (
            $Sheet.Cells.Item(
                $Sheet.Rows.Count,
                $titleColumn
            ).End(
                $xlUp
            ).Row
        )

        $lastBookIdRow = (
            $Sheet.Cells.Item(
                $Sheet.Rows.Count,
                $bookIdColumn
            ).End(
                $xlUp
            ).Row
        )

        $lastDataRow = [Math]::Max(
            $lastTitleRow,
            $lastBookIdRow
        )

        $lastDataRow = [Math]::Max(
            $lastDataRow,
            2
        )

        $dataRange = $Sheet.Range(
            $Sheet.Cells.Item(1, 1),
            $Sheet.Cells.Item(
                $lastDataRow,
                $expectedColumnCount
            )
        )

        $values = $dataRange.Value2
        $formulas = $dataRange.Formula

        $missingRows = (
            [System.Collections.Generic.List[object]]::new()
        )

        $orphanIdRows = (
            [System.Collections.Generic.List[object]]::new()
        )

        $malformedIdRows = (
            [System.Collections.Generic.List[object]]::new()
        )

        $formulaIdRows = (
            [System.Collections.Generic.List[object]]::new()
        )

        $duplicateIdRows = (
            [System.Collections.Generic.List[object]]::new()
        )

        $idFirstRows = (
            [System.Collections.Generic.Dictionary[string, int]]::new(
                [System.StringComparer]::OrdinalIgnoreCase
            )
        )

        $bookCount = 0
        $existingIdCount = 0

        for (
            $sheetRow = 2;
            $sheetRow -le $lastDataRow;
            $sheetRow += 1
        ) {
            $title = (
                Convert-ToCellText (
                    Get-RangeArrayValue `
                        -Array $values `
                        -RowNumber $sheetRow `
                        -ColumnNumber $titleColumn
                )
            ).Trim()

            $bookId = (
                Convert-ToCellText (
                    Get-RangeArrayValue `
                        -Array $values `
                        -RowNumber $sheetRow `
                        -ColumnNumber $bookIdColumn
                )
            ).Trim()

            $bookIdFormula = (
                Convert-ToCellText (
                    Get-RangeArrayValue `
                        -Array $formulas `
                        -RowNumber $sheetRow `
                        -ColumnNumber $bookIdColumn
                )
            ).Trim()

            $hasTitle = (
                -not [string]::IsNullOrWhiteSpace(
                    $title
                )
            )

            $hasBookId = (
                -not [string]::IsNullOrWhiteSpace(
                    $bookId
                )
            )

            if (
                -not $hasTitle -and
                -not $hasBookId
            ) {
                continue
            }

            if (
                -not $hasTitle -and
                $hasBookId
            ) {
                $orphanIdRows.Add(
                    [PSCustomObject]@{
                        Row = $sheetRow
                        BookId = $bookId
                    }
                )

                continue
            }

            $bookCount += 1

            if (-not $hasBookId) {
                $missingRows.Add(
                    [PSCustomObject]@{
                        Row = $sheetRow
                        Title = $title
                    }
                )

                continue
            }

            $existingIdCount += 1

            if (
                $bookIdFormula.StartsWith(
                    "="
                )
            ) {
                $formulaIdRows.Add(
                    [PSCustomObject]@{
                        Row = $sheetRow
                        Title = $title
                        Formula = $bookIdFormula
                    }
                )

                continue
            }

            if (
                $bookId -cnotmatch
                $BookIdPattern
            ) {
                $malformedIdRows.Add(
                    [PSCustomObject]@{
                        Row = $sheetRow
                        Title = $title
                        BookId = $bookId
                    }
                )

                continue
            }

            if (
                $idFirstRows.ContainsKey(
                    $bookId
                )
            ) {
                $duplicateIdRows.Add(
                    [PSCustomObject]@{
                        BookId = $bookId
                        FirstRow = (
                            $idFirstRows[$bookId]
                        )
                        DuplicateRow = $sheetRow
                        Title = $title
                    }
                )
            }
            else {
                $idFirstRows.Add(
                    $bookId,
                    $sheetRow
                )
            }
        }

        $rowCount = $lastDataRow

        $fullDigest = Get-RangeDigest `
            -FormulaArray $formulas `
            -RowCount $rowCount `
            -ColumnCount $expectedColumnCount

        $protectedDigest = Get-RangeDigest `
            -FormulaArray $formulas `
            -RowCount $rowCount `
            -ColumnCount $expectedColumnCount `
            -SkippedDataColumn $bookIdColumn

        return [PSCustomObject]@{
            BookCount = $bookCount
            ExistingIdCount = $existingIdCount
            MissingRows = $missingRows
            OrphanIdRows = $orphanIdRows
            MalformedIdRows = $malformedIdRows
            FormulaIdRows = $formulaIdRows
            DuplicateIdRows = $duplicateIdRows
            BookIdColumn = $bookIdColumn
            LastDataRow = $lastDataRow
            FullDigest = $fullDigest
            ProtectedDigest = $protectedDigest
        }
    }
    finally {
        Release-ComObject `
            -ComObject $dataRange

        Release-ComObject `
            -ComObject $headerRange
    }
}


function Assert-InspectionHasNoFatalIssues {
    param(
        [Parameter(Mandatory)]
        [object]$Inspection
    )

    $hasFatalIssues = $false

    if (
        $Inspection.OrphanIdRows.Count -gt 0
    ) {
        $hasFatalIssues = $true

        Write-Host ""
        Write-Host (
            "Book IDs attached to blank Title rows:"
        ) -ForegroundColor Red

        $Inspection.OrphanIdRows |
            Format-Table -AutoSize
    }

    if (
        $Inspection.FormulaIdRows.Count -gt 0
    ) {
        $hasFatalIssues = $true

        Write-Host ""
        Write-Host (
            "Book ID cells containing formulas:"
        ) -ForegroundColor Red

        $Inspection.FormulaIdRows |
            Format-Table -AutoSize
    }

    if (
        $Inspection.MalformedIdRows.Count -gt 0
    ) {
        $hasFatalIssues = $true

        Write-Host ""
        Write-Host (
            "Malformed existing Book IDs:"
        ) -ForegroundColor Red

        $Inspection.MalformedIdRows |
            Format-Table -AutoSize
    }

    if (
        $Inspection.DuplicateIdRows.Count -gt 0
    ) {
        $hasFatalIssues = $true

        Write-Host ""
        Write-Host (
            "Duplicate existing Book IDs:"
        ) -ForegroundColor Red

        $Inspection.DuplicateIdRows |
            Format-Table -AutoSize
    }

    if ($hasFatalIssues) {
        throw (
            "Book ID safety checks failed. " +
            "No workbook cells were changed."
        )
    }
}


# -----------------------------------------------------------------------------
# Preview
# -----------------------------------------------------------------------------

Assert-WorkbookIsAvailable

Write-Host ""
Write-Host (
    "Inspecting List View Book IDs..."
) -ForegroundColor Cyan

$previewContext = $null
$preflight = $null

try {
    $previewContext = Open-WorkbookContext `
        -ReadOnly $true

    $preflight = Get-WorkbookInspection `
        -Sheet $previewContext.Sheet

    Assert-InspectionHasNoFatalIssues `
        -Inspection $preflight
}
finally {
    Close-WorkbookContext `
        -Context $previewContext
}

Write-Host ""
Write-Host (
    "BOOK ID PREFLIGHT"
) -ForegroundColor Cyan

Write-Host (
    "  Books with titles:  " +
    $preflight.BookCount
)

Write-Host (
    "  Existing Book IDs:  " +
    $preflight.ExistingIdCount
)

Write-Host (
    "  Blank Book IDs:     " +
    $preflight.MissingRows.Count
)

if (
    $preflight.MissingRows.Count -gt 0
) {
    Write-Host ""
    Write-Host (
        "First books that would receive IDs:"
    )

    $preflight.MissingRows |
        Select-Object `
            -First 20 `
            Row,
            Title |
        Format-Table -AutoSize

    $remainingPreviewCount = (
        $preflight.MissingRows.Count -
        20
    )

    if (
        $remainingPreviewCount -gt 0
    ) {
        Write-Host (
            "...and " +
            $remainingPreviewCount +
            " more."
        )
    }
}
else {
    Write-Host ""
    Write-Host (
        "Every titled row already has a valid Book ID."
    ) -ForegroundColor Green

    return
}

if (-not $Apply) {
    Write-Host ""
    Write-Host (
        "PREVIEW ONLY - no workbook cells were changed."
    ) -ForegroundColor Yellow

    Write-Host ""
    Write-Host (
        "After reviewing this output, apply IDs with:"
    )

    Write-Host (
        ".\tools\assign_library_book_ids.ps1 -Apply"
    ) -ForegroundColor Cyan

    return
}


# -----------------------------------------------------------------------------
# Explicit confirmation
# -----------------------------------------------------------------------------

Write-Host ""
Write-Host (
    "This will assign permanent random GUIDs to " +
    $preflight.MissingRows.Count +
    " blank Book ID cells."
) -ForegroundColor Yellow

Write-Host (
    "No row number, ISBN, title, author, or location " +
    "will be encoded in an ID."
)

$confirmation = Read-Host (
    "Type ASSIGN BOOK IDS to continue"
)

if (
    $confirmation -cne
    "ASSIGN BOOK IDS"
) {
    Write-Host ""
    Write-Host (
        "Cancelled. No workbook cells were changed."
    ) -ForegroundColor Yellow

    return
}


# -----------------------------------------------------------------------------
# Backup
# -----------------------------------------------------------------------------

Assert-WorkbookIsAvailable

New-Item `
    -ItemType Directory `
    -Path $BackupDirectory `
    -Force |
    Out-Null

$timestamp = Get-Date `
    -Format "yyyyMMdd-HHmmss"

$workbookBaseName = (
    [System.IO.Path]::GetFileNameWithoutExtension(
        $WorkbookPath
    )
)

$workbookExtension = (
    [System.IO.Path]::GetExtension(
        $WorkbookPath
    )
)

$backupFilename = (
    $workbookBaseName +
    "-before-book-id-" +
    $timestamp +
    $workbookExtension
)

$backupPath = Join-Path `
    $BackupDirectory `
    $backupFilename

Copy-Item `
    -LiteralPath $WorkbookPath `
    -Destination $backupPath `
    -ErrorAction Stop

Write-Host ""
Write-Host (
    "Backup created:"
) -ForegroundColor Green

Write-Host $backupPath


# -----------------------------------------------------------------------------
# Apply IDs
# -----------------------------------------------------------------------------

$writeContext = $null
$writeStarted = $false
$writeFailure = $null
$assignedCount = 0

try {
    Assert-WorkbookIsAvailable

    $writeContext = Open-WorkbookContext `
        -ReadOnly $false

    $beforeWrite = Get-WorkbookInspection `
        -Sheet $writeContext.Sheet

    Assert-InspectionHasNoFatalIssues `
        -Inspection $beforeWrite

    if (
        $beforeWrite.FullDigest -cne
        $preflight.FullDigest
    ) {
        throw (
            "The workbook changed between preview and write mode. " +
            "No IDs were assigned. Run the preview again."
        )
    }

    $newIds = (
        [System.Collections.Generic.HashSet[string]]::new(
            [System.StringComparer]::OrdinalIgnoreCase
        )
    )

    foreach (
        $missingRow in
        $beforeWrite.MissingRows
    ) {
        do {
            $newBookId = Get-NewBookId
        }
        while (
            -not $newIds.Add(
                $newBookId
            )
        )

        $bookIdCell = $null

        try {
            $bookIdCell = (
                $writeContext.Sheet.Cells.Item(
                    $missingRow.Row,
                    $beforeWrite.BookIdColumn
                )
            )

            $currentValue = (
                Convert-ToCellText (
                    $bookIdCell.Value2
                )
            ).Trim()

            if (
                -not [string]::IsNullOrWhiteSpace(
                    $currentValue
                )
            ) {
                throw (
                    "Book ID row " +
                    $missingRow.Row +
                    " stopped being blank before it could be written."
                )
            }

            # THIS IS THE ONLY WORKBOOK WRITE IN THE SCRIPT.
            #
            # It targets one blank cell in the exact Book ID column.
            # No other cell, row, column, formula, formatting, or
            # workbook structure is modified.
            $writeStarted = $true

            $bookIdCell.Value2 = (
                $newBookId
            )

            $assignedCount += 1
        }
        finally {
            Release-ComObject `
                -ComObject $bookIdCell
        }
    }

    $writeContext.Workbook.Save()

    $afterWrite = Get-WorkbookInspection `
        -Sheet $writeContext.Sheet

    Assert-InspectionHasNoFatalIssues `
        -Inspection $afterWrite

    if (
        $afterWrite.ProtectedDigest -cne
        $beforeWrite.ProtectedDigest
    ) {
        throw (
            "A non-Book ID cell changed during the save. " +
            "The backup will be restored automatically."
        )
    }

    if (
        $afterWrite.MissingRows.Count -ne 0
    ) {
        throw (
            "Some titled rows still have blank Book IDs after saving. " +
            "The backup will be restored automatically."
        )
    }

    $expectedFinalIdCount = (
        $beforeWrite.ExistingIdCount +
        $beforeWrite.MissingRows.Count
    )

    if (
        $afterWrite.ExistingIdCount -ne
        $expectedFinalIdCount
    ) {
        throw (
            "The final Book ID count was not what the tool expected. " +
            "The backup will be restored automatically."
        )
    }
}
catch {
    $writeFailure = $_
}
finally {
    Close-WorkbookContext `
        -Context $writeContext
}


# -----------------------------------------------------------------------------
# Reopen and verify persisted workbook
# -----------------------------------------------------------------------------

if ($null -eq $writeFailure) {
    $verifyContext = $null

    try {
        Start-Sleep `
            -Milliseconds 500

        Assert-WorkbookIsAvailable

        $verifyContext = Open-WorkbookContext `
            -ReadOnly $true

        $verification = Get-WorkbookInspection `
            -Sheet $verifyContext.Sheet

        Assert-InspectionHasNoFatalIssues `
            -Inspection $verification

        if (
            $verification.MissingRows.Count -ne 0
        ) {
            throw (
                "The workbook reopened with blank Book ID cells."
            )
        }

        if (
            $verification.ProtectedDigest -cne
            $preflight.ProtectedDigest
        ) {
            throw (
                "The reopened workbook contains a change outside " +
                "the Book ID data cells."
            )
        }

        $expectedFinalIdCount = (
            $preflight.ExistingIdCount +
            $preflight.MissingRows.Count
        )

        if (
            $verification.ExistingIdCount -ne
            $expectedFinalIdCount
        ) {
            throw (
                "The reopened workbook contains an unexpected " +
                "number of Book IDs."
            )
        }
    }
    catch {
        $writeFailure = $_
    }
    finally {
        Close-WorkbookContext `
            -Context $verifyContext
    }
}


# -----------------------------------------------------------------------------
# Automatic rollback on any write or verification failure
# -----------------------------------------------------------------------------

if ($null -ne $writeFailure) {
    if ($writeStarted) {
        Start-Sleep `
            -Milliseconds 500

        Copy-Item `
            -LiteralPath $backupPath `
            -Destination $WorkbookPath `
            -Force `
            -ErrorAction Stop

        Write-Host ""
        Write-Host (
            "The backup was restored automatically."
        ) -ForegroundColor Yellow
    }

    throw $writeFailure
}


Write-Host ""
Write-Host (
    "BOOK ID ASSIGNMENT COMPLETE"
) -ForegroundColor Green

Write-Host (
    "  IDs assigned: " +
    $assignedCount
)

Write-Host (
    "  Existing IDs preserved: " +
    $preflight.ExistingIdCount
)

Write-Host (
    "  Protected cells changed: 0"
)

Write-Host ""
Write-Host (
    "Backup retained at:"
)

Write-Host $backupPath