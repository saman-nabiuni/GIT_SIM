# Data file formats

All files are UTF-8. CSVs are written with a BOM (`utf-8-sig`) so Persian Excel opens them correctly.
When reading a CSV: the delimiter (`,`, `;` or Tab) is detected automatically, and if it is not UTF-8, `cp1256` (the CSV of Excel on Persian Windows) is tried.

## database/users.csv (login file)
Required columns: `company_id, user_id, username, password` (extra columns are allowed; `company_name` is optional and used to show the company name).
- Only rows with `user_id = 0` may log in (other rows are ignored).
- Each row = "me" in one company. `company_id` says which company I work in after login.
- `company_id` is only letters/digits/`_`/`-` (max 40 characters).
- `password`: plain text, or a werkzeug hash (starting with `scrypt:` or `pbkdf2:`).
```
company_id,user_id,username,password
0,0,nb0,0
1,0,nb1,0
```

## database/companies/<company_id>/employees.csv
The file uploaded/edited and saved from "Settings".
- The four required columns with exactly these names (column names are accepted case-insensitively and standardized) + any number of extra columns.
- Rules: `user_id` and `username` must not be empty; each row's `company_id` = the current company; `(company_id,user_id)` and `username` (case-insensitive) must not repeat.
- At most 20000 rows, 60 columns, 500 characters per cell, 5 MB upload (in `config.py`).
- Accepted inputs: `.csv` and `.xlsx` (active sheet; first row = column names). `.xls` is not supported.

## database/companies/<company_id>/projects.json
```json
{"projects": [{"id": "9f3c1a2b4d5e", "name": "Project name", "path": "D:\\Projects\\Project name", "created_at": "2026-10-09T10:00:00+00:00"}]}
```
- `id`: 12 hex characters. `path`: the final project folder (= the given path + the sanitized project name).

## <project path>/project.json
`{id, name, path, created_at, company_id, version: 1}` — written when the project is created.

## <project path>/timeline.json
```json
{
  "version": 1,
  "mode": "dec",
  "ideas": [{"text": "add a login page", "done": false}, {"text": "fix the export path", "done": true}],
  "branches": [{"name": "main", "shade": 0}, {"name": "feat", "shade": 1}],
  "commits": [
    {"id": "a1b2c3d", "name": "1",   "branch": 0, "parent": null,      "twin": null, "base": "#ff2e93", "color": "#ff2e93", "note": ""},
    {"id": "e4f5a6b", "name": "1.1", "branch": 0, "parent": "a1b2c3d", "twin": null, "base": "#ff2e93", "color": "#ff2e93", "note": "purpose of this version"}
  ]
}
```
- `branches[0]` is always main; the array order = the order of lines (lanes) from top to bottom.
- `commits` are in creation order (important for "the last node of each branch"). `branch` is an index into `branches`.
- `parent`/`twin` are the id of another node or `null`. `col` and `stack` are not stored; they are computed from the links on load.
- `note` (optional text, at most 1000 chars) = the purpose/comment of the version. `ideas` (optional) = the notes of the side panel, in order: `{text (max 2000 chars), done}`, at most 500; blank rows are never saved.
- Before saving, the server checks: structure, unique ids, branch index, existence of parent/twin, note and ideas limits, at most 5000 nodes and 2 MB.
- Every new save copies the previous file to `timeline.prev.json` (one backup).
- If the file is corrupt, the page shows an error and **autosave is disabled** so nothing gets overwritten.

## <project path>/store/ (version files)
Behavior details: `docs/versions-files.md`.
- `store/objects/<first 2 chars>/<sha256>` — the raw content of each file; identical content is stored only once.
- `store/manifests/<commit_id>.json` — the full list of a version's files:
```json
{"version": 1, "commit": "b2", "created_at": "...", "updated_at": "...",
 "files": {"app.py": {"h": "<sha256>", "s": 3}, "services/git_service.py": {"h": "<sha256>", "s": 4}}}
```
- `store/tmp/` — temporary upload files (emptied after every upload).

## <project path>/exports/ and <project path>/run/
Created on demand by "Export folder" and "Run app.py" (see `docs/versions-files.md`); both can be deleted at any time.
- `exports/<project>-v<version>/` — default destination of "Export folder" (the user can choose another destination).
- `run/<commit_id>/` — working copy used by "Run app.py"; `run/<commit_id>.stamp` — hash of the manifest the copy was built from; `run/<commit_id>.log` — output of the last run.
