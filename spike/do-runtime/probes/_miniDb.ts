// SPIKE, PROBE ONLY: the smallest better-sqlite3-shaped handle over a Durable Object's SQL storage, just enough for
// audit() and the agent loop (prepare().get/all/run with positional or @named parameters; transaction(fn).immediate()).
// The database layer itself is the other explorer's probe; this is not it.
type Row = Record<string, unknown>;
export interface DoSql { exec(query: string, ...bindings: unknown[]): { toArray(): Row[]; rowsWritten: number } }
export interface DoCtx { storage: { sql: DoSql; transactionSync<T>(fn: () => T): T } }

export function miniDb(ctx: DoCtx) {
  const sql = ctx.storage.sql;
  const prepare = (text: string) => {
    const names: string[] = [];
    const positional = text.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_m, n: string) => { names.push(n); return "?"; });
    const args = (a: unknown[]) => (names.length && a.length === 1 && a[0] !== null && typeof a[0] === "object" ? names.map((n) => (a[0] as Row)[n]) : a);
    return {
      get: (...a: unknown[]) => sql.exec(positional, ...args(a)).toArray()[0],
      all: (...a: unknown[]) => sql.exec(positional, ...args(a)).toArray(),
      run: (...a: unknown[]) => ({ changes: sql.exec(positional, ...args(a)).rowsWritten }),
    };
  };
  const transaction = <A extends unknown[], T>(fn: (...a: A) => T) => {
    const run = (...a: A) => ctx.storage.transactionSync(() => fn(...a));
    return Object.assign(run, { immediate: run, deferred: run, exclusive: run });
  };
  return { prepare, transaction, exec: (s: string) => { sql.exec(s); } };
}
