// Purser Cloud's answers to Claude about payments and policy (cloud/src/claude/insight.ts): a payment in plain words for
// each direction, with or without an invoice, an approval given or still missing, a booking or none, flags and proof;
// and the CFO policy from the company's own rows: each agent's card as issued with a raise on top, settings, decisions.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cfoPolicy, explain } from "../cloud/src/claude/insight.js";
import { TenantDb } from "../cloud/src/tenant.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

type Tx = Parameters<typeof explain>[0];
const tx = (over: Partial<Tx> = {}): Tx => ({
  id: "transfer:req-1", at: "2026-11-02T10:00:00Z", direction: "out", amount: "1850.00", currency: "EUR", counterparty: "Bergtex Textil GmbH", rail: "airwallex_transfer", rail_label: "Airwallex transfer",
  status: "PAID", status_words: "paid", description: "Invoice BTX-1", moved: true,
  approval: { required: true, authority: "the CFO's approval of the exact terms", proposal_id: "P-0004", terms_sha256: "b6a6c04e4d8b45066c114ba3", decision: "APPROVED", method: "passkey", approved_at: "2026-11-02T09:59:00Z" },
  booking: { booked: "-1850.00", entry_ids: [7, 8], accounts: ["2100", "1200"] }, reconciliation: "matched", reconciliation_words: "booked and matched", flags: [], proof: "tr_1",
  invoice: { ap_id: "inv_1", supplier_no: "BTX-1", vendor: "Bergtex Textil GmbH", document: null },
  ...over,
} as unknown as Tx);
const trail = { payment: { id: "x" }, steps: [], books: [] };

describe("a payment in plain words", () => {
  it("money out for an invoice, approved with Face ID, booked in two entries, with its proof", () => {
    const e = explain(tx(), trail);
    expect(e.sentence).toBe("The company paid Bergtex Textil GmbH EUR 1,850.00 on 2 Nov 2026 for invoice BTX-1 (inv_1) via Airwallex transfer; paid.");
    expect(e.lines).toEqual([
      "The CFO approved P-0004 on 2 Nov 2026 by signing its exact terms with Face ID (terms b6a6c04e4d8b…).",
      "Booked in ledger entries 7, 8 (accounts 2100, 1200).",
      "Reconciliation: booked and matched.",
      "Proof at the rail: tr_1.",
    ]);
  });

  it("money in with no invoice, an approval still missing, one not needed, one booking, flags and no proof", () => {
    const inn = explain(tx({ direction: "in", counterparty: "Ridgeline Outfitters", invoice: null, description: "a deposit", booking: { entry_ids: [3], accounts: ["1200"] } as never, proof: null, flags: ["no_proof"], reconciliation_words: undefined, reconciliation: "missing_rail_record" } as never), trail);
    expect(inn.sentence).toBe("Ridgeline Outfitters paid the company EUR 1,850.00 on 2 Nov 2026 for a deposit via Airwallex transfer; paid.");
    expect(inn.lines).toEqual(["The CFO approved P-0004 on 2 Nov 2026 by signing its exact terms with Face ID (terms b6a6c04e4d8b…).", "Booked in ledger entry 3 (accounts 1200).", "Reconciliation: missing_rail_record; flags: no_proof."]);
    const waiting = explain(tx({ approval: { required: true, authority: "the CFO's approval of the exact terms", proposal_id: null, approved_at: null } as never }), trail);
    expect(waiting.lines[0]).toBe("It needs the CFO's Face ID and has none yet (the CFO's approval of the exact terms).");
    const typed = explain(tx({ approval: { required: true, authority: "a", proposal_id: null, approved_at: "2026-11-02T09:59:00Z", method: "cli", terms_sha256: null } as never }), trail);
    expect(typed.lines[0]).toBe("The CFO approved it on 2 Nov 2026 by signing its exact terms.");
    const own = explain(tx({ direction: "internal", invoice: null, description: "", approval: { required: false, authority: "own accounts: the treasury agent's sweep rule" } as never, booking: null as never, rail_label: undefined, status_words: undefined, reconciliation_words: undefined, reconciliation: undefined } as never), trail);
    expect(own.sentence).toBe("EUR 1,850.00 moved between the company's own accounts on 2 Nov 2026 via airwallex_transfer; PAID.");
    expect(own.lines.slice(0, 3)).toEqual(["No CFO approval was needed: own accounts: the treasury agent's sweep rule.", "Not booked yet.", "Reconciliation: unknown."]);
    const noNo = explain(tx({ invoice: { ap_id: null, supplier_no: null, vendor: "x", document: null } } as never), trail);
    expect(noNo.sentence).toMatch(/ for invoice via Airwallex transfer; paid\.$/);
  });
});

