@echo off
REM Script to start multiple mock backend services on Windows
REM This simulates having 3 user service instances for load balancing

echo ===================================================================
echo      Starting Mock Backend Services
echo ===================================================================
echo.

echo Starting user-service instances...

REM Start 3 instances of user service
start "user-service-3001" cmd /k "node mock-services/user-service.js 3001"
timeout /t 1 /nobreak >nul

start "user-service-3002" cmd /k "node mock-services/user-service.js 3002"
timeout /t 1 /nobreak >nul

start "user-service-3003" cmd /k "node mock-services/user-service.js 3003"
timeout /t 1 /nobreak >nul

echo.
echo All services started!
echo.
echo Services:
echo   - user-service-3001: http://localhost:3001
echo   - user-service-3002: http://localhost:3002
echo   - user-service-3003: http://localhost:3003
echo.
echo Close the service windows to stop them
echo.
pause
