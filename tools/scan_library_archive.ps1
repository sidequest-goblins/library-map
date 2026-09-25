[CmdletBinding()]
param(
    [string]$OutputPath = 'C:\library_app\Archive Review\ARCHIVE.xlsx',
    [string[]]$HistoryDirectory = @()
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$work = Join-Path (Split-Path -Parent $project) '.archive-recovery'
$runtime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime'
$node = Join-Path $runtime 'dependencies\node\bin\node.exe'
$modules = Join-Path $runtime 'dependencies\node\node_modules'
$marker = Join-Path $runtime 'plugins\openai-primary-runtime\plugins\spreadsheets\skills\spreadsheets\container_tools\mark_artifact_operation_started.mjs'
if (Test-Path -LiteralPath $OutputPath) {
    throw 'ARCHIVE.xlsx already exists. Choose -OutputPath with a new filename to preserve your review notes.'
}
foreach ($required in @($node, $modules, $marker)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Spreadsheet runtime unavailable: $required" }
}
New-Item -ItemType Directory -Path $work -Force | Out-Null
$junction = Join-Path $work 'node_modules'
if (-not (Test-Path -LiteralPath $junction)) {
    New-Item -ItemType Junction -Path $junction -Target $modules | Out-Null
}
$scanPath = Join-Path $work 'scan.json'
$pythonArgs = @((Join-Path $PSScriptRoot 'scan_library_archive.py'), '--output', $scanPath)
foreach ($folder in $HistoryDirectory) { $pythonArgs += @('--history-dir', $folder) }
& (Join-Path $project '.venv\Scripts\python.exe') @pythonArgs
if ($LASTEXITCODE -ne 0) { throw 'Archive scan failed; no archive workbook was written.' }
$builder = Join-Path $work 'build_archive_workbook.mjs'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build_archive_workbook.mjs') -Destination $builder -Force
& $node $marker --operation-kind create --expected-output-count 1 --output-format xlsx
if ($LASTEXITCODE -ne 0) { throw 'Spreadsheet preparation failed.' }
& $node $builder $scanPath $OutputPath (Join-Path $work 'previews')
if ($LASTEXITCODE -ne 0) { throw 'Archive workbook generation or preview failed.' }
Write-Host "Archive review workbook: $OutputPath"
Write-Host 'Source files and the app archive were not changed. No covers were copied.'
