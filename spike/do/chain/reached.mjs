// Lists the engine's own files an entry reaches (esbuild's view), for grepping what they do at load time.
import { relative, resolve } from "node:path";
import { esbuild } from "../build.mjs";
const entry = resolve(process.argv[2]);
const root = resolve(new URL("../../..", import.meta.url).pathname);
const r = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, metafile: true, format: "esm", platform: "node", logLevel: "silent", loader: { ".sql": "text", ".node": "empty" }, external: ["cloudflare:*", "chromium-bidi/*", "electron", "playwright"] });
for (const k of Object.keys(r.metafile.inputs)) if (!k.includes("node_modules")) console.log(relative(root, resolve(k)));
