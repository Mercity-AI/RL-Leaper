$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $python)) { throw 'The Leaper Python environment is missing (.venv). Restore it before starting the game.' }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (!$node) {
    $node = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (!(Test-Path -LiteralPath $node)) { throw 'Node.js is missing. Install Node.js 20 or newer before starting the game.' }
& $node 'node_modules/vite/bin/vite.js' build
if ($LASTEXITCODE -ne 0) { throw 'The game build failed. The preview was not started.' }
New-Item -ItemType Directory -Path 'tmp' -Force | Out-Null
function Get-LocalResponse($url) {
    try { return Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $url } catch { return $null }
}
$brain = Get-LocalResponse 'http://127.0.0.1:8767/'
if (!$brain) {
    Start-Process -FilePath $python -ArgumentList '-m rl.junkyard_server' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'tmp/brain.log') -RedirectStandardError (Join-Path $PSScriptRoot 'tmp/brain-error.log')
} elseif (($brain.Content | ConvertFrom-Json).model_step -ne 7757824) {
    throw 'Port 8767 is occupied by an unexpected service.'
}
$preview = Get-LocalResponse 'http://127.0.0.1:4175/'
if ($preview -and $preview.Content.Trim() -ne (Get-Content -Raw 'dist/index.html').Trim()) {
    $listener = Get-NetTCPConnection -LocalPort 4175 -State Listen | Select-Object -First 1
    $previewProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if ($previewProcess.CommandLine -match '-m http.server 4175 .*--directory tmp/camera-check-build') {
        # Migrate only the old preview started by this project's earlier checks.
        Stop-Process -Id $previewProcess.ProcessId
        $preview = $null
    } else { throw 'Port 4175 is serving a different build. Close that preview before launching Leaper.' }
}
if (!$preview) {
    Start-Process -FilePath $python -ArgumentList '-m http.server 4175 --bind 127.0.0.1 --directory dist' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'tmp/game.log') -RedirectStandardError (Join-Path $PSScriptRoot 'tmp/game-error.log')
}
Write-Output 'Game: http://127.0.0.1:4175/?map=junkyard'
Write-Output 'Start Run captures the mouse. Escape pauses and releases it. Initial brain loading can take a moment.'
