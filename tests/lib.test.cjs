"use strict";

const assert = require("node:assert/strict");
const L = require("../woot-search-extension/lib.js");

let checks = 0;
function ok(label, fn) {
  fn();
  checks += 1;
  console.log("  ok  " + label);
}

ok("formatPrice formats dollars with grouping", () => {
  assert.equal(L.formatPrice(329), "$329.00");
  assert.equal(L.formatPrice(1299.5), "$1,299.50");
  assert.equal(L.formatPrice(0), "$0.00");
  assert.equal(L.formatPrice(null), "");
  assert.equal(L.formatPrice(undefined), "");
  assert.equal(L.formatPrice("nope"), "");
});

ok("formatCompactCount abbreviates large counts", () => {
  assert.equal(L.formatCompactCount(42), "42");
  assert.equal(L.formatCompactCount(1000), "1k");
  assert.equal(L.formatCompactCount(1323), "1.3k");
  assert.equal(L.formatCompactCount(24068), "24.1k");
  assert.equal(L.formatCompactCount(1250000), "1.3m");
  assert.equal(L.formatCompactCount(-5), "");
});

ok("parsePriceBound and buildPriceFilter handle bounds cleanly", () => {
  assert.equal(L.parsePriceBound("$25.50"), 25.5);
  assert.equal(L.parsePriceBound("1,200"), 1200);
  assert.equal(L.parsePriceBound(""), null);
  assert.equal(L.parsePriceBound("-5"), null);
  assert.equal(L.parsePriceBound("abc"), null);

  assert.deepEqual(L.buildPriceFilter("", ""), null);
  assert.deepEqual(L.buildPriceFilter("10", "30"), [{ between: [10, 30] }]);
  assert.deepEqual(L.buildPriceFilter("50", "15"), [{ between: [15, 50] }]);
  assert.deepEqual(L.buildPriceFilter("", "25"), [{ between: [0, 25] }]);
  assert.deepEqual(L.buildPriceFilter("100", ""), [{ between: [100, 999999] }]);
});

ok("computeDiscount ignores bad or non-discounted prices", () => {
  assert.equal(L.computeDiscount(329, 549), 40);
  assert.equal(L.computeDiscount(14.99, 79.99), 81);
  assert.equal(L.computeDiscount(10, 10), null);
  assert.equal(L.computeDiscount(20, 10), null);
  assert.equal(L.computeDiscount(10, 0), null);
  assert.equal(L.computeDiscount(null, 10), null);
});

ok("validateAsin and external URL builders reject invalid ASINs", () => {
  assert.equal(L.validateAsin("b07pylktd8"), "B07PYLKTD8");
  assert.equal(L.validateAsin("short"), null);
  assert.equal(L.validateAsin("B07PYLKTD!"), null);
  assert.equal(L.buildAmazonUrl("B07PYLKTD8"), "https://www.amazon.com/dp/B07PYLKTD8");
  assert.equal(L.buildCamelUrl("B07PYLKTD8"), "https://camelcamelcamel.com/product/B07PYLKTD8");
  assert.equal(L.buildAmazonUrl("bad"), null);
  assert.equal(L.buildCamelUrl("bad"), null);
});

ok("category detection maps Woot hosts and category URLs", () => {
  assert.equal(L.isValidCategory("tech"), true);
  assert.equal(L.isValidCategory("nope"), false);
  assert.equal(L.categoryLabelFromHost("sellout.woot.com"), "Clearance");
  assert.equal(L.categoryLabelFromHost("electronics.woot.com"), "Electronics");
  assert.equal(L.categoryLabelFromHost("www.woot.com"), null);

  assert.deepEqual(L.detectPageCategory("https://www.woot.com/category/electronics"), {
    key: "tech",
    label: "Electronics"
  });
  assert.deepEqual(L.detectPageCategory("https://computers.woot.com/offers/laptop"), {
    key: "pc",
    label: "Computers"
  });
  assert.equal(L.detectPageCategory("https://www.woot.com/"), null);
  assert.equal(L.detectPageCategory("https://example.com/category/electronics"), null);
});

