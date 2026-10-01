const params = new URLSearchParams(location.search);
const state = {
  tabId: Number(params.get("tabId")) || null,
  isWindow: params.get("window") === "1",
  compactWindow: params.get("compact") === "1",
  session: null, draft: null, generating: false, answer: "", reasoning: "",
  reasoningMaxTokens: 2000, totalCost: 0, sendOnEnter: true,
  modelCatalog: [], recentModels: [], menuItems: [], pageContextLimit: 60000,
  mode: "none", selectionText: "", images: [], pageLength: null, includePageLinks: false, pageLinkCount: null,
  autoStick: true, reasoningAutoStick: true, isNew: true, temporary: false,
  userScrollingUntil: 0, tabBehavior: "keep-current", transferringTemporary: false, localStartPending: false, renderedAnswer: null,
  currentResponseModel: "", currentModelChanged: false, editing: null, streamStableText: "", overflowChoice: null
};
const $ = id => document.getElementById(id);
let saveTimer = null;
let renderTimer = null;
let widthTimer = null;

const reasoningBudget = document.createElement("input");
Object.assign(reasoningBudget, { type: "number", min: "1", max: "128000", step: "100", placeholder: "Лимит токенов Reasoning" });
reasoningBudget.className = "reasoning-budget hidden";
reasoningBudget.setAttribute("aria-label", "Лимит токенов Reasoning");
$("thinking").after(reasoningBudget);
if (state.isWindow) $("expand").classList.add("hidden");

setupChrome();
registerPanel();
init();

async function init() {
  await loadTab(state.tabId);
  setTimeout(() => $("input").focus(), 50);
}

function setupChrome() {
  const setIcon = (id, name, label) => { const button = $(id); button.innerHTML = icon(name); button.title = label; button.setAttribute("aria-label", label); };
  setIcon("newChat", "newChat", "Новый чат");
  setIcon("history", "history", "История чатов");
  setIcon("expand", "external", "Открыть чат в отдельном окне");
  setIcon("attach", "image", "Добавить изображения");
  setIcon("chatOptions", "sliders", "Модель и Reasoning следующего ответа");
  setIcon("scrollBottom", "arrowDown", "К последнему сообщению");
  $("imageViewerClose").innerHTML = icon("x");
  bindThemeButton($("theme"));
  attachModelPicker($("model"), pickerModels);
  attachModelPicker($("chatModel"), pickerModels);
}

function pickerModels() {
  if (state.modelCatalog.length) return state.modelCatalog;
  return [...new Set([state.draft?.model, state.session?.model, ...state.recentModels].filter(Boolean))].map(id => ({ id, name: id }));
}

// Open panels announce themselves through storage so content scripts publish
// live selection only while someone can see it (see content.js).
function registerPanel() {
  const panelId = crypto.randomUUID();
  const write = async remove => {
    try {
      const { aiPanels = {} } = await chrome.storage.local.get("aiPanels");
      const now = Date.now();
      const next = Object.fromEntries(Object.entries(aiPanels).filter(([, seen]) => now - seen < 150000));
      if (remove) delete next[panelId]; else next[panelId] = now;
      await chrome.storage.local.set({ aiPanels: next });
    } catch {}
  };
  write(false);
  setInterval(() => write(false), 60000);
  window.addEventListener("pagehide", () => write(true));
}

async function loadTab(tabId, preservedDraft = null) {
  const result = await chrome.runtime.sendMessage({ action: "GET_ACTIVE_AI_CHAT", tabId: tabId || undefined });
  if (!result?.ok) { $("meta").textContent = "Активная вкладка не найдена"; return; }
  Object.assign(state, {
    tabId: result.tabId, session: preservedDraft ? null : result.session,
    generating: preservedDraft ? false : result.generating,
    sendOnEnter: result.sendOnEnter !== false,
    modelCatalog: result.modelCatalog || [], recentModels: result.recentModels || [], menuItems: result.menuItems || [],
    pageContextLimit: Number(result.pageContextLimit) || 60000, tabBehavior: result.sidePanelTabBehavior || "keep-current"
  });
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
  updateComposerHint();
  if (state.session) renderSession(state.session); else renderDraft(state.draft);
  if (state.generating) {
    beginAssistant();
    state.answer = result.session?.partialAnswer || "";
    state.reasoning = result.session?.partialReasoning || "";
    scheduleCurrentUpdate(true);
  }
  syncPrimary();
}

