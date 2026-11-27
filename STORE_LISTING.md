# Chrome Web Store submission pack

Everything needed to publish **Woot Deal Search 2.0.0**. Copy the fields below
into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

Official references:
[register](https://developer.chrome.com/docs/webstore/register) ·
[prepare](https://developer.chrome.com/docs/webstore/prepare) ·
[publish](https://developer.chrome.com/docs/webstore/publish) ·
[images](https://developer.chrome.com/docs/webstore/images) ·
[privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) ·
[review process](https://developer.chrome.com/docs/webstore/review-process)

## 1. One-time account setup

1. Sign in to the [developer dashboard](https://chrome.google.com/webstore/devconsole)
   with the Google account that should own the extension.
2. Accept the developer agreement and pay the **one-time $5 registration fee**.
3. Set a **publisher name** (shown as "Offered by").
4. Add and **verify a contact email**. This email cannot be changed later, so use
   one you will keep.
5. Enable **2-Step Verification** on the Google account. CWS requires it before
   you can publish or update an item.
6. Turn on email notifications for published/staged items on the Account page.

## 2. Build the store package

The store needs a ZIP with `manifest.json` at the **root**, not inside a folder.
Do not upload the GitHub release ZIP — it wraps everything in a folder.

```bash
tools/package-store.sh
```

This produces `dist/woot-deal-search-2.0.0-chrome-store.zip` and prints its
contents. Confirm `manifest.json` appears at the top level:

```bash
unzip -l dist/woot-deal-search-2.0.0-chrome-store.zip | head
```

## 3. Store listing fields

| Field | Value |
| --- | --- |
| Item name | `Woot Deal Search` (from the manifest) |
| Summary | `Search every live Woot deal from any Woot page or the browser toolbar, with filters, Amazon ratings, and price history links.` |
| Category | **Shopping** |
| Language | **English (United States)** |
| Homepage URL | `https://github.com/TanjimHaque/woot-deal-search` |
| Support URL | `https://github.com/TanjimHaque/woot-deal-search/issues` |
| Privacy policy URL | `https://github.com/TanjimHaque/woot-deal-search/blob/main/PRIVACY.md` |
| Mature content | No |

### Detailed description (copy/paste)

```
Woot Deal Search adds the search box Woot doesn't have.

Woot is an Amazon-owned deals site with thousands of live offers, but no way to search them. This extension adds a search bar under Woot's header on every Woot page — plus a browser toolbar popup so you can search every live deal from any tab.

FEATURES
• Search all ~15,000 live Woot deals from any Woot page or the browser toolbar popup.
• Filter by category (Electronics, Computers, Home & Kitchen, Tools & Garden, Sports & Outdoors, Shirt, Grocery & Household, Gourmet, Clearance) and Min/Max price.
• Sort by best match, best selling, biggest discount, price, or newest.
• See thumbnails, accurate in-stock pricing, discounts, Amazon star ratings & review counts, condition (New, Refurbished, Factory Reconditioned), and category/Woot-Off/ending-soon badges.
• Jump straight to Amazon or CamelCamelCamel price history via quick ASIN links.
• Hide sold-out deals with one click, or show them again.
• Keyboard shortcuts: Cmd/Ctrl+K to focus, arrow keys to move, Enter to open, Cmd/Ctrl+Enter to open in a new tab, Esc to close.
• Remembers your sort and sold-out preferences.

HOW TO USE
Open woot.com and type in the search bar under the header, or click the Woot Deal Search toolbar icon from any tab. Results update as you type. Click a result to open it on Woot.

PRIVACY
No accounts, analytics, ads, search history, or tracking. Search terms and filters are sent directly from your browser to Woot's public API to retrieve results; they are not sent to the developer. Sort and sold-out preferences stay in your browser. Full policy: https://github.com/TanjimHaque/woot-deal-search/blob/main/PRIVACY.md

UNOFFICIAL
This is an unofficial extension. It is not affiliated with, endorsed by, or produced by Woot or Amazon. Woot and Amazon are trademarks of their respective owners.

Open source: https://github.com/TanjimHaque/woot-deal-search
```

### Graphic assets

| Asset | File | Notes |
| --- | --- | --- |
| Store icon | `store-assets/icon-128.png` | 128×128 PNG, 96×96 artwork with 16px transparent padding |
| Screenshot 1 | `store-assets/screenshot-1280x800.png` | Required; 1280×800, full bleed |
| Small promo tile (optional) | `store-assets/promo-440x280.png` | 440×280 PNG |

The screenshot shows the actual search bar and results. Keep the icon and
screenshot in sync if the UI changes.

## 4. Privacy tab

### Single purpose

```
Woot Deal Search adds a search bar to Woot pages and a browser toolbar popup so the user can search and filter Woot's live deals, then open the selected deal.
```

### Permission justifications

- **`storage`**: Stores the user's sort order and "hide sold out" preference
  locally so the UI remembers them. No personal data or search history is stored.
- **`https://*.woot.com/*`**: Injects the search bar into Woot pages and reads
  the public `window.__WOOT_GQL__` API configuration embedded in those pages.
- **`https://d24qg5zsx8xdc4.cloudfront.net/*`**: Calls Woot's own public GraphQL
  endpoint to search live deals. This is the same endpoint the Woot website uses.

### Remote code

**No, I am not using remote code.** The extension runs only the JavaScript
packaged in the ZIP. The API returns JSON data, not executable code.

### Data usage

Declare **User activity** for the search text the user types. Explain:

```
The search query and selected filters are transmitted over HTTPS from the user's browser directly to Woot's public API to return matching deals. The developer never receives, stores, or logs them, and the extension does not store search history. Sort and "hide sold out" preferences are stored locally in chrome.storage.local and never transmitted. No other user data is collected.
```

Do not select categories the extension does not handle: personally identifiable
information, health, financial/payment, authentication, personal communications,
location, web history, or website content. The content script runs only on Woot
pages to inject the UI and read the public API config; it does not collect or
transmit page content.

Certify the Limited Use statements (no sale, no unrelated use, no
creditworthiness use, no human review). Make sure the dashboard, this listing,
and `PRIVACY.md` all say the same thing.

### Privacy policy URL

```
https://github.com/TanjimHaque/woot-deal-search/blob/main/PRIVACY.md
```

This URL only works after `PRIVACY.md` is pushed to the public repository. If
you later move to GitHub Pages, update this field to the new page.

## 5. Distribution

| Field | Recommendation |
| --- | --- |
| Visibility | **Public** (or **Unlisted** for a soft launch; you still need the item URL to share it) |
| Regions | **All regions**; Woot ships in the US but the search UI works wherever woot.com is reachable |
| Pricing | **Free** |
| Mature content | No |

All visibility settings go through the same review. Private is only for trusted
testers configured on the account.

## 6. Test instructions (optional tab)

```
No login or credentials are required.

1. Install the extension.
2. Open https://www.woot.com/ (close any Woot newsletter/promo overlay if it appears).
3. Click the search field under the green Woot header, type "usb", and wait a moment.
4. Confirm results appear with images, prices, discounts, Amazon ratings, condition/category badges, and Amazon/CCC links.
5. Try filtering by Category (e.g., Electronics) or Max price (e.g., 25) and sorting by Best selling or Price.
6. Click a result; it should open the matching Woot offer page.
7. Click the extension toolbar icon from any tab and type "airpods" to confirm the toolbar popup searches live deals and opens results in a new tab.
8. The in-page search bar also appears on https://www.woot.com/category/electronics (with a quick "Only Electronics" filter button) and on offer pages.
```

## 7. Submit and review

1. Click **Submit for review**.
2. Choose immediate publishing, or uncheck the box to review the approved item
   yourself later (deferred publishing; you then have 30 days to publish).
3. Most reviews finish in a few days, but they can take a few weeks. New
   developers, new items, broad permissions, and large codebases get more
   scrutiny. If it is pending for more than three weeks, contact developer
   support.
4. If rejected, read the cited policy, fix it, bump the manifest version, upload
   a new ZIP, and resubmit. You can appeal from the item page.

## 8. After approval

- Add the Chrome Web Store URL to the README and GitHub release notes.
- Keep the GitHub release and the store build in sync.
- For updates: bump `version` in `woot-search-extension/manifest.json`, run
  `tools/package-store.sh`, upload the new ZIP, and submit.
- New publisher accounts default to a limit of two published extensions. You can
  request an increase in the dashboard.

## 9. Risks to know

- **Trademark / impersonation.** The name uses "Woot" descriptively. The listing
  clearly says it is unofficial and not affiliated with Woot or Amazon. If a
  reviewer flags the name, rename the extension to something like
  "Unofficial Woot Deal Search", bump the version, and re-upload.
- **API dependency.** Woot can change or restrict its public GraphQL endpoint.
  The extension auto-rediscovers the endpoint config and degrades to an error
  message with retry. It is not affiliated with Woot, so there is no support
  contract.
- **Privacy consistency.** The extension does transmit search text to Woot. Do
  not claim "no data leaves the browser" in the dashboard; the privacy policy
  above is written to match the actual behavior.
- **Versioning.** The store will not accept a version that is equal to or lower
  than the last published one. Always bump the manifest version.
- **Package shape.** Upload the store ZIP from `tools/package-store.sh`, not the
  GitHub release ZIP; the store requires `manifest.json` at the archive root.
