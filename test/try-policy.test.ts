// /try/sign, step 0 "Set the policy" (Max, item 1 of the last round): the visitor changes one value of the test world's
// CFO policy. A stricter policy applies at once; a looser one only with the visitor's passkey signature over the SHA-256
// of the exact terms of the change, checked by the Worker as the payment signatures are. Field by field (Max's rules):
// looser is a higher limit per purchase or per month, more merchant categories or currencies, a later end date, a lower
// reserve floor, or a higher "may pay alone up to"; the opposite is stricter; one looser field makes the whole change
// need a signature. Out-of-bounds input is refused and leaves the policy as it was. After a change the world's
// proposals follow the new policy. Nothing is sent anywhere: no fetch during any of it.
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { POLICY_MAX_CENTS, type Field, type PolicySet, type WorldPolicy } from "../src/try/policy.js";
import { PAID_ALONE, TRY_SIGN_PER_MINUTE } from "../worker/src/trySign.js";
import { StandInQuotes } from "./support/fxStandIn.js";
import { BASE, call, challengeOf, desk, RP, signBody, t0, withPasskey, type Proposal } from "./support/trySign.js";

afterEach(() => { vi.restoreAllMocks(); });

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
type Agent = "sourcing" | "support" | "treasury";
interface PolicyAnswer {
  applied: boolean; needs_signature?: boolean; looser?: Field[]; reason?: string; paid_alone?: string[]; why?: string; verified?: boolean; error?: string;
  canonical?: string; terms_sha256?: string; policy: WorldPolicy; policy_version: string; proposals: Proposal[];
  proposed?: Record<string, unknown>; locks: Record<Agent, unknown>; world: { balance: string; reserve_floor: string; alone_limit: string };
}

/** A visitor's world with a passkey, and a way to send a change to one field (or several) of an agent's policy. */
async function visitor(fx: StandInQuotes | null = null) {
  const { d, db, at } = desk(undefined, fx);
  const { w, auth, a, b } = await withPasskey(d);
  const start = (w as unknown as { policy: WorldPolicy }).policy;
  let policy = start;
  let counter = 0;
  const setOf = (agent: Agent, patch: Partial<PolicySet>): PolicySet => ({ ...policy.agents[agent], reserve_floor: policy.reserve_floor, ...patch });
  const send = async (agent: Agent, patch: Partial<PolicySet> | Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const res = await call(d, "policy", { token: w.world.token, agent, set: setOf(agent, patch as Partial<PolicySet>), ...extra });
    const out = (await res.json()) as PolicyAnswer;
    if (res.status === 200 && out.policy) policy = out.policy;
    return { status: res.status, out };
  };
  const signed = (canonicalText: string) => auth.sign({ challenge: challengeOf(sha(canonicalText)), origin: BASE, rpId: RP, counter: ++counter });
  /** A looser change, as the page makes it: asked once, refused with its terms, then signed over exactly those terms. */
  const signedChange = async (agent: Agent, patch: Partial<PolicySet>) => {
    const first = await send(agent, patch);
    expect(first.out).toMatchObject({ applied: false, needs_signature: true });
    const second = await send(agent, patch, { canonical: first.out.canonical, credential: signed(first.out.canonical!) });
    expect(second.out).toMatchObject({ applied: true, verified: true });
    return second;
  };
  const stored = () => (db.prepare("SELECT version, json FROM ts_policy WHERE world = ?").get(w.world.id) as { version: number; json: string });
  return { d, db, at, w, auth, a, b, start, send, signed, signedChange, stored, policy: () => policy };
}

