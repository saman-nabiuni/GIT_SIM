"""Native OS folder dialog (runs on the machine that runs the server).

Runs in a separate process so tkinter never touches Flask's threads.
Output is JSON with ASCII escapes, so any path is safe to print/pipe.
"""
import json
import os
import subprocess
import sys

from .errors import ServiceError

_SCRIPT = r'''
import json, sys
import tkinter as tk
from tkinter import filedialog
root = tk.Tk()
root.withdraw()
root.attributes("-topmost", True)
root.lift()
p = filedialog.askdirectory(parent=root, initialdir=sys.argv[1] or None,
                            title="Select parent folder", mustexist=True)
root.destroy()
print(json.dumps({"path": p or ""}))
'''

DIALOG_TIMEOUT_SECONDS = 600
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # Windows only: no console flash


def pick_folder(initial: str = "") -> str:
    """Return the chosen folder, or '' if the user cancelled."""
    start = initial if initial and os.path.isdir(initial) else ""
    try:
        p = subprocess.run([sys.executable, "-c", _SCRIPT, start], capture_output=True,
                           text=True, encoding="utf-8", timeout=DIALOG_TIMEOUT_SECONDS,
                           creationflags=_NO_WINDOW)
    except subprocess.TimeoutExpired:
        raise ServiceError("پنجره‌ی انتخاب پوشه زیادی باز ماند.", 504)
    if p.returncode != 0:
        if "tkinter" in p.stderr or "No module named" in p.stderr:
            raise ServiceError("tkinter در این پایتون نصب نیست (در نصب پایتون گزینه‌ی tcl/tk را فعال کن).", 500)
        raise ServiceError("باز کردن پنجره‌ی انتخاب پوشه ناموفق بود.", 500)
    try:
        path = json.loads(p.stdout.strip().splitlines()[-1])["path"]
    except (ValueError, KeyError, IndexError):
        raise ServiceError("پاسخ نامعتبر از پنجره‌ی انتخاب پوشه.", 500)
    return os.path.normpath(path) if path else ""
