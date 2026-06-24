#!/bin/bash
# Double-click to launch PaperReader on macOS (first: chmod +x run-mac.command).
# Requires: Node.js (npm) + the claude CLI installed & logged in.
cd "$(dirname "$0")" || exit 1
if [ ! -d node_modules/electron ]; then
  echo "First run — installing dependencies, please wait..."
  npm install || { echo "npm install failed"; read -r; exit 1; }
fi
echo "Starting PaperReader..."
npm start
