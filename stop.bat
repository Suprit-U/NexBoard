@echo off
title NexBoard - Stopping Servers

echo.
echo  =============================================
echo    NexBoard ^| Stopping All Servers
echo  =============================================
echo.

echo  Stopping processes on ports 3001 and 5173...

powershell -NoProfile -Command ^
  "$ports = @(3001, 5173); foreach ($port in $ports) { $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue; if ($conn) { $pids = $conn.OwningProcess | Sort-Object -Unique; foreach ($p in $pids) { Write-Host \"  Killing PID $p on port $port\"; Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } } else { Write-Host \"  Port $port is already free.\" } }"

echo.
echo  All NexBoard servers stopped.
echo.
pause