function updateComposerHint() {
  $("composerHint").innerHTML = state.sendOnEnter ? "" : "<kbd>Ctrl</kbd>+<kbd>Enter</kbd> — отправить";
}

function renderDraft(draft) {
  state.isNew = true; state.mode = state.isWindow ? "none" : (draft.mode || "none"); state.selectionText = state.isWindow ? "" : (draft.selectionText || "");
  state.images = draft.images || []; state.reasoningMaxTokens = Number(draft.reasoningMaxTokens) || 2000;
  state.temporary = Boolean(draft.temporary); state.pageLength = null; state.includePageLinks = !state.isWindow && Boolean(draft.includePageLinks); state.pageLinkCount = null;
  $("title").textContent = "Новый чат"; $("meta").textContent = "Подготовьте запрос";
  $("draftControls").classList.remove("hidden"); $("chat").innerHTML = "";
  $("chatOptions").classList.add("hidden"); $("chatSettings").classList.add("hidden"); cancelEdit(false); hideOverflowChoice();
  $("model").value = draft.model || ""; $("input").value = draft.prompt || "";
  renderContexts(); renderAttachments(); applyModelCapability(draft.thinking);
  $("contexts").classList.toggle("hidden", state.isWindow);
  reasoningBudget.value = state.reasoningMaxTokens; autoResize(); updateTemporaryUI(); renderEmptyState();
  if (state.mode === "page") previewPage();
}

