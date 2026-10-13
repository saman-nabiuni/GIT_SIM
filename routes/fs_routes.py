"""Opens the native folder dialog (Windows Explorer style) on the machine running the server."""
from flask import Blueprint, jsonify, request

from services import dialog_service, security
from services.errors import ServiceError

bp = Blueprint("fs", __name__)

LOCAL_ADDRESSES = ("127.0.0.1", "::1")


@bp.post("/api/fs/pick")
@security.login_required
def pick_folder():
    # The dialog appears on the server's screen, so it only makes sense for local requests.
    if request.remote_addr not in LOCAL_ADDRESSES:
        raise ServiceError("انتخاب پوشه فقط روی خود کامپیوتری که برنامه اجرا می‌شود کار می‌کند؛ مسیر را دستی بنویس.", 403)
    initial = (request.get_json(silent=True) or {}).get("initial", "")
    return jsonify(path=dialog_service.pick_folder(initial if isinstance(initial, str) else ""))
