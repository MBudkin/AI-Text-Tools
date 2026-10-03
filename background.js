const DEFAULT_MENU_ITEMS = [
  { title: "Кратко пересказать", prompt: "Кратко перескажи выделенный текст, сохрани ключевые факты:\n\n{{selectionText}}", model: "", thinking: "default" },
  { title: "Объяснить", prompt: "Объясни выделенный текст простым языком:\n\n{{selectionText}}", model: "", thinking: "default" },
  { title: "Перевести", prompt: "Переведи выделенный текст на русский язык. Если текст уже на русском — переведи на английский:\n\n{{selectionText}}", model: "", thinking: "off" }
];

const DEFAULTS = {
  apiServer: "https://openrouter.ai/api/v1",
  apiProvider: "openrouter",
  apiModel: "openrouter/auto",
  defaultPromptModel: "openrouter/auto",
  quickModel: "openrouter/auto",
  systemPrompt: "Ты полезный AI-ассистент. Сегодня {{date}}, текущее время {{time}}.",
  defaultThinking: "none",
  quickThinking: "none",
  defaultReasoningMaxTokens: 2000,
  quickReasoningMaxTokens: 2000,
  chatWindowWidth: 760,
  chatWindowCompactWidth: 560,
  rememberChatWindowWidth: false,
  sidePanelTabBehavior: "keep-current",
  pageSummaryPrompt: "Сделай структурированное резюме открытой страницы. Выдели главные идеи, важные факты и практические выводы.",
  pageContextLimit: 60000,
  enableCaching: true,
  cacheTtl: 300,
  historyLimit: 50,
  recentChatsLimit: 6,
  sendOnEnter: true,
  theme: "system",
  codeWrap: false,
  showRub: false,
  rubDisplay: "both",
  rubRateSource: "cbr",
  rubManualRate: 90,
  rubInChat: true,
  rubInPopup: true,
  rubInHistory: true,
  rubInModels: true,
  menuItems: DEFAULT_MENU_ITEMS
};

const sessions = new Map();
const activeRequests = new Map();
const drafts = new Map();
const temporaryWindows = new Map();

const storageGet = (area, keys) => new Promise(resolve => chrome.storage[area].get(keys, resolve));
const storageSet = (area, value) => new Promise((resolve, reject) => chrome.storage[area].set(value, () => {
  const error = chrome.runtime.lastError;
  if (error) reject(new Error(error.message || String(error))); else resolve();
}));
const storageRemove = (area, keys) => new Promise(resolve => chrome.storage[area].remove(keys, resolve));

function isOpenRouter(server = "") {
  try {
    return new URL(server).hostname.endsWith("openrouter.ai");
  } catch {
    return server.includes("openrouter.ai");
  }
}

async function getSettings() {
  const [stored, secrets] = await Promise.all([storageGet("sync", null), storageGet("local", ["apiKey"])]);
  const legacyModel = stored.apiModel || DEFAULTS.apiModel;
  return {
    ...DEFAULTS,
    ...stored,
    // The key lives in local storage so it is not synced to the Google account.
    apiKey: secrets.apiKey || stored.apiKey || "",
    apiModel: legacyModel,
    defaultPromptModel: stored.defaultPromptModel || legacyModel,
    quickModel: stored.quickModel || legacyModel,
    menuItems: Array.isArray(stored.menuItems) && stored.menuItems.length ? stored.menuItems : DEFAULT_MENU_ITEMS
  };
}

async function getModelCatalog() {
  const stored = await storageGet("local", ["openRouterModels"]);
  return Array.isArray(stored.openRouterModels) ? stored.openRouterModels : [];
}

async function getModelCapability(model) {
  return (await getModelCatalog()).find(item => item.id === model) || null;
}

async function fetchOpenRouterModels(credentials = {}) {
  const settings = await getSettings();
  const apiServer = (credentials.apiServer || settings.apiServer || DEFAULTS.apiServer).replace(/\/$/, "");
  const apiKey = credentials.apiKey || settings.apiKey;
  const response = await fetch(`${apiServer}/models?output_modalities=all`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  });
  if (!response.ok) throw new Error(`Не удалось загрузить модели OpenRouter: API ${response.status}`);
  const payload = await response.json();
  const models = (payload.data || []).map(model => ({
    id: model.id,
    name: model.name || model.id,
    context_length: model.context_length || 0,
    input_modalities: model.architecture?.input_modalities || [],
    output_modalities: model.architecture?.output_modalities || [],
    supported_parameters: model.supported_parameters || [],
    reasoning: model.reasoning || null,
    pricing: model.pricing || {}
  }));
  await storageSet("local", { openRouterModels: models, openRouterModelsUpdatedAt: Date.now(), openRouterModelsError: null });
  return models;
}

function replacePlaceholders(value = "", context = {}) {
  const now = new Date();
  const replacements = {
    date: now.toLocaleDateString("ru-RU"),
    time: now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    selectionText: context.selectionText || "",
    pageText: context.pageText || "",
    pageTitle: context.pageTitle || "",
    pageUrl: context.pageUrl || ""
  };
  return Object.entries(replacements).reduce(
    (result, [key, replacement]) => result.split(`{{${key}}}`).join(replacement),
    String(value)
  );
}

function createContextMenus(menuItems = []) {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "ai-ask-selection", title: "Спросить AI о выделенном", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "ai-ask-page", title: "Спросить AI об этой странице", contexts: ["page", "selection"] });
    chrome.contextMenus.create({ id: "ai-summarize-page", title: "Суммаризировать страницу", contexts: ["page", "selection"] });
    chrome.contextMenus.create({ id: "ai-separator", type: "separator", contexts: ["selection"] });
    menuItems.forEach((item, index) => {
      if (!item || !item.title || !item.prompt) return;
      const usesSelection = item.prompt.includes("{{selectionText}}");
      const usesPage = /\{\{page(Text|Title|Url)\}\}/.test(item.prompt);
      chrome.contextMenus.create({
        id: `ai-template-${index}`,
        title: item.title,
        contexts: usesSelection ? ["selection"] : usesPage ? ["page", "selection"] : ["page", "selection"]
      });
    });
  });
}

async function initializeExtension() {
  const stored = await storageGet("sync", null);
  const migration = {};
  if (!stored.apiServer) migration.apiServer = DEFAULTS.apiServer;
  if (!stored.apiModel) migration.apiModel = DEFAULTS.apiModel;
  if (!stored.defaultPromptModel) migration.defaultPromptModel = stored.apiModel || DEFAULTS.defaultPromptModel;
  if (!stored.quickModel) migration.quickModel = stored.apiModel || DEFAULTS.quickModel;
  if (!stored.menuItems || !stored.menuItems.length) migration.menuItems = DEFAULT_MENU_ITEMS;
  for (const key of ["apiProvider", "defaultThinking", "quickThinking", "defaultReasoningMaxTokens", "quickReasoningMaxTokens", "chatWindowWidth", "chatWindowCompactWidth", "rememberChatWindowWidth", "sidePanelTabBehavior", "pageSummaryPrompt", "pageContextLimit", "enableCaching", "cacheTtl", "historyLimit", "recentChatsLimit", "sendOnEnter", "theme", "codeWrap", "showRub", "rubDisplay", "rubRateSource", "rubManualRate", "rubInChat", "rubInPopup", "rubInHistory", "rubInModels"]) {
    if (typeof stored[key] === "undefined") migration[key] = DEFAULTS[key];
  }
  if (Object.keys(migration).length) await storageSet("sync", migration);
  if (stored.apiKey) {
    const { apiKey: localKey } = await storageGet("local", ["apiKey"]);
    if (!localKey) await storageSet("local", { apiKey: stored.apiKey });
    await storageRemove("sync", "apiKey");
  }
  createContextMenus((stored.menuItems && stored.menuItems.length ? stored.menuItems : DEFAULT_MENU_ITEMS));
}

