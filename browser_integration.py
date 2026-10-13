#!/usr/bin/env python3
"""
Browser Integration Module for Boring Download Manager (BDM).
Detects installed browsers (Zen Browser, Firefox, LibreWolf, Chrome, Chromium, Brave),
deploys Native Messaging Host manifests, and auto-installs/configures browser extensions.
"""

import os
import sys
import json
import shutil
import glob
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXTENSION_DIR = os.path.join(BASE_DIR, "browser-extension")
DIST_DIR = os.path.join(EXTENSION_DIR, "dist")
HOST_DIR = os.path.join(EXTENSION_DIR, "host")

FIREFOX_XPI = os.path.join(DIST_DIR, "bdm-firefox.xpi")
UNPACKED_DIR = os.path.join(DIST_DIR, "unpacked")
NATIVE_HOST_BIN = os.path.join(HOST_DIR, "bdm-native-host")
CHROME_MANIFEST_SRC = os.path.join(HOST_DIR, "com.boring.dm.chrome.json")
FIREFOX_MANIFEST_SRC = os.path.join(HOST_DIR, "com.boring.dm.firefox.json")

GECKO_EXTENSION_ID = "bdm-extension@omarchy.org"
CHROME_EXTENSION_ID = "jdakfphphhnnophdajheojmmkelamebp"

HOME = os.path.expanduser("~")

def is_bin_available(bin_name: str) -> bool:
    return shutil.which(bin_name) is not None

