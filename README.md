# Version Timeline

**A visual, branch-aware version timeline for your projects — a Flask web app with a Persian (RTL) UI that simulates Git-style versions, branches and merges on an interactive SVG canvas.**

![Python](https://img.shields.io/badge/python-3.9%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.x-lightgrey)
![Status](https://img.shields.io/badge/status-active%20development-orange)

Each company has several projects, and each project lives in an arbitrary folder on disk. Inside a project you draw your history on a zoomable timeline: create versions, fork parallel branches, merge them into `main`, attach files and comments to every version, compare any version with its predecessor side by side, and even run a stored version's `app.py` straight from the browser.

> **Note:** No real Git is involved yet. The timeline is stored as plain JSON (`timeline.json`) and file contents are kept in a content-addressed store. Real Git integration is on the [roadmap](#roadmap).

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [How to use it](#how-to-use-it)
- [Timeline logic](#timeline-logic)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [Data storage](#data-storage)
- [API reference](#api-reference)
- [Security](#security)
- [Documentation](#documentation)
- [Development guidelines](#development-guidelines)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## Features

### Timeline
- **Interactive SVG timeline** with smooth zoom (mouse wheel / pinch), pan (drag / two fingers) and a "fit" button.
- **Versions** with two naming modes: decimal (`1.2 → 1.3`) or integer (`2 → 3`); names can also be typed manually.
- **Parallel branches** from any version, including *twin* nodes (same name, same column) for side-by-side variants.
- **Merge into main** with automatic renumbering when names collide, and a two-step confirmation (preview first, then apply).
- **Safe delete** of a version together with everything that depends on it, also with a two-step confirmation.
- **Color system**: each version gets a base color from its number, and each branch gets its own shade.
- **Autosave** with a 600 ms debounce, a save-state indicator, a one-file backup (`timeline.prev.json`), and corruption protection that disables autosave instead of overwriting data.
- **Version comments**: a short note describing the purpose of each version (up to 1000 characters).
- **Ideas / tasks panel** next to the timeline: a lightweight checklist with keyboard-first editing, stored together with the timeline.

### Files per version
- **Upload files or whole folders** (drag & drop supported) onto any version; folder structure is preserved.
- **Content-addressed storage** (SHA-256): identical content is stored only once, and every version is an independent snapshot.
- **Export as ZIP** or **export as a real folder** to any location on the server machine.
- **File manager dialog**: folder tree with cut / copy / paste / rename / delete (`Ctrl+X`, `Ctrl+C`, `Ctrl+V`, `F2`, `Delete`) — instant, because only the manifest changes.
- **Side-by-side diff** against the previous version (or its twin): changed files grouped by folder, added / modified / removed status, collapsed unchanged lines and the version's comment.
- **Run `app.py`** of any stored version in one click, with live status, log output, clickable URLs and a Stop button (local requests only).

### Administration
- **Multi-company** setup: every company has its own isolated data folder.
- **Employee management** in Settings: upload CSV / XLSX, preview, edit in a Tabulator grid, validate on the server, save and download as CSV.
- **Native folder picker** (Windows / tkinter) when creating projects or exporting folders.
- **Persian UI** with full RTL layout and a dark theme.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python, [Flask](https://flask.palletsprojects.com/) ≥ 3.0 |
| Spreadsheet input | [openpyxl](https://openpyxl.readthedocs.io/) ≥ 3.1 (XLSX), built-in `csv` |
| Frontend | Vanilla JavaScript (no build step), SVG, Jinja2 templates |
| UI libraries | Bootstrap 5 (RTL build), Bootstrap Icons, [Tabulator](https://tabulator.info/) |
| Storage | Plain files: CSV, JSON and a SHA-256 object store — no database server |
| Native dialog | `tkinter` in a separate process |

---

## Getting started

### Prerequisites
- Python 3.9 or newer
- `pip`
- `tkinter` (optional; only needed for the native "Select folder…" dialog — it ships with the standard Windows Python installer)

### 1. Get the code and install

Download or clone this repository, then open a terminal in the project folder (the one that contains `app.py`):

```bash
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Linux/macOS:  source .venv/bin/activate

pip install -r requirements.txt
```

### 2. Add the front-end libraries

The UI libraries are **not** bundled. Download them and place them in `static/vendor/` with exactly this structure:

```
static/vendor/
├── bootstrap/
│   ├── bootstrap.rtl.min.css
│   └── bootstrap.bundle.min.js
├── bootstrap-icons/
│   ├── bootstrap-icons.min.css
│   └── fonts/
│       ├── bootstrap-icons.woff
│       └── bootstrap-icons.woff2
└── tabulator/
    ├── tabulator.min.js
    ├── tabulator.min.css
    └── tabulator_bootstrap5.min.css
```

Sources: [Bootstrap](https://getbootstrap.com/) (use the **RTL** CSS), [Bootstrap Icons](https://icons.getbootstrap.com/) and [Tabulator](https://tabulator.info/). Use Tabulator 5 or newer — `settings.js` uses the `table.on(...)` event API.

### 3. Run

```bash
python app.py
```

Open <http://127.0.0.1:9999>. From another device on your LAN use `http://<this-computer-IP>:9999` (on Windows you may need to allow port 9999 in the firewall).

### 4. Log in

The repository ships with a sample `database/users.csv`:

| company_id | user_id | username | password |
|---|---|---|---|
| 0 | 0 | a | 0 |
| 1 | 0 | b | 0 |
| 2 | 0 | c | 0 |

> **Change these credentials before using the app on any shared network.** See [Security](#security).

---

## Configuration

All paths, limits and constants live in one file: [`services/config.py`](services/config.py).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `APP_HOST` | `0.0.0.0` | Interface to bind. Use `127.0.0.1` to allow this computer only. |
| `APP_PORT` | `9999` | Port to listen on. |
| `APP_DEBUG` | `0` | Set to `1` to enable Flask debug mode. |
| `SECRET_KEY` | auto-generated | Session signing key. If unset, one is created in `database/.secret_key`. |

Example:

```bash
APP_HOST=127.0.0.1 APP_PORT=8080 python app.py
```

### Main limits (`services/config.py`)

| Setting | Default | Meaning |
|---|---|---|
| `MAX_UPLOAD_MB` | 5 | Employee table upload size |
| `MAX_TABLE_ROWS` / `MAX_TABLE_COLS` / `MAX_CELL_LEN` | 20000 / 60 / 500 | Employee table limits |
| `MAX_TIMELINE_COMMITS` / `MAX_TIMELINE_BYTES` | 5000 / 2 MB | Timeline size limits |
| `MAX_NOTE_LEN` | 1000 | Characters in a version comment |
| `MAX_IDEAS` / `MAX_IDEA_LEN` | 500 / 2000 | Ideas panel limits |
| `MAX_VERSION_UPLOAD_MB` | 200 | Total size of one upload |
| `MAX_VERSION_FILE_MB` | 50 | Size of one uploaded file |
| `MAX_VERSION_UPLOAD_FILES` | 3000 | Files per upload |
| `DIFF_MAX_FILE_KB` / `DIFF_MAX_LINES` | 512 / 5000 | Files beyond this are not compared |
| `DIFF_CONTEXT_LINES` | 3 | Unchanged lines kept around each change |
| `LOGIN_MAX_FAILS` / `LOGIN_LOCK_SECONDS` | 5 / 60 | Login throttling |
| `IGNORED_DIRS` / `IGNORED_FILES` | `.git`, `node_modules`, `venv`, … | Skipped on folder upload |

---

## How to use it

1. **Create a project** on the home page: enter a name and a parent folder (type it, or use *Select folder…*). A project folder is created there with a `project.json` and `timeline.json`.
2. **Open the project** to see its timeline, starting with a single version `1` on the `main` branch.
3. **Add versions** from the last node of a branch, **fork branches** from any node, **merge** a branch into `main`, or **delete** nodes — all from the version panel on the right.
4. **Attach files** to a version: upload files or a folder, or use the file manager to reorganize them.
5. **Compare** a version with the previous one in the side-by-side diff dialog.
6. **Export** a version as a ZIP or as a real folder, or **run** its `app.py` directly.
7. Use **Settings** to upload and edit your company's employee table.
8. Keep a list of **ideas / tasks** in the side panel while you work.

---

## Timeline logic

The timeline is a small graph model:

- **Node** — one version: `{id, name, branch, parent, twin, col, stack, base, color, note}`.
- **Branch** — one horizontal lane: `{name, shade}`. `branches[0]` is always `main`.
- **Twin** — a node with the *same name* as its source, placed directly below it in the same column (a parallel variant of the same version).

Key rules:

| Operation | Behavior |
|---|---|
| **Next version** | Only from the last node of a branch; default name depends on the decimal/integer mode. |
| **New branch** | From any node. Same name → twin node; different name → child one column ahead with an L-shaped connector. |
| **Delete** | Removes the node, all later nodes and any branch split from them. The first node can never be deleted. |
| **Merge into main** | Moves the branch's path onto `main`, renumbering on collisions; parallel timelines built on the moved nodes are preserved. |
| **Color** | Base color from the first number in the name; shade from the branch. Twins share the original's color. |

The complete specification is in [`docs/timeline-logic.md`](docs/timeline-logic.md).

---

## Project structure

```
.
├── app.py                  # App factory, blueprints, error handlers (no logic)
├── requirements.txt
├── PROJECT_MAP.md          # Developer map: "where do I change X?"
├── routes/                 # Thin HTTP layer: parse input → call service → respond
│   ├── auth_routes.py      #   /login, /logout
│   ├── home_routes.py      #   /, project create / remove
│   ├── fs_routes.py        #   native folder picker
│   ├── settings_routes.py  #   /settings + employees API
│   └── project_routes.py   #   timeline, files, diff, export, run
├── services/               # All business logic and file access
│   ├── config.py           #   paths, limits, constants (single source of truth)
│   ├── errors.py           #   ServiceError(message, status, details)
│   ├── security.py         #   CSRF, headers/CSP, login_required, throttling
│   ├── table_io.py         #   CSV/XLSX reading, atomic writes
│   ├── users_service.py    #   authentication
│   ├── employees_service.py#   employee validation and saving
│   ├── projects_service.py #   projects list, timeline.json validation
│   ├── versions_service.py #   version files, object store, zip/folder export, file manager
│   ├── diff_service.py     #   side-by-side diff engine
│   ├── run_service.py      #   run a version's app.py
│   └── dialog_service.py   #   native folder dialog (separate process)
├── templates/              # Jinja2 templates (Bootstrap pages + standalone timeline page)
├── static/
│   ├── css/                # base, timeline, diff, filetree, ideas, tabulator-dark
│   ├── js/                 # common, home, settings
│   │   └── timeline/       #   numbered modules, loaded in order (01 … 14)
│   └── vendor/             # Third-party front-end libraries (not bundled)
├── database/
│   ├── users.csv           # Login file (sample data included)
│   └── companies/<id>/     # Created at runtime: employees.csv, projects.json
└── docs/                   # Format and behavior documentation
```

---

## Architecture

```
Browser ──► routes/ (HTTP) ──► services/ (logic + disk) ──► files on disk
   ▲                                  │
   └──────────── JSON / HTML ◄────────┘
```

- **Login** → `users_service.authenticate` → session stores `company_id`, `user_id`, `username`, `company_name`. Every piece of data is scoped by `company_id`.
- **Timeline** → the page reads `GET /api/projects/<pid>/timeline` and writes back with a debounced `PUT` after every change.
- **Version files** → uploaded files are hashed and stored once in `store/objects/`; each version has a manifest in `store/manifests/<commit_id>.json`.
- **Errors** → services raise `ServiceError`; `app.py` turns it into JSON for `/api/*` requests and an HTML error page otherwise.
- **Front end** → no bundler. The timeline is split into numbered scripts that share globals and must be loaded in order.

---

## Data storage

Everything is stored in plain, human-readable files. CSVs are written with a UTF-8 BOM so Persian Excel opens them correctly; reading auto-detects the delimiter (`,`, `;`, Tab) and falls back to `cp1256`.

```
database/
├── users.csv
└── companies/<company_id>/
    ├── employees.csv
    └── projects.json

<project path>/
├── project.json
├── timeline.json            # branches, commits, notes, ideas
├── timeline.prev.json       # one automatic backup
├── store/
│   ├── objects/<xx>/<sha256>    # raw file contents (deduplicated)
│   ├── manifests/<commit>.json  # file list of each version
│   └── tmp/                     # temporary upload data
├── exports/                 # default target of "Export folder"
└── run/                     # working copies and logs for "Run app.py"
```

Detailed schemas: [`docs/data-formats.md`](docs/data-formats.md).

---

## API reference

All mutating requests (`POST` / `PUT` / `DELETE`) require the CSRF token in the `X-CSRF-Token` header (or a `csrf_token` form field). All endpoints require login except `/login`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` / `POST` | `/login` | Login page / authenticate |
| `POST` | `/logout` | End the session |
| `GET` | `/` | Home: list projects |
| `POST` | `/api/projects` | Create a project |
| `DELETE` | `/api/projects/<pid>` | Remove a project from the list (files stay on disk) |
| `POST` | `/api/fs/pick` | Open the native folder dialog *(local only)* |
| `GET` | `/project/<pid>` | Timeline page |
| `GET` / `PUT` | `/api/projects/<pid>/timeline` | Load / save the timeline |
| `GET` | `/api/projects/<pid>/versions/<cid>/files` | File summary and list |
| `POST` | `/api/projects/<pid>/versions/<cid>/upload` | Upload files / folders |
| `POST` | `/api/projects/<pid>/versions/<cid>/files/edit` | `rename` / `delete` / `copy` / `move` |
| `GET` | `/api/projects/<pid>/versions/<cid>/export` | Download version as ZIP |
| `POST` | `/api/projects/<pid>/versions/<cid>/export-folder` | Write version to a folder |
| `GET` | `/api/projects/<pid>/versions/<cid>/diff` | Changed files vs. previous version |
| `GET` | `/api/projects/<pid>/versions/<cid>/diff/file?path=` | Diff rows of one file |
| `POST` | `/api/projects/<pid>/versions/<cid>/run` | Start the version's `app.py` *(local only)* |
| `GET` | `/api/projects/<pid>/run` | Run status and log |
| `POST` | `/api/projects/<pid>/run/stop` | Stop the running app *(local only)* |
| `GET` | `/settings` | Settings page |
| `GET` / `PUT` | `/api/settings/employees` | Read / save employees |
| `POST` | `/api/settings/employees/preview` | Preview an uploaded CSV/XLSX (saves nothing) |
| `GET` | `/settings/employees.csv` | Download employees as CSV |

---

## Security

Built-in protections:

- **CSRF** protection on every mutating request.
- **Strict Content-Security-Policy** (`script-src 'self'`) — no inline scripts anywhere — plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy`.
- **Login throttling**: 5 failed attempts lock the account/IP for 60 seconds.
- **Safe redirects** after login (`safe_next`) and `HttpOnly`, `SameSite=Lax` session cookies.
- **Path hardening**: absolute paths, `..`, drive letters and Windows-forbidden characters are rejected; version file paths are manifest keys, never raw disk paths; `company_id` is restricted to `[A-Za-z0-9_-]{1,40}`.
- **Atomic writes** for all data files.
- **Local-only** access for actions that touch the server machine (folder picker, run `app.py`).

> ### ⚠️ Important before you deploy
> - The sample `users.csv` uses **plain-text passwords** (`0`). You can store a Werkzeug hash instead — values starting with `scrypt:` or `pbkdf2:` are verified as hashes.
> - The app binds to `0.0.0.0` by default. On anything other than a trusted network, set `APP_HOST=127.0.0.1` and put the app behind a reverse proxy with HTTPS.
> - **"Run app.py" executes uploaded code on the server machine without a sandbox.** It is restricted to local requests; never expose this app to untrusted users.
> - Set a strong `SECRET_KEY` in production and keep `database/.secret_key` out of version control.

---

## Documentation

| Document | Contents |
|---|---|
| [`PROJECT_MAP.md`](PROJECT_MAP.md) | Developer map of the whole project and a "where do I change X?" table |
| [`docs/timeline-logic.md`](docs/timeline-logic.md) | Exact rules for versions, branches, delete, merge, naming and color |
| [`docs/versions-files.md`](docs/versions-files.md) | Upload, export, file manager, diff and run behavior |
| [`docs/data-formats.md`](docs/data-formats.md) | Schemas of all data files |

---

## Development guidelines

If you contribute, please keep these project rules:

1. **No inline scripts.** The CSP only allows `script-src 'self'`; pass data to JavaScript with `data-*` attributes or `<meta>` tags.
2. **Send the CSRF token** on every mutating request (`api()` in `common.js` does it for you).
3. **User-visible errors** are raised as `ServiceError("message", status)`.
4. **Paths and limits** come only from `services/config.py` — never hard-code them elsewhere.
5. **Write data files atomically** with `table_io.atomic_write_bytes`.
6. **Validate identifiers**: `company_id` is `[A-Za-z0-9_-]{1,40}`; project names go through `safe_folder_name`.
7. **Language convention:** UI text is Persian; identifiers and code comments are English.
8. **Script order matters** in `static/js/timeline/` — the file number is the load order; register new files in `templates/timeline.html` accordingly.
9. **Keep docs in sync** — update `docs/timeline-logic.md` whenever the timeline behavior changes.

---

## Known limitations

- Real Git is not used yet; versions are JSON snapshots.
- "Remove project" only removes it from the app's list, not from disk.
- Deleting a version (or a file in the file manager) does not delete content from `store/`.
- The diff compares text files only, up to `DIFF_MAX_FILE_KB`, and has no word-level highlighting inside a changed line.
- The native folder picker needs `tkinter` and works only when the browser runs on the same machine as the server.
- Employees are only stored and displayed; only users with `user_id = 0` can log in.
- Real Bootstrap and Tabulator builds have had limited testing (only the basic Tabulator API is used; with Tabulator 4 the `table.on(...)` calls in `settings.js` must be converted to option callbacks).
- Passwords are plain text by default (see [Security](#security)).

---

## Roadmap

- [ ] Real Git repository under the timeline
- [ ] Read-only sharing links
- [ ] Sandboxed execution of a version's `app.py`
- [ ] Garbage collection for unreferenced objects in `store/`
- [ ] Word-level diff highlighting
- [ ] Employee-based roles and multi-user login

---

## Contributing

Contributions are welcome!

1. Fork the repository and create a feature branch: `git checkout -b feature/my-feature`
2. Read [`PROJECT_MAP.md`](PROJECT_MAP.md) first, then change only the files related to your task.
3. Follow the [development guidelines](#development-guidelines).
4. Commit with a clear message and open a pull request describing what and why.

Bug reports and feature requests are welcome in the issue tracker.
