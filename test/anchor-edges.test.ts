// The anchor's edges (src/anchor/): its chain port on Alta with the chain stood in for (a transaction not found is no
// transaction, one without a receipt is pending, and an anchor is sent to the key's own address with gas in USDZ); the
// sources it hashes refused when they are not what they say (not JSON, no audit links, no journal); a check against a
// record that names another chain, a missing transaction or a file no longer in the repository fails on that line; and
// the Merkle calldata and proofs refuse anything that is not their exact form.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  txs: new Map<string, { hash: string; from: string; to: string | null; input: string }>(),
  receipts: new Map<string, { blockNumber: bigint; status: "success" | "reverted" }>(),
  sent: [] as Record<string, unknown>[],
}));
vi.mock("../src/metal/chain.js", async (orig) => ({
  ...(await orig<typeof import("../src/metal/chain.js")>()),
  publicClient: () => ({
    chain: { id: 381 },
    request: async () => null,
    getTransaction: async ({ hash }: { hash: string }) => { const t = h.txs.get(hash); if (!t) throw new Error("TransactionNotFoundError"); return t; },
    getTransactionReceipt: async ({ hash }: { hash: string }) => { const r = h.receipts.get(hash); if (!r) throw new Error("TransactionReceiptNotFoundError"); return r; },
    waitForTransactionReceipt: async ({ hash }: { hash: string }) => h.receipts.get(hash)!,
  }),
  readKeyFile: () => ({ privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" }),
}));
vi.mock("@metalntwx/metal-ts", () => ({
  sendMip20Call: async (a: Record<string, unknown>) => { h.sent.push(a); h.receipts.set("0xsent", { blockNumber: 12n, status: "success" }); return "0xsent"; },
}));

const { metalChain, metalReader } = await import("../src/anchor/metalChain.js");
const { verifyAnchor } = await import("../src/anchor/anchor.js");
const { AnchorSourceError, computeAnchorHead, anchorCalldata } = await import("../src/anchor/head.js");
const { merkleCalldata, merkleTree, readMerkleCalldata, verifyInclusion } = await import("../src/anchor/merkle.js");
const { USDZ } = await import("../src/metal/network.js");

const KEY_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
beforeEach(() => { h.txs.clear(); h.receipts.clear(); h.sent = []; });

describe("the anchor's chain port on Alta", () => {
  it("a transaction the node does not have is none; one without a receipt is pending; a mined one has its block and status", async () => {
    const r = metalReader();
    expect(await r.getTx("0xnone")).toBeNull();
    h.txs.set("0xa", { hash: "0xa", from: KEY_ADDRESS, to: null, input: "0x01" });
    expect(await r.getTx("0xa")).toEqual({ hash: "0xa", from: KEY_ADDRESS, to: null, input: "0x01", blockNumber: null, status: "pending" });
    h.receipts.set("0xa", { blockNumber: 99n, status: "reverted" });
    expect(await r.getTx("0xa")).toMatchObject({ blockNumber: 99, status: "reverted" });
  });

  it("sends the calldata to the key's own address, with gas paid in USDZ, and answers the mined transaction", async () => {
    const out = await metalChain("keys/anchor.key.json").send("0xdeadbeef");
    expect(out).toEqual({ hash: "0xsent", from: KEY_ADDRESS, blockNumber: 12, status: "success" });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ to: KEY_ADDRESS, data: "0xdeadbeef", gasToken: USDZ, gasLimit: 200_000n, gasFallback: 200_000n, maxFeePerGas: 1n });
  });
});

