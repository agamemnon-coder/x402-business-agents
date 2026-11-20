// The replay check (src/proof/awxReplay.ts) when Airwallex does not cooperate, against an in-memory sandbox: no payee,
// a first create refused (nothing repeated), a lookup or a simulation that fails, a quote refused, a batch that is not
// deleted, a client fault that is not Airwallex's; and the run log written from such a record. No network, no keys.
import { describe, expect, it } from "vitest";
import { endpointOf } from "../src/airwallex/callBudget.js";
import { MANUFACTURER } from "../src/config/payees.js";
import { notingFetch, type HttpLine } from "../src/proof/awxCoverageLive.js";
import { replayMarkdown, runReplay, type ReplayRecord } from "../src/proof/awxReplay.js";

const j = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
type Over = Partial<Record<string, (n: number) => Response | Promise<Response>>>;

/** A small sandbox: a repeated create is refused as a duplicate; `over` answers a call ("METHOD /endpoint") its own way (n: its count). */
function sandbox(over: Over = {}): typeof fetch {
  const seen = new Map<string, Record<string, unknown>>();
  const counts = new Map<string, number>();
  let n = 0;
  const id = () => `0000000${++n}-0000-4000-8000-000000000000`.slice(-36);
  const create = (b: Record<string, unknown>, make: () => Record<string, unknown>) => {
    const rid = String(b.request_id);
    if (seen.has(rid)) return j(400, { code: "duplicate_request_id" });
    const x = { request_id: rid, ...make() };
    seen.set(rid, x);
    return j(201, x);
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const key = `${(init?.method ?? "GET").toUpperCase()} ${endpointOf(url.href)}`;
    const c = (counts.get(key) ?? 0) + 1;
    counts.set(key, c);
    if (over[key]) return over[key]!(c);
    const b = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const listed = (pick: (x: Record<string, unknown>) => boolean) => j(200, { has_more: false, items: [...seen.values()].filter((x) => x.request_id === url.searchParams.get("request_id") && pick(x)) });
    switch (key) {
      case "POST /authentication/login": return j(201, { token: "t", expires_at: "2099-01-01T00:00:00Z" });
      case "GET /beneficiaries": return j(200, { has_more: false, items: [{ id: "ben-1", beneficiary: { company_name: MANUFACTURER.name, bank_details: { iban: MANUFACTURER.iban, swift_code: MANUFACTURER.bic, account_currency: "EUR" } } }] });
      case "POST /transfers/create": return create(b, () => ({ id: id(), transfer_amount: Number(b.transfer_amount), transfer_currency: "EUR", status: "PROCESSING", beneficiary_id: String(b.beneficiary_id) }));
      case "GET /transfers": return listed((x) => "transfer_amount" in x);
      case "POST /simulation/transfers/{id}/transition": return j(200, { id: url.pathname.split("/").at(-2), status: String(b.next_status) });
      case "GET /transfers/{id}": return j(200, { ...[...seen.values()].find((x) => url.pathname.endsWith(String(x.id))), status: "PAID" });
      case "POST /fx/quotes/create": return j(201, { quote_id: "q-1", buy_amount: 1, sell_amount: 1.17, client_rate: 1.17, valid_from_at: "2026-11-20T00:00:00Z", valid_to_at: "2026-11-20T00:15:00Z" });
      case "POST /fx/conversions/create": return create(b, () => ({ conversion_id: id(), status: "SCHEDULED", buy_amount: Number(b.buy_amount), sell_amount: 1.17 }));
      case "GET /fx/conversions": return listed((x) => "conversion_id" in x);
      case "POST /batch_transfers/create": return create(b, () => ({ id: id(), status: "DRAFTING" }));
      case "GET /batch_transfers": return listed((x) => x.status === "DRAFTING");
      case "POST /batch_transfers/{id}/delete": return j(200, {});
      default: return j(404, { code: "not_in_fake", message: key });
    }
  }) as typeof fetch;
}

async function run(over: Over = {}) {
  const lines: HttpLine[] = [];
  const log: string[] = [];
  const body = await runReplay({ cfg: { clientId: "fake", apiKey: "fake", fetchImpl: notingFetch(sandbox(over), lines), minGapMs: 0, sleep: async () => undefined }, lines, runId: "20261120000000", log: (l) => log.push(l) });
  const rec: ReplayRecord = { ...body, run: "x", ran_at: "2026-11-20T00:00:00Z", finished_at: "2026-11-20T00:01:00Z", made_by: "test", budget: { approved: null, used: lines.length }, calls: lines };
  return { body, lines, log, rec };
}
const fail = (status: number, code: string, headers: Record<string, string> = {}) => () => j(status, { code, message: "refused in the test" }, headers);

