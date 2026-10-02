# 📒 Markdown 筆記本（MVP）

Vibe Coding 第一個實作：在本機瀏覽器使用的 Markdown 筆記本系統。
後端使用 **Python Flask + SQLite**，前端使用原生 HTML / CSS / JavaScript。

## 功能

| 類別 | 功能 |
| --- | --- |
| 登入頁 | 註冊、登入、登出（密碼以 werkzeug 雜湊儲存） |
| 帳號管理 | 查看帳號資訊與用量、變更密碼、下載備份、刪除帳號（含所有筆記與圖片） |
| 編輯頁 | 新增 / 刪除筆記、搜尋標題與內容、Markdown 編輯 + 即時預覽、自動儲存（Ctrl+S 立即儲存） |
| Markdown 工具列 | 粗體、斜體、標題、清單、待辦、引言、程式碼、連結；編輯 / 分割 / 預覽三種檢視 |
| 導入圖片 | 工具列按鈕選檔、**直接貼上**截圖、**拖放**圖片到編輯區（PNG / JPG / GIF / WebP，單張 5MB） |
| 上傳下載 | 匯入 `.md` 檔成為新筆記、下載單篇 `.md`（圖片以 base64 內嵌，可離線開啟）、全部筆記 JSON 備份與還原 |

## 安裝

需要 [Anaconda / Miniconda](https://www.anaconda.com/)。

```bash
conda env create -f environment.yml
```

或手動建立：

```bash
conda create -n vibe-coding python=3.12 -y
conda activate vibe-coding
pip install -r requirements.txt
```

## 執行

```bash
conda activate vibe-coding
python main.py
```

開啟瀏覽器前往 <http://127.0.0.1:5000>，先註冊一個帳號即可開始使用。
第一次註冊會自動建立一篇「歡迎使用」範例筆記，示範常用的 Markdown 語法。

> Markdown 預覽使用 [marked](https://marked.js.org/) 與 [DOMPurify](https://github.com/cure53/DOMPurify)，由 cdnjs 載入，需要網路連線；離線時預覽會改以純文字顯示，編輯與儲存不受影響。

## 專案結構

```
hw1/
├─ main.py              # Flask app：驗證、頁面、筆記 / 圖片 / 匯入匯出 API
├─ db.py                # SQLite 連線與資料表結構
├─ requirements.txt     # pip 套件
├─ environment.yml      # conda 環境（vibe-coding）
├─ templates/           # Jinja2 頁面：login、notes、account 與共用片段
├─ static/css/style.css # 樣式（支援深色模式、窄螢幕）
├─ static/js/editor.js  # 編輯頁前端邏輯
├─ instance/            # 執行時自動建立：notebook.db、secret_key（不進 git）
└─ uploads/<user_id>/   # 使用者上傳的圖片（不進 git）
```

### API 一覽

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/notes?q=` | 筆記清單（可搜尋） |
| POST | `/api/notes` | 新增筆記 |
| GET / PUT / DELETE | `/api/notes/<id>` | 讀取 / 儲存 / 刪除 |
| POST | `/api/images` | 上傳圖片，回傳 `{url}` |
| GET | `/api/notes/<id>/export` | 下載 `.md`（圖片內嵌） |
| POST | `/api/notes/import` | 上傳 `.md` 建立新筆記 |
| GET | `/api/backup` | 下載全部筆記 JSON |
| POST | `/api/restore` | 上傳備份 JSON，新增到目前帳號 |

## 版本控制（git）

每完成一個功能就 commit 一次，可隨時查看或還原：

```bash
git log --oneline              # 查看版本紀錄
git diff                       # 查看尚未 commit 的修改
git restore <檔案>             # 放棄某個檔案尚未 commit 的修改
git checkout <commit>          # 暫時切回某個版本查看（看完用 git switch main 回來）
git revert <commit>            # 新增一個 commit 來撤銷指定版本的修改
```

## 安全性與已知限制

- 只監聽 `127.0.0.1`，僅供本機使用；以 Flask 開發伺服器（debug 模式）執行，**不適合直接部署到公開網路**。
- 已做：密碼雜湊、每個查詢都檢查筆記 / 圖片擁有者、圖片以檔頭判斷格式並改用隨機檔名、預覽經 DOMPurify 消毒、`nosniff` 標頭、Cookie `HttpOnly` + `SameSite=Lax`。
- 未做：CSRF token、忘記密碼 / Email 驗證、登入失敗次數限制。
- 刪除筆記時不會一併刪除它用到的圖片（刪除帳號時才會清空）。
- 還原備份是「新增」筆記，重複還原會產生重複筆記。

## 下一步（Roadmap）

- [ ] 標籤 / 資料夾分類、釘選筆記
- [ ] 全文搜尋結果標示關鍵字
- [ ] 筆記版本紀錄與還原
- [ ] 分享唯讀連結
- [ ] 程式碼區塊語法高亮、數學公式（KaTeX）
- [ ] 清理未被引用的圖片
- [ ] CSRF 防護、正式部署設定（gunicorn / waitress）
