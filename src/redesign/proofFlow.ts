// /proof's stages (Max, 21 Nov, his mockup: a tab strip of the eight stages, the stages as a list on the left, each with
// its one line and its figure as a chip, and the chosen stage's panel on the right: what was verified, and four links,
// Open run, View logs, See code, Verify yourself). The path of one payment: Invoice → checks → policy → passkey (Face
// ID) → one cent changed (the refusal, on purpose) → rail → books → independent verification. Every figure is a tile of
// docs/evidence/evidence-wall.json, drawn as the wall has it, with its record: nothing typed in. Each link goes to a
// record (the step's own run record, a JSON file on GitHub), a log (the run's Markdown log), a source file on GitHub, or
// /verify. The script makes the strip and the list choose the panel (one in sight, the rest hidden); without it, every
// panel is a target of its link and the first stands until one is chosen (CSS :target). With reduced motion nothing
// moves. No style attribute anywhere (the CSP). (Until 21 Nov the same steps were a column of closed folds, the
// "evidence flow"; the architecture drawing is src/redesign/proofArch.ts.)

import { TAG_WORDS, WALL_FILE, committedWall, type EvidenceWall, type WallTile } from "./evidenceWall.js";
import { tileDay } from "./proofQuestions.js";
import { REPO_BLOB } from "./metalStory.js";
import { latestVerificationReport } from "./proofRuns.js";
import { picon } from "./proofIcons.js";
import { esc } from "./ui.js";
import { existsSync } from "node:fs";

export const FLOW_ID = "stages";
export const FLOW_CAPTION = "Choose a stage for what was verified and where to check it. Test money; a sandbox PAID is simulated.";
export const FLOW_LIMITS_HEAD = "Limits of this evidence";
export const FLOW_PROVES_HEAD = "What it proves";
export const FLOW_NOT_PROVED_HEAD = "What it does not prove";
/** What is not finished yet (the review, 21 Nov: a visible link; the anchor is /security's until its own section lands). */
export const FLOW_NOT_FINISHED = { label: "What is not finished", href: "security#not-finished" } as const;
export const FLOW_VERIFIED_HEAD = "What was verified";
export const FLOW_LINKS = { run: "Open run", log: "View logs", code: "See code", verify: "Verify yourself" } as const;
export const VERIFY_PAGE = "verify";

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
  /** What the evidence proves, said before its limits (the one-cent step). */
  proves?: readonly string[];
  /** A page where the reader tries it themselves. */
  tryIt?: { label: string; href: string };
  /** Its icon (src/redesign/proofIcons.ts). */
  icon: string;
  /** The source file that does this step, in this repository. */
  code: string;
}

