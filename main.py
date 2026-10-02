"""Markdown 筆記本 MVP — Flask 後端。

啟動方式：
    conda activate vibe-coding
    python main.py
然後用瀏覽器開啟 http://127.0.0.1:5000
"""
import re
import secrets
import sqlite3
from functools import wraps
from pathlib import Path

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template,
                   request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_db, init_app

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
UPLOAD_DIR = BASE_DIR / "uploads"

USERNAME_RE = re.compile(r"^\w{3,20}$")  # 中英文、數字、底線，3–20 字
MIN_PASSWORD_LEN = 6
DEFAULT_TITLE = "未命名筆記"
MAX_TITLE_LEN = 200

WELCOME_NOTE = """# 歡迎使用 Markdown 筆記本 👋

這是一篇範例筆記，可以直接修改或刪除。

## 常用語法
- **粗體**、*斜體*、`行內程式碼`
- [連結](https://commonmark.org/help/)
- [x] 已完成的待辦
- [ ] 未完成的待辦

> 引言區塊

```python
print("Hello, vibe coding!")
```

| 功能 | 操作方式 |
| --- | --- |
| 新增筆記 | 左側「＋ 新增筆記」 |
| 儲存 | 自動儲存，或按 Ctrl+S |
| 插入圖片 | 工具列 🖼、直接貼上或拖放圖片 |
| 下載 | 工具列「下載 .md」，圖片會一起打包 |
"""


def load_secret_key():
    """首次啟動時產生隨機金鑰並保存，之後重啟登入狀態仍有效。"""
    key_file = INSTANCE_DIR / "secret_key"
    if not key_file.exists():
        key_file.write_text(secrets.token_hex(32))
    return key_file.read_text().strip()


INSTANCE_DIR.mkdir(exist_ok=True)
UPLOAD_DIR.mkdir(exist_ok=True)

app = Flask(__name__)
app.config.update(
    SECRET_KEY=load_secret_key(),
    DATABASE=str(INSTANCE_DIR / "notebook.db"),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)
init_app(app)


# ---------------------------------------------------------------------------
# 驗證
# ---------------------------------------------------------------------------

@app.before_request
def load_current_user():
    user_id = session.get("user_id")
    g.user = None
    if user_id is not None:
        g.user = get_db().execute(
            "SELECT id, username, created_at FROM users WHERE id = ?", (user_id,)
        ).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            if request.path.startswith("/api/"):
                return jsonify(error="尚未登入"), 401
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped


def validate_password(password, confirm):
    if len(password) < MIN_PASSWORD_LEN:
        return f"密碼至少需要 {MIN_PASSWORD_LEN} 個字元"
    if password != confirm:
        return "兩次輸入的密碼不一致"
    return None


def start_session(user_id):
    session.clear()
    session["user_id"] = user_id


@app.route("/")
def index():
    return redirect(url_for("notes_page" if g.user else "login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("notes_page"))
    username = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT id, password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()
        if user and check_password_hash(user["password_hash"], password):
            start_session(user["id"])
            return redirect(url_for("notes_page"))
        flash("帳號或密碼錯誤", "error")
    return render_template("login.html", mode="login", username=username)


@app.route("/register", methods=["GET", "POST"])
def register():
    if g.user:
        return redirect(url_for("notes_page"))
    username = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        error = None
        if not USERNAME_RE.match(username):
            error = "帳號需為 3–20 個字（中英文、數字、底線）"
        else:
            error = validate_password(password, request.form.get("confirm", ""))
        if error is None:
            db = get_db()
            try:
                cur = db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
            except sqlite3.IntegrityError:
                error = "這個帳號已經有人使用"
            else:
                start_session(cur.lastrowid)
                insert_note(cur.lastrowid, "歡迎使用 Markdown 筆記本", WELCOME_NOTE)
                flash(f"註冊成功，歡迎 {username}！", "success")
                return redirect(url_for("notes_page"))
        flash(error, "error")
    return render_template("login.html", mode="register", username=username)


@app.post("/logout")
def logout():
    session.clear()
    flash("已登出", "success")
    return redirect(url_for("login"))


# ---------------------------------------------------------------------------
# 頁面
# ---------------------------------------------------------------------------

@app.route("/notes")
@login_required
def notes_page():
    return render_template("notes.html", sidebar_toggle=True)


# ---------------------------------------------------------------------------
# 筆記 API（每個查詢都限定 user_id，使用者只能存取自己的筆記）
# ---------------------------------------------------------------------------

@app.errorhandler(404)
@app.errorhandler(413)
def api_error(err):
    if request.path.startswith("/api/"):
        message = "檔案太大" if err.code == 413 else "找不到資料"
        return jsonify(error=message), err.code
    return err


def clean_title(title):
    title = str(title or "").strip()[:MAX_TITLE_LEN]
    return title or DEFAULT_TITLE


def insert_note(user_id, title, content, created_at=None, updated_at=None):
    db = get_db()
    cur = db.execute(
        "INSERT INTO notes (user_id, title, content, created_at, updated_at) "
        "VALUES (?, ?, ?, COALESCE(?, datetime('now', 'localtime')), "
        "COALESCE(?, datetime('now', 'localtime')))",
        (user_id, clean_title(title), content or "", created_at, updated_at),
    )
    db.commit()
    return cur.lastrowid


def note_or_404(note_id):
    note = get_db().execute(
        "SELECT * FROM notes WHERE id = ? AND user_id = ?", (note_id, g.user["id"])
    ).fetchone()
    if note is None:
        abort(404)
    return note


@app.get("/api/notes")
@login_required
def list_notes():
    sql = "SELECT id, title, updated_at FROM notes WHERE user_id = ?"
    params = [g.user["id"]]
    keyword = request.args.get("q", "").strip()
    if keyword:
        like = "%" + re.sub(r"([\\%_])", r"\\\1", keyword) + "%"
        sql += r" AND (title LIKE ? ESCAPE '\' OR content LIKE ? ESCAPE '\')"
        params += [like, like]
    sql += " ORDER BY updated_at DESC, id DESC"
    return jsonify([dict(row) for row in get_db().execute(sql, params)])


@app.post("/api/notes")
@login_required
def create_note():
    data = request.get_json(silent=True) or {}
    note_id = insert_note(g.user["id"], data.get("title"), data.get("content"))
    return jsonify(dict(note_or_404(note_id))), 201


@app.get("/api/notes/<int:note_id>")
@login_required
def get_note(note_id):
    return jsonify(dict(note_or_404(note_id)))


@app.put("/api/notes/<int:note_id>")
@login_required
def update_note(note_id):
    note = note_or_404(note_id)
    data = request.get_json(silent=True) or {}
    content = data.get("content", note["content"])
    if not isinstance(content, str):
        return jsonify(error="內容格式錯誤"), 400
    db = get_db()
    db.execute(
        "UPDATE notes SET title = ?, content = ?, updated_at = datetime('now', 'localtime') "
        "WHERE id = ?",
        (clean_title(data.get("title", note["title"])), content, note_id),
    )
    db.commit()
    return jsonify(dict(note_or_404(note_id)))


@app.delete("/api/notes/<int:note_id>")
@login_required
def delete_note(note_id):
    note_or_404(note_id)
    db = get_db()
    db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    db.commit()
    return "", 204


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
