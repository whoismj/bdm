#!/usr/bin/env bash
# ==============================================================================
# Boring Download Manager (BDM) — Installer for Arch Linux & Derivatives
# https://github.com/whoismj/bdm
# ==============================================================================

set -euo pipefail

# ANSI Colors
BOLD="\033[1m"
GREEN="\033[1;32m"
CYAN="\033[1;36m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
MUTED="\033[0;37m"
RESET="\033[0m"

echo -e "${CYAN}${BOLD}"
echo "  ____  _____  __  __ "
echo " | __ )|  _  \|  \/  |"
echo " |  _ \| | | | |\/| |  Boring Download Manager (BDM)"
echo " | |_) | |_| | |  | |  Rock-solid multi-stream download acceleration"
echo " |____/|_____/|_|  |_|  for Arch Linux"
echo -e "${RESET}"

# Determine target directories (System-wide if root, User-level if normal user)
if [[ $EUID -eq 0 ]]; then
  INSTALL_MODE="system"
  PREFIX="/usr"
  APP_DIR="/usr/lib/bdm"
  BIN_DIR="/usr/bin"
  DESKTOP_DIR="/usr/share/applications"
  ICON_DIR="/usr/share/icons/hicolor"
  SYSTEMD_DIR="/usr/lib/systemd/user"
  echo -e "${YELLOW}Installing system-wide to ${PREFIX}...${RESET}"
else
  INSTALL_MODE="user"
  PREFIX="$HOME/.local"
  APP_DIR="$HOME/.local/share/bdm"
  BIN_DIR="$HOME/.local/bin"
  DESKTOP_DIR="$HOME/.local/share/applications"
  ICON_DIR="$HOME/.local/share/icons/hicolor"
  SYSTEMD_DIR="$HOME/.config/systemd/user"
  echo -e "${CYAN}Installing for current user to ${PREFIX}...${RESET}"
fi

# 1. Dependency Check
echo -e "\n${BOLD}[1/5] Checking dependencies...${RESET}"
MISSING_DEPS=()
for dep in electron python python-requests yt-dlp ffmpeg; do
  case "$dep" in
    electron)
      command -v electron >/dev/null 2>&1 || MISSING_DEPS+=("electron")
      ;;
    python)
      command -v python3 >/dev/null 2>&1 || MISSING_DEPS+=("python")
      ;;
    python-requests)
      python3 -c "import requests" >/dev/null 2>&1 || MISSING_DEPS+=("python-requests")
      ;;
    yt-dlp)
      command -v yt-dlp >/dev/null 2>&1 || MISSING_DEPS+=("yt-dlp")
      ;;
    ffmpeg)
      command -v ffmpeg >/dev/null 2>&1 || MISSING_DEPS+=("ffmpeg")
      ;;
  esac
done

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
  echo -e "${YELLOW}Missing packages: ${MISSING_DEPS[*]}${RESET}"
  if command -v pacman >/dev/null 2>&1; then
    echo -e "Installing missing dependencies via pacman..."
    if [[ $EUID -eq 0 ]]; then
      pacman -S --needed --noconfirm "${MISSING_DEPS[@]}"
    else
      sudo pacman -S --needed --noconfirm "${MISSING_DEPS[@]}"
    fi
  else
    echo -e "${RED}Warning: pacman not found. Please ensure dependencies are installed.${RESET}"
  fi
else
  echo -e "${GREEN}✓ All dependencies satisfied (electron, python, requests, yt-dlp, ffmpeg).${RESET}"
fi

# 2. Source resolution
SCRIPT_SRC="${BASH_SOURCE[0]:-}"
if [ -n "$SCRIPT_SRC" ] && [ "$SCRIPT_SRC" != "bash" ] && [ "$SCRIPT_SRC" != "-" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SRC")" && pwd)"
else
  SCRIPT_DIR=""
fi

if [ -z "$SCRIPT_DIR" ] || { [ ! -f "$SCRIPT_DIR/main.js" ] && [ ! -f "$SCRIPT_DIR/daemon.py" ]; }; then
  # Running from curl/pipe or temporary clone
  TMP_REPO="/tmp/bdm-git-install"
  echo -e "Cloning latest release from GitHub..."
  rm -rf "$TMP_REPO"
  git clone --depth=1 https://github.com/whoismj/bdm.git "$TMP_REPO"
  SCRIPT_DIR="$TMP_REPO"
