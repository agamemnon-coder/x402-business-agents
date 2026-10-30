// Metal finality certificates as evidence (enterprise item 3). The fixture is a real certificate fetched from Metal
// testnet on 30 October 2026 (block 10067584). Checked here: the header hashes to the block, the signer bitmap matches
// the signer count, the signers reach the quorum. Not checked: the BLS aggregate signature, which needs validator keys
// Metal has not published for testnet. The certificates are fetched and stored while the node still keeps them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { certifyPending, checkCertificate, finalityOf, finalityView, quorumOf, type FinalityCertificate } from "../src/metal/finality.js";

const real = JSON.parse(readFileSync(new URL("./fixtures/finality-certificate-10067584.json", import.meta.url), "utf8")) as FinalityCertificate;
const BLOCK = real.blockHash;
const TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const at = new Date("2026-10-30T21:30:00Z");

describe("checking a finality certificate", () => {
  it("accepts Metal's real certificate for its block and says what it did not check", () => {
    const c = checkCertificate(real, BLOCK);
    expect(c).toMatchObject({ ok: true, header_matches: true, bitmap_matches: true, quorum: { signers: 3, participants: 4, needed: 3, met: true } });
    expect(c.not_checked).toMatch(/BLS/);
  });

  it("refuses it for another block, with a header that is not the block's, a bitmap that disagrees or too few signers", () => {
    expect(checkCertificate(real, TX(1)).ok).toBe(false);
    expect(checkCertificate({ ...real, headerRlp: `${real.headerRlp.slice(0, -2)}00` }, BLOCK)).toMatchObject({ ok: false, header_matches: false });
    expect(checkCertificate({ ...real, signersBitmap: "0x0f" }, BLOCK)).toMatchObject({ ok: false, bitmap_matches: false });
    expect(checkCertificate({ ...real, signersBitmap: "0x06", signerCount: 2 }, BLOCK)).toMatchObject({ ok: false, quorum: { met: false } });
    expect(checkCertificate({ ...real, signersBitmap: "0x10", signerCount: 1, participants: 4 }, BLOCK).bitmap_matches).toBe(false);
  });

  it("uses the BFT quorum n - floor((n - 1) / 3)", () => {
    expect([1, 4, 7, 10, 100].map(quorumOf)).toEqual([1, 3, 5, 7, 67]);
  });
});

describe("certifying the ledger's chain transactions", () => {
  const world = () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sw-1', 135, ?, 'PAID', ?)").run(TX(1), at.toISOString());
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sw-2', 135, ?, 'PAID', ?)").run(TX(2), at.toISOString());
    return db;
  };
  const blocks: Record<string, string> = { [TX(1)]: BLOCK, [TX(2)]: TX(999) };
  const ports = {
    blockOf: async (tx: string) => blocks[tx] ?? null,
    certificate: async (block: string) => (block === BLOCK ? real : null),
  };

  it("stores the certificate of a final transaction once, and marks one the node no longer keeps", async () => {
    const db = world();
    expect(await certifyPending(db, ports, at)).toEqual({ certified: 1, not_kept: 1, pending: 0 });
    expect(await certifyPending(db, ports, at)).toEqual({ certified: 0, not_kept: 0, pending: 0 });
    expect(finalityOf(db, TX(1))).toMatchObject({ status: "CERTIFIED", block_number: 10067584, check: { ok: true } });
    expect(finalityOf(db, TX(2))).toMatchObject({ status: "NOT_KEPT" });
    expect(finalityOf(db, TX(3))).toBeNull();
    expect(finalityView(db)).toMatchObject({ certified: 1, not_kept: 1, failed: 0 });
  });

  it("leaves a transaction it cannot place in a block yet for the next round", async () => {
    const db = world();
    expect(await certifyPending(db, { ...ports, blockOf: async () => null }, at)).toEqual({ certified: 0, not_kept: 0, pending: 2 });
    expect(finalityOf(db, TX(1))).toBeNull();
  });

  it("never stores a certificate that fails its checks as good", async () => {
    const db = world();
    await certifyPending(db, { ...ports, certificate: async (b) => (b === BLOCK ? { ...real, signersBitmap: "0x06", signerCount: 2 } : null) }, at);
    expect(finalityOf(db, TX(1))).toMatchObject({ status: "FAILED", check: { ok: false } });
    expect(finalityView(db).failed).toBe(1);
  });
});

describe("npm run verify's finality line", () => {
  it("passes on good stored certificates, notes the ones not kept, and fails on a tampered one", async () => {
    const { finalityChecks } = await import("../src/metal/finality.js");
    const db = openDb(":memory:");
    expect(finalityChecks(db)).toEqual([expect.objectContaining({ level: "note" })]);
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sw-1', 135, ?, 'PAID', ?), ('sw-2', 135, ?, 'PAID', ?)").run(TX(1), at.toISOString(), TX(2), at.toISOString());
    await certifyPending(db, { blockOf: async (tx) => (tx === TX(1) ? BLOCK : TX(999)), certificate: async (b) => (b === BLOCK ? real : null) }, at);
    expect(finalityChecks(db).map((c) => c.level)).toEqual(["ok", "note"]);
    // Someone edits the stored certificate afterwards: verify catches it.
    db.prepare("UPDATE finality_certificates SET certificate_json = ?").run(JSON.stringify({ ...real, signersBitmap: "0x06", signerCount: 2 }));
    expect(finalityChecks(db)[0]).toMatchObject({ level: "fail", detail: expect.stringMatching(/failing: 0x4075f6ec/) });
  });
});
