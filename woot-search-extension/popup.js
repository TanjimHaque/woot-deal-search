/* Woot Deal Search - browser toolbar popup entrypoint. */
(() => {
  "use strict";

  function init() {
    const mount = document.getElementById("wootss-popup-mount");
    if (!mount || !window.WootSearchUI) return;
    const ui = window.WootSearchUI.create({ mode: "popup" });
    mount.replaceChildren(ui.root);
    window.setTimeout(() => ui.focusInput(), 20);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
