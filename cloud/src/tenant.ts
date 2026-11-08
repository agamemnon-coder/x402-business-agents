// The tenant-scoped data layer: the only way routes reach tenant data. It is built from the authenticated caller's
// tenant and adds "tenant_id = ?" to every read, write and delete; table and column names come from a fixed allowlist,
// and every value is a bound parameter. A route cannot name another tenant, and cannot write SQL.

import type { Sql, SqlValue } from "./store.js";

const COLUMNS = {
  users: ["id", "display_name", "email", "role", "created_at", "erased_at", "session_gen"],
  credentials: ["credential_id", "user_id", "x", "y", "counter", "created_at"],
  api_keys: ["id", "name", "scopes", "secret_sha256", "created_by", "created_by_user", "created_at", "expires_at", "revoked_at", "last_used_at"],
  enrolments: ["id", "user_id", "token_sha256", "created_by", "created_at", "expires_at", "used_at"],
  vendors: ["id", "name", "status", "updated_at", "version", "body_json", "body_sha256"],
  invoices: ["id", "vendor", "invoice_no", "due_date", "currency", "total", "status", "doc_sha256", "received_at", "updated_at", "version", "body_json", "body_sha256"],
  payments: ["id", "invoice_id", "status", "updated_at", "version", "body_json", "body_sha256"],
  object_history: ["kind", "id", "version", "body_json", "body_sha256", "replaced_at"],
  documents: ["sha256", "filename", "mime", "size", "blob_key", "received_at"],
  ledger_entries: ["entry_id", "posting_date", "doc_date", "description", "entry_json", "prev_hash", "entry_hash"],
  ledger_lines: ["entry_id", "line_no", "posting_date", "account", "currency", "debit_cents", "credit_cents", "vat_code", "vat_cents", "party", "doc_ref", "due_date"],
  audit_rows: ["seq", "ts", "actor", "event", "subject", "payload_json", "prev_hash", "row_hash"],
  inbound_mail: ["id", "blob_key", "sha256", "size", "received_at", "status", "note"],
  erasures: ["id", "subject", "done_at", "done_by", "detail"],
} as const;

export type Table = keyof typeof COLUMNS;
export const TENANT_TABLES = Object.keys(COLUMNS) as Table[];

/** Tables whose rows may be deleted at all (a person's credentials and a person's data on erasure; nothing else). */
const DELETABLE = new Set<Table>(["credentials"]);

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

  async apply(stmts: Stmt[]): Promise<void> {
    if (stmts.length) await this.sql.batch(stmts);
  }
}
