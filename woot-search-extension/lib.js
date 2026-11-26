/*
 * Pure helpers shared by the Woot Deal Search service worker and its tests.
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

  function toPrice(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "boolean" || typeof value === "object") return null;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
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

  function normalizeOffer(raw) {
    if (!raw || typeof raw !== "object") return null;

    const id = typeof raw.Id === "string" ? raw.Id : "";
    const title = typeof raw.Title === "string" ? raw.Title.trim() : "";
    if (!id || !title) return null;

    const items = Array.isArray(raw.Items)
      ? raw.Items.filter((item) => item && typeof item === "object")
      : [];

    const salePrices = items.map((item) => toPrice(item.SalePrice)).filter((n) => n !== null);
    const listPrices = items.map((item) => toPrice(item.ListPrice)).filter((n) => n !== null);

    const salePrice = salePrices.length ? Math.min.apply(null, salePrices) : null;
    let listPrice = listPrices.length ? Math.max.apply(null, listPrices) : null;
    if (salePrice === null || listPrice === null || listPrice <= salePrice) listPrice = null;

    const distinctSales = new Set(salePrices.map((n) => n.toFixed(2)));
    const allItemsSoldOut = items.length > 0 && items.every((item) => item.SoldOut === true);
    const soldOut = raw.SoldOut === true || allItemsSoldOut;

    const site = raw.Site && typeof raw.Site === "object" ? raw.Site : {};
    const slug = typeof raw.Slug === "string" ? raw.Slug : "";
    const subtitle =
      typeof raw.Subtitle === "string" && raw.Subtitle.trim() ? raw.Subtitle.trim() : null;

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
      hostname: typeof site.Hostname === "string" ? site.Hostname : null
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
    formatPrice,
    computeDiscount,
    pickPhoto,
    buildOfferUrl,
    normalizeOffer,
    normalizeSearchResponse
  };
});
