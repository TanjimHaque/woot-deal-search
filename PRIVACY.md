# Privacy Policy — Woot Deal Search

**Effective date:** November 27, 2026

Woot Deal Search is an unofficial Chrome extension developed by Tanjim Haque.
It adds a search bar to Woot pages and a browser toolbar popup to search live
Woot deals. This policy explains what the extension does with data.

## The short version

- No accounts, analytics, advertising, tracking, search history storage, or
  developer-operated servers.
- The only data that leaves your browser is the query and filters you enter,
  sent directly from your browser to Woot's public API to fetch results.
- The developer never receives, logs, or stores your search terms.
- Your sort and sold-out preferences stay in your browser.
- Optional Amazon and CamelCamelCamel buttons on results are plain external
  links; the extension never sends requests to those sites in the background.

## What the extension handles

### Search terms and filters

When you type a query (or pick a category, price range, sort, or sold-out
filter) in the Woot page search bar or the extension's toolbar popup, the
extension sends those search parameters over HTTPS to Woot's public GraphQL
endpoint at `https://d24qg5zsx8xdc4.cloudfront.net/graphql` — the same endpoint
Woot's own website uses — to retrieve matching deals.

This request goes directly from your browser to Woot. The developer does not
operate that endpoint, does not receive the request, and does not log, store, or
read your search terms. The extension does not store search history.

### Woot page configuration

To call the API, the extension reads the public `window.__WOOT_GQL__`
configuration embedded in Woot pages. This is cached locally in your browser and
is not transmitted anywhere by the developer.

### Preferences

The extension stores your chosen sort order and your "hide sold out" setting in
`chrome.storage.local` on your device. This information never leaves your
browser and is removed when you uninstall the extension or clear its data.

### Optional external links

When Woot's API includes an Amazon ASIN for an offer, the result card displays
standard external links to `amazon.com` and `camelcamelcamel.com`. Those links
are only followed if you explicitly click them; the extension makes no
background network requests to Amazon or CamelCamelCamel.

### No other data

The extension does not collect names, email addresses, account information,
passwords, payment information, health information, location, browsing history,
search history, page content, or personal communications. It does not use
analytics, advertising, or tracking, and it does not sell or share data with
anyone other than Woot as described above.

## How data is used

Search parameters are used solely to return the results you asked for.
Preferences are used solely to remember your sort and sold-out settings. This
is the extension's single purpose.

## Sharing

The only recipient of your search query is Woot, because the request is sent to
Woot's API. The developer does not receive it. No data is sold, rented, or
shared for advertising or any unrelated purpose.

## Retention and security

The developer retains no user data. Search requests are transmitted over HTTPS.
Local preferences remain on your device until you remove them.

## Limited Use

The use of information received from Chrome APIs and the extension's handling of
user data comply with the Chrome Web Store User Data Policy, including the
[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
requirements.

## Children

The extension is not directed at children and does not knowingly collect data
from children.

## Changes

If this policy changes, the effective date above will be updated and the revised
policy will be posted in this repository.

## Contact

Questions or requests: open an issue at
<https://github.com/TanjimHaque/woot-deal-search/issues>.

## Disclaimer

Woot Deal Search is not affiliated with, endorsed by, or produced by Woot or
Amazon. Woot and Amazon are trademarks of their respective owners. Woot's own
privacy policy governs Woot's processing of requests sent to its API.
