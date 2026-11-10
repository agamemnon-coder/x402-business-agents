// The month-end pack (Max's last round, 1.3): one download for the main run (3 Nov), built when the pages are built,
// from the record and its companion only (docs/demo/main-run.json, docs/demo/main-run-trace.json), with no server call
// and no key. The same inputs give the same bytes (a stored zip, src/lib/zip.ts, with one fixed timestamp: the
// companion's generation date). A zip rather than one file: the bookings, the approvals and the chain are each a CSV
// a bookkeeper opens on its own, and a stored zip needs no new dependency.
//
// Inside: the GL export (src/accounting/gl.ts journalCsv) with each line's rail id and approval hash; the double-entry
// postings (src/accounting/books.ts booksCsv); the 88 payments with their rail ids, locks and audit rows (/trace's
// chains); the approvals; the audit chain's published links with the result of checking them (checkChainLinks) and of
// the verify recorded on 3 Nov; a summary whose totals the tests hold to the record and to reconcile; a README.

import { booksCsv, doubleEntry, trialBalance } from "./books.js";
import { journalCsv, type JournalLine } from "./gl.js";
import { RECORD_UNCHANGED, TRACE_FILE, type RunTrace } from "../demo/runTrace.js";
import { fromCents, toCents } from "../lib/money.js";
import { zipStore } from "../lib/zip.js";
import { EXPLORER_TX } from "../metal/network.js";
import { AGENT_RUN_FILE, type RunRecord } from "../redesign/run.js";
import { chainLines, chains, countOf } from "../redesign/trace.js";
import { T0_STATUS } from "../submission/deck.js";

const RAIL_NAME: Record<string, string> = { metal: "Metal", airwallex_card: "Airwallex, card", airwallex_swift: "Airwallex, SWIFT" };

export const PACK_NAME = "purser-month-end-2026-11-03.zip";
export const PACK_LINK = "Download the month-end pack";
/** On the pack, as Max wrote it. */
export const PACK_LINE = "From the main run of 3 November, test money.";

/**
 * T:0, worded from the record (src/submission/deck.ts T0_STATUS, docs/t0.md): the main run's books, 95 journal entries,
 * posted to T:0's shared sandbox entity on 10 Nov, matching our books.
 */
export function t0Line(status = T0_STATUS): string {
  const first = /first (je_[A-Za-z0-9_]+)/.exec(status)?.[1];
  if (!/95 journal entries posted/.test(status) || !first) throw new Error("the T:0 status no longer says what was posted");
  return `Posted to T:0's shared sandbox on 10 Nov: 95 journal entries, debits equal credits (first ${first}).`;
}

const csvCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/^(.*[",\r\n].*)$/s, (s) => `"${s.replace(/"/g, '""')}"`);
const csv = (head: string[], rows: string[][]) => [head.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
/** The label, on its own first line of each CSV ("#": the README says to skip it). */
const labelled = (label: string, body: string) => `# ${PACK_LINE} ${label} ${RECORD_UNCHANGED}${body.includes("\r\n") ? "\r\n" : "\n"}${body}`;

export interface PackSummary {
  label: string; line: string; t0: string;
  payments: { count: string; metal: string; total: number };
  money: { rail: string; currency: string; in: string; out: string }[];
  reconcile: { at: string; checked: number; differences: number; agrees: boolean };
  books: { postings: number; balanced: boolean; trial: { account: string; name: string; currency: string; debit: string; credit: string; balance: string }[] };
  audit: { recorded: { rows: number; head: string; intact: boolean }; links: { ok: boolean; rows: number; head: string }; proves: string; does_not: string };
}

export function monthEndPack(r: RunRecord, t: RunTrace): { name: string; at: string; files: { path: string; content: string }[]; summary: PackSummary; zip: Buffer } {
  const c = countOf(t), all = chains(r, t), chain = chainLines(t);
  const props = r.ledger?.proposals ?? [], ev = r.ledger?.events ?? [];
  const s = r.snapshot as unknown as { reconciliation: { at: string; checked: number; differences: number }; audit: { rows: number; head: string; intact: boolean } };
  const hashOf = (proposal: string) => (ev.find((e) => e.event === "proposal.created" && e.subject === proposal)?.payload.terms_sha256 as string | undefined) ?? "";
  const label = `${t.label}`;

  // The GL export: each line's rail id is its proof; its approval hash is the signed terms' hash behind its proposal.
  const journal = journalCsv(t.journal.filter((l) => l.source !== "opening"), [{ name: "approval_sha256", value: (l: JournalLine) => (l.approval ? hashOf(l.approval) : "") }]);
  const postings = doubleEntry(t.journal), trial = trialBalance(postings);
  const signed = (x: number) => (x < 0 ? `-${fromCents(-x)}` : fromCents(x));

  const step = (x: (typeof all)[number], key: string) => x.steps.find((st) => st.key === key)!;
  const id = (x: (typeof all)[number], key: string, label: string) => step(x, key).ids.find((i) => i.label === label)?.value ?? "";
  const payments = csv(["id", "kind", "at", "amount", "currency", "rail", "rail_id", "explorer", "approval_sha256", "proposal", "decided_by", "model", "request_id", "lock", "booking", "audit_seq", "audit_event"],
    all.map((x) => {
      const p = x.payment;
      return [p.id, p.kind, p.at, p.amount, p.currency, p.rail, p.rail_id, p.rail === "metal" ? `${EXPLORER_TX}${p.rail_id}` : "", p.approval_sha256 ?? "", p.proposal_id ?? "",
        id(x, "decision", "agent") || id(x, "decision", "payer"), id(x, "decision", "model"), id(x, "decision", "request id"), id(x, "limit", "lock") || id(x, "limit", "proposal"),
        step(x, "booking").ids.map((i) => i.value).join(" "), String(p.audit.seq), p.audit.event];
    }));

  // The approvals: every proposal of the run, who proposed it, the hash of its terms, and who decided it, how and when.
  const approvals = csv(["proposal", "kind", "status", "created_at", "proposed_by", "model", "request_id", "terms_sha256", "decision", "decided_by", "method", "decided_at", "cosigned_by", "executed_at"],
    props.map((p) => {
      const created = ev.find((e) => e.event === "proposal.created" && e.subject === p.proposal_id);
      const o = (created?.payload.origin ?? null) as Record<string, string> | null;
      const decided = ev.find((e) => /^proposal\.(approved|rejected)$/.test(e.event) && e.subject === p.proposal_id);
      const cosigned = ev.find((e) => e.event === "proposal.cosigned" && e.subject === p.proposal_id);
      const executed = ev.find((e) => e.event === "proposal.executed" && e.subject === p.proposal_id);
      return [p.proposal_id, p.kind, p.status, p.created_at, o?.agent ?? p.created_by, o?.model ?? "", o?.request_id ?? "", hashOf(p.proposal_id),
        decided ? decided.event.replace("proposal.", "") : "", String(decided?.payload.approver ?? ""), String(decided?.payload.method ?? ""), decided?.ts ?? "",
        String(cosigned?.payload.approver ?? ""), executed?.ts ?? ""];
    }));

  const links = chain.check.ok ? { ok: true, rows: chain.check.rows, head: chain.check.head } : { ok: false, rows: 0, head: "" };
  const auditCsv = csv(["seq", "prev_hash", "row_hash"], t.audit.links.map((l) => [String(l.seq), l.prev_hash, l.row_hash]));

  // Money per rail and currency, from the payments (the fee is the transfer's own journal line).
  const money: PackSummary["money"] = [];
  for (const [rail, currency] of [["metal", "USDZ"], ["airwallex_card", "EUR"], ["airwallex_swift", "EUR"]] as const) {
    const mine = t.payments.filter((p) => p.rail === rail && p.currency === currency);
    const sum = (f: (p: (typeof mine)[number]) => boolean) => fromCents(mine.filter(f).reduce((n, p) => n + toCents(p.amount), 0));
    money.push({ rail, currency, in: sum((p) => p.kind === "sale"), out: sum((p) => p.kind !== "sale") });
  }
  const summary: PackSummary = {
    label, line: PACK_LINE, t0: t0Line(),
    payments: { count: `${c.line}`, metal: c.metalParts, total: c.n },
    money,
    reconcile: { at: s.reconciliation.at, checked: s.reconciliation.checked, differences: s.reconciliation.differences, agrees: s.reconciliation.checked === c.n && s.reconciliation.differences === 0 },
    books: { postings: postings.length, balanced: [...new Set(trial.map((x) => x.currency))].every((cur) => trial.filter((x) => x.currency === cur).reduce((n, x) => n + x.balance_cents, 0) === 0), trial: trial.map((x) => ({ account: x.account, name: x.name, currency: x.currency, debit: fromCents(x.debit_cents), credit: fromCents(x.credit_cents), balance: signed(x.balance_cents) })) },
    audit: { recorded: { rows: s.audit.rows, head: s.audit.head, intact: s.audit.intact }, links, proves: chain.proves.replace(" (checked when this page was built)", " (checked when this pack was built)"), does_not: chain.doesNot },
  };

  const verify = [
    `${PACK_LINE} ${label} ${RECORD_UNCHANGED}`, "",
    `Recorded on 3 Nov (verifyAuditChain on the run's ledger): ${s.audit.rows} rows, head ${s.audit.head}, ${s.audit.intact ? "intact" : "BROKEN"}.`,
    `Checked when this pack was built (checkChainLinks on audit-chain.csv): ${links.ok ? `${links.rows} links, from the genesis to head ${links.head}, unbroken` : "BROKEN"}; ${links.ok && links.head === s.audit.head && links.rows === s.audit.rows ? "the same head and length as recorded" : "NOT the recorded head"}.`,
    "", summary.audit.proves, summary.audit.does_not, "",
  ].join("\n");

  const readme = `# Purser month-end pack: the main run, 3 November 2026

${PACK_LINE}

${label} ${RECORD_UNCHANGED}

${summary.t0}

## Totals

- Payments: ${c.line}. On Metal: ${c.metalParts}.
${money.map((m) => `- ${RAIL_NAME[m.rail]} (${m.currency === "USDZ" ? "test USD" : m.currency}): in ${m.in}, out ${m.out}`).join("\n")}
- The SWIFT transfer's fee is booked on its own line (account 6800) in journal.csv.
- Reconcile (${s.reconciliation.at}): ${s.reconciliation.checked} flows checked against Airwallex and Metal, ${s.reconciliation.differences} differences. ${summary.reconcile.agrees ? `They are the ${c.n} payments in this pack.` : "They do NOT match this pack's payments."}
- Books: ${postings.length} postings, ${summary.books.balanced ? "debits equal credits in every currency" : "NOT balanced"}.

## Files

Each CSV starts with one line beginning with "#": this pack's label. Skip it; the column names are on the next line.

- journal.csv: the GL export (\`npm run gl\`), one line per movement of money, with its GL account, cost centre, bank account, \`proof\` (the rail id: a Metal transaction, an Airwallex id) and \`approval\` (the proposal), plus \`approval_sha256\`, the hash of the terms the CFO signed for it.
- postings.csv: the same journal in double entry (\`npm run books -- --csv\`), opening balances first.
- payments.csv: the ${c.n} payments, each with its rail id (and explorer link on Metal), approval hash, who decided it (agent, model, request id), the lock that held it or its proposal, its booking entries and its audit row. /trace shows the same, step by step.
- approvals.csv: every proposal of the run, the hash of its terms, and who decided it, how and when.
- audit-chain.csv: the audit chain as published: seq, prev_hash and row_hash per row, nothing else from the rows.
- verify.txt: the chain's check, recorded and rebuilt.
- summary.json: these totals, the trial balance and the checks, as data.

## How to check it

1. A Metal payment: open its explorer link (payments.csv); the amount and the parties are on chain.
2. The books: in postings.csv, debits equal credits per currency; the trial balance is in summary.json.
3. The payments against reconcile: payments.csv has ${c.n} rows; reconcile checked ${s.reconciliation.checked} flows with ${s.reconciliation.differences} differences.
4. The audit chain: in audit-chain.csv the first prev_hash is 64 zeros and each prev_hash is the row_hash of the row before; the last row_hash is the recorded head. That proves the linkage and the head; it does not prove what any row says, since the rows are not published (verify.txt).
5. An Airwallex id (the card charge, the SWIFT transfer, the FX conversion) is in Airwallex's sandbox, which is not public: it is checked by reconcile, not by you.
6. Rebuild this pack: \`npm run month-end-pack\` in the repository writes the same bytes from ${AGENT_RUN_FILE} and ${TRACE_FILE}.
`;

  const files = [
    { path: "README.md", content: readme },
    { path: "journal.csv", content: labelled(label, journal) },
    { path: "postings.csv", content: labelled(label, booksCsv(postings)) },
    { path: "payments.csv", content: labelled(label, payments) },
    { path: "approvals.csv", content: labelled(label, approvals) },
    { path: "audit-chain.csv", content: labelled(label, auditCsv) },
    { path: "verify.txt", content: verify },
    { path: "summary.json", content: JSON.stringify(summary, null, 2) + "\n" },
  ];
  const at = `${t.generated}T00:00:00Z`;
  const dir = PACK_NAME.replace(/\.zip$/, "");
  return { name: PACK_NAME, at, files, summary, zip: zipStore(files.map((f) => ({ path: `${dir}/${f.path}`, content: f.content })), at) };
}
