// /proof's evidence flow (21 Nov, the owner's new direction: "turn the dense evidence architecture into a progressive,
// interactive visualization"): the path of one payment, Invoice → checks → policy → passkey (Face ID) → one cent changed
// (the refusal, on purpose) → rail → books → independent verification, as a line of connected steps. Closed, each step is one line: who acts and its headline figure. Opened (a tap, a key, or a link to it), it shows the real evidence tiles of that step from
// docs/evidence/evidence-wall.json, each with its record, its status (sandbox, testnet, test world, re-checked, CI, …),
// its day and its note, a figure short of "all" marked as such, then the limits of that evidence in plain words and a
// link to the section of /proof that answers the question in full. Nothing here is typed in: every figure is the wall's.
// Motion: as the reader scrolls, light runs down the connector into each step it reaches (an IntersectionObserver adds
// a class; CSS draws it), and a soft pulse runs along the overview of the steps. With prefers-reduced-motion, or without
// the script, every connector is lit and nothing moves. The page's single hashed script carries FLOW_JS; no style
// attribute anywhere (the CSP).

import { TAG_WORDS, WALL_FILE, committedWall, type EvidenceWall, type WallTile } from "./evidenceWall.js";
import { tileDay } from "./proofQuestions.js";
import { esc } from "./ui.js";

export const FLOW_ID = "architecture";
export const FLOW_CAPTION = "Open a step for its evidence, status and limits. Test money; a sandbox PAID is simulated.";
export const FLOW_LIMITS_HEAD = "Limits of this evidence";
export const FLOW_PARTIAL = "Not all: read its note";

type Tone = "claude" | "ok" | "accent" | "awx" | "ink" | "bad";
export interface FlowStep {
  id: string;
  /** The step's name on its node. */
  title: string;
  /** Who acts at this step. */
  who: string;
  /** One line, the opened step's first words. */
  line: string;
  /** What happens, in the opened step. */
  does: string;
  /** The wall's tiles that prove it, in order (a key the wall does not have is skipped). */
  keys: readonly string[];
  /** The section of /proof that answers the question in full. */
  href: string;
  hrefLabel: string;
  /** What this evidence does not show, in plain words (each backed by the tiles' own notes or the records' labels). */
  limits: readonly string[];
  tone: Tone;
  /** A refusal leaves the path here: nothing moves. */
  refusal?: string;
  /** A page where the reader tries it themselves. */
  tryIt?: { label: string; href: string };
}

