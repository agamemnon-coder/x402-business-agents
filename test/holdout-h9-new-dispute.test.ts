// Blind holdout H9 (dry-173, finding 3 of docs/runs/holdouts/2026-11-03-blind/results.md): the live settlement was
// keyed to the fixture's dispute (D-2f8a03a4), so a new dispute that really came in (D-3b1e004f) was refused: no
// refund for the two orders the supplier's corrections prove wrong, and no escalation to the CFO either. Now:
// - any dispute that opened in this world (a dispute.opened event) is settled by its id, decided once;
// - an id that never opened stays refused (the night batch's live-14 lesson), by the tool and by s2 itself;
// - a dispute that came in and that code cannot settle goes to the CFO (dispute.escalated: the dashboard, /health);
// - a restart decides nothing twice; the fixture's dispute still settles.
// The settlement here is the real decision code (settleDispute, recordDecision, carryOut) on stand-in rails, reading
// the dispute's email from the ledger as s2 does; s2 itself runs as a real process only on its early paths (no
// network, no keys). A scripted fake Claude, never the real API.
import type Anthropic from "@anthropic-ai/sdk";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audit } from "../src/audit/log.js";
import { decisionOf, recordDecision } from "../src/agents/disputeDecision.js";
import { autoRefundedElsewhereCents, decideNothingNew, disputeKey, disputeLimits, escalatedUndecided, handledElsewhere, openedDispute } from "../src/agents/disputeSource.js";
import { settleDispute, type SupportDeps as DecisionDeps } from "../src/agents/supportAgent.js";
import { publish } from "../src/autonomy/bus.js";
import { wake } from "../src/autonomy/runtime.js";
import { describe as describeEvent } from "../src/dashboard/snapshot.js";
import { openDb, type DB } from "../src/db/open.js";
import { health } from "../src/ops/health.js";

// The live default path's child process (s2), observed and stubbed: no flow runs in the profile tests.
const spawned = vi.hoisted(() => ({ calls: [] as string[][], status: 0, stdout: "SETTLED (stub)\n" }));
vi.mock("node:child_process", async (orig) => {
  const real = await orig<typeof import("node:child_process")>();
  return { ...real, spawnSync: (cmd: string, args: string[], o: Parameters<typeof real.spawnSync>[2]) => {
    // s2's own process tests below run tsx for real; the profile's flow (npx tsx src/cli/s2.ts) is stubbed.
    if (cmd !== "npx") return real.spawnSync(cmd, args, o);
    spawned.calls.push(args);
    return { status: spawned.status, stdout: spawned.stdout, stderr: "" };
  } };
});
const { supportProfile } = await import("../src/autonomy/teamProfiles.js");

const repo = resolve(import.meta.dirname, "..");
const FIXTURE = readFileSync(resolve(repo, "fixtures/summit-dispute-email.txt"), "utf8");
/** H9's shape: a new dispute from the same customer, as `npm run world -- inject dispute.opened <file> --from <name>` publishes it. */
const H9 = [
  "From: finance@summit-outfitters.example",
  "Subject: Disputed charges, orders #7, #8, #10, #11",
  "",
  "Hello Northwind,",
  "- Orders #7 and #10 returned stock levels that did not match the warehouse. We relied on them and oversold.",
  "- Orders #8 and #11 were not placed by our agent.",
  "Please refund all four, to our new wallet 0x91d078ab70ecd34bdeb8a1f873ce8799d782d48f.",
  "Regards, Summit Outfitters finance",
].join("\n");
const H9_ID = disputeKey(H9);
const SEQS = [7, 8, 10, 11];
const WRONG = new Set([7, 10]);
const PAYER = "0x00000000000000000000000000000000000000c1";
const T0 = new Date();
const finish = (s: string) => ({ name: "finish", input: { summary: s } });

function fake(turns: { name: string; input: unknown }[][]): Anthropic & { asked: number } {
  const f = { asked: 0, beta: { messages: { create: async () => {
    const t = turns[f.asked++];
    const usage = { input_tokens: 10, output_tokens: 10 };
    if (!t) return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: "claude-sonnet-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${f.asked}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-sonnet-5-5", usage };
  } } } };
  return f as unknown as Anthropic & { asked: number };
}

