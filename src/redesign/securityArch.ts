// /security's centrepiece (19 Nov, the owner: "an enterprise-grade, visually strong /security page"): the layers and
// trust boundaries one supplier payment passes, from the agent's ask to the proof file anyone can check offline, and
// where each security control sits on that path, each linked to the code that enforces it.
//
// A schematic, said so on it: the moving dots illustrate one payment paid as signed (green) and a copy with one cent
// changed after signing (red, refused at the signature); the figures that show this ran are in "What we did, with
// evidence" below it (./securityEvidence.ts). HTML and CSS only: no script (the page keeps its style-only policy), no
// inline style (every delay is a class rule written here), the theme's tokens in light and dark, one column on a phone
// and two inside each layer from 900 px; under prefers-reduced-motion nothing moves and every layer stays marked.

import { outLink, repoHref, siteLink } from "./productPage.js";
import { esc, icon, TRY_URL } from "./ui.js";

/** A control at a layer: its name, what it does in a few words, and the file that enforces it (a repository path). */
export interface ArchControl { name: string; does: string; code: string }
/** One of the three locks, each held by a different party. */
export interface ArchLock { name: string; held: string; tone: "awx" | "metal" | "ok"; icon: string; href: string }
/** A layer of the path: who is trusted there, what happens, the controls that sit there. */
export interface ArchLayer {
  id: string; zone: string; tone: "untrusted" | "code" | "person" | "rails" | "anyone"; icon: string; title: string; line: string;
  /** Purser's own rules (layer 2), each linked to its code. */
  rules?: { name: string; code: string }[];
  locks?: ArchLock[];
  /** The refusal the red dot meets here. */
  refuse?: string;
  links?: string[];
  controls: ArchControl[];
}

/** The path, in order: five layers, and the trust boundary after each but the last. */
export const ARCH_LAYERS: readonly ArchLayer[] = [
  {
    id: "ar-agent", zone: "Untrusted input", tone: "untrusted", icon: "bot", title: "The agent asks; Claude reads the invoice",
    line: "The invoice is data, never instructions. If Claude fails or answers outside its schema, code's own parser reads the invoice instead.",
    controls: [
      { name: "CSP and headers", does: "A policy per page, scripts and styles by hash; HSTS; no framing.", code: "src/relay/assets.ts" },
      { name: "Rate limits", does: "Per address and per network at the edge; model calls capped.", code: "worker/src/core.ts" },
      { name: "zod validation", does: "Model output, tool calls and request bodies parsed; what does not fit is refused.", code: "src/agents/toolSchema.ts" },
    ],
  },
  {
    id: "ar-rules", zone: "Purser's code", tone: "code", icon: "sliders-horizontal", title: "Purser's rules decide, not the model",
    line: "Code checks every proposal before anything moves; an agent cannot change a rule.",
    rules: [
      { name: "Limits", code: "src/policy/rules.ts" },
      { name: "Payee allowlist", code: "src/policy/fraud.ts" },
      { name: "Duplicates", code: "src/lib/invoiceKey.ts" },
      { name: "Cash floor", code: "src/ap/checkerCore.ts" },
    ],
    controls: [
      { name: "Hash first", does: "The executor re-hashes the stored terms before any outside call.", code: "src/policy/hashFirst.ts" },
      // 21 Nov: the two Purser Cloud controls that had cards of their own on /security, now on the path.
      { name: "Each company apart", does: "Every row carries its company; a test tries each route on another company's data.", code: "cloud/src/tenant.ts" },
      { name: "Sealed secrets", does: "Only the runner holds payment keys; each company's OAuth tokens sealed with AES-GCM.", code: "cloud/src/sealed.ts" },
    ],
  },
  {
    id: "ar-sign", zone: "A person", tone: "person", icon: "scan-face", title: "The CFO's passkey signs the exact terms",
    line: "Above the limit, the passkey signs the SHA-256 of the canonical terms. Change one cent and the hash no longer matches.",
    refuse: "One cent changed: refused here",
    links: [siteLink(TRY_URL, "Try it yourself", true)],
    controls: [
      { name: "/health tamper alarm", does: "Terms changed after signing raise a critical alarm and are never paid.", code: "src/ops/health.ts" },
    ],
  },
  {
    id: "ar-locks", zone: "Three parties", tone: "rails", icon: "lock", title: "Three independent locks",
    line: "Each lock is held by a different party; a payment must pass all three.",
    locks: [
      { name: "Airwallex card controls", held: "Per agent, held by Airwallex (sandbox).", tone: "awx", icon: "credit-card", href: "airwallex#controls" },
      { name: "Alta mandate on chain", held: "Per agent, enforced by Alta's contract (testnet).", tone: "metal", icon: "landmark", href: "alta" },
      { name: "CFO passkey", held: "Held on the CFO's own device.", tone: "ok", icon: "scan-face", href: "proof" },
    ],
    controls: [
      { name: "Idempotency", does: "Each create carries the signed request id; a lost answer is looked up, never sent again.", code: "src/policy/saga.ts" },
      { name: "HMAC webhooks", does: "Signature checked, then recorded; a webhook never moves money.", code: "src/policy/airwallexEvents.ts" },
    ],
  },
  {
    id: "ar-proof", zone: "Anyone", tone: "anyone", icon: "file-check", title: "A proof file anyone can verify offline",
    line: "The signed terms, the passkey's signature and the ledger lines in one file, checked with no server and no key of ours.",
    links: [siteLink("verify", "Verify a proof file")],
    controls: [
      { name: "Hash-chained audit log", does: "Every step linked to the one before; anchored on Alta testnet.", code: "src/audit/log.ts" },
      { name: "Offline verifier", does: "The page and npm run verify-bundle run the same checks.", code: "src/proof/bundle.ts" },
    ],
  },
];

