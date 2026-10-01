import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

for (const file of [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_page,
  manifest.side_panel.default_path,
  ...manifest.content_scripts.flatMap(item => [...(item.js || []), ...(item.css || [])])
]) {
  assert.ok(fs.existsSync(path.join(root, file)), `Manifest file is missing: ${file}`);
}

for (const [htmlFile, jsFile, patterns] of [
  ["sidepanel.html", "sidepanel.js", [/\$\("([^"]+)"\)/g]],
  ["popup.html", "popup.js", [/getElementById\("([^"]+)"\)/g]],
  ["options.html", "options.js", [/byId\("([^"]+)"\)/g]],
  ["history.html", "history.js", [/getElementById\("([^"]+)"\)/g]]
]) {
  const html = fs.readFileSync(path.join(root, htmlFile), "utf8");
  const js = fs.readFileSync(path.join(root, jsFile), "utf8");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  assert.equal(ids.size, [...html.matchAll(/\bid="([^"]+)"/g)].length, `${htmlFile} contains duplicate IDs`);
  for (const pattern of patterns) for (const match of js.matchAll(pattern)) assert.ok(ids.has(match[1]), `${jsFile} references missing #${match[1]}`);
}

class ChromeEvent {
  listeners = [];
  addListener(listener) { this.listeners.push(listener); }
}

const syncData = {};
const localData = {};
const sessionData = {};
const area = data => ({
  get(keys, callback) {
    let result = { ...data };
    if (typeof keys === "string") result = { [keys]: data[keys] };
    if (Array.isArray(keys)) result = Object.fromEntries(keys.map(key => [key, data[key]]));
    callback(result);
  },
  set(value, callback = () => {}) { Object.assign(data, value); callback(); },
  remove(key, callback = () => {}) { delete data[key]; callback(); }
});

const createdMenus = [];
const sentMessages = [];
const requests = [];
let lastRequest = null;
let sidePanelCloseCalls = 0;
globalThis.chrome = {
  runtime: { onInstalled: new ChromeEvent(), onStartup: new ChromeEvent(), onMessage: new ChromeEvent(), sendMessage: async message => { if (message?.sourceTabId != null) sentMessages.push({ tabId: message.sourceTabId, message }); return { ok: true }; }, getURL: path => `chrome-extension://test/${path}` },
  contextMenus: { onClicked: new ChromeEvent(), removeAll(callback) { createdMenus.length = 0; callback(); }, create(item) { createdMenus.push(item); } },
  commands: { onCommand: new ChromeEvent() },
  tabs: { onRemoved: new ChromeEvent(), query: async () => [], get: async id => ({ id, windowId: 1 }), sendMessage: async (tabId, message) => { sentMessages.push({ tabId, message }); return { ok: true }; } },
  scripting: { insertCSS: async () => {}, executeScript: async () => {} },
  sidePanel: { open: async () => {}, close: async () => { sidePanelCloseCalls++; }, setOptions: async () => {} },
  windows: { onRemoved: new ChromeEvent(), getCurrent: async () => ({ id: 1, width: 1200 }), create: async () => ({ id: 99 }) },
  storage: { sync: area(syncData), local: area(localData), session: area(sessionData) },
  alarms: { onAlarm: new ChromeEvent(), created: [], cleared: [], create(name) { this.created.push(name); }, clear(name) { this.cleared.push(name); } }
};

await import(`${pathToFileURL(path.join(root, "background.js"))}?smoke=${Date.now()}`);
assert.equal(chrome.runtime.onInstalled.listeners.length, 1);
assert.equal(chrome.runtime.onMessage.listeners.length, 1);
assert.equal(chrome.contextMenus.onClicked.listeners.length, 1);
assert.equal(chrome.commands.onCommand.listeners.length, 1);

await chrome.runtime.onInstalled.listeners[0]();
assert.ok(createdMenus.some(item => item.id === "ai-ask-selection"));
assert.ok(createdMenus.some(item => item.id === "ai-summarize-page"));
assert.equal(syncData.quickModel, "openrouter/auto");
assert.equal(syncData.sidePanelTabBehavior, "keep-current");
assert.ok(chrome.alarms.created.includes("daily-refresh"), "Daily refresh alarm is scheduled");
assert.ok(chrome.alarms.cleared.includes("usd-rub-rate"), "Legacy rate alarm is removed");

const originalQuery = chrome.tabs.query;
const originalSendMessage = chrome.tabs.sendMessage;
chrome.tabs.query = async () => [{ id: 20, windowId: 1 }];
chrome.tabs.sendMessage = async (tabId, message) => {
  sentMessages.push({ tabId, message });
  if (message.action === "GET_AI_SELECTION") return { selectionText: "Выделенный фрагмент" };
  return { ok: true };
};
await chrome.commands.onCommand.listeners[0]("ask-ai", { id: 20, windowId: 1 });
const hotkeyDraft = await new Promise(resolve => chrome.runtime.onMessage.listeners[0]({ action: "GET_ACTIVE_AI_CHAT", tabId: 20 }, {}, resolve));
assert.equal(hotkeyDraft.draft.mode, "selection");
assert.equal(hotkeyDraft.draft.selectionText, "Выделенный фрагмент");
chrome.tabs.query = originalQuery;
chrome.tabs.sendMessage = originalSendMessage;

syncData.apiKey = "test-key";
globalThis.fetch = async (url, init) => {
  if (!init?.body && String(url).includes("/models")) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  lastRequest = { url, init };
  requests.push(lastRequest);
  const requestBody = JSON.parse(init.body);
  if (requestBody.model === "mandatory/model" && requestBody.reasoning?.effort === "none") {
    return new Response(JSON.stringify({ error: { message: "Reasoning is mandatory for this endpoint and cannot be disabled." } }), { status: 400 });
  }
  const events = [
    { choices: [{ delta: { reasoning: "Проверяю. " } }] },
    { choices: [{ delta: { content: "Готово" } }] },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.001, prompt_tokens_details: { cached_tokens: 4 } } }
  ];
  const sse = `${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream", "X-OpenRouter-Cache-Status": "MISS" } });
};

await chrome.contextMenus.onClicked.listeners[0]({ menuItemId: "ai-template-1", selectionText: "СЕКРЕТНЫЙ КОНТЕКСТ" }, { id: 21, windowId: 1 });
for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 21 && item.message.action === "AI_CHAT_DONE"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const templateState = await new Promise(resolve => chrome.runtime.onMessage.listeners[0]({ action: "GET_ACTIVE_AI_CHAT", tabId: 21 }, {}, resolve));
const templateUser = templateState.session.messages.find(message => message.role === "user");
assert.ok(!templateUser.displayText.includes("СЕКРЕТНЫЙ КОНТЕКСТ"));
assert.equal(templateUser.displayContext.selectionText, "СЕКРЕТНЫЙ КОНТЕКСТ");
assert.ok(sentMessages.some(item => item.tabId === 21 && item.message.action === "AI_CHAT_STARTED" && item.message.userPrompt === templateUser.displayText));
const templateEditDoneBefore = sentMessages.filter(item => item.tabId === 21 && item.message.action === "AI_CHAT_DONE").length;
await new Promise(resolve => chrome.runtime.onMessage.listeners[0]({ action: "EDIT_AI_MESSAGE", tabId: 21, userTurnIndex: 0, prompt: "Новая инструкция", model: "openrouter/auto", source: "sidepanel" }, {}, resolve));
for (let attempt = 0; attempt < 50 && sentMessages.filter(item => item.tabId === 21 && item.message.action === "AI_CHAT_DONE").length === templateEditDoneBefore; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const editedTemplateState = await new Promise(resolve => chrome.runtime.onMessage.listeners[0]({ action: "GET_ACTIVE_AI_CHAT", tabId: 21 }, {}, resolve));
const editedTemplateUser = editedTemplateState.session.messages.find(message => message.role === "user");
assert.ok(editedTemplateUser.content.includes("СЕКРЕТНЫЙ КОНТЕКСТ"));
assert.ok(editedTemplateUser.content.endsWith("Новая инструкция"));

const messageListener = chrome.runtime.onMessage.listeners[0];
const startResponse = await new Promise(resolve => messageListener({
  action: "START_AI_CHAT",
  prompt: "Первая строка\nВторая строка",
  model: "openrouter/auto",
  thinking: "on",
  context: { type: "none" }
}, { tab: { id: 7 } }, resolve));
assert.deepEqual(startResponse, { ok: true });

for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 7 && item.message.action === "AI_CHAT_DONE"); attempt++) {
  await new Promise(resolve => setTimeout(resolve, 10));
}
assert.ok(sentMessages.some(item => item.message.action === "AI_CHAT_DELTA" && item.message.content === "Готово"));
assert.ok(sentMessages.some(item => item.message.action === "AI_CHAT_DELTA" && item.message.reasoning === "Проверяю. "));
assert.ok(sentMessages.some(item => item.message.action === "AI_CHAT_DONE"));
assert.ok(sentMessages.some(item => item.message.action === "AI_CHAT_DONE" && item.message.content === "Готово" && item.message.reasoning === "Проверяю. "));
const requestBody = JSON.parse(lastRequest.init.body);
assert.equal(requestBody.messages.at(-1).content, "Первая строка\nВторая строка");
assert.equal(requestBody.reasoning.effort, "medium");
assert.ok(requestBody.session_id.startsWith("aitt-"));
assert.equal(lastRequest.init.headers["X-OpenRouter-Cache"], "true");
assert.equal(localData.chats[0].messages.at(-1).content, "Готово");
assert.equal(localData.chats[0].messages.find(message => message.role === "user").displayText, "Первая строка\nВторая строка");

await new Promise(resolve => messageListener({ action: "START_AI_CHAT", prompt: "По выделению", model: "openrouter/auto", thinking: "none", context: { type: "selection", selectionText: "Контекст выделения" } }, { tab: { id: 22 } }, resolve));
for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 22 && item.message.action === "AI_CHAT_DONE"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const selectionState = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 22 }, {}, resolve));
assert.equal(selectionState.session.messages.find(message => message.role === "user").displayContext.selectionText, "Контекст выделения");
const editedDoneBefore = sentMessages.filter(item => item.tabId === 22 && item.message.action === "AI_CHAT_DONE").length;
await new Promise(resolve => messageListener({ action: "EDIT_AI_MESSAGE", tabId: 22, userTurnIndex: 0, prompt: "Новый вопрос по тому же контексту", model: "openrouter/auto", thinking: "low", reasoningMaxTokens: 2500, source: "sidepanel" }, {}, resolve));
for (let attempt = 0; attempt < 50 && sentMessages.filter(item => item.tabId === 22 && item.message.action === "AI_CHAT_DONE").length === editedDoneBefore; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const editedState = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 22 }, {}, resolve));
assert.equal(editedState.session.messages.filter(message => message.role === "user").length, 1);
assert.equal(editedState.session.messages.filter(message => message.role === "assistant").length, 1);
assert.equal(editedState.session.messages.find(message => message.role === "user").displayText, "Новый вопрос по тому же контексту");
assert.ok(editedState.session.messages.find(message => message.role === "user").content.includes("Контекст выделения"));
assert.ok(editedState.session.messages.find(message => message.role === "user").content.endsWith("Новый вопрос по тому же контексту"));
assert.equal(editedState.session.thinking, "low");

await new Promise(resolve => messageListener({ action: "START_AI_CHAT", prompt: "По странице", model: "openrouter/auto", thinking: "none", context: { type: "page", pageText: "Текст страницы", pageTitle: "Страница", pageUrl: "https://example.test", includeLinks: true, pageLinks: [{ text: "Документация", url: "https://example.test/docs" }] } }, { tab: { id: 23 } }, resolve));
for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 23 && item.message.action === "AI_CHAT_DONE"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const pageState = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 23 }, {}, resolve));
const pageUser = pageState.session.messages.find(message => message.role === "user");
assert.equal(pageUser.displayContext, null);
assert.equal(pageUser.contextType, "page");
assert.equal(pageUser.pageLinksIncluded, true);
assert.equal(pageUser.pageLinkCount, 1);
assert.ok(pageUser.content.includes("Документация: https://example.test/docs"));

const secondStart = await new Promise(resolve => messageListener({ action: "START_AI_CHAT", prompt: "Без thinking", model: "mandatory/model", thinking: "off", context: { type: "none" } }, { tab: { id: 8 } }, resolve));
assert.deepEqual(secondStart, { ok: true });
for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 8 && item.message.action === "AI_CHAT_DONE"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const mandatoryRequests = requests.filter(item => JSON.parse(item.init.body).model === "mandatory/model");
assert.equal(mandatoryRequests.length, 2);
assert.deepEqual(JSON.parse(mandatoryRequests[1].init.body).reasoning, { enabled: true, exclude: true });
assert.equal(localData.openRouterModels.find(model => model.id === "mandatory/model").reasoning.mandatory, true);
assert.ok(sentMessages.some(item => item.tabId === 8 && item.message.notice?.includes("автоматически")));

localData.openRouterModels.push({ id: "image/model", name: "Image model", input_modalities: ["text", "image"], output_modalities: ["text"], supported_parameters: [], pricing: {} });
await new Promise(resolve => messageListener({ action: "START_AI_CHAT", prompt: "Опиши", model: "image/model", thinking: "off", context: { type: "none" }, images: [{ dataUrl: "data:image/png;base64,AAA", previewDataUrl: "data:image/jpeg;base64,PREVIEW_A" }, { dataUrl: "data:image/jpeg;base64,BBB", previewDataUrl: "data:image/jpeg;base64,PREVIEW_B" }] }, { tab: { id: 9 } }, resolve));
for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 9 && item.message.action === "AI_CHAT_DONE"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const imageBody = JSON.parse(requests.filter(item => JSON.parse(item.init.body).model === "image/model").at(-1).init.body);
assert.equal(imageBody.messages.at(-1).content.filter(part => part.type === "image_url").length, 2);
assert.equal(imageBody.messages.at(-1).content[1].image_url.url, "data:image/png;base64,AAA");
assert.equal(localData.chats.find(chat => chat.model === "image/model").totalCost, 0.001);
const imageState = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 9 }, {}, resolve));
assert.equal(imageState.session.messages.find(message => message.role === "user").imageCount, 2);
assert.equal(imageState.session.messages.find(message => message.role === "user").imagePreviews.length, 2);
assert.equal(localData.chats.find(chat => chat.model === "image/model").messages.find(message => message.role === "user").imagePreviews[0], "data:image/jpeg;base64,PREVIEW_A");

const continuedDoneBefore = sentMessages.filter(item => item.tabId === 9 && item.message.action === "AI_CHAT_DONE").length;
await new Promise(resolve => messageListener({ action: "CONTINUE_AI_CHAT", tabId: 9, prompt: "Продолжи иначе", model: "openrouter/auto", source: "sidepanel" }, { tab: { id: 909 } }, resolve));
for (let attempt = 0; attempt < 50 && sentMessages.filter(item => item.tabId === 9 && item.message.action === "AI_CHAT_DONE").length === continuedDoneBefore; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const switchedState = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 9 }, {}, resolve));
assert.equal(switchedState.session.messages.at(-1).model, "openrouter/auto");
assert.equal(switchedState.session.messages.at(-1).modelChanged, true);
assert.equal(switchedState.session.messages.filter(message => message.role === "user").at(-1).contextType, undefined);
assert.deepEqual(switchedState.session.messages.filter(message => message.role === "assistant").map(message => message.model), ["image/model", "openrouter/auto"]);
assert.equal(sessionData.chat_909, undefined, "An extension popup must continue the explicitly selected page chat");
assert.ok(sentMessages.some(item => item.tabId === 9 && item.message.action === "AI_CHAT_DONE" && item.message.modelChanged && item.message.model === "openrouter/auto"));

const regenRequestCount = requests.length;
await new Promise(resolve => messageListener({ action: "REGENERATE_AI_CHAT", tabId: 9, model: "openrouter/auto", source: "sidepanel" }, {}, resolve));
for (let attempt = 0; attempt < 50 && requests.length === regenRequestCount; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const regenerationBody = JSON.parse(requests.at(-1).init.body);
assert.equal(regenerationBody.temperature, 1);
assert.ok(regenerationBody.messages.at(-1).content.includes("Дай новый вариант ответа"));
const regeneratedState = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 9 }, {}, resolve));
assert.equal(regeneratedState.session.messages.filter(message => message.role === "user").at(-1).content, "Продолжи иначе");

await new Promise(resolve => messageListener({ action: "START_AI_CHAT", tabId: 10, source: "sidepanel", prompt: "Из панели", model: "image/model", thinking: "off", context: { type: "none" } }, {}, resolve));
for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 10 && item.message.action === "AI_CHAT_DONE"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
assert.ok(sentMessages.some(item => item.tabId === 10 && item.message.action === "AI_CHAT_STARTED" && item.message.surface === "sidepanel"));
const reopenedPanel = await new Promise(resolve => messageListener({ action: "OPEN_SIDE_PANEL_FROM_POPUP", targetTabId: 10, panelAlreadyOpen: true }, {}, resolve));
assert.equal(reopenedPanel.ok, true);
const reopenedPanelState = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 10 }, {}, resolve));
assert.equal(reopenedPanelState.session, null);
assert.equal(reopenedPanelState.draft.prompt, "");

const draft = { prompt: "Черновик", model: "image/model", thinking: "off", mode: "page", images: [{ dataUrl: "data:image/png;base64,AAA" }] };
await new Promise(resolve => messageListener({ action: "SAVE_AI_DRAFT", tabId: 12, draft }, {}, resolve));
const draftState = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 12 }, {}, resolve));
assert.deepEqual(draftState.draft, draft);
await new Promise(resolve => messageListener({ action: "RESET_AI_CHAT", tabId: 12 }, {}, resolve));
const resetState = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 12 }, {}, resolve));
assert.equal(resetState.draft, null);
assert.equal(resetState.session, null);

localData.openRouterModels.push({ id: "text/model", name: "Text model", input_modalities: ["text"], output_modalities: ["text"], supported_parameters: [], pricing: {} });
await new Promise(resolve => messageListener({ action: "START_AI_CHAT", prompt: "Картинка", model: "text/model", thinking: "off", context: { type: "none" }, images: [{ dataUrl: "data:image/png;base64,AAA" }] }, { tab: { id: 11 } }, resolve));
for (let attempt = 0; attempt < 30 && !sentMessages.some(item => item.tabId === 11 && item.message.action === "AI_CHAT_ERROR"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const unsupportedState = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 11 }, {}, resolve));
assert.equal(unsupportedState.generating, false);
assert.ok(sentMessages.some(item => item.tabId === 11 && item.message.error?.includes("не поддерживает изображения")));

localData.openRouterModels.push({ id: "reasoning/model", name: "Reasoning model", input_modalities: ["text"], output_modalities: ["text"], supported_parameters: ["reasoning"], reasoning: { supported_efforts: ["low", "high"], supports_max_tokens: true }, pricing: {} });
await new Promise(resolve => messageListener({ action: "START_AI_CHAT", prompt: "Сложная задача", model: "reasoning/model", thinking: "custom", reasoningMaxTokens: 3456, context: { type: "none" } }, { tab: { id: 14 } }, resolve));
for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 14 && item.message.action === "AI_CHAT_DONE"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const customBody = JSON.parse(requests.filter(item => JSON.parse(item.init.body).model === "reasoning/model").at(-1).init.body);
assert.deepEqual(customBody.reasoning, { max_tokens: 3456, exclude: false });

const historyCountBeforeTemporary = localData.chats.length;
await new Promise(resolve => messageListener({ action: "START_AI_CHAT", prompt: "Не сохранять", model: "openrouter/auto", thinking: "none", temporary: true, context: { type: "none" } }, { tab: { id: 15 } }, resolve));
for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 15 && item.message.action === "AI_CHAT_DONE"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(localData.chats.length, historyCountBeforeTemporary);
assert.equal(sessionData.chat_15.temporary, true);
const temporaryWindow = await new Promise(resolve => messageListener({ action: "OPEN_AI_CHAT_WINDOW", tabId: 15 }, {}, resolve));
assert.equal(temporaryWindow.ok, true);
assert.equal(chrome.windows.onRemoved.listeners.length, 1);
await chrome.windows.onRemoved.listeners[0](99);
const forgottenTemporary = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 15 }, {}, resolve));
assert.equal(forgottenTemporary.session, null);

localData.chats.push({ id: "delete-me", title: "Удалить", messages: [] });
localData.history = [{ chatId: "legacy-delete", query: "Старый запрос" }];
sessionData.chat_777 = { id: "delete-me", messages: [] };
const deleteResult = await new Promise(resolve => messageListener({ action: "DELETE_SAVED_AI_CHATS", chatIds: ["delete-me", "legacy-delete"] }, {}, resolve));
assert.equal(deleteResult.ok, true);
assert.ok(!localData.chats.some(chat => chat.id === "delete-me"));
assert.equal(localData.history.length, 0);
assert.equal(sessionData.chat_777.historyDisabled, true);

const streamingFetch = globalThis.fetch;
const encoder = new TextEncoder();
globalThis.fetch = async (url, init) => {
  const lastContent = JSON.parse(init?.body || "{}").messages?.at(-1)?.content;
  if (lastContent === "Медленно") {
    requests.push({ url, init });
    return new Response(new ReadableStream({ start(stream) {
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Частично" } }] })}\n\n`));
      init.signal.addEventListener("abort", () => stream.error(new DOMException("Aborted", "AbortError")));
    } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  if (lastContent === "Без перевода строки") {
    requests.push({ url, init });
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: "Ответ" } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { total_tokens: 5, cost: 0.002 } })}`;
    return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  return streamingFetch(url, init);
};

await new Promise(resolve => messageListener({ action: "START_AI_CHAT", prompt: "Медленно", model: "openrouter/auto", thinking: "none", context: { type: "none" } }, { tab: { id: 16 } }, resolve));
for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 16 && item.message.action === "AI_CHAT_DELTA"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
await new Promise(resolve => messageListener({ action: "STOP_AI_CHAT", tabId: 16 }, {}, resolve));
for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 16 && item.message.action === "AI_CHAT_STOPPED"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
const stoppedState = await new Promise(resolve => messageListener({ action: "GET_ACTIVE_AI_CHAT", tabId: 16 }, {}, resolve));
assert.equal(stoppedState.generating, false);
assert.equal(stoppedState.session.messages.at(-1).role, "assistant");
assert.equal(stoppedState.session.messages.at(-1).content, "Частично");
assert.equal(stoppedState.session.messages.at(-1).interrupted, "stopped");
assert.equal(localData.chats.find(chat => chat.id === stoppedState.session.id).messages.at(-1).interrupted, "stopped");

await new Promise(resolve => messageListener({ action: "START_AI_CHAT", prompt: "Без перевода строки", model: "openrouter/auto", thinking: "none", context: { type: "none" } }, { tab: { id: 17 } }, resolve));
for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === 17 && item.message.action === "AI_CHAT_DONE"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(sentMessages.find(item => item.tabId === 17 && item.message.action === "AI_CHAT_DONE").message.requestCost, 0.002);
globalThis.fetch = streamingFetch;

await chrome.runtime.onInstalled.listeners[0]();
assert.equal(localData.apiKey, "test-key");
assert.equal(syncData.apiKey, undefined);

// Long pages: truncated to the limit by default, sent in full only when the panel asked for it.
const longPage = "Очень длинная страница. ".repeat(3500).trim();
const pageSendMessage = chrome.tabs.sendMessage;
chrome.tabs.sendMessage = async (tabId, message) => {
  if (message.action === "GET_AI_PAGE_CONTEXT") return { pageText: longPage, pageTitle: "Длинная", pageUrl: "https://example.test/long", pageLinks: [] };
  return pageSendMessage(tabId, message);
};
for (const [tabId, overflow] of [[30, undefined], [31, "full"]]) {
  await new Promise(resolve => messageListener({ action: "START_AI_CHAT", tabId, prompt: "Суть", model: "openrouter/auto", thinking: "none", context: { type: "page", overflow }, source: "sidepanel" }, {}, resolve));
  for (let attempt = 0; attempt < 50 && !sentMessages.some(item => item.tabId === tabId && item.message.action === "AI_CHAT_DONE"); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
}
const truncatedUser = JSON.parse(requests.find(item => JSON.parse(item.init.body).messages.at(-1).content.includes("Длинная") && !JSON.parse(item.init.body).messages.at(-1).content.includes(longPage)).init.body).messages.at(-1).content;
assert.ok(truncatedUser.includes("[Текст страницы обрезан расширением: 60000 из"));
assert.ok(sentMessages.some(item => item.tabId === 30 && item.message.notice?.includes("обрезан")));
assert.ok(requests.some(item => JSON.parse(item.init.body).messages.at(-1).content.includes(longPage)), "overflow: full keeps the whole page");
assert.ok(!sentMessages.some(item => item.tabId === 31 && item.message.notice?.includes("обрезан")));
chrome.tabs.sendMessage = pageSendMessage;

// USD → RUB rate: selected source first, the other one as a fallback, manual needs no request.
const chatFetch = globalThis.fetch;
const rateRequests = [];
let cbrStatus = 200;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("cbr-xml-daily")) {
    rateRequests.push("cbr");
    return new Response(JSON.stringify({ Date: "2026-09-30T11:30:00+03:00", Valute: { USD: { Nominal: 1, Value: 84.4283 } } }), { status: cbrStatus });
  }
  if (String(url).includes("open.er-api.com")) {
    rateRequests.push("er-api");
    return new Response(JSON.stringify({ result: "success", time_last_update_unix: 1790726551, rates: { RUB: 84.06 } }), { status: 200 });
  }
  return chatFetch(url, init);
};
const cbrRate = await new Promise(resolve => messageListener({ action: "REFRESH_USD_RUB_RATE" }, {}, resolve));
assert.equal(cbrRate.ok, true);
assert.equal(localData.usdRubRate.rate, 84.4283);
assert.equal(localData.usdRubRate.source, "cbr");
cbrStatus = 503;
const fallbackRate = await new Promise(resolve => messageListener({ action: "REFRESH_USD_RUB_RATE", source: "cbr" }, {}, resolve));
assert.equal(fallbackRate.rate.source, "er-api", "Falls back to the second source");
assert.equal(localData.usdRubRate.rate, 84.06);
const requestsBeforeManual = rateRequests.length;
await new Promise(resolve => messageListener({ action: "REFRESH_USD_RUB_RATE", source: "manual" }, {}, resolve));
assert.equal(rateRequests.length, requestsBeforeManual, "Manual rate never hits the network");

// The daily alarm refetches the OpenRouter catalog only once it is older than 20 h.
let catalogRequests = 0;
globalThis.fetch = async (url, init) => {
  if (!init?.body && String(url).includes("/models")) {
    catalogRequests++;
    return new Response(JSON.stringify({ data: [{ id: "fresh/model", name: "Fresh", pricing: { prompt: "0.000001", completion: "0.000002" } }] }), { status: 200 });
  }
  return chatFetch(url, init);
};
const fireDailyAlarm = async () => { chrome.alarms.onAlarm.listeners.forEach(listener => listener({ name: "daily-refresh" })); await new Promise(resolve => setTimeout(resolve, 30)); };
localData.openRouterModelsUpdatedAt = Date.now() - 60 * 60 * 1000;
await fireDailyAlarm();
assert.equal(catalogRequests, 0, "A fresh catalog is not refetched");
const catalogBeforeRefresh = localData.openRouterModels;
localData.openRouterModelsUpdatedAt = Date.now() - 21 * 60 * 60 * 1000;
await fireDailyAlarm();
assert.equal(catalogRequests, 1, "A day-old catalog is refetched");
assert.deepEqual(localData.openRouterModels.map(model => model.id), ["fresh/model"]);
assert.ok(Date.now() - localData.openRouterModelsUpdatedAt < 5000);
localData.openRouterModels = catalogBeforeRefresh;
globalThis.fetch = chatFetch;
assert.ok(manifest.permissions.includes("alarms"));

const commonCode = fs.readFileSync(path.join(root, "common.js"), "utf8");
const currencyHelpers = [
  commonCode.match(/function money[\s\S]*?\n}/)[0],
  commonCode.match(/function rublesEnabled[\s\S]*?\nfunction formatCost[\s\S]*?\n}/)[0]
].join("\n");
const makeFormatter = state => new Function(`let currencyState = ${JSON.stringify(state)}; ${currencyHelpers}; return formatCost;`)();
assert.equal(makeFormatter({ showRub: false, rate: 84 })(0.0041), "$0.0041");
assert.equal(makeFormatter({ showRub: true, rate: 0 })(0.5), "$0.50", "Without a rate costs stay in dollars");
assert.equal(makeFormatter({ showRub: true, rubDisplay: "both", rate: 84 })(0.0041), "0,34 ₽ ($0.0041)");
assert.equal(makeFormatter({ showRub: true, rubDisplay: "rub", rate: 84 })(2), "168,00 ₽");
assert.equal(makeFormatter({ showRub: true, rubDisplay: "rub", rate: 84 })(0.00001), "0,00084 ₽");
assert.equal(makeFormatter({ showRub: true, rubDisplay: "rub", rate: 84, places: { chat: false } })(2, "chat"), "$2.00", "Rubles can be turned off per place");
assert.equal(makeFormatter({ showRub: true, rubDisplay: "rub", rate: 84, places: { chat: false } })(2, "popup"), "168,00 ₽");

// Model prices are per 1M tokens and must be converted with the rate.
const priceSource = commonCode.match(/function modelPrice[\s\S]*?\n}/)[0];
const makePricer = state => new Function(`let currencyState = ${JSON.stringify(state)}; ${currencyHelpers}; ${priceSource}; return modelPrice;`)();
const pricedModel = { pricing: { prompt: "0.000003", completion: "0.000015" } };
assert.equal(makePricer({ showRub: false, rate: 84 })(pricedModel), "$3.00 / $15.00");
assert.equal(makePricer({ showRub: true, rate: 84 })(pricedModel).replace(/\s/g, " "), "252,00 ₽ / 1 260,00 ₽");
assert.equal(makePricer({ showRub: true, rate: 84, places: { models: false } })(pricedModel), "$3.00 / $15.00");
assert.equal(makePricer({ showRub: true, rate: 84 })({ pricing: { prompt: "0", completion: "0" } }), "бесплатно");

// Favorite models are pinned above recent ones, which are above the catalog.
const groupSource = commonCode.match(/function groupModels[\s\S]*?\n}/)[0];
const makeGrouper = prefs => new Function(`const modelPrefs = ${JSON.stringify(prefs)}; ${groupSource}; return groupModels;`)();
const pickerCatalog = ["a/one", "b/two", "c/three", "d/four"].map(id => ({ id, name: id }));
const grouper = makeGrouper({ favorites: ["c/three", "x/custom"], recent: ["b/two", "c/three"] });
const browse = grouper(pickerCatalog);
assert.deepEqual(browse.map(group => group.label), ["Избранные", "Недавние", "Все модели"]);
assert.deepEqual(browse.map(group => group.models.map(model => model.id)), [["c/three", "x/custom"], ["b/two"], ["a/one", "d/four"]], "Favorites outside the catalog stay selectable");
const search = grouper(pickerCatalog.filter(model => /three|four/.test(model.id)), { searching: true });
assert.deepEqual(search.map(group => [group.label, group.models.map(model => model.id)]), [["Избранные", ["c/three"]], ["Остальные", ["d/four"]]]);
assert.deepEqual(makeGrouper({ favorites: [], recent: [] })(pickerCatalog).map(group => group.label), [""], "No headings without favorites or recents");
assert.equal(grouper(pickerCatalog, { limit: 4 }).flatMap(group => group.models).length, 4);

const read = file => fs.readFileSync(path.join(root, file), "utf8");
const contentSource = read("content.js");
const commonSource = read("common.js");
const themeSource = read("theme.css");
const sidePanelHtml = read("sidepanel.html");
const sidePanelSource = `${read("sidepanel.js")}\n${commonSource}`;
const historySource = `${read("history.js")}\n${commonSource}`;
const popupSource = read("popup.js");

// Content script: context extraction only, no chat UI injected into pages.
assert.ok(!contentSource.includes("marked"), "Content script must not render chat UI");
assert.ok(!manifest.content_scripts[0].js.includes("marked.min.js"));
assert.ok(!manifest.content_scripts[0].css);
assert.ok(contentSource.includes('case "GET_AI_SELECTION"'));
assert.ok(contentSource.includes("function extractPageLinks"));
assert.ok(contentSource.includes("CONTENT_SCRIPT_VERSION = chrome.runtime.getManifest().version"));
assert.ok(contentSource.includes("function disconnectOrphanedContentScript"));
assert.ok(contentSource.includes("globalThis.chrome?.runtime"));
assert.ok(contentSource.includes("hasOpenPanel"), "Selection is published only while a panel is open");
assert.ok(!contentSource.includes('chrome.runtime.sendMessage({ action: "AI_SELECTION_CHANGED"'));
assert.ok(manifest.permissions.includes("unlimitedStorage"));
assert.ok(manifest.content_security_policy.extension_pages.includes("img-src 'self' data: blob:"));

// Every page shares the theme and helpers; tokens are defined for both palettes.
for (const page of ["sidepanel.html", "popup.html", "history.html", "options.html"]) {
  const html = read(page);
  assert.ok(html.includes('href="theme.css"'), `${page} must use theme.css`);
  assert.ok(html.indexOf('src="common.js"') > 0 && html.indexOf('src="common.js"') < html.indexOf("</head>"), `${page} must load common.js in <head> to avoid a theme flash`);
  assert.ok(!/body\.light/.test(html), `${page} must use theme tokens instead of body.light overrides`);
}
const tokenBlock = selector => themeSource.slice(themeSource.indexOf(selector)).match(/\{([\s\S]*?)\n\}/)[1];
const tokenNames = block => new Set([...block.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
const darkTokens = tokenNames(tokenBlock(':root[data-theme="dark"]'));
const lightTokens = tokenNames(tokenBlock(':root[data-theme="light"]'));
for (const token of lightTokens) assert.ok(darkTokens.has(token), `Light token ${token} has no dark counterpart`);
for (const file of ["theme.css", "sidepanel.html", "popup.html", "history.html", "options.html"]) {
  for (const [, token] of read(file).matchAll(/var\((--[\w-]+)/g)) assert.ok(darkTokens.has(token), `${file} uses undefined token ${token}`);
}
for (const name of ["copy", "edit", "refresh", "sun", "moon", "monitor", "arrowUp", "stop", "trash", "hourglass"]) assert.ok(commonSource.includes(`  ${name}: '`), `Icon ${name} is missing`);