function renderSession(session) {
  cancelEdit(false); hideOverflowChoice(); state.session = session; state.isNew = false; state.temporary = Boolean(session.temporary); state.totalCost = Number(session.totalCost) || 0;
  $("title").textContent = session.title || "Чат";
  updateChatMeta(session.model);
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

// Quick prompts from the settings; ones that need a selection stay disabled until there is one.
function renderEmptyState() {
  if (!state.isNew || $("chat").querySelector(".message-row")) return;
  const empty = document.createElement("div"); empty.className = "empty-state";
  const logo = document.createElement("img"); logo.src = "icon128.png"; logo.alt = "";
  const heading = document.createElement("h2"); heading.textContent = state.temporary ? "Временный чат" : "Чем помочь?";
  const hint = document.createElement("p");
  hint.textContent = state.temporary ? "Этот разговор не попадёт в историю." : "Задайте вопрос, выберите контекст страницы или используйте готовый промпт.";
  empty.append(logo, heading, hint);
  const prompts = state.menuItems.map((item, index) => ({ item, index })).filter(({ item }) => item?.title && item?.prompt);
  if (prompts.length && !state.isWindow) {
    const list = document.createElement("div"); list.className = "quick-prompts";
    for (const { item, index } of prompts) {
      const needsSelection = item.prompt.includes("{{selectionText}}");
      const button = document.createElement("button"); button.type = "button"; button.className = "quick-prompt";
      button.innerHTML = `${icon("sparkles")}<span></span>`; button.querySelector("span").textContent = item.title;
      button.disabled = needsSelection && !state.selectionText;
      button.title = button.disabled ? "Сначала выделите текст на странице" : needsSelection ? `Применить к выделенному тексту (${formatCount(state.selectionText.length)} симв.)` : "Запустить промпт";
      button.addEventListener("click", () => runQuickPrompt(index));
      list.append(button);
    }
    empty.append(list);
  }
  $("chat").append(empty);
}

async function runQuickPrompt(index) {
  if (state.generating || !state.tabId) return;
  hideOverflowChoice();
  const result = await chrome.runtime.sendMessage({ action: "RUN_AI_PROMPT", tabId: state.tabId, index, selectionText: state.selectionText, temporary: state.temporary });
  if (!result?.ok) toast(result?.error || "Не удалось запустить промпт");
}

function renderContexts() {
  const over = state.pageLength != null && state.pageLength > state.pageContextLimit;
  const items = [
    { id: "none", icon: "message", text: "Без контекста" },
    { id: "page", icon: "page", text: `Страница${state.pageLength != null ? ` · ${formatCount(state.pageLength)} симв.` : ""}`, over },
    { id: "selection", icon: "edit", text: state.selectionText ? `Выделение · ${formatCount(state.selectionText.length)} симв.` : "Выделение", disabled: !state.selectionText }
  ];
  $("contexts").innerHTML = items.map(item => `<button type="button" class="context" data-mode="${item.id}" aria-pressed="${state.mode === item.id}" ${item.disabled ? 'disabled title="Выделите текст на странице"' : ""}>${icon(item.icon)}<span>${escapeHtml(item.text)}</span>${item.over ? `<span class="over" title="Больше лимита ${formatCount(state.pageContextLimit)} символов">лимит</span>` : ""}</button>`).join("");
  $("pageLinkOption").classList.toggle("hidden", state.mode !== "page" || state.isWindow);
  $("includePageLinks").checked = state.includePageLinks;
  $("pageLinkCount").textContent = state.includePageLinks && state.pageLinkCount != null ? `· ${state.pageLinkCount} найдено` : "";
  $("contexts").querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", async () => {
    if (button.disabled) return;
    state.mode = button.dataset.mode;
    hideOverflowChoice();
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
  if (result?.limit) state.pageContextLimit = result.limit;
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
    const remove = iconButton("x", "Удалить изображение", () => { state.images.splice(index, 1); renderAttachments(); scheduleDraftSave(true); }, "attachment-remove");
    item.append(view, remove); box.append(item);
  });
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
  $("chat").querySelector(".empty-state")?.remove();
  const row = document.createElement("div"); row.className = `message-row ${role}-row`;
  const bubble = document.createElement("section"); bubble.className = `message ${role}`;
  const tools = document.createElement("div"); tools.className = "outside-tools";
  tools.append(iconButton("copy", role === "assistant" ? "Копировать ответ" : "Копировать запрос", event => copyText(role === "assistant" ? (bubble.querySelector(".answer")?.innerText || text) : text, event.currentTarget)));
  if (role === "user") {
    row.dataset.userTurn = String(metadata.userTurnIndex ?? $("chat").querySelectorAll(".user-row").length);
    tools.append(iconButton("edit", "Редактировать запрос", () => startEditMessage(text, { ...metadata, userTurnIndex: Number(row.dataset.userTurn) })));
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
    bubble.innerHTML = '<details class="reasoning hidden" open><summary>Размышление</summary><div class="reasoning-text"></div></details><div class="answer md"></div><div class="status"></div>';
    bubble.querySelector(".answer").innerHTML = safeMarkdown(text); decorateAnswer(bubble.querySelector(".answer"));
    if (metadata.reasoning) { const details = bubble.querySelector(".reasoning"); details.classList.remove("hidden"); details.removeAttribute("open"); bubble.querySelector(".reasoning-text").textContent = metadata.reasoning; }
    if (metadata.interrupted) bubble.querySelector(".status").textContent = metadata.interrupted === "error" ? "Прервано ошибкой · ответ неполный" : "Остановлено · ответ неполный";
    else if (metadata.usage?.cost != null || metadata.cost != null) setResponseStatus(bubble.querySelector(".status"), metadata);
    const retry = iconButton("refresh", "Перегенерировать", regenerate); retry.dataset.retry = "1"; tools.append(retry);
  }
  row.append(bubble, tools);
  $("chat").append(row); return bubble;
}

