// The MCP Registry entry (server.json, not published: publishing is a step for the owner, docs/connect-claude.md). It
// holds: it validates against the registry's own schema (2025-12-11, kept in fixtures/), it names the server and its
// version as the server itself does, and its remote is the cloud's /mcp with the token optional and secret. Since 19 Nov
// (owner: "server.json complete and valid"): every address the schema marks as a URI parses as one, the header is filled
// from one secret variable ("Bearer {connector_token}"), the repository carries GitHub's own id, and every address in
// it is https on the hosts the cloud and the repository live on.
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "../cloud/src/claude/mcp.js";

type Header = { name: string; value?: string; description?: string; isRequired?: boolean; isSecret?: boolean; variables?: Record<string, { isSecret?: boolean; isRequired?: boolean; placeholder?: string }> };
const entry = JSON.parse(readFileSync("server.json", "utf8")) as { $schema: string; name: string; title: string; version: string; description: string; websiteUrl: string; repository: { url: string; source: string; id: string }; icons: { src: string; mimeType: string }[]; packages?: unknown; remotes: { type: string; url: string; headers: Header[] }[] };
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

  it("is complete: title, website, icons, the repository's id, a filled header, every URI an https address", () => {
    expect(entry.title).toBe("Purser");
    // The schema's "format": "uri" fields (not checked by the validation above, which runs without formats).
    for (const u of [entry.$schema, entry.websiteUrl, entry.repository.url]) expect(new URL(u).protocol).toBe("https:");
    expect(entry.repository).toEqual({ url: "https://github.com/agamemnon-coder/x402-business-agents", source: "github", id: expect.stringMatching(/^\d+$/) });
    for (const u of [entry.websiteUrl, entry.remotes[0]!.url, ...entry.icons.map((i) => i.src)]) expect(new URL(u).origin).toBe("https://purser-try.max-31b.workers.dev");
    expect(entry.icons.map((i) => i.mimeType)).toEqual(["image/png", "image/svg+xml"]);
    const h = entry.remotes[0]!.headers[0]!;
    // The header is built from one variable, which is secret; the value itself is never in the file.
    expect(h.value).toBe("Bearer {connector_token}");
    expect(h.variables).toEqual({ connector_token: expect.objectContaining({ isSecret: true, placeholder: "purser-demo-read-only" }) });
    expect(h.description).toMatch(/no token can approve or pay/);
    expect(JSON.stringify(entry)).not.toMatch(/sk_|Bearer [A-Za-z0-9_-]{20,}/);
  });
});
