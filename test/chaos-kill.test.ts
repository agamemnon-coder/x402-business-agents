// Backend review B2, the chaos test: a worker process runs a money action and is killed (SIGKILL) at each step in
// turn: after the quote, before and after the conversion, before and after the transfer, during its settlement,
// during a sweep (before and after the pull, after the deposit) and during a refund batch. A fresh process on the
// same ledger file then resumes it. After every kill: the action finishes, nothing is done twice at Airwallex or on
// chain, and the ledger reconciles with the outside world. Airwallex and the chain are fakes kept in files
// (test/support/chaos-world.ts); the ledger, the executors and the recovery are the real code.
import { fork } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { moneyActionState } from "../src/policy/saga.js";
import { chainPulls } from "./support/chaos-world.js";

interface World { dir: string; db: string; outside: string; chain: string }
const fresh = (): World => {
  const dir = mkdtempSync(join(tmpdir(), "chaos-"));
  return { dir, db: join(dir, "ledger.sqlite"), outside: join(dir, "airwallex.json"), chain: join(dir, "chain.json") };
};

/** One life of the runner. Resolves with how it ended: "ok", "killed", or the error it printed. */
function life(w: World, scenario: string, phase: string, crashAt = "-"): Promise<string> {
  return new Promise((done) => {
    const kid = fork(join(import.meta.dirname, "support/chaos-worker.ts"), [w.db, w.outside, w.chain, scenario, phase, crashAt], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let err = "";
    kid.stderr!.on("data", (d: Buffer) => { err += d.toString(); });
    kid.on("exit", (code, signal) => done(signal === "SIGKILL" ? "killed" : code === 0 ? "ok" : err.split("\n").filter((l) => /Error/.test(l)).slice(0, 2).join(" ") || `exit ${code}`));
  });
}

const outsideState = (w: World) => JSON.parse(readFileSync(w.outside, "utf8")) as { conversions: { requestId: string }[]; transfers: { requestId: string; status: string; amountCents: number; fee?: { cents: number } }[]; deposits: { reference: string; amountCents: number }[]; bal: { EUR: { availableCents: number } } };

const INVOICE_POINTS = ["conversion:before", "conversion:after-call", "conversion:after", "transfer:before", "transfer:after-create", "transfer:after-call", "transfer:after", "settle:before", "settle:after-call"];

describe("kill the runner after every step of a money action, then restart (chaos)", { timeout: 120_000 }, () => {
  it("after the quote: no proposal is left half-made, the next run proposes once and nothing is converted", async () => {
    const w = fresh();
    expect(await life(w, "invoice", "setup")).toBe("ok");
    expect(await life(w, "invoice", "propose", "quote:after")).toBe("killed");
    expect(await life(w, "invoice", "propose")).toBe("ok");
    const db = openDb(w.db);
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind = 'invoice_payment'").get()).toEqual({ n: 1 });
    expect(outsideState(w).conversions).toHaveLength(0);
  });

  for (const point of INVOICE_POINTS) {
    it(`euro invoice, killed at ${point}: resumes, converts once, pays once, reconciles`, async () => {
      const w = fresh();
      for (const phase of ["setup", "propose"]) expect(await life(w, "invoice", phase)).toBe("ok");
      const eurBefore = outsideState(w).bal.EUR.availableCents;
      expect(await life(w, "invoice", "run", point)).toBe("killed");
      const mid = openDb(w.db);
      const id = (mid.prepare("SELECT proposal_id FROM proposals WHERE kind = 'invoice_payment'").get() as { proposal_id: string }).proposal_id;
      expect(moneyActionState(mid, id).state).toBe("executing");
      mid.close();

      expect(await life(w, "invoice", "resume")).toBe("ok");
      const db = openDb(w.db);
      const out = outsideState(w);
      expect(moneyActionState(db, id).state).toBe("settled");
      expect(out.conversions).toHaveLength(1);
      expect(out.transfers).toHaveLength(1);
      expect(out.transfers[0]!.status).toBe("PAID");
      // The ledger and Airwallex agree: one conversion, one paid transfer, the euros moved exactly once.
      expect(db.prepare("SELECT COUNT(*) AS n FROM fx_conversions").get()).toEqual({ n: 1 });
      expect(db.prepare("SELECT status, transfer_id FROM transfers").all()).toEqual([{ status: "PAID", transfer_id: expect.any(String) }]);
      const conv = db.prepare("SELECT buy_amount FROM fx_conversions").get() as { buy_amount: string };
      const t = out.transfers[0]!;
      expect(out.bal.EUR.availableCents).toBe(eurBefore + Math.round(Number(conv.buy_amount) * 100) - t.amountCents - t.fee!.cents);
      expect(verifyAuditChain(db).ok).toBe(true);
    });
  }

  for (const point of ["refund 1:after", "refund:after-pull", "refund 2:before"]) {
    it(`refund batch, killed at ${point}: resumes, each refund pulled once, every hold settled`, async () => {
      const w = fresh();
      expect(await life(w, "refunds", "setup")).toBe("ok");
      expect(await life(w, "refunds", "run", point)).toBe("killed");
      expect(await life(w, "refunds", "resume")).toBe("ok");
      const db = openDb(w.db);
      const pulls = Object.entries(chainPulls(w.chain));
      expect(pulls.map(([id]) => id).sort()).toEqual(["refund-1", "refund-2", "refund-3"]);
      expect(db.prepare("SELECT outcome, COUNT(*) AS n, SUM(amount_cents) AS cents FROM refunds GROUP BY outcome").all()).toEqual([{ outcome: "PAID", n: 3, cents: 15 }]);
      expect(pulls.reduce((s, [, p]) => s + p.amountCents, 0)).toBe(15);
      expect(db.prepare("SELECT COUNT(*) AS n FROM holds WHERE status = 'HELD'").get()).toEqual({ n: 0 });
      expect(moneyActionState(db, "P-0001").state).toBe("settled");
    });
  }

  for (const point of ["sweep:before-pull", "sweep:after-pull", "deposit:after-call"]) {
    it(`sweep, killed at ${point}: resumes, pulled once, one deposit, the credit booked once`, async () => {
      const w = fresh();
      expect(await life(w, "sweep", "setup")).toBe("ok");
      expect(await life(w, "sweep", "run", point)).toBe("killed");
      expect(await life(w, "sweep", "resume")).toBe("ok");
      const db = openDb(w.db);
      expect(Object.keys(chainPulls(w.chain))).toEqual(["sweep-20261103-1"]);
      expect(outsideState(w).deposits.map((d) => d.amountCents)).toEqual([135]);
      expect(db.prepare("SELECT outcome FROM sweeps").all()).toEqual([{ outcome: "PAID" }]);
      expect(db.prepare("SELECT COUNT(*) AS n, COUNT(awx_deposit_id) AS booked FROM chain_credits").get()).toEqual({ n: 1, booked: 1 });
    });
  }
});
