// Airi rail groundwork (docs/plans/vic-airi.md): the executor's decisions, against the stand-in only. No network, no
// airi-cli, no card data: the stand-in writes a marker file, never a credential.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import type { DB } from "../src/db/open.js";
import { mandateCreateArgs, type AiriMandate, type AiriMandateRequest } from "../src/airi/client.js";
import { AIRI_PURCHASE_KIND, decideAiriPurchase, executeAiriPurchase, requestAiriPurchase, type AiriDeps, type AiriPolicy, type AiriPurchaseRequest } from "../src/airi/purchase.js";
import { STAND_IN_LABEL, StandInAiriClient, StandInCheckout } from "../src/airi/standIn.js";
import { decide } from "../src/policy/approvals.js";

const T0 = new Date("2026-11-07T10:00:00Z");
const POLICY: AiriPolicy = { autoMaxCents: 50_00, hardCapCents: 500_00, currencies: ["USD"], merchants: ["https://shop.example"] };

function req(over: Partial<AiriPurchaseRequest> = {}): AiriPurchaseRequest {
  return {
    agent: "sourcing", paymentMethodId: "standin-pm-1", merchantName: "Example Shop", merchantUrl: "https://shop.example/checkout",
    merchantCountry: "US", amount: "42.00", currency: "USD", items: [{ name: "Widget", unitPrice: "21.00", quantity: "2" }],
    description: "Order 1234", ...over,
  };
}

function deps(o: { airi?: StandInAiriClient; checkout?: StandInCheckout; policy?: AiriPolicy } = {}): AiriDeps & { airi: StandInAiriClient; checkout: StandInCheckout; shown: string[] } {
  const shown: string[] = [];
  return { airi: o.airi ?? new StandInAiriClient(), checkout: o.checkout ?? new StandInCheckout(), policy: o.policy ?? POLICY, showPasskeyUrl: (url) => shown.push(url), shown };
}

const ops = (d: { airi: StandInAiriClient }) => d.airi.calls.map((c) => c.op);
const events = (db: DB) => (db.prepare("SELECT event FROM audit_log ORDER BY seq").all() as { event: string }[]).map((r) => r.event);
const auditText = (db: DB) => (db.prepare("SELECT event, subject, payload_json FROM audit_log ORDER BY seq").all() as { event: string; subject: string | null; payload_json: string }[]).map((r) => `${r.event} ${r.subject} ${r.payload_json}`).join("\n");
const approve = (db: DB, p: { proposal_id: string; terms_sha256: string }) =>
  decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "passkey", signedSha256: p.terms_sha256, passkey: { credentialId: "test-cred", assertionSha256: "0".repeat(64) } }, T0);

describe("decideAiriPurchase (pure)", () => {
  it("runs alone at or below the CFO's limit, asks the CFO above it, refuses above the hard cap", () => {
    expect(decideAiriPurchase(POLICY, req())).toEqual({ route: "auto" });
    expect(decideAiriPurchase(POLICY, req({ amount: "50.00", items: [{ name: "W", unitPrice: "50.00", quantity: "1" }] }))).toEqual({ route: "auto" });
    expect(decideAiriPurchase(POLICY, req({ amount: "50.01", items: [{ name: "W", unitPrice: "50.01", quantity: "1" }] }))).toEqual({ route: "cfo" });
    expect(decideAiriPurchase(POLICY, req({ amount: "500.01", items: [{ name: "W", unitPrice: "500.01", quantity: "1" }] }))).toMatchObject({ route: "refused", code: "PURSER_ABOVE_HARD_CAP" });
  });

  it("refuses with Purser's own code: merchant, currency, URL, amount, items", () => {
    const code = (r: AiriPurchaseRequest) => (decideAiriPurchase(POLICY, r) as { code?: string }).code;
    expect(code(req({ merchantUrl: "https://other.example/x" }))).toBe("PURSER_MERCHANT_NOT_ALLOWED");
    expect(code(req({ merchantUrl: "http://shop.example/checkout" }))).toBe("PURSER_MERCHANT_URL_INVALID");
    expect(code(req({ merchantUrl: "https://user:pw@shop.example/" }))).toBe("PURSER_MERCHANT_URL_INVALID");
    expect(code(req({ currency: "EUR" }))).toBe("PURSER_CURRENCY_NOT_ALLOWED");
    expect(code(req({ amount: "42" }))).toBe("PURSER_AMOUNT_INVALID");
    expect(code(req({ amount: "0.00", items: [{ name: "W", unitPrice: "0.00", quantity: "1" }] }))).toBe("PURSER_AMOUNT_INVALID");
    expect(code(req({ amount: "43.00" }))).toBe("PURSER_ITEMS_TOTAL_MISMATCH");
    expect(code(req({ items: [] }))).toBe("PURSER_ITEMS_TOTAL_MISMATCH");
  });
});

