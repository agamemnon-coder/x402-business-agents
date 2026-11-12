// The code an eval row ran: the commit, and whether the checkout had changes outside the eval's own report files.
// Every eval CLI records it on every row (jury panel, 12 November: no row may read "Commit: not recorded").

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const git = (a: string[]) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return ""; } };

/** The short commit (12 characters) and whether the checkout was dirty, leaving out the report files the eval writes itself. */
export function evalCommit(ownFiles: readonly string[]): { commit: string; dirty: boolean } {
  const commit = git(["rev-parse", "--short=12", "HEAD"]) || "unknown";
  return { commit, dirty: git(["status", "--porcelain", "--", ".", ...ownFiles.map((f) => `:!${f}`)]) !== "" };
}
