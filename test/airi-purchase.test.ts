// The Airi rail's executor (src/airi/purchase.ts), against the stand-ins only: no network, no airi-cli, no card data.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { AIRI_TEXT_MAX, mandateCreateArgs, type AiriMandate, type AiriMandateRequest } from "../src/airi/client.js";
import { AIRI_HARD_CAP_CENTS, type AiriPolicy } from "../src/airi/policy.js";
import { AIRI_PURCHASE_KIND, READ_BACK_TRIES, TMP_PREFIX, decideAiriPurchase, executeAiriPurchase, mandateDescription, mandateTag, recoverAiriPurchases, requestAiriPurchase, type AiriDeps, type AiriPurchaseRequest, type AiriTerms } from "../src/airi/purchase.js";
import { STAND_IN_LABEL, StandInAiriClient, StandInCheckout, type StandInScript } from "../src/airi/standIn.js";
import { decide, resuming } from "../src/policy/approvals.js";
import { startStep } from "../src/policy/saga.js";

const T0 = new Date("2026-11-07T10:00:00Z");
const URL0 = "https://kit11.max-31b.workers.dev/";
const POLICY: AiriPolicy = { aloneMaxCents: 20_00, alonePerDay: 3, hardCapCents: AIRI_HARD_CAP_CENTS, currencies: ["EUR"], merchants: ["https://kit11.max-31b.workers.dev"] };

function seed(db: DB, o: { alone?: string; perDay?: string; merchant?: "allowed" | "blocked" } = {}) {
  const set = (k: string, v: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v, T0.toISOString());
  set("approval.airi_alone", o.alone ?? "20.00");
  set("approval.airi_alone_per_day", o.perDay ?? "3");
  set("airi.merchant.northwind-sandbox", o.merchant ?? "allowed");
}

function req(over: Partial<AiriPurchaseRequest> = {}): AiriPurchaseRequest {
  return {
    agent: "sourcing", paymentMethodId: "standin-pm-1", merchantName: "Northwind test shop", merchantUrl: URL0, merchantCountry: "NL",
    amount: "12.00", currency: "EUR", items: [{ name: "Trail map pack", unitPrice: "6.00", quantity: "2" }], description: "order 1", ...over,
  };
}
const big = (over: Partial<AiriPurchaseRequest> = {}) => req({ amount: "45.00", items: [{ name: "Repair kit", unitPrice: "45.00", quantity: "1" }], ...over });

let tmpRoot: string;
beforeEach(() => { tmpRoot = mkdtempSync(join(tmpdir(), "airi-test-")); });
afterEach(() => { resuming.clear(); });

function deps(o: { airi?: StandInAiriClient; checkout?: StandInCheckout } = {}) {
  const shown: string[] = [];
  const cleared: string[] = [];
  const waits: number[] = [];
  const d: AiriDeps & { airi: StandInAiriClient; checkout: StandInCheckout } = {
    airi: o.airi ?? new StandInAiriClient(), checkout: o.checkout ?? new StandInCheckout(), tmpRoot,
    showPasskeyUrl: (url) => shown.push(url), clearPasskeyUrl: (id) => cleared.push(id),
    // The wait between two tries of the mandate read-back: none in tests, its length recorded.
    sleep: async (ms) => { waits.push(ms); },
  };
  return Object.assign(d, { shown, cleared, waits });
}

const ops = (d: { airi: StandInAiriClient }) => d.airi.calls.map((c) => c.op);
const events = (db: DB) => (db.prepare("SELECT event FROM audit_log WHERE event LIKE 'airi.%' ORDER BY seq").all() as { event: string }[]).map((r) => r.event);
const auditText = (db: DB) => (db.prepare("SELECT subject, payload_json FROM audit_log ORDER BY seq").all() as { subject: string | null; payload_json: string }[]).map((r) => `${r.subject} ${r.payload_json}`).join("\n");
const row = (db: DB, id: string) => db.prepare("SELECT * FROM airi_purchases WHERE action_id = ?").get(id) as Record<string, string | number | null>;
const proposal = (db: DB, id: string) => db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(id) as { proposal_id: string; kind: string; terms_json: string; terms_sha256: string; status: string };
const approve = (db: DB, id: string) => {
  const p = proposal(db, id);
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "passkey", signedSha256: p.terms_sha256, passkey: { credentialId: "test-cred", assertionSha256: "0".repeat(64) } }, T0);
};
const fresh = () => { const db = openDb(":memory:"); seed(db); return db; };

