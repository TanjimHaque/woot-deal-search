/*
 * Woot Deal Search - content script.
 * Injects the shared search bar under Woot's global header, watches for SPA
 * header re-renders, reports Woot's public GraphQL config to the service
 * worker, and registers the Cmd/Ctrl+K shortcut.
 */
(() => {
  "use strict";

  const ROOT_ID = "wootss-root";
  const L = window.WootSearchLib || {};

  let ui = null;
  let observer = null;
  let listenersAttached = false;
  let bootAttempts = 0;

  function onDocumentKeyDown(event) {
    if (!ui) return;
    const key = (event.key || "").toLowerCase();
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === "k") {
      event.preventDefault();
      event.stopPropagation();
      ui.focusInput();
    }
  }

  function onDocumentPointerDown(event) {
    if (!ui || !ui.root || !ui.panel || ui.panel.hidden) return;
    if (!ui.root.contains(event.target)) ui.closePanel();
  }

  function attachDocumentListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeyDown, true);
  }

  function reportConfig() {
    try {
      const scripts = Array.prototype.slice.call(document.scripts || []);
      for (const script of scripts) {
        if (!script.textContent || script.textContent.indexOf("__WOOT_GQL__") === -1) continue;
        const cfg = L.extractGqlConfig ? L.extractGqlConfig(script.textContent) : null;
        if (!cfg) continue;
        chrome.runtime.sendMessage(
          { type: "SET_CONFIG", url: cfg.url, apiKey: cfg.apiKey },
          () => {
            void chrome.runtime.lastError;
          }
        );
        return;
      }
    } catch (err) {
      // The built-in endpoint remains available.
    }
  }

  function watchHeader() {
    if (observer) observer.disconnect();
    const container = document.getElementById("header-container") || document.body;
    observer = new MutationObserver(() => {
      if (document.getElementById(ROOT_ID)) return;
      const header = document.querySelector("#global-header");
      if (header) mount(header);
    });
    observer.observe(container, { childList: true });
  }

  function mount(header) {
    if (document.getElementById(ROOT_ID)) return;
    if (!window.WootSearchUI) return;

    if (ui) ui.destroy();
    ui = window.WootSearchUI.create({
      mode: "inline",
      pageUrl: window.location.href
    });

    header.insertAdjacentElement("afterend", ui.root);
    attachDocumentListeners();
    reportConfig();
    watchHeader();
  }

  function boot() {
    if (document.getElementById(ROOT_ID)) return;
    const header = document.querySelector("#global-header");
    if (!header) {
      bootAttempts += 1;
      if (bootAttempts <= 20) window.setTimeout(boot, 500);
      return;
    }
    mount(header);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
