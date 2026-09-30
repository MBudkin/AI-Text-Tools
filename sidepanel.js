const params = new URLSearchParams(location.search);
const state = {
  tabId: Number(params.get("tabId")) || null,
  isWindow: params.get("window") === "1",
  compactWindow: params.get("compact") === "1",
  session: null, draft: null, generating: false, answer: "", reasoning: "",
  reasoningMaxTokens: 2000, totalCost: 0, sendOnEnter: true, theme: "dark",
  modelCatalog: [], mode: "none", selectionText: "", images: [], pageLength: null, includePageLinks: false, pageLinkCount: null,
  autoStick: true, reasoningAutoStick: true, isNew: true, temporary: false,
  userScrollingUntil: 0, tabBehavior: "keep-current", transferringTemporary: false, localStartPending: false, renderedAnswer: null,
  currentResponseModel: "", currentModelChanged: false, editing: null, streamStableText: ""
};
const $ = id => document.getElementById(id);
let saveTimer = null;
let renderTimer = null;
let widthTimer = null;

const reasoningBudget = document.createElement("input");
Object.assign(reasoningBudget, { type: "number", min: "1", max: "128000", step: "100", placeholder: "Лимит токенов Reasoning" });
reasoningBudget.className = "hidden";
reasoningBudget.style.gridColumn = "1 / -1";
$("thinking").after(reasoningBudget);
if (state.isWindow) $("expand").classList.add("hidden");

init();

async function init() {
  await loadTab(state.tabId);
  setTimeout(() => $("input").focus(), 50);
}

async function loadTab(tabId, preservedDraft = null) {
  const result = await chrome.runtime.sendMessage({ action: "GET_ACTIVE_AI_CHAT", tabId: tabId || undefined });
  if (!result?.ok) { $("meta").textContent = "Активная вкладка не найдена"; return; }
  Object.assign(state, {
    tabId: result.tabId, session: preservedDraft ? null : result.session,
    generating: preservedDraft ? false : result.generating,
    sendOnEnter: result.sendOnEnter !== false, theme: result.theme || "dark",
    modelCatalog: result.modelCatalog || [], tabBehavior: result.sidePanelTabBehavior || "keep-current"
  });
  await chrome.runtime.sendMessage({ action: "CLAIM_AI_SURFACE", tabId: state.tabId, surface: "sidepanel" });
  const liveSelection = !state.session && !state.isWindow
    ? (await chrome.runtime.sendMessage({ action: "GET_TAB_SELECTION", tabId: state.tabId }))?.selectionText || ""
    : "";
  state.draft = preservedDraft || result.draft || {
    prompt: "", model: result.model || "", thinking: result.thinking || "none",
    reasoningMaxTokens: result.reasoningMaxTokens || 2000, mode: "none",
    selectionText: "", images: [], temporary: false
  };
  if (!state.session && !state.isWindow) {
    state.draft.selectionText = liveSelection;
    if (state.draft.mode === "selection" && !liveSelection) state.draft.mode = "none";
  }
  applyTheme(); fillModels();
  if (state.session) renderSession(state.session); else renderDraft(state.draft);
  if (state.generating) {
    beginAssistant();
    state.answer = result.session?.partialAnswer || "";
    state.reasoning = result.session?.partialReasoning || "";
    scheduleCurrentUpdate(true);
  }
  syncPrimary();
}

function fillModels() {
  const source = state.modelCatalog.length ? state.modelCatalog : [state.draft?.model].filter(Boolean).map(id => ({ id, name: id }));
  $("models").innerHTML = source.map(model => `<option value="${escapeHtml(model.id)}" label="${escapeHtml(model.name || model.id)}"></option>`).join("");
}

function renderDraft(draft) {
  state.isNew = true; state.mode = state.isWindow ? "none" : (draft.mode || "none"); state.selectionText = state.isWindow ? "" : (draft.selectionText || "");
  state.images = draft.images || []; state.reasoningMaxTokens = Number(draft.reasoningMaxTokens) || 2000;
  state.temporary = Boolean(draft.temporary); state.pageLength = null; state.includePageLinks = !state.isWindow && Boolean(draft.includePageLinks); state.pageLinkCount = null;
  $("title").textContent = "Новый чат"; $("meta").textContent = "Подготовьте запрос";
  $("draftControls").classList.remove("hidden"); $("chat").innerHTML = "";
  $("chatOptions").classList.add("hidden"); $("chatSettings").classList.add("hidden"); cancelEdit(false);
  $("model").value = draft.model || ""; $("input").value = draft.prompt || "";
  renderContexts(); renderAttachments(); applyModelCapability(draft.thinking);
  $("contexts").classList.toggle("hidden", state.isWindow);
  reasoningBudget.value = state.reasoningMaxTokens; autoResize(); updateTemporaryUI();
  if (state.mode === "page") previewPage();
}

function renderSession(session) {
  cancelEdit(false); state.session = session; state.isNew = false; state.temporary = Boolean(session.temporary); state.totalCost = Number(session.totalCost) || 0;
  $("title").textContent = session.title || "Чат";
  $("meta").textContent = `${session.model || ""} · $${money(state.totalCost)}`;
  $("draftControls").classList.add("hidden"); $("chat").innerHTML = "";
  $("chatModel").value = session.model || $("model").value || ""; $("chatOptions").classList.remove("hidden"); $("chatSettings").classList.add("hidden"); applyChatModelCapability(session.thinking);
  $("input").value = ""; autoResize();
  let userTurnIndex = 0;
  for (const message of session.messages || []) {
    if (message.role === "system") continue;
    appendMessage(message.role, message.displayText || contentText(message.content), message.role === "user" ? { ...message, userTurnIndex: userTurnIndex++ } : message);
  }
  refreshResponseModelLabels(); updateTemporaryUI(); scrollDown(true);
}