describe("the CFO policy from the company's rows", () => {
  let c: TestCloud, t: TestTenant, db: TenantDb, seq = 0;
  const row = (actor: string, event: string, subject: string | null, payload: Record<string, unknown>, ts = "2026-11-01T10:00:00Z") => {
    seq++;
    return db.insert("audit_rows", { seq, ts, actor, event, subject, payload_json: JSON.stringify(payload), prev_hash: "0", row_hash: `h${seq}` });
  };
  beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); db = new TenantDb(c.env.sql, t.id); seq = 0; });
  afterEach(() => c.close());

  it("each card as issued with a raise on top, the newest value of each setting, every policy version and the decisions", async () => {
    await db.apply([
      row("system", "card.issued", "sourcing", { agent: "sourcing", limits: "30.00 / 100.00", last4: "2222" }),
      row("system", "card.issued", null, { agent: "support", limits: "60.00 / 150.00", currency: "EUR", last4: "1111" }),
      row("system", "card.issued", null, {}),
      row("system", "card.issued", "treasury", { agent: "treasury", limits: "" }),
      row("human", "card.limit_changed", "sourcing", { agent: "sourcing", per_purchase: "40.00" }, "2026-11-02T10:00:00Z"),
      row("human", "card.limit_changed", "payer", { agent: "payer", per_purchase: "1.00" }),
      row("human", "card.limit_changed", "support", { agent: "support" }),
      row("human", "setting.changed", "eur_floor", { after: "500.00" }),
      row("treasury", "setting.changed", "eur_floor", { after: "600.00" }, "2026-11-03T10:00:00Z"),
      row("system", "policy.version", null, { version: 1, sha256: "a", changed: "start" }),
      row("system", "policy.version", null, { version: 2, sha256: "b", changed: "card.sourcing.per_tx" }, "2026-11-02T10:00:00Z"),
      row("human", "proposal.approved", "P-1", {}),
      row("human", "proposal.rejected", "P-2", {}),
      row("system", "proposal.expired", "P-3", {}),
    ]);
    const p = await cfoPolicy(db) as { agent_cards: { agent: string; per_purchase: string; per_month: string; currency: string; since: string }[]; settings: { setting: string; value: string }[]; policy_version: { version: number }; policy_history: unknown[]; decisions: Record<string, number>; rules: string[] };
    expect(p.agent_cards.map((x) => [x.agent, x.per_purchase, x.per_month, x.currency])).toEqual([["sourcing", "40.00", "100.00", "EUR"], ["support", "60.00", "150.00", "EUR"]]);
    expect(p.agent_cards[0]!.since).toBe("2026-11-02T10:00:00Z");
    expect(p.settings).toEqual([expect.objectContaining({ setting: "eur_floor", value: "600.00" })]);
    expect(p.policy_version).toMatchObject({ version: 2 });
    expect(p.policy_history).toHaveLength(2);
    expect(p.decisions).toEqual({ approved: 1, rejected: 1, expired: 1 });
    expect(p.rules.some((r) => /cannot approve, pay, change a limit or write to the books/.test(r))).toBe(true);
  });

  it("a company with no rows has the fixed rules and nothing else", async () => {
    const p = await cfoPolicy(db) as { agent_cards: unknown[]; settings: unknown[]; policy_version: unknown; decisions: Record<string, number> };
    expect(p).toMatchObject({ agent_cards: [], settings: [], policy_version: null, decisions: { approved: 0, rejected: 0, expired: 0 } });
  });
});
