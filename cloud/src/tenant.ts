// The tenant-scoped data layer: the only way routes reach tenant data. It is built from the authenticated caller's
// tenant and adds "tenant_id = ?" to every read, write and delete; table and column names come from a fixed allowlist,
// and every value is a bound parameter. A route cannot name another tenant, and cannot write SQL.

import type { Sql, SqlValue } from "./store.js";

const COLUMNS = {
  users: ["id", "display_name", "email", "role", "created_at", "erased_at", "session_gen", "language"],
  credentials: ["credential_id", "user_id", "x", "y", "counter", "created_at"],
  api_keys: ["id", "name", "scopes", "secret_sha256", "created_by", "created_by_user", "parent_key", "purpose", "created_at", "expires_at", "revoked_at", "last_used_at"],
  enrolments: ["id", "user_id", "token_sha256", "created_by", "created_by_kind", "created_by_user", "by_owner", "created_at", "expires_at", "used_at", "cancelled_at"],
  vendors: ["id", "name", "status", "updated_at", "version", "body_json", "body_sha256"],
  invoices: ["id", "vendor", "invoice_no", "due_date", "currency", "total", "status", "doc_sha256", "received_at", "updated_at", "version", "body_json", "body_sha256"],
  payments: ["id", "invoice_id", "status", "updated_at", "version", "body_json", "body_sha256"],
  transactions: ["id", "sort_key", "at", "rail", "direction", "currency", "moved", "reconciliation", "version", "body_json", "body_sha256"],
  object_history: ["kind", "id", "version", "body_json", "body_sha256", "replaced_at"],
  documents: ["sha256", "filename", "mime", "size", "blob_key", "received_at"],
  ledger_entries: ["entry_id", "posting_date", "doc_date", "description", "entry_json", "prev_hash", "entry_hash"],
  ledger_lines: ["entry_id", "line_no", "posting_date", "account", "currency", "debit_cents", "credit_cents", "vat_code", "vat_cents", "party", "doc_ref", "due_date"],
  audit_rows: ["seq", "ts", "actor", "event", "subject", "payload_json", "prev_hash", "row_hash"],
  inbound_mail: ["id", "blob_key", "sha256", "size", "received_at", "status", "note"],
  erasures: ["id", "subject", "done_at", "done_by", "detail"],
  push_log: ["id", "by_key", "at"],
  runner_health: ["id", "at", "status", "alerts_json"],
  webhooks: ["id", "url", "secret", "created_at", "created_by", "consecutive_failures", "last_attempt_at", "last_status", "disabled_at"],
  awx_accounts: ["id", "account_id", "status", "business_name", "country_code", "created_at", "created_by", "updated_at", "event_at"],
} as const;

export type Table = keyof typeof COLUMNS;
export const TENANT_TABLES = Object.keys(COLUMNS) as Table[];

/** Tables whose rows may be deleted at all (a person's credentials on erasure, a removed webhook; nothing else). */
const DELETABLE = new Set<Table>(["credentials", "webhooks"]);

export type Cond = SqlValue | { op: ">=" | "<=" | ">" | "<" | "<>"; v: SqlValue } | { in: SqlValue[] };
export type Where = Record<string, Cond>;
export interface Stmt { sql: string; params: SqlValue[] }

function col(table: Table, c: string): string {
  if (!(COLUMNS[table] as readonly string[]).includes(c)) throw new Error(`no column ${c} on ${table}`);
  return c;
}

function whereSql(table: Table, tenantId: string, where: Where): Stmt {
  const parts = ["tenant_id = ?"];
  const params: SqlValue[] = [tenantId];
  for (const [k, v] of Object.entries(where)) {
    const c = col(table, k);
    if (v !== null && typeof v === "object" && "in" in v) {
      if (v.in.length === 0) { parts.push("0"); continue; }
      parts.push(`${c} IN (${v.in.map(() => "?").join(", ")})`);
      params.push(...v.in);
    } else if (v !== null && typeof v === "object" && "op" in v) {
      parts.push(`${c} ${v.op} ?`);
      params.push(v.v);
    } else if (v === null) {
      parts.push(`${c} IS NULL`);
    } else {
      parts.push(`${c} = ?`);
      params.push(v);
    }
  }
  return { sql: parts.join(" AND "), params };
}

/**
 * A write that lost a race: another request for the same company committed first (a primary key or a guard row the
 * loser would have written already exists, or a guard's condition no longer holds). The whole batch was rolled back.
 */
export class WriteConflict extends Error {
  constructor(readonly detail: string) { super(`write conflict: ${detail}`); }
}

/** SQLite's and D1's text for a failed constraint (PRIMARY KEY, UNIQUE, NOT NULL, CHECK). */
const CONSTRAINT = /constraint failed/i;

export class TenantDb {
  constructor(private readonly sql: Sql, readonly tenantId: string) {
    if (!/^t_[A-Za-z0-9_-]{6,64}$/.test(tenantId)) throw new Error("bad tenant id");
  }

  async select<T>(table: Table, where: Where = {}, opts: { order?: string[]; desc?: boolean; limit?: number } = {}): Promise<T[]> {
    const w = whereSql(table, this.tenantId, where);
    const order = (opts.order ?? []).map((c) => `${col(table, c)}${opts.desc ? " DESC" : ""}`);
    const limit = opts.limit !== undefined ? ` LIMIT ${Math.max(0, Math.min(1000, Math.floor(opts.limit)))}` : "";
    return this.sql.all<T>(`SELECT * FROM ${table} WHERE ${w.sql}${order.length ? ` ORDER BY ${order.join(", ")}` : ""}${limit}`, w.params);
  }

  async one<T>(table: Table, where: Where): Promise<T | null> {
    return (await this.select<T>(table, where, { limit: 1 }))[0] ?? null;
  }

