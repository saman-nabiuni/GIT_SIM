from functools import wraps

from flask import jsonify, redirect, request, session, url_for


def current():
    return session.get("user")


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not current():
            if request.path.startswith("/api/"):
                return jsonify(error="ابتدا وارد شو."), 401
            return redirect(url_for("auth.login"))
        return fn(*a, **kw)
    return wrapper


def fail(msg, code=400):
    return jsonify(error=msg), code
