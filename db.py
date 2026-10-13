"""
Database persistence layer for Boring Download Manager (BDM).
Stores download items, segments, and application configuration using SQLite.
"""

import os
import sqlite3
import json
import time
from typing import List, Dict, Optional, Any

DATA_DIR = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
LEGACY_DIR = os.path.join(DATA_DIR, "omarchy-dm")
BDM_DIR = os.path.join(DATA_DIR, "bdm")

# Use legacy directory if it already has the database, otherwise use clean bdm dir
if os.path.exists(os.path.join(LEGACY_DIR, "downloads.db")) and not os.path.exists(os.path.join(BDM_DIR, "downloads.db")):
    DB_DIR = LEGACY_DIR
else:
    DB_DIR = BDM_DIR

DB_PATH = os.path.join(DB_DIR, "downloads.db")


def get_db_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(DB_DIR, exist_ok=True)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                filename TEXT NOT NULL,
                save_dir TEXT NOT NULL,
                save_path TEXT NOT NULL,
                total_size INTEGER DEFAULT 0,
                downloaded_size INTEGER DEFAULT 0,
                status TEXT NOT NULL, -- queued, downloading, paused, completed, error
                category TEXT NOT NULL, -- Compressed, Documents, Music, Video, Programs, Images, Other
                num_connections INTEGER DEFAULT 8,
                supports_ranges INTEGER DEFAULT 1,
                is_media INTEGER DEFAULT 0,
                speed REAL DEFAULT 0,
                eta INTEGER DEFAULT 0,
                error_message TEXT DEFAULT '',
                created_at REAL NOT NULL,
                completed_at REAL DEFAULT 0,
                extra_meta TEXT DEFAULT '{}'
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        conn.commit()


def save_download(download_dict: Dict[str, Any]):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO downloads (
                id, url, filename, save_dir, save_path, total_size,
                downloaded_size, status, category, num_connections,
                supports_ranges, is_media, speed, eta, error_message,
                created_at, completed_at, extra_meta
            ) VALUES (
                :id, :url, :filename, :save_dir, :save_path, :total_size,
                :downloaded_size, :status, :category, :num_connections,
                :supports_ranges, :is_media, :speed, :eta, :error_message,
                :created_at, :completed_at, :extra_meta
            )
            ON CONFLICT(id) DO UPDATE SET
                filename = excluded.filename,
                save_dir = excluded.save_dir,
                save_path = excluded.save_path,
                total_size = excluded.total_size,
                downloaded_size = excluded.downloaded_size,
                status = excluded.status,
                category = excluded.category,
                num_connections = excluded.num_connections,
                supports_ranges = excluded.supports_ranges,
                is_media = excluded.is_media,
                speed = excluded.speed,
                eta = excluded.eta,
                error_message = excluded.error_message,
                completed_at = excluded.completed_at,
                extra_meta = excluded.extra_meta
        """, download_dict)
        conn.commit()


def get_all_downloads() -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM downloads ORDER BY created_at DESC")
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_download(download_id: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM downloads WHERE id = ?", (download_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def delete_download(download_id: str):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM downloads WHERE id = ?", (download_id,))
        conn.commit()


def get_setting(key: str, default: Any = None) -> Any:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = cursor.fetchone()
        if row:
            try:
                return json.loads(row["value"])
            except Exception:
                return row["value"]
        return default


def set_setting(key: str, value: Any):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        val_str = json.dumps(value)
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, val_str))
        conn.commit()
