// npm run anchor and npm run verify-anchor (src/anchor/*), against a mocked chain: the head is recomputed from the
// committed records, the calldata round-trips, the live path writes a dated record, and verify-anchor says MATCH only
// when the repo, the record and the transaction all agree.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { latestRecordFile, readRecord, sendAnchor, verifyAnchor, writeRecord, type AnchorChain, type AnchorTx } from "../src/anchor/anchor.js";
import { ANCHOR_SOURCES, anchorCalldata, computeAnchorHead, readAnchorCalldata } from "../src/anchor/head.js";

const FROM = "0x00000000000000000000000000000000000a11ce";
const TX = `0x${"ab".repeat(32)}`;

/** A copy of the anchored files in a temp dir, so a test can tamper with them. */
function repoCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "anchor-"));
  for (const f of new Set(ANCHOR_SOURCES.map((s) => s.file))) { mkdirSync(join(dir, f, ".."), { recursive: true }); cpSync(f, join(dir, f)); }
  mkdirSync(join(dir, "docs/runs"), { recursive: true });
  return dir;
}

/** A chain that keeps what was sent and returns it. */
function mockChain(): AnchorChain & { txs: Map<string, AnchorTx>; sent: number } {
  const txs = new Map<string, AnchorTx>();
  const c = {
    chainId: 63825, txs, sent: 0,
    async send(calldata: `0x${string}`) {
      c.sent++;
      txs.set(TX, { hash: TX, from: FROM, to: FROM, input: calldata, blockNumber: 1234, status: "success" });
      return { hash: TX, from: FROM, blockNumber: 1234, status: "success" as const };
    },
    async getTx(hash: string) { return txs.get(hash) ?? null; },
  };
  return c;
}

describe("the anchor head", () => {
  it("is recomputed from the committed records, each verified on its own", () => {
    const a = computeAnchorHead(".");
    expect(a.head).toMatch(/^[0-9a-f]{64}$/);
    expect(a.parts.map((p) => p.kind)).toEqual(["audit-rows", "audit-links", "journal-digest"]);
    // The decision log's head is the one docs/audit/README.md and the pages print.
    expect(a.parts[0]).toMatchObject({ height: 194, head: "ee0732445a717f7386b4c6ccd94c0f5459b515e1d3e0869833c10d328fd83618" });
    // The main run's audit chain ends at the head its trace states.
    const trace = JSON.parse(readFileSync("docs/demo/main-run-trace.json", "utf8")) as { audit: { rows: number; head: string }; journal: unknown[] };
    expect(a.parts[1]).toMatchObject({ height: trace.audit.rows, head: trace.audit.head });
    expect(a.parts[2]!.height).toBe(trace.journal.length);
    expect(a.height).toBe(a.parts.reduce((n, p) => n + p.height, 0));
    expect(computeAnchorHead(".").head).toBe(a.head);
  });

  it("puts the head in readable calldata and reads it back", () => {
    const a = computeAnchorHead(".");
    const data = anchorCalldata(a);
    expect(Buffer.from(data.slice(2), "hex").toString("utf8")).toBe(`purser.anchor/v1 ${a.head} ${a.height}`);
    expect(readAnchorCalldata(data)).toEqual({ head: a.head, height: a.height });
    expect(readAnchorCalldata("0x")).toBeNull();
    expect(readAnchorCalldata("0xa9059cbb")).toBeNull();
    expect(readAnchorCalldata("not hex")).toBeNull();
  });

  it("refuses a source that does not verify on its own", () => {
    const dir = repoCopy();
    const f = join(dir, "docs/audit/friday-1-audit.jsonl");
    writeFileSync(f, readFileSync(f, "utf8").replace(/"actor":"system"/, '"actor":"human"'));
    expect(() => computeAnchorHead(dir)).toThrow(/friday-1-audit\.jsonl: row \d+/);
  });
});

