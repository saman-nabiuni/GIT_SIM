"""Files of each version (a timeline node).

Storage (inside the project folder):
  store/objects/<first 2 chars of hash>/<sha256>   content of each file, stored once by hash (an unchanged file is not stored again)
  store/manifests/<commit_id>.json          full list of that version's files: {path: {h: hash, s: size}}

Upload rules for a version:
  base = the version's own files (if uploaded before), otherwise the previous version's files (parent, or twin).
  uploaded files are applied on top of the base: new path → added, existing path with different content → replaced,
  identical content → unchanged. A file that was not uploaded is **never deleted** (deletion is manual).
"""
import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from . import config, projects_service, table_io
from .errors import ServiceError

CID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
BAD_SEGMENT = re.compile(r'[<>:"|?*\x00-\x1f]')
_lock = threading.Lock()  # concurrent manifest writes


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------- Paths ----------
def normalize_path(raw: str) -> str:
    """Safe relative path using '/'; anything dangerous (absolute, .., Windows-forbidden characters) raises an error."""
    p = (raw or "").replace("\\", "/").strip()
    if not p or p.startswith("/") or re.match(r"^[A-Za-z]:", p):
        raise ServiceError(f"مسیر فایل نامعتبر است: «{raw}»")
    parts = []
    for seg in p.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            raise ServiceError(f"مسیر فایل نامعتبر است (..): «{raw}»")
        if BAD_SEGMENT.search(seg) or seg.endswith((" ", ".")) or len(seg) > 255:
            raise ServiceError(f"نام فایل/پوشه نامعتبر است: «{raw}»")
        parts.append(seg)
    if not parts:
        raise ServiceError(f"مسیر فایل نامعتبر است: «{raw}»")
    out = "/".join(parts)
    if len(out) > config.MAX_VERSION_PATH_LEN:
        raise ServiceError(f"مسیر خیلی طولانی است: «{out[:60]}…»")
    return out


def is_ignored(path: str) -> bool:
    parts = path.split("/")
    return any(s in config.IGNORED_DIRS for s in parts[:-1]) or parts[-1] in config.IGNORED_FILES


def _store(project: dict) -> Path:
    return Path(project["path"]) / config.STORE_DIRNAME


def _object_path(project: dict, h: str) -> Path:
    return _store(project) / "objects" / h[:2] / h


def _manifest_path(project: dict, cid: str) -> Path:
    return _store(project) / "manifests" / f"{cid}.json"


# ---------- manifest ----------
def _timeline(project: dict) -> dict:
    tl = projects_service.load_timeline(project)
    if not tl:
        raise ServiceError("تایم‌لاین هنوز ذخیره نشده؛ چند ثانیه صبر کن و دوباره امتحان کن.", 409)
    return tl


def _commit(tl: dict, cid: str) -> dict:
    if not CID_RE.match(cid or ""):
        raise ServiceError("نسخه پیدا نشد.", 404)
    for c in tl["commits"]:
        if c["id"] == cid:
            return c
    raise ServiceError("این نسخه در تایم‌لاینِ ذخیره‌شده نیست.", 404)


def load_manifest(project: dict, cid: str):
    path = _manifest_path(project, cid)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data.get("files"), dict):
            raise ValueError
        return data
    except ValueError:
        raise ServiceError(f"فایل فهرست این نسخه خراب است: {path.name}", 500)


def resolve(project: dict, tl: dict, cid: str):
    """(manifest, id of the version the manifest belongs to); if the version has no files it is inherited from parent/twin."""
    commits = {c["id"]: c for c in tl["commits"]}
    seen, cur = set(), cid
    while cur in commits and cur not in seen:
        seen.add(cur)
        m = load_manifest(project, cur)
        if m:
            return m, cur
        cur = commits[cur].get("parent") or commits[cur].get("twin")
    return None, None


# ---------- List ----------
def files_info(project: dict, cid: str) -> dict:
    tl = _timeline(project)
    commit = _commit(tl, cid)
    m, owner = resolve(project, tl, cid)
    files = (m or {}).get("files", {})
    names = {c["id"]: c["name"] for c in tl["commits"]}
    return {
        "has_app": any(p.lower() == config.RUN_ENTRY_FILE for p in files),  # first layer only (no "/" in the path)
        "default_export_dir": str(Path(project["path"]) / config.EXPORTS_DIRNAME),
        "folder_name": _export_name(project, commit),
        "own": owner == cid,
        "inherited_from": None if owner in (None, cid) else {"id": owner, "name": names.get(owner, "")},
        "count": len(files),
        "total_size": sum(f["s"] for f in files.values()),
        "updated_at": (m or {}).get("updated_at"),
        "files": [{"path": p, "size": files[p]["s"]} for p in sorted(files, key=str.lower)],
    }


