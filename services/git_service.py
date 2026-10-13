"""Thin wrapper over the git command line (no shell, list args only)."""
import re
import shutil
import subprocess


class GitError(RuntimeError):
    pass


def git_available() -> bool:
    return shutil.which("git") is not None


def run_git(args, cwd, timeout=30):
    try:
        p = subprocess.run(
            ["git", *args], cwd=str(cwd), capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout, stdin=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        raise GitError("git روی این سیستم نصب نیست یا در PATH نیست.")
    except subprocess.TimeoutExpired:
        raise GitError("دستور git زیادی طول کشید.")
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def _must(args, cwd):
    code, out, err = run_git(args, cwd)
    if code != 0:
        raise GitError(err or out or f"git {args[0]} failed")
    return out


def is_repo(path) -> bool:
    return (path / ".git").exists()


def init_repo(path, username: str, title: str, first_commit: bool = True):
    """git init (branch main) + local identity if missing + README + first commit.
    Returns a warning string or ''."""
    code, _, _ = run_git(["init", "-b", "main"], path)
    if code != 0:  # git older than 2.28
        _must(["init"], path)
        _must(["symbolic-ref", "HEAD", "refs/heads/main"], path)

    if run_git(["config", "user.name"], path)[0] != 0:
        _must(["config", "user.name", username], path)
    if run_git(["config", "user.email"], path)[0] != 0:
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", username) or "user"
        _must(["config", "user.email", f"{safe}@localhost"], path)

    if not first_commit:
        return ""
    readme = path / "README.md"
    if not readme.exists():
        readme.write_text(f"# {title}\n", encoding="utf-8")
    try:
        _must(["add", "README.md"], path)
        _must(["commit", "-m", "Initial commit"], path)
    except GitError as e:
        return f"پروژه ساخته شد ولی کامیت اول انجام نشد: {e}"
    return ""