describe("npm run anchor --live, then npm run verify-anchor", () => {
  it("sends one transaction, writes a dated record, and verifies as MATCH", async () => {
    const dir = repoCopy();
    const chain = mockChain();
    const record = await sendAnchor(dir, chain, new Date("2026-11-13T12:00:00Z"));
    expect(chain.sent).toBe(1);
    expect(record).toMatchObject({ tx: TX, block: 1234, from: FROM, chain_id: 63825, head: computeAnchorHead(dir).head });
    const files = writeRecord(dir, record);
    expect(files.json).toMatch(/docs\/runs\/2026-11-13-anchor\.json$/);
    expect(readFileSync(files.md, "utf8")).toContain(record.head);
    expect(readFileSync(files.md, "utf8")).toContain("npm run verify-anchor");
    expect(latestRecordFile(dir)).toBe(files.json);
    const check = await verifyAnchor(dir, readRecord(files.json), chain);
    expect(check.lines.filter((l) => !l.ok)).toEqual([]);
    expect(check.match).toBe(true);
  });

  it("is MISMATCH when a line of the books changed after anchoring", async () => {
    const dir = repoCopy();
    const chain = mockChain();
    const record = await sendAnchor(dir, chain);
    const f = join(dir, "docs/demo/main-run-trace.json");
    const trace = JSON.parse(readFileSync(f, "utf8")) as { journal: { amount: string }[] };
    expect(trace.journal[0]!.amount).toBe("20.00");
    trace.journal[0]!.amount = "21.00";
    writeFileSync(f, JSON.stringify(trace, null, 2));
    const check = await verifyAnchor(dir, record, chain);
    expect(check.match).toBe(false);
    expect(check.lines.find((l) => l.what.startsWith("books"))?.ok).toBe(false);
    expect(check.lines.find((l) => l.what === "calldata")?.ok).toBe(false);
  });

  it("is MISMATCH when the decision log lost its last row", async () => {
    const dir = repoCopy();
    const chain = mockChain();
    const record = await sendAnchor(dir, chain);
    const f = join(dir, "docs/audit/friday-1-audit.jsonl");
    writeFileSync(f, readFileSync(f, "utf8").trim().split("\n").slice(0, -1).join("\n") + "\n");
    expect((await verifyAnchor(dir, record, chain)).match).toBe(false);
  });

  it("is MISMATCH when the record was rewritten to a new head the chain never saw", async () => {
    const dir = repoCopy();
    const chain = mockChain();
    const record = await sendAnchor(dir, chain);
    const f = join(dir, "docs/audit/friday-1-audit.jsonl");
    // Rehash the whole log from an edit, and rewrite the record to match: only the transaction still holds the old head.
    writeFileSync(f, readFileSync(f, "utf8").trim().split("\n").slice(0, -1).join("\n") + "\n");
    const forged = { ...record, head: computeAnchorHead(dir).head, parts: computeAnchorHead(dir).parts };
    const check = await verifyAnchor(dir, forged, chain);
    expect(check.match).toBe(false);
    expect(check.lines.find((l) => l.what === "calldata")?.ok).toBe(false);
  });

  it("is MISMATCH when the transaction is unknown, reverted or on another chain", async () => {
    const dir = repoCopy();
    const chain = mockChain();
    const record = await sendAnchor(dir, chain);
    expect((await verifyAnchor(dir, { ...record, tx: `0x${"cd".repeat(32)}` }, chain)).match).toBe(false);
    chain.txs.set(TX, { ...chain.txs.get(TX)!, status: "reverted" });
    expect((await verifyAnchor(dir, record, chain)).match).toBe(false);
    chain.txs.set(TX, { ...chain.txs.get(TX)!, status: "success" });
    expect((await verifyAnchor(dir, record, { ...chain, chainId: 1 })).match).toBe(false);
    expect((await verifyAnchor(dir, record, chain)).match).toBe(true);
  });

  it("refuses to record a reverted transaction", async () => {
    const dir = repoCopy();
    const chain = mockChain();
    chain.send = async () => ({ hash: TX, from: FROM, blockNumber: 1, status: "reverted" });
    await expect(sendAnchor(dir, chain)).rejects.toThrow(/reverted/);
  });

  it("keeps no secret in the record", async () => {
    const dir = repoCopy();
    const files = writeRecord(dir, await sendAnchor(dir, mockChain()));
    const text = readFileSync(files.json, "utf8") + readFileSync(files.md, "utf8");
    expect(text).not.toMatch(/privateKey|METAL_RPC_URL=https?:|KIT11_KEYS_DIR/);
  });
});