  async count(table: Table, where: Where = {}): Promise<number> {
    const w = whereSql(table, this.tenantId, where);
    return (await this.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${w.sql}`, w.params))?.n ?? 0;
  }

  insert(table: Table, row: Record<string, SqlValue>): Stmt {
    const cols = Object.keys(row).map((c) => col(table, c));
    return { sql: `INSERT INTO ${table} (tenant_id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`, params: [this.tenantId, ...cols.map((c) => row[c]!)] };
  }

  update(table: Table, where: Where, set: Record<string, SqlValue>): Stmt {
    const cols = Object.keys(set).map((c) => col(table, c));
    if (cols.length === 0) throw new Error("nothing to update");
    const w = whereSql(table, this.tenantId, where);
    return { sql: `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${w.sql}`, params: [...cols.map((c) => set[c]!), ...w.params] };
  }

  delete(table: Table, where: Where): Stmt {
    if (!DELETABLE.has(table)) throw new Error(`rows of ${table} are never deleted`);
    const w = whereSql(table, this.tenantId, where);
    return { sql: `DELETE FROM ${table} WHERE ${w.sql}`, params: w.params };
  }

  /** Runs the statements as one transaction; a lost race (a failed constraint) comes back as WriteConflict. */
  async apply(stmts: Stmt[]): Promise<void> {
    if (!stmts.length) return;
    try {
      await this.sql.batch(stmts);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (CONSTRAINT.test(m)) throw new WriteConflict(m);
      throw e;
    }
  }

  /** One statement on its own; returns how many rows it changed (a conditional update that lost a race changes none). */
  async change(stmt: Stmt): Promise<number> {
    return (await this.sql.run(stmt.sql, stmt.params)).changes;
  }

  // Guard rows: a statement put first in a batch whose NOT NULL column is filled by a condition read at commit time.
  // When the condition no longer holds (another request changed it after this one read), the value is NULL, the
  // insert fails, and so does the whole batch (D1 runs a batch as one transaction). That is the compare-and-swap D1
  // lacks across requests.

  /** A push's guard: the key it came with is still live (not revoked, not expired) when the push commits. */
  pushGuard(id: string, caller: { kind: "key" | "session"; principal: string }, at: string): Stmt {
    const live = caller.kind === "key"
      ? { sql: "(SELECT id FROM api_keys WHERE tenant_id = ? AND id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?))", params: [this.tenantId, caller.principal, at] }
      : { sql: "(SELECT 'session:' || id FROM users WHERE tenant_id = ? AND id = ? AND erased_at IS NULL)", params: [this.tenantId, caller.principal] };
    return { sql: `INSERT INTO push_log (tenant_id, id, by_key, at) VALUES (?, ?, ${live.sql}, ?)`, params: [this.tenantId, id, ...live.params, at] };
  }

  /**
   * A write's guard for who asks: the key is still live, or the signed-in person not erased, when the write commits
   * (red team round 4: a key minted while its person was being erased outlived the erasure). Same row as a push's.
   */
  callerGuard(caller: { kind: "key" | "session"; principal: string }, at: string): Stmt {
    return this.pushGuard(`g_${at}_${crypto.randomUUID()}`, caller, at);
  }

  /** An owner enrolment's guard for a caller that is not a signed-in owner: no owner has a passkey when it commits. */
  noOwnerPasskeyGuard(at: string): Stmt {
    const t = this.tenantId;
    return {
      sql: `INSERT INTO push_log (tenant_id, id, by_key, at) VALUES (?, ?, (SELECT 'no-owner-passkey' WHERE (SELECT COUNT(*) FROM credentials c
          JOIN users u ON u.tenant_id = c.tenant_id AND u.id = c.user_id WHERE c.tenant_id = ? AND u.role = 'owner' AND u.erased_at IS NULL) = 0), ?)`,
      params: [t, `o_${at}_${crypto.randomUUID()}`, t, at],
    };
  }

  /**
   * A passkey removal's guard, put after the delete in the same batch: some owner still has a passkey when it commits
   * (two owners removing each other's last passkeys at once leave one, never none).
   */
  ownerPasskeyRemainsGuard(at: string): Stmt {
    const t = this.tenantId;
    return {
      sql: `INSERT INTO push_log (tenant_id, id, by_key, at) VALUES (?, ?, (SELECT 'owner-passkey-left' WHERE (SELECT COUNT(*) FROM credentials c
          JOIN users u ON u.tenant_id = c.tenant_id AND u.id = c.user_id WHERE c.tenant_id = ? AND u.role = 'owner' AND u.erased_at IS NULL) > 0), ?)`,
      params: [t, `r_${at}_${crypto.randomUUID()}`, t, at],
    };
  }

  /**
   * An erasure's guard (the erasures row itself): the person is not erased yet, and is not the company's last owner,
   * when the erasure commits. Two owners erasing each other at once leave one owner, never none.
   */
  erasureGuard(row: { id: string; subject: string; done_at: string; done_by: string; detail: string }): Stmt {
    const t = this.tenantId;
    return {
      sql: `INSERT INTO erasures (tenant_id, id, subject, done_at, done_by, detail) VALUES (?, ?, ?, ?, ?, (SELECT ? WHERE
          EXISTS (SELECT 1 FROM users WHERE tenant_id = ? AND id = ? AND erased_at IS NULL)
          AND ((SELECT role FROM users WHERE tenant_id = ? AND id = ?) <> 'owner'
            OR (SELECT COUNT(*) FROM users WHERE tenant_id = ? AND role = 'owner' AND erased_at IS NULL) > 1)))`,
      params: [t, row.id, row.subject, row.done_at, row.done_by, row.detail, t, row.subject, t, row.subject, t],
    };
  }
}
