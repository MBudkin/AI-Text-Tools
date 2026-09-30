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
  runtime: { onInstalled: new ChromeEvent(), onStartup: new ChromeEvent(), onMessage: new ChromeEvent(), sendMessage: async () => ({ ok: true }), getURL: path => `chrome-extension://test/${path}` },
  contextMenus: { onClicked: new ChromeEvent(), removeAll(callback) { createdMenus.length = 0; callback(); }, create(item) { createdMenus.push(item); } },
  commands: { onCommand: new ChromeEvent() },
  tabs: { onRemoved: new ChromeEvent(), query: async () => [], get: async id => ({ id, windowId: 1 }), sendMessage: async (tabId, message) => { sentMessages.push({ tabId, message }); return { ok: true }; } },
  scripting: { insertCSS: async () => {}, executeScript: async () => {} },
  sidePanel: { open: async () => {}, close: async () => { sidePanelCloseCalls++; }, setOptions: async () => {} },
  windows: { onRemoved: new ChromeEvent(), getCurrent: async () => ({ id: 1, width: 1200 }), create: async () => ({ id: 99 }) },
  storage: { sync: area(syncData), local: area(localData), session: area(sessionData) }
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
const restored = await new Promise(resolve => messageListener({ action: "RESTORE_AI_WINDOW", tabId: 12, draft }, {}, resolve));
assert.equal(restored.ok, true);
assert.ok(sentMessages.some(item => item.tabId === 12 && item.message.action === "OPEN_AI_DRAFT"));
assert.equal(sidePanelCloseCalls, 1);
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