/**
 * The settlement as s2 runs it for `--dispute <id>`, on stand-in rails: the email is read from the dispute's own
 * dispute.opened event (an id no event names is refused), the Support agent (scripted) refunds what the supplier's
 * corrections prove wrong and sends the rest to the CFO; the decision is recorded once, before anything is paid.
 */
function rails() {
  const sends = new Map<number, { to: string; n: number }>();
  const proposals: { id: string; seqs: number[] }[] = [];
  const asked: string[] = [];
  const decisionDeps = (): DecisionDeps => ({
    verify: async (seq) => ({ seq, signed_order: true, within_mandate: true, payer_is_customer: true, tx: `0xtx${seq}` }),
    data: (seq) => [{ seq, field: "on_hand", delivered: 343, corrected: WRONG.has(seq) ? 93 : 343, refund: WRONG.has(seq) }],
    priceCents: () => 5,
    // The refund goes to the paying account, whatever the email asks; a sale is refunded once.
    refund: async (seq) => { const s = sends.get(seq); sends.set(seq, { to: PAYER, n: (s?.n ?? 0) + 1 }); return { outcome: "PAID", tx: `0xrefund${seq}`, already: !!s }; },
    escalate: async (seqs) => { const id = `P-${String(proposals.length + 1).padStart(4, "0")}`; proposals.push({ id, seqs }); return { proposalId: id }; },
    earlier: () => ({ refunded: [...sends.keys()].map((seq) => ({ seq, cents: 5 })), escalated: proposals[0] ? { proposalId: proposals[0].id, seqs: proposals[0].seqs } : null }),
    existing: (part) => (part === "escalate" ? proposals[0]?.id ?? null : null),
    limits: { eachCents: 10, perDisputeCents: 20 },
  });
  const agent = () => fake([
    [...WRONG].map((seq) => ({ name: "refund", input: { seq, reason: "wrong stock level per the supplier's correction" } })),
    [{ name: "escalate_to_cfo", input: { seqs: SEQS.filter((s) => !WRONG.has(s)), advice: "Decline: signed by the customer's own mandate key, data right." } }],
  ]);
  const settle = async (d: DB, _by: "agent" | "code", id: string) => {
    asked.push(id);
    const opened = openedDispute(d, id);
    if (!opened && !decisionOf(d, id)) return { ok: false, text: `STOP no dispute ${id} opened in this world` };
    d.prepare("INSERT OR IGNORE INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES (?, ?, 'h', ?)").run(id, PAYER, new Date().toISOString());
    const r = await settleDispute(d, { disputeId: id, customer: opened?.customer ?? "?", seqs: SEQS, requested: "refund_all", email: opened?.email ?? "" }, decisionDeps(), agent());
    return { ok: true, text: r.already ? `ALREADY DECIDED ${r.already}` : `refunded ${r.refunded.map((x) => `#${x}`).join(", ")}; ${r.escalated ? `sent ${r.escalated.seqs.map((x) => `#${x}`).join(", ")} to the CFO as ${r.escalated.proposalId}` : "nothing to the CFO"}` };
  };
  return { sends, proposals, asked, deps: { settle, idOf: (email: string) => (email.trim() ? disputeKey(email) : null) } };
}
const tool = (w: Awaited<ReturnType<typeof wake>>) => w!.run!.calls.find((c) => c.tool === "settle_dispute")!;
const settleOnce = (db: DB, deps: Parameters<typeof supportProfile>[1], at = T0) =>
  wake(db, supportProfile(30 * 60_000, deps), { client: fake([[{ name: "settle_dispute", input: {} }], [finish("Done.")]]), now: at, force: true });

describe("H9: a new dispute that opened in this world is settled, once", () => {
  it("an injected new dispute: the gate settles it by its own id; #7 and #10 refunded once to the payer, #8 and #11 to the CFO", async () => {
    const db = openDb(":memory:");
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", T0);
    expect(H9_ID).not.toBe(disputeKey(FIXTURE));
    const r = rails();
    const w = await settleOnce(db, r.deps);
    expect(tool(w)).toMatchObject({ text: "refunded #7, #10; sent #8, #11 to the CFO as P-0001" });
    expect(tool(w).blocked).toBeUndefined();
    expect(r.asked).toEqual([H9_ID]);
    expect([...r.sends.entries()]).toEqual([[7, { to: PAYER, n: 1 }], [10, { to: PAYER, n: 1 }]]);
    expect(r.proposals).toEqual([{ id: "P-0001", seqs: [8, 11] }]);
    expect(decisionOf(db, H9_ID)).toMatchObject({ status: "DONE", paid: [7, 10], escalation_proposal: "P-0001" });

    // The same email again (H5's repeat): code says already decided, nothing is settled or paid again.
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", new Date(T0.getTime() + 1000));
    const again = await settleOnce(db, r.deps, new Date(T0.getTime() + 2000));
    expect(tool(again)).toMatchObject({ blocked: "already decided" });
    expect(r.asked).toEqual([H9_ID]);
    expect([...r.sends.values()].map((x) => x.n)).toEqual([1, 1]);
    expect(r.proposals).toHaveLength(1);
    expect(escalatedUndecided(db)).toEqual([]);
  });

  it("a restart (a new process on the same ledger file) does not decide it twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kit11-h9-"));
    try {
      const file = join(dir, "world.sqlite");
      const first = openDb(file);
      publish(first, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", T0);
      const r = rails();
      await settleOnce(first, r.deps);
      first.close();
      const db = openDb(file);
      const w = await settleOnce(db, r.deps, new Date(T0.getTime() + 60 * 60_000));
      expect(tool(w)).toMatchObject({ blocked: "already decided" });
      expect(String(tool(w).text)).toMatch(new RegExp(`Already decided: ${H9_ID}: .*Nothing is decided again`));
      expect((db.prepare("SELECT COUNT(*) AS n FROM dispute_decisions WHERE dispute_id = ?").get(H9_ID) as { n: number }).n).toBe(1);
      expect([...r.sends.values()].map((x) => x.n)).toEqual([1, 1]);
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a restart that cut the decision off carries out THAT decision for the new dispute (by its id), deciding nothing again", async () => {
    const db = openDb(":memory:");
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", T0);
    db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES (?, ?, 'h', ?)").run(H9_ID, PAYER, T0.toISOString());
    recordDecision(db, H9_ID, { source: "claude", model: "m", refunds: [{ seq: 7, cents: 5, origin: null }], escalate: null, approval: null });
    spawned.calls.length = 0;
    const w = await settleOnce(db, undefined);
    expect(tool(w)).toMatchObject({ text: expect.stringMatching(/^Carried out the dispute's recorded decision \(nothing decided again\)/) });
    expect(spawned.calls).toEqual([["tsx", "src/cli/s2.ts", "--dispute", H9_ID]]);
  });

  it("the fixture's dispute (the world's own `dispute` command) still settles, by its own id", async () => {
    const db = openDb(":memory:");
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: FIXTURE.slice(0, 2000) }, "support", "system", T0);
    spawned.calls.length = 0;
    const w = await settleOnce(db, undefined);
    expect(tool(w)).toMatchObject({ text: "SETTLED (stub)" });
    expect(spawned.calls).toEqual([["tsx", "src/cli/s2.ts", "--dispute", "D-2f8a03a4"]]);
  });

  it("live: an injected dispute reaches s2 with its own id (D-3b1e004f's case), not the fixture's", async () => {
    const db = openDb(":memory:");
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", T0);
    spawned.calls.length = 0;
    const w = await settleOnce(db, undefined);
    expect(tool(w)).toMatchObject({ text: "SETTLED (stub)" });
    expect(spawned.calls).toEqual([["tsx", "src/cli/s2.ts", "--dispute", H9_ID]]);
  });

  it("a newer dispute already with the CFO does not hold up an older one (review): the older one is settled", async () => {
    const db = openDb(":memory:");
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", T0);
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: FIXTURE }, "support", "system", new Date(T0.getTime() + 1));
    audit(db, "support", "dispute.escalated", disputeKey(FIXTURE), { customer: "Summit Outfitters", reason: "the settlement did not complete", origin: { actor: "code", rule: "r", agent: "support" } }, T0);
    spawned.calls.length = 0;
    await settleOnce(db, undefined);
    expect(spawned.calls).toEqual([["tsx", "src/cli/s2.ts", "--dispute", H9_ID]]);
  });

  it("the newest dispute decided, an older one not: the older one is settled (none is skipped)", async () => {
    const db = openDb(":memory:");
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", T0);
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: FIXTURE }, "support", "system", new Date(T0.getTime() + 1));
    recordDecision(db, disputeKey(FIXTURE), { source: "code", model: null, refunds: [], escalate: null, approval: null });
    db.prepare("UPDATE dispute_decisions SET status = 'DONE'").run();
    spawned.calls.length = 0;
    await settleOnce(db, undefined);
    expect(spawned.calls).toEqual([["tsx", "src/cli/s2.ts", "--dispute", H9_ID]]);
  });
});

