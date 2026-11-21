// /business's visuals (21 Nov; Max: "the business page looks simple and amateur — make it simple but with more visuals
// and the infra/architecture; we made a clear demo: would you trust the agent with your money?"), in /proof's and
// /security's design language: the hero over the site's wave (src/ui/wave.ts) with the question and its answer, the
// demo's approval card and four figures from the evidence wall; the demo as one diagram (invoice in → agent checks →
// paid alone within the limit / to the CFO's Face ID → one cent changed: refused), each step linked to its record; and
// the architecture, four layers and where they run.
//
// Nothing is typed in: the invoice, its amounts, the agent's own payment and the refused cent are read from the
// recorded /try runs through workflowFacts (src/redesign/heroWave.ts), and a run that no longer says one of them is an
// error, never a guess; every figure is a tile of docs/evidence/evidence-wall.json with its record; every layer's part
// links to the page, code or doc that holds it. No style attribute anywhere (the CSP): every rule is here.

import { WALL_FILE, committedWall, type EvidenceWall, type WallTile } from "./evidenceWall.js";
import { recordHref } from "./proofFlow.js";
import { WORKFLOW_RECORD, workflowFacts, type WorkflowFacts } from "./heroWave.js";
import { TRY_SAMPLE_RECORD } from "./heroFlow.js";
import { REPO_BLOB } from "./metalStory.js";
import { repoHref } from "./productPage.js";
import { picon } from "./proofIcons.js";
import { waveScript } from "../ui/wave.js";
import { TRY_URL, esc, icon } from "./ui.js";

/** The question the page asks, and Purser's answer (Max, 21 Nov). */
export const BUSINESS_QUESTION = "Would you trust an AI agent with your company's money?";
export const BUSINESS_ANSWER = "With Purser, you can: agents do the routine, the rails hold the limits, and the CFO signs the exact terms with Face ID.";
export const PROOF_CTA = "See the proof";

/** The demo as the recorded /try runs have it: the invoice, what the agent paid alone, the signed amount, the refused change. */
export interface DemoFacts { supplier: string; number: string; amount: string; alone: string; cent: string; signed: string; sent: string; recs: { invoice: string; run: string } }
export function demoFacts(f: WorkflowFacts | null = workflowFacts()): DemoFacts {
  const held = f?.steps.find((s) => s.state === "held");
  const alone = /it paid (EUR [\d,]+\.\d{2}) on its own/.exec(held?.detail ?? "")?.[1];
  const r = /^\+(EUR 0\.01) after signing: signed (\w+)… ≠ sent (\w+)…$/.exec(f?.refused?.detail ?? "");
  if (!f || !alone || !r || !f.steps.some((s) => s.state === "paid")) throw new Error(`/business: ${WORKFLOW_RECORD} no longer has the agent's own payment, the paid signed invoice and the refused cent`);
  return { supplier: f.invoice.supplier, number: f.invoice.number, amount: f.invoice.amount, alone, cent: r[1]!, signed: r[2]!, sent: r[3]!, recs: { invoice: TRY_SAMPLE_RECORD, run: WORKFLOW_RECORD } };
}
/** "EUR 1,850.00" plus one cent, as the refused copy said it. */
export const plusCent = (amount: string) => amount.replace(/(\d)\.(\d{2})$/, (_m, d: string, c: string) => `${d}.${String(Number(c) + 1).padStart(2, "0")}`);
export const tryCta = (d: DemoFacts) => `Try it: ${d.amount} waits for the CFO`;

const rec = (path: string, label = "Record") => `<a class="bzr" href="${esc(REPO_BLOB + path)}" target="_blank" rel="noopener" title="${esc(path)}">${esc(label)} ↗</a>`;
const ext = (h: string) => (/^https?:/.test(h) ? ' target="_blank" rel="noopener"' : "");

