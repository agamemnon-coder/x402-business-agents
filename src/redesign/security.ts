// /security, "Security and trust" (12 Nov): seven short cards, each one sentence in sight, its proof one click away and
// the detail folded. Nothing here is typed in: the red team's counts are read from its reports, the audit log's row
// count from the published log, and the "Not yet" card and the doc lines in the folds are the repository's own
// sentences, read from the docs where the page is built (a doc that no longer says one is an error, never a guess).
// Sandbox and testnet only. No script.

import { GUARANTEES } from "./guarantees.js";
import { foldHtml, outLink, productPage, repoHref, repoText, siteLink } from "./productPage.js";
import { esc, icon } from "./ui.js";

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
export const FUNDS_LINE: DocLine = { doc: "docs/compliance.md", anchor: "#1-roles-and-money", quote: "The money sits in the business's own Airwallex account and Metal account. Purser asks those rails to move it" };
/** The note the claims register asks for whenever "no funds of its own" is said (docs/claims.md): the runner keeps the testnet owner key. */
export const OWNER_KEY_NOTE: DocLine = { doc: "docs/claims.md", anchor: "", quote: "\"holds no funds of its own\", noting that the runner keeps the testnet owner key" };
/** What goes on chain of an approval (docs/overview.md), and that no personal data does (docs/metal-award.md). */
export const CHAIN_LINES: readonly DocLine[] = [
  { doc: "docs/overview.md", anchor: "#controls", quote: "Mandate changes anchor the approval on chain (the new credential's hash is bound)" },
  { doc: "docs/metal-award.md", anchor: "", quote: "the customer is simulated and Purser holds no personal data on chain" },
];
/** The "Not yet" card's one sentence, and the docs' own sentences behind each part of it. */
export const NOT_YET_LINE = "No third-party penetration test and no SOC 2 report yet; sandbox and testnet only; the SME product's independent security review is pending.";
export const NOT_YET_SOURCES: readonly DocLine[] = [
  { doc: "docs/security.md", anchor: "#checks", quote: "No third-party penetration test has been run" },
  { doc: "docs/controls.md", anchor: "", quote: "This is not a SOC 2 report: no auditor has tested these controls, and the build runs on the Airwallex sandbox and Metal testnet only." },
  { doc: "docs/cloud.md", anchor: "#before-real-customer-data", about: "The SME product, still to do before real customer data:", quote: "An independent security review of this code after these fixes, and a red-team run against a deployed staging copy." },
];
export const NOT_IN_PLACE = { doc: "docs/controls.md", anchor: "#not-in-place-summary" };
/** The sandbox run in which a payout was made on behalf of a test company's own connected account. */
export const SANDBOX_RUN = "docs/runs/2026-11-10-connected-accounts-sandbox.md";

/** A card: `line` is its one sentence, `links` its proof, `fold` its detail; `line`, `links` and the fold's lines are markup, built here. */
export interface SecurityCard { id: string; icon: string; title: string; line: string; pill?: string; links: string[]; fold: { summary: string; lines: string[] }; wide?: boolean }

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
      line: esc("The CFO signs the exact terms with a passkey: change one cent and the signature is refused."),
      links: [siteLink("try", "Try it yourself", true)],
      fold: { summary: "How", lines: [esc(terms.how), code(terms)] },
    },
    {
      id: "s-funds", icon: "wallet", title: "No funds held", pill: "Sandbox only",
      line: esc("Purser holds no funds of its own: the money stays in the company's own Airwallex account, and Purser is the control layer."),
      links: [outLink(repoHref(SANDBOX_RUN), "The sandbox run")],
      fold: { summary: "How", lines: [
        quoted(FUNDS_LINE),
        esc("In the sandbox run a payout was made on behalf of a test company's own connected account, with test money."),
        `${esc("In this build the runner keeps the testnet owner key.")} ${outLink(repoHref(docLine(OWNER_KEY_NOTE).doc), OWNER_KEY_NOTE.doc)}`,
      ] },
    },
    {
      id: "s-limits", icon: "sliders-horizontal", title: "Limits",
      line: esc("Limits live outside the prompt: card controls per agent at Airwallex, and a mandate per agent on chain at Metal."),
      links: [siteLink("airwallex#controls", "Card controls, read back"), siteLink("metal", "A refusal on chain")],
      fold: { summary: "How", lines: [`Airwallex: ${esc(cards.how)} ${code(cards)}`, `Metal: ${esc(chain.how)} ${code(chain)}`] },
    },
    {
      id: "s-audit", icon: "file-lock-2", title: "Audit trail",
      line: `Every step goes into a hash-chained audit log that anyone can re-check: <code>${esc(AUDIT_COMMAND)}</code>.`,
      links: [outLink(repoHref(AUDIT_README), "Check the published log")],
      fold: { summary: "How", lines: [quoted(AUDIT_LINE), `The ${esc(audit.day)} run's log is in the repository, ${audit.rows} rows. Check it offline, with no keys: <code>${esc(audit.command)}</code>`, code(log)] },
    },
    {
      id: "s-chain", icon: "link-2", title: "On chain",
      line: esc("On Metal's chain are each agent's mandate and its payments, and of an approval only a hash: no personal data."),
      links: [siteLink("metal", "See it on Metal's testnet")],
      fold: { summary: "How", lines: [esc("Metal's testnet is public: each agent's mandate and every payment can be seen on its explorer."), ...CHAIN_LINES.map(quoted)] },
    },
    {
      id: "s-redteam", icon: "shield-alert", title: "Tested by attack",
      line: esc(`Our red team ran ${first.attempts} attacks in a test world: ${first.before} were stopped before anything moved and ${first.after} were found afterwards, not prevented.`),
      links: [outLink(repoHref(REDTEAM_REPORT), "The report")],
      fold: { summary: "Later rounds", lines: [
        `${esc(oct31.day)}, three runs in a row: ${oct31.attempts} attacks, ${oct31.before} stopped before anything moved, ${oct31.after} found afterwards, ${oct31.inconclusive} inconclusive. ${outLink(repoHref(REDTEAM_OCT31_README), "The runs")}`,
        `${esc(night.day)}, tests written by Claude Opus as the attacker: ${night.attempts} run, ${night.blocked} blocked, ${night.notBlocked} not blocked by code's verdict (checked by hand: ${esc(recheck.words)}), ${night.inconclusive} inconclusive. ${outLink(repoHref(REDTEAM_NIGHT_RECORD), "The record")}`,
        esc("Every round ran in a throwaway test world on simulated rails, with test data: not live."),
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
    ${foldHtml(c.fold.summary, c.fold.lines)}</article>`;

export function securityPage(): string {
  const cards = securityCards();
  return productPage({
    key: "security", title: "Security and trust", h1: "Security and trust", label: "Sandbox and testnet only",
    lead: "What protects the money, each point with its proof.",
    description: "How Purser protects company money: signatures over the exact terms, no funds held, limits outside the prompt, a hash-chained audit log, the red team's results, and what is not in place yet. Sandbox and testnet only.",
    body: `<div class="cols c2">\n  ${cards.map(cardHtml).join("\n  ")}\n</div>`,
    source: `Source: ${REDTEAM_REPORT} and the later red-team records, ${AUDIT_LOG}, and the docs each fold names.`,
    real: [
      "Sandbox and testnet only: Airwallex's sandbox, Metal's testnet, test money.",
      "The red team ran in a throwaway test world on simulated rails, not live.",
      NOT_YET_LINE,
    ],
  });
}
