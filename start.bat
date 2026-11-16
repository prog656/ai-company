@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js not found in PATH.
  echo Install Node.js 18+ first: https://nodejs.org
  echo.
  pause
  exit /b 1
)
node run.mjs
echo.
pause