describe("H9: a dispute that never opened stays refused (live-14)", () => {
  it("a routine wake with no dispute.opened: the tool and the fallback settle nothing and escalate nothing", async () => {
    const db = openDb(":memory:");
    spawned.calls.length = 0;
    const w = await settleOnce(db, undefined);
    expect(tool(w)).toMatchObject({ blocked: "no dispute", text: "Not settled: no customer dispute has come in." });
    expect(spawned.calls).toEqual([]);
    expect(escalatedUndecided(db)).toEqual([]);
    expect(health(db).alerts.map((a) => a.code)).not.toContain("dispute_with_cfo");
  });

  it("a dispute.opened with no email names no dispute: nothing is settled, and it goes to the CFO as D-ev<event> (review)", async () => {
    const db = openDb(":memory:");
    const ev = publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", T0);
    spawned.calls.length = 0;
    const w = await settleOnce(db, undefined);
    expect(tool(w)).toMatchObject({ blocked: "no dispute" });
    expect(String(tool(w).text)).toMatch(new RegExp(`A dispute came in without an email code can read \\(D-ev${ev}\\): with the CFO, never settled by code`));
    expect(spawned.calls).toEqual([]);
    expect(escalatedUndecided(db).map((x) => x.id)).toEqual([`D-ev${ev}`]);
    await settleOnce(db, undefined);
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'dispute.escalated'").get() as { n: number }).n).toBe(1);
  });

  describe("s2 itself, as a real process (early paths only: no Claude, no chain, no key)", () => {
    const dirs: string[] = [];
    afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
    const s2 = (file: string, ...args: string[]) => {
      const env: NodeJS.ProcessEnv = { ...process.env, KIT11_DB: file };
      for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "METAL_RPC_URL", "KIT11_AGENTS"]) delete env[k];
      const r = spawnSync(resolve(repo, "node_modules/.bin/tsx"), [resolve(repo, "src/cli/s2.ts"), ...args], { cwd: repo, env, encoding: "utf8", timeout: 60_000 });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    };
    const ledger = () => { const dir = mkdtempSync(join(tmpdir(), "kit11-s2h9-")); dirs.push(dir); return join(dir, "world.sqlite"); };

    it("refuses an id no dispute.opened names (also the fixture's, when it never opened here), writing nothing", () => {
      const file = ledger();
      const db = openDb(file);
      publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", T0);
      const rows = (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
      db.close();
      for (const id of ["D-00000000", disputeKey(FIXTURE), "not-an-id"]) {
        const r = s2(file, "--dispute", id);
        expect(r.code, r.out).toBe(2);
        expect(r.out).toMatch(/STOP {13}no dispute .* opened in this world \(no dispute\.opened event names it\); nothing is settled/);
      }
      const after = openDb(file);
      expect((after.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n).toBe(rows);
      expect((after.prepare("SELECT COUNT(*) AS n FROM disputes").get() as { n: number }).n).toBe(0);
      after.close();
    }, 120_000);

    it("a new dispute decided and carried out: --dispute says already decided; --resume-only finds nothing to carry out", () => {
      const file = ledger();
      const db = openDb(file);
      publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", T0);
      recordDecision(db, H9_ID, { source: "code", model: null, refunds: [], escalate: null, approval: null });
      db.prepare("UPDATE dispute_decisions SET status = 'DONE' WHERE dispute_id = ?").run(H9_ID);
      db.close();
      const again = s2(file, "--dispute", H9_ID);
      expect(again.code, again.out).toBe(0);
      expect(again.out).toMatch(new RegExp(`ALREADY DECIDED  ${H9_ID}: .*decided by code.*Nothing is decided again`));
      expect(s2(file, "--resume-only").out).toMatch(/no decision to carry out; nothing to do/);
    }, 120_000);
  });
});

