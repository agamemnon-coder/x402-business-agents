// npm run tokenize -- record: the run record of a live invoice-token run, docs/runs/<date>-tokenize.md and .json, in
// the form of docs/tokenize-run-template.md. Everything in it is read from the run's own ledger (its transactions,
// each with the hash that was stored before it was sent), the call log, and the source ledger (which passkey approved
// the invoice, and when). Nothing is typed by hand and no request is made. What only a person knows (Max's go in
// words, what did not go as planned) comes from optional text the operator names; without it the record says so.
//
// The record carries its labels: prototype, Metal testnet, test money, the financier simulated, the face value scaled.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import Database from "better-sqlite3";
import type { Address, Hex } from "viem";
import { CHAIN_ID, EXPLORER_TX } from "../metal/network.js";
import { callLog, usdzText } from "./live.js";
import { openRunLedger } from "./ledger.js";
import { ROLES, type Role } from "./keys.js";
import { STEP_TXS, TX_STEPS } from "./plan.js";
import { approvalPasskey, approvedInvoice } from "./record.js";

export const RUN_RECORD_KIND = "tokenize-run";
/** A passkey enrolled under a label like this is a test passkey, not a person's (src/tokenize/standIn.ts, src/cli/twoLocks.ts). */
const TEST_PASSKEY_LABEL = /virtual|test/i;

export interface RunRecordTx {
  key: string;
  /** The row of the run template this transaction fills. */
  what: string;
  hash: Hex;
  explorer: string;
  from: Address;
  /** Which of the run's keys sent it: a role, or the donor that funded them. */
  sender: Role | "donor";
  status: "success" | "reverted" | "signed";
  at: string;
  gas_limit: string;
  gas_used: string | null;
  block: string | null;
}

export interface TokenizeRunRecord {
  kind: typeof RUN_RECORD_KIND;
  recorded_at: string;
  /** The UTC day of the run's first transaction. */
  date: string;
  labels: { prototype: true; network: "Metal testnet"; chain_id: number; test_money: true; financier: "simulated"; face_value_scaled_by: number };
  /** Max's go in the operator's words, or null when none was given to the record. */
  go: string | null;
  invoice: {
    proposal_id: string; kind: string; invoice_no: string; amount: string; currency: string; terms_sha256: string; document_sha256: string;
    approval: { method: "passkey"; passkey_fingerprint: string; approved_at: string; test_passkey: boolean; passkey_label: string | null; described_in: string | null };
  };
  face_value: { amount: string; unit: "*USDZ"; divisor: number };
  discount: { bps: number; price: string } | null;
  roles: Record<Role, Address>;
  contract: Address | null;
  token_id: Hex | null;
  transactions: RunRecordTx[];
  received: { creditor: string | null; creditor_address: Address | null; holder: string | null; holder_address: Address | null };
  verify: { ok: boolean; at: string; mismatches: string[]; settled_on_chain: boolean } | null;
  calls: { used: number; budget_total: number | null; by_command: Record<string, number> };
  deviations: { from_ledger: string[]; notes: string | null };
  sources: { ledger: string; call_log: string; source_ledger: string };
}

export interface RecordInputs {
  /** TOKENIZE_DB, TOKENIZE_CALL_LOG, TOKENIZE_SOURCE_DB, TOKENIZE_PROPOSAL; optional TOKENIZE_DEVIATIONS, TOKENIZE_GO_NOTE, TOKENIZE_APPROVAL_RECORD. */
  env: Record<string, string | undefined>;
  now?: () => Date;
  /** The repository's root: the record goes to docs/runs under it. */
  repo?: string;
}

const REPO = resolve(import.meta.dirname, "../..");
const money = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
const parse = <T>(s: string | undefined): T | null => (s ? (JSON.parse(s) as T) : null);

/** What the record command needs; each line names a variable. */
export function recordRefusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (!env.TOKENIZE_DB || !existsSync(env.TOKENIZE_DB)) why.push("TOKENIZE_DB (this run's own ledger; it names no file yet)");
  if (!env.TOKENIZE_CALL_LOG || !existsSync(env.TOKENIZE_CALL_LOG)) why.push("TOKENIZE_CALL_LOG (the run's call log; it names no file yet)");
  if (!env.TOKENIZE_SOURCE_DB || !existsSync(env.TOKENIZE_SOURCE_DB)) why.push("TOKENIZE_SOURCE_DB (the ledger with the passkey approval, opened read-only)");
  if (!env.TOKENIZE_PROPOSAL) why.push("TOKENIZE_PROPOSAL (the approved proposal id)");
  for (const k of ["TOKENIZE_DEVIATIONS", "TOKENIZE_APPROVAL_RECORD"] as const) if (env[k] && !existsSync(env[k]!)) why.push(`${k} names no file`);
  return why;
}

