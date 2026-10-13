"""
Backend daemon process for Boring Download Manager (BDM).
Runs the DownloadEngine, handles persistent SQLite state, IPC socket,
and communicates bidirectionally with Electron via JSON-RPC on stdio.
"""

import os
import sys
import json
import time
import threading

import db
from engine import DownloadEngine, DownloadTask
from ipc import IPCServer
from clipboard_watcher import ClipboardWatcher
from http_bridge import start_http_bridge
import browser_integration

def main():
    try:
        browser_integration.auto_integrate_on_startup()
    except Exception:
        pass

    db.init_db()
    engine = DownloadEngine()
    clip_watcher = None

    def sync_from_db():
        for item in db.get_all_downloads():
            tid = item["id"]
            if tid in engine.tasks:
                t = engine.tasks[tid]
                if t.status != item.get("status"):
                    t.status = item.get("status", t.status)
                if item.get("total_size", 0) > 0 and t.total_size == 0:
                    t.total_size = item.get("total_size", 0)
                if item.get("downloaded_size", 0) > 0 and t.downloaded_size == 0:
                    t.downloaded_size = item.get("downloaded_size", 0)
                continue
            t = DownloadTask(
                task_id=tid,
                url=item["url"],
                filename=item["filename"],
                save_dir=item["save_dir"],
                save_path=item["save_path"],
                category=item["category"],
                num_connections=item.get("num_connections", 8),
                total_size=item.get("total_size", 0),
                is_media=bool(item.get("is_media", 0)),
            )
            t.downloaded_size = item.get("downloaded_size", 0)
            t.status = "paused" if item.get("status") == "downloading" else item.get("status", "paused")
            if t.status == "completed" and t.total_size > 0:
                t.downloaded_size = t.total_size
            t.supports_ranges = bool(item.get("supports_ranges", 1))
            engine.tasks[t.id] = t

    sync_from_db()

    def handle_complete(task: DownloadTask):
        emit({"event": "complete", "task": task.to_dict()})

    engine.on_download_complete = handle_complete

    def emit(data: dict):
        try:
            line = json.dumps(data)
            sys.stdout.write(line + "\n")
            sys.stdout.flush()
        except Exception:
            pass

    # Handle external socket IPC requests (from odm CLI)
    def handle_ipc(req: dict) -> dict:
        action = req.get("action")
        if action == "ping":
            return {"status": "ok"}
        elif action == "add":
            url = req.get("url")
            fn = req.get("filename")
            cat = req.get("category")
            conns = req.get("connections", 8)
            start_now = req.get("start_now", True)
            if not url:
                return {"status": "error", "message": "Missing URL"}
            quality = req.get("quality", "best")
            task = engine.create_task(
                url,
                filename=fn,
                category=cat,
                num_connections=conns,
                extra_meta={"quality": quality}
            )
            if start_now:
                engine.start_task(task.id)
            emit({"event": "task_added", "task": task.to_dict()})
            return {"status": "ok", "task": task.to_dict()}
        elif action == "list":
            sync_from_db()
            return {"status": "ok", "downloads": [t.to_dict() for t in engine.tasks.values()]}
        elif action == "pause":
            tid = req.get("id")
            if tid and tid in engine.tasks:
                engine.pause_task(tid)
                emit({"event": "task_paused", "id": tid})
                return {"status": "ok"}
            return {"status": "error", "message": "Task not found"}
        elif action == "resume":
            tid = req.get("id")
            if tid and tid in engine.tasks:
                engine.start_task(tid)
                emit({"event": "task_resumed", "id": tid})
                return {"status": "ok"}
            return {"status": "error", "message": "Task not found"}
        elif action in ("open_add_modal", "show_add_dialog"):
            url = req.get("url", "")
            fn = req.get("filename", "")
            emit({"event": "open_add_modal", "url": url, "filename": fn})
            return {"status": "ok"}
        elif action in ("open_options_modal", "show_options_dialog", "settings"):
            tab = req.get("tab", "extensions")
            emit({"event": "open_options_modal", "tab": tab})
            return {"status": "ok"}
        elif action == "browser_status":
            return {"status": "ok", "browsers": browser_integration.get_installed_browsers_info()}
        elif action == "browser_install":
            target = req.get("browser", "all")
            return browser_integration.install_browser(target)
        elif action == "delete":
            tid = req.get("id")
            del_file = req.get("delete_file", False)
            if tid:
                engine.delete_task(tid, delete_files=del_file)
                emit({"event": "task_deleted", "id": tid})
                return {"status": "ok"}
            return {"status": "error", "message": "Task not found"}
        return {"status": "error", "message": f"Unknown action: {action}"}

    ipc_server = IPCServer(handle_ipc)
    ipc_server.start()
    http_bridge_server = start_http_bridge(engine=engine, emit_func=emit)

    # Start clipboard watcher
    def on_clipboard(url: str):
        emit({"event": "clipboard_url", "url": url})

    try:
        clip_watcher = ClipboardWatcher(on_clipboard)
        clip_watcher.start()
    except Exception:
        clip_watcher = None

    # Periodic tick emitter to frontend (sends live speed, ETA, segment chunks)
    def tick_loop():
        while True:
            time.sleep(0.25)
            has_active = any(t.status == "downloading" for t in engine.tasks.values())
            if has_active:
                tasks_data = [t.to_dict() for t in engine.tasks.values() if t.status == "downloading"]
                emit({"event": "tick", "tasks": tasks_data})

    threading.Thread(target=tick_loop, daemon=True).start()

    # Initial emission of all tasks
    emit({"event": "init", "tasks": [t.to_dict() for t in engine.tasks.values()]})

    # Read commands from stdin
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            cmd = req.get("cmd")
            req_id = req.get("req_id")

            if cmd == "probe":
                url = req.get("url")
                probe = engine.probe_url(url)
                emit({"res": "probe", "req_id": req_id, "data": probe})

            elif cmd == "add":
                url = req.get("url")
                fn = req.get("filename")
                cat = req.get("category")
                sp = req.get("save_path")
                conns = req.get("connections", 8)
                quality = req.get("quality", "best")
                start_now = req.get("start_now", True)
                extra = {"quality": quality}
                task = engine.create_task(
                    url,
                    filename=fn,
                    save_path=sp,
                    category=cat,
                    num_connections=conns,
                    extra_meta=extra
                )
                if start_now:
                    engine.start_task(task.id)
                emit({"res": "add", "req_id": req_id, "task": task.to_dict()})
                emit({"event": "task_added", "task": task.to_dict()})

            elif cmd == "pause":
                tid = req.get("id")
                if tid in engine.tasks:
                    engine.pause_task(tid)
                    emit({"event": "task_paused", "id": tid})
                emit({"res": "pause", "req_id": req_id, "status": "ok"})

            elif cmd == "resume":
                tid = req.get("id")
                if tid in engine.tasks:
                    engine.start_task(tid)
                    emit({"event": "task_resumed", "id": tid})
                emit({"res": "resume", "req_id": req_id, "status": "ok"})

            elif cmd == "stop_all":
                for t in engine.tasks.values():
                    if t.status == "downloading":
                        engine.pause_task(t.id)
                        emit({"event": "task_paused", "id": t.id})
                emit({"res": "stop_all", "req_id": req_id, "status": "ok"})

            elif cmd == "resume_all":
                for t in engine.tasks.values():
                    if t.status in ("paused", "queued", "error"):
                        engine.start_task(t.id)
                        emit({"event": "task_resumed", "id": t.id})
                emit({"res": "resume_all", "req_id": req_id, "status": "ok"})

            elif cmd == "delete":
                tid = req.get("id")
                del_file = req.get("delete_file", False)
                engine.delete_task(tid, delete_files=del_file)
                emit({"event": "task_deleted", "id": tid})
                emit({"res": "delete", "req_id": req_id, "status": "ok"})

            elif cmd == "delete_completed":
                cids = [t.id for t in engine.tasks.values() if t.status == "completed"]
                for cid in cids:
                    engine.delete_task(cid, delete_files=False)
                    emit({"event": "task_deleted", "id": cid})
                emit({"res": "delete_completed", "req_id": req_id, "status": "ok"})

            elif cmd == "speed_limit":
                limit = req.get("limit", 0)
                engine.set_speed_limit(limit)
                emit({"res": "speed_limit", "req_id": req_id, "status": "ok"})

            elif cmd == "set_clipboard_watch":
                enabled = bool(req.get("enabled", True))
                if clip_watcher:
                    clip_watcher.enabled = enabled
                emit({"res": "set_clipboard_watch", "req_id": req_id, "status": "ok"})

            elif cmd == "list":
                sync_from_db()
                tasks_data = [t.to_dict() for t in engine.tasks.values()]
                emit({"res": "list", "req_id": req_id, "tasks": tasks_data})

            elif cmd == "browser_status":
                status = browser_integration.get_installed_browsers_info()
                emit({"res": "browser_status", "req_id": req_id, "browsers": status})

            elif cmd == "browser_install":
                target = req.get("browser", "all")
                result = browser_integration.install_browser(target)
                emit({"res": "browser_install", "req_id": req_id, "result": result})

        except Exception as e:
            emit({"error": str(e)})

if __name__ == "__main__":
    main()