# ---------- Upload ----------
def _ingest(project: dict, stream) -> tuple:
    """Writes the stream to a temp file and returns (hash, size, tmp_path)."""
    tmp_dir = _store(project) / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    limit = config.MAX_VERSION_FILE_MB * 1024 * 1024
    h, size = hashlib.sha256(), 0
    fd, tmp = tempfile.mkstemp(dir=tmp_dir)
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise ServiceError(f"حجم یک فایل از {config.MAX_VERSION_FILE_MB} مگابایت بیشتر است.", 413)
                h.update(chunk)
                out.write(chunk)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return h.hexdigest(), size, Path(tmp)


def upload(project: dict, cid: str, items: list) -> dict:
    """items: list of (relative path, file stream). Returns a summary of the changes."""
    folder = Path(project["path"])
    if not folder.is_dir():
        raise ServiceError("پوشه‌ی پروژه روی دیسک پیدا نشد.", 404)
    tl = _timeline(project)
    _commit(tl, cid)

    # paths: normalize, skip junk folders (.git etc.), prevent duplicates
    clean, ignored, seen = [], 0, set()
    for raw, stream in items:
        path = normalize_path(raw)
        if is_ignored(path):
            ignored += 1
            continue
        if path.lower() in seen:
            raise ServiceError(f"یک مسیر دو بار آمده است: «{path}»")
        seen.add(path.lower())
        clean.append((path, stream))
    if not clean:
        raise ServiceError("فایلی برای آپلود نمانده است" + (f" ({ignored} فایل در پوشه‌های نادیده‌گرفته‌شده بود)." if ignored else "."))

    with _lock:
        m, owner = resolve(project, tl, cid)
        base = dict(m["files"]) if m else {}
        lower = {k.lower(): k for k in base}
        files, added, modified, unchanged = dict(base), [], [], 0
        pending = []  # (key, hash, size, tmp) until all paths are validated

        try:
            for path, stream in clean:
                key = lower.get(path.lower(), path)  # letter case: if the path already existed, its key stays the same
                h, size, tmp = _ingest(project, stream)
                pending.append((key, h, size, tmp))

            # conflict of a "file" with a "folder"
            keys = {**{k.lower(): k for k in files}, **{k.lower(): k for k, *_ in pending}}
            for k in keys.values():
                parts = k.split("/")
                for i in range(1, len(parts)):
                    if "/".join(parts[:i]).lower() in keys:
                        raise ServiceError(f"«{'/'.join(parts[:i])}» هم فایل است و هم پوشه.")

            for key, h, size, tmp in pending:
                old = files.get(key)
                if old and old["h"] == h:
                    unchanged += 1
                    continue
                obj = _object_path(project, h)
                if not obj.exists():
                    obj.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(tmp, obj)
                files[key] = {"h": h, "s": size}
                (modified if old else added).append(key)
        finally:
            for *_, tmp in pending:
                tmp.unlink(missing_ok=True)

        if added or modified or owner != cid:  # a version without files of its own gets a manifest even if everything is identical
            now = _now()
            manifest = {
                "version": 1, "commit": cid, "created_at": (m or {}).get("created_at", now) if owner == cid else now,
                "updated_at": now, "files": files,
            }
            table_io.atomic_write_bytes(
                _manifest_path(project, cid), json.dumps(manifest, ensure_ascii=False, indent=1).encode("utf-8")
            )

    return {"added": sorted(added), "modified": sorted(modified), "unchanged": unchanged,
            "ignored": ignored, "total": len(files)}


# ---------- Export ----------
def export_zip(project: dict, cid: str):
    """(open zip file, suggested name). Returns the current version's files (including those inherited from earlier versions)."""
    tl = _timeline(project)
    commit = _commit(tl, cid)
    m, _ = resolve(project, tl, cid)
    if not m or not m["files"]:
        raise ServiceError("این نسخه (و نسخه‌های قبل از آن) فایلی ندارد.", 404)
    out = tempfile.SpooledTemporaryFile(max_size=32 * 1024 * 1024)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(m["files"], key=str.lower):
            obj = _object_path(project, m["files"][path]["h"])
            if not obj.is_file():
                raise ServiceError(f"محتوای «{path}» در ذخیره‌گاه پیدا نشد.", 500)
            zf.write(obj, arcname=path)
    out.seek(0)
    return out, _export_name(project, commit) + ".zip"


