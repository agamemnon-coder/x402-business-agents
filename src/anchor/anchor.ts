// Sending the anchor (one Metal testnet transaction whose calldata is the anchor head) and checking it against the chain.
// The chain is a port, so the tests run with a mocked one and the CLIs with Metal's (src/metal/chain.ts). No key, RPC
// URL or other secret is ever put in a record or printed: the record holds the head, the heights, the sender's
// address, the transaction hash and its block.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXPLORER_TX } from "../metal/network.js";
import { ANCHOR_SCHEMA, anchorCalldata, computeAnchorHead, readAnchorCalldata, type AnchorHead, type AnchorSource } from "./head.js";

export interface AnchorTx { hash: string; from: string; to: string | null; input: string; blockNumber: number | null; status: "success" | "reverted" | "pending" }

export interface AnchorChain {
  /** Sends one transaction with this calldata (to the sender itself, value 0) and waits for its receipt. */
  send(calldata: `0x${string}`): Promise<{ hash: string; from: string; blockNumber: number; status: "success" | "reverted" }>;
  /** The transaction and its receipt, or null when the chain does not know the hash. */
  getTx(hash: string): Promise<AnchorTx | null>;
  chainId: number;
}

export interface AnchorRecord {
  schema: typeof ANCHOR_SCHEMA;
  anchored_at: string;
  network: string;
  chain_id: number;
  head: string;
  height: number;
  parts: AnchorHead["parts"];
  calldata: string;
  tx: string;
  from: string;
  block: number;
  explorer: string;
  check: string;
}

export const CHECK_COMMAND = "npm run verify-anchor";

/** The dry run: what would be sent, with no network and no key. */
export function planAnchor(root: string): { head: AnchorHead; calldata: `0x${string}` } {
  const head = computeAnchorHead(root);
  return { head, calldata: anchorCalldata(head) };
}

/** The live run: sends the one transaction, refuses a reverted one, and returns the record (not yet written). */
export async function sendAnchor(root: string, chain: AnchorChain, now = new Date()): Promise<AnchorRecord> {
  const { head, calldata } = planAnchor(root);
  const sent = await chain.send(calldata);
  if (sent.status !== "success") throw new Error(`the anchor transaction ${sent.hash} reverted`);
  return {
    schema: ANCHOR_SCHEMA, anchored_at: now.toISOString(), network: "Metal testnet", chain_id: chain.chainId,
    head: head.head, height: head.height, parts: head.parts, calldata,
    tx: sent.hash, from: sent.from, block: sent.blockNumber, explorer: `${EXPLORER_TX}${sent.hash}`, check: CHECK_COMMAND,
  };
}

export function recordMarkdown(r: AnchorRecord): string {
  const parts = r.parts.map((p) => `| ${p.name} | \`${p.file}\` | ${p.kind} | ${p.height} | \`${p.head}\` |`).join("\n");
  return `# Purser's chain head anchored on Metal testnet (${r.anchored_at.slice(0, 10)})

One Metal testnet transaction (test money) whose calldata is the anchor head of Purser's committed records, so anyone
can check later that none of them was rewritten after ${r.anchored_at}. Made by \`npm run anchor -- --live\`
(src/cli/anchor.ts); the figures below are from that run's record, \`${r.anchored_at.slice(0, 10)}-anchor.json\`.

- Anchor head: \`${r.head}\`
- Height: ${r.height} (rows and journal lines over the parts below)
- Transaction: [\`${r.tx}\`](${r.explorer}), block ${r.block}, chain id ${r.chain_id}
- Sent from: \`${r.from}\` (a gas-only key that owns nothing)
- Calldata: the text \`${ANCHOR_SCHEMA} <head> <height>\`

| Part | File | Kind | Height | Head |
|---|---|---|---|---|
${parts}

The anchor head is SHA-256 over the canonical JSON (RFC 8785) of \`{schema, parts}\` (src/anchor/head.ts). The decision
log's rows are each recomputed; the main run's audit chain is published as links only, so its part proves the order and
that no row was cut, not what a row says; the books part is a digest of the main run's journal, not a chain head.

## Check it yourself

\`\`\`bash
${CHECK_COMMAND}
\`\`\`

With \`METAL_RPC_URL\` set in your shell to a Metal testnet RPC endpoint, it recomputes the head from the repo, reads
the transaction from the chain and prints MATCH or MISMATCH. The transaction can also be read on the explorer link above.
`;
}

