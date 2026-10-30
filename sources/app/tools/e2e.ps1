# Starts the app with the web view's debugging port open, runs e2e/app.mjs against it and stops the
# app again. Needs QUERYMASTER_TEST_URI (or .env.local) and a free port 1420.
# With -Release it runs against the built program of `bun run app:build` instead of the dev server:
# the same walk-through, with the release CSP and the app's real data folder.
param([int]$Port = 9222, [int]$StartTimeoutSeconds = 600, [int]$RunTimeoutSeconds = 240, [string]$Script = "e2e/app.mjs", [switch]$Release)

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$envFile = Join-Path $root ".env.local"
if (-not $env:QUERYMASTER_TEST_URI -and (Test-Path $envFile)) {
    $line = Get-Content $envFile | Where-Object { $_ -match "^QUERYMASTER_TEST_URI=" } | Select-Object -First 1
    if ($line) { $env:QUERYMASTER_TEST_URI = $line -replace "^QUERYMASTER_TEST_URI=", "" }
}
if (-not $env:QUERYMASTER_TEST_URI) { "QUERYMASTER_TEST_URI is not set"; exit 1 }

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
$env:QUERYMASTER_DEBUG_PORT = "$Port"
$log = Join-Path $env:TEMP "querymaster-e2e-app.log"
if ($Release) {
    $exe = Join-Path $root "src-tauri\target\release\query-master.exe"
    if (-not (Test-Path $exe)) { "No release build at ${exe}: run bun run app:build first"; exit 1 }
    $app = Start-Process -FilePath $exe -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    # The built app is served from tauri.localhost, the dev server from localhost:1420.
    $pageUrl = "tauri\.localhost"
} else {
    $app = Start-Process -FilePath "bun" -ArgumentList "run", "tauri", "dev" -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    $pageUrl = "localhost:1420"
}

function Stop-App {
    # The dev command starts children (vite, cargo, the app itself): end the whole tree.
    & taskkill /PID $app.Id /T /F 2>$null | Out-Null
    Get-Process query-master -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
}

try {
    $ready = $false
    for ($waited = 0; $waited -lt $StartTimeoutSeconds; $waited += 2) {
        try {
            $targets = Invoke-RestMethod "http://127.0.0.1:$Port/json" -TimeoutSec 2
            if ($targets | Where-Object { $_.url -match $pageUrl }) { $ready = $true; break }
        } catch { }
        if ($app.HasExited) { break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        "The app did not come up within $StartTimeoutSeconds s. Last lines of its output:"
        Get-Content "$log.err", $log -ErrorAction SilentlyContinue | Select-Object -Last 25
        exit 1
    }
    Start-Sleep -Seconds 2

    $job = Start-Job -ScriptBlock {
        param($directory, $script, $uri, $port)
        Set-Location $directory
        $env:QUERYMASTER_TEST_URI = $uri
        $env:QUERYMASTER_DEBUG_PORT = $port
        $output = node $script 2>&1 | Out-String
        "$output`nEXIT $LASTEXITCODE"
    } -ArgumentList $root, $Script, $env:QUERYMASTER_TEST_URI, "$Port"
    if (Wait-Job $job -Timeout $RunTimeoutSeconds) {
        $output = Receive-Job $job
        $output
        $failed = $output -notmatch "EXIT 0"
    } else {
        Stop-Job $job
        "TIMEOUT: the walk-through did not finish within $RunTimeoutSeconds s"
        $failed = $true
    }
    Remove-Job $job -Force
} finally {
    Stop-App
}
if ($failed) { exit 1 }
exit 0
