// Tier 3 item 11: the attacks a CFO would ask about, one place, each failing safely. Most mechanisms have their
// own detailed tests too; this suite names the attack and proves the outcome. It runs in CI (no network, no keys).
// Live-only attacks are proven in the run logs: a pull over the mandate cap (F2, mandate_cap_exceeded) and a pull
// under a replaced credential (S1, mandate_revoked) are refused by the chain itself.
import { readFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { checkInvoice, ibanSha, parseInvoiceFallback } from "../src/agents/invoice.js";
import { audit, verifyAuditChain } from "../src/audit/log.js";
import { ClaudeReader } from "../src/claude/reader.js";
import { Tools } from "../src/claude/tools.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { beginExecution, createProposal, decide, finishExecution } from "../src/policy/approvals.js";
import { routeRefundBatch } from "../src/policy/refunds.js";
import { capRefusal, refundThresholds } from "../src/policy/rules.js";

const t0 = new Date("2026-10-30T14:00:00Z");
const f = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");
const terms = (id: string, over: Record<string, unknown> = {}): Terms =>
  ({ schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: "2026-10-30T14:10:00Z", total: "0.15", ...over }) as Terms;

function proposed(db: DB, id = "P-0001", over: Record<string, unknown> = {}) {
  const p = createProposal(db, { terms: terms(id, over), createdBy: "support" }, t0);
  return { id, prefix: p.terms_sha256.slice(0, 8) };
}
const approve = (db: DB, id: string, prefix: string, now = t0) => decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: prefix, approver: "max", method: "cli" }, now);

describe("adversarial: money cannot move without the exact approval", () => {
  it("an agent cannot run a proposal nobody approved", () => {
    const db = openDb(":memory:");
    const { id } = proposed(db);
    expect(() => beginExecution(db, id, () => {}, t0)).toThrow(/not approved/);
  });

  it("a forged approval (wrong hash prefix) records nothing", () => {
    const db = openDb(":memory:");
    const { id } = proposed(db);
    expect(() => approve(db, id, "deadbeef")).toThrow(/prefix/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 0 });
  });

  it("a replayed approval does nothing the second time", () => {
    const db = openDb(":memory:");
    const { id, prefix } = proposed(db);
    approve(db, id, prefix);
    expect(() => approve(db, id, prefix)).toThrow(/not waiting for approval/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 1 });
  });

  it("terms changed after approval do not run (the approved hash no longer matches)", () => {
    const db = openDb(":memory:");
    const { id, prefix } = proposed(db);
    approve(db, id, prefix);
    db.prepare("UPDATE proposals SET terms_json = replace(terms_json, '0.15', '15.00') WHERE proposal_id = ?").run(id);
    expect(() => beginExecution(db, id, () => {}, t0)).toThrow(/do not match the approved hash/);
  });

  it("an approval after expiry (an expired quote) approves nothing, and an approved one that expires cannot run", () => {
    const db = openDb(":memory:");
    const a = proposed(db, "P-0001");
    expect(approve(db, a.id, a.prefix, new Date("2026-10-30T14:10:01Z"))).toBe("EXPIRED");
    const b = proposed(db, "P-0002", { expires_at: "2026-10-30T14:05:00Z" });
    approve(db, b.id, b.prefix);
    expect(() => beginExecution(db, b.id, () => {}, new Date("2026-10-30T14:06:00Z"))).toThrow(/expired.*approval void/);
  });

  it("a double payment is refused: an executed proposal cannot run again", () => {
    const db = openDb(":memory:");
    const { id, prefix } = proposed(db);
    approve(db, id, prefix);
    beginExecution(db, id, () => {}, t0);
    finishExecution(db, id, "EXECUTED", {}, t0);
    expect(() => beginExecution(db, id, () => {}, t0)).toThrow(/EXECUTED, not approved/);
  });

  it("overspend: the CFO policy refuses before signing, and large refunds go to a person", () => {
    const db = openDb(":memory:");
    const p = proposePolicyChange(db, { changes: [{ key: "cap.sourcing", to: "0.03" }], reason: "test" }, "human", t0);
    approve(db, p.proposal_id, p.terms_sha256.slice(0, 8));
    executePolicyChange(db, p.proposal_id, t0);
    expect(capRefusal(db, "sourcing", 4)).toMatch(/^policy_cap_exceeded/);
    expect(routeRefundBatch([5, 5, 5, 5, 5], refundThresholds(db))).toMatchObject({ route: "approval" });
  });
});

