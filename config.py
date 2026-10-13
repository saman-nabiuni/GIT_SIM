"""Central paths and limits."""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_DIR = BASE_DIR / "database"
USERS_CSV = DB_DIR / "users.csv"
PROJECTS_JSON = DB_DIR / "projects.json"
SECRET_FILE = DB_DIR / "secret.key"

REQUIRED_COLUMNS = ["company_id", "user_id", "username", "password"]
MAX_UPLOAD_BYTES = 5 * 1024 * 1024

HOST = "127.0.0.1"   # for LAN access use "0.0.0.0" (see docs/README.md)
PORT = 5000
