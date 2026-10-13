"""
High-performance multi-segment download engine with yt-dlp media extraction.
Engineered to deliver IDM-grade parallel downloads and reliability on Linux.
"""

import os
import sys
import time
import math
import uuid
import json
import shutil
import urllib.parse
import threading
import subprocess
from typing import Dict, List, Optional, Callable, Any
import requests

from db import save_download, get_download, set_setting, get_setting
from category import detect_category, get_save_path

DEFAULT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"


class Segment:
    def __init__(self, index: int, start_byte: int, end_byte: int):
        self.index = index
        self.start_byte = start_byte
        self.end_byte = end_byte
        self.total_bytes = end_byte - start_byte + 1 if end_byte >= start_byte else 0
        self.downloaded_bytes = 0
        self.status = "waiting"  # waiting, downloading, completed, error
        self.speed = 0.0  # bytes/sec

    @property
    def progress(self) -> float:
        if self.total_bytes <= 0:
            return 0.0
        return min(1.0, self.downloaded_bytes / self.total_bytes)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "index": self.index,
            "start": self.start_byte,
            "end": self.end_byte,
            "total": self.total_bytes,
            "downloaded": self.downloaded_bytes,
            "progress": self.progress,
            "status": self.status,
            "speed": self.speed,
        }


class DownloadTask:
    def __init__(
        self,
        task_id: str,
        url: str,
        filename: str,
        save_dir: str,
        save_path: str,
        category: str = "Other",
        num_connections: int = 8,
        total_size: int = 0,
        is_media: bool = False,
        extra_meta: Optional[Dict[str, Any]] = None,
    ):
        self.id = task_id
        self.url = url
        self.filename = filename
        self.save_dir = save_dir
        self.save_path = save_path
        self.category = category
        self.num_connections = num_connections
        self.total_size = total_size
        self.downloaded_size = 0
        self.is_media = is_media
        self.supports_ranges = True
        self.status = "queued"  # queued, downloading, paused, completed, error
        self.speed = 0.0
        self.eta = 0
        self.error_message = ""
        self.created_at = time.time()
        self.completed_at = 0.0
        self.extra_meta = extra_meta or {}

        self.segments: List[Segment] = []
        self._stop_event = threading.Event()
        self._worker_threads: List[threading.Thread] = []
        self._media_proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._last_speed_check = time.time()
        self._last_downloaded = 0
        self.listeners: List[Callable[["DownloadTask"], None]] = []

    def add_listener(self, callback: Callable[["DownloadTask"], None]):
        with self._lock:
            if callback not in self.listeners:
                self.listeners.append(callback)

    def remove_listener(self, callback: Callable[["DownloadTask"], None]):
        with self._lock:
            if callback in self.listeners:
                self.listeners.remove(callback)

    def notify_update(self):
        listeners = list(self.listeners)
        for listener in listeners:
            try:
                listener(self)
            except Exception:
                pass

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "url": self.url,
            "filename": self.filename,
            "save_dir": self.save_dir,
            "save_path": self.save_path,
            "total_size": self.total_size,
            "downloaded_size": self.downloaded_size,
            "status": self.status,
            "category": self.category,
            "num_connections": self.num_connections,
            "supports_ranges": 1 if self.supports_ranges else 0,
            "is_media": 1 if self.is_media else 0,
            "speed": self.speed,
            "eta": self.eta,
            "error_message": self.error_message,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
            "extra_meta": json.dumps(self.extra_meta),
            "segments": [seg.to_dict() for seg in self.segments],
        }

    def save_state(self):
        data = self.to_dict()
        data.pop("segments", None)
        save_download(data)


