let chats = [];
let targetTabId = null;
let renderAsMarkdown = true;
let historyDisabled = false;
let searchTimer = null;
const selectedIds = new Set();
const container = document.getElementById("history");
const search = document.getElementById("search");
const deleteSelected = document.getElementById("deleteSelected");
const viewMode = document.getElementById("viewMode");
const imageViewer = document.getElementById("imageViewer");
const imageViewerImage = document.getElementById("imageViewerImage");
const imageViewerCaption = document.getElementById("imageViewerCaption");

document.getElementById("searchIcon").outerHTML = icon("search");
document.getElementById("imageViewerClose").innerHTML = icon("x");
bindThemeButton(document.getElementById("theme"));

document.addEventListener("DOMContentLoaded", init);
search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => render(historyDisabled), 150); });
deleteSelected.addEventListener("click", () => deleteChats([...selectedIds]));
viewMode.addEventListener("click", async () => {
  renderAsMarkdown = !renderAsMarkdown;
  updateViewMode();
  await chrome.storage.local.set({ historyViewMode: renderAsMarkdown ? "markdown" : "text" });
  render(historyDisabled);
});
document.getElementById("imageViewerClose").addEventListener("click", closeImageViewer);
imageViewer.addEventListener("click", event => { if (event.target === imageViewer) closeImageViewer(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !imageViewer.classList.contains("hidden")) closeImageViewer(); });
document.getElementById("clear").addEventListener("click", async () => {
  if (!confirm("Удалить всю локальную историю чатов и запросов?")) return;
  await deleteChats(chats.map(chat => chat.id), false);
});
chrome.storage.onChanged.addListener((changes, areaName) => { if (areaName === "local" && changes.chats) loadHistory(); });

async function init() {
  const stored = await chrome.storage.local.get("historyViewMode");
  renderAsMarkdown = stored.historyViewMode !== "text";
  updateViewMode();
  await Promise.all([refreshTargetTab(), loadHistory()]);
}

function updateViewMode() {
  viewMode.textContent = renderAsMarkdown ? "Исходный текст" : "Markdown";
  viewMode.title = renderAsMarkdown ? "Показать исходный текст" : "Показать форматированный Markdown";
  viewMode.setAttribute("aria-label", viewMode.title);
}

async function loadHistory() {
  const data = await chrome.storage.local.get(["chats", "history"]);
  const settings = await chrome.storage.sync.get("historyLimit");
  chats = data.chats?.length ? data.chats : migrateLegacyHistory(data.history || []);
  if (settings.historyLimit === 0) chats = [];
  const availableIds = new Set(chats.map(chat => chat.id));
  for (const id of selectedIds) if (!availableIds.has(id)) selectedIds.delete(id);
  historyDisabled = settings.historyLimit === 0;
  render(historyDisabled);
}

function migrateLegacyHistory(history) {
  return history.map((entry, index) => ({ id: entry.chatId || `legacy-${index}`, title: entry.query?.slice(0, 80) || "Запрос", model: entry.model, updatedAt: entry.timestamp || 0, totalCost: entry.cost || entry.usage?.cost || 0, context: entry.context, messages: [{ role: "user", content: entry.query || "" }, { role: "assistant", content: entry.response || "" }] }));
}

function render(disabled = false) {
  const term = search.value.trim().toLowerCase();
  const filtered = chats.filter(chat => `${chat.title || ""}\n${chat.model || ""}\n${(chat.messages || []).map(message => contentText(message.content)).join("\n")}`.toLowerCase().includes(term));
  document.getElementById("count").textContent = disabled ? "История отключена в настройках" : `${filtered.length} из ${chats.length} чатов`;
  container.innerHTML = "";
  updateSelectionUI();
  if (!filtered.length) {
    const empty = document.createElement("div"); empty.className = "empty";
    empty.innerHTML = icon(term ? "search" : "history");
    const text = document.createElement("div"); text.textContent = disabled ? "Сохранение истории отключено." : term ? "Ничего не найдено." : "История чатов пока пуста.";
    empty.append(text); container.appendChild(empty); return;
  }
  filtered.forEach(chat => container.appendChild(renderChat(chat)));
}

