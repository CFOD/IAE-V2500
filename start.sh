#!/bin/sh
# macOS / Linux launcher: ./start.sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again."; exit 1; }
[ -d node_modules/electron ] || { echo "First run: downloading what the game needs (a few minutes, once only)."; npm install || exit 1; }
npm start