describe("the test world's policy: what the visitor sees", () => {
  it("opens with each agent's policy, from Purser's own starting values, and the three locks computed from it", async () => {
    const { w } = await visitor();
    const p = (w as unknown as { policy: WorldPolicy; policy_version: string; locks: Record<Agent, { purser: unknown; airwallex: unknown; metal: unknown }> });
    expect(p.policy_version).toBe("1");
    expect(p.policy.reserve_floor).toBe("25000.00");
    expect(p.policy.agents.treasury).toEqual({ per_tx: "25.00", monthly: "50.00", mccs: ["5734"], currencies: ["EUR"], end_date: "2027-02-02", alone: "500.00" });
    expect(p.policy.agents.support.mccs).toEqual(["7372"]);
    expect(p.policy.agents.sourcing).toMatchObject({ per_tx: "30.00", monthly: "100.00", mccs: ["5734"] });
    for (const agent of ["sourcing", "support", "treasury"] as const) expect(Object.keys(p.locks[agent]).sort()).toEqual(["airwallex", "metal", "purser"]);
  });
});

// One row per field: a looser value, a stricter one (from the value a looser change left, where the start is the floor of
// what can be taken away), and values that must be refused.
const FIELDS: { field: Field; agent: Agent; looser: unknown; stricter: unknown; stricterAfter?: unknown; bad: unknown[] }[] = [
  { field: "per_tx", agent: "treasury", looser: "30.00", stricter: "20.00", bad: ["-1.00", "abc", "NaN", "0.50", "30000.01", "99999999999.00", "1e3", "25", 25, null] },
  { field: "monthly", agent: "treasury", looser: "60.00", stricter: "40.00", bad: ["-5.00", "x", "30000.01", "Infinity", 50] },
  { field: "mccs", agent: "treasury", looser: ["5734", "7372"], stricter: ["5734"], stricterAfter: ["5734", "7372"], bad: [[], ["9999"], ["5734", "5734"], "5734", [5734], ["<b>"], ["5734", "7372", "7311", "5192", "4511", "7011", "4112", "0000"]] },
  { field: "currencies", agent: "support", looser: ["EUR", "USD"], stricter: ["EUR"], stricterAfter: ["EUR", "USD"], bad: [[], ["XXX"], ["eur"], ["EUR", "EUR"], "EUR"] },
  { field: "end_date", agent: "sourcing", looser: "2027-03-01", stricter: "2027-01-15", bad: ["2026-11-03", "2027-11-06", "2027-02-30", "tomorrow", "2027-1-15", 20270115] },
  { field: "alone", agent: "treasury", looser: "600.00", stricter: "400.00", bad: ["-1.00", "30000.01", "five", "500"] },
  { field: "reserve_floor", agent: "treasury", looser: "24000.00", stricter: "26000.00", bad: ["-1.00", "30000.01", "", "25000"] },
];

