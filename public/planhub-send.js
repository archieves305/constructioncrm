/*
 * KNU CRM — "Send to CRM" for PlanHub.
 *
 * Runs only when the person clicks the bookmark on a PlanHub page. Reads the
 * text on the screen (and, on the Bid Board, each card with its column), opens
 * the CRM's "From PlanHub" page and hands it over with postMessage to the CRM's
 * own origin. It sends no cookie, password or token and asks PlanHub for
 * nothing. If the CRM window cannot be reached, the data is copied to the
 * clipboard to paste on that page.
 */
(function () {
  var script = document.currentScript || document.querySelector('script[src*="planhub-send.js"]');
  var CRM = script ? new URL(script.src).origin : "https://crm.careyos.com";
  var STAGE = /^(saved|estimating|bidding|submitting|submitted|won|lost)(\s*\(?\d*\)?)?$/i;

  function note(msg) {
    var el = document.getElementById("knu-crm-note") || document.createElement("div");
    el.id = "knu-crm-note";
    el.textContent = msg;
    el.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:320px;padding:10px 14px;border-radius:8px;background:#1f3b57;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25)";
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 7000);
  }

  if (!/(^|\.)planhub\.com$/i.test(location.hostname)) {
    note("Send to CRM works on PlanHub pages: open your Bid Board or a project there and click it again.");
    return;
  }

  function visible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }

  // Bid Board cards, outermost only, each with the nearest column heading before it.
  var found = Array.prototype.slice.call(document.querySelectorAll("planhub-bid-planner-v2-lead-card, .lead-card"));
  var cards = found.filter(function (c) { return !found.some(function (o) { return o !== c && o.contains(c); }); });
  var headers = Array.prototype.slice.call(document.querySelectorAll("body *")).filter(function (e) {
    return e.children.length === 0 && STAGE.test((e.textContent || "").trim()) && visible(e) && !cards.some(function (c) { return c.contains(e); });
  });
  var cardData = cards.map(function (c) {
    var column = null;
    headers.forEach(function (h) { if (h.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) column = h.textContent.trim().replace(/\s*\(?\d+\)?$/, ""); });
    return { text: c.innerText || c.textContent || "", column: column };
  });

  var main = document.querySelector("main") || document.body;
  var payload = { type: "planhub-send", url: location.href, text: (main.innerText || "").slice(0, 400000), cards: cardData.length ? cardData : null };

  function copyFallback() {
    var json = JSON.stringify(payload);
    var done = function () { note("Copied. In the CRM's From PlanHub page, click Paste instead and paste."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(done, function () { note("Could not reach the CRM. Allow pop-ups for PlanHub and click Send to CRM again."); });
    else note("Could not reach the CRM. Allow pop-ups for PlanHub and click Send to CRM again.");
  }

  var win = window.open(CRM + "/planhub/import", "knu-crm-planhub");
  if (!win) return copyFallback();
  var sent = false;
  function onReady(e) {
    if (e.origin !== CRM || !e.data || e.data.type !== "planhub-crm-ready" || sent) return;
    sent = true;
    window.removeEventListener("message", onReady);
    win.postMessage(payload, CRM);
    note(cardData.length ? "Sent " + cardData.length + " Bid Board projects to the CRM." : "Sent this project to the CRM.");
  }
  window.addEventListener("message", onReady);
  note("Opening the CRM…");
  // Sign-in on the way may take a while; after 90 s, fall back to the clipboard.
  setTimeout(function () { if (!sent) { window.removeEventListener("message", onReady); copyFallback(); } }, 90000);
})();
