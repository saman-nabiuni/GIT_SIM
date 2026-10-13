"""Central app settings: paths, limits and constants. Change any number/path you need here."""
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_DIR = BASE_DIR / "database"
USERS_CSV = DATABASE_DIR / "users.csv"          # only the user with user_id = 0 logs in from here
COMPANIES_DIR = DATABASE_DIR / "companies"      # data of each company: companies/<company_id>/...
SECRET_KEY_FILE = DATABASE_DIR / ".secret_key"

ADMIN_USER_ID = "0"                             # only this user is allowed to log in
REQUIRED_COLUMNS = ("company_id", "user_id", "username", "password")

# Limits
MAX_UPLOAD_MB = 5
MAX_TABLE_ROWS = 20000
MAX_TABLE_COLS = 60
MAX_CELL_LEN = 500
MAX_TIMELINE_BYTES = 2 * 1024 * 1024
MAX_TIMELINE_COMMITS = 5000
MAX_PROJECT_NAME_LEN = 60
MAX_NOTE_LEN = 1000                             # comment ("purpose") of one version
MAX_IDEAS = 500                                 # items in the ideas/tasks side panel of a project
MAX_IDEA_LEN = 2000                             # characters in one idea

# Side-by-side diff
DIFF_MAX_FILE_KB = 512                          # a text file bigger than this is not compared
DIFF_MAX_LINES = 5000                           # more lines (in either side) = not compared
DIFF_CONTEXT_LINES = 3                          # unchanged lines kept around each change

# Files of each version (folder/file upload)
STORE_DIRNAME = "store"                         # inside the project folder: store/objects and store/manifests
MAX_VERSION_UPLOAD_MB = 200                     # total size of one upload
MAX_VERSION_FILE_MB = 50                        # size of each file
MAX_VERSION_UPLOAD_FILES = 3000                 # number of files in one upload
MAX_VERSION_PATH_LEN = 400
IGNORED_DIRS = (".git", "__pycache__", "node_modules", ".venv", "venv", ".idea", ".vscode")  # skipped when uploading a folder
IGNORED_FILES = (".DS_Store", "Thumbs.db")

# Export as folder / run app.py (all inside the project folder)
EXPORTS_DIRNAME = "exports"                     # default export place: exports/<project>-v<version>/
RUN_DIRNAME = "run"                             # run/<commit_id>/ = working copy used by "Run app.py", run/<commit_id>.log = its output
RUN_ENTRY_FILE = "app.py"                       # must be in the first layer of the version's files
RUN_LOG_TAIL_BYTES = 6000                       # how much of the log the UI shows
RUN_STOP_TIMEOUT_SECONDS = 5
RUN_APP_HOST = os.environ.get("RUN_APP_HOST", "0.0.0.0")    # host given to the run app: 0.0.0.0 = reachable from the LAN
RUN_PORT_MIN = int(os.environ.get("RUN_PORT_MIN", "9100"))  # run apps get a free port in this range (open it in the firewall)
RUN_PORT_MAX = int(os.environ.get("RUN_PORT_MAX", "9199"))  # 0 for both = any free port chosen by the OS

# Team members and forks (see docs/forks-and-team.md)
FORKS_DIRNAME = "forks"                         # inside the main project folder: forks/<user>-<id>/ (one folder per team fork)
MAX_FORKS_PER_PROJECT = 50                      # how many team forks one project can have
ALLOW_MEMBER_RUN = True                         # False = only the admin (user_id 0) may run app.py of a version

# Brute-force protection
LOGIN_MAX_FAILS = 5
LOGIN_LOCK_SECONDS = 60

# Run
HOST = os.environ.get("APP_HOST", "0.0.0.0")      # 0.0.0.0 = reachable from the LAN (use 127.0.0.1 for this computer only)
PORT = int(os.environ.get("APP_PORT", "9999"))
DEBUG = os.environ.get("APP_DEBUG", "0") == "1"


def get_secret_key() -> str:
    """Session signing key: from env or from database/.secret_key (created if missing)."""
    env = os.environ.get("SECRET_KEY")
    if env:
        return env
    if SECRET_KEY_FILE.exists():
        return SECRET_KEY_FILE.read_text(encoding="utf-8").strip()
    key = secrets.token_hex(32)
    SECRET_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    SECRET_KEY_FILE.write_text(key, encoding="utf-8")
    try:
        os.chmod(SECRET_KEY_FILE, 0o600)
    except OSError:
        pass
    return key
