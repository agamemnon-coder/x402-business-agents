// Airwallex, deeper (src/proof/awxDeepLive.ts): the paths a live run can take besides the clean one, on the in-memory
// stand-in with endpoints refused or failing: a second pass that only revokes the transfer the first pass scheduled,
// terms Airwallex does not accept, no EUR Global Account, no payment link, no card with Purser's limits, no statement and
// no clean-up; each is a row (never a throw), and the record's Markdown says what did not happen. Also how the noting
// fetch keeps Airwallex's error code and ids. No network.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { CAPABILITIES, deepMarkdownRecord, deepNotingFetch, deepRecord, deepStandInFetch, runDeepCheck, type Capability, type DeepLine } from "../src/proof/awxDeepLive.js";

const SOAK = { payments: [{ invoice_no: "BTX-SOAK-01", amount: "1.00", currency: "EUR", transfer_id: "a63888f6-3388-498e-993f-d2efbb64b578", status_after_execute: "PAID", conversion: null }] };

type Wrap = (url: URL, method: string) => Response | null | "throw";

async function run(o: { refuse?: NonNullable<Parameters<typeof deepStandInFetch>[0]>["refuse"]; wrap?: Wrap; only?: Capability[]; revokeExisting?: string; inner?: typeof fetch; log?: string[] } = {}) {
  const lines: DeepLine[] = [];
  const known = new Set<string>();
  const inner = o.inner ?? deepStandInFetch({ refuse: o.refuse });
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const w = o.wrap?.(url, (init?.method ?? "GET").toUpperCase());
    if (w === "throw") throw new TypeError("fetch failed: socket hang up");
    return w ?? inner(input, init);
  }) as typeof fetch;
  const out = await runDeepCheck({
    cfg: { clientId: "stand-in", apiKey: "stand-in", fetchImpl: deepNotingFetch(wrapped, lines, known), minGapMs: 0, sleep: async () => {} }, lines, known, runId: "20261119120000",
    db: openDb(":memory:"), soak: SOAK, sleep: async () => {}, now: () => new Date("2026-11-19T12:00:00Z"),
    ...(o.only ? { only: new Set(o.only) } : {}), ...(o.revokeExisting ? { revokeExisting: o.revokeExisting } : {}), ...(o.log ? { log: (l: string) => void o.log!.push(l) } : {}),
  });
  const rec = deepRecord(out.rows, out.facts, lines, { ranAt: "2026-11-19T12:00:00.000Z", budget: null, used: lines.length });
  return { ...out, lines, rec, md: deepMarkdownRecord(rec, "2026-11-19", "custom-name") };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("a second pass that revokes the transfer the first pass scheduled", () => {
  it("revokes only that transfer, runs nothing else, and the record says so", async () => {
    const standIn = deepStandInFetch();
    // The first pass: the cancel is refused, so the transfer stays SCHEDULED.
    let blockCancel = true;
    const wrap: Wrap = (url, method) => (blockCancel && method === "POST" && url.pathname.endsWith("/cancel") ? json(400, { code: "service_unavailable" }) : null);
    const first = await run({ inner: standIn, wrap, only: ["revoke"] });
    const id = first.facts.revoke!.scheduled!.id;
    expect(first.facts.revoke).toMatchObject({ validated: true, scheduled: { status: "SCHEDULED" }, before: null, after: null });
    expect(first.md).toContain("The cancel: Airwallex answered 400 service_unavailable; the transfer was not cancelled.");
    // Only the revoke ran.
    expect(new Set(first.rows.map((r) => r.capability))).toEqual(new Set(["1 validate and revoke"]));
    expect(first.facts).toMatchObject({ receivable: null, card: null, statement: null, cleanup: null });

    blockCancel = false;
    const log: string[] = [];
    const second = await run({ inner: standIn, wrap, only: ["revoke"], revokeExisting: id, log });
    expect(second.facts.revoke).toEqual({ terms: null, validated: false, scheduled: { id, status: "SCHEDULED", transfer_date: null }, before: "SCHEDULED", after: "CANCELLED" });
    expect(second.rows.map((r) => `${r.method} ${r.endpoint}`)).toEqual(["GET /transfers/{id}", "POST /transfers/{id}/cancel"]);
    expect(second.rows.every((r) => r.live && r.id === id)).toBe(true);
    expect(log.some((l) => l.startsWith("LIVE  POST /transfers/{id}/cancel: 200"))).toBe(true);
    const md = second.md;
    expect(md).toContain(`1. **Terms checked before the signature; a signed payment withdrawn before its day.** The transfer an earlier pass scheduled, \`${id}\`: read first SCHEDULED; cancelled; read back **CANCELLED**.`);
    expect(md).toContain("2. **The seller side.** not run");
    expect(md).toContain("3. **An agent card's headroom.** not run");
    expect(md).toContain("4. **The wallet statement.** not run");
    expect(md).toContain("5. **Clean-up.** not run (see the table)");
    expect(md).toContain("is docs/runs/custom-name.json.");
    expect(md).toContain(`Airwallex calls (logins included), 0 answered 429.`);
  });

  it("says the transfer was not cancelled when the second pass cannot read it", async () => {
    const r = await run({ only: ["revoke"], revokeExisting: "7f000000-0000-4000-8000-0000000000ff" });
    expect(r.facts.revoke).toMatchObject({ terms: null, before: null, after: null });
    expect(r.rows[0]).toMatchObject({ live: false, http_status: 404, error_code: "not_found" });
    expect(r.md).toContain("read first (not read); not cancelled (see the table).");
  });
});