describe("decideAiriPurchase (pure)", () => {
  it("alone within the limit and the day's count; the CFO above either; refused above the hard cap", () => {
    expect(decideAiriPurchase(POLICY, req())).toEqual({ route: "alone" });
    expect(decideAiriPurchase(POLICY, req({ amount: "20.00", items: [{ name: "W", unitPrice: "20.00", quantity: "1" }] }))).toEqual({ route: "alone" });
    expect(decideAiriPurchase(POLICY, req({ amount: "20.01", items: [{ name: "W", unitPrice: "20.01", quantity: "1" }] }))).toMatchObject({ route: "cfo" });
    expect(decideAiriPurchase(POLICY, req(), 3)).toMatchObject({ route: "cfo", why: expect.stringContaining("already 3") });
    expect(decideAiriPurchase(POLICY, req({ amount: "200.01", items: [{ name: "W", unitPrice: "200.01", quantity: "1" }] }))).toMatchObject({ route: "refused", code: "PURSER_ABOVE_HARD_CAP" });
  });

  it("refuses with Purser's own code: merchant, currency, URL, amount, items", () => {
    const code = (r: AiriPurchaseRequest) => (decideAiriPurchase(POLICY, r) as { code?: string }).code;
    expect(code(req({ merchantUrl: "https://shop.example/x" }))).toBe("PURSER_MERCHANT_NOT_ALLOWED");
    expect(code(req({ merchantUrl: "http://kit11.max-31b.workers.dev/" }))).toBe("PURSER_MERCHANT_URL_INVALID");
    expect(code(req({ merchantUrl: "https://u:p@kit11.max-31b.workers.dev/" }))).toBe("PURSER_MERCHANT_URL_INVALID");
    expect(code(req({ currency: "USD" }))).toBe("PURSER_CURRENCY_NOT_ALLOWED");
    expect(code(req({ amount: "12" }))).toBe("PURSER_AMOUNT_INVALID");
    expect(code(req({ amount: "13.00" }))).toBe("PURSER_ITEMS_TOTAL_MISMATCH");
    expect(code(req({ items: [] }))).toBe("PURSER_ITEMS_TOTAL_MISMATCH");
  });
});

describe("mandateCreateArgs: the documented airi-cli flags", () => {
  const base: AiriMandateRequest = { source: "Purser sourcing agent", paymentMethodId: "pm", merchantName: "Acme", merchantUrl: "https://acme.example", merchantCountry: "US", totalAmount: "42.00", currency: "USD", items: [{ name: "Widget", unitPrice: "21.00", quantity: "2" }], description: "Order #1234" };
  it("matches the README's example", () => {
    expect(mandateCreateArgs(base)).toEqual([
      "mandate", "create", "--source", "Purser sourcing agent", "--payment-method-id", "pm", "--merchant-name", "Acme",
      "--merchant-url", "https://acme.example", "--merchant-country", "US", "--total-amount", "42.00", "--currency", "USD",
      "--item", "name:Widget,unit_price:21.00,quantity:2", "--description", "Order #1234",
    ]);
  });
  it("refuses values the CLI's item syntax or a terminal could misread", () => {
    expect(() => mandateCreateArgs({ ...base, items: [{ name: "Widget,unit_price:0.01", unitPrice: "21.00", quantity: "2" }] })).toThrow(/item/);
    expect(() => mandateCreateArgs({ ...base, merchantUrl: "http://acme.example" })).toThrow(/https/);
    expect(() => mandateCreateArgs({ ...base, description: "line\nbreak" })).toThrow(/control/);
  });
});

