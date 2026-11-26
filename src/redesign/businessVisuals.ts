// /business's words and its four visuals (26 Nov, Max: "way too simple and amateur … widgets, animations,
// architecture"). Earlier: 21 and 22 Nov the question and its line; 26 Nov, morning, one screen with the form only.
//
// 1. The hero's console: one invoice arriving at Payables, Purser's checks lighting up one by one, the CFO's Face ID
//    over the exact terms, then paid; under it, /try's two other outcomes (paid by the agent alone, blocked).
// 2. The architecture: Claude agents → Purser (policy and checks in code) → the CFO's passkey above the limit → the
//    rails (Airwallex, Alta, Visa via Airwallex Airi) → the books and the audit trail; packets move along the lines,
//    and the lane under the limit skips the CFO. One HTML grid, a row on a laptop and a column on a phone.
// 3. The controls, a bento of five tiles: one changed cent breaks the signature; the signed stop; each agent its own
//    card and limit; the chat alert that cannot approve; the hash-chained ledger.
//
// Nothing is invented. Every value is read when the page is built:
//   - the invoice, its account, the signed and the changed fingerprints and the ledger's hash chain from /try's two proof
//     files (docs/proof/try-paid.json, try-refused.json; a test company, test money), as Home's explainer reads them;
//   - the agent's limit from src/config/policy.ts (TRY_ALONE_LIMIT), the two other invoices from src/config/trySample.ts;
//   - the stop from its drill's record, the cards from Airwallex's read-back, the declined charge from the Airwallex-only
//     run (src/redesign/home.ts stopDrillFacts, agentRoster, proofRows: the same functions as Home);
//   - the alert's words as src/integrations/approvalChat.ts writes them (test/business-page.test.ts holds them equal).
// A visual whose record lacks a piece drops out. CSS only, no script: the final frame is the default, so with reduced
// motion (or no animation support) every visual stands finished. Logos only as on file, on white tiles (Home's band).

import { readFileSync } from "node:fs";
import { TRY_ALONE_LIMIT } from "../config/policy.js";
import { CLEAN, NEW_BANK, WITHIN_LIMIT, type InvoiceFields } from "../config/trySample.js";
import { ASSET_VERSIONS, versioned, type VersionedAsset } from "../ui/assetVersions.js";
import { MONEY_FLOW_RECORDS, moneyFlowFacts } from "./moneyFlow.js";
import { REPO_BLOB } from "./metalStory.js";
import { ROSTER_RECORDS, STOP_DRILL_DOC, STOP_DRILL_RECORD, agentRoster, proofRows, stopDrillFacts, type RosterAgent, type StopFacts } from "./home.js";
import { esc, icon } from "./ui.js";
import { picon } from "./proofIcons.js";

/** The question the page asks (Max, 21 Nov), and the line under the headline (22 Nov). */
export const BUSINESS_QUESTION = "Would you trust an AI agent with your company's money?";
export const BUSINESS_LINE = "Join the 30-day pilot: agents pay the routine, your CFO signs the rest with Face ID.";

// ---------------------------------------------------------------------------------------------------------------- data

interface Entry { entry_id: number; description: string; prev_hash: string; entry_hash: string }
interface Bundle { proposal_id: string; terms: { vendor: string; amount: string; currency: string; reference: string; iban_last4: string; test_money?: boolean }; terms_sha256: string; decision: { sent_sha256: string }; asked?: { terms: { amount: string } } | null; ledger?: { entries: Entry[] } }
const read = (f: string) => JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8")) as Bundle;
/** 185000 → "1,850.00"; "1850.00" → "1,850.00" (from the digits: no float on the way). */
export const grouped = (a: string | number): string => {
  const s = typeof a === "number" ? `${Math.trunc(a / 100)}.${String(a % 100).padStart(2, "0")}` : a;
  const m = /^(\d+)(\.\d+)?$/.exec(s);
  return m ? `${m[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${m[2] ?? ""}` : s;
};

export interface BusinessFacts {
  /** The invoice the CFO signed, as /try's paid proof file holds it. */
  pay: { proposal: string; vendor: string; invoice: string; currency: string; amount: string; last4: string; signed: string; /** Its due date, from /try's sample of the same number (null if the numbers differ). */ due: string | null };
  /** The same terms with one cent more, and the fingerprint they had (the refused proof file). Null unless Home's reader agrees. */
  cent: { amount: string; sent: string } | null;
  /** The agent's own limit in a /try company. */
  limit: string;
  /** /try's two other outcomes: paid by the agent alone, blocked for new bank details. */
  alone: { invoice: string; amount: string };
  bank: { invoice: string; amount: string };
  /** Three consecutive entries of the paid file's ledger, each with the hash of the one before (checked here). */
  ledger: { id: number; what: string; prev: string; hash: string }[];
  stop: StopFacts | null;
  cards: RosterAgent[];
  /** The charge Airwallex declined over a card's limit (the Airwallex-only run). */
  decline: { currency: string; amount: string; limit: string } | null;
}

