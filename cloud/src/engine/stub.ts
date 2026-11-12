// What a package no Worker can carry is swapped for (the alias in cloud/wrangler.jsonc: playwright and better-sqlite3,
// which the engine's import graph names but the engine in a Durable Object never uses: its ledger is the object's own
// SQLite, and nothing there opens a browser). The module loads, and says so when it is used.
const SAID = "is not part of the Worker build: cloud/wrangler.jsonc swaps the package for cloud/src/engine/stub.ts";
const refuse = (what: string) => (): never => { throw new Error(`${what} ${SAID}`); };
const stub: unknown = new Proxy(function stub() { /* never run: the proxy answers */ }, {
  // "then" stays undefined, so an awaited import of the module is not taken for a promise.
  get: (_target, name) => (name === "then" ? undefined : refuse(String(name))),
  apply: refuse("this package"),
  construct: refuse("this package"),
});
export default stub;
export const chromium = stub;
