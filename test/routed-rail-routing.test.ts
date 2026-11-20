// Purser Cloud's two banks behind one rail (src/airwallex/routedRail.ts), on its own with two small stand-in banks:
// every call that names an object goes to the bank that made it; a money call at Airwallex is spoken for under the caps
// first and freed only when Airwallex refused it outright (never after a lost answer or a duplicate request_id); a step
// that moves no money falls back to the simulated bank, labelled, while money never does; a payee made at Airwallex
// gets a twin at the simulated bank, and a transfer paid to the twin answers with the payee the CFO signed for; one
// batch transfer is Airwallex only, every line checked before any is spoken for.
import { describe, expect, it } from "vitest";
import { ACT_CURRENCIES, ActCapReached, ActOff, RoutedRail, failureWords, fromAirwallexSide, refusedOutright, type ActGuard, type Bank, type Rails3, type RouteRow, type RouteStore } from "../src/airwallex/routedRail.js";
import { AirwallexAmbiguous, AirwallexError } from "../src/airwallex/client.js";
import { GatewayRefused } from "../src/airwallex/gatewayRules.js";
import type { AwxBatch, AwxBatchItem, BatchItemIn, BatchTransferRail } from "../src/airwallex/batchTransfers.js";
import type { NewPayoutBeneficiary, Quote, Transfer } from "../src/airwallex/port.js";

/** A stand-in bank: ids in its own shape (the simulated bank's "tr_1"; Airwallex's anything else), every call recorded. */
function bank(name: Bank) {
  const calls: string[] = [];
  let n = 0;
  const id = (kind: string) => (name === "simulated" ? `${kind}_${++n}` : `${kind.toUpperCase()}-awx-${++n}`);
  const transfers = new Map<string, Transfer>();
  const payees = new Map<string, string>();
  const fail: { next: unknown } = { next: null };
  const maybeFail = () => { if (fail.next) { const e = fail.next; fail.next = null; throw e; } };
  const rail = {
    balances: async () => { calls.push("balances"); maybeFail(); return { EUR: { currency: "EUR", available: 100 } }; },
    balancesAll: async () => { calls.push("balancesAll"); return {}; },
    usdGlobalAccountId: async () => { calls.push("usdGlobalAccountId"); maybeFail(); return `${name}-usd-account`; },
    findDepositsByReference: async (ref: string) => { calls.push(`deposits ${ref}`); return []; },
    currentRate: async () => { calls.push("currentRate"); return { rate: "1.1" }; },
    currentRateAny: async () => { calls.push("currentRateAny"); return { rate: "1.2" }; },
    createQuote: async (a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }) => {
      calls.push("createQuote"); maybeFail();
      return { quoteId: id("q"), buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmountCents: a.buyAmountCents, sellAmountCents: a.buyAmountCents + 10, clientRate: "1.1", validFrom: "", validTo: "" };
    },
    createQuoteAny: async (a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }) => {
      calls.push("createQuoteAny");
      return { quoteId: id("q"), buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmountCents: a.buyAmountCents, sellAmountCents: a.buyAmountCents + 20, clientRate: "1.2", validFrom: "", validTo: "" };
    },
    createConversion: async (a: { requestId: string; quote: Quote }) => {
      calls.push(`createConversion ${a.requestId}`); maybeFail();
      return { conversionId: id("conv"), requestId: a.requestId, quoteId: a.quote.quoteId, status: "SETTLED", buyAmountCents: a.quote.buyAmountCents, sellAmountCents: a.quote.sellAmountCents };
    },
    createConversionAny: async (a: { requestId: string; quote: Quote }) => {
      calls.push(`createConversionAny ${a.requestId}`);
      return { conversionId: id("conv"), requestId: a.requestId, quoteId: a.quote.quoteId, status: "SETTLED", buyAmountCents: 1, sellAmountCents: 1 };
    },
    findConversionByRequestId: async (r: string) => { calls.push(`findConversion ${r}`); return undefined; },
    findBeneficiaryByIban: async (iban: string) => { calls.push(`findBeneficiaryByIban ${iban}`); const p = payees.get(iban); return p ? { id: p } : undefined; },
    createBeneficiary: async (b: { iban: string; name: string }) => { calls.push(`createBeneficiary ${b.name}`); maybeFail(); const p = id("ben"); payees.set(b.iban, p); return { ...b, id: p }; },
    findPayoutBeneficiary: async (b: NewPayoutBeneficiary) => { calls.push(`findPayoutBeneficiary ${b.name}`); maybeFail(); const p = payees.get(b.name); return p ? { id: p } : undefined; },
    createPayoutBeneficiary: async (b: NewPayoutBeneficiary) => { calls.push(`createPayoutBeneficiary ${b.name}`); maybeFail(); const p = id("ben"); payees.set(b.name, p); return { id: p }; },
    createTransfer: async (t: { requestId: string; beneficiaryId: string; amountCents: number; currency: string }) => {
      calls.push(`createTransfer ${t.requestId} to ${t.beneficiaryId}`); maybeFail();
      const tr = { id: id("tr"), requestId: t.requestId, status: "PROCESSING", amountCents: t.amountCents, currency: t.currency, beneficiaryId: t.beneficiaryId } as Transfer;
      transfers.set(tr.id, tr); return tr;
    },
    createPayoutTransfer: async (t: { requestId: string; beneficiaryId: string; amountCents: number; currency: string }) => {
      calls.push(`createPayoutTransfer ${t.requestId} to ${t.beneficiaryId}`); maybeFail();
      const tr = { id: id("tr"), requestId: t.requestId, status: "PROCESSING", amountCents: t.amountCents, currency: t.currency, beneficiaryId: null } as unknown as Transfer;
      transfers.set(tr.id, tr); return tr;
    },
    findTransferByRequestId: async (r: string) => { calls.push(`findTransfer ${r}`); return [...transfers.values()].find((t) => t.requestId === r); },
    findTransferByRequestIdStrict: async (r: string) => { calls.push(`findTransferStrict ${r}`); return [...transfers.values()].find((t) => t.requestId === r); },
    getTransfer: async (i: string) => { calls.push(`getTransfer ${i}`); return transfers.get(i)!; },
    transitionTransfer: async (i: string, to: string) => { calls.push(`transition ${i} ${to}`); const t = { ...transfers.get(i)!, status: to }; transfers.set(i, t); return t; },
    simulateDeposit: async (a: { globalAccountId: string; amountCents: number; reference: string }) => {
      calls.push(`deposit ${a.amountCents} into ${a.globalAccountId}`); maybeFail();
      return { id: id("dep"), amountCents: a.amountCents, currency: "USD", reference: a.reference, status: "SETTLED" };
    },
  };
  return { rail: rail as unknown as Rails3, calls, fail };
}

