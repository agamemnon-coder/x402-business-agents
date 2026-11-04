// A late review of the dispute desk (after fix-holdouts):
// - MEDIUM 1: a sale covered only by a refund proposal that can no longer run (EXPIRED, FAILED, SUPERSEDED,
//   NEEDS_REAPPROVAL, or pending past its expiry) is not "handled elsewhere": the next dispute about it puts it to the
//   CFO again, so the refund that is due comes back.
// - MEDIUM 2: a refund row counts as handled only while it is paid, under way or held (PAID, PENDING, HELD, PROPOSED),
//   or when a live proposal covers its sale; a REFUSED refund alone does not. The words say what actually happened.
// - LOW-MEDIUM 3: a dispute decided with nothing new is never silent: "none sold" goes to the CFO (dispute.escalated),
//   "all handled before" is recorded as dispute.handled_before, which the dashboard shows.
// - L2: a dispute the CFO has (D-ev<id>, or any dispute code could not settle) can be marked resolved by the CFO
//   (npm run s2 -- --resolve <id> --note "…"), once; its /health alert then clears, and the alert names that command.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decisionOf, recordDecision } from "../src/agents/disputeDecision.js";
import {
  cfoResolution, decideHandledBefore, decideNoneSold, disputeDecided, escalateDispute, escalatedUndecided, handledElsewhere, resolveByCfo,
} from "../src/agents/disputeSource.js";
import { publish } from "../src/autonomy/bus.js";
import { describe as describeEvent } from "../src/dashboard/snapshot.js";
import { openDb, type DB } from "../src/db/open.js";
import { health } from "../src/ops/health.js";

const PAYER = "0x00000000000000000000000000000000000000c1";
const A = "D-aaaaaaaa";
const B = "D-bbbbbbbb";
const T0 = new Date("2026-11-04T10:00:00.000Z");

function world(sales = 4): DB {
  const db = openDb(":memory:");
  for (let i = 0; i < sales; i++) db.prepare("INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES ('/v1/stock', 5, ?, 'u', ?, 'DELIVERED', 'now')").run(PAYER, JSON.stringify({ seq: i + 1 }));
  for (const id of [A, B]) db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, created_at) VALUES (?, ?, 'h', 'now')").run(id, PAYER);
  return db;
}
let n = 0;
function proposal(db: DB, status: string, saleIds: number[], dispute = A, expires = "2099-01-01T00:00:00Z"): string {
  const id = `P-${String(++n).padStart(4, "0")}`;
  db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, 'refund_batch', ?, ?, 'support', ?, ?, 'now')")
    .run(id, JSON.stringify({ dispute_id: dispute, refunds: saleIds.map((s) => ({ sale_id: String(s) })) }), `${id}`.padEnd(64, "0"), status, expires);
  return id;
}
const refund = (db: DB, sale: number, outcome: string, proposalId: string | null = null, dispute: string | null = A) =>
  db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome, proposal_id, dispute_id) VALUES (?, ?, 5, ?, ?, ?, ?)").run(sale, `refund-${sale}`, PAYER, outcome, proposalId, dispute);
const audits = (db: DB, event: string) => db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { subject: string; payload_json: string }[];

describe("MEDIUM 1: only a live refund proposal counts as handled", () => {
  it("dispute A's proposal expires: dispute B about the same sale goes to the CFO again", () => {
    const db = world();
    const p = proposal(db, "PENDING_APPROVAL", [1, 2]);
    expect([...handledElsewhere(db, [1, 2], B, T0).keys()]).toEqual([1, 2]);
    db.prepare("UPDATE proposals SET status = 'EXPIRED' WHERE proposal_id = ?").run(p);
    expect(handledElsewhere(db, [1, 2], B, T0).size).toBe(0);
  });

  it("a proposal FAILED, SUPERSEDED, NEEDS_REAPPROVAL, or pending past its expiry, does not count either", () => {
    for (const status of ["EXPIRED", "FAILED", "SUPERSEDED", "NEEDS_REAPPROVAL"]) {
      const db = world();
      proposal(db, status, [1]);
      expect(handledElsewhere(db, [1], B, T0).size, status).toBe(0);
    }
    const db = world();
    proposal(db, "PENDING_APPROVAL", [1], A, "2026-11-04T09:59:59Z");
    expect(handledElsewhere(db, [1], B, T0).size).toBe(0);
  });

  it("PENDING_APPROVAL, APPROVED, EXECUTING, EXECUTED and REJECTED do count: one order is put to the CFO once", () => {
    for (const status of ["PENDING_APPROVAL", "APPROVED", "EXECUTING", "EXECUTED", "REJECTED"]) {
      const db = world();
      const p = proposal(db, status, [1]);
      expect([...handledElsewhere(db, [1], B, T0).entries()], status).toEqual([[1, `sent to the CFO as ${p} (${status})`]]);
    }
  });
});

