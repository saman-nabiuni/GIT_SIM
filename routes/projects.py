from flask import Blueprint, abort, jsonify, render_template, request

from routes.common import current, fail, login_required
from services import projects_service as ps

bp = Blueprint("projects", __name__)


@bp.route("/")
@login_required
def home():
    return render_template("home.html")


@bp.route("/project/<pid>")
@login_required
def project_page(pid):
    p = ps.get_project(current()["company_id"], pid)
    if not p:
        abort(404)
    return render_template("project.html", project=p)


@bp.route("/api/projects", methods=["GET"])
@login_required
def list_projects():
    return jsonify(projects=ps.list_projects(current()["company_id"]))


@bp.route("/api/projects", methods=["POST"])
@login_required
def create_project():
    d = request.get_json(silent=True) or {}
    u = current()
    try:
        p, warning = ps.create_project(u["company_id"], u["username"], d.get("name"),
                                       d.get("path"), bool(d.get("first_commit", True)))
    except ps.ProjectError as e:
        return fail(str(e))
    return jsonify(project=p, warning=warning), 201


@bp.route("/api/projects/<pid>", methods=["DELETE"])
@login_required
def delete_project(pid):
    if not ps.remove_project(current()["company_id"], pid):
        return fail("پروژه پیدا نشد.", 404)
    return jsonify(ok=True)