function contextSpoiler(context) {
  const details = document.createElement("details"); details.className = "context-spoiler";
  const summary = document.createElement("summary");
  const pre = document.createElement("pre");
  summary.textContent = `Выделенный текст · ${formatCount((context.selectionText || "").length)} симв.`;
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

function beginAssistant() {
  state.answer = ""; state.reasoning = ""; state.renderedAnswer = null; state.streamStableText = ""; state.generating = true; state.autoStick = true; state.reasoningAutoStick = true;
  state.generationStartedAt = Date.now();
  const bubble = appendMessage("assistant");
  const status = bubble.querySelector(".status"); status.textContent = "Генерация…"; status.classList.add("generating");
  bubble.closest(".message-row")?.querySelector("[data-retry]")?.classList.add("hidden");
  syncPrimary(); scrollDown(true); return bubble;
}
function updateChatMeta(model = state.session?.model || "") {
  if (state.isNew) return;
  $("meta").textContent = [state.temporary ? "Временный" : "", model, formatCost(state.totalCost, "chat")].filter(Boolean).join(" · ");
}
document.addEventListener("aitt-currencychange", () => { refreshResponseModelLabels(); updateChatMeta(); });
function showRetry() { currentAssistant()?.closest(".message-row")?.querySelector("[data-retry]")?.classList.remove("hidden"); }
function currentAssistant() { return [...$("chat").querySelectorAll(".message.assistant")].at(-1); }
function finishStatus(text, error = false) {
  const status = currentAssistant()?.querySelector(".status");
  if (!status) return false;
  status.classList.remove("generating"); status.classList.toggle("error", error);
  if (text != null) status.textContent = text;
  return true;
}

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
  if (!state.answer && state.generating) {
    if (!answer.querySelector(".waiting")) answer.innerHTML = '<span class="waiting">Ожидаем ответ…</span>';
    state.renderedAnswer = "";
  } else {
    const nextAnswer = state.answer;
    if (nextAnswer !== state.renderedAnswer) {
      if (state.generating) renderStreamingAnswer(answer, nextAnswer);
      else { answer.innerHTML = safeMarkdown(nextAnswer); decorateAnswer(answer); state.streamStableText = ""; }
      state.renderedAnswer = nextAnswer;
      [...answer.querySelectorAll(".code-wrap pre,.table-scroll")].forEach((node, index) => { node.scrollLeft = horizontalPositions[index] || 0; });
    }
  }
  if (state.reasoning) { details.classList.remove("hidden"); reasoningText.textContent = state.reasoning; if (state.reasoningAutoStick) reasoningText.scrollTop = reasoningText.scrollHeight; bindReasoningScroll(reasoningText); }
  if (preserveManualPosition) chat.scrollTop = previousTop;
  else scrollDown();
  updateScrollButton();
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

function decorateAnswer(answer) { decorateMarkdownBlocks(answer, { onCopy: text => copyText(text) }); }

function bindReasoningScroll(node) { if (node.dataset.scrollBound) return; node.dataset.scrollBound = "1"; node.addEventListener("wheel", event => { if (event.deltaY < 0) state.reasoningAutoStick = false; }, { passive: true }); node.addEventListener("scroll", () => { if (node.scrollHeight - node.scrollTop - node.clientHeight < 20) state.reasoningAutoStick = true; }); }

// Resolves to "truncate", "full" or null (cancel). Shown only when the preview
// already knows the page is longer than the configured limit.
function askOverflowChoice(length, limit) {
  return new Promise(resolve => {
    const bar = $("overflowBar");
    bar.innerHTML = "";
    const text = document.createElement("div");
    text.textContent = `Текст страницы — ${formatCount(length)} символов, больше лимита ${formatCount(limit)}. Как отправить?`;
    const actions = document.createElement("div"); actions.className = "notice-actions";
    const choice = (label, value, className = "btn") => { const button = document.createElement("button"); button.type = "button"; button.className = className; button.textContent = label; button.addEventListener("click", () => { hideOverflowChoice(); resolve(value); }); return button; };
    actions.append(choice(`Обрезать до ${formatCount(limit)}`, "truncate", "btn btn-primary"), choice("Отправить целиком", "full"), choice("Отмена", null));
    bar.append(text, actions);
    bar.classList.remove("hidden");
    state.overflowChoice = resolve;
    actions.querySelector("button").focus();
  });
}
function hideOverflowChoice() {
  const pending = state.overflowChoice; state.overflowChoice = null;
  $("overflowBar").classList.add("hidden"); $("overflowBar").innerHTML = "";
  pending?.(null);
}

async function submit() {
  if (state.generating || !state.tabId || state.overflowChoice) return;
  const prompt = $("input").value.trim(); if (!prompt && !state.images.length) return toast("Введите запрос или добавьте изображение");
  if (state.editing) return submitEditedMessage(prompt);
  const startsNewConversation = state.isNew;
  let overflow = "truncate";
  if (startsNewConversation && state.mode === "page" && state.pageLength > state.pageContextLimit) {
    overflow = await askOverflowChoice(state.pageLength, state.pageContextLimit);
    if (!overflow) { $("input").focus(); return; }
  }
  const display = prompt || `[Изображения: ${state.images.length}]`;
  const messageContextType = startsNewConversation ? state.mode : "none";
  const displayContext = messageContextType === "selection" ? { type: "selection", selectionText: state.selectionText } : null;
  const images = state.images;
  const imageCount = images.length;
  const imagePreviews = images.map(image => image.previewDataUrl || image.dataUrl).filter(Boolean);
  appendMessage("user", display, { displayContext, contextType: messageContextType, pageLinksIncluded: messageContextType === "page" && state.includePageLinks, pageLinkCount: messageContextType === "page" ? state.pageLinkCount || 0 : 0, imageCount, imagePreviews }); beginAssistant();
  state.images = []; renderAttachments(); $("input").value = ""; autoResize();
  if (startsNewConversation) {
    const context = state.mode === "selection" ? { type: "selection", selectionText: state.selectionText } : { type: state.mode, ...(state.mode === "page" ? { includeLinks: state.includePageLinks, overflow } : {}) };
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
  syncPrimary(); scheduleDraftSave(true); $("input").focus();
}
async function openWindow() {
  const draft = state.isNew ? { ...currentDraft(), mode: "none", selectionText: "" } : null;
  state.transferringTemporary = state.temporary;
  const result = await chrome.runtime.sendMessage({ action: "OPEN_AI_CHAT_WINDOW", tabId: state.tabId, draft });
  if (!result?.ok) { state.transferringTemporary = false; toast(result?.error || "Не удалось открыть отдельное окно"); }
  else if (state.transferringTemporary) setTimeout(() => { state.transferringTemporary = false; }, 2000);
}
function syncPrimary() {
  const button = $("primary"), label = state.generating ? "Остановить (Esc)" : "Отправить";
  button.innerHTML = icon(state.generating ? "stop" : "arrowUp");
  button.classList.toggle("stop", state.generating);
  button.title = label; button.setAttribute("aria-label", label);
}
function enterChatState(title, model, temporary = false, thinking = "none") { state.isNew = false; state.temporary = Boolean(temporary); state.session = { ...(state.session || {}), model: model || state.session?.model || "", thinking }; $("title").textContent = title || "Чат"; $("meta").textContent = model || ""; $("draftControls").classList.add("hidden"); $("chatModel").value = model || ""; $("chatOptions").classList.remove("hidden"); $("chatSettings").classList.add("hidden"); applyChatModelCapability(thinking); $("input").value = ""; autoResize(); updateTemporaryUI(); }
function updateTemporaryUI() {
  document.body.classList.toggle("temporary", state.temporary);
  const button = $("temporary"), label = state.temporary ? "Временный чат: не сохраняется в истории. Нажмите, чтобы отключить" : "Сделать чат временным (не сохранять в истории)";
  button.innerHTML = icon("hourglass"); button.classList.toggle("active", state.temporary);
  button.setAttribute("aria-pressed", String(state.temporary)); button.title = label; button.setAttribute("aria-label", label);
  button.classList.toggle("hidden", !state.isNew && !state.temporary);
  button.disabled = !state.isNew;
}
function applyReasoningCapability(modelId, select, budget, current) { setReasoningOptions(select, state.modelCatalog.find(item => item.id === modelId), current || select.value); budget.classList.toggle("hidden", select.value !== "custom"); }
function applyModelCapability(current) { applyReasoningCapability($("model").value.trim(), $("thinking"), reasoningBudget, current); }
function applyChatModelCapability(current) { applyReasoningCapability($("chatModel").value.trim(), $("chatThinking"), $("chatReasoningBudget"), current); $("chatReasoningBudget").value = Number(state.session?.reasoningMaxTokens) || Number($("chatReasoningBudget").value) || 2000; }
function toggleReasoningBudget() { reasoningBudget.classList.toggle("hidden", $("thinking").value !== "custom"); }

async function prepareFiles(files) { if (state.editing) return toast("При редактировании сохраняются изображения исходного сообщения"); const selectedModel = state.isNew ? $("model").value.trim() : $("chatModel").value.trim(); const model = state.modelCatalog.find(item => item.id === selectedModel); if (model && !model.input_modalities?.includes("image")) return toast("Выбранная модель не поддерживает изображения"); for (const file of files) { if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) { toast("Изображение должно быть меньше 12 МБ"); continue; } try { const [dataUrl, previewDataUrl] = await Promise.all([resizeImage(file, 1800), resizeImage(file, 640, true)]); state.images.push({ name: file.name || "Изображение", dataUrl, previewDataUrl }); } catch (error) { toast(`Не удалось обработать изображение: ${error.message}`); } } renderAttachments(); scheduleDraftSave(true); $("files").value = ""; }
function resizeImage(file, maxSide, preview = false) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => { const image = new Image(); image.onerror = () => reject(new Error("Неподдерживаемое изображение")); image.onload = () => { const scale = Math.min(1, maxSide / Math.max(image.width, image.height)), canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale)); canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL(preview ? "image/webp" : (file.type === "image/png" ? "image/png" : "image/jpeg"), preview ? .76 : .88)); }; image.src = reader.result; }; reader.readAsDataURL(file); }); }
function autoResize() { const input = $("input"); input.style.height = "40px"; if (!input.value) { input.style.overflowY = "hidden"; return; } const height = Math.min(200, Math.max(40, input.scrollHeight)); input.style.height = `${height}px`; input.style.overflowY = input.scrollHeight > 200 ? "auto" : "hidden"; }
function isNearBottom() { const chat = $("chat"); return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60; }
function updateScrollButton() { $("scrollBottom").classList.toggle("hidden", isNearBottom()); }
function scrollDown(force = false) { if (force || state.autoStick) $("chat").scrollTop = $("chat").scrollHeight; updateScrollButton(); }
async function copyText(text, button = null) {
  const copied = await copyToClipboard(text);
  toast(copied ? "Скопировано" : "Не удалось скопировать");
  if (copied && button) { const previous = button.innerHTML; button.innerHTML = icon("check"); setTimeout(() => { button.innerHTML = previous; }, 1200); }
}
function toast(text) { const node = document.createElement("div"); node.className = "toast"; node.textContent = text; $("toasts").append(node); setTimeout(() => node.remove(), 2800); }
function setResponseStatus(node, metadata = {}) { node.classList.remove("generating", "error"); node.dataset.complete = "1"; if (metadata.usage?.total_tokens != null) node.dataset.tokens = String(metadata.usage.total_tokens || 0); if (metadata.cost != null || metadata.usage?.cost != null) node.dataset.cost = String(metadata.cost ?? metadata.usage?.cost); node.dataset.model = metadata.model || state.session?.model || ""; refreshResponseModelLabels(); }
function refreshResponseModelLabels() { const statuses = [...$("chat").querySelectorAll('.message.assistant .status[data-complete="1"]')], models = new Set(statuses.map(node => node.dataset.model).filter(Boolean)), showModels = models.size > 1; for (const node of statuses) { const parts = []; if (node.dataset.tokens != null && node.dataset.tokens !== "") parts.push(`${formatCount(node.dataset.tokens)} токенов`); if (node.dataset.cost != null && node.dataset.cost !== "") parts.push(formatCost(node.dataset.cost, "chat")); if (showModels && node.dataset.model) parts.push(node.dataset.model); node.textContent = parts.join(" · "); } }

