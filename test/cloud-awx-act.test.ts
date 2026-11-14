// Purser Cloud's Airwallex actions (14 Nov): the gateway's allow-list on both sides, the Cloud's guard (switch, caps,
// idempotency), the routed rail (which bank each call goes to, the labelled fallback), and the engine's whole chain on
// it: a new supplier checked and added after the CFO's signature, Pay planned at Airwallex, the payout after the
// signature with the signed hash, settled to PAID by the sandbox simulation, a one-cent change refused.
// Nothing reaches the network: "Airwallex" here is the in-memory stand-in behind ids of Airwallex's shape.
import { describe, expect, it } from "vitest";
import { useDocStore, type DocStore } from "../src/ap/docStore.js";
import { AirwallexAmbiguous, AirwallexError } from "../src/airwallex/client.js";
import { AWX_GATEWAY_ALLOW, gatewayApi, gatewayCheck, GatewayRefused, type GatewayAnswer, type GatewayRequest } from "../src/airwallex/gateway.js";
import { FakePayeeNames } from "../src/airwallex/payeeName.js";
import { ActCapReached, RoutedRail, type ActGuard, type Rails3 } from "../src/airwallex/routedRail.js";
import { openDb } from "../src/db/open.js";
import { airwallexActions, ActVerifier, memoryActStore } from "../src/engine/awxActions.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { canonicalTerms, sha256Hex } from "../src/lib/terms.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { AwxGatewayDesk } from "../worker/src/awxGateway.js";
import { cloudGuard } from "../cloud/src/engine/awxGuard.js";
import { sqliteSql } from "../cloud/src/node.js";
import { SAMPLES } from "../cloud/src/engine/samples.gen.js";
import { checkSwitch } from "../cloud/src/try/switches.js";

const SHA = "a".repeat(64);