/** The four figures in the hero: the wall's tiles about the demo and its checks, in this order. */
export const HERO_FIGURES: readonly { key: string; icon: string }[] = [
  { key: "try-transfers", icon: "arrow-left-right" },
  { key: "try-cent", icon: "cent" },
  { key: "alta-series-refused", icon: "ban" },
  { key: "verify-all", icon: "badge-check" },
];
const tilesOf = (w: EvidenceWall | null) => new Map<string, WallTile>((w?.groups ?? []).flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function heroFiguresHtml(w: EvidenceWall | null = committedWall()): string {
  const all = tilesOf(w);
  const li = HERO_FIGURES.flatMap(({ key, icon: ic }) => {
    const t = all.get(key);
    return t ? [`<li data-stat="${esc(key)}" data-rec="${esc(t.rec || WALL_FILE)}"><a href="${esc(recordHref(t))}" title="${esc(t.note)}"${ext(recordHref(t))}><span class="bzs-ic" aria-hidden="true">${picon(ic, 20)}</span><span class="bzs-t"><b>${esc(t.fig)}</b><span>${esc(cap(t.label))}</span></span></a></li>`] : [];
  });
  return li.length ? `<ul class="bzstats" aria-label="${esc("Four figures from the records")}">${li.join("")}</ul>` : "";
}

/** The demo's approval card in the hero: the invoice waiting for the CFO, as the recorded run had it. */
export function approvalCardHtml(d: DemoFacts): string {
  return `<figure class="bzcard" aria-labelledby="bzcard-c">
<div class="bzc-top"><span class="bzc-wait">${icon("clock", 14)}${esc("Waiting for the CFO")}</span><span class="bzc-tag">${esc("Sandbox · test money")}</span></div>
<p class="bzc-sup"><span class="bzc-ic" aria-hidden="true">${icon("file-check", 18)}</span><span><b>${esc(d.supplier)}</b><small>${esc(`Invoice ${d.number}`)}</small></span></p>
<p class="bzc-amt">${esc(d.amount)}</p>
<ul class="bzc-ck"><li>${icon("check", 14)}${esc("Payee, amount, due date, account")}</li><li>${icon("check", 14)}${esc(`Over the agent's limit: it paid ${d.alone} alone`)}</li></ul>
<div class="bzc-face" aria-hidden="true"><span class="bzc-fi">${icon("scan-face", 26)}</span><span>${esc("Approve with Face ID")}</span></div>
<p class="bzc-sha">${esc(`Signs sha256 ${d.signed}… of the exact terms`)}</p>
<figcaption id="bzcard-c">${esc("From the recorded /try run.")} ${rec(d.recs.run)}</figcaption>
</figure>`;
}

/** The hero: the wave, the label, the question, its answer, the position line, two buttons, the card, four figures. */
export function businessHeroHtml(o: { label: string; position: string; d: DemoFacts; w?: EvidenceWall | null }): string {
  return `<section class="bzh" aria-labelledby="bzh-h">
<canvas class="bz-wave" aria-hidden="true"></canvas>
<div class="wrap">
<div class="bzh-g">
<div class="bzh-t">
<p class="bzh-pill"><span class="pill note">${icon("info", 14)}${esc(o.label)}</span></p>
<h1 id="bzh-h">${esc(BUSINESS_QUESTION)}</h1>
<p class="bzh-a">${esc(BUSINESS_ANSWER)}</p>
<p class="bzh-p">${esc(o.position)}</p>
<div class="bzh-cta"><a class="btn primary big" href="${TRY_URL}">${icon("scan-face", 18)}${esc(tryCta(o.d))}</a><a class="btn big ghost" href="proof">${esc(PROOF_CTA)}${icon("arrow-right", 18)}</a></div>
</div>
${approvalCardHtml(o.d)}
</div>
${heroFiguresHtml(o.w === undefined ? committedWall() : o.w)}
</div>
</section>`;
}

/** The demo, step by step: what happens to one invoice, each step with its record. */
export interface DemoStep { id: string; tone: "in" | "check" | "ok" | "cfo" | "bad"; icon: string; k: string; title: string; line: string; rec: string }
export function demoSteps(d: DemoFacts): DemoStep[] {
  return [
    { id: "d-in", tone: "in", icon: "file-check", k: "1 · Invoice in", title: d.supplier, line: `${d.amount}, read by Claude as data.`, rec: d.recs.invoice },
    { id: "d-check", tone: "check", icon: "shield-check", k: "2 · Agent checks", title: "The rules check it, not the model", line: "Payee, amount, due date, account, the CFO's limits.", rec: d.recs.invoice },
    { id: "d-alone", tone: "ok", icon: "check", k: "3a · Within the limit", title: `${d.alone} paid alone`, line: "Routine bills, inside the agent's limit.", rec: d.recs.run },
    { id: "d-cfo", tone: "cfo", icon: "scan-face", k: "3b · Over the limit", title: `${d.amount} to the CFO's Face ID`, line: "The CFO signs the exact terms; Airwallex pays.", rec: d.recs.run },
    { id: "d-cent", tone: "bad", icon: "octagon-x", k: "4 · One cent changed", title: "Payment refused", line: `${plusCent(d.amount)} after signing: the hash breaks. Nothing paid.`, rec: d.recs.run },
  ];
}
export const DEMO_TITLE = "The demo: one invoice, every outcome";
export function demoHtml(d: DemoFacts, tryTag: string): string {
  const s = demoSteps(d);
  const node = (x: DemoStep) => `<li class="bzd-n t-${x.tone}" id="${esc(x.id)}"><span class="bzd-ic" aria-hidden="true">${picon(x.icon, 20)}</span><p class="bzd-k">${esc(x.k)}</p><b>${esc(x.title)}</b><p class="bzd-l">${esc(x.line)}</p>${rec(x.rec, "Its record")}</li>`;
  const wire = (cls = "") => `<li class="bzd-w${cls}" aria-hidden="true"><span></span><span></span></li>`;
  return `<section class="card bzd" id="demo" aria-labelledby="bzd-h">
<div class="bzd-hd"><h2 id="bzd-h">${esc(DEMO_TITLE)}</h2><span class="pill">${esc("Recorded /try runs · sandbox")}</span></div>
<ol class="bzd-flow">
${node(s[0]!)}${wire()}${node(s[1]!)}${wire(" fork")}
<li class="bzd-fork"><ol>${node(s[2]!)}${node(s[3]!)}</ol></li>${wire(" bad")}${node(s[4]!)}
<li class="bzd-foot"><a class="btn primary" href="${TRY_URL}">${icon("scan-face", 18)}${esc("Run it yourself")}</a><span>${esc(`No account · ${tryTag}`)}</span></li>
</ol>
</section>`;
}