def _export_name(project: dict, commit: dict) -> str:
    """Name of the exported zip/folder: <project>-v<version name>."""
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", project["name"]).strip() or "project"
    return f"{safe}-v{re.sub(r'[^A-Za-z0-9._-]', '_', commit['name'])}"


def current_files(project: dict, cid: str):
    """(commit, manifest or None) of a version; the manifest is inherited from parent/twin when needed."""
    tl = _timeline(project)
    commit = _commit(tl, cid)
    m, _ = resolve(project, tl, cid)
    return commit, m


# ---------- Edit the file list of a version (rename / delete / copy / move) ----------
# Only the manifest changes (content is stored by hash), so these operations are instant and free.
# A version that has no manifest of its own first takes a snapshot of the inherited files; the other versions are untouched.
FILE_OPS = ("rename", "delete", "copy", "move")
MAX_EDIT_PATHS = 2000


def _under(path: str, folder: str) -> bool:
    return path.lower().startswith(folder.lower() + "/")


def _select(files: dict, paths: list) -> list:
    """Selected items as [(path, is_dir)]; a path inside another selected folder is dropped."""
    items = []
    for raw in paths:
        p = (raw or "").replace("\\", "/").strip("/")
        if p in files:
            items.append((p, False))
        elif any(_under(k, p) for k in files) and p:
            items.append((p, True))
        else:
            raise ServiceError(f"«{raw}» در این نسخه پیدا نشد.", 404)
    folders = [p for p, d in items if d]
    out, seen = [], set()
    for p, d in items:
        if p.lower() in seen or any(_under(p, f) for f in folders if f != p):
            continue
        seen.add(p.lower())
        out.append((p, d))
    return out


def _expand(files: dict, item: tuple) -> list:
    """All manifest keys that belong to a selected item."""
    path, is_dir = item
    return [path] if not is_dir else [k for k in files if _under(k, path)]


def _unique_copy_name(taken: set, folder: str, name: str, is_dir: bool) -> str:
    stem, ext = (name, "") if is_dir or "." not in name.strip(".") else name.rsplit(".", 1)
    ext = "." + ext if ext else ""
    for n in range(1, 1000):
        cand = f"{stem} - copy{'' if n == 1 else ' ' + str(n)}{ext}"
        full = f"{folder}/{cand}" if folder else cand
        if not any(k == full.lower() or k.startswith(full.lower() + "/") for k in taken):
            return cand
    raise ServiceError("نام تازه برای کپی پیدا نشد.")


