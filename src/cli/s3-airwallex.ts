// The Airwallex side of scenario S3, run by npm run s3 once the sandbox keys are set.

import { agentsOn } from "../config/agents.js";
import { adviseTiming } from "../agents/timingAgent.js";
import { approvalHint } from "./hint.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { proposeInvoicePayment, seedTreasury } from "../agents/euroBill.js";
import { attachReview } from "../claude/review.js";
import { Tools } from "../claude/tools.js";
import { ClaudeReader, claudeClient } from "../claude/reader.js";
import type Anthropic from "@anthropic-ai/sdk";
import { bookCredit } from "../agents/sweep.js";
import { AirwallexRest } from "../airwallex/adapter.js";
import type { AirwallexRail } from "../airwallex/port.js";
import { Airwallex, type AirwallexConfig } from "../airwallex/client.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { expireDue } from "../policy/approvals.js";

export async function runAirwallexSide(db: DB, cfg: AirwallexConfig, eventKey: string, o: { invoice?: boolean } = {}): Promise<void> {
  const rest = new AirwallexRest(new Airwallex(cfg));
  const s = await seedTreasury(db, rest, rest);
  console.log(`TREASURY         EUR ${fromCents(s.eurAvailableCents)} available (floor ${fromCents(s.eurFloorCents)}, committed ${fromCents(s.eurObligationsCents)}); USD ${fromCents(s.usdAvailableCents)} (floor ${fromCents(s.usdFloorCents)})`);

  const credit = await bookCredit(db, rest, rest, eventKey);
  console.log(`CREDIT           ${eventKey} -> Airwallex deposit ${credit.depositId}${credit.adopted ? " (already booked)" : ""}; reference = tx hash; 1 *USDZ = 1 USD (SIMULATED deposit: the sandbox cannot receive stablecoins)`);

  // --sweep-only (the Treasury agent's sweep): the credit is booked; no invoice is planned.
  if (o.invoice !== false) await planInvoice(db, rest, s, "bergtex-invoice-BTX-2026-11.txt");
}

/**
 * Reads an invoice from fixtures/, checks it, and plans its payment as one proposal for the CFO's Face ID: the euros
 * it needs, only the shortfall converted on a locked quote, the SWIFT fee ceiling. Used for the manufacturer's invoice
 * (S3) and Kit 11's monthly licence fee (npm run licence). Nothing moves until the proposal is approved.
 */
export async function planInvoice(
  db: DB, rest: AirwallexRail, s: Awaited<ReturnType<typeof seedTreasury>>, fixture: string,
  // The Claude client for the reads, the review and the timing advice: the environment's by default; null runs code's
  // own parser with no model (the stand-ins, src/awx/standIn.ts, never reach Claude whatever the environment holds).
  o: { claude?: Anthropic | null; agents?: boolean } = {},
): Promise<void> {
  const path = resolve(import.meta.dirname, `../../fixtures/${fixture}`);
  const text = readFileSync(path, "utf8");
  const tools = o.claude === undefined ? new Tools(db) : new Tools(db, new ClaudeReader(db, o.claude));
  const kind = await tools.classify(text);
  if (kind.value.kind !== "invoice") throw new Error(`escalate: expected an invoice, ${kind.source} read ${kind.value.kind}`);
  const read = await tools.invoice(text);
  const inv = read.value;
  console.log(`                 read by ${read.source === "claude" ? `${kind.model} (classify) and ${read.model} (extract)` : `the deterministic parser (${read.note})`}`);
  console.log(`NEW INFORMATION  invoice ${inv.invoice_no} from ${inv.vendor}: EUR ${inv.amount}, due ${inv.due_date}`);

  // A lapsed proposal must not block a new plan: expire it first, as the proposals list does.
  expireDue(db);
  const pending = db.prepare("SELECT proposal_id, status, terms_sha256 FROM proposals WHERE kind = 'invoice_payment' AND json_extract(terms_json, '$.invoice_no') = ? AND status IN ('PENDING_APPROVAL', 'APPROVED', 'EXECUTED')").get(inv.invoice_no) as
    { proposal_id: string; status: string; terms_sha256: string } | undefined;
  if (pending) {
    console.log(`                 ${pending.proposal_id} is ${pending.status}; nothing new to plan`);
    return;
  }
  const out = await proposeInvoicePayment(db, rest, inv, text);
  if (out.kind === "escalated") {
    console.log(`ESCALATION       ${out.reason}`);
    return;
  }
  const t = out.terms;
  const need = Number(t.amount) + Number(t.fee_max);
  console.log(`PLAN             EUR needed ${need.toFixed(2)} (invoice ${t.amount} + SWIFT fee at most ${t.fee_max}); free EUR ${fromCents(Math.max(0, s.eurAvailableCents - s.eurFloorCents - s.eurObligationsCents))}`);
  if (t.conversion) {
    console.log(`                 convert only the shortfall: buy EUR ${t.conversion.buy_amount} for USD ${t.conversion.sell_amount} at ${t.conversion.client_rate}, quote ${t.conversion.quote_id} valid to ${t.conversion.valid_to}`);
  }
  console.log(`                 after: EUR free ${t.after.eur_free}, USD ${t.after.usd_available} (floor ${t.floors.usd_floor})`);
  // Block 5.3: with the agents on, the Treasury agent reads the position and the quote and advises when to pay.
  if (o.agents ?? agentsOn()) {
    const today = new Date().toISOString().slice(0, 10);
    const a = await adviseTiming(db, {
      proposalId: out.proposal.proposal_id, invoiceNo: inv.invoice_no, vendor: inv.vendor, amount: t.amount, dueDate: inv.due_date, today,
      eurAvailable: t.balances_before.eur_available, eurFloor: t.floors.eur_floor, eurObligations: t.floors.eur_obligations, usdAvailable: t.balances_before.usd_available, usdFloor: t.floors.usd_floor,
      quote: t.conversion ? { sell: `${t.conversion.sell_currency} ${t.conversion.sell_amount}`, buy: `${t.conversion.buy_currency} ${t.conversion.buy_amount}`, rate: t.conversion.client_rate, validTo: t.conversion.valid_to } : null,
      after: { eurFree: t.after.eur_free, usdAvailable: t.after.usd_available }, feeMax: t.fee_max,
    }, o.claude === undefined ? claudeClient() : o.claude);
    console.log(`TREASURY AGENT   ${a.source === "claude" ? `${a.run.model ?? "Claude"}: advises ${a.timing === "pay_now" ? "paying now" : `waiting until ${a.date}`}: "${a.reason}"` : "no advice (the agent did not decide); the proposal stands as code planned it"}`);
  }
  const review = await attachReview(db, tools, out.proposal, `Invoice ${inv.invoice_no} matches the allowlisted beneficiary. Free EUR before: ${fromCents(Math.max(0, s.eurAvailableCents - s.eurFloorCents - s.eurObligationsCents))}.`);
  console.log(`REVIEW           ${review.recommendation} (${review.source === "claude" ? "Opus, advisory" : "no model"}): ${review.summary}`);
  console.log(`APPROVAL         ${out.proposal.proposal_id} expires ${t.expires_at}, sha256 ${out.proposal.terms_sha256}`);
  console.log(`                 ${approvalHint(db, out.proposal.proposal_id, out.proposal.terms_sha256.slice(0, 8))}`);
}
