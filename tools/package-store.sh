#!/usr/bin/env bash
# Build the ZIP for the Chrome Web Store. The store requires manifest.json at
# the root of the archive, so zip the contents of the extension folder.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

VERSION="$(python3 -c 'import json; print(json.load(open("woot-search-extension/manifest.json"))["version"])')"
mkdir -p dist
OUT="dist/woot-deal-search-${VERSION}-chrome-store.zip"
rm -f "$OUT"

(
  cd woot-search-extension
  zip -r "../${OUT}" . \
    -x "*.DS_Store" \
    -x "__MACOSX/*" \
    -x "README.md" > /dev/null
)

echo "Built $(pwd)/${OUT}"
unzip -l "$OUT" | sed -n '1,20p'
