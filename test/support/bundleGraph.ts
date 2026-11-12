// The files a module reaches through its static and dynamic imports, as esbuild resolves them (packages left outside):
// for tests that hold a module apart from another, such as the hands-on demo's pay route from the Airwallex sandbox
// client.
import { build } from "esbuild";
import { builtinModules } from "node:module";

/** Every file of this repository the entry point imports, directly or not, as a path relative to the repository's root. */
export async function bundleGraph(entry: string): Promise<Set<string>> {
  const out = await build({
    entryPoints: [entry], bundle: true, write: false, metafile: true, format: "esm", platform: "node", packages: "external",
    external: ["cloudflare:*", "node:*", ...builtinModules], loader: { ".sql": "text" }, logLevel: "silent",
  });
  return new Set(Object.keys(out.metafile.inputs));
}