/** Writes docs/runs/<date>-anchor.json and .md; returns their paths. */
export function writeRecord(root: string, r: AnchorRecord): { json: string; md: string } {
  const base = join(root, "docs/runs", `${r.anchored_at.slice(0, 10)}-anchor`);
  writeFileSync(`${base}.json`, `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(`${base}.md`, recordMarkdown(r));
  return { json: `${base}.json`, md: `${base}.md` };
}

/** The newest docs/runs/<date>-anchor.json, or null when there is none. */
export function latestRecordFile(root: string): string | null {
  const dir = join(root, "docs/runs");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}-anchor\.json$/.test(f)).sort();
  return files.length ? join(dir, files[files.length - 1]!) : null;
}

export interface AnchorCheck { match: boolean; lines: { ok: boolean; what: string; detail: string }[] }

/** Recomputes the head from the repo (over the record's own list of sources), reads the transaction and compares. */
export async function verifyAnchor(root: string, record: AnchorRecord, chain: Pick<AnchorChain, "getTx" | "chainId">): Promise<AnchorCheck> {
  const lines: AnchorCheck["lines"] = [];
  const add = (ok: boolean, what: string, detail: string) => lines.push({ ok, what, detail });
  const sources: AnchorSource[] = record.parts.map(({ name, file, kind }) => ({ name, file, kind }));
  let repo: AnchorHead | null = null;
  try { repo = computeAnchorHead(root, sources); } catch (e) { add(false, "repo", (e as Error).message); }
  if (repo) {
    for (const p of repo.parts) {
      const was = record.parts.find((q) => q.file === p.file && q.kind === p.kind);
      add(!!was && was.head === p.head && was.height === p.height, p.name, `${p.height} at ${p.head.slice(0, 16)}…${was && was.head !== p.head ? ` (anchored ${was.head.slice(0, 16)}…)` : ""}`);
    }
    add(repo.head === record.head, "repo head", `recomputed ${repo.head}`);
  }
  add(chain.chainId === record.chain_id, "chain", `chain id ${chain.chainId}${chain.chainId === record.chain_id ? "" : `, the record says ${record.chain_id}`}`);
  const tx = await chain.getTx(record.tx);
  if (!tx) add(false, "transaction", `${record.tx} not found on chain`);
  else {
    const onChain = readAnchorCalldata(tx.input);
    add(tx.status === "success", "transaction", `${tx.hash} ${tx.status}, block ${tx.blockNumber ?? "none"}`);
    add(tx.blockNumber === record.block, "block", `${tx.blockNumber ?? "none"}${tx.blockNumber === record.block ? "" : `, the record says ${record.block}`}`);
    add(tx.from.toLowerCase() === record.from.toLowerCase(), "sender", tx.from);
    add(!!onChain && !!repo && onChain.head === repo.head && onChain.height === repo.height, "calldata",
      onChain ? `head ${onChain.head}, height ${onChain.height}` : "not an anchor transaction");
  }
  return { match: lines.every((l) => l.ok), lines };
}

export function readRecord(file: string): AnchorRecord {
  const r = JSON.parse(readFileSync(file, "utf8")) as AnchorRecord;
  if (r.schema !== ANCHOR_SCHEMA || !/^[0-9a-f]{64}$/.test(r.head) || !Array.isArray(r.parts)) throw new Error(`${file} is not an anchor record`);
  return r;
}
