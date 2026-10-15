# One-time correction confirmed by the owner: this is the original physical copy.
# Only the accidentally assigned replacement ID triggers this repair. Once that
# ID is gone, future deliberate archiving of the original copy is unaffected.
[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$TargetWorkbookPath,
    [string]$TargetArchivePath,
    [string]$ReplacementId = 'book-946fe828-89cf-40f4-9abb-5afa36c5122c',
    [string]$OriginalId = 'book-aec4b94c-3cfa-44a2-a98b-6a89ed399d78',
    [string]$ExpectedTitle = 'The Absolutely True Diary of a Part-Time Indian',
    [string]$ExpectedIsbn = '9780316013697'
)

$applyRepair = $Apply
. (Join-Path $PSScriptRoot 'assign_library_book_ids.ps1') -LibraryOnly
if ($TargetWorkbookPath) { $WorkbookPath = $TargetWorkbookPath }

# Explicit identity arguments support other owner-confirmed returned originals.
# Defaults preserve the existing pipeline's one-time correction.
$archivePath = Join-Path $PSScriptRoot '..\public\data\library-archive.json'
if ($TargetArchivePath) { $archivePath = $TargetArchivePath }
$context = $null
$backupPath = $null
$archiveBackupPath = $null
$repairFailure = $null
$writeStarted = $false
$json = ''
$archiveTempPath = $null
$sourceWorkbookPath = $WorkbookPath
$workingPath = $null
$publishedHash = $null

try {
    Assert-WorkbookIsAvailable
    $inspectedWorkbookHash = (Get-FileHash -LiteralPath $WorkbookPath -Algorithm SHA256).Hash
    if ($applyRepair) {
        $workingDirectory = Join-Path $PSScriptRoot 'book-id-backups'
        New-Item -ItemType Directory -Path $workingDirectory -Force | Out-Null
        $workingPath = Join-Path $workingDirectory "return-working-$([guid]::NewGuid()).xlsx"
        Copy-Item -LiteralPath $sourceWorkbookPath -Destination $workingPath -ErrorAction Stop
        if ((Get-FileHash -LiteralPath $workingPath -Algorithm SHA256).Hash -cne $inspectedWorkbookHash) {
            throw 'Workbook changed while making the repair snapshot; no repair applied.'
        }
        $WorkbookPath = $workingPath
    }
    # The updater calls Apply only after an explicit original-copy confirmation.
    # Open once in the required mode; avoid a read-only-to-write Excel handoff.
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

    if ((Get-FileHash -LiteralPath $sourceWorkbookPath -Algorithm SHA256).Hash -cne $inspectedWorkbookHash) {
        throw 'Workbook changed since repair inspection; refusing to apply the repair. Run again to inspect the latest copy.'
    }
    if (
        ([string]$context.Sheet.Cells.Item($targetRow, $idColumn).Value2 -cne $replacementId) -or
        ([string]$context.Sheet.Cells.Item($targetRow, $titleColumn).Value2 -cne $expectedTitle) -or
        ([string]$context.Sheet.Cells.Item($targetRow, $isbnColumn).Value2 -cne $expectedIsbn)
    ) { throw 'Repair target changed after inspection; no workbook cells were changed.' }
    if ([System.IO.File]::ReadAllText($archivePath) -cne $archiveText) {
        throw 'Archive changed since repair inspection; refusing to apply the repair.'
    }

    $backupDirectory = Join-Path $PSScriptRoot 'book-id-backups'
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backupPath = Join-Path $backupDirectory "LIBRARY LIST VIEW-before-original-copy-repair-$stamp.xlsx"
    $archiveBackupPath = Join-Path $backupDirectory "library-archive-before-original-copy-repair-$stamp.json"
    Copy-Item -LiteralPath $sourceWorkbookPath -Destination $backupPath -ErrorAction Stop
    Copy-Item -LiteralPath $archivePath -Destination $archiveBackupPath -ErrorAction Stop
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

    Close-WorkbookContext -Context $context
    $context = $null
    $WorkbookPath = $sourceWorkbookPath
    Assert-WorkbookIsAvailable
    if ((Get-FileHash -LiteralPath $sourceWorkbookPath -Algorithm SHA256).Hash -cne $inspectedWorkbookHash) {
        throw 'Shared workbook changed during repair; verified working copy was not published.'
    }

    if ([System.IO.File]::ReadAllText($archivePath) -cne $archiveText) {
        throw 'Archive changed during repair; refusing to overwrite it.'
    }
    $publishedHash = (Get-FileHash -LiteralPath $workingPath -Algorithm SHA256).Hash
    # Preserve the OneDrive file identity. Replacing a cloud placeholder can fail
    # even after its Excel lock is released. Check and write under one exclusive
    # handle so another local editor cannot change it between those operations.
    $verifiedBytes = [System.IO.File]::ReadAllBytes($workingPath)
    $sourceStream = [System.IO.File]::Open($sourceWorkbookPath,
        [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None)
    try {
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        try {
            $lockedHash = [BitConverter]::ToString($hasher.ComputeHash($sourceStream)).Replace('-', '')
        } finally { $hasher.Dispose() }
        if ($lockedHash -cne $inspectedWorkbookHash) {
            throw 'Shared workbook changed before exclusive write; no repair published.'
        }
        $sourceStream.Position = 0
        $writeStarted = $true
        try {
            $sourceStream.Write($verifiedBytes, 0, $verifiedBytes.Length)
            $sourceStream.SetLength($verifiedBytes.Length)
            $sourceStream.Flush($true)
        }
        catch {
            # Roll back a partial write while we still own the exclusive handle.
            $originalBytes = [System.IO.File]::ReadAllBytes($backupPath)
            $sourceStream.Position = 0
            $sourceStream.Write($originalBytes, 0, $originalBytes.Length)
            $sourceStream.SetLength($originalBytes.Length)
            $sourceStream.Flush($true)
            $writeStarted = $false
            throw
        }
    } finally { $sourceStream.Dispose() }
    if ((Get-FileHash -LiteralPath $sourceWorkbookPath -Algorithm SHA256).Hash -cne $publishedHash) {
        throw 'Published workbook differs from the verified repair copy; review sync state.'
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
    if ($workingPath -and (Test-Path -LiteralPath $workingPath)) {
        Remove-Item -LiteralPath $workingPath
    }
    $WorkbookPath = $sourceWorkbookPath
}

if ($null -ne $repairFailure) {
    if ($writeStarted) {
        if ((Get-FileHash -LiteralPath $sourceWorkbookPath -Algorithm SHA256).Hash -ceq $publishedHash) {
            Copy-Item -LiteralPath $backupPath -Destination $sourceWorkbookPath -Force -ErrorAction Stop
        }
        else {
            Write-Warning "Shared workbook changed after publishing; not overwriting it. Backup: $backupPath"
        }
        # Do not overwrite another editor's archive changes on rollback.
        if ([System.IO.File]::ReadAllText($archivePath) -ceq ($json + "`n")) {
            Copy-Item -LiteralPath $archiveBackupPath -Destination $archivePath -Force -ErrorAction Stop
        }
    }
    throw $repairFailure
}