/* USD → RUB rate for cost display. Public sources without API keys; the
   other one is tried when the selected source fails. */
const RATE_SOURCES = {
  cbr: {
    title: "ЦБ РФ",
    url: "https://www.cbr-xml-daily.ru/daily_json.js",
    parse: data => ({ rate: Number(data?.Valute?.USD?.Value) / (Number(data?.Valute?.USD?.Nominal) || 1), date: data?.Date })
  },
  "er-api": {
    title: "ExchangeRate-API",
    url: "https://open.er-api.com/v6/latest/USD",
    parse: data => ({ rate: data?.result === "success" ? Number(data?.rates?.RUB) : NaN, date: data?.time_last_update_unix ? new Date(data.time_last_update_unix * 1000).toISOString() : data?.time_last_update_utc })
  }
};
const DAILY_ALARM = "daily-refresh";
const LEGACY_RATE_ALARM = "usd-rub-rate";
const DAILY_MAX_AGE = 20 * 60 * 60 * 1000;

async function fetchRate(sourceId) {
  const source = RATE_SOURCES[sourceId];
  const response = await fetch(source.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${source.title}: HTTP ${response.status}`);
  const { rate, date } = source.parse(await response.json());
  // Sanity bounds guard against a broken or spoofed response.
  if (!Number.isFinite(rate) || rate < 1 || rate > 10000) throw new Error(`${source.title}: некорректный курс`);
  return { rate, date: date || new Date().toISOString(), source: sourceId, fetchedAt: Date.now() };
}

async function refreshUsdRubRate({ force = false, source = "" } = {}) {
  const settings = await getSettings();
  if (!force && !settings.showRub) return null;
  const selected = source || settings.rubRateSource;
  if (selected === "manual") return null;
  const preferred = RATE_SOURCES[selected] ? selected : "cbr";
  const { usdRubRate } = await storageGet("local", ["usdRubRate"]);
  if (!force && usdRubRate?.source === preferred && Date.now() - Number(usdRubRate.fetchedAt || 0) < DAILY_MAX_AGE) return usdRubRate;
  const errors = [];
  for (const sourceId of [preferred, ...Object.keys(RATE_SOURCES).filter(id => id !== preferred)]) {
    try {
      const result = await fetchRate(sourceId);
      await storageSet("local", { usdRubRate: result, usdRubRateError: null });
      return result;
    } catch (error) { errors.push(error.message); }
  }
  const message = `Не удалось обновить курс: ${errors.join("; ")}`;
  await storageSet("local", { usdRubRateError: { message, at: Date.now() } }).catch(() => {});
  throw new Error(message);
}

// Keeps the OpenRouter catalog (models and prices) at most a day old.
async function refreshModelCatalog({ force = false } = {}) {
  const settings = await getSettings();
  if (settings.apiProvider !== "openrouter") return null;
  const { openRouterModelsUpdatedAt = 0 } = await storageGet("local", ["openRouterModelsUpdatedAt"]);
  if (!force && Date.now() - Number(openRouterModelsUpdatedAt) < DAILY_MAX_AGE) return null;
  try {
    return await fetchOpenRouterModels();
  } catch (error) {
    await storageSet("local", { openRouterModelsError: { message: error.message, at: Date.now() } }).catch(() => {});
    throw error;
  }
}

function runDailyRefresh() {
  refreshUsdRubRate().catch(error => console.warn(error.message));
  refreshModelCatalog().catch(error => console.warn(error.message));
}

// Checked every 6 hours; the rate and the catalog are refetched once they are
// older than 20 h, so both stay daily even if the browser was closed at alarm time.
function scheduleDailyRefresh() {
  chrome.alarms?.clear(LEGACY_RATE_ALARM);
  chrome.alarms?.create(DAILY_ALARM, { delayInMinutes: 1, periodInMinutes: 360 });
}

chrome.alarms?.onAlarm.addListener(alarm => {
  if (alarm.name === DAILY_ALARM) runDailyRefresh();
});
chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === "sync" && (changes.showRub || changes.rubRateSource)) refreshUsdRubRate().catch(error => console.warn(error.message));
  if (areaName === "sync" && changes.apiProvider) refreshModelCatalog().catch(error => console.warn(error.message));
});

chrome.runtime.onInstalled.addListener(async () => {
  await initializeExtension();
  scheduleDailyRefresh();
});
chrome.runtime.onStartup.addListener(async () => {
  createContextMenus((await getSettings()).menuItems);
  scheduleDailyRefresh();
  runDailyRefresh();
});

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "PING_AI_TEXT_TOOLS" });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return true;
    } catch (error) {
      console.warn("AI Text Tools cannot run on this page:", error);
      return false;
    }
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.warn("Failed to message tab", tabId, error);
    return null;
  }
}

// Chat UI lives only in extension pages (side panel / chat window), so events
// go over runtime messaging; pages never receive the per-token stream.
async function emitChatEvent(tabId, message) {
  try { await chrome.runtime.sendMessage({ ...message, sourceTabId: tabId }); } catch {}
}

function pageLinkLimit(limit) {
  return Math.min(16000, Math.max(2000, Math.floor(Number(limit || DEFAULTS.pageContextLimit) * .25)));
}

async function collectPageContext(tabId, includeLinks = false, limit = DEFAULTS.pageContextLimit) {
  if (!(await ensureContentScript(tabId))) throw new Error("Содержимое этой страницы недоступно расширению (служебная страница браузера или магазин расширений).");
  const linkLimit = pageLinkLimit(limit);
  const context = await sendToTab(tabId, { action: "GET_AI_PAGE_CONTEXT", limit: Number.MAX_SAFE_INTEGER, includeLinks, linkLimit });
  if (!context) throw new Error("Не удалось прочитать содержимое страницы.");
  return augmentWithFrameText(tabId, context, includeLinks, linkLimit);
}

// overflow: "truncate" (default) cuts the text to the configured limit,
// "full" sends everything — the side panel asks the user before choosing it.
async function readPageContext(tabId, limit, includeLinks = false, overflow = "truncate") {
  const context = await collectPageContext(tabId, includeLinks, limit);
  const originalLength = context.pageText.length;
  if (overflow !== "full" && originalLength > limit) {
    context.pageText = `${context.pageText.slice(0, limit)}\n\n[Текст страницы обрезан расширением: ${limit} из ${originalLength} символов]`;
    context.truncatedFrom = originalLength;
  }
  return context;
}

function truncationNotice(context, limit) {
  return context?.truncatedFrom ? `Текст страницы обрезан до ${Number(limit).toLocaleString("ru-RU")} из ${context.truncatedFrom.toLocaleString("ru-RU")} символов. Лимит меняется в настройках.` : "";
}

function mergePageLinks(linkGroups, maxLinks = 120, maxChars = 16000) {
  const unique = new Map();
  for (const links of linkGroups) for (const link of links || []) {
    if (!link?.url || !link?.text) continue;
    const previous = unique.get(link.url);
    if (!previous || link.text.length > previous.text.length) unique.set(link.url, { text: String(link.text).slice(0, 180), url: String(link.url) });
  }
  const result = [];
  let usedChars = 0;
  for (const link of unique.values()) {
    const size = link.text.length + link.url.length + 6;
    if (result.length >= maxLinks || usedChars + size > maxChars) break;
    result.push(link); usedChars += size;
  }
  return result;
}

async function augmentWithFrameText(tabId, context, includeLinks = false, linkLimit = 16000) {
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, args: [includeLinks, linkLimit], func: (collectLinks, maxLinkChars) => {
      const links = [];
      let usedChars = 0;
      if (collectLinks) for (const anchor of document.querySelectorAll("a[href]")) {
        if (anchor.closest("[hidden],[aria-hidden='true']")) continue;
        const style = getComputedStyle(anchor);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const text = (anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || anchor.querySelector("img[alt]")?.alt || "").replace(/\s+/g, " ").trim().slice(0, 180);
        if (text.length < 2) continue;
        try {
          const url = new URL(anchor.getAttribute("href"), location.href);
          if (!['http:', 'https:'].includes(url.protocol) || url.href.length > 2048) continue;
          const size = text.length + url.href.length + 6;
          if (links.length >= 120 || usedChars + size > maxLinkChars) break;
          links.push({ text, url: url.href }); usedChars += size;
        } catch {}
      }
      return { text: document.body?.innerText || document.documentElement?.innerText || "", title: document.title, url: location.href, links };
    } });
    let combined = context.pageText || "";
    for (const result of results || []) {
      const text = result.result?.text?.trim();
      if (text && text.length > 20 && !combined.includes(text.slice(0, 300))) combined += `${combined ? "\n\n" : ""}${text}`;
    }
    let pageOrigin = "";
    try { pageOrigin = new URL(context.pageUrl).origin; } catch {}
    const frameLinkGroups = (results || []).filter(result => {
      try { return !pageOrigin || new URL(result.result?.url).origin === pageOrigin; } catch { return false; }
    }).map(result => result.result?.links);
    const pageLinks = includeLinks ? mergePageLinks([context.pageLinks, ...frameLinkGroups], 120, linkLimit) : [];
    return { ...context, pageText: combined.trim(), pageLinks, includeLinks: Boolean(includeLinks) };
  } catch { return context; }
}

async function openComposer(tab, mode = "auto", openPanel = true) {
  if (!tab?.id || !chrome.sidePanel) return { ok: false, error: "Боковая панель недоступна в этой версии браузера." };
  const openingPanel = openPanel ? chrome.sidePanel.open({ tabId: tab.id }).then(() => null, error => error) : Promise.resolve(null);
  // Service pages (chrome://, Web Store) cannot be scripted, but a plain chat
  // without page context still works there.
  const scriptable = await ensureContentScript(tab.id);
  await stopGeneration(tab.id, true);
  sessions.delete(tab.id);
  drafts.delete(tab.id);
  if (chrome.storage.session) await chrome.storage.session.remove(`chat_${tab.id}`);
  const settings = await getSettings();
  const selection = scriptable ? await sendToTab(tab.id, { action: "GET_AI_SELECTION" }) : null;
  const selectionText = selection?.selectionText || "";
  if (!scriptable && mode === "page") mode = "none";
  drafts.set(tab.id, {
    prompt: "",
    mode: mode === "auto" ? (selectionText ? "selection" : "none") : mode,
    selectionText,
    model: settings.quickModel,
    thinking: settings.quickThinking,
    reasoningMaxTokens: settings.quickReasoningMaxTokens,
    images: [],
    temporary: false
  });
  chrome.runtime.sendMessage({ action: "AI_SURFACE_OWNER", sourceTabId: tab.id, surfaceOwner: "sidepanel", newChat: true }).catch(() => {});
  const openingError = await openingPanel;
  if (openingError) return { ok: false, error: openingError.message || "Не удалось открыть боковую панель." };
  return { ok: true };
}

function normalizeThinking(value, fallback = "none") {
  const result = value === "default" || !value ? fallback : value;
  const migrated = result === "on" ? "medium" : result === "off" ? "none" : result;
  return ["none", "minimal", "low", "medium", "high", "xhigh", "max", "custom"].includes(migrated) ? migrated : "none";
}

function makeSessionId() {
  return `aitt-${Date.now().toString(36)}-${crypto.randomUUID()}`;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(part => part.type === "text").map(part => part.text).join("\n");
}

function compactMessages(messages) {
  return messages.map(message => ({
    ...message,
    content: typeof message.content === "string"
      ? message.content
      : message.content.map(part => part.type === "image_url" ? { type: "text", text: "[Изображение было приложено к предыдущему сообщению]" } : part)
  }));
}

function imagePreviews(images = []) {
  return images.map(image => image?.previewDataUrl).filter(Boolean);
}

function apiMessages(messages) {
  return messages.map(message => {
    const content = Array.isArray(message.content)
      ? message.content.map(part => ({ ...part, ...(part.image_url ? { image_url: { ...part.image_url } } : {}) }))
      : message.content;
    const result = { role: message.role, content };
    if (message.reasoning_details) result.reasoning_details = message.reasoning_details;
    return result;
  });
}

async function persistSession(tabId, session) {
  if (!chrome.storage.session) return;
  const key = `chat_${tabId}`;
  const snapshot = { ...session, messages: compactMessages(session.messages), updatedAt: Date.now() };
  try {
    await storageSet("session", { [key]: snapshot });
  } catch (error) {
    // storage.session is capped (~10 MB): retry without the bulky parts that
    // are only needed for display, so the conversation itself survives a worker restart.
    const { pageText, pageLinks, ...context } = snapshot.context || {};
    const slim = { ...snapshot, context, messages: snapshot.messages.map(({ imagePreviews, ...message }) => message) };
    try { await storageSet("session", { [key]: slim }); }
    catch (retryError) { console.warn("AI Text Tools cannot persist the session", error, retryError); }
  }
}

async function loadSession(tabId) {
  if (sessions.has(tabId)) return sessions.get(tabId);
  if (!chrome.storage.session) return null;
  const stored = await storageGet("session", `chat_${tabId}`);
  const session = stored[`chat_${tabId}`];
  if (session) sessions.set(tabId, session);
  return session || null;
}

async function forgetTemporaryChat(tabId) {
  const session = sessions.get(tabId);
  const draft = drafts.get(tabId);
  if (!session?.temporary && !draft?.temporary) return false;
  await stopGeneration(tabId, true);
  sessions.delete(tabId);
  drafts.delete(tabId);
  if (chrome.storage.session) await chrome.storage.session.remove(`chat_${tabId}`);
  return true;
}

function buildUserContent(prompt, context, images = []) {
  const sections = [];
  if (context?.type === "selection" && context.selectionText) sections.push(`Контекст — выделенный текст:\n\n${context.selectionText}`);
  if (context?.type === "page" && context.pageText) {
    let pageSection = `Контекст открытой страницы:\nНазвание: ${context.pageTitle || "Без названия"}\nURL: ${context.pageUrl || ""}\n\n${context.pageText}`;
    if (context.includeLinks && context.pageLinks?.length) {
      const links = context.pageLinks.map(link => `- ${link.text}: ${link.url}`).join("\n");
      pageSection += `\n\nСодержательные ссылки страницы (${context.pageLinks.length}):\n${links}`;
    }
    sections.push(pageSection);
  }
  sections.push(prompt);
  const text = sections.join("\n\n---\n\n");
  const validImages = images.filter(image => image?.dataUrl);
  if (!validImages.length) return text;
  return [{ type: "text", text }, ...validImages.map(image => ({ type: "image_url", image_url: { url: image.dataUrl } }))];
}

async function startNewConversation(tabId, payload) {
  const settings = await getSettings();
  let context = payload.context || { type: "none" };
  if (context.type === "page" && !context.pageText) {
    context = { type: "page", ...(await readPageContext(tabId, settings.pageContextLimit, Boolean(context.includeLinks), context.overflow)) };
    const notice = truncationNotice(context, settings.pageContextLimit);
    if (notice) await emitChatEvent(tabId, { action: "AI_CHAT_META", notice });
  }
  const templateContext = payload.contextForHistory || context;
  const placeholderContext = {
    selectionText: templateContext.selectionText,
    pageText: templateContext.pageText,
    pageTitle: templateContext.pageTitle,
    pageUrl: templateContext.pageUrl
  };
  const system = replacePlaceholders(settings.systemPrompt, placeholderContext);
  const prompt = payload.processed ? String(payload.prompt) : replacePlaceholders(payload.prompt, placeholderContext);
  const model = payload.model || settings.quickModel;
  const thinking = normalizeThinking(payload.thinking, settings.quickThinking);
  const displayPrompt = payload.displayPrompt ?? prompt;
  const requestedDisplayContext = payload.displayContext || (context.type !== "none" ? context : null);
  const displayContext = requestedDisplayContext?.type === "selection" ? requestedDisplayContext : null;
  const contextType = requestedDisplayContext?.type || context.type || "none";
  const session = {
    id: makeSessionId(),
    model,
    thinking,
    reasoningMaxTokens: Number(payload.reasoningMaxTokens || settings.quickReasoningMaxTokens) || 2000,
    messages: system ? [{ role: "system", content: system }] : [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    context: payload.contextForHistory || context,
    title: (payload.title || displayPrompt).trim().slice(0, 80) || "Новый чат",
    totalCost: 0,
    temporary: Boolean(payload.temporary)
  };
  const inputImages = payload.images || (payload.image ? [payload.image] : []);
  session.messages.push({ role: "user", content: buildUserContent(prompt, context, inputImages), displayText: displayPrompt, displayContext, contextType, pageLinksIncluded: contextType === "page" && Boolean(context.includeLinks), pageLinkCount: contextType === "page" ? context.pageLinks?.length || 0 : 0, imageCount: inputImages.filter(image => image?.dataUrl).length, imagePreviews: imagePreviews(inputImages) });
  sessions.set(tabId, session);
  drafts.delete(tabId);
  if (payload.announceSurface) {
    await chrome.runtime.sendMessage({ action: "AI_SURFACE_OWNER", sourceTabId: tabId, surfaceOwner: "sidepanel", newChat: true, externalRequest: true }).catch(() => {});
  }
  await generate(tabId, session, settings, prompt, { surface: payload.source, newConversation: true, userPrompt: displayPrompt, userContext: displayContext, userContextType: contextType, userPageLinksIncluded: contextType === "page" && Boolean(context.includeLinks), userPageLinkCount: contextType === "page" ? context.pageLinks?.length || 0 : 0, userImageCount: inputImages.filter(image => image?.dataUrl).length, title: session.title, temporary: session.temporary });
}

async function continueConversation(tabId, payload) {
  const settings = await getSettings();
  let session = await loadSession(tabId);
  if (!session) return startNewConversation(tabId, payload);
  const previousModel = session.model;
  backfillAssistantModels(session, previousModel);
  if (payload.model && payload.model !== session.model) session.model = payload.model;
  if (payload.thinking) session.thinking = normalizeThinking(payload.thinking, settings.quickThinking);
  if (payload.reasoningMaxTokens) session.reasoningMaxTokens = Number(payload.reasoningMaxTokens);
  const inputImages = payload.images || (payload.image ? [payload.image] : []);
  session.messages.push({ role: "user", content: buildUserContent(payload.prompt, null, inputImages), displayText: payload.displayPrompt ?? payload.prompt, imageCount: inputImages.filter(image => image?.dataUrl).length, imagePreviews: imagePreviews(inputImages) });
  await generate(tabId, session, settings, payload.prompt, { surface: payload.source, modelChanged: Boolean(previousModel && session.model !== previousModel) });
}

async function regenerateConversation(tabId, payload = {}) {
  const settings = await getSettings();
  const session = await loadSession(tabId);
  if (!session) throw new Error("Активный чат не найден.");
  backfillAssistantModels(session, session.model);
  const removedAssistant = session.messages.at(-1)?.role === "assistant" ? session.messages.pop() : null;
  const previousModel = removedAssistant?.model || session.model;
  if (payload.model) session.model = payload.model;
  if (payload.thinking) session.thinking = normalizeThinking(payload.thinking, settings.quickThinking);
  if (payload.reasoningMaxTokens) session.reasoningMaxTokens = Number(payload.reasoningMaxTokens);
  const userMessage = [...session.messages].reverse().find(message => message.role === "user");
  if (!userMessage) throw new Error("В чате нет запроса для перегенерации.");
  await generate(tabId, session, settings, textFromContent(userMessage.content), { regenerated: true, surface: payload.source, modelChanged: Boolean(previousModel && session.model !== previousModel) });
}

function replacePromptPreservingContext(content, prompt, context = null) {
  const replaceText = value => {
    const divider = "\n\n---\n\n", index = String(value || "").lastIndexOf(divider);
    if (index >= 0) return `${String(value).slice(0, index + divider.length)}${prompt}`;
    if (context?.type === "selection" && context.selectionText) return buildUserContent(prompt, context);
    if (context?.type === "page" && context.pageText) return buildUserContent(prompt, context);
    return prompt;
  };
  if (typeof content === "string") return replaceText(content);
  if (!Array.isArray(content)) return prompt;
  let replaced = false;
  return content.map(part => {
    if (!replaced && part.type === "text" && !/^\[Изображение было приложено/.test(part.text || "")) { replaced = true; return { ...part, text: replaceText(part.text) }; }
    return { ...part, ...(part.image_url ? { image_url: { ...part.image_url } } : {}) };
  });
}

function backfillAssistantModels(session, fallbackModel) { for (const message of session.messages || []) if (message.role === "assistant" && !message.model) message.model = fallbackModel || session.model || ""; }

async function editConversation(tabId, payload = {}) {
  const settings = await getSettings();
  const session = await loadSession(tabId);
  if (!session) throw new Error("Активный чат не найден.");
  backfillAssistantModels(session, session.model);
  const userEntries = session.messages.map((message, index) => ({ message, index })).filter(item => item.message.role === "user");
  const target = userEntries[Number(payload.userTurnIndex)];
  if (!target) throw new Error("Сообщение для редактирования не найдено.");
  const prompt = String(payload.prompt || "").trim();
  if (!prompt) throw new Error("Запрос не может быть пустым.");
  const removed = session.messages.slice(target.index + 1);
  const previousAssistant = removed.find(message => message.role === "assistant");
  const preservedContext = target.message.displayContext || (target.message.contextType && target.message.contextType !== "none" ? session.context : null);
  target.message.content = replacePromptPreservingContext(target.message.content, prompt, preservedContext);
  target.message.displayText = prompt;
  session.messages = session.messages.slice(0, target.index + 1);
  if (Number(payload.userTurnIndex) === 0) session.title = prompt.slice(0, 80) || session.title;
  const previousModel = previousAssistant?.model || session.model;
  if (payload.model) session.model = payload.model;
  if (payload.thinking) session.thinking = normalizeThinking(payload.thinking, settings.quickThinking);
  if (payload.reasoningMaxTokens) session.reasoningMaxTokens = Number(payload.reasoningMaxTokens);
  session.updatedAt = Date.now();
  await persistSession(tabId, session);
  await saveChat(session);
  await generate(tabId, session, settings, prompt, { edited: true, surface: payload.source, modelChanged: Boolean(previousModel && session.model !== previousModel) });
}

function reasoningTextFromDelta(delta) {
  if (typeof delta.reasoning === "string") return delta.reasoning;
  if (!Array.isArray(delta.reasoning_details)) return "";
  return delta.reasoning_details.map(item => item.text || item.summary || "").join("");
}

function imagesFromDelta(delta) {
  if (!Array.isArray(delta.images)) return [];
  return delta.images.map(image => image?.image_url?.url || image?.url).filter(Boolean);
}

async function generate(tabId, session, settings, historyQuery, generationOptions = {}) {
  const previous = activeRequests.get(tabId);
  if (previous) previous.abort();
  if (!settings.apiKey) {
    await emitChatEvent(tabId, { action: "AI_CHAT_ERROR", error: "API-ключ не задан. Откройте настройки расширения." });
    return;
  }

  const controller = new AbortController();
  activeRequests.set(tabId, controller);
  const openRouter = isOpenRouter(settings.apiServer);
  const body = {
    model: session.model,
    messages: apiMessages(session.messages),
    stream: true
  };
  if (!openRouter) body.stream_options = { include_usage: true };
  let capability = openRouter ? await getModelCapability(session.model) : null;
  if (openRouter && !capability && settings.apiProvider === "openrouter") {
    try { await fetchOpenRouterModels(); capability = await getModelCapability(session.model); } catch (error) { console.warn("OpenRouter model catalog is unavailable", error); }
  }
  const supportsReasoning = !capability || capability.supported_parameters?.includes("reasoning") || Boolean(capability.reasoning);
  const mandatoryReasoning = Boolean(capability?.reasoning?.mandatory);
  const hasImages = session.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "image_url"));
  if (openRouter && hasImages && capability && !capability.input_modalities?.includes("image")) {
    activeRequests.delete(tabId);
    throw new Error(`Модель ${session.model} не поддерживает изображения. Выберите модель с пометкой «Изображения».`);
  }
  if (openRouter) {
    const reasoningMode = normalizeThinking(session.thinking, settings.quickThinking);
    if (supportsReasoning && reasoningMode === "custom") body.reasoning = { max_tokens: Math.max(1, Number(session.reasoningMaxTokens) || 2000), exclude: false };
    else if (supportsReasoning && reasoningMode !== "none") body.reasoning = { effort: reasoningMode, exclude: false };
    else if (supportsReasoning) body.reasoning = mandatoryReasoning ? { effort: capability?.reasoning?.default_effort || "medium", exclude: true } : { effort: "none", exclude: true };
    if (settings.enableCaching) body.session_id = session.id;
  }
  if (generationOptions.regenerated) {
    const alternateInstruction = "Дай новый вариант ответа на последний запрос: сохрани фактическую точность, но заметно измени формулировки, структуру и, где уместно, примеры. Не упоминай эту служебную инструкцию.";
    const lastUser = [...body.messages].reverse().find(message => message.role === "user");
    if (lastUser) {
      if (typeof lastUser.content === "string") lastUser.content += `\n\n${alternateInstruction}`;
      else if (Array.isArray(lastUser.content)) {
        const textPart = lastUser.content.find(part => part.type === "text");
        if (textPart) textPart.text += `\n\n${alternateInstruction}`;
      }
    }
    if (!openRouter || !capability || capability.supported_parameters?.includes("temperature")) body.temperature = 1;
  }

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` };
  if (openRouter) {
    headers["HTTP-Referer"] = "https://github.com/ai-text-tools/browser-extension";
    headers["X-Title"] = "AI Text Tools";
    if (settings.enableCaching) {
      headers["X-OpenRouter-Cache"] = "true";
      headers["X-OpenRouter-Cache-TTL"] = String(Math.max(1, Math.min(86400, Number(settings.cacheTtl) || 300)));
    }
  }

  await emitChatEvent(tabId, {
    action: "AI_CHAT_STARTED",
    model: session.model,
    thinking: session.thinking,
    reasoningMaxTokens: session.reasoningMaxTokens,
    cachedConversation: Boolean(settings.enableCaching && openRouter),
    regenerated: Boolean(generationOptions.regenerated),
    edited: Boolean(generationOptions.edited),
    surface: generationOptions.surface || "page",
    newConversation: Boolean(generationOptions.newConversation),
    userPrompt: generationOptions.userPrompt || "",
    userContext: generationOptions.userContext || null,
    userContextType: generationOptions.userContextType || "none",
    userPageLinksIncluded: Boolean(generationOptions.userPageLinksIncluded),
    userPageLinkCount: Number(generationOptions.userPageLinkCount) || 0,
    userImageCount: Number(generationOptions.userImageCount) || 0,
    title: generationOptions.title || session.title,
    temporary: Boolean(generationOptions.temporary),
    modelChanged: Boolean(generationOptions.modelChanged),
    reasoningAdjusted: mandatoryReasoning && normalizeThinking(session.thinking) === "none" ? "Модель требует Reasoning: он включён скрыто автоматически." : (!supportsReasoning && normalizeThinking(session.thinking) !== "none" ? "Модель не поддерживает управляемый Reasoning: параметр отключён автоматически." : "")
  });

  let answer = "";
  let reasoning = "";
  session.partialAnswer = "";
  session.partialReasoning = "";
  let reasoningDetails = [];
  let usage = null;
  let completed = false;
  const imageUrls = [];
  // Tokens arrive far faster than the panel can use them; coalescing them
  // into ~40 ms batches saves an IPC round trip per token.
  const pendingDelta = { content: "", reasoning: "", images: [] };
  let lastFlush = 0;
  const flushDelta = async (force = false) => {
    if (!pendingDelta.content && !pendingDelta.reasoning && !pendingDelta.images.length) return;
    if (!force && Date.now() - lastFlush < 40) return;
    const batch = { action: "AI_CHAT_DELTA", content: pendingDelta.content, reasoning: pendingDelta.reasoning, images: pendingDelta.images.splice(0) };
    pendingDelta.content = ""; pendingDelta.reasoning = "";
    lastFlush = Date.now();
    await emitChatEvent(tabId, batch);
  };
  try {
    const endpoint = `${settings.apiServer.replace(/\/$/, "")}/chat/completions`;
    let response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    let cacheStatus = response.headers.get("X-OpenRouter-Cache-Status");
    if (!response.ok) {
      const detail = await response.text();
      if (openRouter && response.status === 400 && /reasoning is mandatory|cannot be disabled/i.test(detail) && body.reasoning?.effort === "none") {
        body.reasoning = { enabled: true, exclude: true };
        await rememberMandatoryReasoning(session.model);
        await emitChatEvent(tabId, { action: "AI_CHAT_META", notice: "Эта модель требует reasoning. Расширение автоматически включило его в скрытом режиме и повторило запрос." });
        response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
        if (!response.ok) throw new Error(`API ${response.status}: ${(await response.text()).slice(0, 800)}`);
        cacheStatus = response.headers.get("X-OpenRouter-Cache-Status");
      } else {
        throw new Error(`API ${response.status}: ${detail.slice(0, 800)}`);
      }
    }
    await emitChatEvent(tabId, { action: "AI_CHAT_META", cacheStatus });

    const handleLine = async line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let event;
      try { event = JSON.parse(data); } catch { return; }
      if (event.error) throw new Error(event.error.message || JSON.stringify(event.error));
      if (event.usage) usage = event.usage;
      const delta = event.choices?.[0]?.delta || {};
      const contentDelta = typeof delta.content === "string"
        ? delta.content
        : Array.isArray(delta.content)
          ? delta.content.map(part => part?.text || "").join("")
          : "";
      const reasoningDelta = reasoningTextFromDelta(delta);
      const newImages = imagesFromDelta(delta);
      answer += contentDelta;
      reasoning += reasoningDelta;
      session.partialAnswer = answer;
      session.partialReasoning = reasoning;
      if (Array.isArray(delta.reasoning_details)) reasoningDetails.push(...delta.reasoning_details);
      imageUrls.push(...newImages);
      pendingDelta.content += contentDelta;
      pendingDelta.reasoning += reasoningDelta;
      pendingDelta.images.push(...newImages);
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) await handleLine(line);
      await flushDelta();
    }
    // A stream may end without a trailing newline; its last event often carries usage.
    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/)) await handleLine(line);
    await flushDelta(true);

    const requestCost = Number(usage?.cost) || 0;
    const assistantMessage = { role: "assistant", content: answer || (imageUrls.length ? "Изображение создано." : ""), reasoning, usage, cost: requestCost, model: session.model, modelChanged: Boolean(generationOptions.modelChanged) };
    if (reasoningDetails.length) assistantMessage.reasoning_details = reasoningDetails;
    session.messages.push(assistantMessage);
    completed = true;
    delete session.partialAnswer;
    delete session.partialReasoning;
    session.updatedAt = Date.now();
    session.totalCost = (Number(session.totalCost) || 0) + requestCost;
    await persistSession(tabId, session);
    const historyError = await saveChat(session).then(() => null, error => error);
    await updateRecentModels(session.model).catch(() => {});
    if (historyError) await emitChatEvent(tabId, { action: "AI_CHAT_META", notice: `Не удалось сохранить чат в историю: ${historyError.message}` });
    await emitChatEvent(tabId, { action: "AI_CHAT_DONE", content: assistantMessage.content, reasoning, usage, images: imageUrls, requestCost, totalCost: session.totalCost, cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens || 0, model: session.model, modelChanged: Boolean(generationOptions.modelChanged) });
  } catch (error) {
    const ownsSession = activeRequests.get(tabId) === controller;
    if (ownsSession) await flushDelta(true);
    const interrupted = error.name === "AbortError" ? "stopped" : "error";
    // Keep what was already streamed: the user saw it, and the next turn or
    // regeneration must see the same history. Superseded or reset requests
    // (no longer owning the tab) are discarded.
    if (ownsSession && !completed && (answer || reasoning)) await savePartialAnswer(tabId, session, { answer, reasoning, reasoningDetails, interrupted, modelChanged: generationOptions.modelChanged });
    if (error.name === "AbortError") {
      if (ownsSession) await emitChatEvent(tabId, { action: "AI_CHAT_STOPPED" });
    } else {
      console.error("AI request failed", error);
      await emitChatEvent(tabId, { action: "AI_CHAT_ERROR", error: error.message || String(error) });
    }
  } finally {
    if (activeRequests.get(tabId) === controller) activeRequests.delete(tabId);
  }
}

