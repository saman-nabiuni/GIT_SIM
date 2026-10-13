# Files of each version (upload and export)

Code: `services/versions_service.py` (logic), `routes/project_routes.py` (API), `static/js/timeline/09-files.js` (UI).

## What the user sees
Click a version -> the "Files of this version" section:
- A summary of the files (count and size; if the version has no files of its own: "inherited from version X") and an expandable list.
- **Upload file / folder...**: a dialog where you can press "Add files" or "Add folder" several times (or drag and drop files/folders); everything collects in one list and is sent at once with "Upload".
- **Export zip**: all files of that version (with folder structure) as a zip.
- **Export folder...**: saves the version's files as a real folder. The dialog is pre-filled with the project's default path (`<project>/exports`, or the last custom path used for this project in this browser); change it by typing or with **Select folder...** (native Windows dialog). The files go into a new folder `<path>/<project>-v<version>/`. If that folder already exists and is not empty you are asked to confirm; same-name files are replaced, other files are left alone.
- **Structure and file management...**: a dialog with the version's folder tree. Tick files/folders, then **Cut / Copy / Paste / Rename / Delete** (shortcuts Ctrl+X, Ctrl+C, Ctrl+V, F2, Delete). The folder you click is the paste target (the top row `/` is the project root). Only this version's file list changes; other versions are untouched.
- **Run app.py**: shown only when `app.py` is in the first layer of the version's files (inherited files count; `sub/app.py` does not). No export or save is needed: the app starts straight away and a dialog shows its address and output, with a **Stop** button.

## Upload rules for version N
1. **Base**: N's own files if they were uploaded before; otherwise the files of its previous version (`parent`, and `twin` for a twin node).
2. Uploaded files are applied on top of the base:
   - new path -> **added**; existing path with different content -> **replaced**; identical content -> **unchanged** (not stored again).
3. A file that was not uploaded is **never deleted** (e.g. `data.py` stays in version 2). Deleting a file is manual.
4. Folder structure is kept: the file `git_service.py` from the `services` folder -> path `services/git_service.py` (the folder is created).
   If the selected folder is itself the project root, tick "its name should not appear in the path".
5. A version that was never uploaded shows the previous version's files in the export/summary; on its first upload it takes its own fixed snapshot.
6. After an upload, changes in earlier versions do not affect later versions (each version is an independent snapshot).

## File manager rules
- Code: `versions_service.edit_files`, API `POST .../versions/<cid>/files/edit`, UI `14-filemgr.js`.
- Only the manifest changes (content is stored by hash), so every operation is instant. A version without files of its own first takes a snapshot of the inherited files, then the change is applied to that snapshot (the previous version does not change).
- Copy into the same folder creates `name - copy.ext`. Moving/copying onto an existing file asks for confirmation (409 `exists`) and then replaces it. A folder cannot be put inside itself; a file and a folder cannot share a path.
- A deleted file shows up as "removed" in the compare dialog.

## Run app.py
- Code: `services/run_service.py`, API in `routes/project_routes.py`, UI in `static/js/timeline/11-actions.js`.
- The version's files are copied once to `<project>/run/<commit_id>/`. While the version's files do not change (compared with a hash of the manifest) the copy is reused, so running again is instant and files the app created there are kept; when the files change the folder is rebuilt from the store.
- Started with the same Python as this app: `python app.py` in that folder, on a free port passed as env `APP_PORT` and `PORT` (and `APP_HOST=127.0.0.1`); `SECRET_KEY` and `APP_DEBUG` are not passed on. Output goes to `<project>/run/<commit_id>.log`.
- One running app per project: running another version stops the previous one. Stop kills the whole process tree. Everything is stopped when this app exits.
- Local requests only (it runs code on the server machine).

## Storage
- Content by sha256 in `store/objects/` (once), and each version's list in `store/manifests/<commit_id>.json`.
- Merging/renaming nodes does not change the node id, so files stay with the node. Deleting a node does not delete the stored files.

## Security and limits (`services/config.py`)
- Paths are normalized; absolute paths, `..`, a drive (`C:`) and Windows-forbidden characters are rejected. `\` is converted to `/`.
- Paths that differ only by letter case (`Services/` and `services/`) count as the same file.
- A path cannot be both a file and a folder. A duplicate path in one upload is an error.
- The folders `.git`, `__pycache__`, `node_modules`, `.venv`, `venv`, `.idea`, `.vscode` and the files `.DS_Store`, `Thumbs.db` are skipped (`IGNORED_DIRS`/`IGNORED_FILES`).
- Export folder: a relative path, a path inside this app's folder, or a path inside the project's `store/` is refused. The default `exports/` folder is created inside the project folder.
- Caps: 200 MB total, 50 MB per file, 3000 files per upload, 400 characters of path.
- The version must already be saved in `timeline.json`; before upload/listing the UI waits for `ensureSaved()`.

## API
| | |
|---|---|
| `GET  /api/projects/<pid>/versions/<cid>/files` | summary + file list |
| `POST /api/projects/<pid>/versions/<cid>/upload` | multipart: `files` (many) and `paths` (a JSON array in the same order as the files) |
| `GET  /api/projects/<pid>/versions/<cid>/export` | zip |
| `POST /api/projects/<pid>/versions/<cid>/files/edit` | JSON `{op: rename\|delete\|copy\|move, paths: [...], dest, new_name, overwrite}` -> `{affected, ...files summary}`; 409 with `details: ["exists"]` when files would be replaced |
| `POST /api/projects/<pid>/versions/<cid>/export-folder` | JSON `{dest, overwrite}` -> `{path, count}`; `dest` empty = default; 409 with `details: ["exists"]` when the folder exists and `overwrite` is false |
| `POST /api/projects/<pid>/versions/<cid>/run` | start `app.py` of that version -> status (local only) |
| `GET  /api/projects/<pid>/run` | status: `{running, cid, version, port, url, exit_code, log}` |
| `POST /api/projects/<pid>/run/stop` | stop the running app (local only) |
