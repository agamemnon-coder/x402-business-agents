import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LICENSOR, proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { bookCredit } from "../src/agents/sweep.js";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { decide } from "../src/policy/approvals.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";

const text = readFileSync(new URL("../fixtures/lizenzhaus-invoice-LIC-2026-11.txt", import.meta.url), "utf8");

async function world() {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  return { db, awx };
}

function approve(db: ReturnType<typeof openDb>, id: string, sha: string) {
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "test", method: "cli" });
}

describe("euro bill (S3) against the Airwallex port", () => {
  it("reads the invoice", () => {
    expect(parseInvoiceFallback(text)).toEqual({
      invoice_no: "LIC-2026-11", vendor: LICENSOR.name, amount: "1850.00", currency: "EUR", due_date: "2026-11-16",
      iban: LICENSOR.iban, bic: LICENSOR.bic, reference: "LIC-2026-11",
    });
  });

  it("calibrates free EUR to 1,500.00 and the USD floor 5,000 under the seed", async () => {
    const { db, awx } = await world();
    expect(awx.bal.USD.availableCents).toBe(2_500_000);
    const s = (await import("../src/agents/euroBill.js")).treasuryState(db, await awx.balances());
    expect(s.eurAvailableCents - s.eurFloorCents - s.eurObligationsCents).toBe(150_000);
    expect(s.usdFloorCents).toBe(2_000_000);
  });

  it("converts only the 362.85 shortfall, then pays by SWIFT to PAID", async () => {
    const { db, awx } = await world();
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(out.reason);
    expect(out.terms.conversion?.buy_amount).toBe("362.85");
    expect(out.terms.after.eur_free).toBe("0.00");
    expect(awx.calls).not.toContain("createConversion");
    approve(db, out.proposal.proposal_id, out.proposal.terms_sha256);
    const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    expect(r.transfer.status).toBe("PAID");
    expect(awx.transfers[0]!.metadata).toBe(out.proposal.terms_sha256);
    expect(awx.bal.EUR.availableCents).toBe(50_000 + 800_000); // exactly the floor plus the committed obligations remain
    expect(awx.bal.USD.availableCents).toBeGreaterThanOrEqual(2_000_000);
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("F1: an expired quote voids the approval before Airwallex is called", async () => {
    const { db, awx } = await world();
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(db, out.proposal.proposal_id, out.proposal.terms_sha256);
    const later = new Date(Date.parse(out.terms.conversion!.valid_to));
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, () => later)).rejects.toThrow(/expired/);
    expect(awx.calls).not.toContain("createConversion");
    expect(awx.calls).not.toContain("createTransfer");
    const { status } = db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(out.proposal.proposal_id) as { status: string };
    expect(status).toBe("EXPIRED");
  });

  it("F4b: escalates when the conversion would break the USD floor", async () => {
    const { db, awx } = await world();
    setSetting(db, "treasury", "usd_floor", "24900.00");
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    expect(out.kind).toBe("escalated");
    expect(awx.calls).not.toContain("createConversion");
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
  });

  it("F5: changed bank details escalate and pay nothing", async () => {
    const { db, awx } = await world();
    const changed = text.replace("DE89 3704 0044 0532 0130 00", "DE44 5001 0517 5407 3249 31");
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(changed), changed);
    expect(out).toMatchObject({ kind: "escalated" });
    expect(awx.calls).not.toContain("createQuote");
  });

  it("F8: a lost transfer answer is adopted by request_id, not paid twice", async () => {
    const { db, awx } = await world();
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(db, out.proposal.proposal_id, out.proposal.terms_sha256);
    awx.loseNextTransferAnswer = true;
    const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    expect(awx.transfers).toHaveLength(1);
    expect(r.transfer.status).toBe("PAID");
  });

  it("F6: one on-chain transfer is credited once, even when booking runs twice", async () => {
    const { db, awx } = await world();
    db.prepare(`INSERT INTO chain_credits (event_key, tx_hash, from_address, to_address, amount_base_units, block, finalized_block, awx_reference, created_at)
      VALUES ('63825:0xabc:1', '0xabc', '0xb', '0xw', '1350000000000000000', 1, 1, '0xabc', ?)`).run(new Date().toISOString());
    const first = await bookCredit(db, awx, awx, "63825:0xabc:1");
    db.prepare("UPDATE chain_credits SET awx_deposit_id = NULL").run(); // as if the process died before saving the id
    const second = await bookCredit(db, awx, awx, "63825:0xabc:1");
    expect(second).toEqual({ depositId: first.depositId, adopted: true });
    expect(awx.deposits.filter((d) => d.reference === "0xabc")).toHaveLength(1);
  });
});