/** The trust boundary after each layer but the last: what changes hands there. */
export const ARCH_BOUNDARIES: readonly string[] = [
  "Untrusted text becomes typed data that code checks.",
  "Above the limit, only a person can approve.",
  "Purser asks; Airwallex, Alta and the passkey each hold their own lock.",
  "The record leaves Purser: anyone can check it.",
];

/** The files the controls and rules name, for a test that each exists. */
export const archFiles = (): string[] => [...new Set(ARCH_LAYERS.flatMap((l) => [...l.controls.map((c) => c.code), ...(l.rules ?? []).map((r) => r.code)]))];

// The motion: one green dot runs the whole path, layer by layer and across each boundary; a red one follows half a step
// behind and stops at the signature. Each segment's dot is its own element, so a dot always runs its own layer's
// height, whatever the width; every delay is a rule here, never an inline style.
const CYCLE = 12; // seconds
const LAYER_S = 0.9, BOUNDARY_S = 0.45, RED_LAG = 0.45;
const pct = (s: number) => `${((s / CYCLE) * 100).toFixed(2)}%`;

function motionCss(): string {
  const segs: { child: number; kind: "layer" | "boundary"; start: number }[] = [];
  let t = 0;
  for (let i = 0; i < ARCH_LAYERS.length; i++) {
    segs.push({ child: 2 * i + 1, kind: "layer", start: t });
    t += LAYER_S;
    if (i < ARCH_BOUNDARIES.length) { segs.push({ child: 2 * i + 2, kind: "boundary", start: t }); t += BOUNDARY_S; }
  }
  const signAt = 2 * ARCH_LAYERS.findIndex((l) => l.refuse) + 1;
  const rules = segs.map((s) => {
    const sel = `.ar-flow > li:nth-child(${s.child})`;
    const red = s.child < signAt ? `\n${sel} > .ar-dot.r { animation-name: ar-run-${s.kind === "layer" ? "l" : "b"}; animation-delay: ${(s.start + RED_LAG).toFixed(2)}s; }`
      : s.child === signAt ? `\n${sel} > .ar-dot.r { animation-name: ar-stop; animation-delay: ${(s.start + RED_LAG).toFixed(2)}s; }` : "";
    return `${sel} > .ar-dot.g { animation-name: ar-run-${s.kind === "layer" ? "l" : "b"}; animation-delay: ${s.start.toFixed(2)}s; }${red}${s.kind === "layer" ? `\n${sel} > .ar-card { animation-name: ar-lit; animation-delay: ${s.start.toFixed(2)}s; }` : ""}`;
  }).join("\n");
  return `${rules}
@keyframes ar-run-l { 0% { top: 0; opacity: 0; } .4% { opacity: 1; } ${pct(LAYER_S)} { top: 100%; opacity: 1; } ${pct(LAYER_S + 0.02)}, 100% { top: 100%; opacity: 0; } }
@keyframes ar-run-b { 0% { top: 0; opacity: 0; } .4% { opacity: 1; } ${pct(BOUNDARY_S)} { top: 100%; opacity: 1; } ${pct(BOUNDARY_S + 0.02)}, 100% { top: 100%; opacity: 0; } }
@keyframes ar-stop { 0% { top: 0; opacity: 0; transform: scale(1); } .4% { opacity: 1; } ${pct(0.4)} { top: 30px; opacity: 1; transform: scale(1); } ${pct(0.7)} { top: 30px; transform: scale(1.7); } ${pct(1.0)} { top: 30px; transform: scale(1); } ${pct(1.3)} { top: 30px; transform: scale(1.7); opacity: 1; } ${pct(1.8)}, 100% { top: 30px; transform: scale(1); opacity: 0; } }
@keyframes ar-lit { 0% { border-color: var(--zc); outline-color: color-mix(in srgb, var(--zc) 22%, transparent); } ${pct(LAYER_S + 0.3)}, 100% { border-color: var(--ar-edge); outline-color: transparent; } }`;
}