describe("the gateway's allow-list", () => {
  it("lets only the listed calls through, and money only with its request_id and the signed hash", () => {
    const ok = (r: GatewayRequest) => "rule" in gatewayCheck(r);
    expect(ok({ method: "GET", path: "/balances/current" })).toBe(true);
    expect(ok({ method: "GET", path: "/transfers/7f1c2a9e-0000-4000-8000-000000000001" })).toBe(true);
    expect(ok({ method: "POST", path: "/beneficiaries/create", body: {} })).toBe(true);
    // Not on the list: the login, a payout method change, another account's work, a card, a path trick.
    for (const r of [
      { method: "POST", path: "/authentication/login" }, { method: "POST", path: "/global_accounts/create", body: {} },
      { method: "POST", path: "/issuing/cards/create", body: {} }, { method: "POST", path: "/accounts/create", body: {} },
      { method: "GET", path: "/transfers/../accounts" }, { method: "GET", path: "/transfers?x=1" }, { method: "DELETE", path: "/transfers" },
      { method: "GET", path: "/balances/current", body: {} },
    ] as GatewayRequest[]) expect(ok(r), `${r.method} ${r.path}`).toBe(false);
    // Money: a request_id and metadata.approval_sha256 (the hash the CFO's passkey signed), or nothing is sent.
    expect(ok({ method: "POST", path: "/transfers/create", body: { request_id: "r-1234567890" } })).toBe(false);
    expect(ok({ method: "POST", path: "/transfers/create", body: { metadata: { approval_sha256: SHA } } })).toBe(false);
    expect(ok({ method: "POST", path: "/transfers/create", body: { request_id: "r-1234567890", metadata: { approval_sha256: SHA } } })).toBe(true);
    expect(ok({ method: "POST", path: "/fx/conversions/create", body: { request_id: "r-1234567890", metadata: { approval_sha256: "x" } } })).toBe(false);
    // Every rule is a sandbox API path, anchored; the money calls are exactly three.
    expect(AWX_GATEWAY_ALLOW.filter((r) => r.kind === "money").map((r) => r.name)).toEqual(["FX conversion", "transfer", "batch transfer submit"]);
    for (const r of AWX_GATEWAY_ALLOW) expect(r.path.source.startsWith("^\\/") && r.path.source.endsWith("$"), r.path.source).toBe(true);
  });

  it("the Cloud's side maps the gateway's answers onto the client's errors, and never sends a refused call", async () => {
    const sent: GatewayRequest[] = [];
    let answer: GatewayAnswer = { ok: true, status: 200, json: { id: "x" } };
    const api = gatewayApi({ call: async (r) => { sent.push(r); return answer; } });
    expect(await api.call("GET", "/transfers/abc")).toEqual({ id: "x" });
    await expect(api.call("POST", "/authentication/login")).rejects.toBeInstanceOf(GatewayRefused);
    expect(sent).toHaveLength(1);
    answer = { ok: false, status: 400, code: "invalid_argument", trace_id: "t1" };
    const e = await api.call("POST", "/beneficiaries/create", {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AirwallexError);
    expect((e as AirwallexError).status).toBe(400);
    expect((e as AirwallexError).code).toBe("invalid_argument");
    answer = { ok: false, status: 504, code: null, trace_id: null, ambiguous: true };
    await expect(api.call("POST", "/transfers/create", { request_id: "r-1234567890", metadata: { approval_sha256: SHA } })).rejects.toBeInstanceOf(AirwallexAmbiguous);
    // A binding that throws on a POST: the outcome is unknown, never "refused".
    const lost = gatewayApi({ call: async () => { throw new Error("reset"); } });
    await expect(lost.call("POST", "/beneficiaries/create", {})).rejects.toBeInstanceOf(AirwallexAmbiguous);
  });

  it("kit11's desk: sandbox host only, writes off by default, the key never in an answer", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      urls.push(String(url));
      if (String(url).endsWith("/authentication/login")) return new Response(JSON.stringify({ token: "fake-token-for-tests-only-xxxxx" }), { status: 200 });
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer fake-token-for-tests-only-xxxxx");
      return new Response(JSON.stringify({ id: "b-1" }), { status: 201 });
    }) as typeof fetch;
    const off = new AwxGatewayDesk({ AWX_ACT_CLIENT_ID: "id", AWX_ACT_API_KEY: "key-secret" }, { fetchImpl });
    const refused = await off.call({ method: "POST", path: "/beneficiaries/create", body: {} });
    expect(refused).toMatchObject({ ok: false, code: "gateway_writes_off" });
    expect(urls).toEqual([]);
    expect(await off.call({ method: "POST", path: "/authentication/login" })).toMatchObject({ ok: false, code: "gateway_refused" });
    const on = new AwxGatewayDesk({ AWX_ACT_CLIENT_ID: "id", AWX_ACT_API_KEY: "key-secret", AWX_GATEWAY_WRITE: "on" }, { fetchImpl });
    const made = await on.call({ method: "POST", path: "/beneficiaries/create", body: {} });
    expect(made).toEqual({ ok: true, status: 201, json: { id: "b-1" } });
    expect(urls.every((u) => u.startsWith("https://api.sandbox.airwallex.com/api/v1/"))).toBe(true);
    expect(JSON.stringify(made)).not.toContain("key-secret");
    expect(await new AwxGatewayDesk({ AWX_GATEWAY_WRITE: "on" }, { fetchImpl }).call({ method: "GET", path: "/balances/current" })).toMatchObject({ ok: false, code: "gateway_no_key" });
  });
});

