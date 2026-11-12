// Claude for a company's engine in the Worker, under the hands-on demo's own switches and the company's own pool: the
// same try_switches POST /v1/try/start reads when it tells the visitor "Claude reads live", and the pool and address
// try_companies holds for the company (an admin-made company is "smoke"). Jury check H4 (12 Nov): the object handed
// claudeAccess no switches, so every reservation said switch_off and the parser read every invoice while the band said
// Claude was live. A switch table that cannot be read keeps Claude off (fail closed), as a missing row does.
import { readSwitches } from "../try/switches.js";
import { tryScopes } from "../try/start.js";
import type { Sql } from "../store.js";
import { claudeAccess } from "./claudeAccess.js";

export interface TryClaudeEnv { ENGINE_CLAUDE?: string; KIT11_ANTHROPIC_API_KEY?: string }

export function tryClaudeAccess(env: TryClaudeEnv, sql: Sql, tenantId: string): ReturnType<typeof claudeAccess> {
  return claudeAccess({
    engineClaude: env.ENGINE_CLAUDE, key: env.KIT11_ANTHROPIC_API_KEY, sql, tenantId,
    switches: async (s) => { try { return await readSwitches(s); } catch { return {}; } },
    scopes: async (s, id) => { const x = await tryScopes(s, id).catch(() => null); return { pool: x?.pool ?? "smoke", address: x?.addr ?? null }; },
  });
}
