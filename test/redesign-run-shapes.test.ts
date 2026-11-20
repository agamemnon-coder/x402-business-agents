// The played run's figures (src/redesign/run.ts) from records shaped unlike the main run's: no ledger, an empty run,
// a run with a follow-up, refusals by each party, a let-through purchase, an FX, a TAP-signed card buy, a dispute and a
// card raise. The pages read the main run's record, which takes one path through each; these are the others. Breaks if
// a count, a sentence or a found row changes for a record the pages could be given.
import { describe, expect, it } from "vitest";
import {
  callBadge, callOf, callTip, cardRaiseOf, decisionsOf, disputeStory, faceIdDecisions, faceIdLine, family, fxOf, letThroughOf, metalDetail, money, ownTap,
  payments, replayRecord, runLabel, runName, runSpan, sandboxRails, separateRowHtml, split, stopFigure, stoppedFace, stops, stopStory, stopsLine, stopSub, timings,
  traceAt, type RunRecord,
} from "../src/redesign/run.js";
import { SANDBOX_SETTLED } from "../src/config/brand.js";

type Snapshot = RunRecord["snapshot"];
type Row = NonNullable<RunRecord["ledger"]>["events"][number];
const row = (seq: number, ts: string, event: string, subject: string | null, payload: Record<string, unknown> = {}): Row => ({ seq, ts, actor: "x", event, subject, payload });

function record(o: { snapshot?: Partial<Snapshot>; ledger?: RunRecord["ledger"]; proof?: Partial<RunRecord["proof"]>; run?: string } = {}): RunRecord {
  return {
    recorded_at: "2026-11-05T10:00:00Z", run: o.run ?? "dry run 7 (rehearsal), 5 Nov: three agents",
    snapshot: {
      agent_chat: [], flows: [], traces: [], refusals: [], decisions: [], agent_stats: [], counts: { alone: 0, blocked: 0 }, audit: { rows: 0, intact: true },
      tower: { agents: [] }, rails: { metal: [], airwallex: [] }, ...o.snapshot,
    },
    proof: { face_id: 3, chain_refusals: 0, card_declines: 0, ai_tricks: 0, ...o.proof },
    ...(o.ledger ? { ledger: o.ledger } : {}),
  };
}
const flow = (o: Partial<Snapshot["flows"][number]>): Snapshot["flows"][number] => ({ at: "2026-11-05T10:00:00Z", kind: "upstream", agent: "sourcing", model: null, decided: "code", what: "a stock check", amount: "0.02", unit: "USDZ", rail: "metal", proof: { label: "tx", href: null }, ...o });

describe("the run's name, span and label", () => {
  it("names a run without its parentheses and date, and dates an empty run by when it was recorded", () => {
    const r = record();
    expect(runName(r)).toBe("dry run 7");
    expect(runName(record({ run: "agent run 1 (rehearsal), 2 Nov 2026" }))).toBe("agent run 1");
    expect(runSpan(r)).toEqual({ from: r.recorded_at, to: r.recorded_at, followUp: false });
    // No decisions at all: "0 of 0", not "real Claude decisions".
    expect(runLabel(r)).toBe("Replay of dry run 7, 5 Nov 10:00–10:00 UTC · test money · 0 of 0 decisions by Claude");
  });

  it("says a follow-up after an hour's pause, from every row the record holds", () => {
    const r = record({
      snapshot: {
        agent_chat: [{ ts: "2026-11-05T09:00:00Z", kind: "world", who: "world", by: null, model: null, text: "x" }],
        traces: [{ agent: "treasury", task: "t", status: "ok", model: "m", steps: [{ ts: "2026-11-05T09:30:00Z", kind: "tool", tool: null, input: null }] }],
        agent_stats: [{ agent: "sourcing", decisions: 2, by_claude: 2, fallback: 0, claude_calls: 2, cost_usd_micros: 1, models: [] }],
      },
      ledger: { events: [row(1, "2026-11-05T14:45:00Z", "transfer.status", "t")], proposals: [], disputes: [] },
    });
    expect(runSpan(r)).toEqual({ from: "2026-11-05T09:00:00Z", to: "2026-11-05T14:45:00Z", followUp: true });
    expect(runLabel(r)).toBe("Replay of dry run 7 and its follow-up, 5 Nov 09:00–14:45 UTC · test money · real Claude decisions");
  });
});

