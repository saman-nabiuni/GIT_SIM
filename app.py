"""App entry point: creates the Flask app, registers blueprints and handles errors.
Run:  python app.py"""
from flask import Flask, jsonify, render_template, request

from routes import auth_routes, fork_routes, fs_routes, home_routes, project_routes, settings_routes
from services import config, security
from services.errors import ServiceError


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=config.get_secret_key(),
        MAX_CONTENT_LENGTH=config.MAX_UPLOAD_MB * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        TEMPLATES_AUTO_RELOAD=True,
    )
    config.COMPANIES_DIR.mkdir(parents=True, exist_ok=True)
    security.init_app(app)

    for module in (auth_routes, home_routes, settings_routes, project_routes, fork_routes, fs_routes):
        app.register_blueprint(module.bp)

    def wants_json():
        return request.path.startswith("/api/") or request.accept_mimetypes.best == "application/json"

    @app.errorhandler(ServiceError)
    def on_service_error(exc):
        if wants_json():
            return jsonify(error=exc.message, details=exc.details), exc.status
        return render_template("error.html", message=exc.message, code=exc.status), exc.status

    @app.errorhandler(413)
    def too_large(_):
        mb = config.MAX_VERSION_UPLOAD_MB if "/versions/" in request.path else config.MAX_UPLOAD_MB
        msg = f"حجم فایل از {mb} مگابایت بیشتر است."
        return (jsonify(error=msg), 413) if wants_json() else (render_template("error.html", message=msg, code=413), 413)

    @app.errorhandler(404)
    def not_found(_):
        return (jsonify(error="پیدا نشد."), 404) if wants_json() else (render_template("error.html", message="صفحه پیدا نشد.", code=404), 404)

    @app.errorhandler(400)
    def bad_request(_):
        return (jsonify(error="درخواست نامعتبر."), 400) if wants_json() else (render_template("error.html", message="درخواست نامعتبر یا توکن امنیتی منقضی شده؛ صفحه را دوباره باز کن.", code=400), 400)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
