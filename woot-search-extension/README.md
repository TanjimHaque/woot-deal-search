# Woot Deal Search

An unofficial Chrome extension that adds the search box Woot forgot. It puts a
search bar under Woot's header on every Woot page and searches **all live deals
across the site**, not just the page you are on.

- Search ~15,000 live offers as you type.
- See thumbnail, sale price, original price, and discount.
- Sort by best match, biggest discount, price, or newest.
- Hide sold-out deals (on by default), or turn them back on.
- Full keyboard support: `Cmd/Ctrl+K` to focus, `↑`/`↓` to move, `Enter` to open,
  `Esc` to close.
- Clicking the extension's toolbar button jumps to search on Woot.

> Unofficial and not affiliated with Woot or Amazon. It only calls the same
> public deal feed Woot's own website uses, plus light caching and debouncing.

## Install (Chrome)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this `woot-search-extension` folder.
5. Open <https://www.woot.com/> and look under the header.

No build step and no dependencies. After editing any file, click the reload
button on the extension card in `chrome://extensions`.

## Use

- Type at least 2 characters (for example `usb`, `airpods`, `coffee maker`).
- Use the **Hide sold out** checkbox and the sort menu in the results header;
  both choices are remembered.
- Results show the current total for your query. Use **Show more** to load the
  next 24.
- Clicking a result opens its Woot offer page.

## How it works

Woot's frontend is a React app backed by a public GraphQL endpoint configured in
each page as `window.__WOOT_GQL__`. The extension reads that configuration from
the page, asks its service worker to call `searchOffers`, and renders the
normalized results in a dropdown. Responses are cached for 3 minutes and typing
is debounced, so casual use is light.

If Woot rotates its public endpoint key, the service worker re-reads the key from
<https://www.woot.com/> and retries automatically. A hardcoded fallback keeps
the first search working if page parsing fails.

## Privacy

- No analytics, accounts, or remote code.
- No browsing data leaves your browser except the search terms sent to Woot's own
  API (the same endpoint the site itself uses).
- Preferences live in `chrome.storage.local`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| No search bar appears | Reload the Woot tab. If the extension was just installed, refresh the page. Confirm the page is `https://*.woot.com` (not `account.woot.com`). |
| "Search is unavailable" | Check your connection, then click **Try again**. Reload the extension if it persists. |
| Bar looks misplaced after a Woot redesign | The bar is inserted after `#global-header`; open an issue/note with a screenshot. |
| Toolbar button opens a new tab | It focuses search when you are already on Woot, otherwise it opens woot.com. |

## Development

Requirements: Node.js 20+, Python 3 (icons only), and a Chromium browser that
supports unpacked extensions (Chrome, Brave, Chromium). Run these from the
repository root.

```bash
# Rebuild icons
python3 tools/make_icons.py

# Unit tests for price/image/URL normalization
node tests/lib.test.cjs

# End-to-end test: loads the extension in headless Brave and drives a real search
node tests/e2e.mjs

# If the browser is not in a default macOS location:
BROWSER_PATH=/usr/bin/google-chrome node tests/e2e.mjs
```

`tests/e2e.mjs` writes a screenshot to `artifacts/woot-search-e2e.png`.

## Layout

```
manifest.json   MV3 manifest
background.js   service worker: API call, config discovery, cache
lib.js          pure normalization helpers (also loaded by the content script)
content.js      injects the bar, renders results, keyboard handling
content.css     scoped styles
icons/          generated PNGs
```
