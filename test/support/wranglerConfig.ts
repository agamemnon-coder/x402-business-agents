// cloud/wrangler.jsonc as the tests read it: the cloud Worker's own configuration, so a test builds and runs the
// Worker with the settings a deploy would use (the entry point, the engine's Durable Object and its migration, the
// define, the alias and the module rules), never with a copy of them.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface WranglerConfig {
  name: string;
  main: string;
  compatibility_date: string;
  compatibility_flags: string[];
  durable_objects: { bindings: { name: string; class_name: string }[] };
  migrations: { tag: string; new_sqlite_classes?: string[] }[];
  d1_databases: { binding: string; database_name: string; database_id: string }[];
  /** Absent in a deployment without R2 (cloud/wrangler.try.jsonc): the documents are then kept in D1 (cloud/src/blobsSql.ts). */
  r2_buckets?: { binding: string; bucket_name: string }[];
  vars: Record<string, string>;
  define: Record<string, string>;
  alias: Record<string, string>;
  rules: { type: string; globs: string[]; fallthrough?: boolean }[];
}

/** JSON with comments, as wrangler reads it: // and block comments outside strings are dropped. */
export function stripJsonComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\"") {
      const from = i++;
      while (i < text.length && text[i] !== "\"") i += text[i] === "\\" ? 2 : 1;
      out += text.slice(from, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
      if (i === 0) throw new Error("a block comment is not closed");
    } else out += c;
  }
  return out;
}

export const CLOUD_CONFIG = resolve("cloud/wrangler.jsonc");

/** cloud/wrangler.jsonc, or another configuration beside it (cloud/wrangler.try.jsonc): their paths resolve alike. */
export function cloudWranglerConfig(path: string = CLOUD_CONFIG): WranglerConfig {
  return JSON.parse(stripJsonComments(readFileSync(path, "utf8"))) as WranglerConfig;
}

/** A path the configuration names, from the configuration's own directory (as wrangler takes it). */
export const fromConfig = (path: string): string => resolve(dirname(CLOUD_CONFIG), path);

/** The configuration's alias with absolute paths. */
export const aliasOf = (c: WranglerConfig): Record<string, string> => Object.fromEntries(Object.entries(c.alias).map(([name, path]) => [name, fromConfig(path)]));

/** esbuild loaders for the configuration's module rules (a Text rule on **\/*.sql is the loader "text" for .sql). */
export function loadersOf(c: WranglerConfig): Record<string, string> {
  const kinds: Record<string, string> = { Text: "text", Data: "binary" };
  const out: Record<string, string> = {};
  for (const rule of c.rules) {
    for (const glob of rule.globs) {
      const ext = /^\*\*\/\*(\.[a-z0-9]+)$/.exec(glob)?.[1];
      if (!ext || !kinds[rule.type]) throw new Error(`a module rule this reader does not know: ${rule.type} ${glob}`);
      out[ext] = kinds[rule.type]!;
    }
  }
  return out;
}
