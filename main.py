"""Markdown 筆記本 MVP — Flask 後端。

啟動方式：
    conda activate vibe-coding
    python main.py          # 只有本機可用：http://127.0.0.1:5000
    python main.py --lan    # 同一個 Wi-Fi 的手機 / 平板也能連線
"""
import argparse
import base64
import io
import json
import re
import secrets
import shutil
import socket
import sqlite3
import uuid
from datetime import date, datetime
from functools import wraps
from pathlib import Path

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template,
                   request, send_file, send_from_directory, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_db, init_app

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
UPLOAD_DIR = BASE_DIR / "uploads"

USERNAME_RE = re.compile(r"^\w{3,20}$")  # 中英文、數字、底線，3–20 字
MIN_PASSWORD_LEN = 6
THEMES = ("light", "dark", "system")
DEFAULT_TITLE = "未命名筆記"
MAX_TITLE_LEN = 200
MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_MIME = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}

# 筆記內的上傳圖片網址，例如 /uploads/3/0123...cdef.png（前面不能接網域，避免誤改外部網址）
UPLOAD_URL_RE = re.compile(r"(?<![\w/])/uploads/(\d+)/([0-9a-f]{32}\.(?:png|jpg|gif|webp))")
DATA_URI_RE = re.compile(r"data:image/(?:png|jpe?g|gif|webp);base64,([A-Za-z0-9+/]+={0,2})")
TIMESTAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")

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
    MAX_CONTENT_LENGTH=20 * 1024 * 1024,  # 單次請求上限（匯入含圖片的 .md / 備份檔）
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)
init_app(app)


@app.after_request
def set_security_headers(response):
    # 禁止瀏覽器猜測檔案類型，避免偽裝成圖片的 HTML 被執行
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response


# ---------------------------------------------------------------------------
# 驗證
# ---------------------------------------------------------------------------

@app.before_request
def load_current_user():
    user_id = session.get("user_id")
    g.user = None
    if user_id is not None:
        g.user = get_db().execute(
            "SELECT id, username, theme, created_at FROM users WHERE id = ?", (user_id,)
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
# 帳號管理
# ---------------------------------------------------------------------------

def format_size(num_bytes):
    for unit in ("B", "KB", "MB"):
        if num_bytes < 1024:
            return f"{num_bytes:.0f} {unit}" if unit == "B" else f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024
    return f"{num_bytes:.1f} GB"


def verify_password(password):
    row = get_db().execute(
        "SELECT password_hash FROM users WHERE id = ?", (g.user["id"],)
    ).fetchone()
    return check_password_hash(row["password_hash"], password)


@app.get("/account")
@login_required
def account():
    note_count = get_db().execute(
        "SELECT COUNT(*) FROM notes WHERE user_id = ?", (g.user["id"],)
    ).fetchone()[0]
    folder = UPLOAD_DIR / str(g.user["id"])
    images = [p for p in folder.iterdir() if p.is_file()] if folder.is_dir() else []
    return render_template(
        "account.html",
        note_count=note_count,
        image_count=len(images),
        image_size=format_size(sum(p.stat().st_size for p in images)),
    )


@app.post("/account/password")
@login_required
def change_password():
    new_password = request.form.get("new_password", "")
    if not verify_password(request.form.get("old_password", "")):
        flash("目前密碼不正確", "error")
    elif error := validate_password(new_password, request.form.get("confirm", "")):
        flash(error, "error")
    else:
        db = get_db()
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                   (generate_password_hash(new_password), g.user["id"]))
        db.commit()
        flash("密碼已更新", "success")
    return redirect(url_for("account"))


@app.post("/account/delete")
@login_required
def delete_account():
    if not verify_password(request.form.get("password", "")):
        flash("密碼不正確，帳號未刪除", "error")
        return redirect(url_for("account"))
    user_id = g.user["id"]
    db = get_db()
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))  # 筆記會一併 CASCADE 刪除
    db.commit()
    shutil.rmtree(UPLOAD_DIR / str(user_id), ignore_errors=True)
    session.clear()
    flash("帳號與所有筆記已刪除", "success")
    return redirect(url_for("login"))


@app.put("/api/settings")
@login_required
def update_settings():
    """帳號偏好設定（目前只有主題），存在資料庫，所有裝置同步。"""
    theme = (request.get_json(silent=True) or {}).get("theme")
    if theme not in THEMES:
        return jsonify(error="主題只能是 light、dark 或 system"), 400
    db = get_db()
    db.execute("UPDATE users SET theme = ? WHERE id = ?", (theme, g.user["id"]))
    db.commit()
    return jsonify(theme=theme)


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


# ---------------------------------------------------------------------------
# 圖片：存在 uploads/<user_id>/<uuid>.<ext>，只有擁有者能讀取
# ---------------------------------------------------------------------------