// While streaming, a cheap state poll repairs the UI if a DONE/STOPPED event was missed.
async function reconcileGeneration() {
  // The worker needs a moment to register a new request; polling earlier would
  // see the previous finished turn and end the fresh one.
  if (!state.generating || !state.tabId || Date.now() - (state.generationStartedAt || 0) < 3000) return;
  const result = await chrome.runtime.sendMessage({ action: "GET_GENERATION_STATE", tabId: state.tabId }).catch(() => null);
  if (!result?.ok || !state.generating) return;
  if (!result.generating) {
    if (!result.sessionId) return;
    state.generating = false; state.localStartPending = false;
    await loadTab(state.tabId);
    return;
  }
  if (result.partialAnswer.length > state.answer.length || result.partialReasoning.length > state.reasoning.length) { state.answer = result.partialAnswer; state.reasoning = result.partialReasoning; scheduleCurrentUpdate(); }
}

$("primary").addEventListener("click", () => state.generating ? stop() : submit());
$("newChat").addEventListener("click", newChat); $("expand").addEventListener("click", openWindow);
$("history").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }));
$("temporary").addEventListener("click", () => { if (!state.isNew) return; state.temporary = !state.temporary; updateTemporaryUI(); if (!$("chat").querySelector(".message-row")) { $("chat").innerHTML = ""; renderEmptyState(); } scheduleDraftSave(); });
$("attach").addEventListener("click", () => $("files").click()); $("files").addEventListener("change", () => prepareFiles([...$("files").files]));
$("scrollBottom").addEventListener("click", () => { state.autoStick = true; state.userScrollingUntil = 0; $("chat").scrollTo({ top: $("chat").scrollHeight, behavior: "smooth" }); });
$("includePageLinks").addEventListener("change", async () => {
  state.includePageLinks = $("includePageLinks").checked;
  if (state.mode === "page") await previewPage();
  scheduleDraftSave();
  $("input").focus({ preventScroll: true });
});
$("model").addEventListener("change", () => { applyModelCapability(); scheduleDraftSave(); }); $("thinking").addEventListener("change", () => { toggleReasoningBudget(); scheduleDraftSave(); }); reasoningBudget.addEventListener("input", () => scheduleDraftSave());
$("chatOptions").addEventListener("click", () => { const opening = $("chatSettings").classList.contains("hidden"); $("chatSettings").classList.toggle("hidden", !opening); $("chatOptions").classList.toggle("active", opening); $("chatOptions").setAttribute("aria-expanded", String(opening)); });
$("chatModel").addEventListener("change", () => applyChatModelCapability($("chatThinking").value));
$("chatThinking").addEventListener("change", () => $("chatReasoningBudget").classList.toggle("hidden", $("chatThinking").value !== "custom"));
$("cancelEdit").addEventListener("click", () => { cancelEdit(true); $("input").focus({ preventScroll: true }); });
$("imageViewerClose").addEventListener("click", closeImageViewer);
$("imageViewer").addEventListener("click", event => { if (event.target === $("imageViewer")) closeImageViewer(); });
$("input").addEventListener("input", () => { autoResize(); scheduleDraftSave(); }); $("input").addEventListener("paste", event => { const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); prepareFiles(files); } });
$("input").addEventListener("keydown", event => { const send = event.key === "Enter" && !event.isComposing && (state.sendOnEnter ? !event.shiftKey && !event.ctrlKey : event.ctrlKey); if (send) { event.preventDefault(); submit(); } });
$("chat").addEventListener("wheel", () => { state.autoStick = false; state.userScrollingUntil = Date.now() + 700; }, { passive: true });
$("chat").addEventListener("scroll", () => { if (Date.now() > state.userScrollingUntil && isNearBottom()) state.autoStick = true; updateScrollButton(); }, { passive: true });
let dragDepth = 0;
document.addEventListener("dragenter", event => { if ([...(event.dataTransfer?.items || [])].some(item => item.kind === "file")) { event.preventDefault(); dragDepth += 1; $("dropOverlay").classList.remove("hidden"); } });
document.addEventListener("dragover", event => { if ([...(event.dataTransfer?.types || [])].includes("Files")) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; } });
document.addEventListener("dragleave", event => { if (event.relatedTarget) dragDepth = Math.max(0, dragDepth - 1); else dragDepth = 0; if (!dragDepth) $("dropOverlay").classList.add("hidden"); });
document.addEventListener("drop", event => { event.preventDefault(); dragDepth = 0; $("dropOverlay").classList.add("hidden"); const files = [...(event.dataTransfer?.files || [])].filter(file => file.type.startsWith("image/")); if (files.length) prepareFiles(files); else toast("Можно перетащить только изображения"); });
chrome.storage.onChanged?.addListener((changes, areaName) => {
  // The background refreshes the OpenRouter catalog daily.
  if (areaName === "local" && changes.openRouterModels) state.modelCatalog = changes.openRouterModels.newValue || [];
  if (areaName !== "sync") return;
  if (changes.sidePanelTabBehavior) state.tabBehavior = changes.sidePanelTabBehavior.newValue || "keep-current";
  if (changes.sendOnEnter) { state.sendOnEnter = changes.sendOnEnter.newValue !== false; updateComposerHint(); }
  if (changes.pageContextLimit) { state.pageContextLimit = Number(changes.pageContextLimit.newValue) || 60000; if (state.isNew) renderContexts(); }
  if (changes.menuItems) { state.menuItems = changes.menuItems.newValue || []; if (state.isNew && !$("chat").querySelector(".message-row")) { $("chat").innerHTML = ""; renderEmptyState(); } }
});
setInterval(reconcileGeneration, 1500);
document.addEventListener("visibilitychange", () => { if (!document.hidden) reconcileGeneration(); });
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (!$("imageViewer").classList.contains("hidden")) { event.preventDefault(); closeImageViewer(); return; }
  if (state.overflowChoice) { event.preventDefault(); hideOverflowChoice(); $("input").focus({ preventScroll: true }); return; }
  if (state.editing) { event.preventDefault(); cancelEdit(true); $("input").focus({ preventScroll: true }); return; }
  if (state.generating || state.isWindow) event.preventDefault();
  if (state.generating) stop();
  else if (state.isWindow) window.close();
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
  refreshDraftContext();
  if (state.mode === "page") previewPage();
});

