// Starts workerd through Miniflare's API with one SQLite-backed Durable Object and nodejs_compat. No network: `cf: false`
// stops Miniflare's request for cf.json, and the callers run this under spike/do/nonet.py (loopback only).
// The installed Miniflare is 5.x beta; its v4 option shape is still accepted through convertV4MiniflareOptions.
import { createRequire } from "node:module";
import { dirname } from "node:path";
const require = createRequire(new URL("../../worker/package.json", import.meta.url));
export const { Miniflare, convertV4MiniflareOptions } = require("miniflare");

export const COMPAT_DATE = "2026-10-01";

/** @param {{ modules: {type: string, path: string, contents?: string}[], modulesRoot?: string, binding: string, className: string, bindings?: object }} o */
export function workerd(o) {
  return new Miniflare(convertV4MiniflareOptions({
    cf: false,
    host: "127.0.0.1",
    port: 0,
    verbose: false,
    name: "spike",
    modules: o.modules,
    // Module names are taken relative to this root; workerd refuses a name that climbs out of it.
    modulesRoot: o.modulesRoot ?? dirname(o.modules[0].path),
    compatibilityDate: COMPAT_DATE,
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { [o.binding]: { className: o.className, useSQLite: true } },
    bindings: o.bindings ?? {},
  }));
}
