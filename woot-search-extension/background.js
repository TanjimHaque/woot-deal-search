/*
 * Woot Deal Search - service worker.
 *
 * Owns every request to Woot's public GraphQL endpoint so content scripts
 * never have to deal with CORS or the page's CSP. The endpoint/key are the
 * same ones Woot's own frontend loads from window.__WOOT_GQL__; we learn them
 * from the content script when possible and can rediscover them if they rotate.
 */
importScripts("lib.js");

const LIB = self.WootSearchLib;

const DEFAULT_GQL_URL = "https://d24qg5zsx8xdc4.cloudfront.net/graphql";
const DEFAULT_GQL_KEY = "da2-gdf6f2cxpnb3xikqgzzhfhovem";

const CACHE_TTL_MS = 3 * 60 * 1000;
const CACHE_MAX_ENTRIES = 40;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const MAX_SKIP = 1000;
const MAX_QUERY_LENGTH = 100;
const REQUEST_TIMEOUT_MS = 12000;

const SORT_VALUES = new Set([
  "",
  "DiscountPercentage",
  "PriceLowToHigh",
  "PriceHighToLow",
  "NewestFirst"
]);

const SEARCH_QUERY = `query WootSearch($filter: OfferFilterInput, $sort: OfferSortInput, $limit: Int, $skip: Int) {
  searchOffers(Filter: $filter, Sort: $sort, Limit: $limit, Skip: $skip) {
    TotalHits
    Offers {
      Id
      Title
      Subtitle
      Slug
      SoldOut
      EndDate
      IsFeatured
      IsWootOff
      Site {
        Hostname
        MarketingName
      }
      Photos {
        Url
        Width
        Height
      }
      Items {
        SalePrice
        ListPrice
        SoldOut
      }
    }
  }
}`;

class SearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SearchError";
    this.code = code;
  }
}

let gqlConfig = null;
const resultCache = new Map();
const inFlight = new Map();

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isValidConfig(cfg) {
  if (!isPlainObject(cfg)) return false;
  const { url, apiKey } = cfg;
  if (typeof url !== "string" || typeof apiKey !== "string") return false;
  if (!/^[A-Za-z0-9-]{10,200}$/.test(apiKey)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return /(^|\.)woot\.com$/i.test(parsed.hostname) || /(^|\.)cloudfront\.net$/i.test(parsed.hostname);
}

async function storeConfig(cfg) {
  gqlConfig = cfg;
  try {
    await chrome.storage.local.set({ gqlConfig: cfg });
  } catch (err) {
    // Storage can fail in rare profile states; the in-memory copy still works.
  }
}

async function discoverConfig() {
  let res;
  try {
    res = await fetch("https://www.woot.com/", {
      credentials: "omit",
      cache: "no-store"
    });
  } catch (err) {
    throw new SearchError("config", "Couldn't reach Woot to refresh the API configuration.");
  }
  if (!res.ok) {
    throw new SearchError("config", "Couldn't refresh the Woot API configuration.");
  }
  const html = await res.text();
  const match = html.match(
    /__WOOT_GQL__\s*=\s*\{\s*url:\s*"([^"]+)"\s*,\s*apiKey:\s*"([^"]+)"\s*\}/
  );
  if (!match) {
    throw new SearchError("config", "Woot's API configuration could not be found.");
  }
  const cfg = { url: match[1], apiKey: match[2] };
  if (!isValidConfig(cfg)) {
    throw new SearchError("config", "Woot returned an unsupported API configuration.");
  }
  await storeConfig(cfg);
  return cfg;
}

async function getConfig(forceDiscover) {
  if (!forceDiscover) {
    if (gqlConfig) return gqlConfig;
    try {
      const stored = (await chrome.storage.local.get("gqlConfig")).gqlConfig;
      if (isValidConfig(stored)) {
        gqlConfig = stored;
        return gqlConfig;
      }
    } catch (err) {
      // Fall through to the built-in endpoint.
    }
    gqlConfig = { url: DEFAULT_GQL_URL, apiKey: DEFAULT_GQL_KEY };
    return gqlConfig;
  }

  try {
    return await discoverConfig();
  } catch (err) {
    gqlConfig = { url: DEFAULT_GQL_URL, apiKey: DEFAULT_GQL_KEY };
    return gqlConfig;
  }
}

async function saveConfigFromPage(url, apiKey) {
  const cfg = { url, apiKey };
  if (!isValidConfig(cfg)) return false;
  if (gqlConfig && gqlConfig.url === cfg.url && gqlConfig.apiKey === cfg.apiKey) return true;
  await storeConfig(cfg);
  return true;
}

function normalizeInput(params) {
  const query = String(params && params.query ? params.query : "")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
  if (query.length < 2) {
    throw new SearchError("query_too_short", "Type at least 2 characters to search.");
  }

  const sort = SORT_VALUES.has(params.sort) ? params.sort : "";
  const limit = clampInt(params.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const skip = clampInt(params.skip, 0, 0, MAX_SKIP);
  const hideSoldOut = params.hideSoldOut !== false;

  const filter = { Keyword: query };
  if (hideSoldOut) filter.IsSoldOut = { exclude: true };

  return { query, sort, limit, skip, hideSoldOut, filter };
}

async function requestSearch(variables, retried) {
  const cfg = await getConfig(false);

  const url = new URL(cfg.url);
  url.searchParams.set("query", SEARCH_QUERY);
  url.searchParams.set("variables", JSON.stringify(variables));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-api-key": cfg.apiKey },
      signal: controller.signal,
      cache: "no-store"
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new SearchError("timeout", "The search timed out. Please try again.");
    }
    throw new SearchError("network", "Couldn't reach Woot. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    if (!retried) {
      await getConfig(true);
      return requestSearch(variables, true);
    }
    throw new SearchError("auth", "Woot rejected the search request. Reload the extension.");
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new SearchError("bad_response", "Woot returned an unexpected response.");
  }

  if (!res.ok) {
    throw new SearchError("http", "Woot returned an error (" + res.status + ").");
  }

  if (Array.isArray(body.errors) && body.errors.length) {
    const message = String((body.errors[0] && body.errors[0].message) || "");
    if (!retried && /unauthorized|forbidden|api key|invalid key/i.test(message)) {
      await getConfig(true);
      return requestSearch(variables, true);
    }
    throw new SearchError("graphql", "Woot couldn't process that search. Try a different term.");
  }

  const raw = body.data && body.data.searchOffers;
  if (!raw) {
    throw new SearchError("bad_response", "Woot returned no search results.");
  }

  const normalized = LIB.normalizeSearchResponse(raw);
  return {
    totalHits: normalized.totalHits,
    offers: normalized.offers,
    hasMore: variables.skip + normalized.offers.length < normalized.totalHits
  };
}

