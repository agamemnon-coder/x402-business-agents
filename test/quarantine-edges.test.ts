// Held payments at the sweep wallet (src/policy/quarantine.ts), the paths the main test leaves: a world without the
// wallets refuses to poll; a first poll with no cursor starts at block zero; an event that is not what it claims (its
// receipt does not hash to its id, it credits another wallet, or another token) is never recorded; accepting a held
// payment releases it to the sweep wallet; a release of a payment no longer held, or of a proposal that is no release,
// sends nothing. Against the red team's ReceivePolicy double; no chain.
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import type { Quarantined } from "../src/metal/receivePolicy.js";
import { createProposal, decide } from "../src/policy/approvals.js";
import { executeQuarantineRelease, pollQuarantine, quarantineReason, setupReceivePolicy } from "../src/policy/quarantine.js";
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
const statusOf = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const failure = (db: DB, id: string) => JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.failed' AND subject = ?").get(id) as { payload_json: string }).payload_json) as { error: string };

describe("polling", () => {
  it("names a reason it does not know by its number", () => {
    expect(quarantineReason(2)).toBe("sender not on the allowlist");
    expect(quarantineReason(9)).toBe("reason 9");
  });

  it("a world without its wallets refuses; a first poll with no cursor starts at block zero", async () => {
    const empty = openDb(":memory:");
    await expect(pollQuarantine(empty, new FakeReceivePolicy(), now)).rejects.toThrow("this world has no sweep wallet or business account yet (npm run bootstrap)");
    const { db, rp } = world();
    let asked = -1;
    const orig = rp.quarantinedSince.bind(rp);
    rp.quarantinedSince = async (r: Address, from: number) => { asked = from; return orig(r, from); };
    expect(await pollQuarantine(db, rp, now)).toBe(0);
    expect(asked).toBe(0);
  });

  it("never records an event that is not what it claims", async () => {
    const { db, rp } = world();
    await setupReceivePolicy(db, rp, KEY, now);
    rp.receive(X, W, 2n * UNIT);
    const real = (await rp.quarantinedSince(W, 0)).events[0]!;
    const forged: Quarantined[] = [
      { ...real, receiptId: `0x${"11".repeat(32)}` as Hex },
      { ...real, receipt: { ...real.receipt, receiver: B } },
      { ...real, receipt: { ...real.receipt, token: X } },
    ];
    rp.quarantinedSince = async () => ({ events: forged, next: 99 });
    expect(await pollQuarantine(db, rp, now)).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM quarantines").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
  });
});

describe("releasing a held payment", () => {
  it("accepting it releases it to the sweep wallet", async () => {
    const { db, rp } = world();
    await setupReceivePolicy(db, rp, KEY, now);
    rp.receive(X, W, 2n * UNIT);
    await pollQuarantine(db, rp, now);
    approve(db, "P-0002");
    await executeQuarantineRelease(db, rp, KEY, "P-0002", now);
    expect(rp.claims.map((c) => c.to)).toEqual([W]);
    expect(db.prepare("SELECT status FROM quarantines").get()).toEqual({ status: "ACCEPTED" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'quarantine.accepted'").get()).toEqual({ n: 1 });
    expect([statusOf(db, "P-0001"), statusOf(db, "P-0002")]).toEqual(["SUPERSEDED", "EXECUTED"]);
  });

  it("a payment no longer held, or no longer known, is not released", async () => {
    const { db, rp } = world();
    await setupReceivePolicy(db, rp, KEY, now);
    rp.receive(X, W, 2n * UNIT);
    await pollQuarantine(db, rp, now);
    approve(db, "P-0001");
    db.prepare("UPDATE quarantines SET status = 'RETURNED'").run();
    await expect(executeQuarantineRelease(db, rp, KEY, "P-0001", now)).rejects.toThrow(/^the held payment 0x[0-9a-f]{8}… is RETURNED, not held$/);
    db.prepare("DELETE FROM quarantines").run();
    await expect(executeQuarantineRelease(db, rp, KEY, "P-0001", now)).rejects.toThrow(/is unknown, not held$/);
    expect(rp.claims).toEqual([]);
  });

  it("a proposal that is no release is refused before anything is sent", async () => {
    const { db, rp } = world();
    createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-10-30T11:00:00Z", total: "0.10" } as Terms, createdBy: "support" }, now);
    approve(db, "P-0001");
    await expect(executeQuarantineRelease(db, rp, KEY, "P-0001", now)).rejects.toThrow("P-0001 is not a quarantine release");
    expect(statusOf(db, "P-0001")).toBe("APPROVED");
  });

  it("stored terms that no longer name the receipt's sender fail the release, and nothing is sent", async () => {
    const { db, rp } = world();
    await setupReceivePolicy(db, rp, KEY, now);
    rp.receive(X, W, 2n * UNIT);
    await pollQuarantine(db, rp, now);
    approve(db, "P-0001");
    db.prepare("UPDATE quarantines SET receipt_json = json_set(receipt_json, '$.amount', '1')").run();
    await expect(executeQuarantineRelease(db, rp, KEY, "P-0001", now)).rejects.toThrow("the stored receipt does not match the approved terms");
    expect(failure(db, "P-0001").error).toBe("the stored receipt does not match the approved terms");
    expect(rp.claims).toEqual([]);
  });
});