describe("a decision's Claude call", () => {
  const trace = (o: Partial<Snapshot["traces"][number]>): Snapshot["traces"][number] => ({ agent: "support", task: "t", status: "ok", model: "claude-haiku-4-5", steps: [{ ts: "2026-11-05T10:00:03Z", kind: "tool", tool: "refund", input: null }], ...o });

  it("finds the trace that ended within five seconds of the decision, and no other", () => {
    const near = trace({}), far = trace({ steps: [{ ts: "2026-11-05T10:00:20Z", kind: "tool", tool: null, input: null }] });
    const r = record({ snapshot: { traces: [far, near, trace({ agent: "treasury" }), trace({ steps: [] })] } });
    expect(traceAt(r, "support", "2026-11-05T10:00:00Z")).toBe(near);
    expect(traceAt(r, "support", "2026-11-05T09:59:00Z")).toBeNull();
  });

  it("is none without a request id or tokens; Claude's time falls back to the decision's when claude_ms is absent", () => {
    expect(callOf(null)).toBeNull();
    expect(callOf(trace({ request_ids: [] }))).toBeNull();
    expect(callOf(trace({ request_ids: ["req_1"] }))).toBeNull();
    const c = callOf(trace({ request_ids: ["req_0123456789abcdef", "req_2"], tokens: { input: 1000, output: 200, cache_read: 30, cache_write: 4 }, latency_ms: 4200 }))!;
    expect(c).toEqual({ family: "Haiku", tokens: 1234, latencyMs: 4200, wallMs: 4200, requestId: "req_0123456789abcdef", requestIds: ["req_0123456789abcdef", "req_2"], calls: 2 });
    expect(callBadge(c)).toBe("Claude call ✓ · Haiku · 1,234 tokens · 4.2 s · req_01234567…");
    expect(callTip(c)).toBe("2 Claude calls (req_0123456789abcdef, req_2): 4.2 s of Claude time; the decision took 4.2 s in all, tools included.");
    const none = callOf(trace({ model: "gpt", request_ids: ["r"], tokens: { input: 1, output: 0, cache_read: 0, cache_write: 0 } }))!;
    expect(none).toMatchObject({ family: "", latencyMs: 0, wallMs: 0, calls: 1 });
    expect(callTip(none)).toMatch(/^1 Claude call \(r\)/);
    expect(family(undefined)).toBe("");
    expect(money("1.00", "USD")).toBe("USD 1.00");
    expect(money("1.00", "EUR")).toBe("EUR 1.00");
    expect(money("1.00", "USDZ")).toBe("1.00 test USD");
  });
});

