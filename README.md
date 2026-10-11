# 📒 Markdown 筆記本（MVP）

Vibe Coding 第一個實作：在瀏覽器使用的 Markdown 筆記本系統，**電腦、平板、手機**都能用同樣的功能。
後端使用 **Python Flask + SQLite**，前端使用原生 HTML / CSS / JavaScript。

## 功能

| 類別 | 功能 |
| --- | --- |
| 登入頁 | 註冊、登入、登出（密碼以 werkzeug 雜湊儲存） |
| 帳號管理 | 查看帳號資訊與用量、外觀設定、變更密碼、下載備份、刪除帳號（含所有筆記與圖片） |
| 資料夾 | 像檔案總管一樣用資料夾分類（例如依科目），可多層子資料夾；資料夾旁「＋」直接在裡面新增筆記；展開 / 收合；拖放或「移動到…」搬移筆記與資料夾；刪除時可選擇保留內容或一起刪除 |
| 編輯頁 | 新增 / 刪除筆記、搜尋標題與內容（顯示所在資料夾）、Markdown 編輯 + 即時預覽、自動儲存（Ctrl+S 立即儲存） |
| Markdown 工具列 | 粗體、斜體、標題、清單、待辦、引言、程式碼、連結；編輯 / 分割 / 預覽三種檢視 |
| 清單輸入 | 清單 / 待辦 / 引言行按 Enter 自動延續（數字清單自動遞增並重新編號），空項目按 Enter 結束清單，Shift+Enter 一般換行 |
| 導入圖片 | 工具列按鈕選檔（手機可選相簿或拍照）、**直接貼上**截圖、**拖放**圖片到編輯區（PNG / JPG / GIF / WebP，單張 5MB） |
| 手寫 | 工具列「✍ 手寫」開啟畫板：觸控筆壓力感應、四色筆、螢光筆、橡皮擦、粗細、復原 / 重做、空白 / 橫線 / 方格紙；寫完以圖片插入。預覽中的圖片按「✏️ 手寫編輯」可繼續寫或在照片上標註 |
| 深色 / 淺色背景 | 頂列 ☀/🌙 一鍵切換，或在帳號管理選「淺色 / 深色 / 跟隨系統」；配色參考 VS Code，設定存在帳號裡，所有裝置同步 |
| 自適應版面 | 電腦：側欄常駐（☰ 可收合）、分割檢視；平板：側欄改為抽屜；手機：編輯 / 預覽切換、按鈕放大好點選 |
| 上傳下載 | 匯入 `.md` 檔成為新筆記（可匯入到指定資料夾）、下載單篇 `.md`（圖片以 base64 內嵌，可離線開啟）、全部筆記 JSON 備份與還原（含資料夾結構） |

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

### 在手機 / 平板上使用

手機、平板與電腦連到**同一個 Wi-Fi**，用區網模式啟動：

```bash
python main.py --lan
```

終端機會印出類似 `http://192.168.x.x:5000` 的網址，在手機 / 平板的瀏覽器開啟即可（建議加入主畫面書籤）。

- Windows 第一次執行時會跳出防火牆詢問，請允許 Python 在「私人網路」通訊。
- 區網模式會關閉 debug，同一個網路的人都連得到，**請只在家裡等信任的 Wi-Fi 使用**。
- 要換連接埠可加 `--port 8000`。

### 資料夾小技巧

- 「📁 新增資料夾」與「＋ 新增筆記」建立在最上層；要放進某個資料夾，請按該資料夾旁的「＋」。
- 資料夾的「⋯」選單可以新增子資料夾、重新命名（電腦也可選取後按 F2）、移動、匯入 .md、刪除。
- 電腦上可以直接拖放筆記或資料夾；拖到清單空白處＝移到最上層。手機 / 平板請用「⋯ → 移動到…」，或點編輯區上方的資料夾路徑。
- 資料夾依名稱排序，數字會照大小排（「第2章」在「第10章」前面）；資料夾內的筆記依最後修改時間排序。

### 手寫小技巧

- 平板用觸控筆書寫時，線條粗細會跟著筆壓變化。
- 用過觸控筆之後，畫板會忽略手指 / 手掌的觸控，避免手掌誤觸畫出線條（重新整理頁面後重置）。
- 在電腦上可以用滑鼠畫；Ctrl+Z / Ctrl+Y 復原與重做，Esc 取消。

> Markdown 預覽使用 [marked](https://marked.js.org/) 與 [DOMPurify](https://github.com/cure53/DOMPurify)，由 cdnjs 載入，需要網路連線；離線時預覽會改以純文字顯示，編輯與儲存不受影響。

## 專案結構

```
hw1/
├─ main.py              # Flask app：驗證、頁面、筆記 / 圖片 / 匯入匯出 API
├─ db.py                # SQLite 連線與資料表結構
├─ requirements.txt     # pip 套件
├─ environment.yml      # conda 環境（vibe-coding）
├─ templates/           # Jinja2 頁面：login、notes、account 與共用片段
├─ static/css/style.css # 樣式（深色 / 淺色主題、電腦 / 平板 / 手機版面）
├─ static/js/editor.js  # 編輯頁前端邏輯（筆記、資料夾操作、對話框）
├─ static/js/tree.js    # 側欄資料夾樹（展開收合、行內命名、拖放）
├─ static/js/sketch.js  # 手寫畫板（Pointer Events、觸控筆壓力、復原 / 重做）
├─ static/js/theme.js   # 深色 / 淺色主題切換與儲存
├─ instance/            # 執行時自動建立：notebook.db、secret_key（不進 git）
└─ uploads/<user_id>/   # 使用者上傳的圖片（不進 git）
```

### API 一覽

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
| POST | `/api/restore` | 上傳備份 JSON，新增到目前帳號 |
| PUT | `/api/settings` | 儲存帳號偏好，目前為 `{"theme": "light" \| "dark" \| "system"}` |

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

- 預設只監聽 `127.0.0.1`；`--lan` 會開放給同一個區網並關閉 debug。兩者都是 Flask 開發伺服器，**不適合直接部署到公開網路**。
- 已做：密碼雜湊、每個查詢都檢查筆記 / 圖片擁有者、圖片以檔頭判斷格式並改用隨機檔名、預覽經 DOMPurify 消毒、`nosniff` 標頭、Cookie `HttpOnly` + `SameSite=Lax`。
- 未做：CSRF token、忘記密碼 / Email 驗證、登入失敗次數限制。
- 刪除筆記時不會一併刪除它用到的圖片（刪除帳號時才會清空）；手寫編輯會存成新圖片，舊圖片也會留著。
- 手寫內容存成 PNG 圖片（白色紙張背景），再次編輯時舊筆畫已合併成底圖，橡皮擦會擦到像素而不是整條筆畫。
- 手機上無法用剪貼簿貼上圖片或拖放，請改用 🖼 圖片按鈕。
- 還原備份是「新增」筆記與資料夾，重複還原會產生重複筆記，同名資料夾自動加上「(2)」。舊版（v1）備份仍可還原，筆記會放在最上層。
- 資料夾展開 / 收合狀態存在各裝置的瀏覽器裡，不會跨裝置同步。
- 拖放搬移只支援滑鼠；觸控裝置請用「移動到…」。

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
