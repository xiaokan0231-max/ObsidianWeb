#!/bin/zsh -l

# Use the project directory when launched from Finder.
cd -- "${0:A:h}" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PORT=3000

if ! command -v npm >/dev/null 2>&1; then
  print 'npm was not found. Install Node.js and try again.'
  read '?Press Enter to close...'
  exit 1
fi

print 'Starting ObsidianWeb: http://localhost:3000'
print 'Press Control+C to stop the server.'
npm run dev
result=$?

# Keep errors visible when launched from Finder.
print '\nServer stopped.'
read '?Press Enter to close...'
exit "$result"
