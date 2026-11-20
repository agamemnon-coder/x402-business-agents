// The engine for tests and local runs (cloud/src/engine/node.ts nodeEngines): one engine host per company in this
// process, on the cloud's own database. Here with /try's live FX quote and sandbox payout as stand-in sources, as a
// local check hands them in: a start that fails is not kept, a document filed twice is a duplicate, the quote's note
// comes beside the terms, a signed payment is asked of the sandbox once with its hash, the sandbox's simulation moves
// it to PAID, and a wiped company starts again from nothing. Without the sources, nothing is asked and the answer says so.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureSchema } from "../cloud/src/app.js";
import type { LiveFxAnswer } from "../cloud/src/engine/liveFx.js";
import type { PayoutAnswerIn, SimulateIn } from "../cloud/src/engine/livePayout.js";
import { nodeEngines } from "../cloud/src/engine/node.js";
import { dirBlobs, sqliteSql } from "../cloud/src/node.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const RP = "cloud.test", ORIGIN = `https://${RP}`;
// The sample invoice is due 16 Nov 2026 and the engine reads the real date: the date is held at a day before it.
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function cloud() {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "node-walk-"));
  dirs.push(dir);
  const sql = sqliteSql(":memory:");
  await ensureSchema(sql);
  const company = (id: string) => sql.run("INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, ?, ?, 'en', '2026-11-01')", [id, id.replace(/_/g, "-"), `${id} BV`]);
  return { sql, blobs: dirBlobs(join(dir, "blobs")), company };
}

function sources() {
  const asked: string[] = [];
  const liveFx = {
    allowed: async () => true,
    source: { quote: async (): Promise<LiveFxAnswer> => { asked.push("quote"); return { ok: false, reason: "day_cap" }; } },
  };
  const livePayout = {
    allowed: async () => true,
    source: {
      payout: async (a: { amount: string; currency: string; terms_sha256: string }): Promise<PayoutAnswerIn> => { asked.push(`payout ${a.terms_sha256}`); return { ok: true, transfer_id: "4074d684-4704-406c-a527-2832753baf4f", status: "IN_APPROVAL", amount: a.amount, currency: a.currency, request_id: "r-1" }; },
      payoutSimulate: async (): Promise<SimulateIn> => { asked.push("simulate"); return { ok: true, transfer_id: "4074d684-4704-406c-a527-2832753baf4f", status: "PAID" }; },
    },
  };
  return { asked, liveFx, livePayout };
}