describe("field by field: looser needs a signature, stricter applies at once, out of bounds is refused", () => {
  for (const f of FIELDS) {
    it(`${f.field}: looser needs the passkey's signature`, async () => {
      const v = await visitor();
      const before = v.stored();
      const r = await v.send(f.agent, { [f.field]: f.looser });
      expect(r.status).toBe(200);
      expect(r.out).toMatchObject({ applied: false, needs_signature: true, looser: [f.field] });
      expect(r.out.reason).toMatch(/looser/i);
      expect(r.out.reason).toMatch(/sign/i);
      // Refused: the world's policy is as it was, and the answer says so.
      expect(v.stored()).toEqual(before);
      expect(r.out.policy_version).toBe("1");
      // With the signature over exactly those terms, it applies.
      const s = await v.send(f.agent, { [f.field]: f.looser }, { canonical: r.out.canonical, credential: v.signed(r.out.canonical!) });
      expect(s.out).toMatchObject({ applied: true, verified: true, policy_version: "2" });
      const now = f.field === "reserve_floor" ? s.out.policy.reserve_floor : s.out.policy.agents[f.agent][f.field as Exclude<Field, "reserve_floor">];
      expect(now).toEqual(f.looser);
    });

    it(`${f.field}: stricter applies at once, without a signature`, async () => {
      const v = await visitor();
      if (f.stricterAfter !== undefined) await v.signedChange(f.agent, { [f.field]: f.stricterAfter });
      const version = v.stored().version;
      const r = await v.send(f.agent, { [f.field]: f.stricter });
      expect(r.status).toBe(200);
      expect(r.out).toMatchObject({ applied: true });
      expect(r.out.needs_signature).toBeUndefined();
      expect(v.stored().version).toBe(version + 1);
      const now = f.field === "reserve_floor" ? r.out.policy.reserve_floor : r.out.policy.agents[f.agent][f.field as Exclude<Field, "reserve_floor">];
      expect(now).toEqual(f.stricter);
    });

    it(`${f.field}: out-of-bounds input is refused with a clear message, and the policy stays as it was`, async () => {
      const v = await visitor();
      const before = v.stored();
      for (const bad of f.bad) {
        const r = await v.send(f.agent, { [f.field]: bad });
        expect(r.status, `${f.field} = ${JSON.stringify(bad)}`).toBe(400);
        expect(r.out.error, `${f.field} = ${JSON.stringify(bad)}`).toMatch(/[A-Za-z].{10,}/);
        expect(r.out.error).not.toMatch(/undefined|NaN|\[object/);
        expect(v.stored()).toEqual(before);
      }
    });
  }

  it("refuses a set with a missing field, an unknown field, or an unknown agent", async () => {
    const v = await visitor();
    const before = v.stored();
    const full = { ...v.policy().agents.treasury, reserve_floor: v.policy().reserve_floor };
    const { per_tx: _drop, ...missing } = full;
    void _drop;
    for (const body of [
      { token: v.w.world.token, agent: "treasury", set: missing },
      { token: v.w.world.token, agent: "treasury", set: { ...full, freeze: "on" } },
      { token: v.w.world.token, agent: "cfo", set: full },
      { token: v.w.world.token, agent: "treasury", set: full, extra: 1 },
    ]) {
      expect((await call(v.d, "policy", body)).status).toBe(400);
    }
    expect(v.stored()).toEqual(before);
  });

  it("names its bounds: amounts up to the world's bound (EUR 30,000.00), limits from EUR 1.00, an end date within a year", () => {
    expect(POLICY_MAX_CENTS).toBe(3_000_000);
  });

  it("nothing changed: an answer, not an error, and the version stays", async () => {
    const v = await visitor();
    const r = await v.send("treasury", {});
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({ applied: false, why: "no_change", policy_version: "1" });
  });
});

describe("(b) unsigned loosening is refused server-side; the world's policy stays unchanged", () => {
  it("one field looser and one stricter: refused without a signature, nothing changes; signed over those exact terms, both apply", async () => {
    const v = await visitor();
    const before = v.stored();
    const r = await v.send("treasury", { per_tx: "20.00", reserve_floor: "20000.00" });
    expect(r.out).toMatchObject({ applied: false, needs_signature: true, looser: ["reserve_floor"] });
    expect(v.stored()).toEqual(before);
    expect(r.out.policy.agents.treasury.per_tx).toBe("25.00");
    expect(r.out.proposals.find((p) => p.proposal_id === "T-0001")!.check).toBe("fail");
    // The terms the visitor signs name both changes, each from and to, and which one loosens.
    const terms = JSON.parse(r.out.canonical!) as { kind: string; test_world: string; changes: { field: string; from: string; to: string; looser: boolean }[]; policy_version: string };
    expect(terms).toMatchObject({ kind: "policy_change", test_world: v.w.world.id, policy_version: "1" });
    expect(terms.changes).toEqual([
      expect.objectContaining({ field: "per_tx", from: "25.00", to: "20.00", looser: false }),
      expect.objectContaining({ field: "reserve_floor", from: "25000.00", to: "20000.00", looser: true }),
    ]);
    expect(r.out.terms_sha256).toBe(sha(r.out.canonical!));
    const s = await v.send("treasury", { per_tx: "20.00", reserve_floor: "20000.00" }, { canonical: r.out.canonical, credential: v.signed(r.out.canonical!) });
    expect(s.out).toMatchObject({ applied: true, verified: true });
    expect(s.out.policy.agents.treasury.per_tx).toBe("20.00");
    expect(s.out.policy.reserve_floor).toBe("20000.00");
  });

  it("a signature over different terms is refused, and nothing changes", async () => {
    const v = await visitor();
    const before = v.stored();
    const asked = await v.send("treasury", { reserve_floor: "24000.00" });
    const other = await v.send("treasury", { reserve_floor: "10000.00" });
    // Signed for 24,000.00, sent for 10,000.00 (with the 10,000.00 terms): the signature is not over these terms.
    const r1 = await v.send("treasury", { reserve_floor: "10000.00" }, { canonical: other.out.canonical, credential: v.signed(asked.out.canonical!) });
    expect(r1.status).toBe(200);
    expect(r1.out).toMatchObject({ applied: false, verified: false });
    expect(r1.out.reason).toMatch(/^Refused/);
    // Signed over its own terms, but those are not the change sent: refused too.
    const r2 = await v.send("treasury", { reserve_floor: "10000.00" }, { canonical: asked.out.canonical, credential: v.signed(asked.out.canonical!) });
    expect(r2.out).toMatchObject({ applied: false, verified: false, why: "terms" });
    // Terms edited after signing (one character): refused.
    const edited = asked.out.canonical!.replace("24000.00", "14000.00");
    const r3 = await v.send("treasury", { reserve_floor: "14000.00" }, { canonical: edited, credential: v.signed(asked.out.canonical!) });
    expect(r3.out).toMatchObject({ applied: false, verified: false });
    expect(v.stored()).toEqual(before);
    expect(v.db.prepare("SELECT COUNT(*) AS n FROM ts_hits WHERE kind = 'fail'").get()).toEqual({ n: 3 });
  });

  it("a passkey from another world signs no policy here, and a replayed signature changes nothing again", async () => {
    const v = await visitor();
    const r = await v.send("treasury", { reserve_floor: "24000.00" });
    const stranger = new FakeAuthenticator();
    const s = await call(v.d, "policy", { token: v.w.world.token, agent: "treasury", set: { ...v.policy().agents.treasury, reserve_floor: "24000.00" }, canonical: r.out.canonical, credential: stranger.sign({ challenge: challengeOf(r.out.terms_sha256!), origin: BASE, rpId: RP }) });
    expect(s.status).toBe(403);
    expect(v.stored().version).toBe(1);
    // Signed and applied; tightened back; the same signed body again: the version moved, so its terms are not these.
    const credential = v.signed(r.out.canonical!);
    expect((await v.send("treasury", { reserve_floor: "24000.00" }, { canonical: r.out.canonical, credential })).out.applied).toBe(true);
    expect((await v.send("treasury", { reserve_floor: "25000.00" })).out.applied).toBe(true);
    const replay = await v.send("treasury", { reserve_floor: "24000.00" }, { canonical: r.out.canonical, credential });
    expect(replay.out).toMatchObject({ applied: false, verified: false });
    expect(v.policy().reserve_floor).toBe("25000.00");
  });
});

describe("(c) a stricter policy applies at once", () => {
  it("without a signature, a credential or a passkey at all", async () => {
    const { d } = desk();
    const res = await call(d, "world", {}, { ip: "198.51.100.200" });
    const w = (await res.json()) as { world: { token: string }; policy: WorldPolicy };
    const set = { ...w.policy.agents.treasury, reserve_floor: w.policy.reserve_floor, per_tx: "10.00", monthly: "20.00", end_date: "2026-12-31" };
    const r = await call(d, "policy", { token: w.world.token, agent: "treasury", set });
    const out = (await r.json()) as PolicyAnswer;
    expect(r.status).toBe(200);
    expect(out).toMatchObject({ applied: true, policy_version: "2" });
    expect(out.policy.agents.treasury).toMatchObject({ per_tx: "10.00", monthly: "20.00", end_date: "2026-12-31" });
  });
});

describe("(d) the world follows the policy", () => {
  it("a lower reserve floor, signed: the blocked payment passes its check and can be signed and run", async () => {
    const v = await visitor();
    expect(v.a.check).toBe("fail");
    const s = await v.signedChange("treasury", { reserve_floor: "20000.00" });
    const t1 = s.out.proposals.find((p) => p.proposal_id === "T-0001")!;
    expect(t1).toMatchObject({ check: "pass", status: "waiting" });
    expect(t1.waits).toMatch(/waits for a person/);
    expect(s.out.world.reserve_floor).toBe("20000.00");
    // Free EUR above the new floor is 6,000.00 of the 6,520.00 needed: code converts the 520.00 short (USD 587.44).
    expect((t1 as unknown as { plan: unknown }).plan).toMatchObject({ needed: "6520.00", free: "6000.00", buy: "520.00", sell: "587.44" });
    // Now it can be signed, and the stand-in runs it.
    const res = await call(v.d, "sign", signBody(v.w.world.token, t1, v.signed(t1.canonical)));
    expect(await res.json()).toMatchObject({ verified: true, executed: { amount: "6500.00", balance_after: "20020.00", usd_after: "7412.56" } });
  });

  it("a higher reserve floor: the payment that was allowed is blocked, and no signature runs it", async () => {
    const v = await visitor();
    const r = await v.send("treasury", { reserve_floor: "29000.00" });
    expect(r.out.applied).toBe(true);
    const t2 = r.out.proposals.find((p) => p.proposal_id === "T-0002")!;
    expect(t2).toMatchObject({ check: "fail", status: "blocked" });
    expect(t2.rule).toMatch(/Reserve floor: the EUR balance is already below its floor of EUR 29,000\.00/);
    const res = await call(v.d, "sign", signBody(v.w.world.token, v.b, v.signed(v.b.canonical)));
    expect(res.status).toBe(409);
    expect(v.db.prepare("SELECT status FROM ts_proposals WHERE world = ? AND id = 'T-0002'").get(v.w.world.id)).toEqual({ status: "blocked" });
  });


  it("another agent's policy leaves the Treasury agent's payments as they were", async () => {
    const v = await visitor();
    const r = await v.send("sourcing", { per_tx: "10.00" });
    expect(r.out.applied).toBe(true);
    expect(r.out.proposals.map((p) => `${p.proposal_id}:${p.check}`)).toEqual(["T-0001:fail", "T-0002:pass"]);
  });

  it("executed payments stay executed, and the payment check after a run uses the policy", async () => {
    const v = await visitor();
    expect((await (await call(v.d, "sign", signBody(v.w.world.token, v.b, v.signed(v.b.canonical)))).json() as { verified: boolean }).verified).toBe(true);
    // EUR 25,020.00 and USD 7,017.18 after T-0002: with the EUR floor at 20,000.00, T-0001 (6,500.00) needs 6,520.00 with
    // 5,020.00 free, so 1,500.00 is converted (USD 1,694.52, within the 4,017.18 free above the USD floor): it passes.
    const s = await v.signedChange("treasury", { reserve_floor: "20000.00" });
    // Signing T-0002 brought the agent's next invoice (T-0003, test/try-next-invoice.test.ts); it waits for a signature.
    expect(s.out.proposals.map((p) => `${p.proposal_id}:${p.status}`)).toEqual(["T-0001:waiting", "T-0002:executed", "T-0003:waiting"]);
    expect(s.out.world.balance).toBe("25020.00");
  });
});

// Max, 6 Nov: "may pay alone up to" really works. Raised and signed, a payment at or below it runs without a signature,
// by the same stand-in executor, labelled "paid alone under your new policy"; above it, or once it is lowered again, a
// payment that has not run waits for a signature; the other checks (reserve floor, the quote's end, the world's end,
// once only) still hold, and the run is bound to its terms' hash and to the signed change that allowed it.
type Executed = { alone?: boolean; label?: string; amount: string; balance_after: string; terms_sha256?: string; policy_change_sha256?: string | null; policy_version?: string; by: string };
const t2Of = (out: PolicyAnswer) => out.proposals.find((p) => p.proposal_id === "T-0002")! as Proposal & { status: string; execution?: Executed };
const t1Of = (out: PolicyAnswer) => out.proposals.find((p) => p.proposal_id === "T-0001")! as Proposal & { status: string; execution?: Executed };

describe("\"may pay alone up to\": raised and signed, a payment within it runs without a signature", () => {
  it("raised and signed: T-0002 (EUR 1,850.00) runs alone, by the stand-in, labelled \"paid alone under your new policy\"", async () => {
    const v = await visitor();
    const first = await v.send("treasury", { alone: "2000.00" });
    // What the visitor signs shows the new amount.
    const terms = JSON.parse(first.out.canonical!) as { changes: { field: string; from: string; to: string }[]; policy: { alone: string } };
    expect(terms.changes).toEqual([{ field: "alone", key: "approval.treasury.alone_eur", from: "500.00", to: "2000.00", looser: true }]);
    expect(terms.policy.alone).toBe("2000.00");
    expect((first.out as unknown as { alone_effect: string }).alone_effect).toMatch(/pay alone up to EUR 2,000\.00: a payment in this test world at or below it then runs without your signature/);
    const s = await v.send("treasury", { alone: "2000.00" }, { canonical: first.out.canonical, credential: v.signed(first.out.canonical!) });
    expect(s.out).toMatchObject({ applied: true, verified: true, paid_alone: ["T-0002"] });
    const t2 = t2Of(s.out);
    expect(PAID_ALONE).toBe("paid alone under your new policy");
    expect(t2.status).toBe("executed");
    expect(t2.execution).toMatchObject({ alone: true, label: PAID_ALONE, amount: "1850.00", balance_after: "25020.00", usd_after: "7017.18", terms_sha256: v.b.terms_sha256, policy_change_sha256: sha(first.out.canonical!), policy_version: "2" });
    expect(t2.execution!.by).toMatch(/^stand-in executor: recorded in this test world only; nothing paid or converted at Airwallex, no Alta call$/);
    expect(t2.execution!.terms_sha256).toBe(sha(v.b.canonical));
    expect(s.out.world.balance).toBe("25020.00");
    expect((s.out.locks.treasury as { purser: { payments: { proposal_id: string; check: string; alone?: boolean }[] } }).purser.payments.find((p) => p.proposal_id === "T-0002")).toMatchObject({ check: "executed", alone: true });
    // Once only: its signature runs nothing more, and the next policy change does not run it again.
    const res = await call(v.d, "sign", signBody(v.w.world.token, v.b, v.signed(v.b.canonical)));
    expect(res.status).toBe(409);
    const again = await v.send("treasury", { per_tx: "20.00" });
    expect(again.out.paid_alone).toEqual([]);
    expect(again.out.world.balance).toBe("25020.00");
  });

  it("raised but unsigned: refused, and nothing runs or changes", async () => {
    const v = await visitor();
    const before = v.stored();
    const r = await v.send("treasury", { alone: "2000.00" });
    expect(r.out).toMatchObject({ applied: false, needs_signature: true, looser: ["alone"] });
    expect((r.out as unknown as { paid_alone?: string[] }).paid_alone).toBeUndefined();
    expect(v.stored()).toEqual(before);
    expect(t2Of(r.out)).toMatchObject({ status: "waiting", check: "pass" });
    expect(t2Of(r.out).waits).toMatch(/Above the EUR 500\.00 an agent may pay alone/);
    expect(r.out.world.balance).toBe("26000.00");
    // Signed over other terms (the same change asked for EUR 1,000.00): refused too, nothing runs.
    const other = await v.send("treasury", { alone: "1000.00" });
    const bad = await v.send("treasury", { alone: "2000.00" }, { canonical: r.out.canonical, credential: v.signed(other.out.canonical!) });
    expect(bad.out).toMatchObject({ applied: false, verified: false });
    expect(v.db.prepare("SELECT status FROM ts_proposals WHERE world = ? AND id = 'T-0002'").get(v.w.world.id)).toEqual({ status: "waiting" });
  });

  it("above the new amount: still needs a signature (EUR 1,850.00 over a limit of EUR 1,000.00)", async () => {
    const v = await visitor();
    const s = await v.signedChange("treasury", { alone: "1000.00" });
    expect(s.out.paid_alone).toEqual([]);
    expect(t2Of(s.out)).toMatchObject({ status: "waiting", check: "pass" });
    expect(t2Of(s.out).waits).toMatch(/Above the EUR 1,000\.00 an agent may pay alone, so it waits for a person's signature/);
    // And the signature runs it, as before.
    const res = await call(v.d, "sign", signBody(v.w.world.token, v.b, v.signed(v.b.canonical)));
    expect(await res.json()).toMatchObject({ verified: true, executed: { amount: "1850.00" } });
  });

  it("lowered again: a payment that has not run needs a signature again; one that ran alone stays as it ran", async () => {
    const v = await visitor();
    // EUR 7,000.00: T-0002 runs alone; T-0001 (6,500.00) is within it but the reserve floor still blocks it.
    const up = await v.signedChange("treasury", { alone: "7000.00" });
    expect(up.out.paid_alone).toEqual(["T-0002"]);
    expect(t1Of(up.out)).toMatchObject({ status: "blocked", check: "fail" });
    expect(t1Of(up.out).rule).toMatch(/Reserve floor/);
    // Lower (stricter, at once): EUR 1,000.00. Then the floor down (signed): T-0001 passes the floor, and waits.
    const down = await v.send("treasury", { alone: "1000.00" });
    expect(down.out).toMatchObject({ applied: true, paid_alone: [] });
    const floor = await v.signedChange("treasury", { reserve_floor: "20000.00" });
    expect(floor.out.paid_alone).toEqual([]);
    expect(t1Of(floor.out)).toMatchObject({ status: "waiting", check: "pass" });
    expect(t1Of(floor.out).waits).toMatch(/Above the EUR 1,000\.00 an agent may pay alone/);
    expect(t2Of(floor.out)).toMatchObject({ status: "executed", execution: { alone: true, label: PAID_ALONE } });
    expect(floor.out.world.balance).toBe("25020.00");
  });

  it("raised high enough for both, with the floor lowered: both run alone, one after the other, the floor checked on each", async () => {
    const v = await visitor();
    await v.signedChange("treasury", { reserve_floor: "20000.00" });
    const s = await v.signedChange("treasury", { alone: "7000.00" });
    expect(s.out.paid_alone).toEqual(["T-0001", "T-0002"]);
    // T-0001: 520.00 converted (USD 587.44), EUR 20,020.00; T-0002: 1,850.00 converted (USD 2,089.91), EUR 20,020.00.
    expect(s.out.world).toMatchObject({ balance: "20020.00", usd_balance: "5322.65" });
    // With floors that hold for one only, the first in line runs and the other is blocked by them: at EUR 23,000.00,
    // T-0001 converts 3,520.00 (USD 3,976.47), which leaves USD 1,023.53 above its floor, too little for T-0002's 2,089.91.
    const w = await visitor();
    await w.signedChange("treasury", { reserve_floor: "23000.00" });
    const t = await w.signedChange("treasury", { alone: "7000.00" });
    expect(t.out.paid_alone).toEqual(["T-0001"]);
    expect(t2Of(t.out)).toMatchObject({ status: "blocked", check: "fail" });
    expect(t.out.world).toMatchObject({ balance: "23020.00", usd_balance: "4023.53" });
  });

  it("its quote expired: it does not run alone; with a new quote, it runs alone then", async () => {
    const fx = new StandInQuotes(() => t0.getTime());
    const v = await visitor(fx);
    expect((v.b as unknown as { canonical: string }).canonical).toMatch(/"fx":\{/);
    v.at(new Date(t0.getTime() + 16 * 60_000));
    fx.now = () => t0.getTime() + 16 * 60_000;
    const s = await v.signedChange("treasury", { alone: "2000.00" });
    expect(s.out.paid_alone).toEqual([]);
    expect(t2Of(s.out)).toMatchObject({ status: "waiting", check: "pass", waits: "" });
    const q = await call(v.d, "quote", { token: v.w.world.token });
    const out = (await q.json()) as { paid_alone: string[]; proposal: Proposal & { status: string; execution: Executed } };
    expect(out.paid_alone).toEqual(["T-0002"]);
    expect(out.proposal).toMatchObject({ status: "executed", execution: { alone: true, label: PAID_ALONE, terms_sha256: out.proposal.terms_sha256 } });
    expect(out.proposal.terms_sha256).toBe(sha(out.proposal.canonical));
  });

  it("another agent's \"alone\" limit runs none of the Treasury agent's payments", async () => {
    const v = await visitor();
    const first = await v.send("sourcing", { alone: "7000.00" });
    expect((first.out as unknown as { alone_effect: string }).alone_effect).toMatch(/none of them runs alone because of it/);
    const s = await v.signedChange("sourcing", { alone: "7000.00" });
    expect(s.out.paid_alone).toEqual([]);
    expect(t2Of(s.out).status).toBe("waiting");
  });
});

describe("the policy step's guards", () => {
  it("calls nothing outside: no fetch during a whole policy visit", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const v = await visitor();
    await v.send("treasury", { per_tx: "20.00" });
    await v.signedChange("treasury", { reserve_floor: "20000.00" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("goes through the same per-address limit as the other requests", async () => {
    const v = await visitor();
    const statuses: number[] = [];
    for (let i = 0; i < TRY_SIGN_PER_MINUTE; i++) statuses.push((await v.send("treasury", { per_tx: i % 2 ? "25.00" : "24.00" })).status);
    expect(statuses.at(-1)).toBe(429);
  });

  it("takes POST with this site's origin only, and a world's token", async () => {
    const v = await visitor();
    const set = { ...v.policy().agents.treasury, reserve_floor: v.policy().reserve_floor, per_tx: "20.00" };
    expect((await call(v.d, "policy", { token: v.w.world.token, agent: "treasury", set }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call(v.d, "policy", { token: "A".repeat(43), agent: "treasury", set })).status).toBe(410);
    expect((await call(v.d, "policy", { agent: "treasury", set })).status).toBe(410);
    expect(v.stored().version).toBe(1);
  });

  it("an expired world takes no policy", async () => {
    const { d, at } = desk(new Database(":memory:"));
    const res = await call(d, "world", {}, { ip: "198.51.100.201" });
    const w = (await res.json()) as { world: { token: string }; policy: WorldPolicy };
    at(new Date(t0.getTime() + 61 * 60_000));
    expect((await call(d, "policy", { token: w.world.token, agent: "treasury", set: { ...w.policy.agents.treasury, reserve_floor: "26000.00" } }, { ip: "198.51.100.201" })).status).toBe(410);
  });
});

describe("the page's step 0", () => {
  it("shows the policy step: every field, the allowed categories and currencies, and the three panels labelled as not sent", async () => {
    const { trySignPage, TRY_POLICY } = await import("../src/try/sign.js");
    const { POLICY_FIELDS, POLICY_MCCS, POLICY_CURRENCIES } = await import("../src/try/policy.js");
    const html = trySignPage();
    // Behind one closed line on screen 4, "All fields, and what Purser sends" (Max, 7 Nov).
    expect(html).toContain(`<details class="fold quiet policy" id="policy"><summary id="p-open">${TRY_POLICY.open}</summary>`);
    for (const f of POLICY_FIELDS) expect(html).toContain(`data-pfield="${f}"`);
    for (const m of POLICY_MCCS) expect(html).toContain(`name="pf-mccs" value="${m}"`);
    for (const c of POLICY_CURRENCIES) expect(html).toContain(`name="pf-currencies" value="${c}"`);
    expect(TRY_POLICY.notSent).toEqual({ airwallex: "What Purser would send; not sent", metal: "Not sent" });
    for (const s of [TRY_POLICY.title, TRY_POLICY.panels.purser, TRY_POLICY.panels.airwallex, TRY_POLICY.panels.metal, TRY_POLICY.notSent.airwallex, TRY_POLICY.notSent.metal]) expect(html).toContain(s);
    // The page computes no lock itself: it shows what the server computed (no card body or mandate built in its script).
    expect(html).not.toMatch(/allowed_merchant_categories|PER_TRANSACTION|"--cap"/);
  });
});
