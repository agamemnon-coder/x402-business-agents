// A model-based fuzz of the engine's approval state machine (v1.5.4): the per-company engine (src/engine/host.ts, the
// class the Durable Object in cloud/src/engine/object.ts runs) driven directly, in process, by random sequences of
// actions: invoices filed and proposed, approvals with a valid or a bad passkey, twice, by a second person, by the same
// person under another key and name (in its cooling-off and after it), the emergency stop pulled and lifted (a policy
// change under segregation of duties), the clock moved past expiry, the bank losing an answer, a retry, a negotiation
// that supersedes an invoice and the original filed after it, and a rejected hold. After every step a small reference
// model checks what must always hold: no payout without the approvals its terms need (four eyes by two different
// people), none while the stop is on, none after expiry or rejection, one per proposal and one live payout per bill,
// each for exactly the signed amount, a stop flipped only by an authorised change its proposer did not approve, and an
// audit chain that verifies. Seeded, so CI repeats the same runs. Test money only: the stand-in bank (FakeAirwallex),
// the parser reads, the passkeys are software; nothing reaches the network.
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useDocStore, type DocStore } from "../src/ap/docStore.js";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { standInBank } from "../src/engine/standInBank.js";
import { toCents } from "../src/lib/money.js";
import { sha256Hex } from "../src/lib/terms.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { stopState } from "../src/policy/emergencyStop.js";
import type { FakeAirwallex } from "../src/redteam/airwallex.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { pdfOf } from "./fakes/pdf.js";

const RP = "fuzz.example.invalid", ORIGIN = `https://${RP}`;
const T0 = Date.parse("2026-11-10T09:00:00Z");
const MINUTE = 60_000;
/** The CFO's thresholds in this company: four eyes on a payment above EUR 1,000, and on loosening the policy (lifting the stop). */
const FOUR_EYES_CENTS = 100_000;
/** The second key of Carla's (another name, the same person): cooling off this long after it is added. */
const A2_COOLING_MS = 10 * MINUTE;

// The agreement whose SHA-256 starts with eight digits, so the agreed invoice's number reads back the same in any case.
const AGREEMENT = "purser fuzz agreement 42";
const AGREEMENT_SHA = sha256Hex(AGREEMENT);
const SHA8 = AGREEMENT_SHA.slice(0, 8);

/** The invoices a run may file: four bills from the supplier on file, and the agreed replacement of the first. */
const POOL = [
  { no: "BTX-2026-41", total: "1850.00" },
  { no: "BTX-2026-42", total: "640.00" },
  { no: "BTX-2026-43", total: "1210.00" },
  { no: "BTX-2026-44", total: "395.00" },
  { no: `BTX-2026-41-${SHA8}`, total: "1700.00" },
] as const;
const REPLACEMENT = 4;
const billOf = (invoiceNo: string) => invoiceNo.toUpperCase().replace(/-\d{8}$/, "");

