// /try's sandbox payout desk (worker/src/awxPayout.ts), the paths test/try-awx-payout.test.ts leaves: a create that
// fails with something other than Airwallex's fixed reasons is ambiguous (the payout may have been made, so the terms
// stay spent), an ask that breaks the desk does not stop the next one, a stored payout without a status, the move to
// PAID from SENT or already PAID, and the client's answers that are not JSON objects or come without the network.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { sqlOver } from "../src/relay/local.js";
import { AwxPayoutDesk, PayoutFailed, SandboxPayouts, type PayoutRail, type SandboxTransfer } from "../worker/src/awxPayout.js";

const SHA = "d".repeat(64);
const ID = "4074d684-4704-406c-a527-2832753baf4f";
const ask = (o: Record<string, unknown> = {}) => ({ company: "t_try_a", terms_sha256: SHA, amount: "120.00", currency: "EUR", reference: "INV-1", ...o });
const now = () => Date.parse("2026-11-14T12:00:00Z");

function rail(o: Partial<PayoutRail> = {}): PayoutRail & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    availableCents: async () => { calls.push("balance"); return 1_000_000; },
    createTransfer: async () => { calls.push("create"); return { id: ID, status: "IN_APPROVAL" }; },
    transfer: async (id) => { calls.push("read"); return { id, status: "SCHEDULED" }; },
    simulate: async (id, to) => { calls.push(`simulate ${to}`); return { id, status: to }; },
    ...o,
  };
}

