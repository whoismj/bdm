#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_EXEC="$SCRIPT_DIR/bdm-native-host"
FF_MANIFEST="$SCRIPT_DIR/com.boring.dm.firefox.json"
CHROME_MANIFEST="$SCRIPT_DIR/com.boring.dm.chrome.json"

chmod +x "$HOST_EXEC"

echo "Installing BDM Native Messaging Host..."

# 1. Mozilla / Firefox / Zen Browser
MOZILLA_DIR="$HOME/.mozilla/native-messaging-hosts"
mkdir -p "$MOZILLA_DIR"
cp -f "$FF_MANIFEST" "$MOZILLA_DIR/com.boring.dm.json"
echo "  ✓ Installed Firefox / Zen manifest: $MOZILLA_DIR/com.boring.dm.json"

# 2. Google Chrome
CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
mkdir -p "$CHROME_DIR"
cp -f "$CHROME_MANIFEST" "$CHROME_DIR/com.boring.dm.json"
echo "  ✓ Installed Google Chrome manifest: $CHROME_DIR/com.boring.dm.json"

# 3. Chromium
CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
mkdir -p "$CHROMIUM_DIR"
cp -f "$CHROME_MANIFEST" "$CHROMIUM_DIR/com.boring.dm.json"
echo "  ✓ Installed Chromium manifest: $CHROMIUM_DIR/com.boring.dm.json"

# 4. Brave Browser
BRAVE_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
mkdir -p "$BRAVE_DIR"
cp -f "$CHROME_MANIFEST" "$BRAVE_DIR/com.boring.dm.json"
echo "  ✓ Installed Brave manifest: $BRAVE_DIR/com.boring.dm.json"

echo "BDM Native Messaging Host successfully installed for all browsers!"
