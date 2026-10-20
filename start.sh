#!/bin/bash
set -e

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PORT=3000

exec npm run dev
