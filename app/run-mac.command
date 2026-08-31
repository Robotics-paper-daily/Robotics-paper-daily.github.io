#!/bin/bash
# Double-click to launch PaperReader on macOS (first: chmod +x run-mac.command).
# Requires: Node.js (npm) + Codex, Claude Code, or TraeCode CLI installed and logged in.
cd "$(dirname "$0")" || exit 1
if [ ! -d node_modules/electron ] || ! npm ls --depth=0 >/dev/null 2>&1; then
  echo "Installing missing or outdated locked dependencies, please wait..."
  npm ci || { echo "npm ci failed"; read -r; exit 1; }
fi
echo "Starting PaperReader..."
npm start
