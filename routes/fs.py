"""Opens the native Windows folder dialog on the server machine."""
from flask import Blueprint, jsonify, request

from routes.common import fail, login_required
from services import dialog_service

bp = Blueprint("fs", __name__)


@bp.route("/api/fs/pick", methods=["POST"])
@login_required
def fs_pick():
    # The dialog appears on the server's screen, so it only makes sense locally.
    if request.remote_addr not in ("127.0.0.1", "::1"):
        return fail("انتخاب پوشه فقط روی خود کامپیوتری که برنامه اجرا می‌شود کار می‌کند؛ مسیر را دستی بنویس.", 403)
    initial = (request.get_json(silent=True) or {}).get("initial", "")
    try:
        return jsonify(path=dialog_service.pick_folder(initial))
    except dialog_service.DialogError as e:
        return fail(str(e), 500)
