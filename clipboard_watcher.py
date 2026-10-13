"""
Wayland clipboard watcher for Omarchy Download Manager.
Monitors clipboard for downloadable links using wl-paste.
"""

import subprocess
import threading
import time
import re
import urllib.parse
from typing import Callable, Optional

URL_REGEX = re.compile(r"^(https?://[^\s/$.?#].[^\s]*)$", re.IGNORECASE)

DOWNLOAD_EXTS = {
    ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz", ".zst", ".tgz", ".iso",
    ".pdf", ".doc", ".docx", ".epub",
    ".mp3", ".flac", ".wav", ".aac", ".ogg", ".m4a",
    ".mp4", ".mkv", ".webm", ".avi", ".mov",
    ".deb", ".rpm", ".appimage", ".exe", ".bin",
    ".png", ".jpg", ".jpeg", ".gif", ".webp"
}

MEDIA_HOSTS = {
    "youtube.com", "youtu.be", "vimeo.com", "twitch.tv", "twitter.com", "x.com",
    "reddit.com", "soundcloud.com", "tiktok.com", "instagram.com"
}


class ClipboardWatcher:
    def __init__(self, on_url_detected: Callable[[str], None]):
        self.callback = on_url_detected
        self.enabled = True
        self.last_url = ""
        self._thread: Optional[threading.Thread] = None
        self._running = False

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._watch_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def _is_downloadable_url(self, url: str) -> bool:
        parsed = urllib.parse.urlparse(url)
        path = parsed.path.lower()
        domain = parsed.netloc.lower()

        # Check media hosts
        if any(host in domain for host in MEDIA_HOSTS):
            return True

        # Check file extension
        for ext in DOWNLOAD_EXTS:
            if path.endswith(ext):
                return True

        return False

    def _watch_loop(self):
        while self._running:
            if not self.enabled:
                time.sleep(1.0)
                continue

            try:
                res = subprocess.run(
                    ["wl-paste", "--no-newline"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=2
                )
                if res.returncode == 0:
                    text = res.stdout.strip()
                    if text and text != self.last_url and URL_REGEX.match(text):
                        if self._is_downloadable_url(text):
                            self.last_url = text
                            self.callback(text)
            except Exception:
                pass

            time.sleep(1.2)