export const FLOW_STEPS: readonly FlowStep[] = [
  {
    id: "pf-invoice", title: "Invoice", who: "An agent, with Claude", line: "Reads the invoice and proposes what to do.",
    does: "An agent reads the supplier's invoice with Claude: who is paid, how much, when, and whether it matches an order. Claude proposes; it cannot pay.",
    keys: ["claude-main", "try-claude", "worst-case"], href: "#q-ai", hrefLabel: "AI and evals", tone: "claude", icon: "file-text", code: "src/ap/read.ts",
    limits: ["The worst case puts a script that always says pay in Claude's place: it measures the rules, not the model's good behaviour.", "The long run and the walks are a test world on test money."],
  },
  {
    id: "pf-checks", title: "Checks", who: "Purser's code", line: "Code, not the model, holds what fails.",
    does: "Code checks cash on hand, duplicates, the supplier's bank details and lines planted for the AI; what fails is held for a person, whatever the model said.",
    keys: ["try-held", "hostile-model", "red-team"], href: "#pq-ai", hrefLabel: "AI and evals", tone: "ok", icon: "circle-check", code: "src/ap/checks.ts",
    limits: ["The red team is our own scripted attacks, re-run in full: internal and not held out, not an independent penetration test.", "Hostile tool calls that stood within the rules were let through, as the ledger shows."],
  },
  {
    id: "pf-policy", title: "Policy", who: "The CFO's limits, in code", line: "Within the limit the agent pays alone; above it, the CFO.",
    does: "Within the agent's limit the agent pays on its own; above it the payment waits for the CFO. A proposal outside the policy is refused before any money moves.",
    keys: ["alta-series-refused", "alta-refusal", "visa-refused"], href: "#pq-refused", hrefLabel: "Policy and limits", tone: "bad", icon: "shield", code: "src/policy/withinLimit.ts",
    refusal: "Refused here: nothing moves.",
    limits: ["Refusals on chain are on Alta's testnet.", "The Visa attempts were refused by Purser before any call to Airi."],
  },
  {
    id: "pf-passkey", title: "Passkey (Face ID)", who: "The CFO", line: "Signs a hash of the exact terms.",
    does: "Above the limit, the CFO's passkey signs a hash of the exact terms: payee, amount, currency, reference. Change one cent after that, and the payment is refused.",
    keys: ["tamper-matrix", "try-hash", "passkeys-onchain", "try-sign-paid"], href: "#signed", hrefLabel: "Approvals and passkeys", tone: "accent", icon: "scan-face", code: "src/policy/signedApproval.ts",
    limits: ["On the public /try a virtual test passkey signs, not a person's Face ID.", "The forged copies are checked offline, on this computer."],
  },
  {
    // The owner (Max, 21 Nov): the one-cent demo stays intact and prominent; on /proof it is a step of its own.
    id: "pf-cent", title: "One cent changed", who: "The test, on purpose", line: "Change one cent after approval: refused, and the books no longer agree.",
    does: "Change the amount by one cent after the CFO signed, and the hash no longer matches: the payment is refused before it reaches the rail. Change one cent in the books, and the balance sheet no longer balances.",
    keys: ["try-cent", "soak-negatives", "card-cent", "try-refusal"], href: "#pq-cent", hrefLabel: "One cent changed after approval", tone: "bad", icon: "cent", code: "src/policy/hashFirst.ts",
    refusal: "One cent off: refused, nothing moves.", tryIt: { label: "Change one cent yourself, in the books", href: "books#cent" },
    proves: ["Terms changed after the signature are refused before any money-moving call: the signed hash no longer matches.", "Books changed by a cent no longer balance, and the check says where."],
    limits: ["It does not prove the first terms were right: the CFO signed what was shown.", "On the public /try a virtual test passkey signed; the walks are on test money.", "Card declines are simulated charges in the Airwallex sandbox.", "The books demo changes a cent in your browser only."],
  },
  {
    id: "pf-rail", title: "Rail", who: "Airwallex · Alta · Visa via Airi", line: "Moves the signed payment and carries its hash.",
    does: "The signed payment moves on a partner's rail, the signed hash travelling with it and read back from the partner.",
    keys: ["soak-paid", "try-transfers", "approval-hash", "two-locks", "alta-payments", "visa-airi", "late-failure", "awx-endpoints"], href: "#q-live", hrefLabel: "Payments and rails", tone: "awx", icon: "arrow-left-right", code: "src/airwallex/adapter.ts",
    limits: ["Sandbox and testnet, test money only: a sandbox PAID is the sandbox's simulation, not a settled payment.", "A payment can still fail after PAID; it goes back to a person."],
  },
  {
    id: "pf-books", title: "Books", who: "T:0 and the partner's statement", line: "Posted as journal entries, matched to the statement.",
    does: "Each payment is posted to the books as journal entries and matched to the partner's own statement, to the cent.",
    keys: ["t0-readback", "awx-statement", "spend-bills"], href: "#q-books", hrefLabel: "Books and T:0", tone: "ink", icon: "book-open", code: "src/accounting/t0Readback.ts",
    limits: ["T:0's shared sandbox entity, with test data."],
  },
  {
    id: "pf-verify", title: "Independent verification", who: "Anyone", line: "Re-checks the records without trusting Purser.",
    does: "The records are in the repository: a proof file checks offline, the audit log's head is sealed on Alta, and verify-all re-checks the figures against their records.",
    keys: ["verify-all", "anchor", "alta-merkle", "try-proofs", "try-verify"], href: "#q-verify", hrefLabel: "Verify it yourself", tone: "ok", icon: "badge-check", code: "src/cli/verifyAll.ts",
    limits: ["It re-checks what is recorded in the repository; what was never recorded is outside it."],
  },
];