function memoryRoutes(): RouteStore & { rows: Map<string, RouteRow> } {
  const rows = new Map<string, RouteRow>();
  return { rows, get: (k) => rows.get(k) ?? null, set: (k, r) => { rows.set(k, r); } };
}

function guardOf(o: { blocked?: string | null; capAt?: number } = {}) {
  const spent: { key: string; kind: string; currency: string; cents: number }[] = [];
  const released: string[] = [];
  const g: ActGuard & { blockedNow: string | null } = {
    blockedNow: o.blocked ?? null,
    blocked: async () => g.blockedNow,
    spend: async (a) => {
      if (o.capAt !== undefined && a.cents > o.capAt) throw new ActCapReached(`over the daily cap of ${o.capAt} cents`);
      spent.push(a);
    },
    release: async (k) => { released.push(k); },
  };
  return { g, spent, released };
}

function setup(o: { blocked?: string | null; capAt?: number; batches?: BatchTransferRail } = {}) {
  const awx = bank("airwallex");
  const sim = bank("simulated");
  const routes = memoryRoutes();
  const guard = guardOf(o);
  const fallbacks: string[] = [];
  const rail = new RoutedRail(awx.rail, sim.rail, routes, guard.g, o.batches, (what, why) => fallbacks.push(`${what}: ${why}`));
  return { awx, sim, routes, guard, fallbacks, rail };
}