const eur = (cents: number) => `EUR ${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
function invoiceText(no: string, total: string): string {
  const t = toCents(total), sub = Math.round(t / 1.19);
  return [
    "Bergtex Textil GmbH", "Textilweg 4, 72760 Reutlingen", "VAT ID: DE123456789", `INVOICE ${no}`,
    "Invoice date: 2 November 2026", "Due date: 30 November 2026",
    `Subtotal ${eur(sub)}`, `VAT 19% ${eur(t - sub)}`, `Total due ${eur(t)}`,
    "IBAN: DE89 3704 0044 0532 0130 00", "BIC: COBADEFFXXX", `Payment reference: ${no}`,
  ].join("\n");
}

function memoryDocs(): DocStore {
  const kept = new Map<string, Buffer>();
  return {
    put: (sha, bytes) => { if (!kept.has(`mem:${sha}`)) kept.set(`mem:${sha}`, Buffer.from(bytes)); return `mem:${sha}`; },
    get: (path) => { const b = kept.get(path); if (!b) throw new Error(`no document at ${path}`); return b; },
  };
}

// ---- The actions ----

type Key = "A" | "B" | "A2" | "X";
type Op =
  | { op: "upload"; i: number }
  | { op: "propose"; i: number }
  | { op: "approve"; p: number; key: Key; mode: "ok" | "other_terms" | "wrong_sha" }
  | { op: "stop"; on: boolean; as: "A" | "B" | "A2" }
  | { op: "tick"; minutes: number }
  | { op: "retry"; p: number }
  | { op: "hiccup" }
  | { op: "negotiate"; withOriginal: boolean }
  | { op: "reject"; i: number }
  | { op: "sync" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ op: fc.constant("upload" as const), i: fc.nat(3) }) },
  { weight: 5, arbitrary: fc.record({ op: fc.constant("propose" as const), i: fc.nat(3) }) },
  {
    weight: 12,
    arbitrary: fc.record({
      op: fc.constant("approve" as const), p: fc.nat(7),
      key: fc.constantFrom<Key>("A", "A", "B", "B", "A2", "A2", "X"),
      mode: fc.constantFrom("ok" as const, "ok" as const, "ok" as const, "other_terms" as const, "wrong_sha" as const),
    }),
  },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("stop" as const), on: fc.boolean(), as: fc.constantFrom("A" as const, "B" as const, "A2" as const) }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("tick" as const), minutes: fc.constantFrom(2, 2, 6, 90, 30 * 60, 200 * 60) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("retry" as const), p: fc.nat(7) }) },
  { weight: 1, arbitrary: fc.constant({ op: "hiccup" as const }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("negotiate" as const), withOriginal: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("reject" as const), i: fc.nat(3) }) },
  { weight: 1, arbitrary: fc.constant({ op: "sync" as const }) },
);

// ---- The world and its reference model ----

interface Person { label: string; person: string; phone: FakeAuthenticator; counter: number; coolingUntil: number }
interface Proposal { proposal_id: string; kind: string; status: string; terms_json: string; terms_sha256: string; expires_at: string }

class World {
  now = T0;
  readonly db: DB;
  readonly bank: FakeAirwallex;
  readonly host: EngineHost;
  readonly keys: Record<Key, Person>;
  /** Invoice ids by pool index, once filed. */
  readonly filed = new Map<number, string>();
  // The model: who validly approved what, by the Cloud's person id; the stop's proposals and their proposers; what was rejected.
  readonly approvers = new Map<string, Set<string>>();
  readonly stops = new Map<string, { on: boolean; proposer: string | null }>();
  readonly rejected = new Set<string>();
  seenTransfers = 0;
  readonly log: string[] = [];

  constructor() {
    // Some of the engine reads the system clock, not the host's: both stay on the run's own clock.
    vi.setSystemTime(this.now);
    this.db = openDb(":memory:");
    useDocStore(this.db, memoryDocs());
    const store = { text: null as string | null, load() { return this.text; }, save(text: string) { this.text = text; } };
    this.bank = standInBank(store);
    this.host = new EngineHost({ db: this.db, reader: parserOnly, rails: { rail: this.bank, sim: this.bank }, rp: { rpId: RP, origin: ORIGIN }, company: { name: "Fuzz Co", lang: "en" }, vault: null, feed: null, now: () => new Date(this.now) });
    const p = (label: string, person: string): Person => ({ label, person, phone: new FakeAuthenticator(), counter: 0, coolingUntil: 0 });
    // Carla twice (her second key under another name), Dirk, and a stranger whose key was never enrolled.
    this.keys = { A: p("Carla CFO", "user-carla"), B: p("Dirk Owner", "user-dirk"), A2: p("C. Lindqvist", "user-carla"), X: p("Mallory", "user-mallory") };
  }

  async setUp(): Promise<void> {
    await this.host.seed();
    await this.enrol("A");
    await this.enrol("B", { cosigned: { by: "Carla CFO" }, coolingOffMs: 0 });
    await this.enrol("A2", { cosigned: { by: "Dirk Owner" }, coolingOffMs: A2_COOLING_MS });
    this.keys.A2.coolingUntil = this.now + A2_COOLING_MS;
    // The CFO's thresholds: four eyes on payments, and segregation of duties on loosening the policy.
    for (const [key, value] of [["approval.four_eyes_eur", "1000.00"], ["approval.policy_sod_eur", "1000.00"]] as const) {
      this.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(key, value, new Date(this.now).toISOString());
    }
  }

  private async enrol(k: Key, more: { cosigned?: { by: string }; coolingOffMs?: number } = {}): Promise<void> {
    const who = this.keys[k];
    const start = await this.host.passkeyStart();
    const done = await this.host.passkeyFinish({ code: start.code, credential: who.phone.register({ challenge: start.challenge, origin: ORIGIN, rpId: RP }), label: who.label, person: who.person, ...more });
    if (!done.ok) throw new Error(`enrolling ${k}: ${done.reason}`);
  }

  proposals(): Proposal[] {
    return this.db.prepare("SELECT proposal_id, kind, status, terms_json, terms_sha256, expires_at FROM proposals ORDER BY rowid").all() as Proposal[];
  }
  private proposalRow(id: string): Proposal | undefined {
    return this.db.prepare("SELECT proposal_id, kind, status, terms_json, terms_sha256, expires_at FROM proposals WHERE proposal_id = ?").get(id) as Proposal | undefined;
  }
  private signedExpiry(p: Proposal): number {
    const t = JSON.parse(p.terms_json) as { expires_at?: unknown };
    const inTerms = typeof t.expires_at === "string" ? Date.parse(t.expires_at) : Infinity;
    return Math.min(inTerms, Date.parse(p.expires_at));
  }
  /** How many different people must approve these terms: two above the four-eyes threshold, or to loosen the policy. */
  private required(p: Proposal): number {
    if (p.kind === "invoice_payment") return toCents(String((JSON.parse(p.terms_json) as { amount: unknown }).amount)) > FOUR_EYES_CENTS ? 2 : 1;
    const stop = this.stops.get(p.proposal_id);
    if (stop) return stop.on ? 1 : 2;
    return Infinity; // nothing else is filed in these runs
  }
  private authorised(p: Proposal): boolean {
    return (this.approvers.get(p.proposal_id)?.size ?? 0) >= this.required(p);
  }

  /** Files a bill not filed yet, the i-th of those (the agreed replacement comes with a negotiation). */
  private async fileBill(n: number): Promise<void> {
    const open = POOL.map((_, i) => i).filter((i) => i !== REPLACEMENT && !this.filed.has(i));
    if (!open.length) return;
    const i = open[n % open.length]!;
    const up = await this.host.upload({ bytes: PDFS[i]!, filename: `${POOL[i]!.no}.pdf` });
    if (up.invoice) this.filed.set(i, up.invoice.id);
  }

  /** Applies one action, updating the model first with what the action should count for. */
  async apply(o: Op): Promise<void> {
    this.log.push(JSON.stringify(o));
    switch (o.op) {
      case "upload":
        await this.fileBill(o.i);
        return;
      case "propose": {
        // A filed invoice ready to pay, the i-th of those; none, the next bill is filed first; still none, any filed one not
        // waiting for the CFO (paid, held, rejected), which the engine must refuse.
        const ready = () => [...this.filed.values()].filter((id) => this.host.invoice(id)?.status === "ready");
        let ids = ready();
        if (!ids.length) { await this.fileBill(o.i); ids = ready(); }
        if (!ids.length) ids = [...this.filed.values()].filter((id) => this.host.invoice(id)?.status !== "waiting_cfo");
        if (ids.length) await this.host.propose(ids[o.i % ids.length]!);
        return;
      }
      case "approve": {
        // Mostly a proposal still waiting; now and then any proposal (approving one that ran, expired or was superseded).
        const all = this.proposals();
        const waiting = all.filter((p) => p.status === "PENDING_APPROVAL");
        const from = waiting.length && o.p < 6 ? waiting : all;
        if (!from.length) return;
        const p = from[o.p % from.length]!;
        const who = this.keys[o.key];
        const challenge = o.mode === "other_terms" ? challengeFor(sha256Hex(`other terms ${who.counter}`)) : challengeFor(p.terms_sha256);
        const credential = who.phone.sign({ challenge, origin: ORIGIN, rpId: RP, counter: ++who.counter });
        // The model: this approval counts only for an enrolled key out of its cooling-off, signing the terms on screen,
        // on a proposal still waiting and not expired, and (a policy change) by someone other than its proposer.
        const counts = o.key !== "X" && o.mode === "ok" && this.now >= who.coolingUntil && p.status === "PENDING_APPROVAL" && this.now < this.signedExpiry(p)
          && this.stops.get(p.proposal_id)?.proposer !== who.person;
        if (counts) {
          const set = this.approvers.get(p.proposal_id) ?? new Set<string>();
          set.add(who.person);
          this.approvers.set(p.proposal_id, set);
        }
        const ans = await this.host.approve({ proposal_id: p.proposal_id, terms_sha256: o.mode === "wrong_sha" ? sha256Hex("not the terms") : p.terms_sha256, credential });
        this.log.push(`  = ${p.proposal_id} ${p.kind} ${ans.status}: ${ans.message.slice(0, 160)} ${ans.settled?.error ?? ""}`);
        return;
      }
      case "stop": {
        const who = this.keys[o.as];
        const out = await this.host.emergencyStop(o.on, who.label, who.person);
        if (out.ok) {
          const terms = JSON.parse(this.proposalRow(out.proposal.id)!.terms_json) as { proposed_by_id?: string };
          this.stops.set(out.proposal.id, { on: o.on, proposer: terms.proposed_by_id ?? null });
        }
        return;
      }
      case "tick":
        this.now += o.minutes * MINUTE;
        vi.setSystemTime(this.now);
        return;
      case "retry": {
        const all = this.proposals();
        if (all.length) await this.host.retry(all[o.p % all.length]!.proposal_id);
        return;
      }
      case "hiccup":
        this.bank.loseNextTransferAnswer = true;
        return;
      case "negotiate": {
        let replacement = this.filed.get(REPLACEMENT);
        if (!replacement) {
          const up = await this.host.upload({ bytes: PDFS[REPLACEMENT]!, filename: `${POOL[REPLACEMENT].no}.pdf` });
          if (!up.invoice) return;
          this.filed.set(REPLACEMENT, replacement = up.invoice.id);
        }
        const original = o.withOriginal ? this.filed.get(0) ?? null : null;
        await this.host.negotiated(replacement, { original_id: original, original_invoice_no: POOL[0].no, original_amount: POOL[0].total, agreement_sha256: AGREEMENT_SHA, turns: 3, agreement: AGREEMENT });
        return;
      }
      case "reject": {
        const id = this.filed.get(o.i);
        if (!id) return;
        const before = this.host.invoice(id);
        const out = await this.host.rejectHold(id);
        if (out.ok && out.invoice.status === "rejected" && before?.proposal) this.rejected.add(before.proposal.id);
        return;
      }
      case "sync":
        await this.host.sync();
        return;
    }
  }

  /** What must hold after every step. `stopWasOn`: the emergency stop as it stood before the step. */
  check(stopWasOn: boolean, stopBefore: string | null): void {
    const db = this.db;
    const props = this.proposals();
    const byRequest = new Map<string, Proposal>();
    for (const p of props) {
      const rid = (JSON.parse(p.terms_json) as { transfer_request_id?: unknown }).transfer_request_id;
      if (typeof rid === "string") byRequest.set(rid, p);
    }
    const why = (s: string) => `${s}\n  after: ${this.log.join(" -> ")}`;

    // Each payout the bank made since the last step: for a proposal that had every approval its terms need, while the
    // stop was off, before its signed expiry, never rejected, for exactly the signed amount.
    for (const tr of this.bank.transfers.slice(this.seenTransfers)) {
      const p = byRequest.get(tr.requestId);
      expect(p, why(`payout ${tr.id} names no proposal`)).toBeDefined();
      if (!p) continue;
      expect(p.kind, why(`payout ${tr.id}`)).toBe("invoice_payment");
      expect(this.authorised(p), why(`${p.proposal_id} paid with the approvals of ${[...(this.approvers.get(p.proposal_id) ?? [])].join(", ") || "nobody"}; it needs ${this.required(p)} people`)).toBe(true);
      expect(stopWasOn, why(`${p.proposal_id} paid while the emergency stop was on`)).toBe(false);
      expect(this.now < this.signedExpiry(p), why(`${p.proposal_id} paid after its signed expiry`)).toBe(true);
      expect(this.rejected.has(p.proposal_id), why(`${p.proposal_id} paid after it was rejected`)).toBe(false);
    }
    this.seenTransfers = this.bank.transfers.length;

    // Every payout, ever: one per proposal, one live per bill, each for the signed amount, approved over the stored terms.
    const perProposal = new Map<string, number>(), perBill = new Map<string, string[]>();
    for (const tr of this.bank.transfers) {
      const p = byRequest.get(tr.requestId)!;
      perProposal.set(p.proposal_id, (perProposal.get(p.proposal_id) ?? 0) + 1);
      const terms = JSON.parse(p.terms_json) as { amount: string; currency: string; invoice_no: string };
      expect(tr.amountCents, why(`${p.proposal_id}: payout amount`)).toBe(toCents(terms.amount));
      expect(tr.currency, why(`${p.proposal_id}: payout currency`)).toBe(terms.currency);
      expect(tr.metadata, why(`${p.proposal_id}: the payout carries the signed hash`)).toBe(p.terms_sha256);
      const approved = db.prepare("SELECT approved_sha256 FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(p.proposal_id) as { approved_sha256: string } | undefined;
      expect(approved?.approved_sha256, why(`${p.proposal_id}: approved over its stored terms`)).toBe(p.terms_sha256);
      expect(["EXPIRED", "REJECTED", "SUPERSEDED", "PENDING_APPROVAL"], why(`${p.proposal_id} is ${p.status} with a payout`)).not.toContain(p.status);
      if (!["FAILED", "CANCELLED", "REVERSED"].includes(String(tr.status))) {
        const bill = billOf(terms.invoice_no);
        perBill.set(bill, [...(perBill.get(bill) ?? []), p.proposal_id]);
      }
    }
    for (const [id, n] of perProposal) expect(n, why(`${id} paid ${n} times`)).toBe(1);
    for (const [bill, ids] of perBill) expect(ids.length, why(`bill ${bill} paid by ${ids.join(", ")}`)).toBe(1);

    // The stop changes only by a change that had its approvals, none of them its proposer's.
    const stop = stopState(db);
    if (stop.proposal_id !== stopBefore) {
      const p = props.find((x) => x.proposal_id === stop.proposal_id);
      const s = stop.proposal_id ? this.stops.get(stop.proposal_id) : undefined;
      expect(p && s, why(`the stop changed by ${stop.proposal_id}, which no stop action filed`)).toBeTruthy();
      if (p && s) {
        expect(s.on, why(`${p.proposal_id} set the stop the other way`)).toBe(stopSetting(db));
        expect(this.authorised(p), why(`${p.proposal_id} changed the stop with the approvals of ${[...(this.approvers.get(p.proposal_id) ?? [])].join(", ") || "nobody"}`)).toBe(true);
        expect(s.proposer === null || !this.approvers.get(p.proposal_id)?.has(s.proposer), why(`${p.proposal_id} counted its proposer`)).toBe(true);
      }
    }

    expect(verifyAuditChain(db).ok, why("the audit chain no longer verifies")).toBe(true);
  }
}

let PDFS: Buffer[] = [];
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  PDFS = await Promise.all(POOL.map((x) => pdfOf(invoiceText(x.no, x.total))));
});
afterAll(() => { vi.useRealTimers(); });

/** The stop as the CFO policy's own row says it, read here rather than through the engine's frozen(). */
const stopSetting = (db: DB): boolean => (db.prepare("SELECT value FROM settings WHERE key = 'freeze'").get() as { value: string } | undefined)?.value === "on";

/** What the random runs reached, so a run that never pays cannot pass for one that holds (checked after the property). */
const reached = { runs: 0, paid: 0, fourEyesPaid: 0, stopChanged: 0, negotiated: 0, expired: 0 };

async function run(ops: Op[]): Promise<World> {
  const w = new World();
  await w.setUp();
  for (const o of ops) {
    const stopWasOn = stopSetting(w.db), stopBy = stopState(w.db).proposal_id;
    await w.apply(o);
    w.check(stopWasOn, stopBy);
  }
  const ev = (e: string) => (w.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?").get(e) as { n: number }).n > 0;
  reached.runs++;
  if (w.bank.transfers.length) reached.paid++;
  if (w.bank.transfers.some((t) => t.amountCents > FOUR_EYES_CENTS)) reached.fourEyesPaid++;
  if (ev("policy.changed")) reached.stopChanged++;
  if (ev("ap.negotiated")) reached.negotiated++;
  if (ev("proposal.expired")) reached.expired++;
  return w;
}

describe("the engine's approval state machine, fuzzed against a reference model", () => {
  it("the harness files, proposes and pays an invoice on the CFO's passkey, and four eyes on one above EUR 1,000", async () => {
    const w = await run([
      { op: "upload", i: 1 }, { op: "propose", i: 0 }, { op: "approve", p: 0, key: "A", mode: "ok" },
      { op: "upload", i: 0 }, { op: "propose", i: 0 }, { op: "approve", p: 1, key: "A", mode: "ok" }, { op: "approve", p: 1, key: "B", mode: "ok" },
    ]);
    expect(w.filed.size).toBe(2);
    expect(w.proposals().map((p) => p.status)).toEqual(["EXECUTED", "EXECUTED"]);
    expect(w.bank.transfers.map((t) => t.amountCents)).toEqual([64_000, 185_000]);
  });

  // Seeded: CI runs the same 100 sequences every time. A failure prints the shrunk sequence and the step it broke at.
  it("holds every invariant over random sequences of actions", async () => {
    await fc.assert(fc.asyncProperty(fc.array(opArb, { minLength: 6, maxLength: 20, size: "max" }), async (ops) => { await run(ops); }), { seed: 1540, numRuns: 100 });
    expect(reached.paid, JSON.stringify(reached)).toBeGreaterThanOrEqual(10);
    expect(reached.fourEyesPaid, JSON.stringify(reached)).toBeGreaterThanOrEqual(1);
    expect(reached.stopChanged, JSON.stringify(reached)).toBeGreaterThanOrEqual(3);
    expect(reached.negotiated, JSON.stringify(reached)).toBeGreaterThanOrEqual(3);
  }, 300_000);
});

describe("regressions the fuzz found", () => {
  // Fuzz finding 1 (v1.5.4): four eyes counted people by their keys' labels. One person with two approval keys under two
  // names (a display name changed between enrolments; the second key vouched for and out of its cooling-off) approved a
  // payment above the four-eyes threshold alone. The host knows whose each key is (passkeyFinish's person) and refused a
  // second key of the same person only on a policy change. Shrunk from the seeded run.
  it("the same person's second key, under another name, is not the second person of four eyes", async () => {
    const w = new World();
    await w.setUp();
    await w.apply({ op: "tick", minutes: 12 }); // A2's cooling-off is over
    await w.apply({ op: "propose", i: 0 }); // files and proposes BTX-2026-41, EUR 1,850.00: four eyes
    const p = w.proposals()[0]!;
    const sign = (k: Key) => { const who = w.keys[k]; return w.host.approve({ proposal_id: p.proposal_id, terms_sha256: p.terms_sha256, credential: who.phone.sign({ challenge: challengeFor(p.terms_sha256), origin: ORIGIN, rpId: RP, counter: ++who.counter }) }); };
    expect((await sign("A")).status).toBe("cosigned");
    const again = await sign("A2");
    expect(again).toMatchObject({ status: "refused", settled: null });
    expect(again.message).toMatch(/already approved P-0001 with another key; a second person must approve it/);
    expect(w.proposals()[0]!.status).toBe("PENDING_APPROVAL");
    expect(w.bank.transfers).toHaveLength(0);
    // Dirk is the second person.
    expect((await sign("B")).status).toBe("approved");
    expect(w.bank.transfers.map((t) => t.amountCents)).toEqual([185_000]);
  });
});
