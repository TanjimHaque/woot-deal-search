#!/usr/bin/env bash
# Build the zip attached to a GitHub release.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

OUT="woot-search-extension.zip"
rm -f "$OUT"
zip -r "$OUT" woot-search-extension -x "*.DS_Store" -x "*/__MACOSX/*" > /dev/null

echo "Built $(pwd)/$OUT"
unzip -l "$OUT"
