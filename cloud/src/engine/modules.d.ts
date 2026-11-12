// What the engine's host in the Worker imports that TypeScript cannot see by itself: the engine's two .sql files as
// text (the Text rule in cloud/wrangler.jsonc), the Workers runtime's own module, and the fonts pdfkit's browser build
// asks for. No Node program imports any of them.
declare module "*.sql" {
  const text: string;
  export default text;
}

declare module "cloudflare:workers" {
  /** The part of a Durable Object's state the engine uses: its SQLite (ctx.storage.sql, transactionSync) and deleteAll. */
  export interface DurableObjectCtx {
    storage: import("../../../src/db/doSql.js").DoStorage & { deleteAll(): Promise<void> };
  }
  export class DurableObject<Env = unknown> {
    constructor(ctx: DurableObjectCtx, env: Env);
    protected readonly ctx: DurableObjectCtx;
    protected readonly env: Env;
  }
}

declare module "pdfkit/standard-fonts/*" {
  /** One standard font's metrics, as pdfkit's registerStdFonts takes them. */
  const font: unknown;
  export default font;
}
