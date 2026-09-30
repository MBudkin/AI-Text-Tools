// Helpers shared by the side panel, popup, history and options pages.
// Loaded in <head> so the cached theme is applied before the first paint.

/* ---------- Theme ---------- */

const THEME_CACHE_KEY = "aitt-theme";
const THEME_LABELS = { system: "как в системе", light: "светлая", dark: "тёмная" };
const lightMedia = matchMedia("(prefers-color-scheme: light)");
let themePreference = readCachedTheme();

function readCachedTheme() {
  try { return localStorage.getItem(THEME_CACHE_KEY) || "system"; } catch { return "system"; }
}

function resolveTheme(preference) {
  if (preference === "light" || preference === "dark") return preference;
  return lightMedia.matches ? "light" : "dark";
}

function applyThemePreference(preference) {
  themePreference = ["light", "dark", "system"].includes(preference) ? preference : "system";
  const resolved = resolveTheme(themePreference);
  document.documentElement.dataset.theme = resolved;
  try { localStorage.setItem(THEME_CACHE_KEY, themePreference); } catch {}
  document.dispatchEvent(new CustomEvent("aitt-themechange", { detail: { preference: themePreference, resolved } }));
}

async function cycleTheme() {
  const next = { system: "light", light: "dark", dark: "system" }[themePreference] || "system";
  applyThemePreference(next);
  await chrome.storage.sync.set({ theme: next });
  return next;
}

function bindThemeButton(button) {
  const render = () => {
    const iconName = { system: "monitor", light: "sun", dark: "moon" }[themePreference] || "monitor";
    button.innerHTML = icon(iconName);
    const label = `Тема: ${THEME_LABELS[themePreference] || THEME_LABELS.system}. Нажмите, чтобы сменить`;
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  render();
  document.addEventListener("aitt-themechange", render);
  button.addEventListener("click", () => cycleTheme());
}

applyThemePreference(themePreference);
lightMedia.addEventListener("change", () => { if (themePreference === "system") applyThemePreference("system"); });
chrome.storage.sync.get("theme").then(result => applyThemePreference(result.theme || "system"), () => {});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.theme) applyThemePreference(changes.theme.newValue || "system");
});

/* ---------- Icons (Lucide, ISC license) ---------- */

const ICONS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  sliders: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  image: '<path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  stop: '<rect width="10" height="10" x="7" y="7" rx="1.5" fill="currentColor" stroke="none"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  newChat: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  page: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'
};

