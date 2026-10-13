import secrets
import time

from flask import Blueprint, redirect, render_template, request, session, url_for

from routes.common import current
from services import users_service

bp = Blueprint("auth", __name__)

_fails = {}          # ip -> {"n": count, "until": ts}
MAX_FAILS, LOCK_SECONDS = 5, 60


@bp.route("/login", methods=["GET", "POST"])
def login():
    if current():
        return redirect(url_for("projects.home"))
    error = None
    if request.method == "POST":
        ip = request.remote_addr or "?"
        rec = _fails.get(ip, {"n": 0, "until": 0})
        wait = int(rec["until"] - time.time())
        if wait > 0:
            error = f"تعداد تلاش‌ها زیاد بود؛ {wait} ثانیه دیگر دوباره امتحان کن."
        else:
            user = users_service.authenticate(request.form.get("username", ""),
                                              request.form.get("password", ""))
            if user:
                _fails.pop(ip, None)
                session.clear()
                session["csrf"] = secrets.token_hex(16)
                session["user"] = user
                return redirect(url_for("projects.home"))
            rec["n"] += 1
            if rec["n"] >= MAX_FAILS:
                rec = {"n": 0, "until": time.time() + LOCK_SECONDS}
            _fails[ip] = rec
            error = "نام کاربری یا رمز عبور اشتباه است."
    return render_template("login.html", error=error)


@bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("auth.login"))
