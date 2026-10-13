"""
CLI tool for Boring Download Manager (BDM).
Provides powerful command-line access with seamless IPC integration to GUI.
"""

import os
import sys
import shutil
import argparse
import subprocess
from typing import Optional

from ipc import send_ipc_request
import db
import theme
from engine import DownloadEngine
from category import detect_category


def run_cli():
    parser = argparse.ArgumentParser(
        prog="bdm",
        description="Boring Download Manager (BDM) - Rock-Solid Multi-Stream Download Manager",
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # GUI command
    gui_parser = subparsers.add_parser("gui", help="Open Boring Download Manager GUI")

    # Add command
    add_parser = subparsers.add_parser("add", help="Add a new download URL")
    add_parser.add_argument("url", help="URL to download (direct HTTP/HTTPS or yt-dlp media URL)")
    add_parser.add_argument("--filename", "-f", help="Custom file name")
    add_parser.add_argument("--category", "-c", help="Category (Compressed, Documents, Music, Video, Programs, Images, Other)")
    add_parser.add_argument("--connections", "-n", type=int, default=8, help="Number of parallel connections (1-32)")
    add_parser.add_argument("--quality", "-q", default="best", help="Video quality (e.g. 1080, 720, 480, 360, audio)")
    add_parser.add_argument("--gui", "-g", action="store_true", help="Open the Add Download dialog in the GUI with this URL")
    add_parser.add_argument("--pause", action="store_true", help="Add to queue without starting immediately")

    # List command
    list_parser = subparsers.add_parser("list", help="List all downloads")

    # Pause command
    pause_parser = subparsers.add_parser("pause", help="Pause a download")
    pause_parser.add_argument("id", help="Download ID")

    # Resume command
    resume_parser = subparsers.add_parser("resume", help="Resume a download")
    resume_parser.add_argument("id", help="Download ID")

    # Delete command
    del_parser = subparsers.add_parser("delete", help="Delete a download")
    del_parser.add_argument("id", help="Download ID")
    del_parser.add_argument("--delete-files", "-d", action="store_true", help="Also delete downloaded files from disk")

    # Theme command
    theme_parser = subparsers.add_parser("theme", help="Show active desktop theme colors")

    # Settings / Options command
    subparsers.add_parser("settings", help="Open BDM Settings & Options")
    subparsers.add_parser("options", help="Open BDM Settings & Options")

    # Extensions command
    ext_parser = subparsers.add_parser("extensions", help="Manage browser extensions and integration")
    ext_parser.add_argument("action", nargs="?", default="status", choices=["status", "install", "install-all", "gui"], help="Action to perform")
    ext_parser.add_argument("--browser", "-b", default="all", help="Browser to install for (zen, firefox, chrome, chromium, brave, librewolf, all)")
    ext_parser.add_argument("--gui", "-g", action="store_true", help="Open Browser Integration in the GUI")

    args = parser.parse_args()

    # Default action: if no arguments or 'gui', launch GUI
    if not args.command or args.command == "gui":
        # Check if already running via ping
        resp = send_ipc_request({"action": "ping"})
        if resp and resp.get("status") == "ok":
            # Tell running GUI to present
            send_ipc_request({"action": "show_add_dialog", "url": ""})
            print("Boring Download Manager is already running. Brought window to front.")
            return

        env = os.environ.copy()
        electron_bin = shutil.which("electron") or "/usr/bin/electron"
        cmd = [electron_bin]
        if os.environ.get("WAYLAND_DISPLAY"):
            env["ELECTRON_OZONE_PLATFORM_HINT"] = "auto"
            cmd.extend(["--enable-features=UseOzonePlatform", "--ozone-platform-hint=auto"])
        cmd.append(os.path.dirname(__file__))
        subprocess.Popen(cmd, env=env, start_new_session=True)
        print("Launched Boring Download Manager GUI.")
        return

    if args.command == "add":
        if getattr(args, "gui", False):
            resp = send_ipc_request({"action": "open_add_modal", "url": args.url})
            if resp and resp.get("status") == "ok":
                print(f"✓ Opened Add Download dialog in GUI: {args.url}")
                return
            print("BDM GUI is not running.")
            return

        payload = {
            "action": "add",
            "url": args.url,
            "filename": args.filename,
            "category": args.category,
            "connections": args.connections,
            "quality": args.quality,
            "start_now": not args.pause,
        }
        resp = send_ipc_request(payload)
        if resp and resp.get("status") == "ok":
            t = resp.get("task", {})
            print(f"✓ Added to BDM (GUI): [{t.get('id')}] {t.get('filename')} ({t.get('category')})")
            return

        # If GUI is not running, add directly to DB / background engine
        db.init_db()
        engine = DownloadEngine()
        task = engine.create_task(
            url=args.url,
            filename=args.filename,
            category=args.category,
            num_connections=args.connections,
            extra_meta={"quality": args.quality},
        )
        if not args.pause:
            engine.start_task(task.id)
            print(f"✓ Started download [{task.id}]: {task.filename}")
            print(f"  Category: {task.category} -> {task.save_path}")
            print(f"  Connections: {task.num_connections}")
        else:
            print(f"✓ Queued download [{task.id}]: {task.filename}")

    elif args.command == "list":
        resp = send_ipc_request({"action": "list"})
        if resp and resp.get("status") == "ok":
            tasks = resp.get("downloads", [])
        else:
            db.init_db()
            tasks = db.get_all_downloads()

        if not tasks:
            print("No downloads found.")
            return

        print(f"{'ID':<10} {'STATUS':<12} {'CATEGORY':<12} {'SIZE':<16} {'FILENAME'}")
        print("-" * 75)
        for t in tasks:
            size_mb = f"{t.get('downloaded_size', 0) / (1024*1024):.1f} / {t.get('total_size', 0) / (1024*1024):.1f} MB"
            status = t.get("status", "unknown").upper()
            print(f"{t.get('id', ''):<10} {status:<12} {t.get('category', ''):<12} {size_mb:<16} {t.get('filename', '')}")

    elif args.command == "pause":
        resp = send_ipc_request({"action": "pause", "id": args.id})
        if resp and resp.get("status") == "ok":
            print(f"✓ Download {args.id} paused.")
        else:
            print(f"Failed to pause {args.id} (GUI may not be running).")

    elif args.command == "resume":
        resp = send_ipc_request({"action": "resume", "id": args.id})
        if resp and resp.get("status") == "ok":
            print(f"✓ Download {args.id} resumed.")
        else:
            print(f"Failed to resume {args.id} (GUI may not be running).")

    elif args.command == "delete":
        resp = send_ipc_request({"action": "delete", "id": args.id, "delete_file": args.delete_files})
        if resp and resp.get("status") == "ok":
            print(f"✓ Download {args.id} deleted.")
        else:
            db.init_db()
            db.delete_download(args.id)
            print(f"✓ Removed {args.id} from database.")

    elif args.command == "theme":
        c = theme.get_omarchy_colors()
        font = theme.get_omarchy_font()
        print(f"Active Font: {font}")
        print("Detected Theme Colors:")
        for k, v in c.items():
            print(f"  {k:<20}: {v}")

    elif args.command in ("settings", "options"):
        resp = send_ipc_request({"action": "open_options_modal", "tab": "extensions"})
        if resp and resp.get("status") == "ok":
            print("✓ Opened BDM Settings & Options.")
        else:
            print("BDM GUI is not running. Starting GUI...")
            launcher = shutil.which("bdm") or sys.argv[0]
            subprocess.Popen([launcher, "gui"], start_new_session=True)

    elif args.command == "extensions":
        if getattr(args, "gui", False) or args.action == "gui":
            resp = send_ipc_request({"action": "open_options_modal", "tab": "extensions"})
            if resp and resp.get("status") == "ok":
                print("✓ Opened Browser Integration in BDM GUI.")
            else:
                print("BDM GUI is not running. Starting GUI...")
                launcher = shutil.which("bdm") or sys.argv[0]
                subprocess.Popen([launcher, "gui"], start_new_session=True)
            return

        import browser_integration
        if args.action == "status":
            info = browser_integration.get_installed_browsers_info()
            print("\n=== BDM Browser Integration Status ===")
            for b_id, b in info.items():
                status_symbol = "✓" if b["status"] == "ready" else ("⚙" if b["status"] == "host_only" else "✗")
                print(f"  [{status_symbol}] {b['name']:<18} ({b['status']}): {b['details']}")
            print("\nNative Host binary:", browser_integration.NATIVE_HOST_BIN)
            print("HTTP Interception Bridge: http://127.0.0.1:19532\n")
        elif args.action in ("install", "install-all"):
            target = args.browser if args.action == "install" else "all"
            print(f"Configuring browser extensions for '{target}'...")
            res = browser_integration.install_browser(target)
            if res.get("success"):
                print("✓ Successfully installed and configured browser extensions!")
                if "results" in res:
                    for k, v in res["results"].items():
                        print(f"   - {k}: {v.get('message', 'done')}")
                elif "message" in res:
                    print(f"   - {res['message']}")
            else:
                print(f"✗ Installation failed: {res.get('error')}")


if __name__ == "__main__":
    run_cli()
