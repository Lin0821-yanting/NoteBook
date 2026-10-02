/* Markdown 筆記本 — 編輯頁前端邏輯 */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = {
    app: $("#app"),
    list: $("#note-list"),
    listEmpty: $("#list-empty"),
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
    notes: [],                    // 側欄清單 [{id, title, updated_at}]
    currentId: null,
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

  // ---------- 側欄清單 ----------

  async function loadList() {
    const q = el.search.value.trim();
    state.notes = await api(`/api/notes${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    renderList();
  }

  function renderList() {
    el.list.replaceChildren(...state.notes.map((note) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "note-item" + (note.id === state.currentId ? " active" : "");
      btn.dataset.id = note.id;
      const title = document.createElement("span");
      title.className = "note-title";
      title.textContent = note.title;
      const meta = document.createElement("span");
      meta.className = "note-meta";
      meta.textContent = formatTime(note.updated_at);
      btn.append(title, meta);
      const li = document.createElement("li");
      li.append(btn);
      return li;
    }));
    el.listEmpty.hidden = state.notes.length > 0;
    el.listEmpty.textContent = el.search.value.trim() ? "找不到符合的筆記" : "還沒有筆記";
  }

  function upsertListItem(note) {
    const summary = { id: note.id, title: note.title, updated_at: note.updated_at };
    state.notes = [summary, ...state.notes.filter((n) => n.id !== note.id)];
    renderList();
  }

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
    state.dirty = false;
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

  async function createNote() {
    if (!(await flushSave())) return;
    try {
      const note = await api("/api/notes", { method: "POST", json: {} });
      el.search.value = "";
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

  let previewTimer;
  function renderPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const md = el.content.value;
      if (hasMarkdownLib) {
        el.preview.innerHTML = DOMPurify.sanitize(marked.parse(md));
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
    if (!document.execCommand("insertText", false, text)) {
      ta.setRangeText(text, start, end, "end");
      ta.dispatchEvent(new Event("input"));
    }
  }

  function wrapSelection(before, after, placeholder) {
    const ta = el.content;
    const { selectionStart: start, selectionEnd: end } = ta;
    const selected = ta.value.slice(start, end) || placeholder;
    replaceRange(start, end, before + selected + after);
    ta.setSelectionRange(start + before.length, start + before.length + selected.length);
  }

  /** 對選取範圍的每一行加上（或移除）前綴，例如清單、引言、標題。 */
  function prefixLines(makePrefix) {
    const ta = el.content;
    const value = ta.value;
    const start = ta.selectionStart === 0 ? 0 : value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    let end = value.indexOf("\n", ta.selectionEnd);
    if (end === -1) end = value.length;
    const lines = value.slice(start, end).split("\n");
    const prefixes = lines.map((_, i) => makePrefix(i));
    const allPrefixed = lines.every((line, i) => line.startsWith(prefixes[i]));
    const result = lines
      .map((line, i) => (allPrefixed ? line.slice(prefixes[i].length) : prefixes[i] + line))
      .join("\n");
    replaceRange(start, end, result);
    ta.setSelectionRange(start, start + result.length);
  }

  const actions = {
    bold: () => wrapSelection("**", "**", "粗體文字"),
    italic: () => wrapSelection("*", "*", "斜體文字"),
    heading: () => prefixLines(() => "## "),
    ul: () => prefixLines(() => "- "),
    ol: () => prefixLines((i) => `${i + 1}. `),
    task: () => prefixLines(() => "- [ ] "),
    quote: () => prefixLines(() => "> "),
    code: () => {
      const ta = el.content;
      const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (selected.includes("\n")) wrapSelection("```\n", "\n```", "");
      else wrapSelection("`", "`", "程式碼");
    },
    link: () => wrapSelection("[", "](https://)", "連結文字"),
  };

  // ---------- 檢視模式 ----------

  function setView(mode) {
    if (!VIEW_MODES.includes(mode)) mode = "split";
    el.panes.className = `panes view-${mode}`;
    document.querySelectorAll("#view-mode button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === mode);
    });
    storage.set("viewMode", mode);
  }

  // 分割模式下，預覽跟著編輯區等比例捲動
  el.content.addEventListener("scroll", () => {
    if (!el.panes.classList.contains("view-split")) return;
    const ta = el.content;
    const ratio = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight);
    el.preview.scrollTop = ratio * (el.preview.scrollHeight - el.preview.clientHeight);
  });

  // ---------- 事件 ----------

  el.list.addEventListener("click", (e) => {
    const item = e.target.closest(".note-item");
    if (item && Number(item.dataset.id) !== state.currentId) openNote(Number(item.dataset.id));
  });

  $("#btn-new").addEventListener("click", createNote);
  $("#btn-delete").addEventListener("click", deleteNote);

  el.title.addEventListener("input", () => {
    const item = el.list.querySelector(`.note-item[data-id="${state.currentId}"] .note-title`);
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

  $("#btn-sidebar")?.addEventListener("click", () => el.app.classList.toggle("sidebar-open"));
  $(".editor-area").addEventListener("click", () => el.app.classList.remove("sidebar-open"));

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
