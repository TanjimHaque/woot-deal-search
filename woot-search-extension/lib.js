/*
 * Pure helpers shared by the Woot Deal Search service worker, UI, and tests.
 * No DOM, no chrome.* APIs, no network here.
 */
(function (root, factory) {
  "use strict";
  const lib = factory();
  if (typeof module === "object" && module.exports) module.exports = lib;
  if (root) root.WootSearchLib = lib;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WOOT_HOST_RE = /^(?:[a-z0-9-]+\.)+woot\.com$/i;
  const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;
  const ASIN_RE = /^[A-Z0-9]{10}$/i;
  const MAX_PRICE_BOUND = 999999;
  const ENDING_SOON_MS = 24 * 60 * 60 * 1000;

  const SORTS = Object.freeze([
    "",
    "BestSelling",
    "DiscountPercentage",
    "PriceLowToHigh",
    "PriceHighToLow",
    "NewestFirst"
  ]);

  const CATEGORIES = Object.freeze([
    Object.freeze({ key: "home", label: "Home & Kitchen", slug: "home", hosts: ["home.woot.com"] }),
    Object.freeze({ key: "tech", label: "Electronics", slug: "electronics", hosts: ["electronics.woot.com"] }),
    Object.freeze({ key: "pc", label: "Computers", slug: "computers", hosts: ["computers.woot.com"] }),
    Object.freeze({ key: "tools", label: "Tools & Garden", slug: "tools", hosts: ["tools.woot.com"] }),
    Object.freeze({ key: "sport", label: "Sports & Outdoors", slug: "sport", hosts: ["sport.woot.com"] }),
    Object.freeze({ key: "shirt", label: "Shirt", slug: "shirt", hosts: ["shirt.woot.com"] }),
    Object.freeze({ key: "grocery", label: "Grocery & Household", slug: "grocery", hosts: ["grocery.woot.com"] }),
    Object.freeze({ key: "wine", label: "Gourmet", slug: "wine", hosts: ["wine.woot.com", "gourmet.woot.com"] }),
    Object.freeze({ key: "sellout", label: "Clearance", slug: "clearance", hosts: ["sellout.woot.com"] })
  ]);

  const CATEGORY_BY_KEY = new Map();
  const CATEGORY_BY_SLUG = new Map();
  const CATEGORY_BY_HOST = new Map();

  for (const cat of CATEGORIES) {
    CATEGORY_BY_KEY.set(cat.key, cat);
    CATEGORY_BY_SLUG.set(cat.slug, cat);
    for (const host of cat.hosts) CATEGORY_BY_HOST.set(host, cat);
  }

  function toPrice(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "boolean" || typeof value === "object") return null;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  }

  function parsePriceBound(value) {
    if (value === null || value === undefined) return null;
    const str = typeof value === "string" ? value.replace(/[$,\s]/g, "") : value;
    if (str === "") return null;
    const n = toPrice(str);
    if (n === null) return null;
    return Math.min(MAX_PRICE_BOUND, n);
  }

  function buildPriceFilter(minRaw, maxRaw) {
    let min = parsePriceBound(minRaw);
    let max = parsePriceBound(maxRaw);
    if (min === null && max === null) return null;
    if (min !== null && max !== null && min > max) {
      const tmp = min;
      min = max;
      max = tmp;
    }
    return [{ between: [min !== null ? min : 0, max !== null ? max : MAX_PRICE_BOUND] }];
  }

  function formatPrice(value) {
    const n = toPrice(value);
    if (n === null) return "";
    try {
      return (
        "$" +
        n.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      );
    } catch (err) {
      return "$" + n.toFixed(2);
    }
  }

  function formatCompactCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return "";
    const rounded = Math.round(n);
    if (rounded >= 1000000) {
      return (rounded / 1000000).toFixed(1).replace(/\.0$/, "") + "m";
    }
    if (rounded >= 1000) {
      return (rounded / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    }
    return String(rounded);
  }

  function computeDiscount(salePrice, listPrice) {
    if (!Number.isFinite(salePrice) || !Number.isFinite(listPrice)) return null;
    if (listPrice <= 0 || salePrice < 0 || listPrice <= salePrice) return null;
    const pct = Math.round((1 - salePrice / listPrice) * 100);
    if (!Number.isFinite(pct) || pct < 1 || pct > 99) return null;
    return pct;
  }

  function isHttpsUrl(value) {
    if (typeof value !== "string") return false;
    try {
      return new URL(value).protocol === "https:";
    } catch (err) {
      return false;
    }
  }

  function validateAsin(value) {
    if (typeof value !== "string") return null;
    const clean = value.trim().toUpperCase();
    return ASIN_RE.test(clean) ? clean : null;
  }

  function buildAmazonUrl(asin) {
    const clean = validateAsin(asin);
    return clean ? "https://www.amazon.com/dp/" + clean : null;
  }

  function buildCamelUrl(asin) {
    const clean = validateAsin(asin);
    return clean ? "https://camelcamelcamel.com/product/" + clean : null;
  }

  function isValidCategory(key) {
    return typeof key === "string" && CATEGORY_BY_KEY.has(key);
  }

  function categoryLabelFromHost(hostname) {
    if (typeof hostname !== "string") return null;
    const cat = CATEGORY_BY_HOST.get(hostname.trim().toLowerCase());
    return cat ? cat.label : null;
  }

  function detectPageCategory(urlString) {
    if (typeof urlString !== "string" || !urlString) return null;
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (err) {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (CATEGORY_BY_HOST.has(host)) {
      const cat = CATEGORY_BY_HOST.get(host);
      return { key: cat.key, label: cat.label };
    }
    if (!/(^|\.)woot\.com$/i.test(host)) return null;
    const match = parsed.pathname.match(/^\/category\/([a-z0-9-]+)/i);
    if (match) {
      const slug = match[1].toLowerCase();
      const cat = CATEGORY_BY_SLUG.get(slug) || CATEGORY_BY_KEY.get(slug);
      if (cat) return { key: cat.key, label: cat.label };
    }
    return null;
  }

  function extractGqlConfig(text) {
    if (typeof text !== "string" || !text) return null;
    const blockMatch = text.match(/__WOOT_GQL__\s*=\s*\{([^}]+)\}/);
    if (!blockMatch) return null;
    const body = blockMatch[1];
    const urlMatch = body.match(/["']?url["']?\s*:\s*["']([^"']+)["']/);
    const keyMatch = body.match(/["']?apiKey["']?\s*:\s*["']([^"']+)["']/);
    if (!urlMatch || !keyMatch) return null;
    return { url: urlMatch[1], apiKey: keyMatch[1] };
  }

  function isEndingSoon(endDate, nowMs) {
    if (typeof endDate !== "string" || !endDate) return false;
    const end = Date.parse(endDate);
    if (!Number.isFinite(end)) return false;
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const diff = end - now;
    return diff > 0 && diff <= ENDING_SOON_MS;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlightSegments(text, query) {
    const source = typeof text === "string" ? text : "";
    if (!source) return [];
    const rawQuery = typeof query === "string" ? query.trim() : "";
    if (!rawQuery) return [{ text: source, match: false }];

    const tokens = Array.from(
      new Set(
        rawQuery
          .split(/\s+/)
          .map((t) => t.trim())
          .filter((t) => t.length >= 2)
      )
    ).sort((a, b) => b.length - a.length);

    if (!tokens.length) return [{ text: source, match: false }];

    const re = new RegExp("(" + tokens.map(escapeRegex).join("|") + ")", "gi");
    const segments = [];
    let lastIndex = 0;
    let match;

    while ((match = re.exec(source)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ text: source.slice(lastIndex, match.index), match: false });
      }
      if (match[0]) {
        segments.push({ text: match[0], match: true });
      }
      lastIndex = re.lastIndex;
      if (match[0].length === 0) re.lastIndex += 1;
    }

    if (lastIndex < source.length) {
      segments.push({ text: source.slice(lastIndex), match: false });
    }
    return segments.length ? segments : [{ text: source, match: false }];
  }

  /*
   * Woot offers a ladder of the same image. The first entries are wide
   * banners (1080x410); huge originals also appear. Pick the best roughly
   * square thumbnail in the 250-1000px range, else the largest usable one.
   */
  function pickPhoto(photos) {
    if (!Array.isArray(photos)) return null;
    const usable = [];
    let any = null;

    for (const photo of photos) {
      if (!photo || typeof photo !== "object") continue;
      const url = photo.Url;
      if (!isHttpsUrl(url)) continue;
      if (!any) any = url;
      const w = Number(photo.Width) || 0;
      const h = Number(photo.Height) || 0;
      if (w > 0 && h > 0) usable.push({ url, w, h, area: w * h, ratio: w / h });
    }

    if (!usable.length) return any;

    const squareish = usable.filter(
      (p) => p.w >= 250 && p.w <= 1000 && p.ratio >= 0.7 && p.ratio <= 1.7
    );
    const pool = squareish.length ? squareish : usable;
    pool.sort((a, b) => b.area - a.area);
    return pool[0].url;
  }

  function buildOfferUrl(hostname, slug, id) {
    const host = typeof hostname === "string" ? hostname.trim().toLowerCase() : "";
    const cleanSlug = typeof slug === "string" ? slug.trim() : "";

    if (WOOT_HOST_RE.test(host) && SLUG_RE.test(cleanSlug)) {
      return "https://" + host + "/offers/" + cleanSlug;
    }
    if (SLUG_RE.test(cleanSlug)) {
      return "https://www.woot.com/offers/" + cleanSlug;
    }
    const fallbackId = typeof id === "string" ? id.replace(/[^a-z0-9-]/gi, "") : "";
    if (fallbackId) return "https://www.woot.com/offers/" + fallbackId;
    return "https://www.woot.com/";
  }

  function readItemCondition(item) {
    if (!item || !Array.isArray(item.Attributes)) return null;
    for (const attr of item.Attributes) {
      if (!attr || typeof attr !== "object") continue;
      if (typeof attr.Key === "string" && attr.Key.trim().toLowerCase() === "condition") {
        const val = typeof attr.Value === "string" ? attr.Value.trim() : "";
        if (val) return val;
      }
    }
    return null;
  }

  function extractCondition(raw, preferredItems, allItems) {
    for (const item of preferredItems) {
      const cond = readItemCondition(item);
      if (cond) return cond;
    }
    for (const item of allItems) {
      const cond = readItemCondition(item);
      if (cond) return cond;
    }
    if (raw.IsAmazonCertifiedRefurbished === true) return "Amazon Refurbished";
    if (raw.IsFactoryReconditioned === true) return "Factory Reconditioned";
    if (raw.IsRefurbished === true) return "Refurbished";
    return null;
  }

  function extractReviewSummary(primaryItem, allItems) {
    const read = (item) => {
      const rev = item && item.AmazonReviewSummary;
      if (!rev || typeof rev !== "object") return null;
      const rating = Number(rev.AverageOverallRating);
      const count = Number(rev.TotalReviewCount);
      if (!Number.isFinite(rating) || rating <= 0 || rating > 5) return null;
      if (!Number.isFinite(count) || count <= 0) return null;
      return {
        rating: Math.round(rating * 10) / 10,
        reviewCount: Math.round(count)
      };
    };

    const primary = read(primaryItem);
    if (primary) return primary;

    let best = null;
    for (const item of allItems) {
      const summary = read(item);
      if (summary && (!best || summary.reviewCount > best.reviewCount)) {
        best = summary;
      }
    }
    return best || { rating: null, reviewCount: null };
  }

  function extractAsin(primaryItem, allItems) {
    const primary = primaryItem ? validateAsin(primaryItem.Asin) : null;
    if (primary) return primary;
    for (const item of allItems) {
      const asin = validateAsin(item.Asin);
      if (asin) return asin;
    }
    return null;
  }

  function normalizeOffer(raw) {
    if (!raw || typeof raw !== "object") return null;

    const id = typeof raw.Id === "string" ? raw.Id : "";
    const title = typeof raw.Title === "string" ? raw.Title.trim() : "";
    if (!id || !title) return null;

    const items = Array.isArray(raw.Items)
      ? raw.Items.filter((item) => item && typeof item === "object")
      : [];

    const inStockItems = items.filter((item) => item.SoldOut !== true);
    const activePool = inStockItems.length ? inStockItems : items;

    const priced = [];
    for (const item of activePool) {
      const sp = toPrice(item.SalePrice);
      if (sp === null) continue;
      const lpRaw = toPrice(item.ListPrice);
      const lp = lpRaw !== null && lpRaw > sp ? lpRaw : null;
      priced.push({ item, salePrice: sp, listPrice: lp });
    }

    priced.sort((a, b) => {
      if (a.salePrice !== b.salePrice) return a.salePrice - b.salePrice;
      const aHasList = a.listPrice !== null ? 1 : 0;
      const bHasList = b.listPrice !== null ? 1 : 0;
      if (aHasList !== bHasList) return bHasList - aHasList;
      return (b.listPrice || 0) - (a.listPrice || 0);
    });

    const primary = priced.length ? priced[0] : null;
    const salePrice = primary ? primary.salePrice : null;
    const listPrice = primary ? primary.listPrice : null;
    const distinctSales = new Set(priced.map((entry) => entry.salePrice.toFixed(2)));

    const allItemsSoldOut = items.length > 0 && items.every((item) => item.SoldOut === true);
    const soldOut = raw.SoldOut === true || allItemsSoldOut;

    const site = raw.Site && typeof raw.Site === "object" ? raw.Site : {};
    const slug = typeof raw.Slug === "string" ? raw.Slug : "";
    const subtitle =
      typeof raw.Subtitle === "string" && raw.Subtitle.trim() ? raw.Subtitle.trim() : null;
    const hostname = typeof site.Hostname === "string" ? site.Hostname : null;
    const categoryLabel =
      categoryLabelFromHost(hostname) ||
      (typeof site.MarketingName === "string" && site.MarketingName.trim()
        ? site.MarketingName.trim()
        : null);

    const primaryItem = primary ? primary.item : activePool[0] || null;
    const asin = extractAsin(primaryItem, items);
    const reviews = extractReviewSummary(primaryItem, items);
    const condition = extractCondition(raw, primaryItem ? [primaryItem, ...activePool] : activePool, items);

    return {
      id,
      title,
      subtitle,
      url: buildOfferUrl(site.Hostname, slug, id),
      image: pickPhoto(raw.Photos),
      salePrice,
      listPrice,
      discountPct: computeDiscount(salePrice, listPrice),
      fromPrice: distinctSales.size > 1,
      soldOut,
      isWootOff: raw.IsWootOff === true,
      endDate: typeof raw.EndDate === "string" ? raw.EndDate : null,
      hostname,
      categoryLabel,
      condition,
      rating: reviews.rating,
      reviewCount: reviews.reviewCount,
      asin,
      amazonUrl: buildAmazonUrl(asin),
      cccUrl: buildCamelUrl(asin)
    };
  }

  function normalizeSearchResponse(raw) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Malformed search response");
    }
    const offers = (Array.isArray(raw.Offers) ? raw.Offers : [])
      .map(normalizeOffer)
      .filter(Boolean);
    const totalHits =
      Number.isFinite(raw.TotalHits) && raw.TotalHits >= 0 ? raw.TotalHits : offers.length;
    return { totalHits, offers };
  }

  return {
    SORTS,
    CATEGORIES,
    toPrice,
    parsePriceBound,
    buildPriceFilter,
    formatPrice,
    formatCompactCount,
    computeDiscount,
    validateAsin,
    buildAmazonUrl,
    buildCamelUrl,
    isValidCategory,
    categoryLabelFromHost,
    detectPageCategory,
    extractGqlConfig,
    isEndingSoon,
    highlightSegments,
    pickPhoto,
    buildOfferUrl,
    normalizeOffer,
    normalizeSearchResponse
  };
});