describe("MEDIUM 2: a refund counts only when it was paid, is under way or held, or a live proposal covers it", () => {
  it("a REFUSED refund under A is not handled: B decides that sale again", () => {
    const db = world();
    refund(db, 1, "REFUSED");
    expect(handledElsewhere(db, [1], B, T0).size).toBe(0);
  });

  it("a REFUSED refund whose sale a live proposal covers is handled, and the words say it was refused", () => {
    const db = world();
    const p = proposal(db, "APPROVED", [1]);
    refund(db, 1, "REFUSED", p);
    expect(handledElsewhere(db, [1], B, T0).get(1)).toBe(`refund refused under ${A}; sent to the CFO as ${p} (APPROVED)`);
    // The covering proposal expired: the refused refund is not handled any more.
    db.prepare("UPDATE proposals SET status = 'EXPIRED' WHERE proposal_id = ?").run(p);
    expect(handledElsewhere(db, [1], B, T0).size).toBe(0);
  });

  it("PAID, PENDING, HELD and PROPOSED count, each worded by its outcome (not all \"refunded\")", () => {
    const db = world();
    refund(db, 1, "PAID");
    refund(db, 2, "PENDING");
    refund(db, 3, "HELD", null, null);
    refund(db, 4, "PROPOSED");
    expect([...handledElsewhere(db, [1, 2, 3, 4], B, T0).entries()]).toEqual([
      [1, `refunded under ${A}`],
      [2, `refund sent under ${A}, not yet confirmed`],
      [3, "refund held at Metal under an earlier refund"],
      [4, `refund started under ${A}, not yet sent`],
    ]);
    // The dispute's own refunds are not "elsewhere" for itself.
    expect(handledElsewhere(db, [1, 2, 4], A, T0).size).toBe(0);
  });
});

describe("LOW-MEDIUM 3: a dispute decided with nothing new is never silent", () => {
  it("none of the disputed numbers was sold: decided once with nothing, and handed to the CFO (dashboard)", async () => {
    const db = world(0);
    await decideNoneSold(db, { id: B, customer: "Summit Outfitters" });
    expect(decisionOf(db, B)).toMatchObject({ status: "DONE", plan: { refunds: [], escalate: null, approval: null } });
    const esc = audits(db, "dispute.escalated");
    expect(esc).toHaveLength(1);
    expect(esc[0]!.subject).toBe(B);
    expect(JSON.parse(esc[0]!.payload_json)).toMatchObject({ customer: "Summit Outfitters", reason: "no disputed number matched a sale" });
    const row = db.prepare("SELECT * FROM audit_log WHERE event = 'dispute.escalated'").get() as Parameters<typeof describeEvent>[0];
    expect(describeEvent(row, () => undefined)).toMatchObject({ tone: "refusal", text: expect.stringContaining(`Dispute ${B} from Summit Outfitters sent to the CFO`) });
    // Decided once: a second call decides and escalates nothing again.
    await decideNoneSold(db, { id: B, customer: "Summit Outfitters" });
    expect(audits(db, "dispute.escalated")).toHaveLength(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM refunds").get() as { n: number }).n + (db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n).toBe(0);
  });

  it("every order was handled before: decided once with nothing new, recorded as dispute.handled_before, shown on the dashboard", async () => {
    const db = world();
    refund(db, 1, "PAID");
    const p = proposal(db, "REJECTED", [2]);
    const handled = handledElsewhere(db, [1, 2], B, T0);
    await decideHandledBefore(db, { id: B, customer: "Summit Outfitters" }, [...handled.entries()].map(([sale, why]) => `#${sale} (${why})`));
    expect(decisionOf(db, B)).toMatchObject({ status: "DONE", plan: { refunds: [], escalate: null, approval: null } });
    const rows = audits(db, "dispute.handled_before");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payload_json)).toMatchObject({ customer: "Summit Outfitters", handled: [`#1 (refunded under ${A})`, `#2 (sent to the CFO as ${p} (REJECTED))`] });
    const row = db.prepare("SELECT * FROM audit_log WHERE event = 'dispute.handled_before'").get() as Parameters<typeof describeEvent>[0];
    expect(describeEvent(row, () => undefined).text).toBe(`Dispute ${B} from Summit Outfitters: every order in it was handled before (#1 (refunded under ${A}), #2 (sent to the CFO as ${p} (REJECTED))); nothing new refunded or sent to the CFO`);
    // Written with the decision, once.
    await decideHandledBefore(db, { id: B, customer: "Summit Outfitters" }, ["#1"]);
    expect(audits(db, "dispute.handled_before")).toHaveLength(1);
  });
});