/** The section's own rules, after the product pages' (./productPage.ts). Every text at 14 px or more. */
export const ARCH_CSS = `.ar { padding: 18px; display: grid; gap: 14px; min-width: 0; --ar-edge: var(--border); }
.ar h2.ar-h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 21px; line-height: 1.25; letter-spacing: -.015em; margin: 0; }
.ar .ar-sub { margin: 0; font-size: 15.5px; color: var(--muted); line-height: 1.5; max-width: 48em; }
.ar-key { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 15px; }
.ar-key li { display: inline-flex; align-items: center; gap: 8px; }
.ar-key i { width: 12px; height: 12px; border-radius: 50%; flex: none; } .ar-key i.g { background: var(--ok); } .ar-key i.r { background: var(--bad); }
.ar-key i.tb { width: 22px; height: 0; border-radius: 0; border-top: 2px dashed var(--accent); }
.ar-flow { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
.ar-flow > li { position: relative; padding-left: 36px; min-width: 0; }
.ar-flow > li::before { content: ""; position: absolute; left: 13px; top: 0; bottom: 0; width: 3px; border-radius: 2px; background: color-mix(in srgb, var(--accent) 35%, var(--border)); }
.ar-flow > li:first-child::before { top: 26px; } .ar-flow > li:last-child::before { bottom: auto; height: 26px; }
.ar-band { --zc: var(--accent); }
.ar-band.z-untrusted { --zc: var(--muted); } .ar-band.z-person { --zc: var(--ok); } .ar-band.z-rails { --zc: var(--text); }
.ar-card { display: grid; gap: 12px; padding: 14px 16px; border-radius: 16px; background: var(--sunken); border: 1.5px solid var(--ar-edge); outline: 3px solid transparent; box-shadow: inset 4px 0 0 var(--zc); min-width: 0; animation: none ${CYCLE}s linear infinite; }
.ar-node { position: absolute; left: 6px; top: 19px; width: 16px; height: 16px; border-radius: 50%; background: var(--surface); border: 3px solid var(--zc); z-index: 1; }
.ar-dot { position: absolute; left: 7.5px; top: 0; width: 14px; height: 14px; margin-top: -7px; border-radius: 50%; opacity: 0; z-index: 2; animation: none ${CYCLE}s linear infinite; pointer-events: none; }
.ar-dot.g { background: var(--ok); box-shadow: 0 0 0 4px var(--ok-soft); }
.ar-dot.r { background: var(--bad); box-shadow: 0 0 0 4px var(--bad-soft); }
.ar-main { display: grid; gap: 8px; align-content: start; min-width: 0; }
.ar-zone { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: var(--zc); }
.ar-band.z-untrusted .ar-zone, .ar-band.z-rails .ar-zone { color: var(--muted); }
.ar-zone .ar-ic { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; background: var(--surface); color: var(--zc); }
.ar h3 { margin: 0; font-size: 17.5px; line-height: 1.3; letter-spacing: -.01em; }
.ar .ar-line { margin: 0; font-size: 15.5px; line-height: 1.5; overflow-wrap: anywhere; }
.ar-rules { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.ar-rules a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; box-sizing: border-box; padding: 2px 12px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--text); font-size: 14.5px; font-weight: 600; text-decoration: none; }
.ar-rules a .i { color: var(--accent); }
.ar-rules a:hover { border-color: var(--accent); }
.ar-locks { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 600px) { .ar-locks { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.ar-locks a { display: grid; gap: 4px; align-content: start; height: 100%; padding: 10px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); border-top: 3px solid var(--lc); color: var(--text); text-decoration: none; }
.ar-locks a:hover { border-color: var(--lc); }
.ar-locks .awx { --lc: var(--awx); } .ar-locks .metal { --lc: var(--metal); } .ar-locks .ok { --lc: var(--ok); }
.ar-locks a .i { color: var(--lc); }
.ar-locks b { display: flex; align-items: center; gap: 6px; font-size: 15px; line-height: 1.3; }
.ar-locks span { font-size: 14px; color: var(--muted); line-height: 1.4; }
.ar-refuse { justify-self: start; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 14px; font-weight: 650; color: var(--bad); background: var(--bad-soft); }
.ar-ctl { display: grid; gap: 6px; align-content: start; min-width: 0; }
.ar-ctl > p { margin: 0; font-size: 14px; font-weight: 700; color: var(--muted); }
.ar-ctl ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.ar-ctl a { display: inline-flex; align-items: center; gap: 7px; min-height: 44px; box-sizing: border-box; padding: 0 14px 0 11px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--text); text-decoration: none; }
.ar-ctl a:hover, .ar-ctl a:focus-visible { border-color: var(--accent); }
.ar-ctl a .i { color: var(--accent); flex: none; }
.ar-ctl a b { font-size: 14.5px; font-weight: 650; line-height: 1.3; }
.ar .links { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.ar .links a.pf { min-height: 44px; }
.ar-tb { padding-top: 12px; padding-bottom: 12px; }
.ar-tb > div { position: relative; display: flex; align-items: center; }
.ar-tb > div::before { content: ""; position: absolute; left: -20px; right: 0; top: 50%; border-top: 2px dashed color-mix(in srgb, var(--accent) 55%, transparent); }
.ar-tb p { position: relative; margin: 0 0 0 10px; display: inline-flex; align-items: flex-start; gap: 6px; padding: 4px 12px; border-radius: 12px; background: var(--surface); border: 1.5px dashed color-mix(in srgb, var(--accent) 55%, transparent); font-size: 14px; line-height: 1.4; color: var(--muted); }
.ar-tb p .i { color: var(--accent); flex: none; margin-top: 1px; }
.ar-tb p b { color: var(--text); font-weight: 700; white-space: nowrap; }
@media (min-width: 900px) {
  .ar { padding: 22px 24px; }
  .ar-card { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 12px 22px; padding: 16px 18px; }
  .ar-card > .ar-main { grid-column: 1; grid-row: 1; } .ar-card > .ar-ctl { grid-column: 2; grid-row: 1; } .ar-card > .ar-locks { grid-column: 1 / -1; grid-row: 2; }
  .ar-flow > li { padding-left: 54px; }
  .ar-flow > li::before { left: 24px; } .ar-node { left: 17px; } .ar-dot { left: 18.5px; }
  .ar-tb > div::before { left: -28px; }
}
/* 21 Nov (Max: "security page is still not upgraded"; on a phone, less text): the panel in /proof's look, and under
   700 px the layers tighter. */
.ar { border-radius: 22px; background: radial-gradient(70% 60% at 50% 0%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 70%), var(--surface); }
@media (max-width: 699px) {
  .ar { padding: 16px 12px; border-radius: 18px; }
  .ar .ar-sub { font-size: 15px; }
  .ar-flow > li { padding-left: 30px; }
  .ar-flow > li::before { left: 10px; } .ar-node { left: 3px; } .ar-dot { left: 4.5px; }
  .ar-card { padding: 12px; gap: 10px; border-radius: 14px; }
  .ar h3 { font-size: 16.5px; }
  .ar .ar-line { font-size: 15px; line-height: 1.45; }
  .ar-ctl a { padding: 0 12px 0 10px; }
  .ar-tb > div::before { left: -20px; }
  .ar-tb p { margin-left: 6px; }
}
${motionCss()}
@media (prefers-reduced-motion: reduce) {
  .ar-card { animation: none !important; }
  .ar-dot { animation: none !important; display: none; }
}`;

