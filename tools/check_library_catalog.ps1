[CmdletBinding()]
param([switch]$OpenReport)

$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectPath '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "Project Python was not found at $pythonPath. Use the same environment as update_mylibrary.ps1."
}
& $pythonPath (Join-Path $PSScriptRoot 'check_library_catalog.py')
if ($LASTEXITCODE -ne 0) { throw 'Catalog check failed. See the error above.' }
if ($OpenReport) {
    Invoke-Item -LiteralPath 'C:\Users\cjade\OneDrive\Shared Workbooks\MyLibrary\MISSING FROM CATALOG.txt'
}
