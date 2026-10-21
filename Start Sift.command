#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 24 from https://nodejs.org/ then open this launcher again.'
  read -r '?Press Return to close. '
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'; then
  printf '%s\n' 'Node.js 22.12 or newer is required. Node.js 24 is recommended.'
  read -r '?Press Return to close. '
  exit 1
fi
if [[ ! -x node_modules/.bin/electron ]]; then
  npm ci
fi
exec npm start -- --show-wheel
