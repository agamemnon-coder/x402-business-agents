// Refunds are `mandate pull`s under the support agent's mandate (payee: the customer only, cap 0.10).
// Each carries the payment id refund-<sale_id>: the database allows one refund per sale, and metal-agent
// pays a payment id at most once, so a retry after a crash reports the first outcome instead of paying again.

import type { Address } from "viem";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { metalAgent } from "../metal/agentCli.js";
import { activeMandate } from "../metal/mandate.js";

export type RefundOutcome = "PAID" | "REFUSED" | "PENDING" | "HELD";

export interface RefundResult {
  sale_id: number;
  payment_id: string;
  outcome: RefundOutcome;
  tx: string | null;
  reason: string | null;
  already: boolean;
}

const EXIT: Record<number, RefundOutcome> = { 0: "PAID", 1: "REFUSED", 3: "PENDING", 4: "HELD" };

export async function refundSale(
  db: DB,
  r: { sale_id: number; amount_cents: number; to: Address; dispute_id: string; proposal_id?: string },
  opts: { retry?: boolean } = {},
): Promise<RefundResult> {
  const paymentId = `refund-${r.sale_id}`;
  const sale = db.prepare("SELECT payer, price_cents FROM sales WHERE sale_id = ? AND status = 'DELIVERED'").get(r.sale_id) as { payer: string; price_cents: number } | undefined;
  if (!sale) throw new Error(`no delivered sale ${r.sale_id}`);
  if (sale.payer.toLowerCase() !== r.to.toLowerCase()) throw new Error(`sale ${r.sale_id} was paid by ${sale.payer}; a refund goes back to the payer only`);
  if (r.amount_cents > sale.price_cents) throw new Error(`refund ${r.amount_cents} exceeds what sale ${r.sale_id} cost`);

  const existing = db.prepare("SELECT outcome, tx_hash, payment_id FROM refunds WHERE sale_id = ?").get(r.sale_id) as { outcome: RefundOutcome | "PROPOSED"; tx_hash: string | null } | undefined;
  if (existing && (existing.outcome === "PAID" || existing.outcome === "HELD") && !opts.retry) {
    return { sale_id: r.sale_id, payment_id: paymentId, outcome: existing.outcome, tx: existing.tx_hash, reason: null, already: true };
  }
  if (!existing) {
    db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, proposal_id, dispute_id) VALUES (?, ?, ?, ?, 'PROPOSED', ?, ?)")
      .run(r.sale_id, paymentId, r.amount_cents, r.to, r.proposal_id ?? null, r.dispute_id);
  }

  const m = await activeMandate("support");
  const res = metalAgent(
    ["mandate", "pull", "--credential", m.credentialPath, "--mandate-key-file", m.keyFile, "--to", r.to, "--amount", fromCents(r.amount_cents), "--payment-id", paymentId],
    [0, 1, 3, 4],
  );
  const outcome = EXIT[res.code]!;
  const already = /^already (paid|held), nothing sent/m.test(res.out);
  const tx = res.fields.get("transaction")?.[0] ?? null;
  const reason = res.fields.get("reason")?.[0] ?? null;
  db.prepare("UPDATE refunds SET outcome = ?, tx_hash = COALESCE(?, tx_hash), refusal_reason = ? WHERE sale_id = ?").run(outcome, tx, reason, r.sale_id);
  audit(db, "support", already ? "refund.already_paid" : `refund.${outcome.toLowerCase()}`, String(r.sale_id), { payment_id: paymentId, amount: fromCents(r.amount_cents), to: r.to, tx, reason });
  return { sale_id: r.sale_id, payment_id: paymentId, outcome, tx, reason, already };
}
