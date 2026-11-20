// Outside audit 2.1 (20 November): an approved payment refused by its executor before it began must not sit APPROVED,
// silent, until it expires (docs/evidence/chaos-money.md found 49 such scenarios, all at the EUR floor). Each refusal
// is recorded (execution.blocked, with the reason and the time), the proposal shows as BLOCKED_NEEDS_REVIEW wherever
// its status is shown, /health raises approved_blocked, and a restart does not try it again. It resolves when it
// expires or a person closes it; other terms need a new proposal and a new approval, never the old signature.
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuditReport } from "../src/audit/report.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { health } from "../src/ops/health.js";
import { beginExecution, closeBlocked, createProposal, decide, expireDue, finishExecution } from "../src/policy/approvals.js";
import { BLOCKED_ALERT, BLOCKED_EVENT, BLOCKED_STATUS, blockedApprovals, blockedCheck, shownStatus } from "../src/policy/blocked.js";
import { moneyActionState, resumeInterrupted } from "../src/policy/saga.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { approvalsApp } from "../src/servers/approvals.js";
import { standInLedger } from "../src/tokenize/standIn.js";

const FLOOR = "EUR would now drop under its floor, commitments and payouts under way; a new proposal is needed";

const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const blockRows = (db: DB, id: string) => (db.prepare("SELECT ts, payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq").all(BLOCKED_EVENT, id) as { ts: string; payload_json: string }[])
  .map((r) => ({ ts: r.ts, ...(JSON.parse(r.payload_json) as { reason: string; check: string; status: string }) }));
const alerts = (db: DB, now?: Date) => health(db, now).alerts;
const blockedAlert = (db: DB, id: string, now?: Date) => alerts(db, now).find((a) => a.code === BLOCKED_ALERT && a.words.startsWith(`${id} `));
const expiresAt = (db: DB, id: string) => (db.prepare("SELECT expires_at FROM proposals WHERE proposal_id = ?").get(id) as { expires_at: string }).expires_at;

/** Everything a CFO or an operator can see of one proposal: its status on each page, the alarm, the money state. */
function visible(db: DB, id: string, now = new Date()) {
  const snap = buildSnapshot(db, now);
  return {
    stored: status(db, id),
    shown: shownStatus(db, { proposal_id: id, status: status(db, id) }, now),
    dashboard: snap.decisions.find((d) => d.proposal_id === id)?.status,
    dashboard_blocked: (snap.blocked ?? []).map((b) => b.proposal_id),
    report: buildAuditReport(db, now).decisions.find((d) => d.proposal_id === id)?.status,
    money: moneyActionState(db, id, now).state,
    alarm: blockedAlert(db, id, now)?.severity ?? null,
  };
}

/** A real invoice payment, approved with a (virtual) passkey, with the real executor and an in-memory Airwallex. */
async function invoice() {
  const l = await standInLedger();
  const rail = new FakeAirwallex();
  return { ...l, rail };
}

