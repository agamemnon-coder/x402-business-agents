// The audit chain's checks (src/audit/log.ts) name the first row that breaks it: a missing or repeated seq, a prev_hash
// that is not the previous row's, a row whose content no longer gives its hash; and over a published list of links, a
// row_hash that is not a SHA-256 digest. An unbroken chain answers its height and head.
import { describe, expect, it } from "vitest";
import { audit, checkChainLinks, verifyAuditChain, verifyAuditRows } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";

type Row = Parameters<typeof verifyAuditRows>[0][number];
function chain(): Row[] {
  const db = openDb(":memory:");
  const t = new Date("2026-11-19T10:00:00Z");
  for (const e of ["a", "b", "c"]) audit(db, "system", `test.${e}`, e, { e }, t);
  expect(verifyAuditChain(db)).toMatchObject({ ok: true, rows: 3 });
  return db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as Row[];
}

describe("the audit rows", () => {
  it("an unbroken chain answers its height and the last row's hash", () => {
    const rows = chain();
    expect(verifyAuditRows(rows)).toEqual({ ok: true, rows: 3, head: rows[2]!.row_hash });
    expect(verifyAuditRows([])).toMatchObject({ ok: true, rows: 0 });
  });

  it("a row taken out, repeated or relinked is named, at the first row that breaks", () => {
    const rows = chain();
    expect(verifyAuditRows([rows[0]!, rows[2]!])).toEqual({ ok: false, seq: 3, reason: "gap: expected seq 2" });
    expect(verifyAuditRows([rows[0]!, rows[0]!])).toEqual({ ok: false, seq: 1, reason: "gap: expected seq 2" });
    expect(verifyAuditRows([rows[0]!, { ...rows[1]!, prev_hash: "0".repeat(64) }, rows[2]!])).toEqual({ ok: false, seq: 2, reason: "prev_hash does not match the previous row" });
    expect(verifyAuditRows([rows[0]!, { ...rows[1]!, payload_json: JSON.stringify({ e: "B" }) }, rows[2]!])).toEqual({ ok: false, seq: 2, reason: "row_hash does not match the row" });
  });
});

describe("a published list of links", () => {
  it("must run 1..n from the genesis, each linked to the one before, each hash a SHA-256 digest", () => {
    const links = chain().map(({ seq, prev_hash, row_hash }) => ({ seq, prev_hash, row_hash }));
    expect(checkChainLinks(links)).toEqual({ ok: true, rows: 3, head: links[2]!.row_hash });
    expect(checkChainLinks(links.slice(1))).toEqual({ ok: false, seq: 2, reason: "gap: expected seq 1" });
    expect(checkChainLinks([links[0]!, { ...links[1]!, prev_hash: links[2]!.row_hash }])).toEqual({ ok: false, seq: 2, reason: "prev_hash does not match the previous row" });
    expect(checkChainLinks([{ ...links[0]!, row_hash: links[0]!.row_hash.toUpperCase() }])).toEqual({ ok: false, seq: 1, reason: "row_hash is not a SHA-256 hex digest" });
  });
});
