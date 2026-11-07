// /try/sign, the demo's last screen (Max, 7 Nov): after the visitor signs T-0002, the Treasury agent's next invoice
// (T-0003, Alpine Packaging, EUR 1,240.00) arrives in the test world. It is fixed text with no model sentence; it needs
// FX too (spec 6b: EUR 1,260.00 needed, EUR 20.00 free), so it gets a second live quote for its EUR 1,240.00 shortfall
// when it arrives. It is checked by the same rules as the others: above what the agent may pay alone it waits for a
// signature; once the visitor raises "may pay alone up to" to EUR 2,000.00 and signs that change, it runs alone, by the
// same stand-in, labelled "paid alone under your new policy". A stricter limit leaves it waiting; an expired quote makes
// it wait for a new one. The world opens with T-0001; the agents' steps add T-0002.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NEXT_INVOICE, PAID_ALONE, aloneRoom, canonical, proposalTerms } from "../worker/src/trySign.js";
import { ALONE_PER_DAY } from "../src/try/policy.js";
import { BASE, call, challengeOf, desk, RP, signBody, t0, withPasskey, type Proposal } from "./support/trySign.js";
import { StandInQuotes } from "./support/fxStandIn.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
type Answer = { applied?: boolean; needs_signature?: boolean; canonical?: string; paid_alone?: string[]; proposals: (Proposal & { execution?: Record<string, unknown> })[]; world: { balance: string } };

/** A visitor who has signed T-0002, and a way to change the Treasury agent's "may pay alone up to". */
async function signedT2(fx: StandInQuotes | null = null) {
  const { d, db, at } = desk(undefined, fx);
  const { w, auth, b } = await withPasskey(d);
  let counter = 0;
  const signed = (text: string) => auth.sign({ challenge: challengeOf(sha(text)), origin: BASE, rpId: RP, counter: ++counter });
  const r = await call(d, "sign", signBody(w.world.token, b, signed(b.canonical)));
  expect(r.status).toBe(200);
  const out = (await r.json()) as { verified: boolean; paid_alone?: string[] };
  const policy = (w as unknown as { policy: { reserve_floor: string; agents: { treasury: Record<string, unknown> } } }).policy;
  const alone = async (amount: string, sign: boolean) => {
    const set = { ...policy.agents.treasury, reserve_floor: policy.reserve_floor, alone: amount };
    const first = (await (await call(d, "policy", { token: w.world.token, agent: "treasury", set })).json()) as Answer;
    if (!sign || first.applied) return first;
    return (await (await call(d, "policy", { token: w.world.token, agent: "treasury", set, canonical: first.canonical, credential: signed(first.canonical!) })).json()) as Answer;
  };
  return { d, db, w, out, alone, at };
}
const t3 = (a: Answer) => a.proposals.find((p) => p.proposal_id === NEXT_INVOICE.id);

