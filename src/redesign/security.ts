// /security, "Security and trust" (12 Nov): seven short cards, each one sentence in sight, its proof one click away and
// the detail folded. Nothing here is typed in: the red team's counts are read from its reports, the audit log's row
// count from the published log, and the "Not yet" card and the doc lines in the folds are the repository's own
// sentences, read from the docs where the page is built (a doc that no longer says one is an error, never a guess).
// Since 13 Nov (the owner) the cards sit under one diagram of the layers a payment must pass and two charts, each read
// from its record (securityViz below). Sandbox and testnet only. No script: the pulses are CSS.

import { ownersRun } from "./metalOnchain.js";
import { existsSync } from "node:fs";
import { ZERO_TRUST_REPORT } from "./claudeEvidence.js";
import { GUARANTEES } from "./guarantees.js";
import { HOSTILE_RECORD_FILE, hostileClaimText } from "./partners.js";
import { existingDoc, foldHtml, outLink, productPage, repoHref, repoText, siteLink } from "./productPage.js";

export { existingDoc };
import { esc, icon, TRY_URL } from "./ui.js";
import { SECOND_KEY_COPY } from "../policy/secondKey.js";

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));
/** A doc as running text: bold and code marks out and line breaks as spaces, so a sentence wrapped over lines reads as one. */
const flat = (path: string) => repoText(path).replace(/\*\*|`/g, "").replace(/\s+/g, " ");

/** A sentence a doc says, word for word; `about`, in our words, says what it is about where the quote alone does not. Throws when the doc no longer says it. */
export interface DocLine { doc: string; anchor: string; quote: string; about?: string }
export function docLine(l: DocLine): DocLine {
  if (!flat(l.doc).includes(l.quote)) throw new Error(`${l.doc} no longer says: ${l.quote}`);
  return l;
}
const quoted = (l: DocLine) => `${l.about ? `${esc(l.about)} ` : ""}“${esc(docLine(l).quote)}” ${outLink(repoHref(l.doc, l.anchor), l.doc)}`;

// The red team.

interface Report { ran_at: string; attempts: number; blocked: number; inconclusive?: number; not_blocked?: number; caught_after?: number }
export interface RedTeamRound {
  day: string;
  attempts: number;
  /** Stopped before anything moved, where the report says how each attack was caught; else null. */
  before: number | null;
  /** Found afterwards, not prevented (the same reports); else null. */
  after: number | null;
  blocked: number;
  notBlocked: number;
  inconclusive: number;
  files: string[];
}
export const REDTEAM_REPORT = "docs/redteam/report.json";
export const REDTEAM_OCT31 = ["docs/runs/redteam-2026-10-31/run-1.json", "docs/runs/redteam-2026-10-31/run-2.json", "docs/runs/redteam-2026-10-31/run-3.json"];
export const REDTEAM_OCT31_README = "docs/runs/redteam-2026-10-31/README.md";
export const REDTEAM_NIGHT = ["docs/redteam/night-2026-11-02.json", "docs/redteam/night-2026-11-02-b.json", "docs/redteam/night-2026-11-02-c.json"];
export const REDTEAM_NIGHT_RECORD = "docs/runs/2026-11-02-night-batch.md";

/** One round: its reports' counts added up. "Before" and "after" only when every report of the round says how each attack was caught. */
export function redTeamRound(files: string[]): RedTeamRound {
  const reports = files.map((f) => JSON.parse(repoText(f)) as Report);
  const sum = (pick: (r: Report) => number) => reports.reduce((n, r) => n + pick(r), 0);
  const split = reports.every((r) => typeof r.caught_after === "number");
  const blocked = sum((r) => r.blocked), after = split ? sum((r) => r.caught_after!) : null;
  return {
    day: day(reports[0]!.ran_at), attempts: sum((r) => r.attempts), blocked, after, before: after === null ? null : blocked - after,
    notBlocked: sum((r) => r.not_blocked ?? 0), inconclusive: sum((r) => r.inconclusive ?? 0), files,
  };
}
/** The night batch's own re-check of what code judged "not blocked": how many, and that none is a breach, as its record says. */
export function nightRecheck(): { checked: number; words: string } {
  const m = /checked by hand \((\d+); (none is a breach)\)/.exec(flat(REDTEAM_NIGHT_RECORD));
  if (!m) throw new Error(`${REDTEAM_NIGHT_RECORD} no longer says what the re-check by hand found`);
  return { checked: Number(m[1]), words: m[2]! };
}

// The published audit log.

export const AUDIT_LOG = "docs/audit/friday-1-audit.jsonl";
export const AUDIT_README = "docs/audit/README.md";
export const AUDIT_COMMAND = "npm run verify-log";
/** How the chain holds, as the published log's own page says it. */
export const AUDIT_LINE: DocLine = { doc: AUDIT_README, anchor: "", quote: "Each row's hash is SHA-256 over the previous row's hash and the row itself (src/audit/log.ts), so changing, removing or reordering any row breaks every hash after it." };
/** The published log: its rows counted from the file, its run's day from that run's recording (docs/demo/snapshot.json). */
export function publishedAudit(): { rows: number; day: string; command: string } {
  const rows = repoText(AUDIT_LOG).split("\n").filter((l) => l.trim()).length;
  const recorded = (JSON.parse(repoText("docs/demo/snapshot.json")) as { recorded_at: string }).recorded_at;
  return { rows, day: day(recorded), command: `${AUDIT_COMMAND} -- --jsonl ${AUDIT_LOG}` };
}

// What the docs say, word for word.

/** Who holds the money, as docs/compliance.md says it. */
export const FUNDS_LINE: DocLine = { doc: "docs/compliance.md", anchor: "#1-roles-and-money", quote: "The money sits in the business's own Airwallex account and Alta account. Purser asks those rails to move it" };
/** The note the claims register asks for whenever "no funds of its own" is said (docs/claims.md): the runner keeps the testnet owner key. */
export const OWNER_KEY_NOTE: DocLine = { doc: "docs/claims.md", anchor: "", quote: "\"holds no funds of its own\", noting that the runner keeps the testnet owner key" };
/** docs/overview.md, or docs/archive/overview.md once another branch has moved it there (12 Nov). */
export const OVERVIEW_DOC = existingDoc(["docs/overview.md", "docs/archive/overview.md"]);
/** What goes on chain of an approval (the overview), and that no personal data does (docs/metal-award.md). */
export const CHAIN_LINES: readonly DocLine[] = [
  { doc: OVERVIEW_DOC, anchor: "#controls", quote: "Mandate changes anchor the approval on chain (the new credential's hash is bound)" },
  { doc: "docs/metal-award.md", anchor: "", quote: "the customer is simulated and Purser holds no personal data on chain" },
];
/** The "Not yet" card's one sentence, and the docs' own sentences behind each part of it. */
export const NOT_YET_LINE = "No SOC 2 report, no ISO 27001 audit and no third-party penetration test yet; sandbox and testnet only; Purser's independent security review is pending.";
export const NOT_YET_SOURCES: readonly DocLine[] = [
  { doc: "docs/security.md", anchor: "#checks", quote: "No third-party penetration test has been run" },
  { doc: "docs/controls.md", anchor: "", quote: "This is not a SOC 2 report: no auditor has tested these controls, and the build runs on the Airwallex sandbox and Alta testnet only." },
  { doc: "docs/cloud.md", anchor: "#before-real-customer-data", about: "The SME product, still to do before real customer data:", quote: "An independent security review of this code after these fixes, and a red-team run against a deployed staging copy." },
];
export const NOT_IN_PLACE = { doc: "docs/controls.md", anchor: "#not-in-place-summary" };
/** The sandbox run in which a payout was made on behalf of a test company's own connected account. */
export const SANDBOX_RUN = "docs/runs/2026-11-10-connected-accounts-sandbox.md";

/**
 * "If the approver is unavailable" (the panel's review, 12 Nov): the buyer's first two questions, what happens when the
 * approver is away or loses the phone, and who may enrol a new passkey. The answer is docs/security.md's section of
 * that name, at most five lines; the page shows those lines in the doc's own words, so it cannot say something else.
 * `id` is the anchor other pages link to (security#unavailable: guarantee 1 on /proof).
 */
export const UNAVAILABLE = { id: "unavailable", doc: "docs/security.md", heading: "If the approver is unavailable", anchor: "#if-the-approver-is-unavailable" } as const;
/**
 * The section's lines, in the doc's order and words: bold and code marks out, and without the files and commands each
 * line names in brackets at its end (the doc keeps them; the page links the doc). Not one to five numbered lines, each
 * ending with what it cites: an error.
 */
export function unavailableLines(text: string = repoText(UNAVAILABLE.doc)): string[] {
  const body = new RegExp(`^## ${UNAVAILABLE.heading}\\n\\n([\\s\\S]*?)\\n(?=## |$(?![\\s\\S]))`, "m").exec(text)?.[1] ?? "";
  const lines = body.split("\n").filter((l) => l.trim());
  if (lines.length < 1 || lines.length > 5 || lines.some((l) => !/^\d\. \S[^\n]*[.!?] \(`[^\n]*\)$/.test(l))) throw new Error(`${UNAVAILABLE.doc}: "${UNAVAILABLE.heading}" must answer in one to five numbered lines, each ending with the files it cites`);
  return lines.map((l) => l.replace(/^\d\. /, "").replace(/ \(`[^\n]*\)$/, "").replace(/\*\*|`/g, "").trim());
}

/** Two locks on one payout (10 and 12 November, Airwallex sandbox): the passkey in Purser, then Airwallex's own approval. */
export const TWO_LOCKS_RUN = "docs/runs/2026-11-12-airwallex-two-locks-paid.md";
export const TWO_LOCKS_LINES: readonly DocLine[] = [
  { doc: TWO_LOCKS_RUN, anchor: "", quote: "a labelled virtual test passkey signed the exact terms in Purser" },
  { doc: TWO_LOCKS_RUN, anchor: "", quote: "Airwallex's own approval workflow held it IN_APPROVAL" },
  { doc: TWO_LOCKS_RUN, anchor: "", quote: "On 12 November the owner approved it at Airwallex and it ended PAID, with simulated settlement." },
];
/** The models: no keys or tools; code checks what they return (docs/security.md, least privilege). */
export const MODELS_LINE: DocLine = { doc: "docs/security.md", anchor: "#least-privilege", quote: "Models: no key, URL, credential or tool. They read text and return typed data that code checks" };
/** Secrets: only the runner holds payment keys; Purser Cloud seals each company's OAuth tokens; every push is scanned; the cloud's logs are cleaned. */
export const SECRETS_LINES: readonly DocLine[] = [
  { doc: "docs/security.md", anchor: "#trust-boundaries", quote: "Only the runner holds payment keys and writes the ledger." },
  { doc: "docs/cloud.md", anchor: "#endpoints", quote: "Purser exchanges the code server side and keeps the tokens sealed (AES-256-GCM) for this company only." },
  { doc: "docs/security.md", anchor: "#checks", quote: "gitleaks on the pushed commits and the whole history of the branch under check" },
  { doc: "docs/cloud.md", anchor: "#monitoring-logs-and-alert-webhooks", quote: "cloud/src/log.ts cleans every field: anything named like a secret becomes [redacted]" },
];
/** Each company apart in Purser Cloud: one database, every row scoped to its company (not a Durable Object per company). */
export const TENANT_LINE: DocLine = { doc: "docs/cloud.md", anchor: "#how-it-fits", quote: "Every row carries the company (tenant_id); routes only reach data through a tenant-scoped layer (cloud/src/tenant.ts), and a test tries every route against another company's objects." };
/** Sensitive settings in Purser Cloud can ask for the passkey again (13 Nov, cloud/src/stepUp.ts; off by default). */
export const STEP_UP_LINE: DocLine = { doc: "docs/cloud.md", anchor: "#step-up-for-sensitive-settings", quote: "With the setting on, on sensitive settings a session must also show a fresh passkey check" };
/** Every route of the cloud's API states its auth requirement, and a test fails when one does not. */
export const ROUTE_AUTH_LINE: DocLine = { doc: "docs/cloud.md", anchor: "#step-up-for-sensitive-settings", quote: "test/cloud-route-auth.test.ts fails when a route names none" };
/** The optional second key for high-risk payments: its words are the code's own (src/policy/secondKey.ts). */
const SECOND_KEY_DOC = { doc: "docs/cloud.md", anchor: "#a-second-key-for-high-risk-payments" };
/** The full matrix behind the page: each risk, its control, who enforces it, its test and its evidence. */
export const CONTROLS_MATRIX = "docs/controls-matrix.md";

// The pictures (13 Nov, the owner: "looks simple and a lot of text; visualise and animate all the security, use diagrams
// and graphs"). One diagram of the layers a payment must pass, with where each attack of the zero-trust report was
// stopped, and two charts: the hostile-model eval, and the attacks by what they targeted and the layer that stopped
// them. Every figure is read here from its record (a record that no longer adds up is an error, never a guess); the
// animation is CSS only (no script: the page keeps its style-only policy) and stands still for a reader who asks for
// reduced motion.

/**
 * Where the zero-trust attacks ran, in our words (the report says it with a word the site does not use): the report's
 * reading.harness says the same, and the test holds the two together.
 */
export const HARNESS_LINE = "Every attack ran in this repository's test harness: Purser's own code is the real code; Airwallex, Alta, the model and the phones are simulated. Nothing here attacked a live rail.";
/** The Alta testnet transaction that anchors the audit chain and the books (13 Nov). */
export const ANCHOR_RUN = "docs/runs/2026-11-13-anchor.json";
export const ANCHOR_RECORD = "docs/runs/2026-11-13-anchor.md";

interface ZtLayer { id: string; name: string; owner: string; kind: string; does: string }
interface ZtAttack { id: string; target: string; stopped_by: { layer: string } | null; moved: boolean }
interface ZtReport {
  attacks_run: number; attacks_stopped: number; attacks_where_money_moved: number; layers: number;
  principle: string[]; reading: { harness: string }; layer_list: ZtLayer[]; attacks: ZtAttack[];
  depth: { minimum: { optional_off: { depth: number } } };
  generated: { date: string };
}
/** What each attack aimed at, in our words; a target not named here is an error. */
export const ZT_TARGETS: Record<string, string> = { bank_payout: "Bank payout", supplier_invoice: "Supplier invoice", record: "The record", card_purchase: "Card purchase", onchain_payment: "On-chain payment", policy: "The policy", company_data: "Company data" };
/** How the diagram names each layer (the report's names beside them, in the fold), and its short name in the grid. */
export const ZT_NAMES: Record<string, { name: string; short: string; sub: string; icon: string }> = {
  L1: { name: "The agent asks", short: "Agent", sub: "Untrusted: nothing relies on it.", icon: "bot" },
  L2: { name: "Policy and limits in code", short: "Code", sub: "Tools, invoice and fraud checks, the CFO's policy.", icon: "sliders-horizontal" },
  L3: { name: "Face ID or a passkey", short: "CFO", sub: "Above the limits, the CFO signs the terms' hash.", icon: "scan-face" },
  L4: { name: "Four eyes", short: "Second signer", sub: "Above a set threshold, a second person signs.", icon: "users" },
  L5: { name: "The rail's own limit", short: "Rail", sub: "Alta's mandate on chain; Airwallex card and transfer limits.", icon: "landmark" },
  L6: { name: "Books and audit chain", short: "Record", sub: "Hash-linked, anchored on Alta testnet.", icon: "file-lock-2" },
};

export interface ZeroTrust {
  run: number; stopped: number; moved: number; minDepth: number;
  /** The day the report was generated (its own generated.date), said with the hero's count. */
  day: string; harness: string; principle: string[];
  layers: (ZtLayer & { stopped: number })[];
  /** Attacks by target, most first; `at` counts them by the layer that stopped each. */
  targets: { id: string; name: string; total: number; at: Record<string, number> }[];
}
/** The zero-trust report's figures, counted from its attacks; totals that do not match its own are an error. */
export function zeroTrust(text: string = repoText(ZERO_TRUST_REPORT)): ZeroTrust {
  const r = JSON.parse(text) as ZtReport;
  const stoppedAt = (layer: string) => r.attacks.filter((a) => a.stopped_by?.layer === layer).length;
  const stopped = r.attacks.filter((a) => a.stopped_by && !a.moved).length, moved = r.attacks.filter((a) => a.moved).length;
  if (r.attacks.length !== r.attacks_run || stopped !== r.attacks_stopped || moved !== r.attacks_where_money_moved || r.layer_list.length !== r.layers) throw new Error(`${ZERO_TRUST_REPORT}: its attacks do not add up to its totals`);
  const ids = [...new Set(r.attacks.map((a) => a.target))];
  for (const t of ids) if (!ZT_TARGETS[t]) throw new Error(`${ZERO_TRUST_REPORT}: no name for the target ${t}`);
  for (const l of r.layer_list) if (!ZT_NAMES[l.id]) throw new Error(`${ZERO_TRUST_REPORT}: no name for the layer ${l.id}`);
  const targets = ids.map((id) => {
    const of = r.attacks.filter((a) => a.target === id);
    return { id, name: ZT_TARGETS[id]!, total: of.length, at: Object.fromEntries(r.layer_list.map((l) => [l.id, of.filter((a) => a.stopped_by?.layer === l.id).length])) };
  }).sort((a, b) => b.total - a.total);
  return { run: r.attacks_run, day: day(`${r.generated.date}T12:00:00Z`), stopped, moved, minDepth: r.depth.minimum.optional_off.depth, harness: r.reading.harness, principle: r.principle, layers: r.layer_list.map((l) => ({ ...l, stopped: stoppedAt(l.id) })), targets };
}

export interface HostileEval { calls: number; refused: number; tool: number; enforce: number; stood: number; unsafe: number; line: string }
/** The hostile-model eval's counts (docs/evals/ap-hostile.json); parts that do not add up to its totals are an error. */
export function hostileEval(text: string = repoText(HOSTILE_RECORD_FILE)): HostileEval {
  const h = JSON.parse(text) as { calls: number; refused: number; blocked_by_tool: number; overridden_at_enforce: number; stood: number; unsafe: number; line: string };
  if (h.blocked_by_tool + h.overridden_at_enforce !== h.refused || h.refused + h.stood !== h.calls) throw new Error(`${HOSTILE_RECORD_FILE}: its parts do not add up to its totals`);
  return { calls: h.calls, refused: h.refused, tool: h.blocked_by_tool, enforce: h.overridden_at_enforce, stood: h.stood, unsafe: h.unsafe, line: h.line };
}

/** The anchor run: its day, network and explorer link, as its record says. */
export function anchorRun(text: string = repoText(ANCHOR_RUN)): { day: string; network: string; explorer: string; check: string } {
  const a = JSON.parse(text) as { anchored_at: string; network: string; explorer: string; check: string; tx: string };
  if (!a.explorer.startsWith("https://testnet.metalntwx.com/tx/") || !a.explorer.endsWith(a.tx)) throw new Error(`${ANCHOR_RUN}: the explorer link is not its transaction on Alta testnet`);
  return { day: day(a.anchored_at), network: a.network, explorer: a.explorer, check: a.check };
}

/**
 * The charts' colours: the dataviz skill's reference categorical slots 1 to 3 (blue, orange, aqua), validated with its
 * script on this site's card surfaces, light #ffffff and dark #12151d, in the stacked bar's order (every adjacent pair
 * passes). Light aqua sits under 3:1 on white, so every mark has its number written beside it. The grid is one hue
 * (blue), lighter to stronger with the count, every count written in the cell in the text colour. Green and red are
 * kept for the pulses: paid as signed, refused at a layer. No text wears a series colour; no inline style anywhere (a
 * bar's length is an SVG attribute, its colour a class).
 */
export const SECURITY_VIZ_CSS = `.sec { --c-a: #2a78d6; --c-b: #eb6834; --c-c: #1baf7a; --c-track: var(--sunken); display: grid; gap: 12px; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .sec { --c-a: #3987e5; --c-b: #d95926; --c-c: #199e70; } }
:root[data-theme="dark"] .sec { --c-a: #3987e5; --c-b: #d95926; --c-c: #199e70; }
.sec .f-a { fill: var(--c-a); } .sec .f-b { fill: var(--c-b); } .sec .f-c { fill: var(--c-c); } .sec .f-track { fill: var(--c-track); }
.sec .d-a { background: var(--c-a); } .sec .d-b { background: var(--c-b); } .sec .d-c { background: var(--c-c); }
.sec .dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; flex: none; }
.sec h2.zh { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 19px; line-height: 1.25; letter-spacing: -.01em; margin: 0; }
.sec .zsub { margin: 0; font-size: 15px; color: var(--muted); line-height: 1.45; overflow-wrap: anywhere; }
.sec .zsub b { color: var(--text); }
.zhero, .zchart { padding: 16px 18px; display: grid; gap: 12px; align-content: start; min-width: 0; }
/* The layers. Below 900 px a column, the pulses running down it; from 900 px a row, the pulses running along it. */
.zpath { position: relative; display: grid; gap: 10px; padding-left: 22px; }
.zlayers { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); grid-auto-rows: 1fr; }
.zlayers > li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-content: start; padding: 10px 12px 10px 44px; border-radius: 14px; background: var(--sunken); position: relative; min-width: 0; }
.zlayers > li .ic { position: absolute; left: 10px; top: 10px; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; background: var(--surface); color: var(--accent); }
.zlayers > li.untrusted .ic { color: var(--muted); }
.zlayers > li .lid { font-size: 14px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
.zlayers > li b.nm { font-size: 15.5px; line-height: 1.3; }
.zlayers > li small { grid-column: 1 / -1; font-size: 14px; color: var(--muted); line-height: 1.4; }
.zlayers > li .zn { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 6px; font-size: 14.5px; }
.zlayers > li .zn b { font-size: 20px; font-variant-numeric: tabular-nums; }
.zlayers > li svg.zbar { grid-column: 1 / -1; display: block; width: 100%; height: 8px; }
.ztrack { position: absolute; left: 6px; width: 4px; border-radius: 2px; top: calc((100% - 40px) / 12); bottom: calc((100% - 40px) / 12); background: var(--border); }
.zt { position: absolute; left: 2px; top: var(--at); width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; background: var(--surface); border: 2px solid var(--border); }
.zt.t1 { --at: 0%; } .zt.t2 { --at: 20%; } .zt.t3 { --at: 40%; } .zt.t4 { --at: 60%; } .zt.t5 { --at: 80%; } .zt.t6 { --at: 100%; }
.zp { position: absolute; left: 2px; top: 0; z-index: 1; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; opacity: 0; animation: zy 7s linear infinite both; }
.zp.ok { --to: 100%; background: var(--ok); box-shadow: 0 0 0 4px var(--ok-soft); }
.zp.no { background: var(--bad); box-shadow: 0 0 0 4px var(--bad-soft); }
.zp.s2 { --to: 20%; animation-delay: 1.75s; } .zp.s3 { --to: 40%; animation-delay: 3.5s; } .zp.s5 { --to: 80%; animation-delay: 5.25s; }
@keyframes zy { 0% { top: 0; opacity: 0; transform: scale(1); } 6% { opacity: 1; } 60% { top: var(--to); opacity: 1; transform: scale(1); } 72% { top: var(--to); transform: scale(1.5); } 92% { top: var(--to); opacity: 1; } 100% { top: var(--to); opacity: 0; transform: scale(1); } }
@keyframes zx { 0% { left: 0; opacity: 0; transform: scale(1); } 6% { opacity: 1; } 60% { left: var(--to); opacity: 1; transform: scale(1); } 72% { left: var(--to); transform: scale(1.5); } 92% { left: var(--to); opacity: 1; } 100% { left: var(--to); opacity: 0; transform: scale(1); } }
/* One column (final jury, 13 Nov: the L1 card stood as tall as the others, mostly empty, at 390 px): L1, which counts
   nothing, gets its own 64 px row and the five layers below share the rest equally. The track then runs from L1's middle
   (32 px) to L6's, and each dot and pulse is put at its card's middle from that row height R: with the 8 px gaps the
   column is 104 px + 5R high, the track 72 px + 4.5R long, so R = (100% - 72px) / 4.5 of the track. */
@media (max-width: 899px) {
  .zlayers { grid-template-rows: 64px; grid-auto-rows: 1fr; }
  .zlayers > li.untrusted { overflow: hidden; }
  .ztrack { top: 32px; bottom: calc((100% - 104px) / 10); }
  .zt.t2, .zp.s2 { --at: calc(40px + (100% - 72px) / 9); --to: calc(40px + (100% - 72px) / 9); }
  .zt.t3, .zp.s3 { --at: calc(48px + (100% - 72px) / 3); --to: calc(48px + (100% - 72px) / 3); }
  .zt.t4 { --at: calc(56px + (100% - 72px) * 5 / 9); }
  .zt.t5, .zp.s5 { --at: calc(64px + (100% - 72px) * 7 / 9); --to: calc(64px + (100% - 72px) * 7 / 9); }
}
@media (min-width: 900px) {
  .zlayers { grid-template-columns: repeat(6, minmax(0, 1fr)); grid-auto-rows: auto; }
  .zlayers > li { padding: 12px; grid-template-columns: minmax(0, 1fr) auto; }
  .zlayers > li .ic { position: static; grid-row: 1; }
  .zlayers > li .lid { grid-row: 1; align-self: center; }
  .zpath { padding-left: 0; }
  .ztrack { position: relative; order: -1; left: auto; top: auto; bottom: auto; width: auto; height: 4px; margin: 10px calc((100% - 40px) / 12) 6px; }
  .zt { top: 2px; left: var(--at); }
  .zp { top: 2px; left: 0; animation-name: zx; }
}
@media (prefers-reduced-motion: reduce) {
  .zp { animation: none; opacity: 1; top: var(--to); }
  @media (min-width: 900px) { .zp { top: 2px; left: var(--to); } }
}
.zkey { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 15px; }
.zkey li { display: inline-flex; align-items: center; gap: 8px; }
.zkey i { width: 12px; height: 12px; border-radius: 50%; flex: none; } .zkey i.ok { background: var(--ok); } .zkey i.no { background: var(--bad); }
/* The charts. */
.zcharts { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) { .zcharts { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); } }
.sec svg.stack { display: block; width: 100%; height: 30px; }
.zlegend { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 15px; }
.zlegend li { display: flex; align-items: center; gap: 8px; } .zlegend b { font-size: 20px; font-variant-numeric: tabular-nums; min-width: 3ch; }
.zbig { display: flex; align-items: baseline; gap: 8px; font-size: 15px; } .zbig b { font-size: 30px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
table.zheat { width: 100%; border-collapse: separate; border-spacing: 3px; table-layout: fixed; font-size: 15px; }
table.zheat th { font-weight: 650; font-size: 14px; color: var(--muted); text-align: center; line-height: 1.25; padding: 2px; overflow-wrap: anywhere; }
table.zheat th[scope="row"] { text-align: left; color: var(--text); font-size: 14.5px; width: 32%; }
table.zheat td { text-align: center; border-radius: 6px; height: 34px; font-variant-numeric: tabular-nums; font-weight: 650; }
table.zheat td.h0 { color: var(--muted); font-weight: 400; background: var(--sunken); }
table.zheat td.h1 { background: color-mix(in srgb, var(--c-a) 16%, var(--surface)); }
table.zheat td.h2 { background: color-mix(in srgb, var(--c-a) 30%, var(--surface)); }
table.zheat td.h3 { background: color-mix(in srgb, var(--c-a) 44%, var(--surface)); }
table.zheat td.h4 { background: color-mix(in srgb, var(--c-a) 58%, var(--surface)); }
@media (max-width: 599px) { table.zheat .wd { display: none; } }
.sec details.fold { margin-top: 0; }
.sec .links a.pf { font-size: 15px; }`;

const ZT_BUCKET = (n: number) => (n === 0 ? "h0" : n === 1 ? "h1" : n <= 3 ? "h2" : n <= 9 ? "h3" : "h4");

/** The hero, the two charts, in that order, as markup. Every figure is read from its record above. */
export function securityViz(zt: ZeroTrust = zeroTrust(), he: HostileEval = hostileEval(), anchor = anchorRun()): string {
  // The track is drawn for six layers, and the red pulses stop at L2, L3 and L5: each must have stopped an attack.
  if (zt.layers.map((l) => l.id).join() !== "L1,L2,L3,L4,L5,L6" || ["L2", "L3", "L5"].some((id) => !zt.layers.find((l) => l.id === id)!.stopped)) throw new Error(`${ZERO_TRUST_REPORT}: the diagram is drawn for six layers, with attacks stopped at L2, L3 and L5`);
  const max = Math.max(...zt.layers.map((l) => l.stopped));
  const node = (l: ZeroTrust["layers"][number]) => {
    const n = ZT_NAMES[l.id]!;
    const count = l.kind === "untrusted"
      ? ""
      : `<span class="zn"><b>${l.stopped}</b> stopped here</span><svg class="zbar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="f-track" width="100" height="8"/><rect class="f-a" width="${((l.stopped / max) * 100).toFixed(1)}" height="8"><title>${esc(`${n.name}: ${l.stopped} attacks stopped`)}</title></rect></svg>`;
    return `<li class="${esc(l.kind)}" id="z-${esc(l.id)}"><span class="ic">${icon(n.icon, 16)}</span><b class="nm">${esc(n.name)}</b><span class="lid">${esc(l.id)}</span><small>${esc(n.sub)}</small>${count}</li>`;
  };
  const hero = `<section class="card zhero" id="layers" aria-labelledby="layers-h">
    <h2 class="zh" id="layers-h">The layers a payment must pass<span class="pill">Test harness, simulated rails</span></h2>
    <p class="zsub"><b>${zt.run} attacks on the payment path</b>, ${zt.stopped === zt.run ? "all stopped" : `${zt.stopped} stopped`} (zero-trust harness, ${esc(zt.day)}); ${zt.moved === 0 ? "none" : zt.moved} moved money. At least ${zt.minDepth === 2 ? "two" : esc(String(zt.minDepth))} layers must fail before a hostile payment moves.</p>
    <div class="zpath"><div class="ztrack" aria-hidden="true">${zt.layers.map((_, i) => `<b class="zt t${i + 1}"></b>`).join("")}<i class="zp ok"></i><i class="zp no s2"></i><i class="zp no s3"></i><i class="zp no s5"></i></div>
    <ol class="zlayers">${zt.layers.map(node).join("")}</ol></div>
    <ul class="zkey"><li><i class="ok"></i>Paid as signed, then recorded</li><li><i class="no"></i>Refused at its layer</li></ul>
    <div class="links">${outLink(repoHref(ZERO_TRUST_REPORT), "Zero-trust report")}${outLink(anchor.explorer, `Audit chain anchored, ${anchor.day}`)}</div>
    ${foldHtml("How this was tested", [...zt.principle.map(esc), esc(HARNESS_LINE), `The audit chain and the books were anchored on ${esc(anchor.network.replace(/^Metal\b/, "Alta"))} on ${esc(anchor.day)}; check it with <code>${esc(anchor.check)}</code>. ${outLink(repoHref(ANCHOR_RECORD), ANCHOR_RECORD)}`])}
  </section>`;

  // The one wording of the split (hostileWords, src/redesign/partners.ts; the final review, 13 Nov).
  const parts = [{ cls: "a", n: he.tool, label: "refused" }, { cls: "b", n: he.enforce, label: "made stricter" }, { cls: "c", n: he.stood, label: "allowed as they were (within the rules)" }];
  let x = 0;
  const rects = parts.map((p) => { const w = (p.n / he.calls) * 1000; const r = `<rect class="f-${p.cls}" x="${x.toFixed(1)}" width="${w.toFixed(1)}" height="30"><title>${esc(`${p.n} ${p.label}`)}</title></rect>`; x += w; return r; }).join("");
  const hostile = `<section class="card zchart" id="hostile" aria-labelledby="hostile-h">
    <h2 class="zh" id="hostile-h">A hostile model, against the code<span class="pill">Test data</span></h2>
    <p class="zsub">A script in the agents' place made the worst tool call it could, every turn.</p>
    <p class="zbig"><b>${he.calls}</b> calls · <b>${he.unsafe}</b> unsafe</p>
    <svg class="stack" viewBox="0 0 1000 30" preserveAspectRatio="none" role="img" aria-label="${esc(`${he.calls} hostile tool calls: ${parts.map((p) => `${p.n} ${p.label}`).join(", ")}`)}">${rects}</svg>
    <ul class="zlegend">${parts.map((p) => `<li><span class="dot d-${p.cls}"></span><b>${p.n}</b>${esc(p.label)}</li>`).join("")}</ul>
    <div class="links">${outLink(repoHref(HOSTILE_RECORD_FILE), "The eval's record")}</div>
  </section>`;

  const cols = zt.layers.filter((l) => l.kind !== "untrusted");
  const grid = `<section class="card zchart" id="where" aria-labelledby="where-h">
    <h2 class="zh" id="where-h">Where each attack was stopped</h2>
    <p class="zsub">By what it aimed at (rows) and the layer that refused it (columns).</p>
    <table class="zheat" aria-labelledby="where-h"><thead><tr><th scope="col"><span class="vh">Target</span></th>${cols.map((l) => `<th scope="col">${esc(l.id)}<span class="wd"> ${esc(ZT_NAMES[l.id]!.short)}</span></th>`).join("")}</tr></thead>
    <tbody>${zt.targets.map((t) => `<tr><th scope="row">${esc(t.name)}</th>${cols.map((l) => { const n = t.at[l.id] ?? 0; return `<td class="${ZT_BUCKET(n)}">${n === 0 ? "·" : n}</td>`; }).join("")}</tr>`).join("")}</tbody></table>
  </section>`;

  return `<div class="sec">\n  ${hero}\n  <div class="zcharts">\n  ${hostile}\n  ${grid}\n  </div>\n</div>`;
}

/**
 * A card: `line` is its one sentence, `links` its proof, `fold` its detail; `more`, where a card has one, is a second
 * fold with an anchor of its own. `line`, `links` and the folds' lines are markup, built here.
 */
export interface SecurityCard { id: string; icon: string; title: string; line: string; pill?: string; links: string[]; fold: { summary: string; lines: string[] }; more?: { id: string; summary: string; lines: string[] }; wide?: boolean }

const how = (id: string) => {
  const g = GUARANTEES.find((x) => x.id === id);
  if (!g) throw new Error(`no guarantee ${id}`);
  return g;
};
const code = (g: { source: string; test: string }) => `${outLink(repoHref(g.source), g.source)} · ${outLink(repoHref(g.test), g.test)}`;

/** The seven cards, in the page's order. Every figure is read here, from the files named above. */
export function securityCards(): SecurityCard[] {
  const first = redTeamRound([REDTEAM_REPORT]), oct31 = redTeamRound(REDTEAM_OCT31), night = redTeamRound(REDTEAM_NIGHT), recheck = nightRecheck();
  if (first.before === null || first.after === null || oct31.before === null || oct31.after === null) throw new Error("a red-team report no longer says how each attack was caught");
  if (recheck.checked !== night.notBlocked) throw new Error("the night batch's re-check does not cover every test code judged not blocked");
  const audit = publishedAudit();
  const terms = how("g-terms"), cards = how("g-cards"), chain = how("g-chain"), log = how("g-log");
  return [
    {
      id: "s-sign", icon: "scan-face", title: "Signed terms",
      line: esc("The CFO signs the exact terms with a passkey (Face ID); one changed cent is refused."),
      // 12 Nov: the Face ID on chain run (a passkey account on Alta testnet; the second owner a labelled virtual test
      // passkey), the answer to "the chain did not check Face ID".
      links: [siteLink(TRY_URL, "Try it yourself", true), ...(ownersRun() ? [siteLink("alta#faceid-onchain", "Passkeys sign on chain (P-256)")] : [])],
      fold: { summary: "How", lines: [esc(terms.how), code(terms), ...(ownersRun() ? [esc("On Alta testnet, 12 Nov: a passkey account changed an agent's mandate only with both owners' passkeys, and checked them on chain; the second owner was a labelled virtual test passkey.")] : [])] },
      // The doc's own lines, each checked against the doc as every quoted line on this page is, then the doc itself.
      more: {
        id: UNAVAILABLE.id, summary: UNAVAILABLE.heading,
        lines: [...unavailableLines().map((quote) => esc(docLine({ doc: UNAVAILABLE.doc, anchor: UNAVAILABLE.anchor, quote }).quote)), outLink(repoHref(UNAVAILABLE.doc, UNAVAILABLE.anchor), UNAVAILABLE.doc)],
      },
    },
    {
      id: "s-keys", icon: "lock", title: SECOND_KEY_COPY.title, pill: "Optional",
      line: esc(SECOND_KEY_COPY.line),
      links: [outLink(repoHref(SECOND_KEY_DOC.doc, SECOND_KEY_DOC.anchor), "How it works")],
      fold: { summary: "How", lines: [esc(SECOND_KEY_COPY.how), esc(SECOND_KEY_COPY.tested), `${outLink(repoHref("src/policy/secondKey.ts"), "src/policy/secondKey.ts")} · ${outLink(repoHref("test/second-key.test.ts"), "test/second-key.test.ts")}`] },
    },
    {
      id: "s-locks", icon: "lock", title: "Two locks",
      line: esc("A payout needs the CFO's signature in Purser, then Airwallex's own approval."),
      links: [outLink(repoHref(TWO_LOCKS_RUN), "The sandbox run")],
      fold: { summary: "How", lines: TWO_LOCKS_LINES.map(quoted) },
    },
    {
      id: "s-limits", icon: "sliders-horizontal", title: "Limits outside the prompt",
      line: esc("Card controls per agent at Airwallex, and a mandate per agent on Alta's chain."),
      links: [siteLink("airwallex#controls", "Card controls, read back"), siteLink("alta", "A refusal on chain")],
      fold: { summary: "How", lines: [`Airwallex: ${esc(cards.how)} ${code(cards)}`, `Alta: ${esc(chain.how)} ${code(chain)}`] },
    },
    {
      id: "s-code", icon: "bot", title: "Agents propose, code enforces",
      line: esc("Agents hold no keys; code checks what they propose before anything moves."),
      // The hostile-model eval (12 Nov, docs/evals/ap-hostile.json): its record's own line, built by /claude's own
      // function; shown only once the record is in the tree.
      links: [outLink(repoHref(MODELS_LINE.doc, MODELS_LINE.anchor), "Least privilege"), ...(hostileClaimText() ? [outLink(repoHref(HOSTILE_RECORD_FILE), "Hostile-model eval")] : [])],
      fold: { summary: "How", lines: [quoted(MODELS_LINE), ...(hostileClaimText() ? [`${esc(hostileClaimText())} ${outLink(repoHref(HOSTILE_RECORD_FILE), HOSTILE_RECORD_FILE)}`] : [])] },
    },
    {
      id: "s-secrets", icon: "shield-check", title: "Secrets",
      // The final review (13 Nov): "payment keys", and the connected accounts' tokens Purser Cloud keeps (cloud/src/sealed.ts).
      line: esc("Only the runner holds payment keys; Purser Cloud keeps each company's connected-account OAuth tokens sealed (AES-GCM, per company)."),
      links: [outLink(repoHref("docs/security.md", "#trust-boundaries"), "Trust boundaries")],
      fold: { summary: "How", lines: SECRETS_LINES.map(quoted) },
    },
    {
      id: "s-tenants", icon: "users", title: "Each company apart",
      line: esc("Every row carries its company, and a test tries each route on another company's data."),
      links: [outLink(repoHref(TENANT_LINE.doc, TENANT_LINE.anchor), "Purser Cloud")],
      fold: { summary: "How", lines: [quoted(TENANT_LINE), quoted(STEP_UP_LINE), quoted(ROUTE_AUTH_LINE)] },
    },
    {
      id: "s-audit", icon: "file-lock-2", title: "Audit trail",
      line: `Every step goes into a hash-chained log that anyone can re-check: <code>${esc(AUDIT_COMMAND)}</code>.`,
      links: [outLink(repoHref(AUDIT_README), "Check the published log")],
      fold: { summary: "How", lines: [quoted(AUDIT_LINE), `The ${esc(audit.day)} run's log is in the repository, ${audit.rows} rows. Check it offline, with no keys: <code>${esc(audit.command)}</code>`, code(log)] },
    },
    {
      id: "s-redteam", icon: "shield-alert", title: "Tested by attack", pill: "Test world",
      // Jury check, 12 Nov: the two caught "after" were not prevented; they were detected after (the hash chain, the hourly
      // reconciliation), on simulated rails; each with how it was detected, in the report.
      line: esc(`Red team: ${first.attempts} attacks, ${first.before} stopped before anything moved, ${first.after} not prevented (detected after).`),
      // The zero-trust report (12 Nov, docs/zero-trust/report.json): linked once it is in the tree.
      links: [outLink(repoHref(REDTEAM_REPORT), "The report"), outLink(repoHref(REDTEAM_REPORT), `How the ${first.after} were detected`), ...(existsSync(new URL(`../../${ZERO_TRUST_REPORT}`, import.meta.url)) ? [outLink(repoHref(ZERO_TRUST_REPORT), "Zero-trust report")] : [])],
      fold: { summary: "Later rounds", lines: [
        `${esc(oct31.day)}, three runs in a row: ${oct31.attempts} attacks, ${oct31.before} stopped before anything moved, ${oct31.after} not prevented (detected after), ${oct31.inconclusive} inconclusive. ${outLink(repoHref(REDTEAM_OCT31_README), "The runs")}`,
        `${esc(night.day)}, tests written by Claude Opus as the attacker: ${night.attempts} run, ${night.blocked} blocked, ${night.notBlocked} not blocked by code's verdict (checked by hand: ${esc(recheck.words)}), ${night.inconclusive} inconclusive. ${outLink(repoHref(REDTEAM_NIGHT_RECORD), "The record")}`,
        esc("Every round ran in a throwaway test world on simulated rails, with test data: not live."),
      ] },
    },
    {
      id: "s-data", icon: "wallet", title: "Money and data", pill: "Test money only",
      // "No customer money" (docs/compliance.md), not "no funds of its own": in the sandbox run Purser's own platform
      // account funded the test company and took the test fee (docs/airwallex-platform.md). Review, 12 Nov.
      line: esc("Each company's money stays in its own Airwallex account, and on chain there is no personal data."),
      links: [outLink(repoHref(SANDBOX_RUN), "The sandbox run"), siteLink("alta", "See it on Alta's testnet")],
      fold: { summary: "How", lines: [
        quoted(FUNDS_LINE),
        esc("In the sandbox run a payout was made on behalf of a test company's own connected account, with test money."),
        `${esc("In this build the runner keeps the testnet owner key.")} ${outLink(repoHref(docLine(OWNER_KEY_NOTE).doc), OWNER_KEY_NOTE.doc)}`,
        esc("Every card is an Airwallex sandbox test card and every amount is test money."),
        esc("Alta's testnet is public: each agent's mandate and every payment can be seen on its explorer."),
        ...CHAIN_LINES.map(quoted),
      ] },
    },
    {
      id: "s-notyet", icon: "clock", title: "Not yet", wide: true,
      line: esc(NOT_YET_LINE),
      links: [outLink(repoHref(NOT_IN_PLACE.doc, NOT_IN_PLACE.anchor), "What is not in place")],
      fold: { summary: "Sources", lines: NOT_YET_SOURCES.map(quoted) },
    },
  ];
}

const cardHtml = (c: SecurityCard) => `<article class="pc card fd${c.wide ? " wide" : ""}" id="${c.id}"><h2><span class="ic">${icon(c.icon, 19)}</span>${esc(c.title)}${c.pill ? `<span class="pill">${esc(c.pill)}</span>` : ""}</h2>
    <p>${c.line}</p><div class="links">${c.links.join("")}</div>
    ${foldHtml(c.fold.summary, c.fold.lines)}${c.more ? `\n    ${foldHtml(c.more.summary, c.more.lines).replace('<details class="fold">', `<details class="fold" id="${c.more.id}">`)}` : ""}</article>`;

/**
 * The line under /security's heading (final jury, 13 Nov): the three attack tests, each with its total from its record,
 * and the red team's two not prevented (detected after) said there, beside the headline, not only in its card.
 */
export function securityLead(zt: ZeroTrust = zeroTrust(), he: HostileEval = hostileEval(), rt: RedTeamRound = redTeamRound([REDTEAM_REPORT])): string {
  return `Three attack tests: zero trust, ${zt.run} attacks on the payment path, ${zt.stopped === zt.run ? "all" : zt.stopped} stopped; a hostile model, ${he.calls} tool calls, ${he.unsafe === 0 ? "none" : he.unsafe} unsafe by the ledger verdict; the red team, ${rt.attempts} attacks, ${rt.after ?? 0} not prevented (detected after).`;
}

export function securityPage(): string {
  const cards = securityCards();
  return productPage({
    key: "security", title: "Security and trust", h1: "Security and trust", label: "Sandbox and testnet only",
    lead: securityLead(),
    description: "How Purser protects company money: signatures over the exact terms, no customer money held, limits outside the prompt, a hash-chained audit log, the red team's results, and what is not in place yet. Sandbox and testnet only.",
    css: SECURITY_VIZ_CSS,
    body: `<div class="links">${outLink(repoHref(CONTROLS_MATRIX), "Every risk, its control and its test")}</div>\n${securityViz()}\n<div class="cols c3">\n  ${cards.map(cardHtml).join("\n  ")}\n</div>`,
    source: `Source: ${ZERO_TRUST_REPORT}, ${HOSTILE_RECORD_FILE}, ${ANCHOR_RUN}, ${REDTEAM_REPORT} and the later red-team records, ${AUDIT_LOG}, and the docs each fold names.`,
    real: [
      "Sandbox and testnet only: Airwallex's sandbox, Alta's testnet, test money.",
      "The red team ran in a throwaway test world on simulated rails, not live.",
      HARNESS_LINE,
      NOT_YET_LINE,
    ],
  });
}
