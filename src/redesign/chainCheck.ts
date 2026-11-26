// "Check it on chain" (/proof, 26 Nov): for each Alta testnet transaction the committed records name — every anchor
// (docs/runs/<date>-anchor.json) and #24, refused on chain in the main run — a button that reads the transaction from
// the chain now and shows what it returns: status, block, from, to, and the part that proves the claim, compared with the
// repo: an anchor's calldata against the anchor head recomputed from the committed records when the page was built
// (src/anchor/head.ts), the refusal's MandateRefused log against the mandate the main run's record names.
//
// The read goes through this site (GET /api/alta/tx/<hash>, worker/src/altaTx.ts): Alta testnet's RPC address carries
// an access key, so the browser cannot call it without publishing that key, and the page's CSP stays connect-src 'self'.
// The Worker reads only these transactions, read-only and cached; a local copy says it makes no chain call. Testnet,
// test money; nothing is claimed beyond what the chain returns.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readRecord } from "../anchor/anchor.js";
import { ANCHOR_SCHEMA, computeAnchorHead } from "../anchor/head.js";
import { ALTA_TX_PATH, type AltaTxTarget } from "../../worker/src/altaTx.js";
import { MANDATE_REFUSED_TOPIC } from "../../worker/src/metalInspector.js";
import { EXPLORER, explorerLink, metalStory } from "./metalStory.js";
import type { RunRecord } from "./run.js";
import { esc } from "./ui.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface ChainCheck extends AltaTxTarget {
  explorer: string;
  /** What the repo says the chain should show. */
  expect: { head?: string; height?: number; from?: string; block?: number; mandate?: string; topic?: string };
}

const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

/** Every anchor record whose head the repo still recomputes, oldest first; the head is recomputed here, never copied. */
export function anchorChecks(root = ROOT): ChainCheck[] {
  const dir = join(root, "docs/runs");
  return readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}-anchor\.json$/.test(f)).sort().flatMap((f): ChainCheck[] => {
    const r = readRecord(join(dir, f));
    let head;
    try { head = computeAnchorHead(root, r.parts.map(({ name, file, kind }) => ({ name, file, kind }))); } catch { return []; }
    return [{ hash: r.tx.toLowerCase(), kind: "anchor", label: `The anchor of ${dayOf(r.anchored_at)}`, record: `docs/runs/${f}`, explorer: `${EXPLORER}/tx/${r.tx}`, expect: { head: head.head, height: head.height, from: r.from.toLowerCase(), block: r.block } }];
  });
}

/** #24 refused on chain, from the main run's record (metalStory): its transaction and the mandate the record names. */
export function refusalCheck(record: RunRecord, file: string): ChainCheck[] {
  const r = metalStory(record).refusal, link = explorerLink(r?.proof.href);
  if (!r || link?.kind !== "tx") return [];
  return [{ hash: link.id.toLowerCase(), kind: "refusal", label: `Purchase #${r.seq} refused on chain`, record: file, explorer: `${EXPLORER}/tx/${link.id}`, expect: { ...(/^0x[0-9a-f]{64}$/i.test(r.mandate) ? { mandate: r.mandate.toLowerCase() } : {}), topic: MANDATE_REFUSED_TOPIC } }];
}

export const chainChecks = (record: RunRecord, file: string, root = ROOT): ChainCheck[] => [...refusalCheck(record, file), ...anchorChecks(root)];

/** The allowlist the site's Worker reads from: hash, label, kind and record only. */
export const altaTxTargets = (checks: ChainCheck[]): AltaTxTarget[] => checks.map(({ hash, label, kind, record }) => ({ hash, label, kind, record }));

export const CHAIN_CHECK_TITLE = "Check it on chain";
export const CHAIN_CHECK_NOTE = "Alta testnet, test money. Each button asks this site to read the transaction from Alta testnet now (read-only, only these transactions, kept an hour) and compares what the chain returns with the repo. Alta's RPC address carries an access key, so your browser does not call it directly; the explorer link reads the same transaction there.";

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export function chainCheckHtml(checks: ChainCheck[]): string {
  if (!checks.length) return "";
  const item = (c: ChainCheck) => {
    const data = Object.entries({ hash: c.hash, kind: c.kind, ...c.expect }).map(([k, v]) => ` data-${k}="${esc(String(v))}"`).join("");
    const says = c.kind === "anchor"
      ? `Its calldata should be the text "${ANCHOR_SCHEMA} ${short(c.expect.head ?? "")} ${c.expect.height}": the anchor head recomputed from the committed records when this page was built.`
      : `Its log should be Alta's MandateRefused event for the mandate ${short(c.expect.mandate ?? "")}, as the main run's record says.`;
    return `<li class="ccx"${data} data-rec="${esc(c.record)}"><div class="ccx-h"><b>${esc(c.label)}</b> <code>${esc(short(c.hash))}</code> <a class="pf" href="${esc(c.explorer)}" target="_blank" rel="noopener">${esc("explorer")}&nbsp;↗</a></div><p class="ccx-s">${esc(says)}</p><button type="button" class="ccx-b">${esc(CHAIN_CHECK_TITLE)}</button><dl class="ccx-r" aria-live="polite" hidden></dl></li>`;
  };
  return `<article class="ccxa" id="chain-check" data-path="${esc(ALTA_TX_PATH.slice(1))}/"><p class="q">${esc(CHAIN_CHECK_NOTE)}</p><ul class="ccxl">${checks.map(item).join("")}</ul></article>`;
}