describe("H9: when code cannot settle a dispute that came in, Support hands it to the CFO", () => {
  it("a settlement tied to another dispute (the sim's rails) refuses it, and the dispute goes to the CFO once: dashboard and /health", async () => {
    const db = openDb(":memory:");
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", T0);
    let settled = 0;
    const tied = { settle: async () => { settled++; return { ok: true, text: "x" }; }, settles: () => "D-2f8a03a4" };
    const w = await settleOnce(db, tied);
    expect(settled).toBe(0);
    expect(tool(w)).toMatchObject({ blocked: "no dispute" });
    expect(String(tool(w).text)).toMatch(new RegExp(`is not the one this settlement handles \\(D-2f8a03a4\\)\\. It went to the CFO \\(${H9_ID}, recorded as dispute\\.escalated\\); a person decides it\\.`));
    const rows = db.prepare("SELECT actor, subject, payload_json FROM audit_log WHERE event = 'dispute.escalated'").all() as { actor: string; subject: string; payload_json: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "support", subject: H9_ID });
    expect(JSON.parse(rows[0]!.payload_json)).toMatchObject({ customer: "Summit Outfitters", origin: { actor: "code", agent: "support" } });
    expect(health(db).alerts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "dispute_with_cfo", severity: "warning", words: expect.stringContaining(H9_ID) })]));
    const ev = db.prepare("SELECT * FROM audit_log WHERE event = 'dispute.escalated'").get() as Parameters<typeof describeEvent>[0];
    expect(describeEvent(ev, () => undefined).text).toMatch(new RegExp(`Dispute ${H9_ID} from Summit Outfitters sent to the CFO`));
    // The fallback (no Claude) on the next event: refused again, recorded once, says it is with the CFO.
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", new Date(T0.getTime() + 1));
    const f = await wake(db, supportProfile(30 * 60_000, tied), { client: null, now: T0 });
    expect(f!.summary).toMatch(/^did nothing: the dispute that came in .*It was sent to the CFO at /);
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'dispute.escalated'").get() as { n: number }).n).toBe(1);
    expect(settled).toBe(0);
    // Support's own view says so.
    expect(await supportProfile(30 * 60_000, tied).observe(db)).toMatch(new RegExp(`Sent to the CFO, not decided: ${H9_ID}`));
    // Nothing is refunded or proposed by the handover itself.
    expect((db.prepare("SELECT COUNT(*) AS n FROM refunds").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n).toBe(0);
  });

  it("a settlement that does not complete goes to the CFO, is not retried within half an hour, and the alarm clears once it is decided", async () => {
    const db = openDb(":memory:");
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", T0);
    spawned.status = 1;
    spawned.stdout = "escalate: expected a dispute\n";
    try {
      spawned.calls.length = 0;
      const w = await settleOnce(db, undefined);
      expect(tool(w)).toMatchObject({ blocked: "the settlement did not complete" });
      expect(String(tool(w).text)).toMatch(/It went to the CFO/);
      const again = await settleOnce(db, undefined);
      expect(tool(again)).toMatchObject({ blocked: "with the CFO" });
      expect(spawned.calls).toHaveLength(1);
    } finally { spawned.status = 0; spawned.stdout = "SETTLED (stub)\n"; }
    expect(health(db).alerts.map((a) => a.code)).toContain("dispute_with_cfo");
    recordDecision(db, H9_ID, { source: "code", model: null, refunds: [], escalate: null, approval: null });
    expect(health(db).alerts.map((a) => a.code)).not.toContain("dispute_with_cfo");
    expect(escalatedUndecided(db)).toEqual([]);
  });
});

