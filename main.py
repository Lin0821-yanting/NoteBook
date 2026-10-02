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

from flask import (Flask, flash, g, jsonify, redirect, render_template,
                   request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_db, init_app

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
UPLOAD_DIR = BASE_DIR / "uploads"

USERNAME_RE = re.compile(r"^\w{3,20}$")  # 中英文、數字、底線，3–20 字
MIN_PASSWORD_LEN = 6


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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
