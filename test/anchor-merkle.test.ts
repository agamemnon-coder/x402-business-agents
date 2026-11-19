// The approvals' Merkle anchor (src/anchor/merkle.ts, npm run approvals:merkle): the tree, every proof, a tampered proof
// or hash refused, the calldata both ways, and the leaves from the committed run records. No network.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { approvalLeaves, leafHash, merkleCalldata, merkleTree, readMerkleCalldata, verifyInclusion } from "../src/anchor/merkle.js";

const h = (s: string) => createHash("sha256").update(s).digest("hex");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("the approvals' Merkle tree", () => {
  it("gives every leaf a proof that verifies, for every size from 1 to 17", () => {
    for (let n = 1; n <= 17; n++) {
      const hashes = Array.from({ length: n }, (_, i) => h(`terms ${n} ${i}`));
      const { root, proofs } = merkleTree(hashes);
      if (n === 1) expect(root).toBe(leafHash(hashes[0]!));
      hashes.forEach((x, i) => expect(verifyInclusion(x, proofs[i]!, root), `${n}/${i}`).toBe(true));
      // A proof is about one leaf: another leaf's hash with it fails.
      if (n > 1) expect(verifyInclusion(hashes[1]!, proofs[0]!, root)).toBe(false);
    }
  });
  it("refuses a tampered proof step, a flipped side, an empty list and a repeated hash", () => {
    const hashes = Array.from({ length: 5 }, (_, i) => h(String(i)));
    const { root, proofs } = merkleTree(hashes);
    const p = proofs[2]!;
    expect(verifyInclusion(hashes[2]!, [{ ...p[0]!, hash: h("x") }, ...p.slice(1)], root)).toBe(false);
    expect(verifyInclusion(hashes[2]!, [{ ...p[0]!, side: p[0]!.side === "L" ? "R" : "L" }, ...p.slice(1)], root)).toBe(false);
    expect(verifyInclusion(hashes[2]!, p.slice(1), root)).toBe(false);
    expect(() => merkleTree([])).toThrow(/no approvals/);
    expect(() => merkleTree([hashes[0]!, hashes[0]!])).toThrow(/twice/);
    expect(() => leafHash("ABC")).toThrow(/approval hash/);
  });
  it("is domain-separated: a node's hash never passes for a leaf (no second preimage over two leaves)", () => {
    const [a, b] = [h("a"), h("b")];
    const { root } = merkleTree([a, b]);
    // The root is a node; given as a one-leaf "approval", its leaf hash is not the root.
    expect(merkleTree([root]).root).not.toBe(root);
  });
  it("writes and reads the calldata, and reads nothing else as one", () => {
    const root = h("r");
    expect(readMerkleCalldata(merkleCalldata(root, 33))).toEqual({ root, leaves: 33 });
    expect(readMerkleCalldata(`0x${Buffer.from(`purser.anchor/v1 ${root} 33`).toString("hex")}`)).toBeNull();
    expect(() => merkleCalldata("nope", 1)).toThrow();
  });
});

describe("the leaves from the 19 November run records", () => {
  const soak = read("docs/runs/2026-11-19-airwallex-soak.json"), bills = read("docs/runs/2026-11-19-airwallex-bills.json");
  it("are the soak's 30 and the bills' 3 signed payments, each hash the one Airwallex read back", () => {
    const leaves = approvalLeaves(soak, bills);
    expect(leaves).toHaveLength(33);
    expect(leaves.every((l) => l.airwallex_sha256 === l.approval_sha256)).toBe(true);
  });
  it("match the committed Alta record, when it exists: root, every leaf and every proof", () => {
    const f = "docs/runs/2026-11-19-alta-merkle.json";
    if (!existsSync(f)) return;
    const rec = read(f) as { root: string; leaves: number; payments: { index: number; approval_sha256: string; proof: { side: "L" | "R"; hash: string }[] }[]; read_back: { matches: boolean } };
    const leaves = approvalLeaves(soak, bills);
    expect(merkleTree(leaves.map((l) => l.approval_sha256)).root).toBe(rec.root);
    expect(rec.leaves).toBe(leaves.length);
    expect(rec.read_back.matches).toBe(true);
    for (const p of rec.payments) expect(verifyInclusion(p.approval_sha256, p.proof, rec.root), String(p.index)).toBe(true);
  });
});
