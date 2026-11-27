// Red team (runner, 27 Nov, finding 8, read in code): returning a held payment to its sender (src/policy/quarantine.ts
// executeQuarantineRelease, action "return") sends money on chain, and it had no emergency-stop check: with the CFO's
// stop on, an approved return still went out. Now a return is refused while the stop is on, before anything is sent, and
// again right before the claim. Accepting it into the sweep wallet sends nothing out and is not held by the stop.
// Test money only, no network.
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { decide } from "../src/policy/approvals.js";
import { executeQuarantineRelease, pollQuarantine, setupReceivePolicy } from "../src/policy/quarantine.js";
import { FakeReceivePolicy } from "../src/redteam/receivePolicy.js";

const now = new Date("2026-10-30T10:00:00Z");
const W = "0x00000000000000000000000000000000000000e1" as const;
const B = "0x00000000000000000000000000000000000000b1" as const;
const X = "0x00000000000000000000000000000000000000f9" as const;
const KEY = "sweep.key.json";
const UNIT = 10n ** 16n;

async function held() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO metal_accounts (address, role) VALUES (?, 'business'), (?, 'sweep')").run(B, W);
  const rp = new FakeReceivePolicy();
  await setupReceivePolicy(db, rp, KEY, now);
  rp.receive(X, W, 2n * UNIT);
  await pollQuarantine(db, rp, now);
  return { db, rp };
}
const approve = (db: DB, id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
};
const stop = (db: DB) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?) ON CONFLICT(key) DO UPDATE SET value = 'on'").run(now.toISOString());
const action = (db: DB, id: string) => (db.prepare("SELECT json_extract(terms_json, '$.action') AS a FROM proposals WHERE proposal_id = ?").get(id) as { a: string }).a;

describe("the emergency stop and a held payment's return (runner finding 8)", () => {
  it("an approved return is not sent while the stop is on", async () => {
    const { db, rp } = await held();
    expect(action(db, "P-0001")).toBe("return");
    approve(db, "P-0001");
    stop(db);
    await expect(executeQuarantineRelease(db, rp, KEY, "P-0001", now)).rejects.toThrow(/emergency stop/);
    expect(rp.claims).toEqual([]);
    expect(db.prepare("SELECT status FROM quarantines").get()).toEqual({ status: "OPEN" });
  });

  it("the stop pulled while the release reads the chain stops it before the claim", async () => {
    const { db, rp } = await held();
    approve(db, "P-0001");
    const isOpen = rp.isOpen.bind(rp);
    rp.isOpen = async (id) => { const open = await isOpen(id); stop(db); return open; };
    await expect(executeQuarantineRelease(db, rp, KEY, "P-0001", now)).rejects.toThrow(/emergency stop/);
    expect(rp.claims).toEqual([]);
  });

  it("accepting it into the sweep wallet sends nothing out and still runs under the stop", async () => {
    const { db, rp } = await held();
    expect(action(db, "P-0002")).toBe("accept");
    approve(db, "P-0002");
    stop(db);
    await executeQuarantineRelease(db, rp, KEY, "P-0002", now);
    expect(rp.claims.map((c) => c.to)).toEqual([W]);
  });
});