export const FLOW_STEPS: readonly FlowStep[] = [
  {
    id: "pf-invoice", title: "Invoice", who: "An agent, with Claude", line: "Reads the invoice and proposes what to do.",
    does: "An agent reads the supplier's invoice with Claude: who is paid, how much, when, and whether it matches an order. Claude proposes; it cannot pay.",
    keys: ["claude-main", "try-claude", "worst-case"], href: "#q-ai", hrefLabel: "Is the AI controlled?", tone: "claude",
    limits: ["The worst case puts a script that always says pay in Claude's place: it measures the rules, not the model's good behaviour.", "The long run and the walks are a test world on test money."],
  },
  {
    id: "pf-checks", title: "Checks", who: "Purser's code", line: "Code, not the model, holds what fails.",
    does: "Code checks cash on hand, duplicates, the supplier's bank details and lines planted for the AI; what fails is held for a person, whatever the model said.",
    keys: ["try-held", "hostile-model", "red-team"], href: "#pq-ai", hrefLabel: "Claude decides, code enforces", tone: "ok",
    limits: ["The red team is a full re-run of known attacks, not held out.", "Hostile tool calls that stood within the rules were let through, as the ledger shows."],
  },
  {
    id: "pf-policy", title: "Policy", who: "The CFO's limits, in code", line: "Within the limit the agent pays alone; above it, the CFO.",
    does: "Within the agent's limit the agent pays on its own; above it the payment waits for the CFO. A proposal outside the policy is refused before any money moves.",
    keys: ["alta-series-refused", "alta-refusal", "visa-refused"], href: "#pq-refused", hrefLabel: "Refused before money moved", tone: "bad",
    refusal: "Refused here: nothing moves.",
    limits: ["Refusals on chain are on Alta's testnet.", "The Visa attempts were refused by Purser before any call to Airi."],
  },
  {
    id: "pf-passkey", title: "Passkey (Face ID)", who: "The CFO", line: "Signs a hash of the exact terms.",
    does: "Above the limit, the CFO's passkey signs a hash of the exact terms: payee, amount, currency, reference. Change one cent after that, and the payment is refused.",
    keys: ["tamper-matrix", "try-hash", "passkeys-onchain", "try-sign-paid"], href: "#signed", hrefLabel: "Signatures cannot be forged", tone: "accent",
    limits: ["On the public /try a virtual test passkey signs, not a person's Face ID.", "The forged copies are checked offline, on this computer."],
  },
  {
    // The owner (Max, 21 Nov): the one-cent demo stays intact and prominent; on /proof it is a step of its own.
    id: "pf-cent", title: "One cent changed", who: "The test, on purpose", line: "Change one cent after approval: refused, and the books no longer agree.",
    does: "Change the amount by one cent after the CFO signed, and the hash no longer matches: the payment is refused before it reaches the rail. Change one cent in the books, and the balance sheet no longer balances.",
    keys: ["try-cent", "soak-negatives", "card-cent", "try-refusal"], href: "#pq-refused", hrefLabel: "Refused before money moved", tone: "bad",
    refusal: "One cent off: refused, nothing moves.", tryIt: { label: "Change one cent yourself, in the books", href: "books#cent" },
    limits: ["On the public /try a virtual test passkey signed; the walks are on test money.", "Card declines are simulated charges in the Airwallex sandbox.", "The books demo changes a cent in your browser only."],
  },
  {
    id: "pf-rail", title: "Rail", who: "Airwallex · Alta · Visa via Airi", line: "Moves the signed payment and carries its hash.",
    does: "The signed payment moves on a partner's rail, the signed hash travelling with it and read back from the partner.",
    keys: ["soak-paid", "try-transfers", "approval-hash", "two-locks", "alta-payments", "visa-airi", "late-failure", "awx-endpoints"], href: "#q-live", hrefLabel: "Is it live on the partners?", tone: "awx",
    limits: ["Sandbox and testnet, test money only: a sandbox PAID is the sandbox's simulation, not a settled payment.", "A payment can still fail after PAID; it goes back to a person."],
  },
  {
    id: "pf-books", title: "Books", who: "T:0 and the partner's statement", line: "Posted as journal entries, matched to the statement.",
    does: "Each payment is posted to the books as journal entries and matched to the partner's own statement, to the cent.",
    keys: ["t0-readback", "awx-statement", "spend-bills"], href: "#pl-t0", hrefLabel: "T:0", tone: "ink",
    limits: ["T:0's shared sandbox entity, with test data."],
  },
  {
    id: "pf-verify", title: "Independent verification", who: "Anyone", line: "Re-checks the records without trusting Purser.",
    does: "The records are in the repository: a proof file checks offline, the audit log's head is sealed on Alta, and verify-all re-checks the figures against their records.",
    keys: ["verify-all", "anchor", "alta-merkle", "try-proofs", "try-verify"], href: "#q-verify", hrefLabel: "Can I verify it myself?", tone: "ok",
    limits: ["It re-checks what is recorded in the repository; what was never recorded is outside it."],
  },
];

/** Under the path: what holds it all, built and checked. */
export const FLOW_BASE = { title: "Underneath: built and checked", keys: ["coverage", "formal-dafny", "formal-tla", "chaos-money", "ci"], href: "#q-built", hrefLabel: "Is it engineered well?" } as const;

const isExternal = (h: string) => /^https?:/.test(h);
const target = (h: string) => (isExternal(h) ? ' target="_blank" rel="noopener"' : "");
/** "66 of 67": a figure short of all, which the step marks (never hides). */
export function partial(fig: string): boolean {
  const m = /^([\d,]+) of ([\d,]+)$/.exec(fig.trim());
  return !!m && Number(m[1]!.replace(/,/g, "")) < Number(m[2]!.replace(/,/g, ""));
}