describe("refund limits are unchanged", () => {
  it("a dispute's refunds stay within 0.10 each and 0.20 per dispute: a fifth wrong order goes to the CFO, never paid automatically", async () => {
    const db = openDb(":memory:");
    publish(db, "dispute.opened", { customer: "Summit Outfitters", email: H9 }, "support", "system", T0);
    const sends: number[] = [];
    const deps: DecisionDeps = {
      verify: async (seq) => ({ seq, signed_order: true, within_mandate: true, payer_is_customer: true, tx: `0x${seq}` }),
      data: (seq) => [{ seq, field: "on_hand", delivered: 1, corrected: 0, refund: true }],
      priceCents: () => 5, refund: async (seq) => { sends.push(seq); return { outcome: "PAID", tx: `0xr${seq}` }; },
      escalate: async () => ({ proposalId: "P-0001" }), earlier: () => ({ refunded: sends.map((seq) => ({ seq, cents: 5 })), escalated: null }),
      limits: { eachCents: 10, perDisputeCents: 20 },
    };
    const client = fake([[5, 6, 7, 8, 9].map((seq) => ({ name: "refund", input: { seq, reason: "wrong" } })), [{ name: "escalate_to_cfo", input: { seqs: [9], advice: "Over the automatic limit." } }]]);
    const r = await settleDispute(db, { disputeId: H9_ID, customer: "Summit Outfitters", seqs: [5, 6, 7, 8, 9], requested: "refund_all", email: H9 }, deps, client);
    expect(r.run.calls.filter((c) => c.blocked === "automatic limit").map((c) => (c.input as { seq: number }).seq)).toEqual([9]);
    expect(sends).toEqual([5, 6, 7, 8]);
  });
});

