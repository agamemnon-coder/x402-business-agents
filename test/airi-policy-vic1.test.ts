// The Airi rail's CFO policy keys (src/airi/policy.ts, src/policy/rules.ts, src/policy/loosens.ts) and the vic-1
// driver (src/airi/vic1.ts) on the stand-ins: no network.
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { airiPolicy } from "../src/airi/policy.js";
import { StandInAiriClient, StandInCheckout } from "../src/airi/standIn.js";
import { executeAiriPurchase } from "../src/airi/purchase.js";
import { assertNoSecrets, counted, preflight, runVic1, Vic1Stop, type Vic1Deps } from "../src/airi/vic1.js";
import { decide } from "../src/policy/approvals.js";
import { loosens, rules, validateChange } from "../src/policy/rules.js";

const T0 = new Date("2026-11-07T10:00:00Z");
afterEach(() => { delete process.env.KIT11_AIRI_RAIL; });

describe("the rail's policy keys", () => {
  it("exist only with KIT11_AIRI_RAIL=on (or once set), and start strict: the merchant blocked", () => {
    const db = openDb(":memory:");
    expect(rules(db).some((r) => r.key.startsWith("approval.airi"))).toBe(false);
    process.env.KIT11_AIRI_RAIL = "on";
    expect(rules(db).filter((r) => r.key.includes("airi")).map((r) => `${r.key}=${r.fallback}`)).toEqual(["approval.airi_alone=20.00", "approval.airi_alone_per_day=3", "airi.merchant.northwind-sandbox=blocked"]);
    expect(airiPolicy(db)).toMatchObject({ aloneMaxCents: 2000, alonePerDay: 3, merchants: [] });
  });

  it("change only within their bounds; more without Face ID, or a merchant allowed, loosens", () => {
    process.env.KIT11_AIRI_RAIL = "on";
    const db = openDb(":memory:");
    expect(validateChange(db, { key: "approval.airi_alone_per_day", from: "3", to: "11" })).toMatch(/one of 0, 1/);
    expect(validateChange(db, { key: "approval.airi_alone_per_day", from: "3", to: "2" })).toBeNull();
    expect(validateChange(db, { key: "approval.airi_alone", from: "20.00", to: "250.00" })).toMatch(/at most 200\.00/);
    expect(loosens({ key: "approval.airi_alone_per_day", from: "3", to: "4" })).toBe(true);
    expect(loosens({ key: "approval.airi_alone_per_day", from: "3", to: "2" })).toBe(false);
    expect(loosens({ key: "approval.airi_alone", from: "20.00", to: "30.00" })).toBe(true);
    expect(loosens({ key: "airi.merchant.northwind-sandbox", from: "blocked", to: "allowed" })).toBe(true);
    expect(loosens({ key: "airi.merchant.northwind-sandbox", from: "allowed", to: "blocked" })).toBe(false);
  });
});

function dryDeps(o: { session?: { authenticated: boolean; sessionExpires: string | null } } = {}) {
  const db = openDb(":memory:");
  const lines: string[] = [];
  const calls: { op: string; by: string }[] = [];
  const airi = counted(new StandInAiriClient(o.session ? { session: o.session } : {}), "airi", calls);
  const checkout = counted(new StandInCheckout(), "checkout", calls);
  const rail = { airi, checkout, showPasskeyUrl: () => lines.push("TAP (console only)") };
  const d: Vic1Deps = {
    db, mode: "dry", rail, airi, log: (l) => lines.push(l), now: () => T0,
    awaitCfo: async (id) => {
      const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
      decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "stand-in", method: "cli" }, T0);
      await executeAiriPurchase(db, rail, id, T0);
      return (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
    },
  };
  return { d, lines, calls };
}

