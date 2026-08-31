@echo off
REM Source/development launcher for Windows; v0.3.0 has no Windows release.
REM Requires: Node.js (npm) + Codex, Claude Code, or TraeCode CLI installed and logged in.
cd /d "%~dp0"
if not exist "node_modules\electron" (
  echo First run - installing dependencies, please wait...
  call npm ci
)
echo Starting PaperReader...
call npm start
if errorlevel 1 (
  echo.
  echo PaperReader exited with an error. See the messages above.
  pause
)