describe("a purchase within the CFO's limit", () => {
  it("runs alone in the documented order, shows the link once, and leaves no credential behind", async () => {
    const db = fresh();
    const d = deps();
    const out = await requestAiriPurchase(db, d, req(), T0);
    expect(out).toMatchObject({ status: "succeeded", mandateId: "standin-mdt-1", reference: "standin-order-1", label: STAND_IN_LABEL });
    expect(ops(d)).toEqual(["mandate create", "mandate list", "mandate get-credential", "mandate result"]);
    expect(d.airi.calls[3]!.args).toEqual(["--mandate-id", "standin-mdt-1", "--result", "SUCCEEDED"]);
    expect(d.shown).toEqual(["https://stand-in.invalid/approve/1"]);
    if (out.status !== "succeeded") throw new Error("unreachable");
    expect(d.cleared).toEqual([out.actionId]);
    const file = d.checkout.seen.find((s) => s.op === "pay")!.credentialFile!;
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(tmpRoot).filter((n) => n.startsWith(TMP_PREFIX))).toEqual([]);
    expect(row(db, out.actionId)).toMatchObject({ route: "alone", status: "SETTLED", outcome: "SUCCEEDED", mandate_id: "standin-mdt-1" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
    expect(events(db)).toEqual(["airi.purchase_requested", "airi.rail_choice", "airi.checkout_prepared", "airi.mandate_created", "airi.mandate_read_back", "airi.waiting_for_tap", "airi.credential_received", "airi.checkout_result", "airi.result_reported"]);
    expect((db.prepare("SELECT step, status FROM money_steps ORDER BY n").all() as { step: string; status: string }[]).map((s) => `${s.step}:${s.status}`))
      .toEqual(["airi.checkout_prepare:DONE", "airi.mandate:DONE", "airi.checkout_pay:DONE", "airi.result:DONE"]);
  });

  it("logs safe references only, and the money event names code's rule as its origin", async () => {
    const db = fresh();
    const d = deps();
    await requestAiriPurchase(db, d, req(), T0);
    const text = auditText(db);
    expect(text).toContain("standin-mdt-1");
    expect(text).not.toContain("stand-in.invalid");
    expect(text).not.toContain(tmpRoot);
    expect(text).not.toContain("stand_in");
    const money = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'airi.checkout_result'").get() as { payload_json: string };
    expect(JSON.parse(money.payload_json).origin).toMatchObject({ actor: "code", agent: "sourcing" });
  });

  it("past the day's count, the next one asks the CFO", async () => {
    const db = openDb(":memory:");
    seed(db, { perDay: "1" });
    const d = deps();
    expect(await requestAiriPurchase(db, d, req(), T0)).toMatchObject({ status: "succeeded" });
    expect(await requestAiriPurchase(db, d, req(), T0)).toMatchObject({ status: "pending_approval" });
  });
});

describe("refused by Purser: the real code, and Airi is never called", () => {
  it.each([
    ["a merchant the CFO does not allow", (db: DB) => void db, req({ merchantUrl: "https://shop.example/buy" }), "PURSER_MERCHANT_NOT_ALLOWED"],
    ["the merchant blocked in the policy", (db: DB) => seed(db, { merchant: "blocked" }), req(), "PURSER_MERCHANT_NOT_ALLOWED"],
    ["above the hard cap", (db: DB) => void db, req({ amount: "250.00", items: [{ name: "W", unitPrice: "250.00", quantity: "1" }] }), "PURSER_ABOVE_HARD_CAP"],
    ["a paused agent", (db: DB) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('pause.sourcing', 'on', ?)").run(T0.toISOString()), req(), "PURSER_AGENT_PAUSED"],
    ["the emergency stop", (db: DB) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(T0.toISOString()), req(), "PURSER_EMERGENCY_STOP"],
  ])("%s", async (_name, setup, r, code) => {
    const db = fresh();
    setup(db);
    const d = deps();
    const out = await requestAiriPurchase(db, d, r, T0);
    expect(out).toMatchObject({ status: "refused", by: "purser", code });
    expect(d.airi.calls).toEqual([]);
    expect(d.checkout.seen).toEqual([]);
    expect(events(db)).toEqual(["airi.purchase_requested", "airi.purchase_refused"]);
    expect(auditText(db)).toContain(code);
  });
});

describe("above the limit: the CFO's Face ID over the terms", () => {
  it("a proposal over agent, amount, currency, merchant and items; nothing runs until the CFO signs", async () => {
    const db = fresh();
    const d = deps();
    const out = await requestAiriPurchase(db, d, big(), T0);
    if (out.status !== "pending_approval") throw new Error(`expected a proposal, got ${out.status}`);
    expect(d.airi.calls).toEqual([]);
    const p = proposal(db, out.proposalId);
    expect(p.kind).toBe(AIRI_PURCHASE_KIND);
    expect(JSON.parse(p.terms_json)).toMatchObject({ agent: "sourcing", amount: "45.00", currency: "EUR", merchant: { url: URL0 }, items: [{ name: "Repair kit", unit_price: "45.00", quantity: "1" }] });

    await expect(executeAiriPurchase(db, d, p.proposal_id, T0)).rejects.toThrow(/not approved/);
    expect(d.airi.calls).toEqual([]);

    approve(db, p.proposal_id);
    const done = await executeAiriPurchase(db, d, p.proposal_id, T0);
    expect(done).toMatchObject({ status: "succeeded", proposalId: p.proposal_id, orderSha256: p.terms_sha256 });
    expect(ops(d)).toEqual(["mandate create", "mandate list", "mandate get-credential", "mandate result"]);
    expect(d.airi.calls[0]!.args).toContain("45.00");
    expect(proposal(db, p.proposal_id).status).toBe("EXECUTED");
    expect(row(db, p.proposal_id)).toMatchObject({ route: "cfo", status: "SETTLED" });
    // A failed or finished Airi proposal never runs a second time.
    expect(await executeAiriPurchase(db, d, p.proposal_id, T0)).toMatchObject({ status: "refused", code: "PURSER_ALREADY_RAN" });
  });

  it("every world numbers its proposals from P-0001, so the checkout's order ref is unique per run (vic-1c: Airwallex said duplicate_request)", async () => {
    const refs: string[] = [];
    class Seen extends StandInCheckout {
      override prepare(order: { ref: string; amount: string; currency: string; description: string }) { refs.push(order.ref); return super.prepare(order); }
    }
    for (const at of [T0, new Date(T0.getTime() + 3_600_000)]) {
      const db = fresh();
      const d = deps({ checkout: new Seen() });
      const out = await requestAiriPurchase(db, d, big(), at);
      if (out.status !== "pending_approval") throw new Error(`expected a proposal, got ${out.status}`);
      approve(db, out.proposalId);
      expect(await executeAiriPurchase(db, d, out.proposalId, at)).toMatchObject({ status: "succeeded" });
    }
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatch(/^P-0001-/);
    expect(refs[1]).toMatch(/^P-0001-/);
    expect(refs[0]).not.toBe(refs[1]);
  });

  it("terms changed after the CFO signed: the hash check stops it before Airi is called", async () => {
    const db = fresh();
    const d = deps();
    const out = await requestAiriPurchase(db, d, big(), T0);
    if (out.status !== "pending_approval") throw new Error("expected a proposal");
    approve(db, out.proposalId);
    const t = JSON.parse(proposal(db, out.proposalId).terms_json) as Record<string, unknown>;
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...t, items: [{ name: "Something else", unit_price: "45.00", quantity: "1" }] }), out.proposalId);
    await expect(executeAiriPurchase(db, d, out.proposalId, T0)).rejects.toThrow(/approved hash/);
    expect(d.airi.calls).toEqual([]);
  });

  it("terms changed between the mandate and the credential: the mandate is cancelled, no credential requested, no link shown", async () => {
    const db = fresh();
    let tamper: (() => void) | null = null;
    class Tampering extends StandInAiriClient {
      override async createMandate(r: AiriMandateRequest): Promise<AiriMandate> {
        const m = await super.createMandate(r);
        tamper?.();
        return m;
      }
    }
    const d = deps({ airi: new Tampering() });
    const out = await requestAiriPurchase(db, d, big(), T0);
    if (out.status !== "pending_approval") throw new Error("expected a proposal");
    approve(db, out.proposalId);
    const terms = proposal(db, out.proposalId).terms_json;
    tamper = () => db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...JSON.parse(terms), amount: "1.00" }), out.proposalId);
    const res = await executeAiriPurchase(db, d, out.proposalId, T0);
    expect(res).toMatchObject({ status: "refused", by: "purser", code: "PURSER_HASH_MISMATCH", mandateId: "standin-mdt-1" });
    expect(ops(d)).toEqual(["mandate create", "mandate cancel"]);
    expect(d.shown).toEqual([]);
    expect(proposal(db, out.proposalId).status).toBe("FAILED");
    expect(row(db, out.proposalId)).toMatchObject({ status: "RELEASED", code: "PURSER_HASH_MISMATCH" });
  });

  it("the same for a purchase within the limit: its stored terms changed before the credential", async () => {
    const db = fresh();
    let tamper: (() => void) | null = null;
    class Tampering extends StandInAiriClient {
      override async createMandate(r: AiriMandateRequest): Promise<AiriMandate> { const m = await super.createMandate(r); tamper?.(); return m; }
    }
    const d = deps({ airi: new Tampering() });
    tamper = () => db.prepare("UPDATE airi_purchases SET terms_json = replace(terms_json, '12.00', '11.00')").run();
    expect(await requestAiriPurchase(db, d, req(), T0)).toMatchObject({ status: "refused", code: "PURSER_HASH_MISMATCH" });
    expect(ops(d)).toEqual(["mandate create", "mandate cancel"]);
  });

  it("the policy tightened after the CFO signed: refused, the proposal closed, Airi not called", async () => {
    const db = fresh();
    const d = deps();
    const out = await requestAiriPurchase(db, d, big(), T0);
    if (out.status !== "pending_approval") throw new Error("expected a proposal");
    approve(db, out.proposalId);
    seed(db, { merchant: "blocked" });
    expect(await executeAiriPurchase(db, d, out.proposalId, T0)).toMatchObject({ status: "refused", by: "purser", code: "PURSER_MERCHANT_NOT_ALLOWED" });
    expect(d.airi.calls).toEqual([]);
    expect(proposal(db, out.proposalId).status).toBe("NEEDS_REAPPROVAL");
  });
});

