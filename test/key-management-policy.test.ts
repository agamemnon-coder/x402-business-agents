// ASVS 4.0.3 V1.6.1 (docs/security/asvs-l2.md): the key-management policy (docs/security/key-management.md) follows a
// standard (NIST SP 800-57 Part 1) through each stage of a key's life, and lists every secret the code reads: each name
// read from the environment (process.env, a Worker's env or bindings) or declared in a Worker's env interface that names
// a secret, a token, a key or a passphrase. A new secret in the code without a row in the policy fails here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const POLICY = readFileSync("docs/security/key-management.md", "utf8");
const SECRET_NAME = /(^|_)(SECRET|SECRETS|TOKEN|KEY|KEYS|PASSWORD|PASSPHRASE|CREDENTIALS?)(_|$)/;

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules") files(p, out); } else if (/\.(ts|mjs|js)$/.test(n) && !/\.gen\./.test(n)) out.push(p);
  }
  return out;
}

/** Every secret-like name the code reads, with where. */
function secretsInCode(): Map<string, string> {
  const found = new Map<string, string>();
  const add = (name: string, where: string) => { if (SECRET_NAME.test(name) && !found.has(name)) found.set(name, where); };
  for (const f of ["src", "cloud/src", "worker/src", "scripts"].flatMap((d) => files(d))) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/\b(?:process\.env|env|b|bindings)\s*\??\.\s*([A-Z][A-Z0-9_]{2,})\b|process\.env\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g)) add(m[1] ?? m[2]!, f);
  }
  // The Workers' env interfaces: a secret read by destructuring is still declared there.
  for (const f of ["cloud/src/worker.ts", "worker/src/index.ts"]) {
    for (const m of readFileSync(f, "utf8").matchAll(/^\s+([A-Z][A-Z0-9_]+)\??:\s*string/gm)) add(m[1]!, f);
  }
  return found;
}

/** The names in the policy's inventory tables (a row's first cell, in backticks). */
const listed = new Set([...POLICY.matchAll(/^\| `([A-Z][A-Z0-9_]+)`/gm)].map((m) => m[1]!));

describe("the key-management policy (V1.6.1)", () => {
  it("follows a named standard through every stage of a key's life", () => {
    expect(POLICY).toMatch(/NIST SP 800-57 Part 1/);
    for (const h of ["Roles", "Generation", "Storage and distribution", "Use", "Rotation", "Compromise", "Destruction", "Algorithms", "Inventory"]) expect(POLICY, h).toMatch(new RegExp(`^## ${h}`, "m"));
  });

  it("lists every secret the code reads", () => {
    const code = secretsInCode();
    expect(code.size).toBeGreaterThan(30);
    const missing = [...code].filter(([n]) => !listed.has(n)).map(([n, f]) => `${n} (${f})`);
    expect(missing).toEqual([]);
  });

  it("gives each listed secret an owner, where it lives and a rotation period", () => {
    const rows = [...POLICY.matchAll(/^\| `([A-Z][A-Z0-9_]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)];
    expect(rows.length).toBe(listed.size);
    for (const r of rows) for (const cell of r.slice(2)) expect(cell!.trim().length, r[1]).toBeGreaterThan(2);
  });

  it("puts no secret value in the policy", () => {
    expect(POLICY).not.toMatch(/\b(pck_k|pak_|sk-ant-|whsec_[A-Za-z0-9]{8}|-----BEGIN)/);
  });
});