async function savePartialAnswer(tabId, session, { answer, reasoning, reasoningDetails, interrupted, modelChanged }) {
  const message = { role: "assistant", content: answer, reasoning, cost: 0, model: session.model, modelChanged: Boolean(modelChanged), interrupted };
  if (reasoningDetails.length) message.reasoning_details = reasoningDetails;
  session.messages.push(message);
  delete session.partialAnswer;
  delete session.partialReasoning;
  session.updatedAt = Date.now();
  await persistSession(tabId, session);
  await saveChat(session).catch(error => console.warn("AI Text Tools cannot save the interrupted chat", error));
}

async function rememberMandatoryReasoning(modelId) {
  const models = await getModelCatalog();
  const model = models.find(item => item.id === modelId);
  if (model) model.reasoning = { ...(model.reasoning || {}), mandatory: true, default_enabled: true };
  else models.push({ id: modelId, name: modelId, input_modalities: ["text"], output_modalities: ["text"], supported_parameters: ["reasoning"], reasoning: { mandatory: true, default_enabled: true }, pricing: {} });
  await storageSet("local", { openRouterModels: models });
}

async function saveChat(session) {
  if (session.temporary || session.historyDisabled) return;
  const { historyLimit = DEFAULTS.historyLimit } = await storageGet("sync", ["historyLimit"]);
  if (!historyLimit) return;
  const { chats = [] } = await storageGet("local", ["chats"]);
  const compact = { ...session, messages: compactMessages(session.messages) };
  const updated = [compact, ...chats.filter(chat => chat.id !== session.id)].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, Math.min(1000, historyLimit));
  await storageSet("local", { chats: updated });
}

