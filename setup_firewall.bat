@echo off
:: ╔══════════════════════════════════════════════════════════╗
:: ║      NexBoard — Windows Firewall Setup                  ║
:: ║  Run this ONCE as Administrator to allow LAN access      ║
:: ╚══════════════════════════════════════════════════════════╝

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo  *** ERROR: This script must be run as Administrator ***
    echo.
    echo  Right-click the file and choose "Run as administrator"
    echo.
    pause
    exit /b 1
)

echo.
echo  ============================================
echo    NexBoard ^| Firewall Setup
echo  ============================================
echo.

:: ── Remove old rules if they exist (clean slate) ─────────
echo  Removing any old NexBoard firewall rules...
netsh advfirewall firewall delete rule name="NexBoard Frontend (5173)" >nul 2>&1
netsh advfirewall firewall delete rule name="NexBoard Backend (3001)"  >nul 2>&1
echo  Done.
echo.

:: ── Add inbound rules for Private + Domain networks ──────
echo  Adding inbound rule: Port 5173 (Vite / Frontend)...
netsh advfirewall firewall add rule ^
    name="NexBoard Frontend (5173)" ^
    dir=in ^
    action=allow ^
    protocol=TCP ^
    localport=5173 ^
    profile=private,domain ^
    description="Allows LAN devices to access NexBoard frontend (Vite dev server)"
if %errorLevel%==0 (echo  OK) else (echo  FAILED)

echo.
echo  Adding inbound rule: Port 3001 (Node.js / Backend)...
netsh advfirewall firewall add rule ^
    name="NexBoard Backend (3001)" ^
    dir=in ^
    action=allow ^
    protocol=TCP ^
    localport=3001 ^
    profile=private,domain ^
    description="Allows LAN devices to reach NexBoard Socket.IO backend"
if %errorLevel%==0 (echo  OK) else (echo  FAILED)

echo.
echo  ============================================
echo    Firewall rules created successfully!
echo.
echo    Your PC's IP:  192.168.1.37
echo.
echo    Phone URL (Frontend):  http://192.168.1.37:5173
echo    Phone URL (Backend):   http://192.168.1.37:3001
echo.
echo    Make sure NexBoard servers are running,
echo    then open http://192.168.1.37:5173 on your phone.
echo  ============================================
echo.
pause