/** The record, from the three files alone. Throws when the ledger holds no transaction, or is another invoice's. */
export function buildRunRecord(i: RecordInputs): TokenizeRunRecord {
  const { env } = i;
  const repo = i.repo ?? REPO;
  const ledger = openRunLedger(env.TOKENIZE_DB!, { readonly: true });
  let txs: ReturnType<typeof ledger.txs>, state: Record<string, string>;
  try { txs = ledger.txs(); state = ledger.state(); } finally { ledger.close(); }
  if (!txs.length) throw new Error("this run's ledger holds no transaction: nothing ran, so there is nothing to record");

  const src = new Database(env.TOKENIZE_SOURCE_DB!, { readonly: true, fileMustExist: true });
  let inv: ReturnType<typeof approvedInvoice>, passkey: ReturnType<typeof approvalPasskey>;
  try { inv = approvedInvoice(src, env.TOKENIZE_PROPOSAL!); passkey = approvalPasskey(src, env.TOKENIZE_PROPOSAL!); } finally { src.close(); }
  const minted = parse<{ proposal_id: string; terms_sha256: string; document_sha256: string; divisor: number }>(state.invoice);
  if (minted && (minted.proposal_id !== inv.proposalId || minted.terms_sha256 !== inv.termsSha256)) throw new Error("the source ledger's proposal is not the one this run's ledger minted");

  const roles = parse<Record<Role, Address>>(state.roles);
  if (!roles) throw new Error("this run's ledger names no role addresses");
  const senderOf = (a: string): Role | "donor" => ROLES.find((r) => roles[r].toLowerCase() === a.toLowerCase()) ?? "donor";
  const whatOf = new Map(TX_STEPS.flatMap((s) => STEP_TXS[s]).map((t) => [t.key, t.what]));
  const transactions: RunRecordTx[] = txs.map((t) => ({
    key: t.key, what: whatOf.get(t.key) ?? t.step, hash: t.hash, explorer: `${EXPLORER_TX}${t.hash}`, from: t.from_addr as Address, sender: senderOf(t.from_addr),
    status: t.status, at: t.at, gas_limit: t.gas, gas_used: t.gas_used, block: t.block,
  }));

  const financed = parse<{ seller: Address; price: string }>(state.financed);
  const settled = parse<{ holder: Address; face_value: string }>(state.settled);
  const verify = parse<{ ok: boolean; at: string; mismatches: string[]; settled_on_chain: boolean }>(state.verify);
  const faceValue = state.face_value ? BigInt(state.face_value) : null;
  const divisor = minted?.divisor ?? null;

  const lines = callLog(env.TOKENIZE_CALL_LOG!).lines();
  const byCommand: Record<string, number> = {};
  for (const l of lines) { const cmd = l.split(/\s+/)[1] ?? "?"; byCommand[cmd] = (byCommand[cmd] ?? 0) + 1; }
  const lastTotal = /\s\d+\/(\d+)\s*$/.exec(lines.at(-1) ?? "")?.[1];

  // What the ledger itself shows went differently: a transaction that reverted, or one still without a receipt.
  const fromLedger = [
    ...transactions.filter((t) => t.status === "reverted").map((t) => `${t.what}: transaction ${t.hash} reverted on chain.`),
    ...transactions.filter((t) => t.status === "signed").map((t) => `${t.what}: transaction ${t.hash} was signed and recorded, and has no receipt in the ledger.`),
  ];
  const notes = env.TOKENIZE_DEVIATIONS ? readFileSync(env.TOKENIZE_DEVIATIONS, "utf8").trim() || null : null;

  // An earlier run's record that describes the approval (who, on what device): linked only when it names this passkey.
  let describedIn: string | null = null;
  if (env.TOKENIZE_APPROVAL_RECORD) {
    const path = resolve(env.TOKENIZE_APPROVAL_RECORD);
    if (!readFileSync(path, "utf8").includes(passkey.fingerprint)) throw new Error("TOKENIZE_APPROVAL_RECORD does not name the passkey that approved this invoice");
    describedIn = relative(repo, path);
    if (describedIn.startsWith("..")) throw new Error("TOKENIZE_APPROVAL_RECORD must be a file in this repository");
  }
  const testPasskey = TEST_PASSKEY_LABEL.test(passkey.label);

  return {
    kind: RUN_RECORD_KIND,
    recorded_at: (i.now ?? (() => new Date()))().toISOString(),
    date: txs[0]!.at.slice(0, 10),
    labels: { prototype: true, network: "Metal testnet", chain_id: CHAIN_ID, test_money: true, financier: "simulated", face_value_scaled_by: divisor ?? 0 },
    go: env.TOKENIZE_GO_NOTE?.trim() || null,
    invoice: {
      proposal_id: inv.proposalId, kind: inv.kind, invoice_no: inv.invoiceNo, amount: money(inv.amountCents), currency: inv.currency, terms_sha256: inv.termsSha256, document_sha256: inv.documentSha256,
      approval: { method: "passkey", passkey_fingerprint: passkey.fingerprint, approved_at: inv.approvedAt, test_passkey: testPasskey, passkey_label: testPasskey ? passkey.label : null, described_in: describedIn },
    },
    face_value: { amount: faceValue === null ? "" : usdzText(faceValue), unit: "*USDZ", divisor: divisor ?? 0 },
    discount: state.price && state.discount_bps ? { bps: Number(state.discount_bps), price: usdzText(BigInt(state.price)) } : null,
    roles,
    contract: (state.contract as Address | undefined) ?? null,
    token_id: state.token_id ? (`0x${BigInt(state.token_id).toString(16).padStart(64, "0")}` as Hex) : null,
    transactions,
    received: {
      creditor: financed ? usdzText(BigInt(financed.price)) : null, creditor_address: financed?.seller ?? null,
      holder: settled ? usdzText(BigInt(settled.face_value)) : null, holder_address: settled?.holder ?? null,
    },
    verify: verify ? { ok: verify.ok, at: verify.at, mismatches: verify.mismatches, settled_on_chain: verify.settled_on_chain } : null,
    calls: { used: lines.length, budget_total: lastTotal ? Number(lastTotal) : state.budget_total ? Number(state.budget_total) : null, by_command: byCommand },
    deviations: { from_ledger: fromLedger, notes },
    sources: { ledger: "tokenize_state and tokenize_txs in TOKENIZE_DB", call_log: "TOKENIZE_CALL_LOG, one line per request", source_ledger: "proposals, approvals, passkey_assertions and passkeys in TOKENIZE_SOURCE_DB, read-only" },
  };
}