describe("refusals along the way: each is a row, and the run goes on", () => {
  it("terms Airwallex does not accept are not scheduled", async () => {
    const { facts, rows, md } = await run({ refuse: { "POST /transfers/validate": { status: 400, code: "invalid_argument" } }, only: ["revoke"] });
    expect(facts.revoke).toMatchObject({ validated: false, scheduled: null });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint: "/transfers/validate", live: false, http_status: 400, error_code: "invalid_argument", outcome: "Airwallex answered 400 invalid_argument" });
    expect(md).toMatch(/Airwallex did not accept the exact terms .*through transfers\/validate\.\n/);
    expect(md).toContain("| `POST /transfers/validate` | new |");
  });

  it("with no payment link and no EUR Global Account: the receivable stays open and unmatched; the clean-up keeps nothing", async () => {
    const { facts, rows, md } = await run({ refuse: { "POST /pa/payment_links/create": { status: 403, code: "feature_not_enabled" }, "GET /global_accounts": { status: 500, code: "internal_error" } }, only: ["receivable", "cleanup"] });
    expect(facts.receivable).toMatchObject({ link: null, global_account_id: null, deposit_id: null, arrival: null, matched: null });
    expect(rows.find((r) => r.endpoint === "/pa/payment_links/create")).toMatchObject({ live: false, error_code: "feature_not_enabled" });
    expect(md).toContain("No payment link. Not found on the Global Account's statement.");
    expect(md).not.toContain("Link switched off");
    expect(facts.cleanup).toMatchObject({ before: "ACTIVE", after: "CLOSED" });
  });

  it("a deposit that never shows on the account's statement is looked for three times, then left unmatched with its link on", async () => {
    let reads = 0;
    const wrap: Wrap = (url) => (url.pathname.endsWith("/transactions") ? (reads++, json(200, { items: [], has_more: false })) : null);
    const { facts, md } = await run({ wrap, only: ["receivable"] });
    expect(reads).toBe(3);
    // Unpaid, the invoice stays open, so its payment link is kept on (retireLink refuses).
    expect(facts.receivable).toMatchObject({ deposit_id: expect.any(String), arrival: null, matched: null, link: { active_after: null } });
    expect(md).toContain("Not found on the Global Account's statement.");
    expect(md).not.toContain("Link switched off");
  });

  it("no ACTIVE card with Purser's limits: no headroom", async () => {
    const wrap: Wrap = (url) => (url.pathname.endsWith("/issuing/cards/c4000000-0000-4000-8000-000000000001") ? json(200, { card_id: "c4000000-0000-4000-8000-000000000001", nick_name: "agent sourcing" }) : null);
    const { facts, rows } = await run({ wrap, only: ["card"] });
    expect(facts.card).toBeNull();
    expect(rows.find((r) => r.endpoint === "/issuing/cards/{id}")?.outcome).toBe("agent sourcing: no EUR per-transaction and monthly limits");
  });

  it("a card list that cannot be had is a row, not a throw", async () => {
    const wrap: Wrap = (url) => (url.pathname.endsWith("/issuing/cards") ? "throw" : null);
    const { facts, rows, md } = await run({ wrap, only: ["card"] });
    expect(facts.card).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint: "/issuing/cards", live: false, http_status: 0 });
    expect(rows[0]!.outcome).toMatch(/no answer from Airwallex|socket hang up/);
    expect(md).toContain("| `GET /issuing/cards` |  | the newest ACTIVE agent card");
  });

  it("a statement that cannot be read and a clean-up refused leave both not run", async () => {
    const { facts, md } = await run({ refuse: { "GET /balances/history": { status: 403, code: "forbidden" }, "POST /global_accounts/{id}/close": { status: 400, code: "invalid_status" } }, only: ["statement", "cleanup"] });
    expect(facts.statement).toBeNull();
    expect(facts.cleanup).toBeNull();
    expect(md).toContain("4. **The wallet statement.** not run");
    expect(md).toContain("5. **Clean-up.** not run (see the table)");
  });

  it("the statement's lines that do not add up or miss the soak's payout are said", async () => {
    const wrap: Wrap = (url) => (url.pathname.endsWith("/balances/history") && url.searchParams.get("from_post_at")?.startsWith("2026-11-19T08:49")
      ? json(200, { items: [
        { id: "s0", currency: "EUR", amount: 1000, balance: 1000, source: "seed", source_type: "DEPOSIT", transaction_type: "DEPOSIT", posted_at: "2026-11-19T08:49:01+0000" },
        { id: "f1", currency: "EUR", amount: -2, balance: 990, source: "x", source_type: "FEE", transaction_type: "FEE", posted_at: "2026-11-19T08:49:40+0000" },
      ], has_more: false })
      : null);
    const { facts, md } = await run({ wrap, only: ["statement"] });
    expect(facts.statement).toMatchObject({ lines: 2, checked: 1, agree: 0, fee_lines: 1 });
    expect(facts.statement!.continuity.breaks).toHaveLength(1);
    expect(md).toContain("Continuity: 0 of 1 links add up (1 break(s), listed in the JSON).");
    expect(md).toContain("**0 of 1 on the statement to the cent**; 1 not: BTX-SOAK-01 payout (not on the statement in this window)");
  });

  it("runs every capability by default", () => {
    expect(CAPABILITIES).toEqual(["revoke", "receivable", "card", "statement", "cleanup"]);
  });
});

