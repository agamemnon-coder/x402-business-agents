// Finishing a sweep a crash interrupted (src/agents/sweep.ts resumeSweep), for a sweep whose pull was paid: nothing to
// do when there was no sweep, when it was refused or when its credit is already booked at Airwallex; otherwise it waits
// for Metal's finality of that same transfer, locks the credit once, and books the deposit at Airwallex once, found by
// its reference before one is made. Without Airwallex it stops after the lock and says so. Test money; no network.
import { beforeEach, describe, expect, it } from "vitest";
import type { Address, Hash } from "viem";
import { resumeSweep, type FinalTransfer } from "../src/agents/sweep.js";
import { openDb } from "../src/db/open.js";
import { FakeAirwallex } from "./fakes/airwallex.js";

const BUSINESS = "0x00000000000000000000000000000000000000b1" as Address;
const SWEEP = "0x00000000000000000000000000000000000000d1" as Address;
const ADDR = { business: BUSINESS, sweep: SWEEP };
const TX = `0x${"ab".repeat(32)}` as Hash;
const UNITS = 10n ** 16n;
let db: ReturnType<typeof openDb>;
let finals: [string, string, string, number][];
const finalize = async (tx: Hash, from: Address, to: Address, cents: number): Promise<FinalTransfer> => {
  finals.push([tx, from, to, cents]);
  return { eventKey: `63825:${tx}:0`, tx, logIndex: 0, block: 100, finalizedBlock: 102, amountUnits: BigInt(cents) * UNITS };
};
const noPull = async () => { throw new Error("a paid sweep is never pulled again"); };
const sweep = (paymentId: string, outcome: string, at: string, tx: string | null = null) =>
  db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES (?, 250, ?, ?, ?)").run(paymentId, tx, outcome, at);

beforeEach(() => { db = openDb(":memory:"); finals = []; });

describe("after a crash, the last sweep", () => {
  it("is nothing to finish when there was none, or only refused ones", async () => {
    expect(await resumeSweep(db, null, null, ADDR, { finalize, pull: noPull })).toBeNull();
    sweep("sweep-1", "REFUSED", "2026-11-19T10:00:00.000Z");
    expect(await resumeSweep(db, null, null, ADDR, { finalize, pull: noPull })).toBeNull();
    expect(finals).toEqual([]);
  });

  it("paid on chain: waits for finality of that transfer and locks the credit; without Airwallex it stops there and says so", async () => {
    sweep("sweep-1", "PAID", "2026-11-19T10:00:00.000Z", TX);
    expect(await resumeSweep(db, null, null, ADDR, { finalize, pull: noPull })).toEqual({ paymentId: "sweep-1", eventKey: `63825:${TX}:0`, depositId: null });
    expect(finals).toEqual([[TX, BUSINESS, SWEEP, 250]]);
    expect(db.prepare("SELECT event_key, awx_deposit_id, amount_base_units FROM chain_credits").all()).toEqual([{ event_key: `63825:${TX}:0`, awx_deposit_id: null, amount_base_units: (250n * UNITS).toString() }]);
    expect(db.prepare("SELECT event_key FROM sweeps WHERE payment_id = 'sweep-1'").get()).toEqual({ event_key: `63825:${TX}:0` });
    // Again, now with Airwallex: the lock is there, so no second wait for finality; the deposit is booked once.
    const awx = new FakeAirwallex();
    const done = await resumeSweep(db, awx, awx, ADDR, { finalize, pull: noPull });
    expect(done).toMatchObject({ paymentId: "sweep-1", eventKey: `63825:${TX}:0` });
    expect(done!.depositId).toBeTruthy();
    expect(finals).toHaveLength(1);
    expect(db.prepare("SELECT awx_deposit_id FROM chain_credits").get()).toEqual({ awx_deposit_id: done!.depositId });
    // Booked: nothing left to finish.
    expect(await resumeSweep(db, awx, awx, ADDR, { finalize, pull: noPull })).toBeNull();
    expect(awx.deposits.filter((d) => d.reference === TX)).toHaveLength(1);
  });

  it("only the latest sweep is finished, never an older one", async () => {
    sweep("sweep-1", "PAID", "2026-11-19T09:00:00.000Z", `0x${"01".repeat(32)}`);
    sweep("sweep-2", "PAID", "2026-11-19T10:00:00.000Z", TX);
    expect((await resumeSweep(db, null, null, ADDR, { finalize, pull: noPull }))!.paymentId).toBe("sweep-2");
    expect(finals.map((f) => f[0])).toEqual([TX]);
  });
});