assert.ok(read("options.html").includes("Используется только при Reasoning → Custom"));
assert.ok(read("options.html").includes('<option value="system">Как в системе</option>'));
assert.ok(sidePanelHtml.includes('id="temporary"'));
assert.ok(sidePanelHtml.includes('id="includePageLinks"'));
assert.ok(sidePanelHtml.includes('id="overflowBar"'));
assert.ok(sidePanelHtml.includes('id="scrollBottom"'));
assert.ok(fs.existsSync(path.join(root, "vendor", "katex", "katex.min.js")));
assert.ok(fs.existsSync(path.join(root, "vendor", "katex", "katex.min.css")));
assert.ok(!fs.existsSync(path.join(root, "vendor", "katex", "katex.js")), "Unminified KaTeX is not shipped");
const katex = (await import(`${pathToFileURL(path.join(root, "vendor", "katex", "katex.min.js"))}?test=${Date.now()}`)).default;
assert.ok(katex.renderToString("x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", { throwOnError: false }).includes("katex"));
assert.ok(sidePanelHtml.includes("vendor/katex/katex.min.js"));

// Markdown helpers live in common.js and are shared by the side panel and history.
assert.ok(commonSource.includes("renderMathInElement"));
const mathHelpers = commonSource.match(/function normalizeMathSource[\s\S]*?function looksLikeMath[^\n]+/)[0];
const normalizeMathSource = new Function(`${mathHelpers}; return normalizeMathSource;`)();
assert.ok(normalizeMathSource("[ ax^2 + bx + c = 0 ]").includes("$$"));
assert.ok(normalizeMathSource("\\[ x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a} \\]").includes("$$"));
const boundaryHelper = sidePanelSource.match(/function streamingBoundary[\s\S]*?\n}\n\nfunction renderStreamingAnswer/)[0].replace(/\nfunction renderStreamingAnswer$/, "");
const streamingBoundary = new Function(`${boundaryHelper}; return streamingBoundary;`)();
const streamedMarkdown = "Введение\n\n```js\nconst x = 1;\n\nconsole.log(x);\n```\n\nХвост";
assert.equal(streamedMarkdown.slice(streamingBoundary(streamedMarkdown)), "Хвост");
assert.ok(sidePanelSource.includes("safeMarkdown(stableText.slice(state.streamStableText.length), false)"));
assert.ok(sidePanelSource.includes('const messageContextType = startsNewConversation ? state.mode : "none"'));
assert.ok(commonSource.includes('node.target = "_blank"'));
assert.ok(commonSource.includes('node.rel = "noopener noreferrer"'));
assert.ok(commonSource.includes("['http:', 'https:'].includes(url.protocol)"));
assert.ok(commonSource.includes("function replaceRemoteImage"));
assert.ok(sidePanelSource.includes("setTimeout(() => { renderTimer = null; updateCurrent(); }, 28)"));
assert.ok(sidePanelSource.includes('action: "GET_GENERATION_STATE"'), "Streaming reconciliation uses the lightweight state poll");
assert.ok(sidePanelSource.includes('action: "RUN_AI_PROMPT"'));
for (const id of ["chatModel", "chatThinking", "chatOptions", "imageViewer", "editBar"]) assert.ok(sidePanelHtml.includes(`id="${id}"`));
assert.ok(!sidePanelHtml.includes('id="insertPrompt"'));
assert.ok(!sidePanelHtml.includes('id="promptMenu"'));
assert.ok(!sidePanelHtml.includes("<datalist"), "Model selection uses the searchable picker");
assert.ok(sidePanelSource.includes("openImageViewer"));
assert.ok(sidePanelSource.includes("models.size > 1"));
assert.ok(!sidePanelSource.includes("parts.push(`всего $"));
assert.ok(sidePanelSource.includes('document.addEventListener("drop"'));
assert.ok(sidePanelSource.includes('state.tabBehavior === "keep-current"'));
assert.ok(sidePanelSource.includes("contextSpoiler"));
assert.ok(sidePanelSource.includes("row.append(bubble, tools)"));
assert.ok(sidePanelSource.includes("requestAnimationFrame(() => $(\"input\").focus())"));
assert.ok(sidePanelSource.includes('wrap.className = "code-wrap"'));
assert.ok(sidePanelSource.includes("constrainTableColumns(table)"));
assert.ok(!sidePanelSource.includes('querySelector(".reasoning")?.removeAttribute("open")'));
assert.ok(sidePanelHtml.includes("flex-wrap:wrap"));
assert.ok(sidePanelHtml.includes("height:40px;min-height:40px"));
assert.ok(sidePanelHtml.includes(".message-row{flex:0 0 auto"));
assert.ok(sidePanelHtml.includes("flex-direction:column;align-items:flex-start"));
assert.ok(sidePanelHtml.includes(".message-row.user-row{align-items:flex-end}"));
assert.ok(sidePanelHtml.includes("overflow-anchor:none"));
assert.ok(themeSource.includes("max-width: 320px"));

