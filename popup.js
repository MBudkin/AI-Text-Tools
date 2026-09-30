const statusNode = document.getElementById("status");
let activeTabId = null;

const ACTIONS = {
  openPanel: { icon: "panel", label: "Открыть боковую панель" },
  auto: { icon: "message", label: "Задать вопрос" },
  page: { icon: "page", label: "Вопрос по всей странице" },
  summarize: { icon: "sparkles", label: "Суммаризировать страницу" }
};

for (const button of document.querySelectorAll(".actions button")) {
  const action = ACTIONS[button.id || button.dataset.action];
  button.innerHTML = `${icon(action.icon)}<span>${action.label}</span>`;
  button.disabled = true;
}
document.getElementById("options").innerHTML = `${icon("settings")}Настройки`;
document.getElementById("history").innerHTML = `${icon("history")}История`;
bindThemeButton(document.getElementById("themeToggle"));

// Show the shortcuts the user actually has, since they can be reassigned.
chrome.commands.getAll(commands => {
  for (const button of document.querySelectorAll("[data-command]")) {
    const shortcut = commands.find(command => command.name === button.dataset.command)?.shortcut;
    if (!shortcut) continue;
    const kbd = document.createElement("kbd"); kbd.textContent = shortcut; button.append(kbd);
  }
});

chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  activeTabId = tabs[0]?.id || null;
  document.querySelectorAll(".actions button").forEach(button => button.disabled = !activeTabId);
  if (!activeTabId) statusNode.textContent = "Активная вкладка не найдена.";
  loadRecentChats();
});

chrome.runtime.sendMessage({ action: "GET_AI_SETTINGS_SUMMARY" }, summary => {
  if (chrome.runtime.lastError || !summary) return;
  document.getElementById("summary").textContent = `${summary.model} · кэш ${summary.caching ? "вкл." : "выкл."}`;
  document.getElementById("setup").classList.toggle("hidden", Boolean(summary.hasApiKey));
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

function relativeTime(timestamp) {
  if (!Number(timestamp)) return "";
  const minutes = Math.round((Date.now() - Number(timestamp || 0)) / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return new Date(timestamp).toLocaleDateString("ru-RU");
}

function loadRecentChats() {
  chrome.runtime.sendMessage({ action: "GET_SAVED_AI_CHATS" }, result => {
    const list = document.getElementById("chats");
    const chats = result?.chats || [];
    if (!chats.length) { list.innerHTML = '<div class="empty">Чатов пока нет</div>'; return; }
    list.innerHTML = "";
    const visibleChats = chats.slice(0, result.recentChatsLimit ?? 6);
    if (!visibleChats.length) { list.innerHTML = '<div class="empty">Показ недавних чатов отключён</div>'; return; }
    visibleChats.forEach(chat => {
      const row = document.createElement("div"); row.className = "chat-row";
      const button = document.createElement("button"); button.type = "button"; button.className = "chat";
      const title = document.createElement("strong"); title.textContent = chat.title || "Чат";
      const meta = document.createElement("small"); meta.textContent = [relativeTime(chat.updatedAt), chat.model, `$${money(chat.totalCost)}`].filter(Boolean).join(" · ");
      button.append(title, meta);
      button.addEventListener("click", () => {
        statusNode.textContent = "";
        const opening = openPanelFromGesture();
        const loading = chrome.runtime.sendMessage({ action: "OPEN_SAVED_AI_CHAT", chatId: chat.id, targetTabId: activeTabId, openInSidePanel: true, panelAlreadyOpen: true });
        finishPanelAction(opening, loading, "Не удалось открыть чат.");
      });
      const remove = iconButton("trash", `Удалить чат «${chat.title || "Чат"}» из истории`, async () => {
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
document.getElementById("setupButton").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("history").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }));