describe("an approved invoice payment refused by its executor before it began", () => {
  it("at the EUR floor: recorded with its reason and time, shown as blocked everywhere, alarmed on /health, not retried", async () => {
    const { db, proposalId: id, rail } = await invoice();
    rail.bal.EUR.availableCents = 100; // far under the floor: another payment took the euros after the approval
    const before = Date.now();
    await expect(executeInvoicePayment(db, rail, rail, id)).rejects.toThrow(FLOOR);
    // Nothing was paid, and the proposal itself is still APPROVED in the state machine.
    expect(rail.transfers).toEqual([]);
    expect(status(db, id)).toBe("APPROVED");
    // (1) The durable record: the exact reason and the time.
    const rows = blockRows(db, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: FLOOR, check: "eur_floor", status: "APPROVED" });
    expect(Date.parse(rows[0]!.ts)).toBeGreaterThanOrEqual(before - 1000);
    // (2) The state a person sees, on every view that lists proposals.
    expect(visible(db, id)).toEqual({ stored: "APPROVED", shown: BLOCKED_STATUS, dashboard: BLOCKED_STATUS, dashboard_blocked: [id], report: BLOCKED_STATUS, money: "blocked", alarm: "warning" });
    expect(buildSnapshot(db).feed.some((f) => f.event === BLOCKED_EVENT && f.tone === "refusal" && f.text.includes(FLOOR))).toBe(true);
    // (3) The /health alarm names it, the reason and when; /health is no longer ok.
    const h = health(db);
    expect(h.status).toBe("alert");
    expect(h.metrics.approvals_blocked).toBe(1);
    expect(blockedAlert(db, id)!.words).toContain(FLOOR);
    expect(blockedAlert(db, id)!.since).toBe(rows[0]!.ts);
    // The same refusal again records nothing new; a restart does not run it again (the loop stops).
    await expect(executeInvoicePayment(db, rail, rail, id)).rejects.toThrow(FLOOR);
    expect(blockRows(db, id)).toHaveLength(1);
    const run = vi.fn(async () => {});
    const out = await resumeInterrupted(db, run);
    expect(run).not.toHaveBeenCalled();
    expect(out).toEqual([{ id, outcome: expect.stringMatching(new RegExp(`^${BLOCKED_STATUS}: EUR would now drop under its floor`)) as unknown as string }]);
    expect(rail.transfers).toEqual([]);
  }, 60_000);

  it("on a policy hold (the CFO's emergency stop): recorded as a policy hold, shown and alarmed", async () => {
    const { db, proposalId: id, rail } = await invoice();
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(new Date().toISOString());
    await expect(executeInvoicePayment(db, rail, rail, id)).rejects.toThrow(/emergency stop/);
    expect(blockRows(db, id)).toEqual([expect.objectContaining({ check: "policy_hold", reason: expect.stringContaining("the CFO pulled the emergency stop") as unknown as string })]);
    expect(visible(db, id)).toMatchObject({ stored: "APPROVED", shown: BLOCKED_STATUS, dashboard: BLOCKED_STATUS, money: "blocked", alarm: "warning" });
    expect(alerts(db).map((a) => a.code)).toEqual(expect.arrayContaining(["emergency_stop", BLOCKED_ALERT]));
    expect(rail.transfers).toEqual([]);
  }, 60_000);

  it("when its terms were changed after the passkey signed them: recorded and shown, with the critical tamper alarm (not twice)", async () => {
    const { db, proposalId: id, rail } = await invoice();
    const t = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string }).terms_json) as { amount: string };
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...t, amount: (Number(t.amount) - 1).toFixed(2) }), id);
    await expect(executeInvoicePayment(db, rail, rail, id)).rejects.toThrow(/terms do not match the approved hash/);
    expect(blockRows(db, id)).toEqual([expect.objectContaining({ check: "terms_changed" })]);
    expect(visible(db, id)).toMatchObject({ stored: "APPROVED", shown: BLOCKED_STATUS, dashboard: BLOCKED_STATUS, money: "blocked", alarm: null });
    expect(alerts(db).filter((a) => a.words.startsWith(`${id} `)).map((a) => [a.code, a.severity])).toEqual([["approved_terms_changed", "critical"]]);
    // The changed terms never run on the old signature, however often they are tried.
    await expect(executeInvoicePayment(db, rail, rail, id)).rejects.toThrow(/terms do not match the approved hash/);
    expect(rail.transfers).toEqual([]);
  }, 60_000);
});

const t0 = new Date("2026-11-20T09:00:00Z");
const terms = (id: string, total = "0.60"): Terms => ({ schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: "2026-11-20T10:00:00Z", total });
function approved(db: DB, t: Terms, at = t0): void {
  createProposal(db, { terms: t, createdBy: "support" }, at);
  decide(db, { proposalId: t.proposal_id, decision: "APPROVED", typedPrefix: termsHash(t).slice(0, 8), approver: "max", method: "cli" }, at);
}
/** Any executor: its own precondition refuses (here, the floor check's words). */
const refuseAtFloor = (db: DB, id: string, at: Date) => beginExecution(db, id, () => { throw new Error(FLOOR); }, at);
const runs = (db: DB, id: string, at: Date) => { beginExecution(db, id, () => {}, at); finishExecution(db, id, "EXECUTED", {}, at); };

