// The platform end-to-end (src/e2e), on stand-ins: three test companies through the real product path, one receipt per
// approval that verify-receipt checks offline, the books in T:0 tagged per company, every call within its budget, and
// a payout waiting in Airwallex's own approval workflow stopping the run.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BudgetSpent, CallBudget } from "../src/e2e/budget.js";
import { estimateLive } from "../src/e2e/estimate.js";
import { runPlatformE2E, toPostings, WaitingForAirwallexApproval } from "../src/e2e/platformRun.js";
import { budgetedReader, dryRunDeps, parserOnly } from "../src/e2e/setup.js";
import { rateFromAmounts } from "../src/e2e/platformOps.js";
import { missingFromSchema, payoutBeneficiaryBody } from "../src/airwallex/adapter.js";
import { RECORDED_BENEFICIARY_SCHEMAS } from "../src/redteam/beneficiarySchemas.js";
import { FUND_CENTS } from "../src/e2e/setup.js";
import { verifyReceipt } from "../src/try/receipt.js";
import { appendFileSync, existsSync } from "node:fs";
import { finishRun } from "../src/e2e/finish.js";
import { retryCompany } from "../src/e2e/retry.js";
import { WORLD } from "../src/e2e/world.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "e2e-platform-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const now = () => new Date("2026-11-10T10:00:00Z");