const quoteArgs = { buyCurrency: "EUR" as const, sellCurrency: "USD" as const, buyAmountCents: 10_000, validity: "MIN_15" as const };
const payee: NewPayoutBeneficiary = { name: "Stockline GmbH", address: { street: "Hafen 1", city: "Hamburg", postcode: "20457", countryCode: "DE" }, method: "SWIFT", bank: { country: "DE", currency: "EUR", accountName: "Stockline GmbH", iban: "DE00000000000000004471" } };
const sepaPayee = { name: "Alpine AG", iban: "DE00000000000000000118", bic: "AAAADEFF", currency: "EUR" as const, countryCode: "DE" as const, bankName: "A Bank", address: { street: "S 1", city: "Munich", postcode: "80331", countryCode: "DE" as const } };
const transfer = (requestId: string, beneficiaryId: string, amountCents = 5_000) => ({ requestId, beneficiaryId, amountCents, currency: "EUR" as const, sourceCurrency: "EUR" as const, reference: "INV-1", reason: "goods", approvalSha256: "a".repeat(64) });
const payout = (requestId: string, beneficiaryId: string, currency = "EUR", amountCents = 5_000) => ({ requestId, beneficiaryId, amountCents, currency, sourceCurrency: currency, method: "SWIFT" as const, reference: "INV-2", reason: "goods", approvalSha256: "b".repeat(64) });
const http = (status: number, code?: string) => new AirwallexError(status, code, { message: "the payee Max Mustermann is blocked" }, "/api/v1/transfers/create", { traceId: "trace-1" });

describe("calls that name no object go to the action's bank", () => {
  it("outside any action, to the simulated bank; inside one, to the bank it names", async () => {
    const s = setup();
    expect(s.rail.current).toBe("simulated");
    await s.rail.balances();
    expect(s.sim.calls).toEqual(["balances"]);
    await s.rail.within("airwallex", async () => {
      expect(s.rail.current).toBe("airwallex");
      await s.rail.balances(); await s.rail.balancesAll(); await s.rail.findDepositsByReference("R1", "2026-11-01");
      await s.rail.currentRate(quoteArgs); await s.rail.currentRateAny(quoteArgs);
    });
    expect(s.awx.calls).toEqual(["balances", "balancesAll", "deposits R1", "currentRate", "currentRateAny"]);
    expect(s.rail.current).toBe("simulated");
  });

  it("two actions at the same moment never see each other's bank", async () => {
    const s = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const seen: Bank[] = [];
    const a = s.rail.within("airwallex", async () => { await gate; seen.push(s.rail.current); });
    const b = s.rail.within("simulated", async () => { seen.push(s.rail.current); release(); });
    await Promise.all([a, b]);
    expect(seen).toEqual(["simulated", "airwallex"]);
  });

  it("an Airwallex action while Airwallex is switched off is refused with the switch's reason, and remembered", async () => {
    const s = setup({ blocked: "the owner switched Airwallex off" });
    await s.rail.within("airwallex", async () => {
      await expect(s.rail.balances()).rejects.toBeInstanceOf(ActOff);
      await expect(s.rail.balances()).rejects.toThrow("Airwallex sandbox not used: the owner switched Airwallex off");
      expect(s.rail.failure).toBe("the owner switched Airwallex off");
    });
    expect(s.awx.calls).toEqual([]);
    expect(s.rail.failure).toBeNull();
  });
});

describe("a quote is remembered at its bank, and its conversion goes there", () => {
  it("an Airwallex quote converts at Airwallex, spoken for in its sell currency first", async () => {
    const s = setup();
    const q = await s.rail.within("airwallex", () => s.rail.createQuote(quoteArgs));
    expect(s.routes.rows.get(`quote:${q.quoteId}`)).toEqual({ bank: "airwallex", twin: null });
    // Converted later, from an action at the simulated bank: the quote's bank decides, not the action's.
    const c = await s.rail.within("simulated", () => s.rail.createConversion({ requestId: "req-conv-1", quote: q, approvalSha256: "c".repeat(64) }));
    expect(s.awx.calls).toContain("createConversion req-conv-1");
    expect(s.guard.spent).toEqual([{ key: "req-conv-1", kind: "conversion", currency: "USD", cents: 10_010 }]);
    expect(s.routes.rows.get(`conv:${c.conversionId}`)?.bank).toBe("airwallex");
    expect(s.routes.rows.get("req:req-conv-1")?.bank).toBe("airwallex");
    // Looked up by its request_id: at the bank it was sent to.
    await s.rail.findConversionByRequestId("req-conv-1");
    expect(s.awx.calls).toContain("findConversion req-conv-1");
  });

  it("a simulated quote converts at the simulated bank with nothing spoken for", async () => {
    const s = setup();
    const q = await s.rail.createQuoteAny(quoteArgs);
    expect(q.quoteId).toMatch(/^q_\d+$/);
    await s.rail.within("airwallex", () => s.rail.createConversionAny({ requestId: "req-conv-2", quote: q, approvalSha256: "c".repeat(64) }));
    expect(s.sim.calls).toContain("createConversionAny req-conv-2");
    expect(s.awx.calls).toEqual([]);
    expect(s.guard.spent).toEqual([]);
    // A request_id this rail never sent is looked up at the action's bank.
    await s.rail.findConversionByRequestId("never-sent");
    expect(s.sim.calls).toContain("findConversion never-sent");
  });

  it("an id this rail never recorded is placed by its shape", () => {
    const s = setup();
    expect(s.rail.bankOfId("quote", "q_12")).toBe("simulated");
    expect(s.rail.bankOfId("tr", "8a7c-uuid")).toBe("airwallex");
    s.routes.set("tr:8a7c-uuid", { bank: "simulated", twin: null });
    expect(s.rail.bankOfId("tr", "8a7c-uuid")).toBe("simulated");
    expect(s.rail.routeOf("tr:8a7c-uuid")).toEqual({ bank: "simulated", twin: null });
    expect(s.rail.routeOf("tr:nothing")).toBeNull();
  });
});

