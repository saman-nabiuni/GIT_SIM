"""Team forks: a private copy of a project's latest main version, so a team member can work without any
chance of touching the main timeline or its files.

A fork is a normal project record (in the company's projects.json) with extra keys:
  fork_of (main project id), owner_id, owner_name, base_commit, base_name.
Its folder lives inside the main project: <main>/forks/<user>-<id>/ with its own project.json, timeline.json and store/.
The fork's timeline starts with ONE node: a copy of the last node of main (same id, name and files).
Files are shared with main by hard links (copy if links are not possible); objects are never modified, so this is safe.

The owner (admin) shares a project with chosen employees (share_with); that creates their fork at once.
New versions on main's own line later reach every fork by itself (sync_pull / sync_ack, see docs/forks-and-team.md):
the SERVER only copies the files into the fork's store and tells the browser about the new nodes; the member's
browser adds them to its own timeline and saves it, so the member's own work is never overwritten.

Access rules (access_level / assert_access):
  main project : admin (user_id 0) read + write; team members cannot open it.
  fork         : its owner read + write; the admin read only (to see the work); other members cannot see it.
"""
import hashlib
import json
import os
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import config, employees_service, projects_service, table_io, versions_service
from .errors import ServiceError
from .users_service import norm_id

_lock = threading.Lock()       # creating forks: read list -> write list
_sync_lock = threading.Lock()  # sync.json of a fork: read -> change -> write
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
SYNC_FILE = "sync.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def is_fork(project: dict) -> bool:
    return bool(project.get("fork_of"))


# ---------- access ----------
def access_level(project: dict, user: dict):
    """'write', 'read' or None (= the user must not even know the project exists)."""
    admin = user["role"] == "admin"
    if not is_fork(project):
        return "write" if admin else None
    if project.get("owner_id") == user["user_id"]:
        return "write"
    return "read" if admin else None


def assert_access(project: dict, user: dict, write: bool = False) -> None:
    level = access_level(project, user)
    if level is None:
        raise ServiceError("پروژه پیدا نشد.", 404)
    if write and level != "write":
        raise ServiceError("این نسخه‌ی یکی از اعضای تیم است و برای جلوگیری از تغییر ناخواسته فقط‌خواندنی است.", 403)


