"""Settings (admin only): upload/edit the users file (company employees) with a Tabulator table."""
import io

from flask import Blueprint, jsonify, render_template, request, send_file, session

from services import config, employees_service, security
from services.errors import ServiceError

bp = Blueprint("settings", __name__)


@bp.get("/settings")
@security.login_required
@security.admin_required
def page():
    return render_template("settings.html", required=config.REQUIRED_COLUMNS)


@bp.get("/api/settings/employees")
@security.login_required
@security.admin_required
def get_employees():
    columns, rows = employees_service.load(session["company_id"])
    return jsonify(columns=columns, rows=rows)


@bp.post("/api/settings/employees/preview")
@security.login_required
@security.admin_required
def preview_employees():
    """Reads and shows the file; nothing is saved."""
    file = request.files.get("file")
    if not file:
        raise ServiceError("فایلی انتخاب نشده.")
    columns, rows, errors = employees_service.preview(session["company_id"], file)
    return jsonify(columns=columns, rows=rows, errors=errors)


@bp.put("/api/settings/employees")
@security.login_required
@security.admin_required
def save_employees():
    data = request.get_json(silent=True) or {}
    columns, rows = employees_service.save(session["company_id"], data.get("columns") or [], data.get("rows") or [])
    return jsonify(ok=True, columns=columns, count=len(rows))


@bp.get("/settings/employees.csv")
@security.login_required
@security.admin_required
def download_employees():
    path = employees_service.employees_path(session["company_id"])
    if not path.exists():
        raise ServiceError("هنوز فایلی ذخیره نشده.", 404)
    return send_file(io.BytesIO(path.read_bytes()), mimetype="text/csv", as_attachment=True,
                     download_name=f"employees_company_{session['company_id']}.csv")
