# One-click start on Windows: a thin wrapper around `pnpm play`.
# It installs the JavaScript packages when needed, then starts the brain service
# and the game and prints the address to open. See "Play the game" in README.md
# for the one-time Python setup (.venv from requirements-brain.txt).
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# pnpm comes with Node.js through Corepack.
if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    corepack enable
    if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw 'pnpm is missing. Install Node.js 22 LTS, then run: corepack enable'
    }
}

# Same package versions as everyone else (pnpm-lock.yaml).
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed; the game was not started.' }

# Brain + game; Ctrl+C stops both. Extra arguments (e.g. --port 5180) pass through.
pnpm play @args
exit $LASTEXITCODE
