#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/unpacked"

echo "Building Boring Download Manager (BDM) Browser Extension..."

# 1. Copy files to unpacked distribution
cp "$SCRIPT_DIR/manifest.json" "$DIST_DIR/unpacked/"
cp "$SCRIPT_DIR/background.js" "$DIST_DIR/unpacked/"
cp "$SCRIPT_DIR/content.js" "$DIST_DIR/unpacked/"
cp "$SCRIPT_DIR/content.css" "$DIST_DIR/unpacked/"
cp -r "$SCRIPT_DIR/icons" "$DIST_DIR/unpacked/"
cp -r "$SCRIPT_DIR/popup" "$DIST_DIR/unpacked/"

# 2. Package Chrome / Chromium / Brave ZIP
(
  cd "$DIST_DIR/unpacked"
  zip -q -r "$DIST_DIR/bdm-chrome.zip" .
  cp "$DIST_DIR/bdm-chrome.zip" "$DIST_DIR/odm-chrome.zip"
)
echo "  ✓ Generated Chrome / Chromium package: $DIST_DIR/bdm-chrome.zip"

# 3. Package Firefox / Zen Browser XPI & ZIP
(
  cd "$DIST_DIR/unpacked"
  zip -q -r "$DIST_DIR/bdm-firefox.xpi" .
  cp "$DIST_DIR/bdm-firefox.xpi" "$DIST_DIR/bdm-firefox.zip"
  cp "$DIST_DIR/bdm-firefox.xpi" "$DIST_DIR/odm-firefox.xpi"
  cp "$DIST_DIR/bdm-firefox.xpi" "$DIST_DIR/odm-firefox.zip"
)
echo "  ✓ Generated Firefox / Zen package: $DIST_DIR/bdm-firefox.xpi"

# 4. Copy to Zen profile extensions directory for direct load
for zen_ext in "$HOME/.config/zen/"*"/extensions"; do
  if [ -d "$zen_ext" ]; then
    cp -f "$DIST_DIR/bdm-firefox.xpi" "$zen_ext/bdm-extension@omarchy.org.xpi"
    echo "  ✓ Copied to Zen profile: $zen_ext"
  fi
done

echo "BDM Extension Packaging Complete!"
ls -la "$DIST_DIR"