assert.ok(read("history.html").includes('id="imageViewer"'));
assert.ok(read("history.html").includes('id="viewMode"'));
assert.ok(read("history.html").includes("marked.min.js"));
assert.ok(read("history.html").includes(".entry,.cell,.conversation,.turn,.markdown{min-width:0;max-width:100%}"));
assert.ok(historySource.includes("messageImageUrls"));
assert.ok(historySource.includes("renderAsMarkdown = true"));
assert.ok(historySource.includes("safeMarkdown(text)"));
assert.ok(historySource.includes('scroll.className = "table-scroll"'));
assert.ok(historySource.includes("constrainTableColumns(table)"));
assert.ok(historySource.includes('action: "DELETE_SAVED_AI_CHATS"'));
assert.ok(!historySource.includes("chrome.tabs.update(tabId, { active: true })"));

assert.ok(read("background.js").includes('case "EDIT_AI_MESSAGE"'));
assert.ok(!read("background.js").includes("CONFIRM_AI_PAGE_OVERFLOW"), "Page overflow is decided in the side panel, not with confirm() on the page");
assert.ok(popupSource.includes("chrome.sidePanel.open({ tabId: activeTabId })"));
assert.ok(popupSource.indexOf("chrome.sidePanel.open({ tabId: activeTabId })") < popupSource.indexOf('action: "OPEN_AI_FROM_POPUP"'));
assert.ok(popupSource.includes('action: "DELETE_SAVED_AI_CHATS"'));
assert.ok(!/<a\b(?![^>]*href)/.test(read("popup.html")), "Popup links must be focusable buttons");

console.log("Smoke checks passed");
