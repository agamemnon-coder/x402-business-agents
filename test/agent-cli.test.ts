// The metal-agent wrapper: the keys directory is always absolute (metal-agent refuses a relative HOME), and an
// "error:" from the CLI is an error, never mistaken for a refused payment.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { keysDir, metalAgent } from "../src/metal/agentCli.js";

describe("metal-agent wrapper", () => {
  it("returns an absolute keys directory when KIT11_KEYS_DIR is relative", () => {
    const dir = mkdtempSync(join(tmpdir(), "kit11-keys-"));
    const got = keysDir({ KIT11_KEYS_DIR: relative(process.cwd(), dir) });
    expect(isAbsolute(got)).toBe(true);
    expect(got).toBe(dir);
  });

  it("throws on an error line even when the exit code would mean refused", () => {
    // A relative HOME makes metal-agent print "error: HOME is … not an absolute path" and exit 1, before any network call.
    const before = process.env.KIT11_KEYS_DIR;
    process.env.KIT11_KEYS_DIR = mkdtempSync(join(tmpdir(), "kit11-keys-"));
    try {
      expect(() => metalAgent(["mandate", "pull", "--credential", "/nonexistent.json", "--to", "0x0", "--amount", "0.01", "--payment-id", "x"], [0, 1, 3, 4])).toThrow(/metal-agent mandate pull/);
    } finally {
      if (before === undefined) delete process.env.KIT11_KEYS_DIR;
      else process.env.KIT11_KEYS_DIR = before;
    }
  });
});