describe("mandateCreateArgs: the documented airi-cli flags, built, never run", () => {
  const base: AiriMandateRequest = { source: "Purser sourcing agent", paymentMethodId: "pm", merchantName: "Acme", merchantUrl: "https://acme.example", merchantCountry: "US", totalAmount: "42.00", currency: "USD", items: [{ name: "Widget", unitPrice: "21.00", quantity: "2" }], description: "Order #1234" };

  it("matches the README's example, with JSON output and telemetry off", () => {
    expect(mandateCreateArgs(base)).toEqual([
      "mandate", "create", "--source", "Purser sourcing agent", "--payment-method-id", "pm", "--merchant-name", "Acme",
      "--merchant-url", "https://acme.example", "--merchant-country", "US", "--total-amount", "42.00", "--currency", "USD",
      "--item", "name:Widget,unit_price:21.00,quantity:2", "--description", "Order #1234", "-o", "json", "--no-telemetry",
    ]);
  });

  it("refuses values the CLI's item syntax or a terminal could misread", () => {
    expect(() => mandateCreateArgs({ ...base, items: [{ name: "Widget,unit_price:0.01", unitPrice: "21.00", quantity: "2" }] })).toThrow(/item/);
    expect(() => mandateCreateArgs({ ...base, items: [{ name: "a:b", unitPrice: "21.00", quantity: "2" }] })).toThrow(/item/);
    expect(() => mandateCreateArgs({ ...base, merchantUrl: "http://acme.example" })).toThrow(/https/);
    expect(() => mandateCreateArgs({ ...base, description: "line\nbreak" })).toThrow(/control/);
    expect(() => mandateCreateArgs({ ...base, totalAmount: "42" })).toThrow(/two-decimal/);
  });
});

