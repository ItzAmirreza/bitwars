#Requires -Version 5.1
<#
=============================================================================
 BitWars - run the full local dev stack on Windows.

   ./scripts/run-local.ps1
   (if PowerShell blocks it: powershell -ExecutionPolicy Bypass -File scripts\run-local.ps1)

 Brings up everything with one command:
   1. starts a local SpacetimeDB instance on a free port (prefers 3000),
   2. publishes the game module to it,
   3. regenerates the TypeScript client bindings,
   4. runs the Vite client (pointed at your local instance, on a free port).

 Press Ctrl+C once to stop BOTH the server and the client.

 Your client\.env.local is NOT touched - the local URL + module name are
 injected as environment variables, which Vite prioritizes over .env files.
=============================================================================
#>
$ErrorActionPreference = 'Stop'

# --- locate the repo (this script lives in <repo>\scripts) -------------------
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot    = Split-Path -Parent $ScriptDir
$ServerDir   = Join-Path $RepoRoot 'server\spacetimedb'
$ClientDir   = Join-Path $RepoRoot 'client'
$BindingsDir = Join-Path $ClientDir 'src\module_bindings'

$Module        = 'bitwars-local'
$ServerOutLog  = Join-Path $env:TEMP ("bitwars-stdb-{0}.out.log" -f $PID)
$ServerErrLog  = Join-Path $env:TEMP ("bitwars-stdb-{0}.err.log" -f $PID)
$script:ServerProc = $null
$script:Cleaned    = $false

function Say  ($m) { Write-Host "[bitwars] $m" -ForegroundColor Cyan }
function Warn ($m) { Write-Host "[bitwars] $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "[bitwars] $m" -ForegroundColor Red; exit 1 }

function Test-PortFree([int]$p) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $l.Start(); $l.Stop(); return $true
  } catch { return $false }
}

function Show-ServerLogTail {
  foreach ($f in @($ServerErrLog, $ServerOutLog)) {
    if (Test-Path $f) { Get-Content $f -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ } }
  }
}

function Stop-Stack {
  if ($script:Cleaned) { return }
  $script:Cleaned = $true
  Write-Host ''
  Say 'shutting down...'
  if ($script:ServerProc -and -not $script:ServerProc.HasExited) {
    # /T kills the whole process tree, /F forces it.
    try { taskkill /PID $script:ServerProc.Id /T /F | Out-Null } catch {}
  }
  foreach ($f in @($ServerOutLog, $ServerErrLog)) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
  }
  Say 'local stack stopped.'
}

try {
  # --- prerequisites ---------------------------------------------------------
  if (-not (Get-Command spacetime -ErrorAction SilentlyContinue)) { Die 'spacetime CLI not found - install: https://spacetimedb.com/install' }
  if (-not (Get-Command bun       -ErrorAction SilentlyContinue)) { Die 'bun not found - install: https://bun.sh' }
  if (-not (Get-Command cargo     -ErrorAction SilentlyContinue)) { Warn "cargo not found - 'spacetime publish' needs the Rust toolchain (https://rustup.rs)." }
  if (Get-Command rustup -ErrorAction SilentlyContinue) {
    if (-not ((rustup target list --installed 2>$null) -match 'wasm32-unknown-unknown')) {
      Say 'adding wasm32-unknown-unknown target...'
      rustup target add wasm32-unknown-unknown | Out-Null
    }
  }

  # --- pick a free port for SpacetimeDB (prefer 3000) ------------------------
  $Port = 3000
  while (-not (Test-PortFree $Port)) {
    $Port++
    if ($Port -gt 3100) { Die 'no free port found in 3000-3100' }
  }
  $HostUrl = "http://127.0.0.1:$Port"
  $WsUrl   = "ws://127.0.0.1:$Port"
  Say "SpacetimeDB port: $Port"

  # --- ensure client deps ----------------------------------------------------
  if (-not (Test-Path (Join-Path $ClientDir 'node_modules'))) {
    Say 'installing client dependencies (bun install)...'
    Push-Location $ClientDir; try { bun install } finally { Pop-Location }
  }

  # --- start the local server (logs to temp files) ---------------------------
  Say "starting SpacetimeDB  (logs: $ServerOutLog)"
  $script:ServerProc = Start-Process -FilePath 'spacetime' `
    -ArgumentList @('start', '-l', "127.0.0.1:$Port") `
    -WorkingDirectory $ServerDir -NoNewWindow -PassThru `
    -RedirectStandardOutput $ServerOutLog -RedirectStandardError $ServerErrLog

  # --- wait until it answers --------------------------------------------------
  Say 'waiting for the server to come up...'
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    if ($script:ServerProc.HasExited) { Show-ServerLogTail; Die 'the server process exited during startup (see log above)' }
    try {
      Invoke-WebRequest -Uri "$HostUrl/v1/ping" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null
      $ready = $true; break
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { Show-ServerLogTail; Die 'server did not become ready in time' }
  Say 'server ready OK'

  # --- publish the module + regenerate bindings ------------------------------
  Say "publishing module $Module (first run compiles the wasm - this can take a while)..."
  & spacetime publish $Module -s $HostUrl -p $ServerDir --delete-data=on-conflict --break-clients -y
  if ($LASTEXITCODE -ne 0) { Die 'publish failed (see output above)' }
  Say 'regenerating client bindings...'
  & spacetime generate --lang typescript --out-dir $BindingsDir -p $ServerDir -y
  if ($LASTEXITCODE -ne 0) { Die 'binding generation failed (see output above)' }

  # --- run the client in the foreground; Ctrl+C ends it and triggers cleanup -
  Say 'starting the client - Vite will print its URL below.'
  Say 'open that URL in your browser. Press Ctrl+C here to stop the whole stack.'
  $env:VITE_SPACETIMEDB_URI = $WsUrl
  $env:VITE_MODULE_NAME     = $Module
  Set-Location $ClientDir
  & bun dev
}
finally {
  Stop-Stack
}
