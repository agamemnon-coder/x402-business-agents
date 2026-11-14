// Alta finality certificates as evidence (enterprise item 3). The fixture is a real certificate fetched from Alta
// testnet on 30 October 2026 (block 10067584). Checked here: the header hashes to the block and carries its number,
// the signer bitmap matches the signer count, the signers reach the quorum of the PINNED validator count. Not checked:
// the BLS signature, which needs validator keys Alta has not published for testnet; so a stored certificate is what
// Alta's RPC reported. They are fetched and stored while the node still keeps them (about 2 hours).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { certifyPending, checkCertificate, finalityChecks, finalityOf, finalityView, MAX_TRIES, quorumOf, RETENTION_BLOCKS, type FinalityCertificate, type FinalityPorts } from "../src/metal/finality.js";

const real = JSON.parse(readFileSync(new URL("./fixtures/finality-certificate-10067584.json", import.meta.url), "utf8")) as FinalityCertificate;
const BLOCK = real.blockHash;
const TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const at = new Date("2026-10-30T21:30:00Z");

describe("checking a finality certificate", () => {
  it("accepts Alta's real certificate for its block and says what it did not check", () => {
    const c = checkCertificate(real, BLOCK);
    expect(c).toMatchObject({ ok: true, header_matches: true, number_matches: true, bitmap_matches: true, quorum: { signers: 3, participants: 4, needed: 3, met: true } });
    expect(c.not_checked).toMatch(/BLS signature.*reported/);
  });

  it("refuses it for another block, a header that is not the block's, a bitmap that disagrees or too few signers", () => {
    expect(checkCertificate(real, TX(1)).ok).toBe(false);
    expect(checkCertificate({ ...real, headerRlp: `${real.headerRlp.slice(0, -2)}00` }, BLOCK)).toMatchObject({ ok: false, header_matches: false });
    expect(checkCertificate({ ...real, signersBitmap: "0x0f" }, BLOCK)).toMatchObject({ ok: false, bitmap_matches: false });
    expect(checkCertificate({ ...real, signersBitmap: "0x06", signerCount: 2 }, BLOCK)).toMatchObject({ ok: false, quorum: { met: false } });
    expect(checkCertificate({ ...real, signersBitmap: "0x10", signerCount: 1 }, BLOCK).bitmap_matches).toBe(false);
  });

  it("does not let a certificate set its own quorum: the validator count is pinned", () => {
    // One validator signing for a set of one would pass if the certificate's own count were used.
    expect(checkCertificate({ ...real, participants: 1, signerCount: 1, signersBitmap: "0x1" }, BLOCK)).toMatchObject({ ok: false, bitmap_matches: false });
  });

  it("refuses a certificate whose block number is not the one in its header", () => {
    expect(checkCertificate({ ...real, blockNumber: real.blockNumber + 1 }, BLOCK)).toMatchObject({ ok: false, number_matches: false });
  });

  it("uses the BFT quorum n - floor((n - 1) / 3)", () => {
    expect([1, 4, 7, 10, 100].map(quorumOf)).toEqual([1, 3, 5, 7, 67]);
  });
});