describe("the platform end-to-end, dry run", () => {
  it("pays every invoice of three companies on behalf of their own accounts, with Purser's fee, booked and in T:0", async () => {
    const dry = dryRunDeps();
    const s = await runPlatformE2E({ ...dry.deps, dir, now, log: () => undefined });
    expect(s.companies.map((c) => [c.key, c.opened, c.audit.ok])).toEqual([["SANDBOXTEST", false, true], ["BAKKERIJ", true, true], ["FIETSLAB", true, true]]);
    expect(s.payments.map((p) => p.kind)).toEqual(["supplier_payment", "payment_batch", "supplier_payment"]);
    const transfers = s.payments.flatMap((p) => p.transfers);
    expect(transfers).toHaveLength(4);
    for (const t of transfers) { expect(t.status).toBe("PAID"); expect(t.purser_fee).toMatch(/^EUR 0\.0\d SETTLED$/); }
    // Each payout went out on behalf of its own company's connected account, and only there.
    expect([...dry.rails.keys()]).toEqual(["acct_SC-QD89fOneAeqaRFgOymw", "acct_fake_bakkerij", "acct_fake_fietslab"]);
    expect([...dry.rails.values()].map((r) => r.platformFees.length)).toEqual([1, 2, 1]);
    // T:0: one shared entity, every entry's memo names its company and its PUR id; debits equal credits.
    expect(s.t0.posted).toBe(8);
    const posted = dry.t0.entries;
    for (const e of posted) {
      expect(e.memo).toMatch(/\[(SANDBOXTEST|BAKKERIJ|FIETSLAB)\] PUR-(SANDBOXTEST|BAKKERIJ|FIETSLAB)-AP-\d{4}/);
      const dr = e.lines.filter((l) => l.line_type === "debit").reduce((n, l) => n + l.amount_atoms, 0);
      expect(dr).toBe(e.lines.filter((l) => l.line_type === "credit").reduce((n, l) => n + l.amount_atoms, 0));
    }
    expect(s.payments.map((p) => p.t0_entries.length)).toEqual([2, 4, 2]);
  });

  it("every receipt verifies offline: the passkey over the exact terms, then each step from invoice to T:0", async () => {
    const s = await runPlatformE2E({ ...dryRunDeps().deps, dir, now, log: () => undefined });
    for (const p of s.payments) {
      const r = verifyReceipt(JSON.parse(readFileSync(p.receipt, "utf8")));
      expect(r.checks.filter((c) => !c.ok)).toEqual([]);
      expect(r.checks.map((c) => c.check)).toEqual(expect.arrayContaining(["signature", "e2e steps", "e2e signature"]));
    }
    const receipt = JSON.parse(readFileSync(s.payments[1]!.receipt, "utf8")) as { e2e: { steps: { kind: string; data: Record<string, unknown> }[] } };
    expect(receipt.e2e.steps.map((x) => x.kind)).toEqual(["account", "invoice_received", "invoice_read", "supplier_approved", "invoice_received", "invoice_read", "supplier_approved", "signature", "payout", "payout", "booked", "t0_posted"]);
  });

  it("a changed step, or a step moved to another payment's terms, fails verification", async () => {
    const s = await runPlatformE2E({ ...dryRunDeps().deps, dir, now, log: () => undefined });
    const r = JSON.parse(readFileSync(s.payments[0]!.receipt, "utf8")) as { terms_sha256: string; e2e: { steps: { kind: string; data: Record<string, unknown> }[] } };
    const payout = r.e2e.steps.find((x) => x.kind === "payout")!;
    payout.data.amount = "EUR 999.00";
    const out = verifyReceipt(r);
    expect(out.ok).toBe(false);
    expect(out.checks.find((c) => c.check === "e2e steps")?.detail).toMatch(/does not hash to its row/);
    const other = JSON.parse(readFileSync(s.payments[1]!.receipt, "utf8")) as { e2e: unknown };
    const swapped = { ...JSON.parse(readFileSync(s.payments[0]!.receipt, "utf8")), e2e: other.e2e };
    expect(verifyReceipt(swapped).checks.find((c) => c.check === "e2e signature")?.ok).toBe(false);
  });

  it("a payout waiting in Airwallex's own approval workflow stops the run; nothing moves it on", async () => {
    const dry = dryRunDeps();
    const railFor = dry.deps.railFor;
    const run = runPlatformE2E({ ...dry.deps, railFor: (a) => { const r = railFor(a); (r.rail as { approvalWorkflow?: boolean }).approvalWorkflow = true; return r; }, dir, now, log: () => undefined });
    await expect(run).rejects.toBeInstanceOf(WaitingForAirwallexApproval);
    await expect(run).rejects.toThrow(/IN_APPROVAL at Airwallex: approve in Airwallex's web app/);
  });
});

describe("the live run's budget", () => {
  it("counts every call and refuses the one over the approved number, before it is sent", async () => {
    const b = new CallBudget({ airwallex: 1, t0: 0, claude: 0, metal: 0 });
    let sent = 0;
    const f = b.fetchFor("airwallex", (async () => { sent++; return new Response("{}"); }) as typeof fetch);
    await f("https://api.sandbox.airwallex.com/api/v1/transfers/create", { method: "POST" });
    await expect(f("https://api.sandbox.airwallex.com/api/v1/transfers/create", { method: "POST" })).rejects.toBeInstanceOf(BudgetSpent);
    expect(sent).toBe(1);
    expect(b.summary()).toEqual([{ service: "airwallex", endpoint: "POST /transfers/create", calls: 1 }]);
  });

  it("once Claude's budget is spent, the parser reads (no call is made)", async () => {
    const b = new CallBudget({ airwallex: 0, t0: 0, claude: 0, metal: 0 });
    let called = 0;
    const r = budgetedReader({ ask: async () => { called++; throw new Error("no"); } } as never, b);
    const out = await r.ask({} as never, () => "parsed" as never);
    expect(called).toBe(0);
    expect(out).toMatchObject({ value: "parsed", source: "fallback" });
  });

  it("the plan from the dry run says how many calls a live run makes, so an approval too small is refused before any call", async () => {
    const dry = dryRunDeps();
    const counter = new CallBudget({ airwallex: 1e6, t0: 1e6, claude: 1e6, metal: 0 });
    await runPlatformE2E({ ...dry.deps, readerFor: () => budgetedReader(parserOnly, counter), dir, now, log: () => undefined });
    const est = estimateLive(dry, counter.used("claude"));
    expect(est.calls.airwallex).toBeGreaterThan(0);
    expect(est.calls.t0).toBe(dry.t0.calls.length);
    expect(est.calls.claude).toBe(counter.used("claude"));
  });

  it("T:0 postings carry the company and PUR id in their name and memo", () => {
    const p = toPostings({ key: "BAKKERIJ" }, [{ date: "2026-11-10", invoice_id: "AP-0001", event: "payment", account: "2100", account_name: "AP", debit: "3.63", credit: "", currency: "EUR", memo: "x", doc_sha256: "a".repeat(64) }]);
    expect(p[0]).toMatchObject({ entry: "PUR-BAKKERIJ-AP-0001-payment", ref: "PUR-BAKKERIJ-AP-0001", description: "[BAKKERIJ] PUR-BAKKERIJ-AP-0001: x", debit_cents: 363 });
  });

  it("a T:0 in USD: the rate comes from Airwallex's amounts, and every entry's memo keeps its EUR amount and names the rate and time", () => {
    expect(rateFromAmounts(10_000, 9_200)).toBe("1.086957");
    expect(() => rateFromAmounts(10_000, 0)).toThrow();
    const fx = { rate: "1.086957", to: "USD", at: "2026-11-10T07:00:00.000Z", source: "Airwallex sandbox GET /fx/rates/current" };
    const p = toPostings({ key: "FIETSLAB" }, [
      { date: "2026-11-10", invoice_id: "AP-0001", event: "payment", account: "2100", account_name: "AP", debit: "6.05", credit: "", currency: "EUR", memo: "x", doc_sha256: "a".repeat(64) },
      { date: "2026-11-10", invoice_id: "AP-0001", event: "payment", account: "1200", account_name: "Bank", debit: "", credit: "6.05", currency: "EUR", memo: "x", doc_sha256: "a".repeat(64) },
    ], fx);
    for (const x of p) expect(x.description).toBe("[FIETSLAB] PUR-FIETSLAB-AP-0001: x · EUR 6.05 · converted at Airwallex sandbox rate 1.086957 USD per EUR at 2026-11-10T07:00:00.000Z");
  });

  it("an NL supplier on the LOCAL route: the body carries payment_methods and the bank's name from its BIC (the 10 November refusal)", () => {
    const b = { name: "Onderdelen Direct B.V.", address: { street: "x", city: "y", postcode: "z", countryCode: "NL" }, method: "LOCAL" as const,
      bank: { country: "NL", currency: "EUR", accountName: "Onderdelen Direct B.V.", iban: "NL44RABO0123456789", swiftCode: "RABONL2U" } };
    const body = payoutBeneficiaryBody(b) as { payment_methods: string[]; transfer_methods: string[]; beneficiary: { bank_details: Record<string, string> } };
    expect(body.payment_methods).toEqual(["LOCAL"]);
    expect(body.transfer_methods).toEqual(["LOCAL"]);
    expect(body.beneficiary.bank_details.bank_name).toBe("Coöperatieve Rabobank U.A.");
    expect(missingFromSchema(RECORDED_BENEFICIARY_SCHEMAS["NL EUR LOCAL"]!, body)).toEqual([]);
    // A BIC not listed gives no name: the schema check says so instead of a guess.
    const unknown = payoutBeneficiaryBody({ ...b, bank: { ...b.bank, swiftCode: "ZZZZNL2A" } });
    expect(missingFromSchema(RECORDED_BENEFICIARY_SCHEMAS["NL EUR LOCAL"]!, unknown)).toEqual(["beneficiary.bank_details.bank_name"]);
  });

  it("a re-run never funds an account twice: one already holding what the run needs is skipped", async () => {
    const dry = dryRunDeps();
    void dry.deps.railFor("acct_SC-QD89fOneAeqaRFgOymw"); // the existing account, funded by an earlier run
    (dry.rails.get("acct_SC-QD89fOneAeqaRFgOymw")!).bal.EUR.availableCents = FUND_CENTS;
    const s = await runPlatformE2E({ ...dry.deps, dir, now, log: () => undefined });
    expect(dry.platform.funded.map((f) => f.accountId)).toEqual(["acct_fake_bakkerij", "acct_fake_fietslab"]);
    expect(s.companies[0]!.funding).toMatch(/^none skipped: EUR 60\.00 already held$/);
  });

  it("a batch line Airwallex refuses at create stops the run before the next company (10 November: payer registration number)", async () => {
    const dry = dryRunDeps();
    const railFor = dry.deps.railFor;
    const run = runPlatformE2E({ ...dry.deps, railFor: (a) => { const r = railFor(a); if (a === "acct_fake_bakkerij") (r.rail as unknown as { refuseNextTransfer: string | null }).refuseNextTransfer = "validation_failed"; return r; }, dir, now, log: () => undefined });
    await expect(run).rejects.toThrow(/^BAKKERIJ: .*: the run stops here$/);
    expect([...dry.rails.keys()]).not.toContain("acct_fake_fietslab");
  });

  it("a run stopped part-way is finished from the ledgers: facts of every company, receipt and T:0 for the one PAID", async () => {
    const dry = dryRunDeps();
    const railFor = dry.deps.railFor;
    const logFile = `${dir}.log`;
    await expect(runPlatformE2E({ ...dry.deps, railFor: (a) => { const r = railFor(a); if (a === "acct_fake_bakkerij") (r.rail as unknown as { refuseNextTransfer: string | null }).refuseNextTransfer = "validation_failed"; return r; }, dir, now, log: (l) => appendFileSync(logFile, `${l}\n`) })).rejects.toThrow(/the run stops here/);
    appendFileSync(logFile, "EUR entries converted at Airwallex sandbox rate 1.111482 USD per EUR at 2026-11-10T07:06:03.000Z (test)\n");
    const fx = { rate: "1.111482", to: "USD", at: "2026-11-10T07:06:03.000Z", source: "test" };
    const before = dry.t0.entries.length;
    const facts = await finishRun({ t0: dry.deps.t0, t0Rate: () => undefined, t0Currency: { currency: "EUR", atomsPerUnit: 100 }, fx, now }, dir, logFile, WORLD);
    expect(facts.map((f) => f.key)).toEqual(["SANDBOXTEST", "BAKKERIJ"]);
    expect(facts[0]!.transfers.map((t) => t.status)).toEqual(["PAID"]);
    expect(facts[1]!.transfers.some((t) => t.status !== "PAID")).toBe(true);
    const sb = facts[0]!;
    expect(sb.account).toBe("acct_SC-QD89fOneAeqaRFgOymw");
    expect(sb.t0_entries).toHaveLength(2);
    expect(dry.t0.entries.length - before).toBe(2);
    expect(existsSync(sb.receipt!)).toBe(true);
    expect(verifyReceipt(JSON.parse(readFileSync(sb.receipt!, "utf8"))).checks.filter((c) => !c.ok)).toEqual([]);
    expect(facts[1]!.receipt).toBeNull();
    expect(facts[1]!.refusals.length).toBeGreaterThan(0);
    rmSync(logFile, { force: true });
  });

  it("registration number: refused without it (as live), then retried from the ledger with the TEST number, PAID, receipts verify", async () => {
    const dry = dryRunDeps();
    const railFor = dry.deps.railFor;
    const strict = (a: string) => { const r = railFor(a); if (a !== "acct_SC-QD89fOneAeqaRFgOymw") (r.rail as unknown as { requirePayerRegistration: boolean }).requirePayerRegistration = true; return r; };
    const logFile = `${dir}.log`;
    const noNumbers = WORLD.map((c) => ({ ...c, testRegistrationNumber: undefined }));
    // As on 10 November: without the payer's registration number the new account's payout is refused, and the run stops.
    await expect(runPlatformE2E({ ...dry.deps, world: noNumbers, railFor: strict, dir, now, log: (l) => appendFileSync(logFile, `${l}\n`) })).rejects.toThrow(/^BAKKERIJ: .*: the run stops here$/);
    // The retry: same ledger, no new reading, a new test passkey, the TEST number as the payer's.
    const bak = { ...WORLD[1]!, accountId: "acct_fake_bakkerij" };
    const pid = await retryCompany({ platform: dry.platform, railFor: strict, feeBps: "50", now, log: () => undefined }, dir, bak);
    expect(dry.rails.get("acct_fake_bakkerij")!.platformFees).toHaveLength(2);
    appendFileSync(logFile, "EUR entries converted at Airwallex sandbox rate 1.111482 USD per EUR at 2026-11-10T07:06:03.000Z (test)\n");
    const facts = await finishRun({ t0: dry.deps.t0, t0Rate: () => undefined, t0Currency: { currency: "EUR", atomsPerUnit: 100 }, fx: { rate: "1.111482", to: "USD", at: "2026-11-10T07:06:03.000Z", source: "test" }, now }, dir, logFile, WORLD);
    const b = facts.find((f) => f.key === "BAKKERIJ")!;
    expect(b.receipt).toMatch(new RegExp(`receipt-${pid}\\.json$`));
    expect(verifyReceipt(JSON.parse(readFileSync(b.receipt!, "utf8"))).checks.filter((c) => !c.ok)).toEqual([]);
    expect(b.transfers.map((t) => t.status)).toEqual(["CANCELLED", "CANCELLED", "PAID", "PAID"]);
    rmSync(logFile, { force: true });
  });
});