describe("blocked at execution, in any executor (beginExecution)", () => {
  it("records only for an APPROVED proposal: not for one waiting, a failed run's retry or a restart's resume", () => {
    const db = openDb(":memory:");
    createProposal(db, { terms: terms("P-0001"), createdBy: "support" }, t0);
    expect(() => refuseAtFloor(db, "P-0001", t0)).toThrow(/not approved/);
    approved(db, terms("P-0002"), t0);
    beginExecution(db, "P-0002", () => {}, t0);
    finishExecution(db, "P-0002", "FAILED", { error: "Airwallex said no" }, t0);
    expect(() => refuseAtFloor(db, "P-0002", t0)).toThrow(FLOOR);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?").get(BLOCKED_EVENT)).toEqual({ n: 0 });
    expect(blockedApprovals(db, t0)).toEqual([]);
  });

  it("names the check that refused, from the executors' own words", () => {
    expect(blockedCheck(FLOOR)).toBe("eur_floor");
    expect(blockedCheck("USD would now drop under its floor; a new proposal is needed")).toBe("usd_floor");
    expect(blockedCheck("the treasury agent is paused by the CFO; nothing is paid until the CFO resumes it with Face ID")).toBe("policy_hold");
    expect(blockedCheck("Acme is blocked by the CFO policy; nothing is paid")).toBe("policy_hold");
    expect(blockedCheck("the approved payee ben_1 is no longer the active account of Acme (REPLACED); nothing is paid, a new proposal is needed")).toBe("payee_changed");
    expect(blockedCheck("P-0001: terms do not match the approved hash ab")).toBe("terms_changed");
    expect(blockedCheck("execution_refused_unsigned: no signature; no money moves on it")).toBe("unsigned");
    expect(blockedCheck("ledger_tampered: the audit log does not verify at row 3")).toBe("ledger_tampered");
    expect(blockedCheck("something new")).toBe("other");
  });
});

describe("a blocked approval resolves, and the alarm clears", () => {
  it("when it expires", () => {
    const db = openDb(":memory:");
    approved(db, terms("P-0001"));
    expect(() => refuseAtFloor(db, "P-0001", t0)).toThrow(FLOOR);
    expect(visible(db, "P-0001", t0)).toMatchObject({ shown: BLOCKED_STATUS, alarm: "warning" });
    const later = new Date("2026-11-20T10:00:01Z");
    // Past its expiry the alarm is gone at once, before anything marks it; then it is EXPIRED.
    expect(blockedAlert(db, "P-0001", later)).toBeUndefined();
    expect(expireDue(db, later)).toEqual(["P-0001"]);
    expect(visible(db, "P-0001", later)).toMatchObject({ stored: "EXPIRED", shown: "EXPIRED", dashboard: "EXPIRED", dashboard_blocked: [], money: "cancelled", alarm: null });
    expect(health(db, later).metrics.approvals_blocked).toBe(0);
  });

  it("when a person closes it (rejects it after the approval): NEEDS_REAPPROVAL, with the reason, and nothing runs", () => {
    const db = openDb(":memory:");
    approved(db, terms("P-0001"));
    expect(() => refuseAtFloor(db, "P-0001", t0)).toThrow(FLOOR);
    expect(() => closeBlocked(db, "P-0001", "00000000", "max", t0)).toThrow(/typed prefix/);
    closeBlocked(db, "P-0001", termsHash(terms("P-0001")).slice(0, 8), "max", t0);
    expect(visible(db, "P-0001", t0)).toMatchObject({ stored: "NEEDS_REAPPROVAL", shown: "NEEDS_REAPPROVAL", dashboard_blocked: [], money: "cancelled", alarm: null });
    const closed = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.needs_reapproval' AND subject = 'P-0001'").get() as { payload_json: string }).payload_json) as Record<string, string>;
    expect(closed).toMatchObject({ error: FLOOR, check: "eur_floor", from: "APPROVED", stopped: "closed by max after its execution was blocked" });
    expect(() => runs(db, "P-0001", t0)).toThrow(/NEEDS_REAPPROVAL, not approved/);
    // Only a blocked approval can be closed this way.
    approved(db, terms("P-0002"));
    expect(() => closeBlocked(db, "P-0002", termsHash(terms("P-0002")).slice(0, 8), "max", t0)).toThrow(/not blocked at execution/);
  });

  it("when it is re-approved with new terms: a new proposal and a new approval; the old signature never runs other terms", () => {
    const db = openDb(":memory:");
    approved(db, terms("P-0001", "0.60"));
    expect(() => refuseAtFloor(db, "P-0001", t0)).toThrow(FLOOR);
    // New terms written over the blocked proposal (a smaller amount that would fit) are refused: the signature was over 0.60.
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = 'P-0001'").run(JSON.stringify(terms("P-0001", "0.30")));
    expect(() => runs(db, "P-0001", t0)).toThrow(/terms do not match the approved hash/);
    expect(status(db, "P-0001")).toBe("APPROVED");
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = 'P-0001'").run(JSON.stringify(terms("P-0001", "0.60")));
    // The CFO closes it and approves the new terms as their own proposal; that one runs, and nothing stands on /health.
    closeBlocked(db, "P-0001", termsHash(terms("P-0001")).slice(0, 8), "max", t0);
    approved(db, terms("P-0002", "0.30"));
    runs(db, "P-0002", t0);
    expect(status(db, "P-0002")).toBe("EXECUTED");
    expect(blockedApprovals(db, t0)).toEqual([]);
    expect(alerts(db, t0).filter((a) => a.code === BLOCKED_ALERT)).toEqual([]);
  });

  it("when it runs after all (a person's run once the cause is gone): the derived state goes with it", () => {
    const db = openDb(":memory:");
    approved(db, terms("P-0001"));
    expect(() => refuseAtFloor(db, "P-0001", t0)).toThrow(FLOOR);
    runs(db, "P-0001", t0);
    expect(visible(db, "P-0001", t0)).toMatchObject({ stored: "EXECUTED", shown: "EXECUTED", dashboard_blocked: [], money: "settled", alarm: null });
  });
});