async function search(params) {
  const input = normalizeInput(params || {});
  const variables = {
    filter: input.filter,
    limit: input.limit,
    skip: input.skip
  };
  if (input.sort) variables.sort = input.sort;

  const cacheKey = [
    input.query,
    input.sort,
    input.hideSoldOut ? "1" : "0",
    input.skip,
    input.limit
  ].join("\u0000");

  const now = Date.now();
  const cached = resultCache.get(cacheKey);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const pending = requestSearch(variables, false)
    .then((value) => {
      resultCache.set(cacheKey, { at: Date.now(), value });
      if (resultCache.size > CACHE_MAX_ENTRIES) {
        resultCache.delete(resultCache.keys().next().value);
      }
      return value;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, pending);
  return pending;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  if (sender.id !== chrome.runtime.id) return false;

  if (message.type === "SEARCH") {
    search(message).then(
      (result) => sendResponse({ ok: true, ...result }),
      (err) => {
        const code = err instanceof SearchError ? err.code : "unknown";
        const text =
          err instanceof SearchError
            ? err.message
            : "Search failed. Please try again.";
        sendResponse({ ok: false, error: { code, message: text } });
      }
    );
    return true;
  }

  if (message.type === "SET_CONFIG") {
    saveConfigFromPage(message.url, message.apiKey).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("wootssPrefs", (data) => {
    if (!data || !data.wootssPrefs) {
      chrome.storage.local.set({ wootssPrefs: { sort: "", hideSoldOut: true } });
    }
  });
  getConfig(false).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab || typeof tab.id !== "number") return;
  chrome.tabs.sendMessage(tab.id, { type: "FOCUS_SEARCH" }, () => {
    if (!chrome.runtime.lastError) return;
    const openWoot = () =>
      chrome.storage.session
        .set({ focusSearchOnLoad: true })
        .catch(() => {})
        .finally(() => chrome.tabs.create({ url: "https://www.woot.com/" }));
    openWoot();
  });
});