fi

# 3. Copy Application Files
echo -e "\n${BOLD}[2/5] Installing application files...${RESET}"
mkdir -p "$APP_DIR" "$BIN_DIR" "$DESKTOP_DIR" "$SYSTEMD_DIR"

# Copy source trees
rsync -a --delete \
  --exclude=".git" \
  --exclude="__pycache__" \
  --exclude="*.db" \
  --exclude="*.log" \
  --exclude="assets/screenshots" \
  "$SCRIPT_DIR/" "$APP_DIR/"

# Make scripts executable
chmod +x "$APP_DIR/daemon.py" "$APP_DIR/cli.py" "$APP_DIR/browser_integration.py"
if [ -f "$APP_DIR/browser-extension/host/bdm-native-host" ]; then
  chmod +x "$APP_DIR/browser-extension/host/bdm-native-host"
fi

# 4. Create Binary Launcher
echo -e "\n${BOLD}[3/5] Setting up launcher symlinks...${RESET}"
cat << 'EOF' > "$BIN_DIR/bdm"
#!/usr/bin/env bash
# Boring Download Manager (BDM) Launcher
APP_DIR="$(dirname "$(realpath "$0")")/../share/bdm"
if [ ! -d "$APP_DIR" ]; then
  APP_DIR="/usr/lib/bdm"
fi
if [ ! -d "$APP_DIR" ]; then
  APP_DIR="$HOME/.local/share/bdm"
fi

exec python3 "$APP_DIR/cli.py" "$@"
EOF
chmod +x "$BIN_DIR/bdm"

# Backward compatibility symlink for odm
ln -sf "$BIN_DIR/bdm" "$BIN_DIR/odm" 2>/dev/null || true

# 5. Desktop Entry & Icons
echo -e "\n${BOLD}[4/5] Installing desktop integration and icons...${RESET}"
cp -f "$APP_DIR/assets/bdm.desktop" "$DESKTOP_DIR/bdm.desktop"

# Install scalable SVG icon
mkdir -p "$ICON_DIR/scalable/apps"
cp -f "$APP_DIR/assets/icon.svg" "$ICON_DIR/scalable/apps/bdm.svg"

# Install PNG icons
for sz in 16 32 48 64 128 256 512; do
  if [ -f "$APP_DIR/assets/icons/bdm-${sz}.png" ]; then
    mkdir -p "$ICON_DIR/${sz}x${sz}/apps"
    cp -f "$APP_DIR/assets/icons/bdm-${sz}.png" "$ICON_DIR/${sz}x${sz}/apps/bdm.png"
  fi
done

# Install Systemd user service
if [ -f "$APP_DIR/systemd/bdm.service" ]; then
  sed "s|ExecStart=.*|ExecStart=$BIN_DIR/bdm gui|" "$APP_DIR/systemd/bdm.service" > "$SYSTEMD_DIR/bdm.service"
fi

# Update caches
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f "$ICON_DIR" 2>/dev/null || true
fi

# 6. Automatic Browser Extension Integration
echo -e "\n${BOLD}[5/5] Auto-detecting and configuring browsers...${RESET}"
python3 "$APP_DIR/browser_integration.py" --install-all || true

echo -e "\n${GREEN}${BOLD}══════════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD} ✓ Boring Download Manager (BDM) successfully installed!${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════════${RESET}"
echo -e "
  ${BOLD}Quick Start:${RESET}
    ${CYAN}bdm${RESET}                     Open BDM GUI
    ${CYAN}bdm add <URL>${RESET}           Add download (CLI)
    ${CYAN}bdm add <URL> --gui${RESET}     Add download in GUI window
    ${CYAN}bdm settings${RESET}            Open Settings & Browser Integration
    ${CYAN}bdm extensions status${RESET}   Check browser extension status
    ${CYAN}bdm list${RESET}                List downloads in terminal

  ${MUTED}Desktop App:${RESET} Search for 'BDM' or 'Boring Download Manager' in your app launcher.
"
