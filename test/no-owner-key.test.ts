// Max, 1 November: no agent, also not in autonomous mode, has or can use an owner key. What holds, checked in the code:
// - The business owner's key file is named in five places only: the owner signer (credentials, mandate replace), the
//   pause on chain (run by the executor after the CFO's Face ID), the one-off bootstrap, and two CLIs a person runs
//   (verify reads the issuer's PUBLIC key; clearing withdraws as the owner). No agent, autonomy, Claude or /try module
//   names it, and the refusal recorder pays its gas from a gas-only key.
// - `mandate replace` (the owner's on-chain act) is called from the executor only, after an approved proposal.
// - At proposal time the Treasury flow has the owner's issuer sign the replacement credential off chain: it moves
//   nothing until `mandate replace` binds it, and the CFO's Face ID approves exactly that credential (its hash).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|html)$/.test(f) ? [p] : []; });
}
const SRC = files(join(ROOT, "src")).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf8") }));
const AGENT_DIRS = /^src\/(agents|autonomy|claude|try|evals|mcp|platform)\//;

describe("no agent has or can use an owner key", () => {
  it("the business owner's key file is named only by the owner signer, the pause, the bootstrap and two people's CLIs", () => {
    const naming = SRC.filter((f) => f.text.includes("owner-business.key")).map((f) => f.path).sort();
    expect(naming).toEqual(["src/cli/bootstrap.ts", "src/cli/clearing.ts", "src/cli/verify.ts", "src/executors/ownerSigner.ts", "src/metal/pauseChain.ts"]);
  });

  it("no agent, autonomy, Claude or /try module names any owner key file", () => {
    expect(SRC.filter((f) => AGENT_DIRS.test(f.path) && /owner-[a-z]+\.key/.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it("the owner's on-chain act (mandate replace) is called from the executor only", () => {
    const callers = SRC.filter((f) => /\breplaceMandate\(/.test(f.text) && !f.path.endsWith("ownerSigner.ts")).map((f) => f.path);
    expect(callers).toEqual(["src/executors/mandateReplace.ts"]);
    const pausers = SRC.filter((f) => /new LivePauseChain\(/.test(f.text)).map((f) => f.path).sort();
    expect(pausers.every((p) => /^src\/(executors|cli)\//.test(p))).toBe(true);
  });

  it("the owner's issuer signs a replacement credential only in the Treasury proposal, whose terms carry its hash for the CFO", () => {
    const users = SRC.filter((f) => /\bissueReplacementCredential\(/.test(f.text) && !f.path.endsWith("ownerSigner.ts")).map((f) => f.path);
    expect(users).toEqual(["src/agents/treasury.ts"]);
    expect(SRC.find((f) => f.path === "src/agents/treasury.ts")!.text).toMatch(/credential_hash: next\.hash/);
  });

  it("recording Alta's refusal on chain pays gas from a gas-only key, not the owner's", () => {
    const rec = SRC.find((f) => f.path === "src/metal/recordRefusal.ts")!.text;
    expect(rec).not.toMatch(/owner-/);
    expect(rec).toMatch(/gas-sponsor\.key\.json/);
  });
});
