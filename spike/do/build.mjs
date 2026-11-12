// A plain esbuild bundle for workerd (the conformance worker; the engine's own bundle is made by wrangler, see chain/).
import { createRequire } from "node:module";
const require = createRequire(new URL("../../worker/package.json", import.meta.url));
export const esbuild = require("esbuild");

export async function bundleForWorkerd(entry, outfile, extra = {}) {
  return esbuild.build({
    entryPoints: [entry], outfile, bundle: true, format: "esm", platform: "browser", target: "es2024",
    conditions: ["workerd", "worker", "browser"], external: ["cloudflare:*", "node:*"], metafile: true, logLevel: "warning", ...extra,
  });
}
