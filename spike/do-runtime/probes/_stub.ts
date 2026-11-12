// SPIKE: what a package no Worker can carry is swapped for (wrangler `alias`): it loads, and says so when it is used.
const refuse = (what: string) => () => { throw new Error(`${what} is not available in the Worker build (stubbed by wrangler alias)`); };
const stub: unknown = new Proxy(function Stub() { refuse("this package")(); }, { get: (_t, p) => (p === "then" ? undefined : refuse(String(p))), construct: () => { throw new Error("this package is not available in the Worker build (stubbed by wrangler alias)"); } });
export default stub;
export const chromium = stub;