async function deleteSavedChats(chatIds = []) {
  const ids = new Set(chatIds.map(String).filter(Boolean));
  if (!ids.size) return { deleted: 0, chats: [] };
  const stored = await storageGet("local", ["chats", "history"]);
  const chats = Array.isArray(stored.chats) ? stored.chats : [];
  const history = Array.isArray(stored.history) ? stored.history : [];
  const remainingChats = chats.filter(chat => !ids.has(String(chat.id)));
  const remainingHistory = history.filter((entry, index) => !ids.has(String(entry.chatId || `legacy-${index}`)));
  await storageSet("local", { chats: remainingChats, history: remainingHistory });

  for (const [tabId, session] of sessions) {
    if (!ids.has(String(session?.id))) continue;
    session.historyDisabled = true;
    await persistSession(tabId, session);
  }
  if (chrome.storage.session) {
    const storedSessions = await storageGet("session", null);
    const updates = {};
    for (const [key, session] of Object.entries(storedSessions)) {
      if (key.startsWith("chat_") && ids.has(String(session?.id))) updates[key] = { ...session, historyDisabled: true };
    }
    if (Object.keys(updates).length) await storageSet("session", updates);
  }
  return { deleted: chats.length - remainingChats.length + history.length - remainingHistory.length, chats: remainingChats };
}

