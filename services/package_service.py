"""Run package: a zip of one version's files + run.bat / run.sh / run_local.py, so a person can run the version's
app.py on their OWN computer (this needs Python there). Nothing runs on the server, nothing is installed automatically:
run_local.py only shows missing libraries from requirements.txt and asks. The templates live in services/run_package/."""
import tempfile
import zipfile
from pathlib import Path

from . import config, versions_service
from .errors import ServiceError

TEMPLATE_DIR = Path(__file__).resolve().parent / "run_package"
# (file name in the zip, is a Windows batch file -> CRLF line endings, is a shell script -> executable)
EXTRA_FILES = (("run.bat", True, False), ("run.sh", False, True), ("run_local.py", False, False))


def build_run_package(project: dict, cid: str):
    """(open zip file, suggested name). Needs app.py in the first layer of the version's files."""
    commit, m = versions_service.current_files(project, cid)
    if not m or not m["files"]:
        raise ServiceError("این نسخه (و نسخه‌های قبل از آن) فایلی ندارد.", 404)
    paths = sorted(m["files"], key=str.lower)
    if not any(p.lower() == config.RUN_ENTRY_FILE for p in paths):
        raise ServiceError("فایل app.py در لایه‌ی اول فایل‌های این نسخه نیست.", 404)
    taken = {p.lower() for p in paths}
    clash = [name for name, _, _ in EXTRA_FILES if name.lower() in taken]
    if clash:
        raise ServiceError(f"نسخه فایلی با نام {clash[0]} دارد و با فایل‌های بسته‌ی اجرا تداخل می‌کند؛ نامش را عوض کن.", 409)

    root = versions_service._export_name(project, commit)
    out = tempfile.SpooledTemporaryFile(max_size=32 * 1024 * 1024)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in paths:
            obj = versions_service._object_path(project, m["files"][path]["h"])
            if not obj.is_file():
                raise ServiceError(f"محتوای «{path}» در ذخیره‌گاه پیدا نشد.", 500)
            zf.write(obj, arcname=f"{root}/{path}")
        for name, is_bat, is_sh in EXTRA_FILES:
            text = (TEMPLATE_DIR / name).read_text(encoding="utf-8").replace("\r\n", "\n")
            if is_bat:
                text = text.replace("\n", "\r\n")
            info = zipfile.ZipInfo(f"{root}/{name}")
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if is_sh else 0o644) << 16
            zf.writestr(info, text.encode("utf-8"))
    out.seek(0)
    return out, f"{root}-run.zip"