def get_installed_browsers_info():
    """Detect all installed browsers and their profile configurations."""
    browsers = {
        "zen": {
            "id": "zen",
            "name": "Zen Browser",
            "family": "gecko",
            "bin": "zen-browser",
            "bin_available": is_bin_available("zen-browser"),
            "base_paths": [
                os.path.join(HOME, ".config/zen"),
                os.path.join(HOME, ".zen")
            ],
            "native_host_paths": [
                os.path.join(HOME, ".mozilla/native-messaging-hosts"),
                os.path.join(HOME, ".config/zen/native-messaging-hosts")
            ],
            "profiles": [],
            "status": "not_detected",
            "details": ""
        },
        "firefox": {
            "id": "firefox",
            "name": "Mozilla Firefox",
            "family": "gecko",
            "bin": "firefox",
            "bin_available": is_bin_available("firefox"),
            "base_paths": [
                os.path.join(HOME, ".mozilla/firefox")
            ],
            "native_host_paths": [
                os.path.join(HOME, ".mozilla/native-messaging-hosts")
            ],
            "profiles": [],
            "status": "not_detected",
            "details": ""
        },
        "librewolf": {
            "id": "librewolf",
            "name": "LibreWolf",
            "family": "gecko",
            "bin": "librewolf",
            "bin_available": is_bin_available("librewolf"),
            "base_paths": [
                os.path.join(HOME, ".librewolf"),
                os.path.join(HOME, ".var/app/io.gitlab.librewolf-community/.librewolf")
            ],
            "native_host_paths": [
                os.path.join(HOME, ".librewolf/native-messaging-hosts"),
                os.path.join(HOME, ".mozilla/native-messaging-hosts")
            ],
            "profiles": [],
            "status": "not_detected",
            "details": ""
        },
        "chrome": {
            "id": "chrome",
            "name": "Google Chrome",
            "family": "chromium",
            "bin": "google-chrome",
            "bin_available": is_bin_available("google-chrome") or is_bin_available("google-chrome-stable"),
            "base_paths": [
                os.path.join(HOME, ".config/google-chrome")
            ],
            "native_host_paths": [
                os.path.join(HOME, ".config/google-chrome/NativeMessagingHosts")
            ],
            "external_ext_path": os.path.join(HOME, ".config/google-chrome/External Extensions"),
            "profiles": [],
            "status": "not_detected",
            "details": ""
        },
        "chromium": {
            "id": "chromium",
            "name": "Chromium",
            "family": "chromium",
            "bin": "chromium",
            "bin_available": is_bin_available("chromium"),
            "base_paths": [
                os.path.join(HOME, ".config/chromium")
            ],
            "native_host_paths": [
                os.path.join(HOME, ".config/chromium/NativeMessagingHosts")
            ],
            "external_ext_path": os.path.join(HOME, ".config/chromium/External Extensions"),
            "profiles": [],
            "status": "not_detected",
            "details": ""
        },
        "brave": {
            "id": "brave",
            "name": "Brave Browser",
            "family": "chromium",
            "bin": "brave",
            "bin_available": is_bin_available("brave") or is_bin_available("brave-browser"),
            "base_paths": [
                os.path.join(HOME, ".config/BraveSoftware/Brave-Browser")
            ],
            "native_host_paths": [
                os.path.join(HOME, ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts")
            ],
            "external_ext_path": os.path.join(HOME, ".config/BraveSoftware/Brave-Browser/External Extensions"),
            "profiles": [],
            "status": "not_detected",
            "details": ""
        }
    }

    # Discover profiles and detect active status
    for b_id, b_info in browsers.items():
        existing_bases = [p for p in b_info["base_paths"] if os.path.exists(p)]
        if not existing_bases and not b_info["bin_available"]:
            b_info["status"] = "not_installed"
            b_info["details"] = "Not found on system"
            continue

        b_info["status"] = "detected"

        if b_info["family"] == "gecko":
            # Discover gecko profiles
            profiles = []
            for base in existing_bases:
                # Look for directories with . or profile markers
                for item in os.listdir(base):
                    full_p = os.path.join(base, item)
                    if os.path.isdir(full_p) and ("." in item or os.path.exists(os.path.join(full_p, "prefs.js"))):
                        profiles.append(full_p)
            b_info["profiles"] = profiles

            # Check if native host is in place
            host_installed = any(
                os.path.exists(os.path.join(hp, "com.boring.dm.json"))
                for hp in b_info["native_host_paths"]
            )
            b_info["native_host_installed"] = host_installed

            # Check if extension is installed in at least one profile
            ext_installed = False
            for prof in profiles:
                xpi_target = os.path.join(prof, "extensions", f"{GECKO_EXTENSION_ID}.xpi")
                if os.path.exists(xpi_target):
                    ext_installed = True
                    break
            b_info["extension_installed"] = ext_installed

            if ext_installed and host_installed:
                b_info["status"] = "ready"
                b_info["details"] = f"Installed & configured in {len(profiles)} profile(s)"
            elif host_installed:
                b_info["status"] = "host_only"
                b_info["details"] = "Native host ready, extension awaiting install"
            else:
                b_info["status"] = "needs_setup"
                b_info["details"] = f"Found {len(profiles)} profile(s), ready to install"

        elif b_info["family"] == "chromium":
            host_installed = any(
                os.path.exists(os.path.join(hp, "com.boring.dm.json"))
                for hp in b_info["native_host_paths"]
            )
            b_info["native_host_installed"] = host_installed

            ext_path = b_info.get("external_ext_path")
            external_configured = False
            if ext_path:
                ext_json = os.path.join(ext_path, f"{CHROME_EXTENSION_ID}.json")
                if os.path.exists(ext_json):
                    external_configured = True
            b_info["external_configured"] = external_configured

            if host_installed:
                b_info["status"] = "ready"
                b_info["details"] = "Native host configured, external manifest linked"
            else:
                b_info["status"] = "needs_setup"
                b_info["details"] = "Browser detected, ready to configure"

    return browsers

def write_host_manifest(dest_dir: str, is_gecko: bool = True):
    os.makedirs(dest_dir, exist_ok=True)
    manifest = {
        "name": "com.boring.dm",
        "description": "Boring Download Manager Native Messaging Host",
        "path": NATIVE_HOST_BIN,
        "type": "stdio"
    }
    if is_gecko:
        manifest["allowed_extensions"] = [
            "bdm-extension@omarchy.org",
            "odm-extension@omarchy.org"
        ]
    else:
        manifest["allowed_origins"] = [
            "chrome-extension://jdakfphphhnnophdajheojmmkelamebp/",
            "chrome-extension://*/*"
        ]

    for name in ("com.boring.dm.json", "com.omarchy.dm.json"):
        with open(os.path.join(dest_dir, name), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

def ensure_native_hosts():
    """Ensure native messaging hosts are created and up to date for all browser paths."""
    if os.path.exists(NATIVE_HOST_BIN):
        os.chmod(NATIVE_HOST_BIN, 0o755)

    # 1. Mozilla / Firefox / Zen / LibreWolf directory
    write_host_manifest(os.path.join(HOME, ".mozilla/native-messaging-hosts"), is_gecko=True)

    # Also Zen specific path if present
    zen_native = os.path.join(HOME, ".config/zen/native-messaging-hosts")
    if os.path.exists(os.path.dirname(zen_native)):
        write_host_manifest(zen_native, is_gecko=True)

    # 2. Chrome
    write_host_manifest(os.path.join(HOME, ".config/google-chrome/NativeMessagingHosts"), is_gecko=False)

    # 3. Chromium
    write_host_manifest(os.path.join(HOME, ".config/chromium/NativeMessagingHosts"), is_gecko=False)

    # 4. Brave
    write_host_manifest(os.path.join(HOME, ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"), is_gecko=False)

def configure_gecko_profile(profile_dir: str):
    """Installs BDM .xpi and configures user.js for a gecko profile."""
    if not os.path.isdir(profile_dir):
        return False

    # 1. Install .xpi
    ext_dir = os.path.join(profile_dir, "extensions")
    os.makedirs(ext_dir, exist_ok=True)
    target_xpi = os.path.join(ext_dir, f"{GECKO_EXTENSION_ID}.xpi")
    shutil.copy2(FIREFOX_XPI, target_xpi)

    # 2. Configure user.js
    user_js = os.path.join(profile_dir, "user.js")
    existing_content = ""
    if os.path.exists(user_js):
        try:
            with open(user_js, "r", encoding="utf-8") as f:
                existing_content = f.read()
        except Exception:
            existing_content = ""

    prefs_to_add = [
        'user_pref("xpinstall.signatures.required", false);',
        'user_pref("extensions.experiments.enabled", true);',
        'user_pref("extensions.autoDisableScopes", 0);',
        'user_pref("extensions.langpacks.signatures.required", false);'
    ]

    new_lines = []
    for pref in prefs_to_add:
        key = pref.split("(")[1].split(",")[0].strip()
        if key not in existing_content:
            new_lines.append(pref)

    if new_lines:
        with open(user_js, "a", encoding="utf-8") as f:
            if existing_content and not existing_content.endswith("\n"):
                f.write("\n")
            f.write("// Boring Download Manager (BDM) configuration\n")
            for nl in new_lines:
                f.write(nl + "\n")

    return True

def configure_chromium_external_ext(ext_dir: str):
    """Writes an external extension registration JSON for Chrome/Chromium/Brave."""
    os.makedirs(ext_dir, exist_ok=True)
    target_json = os.path.join(ext_dir, f"{CHROME_EXTENSION_ID}.json")
    content = {
        "external_version": "2.0.0",
        "path": UNPACKED_DIR
    }
    with open(target_json, "w", encoding="utf-8") as f:
        json.dump(content, f, indent=2)
    return True

def install_browser(browser_id: str) -> dict:
    """Install and configure extension for a specific browser or all."""
    ensure_native_hosts()
    browsers = get_installed_browsers_info()

    if browser_id == "all":
        results = {}
        for b_id in browsers:
            results[b_id] = install_browser(b_id)
        return {"success": True, "browser": "all", "results": results}

    if browser_id not in browsers:
        return {"success": False, "error": f"Unknown browser '{browser_id}'"}

    b = browsers[browser_id]
    if b["status"] == "not_installed":
        return {"success": False, "error": f"{b['name']} is not installed on this system"}

    if b["family"] == "gecko":
        configured_count = 0
        for prof in b["profiles"]:
            if configure_gecko_profile(prof):
                configured_count += 1
        return {
            "success": True,
            "browser": browser_id,
            "message": f"Successfully configured {b['name']} ({configured_count} profile(s))",
            "profiles_configured": configured_count
        }

    elif b["family"] == "chromium":
        ext_path = b.get("external_ext_path")
        if ext_path:
            configure_chromium_external_ext(ext_path)
        return {
            "success": True,
            "browser": browser_id,
            "message": f"Successfully configured Native Messaging & External Extension for {b['name']}",
            "unpacked_path": UNPACKED_DIR
        }

    return {"success": False, "error": "Unsupported browser family"}

def auto_integrate_on_startup():
    """Runs on BDM application startup to auto-integrate available browsers."""
    try:
        ensure_native_hosts()
        browsers = get_installed_browsers_info()
        for b_id, b_info in browsers.items():
            if b_info["status"] != "not_installed":
                install_browser(b_id)
        return True
    except Exception as e:
        print(f"[BDM auto_integrate] Error: {e}", file=sys.stderr)
        return False

def main():
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        if arg in ("--status", "status"):
            print(json.dumps(get_installed_browsers_info(), indent=2))
            return
        elif arg in ("--install-all", "install-all"):
            print(json.dumps(install_browser("all"), indent=2))
            return
        elif arg.startswith("--install="):
            b_id = arg.split("=", 1)[1]
            print(json.dumps(install_browser(b_id), indent=2))
            return
        elif arg in ("--install", "install") and len(sys.argv) > 2:
            b_id = sys.argv[2]
            print(json.dumps(install_browser(b_id), indent=2))
            return

    # Default action: run auto integration
    auto_integrate_on_startup()
    print("BDM Browser Integration complete.")

if __name__ == "__main__":
    main()
