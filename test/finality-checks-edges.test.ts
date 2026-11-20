// What verify says of the ledger's finality evidence (src/metal/finality.ts finalityChecks, checkCertificate): a REPORTED
// transaction whose certificate is missing fails, as does a FAILED one; NOT_KEPT and NOT_FOUND are notes; a certificate
// whose header does not hash to the block, or whose signer bitmap is not hex, does not pass.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { checkCertificate, finalityChecks, finalityOf, finalityView, MAX_TRIES } from "../src/metal/finality.js";

const TX = (n: number) => `0x${String(n).padStart(64, "0")}`;
const BLOCK = `0x${"ab".repeat(32)}`;

describe("verify's finality checks", () => {
  it("fail a REPORTED transaction without its certificate and a FAILED one; note the ones not kept or never final", () => {
    const db = openDb(":memory:");
    const add = (tx: string, status: string) => db.prepare("INSERT INTO finality_evidence (tx, block_hash, status, recorded_at) VALUES (?, ?, ?, '2026-11-20T10:00:00Z')").run(tx, BLOCK, status);
    add(TX(1), "REPORTED");
    add(TX(2), "FAILED");
    add(TX(3), "NOT_KEPT");
    add(TX(4), "NOT_FOUND");
    expect(finalityView(db)).toEqual({ reported: 1, not_kept: 1, failed: 1, not_found: 1, blocks: 0 });
    const out = finalityChecks(db);
    expect(out[0]).toMatchObject({ level: "fail", what: "finality certificates" });
    expect(out[0]!.detail).toContain(`failing or missing: ${TX(1).slice(0, 10)}`);
    expect(out[0]!.detail).toContain("1 transaction(s) with a failing certificate");
    expect(out.slice(1)).toEqual([
      { level: "note", what: "finality certificates", detail: "1 transaction(s) looked up after the node stopped keeping their block's certificate (about 2 hours on testnet)" },
      { level: "note", what: "finality certificates", detail: `1 transaction(s) never showed as final in ${MAX_TRIES} tries` },
    ]);
    expect(finalityOf(db, TX(1))).toMatchObject({ status: "REPORTED", block_number: null, check: null, certificate: null });
    expect(finalityOf(db, TX(9))).toBeNull();
  });

  it("a certificate whose header is not the block's, or whose bitmap is not hex, does not pass", () => {
    const c = { blockHash: BLOCK, blockNumber: 7, headerRlp: "0xzz", signersBitmap: "not hex", signerCount: 2, participants: 4 } as never;
    expect(checkCertificate(c, BLOCK, 4)).toMatchObject({ ok: false, header_matches: false, number_matches: false, bitmap_matches: false, quorum: { signers: 0, participants: 4, needed: 3, met: false } });
    const empty = { blockHash: BLOCK, blockNumber: 7, headerRlp: "0x00", signersBitmap: "0x", signerCount: 0, participants: 4 } as never;
    expect(checkCertificate(empty, BLOCK, 4)).toMatchObject({ ok: false, header_matches: false, bitmap_matches: true, quorum: { signers: 0, met: false } });
  });
});
