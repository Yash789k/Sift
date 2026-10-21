@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Dependencies are missing. Install Node.js 22.12 or newer, then run npm ci and npm run setup.
  pause
  exit /b 1
)
call npm run build:native
if errorlevel 1 exit /b 1
start "" "node_modules\electron\dist\electron.exe" . --show-wheel