// 21 Nov (Max: "far less text"): each control a chip, its name linked to its code; what it does is the chip's title.
const ctlHtml = (c: ArchControl) => `<li><a href="${esc(repoHref(c.code))}" target="_blank" rel="noopener" title="${esc(c.does)}">${icon("shield-check", 16)}<b>${esc(c.name)}</b></a></li>`;

function layerHtml(l: ArchLayer): string {
  const rules = l.rules ? `<ul class="ar-rules" aria-label="Purser's rules">${l.rules.map((r) => `<li><a href="${esc(repoHref(r.code))}" target="_blank" rel="noopener">${icon("check", 14)}${esc(r.name)}</a></li>`).join("")}</ul>` : "";
  const locks = l.locks ? `<ul class="ar-locks">${l.locks.map((k) => `<li class="${k.tone}"><a href="${esc(k.href)}"><b>${icon(k.icon, 16)}${esc(k.name)}</b><span>${esc(k.held)}</span></a></li>`).join("")}</ul>` : "";
  const refuse = l.refuse ? `<p class="ar-refuse">${icon("octagon-x", 15)}${esc(l.refuse)}</p>` : "";
  const links = l.links?.length ? `<div class="links">${l.links.join("")}</div>` : "";
  return `<li class="ar-band z-${l.tone}" id="${esc(l.id)}"><span class="ar-node" aria-hidden="true"></span><i class="ar-dot g" aria-hidden="true"></i><i class="ar-dot r" aria-hidden="true"></i><div class="ar-card">
      <div class="ar-main"><p class="ar-zone"><span class="ar-ic">${icon(l.icon, 16)}</span>${esc(l.zone)}</p><h3>${esc(l.title)}</h3><p class="ar-line">${esc(l.line)}</p>${rules}${refuse}${links}</div>${locks}
      <div class="ar-ctl"><p>Controls here</p><ul>${l.controls.map(ctlHtml).join("")}</ul></div>
    </div></li>`;
}

