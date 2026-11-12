// The invoice token on /metal: one short block, "Invoice token (prototype)", shown only when a live run's record
// exists (docs/runs/<date>-tokenize.json, written by `npm run tokenize -- record` from the run's own ledger and call
// log). Without a record the page is byte for byte what it was. Everything in the block is read from the record: the
// day of the run and the day of the approval, the price and the face value, the scale, the count and every link; the
// words follow what the record says ran (minted, financed, settled, verified) and its labels (prototype, Metal
// testnet, the financier simulated, the face value divided). It says "the CFO approved" only when the record links a
// committed run record that names the approving passkey; a passkey without a test label is not proof of a person. No new style: the card is the one /airwallex uses for a separate run (READBACK_CSS, already in the
// partner pages' one stylesheet). test/tokenize-record.test.ts holds both states.

import { readdirSync, readFileSync } from "node:fs";
import type { TokenizeRunRecord } from "../tokenize/runRecord.js";
import { REPO_BLOB, explorerLink } from "./metalStory.js";
import { esc, icon } from "./ui.js";

const RUNS = new URL("../../docs/runs/", import.meta.url);
export const TOKENIZE_RUN_ID = "invoice-token";
export const TOKENIZE_RUN_TITLE = "Invoice token (prototype)";

/** The newest record docs/runs/YYYY-MM-DD-tokenize.json, or null when no live run was recorded. */
export function tokenizeRunFile(names: string[] = readdirSync(RUNS)): string | null {
  const f = names.filter((n) => /^\d{4}-\d{2}-\d{2}-tokenize\.json$/.test(n)).sort().pop();
  return f ? `docs/runs/${f}` : null;
}

export interface TokenizeRun { file: string; rec: TokenizeRunRecord }

/** The record when it is one this block may show: a labelled prototype run on Metal testnet whose mint landed. */
export function tokenizeRun(file: string | null = tokenizeRunFile()): TokenizeRun | null {
  if (!file) return null;
  const rec = JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as TokenizeRunRecord;
  return showable(rec) ? { file, rec } : null;
}

const landed = (rec: TokenizeRunRecord, key: string) => rec.transactions.find((t) => t.key === key && t.status === "success" && explorerLink(t.explorer)?.kind === "tx");

export function showable(rec: TokenizeRunRecord): boolean {
  const l = rec.labels;
  return rec.kind === "tokenize-run" && l?.prototype === true && l.network === "Metal testnet" && l.test_money === true && l.financier === "simulated" && l.face_value_scaled_by >= 1
    && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) && !!landed(rec, "mint") && !!rec.face_value.amount;
}

const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** The block's one sentence, built from what the record says ran. */
export function tokenizeRunSentence(rec: TokenizeRunRecord): string {
  const a = rec.invoice.approval;
  const by = a.test_passkey ? "An invoice approved with a labelled test passkey" : a.described_in ? "An invoice the CFO approved with a passkey" : "An invoice approved with a passkey";
  // The approval's own day when it is not the day of the run: the token run did not ask for a new approval.
  const on = a.approved_at.slice(0, 10) === rec.date ? "" : ` on ${dayOf(a.approved_at)}`;
  const financed = landed(rec, "accept") && rec.received.creditor ? ` A simulated financier bought it for ${rec.received.creditor} test USD` : "";
  const settled = landed(rec, "settle") && rec.received.holder ? `the debtor paid its holder ${rec.received.holder}` : "";
  const money = financed && settled ? `${financed}; ${settled}.` : financed ? `${financed}.` : settled ? ` The debtor paid its holder ${rec.received.holder} test USD.` : ` Its face value is ${rec.face_value.amount} test USD.`;
  return `${dayOf(rec.date)}, a separate Metal testnet run. ${by}${on} became a token.${money} Amounts are scaled down ${rec.labels.face_value_scaled_by}× for testnet.`;
}

/** The block, or "" when there is no record to show. */
export function tokenizeRunBlock(run: TokenizeRun | null = tokenizeRun()): string {
  if (!run) return "";
  const { rec, file } = run;
  // The run's own transactions (the funding transfers stay in the record), each with its link to Metal's explorer.
  const txs = rec.transactions.filter((t) => !t.key.startsWith("fund-") && t.status === "success" && explorerLink(t.explorer)?.kind === "tx");
  const verified = rec.verify?.ok === true;
  // The hidden h2 keeps the page's headings in order (h1, h2, h3), as /airwallex does above its read-back cards.
  return `<h2 class="vh">Prototype</h2><div class="awrb"><div class="card" id="${TOKENIZE_RUN_ID}"><h3>${icon("file-check", 18)}${esc(TOKENIZE_RUN_TITLE)}</h3>
<p>${esc(tokenizeRunSentence(rec))}</p>
${verified ? `<span class="awm ok">${icon("circle-check", 16)}${esc("Chain record verified")}</span>` : ""}
<details class="fold"><summary>${esc(`${txs.length} transaction${txs.length === 1 ? "" : "s"}`)}</summary><ul class="awc">${txs.map((t) => `<li>${esc(t.what)} <a class="pf" href="${esc(t.explorer)}" target="_blank" rel="noopener">${esc(shortHash(t.hash))} ↗</a></li>`).join("")}</ul>
<p class="src">${esc(`Prototype · test money · ${rec.calls.used} requests to Metal testnet${rec.calls.budget_total ? ` of a budget of ${rec.calls.budget_total}` : ""} · `)}<a class="pf" href="${esc(`${REPO_BLOB}${file.replace(/\.json$/, ".md")}`)}" target="_blank" rel="noopener">${esc("run record")} ↗</a></p></details></div></div>`;
}
