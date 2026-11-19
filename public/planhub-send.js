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
(async function () {
  var script = document.currentScript || document.querySelector('script[src*="planhub-send.js"]');
  var CRM = script ? new URL(script.src).origin : "https://crm.careyos.com";
  var STAGE = /^(saved|estimating|bidding|bid_submitted|submitting|submitted|won|lost)(\s*\(?\d*\)?)?$/i;

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

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function currentCards() {
    var found = Array.prototype.slice.call(document.querySelectorAll("planhub-bid-planner-v2-lead-card, .lead-card"));
    return found.filter(function (c) { return !found.some(function (o) { return o !== c && o.contains(c); }); });
  }
  // Bid Board cards, outermost only, each with the nearest column heading before it.
  function readCards(forcedColumn) {
    var cards = currentCards();
    var headers = Array.prototype.slice.call(document.querySelectorAll("body *")).filter(function (e) {
      return e.children.length === 0 && STAGE.test((e.textContent || "").trim()) && visible(e) && !cards.some(function (c) { return c.contains(e); });
    });
    return cards.map(function (c) {
      var column = forcedColumn || null;
      if (!column) headers.forEach(function (h) { if (h.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) column = h.textContent.trim().replace(/\s*\(?\d+\)?$/, ""); });
      return { text: c.innerText || c.textContent || "", column: column };
    });
  }
  // A narrow window shows one column at a time behind a picker ("saved", "bidding", …).
  function columnPicker() {
    return Array.prototype.slice.call(document.querySelectorAll("mat-select")).filter(function (s) { return STAGE.test((s.innerText || "").trim()); })[0] || null;
  }
  function signature() { return currentCards().map(function (c) { return (c.innerText || "").slice(0, 80); }).join("|"); }
  async function choose(picker, label) {
    picker.click();
    await sleep(600);
    var opt = Array.prototype.slice.call(document.querySelectorAll("mat-option")).filter(function (o) { return o.innerText.trim() === label; })[0];
    if (!opt) { var bd = document.querySelector(".cdk-overlay-backdrop"); if (bd) bd.click(); return false; }
    opt.click();
    // Wait for the column's cards to settle.
    await sleep(1200);
    var last = signature();
    for (var i = 0; i < 12; i++) { await sleep(400); var now = signature(); if (now === last) break; last = now; }
    return true;
  }
  async function readEveryColumn(picker) {
    var original = picker.innerText.trim();
    picker.click();
    await sleep(600);
    var labels = Array.prototype.slice.call(document.querySelectorAll("mat-option")).map(function (o) { return o.innerText.trim(); }).filter(function (t) { return STAGE.test(t); });
    var bd = document.querySelector(".cdk-overlay-backdrop"); if (bd) bd.click();
    await sleep(300);
    var all = [];
    for (var i = 0; i < labels.length; i++) {
      note("Reading the " + labels[i].replace("_", " ") + " column…");
      if (labels[i] === original) { all = all.concat(readCards(labels[i])); continue; }
      if (await choose(picker, labels[i])) all = all.concat(readCards(labels[i]));
    }
    await choose(picker, original);
    return all;
  }

  // Open the CRM window first: Chrome allows a pop-up only right after the click,
  // and reading every column of a narrow board takes longer than that.
  var win = window.open(CRM + "/planhub/import", "knu-crm-planhub");
  var crmReady = false;
  var payload = null;
  var sent = false;
  function trySend() {
    if (sent || !crmReady || !payload || !win) return;
    sent = true;
    window.removeEventListener("message", onReady);
    win.postMessage(payload, CRM);
    note(payload.cards ? "Sent " + payload.cards.length + " Bid Board projects to the CRM." : "Sent this project to the CRM.");
  }
  function onReady(e) {
    if (e.origin !== CRM || !e.data || e.data.type !== "planhub-crm-ready") return;
    crmReady = true;
    trySend();
  }
  window.addEventListener("message", onReady);
  note(win ? "Opening the CRM…" : "Reading the page…");

  function copyFallback() {
    var json = JSON.stringify(payload);
    var done = function () { note("Copied. In the CRM's From PlanHub page, click Paste instead and paste."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(done, function () { note("Could not reach the CRM. Allow pop-ups for PlanHub and click Send to CRM again."); });
    else note("Could not reach the CRM. Allow pop-ups for PlanHub and click Send to CRM again.");
  }

  var onBoard = /\/bid-management(\/|$)/.test(location.pathname);
  var picker = onBoard ? columnPicker() : null;
  var cardData = picker ? await readEveryColumn(picker) : readCards(null);
  var main = document.querySelector("main") || document.body;
  payload = { type: "planhub-send", url: location.href, text: (main.innerText || "").slice(0, 400000), cards: cardData.length ? cardData : null };

  if (!win) return copyFallback();
  trySend();
  if (!sent) note("Waiting for the CRM…");
  // Sign-in on the way may take a while; after 90 s, fall back to the clipboard.
  setTimeout(function () { if (!sent) { window.removeEventListener("message", onReady); copyFallback(); } }, 90000);
})();