function renderChat(chat) {
  const article = document.createElement("article"); article.className = "entry";
  const head = document.createElement("div"); head.className = "entry-head";
  const select = document.createElement("input"); select.type = "checkbox"; select.className = "chat-select"; select.checked = selectedIds.has(chat.id); select.title = "Выбрать чат"; select.setAttribute("aria-label", `Выбрать чат ${chat.title || "Чат"}`); select.addEventListener("change", () => { if (select.checked) selectedIds.add(chat.id); else selectedIds.delete(chat.id); updateSelectionUI(); }); head.appendChild(select);
  const title = document.createElement("strong"); title.textContent = chat.title || "Чат"; head.appendChild(title);
  addPill(head, chat.model || "Модель не указана"); addPill(head, new Date(chat.updatedAt || Date.now()).toLocaleString("ru-RU")); addPill(head, formatCost(chat.totalCost, "history"));
  const open = document.createElement("button"); open.type = "button"; open.className = "btn"; open.innerHTML = `${icon("panel")}Открыть`; open.title = "Продолжить чат в боковой панели"; open.addEventListener("click", () => openChat(chat.id)); head.appendChild(open);
  head.appendChild(iconButton("trash", `Удалить чат «${chat.title || "Чат"}»`, () => deleteChats([chat.id]), "icon-btn"));
  const body = document.createElement("div"); body.className = "cell";
  if (chat.context && chat.context.type !== "none") body.appendChild(contextDetails(chat.context));
  const messages = document.createElement("div"); messages.className = "conversation";
  const assistantModels = new Set((chat.messages || []).filter(message => message.role === "assistant").map(message => message.model || chat.model).filter(Boolean));
  const showResponseModels = assistantModels.size > 1;
  for (const message of chat.messages || []) {
    if (message.role === "system") continue;
    const block = document.createElement("div"); block.className = `turn ${message.role}`;
    const label = document.createElement("div"); label.className = "label"; label.textContent = message.role === "user" ? "Запрос" : `Ответ AI${message.interrupted ? " · неполный" : ""}${message.cost != null || message.usage?.cost != null ? ` · ${formatCost(message.cost ?? message.usage?.cost, "history")}` : ""}${showResponseModels && (message.model || chat.model) ? ` · ${message.model || chat.model}` : ""}`;
    const messageBody = renderMessage(message.displayText || contentText(message.content)); block.append(label, messageBody);
    const imageCount = Number(message.imageCount) || countMessageImages(message.content);
    const imageUrls = messageImageUrls(message);
    if (message.role === "user" && imageUrls.length) block.append(imageGallery(imageUrls));
    else if (message.role === "user" && imageCount) { const badge = document.createElement("span"); badge.className = "image-badge"; badge.textContent = `▧ ${imageCount === 1 ? "Изображение" : `Изображения · ${imageCount}`}`; block.append(badge); }
    messages.appendChild(block);
  }
  body.appendChild(messages); article.append(head, body); return article;
}

function updateSelectionUI() {
  deleteSelected.disabled = selectedIds.size === 0;
  deleteSelected.textContent = selectedIds.size ? `Удалить выбранные · ${selectedIds.size}` : "Удалить выбранные";
}

async function deleteChats(ids, askConfirmation = true) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return;
  if (askConfirmation && !confirm(`Удалить ${uniqueIds.length === 1 ? "выбранный чат" : `выбранные чаты (${uniqueIds.length})`}?`)) return;
  const result = await chrome.runtime.sendMessage({ action: "DELETE_SAVED_AI_CHATS", chatIds: uniqueIds });
  if (!result?.ok) return alert(result?.error || "Не удалось удалить чаты.");
  uniqueIds.forEach(id => selectedIds.delete(id));
  await loadHistory();
}

function contextDetails(context) {
  const details = document.createElement("details"); details.className = "context"; const summary = document.createElement("summary"); const pre = document.createElement("pre");
  const linkCount = context.includeLinks ? context.pageLinks?.length || 0 : 0;
  summary.textContent = context.type === "page" ? `Контекст страницы · ${formatCount((context.pageText || "").length)} символов${context.includeLinks ? ` · ссылок ${linkCount}` : ""}` : `Выделенный текст · ${formatCount((context.selectionText || "").length)} символов`;
  const links = linkCount ? `\n\nСсылки:\n${context.pageLinks.map(link => `${link.text}: ${link.url}`).join("\n")}` : "";
  pre.textContent = context.type === "page" ? `${context.pageTitle || ""}\n${context.pageUrl || ""}\n\n${context.pageText || ""}${links}` : context.selectionText || "";
  details.append(summary, pre); return details;
}

async function refreshTargetTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  targetTabId = tabs.find(tab => tab.active)?.id || null;
}

function openChat(chatId) {
  if (!targetTabId) return alert("Сначала откройте обычную веб-страницу, на которой можно показать чат.");
  const tabId = targetTabId;
  const opening = chrome.sidePanel.open({ tabId }).then(() => null, error => error);
  (async () => {
    const response = await chrome.runtime.sendMessage({ action: "OPEN_SAVED_AI_CHAT", chatId, targetTabId: tabId, openInSidePanel: true, panelAlreadyOpen: true });
    const openingError = await opening;
    if (openingError) return alert(openingError.message || "Не удалось открыть боковую панель.");
    if (!response?.ok) return alert(response?.error || "Не удалось открыть чат.");
  })();
}

function renderMessage(text) {
  if (!renderAsMarkdown) { const pre = document.createElement("pre"); pre.className = "plain-text"; pre.textContent = text; return pre; }
  const body = document.createElement("div"); body.className = "markdown md";
  body.innerHTML = safeMarkdown(text);
  decorateMarkdownBlocks(body, { onCopy: async value => toast(await copyToClipboard(value) ? "Скопировано" : "Не удалось скопировать") });
  return body;
}
function imageGallery(urls) { const gallery = document.createElement("div"); gallery.className = "message-images"; urls.forEach((url, index) => { const button = document.createElement("button"); button.type = "button"; button.className = "message-image"; button.title = "Открыть изображение"; const image = document.createElement("img"); image.src = url; image.alt = `Прикреплённое изображение ${index + 1}`; button.append(image); button.addEventListener("click", () => openImageViewer(url, image.alt)); gallery.append(button); }); return gallery; }
function openImageViewer(url, caption) { imageViewerImage.src = url; imageViewerCaption.textContent = caption || "Прикреплённое изображение"; imageViewer.classList.remove("hidden"); document.getElementById("imageViewerClose").focus(); }
function closeImageViewer() { imageViewer.classList.add("hidden"); imageViewerImage.removeAttribute("src"); }
function addPill(parent, text) { const pill = document.createElement("span"); pill.className = "pill"; pill.textContent = text; parent.appendChild(pill); }
function toast(text) { const node = document.createElement("div"); node.className = "toast"; node.textContent = text; document.getElementById("toasts").append(node); setTimeout(() => node.remove(), 2400); }

document.addEventListener("aitt-currencychange", () => render(historyDisabled));