describe("the run's own rows, found or not", () => {
  it("finds nothing in a record with no ledger", () => {
    const r = record();
    expect(letThroughOf(r)).toBeNull();
    expect(fxOf(r)).toBeNull();
    expect(ownTap(r)).toBeNull();
    expect(timings(r)).toEqual({ toOptions: null, faceToPaid: null });
    expect(cardRaiseOf(r)).toBeNull();
    expect(disputeStory(r)).toBe("");
    expect(faceIdDecisions(r)).toBe(3); // the record's own count, with no ledger to count from
  });

  it("reads a let-through purchase, an FX, a TAP-signed card buy, the timings and a card raise, with what each row lacks left empty", () => {
    const ledger: RunRecord["ledger"] = {
      proposals: [], disputes: [],
      events: [
        row(1, "2026-11-05T10:00:00Z", "upstream.refused", "1", { reason: "mandate_cap_exceeded at 0.02" }),
        row(2, "2026-11-05T10:00:05Z", "proposal.created", "P-1", { kind: "mandate_replace" }),
        row(3, "2026-11-05T10:01:00Z", "upstream.let_through", "2", {}),
        row(4, "2026-11-05T10:01:01Z", "upstream.let_through_refused", "2", {}),
        row(5, "2026-11-05T10:02:00Z", "fx.converted", null, {}),
        row(6, "2026-11-05T10:03:00Z", "tap.checkout_verified", "Packwise", {}),
        row(7, "2026-11-05T10:03:01Z", "card.charge_approved", null, { origin: { tap: { key_id: "k" } } }),
        row(8, "2026-11-05T10:04:00Z", "proposal.approved", "P-2", { approver: "Max (CFO)" }),
        row(9, "2026-11-05T10:04:30Z", "proposal.executed", "P-2", { transfer_id: "tr1" }),
        row(10, "2026-11-05T10:04:40Z", "transfer.status", "tr1", { status: "PAID" }),
        row(11, "2026-11-05T10:05:00Z", "card.limits_synced", "sourcing", { from: "EUR 30.00 / EUR 100.00", to: "EUR 60.00 / EUR 200.00" }),
        row(12, "2026-11-05T10:06:00Z", "proposal.rejected", "P-3", { approver: "max" }),
        row(13, "2026-11-05T10:06:00Z", "proposal.approved", "P-4", { approver: "a controller" }),
      ],
    };
    const r = record({ ledger });
    expect(letThroughOf(r)).toEqual({ at: "2026-11-05T10:01:00Z", amount: "", cap: "", label: expect.any(String), tx: null });
    expect(fxOf(r)).toEqual({ at: "2026-11-05T10:02:00Z", id: "", buy: "", sell: "", proposal: "" });
    expect(ownTap(r)).toEqual({ at: "2026-11-05T10:03:01Z", merchant: "Packwise", plan: "", amount: "", currency: "", last4: "", txId: "", keyId: "", sig1: "", sig2: "", model: null });
    expect(timings(r)).toEqual({ toOptions: 5, faceToPaid: 40 });
    expect(cardRaiseOf(r)).toEqual({ proposal: "P-2", from: "EUR 30.00", to: "EUR 60.00", approvedAt: "2026-11-05T10:04:00Z" });
    // Only the CFO's own decisions count, each proposal once.
    expect(faceIdDecisions(r)).toBe(2);
  });

  it("calls a stopped proposal a step of its own only when code stopped it", () => {
    const base = row(1, "2026-11-05T10:00:00Z", "proposal.needs_reapproval", "P-9", { stopped: "executor", error: "guard refused" });
    expect(stoppedFace(base, "Pay")).toEqual({ k: "face", at: base.ts, id: "P-9", title: "Pay", status: "STOPPED", signers: [], reason: "guard refused" });
    expect(stoppedFace({ ...base, subject: null, payload: { stopped: "x" } }, "Pay")).toMatchObject({ id: "", reason: "" });
    expect(stoppedFace({ ...base, payload: {} }, "Pay")).toBeNull();
    expect(stoppedFace({ ...base, event: "proposal.approved" }, "Pay")).toBeNull();
  });
});

