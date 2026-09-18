# ============================================================
#  Word Template Filler - build portable .exe
# ============================================================
#
#  Usage (from project root):
#
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-exe.ps1
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-exe.ps1 -Clean
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-exe.ps1 -KillRunning
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-exe.ps1 -OutputDir release-test
#
#  Steps:
#    1. pick a Node.js runtime that is new enough (>= 22.12.0)
#    2. make sure the app is not running (it would lock the .exe)
#    3. npm run build        -> dist/            (Vite, renderer)
#    4. electron-builder     -> release/*.exe    (app.asar + native module)
#    5. verify the build output
#
#  Why step 1 exists:
#    electron-builder uses require() on an ES module (@noble/hashes).
#    That only works on Node 22.12+ (or 20.19+). If the node in PATH is
#    older, Vite warns and electron-builder fails with ERR_REQUIRE_ESM.
#    So this script looks for a newer Node installed on the machine.
#
#  Note: this file is intentionally ASCII-only, because Windows
#        PowerShell 5.1 reads .ps1 files with the ANSI code page.
# ============================================================

[CmdletBinding()]
param(
    [switch]$Clean,                 # remove dist/ and the output folder first
    [switch]$SkipVite,              # reuse existing dist/, only run electron-builder
    [switch]$KillRunning,           # close a running app instance automatically
    [string]$OutputDir = "release"  # where the .exe is written
)

$ErrorActionPreference = "Stop"

# any unexpected terminating error -> short message instead of a stack trace
trap {
    Write-Host ""
    Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}

$MinMajor = 22
$MinMinor = 12

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

Write-Host ""
Write-Host "Word Template Filler - build .exe" -ForegroundColor Cyan
Write-Host "project: $ProjectRoot"
Write-Host ""


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

function Get-NodeVersion {
    param([string]$NodeExe)

    $raw = $null

    try {
        $raw = & $NodeExe -v 2>$null
    } catch {
        return $null
    }

    if (-not $raw) {
        return $null
    }

    $text = ($raw | Select-Object -First 1).ToString().Trim()
    $text = $text.TrimStart("v", "V")

    try {
        return [version]$text
    } catch {
        return $null
    }
}

function Test-PathSafe {
    param([string]$Path)

    # NVM_HOME may point to a folder of another user (access denied),
    # so a failing Test-Path must never stop the build
    if (-not $Path) {
        return $false
    }

    try {
        return (Test-Path -LiteralPath $Path -ErrorAction Stop)
    } catch {
        return $false
    }
}

function Get-NodeExeUnder {
    param([string]$Path)

    if (-not (Test-PathSafe -Path $Path)) {
        return @()
    }

    try {
        return @(
            Get-ChildItem -LiteralPath $Path -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue |
                ForEach-Object { $_.FullName }
        )
    } catch {
        return @()
    }
}

function Test-FileLocked {
    param([string]$Path)

    if (-not (Test-PathSafe -Path $Path)) {
        return $false
    }

    # the portable .exe stays locked while the app is open
    try {
        $stream = [System.IO.File]::Open(
            $Path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )

        $stream.Close()

        return $false
    } catch {
        return $true
    }
}

function Get-LockedOutputExe {
    param([string]$Folder)

    # both the portable .exe and the unpacked build folder are overwritten
    $folders = @($Folder, (Join-Path $Folder "win-unpacked"))

    foreach ($current in $folders) {

        if (-not (Test-PathSafe -Path $current)) {
            continue
        }

        $files = Get-ChildItem -LiteralPath $current -Filter "*.exe" -File -ErrorAction SilentlyContinue

        foreach ($item in @($files)) {

            if (Test-FileLocked -Path $item.FullName) {
                return $item.FullName
            }
        }
    }

    return $null
}

function Test-NodeUsable {
    param([version]$Version)

    if (-not $Version) {
        return $false
    }

    if ($Version.Major -gt $MinMajor) {
        return $true
    }

    if ($Version.Major -eq $MinMajor) {
        return ($Version.Minor -ge $MinMinor)
    }

    return $false
}