async function updateRecentModels(model) {
  if (!model) return;
  const { recentModels = [] } = await storageGet("sync", ["recentModels"]);
  // storage.sync has a tight write quota; skip the no-op rewrite after every answer.
  if (recentModels[0] === model) return;
  await storageSet("sync", { recentModels: [model, ...recentModels.filter(item => item !== model)].slice(0, 12) });
}

async function stopGeneration(tabId, silent = false) {
  const controller = activeRequests.get(tabId);
  if (silent) activeRequests.delete(tabId);
  if (controller) controller.abort();
}

async function summarizePage(tab, openPanel = true) {
  const openingPanel = openPanel && chrome.sidePanel ? chrome.sidePanel.open({ tabId: tab.id }).then(() => null, error => error) : Promise.resolve(null);
  try {
    const settings = await getSettings();
    const openingError = await openingPanel;
    if (openingError) throw openingError;
    if (activeRequests.has(tab.id)) await emitChatEvent(tab.id, { action: "AI_CHAT_STOPPED" });
    await startNewConversation(tab.id, {
      prompt: settings.pageSummaryPrompt,
      model: settings.quickModel,
      thinking: settings.quickThinking,
      context: { type: "page" },
      source: "sidepanel",
      announceSurface: true
    });
  } catch (error) {
    await emitChatEvent(tab.id, { action: "AI_CHAT_ERROR", error: error.message || String(error) });
  }
}

