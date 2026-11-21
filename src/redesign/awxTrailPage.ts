// /airwallex/calls (15 Nov): the Airwallex API trail. Every Airwallex sandbox API call Purser's recorded runs hold, run by
// run, newest first, with what each call did, its outcome and object id where the record holds them, the record it
// comes from, and each transfer's hash check recomputed from the records (src/airwallex/apiTrail.ts). No script: a
// style-only policy. Served one level down, so its relative links are made absolute, as /agents/<id>'s are.

import { apiTrail, FAMILIES, FAMILY_LABEL, type HashCheck, type Trail, type TrailCall, type TrailRun } from "../airwallex/apiTrail.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon, page } from "./ui.js";

export const AWX_CALLS_PATH = "airwallex/calls";

/** The six families the brief names, then logins and other, each with its count; zero counts are left out. */
export const familyLine = (t: Trail): string => FAMILIES.filter((f) => t.byFamily[f]).map((f) => `${FAMILY_LABEL[f]} ${t.byFamily[f]}`).join(" · ");
export const transferLine = (t: Trail): string => `${t.checks.transfers.match} of ${t.checks.transfers.total} transfers carry the signed hash`;
export const batchLine = (t: Trail): string => `${t.checks.batches.match} of ${t.checks.batches.total} batch transfers carry the signed batch hash`;

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const time = (iso: string) => iso.slice(11, 23);
const rec = (file: string) => `<a href="${esc(REPO_BLOB + file)}" target="_blank" rel="noopener"><code>${esc(file.replace(/^docs\/(runs|demo)\//, ""))}</code> ↗</a>`;

const callLi = (c: TrailCall, file: string) => `<li class="awc-c"><span class="awc-t">${c.at ? `${esc(day(c.at))} ${esc(time(c.at))}` : `<span class="awc-n">no time in the record</span>`}</span>`
  + `<span class="awc-p"><b class="awc-m awc-${esc(c.method.toLowerCase())}">${esc(c.method)}</b> <code>${esc(c.path)}</code>${c.count > 1 ? ` <span class="awc-x">×${c.count}</span>` : ""}</span>`
  + `<span class="awc-w">${esc(c.what)}${c.note ? ` <span class="awc-n">(${esc(c.note)})</span>` : ""}</span>`
  + `<span class="awc-o">${c.outcome ? esc(c.outcome) : `<span class="awc-n">no outcome in the record</span>`}${c.objectId ? ` <code class="awc-id">${esc(c.objectId)}</code>` : ""}</span>`
  + `<span class="awc-r">${rec(file)}</span></li>`;

const runFold = (r: TrailRun, open: boolean) => {
  const n = r.calls.reduce((s, c) => s + c.count, 0);
  return `<details class="fold awc-run"${open ? " open" : ""}><summary>${esc(day(r.iso))} · ${esc(r.title)} · ${n} call${n === 1 ? "" : "s"}</summary>
<p class="awc-src">Record: ${rec(r.record)}${r.alsoReads.length ? `; also reads ${r.alsoReads.map(rec).join(", ")}` : ""}.${r.unlisted ? ` ${esc(r.unlisted)}` : ""}</p>
<ol class="awc-l">${r.calls.map((c) => callLi(c, r.record)).join("")}</ol></details>`;
};

const short = (h: string | null) => (h ? `${h.slice(0, 16)}…` : "not recorded");
const checkLi = (c: HashCheck) => `<li class="awc-h ${c.match ? "ok" : "bad"}">${icon(c.match ? "circle-check" : "octagon-x", 16)}<span><b>${c.match ? "match" : "mismatch"}</b> ${esc(c.label)}<br><span class="awc-n">carries <code>${esc(short(c.carried))}</code>, signed <code>${esc(short(c.signed))}</code>${c.recomputed ? `, recomputed from the terms <code>${esc(short(c.recomputed))}</code>` : ""}: ${esc(c.how)}</span></span></li>`;

