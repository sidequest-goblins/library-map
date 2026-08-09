[CmdletBinding()]
param(
    [switch]$NoPush
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$env:GIT_PAGER = "cat"
$env:PAGER = "cat"
$env:LESS = "FRX"


# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

$ProjectPath = (
    Split-Path -Parent $PSScriptRoot
)

$PythonPath = Join-Path `
    $ProjectPath `
    ".venv\Scripts\python.exe"

$BookIdScript = Join-Path `
    $PSScriptRoot `
    "assign_library_book_ids.ps1"

$InspectorScript = Join-Path `
    $PSScriptRoot `
    "inspect_library_workbook.py"

$LibraryBuildScript = Join-Path `
    $PSScriptRoot `
    "build_library_data.py"

$AuthorIdentityScript = Join-Path `
    $PSScriptRoot `
    "build_library_author_identities.py"

$AuthorWorkbookScript = Join-Path `
    $PSScriptRoot `
    "sync_library_authors_workbook.py"

$ChallengeScript = Join-Path `
    $PSScriptRoot `
    "build_challenges_data.py"


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

function Write-Step {
    param(
        [Parameter(Mandatory)]
        [string]$Message
    )

    Write-Host ""
    Write-Host (
        "============================================================"
    ) -ForegroundColor DarkCyan

    Write-Host $Message `
        -ForegroundColor Cyan

    Write-Host (
        "============================================================"
    ) -ForegroundColor DarkCyan
}

function Assert-LastExitCode {
    param(
        [Parameter(Mandatory)]
        [string]$StepName
    )

    if ($LASTEXITCODE -ne 0) {
        throw (
            "$StepName failed with exit code " +
            "$LASTEXITCODE."
        )
    }
}

function Get-PreviewCount {
    param(
        [Parameter(Mandatory)]
        [object[]]$Output,

        [Parameter(Mandatory)]
        [string]$Label
    )

    $pattern = (
        "^\s*" +
        [regex]::Escape($Label) +
        "\s*:\s*(\d+)\s*$"
    )

    foreach ($line in $Output) {
        $text = [string]$line

        if ($text -match $pattern) {
            return [int]$Matches[1]
        }
    }

    throw (
        "Could not find '$Label' in the " +
        "author identity preview."
    )
}

function Test-GitPathChanged {
    param(
        [Parameter(Mandatory)]
        [string[]]$Paths
    )

    & git diff --quiet -- @Paths

    return (
        $LASTEXITCODE -ne 0
    )
}

function Write-GitDiffCheckWarning {
    $previousErrorActionPreference = $ErrorActionPreference
    $nativePreferenceVariable = Get-Variable `
        -Name PSNativeCommandUseErrorActionPreference `
        -ErrorAction SilentlyContinue
    $previousNativeCommandPreference = $null

    if ($null -ne $nativePreferenceVariable) {
        $previousNativeCommandPreference = $nativePreferenceVariable.Value
    }

    try {
        $ErrorActionPreference = "Continue"

        if ($null -ne $nativePreferenceVariable) {
            Set-Variable `
                -Name PSNativeCommandUseErrorActionPreference `
                -Value $false `
                -Scope Local
        }

        $diffCheckOutput = @(
            & git `
                --no-pager `
                -c core.pager=cat `
                diff `
                --check `
                2>&1 |
                ForEach-Object {
                    if ($_ -is [System.Management.Automation.ErrorRecord]) {
                        [string]$_.Exception.Message
                    }
                    else {
                        [string]$_
                    }
                }
        )

        $diffCheckExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference

        if ($null -ne $nativePreferenceVariable) {
            Set-Variable `
                -Name PSNativeCommandUseErrorActionPreference `
                -Value $previousNativeCommandPreference `
                -Scope Local
        }
    }

    if ($diffCheckOutput.Count -gt 0) {
        $diffCheckOutput |
            ForEach-Object {
                Write-Host $_ `
                    -ForegroundColor Yellow
            }
    }

    if ($diffCheckExitCode -ne 0) {
        Write-Host ""
        Write-Host (
            "Diff check found whitespace warnings. " +
            "The update will continue."
        ) -ForegroundColor Yellow
    }
    else {
        Write-Host ""
        Write-Host (
            "Generated diff check passed."
        ) -ForegroundColor Green
    }
}


# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $ProjectPath)) {
    throw (
        "Could not find the MyLibrary project folder:`n" +
        $ProjectPath
    )
}

if (-not (Test-Path -LiteralPath $PythonPath)) {
    throw (
        "Could not find the Library virtual environment Python:`n" +
        $PythonPath
    )
}

