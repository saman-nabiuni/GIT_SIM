"""A project's timeline page + save/load the timeline (timeline.json in the project folder)
+ files of each version: listing, upload (file/folder), zip export and diff against the previous version."""
import json
from pathlib import Path

from flask import Blueprint, jsonify, render_template, request, send_file, session

from services import config, diff_service, forks_service, package_service, projects_service, run_service, security, versions_service
from services.errors import ServiceError

bp = Blueprint("project", __name__)


def _project(pid, write=False):
    """The project, only if the logged-in user may see it (write=True: may change it).
    Main project: admin only. A fork: its owner (read+write) and the admin (read only)."""
    project = projects_service.get_project(session["company_id"], pid)
    forks_service.assert_access(project, security.current_user(), write)
    return project


@bp.get("/project/<pid>")
@security.login_required
def timeline_page(pid):
    project = _project(pid)
    readonly = forks_service.access_level(project, security.current_user()) != "write"
    return render_template(
        "timeline.html", project=project, readonly=readonly,
        ignored_dirs=json.dumps(config.IGNORED_DIRS + config.IGNORED_FILES),
        max_file_mb=config.MAX_VERSION_FILE_MB, max_upload_mb=config.MAX_VERSION_UPLOAD_MB,
        note_max=config.MAX_NOTE_LEN, ideas_max=config.MAX_IDEAS, idea_len=config.MAX_IDEA_LEN,
    )


@bp.get("/api/projects/<pid>/timeline")
@security.login_required
def get_timeline(pid):
    project = _project(pid)
    return jsonify(timeline=projects_service.load_timeline(project))


@bp.put("/api/projects/<pid>/timeline")
@security.login_required
def put_timeline(pid):
    project = _project(pid, write=True)
    projects_service.save_timeline(project, request.get_json(silent=True))
    return jsonify(ok=True)


# ---------- Files of each version ----------
@bp.get("/api/projects/<pid>/versions/<cid>/files")
@security.login_required
def version_files(pid, cid):
    project = _project(pid)
    return jsonify(versions_service.files_info(project, cid))


@bp.post("/api/projects/<pid>/versions/<cid>/upload")
@security.login_required
def version_upload(pid, cid):
    # a version upload exceeds the general 5 MB cap; it must be set before the body is read
    request.max_content_length = (config.MAX_VERSION_UPLOAD_MB + 5) * 1024 * 1024
    request.max_form_parts = config.MAX_VERSION_UPLOAD_FILES + 10
    request.max_form_memory_size = 4 * 1024 * 1024
    project = _project(pid, write=True)
    files = request.files.getlist("files")
    try:
        paths = json.loads(request.form.get("paths", "[]"))
    except ValueError:
        paths = None
    if not files:
        raise ServiceError("هیچ فایلی انتخاب نشده.")
    if not isinstance(paths, list) or len(paths) != len(files) or not all(isinstance(p, str) for p in paths):
        raise ServiceError("مسیرِ فایل‌ها با خودِ فایل‌ها نمی‌خواند.")
    if len(files) > config.MAX_VERSION_UPLOAD_FILES:
        raise ServiceError(f"تعداد فایل‌ها از {config.MAX_VERSION_UPLOAD_FILES} بیشتر است.", 413)
    result = versions_service.upload(project, cid, [(p, f.stream) for p, f in zip(paths, files)])
    return jsonify(ok=True, **result)


@bp.post("/api/projects/<pid>/versions/<cid>/files/edit")
@security.login_required
def version_files_edit(pid, cid):
    """File manager of a version: rename / delete / copy / move files and folders (manifest only)."""
    project = _project(pid, write=True)
    data = request.get_json(silent=True) or {}
    text = lambda k: data.get(k) if isinstance(data.get(k), str) else ""
    result = versions_service.edit_files(
        project, cid, data.get("op"), data.get("paths"), text("dest"), text("new_name"), bool(data.get("overwrite")))
    return jsonify(ok=True, **result)


@bp.get("/api/projects/<pid>/versions/<cid>/export")
@security.login_required
def version_export(pid, cid):
    project = _project(pid)
    fileobj, name = versions_service.export_zip(project, cid)
    return send_file(fileobj, mimetype="application/zip", as_attachment=True, download_name=name)


@bp.get("/api/projects/<pid>/versions/<cid>/export-run")
@security.login_required
def version_export_run(pid, cid):
    """Zip with the version's files + run.bat/run.sh/run_local.py to run app.py on the downloader's own computer."""
    project = _project(pid)
    fileobj, name = package_service.build_run_package(project, cid)
    return send_file(fileobj, mimetype="application/zip", as_attachment=True, download_name=name)


@bp.post("/api/projects/<pid>/versions/<cid>/export-folder")
@security.login_required
def version_export_folder(pid, cid):
    """Saves the version as a folder; dest = parent folder ('' = the project's default exports folder)."""
    project = _project(pid)
    data = request.get_json(silent=True) or {}
    dest = data.get("dest", "")
    if not security.is_admin() and isinstance(dest, str) and dest.strip() and not _inside(dest, project["path"]):
        raise ServiceError("اعضای تیم فقط می‌توانند داخل پوشه‌ی همین نسخه (مثلاً exports) خروجی بگیرند؛ مسیر را خالی بگذار.", 403)
    result = versions_service.export_folder(project, cid, dest if isinstance(dest, str) else "", bool(data.get("overwrite")))
    return jsonify(ok=True, **result)


# ---------- diff against the previous version ----------
@bp.get("/api/projects/<pid>/versions/<cid>/diff")
@security.login_required
def version_diff(pid, cid):
    """Files that changed in this version compared with the previous one (+ the version's comment)."""
    project = _project(pid)
    return jsonify(diff_service.summary(project, cid))


@bp.get("/api/projects/<pid>/versions/<cid>/diff/file")
@security.login_required
def version_diff_file(pid, cid):
    """Side-by-side rows of one changed file: ?path=<path in the version>."""
    project = _project(pid)
    return jsonify(diff_service.file_diff(project, cid, request.args.get("path", "")))


# ---------- run app.py of a version ----------
RUN_ADMIN_ONLY = "اجرای برنامه برای اعضای تیم بسته شده است (ALLOW_MEMBER_RUN در services/config.py)."


def _inside(raw: str, folder: str) -> bool:
    try:
        Path(raw).expanduser().resolve().relative_to(Path(folder).resolve())
        return True
    except (ValueError, OSError):
        return False


def _may_run():
    if not security.is_admin() and not config.ALLOW_MEMBER_RUN:
        raise ServiceError(RUN_ADMIN_ONLY, 403)


@bp.get("/api/projects/<pid>/run")
@security.login_required
def run_status(pid):
    project = _project(pid)
    return jsonify(run_service.status(project["id"]))


@bp.post("/api/projects/<pid>/versions/<cid>/run")
@security.login_required
def run_start(pid, cid):
    _may_run()
    project = _project(pid)  # the admin may also run a team fork to try it (nothing in the fork's timeline changes)
    return jsonify(run_service.start(project, cid))


@bp.post("/api/projects/<pid>/run/stop")
@security.login_required
def run_stop(pid):
    _may_run()
    project = _project(pid)
    return jsonify(run_service.stop(project["id"]))