describe("the Cloud's guard: the kill switch and the daily caps", () => {
  const cloudSql = async () => {
    const sql = sqliteSql(":memory:");
    await sql.exec("CREATE TABLE try_switches (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)");
    const set = (k: string, v: string) => sql.run("INSERT INTO try_switches (key, value, updated_at) VALUES (?, ?, '') ON CONFLICT(key) DO UPDATE SET value = excluded.value", [k, checkSwitch(k, v)]);
    return { sql, set };
  };

  it("is off until the admin switches it on and sets both caps; a /try company needs its own switch", async () => {
    const { sql, set } = await cloudSql();
    const g = cloudGuard({ sql, tenantId: "t_a", gateway: true, cacheMs: 0 });
    expect(await g.blocked()).toMatch(/switched off/);
    await set("awx_act", "on");
    expect(await g.blocked()).toMatch(/no daily cap/);
    await set("awx_act_company_cents_day", "5000");
    await set("awx_act_global_cents_day", "8000");
    expect(await g.blocked()).toBeNull();
    expect(await cloudGuard({ sql, tenantId: "t_try_x", gateway: true, cacheMs: 0 }).blocked()).toMatch(/awx_act_try/);
    expect(await cloudGuard({ sql, tenantId: "t_a", gateway: false, cacheMs: 0 }).blocked()).toMatch(/no Airwallex gateway/);
    expect(() => checkSwitch("awx_act_company_cents_day", "100001")).toThrow(/at most 100000/);
  });

  it("counts a request_id once, refuses past the company's and the global cap, and frees a refusal", async () => {
    const { sql, set } = await cloudSql();
    await set("awx_act", "on"); await set("awx_act_company_cents_day", "6000"); await set("awx_act_global_cents_day", "8000");
    const a = cloudGuard({ sql, tenantId: "t_a", gateway: true, cacheMs: 0 });
    const b = cloudGuard({ sql, tenantId: "t_b", gateway: true, cacheMs: 0 });
    await a.spend({ key: "r1", kind: "transfer", currency: "EUR", cents: 3000 });
    await a.spend({ key: "r1", kind: "transfer", currency: "EUR", cents: 3000 }); // a retry: counted once
    expect((await a.caps()).company_used_cents).toBe(3000);
    await expect(a.spend({ key: "r2", kind: "transfer", currency: "EUR", cents: 3001 })).rejects.toThrow(/this company's daily cap for Airwallex actions is 60.00/);
    await b.spend({ key: "r1", kind: "transfer", currency: "EUR", cents: 4000 }); // another company's own r1
    await expect(b.spend({ key: "r3", kind: "conversion", currency: "USD", cents: 1001 })).rejects.toThrow(/across all companies is 80.00/);
    await a.release("r1");
    expect((await a.caps()).global_used_cents).toBe(4000);
  });
});

// ---- The routed rail and the engine on it ------------------------------------------------------------------------------

/** The in-memory stand-in as "Airwallex": its ids in Airwallex's shape (no "ben_1"), so routing by id is tested too. */
function asAirwallex(fake: FakeAirwallex): Rails3 {
  const out = (v: unknown): unknown => typeof v === "string" ? v.replace(/^([a-z]+)_(\d+)$/, "awx-$1-$2")
    : Array.isArray(v) ? v.map(out) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, out(x)])) : v;
  const back = (v: unknown): unknown => typeof v === "string" ? v.replace(/^awx-([a-z]+)-(\d+)$/, "$1_$2")
    : Array.isArray(v) ? v.map(back) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)])) : v;
  return new Proxy(fake, { get: (t, k) => {
    const f = (t as unknown as Record<string | symbol, unknown>)[k];
    return typeof f === "function" ? async (...a: unknown[]) => out(await (f as (...x: unknown[]) => Promise<unknown>).apply(t, a.map(back))) : f;
  } }) as unknown as Rails3;
}

function memoryGuard() {
  const spent = new Map<string, number>();
  const g = {
    off: null as string | null, cap: 1_000_000, spent,
    blocked: async () => g.off,
    spend: async (a: { key: string; cents: number }) => {
      if (spent.has(a.key)) return;
      const used = [...spent.values()].reduce((x, y) => x + y, 0);
      if (used + a.cents > g.cap) throw new ActCapReached(`over the test cap of ${g.cap}`);
      spent.set(a.key, a.cents);
    },
    release: async (k: string) => { spent.delete(k); },
  };
  return g satisfies ActGuard;
}

const RP = "engine.example.invalid";
const ORIGIN = `https://${RP}`;
function memoryDocs(): DocStore {
  const kept = new Map<string, Buffer>();
  return { put: (sha, bytes) => { kept.set(`mem:${sha}`, Buffer.from(bytes)); return `mem:${sha}`; }, get: (p) => kept.get(p)! };
}

/** A company's engine on both banks, its passkey set up, the new supplier's invoice filed. */
async function company() {
  const db = openDb(":memory:");
  useDocStore(db, memoryDocs());
  const sim = new FakeAirwallex();
  const awxFake = new FakeAirwallex();
  const store = memoryActStore();
  const guard = memoryGuard();
  const rail = new RoutedRail(asAirwallex(awxFake), sim as unknown as Rails3, store, guard, undefined,
    (what, why) => store.note({ at: "t", ref: "", what, bank: "simulated", label: `${what} on the simulated bank: ${why}` }));
  const named = Object.assign(new FakePayeeNames(), { confirmAll: true });
  const host = new EngineHost({
    db, reader: parserOnly, rails: { rail, sim: rail, get batches() { return rail.batches; } } as never,
    payeeVerifier: () => new ActVerifier(named, guard, () => undefined),
    rp: { rpId: RP, origin: ORIGIN }, company: { name: "Act Co", lang: "en" }, vault: null, feed: null, samples: SAMPLES,
  });
  const acts = airwallexActions({ host, db, rail, guard, store });
  await host.seed();
  const phone = new FakeAuthenticator();
  const start = await host.passkeyStart();
  await host.passkeyFinish({ code: start.code, credential: phone.register({ challenge: start.challenge, origin: ORIGIN, rpId: RP }), label: "Test Owner" });
  const up = await host.uploadSample("unknown");
  let counter = 0;
  const sign = (p: { id: string; terms_sha256: string }, challenge = challengeFor(p.terms_sha256)) => ({ proposal_id: p.id, terms_sha256: p.terms_sha256, credential: phone.sign({ challenge, origin: ORIGIN, rpId: RP, counter: ++counter }) });
  return { db, sim, awxFake, store, guard, rail, host, acts, invoiceId: up!.invoice!.id, sign };
}