describe("the CFO's terms hash in the Airi mandate, read back before the credential", () => {
  const descriptionSent = (d: { airi: StandInAiriClient }) => { const a = d.airi.calls.find((c) => c.op === "mandate create")!.args; return a[a.indexOf("--description") + 1]!; };
  /** A purchase above the limit, approved by the CFO, run against an Airi stand-in that follows `script`. */
  async function approvedPurchase(script: StandInScript = {}, over: Partial<AiriPurchaseRequest> = {}) {
    const db = fresh();
    const d = deps({ airi: new StandInAiriClient(script) });
    const out = await requestAiriPurchase(db, d, big(over), T0);
    if (out.status !== "pending_approval") throw new Error(`expected a proposal, got ${out.status}`);
    approve(db, out.proposalId);
    const p = proposal(db, out.proposalId);
    const res = await executeAiriPurchase(db, d, out.proposalId, T0);
    return { db, d, p, res };
  }

  it("the description carries the approved action id and the full terms SHA-256; a long text is cut, never the tag", async () => {
    const { d, p, res } = await approvedPurchase();
    expect(res).toMatchObject({ status: "succeeded" });
    expect(descriptionSent(d)).toBe(`order 1 [${p.proposal_id} terms:${p.terms_sha256}]`);
    expect(p.terms_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(mandateTag(descriptionSent(d))).toEqual({ actionId: p.proposal_id, termsSha256: p.terms_sha256 });
    // Within the limit, with no proposal: the purchase's own id and its order hash, the same way.
    const db = fresh(), alone = deps();
    const a = await requestAiriPurchase(db, alone, req(), T0);
    if (a.status !== "succeeded") throw new Error(`expected a purchase, got ${a.status}`);
    expect(descriptionSent(alone)).toBe(`order 1 [${a.actionId} terms:${a.orderSha256}]`);
    // 400 characters of text: the whole stays within Purser's bound for airi-cli's text flags, the tag whole at its end.
    const long = await approvedPurchase({}, { description: `${"long text ".repeat(40)}end` });
    expect(long.res).toMatchObject({ status: "succeeded" });
    const sent = descriptionSent(long.d);
    expect(sent.length).toBeLessThanOrEqual(AIRI_TEXT_MAX);
    expect(sent.endsWith(` [${long.p.proposal_id} terms:${long.p.terms_sha256}]`)).toBe(true);
    expect(sent.startsWith("long text long text")).toBe(true);
    // The hash in it is the hash of the very terms the mandate is made from.
    const terms = JSON.parse(long.p.terms_json) as AiriTerms;
    expect(mandateDescription(terms, long.p.proposal_id)).toBe(sent);
    expect(mandateDescription({ ...terms, amount: "44.00" }, long.p.proposal_id)).not.toBe(sent);
    // No tag, or half a hash, is no tag.
    expect(mandateTag("order 1 [P-0001]")).toBeNull();
    expect(mandateTag(`order 1 [P-0001 terms:${"a".repeat(63)}]`)).toBeNull();
  });

  it("reads the mandate back from Airi after creating it: only then is the link shown and the credential asked for", async () => {
    const seen: { op: string; linksShown: number }[] = [];
    const db = fresh();
    let d: ReturnType<typeof deps> | null = null;
    class Watching extends StandInAiriClient {
      override async readMandate(id: string, from: string) { seen.push({ op: "read", linksShown: d!.shown.length }); return super.readMandate(id, from); }
      override async getCredential(id: string, file: string) { seen.push({ op: "credential", linksShown: d!.shown.length }); return super.getCredential(id, file); }
    }
    d = deps({ airi: new Watching() });
    const out = await requestAiriPurchase(db, d, big(), T0);
    if (out.status !== "pending_approval") throw new Error("expected a proposal");
    approve(db, out.proposalId);
    const p = proposal(db, out.proposalId);
    expect(await executeAiriPurchase(db, d, out.proposalId, T0)).toMatchObject({ status: "succeeded" });
    expect(seen).toEqual([{ op: "read", linksShown: 0 }, { op: "credential", linksShown: 1 }]);
    // The read-back names the mandate by its id, from a minute before the purchase began.
    expect(d.airi.calls.find((c) => c.op === "mandate list")!.args).toEqual(["--mandate-id", "standin-mdt-1", "--created-from", "2026-11-07T09:59:00Z"]);
    const row = db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'airi.mandate_read_back'").get() as { subject: string; payload_json: string };
    expect(row.subject).toBe(p.proposal_id);
    expect(JSON.parse(row.payload_json)).toMatchObject({ action_id: p.proposal_id, mandate_id: "standin-mdt-1", order_sha256: p.terms_sha256, terms_sha256_in_mandate: p.terms_sha256, match: true });
    expect(d.waits).toEqual([]);
  });

  it("Airi's stored mandate carries another hash: refused, the mandate cancelled, no link shown, no credential asked for", async () => {
    const other = "0".repeat(64);
    const { db, d, p, res } = await approvedPurchase({ stored: (text) => text.replace(/terms:[0-9a-f]{64}/, `terms:${other}`) });
    expect(res).toMatchObject({ status: "refused", by: "purser", code: "PURSER_MANDATE_HASH_MISMATCH", mandateId: "standin-mdt-1" });
    expect((res as { reason: string }).reason).toContain(`carries terms 00000000…, not the approved ${p.terms_sha256.slice(0, 8)}…`);
    expect(ops(d)).toEqual(["mandate create", "mandate list", "mandate cancel"]);
    expect(d.shown).toEqual([]);
    expect(d.checkout.seen.map((x) => x.op)).toEqual(["prepare"]);
    expect(proposal(db, p.proposal_id).status).toBe("FAILED");
    expect(row(db, p.proposal_id)).toMatchObject({ status: "RELEASED", code: "PURSER_MANDATE_HASH_MISMATCH" });
    expect(events(db)).not.toContain("airi.mandate_read_back");
    expect(events(db)).not.toContain("airi.waiting_for_tap");
    // The audit row names both hashes in full: they are not secrets.
    expect(auditText(db)).toContain(other);
  });

  it("another action's tag, or a description that lost its tag: the same refusal", async () => {
    const elsewhere = await approvedPurchase({ stored: (text) => text.replace("[P-0001 ", "[P-0009 ") });
    expect(elsewhere.res).toMatchObject({ status: "refused", code: "PURSER_MANDATE_HASH_MISMATCH" });
    expect((elsewhere.res as { reason: string }).reason).toMatch(/P-0009/);
    const cut = await approvedPurchase({ stored: (text) => text.slice(0, 20) });
    expect(cut.res).toMatchObject({ status: "refused", code: "PURSER_MANDATE_HASH_MISMATCH" });
    expect((cut.res as { reason: string }).reason).toMatch(/does not carry this purchase's id and terms hash/);
    for (const x of [elsewhere, cut]) { expect(ops(x.d)).toEqual(["mandate create", "mandate list", "mandate cancel"]); expect(x.d.shown).toEqual([]); }
  });

  it("the mandate cannot be read back (not listed, no description, the list fails): refused, cancelled, no credential asked for", async () => {
    const unlisted = await approvedPurchase({ unlistedReads: READ_BACK_TRIES });
    expect(unlisted.res).toMatchObject({ status: "refused", by: "purser", code: "PURSER_MANDATE_NOT_READ_BACK", mandateId: "standin-mdt-1" });
    expect(ops(unlisted.d)).toEqual(["mandate create", ...Array.from({ length: READ_BACK_TRIES }, () => "mandate list"), "mandate cancel"]);
    expect(unlisted.d.waits).toHaveLength(READ_BACK_TRIES - 1);
    const bare = await approvedPurchase({ stored: () => null });
    expect(bare.res).toMatchObject({ status: "refused", code: "PURSER_MANDATE_NOT_READ_BACK" });
    expect((bare.res as { reason: string }).reason).toMatch(/no description/);
    const failing = await approvedPurchase({ failRead: "list_unavailable" });
    expect(failing.res).toMatchObject({ status: "refused", code: "PURSER_MANDATE_NOT_READ_BACK" });
    expect((failing.res as { reason: string }).reason).toMatch(/list_unavailable/);
    for (const x of [unlisted, bare, failing]) {
      expect(x.d.shown).toEqual([]);
      expect(ops(x.d).at(-1)).toBe("mandate cancel");
      expect(ops(x.d)).not.toContain("mandate get-credential");
      expect(row(x.db, x.p.proposal_id)).toMatchObject({ status: "RELEASED", code: "PURSER_MANDATE_NOT_READ_BACK" });
    }
  });

  it("a read that failed is tried again (it is read-only): one failed list does not end the purchase; three do", async () => {
    const once = await approvedPurchase({ failRead: "timeout", failReads: 1 });
    expect(once.res).toMatchObject({ status: "succeeded" });
    expect(ops(once.d)).toEqual(["mandate create", "mandate list", "mandate list", "mandate get-credential", "mandate result"]);
    const always = await approvedPurchase({ failRead: "timeout" });
    expect(always.res).toMatchObject({ status: "refused", code: "PURSER_MANDATE_NOT_READ_BACK" });
    expect((always.res as { reason: string }).reason).toMatch(new RegExp(`in ${READ_BACK_TRIES} tries \\(.*timeout`));
    expect(ops(always.d)).toEqual(["mandate create", ...Array.from({ length: READ_BACK_TRIES }, () => "mandate list"), "mandate cancel"]);
  });

  it("a mandate listed a moment later is read on the next try", async () => {
    const { d, res } = await approvedPurchase({ unlistedReads: 1 });
    expect(res).toMatchObject({ status: "succeeded" });
    expect(ops(d)).toEqual(["mandate create", "mandate list", "mandate list", "mandate get-credential", "mandate result"]);
    expect(d.waits).toHaveLength(1);
  });
});

describe("Airi and the checkout answer", () => {
  it("Airi refuses the credential: its code as given; the mandate cancelled; no checkout payment", async () => {
    const db = fresh();
    const d = deps({ airi: new StandInAiriClient({ refuseCredential: "STANDIN_DENIED" }) });
    expect(await requestAiriPurchase(db, d, req(), T0)).toMatchObject({ status: "refused", by: "airi", code: "STANDIN_DENIED", mandateId: "standin-mdt-1" });
    expect(d.checkout.seen.map((s) => s.op)).toEqual(["prepare"]);
    expect(ops(d)).toEqual(["mandate create", "mandate list", "mandate get-credential", "mandate cancel"]);
  });

  it("no tap within the wait: Purser stops, cancels the mandate, releases the hold", async () => {
    const db = fresh();
    const d = deps({ airi: new StandInAiriClient({ noTap: true }) });
    const out = await requestAiriPurchase(db, d, req(), T0);
    expect(out).toMatchObject({ status: "refused", by: "purser", code: "PURSER_NO_TAP" });
    expect(ops(d)).toEqual(["mandate create", "mandate list", "mandate get-credential", "mandate cancel"]);
    if (out.status !== "refused") throw new Error("unreachable");
    expect(row(db, out.actionId!)).toMatchObject({ status: "RELEASED" });
  });

  it("the checkout cannot take orders: refused with its code before Airi is asked", async () => {
    const db = fresh();
    const d = deps({ checkout: new StandInCheckout({ unavailable: "unauthorized" }) });
    expect(await requestAiriPurchase(db, d, req(), T0)).toMatchObject({ status: "refused", by: "checkout", code: "unauthorized" });
    expect(d.airi.calls).toEqual([]);
  });

  it("the checkout declines: its code shown, and DECLINED reported to Airi with it", async () => {
    const db = fresh();
    const d = deps({ checkout: new StandInCheckout({ decline: "authorization_failed" }) });
    const out = await requestAiriPurchase(db, d, req(), T0);
    expect(out).toMatchObject({ status: "refused", by: "checkout", code: "authorization_failed" });
    expect(d.airi.calls.at(-1)).toEqual({ op: "mandate result", args: ["--mandate-id", "standin-mdt-1", "--result", "DECLINED", "--reason", "authorization_failed"] });
    if (out.status !== "refused") throw new Error("unreachable");
    expect(row(db, out.actionId!)).toMatchObject({ status: "RELEASED", outcome: "DECLINED", code: "authorization_failed" });
  });

  it("an unknown outcome is left UNCONFIRMED: no result reported, nothing retried, the hold kept", async () => {
    const db = fresh();
    const d = deps({ checkout: new StandInCheckout({ noAnswer: true }) });
    const out = await requestAiriPurchase(db, d, req(), T0);
    expect(out).toMatchObject({ status: "unconfirmed" });
    expect(ops(d)).toEqual(["mandate create", "mandate list", "mandate get-credential"]);
    expect(events(db)).toContain("airi.checkout_unconfirmed");
    if (out.status !== "unconfirmed") throw new Error("unreachable");
    expect(row(db, out.actionId)).toMatchObject({ status: "UNCONFIRMED" });
    expect(readdirSync(tmpRoot).filter((n) => n.startsWith(TMP_PREFIX))).toEqual([]);
  });
});

describe("after a crash: nothing twice", () => {
  it("an UNCONFIRMED payment is looked up; a final answer is reported to Airi and settled", async () => {
    const db = fresh();
    const out = await requestAiriPurchase(db, deps({ checkout: new StandInCheckout({ noAnswer: true }) }), req(), T0);
    if (out.status !== "unconfirmed") throw new Error("expected unconfirmed");
    const d2 = deps({ checkout: new StandInCheckout({ lookup: { outcome: "SUCCEEDED", reference: out.reference, code: "SUCCEEDED" } }) });
    expect(await recoverAiriPurchases(db, d2, T0)).toEqual([{ actionId: out.actionId, status: "SETTLED" }]);
    expect(d2.checkout.seen.map((s) => s.op)).toEqual(["lookup"]);
    expect(ops(d2)).toEqual(["mandate result"]);
  });

  it("a lookup that cannot tell leaves it UNCONFIRMED and sends nothing", async () => {
    const db = fresh();
    const out = await requestAiriPurchase(db, deps({ checkout: new StandInCheckout({ noAnswer: true }) }), req(), T0);
    if (out.status !== "unconfirmed") throw new Error("expected unconfirmed");
    const d2 = deps();
    expect(await recoverAiriPurchases(db, d2, T0)).toEqual([{ actionId: out.actionId, status: "UNCONFIRMED" }]);
    expect(d2.airi.calls).toEqual([]);
  });

  it("stopped before the payment (the process died waiting for the tap): the mandate is cancelled and the hold released", async () => {
    const db = fresh();
    // As a crash leaves it: reserved, the order opened, the mandate made, waiting for the tap, a credential directory left.
    db.prepare("INSERT INTO airi_purchases (action_id, agent, route, order_sha256, terms_json, cents, day, status, mandate_id, checkout_ref, created_at, updated_at) VALUES ('airi-crash', 'sourcing', 'alone', 'x', ?, 1200, '2026-11-07', 'WAITING_FOR_TAP', 'standin-mdt-9', 'standin-order-9', ?, ?)")
      .run(JSON.stringify({ description: "order 9" }), T0.toISOString(), T0.toISOString());
    startStep(db, "airi-crash", 1, "airi.checkout_prepare", "airi-crash", T0);
    startStep(db, "airi-crash", 2, "airi.mandate", "airi-crash", T0);
    mkdirSync(join(tmpRoot, `${TMP_PREFIX}left`));
    writeFileSync(join(tmpRoot, `${TMP_PREFIX}left`, "credential.json"), "{}", { mode: 0o600 });
    const d2 = deps({ checkout: new StandInCheckout({ lookup: null }) });
    const r = await recoverAiriPurchases(db, d2, T0);
    expect(r).toContainEqual({ actionId: "airi-crash", status: "RELEASED" });
    expect(d2.airi.calls.filter((c) => c.args.includes("standin-mdt-9")).map((c) => c.op)).toEqual(["mandate cancel"]);
    expect(row(db, "airi-crash")).toMatchObject({ code: "PURSER_RESTARTED_BEFORE_CHECKOUT" });
    expect(readdirSync(tmpRoot).filter((n) => n.startsWith(TMP_PREFIX))).toEqual([]);
  });

  it("a proposal resumed by the runner after a crash finishes through the same recovery, never a second mandate", async () => {
    const db = fresh();
    const out = await requestAiriPurchase(db, deps(), big(), T0);
    if (out.status !== "pending_approval") throw new Error("expected a proposal");
    approve(db, out.proposalId);
    const first = await executeAiriPurchase(db, deps({ checkout: new StandInCheckout({ noAnswer: true }) }), out.proposalId, T0);
    expect(first).toMatchObject({ status: "unconfirmed" });
    // FAILED with the outcome unknown; the runner does not run it again, the recovery looks it up.
    expect(proposal(db, out.proposalId).status).toBe("FAILED");
    const d2 = deps({ checkout: new StandInCheckout({ lookup: { outcome: "DECLINED", reference: "standin-order-1", code: "authorization_failed" } }) });
    await recoverAiriPurchases(db, d2, T0);
    expect(row(db, out.proposalId)).toMatchObject({ status: "RELEASED", outcome: "DECLINED", code: "authorization_failed" });
    expect(ops(d2)).toEqual(["mandate result"]);
    expect(d2.airi.calls[0]!.args).toEqual(["--mandate-id", "standin-mdt-1", "--result", "DECLINED", "--reason", "authorization_failed"]);
  });
});
