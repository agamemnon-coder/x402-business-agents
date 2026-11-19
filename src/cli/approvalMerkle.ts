// npm run approvals:merkle -- plan | live | verify [--chain]: every signed Airwallex payment of 19 November (the soak's
// 30, the bills' 3) as one Merkle tree of approval hashes, its root anchored on Alta (formerly Metal) testnet in ONE
// transaction (test money: gas only), and an inclusion proof per payment (src/anchor/merkle.ts).
//
//   plan     the leaves, the root and the calldata from the committed records; no network, no key.
//   live     sends the one transaction from a gas-only key in KIT11_KEYS_DIR (gas-sponsor.key.json), reads it back, and
//            writes docs/runs/<MERKLE_DATE or today>-alta-merkle.json and .md. Needs MERKLE_GO=yes, KIT11_KEYS_DIR and
//            METAL_RPC_URL; neither the key nor the RPC URL is ever printed.
//   verify   offline: recomputes every leaf from the run records, checks each payment's proof against the recorded
//            root, and that Airwallex read back the same hash. --chain also reads the transaction (METAL_RPC_URL).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { approvalLeaves, MERKLE_SCHEMA, merkleCalldata, merkleTree, readMerkleCalldata, verifyInclusion, leafHash, type ProofStep } from "../anchor/merkle.js";
import { CHAIN_ID, EXPLORER_TX } from "../metal/network.js";

const repo = resolve(import.meta.dirname, "../..");
const cmd = process.argv[2] ?? "plan";
const date = process.env.MERKLE_DATE ?? new Date().toISOString().slice(0, 10);
const RECORD = resolve(repo, "docs/runs", `${date}-alta-merkle`);
const read = (p: string) => JSON.parse(readFileSync(resolve(repo, p), "utf8"));

export interface MerkleRecord {
  schema: typeof MERKLE_SCHEMA;
  anchored_at: string;
  network: string;
  chain_id: number;
  test_money: true;
  root: string;
  leaves: number;
  calldata: string;
  tx: string;
  from: string;
  block: number;
  explorer: string;
  read_back: { status: string; block: number | null; calldata_root: string | null; calldata_leaves: number | null; matches: boolean };
  tree: string;
  check: string;
  payments: { index: number; label: string; record: string; transfer_id: string; approval_sha256: string; airwallex_sha256_matches: boolean; leaf: string; proof: ProofStep[] }[];
}

function build() {
  const leaves = approvalLeaves(read("docs/runs/2026-11-19-airwallex-soak.json"), read("docs/runs/2026-11-19-airwallex-bills.json"));
  const { root, proofs } = merkleTree(leaves.map((l) => l.approval_sha256));
  const payments = leaves.map((l, i) => ({ index: i, label: l.label, record: l.record, transfer_id: l.transfer_id, approval_sha256: l.approval_sha256, airwallex_sha256_matches: l.airwallex_sha256 === l.approval_sha256, leaf: leafHash(l.approval_sha256), proof: proofs[i]! }));
  return { root, payments, calldata: merkleCalldata(root, leaves.length) };
}

function markdown(r: MerkleRecord): string {
  const ok = r.payments.filter((p) => verifyInclusion(p.approval_sha256, p.proof, r.root)).length;
  return [
    `# Every signed payment of the day, one Alta transaction: ${r.anchored_at.slice(0, 10)}`,
    "",
    `\`npm run approvals:merkle -- live\` (src/cli/approvalMerkle.ts, src/anchor/merkle.ts). **Alta (formerly Metal) testnet**, test money (gas only).`,
    `The machine-readable record, with each payment's leaf and inclusion proof, is docs/runs/${r.anchored_at.slice(0, 10)}-alta-merkle.json.`,
    "",
    `The hash of the terms each payment was signed over (a labelled virtual test passkey; Airwallex holds the same hash in`,
    `the transfer's metadata.approval_sha256) is one leaf; ${r.leaves} leaves, one root, one transaction.`,
    "",
    "| | |",
    "|---|---|",
    `| Root | \`${r.root}\` |`,
    `| Leaves | ${r.leaves}: ${r.payments.filter((p) => p.record.endsWith("soak.json")).length} soak payments, ${r.payments.filter((p) => p.record.endsWith("bills.json")).length} bills payments (docs/runs/2026-11-19-airwallex-soak.json, -bills.json) |`,
    `| Transaction | [\`${r.tx}\`](${r.explorer}), block ${r.block}, chain id ${r.chain_id} |`,
    `| Sent from | \`${r.from}\` (a gas-only key that owns nothing) |`,
    `| Calldata | the text \`${MERKLE_SCHEMA} <root> <leaves>\` |`,
    `| Read back from the chain | ${r.read_back.status}, block ${r.read_back.block ?? "none"}; calldata root ${r.read_back.matches ? "**matches**" : "does NOT match"} |`,
    `| Proofs | ${ok} of ${r.leaves} verify against the root offline; ${r.payments.filter((p) => p.airwallex_sha256_matches).length} of ${r.leaves} hashes are the ones Airwallex read back |`,
    "",
    `Tree: ${r.tree}`,
    "",
    "## Check one payment yourself",
    "",
    "```bash",
    `${r.check}            # every leaf from the run records, every proof, offline`,
    `${r.check} --chain    # and the transaction's calldata (METAL_RPC_URL set)`,
    "```",
    "",
    "Or by hand, for one payment: leaf = SHA-256(0x00 ‖ approval hash); for each proof step, SHA-256(0x01 ‖ step ‖ h) when",
    "the step is on the left (L), SHA-256(0x01 ‖ h ‖ step) when on the right (R); the end is the root in the calldata.",
    "",
    "| # | Payment | Transfer | Approval hash | Proof steps | Airwallex holds it |",
    "|---|---|---|---|---|---|",
    ...r.payments.map((p) => `| ${p.index} | ${p.label} | \`${p.transfer_id}\` | \`${p.approval_sha256.slice(0, 16)}…\` | ${p.proof.length} | ${p.airwallex_sha256_matches ? "yes" : "no"} |`),
    "",
    "## What this does not show",
    "",
    "- That a person approved: the signatures are the runs' labelled virtual test passkeys, not anyone's Face ID.",
    "- That the payments settled: they were PAID by the sandbox's simulation endpoint (see the soak and bills records).",
    "- The calldata pins the root, not the terms: a leaf proves a hash was in the batch at the block's time; the terms behind",
    "  a hash are in the run records, which the hash is recomputed from.",
    "",
  ].join("\n");
}

