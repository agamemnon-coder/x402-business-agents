// npm run fail -- f1 | f2 | f4: failure tests run live.
// F1, Airwallex sandbox, in steps with a person: the December invoice is proposed on a 1-minute quote; a person
//   approves only after it ran out, which approves nothing; the agent then re-quotes, and the new hash needs a
//   new approval. Run `npm run fail -- f1` again after each step; it says what comes next.
// F2(b), Metal testnet: a refund over the support mandate's per-payment cap (0.10) is refused before anything
//   is sent, and the mandate's spend does not move.
// F4(b), Airwallex sandbox: an invoice whose shortfall conversion would take USD under its floor escalates
//   with options; no proposal, conversion or transfer is made and the balances do not move.
// F1 (executor side), F3(b), F5, F6, F8 and F9 also run as unit tests (npm test); F2(a) and F3(a) are part of S1 and S2.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { proposeInvoicePayment, treasuryState, type InvoicePaymentTerms } from "../agents/euroBill.js";
import { parseInvoiceFallback } from "../agents/invoice.js";
import { AirwallexRest } from "../airwallex/adapter.js";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { openDb } from "../db/open.js";
import { baseUnitsToCents, fromCents } from "../lib/money.js";
import { metalAgent } from "../metal/agentCli.js";
import { activeMandate, mandateSpent } from "../metal/mandate.js";
import { addresses } from "../world/runtime.js";

const which = process.argv[2];
if (which === "f1") await f1();
if (which === "f4") await f4();
if (which !== "f2") {
  console.error("usage: npm run fail -- f1 | f2 | f4");
  process.exit(2);
}
const addr = addresses(openDb());
const m = await activeMandate("support");
const before = await mandateSpent(m);
const r = metalAgent(["mandate", "pull", "--credential", m.credentialPath, "--mandate-key-file", m.keyFile, "--to", addr.customer, "--amount", "0.11", "--payment-id", `f2-over-cap-${Date.now()}`], [0, 1, 3, 4]);
const after = await mandateSpent(m);
const reason = r.fields.get("reason")?.[0] ?? r.out.trim().split("\n").at(-1) ?? "";
const pass = r.code === 1 && /mandate_cap_exceeded/.test(r.out) && after === before;
console.log(`F2(b) support pull 0.11 against cap 0.10: exit ${r.code}, ${reason}`);
console.log(`      spent before ${fromCents(baseUnitsToCents(before))}, after ${fromCents(baseUnitsToCents(after))}`);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);

