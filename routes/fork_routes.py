"""Sharing a project with chosen employees (admin) and keeping their forks up to date with main (the fork's owner)."""
from flask import Blueprint, jsonify, request, session

from services import forks_service, projects_service, security
from services.errors import ServiceError

bp = Blueprint("forks", __name__)


def _main(pid):
    main = projects_service.get_project(session["company_id"], pid)
    if forks_service.is_fork(main):
        raise ServiceError("پروژه‌ی اصلی پیدا نشد.", 404)
    return main


# ---------- share (admin) ----------
@bp.get("/api/projects/<pid>/shares")
@security.login_required
@security.admin_required
def shares(pid):
    """Employees of the company and who already has a copy of this project."""
    return jsonify(people=forks_service.share_candidates(session["company_id"], _main(pid)))


@bp.post("/api/projects/<pid>/shares")
@security.login_required
@security.admin_required
def share(pid):
    """Shares the project with the chosen employees: each of them gets a fork of main's latest version at once."""
    ids = (request.get_json(silent=True) or {}).get("user_ids")
    if not isinstance(ids, list) or not ids:
        raise ServiceError("حداقل یک نفر را انتخاب کن.", 400)
    return jsonify(forks_service.share_with(session["company_id"], _main(pid), ids[:200]))


# ---------- keep a fork up to date (its owner) ----------
def _my_fork(fid):
    fork = projects_service.get_project(session["company_id"], fid)
    forks_service.assert_access(fork, security.current_user(), write=True)
    if not forks_service.is_fork(fork):
        raise ServiceError("این پروژه یک نسخه‌ی تیمی نیست.", 400)
    return fork


@bp.post("/api/projects/<fid>/sync/pull")
@security.login_required
def sync_pull(fid):
    return jsonify(forks_service.sync_pull(session["company_id"], _my_fork(fid)))


@bp.post("/api/projects/<fid>/sync/ack")
@security.login_required
def sync_ack(fid):
    forks_service.sync_ack(session["company_id"], _my_fork(fid), (request.get_json(silent=True) or {}).get("ids"))
    return jsonify(ok=True)