function renderContexts() {
  const items = [
    { id: "none", text: "Без контекста" },
    { id: "page", text: `Страница${state.pageLength != null ? ` · ${state.pageLength} симв.` : ""}` },
    { id: "selection", text: state.selectionText ? `Выделенный текст · ${state.selectionText.length} симв.` : "Выделенный текст", disabled: !state.selectionText }
  ];
  $("contexts").innerHTML = items.map(item => `<button class="context ${state.mode === item.id ? "active" : ""}" data-mode="${item.id}" ${item.disabled ? "disabled" : ""}>${item.text}</button>`).join("");
  $("pageLinkOption").classList.toggle("hidden", state.mode !== "page" || state.isWindow);
  $("includePageLinks").checked = state.includePageLinks;
  $("pageLinkCount").textContent = state.includePageLinks && state.pageLinkCount != null ? `· ${state.pageLinkCount} найдено` : "";
  $("contexts").querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", async () => {
    if (button.disabled) return;
    state.mode = button.dataset.mode;
    $("input").focus({ preventScroll: true });
    if (state.mode === "page") await previewPage();
    renderContexts(); scheduleDraftSave();
    requestAnimationFrame(() => $("input").focus());
  }));
}

async function previewPage() {
  state.pageLength = null; state.pageLinkCount = null; renderContexts();
  const requestedTab = state.tabId;
  const includeLinks = state.includePageLinks;
  const result = await chrome.runtime.sendMessage({ action: "PREVIEW_PAGE_CONTEXT", tabId: requestedTab, includeLinks });
  if (requestedTab !== state.tabId) return;
  state.pageLength = result?.ok ? result.length : 0;
  state.pageLinkCount = result?.ok && includeLinks ? Number(result.linkCount) || 0 : null;
  renderContexts();
  if (!result?.ok) toast(result?.error || "Не удалось извлечь страницу");
}

function currentDraft() {
  return {
    prompt: $("input").value, model: $("model").value.trim(), thinking: $("thinking").value,
    reasoningMaxTokens: Number(reasoningBudget.value) || 2000, mode: state.mode,
    selectionText: state.selectionText, includePageLinks: state.includePageLinks, images: state.images, temporary: state.temporary
  };
}

function scheduleDraftSave(includeImages = false) {
  if (!state.isNew) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const draft = currentDraft(); if (!includeImages) delete draft.images;
    chrome.runtime.sendMessage({ action: "SAVE_AI_DRAFT", tabId: state.tabId, draft });
  }, 120);
}

function renderAttachments() {
  const box = $("attachments"); box.classList.toggle("hidden", !state.images.length);
  box.innerHTML = "";
  state.images.forEach((image, index) => {
    const item = document.createElement("div"); item.className = "attachment";
    const view = document.createElement("button"); view.type = "button"; view.className = "attachment-view"; view.title = "Открыть изображение";
    const thumbnail = document.createElement("img"); thumbnail.src = image.previewDataUrl || image.dataUrl; thumbnail.alt = image.name || `Изображение ${index + 1}`;
    view.append(thumbnail); view.addEventListener("click", () => openImageViewer(image.dataUrl, image.name));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "attachment-remove"; remove.dataset.remove = String(index); remove.title = "Удалить изображение"; remove.setAttribute("aria-label", "Удалить изображение");
    item.append(view, remove); box.append(item);
  });
  box.querySelectorAll("[data-remove]").forEach(button => button.addEventListener("click", () => {
    state.images.splice(Number(button.dataset.remove), 1); renderAttachments(); scheduleDraftSave(true);
  }));
}

function messageImageUrls(metadata = {}) {
  const originalUrls = Array.isArray(metadata.content)
    ? metadata.content.filter(part => part?.type === "image_url").map(part => part.image_url?.url).filter(Boolean)
    : [];
  const previewUrls = Array.isArray(metadata.imagePreviews) ? metadata.imagePreviews.filter(Boolean) : [];
  return originalUrls.length ? originalUrls : previewUrls;
}

function imageGallery(urls = []) {
  const gallery = document.createElement("div"); gallery.className = "message-images";
  urls.forEach((url, index) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "message-image"; button.title = "Открыть изображение";
    const image = document.createElement("img"); image.src = url; image.alt = `Прикреплённое изображение ${index + 1}`;
    button.append(image); button.addEventListener("click", () => openImageViewer(url, image.alt)); gallery.append(button);
  });
  return gallery;
}

function openImageViewer(url, caption = "") {
  if (!url) return;
  $("imageViewerImage").src = url;
  $("imageViewerCaption").textContent = caption || "Прикреплённое изображение";
  $("imageViewer").classList.remove("hidden");
  $("imageViewerClose").focus({ preventScroll: true });
}

function closeImageViewer() {
  $("imageViewer").classList.add("hidden");
  $("imageViewerImage").removeAttribute("src");
}