describe("adversarial: documents, logs and keys", () => {
  it("a tampered audit row is detected", () => {
    const db = openDb(":memory:");
    audit(db, "treasury", "transfer.status", "tr-1", { status: "PAID" }, t0);
    audit(db, "system", "next", null, {}, t0);
    db.exec("DROP TRIGGER audit_log_no_update");
    db.prepare(`UPDATE audit_log SET payload_json = '{"status":"FAILED"}' WHERE seq = 1`).run();
    expect(verifyAuditChain(db)).toMatchObject({ ok: false, seq: 1 });
  });

  it("an invoice with changed bank details is blocked as possible fraud", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('b-1', 'Lizenzhaus Beispiel GmbH', '3000', ?, 'COBADEFFXXX', 'EUR', 'SWIFT')").run(ibanSha("DE89370400440532013000"));
    const text = f("lizenzhaus-invoice-LIC-2027-01-BANKCHANGE.txt");
    expect(checkInvoice(db, parseInvoiceFallback(text), text)).toMatchObject({ ok: false, reason: expect.stringMatching(/^possible invoice fraud/) });
  });

  it("a planted instruction cannot change what the agent reads", async () => {
    const db = openDb(":memory:");
    const text = f("lizenzhaus-invoice-LIC-2027-03-INJECTION.txt");
    const obey = { beta: { messages: { parse: async (p: { model: string }) => ({ model: p.model, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, parsed_output: { ...parseInvoiceFallback(text), iban: "GB29NWBK60161331926819", amount: "9850.00" } }) } } } as unknown as Anthropic;
    expect((await new Tools(db, new ClaudeReader(db, obey)).invoice(text)).value).toMatchObject({ amount: "1850.00", iban: "DE89370400440532013000" });
  });

  it("no key, token or credential ever reaches a model", async () => {
    // Fake values, built at run time so no secret-shaped literal sits in the repo for a scanner to flag.
    const names = ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "METAL_RPC_URL", "CLOUDFLARE_API_TOKEN", "KIT11_RELAY_TOKEN"];
    const secrets = Object.fromEntries(names.map((n, i) => [n, `fake-value-${i}-${n.length}`]));
    const saved = { ...process.env };
    Object.assign(process.env, secrets);
    try {
      const sent: string[] = [];
      const capture = { beta: { messages: { parse: async (p: unknown) => { sent.push(JSON.stringify(p)); return { model: "m", stop_reason: "refusal", stop_details: null, usage: { input_tokens: 0, output_tokens: 0 }, parsed_output: null }; } } } } as unknown as Anthropic;
      const db = openDb(":memory:");
      const tools = new Tools(db, new ClaudeReader(db, capture));
      for (const n of ["lizenzhaus-invoice-LIC-2026-11.txt", "kestrel-dispute-email.txt", "feedstock-price-notice.txt", "feedstock-corrections.txt"]) {
        await tools.classify(f(n));
      }
      await tools.invoice(f("lizenzhaus-invoice-LIC-2026-11.txt"));
      await tools.dispute(f("kestrel-dispute-email.txt"));
      const t = terms("P-0001");
      await tools.review("refund_batch", JSON.stringify({ ...t, terms_sha256: termsHash(t) }), "context from the agents' checks");
      expect(sent.length).toBe(7);
      for (const body of sent) for (const v of Object.values(secrets)) expect(body).not.toContain(v);
    } finally {
      process.env = saved;
    }
  });
});
