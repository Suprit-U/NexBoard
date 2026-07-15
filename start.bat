@echo off
setlocal enabledelayedexpansion
title NexBoard Launcher

echo.
echo  =============================================
echo    NexBoard ^| Real-Time Whiteboard Launcher
echo  =============================================
echo.

:: ── STEP 1: Kill existing processes on ports 3001 & 5173 ────
echo  [1/4]  Freeing ports 3001 and 5173...

powershell -NoProfile -Command ^
  "$ports = @(3001, 5173); foreach ($port in $ports) { $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue; if ($conn) { $pids = $conn.OwningProcess | Sort-Object -Unique; foreach ($p in $pids) { Write-Host \"  Killing PID $p on port $port\"; Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } } }"

:: Wait 2 seconds for ports to release
ping 127.0.0.1 -n 3 >nul
echo         Ports freed.
echo.

:: ── STEP 2: Install backend deps if missing ─────────────────
echo  [2/4]  Checking backend dependencies...
if not exist "%~dp0backend\node_modules" (
    echo         node_modules missing. Installing...
    cd /d "%~dp0backend"
    call npm install
    echo         Done.
) else (
    echo         Already installed. Skipping.
)
echo.

:: ── STEP 3: Install frontend deps if missing ────────────────
echo  [3/4]  Checking frontend dependencies...
if not exist "%~dp0frontend\node_modules" (
    echo         node_modules missing. Installing...
    cd /d "%~dp0frontend"
    call npm install
    echo         Done.
) else (
    echo         Already installed. Skipping.
)
echo.

:: ── STEP 4: Launch Backend in a new window ──────────────────
echo  [4/4]  Launching servers...
echo         Starting Backend  (http://localhost:3001) ...
start "NexBoard Backend :3001" cmd /c "color 0A && title NexBoard Backend :3001 && _run_backend.bat"

:: Wait 3 seconds for backend to boot
ping 127.0.0.1 -n 4 >nul

:: ── Launch Frontend in a new window ─────────────────────────
echo         Starting Frontend (http://localhost:5173) ...
start "NexBoard Frontend :5173" cmd /c "color 0B && title NexBoard Frontend :5173 && _run_frontend.bat"

:: Wait for Vite to be ready
ping 127.0.0.1 -n 6 >nul

:: ── Open browser ─────────────────────────────────────────────
echo         Opening browser...
start "" "http://localhost:5173"

echo.
echo  =============================================
echo    NexBoard is RUNNING!
echo.
echo    PC (localhost):
echo      Frontend  ^>  http://localhost:5173
echo      Backend   ^>  http://localhost:3001
echo.

:: Get local IP for LAN display
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set LAN_IP=%%a
    goto :found_ip
)
:found_ip
set LAN_IP=%LAN_IP: =%

echo    Phone / LAN access (same WiFi):
echo      Frontend  ^>  http://%LAN_IP%:5173
echo      Backend   ^>  http://%LAN_IP%:3001
echo.
echo    If phone can't connect, run setup_firewall.bat as Admin!
echo.
echo    Two server windows have opened.
echo    Close them or press Ctrl+C inside each to stop.
echo    Or run stop.bat to kill everything.
echo  =============================================
echo.
echo  Press any key to close this launcher window...
pause >nul