$requiredFiles = @(
    $BookIdScript,
    $InspectorScript,
    $LibraryBuildScript,
    $AuthorIdentityScript,
    $AuthorWorkbookScript,
    $ChallengeScript
)

foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $requiredFile)) {
        throw (
            "Could not find required pipeline file:`n" +
            $requiredFile
        )
    }
}

Push-Location $ProjectPath

try {
    Write-Step "Checking Python dependencies"

$dependencyCheck = @'
import openpyxl
import PIL
import pythoncom
import win32com.client

print("Python dependencies: PASS")
'@

$dependencyCheck |
    & $PythonPath -

Assert-LastExitCode `
    -StepName "Python dependency check"


    # -------------------------------------------------------------------------
    # Assign permanent Book IDs
    # -------------------------------------------------------------------------

    Write-Step "Checking permanent Book IDs"

    & $BookIdScript -Apply

    Assert-LastExitCode `
        -StepName "Book ID assignment"


    # -------------------------------------------------------------------------
    # Validate split workbooks
    # -------------------------------------------------------------------------

    Write-Step "Inspecting Library workbooks"

    & $PythonPath $InspectorScript

    Assert-LastExitCode `
        -StepName "Workbook inspection"


    # -------------------------------------------------------------------------
    # Build core Library data and covers
    # -------------------------------------------------------------------------

    Write-Step "Building Library data and covers"

    & $PythonPath $LibraryBuildScript

    Assert-LastExitCode `
        -StepName "Library data build"


    # -------------------------------------------------------------------------
    # Preview author identities
    # -------------------------------------------------------------------------

    Write-Step "Reviewing permanent author identities"

    $authorPreview = @(
        & $PythonPath `
            $AuthorIdentityScript `
            2>&1 |
            ForEach-Object {
                [string]$_
            }
    )

    $authorPreview |
        ForEach-Object {
            Write-Host $_
        }

    if ($LASTEXITCODE -ne 0) {
        throw (
            "Author identity preview failed with exit code " +
            "$LASTEXITCODE."
        )
    }

    $newIdentityCount = Get-PreviewCount `
        -Output $authorPreview `
        -Label "New identities needed"

    $unbalancedAuthorCount = Get-PreviewCount `
        -Output $authorPreview `
        -Label "Mismatched populated First/Last rows"

    $missingAuthorCount = Get-PreviewCount `
        -Output $authorPreview `
        -Label "Books without an author"

    $orphanedIdentityCount = Get-PreviewCount `
        -Output $authorPreview `
        -Label "Registry identities no longer credited"

    if ($unbalancedAuthorCount -gt 0) {
        throw (
            "The author preview found mismatched populated " +
            "First/Last author rows. Fix those rows before updating."
        )
    }

    if ($missingAuthorCount -gt 0) {
        throw (
            "The author preview found books without an author. " +
            "Fix those rows before updating."
        )
    }

    if (
        $newIdentityCount -gt 0 -and
        $orphanedIdentityCount -gt 0
    ) {
        throw (
            "AUTHOR IDENTITY REVIEW REQUIRED.`n`n" +
            "The preview found both new author identities and " +
            "previous identities that are no longer credited.`n" +
            "This can indicate a corrected or misspelled author " +
            "name that must retain its permanent Author ID.`n`n" +
            "Review tools\library-author-identities.json before " +
            "running the update again."
        )
    }


    # -------------------------------------------------------------------------
    # Write author JSON
    # -------------------------------------------------------------------------

    Write-Step "Writing author identity data"

    & $PythonPath `
        $AuthorIdentityScript `
        --write

    Assert-LastExitCode `
        -StepName "Author identity write"


    Write-Step "Verifying author identity write"

    $authorVerification = @(
        & $PythonPath `
            $AuthorIdentityScript `
            2>&1 |
            ForEach-Object {
                [string]$_
            }
    )

    $authorVerification |
        ForEach-Object {
            Write-Host $_
        }

    if ($LASTEXITCODE -ne 0) {
        throw (
            "Author identity verification failed with exit code " +
            "$LASTEXITCODE."
        )
    }

    $remainingNewIdentities = Get-PreviewCount `
        -Output $authorVerification `
        -Label "New identities needed"

    if ($remainingNewIdentities -ne 0) {
        throw (
            "Author identity verification still reports " +
            "$remainingNewIdentities new identities."
        )
    }


    # -------------------------------------------------------------------------
    # Synchronize AUTHORS.xlsx only when author data changed
    # -------------------------------------------------------------------------

    $authorDataPaths = @(
        "tools/library-author-identities.json",
        "public/data/library-authors.json",
        "public/data/library-book-authors.json"
    )

    $authorDataChanged = Test-GitPathChanged `
        -Paths $authorDataPaths

    Write-Step "Previewing AUTHORS.xlsx synchronization"

    $authorWorkbookPreview = @(
        & $PythonPath `
            $AuthorWorkbookScript `
            2>&1 |
            ForEach-Object {
                [string]$_
            }
    )

    $authorWorkbookPreview |
        ForEach-Object {
            Write-Host $_
        }

    if ($LASTEXITCODE -ne 0) {
        throw (
            "AUTHORS.xlsx preview failed with exit code " +
            "$LASTEXITCODE."
        )
    }

    $newWorkbookRows = 0

    foreach ($line in $authorWorkbookPreview) {
        if (
            [string]$line -match
            "^\s*New rows to append:\s*(\d+)\s*$"
        ) {
            $newWorkbookRows = [int]$Matches[1]
            break
        }
    }

    if (
        $authorDataChanged -or
        $newWorkbookRows -gt 0
    ) {
        Write-Step "Synchronizing AUTHORS.xlsx"

        & $PythonPath `
            $AuthorWorkbookScript `
            --write

        Assert-LastExitCode `
            -StepName "AUTHORS.xlsx synchronization"
    }
    else {
        Write-Host ""
        Write-Host (
            "Author data did not change; AUTHORS.xlsx sync skipped."
        ) -ForegroundColor Green
    }


    # -------------------------------------------------------------------------
    # Validate and build challenges
    # -------------------------------------------------------------------------

    Write-Step "Validating challenge data"

    & $PythonPath `
        $ChallengeScript `
        --dry-run

    Assert-LastExitCode `
        -StepName "Challenge dry run"


    Write-Step "Writing challenge data"

    & $PythonPath $ChallengeScript

    Assert-LastExitCode `
        -StepName "Challenge data build"


    Write-Step "Verifying written challenge data"

    & $PythonPath `
        $ChallengeScript `
        --check

    Assert-LastExitCode `
        -StepName "Challenge data verification"


    # -------------------------------------------------------------------------
    # Build app and validate Git diff
    # -------------------------------------------------------------------------

    Write-Step "Building MyLibrary app"

    & npm run build

    Assert-LastExitCode `
        -StepName "MyLibrary app build"


    Write-Step "Checking generated diff"

    Write-GitDiffCheckWarning


    # -------------------------------------------------------------------------
    # Stage, commit, and optionally push
    # -------------------------------------------------------------------------

    Write-Step "Staging MyLibrary changes"

    & git add -A

    Assert-LastExitCode `
        -StepName "Git staging"

    & git diff --cached --quiet

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host (
            "MyLibrary is already up to date."
        ) -ForegroundColor Green

        return
    }

    $commitMessage = (
        "Update MyLibrary data " +
        (Get-Date -Format "yyyy-MM-dd HH:mm")
    )

    Write-Step "Committing MyLibrary update"

    & git commit -m $commitMessage

    Assert-LastExitCode `
        -StepName "Git commit"

    if ($NoPush) {
        Write-Host ""
        Write-Host (
            "Update committed locally. Push was skipped."
        ) -ForegroundColor Yellow

        return
    }

    Write-Step "Pushing MyLibrary update"

    & git push

    Assert-LastExitCode `
        -StepName "Git push"


    Write-Host ""
    Write-Host (
        "============================================================"
    ) -ForegroundColor Green

    Write-Host ""
    Write-Host (
        "          ✅  MYLIBRARY UPDATE WAS SENT!  ✅"
    ) -ForegroundColor Green

    Write-Host ""
    Write-Host (
        "       Please wait about 2 minutes for GitHub"
    ) -ForegroundColor Yellow

    Write-Host (
        "         before refreshing the library app."
    ) -ForegroundColor Yellow

    Write-Host ""
    Write-Host (
        "============================================================"
    ) -ForegroundColor Green

    Write-Host ""
}
catch {
    Write-Host ""
    Write-Host (
        "============================================================"
    ) -ForegroundColor Red

    Write-Host ""
    Write-Host (
        "MYLIBRARY UPDATE STOPPED SAFELY."
    ) -ForegroundColor Red

    Write-Host ""
    Write-Host $_.Exception.Message `
        -ForegroundColor Yellow

    Write-Host ""
    Write-Host (
        "Nothing after the failed step was committed or pushed."
    ) -ForegroundColor DarkGray

    Write-Host ""
    Write-Host (
        "============================================================"
    ) -ForegroundColor Red

    Write-Host ""

    exit 1
}
finally {
    Pop-Location
}
