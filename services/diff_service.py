"""Side-by-side diff of a version's files against the previous version (parent, or twin for a same-name node).

Nothing is written; the content comes from the hash store (see versions_service.py). The `path` the client sends is
only used as a key in the manifest, never as a disk path.

Row format of a file diff (short lists to keep the payload small):
  ["=", old_no, old_text, new_no, new_text]   unchanged
  ["~", old_no, old_text, new_no, new_text]   changed line
  ["-", old_no, old_text, None, None]         only in the previous version
  ["+", None, None, new_no, new_text]         only in this version
  ["s", hidden_count]                         a run of unchanged lines that was collapsed
"""
import difflib
from itertools import zip_longest

from . import config, versions_service
from .errors import ServiceError


def _context(project: dict, cid: str):
    """(commit, previous commit or None, current files, previous files)."""
    tl = versions_service._timeline(project)
    commit = versions_service._commit(tl, cid)
    prev_id = commit.get("parent") or commit.get("twin")
    prev = next((c for c in tl["commits"] if c["id"] == prev_id), None) if prev_id else None
    cur_m, _ = versions_service.resolve(project, tl, cid)
    prev_m, _ = versions_service.resolve(project, tl, prev["id"]) if prev else (None, None)
    return commit, prev, (cur_m or {}).get("files", {}), (prev_m or {}).get("files", {})


def _status(path: str, cur: dict, prev: dict):
    if path in cur and path not in prev:
        return "added"
    if path in prev and path not in cur:
        return "removed"
    if cur[path]["h"] != prev[path]["h"]:
        return "modified"
    return None


def summary(project: dict, cid: str) -> dict:
    """Which files changed in this version compared with the previous one."""
    commit, prev, cur, old = _context(project, cid)
    changed = []
    for path in sorted(set(cur) | set(old), key=str.lower):
        st = _status(path, cur, old)
        if st:
            changed.append({
                "path": path, "status": st,
                "old_size": old[path]["s"] if path in old else None,
                "new_size": cur[path]["s"] if path in cur else None,
            })
    return {
        "name": commit["name"], "note": commit.get("note", ""),
        "prev": {"id": prev["id"], "name": prev["name"]} if prev else None,
        "files": changed,
    }


def _read(project: dict, files: dict, path: str):
    """Bytes of a file in a manifest, or None if the file is not there."""
    if path not in files:
        return None
    obj = versions_service._object_path(project, files[path]["h"])
    if not obj.is_file():
        raise ServiceError(f"محتوای «{path}» در ذخیره‌گاه پیدا نشد.", 500)
    return obj.read_bytes()


def _lines(data):
    if data is None:
        return []
    return data.decode("utf-8-sig", errors="replace").splitlines()


def _rows(old: list, new: list) -> list:
    rows = []
    sm = difflib.SequenceMatcher(None, old, new, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                rows.append(["=", i1 + k + 1, old[i1 + k], j1 + k + 1, new[j1 + k]])
            continue
        for k, (a, b) in enumerate(zip_longest(range(i1, i2), range(j1, j2))):
            if a is not None and b is not None:
                rows.append(["~", a + 1, old[a], b + 1, new[b]])
            elif a is not None:
                rows.append(["-", a + 1, old[a], None, None])
            else:
                rows.append(["+", None, None, b + 1, new[b]])
    return rows


def _collapse(rows: list) -> list:
    """Keeps DIFF_CONTEXT_LINES unchanged lines around each change; the rest becomes one ["s", n] row."""
    ctx = config.DIFF_CONTEXT_LINES
    keep = [False] * len(rows)
    for i, r in enumerate(rows):
        if r[0] != "=":
            for j in range(max(0, i - ctx), min(len(rows), i + ctx + 1)):
                keep[j] = True
    out, hidden = [], 0
    for r, k in zip(rows, keep):
        if k:
            if hidden:
                out.append(["s", hidden])
                hidden = 0
            out.append(r)
        else:
            hidden += 1
    if hidden:
        out.append(["s", hidden])
    return out


def file_diff(project: dict, cid: str, path: str) -> dict:
    """Side-by-side rows of one changed file."""
    _, prev, cur, old = _context(project, cid)
    if path not in cur and path not in old:
        raise ServiceError("این فایل در این نسخه یا نسخه‌ی قبل نیست.", 404)
    status = _status(path, cur, old) if (path in cur or path in old) else None
    if not status:
        return {"path": path, "status": "same", "rows": []}

    limit = config.DIFF_MAX_FILE_KB * 1024
    sizes = [f[path]["s"] for f in (cur, old) if path in f]
    if max(sizes) > limit:
        return {"path": path, "status": status, "too_large": True, "limit_kb": config.DIFF_MAX_FILE_KB}

    a, b = _read(project, old, path), _read(project, cur, path)
    if any(d is not None and b"\x00" in d[:8000] for d in (a, b)):
        return {"path": path, "status": status, "binary": True}

    la, lb = _lines(a), _lines(b)
    if max(len(la), len(lb)) > config.DIFF_MAX_LINES:
        return {"path": path, "status": status, "too_large": True, "limit_lines": config.DIFF_MAX_LINES}

    rows = _rows(la, lb)
    return {
        "path": path, "status": status,
        "plus": sum(1 for r in rows if r[0] in "~+"), "minus": sum(1 for r in rows if r[0] in "~-"),
        "rows": _collapse(rows),
    }
