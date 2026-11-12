declare module "*.pdf" { const bytes: ArrayBuffer; export default bytes; }
declare module "*.sql" { const text: string; export default text; }
declare module "cloudflare:workers" {
  export class DurableObject<E = unknown> { constructor(ctx: any, env: E); ctx: any; env: E; }
}
