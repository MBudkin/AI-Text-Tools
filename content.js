(() => {
  const CONTENT_SCRIPT_VERSION = "6.7.7";
  if (globalThis.__AI_TEXT_TOOLS_LOADED__ === CONTENT_SCRIPT_VERSION) return;
  try { globalThis.__AI_TEXT_TOOLS_CLEANUP__?.(); } catch {}
  globalThis.__AI_TEXT_TOOLS_LOADED__ = CONTENT_SCRIPT_VERSION;

  const state = {
    host: null,
    root: null,
    panel: null,
    generating: false,
    view: "composer",
    mode: "auto",
    selectionText: "",
    model: "",
    thinking: "off",
    reasoningMaxTokens: 2000,
    images: [],
    answer: "",
    reasoning: "",
    responseImages: [],
    lastUserText: "",
    sendOnEnter: true,
    theme: "dark",
    pageContextLimit: 60000,
    autoStick: true,
    scrollMode: "anchor",
    totalCost: 0,
    modelCatalog: [],
    ignoreChatEvents: false,
    promptDraft: "",
    initialComposer: null,
    reasoningAutoStick: true
  };

  const STYLES = `
    :host { color-scheme: light dark; }
    * { box-sizing: border-box; }
    .backdrop { pointer-events: auto; position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(10, 14, 24, .58); backdrop-filter: blur(5px); font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #e8edf8; overscroll-behavior:contain; }
    .panel { width: min(1100px, 80vw); max-height: min(880px, 92vh); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(255,255,255,.13); border-radius: 18px; background: #111722; box-shadow: 0 30px 90px rgba(0,0,0,.48); }
    .header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #273143; background: linear-gradient(135deg, #172033, #111722); }
    .brand { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg,#7c5cff,#27c2ff); color: #fff; font-weight: 800; }
    .heading { min-width: 0; flex: 1; }
    .title { font-size: 15px; font-weight: 700; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 3px; color: #9eabc1; font-size: 11px; }
    .badge { max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 7px; border: 1px solid #354158; border-radius: 999px; background: #1b2433; }
    button, input, textarea, select { font: inherit; }
    button { border: 0; cursor: pointer; }
    .icon-btn { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; color: #b8c3d6; background: transparent; font-size: 20px; }
    .icon-btn:hover { background: #273143; color: #fff; }
    .body { overflow-y: auto; overflow-x:hidden; padding: 18px; scrollbar-color: #3c4961 transparent; overscroll-behavior:contain; }
    .composer-intro { margin-bottom: 15px; color: #aeb9cc; }
    .context-row, .actions, .footer-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .controls { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(180px,.5fr); align-items:start; gap:10px; }
    label.small { display: flex; align-items: center; gap: 7px; color: #aeb9cc; font-size: 12px; }
    input[type="text"], textarea, select { width: 100%; border: 1px solid #334058; border-radius: 11px; outline: none; color: #eef3fd; background: #0d131d; }
    input[type="text"], select { height: 38px; padding: 0 11px; }
    textarea { min-height: 124px; resize: vertical; overflow-x:hidden; padding: 12px 13px; line-height: 1.55; }
    textarea:focus, input:focus, select:focus { border-color: #7c6cff; box-shadow: 0 0 0 3px rgba(124,108,255,.15); }
    .field { flex: 1 1 230px; }
    .field-label { display: block; margin: 14px 0 6px; color: #9eabc1; font-size: 12px; font-weight: 600; }
    .context-row { margin: 12px 0; }
    .context-choice { padding: 6px 10px; border: 1px solid #344158; border-radius: 999px; color: #aeb9cc; background: #171f2d; font-size: 12px; }
    .context-choice.active { border-color: #7469ff; color: #fff; background: #2a2850; }
    .primary { min-height: 40px; padding: 0 17px; border-radius: 10px; color: #fff; background: linear-gradient(135deg,#755cff,#496dff); font-weight: 700; }
    .primary:hover { filter: brightness(1.08); }
    .secondary { min-height: 38px; padding: 0 13px; border: 1px solid #344158; border-radius: 10px; color: #c6d0e0; background: #1a2331; }
    .secondary:hover { background: #263247; }
    .danger { color: #ffd7d7; background: #5a2830; }
    .actions { justify-content: space-between; margin-top: 16px; }
    .hint { color: #77849b; font-size: 11px; }
    .attachment { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding: 8px 10px; border: 1px solid #334058; border-radius: 10px; background: #151d2a; }
    .attachment img { width: 48px; height: 48px; border-radius: 7px; object-fit: cover; }
    .attachment-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hidden { display: none !important; }
    .chat { display: flex; flex-direction: column; gap: 14px; }
    .message-row { display:flex; flex-direction:column; align-items:flex-start; gap:1px; width:100%; max-width:100%; }
    .message-row.user-row { align-items:flex-end; }
    .message-row .message { min-width:0; max-width:100%; }
    .outside-tools { display:flex; flex-direction:row; gap:2px; min-height:23px; }
    .outside-tools.response-tools { margin:0; }
    .message { max-width: 92%; padding: 12px 14px; border-radius: 14px; word-break: break-word; }
    .message.user { align-self: flex-end; border-bottom-right-radius: 4px; background: #2c3560; white-space: pre-wrap; }
    .message.assistant { align-self: stretch; max-width: none; border: 1px solid #29354a; background: #151e2b; }
    .reasoning { margin-bottom: 12px; border: 1px solid #344158; border-radius: 11px; background: #101722; color: #98a7bc; }
    .reasoning summary { padding: 8px 11px; cursor: pointer; color: #aebbd0; font-size: 12px; font-style: italic; }
    .reasoning-text { max-height: 112px; overflow: hidden; padding: 0 11px 10px; mask-image: linear-gradient(to bottom, transparent 0, black 24px, black 100%); white-space: pre-wrap; font-size: 12px; font-style: italic; }
    .reasoning[open] .reasoning-text { max-height: 260px; overflow: auto; mask-image: none; }
    .answer { min-width:0; max-width:100%; overflow-wrap:anywhere; color: #e8edf8; }
    .answer > :first-child { margin-top: 0; } .answer > :last-child { margin-bottom: 0; }
    .answer p { margin: .65em 0; } .answer h1,.answer h2,.answer h3 { margin: 1em 0 .5em; line-height: 1.2; }
    .answer pre { position: relative; overflow: auto; padding: 12px; border-radius: 9px; background: #090d14; }
    .answer code { padding: 2px 5px; border-radius: 5px; background: #090d14; }
    .answer pre code { padding: 0; background: transparent; }
    .answer a { color: #7dc8ff; } .answer img { display: block; max-width: 100%; margin: 12px auto; border-radius: 10px; }
    .answer table { width: max-content; border-collapse: collapse; }
    .answer th,.answer td { max-width: 320px; padding: 7px 9px; border: 1px solid #3a465c; text-align: left; vertical-align: top; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
    .table-cell-content { min-width: 0; max-width: 320px; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
    .table-cell-content code { white-space: break-spaces; overflow-wrap: anywhere; word-break: break-word; }
    .status-line { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: #8f9db2; font-size: 11px; }
    .pulse { width: 7px; height: 7px; border-radius: 50%; background: #6f72ff; box-shadow: 0 0 0 0 rgba(111,114,255,.5); animation: pulse 1.4s infinite; }
    @keyframes pulse { 70% { box-shadow: 0 0 0 7px rgba(111,114,255,0); } }
    .footer { padding: 12px 16px 15px; border-top: 1px solid #273143; background: #101620; }
    .footer textarea { min-height: 64px; max-height: 180px; }
    .footer-actions { justify-content: space-between; margin-top: 9px; }
    .response-tools,.message-tools { display: flex; gap: 5px; margin-top: 8px; }
    .tool-icon { width:23px; height:23px; display:grid; place-items:center; padding:0; border:0; border-radius:6px; color:#93a2b8; background:transparent; font-size:13px; }
    .tool-icon:hover { color:#fff; background:#29364a; }
    .answer pre,.answer .table-wrap { position:relative; }
    .answer .block-copy { position:absolute; top:6px; right:6px; z-index:1; background:#1d2939; }
    .table-wrap { overflow:auto; margin:10px 0; } .table-wrap table{margin:0;padding-top:34px}
    .toast-stack { position:fixed; right:18px; bottom:18px; display:grid; gap:8px; width:min(360px,calc(100vw - 36px)); pointer-events:none; }
    .toast { padding:10px 12px; border:1px solid #40506a; border-radius:10px; color:#e8eef8; background:#1a2433; box-shadow:0 10px 30px rgba(0,0,0,.35); animation:toast-in .18s ease-out; }
    @keyframes toast-in{from{opacity:0;transform:translateY(8px)}}
    .light .panel { color:#1b2638; border-color:#d8deea; background:#f7f9fc; }.light .header{border-color:#d8deea;background:linear-gradient(135deg,#fff,#edf2fa)}.light .body,.light .footer{background:#f7f9fc}.light input[type="text"],.light textarea,.light select{color:#172033;border-color:#ccd5e3;background:#fff}.light .message.assistant{border-color:#d7deea;background:#fff}.light .message.user{color:#fff}.light .badge,.light .secondary{color:#40506a;border-color:#ccd5e3;background:#fff}.light .answer{color:#1b2638}.light .reasoning{color:#596980;border-color:#d4dce9;background:#f2f5fa}.light .footer{border-color:#d8deea}
    .light .context-choice { color:#536278; border-color:#cbd5e2; background:#f3f6fa; }.light .context-choice.active { color:#fff; border-color:#6557e8; background:#6b5ded; box-shadow:0 0 0 2px rgba(101,87,232,.18); }
    .light .primary { color:#fff; background:linear-gradient(135deg,#6858ef,#3f6feb); }.light .danger { color:#fff; border-color:#a63e4c; background:#b83f4e; }
    .light .tool-icon { color:#5b697f; background:transparent; }.light .tool-icon:hover { color:#27364c; background:#e5ebf3; }.light .block-copy { color:#4d5b72; border:1px solid #c8d1df; background:#e8edf5; }
    .light .answer code { color:#7b278f; background:#eee8f2; }.light .answer pre { color:#edf3fb; background:#172033; }.light .answer pre code { color:inherit; background:transparent; }
    * { scrollbar-width:thin; scrollbar-color:#56657d transparent; } ::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:999px;background:#56657d;background-clip:padding-box}::-webkit-scrollbar-thumb:hover{background:#71819b;background-clip:padding-box}.light *{scrollbar-color:#aab5c5 transparent}.light ::-webkit-scrollbar-thumb{background:#aab5c5;background-clip:padding-box}
    .error { padding: 10px 12px; border: 1px solid #753b47; border-radius: 10px; color: #ffd5dc; background: #3b2028; white-space: pre-wrap; }
    @media (max-width: 600px) { .backdrop { padding: 8px; } .panel { max-height: 96vh; border-radius: 13px; } .body { padding: 13px; } .message { max-width: 100%; } .controls{grid-template-columns:1fr;} }
  `;

  function ensureUI() {
    if (state.host?.isConnected) return;
    const old = document.getElementById("ai-text-tools-host");
    if (old) old.remove();
    state.host = document.createElement("div");
    state.host.id = "ai-text-tools-host";
    state.root = state.host.attachShadow({ mode: "open" });
    state.root.innerHTML = `<style>${STYLES}</style><div class="backdrop"><section class="panel" role="dialog" aria-modal="true" aria-label="AI Text Tools"></section><div class="toast-stack"></div></div>`;
    state.panel = state.root.querySelector(".panel");
    state.root.querySelector(".backdrop").addEventListener("click", event => {
      if (event.target.classList.contains("backdrop")) handleBackdropClick();
    });
    // Let controls inside the shadow tree receive the event first, then stop it
    // before it bubbles into the host page.
    for (const type of ["keydown", "keyup", "keypress"]) state.root.addEventListener(type, event => event.stopPropagation());
    state.root.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeUI();
    });
    document.documentElement.appendChild(state.host);
  }

  let extensionContextActive = true;

  function disconnectOrphanedContentScript() {
    if (!extensionContextActive) return;
    extensionContextActive = false;
    clearTimeout(selectionTimer);
    document.removeEventListener("selectionchange", scheduleSelectionPublish, true);
    document.removeEventListener("select", scheduleSelectionPublish, true);
    document.removeEventListener("mouseup", scheduleSelectionPublish, true);
    document.removeEventListener("keyup", scheduleSelectionPublish, true);
    state.host?.remove();
    state.host = state.root = state.panel = null;
    if (globalThis.__AI_TEXT_TOOLS_CLEANUP__ === disconnectOrphanedContentScript) {
      try { delete globalThis.__AI_TEXT_TOOLS_CLEANUP__; } catch {}
    }
    try { delete globalThis.__AI_TEXT_TOOLS_LOADED__; } catch {}
  }

  function isInvalidExtensionContext(error) {
    return /extension context invalidated|cannot read properties of undefined|cannot access a chrome|receiving end does not exist/i.test(error?.message || String(error || ""));
  }

  async function sendRuntimeMessage(message) {
    let runtime;
    try { runtime = globalThis.chrome?.runtime; } catch {}
    if (!extensionContextActive || !runtime?.id || typeof runtime.sendMessage !== "function") {
      disconnectOrphanedContentScript();
      return null;
    }
    try {
      return await runtime.sendMessage(message);
    } catch (error) {
      if (isInvalidExtensionContext(error)) { disconnectOrphanedContentScript(); return null; }
      throw error;
    }
  }

  async function setSyncStorage(value) {
    let storage;
    try { storage = globalThis.chrome?.storage?.sync; } catch {}
    if (!extensionContextActive || typeof storage?.set !== "function") {
      disconnectOrphanedContentScript();
      return false;
    }
    try { await storage.set(value); return true; }
    catch (error) {
      if (isInvalidExtensionContext(error)) { disconnectOrphanedContentScript(); return false; }
      throw error;
    }
  }

  function currentSelection() {
    const active = document.activeElement;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT") && typeof active.selectionStart === "number") {
      if (active.type === "password") return "";
      return active.value.slice(active.selectionStart, active.selectionEnd).trim();
    }
    return window.getSelection()?.toString().trim() || "";
  }

  let publishedSelection = null;
  let selectionTimer = null;
  function scheduleSelectionPublish() {
    if (!extensionContextActive) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const selectionText = currentSelection();
      if (selectionText === publishedSelection) return;
      publishedSelection = selectionText;
      sendRuntimeMessage({ action: "AI_SELECTION_CHANGED", selectionText }).catch(() => {});
    }, 120);
  }
  document.addEventListener("selectionchange", scheduleSelectionPublish, true);
  document.addEventListener("select", scheduleSelectionPublish, true);
  document.addEventListener("mouseup", scheduleSelectionPublish, true);
  document.addEventListener("keyup", scheduleSelectionPublish, true);
  globalThis.__AI_TEXT_TOOLS_CLEANUP__ = disconnectOrphanedContentScript;

  function extractPageLinks(maxLinks = 120, maxChars = 16000) {
    const linksByUrl = new Map();
    for (const anchor of document.querySelectorAll("a[href]")) {
      if (anchor.closest("#ai-text-tools-host,[hidden],[aria-hidden='true']")) continue;
      const style = getComputedStyle(anchor);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const text = (anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || anchor.querySelector("img[alt]")?.alt || "").replace(/\s+/g, " ").trim();
      if (text.length < 2) continue;
      try {
        const url = new URL(anchor.getAttribute("href"), location.href);
        if (!['http:', 'https:'].includes(url.protocol) || url.href.length > 2048) continue;
        const normalizedText = text.slice(0, 180);
        const existing = linksByUrl.get(url.href);
        if (!existing || normalizedText.length > existing.text.length) linksByUrl.set(url.href, { text: normalizedText, url: url.href });
      } catch {}
    }
    const result = [];
    let usedChars = 0;
    for (const link of linksByUrl.values()) {
      const size = link.text.length + link.url.length + 6;
      if (result.length >= maxLinks || usedChars + size > maxChars) break;
      result.push(link); usedChars += size;
    }
    return result;
  }

  function extractPageContext(limit = 60000, includeLinks = false, linkLimit = 16000) {
    const extensionHost = document.getElementById("ai-text-tools-host");
    const previousDisplay = extensionHost?.style.display;
    if (extensionHost) extensionHost.style.display = "none";
    const candidates = [document.body, ...document.querySelectorAll("main, article, [role='main'], [role='document']")]
      .filter(Boolean)
      .map(node => node.innerText || "")
      .filter(Boolean);
    let text = candidates.sort((a, b) => b.length - a.length)[0] || "";
    const extras = [];
    for (const frame of document.querySelectorAll("iframe")) {
      try { const frameText = frame.contentDocument?.body?.innerText?.trim(); if (frameText && !text.includes(frameText.slice(0, 200))) extras.push(frameText); } catch {}
    }
    for (const element of document.querySelectorAll("*")) {
      if (element === state.host || element.id === "ai-text-tools-host") continue;
      const shadowText = element.shadowRoot?.textContent?.trim();
      if (shadowText && shadowText.length > 30 && !text.includes(shadowText.slice(0, 200))) extras.push(shadowText);
    }
    if (extras.length) text = [text, ...extras].join("\n\n");
    if (text.trim().length < 20) text = document.body?.textContent || document.documentElement?.textContent || "";
    text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
    const wasTruncated = text.length > limit;
    if (wasTruncated) text = `${text.slice(0, limit)}\n\n[Текст страницы обрезан расширением]`;
    if (extensionHost) extensionHost.style.display = previousDisplay || "";
    const pageLinks = includeLinks ? extractPageLinks(120, linkLimit) : [];
    return { pageText: text, pageTitle: document.title, pageUrl: location.href, pageLinks, includeLinks: Boolean(includeLinks), wasTruncated };
  }

  function escapeHtml(value = "") {
    return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function money(value) {
    const number = Number(value) || 0, absolute = Math.abs(number);
    if (!absolute || absolute >= .01) return number.toFixed(2);
    return number.toFixed(Math.min(8, Math.max(2, Math.ceil(-Math.log10(absolute)) + 1)));
  }

  function sanitizeMarkdown(markdown) {
    const raw = globalThis.marked?.parse ? globalThis.marked.parse(markdown || "") : escapeHtml(markdown || "").replace(/\n/g, "<br>");
    const template = document.createElement("template");
    template.innerHTML = raw;
    template.content.querySelectorAll("script,style,iframe,object,embed,form,input,button,textarea,select,meta,link").forEach(node => node.remove());
    template.content.querySelectorAll("*").forEach(node => {
      for (const attr of [...node.attributes]) {
        const value = attr.value.trim().toLowerCase();
        if (attr.name.toLowerCase().startsWith("on") || ((attr.name === "href" || attr.name === "src") && value.startsWith("javascript:"))) node.removeAttribute(attr.name);
      }
      if (node.tagName === "A") {
        node.target = "_blank";
        node.rel = "noopener noreferrer";
      }
    });
    return template.innerHTML;
  }

  function headerHtml(contextLabel) {
    const status = state.generating ? "Генерация" : state.view === "chat" ? "Диалог" : "Новый запрос";
    return `<header class="header">
      <div class="brand">AI</div><div class="heading"><div class="title">AI Text Tools</div>
      <div class="meta"><span class="badge" id="model-badge">${escapeHtml(state.model || "модель не выбрана")}</span><span class="badge">${escapeHtml(contextLabel)}</span><span class="badge" id="status-badge">${status}</span>${state.view === "chat" ? `<span class="badge" id="cost-badge">Всего $${money(state.totalCost)}</span>` : ""}</div></div>
      <button class="icon-btn" data-action="theme" title="Переключить тему">◐</button><button class="icon-btn" data-action="minimize" title="Переместить в боковую панель">▸</button>
      <button class="icon-btn" data-action="close" title="Закрыть (Esc)" aria-label="Закрыть">×</button>
    </header>`;
  }

  function contextLabel(mode) {
    if (mode === "selection") return "Выделенный текст";
    if (mode === "page") return "Вся страница";
    return "Без контекста";
  }

  function resolveMode(mode) {
    if (mode === "auto") return state.selectionText ? "selection" : "none";
    return mode;
  }

  function renderComposer(recentModels = []) {
    state.view = "composer";
    const mode = resolveMode(state.mode);
    const catalog = state.modelCatalog.length ? state.modelCatalog : [...new Set([state.model, ...recentModels].filter(Boolean))].map(id => ({ id, name: id }));
    const options = catalog.map(model => `<option value="${escapeHtml(model.id)}" label="${escapeHtml(modelLabel(model))}"></option>`).join("");
    const pageContext = mode === "page" ? extractPageContext(Number.MAX_SAFE_INTEGER) : null;
    state.panel.innerHTML = `${headerHtml(contextLabel(mode))}<div class="body">
      <div class="context-row" role="group" aria-label="Контекст запроса">
        <button class="context-choice ${mode === "none" ? "active" : ""}" data-mode="none">Без контекста</button>
        ${state.selectionText ? `<button class="context-choice ${mode === "selection" ? "active" : ""}" data-mode="selection">Выделенный текст · ${state.selectionText.length} симв.</button>` : ""}
        <button class="context-choice ${mode === "page" ? "active" : ""}" data-mode="page">Страница${pageContext ? ` · ${pageContext.pageText.length} симв.` : ""}</button>
      </div>
      <label class="field-label" for="ai-prompt">Запрос</label>
      <textarea id="ai-prompt" placeholder="Что нужно сделать? Переносы строк сохраняются.">${escapeHtml(state.promptDraft)}</textarea>
      <div id="attachment-slot"></div>
      <div class="controls">
        <div class="field"><label class="field-label" for="ai-model">Модель</label><input id="ai-model" type="text" list="ai-models" value="${escapeHtml(state.model)}" placeholder="openrouter/auto"><datalist id="ai-models">${options}</datalist><span class="hint" id="current-model-info"></span></div>
        <div class="field"><label class="field-label" for="ai-thinking">Reasoning</label><select id="ai-thinking"></select><input id="ai-reasoning-budget" class="hidden" type="number" min="1" max="128000" step="100" value="${Number(state.reasoningMaxTokens)||2000}" placeholder="Budget tokens"></div>
      </div>
      <div class="actions"><div><button class="secondary" data-action="attach">＋ Изображения</button><input class="hidden" id="image-input" type="file" accept="image/*" multiple></div><div>${state.sendOnEnter ? "" : '<span class="hint">Ctrl + Enter — отправить</span>'} <button class="primary" data-action="submit">Отправить</button></div></div>
    </div>`;
    bindCommon();
    state.panel.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => {
      if (button.disabled) return;
      state.promptDraft = state.panel.querySelector("#ai-prompt")?.value || "";
      state.model = state.panel.querySelector("#ai-model")?.value.trim() || state.model;
      state.thinking = state.panel.querySelector("#ai-thinking")?.value || state.thinking;
      state.mode = button.dataset.mode;
      renderComposer(recentModels);
      state.panel.querySelector("#ai-prompt")?.focus();
    }));
    const prompt = state.panel.querySelector("#ai-prompt");
    prompt.addEventListener("input", () => state.promptDraft = prompt.value);
    prompt.addEventListener("keydown", event => { if (isSendKey(event)) { event.preventDefault(); submitNewChat(); } });
    state.panel.querySelector('[data-action="submit"]').addEventListener("click", submitNewChat);
    const fileInput = state.panel.querySelector("#image-input");
    state.panel.querySelector('[data-action="attach"]').addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => prepareImages([...fileInput.files]));
    state.panel.querySelector("#ai-model").addEventListener("change", applyComposerCapability);
    state.panel.querySelector("#ai-thinking").addEventListener("change", toggleReasoningBudget);
    prompt.addEventListener("paste", event => {
      const files = [...(event.clipboardData?.files || [])].filter(item => item.type.startsWith("image/"));
      if (files.length) { event.preventDefault(); prepareImages(files); }
    });
    prompt.focus();
    applyComposerCapability();
    renderAttachment();
  }

  function modelLabel(model) {
    const prompt = Number(model.pricing?.prompt || 0) * 1_000_000, completion = Number(model.pricing?.completion || 0) * 1_000_000;
    const flags = [model.input_modalities?.includes("image") ? "images" : "", model.reasoning?.mandatory ? "reasoning required" : model.supported_parameters?.includes("reasoning") ? "reasoning" : ""].filter(Boolean).join(", ");
    return `${model.name || model.id}${model.pricing ? ` · $${prompt.toFixed(2)}/$${completion.toFixed(2)} per 1M` : ""}${flags ? ` · ${flags}` : ""}`;
  }

  function applyComposerCapability() {
    const input = state.panel?.querySelector("#ai-model"), select = state.panel?.querySelector("#ai-thinking"), info = state.panel?.querySelector("#current-model-info");
    if (!input || !select || !info) return;
    const model = state.modelCatalog.find(item => item.id === input.value.trim());
    setComposerReasoningOptions(select, model, state.thinking);
    if (!model) { info.textContent = ""; toggleReasoningBudget(); return; }
    const mandatory = Boolean(model.reasoning?.mandatory), supports = mandatory || model.supported_parameters?.includes("reasoning") || Boolean(model.reasoning);
    info.textContent = `${model.input_modalities?.includes("image") ? "Изображения поддерживаются" : "Только текст"}${mandatory ? " · reasoning обязателен" : supports ? " · reasoning доступен" : ""}`;
    toggleReasoningBudget();
  }

  function migrateReasoning(value) { return value === "on" ? "medium" : value === "off" || !value ? "none" : value; }
  function setComposerReasoningOptions(select, model, current) {
    const mandatory = Boolean(model?.reasoning?.mandatory), supported = !model || mandatory || model.supported_parameters?.includes("reasoning") || Boolean(model.reasoning);
    let efforts = Array.isArray(model?.reasoning?.supported_efforts) && model.reasoning.supported_efforts.length ? model.reasoning.supported_efforts : ["low","medium","high"];
    if (!supported) efforts=[];
    const values=[...(!mandatory?["none"]:[]),...efforts,...(supported&&model?.reasoning?.supports_max_tokens!==false?["custom"]:[])], labels={none:"Нет",minimal:"Minimal",low:"Low",medium:"Medium",high:"High",xhigh:"XHigh",max:"Max",custom:"Custom"};
    select.innerHTML=[...new Set(values)].map(value=>`<option value="${value}">${labels[value]||value}</option>`).join("");
    const wanted=migrateReasoning(current);select.value=values.includes(wanted)?wanted:(model?.reasoning?.default_effort&&values.includes(model.reasoning.default_effort)?model.reasoning.default_effort:values[0]||"none");state.thinking=select.value;
  }
  function toggleReasoningBudget(){const select=state.panel?.querySelector("#ai-thinking"),budget=state.panel?.querySelector("#ai-reasoning-budget");if(budget)budget.classList.toggle("hidden",select?.value!=="custom");}

  async function prepareImages(files) {
    const selectedId = state.panel?.querySelector("#ai-model")?.value.trim() || state.model;
    const selectedModel = state.modelCatalog.find(item => item.id === selectedId);
    if (selectedModel && !selectedModel.input_modalities?.includes("image")) return showToast("Выбранная модель не поддерживает изображения. Сначала выберите мультимодальную модель.");
    for (const file of files) await prepareImage(file);
  }

  async function prepareImage(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return showToast("Можно приложить только изображение.");
    if (file.size > 12 * 1024 * 1024) return showToast("Изображение больше 12 МБ.");
    try {
      const dataUrl = await resizeImage(file, 1800);
      state.images.push({ name: file.name || "Вставленное изображение", dataUrl });
      renderAttachment();
    } catch (error) { showToast(`Не удалось обработать изображение: ${error.message}`); }
  }

  function resizeImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("Ошибка чтения файла"));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Неподдерживаемый формат"));
        image.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", .88));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderAttachment() {
    const slot = state.panel?.querySelector("#attachment-slot, #followup-attachment-slot");
    if (!slot) return;
    slot.innerHTML = state.images.map((image, index) => `<div class="attachment"><img src="${image.dataUrl}" alt=""><span class="attachment-name">${escapeHtml(image.name)}</span><button class="icon-btn" data-remove-image="${index}" title="Удалить">×</button></div>`).join("");
    slot.querySelectorAll("[data-remove-image]").forEach(button => button.addEventListener("click", () => { state.images.splice(Number(button.dataset.removeImage), 1); renderAttachment(); }));
  }

  async function submitNewChat() {
    const prompt = state.panel.querySelector("#ai-prompt")?.value || "";
    if (!prompt.trim() && !state.images.length) return showToast("Введите запрос или приложите изображение.");
    state.model = state.panel.querySelector("#ai-model")?.value.trim();
    state.thinking = state.panel.querySelector("#ai-thinking")?.value || "off";
    state.reasoningMaxTokens = Number(state.panel.querySelector("#ai-reasoning-budget")?.value) || 2000;
    state.mode = resolveMode(state.mode);
    state.lastUserText = prompt;
    let context;
    if (state.mode === "page") {
      const fullPage = extractPageContext(Number.MAX_SAFE_INTEGER);
      if (fullPage.pageText.length > state.pageContextLimit && !confirm(`Текст страницы содержит ${fullPage.pageText.length.toLocaleString("ru-RU")} символов — больше заданного лимита ${state.pageContextLimit.toLocaleString("ru-RU")}. Отправить полный текст всё равно?`)) return;
      context = { type: "page", ...fullPage };
    } else context = state.mode === "selection" ? { type: "selection", selectionText: state.selectionText } : { type: "none" };
    const images = state.images;
    state.images = [];
    state.promptDraft = "";
    state.totalCost = 0;
    renderChatShell();
    await sendRuntimeMessage({ action: "START_AI_CHAT", prompt, model: state.model, thinking: state.thinking, reasoningMaxTokens: state.reasoningMaxTokens, context, images });
  }

  function renderChatShell() {
    state.view = "chat";
    state.generating = true;
    state.answer = "";
    state.reasoning = "";
    state.reasoningAutoStick = true;
    state.responseImages = [];
    state.scrollMode = "anchor";
    state.panel.innerHTML = `${headerHtml(contextLabel(state.mode))}<div class="body"><div class="chat">
      ${state.lastUserText ? userMessageHtml(state.lastUserText) : ""}${assistantShellHtml()}
    </div></div><footer class="footer"><div id="followup-attachment-slot"></div><textarea id="followup" placeholder="Продолжить разговор…" disabled></textarea><div class="footer-actions"><div><button class="tool-icon" data-action="followup-attach" title="Добавить изображения">＋</button><input class="hidden" id="followup-image-input" type="file" accept="image/*" multiple></div><button id="chat-primary" class="primary danger" data-action="stop">Стоп</button></div></footer>`;
    bindCommon();
    setChatGenerationControls(true);
    bindMessageTools();
    bindAssistantCopyTools();
    bindFollowupAttachments();
    const body = state.panel.querySelector(".body");
    body.addEventListener("wheel", event => { if (event.deltaY < 0) state.scrollMode = "manual"; else if (body.scrollHeight - body.scrollTop - body.clientHeight < 48) state.scrollMode = "follow"; }, { passive: true });
  }

  function userMessageHtml(text) {
    return `<div class="message-row user-row"><div class="message user"><div class="message-text">${escapeHtml(text)}</div></div><div class="outside-tools"><button class="tool-icon" data-copy-user title="Копировать вопрос">⧉</button></div></div>`;
  }

  function assistantShellHtml() {
    return `<div class="message-row assistant-row"><div class="message assistant"><details class="reasoning hidden" open><summary>Размышление модели</summary><div class="reasoning-text"></div></details><div class="answer"><em>Ожидаем ответ…</em></div><div class="status-line"><span class="pulse"></span><span class="status-text">Генерация…</span></div></div><div class="outside-tools response-tools"><button class="tool-icon" data-action="copy" title="Копировать ответ">⧉</button><button class="tool-icon hidden" data-action="regenerate" title="Перегенерировать ответ">↻</button></div></div>`;
  }

  function updateChat() {
    if (!state.panel || state.view !== "chat") return;
    const current = [...state.panel.querySelectorAll(".message.assistant")].at(-1);
    const answer = current?.querySelector(".answer");
    const reasoningBox = current?.querySelector(".reasoning");
    const reasoningText = current?.querySelector(".reasoning-text");
    if (state.reasoning) {
      reasoningBox?.classList.remove("hidden");
      reasoningText.textContent = state.reasoning;
      if (state.reasoningAutoStick) reasoningText.scrollTop = reasoningText.scrollHeight;
      if (!reasoningText.dataset.scrollBound) { reasoningText.dataset.scrollBound = "1"; reasoningText.addEventListener("wheel", event => { if (event.deltaY < 0) state.reasoningAutoStick = false; else if (reasoningText.scrollHeight - reasoningText.scrollTop - reasoningText.clientHeight < 24) state.reasoningAutoStick = true; }, { passive: true }); }
    }
    const imageMarkdown = state.responseImages.map(url => `\n\n![Изображение](${url})`).join("");
    if (answer) {
      answer.innerHTML = sanitizeMarkdown((state.answer || (imageMarkdown ? "" : "Ожидаем ответ…")) + imageMarkdown);
      decorateAnswer(answer);
    }
    const body = state.panel.querySelector(".body");
    if (body && state.scrollMode === "follow") body.scrollTop = body.scrollHeight;
    if (body && state.scrollMode === "anchor") { const userRow=[...state.panel.querySelectorAll(".user-row")].at(-1); if(userRow) body.scrollTop=Math.min(Math.max(0,userRow.offsetTop-12),Math.max(0,body.scrollHeight-body.clientHeight)); }
  }

  function decorateAnswer(answer) {
    answer.querySelectorAll("pre").forEach(pre => {
      if (pre.querySelector(".block-copy")) return;
      const button = document.createElement("button"); button.className = "tool-icon block-copy"; button.title = "Копировать код"; button.textContent = "⧉";
      button.addEventListener("click", () => copyText(pre.querySelector("code")?.innerText || pre.innerText)); pre.appendChild(button);
    });
    answer.querySelectorAll("table").forEach(table => {
      if (table.parentElement?.classList.contains("table-wrap")) return;
      constrainTableColumns(table);
      const wrap = document.createElement("div"); wrap.className = "table-wrap"; table.replaceWith(wrap); wrap.appendChild(table);
      const button = document.createElement("button"); button.className = "tool-icon block-copy"; button.title = "Копировать таблицу"; button.textContent = "⧉";
      button.addEventListener("click", () => copyText(table.innerText)); wrap.appendChild(button);
    });
  }

  function constrainTableColumns(table) {
    table.querySelectorAll("th,td").forEach(cell => {
      if (cell.children.length === 1 && cell.firstElementChild?.classList.contains("table-cell-content")) return;
      const content = document.createElement("div"); content.className = "table-cell-content";
      while (cell.firstChild) content.append(cell.firstChild);
      cell.append(content);
    });
  }

  function finishChat(status = "Готово", error = null) {
    state.generating = false;
    const current = [...(state.panel?.querySelectorAll(".message.assistant") || [])].at(-1);
    const statusBadge = state.panel?.querySelector("#status-badge");
    if (statusBadge) statusBadge.textContent = error ? "Ошибка" : status;
    const line = current?.querySelector(".status-line");
    if (line) line.innerHTML = error ? `<span class="error">${escapeHtml(error)}</span>` : `<span>${escapeHtml(status)}</span>`;
    const responseTools = current?.closest(".message-row")?.querySelector(".response-tools");
    responseTools?.querySelector('[data-action="regenerate"]')?.classList.remove("hidden");
    const followup = state.panel?.querySelector("#followup");
    if (followup) { followup.disabled = false; followup.focus(); bindFollowupKey(followup); }
    setChatGenerationControls(false);
    responseTools?.querySelector('[data-action="regenerate"]')?.addEventListener("click", regenerateAnswer);
    bindMessageTools();
    bindAssistantCopyTools();
  }

  async function submitFollowup() {
    if (state.generating) return;
    const input = state.panel.querySelector("#followup");
    const prompt = input?.value || "";
    if (!prompt.trim() && !state.images.length) return;
    const images = state.images; state.images = [];
    const displayPrompt = prompt || `[Изображения: ${images.length}]`;
    const chat = state.panel.querySelector(".chat");
    chat.querySelectorAll('[data-action="regenerate"]').forEach(button => button.remove());
    chat.insertAdjacentHTML("beforeend", `${userMessageHtml(displayPrompt)}${assistantShellHtml()}`);
    bindMessageTools();
    bindAssistantCopyTools();
    input.value = "";
    input.disabled = true;
    setChatGenerationControls(true);
    state.answer = ""; state.reasoning = ""; state.responseImages = []; state.generating = true; state.reasoningAutoStick = true;
    state.autoStick = true; state.scrollMode = "anchor";
    state.panel.querySelector("#status-badge").textContent = "Генерация";
    const body = state.panel.querySelector(".body"); body.scrollTop = body.scrollHeight;
    await sendRuntimeMessage({ action: "CONTINUE_AI_CHAT", prompt: displayPrompt, model: state.model, thinking: state.thinking, images });
  }

  function bindFollowupAttachments() {
    const button = state.panel?.querySelector('[data-action="followup-attach"]');
    const input = state.panel?.querySelector("#followup-image-input");
    const textarea = state.panel?.querySelector("#followup");
    if (!button || !input) return;
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", () => prepareImages([...input.files]));
    textarea?.addEventListener("paste", event => {
      const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith("image/"));
      if (files.length) { event.preventDefault(); prepareImages(files); }
    });
  }

  function bindFollowupKey(textarea) {
    if (textarea.dataset.sendBound) return;
    textarea.dataset.sendBound = "1";
    textarea.addEventListener("keydown", event => { if (isSendKey(event)) { event.preventDefault(); submitFollowup(); } });
  }

  async function regenerateAnswer() {
    if (state.generating) return;
    const current = [...state.panel.querySelectorAll(".message.assistant")].at(-1);
    current?.closest(".message-row")?.remove();
    state.panel.querySelector(".chat").insertAdjacentHTML("beforeend", assistantShellHtml());
    bindAssistantCopyTools();
    state.answer = ""; state.reasoning = ""; state.responseImages = []; state.generating = true; state.autoStick = true; state.scrollMode = "anchor"; state.reasoningAutoStick = true;
    state.panel.querySelector("#status-badge").textContent = "Перегенерация";
    setChatGenerationControls(true);
    await sendRuntimeMessage({ action: "REGENERATE_AI_CHAT" });
  }

  async function copyAnswer(event, text = state.answer) {
    const copied = await copyText(text);
    if (copied) { const button = event.currentTarget; const old = button.textContent; button.textContent = "✓"; setTimeout(() => button.textContent = old, 1000); }
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); showToast("Скопировано"); return true; } catch {}
    try {
      const area = document.createElement("textarea"); area.value = text; area.style.cssText = "position:fixed;left:-9999px;top:0"; document.body.appendChild(area); area.select();
      const success = document.execCommand("copy"); area.remove();
      showToast(success ? "Скопировано" : "Не удалось скопировать"); return success;
    } catch { showToast("Не удалось получить доступ к буферу обмена"); return false; }
  }

  function bindMessageTools() {
    state.panel?.querySelectorAll("[data-copy-user]:not([data-bound])").forEach(button => {
      button.dataset.bound = "1"; button.addEventListener("click", () => copyText(button.closest(".message-row")?.querySelector(".message-text")?.innerText || ""));
    });
  }

  function bindAssistantCopyTools() {
    state.panel?.querySelectorAll('[data-action="copy"]:not([data-bound])').forEach(button => {
      button.dataset.bound = "1";
      button.addEventListener("click", () => copyText(button.closest(".message-row")?.querySelector(".answer")?.innerText || state.answer));
    });
  }

  function setChatGenerationControls(generating) {
    const old = state.panel?.querySelector("#chat-primary");
    if (!old) return;
    const button = old.cloneNode(true);
    button.textContent = generating ? "Стоп" : "Отправить";
    button.className = generating ? "primary danger" : "primary";
    button.dataset.action = generating ? "stop" : "continue";
    button.disabled = false;
    old.replaceWith(button);
    button.addEventListener("click", generating ? stopGeneration : submitFollowup);
    const followup = state.panel.querySelector("#followup"); if (followup) followup.disabled = generating;
  }

  function showToast(message) {
    const stack = state.root?.querySelector(".toast-stack"); if (!stack) return;
    const toast = document.createElement("div"); toast.className = "toast"; toast.textContent = message; stack.appendChild(toast); setTimeout(() => toast.remove(), 3200);
  }

  function isSendKey(event) {
    if (event.key !== "Enter" || event.isComposing) return false;
    return state.sendOnEnter ? !event.shiftKey && !event.ctrlKey && !event.altKey : event.ctrlKey;
  }

  function bindCommon() {
    state.panel.querySelector('[data-action="close"]')?.addEventListener("click", closeUI);
    state.panel.querySelectorAll('[data-action="minimize"]').forEach(button => button.addEventListener("click", minimizeToSidePanel));
    state.panel.querySelectorAll('[data-action="theme"]').forEach(button => button.addEventListener("click", toggleTheme));
    state.root.querySelector(".backdrop")?.classList.toggle("light", resolvedLightTheme());
  }

  async function minimizeToSidePanel() {
    const draft = state.view === "composer" ? collectDraft() : null;
    const response = await sendRuntimeMessage({ action: "OPEN_AI_SIDE_PANEL", draft });
    if (!response) return;
    if (!response?.ok) return showToast(response?.error || "Не удалось открыть боковую панель");
    state.host?.remove(); state.host = state.root = state.panel = null;
  }

  function collectDraft() {
    return {
      prompt: state.panel?.querySelector("#ai-prompt")?.value ?? state.promptDraft,
      model: state.panel?.querySelector("#ai-model")?.value.trim() || state.model,
      thinking: state.panel?.querySelector("#ai-thinking")?.value || state.thinking,
      reasoningMaxTokens: Number(state.panel?.querySelector("#ai-reasoning-budget")?.value) || state.reasoningMaxTokens,
      mode: resolveMode(state.mode),
      selectionText: state.selectionText,
      images: state.images,
      pageContextLimit: state.pageContextLimit
    };
  }

  function composerIsDirty() {
    if (state.view !== "composer") return true;
    const draft = collectDraft(), initial = state.initialComposer;
    return Boolean(draft.prompt.trim() || draft.images.length || !initial || draft.model !== initial.model || draft.thinking !== initial.thinking || draft.reasoningMaxTokens !== initial.reasoningMaxTokens || draft.mode !== initial.mode);
  }

  function handleBackdropClick() {
    if (state.view === "composer" && !composerIsDirty()) closeUI();
    else minimizeToSidePanel();
  }

  async function toggleTheme() {
    state.theme = resolvedLightTheme() ? "dark" : "light";
    state.root?.querySelector(".backdrop")?.classList.toggle("light", state.theme === "light");
    await setSyncStorage({ theme: state.theme });
  }

  function resolvedLightTheme() { return state.theme === "light" || (state.theme === "system" && matchMedia("(prefers-color-scheme:light)").matches); }

  function stopGeneration() {
    sendRuntimeMessage({ action: "STOP_AI_CHAT" }).catch(() => {});
  }

  function closeUI() {
    if (state.generating) sendRuntimeMessage({ action: "STOP_AI_CHAT" }).catch(() => {});
    state.host?.remove();
    state.host = state.root = state.panel = null;
    state.generating = false;
  }

  function openComposer(message) {
    if (state.host?.isConnected) {
      state.panel?.querySelector("textarea:not([disabled])")?.focus();
      return;
    }
    state.selectionText = currentSelection();
    state.mode = message.mode || "auto";
    state.model = message.model || state.model;
    state.thinking = migrateReasoning(message.thinking);
    state.reasoningMaxTokens = Number(message.reasoningMaxTokens) || 2000;
    state.images = [];
    state.sendOnEnter = message.sendOnEnter !== false;
    state.theme = message.theme || state.theme;
    state.pageContextLimit = Number(message.pageContextLimit) || 60000;
    state.modelCatalog = message.modelCatalog || [];
    state.promptDraft = "";
    state.initialComposer = { model: state.model, thinking: state.thinking, reasoningMaxTokens: state.reasoningMaxTokens, mode: resolveMode(state.mode) };
    ensureUI();
    renderComposer(message.recentModels || []);
  }

  function openDraft(message) {
    const draft = message.draft || {};
    state.host?.remove(); state.host = state.root = state.panel = null;
    state.selectionText = draft.selectionText || ""; state.mode = draft.mode || "none"; state.model = draft.model || ""; state.thinking = migrateReasoning(draft.thinking); state.reasoningMaxTokens = Number(draft.reasoningMaxTokens || message.reasoningMaxTokens) || 2000; state.images = draft.images || []; state.promptDraft = draft.prompt || "";
    state.sendOnEnter = message.sendOnEnter !== false; state.theme = message.theme || "dark"; state.pageContextLimit = Number(message.pageContextLimit) || 60000; state.modelCatalog = message.modelCatalog || [];
    state.initialComposer = { model: state.model, thinking: state.thinking, reasoningMaxTokens: state.reasoningMaxTokens, mode: resolveMode(state.mode) };
    ensureUI(); renderComposer(message.recentModels || []);
  }

  function openResult(message) {
    if (!state.host?.isConnected) ensureUI();
    state.mode = message.mode || "none";
    state.lastUserText = "";
    state.totalCost = 0;
    renderChatShell();
  }

  function openStoredChat(message) {
    const session = message.session;
    if (!session) return;
    if (!state.host?.isConnected) ensureUI();
    state.model = session.model || ""; state.thinking = session.thinking || "off"; state.totalCost = Number(session.totalCost) || 0;
    state.sendOnEnter = message.sendOnEnter !== false; state.theme = message.theme || state.theme; state.mode = session.context?.type || "none"; state.lastUserText = "";
    renderChatShell();
    const chat = state.panel.querySelector(".chat"); chat.innerHTML = "";
    for (const item of session.messages || []) {
      if (item.role === "system") continue;
      const text = item.displayText || (typeof item.content === "string" ? item.content : item.content?.filter(part => part.type === "text").map(part => part.text).join("\n") || "");
      if (item.role === "user") chat.insertAdjacentHTML("beforeend", userMessageHtml(text));
      if (item.role === "assistant") chat.insertAdjacentHTML("beforeend", `<div class="message-row assistant-row"><div class="message assistant"><div class="answer">${sanitizeMarkdown(text)}</div>${item.usage?.cost != null ? `<div class="status-line">$${money(item.cost)}</div>` : ""}</div><div class="outside-tools"><button class="tool-icon" data-copy-stored title="Копировать ответ">⧉</button></div></div>`);
    }
    chat.querySelectorAll(".answer").forEach(decorateAnswer); bindMessageTools();
    chat.querySelectorAll("[data-copy-stored]").forEach(button => button.addEventListener("click", () => copyText(button.closest(".message-row").querySelector(".answer").innerText)));
    const lastStoredTools = [...chat.querySelectorAll(".assistant-row .outside-tools")].at(-1);
    if (lastStoredTools) { const retry = document.createElement("button"); retry.className = "tool-icon"; retry.dataset.action = "regenerate"; retry.title = "Перегенерировать ответ"; retry.textContent = "↻"; retry.addEventListener("click", regenerateAnswer); lastStoredTools.appendChild(retry); }
    state.generating = Boolean(message.generating);
    if (state.generating) { chat.insertAdjacentHTML("beforeend", assistantShellHtml()); state.answer = session.partialAnswer || ""; state.reasoning = session.partialReasoning || ""; updateChat(); }
    setChatGenerationControls(state.generating); state.panel.querySelector("#status-badge").textContent = state.generating ? "Генерация" : `Диалог · $${money(state.totalCost)}`;
    const followup = state.panel.querySelector("#followup"); bindFollowupKey(followup);
    const body = state.panel.querySelector(".body"); body.scrollTop = body.scrollHeight;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action?.startsWith("AI_CHAT_") && message.surfaceOwner === "sidepanel") { sendResponse({ ok: true }); return; }
    switch (message.action) {
      case "PING_AI_TEXT_TOOLS": sendResponse({ ok: true }); return;
      case "GET_AI_PAGE_CONTEXT": sendResponse(extractPageContext(message.limit, message.includeLinks, message.linkLimit)); return;
      case "GET_AI_SELECTION": sendResponse({ selectionText: currentSelection() }); return;
      case "CONFIRM_AI_PAGE_OVERFLOW": sendResponse({ proceed: confirm(`Текст страницы содержит ${Number(message.actual).toLocaleString("ru-RU")} символов — больше лимита ${Number(message.limit).toLocaleString("ru-RU")}. Отправить полный текст всё равно?`) }); return;
      case "OPEN_AI_COMPOSER": openComposer(message); sendResponse({ ok: true }); return;
      case "OPEN_AI_DRAFT": openDraft(message); sendResponse({ ok: true }); return;
      case "OPEN_AI_RESULT": openResult(message); sendResponse({ ok: true }); return;
      case "OPEN_AI_CHAT_HISTORY": openStoredChat(message); sendResponse({ ok: true }); return;
      case "AI_CHAT_STARTED":
        if (message.surface === "sidepanel" && !state.host?.isConnected) { state.ignoreChatEvents = true; sendResponse({ ok: true }); return; }
        state.ignoreChatEvents = false;
        if (!state.host?.isConnected) openResult({ mode: "none" });
        state.model = message.model; state.thinking = message.thinking; state.generating = true;
        state.panel.querySelector("#model-badge").textContent = message.model;
        state.panel.querySelector(".status-text").textContent = message.cachedConversation ? "Генерация · кэш диалога включён" : "Генерация…";
        if (message.reasoningAdjusted) showToast(message.reasoningAdjusted);
        sendResponse({ ok: true }); return;
      case "AI_CHAT_META": {
        if (state.ignoreChatEvents) { sendResponse({ ok: true }); return; }
        const text = "Генерация…";
        const node = state.panel?.querySelector(".status-text"); if (node) node.textContent = text;
        if (message.notice) showToast(message.notice);
        sendResponse({ ok: true }); return;
      }
      case "AI_CHAT_DELTA":
        if (state.ignoreChatEvents) { sendResponse({ ok: true }); return; }
        if (message.content) [...state.panel.querySelectorAll(".message.assistant")].at(-1)?.querySelector(".reasoning")?.removeAttribute("open");
        state.answer += message.content || ""; state.reasoning += message.reasoning || ""; state.responseImages.push(...(message.images || [])); updateChat(); sendResponse({ ok: true }); return;
      case "AI_CHAT_DONE": {
        if (state.ignoreChatEvents) { state.ignoreChatEvents = false; sendResponse({ ok: true }); return; }
        if (typeof message.content === "string") state.answer = message.content;
        if (typeof message.reasoning === "string") state.reasoning = message.reasoning;
        for (const image of message.images || []) if (!state.responseImages.includes(image)) state.responseImages.push(image);
        updateChat();
        state.totalCost = Number(message.totalCost) || state.totalCost;
        const costBadge = state.panel?.querySelector("#cost-badge"); if (costBadge) costBadge.textContent = `Всего $${money(state.totalCost)}`;
        const usage = message.usage; const cost = Number(message.requestCost) || 0; const cached = Number(message.cacheReadTokens) || 0;
        const status = `${usage ? `${usage.total_tokens || 0} токенов` : "Готово"}${usage?.cost != null ? ` · $${money(cost)}` : ""}${cached ? ` · ${cached} cached` : ""}`;
        finishChat(status); sendResponse({ ok: true }); return;
      }
      case "AI_CHAT_STOPPED": if (!state.ignoreChatEvents) finishChat("Остановлено"); state.ignoreChatEvents = false; sendResponse({ ok: true }); return;
      case "AI_CHAT_ERROR":
        if (message.surface === "sidepanel" && !state.host?.isConnected) { state.ignoreChatEvents = false; sendResponse({ ok: true }); return; }
        if (state.ignoreChatEvents) { state.ignoreChatEvents = false; sendResponse({ ok: true }); return; }
        if (!state.host?.isConnected) openResult({ mode: "none" });
        finishChat("Ошибка", message.error || "Неизвестная ошибка"); sendResponse({ ok: true }); return;
      default: return false;
    }
  });
})();
