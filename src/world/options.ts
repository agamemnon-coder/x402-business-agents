// A world's own options for the main run (Max, 2 November), so every Kit 11 sentence can happen in one world. Each is a
// setting of that world's ledger, written once on a fresh world by `npm run world -- setup` and read by code in every
// process of that world (the serve loop and the runner alike). No agent tool writes them; unset, the world is as before.
//
//   world.upstream_cache = off   every customer query buys its stock check upstream once: code serves no cached stock
//                                check, whatever cache the Sourcing agent's buy policy asks for (Kit 11: "A query sells
//                                for 5 cents and its upstream data costs 2 cents").
//   world.free_eur_target = x.xx the free EUR Treasury's first calibration leaves (default 1,500.00): below the licence
//                                plus its fee ceiling, the licence plan must convert the shortfall on a fresh quote.
//   world.tap_rail = on          the Sourcing agent's Packwise card purchase is signed with Visa TAP (as KIT11_TAP_RAIL=on).
//
// KIT11_UPSTREAM_CACHE=off in a process's environment turns the cache off too (never on).

import { existsSync } from "node:fs";
import type { DB } from "../db/open.js";
import { LICENCE_FEE_EUR_CENTS, SWIFT_FEE_MAX_EUR_CENTS } from "../config/policy.js";
import { fromCents, toCents } from "../lib/money.js";
import { keyPath } from "../metal/agentCli.js";
import { getSetting, setSetting } from "./settings.js";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** Whether code may serve a cached stock check in this world: not when the world (or this process) turned it off. */
export function upstreamCacheOff(db: DB, env: Env = process.env): boolean {
  return getSetting(db, "world.upstream_cache", "") === "off" || env.KIT11_UPSTREAM_CACHE === "off";
}

/** The free EUR this world's first treasury calibration leaves, in cents; null: the default. */
export function freeEurTargetCents(db: DB): number | null {
  const v = getSetting(db, "world.free_eur_target", "");
  if (!/^\d+\.\d{2}$/.test(v)) return null;
  // The same bound setupWorld checks, here too: a target at or above the licence plus its fee ceiling is ignored (the
  // default applies), so a value written some other way can never leave more free EUR than the world asked for.
  const cents = toCents(v);
  return cents < LICENCE_FEE_EUR_CENTS + SWIFT_FEE_MAX_EUR_CENTS ? cents : null;
}

/** Whether this world's Packwise card purchase goes through the TAP rail. */
export function tapRailInWorld(db: DB): boolean {
  return getSetting(db, "world.tap_rail", "") === "on";
}

export interface WorldSetup {
  upstreamCache?: "off";
  freeEur?: string;
  tapRail?: "on";
}

/**
 * Writes the options on a fresh world. Refused (nothing written) on a world that already sold or bought anything, for
 * a free EUR target once Treasury's calibration has run (it would change nothing), and for the TAP rail before the
 * Sourcing agent's TAP key exists and is pinned for Packwise (npm run visa -- setup). The same value again is a no-op;
 * an option once set is not changed here.
 */
export function setupWorld(db: DB, o: WorldSetup, now = new Date()): string[] {
  const problems: string[] = [];
  const used = (db.prepare("SELECT (SELECT COUNT(*) FROM sales) + (SELECT COUNT(*) FROM upstream_purchases) AS n").get() as { n: number }).n;
  if (used > 0) problems.push("this world already sold or bought stock checks; world options are for a fresh world");
  const same = (key: "world.upstream_cache" | "world.free_eur_target" | "world.tap_rail", v: string) => {
    const was = getSetting(db, key, "");
    if (was && was !== v) problems.push(`${key} is already ${was}; it is not changed here`);
  };
  if (o.upstreamCache) same("world.upstream_cache", o.upstreamCache);
  if (o.freeEur !== undefined) {
    if (!/^\d+\.\d{2}$/.test(o.freeEur)) problems.push(`not an amount: ${o.freeEur}`);
    else {
      const need = LICENCE_FEE_EUR_CENTS + SWIFT_FEE_MAX_EUR_CENTS;
      if (toCents(o.freeEur) >= need) problems.push(`free EUR ${o.freeEur} covers the licence and its fee ceiling (${fromCents(need)}): no FX would be needed`);
      if (getSetting(db, "eur_obligations", "") !== "") problems.push("Treasury's calibration already ran in this world (eur_obligations is set); a target now would change nothing");
      same("world.free_eur_target", o.freeEur);
    }
  }
  if (o.tapRail) {
    same("world.tap_rail", o.tapRail);
    const pinned = db.prepare("SELECT 1 FROM tap_agents WHERE agent = 'sourcing' AND revoked_at IS NULL AND domains_json LIKE '%packwise.example%'").get();
    if (!existsSync(keyPath("tap-sourcing.key.json")) || !pinned) problems.push("the Sourcing agent has no TAP key pinned for Packwise in this world yet: npm run cards -- setup, then npm run visa -- setup");
  }
  if (problems.length) throw new Error(`world setup refused, nothing written: ${problems.join("; ")}`);
  const out: string[] = [];
  const write = (key: "world.upstream_cache" | "world.free_eur_target" | "world.tap_rail", v: string, line: string) => {
    if (getSetting(db, key, "") !== v) setSetting(db, "system", key, v, now);
    out.push(line);
  };
  if (o.upstreamCache) write("world.upstream_cache", "off", "upstream cache off: every customer query buys its stock check upstream once; the buy policy's cache has no effect");
  if (o.freeEur) write("world.free_eur_target", o.freeEur, `free EUR at Treasury's first calibration: ${o.freeEur} (licence ${fromCents(LICENCE_FEE_EUR_CENTS)} plus fee ceiling ${fromCents(SWIFT_FEE_MAX_EUR_CENTS)} at least: the plan converts the shortfall)`);
  if (o.tapRail) write("world.tap_rail", "on", "TAP rail on: the Sourcing agent's Packwise card purchase is signed with Visa TAP and checked by our merchant layer before its card is charged");
  return out;
}
