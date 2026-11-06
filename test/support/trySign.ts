// Helpers for the /try/sign tests: a test-world desk over an in-memory store, its requests, a visitor with a passkey.
import Database from "better-sqlite3";
import { expect } from "vitest";
import { FakeAuthenticator } from "../../src/redteam/authenticator.js";
import { TrySignDesk } from "../../worker/src/trySign.js";
import type { Sql } from "../../worker/src/core.js";
import type { FxSource } from "../../worker/src/fxQuote.js";

export const RP = "kit11.example.workers.dev";
export const BASE = `https://${RP}`;
export const t0 = new Date("2026-11-04T10:00:00Z");

export function sqlOver(db: Database.Database): Sql {
  return { exec(q, ...b) { const st = db.prepare(q); const rows = st.reader ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } };
}
export function desk(db = new Database(":memory:"), fx: FxSource | null = null) {
  let clock = t0;
  const d = new TrySignDesk(sqlOver(db), { now: () => clock, fx });
  return { d, db, at: (t: Date) => { clock = t; } };
}
let ipN = 0;
export const call = (d: TrySignDesk, sub: string, body: unknown, o: { ip?: string; origin?: string | null; method?: string } = {}) => d.fetch(new Request(`${BASE}/api/try-sign/${sub}`, {
  method: o.method ?? "POST",
  headers: { "content-type": "application/json", "cf-connecting-ip": o.ip ?? "203.0.113.9", ...(o.origin === null ? {} : { origin: o.origin ?? BASE }) },
  ...(o.method === "GET" ? {} : { body: JSON.stringify(body) }),
}));

export interface Proposal { proposal_id: string; canonical: string; terms_sha256: string; status: string; check: "pass" | "fail"; rule?: string; waits?: string }
export interface WorldAnswer { world: { id: string; token: string; expires_at: string; balance: string }; proposals: Proposal[]; passkey_options: Record<string, unknown> & { challenge: string; user: { id: string; name: string; displayName: string }; authenticatorSelection: Record<string, unknown> } }

export async function newWorld(d: TrySignDesk, ip = `198.51.100.${++ipN % 250}`): Promise<WorldAnswer> {
  const res = await call(d, "world", {}, { ip });
  expect(res.status).toBe(201);
  return (await res.json()) as WorldAnswer;
}
export async function withPasskey(d: TrySignDesk, auth = new FakeAuthenticator()) {
  const w = await newWorld(d);
  const res = await call(d, "passkey", { token: w.world.token, credential: auth.register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP }) });
  expect(res.status).toBe(201);
  return { w, auth, a: w.proposals.find((p) => p.check === "fail")!, b: w.proposals.find((p) => p.check === "pass")! };
}
export const challengeOf = (sha: string) => Buffer.from(sha, "hex").toString("base64url");
export const signBody = (token: string, p: Proposal, credential: unknown, canonicalText = p.canonical) => ({ token, proposal_id: p.proposal_id, canonical: canonicalText, credential });