ok("extractGqlConfig parses __WOOT_GQL__ regardless of key order or quotes", () => {
  assert.deepEqual(
    L.extractGqlConfig(`window.__WOOT_GQL__ = { url: "https://a.cloudfront.net/graphql", apiKey: "da2-abc1234567" };`),
    { url: "https://a.cloudfront.net/graphql", apiKey: "da2-abc1234567" }
  );
  assert.deepEqual(
    L.extractGqlConfig(`__WOOT_GQL__={'apiKey':'da2-xyz9876543','url':'https://b.cloudfront.net/graphql'}`),
    { url: "https://b.cloudfront.net/graphql", apiKey: "da2-xyz9876543" }
  );
  assert.equal(L.extractGqlConfig("no config here"), null);
});

ok("isEndingSoon detects offers ending within 24 hours", () => {
  const now = Date.parse("2026-11-27T12:00:00Z");
  assert.equal(L.isEndingSoon("2026-11-28T06:00:00Z", now), true);
  assert.equal(L.isEndingSoon("2026-11-30T06:00:00Z", now), false);
  assert.equal(L.isEndingSoon("2026-11-27T11:00:00Z", now), false);
  assert.equal(L.isEndingSoon(null, now), false);
});

ok("highlightSegments safely splits query term matches", () => {
  assert.deepEqual(L.highlightSegments("Anker USB-C 60W Cable", "usb cable"), [
    { text: "Anker ", match: false },
    { text: "USB", match: true },
    { text: "-C 60W ", match: false },
    { text: "Cable", match: true }
  ]);
  assert.deepEqual(L.highlightSegments("C++ (2-Pack)", "c++"), [
    { text: "C++", match: true },
    { text: " (2-Pack)", match: false }
  ]);
  assert.deepEqual(L.highlightSegments("Plain title", "a"), [
    { text: "Plain title", match: false }
  ]);
});

ok("pickPhoto prefers a square-ish thumbnail over the banner", () => {
  const photos = [
    { Url: "https://img.example/banner.jpg", Width: 1080, Height: 410 },
    { Url: "https://img.example/good.jpg", Width: 768, Height: 576 },
    { Url: "https://img.example/small.jpg", Width: 188, Height: 142 },
    { Url: "https://img.example/huge.jpg", Width: 1356, Height: 1500 }
  ];
  assert.equal(L.pickPhoto(photos), "https://img.example/good.jpg");
});

ok("pickPhoto falls back sensibly", () => {
  assert.equal(L.pickPhoto([]), null);
  assert.equal(L.pickPhoto(null), null);
  assert.equal(
    L.pickPhoto([{ Url: "http://insecure.example/x.jpg", Width: 600, Height: 600 }]),
    null
  );
  assert.equal(
    L.pickPhoto([{ Url: "https://img.example/banner.jpg", Width: 1080, Height: 410 }]),
    "https://img.example/banner.jpg"
  );
});

ok("buildOfferUrl only trusts Woot hostnames and safe slugs", () => {
  assert.equal(
    L.buildOfferUrl("sellout.woot.com", "apple-airpods-max-1", "id-1"),
    "https://sellout.woot.com/offers/apple-airpods-max-1"
  );
  assert.equal(
    L.buildOfferUrl("EVIL.example", "apple-airpods-max-1", "id-1"),
    "https://www.woot.com/offers/apple-airpods-max-1"
  );
  assert.equal(
    L.buildOfferUrl("sellout.woot.com", "javascript:alert(1)", "id-1"),
    "https://www.woot.com/offers/id-1"
  );
  assert.equal(
    L.buildOfferUrl("sellout.woot.com", "", "3154ff8d-78a7"),
    "https://www.woot.com/offers/3154ff8d-78a7"
  );
  assert.equal(L.buildOfferUrl("", "", ""), "https://www.woot.com/");
});

