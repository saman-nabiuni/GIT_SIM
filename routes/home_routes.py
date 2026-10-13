"""Home page: the company's projects (admin) or my team forks (member) + create/delete project (admin only)."""
from flask import Blueprint, jsonify, render_template, request, session

from services import forks_service, projects_service, security

bp = Blueprint("home", __name__)


@bp.get("/")
@security.login_required
def index():
    everything = projects_service.list_projects(session["company_id"])
    forks = forks_service.forks_for(security.current_user(), everything)
    projects = [p for p in everything if not forks_service.is_fork(p)]
    if not security.is_admin():  # a member sees only the projects the admin shared with them (= where they have a fork)
        projects = [p for p in projects if p["id"] in forks]
    return render_template("home.html", projects=projects, forks=forks)


@bp.post("/api/projects")
@security.login_required
@security.admin_required
def create_project():
    data = request.get_json(silent=True) or {}
    project = projects_service.create_project(session["company_id"], data.get("name", ""), data.get("base_path", ""))
    return jsonify(project=project), 201


@bp.delete("/api/projects/<pid>")
@security.login_required
@security.admin_required
def remove_project(pid):
    projects_service.remove_project(session["company_id"], pid)
    return jsonify(ok=True)
