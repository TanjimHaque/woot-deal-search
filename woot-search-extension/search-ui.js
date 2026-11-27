/*
 * Woot Deal Search - shared search UI controller.
 * Powers both the in-page search bar (content.js) and the toolbar popup (popup.js).
 * All API data is rendered via safe DOM APIs (textContent / attributes, never innerHTML).
 */
(() => {
  "use strict";

  const MIN_QUERY_LENGTH = 2;
  const PAGE_SIZE = 24;
  const DEBOUNCE_MS = 250;
  const PRICE_DEBOUNCE_MS = 350;

  const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m15.5 15.5 4.5 4.5"></path></svg>`;
  const CLEAR_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>`;

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

  function createSearchUI(options) {
    const L = window.WootSearchLib || {};
    const mode = options && options.mode === "popup" ? "popup" : "inline";
    const isPopup = mode === "popup";
    const pageCategory =
      !isPopup && options && options.pageUrl && L.detectPageCategory
        ? L.detectPageCategory(options.pageUrl)
        : null;

    const SORTS = Array.isArray(L.SORTS)
      ? L.SORTS
      : ["", "BestSelling", "DiscountPercentage", "PriceLowToHigh", "PriceHighToLow", "NewestFirst"];
    const CATEGORIES = Array.isArray(L.CATEGORIES) ? L.CATEGORIES : [];

    const state = {
      seq: 0,
      query: "",
      sort: "",
      category: "",
      minPrice: "",
      maxPrice: "",
      hideSoldOut: true,
      results: [],
      totalHits: 0,
      hasMore: false,
      loading: false,
      appending: false,
      error: null,
      appendError: null,
      activeIndex: -1,
      debounceTimer: null,
      priceTimer: null
    };

    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
    const kbdLabel = isMac ? "⌘K" : "Ctrl K";

    const root = document.createElement("div");
    root.id = "wootss-root";
    root.className = "wootss-root" + (isPopup ? " wootss-mode-popup" : " wootss-mode-inline");

    const categoryOptionsHtml = [
      `<option value="">All categories</option>`,
      ...CATEGORIES.map(
        (cat) => `<option value="${cat.key}">${cat.label}</option>`
      )
    ].join("");

    const popupHeaderHtml = isPopup
      ? `<div class="wootss-popup-top">
           <span class="wootss-brand">Woot Deal Search</span>
           <a class="wootss-open-woot" href="https://www.woot.com/" target="_blank" rel="noopener noreferrer">Open Woot ↗</a>
         </div>`
      : "";

    const pageCatButtonHtml = pageCategory
      ? `<button type="button" class="wootss-scope-btn" id="wootss-scope-cat" data-cat="${pageCategory.key}">Only ${pageCategory.label}</button>`
      : "";

    root.innerHTML = `
      <div class="wootss-inner">
        ${popupHeaderHtml}
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
            aria-expanded="${isPopup ? "true" : "false"}"
            aria-controls="wootss-panel"
            aria-autocomplete="list"
          />
          <button type="button" class="wootss-clear" aria-label="Clear search" hidden>${CLEAR_ICON}</button>
          ${isPopup ? "" : `<kbd class="wootss-kbd">${kbdLabel}</kbd>`}
        </div>
        <div class="wootss-panel" id="wootss-panel" ${isPopup ? "" : "hidden"}>
          <div class="wootss-panel-head">
            <div class="wootss-head-row">
              <span class="wootss-count" id="wootss-count">Search all Woot deals</span>
              <div class="wootss-controls">
                <label class="wootss-hide">
                  <input type="checkbox" id="wootss-hide-sold" checked />
                  <span>Hide sold out</span>
                </label>
                <select class="wootss-sort" id="wootss-sort" aria-label="Sort results">
                  <option value="">Best match</option>
                  <option value="BestSelling">Best selling</option>
                  <option value="DiscountPercentage">Biggest discount</option>
                  <option value="PriceLowToHigh">Price: low to high</option>
                  <option value="PriceHighToLow">Price: high to low</option>
                  <option value="NewestFirst">Newest</option>
                </select>
              </div>
            </div>
            <div class="wootss-filter-row">
              <select class="wootss-category" id="wootss-category" aria-label="Filter by category">
                ${categoryOptionsHtml}
              </select>
              ${pageCatButtonHtml}
              <div class="wootss-price-range" aria-label="Price range">
                <span class="wootss-price-prefix">$</span>
                <input
                  type="number"
                  id="wootss-min-price"
                  class="wootss-price-input"
                  placeholder="Min"
                  min="0"
                  max="999999"
                  step="any"
                  inputmode="decimal"
                  aria-label="Minimum price"
                />
                <span class="wootss-price-sep">–</span>
                <input
                  type="number"
                  id="wootss-max-price"
                  class="wootss-price-input"
                  placeholder="Max"
                  min="0"
                  max="999999"
                  step="any"
                  inputmode="decimal"
                  aria-label="Maximum price"
                />
              </div>
              <button type="button" class="wootss-clear-filters" id="wootss-clear-filters" hidden>Clear filters</button>
            </div>
          </div>
          <div class="wootss-progress" id="wootss-progress" hidden></div>
          <div class="wootss-results" id="wootss-results" role="listbox" aria-label="Search results"></div>
          <div class="wootss-foot" id="wootss-foot" hidden>
            <span class="wootss-showing" id="wootss-showing"></span>
            <div class="wootss-foot-right">
              <span class="wootss-foot-err" id="wootss-foot-err" hidden></span>
              <button type="button" class="wootss-more" id="wootss-more" hidden>Show more</button>
            </div>
          </div>
        </div>
        <div class="wootss-live" id="wootss-live" role="status" aria-live="polite"></div>
      </div>
    `;

    const input = root.querySelector("#wootss-input");
    const panel = root.querySelector("#wootss-panel");
    const progressEl = root.querySelector("#wootss-progress");
    const resultsEl = root.querySelector("#wootss-results");
    const countEl = root.querySelector("#wootss-count");
    const showingEl = root.querySelector("#wootss-showing");
    const footEl = root.querySelector("#wootss-foot");
    const footErrEl = root.querySelector("#wootss-foot-err");
    const moreBtn = root.querySelector("#wootss-more");
    const clearBtn = root.querySelector(".wootss-clear");
    const sortSelect = root.querySelector("#wootss-sort");
    const categorySelect = root.querySelector("#wootss-category");
    const scopeCatBtn = root.querySelector("#wootss-scope-cat");
    const minPriceInput = root.querySelector("#wootss-min-price");
    const maxPriceInput = root.querySelector("#wootss-max-price");
    const clearFiltersBtn = root.querySelector("#wootss-clear-filters");
    const hideSoldOutInput = root.querySelector("#wootss-hide-sold");
    const liveEl = root.querySelector("#wootss-live");

    function announce(text) {
      if (!liveEl) return;
      liveEl.textContent = "";
      window.setTimeout(() => {
        if (liveEl) liveEl.textContent = text || "";
      }, 40);
    }

    function hasActiveFilters() {
      return Boolean(state.category || state.minPrice !== "" || state.maxPrice !== "");
    }

    function syncFilterControls() {
      categorySelect.value = state.category;
      clearFiltersBtn.hidden = !hasActiveFilters();
      if (scopeCatBtn && pageCategory) {
        scopeCatBtn.hidden = state.category === pageCategory.key;
      }
    }

    function openPanel() {
      if (isPopup || !panel || !panel.hidden) return;
      panel.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function closePanel() {
      if (isPopup || !panel || panel.hidden) return;
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
        // select() is best-effort
      }
      if (!isPopup && input.value.trim().length >= MIN_QUERY_LENGTH && (state.results.length || state.error)) {
        openPanel();
      }
    }

    function clearTimers() {
      if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
      }
      if (state.priceTimer) {
        clearTimeout(state.priceTimer);
        state.priceTimer = null;
      }
    }

    function onInput() {
      const value = input.value;
      clearBtn.hidden = value.length === 0;

      state.seq += 1;
      clearTimers();
      state.error = null;
      state.appendError = null;
      state.activeIndex = -1;

      const query = value.trim();
      if (query.length < MIN_QUERY_LENGTH) {
        state.query = "";
        state.loading = false;
        state.appending = false;
        state.results = [];
        state.totalHits = 0;
        state.hasMore = false;
        closePanel();
        renderAll();
        return;
      }

      state.query = query;
      state.loading = true;
      state.appending = false;
      renderLoadingState();
      openPanel();

      state.debounceTimer = window.setTimeout(() => {
        state.debounceTimer = null;
        runSearch(false);
      }, DEBOUNCE_MS);
    }

    function onPriceInput() {
      state.minPrice = minPriceInput.value.trim();
      state.maxPrice = maxPriceInput.value.trim();
      syncFilterControls();
      if (state.priceTimer) {
        clearTimeout(state.priceTimer);
        state.priceTimer = null;
      }
      if (input.value.trim().length < MIN_QUERY_LENGTH) return;
      state.priceTimer = window.setTimeout(() => {
        state.priceTimer = null;
        runSearch(false);
      }, PRICE_DEBOUNCE_MS);
    }

    async function runSearch(append) {
      const query = input.value.trim();
      if (query.length < MIN_QUERY_LENGTH) return;

      clearTimers();
      const seq = ++state.seq;
      const isAppend = Boolean(append && state.results.length > 0);
      state.query = query;
      state.loading = !isAppend;
      state.appending = isAppend;
      state.error = null;
      state.appendError = null;
      if (!isAppend) state.activeIndex = -1;

      if (isAppend) {
        updateFooter();
      } else {
        renderLoadingState();
        openPanel();
      }

      const skip = isAppend ? state.results.length : 0;

      try {
        const response = await sendMessage({
          type: "SEARCH",
          query,
          sort: state.sort,
          category: state.category,
          minPrice: state.minPrice,
          maxPrice: state.maxPrice,
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
        const prevLen = state.results.length;
        state.results = isAppend ? state.results.concat(offers) : offers;
        state.totalHits = Number.isFinite(response.totalHits) ? response.totalHits : state.results.length;
        state.hasMore = response.hasMore === true;
        state.loading = false;
        state.appending = false;

        if (isAppend) {
          appendRows(offers, prevLen);
          updateCount();
          updateFooter();
          syncActive();
        } else {
          renderAll();
          resultsEl.scrollTop = 0;
        }

        announce(
          state.totalHits === 1
            ? "1 deal found for " + query
            : state.totalHits + " deals found for " + query
        );
      } catch (err) {
        if (seq !== state.seq) return;
        const msg = (err && err.message) || "Search failed. Please try again.";
        state.loading = false;
        state.appending = false;
        if (isAppend) {
          state.appendError = msg;
          updateFooter();
        } else {
          state.results = [];
          state.totalHits = 0;
          state.hasMore = false;
          state.error = { message: msg };
          renderAll();
        }
        announce("Search failed");
      }
    }

    function clearSearch() {
      state.seq += 1;
      clearTimers();
      input.value = "";
      clearBtn.hidden = true;
      state.query = "";
      state.loading = false;
      state.appending = false;
      state.error = null;
      state.appendError = null;
      state.results = [];
      state.totalHits = 0;
      state.hasMore = false;
      state.activeIndex = -1;
      closePanel();
      renderAll();
      input.focus();
    }

    function clearFilters() {
      state.category = "";
      state.minPrice = "";
      state.maxPrice = "";
      minPriceInput.value = "";
      maxPriceInput.value = "";
      syncFilterControls();
      if (input.value.trim().length >= MIN_QUERY_LENGTH) runSearch(false);
    }

    /* ------------------------------------------------------------------ */
    /* Rendering                                                           */
    /* ------------------------------------------------------------------ */

    function renderLoadingState() {
      updateCount();
      if (state.results.length > 0) {
        progressEl.hidden = false;
        resultsEl.classList.add("wootss-results-busy");
      } else {
        progressEl.hidden = true;
        resultsEl.classList.remove("wootss-results-busy");
        renderResults();
      }
      updateFooter();
    }

    function renderAll() {
      progressEl.hidden = true;
      resultsEl.classList.remove("wootss-results-busy");
      updateCount();
      renderResults();
      updateFooter();
      syncActive();
    }

    function updateCount() {
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
      const fragment = document.createDocumentFragment();

      if (state.loading && state.results.length === 0) {
        for (let i = 0; i < 4; i += 1) fragment.appendChild(skeletonRow());
      } else if (state.error) {
        fragment.appendChild(errorState());
      } else if (!state.results.length) {
        if (state.query) {
          fragment.appendChild(emptyState());
        } else if (isPopup) {
          fragment.appendChild(popupIdleState());
        }
      } else {
        state.results.forEach((offer, index) => fragment.appendChild(createRow(offer, index)));
      }

      resultsEl.replaceChildren(fragment);
    }

    function appendRows(offers, startIndex) {
      if (!offers.length) return;
      const fragment = document.createDocumentFragment();
      offers.forEach((offer, i) => fragment.appendChild(createRow(offer, startIndex + i)));
      resultsEl.appendChild(fragment);
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

    function popupIdleState() {
      const box = document.createElement("div");
      box.className = "wootss-empty wootss-idle";
      const title = document.createElement("strong");
      title.textContent = "Search live Woot deals";
      const detail = document.createElement("span");
      detail.textContent = "Type at least 2 characters — try “usb”, “airpods”, or “coffee”.";
      box.appendChild(title);
      box.appendChild(detail);
      return box;
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
        runSearch(false);
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
      detail.textContent = hasActiveFilters()
        ? `Nothing matched “${state.query}” with your active filters.`
        : `Nothing matched “${state.query}”. Try fewer or different words.`;
      box.appendChild(title);
      box.appendChild(detail);
      if (hasActiveFilters()) {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "wootss-retry";
        reset.textContent = "Clear filters";
        reset.addEventListener("click", clearFilters);
        box.appendChild(reset);
      }
      return box;
    }

    function appendHighlightedTitle(container, text, query) {
      const segments = L.highlightSegments
        ? L.highlightSegments(text, query)
        : [{ text, match: false }];
      for (const seg of segments) {
        if (seg.match) {
          const mark = document.createElement("mark");
          mark.className = "wootss-mark";
          mark.textContent = seg.text;
          container.appendChild(mark);
        } else {
          container.appendChild(document.createTextNode(seg.text));
        }
      }
    }

    function makeBadge(text, className) {
      const badge = document.createElement("span");
      badge.className = "wootss-badge " + className;
      badge.textContent = text;
      return badge;
    }

    function createRow(offer, index) {
      const row = document.createElement("div");
      row.className = "wootss-result" + (offer.soldOut ? " wootss-soldout" : "");
      row.id = "wootss-option-" + index;
      row.dataset.index = String(index);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");

      const mainLink = document.createElement("a");
      mainLink.className = "wootss-result-main";
      mainLink.href = offer.url;
      mainLink.tabIndex = -1;
      if (isPopup) {
        mainLink.target = "_blank";
        mainLink.rel = "noopener noreferrer";
      }

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
      appendHighlightedTitle(title, offer.title, state.query);

      // Line 1: Sale price, list price, discount, Amazon star rating
      const meta = document.createElement("span");
      meta.className = "wootss-meta";

      const price = document.createElement("span");
      price.className = "wootss-price";
      if (offer.salePrice !== null && offer.salePrice !== undefined && L.formatPrice) {
        price.textContent = (offer.fromPrice ? "From " : "") + L.formatPrice(offer.salePrice);
      } else {
        price.textContent = "Price unavailable";
      }
      meta.appendChild(price);

      if (offer.listPrice && L.formatPrice) {
        const list = document.createElement("span");
        list.className = "wootss-list";
        list.textContent = L.formatPrice(offer.listPrice);
        meta.appendChild(list);
      }

      if (offer.discountPct) {
        const off = document.createElement("span");
        off.className = "wootss-off";
        off.textContent = "-" + offer.discountPct + "%";
        meta.appendChild(off);
      }

      if (offer.rating && offer.reviewCount) {
        const rating = document.createElement("span");
        rating.className = "wootss-rating";
        const countStr = L.formatCompactCount ? L.formatCompactCount(offer.reviewCount) : String(offer.reviewCount);
        rating.textContent = `★ ${offer.rating.toFixed(1)} (${countStr})`;
        rating.title = `${offer.rating.toFixed(1)} out of 5 from ${formatCount(offer.reviewCount)} Amazon reviews`;
        meta.appendChild(rating);
      }

      info.appendChild(title);
      info.appendChild(meta);

      // Line 2: Condition, Category, Woot-Off, Ending soon, Sold out
      const badges = document.createElement("span");
      badges.className = "wootss-badges";

      if (offer.condition) {
        const isNew = /^new$/i.test(offer.condition);
        badges.appendChild(makeBadge(offer.condition, isNew ? "wootss-badge-new" : "wootss-badge-cond"));
      }
      if (offer.categoryLabel) {
        badges.appendChild(makeBadge(offer.categoryLabel, "wootss-badge-cat"));
      }
      if (offer.isWootOff) {
        badges.appendChild(makeBadge("Woot-Off", "wootss-badge-wootoff"));
      }
      if (!offer.soldOut && L.isEndingSoon && L.isEndingSoon(offer.endDate)) {
        badges.appendChild(makeBadge("Ending soon", "wootss-badge-ending"));
      }
      if (offer.soldOut) {
        badges.appendChild(makeBadge("Sold out", "wootss-sold"));
      }

      if (badges.childNodes.length > 0) {
        info.appendChild(badges);
      }

      mainLink.appendChild(thumb);
      mainLink.appendChild(info);
      row.appendChild(mainLink);

      // External quick links via ASIN (plain links, zero extra requests or permissions)
      if (offer.amazonUrl || offer.cccUrl) {
        const actions = document.createElement("div");
        actions.className = "wootss-result-actions";

        if (offer.amazonUrl) {
          const amz = document.createElement("a");
          amz.className = "wootss-ext-link";
          amz.href = offer.amazonUrl;
          amz.target = "_blank";
          amz.rel = "noopener noreferrer";
          amz.textContent = "Amazon ↗";
          amz.title = "Check listing & reviews on Amazon";
          amz.setAttribute("aria-label", `View ${offer.title} on Amazon`);
          actions.appendChild(amz);
        }

        if (offer.cccUrl) {
          const ccc = document.createElement("a");
          ccc.className = "wootss-ext-link";
          ccc.href = offer.cccUrl;
          ccc.target = "_blank";
          ccc.rel = "noopener noreferrer";
          ccc.textContent = "CCC ↗";
          ccc.title = "Check Amazon price history on CamelCamelCamel";
          ccc.setAttribute("aria-label", `View ${offer.title} price history on CamelCamelCamel`);
          actions.appendChild(ccc);
        }

        row.appendChild(actions);
      }

      row.addEventListener("pointermove", () => {
        if (state.activeIndex !== index) {
          state.activeIndex = index;
          syncActive();
        }
      });

      return row;
    }

    function updateFooter() {
      if (!state.results.length) {
        showingEl.textContent = "";
        footErrEl.textContent = "";
        footErrEl.hidden = true;
        moreBtn.hidden = true;
        footEl.hidden = true;
        return;
      }
      footEl.hidden = false;
      showingEl.textContent = `Showing ${formatCount(state.results.length)} of ${formatCount(
        state.totalHits
      )}`;

      if (state.appendError) {
        footErrEl.textContent = state.appendError;
        footErrEl.hidden = false;
        moreBtn.hidden = false;
        moreBtn.disabled = false;
        moreBtn.textContent = "Retry";
      } else {
        footErrEl.textContent = "";
        footErrEl.hidden = true;
        moreBtn.hidden = !state.hasMore;
        moreBtn.disabled = state.appending || state.loading;
        moreBtn.textContent = state.appending ? "Loading…" : "Show more";
      }
    }

    function syncActive() {
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

    function openOffer(url, newTab) {
      if (!url) return;
      if (newTab || isPopup) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        window.location.assign(url);
      }
    }

    function onInputKeyDown(event) {
      if (event.key === "Escape") {
        if (!isPopup) {
          if (panel && !panel.hidden) {
            event.preventDefault();
            closePanel();
          } else {
            input.blur();
          }
        } else if (input.value) {
          event.preventDefault();
          clearSearch();
        }
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!state.results.length) return;
        event.preventDefault();
        if (!isPopup && panel.hidden) openPanel();
        moveActive(event.key === "ArrowDown" ? 1 : -1);
        return;
      }

      if (event.key === "Enter") {
        if (!state.results.length) return;
        event.preventDefault();
        const index = state.activeIndex >= 0 ? state.activeIndex : 0;
        const offer = state.results[index];
        if (offer && offer.url) {
          openOffer(offer.url, Boolean(event.metaKey || event.ctrlKey));
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* Preferences (strictly sort + hideSoldOut only)                      */
    /* ------------------------------------------------------------------ */

    function applyPrefs(prefs) {
      if (!prefs || typeof prefs !== "object") return;
      if (SORTS.indexOf(prefs.sort) !== -1) state.sort = prefs.sort;
      if (typeof prefs.hideSoldOut === "boolean") state.hideSoldOut = prefs.hideSoldOut;
      sortSelect.value = state.sort;
      hideSoldOutInput.checked = state.hideSoldOut;
    }

    async function loadPrefs() {
      try {
        const data = await chrome.storage.local.get("wootssPrefs");
        applyPrefs(data && data.wootssPrefs);
      } catch (err) {
        // Defaults are already in place.
      }
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

    /* ------------------------------------------------------------------ */
    /* Wire events                                                         */
    /* ------------------------------------------------------------------ */

    input.addEventListener("input", onInput);
    input.addEventListener("search", onInput);
    input.addEventListener("focus", () => {
      if (!isPopup && input.value.trim().length >= MIN_QUERY_LENGTH && (state.results.length || state.error)) {
        openPanel();
      }
    });
    input.addEventListener("keydown", onInputKeyDown);
    clearBtn.addEventListener("click", clearSearch);
    moreBtn.addEventListener("click", () => runSearch(true));
    clearFiltersBtn.addEventListener("click", clearFilters);

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

    categorySelect.addEventListener("change", () => {
      state.category = L.isValidCategory && L.isValidCategory(categorySelect.value) ? categorySelect.value : "";
      syncFilterControls();
      if (input.value.trim().length >= MIN_QUERY_LENGTH) runSearch(false);
    });

    if (scopeCatBtn && pageCategory) {
      scopeCatBtn.addEventListener("click", () => {
        state.category = pageCategory.key;
        syncFilterControls();
        if (input.value.trim().length >= MIN_QUERY_LENGTH) {
          runSearch(false);
        } else {
          input.focus();
        }
      });
    }

    const onPriceKeyDown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        state.minPrice = minPriceInput.value.trim();
        state.maxPrice = maxPriceInput.value.trim();
        syncFilterControls();
        if (input.value.trim().length >= MIN_QUERY_LENGTH) runSearch(false);
      }
    };
    minPriceInput.addEventListener("input", onPriceInput);
    maxPriceInput.addEventListener("input", onPriceInput);
    minPriceInput.addEventListener("keydown", onPriceKeyDown);
    maxPriceInput.addEventListener("keydown", onPriceKeyDown);

    const onStorageChange = (changes, areaName) => {
      if (areaName !== "local" || !changes || !changes.wootssPrefs) return;
      applyPrefs(changes.wootssPrefs.newValue);
    };
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(onStorageChange);
    }

    syncFilterControls();
    loadPrefs();
    if (isPopup) renderAll();

    return {
      root,
      input,
      panel,
      focusInput,
      openPanel,
      closePanel,
      destroy() {
        clearTimers();
        if (chrome.storage && chrome.storage.onChanged) {
          chrome.storage.onChanged.removeListener(onStorageChange);
        }
      }
    };
  }

  window.WootSearchUI = { create: createSearchUI };
})();
