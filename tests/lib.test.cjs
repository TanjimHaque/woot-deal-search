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

ok("computeDiscount ignores bad or non-discounted prices", () => {
  assert.equal(L.computeDiscount(329, 549), 40);
  assert.equal(L.computeDiscount(14.99, 79.99), 81);
  assert.equal(L.computeDiscount(10, 10), null);
  assert.equal(L.computeDiscount(20, 10), null);
  assert.equal(L.computeDiscount(10, 0), null);
  assert.equal(L.computeDiscount(null, 10), null);
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

ok("normalizeOffer builds a complete card model", () => {
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
    Items: [{ SalePrice: 329, ListPrice: 549, SoldOut: false }]
  });
  assert.equal(offer.url, "https://sellout.woot.com/offers/apple-airpods-max-1");
  assert.equal(offer.image, "https://img.example/square.jpg");
  assert.equal(offer.salePrice, 329);
  assert.equal(offer.listPrice, 549);
  assert.equal(offer.discountPct, 40);
  assert.equal(offer.fromPrice, false);
  assert.equal(offer.soldOut, false);
  assert.equal(offer.subtitle, "Wireless headphones");
});

ok("normalizeOffer handles price ranges and missing prices", () => {
  const range = L.normalizeOffer({
    Id: "a",
    Title: "Cable",
    Slug: "cable",
    Site: { Hostname: "electronics.woot.com" },
    Photos: [],
    Items: [
      { SalePrice: 7.99, ListPrice: 34.95, SoldOut: false },
      { SalePrice: 11.99, ListPrice: 69.9, SoldOut: false }
    ]
  });
  assert.equal(range.salePrice, 7.99);
  assert.equal(range.listPrice, 69.9);
  assert.equal(range.fromPrice, true);

  const noPrice = L.normalizeOffer({
    Id: "b",
    Title: "Mystery box",
    Slug: "mystery-box",
    Site: { Hostname: "www.woot.com" },
    Items: []
  });
  assert.equal(noPrice.salePrice, null);
  assert.equal(noPrice.listPrice, null);
  assert.equal(noPrice.discountPct, null);
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
