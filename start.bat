@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "APP_URL=http://localhost:3000"
set "HEALTH_URL=http://127.0.0.1:3000/api/health"

echo ========================================
echo   MoosStudio Launcher
echo ========================================
echo.

if not exist ".env" (
    echo Creating default .env file...
    (
        echo PORT=3000
        echo NODE_ENV=development
        echo AI_CREDITS_API_KEY=
        echo SESSION_SECRET=change_me_to_a_random_32_char_secret
        echo FIREBASE_PROJECT_ID=
        echo FIREBASE_CLIENT_EMAIL=
        echo FIREBASE_PRIVATE_KEY=
    ) > ".env"
    echo WARNING: Please edit .env with your local development credentials.
    echo.
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing '%HEALTH_URL%' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
    echo A healthy MoosStudio server is already running.
    echo Opening %APP_URL%
    start "" "%APP_URL%"
    exit /b 0
)

set "PATH_NODE_VERSION="
for /f "delims=" %%v in ('node -v 2^>nul') do set "PATH_NODE_VERSION=%%v"
if defined PATH_NODE_VERSION (
    echo Detected PATH Node: !PATH_NODE_VERSION!
) else (
    echo No PATH Node runtime detected.
)

set "NODE_EXE="
set "USE_NPX_NODE22="

if defined PATH_NODE_VERSION (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$raw='!PATH_NODE_VERSION!'.TrimStart('v'); try { if ([version]$raw -ge [version]'22.12.0') { exit 0 } } catch {}; exit 1" >nul 2>nul
    if not errorlevel 1 (
        set "NODE_EXE=node"
        echo Using PATH Node runtime.
    )
)

if not defined NODE_EXE (
    for /f "usebackq delims=" %%p in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'; if (Test-Path $root) { Get-ChildItem -Path $root -Recurse -Filter node.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\node_modules\\node\\bin\\node.exe$' } | Sort-Object LastWriteTime -Descending | ForEach-Object { try { $v = (& $_.FullName -v).TrimStart('v'); if ([version]$v -ge [version]'22.12.0') { $_.FullName; exit 0 } } catch {} } }"`) do (
        set "NODE_EXE=%%p"
    )
    if defined NODE_EXE (
        echo Using cached Node 22 runtime:
        echo !NODE_EXE!
    )
)

if not defined NODE_EXE (
    set "USE_NPX_NODE22=1"
    echo Node 22.12+ was not found locally. Using npx node@22 fallback.
)

echo.
echo Checking development ports...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = @(3000,24678); $pids = @(); foreach ($port in $ports) { $pids += (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess) }; $pids = $pids | Where-Object { $_ -and $_ -ne $PID } | Sort-Object -Unique; foreach ($procId in $pids) { Write-Host ('Stopping process {0} using MoosStudio development ports...' -f $procId); Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(15); do { $busy = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if (-not $busy) { exit 0 }; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1" >nul 2>nul
if errorlevel 1 (
    echo ERROR: Port 3000 is still occupied. Close the process using it and run start.bat again.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$busy = Get-NetTCPConnection -LocalPort 24678 -State Listen -ErrorAction SilentlyContinue; if ($busy) { exit 1 } else { exit 0 }" >nul 2>nul
if errorlevel 1 (
    set "DISABLE_HMR=true"
    echo HMR port 24678 is busy. Continuing with HMR disabled.
)

echo.
echo Waiting for health check before opening browser...
start "MoosStudio Health Waiter" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(120); do { try { $r=Invoke-WebRequest -UseBasicParsing '%HEALTH_URL%' -TimeoutSec 2; if ($r.StatusCode -eq 200) { Start-Process '%APP_URL%'; exit 0 } } catch {}; Start-Sleep -Milliseconds 750 } while ((Get-Date) -lt $deadline); Write-Warning 'MoosStudio did not become healthy within 120 seconds. Open http://localhost:3000 manually after checking this console for errors.'"

echo.
echo Starting MoosStudio on %APP_URL%
echo Press Ctrl+C in this window to stop the server.
echo ========================================
echo.

if defined USE_NPX_NODE22 (
    npx --yes -p node@22 node --no-warnings --import tsx server.ts
) else (
    "!NODE_EXE!" --no-warnings --import tsx server.ts
)

echo.
echo Server process exited.
pause
