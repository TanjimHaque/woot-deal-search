# Woot Deal Search

An unofficial Chrome extension that adds the search box Woot forgot. It puts a
search bar under Woot's header on every Woot page — and adds a browser toolbar
popup so you can search **all live Woot deals from any tab**.

![Woot Deal Search in action](artifacts/woot-search-e2e.png)

> Not affiliated with Woot or Amazon. It only calls the same public deal feed
> Woot's own website uses, plus light caching and debouncing.

## Features

- Search roughly 15,000 live Woot offers as you type from any Woot page or from
  the **browser toolbar popup** on any tab.
- **Filter by category** (Electronics, Computers, Home & Kitchen, Tools & Garden,
  Sports & Outdoors, Shirt, Grocery & Household, Gourmet, Clearance) — with a
  one-click **"Only &lt;Category&gt;"** shortcut when browsing a Woot category page.
- **Filter by price range** (Min / Max dollar bounds) with one-click reset.
- **Sort** by best match, **best selling**, biggest discount, price, or newest.
- **Rich deal cards**: thumbnail, accurate in-stock variant sale & list price,
  discount percentage, **Amazon star rating & review count**, **condition badge**
  (New, Refurbished, Factory Reconditioned, etc.), category/Woot-Off/ending-soon
  pills, and highlighted search terms.
- **Quick ASIN links**: jump straight to the matching **Amazon** listing or
  **CamelCamelCamel** price history in a new tab (plain links — no extra network
  requests or permissions).
- Hide sold-out deals (on by default), or show them again.
- Full keyboard support: `Cmd/Ctrl+K` to focus, `↑`/`↓` to move, `Enter` to
  open, `Cmd/Ctrl+Enter` to open in a new tab, `Esc` to close.
- Smooth non-destructive refreshes and incremental **Show more** pagination with
  inline error recovery.
- Remembers your sort and sold-out preferences across tabs and the popup.

## Install

### From a release (easiest)

1. Download `woot-search-extension.zip` from the
   [latest release](../../releases/latest) and unzip it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped `woot-search-extension`
   folder.
5. Open <https://www.woot.com/> and look under the header, or click the toolbar
   icon from any tab.

### From source

```bash
git clone https://github.com/TanjimHaque/woot-deal-search.git
```

Then load `woot-deal-search/woot-search-extension` as an unpacked extension in
`chrome://extensions`. There is no build step and no dependencies.

After editing any extension file, click the reload button on the extension card
in `chrome://extensions`, then refresh the Woot tab.

## Usage

- Type at least 2 characters, for example `usb`, `airpods`, or `coffee maker`.
- Filter by **Category**, **Min/Max price**, or **Hide sold out**, and change
  the **Sort** order in the panel header. Your sort and sold-out choices are
  remembered.
- Results show the current total for your query. Use **Show more** to load the
  next 24.
- Clicking a result opens its Woot offer page (`Cmd/Ctrl+click` or
  `Cmd/Ctrl+Enter` opens it in a new tab; results in the toolbar popup always
  open in a new tab).
- Use the **Amazon ↗** and **CCC ↗** links on a card to check Amazon reviews or
  CamelCamelCamel price history when an offer has an ASIN.

## How it works

Woot's frontend is a React app backed by a public GraphQL endpoint configured in
each page as `window.__WOOT_GQL__`. The extension reads that configuration from
the page, asks its service worker to call `searchOffers`, and renders the
normalized results in both the in-page dropdown and the toolbar popup.

The service worker owns all network requests, so the page's CSP and CORS rules
never get in the way. Responses are cached for 3 minutes and typing is debounced
to keep requests light. If Woot rotates its public endpoint key, the worker
re-reads the key from <https://www.woot.com/> and retries automatically; a
built-in fallback keeps the first search working if page parsing fails.

The endpoint key is public and appears in every Woot page. It is not a secret
and no credentials are stored by this extension.

## Privacy

- No analytics, accounts, tracking, search history storage, or remote code.
- The only data sent to Woot is the query and filters you choose, and it goes
  directly to Woot's own API — never to the developer.
- Sort and sold-out preferences live in `chrome.storage.local` and never leave
  the machine.
- Amazon and CamelCamelCamel links are standard external links that only open
  when you click them.

Read the full [privacy policy](PRIVACY.md).

## Project layout

```
woot-search-extension/    the loadable extension (manifest at its root)
  manifest.json           MV3 manifest (v2.0.0)
  background.js           service worker: API call, config discovery, cache
  lib.js                  pure normalization & filter helpers (used by tests)
  search-ui.js            shared search bar, filters, and card UI controller
  content.js              injects the in-page bar on Woot pages
  content.css             scoped styles for the bar, filters, and cards
  popup.html              browser toolbar search popup
  popup.js                toolbar popup bootstrap
  popup.css               toolbar popup layout overrides
  icons/                  generated PNGs
tests/
  lib.test.cjs            unit tests for normalization, filters, and helpers
  e2e.mjs                 cross-platform headless-browser E2E test + screenshot
tools/
  make_icons.py           regenerates the PNG icons
  package.sh              builds the release zip
  package-store.sh        builds the Chrome Web Store zip (manifest at root)
store-assets/
  icon-128.png            store icon (96px artwork + 16px padding)
  screenshot-1280x800.png store screenshot
  promo-440x280.png       optional small promo tile
artifacts/
  woot-search-e2e.png     screenshot used above
PRIVACY.md                privacy policy for the store listing
STORE_LISTING.md          copy, permissions, and checklist for the Chrome Web Store
```

## Development

Requirements: Node.js 20+, Python 3 (only for regenerating icons), and a
Chromium browser (Chrome, Brave, Chromium, or Edge) for the end-to-end test.

```bash
# Unit tests
node tests/lib.test.cjs

# End-to-end: loads the extension in headless Chrome/Brave/Edge and runs live checks
node tests/e2e.mjs

# Override browser binary if needed:
BROWSER_PATH=/usr/bin/google-chrome node tests/e2e.mjs

# Rebuild icons, or package the extension for a release
python3 tools/make_icons.py
tools/package.sh
tools/package-store.sh
```

The end-to-end test writes a fresh screenshot to
`artifacts/woot-search-e2e.png`. It requires live network access, so CI runs the
unit and syntax checks only (see `.github/workflows/ci.yml`).

## Releasing

- **GitHub:** run `tools/package.sh` and attach the ZIP to a release.
- **Chrome Web Store:** run `tools/package-store.sh` and follow
  [STORE_LISTING.md](STORE_LISTING.md) for the listing copy, permissions, and
  submission checklist.

## Contributing

Issues and pull requests are welcome. Please keep the extension dependency-free
and run `node tests/lib.test.cjs` before opening a PR. If Woot changes its page
markup, the injection point is `#global-header` in `content.js`.

## License

[MIT](LICENSE)