export const CHAIN_CHECK_CSS = `
.ccxl { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 10px; }
.ccx { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 10px 12px; min-width: 0; font-size: 14px; line-height: 1.45; }
.ccx-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }
.ccx-h code { font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--muted); overflow-wrap: anywhere; }
.ccx-h a { display: inline-flex; align-items: center; min-height: 44px; }
.ccx-s { margin: 2px 0 8px; color: var(--muted); font-size: 13.5px; overflow-wrap: anywhere; }
.ccx-b { font: 650 13px/1 Inter, system-ui, sans-serif; padding: 7px 14px; min-height: 44px; min-width: 44px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
.ccx-b:hover { border-color: var(--accent); } .ccx-b:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; } .ccx-b[disabled] { opacity: .6; cursor: progress; }
.ccx-r { display: grid; grid-template-columns: minmax(0, 7.5em) minmax(0, 1fr); gap: 4px 12px; margin: 10px 0 0; }
.ccx-r dt { color: var(--muted); } .ccx-r dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.ccx-r .m { font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.ccx-r .ok { color: var(--ok); font-weight: 650; } .ccx-r .bad { color: var(--bad); font-weight: 650; }
@media (max-width: 640px) { .ccx-r { grid-template-columns: minmax(0, 1fr); } .ccx-r dd { margin-bottom: 4px; } }`;

/**
 * The browser's code (ES5, for a template string): every .ccx-b reads its transaction from this site and fills its
 * list with what the chain returned, text only (textContent), each comparison said in words, not colour alone.
 * ccxVerdict is the part the test runs in Node.
 */
export const CHAIN_CHECK_CORE = `
function ccxText(hex) {
  if (typeof hex !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(hex)) return null;
  var out = "";
  for (var i = 2; i < hex.length; i += 2) { var c = parseInt(hex.slice(i, i + 2), 16); if (c < 32 || c > 126) return null; out += String.fromCharCode(c); }
  return out;
}
function ccxVerdict(d, a) {
  var rows = [], t = a && a.tx;
  rows.push(["Source", a && a.says ? a.says : "no answer", null]);
  if (!a || a.source !== "chain") return { rows: rows, match: null };
  if (!t) { rows.push(["Result", "the chain does not know this transaction", false]); return { rows: rows, match: false }; }
  rows.push(["Status", t.status, t.status === "success"]);
  rows.push(["Block", t.block === null ? "not yet in a block" : String(t.block) + (d.block ? (String(t.block) === d.block ? ", as the record says" : ", the record says " + d.block) : ""), d.block ? String(t.block) === d.block : null]);
  rows.push(["From", t.from + (d.from ? (t.from === d.from ? ", as the record says" : ", the record says " + d.from) : ""), d.from ? t.from === d.from : null]);
  rows.push(["To", t.to || "none (a contract creation)", null]);
  if (d.kind === "anchor") {
    var text = ccxText(t.input), want = "${ANCHOR_SCHEMA} " + d.head + " " + d.height;
    rows.push(["Calldata", text === null ? (t.input === null ? t.input_bytes + " bytes, not shown" : "not text") : text, null]);
    rows.push(["Anchor head", text === want ? "equals the head recomputed from the repo" : "differs from the head recomputed from the repo (" + d.head + ")", text === want]);
  } else {
    var at = -1, logs = t.logs || [];
    for (var i = 0; i < logs.length; i++) if (logs[i].topics[0] === d.topic) { at = i; break; }
    var lg = at >= 0 ? logs[at] : null, ok = !!lg && (!d.mandate || lg.topics[1] === d.mandate);
    rows.push(["Log", lg ? "#" + at + ": Alta's MandateRefused event, mandate " + (lg.topics[1] || "none") : "no MandateRefused event among " + logs.length + " logs", null]);
    rows.push(["Refusal", ok ? "a MandateRefused event for the mandate the record names" : "not the refusal the record names", ok]);
  }
  var match = true;
  for (var j = 0; j < rows.length; j++) if (rows[j][2] === false) match = false;
  return { rows: rows, match: match };
}`;

export const CHAIN_CHECK_JS = `${CHAIN_CHECK_CORE}
(function () {
  var box = document.getElementById("chain-check");
  if (!box) return;
  var path = box.getAttribute("data-path");
  function show(li, v) {
    var dl = li.querySelector(".ccx-r");
    while (dl.firstChild) dl.removeChild(dl.firstChild);
    var rows = v.rows.slice();
    if (v.match !== null) rows.push(["Verdict", v.match ? "Matches the records" : "Does not match the records", v.match]);
    rows.forEach(function (r) {
      var dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = r[0]; dd.textContent = r[1];
      if (/^0x/.test(r[1]) || r[0] === "Calldata") dd.className = "m";
      if (r[2] === true) { var s = document.createElement("span"); s.className = "ok"; s.textContent = " \\u2713"; dd.appendChild(s); }
      if (r[2] === false) { var b = document.createElement("span"); b.className = "bad"; b.textContent = " \\u2717"; dd.appendChild(b); }
      dl.appendChild(dt); dl.appendChild(dd);
    });
    dl.hidden = false;
  }
  Array.prototype.forEach.call(box.querySelectorAll(".ccx"), function (li) {
    var btn = li.querySelector(".ccx-b");
    btn.addEventListener("click", function () {
      btn.disabled = true; btn.textContent = "Reading Alta testnet\\u2026";
      fetch(path + li.getAttribute("data-hash"), { headers: { accept: "application/json" }, credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (a) { show(li, a ? ccxVerdict(li.dataset, a) : { rows: [["Source", "the site did not answer", null]], match: null }); })
        .catch(function () { show(li, { rows: [["Source", "the site did not answer", null]], match: null }); })
        .then(function () { btn.disabled = false; btn.textContent = "${CHAIN_CHECK_TITLE} again"; });
    });
  });
})();`;