describe("vic-1 on the stand-ins", () => {
  it("A alone, B after the CFO, C refused by Purser with no Airi call; a record with no link and no card number", async () => {
    process.env.KIT11_AIRI_RAIL = "on";
    const { d, calls } = dryDeps();
    const rec = await runVic1(d, () => calls);
    expect(Object.fromEntries(Object.entries(rec.checks).map(([k, v]) => [k, v.ok]))).toEqual({ a_alone: true, a_answered: true, b_cfo_first: true, b_ran_after_face_id: true, c_refused_by_purser: true });
    expect(rec.label).toMatch(/DRY RUN/);
    const text = JSON.stringify(rec);
    expect(text).not.toContain("stand-in.invalid");
    // Each mandate is read back from Airi before its credential is asked for.
    expect(calls.filter((c) => c.by === "airi").map((c) => c.op)).toEqual(["whoami", "listPaymentMethods", "createMandate", "readMandate", "getCredential", "reportResult", "createMandate", "readMandate", "getCredential", "reportResult"]);
    // The record's audit rows hold the read-back of both purchases: the mandate's id and the terms hash Airi stores, matching.
    const back = (rec.audit as { event: string; payload: { mandate_id: string; order_sha256: string; terms_sha256_in_mandate: string; match: boolean } }[]).filter((r) => r.event === "airi.mandate_read_back");
    expect(back).toHaveLength(2);
    for (const r of back) expect(r.payload).toMatchObject({ match: true, terms_sha256_in_mandate: r.payload.order_sha256 });
  });

  it("the preflight stops with 'Max must log in again' when the Airi session has lapsed or is about to", async () => {
    for (const s of [{ authenticated: false, sessionExpires: null }, { authenticated: true, sessionExpires: "2026-11-07T09:59:00Z" }, { authenticated: true, sessionExpires: "2026-11-07T10:05:00Z" }]) {
      const { d, calls } = dryDeps({ session: s });
      await expect(preflight(d)).rejects.toThrow(/Max must log in again/);
      expect(calls.map((c) => c.op)).toEqual(["whoami"]);
    }
    await expect(preflight(dryDeps({ session: { authenticated: true, sessionExpires: "2026-11-07T10:30:00Z" } }).d)).resolves.toMatchObject({ method: { paymentMethodId: "standin-pm-1" } });
  });

  it("refuses to write a link or a card-like number; the call counter refuses past its budget", () => {
    expect(() => assertNoSecrets("open https://app.airi.com/pay/x")).toThrow(/link/);
    expect(() => assertNoSecrets("4111111111111111")).toThrow(/card-like/);
    expect(() => assertNoSecrets("mandate mdt_1, intent int_1")).not.toThrow();
    const sink: { op: string; by: string }[] = [];
    const c = counted(new StandInAiriClient(), "airi", sink, 1);
    void c.whoami();
    expect(() => c.whoami()).toThrow(Vic1Stop);
  });
});

describe("wiring", () => {
  it("the phone shows an airi_purchase as approvable, with amount, merchant and items", async () => {
    const { describeTerms } = await import("../src/approve/client.js");
    const d = describeTerms({ kind: "airi_purchase", agent: "sourcing", amount: "45.00", currency: "EUR", merchant: { name: "Northwind test shop", url: "https://kit11.max-31b.workers.dev/", country: "NL" }, items: [{ name: "Repair kit", unit_price: "45.00", quantity: "1" }], description: "vic-1 B" }, {});
    expect(d).toMatchObject({ approvable: true, title: "Airi purchase", amount: "EUR 45.00" });
    expect(d.sentence).toContain("Northwind test shop");
    expect(JSON.stringify(d.rows)).toContain("1 × Repair kit at 45.00");
  });

  it("the runner refuses an approved airi_purchase while the rail is off, and calls nothing", async () => {
    const { execute } = await import("../src/executors/index.js");
    const { createProposal } = await import("../src/policy/approvals.js");
    const { airiTerms } = await import("../src/airi/purchase.js");
    const db = openDb(":memory:");
    const p = createProposal(db, { terms: airiTerms({ agent: "sourcing", paymentMethodId: "pm", merchantName: "m", merchantUrl: "https://kit11.max-31b.workers.dev/", merchantCountry: "NL", amount: "45.00", currency: "EUR", items: [{ name: "k", unitPrice: "45.00", quantity: "1" }], description: "d" }, "P-0001", "2026-11-07T10:30:00Z"), createdBy: "sourcing" }, T0);
    decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, T0);
    await expect(execute(db, p.proposal_id, undefined, { fetch: () => { throw new Error("no network"); }, log: () => {}, env: {} })).rejects.toThrow(/Airi rail is off/);
    expect(db.prepare("SELECT status FROM proposals").get()).toEqual({ status: "APPROVED" });
  });
});
