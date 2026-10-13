"""Login.
- Admin: rows with user_id = 0 in database/users.csv (each row = "me" in one company; company_id = the company I work in).
- Team member: a row with user_id != 0 in database/companies/<company_id>/employees.csv (uploaded in Settings).
  Members never touch the main project; they work on their own fork (see forks_service.py)."""
import hmac
import re

from werkzeug.security import check_password_hash

from . import config, table_io
from .errors import ServiceError

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


def norm_id(value) -> str:
    """Turns '0.0' and ' 0 ' into '0' (Excel sometimes writes numbers as decimals)."""
    text = str(value).strip()
    if re.fullmatch(r"\d+\.0+", text):
        text = text.split(".")[0]
    return text


def verify_password(stored: str, given: str) -> bool:
    """The stored password is either plain text (like the sample users.csv) or a werkzeug hash (scrypt:/pbkdf2:)."""
    if stored.startswith(("scrypt:", "pbkdf2:")):
        return check_password_hash(stored, given)
    return hmac.compare_digest(stored.encode("utf-8"), given.encode("utf-8"))


def _load_rows():
    if not config.USERS_CSV.exists():
        raise ServiceError(f"فایل {config.USERS_CSV.name} پیدا نشد.", 500)
    columns, rows = table_io.read_csv_path(config.USERS_CSV)
    lower = {c.lower(): c for c in columns}
    missing = [c for c in config.REQUIRED_COLUMNS if c not in lower]
    if missing:
        raise ServiceError(f"ستون‌های الزامی در users.csv نیست: {', '.join(missing)}", 500)
    return lower, rows


def _company_name(company_id: str) -> str:
    """Display name of a company: company_name column of its admin row in users.csv, or a default."""
    try:
        lower, rows = _load_rows()
        for row in rows:
            if norm_id(row[lower["company_id"]]) == company_id and row.get("company_name", "").strip():
                return row["company_name"].strip()
    except ServiceError:
        pass
    return f"شرکت {company_id}"


def _authenticate_member(username: str, password: str):
    """Team member from any company's employees.csv; user_id 0 and empty passwords never log in this way."""
    if not username or not password or not config.COMPANIES_DIR.is_dir():
        return None
    found = None
    for folder in sorted(config.COMPANIES_DIR.iterdir()):
        path = folder / "employees.csv"
        if not folder.is_dir() or not SAFE_ID.match(folder.name) or not path.is_file():
            continue
        try:
            _, rows = table_io.read_csv_path(path)
        except ServiceError:
            continue  # a broken employees file of one company must not block the others
        for row in rows:
            uid = norm_id(row.get("user_id", ""))
            stored = row.get("password", "")
            if not uid or uid == config.ADMIN_USER_ID or not stored:
                continue
            ok_user = hmac.compare_digest(row.get("username", "").strip().lower().encode(), username.lower().encode())
            ok_pass = verify_password(stored, password)
            if ok_user and ok_pass and found is None:
                found = {"user_id": uid, "username": row["username"].strip(),
                         "company_id": folder.name, "company_name": _company_name(folder.name)}
    return found


def authenticate(username: str, password: str):
    """Returns the user dict if correct, otherwise None (admin first, then team members)."""
    admin = _authenticate_admin(username, password)
    return admin or _authenticate_member(username, password)


def _authenticate_admin(username: str, password: str):
    lower, rows = _load_rows()
    found = None
    for row in rows:  # loop over all rows so the response time is more constant
        if norm_id(row[lower["user_id"]]) != config.ADMIN_USER_ID:
            continue
        ok_user = hmac.compare_digest(row[lower["username"]].encode(), username.encode())
        ok_pass = verify_password(row[lower["password"]], password)
        if ok_user and ok_pass and found is None:
            found = row
    if found is None:
        return None
    company_id = norm_id(found[lower["company_id"]])
    if not SAFE_ID.match(company_id):
        raise ServiceError("company_id در users.csv نامعتبر است (فقط حرف/عدد/خط‌تیره).", 500)
    name = found.get("company_name", "").strip() if "company_name" in found else ""
    return {
        "user_id": config.ADMIN_USER_ID,
        "username": found[lower["username"]],
        "company_id": company_id,
        "company_name": name or f"شرکت {company_id}",
    }