function icon(name, className = "") {
  return `<svg class="icon-svg ${className}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

function iconButton(name, label, handler, className = "icon-btn sm") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.innerHTML = icon(name);
  button.title = label;
  button.setAttribute("aria-label", label);
  if (handler) button.addEventListener("click", handler);
  return button;
}

/* ---------- Formatting ---------- */

function money(value) {
  const number = Number(value) || 0, absolute = Math.abs(number);
  if (!absolute || absolute >= .01) return number.toFixed(2);
  const decimals = Math.min(8, Math.max(2, Math.ceil(-Math.log10(absolute)) + 1));
  return number.toFixed(decimals);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatCount(value) { return Number(value || 0).toLocaleString("ru-RU"); }

function contentText(content) {
  return typeof content === "string" ? content : (content || []).filter(part => part.type === "text").map(part => part.text).join("\n");
}

function countMessageImages(content) {
  return Array.isArray(content) ? content.filter(part => part.type === "image_url" || (part.type === "text" && /^\[Изображение было приложено/.test(part.text || ""))).length : 0;
}

function messageImageUrls(message = {}) {
  const originals = Array.isArray(message.content) ? message.content.filter(part => part?.type === "image_url").map(part => part.image_url?.url).filter(Boolean) : [];
  const previews = Array.isArray(message.imagePreviews) ? message.imagePreviews.filter(Boolean) : [];
  return originals.length ? originals : previews;
}

async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const area = document.createElement("textarea");
  area.value = text; area.style.cssText = "position:fixed;left:-9999px";
  document.body.append(area); area.select();
  const copied = document.execCommand("copy");
  area.remove();
  return copied;
}

/* ---------- Reasoning options ---------- */

const REASONING_LABELS = { none: "Нет", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max", custom: "Custom" };

function migrateReasoning(value) { return value === "on" ? "medium" : value === "off" || !value ? "none" : value; }

function modelSupportsReasoning(model) {
  return !model || Boolean(model.reasoning?.mandatory) || model.supported_parameters?.includes("reasoning") || Boolean(model.reasoning);
}

function setReasoningOptions(select, model, current = "none") {
  const mandatory = Boolean(model?.reasoning?.mandatory);
  const supported = modelSupportsReasoning(model);
  let efforts = Array.isArray(model?.reasoning?.supported_efforts) && model.reasoning.supported_efforts.length ? model.reasoning.supported_efforts : ["low", "medium", "high"];
  if (!supported) efforts = [];
  const values = [...new Set([...(!mandatory ? ["none"] : []), ...efforts, ...(supported && model?.reasoning?.supports_max_tokens !== false ? ["custom"] : [])])];
  select.innerHTML = values.map(value => `<option value="${value}">${REASONING_LABELS[value] || value}</option>`).join("");
  const wanted = migrateReasoning(current);
  select.value = values.includes(wanted) ? wanted : (model?.reasoning?.default_effort && values.includes(model.reasoning.default_effort) ? model.reasoning.default_effort : values[0] || "none");
  return values;
}

function modelPrice(model) {
  if (!model?.pricing || model.pricing.prompt == null) return "";
  const prompt = Number(model.pricing.prompt || 0) * 1_000_000, completion = Number(model.pricing.completion || 0) * 1_000_000;
  if (!prompt && !completion) return "бесплатно";
  if (rublesEnabled()) return `${formatRub(prompt)} / ${formatRub(completion)}`;
  return `$${prompt.toFixed(2)} / $${completion.toFixed(2)}`;
}

/* ---------- Currency ---------- */

// OpenRouter reports costs in USD; optionally show them in rubles using the
// daily rate that background.js stores in storage.local (or a manual rate).
const CURRENCY_CACHE_KEY = "aitt-currency";
const CURRENCY_SETTINGS = ["showRub", "rubDisplay", "rubRateSource", "rubManualRate"];
let currencyState = readCachedCurrency();

function readCachedCurrency() {
  try { return JSON.parse(localStorage.getItem(CURRENCY_CACHE_KEY)) || {}; } catch { return {}; }
}

function effectiveRubRate(settings, stored) {
  const rate = settings.rubRateSource === "manual" ? Number(settings.rubManualRate) : Number(stored?.rate);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

async function loadCurrencyState() {
  try {
    const [settings, local] = await Promise.all([chrome.storage.sync.get(CURRENCY_SETTINGS), chrome.storage.local.get("usdRubRate")]);
    const next = { showRub: Boolean(settings.showRub), rubDisplay: settings.rubDisplay || "both", rate: effectiveRubRate(settings, local.usdRubRate) };
    const changed = JSON.stringify(next) !== JSON.stringify(currencyState);
    currencyState = next;
    try { localStorage.setItem(CURRENCY_CACHE_KEY, JSON.stringify(next)); } catch {}
    if (changed) document.dispatchEvent(new CustomEvent("aitt-currencychange"));
  } catch {}
}

function rublesEnabled() { return Boolean(currencyState.showRub && currencyState.rate > 0); }

function formatRub(rubles) {
  const value = Number(rubles) || 0;
  if (Math.abs(value) >= 1) return `${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
  return `${money(value).replace(".", ",")} ₽`;
}

// Cost label for a USD amount according to the currency settings.
function formatCost(usd) {
  const dollars = `$${money(usd)}`;
  if (!rublesEnabled()) return dollars;
  const rubles = formatRub(Number(usd) * currencyState.rate);
  return currencyState.rubDisplay === "rub" ? rubles : `${rubles} (${dollars})`;
}

loadCurrencyState();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName === "sync" && CURRENCY_SETTINGS.some(key => changes[key])) || (areaName === "local" && changes.usdRubRate)) loadCurrencyState();
});

/* ---------- Markdown ---------- */

// Remote images in model output would load without a click and can leak
// prompt or page data through the URL, so only inline data images render.
function replaceRemoteImage(image) {
  const src = image.getAttribute("src") || "";
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);/i.test(src)) return;
  const label = `🖼 ${image.getAttribute("alt") || "Внешнее изображение"}`;
  try {
    const url = new URL(src);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported image protocol");
    const link = document.createElement("a"); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; link.title = url.href; link.textContent = label;
    image.replaceWith(link);
  } catch { image.replaceWith(document.createTextNode(label)); }
}