export interface PlacedStep { step: FlowStep; tiles: WallTile[] }
/** Each step with the wall's tiles it names (the tiles /proof shows, and the ones only in its folds). */
export function flowSteps(w: EvidenceWall | null = committedWall()): PlacedStep[] {
  if (!w?.groups.length) return [];
  const tiles = new Map<string, WallTile>(w.groups.flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
  return FLOW_STEPS.map((step) => ({ step, tiles: step.keys.flatMap((k) => (tiles.has(k) ? [tiles.get(k)!] : [])) }));
}

const evidence = (t: WallTile) => `<li class="pf-e${t.tone ? ` ${t.tone}` : ""}${partial(t.fig) ? " part" : ""}" data-flow="${esc(t.key)}"${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}><a href="${esc(t.href)}"${target(t.href)}><b class="pf-f">${esc(t.fig)}</b><span class="pf-l">${esc(t.label)}</span><span class="pf-k"><span class="pf-tag ${t.tag}">${esc(TAG_WORDS[t.tag])}</span>${partial(t.fig) ? `<span class="pf-part">${esc(FLOW_PARTIAL)}</span>` : ""}<time class="pf-d">${esc(tileDay(t))}</time><span class="pf-r" aria-hidden="true">${isExternal(t.href) ? "↗" : "→"}</span></span></a><small class="pf-note">${esc(t.note)}</small></li>`;

function stepHtml(p: PlacedStep, extra = ""): string {
  const s = p.step, head = p.tiles[0];
  const headline = head ? `<span class="pf-h${partial(head.fig) ? " part" : ""}" data-rec="${esc(head.rec || WALL_FILE)}"><b>${esc(head.fig)}</b> ${esc(head.label)}${partial(head.fig) ? ` <span class="pf-part">${esc(FLOW_PARTIAL)}</span>` : ""}</span>` : "";
  return `<li class="pf-step ${s.tone}${s.tryIt ? " key" : ""}">
<span class="pf-node" aria-hidden="true"><span class="pf-dot"></span><span class="pf-wire"><span class="pf-light"></span></span></span>
<details class="pf-x" id="${esc(s.id)}"><summary><span class="pf-sh"><span class="pf-n" aria-hidden="true"></span><span class="pf-t">${esc(s.title)}</span><span class="pf-who">${esc(s.who)}</span></span>${headline}</summary>
<div class="pf-body">
<p class="pf-does"><b>${esc(s.line)}</b> ${esc(s.does)}</p>
${s.refusal ? `<p class="pf-ref">${esc(s.refusal)}</p>` : ""}
<ul class="pf-ev">${p.tiles.map(evidence).join("")}</ul>
<div class="pf-lim"><h4>${esc(FLOW_LIMITS_HEAD)}</h4><ul>${s.limits.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>
${s.tryIt ? `<a class="pf-try" href="${esc(s.tryIt.href)}">${esc(s.tryIt.label)} <span aria-hidden="true">→</span></a>` : ""}
<a class="pf-more" href="${esc(s.href)}">${esc(s.hrefLabel)} <span aria-hidden="true">→</span></a>${extra}
</div></details></li>`;
}

/** The flow, or "" without the wall's file. */
export function flowHtml(w: EvidenceWall | null = committedWall()): string {
  const steps = flowSteps(w);
  if (!steps.length) return "";
  const tiles = new Map<string, WallTile>(w!.groups.flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
  const base = FLOW_BASE.keys.flatMap((k) => (tiles.has(k) ? [tiles.get(k)!] : []));
  const track = `<ol class="pf-track" aria-label="${esc("The steps of one payment")}">${steps.map((p) => `<li class="${p.step.tone}"><a href="#${esc(p.step.id)}"><span class="pf-n" aria-hidden="true"></span>${esc(p.step.title)}</a></li>`).join("")}</ol>`;
  const baseRow = base.length ? `<div class="pf-base"><p class="pf-bh"><a href="${FLOW_BASE.href}">${esc(FLOW_BASE.title)} <span aria-hidden="true">→</span></a></p><ul>${base.map((t) => `<li data-flow="${esc(t.key)}"${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}><a href="${esc(t.href)}"${target(t.href)}><b>${esc(t.fig)}</b> ${esc(t.label)}</a></li>`).join("")}</ul></div>` : "";
  return `<figure class="pflow" id="${FLOW_ID}" aria-labelledby="pf-cap" data-rec="${WALL_FILE}">
${track}
<ol class="pf-steps">
${steps.map((p, i) => stepHtml(p, i === steps.length - 1 ? baseRow : "")).join("\n")}
</ol>
<figcaption id="pf-cap">${esc(FLOW_CAPTION)}</figcaption></figure>`;
}

/**
 * The flow's script: the page is "js" (the connectors start dark), each step lit once the reader reaches it, every
 * step before it lit too; a step opened is lit. Without IntersectionObserver, or with reduced motion, all are lit.
 */
export const FLOW_JS = `
(function () {
  var f = document.querySelector("figure.pflow"); if (!f) return;
  var steps = [].slice.call(f.querySelectorAll(".pf-step"));
  var still = !("IntersectionObserver" in window) || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (still) return;
  f.classList.add("js");
  var upTo = function (i) { for (var k = 0; k <= i; k++) steps[k].classList.add("lit"); };
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { upTo(steps.indexOf(e.target)); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -35% 0px" });
  steps.forEach(function (s, i) {
    io.observe(s);
    var d = s.querySelector("details"); if (d) d.addEventListener("toggle", function () { if (d.open) upTo(i); });
  });
})();`;

export const FLOW_CSS = `
.pflow { margin: 4px 0 18px; padding: 18px 18px 14px; border: 1px solid var(--border); border-radius: 20px; background:
  radial-gradient(120% 80% at 0 0, color-mix(in srgb, var(--accent) 10%, transparent), transparent 60%),
  linear-gradient(180deg, color-mix(in srgb, var(--sunken) 50%, var(--surface)), var(--surface) 70%); counter-reset: pfn; }
.pflow .pf-step { --pc: var(--accent); --ps: var(--accent-soft); }
.pflow .claude { --pc: var(--claude); --ps: var(--claude-soft); } .pflow .ok { --pc: var(--ok); --ps: var(--ok-soft); }
.pflow .awx { --pc: var(--awx); --ps: var(--awx-soft); } .pflow .bad { --pc: var(--bad); --ps: var(--bad-soft); }
.pflow .ink { --pc: var(--text); --ps: var(--sunken); } .pflow .accent { --pc: var(--accent); --ps: var(--accent-soft); }
/* The overview: every step as a link, joined by a connector a soft light runs along. */
.pflow ol.pf-track { position: relative; list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; counter-reset: pft; }
.pflow ol.pf-track li { --pc: var(--accent); flex: none; }
.pflow ol.pf-track a { display: inline-flex; align-items: center; gap: 7px; min-height: 44px; padding: 0 12px 0 6px; border: 1px solid var(--border); border-radius: 999px; background: color-mix(in srgb, var(--surface) 80%, transparent); color: var(--text); font-size: 14px; font-weight: 650; text-decoration: none; white-space: nowrap; transition: border-color .2s, box-shadow .2s; }
.pflow ol.pf-track a:hover, .pflow ol.pf-track a:focus-visible { border-color: var(--pc); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pc) 18%, transparent); outline: none; }
.pflow ol.pf-track .pf-n::before { counter-increment: pft; content: counter(pft); }
.pflow ol.pf-track li:not(:last-child) a::after { content: "→"; margin-left: 2px; color: var(--faint); font-weight: 500; }
.pflow .pf-h .pf-part { display: inline-block; margin-top: 2px; }
.pflow .pf-n { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--ps); color: var(--pc); font-size: 13px; font-weight: 750; flex: none; font-variant-numeric: tabular-nums; }
/* The steps: a node and a wire on the left, the step's line on the right. */
.pflow ol.pf-steps { list-style: none; margin: 0; padding: 0; }
.pflow .pf-step { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 14px; }
.pflow .pf-node { position: relative; display: flex; flex-direction: column; align-items: center; }
.pflow .pf-dot { position: relative; z-index: 1; width: 14px; height: 14px; margin-top: 17px; border-radius: 50%; background: var(--surface); border: 3px solid var(--pc); box-shadow: 0 0 0 4px color-mix(in srgb, var(--pc) 14%, transparent); transition: box-shadow .5s, background .5s; }
.pflow .pf-wire { position: relative; flex: 1; width: 2px; margin: 4px 0 -17px; background: var(--border); overflow: hidden; border-radius: 2px; }
.pflow .pf-step:last-child .pf-wire { display: none; }
.pflow .pf-light { position: absolute; inset: 0; background: linear-gradient(180deg, var(--pc), color-mix(in srgb, var(--pc) 30%, var(--accent))); transform-origin: top; }
.pflow.js .pf-light { transform: scaleY(0); transition: transform .9s cubic-bezier(.3,.7,.2,1) .15s; }
.pflow.js .pf-step.lit .pf-light { transform: scaleY(1); }
.pflow.js .pf-dot { background: var(--surface); box-shadow: none; }
.pflow.js .pf-step.lit .pf-dot { background: var(--pc); box-shadow: 0 0 0 5px color-mix(in srgb, var(--pc) 20%, transparent), 0 0 18px color-mix(in srgb, var(--pc) 45%, transparent); }
.pflow details.pf-x { margin: 0 0 8px; border: 1px solid var(--border); border-radius: 14px; background: color-mix(in srgb, var(--surface) 88%, transparent); transition: border-color .2s, box-shadow .2s; scroll-margin-top: 130px; }
.pflow details.pf-x:hover, .pflow details.pf-x[open] { border-color: color-mix(in srgb, var(--pc) 55%, var(--border)); }
.pflow details.pf-x[open] { box-shadow: 0 12px 32px -18px color-mix(in srgb, var(--pc) 55%, transparent); }
.pflow details.pf-x > summary { cursor: pointer; list-style: none; display: grid; gap: 2px 12px; grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 44px; padding: 10px 40px 10px 14px; position: relative; }
.pflow details.pf-x > summary::-webkit-details-marker { display: none; }
.pflow details.pf-x > summary::after { content: "▾"; position: absolute; right: 14px; top: 14px; color: var(--pc); font-size: 15px; transition: transform .2s; }
.pflow details.pf-x[open] > summary::after { transform: rotate(180deg); }
.pflow details.pf-x > summary:focus-visible { outline: 2px solid var(--pc); outline-offset: 2px; border-radius: 14px; }
.pflow .pf-sh { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; min-width: 0; }
.pflow .pf-sh .pf-n { display: none; }
.pflow .pf-t { font-size: 17px; font-weight: 750; letter-spacing: -.01em; color: var(--text); }
.pflow .pf-t::before { counter-increment: pfn; content: counter(pfn) "  ·  "; color: var(--pc); font-variant-numeric: tabular-nums; font-weight: 700; }
.pflow .pf-who { font-size: 12.5px; font-weight: 650; color: var(--pc); text-transform: uppercase; letter-spacing: .05em; }
.pflow .pf-h { grid-column: 2; grid-row: 1; justify-self: end; max-width: 19em; text-align: right; font-size: 12.5px; line-height: 1.3; color: var(--muted); }
.pflow .pf-h b { display: block; font-size: 20px; font-weight: 780; letter-spacing: -.02em; color: var(--pc); font-variant-numeric: tabular-nums; }
.pflow .pf-body { padding: 2px 14px 14px; display: grid; gap: 12px; animation: pf-in .35s ease-out both; }
@keyframes pf-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.pflow .pf-does { margin: 0; font-size: 15px; line-height: 1.5; max-width: 60em; }
.pflow .pf-ref { margin: 0; justify-self: start; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; border: 1px dashed var(--bad); background: var(--bad-soft); color: var(--bad); font-size: 13.5px; font-weight: 700; }
.pflow ul.pf-ev { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.pflow li.pf-e { --pc: var(--accent); display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pflow li.pf-e.awx { --pc: var(--awx); } .pflow li.pf-e.metal { --pc: var(--metal); } .pflow li.pf-e.claude { --pc: var(--claude); } .pflow li.pf-e.ok { --pc: var(--ok); }
.pflow li.pf-e a { display: flex; flex-direction: column; gap: 2px; min-height: 44px; padding: 10px 12px 8px; border: 1px solid var(--border); border-left: 3px solid var(--pc); border-radius: 10px; background: var(--surface); color: inherit; text-decoration: none; }
.pflow li.pf-e a:hover, .pflow li.pf-e a:focus-visible { border-color: var(--pc); }
.pflow .pf-f { font-size: 22px; font-weight: 780; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; color: var(--text); }
.pflow .pf-l { font-size: 13.5px; line-height: 1.35; color: var(--text); }
.pflow .pf-k { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 4px; }
.pflow .pf-tag, .pflow .pf-part { font-size: 11.5px; font-weight: 650; padding: 1px 7px; border-radius: 999px; background: var(--sunken); color: var(--muted); white-space: nowrap; }
.pflow .pf-tag.sandbox, .pflow .pf-tag.testnet { background: var(--ok-soft); color: var(--ok); }
.pflow .pf-part { background: var(--bad-soft); color: var(--bad); }
.pflow li.pf-e.part a { border-left-style: dashed; }
.pflow .pf-d { font-size: 12px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; margin-right: auto; }
.pflow .pf-r { color: var(--pc); font-weight: 700; }
.pflow .pf-note { font-size: 12.5px; line-height: 1.4; color: var(--muted); padding: 0 2px; overflow-wrap: anywhere; }
.pflow .pf-lim { padding: 10px 12px; border-radius: 10px; background: var(--sunken); }
.pflow .pf-lim h4 { margin: 0 0 4px; font-size: 12.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.pflow .pf-lim ul { margin: 0; padding-left: 18px; display: grid; gap: 2px; font-size: 13.5px; line-height: 1.45; color: var(--text); }
.pflow a.pf-try { justify-self: start; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--bad); background: var(--bad-soft); color: var(--bad); font-weight: 700; font-size: 14.5px; text-decoration: none; }
.pflow a.pf-try:hover, .pflow a.pf-try:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--bad) 20%, transparent); outline: none; }
/* The one-cent step stands out on the path (Max, 21 Nov): its border and its dot in the refusal's colour, always. */
.pflow .pf-step.key details.pf-x { border-color: color-mix(in srgb, var(--bad) 45%, var(--border)); background: linear-gradient(90deg, color-mix(in srgb, var(--bad-soft) 70%, var(--surface)), var(--surface) 60%); }
.pflow a.pf-more { justify-self: start; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; color: var(--accent); font-weight: 650; font-size: 14.5px; text-decoration: none; }
.pflow a.pf-more:hover { text-decoration: underline; }
/* Underneath: one quiet row. */
.pflow .pf-base { margin: 0; padding: 10px 0 0; border-top: 1px dashed var(--border); }
.pflow .pf-bh { margin: 0; } .pflow .pf-bh a { display: inline-flex; align-items: center; min-height: 44px; color: var(--text); font-weight: 700; font-size: 14.5px; text-decoration: none; }
.pflow .pf-base ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.pflow .pf-base li a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted); font-size: 13px; text-decoration: none; }
.pflow .pf-base li a b { color: var(--text); font-variant-numeric: tabular-nums; }
.pflow .pf-base li a:hover, .pflow .pf-base li a:focus-visible { border-color: var(--accent); color: var(--text); }
.pflow figcaption { margin: 10px 0 0; font-size: 13.5px; line-height: 1.45; color: var(--muted); }
@media (max-width: 760px) {
  .pflow { padding: 14px 12px 12px; border-radius: 16px; }
  .pflow ol.pf-track { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin-right: -12px; padding-right: 12px; }
  .pflow ol.pf-track::-webkit-scrollbar { display: none; }
  .pflow .pf-step { grid-template-columns: 18px minmax(0, 1fr); column-gap: 10px; }
  .pflow details.pf-x > summary { grid-template-columns: minmax(0, 1fr); padding: 10px 34px 10px 12px; }
  .pflow .pf-h { grid-column: 1; grid-row: auto; justify-self: start; text-align: left; max-width: none; }
  .pflow .pf-h b { display: inline; font-size: 16px; }
  .pflow ul.pf-ev { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: no-preference) {
  .pflow ol.pf-track li a { animation: pf-pulse 9.6s ease-in-out infinite; }
  .pflow ol.pf-track li:nth-child(2) a { animation-delay: 1.2s; } .pflow ol.pf-track li:nth-child(3) a { animation-delay: 2.4s; }
  .pflow ol.pf-track li:nth-child(4) a { animation-delay: 3.6s; } .pflow ol.pf-track li:nth-child(5) a { animation-delay: 4.8s; }
  .pflow ol.pf-track li:nth-child(6) a { animation-delay: 6s; } .pflow ol.pf-track li:nth-child(7) a { animation-delay: 7.2s; }
  .pflow ol.pf-track li:nth-child(8) a { animation-delay: 8.4s; }
}
@keyframes pf-pulse { 0%, 3% { border-color: var(--border); } 7%, 13% { border-color: var(--pc); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pc) 16%, transparent); } 18%, 100% { border-color: var(--border); box-shadow: none; } }
@media (prefers-reduced-motion: reduce) { .pflow *, .pflow *::before, .pflow *::after { animation: none !important; transition: none !important; } }
`;