async function f4(): Promise<never> {
  const cfg = fromEnv();
  if (!cfg) {
    console.log("BLOCKED  F4(b) needs AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY");
    process.exit(1);
  }
  const db = openDb();
  const rail = new AirwallexRest(new Airwallex(cfg));
  const text = readFileSync(resolve(import.meta.dirname, "../../fixtures/bergtex-invoice-BTX-2027-ANNUAL.txt"), "utf8");
  const inv = parseInvoiceFallback(text);
  const before = await rail.balances();
  const s = treasuryState(db, before);
  const proposals = () => (db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n;
  const n0 = proposals();
  console.log(`F4(b) invoice ${inv.invoice_no}: EUR ${inv.amount}; free EUR ${fromCents(Math.max(0, s.eurAvailableCents - s.eurFloorCents - s.eurObligationsCents))}, USD ${fromCents(s.usdAvailableCents)} (floor ${fromCents(s.usdFloorCents)})`);
  const out = await proposeInvoicePayment(db, rail, inv, text);
  const after = await rail.balances();
  const moved = (["EUR", "USD"] as const).filter((c) => before[c]?.availableCents !== after[c]?.availableCents);
  console.log(`      ${out.kind === "escalated" ? `escalated: ${out.reason}` : `NOT escalated: ${out.proposal.proposal_id}`}`);
  console.log(`      balances ${moved.length ? `moved (${moved.join(", ")})` : "unchanged"}; new proposals ${proposals() - n0}`);
  const pass = out.kind === "escalated" && /USD would drop/.test(out.reason) && moved.length === 0 && proposals() === n0;
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
}

async function f1(): Promise<never> {
  const cfg = fromEnv();
  if (!cfg) {
    console.log("BLOCKED  F1 needs AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY");
    process.exit(1);
  }
  const db = openDb();
  const api = new Airwallex(cfg);
  const rail = new AirwallexRest(api);
  const text = readFileSync(resolve(import.meta.dirname, "../../fixtures/bergtex-invoice-BTX-2026-12.txt"), "utf8");
  const inv = parseInvoiceFallback(text);
  type Row = { proposal_id: string; status: string; terms_sha256: string; terms_json: string; expires_at: string };
  const rows = db.prepare("SELECT proposal_id, status, terms_sha256, terms_json, expires_at FROM proposals WHERE kind = 'invoice_payment' AND json_extract(terms_json, '$.invoice_no') = ? ORDER BY created_at").all(inv.invoice_no) as Row[];
  const show = (r: Row) => {
    const t = JSON.parse(r.terms_json) as InvoicePaymentTerms;
    return `${r.proposal_id} sha256 ${r.terms_sha256.slice(0, 8)}…, quote ${t.conversion?.quote_id ?? "none"} valid to ${t.conversion?.valid_to ?? "-"}, proposal expires ${r.expires_at}`;
  };
  const propose = async (validity: "MIN_1" | "MIN_15") => {
    const out = await proposeInvoicePayment(db, rail, inv, text, new Date(), validity);
    if (out.kind === "escalated") {
      console.log(`      escalated instead: ${out.reason}`);
      process.exit(1);
    }
    return out.proposal as unknown as Row;
  };

  const first = rows[0];
  if (!first) {
    const p = await propose("MIN_1");
    console.log(`F1 step 1  invoice ${inv.invoice_no}, EUR ${inv.amount}, proposed on a 1-minute quote:`);
    console.log(`           ${show(p)}`);
    console.log(`           next: after ${p.expires_at}, a person approves it: npm run approve -- ${p.proposal_id} ${p.terms_sha256.slice(0, 8)}`);
    process.exit(0);
  }
  const tooLate = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'approval.too_late' AND subject = ?").get(first.proposal_id) as { payload_json: string } | undefined;
  if (first.status === "PENDING_APPROVAL" || (first.status === "EXPIRED" && !tooLate)) {
    console.log(`F1 waiting ${show(first)}`);
    console.log(`           next: a person approves it after it ran out: npm run approve -- ${first.proposal_id} ${first.terms_sha256.slice(0, 8)}`);
    process.exit(0);
  }
  if (first.status !== "EXPIRED") {
    console.log(`FAIL       ${first.proposal_id} is ${first.status}; the late approval was not refused`);
    process.exit(1);
  }
  const t = JSON.parse(first.terms_json) as InvoicePaymentTerms;
  const conv = (await api.call("GET", "/fx/conversions", undefined, { request_id: t.conversion!.request_id, page_num: "0", page_size: "10" })) as { items: unknown[] };
  const tr = (await api.call("GET", "/transfers", undefined, { request_id: t.transfer_request_id, page_num: "0", page_size: "10" })) as { items: unknown[] };
  const who = (JSON.parse(tooLate!.payload_json) as { approver: string }).approver;
  const refused = conv.items.length === 0 && tr.items.length === 0;
  console.log(`F1 step 2  ${first.proposal_id}: approval by ${who} arrived after ${first.expires_at}; status EXPIRED`);
  console.log(`           Airwallex: ${conv.items.length} conversions, ${tr.items.length} transfers for its request ids ${refused ? "(nothing moved)" : "(UNEXPECTED)"}`);
  if (!refused) {
    console.log("FAIL");
    process.exit(1);
  }
  const second = rows[1];
  if (!second) {
    const p = await propose("MIN_15");
    console.log(`           re-quoted: ${show(p)}`);
    console.log(`           the hash changed (${first.terms_sha256.slice(0, 8)} -> ${p.terms_sha256.slice(0, 8)}), so it needs a new approval: npm run approve -- ${p.proposal_id} ${p.terms_sha256.slice(0, 8)}`);
    process.exit(0);
  }
  console.log(`F1 step 3  ${show(second)}: ${second.status}`);
  const pass = second.status === "EXECUTED" && second.terms_sha256 !== first.terms_sha256;
  console.log(pass ? "PASS       the late approval moved nothing; the re-quoted terms were approved and paid" : "waiting for the re-quoted proposal to be approved and executed");
  process.exit(pass ? 0 : 1);
}