describe("the noting fetch", () => {
  it("keeps the status, Airwallex's error code only when it is a plain code, its request and trace ids, and folds known ids", async () => {
    const lines: DeepLine[] = [];
    const answers = [
      new Response(JSON.stringify({ code: "rate_limited" }), { status: 429, headers: { "x-request-id": "rq-1", "x-b3-traceid": "tr-1" } }),
      new Response(JSON.stringify({ code: "not a code!" }), { status: 400 }),
      new Response("<html>bad gateway</html>", { status: 502 }),
      new Response("{}", { status: 200 }),
    ];
    const f = deepNotingFetch((async () => answers.shift()!) as typeof fetch, lines, new Set(["tid-9"]), () => new Date("2026-11-19T12:00:00Z"));
    await f("https://api.sandbox.airwallex.com/api/v1/transfers/tid-9", { method: "post" });
    await f(new URL("https://api.sandbox.airwallex.com/api/v1/balances/current"));
    await f("https://api.sandbox.airwallex.com/api/v1/balances/current");
    await f("https://api.sandbox.airwallex.com/api/v1/balances/current");
    expect(lines[0]).toMatchObject({ at: "2026-11-19T12:00:00.000Z", method: "POST", endpoint: "/transfers/{id}", status: 429, code: "rate_limited", awx_request_id: "rq-1", trace_id: "tr-1" });
    expect(lines[1]).toMatchObject({ method: "GET", status: 400 });
    expect(lines[1]).not.toHaveProperty("code");
    expect(lines[2]).toMatchObject({ status: 502 });
    expect(lines[2]).not.toHaveProperty("code");
    expect(lines[3]).toEqual({ at: "2026-11-19T12:00:00.000Z", method: "GET", endpoint: "/balances/current", status: 200 });
  });

  it("notes a call whose answer never came, with status 0, and lets the error through", async () => {
    const lines: DeepLine[] = [];
    const f = deepNotingFetch((async () => { throw new TypeError("fetch failed"); }) as typeof fetch, lines, new Set());
    await expect(f("https://api.sandbox.airwallex.com/api/v1/issuing/cards")).rejects.toThrow(/fetch failed/);
    expect(lines).toEqual([expect.objectContaining({ method: "GET", endpoint: "/issuing/cards", status: 0 })]);
  });
});