def detect_image_ext(data):
    """依檔頭判斷圖片格式，不信任使用者提供的副檔名。"""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def save_image(user_id, data, ext):
    folder = UPLOAD_DIR / str(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    (folder / name).write_bytes(data)
    return f"/uploads/{user_id}/{name}"


@app.post("/api/images")
@login_required
def upload_image():
    file = request.files.get("image")
    if file is None:
        return jsonify(error="沒有收到圖片"), 400
    data = file.read()
    if len(data) > MAX_IMAGE_BYTES:
        return jsonify(error="圖片不可超過 5MB"), 400
    ext = detect_image_ext(data)
    if ext is None:
        return jsonify(error="只支援 PNG、JPG、GIF、WebP 圖片"), 400
    return jsonify(url=save_image(g.user["id"], data, ext)), 201


@app.get("/uploads/<int:user_id>/<name>")
@login_required
def serve_upload(user_id, name):
    if user_id != g.user["id"]:
        abort(404)
    return send_from_directory(UPLOAD_DIR / str(user_id), name)


# ---------------------------------------------------------------------------
# 上傳 / 下載：單篇 .md 匯入匯出、全部筆記 JSON 備份還原
# 匯出時把圖片轉成 base64 內嵌，檔案可獨立開啟；匯入時再轉回上傳檔。
# ---------------------------------------------------------------------------

def inline_images(markdown, user_id):
    def to_data_uri(match):
        path = UPLOAD_DIR / match.group(1) / match.group(2)
        if int(match.group(1)) != user_id or not path.is_file():
            return match.group(0)
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        return f"data:{IMAGE_MIME[path.suffix[1:]]};base64,{encoded}"
    return UPLOAD_URL_RE.sub(to_data_uri, markdown)


def extract_data_images(markdown, user_id):
    def to_upload_url(match):
        try:
            data = base64.b64decode(match.group(1), validate=True)
        except ValueError:
            return match.group(0)
        ext = detect_image_ext(data)
        if ext is None or len(data) > MAX_IMAGE_BYTES:
            return match.group(0)
        return save_image(user_id, data, ext)
    return DATA_URI_RE.sub(to_upload_url, markdown)


def safe_filename(name):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip(" .")
    return name[:100] or "note"


def download(data, filename, mimetype):
    return send_file(io.BytesIO(data), mimetype=mimetype, as_attachment=True,
                     download_name=filename)


@app.get("/api/notes/<int:note_id>/export")
@login_required
def export_note(note_id):
    note = note_or_404(note_id)
    markdown = inline_images(note["content"], g.user["id"])
    return download(markdown.encode("utf-8"), safe_filename(note["title"]) + ".md",
                    "text/markdown")


@app.post("/api/notes/import")
@login_required
def import_note():
    file = request.files.get("file")
    if file is None or not file.filename.lower().endswith((".md", ".markdown", ".txt")):
        return jsonify(error="請選擇 .md 檔案"), 400
    try:
        content = file.read().decode("utf-8-sig").replace("\r\n", "\n")
    except UnicodeDecodeError:
        return jsonify(error="檔案需為 UTF-8 編碼"), 400
    # 標題：第一行若是「# 標題」就用它，否則用檔名
    first_line = content.lstrip("\n").split("\n", 1)[0]
    heading = re.match(r"#\s+(.+)", first_line)
    title = heading.group(1).strip() if heading else Path(file.filename).stem
    note_id = insert_note(g.user["id"], title, extract_data_images(content, g.user["id"]))
    return jsonify(dict(note_or_404(note_id))), 201


@app.get("/api/backup")
@login_required
def backup():
    user_id = g.user["id"]
    rows = get_db().execute(
        "SELECT title, content, created_at, updated_at FROM notes WHERE user_id = ? ORDER BY id",
        (user_id,),
    )
    payload = {
        "app": "markdown-notebook",
        "version": 1,
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "notes": [{**dict(row), "content": inline_images(row["content"], user_id)} for row in rows],
    }
    data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return download(data, f"notebook-backup-{date.today():%Y%m%d}.json", "application/json")


@app.post("/api/restore")
@login_required
def restore():
    """把備份檔中的筆記「新增」到目前帳號，不會覆蓋既有筆記。"""
    file = request.files.get("file")
    try:
        notes = json.loads(file.read().decode("utf-8-sig"))["notes"]
        if not isinstance(notes, list):
            raise ValueError
    except (AttributeError, KeyError, TypeError, ValueError):
        return jsonify(error="不是有效的備份檔"), 400

    def timestamp(value):
        return value if isinstance(value, str) and TIMESTAMP_RE.fullmatch(value) else None

    user_id = g.user["id"]
    imported = 0
    for note in notes:
        if not isinstance(note, dict) or not isinstance(note.get("content", ""), str):
            continue
        insert_note(user_id, note.get("title"),
                    extract_data_images(note.get("content", ""), user_id),
                    timestamp(note.get("created_at")), timestamp(note.get("updated_at")))
        imported += 1
    return jsonify(imported=imported)


def lan_ip():
    """取得這台電腦在區網中的 IP（UDP connect 不會真的送出封包）。"""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
        except OSError:
            return "127.0.0.1"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Markdown 筆記本")
    parser.add_argument("--lan", action="store_true",
                        help="允許同一個 Wi-Fi 的手機 / 平板連線（會關閉 debug 模式）")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    if args.lan:
        print("=" * 60)
        print(f" 手機 / 平板請在瀏覽器開啟： http://{lan_ip()}:{args.port}")
        print(f" 本機也可以開啟：            http://127.0.0.1:{args.port}")
        print(" 注意：同一個網路的人都連得到，請只在信任的 Wi-Fi 使用。")
        print("=" * 60)
        # debugger 允許執行任意程式碼，絕不能開放到區網
        app.run(host="0.0.0.0", port=args.port, debug=False, threaded=True)
    else:
        app.run(host="127.0.0.1", port=args.port, debug=True)
