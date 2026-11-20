// The Airwallex API trail (src/airwallex/apiTrail.ts) read from records other than the committed ones, through a
// stand-in for the file system: with no record at all there is no run and every count is zero; with records that leave
// fields out, each row shows only what its record holds (no status, no id, no signed hash where none is recorded),
// every hash check without a signed hash fails, and nothing is guessed. The soak records (src/airwallex/soakRecords.ts):
// one that created nothing or cannot be read is left out, no runs folder is no soak, and one that disappears between
// listing and reading is left out. The committed records are test/airwallex-api-trail.test.ts's.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => ({ files: null as Map<string, unknown> | null, runs: null as string[] | Error | null, reads: new Map<string, number>(), vanishAfter: new Map<string, number>() }));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const rel = (p: unknown) => decodeURIComponent(String(p instanceof URL ? p.pathname : p)).replace(/^.*?\/(docs\/)/, "$1");
  return {
    ...real,
    readFileSync: ((p: unknown, ...rest: unknown[]) => {
      const f = rel(p);
      if (fsState.files && f.startsWith("docs/")) {
        const n = (fsState.reads.get(f) ?? 0) + 1;
        fsState.reads.set(f, n);
        const v = fsState.files.get(f);
        if (v === undefined || n > (fsState.vanishAfter.get(f) ?? Infinity)) throw Object.assign(new Error(`ENOENT: ${f}`), { code: "ENOENT" });
        return JSON.stringify(v);
      }
      return (real.readFileSync as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof real.readFileSync,
    readdirSync: ((p: unknown, ...rest: unknown[]) => {
      if (fsState.runs instanceof Error && rel(p).startsWith("docs/runs")) throw fsState.runs;
      if (fsState.runs && rel(p).startsWith("docs/runs")) return fsState.runs;
      return (real.readdirSync as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof real.readdirSync,
  };
});

const { apiTrail, trailRuns, FAMILIES } = await import("../src/airwallex/apiTrail.js");

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const AT = "2026-11-12T10:00:00Z";
const line = (method: string, endpoint: string, extra: Record<string, unknown> = {}) => ({ at: AT, method, endpoint, ...extra });

beforeEach(() => {
  fsState.files = new Map();
  fsState.runs = [];
  fsState.reads.clear();
  fsState.vanishAfter.clear();
});

describe("no record at all", () => {
  it("no run, and every count is zero", () => {
    expect(trailRuns()).toEqual([]);
    const t = apiTrail();
    expect(t).toMatchObject({ runs: [], calls: 0, timed: 0, checks: { transfers: { total: 0, match: 0 }, batches: { total: 0, match: 0 }, recomputed: 0 } });
    expect(Object.values(t.byFamily)).toEqual(FAMILIES.map(() => 0));
  });
});

describe("records that leave fields out", () => {
  beforeEach(() => {
    const f = fsState.files!;
    f.set("docs/runs/airwallex-readback.json", { read_at: "2026-11-01T10:00:00Z", found: [{ kind: "refund", id: "r1", status: "DONE", amount: "-" }, { kind: "deposit", id: "d1", status: "SETTLED" }] });
    // A transfer read back with no approval hash in its metadata, and no proposal named in why: no check.
    f.set("docs/runs/airwallex-transfer-approval-2026-11-06.json", { read_at: "2026-11-06T10:00:00Z", transfer: { id: "tr_1", status: "PAID" } });
    f.set("docs/demo/airwallex-run.json", {
      calls: { airwallex: [{ endpoint: "POST /transfers/create", calls: 1 }, { endpoint: "POST /issuing/cards/create", calls: 1 }], airwallex_total: 2, budget: 10 },
      invoices: [{ invoice_no: "INV-1", transfer_id: "tr_9", status: "PAID", proposal_id: "P-0009", approval_sha256: SHA_A }],
      proposals: [], cards: [],
    });
    f.set("docs/runs/airwallex-vic-payment-intents-2026-11-12.json", { read_at: "2026-11-12T09:00:00Z", calls: [{ method: "GET", endpoint: "/pa/{id}/{id}" }], payment_intents: [] });
    f.set("docs/runs/2026-11-12-airwallex-financial-transactions.json", { calls: { lines: [line("GET", "/financial_transactions")] }, audit: [{ event: "awx_ft.read", payload: { count: 3 } }] });
    f.set("docs/runs/2026-11-12-airwallex-batch-transfer.json", {
      calls: [line("POST", "/batch_transfers/create")],
      audit: [{ event: "batch.filed", payload: { lines: [] } }, { event: "awx_batch.read_back", subject: "btr_1", payload: { agrees: false } }],
      transfers: [{ invoice_no: "INV-2", request_id: "q2" }, { invoice_no: "INV-3", request_id: "q3", approval_sha256: SHA_A }],
      awx_batches: [{ awx_batch_id: "btr_1", batch_id: "P-0010" }],
    });
    f.set("docs/runs/2026-11-13-airwallex-switch-on.json", { calls: { first: "2026-11-13T08:00:00Z", last: "2026-11-13T09:00:00Z", total: 0 }, audit: [], transfers: [] });
    f.set("docs/runs/2026-11-13-airwallex-deposits.json", { calls: [line("GET", "/global_accounts")], audit: [] });
    f.set("docs/runs/2026-11-17-airwallex-late-failure.json", {
      calls: [line("POST", "/transfers/create"), line("POST", "/simulation/transfers/{id}/transition")],
      transfers: [{ transfer_id: "tr_5", invoice_no: "INV-5", currency: "EUR", amount: "5.00", approval_sha256: SHA_B }],
      audit: [], proposals: [],
    });
    f.set("docs/runs/2026-11-19-airwallex-bills.json", { calls: [line("POST", "/spend/bills/create"), line("POST", "/files/upload")], bills: [{ bill_id: "bill_1", invoice_no: "INV-6", created: { amount: "6.00", status: "AWAITING_PAYMENT" }, paid: null }] });
    f.set("docs/runs/2026-11-20-airwallex-replay.json", { calls: [line("POST", "/transfers/create", { status: 200 }), line("POST", "/transfers/create", { status: 409 })] });
  });

  it("each row shows only what its record holds", () => {
    const runs = trailRuns();
    const by = (key: string) => runs.find((r) => r.key === key)!;
    expect(by("readback-1101").calls.map((c) => [c.path, c.outcome])).toEqual([["/api/v1/", "DONE"], ["/api/v1/deposits", "SETTLED"]]);
    expect(by("transfer-1106").checks).toEqual([]);
    expect(by("vic-1112").iso).toBe("2026-11-12T09:00:00Z");
    expect(by("ft-1112").calls[0]!.outcome).toBe("3 rows read");
    expect(by("batch-1112").calls[0]!.outcome).toBeNull();
    expect(by("switch-on-1113").calls).toEqual([]);
    expect(by("deposits-1113").calls[0]!.outcome).toBeNull();
    expect(by("bills-1119").calls.find((c) => c.path.endsWith("/files/upload"))).toMatchObject({ outcome: "INV-6 PDF", objectId: null });
    expect(by("replay-1120").calls.map((c) => c.outcome).sort()).toEqual(["409", null].sort());
    // The awx-1 cards create has no card to tag it with.
    expect(by("awx-1").calls.find((c) => c.path.endsWith("/issuing/cards/create"))!.outcome).toBeNull();
  });

  it("a hash check with no signed hash recorded fails, and says whose it is not", () => {
    const runs = trailRuns();
    const checks = runs.flatMap((r) => r.checks);
    expect(checks.find((c) => c.label.startsWith("awx-1"))).toMatchObject({ carried: SHA_A, signed: null, recomputed: null, match: false });
    expect(checks.find((c) => c.label.startsWith("batch 1"))).toMatchObject({ label: "batch 1: INV-3 (request q3), no line", signed: null, match: false });
    expect(checks.find((c) => c.label.startsWith("late failure"))).toMatchObject({ label: "late failure: transfer tr_5 (?, INV-5)", signed: null, match: false });
    expect(apiTrail().checks.transfers).toEqual({ total: 3, match: 0 });
  });
});

describe("the soak records themselves", () => {
  it("a record that created nothing, or cannot be read, is left out; no runs folder is no soak; totals add up per endpoint", async () => {
    const { soaks, soakTotals } = await import("../src/airwallex/soakRecords.js");
    const summary = (created: number, by?: Record<string, number>) => ({ planned: 1, created, paid: created, readback_matches: created, conversions: { planned: 0, booked: 0, readback_matches: 0 }, latency_ms: { p50: 1 }, calls: { total: 2 },
      negatives: { planned: 1, refused: 1, posts_in_window: 0, creates_in_window: 0, calls_in_window: 1, ...(by ? { by_endpoint_in_window: by } : {}) } });
    fsState.runs = ["2026-11-18-airwallex-soak.json", "2026-11-19-airwallex-soak.json", "2026-11-20-airwallex-soak.json", "2026-11-21-airwallex-soak.json"];
    fsState.files!.set("docs/runs/2026-11-18-airwallex-soak.json", { summary: summary(0) });
    fsState.files!.set("docs/runs/2026-11-19-airwallex-soak.json", { summary: summary(2, { "GET /transfers": 1 }) });
    fsState.files!.set("docs/runs/2026-11-20-airwallex-soak.json", { summary: summary(1) });
    const all = soaks();
    expect(all.map((s) => s.day)).toEqual(["2026-11-19", "2026-11-20"]);
    expect(soakTotals(all)).toMatchObject({ soaks: 2, created: 3, negatives: { reads: { "GET /transfers": 1 } }, files: ["docs/runs/2026-11-19-airwallex-soak.json", "docs/runs/2026-11-19-airwallex-soak.md", "docs/runs/2026-11-20-airwallex-soak.json", "docs/runs/2026-11-20-airwallex-soak.md"] });
    fsState.runs = Object.assign(new Error("ENOENT: docs/runs"), { code: "ENOENT" });
    expect(soaks()).toEqual([]);
  });
});

describe("the soaks", () => {
  it("a soak whose payment has no signed hash fails its check; one that disappears between listing and reading is left out", () => {
    const f = fsState.files!;
    const soak = (created: number) => ({
      started_at: "2026-11-19T10:00:00Z", ended_at: "2026-11-19T11:00:00Z", budget: { approved: 50, used: 3 },
      summary: { planned: 1, created, paid: created, readback_matches: 0, conversions: { planned: 0, booked: 0, readback_matches: 0 }, latency_ms: { p50: 1 }, calls: { total: 3 }, negatives: { planned: 0, refused: 0, posts_in_window: 0, creates_in_window: 0, calls_in_window: 0 } },
      calls: [line("POST", "/transfers/create")],
      payments: [{ invoice_no: "INV-7", transfer_id: "tr_7", proposal_id: "P-0007", currency: "EUR", amount: "7.00", status_after_execute: "PAID", readback: { approval_sha256: SHA_A } }],
    });
    fsState.runs = ["2026-11-19-airwallex-soak.json", "2026-11-20-airwallex-soak.json", "notes.md"];
    f.set("docs/runs/2026-11-19-airwallex-soak.json", soak(1));
    f.set("docs/runs/2026-11-20-airwallex-soak.json", soak(1));
    // The second soak is listed and read once (by the soak list), then gone when the trail reads it.
    fsState.vanishAfter.set("docs/runs/2026-11-20-airwallex-soak.json", 1);
    const runs = trailRuns();
    expect(runs.map((r) => r.key)).toEqual(["soak-1119"]);
    expect(runs[0]!.checks).toEqual([expect.objectContaining({ carried: SHA_A, signed: null, match: false })]);
  });
});
