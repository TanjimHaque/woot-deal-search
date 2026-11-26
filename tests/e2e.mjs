/*
 * End-to-end test for Woot Deal Search.
 *
 * Loads the unpacked extension into headless Brave/Chrome via CDP, opens
 * woot.com, performs real searches, exercises sort/toggle/pagination/keyboard/
 * error states, and writes a screenshot to artifacts/woot-search-e2e.png.
 *
 * Run with the Node bundled in Electron:
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" tests/e2e.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_DIR = path.join(ROOT, "woot-search-extension");
const ARTIFACT_DIR = path.join(ROOT, "artifacts");
const SHOT_PATH = path.join(ARTIFACT_DIR, "woot-search-e2e.png");

const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROMIUM = "/Applications/Chromium.app/Contents/MacOS/Chromium";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let failed = 0;

function check(label, condition, detail) {
  const ok = Boolean(condition);
  results.push({ label, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${ok || !detail ? "" : ` (${detail})`}`);
}

function findBrowser() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  for (const candidate of [BRAVE, CHROME, CHROMIUM]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("No Chrome/Brave/Chromium found. Set BROWSER_PATH.");
}

class CDP {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  open() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (event) => this._onMessage(event.data));
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", () => reject(new Error("CDP websocket failed")));
    });
  }

  _onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      return;
    }
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        reject(new Error(`${message.error.message} (${message.error.code})`));
      } else {
        resolve(message.result);
      }
      return;
    }
    if (message.method) {
      const session = message.sessionId || "";
      const handlers = this.listeners.get(message.method) || [];
      for (const handler of handlers) {
        try {
          handler(message.params, session);
        } catch (err) {
          // Listener failures should not break the CDP loop.
        }
      }
    }
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch (err) {
      // ignore
    }
  }
}

async function main() {
  if (!fs.existsSync(path.join(EXTENSION_DIR, "manifest.json"))) {
    throw new Error("Extension not found at " + EXTENSION_DIR);
  }
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const browser = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "wootss-e2e-"));
  const port = 9400 + Math.floor(Math.random() * 400);
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    `--user-data-dir=${profile}`,
    `--load-extension=${EXTENSION_DIR}`,
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--remote-debugging-port=${port}`,
    "--window-size=1440,1000",
    "about:blank"
  ];

  let stderr = "";
  const proc = spawn(browser, args, { stdio: ["ignore", "ignore", "pipe"] });
  proc.stderr.on("data", (chunk) => {
    stderr += String(chunk);
    if (stderr.length > 20000) stderr = stderr.slice(-20000);
  });

  let cdp = null;
  try {
    let version = null;
    for (let i = 0; i < 80; i += 1) {
      if (proc.exitCode !== null) throw new Error("Browser exited early:\n" + stderr.slice(-3000));
      try {
        version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        break;
      } catch (err) {
        await sleep(250);
      }
    }
    if (!version) throw new Error("Browser did not expose CDP on port " + port);

    cdp = new CDP(version.webSocketDebuggerUrl);
    await cdp.open();
    console.log(`Connected to ${version.Browser} (${browser})`);

    const exceptions = [];
    const watchSession = (sessionId) => {
      cdp.on("Runtime.exceptionThrown", (params, session) => {
        if (session !== sessionId) return;
        const details = params.exceptionDetails || {};
        const description = String(
          (details.exception && details.exception.description) || details.text || ""
        );
        const frames = (details.stackTrace && details.stackTrace.callFrames) || [];
        const urls = [details.url || "", ...frames.map((f) => f.url || "")].join(" ");
        if (/wootss|chrome-extension:\/\//i.test(description + " " + urls)) {
          exceptions.push(description + " @ " + urls);
        }
      });
    };

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page = attached.sessionId;
    watchSession(page);

    await cdp.send("Page.enable", {}, page);
    await cdp.send("Runtime.enable", {}, page);
    await cdp.send("Network.enable", {}, page);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
      page
    );

    const evaluate = async (expression, session = page) => {
      const response = await cdp.send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        session
      );
      if (response.exceptionDetails) {
        const description =
          (response.exceptionDetails.exception && response.exceptionDetails.exception.description) ||
          response.exceptionDetails.text;
        throw new Error(description || "Evaluation failed");
      }
      return response.result ? response.result.value : undefined;
    };

    const waitFor = async (expression, label, timeout = 20000, session = page) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          const value = await evaluate(expression, session);
          if (value) return value;
        } catch (err) {
          // Context can disappear during navigation; retry.
        }
        await sleep(250);
      }
      throw new Error("Timed out waiting for " + label);
    };

    console.log("Opening woot.com…");
    await cdp.send("Page.navigate", { url: "https://www.woot.com/" }, page);
    await waitFor(
      `!!document.querySelector('#wootss-input') && !!document.querySelector('#global-header')`,
      "search bar injection"
    );

    const placement = await evaluate(`(() => {
      const root = document.getElementById('wootss-root');
      const header = document.getElementById('global-header');
      const content = document.getElementById('content');
      if (!root || !header) return null;
      const r = root.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      const c = content ? content.getBoundingClientRect() : null;
      return {
        rootTop: r.top, rootBottom: r.bottom, headerTop: h.top, headerBottom: h.bottom,
        contentTop: c ? c.top : null, width: r.width,
        input: !!document.querySelector('#wootss-input'),
        panelHidden: document.querySelector('#wootss-panel').hidden
      };
    })()`);
    check(
      "search bar is injected below the global header",
      placement && placement.rootTop >= placement.headerTop && placement.rootTop >= placement.headerBottom - 2,
      JSON.stringify(placement)
    );
    check("panel starts closed", placement && placement.panelHidden === true);
    check("bar spans the 1080px content width", placement && placement.width >= 1000, String(placement && placement.width));

    const setQuery = async (query) => {
      await evaluate(`(() => {
        const input = document.querySelector('#wootss-input');
        input.focus();
        input.value = ${JSON.stringify(query)};
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(query)} }));
      })()`);
    };

    const waitForResults = async (minRows = 1, label = "search results") => {
      await waitFor(
        `document.querySelectorAll('.wootss-result').length >= ${minRows} && !document.querySelector('.wootss-panel').hidden && !document.querySelector('.wootss-skrow')`,
        label
      );
      return evaluate(`document.querySelectorAll('.wootss-result').length`);
    };

    console.log("Searching for “usb”…");
    await setQuery("usb");
    const rowCount = await waitForResults(10, "usb results");
    check("search returns a full first page", rowCount === 24, String(rowCount));

    const firstCard = await evaluate(`(() => {
      const row = document.querySelector('.wootss-result');
      if (!row) return null;
      const img = row.querySelector('img');
      return {
        href: row.href,
        title: row.querySelector('.wootss-title')?.textContent || '',
        price: row.querySelector('.wootss-price')?.textContent || '',
        image: img ? img.src : ''
      };
    })()`);
    check(
      "result links to a Woot offer page",
      firstCard && /^https:\/\/[a-z0-9.-]*woot\.com\/offers\//i.test(firstCard.href),
      firstCard && firstCard.href
    );
    check("result has a title", firstCard && firstCard.title.length > 3, firstCard && firstCard.title);
    check("result has a price", firstCard && /^\$|^From \$/.test(firstCard.price), firstCard && firstCard.price);
    check("result loads an https thumbnail", firstCard && firstCard.image.startsWith("https://"), firstCard && firstCard.image);

    const countText = await evaluate(`document.querySelector('#wootss-count').textContent`);
    check("header reports the live total", /\d[\d,]* deals? for/i.test(countText), countText);
    console.log("   " + countText);

    // Screenshot with the panel open.
    await evaluate(`(() => {
      for (const sel of ['#prime-modal', '#signup-popup', '.signup-popup', '.modal-backdrop', '[data-test-ui="signup-popup"]']) {
        document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
      }
      const dismiss = [...document.querySelectorAll('a, button')].find((el) =>
        /nah,? maybe later|maybe later|no thanks/i.test((el.textContent || '').trim())
      );
      if (dismiss) dismiss.click();
      const marker = [...document.querySelectorAll('body *')].find(
        (el) => el.children.length === 0 && /Let the deals find you/i.test((el.textContent || '').trim())
      );
      let node = marker;
      while (node && node !== document.body) {
        const position = getComputedStyle(node).position;
        if (position === 'fixed' || position === 'sticky') {
          node.style.display = 'none';
          break;
        }
        node = node.parentElement;
      }
      window.scrollTo(0, 0);
    })()`);
    await sleep(500);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, page);
    fs.writeFileSync(SHOT_PATH, Buffer.from(shot.data, "base64"));
    console.log("Screenshot written to " + SHOT_PATH);

    // Sort by price ascending.
    console.log("Testing sort by price…");
    await evaluate(`(() => {
      const select = document.querySelector('#wootss-sort');
      select.value = 'PriceLowToHigh';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(
      `document.querySelector('#wootss-sort').value === 'PriceLowToHigh' && document.querySelectorAll('.wootss-result').length > 0 && !document.querySelector('.wootss-skrow')`,
      "price-sorted results"
    );
    const ascending = await evaluate(`(() => {
      const prices = [...document.querySelectorAll('.wootss-result .wootss-price')]
        .map((el) => parseFloat(el.textContent.replace(/[^0-9.]/g, '')))
        .filter((n) => Number.isFinite(n));
      return prices.length > 1 ? prices.every((p, i) => i === 0 || prices[i - 1] <= p) : false;
    })()`);
    check("price low-to-high sorting is ascending", ascending === true);

    // Hide sold out toggles the total.
    const countBefore = await evaluate(
      `parseInt(document.querySelector('#wootss-count').textContent.replace(/[^0-9]/g, ''), 10)`
    );
    console.log("Testing sold-out filter (before: " + countBefore + ")…");
    await evaluate(`document.querySelector('#wootss-hide-sold').click()`);
    const countAfter = await waitFor(
      `(() => {
        const value = parseInt(document.querySelector('#wootss-count').textContent.replace(/[^0-9]/g, ''), 10);
        return value !== ${countBefore} ? value : 0;
      })()`,
      "sold-out filter refresh"
    );
    check("showing sold-out deals increases the total", countAfter > countBefore, `${countBefore} -> ${countAfter}`);
    await evaluate(`document.querySelector('#wootss-hide-sold').click()`);
    await waitFor(
      `parseInt(document.querySelector('#wootss-count').textContent.replace(/[^0-9]/g, ''), 10) === ${countBefore}`,
      "sold-out filter restore"
    );

    // Pagination.
    console.log("Testing show more…");
    await evaluate(`document.querySelector('#wootss-more').click()`);
    await waitFor(
      `document.querySelectorAll('.wootss-result').length > 24 && !document.querySelector('.wootss-skrow')`,
      "second page of results"
    );
    const grown = await evaluate(`document.querySelectorAll('.wootss-result').length`);
    check("show more appends another page", grown >= 48, String(grown));

    // Empty state.
    console.log("Testing empty state…");
    await setQuery("zzzxqjv");
    await waitFor(`!!document.querySelector('.wootss-empty')`, "empty state");
    const emptyText = await evaluate(`document.querySelector('.wootss-empty').textContent`);
    check("empty query shows a clear message", /no deals found/i.test(emptyText), emptyText);

    // Cmd/Ctrl+K focus shortcut.
    await evaluate(`document.activeElement.blur()`);
    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "rawKeyDown", modifiers: 4, key: "k", code: "KeyK", windowsVirtualKeyCode: 75 },
      page
    );
    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "keyUp", modifiers: 4, key: "k", code: "KeyK", windowsVirtualKeyCode: 75 },
      page
    );
    await sleep(250);
    const focused = await evaluate(`document.activeElement && document.activeElement.id`);
    check("Cmd/Ctrl+K focuses the search input", focused === "wootss-input", String(focused));

    // Service-worker offline error state.
    console.log("Testing offline error state…");
    let swSession = null;
    try {
      const targets = await cdp.send("Target.getTargets");
      const sw = targets.targetInfos.find(
        (t) => t.type === "service_worker" && /\/background\.js$/.test(t.url)
      );
      if (sw) {
        const attachedSw = await cdp.send("Target.attachToTarget", { targetId: sw.targetId, flatten: true });
        swSession = attachedSw.sessionId;
        watchSession(swSession);
        await cdp.send("Network.enable", {}, swSession);
        await cdp.send(
          "Network.emulateNetworkConditions",
          { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
          swSession
        );
      }
    } catch (err) {
      console.log("   (could not attach to service worker: " + err.message + ")");
    }

    await setQuery("mechanical keyboard");
    if (swSession) {
      await waitFor(`!!document.querySelector('.wootss-state .wootss-retry')`, "error state");
      const errorText = await evaluate(`document.querySelector('.wootss-state').textContent`);
      check("network failure shows a retryable error", /unavailable|try again|reach woot/i.test(errorText), errorText);
    } else {
      console.log("   (skipped offline assertion: service worker not attachable)");
    }

    if (swSession) {
      await cdp
        .send(
          "Network.emulateNetworkConditions",
          { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
          swSession
        )
        .catch(() => {});
    }
    await evaluate(`document.querySelector('.wootss-retry')?.click()`);
    await waitFor(
      `document.querySelectorAll('.wootss-result').length > 0 && !document.querySelector('.wootss-state')`,
      "retry recovery"
    );
    check("retry recovers after the network returns", true);

    // Keyboard navigation ends on a deal page.
    console.log("Testing keyboard navigation…");
    await setQuery("usb");
    await waitForResults(5, "usb results for keyboard");
    await evaluate(`document.querySelector('#wootss-input').focus()`);
    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "rawKeyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
      page
    );
    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
      page
    );
    const activeId = await waitFor(
      `document.querySelector('.wootss-result.wootss-active')?.id`,
      "active result highlight"
    );
    check("arrow keys highlight a result", /^wootss-option-\d+$/.test(activeId || ""), String(activeId));
    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
      page
    );
    await cdp.send(
      "Input.dispatchKeyEvent",
      { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
      page
    );
    const offerUrl = await waitFor(`location.href.includes('/offers/') ? location.href : ''`, "offer navigation");
    check("Enter opens the highlighted deal", /woot\.com\/offers\//i.test(offerUrl), offerUrl);

    // Bar should also exist on the offer page.
    await waitFor(`!!document.querySelector('#wootss-input')`, "bar on offer page");
    check("search bar persists on offer pages", true);

    // Category pages and saved preferences.
    console.log("Testing category page and saved preferences…");
    await cdp.send("Page.navigate", { url: "https://www.woot.com/category/electronics" }, page);
    await waitFor(
      `!!document.querySelector('#wootss-input') && !!document.querySelector('#wootss-sort')`,
      "bar on category page"
    );
    const persistedSort = await waitFor(
      `document.querySelector('#wootss-sort').value === 'PriceLowToHigh' ? 'PriceLowToHigh' : ''`,
      "persisted sort preference"
    );
    check("search bar appears on category pages", true);
    check("sort preference survives a page load", persistedSort === "PriceLowToHigh", persistedSort);

    check("no extension JavaScript exceptions", exceptions.length === 0, exceptions.slice(0, 3).join(" | "));

    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    try {
      proc.kill("SIGKILL");
    } catch (err) {
      // ignore
    }
    await sleep(300);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (err) {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error("\nE2E failed:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