export function businessFacts(paid: Bundle = read(MONEY_FLOW_RECORDS[0]), refused: Bundle = read(MONEY_FLOW_RECORDS[1])): BusinessFacts {
  const t = paid.terms;
  const mf = moneyFlowFacts();
  const inv = (f: InvoiceFields) => ({ invoice: f.invoiceNo, amount: `EUR ${grouped(f.amountCents)}` });
  // The ledger's chain: the last run of three entries where each one's prev_hash is the one before's entry_hash and one
  // of them books the invoice itself (so the chain shown is the payment's).
  const es = paid.ledger?.entries ?? [];
  let ledger: BusinessFacts["ledger"] = [];
  for (let i = 0; i + 2 < es.length; i++) {
    const [a, b, c] = [es[i]!, es[i + 1]!, es[i + 2]!];
    if (b.prev_hash === a.entry_hash && c.prev_hash === b.entry_hash && [a, b, c].some((e) => e.description.startsWith(`Invoice ${t.reference}`))) ledger = [a, b, c].map((e) => ({ id: e.entry_id, what: e.description, prev: e.prev_hash, hash: e.entry_hash }));
  }
  const awx = proofRows().find((r) => r.partner === "Airwallex");
  return {
    pay: { proposal: paid.proposal_id, vendor: t.vendor, invoice: t.reference, currency: t.currency, amount: grouped(t.amount), last4: t.iban_last4, signed: paid.terms_sha256,
      due: CLEAN.invoiceNo === t.reference ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${CLEAN.dueDate}T00:00:00Z`)) : null },
    cent: mf?.cent && refused.asked ? { amount: grouped(refused.asked.terms.amount), sent: refused.decision.sent_sha256 } : null,
    limit: `${TRY_ALONE_LIMIT.currency} ${grouped(TRY_ALONE_LIMIT.amount)}`,
    alone: inv(WITHIN_LIMIT), bank: inv(NEW_BANK),
    ledger, stop: stopDrillFacts(), cards: agentRoster(),
    decline: awx?.charge ?? null,
  };
}

/** The chat alert's words, as src/integrations/approvalChat.ts noticeHeadline and CANNOT_APPROVE write them. */
export const ALERT_HEADLINE = (f: BusinessFacts["pay"]) => `[TEST MONEY] Payment ${f.proposal} needs your signature: ${f.currency} ${f.amount}, payee ${f.vendor}`;
export const ALERT_CANNOT = "This message cannot approve anything. Only the CFO's passkey, in Purser Cloud, can.";

const asset = (f: string) => `assets/${f in ASSET_VERSIONS ? versioned(f as VersionedAsset) : f}`;
const logo = (file: string, alt: string, w: number, h: number, cls = "") => `<span class="lg${cls}"><img src="${asset(file)}" alt="${esc(alt)}" width="${w}" height="${h}" decoding="async"></span>`;
const short = (h: string, n = 8) => `${h.slice(0, n)}…`;
const ok = (s = 12) => `<svg class="i" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
const bang = (s = 12) => `<svg class="i" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 6v8"/><path d="M12 18.5h.01"/></svg>`;

// ------------------------------------------------------------------------------------------------- 1. the hero console

/** The checks, in the order Purser runs them on /try (src/ap/checkerCore.ts); the last sends it to the CFO. */
export const CONSOLE_CHECKS = (f: BusinessFacts) => ["Read: supplier, amount, due date", `Supplier and account …${f.pay.last4} on file`, "Not paid before", `Over the agent's ${f.limit} limit`] as const;
export const CONSOLE_STATES = ["Checking", "Waiting for the CFO", "Signed", "Paid"] as const;

export function consoleHtml(f: BusinessFacts): string {
  const checks = CONSOLE_CHECKS(f).map((c, i) => `<li class="cx-c c${i + 1}${i === 3 ? " warn" : ""}"><span class="ck">${i === 3 ? bang() : ok()}</span><span class="tx">${esc(c)}</span></li>`).join("");
  const ring = `<svg class="cx-ring" viewBox="0 0 52 52" width="52" height="52" aria-hidden="true"><circle cx="26" cy="26" r="24"/></svg>`;
  return `<figure class="cx" aria-label="${esc(`Demo, test money: ${f.pay.vendor}'s invoice ${f.pay.invoice} for ${f.pay.currency} ${f.pay.amount} is read and checked, waits over the agent's ${f.limit} limit, the CFO signs the exact terms with Face ID, and it is paid.`)}">
  <div class="cx-bar"><span class="cx-dots" aria-hidden="true"><i></i><i></i><i></i></span><b>${esc("Payables")}</b><span class="cx-tag"><i aria-hidden="true"></i>${esc("Demo company · test money")}</span></div>
  <div class="cx-inv"><span class="cx-doc">${icon("receipt", 20)}</span><span class="cx-who"><b>${esc(f.pay.vendor)}</b><small>${esc(f.pay.due ? `${f.pay.invoice} · due ${f.pay.due}` : f.pay.invoice)}</small></span><span class="cx-amt"><b>${esc(`${f.pay.currency} ${f.pay.amount}`)}</b><span class="cx-st" aria-hidden="true">${CONSOLE_STATES.map((s, i) => `<span class="s${i}">${esc(s)}</span>`).join("")}</span></span></div>
  <ol class="cx-checks">${checks}</ol>
  <div class="cx-sign"><span class="cx-face">${ring}${icon("scan-face", 24)}</span><span class="cx-who"><b>${esc("The CFO signs the exact terms")}</b><small>${esc("Face ID · sha256")} <code>${esc(short(f.pay.signed, 12))}</code></small></span></div>
  <ul class="cx-q">
    <li><code>${esc(f.alone.invoice)}</code><span class="am">${esc(f.alone.amount)}</span><span class="chip okc">${ok(11)}${esc("Paid by the agent")}</span></li>
    <li><code>${esc(f.bank.invoice)}</code><span class="am">${esc(f.bank.amount)}</span><span class="chip badc">${bang(11)}${esc("Blocked: new bank details")}</span></li>
  </ul>
</figure>`;
}

// ----------------------------------------------------------------------------------------------- 2. the architecture

export const ARCH_NODES = [
  { k: "ai", icon: "bot", title: "Claude agents", line: "Read invoices, propose payments" },
  { k: "purser", icon: "shield-check", title: "Purser", line: "Policy and checks, in code" },
  { k: "cfo", icon: "scan-face", title: "CFO passkey", line: "Signs the exact terms with Face ID" },
  { k: "rails", icon: "landmark", title: "The rails", line: "Transfers, agent cards, mandates" },
  { k: "books", icon: "book-open", title: "Books and audit", line: "Booked at once, hash-chained" },
] as const;
export const ARCH_LINKS = ["proposes", "over the limit", "signed terms", "booked"] as const;
export const ARCH_BYPASS = "Under the limit, the agent pays";

export function archHtml(): string {
  const extra: Record<string, string> = {
    ai: `<span class="ar-x">${logo("logo-claude-slate.svg", "Claude", 184, 40)}</span>`,
    purser: `<span class="ar-x"><span class="pc">${esc("Limits")}</span><span class="pc">${esc("Duplicates")}</span><span class="pc">${esc("Bank details")}</span></span>`,
    cfo: `<span class="ar-x"><span class="pc you">${esc("Above the limit only")}</span></span>`,
    rails: `<span class="ar-x">${logo("logo-airwallex.png", "Airwallex", 306, 42)}${logo("logo-alta.svg", "Alta (formerly Metal)", 475, 250, " alta")}<span class="lg tx">${esc("Visa · Airi")}</span></span>`,
    books: `<span class="ar-x"><span class="pc">${esc("T:0")}</span><span class="pc">${esc("Audit log")}</span></span>`,
  };
  const nodes = ARCH_NODES.map((n, i) => `<li class="ar-n n${i + 1}${n.k === "purser" ? " hub" : ""}"><span class="ar-i">${picon(n.icon, 20)}</span><b>${esc(n.title)}</b><span class="ar-l">${esc(n.line)}</span>${extra[n.k] ?? ""}</li>`);
  const links = ARCH_LINKS.map((l, i) => `<li class="ar-k k${i + 1}" aria-hidden="true"><span class="ln"><i></i></span><small>${esc(l)}</small></li>`);
  const items = nodes.flatMap((n, i) => (links[i] ? [n, links[i]!] : [n])).join("");
  return `<div class="ar" role="group" aria-label="${esc("How a payment flows: Claude agents propose, Purser checks in code, over the limit the CFO signs with a passkey, the rails pay, the books record it. Under the limit the agent pays without the CFO.")}">
  <ol class="ar-g">${items}<li class="ar-by" aria-hidden="true"><span class="ln"><i></i></span><small>${esc(ARCH_BYPASS)}</small></li></ol>
</div>`;
}

// ---------------------------------------------------------------------------------------------- 3. the controls bento

export interface Tile { cls: string; title: string; line: string; href: string; link: string; external?: boolean; rec: string; viz: string }

const NUM = ["no", "one", "two", "three", "four", "five"];
export function bentoTiles(f: BusinessFacts): Tile[] {
  const out: Tile[] = [];
  const paidFile = `${REPO_BLOB}${MONEY_FLOW_RECORDS[0]}`;
  if (f.cent) {
    const [whole, last] = [f.cent.amount.slice(0, -1), f.cent.amount.slice(-1)];
    const was = f.pay.amount.slice(-1);
    out.push({ cls: "t-cent", title: "One changed cent breaks the signature", line: "The CFO signs a fingerprint of the exact terms. Change anything after, and nothing is paid.", href: "verify", link: "Verify one yourself", rec: MONEY_FLOW_RECORDS.join(" "),
      viz: `<div class="cv">
  <div class="cv-r"><span class="cv-k">${esc("Signed")}</span><code class="cv-a">${esc(`${f.pay.currency} ${f.pay.amount}`)}</code><code class="cv-h">${esc(short(f.pay.signed, 16))}</code></div>
  <div class="cv-r cv-sent"><span class="cv-k">${esc("Sent")}</span><code class="cv-a">${esc(`${f.pay.currency} ${whole}`)}<span class="flip"><span class="f0">${esc(was)}</span><span class="f1">${esc(last)}</span></span></code><code class="cv-h"><span class="flip"><span class="f0">${esc(short(f.pay.signed, 16))}</span><span class="f1">${esc(short(f.cent.sent, 16))}</span></span></code></div>
  <p class="cv-v"><span class="flip"><span class="f0 okc">${ok(12)}${esc("Matches · paid")}</span><span class="f1 badc">${bang(12)}${esc("Signature broken · nothing paid")}</span></span></p>
</div>` });
  }
  if (f.stop && f.cards.length) {
    out.push({ cls: "t-stop", title: "One stop for every agent", line: `One signed stop froze all ${NUM[f.stop.agents] ?? f.stop.agents} agents' cards in ${f.stop.seconds} s${f.stop.passes > 1 ? `, in ${NUM[f.stop.passes] ?? f.stop.passes} passes` : ""}.`, href: `${REPO_BLOB}${STOP_DRILL_DOC}`, link: "The stop drill", external: true, rec: STOP_DRILL_RECORD,
      viz: `<div class="sv"><span class="sv-b" aria-hidden="true"><svg viewBox="0 0 64 64" width="64" height="64"><path d="M21 4h22l17 17v22L43 60H21L4 43V21z"/></svg><b>STOP</b></span><ul class="sv-c">${f.cards.map((c, i) => `<li class="q${i + 1}"><code>••${esc(c.last4)}</code><span class="sv-s"><span class="a">${esc("Active")}</span><span class="z">${picon("snowflake", 12)}${esc("Frozen")}</span></span></li>`).join("")}</ul><p class="sv-t"><b>${esc(f.stop.seconds)}</b> s</p></div>` });
  }
  if (f.cards.length && f.decline) {
    const d = f.decline;
    const hit = f.cards.find((c) => c.perTx === d.limit && c.currency === d.currency);
    // A wallet: the other cards behind, their top edge in sight; the declined one in front.
    const order = [...f.cards.filter((c) => c !== hit), ...(hit ? [hit] : [])];
    out.push({ cls: "t-cards", title: "Each agent, its own card and limit", line: `Over the limit, Airwallex itself declined the charge: ${d.currency} ${d.amount} on a ${d.currency} ${d.limit} card.`, href: `airwallex`, link: "The Airwallex run", rec: ROSTER_RECORDS,
      viz: `<div class="kv"><ul class="kv-s">${order.map((c, i) => `<li class="kc a-${esc(c.id)}${c === hit ? " hit" : ""} q${i + 1}"><span class="kc-t"><span class="kc-n">${esc(c.name)}</span><code>•• ${esc(c.last4)}</code></span><span class="kc-l">${esc(`${c.currency} ${c.perTx}`)} <small>${esc("a purchase")}</small></span></li>`).join("")}</ul><p class="kv-d"><span class="badc chip">${icon("ban", 12)}${esc(`${d.currency} ${d.amount} declined`)}</span></p></div>` });
  }
  out.push({ cls: "t-chat", title: "Alerts tell. Only a passkey signs.", line: "Slack and Teams hear when a payment waits. Nothing in the message can approve it.", href: `${REPO_BLOB}docs/integrations/README.md`, link: "The integrations", external: true, rec: "src/integrations/approvalChat.ts",
    viz: `<div class="mv"><div class="mv-m"><span class="mv-av" aria-hidden="true">P</span><div class="mv-b"><p class="mv-h"><b>${esc("Purser")}</b><span class="mv-app">${esc("app")}</span></p><p class="mv-t"><b>${esc(ALERT_HEADLINE(f.pay))}</b></p><p class="mv-l">${esc("Open the passkey page to review and sign.")}</p><p class="mv-n">${esc(ALERT_CANNOT)}</p></div></div></div>` });
  if (f.ledger.length === 3) {
    out.push({ cls: "t-chain", title: "Every entry chained to the last", line: "Each entry carries the hash of the one before it, so a quiet edit breaks the chain.", href: paidFile, link: "The ledger's record", external: true, rec: MONEY_FLOW_RECORDS[0],
      viz: `<ol class="lv">${f.ledger.map((e, i) => `<li class="q${i + 1}"><span class="lv-n">#${e.id}</span><span class="lv-w">${esc(e.what.replace(/ · .*$/, ""))}</span><code class="lv-h"><span>${esc(short(e.prev, 6))}</span>${icon("arrow-right", 11)}<b>${esc(short(e.hash, 6))}</b></code></li>`).join("")}</ol>` });
  }
  return out;
}

export function bentoHtml(tiles: Tile[]): string {
  return `<ul class="bt-g">${tiles.map((t) => `<li class="bt ${t.cls}" data-rec="${esc(t.rec)}"><div class="bt-v">${t.viz}</div><div class="bt-x"><h3>${esc(t.title)}</h3><p>${esc(t.line)}</p><a href="${esc(t.href)}"${t.external ? ' target="_blank" rel="noopener"' : ""}>${esc(t.link)}${icon(t.external ? "external-link" : "arrow-right", 15)}</a></div></li>`).join("")}</ul>`;
}

// ------------------------------------------------------------------------------------------------------------ motion

/**
 * One keyframe set per step of a loop: the "off" look until `at` percent, the "on" look by at+3 and held until 94, back
 * to "off" by 100. Every step of a visual shares its loop's duration, so the steps never drift apart.
 */
const step = (name: string, at: number, off: string, on: string, end = 94) => `@keyframes ${name} { 0%, ${at}% { ${off} } ${at + 3}%, ${end}% { ${on} } 100% { ${off} } }`;
/** One of several stacked labels, shown from `a` to `b` percent (the first also shown at the loop's end). */
const window_ = (name: string, a: number, b: number) => a === 0
  ? `@keyframes ${name} { 0%, ${b}% { opacity: 1; transform: none; } ${b + 2}%, 96% { opacity: 0; transform: translateY(-4px); } 99%, 100% { opacity: 1; transform: none; } }`
  : `@keyframes ${name} { 0%, ${a}% { opacity: 0; transform: translateY(4px); } ${a + 2}%, ${b}% { opacity: 1; transform: none; } ${b + 2}%, 100% { opacity: 0; transform: translateY(-4px); } }`;

const CX_CHECKS_AT = [12, 19, 26, 33];
const CX_STATES: [number, number][] = [[0, 33], [33, 52], [52, 64], [64, 94]];

const KEYFRAMES = [
  `@keyframes cx-in { 0% { transform: translateY(-14px) scale(.98); border-color: var(--accent); box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 22%, transparent); } 6% { transform: none; } 14% { border-color: var(--accent); box-shadow: 0 0 0 0 transparent; } 22%, 100% { transform: none; border-color: var(--border); } }`,
  ...CX_CHECKS_AT.map((at, i) => step(`cx-k${i + 1}`, at, "background: transparent; border-color: var(--border); color: transparent;", i === 3 ? "background: var(--amb); border-color: var(--amb); color: var(--bg);" : "background: var(--ok); border-color: var(--ok); color: var(--bg);")),
  ...CX_CHECKS_AT.map((at, i) => step(`cx-t${i + 1}`, at, "color: var(--faint);", i === 3 ? "color: var(--amb);" : "color: var(--text);")),
  ...CX_STATES.map(([a, b], i) => window_(`cx-s${i}`, a, b)),
  step("cx-ring", 40, "stroke-dashoffset: 151;", "stroke-dashoffset: 0;"),
  `@keyframes cx-face { 0%, 33% { color: var(--faint); background: var(--sunken); } 36%, 51% { color: var(--amb); background: color-mix(in srgb, var(--amb) 12%, var(--sunken)); } 54%, 94% { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--sunken)); } 100% { color: var(--faint); background: var(--sunken); } }`,
  step("cx-sign", 51, "color: var(--faint);", "color: var(--text);"),
  // The architecture's packets: across a link on a laptop, down it on a phone.
  `@keyframes ar-x { 0% { left: 0; opacity: 0; } 3% { opacity: 1; } 22% { left: calc(100% - 8px); opacity: 1; } 25%, 100% { left: calc(100% - 8px); opacity: 0; } }`,
  `@keyframes ar-y { 0% { top: 0; opacity: 0; } 3% { opacity: 1; } 22% { top: calc(100% - 8px); opacity: 1; } 25%, 100% { top: calc(100% - 8px); opacity: 0; } }`,
  // The changed cent: signed and matching for the first half, the cent changed and the signature broken for the second.
  `@keyframes cv-0 { 0%, 46% { opacity: 1; transform: none; } 50%, 96% { opacity: 0; transform: translateY(-6px); } 100% { opacity: 1; transform: none; } }`,
  `@keyframes cv-1 { 0%, 46% { opacity: 0; transform: translateY(6px); } 50%, 96% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(6px); } }`,
  `@keyframes cv-row { 0%, 46% { border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); background: color-mix(in srgb, var(--ok) 6%, transparent); } 50%, 96% { border-color: color-mix(in srgb, var(--bad) 55%, var(--border)); background: color-mix(in srgb, var(--bad) 8%, transparent); } 100% { border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); background: color-mix(in srgb, var(--ok) 6%, transparent); } }`,
  // The stop: pressed, then the cards freeze one by one.
  `@keyframes sv-press { 0%, 16% { transform: none; box-shadow: 0 0 0 0 color-mix(in srgb, var(--bad) 45%, transparent); } 19% { transform: scale(.92); } 23% { transform: none; box-shadow: 0 0 0 18px transparent; } 100% { transform: none; box-shadow: 0 0 0 0 transparent; } }`,
  ...[28, 34, 40].flatMap((at, i) => [
    step(`sv-a${i + 1}`, at, "opacity: 1;", "opacity: 0;"),
    step(`sv-z${i + 1}`, at, "opacity: 0;", "opacity: 1;"),
    step(`sv-r${i + 1}`, at, "border-color: var(--border);", "border-color: color-mix(in srgb, var(--metal) 50%, var(--border));"),
  ]),
  // The declined card is ringed once the charge comes back declined.
  `@keyframes kv-hit { 0%, 38% { outline-color: transparent; } 41%, 94% { outline-color: var(--bad); } 100% { outline-color: transparent; } }`,
  step("kv-d", 40, "opacity: .3; transform: translateY(4px);", "opacity: 1; transform: none;"),
  // The alert arrives.
  `@keyframes mv-in { 0%, 6% { opacity: 0; transform: translateY(14px) scale(.98); } 14%, 100% { opacity: 1; transform: none; } }`,
  // The ledger: each link lights in turn.
  ...[10, 30, 50].map((at, i) => step(`lv-${i + 1}`, at, "border-color: var(--border);", "border-color: color-mix(in srgb, var(--accent) 55%, var(--border));", 94)),
].join("\n");

// --------------------------------------------------------------------------------------------------------------- CSS

export const VISUALS_CSS = `
/* Local tokens: an amber for "waits for the CFO", in both themes. */
.bzp { --amb: #a15c00; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .bzp { --amb: #f5b544; } }
:root[data-theme="dark"] .bzp { --amb: #f5b544; }
.okc { color: var(--ok); } .badc { color: var(--bad); }
.chip { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 999px; font-size: 13px; font-weight: 650; white-space: nowrap; background: color-mix(in srgb, currentColor 11%, transparent); border: 1px solid color-mix(in srgb, currentColor 28%, transparent); }
.lg { display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 11px; border-radius: 10px; background: #ffffff; border: 1px solid #e4e7ec; color: #111827; font-size: 13.5px; font-weight: 760; white-space: nowrap; box-shadow: 0 1px 2px rgba(16, 24, 40, .06); }
.lg img { display: block; height: 14px; width: auto; } .lg.alta img { height: 20px; }
.pc { display: inline-flex; align-items: center; height: 26px; padding: 0 9px; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--muted); background: color-mix(in srgb, var(--text) 5%, transparent); border: 1px solid var(--border); white-space: nowrap; }
.pc.you { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); background: color-mix(in srgb, var(--accent) 10%, transparent); }

/* 1. The console. */
figure.cx { position: relative; margin: 0; padding: 16px; border-radius: 26px; display: grid; gap: 12px; min-width: 0;
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, transparent), color-mix(in srgb, var(--surface) 82%, transparent));
  border: 1px solid var(--glass-line); box-shadow: var(--hi), 0 70px 140px -60px var(--glow), 0 30px 70px -44px rgba(8, 6, 28, .7);
  -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3); }
figure.cx::before { content: ""; position: absolute; left: 14%; right: 14%; top: -1px; height: 1px; background: linear-gradient(90deg, transparent, var(--accent), transparent); }
.cx-bar { display: flex; align-items: center; gap: 10px; padding: 2px 4px 0; min-width: 0; }
.cx-dots { display: inline-flex; gap: 5px; } .cx-dots i { width: 9px; height: 9px; border-radius: 50%; background: color-mix(in srgb, var(--text) 16%, transparent); }
.cx-bar b { font: 650 13px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.cx-tag { margin-left: auto; display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.cx-tag i { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok) 18%, transparent); }
.cx-inv, .cx-sign { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 13px 14px; border-radius: 18px; background: color-mix(in srgb, var(--bg) 55%, var(--sunken)); border: 1px solid var(--border); }
.cx-doc { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; color: var(--accent); background: color-mix(in srgb, var(--accent) 13%, transparent); }
.cx-who { display: grid; gap: 2px; min-width: 0; } .cx-who b { font-size: 15.5px; font-weight: 680; letter-spacing: -.01em; overflow-wrap: anywhere; }
.cx-who small { font-size: 13.5px; color: var(--muted); overflow-wrap: anywhere; } .cx-who code { font: 600 13px var(--mono); color: var(--accent); }
.cx-amt { display: grid; justify-items: end; gap: 6px; } .cx-amt b { font-size: 19px; font-weight: 760; letter-spacing: -.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cx-st { display: grid; } .cx-st > span { grid-area: 1 / 1; justify-self: end; display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 700; white-space: nowrap; opacity: 0; }
.cx-st .s0 { color: var(--muted); background: color-mix(in srgb, var(--text) 8%, transparent); }
.cx-st .s1 { color: var(--amb); background: color-mix(in srgb, var(--amb) 15%, transparent); }
.cx-st .s2 { color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, transparent); }
.cx-st .s3 { color: var(--ok); background: color-mix(in srgb, var(--ok) 15%, transparent); opacity: 1; }
ol.cx-checks { list-style: none; margin: 0; padding: 2px 6px; display: grid; gap: 9px; }
.cx-c { display: flex; align-items: center; gap: 11px; font-size: 14.5px; line-height: 1.3; min-width: 0; }
.cx-c .tx { color: var(--text); overflow-wrap: anywhere; } .cx-c.warn .tx { color: var(--amb); font-weight: 600; }
.cx-c .ck { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--ok); background: var(--ok); color: var(--bg); }
.cx-c.warn .ck { background: var(--amb); border-color: var(--amb); }
.cx-face { position: relative; display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--sunken)); }
.cx-ring { position: absolute; inset: 0; transform: rotate(-90deg); } .cx-ring circle { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 151; stroke-dashoffset: 0; }
.cx-sign { grid-template-columns: auto minmax(0, 1fr); }
ul.cx-q { list-style: none; margin: 0; padding: 4px 4px 0; display: grid; gap: 8px; border-top: 1px dashed var(--border); padding-top: 12px; }
.cx-q li { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center; gap: 10px; font-size: 14px; min-width: 0; }
.cx-q code { font: 600 13px var(--mono); color: var(--muted); } .cx-q .am { font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cx-q .chip { justify-self: end; min-width: 0; overflow: hidden; text-overflow: ellipsis; }

/* 2. The architecture: one grid; a row of five on a laptop, a column on a phone. The lane under the limit runs above
   the row (beside the column), from Purser to the rails, past the CFO. */
.ar { margin-top: 48px; }
ol.ar-g { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr) 44px; }
.ar-n { position: relative; display: grid; gap: 7px; align-content: start; padding: 18px; border-radius: 20px; min-width: 0;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 4%, var(--surface)), var(--surface)); border: 1px solid var(--border); box-shadow: var(--hi), 0 24px 48px -36px rgba(0, 0, 0, .5); }
.ar-n.hub { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); box-shadow: var(--hi), 0 0 0 4px color-mix(in srgb, var(--accent) 10%, transparent), 0 30px 70px -40px var(--glow); }
.ar-i { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; color: var(--accent); background: color-mix(in srgb, var(--accent) 13%, transparent); margin-bottom: 4px; }
.ar-n.hub .ar-i { color: var(--btn-ink); background: var(--btn-bg); }
.ar-n b { font-size: 16.5px; font-weight: 700; letter-spacing: -.015em; } .ar-l { font-size: 14px; line-height: 1.4; color: var(--muted); }
.ar-x { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.ar-k, .ar-by { position: relative; display: grid; place-items: center; }
.ar-k .ln, .ar-by .ln { position: absolute; display: block; }
.ar-k .ln i, .ar-by .ln i { position: absolute; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px 2px color-mix(in srgb, var(--accent) 70%, transparent); opacity: 0; }
.ar-by .ln i { background: var(--ok); box-shadow: 0 0 10px 2px color-mix(in srgb, var(--ok) 60%, transparent); }
.ar-k small, .ar-by small { position: relative; font: 600 12.5px/1.2 var(--mono); letter-spacing: .02em; color: var(--faint); background: var(--bg); padding: 3px 6px; border-radius: 6px; white-space: nowrap; }
.ar-k.k2 small { color: var(--amb); } .ar-by small { color: var(--ok); }
/* A phone: nodes down the first column, links between them, the lane in the second column from Purser to the rails. */
.ar-n { grid-column: 1; } .n1 { grid-row: 1; } .n2 { grid-row: 3; } .n3 { grid-row: 5; } .n4 { grid-row: 7; } .n5 { grid-row: 9; }
.ar-k { grid-column: 1; height: 52px; } .k1 { grid-row: 2; } .k2 { grid-row: 4; } .k3 { grid-row: 6; } .k4 { grid-row: 8; }
.ar-k .ln { left: 50%; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 50%, var(--border)), var(--border)); }
.ar-k .ln i { left: -3px; top: 0; } .ar-k small { justify-self: start; margin-left: calc(50% + 14px); background: none; padding: 0; }
.ar-by { grid-column: 2; grid-row: 3 / 8; margin: 34px 0 34px 0; }
.ar-by .ln { inset: 0 auto 0 0; width: 22px; border: 2px dashed color-mix(in srgb, var(--ok) 55%, var(--border)); border-left: 0; border-radius: 0 14px 14px 0; }
.ar-by .ln i { left: 17px; top: 0; }
.ar-by small { writing-mode: vertical-rl; transform: rotate(180deg); margin-left: 22px; padding: 6px 3px; }
@media (max-width: 979px) {
  .ar-n { grid-template-columns: 38px minmax(0, 1fr); column-gap: 14px; row-gap: 4px; padding: 16px; }
  .ar-i { grid-row: 1 / 3; margin: 0; } .ar-n b, .ar-l, .ar-x { grid-column: 2; } .ar-x { margin-top: 4px; }
  .ar-k { height: 44px; }
}
@media (min-width: 980px) {
  ol.ar-g { grid-template-columns: minmax(0, 1fr) 76px minmax(0, 1fr) 76px minmax(0, 1fr) 76px minmax(0, 1fr) 76px minmax(0, 1fr); grid-template-rows: 64px auto; }
  .ar-n { grid-row: 2; } .n1 { grid-column: 1; } .n2 { grid-column: 3; } .n3 { grid-column: 5; } .n4 { grid-column: 7; } .n5 { grid-column: 9; }
  .ar-k { grid-row: 2; height: auto; align-self: stretch; } .k1 { grid-column: 2; } .k2 { grid-column: 4; } .k3 { grid-column: 6; } .k4 { grid-column: 8; }
  .ar-k .ln { left: 0; right: 0; top: 50%; bottom: auto; width: auto; height: 2px; margin: -1px 0 0; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 50%, var(--border)), var(--border)); }
  .ar-k .ln i { top: -3px; left: 0; }
  .ar-k small { margin: 0 0 50px; justify-self: center; font-size: 12px; letter-spacing: 0; white-space: normal; text-align: center; padding: 0; max-width: 72px; line-height: 1.3; }
  .ar-by { grid-column: 3 / 8; grid-row: 1; margin: 0 calc((100% - 152px) / 6); }
  .ar-by .ln { inset: 22px 0 0 0; width: auto; border: 2px dashed color-mix(in srgb, var(--ok) 55%, var(--border)); border-bottom: 0; border-radius: 16px 16px 0 0; }
  .ar-by .ln i { top: -5px; left: 0; }
  .ar-by small { writing-mode: horizontal-tb; transform: none; margin: 0 0 42px; padding: 4px 10px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--ok) 35%, var(--border)); background: var(--bg); }
}

/* 3. The bento. */
ul.bt-g { list-style: none; margin: 48px 0 0; padding: 0; display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 720px) { ul.bt-g { grid-template-columns: repeat(2, minmax(0, 1fr)); } .t-cent { grid-column: span 2; } }
@media (min-width: 1040px) { ul.bt-g { grid-template-columns: repeat(3, minmax(0, 1fr)); } .t-cent { grid-column: span 2; } }
.bt { position: relative; display: flex; flex-direction: column; min-width: 0; overflow: hidden; border-radius: 24px; border: 1px solid var(--border);
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 4%, var(--surface)), var(--surface)); box-shadow: var(--hi), 0 1px 2px rgba(16, 24, 40, .05), 0 28px 56px -40px rgba(0, 0, 0, .55); }
.bt::before { content: ""; position: absolute; left: 10%; right: 10%; top: -1px; height: 1px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 70%, transparent), transparent); }
.bt-v { position: relative; flex: 1 0 auto; min-height: 210px; display: grid; place-items: center; padding: 26px 22px; overflow: hidden;
  background: radial-gradient(70% 90% at 50% 0%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 70%); border-bottom: 1px solid var(--border); }
.bt-v::after { content: ""; position: absolute; inset: 0; pointer-events: none; background-image: radial-gradient(color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 1px); background-size: 18px 18px; -webkit-mask-image: radial-gradient(70% 70% at 50% 40%, #000, transparent); mask-image: radial-gradient(70% 70% at 50% 40%, #000, transparent); z-index: 0; }
.bt-v > * { position: relative; z-index: 1; }
.bt-x { display: grid; gap: 6px; padding: 18px 22px 12px; }
.bt-x h3 { font-size: 18px; font-weight: 720; letter-spacing: -.02em; line-height: 1.25; }
.bt-x p { margin: 0; font-size: 15px; line-height: 1.5; color: var(--muted); }
.bt-x a { justify-self: start; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-size: 14.5px; font-weight: 650; color: var(--accent); text-decoration: none; }
.bt-x a:hover { text-decoration: underline; }
/* The changed cent. */
.cv { width: min(100%, 560px); display: grid; gap: 10px; }
.cv-r { display: grid; grid-template-columns: 64px auto minmax(0, 1fr); align-items: center; gap: 14px; padding: 13px 16px; border-radius: 16px; border: 1px solid var(--border); background: color-mix(in srgb, var(--bg) 50%, var(--surface)); }
.cv-r:first-child { border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
.cv-sent { border-color: color-mix(in srgb, var(--bad) 55%, var(--border)); background: color-mix(in srgb, var(--bad) 8%, transparent); }
.cv-k { font: 650 12.5px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--faint); }
.cv-a { font: 700 17px var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--text); }
.cv-h { justify-self: end; font: 500 14px var(--mono); color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flip { display: inline-grid; vertical-align: bottom; } .flip > span { grid-area: 1 / 1; }
.flip .f0 { opacity: 0; } .flip .f1 { opacity: 1; }
.cv-sent .cv-a .f1 { color: var(--bad); background: color-mix(in srgb, var(--bad) 18%, transparent); border-radius: 4px; padding: 0 1px; }
.cv-sent .cv-h .f1 { color: var(--bad); }
.cv-v { margin: 4px 0 0; justify-self: center; } .cv-v .flip > span { display: inline-flex; align-items: center; gap: 7px; justify-self: center; font-size: 14.5px; font-weight: 700; white-space: nowrap; }
/* The stop. */
.sv { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 14px 22px; width: 100%; }
.sv-b { position: relative; display: grid; place-items: center; width: 92px; height: 92px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--bad) 18%, transparent), transparent 70%); }
.sv-b svg { position: absolute; width: 74px; height: 74px; } .sv-b svg path { fill: var(--bad); stroke: color-mix(in srgb, var(--bad) 40%, #fff); stroke-width: 2; }
.sv-b b { position: relative; font: 800 14px/1 Inter, system-ui, sans-serif; letter-spacing: .08em; color: var(--on-bad); }
ul.sv-c { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; min-width: 0; }
.sv-c li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 11px; border-radius: 11px; border: 1px solid color-mix(in srgb, var(--metal) 50%, var(--border)); background: color-mix(in srgb, var(--bg) 50%, var(--surface)); }
.sv-c code { font: 600 13.5px var(--mono); color: var(--muted); }
.sv-s { display: inline-grid; } .sv-s > span { grid-area: 1 / 1; justify-self: end; display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 700; }
.sv-s .a { color: var(--ok); opacity: 0; } .sv-s .z { color: var(--metal); }
.sv-t { grid-column: 1 / -1; margin: 0; text-align: center; font-size: 15px; color: var(--muted); } .sv-t b { font-size: 30px; font-weight: 780; letter-spacing: -.03em; color: var(--text); font-variant-numeric: tabular-nums; }
/* The cards. */
.kv { display: grid; gap: 14px; justify-items: center; width: 100%; }
ul.kv-s { list-style: none; margin: 0; padding: 0; display: grid; width: min(100%, 270px); }
.kc { grid-area: 1 / 1; position: relative; display: grid; grid-template-rows: auto 1fr auto; gap: 2px; height: 150px; padding: 13px 16px 14px; border-radius: 16px; color: #fff; overflow: hidden;
  background: linear-gradient(135deg, var(--ac, #7c6cf0), color-mix(in srgb, var(--ac, #7c6cf0) 40%, #0b0b1a)); border: 1px solid rgba(255, 255, 255, .2); box-shadow: 0 -10px 24px -14px rgba(0, 0, 0, .55), 0 18px 30px -18px rgba(0, 0, 0, .6); outline: 2px solid transparent; outline-offset: 3px; }
.kc::before { content: ""; grid-row: 2; align-self: center; width: 30px; height: 22px; border-radius: 5px; background: linear-gradient(135deg, #f8e7a8, #c9a74a); }
.kc::after { content: ""; position: absolute; right: -40px; bottom: -60px; width: 160px; height: 160px; border-radius: 50%; background: radial-gradient(closest-side, rgba(255, 255, 255, .22), transparent); }
.kc.a-sourcing { --ac: #3b82f6; } .kc.a-support { --ac: #a855f7; } .kc.a-treasury { --ac: #0891b2; }
.kc.q1 { margin-top: 0; } .kc.q2 { margin-top: 36px; } .kc.q3 { margin-top: 72px; }
.kc.hit { outline-color: var(--bad); }
.kc-t { grid-row: 1; display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.kc-n { font-size: 13.5px; font-weight: 700; } .kc code { font: 600 14px var(--mono); letter-spacing: .06em; opacity: .95; }
.kc-l { grid-row: 3; font-size: 15px; font-weight: 720; } .kc-l small { font-weight: 500; opacity: .85; font-size: 13px; }
.kv-d { margin: 10px 0 0; }
/* The alert. */
.mv { width: min(100%, 420px); }
.mv-m { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 12px; padding: 14px; border-radius: 16px; background: color-mix(in srgb, var(--bg) 55%, var(--surface)); border: 1px solid var(--border); box-shadow: 0 20px 40px -30px rgba(0, 0, 0, .6); }
.mv-av { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; background: var(--btn-bg); color: var(--btn-ink); font-weight: 800; font-size: 17px; }
.mv-b { display: grid; gap: 5px; min-width: 0; } .mv-b p { margin: 0; overflow-wrap: anywhere; }
.mv-h { display: flex; align-items: center; gap: 7px; font-size: 14.5px; } .mv-app { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); background: color-mix(in srgb, var(--text) 8%, transparent); padding: 1px 5px; border-radius: 4px; }
.mv-t { font-size: 14px; line-height: 1.45; } .mv-l { font-size: 14px; color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.mv-n { font-size: 13px; line-height: 1.4; color: var(--muted); border-left: 2px solid var(--border); padding-left: 8px; }
/* The chain. */
ol.lv { list-style: none; margin: 0; padding: 0; display: grid; gap: 22px; width: min(100%, 330px); }
.lv li { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 10px; align-items: center; padding: 10px 13px; border-radius: 13px; border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border)); background: color-mix(in srgb, var(--bg) 50%, var(--surface)); }
.lv li + li::before { content: ""; position: absolute; left: 26px; top: -23px; height: 22px; width: 2px; background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 30%, transparent)); }
.lv-n { font: 700 13px var(--mono); color: var(--accent); } .lv-w { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lv-h { grid-column: 2; display: inline-flex; align-items: center; gap: 6px; font: 500 12.5px var(--mono); color: var(--faint); } .lv-h b { color: var(--text); font-weight: 600; }

${KEYFRAMES}
@media (prefers-reduced-motion: no-preference) {
  .cx-inv { animation: cx-in 14s var(--ease) infinite; }
  ${CX_CHECKS_AT.map((_, i) => `.cx-c.c${i + 1} .ck { animation: cx-k${i + 1} 14s ease infinite; } .cx-c.c${i + 1} .tx { animation: cx-t${i + 1} 14s ease infinite; }`).join("\n  ")}
  ${CX_STATES.map((_, i) => `.cx-st .s${i} { animation: cx-s${i} 14s ease infinite; }`).join(" ")}
  .cx-ring circle { animation: cx-ring 14s ease infinite; } .cx-face { animation: cx-face 14s ease infinite; } .cx-sign .cx-who { animation: cx-sign 14s ease infinite; }
  .ar-k .ln i { animation: ar-y 6s linear infinite; } .k2 .ln i { animation-delay: 1.2s; } .k3 .ln i { animation-delay: 2.4s; } .k4 .ln i { animation-delay: 3.6s; }
  .ar-by .ln i { animation: ar-y 6s linear 3s infinite; }
  .cv .f0 { animation: cv-0 8s ease infinite; } .cv .f1 { animation: cv-1 8s ease infinite; } .cv-sent { animation: cv-row 8s ease infinite; }
  .sv-b { animation: sv-press 9s ease infinite; }
  ${[1, 2, 3].map((i) => `.sv-c .q${i} .a { animation: sv-a${i} 9s ease infinite; } .sv-c .q${i} .z { animation: sv-z${i} 9s ease infinite; } .sv-c .q${i} { animation: sv-r${i} 9s ease infinite; }`).join("\n  ")}
  .kc.hit { animation: kv-hit 8s ease infinite; } .kv-d { animation: kv-d 8s ease infinite; }
  .mv-m { animation: mv-in 10s var(--ease) infinite; }
  ${[1, 2, 3].map((i) => `.lv .q${i} { animation: lv-${i} 7s ease infinite; }`).join(" ")}
}
@media (prefers-reduced-motion: no-preference) and (min-width: 980px) {
  .ar-k .ln i { animation-name: ar-x; } .ar-by .ln i { animation-name: ar-x; }
}
@media (max-width: 520px) {
  figure.cx { padding: 12px; border-radius: 22px; } .cx-inv { grid-template-columns: minmax(0, 1fr) auto; } .cx-doc { display: none; }
  .cx-tag { font-size: 12.5px; } .cx-q li { grid-template-columns: auto minmax(0, 1fr); } .cx-q .chip { grid-column: 1 / -1; justify-self: start; }
  .cv-r { grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; } .cv-h { grid-column: 1 / -1; justify-self: start; }
  .sv { grid-template-columns: minmax(0, 1fr); justify-items: center; } ul.sv-c { width: 100%; }
}
`;
