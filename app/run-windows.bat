@echo off
REM Double-click to launch PaperReader on Windows.
REM Requires: Node.js (npm) + the claude CLI installed & logged in.
cd /d "%~dp0"
if not exist "node_modules\electron" (
  echo First run - installing dependencies, please wait...
  call npm install
)
echo Starting PaperReader...
call npm start
if errorlevel 1 (
  echo.
  echo PaperReader exited with an error. See the messages above.
  pause
)