// Shared by the context menu and the quick-prompt chips of the side panel.
async function runPromptTemplate(tab, index, selectionText = "", { openPanel = true, temporary = false } = {}) {
  if (openPanel && chrome.sidePanel) await chrome.sidePanel.open({ tabId: tab.id });
  const settings = await getSettings();
  const item = settings.menuItems[index];
  if (!item) throw new Error("Промпт не найден. Обновите список в настройках.");
  if (item.prompt.includes("{{selectionText}}") && !selectionText) throw new Error(`Для промпта «${item.title}» нужно выделить текст на странице.`);
  let page = {};
  if (/\{\{page(Text|Title|Url)\}\}/.test(item.prompt)) {
    page = await readPageContext(tab.id, settings.pageContextLimit);
    const notice = truncationNotice(page, settings.pageContextLimit);
    if (notice) await emitChatEvent(tab.id, { action: "AI_CHAT_META", notice });
  }
  const context = {
    type: selectionText ? "selection" : Object.keys(page).length ? "page" : "none",
    selectionText: selectionText || "",
    ...page
  };
  const prompt = replacePlaceholders(item.prompt, context);
  const displayPrompt = replacePlaceholders(item.prompt, { selectionText: "", pageText: "", pageTitle: "", pageUrl: "" }).replace(/\n{3,}/g, "\n\n").trim() || item.title;
  await startNewConversation(tab.id, {
    prompt,
    displayPrompt,
    displayContext: context,
    title: item.title,
    processed: true,
    model: item.model || settings.defaultPromptModel,
    thinking: normalizeThinking(item.thinking, settings.defaultThinking),
    reasoningMaxTokens: Number(item.reasoningMaxTokens || settings.defaultReasoningMaxTokens) || 2000,
    context: { type: "none" },
    contextForHistory: context,
    temporary,
    source: "sidepanel",
    announceSurface: true
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  try {
    if (info.menuItemId === "ai-ask-selection") return void openComposer(tab, "selection");
    if (info.menuItemId === "ai-ask-page") return void openComposer(tab, "page");
    if (info.menuItemId === "ai-summarize-page") return void summarizePage(tab);
    if (!String(info.menuItemId).startsWith("ai-template-")) return;
    await runPromptTemplate(tab, Number(String(info.menuItemId).replace("ai-template-", "")), info.selectionText || "");
  } catch (error) {
    await emitChatEvent(tab.id, { action: "AI_CHAT_ERROR", error: error.message || String(error) });
  }
});

chrome.commands.onCommand.addListener(async (command, commandTab) => {
  const tab = commandTab?.id ? commandTab : await getActiveTab();
  if (!tab) return;
  if (command === "ask-ai") await openComposer(tab, "auto");
  if (command === "ask-page") await openComposer(tab, "page");
  if (command === "summarize-page") await summarizePage(tab);
});

function reportChatError(tabId) {
  return error => emitChatEvent(tabId, { action: "AI_CHAT_ERROR", error: error.message || String(error) });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  (async () => {
    switch (message.action) {
      case "UPDATE_AI_CONTEXT_MENUS":
        createContextMenus((await getSettings()).menuItems);
        return { ok: true };
      case "FETCH_OPENROUTER_MODELS":
        return { ok: true, models: await fetchOpenRouterModels(message) };
      case "GET_OPENROUTER_MODELS":
        return { ok: true, models: await getModelCatalog() };
      case "OPEN_AI_FROM_POPUP": {
        const tab = message.targetTabId ? await chrome.tabs.get(message.targetTabId) : await getActiveTab();
        return openComposer(tab, message.mode || "auto", !message.panelAlreadyOpen);
      }
      case "OPEN_SIDE_PANEL_FROM_POPUP": {
        const tab = message.targetTabId ? await chrome.tabs.get(message.targetTabId) : await getActiveTab();
        if (!tab?.id || !chrome.sidePanel) return { ok: false, error: "Боковая панель недоступна." };
        return openComposer(tab, "auto", !message.panelAlreadyOpen);
      }
      case "SUMMARIZE_AI_FROM_POPUP": {
        const tab = message.targetTabId ? await chrome.tabs.get(message.targetTabId) : await getActiveTab();
        if (!tab) return { ok: false, error: "Активная вкладка не найдена." };
        summarizePage(tab, !message.panelAlreadyOpen);
        return { ok: true };
      }
      case "RUN_AI_PROMPT": {
        const targetTabId = message.tabId || tabId;
        if (!targetTabId) return { ok: false };
        runPromptTemplate({ id: targetTabId }, Number(message.index), message.selectionText || "", { openPanel: false, temporary: Boolean(message.temporary) }).catch(reportChatError(targetTabId));
        return { ok: true };
      }
      case "START_AI_CHAT": {
        const targetTabId = message.tabId || tabId;
        if (!targetTabId) return { ok: false };
        startNewConversation(targetTabId, message).catch(reportChatError(targetTabId));
        return { ok: true };
      }
      case "CONTINUE_AI_CHAT": {
        const targetTabId = message.tabId || tabId;
        if (!targetTabId) return { ok: false };
        continueConversation(targetTabId, message).catch(reportChatError(targetTabId));
        return { ok: true };
      }
      case "REGENERATE_AI_CHAT": {
        const targetTabId = message.tabId || tabId;
        if (!targetTabId) return { ok: false };
        regenerateConversation(targetTabId, message).catch(reportChatError(targetTabId));
        return { ok: true };
      }
      case "EDIT_AI_MESSAGE": {
        const targetTabId = message.tabId || tabId;
        if (!targetTabId) return { ok: false };
        editConversation(targetTabId, message).catch(reportChatError(targetTabId));
        return { ok: true };
      }
      case "GET_ACTIVE_AI_CHAT": {
        const targetTab = message.tabId ? { id: message.tabId } : await getActiveTab();
        if (!targetTab?.id) return { ok: false };
        const session = await loadSession(targetTab.id);
        const settings = await getSettings();
        return { ok: true, tabId: targetTab.id, session, draft: drafts.get(targetTab.id) || null, generating: activeRequests.has(targetTab.id), sendOnEnter: settings.sendOnEnter, theme: settings.theme, model: settings.quickModel, thinking: settings.quickThinking, reasoningMaxTokens: settings.quickReasoningMaxTokens, modelCatalog: settings.apiProvider === "openrouter" ? await getModelCatalog() : [], recentModels: settings.recentModels || [], menuItems: settings.menuItems || [], pageContextLimit: settings.pageContextLimit, sidePanelTabBehavior: settings.sidePanelTabBehavior };
      }
      // Cheap poll used while streaming: no settings, catalog or message history.
      case "GET_GENERATION_STATE": {
        const session = sessions.get(message.tabId) || null;
        return { ok: true, generating: activeRequests.has(message.tabId), sessionId: session?.id || null, lastRole: session?.messages?.at(-1)?.role || null, partialAnswer: session?.partialAnswer || "", partialReasoning: session?.partialReasoning || "" };
      }
      case "AI_SELECTION_CHANGED": {
        if (!tabId) return { ok: false };
        chrome.runtime.sendMessage({ action: "AI_SELECTION_UPDATED", sourceTabId: tabId, selectionText: message.selectionText || "" }).catch(() => {});
        return { ok: true };
      }
      case "GET_TAB_SELECTION": {
        const targetTabId = message.tabId || tabId;
        if (!targetTabId || !(await ensureContentScript(targetTabId))) return { ok: false, selectionText: "" };
        return { ok: true, ...(await sendToTab(targetTabId, { action: "GET_AI_SELECTION" })) };
      }
      case "PREVIEW_PAGE_CONTEXT": {
        const targetTabId = message.tabId || tabId;
        if (!targetTabId) return { ok: false };
        const settings = await getSettings();
        const context = await collectPageContext(targetTabId, Boolean(message.includeLinks), settings.pageContextLimit).catch(error => ({ error }));
        if (context.error) return { ok: false, error: context.error.message };
        return { ok: true, length: context.pageText.length, limit: settings.pageContextLimit, linkCount: context.pageLinks?.length || 0, title: context.pageTitle, url: context.pageUrl };
      }
      case "OPEN_AI_CHAT_WINDOW": {
        const targetTabId = message.tabId || tabId;
        if (!targetTabId) return { ok: false, error: "Вкладка чата не найдена." };
        if (message.draft) drafts.set(targetTabId, { ...message.draft, mode: "none", selectionText: "" });
        const settings = await getSettings();
        const browserWindow = await chrome.windows.getCurrent().catch(() => null);
        const compact = Number(browserWindow?.width || 1200) < 900;
        const remembered = await storageGet("local", ["rememberedChatWindowWidth", "rememberedCompactChatWindowWidth"]);
        const configured = compact ? settings.chatWindowCompactWidth : settings.chatWindowWidth;
        const rememberedWidth = compact ? remembered.rememberedCompactChatWindowWidth : remembered.rememberedChatWindowWidth;
        const width = settings.rememberChatWindowWidth && rememberedWidth ? rememberedWidth : configured;
        const url = chrome.runtime.getURL(`sidepanel.html?tabId=${targetTabId}&window=1&compact=${compact ? 1 : 0}`);
        const createdWindow = await chrome.windows.create({ url, type: "popup", width: Math.max(420, Number(width) || 760), height: 760 });
        const temporary = sessions.get(targetTabId)?.temporary || drafts.get(targetTabId)?.temporary;
        if (temporary && createdWindow?.id != null) temporaryWindows.set(createdWindow.id, targetTabId);
        if (chrome.sidePanel?.close) {
          const targetTab = await chrome.tabs.get(targetTabId).catch(() => null);
          if (targetTab?.windowId != null) await chrome.sidePanel.close({ windowId: targetTab.windowId }).catch(() => {});
        }
        return { ok: true };
      }
      case "SAVE_AI_CHAT_WINDOW_WIDTH": {
        const settings = await getSettings();
        if (!settings.rememberChatWindowWidth) return { ok: true };
        const key = message.compact ? "rememberedCompactChatWindowWidth" : "rememberedChatWindowWidth";
        await storageSet("local", { [key]: Math.max(420, Math.min(1800, Number(message.width) || 760)) });
        return { ok: true };
      }
      case "FORGET_TEMPORARY_CHAT": {
        const targetTabId = message.tabId || tabId;
        if (targetTabId) await forgetTemporaryChat(targetTabId);
        return { ok: true };
      }
      case "SAVE_AI_DRAFT": {
        const targetTabId = message.tabId || tabId;
        if (!targetTabId) return { ok: false };
        if (message.draft) {
          const previous = drafts.get(targetTabId) || {};
          drafts.set(targetTabId, { ...previous, ...message.draft, images: Object.hasOwn(message.draft, "images") ? message.draft.images : (previous.images || []) });
        } else drafts.delete(targetTabId);
        return { ok: true };
      }
      case "RESET_AI_CHAT": {
        const targetTabId = message.tabId || tabId;
        if (!targetTabId) return { ok: false };
        await stopGeneration(targetTabId);
        sessions.delete(targetTabId); drafts.delete(targetTabId);
        if (chrome.storage.session) await chrome.storage.session.remove(`chat_${targetTabId}`);
        return { ok: true };
      }
      case "GET_SAVED_AI_CHATS": {
        const { chats = [] } = await storageGet("local", ["chats"]);
        const settings = await getSettings();
        return { ok: true, chats, recentChatsLimit: settings.recentChatsLimit };
      }
      case "DELETE_SAVED_AI_CHATS": {
        const result = await deleteSavedChats(Array.isArray(message.chatIds) ? message.chatIds : [message.chatId]);
        return { ok: true, ...result };
      }
      case "OPEN_SAVED_AI_CHAT": {
        const targetTab = message.targetTabId ? await chrome.tabs.get(message.targetTabId) : await getActiveTab();
        if (!targetTab?.id) return { ok: false, error: "Не найдена вкладка, к которой можно привязать чат." };
        const { chats = [] } = await storageGet("local", ["chats"]);
        const chat = chats.find(item => item.id === message.chatId);
        if (!chat) return { ok: false, error: "Чат не найден." };
        await stopGeneration(targetTab.id, true);
        sessions.set(targetTab.id, { ...chat });
        drafts.delete(targetTab.id);
        await persistSession(targetTab.id, chat);
        if (!message.panelAlreadyOpen) chrome.sidePanel.open({ tabId: targetTab.id }).catch(console.error);
        chrome.runtime.sendMessage({ action: "AI_SURFACE_OWNER", sourceTabId: targetTab.id, surfaceOwner: "sidepanel", newChat: true, savedChat: true }).catch(() => {});
        return { ok: true };
      }
      case "REFRESH_USD_RUB_RATE":
        return { ok: true, rate: await refreshUsdRubRate({ force: true, source: message.source }) };
      case "STOP_AI_CHAT":
        if (message.tabId || tabId) await stopGeneration(message.tabId || tabId);
        return { ok: true };
      case "GET_AI_SETTINGS_SUMMARY": {
        const settings = await getSettings();
        return { model: settings.quickModel, server: settings.apiServer, provider: settings.apiProvider, caching: settings.enableCaching, theme: settings.theme, recentChatsLimit: settings.recentChatsLimit, hasApiKey: Boolean(settings.apiKey) };
      }
      default:
        return null;
    }
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  stopGeneration(tabId);
  sessions.delete(tabId);
  drafts.delete(tabId);
  if (chrome.storage.session) chrome.storage.session.remove(`chat_${tabId}`);
});

if (chrome.windows?.onRemoved) chrome.windows.onRemoved.addListener(windowId => {
  const tabId = temporaryWindows.get(windowId);
  if (!tabId) return;
  temporaryWindows.delete(windowId);
  forgetTemporaryChat(tabId);
});

if (chrome.sidePanel?.onClosed) chrome.sidePanel.onClosed.addListener(info => {
  if (info.tabId != null) {
    if (![...temporaryWindows.values()].includes(info.tabId)) forgetTemporaryChat(info.tabId);
    return;
  }
  for (const [tabId, session] of sessions) if (session.temporary && ![...temporaryWindows.values()].includes(tabId)) forgetTemporaryChat(tabId);
  for (const [tabId, draft] of drafts) if (draft.temporary && ![...temporaryWindows.values()].includes(tabId)) forgetTemporaryChat(tabId);
});