describe("the stops", () => {
  it("counts each party's stops, one attempt once, and says them in one sentence", () => {
    const r = record({
      snapshot: {
        counts: { alone: 0, blocked: 7 },
        flows: [
          flow({ refused: { by: "metal", reason: "mandate_cap_exceeded" } }), // the facilitator's 402, no tx …
          flow({ at: "2026-11-05T10:00:05Z", refused: { by: "metal", reason: "mandate_cap_exceeded" }, proof: { label: "tx", href: "https://x/tx/1" } }), // … and its record on chain
          flow({ at: "2026-11-05T11:00:00Z", refused: { by: "metal", reason: "mandate_revoked" } }),
          flow({ rail: "airwallex_card", refused: { by: "airwallex", reason: "LIMIT" } }),
        ],
        decisions: [{ proposal_id: "P-1", title: "t", status: "REJECTED", by: "Max", at: "x" }],
        refusals: [
          { seq: 1, ts: "x", agent: "sourcing", what: "purchase", reason: "the agent's own buy policy" },
          { seq: 2, ts: "x", agent: "sourcing", what: "purchase", reason: "refused on chain: over the cap" },
          { seq: 3, ts: "x", agent: "sourcing", what: "purchase", reason: "refused on chain: revoked by a replacement" },
          { seq: 4, ts: "x", agent: "treasury", what: "Proposal rejected", reason: "with Face ID" },
          { seq: 5, ts: "x", agent: "reader", what: "A planted instruction in an invoice", reason: "ignored" },
          { seq: 6, ts: "x", agent: "treasury", what: "licence", reason: "fee_unknown" },
        ],
      },
      proof: { over_limit_eur: "1.50" },
    });
    expect(stops(r)).toMatchObject({ metal: 1, revoked: 1, airwallex: 1, cfo: 1, feeUnknown: 1 });
    const st = stopStory(r);
    expect(st).toEqual({ total: 7, claude: 1, metal: 2, metalCap: 1, metalReplaced: 1, cfo: 1, planted: 1, other: 2, overLimitEur: "1.50" });
    expect(stopSub(st)).toBe("EUR 1.50 paid over a limit");
    expect(stopsLine(st)).toBe("7 stops, EUR 1.50 paid over a limit: one buy rule Claude set stopped 1 overpriced check, Alta refused 2 purchases, the CFO rejected 1 proposal, 1 planted instruction changed nothing, and 2 other.");
    expect(metalDetail(st)).toBe("1 over the mandate's cap, 1 on a mandate that had just been replaced");
    // A record that does not say what was paid over a limit, and has one kind of stop only.
    const one = stopStory(record({ snapshot: { counts: { alone: 0, blocked: 1 }, refusals: [{ seq: 1, ts: "x", agent: "a", what: "proposal rejected", reason: "Face ID" }] } }));
    expect(stopSub(one)).toBe("");
    expect(stopFigure(one)).toBe("1 stop");
    expect(stopsLine(one)).toBe("1 stop: the CFO rejected 1 proposal.");
    expect(stopsLine(stopStory(record()))).toBe("0 stops.");
    expect(metalDetail(stopStory(record()))).toBe("");
  });
});

describe("the payments and decisions", () => {
  it("adds the payments up by kind and says when they do not sum to the record's count", () => {
    const r = record({
      snapshot: {
        counts: { alone: 6, blocked: 0 },
        flows: [
          flow({ kind: "sale", count: 3 }), flow({ kind: "upstream", decided: "code (buy policy)" }), flow({ kind: "upstream", decided: "claude" }),
          flow({ kind: "sweep" }), flow({ kind: "upstream", refused: { by: "metal", reason: "x" } }),
          flow({ kind: "transfer", rail: "airwallex_swift" }),
        ],
      },
    });
    const p = payments(r);
    expect(p).toMatchObject({ sales: 3, purchases: 2, refunds: 0, sweeps: 1, cards: 0, onChain: 6, transfers: 1, reconciled: 7, routine: 4, sums: true });
    expect(p.canonical).toBe("6 Alta payments");
    expect(p.line).toBe("6 Alta payments, all inside the limits: 3 sales + 2 supplier purchases + 0 refunds + 1 sweep on Alta");
    expect(payments(record({ snapshot: { counts: { alone: 1, blocked: 0 }, flows: [flow({ kind: "card", rail: "airwallex_card" })] } }))).toMatchObject({ canonical: "0 Alta payments + 1 card charge", sums: true });
    expect(payments(record({ snapshot: { counts: { alone: 9, blocked: 0 } } })).sums).toBe(false);
    expect(split(r)).toEqual({ byClaude: 0, decisions: 0, fallbacks: 0, routine: 4 });
  });

  it("says the co-signatures beside the Face ID decisions", () => {
    expect(faceIdLine(1, 1)).toEqual({ label: "decision signed with Face ID", line: "1 decision signed with Face ID" });
    expect(faceIdLine(5, 7)).toEqual({ label: "decisions signed with Face ID (+2 co-signatures)", line: "5 decisions signed with Face ID (+2 co-signatures)" });
    expect(faceIdLine(2, 3).label).toBe("decisions signed with Face ID (+1 co-signature)");
  });

  it("lists each traced decision once, in the agent's words from the chat or else its row's", () => {
    const r = record({
      snapshot: {
        agent_chat: [{ ts: "2026-11-05T10:00:00Z", kind: "decision", who: "sourcing", by: "claude", model: "m", text: "I set the buy policy." }],
        traces: [
          { agent: "treasury", task: "t", status: "ok", model: "m", steps: [{ ts: "2026-11-05T11:00:00Z", kind: "row", tool: null, input: null, seq: 41, text: "The Treasury agent advises paying on Friday." }] },
          { agent: "sourcing", task: "t", status: "ok", model: "m", decision_seq: 7, steps: [{ ts: "2026-11-05T10:00:00Z", kind: "tool", tool: "set_buy_policy", input: null }] },
          { agent: "reader", task: "t", status: "ok", model: "m", steps: [{ ts: "2026-11-05T09:00:00Z", kind: "tool", tool: null, input: null }] },
          { agent: "support", task: "t", status: "ok", model: "m", steps: [] },
          { agent: "support", task: "t", status: "ok", model: "m", steps: [{ ts: "2026-11-05T12:00:00Z", kind: "tool", tool: null, input: null }] },
        ],
      },
    });
    expect(decisionsOf(r).map((d) => [d.seq, d.agent, d.text, d.call])).toEqual([
      [7, "sourcing", "I set the buy policy.", null],
      [41, "treasury", "Advises paying on Friday.", null],
      [null, "support", "", null],
    ]);
  });
});