/** The new supplier checked, signed for and added: at Airwallex when it is on. */
async function withSupplier(w: Awaited<ReturnType<typeof company>>) {
  const added = await w.acts.addSupplier(w.invoiceId, { by: "Test Owner", how: "Called Zeeland's finance desk on the number in our contract file", address: { street: "Havenweg 1", city: "Vlissingen", postcode: "4381 AA" } });
  if (!added.ok) throw new Error(added.reason);
  const ok = await w.acts.approve(w.sign(added.proposal));
  expect(ok.status).toBe("approved");
  return added;
}

describe("the engine's chain on the routed rail", () => {
  it("adds the new supplier at Airwallex after the CFO's signature, with a twin at the simulated bank", async () => {
    const w = await company();
    expect((await w.host.invoice(w.invoiceId))!.status).toBe("needs_vendor");
    const added = await withSupplier(w);
    expect(added.name_check).toMatchObject({ code: "VERIFIED", match: "FULL_MATCH", source: "airwallex" });
    const v = (await w.acts.view()).invoices.find((i) => i.invoice_id === w.invoiceId)!;
    expect(v.payee).toMatchObject({ bank: "airwallex", beneficiary_id: expect.stringMatching(/^awx-ben-\d+$/) as string, twin: expect.stringMatching(/^ben_\d+$/) as string });
    expect(awxFake(w).payoutBeneficiaries).toHaveLength(1);
    expect((await w.host.invoice(w.invoiceId))!.status).toBe("ready");
  });

  it("plans and pays at Airwallex: the signed hash on the transfer, its request_id from the terms, settled to PAID; a cent changed is refused", async () => {
    const w = await company();
    await withSupplier(w);
    const planned = await w.acts.propose(w.invoiceId);
    if (!planned.ok) throw new Error(planned.reason);
    const terms = (await w.host.terms(planned.proposal.id))!;
    // One cent more in the terms: another hash, another challenge; both layers refuse it and nothing moves.
    const cent = { ...terms.terms, amount: (Number((terms.terms as unknown as { amount: string }).amount) + 0.01).toFixed(2) };
    const tampered = await w.acts.approve(w.sign(planned.proposal, challengeFor(sha256Hex(canonicalTerms(cent)))));
    expect(tampered.status).toBe("refused");
    expect(w.awxFake.transfers).toHaveLength(0);

    const paid = await w.acts.approve(w.sign(planned.proposal));
    expect(paid.status).toBe("approved");
    expect(w.awxFake.transfers).toHaveLength(1);
    const tr = w.awxFake.transfers[0]!;
    expect(tr).toMatchObject({ requestId: (terms.terms as unknown as { transfer_request_id: string }).transfer_request_id, metadata: terms.terms_sha256, status: "PAID" });
    expect(w.sim.transfers).toHaveLength(0);
    expect(w.guard.spent.get(tr.requestId)).toBe(tr.amountCents);
    const v = (await w.acts.view()).invoices.find((i) => i.invoice_id === w.invoiceId)!;
    expect(v).toMatchObject({ bank: "airwallex", transfer: { transfer_id: `awx-tr-${tr.id.split("_")[1]}`, status: "PAID", approval_sha256: terms.terms_sha256 } });
    // Never twice: a second approval and a retry move nothing more.
    await w.acts.approve(w.sign(planned.proposal));
    expect((await w.acts.retry(planned.proposal.id)).status).toBe("nothing_to_retry");
    expect(w.awxFake.transfers).toHaveLength(1);
  });

  it("FX for the shortfall only: a live quote at Airwallex in the signed terms, converted after the signature with the signed hash", async () => {
    const w = await company();
    await withSupplier(w);
    // The CFO's policy (a signed policy change in the product; set directly here): pay EUR shortfalls from USD.
    w.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('payout.funding_currency', 'USD', '') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    w.awxFake.bal.USD.availableCents = 3_000_000_00; // the sandbox's USD, well above the company's USD floor
    // The sandbox's EUR: 100.00 above the company's floor and commitments, so only the rest is converted.
    const setting = (k: string) => Math.round(Number((w.db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value ?? "0") * 100);
    w.awxFake.bal.EUR.availableCents = setting("eur_floor") + setting("eur_obligations") + 10_000;
    const planned = await w.acts.propose(w.invoiceId);
    if (!planned.ok) throw new Error(planned.reason);
    const t = (await w.host.terms(planned.proposal.id))!;
    const conv = (t.terms as unknown as { conversion: { quote_id: string; request_id: string; buy_amount: string; sell_currency: string } }).conversion;
    expect(conv).toMatchObject({ quote_id: expect.stringMatching(/^awx-q-\d+$/) as string, sell_currency: "USD" });
    const amount = Number((t.terms as unknown as { amount: string }).amount);
    expect(Number(conv.buy_amount)).toBeLessThan(amount - 99); // the shortfall: the 100.00 free is not bought again
    expect((await w.acts.approve(w.sign(planned.proposal))).status).toBe("approved");
    expect(w.awxFake.conversions).toHaveLength(1);
    expect(w.awxFake.conversions[0]).toMatchObject({ requestId: conv.request_id });
    const v = (await w.acts.view()).invoices.find((i) => i.invoice_id === w.invoiceId)!;
    expect(v).toMatchObject({ bank: "airwallex", quote: { quote_id: conv.quote_id }, conversion: { conversion_id: expect.stringMatching(/^awx-conv-/) as string }, transfer: { status: "PAID" } });
    expect(w.guard.spent.has(conv.request_id)).toBe(true);
  });

  it("falls back to the simulated bank, labelled, when Airwallex is switched off before Pay", async () => {
    const w = await company();
    await withSupplier(w);
    w.guard.off = "Airwallex actions are switched off (awx_act)";
    const planned = await w.acts.propose(w.invoiceId);
    if (!planned.ok) throw new Error(planned.reason);
    const paid = await w.acts.approve(w.sign(planned.proposal));
    expect(paid.status).toBe("approved");
    expect(w.awxFake.transfers).toHaveLength(0);
    expect(w.sim.transfers).toHaveLength(1);
    const v = (await w.acts.view()).invoices.find((i) => i.invoice_id === w.invoiceId)!;
    expect(v.bank).toBe("simulated");
    expect(v.bank_words).toBe("Simulated bank · test money");
    expect(v.notes.map((n) => n.label).join(" | ")).toMatch(/planned on the simulated bank: Airwallex actions are switched off/);
  });

  it("stops at the cap after the signature: nothing is sent, the payment fails with the reason, and nothing goes elsewhere", async () => {
    const w = await company();
    await withSupplier(w);
    const planned = await w.acts.propose(w.invoiceId);
    if (!planned.ok) throw new Error(planned.reason);
    w.guard.cap = 100;
    const out = await w.acts.approve(w.sign(planned.proposal));
    expect(out.settled?.error).toMatch(/over the test cap/);
    expect(w.awxFake.transfers).toHaveLength(0);
    expect(w.sim.transfers).toHaveLength(0);
    const v = (await w.acts.view()).invoices.find((i) => i.invoice_id === w.invoiceId)!;
    expect(v.notes.map((n) => n.label).join(" | ")).toMatch(/stopped at the Airwallex sandbox: over the test cap/);
  });

  it("adds a supplier at the simulated bank, labelled, when Airwallex refuses the payee", async () => {
    const w = await company();
    const added = await w.acts.addSupplier(w.invoiceId, { by: "Test Owner", how: "Called Zeeland's finance desk on the number in our contract file", address: { street: "Havenweg 1", city: "Vlissingen", postcode: "4381 AA" } });
    if (!added.ok) throw new Error(added.reason);
    (w.awxFake as unknown as { createPayoutBeneficiary: () => Promise<never> }).createPayoutBeneficiary = async () => { throw new AirwallexError(400, "invalid_argument", {}, "/beneficiaries/create"); };
    expect((await w.acts.approve(w.sign(added.proposal))).status).toBe("approved");
    const v = (await w.acts.view()).invoices.find((i) => i.invoice_id === w.invoiceId)!;
    expect(v.payee).toMatchObject({ bank: "simulated" });
    expect((await w.acts.view()).notes.map((n) => n.label).join(" | ")).toMatch(/adding .* on the simulated bank: Airwallex answered HTTP 400 invalid_argument/);
  });

  it("plans again on the simulated bank, labelled, when Airwallex fails during the plan", async () => {
    const w = await company();
    await withSupplier(w);
    (w.awxFake as unknown as { balancesAll: () => Promise<never> }).balancesAll = async () => { throw new AirwallexError(503, undefined, {}, "/balances/current", { traceId: "tr-9" }); };
    const planned = await w.acts.propose(w.invoiceId);
    if (!planned.ok) throw new Error(planned.reason);
    const v = (await w.acts.view()).invoices.find((i) => i.invoice_id === w.invoiceId)!;
    expect(v.bank).toBe("simulated");
    expect(v.notes.map((n) => n.label).join(" | ")).toMatch(/planned on the simulated bank: Airwallex answered HTTP 503 \(trace tr-9\)/);
  });

  it("Pay all: one batch, one signature over its totals and lines; a batch with a simulated-bank supplier goes there whole, labelled", async () => {
    const w = await company();
    await withSupplier(w);
    const clean = (await w.host.uploadSample("clean"))!.invoice!.id;
    w.sim.bal.EUR.availableCents += 500_000; // room for both payments above the EUR floor (the funding currency is EUR itself)
    const out = await w.acts.proposeBatch([clean, w.invoiceId]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.not_planned).toEqual([]);
    expect(out.planned).toHaveLength(2);
    const t = (await w.host.terms(out.proposal.id))!.terms as unknown as { kind: string; count: string; totals: Record<string, string>; lines: unknown[] };
    expect(t).toMatchObject({ kind: "payment_batch", count: "2" });
    expect(t.lines).toHaveLength(2);
    expect((await w.acts.view()).notes.map((n) => n.label).join(" | ")).toMatch(/Pay all planned on the simulated bank: the batch also pays suppliers at the simulated bank/);
    expect((await w.acts.approve(w.sign(out.proposal))).status).toBe("approved");
    expect(w.awxFake.transfers).toHaveLength(0);
    expect(w.sim.transfers).toHaveLength(2);
  });

  it("the batch rail at Airwallex: only Airwallex payees, each line spoken for under the caps by its request_id", async () => {
    const store = memoryActStore();
    const guard = memoryGuard();
    const made: string[] = [];
    const batches = { createBatch: async () => ({}), findBatchByRequestId: async () => undefined, getBatch: async () => ({}), addItems: async (_id: string, items: { requestId: string }[]) => { made.push(...items.map((i) => i.requestId)); return {}; }, quoteBatch: async () => ({}), listItems: async () => [], submitBatch: async () => ({}), deleteBatch: async () => undefined };
    const rail = new RoutedRail(asAirwallex(new FakeAirwallex()), new FakeAirwallex() as unknown as Rails3, store, guard, batches as never);
    expect(rail.batches).toBeUndefined();
    store.set("ben:awx-ben-1", { bank: "airwallex", twin: "ben_9" });
    const line = (ben: string, req: string) => ({ requestId: req, beneficiaryId: ben, amountCents: 1000, currency: "EUR", sourceCurrency: "EUR", method: "LOCAL" as const, reference: "r", reason: "x", metadata: {} });
    await rail.within("airwallex", async () => {
      await expect(rail.batches!.addItems("b1", [line("ben_3", "q-1")])).rejects.toThrow(/not at the Airwallex sandbox/);
      await rail.batches!.addItems("b1", [line("awx-ben-1", "q-2"), line("awx-ben-1", "q-3")]);
    });
    expect(made).toEqual(["q-2", "q-3"]);
    expect([...guard.spent.keys()]).toEqual(["q-2", "q-3"]);
  });

  it("books money in: a deposit on the Airwallex sandbox's simulation, under the cap", async () => {
    const w = await company();
    const out = await w.acts.depositIn({ amountCents: 2500, reference: "PURSER-IN-T1", payer: "Test customer (simulation)" });
    if (!out.ok) throw new Error(out.reason);
    expect(out).toMatchObject({ amount: "25.00", currency: "USD", status: "SETTLED", deposit_id: expect.stringMatching(/^awx-dep-/) as string });
    expect(w.guard.spent.get("dep:PURSER-IN-T1")).toBe(2500);
    expect((await w.acts.view()).deposits[0]).toMatchObject({ bank: "airwallex", amount: "25.00", outcome: "UNMATCHED" });
  });
});

const awxFake = (w: { awxFake: FakeAirwallex }) => w.awxFake as unknown as { payoutBeneficiaries: unknown[] };
