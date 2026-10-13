# Run

```
pip install -r requirements.txt
python app.py
```
Open http://127.0.0.1:5000 . git must be installed and in PATH.

# Vendor files (copy into static/vendor/)

```
static/vendor/bootstrap/bootstrap.bundle.min.js
static/vendor/bootstrap/bootstrap.rtl.min.css
static/vendor/bootstrap-icons/bootstrap-icons.min.css
static/vendor/bootstrap-icons/fonts/bootstrap-icons.woff
static/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2
static/vendor/tabulator/tabulator.min.js
static/vendor/tabulator/tabulator.min.css
static/vendor/tabulator/tabulator_bootstrap5.min.css
```

# Notes
- Passwords in users.csv may be plain text (like the sample) or a werkzeug hash (pbkdf2:/scrypt:).
- The folder dialog opens on the machine running the server (needs tkinter, included in the normal Windows Python installer). It is refused for non-local requests; type the path by hand there.
- To use from another device on the LAN set the environment variable APP_HOST=0.0.0.0 (see services/config.py). The folder picker
  lists folders of the machine running the server, so only do this on a trusted network.
