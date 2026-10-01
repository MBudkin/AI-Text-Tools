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
  showRub: false,
  rubDisplay: "both",
  rubRateSource: "cbr",
  rubManualRate: 90,
  menuItems: []
};

let menuItems = [];
let recentModels = [];
let modelCatalog = [];
const ids = ["apiProvider", "apiServer", "apiKey", "defaultPromptModel", "quickModel", "systemPrompt", "defaultThinking", "quickThinking", "defaultReasoningMaxTokens", "quickReasoningMaxTokens", "chatWindowWidth", "chatWindowCompactWidth", "rememberChatWindowWidth", "sidePanelTabBehavior", "pageSummaryPrompt", "pageContextLimit", "enableCaching", "cacheTtl", "historyLimit", "recentChatsLimit", "sendOnEnter", "theme", "showRub", "rubDisplay", "rubRateSource", "rubManualRate"];
const byId = id => document.getElementById(id);

const IMPORTABLE_KEYS = new Set([...ids, "apiModel", "menuItems", "recentModels", "favoriteModels"]);

document.addEventListener("DOMContentLoaded", loadSettings);

const pickerModels = () => modelCatalog.length ? modelCatalog : recentModels.map(id => ({ id, name: id }));
attachModelPicker(byId("defaultPromptModel"), pickerModels);
attachModelPicker(byId("quickModel"), pickerModels);
// Preview immediately; the choice is stored with the other settings on save.
byId("theme").addEventListener("change", () => applyThemePreference(byId("theme").value));

async function loadSettings() {
  byId("version").textContent = `Версия ${chrome.runtime.getManifest().version} · Manifest V3`;
  const [stored, secrets] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get("apiKey")]);
  const settings = { ...DEFAULTS, ...stored, apiKey: secrets.apiKey || stored.apiKey || "" };
  settings.defaultThinking = migrateReasoning(settings.defaultThinking);
  settings.quickThinking = migrateReasoning(settings.quickThinking);
  setReasoningOptions(byId("defaultThinking"), null, settings.defaultThinking);
  setReasoningOptions(byId("quickThinking"), null, settings.quickThinking);
  settings.defaultPromptModel ||= stored.apiModel || DEFAULTS.defaultPromptModel;
  settings.quickModel ||= stored.apiModel || DEFAULTS.quickModel;
  for (const id of ids) {
    const element = byId(id);
    if (element.type === "checkbox") element.checked = Boolean(settings[id]);
    else if (id === "sendOnEnter") element.value = String(settings[id] !== false);
    else element.value = settings[id] ?? "";
  }
  menuItems = Array.isArray(settings.menuItems) ? settings.menuItems.map(item => ({ ...item })) : [];
  recentModels = settings.recentModels || [];
  const catalogData = await chrome.storage.local.get(["openRouterModels", "openRouterModelsUpdatedAt"]);
  modelCatalog = catalogData.openRouterModels || [];
  if (modelCatalog.length) byId("modelsStatus").textContent = `${modelCatalog.length} моделей · обновлено ${new Date(catalogData.openRouterModelsUpdatedAt || Date.now()).toLocaleString("ru-RU")}`;
  renderRecentModels();
  renderPrompts();
  updateProviderUI();
  updateModelCapabilities();
  updateCurrencyUI();
  renderRateStatus();
  if (settings.apiProvider === "openrouter" && settings.apiKey && !modelCatalog.length) setTimeout(() => byId("loadModels").click(), 0);
}

function renderRecentModels() {
  const models = modelCatalog.length ? modelCatalog : recentModels.map(id => ({ id, name: id, pricing: {}, input_modalities: [] }));
  byId("recentModels").innerHTML = models.map(model => `<option value="${escapeAttribute(model.id)}" label="${escapeAttribute(modelOptionLabel(model))}"></option>`).join("");
}

function modelOptionLabel(model) {
  const prompt = Number(model.pricing?.prompt || 0) * 1_000_000;
  const completion = Number(model.pricing?.completion || 0) * 1_000_000;
  const flags = [model.input_modalities?.includes("image") ? "изображения" : "", model.reasoning?.mandatory ? "reasoning обязателен" : model.supported_parameters?.includes("reasoning") ? "reasoning" : ""].filter(Boolean).join(", ");
  return `${model.name || model.id} · $${prompt.toFixed(2)}/$${completion.toFixed(2)} за 1M${flags ? ` · ${flags}` : ""}`;
}

function updateProviderUI() {
  const openRouter = byId("apiProvider").value === "openrouter";
  byId("loadModels").style.display = openRouter ? "inline-flex" : "none";
  if (openRouter && (!byId("apiServer").value || byId("apiServer").value.includes("openrouter.ai"))) byId("apiServer").value = "https://openrouter.ai/api/v1";
}

