# One-time correction confirmed by the owner: this is the original physical copy.
# Only the accidentally assigned replacement ID triggers this repair. Once that
# ID is gone, future deliberate archiving of the original copy is unaffected.
[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$TargetWorkbookPath,
    [string]$TargetArchivePath
)

$applyRepair = $Apply
. (Join-Path $PSScriptRoot 'assign_library_book_ids.ps1') -LibraryOnly
if ($TargetWorkbookPath) { $WorkbookPath = $TargetWorkbookPath }

$replacementId = 'book-946fe828-89cf-40f4-9abb-5afa36c5122c'
$originalId = 'book-aec4b94c-3cfa-44a2-a98b-6a89ed399d78'
$expectedTitle = 'The Absolutely True Diary of a Part-Time Indian'
$expectedIsbn = '9780316013697'
$archivePath = Join-Path $PSScriptRoot '..\public\data\library-archive.json'
if ($TargetArchivePath) { $archivePath = $TargetArchivePath }
$context = $null
$backupPath = $null
$archiveBackupPath = $null
$repairFailure = $null
$writeStarted = $false
$json = ''
$archiveTempPath = $null

try {
    Assert-WorkbookIsAvailable
    $context = Open-WorkbookContext -ReadOnly (-not $applyRepair)
    $before = Get-WorkbookInspection -Sheet $context.Sheet
    Assert-InspectionHasNoFatalIssues -Inspection $before
    $idColumn = Get-ExpectedColumnNumber -HeaderName 'Book ID'
    $titleColumn = Get-ExpectedColumnNumber -HeaderName 'Title'
    $isbnColumn = Get-ExpectedColumnNumber -HeaderName 'ISBN'
    $lastRow = $context.Sheet.Cells.Item($context.Sheet.Rows.Count, $idColumn).End(-4162).Row
    $targetRow = 0
    $originalPresent = $false
    for ($row = 2; $row -le $lastRow; $row++) {
        $id = [string]$context.Sheet.Cells.Item($row, $idColumn).Value2
        if ($id -ceq $originalId) { $originalPresent = $true }
        if ($id -ceq $replacementId) { $targetRow = $row }
    }
    if ($targetRow -eq 0) {
        Write-Host 'No pending original-copy ID repair.'
        return
    }
    if ($originalPresent) { throw 'Original Book ID is already assigned to another active row.' }
    if (
        ([string]$context.Sheet.Cells.Item($targetRow, $titleColumn).Value2 -cne $expectedTitle) -or
        ([string]$context.Sheet.Cells.Item($targetRow, $isbnColumn).Value2 -cne $expectedIsbn)
    ) { throw 'Original-copy repair title/ISBN no longer matches. Review before updating.' }

    $archiveText = [System.IO.File]::ReadAllText($archivePath)
    # Evaluate first, then wrap: PS 5.1 otherwise nests the whole JSON array
    # as one pipeline result (unlike PS 7).
    $archive = @(($archiveText | ConvertFrom-Json))
    $matches = @($archive | Where-Object { $_.bookId -ceq $originalId })
    if (
        $matches.Count -ne 1 -or
        $matches[0].title -cne $expectedTitle -or
        $matches[0].isbn -cne $expectedIsbn
    ) { throw 'Expected original archive record was not found uniquely. Review before updating.' }

    Write-Host "Restore original Book ID at List View row $targetRow and remove its premature archive entry."
    if (-not $applyRepair) {
        Write-Host 'PREVIEW ONLY - no files changed.'
        return
    }

    $backupDirectory = Join-Path $PSScriptRoot 'book-id-backups'
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backupPath = Join-Path $backupDirectory "LIBRARY LIST VIEW-before-original-copy-repair-$stamp.xlsx"
    $archiveBackupPath = Join-Path $backupDirectory "library-archive-before-original-copy-repair-$stamp.json"
    Copy-Item -LiteralPath $WorkbookPath -Destination $backupPath -ErrorAction Stop
    Copy-Item -LiteralPath $archivePath -Destination $archiveBackupPath -ErrorAction Stop
    $writeStarted = $true
    $context.Sheet.Cells.Item($targetRow, $idColumn).Value2 = $originalId
    $context.Workbook.Save()
    Close-WorkbookContext -Context $context
    $context = $null

    $context = Open-WorkbookContext -ReadOnly $true
    $after = Get-WorkbookInspection -Sheet $context.Sheet
    Assert-InspectionHasNoFatalIssues -Inspection $after
    if (
        $after.ProtectedDigest -cne $before.ProtectedDigest -or
        $after.ExistingIdCount -ne $before.ExistingIdCount -or
        ([string]$context.Sheet.Cells.Item($targetRow, $idColumn).Value2 -cne $originalId)
    ) { throw 'Original-copy repair verification failed.' }

    if ([System.IO.File]::ReadAllText($archivePath) -cne $archiveText) {
        throw 'Archive changed during repair; refusing to overwrite it.'
    }
    $remaining = @($archive | Where-Object { $_.bookId -cne $originalId })
    $json = ConvertTo-Json -InputObject $remaining -Depth 100
    $archiveTempPath = "$archivePath.$([guid]::NewGuid()).tmp"
    [System.IO.File]::WriteAllText($archiveTempPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::Replace($archiveTempPath, $archivePath, [NullString]::Value)
    $saved = @(([System.IO.File]::ReadAllText($archivePath) | ConvertFrom-Json))
    if ($saved.Count -ne ($archive.Count - 1) -or @($saved | Where-Object { $_.bookId -ceq $originalId }).Count -ne 0) {
        throw 'Archive repair verification failed.'
    }
    Write-Host "Original copy restored. Workbook backup: $backupPath"
    Write-Host "Archive backup: $archiveBackupPath"
}
catch { $repairFailure = $_ }
finally {
    Close-WorkbookContext -Context $context
    if ($archiveTempPath -and (Test-Path -LiteralPath $archiveTempPath)) {
        Remove-Item -LiteralPath $archiveTempPath
    }
}

if ($null -ne $repairFailure) {
    if ($writeStarted) {
        Copy-Item -LiteralPath $backupPath -Destination $WorkbookPath -Force -ErrorAction Stop
        # Do not overwrite another editor's archive changes on rollback.
        if ([System.IO.File]::ReadAllText($archivePath) -ceq ($json + "`n")) {
            Copy-Item -LiteralPath $archiveBackupPath -Destination $archivePath -Force -ErrorAction Stop
        }
    }
    throw $repairFailure
}
