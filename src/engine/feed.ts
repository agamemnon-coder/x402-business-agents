// The engine's feed of the cloud's read model: after an engine action the read model holds what the ledger holds,
// through the code a runner's push uses (src/cloudsync/client.ts batchesFor; the target applies each batch as the
// cloud applies a push). A runner sends every supplier, invoice, payment and transaction on every push and lets the
// cloud find them unchanged, which costs the cloud a read per row. The feed runs after every action, so it sends only
// what changed: a small table in the company's own ledger holds a hash of each row the cloud took. The chains and the
// documents need none: the target says where it stands and only what continues it travels.
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { batchesFor, type CloudState } from "../cloudsync/client.js";
import type { DB } from "../db/open.js";
import { syncLedger } from "../ledger/feed.js";
import { sha256Hex } from "../lib/terms.js";

/** Where the feed goes: the cloud's read model for one company (cloud/src/engine/target.ts). */
export interface FeedTarget {
  /** Where the read model stands: the heads of both chains and the documents it holds. */
  state(): Promise<CloudState>;
  /** Applies one batch as a runner's push is applied; throws when the batch is refused. */
  apply(batch: Record<string, unknown>): Promise<unknown>;
}

/** The rows that are versioned in the cloud: sent again only when their content changed. */
const VERSIONED = ["vendors", "invoices", "payments", "transactions"] as const;
const KINDS = ["documents", ...VERSIONED, "ledger_entries", "audit_rows"] as const;
type Versioned = (typeof VERSIONED)[number];
export type FeedKind = (typeof KINDS)[number];

export interface FeedResult {
  /** The requests made: a batch left empty is not sent. */
  batches: number;
  /** The rows sent, per kind. */
  sent: Record<FeedKind, number>;
  /** What the target answered, batch by batch. */
  applied: unknown[];
}

type Row = { id: string } & Record<string, unknown>;
const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const rowsOf = (batch: Record<string, unknown>, kind: FeedKind): unknown[] => (Array.isArray(batch[kind]) ? (batch[kind] as unknown[]) : []);

/** A row's content as one hash. A supplier's updated_at is left out: batchesFor stamps it with the time of the feed. */
function contentHash(kind: Versioned, row: Row): string {
  const content = kind === "vendors" ? { ...row, updated_at: null } : row;
  // Through JSON first: what would not travel (an undefined field) is not part of the content.
  return sha256Hex(jcs(JSON.parse(JSON.stringify(content)) as Json));
}

/**
 * Brings the target up to the ledger. The ledger is booked first (as pushToCloud does; safe to repeat), then every
 * batch a runner would push is cut down to what the target does not hold yet. A row's hash is kept only after the
 * target took the batch it was in, so a refused or failed feed is sent again in full by the next one.
 * `all: true` sends every versioned row whether it changed or not (the target counts what it holds as unchanged).
 */
export async function feedCloud(db: DB, target: FeedTarget, now: Date = new Date(), opts: { all?: boolean } = {}): Promise<FeedResult> {
  if (has(db, "ledger_entries")) syncLedger(db, now);
  const state = await target.state();
  // The read model is this engine's alone: where it stands must be a point of this ledger's own chains. A read model a
  // runner pushes (or another ledger fed) is refused before anything is sent, so a test-money invoice never replaces a
  // company's own one of the same id.
  const head = (sql: string, at: number) => (db.prepare(sql).get(at) as { h: string } | undefined)?.h ?? null;
  const ours = (state.audit.seq === 0 || (has(db, "audit_log") && head("SELECT row_hash AS h FROM audit_log WHERE seq = ?", state.audit.seq) === state.audit.hash))
    && (state.ledger.entry_id === 0 || (has(db, "ledger_entries") && head("SELECT entry_hash AS h FROM ledger_entries WHERE entry_id = ?", state.ledger.entry_id) === state.ledger.hash));
  if (!ours) throw new Error("the company's read model was not written by this engine (a runner pushes it): nothing was sent");
  // The feed's own table, made here and not in the engine's schema: a ledger that is never fed has none.
  db.exec("CREATE TABLE IF NOT EXISTS cloud_feed_sent (kind TEXT, id TEXT, sha256 TEXT, PRIMARY KEY (kind, id))");
  const known = new Map<string, string>();
  for (const r of db.prepare("SELECT kind, id, sha256 FROM cloud_feed_sent").all() as { kind: string; id: string; sha256: string }[]) known.set(`${r.kind}\n${r.id}`, r.sha256);
  const keep = db.prepare("INSERT INTO cloud_feed_sent (kind, id, sha256) VALUES (?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET sha256 = excluded.sha256");

  const out: FeedResult = { batches: 0, sent: { documents: 0, vendors: 0, invoices: 0, payments: 0, transactions: 0, ledger_entries: 0, audit_rows: 0 }, applied: [] };
  for (const full of batchesFor(db, state, { now })) {
    const batch: Record<string, unknown> = { ...full };
    const hashes: [Versioned, string, string][] = [];
    for (const kind of VERSIONED) {
      if (!Array.isArray(full[kind])) continue;
      const changed: Row[] = [];
      for (const row of full[kind] as Row[]) {
        const hash = contentHash(kind, row);
        if (!opts.all && known.get(`${kind}\n${row.id}`) === hash) continue;
        changed.push(row);
        hashes.push([kind, row.id, hash]);
      }
      batch[kind] = changed;
    }
    if (KINDS.every((kind) => rowsOf(batch, kind).length === 0)) continue;
    out.applied.push(await target.apply(batch));
    // The target took the batch: only now are its rows remembered as sent.
    db.transaction(() => { for (const [kind, id, hash] of hashes) keep.run(kind, id, hash); })();
    for (const [kind, id, hash] of hashes) known.set(`${kind}\n${id}`, hash);
    out.batches += 1;
    for (const kind of KINDS) out.sent[kind] += rowsOf(batch, kind).length;
  }
  return out;
}
