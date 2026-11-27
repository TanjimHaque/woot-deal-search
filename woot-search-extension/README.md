# Woot Deal Search

An unofficial Chrome extension that adds the search box Woot forgot. It puts a
search bar under Woot's header on every Woot page — and adds a browser toolbar
popup so you can search **all live deals across the site** from any tab.

- Search ~15,000 live offers as you type from Woot pages or the toolbar popup.
- Filter by category (with a one-click **"Only &lt;Category&gt;"** shortcut on Woot
  category pages) and Min/Max price.
- Sort by best match, best selling, biggest discount, price, or newest.
- See thumbnail, accurate in-stock pricing, discount, Amazon star rating &
  review count, condition, category/status pills, and quick **Amazon ↗** /
  **CCC ↗** ASIN links.
- Hide sold-out deals (on by default), or turn them back on.
- Full keyboard support: `Cmd/Ctrl+K` to focus, `↑`/`↓` to move, `Enter` to open,
  `Cmd/Ctrl+Enter` to open in a new tab, `Esc` to close.

> Unofficial and not affiliated with Woot or Amazon. It only calls the same
> public deal feed Woot's own website uses, plus light caching and debouncing.

## Install (Chrome)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this `woot-search-extension` folder.
5. Open <https://www.woot.com/> and look under the header, or click the toolbar
   icon from any tab.

No build step and no dependencies. After editing any file, click the reload
button on the extension card in `chrome://extensions`.

## Privacy

- No analytics, accounts, search history storage, or remote code.
- No browsing data leaves your browser except the search query and filters sent
  to Woot's own API (the same endpoint the site itself uses).
- Sort and sold-out preferences live in `chrome.storage.local`.

## Layout

```
manifest.json   MV3 manifest (v2.0.0)
background.js   service worker: API call, config discovery, cache
lib.js          pure normalization & filter helpers (also used by tests)
search-ui.js    shared search bar, filters, and card UI controller
content.js      injects the in-page bar on Woot pages
content.css     scoped styles
popup.html      browser toolbar popup
popup.js        toolbar popup bootstrap
popup.css       toolbar popup layout overrides
icons/          generated PNGs
```