describe("storing the ledger's chain transactions' certificates", () => {
  const world = () => {
    const db = openDb(":memory:");
    for (const [id, n] of [["sw-1", 1], ["sw-2", 2]] as const) db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES (?, 135, ?, 'PAID', ?)").run(id, TX(n), at.toISOString());
    return db;
  };
  // TX(1) is in the real block; TX(2) in a block long past retention, whose certificate the node no longer has.
  const blocks: Record<string, { hash: string; number: number }> = { [TX(1)]: { hash: BLOCK, number: real.blockNumber }, [TX(2)]: { hash: TX(999), number: real.blockNumber - 500_000 } };
  const ports: FinalityPorts = {
    blockOf: async (tx) => blocks[tx] ?? null,
    certificate: async (block) => (block === BLOCK ? real : null),
    finalized: async () => real.blockNumber + 10,
  };

  it("stores a final transaction's certificate once, and marks one past retention NOT_KEPT", async () => {
    const db = world();
    expect(await certifyPending(db, ports, at)).toEqual({ reported: 1, not_kept: 1, failed: 0, pending: 0 });
    expect(await certifyPending(db, ports, at)).toEqual({ reported: 0, not_kept: 0, failed: 0, pending: 0 });
    expect(finalityOf(db, TX(1))).toMatchObject({ status: "REPORTED", block_number: 10067584, check: { ok: true } });
    expect(finalityOf(db, TX(2))).toMatchObject({ status: "NOT_KEPT" });
    expect(finalityOf(db, TX(3))).toBeNull();
    expect(finalityView(db)).toMatchObject({ reported: 1, not_kept: 1, failed: 0 });
  });

  it("tries again after an RPC error, and when a recent block's certificate is not there yet", async () => {
    const db = world();
    const failing: FinalityPorts = { ...ports, certificate: async () => { throw new Error("RPC timeout"); } };
    expect(await certifyPending(db, failing, at)).toMatchObject({ reported: 0, pending: 2 });
    expect(finalityOf(db, TX(1))).toBeNull();
    const notYet: FinalityPorts = { ...ports, certificate: async () => null };
    expect(await certifyPending(db, notYet, at)).toMatchObject({ not_kept: 1, pending: 1 });
    expect(finalityOf(db, TX(1))).toBeNull();
    expect(await certifyPending(db, ports, at)).toMatchObject({ reported: 1 });
    expect(RETENTION_BLOCKS).toBe(100_000);
  });

  it("gives a transaction that never becomes final up after MAX_TRIES, so it cannot starve the rest", async () => {
    const db = world();
    const never: FinalityPorts = { ...ports, blockOf: async () => null };
    for (let i = 0; i < MAX_TRIES; i++) await certifyPending(db, never, at);
    expect(finalityOf(db, TX(1))).toMatchObject({ status: "NOT_FOUND" });
    expect(finalityView(db).not_found).toBe(2);
  });

  it("never stores a certificate that fails its checks as good", async () => {
    const db = world();
    await certifyPending(db, { ...ports, certificate: async (b) => (b === BLOCK ? { ...real, signersBitmap: "0x06", signerCount: 2 } : null) }, at);
    expect(finalityOf(db, TX(1))).toMatchObject({ status: "FAILED", check: { ok: false } });
    expect(finalityView(db).failed).toBe(1);
  });
});

describe("npm run verify's finality line", () => {
  const fresh = async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sw-1', 135, ?, 'PAID', ?), ('sw-2', 135, ?, 'PAID', ?)").run(TX(1), at.toISOString(), TX(2), at.toISOString());
    await certifyPending(db, {
      blockOf: async (tx) => (tx === TX(1) ? { hash: BLOCK, number: real.blockNumber } : { hash: TX(999), number: 1 }),
      certificate: async (b) => (b === BLOCK ? real : null),
      finalized: async () => real.blockNumber,
    }, at);
    return db;
  };

  it("passes on good stored certificates and notes the ones not kept", async () => {
    const db = openDb(":memory:");
    expect(finalityChecks(db)).toEqual([expect.objectContaining({ level: "note" })]);
    expect(finalityChecks(await fresh()).map((c) => c.level)).toEqual(["ok", "note"]);
  });

  it("fails on a certificate edited afterwards, and on a REPORTED transaction whose certificate was deleted", async () => {
    const edited = await fresh();
    edited.prepare("UPDATE finality_certificates SET certificate_json = ?").run(JSON.stringify({ ...real, signersBitmap: "0x06", signerCount: 2 }));
    expect(finalityChecks(edited)[0]).toMatchObject({ level: "fail", detail: expect.stringMatching(/failing or missing: 0x00000000/) });
    const deleted = await fresh();
    deleted.prepare("DELETE FROM finality_certificates").run();
    expect(finalityChecks(deleted)[0]).toMatchObject({ level: "fail" });
  });
});