function safeMarkdown(text, renderMath = true) {
  const template = document.createElement("template");
  template.innerHTML = marked.parse(normalizeMathSource(text));
  template.content.querySelectorAll("script,style,iframe,frame,object,embed,form,input,button,textarea,select,meta,link,base,svg,math").forEach(node => node.remove());
  template.content.querySelectorAll("*").forEach(node => {
    [...node.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || ["style", "srcset", "srcdoc", "formaction", "xlink:href", "background"].includes(name) || /javascript:/i.test(attr.value.replace(/[\x00-\x20]/g, ""))) node.removeAttribute(attr.name);
    });
    if (node.tagName === "IMG") return replaceRemoteImage(node);
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

function constrainTableColumns(table) {
  table.querySelectorAll("th,td").forEach(cell => {
    if (cell.children.length === 1 && cell.firstElementChild?.classList.contains("table-cell-content")) return;
    const content = document.createElement("div"); content.className = "table-cell-content";
    while (cell.firstChild) content.append(cell.firstChild);
    cell.append(content);
  });
}

/* ---------- Lightweight syntax highlighting ---------- */

const HASH_COMMENT_LANGUAGES = /^(?:py|python|sh|bash|zsh|shell|ps1|powershell|yaml|yml|toml|ruby|rb|r|perl|dockerfile|makefile|ini|conf)$/i;
const CODE_KEYWORDS = new Set("abstract and as async await break case catch class const continue def default del do elif else enum except export extends false final finally fn for from func function go if impl import in instanceof interface is lambda let match module mut new nil none not null of or package pass private protected pub public raise return self select static struct super switch this throw throws true try type typeof undefined use var void where while with yield True False None".split(" "));

// Tokenizes strings, comments, numbers and common keywords. It is deliberately
// language-agnostic: good enough to make code scannable without a 100 KB library.
function highlightCode(code) {
  if (!code || code.dataset.highlighted || code.textContent.length > 30000) return;
  const language = (code.className.match(/language-([\w+-]+)/) || [])[1] || "";
  if (/^(?:text|plain|plaintext|txt|markdown|md|diff)$/i.test(language)) return;
  const hashComments = HASH_COMMENT_LANGUAGES.test(language);
  const pattern = new RegExp([
    "(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*" + (hashComments ? "|#[^\\n]*" : "") + ")",
    "(\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*'|`(?:\\\\.|[^`\\\\])*`)",
    "(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b|\\b0x[\\da-f]+\\b)",
    "([A-Za-z_]\\w*)"
  ].join("|"), "gi");
  const source = code.textContent;
  let html = "", last = 0;
  for (const match of source.matchAll(pattern)) {
    const [token, comment, string, number, word] = match;
    const kind = comment ? "c" : string ? "s" : number ? "n" : word && CODE_KEYWORDS.has(word) ? "k" : "";
    if (!kind) continue;
    html += escapeHtml(source.slice(last, match.index)) + `<span class="tok-${kind}">${escapeHtml(token)}</span>`;
    last = match.index + token.length;
  }
  code.innerHTML = html + escapeHtml(source.slice(last));
  code.dataset.highlighted = "1";
}

// Wraps code blocks and tables with a header row holding a label and a copy button.
function decorateMarkdownBlocks(root, { onCopy } = {}) {
  root.querySelectorAll("pre").forEach(pre => {
    if (pre.parentElement?.classList.contains("code-wrap")) return;
    const code = pre.querySelector("code");
    const language = ((code?.className || "").match(/language-([\w+-]+)/) || [])[1] || "код";
    const wrap = document.createElement("div"); wrap.className = "code-wrap";
    const head = document.createElement("div"); head.className = "block-head";
    const label = document.createElement("span"); label.textContent = language;
    const copy = iconButton("copy", "Копировать код", () => onCopy?.(code?.innerText || pre.innerText));
    copy.classList.add("block-copy");
    head.append(label, copy);
    pre.replaceWith(wrap); wrap.append(head, pre);
    highlightCode(code);
  });
  root.querySelectorAll("table").forEach(table => {
    if (table.closest(".table-wrap")) return;
    constrainTableColumns(table);
    const wrap = document.createElement("div"); wrap.className = "table-wrap";
    const head = document.createElement("div"); head.className = "block-head";
    const label = document.createElement("span"); label.textContent = "таблица";
    const copy = iconButton("copy", "Копировать таблицу", () => onCopy?.(table.innerText));
    copy.classList.add("block-copy");
    head.append(label, copy);
    const scroll = document.createElement("div"); scroll.className = "table-scroll";
    table.replaceWith(wrap); scroll.append(table); wrap.append(head, scroll);
  });
}

/* ---------- Searchable model picker ---------- */

// Replaces a <datalist>: with hundreds of OpenRouter models the native list is
// unusable, and it cannot show prices or capabilities.
function attachModelPicker(input, getModels) {
  const listId = `model-picker-${Math.random().toString(36).slice(2)}`;
  const popup = document.createElement("div");
  popup.className = "model-picker";
  popup.id = listId;
  popup.setAttribute("role", "listbox");
  // Attached only while open, so re-rendered inputs never leave popups behind.
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");
  input.autocomplete = "off";
  let items = [], active = -1;

  const isOpen = () => popup.isConnected;
  const close = () => { popup.remove(); input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
  const place = () => {
    const rect = input.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom, above = rect.top;
    const height = Math.min(300, Math.max(below, above) - 12);
    popup.style.left = `${Math.max(6, rect.left)}px`;
    popup.style.width = `${Math.min(window.innerWidth - 12, Math.max(rect.width, 260))}px`;
    popup.style.maxHeight = `${height}px`;
    if (below >= 200 || below >= above) { popup.style.top = `${rect.bottom + 4}px`; popup.style.bottom = ""; }
    else { popup.style.bottom = `${window.innerHeight - rect.top + 4}px`; popup.style.top = ""; }
  };
  const highlight = index => {
    active = index;
    popup.querySelectorAll(".model-option").forEach((node, i) => node.setAttribute("aria-selected", String(i === index)));
    const node = popup.children[index];
    if (node) { input.setAttribute("aria-activedescendant", node.id); node.scrollIntoView({ block: "nearest" }); }
  };
  const choose = model => {
    input.value = model.id;
    close();
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const render = () => {
    const query = input.value.trim().toLowerCase();
    const models = getModels();
    const terms = query.split(/\s+/).filter(Boolean);
    const exact = models.some(model => model.id.toLowerCase() === query);
    items = (exact ? models : models.filter(model => terms.every(term => `${model.id} ${model.name || ""}`.toLowerCase().includes(term)))).slice(0, 80);
    if (!items.length) { popup.innerHTML = `<div class="model-empty">${models.length ? "Нет совпадений — будет использован введённый ID" : "Каталог моделей не загружен"}</div>`; return; }
    popup.innerHTML = items.map((model, index) => {
      const badges = [
        model.input_modalities?.includes("image") ? '<span class="badge">изображения</span>' : "",
        model.reasoning?.mandatory ? '<span class="badge">reasoning обяз.</span>' : model.supported_parameters?.includes("reasoning") || model.reasoning ? '<span class="badge">reasoning</span>' : "",
        model.context_length ? `<span class="badge">${Math.round(model.context_length / 1000)}K</span>` : ""
      ].join("");
      const price = modelPrice(model);
      return `<div class="model-option" id="${listId}-${index}" role="option" aria-selected="false" data-index="${index}"><div class="model-option-main"><span class="model-name">${escapeHtml(model.name || model.id)}</span>${price ? `<span class="model-price">${price}</span>` : ""}</div><div class="model-option-sub"><span class="model-id">${escapeHtml(model.id)}</span>${badges}</div></div>`;
    }).join("");
    const selected = items.findIndex(model => model.id === input.value.trim());
    if (selected >= 0) highlight(selected);
  };
  const open = () => { if (!input.isConnected) return; if (!isOpen()) document.body.append(popup); render(); place(); input.setAttribute("aria-expanded", "true"); };

  input.addEventListener("focus", () => { open(); input.select(); });
  input.addEventListener("click", () => { if (!isOpen()) open(); });
  input.addEventListener("input", () => { open(); if (items.length) highlight(0); });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen()) open();
      if (!items.length) return;
      highlight((active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (isOpen() && items[active]) choose(items[active]);
      else { close(); input.dispatchEvent(new Event("change", { bubbles: true })); }
    } else if (event.key === "Escape" && isOpen()) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  });
  popup.addEventListener("mousedown", event => {
    event.preventDefault();
    const option = event.target.closest(".model-option");
    if (option) choose(items[Number(option.dataset.index)]);
  });
  window.addEventListener("resize", () => { if (isOpen()) place(); });
  return { close, refresh: () => { if (isOpen()) render(); } };
}