function appendMessage(role, text = "", metadata = {}) {
  const row = document.createElement("div"); row.className = `message-row ${role}-row`;
  const bubble = document.createElement("section"); bubble.className = `message ${role}`;
  const tools = document.createElement("div"); tools.className = "outside-tools";
  tools.append(iconButton("⧉", "Копировать", () => copyText(role === "assistant" ? (bubble.querySelector(".answer")?.innerText || text) : text)));
  if (role === "user") {
    row.dataset.userTurn = String(metadata.userTurnIndex ?? $("chat").querySelectorAll(".user-row").length);
    tools.append(iconButton("✎", "Редактировать запрос", () => startEditMessage(text, { ...metadata, userTurnIndex: Number(row.dataset.userTurn) })));
    const prompt = document.createElement("div"); prompt.textContent = text; bubble.append(prompt);
    const imageCount = Number(metadata.imageCount) || countMessageImages(metadata.content);
    const imageUrls = messageImageUrls(metadata);
    if (imageUrls.length) bubble.append(imageGallery(imageUrls));
    else if (imageCount) { const marker = document.createElement("span"); marker.className = "image-marker"; marker.textContent = `▧ ${imageCount === 1 ? "Изображение" : `Изображения · ${imageCount}`}`; bubble.append(marker); }
    const contextType = metadata.contextType || metadata.displayContext?.type || "none";
    if (contextType === "selection" && metadata.displayContext?.selectionText) bubble.append(contextSpoiler(metadata.displayContext));
    else if (contextType === "page") {
      const marker = document.createElement("span"); marker.className = "context-marker"; marker.textContent = `Контекст: страница${metadata.pageLinksIncluded ? ` · ссылки${metadata.pageLinkCount ? ` ${metadata.pageLinkCount}` : ""}` : ""}`; bubble.append(marker);
    }
  }
  else {
    $("chat").querySelectorAll("[data-retry]").forEach(button => button.remove());
    bubble.innerHTML = '<details class="reasoning hidden" open><summary>Размышление</summary><div class="reasoning-text"></div></details><div class="answer"></div><div class="status"></div>';
    bubble.querySelector(".answer").innerHTML = safeMarkdown(text); decorateAnswer(bubble.querySelector(".answer"));
    if (metadata.reasoning) { const details = bubble.querySelector(".reasoning"); details.classList.remove("hidden"); details.removeAttribute("open"); bubble.querySelector(".reasoning-text").textContent = metadata.reasoning; }
    if (metadata.usage?.cost != null || metadata.cost != null) setResponseStatus(bubble.querySelector(".status"), metadata);
    const retry = iconButton("↻", "Перегенерировать", regenerate); retry.dataset.retry = "1"; tools.append(retry);
  }
  row.append(bubble, tools);
  $("chat").append(row); return bubble;
}

function contextSpoiler(context) {
  const details = document.createElement("details"); details.className = "context-spoiler";
  const summary = document.createElement("summary");
  const pre = document.createElement("pre");
  summary.textContent = `Выделенный текст · ${(context.selectionText || "").length} симв.`;
  pre.textContent = context.selectionText || "";
  details.append(summary, pre);
  details.addEventListener("toggle", () => { state.autoStick = false; state.userScrollingUntil = Date.now() + 1500; });
  details.addEventListener("wheel", event => {
    state.autoStick = false; state.userScrollingUntil = Date.now() + 900;
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const inner = target?.closest("pre");
    const canScrollInner = inner && (event.deltaY < 0 ? inner.scrollTop > 0 : inner.scrollTop + inner.clientHeight < inner.scrollHeight - 1);
    if (!canScrollInner && event.deltaY) {
      event.preventDefault();
      $("chat").scrollTop += event.deltaY;
    }
  }, { passive: false });
  return details;
}

function iconButton(text, title, handler) { const button = document.createElement("button"); button.className = "tool"; button.textContent = text; button.title = title; button.addEventListener("click", handler); return button; }
function beginAssistant() { state.answer = ""; state.reasoning = ""; state.renderedAnswer = null; state.streamStableText = ""; state.generating = true; state.autoStick = true; state.reasoningAutoStick = true; const bubble = appendMessage("assistant"); bubble.querySelector(".status").textContent = "Генерация…"; bubble.closest(".message-row")?.querySelector("[data-retry]")?.classList.add("hidden"); syncPrimary(); scrollDown(true); return bubble; }
function currentAssistant() { return [...$("chat").querySelectorAll(".message.assistant")].at(-1); }

function scheduleCurrentUpdate(force = false) {
  if (force) { clearTimeout(renderTimer); renderTimer = null; updateCurrent(); return; }
  if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; updateCurrent(); }, 28);
}

function updateCurrent() {
  const bubble = currentAssistant(); if (!bubble) return;
  const answer = bubble.querySelector(".answer"), details = bubble.querySelector(".reasoning"), reasoningText = bubble.querySelector(".reasoning-text");
  const chat = $("chat");
  const preserveManualPosition = !state.autoStick || Date.now() <= state.userScrollingUntil;
  const previousTop = chat.scrollTop;
  const horizontalPositions = [...answer.querySelectorAll(".code-wrap pre,.table-scroll")].map(node => node.scrollLeft);
  if (state.answer) details.removeAttribute("open");
  const nextAnswer = state.answer || "Ожидаем ответ…";
  if (nextAnswer !== state.renderedAnswer) {
    if (state.generating) renderStreamingAnswer(answer, nextAnswer);
    else { answer.innerHTML = safeMarkdown(nextAnswer); decorateAnswer(answer); state.streamStableText = ""; }
    state.renderedAnswer = nextAnswer;
    [...answer.querySelectorAll(".code-wrap pre,.table-scroll")].forEach((node, index) => { node.scrollLeft = horizontalPositions[index] || 0; });
  }
  if (state.reasoning) { details.classList.remove("hidden"); reasoningText.textContent = state.reasoning; if (state.reasoningAutoStick) reasoningText.scrollTop = reasoningText.scrollHeight; bindReasoningScroll(reasoningText); }
  if (preserveManualPosition) chat.scrollTop = previousTop;
  else scrollDown();
}