describe("a money call at Airwallex is spoken for, and freed only on an outright refusal", () => {
  async function paidAtAirwallex(s: ReturnType<typeof setup>) {
    return s.rail.within("airwallex", () => s.rail.createPayoutBeneficiary(payee));
  }

  it("a 4xx refusal frees the amount again and is remembered in Airwallex's code and trace, never its words", async () => {
    const s = setup();
    const ben = await paidAtAirwallex(s);
    s.awx.fail.next = http(400, "invalid_argument");
    await s.rail.within("airwallex", async () => {
      await expect(s.rail.createPayoutTransfer(payout("req-pay-1", ben.id))).rejects.toBeInstanceOf(AirwallexError);
      expect(s.rail.failure).toBe("Airwallex answered HTTP 400 invalid_argument (trace trace-1)");
      expect(s.rail.failure).not.toContain("Mustermann");
    });
    expect(s.guard.spent.map((x) => x.key)).toEqual(["req-pay-1"]);
    expect(s.guard.released).toEqual(["req-pay-1"]);
  });

  it("a 5xx, a lost answer or a duplicate request_id keeps the amount spoken for: money may have moved", async () => {
    const s = setup();
    const ben = await paidAtAirwallex(s);
    const outcomes: unknown[] = [http(502), new AirwallexAmbiguous("/api/v1/transfers/create", new Error("socket hang up")), http(409, "duplicate_request_id")];
    for (const [i, e] of outcomes.entries()) {
      s.awx.fail.next = e;
      await s.rail.within("airwallex", async () => {
        await expect(s.rail.createPayoutTransfer(payout(`req-keep-${i}`, ben.id))).rejects.toBe(e);
      });
    }
    expect(s.guard.spent.map((x) => x.key)).toEqual(["req-keep-0", "req-keep-1", "req-keep-2"]);
    expect(s.guard.released).toEqual([]);
  });

  it("a currency Cloud does not move at Airwallex is refused before anything is spoken for", async () => {
    const s = setup();
    const ben = await paidAtAirwallex(s);
    expect(ACT_CURRENCIES.has("JPY")).toBe(false);
    await s.rail.within("airwallex", async () => {
      await expect(s.rail.createPayoutTransfer(payout("req-jpy", ben.id, "JPY"))).rejects.toThrow("JPY is not moved at the Airwallex sandbox from Cloud (EUR, USD, GBP only)");
      expect(s.rail.failure).toBe("JPY is not moved at the Airwallex sandbox from Cloud (EUR, USD, GBP only)");
    });
    expect(s.guard.spent).toEqual([]);
    expect(s.awx.calls.filter((c) => c.startsWith("createPayoutTransfer"))).toEqual([]);
  });

  it("over a daily cap, Airwallex is never called", async () => {
    const s = setup({ capAt: 1_000 });
    const ben = await paidAtAirwallex(s);
    await s.rail.within("airwallex", async () => {
      await expect(s.rail.createPayoutTransfer(payout("req-big", ben.id, "EUR", 1_001))).rejects.toBeInstanceOf(ActCapReached);
      expect(s.rail.failure).toBe("over the daily cap of 1000 cents");
    });
    expect(s.awx.calls.filter((c) => c.startsWith("createPayoutTransfer"))).toEqual([]);
  });

  it("a payment is never sent again elsewhere after a failure: it stays failed, at the bank it was sent to", async () => {
    const s = setup();
    const ben = await paidAtAirwallex(s);
    s.awx.fail.next = http(500);
    await s.rail.within("airwallex", () => expect(s.rail.createPayoutTransfer(payout("req-once", ben.id))).rejects.toBeInstanceOf(AirwallexError));
    // Retried from an action at the simulated bank: the request_id's bank holds.
    await s.rail.within("simulated", () => s.rail.createPayoutTransfer(payout("req-once", ben.id)));
    expect(s.awx.calls.filter((c) => c.startsWith("createPayoutTransfer"))).toHaveLength(2);
    expect(s.sim.calls.filter((c) => c.startsWith("createPayoutTransfer"))).toEqual([]);
  });
});