export const AWX_CALLS_CSS = `
.awc h1 { margin: 0 0 10px; }
.awc .sum { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 6px; padding: 0; list-style: none; }
.awc .sum li { border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: 6px 12px; font-size: 14px; }
.awc .sum b { font-variant-numeric: tabular-nums; }
.awc .hashes { border: 1px solid var(--border); background: var(--surface); border-radius: 14px; padding: 14px 16px; margin: 18px 0; }
.awc .hashes h2 { font-size: 18px; margin: 0 0 6px; }
.awc .big { font-size: 20px; font-weight: 700; margin: 4px 0; }
.awc ul.awc-hl { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 8px; }
.awc-h { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; overflow-wrap: anywhere; }
.awc-h.ok svg { color: #16a34a; flex: none; margin-top: 2px; } .awc-h.bad svg { color: #dc2626; flex: none; margin-top: 2px; }
.awc .cmd { font-size: 14px; } .awc .cmd code { background: var(--sunken); padding: 2px 6px; border-radius: 6px; }
.awc-run summary { font-weight: 650; }
.awc-src { font-size: 13.5px; color: var(--muted); overflow-wrap: anywhere; }
ol.awc-l { list-style: none; padding: 0; margin: 8px 0 0; }
.awc-c { display: grid; grid-template-columns: 1fr; gap: 2px; padding: 10px 0; border-top: 1px solid var(--border); font-size: 14px; overflow-wrap: anywhere; }
.awc-t { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 13px; }
.awc-p code { font-size: 13px; }
.awc-m { display: inline-block; min-width: 3.4em; font-size: 12px; letter-spacing: .02em; }
.awc-get { color: #2563eb; } .awc-post { color: #c2410c; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .awc-get { color: #7aa7ff; } :root:not([data-theme="light"]) .awc-post { color: #fb923c; } }
:root[data-theme="dark"] .awc-get { color: #7aa7ff; } :root[data-theme="dark"] .awc-post { color: #fb923c; }
.awc-x { font-weight: 700; }
.awc-n { color: var(--faint); font-size: 13px; }
.awc-id { font-size: 12.5px; background: var(--sunken); padding: 1px 5px; border-radius: 5px; }
.awc-r { font-size: 12.5px; }
@media (min-width: 900px) {
  .awc-c { grid-template-columns: 11em minmax(16em, 1.2fr) 1.3fr 1.3fr; column-gap: 14px; }
  .awc-r { grid-column: 2 / -1; }
}
`;

export function awxCallsBody(t: Trail = apiTrail()): string {
  const transfers = t.runs.flatMap((r) => r.checks).filter((c) => c.kind === "transfer"), batches = t.runs.flatMap((r) => r.checks).filter((c) => c.kind === "batch");
  return `<main class="pp awc"><div class="wrap">
<p class="pill">Airwallex sandbox · test money</p>
<h1>Every Airwallex API call, from the records</h1>
<p class="lead">${t.calls} calls to the Airwallex sandbox in ${t.runs.length} committed run records. Each row says what the call did, what came back where the record keeps it, and which record it is from.</p>
<ul class="sum" aria-label="Calls per endpoint family">${FAMILIES.filter((f) => t.byFamily[f]).map((f) => `<li>${esc(FAMILY_LABEL[f])} <b>${t.byFamily[f]}</b></li>`).join("")}</ul>
<p class="awc-n">${t.timed === t.calls ? `Every one of the ${t.calls} calls carries its own time in the record.` : `${t.timed} of the ${t.calls} calls carry their own time in the record; the others come from records that count calls per endpoint.`} A blank outcome means the record holds none: nothing here is estimated. Ids are folded to <code>{id}</code> in paths, as the call logs wrote them; no token, key, client id, account or card number is shown.</p>
<section class="hashes" aria-labelledby="awc-hash">
<h2 id="awc-hash">The signed hash, checked again from the records</h2>
<p class="big">${esc(transferLine(t))}</p>
<p class="big">${esc(batchLine(t))}</p>
<p>Each transfer's <code>approval_sha256</code> is compared with the terms hash the passkey signed in the same run's record${t.checks.recomputed ? `; for ${t.checks.recomputed === 1 ? "the one transfer" : `${t.checks.recomputed} transfers`} whose record keeps the signed terms (the owner's own approval of 7 November), SHA-256 of those terms is recomputed too` : ""}.</p>
<p class="cmd">Offline, no keys: <code>npm run airwallex-trail</code> prints this list and re-runs every check; it exits 1 on any mismatch.</p>
<details class="fold"><summary>Every check (${transfers.length + batches.length})</summary><ul class="awc-hl">${[...transfers, ...batches].map(checkLi).join("")}</ul></details>
</section>
<h2>The calls, run by run, newest first</h2>
${t.runs.map((r, i) => runFold(r, i === 0)).join("\n")}
<p class="awc-n">Not listed: /try's live FX quotes and transfers, because the committed /try records keep no Airwallex call log. Every call listed ran on the Airwallex sandbox with test money; SWIFT settlement and merchant charges there are simulated by the sandbox.</p>
<p><a class="btn" href="airwallex">${icon("credit-card", 16)}Airwallex</a> <a class="btn" href="proof">${icon("shield-check", 16)}Proof</a></p>
</div></main>`;
}

export function awxCallsPage(t: Trail = apiTrail()): string {
  const html = page({ title: "Airwallex API calls", description: `Every Airwallex sandbox API call in Purser's recorded runs: ${t.calls} calls, ${transferLine(t)}.`, tab: "airwallex", css: AWX_CALLS_CSS, body: awxCallsBody(t),
    source: `Source: the run records in docs/runs (*airwallex*, airwallex-*.json, 2026-11-07-awx-1/) and docs/demo/airwallex-run.json, read by src/airwallex/apiTrail.ts.` });
  // Served one level down (/airwallex/calls): the page's own relative links and assets made absolute.
  return html.replace(/(href|src)="(?!https?:|#|\/|data:|mailto:)/g, '$1="/').replace(/url\(assets\//g, "url(/assets/");
}