const boundaryHtml = (words: string) => `<li class="ar-tb"><i class="ar-dot g" aria-hidden="true"></i><i class="ar-dot r" aria-hidden="true"></i><div><p>${icon("lock", 15)}<span><b>Trust boundary.</b> ${esc(words)}</span></p></div></li>`;

/** The section, as markup. */
export function archHtml(): string {
  if (ARCH_BOUNDARIES.length !== ARCH_LAYERS.length - 1) throw new Error("a trust boundary between every two layers, and none after the last");
  const items = ARCH_LAYERS.flatMap((l, i) => [layerHtml(l), ...(i < ARCH_BOUNDARIES.length ? [boundaryHtml(ARCH_BOUNDARIES[i]!)] : [])]);
  return `<section class="card ar" id="arch" aria-labelledby="arch-h">
  <h2 class="ar-h" id="arch-h">How a payment is guarded<span class="pill">Schematic</span></h2>
  <p class="ar-sub">Five layers and four trust boundaries between the agent's ask and the money; each layer checks on its own, and each control links to the code that enforces it.</p>
  <ul class="ar-key"><li><i class="g"></i>Paid as signed</li><li><i class="r"></i>One cent changed after signing</li><li><i class="tb"></i>Trust boundary</li></ul>
  <ol class="ar-flow">
    ${items.join("\n    ")}
  </ol>
  <div class="links">${outLink(repoHref("docs/security.md", "#trust-boundaries"), "Trust boundaries in the threat model")}${outLink(repoHref("docs/security/SECURITY-MAPPING.md"), "Every control and its evidence")}</div>
</section>`;
}