describe("the engine in this process", () => {
  it("a company the cloud does not have is refused, and the failed start is not kept: once it exists, it starts", async () => {
    const c = await cloud();
    const engines = nodeEngines({ sql: c.sql, blobs: c.blobs, rpId: RP, origin: ORIGIN });
    await expect(engines("t_later0001").status()).rejects.toThrow("no such company");
    await c.company("t_later0001");
    expect(await engines("t_later0001").status()).toMatchObject({ mode: "test_money" });
    c.sql.close();
  });

  it("with the live sources: a duplicate document, the quote's note beside the terms, the signed payment asked of the sandbox once, moved to PAID", async () => {
    const c = await cloud();
    await c.company("t_walknode1");
    const s = sources();
    const api = nodeEngines({ sql: c.sql, blobs: c.blobs, rpId: RP, origin: ORIGIN, now: () => new Date("2026-11-10T09:00:00Z"), liveFx: s.liveFx, livePayout: s.livePayout })("t_walknode1");
    const bytes = await pdfOf(EN);
    const up = await api.upload({ bytes, filename: "bergtex.pdf" });
    expect(up.kind).toBe("invoice");
    expect((await api.upload({ bytes, filename: "bergtex-again.pdf" })).kind).toBe("duplicate_document");

    const phone = new FakeAuthenticator();
    // A relying party the cloud does not serve is not taken: the cloud's own is.
    const st = await api.passkeyStart({ rpId: "evil.example", origin: "https://evil.example" });
    expect((await api.passkeyFinish({ code: st.code, credential: phone.register({ challenge: st.challenge, origin: ORIGIN, rpId: RP }), label: "Carla", person: "u_carla" })).ok).toBe(true);
    expect(await api.securityKeyStart({ label: "Carla", rp: { rpId: "evil.example", origin: "https://evil.example" } })).toHaveProperty("ok");

    const p = await api.propose(up.invoice!.id);
    if (!p.ok) throw new Error(p.reason);
    const t = (await api.terms(p.proposal.id))!;
    // The payment buys currency: the stand-in source said day_cap, so the recorded rate was used and the note says why.
    expect(t.fx_quote).toMatchObject({ source: "recorded", reason: "day_cap" });
    expect(s.asked).toContain("quote");
    expect(await api.terms("P-9999")).toBeNull();

    const credential = phone.sign({ challenge: p.proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
    expect(await api.approve({ proposal_id: p.proposal.id, terms_sha256: p.proposal.terms_sha256, credential, hold: true })).toMatchObject({ status: "approved", held: true });
    // Before it is paid there is no transfer at the sandbox to move.
    expect(await api.payoutSimulate(p.proposal.id)).toMatchObject({ ok: false, reason: "no_transfer", note: null });
    const paid = await api.paySigned(p.proposal.id, t.terms as unknown as Record<string, unknown>, credential);
    expect(paid).toMatchObject({ outcome: "paid", airwallex_payout: { source: "airwallex-sandbox", transfer_id: "4074d684-4704-406c-a527-2832753baf4f", terms_sha256: p.proposal.terms_sha256 } });
    // Sent again: paid once, the same note, the sandbox not asked again.
    expect(await api.paySigned(p.proposal.id, t.terms as unknown as Record<string, unknown>, credential)).toMatchObject({ outcome: "paid_once", airwallex_payout: { transfer_id: "4074d684-4704-406c-a527-2832753baf4f" } });
    expect(s.asked.filter((a) => a.startsWith("payout"))).toEqual([`payout ${p.proposal.terms_sha256}`]);
    expect(await api.paySigned("P-9999", {}, credential)).toBeNull();
    expect(await api.payoutSimulate(p.proposal.id)).toMatchObject({ ok: true, note: { status: "PAID" } });
    expect(await api.forgetPasskey("u_carla")).toEqual({ revoked: 1 });

    // Wiped: the next call starts the company afresh (its ledger forgotten).
    await api.wipe();
    expect(await api.invoices()).toEqual([]);
    await api.wipe();
    await api.wipe();
    c.sql.close();
  });

  it("without the live sources: the payment stands on the simulated bank and nothing is asked; no payout to simulate", async () => {
    const c = await cloud();
    await c.company("t_walknode2");
    const api = nodeEngines({ sql: c.sql, blobs: c.blobs, rpId: RP, origin: ORIGIN })("t_walknode2");
    const up = await api.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf" });
    const phone = new FakeAuthenticator();
    const st = await api.passkeyStart();
    await api.passkeyFinish({ code: st.code, credential: phone.register({ challenge: st.challenge, origin: ORIGIN, rpId: RP }), label: "Carla", person: "u_carla" });
    const p = await api.propose(up.invoice!.id);
    if (!p.ok) throw new Error(p.reason);
    const t = (await api.terms(p.proposal.id))!;
    expect(t).not.toHaveProperty("fx_quote");
    const credential = phone.sign({ challenge: p.proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
    await api.approve({ proposal_id: p.proposal.id, terms_sha256: p.proposal.terms_sha256, credential, hold: true });
    const paid = await api.paySigned(p.proposal.id, t.terms as unknown as Record<string, unknown>, credential);
    expect(paid).toMatchObject({ outcome: "paid" });
    expect(paid).not.toHaveProperty("airwallex_payout");
    expect(await api.payoutSimulate(p.proposal.id)).toEqual({ ok: false, reason: "no_binding", note: null });
    // Airwallex's actions on the simulated bank: a supplier for an invoice that waits for none, a batch of nothing ready, money in.
    expect(await api.addSupplier(up.invoice!.id, { by: "Carla", how: "called them on the number we have on file", address: { street: "Main St 1", city: "Utrecht", postcode: "3511 AA" } })).toMatchObject({ ok: false });
    expect(await api.proposeBatch(["AP-0042"])).toMatchObject({ ok: false });
    expect(await api.depositIn({ amountCents: 1_000, reference: "PURSER-IN-NODE", payer: "Test customer (simulation)" })).toMatchObject({ ok: true, amount: "10.00", currency: "USD" });
    c.sql.close();
  });

  it("a /try company's own payment within its limit: asked of the sandbox with the live source, labelled no_binding without one", async () => {
    const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
    const { SEEDED_SUPPLIERS } = await import("../src/engine/tryWorld.js");
    for (const live of [true, false]) {
      const c = await cloud();
      await c.company("t_try_nodewalk1");
      const s = sources();
      const api = nodeEngines({ sql: c.sql, blobs: c.blobs, rpId: RP, origin: ORIGIN, ...(live ? { livePayout: s.livePayout } : {}) })("t_try_nodewalk1");
      const up = await api.compose({ supplier_key: "bergtex", invoice_no: "INV-4321", amount: "321.00", issue_date: day(0), due_date: day(14), iban: SEEDED_SUPPLIERS[0]!.iban });
      if ("refused" in up) throw new Error(up.refused.message);
      const p = await api.propose(up.invoice!.id);
      if (!p.ok) throw new Error(p.reason);
      expect(p.airwallex_payout, `live ${live}`).toEqual(live
        ? expect.objectContaining({ source: "airwallex-sandbox", amount: "321.00" })
        : expect.objectContaining({ source: "simulated", reason: "no_binding" }));
      c.sql.close();
    }
  });

  it("a wipe while the company's start is failing waits for it and forgets it", async () => {
    const c = await cloud();
    const api = nodeEngines({ sql: c.sql, blobs: c.blobs, rpId: RP, origin: ORIGIN })("t_neverthere");
    const starting = api.status();
    await api.wipe();
    await expect(starting).rejects.toThrow("no such company");
    c.sql.close();
  });
});
