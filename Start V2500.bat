@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
if not exist node_modules\electron (
  echo First run: downloading what the game needs. This takes a few minutes and only happens once.
  call npm install
  if errorlevel 1 (
    echo Something went wrong during setup. Check your internet connection and run this file again.
    pause
    exit /b 1
  )
)
call npm start