describe("the local approval page", () => {
  const servers: { close: () => void }[] = [];
  afterEach(() => { while (servers.length) servers.pop()!.close(); });

  it("lists a blocked approval first, with its reason, and closes it with the hash prefix", async () => {
    const db = openDb(":memory:");
    const t = { ...terms("P-0001"), expires_at: "2099-01-01T00:00:00Z" } as Terms;
    createProposal(db, { terms: t, createdBy: "support" });
    const server = approvalsApp(db, { approver: "max", execute: async (d, id) => { refuseAtFloor(d, id, new Date()); } }).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const token = async () => /<meta name="csrf" content="([^"]+)">/.exec(await (await fetch(base + "/")).text())?.[1] ?? "";
    const post = async (form: Record<string, string>) => {
      const { request } = await import("node:http");
      const body = new URLSearchParams({ csrf: await token(), ...form }).toString();
      return new Promise<{ status: number; text: string }>((resolve, reject) => {
        const req = request(`${base}/proposals/P-0001/decision`, { method: "POST", headers: { origin: base, "content-type": "application/x-www-form-urlencoded", "content-length": String(Buffer.byteLength(body)) } }, (r) => {
          let text = "";
          r.setEncoding("utf8").on("data", (c: string) => (text += c)).on("end", () => resolve({ status: r.statusCode ?? 0, text }));
        });
        req.on("error", reject);
        req.end(body);
      });
    };
    const prefix = termsHash(t).slice(0, 8);
    const approve = await post({ prefix, decision: "approve" });
    expect(approve.status).toBe(500);
    expect(approve.text).toContain(FLOOR);
    const page = await (await fetch(base + "/")).text();
    expect(page).toContain("Approved, blocked at execution (1)");
    expect(page).toContain(`status-${BLOCKED_STATUS}">${BLOCKED_STATUS}<`);
    expect(page).toContain(`refused at ${blockRows(db, "P-0001")[0]!.ts}: ${FLOOR}`);
    expect(page.match(/<article /g)).toHaveLength(1);
    const close = await post({ prefix, decision: "reject" });
    expect(close.status).toBe(303);
    expect(status(db, "P-0001")).toBe("NEEDS_REAPPROVAL");
    expect(await (await fetch(base + "/")).text()).not.toContain("Approved, blocked at execution");
  });
});

describe("the dashboard page", () => {
  it("renders the blocked list from the snapshot", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync(new URL("../src/dashboard/page.html", import.meta.url), "utf8");
    expect(page).toContain("(d.blocked || []).forEach");
    expect(page).toContain("Approved, blocked at execution · ");
    expect(page).toContain('x.status === "BLOCKED_NEEDS_REVIEW"');
  });

  it("keeps the expiry the alarm names", () => {
    const db = openDb(":memory:");
    approved(db, terms("P-0001"));
    expect(() => refuseAtFloor(db, "P-0001", t0)).toThrow(FLOOR);
    expect(blockedApprovals(db, t0)).toEqual([expect.objectContaining({ proposal_id: "P-0001", expires_at: expiresAt(db, "P-0001"), check: "eur_floor", severity: "warning", reason: FLOOR })]);
    expect(blockedAlert(db, "P-0001", t0)!.words).toContain(`stays blocked until ${expiresAt(db, "P-0001")}`);
  });
});