function streamingBoundary(text) {
  let inFence = false, lastBoundary = 0, offset = 0;
  for (const match of String(text).matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0]; if (!line) break;
    const trimmed = line.trim();
    if (/^(?:```|~~~)/.test(trimmed)) inFence = !inFence;
    offset += line.length;
    if (!inFence && !trimmed && offset < text.length) lastBoundary = offset;
  }
  return lastBoundary;
}

function renderStreamingAnswer(answer, text) {
  let stable = answer.querySelector(":scope > .stream-stable"), tail = answer.querySelector(":scope > .stream-tail");
  if (!stable || !tail || !text.startsWith(state.streamStableText)) {
    answer.innerHTML = '<div class="stream-stable"></div><div class="stream-tail"></div>';
    stable = answer.querySelector(".stream-stable"); tail = answer.querySelector(".stream-tail"); state.streamStableText = "";
  }
  const boundary = Math.max(state.streamStableText.length, streamingBoundary(text));
  const stableText = text.slice(0, boundary);
  if (stableText.length > state.streamStableText.length) {
    const template = document.createElement("template"); template.innerHTML = safeMarkdown(stableText.slice(state.streamStableText.length), false);
    stable.append(template.content); decorateAnswer(stable); state.streamStableText = stableText;
  }
  tail.innerHTML = safeMarkdown(text.slice(boundary), false); decorateAnswer(tail);
}

function bindReasoningScroll(node) { if (node.dataset.scrollBound) return; node.dataset.scrollBound = "1"; node.addEventListener("wheel", event => { if (event.deltaY < 0) state.reasoningAutoStick = false; }, { passive: true }); node.addEventListener("scroll", () => { if (node.scrollHeight - node.scrollTop - node.clientHeight < 20) state.reasoningAutoStick = true; }); }

async function submit() {
  if (state.generating || !state.tabId) return;
  const prompt = $("input").value.trim(); if (!prompt && !state.images.length) return toast("Введите запрос или добавьте изображение");
  if (state.editing) return submitEditedMessage(prompt);
  const startsNewConversation = state.isNew;
  const display = prompt || `[Изображения: ${state.images.length}]`;
  const messageContextType = startsNewConversation ? state.mode : "none";
  const displayContext = messageContextType === "selection" ? { type: "selection", selectionText: state.selectionText } : null;
  const images = state.images;
  const imageCount = images.length;
  const imagePreviews = images.map(image => image.previewDataUrl || image.dataUrl).filter(Boolean);
  appendMessage("user", display, { displayContext, contextType: messageContextType, pageLinksIncluded: messageContextType === "page" && state.includePageLinks, pageLinkCount: messageContextType === "page" ? state.pageLinkCount || 0 : 0, imageCount, imagePreviews }); beginAssistant();
  state.images = []; renderAttachments(); $("input").value = ""; autoResize();
  if (startsNewConversation) {
    const context = state.mode === "selection" ? { type: "selection", selectionText: state.selectionText } : { type: state.mode, ...(state.mode === "page" ? { includeLinks: state.includePageLinks } : {}) };
    enterChatState(display.slice(0, 80), $("model").value.trim(), state.temporary, $("thinking").value);
    state.localStartPending = true;
    await chrome.runtime.sendMessage({ action: "START_AI_CHAT", tabId: state.tabId, prompt: display, model: $("model").value.trim(), thinking: $("thinking").value, reasoningMaxTokens: Number(reasoningBudget.value) || 2000, context, images, temporary: state.temporary, source: "sidepanel" });
  } else {
    const model = $("chatModel").value.trim() || state.session?.model || "";
    await chrome.runtime.sendMessage({ action: "CONTINUE_AI_CHAT", tabId: state.tabId, prompt: display, images, model, thinking: $("chatThinking").value, reasoningMaxTokens: Number($("chatReasoningBudget").value) || 2000, source: "sidepanel" });
  }
}

function startEditMessage(text, metadata) {
  if (state.generating) return toast("Сначала дождитесь завершения генерации");
  if (state.editing) cancelEdit(true);
  state.editing = { ...metadata, pendingPrompt: $("input").value, pendingImages: state.images };
  state.images = []; renderAttachments(); $("attach").disabled = true;
  $("input").value = text; $("editBar").classList.remove("hidden"); autoResize();
  $("input").focus({ preventScroll: true }); $("input").setSelectionRange($("input").value.length, $("input").value.length);
}

function cancelEdit(restore = true) {
  if (state.editing && restore) { $("input").value = state.editing.pendingPrompt || ""; state.images = state.editing.pendingImages || []; renderAttachments(); }
  state.editing = null; $("editBar").classList.add("hidden"); $("attach").disabled = false; autoResize();
}

async function submitEditedMessage(prompt) {
  if (!prompt) return toast("Введите запрос");
  const edit = state.editing, row = $("chat").querySelector(`.user-row[data-user-turn="${edit.userTurnIndex}"]`);
  if (!row) { cancelEdit(true); return toast("Сообщение для редактирования не найдено"); }
  let node = row; while (node) { const next = node.nextElementSibling; node.remove(); node = next; }
  state.editing = null; $("editBar").classList.add("hidden"); $("attach").disabled = false;
  appendMessage("user", prompt, { ...edit, displayText: prompt, userTurnIndex: edit.userTurnIndex }); beginAssistant();
  $("input").value = ""; autoResize();
  await chrome.runtime.sendMessage({ action: "EDIT_AI_MESSAGE", tabId: state.tabId, userTurnIndex: edit.userTurnIndex, prompt, model: $("chatModel").value.trim() || state.session?.model || "", thinking: $("chatThinking").value, reasoningMaxTokens: Number($("chatReasoningBudget").value) || 2000, source: "sidepanel" });
}

async function stop() { if (state.generating) await chrome.runtime.sendMessage({ action: "STOP_AI_CHAT", tabId: state.tabId }); }
async function regenerate() { if (state.generating || !state.tabId) return; currentAssistant()?.closest(".message-row")?.remove(); beginAssistant(); await chrome.runtime.sendMessage({ action: "REGENERATE_AI_CHAT", tabId: state.tabId, model: $("chatModel").value.trim() || state.session?.model || "", thinking: $("chatThinking").value, reasoningMaxTokens: Number($("chatReasoningBudget").value) || 2000, source: "sidepanel" }); }
async function newChat() {
  const previousModel = state.session?.model || $("model").value || state.draft?.model || "";
  const previousThinking = state.session?.thinking || $("thinking").value || "none";
  let targetTabId = state.tabId;
  if (!state.isWindow) targetTabId = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id || state.tabId;
  await chrome.runtime.sendMessage({ action: "RESET_AI_CHAT", tabId: state.tabId });
  if (targetTabId !== state.tabId) await chrome.runtime.sendMessage({ action: "RESET_AI_CHAT", tabId: targetTabId });
  state.tabId = targetTabId; state.session = null; state.generating = false; state.totalCost = 0;
  const selection = !state.isWindow ? await chrome.runtime.sendMessage({ action: "GET_TAB_SELECTION", tabId: targetTabId }) : null;
  renderDraft({ prompt: "", model: previousModel, thinking: previousThinking, mode: "none", selectionText: selection?.selectionText || "", includePageLinks: false, images: [], temporary: false });
  await chrome.runtime.sendMessage({ action: "CLAIM_AI_SURFACE", tabId: targetTabId, surface: "sidepanel" });
  syncPrimary(); scheduleDraftSave(true); $("input").focus();
}
async function openWindow() {
  const draft = state.isNew ? { ...currentDraft(), mode: "none", selectionText: "" } : null;
  state.transferringTemporary = state.temporary;
  const result = await chrome.runtime.sendMessage({ action: "OPEN_AI_CHAT_WINDOW", tabId: state.tabId, draft });
  if (!result?.ok) { state.transferringTemporary = false; toast(result?.error || "Не удалось открыть отдельное окно"); }
  else if (state.transferringTemporary) setTimeout(() => { state.transferringTemporary = false; }, 2000);
}
function syncPrimary() { $("primary").textContent = state.generating ? "Стоп" : "Отправить"; $("primary").className = state.generating ? "stop" : "primary"; }
function enterChatState(title, model, temporary = false, thinking = "none") { state.isNew = false; state.temporary = Boolean(temporary); state.session = { ...(state.session || {}), model: model || state.session?.model || "", thinking }; $("title").textContent = title || "Чат"; $("meta").textContent = model || ""; $("draftControls").classList.add("hidden"); $("chatModel").value = model || ""; $("chatOptions").classList.remove("hidden"); $("chatSettings").classList.add("hidden"); applyChatModelCapability(thinking); $("input").value = ""; autoResize(); updateTemporaryUI(); }
function updateTemporaryUI() { document.body.classList.toggle("temporary", state.temporary); $("temporary").classList.toggle("active", state.temporary); $("temporary").textContent = state.temporary ? "Временный чат" : "Временный"; $("temporary").classList.toggle("hidden", !state.isNew); }
function migrateReasoning(value) { return value === "on" ? "medium" : value === "off" || !value ? "none" : value; }
function applyReasoningCapability(modelId, select, budget, current) { const model = state.modelCatalog.find(item => item.id === modelId), mandatory = Boolean(model?.reasoning?.mandatory), supported = !model || mandatory || model.supported_parameters?.includes("reasoning") || Boolean(model.reasoning); let efforts = Array.isArray(model?.reasoning?.supported_efforts) && model.reasoning.supported_efforts.length ? model.reasoning.supported_efforts : ["low", "medium", "high"]; if (!supported) efforts = []; const values = [...(!mandatory ? ["none"] : []), ...efforts, ...(supported && model?.reasoning?.supports_max_tokens !== false ? ["custom"] : [])], labels = { none: "Нет", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max", custom: "Custom" }; select.innerHTML = [...new Set(values)].map(value => `<option value="${value}">${labels[value] || value}</option>`).join(""); const wanted = migrateReasoning(current || select.value); select.value = values.includes(wanted) ? wanted : (model?.reasoning?.default_effort && values.includes(model.reasoning.default_effort) ? model.reasoning.default_effort : values[0] || "none"); budget.classList.toggle("hidden", select.value !== "custom"); }
function applyModelCapability(current) { applyReasoningCapability($("model").value.trim(), $("thinking"), reasoningBudget, current); }
function applyChatModelCapability(current) { applyReasoningCapability($("chatModel").value.trim(), $("chatThinking"), $("chatReasoningBudget"), current); $("chatReasoningBudget").value = Number(state.session?.reasoningMaxTokens) || Number($("chatReasoningBudget").value) || 2000; }
function toggleReasoningBudget() { reasoningBudget.classList.toggle("hidden", $("thinking").value !== "custom"); }

async function prepareFiles(files) { if (state.editing) return toast("При редактировании сохраняются изображения исходного сообщения"); const selectedModel = state.isNew ? $("model").value.trim() : $("chatModel").value.trim(); const model = state.modelCatalog.find(item => item.id === selectedModel); if (model && !model.input_modalities?.includes("image")) return toast("Выбранная модель не поддерживает изображения"); for (const file of files) { if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) { toast("Изображение должно быть меньше 12 МБ"); continue; } const [dataUrl, previewDataUrl] = await Promise.all([resizeImage(file, 1800), resizeImage(file, 640, true)]); state.images.push({ name: file.name || "Изображение", dataUrl, previewDataUrl }); } renderAttachments(); scheduleDraftSave(true); $("files").value = ""; }
function resizeImage(file, maxSide, preview = false) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => { const image = new Image(); image.onerror = () => reject(new Error("Неподдерживаемое изображение")); image.onload = () => { const scale = Math.min(1, maxSide / Math.max(image.width, image.height)), canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale)); canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL(preview ? "image/webp" : (file.type === "image/png" ? "image/png" : "image/jpeg"), preview ? .76 : .88)); }; image.src = reader.result; }; reader.readAsDataURL(file); }); }
function autoResize() { const input = $("input"); input.style.height = "34px"; if (!input.value) { input.style.overflowY = "hidden"; return; } const height = Math.min(160, Math.max(34, input.scrollHeight)); input.style.height = `${height}px`; input.style.overflowY = input.scrollHeight > 160 ? "auto" : "hidden"; }
function scrollDown(force = false) { if (force || state.autoStick) $("chat").scrollTop = $("chat").scrollHeight; }
function safeMarkdown(text, renderMath = true) {
  const template = document.createElement("template");
  template.innerHTML = marked.parse(normalizeMathSource(text));
  template.content.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach(node => node.remove());
  template.content.querySelectorAll("*").forEach(node => {
    [...node.attributes].forEach(attr => { if (attr.name.startsWith("on") || /javascript:/i.test(attr.value)) node.removeAttribute(attr.name); });
    if (node.tagName === "A") {
      const href = node.getAttribute("href") || "";
      try {
        const url = new URL(href);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Unsupported link protocol");
        node.href = url.href;
        node.target = "_blank";
        node.rel = "noopener noreferrer";
      } catch {
        node.removeAttribute("href");
        node.removeAttribute("target");
        node.removeAttribute("rel");
      }
    }
  });
  if (renderMath && typeof renderMathInElement === "function") renderMathInElement(template.content, {
    delimiters: [
      { left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false }, { left: "$", right: "$", display: false }
    ],
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"], throwOnError: false, strict: "ignore"
  });
  return template.innerHTML;
}
function normalizeMathSource(value = "") {
  let text = String(value)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expression) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, expression) => `$${expression.trim()}$`);
  text = text.replace(/(^|\n)\s*\[\s*([^\]\n]+?)\s*\]\s*(?=\n|$)/g, (match, prefix, expression) => looksLikeMath(expression) ? `${prefix}$$\n${expression.trim()}\n$$` : match);
  return text;
}
function looksLikeMath(expression) { return /[=^_]|\\(?:frac|sqrt|pm|sum|prod|int|lim|alpha|beta|gamma|theta|pi|infty)\b|(?:\d|\b[A-Za-z]\b)\s*[+*/-]/.test(expression); }
function decorateAnswer(answer) {
  answer.querySelectorAll("pre").forEach(pre => {
    if (pre.parentElement?.classList.contains("code-wrap")) return;
    const wrap = document.createElement("div"); wrap.className = "code-wrap";
    pre.replaceWith(wrap); wrap.append(pre);
    const button = iconButton("⧉", "Копировать код", () => copyText(pre.querySelector("code")?.innerText || pre.innerText));
    button.classList.add("block-copy"); wrap.append(button);
  });
  answer.querySelectorAll("table").forEach(table => {
    if (table.closest(".table-wrap")) return;
    constrainTableColumns(table);
    const wrap = document.createElement("div"); wrap.className = "table-wrap";
    const scroll = document.createElement("div"); scroll.className = "table-scroll";
    table.replaceWith(wrap); scroll.append(table); wrap.append(scroll);
    const button = iconButton("⧉", "Копировать таблицу", () => copyText(table.innerText));
    button.classList.add("block-copy"); wrap.append(button);
  });
}
function constrainTableColumns(table) { table.querySelectorAll("th,td").forEach(cell => { if (cell.children.length === 1 && cell.firstElementChild?.classList.contains("table-cell-content")) return; const content = document.createElement("div"); content.className = "table-cell-content"; while (cell.firstChild) content.append(cell.firstChild); cell.append(content); }); }
async function copyText(text) { try { await navigator.clipboard.writeText(text); } catch { const area = document.createElement("textarea"); area.value = text; area.style.cssText = "position:fixed;left:-9999px"; document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); } toast("Скопировано"); }
function toast(text) { const node = document.createElement("div"); node.className = "toast"; node.textContent = text; $("toasts").append(node); setTimeout(() => node.remove(), 2600); }
function contentText(content) { return typeof content === "string" ? content : (content || []).filter(part => part.type === "text").map(part => part.text).join("\n"); }
function countMessageImages(content) { return Array.isArray(content) ? content.filter(part => part.type === "image_url" || (part.type === "text" && /^\[Изображение было приложено/.test(part.text || ""))).length : 0; }
function setResponseStatus(node, metadata = {}) { node.dataset.complete = "1"; if (metadata.usage?.total_tokens != null) node.dataset.tokens = String(metadata.usage.total_tokens || 0); if (metadata.cost != null || metadata.usage?.cost != null) node.dataset.cost = String(metadata.cost ?? metadata.usage?.cost); node.dataset.model = metadata.model || state.session?.model || ""; refreshResponseModelLabels(); }
function refreshResponseModelLabels() { const statuses = [...$("chat").querySelectorAll('.message.assistant .status[data-complete="1"]')], models = new Set(statuses.map(node => node.dataset.model).filter(Boolean)), showModels = models.size > 1; for (const node of statuses) { const parts = []; if (node.dataset.tokens != null && node.dataset.tokens !== "") parts.push(`${node.dataset.tokens} токенов`); if (node.dataset.cost != null && node.dataset.cost !== "") parts.push(`$${money(node.dataset.cost)}`); if (showModels && node.dataset.model) parts.push(node.dataset.model); node.textContent = parts.join(" · "); } }
function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function money(value) { const number = Number(value) || 0, absolute = Math.abs(number); if (!absolute || absolute >= .01) return number.toFixed(2); const decimals = Math.min(8, Math.max(2, Math.ceil(-Math.log10(absolute)) + 1)); return number.toFixed(decimals); }
function applyTheme() { document.body.classList.toggle("light", state.theme === "light" || (state.theme === "system" && matchMedia("(prefers-color-scheme:light)").matches)); }

async function reconcileGeneration() {
  if (!state.generating || !state.tabId) return;
  const result = await chrome.runtime.sendMessage({ action: "GET_ACTIVE_AI_CHAT", tabId: state.tabId }).catch(() => null);
  if (!result?.ok) return;
  if (!result.generating && result.session?.messages?.at(-1)?.role === "assistant") {
    state.session = result.session; state.generating = false; state.localStartPending = false;
    renderSession(result.session); syncPrimary(); return;
  }
  if (result.generating && result.session) {
    const partialAnswer = result.session.partialAnswer || "", partialReasoning = result.session.partialReasoning || "";
    if (partialAnswer.length > state.answer.length || partialReasoning.length > state.reasoning.length) { state.answer = partialAnswer; state.reasoning = partialReasoning; scheduleCurrentUpdate(); }
  }
}

$("primary").addEventListener("click", () => state.generating ? stop() : submit());
$("newChat").addEventListener("click", newChat); $("expand").addEventListener("click", openWindow);
$("temporary").addEventListener("click", () => { if (!state.isNew) return; state.temporary = !state.temporary; updateTemporaryUI(); scheduleDraftSave(); });
$("theme").addEventListener("click", async () => { state.theme = document.body.classList.contains("light") ? "dark" : "light"; applyTheme(); await chrome.storage.sync.set({ theme: state.theme }); });
$("attach").addEventListener("click", () => $("files").click()); $("files").addEventListener("change", () => prepareFiles([...$("files").files]));
$("includePageLinks").addEventListener("change", async () => {
  state.includePageLinks = $("includePageLinks").checked;
  if (state.mode === "page") await previewPage();
  scheduleDraftSave();
  $("input").focus({ preventScroll: true });
});
$("model").addEventListener("change", () => { applyModelCapability(); scheduleDraftSave(); }); $("thinking").addEventListener("change", () => { toggleReasoningBudget(); scheduleDraftSave(); }); reasoningBudget.addEventListener("input", () => scheduleDraftSave());
$("chatOptions").addEventListener("click", () => { const opening = $("chatSettings").classList.contains("hidden"); $("chatSettings").classList.toggle("hidden", !opening); $("chatOptions").classList.toggle("active", opening); });
$("chatModel").addEventListener("change", () => applyChatModelCapability($("chatThinking").value));
$("chatThinking").addEventListener("change", () => $("chatReasoningBudget").classList.toggle("hidden", $("chatThinking").value !== "custom"));
$("cancelEdit").addEventListener("click", () => { cancelEdit(true); $("input").focus({ preventScroll: true }); });
$("imageViewerClose").addEventListener("click", closeImageViewer);
$("imageViewer").addEventListener("click", event => { if (event.target === $("imageViewer")) closeImageViewer(); });
$("input").addEventListener("input", () => { autoResize(); scheduleDraftSave(); }); $("input").addEventListener("paste", event => { const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); prepareFiles(files); } });
$("input").addEventListener("keydown", event => { const send = event.key === "Enter" && !event.isComposing && (state.sendOnEnter ? !event.shiftKey && !event.ctrlKey : event.ctrlKey); if (send) { event.preventDefault(); submit(); } });
$("chat").addEventListener("wheel", () => { state.autoStick = false; state.userScrollingUntil = Date.now() + 700; }, { passive: true });
$("chat").addEventListener("scroll", () => { if (Date.now() > state.userScrollingUntil && $("chat").scrollHeight - $("chat").scrollTop - $("chat").clientHeight < 30) state.autoStick = true; }, { passive: true });
let dragDepth = 0;
document.addEventListener("dragenter", event => { if ([...(event.dataTransfer?.items || [])].some(item => item.kind === "file")) { event.preventDefault(); dragDepth += 1; $("dropOverlay").classList.remove("hidden"); } });
document.addEventListener("dragover", event => { if ([...(event.dataTransfer?.types || [])].includes("Files")) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; } });
document.addEventListener("dragleave", event => { if (event.relatedTarget) dragDepth = Math.max(0, dragDepth - 1); else dragDepth = 0; if (!dragDepth) $("dropOverlay").classList.add("hidden"); });
document.addEventListener("drop", event => { event.preventDefault(); dragDepth = 0; $("dropOverlay").classList.add("hidden"); const files = [...(event.dataTransfer?.files || [])].filter(file => file.type.startsWith("image/")); if (files.length) prepareFiles(files); else toast("Можно перетащить только изображения"); });
chrome.storage.onChanged?.addListener((changes, areaName) => { if (areaName === "sync" && changes.sidePanelTabBehavior) state.tabBehavior = changes.sidePanelTabBehavior.newValue || "keep-current"; });
setInterval(reconcileGeneration, 1500);
document.addEventListener("visibilitychange", () => { if (!document.hidden) reconcileGeneration(); });
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!$("imageViewer").classList.contains("hidden")) { event.preventDefault(); closeImageViewer(); return; }
  if (state.editing) { event.preventDefault(); cancelEdit(true); $("input").focus({ preventScroll: true }); return; }
  if (state.generating || state.isWindow) event.preventDefault();
  if (state.generating) stop();
  if (state.isWindow) window.close();
});

if (!state.isWindow) chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!tabId || tabId === state.tabId) { if (state.mode === "page" && state.isNew) previewPage(); return; }
  if (!state.isNew && state.tabBehavior === "keep-current") return;
  if (state.isNew) {
    const draft = currentDraft();
    await chrome.runtime.sendMessage({ action: "SAVE_AI_DRAFT", tabId: state.tabId, draft });
    const selection = await chrome.runtime.sendMessage({ action: "GET_TAB_SELECTION", tabId });
    draft.selectionText = selection?.selectionText || "";
    if (draft.mode === "selection" && !draft.selectionText) draft.mode = "none";
    await loadTab(tabId, draft);
    await chrome.runtime.sendMessage({ action: "SAVE_AI_DRAFT", tabId, draft });
  } else await loadTab(tabId);
});

if (!state.isWindow) chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (tabId !== state.tabId || !state.isNew || (changeInfo.status !== "complete" && !changeInfo.url)) return;
  const selection = await chrome.runtime.sendMessage({ action: "GET_TAB_SELECTION", tabId });
  state.selectionText = selection?.selectionText || "";
  if (!state.selectionText && state.mode === "selection") state.mode = "none";
  renderContexts();
  if (state.mode === "page") previewPage();
});

if (state.isWindow) window.addEventListener("resize", () => { clearTimeout(widthTimer); widthTimer = setTimeout(() => chrome.runtime.sendMessage({ action: "SAVE_AI_CHAT_WINDOW_WIDTH", width: window.outerWidth, compact: state.compactWindow }), 350); });
window.addEventListener("beforeunload", () => {
  if (state.isWindow && state.generating) chrome.runtime.sendMessage({ action: "STOP_AI_CHAT", tabId: state.tabId });
  if (state.temporary && !state.transferringTemporary) chrome.runtime.sendMessage({ action: "FORGET_TEMPORARY_CHAT", tabId: state.tabId });
});

chrome.runtime.onMessage.addListener(message => {
  if (message.action === "AI_SURFACE_OWNER" && message.surfaceOwner === "sidepanel" && message.newChat) {
    state.tabId = message.sourceTabId;
    state.localStartPending = false;
    if (message.externalRequest) return;
    loadTab(message.sourceTabId).then(() => { requestAnimationFrame(() => $("input").focus({ preventScroll: true })); setTimeout(() => $("input").focus({ preventScroll: true }), 80); });
    return;
  }
  if (message.sourceTabId !== state.tabId) return;
  if (message.action === "AI_SELECTION_UPDATED" && state.isNew && !state.isWindow) {
    state.selectionText = message.selectionText || "";
    if (!state.selectionText && state.mode === "selection") state.mode = "none";
    renderContexts(); scheduleDraftSave();
    return;
  }
  if (message.action?.startsWith("AI_CHAT_") && message.surfaceOwner !== "sidepanel") return;
  if (message.action === "AI_CHAT_STARTED") {
    state.currentResponseModel = message.model || state.session?.model || ""; state.currentModelChanged = Boolean(message.modelChanged);
    state.session = { ...(state.session || {}), model: state.currentResponseModel, thinking: message.thinking, reasoningMaxTokens: message.reasoningMaxTokens || state.session?.reasoningMaxTokens, title: message.title || state.session?.title }; $("chatModel").value = state.currentResponseModel; applyChatModelCapability(message.thinking);
    if (message.edited && message.title) $("title").textContent = message.title;
    if (message.newConversation) {
      if (state.localStartPending) state.localStartPending = false;
      else {
        $("chat").innerHTML = ""; state.generating = false; state.totalCost = 0;
        state.session = { model: message.model, title: message.title, temporary: Boolean(message.temporary) };
        enterChatState(message.title || message.userPrompt?.slice(0, 80), message.model, message.temporary, message.thinking);
        if (message.userPrompt || message.userImageCount) appendMessage("user", message.userPrompt || "Изображение", { displayContext: message.userContext, contextType: message.userContextType, pageLinksIncluded: message.userPageLinksIncluded, pageLinkCount: message.userPageLinkCount, imageCount: message.userImageCount, userTurnIndex: 0 });
      }
    }
    if (!state.generating) beginAssistant();
  }
  if (message.action === "AI_CHAT_DELTA") { state.answer += message.content || ""; state.reasoning += message.reasoning || ""; scheduleCurrentUpdate(); }
  if (message.action === "AI_CHAT_META" && message.notice) toast(message.notice);
  if (message.action === "AI_CHAT_DONE") { state.generating = false; state.renderedAnswer = null; if (typeof message.content === "string") state.answer = message.content; if (typeof message.reasoning === "string") state.reasoning = message.reasoning; if (!currentAssistant()) { state.localStartPending = false; loadTab(state.tabId); return; } scheduleCurrentUpdate(true); state.totalCost = Number(message.totalCost) || state.totalCost; const bubble = currentAssistant(); if (bubble) setResponseStatus(bubble.querySelector(".status"), { usage: message.usage, cost: message.requestCost, model: message.model || state.currentResponseModel }); currentAssistant()?.closest(".message-row")?.querySelector("[data-retry]")?.classList.remove("hidden"); const model = message.model || state.session?.model || ""; $("meta").textContent = `${state.temporary ? "Временный · " : ""}${model}${model ? " · " : ""}$${money(state.totalCost)}`; syncPrimary(); }
  if (message.action === "AI_CHAT_STOPPED") { state.generating = false; state.localStartPending = false; state.renderedAnswer = null; scheduleCurrentUpdate(true); const status = currentAssistant()?.querySelector(".status"); if (status) status.textContent = "Остановлено"; syncPrimary(); }
  if (message.action === "AI_CHAT_ERROR") { state.generating = false; state.localStartPending = false; state.renderedAnswer = null; scheduleCurrentUpdate(true); const status = currentAssistant()?.querySelector(".status"); if (status) status.textContent = `Ошибка: ${message.error}`; else toast(message.error); syncPrimary(); }
});