const isMain = process.argv[1]?.endsWith("approvalMerkle.ts");
if (isMain && cmd === "plan") {
  const b = build();
  console.log(`leaves ${b.payments.length}\nroot   ${b.root}\ndata   ${b.calldata}\n${b.payments.filter((p) => !p.airwallex_sha256_matches).length} hash(es) Airwallex did not read back as signed`);
} else if (isMain && cmd === "live") {
  const missing = ["KIT11_KEYS_DIR", "METAL_RPC_URL"].filter((n) => !process.env[n]);
  if (process.env.MERKLE_GO !== "yes") missing.unshift("MERKLE_GO=yes");
  if (missing.length) { console.error(`REFUSED  not sent: ${missing.join(", ")}`); process.exit(2); }
  const { keyPath } = await import("../metal/agentCli.js");
  const { metalChain } = await import("../anchor/metalChain.js");
  const keyFile = keyPath("gas-sponsor.key.json");
  if (!existsSync(keyFile)) { console.error(`REFUSED  no key file ${keyFile}`); process.exit(2); }
  const b = build();
  if (b.payments.some((p) => !p.airwallex_sha256_matches)) { console.error("REFUSED  a payment's hash is not the one Airwallex read back; nothing sent"); process.exit(2); }
  const chain = metalChain(keyFile);
  const sent = await chain.send(b.calldata);
  if (sent.status !== "success") { console.error(`the transaction ${sent.hash} reverted`); process.exit(1); }
  const tx = await chain.getTx(sent.hash);
  const onChain = tx ? readMerkleCalldata(tx.input) : null;
  const rec: MerkleRecord = {
    schema: MERKLE_SCHEMA, anchored_at: new Date().toISOString(), network: "Alta (formerly Metal) testnet", chain_id: chain.chainId, test_money: true,
    root: b.root, leaves: b.payments.length, calldata: b.calldata, tx: sent.hash, from: sent.from, block: sent.blockNumber, explorer: `${EXPLORER_TX}${sent.hash}`,
    read_back: { status: tx?.status ?? "not found", block: tx?.blockNumber ?? null, calldata_root: onChain?.root ?? null, calldata_leaves: onChain?.leaves ?? null, matches: !!onChain && onChain.root === b.root && onChain.leaves === b.payments.length },
    tree: "leaf = SHA-256(0x00 || approval hash), node = SHA-256(0x01 || left || right), an odd node carried up (src/anchor/merkle.ts)",
    check: "npm run approvals:merkle -- verify", payments: b.payments,
  };
  writeFileSync(`${RECORD}.json`, `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(`${RECORD}.md`, markdown(rec));
  console.log(`sent   ${rec.tx}  block ${rec.block}  from ${rec.from}\nread   ${rec.read_back.status}, calldata root ${rec.read_back.matches ? "matches" : "DOES NOT MATCH"}\nwrote  ${RECORD}.json\n       ${RECORD}.md`);
} else if (isMain && cmd === "verify") {
  const rec = JSON.parse(readFileSync(`${RECORD}.json`, "utf8")) as MerkleRecord;
  const b = build();
  const lines: [boolean, string][] = [];
  lines.push([b.root === rec.root, `root recomputed from the run records: ${b.root}`]);
  for (const p of rec.payments) {
    const now = b.payments[p.index];
    lines.push([!!now && now.approval_sha256 === p.approval_sha256 && verifyInclusion(p.approval_sha256, p.proof, rec.root) && p.airwallex_sha256_matches, `${p.label} (${p.transfer_id.slice(0, 8)}…): proof of ${p.proof.length} steps`]);
  }
  if (process.argv.includes("--chain")) {
    const { metalReader } = await import("../anchor/metalChain.js");
    const tx = await metalReader().getTx(rec.tx);
    const onChain = tx ? readMerkleCalldata(tx.input) : null;
    lines.push([CHAIN_ID === rec.chain_id && !!tx && tx.status === "success" && !!onChain && onChain.root === rec.root && onChain.leaves === rec.leaves, `transaction ${rec.tx}: ${tx ? `${tx.status}, block ${tx.blockNumber}, calldata root ${onChain?.root ?? "none"}` : "not found"}`]);
  }
  for (const [ok, what] of lines) console.log(`${ok ? "OK      " : "MISMATCH"} ${what}`);
  console.log(lines.every(([ok]) => ok) ? "MATCH" : "MISMATCH");
  process.exit(lines.every(([ok]) => ok) ? 0 : 1);
} else if (isMain) {
  console.error("usage: npm run approvals:merkle -- plan | live | verify [--chain]");
  process.exit(2);
}