/** The architecture: four layers, top to bottom, and where they run. Each part links to its page, code or doc. */
export interface BzLayer { id: string; tone: "person" | "engine" | "rails" | "proof"; icon: string; name: string; line: string; parts: readonly (readonly [string, string])[] }
export const BZ_LAYERS: readonly BzLayer[] = [
  { id: "l-cfo", tone: "person", icon: "building-2", name: "CFO & company", line: "Sets the limits and signs what goes over them.", parts: [["CFO's passkey (Face ID)", "security#arch"], ["Company policy", repoHref("policy/example-policy.json")], ["Accountant: reads, cannot pay", "books"]] },
  { id: "l-engine", tone: "engine", icon: "feather", name: "Purser engine", line: "Agents propose; Purser's rules enforce the limits.", parts: [["Agents propose (Claude)", "claude"], ["Rules enforce: limits, payees, duplicates, cash", repoHref("src/policy/rules.ts")], ["CFO policy also in OPA/Rego", repoHref("docs/policy-opa.md")]] },
  { id: "l-rails", tone: "rails", icon: "arrow-left-right", name: "Rails", line: "Each rail holds its own lock.", parts: [["Airwallex sandbox", "airwallex"], ["Alta testnet", "alta"], ["Visa via Airwallex Airi, sandbox", "visa"]] },
  { id: "l-proof", tone: "proof", icon: "file-check", name: "Proof & books", line: "Every step on record, every payment booked.", parts: [["Hash-chained log, anchored on Alta", repoHref("src/audit/log.ts")], ["T:0 books", "books"], ["Moneybird (sandbox)", repoHref("docs/moneybird.md")]] },
];
/** Where Purser Cloud runs (cloud/wrangler.jsonc). */
export const BZ_RUNS_ON: readonly (readonly [string, string])[] = [
  ["Cloudflare Workers", "API and site"],
  ["Durable Objects", "One engine per company"],
  ["D1", "Database, EU"],
  ["R2", "Documents, EU"],
];
export const BZ_ARCH_TITLE = "What runs underneath";
const CLOUD_SVG = `<svg class="i" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`;
export function bzArchHtml(): string {
  const part = ([label, href]: readonly [string, string]) => `<li><a href="${esc(href)}"${ext(href)}>${esc(label)}${/^https?:/.test(href) ? " ↗" : ""}</a></li>`;
  const layer = (l: BzLayer) => `<li class="bza-l t-${l.tone}" id="${esc(l.id)}"><div class="bza-h"><span class="bza-ic" aria-hidden="true">${picon(l.icon, 20)}</span><span><b>${esc(l.name)}</b><small>${esc(l.line)}</small></span></div><ul class="bza-p">${l.parts.map(part).join("")}</ul></li>`;
  return `<section class="card bza" id="architecture" aria-labelledby="bza-h">
<div class="bzd-hd"><h2 id="bza-h">${esc(BZ_ARCH_TITLE)}</h2><span class="pill">${esc("Schematic")}</span></div>
<div class="bza-g">
<ol class="bza-stack">${BZ_LAYERS.map(layer).join("")}</ol>
<aside class="bza-run" aria-labelledby="bza-rh"><p class="bza-rh" id="bza-rh">${CLOUD_SVG}${esc("Runs on Cloudflare")}</p>
<ul>${BZ_RUNS_ON.map(([n, w]) => `<li><b>${esc(n)}</b><small>${esc(w)}</small></li>`).join("")}</ul>
<a class="bzr" href="${esc(repoHref("cloud/wrangler.jsonc"))}" target="_blank" rel="noopener">cloud/wrangler.jsonc ↗</a></aside>
</div>
</section>`;
}