# ---------- create ----------
def _safe_part(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", text or "").strip("_")[:20] or "user"


def _main_tip(tl: dict) -> dict:
    """The last node of the main branch (branches[0]) in creation order."""
    tip = next((c for c in reversed(tl["commits"]) if c["branch"] == 0), None)
    if tip is None:
        raise ServiceError("در شاخه‌ی main هنوز نسخه‌ای نیست.", 409)
    return tip


def _link_or_copy(src: Path, dst: Path) -> None:
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copyfile(src, dst)


def create_fork(company_id: str, main: dict, user: dict):
    """Returns (fork project, created). If this user already has a fork of the project, that one is returned."""
    if is_fork(main):
        raise ServiceError("از روی یک نسخه‌ی تیمی نمی‌شود فورک ساخت.", 400)
    if main.get("missing"):
        raise ServiceError("پوشه‌ی پروژه‌ی اصلی روی دیسک پیدا نشد.", 404)

    with _lock:
        records = projects_service._read_list(company_id)
        mine = next((p for p in records if p.get("fork_of") == main["id"] and p.get("owner_id") == user["user_id"]), None)
        if mine:
            return projects_service._decorate(mine), False
        if sum(1 for p in records if p.get("fork_of") == main["id"]) >= config.MAX_FORKS_PER_PROJECT:
            raise ServiceError("تعداد نسخه‌های تیمی این پروژه به حد مجاز رسیده است.", 409)

        tl = projects_service.load_timeline(main)
        if not tl:
            raise ServiceError("تایم‌لاین پروژه‌ی اصلی هنوز ذخیره نشده؛ مدیر باید یک‌بار آن را باز کند.", 409)
        tip = _main_tip(tl)
        manifest, _ = versions_service.resolve(main, tl, tip["id"])

        fid = uuid.uuid4().hex[:12]
        folder = Path(main["path"]) / config.FORKS_DIRNAME / f"{_safe_part(user['username'])}-{fid[:6]}"
        name = f"{main['name']} · {user['username']}"
        fork = {"id": fid, "name": name, "path": str(folder)}
        created = False  # only a folder created here may be removed again on failure
        try:
            folder.mkdir(parents=True, exist_ok=False)
            created = True
            files = dict(manifest["files"]) if manifest else {}
            _install_manifest(main, folder, tip["id"], files)
            timeline = {
                "version": 1, "mode": tl.get("mode", "dec"), "ideas": [],
                "branches": [{"name": "main", "shade": 0}],
                "commits": [{"id": tip["id"], "name": tip["name"], "branch": 0, "parent": None, "twin": None,
                             "base": tip["base"], "color": tip["color"], "note": f"شروع از آخرین نسخه‌ی main ({tip['name']})"}],
            }
            projects_service.save_timeline(fork, timeline)
            record = {"id": fid, "name": name, "path": str(folder), "created_at": _now(), "fork_of": main["id"],
                      "owner_id": user["user_id"], "owner_name": user["username"],
                      "base_commit": tip["id"], "base_name": tip["name"]}
            _write_sync(folder, {"version": 1, "known": _main_ids(tl), "copied": {tip["id"]: _sig(files)}})
            table_io.atomic_write_bytes(
                folder / "project.json",
                json.dumps({**record, "company_id": company_id, "version": 1}, ensure_ascii=False, indent=2).encode("utf-8"),
            )
            projects_service._write_list(company_id, records + [record])
        except OSError as exc:
            if created:
                shutil.rmtree(folder, ignore_errors=True)
            raise ServiceError(f"ساخت نسخه‌ی تیمی ممکن نشد: {exc.strerror or exc}", 400)
        except BaseException:
            if created:
                shutil.rmtree(folder, ignore_errors=True)
            raise
    return projects_service._decorate(record), True


def _install_manifest(main: dict, folder: Path, cid: str, files: dict) -> None:
    """Objects (hard links) + the manifest of one version go into the fork's own store. No files = nothing is written."""
    if not files:
        return
    src_root = Path(main["path"]) / config.STORE_DIRNAME / "objects"
    dst_root = folder / config.STORE_DIRNAME / "objects"
    for h in {f["h"] for f in files.values()}:
        if not HASH_RE.match(h):
            raise ServiceError("فهرست فایل‌های پروژه‌ی اصلی خراب است.", 500)
        src = src_root / h[:2] / h
        if not src.is_file():
            raise ServiceError("محتوای یکی از فایل‌ها در ذخیره‌گاه پروژه‌ی اصلی پیدا نشد.", 500)
        _link_or_copy(src, dst_root / h[:2] / h)
    now = _now()
    own = {"version": 1, "commit": cid, "created_at": now, "updated_at": now, "files": files}
    with versions_service._lock:  # same lock as uploads, so a refresh never interleaves with the member's own upload
        table_io.atomic_write_bytes(
            folder / config.STORE_DIRNAME / "manifests" / f"{cid}.json",
            json.dumps(own, ensure_ascii=False, indent=1).encode("utf-8"),
        )


# ---------- list ----------
def _last_activity(p: dict) -> str:
    stamps = [p["updated_at"]]
    try:
        mt = (Path(p["path"]) / config.STORE_DIRNAME / "manifests").stat().st_mtime
        stamps.append(datetime.fromtimestamp(mt, timezone.utc).isoformat(timespec="seconds"))
    except OSError:
        pass
    return max(stamps)


def _summary(p: dict) -> dict:
    try:
        tl = projects_service.load_timeline(p)
        versions = max(0, len(tl["commits"]) - 1) if tl else 0  # the base node is not the member's work
    except ServiceError:
        versions = None
    return {**p, "versions": versions, "last_activity": _last_activity(p)}


def forks_for(user: dict, projects: list) -> dict:
    """{main project id: [fork summaries]}; the admin sees all forks, a member only their own."""
    out = {}
    for p in projects:
        if not is_fork(p):
            continue
        if user["role"] != "admin" and p.get("owner_id") != user["user_id"]:
            continue
        out.setdefault(p["fork_of"], []).append(_summary(p))
    for items in out.values():
        items.sort(key=lambda f: f["last_activity"], reverse=True)
    return out


# ---------- share with chosen employees ----------
def share_candidates(company_id: str, main: dict) -> list:
    """Employees (user_id != 0) of the company, each with the fork they already have of this project (or None)."""
    _, rows = employees_service.load(company_id)
    forks = {p.get("owner_id"): p for p in projects_service.list_projects(company_id) if p.get("fork_of") == main["id"]}
    out, seen = [], set()
    for row in rows:
        uid, name = norm_id(row.get("user_id", "")), (row.get("username") or "").strip()
        if not uid or uid == config.ADMIN_USER_ID or not name or uid in seen:
            continue
        seen.add(uid)
        fork = forks.get(uid)
        out.append({"user_id": uid, "username": name, "has_password": bool(row.get("password")),
                    "fork_id": fork["id"] if fork else None})
    return out


def share_with(company_id: str, main: dict, user_ids: list) -> dict:
    """Creates a fork for each chosen employee (the ones who already have one are skipped)."""
    people = {p["user_id"]: p for p in share_candidates(company_id, main)}
    result = {"created": [], "existing": [], "failed": []}
    for raw in dict.fromkeys(str(u) for u in user_ids):
        person = people.get(norm_id(raw))
        if person is None:
            result["failed"].append({"user_id": raw, "error": "چنین کارمندی در فایل کارمندان نیست."})
            continue
        try:
            _, created = create_fork(company_id, main, {"user_id": person["user_id"], "username": person["username"], "role": "member"})
        except ServiceError as exc:
            result["failed"].append({"user_id": person["user_id"], "username": person["username"], "error": exc.message})
            continue
        result["created" if created else "existing"].append(person["username"])
    return result


# ---------- new versions of main reach the forks ----------
# sync.json in the fork folder: {"known": [main-line node ids the fork was already told about],
#                                "copied": {node id: fingerprint of the files copied from main}}.
# A copied version whose files in the fork still match that fingerprint is "untouched" and may be refreshed when the
# owner uploads more files into it on main; a version the member changed is never overwritten.
def _sig(files: dict) -> str:
    """Fingerprint of a version's file list; "" = no files."""
    return hashlib.sha256(json.dumps(files, sort_keys=True).encode("utf-8")).hexdigest() if files else ""


def _main_ids(tl: dict) -> list:
    """Node ids of main's own line (branches[0]); only these are sent to the forks."""
    return [c["id"] for c in tl["commits"] if c["branch"] == 0]


def _main_files(main: dict, main_tl: dict, cid: str) -> dict:
    m, _ = versions_service.resolve(main, main_tl, cid)  # inherited files included
    return dict(m["files"]) if m else {}


def _write_sync(folder, state: dict) -> None:
    table_io.atomic_write_bytes(Path(folder) / SYNC_FILE, json.dumps(state, ensure_ascii=False, indent=1).encode("utf-8"))


def _read_sync(fork: dict, main: dict, main_tl: dict) -> dict:
    try:
        state = json.loads((Path(fork["path"]) / SYNC_FILE).read_text(encoding="utf-8"))
        if isinstance(state.get("known"), list) and isinstance(state.get("copied"), dict):
            return state
    except (OSError, ValueError):
        pass
    # a fork made before sync existed: everything up to its base version is known; the base's files are refreshed only
    # if they still equal main's (so nothing the member may have changed can be overwritten)
    ids = _main_ids(main_tl)
    base = fork.get("base_commit")
    state = {"version": 1, "known": ids[: ids.index(base) + 1] if base in ids else ids, "copied": {}}
    if base in ids:
        main_files = _main_files(main, main_tl, base)
        own = versions_service.load_manifest(fork, base)
        if own and _sig(own["files"]) == _sig(main_files):
            state["copied"][base] = _sig(main_files)
    return state


def _main_of(company_id: str, fork: dict):
    if not is_fork(fork):
        raise ServiceError("این پروژه یک نسخه‌ی تیمی نیست.", 400)
    main = projects_service.get_project(company_id, fork["fork_of"])
    return main, (None if main.get("missing") else projects_service.load_timeline(main))


def sync_pull(company_id: str, fork: dict) -> dict:
    """Copies the files of main's new versions into the fork and returns those nodes for the member's browser.
    Nothing is marked as delivered here (see sync_ack); asking again returns the same nodes until they are acknowledged."""
    main, main_tl = _main_of(company_id, fork)
    out = {"nodes": [], "base": fork.get("base_commit")}
    if not main_tl:
        return out
    folder = Path(fork["path"])
    with _sync_lock:
        state = _read_sync(fork, main, main_tl)
        changed = not (folder / SYNC_FILE).exists()
        known = set(state["known"])
        in_main = {c["id"] for c in main_tl["commits"]}
        fresh = [c for c in main_tl["commits"] if c["branch"] == 0 and c["id"] not in known]

        for c in fresh:  # files of the new versions
            files = _main_files(main, main_tl, c["id"])
            _install_manifest(main, folder, c["id"], files)
            state["copied"][c["id"]] = _sig(files)
            changed = True

        for cid, sig in list(state["copied"].items()):  # more files uploaded later into an already copied version
            if cid not in in_main or any(c["id"] == cid for c in fresh):
                continue
            files = _main_files(main, main_tl, cid)
            if not files or _sig(files) == sig:
                continue
            own = versions_service.load_manifest(fork, cid)
            if (_sig(own["files"]) if own else "") != sig:
                continue  # the member changed this version's files: keep them
            _install_manifest(main, folder, cid, files)
            state["copied"][cid] = _sig(files)
            changed = True

        if changed:
            _write_sync(folder, state)
    for c in fresh:
        out["nodes"].append({"id": c["id"], "name": c["name"], "parent": c.get("parent") or c.get("twin"),
                             "base": c["base"], "color": c["color"], "note": c.get("note", "")})
    return out


def sync_ack(company_id: str, fork: dict, ids) -> None:
    """The member's browser saved the nodes: from now on they are not sent again (even if the member deletes them)."""
    main, main_tl = _main_of(company_id, fork)
    if not main_tl or not isinstance(ids, list):
        return
    valid = set(_main_ids(main_tl))
    with _sync_lock:
        state = _read_sync(fork, main, main_tl)
        state["known"] = list(dict.fromkeys(state["known"] + [i for i in ids if isinstance(i, str) and i in valid]))
        _write_sync(fork["path"], state)
