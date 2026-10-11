/* 側欄資料夾樹（像檔案總管）。只負責畫面與互動，資料與 API 由 editor.js 透過 callbacks 處理。
 *
 *   const tree = NoteTree.create(container, {
 *     openNote(id),
 *     createNote(folderId),
 *     saveFolderName({ mode: "create" | "rename", folderId, parentId, name }),  // 失敗時 throw
 *     folderAction(action, folder),        // "move" | "import" | "delete"
 *     moveItem({ type: "note" | "folder", id }, targetFolderId),   // 拖放，null＝根目錄
 *     formatTime(stamp),
 *   });
 *   tree.render({ folders, notes, currentId, query });
 *   tree.expand(folderId);              // 展開資料夾與它的所有上層
 *   tree.startCreateFolder(parentId);   // 在樹上出現輸入框建立資料夾
 */
(() => {
  "use strict";

  const STORAGE_KEY = "expandedFolders";
  // 自訂拖放類型：不用 text/plain，避免拖到編輯區時被當成文字貼上
  const DRAG_TYPE = "application/x-notebook-item";
  // 中文依筆畫 / 注音排序，數字依大小（第2章排在第10章前面）
  const collator = new Intl.Collator("zh-Hant", { numeric: true, sensitivity: "base" });

  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* 忽略 */ } },
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function create(container, callbacks) {
    const menu = document.getElementById("folder-menu");
    let data = { folders: [], notes: [], currentId: null, query: "" };
    let byId = new Map();
    let expanded = new Set(loadExpanded());
    let editing = null;        // 行內輸入框進行中時暫停重畫，避免輸入框消失
    let dragging = null;       // { type, id }
    let hoverTimer = null;
    let menuFolder = null;

    function loadExpanded() {
      try {
        const ids = JSON.parse(storage.get(STORAGE_KEY));
        return Array.isArray(ids) ? ids : [];
      } catch {
        return [];
      }
    }

    function saveExpanded() {
      storage.set(STORAGE_KEY, JSON.stringify([...expanded]));
    }

    // ---------- 資料整理 ----------

    function indexFolders() {
      byId = new Map(data.folders.map((f) => [f.id, f]));
    }

    function parentOf(folder) {
      return byId.has(folder.parent_id) ? folder.parent_id : null;
    }

    /** folderId 本身與它所有上層資料夾的 id（由下往上）。 */
    function ancestors(folderId) {
      const ids = [];
      const seen = new Set();
      let id = folderId;
      while (id != null && byId.has(id) && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
        id = parentOf(byId.get(id));
      }
      return ids;
    }

    function buildModel() {
      indexFolders();
      const childFolders = new Map();
      const childNotes = new Map();
      const push = (map, key, value) => {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(value);
      };
      for (const folder of data.folders) push(childFolders, parentOf(folder), folder);
      for (const list of childFolders.values()) list.sort((a, b) => collator.compare(a.name, b.name));
      for (const note of data.notes) {
        push(childNotes, byId.has(note.folder_id) ? note.folder_id : null, note);  // 筆記維持更新時間排序
      }

      // 資料夾內（含子資料夾）的筆記數
      const counts = new Map();
      const countOf = (folderId) => {
        if (counts.has(folderId)) return counts.get(folderId);
        let total = (childNotes.get(folderId) || []).length;
        for (const child of childFolders.get(folderId) || []) total += countOf(child.id);
        counts.set(folderId, total);
        return total;
      };

      // 搜尋時只顯示符合的筆記、名稱符合的資料夾，以及它們的上層資料夾
      let visible = null;
      const query = data.query.toLowerCase();
      if (query) {
        visible = new Set();
        for (const note of data.notes) ancestors(note.folder_id).forEach((id) => visible.add(id));
        for (const folder of data.folders) {
          if (folder.name.toLowerCase().includes(query)) ancestors(folder.id).forEach((id) => visible.add(id));
        }
      }
      return { childFolders, childNotes, countOf, visible };
    }

    // ---------- 畫面 ----------

    function render(next) {
      if (next) data = { ...data, ...next };
      if (editing) return;   // 輸入完成後會再重畫一次
      const model = buildModel();

      // 清掉已不存在的資料夾展開紀錄
      const before = expanded.size;
      expanded = new Set([...expanded].filter((id) => byId.has(id)));
      if (expanded.size !== before) saveExpanded();

      const frag = document.createDocumentFragment();
      appendLevel(frag, model, null, 0);
      if (!frag.childNodes.length) {
        frag.append(el("p", "tree-empty",
          data.query ? "找不到符合的筆記" : "還沒有筆記。可以先建立科目資料夾，再在資料夾旁按「＋」新增筆記"));
      }
      container.replaceChildren(frag);
    }

    function appendLevel(parent, model, folderId, depth) {
      for (const folder of model.childFolders.get(folderId) || []) {
        if (model.visible && !model.visible.has(folder.id)) continue;
        parent.append(folderNode(folder, model, depth));
      }
      for (const note of model.childNotes.get(folderId) || []) parent.append(noteRow(note, depth));
    }

    function folderNode(folder, model, depth) {
      const open = Boolean(model.visible) || expanded.has(folder.id);   // 搜尋時全部展開
      const item = el("div", "tree-item");
      item.setAttribute("role", "treeitem");
      item.setAttribute("aria-expanded", String(open));
      item.dataset.folderId = folder.id;

      const row = el("div", "tree-row folder-row");
      row.tabIndex = 0;
      row.draggable = true;
      row.title = folder.name;
      row.dataset.folderId = folder.id;
      row.style.setProperty("--depth", depth);
      const count = model.countOf(folder.id);
      const add = el("button", "row-btn add", "＋");
      add.type = "button";
      add.title = `在「${folder.name}」新增筆記`;
      add.setAttribute("aria-label", add.title);
      const more = el("button", "row-btn more", "⋯");
      more.type = "button";
      more.title = "資料夾選項";
      more.setAttribute("aria-label", `「${folder.name}」的選項`);
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute("aria-expanded", "false");
      row.append(el("span", "twisty", "▸"), el("span", "tree-icon", open ? "📂" : "📁"),
        el("span", "tree-name", folder.name), el("span", "tree-count", count ? String(count) : ""), add, more);
      item.append(row);

      if (open) {
        const group = el("div", "tree-children");
        group.setAttribute("role", "group");
        group.style.setProperty("--depth", depth);
        appendLevel(group, model, folder.id, depth + 1);
        item.append(group);
      }
      return item;
    }

    function noteRow(note, depth) {
      const row = el("div", "tree-row note-row" + (note.id === data.currentId ? " active" : ""));
      row.setAttribute("role", "treeitem");
      row.tabIndex = 0;
      row.draggable = true;
      row.title = note.title;
      row.dataset.noteId = note.id;
      row.style.setProperty("--depth", depth);
      row.append(el("span", "twisty"), el("span", "tree-icon", "📝"), el("span", "tree-name", note.title),
        el("span", "tree-meta", callbacks.formatTime(note.updated_at)));
      return row;
    }

    // ---------- 展開 / 收合 ----------

    function toggle(folderId, open = !expanded.has(folderId)) {
      if (open) expanded.add(folderId);
      else expanded.delete(folderId);
      saveExpanded();
      render();
    }

    /** 展開資料夾與它的所有上層（例如開啟某篇筆記、在資料夾中新增東西時）。 */
    function expand(folderId) {
      if (folderId == null) return;
      indexFolders();
      expanded.add(folderId);
      ancestors(folderId).forEach((id) => expanded.add(id));
      saveExpanded();
    }

    // ---------- 行內輸入（新增 / 重新命名資料夾） ----------

    function makeInput(value, target) {
      const input = el("input", "tree-input");
      input.type = "text";
      input.value = value;
      input.maxLength = 50;
      input.setAttribute("aria-label", target.mode === "create" ? "新資料夾名稱" : "資料夾名稱");
      editing = target;
      let busy = false;
      let done = false;

      const finish = () => {
        done = true;
        editing = null;
        render();
      };

      const commit = async (fromBlur) => {
        if (busy || done) return;
        const name = input.value.trim();
        const unchanged = target.mode === "rename" && name === byId.get(target.folderId)?.name;
        if (!name || unchanged) {
          finish();
          return;
        }
        busy = true;
        try {
          await callbacks.saveFolderName({ ...target, name });
          finish();
        } catch {
          busy = false;
          if (fromBlur) finish();          // 點到別處就放棄
          else {
            input.focus();                 // 按 Enter 失敗（例如同名）就留著讓使用者修改
            input.select();
          }
        }
      };

      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {   // 中文輸入法選字的 Enter 不算
          e.preventDefault();
          commit(false);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish();
        }
      });
      input.addEventListener("blur", () => commit(true));
      input.addEventListener("click", (e) => e.stopPropagation());
      return input;
    }

    function startCreateFolder(parentId = null) {
      closeMenu();
      if (editing) return;
      if (parentId != null) expand(parentId);
      render();
      container.querySelector(".tree-empty")?.remove();
      const group = parentId == null ? container
        : container.querySelector(`.tree-item[data-folder-id="${parentId}"] > .tree-children`);
      if (!group) return;
      const row = el("div", "tree-row folder-row editing");
      row.style.setProperty("--depth", parentId == null ? 0 : ancestors(parentId).length);
      row.append(el("span", "twisty", "▸"), el("span", "tree-icon", "📁"),
        makeInput("", { mode: "create", parentId }));
      group.prepend(row);
      const input = row.querySelector("input");
      input.focus();
      row.scrollIntoView({ block: "nearest" });
    }

    function startRename(folderId) {
      closeMenu();
      if (editing) return;
      render();
      const row = container.querySelector(`.folder-row[data-folder-id="${folderId}"]`);
      if (!row) return;
      row.classList.add("editing");
      row.draggable = false;
      row.querySelector(".tree-name").replaceWith(makeInput(byId.get(folderId).name, { mode: "rename", folderId }));
      const input = row.querySelector("input");
      input.focus();
      input.select();
    }

    // ---------- 資料夾 ⋯ 選單 ----------

    function openMenu(folder, button) {
      if (menuFolder?.id === folder.id && !menu.hidden) {
        closeMenu();
        return;
      }
      closeMenu();
      menuFolder = folder;
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      const rect = button.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8));
      let top = rect.bottom + 4;
      if (top + menu.offsetHeight > innerHeight - 8) top = Math.max(8, rect.top - menu.offsetHeight - 4);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    }

    function closeMenu() {
      if (menu.hidden) return;
      menu.hidden = true;
      menuFolder = null;
      container.querySelectorAll('.row-btn.more[aria-expanded="true"]').forEach((btn) => {
        btn.setAttribute("aria-expanded", "false");
      });
    }

    menu.addEventListener("click", (e) => {
      const item = e.target.closest("[data-action]");
      if (!item || !menuFolder) return;
      const folder = menuFolder;
      closeMenu();
      if (item.dataset.action === "subfolder") startCreateFolder(folder.id);
      else if (item.dataset.action === "rename") startRename(folder.id);
      else callbacks.folderAction(item.dataset.action, folder);
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#folder-menu") && !e.target.closest(".row-btn.more")) closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
    container.addEventListener("scroll", closeMenu);
    window.addEventListener("resize", closeMenu);

    // ---------- 點擊與鍵盤 ----------

    function activate(row, target) {
      if (row.classList.contains("editing")) return;
      if (row.dataset.noteId) {
        callbacks.openNote(Number(row.dataset.noteId));
        return;
      }
      const folder = byId.get(Number(row.dataset.folderId));
      if (!folder) return;
      if (target?.closest(".row-btn.add")) callbacks.createNote(folder.id);
      else if (target?.closest(".row-btn.more")) openMenu(folder, target.closest(".row-btn.more"));
      else toggle(folder.id);
    }

    container.addEventListener("click", (e) => {
      const row = e.target.closest(".tree-row");
      if (row) activate(row, e.target);
    });

    container.addEventListener("keydown", (e) => {
      const row = e.target.closest(".tree-row");
      if (!row || e.target !== row) return;
      const folderId = Number(row.dataset.folderId);
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate(row, null);
      } else if (row.dataset.folderId && e.key === "ArrowRight" && !expanded.has(folderId)) {
        e.preventDefault();
        toggle(folderId, true);
        container.querySelector(`.folder-row[data-folder-id="${folderId}"]`)?.focus();
      } else if (row.dataset.folderId && e.key === "ArrowLeft" && expanded.has(folderId)) {
        e.preventDefault();
        toggle(folderId, false);
        container.querySelector(`.folder-row[data-folder-id="${folderId}"]`)?.focus();
      } else if (row.dataset.folderId && e.key === "F2") {
        e.preventDefault();
        startRename(folderId);
      }
    });

    // ---------- 拖放搬移（滑鼠；觸控裝置請用「移動到…」） ----------

    /** 放下的位置對應到哪個資料夾：資料夾列＝搬進去，筆記列＝搬到它所在的資料夾，空白處＝根目錄。 */
    function dropTarget(node) {
      const row = node.closest?.(".tree-row");
      if (row?.dataset.folderId) return Number(row.dataset.folderId);
      if (row?.dataset.noteId) {
        const note = data.notes.find((n) => n.id === Number(row.dataset.noteId));
        return note && byId.has(note.folder_id) ? note.folder_id : null;
      }
      return null;
    }

    function canDrop(targetId) {
      if (!dragging) return false;
      if (dragging.type === "note") {
        const note = data.notes.find((n) => n.id === dragging.id);
        return note ? (byId.has(note.folder_id) ? note.folder_id : null) !== targetId : false;
      }
      const folder = byId.get(dragging.id);
      if (!folder || parentOf(folder) === targetId) return false;
      return targetId == null || !ancestors(targetId).includes(dragging.id);   // 不能搬進自己或子資料夾
    }

    function clearDropHighlight() {
      container.classList.remove("drop-root");
      container.querySelectorAll(".drop-target").forEach((row) => row.classList.remove("drop-target"));
    }

    function highlight(targetId) {
      clearDropHighlight();
      if (targetId == null) container.classList.add("drop-root");
      else container.querySelector(`.folder-row[data-folder-id="${targetId}"]`)?.classList.add("drop-target");
    }

    container.addEventListener("dragstart", (e) => {
      const row = e.target.closest?.(".tree-row");
      if (!row || row.classList.contains("editing")) return;
      dragging = row.dataset.noteId
        ? { type: "note", id: Number(row.dataset.noteId) }
        : { type: "folder", id: Number(row.dataset.folderId) };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragging));
      row.classList.add("dragging");
      closeMenu();
    });

    container.addEventListener("dragover", (e) => {
      // 從外部拖進來的東西（例如檔案）不處理；拖曳中自動展開會重畫，dragend 可能收不到，所以每次都檢查
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) {
        dragging = null;
        return;
      }
      if (!dragging) return;
      const targetId = dropTarget(e.target);
      if (!canDrop(targetId)) {
        clearDropHighlight();
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      highlight(targetId);
      // 停在收合的資料夾上一下會自動展開
      const row = e.target.closest?.(".folder-row");
      clearTimeout(hoverTimer);
      if (row && !expanded.has(Number(row.dataset.folderId))) {
        hoverTimer = setTimeout(() => {
          toggle(Number(row.dataset.folderId), true);
          if (dragging) highlight(targetId);
        }, 700);
      }
    });

    container.addEventListener("dragleave", (e) => {
      if (!container.contains(e.relatedTarget)) {
        clearDropHighlight();
        clearTimeout(hoverTimer);
      }
    });

    container.addEventListener("drop", (e) => {
      if (!dragging) return;
      e.preventDefault();
      const item = dragging;
      const targetId = dropTarget(e.target);
      const ok = canDrop(targetId);
      clearDropHighlight();
      clearTimeout(hoverTimer);
      dragging = null;
      if (ok) callbacks.moveItem(item, targetId);
    });

    container.addEventListener("dragend", () => {
      dragging = null;
      clearTimeout(hoverTimer);
      clearDropHighlight();
      container.querySelectorAll(".dragging").forEach((row) => row.classList.remove("dragging"));
    });

    return { render, expand, startCreateFolder, isEditing: () => Boolean(editing) };
  }

  window.NoteTree = { create, collator };
})();
