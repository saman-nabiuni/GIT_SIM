"""Run a version's app.py straight from the stored files (no manual export needed).

The version's files are copied (once) into <project>/run/<commit_id>/ and app.py is started there with the
same Python that runs this app. The copy is reused while the version's files do not change, so starting again
is instant. One running app per project: starting another version stops the previous one.
Only the output of the process is kept: <project>/run/<commit_id>.log
"""
import atexit
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
from pathlib import Path

from . import config, versions_service
from .errors import ServiceError

_lock = threading.Lock()
_runs = {}  # project id -> {proc, cid, version, port, log_path}

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)            # Windows only
_NEW_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)    # Windows only


def _free_port() -> int:
    """A free port in RUN_PORT_MIN..RUN_PORT_MAX (so the firewall needs only that range), or any free port if 0."""
    lo, hi = config.RUN_PORT_MIN, config.RUN_PORT_MAX
    if lo and hi >= lo:
        for port in range(lo, hi + 1):
            with socket.socket() as s:
                try:
                    s.bind((config.RUN_APP_HOST, port))
                except OSError:
                    continue
                return port
        raise ServiceError(f"همه‌ی پورت‌های {lo} تا {hi} پر است؛ یک برنامه‌ی در حال اجرا را متوقف کن.", 503)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _entry_name(files: dict):
    """The real (case-preserved) path of app.py in the first layer, or None."""
    return next((p for p in files if p.lower() == config.RUN_ENTRY_FILE), None)


def _prepare(project: dict, cid: str, manifest: dict) -> Path:
    """Working copy of the version; reused while the manifest is unchanged."""
    run_root = Path(project["path"]) / config.RUN_DIRNAME
    work, stamp_file = run_root / cid, run_root / f"{cid}.stamp"
    stamp = hashlib.sha256(json.dumps(manifest["files"], sort_keys=True).encode()).hexdigest()
    try:
        if work.is_dir() and stamp_file.is_file() and stamp_file.read_text() == stamp:
            return work
        if work.exists():
            shutil.rmtree(work)  # our own managed folder; files the app wrote there are lost when the version changed
        versions_service.write_files(project, manifest, work)
        stamp_file.write_text(stamp)
    except OSError as exc:
        raise ServiceError(f"آماده‌سازی پوشه‌ی اجرا ممکن نشد: {exc.strerror or exc}", 400)
    return work


def _kill(proc) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":  # /T = also kill the children (e.g. a reloader)
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, creationflags=_NO_WINDOW)
        else:
            os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=config.RUN_STOP_TIMEOUT_SECONDS)
    except (OSError, subprocess.TimeoutExpired):
        proc.kill()


def _tail(path: Path) -> str:
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            fh.seek(max(0, fh.tell() - config.RUN_LOG_TAIL_BYTES))
            return fh.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def status(project_id: str) -> dict:
    run = _runs.get(project_id)
    if not run:
        return {"running": False, "cid": None}
    code = run["proc"].poll()
    return {
        "running": code is None, "exit_code": code, "cid": run["cid"], "version": run["version"],
        "port": run["port"], "log": _tail(run["log_path"]),  # the browser builds the link from the host it is on
    }


def stop(project_id: str) -> dict:
    with _lock:
        run = _runs.pop(project_id, None)
        if run:
            _kill(run["proc"])
    return {"running": False, "cid": None}


def start(project: dict, cid: str) -> dict:
    commit, m = versions_service.current_files(project, cid)
    entry = _entry_name((m or {}).get("files", {}))
    if not entry:
        raise ServiceError(f"در لایه‌ی اول این نسخه فایل {config.RUN_ENTRY_FILE} نیست.", 404)
    with _lock:
        old = _runs.pop(project["id"], None)
        if old:
            _kill(old["proc"])  # the old app must be gone before its folder can be replaced
        work = _prepare(project, cid, m)
        port = _free_port()
        log_path = work.parent / f"{cid}.log"
        env = {k: v for k, v in os.environ.items() if k not in ("SECRET_KEY", "APP_DEBUG")}
        # apps that read APP_PORT / PORT (like this one) get a free port, so they never clash with this app
        env.update(APP_HOST=config.RUN_APP_HOST, APP_PORT=str(port), PORT=str(port), PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
        extra = {"creationflags": _NEW_GROUP | _NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
        try:
            with open(log_path, "wb") as log:
                proc = subprocess.Popen([sys.executable, entry], cwd=str(work), env=env, stdin=subprocess.DEVNULL,
                                        stdout=log, stderr=subprocess.STDOUT, **extra)
        except OSError as exc:
            raise ServiceError(f"اجرای برنامه ممکن نشد: {exc.strerror or exc}", 400)
        _runs[project["id"]] = {"proc": proc, "cid": cid, "version": commit["name"], "port": port, "log_path": log_path}
    return status(project["id"])


@atexit.register
def _stop_all() -> None:
    for run in list(_runs.values()):
        _kill(run["proc"])