def edit_files(project: dict, cid: str, op: str, paths, dest: str = "", new_name: str = "", overwrite: bool = False) -> dict:
    """op: rename (one item + new_name) | delete | copy / move (items -> folder dest, '' = root).
    A path may be a file or a folder (all files under it). Returns {affected, **files_info}."""
    if op not in FILE_OPS:
        raise ServiceError("عملیات نامعتبر است.")
    if not isinstance(paths, list) or not paths or not all(isinstance(p, str) for p in paths):
        raise ServiceError("چیزی انتخاب نشده است.")
    if len(paths) > MAX_EDIT_PATHS:
        raise ServiceError("تعداد موردهای انتخاب‌شده خیلی زیاد است.", 413)
    tl = _timeline(project)
    _commit(tl, cid)

    with _lock:
        m, owner = resolve(project, tl, cid)
        if not m or not m["files"]:
            raise ServiceError("این نسخه (و نسخه‌های قبل از آن) فایلی ندارد.", 404)
        files = dict(m["files"])
        items = _select(files, paths)

        # old key -> new key (None = removed)
        plan, affected = {}, 0
        if op == "delete":
            for it in items:
                for k in _expand(files, it):
                    plan[k] = None
        elif op == "rename":
            if len(items) != 1:
                raise ServiceError("برای تغییر نام فقط یک مورد را انتخاب کن.")
            path, is_dir = items[0]
            name = normalize_path(new_name)
            if "/" in name:
                raise ServiceError("نام جدید نباید «/» داشته باشد.")
            parent = path.rsplit("/", 1)[0] if "/" in path else ""
            target = f"{parent}/{name}" if parent else name
            if target == path:
                raise ServiceError("نام تغییری نکرده است.")
            for k in _expand(files, items[0]):
                plan[k] = target + k[len(path):]
        else:  # copy / move
            folder = normalize_path(dest) if (dest or "").strip("/ ") else ""
            if folder and folder in files:
                raise ServiceError(f"«{folder}» یک فایل است، نه پوشه.")
            taken = {k.lower() for k in files}
            for path, is_dir in items:
                if is_dir and folder and (folder.lower() == path.lower() or _under(folder, path)):
                    raise ServiceError(f"پوشه‌ی «{path}» را نمی‌شود داخل خودش گذاشت.")
                base = path.rsplit("/", 1)[-1]
                parent = path.rsplit("/", 1)[0] if "/" in path else ""
                if parent == folder:  # same place
                    if op == "move":
                        continue
                    base = _unique_copy_name(taken, folder, base, is_dir)
                target = f"{folder}/{base}" if folder else base
                for k in _expand(files, (path, is_dir)):
                    plan[k] = target + k[len(path):]
                    taken.add(plan[k].lower())
            if not plan:
                raise ServiceError("چیزی تغییر نکرد (مقصد همان جای فعلی است).")

        affected = len(plan)
        moved = {k for k, v in plan.items() if v is not None and op != "copy"} | {k for k, v in plan.items() if v is None}
        remaining = {k: v for k, v in files.items() if k not in moved}
        new_keys = [v for v in plan.values() if v is not None]

        # two sources landing on the same name
        low = [k.lower() for k in new_keys]
        if len(set(low)) != len(low):
            raise ServiceError("دو مورد با نام یکسان به یک جا می‌روند.")
        # file vs folder clash, and same-name files that would be replaced
        rem_low = {k.lower(): k for k in remaining}
        clash = []
        for k in new_keys:
            parts = k.split("/")
            for i in range(1, len(parts)):
                if "/".join(parts[:i]).lower() in rem_low:
                    raise ServiceError(f"«{'/'.join(parts[:i])}» هم فایل است و هم پوشه.")
            if any(r.startswith(k.lower() + "/") for r in rem_low):
                raise ServiceError(f"«{k}» هم فایل است و هم پوشه.")
            if k.lower() in rem_low:
                clash.append(k)
        if clash and not overwrite:
            more = f" و {len(clash) - 3} مورد دیگر" if len(clash) > 3 else ""
            raise ServiceError("این‌ها از قبل هستند: " + "، ".join(clash[:3]) + more, 409, ["exists"])

        result = dict(remaining)
        for k in clash:
            result.pop(rem_low[k.lower()], None)
        for old, new in plan.items():
            if new is not None:
                result[new] = files[old]

        now = _now()
        manifest = {"version": 1, "commit": cid, "created_at": m.get("created_at", now) if owner == cid else now,
                    "updated_at": now, "files": result}
        table_io.atomic_write_bytes(
            _manifest_path(project, cid), json.dumps(manifest, ensure_ascii=False, indent=1).encode("utf-8")
        )

    return {"affected": affected, **files_info(project, cid)}


def _inside(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def write_files(project: dict, manifest: dict, dest: Path) -> int:
    """Copies every file of a manifest from the store into the folder dest (existing files are overwritten,
    nothing is deleted). Returns the number of files."""
    files = manifest["files"]
    try:
        dest.mkdir(parents=True, exist_ok=True)
        root = dest.resolve()
        for path in sorted(files, key=str.lower):
            obj = _object_path(project, files[path]["h"])
            if not obj.is_file():
                raise ServiceError(f"محتوای «{path}» در ذخیره‌گاه پیدا نشد.", 500)
            target = (root / path).resolve()
            if not _inside(target, root):  # paths are validated on upload; this is a second line of defense
                raise ServiceError(f"مسیر فایل نامعتبر است: «{path}»", 400)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(obj, target)
    except OSError as exc:
        raise ServiceError(f"نوشتن فایل‌ها ممکن نشد: {exc.strerror or exc}", 400)
    return len(files)


def export_folder(project: dict, cid: str, dest_base: str, overwrite: bool = False) -> dict:
    """Saves a version's files as a folder <dest_base>/<project>-v<version>/.
    Empty dest_base = the project's default exports folder."""
    commit, m = current_files(project, cid)
    if not m or not m["files"]:
        raise ServiceError("این نسخه (و نسخه‌های قبل از آن) فایلی ندارد.", 404)
    raw = (dest_base or "").strip()
    base = projects_service.resolve_base_path(raw) if raw else Path(project["path"]) / config.EXPORTS_DIRNAME
    folder = base / _export_name(project, commit)
    if _inside(folder.resolve(), _store(project).resolve()):
        raise ServiceError("مسیر خروجی نباید داخل پوشه‌ی store پروژه باشد.", 400)
    if folder.exists():
        if not folder.is_dir():
            raise ServiceError("این مسیر یک پوشه نیست.", 400)
        if any(folder.iterdir()) and not overwrite:
            raise ServiceError("پوشه‌ی مقصد از قبل هست و خالی نیست.", 409, ["exists"])
    count = write_files(project, m, folder)
    return {"path": str(folder), "count": count}
