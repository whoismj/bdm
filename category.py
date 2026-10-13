"""
File categorization and directory resolution for Boring Download Manager (BDM).
"""

import os
from typing import Tuple

DEFAULT_DIRECTORIES = {
    "Compressed": os.path.expanduser("~/Downloads/Compressed"),
    "Documents": os.path.expanduser("~/Downloads/Documents"),
    "Music": os.path.expanduser("~/Downloads/Music"),
    "Video": os.path.expanduser("~/Downloads/Videos"),
    "Programs": os.path.expanduser("~/Downloads/Programs"),
    "Images": os.path.expanduser("~/Downloads/Images"),
    "Other": os.path.expanduser("~/Downloads"),
}

EXTENSIONS = {
    "Compressed": {".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz", ".zst", ".tgz", ".tbz2", ".iso"},
    "Documents": {".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt", ".epub", ".mobi", ".csv", ".xls", ".xlsx", ".ppt", ".pptx", ".md"},
    "Music": {".mp3", ".flac", ".wav", ".aac", ".ogg", ".m4a", ".opus", ".wma", ".alac"},
    "Video": {".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".wmv", ".m4v", ".ts"},
    "Programs": {".deb", ".rpm", ".appimage", ".exe", ".msi", ".apk", ".pkg", ".run", ".bin", ".sh"},
    "Images": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff", ".avif"},
}

CATEGORY_ICONS = {
    "All": "folder-download-symbolic",
    "Compressed": "package-x-generic-symbolic",
    "Documents": "x-office-document-symbolic",
    "Music": "audio-x-generic-symbolic",
    "Video": "video-x-generic-symbolic",
    "Programs": "application-x-executable-symbolic",
    "Images": "image-x-generic-symbolic",
    "Other": "folder-symbolic",
}


def detect_category(filename: str) -> str:
    _, ext = os.path.splitext(filename.lower())
    for category, exts in EXTENSIONS.items():
        if ext in exts:
            return category
    return "Other"


def get_category_dir(category: str) -> str:
    dir_path = DEFAULT_DIRECTORIES.get(category, os.path.expanduser("~/Downloads"))
    os.makedirs(dir_path, exist_ok=True)
    return dir_path


def get_save_path(filename: str, category: str = None) -> Tuple[str, str]:
    if not category:
        category = detect_category(filename)
    target_dir = get_category_dir(category)
    base, ext = os.path.splitext(filename)
    dest_path = os.path.join(target_dir, filename)
    counter = 1
    while os.path.exists(dest_path):
        dest_path = os.path.join(target_dir, f"{base} ({counter}){ext}")
        counter += 1
    return target_dir, dest_path