describe("payees: a twin at the simulated bank, and the payee the CFO signed for", () => {
  it("a SEPA payee made at Airwallex gets a twin (found first, else made), and a simulated payment pays the twin", async () => {
    const s = setup();
    const made = await s.rail.within("airwallex", async () => {
      expect(await s.rail.findBeneficiaryByIban(sepaPayee.iban)).toBeUndefined();
      return s.rail.createBeneficiary(sepaPayee);
    });
    const twin = s.routes.rows.get(`ben:${made.id}`)!.twin!;
    expect(twin).toMatch(/^ben_\d+$/);
    expect(s.routes.rows.get(`twin:${twin}`)).toEqual({ bank: "simulated", twin: made.id });

    // Paid at the simulated bank: to the twin, and the answers name the payee the CFO signed for.
    const tr = await s.rail.within("simulated", () => s.rail.createTransfer(transfer("req-sepa", made.id)));
    expect(s.sim.calls).toContain(`createTransfer req-sepa to ${twin}`);
    expect(tr.beneficiaryId).toBe(made.id);
    expect((await s.rail.getTransfer(tr.id)).beneficiaryId).toBe(made.id);
    expect((await s.rail.findTransferByRequestId("req-sepa"))!.beneficiaryId).toBe(made.id);
    expect((await s.rail.findTransferByRequestIdStrict("req-sepa"))!.beneficiaryId).toBe(made.id);
    expect((await s.rail.transitionTransfer(tr.id, "PAID")).beneficiaryId).toBe(made.id);
    expect(s.guard.spent).toEqual([]);
  });

  it("a twin already at the simulated bank for that IBAN is reused, not made again", async () => {
    const s = setup();
    const first = await s.rail.within("airwallex", () => s.rail.createBeneficiary(sepaPayee));
    const again = await s.rail.within("airwallex", () => s.rail.createBeneficiary(sepaPayee));
    expect(again.id).not.toBe(first.id);
    expect(s.routes.rows.get(`ben:${again.id}`)!.twin).toBe(s.routes.rows.get(`ben:${first.id}`)!.twin);
    expect(s.sim.calls.filter((c) => c.startsWith("createBeneficiary"))).toHaveLength(1);
  });

  it("a payee at one bank only cannot be paid at the other", async () => {
    const s = setup();
    const simOnly = await s.rail.createPayoutBeneficiary(payee);
    await s.rail.within("airwallex", () => expect(s.rail.createPayoutTransfer(payout("req-x", simOnly.id))).rejects.toThrow(`the payee ${simOnly.id} is at the simulated bank only, not at the Airwallex sandbox`));
    s.routes.set("ben:AWX-only", { bank: "airwallex", twin: null });
    await s.rail.within("simulated", () => expect(s.rail.createPayoutTransfer(payout("req-y", "AWX-only"))).rejects.toThrow("the payee AWX-only is at the Airwallex sandbox only; it has no twin at the simulated bank"));
    expect(s.guard.spent).toEqual([]);
  });

  it("a payee looked up at Airwallex is recorded with its twin; one found by an earlier action is not recorded twice", async () => {
    const s = setup();
    const made = await s.rail.within("airwallex", () => s.rail.createPayoutBeneficiary(payee));
    const firstTwin = s.routes.rows.get(`ben:${made.id}`)!.twin;
    expect(firstTwin).toMatch(/^ben_\d+$/);
    const found = await s.rail.within("airwallex", () => s.rail.findPayoutBeneficiary(payee));
    expect(found).toEqual({ id: made.id });
    expect(s.routes.rows.get(`ben:${made.id}`)!.twin).toBe(firstTwin);
    // A payee Airwallex has that this rail never recorded (made before, elsewhere): recorded now, with a twin.
    s.routes.rows.delete(`ben:${made.id}`);
    await s.rail.within("airwallex", () => s.rail.findPayoutBeneficiary(payee));
    expect(s.routes.rows.get(`ben:${made.id}`)).toEqual({ bank: "airwallex", twin: firstTwin });
  });

  it("when Airwallex fails a look-up, the look-up and the create both go to the simulated bank, labelled", async () => {
    const s = setup();
    s.awx.fail.next = http(503);
    const made = await s.rail.within("airwallex", async () => {
      expect(await s.rail.findPayoutBeneficiary(payee)).toBeUndefined();
      const m = await s.rail.createPayoutBeneficiary(payee);
      expect(s.rail.failure).toBe("Airwallex answered HTTP 503 (trace trace-1)");
      return m;
    });
    expect(made.id).toMatch(/^ben_\d+$/);
    expect(s.awx.calls).toEqual([`findPayoutBeneficiary ${payee.name}`]);
    expect(s.fallbacks).toEqual([`looking up ${payee.name}: Airwallex answered HTTP 503 (trace trace-1)`]);
    expect(s.routes.rows.get(`ben:${made.id}`)).toEqual({ bank: "simulated", twin: null });
  });

  it("a create that fails at Airwallex is made at the simulated bank instead, but a lost answer is never made twice", async () => {
    const s = setup();
    s.awx.fail.next = new GatewayRefused("payee writes are off");
    const made = await s.rail.within("airwallex", () => s.rail.createPayoutBeneficiary(payee));
    expect(made.id).toMatch(/^ben_\d+$/);
    expect(s.fallbacks).toEqual([`adding ${payee.name}: Airwallex gateway refused: payee writes are off`]);

    const lost = new AirwallexAmbiguous("/api/v1/beneficiaries/create", new Error("timeout"));
    s.awx.fail.next = lost;
    await s.rail.within("airwallex", () => expect(s.rail.createPayoutBeneficiary({ ...payee, name: "Other GmbH" })).rejects.toBe(lost));
    expect(s.sim.calls.filter((c) => c === "createPayoutBeneficiary Other GmbH")).toEqual([]);
  });

  it("Airwallex switched off: a payee is added at the simulated bank, labelled with the switch's reason", async () => {
    const s = setup({ blocked: "outside the sandbox's hours" });
    const made = await s.rail.within("airwallex", () => s.rail.createPayoutBeneficiary(payee));
    expect(made.id).toMatch(/^ben_\d+$/);
    expect(s.fallbacks).toEqual([`adding ${payee.name}: outside the sandbox's hours`]);
    expect(s.awx.calls).toEqual([]);
  });
});

