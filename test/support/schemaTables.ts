// Every table the code creates, with its columns: the D1 migrations, the runner's schema files, and each CREATE TABLE
// in the Workers' and the runner's code (Durable Object tables, tables a module makes on first use). For
// test/data-classification.test.ts (ASVS V1.8.2).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules") files(p, ext, out); } else if (ext.test(n) && !/\.gen\./.test(n)) out.push(p);
  }
  return out;
}

const NOT_COLUMN = /^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i;

/** Table name to its columns and the files that create it. */
export function schemaTables(): Map<string, { columns: Set<string>; files: Set<string> }> {
  const out = new Map<string, { columns: Set<string>; files: Set<string> }>();
  const sources = [...files("cloud/migrations", /\.sql$/), ...files("src/db", /\.sql$/), ...files("src", /\.ts$/), ...files("cloud/src", /\.ts$/), ...files("worker/src", /\.ts$/)];
  for (const f of sources) {
    const text = readFileSync(f, "utf8").replace(/--[^\n]*/g, "").replace(/\\n/g, "\n");
    for (const m of text.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)\s*\(/gi)) {
      let depth = 1, i = m.index! + m[0].length;
      const start = i;
      while (i < text.length && depth > 0) { if (text[i] === "(") depth++; else if (text[i] === ")") depth--; i++; }
      const body = text.slice(start, i - 1);
      const parts: string[] = [];
      let d = 0, cur = "";
      for (const ch of body) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { parts.push(cur); cur = ""; } else cur += ch; }
      parts.push(cur);
      const t = out.get(m[1]!) ?? { columns: new Set<string>(), files: new Set<string>() };
      for (const p of parts) { const w = p.trim().split(/\s+/)[0]?.replace(/["`]/g, ""); if (w && !NOT_COLUMN.test(w) && /^[a-z_][a-z0-9_]*$/i.test(w)) t.columns.add(w); }
      t.files.add(f);
      out.set(m[1]!, t);
    }
  }
  return out;
}