function updateModelCapabilities() {
  updateModelCapability("defaultPromptModel", "defaultThinking", "defaultModelInfo");
  updateModelCapability("quickModel", "quickThinking", "quickModelInfo");
}

function updateModelCapability(inputId, thinkingId, infoId) {
  const model = modelCatalog.find(item => item.id === byId(inputId).value.trim());
  if (!model) return;
  const thinking = byId(thinkingId);
  const mandatory = Boolean(model.reasoning?.mandatory);
  const supported = mandatory || model.supported_parameters?.includes("reasoning") || Boolean(model.reasoning);
  setReasoningOptions(thinking, model, thinking.value);
  const input = model.input_modalities?.includes("image") ? "поддерживает изображения" : "только текст";
  byId(infoId).textContent = `${model.name || model.id} · ${input} · ${mandatory ? "reasoning обязателен" : supported ? "reasoning доступен" : "без reasoning"}`;
}


byId("apiProvider").addEventListener("change", updateProviderUI);
byId("defaultPromptModel").addEventListener("change", updateModelCapabilities);
byId("quickModel").addEventListener("change", updateModelCapabilities);
byId("loadModels").addEventListener("click", async () => {
  try {
    byId("modelsStatus").textContent = "Загружаем каталог…";
    const result = await chrome.runtime.sendMessage({ action: "FETCH_OPENROUTER_MODELS", apiServer: byId("apiServer").value.trim(), apiKey: byId("apiKey").value.trim() });
    if (!result?.ok) throw new Error(result?.error || "Неизвестная ошибка");
    modelCatalog = result.models; renderRecentModels(); renderPrompts(); updateModelCapabilities();
    byId("modelsStatus").textContent = `${modelCatalog.length} моделей загружено.`;
  } catch (error) { byId("modelsStatus").textContent = error.message; }
});

function renderPrompts() {
  const list = byId("promptList");
  list.innerHTML = "";
  if (!menuItems.length) list.innerHTML = '<div class="lead">Промптов пока нет. Добавьте первый пункт.</div>';
  menuItems.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "prompt-card";
    card.innerHTML = `<div class="prompt-head"><input class="title" type="text" aria-label="Название" placeholder="Название пункта" value="${escapeAttribute(item.title || "")}"><div class="prompt-actions"><button type="button" data-up title="Выше" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-down title="Ниже" ${index === menuItems.length - 1 ? "disabled" : ""}>↓</button><button type="button" class="danger" data-delete title="Удалить">×</button></div></div>
      <div class="prompt-grid"><textarea class="prompt" aria-label="Текст промпта" placeholder="Инструкция модели">${escapeHtml(item.prompt || "")}</textarea><div class="stack"><input class="model" type="text" placeholder="Модель по умолчанию" value="${escapeAttribute(item.model || "")}"><select class="thinking"></select><input class="reasoning-budget" type="number" min="1" max="128000" step="100" value="${Number(item.reasoningMaxTokens) || 2000}" title="Custom reasoning budget"><span class="help">Пустая модель использует модель промптов по умолчанию.</span></div></div>`;
    card.querySelector(".title").addEventListener("input", event => item.title = event.target.value);
    card.querySelector(".prompt").addEventListener("input", event => item.prompt = event.target.value);
    const modelInput = card.querySelector(".model");
    attachModelPicker(modelInput, pickerModels);
    const thinkingSelect = card.querySelector(".thinking");
    setReasoningOptions(thinkingSelect, null, item.thinking === "default" ? "none" : item.thinking);
    const defaultOption = document.createElement("option"); defaultOption.value = "default"; defaultOption.textContent = "По умолчанию"; thinkingSelect.prepend(defaultOption); thinkingSelect.value = item.thinking || "default";
    const applyCapability = () => {
      item.model = modelInput.value;
      const model = modelCatalog.find(entry => entry.id === item.model.trim());
      if (!model) return;
      const mandatory = Boolean(model.reasoning?.mandatory), supported = mandatory || model.supported_parameters?.includes("reasoning") || Boolean(model.reasoning);
      if (model) { const current = thinkingSelect.value; setReasoningOptions(thinkingSelect, model, current); const defaultOption = document.createElement("option"); defaultOption.value="default"; defaultOption.textContent="По умолчанию"; thinkingSelect.prepend(defaultOption); if(current==="default")thinkingSelect.value="default"; item.thinking=thinkingSelect.value; }
    };
    modelInput.addEventListener("change", applyCapability);
    applyCapability();
    thinkingSelect.addEventListener("change", event => item.thinking = event.target.value);
    card.querySelector(".reasoning-budget").addEventListener("input", event => item.reasoningMaxTokens = Number(event.target.value));
    card.querySelector("[data-up]").addEventListener("click", () => movePrompt(index, -1));
    card.querySelector("[data-down]").addEventListener("click", () => movePrompt(index, 1));
    card.querySelector("[data-delete]").addEventListener("click", () => { menuItems.splice(index, 1); renderPrompts(); markChanged(); });
    list.appendChild(card);
  });
}