describe("the sources an anchor hashes", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "anchor-")); mkdirSync(join(root, "docs"), { recursive: true }); });
  const write = (file: string, text: string) => writeFileSync(join(root, file), text);

  it("are refused when a record is not JSON, a trace has no audit links or no journal", () => {
    write("docs/r.json", "{not json");
    expect(() => computeAnchorHead(root, [{ name: "r", file: "docs/r.json", kind: "record-digest" }])).toThrow(new AnchorSourceError("docs/r.json: not JSON"));
    write("docs/t.json", JSON.stringify({ audit: { links: [] }, journal: [] }));
    expect(() => computeAnchorHead(root, [{ name: "a", file: "docs/t.json", kind: "audit-links" }])).toThrow("docs/t.json: no audit links");
    expect(() => computeAnchorHead(root, [{ name: "j", file: "docs/t.json", kind: "journal-digest" }])).toThrow("docs/t.json: no journal");
    write("docs/u.json", JSON.stringify({}));
    expect(() => computeAnchorHead(root, [{ name: "j", file: "docs/u.json", kind: "journal-digest" }])).toThrow("docs/u.json: no journal");
  });

  it("a record without steps still counts as one, and its head is its canonical hash", () => {
    write("docs/r.json", JSON.stringify({ b: 1, a: [2] }));
    write("docs/r2.json", JSON.stringify({ a: [2], b: 1 }));
    const one = computeAnchorHead(root, [{ name: "r", file: "docs/r.json", kind: "record-digest" }]);
    const two = computeAnchorHead(root, [{ name: "r", file: "docs/r2.json", kind: "record-digest" }]);
    expect(one.parts[0]!.height).toBe(1);
    expect(one.parts[0]!.head).toBe(two.parts[0]!.head);
  });

  it("a check against the record fails on each line that differs: the repo, the chain, the transaction", async () => {
    write("docs/r.json", JSON.stringify({ steps: [1, 2, 3] }));
    const sources = [{ name: "run", file: "docs/r.json", kind: "record-digest" as const }];
    const head = computeAnchorHead(root, sources);
    const record = { schema: "purser.anchor/v1", head: head.head, height: head.height, parts: head.parts, chain_id: 381, tx: "0xanchor", block: 12, from: KEY_ADDRESS } as never;
    // The transaction is not on chain, and the reader is on another chain.
    const missing = await verifyAnchor(root, record, { chainId: 1, getTx: async () => null });
    expect(missing.match).toBe(false);
    expect(missing.lines.filter((l) => !l.ok).map((l) => [l.what, l.detail])).toEqual([["chain", "chain id 1, the record says 381"], ["transaction", "0xanchor not found on chain"]]);
    // On chain as recorded: everything matches.
    const tx = { hash: "0xanchor", from: KEY_ADDRESS.toLowerCase(), to: KEY_ADDRESS, input: anchorCalldata(head), blockNumber: 12, status: "success" as const };
    expect((await verifyAnchor(root, record, { chainId: 381, getTx: async () => tx })).match).toBe(true);
    // In another block, with other calldata, and the file changed since: each named.
    write("docs/r.json", JSON.stringify({ steps: [1, 2, 3, 4] }));
    const changed = await verifyAnchor(root, record, { chainId: 381, getTx: async () => ({ ...tx, blockNumber: 13, input: "0x00" }) });
    expect(changed.lines.filter((l) => !l.ok).map((l) => l.what)).toEqual(["run", "repo head", "block", "calldata"]);
    expect(changed.lines.find((l) => l.what === "run")!.detail).toMatch(/\(anchored [0-9a-f]{16}…\)$/);
    expect(changed.lines.find((l) => l.what === "calldata")!.detail).toBe("not an anchor transaction");
    // The file gone: the repo line says why, and the calldata cannot match a head that was not recomputed.
    const gone = await verifyAnchor(root, { ...(record as object), parts: [{ ...head.parts[0]!, file: "docs/gone.json" }] } as never, { chainId: 381, getTx: async () => tx });
    expect(gone.lines[0]).toMatchObject({ ok: false, what: "repo" });
    expect(gone.lines.find((l) => l.what === "calldata")!.ok).toBe(false);
  });
});

describe("the Merkle anchor of the signed payments", () => {
  const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
  it("refuses a proof step that is not a hash or a side, and a proof for another root", () => {
    const { root, proofs } = merkleTree([A, B, C]);
    expect(verifyInclusion(B, proofs[1]!, root)).toBe(true);
    expect(verifyInclusion(B, [{ ...proofs[1]![0]!, side: "X" as "L" }, ...proofs[1]!.slice(1)], root)).toBe(false);
    expect(verifyInclusion(B, [{ ...proofs[1]![0]!, hash: "zz" }, ...proofs[1]!.slice(1)], root)).toBe(false);
    expect(verifyInclusion(A, proofs[1]!, root)).toBe(false);
  });

  it("writes its calldata only for a 64-hex root and a positive whole leaf count, and reads back only that form", () => {
    expect(() => merkleCalldata("A".repeat(64), 1)).toThrow("a root (64 hex) and a leaf count");
    expect(() => merkleCalldata(A, 0)).toThrow("a root (64 hex) and a leaf count");
    expect(() => merkleCalldata(A, 1.5)).toThrow("a root (64 hex) and a leaf count");
    expect(readMerkleCalldata(merkleCalldata(A, 3))).toEqual({ root: A, leaves: 3 });
    expect(readMerkleCalldata(`0x${Buffer.from("purser.anchor/v1 x").toString("hex")}`)).toBeNull();
    expect(readMerkleCalldata(`0x${Buffer.from(`purser.merkle/v1 ${A} three`).toString("hex")}`)).toBeNull();
  });
});