const isExternal = (h: string) => /^https?:/.test(h);
const target = (h: string) => (isExternal(h) ? ' target="_blank" rel="noopener"' : "");
/** "65 of 67": a figure short of all (said as the wall says it, its note beside it; never hidden, never called a failure). */
export function partial(fig: string): boolean {
  const m = /^([\d,]+) of ([\d,]+)$/.exec(fig.trim());
  return !!m && Number(m[1]!.replace(/,/g, "")) < Number(m[2]!.replace(/,/g, ""));
}
/** A figure that is all of its whole ("All 60", "Both"): its chip is green. */
export const whole = (fig: string): boolean => /^(?:All [\d,]+|Both)$/.test(fig.trim());

export interface PlacedStep { step: FlowStep; tiles: WallTile[] }
/** Each step with the wall's tiles it names (the tiles /proof shows, and the ones only in its folds). */
export function flowSteps(w: EvidenceWall | null = committedWall()): PlacedStep[] {
  if (!w?.groups.length) return [];
  const tiles = new Map<string, WallTile>(w.groups.flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
  return FLOW_STEPS.map((step) => ({ step, tiles: step.keys.flatMap((k) => (tiles.has(k) ? [tiles.get(k)!] : [])) }));
}

/**
 * A tile's link, to its record: a tile whose link is the folder of every run (docs/runs) links its newest record's
 * file instead (the review, 21 Nov: "link the summary.json records"); any other link as the wall has it.
 */
export function recordHref(t: WallTile): string {
  if (!/\/tree\/main\/docs\/runs\/?$/.test(t.href)) return t.href;
  const recs = t.rec.split(/\s+/).filter((r) => /^docs\/runs\/.+\.(json|md)$/.test(r)).sort();
  return recs.length ? t.href.replace(/\/tree\/main\/docs\/runs\/?$/, `/blob/main/${recs.at(-1)!}`) : t.href;
}

const has = (p: string) => existsSync(new URL(`../../${p}`, import.meta.url));
/** A stage's four links: its run record (the newest JSON its head tile names), the run's log, its source file, /verify. */
export interface StageLinks { run: string; log: string; code: string; verify: string }
export function stageLinks(p: PlacedStep): StageLinks {
  const head = p.tiles[0];
  const recs = (head?.rec ?? "").split(/\s+/).filter(Boolean);
  const json = recs.filter((r) => /\.json$/.test(r) && has(r)).sort().at(-1);
  // The log: the head tile's own Markdown link, else a Markdown record it names, else the Markdown beside its newest
  // JSON record (docs/runs/X/summary.json → docs/runs/X.md, docs/runs/X.json → docs/runs/X.md); the verify step's,
  // the newest verify-all report.
  const mdOf = (r: string) => r.replace(/\/summary\.json$/, ".md").replace(/\.json$/, ".md");
  const hrefMd = head && head.href.startsWith(REPO_BLOB) && /\.md$/.test(head.href) ? head.href.slice(REPO_BLOB.length) : null;
  const vr = p.step.id === "pf-verify" ? latestVerificationReport() : null;
  const log = [vr ? mdOf(vr) : null, hrefMd, ...recs.filter((r) => /\.md$/.test(r)), ...recs.filter((r) => /\.json$/.test(r)).sort().reverse().map(mdOf)].find((r): r is string => !!r && has(r));
  return {
    run: json ? `${REPO_BLOB}${json}` : head ? recordHref(head) : `${REPO_BLOB}${WALL_FILE}`,
    log: log ? `${REPO_BLOB}${log}` : head ? recordHref(head) : `${REPO_BLOB}${WALL_FILE}`,
    code: `${REPO_BLOB}${p.step.code}`,
    verify: VERIFY_PAGE,
  };
}

/** A line of "What was verified": the tile's figure and words, its tag and day, a link to its record. */
const check = (t: WallTile) => {
  const stopped = /(?:^|[.;] )(\d[\d,]* walks? stopped before (?:that|this) step\.)/.exec(t.note)?.[1];
  return `<li class="pp-c${t.tone ? ` ${t.tone}` : ""}" data-flow="${esc(t.key)}" data-rec="${esc(t.rec || WALL_FILE)}"><a href="${esc(recordHref(t))}" title="${esc(t.note)}"${target(t.href)}><span class="pp-ck" aria-hidden="true">${picon("check", 14)}</span><span class="pp-ct"><span><b class="pf-f">${esc(t.fig)}</b> ${esc(t.label)}</span>${stopped ? `<small class="pp-st">${esc(stopped)}</small>` : ""}<span class="pp-k"><span class="pf-tag ${t.tag}">${esc(TAG_WORDS[t.tag])}</span><time>${esc(tileDay(t))}</time></span></span><span class="pp-r" aria-hidden="true">${isExternal(t.href) ? "↗" : "→"}</span></a></li>`;
};
const SHOWN = 4;

function panelHtml(p: PlacedStep): string {
  const s = p.step, l = stageLinks(p);
  const btn = (k: keyof StageLinks, ic: string) => `<a class="pp-b" href="${esc(l[k])}"${target(l[k])}>${picon(ic, 18)}<span>${esc(FLOW_LINKS[k])}</span><span class="pp-r" aria-hidden="true">${isExternal(l[k]) ? "↗" : "→"}</span></a>`;
  const first = p.tiles.slice(0, SHOWN), rest = p.tiles.slice(SHOWN);
  return `<article class="ps-panel ${s.tone}${s.tryIt ? " key" : ""}" id="${esc(s.id)}" role="tabpanel" aria-labelledby="pt-${esc(s.id)}">
<div class="pp-h"><span class="pp-ic" aria-hidden="true">${picon(s.icon, 26)}</span><div><h3>${esc(s.title)}</h3><p class="pp-n">${esc(s.who)}</p></div></div>
<p class="pp-does">${esc(s.does)}</p>
${s.refusal ? `<p class="pf-ref">${picon("ban", 14)}${esc(s.refusal)}</p>` : ""}
<h4>${esc(FLOW_VERIFIED_HEAD)}</h4>
<ul class="pp-ok">${first.map(check).join("")}</ul>
${rest.length ? `<details class="pp-more"><summary>${esc("More evidence for this stage")}</summary><ul class="pp-ok">${rest.map(check).join("")}</ul></details>` : ""}
<div class="pp-btns">${btn("run", "external-link")}${btn("log", "file-text")}${btn("code", "code")}${btn("verify", "shield-check")}</div>
${s.tryIt ? `<a class="pf-try" href="${esc(s.tryIt.href)}">${esc(s.tryIt.label)} <span aria-hidden="true">→</span></a>` : ""}
<details class="pp-lim"><summary>${esc(s.proves ? "What it proves, and what it does not" : FLOW_LIMITS_HEAD)}</summary>
${s.proves ? `<div class="pf-lim pf-pro"><h4>${esc(FLOW_PROVES_HEAD)}</h4><ul>${s.proves.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
<div class="pf-lim"><h4>${esc(s.proves ? FLOW_NOT_PROVED_HEAD : FLOW_LIMITS_HEAD)}</h4><ul>${s.limits.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
</details>
<a class="pf-more" href="${esc(s.href)}">${esc(s.hrefLabel)} <span aria-hidden="true">→</span></a>
</article>`;
}

/** The stages: the strip, the list, the panels; or "" without the wall's file. */
export function flowHtml(w: EvidenceWall | null = committedWall()): string {
  const steps = flowSteps(w);
  if (!steps.length) return "";
  const first = steps[0]!.step.id;
  const tab = (p: PlacedStep) => `<a role="tab" class="${p.step.tone}" id="pt-${esc(p.step.id)}" href="#${esc(p.step.id)}" aria-controls="${esc(p.step.id)}" aria-selected="${p.step.id === first}"${p.step.id === first ? "" : ' tabindex="-1"'}><span class="ps-n" aria-hidden="true"></span>${esc(p.step.title)}</a>`;
  const row = (p: PlacedStep) => {
    const h = p.tiles[0];
    return `<li class="ps-row ${p.step.tone}${p.step.id === first ? " on" : ""}"><a href="#${esc(p.step.id)}" data-stage="${esc(p.step.id)}"><span class="ps-dot" aria-hidden="true"></span><span class="ps-t"><span class="ps-n" aria-hidden="true"></span>${esc(p.step.title)}</span>${h ? `<span class="ps-line">${esc(h.label.charAt(0).toUpperCase() + h.label.slice(1))}</span><span class="ps-chip${whole(h.fig) ? " all" : ""}" data-rec="${esc(h.rec || WALL_FILE)}">${esc(h.fig)}</span>` : ""}</a></li>`;
  };
  return `<section class="pstage" id="${FLOW_ID}" aria-labelledby="ps-h" data-rec="${WALL_FILE}">
<h2 class="vh" id="ps-h">${esc("The stages of one payment")}</h2>
<div class="ps-tabs" role="tablist" aria-label="${esc("The stages of one payment")}">${steps.map(tab).join("")}</div>
<div class="ps-body">
<ol class="ps-list">${steps.map(row).join("")}</ol>
<div class="ps-panels">
${steps.map(panelHtml).join("\n")}
</div>
</div>
<p class="ps-cap">${esc(FLOW_CAPTION)} <a class="pf-nf" href="${FLOW_NOT_FINISHED.href}">${esc(FLOW_NOT_FINISHED.label)} <span aria-hidden="true">→</span></a></p>
</section>`;
}

/**
 * The stages' script: the strip and the list choose the panel in sight (a click, the arrow keys on the strip, or a link
 * to a stage's id); the address keeps the stage without a jump. On a narrow screen a row of the list brings its panel
 * into view. Without the script, CSS :target does the same.
 */
export const FLOW_JS = `
(function () {
  var root = document.querySelector("section.pstage"); if (!root) return;
  var tabs = [].slice.call(root.querySelectorAll('[role="tab"]')), rows = [].slice.call(root.querySelectorAll(".ps-row > a")), panels = [].slice.call(root.querySelectorAll(".ps-panel"));
  if (!panels.length) return;
  root.classList.add("js");
  var ids = panels.map(function (p) { return p.id; });
  function pick(id) {
    panels.forEach(function (p) { var on = p.id === id; p.hidden = !on; p.classList.toggle("on", on); });
    tabs.forEach(function (t) { var on = t.getAttribute("aria-controls") === id; t.setAttribute("aria-selected", on ? "true" : "false"); t.tabIndex = on ? 0 : -1; });
    rows.forEach(function (r) { r.parentElement.classList.toggle("on", r.getAttribute("data-stage") === id); r.setAttribute("aria-current", r.getAttribute("data-stage") === id ? "step" : "false"); });
  }
  var fromHash = function () { var h = location.hash.slice(1); return ids.indexOf(h) >= 0 ? h : null; };
  pick(fromHash() || ids[0]);
  var go = function (id, el) {
    pick(id);
    if (history.replaceState) history.replaceState(null, "", "#" + id);
    if (el && el.closest(".ps-list") && matchMedia("(max-width: 899px)").matches) {
      var p = document.getElementById(id), still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      p.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    }
  };
  tabs.concat(rows).forEach(function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); go(a.getAttribute("aria-controls") || a.getAttribute("data-stage"), a); });
  });
  root.querySelector('[role="tablist"]').addEventListener("keydown", function (e) {
    var i = tabs.indexOf(document.activeElement); if (i < 0) return;
    var j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -2;
    if (j === -2) return;
    e.preventDefault(); j = (j + tabs.length) % tabs.length; tabs[j].focus(); go(tabs[j].getAttribute("aria-controls"), tabs[j]);
  });
  addEventListener("hashchange", function () { var h = fromHash(); if (h) pick(h); });
})();`;

/** "Stage 3 of 8" under a panel's name, from the stages' own order (CSS, not a figure in the page). */
const stageOf = FLOW_STEPS.map((s, i) => `.ps-panel#${s.id} .pp-n::before { content: "Stage ${i + 1} of ${FLOW_STEPS.length} · "; }`).join("\n");