describe("requestAiriPurchase / executeAiriPurchase against the stand-in", () => {
  it("within the limit: runs alone, in the documented order, and deletes the credential file", async () => {
    const db = openDb(":memory:");
    const d = deps();
    const out = await requestAiriPurchase(db, d, req(), T0);
    expect(out).toMatchObject({ status: "succeeded", mandateId: "standin-mdt-1", reference: "standin-order-1", label: STAND_IN_LABEL });
    expect(ops(d)).toEqual(["mandate create", "mandate get-credential", "mandate result"]);
    expect(d.airi.calls[2]!.args).toEqual(["--mandate-id", "standin-mdt-1", "--result", "SUCCEEDED"]);
    expect(d.shown).toEqual(["https://stand-in.invalid/approve/1"]);
    expect(existsSync(d.checkout.seen[0]!.credentialFile)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
    expect(events(db)).toEqual(["airi.purchase_requested", "airi.mandate_created", "airi.credential_received", "airi.checkout_result"]);
  });

  it("logs safe references only: never the passkey URL, the credential file or its contents", async () => {
    const db = openDb(":memory:");
    const d = deps();
    await requestAiriPurchase(db, d, req(), T0);
    const text = auditText(db);
    expect(text).toContain("standin-mdt-1");
    expect(text).not.toContain("stand-in.invalid");
    expect(text).not.toContain(d.checkout.seen[0]!.credentialFile);
    expect(text).not.toContain("stand_in");
    expect(text).not.toContain("4111");
  });

  it("refused by Purser: the real code, audited, and Airi is never called", async () => {
    const db = openDb(":memory:");
    const d = deps();
    const out = await requestAiriPurchase(db, d, req({ merchantUrl: "https://other.example/buy" }), T0);
    expect(out).toMatchObject({ status: "refused", by: "purser", code: "PURSER_MERCHANT_NOT_ALLOWED" });
    expect(d.airi.calls).toEqual([]);
    expect(events(db)).toEqual(["airi.purchase_requested", "airi.purchase_refused"]);
    expect(auditText(db)).toContain("PURSER_MERCHANT_NOT_ALLOWED");
  });

  it("a paused agent is refused before anything else", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('pause.sourcing', 'on', ?)").run(T0.toISOString());
    const d = deps();
    expect(await requestAiriPurchase(db, d, req(), T0)).toMatchObject({ status: "refused", code: "PURSER_AGENT_PAUSED" });
    expect(d.airi.calls).toEqual([]);
  });

  it("above the limit: a proposal over agent, amount, currency and merchant; nothing runs until the CFO signs", async () => {
    const db = openDb(":memory:");
    const d = deps();
    const big = req({ amount: "120.00", items: [{ name: "Widget", unitPrice: "60.00", quantity: "2" }] });
    const out = await requestAiriPurchase(db, d, big, T0);
    expect(out).toMatchObject({ status: "pending_approval" });
    if (out.status !== "pending_approval") throw new Error("unreachable");
    expect(d.airi.calls).toEqual([]);
    const p = db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(out.proposalId) as { proposal_id: string; kind: string; terms_json: string; terms_sha256: string };
    expect(p.kind).toBe(AIRI_PURCHASE_KIND);
    expect(JSON.parse(p.terms_json)).toMatchObject({ agent: "sourcing", amount: "120.00", currency: "USD", merchant: { name: "Example Shop", url: "https://shop.example/checkout", country: "US" } });

    // Not yet approved: the executor refuses on its own check, still without calling Airi.
    await expect(executeAiriPurchase(db, d, p.proposal_id, T0)).rejects.toThrow(/not approved/);
    expect(d.airi.calls).toEqual([]);

    approve(db, p);
    const done = await executeAiriPurchase(db, d, p.proposal_id, T0);
    expect(done).toMatchObject({ status: "succeeded", proposalId: p.proposal_id, orderSha256: p.terms_sha256 });
    expect(ops(d)).toEqual(["mandate create", "mandate get-credential", "mandate result"]);
    expect(d.airi.calls[0]!.args).toContain("120.00");
    expect(db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(p.proposal_id)).toEqual({ status: "EXECUTED" });
  });

  it("terms changed after the CFO signed: the hash check stops it before Airi is called", async () => {
    const db = openDb(":memory:");
    const d = deps();
    const out = await requestAiriPurchase(db, d, req({ amount: "120.00", items: [{ name: "Widget", unitPrice: "60.00", quantity: "2" }] }), T0);
    if (out.status !== "pending_approval") throw new Error("expected a proposal");
    const p = db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(out.proposalId) as { proposal_id: string; terms_json: string; terms_sha256: string };
    approve(db, p);
    const t = JSON.parse(p.terms_json) as Record<string, unknown>;
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...t, merchant: { name: "Evil", url: "https://shop.example/evil", country: "US" } }), p.proposal_id);
    await expect(executeAiriPurchase(db, d, p.proposal_id, T0)).rejects.toThrow(/approved hash/);
    expect(d.airi.calls).toEqual([]);
  });

  it("terms changed between the mandate and the credential: the mandate is cancelled, no credential is requested", async () => {
    const db = openDb(":memory:");
    let tamper: (() => void) | null = null;
    class Tampering extends StandInAiriClient {
      override async createMandate(r: AiriMandateRequest): Promise<AiriMandate> {
        const m = await super.createMandate(r);
        tamper?.();
        return m;
      }
    }
    const d = deps({ airi: new Tampering() });
    const out = await requestAiriPurchase(db, d, req({ amount: "120.00", items: [{ name: "Widget", unitPrice: "60.00", quantity: "2" }] }), T0);
    if (out.status !== "pending_approval") throw new Error("expected a proposal");
    const p = db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(out.proposalId) as { proposal_id: string; terms_json: string; terms_sha256: string };
    approve(db, p);
    tamper = () => db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...JSON.parse(p.terms_json), amount: "1.00" }), p.proposal_id);
    const res = await executeAiriPurchase(db, d, p.proposal_id, T0);
    expect(res).toMatchObject({ status: "refused", by: "purser", code: "PURSER_HASH_MISMATCH", mandateId: "standin-mdt-1" });
    expect(ops(d)).toEqual(["mandate create", "mandate cancel"]);
    expect(d.shown).toEqual([]);
    expect(db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(p.proposal_id)).toEqual({ status: "FAILED" });
  });

  it("the policy tightened after the CFO signed: refused with Purser's code, the proposal closed, Airi not called", async () => {
    const db = openDb(":memory:");
    const d = deps();
    const out = await requestAiriPurchase(db, d, req({ amount: "120.00", items: [{ name: "Widget", unitPrice: "60.00", quantity: "2" }] }), T0);
    if (out.status !== "pending_approval") throw new Error("expected a proposal");
    approve(db, db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(out.proposalId) as { proposal_id: string; terms_sha256: string });
    const tighter = deps({ policy: { ...POLICY, merchants: [] } });
    expect(await executeAiriPurchase(db, tighter, out.proposalId, T0)).toMatchObject({ status: "refused", by: "purser", code: "PURSER_MERCHANT_NOT_ALLOWED" });
    expect(tighter.airi.calls).toEqual([]);
    expect(db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(out.proposalId)).toEqual({ status: "NEEDS_REAPPROVAL" });
  });

  it("Airi refuses the credential: its code is shown as given, no checkout runs", async () => {
    const db = openDb(":memory:");
    const d = deps({ airi: new StandInAiriClient({ refuseCredential: "STANDIN_DENIED" }) });
    const out = await requestAiriPurchase(db, d, req(), T0);
    expect(out).toMatchObject({ status: "refused", by: "airi", code: "STANDIN_DENIED", mandateId: "standin-mdt-1" });
    expect(d.checkout.seen).toEqual([]);
    expect(ops(d)).toEqual(["mandate create", "mandate get-credential"]);
  });

  it("the checkout declines: the merchant's code is shown, and DECLINED is reported to Airi with it", async () => {
    const db = openDb(":memory:");
    const d = deps({ checkout: new StandInCheckout("standin_card_declined") });
    const out = await requestAiriPurchase(db, d, req(), T0);
    expect(out).toMatchObject({ status: "refused", by: "checkout", code: "standin_card_declined" });
    expect(d.airi.calls.at(-1)).toEqual({ op: "mandate result", args: ["--mandate-id", "standin-mdt-1", "--result", "DECLINED", "--reason", "standin_card_declined"] });
    expect(existsSync(d.checkout.seen[0]!.credentialFile)).toBe(false);
  });

  it("a checkout whose outcome is unknown is left unconfirmed: no result reported, nothing retried", async () => {
    const db = openDb(":memory:");
    class Hanging extends StandInCheckout {
      override async submit(): Promise<never> { throw new Error("timed out"); }
    }
    const d = deps({ checkout: new Hanging() });
    const out = await requestAiriPurchase(db, d, req(), T0);
    expect(out).toMatchObject({ status: "unconfirmed", reason: "timed out" });
    expect(ops(d)).toEqual(["mandate create", "mandate get-credential"]);
    expect(events(db)).toContain("airi.checkout_unconfirmed");
  });
});
