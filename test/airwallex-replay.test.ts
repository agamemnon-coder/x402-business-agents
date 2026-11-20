// The replay check (src/proof/awxReplay.ts) against an in-memory Airwallex: no network, no keys.
import { describe, expect, it } from "vitest";
import { endpointOf } from "../src/airwallex/callBudget.js";
import { MANUFACTURER } from "../src/config/payees.js";
import { notingFetch, type HttpLine } from "../src/proof/awxCoverageLive.js";
import { replayMarkdown, runReplay, type ReplayRecord } from "../src/proof/awxReplay.js";

const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Airwallex in memory: a create under a request_id it has seen answers `dup` (or the first object, with `echo`). */
function fakeAwx(o: { dup?: { status: number; code: string }; echo?: boolean } = {}): typeof fetch {
  const transfers = new Map<string, { id: string; request_id: string; transfer_amount: number; transfer_currency: string; status: string; beneficiary_id: string }>();
  const conversions = new Map<string, { conversion_id: string; request_id: string; status: string; buy_amount: number; sell_amount: number }>();
  const batches = new Map<string, { id: string; request_id: string; status: string }>();
  let n = 0;
  const id = () => `0000000${++n}-0000-4000-8000-000000000000`.slice(-36);
  const again = <T>(m: Map<string, T>, rid: string) => (o.echo ? j(200, m.get(rid)) : j(o.dup?.status ?? 400, { code: o.dup?.code ?? "duplicate_request_id" }));
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const key = `${(init?.method ?? "GET").toUpperCase()} ${endpointOf(url.href)}`;
    const b = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const q = url.searchParams;
    switch (key) {
      case "POST /authentication/login": return j(201, { token: "t", expires_at: "2099-01-01T00:00:00Z" });
      case "GET /beneficiaries": return j(200, { has_more: false, items: [{ id: "ben-1", beneficiary: { company_name: MANUFACTURER.name, bank_details: { iban: MANUFACTURER.iban, swift_code: MANUFACTURER.bic, account_currency: "EUR" } } }] });
      case "POST /transfers/create": {
        const rid = String(b.request_id);
        if (transfers.has(rid)) return again(transfers, rid);
        const t = { id: id(), request_id: rid, transfer_amount: Number(b.transfer_amount), transfer_currency: "EUR", status: "PROCESSING", beneficiary_id: String(b.beneficiary_id) };
        transfers.set(rid, t);
        return j(201, t);
      }
      case "GET /transfers": return j(200, { items: [...transfers.values()].filter((t) => t.request_id === q.get("request_id")), has_more: false });
      case "POST /simulation/transfers/{id}/transition": {
        const t = [...transfers.values()].find((x) => url.pathname.includes(x.id))!;
        t.status = String(b.next_status);
        return j(200, t);
      }
      case "GET /transfers/{id}": return j(200, [...transfers.values()].find((x) => url.pathname.includes(x.id)));
      case "POST /fx/quotes/create": return j(201, { quote_id: "q-1", buy_amount: 1, sell_amount: 1.17, client_rate: 1.17, valid_from_at: "2026-11-20T00:00:00Z", valid_to_at: "2026-11-20T00:15:00Z" });
      case "POST /fx/conversions/create": {
        const rid = String(b.request_id);
        if (conversions.has(rid)) return again(conversions, rid);
        const c = { conversion_id: id(), request_id: rid, status: "SCHEDULED", buy_amount: Number(b.buy_amount), sell_amount: 1.17 };
        conversions.set(rid, c);
        return j(201, c);
      }
      case "GET /fx/conversions": return j(200, { has_more: false, items: [...conversions.values()].filter((c) => c.request_id === q.get("request_id")) });
      case "POST /batch_transfers/create": {
        const rid = String(b.request_id);
        if (batches.has(rid)) return again(batches, rid);
        const x = { id: id(), request_id: rid, status: "DRAFTING" };
        batches.set(rid, x);
        return j(201, x);
      }
      case "GET /batch_transfers": return j(200, { items: [...batches.values()].filter((x) => x.request_id === q.get("request_id")) });
      case "POST /batch_transfers/{id}/delete": return j(200, {});
      default: return j(404, { code: "not_in_fake", message: key });
    }
  }) as typeof fetch;
}

async function run(o: Parameters<typeof fakeAwx>[0] = {}) {
  const lines: HttpLine[] = [];
  const body = await runReplay({ cfg: { clientId: "fake", apiKey: "fake", fetchImpl: notingFetch(fakeAwx(o), lines), minGapMs: 0 }, lines, runId: "20261120000000", log: () => undefined });
  const rec: ReplayRecord = { ...body, run: "x", ran_at: "2026-11-20T00:00:00Z", finished_at: "2026-11-20T00:01:00Z", made_by: "test", budget: { approved: 60, used: lines.length }, calls: lines };
  return { body, lines, rec };
}

describe("the replay check", () => {
  it("counts a refused repeat as safe, and reads Purser's duplicate codes as not a refusal", async () => {
    const { body } = await run();
    expect(body.errors).toEqual([]);
    expect(body.summary).toMatchObject({ cases: 5, one_object: 5, repeats_safe: 5, repeats_sent: 9, repeats_refused: 9, duplicate_codes_seen: ["400 duplicate_request_id"], codes_purser_reads_as_refusal: [] });
    expect(body.cases.filter((c) => c.kind === "transfer").map((c) => c.after)).toEqual(["PAID", "PAID", "PAID"]);
  });

  it("flags a duplicate code Purser's routed rail does not know: it would read it as a refusal that moved nothing", async () => {
    const { body } = await run({ dup: { status: 400, code: "invalid_argument" } });
    expect(body.summary.codes_purser_reads_as_refusal).toEqual(["400 invalid_argument"]);
    expect(body.summary.repeats_safe).toBe(5);
  });

  it("an answer with the first object is safe for the same terms, and not for one cent more", async () => {
    const { body } = await run({ echo: true });
    const t = body.cases.find((c) => c.kind === "transfer")!;
    expect(t.same_again).toMatchObject({ http: 200, id: t.first.id, amount: "1.00" });
    expect(t.changed_amount).toMatchObject({ http: 200, id: t.first.id, amount: "1.00" });
    expect(t.repeats_safe).toBe(true);
    expect(body.summary.repeats_returned_first).toBe(9);
  });

  it("writes the run log from the record, with no key or token in it", async () => {
    const { rec } = await run();
    const md = replayMarkdown(rec, "2026-11-20");
    expect(md).toContain("| Creates with exactly one object under their request_id afterwards, with the first terms | 5/5 |");
    expect(md).not.toMatch(/fake|"t"/);
  });
});