describe("the USD account and deposits", () => {
  it("at Airwallex a deposit is spoken for in USD under its reference, into the account named", async () => {
    const s = setup();
    const d = await s.rail.within("airwallex", async () => {
      expect(await s.rail.usdGlobalAccountId()).toBe("airwallex-usd-account");
      return s.rail.simulateDeposit({ globalAccountId: "airwallex-usd-account", amountCents: 2_500, reference: "SWEEP-7", payerName: "Treasury" });
    });
    expect(s.guard.spent).toEqual([{ key: "dep:SWEEP-7", kind: "deposit", currency: "USD", cents: 2_500 }]);
    expect(s.awx.calls).toContain("deposit 2500 into airwallex-usd-account");
    expect(s.routes.rows.get(`dep:${d.id}`)?.bank).toBe("airwallex");
  });

  it("when Airwallex fails, the deposit lands in the simulated bank's own account, labelled", async () => {
    const s = setup();
    s.awx.fail.next = http(400, "validation_failed");
    const d = await s.rail.within("airwallex", () => s.rail.simulateDeposit({ globalAccountId: "airwallex-usd-account", amountCents: 900, reference: "SWEEP-8", payerName: "Treasury" }));
    expect(d.id).toMatch(/^dep_\d+$/);
    expect(s.sim.calls).toContain("deposit 900 into simulated-usd-account");
    expect(s.fallbacks).toEqual(["the deposit: Airwallex answered HTTP 400 validation_failed (trace trace-1)"]);
    // Spoken for, then freed: Airwallex refused it outright.
    expect(s.guard.released).toEqual(["dep:SWEEP-8"]);
  });

  it("the USD account falls back to the simulated bank's when Airwallex fails", async () => {
    const s = setup();
    s.awx.fail.next = http(500);
    expect(await s.rail.within("airwallex", () => s.rail.usdGlobalAccountId())).toBe("simulated-usd-account");
    expect(s.fallbacks).toEqual(["the USD account: Airwallex answered HTTP 500 (trace trace-1)"]);
  });
});