const dayLong = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const minute = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const code = (s: string) => `\`${s}\``;

export const runRecordName = (rec: TokenizeRunRecord) => `${rec.date}-tokenize`;

/** The record as the run template lays it out. Every figure is a field of `rec`. */
export function runRecordMarkdown(rec: TokenizeRunRecord): string {
  const a = rec.invoice.approval, minted = rec.transactions.some((t) => t.key === "mint" && t.status === "success");
  const amount = `${rec.invoice.currency} ${rec.invoice.amount}`;
  const approvedBy = a.test_passkey
    ? `a labelled test passkey ("${a.passkey_label}"), not a phone`
    : `not a labelled test passkey${a.described_in ? `; who approved, and on what device, is in [${a.described_in}](${relative("docs/runs", a.described_in)})` : ""}`;
  const calls = Object.entries(rec.calls.by_command).map(([c, n]) => `${c} ${n}`).join(", ");
  // Who held the token when it was settled, when it is one of the run's own keys.
  const holderRole = ROLES.find((r) => rec.roles[r].toLowerCase() === rec.received.holder_address?.toLowerCase());
  const holderIs = holderRole === "financier" ? " (the simulated financier)" : holderRole ? ` (the ${holderRole})` : "";
  const rows = rec.transactions.map((t) => `| ${t.what} | [${code(t.hash)}](${t.explorer}) | ${t.status === "success" ? "success" : t.status === "reverted" ? "reverted on chain" : "signed, no receipt recorded"}${t.block ? `, block ${t.block}` : ""}${t.gas_used ? `, gas ${t.gas_used} of ${t.gas_limit}` : ""} |`);
  const notRun = TX_STEPS.flatMap((s) => STEP_TXS[s]).filter((s) => !s.key.startsWith("fund-") && !rec.transactions.some((t) => t.key === s.key)).map((s) => `| ${s.what} | not sent | |`);
  const deviations = [...rec.deviations.from_ledger.map((d) => `- ${d}`), ...(rec.deviations.notes ? ["", rec.deviations.notes] : [])];
  return `# Invoice token on Metal testnet (prototype): the run of ${dayLong(rec.date)}

**Prototype. Metal testnet (chain id ${rec.labels.chain_id}), test money only. The financier is simulated${rec.labels.face_value_scaled_by ? `. The face value is the invoice amount divided by ${rec.labels.face_value_scaled_by}` : ""}.**
Written by \`npm run tokenize -- record\` from the run's own ledger, its call log and the source ledger; no figure here
is typed by hand. [What this is](../tokenize.md) · [the same record as JSON](${runRecordName(rec)}.json)

## Before the run

- **Max's go:** ${rec.go ?? "given before the run: every live command refuses without `TOKENIZE_GO=yes`. Its words and time were not given to this record."}
- **Call budget:** ${rec.calls.budget_total ?? "not recorded"} Metal RPC calls for the whole run (\`TOKENIZE_CALL_BUDGET_TOTAL\`), funding the four test keys included.
- **Invoice:**
  - proposal ${code(rec.invoice.proposal_id)} (${rec.invoice.kind}), invoice ${code(rec.invoice.invoice_no)}, ${amount}
  - signed terms SHA-256 ${code(rec.invoice.terms_sha256)}
  - document SHA-256 ${code(rec.invoice.document_sha256)}
  - approved on ${minute(a.approved_at)} by passkey ${code(a.passkey_fingerprint)}: ${approvedBy}. Read from the source ledger.
- **Face value:** ${minted ? `${amount} ÷ ${rec.face_value.divisor} = ${rec.face_value.amount} *USDZ (test money, no exchange rate)` : "no token was minted"}
- **Discount:** ${rec.discount ? `${rec.discount.bps / 100}% (${rec.discount.bps} basis points): the simulated financier's price is ${rec.discount.price} *USDZ` : "the token was not offered"}
- **Keys (addresses only):** issuer ${code(rec.roles.issuer)}, creditor ${code(rec.roles.creditor)}, financier (simulated) ${code(rec.roles.financier)}, payer ${code(rec.roles.payer)}
- **Contract:** ${rec.contract ? code(rec.contract) : "not deployed"}${rec.token_id ? `; token id ${code(rec.token_id)} (the document hash)` : ""}

## Transactions

Each hash was written to the run's ledger before its transaction was sent.

| Step | Transaction | Result |
|---|---|---|
${[...rows, ...notRun].join("\n")}

## Checks

- \`verify\`: ${rec.verify ? `${rec.verify.ok ? "yes, the chain record matches the ledger and the document" : `no: ${rec.verify.mismatches.join("; ") || "the token id is not the document hash"}`} (${minute(rec.verify.at)})${rec.verify.settled_on_chain ? "; the chain marks the invoice settled" : ""}.` : "not run."}
- ${rec.received.creditor ? `The creditor ${code(rec.received.creditor_address!)} received ${rec.received.creditor} *USDZ (the contract's Financed event)` : "The token was not financed"}${rec.received.holder ? `, and the holder ${code(rec.received.holder_address!)}${holderIs} received ${rec.received.holder} *USDZ at settlement (the contract's Settled event).` : "; it was not settled."}
- Calls used: ${rec.calls.used} of ${rec.calls.budget_total ?? "an unrecorded budget"} (from \`TOKENIZE_CALL_LOG\`)${calls ? `: ${calls}` : ""}.

## What did not go as planned

${deviations.length ? deviations.join("\n") : "Nothing in the ledger: every recorded transaction succeeded. No notes were given to this record."}
`;
}

/** Writes docs/runs/<date>-tokenize.json and .md under `repo`; returns their paths. */
export function writeRunRecord(i: RecordInputs): { json: string; md: string; record: TokenizeRunRecord } {
  const rec = buildRunRecord(i);
  const dir = join(i.repo ?? REPO, "docs/runs");
  const json = join(dir, `${runRecordName(rec)}.json`), md = join(dir, `${runRecordName(rec)}.md`);
  mkdirSync(dirname(json), { recursive: true });
  writeFileSync(json, `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(md, runRecordMarkdown(rec));
  return { json, md, record: rec };
}
