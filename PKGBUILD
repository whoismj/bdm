# Maintainer: Mj <https://github.com/whoismj>
pkgname=bdm-git
_pkgname=bdm
pkgver=2.0.0
pkgrel=1
pkgdesc="Boring Download Manager (BDM) — Fast, rock-solid multi-stream download acceleration with automatic browser integration"
arch=('any')
url="https://github.com/whoismj/bdm"
license=('MIT')
depends=(
  'electron'
  'python'
  'python-requests'
  'yt-dlp'
  'ffmpeg'
  'libnotify'
)
makedepends=('git')
provides=('bdm')
conflicts=('bdm')
source=("git+https://github.com/whoismj/bdm.git")
sha256sums=('SKIP')

pkgver() {
  cd "${srcdir}/${_pkgname}"
  git describe --long --tags 2>/dev/null | sed 's/^v//;s/\([^-]*-g\)/r\1/;s/-/./g' || echo "2.0.0.r$(git rev-list --count HEAD).$(git rev-parse --short HEAD)"
}

package() {
  cd "${srcdir}/${_pkgname}"

  # 1. Install application files
  install -d "${pkgdir}/usr/lib/bdm"
  cp -r . "${pkgdir}/usr/lib/bdm/"
  rm -rf "${pkgdir}/usr/lib/bdm/.git"

  # Ensure scripts are executable
  chmod +x "${pkgdir}/usr/lib/bdm/daemon.py"
  chmod +x "${pkgdir}/usr/lib/bdm/cli.py"
  chmod +x "${pkgdir}/usr/lib/bdm/browser_integration.py"
  if [ -f "${pkgdir}/usr/lib/bdm/browser-extension/host/bdm-native-host" ]; then
    chmod +x "${pkgdir}/usr/lib/bdm/browser-extension/host/bdm-native-host"
  fi

  # 2. Binary Launcher
  install -d "${pkgdir}/usr/bin"
  cat << 'EOF' > "${pkgdir}/usr/bin/bdm"
#!/bin/sh
exec python3 /usr/lib/bdm/cli.py "$@"
EOF
  chmod +x "${pkgdir}/usr/bin/bdm"
  ln -sf /usr/bin/bdm "${pkgdir}/usr/bin/odm"

  # 3. Desktop Application Entry
  install -Dm644 assets/bdm.desktop "${pkgdir}/usr/share/applications/bdm.desktop"

  # 4. Hicolor Icons
  install -Dm644 assets/icon.svg "${pkgdir}/usr/share/icons/hicolor/scalable/apps/bdm.svg"
  for sz in 16 32 48 64 128 256 512; do
    if [ -f "assets/icons/bdm-${sz}.png" ]; then
      install -Dm644 "assets/icons/bdm-${sz}.png" "${pkgdir}/usr/share/icons/hicolor/${sz}x${sz}/apps/bdm.png"
    fi
  done

  # 5. Systemd user service
  if [ -f "systemd/bdm.service" ]; then
    install -Dm644 systemd/bdm.service "${pkgdir}/usr/lib/systemd/user/bdm.service"
  fi

  # 6. License
  if [ -f "LICENSE" ]; then
    install -Dm644 LICENSE "${pkgdir}/usr/share/licenses/${pkgname}/LICENSE"
  fi
}
