/* 主題切換：淺色 / 深色 / 跟隨系統。設定存在帳號裡，所有裝置同步。 */
(() => {
  "use strict";

  const root = document.documentElement;
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  /** 「跟隨系統」時依作業系統設定決定實際是深色還是淺色。 */
  function effective(theme) {
    if (theme === "system") return darkQuery.matches ? "dark" : "light";
    return theme;
  }

  function syncControls() {
    document.querySelectorAll('input[name="theme"]').forEach((input) => {
      input.checked = input.value === root.dataset.theme;
    });
    const btn = document.getElementById("btn-theme");
    if (btn) {
      const label = effective(root.dataset.theme) === "dark" ? "切換為淺色背景" : "切換為深色背景";
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }
  }

  /** 立即套用並存到帳號；儲存失敗就還原。 */
  async function setTheme(theme) {
    const previous = root.dataset.theme;
    if (theme === previous) return;
    root.dataset.theme = theme;
    syncControls();
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `伺服器回應 ${res.status}`);
      }
    } catch (err) {
      root.dataset.theme = previous;
      syncControls();
      alert(`主題設定儲存失敗：${err.message}`);
    }
  }

  document.getElementById("btn-theme")?.addEventListener("click", () => {
    setTheme(effective(root.dataset.theme) === "dark" ? "light" : "dark");
  });
  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.addEventListener("change", () => setTheme(input.value));
  });
  darkQuery.addEventListener("change", syncControls);
  syncControls();
})();
