/* 手寫畫板：觸控筆、手指、滑鼠都能使用，完成後輸出 PNG。
 *
 *   const blob = await Sketch.open();                 // 新的空白畫板
 *   const blob = await Sketch.open({ imageUrl });     // 在既有圖片上繼續寫 / 標註
 *   // 取消或沒有任何筆畫時回傳 null
 *
 * 三層 canvas：paper（紙張）→ ink（已完成的墨跡）→ live（正在畫的這一筆）。
 * 畫布解析度在開啟時決定，之後只用 CSS 縮放，旋轉螢幕或改變視窗大小都不會遺失內容。
 */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const dialog = $("#sketch");
  if (!dialog) return;

  const stage = $("#sk-stage");
  const sheet = $("#sk-sheet");
  const paperCanvas = $("#sk-paper-layer");
  const inkCanvas = $("#sk-ink-layer");
  const liveCanvas = $("#sk-live-layer");
  const paper = paperCanvas.getContext("2d");
  const ink = inkCanvas.getContext("2d");
  const live = liveCanvas.getContext("2d");
  const undoBtn = $("#sk-undo");
  const redoBtn = $("#sk-redo");
  const paperSelect = $("#sk-paper-style");
  const doneBtn = $("#sk-done");

  const SIZES = { thin: 2, medium: 4, thick: 8 };   // 筆的粗細（螢幕上的 CSS px）
  const HIGHLIGHTER = { color: "#ffd400", alpha: 0.35, factor: 4 };
  const ERASER_FACTOR = 5;
  const MIN_SIDE = 1200;   // 編輯小圖時放大，筆跡才不會糊
  const MAX_SIDE = 2000;   // 解析度上限，避免圖片太大
  const LINE_GAP = 32;     // 橫線 / 方格間距（CSS px）

  const state = {
    tool: "pen",           // pen | highlighter | eraser
    color: "#1f2328",
    size: "medium",
    strokes: [],           // 已完成的筆畫（向量資料，用來復原 / 重做）
    redo: [],
    current: null,         // 正在畫的筆畫
    pointerId: null,
    rect: null,
    drawnUpTo: 0,
    penSeen: false,        // 用過觸控筆之後，手指 / 手掌的觸控就不畫線
    baseImage: null,       // 編輯既有圖片時的底圖
    width: 0,
    height: 0,
    paperUnit: 1,          // 1 個 CSS px 等於多少畫布 px
    resolve: null,
  };

  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* 忽略 */ } },
  };

  // ---------- 尺寸 ----------

  function availableSize() {
    const cs = getComputedStyle(stage);
    return {
      w: stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      h: stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
    };
  }

  function setCanvasSize(w, h) {
    state.width = w;
    state.height = h;
    for (const canvas of [paperCanvas, inkCanvas, liveCanvas]) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /** 依目前可用空間縮放紙張（只改 CSS 大小，不動畫布內容）。 */
  function fitSheet() {
    const { w, h } = availableSize();
    const scale = Math.min(w / state.width, h / state.height);
    sheet.style.width = `${Math.floor(state.width * scale)}px`;
    sheet.style.height = `${Math.floor(state.height * scale)}px`;
  }

  /** 用 onload 而非 decode()：decode() 在分頁不可見時會一直等待畫面繪製。 */
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("圖片載入失敗"));
      img.src = url;
    });
  }

  // ---------- 紙張 ----------

  function drawPaper() {
    const { width: w, height: h } = state;
    paper.fillStyle = "#ffffff";
    paper.fillRect(0, 0, w, h);
    const style = paperSelect.value;
    if (style === "blank") return;
    const gap = Math.round(LINE_GAP * state.paperUnit);
    paper.lineWidth = Math.max(1, Math.round(state.paperUnit));
    paper.strokeStyle = style === "lined" ? "#c5d3e8" : "#e2e8f0";
    paper.beginPath();
    for (let y = gap; y < h; y += gap) {
      paper.moveTo(0, y + 0.5);
      paper.lineTo(w, y + 0.5);
    }
    if (style === "grid") {
      for (let x = gap; x < w; x += gap) {
        paper.moveTo(x + 0.5, 0);
        paper.lineTo(x + 0.5, h);
      }
    }
    paper.stroke();
  }

  // ---------- 筆畫繪製 ----------

  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2 });

  /** 觸控筆依壓力改變粗細，滑鼠 / 手指固定粗細。 */
  function widthAt(stroke, point) {
    return stroke.pressure ? Math.max(0.5, stroke.width * (0.3 + point.p * 1.4)) : stroke.width;
  }

  function applyStyle(ctx, stroke) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    ctx.globalAlpha = stroke.tool === "highlighter" ? HIGHLIGHTER.alpha : 1;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
  }

  /** 第 i 點之前的一小段平滑曲線：從前一段的中點，經過 i-1，畫到這一段的中點。 */
  function drawPiece(ctx, stroke, i) {
    const pts = stroke.points;
    const from = i >= 2 ? mid(pts[i - 2], pts[i - 1]) : pts[0];
    const to = mid(pts[i - 1], pts[i]);
    ctx.lineWidth = widthAt(stroke, pts[i - 1]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, to.x, to.y);
    ctx.stroke();
  }

  /** 收尾：最後一段中點連到最後一點；只點一下時畫一個圓點。 */
  function drawTail(ctx, stroke) {
    const pts = stroke.points;
    const last = pts[pts.length - 1];
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(last.x, last.y, widthAt(stroke, last) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const from = mid(pts[pts.length - 2], last);
    ctx.lineWidth = widthAt(stroke, last);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  /** 螢光筆是半透明的，整筆用同一條路徑一次畫完，自己重疊的地方才不會變深。 */
  function drawHighlighter(ctx, stroke) {
    const pts = stroke.points;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const m = mid(pts[i - 1], pts[i]);
      ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, m.x, m.y);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x + 0.01, last.y);  // 只點一下時也留下一個點
    ctx.stroke();
  }

  function renderStroke(ctx, stroke) {
    ctx.save();
    applyStyle(ctx, stroke);
    if (stroke.tool === "highlighter") {
      drawHighlighter(ctx, stroke);
    } else {
      for (let i = 1; i < stroke.points.length; i++) drawPiece(ctx, stroke, i);
      drawTail(ctx, stroke);
    }
    ctx.restore();
  }

  /** 重畫全部墨跡：底圖 + 依序重播每一筆（復原 / 重做 / 清除都靠它）。 */
  function redrawInk() {
    ink.clearRect(0, 0, state.width, state.height);
    if (state.baseImage) ink.drawImage(state.baseImage, 0, 0, state.width, state.height);
    for (const stroke of state.strokes) {
      if (stroke.tool === "clear") ink.clearRect(0, 0, state.width, state.height);
      else renderStroke(ink, stroke);
    }
  }

  /** 畫正在進行的這一筆：筆只補畫新增的片段，螢光筆每次整筆重畫。 */
  function drawProgress() {
    const stroke = state.current;
    if (stroke.tool === "highlighter") {
      live.clearRect(0, 0, state.width, state.height);
      live.save();
      applyStyle(live, stroke);
      drawHighlighter(live, stroke);
      live.restore();
      return;
    }
    const ctx = stroke.tool === "eraser" ? ink : live;  // 橡皮擦直接擦掉墨跡層
    ctx.save();
    applyStyle(ctx, stroke);
    for (let i = state.drawnUpTo; i < stroke.points.length; i++) drawPiece(ctx, stroke, i);
    ctx.restore();
    state.drawnUpTo = Math.max(state.drawnUpTo, stroke.points.length);
  }

  // ---------- 指標輸入（Pointer Events 同時支援觸控筆、手指、滑鼠） ----------

  function toPoint(e, rect) {
    return {
      x: (e.clientX - rect.left) * (state.width / rect.width),
      y: (e.clientY - rect.top) * (state.height / rect.height),
      p: e.pointerType === "pen" ? e.pressure : 0.5,
    };
  }

  function shouldDraw(e) {
    if (e.pointerType === "pen") {
      state.penSeen = true;
      return true;
    }
    if (e.pointerType === "touch") return !state.penSeen;  // 防手掌誤觸
    return e.button === 0;
  }

  sheet.addEventListener("pointerdown", (e) => {
    if (state.current || !shouldDraw(e)) return;
    e.preventDefault();
    try {
      sheet.setPointerCapture(e.pointerId);  // 筆移出紙張外也能繼續收到事件
    } catch { /* 指標已失效時忽略 */ }
    const rect = sheet.getBoundingClientRect();
    const base = SIZES[state.size] * (state.width / rect.width);  // 螢幕上看起來的粗細一致
    const tool = state.tool;
    state.current = {
      tool,
      color: tool === "highlighter" ? HIGHLIGHTER.color : state.color,
      width: tool === "eraser" ? base * ERASER_FACTOR
        : tool === "highlighter" ? base * HIGHLIGHTER.factor : base,
      pressure: tool === "pen" && e.pointerType === "pen",
      points: [toPoint(e, rect)],
    };
    state.pointerId = e.pointerId;
    state.rect = rect;
    state.drawnUpTo = 1;
    drawProgress();
  });

  sheet.addEventListener("pointermove", (e) => {
    if (!state.current || e.pointerId !== state.pointerId) return;
    // 觸控筆的取樣率比畫面更新率高，合併事件可讓線條更平滑
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) state.current.points.push(toPoint(ev, state.rect));
    drawProgress();
  });

  function endStroke(e) {
    if (!state.current || e.pointerId !== state.pointerId) return;
    const stroke = state.current;
    state.current = null;
    state.pointerId = null;
    live.clearRect(0, 0, state.width, state.height);
    if (stroke.tool === "eraser") {
      ink.save();
      applyStyle(ink, stroke);
      drawTail(ink, stroke);
      ink.restore();
    } else {
      renderStroke(ink, stroke);
    }
    state.strokes.push(stroke);
    state.redo = [];
    updateButtons();
  }

  sheet.addEventListener("pointerup", endStroke);
  sheet.addEventListener("pointercancel", endStroke);

  // ---------- 復原 / 重做 / 清除 ----------

  function updateButtons() {
    undoBtn.disabled = state.strokes.length === 0;
    redoBtn.disabled = state.redo.length === 0;
  }

  function undo() {
    if (!state.strokes.length) return;
    state.redo.push(state.strokes.pop());
    redrawInk();
    updateButtons();
  }

  function redo() {
    if (!state.redo.length) return;
    state.strokes.push(state.redo.pop());
    redrawInk();
    updateButtons();
  }

  function clearAll() {
    if (!state.strokes.length && !state.baseImage) return;
    state.strokes.push({ tool: "clear" });  // 清除也是一個可復原的動作
    state.redo = [];
    redrawInk();
    updateButtons();
  }

  // ---------- 工具列 ----------

  function syncToolbar() {
    dialog.querySelectorAll("[data-color]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(state.tool === "pen" && btn.dataset.color === state.color));
    });
    dialog.querySelectorAll("[data-tool]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.tool === state.tool));
    });
    dialog.querySelectorAll("[data-size]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.size === state.size));
    });
    sheet.dataset.tool = state.tool;
  }

  dialog.querySelector(".sketch-bar").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.color) {
      state.color = btn.dataset.color;
      state.tool = "pen";
    } else if (btn.dataset.tool) {
      state.tool = btn.dataset.tool;
    } else if (btn.dataset.size) {
      state.size = btn.dataset.size;
    } else {
      return;
    }
    syncToolbar();
  });

  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);
  $("#sk-clear").addEventListener("click", clearAll);
  paperSelect.addEventListener("change", () => {
    storage.set("sketchPaper", paperSelect.value);
    drawPaper();
  });

  // ---------- 開啟 / 關閉 ----------

  function finish(result) {
    const resolve = state.resolve;
    state.resolve = null;
    state.current = null;
    if (dialog.open) dialog.close();
    resolve?.(result);
  }

  function cancel() {
    if (state.strokes.length && !confirm("要放棄這次的手寫內容嗎？")) return;
    finish(null);
  }

  function done() {
    if (!state.strokes.length) {
      finish(null);
      return;
    }
    // 合成紙張與墨跡，輸出成一張 PNG
    const out = document.createElement("canvas");
    out.width = state.width;
    out.height = state.height;
    const ctx = out.getContext("2d");
    ctx.drawImage(paperCanvas, 0, 0);
    ctx.drawImage(inkCanvas, 0, 0);
    out.toBlob((blob) => finish(blob), "image/png");
  }

  $("#sk-cancel").addEventListener("click", cancel);
  doneBtn.addEventListener("click", done);
  dialog.addEventListener("cancel", (e) => {   // Esc 鍵
    e.preventDefault();
    cancel();
  });
  dialog.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (key === "y" || (key === "z" && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  });
  window.addEventListener("resize", () => {
    if (dialog.open) fitSheet();
  });

  async function open({ imageUrl } = {}) {
    if (dialog.open) return null;
    state.strokes = [];
    state.redo = [];
    state.current = null;
    state.baseImage = null;
    doneBtn.textContent = imageUrl ? "完成編輯" : "插入筆記";
    dialog.showModal();

    if (imageUrl) {
      try {
        state.baseImage = await loadImage(imageUrl);
      } catch {
        dialog.close();
        alert("無法載入這張圖片");
        return null;
      }
      if (!dialog.open) return null;  // 載入期間使用者已經取消
      const { naturalWidth: w, naturalHeight: h } = state.baseImage;
      const side = Math.max(w, h);
      const scale = side > MAX_SIDE ? MAX_SIDE / side : side < MIN_SIDE ? MIN_SIDE / side : 1;
      setCanvasSize(Math.round(w * scale), Math.round(h * scale));
      paperSelect.value = "blank";
    } else {
      // 新畫板填滿可用空間；解析度至少 1.5 倍，筆跡放大看也清楚
      const { w, h } = availableSize();
      let k = Math.min(2, Math.max(1.5, window.devicePixelRatio || 1));
      k = Math.min(k, MAX_SIDE / Math.max(w, h));
      setCanvasSize(Math.round(w * k), Math.round(h * k));
      paperSelect.value = storage.get("sketchPaper") || "blank";
    }

    fitSheet();
    state.paperUnit = state.width / parseFloat(sheet.style.width);
    live.clearRect(0, 0, state.width, state.height);
    drawPaper();
    redrawInk();
    syncToolbar();
    updateButtons();
    return new Promise((resolve) => { state.resolve = resolve; });
  }

  window.Sketch = { open };
})();
