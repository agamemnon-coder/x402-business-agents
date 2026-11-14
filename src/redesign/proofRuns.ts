// /proof, the owner's "the proof is what we need" (13 Nov): what ran live, when, and how to check each one yourself.
// Three blocks, every value read from the run list /runs keeps (src/redesign/runs.ts liveRuns, isLive):
//   1. The proof chain, drawn in inline SVG: signed terms → Face ID or passkey → the rail → the books.
//   2. One row per live run, grouped by partner: its day, a chip that says live (and what was simulated in it), its key
//      id or transaction, and how to verify it: the explorer for a Metal transaction, the run's own record otherwise,
//      and the offline command where one exists.
//   3. The receipt anyone can check offline: `npm run verify-approval` (package.json), the owner's real passkey approval.
// No figure is typed here; no "n of n" fraction is shown.

import { readFileSync } from "node:fs";
import { REPO_BLOB } from "./metalStory.js";
import { isLive, liveRuns, type RunId, type RunRow } from "./runs.js";
import { esc, icon } from "./ui.js";
import { VISA_TAP_ID } from "./visaOverview.js";

const ROOT = new URL("../../", import.meta.url);
const pkgScripts = (JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")) as { scripts: Record<string, string> }).scripts;

/** A link the run list writes relative to docs/runs/README.md, opened at the repository's address. */
const siteHref = (href: string) => (href.startsWith("../../") ? `${REPO_BLOB}${href.slice("../../".length)}` : href);
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

// ── 1. The proof chain ──────────────────────────────────────────────────────────────────────────────────────────────
export interface ChainStep { icon: string; title: string; text: string }
export const PROOF_CHAIN: readonly ChainStep[] = [
  { icon: "file-check", title: "Signed terms", text: "Amount, payee and account, hashed with SHA-256." },
  { icon: "scan-face", title: "Face ID or passkey", text: "Above a limit the CFO signs that hash; one changed cent fails." },
  { icon: "landmark", title: "The rail", text: "Airwallex, Metal and Visa via Airi apply their own controls." },
  { icon: "database", title: "The books", text: "Booked to the ledger; every step in a hash-chained log." },
];

/** The chain: four steps with an arrow between each, across on a wide screen and down on a phone (CSS only). */
export function proofChainHtml(steps: readonly ChainStep[] = PROOF_CHAIN): string {
  const arrow = `<svg class="pc-arr" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
  return `<ol class="pchain" aria-label="${esc("The proof chain")}">${steps.map((s, i) => `<li><span class="pc-ic">${icon(s.icon, 20)}</span><b>${esc(s.title)}</b><small>${esc(s.text)}</small>${i < steps.length - 1 ? arrow : ""}</li>`).join("")}</ol>`;
}

// ── 2. The live runs, by partner ────────────────────────────────────────────────────────────────────────────────────
export type ProofGroup = "The main run" | "Airwallex" | "Visa via Airwallex's Airi" | "Metal" | "The books";
export const PROOF_GROUPS: readonly ProofGroup[] = ["The main run", "Airwallex", "Visa via Airwallex's Airi", "Metal", "The books"];

/** Which group a run belongs to: one group each, by what it shows first. */
export function groupOf(r: RunRow): ProofGroup {
  const words = `${r.name ?? ""} ${r.title} ${r.rails}`;
  if (r.kind === "both") return "The main run";
  if (r.partners?.includes("Visa") || /\bAiri\b|Visa/.test(words)) return "Visa via Airwallex's Airi";
  if (/Moneybird|T:0/.test(words)) return "The books";
  if (r.kind === "testnet" || (r.partners?.length === 1 && r.partners[0] === "Metal")) return "Metal";
  return "Airwallex";
}

/** The chip: live on what, and what in it was simulated, in the run's own words. */
export function chipOf(r: RunRow): { live: string; simulated: string | null } {
  const live = r.kind === "testnet" ? "Live · testnet" : r.kind === "both" ? "Live · sandbox and testnet" : "Live · sandbox";
  const text = `${r.line ?? ""} ${r.what} ${r.checks} ${r.money}`;
  const simulated = /settlement simulated|simulated settlement/i.test(text) ? "settlement simulated" : /simulat|stand-in/i.test(text) ? "partly simulated" : null;
  return { live, simulated };
}

/** The one id that proves the run: a transaction with its explorer link first, then the run's first id. */
export const keyIdOf = (r: RunRow): RunId | null => r.ids.find((i) => i.href) ?? r.ids[0] ?? null;

/** The offline commands, where the repository has one for that run (package.json names them; none is typed if absent). */
// Only verify-approval: it runs from a fresh clone with no keys (README); `npm run verify` needs the run's own ledger.
const COMMANDS: Record<string, string> = { "awx-1": "verify-approval" };
export const commandOf = (r: RunRow): string | null => {
  const name = COMMANDS[r.key];
  return name && pkgScripts[name] ? `npm run ${name}` : null;
};

/** The run's record: its log when it has one, else its first file. */
export function recordOf(r: RunRow): { label: string; href: string } | null {
  const log = r.files.find((f) => /\.md(#|$)/.test(f.href)) ?? r.files[0];
  return log ? { label: "Run record", href: siteHref(log.href) } : null;
}

/** How to verify it yourself: the explorer for a transaction, else the run's record. */
export function verifyOf(r: RunRow): { label: string; href: string } | null {
  const id = keyIdOf(r);
  if (id?.href && /explorer|testnet\.metalntwx/.test(id.href)) return { label: "Explorer", href: id.href };
  return recordOf(r);
}

export const PROOF_RUNS_ID = "live-runs";
const NOT_ON_PROOF = new Set(["tap-1"]);

/** How many rows /proof lists: the strip's run count is this number (the orchestrator, 13 Nov: a judge who counts the rows gets the strip's figure). */
export const proofRunCount = (groups = proofRuns()) => groups.reduce((n, g) => n + g.runs.length, 0);

/** The live runs told elsewhere: the TAP run, on /visa only; one link under the list says where. */
export const elsewhereRuns = (rows: RunRow[] = liveRuns()) => rows.filter((r) => isLive(r) && NOT_ON_PROOF.has(r.key));
export const TAP_LINK = "Visa TAP run → /visa";

/** The live runs, newest first inside each group, groups in a fixed order. */
export function proofRuns(rows: RunRow[] = liveRuns()): { group: ProofGroup; runs: RunRow[] }[] {
  // The TAP run of 2 Nov is told on /visa only, in its own fold (Max, 5 Nov; jury panel, 12 Nov).
  const live = rows.filter((r) => isLive(r) && !NOT_ON_PROOF.has(r.key));
  return PROOF_GROUPS.map((group) => ({ group, runs: live.filter((r) => groupOf(r) === group).sort((a, b) => b.iso.localeCompare(a.iso)) })).filter((g) => g.runs.length);
}

const ext = (href: string) => /^https?:/.test(href);
const a = (href: string, label: string) => `<a href="${esc(href)}"${ext(href) ? ' target="_blank" rel="noopener"' : ""}>${esc(label)}${ext(href) ? " ↗" : ""}</a>`;

export function proofRunsHtml(groups = proofRuns()): string {
  if (!groups.length) return "";
  const row = (r: RunRow) => {
    const chip = chipOf(r), id = keyIdOf(r), v = verifyOf(r), recLink = recordOf(r), cmd = commandOf(r);
    const rec = r.files.map((f) => siteHref(f.href).replace(REPO_BLOB, "")).join(" ");
    return `<li id="run-${esc(r.key)}" data-rec="${esc(rec)}"><span class="pr-d">${esc(dayOf(r.iso))}</span><span class="pr-n">${esc(r.name ?? r.title)}</span>`
      + `<span class="pr-c"><span class="chip live">${esc(chip.live)}</span>${chip.simulated ? `<span class="chip sim">${esc(chip.simulated)}</span>` : ""}</span>`
      + `<span class="pr-id">${id ? `<span class="k">${esc(id.label.replace(/ · 0x[0-9a-fA-F]+…[0-9a-fA-F]+$/, "").replace(/ \([A-Z_]+\)$/, ""))}</span> ${id.href ? `<a class="mono" href="${esc(id.href)}" target="_blank" rel="noopener">${esc(id.value)}&nbsp;↗</a>` : `<code>${esc(id.value)}</code>`}` : ""}</span>`
      + `<span class="pr-v">${v ? a(v.href, v.label) : ""}${v && recLink && recLink.href !== v.href ? ` ${a(recLink.href, "Record")}` : ""}${cmd ? ` <code class="cmd">${esc(cmd)}</code>` : ""}</span></li>`;
  };
  return `<section class="pruns" id="${PROOF_RUNS_ID}" data-rec="docs/runs" aria-labelledby="h-pruns"><h2 id="h-pruns">${icon("calendar-range", 19)} ${esc("What ran live, by partner")}</h2>
<p class="pr-note">${esc("Test money throughout. Each run: the id to look up, how to check it. Rehearsals, control tests and partial runs: /runs.")}</p>
${groups.map((g) => `<h3>${esc(g.group)}</h3><ul class="prl">${g.runs.map(row).join("")}</ul>`).join("\n")}${elsewhereRuns().length ? `\n<p class="pr-more"><a href="visa#${VISA_TAP_ID}">${esc(TAP_LINK)}</a></p>` : ""}</section>`;
}

// ── 3. The receipt you check offline ───────────────────────────────────────────────────────────────────────────────
export const VERIFY_COMMAND = "npm run verify-approval";
/** The receipt the command checks, as package.json names it. */
const RECEIPT = /\s(docs\/\S+\.json)$/.exec(pkgScripts["verify-approval"] ?? "")?.[1] ?? "";
export function verifyCalloutHtml(): string {
  if (!pkgScripts["verify-approval"]) return "";
  return `<aside class="pverify" aria-labelledby="h-pverify">${icon("shield-check", 22)}<div><h2 id="h-pverify">${esc("Check a real approval yourself, offline")}</h2>
<p data-rec="${esc(RECEIPT)}">${esc("The owner's own passkey approval of 7 Nov, published on 12 Nov: the passkey signed exactly those terms. Change one cent and it says NOT VALID. No network, no keys.")}</p>
<p class="cmdl"><code>${esc(VERIFY_COMMAND)}</code> ${a(`${REPO_BLOB}README.md#verify-it-yourself-in-3-commands`, "How to run it")}</p></div></aside>`;
}

/** The chain's own rules, shared with /docs' diagram (14 Nov). */
export const PROOF_CHAIN_CSS = `
/* The proof chain (the owner, 13 Nov). */
ol.pchain { list-style: none; margin: 4px 0 24px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
ol.pchain li { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 16px 16px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
ol.pchain .pc-ic { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
ol.pchain b { font-size: 15.5px; font-weight: 680; }
ol.pchain small { font-size: 13.5px; line-height: 1.45; color: var(--muted); }
ol.pchain .pc-arr { position: absolute; right: -16px; top: 24px; z-index: 1; color: var(--faint); background: var(--bg); border-radius: 50%; }
@media (max-width: 760px) { ol.pchain { grid-template-columns: 1fr; gap: 16px; } ol.pchain li { display: grid; grid-template-columns: auto 1fr; column-gap: 12px; row-gap: 2px; align-items: center; padding: 12px 14px; } ol.pchain .pc-ic { grid-row: 1 / span 2; width: 32px; height: 32px; } ol.pchain small { grid-column: 2; } ol.pchain .pc-arr { right: auto; left: 24px; top: auto; bottom: -19px; transform: rotate(90deg); } }
`;

export const PROOF_RUNS_CSS = `${PROOF_CHAIN_CSS}
/* The receipt anyone can check offline. */
aside.pverify { display: flex; gap: 14px; align-items: flex-start; margin: 0 0 28px; padding: 16px 18px; border: 1px solid var(--accent); border-radius: 14px; background: var(--accent-soft); }
aside.pverify > svg { flex: none; color: var(--accent); margin-top: 2px; }
aside.pverify h2 { margin: 0 0 4px; font-size: 16.5px; font-weight: 700; }
aside.pverify p { margin: 0; font-size: 14.5px; line-height: 1.5; color: var(--text); }
aside.pverify .cmdl { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; }
aside.pverify code { font: 600 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 4px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); }
aside.pverify a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; }
/* What ran live, by partner. */
section.pruns { margin: 0 0 28px; }
section.pruns h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: 20px; font-weight: 720; letter-spacing: -.01em; }
section.pruns h2 svg { color: var(--muted); }
.pr-note { margin: 0 0 12px; font-size: 13.5px; color: var(--muted); }
.pr-more { margin: 10px 0 0; font-size: 14px; } .pr-more a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; }
section.pruns h3 { margin: 18px 0 8px; font-size: 13px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--faint); }
ul.prl { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); overflow: hidden; }
ul.prl li { display: grid; grid-template-columns: 64px minmax(0, 1fr) 200px minmax(0, 220px) 200px; column-gap: 14px; align-items: baseline; padding: 12px 16px; border-top: 1px solid var(--border); font-size: 14px; line-height: 1.45; }
ul.prl li:first-child { border-top: 0; }
.pr-d { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pr-n { font-weight: 600; }
.pr-c { display: flex; flex-wrap: wrap; gap: 4px; }
.pr-c .chip { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 650; line-height: 1.6; white-space: nowrap; }
.pr-c .chip.live { background: var(--ok-soft); color: var(--ok); }
.pr-c .chip.sim { background: var(--sunken); color: var(--muted); border: 1px solid var(--border); }
.pr-id { min-width: 0; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.pr-id .k { display: block; }
.pr-id code, .pr-id .mono { font: 500 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--text); }
.pr-id a.mono { color: var(--accent); text-decoration: none; }
.pr-v a { color: var(--accent); font-weight: 650; text-decoration: none; white-space: nowrap; }
.pr-v code.cmd { display: inline-block; margin-top: 4px; white-space: nowrap; font: 500 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 1px 6px; border-radius: 6px; background: var(--sunken); border: 1px solid var(--border); }
@media (max-width: 1000px) { ul.prl li { grid-template-columns: 64px minmax(0, 1fr); row-gap: 4px; } .pr-c, .pr-id, .pr-v { grid-column: 2; } }
@media (max-width: 520px) {
  ul.prl li { grid-template-columns: 1fr; padding: 12px 14px; }
  .pr-d, .pr-n, .pr-c, .pr-id, .pr-v { grid-column: 1; }
  .pr-id a.mono, .pr-v a { display: inline-flex; align-items: center; min-height: 44px; }
}
`;