class DownloadEngine:
    def __init__(self):
        self.tasks: Dict[str, DownloadTask] = {}
        self.active_tasks_lock = threading.Lock()
        self.max_concurrent_downloads = 3
        self.speed_limit = 0  # bytes/sec (0 = unlimited)
        self.on_download_complete: Optional[Callable[[DownloadTask], None]] = None
        self._monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._monitor_thread.start()

    def set_speed_limit(self, limit_bytes_per_sec: int):
        self.speed_limit = limit_bytes_per_sec

    def probe_url(self, url: str) -> Dict[str, Any]:
        """Probes a URL to determine filename, size, range support, and content type."""
        # Check media streaming site
        media_info = self._check_ytdlp_url(url)
        if media_info:
            return media_info

        # Standard HTTP probe
        headers = {"User-Agent": DEFAULT_USER_AGENT}
        filename = "download"
        total_size = 0
        supports_ranges = False

        try:
            head_resp = requests.head(url, headers=headers, allow_redirects=True, timeout=10)
            if head_resp.status_code >= 400:
                range_headers = {"User-Agent": DEFAULT_USER_AGENT, "Range": "bytes=0-0"}
                resp = requests.get(url, headers=range_headers, stream=True, timeout=10)
            else:
                resp = head_resp

            # Extract filename from Content-Disposition
            cd = resp.headers.get("Content-Disposition", "")
            if "filename=" in cd:
                parts = cd.split("filename=")
                if len(parts) > 1:
                    raw_fn = parts[1].strip().strip('"').strip("'")
                    if raw_fn:
                        filename = os.path.basename(urllib.parse.unquote(raw_fn))

            if filename == "download":
                parsed = urllib.parse.urlparse(resp.url or url)
                path_fn = os.path.basename(parsed.path)
                if path_fn:
                    filename = urllib.parse.unquote(path_fn)

            # Check Accept-Ranges
            if resp.headers.get("Accept-Ranges", "").lower() == "bytes":
                supports_ranges = True
            elif resp.status_code == 206:
                supports_ranges = True

            # Extract Content-Length
            cl = resp.headers.get("Content-Length")
            cr = resp.headers.get("Content-Range")
            if cr and "/" in cr:
                try:
                    total_size = int(cr.split("/")[1])
                except Exception:
                    pass
            elif cl:
                try:
                    total_size = int(cl)
                except Exception:
                    pass

        except Exception:
            parsed = urllib.parse.urlparse(url)
            path_fn = os.path.basename(parsed.path)
            if path_fn:
                filename = urllib.parse.unquote(path_fn)

        if not filename or filename == "/":
            filename = "download.bin"

        category = detect_category(filename)
        target_dir, save_path = get_save_path(filename, category)

        return {
            "url": url,
            "filename": filename,
            "save_dir": target_dir,
            "save_path": save_path,
            "category": category,
            "total_size": total_size,
            "supports_ranges": supports_ranges,
            "is_media": False,
        }

    def _check_ytdlp_url(self, url: str) -> Optional[Dict[str, Any]]:
        media_domains = [
            "youtube.com", "youtu.be", "vimeo.com", "twitch.tv", "twitter.com", "x.com",
            "reddit.com", "soundcloud.com", "tiktok.com", "instagram.com", "facebook.com", "bilibili.com"
        ]
        parsed = urllib.parse.urlparse(url)
        domain = parsed.netloc.lower()
        if not any(d in domain for d in media_domains):
            return None

        try:
            cmd = ["yt-dlp", "--dump-json", "--no-warnings", "--playlist-items", "1", url]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=25)
            if res.returncode == 0 and res.stdout.strip():
                data = json.loads(res.stdout.split("\n")[0])
                title = data.get("title", "video").replace("/", "_").replace("\\", "_")
                ext = "mp4"  # Force MP4 container
                filename = f"{title}.{ext}"
                category = "Video"
                target_dir, save_path = get_save_path(filename, category)

                # Extract available video resolutions
                formats = data.get("formats", [])
                heights = set()
                for f in formats:
                    h = f.get("height")
                    if h and isinstance(h, int) and h >= 144:
                        heights.add(h)

                labels_map = {
                    2160: "2160p (4K UHD) • MP4",
                    1440: "1440p (2K QHD) • MP4",
                    1080: "1080p (Full HD) • MP4",
                    720: "720p (HD) • MP4",
                    480: "480p (SD) • MP4",
                    360: "360p (SD) • MP4",
                    240: "240p • MP4",
                    144: "144p • MP4",
                }

                qualities = []
                for h in sorted(list(heights), reverse=True):
                    qualities.append({
                        "value": str(h),
                        "label": labels_map.get(h, f"{h}p • MP4"),
                        "height": h,
                        "ext": "mp4"
                    })

                if not qualities:
                    qualities.append({"value": "1080", "label": "1080p (Full HD) • MP4", "height": 1080, "ext": "mp4"})
                    qualities.append({"value": "720", "label": "720p (HD) • MP4", "height": 720, "ext": "mp4"})
                    qualities.append({"value": "480", "label": "480p • MP4", "height": 480, "ext": "mp4"})

                qualities.insert(0, {"value": "best", "label": "Best Quality • MP4", "height": 9999, "ext": "mp4"})
                qualities.append({"value": "audio", "label": "Audio Only (M4A / MP3)", "height": 0, "ext": "m4a"})

                return {
                    "url": url,
                    "filename": filename,
                    "save_dir": target_dir,
                    "save_path": save_path,
                    "category": category,
                    "total_size": data.get("filesize") or data.get("filesize_approx") or 0,
                    "supports_ranges": True,
                    "is_media": True,
                    "media_title": title,
                    "duration": data.get("duration", 0),
                    "thumbnail": data.get("thumbnail", ""),
                    "qualities": qualities,
                }
        except Exception:
            pass
        return None

    def create_task(
        self,
        url: str,
        filename: Optional[str] = None,
        save_path: Optional[str] = None,
        category: Optional[str] = None,
        num_connections: int = 8,
        is_media: bool = False,
        extra_meta: Optional[Dict[str, Any]] = None,
    ) -> DownloadTask:
        task_id = str(uuid.uuid4())[:8]

        # If caller already provided filename and metadata, skip slow redundant probe
        if filename:
            fn = filename
            cat = category or detect_category(fn)
            if save_path:
                sp = save_path
                sdir = os.path.dirname(save_path)
            else:
                sdir, sp = get_save_path(fn, cat)
            meta = extra_meta or {}
            tot_size = meta.get("total_size", 0)
            is_med = is_media or meta.get("is_media", False) or (cat == "Video" and any(d in url for d in ["youtube", "youtu.be"]))
            supports_ranges = meta.get("supports_ranges", True)
        else:
            probe = self.probe_url(url)
            fn = probe["filename"]
            cat = category or probe["category"]
            if save_path:
                sp = save_path
                sdir = os.path.dirname(save_path)
            else:
                sdir, sp = get_save_path(fn, cat)
            meta = extra_meta or probe
            tot_size = probe.get("total_size", 0)
            is_med = is_media or probe.get("is_media", False)
            supports_ranges = probe.get("supports_ranges", True)

        task = DownloadTask(
            task_id=task_id,
            url=url,
            filename=fn,
            save_dir=sdir,
            save_path=sp,
            category=cat,
            num_connections=num_connections,
            total_size=tot_size,
            is_media=is_med,
            extra_meta=meta,
        )
        task.supports_ranges = supports_ranges

        with self.active_tasks_lock:
            self.tasks[task_id] = task

        task.save_state()
        return task

    def start_task(self, task_id: str):
        task = self.tasks.get(task_id)
        if not task:
            return
        if task.status == "downloading":
            return

        task.status = "downloading"
        task._stop_event.clear()
        task.error_message = ""
        task.save_state()
        task.notify_update()

        if task.is_media:
            t = threading.Thread(target=self._run_media_download, args=(task,), daemon=True)
        else:
            t = threading.Thread(target=self._run_segmented_download, args=(task,), daemon=True)
        t.start()

    def pause_task(self, task_id: str):
        task = self.tasks.get(task_id)
        if not task:
            return
        task._stop_event.set()
        if task._media_proc:
            try:
                task._media_proc.terminate()
            except Exception:
                pass
        task.status = "paused"
        task.speed = 0.0
        task.save_state()
        task.notify_update()

    def delete_task(self, task_id: str, delete_files: bool = False):
        self.pause_task(task_id)
        task = self.tasks.get(task_id)
        if task:
            if delete_files:
                if os.path.exists(task.save_path):
                    try:
                        os.remove(task.save_path)
                    except Exception:
                        pass
                for i in range(max(32, task.num_connections)):
                    part_file = f"{task.save_path}.part{i}"
                    if os.path.exists(part_file):
                        try:
                            os.remove(part_file)
                        except Exception:
                            pass
            with self.active_tasks_lock:
                self.tasks.pop(task_id, None)
            from db import delete_download
            delete_download(task_id)

    def _run_media_download(self, task: DownloadTask):
        """Downloads streaming video/audio via yt-dlp with mp4 muxing, quality selection, and real-time progress parsing."""
        os.makedirs(task.save_dir, exist_ok=True)
        out_tmpl = os.path.join(task.save_dir, "%(title)s.%(ext)s")

        quality = "best"
        if task.extra_meta:
            quality = task.extra_meta.get("quality", "best")

        # Initialize virtual streams for IDM visualizer blocks
        seg_video = Segment(0, 0, max(1, int(task.total_size * 0.85) if task.total_size > 0 else 1000000))
        seg_audio = Segment(1, 0, max(1, int(task.total_size * 0.15) if task.total_size > 0 else 200000))
        seg_video.status = "downloading"
        seg_audio.status = "waiting"
        task.segments = [seg_video, seg_audio]

        if quality == "audio":
            cmd = [
                "yt-dlp",
                "--newline",
                "--progress",
                "--progress-template", "%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s",
                "--print", "after_move:filepath",
                "-x", "--audio-format", "m4a",
                "-o", out_tmpl,
                task.url,
            ]
        elif quality == "best":
            cmd = [
                "yt-dlp",
                "--newline",
                "--progress",
                "--progress-template", "%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s",
                "--print", "after_move:filepath",
                "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
                "--merge-output-format", "mp4",
                "-o", out_tmpl,
                task.url,
            ]
        else:
            max_h = int(quality) if str(quality).isdigit() else 1080
            format_spec = f"bestvideo[height<={max_h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={max_h}]+bestaudio/best[height<={max_h}]/best"
            cmd = [
                "yt-dlp",
                "--newline",
                "--progress",
                "--progress-template", "%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s",
                "--print", "after_move:filepath",
                "-f", format_spec,
                "--merge-output-format", "mp4",
                "-o", out_tmpl,
                task.url,
            ]

        final_filepath = ""
        current_stream = 0
        last_downloaded = 0
        stream1_bytes = 0

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True
            )
            task._media_proc = proc

            for line in proc.stdout:
                if task._stop_event.is_set():
                    proc.terminate()
                    return

                line = line.strip()
                if not line:
                    continue

                if line.startswith("/") and os.path.exists(line):
                    final_filepath = line
                elif "[download] Destination:" in line:
                    # Switch stream tracking
                    if "video" in line.lower() or current_stream == 0:
                        pass
                    else:
                        current_stream = 1
                        seg_video.status = "completed"
                        seg_video.downloaded_bytes = seg_video.total_bytes
                        seg_audio.status = "downloading"
                elif "|" in line:
                    parts = line.split("|")
                    if len(parts) >= 4:
                        try:
                            raw_dl = int(parts[0]) if parts[0] != "NA" else 0
                            raw_tot = int(parts[1]) if parts[1] != "NA" else 0
                            speed = float(parts[2]) if parts[2] != "NA" else 0.0
                            eta = int(parts[3]) if parts[3] != "NA" else 0

                            # Detect stream transition if raw_dl dropped
                            if raw_dl < last_downloaded and last_downloaded > 100000:
                                current_stream = 1
                                stream1_bytes = last_downloaded
                                seg_video.status = "completed"
                                seg_video.downloaded_bytes = seg_video.total_bytes
                                seg_audio.status = "downloading"

                            last_downloaded = raw_dl

                            if current_stream == 0:
                                seg_video.downloaded_bytes = raw_dl
                                if raw_tot > 0:
                                    seg_video.total_bytes = raw_tot
                                seg_video.speed = speed
                                task.downloaded_size = raw_dl
                            else:
                                seg_audio.downloaded_bytes = raw_dl
                                if raw_tot > 0:
                                    seg_audio.total_bytes = raw_tot
                                seg_audio.speed = speed
                                task.downloaded_size = stream1_bytes + raw_dl

                            if task.total_size <= 0 and raw_tot > 0:
                                task.total_size = raw_tot

                            task.speed = speed
                            task.eta = eta
                            task.notify_update()
                        except Exception:
                            pass

            proc.wait()
            if proc.returncode == 0:
                seg_video.status = "completed"
                seg_video.downloaded_bytes = seg_video.total_bytes
                seg_audio.status = "completed"
                seg_audio.downloaded_bytes = seg_audio.total_bytes

                if final_filepath and os.path.exists(final_filepath):
                    task.save_path = final_filepath
                    task.filename = os.path.basename(final_filepath)
                elif not os.path.exists(task.save_path):
                    base_title = os.path.splitext(task.filename)[0]
                    for f in os.listdir(task.save_dir):
                        if base_title in f:
                            task.save_path = os.path.join(task.save_dir, f)
                            task.filename = f
                            break

                if os.path.exists(task.save_path):
                    task.total_size = os.path.getsize(task.save_path)
                    task.downloaded_size = task.total_size

                task.status = "completed"
                task.completed_at = time.time()
                task.speed = 0.0
                task.eta = 0
                self._send_notification(task)
                if self.on_download_complete:
                    self.on_download_complete(task)
                self._check_queue()
            else:
                if not task._stop_event.is_set():
                    err = proc.stderr.read()
                    task.status = "error"
                    task.error_message = err[:200] if err else "yt-dlp download failed"
        except Exception as e:
            if not task._stop_event.is_set():
                task.status = "error"
                task.error_message = str(e)
        finally:
            task.save_state()
            task.notify_update()

    def _run_segmented_download(self, task: DownloadTask):
        """Runs multi-segment HTTP range download with pause/resume support."""
        os.makedirs(task.save_dir, exist_ok=True)

        if task.total_size <= 0:
            headers = {"User-Agent": DEFAULT_USER_AGENT}
            try:
                r = requests.head(task.url, headers=headers, allow_redirects=True, timeout=10)
                cl = r.headers.get("Content-Length")
                if cl:
                    task.total_size = int(cl)
                if r.headers.get("Accept-Ranges", "").lower() == "bytes":
                    task.supports_ranges = True
                else:
                    task.supports_ranges = False
            except Exception:
                task.supports_ranges = False

        num_segs = task.num_connections if (task.supports_ranges and task.total_size > 1024 * 1024) else 1
        if num_segs > 32:
            num_segs = 32

        if not task.segments or len(task.segments) != num_segs:
            task.segments = []
            if task.total_size > 0 and num_segs > 1:
                chunk_size = task.total_size // num_segs
                for i in range(num_segs):
                    start = i * chunk_size
                    end = (start + chunk_size - 1) if i < num_segs - 1 else (task.total_size - 1)
                    task.segments.append(Segment(i, start, end))
            else:
                task.segments.append(Segment(0, 0, max(0, task.total_size - 1)))

        for seg in task.segments:
            part_path = f"{task.save_path}.part{seg.index}"
            if os.path.exists(part_path):
                existing = os.path.getsize(part_path)
                if seg.total_bytes > 0 and existing >= seg.total_bytes:
                    seg.downloaded_bytes = seg.total_bytes
                    seg.status = "completed"
                else:
                    seg.downloaded_bytes = existing
            else:
                seg.downloaded_bytes = 0

        threads = []
        for seg in task.segments:
            if seg.status != "completed":
                t = threading.Thread(target=self._download_segment_worker, args=(task, seg), daemon=True)
                threads.append(t)
                t.start()

        task._worker_threads = threads
        for t in threads:
            t.join()

        if task._stop_event.is_set():
            return

        all_done = all(seg.status == "completed" and (seg.total_bytes <= 0 or seg.downloaded_bytes >= seg.total_bytes) for seg in task.segments)
        any_err = any(seg.status == "error" for seg in task.segments)

        if all_done:
            try:
                self._assemble_parts(task)
                task.status = "completed"
                task.completed_at = time.time()
                task.speed = 0.0
                task.eta = 0
                if task.total_size > 0:
                    task.downloaded_size = task.total_size
                elif os.path.exists(task.save_path):
                    task.downloaded_size = os.path.getsize(task.save_path)
                    task.total_size = task.downloaded_size
                for seg in task.segments:
                    seg.downloaded_bytes = seg.total_bytes
                    seg.status = "completed"
                    seg.speed = 0.0
                self._send_notification(task)
                if self.on_download_complete:
                    self.on_download_complete(task)
                self._check_queue()
            except Exception as e:
                task.status = "error"
                task.error_message = f"Failed to assemble chunks: {e}"
        elif any_err:
            task.status = "error"
            if not task.error_message:
                task.error_message = "One or more download segments failed"

        task.save_state()
        task.notify_update()

    def _download_segment_worker(self, task: DownloadTask, seg: Segment):
        seg.status = "downloading"
        part_path = f"{task.save_path}.part{seg.index}"
        retries = 0
        max_retries = 10

        while (seg.total_bytes <= 0 or seg.downloaded_bytes < seg.total_bytes) and not task._stop_event.is_set():
            start_offset = seg.start_byte + seg.downloaded_bytes
            end_offset = seg.end_byte

            if seg.total_bytes > 0 and start_offset > end_offset:
                break

            headers = {"User-Agent": DEFAULT_USER_AGENT}
            if task.supports_ranges and seg.total_bytes > 0 and len(task.segments) > 1:
                headers["Range"] = f"bytes={start_offset}-{end_offset}"

            mode = "ab" if seg.downloaded_bytes > 0 else "wb"

            try:
                with requests.get(task.url, headers=headers, stream=True, timeout=15) as response:
                    if response.status_code not in (200, 206):
                        retries += 1
                        if retries >= max_retries:
                            seg.status = "error"
                            task.error_message = f"HTTP {response.status_code}"
                            return
                        time.sleep(0.5)
                        continue

                    with open(part_path, mode) as f:
                        last_time = time.time()
                        bytes_since_last = 0

                        for chunk in response.iter_content(chunk_size=64 * 1024):
                            if task._stop_event.is_set():
                                seg.status = "paused"
                                return

                            if chunk:
                                if seg.total_bytes > 0:
                                    remaining = seg.total_bytes - seg.downloaded_bytes
                                    if remaining <= 0:
                                        break
                                    to_write = chunk[:remaining]
                                else:
                                    to_write = chunk

                                f.write(to_write)
                                clen = len(to_write)
                                seg.downloaded_bytes += clen
                                bytes_since_last += clen

                                now = time.time()
                                elapsed = now - last_time
                                if elapsed >= 0.5:
                                    seg.speed = bytes_since_last / elapsed
                                    last_time = now
                                    bytes_since_last = 0

                                if self.speed_limit > 0:
                                    max_per_seg = self.speed_limit / max(1, len(task.segments))
                                    sleep_time = clen / max_per_seg
                                    time.sleep(min(0.1, sleep_time))

                                if seg.total_bytes > 0 and seg.downloaded_bytes >= seg.total_bytes:
                                    break

                # If single stream with unknown size and stream finished
                if seg.total_bytes <= 0:
                    break

            except Exception as e:
                retries += 1
                if retries >= max_retries:
                    if not task._stop_event.is_set():
                        seg.status = "error"
                        task.error_message = str(e)
                    return
                time.sleep(0.5)

        if task._stop_event.is_set():
            seg.status = "paused"
            seg.speed = 0.0
        elif seg.total_bytes <= 0 or seg.downloaded_bytes >= seg.total_bytes:
            seg.status = "completed"
            seg.speed = 0.0
        else:
            seg.status = "error"
            seg.speed = 0.0

    def _assemble_parts(self, task: DownloadTask):
        if len(task.segments) == 1:
            part_path = f"{task.save_path}.part0"
            if os.path.exists(part_path):
                if os.path.exists(task.save_path):
                    os.remove(task.save_path)
                shutil.move(part_path, task.save_path)
            return

        temp_dest = f"{task.save_path}.assembling"
        with open(temp_dest, "wb") as outfile:
            for seg in task.segments:
                part_path = f"{task.save_path}.part{seg.index}"
                if os.path.exists(part_path):
                    with open(part_path, "rb") as infile:
                        if seg.total_bytes > 0:
                            copied = 0
                            while copied < seg.total_bytes:
                                batch = min(1024 * 1024, seg.total_bytes - copied)
                                data = infile.read(batch)
                                if not data:
                                    break
                                outfile.write(data)
                                copied += len(data)
                        else:
                            shutil.copyfileobj(infile, outfile, length=1024 * 1024)

        if os.path.exists(task.save_path):
            os.remove(task.save_path)
        shutil.move(temp_dest, task.save_path)

        for seg in task.segments:
            part_path = f"{task.save_path}.part{seg.index}"
            if os.path.exists(part_path):
                try:
                    os.remove(part_path)
                except Exception:
                    pass

    def _check_queue(self):
        """Automatically starts next queued download if slots are available."""
        with self.active_tasks_lock:
            active_count = sum(1 for t in self.tasks.values() if t.status == "downloading")
            if active_count < self.max_concurrent_downloads:
                for t in self.tasks.values():
                    if t.status == "queued":
                        self.start_task(t.id)
                        break

    def _send_notification(self, task: DownloadTask):
        try:
            title = "Download Complete"
            msg = f"{task.filename}\nSaved in {task.category}"
            subprocess.run(["notify-send", "-a", "Boring Download Manager", "-i", "folder-download-symbolic", title, msg], check=False)
        except Exception:
            pass

    def _monitor_loop(self):
        while True:
            time.sleep(0.5)
            with self.active_tasks_lock:
                for task in self.tasks.values():
                    if task.status == "downloading":
                        now = time.time()
                        elapsed = now - task._last_speed_check
                        if elapsed >= 0.8:
                            total_downloaded = sum(s.downloaded_bytes for s in task.segments) if task.segments else task.downloaded_size
                            diff = total_downloaded - task._last_downloaded
                            task.downloaded_size = total_downloaded
                            speed = diff / elapsed if elapsed > 0 else 0.0
                            task.speed = max(0.0, speed)
                            task._last_speed_check = now
                            task._last_downloaded = total_downloaded

                            if task.total_size > task.downloaded_size and task.speed > 0:
                                remaining = task.total_size - task.downloaded_size
                                task.eta = int(remaining / task.speed)
                            else:
                                task.eta = 0

                            task.notify_update()
