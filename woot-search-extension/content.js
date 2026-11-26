/*
 * Woot Deal Search - content script.
 * Injects a search bar under Woot's global header and renders an overlay
 * of live results. All network work happens in the service worker.
 */
(() => {
  "use strict";

  const ROOT_ID = "wootss-root";
  const MIN_QUERY_LENGTH = 2;
  const PAGE_SIZE = 24;
  const DEBOUNCE_MS = 250;
  const SORTS = ["", "DiscountPercentage", "PriceLowToHigh", "PriceHighToLow", "NewestFirst"];

  const L = window.WootSearchLib || {};

  const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m15.5 15.5 4.5 4.5"></path></svg>`;
  const CLEAR_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>`;

  const state = {
    seq: 0,
    query: "",
    sort: "",
    hideSoldOut: true,
    results: [],
    totalHits: 0,
    hasMore: false,
    loading: false,
    error: null,
    activeIndex: -1,
    lastAppend: false,
    debounceTimer: null
  };

  let root = null;
  let input = null;
  let panel = null;
  let resultsEl = null;
  let countEl = null;
  let showingEl = null;
  let footEl = null;
  let moreBtn = null;
  let clearBtn = null;
  let sortSelect = null;
  let hideSoldOutInput = null;
  let liveEl = null;
  let observer = null;
  let listenersAttached = false;
  let bootAttempts = 0;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function formatCount(n) {
    try {
      return Number(n).toLocaleString("en-US");
    } catch (err) {
      return String(n);
    }
  }

  function makePlaceholderIcon() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 64 64");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "wootss-ph");
    const bag = document.createElementNS(ns, "path");
    bag.setAttribute("d", "M20 24h24l-2.2 22H22.2L20 24Z");
    bag.setAttribute("fill", "none");
    bag.setAttribute("stroke", "#b7bcbc");
    bag.setAttribute("stroke-width", "2.5");
    bag.setAttribute("stroke-linejoin", "round");
    const handle = document.createElementNS(ns, "path");
    handle.setAttribute("d", "M26 24v-4a6 6 0 0 1 12 0v4");
    handle.setAttribute("fill", "none");
    handle.setAttribute("stroke", "#b7bcbc");
    handle.setAttribute("stroke-width", "2.5");
    handle.setAttribute("stroke-linecap", "round");
    svg.appendChild(bag);
    svg.appendChild(handle);
    return svg;
  }

  function sendMessage(payload) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message || "The search service is unavailable."));
            return;
          }
          resolve(response);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function announce(text) {
    if (!liveEl) return;
    liveEl.textContent = "";
    window.setTimeout(() => {
      if (liveEl) liveEl.textContent = text || "";
    }, 40);
  }

  /* ------------------------------------------------------------------ */
  /* UI construction                                                     */
  /* ------------------------------------------------------------------ */

  function buildUI() {
    const wrapper = document.createElement("div");
    wrapper.id = ROOT_ID;
    wrapper.className = "wootss-root";

    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
    const kbdLabel = isMac ? "⌘K" : "Ctrl K";

    wrapper.innerHTML = `
      <div class="wootss-inner">
        <div class="wootss-bar">
          <span class="wootss-search-icon">${SEARCH_ICON}</span>
          <input
            id="wootss-input"
            class="wootss-input"
            type="search"
            placeholder="Search all Woot deals…"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            aria-label="Search Woot deals"
            role="combobox"
            aria-expanded="false"
            aria-controls="wootss-panel"
            aria-autocomplete="list"
          />
          <button type="button" class="wootss-clear" aria-label="Clear search" hidden>${CLEAR_ICON}</button>
          <kbd class="wootss-kbd">${kbdLabel}</kbd>
        </div>
        <div class="wootss-panel" id="wootss-panel" hidden>
          <div class="wootss-panel-head">
            <span class="wootss-count" id="wootss-count">Search all Woot deals</span>
            <div class="wootss-controls">
              <label class="wootss-hide">
                <input type="checkbox" id="wootss-hide-sold" checked />
                <span>Hide sold out</span>
              </label>
              <select class="wootss-sort" id="wootss-sort" aria-label="Sort results">
                <option value="">Best match</option>
                <option value="DiscountPercentage">Biggest discount</option>
                <option value="PriceLowToHigh">Price: low to high</option>
                <option value="PriceHighToLow">Price: high to low</option>
                <option value="NewestFirst">Newest</option>
              </select>
            </div>
          </div>
          <div class="wootss-results" id="wootss-results" role="listbox" aria-label="Search results"></div>
          <div class="wootss-foot" id="wootss-foot">
            <span class="wootss-showing" id="wootss-showing"></span>
            <button type="button" class="wootss-more" id="wootss-more" hidden>Show more</button>
          </div>
        </div>
        <div class="wootss-live" id="wootss-live" role="status" aria-live="polite"></div>
      </div>
    `;

    root = wrapper;
    input = wrapper.querySelector("#wootss-input");
    panel = wrapper.querySelector("#wootss-panel");
    resultsEl = wrapper.querySelector("#wootss-results");
    countEl = wrapper.querySelector("#wootss-count");
    showingEl = wrapper.querySelector("#wootss-showing");
    footEl = wrapper.querySelector("#wootss-foot");
    moreBtn = wrapper.querySelector("#wootss-more");
    clearBtn = wrapper.querySelector(".wootss-clear");
    sortSelect = wrapper.querySelector("#wootss-sort");
    hideSoldOutInput = wrapper.querySelector("#wootss-hide-sold");
    liveEl = wrapper.querySelector("#wootss-live");

    return wrapper;
  }

  function mount(header) {
    if (document.getElementById(ROOT_ID)) return;

    const ui = buildUI();
    header.insertAdjacentElement("afterend", ui);

    if (state.query) input.value = state.query;
    hideSoldOutInput.checked = state.hideSoldOut;
    sortSelect.value = state.sort;

    wireEvents();
    attachDocumentListeners();
    if (state.query) render();
    loadPrefs();
    reportConfig();
    checkFocusFlag();
    watchHeader();
  }

  function wireEvents() {
    input.addEventListener("input", onInput);
    input.addEventListener("search", onInput);
    input.addEventListener("focus", () => {
      if (input.value.trim().length >= MIN_QUERY_LENGTH && (state.results.length || state.error)) {
        openPanel();
      }
    });
    input.addEventListener("keydown", onInputKeyDown);
    clearBtn.addEventListener("click", clearSearch);
    moreBtn.addEventListener("click", () => runSearch(true));

    hideSoldOutInput.addEventListener("change", () => {
      state.hideSoldOut = hideSoldOutInput.checked;
      savePrefs();
      if (input.value.trim().length >= MIN_QUERY_LENGTH) runSearch(false);
    });

    sortSelect.addEventListener("change", () => {
      state.sort = SORTS.indexOf(sortSelect.value) !== -1 ? sortSelect.value : "";
      savePrefs();
      if (input.value.trim().length >= MIN_QUERY_LENGTH) runSearch(false);
    });
  }

  function attachDocumentListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeyDown, true);
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

  /* ------------------------------------------------------------------ */
  /* Panel state                                                         */
  /* ------------------------------------------------------------------ */

  function openPanel() {
    if (!panel || !panel.hidden) return;
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    state.activeIndex = -1;
    syncActive();
  }

  function focusInput() {
    if (!input) return;
    input.focus();
    try {
      input.select();
    } catch (err) {
      // ignore; select() is best-effort
    }
    if (input.value.trim().length >= MIN_QUERY_LENGTH && state.results.length) openPanel();
  }

  /* ------------------------------------------------------------------ */
  /* Searching                                                           */
  /* ------------------------------------------------------------------ */

  function onInput() {
    const value = input.value;
    clearBtn.hidden = value.length === 0;

    state.seq += 1;
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }

    state.error = null;
    state.activeIndex = -1;

    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      state.query = "";
      state.loading = false;
      state.results = [];
      state.totalHits = 0;
      state.hasMore = false;
      state.lastAppend = false;
      closePanel();
      render();
      return;
    }

    state.query = query;
    state.loading = true;
    state.results = [];
    state.totalHits = 0;
    state.hasMore = false;
    state.lastAppend = false;
    render();
    openPanel();

    state.debounceTimer = window.setTimeout(() => {
      state.debounceTimer = null;
      runSearch(false);
    }, DEBOUNCE_MS);
  }

  async function runSearch(append) {
    const query = input.value.trim();
    if (query.length < MIN_QUERY_LENGTH) return;

    const seq = ++state.seq;
    state.query = query;
    state.loading = true;
    state.error = null;
    state.activeIndex = -1;
    state.lastAppend = Boolean(append);

    if (!append) {
      state.results = [];
      state.totalHits = 0;
      state.hasMore = false;
    }

    render();
    openPanel();

    const skip = append ? state.results.length : 0;

    try {
      const response = await sendMessage({
        type: "SEARCH",
        query,
        sort: state.sort,
        hideSoldOut: state.hideSoldOut,
        skip,
        limit: PAGE_SIZE
      });

      if (seq !== state.seq) return;

      if (!response || !response.ok) {
        const error = response && response.error ? response.error : null;
        throw new Error((error && error.message) || "Search failed. Please try again.");
      }

      const offers = Array.isArray(response.offers) ? response.offers : [];
      state.results = append ? state.results.concat(offers) : offers;
      state.totalHits = Number.isFinite(response.totalHits) ? response.totalHits : state.results.length;
      state.hasMore = response.hasMore === true;
      state.loading = false;
      render();
      announce(
        state.totalHits === 1
          ? "1 deal found for " + query
          : state.totalHits + " deals found for " + query
      );
    } catch (err) {
      if (seq !== state.seq) return;
      state.loading = false;
      state.error = { message: (err && err.message) || "Search failed. Please try again." };
      render();
      announce("Search failed");
    }
  }

  function clearSearch() {
    state.seq += 1;
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    input.value = "";
    clearBtn.hidden = true;
    state.query = "";
    state.loading = false;
    state.error = null;
    state.results = [];
    state.totalHits = 0;
    state.hasMore = false;
    state.activeIndex = -1;
    closePanel();
    render();
    input.focus();
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function render() {
    updateCount();
    renderResults();
    updateFooter();
    syncActive();
  }

  function updateCount() {
    if (!countEl) return;
    const query = state.query || (input ? input.value.trim() : "");
    if (!query) {
      countEl.textContent = "Search all Woot deals";
      return;
    }
    if (state.loading && state.results.length === 0) {
      countEl.textContent = `Searching for “${query}”…`;
      return;
    }
    if (state.error) {
      countEl.textContent = "Search unavailable";
      return;
    }
    if (state.totalHits > 0) {
      countEl.textContent = `${formatCount(state.totalHits)} ${
        state.totalHits === 1 ? "deal" : "deals"
      } for “${query}”`;
      return;
    }
    countEl.textContent = `No deals for “${query}”`;
  }

  function renderResults() {
    if (!resultsEl) return;
    const fragment = document.createDocumentFragment();

    if (state.loading && state.results.length === 0) {
      for (let i = 0; i < 4; i += 1) fragment.appendChild(skeletonRow());
    } else if (state.error) {
      fragment.appendChild(errorState());
    } else if (!state.results.length) {
      if (state.query) fragment.appendChild(emptyState());
    } else {
      state.results.forEach((offer, index) => fragment.appendChild(createRow(offer, index)));
    }

    resultsEl.replaceChildren(fragment);
  }

  function skeletonRow() {
    const row = document.createElement("div");
    row.className = "wootss-skrow";
    row.setAttribute("aria-hidden", "true");
    const thumb = document.createElement("span");
    thumb.className = "wootss-skthumb";
    const lines = document.createElement("span");
    lines.className = "wootss-sktext";
    for (let i = 0; i < 2; i += 1) {
      const line = document.createElement("span");
      line.className = i === 0 ? "wootss-skline wootss-skline-title" : "wootss-skline wootss-skline-short";
      lines.appendChild(line);
    }
    row.appendChild(thumb);
    row.appendChild(lines);
    return row;
  }

  function errorState() {
    const box = document.createElement("div");
    box.className = "wootss-state";
    const title = document.createElement("strong");
    title.textContent = "Search is unavailable right now";
    const detail = document.createElement("span");
    detail.textContent = state.error.message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "wootss-retry";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      state.error = null;
      runSearch(state.lastAppend);
    });
    box.appendChild(title);
    box.appendChild(detail);
    box.appendChild(retry);
    return box;
  }

  function emptyState() {
    const box = document.createElement("div");
    box.className = "wootss-empty";
    const title = document.createElement("strong");
    title.textContent = "No deals found";
    const detail = document.createElement("span");
    detail.textContent = `Nothing matched “${state.query}”. Try fewer or different words.`;
    box.appendChild(title);
    box.appendChild(detail);
    return box;
  }

  function createRow(offer, index) {
    const row = document.createElement("a");
    row.className = "wootss-result" + (offer.soldOut ? " wootss-soldout" : "");
    row.href = offer.url;
    row.id = "wootss-option-" + index;
    row.dataset.index = String(index);
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", "false");
    row.tabIndex = -1;

    const thumb = document.createElement("span");
    thumb.className = "wootss-thumb";

    if (offer.image) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = offer.image;
      img.addEventListener(
        "error",
        () => {
          if (img.parentNode === thumb) thumb.replaceChild(makePlaceholderIcon(), img);
        },
        { once: true }
      );
      thumb.appendChild(img);
    } else {
      thumb.appendChild(makePlaceholderIcon());
    }

    const info = document.createElement("span");
    info.className = "wootss-info";

    const title = document.createElement("span");
    title.className = "wootss-title";
    title.textContent = offer.title;

    const meta = document.createElement("span");
    meta.className = "wootss-meta";

    if (offer.salePrice !== null && offer.salePrice !== undefined && L.formatPrice) {
      const price = document.createElement("span");
      price.className = "wootss-price";
      price.textContent = (offer.fromPrice ? "From " : "") + L.formatPrice(offer.salePrice);
      meta.appendChild(price);
    } else {
      const price = document.createElement("span");
      price.className = "wootss-price";
      price.textContent = "Price unavailable";
      meta.appendChild(price);
    }

    if (offer.listPrice) {
      const list = document.createElement("span");
      list.className = "wootss-list";
      list.textContent = L.formatPrice ? L.formatPrice(offer.listPrice) : "";
      meta.appendChild(list);
    }

    if (offer.discountPct) {
      const off = document.createElement("span");
      off.className = "wootss-off";
      off.textContent = "-" + offer.discountPct + "%";
      meta.appendChild(off);
    }

    if (offer.soldOut) {
      const sold = document.createElement("span");
      sold.className = "wootss-sold";
      sold.textContent = "Sold out";
      meta.appendChild(sold);
    }

    info.appendChild(title);
    info.appendChild(meta);
    row.appendChild(thumb);
    row.appendChild(info);

    row.addEventListener("pointermove", () => {
      if (state.activeIndex !== index) {
        state.activeIndex = index;
        syncActive();
      }
    });

    return row;
  }

  function updateFooter() {
    if (!footEl) return;
    if (!state.results.length) {
      showingEl.textContent = "";
      moreBtn.hidden = true;
      footEl.hidden = true;
      return;
    }
    footEl.hidden = false;
    showingEl.textContent = `Showing ${formatCount(state.results.length)} of ${formatCount(
      state.totalHits
    )}`;
    moreBtn.hidden = !state.hasMore;
    moreBtn.disabled = state.loading;
    moreBtn.textContent = state.loading ? "Loading…" : "Show more";
  }

  function syncActive() {
    if (!resultsEl) return;
    const rows = resultsEl.querySelectorAll(".wootss-result");
    rows.forEach((row, index) => {
      const active = index === state.activeIndex;
      row.classList.toggle("wootss-active", active);
      row.setAttribute("aria-selected", active ? "true" : "false");
    });

    if (state.activeIndex >= 0 && rows[state.activeIndex]) {
      rows[state.activeIndex].scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", rows[state.activeIndex].id);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard and pointer                                                */
  /* ------------------------------------------------------------------ */

  function onDocumentKeyDown(event) {
    if (!input) return;
    const key = (event.key || "").toLowerCase();
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === "k") {
      event.preventDefault();
      event.stopPropagation();
      focusInput();
    }
  }

  function onInputKeyDown(event) {
    if (event.key === "Escape") {
      if (panel && !panel.hidden) {
        event.preventDefault();
        closePanel();
      } else {
        input.blur();
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!state.results.length) return;
      event.preventDefault();
      if (panel.hidden) openPanel();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter") {
      if (!state.results.length) return;
      event.preventDefault();
      const index = state.activeIndex >= 0 ? state.activeIndex : 0;
      const offer = state.results[index];
      if (offer && offer.url) window.location.assign(offer.url);
    }
  }

  function moveActive(delta) {
    const total = state.results.length;
    if (!total) return;
    if (state.activeIndex < 0) {
      state.activeIndex = delta > 0 ? 0 : total - 1;
    } else {
      state.activeIndex = (state.activeIndex + delta + total) % total;
    }
    syncActive();
  }

  function onDocumentPointerDown(event) {
    if (!root || !panel || panel.hidden) return;
    if (!root.contains(event.target)) closePanel();
  }

  /* ------------------------------------------------------------------ */
  /* Preferences, config, focus flag                                     */
  /* ------------------------------------------------------------------ */

  async function loadPrefs() {
    try {
      const data = await chrome.storage.local.get("wootssPrefs");
      const prefs = data && data.wootssPrefs;
      if (prefs && typeof prefs === "object") {
        if (SORTS.indexOf(prefs.sort) !== -1) state.sort = prefs.sort;
        if (typeof prefs.hideSoldOut === "boolean") state.hideSoldOut = prefs.hideSoldOut;
      }
    } catch (err) {
      // Defaults are already in place.
    }
    if (sortSelect) sortSelect.value = state.sort;
    if (hideSoldOutInput) hideSoldOutInput.checked = state.hideSoldOut;
  }

  function savePrefs() {
    try {
      chrome.storage.local.set({
        wootssPrefs: { sort: state.sort, hideSoldOut: state.hideSoldOut }
      });
    } catch (err) {
      // Preferences are a convenience; ignore storage errors.
    }
  }

  function reportConfig() {
    try {
      const scripts = Array.prototype.slice.call(document.scripts || []);
      const inline = scripts.find(
        (script) => script.textContent && script.textContent.indexOf("__WOOT_GQL__") !== -1
      );
      if (!inline) return;
      const match = inline.textContent.match(
        /__WOOT_GQL__\s*=\s*\{\s*url:\s*"([^"]+)"\s*,\s*apiKey:\s*"([^"]+)"/
      );
      if (!match) return;
      chrome.runtime.sendMessage(
        { type: "SET_CONFIG", url: match[1], apiKey: match[2] },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch (err) {
      // The built-in endpoint remains available.
    }
  }

  async function checkFocusFlag() {
    try {
      if (!chrome.storage.session) return;
      const data = await chrome.storage.session.get("focusSearchOnLoad");
      if (!data || !data.focusSearchOnLoad) return;
      await chrome.storage.session.remove("focusSearchOnLoad");
      window.setTimeout(focusInput, 250);
    } catch (err) {
      // Ignore; this is a convenience path only.
    }
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                           */
  /* ------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "FOCUS_SEARCH") {
      focusInput();
      sendResponse({ ok: true });
    }
    return false;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
