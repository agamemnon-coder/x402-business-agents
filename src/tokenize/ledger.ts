// The tokenize run's own ledger (TOKENIZE_DB, never the main run's): what the run knows (tokenize_state) and every
// transaction it signed (tokenize_txs). A transaction's hash and signed bytes are written here before it is sent, so
// a run stopped anywhere still knows what it sent; on a re-run the client (src/tokenize/client.ts) reads this journal
// first and never signs a second transaction for a key it finds here. The signed bytes are not a secret: they are what
// goes to the chain. The salt of the party references (ref_salt) stays in this file and is never printed.

import Database from "better-sqlite3";
import type { Hex } from "viem";
import type { JournalRow, Receipt, TxJournal } from "./client.js";

export interface TxRow { seq: number; key: string; step: string; hash: Hex; from_addr: string; nonce: number; gas: string; status: "signed" | "success" | "reverted"; cmd: string; at: string; done_at: string | null; gas_used: string | null; block: string | null }

export interface RunLedger {
  get(key: string): string | undefined;
  put(key: string, value: string): void;
  journal: TxJournal;
  /** Every recorded transaction, oldest first (without its signed bytes). */
  txs(): TxRow[];
  /** What the run knows, without the salt of the party references. */
  state(): Record<string, string>;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tokenize_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tokenize_txs (
  seq INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  step TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  raw TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  gas TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('signed', 'success', 'reverted')),
  receipt_json TEXT,
  cmd TEXT NOT NULL,
  at TEXT NOT NULL,
  done_at TEXT
);`;

/** Only what later steps and the run record read from a receipt. */
const kept = (r: Receipt): Receipt => ({ transactionHash: r.transactionHash, status: r.status, contractAddress: r.contractAddress ?? null, gasUsed: r.gasUsed, ...(r.blockNumber ? { blockNumber: r.blockNumber } : {}), logs: (r.logs ?? []).map((l) => ({ address: l.address, topics: l.topics, data: l.data })), from: r.from, to: r.to ?? null });

export function openRunLedger(path: string, o: { cmd?: string; readonly?: boolean; now?: () => Date } = {}): RunLedger {
  const db = new Database(path, o.readonly ? { readonly: true, fileMustExist: true } : {});
  const now = o.now ?? (() => new Date());
  const cmd = o.cmd ?? "";
  if (!o.readonly) {
    const old = db.prepare("SELECT name FROM pragma_table_info('tokenize_txs')").all() as { name: string }[];
    if (old.length && !old.some((c) => c.name === "raw")) { db.close(); throw new Error("TOKENIZE_DB was made by an older version of this tool (its transactions have no signed bytes); use a new ledger file"); }
    db.exec(SCHEMA);
  }
  const get = (k: string) => (db.prepare("SELECT value FROM tokenize_state WHERE key = ?").get(k) as { value: string } | undefined)?.value;
  const journal: TxJournal = {
    last(key) {
      const r = db.prepare("SELECT key, step, hash, raw, from_addr, nonce, gas, status, receipt_json FROM tokenize_txs WHERE key = ? ORDER BY seq DESC LIMIT 1").get(key) as
        { key: string; step: string; hash: Hex; raw: Hex; from_addr: `0x${string}`; nonce: number; gas: string; status: JournalRow["status"]; receipt_json: string | null } | undefined;
      return r && { key: r.key, label: r.step, hash: r.hash, raw: r.raw, from: r.from_addr, nonce: r.nonce, gas: BigInt(r.gas), status: r.status, receipt: r.receipt_json ? (JSON.parse(r.receipt_json) as Receipt) : null };
    },
    signed(row) {
      db.prepare("INSERT INTO tokenize_txs (key, step, hash, raw, from_addr, nonce, gas, status, cmd, at) VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?)")
        .run(row.key, row.label, row.hash, row.raw, row.from, row.nonce, row.gas.toString(), cmd, now().toISOString());
    },
    done(hash, status, receipt) {
      const out = db.prepare("UPDATE tokenize_txs SET status = ?, receipt_json = ?, done_at = ? WHERE hash = ?").run(status, JSON.stringify(kept(receipt)), now().toISOString(), hash);
      if (out.changes !== 1) throw new Error(`the journal has no transaction ${hash}`);
    },
  };
  return {
    get,
    put: (k, v) => { db.prepare("INSERT INTO tokenize_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v); },
    journal,
    txs: () => (db.prepare("SELECT seq, key, step, hash, from_addr, nonce, gas, status, cmd, at, done_at, receipt_json FROM tokenize_txs ORDER BY seq").all() as (TxRow & { receipt_json: string | null })[])
      .map(({ receipt_json, ...r }) => {
        const receipt = receipt_json ? (JSON.parse(receipt_json) as Receipt) : null;
        return { ...r, gas_used: receipt ? BigInt(receipt.gasUsed).toString() : null, block: receipt?.blockNumber ? BigInt(receipt.blockNumber).toString() : null };
      }),
    state: () => Object.fromEntries((db.prepare("SELECT key, value FROM tokenize_state WHERE key != 'ref_salt' ORDER BY key").all() as { key: string; value: string }[]).map((r) => [r.key, r.value])),
    close: () => { db.close(); },
  };
}