describe("the agent's next invoice (T-0003)", () => {
  it("is not in a new world: the world has T-0001 and, once the agents are done, T-0002", async () => {
    const { d } = desk();
    const { w } = await withPasskey(d);
    expect(w.proposals.map((p) => p.proposal_id)).toEqual(["T-0001", "T-0002"]);
  });

  it("arrives once T-0002 is signed: EUR 1,240.00 to Alpine Packaging, fixed text, no quote without a sandbox key; it waits for a signature", async () => {
    const v = await signedT2();
    expect(v.out.verified).toBe(true);
    expect(v.out.paid_alone).toBeUndefined();
    const row = v.db.prepare("SELECT canonical, sha, check_json, status FROM ts_proposals WHERE world = ? AND id = 'T-0003'").get(v.w.world.id) as { canonical: string; sha: string; check_json: string; status: string };
    const terms = JSON.parse(row.canonical) as Record<string, unknown>;
    expect(terms).toMatchObject({ kind: "payment", proposal_id: "T-0003", amount: "1240.00", currency: "EUR", payee: "Alpine Packaging (test payee)", fx: null, agent_advice: "none", nothing_real_moves: true, proposed_by: "Treasury agent (fixed text)" });
    expect(row.canonical).toBe(canonical(proposalTerms(NEXT_INVOICE, v.w.world.id, v.w.world.expires_at)));
    expect(row.sha).toBe(sha(row.canonical));
    expect(row.status).toBe("waiting");
    // EUR 25,020.00 after T-0002: EUR 1,260.00 needed, EUR 20.00 free, so EUR 1,240.00 is converted (at the recorded rate here).
    expect(JSON.parse(row.check_json)).toEqual({ check: "pass", waits: "Above the EUR 500.00 an agent may pay alone, so it waits for a person's signature.",
      plan: { needed: "1260.00", fee_max: "20.00", free: "20.00", shortfall: "1240.00", buy: "1240.00", sell: "1400.80", rate_from: "the recorded rate (1.129677 USD per EUR, 2026-11-02)" } });
  });

  it("runs alone once \"may pay alone up to\" is raised to EUR 2,000.00 and signed: by the stand-in, labelled, with its own live quote", async () => {
    const fx = new StandInQuotes(() => t0.getTime());
    const v = await signedT2(fx);
    const first = await v.alone("2000.00", false);
    expect(first).toMatchObject({ applied: false, needs_signature: true });
    expect(t3(first)?.status).toBe("waiting");
    const s = await v.alone("2000.00", true);
    expect(s).toMatchObject({ applied: true, paid_alone: ["T-0003"] });
    // EUR 25,020.00 + 1,240.00 bought - 1,240.00 paid; USD 7,017.18 - 1,400.80 sold (the stand-in quote's).
    expect(t3(s)).toMatchObject({ status: "executed", execution: { alone: true, label: PAID_ALONE, amount: "1240.00", balance_after: "25020.00", usd_after: "5616.38", fx_bought: "1240.00", fx_sold: "1400.80", fx_quote_id: "stand-in-0002-0000-0000-000000000000" } });
    expect(s.world.balance).toBe("25020.00");
    // T-0001 (EUR 6,500.00) stays blocked by the reserve floor.
    expect(s.proposals.find((p) => p.proposal_id === "T-0001")?.check).toBe("fail");
  });

  it("stays waiting under a stricter limit (EUR 400.00, applied at once), and under a looser one below its amount", async () => {
    const v = await signedT2();
    const strict = await v.alone("400.00", false);
    expect(strict).toMatchObject({ applied: true });
    expect(strict.paid_alone).toEqual([]);
    expect(t3(strict)?.status).toBe("waiting");
    const low = await v.alone("1000.00", true);
    expect(low).toMatchObject({ applied: true, paid_alone: [] });
    expect(t3(low)?.status).toBe("waiting");
  });

  it("arrives once only, with a second live quote of its own for its shortfall; a policy change asks for none", async () => {
    const fx = new StandInQuotes(() => t0.getTime());
    const v = await signedT2(fx);
    expect(fx.calls).toBe(2);
    const row = v.db.prepare("SELECT canonical FROM ts_proposals WHERE world = ? AND id = 'T-0003'").get(v.w.world.id) as { canonical: string };
    expect((JSON.parse(row.canonical) as { fx: { buy_amount: string; quote_id: string } }).fx).toMatchObject({ buy_amount: "1240.00", quote_id: "stand-in-0002-0000-0000-000000000000" });
    await v.alone("2000.00", true);
    expect(fx.calls).toBe(2);
    expect((v.db.prepare("SELECT COUNT(*) AS n FROM ts_proposals WHERE world = ? AND id = 'T-0003'").get(v.w.world.id) as { n: number }).n).toBe(1);
  });
});

describe("the next invoice's quote expires: it waits for a new one", () => {
  it("expired when it would run alone: it waits; \"Get a new quote\" gives it new terms with a new quote, and then it runs alone", async () => {
    const fx = new StandInQuotes(() => t0.getTime());
    const v = await signedT2(fx);
    v.at(new Date(t0.getTime() + 16 * 60_000));
    fx.now = () => t0.getTime() + 16 * 60_000;
    const s = await v.alone("2000.00", true);
    expect(s).toMatchObject({ applied: true, paid_alone: [] });
    expect(t3(s)?.status).toBe("waiting");
    const q = await call(v.d, "quote", { token: v.w.world.token });
    expect(q.status).toBe(200);
    const out = (await q.json()) as { proposal: Proposal; paid_alone: string[] };
    expect(out.paid_alone).toEqual(["T-0003"]);
    expect(JSON.parse(out.proposal.canonical)).toMatchObject({ proposal_id: "T-0003", fx: { buy_amount: "1240.00", quote_id: "stand-in-0003-0000-0000-000000000000" } });
    expect(fx.calls).toBe(3);
  });
});

describe("payments alone have a limit per day (Max, 7 Nov: the worst case counts them)", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  const ran = (hoursAgo: number) => ({ alone: true, at: new Date(now - hoursAgo * 3_600_000).toISOString() });
  it("room until ALONE_PER_DAY ran alone in the last 24 hours; older ones and signed ones do not count", () => {
    expect(ALONE_PER_DAY).toBe(3);
    expect(aloneRoom([], now)).toBe(true);
    expect(aloneRoom([ran(1), ran(2)], now)).toBe(true);
    expect(aloneRoom([ran(1), ran(2), ran(3)], now)).toBe(false);
    expect(aloneRoom([ran(1), ran(2), ran(25)], now)).toBe(true);
    expect(aloneRoom([ran(1), ran(2), { alone: false, at: ran(3).at }], now)).toBe(true);
  });
});
