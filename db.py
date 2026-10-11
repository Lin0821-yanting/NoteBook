"""SQLite 資料存取：連線管理與資料表結構。"""
import sqlite3

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    theme         TEXT NOT NULL DEFAULT 'system',
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 資料夾可以多層：parent_id 為 NULL 表示在根目錄；刪除資料夾時子資料夾一併刪除
CREATE TABLE IF NOT EXISTS folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- folder_id 為 NULL 表示筆記在根目錄
CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id  INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    title      TEXT NOT NULL DEFAULT '未命名筆記',
    content    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(user_id, parent_id);
"""

# 用到遷移後才有的欄位，必須在 migrate() 之後才能建立
POST_MIGRATION_SQL = """
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);
"""


def connect(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    """每個請求共用一條連線，請求結束時由 close_db 關閉。"""
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE"])
    return g.db


def close_db(exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# 舊版資料庫缺少的欄位：(資料表, 欄位, 欄位定義)
MIGRATIONS = [
    ("users", "theme", "TEXT NOT NULL DEFAULT 'system'"),
    ("notes", "folder_id", "INTEGER REFERENCES folders(id) ON DELETE SET NULL"),
]


def migrate(conn):
    for table, column, definition in MIGRATIONS:
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    conn.commit()


def init_app(app):
    """建立資料表（若不存在）、補上舊版缺少的欄位，並註冊請求結束時的關閉動作。"""
    conn = connect(app.config["DATABASE"])
    try:
        conn.executescript(SCHEMA)
        migrate(conn)
        conn.executescript(POST_MIGRATION_SQL)
    finally:
        conn.close()
    app.teardown_appcontext(close_db)
