// Many approvals, one Alta transaction (19 Nov): the hash of every payment's signed terms that Airwallex carries in its
// transfer record (metadata.approval_sha256) becomes a leaf of one Merkle tree; its root goes on Alta (formerly Metal)
// testnet in a single transaction's calldata (`purser.merkle/v1 <root> <leaves>`), and each payment gets an inclusion
// proof. Anyone can then check one payment offline, with the proof alone: hash the leaf up the path and compare with
// the root on chain. Nothing secret is in a leaf: it is a hash of terms already published in the run records.
//
// The tree (RFC 6962 style, domain-separated so a leaf can never pass for a node):
//   leaf  = SHA-256(0x00 || approval hash, 32 bytes)
//   node  = SHA-256(0x01 || left || right)
//   an odd node at the end of a level is carried up unchanged (never paired with itself, so no two leaf lists share a root).

import { createHash } from "node:crypto";

export const MERKLE_SCHEMA = "purser.merkle/v1";

const HEX64 = /^[0-9a-f]{64}$/;
const sha = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();

export function leafHash(approvalSha256: string): string {
  if (!HEX64.test(approvalSha256)) throw new Error(`not an approval hash (64 lowercase hex): ${approvalSha256.slice(0, 80)}`);
  return sha(Buffer.from([0]), Buffer.from(approvalSha256, "hex")).toString("hex");
}
const nodeHash = (l: string, r: string) => sha(Buffer.from([1]), Buffer.from(l, "hex"), Buffer.from(r, "hex")).toString("hex");

export interface ProofStep { side: "L" | "R"; hash: string }

/** The root over the leaves (each an approval hash) and, per leaf, its path to the root. Refuses an empty or repeated list. */
export function merkleTree(approvals: readonly string[]): { root: string; proofs: ProofStep[][] } {
  if (!approvals.length) throw new Error("no approvals to anchor");
  if (new Set(approvals).size !== approvals.length) throw new Error("an approval hash appears twice; each payment is one leaf");
  let level = approvals.map(leafHash);
  const proofs: ProofStep[][] = approvals.map(() => []);
  let pos = approvals.map((_, i) => i);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? nodeHash(level[i]!, level[i + 1]!) : level[i]!);
    pos = pos.map((p, leaf) => {
      const sib = p ^ 1;
      if (sib < level.length) proofs[leaf]!.push({ side: p % 2 ? "L" : "R", hash: level[sib]! });
      return p >> 1;
    });
    level = next;
  }
  return { root: level[0]!, proofs };
}

/** Offline check of one payment: its approval hash, hashed up its proof, gives the root. */
export function verifyInclusion(approvalSha256: string, proof: readonly ProofStep[], root: string): boolean {
  let h = leafHash(approvalSha256);
  for (const s of proof) {
    if (!HEX64.test(s.hash) || (s.side !== "L" && s.side !== "R")) return false;
    h = s.side === "L" ? nodeHash(s.hash, h) : nodeHash(h, s.hash);
  }
  return h === root;
}

export function merkleCalldata(root: string, leaves: number): `0x${string}` {
  if (!HEX64.test(root) || !Number.isSafeInteger(leaves) || leaves < 1) throw new Error("a root (64 hex) and a leaf count");
  return `0x${Buffer.from(`${MERKLE_SCHEMA} ${root} ${leaves}`, "utf8").toString("hex")}`;
}

export function readMerkleCalldata(input: string): { root: string; leaves: number } | null {
  const text = Buffer.from(input.replace(/^0x/, ""), "hex").toString("utf8");
  const prefix = `${MERKLE_SCHEMA} `;
  if (!text.startsWith(prefix)) return null;
  const m = /^([0-9a-f]{64}) (\d+)$/.exec(text.slice(prefix.length));
  return m ? { root: m[1]!, leaves: Number(m[2]) } : null;
}

/** One payment's leaf, from a committed run record: the hash it was signed over, and the hash Airwallex read back. */
export interface ApprovalLeaf { record: string; label: string; transfer_id: string; approval_sha256: string; airwallex_sha256: string | null }

/** The signed payments of the soak and the bills runs (docs/runs/2026-11-19-airwallex-{soak,bills}.json), in record order. */
export function approvalLeaves(soak: { payments?: { invoice_no: string; terms_sha256: string; transfer_id: string | null; readback?: { approval_sha256?: string } | null }[] } | null,
  bills: { bills?: { invoice_no: string; signed_sha256: string; transfer_id: string | null; transfer_approval_sha256?: string | null }[] } | null): ApprovalLeaf[] {
  const out: ApprovalLeaf[] = [];
  for (const p of soak?.payments ?? []) if (p.transfer_id) out.push({ record: "docs/runs/2026-11-19-airwallex-soak.json", label: p.invoice_no, transfer_id: p.transfer_id, approval_sha256: p.terms_sha256, airwallex_sha256: p.readback?.approval_sha256 ?? null });
  for (const b of bills?.bills ?? []) if (b.transfer_id) out.push({ record: "docs/runs/2026-11-19-airwallex-bills.json", label: b.invoice_no, transfer_id: b.transfer_id, approval_sha256: b.signed_sha256, airwallex_sha256: b.transfer_approval_sha256 ?? null });
  return out;
}
