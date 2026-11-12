// The Skill file for outside agents (skills/purser-spend/SKILL.md, the open SKILL.md format): how an agent should use
// the agent API (src/platform/mcpServer.ts). A Markdown file under skills/ is not linted, so this test is its only
// guard. Breaks when the skill names a tool the server does not register (or leaves one out), names a refusal code or
// a result field the server never returns, holds a key or a link outside this repository, or loses the two rules an
// agent must keep: only a person approves, and a declined charge is never retried.
import { existsSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { decide } from "../src/policy/approvals.js";
import { revokePrincipal } from "../src/policy/principals.js";
import { agentApiServer } from "../src/platform/mcpServer.js";
import { agentId, executeAgentOnboard, requestCompanyCard } from "../src/platform/externalAgents.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { ClaudeReader } from "../src/claude/reader.js";

const root = (p: string) => new URL(`../${p}`, import.meta.url);
const read = (p: string) => readFileSync(root(p), "utf8");
const FOLDER = "purser-spend";
const PATH = `skills/${FOLDER}/SKILL.md`;
const SKILL = existsSync(root(PATH)) ? read(PATH) : "";

/** The YAML frontmatter's plain "key: value" lines, or null if the file does not start with one. */
function frontmatter(text: string): Record<string, string> | null {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  return Object.fromEntries(m[1]!.split("\n").map((l) => /^([a-z_-]+):\s*(.*)$/.exec(l)).filter((x) => x !== null).map((x) => [x[1]!, x[2]!.replace(/^["']|["']$/g, "").trim()]));
}

/** What the server really registers and returns: its tools, the fields of its structured results, its refusal codes. */
const real = { tools: [] as string[], fields: new Set<string>(), codes: new Set<string>() };
beforeAll(async () => {
  const db = openDb(":memory:");
  const awx = new FakeIssuing();
  const id = agentId("skill-check");
  requestCompanyCard(db, id, { displayName: "Skill check", purpose: "reports", perTx: "25.00", monthly: "100.00" });
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = 'P-0001'").get() as { terms_sha256: string };
  decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" });
  await executeAgentOnboard(db, awx, "P-0001");
  const client = new Client({ name: "skill-check", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([agentApiServer(db, id, awx, new ClaudeReader(db, null)).connect(a), client.connect(b)]);
  real.tools = (await client.listTools()).tools.map((t) => t.name);
  const pay = (amount_eur: string) => client.callTool({ name: "pay_with_card", arguments: { merchant: "TrailData Reports", amount_eur, description: "report" } });
  const results = [await pay("19.00"), await pay("40.00")];
  revokePrincipal(db, id, "skill check", "max");
  results.push(await pay("19.00"));
  for (const r of results) for (const k of Object.keys(r.structuredContent ?? {})) real.fields.add(k);
  await client.close();
  // Purser's refusal codes ("code: message") as the gate writes them, and the decline reasons the card rail gives.
  for (const m of `${read("src/policy/principals.ts")}\n${read("src/platform/mcpServer.ts")}`.matchAll(/`([a-z]+(?:_[a-z]+)+): /g)) real.codes.add(m[1]!);
  for (const m of read("src/redteam/issuing.ts").matchAll(/"([A-Z]+(?:_[A-Z]+)+)"/g)) real.codes.add(m[1]!);
});

describe("the Skill file for outside agents (skills/purser-spend/SKILL.md)", () => {
  it("starts with frontmatter: its name (the folder's) and a description that says when to use it", () => {
    expect(SKILL).not.toBe("");
    const fm = frontmatter(SKILL);
    expect(fm).not.toBeNull();
    expect(fm!.name).toBe(FOLDER);
    expect(fm!.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(fm!.description ?? "").toMatch(/\bwhen\b/i);
    expect(SKILL.split("\n").length).toBeLessThanOrEqual(60);
  });

  it("names every tool the server registers, and no other; every code and field it names is real", () => {
    expect(real.tools).toHaveLength(5);
    const ticked = [...SKILL.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
    for (const t of real.tools) expect(ticked).toContain(t);
    // An identifier in backticks (snake_case or an upper-case code) must be a tool, a result field or a refusal code.
    const identifiers = ticked.filter((t) => /^[a-z]+(_[a-z0-9]+)+$|^[A-Z]+(_[A-Z]+)+$/.test(t));
    for (const t of identifiers) expect(real.tools.includes(t) || real.fields.has(t) || real.codes.has(t), `${t} in ${PATH}`).toBe(true);
  });

  it("holds no key and no link outside this repository, and keeps the two rules", () => {
    expect(SKILL).not.toMatch(/https?:\/\/|www\./i);
    expect(SKILL).not.toMatch(/[A-Za-z0-9+/_=-]{32,}/);
    expect(SKILL).not.toMatch(/\b(api[_ -]?key|secret|token|password)\s*[:=]\s*\S/i);
    for (const [, target] of SKILL.matchAll(/\]\(([^)]+)\)/g)) expect(existsSync(new URL(target!.split("#")[0]!, root(PATH))), target).toBe(true);
    expect(SKILL).toContain("Only a person can approve");
    expect(SKILL).toContain("Never retry a declined charge");
  });

  it("makes no claim the project may not make", () => {
    for (const t of [SKILL, read("docs/agent-api.md")]) expect(t).not.toMatch(/x402 over MCP|official skill|published skill|Anthropic-approved|follows Anthropic's practices/i);
  });
});

describe("docs/agent-api.md", () => {
  // Breaks when the docs list fewer tools than the server registers (they said four while it registered five).
  it("lists every tool the server registers, in its table", () => {
    const rows = read("docs/agent-api.md").split("\n").filter((l) => /^\| `[a-z_]+` \|/.test(l)).map((l) => /^\| `([a-z_]+)`/.exec(l)![1]!);
    expect(rows.sort()).toEqual([...real.tools].sort());
    expect(read("docs/agent-api.md")).toContain(PATH);
  });
});