describe("the replay check when Airwallex does not cooperate", () => {
  it("without a beneficiary for the payee, no transfer is sent; the conversion and the batch still run", async () => {
    const { body, log, lines } = await run({ "GET /beneficiaries": () => j(200, { has_more: false, items: [] }) });
    expect(log[0]).toBe(`payee: ${MANUFACTURER.name}: Airwallex holds no beneficiary; no transfer is sent`);
    expect(body.payee.beneficiary_id).toBeNull();
    expect(body.cases.map((c) => c.kind)).toEqual(["conversion", "batch"]);
    expect(lines.some((l) => l.endpoint === "/transfers/create")).toBe(false);
  });

  it("a first create refused is not repeated: nothing listed, nothing safe, nothing taken to PAID", async () => {
    const { body } = await run({ "POST /transfers/create": fail(400, "invalid_argument", { "x-b3-traceid": "trace-1" }), "POST /batch_transfers/create": fail(403, "forbidden") });
    const t = body.cases.find((c) => c.kind === "transfer")!;
    expect(t.first).toMatchObject({ http: 400, code: "invalid_argument", id: null, trace_id: "trace-1" });
    expect(t.same_again).toEqual({ http: null, code: null, id: null, amount: null, trace_id: null, purser_reads_as_refusal: null });
    expect(t).toMatchObject({ after: null, one_object: false, repeats_safe: false });
    const batch = body.cases.find((c) => c.kind === "batch")!;
    expect(batch).toMatchObject({ after: null, one_object: false, repeats_safe: false, same_again: { http: null } });
    expect(body.summary.repeats_sent).toBe(2); // the conversion's two repeats only
  });

  it("a lookup that fails is kept as its error; a simulation that fails is a run error, not a case", async () => {
    const { body, rec } = await run({ "GET /transfers": fail(500, "internal_error"), "GET /fx/conversions": fail(500, "internal_error"), "GET /batch_transfers": fail(500, "internal_error"), "POST /simulation/transfers/{id}/transition": fail(400, "invalid_status") });
    for (const c of body.cases) expect(c.lookup.error, c.label).toBeTruthy();
    expect(body.cases.filter((c) => c.kind === "transfer").map((c) => c.after)).toEqual([null, null, null]);
    expect(body.errors.filter((e) => e.startsWith("transfer "))).toHaveLength(3);
    const md = replayMarkdown(rec, "2026-11-20");
    expect(md).toMatch(/\| error: .+ \| – \|/);
    expect(md).toContain("| Airwallex calls (approved budget) | ");
    expect(md).toMatch(/\| Errors \| transfer 1: /);
  });

  it("a quote refused stops the conversion case (an error), and a batch that is not deleted says so", async () => {
    const { body, rec } = await run({ "POST /fx/quotes/create": fail(400, "quote_failed"), "POST /batch_transfers/{id}/delete": fail(400, "cannot_delete") });
    expect(body.cases.some((c) => c.kind === "conversion")).toBe(false);
    expect(body.errors.some((e) => e.startsWith("conversion: "))).toBe(true);
    expect(body.cases.find((c) => c.kind === "batch")!.after).toBe("not deleted");
    expect(body.errors.some((e) => e.startsWith("batch delete: "))).toBe(true);
    expect(replayMarkdown(rec, "2026-11-20")).toContain("| batch transfer: an empty batch |");
  });

  it("a fault that is not Airwallex's answer stops that case as an error, never as a send", async () => {
    const { body } = await run({ "POST /fx/conversions/create": () => { throw new TypeError("socket hang up"); }, "POST /batch_transfers/create": () => { throw new TypeError("socket hang up"); } });
    expect(body.errors.some((e) => e.startsWith("conversion: "))).toBe(true);
    expect(body.errors.some((e) => e.startsWith("batch: "))).toBe(true);
    expect(body.cases.map((c) => c.kind)).toEqual(["transfer", "transfer", "transfer"]);
  });

  it("the run log names a refusal without a code, an answer without an id, and the note added after the run", () => {
    const send = (o: Partial<ReplayRecord["cases"][number]["first"]>) => ({ http: 200, code: null, id: null, amount: null, trace_id: null, purser_reads_as_refusal: false, ...o });
    const rec: ReplayRecord = {
      run: "x", ran_at: "2026-11-20T00:00:00Z", finished_at: "2026-11-20T00:01:00Z", sandbox: true, test_money: true, made_by: "test",
      payee: { name: "P", beneficiary_id: null }, budget: { approved: 60, used: 1 },
      cases: [{ kind: "transfer", label: "a | b", request_id: "rq", first: send({}), same_again: send({ http: 409, code: null }), changed_amount: null, lookup: { listed: 0, id: null, amount: null, error: null }, after: null, one_object: false, repeats_safe: true }],
      summary: { cases: 1, one_object: 0, repeats_safe: 1, repeats_sent: 1, repeats_refused: 1, repeats_returned_first: 0, duplicate_codes_seen: [], codes_purser_reads_as_refusal: [] },
      calls: [{ at: "2026-11-20T00:00:01.000Z", method: "POST", endpoint: "/transfers/create", status: 409 }], errors: [], after_the_run: "Fixed on 20 Nov.",
    };
    const md = replayMarkdown(rec, "2026-11-20");
    expect(md).toContain("| a \\| b | `rq` | 200, no id | 409 `(no code)` | – | 0 | – |");
    expect(md).toContain("| Airwallex's answers to a repeat | none refused |");
    expect(md).toContain("**After the run.** Fixed on 20 Nov.");
    expect(md).toContain("| 1 | 00:00:01.000 | `POST /transfers/create` | 409 |  |");
  });
});
