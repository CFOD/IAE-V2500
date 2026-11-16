@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then try again.
  pause
  exit /b 1
)
if "%~1"=="" (
  echo Drag the sound pack file ^(for example A320_Sp.PC.pck^) onto this file.
  pause
  exit /b 1
)
node tools\msfs-sound-inspect.mjs "%~1"
echo.
echo A file called sound-report.txt was saved next to the pack. Send it back.
pause
