"""Starts app.py on THIS computer (made by the timeline app: "run package").

- It does not create a virtual environment.
- It does not install anything unless you answer y to the question below.
- Libraries listed in requirements.txt (if the file exists) are only checked: missing ones are shown to you and you decide.
"""
import os
import re
import socket
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def read_requirement_lines():
    path = HERE / "requirements.txt"
    if not path.is_file():
        return []
    raw = path.read_bytes()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):  # "pip freeze > requirements.txt" in Windows PowerShell writes UTF-16
        text = raw.decode("utf-16", "replace")
    else:
        text = raw.decode("utf-8-sig", "replace")
    lines = []
    for line in text.splitlines():
        line = re.sub(r"(^|\s)#.*$", "", line).strip()
        if line and not line.startswith(("-", ".", "/")) and "://" not in line:
            lines.append(line)
    return lines


def marker_applies(line):
    """False only when we are sure the environment marker (e.g. ; sys_platform == 'win32') excludes this line."""
    if ";" not in line:
        return True
    try:
        from packaging.markers import Marker
        return Marker(line.split(";", 1)[1].strip()).evaluate()
    except Exception:
        return True


def find_missing(lines):
    try:
        from importlib import metadata
    except ImportError:  # Python older than 3.8
        print("(Python is too old to check the libraries automatically; skipping the check.)")
        return []
    missing = []
    for line in lines:
        match = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)", line)
        if not match or not marker_applies(line):
            continue
        try:
            metadata.version(match.group(1))
        except metadata.PackageNotFoundError:
            missing.append(line)
    return missing


def ask(question):
    try:
        return input(question).strip().lower() in ("y", "yes")
    except EOFError:
        return False


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    print(f"Python {sys.version.split()[0]}  ({sys.executable})")
    missing = find_missing(read_requirement_lines())
    if missing:
        print("\nThese libraries (from requirements.txt) are not installed on this computer:")
        for line in missing:
            print("   " + line)
        if ask("\nInstall them now with pip, into this Python? [y/N] "):
            code = subprocess.call([sys.executable, "-m", "pip", "install", *missing])
            if code != 0:
                print("\npip could not install everything (see the messages above). Starting anyway.")
        else:
            print("\nNothing was installed. If app.py stops with an ImportError, install that library yourself or change the code.")
    elif (HERE / "requirements.txt").is_file():
        print("All libraries from requirements.txt are installed.")

    port = free_port()
    env = dict(os.environ, APP_HOST="127.0.0.1", APP_PORT=str(port), PORT=str(port), PYTHONIOENCODING="utf-8")
    print(f"\nStarting app.py ... when it is up, open http://127.0.0.1:{port}  (press Ctrl+C here to stop it)\n")
    try:
        code = subprocess.call([sys.executable, "app.py"], cwd=str(HERE), env=env)
    except KeyboardInterrupt:
        code = 0
    print(f"\napp.py finished (exit code {code}).")


if __name__ == "__main__":
    main()
