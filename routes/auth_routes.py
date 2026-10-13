"""Login and logout pages."""
from flask import Blueprint, redirect, render_template, request, session, url_for

from services import security, users_service
from services.errors import ServiceError

bp = Blueprint("auth", __name__)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if security.current_user():
        return redirect(url_for("home.index"))
    error, status = None, 200
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        key = (request.remote_addr, username.lower())
        wait = security.throttle.locked_for(key)
        if wait:
            error, status = f"تلاش‌های ناموفق زیاد بود؛ {wait} ثانیه‌ی دیگر دوباره امتحان کن.", 429
        else:
            try:
                user = users_service.authenticate(username, password)
            except ServiceError as exc:
                user, error, status = None, f"مشکل در فایل کاربران: {exc.message}", 500
            else:
                if user is None:
                    security.throttle.fail(key)
                    error, status = "نام کاربری یا رمز عبور اشتباه است.", 401
            if user:
                security.throttle.reset(key)
                session.clear()
                session.update(user)
                return redirect(security.safe_next(request.args.get("next")) or url_for("home.index"))
    return render_template("login.html", error=error), status


@bp.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("auth.login"))