describe("one batch transfer: Airwallex only, every line checked before any is spoken for", () => {
  function batchRail(o: { addFails?: unknown } = {}) {
    const calls: string[] = [];
    const batch = { id: "batch-1", requestId: "breq-1", status: "DRAFTING", shortReference: null, totalItemCount: 0, validItemCount: 0, metadata: {}, quotes: [], quoteExpiresAt: null } as AwxBatch;
    const items: AwxBatchItem[] = [];
    const rail: BatchTransferRail = {
      payingAccount: "acct-connected",
      createBatch: async () => { calls.push("create"); return batch; },
      findBatchByRequestId: async () => { calls.push("find"); return batch; },
      getBatch: async () => { calls.push("get"); return batch; },
      addItems: async (_id, add) => {
        calls.push(`add ${add.length}`);
        if (o.addFails) throw o.addFails;
        for (const i of add) items.push({ id: `item-${i.requestId}`, requestId: i.requestId, status: "VALID", transferId: null, errors: [], draft: null } as AwxBatchItem);
        return batch;
      },
      quoteBatch: async () => { calls.push("quote"); return batch; },
      listItems: async () => { calls.push("list"); return items; },
      submitBatch: async () => { calls.push("submit"); return batch; },
      deleteBatch: async () => { calls.push("delete"); },
    };
    return { rail, calls };
  }
  const line = (requestId: string, beneficiaryId: string, currency = "EUR", amountCents = 1_000): BatchItemIn => ({ requestId, beneficiaryId, amountCents, currency, sourceCurrency: currency, method: "SWIFT", reference: "B-1", reason: "goods", metadata: {} });

  it("is offered only for an action at Airwallex with a batch rail", async () => {
    expect(setup({ batches: batchRail().rail }).rail.batches).toBeUndefined();
    const none = setup();
    await none.rail.within("airwallex", async () => { expect(none.rail.batches).toBeUndefined(); });
    const s = setup({ batches: batchRail().rail });
    await s.rail.within("airwallex", async () => {
      const b = s.rail.batches!;
      expect(b.payingAccount).toBe("acct-connected");
      await b.createBatch({ requestId: "breq-1", name: "Friday", metadata: {} });
      await b.findBatchByRequestId("breq-1"); await b.getBatch("batch-1"); await b.quoteBatch("batch-1", "MIN_15"); await b.submitBatch("batch-1");
    });
  });

  it("refuses the whole set before speaking for any line when one line is in another currency or to a simulated payee", async () => {
    const br = batchRail();
    const s = setup({ batches: br.rail });
    s.routes.set("ben:AWX-1", { bank: "airwallex", twin: "ben_1" });
    await s.rail.within("airwallex", async () => {
      const b = s.rail.batches!;
      await expect(b.addItems("batch-1", [line("l1", "AWX-1"), line("l2", "AWX-1", "CHF")])).rejects.toThrow("CHF is not moved at the Airwallex sandbox from Cloud");
      await expect(b.addItems("batch-1", [line("l1", "AWX-1"), line("l3", "ben_9")])).rejects.toThrow("the payee ben_9 is not at the Airwallex sandbox");
    });
    expect(s.guard.spent).toEqual([]);
    expect(br.calls.filter((c) => c.startsWith("add"))).toEqual([]);
  });

  it("speaks for every line, records it at Airwallex, and frees all of them on an outright refusal only", async () => {
    const refused = batchRail({ addFails: http(422, "invalid_items") });
    const s = setup({ batches: refused.rail });
    s.routes.set("ben:AWX-1", { bank: "airwallex", twin: null });
    await s.rail.within("airwallex", () => expect(s.rail.batches!.addItems("batch-1", [line("l1", "AWX-1"), line("l2", "AWX-1", "USD", 2_000)])).rejects.toBeInstanceOf(AirwallexError));
    expect(s.guard.spent).toEqual([{ key: "l1", kind: "batch_item", currency: "EUR", cents: 1_000 }, { key: "l2", kind: "batch_item", currency: "USD", cents: 2_000 }]);
    expect(s.guard.released).toEqual(["l1", "l2"]);
    expect(s.routes.rows.get("req:l1")?.bank).toBe("airwallex");

    const lost = batchRail({ addFails: new AirwallexAmbiguous("/batch_transfers/add_items", null) });
    const t = setup({ batches: lost.rail });
    t.routes.set("ben:AWX-1", { bank: "airwallex", twin: null });
    await t.rail.within("airwallex", () => expect(t.rail.batches!.addItems("batch-1", [line("l1", "AWX-1")])).rejects.toBeInstanceOf(AirwallexAmbiguous));
    expect(t.guard.released).toEqual([]);
  });

  it("a batch deleted before submit frees each of its lines; a list that fails frees none", async () => {
    const br = batchRail();
    const s = setup({ batches: br.rail });
    s.routes.set("ben:AWX-1", { bank: "airwallex", twin: null });
    await s.rail.within("airwallex", async () => {
      await s.rail.batches!.addItems("batch-1", [line("l1", "AWX-1"), line("l2", "AWX-1")]);
      await s.rail.batches!.deleteBatch("batch-1");
    });
    expect(br.calls).toEqual(["add 2", "list", "delete"]);
    expect(s.guard.released).toEqual(["l1", "l2"]);

    const noList = batchRail();
    noList.rail.listItems = async () => { throw new Error("list failed"); };
    const t = setup({ batches: noList.rail });
    await t.rail.within("airwallex", () => t.rail.batches!.deleteBatch("batch-1"));
    expect(noList.calls).toEqual(["delete"]);
    expect(t.guard.released).toEqual([]);
  });

  it("every batch call is refused while Airwallex is switched off", async () => {
    const br = batchRail();
    const s = setup({ batches: br.rail });
    await s.rail.within("airwallex", async () => {
      s.guard.g.blockedNow = "the global daily cap is used up";
      const b = s.rail.batches!;
      for (const call of [() => b.createBatch({ requestId: "r", name: "n", metadata: {} }), () => b.findBatchByRequestId("r"), () => b.getBatch("x"), () => b.addItems("x", []), () => b.quoteBatch("x", "MIN_1"), () => b.listItems("x"), () => b.submitBatch("x"), () => b.deleteBatch("x")]) {
        await expect(call()).rejects.toThrow("Airwallex sandbox not used: the global daily cap is used up");
      }
    });
    expect(br.calls).toEqual([]);
  });
});