describe("the dispute, the rails and the replay", () => {
  const disputed = (o: { evidence?: { signed_order: boolean }[]; rejected?: boolean; refunds?: number } = {}) => record({
    snapshot: { flows: Array.from({ length: o.refunds ?? 2 }, (_, i) => flow({ kind: "refund", agent: "support", amount: i ? "0.05" : "0.10" })) },
    ledger: {
      events: [], disputes: [{ dispute_id: "D-1", customer: "c", created_at: "x", claims: { claims: ["never_placed"], sale_refs: [1, 2, 3, 4, 5] }, evidence: o.evidence ?? [{ signed_order: true }], verdicts: [] }],
      proposals: [{ proposal_id: "P-5", kind: "refund_batch", status: o.rejected === false ? "APPROVED" : "REJECTED", created_by: "support", created_at: "x", terms: {} }],
    },
  });

  it("tells the dispute only when every part of it is in the record", () => {
    expect(disputeStory(disputed())).toBe(`A simulated customer disputes 5 orders, saying its agent never placed them. Every order carries its agent's signature, so that claim fails. Two orders had wrong data; the Support agent refunds those 2 (0.15 test USD) itself. "Refund the other 3" goes to the CFO, who rejects it with Face ID.`);
    expect(disputeStory(disputed({ refunds: 12 }))).toContain("12 orders had wrong data");
    expect(disputeStory(disputed({ evidence: [{ signed_order: true }, { signed_order: false }] }))).toBe("");
    expect(disputeStory(disputed({ evidence: [] }))).toBe("");
    expect(disputeStory(disputed({ rejected: false }))).toBe("");
    expect(disputeStory(disputed({ refunds: 0 }))).toBe("");
  });

  it("says a sandbox PAID as the sandbox's settlement once, and escapes a separate row", () => {
    const rails = [{ what: "SWIFT payout of an invoice", detail: "EUR 240.00, PAID, fee EUR 3.00" }, { what: "Card", detail: "EUR 1, PAID, x" }];
    const once = sandboxRails(rails);
    expect(once[0]!.detail).toBe(`EUR 240.00, PAID ${SANDBOX_SETTLED}, fee EUR 3.00`);
    expect(once[1]).toBe(rails[1]);
    expect(sandboxRails(once)[0]!.detail).toBe(once[0]!.detail);
    expect(separateRowHtml(undefined)).toBe("");
    expect(separateRowHtml(`A <b> & "c"`)).toBe(`<p class="septest">A &lt;b&gt; &amp; &quot;c&quot;; <b>not counted in the figures above</b>.</p>`);
  });

  it("replays a run: Alta's last refusal with its tx, older refusal lines worded by their ledger rows, and every Claude call", () => {
    const TX = `0x${"ab".repeat(32)}`;
    const r = record({
      snapshot: {
        counts: { alone: 0, blocked: 2 },
        flows: [
          flow({ at: "2026-11-05T10:00:00Z", refused: { by: "purser", reason: "mandate_cap_exceeded" } }),
          flow({ at: "2026-11-05T10:00:03Z", refused: { by: "metal", reason: "mandate_cap_exceeded" }, proof: { label: "tx", href: `https://testnet.metalntwx.com/tx/${TX}` } }),
        ],
        refusals: [{ seq: 1, ts: "x", agent: "sourcing", what: "purchase", reason: "refused on chain: over the cap" }, { seq: 2, ts: "x", agent: "sourcing", what: "purchase", reason: "the agent's own buy policy" }],
        agent_chat: [
          { ts: "2026-11-05T10:00:00Z", kind: "world", who: "world", by: null, model: null, text: "A purchase from Acme was refused before signing: mandate_cap_exceeded" },
          { ts: "2026-11-05T12:00:00Z", kind: "world", who: "world", by: null, model: null, text: "A purchase from Acme was refused before signing: no such row" },
          { ts: "2026-11-05T12:00:00Z", kind: "message", who: "sourcing", by: null, model: null, text: "kept" },
        ],
        agent_stats: [{ agent: "sourcing", decisions: 1, by_claude: 1, fallback: 0, claude_calls: 2, cost_usd_micros: 5000, models: [] }],
        tower: { agents: [], enforced: [{ who: "metal", count: 9, last: null }, { who: "airwallex", count: 9, last: null }, { who: "cfo", count: 1, last: null }] } as never,
        claude: { calls: 5, cost_usd_micros: 20000 },
        feed: [{ event: "transfer.status", text: "Transfer PAID" }, { event: "x", text: "y" }],
      } as never,
      ledger: { events: [row(1, "2026-11-05T10:00:00.400Z", "upstream.refused", "7", { reason: "mandate_cap_exceeded (cap 0.01)" })], proposals: [], disputes: [] },
    });
    const out = replayRecord(r);
    const enforced = (out.snapshot.tower as unknown as { enforced: { who: string; count: number; last: unknown }[] }).enforced;
    expect(enforced[0]).toEqual({ who: "metal", count: 1, last: { reason: "mandate_cap_exceeded", words: "Over the mandate's cap per payment", at: "2026-11-05T10:00:00Z", proof: { kind: "tx", ref: TX } } });
    expect(enforced[1]).toEqual({ who: "airwallex", count: 0, last: null });
    expect(enforced[2]).toEqual({ who: "cfo", count: 1, last: null });
    // The line its ledger row confirms is reworded; the one no row confirms is left out.
    expect(out.snapshot.agent_chat.map((c) => c.text)).toEqual([expect.not.stringContaining("refused before signing"), "kept"]);
    expect(out.figures.claude).toBe("5 Claude calls in all, $0.02: the agents' own 2 (USD 0.0050, as on Proof) and 3 more that read documents or review proposals.");
    expect(out.figures.refusedPill).toBe("2 stops");
    expect(out.figures.keptOut).toBe("2 stops: one buy rule Claude set stopped 1 overpriced check, and Alta refused 1 purchase. Alta's 1: 1 over the mandate's cap. The amount is what stayed out for good.");
    expect((out.snapshot as unknown as { feed: { text: string }[] }).feed.map((f) => f.text)).toEqual([`Transfer PAID ${SANDBOX_SETTLED}`, "y"]);
    // A run with no Claude summary and no stops on chain says neither.
    const bare = replayRecord(record());
    expect(bare.figures).toMatchObject({ stopped: 0, claude: "", refusedNote: "As on Home and Proof: 0 stops." });
  });
});
