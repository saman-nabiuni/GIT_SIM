"""Company employees: the users file uploaded in Settings, stored separately per company:
database/companies/<company_id>/employees.csv  (extra columns are kept too)."""
from pathlib import Path

from . import config, table_io
from .errors import ServiceError
from .users_service import SAFE_ID, norm_id

REQ = config.REQUIRED_COLUMNS


def company_dir(company_id: str) -> Path:
    if not SAFE_ID.match(str(company_id)):
        raise ServiceError("شناسه‌ی شرکت نامعتبر است.", 400)
    return config.COMPANIES_DIR / str(company_id)


def employees_path(company_id: str) -> Path:
    return company_dir(company_id) / "employees.csv"


def canonical_columns(columns):
    """Required column names (case-insensitive) are converted to their standard form; the rest are left untouched."""
    lower = {c.lower(): c for c in REQ}
    return [lower.get(c.strip().lower(), c.strip()) for c in columns]


def load(company_id: str):
    path = employees_path(company_id)
    if not path.exists():
        return list(REQ), []
    columns, rows = table_io.read_csv_path(path)
    return columns, rows


def validate(company_id: str, columns, rows):
    """List of errors (Persian text). Empty = valid."""
    errors = []
    missing = [c for c in REQ if c not in columns]
    if missing:
        errors.append(f"ستون‌های الزامی در فایل نیست: {', '.join(missing)}")
        return errors
    seen_ids, seen_names = {}, {}
    for i, row in enumerate(rows, start=2):  # row number like Excel (row 1 = header)
        cid, uid = norm_id(row.get("company_id", "")), norm_id(row.get("user_id", ""))
        uname = row.get("username", "").strip()
        if not uid:
            errors.append(f"سطر {i}: user_id خالی است.")
        if not uname:
            errors.append(f"سطر {i}: username خالی است.")
        if cid != str(company_id):
            errors.append(f"سطر {i}: company_id برابر «{cid}» است ولی شرکت فعلی «{company_id}» است.")
        key = (cid, uid)
        if uid and key in seen_ids:
            errors.append(f"سطر {i}: (company_id, user_id) تکراری است؛ مشابه سطر {seen_ids[key]}.")
        seen_ids.setdefault(key, i)
        if uname and uname.lower() in seen_names:
            errors.append(f"سطر {i}: username «{uname}» تکراری است؛ مشابه سطر {seen_names[uname.lower()]}.")
        seen_names.setdefault(uname.lower(), i)
    return errors


def normalize(columns, rows):
    original = list(columns)
    columns = canonical_columns(original)
    # row keys are also mapped from the original column name to the standard name
    rows = [{canon: r.get(orig, "") for orig, canon in zip(original, columns)} for r in rows]
    if len(set(c.lower() for c in columns)) != len(columns) or any(not c for c in columns):
        raise ServiceError("نام ستون‌ها خالی یا تکراری است.")
    if len(columns) > config.MAX_TABLE_COLS or len(rows) > config.MAX_TABLE_ROWS:
        raise ServiceError("جدول از حد مجاز بزرگ‌تر است.")
    out = []
    for r in rows:
        clean = {}
        for c in columns:
            v = str(r.get(c, "") if r.get(c, "") is not None else "").strip()
            if len(v) > config.MAX_CELL_LEN:
                raise ServiceError(f"طول یک سلول بیشتر از {config.MAX_CELL_LEN} کاراکتر است.")
            clean[c] = v
        if any(clean.values()):
            for key in ("company_id", "user_id"):  # if the column is missing, validate() reports a Persian error
                if key in clean:
                    clean[key] = norm_id(clean[key])
            out.append(clean)
    return columns, out


def preview(company_id: str, file_storage):
    columns, rows = table_io.read_upload(file_storage)
    columns, rows = normalize(columns, rows)
    return columns, rows, validate(company_id, columns, rows)


def save(company_id: str, columns, rows):
    columns, rows = normalize(columns, rows)
    errors = validate(company_id, columns, rows)
    if errors:
        raise ServiceError("جدول خطا دارد؛ اول اصلاحش کن.", 422, errors)
    table_io.write_csv(employees_path(company_id), columns, rows)
    return columns, rows