function Get-NodeCandidates {

    $candidates = @()

    $fromPath = Get-Command node -ErrorAction SilentlyContinue

    if ($fromPath) {
        $candidates += $fromPath.Source
    }

    $programFiles = [Environment]::GetFolderPath("ProgramFiles")
    $programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
    $localAppData = [Environment]::GetFolderPath("LocalApplicationData")

    $candidates += (Join-Path $programFiles "nodejs\node.exe")

    if ($programFilesX86) {
        $candidates += (Join-Path $programFilesX86 "nodejs\node.exe")
    }

    if ($localAppData) {
        $candidates += (Join-Path $localAppData "Programs\nodejs\node.exe")
    }

    # nvm for Windows: one folder per version, plus the active symlink
    $nvmRoots = @(
        $env:NVM_HOME,
        (Join-Path ([Environment]::GetFolderPath("ApplicationData")) "nvm"),
        (Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "nvm"),
        $env:NVM_SYMLINK
    )

    foreach ($nvmRoot in $nvmRoots) {

        if (-not $nvmRoot) {
            continue
        }

        $candidates += Get-NodeExeUnder -Path $nvmRoot
    }

    return ($candidates | Where-Object { $_ } | Select-Object -Unique)
}


# ------------------------------------------------------------
# 1. Node.js
# ------------------------------------------------------------

Write-Host "[1/5] checking Node.js (need $MinMajor.$MinMinor or newer)"

$nodeExe = $null
$nodeVersion = $null

foreach ($candidate in (Get-NodeCandidates)) {

    if (-not $candidate) {
        continue
    }

    if (-not (Test-PathSafe -Path $candidate)) {
        continue
    }

    $version = Get-NodeVersion $candidate

    if (-not $version) {
        continue
    }

    if (-not (Test-NodeUsable $version)) {
        Write-Host ("      skip  node {0,-10} {1}" -f $version, $candidate) -ForegroundColor DarkGray
        continue
    }

    Write-Host ("      ok    node {0,-10} {1}" -f $version, $candidate) -ForegroundColor DarkGray

    if (-not $nodeVersion -or $version -gt $nodeVersion) {
        $nodeVersion = $version
        $nodeExe = $candidate
    }
}

if (-not $nodeExe) {

    Write-Host ""
    Write-Host "ERROR: Node.js $MinMajor.$MinMinor+ not found." -ForegroundColor Red
    Write-Host "Install it from https://nodejs.org (LTS) then run this script again."
    Write-Host ""

    exit 1
}

$nodeDir = Split-Path -Parent $nodeExe
$env:Path = "$nodeDir;$env:Path"

Write-Host "      using node $nodeVersion" -ForegroundColor Green


# ------------------------------------------------------------
# 2. Running app
# ------------------------------------------------------------

Write-Host ""
Write-Host "[2/5] checking for a running app instance"

$outputFolder = Join-Path $ProjectRoot $OutputDir
$appName = "Word Template Filler"
$packageFile = Join-Path $ProjectRoot "package.json"

if (Test-PathSafe -Path $packageFile) {

    try {
        $packageData = Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json

        if ($packageData.build.productName) {
            $appName = $packageData.build.productName
        }
    } catch {
        # keep the default name
    }
}

$runningApp = @(Get-Process -Name $appName -ErrorAction SilentlyContinue)
$lockedExe = Get-LockedOutputExe -Folder $outputFolder

if ($KillRunning -and ($runningApp.Count -gt 0 -or $lockedExe)) {

    Write-Host ("      closing {0} running process(es)" -f $runningApp.Count) -ForegroundColor DarkYellow

    $runningApp | Stop-Process -Force -ErrorAction SilentlyContinue

    for ($attempt = 1; $attempt -le 3; $attempt++) {

        Start-Sleep -Seconds 2

        $runningApp = @(Get-Process -Name $appName -ErrorAction SilentlyContinue)
        $lockedExe = Get-LockedOutputExe -Folder $outputFolder

        if ($runningApp.Count -eq 0 -and -not $lockedExe) {
            break
        }
    }
}

if ($lockedExe) {

    if ($runningApp.Count -gt 0) {
        Write-Host ("      running: {0} (PID {1})" -f $appName, (($runningApp | ForEach-Object { $_.Id }) -join ", ")) -ForegroundColor Yellow
    }

    Write-Host ("      locked : {0}" -f $lockedExe) -ForegroundColor Yellow

    Write-Host ""
    Write-Host "ERROR: the app is running, so the .exe cannot be overwritten." -ForegroundColor Red
    Write-Host "       close the app window and run again, or pass -KillRunning"
    Write-Host "       test build without touching it: -OutputDir release-test"
    Write-Host ""

    exit 1
}