describe("one order, once, across disputes (an angrier second email is a new dispute id)", () => {
  it("orders an earlier dispute refunded or put to the CFO are handled elsewhere; a dispute of only those is decided with nothing new", async () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 4; i++) db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('/v1/stock', 5, ?, 'u', '{}', 'DELIVERED', 'now')").run(PAYER);
    db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES ('D-11111111', ?, 'h', 'now')").run(PAYER);
    db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, dispute_id) VALUES (1, 'refund-1', 5, ?, 'PAID', 'D-11111111')").run(PAYER);
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-0001', 'refund_batch', ?, ?, 'support', 'REJECTED', '2099-01-01T00:00:00Z', 'now')")
      .run(JSON.stringify({ dispute_id: "D-11111111", refunds: [{ sale_id: "2" }, { sale_id: "3" }] }), "a".repeat(64));
    const h = handledElsewhere(db, [1, 2, 3, 4], "D-22222222");
    expect([...h.entries()]).toEqual([[1, "refunded under D-11111111"], [2, "sent to the CFO as P-0001"], [3, "sent to the CFO as P-0001"]]);
    // The earlier dispute's own orders are not "elsewhere" for itself (its restart carries them out).
    expect(handledElsewhere(db, [1, 2, 3], "D-11111111").size).toBe(0);
    await decideNothingNew(db, "D-22222222");
    expect(decisionOf(db, "D-22222222")).toMatchObject({ status: "DONE", plan: { refunds: [], escalate: null, approval: null } });
    expect((db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n).toBe(1);
  });
});

describe("the automatic per-dispute limit is shared by the customer's disputes (review: no splitting a complaint)", () => {
  it("what other disputes refunded without the CFO comes off this dispute's limit; CFO-approved refunds and other payers do not", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 6; i++) db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('/v1/stock', 5, ?, 'u', '{}', 'DELIVERED', 'now')").run(i < 5 ? PAYER : "0x00000000000000000000000000000000000000c2");
    for (const id of ["D-11111111", "D-22222222"]) db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES (?, ?, 'h', 'now')").run(id, PAYER);
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-0001', 'refund_batch', '{}', ?, 'support', 'EXECUTED', '2099-01-01T00:00:00Z', 'now')").run("b".repeat(64));
    const refund = (sale: number, dispute: string, outcome = "PAID", proposal: string | null = null, to = PAYER) =>
      db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, proposal_id, dispute_id) VALUES (?, ?, 5, ?, ?, ?, ?)").run(sale, `refund-${sale}`, to, outcome, proposal, dispute);
    refund(1, "D-11111111");
    refund(2, "D-11111111", "HELD");
    refund(3, "D-11111111", "REFUSED");
    refund(4, "D-11111111", "PAID", "P-0001");
    refund(6, "D-11111111", "PAID", null, "0x00000000000000000000000000000000000000c2");
    expect(autoRefundedElsewhereCents(db, PAYER.toUpperCase().replace("0X", "0x"), "D-22222222")).toBe(10);
    expect(disputeLimits({ eachCents: 10, perDisputeCents: 20 }, db, PAYER, "D-22222222")).toEqual({ eachCents: 10, perDisputeCents: 10 });
    // Its own refunds are counted by the dispute itself, not here.
    expect(disputeLimits({ eachCents: 10, perDisputeCents: 20 }, db, PAYER, "D-11111111")).toEqual({ eachCents: 10, perDisputeCents: 20 });
    // Never below zero, never above the policy.
    refund(5, "D-11111111");
    expect(disputeLimits({ eachCents: 10, perDisputeCents: 10 }, db, PAYER, "D-22222222").perDisputeCents).toBe(0);
  });
});
