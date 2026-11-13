// The Claude Code plugin (plugins/purser) and its marketplace (.claude-plugin/marketplace.json): valid manifests, an MCP
// server at /mcp whose token comes from the environment (never a secret in git; the default is the demo company's public
// read-only token), and three skills that name only tools the server has, none of which approves or pays.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_CONNECTOR_TOKEN } from "../cloud/src/auth.js";
import { toolsFor } from "../cloud/src/claude/mcp.js";

const read = (p: string) => readFileSync(p, "utf8");
const TOOLS = toolsFor({ tenantId: "t", kind: "key", principal: "k", scopes: new Set(["read"]), user: null, purpose: "claude-propose" }).map((t) => t.name);

describe("the Purser plugin for Claude Code", () => {
  it("has a marketplace entry and a manifest that agree", () => {
    const market = JSON.parse(read(".claude-plugin/marketplace.json")) as { name: string; plugins: { name: string; source: string }[] };
    const plugin = JSON.parse(read("plugins/purser/.claude-plugin/plugin.json")) as { name: string; version: string; description: string };
    expect(market.plugins).toEqual([expect.objectContaining({ name: plugin.name, source: "./plugins/purser" })]);
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(plugin.description).toMatch(/never approve or pay.*Face ID/);
  });

  it("connects to /mcp with a token from the environment, defaulting to the demo's public read-only token", () => {
    const raw = read("plugins/purser/.mcp.json");
    const cfg = JSON.parse(raw) as { mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }> };
    const s = cfg.mcpServers.purser!;
    expect(s.type).toBe("http");
    expect(s.url).toMatch(/\/mcp\}?$/);
    expect(s.headers.Authorization).toBe(`Bearer \${PURSER_CONNECTOR_TOKEN:-${DEMO_CONNECTOR_TOKEN}}`);
    expect(raw).not.toMatch(/pck_|pca\.|sk-ant|secret/i);
  });

  it("has three skills, each naming only tools the server has, and none that approves or pays", () => {
    const skills = readdirSync("plugins/purser/skills");
    expect(skills.sort()).toEqual(["agent-decisions", "pay-an-invoice", "show-my-books"]);
    for (const s of skills) {
      const md = read(`plugins/purser/skills/${s}/SKILL.md`);
      expect(md).toMatch(new RegExp(`^---\\nname: ${s}\\ndescription: .{40,}\\n---\\n`));
      const named = [...md.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!).filter((n) => /_/.test(n) && !/^(needs_vendor|waiting_cfo|next_cursor|as_of)$/.test(n));
      expect({ s, unknown: named.filter((n) => !TOOLS.includes(n)) }).toEqual({ s, unknown: [] });
    }
    expect(read("plugins/purser/skills/pay-an-invoice/SKILL.md")).toMatch(/nothing is paid until the CFO approves these exact terms with Face ID/i);
    expect(TOOLS.filter((n) => /approve|execute|limit/.test(n))).toEqual([]);
  });
});
