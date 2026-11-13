// The MCP Registry entry (server.json, not published: publishing is a step for the owner, docs/connect-claude.md). It
// holds: it validates against the registry's own schema (2025-12-11, kept in fixtures/), it names the server and its
// version as the server itself does, and its remote is the cloud's /mcp with the token optional and secret.
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "../cloud/src/claude/mcp.js";

const entry = JSON.parse(readFileSync("server.json", "utf8")) as { $schema: string; name: string; version: string; description: string; packages?: unknown; remotes: unknown[] };
const schema = JSON.parse(readFileSync("fixtures/mcp-registry/server.schema.2025-12-11.json", "utf8")) as Record<string, unknown>;

describe("server.json for the official MCP Registry", () => {
  it("validates against the registry's schema", () => {
    const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
    const ok = ajv.validate(schema, entry);
    expect(ok ? null : ajv.errorsText()).toBeNull();
    expect(entry.$schema).toBe(schema.$id);
  });

  it("is a remote-only server at the cloud's /mcp, its version the server's own, the token optional and secret", () => {
    expect(entry.name).toBe("io.github.agamemnon-coder/purser");
    expect(entry.version).toBe(SERVER_VERSION);
    expect(entry.packages).toBeUndefined();
    expect(entry.remotes).toEqual([expect.objectContaining({ type: "streamable-http", url: "https://purser-try.max-31b.workers.dev/mcp", headers: [expect.objectContaining({ name: "Authorization", isRequired: false, isSecret: true })] })]);
    expect(entry.description.length).toBeLessThanOrEqual(100);
    expect(entry.description).toMatch(/Never approves or pays/);
  });
});
