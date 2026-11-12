// The engine object's Claude for a try company (cloud/src/engine/tryClaude.ts): the switches and the company's pool are
// the demo's own (try_switches, try_companies), the same ones POST /v1/try/start reads when it says "Claude reads live".
// Jury check H4 (12 Nov): the object passed no switches, so every reservation said switch_off and the parser read every
// invoice while the band said Claude was live. A missing or unreadable switch table keeps Claude off.
import { describe, expect, it } from "vitest";
import { ensureSchema } from "../cloud/src/app.js";
import { tryClaudeAccess } from "../cloud/src/engine/tryClaude.js";
import { sqliteSql } from "../cloud/src/node.js";
import { d1Sql, type Sql } from "../cloud/src/store.js";

const SWITCHES: Record<string, string> = { claude: "on", cap_action_micros: "250000", cap_company_micros: "400000", cap_addr_micros: "1200000", cap_day_micros_public: "4000000", cap_all_micros: "75000000", max_inflight: "8" };

async function fresh(switches: Record<string, string> | null): Promise<Sql> {
  const sql = process.env.CLOUD_DB === "d1" && globalThis.__cloudD1 ? d1Sql(globalThis.__cloudD1.next()) : sqliteSql();
  await ensureSchema(sql);
  for (const [k, v] of Object.entries(switches ?? {})) await sql.run("INSERT INTO try_switches (key, value, updated_at) VALUES (?, ?, ?)", [k, v, "2026-11-12T18:00:00Z"]);
  await sql.run("INSERT INTO try_companies (tenant_id, created_at, expires_at, pool, addr, visitor_sha256) VALUES (?, ?, ?, ?, ?, ?)", ["t_try_1", "2026-11-12T18:00:00Z", "2026-11-13T18:00:00Z", "public", "h9", "v"]);
  return sql;
}

describe("Claude for a try company's engine", () => {
  it("reserves under the demo's own switches and the company's pool, so the band's \"Claude reads live\" is true", async () => {
    const sql = await fresh(SWITCHES);
    const a = tryClaudeAccess({ ENGINE_CLAUDE: "on", KIT11_ANTHROPIC_API_KEY: "sk-ant-test-not-a-key" }, sql, "t_try_1")!;
    expect(await a.reserve()).toMatchObject({ ok: true });
    const scopes = (await sql.all<{ scope: string }>("SELECT scope FROM try_spend ORDER BY scope")).map((r) => r.scope);
    expect(scopes).toContain("co:t_try_1");
    expect(scopes.some((s) => s.startsWith("addr:h9:"))).toBe(true);
    expect(scopes.some((s) => s.startsWith("day:public:"))).toBe(true);
  });

  it("keeps Claude off when the switch is off, missing, or the table cannot be read", async () => {
    expect(await tryClaudeAccess({ ENGINE_CLAUDE: "on", KIT11_ANTHROPIC_API_KEY: "k" }, await fresh({ ...SWITCHES, claude: "off" }), "t_try_1")!.reserve()).toEqual({ ok: false, reason: "switch_off" });
    expect(await tryClaudeAccess({ ENGINE_CLAUDE: "on", KIT11_ANTHROPIC_API_KEY: "k" }, await fresh(null), "t_try_1")!.reserve()).toEqual({ ok: false, reason: "switch_off" });
    const broken = await fresh(SWITCHES);
    await broken.run("DROP TABLE try_switches", []);
    expect(await tryClaudeAccess({ ENGINE_CLAUDE: "on", KIT11_ANTHROPIC_API_KEY: "k" }, broken, "t_try_1")!.reserve()).toEqual({ ok: false, reason: "switch_off" });
  });

  it("is nothing without ENGINE_CLAUDE on, and says no_key without a key", async () => {
    expect(tryClaudeAccess({}, await fresh(SWITCHES), "t_try_1")).toBeUndefined();
    expect(await tryClaudeAccess({ ENGINE_CLAUDE: "on" }, await fresh(SWITCHES), "t_try_1")!.reserve()).toEqual({ ok: false, reason: "no_key" });
  });
});