function refreshDraftContext() {
  renderContexts();
  if (!$("chat").querySelector(".message-row")) { $("chat").innerHTML = ""; renderEmptyState(); }
}

if (state.isWindow) window.addEventListener("resize", () => { clearTimeout(widthTimer); widthTimer = setTimeout(() => chrome.runtime.sendMessage({ action: "SAVE_AI_CHAT_WINDOW_WIDTH", width: window.outerWidth, compact: state.compactWindow }), 350); });
window.addEventListener("beforeunload", () => {
  if (state.isWindow && state.generating) chrome.runtime.sendMessage({ action: "STOP_AI_CHAT", tabId: state.tabId });
  if (state.temporary && !state.transferringTemporary) chrome.runtime.sendMessage({ action: "FORGET_TEMPORARY_CHAT", tabId: state.tabId });
});

chrome.runtime.onMessage.addListener(message => {
  if (message.action === "AI_SURFACE_OWNER" && message.surfaceOwner === "sidepanel" && message.newChat) {
    if (state.isWindow && message.sourceTabId !== state.tabId) return;
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
    refreshDraftContext(); scheduleDraftSave();
    return;
  }
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
    if (message.reasoningAdjusted) toast(message.reasoningAdjusted);
    if (!state.generating) beginAssistant();
  }
  if (message.action === "AI_CHAT_DELTA") { state.answer += message.content || ""; state.reasoning += message.reasoning || ""; scheduleCurrentUpdate(); }
  if (message.action === "AI_CHAT_META" && message.notice) toast(message.notice);
  if (message.action === "AI_CHAT_DONE") {
    state.generating = false; state.renderedAnswer = null;
    if (typeof message.content === "string") state.answer = message.content;
    if (typeof message.reasoning === "string") state.reasoning = message.reasoning;
    if (!currentAssistant()) { state.localStartPending = false; loadTab(state.tabId); return; }
    scheduleCurrentUpdate(true);
    state.totalCost = Number(message.totalCost) || state.totalCost;
    const bubble = currentAssistant(); if (bubble) setResponseStatus(bubble.querySelector(".status"), { usage: message.usage, cost: message.requestCost, model: message.model || state.currentResponseModel });
    showRetry();
    const model = message.model || state.session?.model || "";
    updateChatMeta(model);
    syncPrimary();
  }
  if (message.action === "AI_CHAT_STOPPED") { state.generating = false; state.localStartPending = false; state.renderedAnswer = null; scheduleCurrentUpdate(true); finishStatus(state.answer ? "Остановлено · ответ неполный" : "Остановлено"); showRetry(); syncPrimary(); }
  if (message.action === "AI_CHAT_ERROR") { state.generating = false; state.localStartPending = false; state.renderedAnswer = null; scheduleCurrentUpdate(true); if (!finishStatus(`Ошибка: ${message.error}`, true)) toast(message.error); showRetry(); syncPrimary(); }
});
