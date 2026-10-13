"""Security: CSRF, security headers, login_required, login attempt throttle and safe next."""
import hmac
import secrets
import time
from functools import wraps
from urllib.parse import urlparse

from flask import abort, jsonify, redirect, request, session, url_for

from . import config
from .errors import ServiceError

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


# ---------- CSRF ----------
def csrf_token() -> str:
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


def _verify_csrf():
    if request.method in SAFE_METHODS:
        return
    sent = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token", "")
    expected = session.get("csrf", "")
    if not expected or not hmac.compare_digest(sent, expected):
        if request.path.startswith("/api/"):
            return jsonify(error="توکن امنیتی نامعتبر است؛ صفحه را دوباره باز کن."), 400
        abort(400)


# ---------- Headers ----------
CSP = (
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; font-src 'self' data:; connect-src 'self'; "
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
)


def _security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("Content-Security-Policy", CSP)
    if request.path.startswith("/api/") or request.path in ("/login", "/settings"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ---------- Login ----------
def current_user():
    if session.get("user_id") is None:
        return None
    uid = str(session["user_id"])
    return {
        "user_id": uid,
        "username": session.get("username", ""),
        "company_id": session.get("company_id", ""),
        "company_name": session.get("company_name", ""),
        "role": "admin" if uid == config.ADMIN_USER_ID else "member",  # admin = user_id 0; everyone else = team member
    }


def is_admin(user=None) -> bool:
    user = user or current_user()
    return bool(user) and user["role"] == "admin"


def admin_required(view):
    """Use under @login_required: only the admin (user_id 0) may open this page / API."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        if not is_admin():
            raise ServiceError("این بخش فقط برای مدیر (user_id = 0) است.", 403)
        return view(*args, **kwargs)

    return wrapper


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            if request.path.startswith("/api/"):
                return jsonify(error="وارد نشده‌ای."), 401
            return redirect(url_for("auth.login", next=request.full_path.rstrip("?")))
        return view(*args, **kwargs)

    return wrapper


LOCAL_ADDRESSES = ("127.0.0.1", "::1")


def require_local(message: str):
    """Refuse requests that do not come from the machine running the server (no longer used for running apps:
    everybody who can log in is trusted; kept for features that really need the server's own screen)."""
    if request.remote_addr not in LOCAL_ADDRESSES:
        raise ServiceError(message, 403)


def safe_next(target):
    """Only an internal path (like /settings) is accepted; prevents open redirects."""
    if not target:
        return None
    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc or not target.startswith("/") or target.startswith("//"):
        return None
    return target


class LoginThrottle:
    """After several failed attempts, that (IP + username) is locked for a while."""

    def __init__(self):
        self._fails = {}  # key -> (count, lock_until, last_time)

    def locked_for(self, key) -> int:
        entry = self._fails.get(key)
        if not entry:
            return 0
        remaining = int(entry[1] - time.time())
        return max(0, remaining)

    def fail(self, key):
        now = time.time()
        count = (self._fails.get(key, (0, 0, 0))[0]) + 1
        lock_until = now + config.LOGIN_LOCK_SECONDS if count >= config.LOGIN_MAX_FAILS else 0
        if lock_until:
            count = 0
        self._fails[key] = (count, lock_until, now)
        if len(self._fails) > 1000:  # purge old entries
            cutoff = now - 3600
            self._fails = {k: v for k, v in self._fails.items() if v[2] > cutoff}

    def reset(self, key):
        self._fails.pop(key, None)


throttle = LoginThrottle()


def init_app(app):
    app.before_request(_verify_csrf)
    app.after_request(_security_headers)
    app.jinja_env.globals["csrf_token"] = csrf_token
    app.context_processor(lambda: {"me": current_user()})