export const FLOW_CSS = `
.pstage { --pc: var(--accent); --ps: var(--accent-soft); margin: 6px 0 22px; }
.pstage .claude { --pc: var(--claude); --ps: var(--claude-soft); } .pstage .ok { --pc: var(--ok); --ps: var(--ok-soft); }
.pstage .awx { --pc: var(--awx); --ps: var(--awx-soft); } .pstage .bad { --pc: var(--bad); --ps: var(--bad-soft); }
.pstage .ink { --pc: var(--text); --ps: var(--sunken); } .pstage .accent { --pc: var(--accent); --ps: var(--accent-soft); }
/* The strip: eight pills in one rounded bar; the chosen one filled. */
.ps-tabs { display: flex; gap: 4px; padding: 6px; margin: 0 0 14px; border: 1px solid var(--border); border-radius: 18px; background: color-mix(in srgb, var(--surface) 80%, transparent); overflow-x: auto; scrollbar-width: none; counter-reset: pst; }
.ps-tabs::-webkit-scrollbar { display: none; }
.ps-tabs a { flex: 1 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 14px 0 8px; border-radius: 12px; color: var(--text); font-size: 14.5px; font-weight: 600; text-decoration: none; white-space: nowrap; transition: background .2s, color .2s; }
.ps-tabs a:hover { background: var(--sunken); }
.ps-tabs a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.ps-tabs .ps-n::before { counter-increment: pst; content: counter(pst); }
.pstage .ps-n { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--sunken); color: var(--muted); font-size: 12.5px; font-weight: 750; flex: none; font-variant-numeric: tabular-nums; }
.ps-tabs a[aria-selected="true"] { background: var(--btn-bg, var(--accent)); color: var(--btn-ink, #fff); box-shadow: 0 6px 22px -10px var(--glow, var(--accent)); }
.ps-tabs a[aria-selected="true"] .ps-n { background: color-mix(in srgb, var(--btn-ink, #fff) 16%, transparent); color: inherit; }
/* The body: the list on the left, the panel on the right. */
.ps-body { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; align-items: start; }
ol.ps-list { position: relative; list-style: none; margin: 0; padding: 10px 12px 10px 40px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); counter-reset: psl; display: grid; gap: 6px; }
ol.ps-list::before { content: ""; position: absolute; left: 21px; top: 34px; bottom: 34px; width: 2px; border-radius: 2px; background: linear-gradient(180deg, var(--border), color-mix(in srgb, var(--accent) 40%, var(--border)), var(--border)); }
.ps-row { position: relative; }
.ps-row > a { display: grid; grid-template-columns: 14.5em minmax(0, 1fr) auto; align-items: center; gap: 4px 16px; min-height: 52px; padding: 8px 12px 8px 14px; border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 14px; background: color-mix(in srgb, var(--sunken) 40%, var(--surface)); color: inherit; text-decoration: none; transition: border-color .2s, background .2s; }
.ps-row > a:hover { border-color: color-mix(in srgb, var(--pc) 45%, var(--border)); }
.ps-row > a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ps-row.on > a { border-color: var(--accent); background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 16%, var(--surface)), color-mix(in srgb, var(--accent) 6%, var(--surface))); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent); }
.ps-dot { position: absolute; left: -24px; top: 50%; width: 12px; height: 12px; margin-top: -6px; border-radius: 50%; background: var(--surface); border: 2px solid color-mix(in srgb, var(--muted) 70%, transparent); transition: all .3s; }
.ps-row.on .ps-dot { left: -26px; width: 16px; height: 16px; margin-top: -8px; background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 22%, transparent), 0 0 18px color-mix(in srgb, var(--accent) 60%, transparent); }
.ps-t { display: inline-flex; align-items: center; gap: 8px; font-size: 16.5px; font-weight: 740; letter-spacing: -.01em; white-space: nowrap; }
.ps-list .ps-n { background: transparent; width: auto; height: auto; color: var(--muted); font-size: 15px; }
.ps-list .ps-n::before { counter-increment: psl; content: counter(psl) "."; }
.ps-line { font-size: 14px; line-height: 1.35; color: var(--muted); min-width: 0; }
.ps-chip { justify-self: end; font-size: 16.5px; font-weight: 780; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; padding: 4px 12px; border-radius: 10px; background: var(--sunken); color: var(--text); }
.ps-chip.all { background: var(--ok-soft); color: var(--ok); }
/* The panel: the chosen stage, what was verified, the four links. */
.ps-panels { position: sticky; top: 84px; }
.ps-panel { display: none; flex-direction: column; gap: 12px; padding: 20px; border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border)); border-radius: 22px; scroll-margin-top: 90px;
  background: radial-gradient(90% 60% at 100% 0%, color-mix(in srgb, var(--pc) 16%, transparent), transparent 70%), var(--surface); box-shadow: 0 24px 60px -36px var(--glow, color-mix(in srgb, var(--accent) 50%, transparent)); }
.ps-panel:first-child, .ps-panel:target { display: flex; }
.ps-panels:has(> .ps-panel:target) > .ps-panel:first-child:not(:target) { display: none; }
.pstage.js .ps-panel { display: none; } .pstage.js .ps-panel.on { display: flex; }
@media (prefers-reduced-motion: no-preference) { .pstage.js .ps-panel.on { animation: pp-in .35s ease-out both; } }
@keyframes pp-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.pp-h { display: flex; align-items: center; gap: 14px; }
.pp-ic { flex: none; display: grid; place-items: center; width: 56px; height: 56px; border-radius: 16px; background: var(--ps); color: var(--pc); }
.pp-h h3 { margin: 0; font-size: 24px; font-weight: 780; letter-spacing: -.02em; }
.pp-n { margin: 2px 0 0; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
${stageOf}
.pp-does { margin: 0; font-size: 15px; line-height: 1.55; }
.ps-panel h4 { margin: 4px 0 0; font-size: 16px; font-weight: 740; }
ul.pp-ok { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.pp-c > a { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: start; gap: 10px; min-height: 44px; padding: 7px 8px; border-radius: 10px; color: inherit; text-decoration: none; }
.pp-c > a:hover, .pp-c > a:focus-visible { background: var(--sunken); }
.pp-ck { display: grid; place-items: center; width: 22px; height: 22px; margin-top: 1px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); }
.pp-ct { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 14.5px; line-height: 1.4; }
.pp-ct .pf-f { font-weight: 760; font-variant-numeric: tabular-nums; }
.pp-st { font-size: 12.5px; color: var(--muted); }
.pp-k { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 12px; color: var(--muted); }
.pstage .pf-tag { font-size: 11.5px; font-weight: 650; padding: 1px 7px; border-radius: 999px; background: var(--sunken); color: var(--muted); white-space: nowrap; }
.pstage .pf-tag.sandbox, .pstage .pf-tag.testnet { background: var(--ok-soft); color: var(--ok); }
.pp-r { color: var(--accent); font-weight: 700; }
details.pp-more > summary, details.pp-lim > summary { cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-size: 14px; font-weight: 650; color: var(--accent); }
details.pp-more > summary::-webkit-details-marker, details.pp-lim > summary::-webkit-details-marker { display: none; }
details.pp-more > summary::after, details.pp-lim > summary::after { content: "▾"; font-size: 12px; } details.pp-more[open] > summary::after, details.pp-lim[open] > summary::after { content: "▴"; }
details.pp-lim > .pf-lim { margin-top: 8px; }
.pp-btns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 4px; }
.pp-b { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 14px; border: 1px solid var(--border); border-radius: 12px; background: color-mix(in srgb, var(--sunken) 50%, var(--surface)); color: var(--text); font-size: 14.5px; font-weight: 650; text-decoration: none; transition: border-color .2s, transform .2s; }
.pp-b svg { color: var(--muted); flex: none; } .pp-b span:first-of-type { flex: 1; }
.pp-b:hover, .pp-b:focus-visible { border-color: var(--accent); transform: translateY(-1px); }
.pstage .pf-ref { margin: 0; align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; border-radius: 999px; border: 1px dashed var(--bad); background: var(--bad-soft); color: var(--bad); font-size: 13.5px; font-weight: 700; }
.pstage .pf-lim { padding: 10px 12px; border-radius: 10px; background: var(--sunken); }
.pstage .pf-lim h4 { margin: 0 0 4px; font-size: 12.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.pstage .pf-lim ul { margin: 0; padding-left: 18px; display: grid; gap: 2px; font-size: 13.5px; line-height: 1.45; }
.pstage .pf-lim.pf-pro { background: var(--ok-soft); }
.pstage a.pf-try { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--bad); background: var(--bad-soft); color: var(--bad); font-weight: 700; font-size: 14.5px; text-decoration: none; }
.pstage a.pf-more { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; color: var(--accent); font-weight: 650; font-size: 14.5px; text-decoration: none; }
.pstage a.pf-more:hover { text-decoration: underline; }
.ps-cap { margin: 10px 0 0; font-size: 13.5px; line-height: 1.45; color: var(--muted); }
.ps-cap a.pf-nf { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; color: var(--accent); font-weight: 650; text-decoration: none; }
@media (max-width: 1180px) { .ps-row > a { grid-template-columns: minmax(0, 1fr) auto; } .ps-line { grid-column: 1; grid-row: 2; } .ps-chip { grid-row: 1 / span 2; grid-column: 2; } }
@media (max-width: 899px) {
  .ps-body { grid-template-columns: minmax(0, 1fr); }
  .ps-panels { position: static; }
  .ps-tabs a { flex: none; }
}
@media (max-width: 560px) {
  ol.ps-list { padding: 8px 8px 8px 30px; border-radius: 16px; } ol.ps-list::before { left: 15px; }
  .ps-dot { left: -21px; } .ps-row.on .ps-dot { left: -23px; }
  .ps-row > a { padding: 8px 10px; gap: 2px 10px; } .ps-t { font-size: 15.5px; } .ps-line { font-size: 13px; } .ps-chip { font-size: 15px; padding: 3px 9px; }
  .ps-panel { padding: 16px 14px; border-radius: 18px; } .pp-btns { gap: 8px; } .pp-b { padding: 0 10px; gap: 8px; font-size: 14px; }
  .pp-ic { width: 46px; height: 46px; } .pp-h h3 { font-size: 21px; }
}
@media (min-width: 2000px) { .ps-t { font-size: 18px; } .ps-line { font-size: 15px; } .pp-does, .pp-ct { font-size: 16px; } }
@media (prefers-reduced-motion: reduce) { .pstage *, .pstage *::before, .pstage *::after { animation: none !important; transition: none !important; } }
`;
