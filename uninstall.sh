#!/usr/bin/env bash
# ==============================================================================
# Boring Download Manager (BDM) — Uninstaller
# https://github.com/whoismj/bdm
# ==============================================================================

set -euo pipefail

echo "Uninstalling Boring Download Manager (BDM)..."

# Determine target directories
if [[ $EUID -eq 0 ]]; then
  INSTALL_MODE="system"
  APP_DIR="/usr/lib/bdm"
  BIN_DIR="/usr/bin"
  DESKTOP_DIR="/usr/share/applications"
  ICON_DIR="/usr/share/icons/hicolor"
  SYSTEMD_DIR="/usr/lib/systemd/user"
else
  INSTALL_MODE="user"
  APP_DIR="$HOME/.local/share/bdm"
  BIN_DIR="$HOME/.local/bin"
  DESKTOP_DIR="$HOME/.local/share/applications"
  ICON_DIR="$HOME/.local/share/icons/hicolor"
  SYSTEMD_DIR="$HOME/.config/systemd/user"
fi

# Stop systemd service if running
systemctl --user stop bdm 2>/dev/null || true
systemctl --user disable bdm 2>/dev/null || true
systemctl --user stop omarchy-dm 2>/dev/null || true
systemctl --user disable omarchy-dm 2>/dev/null || true

# Remove binaries and symlinks
rm -f "$BIN_DIR/bdm" "$BIN_DIR/odm"

# Remove desktop entry
rm -f "$DESKTOP_DIR/bdm.desktop" "$DESKTOP_DIR/omarchy-dm.desktop" "$DESKTOP_DIR/odm.desktop"

# Remove icons
rm -f "$ICON_DIR/scalable/apps/bdm.svg" "$ICON_DIR/scalable/apps/omarchy-dm.svg"
for sz in 16 32 48 64 128 256 512; do
  rm -f "$ICON_DIR/${sz}x${sz}/apps/bdm.png" "$ICON_DIR/${sz}x${sz}/apps/omarchy-dm.png"
done

# Remove systemd unit
rm -f "$SYSTEMD_DIR/bdm.service" "$SYSTEMD_DIR/omarchy-dm.service"
systemctl --user daemon-reload 2>/dev/null || true

# Remove runtime sockets
rm -f "${XDG_RUNTIME_DIR:-/run/user/$EUID}/bdm.sock" "${XDG_RUNTIME_DIR:-/run/user/$EUID}/omarchy-dm.sock"

# Remove application directory
rm -rf "$APP_DIR"
if [ "$INSTALL_MODE" = "user" ]; then
  rm -rf "$HOME/.local/share/omarchy-dm"
fi

# Clean caches
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f "$ICON_DIR" 2>/dev/null || true
fi

echo "✓ BDM application successfully uninstalled."
echo "Note: Your downloaded files and download history in ~/.local/share/bdm remain intact."
