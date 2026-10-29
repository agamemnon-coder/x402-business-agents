// Runs the pinned metal-agent CLI (0.3.3). Its output is "key value" lines, parsed into a map.
// HOME points into the keys directory so pull keep-files survive the container (risk R14).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const BIN = resolve(import.meta.dirname, "../../node_modules/.bin/metal-agent");

/** Where owner keys, mandate keys and credentials live: never inside this repo. */
export function keysDir(env = process.env): string {
  // Absolute, always: metal-agent refuses a relative HOME (and a relative path would move with the working directory).
  const dir = resolve(env.KIT11_KEYS_DIR ?? resolve(import.meta.dirname, "../../../x402-business-agents-keys/testnet"));
  const repo = resolve(import.meta.dirname, "../..");
  if (dir === repo || dir.startsWith(repo + sep)) throw new Error("KIT11_KEYS_DIR must be outside the code repo");
  mkdirSync(join(dir, "home"), { recursive: true, mode: 0o700 });
  return dir;
}

export const keyPath = (name: string) => join(keysDir(), name);
export const hasKey = (name: string) => existsSync(keyPath(name));

export interface CliResult {
  code: number;
  fields: Map<string, string[]>;
  out: string;
}

export class CliError extends Error {
  constructor(readonly args: string[], readonly result: CliResult) {
    super(`metal-agent ${args.slice(0, 3).join(" ")} exited ${result.code}: ${scrub(result.out).slice(-600)}`);
  }
}

/** Never let the RPC URL (a credential) into an error message or log. */
export function scrub(text: string): string {
  return text.replace(/https:\/\/rpc-testnet\.metalntwx\.com\/\S*/g, "[rpc-url]");
}

function parse(out: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const line of out.split("\n")) {
    const i = line.indexOf(" ");
    if (i <= 0) continue;
    const k = line.slice(0, i);
    m.set(k, [...(m.get(k) ?? []), line.slice(i + 1).trim()]);
  }
  return m;
}

/** Exit codes that are outcomes, not errors (mandate pull: 1 refused, 3 pending, 4 held). */
export function metalAgent(args: string[], okCodes: number[] = [0]): CliResult {
  const r = spawnSync(BIN, [...args, "--network", "testnet"], {
    env: { ...process.env, HOME: join(keysDir(), "home") },
    encoding: "utf8",
    timeout: 180_000,
  });
  const out = scrub(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  const result: CliResult = { code: r.status ?? -1, fields: parse(out), out };
  // An "error:" line means the command did not run (bad input, bad setup); exit 1 must not read as "refused".
  if (!okCodes.includes(result.code) || /^error: /m.test(out)) throw new CliError(args, result);
  return result;
}

export function field(r: CliResult, key: string): string {
  const v = r.fields.get(key)?.[0];
  if (v === undefined) throw new Error(`metal-agent output has no "${key}" line:\n${r.out}`);
  return v;
}
