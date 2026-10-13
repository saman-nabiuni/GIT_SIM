"""Projects: each company's list is in database/companies/<id>/projects.json;
the project itself is stored at the path the user gives: <path>/<project name>/project.json and timeline.json."""
import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import config, table_io
from .employees_service import company_dir
from .errors import ServiceError

PID_RE = re.compile(r"^[0-9a-f]{12}$")
BAD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_folder_name(name: str) -> str:
    name = BAD_CHARS.sub(" ", (name or "")).strip()
    name = re.sub(r"\s+", " ", name).rstrip(". ")
    if not name or name in (".", ".."):
        raise ServiceError("نام پروژه معتبر نیست.")
    if len(name) > config.MAX_PROJECT_NAME_LEN:
        raise ServiceError(f"نام پروژه نباید بیشتر از {config.MAX_PROJECT_NAME_LEN} کاراکتر باشد.")
    if name.split(".")[0].lower() in RESERVED:
        raise ServiceError("این نام در ویندوز رزرو است؛ نام دیگری بگذار.")
    return name


def _inside(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def resolve_base_path(raw: str) -> Path:
    raw = (raw or "").strip().strip('"')
    if not raw or "\x00" in raw:
        raise ServiceError("مسیر ذخیره‌ی پروژه را وارد کن.")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise ServiceError("مسیر باید کامل (مطلق) باشد، مثل D:\\Projects")
    path = path.resolve()
    if _inside(path, config.BASE_DIR.resolve()):
        raise ServiceError("مسیر نباید داخل پوشه‌ی خودِ برنامه باشد.")
    if path.exists() and not path.is_dir():
        raise ServiceError("این مسیر یک پوشه نیست.")
    return path


# ---------- List ----------
def _list_file(company_id: str) -> Path:
    return company_dir(company_id) / "projects.json"


def _read_list(company_id: str) -> list:
    path = _list_file(company_id)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data["projects"]
    except (ValueError, KeyError, TypeError):
        raise ServiceError("فایل فهرست پروژه‌ها خراب است: " + str(path), 500)


def _write_list(company_id: str, projects: list) -> None:
    table_io.atomic_write_bytes(
        _list_file(company_id),
        json.dumps({"projects": projects}, ensure_ascii=False, indent=2).encode("utf-8"),
    )


def _decorate(p: dict) -> dict:
    folder = Path(p["path"])
    out = dict(p)
    out["missing"] = not folder.is_dir()
    tl = folder / "timeline.json"
    out["updated_at"] = (
        datetime.fromtimestamp(tl.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
        if tl.exists() else p["created_at"]
    )
    return out


def list_projects(company_id: str) -> list:
    projects = [_decorate(p) for p in _read_list(company_id)]
    return sorted(projects, key=lambda p: p["updated_at"], reverse=True)


def get_project(company_id: str, pid: str) -> dict:
    if not PID_RE.match(pid or ""):
        raise ServiceError("پروژه پیدا نشد.", 404)
    for p in _read_list(company_id):
        if p["id"] == pid:
            return _decorate(p)
    raise ServiceError("پروژه پیدا نشد.", 404)


def create_project(company_id: str, name: str, base_path: str) -> dict:
    name = (name or "").strip()
    folder_name = safe_folder_name(name)
    base = resolve_base_path(base_path)
    folder = base / folder_name

    projects = _read_list(company_id)
    if any(p["name"].strip().lower() == name.lower() for p in projects):
        raise ServiceError("پروژه‌ای با این نام در این شرکت هست.", 409)
    if any(os.path.normcase(p["path"]) == os.path.normcase(str(folder)) for p in projects):
        raise ServiceError("این مسیر قبلاً به یک پروژه داده شده.", 409)
    if folder.exists() and any(folder.iterdir()):
        raise ServiceError("پوشه‌ای با این نام از قبل هست و خالی نیست.", 409)

    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ServiceError(f"ساخت پوشه ممکن نشد: {exc.strerror or exc}", 400)

    record = {"id": uuid.uuid4().hex[:12], "name": name, "path": str(folder), "created_at": _now()}
    try:
        table_io.atomic_write_bytes(
            folder / "project.json",
            json.dumps({**record, "company_id": company_id, "version": 1}, ensure_ascii=False, indent=2).encode("utf-8"),
        )
    except OSError as exc:
        raise ServiceError(f"نوشتن در این مسیر ممکن نشد: {exc.strerror or exc}", 400)
    projects.append(record)
    _write_list(company_id, projects)
    return _decorate(record)


def remove_project(company_id: str, pid: str) -> None:
    """Removed only from the app's list; project files on disk are left untouched."""
    get_project(company_id, pid)
    _write_list(company_id, [p for p in _read_list(company_id) if p["id"] != pid])


# ---------- Timeline ----------
def _timeline_path(project: dict) -> Path:
    return Path(project["path"]) / "timeline.json"


def load_timeline(project: dict):
    path = _timeline_path(project)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        raise ServiceError("فایل timeline.json خراب است؛ نسخه‌ی قبلی: timeline.prev.json", 422)


def _validate_timeline(data) -> None:
    if not isinstance(data, dict) or not isinstance(data.get("branches"), list) or not isinstance(data.get("commits"), list):
        raise ServiceError("ساختار تایم‌لاین نامعتبر است.")
    if not data["branches"] or not data["commits"]:
        raise ServiceError("تایم‌لاین نباید خالی باشد.")
    if len(data["commits"]) > config.MAX_TIMELINE_COMMITS:
        raise ServiceError("تعداد نسخه‌ها از حد مجاز بیشتر است.")
    ids = set()
    for c in data["commits"]:
        if not isinstance(c, dict) or not isinstance(c.get("id"), str) or not isinstance(c.get("name"), str):
            raise ServiceError("یکی از نسخه‌ها نامعتبر است.")
        if c["id"] in ids:
            raise ServiceError("شناسه‌ی نسخه‌ها تکراری است.")
        ids.add(c["id"])
        note = c.get("note", "")
        if not isinstance(note, str) or len(note) > config.MAX_NOTE_LEN:
            raise ServiceError(f"توضیح نسخه باید متن و حداکثر {config.MAX_NOTE_LEN} کاراکتر باشد.")
        if not isinstance(c.get("branch"), int) or not 0 <= c["branch"] < len(data["branches"]):
            raise ServiceError("شاخه‌ی یک نسخه نامعتبر است.")
    ideas = data.get("ideas", [])
    if not isinstance(ideas, list) or len(ideas) > config.MAX_IDEAS:
        raise ServiceError(f"تعداد ایده‌ها نباید بیشتر از {config.MAX_IDEAS} باشد.")
    for it in ideas:
        if not isinstance(it, dict) or not isinstance(it.get("text"), str) or len(it["text"]) > config.MAX_IDEA_LEN:
            raise ServiceError(f"هر ایده باید متن و حداکثر {config.MAX_IDEA_LEN} کاراکتر باشد.")
        if not isinstance(it.get("done", False), bool):
            raise ServiceError("وضعیت یکی از ایده‌ها نامعتبر است.")
    for c in data["commits"]:
        for key in ("parent", "twin"):
            if c.get(key) is not None and c[key] not in ids:
                raise ServiceError("پیوند یک نسخه به نسخه‌ی ناموجود اشاره می‌کند.")


def save_timeline(project: dict, data) -> None:
    _validate_timeline(data)
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(raw) > config.MAX_TIMELINE_BYTES:
        raise ServiceError("حجم تایم‌لاین از حد مجاز بیشتر است.", 413)
    folder = Path(project["path"])
    if not folder.is_dir():
        raise ServiceError("پوشه‌ی پروژه روی دیسک پیدا نشد.", 404)
    path = _timeline_path(project)
    if path.exists():
        try:
            shutil.copy2(path, folder / "timeline.prev.json")  # a backup of the previous one
        except OSError:
            pass
    table_io.atomic_write_bytes(path, raw)
