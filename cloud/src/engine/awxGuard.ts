// The Cloud's lock in front of every Airwallex action (14 Nov): the admin's switches and the daily caps, read from the
// deployment's own tables (cloud/src/try/switches.ts). Fail closed: a missing switch is OFF, a missing cap is 0, a
// table that cannot be read stops Airwallex and the simulated bank takes the step, labelled.
//
//   awx_act                   on: a signed-in company's actions may use the Airwallex sandbox (off by default)
//   awx_act_try               on: a /try visitor's test company may too (off by default)
//   awx_act_company_cents_day the most one company moves at Airwallex in a UTC day, in cents (EUR, USD, GBP counted together)
//   awx_act_global_cents_day  the most all companies together move at Airwallex in a UTC day, in cents
//
// What a money call speaks for is written once per request_id, in one statement that also checks both caps, so two
// payments at once can never pass a cap together and a retry under the same request_id is never counted twice.
import type { ActGuard, SpendKind } from "../../../src/airwallex/routedRail.js";
import { ActCapReached } from "../../../src/airwallex/routedRail.js";
import type { Sql } from "../store.js";
import { num, on, readSwitches, type Switches } from "../try/switches.js";

export const SPEND_TABLE = `CREATE TABLE IF NOT EXISTS awx_act_spend (
  key TEXT PRIMARY KEY, tenant TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, currency TEXT NOT NULL, cents INTEGER NOT NULL, at TEXT NOT NULL
)`;
const ready = new WeakSet<Sql>();

export interface GuardOpts {
  sql: Sql;
  tenantId: string;
  /** Whether the deployment holds the gateway binding at all. */
  gateway: boolean;
  now?: () => Date;
  /** How long a read of the switches is kept (default 5 s): the kill switch takes effect within that. */
  cacheMs?: number;
}

const money = (c: number) => (c / 100).toFixed(2);

export function cloudGuard(o: GuardOpts): ActGuard & { caps(): Promise<{ company_cents_day: number; global_cents_day: number; company_used_cents: number; global_used_cents: number; currencies: string[] }> } {
  const now = o.now ?? (() => new Date());
  let cached: { at: number; s: Switches | null } | null = null;
  const switches = async (): Promise<Switches | null> => {
    if (cached && now().getTime() - cached.at < (o.cacheMs ?? 5000)) return cached.s;
    let s: Switches | null;
    try { s = await readSwitches(o.sql); } catch { s = null; }
    cached = { at: now().getTime(), s };
    return s;
  };
  const table = async () => {
    if (ready.has(o.sql)) return;
    await o.sql.exec(SPEND_TABLE);
    ready.add(o.sql);
  };
  const day = () => now().toISOString().slice(0, 10);
  const used = async (tenant: string | null) => {
    await table();
    const r = await o.sql.first<{ c: number | null }>(`SELECT SUM(cents) AS c FROM awx_act_spend WHERE day = ?${tenant ? " AND tenant = ?" : ""}`, tenant ? [day(), tenant] : [day()]);
    return Number(r?.c ?? 0);
  };
  const capsOf = (s: Switches) => ({ company: num(s, "awx_act_company_cents_day"), global: num(s, "awx_act_global_cents_day") });

  return {
    async blocked() {
      if (!o.gateway) return "this deployment has no Airwallex gateway";
      const s = await switches();
      if (!s) return "the switches could not be read";
      if (!on(s, "awx_act")) return "Airwallex actions are switched off (awx_act)";
      if (o.tenantId.startsWith("t_try_") && !on(s, "awx_act_try")) return "Airwallex actions are off for /try test companies (awx_act_try)";
      const c = capsOf(s);
      if (c.company <= 0 || c.global <= 0) return "no daily cap is set for Airwallex actions";
      return null;
    },

    async spend(a: { key: string; kind: SpendKind; currency: string; cents: number }) {
      if (!Number.isSafeInteger(a.cents) || a.cents <= 0) throw new ActCapReached("an amount above zero is needed");
      const s = await switches();
      if (!s) throw new ActCapReached("the caps could not be read; nothing is sent");
      const c = capsOf(s);
      await table();
      const key = `${o.tenantId}:${a.key}`;
      const d = day();
      const at = now().toISOString();
      const done = await o.sql.run(
        `INSERT INTO awx_act_spend (key, tenant, day, kind, currency, cents, at)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COALESCE(SUM(cents), 0) FROM awx_act_spend WHERE day = ? AND tenant = ?) + ? <= ?
           AND (SELECT COALESCE(SUM(cents), 0) FROM awx_act_spend WHERE day = ?) + ? <= ?
           AND NOT EXISTS (SELECT 1 FROM awx_act_spend WHERE key = ?)`,
        [key, o.tenantId, d, a.kind, a.currency, a.cents, at, d, o.tenantId, a.cents, c.company, d, a.cents, c.global, key],
      );
      if (done.changes === 1) return;
      // Spoken for already under this request_id (a retry): counted once, allowed again.
      if (await o.sql.first("SELECT 1 FROM awx_act_spend WHERE key = ?", [key])) return;
      const [mine, all] = [await used(o.tenantId), await used(null)];
      if (mine + a.cents > c.company) throw new ActCapReached(`this company's daily cap for Airwallex actions is ${money(c.company)}; ${money(mine)} is used today and this needs ${money(a.cents)}`);
      throw new ActCapReached(`the daily cap for Airwallex actions across all companies is ${money(c.global)}; ${money(all)} is used today and this needs ${money(a.cents)}`);
    },

    async release(key: string) {
      await table();
      await o.sql.run("DELETE FROM awx_act_spend WHERE key = ?", [`${o.tenantId}:${key}`]);
    },

    async caps() {
      const s = (await switches()) ?? {};
      const c = capsOf(s);
      return { company_cents_day: c.company, global_cents_day: c.global, company_used_cents: await used(o.tenantId), global_used_cents: await used(null), currencies: ["EUR", "USD", "GBP"] };
    },
  };
}