describe("the payout desk", () => {
  it("a create that throws something other than a payout failure is ambiguous, and the terms are never paid again", async () => {
    const r = rail({ createTransfer: async () => { throw new TypeError("connection reset"); } });
    const db = new Database(":memory:");
    const d = new AwxPayoutDesk(sqlOver(db), { rail: r, off: false, now });
    expect(await d.payout(ask())).toEqual({ ok: false, reason: "ambiguous" });
    // The row is there (no status, no transfer): the same terms try the create again with the same request id, nothing else.
    expect(db.prepare("SELECT status, transfer_id FROM awx_payouts_v2").all()).toEqual([{ status: null, transfer_id: null }]);
    r.createTransfer = async () => ({ id: ID, status: "IN_APPROVAL" });
    expect(await d.payout(ask())).toMatchObject({ ok: true, transfer_id: ID, again: false });
    expect(r.calls.filter((c) => c === "balance")).toHaveLength(1);
  });

  it("an ask that breaks the desk is its own failure; the next ask is still answered", async () => {
    const d = new AwxPayoutDesk(sqlOver(new Database(":memory:")), { rail: rail(), off: false, now });
    const hostile = { company: "t_try_a", terms_sha256: SHA, amount: "120.00", currency: "EUR", get reference(): string { throw new Error("boom"); } };
    await expect(d.payout(hostile)).rejects.toThrow("boom");
    expect(await d.payout(ask())).toMatchObject({ ok: true, transfer_id: ID });
  });

  it("a stored payout with no status read back answers UNKNOWN when the sandbox does not answer", async () => {
    const db = new Database(":memory:");
    const d = new AwxPayoutDesk(sqlOver(db), { rail: rail({ transfer: async () => { throw new PayoutFailed("unavailable", "down"); } }), off: false, now });
    db.prepare("INSERT INTO awx_payouts_v2 (terms_sha256, company, request_id, transfer_id, status, amount, currency, day) VALUES (?, 't_try_a', 'rq', ?, NULL, '120.00', 'EUR', '2026-11-14')").run(SHA, ID);
    expect(await d.payout(ask())).toEqual({ ok: true, transfer_id: ID, status: "UNKNOWN", amount: "120.00", currency: "EUR", request_id: "rq", again: true });
  });

  it("moving to PAID: from SENT only PAID is asked; a transfer already PAID is not moved; a refusal and an outage say which", async () => {
    const at = (status: string, o: Partial<PayoutRail> = {}) => {
      const r = rail({ transfer: async (id) => ({ id, status }), ...o });
      const db = new Database(":memory:");
      const d = new AwxPayoutDesk(sqlOver(db), { rail: r, off: false, now });
      db.prepare("INSERT INTO awx_payouts_v2 (terms_sha256, company, request_id, transfer_id, status, amount, currency, day) VALUES (?, 't_try_a', 'rq', ?, 'SCHEDULED', '120.00', 'EUR', '2026-11-14')").run(SHA, ID);
      return { r, d, db };
    };
    const sent = at("SENT");
    expect(await sent.d.simulatePaid({ company: "t_try_a", terms_sha256: SHA })).toEqual({ ok: true, transfer_id: ID, status: "PAID" });
    expect(sent.r.calls).toEqual(["simulate PAID"]);
    expect(sent.db.prepare("SELECT status FROM awx_payouts_v2").get()).toEqual({ status: "PAID" });
    const paid = at("PAID");
    expect(await paid.d.simulatePaid({ company: "t_try_a", terms_sha256: SHA })).toEqual({ ok: true, transfer_id: ID, status: "PAID" });
    expect(paid.r.calls).toEqual([]);
    const refused = at("SCHEDULED", { simulate: async () => { throw new PayoutFailed("refused", "no"); } });
    expect(await refused.d.simulatePaid({ company: "t_try_a", terms_sha256: SHA })).toEqual({ ok: false, reason: "refused" });
    const down = at("SCHEDULED", { simulate: async () => { throw new Error("socket"); } });
    expect(await down.d.simulatePaid({ company: "t_try_a", terms_sha256: SHA })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("a move asked without a company or with a hash that is not one is a bad request", async () => {
    const d = new AwxPayoutDesk(sqlOver(new Database(":memory:")), { rail: rail(), off: false, now });
    for (const a of [null, { company: "t/a", terms_sha256: SHA }, { company: "t_try_a", terms_sha256: "XYZ" }, { company: 7, terms_sha256: SHA }]) {
      expect(await d.simulatePaid(a as never)).toEqual({ ok: false, reason: "bad_request" });
    }
  });
});

describe("the sandbox payout client", () => {
  const TOKEN = "test-token-eeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const client = (answer: (path: string) => Response) => new SandboxPayouts({ clientId: "id", apiKey: "k", now, fetchImpl: (async (u: string | URL) => {
    const path = new URL(String(u)).pathname;
    return path.endsWith("/login") ? new Response(JSON.stringify({ token: TOKEN }), { status: 200 }) : answer(path);
  }) as typeof fetch });

  it("a transfer answer that is not a JSON object is no status, and a balance that is not a list is no balance", async () => {
    await expect(client(() => new Response("[1]", { status: 200 })).transfer(ID)).rejects.toMatchObject({ code: "unavailable", message: "the Airwallex sandbox gave no status (HTTP 200)" });
    await expect(client(() => new Response("\"PAID\"", { status: 200 })).transfer(ID)).rejects.toMatchObject({ code: "unavailable" });
    await expect(client(() => new Response("{}", { status: 200 })).availableCents("EUR")).rejects.toMatchObject({ message: "the Airwallex sandbox gave no balance (HTTP 200)" });
    await expect(client(() => new Response(JSON.stringify({ id: ID, status: "PAID" }), { status: 200 })).simulate(ID, "PAID")).resolves.toEqual({ id: ID, status: "PAID" } satisfies SandboxTransfer);
    await expect(client(() => new Response("[]", { status: 200 })).simulate(ID, "PAID")).rejects.toMatchObject({ code: "refused" });
  });

  it("with the platform's own fetch and no network, the login does not answer", async () => {
    await expect(new SandboxPayouts({ clientId: "id", apiKey: "k" }).availableCents("EUR")).rejects.toMatchObject({ code: "unavailable", message: "the Airwallex sandbox did not answer" });
  });
});
