// B1 in Purser: the sweep wallet accepts *USDZ only from Northwind's business account. A payment from anyone else is
// held by Alta's ReceivePolicy in quarantine; Purser records it, never bridges it, and the CFO decides with Face ID:
// return it to the sender, or accept it.
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

function world() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO metal_accounts (address, role) VALUES (?, 'business'), (?, 'sweep')").run(B, W);
  return { db, rp: new FakeReceivePolicy() };
}
const approve = (db: DB, id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
};

describe("the sweep wallet's receive policy", () => {
  it("sets allowlist-only with quarantine and allows only the business account; running it again changes nothing", async () => {
    const { db, rp } = world();
    expect(await setupReceivePolicy(db, rp, KEY, now)).toMatchObject({ changed: true });
    expect(await rp.policyOf(W)).toMatchObject({ allowlistOnly: true, refusal: 1, recovery: 1 });
    expect(await rp.senderAllowed(W, B)).toBe(true);
    expect(await setupReceivePolicy(db, rp, KEY, now)).toMatchObject({ changed: false });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'receive_policy.set'").get()).toEqual({ n: 1 });
  });
});

describe("a payment from an unknown sender", () => {
  // Breaks if a quarantined credit is missed, recorded twice, or could be bridged to Airwallex.
  it("is recorded once as held, with the chain reference and two options for the CFO", async () => {
    const { db, rp } = world();
    await setupReceivePolicy(db, rp, KEY, now);
    expect(rp.receive(B, W, 500n * UNIT)).toBe(true);
    expect(rp.receive(X, W, 2n * UNIT)).toBe(false);
    expect(await pollQuarantine(db, rp, now)).toBe(1);
    expect(await pollQuarantine(db, rp, now)).toBe(0);
    const q = db.prepare("SELECT originator, amount_units, status, chain_id, tx_hash, log_index FROM quarantines").all();
    expect(q).toEqual([{ originator: X, amount_units: (2n * UNIT).toString(), status: "OPEN", chain_id: 63825, tx_hash: expect.stringMatching(/^0x/), log_index: 0 }]);
    const props = db.prepare("SELECT proposal_id, terms_json FROM proposals ORDER BY proposal_id").all() as { proposal_id: string; terms_json: string }[];
    expect(props.map((p) => JSON.parse(p.terms_json)).map((t) => [t.kind, t.action, t.to, t.amount])).toEqual([
      ["quarantine_release", "return", X, "0.02"],
      ["quarantine_release", "accept", W, "0.02"],
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM chain_credits").get()).toEqual({ n: 0 });
  });

  it("goes back to the sender after the CFO approves returning it; the other option is superseded", async () => {
    const { db, rp } = world();
    await setupReceivePolicy(db, rp, KEY, now);
    rp.receive(X, W, 2n * UNIT);
    await pollQuarantine(db, rp, now);
    await expect(executeQuarantineRelease(db, rp, KEY, "P-0001", now)).rejects.toThrow(/not approved/);
    approve(db, "P-0001");
    await executeQuarantineRelease(db, rp, KEY, "P-0001", now);
    expect(rp.claims.map((c) => c.to)).toEqual([X]);
    expect(db.prepare("SELECT status FROM quarantines").get()).toEqual({ status: "RETURNED" });
    expect(db.prepare("SELECT proposal_id, status FROM proposals ORDER BY proposal_id").all()).toEqual([
      { proposal_id: "P-0001", status: "EXECUTED" }, { proposal_id: "P-0002", status: "SUPERSEDED" },
    ]);
  });

  it("is not claimed again once it is no longer open at Alta", async () => {
    const { db, rp } = world();
    await setupReceivePolicy(db, rp, KEY, now);
    rp.receive(X, W, 2n * UNIT);
    await pollQuarantine(db, rp, now);
    approve(db, "P-0002");
    rp.openIds.clear();
    await expect(executeQuarantineRelease(db, rp, KEY, "P-0002", now)).rejects.toThrow(/no longer holds/);
    expect(rp.claims).toHaveLength(0);
  });
});

describe("held payments on the dashboard and the phone", () => {
  // Breaks if a held payment is invisible to the CFO, or the phone cannot show what releasing it does.
  it("shows the held payment in the treasury and the feed, and both options on the phone", async () => {
    const { buildSnapshot, summarize } = await import("../src/dashboard/snapshot.js");
    const { describeTerms } = await import("../src/approve/client.js");
    const { db, rp } = world();
    await setupReceivePolicy(db, rp, KEY, now);
    rp.receive(X, W, 2n * UNIT);
    await pollQuarantine(db, rp, now);
    const s = buildSnapshot(db, now);
    expect(s.treasury.metal.quarantine).toEqual([{ receipt_id: expect.stringMatching(/^0x/), from: X, amount: "0.02", reason: "sender not on the allowlist", status: "OPEN", tx: expect.stringMatching(/^0x/) }]);
    const texts = s.feed.map((f) => f.text);
    expect(texts).toContain(`Alta held 0.02 test USD sent to the sweep wallet by an unknown sender ${X.slice(0, 6)}…${X.slice(-4)} (sender not on the allowlist); it waits for you`);
    expect(texts).toContain("The sweep wallet now accepts test USD only from the business account; anything else is held by Alta in quarantine");
    const terms = (id: string) => (db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string }).terms_json;
    expect(summarize("quarantine_release", terms("P-0001"))).toBe(`Return 0.02 test USD held in quarantine to its sender ${X}`);
    expect(describeTerms(JSON.parse(terms("P-0002")), {})).toMatchObject({ approvable: true, title: "Accept a held payment", big: "0.02", unit: "test USD" });
  });
});