function movePrompt(index, delta) {
  const next = index + delta;
  if (next < 0 || next >= menuItems.length) return;
  [menuItems[index], menuItems[next]] = [menuItems[next], menuItems[index]];
  renderPrompts(); markChanged();
}

byId("addPrompt").addEventListener("click", () => {
  menuItems.push({ title: "Новый промпт", prompt: "Обработай следующий текст:\n\n{{selectionText}}", model: "", thinking: "default" });
  renderPrompts(); markChanged();
  document.querySelector(".prompt-card:last-child .title")?.focus();
});

document.addEventListener("input", event => { if (!event.target.closest("#savebar")) markChanged(); });
document.addEventListener("change", event => { if (!event.target.closest("#savebar")) markChanged(); });

function collectSettings() {
  const number = (id, min, max) => {
    const value = Number(byId(id).value);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${byId(id).closest("label")?.firstChild?.textContent || id}: допустимо ${min}–${max}.`);
    return value;
  };
  const defaultPromptModel = byId("defaultPromptModel").value.trim();
  const quickModel = byId("quickModel").value.trim();
  if (!byId("apiServer").value.trim()) throw new Error("Укажите адрес API.");
  if (!defaultPromptModel || !quickModel) throw new Error("Укажите обе модели по умолчанию.");
  for (const [index, item] of menuItems.entries()) if (!item.title.trim() || !item.prompt.trim()) throw new Error(`Заполните название и текст промпта №${index + 1}.`);
  return {
    apiServer: byId("apiServer").value.trim().replace(/\/$/, ""), apiKey: byId("apiKey").value.trim(),
    apiProvider: byId("apiProvider").value,
    apiModel: defaultPromptModel, defaultPromptModel, quickModel,
    systemPrompt: byId("systemPrompt").value,
    defaultThinking: byId("defaultThinking").value, quickThinking: byId("quickThinking").value,
    defaultReasoningMaxTokens: number("defaultReasoningMaxTokens", 1, 128000), quickReasoningMaxTokens: number("quickReasoningMaxTokens", 1, 128000),
    chatWindowWidth: number("chatWindowWidth", 420, 1800), chatWindowCompactWidth: number("chatWindowCompactWidth", 420, 1200), rememberChatWindowWidth: byId("rememberChatWindowWidth").checked,
    sidePanelTabBehavior: byId("sidePanelTabBehavior").value,
    pageSummaryPrompt: byId("pageSummaryPrompt").value,
    pageContextLimit: number("pageContextLimit", 5000, 200000), historyLimit: number("historyLimit", 0, 1000),
    recentChatsLimit: number("recentChatsLimit", 0, 20),
    enableCaching: byId("enableCaching").checked, cacheTtl: number("cacheTtl", 1, 86400),
    sendOnEnter: byId("sendOnEnter").value === "true", theme: byId("theme").value,
    showRub: byId("showRub").checked, rubDisplay: byId("rubDisplay").value, rubRateSource: byId("rubRateSource").value,
    rubManualRate: byId("rubRateSource").value === "manual" ? number("rubManualRate", 1, 10000) : Number(byId("rubManualRate").value) || DEFAULTS.rubManualRate,
    menuItems: menuItems.map(item => ({ title: item.title, prompt: item.prompt, model: item.model || "", thinking: item.thinking || "default", reasoningMaxTokens: Number(item.reasoningMaxTokens) || 2000 })),
    recentModels: [...new Set([defaultPromptModel, quickModel, ...menuItems.map(item => item.model).filter(Boolean), ...recentModels])].slice(0, 12)
  };
}

byId("saveSettings").addEventListener("click", async () => {
  try {
    const settings = collectSettings();
    await writeSettings(settings);
    recentModels = settings.recentModels; renderRecentModels();
    await chrome.runtime.sendMessage({ action: "UPDATE_AI_CONTEXT_MENUS" });
    setStatus("Настройки сохранены.", "ok");
  } catch (error) { setStatus(error.message, "error"); }
});

byId("exportSettings").addEventListener("click", async () => {
  try {
    const settings = collectSettings();
    if (settings.apiKey && !confirm("Включить API-ключ в файл экспорта?\n\nФайл будет содержать ключ в открытом виде. Нажмите «Отмена», чтобы экспортировать настройки без ключа.")) delete settings.apiKey;
    const url = URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "ai-text-tools-settings.json" });
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { setStatus(error.message, "error"); }
});

byId("importSettings").addEventListener("change", async event => {
  try {
    const file = event.target.files?.[0]; if (!file) return;
    const imported = JSON.parse(await file.text());
    if (!imported || typeof imported !== "object" || !Array.isArray(imported.menuItems)) throw new Error("Некорректный файл настроек.");
    if (imported.menuItems.some(item => !item || typeof item.title !== "string" || typeof item.prompt !== "string")) throw new Error("Некорректный список промптов.");
    const accepted = Object.fromEntries(Object.entries(imported).filter(([key]) => IMPORTABLE_KEYS.has(key)));
    if (!accepted.apiKey) delete accepted.apiKey;
    await writeSettings(accepted);
    await chrome.runtime.sendMessage({ action: "UPDATE_AI_CONTEXT_MENUS" });
    await loadSettings(); setStatus("Настройки импортированы.", "ok");
  } catch (error) { setStatus(`Ошибка импорта: ${error.message}`, "error"); }
  event.target.value = "";
});

// The API key stays in local storage: storage.sync would copy it to every
// browser signed in to the same Google account.
async function writeSettings(settings) {
  const { apiKey, ...syncSettings } = settings;
  await chrome.storage.sync.set(syncSettings);
  if (typeof apiKey === "string") await chrome.storage.local.set({ apiKey });
  await chrome.storage.sync.remove("apiKey");
}

const RATE_SOURCE_TITLES = { cbr: "ЦБ РФ", "er-api": "ExchangeRate-API" };

function updateCurrencyUI() {
  const manual = byId("rubRateSource").value === "manual";
  byId("manualRateField").classList.toggle("hidden", !manual);
  byId("refreshRate").classList.toggle("hidden", manual);
  byId("rubDisplay").disabled = !byId("showRub").checked;
  renderRateStatus();
}

async function renderRateStatus() {
  const node = byId("rateStatus");
  node.classList.remove("error");
  if (byId("rubRateSource").value === "manual") {
    const rate = Number(byId("rubManualRate").value);
    node.textContent = rate > 0 ? `Используется ваш курс: 1 $ = ${formatRub(rate)}` : "Укажите курс вручную.";
    return;
  }
  const { usdRubRate, usdRubRateError } = await chrome.storage.local.get(["usdRubRate", "usdRubRateError"]);
  if (usdRubRate?.rate) {
    const date = usdRubRate.date ? new Date(usdRubRate.date).toLocaleDateString("ru-RU") : "";
    const fetched = new Date(usdRubRate.fetchedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    node.textContent = `1 $ = ${formatRub(usdRubRate.rate)} · ${RATE_SOURCE_TITLES[usdRubRate.source] || usdRubRate.source}${date ? ` на ${date}` : ""} · проверено ${fetched}`;
  } else node.textContent = "Курс ещё не загружен. Он обновится автоматически после включения или по кнопке.";
  if (usdRubRateError?.message && (!usdRubRate || usdRubRateError.at > usdRubRate.fetchedAt)) {
    node.textContent += ` · ${usdRubRateError.message}`;
    node.classList.add("error");
  }
}

byId("showRub").addEventListener("change", updateCurrencyUI);
byId("rubRateSource").addEventListener("change", updateCurrencyUI);
byId("rubManualRate").addEventListener("input", renderRateStatus);
byId("refreshRate").addEventListener("click", async () => {
  const button = byId("refreshRate");
  button.disabled = true; byId("rateStatus").textContent = "Загружаем курс…";
  try {
    const result = await chrome.runtime.sendMessage({ action: "REFRESH_USD_RUB_RATE", source: byId("rubRateSource").value });
    if (!result?.ok) throw new Error(result?.error || "Неизвестная ошибка");
  } catch (error) { setStatus(error.message, "error"); }
  button.disabled = false;
  renderRateStatus();
});
chrome.storage.onChanged.addListener((changes, areaName) => { if (areaName === "local" && (changes.usdRubRate || changes.usdRubRateError)) renderRateStatus(); });

function markChanged() { setStatus("Есть несохранённые изменения.", "dirty"); }
function setStatus(message, type) { const node = byId("status"); node.textContent = message; node.className = type; }
function escapeAttribute(value) { return escapeHtml(value); }