describe("L2: the CFO can mark a dispute it holds resolved, once; the alert clears and names the command", () => {
  it("a D-ev dispute: the /health alert names --resolve (not --dispute); resolved once, the alert clears", () => {
    const db = openDb(":memory:");
    const ev = publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", T0);
    const id = `D-ev${ev}`;
    escalateDispute(db, { id, customer: "Summit Outfitters" }, "a dispute came in without an email code can read; code never settles it", T0);
    const alert = health(db).alerts.find((a) => a.code === "dispute_with_cfo")!;
    expect(alert.words).toContain(`npm run s2 -- --resolve ${id} --note`);
    expect(alert.words).not.toContain(`--dispute ${id}`);
    expect(disputeDecided(db, id)).toBe(false);

    expect(() => resolveByCfo(db, id, "   ")).toThrow(/a note is required/);
    const r = resolveByCfo(db, id, "Called Summit; their email was blank, nothing is owed.", T0);
    expect(r).toMatchObject({ id, outcome: "resolved_by_cfo" });
    expect(cfoResolution(db, id)).toMatch(/^resolved by the CFO at 2026-11-04T10:00:00\.000Z: Called Summit/);
    expect(escalatedUndecided(db)).toEqual([]);
    expect(health(db).alerts.map((a) => a.code)).not.toContain("dispute_with_cfo");
    expect(disputeDecided(db, id)).toBe(true);
    const row = db.prepare("SELECT * FROM audit_log WHERE event = 'dispute.resolved_by_cfo'").get() as Parameters<typeof describeEvent>[0] & { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ outcome: "resolved_by_cfo", note: "Called Summit; their email was blank, nothing is owed.", moves_money: false });
    expect(describeEvent(row, () => undefined).text).toBe(`Dispute ${id} marked resolved by the CFO: Called Summit; their email was blank, nothing is owed. Nothing was refunded by code for it`);
    // Decided once.
    expect(() => resolveByCfo(db, id, "again")).toThrow(/already decided/);
    expect(audits(db, "dispute.resolved_by_cfo")).toHaveLength(1);
  });

  it("only a dispute with the CFO and not decided can be resolved: not one never handed over, not one decided", () => {
    const db = world();
    expect(() => resolveByCfo(db, "D-ev99", "x")).toThrow(/not with the CFO/);
    escalateDispute(db, { id: A, customer: "Summit Outfitters" }, "the settlement did not complete", T0);
    recordDecision(db, A, { source: "code", model: null, refunds: [], escalate: null, approval: null });
    expect(() => resolveByCfo(db, A, "x")).toThrow(/already decided/);
    expect(audits(db, "dispute.resolved_by_cfo")).toHaveLength(0);
    // A keyed dispute's alert still offers s2 --dispute, and --resolve once handled.
    escalateDispute(db, { id: B, customer: "Summit Outfitters" }, "the settlement did not complete", T0);
    const words = health(db).alerts.find((a) => a.code === "dispute_with_cfo")!.words;
    expect(words).toContain(`npm run s2 -- --dispute ${B}`);
    expect(words).toContain(`npm run s2 -- --resolve ${B} --note`);
  });

  describe("s2 --resolve, as a real process (no Claude, no chain, no key)", () => {
    const dirs: string[] = [];
    afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
    const repo = resolve(import.meta.dirname, "..");
    const s2 = (file: string, ...args: string[]) => {
      const env: NodeJS.ProcessEnv = { ...process.env, KIT11_DB: file };
      for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "METAL_RPC_URL", "KIT11_AGENTS"]) delete env[k];
      const r = spawnSync(resolve(repo, "node_modules/.bin/tsx"), [resolve(repo, "src/cli/s2.ts"), ...args], { cwd: repo, env, encoding: "utf8", timeout: 60_000 });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    };

    it("marks a D-ev dispute resolved with the note, once; without a note or for an unknown id it writes nothing", () => {
      const dir = mkdtempSync(join(tmpdir(), "kit11-s2resolve-")); dirs.push(dir);
      const file = join(dir, "world.sqlite");
      const db = openDb(file);
      const ev = publish(db, "dispute.opened", { customer: "Summit Outfitters" }, "support", "system", T0);
      const id = `D-ev${ev}`;
      escalateDispute(db, { id, customer: "Summit Outfitters" }, "a dispute came in without an email code can read; code never settles it", T0);
      db.close();
      const noNote = s2(file, "--resolve", id);
      expect(noNote.code, noNote.out).toBe(2);
      expect(noNote.out).toMatch(/a note is required/);
      const unknown = s2(file, "--resolve", "D-ev999", "--note", "x");
      expect(unknown.code, unknown.out).toBe(2);
      expect(unknown.out).toMatch(/not with the CFO/);
      const ok = s2(file, "--resolve", id, "--note", "Handled by phone; nothing owed.");
      expect(ok.code, ok.out).toBe(0);
      expect(ok.out).toContain(`RESOLVED         ${id} by the CFO: Handled by phone; nothing owed.`);
      const again = s2(file, "--resolve", id, "--note", "again");
      expect(again.code, again.out).toBe(2);
      expect(again.out).toMatch(/already decided/);
      const after = openDb(file);
      expect(escalatedUndecided(after)).toEqual([]);
      expect(audits(after, "dispute.resolved_by_cfo")).toHaveLength(1);
      after.close();
    }, 120_000);
  });
});