describe("words for an Airwallex-side failure", () => {
  it("names the switch, the cap, the code and trace, a lost answer or the gateway's reason; never Airwallex's own words", () => {
    expect(failureWords(new ActOff("switched off"))).toBe("switched off");
    expect(failureWords(new ActCapReached("cap of 500.00 EUR reached"))).toBe("cap of 500.00 EUR reached");
    expect(failureWords(http(403, "forbidden"))).toBe("Airwallex answered HTTP 403 forbidden (trace trace-1)");
    expect(failureWords(new AirwallexError(500, undefined, null, "/x"))).toBe("Airwallex answered HTTP 500");
    expect(failureWords(new AirwallexAmbiguous("/x", null))).toBe("Airwallex gave no answer");
    expect(failureWords(new GatewayRefused("writes are off"))).toBe("Airwallex gateway refused: writes are off");
    expect(failureWords(new Error("x".repeat(300)))).toHaveLength(200);
    expect(failureWords("a bare string")).toBe("a bare string");
  });

  it("tells an outright refusal from one where money may have moved", () => {
    expect(refusedOutright(http(400, "invalid_argument"))).toBe(true);
    expect(refusedOutright(new AirwallexError(404, undefined, null, "/x"))).toBe(true);
    for (const code of ["duplicate_request_id", "request_id_duplicate", "duplicate_request"]) expect(refusedOutright(http(400, code))).toBe(false);
    expect(refusedOutright(http(500))).toBe(false);
    expect(refusedOutright(new AirwallexAmbiguous("/x", null))).toBe(false);
    expect(refusedOutright(new Error("400"))).toBe(false);
  });

  it("knows which errors came from the Airwallex side", () => {
    for (const e of [new ActOff("x"), new ActCapReached("x"), http(400), new AirwallexAmbiguous("/x", null), new GatewayRefused("x")]) expect(fromAirwallexSide(e)).toBe(true);
    expect(fromAirwallexSide(new Error("ledger locked"))).toBe(false);
    expect(fromAirwallexSide(null)).toBe(false);
  });
});
