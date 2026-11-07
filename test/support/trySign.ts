// Helpers for the /try/sign tests: a test-world desk over an in-memory store, its requests, a visitor with a passkey.
import Database from "better-sqlite3";
import { expect } from "vitest";
import { FakeAuthenticator } from "../../src/redteam/authenticator.js";
import { AGENT_STEPS, TrySignDesk, type TrySignOptions } from "../../worker/src/trySign.js";
import type { Sql } from "../../worker/src/core.js";
import type { FxSource } from "../../worker/src/fxQuote.js";

export const RP = "kit11.example.workers.dev";
export const BASE = `https://${RP}`;
export const t0 = new Date("2026-11-04T10:00:00Z");

export function sqlOver(db: Database.Database): Sql {
  return { exec(q, ...b) { const st = db.prepare(q); const rows = st.reader ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } };
}
/**
 * A recorded EUR/USD rate for the tests (the stand-in quote's): with no live quote, the test world checks a payment that
 * needs FX at the recorded rate; with no rate at all it blocks it ("no rate to plan the conversion").
 */
export const TEST_RATE = { usdPerEur: "1.129677", date: "2026-11-02", source: "test rate" } as const;
export function desk(db = new Database(":memory:"), fx: FxSource | null = null, rate: { usdPerEur: string; date: string; source: string } | null = TEST_RATE, opts: Omit<TrySignOptions, "now" | "fx" | "rate"> = {}) {
  let clock = t0;
  const d = new TrySignDesk(sqlOver(db), { now: () => clock, fx, rate, ...opts });
  return { d, db, at: (t: Date) => { clock = t; } };
}
let ipN = 0;
export const call = (d: TrySignDesk, sub: string, body: unknown, o: { ip?: string; origin?: string | null; method?: string } = {}) => d.fetch(new Request(`${BASE}/api/try-sign/${sub}`, {
  method: o.method ?? "POST",
  headers: { "content-type": "application/json", "cf-connecting-ip": o.ip ?? "203.0.113.9", ...(o.origin === null ? {} : { origin: o.origin ?? BASE }) },
  ...(o.method === "GET" ? {} : { body: JSON.stringify(body) }),
}));

export interface Proposal { proposal_id: string; canonical: string; terms_sha256: string; status: string; check: "pass" | "fail"; rule?: string; waits?: string }
export interface WorldAnswer { world: { id: string; token: string; expires_at: string; balance: string }; proposals: Proposal[]; steps?: Record<string, Record<string, unknown>>; passkey_options: Record<string, unknown> & { challenge: string; user: { id: string; name: string; displayName: string }; authenticatorSelection: Record<string, unknown> } }

/** The agents' steps on T-0002, one request each, in order (spec 6b); the answers, by step. */
export async function walkAgents(d: TrySignDesk, token: string, ip = "203.0.113.9"): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const step of AGENT_STEPS) {
    const res = await call(d, "agents", { token }, { ip });
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown> & { step: string };
    expect(j.step).toBe(step);
    out[step] = j;
  }
  return out;
}
/** A new world; by default with its agents' steps walked, so T-0002 is there (its proposals as the last step gives them). */
export async function newWorld(d: TrySignDesk, ip = `198.51.100.${++ipN % 250}`, o: { agents?: boolean } = {}): Promise<WorldAnswer> {
  const res = await call(d, "world", {}, { ip });
  expect(res.status).toBe(201);
  const w = (await res.json()) as WorldAnswer;
  if (o.agents === false) return w;
  const steps = await walkAgents(d, w.world.token, ip);
  return { ...w, proposals: (steps.ready as unknown as { proposals: Proposal[] }).proposals, steps } as WorldAnswer;
}
export async function withPasskey(d: TrySignDesk, auth = new FakeAuthenticator()) {
  const w = await newWorld(d);
  const res = await call(d, "passkey", { token: w.world.token, credential: auth.register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP }) });
  expect(res.status).toBe(201);
  return { w, auth, a: w.proposals.find((p) => p.check === "fail")!, b: w.proposals.find((p) => p.check === "pass")! };
}
export const challengeOf = (sha: string) => Buffer.from(sha, "hex").toString("base64url");
export const signBody = (token: string, p: Proposal, credential: unknown, canonicalText = p.canonical) => ({ token, proposal_id: p.proposal_id, canonical: canonicalText, credential });