/** The wave behind the hero: few points, quiet (as on /proof and /security). */
export const BUSINESS_WAVE_JS = waveScript({ selector: "canvas.bz-wave", placement: "hero", density: 0.5, intensity: 0.7 });

export const BUSINESS_VISUAL_CSS = `main.bzp { padding: 0 0 24px; }
.bzp .wrap { max-width: 1240px; }
.bzp > .wrap { display: grid; gap: 18px; }
.bzp [id] { scroll-margin-top: 120px; }
/* The hero. */
.bzp > section.bzh { position: relative; isolation: isolate; overflow: hidden; padding: 34px 0 26px; }
.bzh::before { content: ""; position: absolute; inset: 0; z-index: -2; pointer-events: none; -webkit-mask-image: linear-gradient(180deg, #000 60%, transparent); mask-image: linear-gradient(180deg, #000 60%, transparent); background:
  radial-gradient(50% 70% at 82% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%),
  radial-gradient(35% 60% at 8% 100%, color-mix(in srgb, var(--accent-ink) 12%, transparent), transparent 70%); }
canvas.bz-wave { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; pointer-events: none; opacity: .55;
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%); mask-image: linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%); }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) canvas.bz-wave { opacity: .3; } }
:root[data-theme="light"] canvas.bz-wave { opacity: .3; }
.bzh-g { display: grid; gap: 22px; grid-template-columns: minmax(0, 1fr); align-items: center; }
@media (min-width: 980px) { .bzh-g { grid-template-columns: minmax(0, 1.45fr) minmax(320px, .8fr); gap: 40px; } }
.bzh-t { min-width: 0; }
.bzh-pill { margin: 0; }
.bzh h1 { font-size: clamp(34px, 4.6vw, 62px); font-weight: 780; letter-spacing: -.03em; line-height: 1.04; margin: 10px 0 14px; max-width: 15em; }
.bzh-a { margin: 0 0 8px; font-size: clamp(18px, 1.8vw, 23px); font-weight: 650; letter-spacing: -.01em; line-height: 1.35; max-width: 34em; }
.bzh-p { margin: 0 0 20px; font-size: 15.5px; line-height: 1.5; color: var(--muted); max-width: 46em; }
.bzh-cta { display: flex; flex-wrap: wrap; gap: 10px; }
.bzh-cta .btn { white-space: normal; height: auto; min-height: 52px; padding: 12px 22px; line-height: 1.25; }
.bzh-cta .btn .i { flex: none; }
/* The approval card. */
.bzcard { margin: 0; display: grid; gap: 12px; padding: 20px; border-radius: 22px; border: 1px solid var(--glass-line, var(--border)); min-width: 0;
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 90%, transparent), color-mix(in srgb, var(--surface) 72%, transparent)); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  box-shadow: 0 30px 70px -40px color-mix(in srgb, var(--accent) 70%, transparent), var(--hi, 0 0 0 transparent); }
.bzc-top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; }
.bzc-wait { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 14px; font-weight: 700; color: var(--warn, #b54708); background: color-mix(in srgb, var(--warn, #b54708) 14%, transparent); }
.bzc-tag { font-size: 14px; color: var(--muted); }
.bzc-sup { margin: 0; display: flex; align-items: center; gap: 12px; }
.bzc-sup > span:last-child { display: flex; flex-direction: column; min-width: 0; } .bzc-sup b { font-size: 16.5px; } .bzc-sup small { font-size: 14px; color: var(--muted); }
.bzc-ic { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); }
.bzc-amt { margin: 0; font-size: clamp(32px, 3vw, 42px); font-weight: 800; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.bzc-ck { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 14.5px; line-height: 1.35; }
.bzc-ck li { display: flex; gap: 8px; align-items: flex-start; } .bzc-ck .i { color: var(--ok); flex: none; margin-top: 2px; }
.bzc-face { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 54px; border-radius: 16px; font-weight: 700; font-size: 16px; color: #fff; background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--ok))); }
.bzc-fi { display: grid; place-items: center; }
.bzc-sha { margin: -4px 0 0; text-align: center; font: 500 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); overflow-wrap: anywhere; }
.bzcard figcaption { font-size: 14px; color: var(--muted); border-top: 1px solid var(--border); padding-top: 10px; }
a.bzr { display: inline-flex; align-items: center; min-height: 44px; font-size: 14px; font-weight: 650; color: var(--accent); text-decoration: none; }
a.bzr:hover, a.bzr:focus-visible { text-decoration: underline; }
.bzcard figcaption a.bzr { min-height: 0; padding: 12px 0; margin: -12px 0; }
/* The four figures. */
ul.bzstats { list-style: none; margin: 26px 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
ul.bzstats a { display: flex; align-items: center; gap: 14px; height: 100%; box-sizing: border-box; min-height: 44px; padding: 14px 16px; border: 1px solid var(--glass-line, var(--border)); border-radius: 16px;
  background: color-mix(in srgb, var(--surface) 80%, transparent); color: inherit; text-decoration: none; transition: border-color .2s, transform .2s; }
ul.bzstats a:hover, ul.bzstats a:focus-visible { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); transform: translateY(-1px); }
.bzs-ic { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 13px; background: var(--accent-soft); color: var(--accent); }
.bzs-t { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.bzs-t b { font-size: clamp(22px, 2vw, 28px); font-weight: 780; letter-spacing: -.02em; line-height: 1.05; font-variant-numeric: tabular-nums; }
.bzs-t span { font-size: 14px; line-height: 1.35; color: var(--muted); }
@media (max-width: 1100px) { ul.bzstats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) {
  .bzp > section.bzh { padding: 18px 0 16px; }
  .bzh h1 { margin: 8px 0 10px; }
  .bzh-p { font-size: 15px; margin-bottom: 16px; }
  .bzh-cta .btn { width: 100%; justify-content: center; }
  .bzcard { padding: 16px; border-radius: 18px; }
  ul.bzstats { gap: 8px; margin-top: 18px; }
  ul.bzstats a { flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px; }
  .bzs-ic { width: 36px; height: 36px; border-radius: 11px; }
}
/* Section heads inside the visual cards. */
.bzd-hd { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.bzd-hd h2 { margin: 0; font-size: clamp(21px, 2.2vw, 26px); font-weight: 760; letter-spacing: -.02em; line-height: 1.2; }
/* The demo diagram. */
.bzd, .bza { padding: 22px; display: grid; gap: 16px; min-width: 0; border-radius: 22px; background: radial-gradient(70% 60% at 50% 0%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 70%), var(--surface); }
ol.bzd-flow { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; grid-template-columns: minmax(0, 1fr); }
.bzd-n { --nc: var(--accent); position: relative; display: grid; gap: 4px; align-content: start; padding: 14px 16px; border-radius: 16px; min-width: 0;
  border: 1px solid color-mix(in srgb, var(--nc) 38%, var(--border)); background: linear-gradient(180deg, color-mix(in srgb, var(--nc) 10%, var(--surface)), var(--surface) 80%); }
.bzd-n.t-in { --nc: var(--claude, var(--accent)); } .bzd-n.t-ok { --nc: var(--ok); } .bzd-n.t-cfo { --nc: var(--accent); } .bzd-n.t-bad { --nc: var(--bad); }
.bzd-n.t-cfo { box-shadow: 0 18px 44px -30px color-mix(in srgb, var(--accent) 80%, transparent); }
.bzd-ic { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: color-mix(in srgb, var(--nc) 16%, transparent); color: var(--nc); margin-bottom: 4px; }
.bzd-k { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--nc); }
.bzd-n b { font-size: 17px; line-height: 1.3; letter-spacing: -.01em; overflow-wrap: anywhere; }
.bzd-n.t-bad b { color: var(--bad); }
.bzd-l { margin: 0; font-size: 14.5px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
.bzd-n a.bzr { justify-self: start; }
.bzd-fork > ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
/* A wire: a line and two packets running along it; down on a phone, across from 1000 px. */
.bzd-w { position: relative; justify-self: center; width: 2px; height: 28px; margin: 4px 0; background: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.bzd-w.bad { background: color-mix(in srgb, var(--bad) 60%, var(--border)); }
.bzd-w span { position: absolute; left: 50%; top: 0; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px 2px color-mix(in srgb, var(--accent) 70%, transparent); opacity: 0; }
.bzd-w.bad span { background: var(--bad); box-shadow: 0 0 10px 2px color-mix(in srgb, var(--bad) 60%, transparent); }
/* On a phone each step one compact row: its icon beside its words. */
@media (max-width: 999px) {
  .bzd-n { padding: 12px 14px 4px 68px; gap: 2px; }
  .bzd-ic { position: absolute; left: 14px; top: 14px; margin: 0; }
  .bzd-n a.bzr { min-height: 40px; }
}
/* From 1000 px, a tree: the invoice and the checks on the left, the two outcomes stacked, the refusal after the CFO's. */
@media (min-width: 1000px) {
  ol.bzd-flow { grid-template-columns: minmax(0, 1fr) 44px minmax(0, 1fr) 44px minmax(0, 1.15fr) 44px minmax(0, 1fr); grid-template-rows: auto auto; row-gap: 12px; align-items: center; }
  .bzd-fork, .bzd-fork > ol { display: contents; }
  ol.bzd-flow > .bzd-n, ol.bzd-flow > .bzd-w:not(.bad) { grid-row: 1 / 3; }
  #d-in { grid-column: 1; } #d-check { grid-column: 3; } #d-alone { grid-column: 5; grid-row: 1; } #d-cfo { grid-column: 5; grid-row: 2; }
  ol.bzd-flow > .bzd-foot { grid-column: 7; grid-row: 1; margin: 0; flex-direction: column; align-items: flex-start; align-self: center; padding-left: 8px; }
  ol.bzd-flow > .bzd-w.bad { grid-column: 6; grid-row: 2; } ol.bzd-flow > #d-cent { grid-column: 7; grid-row: 2; }
  .bzd-fork .bzd-n { position: relative; }
  .bzd-fork .bzd-n::before { content: ""; position: absolute; left: -23px; top: 50%; width: 22px; height: 2px; background: color-mix(in srgb, var(--accent) 55%, var(--border)); }
  .bzd-w.fork { margin-right: 22px; }
  #d-alone::after, #d-cfo::after { content: ""; position: absolute; left: -23px; width: 2px; background: color-mix(in srgb, var(--accent) 55%, var(--border)); }
  #d-alone::after { top: 50%; bottom: -13px; } #d-cfo::after { top: -1px; bottom: 50%; }
  .bzd-w.fork::after { display: none; }
  .bzd-w { justify-self: stretch; width: auto; height: 2px; margin: 0 6px; }
  .bzd-w span { left: 0; top: 50%; }
  .bzd-w::after { content: ""; position: absolute; right: -1px; top: 50%; width: 7px; height: 7px; border-top: 2px solid currentColor; border-right: 2px solid currentColor; color: var(--accent); transform: translateY(-50%) rotate(45deg); }
  .bzd-w.bad::after { color: var(--bad); }
}
@media (prefers-reduced-motion: no-preference) {
  .bzd-w span { animation: bzd-down 2.2s cubic-bezier(.45,.05,.55,.95) infinite; } .bzd-w span:nth-child(2) { animation-delay: 1.1s; }
  .bzd-n.t-cfo .bzd-ic, .bzc-fi { animation: bz-glow 3.2s ease-in-out infinite; border-radius: 12px; }
  .bzd-n.t-bad .bzd-ic { animation: bz-stop 3.2s ease-in-out infinite; }
}
@keyframes bzd-down { 0% { top: 0; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
@media (min-width: 1000px) { @keyframes bzd-down { 0% { left: 0; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { left: 100%; opacity: 0; } } }
@keyframes bz-glow { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 22%, transparent), 0 0 22px color-mix(in srgb, var(--accent) 50%, transparent); } }
@keyframes bz-stop { 0%, 60%, 100% { transform: none; } 70% { transform: scale(1.18); } 80% { transform: none; } }
.bzd-foot { margin: 14px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; font-size: 14.5px; color: var(--muted); }
.bzd-foot .btn { white-space: normal; height: auto; min-height: 48px; padding: 10px 20px; }
/* The architecture: four layers stacked, where they run beside them. */
.bza-g { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1000px) { .bza-g { grid-template-columns: minmax(0, 1fr) 280px; } }
ol.bza-stack { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; position: relative; }
.bza-l { --lc: var(--accent); position: relative; display: grid; gap: 10px; padding: 14px 16px; border-radius: 16px; border: 1px solid color-mix(in srgb, var(--lc) 35%, var(--border)); box-shadow: inset 4px 0 0 var(--lc); background: var(--sunken); min-width: 0; }
.bza-l.t-person { --lc: var(--ok); } .bza-l.t-engine { --lc: var(--accent); } .bza-l.t-rails { --lc: var(--awx, var(--accent)); } .bza-l.t-proof { --lc: var(--metal, var(--ok)); }
.bza-l.t-engine { background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 12%, var(--sunken)), var(--sunken)); }
.bza-l + .bza-l::before { content: ""; position: absolute; left: 34px; top: -11px; width: 2px; height: 10px; background: color-mix(in srgb, var(--accent) 55%, var(--border)); }
@media (min-width: 760px) { .bza-l { grid-template-columns: minmax(200px, .8fr) minmax(0, 2fr); align-items: center; } }
.bza-h { display: flex; align-items: center; gap: 12px; min-width: 0; }
.bza-h > span:last-child { display: flex; flex-direction: column; min-width: 0; }
.bza-h b { font-size: 17px; letter-spacing: -.01em; } .bza-h small { font-size: 14px; line-height: 1.35; color: var(--muted); }
.bza-ic { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--surface); color: var(--lc); }
ul.bza-p { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
ul.bza-p a { display: inline-flex; align-items: center; min-height: 44px; box-sizing: border-box; padding: 0 14px; border-radius: 999px; font-size: 14.5px; font-weight: 600; color: var(--text); text-decoration: none; background: var(--surface); border: 1px solid var(--border); }
ul.bza-p a:hover, ul.bza-p a:focus-visible { border-color: var(--lc); color: var(--lc); }
.bza-run { display: grid; gap: 8px; align-content: start; padding: 16px; border-radius: 16px; border: 1.5px dashed color-mix(in srgb, var(--accent) 45%, var(--border)); min-width: 0; }
.bza-rh { margin: 0; display: flex; align-items: center; gap: 8px; font-weight: 750; font-size: 16px; } .bza-rh .i { color: var(--accent); }
.bza-run ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); }
@media (min-width: 1000px) { .bza-run ul { grid-template-columns: minmax(0, 1fr); } }
.bza-run li { display: flex; flex-direction: column; padding: 10px 12px; border-radius: 12px; background: var(--sunken); }
.bza-run li b { font-size: 15px; } .bza-run li small { font-size: 14px; color: var(--muted); line-height: 1.35; }
@media (max-width: 560px) { .bzd, .bza { padding: 16px 12px; border-radius: 18px; } .bza-l { padding: 12px; } }
@media (prefers-reduced-motion: reduce) { .bzd *, .bzh *, .bza * { animation: none !important; transition: none !important; } }`;