const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
const optionsSource = fs.readFileSync(path.join(root, "options.html"), "utf8");
assert.ok(contentSource.includes('element.id === "ai-text-tools-host"'));
assert.ok(contentSource.includes('case "GET_AI_SELECTION"'));
assert.ok(contentSource.includes("function extractPageLinks"));
assert.ok(contentSource.includes('const CONTENT_SCRIPT_VERSION = "6.7.7"'));
assert.ok(contentSource.includes("function disconnectOrphanedContentScript"));
assert.ok(contentSource.includes("globalThis.chrome?.runtime"));
assert.ok(!contentSource.includes('chrome.runtime.sendMessage({ action: "AI_SELECTION_CHANGED"'));
assert.ok(optionsSource.includes("Используется только при Reasoning → Custom"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes('id="temporary"'));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes('id="includePageLinks"'));
assert.ok(fs.existsSync(path.join(root, "vendor", "katex", "katex.min.js")));
assert.ok(fs.existsSync(path.join(root, "vendor", "katex", "katex.min.css")));
const katex = (await import(`${pathToFileURL(path.join(root, "vendor", "katex", "katex.min.js"))}?test=${Date.now()}`)).default;
assert.ok(katex.renderToString("x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", { throwOnError: false }).includes("katex"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes("vendor/katex/katex.min.js"));
const sidePanelSource = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");
assert.ok(sidePanelSource.includes("renderMathInElement"));
const mathHelpers = sidePanelSource.match(/function normalizeMathSource[\s\S]*?function looksLikeMath[^\n]+/)[0];
const normalizeMathSource = new Function(`${mathHelpers}; return normalizeMathSource;`)();
assert.ok(normalizeMathSource("[ ax^2 + bx + c = 0 ]").includes("$$"));
assert.ok(normalizeMathSource("\\[ x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a} \\]").includes("$$"));
const boundaryHelper = sidePanelSource.match(/function streamingBoundary[\s\S]*?\n}\n\nfunction renderStreamingAnswer/)[0].replace(/\nfunction renderStreamingAnswer$/, "");
const streamingBoundary = new Function(`${boundaryHelper}; return streamingBoundary;`)();
const streamedMarkdown = "Введение\n\n```js\nconst x = 1;\n\nconsole.log(x);\n```\n\nХвост";
assert.equal(streamedMarkdown.slice(streamingBoundary(streamedMarkdown)), "Хвост");
assert.ok(sidePanelSource.includes("safeMarkdown(stableText.slice(state.streamStableText.length), false)"));
assert.ok(sidePanelSource.includes('const messageContextType = startsNewConversation ? state.mode : "none"'));
assert.ok(sidePanelSource.includes('node.target = "_blank"'));
assert.ok(sidePanelSource.includes('node.rel = "noopener noreferrer"'));
assert.ok(sidePanelSource.includes("['http:', 'https:'].includes(url.protocol)"));
assert.ok(sidePanelSource.includes("setTimeout(() => { renderTimer = null; updateCurrent(); }, 28)"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes('id="chatModel"'));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes('id="chatThinking"'));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes('id="chatOptions"'));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes('id="imageViewer"'));
assert.ok(sidePanelSource.includes("openImageViewer"));
assert.ok(fs.readFileSync(path.join(root, "history.html"), "utf8").includes('id="imageViewer"'));
assert.ok(fs.readFileSync(path.join(root, "history.js"), "utf8").includes("messageImageUrls"));
assert.ok(fs.readFileSync(path.join(root, "history.html"), "utf8").includes('id="viewMode"'));
assert.ok(fs.readFileSync(path.join(root, "history.html"), "utf8").includes("marked.min.js"));
assert.ok(fs.readFileSync(path.join(root, "history.js"), "utf8").includes("renderAsMarkdown = true"));
assert.ok(fs.readFileSync(path.join(root, "history.js"), "utf8").includes("safeMarkdown(text)"));
assert.ok(fs.readFileSync(path.join(root, "history.html"), "utf8").includes(".entry,.cell,.conversation,.turn,.markdown{min-width:0;max-width:100%}"));
assert.ok(fs.readFileSync(path.join(root, "history.js"), "utf8").includes('scroll.className = "table-scroll"'));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes('id="editBar"'));
assert.ok(!fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes('id="insertPrompt"'));
assert.ok(!fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes('id="promptMenu"'));
assert.ok(sidePanelSource.includes("normalizeMathSource"));
assert.ok(sidePanelSource.includes("models.size > 1"));
assert.ok(!sidePanelSource.includes("parts.push(`всего $"));
assert.ok(fs.readFileSync(path.join(root, "background.js"), "utf8").includes('case "EDIT_AI_MESSAGE"'));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.js"), "utf8").includes('document.addEventListener("drop"'));
assert.ok(!fs.readFileSync(path.join(root, "history.js"), "utf8").includes("chrome.tabs.update(tabId, { active: true })"));
const popupSource = fs.readFileSync(path.join(root, "popup.js"), "utf8");
assert.ok(popupSource.includes("chrome.sidePanel.open({ tabId: activeTabId })"));
assert.ok(popupSource.indexOf("chrome.sidePanel.open({ tabId: activeTabId })") < popupSource.indexOf('action: "OPEN_AI_FROM_POPUP"'));
assert.ok(popupSource.includes('action: "DELETE_SAVED_AI_CHATS"'));
assert.ok(fs.readFileSync(path.join(root, "history.js"), "utf8").includes('action: "DELETE_SAVED_AI_CHATS"'));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes("flex-wrap:wrap"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.js"), "utf8").includes('state.tabBehavior === "keep-current"'));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.js"), "utf8").includes("contextSpoiler"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes("height:34px;min-height:34px"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes(".message-row{flex:0 0 auto"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes("flex-direction:column;align-items:flex-start"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes(".message-row.user-row{align-items:flex-end}"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.js"), "utf8").includes("row.append(bubble, tools)"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.js"), "utf8").includes("requestAnimationFrame(() => $(\"input\").focus())"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes("overflow-anchor:none"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.js"), "utf8").includes('wrap.className = "code-wrap"'));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes("padding-top:25px"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes("width:21px;height:21px"));
assert.ok(fs.readFileSync(path.join(root, "popup.html"), "utf8").includes("scrollbar-color:#56657d transparent"));
assert.ok(fs.readFileSync(path.join(root, "popup.html"), "utf8").includes("body.light footer a"));
assert.ok(!fs.readFileSync(path.join(root, "sidepanel.js"), "utf8").includes('querySelector(".reasoning")?.removeAttribute("open")'));
assert.ok(sidePanelSource.includes("constrainTableColumns(table)"));
assert.ok(contentSource.includes("constrainTableColumns(table)"));
assert.ok(fs.readFileSync(path.join(root, "history.js"), "utf8").includes("constrainTableColumns(table)"));
assert.ok(fs.readFileSync(path.join(root, "sidepanel.html"), "utf8").includes("max-width:320px"));

console.log("Smoke checks passed");
