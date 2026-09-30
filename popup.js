const statusNode = document.getElementById("status");
let activeTabId = null;

document.querySelectorAll(".actions button").forEach(button => button.disabled = true);
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  activeTabId = tabs[0]?.id || null;
  document.querySelectorAll(".actions button").forEach(button => button.disabled = !activeTabId);
  if (!activeTabId) statusNode.textContent = "Активная вкладка не найдена.";
  loadRecentChats();
});

chrome.runtime.sendMessage({ action: "GET_AI_SETTINGS_SUMMARY" }, summary => {
  if (chrome.runtime.lastError || !summary) return;
  document.getElementById("summary").textContent = `${summary.model} · кэш ${summary.caching ? "вкл." : "выкл."}`;
  applyTheme(summary.theme || "dark");
});

function openPanelFromGesture() {
  if (!activeTabId) return null;
  // This must be the first asynchronous API call in the click handler: Chrome
  // rejects sidePanel.open after the user-activation token is lost.
  return chrome.sidePanel.open({ tabId: activeTabId }).then(
    () => ({ ok: true }),
    error => ({ ok: false, error: error?.message || String(error) })
  );
}

async function finishPanelAction(opening, responsePromise, fallback) {
  if (!opening) { statusNode.textContent = "Активная вкладка не найдена."; return; }
  const [opened, response] = await Promise.all([opening, responsePromise]);
  if (!opened.ok) { statusNode.textContent = opened.error; return; }
  if (!response?.ok) { statusNode.textContent = response?.error || fallback; return; }
  window.close();
}

function loadRecentChats() {
  chrome.runtime.sendMessage({ action: "GET_SAVED_AI_CHATS" }, result => {
    const list = document.getElementById("chats");
    const chats = result?.chats || [];
    if (!chats.length) { list.innerHTML = '<span class="meta">Чатов пока нет</span>'; return; }
    list.innerHTML = "";
    const visibleChats = chats.slice(0, result.recentChatsLimit ?? 6);
    if (!visibleChats.length) { list.innerHTML = '<span class="meta">Показ недавних чатов отключён</span>'; return; }
    visibleChats.forEach(chat => {
      const row = document.createElement("div"); row.className = "chat-row";
      const button = document.createElement("button");
      button.className = "chat"; button.textContent = chat.title || "Чат";
      button.title = `${chat.model || ""} · $${money(chat.totalCost)}`;
      button.addEventListener("click", () => {
        statusNode.textContent = "";
        const opening = openPanelFromGesture();
        const loading = chrome.runtime.sendMessage({ action: "OPEN_SAVED_AI_CHAT", chatId: chat.id, targetTabId: activeTabId, openInSidePanel: true, panelAlreadyOpen: true });
        finishPanelAction(opening, loading, "Не удалось открыть чат.");
      });
      const remove = document.createElement("button"); remove.className = "delete-chat"; remove.textContent = "×"; remove.title = "Удалить чат из истории"; remove.setAttribute("aria-label", `Удалить чат ${chat.title || "Чат"}`);
      remove.addEventListener("click", async () => {
        if (!confirm(`Удалить чат «${chat.title || "Чат"}» из истории?`)) return;
        const deleted = await chrome.runtime.sendMessage({ action: "DELETE_SAVED_AI_CHATS", chatIds: [chat.id] });
        if (!deleted?.ok) { statusNode.textContent = deleted?.error || "Не удалось удалить чат."; return; }
        loadRecentChats();
      });
      row.append(button, remove); list.appendChild(row);
    });
  });
}

document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => {
  statusNode.textContent = "";
  const mode = button.dataset.action;
  const opening = openPanelFromGesture();
  const message = mode === "summarize"
    ? { action: "SUMMARIZE_AI_FROM_POPUP", targetTabId: activeTabId, panelAlreadyOpen: true }
    : { action: "OPEN_AI_FROM_POPUP", mode, targetTabId: activeTabId, panelAlreadyOpen: true };
  finishPanelAction(opening, chrome.runtime.sendMessage(message), "Не удалось подготовить запрос.");
}));

document.getElementById("openPanel").addEventListener("click", () => {
  statusNode.textContent = "";
  const opening = openPanelFromGesture();
  const claim = chrome.runtime.sendMessage({ action: "OPEN_SIDE_PANEL_FROM_POPUP", targetTabId: activeTabId, panelAlreadyOpen: true });
  finishPanelAction(opening, claim, "Не удалось открыть боковую панель.");
});

document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("history").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }));
document.getElementById("themeToggle").addEventListener("click", async () => {
  const current = document.body.classList.contains("light") ? "light" : "dark";
  const theme = current === "light" ? "dark" : "light";
  await chrome.storage.sync.set({ theme }); applyTheme(theme);
});
function applyTheme(theme) { document.body.classList.toggle("light", theme === "light" || (theme === "system" && matchMedia("(prefers-color-scheme:light)").matches)); }
function money(value) { const number = Number(value) || 0, absolute = Math.abs(number); if (!absolute || absolute >= .01) return number.toFixed(2); return number.toFixed(Math.min(8, Math.max(2, Math.ceil(-Math.log10(absolute)) + 1))); }