if ($runningApp.Count -gt 0) {

    Write-Host ("      note    {0} is running (PID {1})" -f $appName, (($runningApp | ForEach-Object { $_.Id }) -join ", ")) -ForegroundColor DarkYellow
    Write-Host "              this does not block the build (no target file is locked)" -ForegroundColor DarkGray

} else {

    Write-Host "      ok      no running instance" -ForegroundColor DarkGray
}


# ------------------------------------------------------------
# 3. Renderer build (Vite)
# ------------------------------------------------------------

Write-Host ""
Write-Host "[3/5] building renderer (vite build)"

if ($Clean) {

    foreach ($dir in @("dist", $OutputDir)) {

        $full = Join-Path $ProjectRoot $dir

        if (Test-PathSafe -Path $full) {
            Remove-Item -Recurse -Force $full
            Write-Host "      removed $dir" -ForegroundColor DarkGray
        }
    }
}

$npmCmd = Join-Path $nodeDir "npm.cmd"

if (-not (Test-PathSafe -Path $npmCmd)) {
    $npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
}

if (-not $npmCmd) {
    Write-Host "ERROR: npm.cmd not found next to node.exe and not in PATH." -ForegroundColor Red
    exit 1
}

if ($SkipVite) {

    Write-Host "      skipped (-SkipVite)" -ForegroundColor DarkYellow

} else {

    & $npmCmd run build

    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: vite build failed (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}


# ------------------------------------------------------------
# 4. Package .exe (electron-builder)
# ------------------------------------------------------------

Write-Host ""
Write-Host "[4/5] packaging .exe (electron-builder --win nsis)"

$builderCmd = Join-Path $ProjectRoot "node_modules\.bin\electron-builder.cmd"

if (-not (Test-PathSafe -Path $builderCmd)) {
    Write-Host "ERROR: electron-builder not installed. Run: npm install" -ForegroundColor Red
    exit 1
}

& $builderCmd --win nsis "--config.directories.output=$OutputDir"

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: electron-builder failed (exit $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}


# ------------------------------------------------------------
# 5. Verify output
# ------------------------------------------------------------

Write-Host ""
Write-Host "[5/5] checking output"

$checks = @(
    "dist\index.html",
    "dist\vendor\jszip.min.js",
    "$OutputDir\win-unpacked\resources\app.asar",
    "$OutputDir\win-unpacked\resources\app.asar.unpacked\src\main\db\db-worker.cjs",
    "$OutputDir\win-unpacked\resources\app.asar.unpacked\node_modules\better-sqlite3"
)

$missing = 0

foreach ($item in $checks) {

    $full = Join-Path $ProjectRoot $item

    if (Test-PathSafe -Path $full) {
        Write-Host "      ok      $item" -ForegroundColor DarkGray
    } else {
        Write-Host "      MISSING $item" -ForegroundColor Red
        $missing++
    }
}

# CSS must be referenced relatively, otherwise the page has no style
# when Electron opens it through file://
$indexHtml = Join-Path $ProjectRoot "dist\index.html"

if (Test-PathSafe -Path $indexHtml) {

    $html = Get-Content $indexHtml -Raw

    if ($html -match 'href="\./assets/') {
        Write-Host "      ok      css path is relative" -ForegroundColor DarkGray
    } else {
        Write-Host "      WARNING css path is not relative - check vite base" -ForegroundColor Yellow
    }

    if ($html -match 'vendor/jszip\.min\.js') {
        Write-Host "      ok      jszip is bundled locally" -ForegroundColor DarkGray
    } else {
        Write-Host "      WARNING jszip script tag not found in dist/index.html" -ForegroundColor Yellow
    }
}

$exe = Get-ChildItem -LiteralPath $outputFolder -Filter "*Setup*.exe" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

Write-Host ""

if ($missing -gt 0) {
    Write-Host "BUILD FINISHED WITH WARNINGS ($missing item(s) missing)" -ForegroundColor Yellow
} else {
    Write-Host "BUILD SUCCESS" -ForegroundColor Green
}

if ($exe) {
    Write-Host ("  exe  : {0}" -f $exe.FullName)
    Write-Host ("  size : {0:N1} MB" -f ($exe.Length / 1MB))
    Write-Host ("  time : {0}" -f $exe.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
}

Write-Host ""
Write-Host "  Next run: the app creates its database next to the exe"
Write-Host ("            {0}\data\templates.db" -f $OutputDir)
Write-Host ""
