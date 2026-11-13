// The anchor head: one SHA-256 over the heads of Purser's tamper-evident records that are committed to this repo, so a
// single Metal testnet transaction can pin them all (npm run anchor). Anyone can recompute it from the repo alone,
// offline, and compare it with what the transaction's calldata says (npm run verify-anchor).
//
// What it covers, each recomputed here from the committed file, never copied from a stated figure:
// - the decision log of the recorded run (docs/audit/friday-1-audit.jsonl): every row's hash recomputed and linked
//   (verifyAuditRows), so its head proves what every row says;
// - the main run's audit chain (docs/demo/main-run-trace.json, audit.links): the linkage only (checkChainLinks), as
//   published without row content, so its head proves the order and that no row was cut, not what a row says;
// - the main run's books (the same file's journal): the trace carries no entry hashes, so this part is a SHA-256 of the
//   journal's canonical JSON (RFC 8785), not a chain head. It still changes if any line of the books changes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { checkChainLinks, verifyAuditRows, type AuditRowStored } from "../audit/log.js";
import { sha256Hex } from "../lib/terms.js";

export const ANCHOR_SCHEMA = "purser.anchor/v1";

export type AnchorKind = "audit-rows" | "audit-links" | "journal-digest";

export interface AnchorSource { name: string; file: string; kind: AnchorKind }

/** The committed records the anchor covers, in order. A record names its own list, so a later change here never breaks an older anchor. */
export const ANCHOR_SOURCES: AnchorSource[] = [
  { name: "decision log (recorded run, 30 Oct)", file: "docs/audit/friday-1-audit.jsonl", kind: "audit-rows" },
  { name: "audit chain (main run, 3 Nov)", file: "docs/demo/main-run-trace.json", kind: "audit-links" },
  { name: "books (main run journal, 3 Nov)", file: "docs/demo/main-run-trace.json", kind: "journal-digest" },
];

export interface AnchorPart extends AnchorSource { height: number; head: string }

export interface AnchorHead { schema: typeof ANCHOR_SCHEMA; head: string; height: number; parts: AnchorPart[] }

export class AnchorSourceError extends Error {}

function partOf(src: AnchorSource, root: string): AnchorPart {
  const text = readFileSync(join(root, src.file), "utf8");
  if (src.kind === "audit-rows") {
    const rows = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AuditRowStored);
    const c = verifyAuditRows(rows);
    if (!c.ok) throw new AnchorSourceError(`${src.file}: row ${c.seq}: ${c.reason}`);
    return { ...src, height: c.rows, head: c.head };
  }
  const trace = JSON.parse(text) as { audit?: { links?: { seq: number; prev_hash: string; row_hash: string }[] }; journal?: unknown[] };
  if (src.kind === "audit-links") {
    const c = checkChainLinks(trace.audit?.links ?? []);
    if (!c.ok) throw new AnchorSourceError(`${src.file}: link ${c.seq}: ${c.reason}`);
    if (c.rows === 0) throw new AnchorSourceError(`${src.file}: no audit links`);
    return { ...src, height: c.rows, head: c.head };
  }
  const journal = trace.journal;
  if (!Array.isArray(journal) || journal.length === 0) throw new AnchorSourceError(`${src.file}: no journal`);
  return { ...src, height: journal.length, head: sha256Hex(jcs(journal as Json)) };
}

/** The anchor head over the given sources, read from the repo at root. Throws AnchorSourceError when a source does not verify on its own. */
export function computeAnchorHead(root: string, sources: AnchorSource[] = ANCHOR_SOURCES): AnchorHead {
  const parts = sources.map((s) => partOf(s, root));
  const head = sha256Hex(jcs({ schema: ANCHOR_SCHEMA, parts: parts.map((p) => ({ name: p.name, file: p.file, kind: p.kind, height: p.height, head: p.head })) } as unknown as Json));
  return { schema: ANCHOR_SCHEMA, head, height: parts.reduce((n, p) => n + p.height, 0), parts };
}

// The calldata is readable text, so the explorer shows it as is: "purser.anchor/v1 <head> <height>".
const CALLDATA_RE = /^purser\.anchor\/v1 ([0-9a-f]{64}) (\d+)$/;

export function anchorCalldata(a: { head: string; height: number }): `0x${string}` {
  return `0x${Buffer.from(`${ANCHOR_SCHEMA} ${a.head} ${a.height}`, "utf8").toString("hex")}`;
}

/** The head and height a transaction's input carries, or null when it is not an anchor. */
export function readAnchorCalldata(input: string): { head: string; height: number } | null {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(input)) return null;
  const m = CALLDATA_RE.exec(Buffer.from(input.slice(2), "hex").toString("utf8"));
  return m ? { head: m[1]!, height: Number(m[2]) } : null;
}
