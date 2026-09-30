(() => {
  let CONTENT_SCRIPT_VERSION = "";
  try { CONTENT_SCRIPT_VERSION = chrome.runtime.getManifest().version; } catch { return; }
  if (globalThis.__AI_TEXT_TOOLS_LOADED__ === CONTENT_SCRIPT_VERSION) return;
  try { globalThis.__AI_TEXT_TOOLS_CLEANUP__?.(); } catch {}
  globalThis.__AI_TEXT_TOOLS_LOADED__ = CONTENT_SCRIPT_VERSION;

  const SELECTION_EVENTS = ["selectionchange", "select", "mouseup", "keyup"];
  let extensionContextActive = true;
  let trackSelection = false;
  let publishedSelection = null;
  let selectionTimer = null;

  function disconnectOrphanedContentScript() {
    if (!extensionContextActive) return;
    extensionContextActive = false;
    clearTimeout(selectionTimer);
    for (const type of SELECTION_EVENTS) document.removeEventListener(type, scheduleSelectionPublish, true);
    try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch {}
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
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

  function currentSelection() {
    const active = document.activeElement;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT") && typeof active.selectionStart === "number") {
      if (active.type === "password") return "";
      return active.value.slice(active.selectionStart, active.selectionEnd).trim();
    }
    return window.getSelection()?.toString().trim() || "";
  }

  function scheduleSelectionPublish() {
    if (!extensionContextActive || !trackSelection) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const selectionText = currentSelection();
      if (selectionText === publishedSelection) return;
      publishedSelection = selectionText;
      sendRuntimeMessage({ action: "AI_SELECTION_CHANGED", selectionText }).catch(() => {});
    }, 120);
  }

  // Live selection only matters while a side panel is open; publishing it
  // otherwise would wake the service worker on every selection in every tab.
  function setSelectionTracking(enabled) {
    trackSelection = Boolean(enabled);
    publishedSelection = null;
    if (trackSelection) scheduleSelectionPublish();
  }

  // Panels refresh their entry every minute; a stale one belongs to a panel that
  // closed without cleaning up.
  const hasOpenPanel = panels => Object.values(panels || {}).some(seen => Date.now() - Number(seen) < 150000);

  function onStorageChanged(changes, areaName) {
    if (areaName === "local" && changes.aiPanels) setSelectionTracking(hasOpenPanel(changes.aiPanels.newValue));
  }

  for (const type of SELECTION_EVENTS) document.addEventListener(type, scheduleSelectionPublish, true);
  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.storage.local.get("aiPanels").then(result => setSelectionTracking(hasOpenPanel(result.aiPanels)), () => {});
  globalThis.__AI_TEXT_TOOLS_CLEANUP__ = disconnectOrphanedContentScript;

  function extractPageLinks(maxLinks = 120, maxChars = 16000) {
    const linksByUrl = new Map();
    for (const anchor of document.querySelectorAll("a[href]")) {
      if (anchor.closest("[hidden],[aria-hidden='true']")) continue;
      const style = getComputedStyle(anchor);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const text = (anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || anchor.querySelector("img[alt]")?.alt || "").replace(/\s+/g, " ").trim();
      if (text.length < 2) continue;
      try {
        const url = new URL(anchor.getAttribute("href"), location.href);
        if (!["http:", "https:"].includes(url.protocol) || url.href.length > 2048) continue;
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

  // Visible text of a shadow tree; textContent would also return CSS and scripts.
  function shadowText(root) {
    const parts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => /^(STYLE|SCRIPT|NOSCRIPT|TEMPLATE)$/.test(node.parentNode?.nodeName || "") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue.trim();
      if (text) parts.push(text);
    }
    return parts.join(" ");
  }

  function extractPageContext(limit = Number.MAX_SAFE_INTEGER, includeLinks = false, linkLimit = 16000) {
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
      if (!element.shadowRoot) continue;
      const hostText = shadowText(element.shadowRoot);
      if (hostText.length > 30 && !text.includes(hostText.slice(0, 200))) extras.push(hostText);
    }
    if (extras.length) text = [text, ...extras].join("\n\n");
    if (text.trim().length < 20) text = document.body?.textContent || document.documentElement?.textContent || "";
    text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
    const wasTruncated = text.length > limit;
    if (wasTruncated) text = text.slice(0, limit);
    const pageLinks = includeLinks ? extractPageLinks(120, linkLimit) : [];
    return { pageText: text, pageTitle: document.title, pageUrl: location.href, pageLinks, includeLinks: Boolean(includeLinks), wasTruncated };
  }

  function onMessage(message, _sender, sendResponse) {
    switch (message.action) {
      case "PING_AI_TEXT_TOOLS": sendResponse({ ok: true }); return;
      case "GET_AI_PAGE_CONTEXT": sendResponse(extractPageContext(message.limit, message.includeLinks, message.linkLimit)); return;
      case "GET_AI_SELECTION": sendResponse({ selectionText: currentSelection() }); return;
      default: return false;
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);
})();
