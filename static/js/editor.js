/* Markdown 筆記本 — 編輯頁前端邏輯 */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = {
    app: $("#app"),
    tree: $("#note-tree"),
    location: $("#note-location"),
    search: $("#search"),
    emptyState: $("#empty-state"),
    editor: $("#editor"),
    title: $("#title"),
    content: $("#content"),
    preview: $("#preview"),
    panes: $("#panes"),
    status: $("#save-status"),
    toast: $("#toast"),
  };

  const SAVE_DELAY = 800;
  const VIEW_MODES = ["edit", "split", "preview"];

  const state = {
    folders: [],                  // [{id, name, parent_id}]
    notes: [],                    // 側欄清單 [{id, folder_id, title, updated_at}]（搜尋時只有符合的）
    currentId: null,
    currentFolderId: null,        // 目前筆記所在資料夾，null＝根目錄
    dirty: false,                 // 有尚未送出的修改
    saveTimer: null,
    saving: Promise.resolve(),    // 儲存請求依序串接，避免舊內容覆蓋新內容
  };

  // ---------- 小工具 ----------

  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* 無痕模式等情況忽略 */ } },
  };

  async function api(path, options = {}) {
    const opts = { ...options };
    if (opts.json !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(opts.json);
      delete opts.json;
    }
    const res = await fetch(path, opts);
    if (res.status === 401) {
      location.href = "/login";
      throw new Error("登入已逾時，請重新登入");
    }
    if (!res.ok) {
      let message = `操作失敗（${res.status}）`;
      try { message = (await res.json()).error || message; } catch { /* 非 JSON 回應 */ }
      throw new Error(message);
    }
    return res.status === 204 ? null : res.json();
  }

  let toastTimer;
  function toast(message, type = "info") {
    el.toast.textContent = message;
    el.toast.className = `toast ${type}`;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3000);
  }

  function formatTime(stamp) {
    // stamp 格式：YYYY-MM-DD HH:MM:SS（伺服器本地時間）
    const [date, time = ""] = stamp.split(" ");
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return date === today ? `今天 ${time.slice(0, 5)}` : date.replaceAll("-", "/");
  }

  function setStatus(kind) {
    const text = { dirty: "尚未儲存…", saving: "儲存中…", saved: "已儲存 ✓", error: "⚠ 儲存失敗" };
    el.status.textContent = text[kind] || "";
    el.status.classList.toggle("error", kind === "error");
  }

  // ---------- 側欄：資料夾樹（畫面在 tree.js） ----------

  const tree = NoteTree.create(el.tree, {
    openNote: (id) => (id === state.currentId ? closeDrawer() : openNote(id)),
    createNote: (folderId) => createNote(folderId),
    saveFolderName,
    folderAction: (action, folder) => {
      if (action === "move") moveFolder(folder);
      else if (action === "import") importIntoFolder(folder);
      else if (action === "delete") deleteFolder(folder);
    },
    moveItem,
    formatTime,
  });

  async function loadList() {
    const q = el.search.value.trim();
    const [folders, notes] = await Promise.all([
      api("/api/folders"),
      api(`/api/notes${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    ]);
    state.folders = folders;
    state.notes = notes;
    renderList();
  }

  function renderList() {
    tree.render({
      folders: state.folders,
      notes: state.notes,
      currentId: state.currentId,
      query: el.search.value.trim(),
    });
    renderLocation();
  }

  function upsertListItem(note) {
    const summary = { id: note.id, folder_id: note.folder_id, title: note.title, updated_at: note.updated_at };
    state.notes = [summary, ...state.notes.filter((n) => n.id !== note.id)];
    renderList();
  }

  /** 資料夾路徑名稱，例如 ["微積分", "期中考"]。 */
  function folderPath(folderId) {
    const byId = new Map(state.folders.map((f) => [f.id, f]));
    const names = [];
    const seen = new Set();
    for (let id = folderId; id != null && byId.has(id) && !seen.has(id); id = byId.get(id).parent_id) {
      seen.add(id);
      names.unshift(byId.get(id).name);
    }
    return names;
  }

  function folderLabel(folderId) {
    return folderId == null ? "根目錄" : folderPath(folderId).join(" › ");
  }

  /** 資料夾本身與所有子孫資料夾的 id。 */
  function descendantIds(folderId) {
    const ids = [folderId];
    for (let i = 0; i < ids.length; i++) {
      for (const f of state.folders) if (f.parent_id === ids[i]) ids.push(f.id);
    }
    return ids;
  }

  /** 編輯區標題上方的位置（麵包屑），點了可以搬到其他資料夾。 */
  function renderLocation() {
    if (state.currentId == null) return;
    el.location.textContent = state.currentFolderId == null
      ? "📂 根目錄"
      : `📁 ${folderPath(state.currentFolderId).join(" › ")}`;
  }

  // ---------- 資料夾操作 ----------

  async function saveFolderName({ mode, folderId, parentId, name }) {
    try {
      if (mode === "create") {
        const folder = await api("/api/folders", { method: "POST", json: { name, parent_id: parentId } });
        tree.expand(folder.id);   // 新資料夾預設展開
        toast(`已建立資料夾「${folder.name}」`);
      } else {
        await api(`/api/folders/${folderId}`, { method: "PUT", json: { name } });
      }
      await loadList();
    } catch (err) {
      toast(err.message, "error");
      throw err;   // 讓樹上的輸入框保留，方便修改
    }
  }

  /** 搬移筆記或資料夾到 targetFolderId（null＝根目錄）。拖放與「移動到…」共用。 */
  async function moveItem(item, targetFolderId) {
    try {
      if (item.type === "note") {
        if (item.id === state.currentId && !(await flushSave())) return;
        const note = await api(`/api/notes/${item.id}`, { method: "PUT", json: { folder_id: targetFolderId } });
        if (note.id === state.currentId) state.currentFolderId = note.folder_id;
      } else {
        await api(`/api/folders/${item.id}`, { method: "PUT", json: { parent_id: targetFolderId } });
      }
      tree.expand(targetFolderId);
      await loadList();
      toast(`已移到「${folderLabel(targetFolderId)}」`);
    } catch (err) {
      toast(`移動失敗：${err.message}`, "error");
    }
  }

  async function moveCurrentNote() {
    if (state.currentId == null) return;
    const target = await pickFolder({
      title: `移動「${el.title.value.trim() || "未命名筆記"}」到…`,
      currentFolderId: state.currentFolderId,
    });
    if (target !== undefined) await moveItem({ type: "note", id: state.currentId }, target);
  }

  async function moveFolder(folder) {
    const target = await pickFolder({
      title: `移動資料夾「${folder.name}」到…`,
      currentFolderId: folder.parent_id,
      disabledIds: new Set(descendantIds(folder.id)),   // 不能搬進自己或子資料夾
    });
    if (target !== undefined) await moveItem({ type: "folder", id: folder.id }, target);
  }

  /**
   * 開啟對話框並等待使用者選擇；setup(finish, signal) 負責綁定按鈕。
   * 直接在按鈕事件中 resolve，不依賴 close 事件（分頁在背景時瀏覽器可能不觸發）。
   * 按 Esc 或其他方式關閉時回傳 undefined。
   */
  function openDialog(dialog, setup) {
    return new Promise((resolve) => {
      const listeners = new AbortController();
      const finish = (value) => {
        listeners.abort();
        if (dialog.open) dialog.close();
        resolve(value);
      };
      dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        finish(undefined);
      }, { signal: listeners.signal });
      dialog.addEventListener("close", () => finish(undefined), { signal: listeners.signal });
      setup(finish, listeners.signal);
      dialog.showModal();
    });
  }

  /**
   * 選擇目標資料夾的對話框。回傳資料夾 id、null（根目錄），取消則回傳 undefined。
   * 點一下就選定，手機上也好操作。
   */
  function pickFolder({ title, currentFolderId, disabledIds = new Set() }) {
    const list = $("#move-list");
    $("#move-title").textContent = title;
    list.replaceChildren();

    const addOption = (folderId, label, depth, icon) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "picker-item";
      btn.style.setProperty("--depth", depth);
      const isCurrent = folderId === currentFolderId;
      btn.disabled = isCurrent || disabledIds.has(folderId);
      const name = document.createElement("span");
      name.className = "picker-name";
      name.textContent = `${icon} ${label}`;
      btn.append(name);
      if (isCurrent) {
        const hint = document.createElement("span");
        hint.className = "hint";
        hint.textContent = "目前位置";
        btn.append(hint);
      }
      btn.dataset.folderId = folderId ?? "";
      list.append(btn);
    };

    addOption(null, "根目錄", 0, "📂");
    const walk = (parentId, depth) => {
      state.folders
        .filter((f) => f.parent_id === parentId)
        .sort((a, b) => NoteTree.collator.compare(a.name, b.name))
        .forEach((f) => {
          addOption(f.id, f.name, depth, "📁");
          walk(f.id, depth + 1);
        });
    };
    walk(null, 1);

    return openDialog($("#move-dialog"), (finish, signal) => {
      list.addEventListener("click", (e) => {
        const btn = e.target.closest(".picker-item");
        if (btn && !btn.disabled) finish(btn.dataset.folderId === "" ? null : Number(btn.dataset.folderId));
      }, { signal });
      $("#move-cancel").addEventListener("click", () => finish(undefined), { signal });
    });
  }

  /** 刪除資料夾：有內容時讓使用者選「移到上一層」或「連同筆記刪除」。 */
  async function deleteFolder(folder) {
    const ids = new Set(descendantIds(folder.id));
    let allNotes;
    try {
      allNotes = await api("/api/notes");   // 搜尋中 state.notes 不完整，重新取得全部來計數
    } catch (err) {
      toast(err.message, "error");
      return;
    }
    const noteCount = allNotes.filter((n) => ids.has(n.folder_id)).length;
    const subfolderCount = ids.size - 1;

    let mode = "move";
    if (noteCount || subfolderCount) {
      const parts = [];
      if (noteCount) parts.push(`${noteCount} 篇筆記`);
      if (subfolderCount) parts.push(`${subfolderCount} 個子資料夾`);
      mode = await askDeleteFolder(`「${folder.name}」裡有 ${parts.join("、")}，要怎麼處理？`);
      if (!mode) return;
    } else if (!confirm(`確定要刪除空資料夾「${folder.name}」嗎？`)) {
      return;
    }

    const currentInside = state.currentId != null && ids.has(state.currentFolderId);
    if (currentInside && mode === "delete") {
      clearTimeout(state.saveTimer);   // 筆記要被刪掉了，不用再儲存
      state.dirty = false;
      await state.saving;
    }
    try {
      await api(`/api/folders/${folder.id}?notes=${mode}`, { method: "DELETE" });
    } catch (err) {
      toast(`刪除失敗：${err.message}`, "error");
      return;
    }
    if (currentInside && mode === "delete") {
      state.currentId = null;
      await loadList();
      if (state.notes.length) await openNote(state.notes[0].id);
      else showEmpty();
    } else {
      if (currentInside) {
        // 內容移到上一層後，目前筆記所在位置可能改變
        const note = await api(`/api/notes/${state.currentId}`).catch(() => null);
        if (note) state.currentFolderId = note.folder_id;
      }
      await loadList();
    }
    toast(mode === "delete" ? `已刪除資料夾與 ${noteCount} 篇筆記` : "已刪除資料夾，內容已移到上一層");
  }

  /** 回傳 "move"、"delete"，取消為 null。 */
  async function askDeleteFolder(message) {
    const dialog = $("#delete-folder-dialog");
    $("#delete-folder-text").textContent = message;
    const choice = await openDialog(dialog, (finish, signal) => {
      dialog.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-choice]");
        if (btn) finish(btn.dataset.choice);
      }, { signal });
    });
    return choice || null;
  }

  $("#btn-new-folder").addEventListener("click", () => tree.startCreateFolder(null));
  $("#btn-move-note").addEventListener("click", moveCurrentNote);
  el.location.addEventListener("click", moveCurrentNote);

  // ---------- 開啟 / 新增 / 刪除 ----------

  async function openNote(id) {
    if (!(await flushSave())) return;
    let note;
    try {
      note = await api(`/api/notes/${id}`);
    } catch (err) {
      toast(err.message, "error");
      return;
    }
    state.currentId = note.id;
    state.currentFolderId = note.folder_id;
    state.dirty = false;
    tree.expand(note.folder_id);   // 展開筆記所在的資料夾
    el.title.value = note.title;
    el.content.value = note.content;
    el.editor.hidden = false;
    el.emptyState.hidden = true;
    setStatus("");
    renderPreview();
    renderList();
    storage.set("lastNoteId", note.id);
    el.app.classList.remove("sidebar-open");
  }

  function showEmpty() {
    state.currentId = null;
    el.editor.hidden = true;
    el.emptyState.hidden = false;
    renderList();
  }

  /** 新增筆記；folderId 為 null 時建在根目錄。 */
  async function createNote(folderId = null) {
    if (!(await flushSave())) return;
    try {
      const note = await api("/api/notes", { method: "POST", json: { folder_id: folderId } });
      el.search.value = "";
      tree.expand(folderId);
      await loadList();
      await openNote(note.id);
      el.title.focus();
      el.title.select();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function deleteNote() {
    const id = state.currentId;
    if (id == null) return;
    const title = el.title.value.trim() || "未命名筆記";
    if (!confirm(`確定要刪除「${title}」嗎？此動作無法復原。`)) return;
    const wasDirty = state.dirty;
    clearTimeout(state.saveTimer);
    state.dirty = false;
    try {
      await state.saving;
      await api(`/api/notes/${id}`, { method: "DELETE" });
    } catch (err) {
      toast(err.message, "error");
      if (wasDirty) scheduleSave();
      return;
    }
    state.notes = state.notes.filter((n) => n.id !== id);
    state.currentId = null;
    toast("已刪除筆記");
    if (state.notes.length) await openNote(state.notes[0].id);
    else showEmpty();
  }

  // ---------- 儲存 ----------

  function scheduleSave() {
    state.dirty = true;
    setStatus("dirty");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, SAVE_DELAY);
  }

  function save() {
    clearTimeout(state.saveTimer);
    if (!state.dirty || state.currentId == null) return state.saving;
    const id = state.currentId;
    const payload = { title: el.title.value, content: el.content.value };
    state.dirty = false;
    setStatus("saving");
    state.saving = state.saving
      .then(() => api(`/api/notes/${id}`, { method: "PUT", json: payload }))
      .then((note) => {
        upsertListItem(note);
        if (!state.dirty && id === state.currentId) setStatus("saved");
      })
      .catch((err) => {
        if (id === state.currentId) {
          state.dirty = true;
          setStatus("error");
        }
        toast(`儲存失敗：${err.message}`, "error");
      });
    return state.saving;
  }

  /** 送出尚未儲存的修改；失敗時詢問是否仍要離開。回傳 true 代表可以繼續。 */
  async function flushSave() {
    await save();
    return !state.dirty || confirm("目前的修改尚未儲存成功，確定要離開這篇筆記嗎？");
  }

  // ---------- Markdown 預覽 ----------

  const hasMarkdownLib = typeof window.marked !== "undefined" && typeof window.DOMPurify !== "undefined";
  if (hasMarkdownLib) {
    marked.setOptions({ gfm: true, breaks: true });
    // 外部連結一律開新分頁
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A" && /^https?:/i.test(node.getAttribute("href") || "")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  /** 替自己上傳的圖片加上「手寫編輯」按鈕（電腦 hover 時出現，觸控裝置常駐）。 */
  function addImageEditButtons() {
    el.preview.querySelectorAll('img[src^="/uploads/"]').forEach((img) => {
      const wrap = document.createElement("span");
      wrap.className = "img-edit-wrap";
      img.replaceWith(wrap);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "img-edit-btn";
      btn.textContent = "✏️ 手寫編輯";
      btn.dataset.src = img.getAttribute("src");
      wrap.append(img, btn);
    });
  }

  let previewTimer;
  function renderPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const md = el.content.value;
      if (hasMarkdownLib) {
        el.preview.innerHTML = DOMPurify.sanitize(marked.parse(md));
        addImageEditButtons();
        return;
      }
      const warning = document.createElement("p");
      warning.className = "preview-warning";
      warning.textContent = "無法載入 Markdown 函式庫（需要網路連線），暫時以純文字顯示。";
      const pre = document.createElement("pre");
      pre.textContent = md;
      el.preview.replaceChildren(warning, pre);
    }, 50);
  }

  // ---------- Markdown 工具列 ----------

  /** 取代 textarea 中的一段文字，並盡量保留 Ctrl+Z 復原紀錄。 */
  function replaceRange(start, end, text) {
    const ta = el.content;
    ta.focus();
    ta.setSelectionRange(start, end);
    // 編輯區被隱藏（例如手機的預覽模式）時無法取得焦點，execCommand 會插到別的地方，改用 setRangeText
    const focused = document.activeElement === ta;
    if (!focused || !document.execCommand("insertText", false, text)) {
      ta.setRangeText(text, start, end, "end");
      ta.dispatchEvent(new Event("input"));
    }
  }

  function lineStartOf(value, pos) {
    return pos === 0 ? 0 : value.lastIndexOf("\n", pos - 1) + 1;
  }

  function lineEndOf(value, pos) {
    const end = value.indexOf("\n", pos);
    return end === -1 ? value.length : end;
  }

  /**
   * 用標記包住選取文字（粗體、連結…）。
   * 沒有選取時插入提示文字並反白它，直接打字即可取代；
   * 有選取時游標移到結尾（或 caretFromEnd 指定的位置），可以直接繼續輸入。
   */
  function wrapSelection(before, after, placeholder, caretFromEnd = 0) {
    const ta = el.content;
    const { selectionStart: start, selectionEnd: end } = ta;
    const selected = ta.value.slice(start, end);
    const inner = selected || placeholder;
    const text = before + inner + after;
    replaceRange(start, end, text);
    if (selected) {
      const caret = start + text.length - caretFromEnd;
      ta.setSelectionRange(caret, caret);
    } else {
      ta.setSelectionRange(start + before.length, start + before.length + inner.length);
    }
  }

  // 行首格式：match 判斷該行是否已是這種格式（全部都是就取消），strip 是套用前要先移除的舊標記
  const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
  const LINE_FORMATS = {
    heading: { prefix: () => "## ", match: /^#{1,6}\s+/, strip: /^#{1,6}\s+/ },
    ul: { prefix: () => "- ", match: /^[-*+]\s+(?!\[[ xX]\])/, strip: LIST_MARKER },
    ol: { prefix: (i) => `${i + 1}. `, match: /^\d+[.)]\s+/, strip: LIST_MARKER },
    task: { prefix: () => "- [ ] ", match: /^[-*+]\s+\[[ xX]\]\s+/, strip: LIST_MARKER },
    quote: { prefix: () => "> ", match: /^>\s?/, strip: null },
  };

  /**
   * 對游標所在行（或選取的多行）套用／取消行首格式，例如清單、引言、標題。
   * 例如「- 項目」按「1. 清單」會直接換成「1. 項目」。
   * 完成後不留反白：單一游標維持在原本文字中的位置，多行選取則把游標放在最後。
   */
  function formatLines(format) {
    const ta = el.content;
    const value = ta.value;
    const { selectionStart, selectionEnd } = ta;
    const start = lineStartOf(value, selectionStart);
    const end = lineEndOf(value, selectionEnd);
    const lines = value.slice(start, end).split("\n").map((line) => {
      const [, indent, rest] = /^(\s*)(.*)$/.exec(line);
      return { indent, rest, body: rest };
    });
    // 選取多行時略過空白行，避免產生空的清單項目
    const targets = lines.length > 1 ? lines.filter((l) => l.rest.trim() !== "") : lines;
    const removing = targets.length > 0 && targets.every((l) => format.match.test(l.rest));
    targets.forEach((l, i) => {
      if (removing) {
        l.body = l.rest.replace(format.match, "");
        l.rest = l.body;
      } else {
        l.body = format.strip ? l.rest.replace(format.strip, "") : l.rest;
        l.rest = format.prefix(i) + l.body;
      }
    });
    const result = lines.map((l) => l.indent + l.rest).join("\n");
    replaceRange(start, end, result);

    let caret = start + result.length;
    if (selectionStart === selectionEnd) {
      // 保持游標與行尾的距離不變，但不落在標記中間
      const fromLineEnd = end - selectionStart;
      caret = Math.max(caret - fromLineEnd, caret - lines[0].body.length);
    }
    ta.setSelectionRange(caret, caret);
  }

  const actions = {
    bold: () => wrapSelection("**", "**", "粗體文字"),
    italic: () => wrapSelection("*", "*", "斜體文字"),
    heading: () => formatLines(LINE_FORMATS.heading),
    ul: () => formatLines(LINE_FORMATS.ul),
    ol: () => formatLines(LINE_FORMATS.ol),
    task: () => formatLines(LINE_FORMATS.task),
    quote: () => formatLines(LINE_FORMATS.quote),
    code: () => {
      const ta = el.content;
      const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (selected.includes("\n")) wrapSelection("```\n", "\n```", "");
      else wrapSelection("`", "`", "程式碼");
    },
    // 有選取文字時，游標停在網址的位置方便直接貼上
    link: () => wrapSelection("[", "](https://)", "連結文字", 1),
  };

  // ---------- 清單自動延續 ----------

  const LIST_ITEM_RE = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/;
  const QUOTE_RE = /^\s*>\s?/;

  /**
   * 在清單／引言行按 Enter：自動在下一行加上標記（數字清單會遞增：1. → 2. → 3.）。
   * 在空的項目上按 Enter 則結束清單。Shift+Enter 為一般換行。
   */
  function continueList(e) {
    // isComposing / 229：中文輸入法選字時的 Enter 不處理
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey
        || e.isComposing || e.keyCode === 229) return;
    const ta = el.content;
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return;
    const value = ta.value;
    const lineStart = lineStartOf(value, pos);
    const lineEnd = lineEndOf(value, pos);
    const beforeCaret = value.slice(lineStart, pos);
    const item = LIST_ITEM_RE.exec(beforeCaret);
    const quote = item ? null : QUOTE_RE.exec(beforeCaret);
    if (!item && !quote) return;

    e.preventDefault();
    const markerLength = (item || quote)[0].length;
    const isEmpty = beforeCaret.slice(markerLength).trim() === "" && value.slice(pos, lineEnd).trim() === "";
    if (isEmpty) {
      // 空項目 → 移除標記、結束清單。保留一個空行，否則下一行文字會被 Markdown 併入上一個項目
      replaceRange(lineStart, lineEnd, "\n");
      ta.setSelectionRange(lineStart + 1, lineStart + 1);
      return;
    }

    let nextMarker;
    if (item) {
      const [, indent, bullet, number, delimiter, space, checkbox] = item;
      nextMarker = indent + (number ? `${Number(number) + 1}${delimiter}` : bullet) + space;
      if (checkbox) nextMarker += "[ ] ";
    } else {
      nextMarker = quote[0];
    }
    const insert = "\n" + nextMarker;
    replaceRange(pos, pos, insert);
    ta.setSelectionRange(pos + insert.length, pos + insert.length);
    if (item && item[3]) renumberList(pos + 1, item[1], Number(item[3]) + 1);
  }

  /** 從新插入的編號項目之後，把同一層的數字清單重新編號（在中間插入項目時用）。 */
  function renumberList(newLineStart, indent, number) {
    const ta = el.content;
    const value = ta.value;
    const newLineEnd = value.indexOf("\n", newLineStart);
    if (newLineEnd === -1) return;
    const blockStart = newLineEnd + 1;
    const lines = value.slice(blockStart).split("\n");
    const renumbered = [];
    let expected = number + 1;
    let changed = false;
    for (const line of lines) {
      if (line.trim() === "") break;
      const m = /^(\s*)(\d+)([.)]\s.*)$/.exec(line);
      if (m && m[1] === indent) {
        if (Number(m[2]) !== expected) changed = true;
        renumbered.push(`${indent}${expected}${m[3]}`);
        expected += 1;
      } else if (/^\s*/.exec(line)[0].length > indent.length) {
        renumbered.push(line);  // 更深層的巢狀內容，保留原樣
      } else {
        break;
      }
    }
    if (!changed) return;
    const caret = ta.selectionStart;
    const blockEnd = blockStart + lines.slice(0, renumbered.length).join("\n").length;
    replaceRange(blockStart, blockEnd, renumbered.join("\n"));
    ta.setSelectionRange(caret, caret);
  }

  el.content.addEventListener("keydown", continueList);

  // ---------- 圖片 ----------

  /** 上傳圖片並在游標處插入 Markdown 圖片語法。 */
  async function uploadImageFile(file) {
    const form = new FormData();
    form.append("image", file);
    const { url } = await api("/api/images", { method: "POST", body: form });
    return url;
  }

  async function uploadImages(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith("image/"));
    if (!files.length || state.currentId == null) return;
    toast(`上傳 ${files.length} 張圖片中…`);
    for (const file of files) {
      try {
        const url = await uploadImageFile(file);
        const alt = file.name.replace(/\.[^.]+$/, "").replace(/[[\]]/g, "") || "image";
        const ta = el.content;
        replaceRange(ta.selectionStart, ta.selectionEnd, `![${alt}](${url})\n`);
      } catch (err) {
        toast(`「${file.name}」上傳失敗：${err.message}`, "error");
        return;
      }
    }
    toast("圖片已插入");
  }

  // ---------- 手寫（畫板在 sketch.js） ----------

  const sketchFile = (blob) => new File([blob], "handwriting.png", { type: "image/png" });

  /** 開啟畫板，完成後上傳並在游標處（獨立一行）插入手寫圖片。 */
  async function insertSketch() {
    if (state.currentId == null || !window.Sketch) return;
    const ta = el.content;
    const { selectionStart: start, selectionEnd: end } = ta;  // 畫板會搶走焦點，先記住游標
    const blob = await Sketch.open();
    if (!blob) return;
    try {
      const url = await uploadImageFile(sketchFile(blob));
      const atLineStart = start === 0 || ta.value[start - 1] === "\n";
      replaceRange(start, end, `${atLineStart ? "" : "\n"}![手寫](${url})\n`);
      toast("已插入手寫內容");
    } catch (err) {
      toast(`手寫上傳失敗：${err.message}`, "error");
    }
  }

  /** 在既有圖片上繼續手寫 / 標註，存成新圖後替換內容中的網址（Ctrl+Z 可復原）。 */
  async function editImage(src) {
    const blob = await Sketch.open({ imageUrl: src });
    if (!blob) return;
    try {
      const url = await uploadImageFile(sketchFile(blob));
      const ta = el.content;
      const index = ta.value.indexOf(src);
      if (index === -1) {
        replaceRange(ta.selectionStart, ta.selectionEnd, `![手寫](${url})\n`);
        toast("找不到原本的圖片，已插入在游標處");
        return;
      }
      replaceRange(index, index + src.length, url);
      toast("圖片已更新（Ctrl+Z 可復原）");
    } catch (err) {
      toast(`手寫上傳失敗：${err.message}`, "error");
    }
  }

  $("#btn-sketch").addEventListener("click", insertSketch);
  el.preview.addEventListener("click", (e) => {
    const btn = e.target.closest(".img-edit-btn");
    if (btn) editImage(btn.dataset.src);
  });

  const fileImage = $("#file-image");
  $("#btn-image").addEventListener("click", () => fileImage.click());
  fileImage.addEventListener("change", () => {
    uploadImages(fileImage.files);
    fileImage.value = "";
  });

  el.content.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      uploadImages(files);
    }
  });

  el.content.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    el.content.classList.add("dragging");
  });
  el.content.addEventListener("dragleave", () => el.content.classList.remove("dragging"));
  el.content.addEventListener("drop", (e) => {
    el.content.classList.remove("dragging");
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    uploadImages(e.dataTransfer.files);
  });

  // ---------- 上傳 / 下載 ----------

  function downloadFrom(url) {
    const a = document.createElement("a");
    a.href = url;
    a.download = "";  // 檔名由伺服器的 Content-Disposition 決定
    document.body.append(a);
    a.click();
    a.remove();
  }

  /** 開啟檔案選擇器，選完後把檔案交給 handler，並清空 input 以便重選同一個檔案。 */
  function bindFilePicker(buttonSel, inputSel, handler) {
    const input = $(inputSel);
    $(buttonSel).addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const files = [...input.files];
      input.value = "";
      if (files.length) await handler(files);
    });
  }

  $("#btn-export").addEventListener("click", async () => {
    await save();
    if (state.currentId != null) downloadFrom(`/api/notes/${state.currentId}/export`);
  });

  $("#btn-backup").addEventListener("click", async () => {
    await save();
    downloadFrom("/api/backup");
  });

  // 匯入的目標資料夾：側欄的匯入按鈕是根目錄，資料夾選單的「匯入 .md 到這裡」會先設定它
  let importFolderId = null;
  $("#btn-import").addEventListener("click", () => { importFolderId = null; });  // 需在 bindFilePicker 之前註冊

  function importIntoFolder(folder) {
    importFolderId = folder.id;
    $("#file-import").click();
  }

  bindFilePicker("#btn-import", "#file-import", async (files) => {
    if (!(await flushSave())) return;
    const folderId = importFolderId;
    let last = null;
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      if (folderId != null) form.append("folder_id", folderId);
      try {
        last = await api("/api/notes/import", { method: "POST", body: form });
      } catch (err) {
        toast(`「${file.name}」匯入失敗：${err.message}`, "error");
      }
    }
    if (!last) return;
    el.search.value = "";
    tree.expand(folderId);
    await loadList();
    await openNote(last.id);
    const where = `到「${folderLabel(folderId)}」`;
    toast(files.length > 1 ? `已匯入 ${files.length} 個檔案${where}` : `已匯入「${last.title}」${where}`);
  });

  bindFilePicker("#btn-restore", "#file-restore", async ([file]) => {
    if (!confirm(`要從「${file.name}」還原嗎？\n備份中的筆記會「新增」到目前帳號，不會覆蓋現有筆記。`)) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const { imported } = await api("/api/restore", { method: "POST", body: form });
      el.search.value = "";
      await loadList();
      if (state.currentId == null && state.notes.length) await openNote(state.notes[0].id);
      toast(`已還原 ${imported} 篇筆記`);
    } catch (err) {
      toast(`還原失敗：${err.message}`, "error");
    }
  });

  // ---------- 檢視模式與螢幕尺寸 ----------

  // 與 style.css 的斷點一致：≥1024 電腦、<768 手機
  const desktopQuery = window.matchMedia("(min-width: 1024px)");
  const phoneQuery = window.matchMedia("(max-width: 767px)");
  let preferredView = "split";

  /** 手機太窄不提供分割，偏好是分割時改用編輯；轉回寬螢幕會恢復分割。 */
  function applyView() {
    const mode = phoneQuery.matches && preferredView === "split" ? "edit" : preferredView;
    el.panes.className = `panes view-${mode}`;
    document.querySelectorAll("#view-mode button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === mode);
    });
  }

  function setView(mode) {
    preferredView = VIEW_MODES.includes(mode) ? mode : "split";
    storage.set("viewMode", preferredView);
    applyView();
  }

  phoneQuery.addEventListener("change", applyView);

  // ---------- 側欄：電腦上收合，平板 / 手機上是抽屜 ----------

  function closeDrawer() {
    el.app.classList.remove("sidebar-open");
  }

  $("#btn-sidebar")?.addEventListener("click", () => {
    if (desktopQuery.matches) {
      const collapsed = el.app.classList.toggle("sidebar-collapsed");
      storage.set("sidebarCollapsed", collapsed ? "1" : "");
    } else {
      el.app.classList.toggle("sidebar-open");
    }
  });
  $("#backdrop").addEventListener("click", closeDrawer);
  desktopQuery.addEventListener("change", closeDrawer);

  // ---------- ⋯ 更多動作選單 ----------

  const menuButton = $("#btn-menu");
  const menuList = $("#note-menu .menu-list");

  function closeMenu() {
    menuList.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  }

  menuButton.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = menuList.hidden;
    menuList.hidden = !opening;
    menuButton.setAttribute("aria-expanded", String(opening));
  });
  menuList.addEventListener("click", closeMenu);  // 點了選項就收起
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#note-menu")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      closeDrawer();
    }
  });

  // 分割模式下，預覽跟著編輯區等比例捲動
  el.content.addEventListener("scroll", () => {
    if (!el.panes.classList.contains("view-split")) return;
    const ta = el.content;
    const ratio = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight);
    el.preview.scrollTop = ratio * (el.preview.scrollHeight - el.preview.clientHeight);
  });

  // ---------- 事件 ----------

  $("#btn-new").addEventListener("click", () => createNote(null));
  $("#btn-new-empty").addEventListener("click", () => createNote(null));
  $("#btn-delete").addEventListener("click", deleteNote);

  el.title.addEventListener("input", () => {
    const item = el.tree.querySelector(`.note-row[data-note-id="${state.currentId}"] .tree-name`);
    if (item) item.textContent = el.title.value.trim() || "未命名筆記";
    scheduleSave();
  });
  el.title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.content.focus();
    }
  });

  el.content.addEventListener("input", () => {
    renderPreview();
    scheduleSave();
  });

  $(".toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-md]");
    if (btn) actions[btn.dataset.md]();
  });

  $("#view-mode").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) setView(btn.dataset.view);
  });

  let searchTimer;
  el.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadList().catch((err) => toast(err.message, "error")), 250);
  });

  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      save();
    } else if (document.activeElement === el.content && (key === "b" || key === "i")) {
      e.preventDefault();
      actions[key === "b" ? "bold" : "italic"]();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) {
      save();
      e.preventDefault();
      e.returnValue = "";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) save();
  });

  // 伺服器 flash 訊息（例如「註冊成功」）3 秒後淡出
  document.querySelectorAll(".flashes").forEach((box) => {
    setTimeout(() => {
      box.style.opacity = "0";
      setTimeout(() => box.remove(), 300);
    }, 3000);
  });

  // ---------- 啟動 ----------

  (async function init() {
    setView(storage.get("viewMode"));
    if (storage.get("sidebarCollapsed")) el.app.classList.add("sidebar-collapsed");
    try {
      await loadList();
    } catch (err) {
      toast(err.message, "error");
      return;
    }
    const lastId = Number(storage.get("lastNoteId"));
    const target = state.notes.find((n) => n.id === lastId) || state.notes[0];
    if (target) await openNote(target.id);
    else showEmpty();
  })();
})();