ok("normalizeOffer builds a complete card model with rating, condition, and ASIN links", () => {
  const offer = L.normalizeOffer({
    Id: "3154ff8d",
    Title: "Apple AirPods Max",
    Subtitle: "Wireless headphones",
    Slug: "apple-airpods-max-1",
    SoldOut: false,
    EndDate: "2026-12-01T05:59:00Z",
    IsWootOff: false,
    Site: { Hostname: "sellout.woot.com" },
    Photos: [
      { Url: "https://img.example/banner.jpg", Width: 1080, Height: 410 },
      { Url: "https://img.example/square.jpg", Width: 768, Height: 576 }
    ],
    Items: [
      {
        Asin: "B0GSS6F226",
        SalePrice: 329,
        ListPrice: 549,
        SoldOut: false,
        Attributes: [{ Key: "Condition", Value: "Refurbished" }],
        AmazonReviewSummary: { AverageOverallRating: 4.54, TotalReviewCount: 1323 }
      }
    ]
  });
  assert.equal(offer.url, "https://sellout.woot.com/offers/apple-airpods-max-1");
  assert.equal(offer.image, "https://img.example/square.jpg");
  assert.equal(offer.salePrice, 329);
  assert.equal(offer.listPrice, 549);
  assert.equal(offer.discountPct, 40);
  assert.equal(offer.fromPrice, false);
  assert.equal(offer.soldOut, false);
  assert.equal(offer.subtitle, "Wireless headphones");
  assert.equal(offer.categoryLabel, "Clearance");
  assert.equal(offer.condition, "Refurbished");
  assert.equal(offer.rating, 4.5);
  assert.equal(offer.reviewCount, 1323);
  assert.equal(offer.asin, "B0GSS6F226");
  assert.equal(offer.amazonUrl, "https://www.amazon.com/dp/B0GSS6F226");
  assert.equal(offer.cccUrl, "https://camelcamelcamel.com/product/B0GSS6F226");
});

ok("normalizeOffer pairs each variant with its own listPrice and prefers in-stock items", () => {
  const range = L.normalizeOffer({
    Id: "a",
    Title: "Cable",
    Slug: "cable",
    Site: { Hostname: "electronics.woot.com" },
    Photos: [],
    Items: [
      { SalePrice: 4.99, ListPrice: 19.99, SoldOut: true },
      { SalePrice: 7.99, ListPrice: 34.95, SoldOut: false },
      { SalePrice: 11.99, ListPrice: 69.9, SoldOut: false }
    ]
  });
  assert.equal(range.salePrice, 7.99);
  assert.equal(range.listPrice, 34.95);
  assert.equal(range.discountPct, 77);
  assert.equal(range.fromPrice, true);
  assert.equal(range.categoryLabel, "Electronics");

  const noPrice = L.normalizeOffer({
    Id: "b",
    Title: "Mystery box",
    Slug: "mystery-box",
    Site: { Hostname: "www.woot.com" },
    IsFactoryReconditioned: true,
    Items: []
  });
  assert.equal(noPrice.salePrice, null);
  assert.equal(noPrice.listPrice, null);
  assert.equal(noPrice.discountPct, null);
  assert.equal(noPrice.condition, "Factory Reconditioned");
});

ok("normalizeOffer detects sold-out item sets", () => {
  const offer = L.normalizeOffer({
    Id: "c",
    Title: "Gone",
    Slug: "gone",
    SoldOut: null,
    Items: [{ SalePrice: 5, ListPrice: 10, SoldOut: true }]
  });
  assert.equal(offer.soldOut, true);
  assert.equal(offer.salePrice, 5);
  assert.equal(offer.listPrice, 10);
});

ok("normalizeOffer rejects malformed rows", () => {
  assert.equal(L.normalizeOffer(null), null);
  assert.equal(L.normalizeOffer({ Title: "No id" }), null);
  assert.equal(L.normalizeOffer({ Id: "x", Title: "   " }), null);
});

ok("normalizeSearchResponse clamps totals and filters rows", () => {
  const result = L.normalizeSearchResponse({
    TotalHits: 126,
    Offers: [
      { Id: "a", Title: "One", Slug: "one", Items: [] },
      { Id: "", Title: "Broken" },
      null
    ]
  });
  assert.equal(result.totalHits, 126);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].url, "https://www.woot.com/offers/one");

  const fallback = L.normalizeSearchResponse({ Offers: [{ Id: "a", Title: "One" }] });
  assert.equal(fallback.totalHits, 1);
});

console.log("\nlib tests passed (" + checks + " groups)");
