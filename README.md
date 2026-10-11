# 📒 Markdown 筆記本（NoteBook）

Vibe Coding 作業一：在瀏覽器使用的 Markdown 筆記本系統，**電腦、平板、手機**都能使用相同的功能。
後端使用 **Python Flask + SQLite**，前端使用原生 HTML / CSS / JavaScript，不需要另外安裝資料庫或 Node.js。

---

## 快速開始

clone 下來後執行以下指令（以 conda 為例，其他方式見[環境建立](#環境建立)）：

```bash
git clone https://github.com/Lin0821-yanting/NoteBook.git
cd NoteBook
conda env create -f environment.yml
conda activate vibe-coding
python main.py
```

1. 用瀏覽器開啟 <http://127.0.0.1:5000>。
2. 切到「註冊」頁建立一個帳號（帳號 3–20 字、密碼至少 6 字）。專案**不附任何帳號或資料**，第一次執行會自動建立全新的空資料庫。
3. 註冊後會自動建立一篇「歡迎使用」範例筆記，示範常用的 Markdown 語法。

---

## 功能總覽

| 類別 | 功能 |
| --- | --- |
| 帳號 | 註冊、登入、登出；帳號管理頁可查看用量、變更密碼、外觀設定、下載備份、刪除帳號（含所有資料） |
| 資料夾 | 像檔案總管一樣用資料夾分類（例如依科目），支援多層子資料夾；資料夾旁「＋」直接在裡面新增筆記；展開 / 收合；拖放或「移動到…」搬移；刪除時可選擇保留內容或一起刪除 |
| 編輯 | Markdown 編輯 + 即時預覽（編輯 / 分割 / 預覽三種檢視）、自動儲存、搜尋標題與內容 |
| 工具列 | 粗體、斜體、標題、項目 / 編號 / 待辦清單、引言、程式碼、連結、圖片、手寫 |
| 清單輸入 | 在清單行按 Enter 自動延續，編號清單自動遞增並重新編號；空項目按 Enter 結束清單 |
| 圖片 | 按鈕選檔（手機可選相簿或拍照）、直接貼上截圖、拖放到編輯區（PNG / JPG / GIF / WebP，單張 5MB） |
| 手寫 | 全螢幕畫板：觸控筆壓力感應、防手掌誤觸、四色筆、螢光筆、橡皮擦、粗細、復原 / 重做、空白 / 橫線 / 方格紙；預覽中的圖片可再次手寫編輯或標註 |
| 上傳下載 | 匯入 `.md` 成為新筆記（可指定資料夾）、下載單篇 `.md`（圖片以 base64 內嵌，可離線開啟）、全部筆記與資料夾 JSON 備份 / 還原 |
| 外觀 | 淺色 / 深色 / 跟隨系統（配色參考 VS Code），設定存在帳號中，各裝置同步 |
| 裝置 | 電腦：側欄常駐、可收合；平板：側欄抽屜、分割檢視；手機：編輯 / 預覽切換、按鈕放大好點選 |

---

## 系統需求

| 項目 | 需求 | 開發與測試環境 |
| --- | --- | --- |
| Python | **3.10 以上** | 3.12.15 |
| Python 套件 | 見 [`requirements.txt`](requirements.txt)（Flask 3.1.3 及其相依套件，版本已固定） | 同左 |
| 環境管理（擇一） | Anaconda / Miniconda，或 Python 內建的 `venv` + `pip` | conda 25.5.1 |
| 作業系統 | Windows / macOS / Linux（純 Python，無平台限制） | Windows 11 |
| 瀏覽器 | Chrome / Edge 108+、Safari 15.4+、Firefox 121+ | Chrome |
| 網路 | Markdown 預覽元件 marked 18.0.14、DOMPurify 3.4.16 從 cdnjs 載入；離線時預覽改以純文字顯示，編輯與儲存不受影響 | — |

> 為什麼是 Python 3.10 以上：固定版本的 `click 8.5.0`（Flask 的相依套件）需要 Python 3.10+。

---

## 環境建立

以下兩種方式擇一即可，都會安裝 `requirements.txt` 中固定版本的套件。

### 方式一：conda（推薦）

[`environment.yml`](environment.yml) 會建立名為 `vibe-coding` 的環境（Python 3.12），並用 pip 安裝 `requirements.txt`。

```bash
conda env create -f environment.yml
conda activate vibe-coding
```

> Windows 若在 PowerShell 找不到 `conda` 指令，請改用開始選單中的「Anaconda Prompt」。

### 方式二：venv + pip

**Windows（PowerShell / 命令提示字元）**

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

**macOS / Linux**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`.venv/` 已列在 `.gitignore`，不會被上傳。

### 確認安裝

```bash
python --version          # 應為 3.10 以上
python -c "import flask; print('Flask OK')"
```

---

## 執行

```bash
python main.py                  # 本機模式：http://127.0.0.1:5000（只有這台電腦能連，開啟 debug）
python main.py --port 8000      # 換連接埠（5000 被占用時）
python main.py --lan            # 區網模式：同一個 Wi-Fi 的手機 / 平板也能連線
```

停止伺服器：在執行的終端機按 `Ctrl+C`。

### 在手機 / 平板上使用（區網模式）

1. 手機、平板與電腦連到**同一個 Wi-Fi**。
2. 電腦執行 `python main.py --lan`，終端機會印出類似 `http://192.168.x.x:5000` 的網址。
3. 在手機 / 平板的瀏覽器輸入該網址（要包含 `http://` 與 `:5000`）。

注意事項：
- Windows 第一次執行會跳出防火牆詢問，請允許 Python 在「私人網路」通訊；若 Wi-Fi 被設為「公用網路」，請到「設定 → 網路和網際網路 → Wi-Fi → 網路設定檔類型」改成「私人」。
- 區網模式會自動關閉 debug，但同一個網路的人都連得到，**請只在家裡等信任的 Wi-Fi 使用**。

---

## 使用說明

### 資料夾

- 側欄上方的「📁 新增資料夾」與「＋ 新增筆記」會建立在最上層；要放進某個資料夾，請按該資料夾旁的「＋」。
- 資料夾的「⋯」選單：新增子資料夾、重新命名、移動到…、匯入 .md 到這裡、刪除資料夾。
- 搬移筆記 / 資料夾：電腦可直接拖放（拖到清單空白處＝移到最上層）；手機 / 平板用「⋯ → 移動到…」，或點編輯區上方的資料夾路徑。
- 資料夾依名稱排序，數字照大小排（「第2章」在「第10章」前面）；資料夾內的筆記依最後修改時間排序。
- 刪除有內容的資料夾時會詢問：「保留內容，移到上一層」或「連同筆記一起刪除」。

### 鍵盤快捷鍵

| 按鍵 | 作用 |
| --- | --- |
| `Ctrl+S` | 立即儲存（平常會自動儲存） |
| `Ctrl+B` / `Ctrl+I` | 粗體 / 斜體 |
| `Enter`（在清單行） | 自動接續下一個項目；空項目按 Enter 結束清單 |
| `Shift+Enter` | 一般換行（不延續清單） |
| `F2`（選取資料夾時） | 重新命名資料夾 |
| `Ctrl+Z` / `Ctrl+Y` | 復原 / 重做（編輯區與手寫畫板都適用） |
| `Esc` | 關閉選單、對話框或取消手寫 |

### 圖片與手寫

- 🖼 圖片：電腦可直接貼上截圖或拖放圖片到編輯區；手機可從相簿選取或拍照。
- ✍ 手寫：平板用觸控筆時，線條粗細會跟著筆壓變化；用過觸控筆後，畫板會忽略手指 / 手掌觸控（重新整理頁面後重置）。電腦可用滑鼠畫。
- 預覽中的圖片右上角有「✏️ 手寫編輯」，可以在既有圖片或照片上繼續寫、標註。

### 上傳下載與備份

- 側欄「匯入 .md 檔」：上傳 Markdown 檔成為新筆記；資料夾選單的「匯入 .md 到這裡」可直接放進該資料夾。
- 筆記的「⋯ → 下載 .md」：圖片會以 base64 內嵌，單一檔案即可離線開啟。
- 「備份全部筆記」下載 JSON（含資料夾結構），可在任何帳號用「從備份還原」新增回來。

---

## 資料存放與隱私

所有資料都存在專案資料夾內，**並已在 `.gitignore` 中排除，不會上傳到 GitHub**：

| 位置 | 內容 | 建立時機 |
| --- | --- | --- |
| `instance/notebook.db` | SQLite 資料庫：帳號（密碼已雜湊）、筆記、資料夾、外觀設定 | 第一次執行 `main.py` 時自動建立 |
| `instance/secret_key` | 登入 session 用的隨機金鑰 | 第一次執行時自動產生 |
| `uploads/<使用者 id>/` | 上傳的圖片與手寫圖 | 第一次上傳圖片時 |

因此 clone 專案的人（例如助教）會得到全新的空資料庫，需要自行註冊帳號；舊版資料庫則會在啟動時自動升級欄位，不會遺失資料。

---

## 專案結構

```
NoteBook/
├─ main.py              # Flask 主程式：登入驗證、頁面、筆記 / 資料夾 / 圖片 / 匯入匯出 API、區網模式
├─ db.py                # SQLite 連線、資料表結構與自動遷移
├─ requirements.txt     # Python 套件（固定版本）
├─ environment.yml      # conda 環境定義（vibe-coding，Python 3.12）
├─ templates/           # Jinja2 頁面
│  ├─ base.html         #   共用版型（輸出主題設定）
│  ├─ login.html        #   登入 / 註冊
│  ├─ notes.html        #   筆記主畫面、手寫畫板、對話框
│  ├─ account.html      #   帳號管理
│  └─ _topbar.html、_flashes.html
├─ static/
│  ├─ css/style.css     # 樣式：深色 / 淺色主題、電腦 / 平板 / 手機版面
│  └─ js/
│     ├─ editor.js      # 編輯頁：筆記、儲存、Markdown 工具列、圖片、資料夾操作、對話框
│     ├─ tree.js        # 側欄資料夾樹：展開收合、行內命名、拖放
│     ├─ sketch.js      # 手寫畫板：Pointer Events、觸控筆壓力、復原 / 重做
│     └─ theme.js       # 深色 / 淺色主題切換與儲存
├─ instance/            # （自動建立，不進 git）資料庫與金鑰
└─ uploads/             # （自動建立，不進 git）使用者上傳的圖片
```

### API 一覽

所有 `/api/` 路徑都需要登入，且只能存取自己的資料。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/notes?q=` | 筆記清單（可搜尋），含 `folder_id` |
| POST | `/api/notes` | 新增筆記，可帶 `folder_id` |
| GET / PUT / DELETE | `/api/notes/<id>` | 讀取 / 儲存（帶 `folder_id` 即搬移）/ 刪除 |
| GET / POST | `/api/folders` | 資料夾清單 / 建立資料夾 `{name, parent_id}` |
| PUT | `/api/folders/<id>` | 重新命名 `{name}` 或搬移 `{parent_id}`（null＝最上層） |
| DELETE | `/api/folders/<id>?notes=move\|delete` | 刪除資料夾：內容移到上一層 / 連同筆記刪除 |
| POST | `/api/images` | 上傳圖片，回傳 `{url}` |
| GET | `/api/notes/<id>/export` | 下載 `.md`（圖片內嵌） |
| POST | `/api/notes/import` | 上傳 `.md` 建立新筆記（表單可帶 `folder_id`） |
| GET | `/api/backup` | 下載全部筆記與資料夾 JSON（v2） |
| POST | `/api/restore` | 上傳備份 JSON，新增到目前帳號（相容 v1） |
| PUT | `/api/settings` | 儲存帳號偏好：`{"theme": "light" \| "dark" \| "system"}` |

---

## 常見問題

| 狀況 | 解決方式 |
| --- | --- |
| 啟動時顯示連接埠被占用（`Address already in use` 或 `WinError 10048`） | 改用 `python main.py --port 8000`，再開啟 <http://127.0.0.1:8000> |
| Markdown 預覽只顯示純文字 | 電腦沒有網路，無法從 cdnjs 載入預覽元件；連上網路後重新整理即可 |
| 手機連不到 `--lan` 的網址 | 確認同一個 Wi-Fi、Windows 網路設為「私人」、防火牆允許 Python；部分「訪客網路」會封鎖裝置互連 |
| `pip install` 失敗，提示需要較新的 Python | 本專案需要 Python 3.10 以上，請用 conda 方式建立環境 |

---

## 版本控制（git）

開發過程每完成一個功能就 commit 一次，可隨時查看或還原：

```bash
git log --oneline              # 查看版本紀錄
git diff                       # 查看尚未 commit 的修改
git restore <檔案>             # 放棄某個檔案尚未 commit 的修改
git checkout <commit>          # 暫時切回某個版本查看（看完用 git switch main 回來）
git revert <commit>            # 新增一個 commit 來撤銷指定版本的修改
```

---

## 安全性與已知限制

- 預設只監聽 `127.0.0.1`；`--lan` 會開放給同一個區網並關閉 debug。兩者都是 Flask 開發伺服器，**不適合直接部署到公開網路**。
- 已做：密碼雜湊、每個查詢都檢查擁有者、圖片以檔頭判斷格式並改用隨機檔名、預覽經 DOMPurify 消毒、`nosniff` 標頭、Cookie `HttpOnly` + `SameSite=Lax`。
- 未做：CSRF token、忘記密碼 / Email 驗證、登入失敗次數限制。
- 刪除筆記時不會一併刪除它用到的圖片（刪除帳號時才會清空）；手寫編輯會存成新圖片，舊圖片也會保留。
- 手寫內容存成 PNG（白色紙張背景），再次編輯時舊筆畫已合併成底圖，橡皮擦擦的是像素而不是整條筆畫。
- 手機無法用剪貼簿貼上圖片或拖放，請改用 🖼 圖片按鈕；資料夾拖放搬移只支援滑鼠，觸控裝置請用「移動到…」。
- 還原備份是「新增」筆記與資料夾，重複還原會產生重複筆記，同名資料夾自動加上「(2)」。
- 資料夾展開 / 收合狀態存在各裝置的瀏覽器中，不會跨裝置同步。

## 下一步（Roadmap）

- [ ] 標籤、釘選筆記、資料夾自訂排序與顏色
- [ ] 全文搜尋結果標示關鍵字
- [ ] 筆記版本紀錄與還原
- [ ] 分享唯讀連結
- [ ] 程式碼區塊語法高亮、數學公式（KaTeX）
- [ ] 清理未被引用的圖片
- [ ] 整頁手寫筆記（向量筆跡，可無限延伸的畫布）
- [ ] PWA：加入主畫面後可離線使用
- [ ] CSRF 防護、正式部署設定（gunicorn / waitress）
