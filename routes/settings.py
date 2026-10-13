from flask import Blueprint, Response, jsonify, render_template, request

from config import REQUIRED_COLUMNS
from routes.common import current, fail, login_required
from services import users_service as us

bp = Blueprint("settings", __name__)


def _payload(cols, rows):
    extra = [c for c in cols if c not in REQUIRED_COLUMNS]
    return {"columns": REQUIRED_COLUMNS + extra, "rows": rows}


@bp.route("/settings")
@login_required
def settings_page():
    return render_template("settings.html")


@bp.route("/api/settings/users", methods=["GET"])
@login_required
def get_users():
    return jsonify(_payload(*us.list_employees(current()["company_id"])))


@bp.route("/api/settings/users", methods=["POST"])
@login_required
def save_users():
    data = request.get_json(silent=True) or {}
    try:
        cols, rows = us.replace_employees(current()["company_id"],
                                          data.get("columns", []), data.get("rows", []))
    except us.UsersError as e:
        return fail(str(e))
    return jsonify(_payload(cols, rows))


@bp.route("/api/settings/users/upload", methods=["POST"])
@login_required
def upload_users():
    f = request.files.get("file")
    if not f or not f.filename:
        return fail("فایلی انتخاب نشده است.")
    try:
        cols, rows = us.parse_upload(f.filename, f.read())
        cols, emp, rep = us.import_employees(
            current()["company_id"], cols, rows,
            force_company=request.form.get("force_company") == "1")
    except us.UsersError as e:
        return fail(str(e))
    return jsonify({**_payload(cols, emp), "report": rep})


@bp.route("/api/settings/users/download")
@login_required
def download_users():
    body = "\ufeff" + us.employees_csv(current()["company_id"])
    return Response(body, mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=users.csv"})
