"""
Theme Adapter for Boring Download Manager (BDM).
Adapts to desktop colors and font preferences with dark theme defaults.
"""

import os
import tomllib
from typing import Dict, Any
import subprocess

THEME_FILE = os.path.expanduser("~/.local/state/omarchy/current/theme/colors.toml")


def get_omarchy_colors() -> Dict[str, str]:
    defaults = {
        "mode": "dark",
        "background": "#1e1e2e",
        "darker_background": "#181825",
        "dark_background": "#11111b",
        "lighter_background": "#313244",
        "foreground": "#cdd6f4",
        "dark_foreground": "#6c7086",
        "light_foreground": "#a6adc8",
        "bright_foreground": "#cdd6f4",
        "accent": "#cba6f7",
        "selection": "#45475a",
        "muted": "#7f849c",
        "red": "#f38ba8",
        "green": "#a6e3a1",
        "yellow": "#f9e2af",
        "blue": "#89b4fa",
        "magenta": "#f5c2e7",
        "cyan": "#94e2d5",
    }

    if os.path.exists(THEME_FILE):
        try:
            with open(THEME_FILE, "rb") as f:
                colors = tomllib.load(f)
                defaults.update({k: v for k, v in colors.items() if isinstance(v, str)})
        except Exception:
            pass

    return defaults


def get_omarchy_font() -> str:
    try:
        out = subprocess.check_output(["omarchy", "font", "current"], text=True).strip()
        if out:
            return out
    except Exception:
        pass
    return "JetBrainsMono Nerd Font"


get_theme_colors = get_omarchy_colors
get_system_font = get_omarchy_font


def generate_gtk_css() -> str:
    c = get_omarchy_colors()
    font_name = get_omarchy_font()

    css = f"""
    /* Boring Download Manager Theme */
    @define-color accent_color {c['accent']};
    @define-color accent_bg_color {c['accent']};
    @define-color accent_fg_color {c['darker_background']};

    @define-color window_bg_color {c['background']};
    @define-color window_fg_color {c['foreground']};

    @define-color view_bg_color {c['darker_background']};
    @define-color view_fg_color {c['foreground']};

    @define-color headerbar_bg_color {c['dark_background']};
    @define-color headerbar_fg_color {c['foreground']};

    @define-color card_bg_color {c['lighter_background']};
    @define-color card_fg_color {c['foreground']};

    @define-color popover_bg_color {c['darker_background']};
    @define-color popover_fg_color {c['foreground']};

    @define-color dialog_bg_color {c['dark_background']};
    @define-color dialog_fg_color {c['foreground']};

    * {{
        font-family: "{font_name}", monospace, sans-serif;
    }}

    window.main-window {{
        background-color: {c['background']};
        color: {c['foreground']};
    }}

    headerbar {{
        background-color: {c['dark_background']};
        border-bottom: 1px solid {c['selection']};
    }}

    /* IDM Top Toolbar */
    .idm-toolbar {{
        background-color: {c['darker_background']};
        border-bottom: 1px solid {c['selection']};
        padding: 4px 8px;
    }}

    .idm-toolbar button {{
        background-color: transparent;
        color: {c['foreground']};
        border-radius: 6px;
        border: 1px solid transparent;
        padding: 4px 8px;
    }}

    .idm-toolbar button:hover {{
        background-color: {c['lighter_background']};
        border-color: {c['selection']};
    }}

    .idm-toolbar button.suggested-action {{
        background-color: {c['accent']};
        color: {c['darker_background']};
        font-weight: bold;
    }}

    /* Sidebar Categories & Queues */
    .sidebar {{
        background-color: {c['darker_background']};
        border-right: 1px solid {c['selection']};
    }}

    .sidebar listview, .sidebar list {{
        background-color: transparent;
    }}

    .sidebar row:selected {{
        background-color: {c['selection']};
        color: {c['accent']};
        font-weight: bold;
        border-radius: 6px;
    }}

    /* IDM TreeView Spreadsheet Table */
    treeview {{
        background-color: {c['background']};
        color: {c['foreground']};
    }}

    treeview:selected {{
        background-color: {c['selection']};
        color: {c['accent']};
    }}

    treeview header button {{
        background-color: {c['dark_background']};
        color: {c['light_foreground']};
        border-bottom: 1px solid {c['selection']};
        font-weight: bold;
        font-size: 12px;
        padding: 6px 8px;
    }}

    treeview header button:hover {{
        background-color: {c['lighter_background']};
        color: {c['foreground']};
    }}

    /* IDM Statusbar */
    .idm-statusbar {{
        background-color: {c['dark_background']};
        border-top: 1px solid {c['selection']};
        padding: 4px 12px;
        font-size: 12px;
    }}

    /* Segment Visualizer Bar (IDM Iconic Block Bar) */
    .segment-bar {{
        background-color: {c['darker_background']};
        border-radius: 6px;
        border: 1px solid {c['selection']};
        min-height: 20px;
        padding: 2px;
    }}

    .segment-block-done progress {{
        background-color: {c['green']};
    }}

    .segment-block-active progress {{
        background-color: {c['accent']};
    }}

    .segment-block-waiting progress {{
        background-color: {c['selection']};
    }}

    progressbar trough {{
        background-color: {c['darker_background']};
        border-radius: 4px;
        min-height: 8px;
    }}

    progressbar progress {{
        background-color: {c['accent']};
        border-radius: 4px;
        min-height: 8px;
    }}

    button.suggested-action {{
        background-color: {c['accent']};
        color: {c['darker_background']};
        font-weight: bold;
        border-radius: 6px;
    }}

    button.destructive-action {{
        background-color: {c['red']};
        color: {c['foreground']};
        border-radius: 6px;
    }}

    entry {{
        background-color: {c['darker_background']};
        color: {c['foreground']};
        border: 1px solid {c['selection']};
        border-radius: 6px;
        padding: 6px 10px;
    }}
    entry:focus {{
        border-color: {c['accent']};
    }}
    """
    return css


def apply_theme_to_display():
    """Applies CSS provider to default GDK display."""
    import gi
    gi.require_version("Gtk", "4.0")
    from gi.repository import Gtk, Gdk

    css_provider = Gtk.CssProvider()
    css_provider.load_from_string(generate_gtk_css())
    display = Gdk.Display.get_default()
    if display:
        Gtk.StyleContext.add_provider_for_display(
            display,
            css_provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
        )
