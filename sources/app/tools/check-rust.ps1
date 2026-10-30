# Brings the dev database and the query cache up to date, then formats, lints and tests the Rust
# side. Every step has a time limit, so a hanging test ends the run instead of blocking it.
# The tests against a server run when QUERYMASTER_TEST_URI is set or stands in .env.local.
param([int]$TimeoutSeconds = 600)

$root = Split-Path $PSScriptRoot -Parent
$tauri = Join-Path $root "src-tauri"
$envFile = Join-Path $root ".env.local"
if (-not $env:QUERYMASTER_TEST_URI -and (Test-Path $envFile)) {
    $line = Get-Content $envFile | Where-Object { $_ -match "^QUERYMASTER_TEST_URI=" } | Select-Object -First 1
    if ($line) { $env:QUERYMASTER_TEST_URI = $line -replace "^QUERYMASTER_TEST_URI=", "" }
}

$steps = @(
    @{ Name = "migrate"; Command = "sqlx migrate run" },
    @{ Name = "prepare"; Command = "cargo sqlx prepare -- --tests" },
    @{ Name = "format"; Command = "cargo fmt" },
    @{ Name = "clippy"; Command = "cargo clippy --all-targets -- -D warnings" },
    @{ Name = "test"; Command = "cargo test -- --include-ignored" }
)

$failed = $false
foreach ($step in $steps) {
    $job = Start-Job -ScriptBlock {
        param($directory, $command, $uri)
        Set-Location $directory
        $env:QUERYMASTER_TEST_URI = $uri
        $output = Invoke-Expression "$command 2>&1" | Out-String
        "$output`nEXIT $LASTEXITCODE"
    } -ArgumentList $tauri, $step.Command, $env:QUERYMASTER_TEST_URI
    if (-not (Wait-Job $job -Timeout $TimeoutSeconds)) {
        Stop-Job $job
        Remove-Job $job -Force
        "[$($step.Name)] TIMEOUT after $TimeoutSeconds s"
        $failed = $true
        break
    }
    $output = Receive-Job $job
    Remove-Job $job -Force
    $ok = $output -match "EXIT 0"
    $lines = ($output -split "`n") | Where-Object { $_ -match "^(error|warning)|^test .* FAILED|panicked|test result: .* [1-9]\d* (passed|failed)" }
    "[$($step.Name)] $(if ($ok) { 'ok' } else { 'FAILED' })"
    if ($lines) { $lines | ForEach-Object { "    $($_.Trim())" } }
    if (-not $ok) {
        ($output -split "`n") | Select-Object -Last 40
        $failed = $true
        break
    }
}
if ($failed) { exit 1 }
