// /try/sign's live FX quote (P2, 6 Nov): the Worker asks the Airwallex sandbox for a read-only quote, puts it in the
// terms (schema v3, `fx`; v4 adds the agent's advice), so the signature binds to the quote id; an expired quote is refused even with a good
// signature, and "Get a new quote" means new terms, signed again. The client may make two calls, to one host, and
// nothing else; the key and the token never leave it; the quotes are rate-limited; without a live quote the terms carry
// none and the page shows the main run's recorded quote, labelled. No network here: Airwallex is a fake fetch.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { recordedQuote } from "../src/try/examples.js";
import { verifyReceipt, RECEIPT_FORMAT, type TryReceipt } from "../src/try/receipt.js";
import { SANDBOX_BASE } from "../src/airwallex/client.js";
import { AirwallexCallNotAllowed, AWX_ALLOWED, AWX_SANDBOX_HOST, QuoteUnavailable, SandboxQuotes, allowedUrl, toQuote, type FxQuote } from "../worker/src/fxQuote.js";
import { FIXED_PROPOSALS, TRY_SIGN_FX_ALL_PER_MINUTE, TRY_SIGN_FX_PER_HOUR, TRY_TERMS_SCHEMA, canonical, proposalTerms, wellFormed } from "../worker/src/trySign.js";
import { StandInQuotes } from "./support/fxStandIn.js";
import { BASE, RP, call, challengeOf, desk, signBody, t0, walkAgents, type Proposal } from "./support/trySign.js";

const KEY = "test-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ID = "test-client-id-aaaa";
const TOKEN = "test-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
/** Airwallex's quote answer, in the shape the sandbox gave on 6 Nov (numbers, "+0000" times, more fields). */
const QUOTE = { quote_id: "cc8fb106-29bb-3cce-b011-5fd0b4685617", client_rate: 1.129677, buy_amount: 1850, sell_amount: 2089.9, buy_currency: "EUR", sell_currency: "USD",
  valid_from_at: "2026-11-04T10:00:00+0000", valid_to_at: "2026-11-04T10:15:00+0000", awx_rate: 1.12, mid_rate: 1.13, validity: "MIN_15", usage: "SINGLE_USE", currency_pair: "EURUSD", dealt_currency: "EUR", conversion_date: "2026-11-06", rate_details: [] };

/** A fake sandbox: answers login and quote, records every call; anything else fails the test. */
function fakeSandbox(o: { loginExpires?: string; quoteStatus?: number[]; body?: Record<string, unknown> } = {}) {
  const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
  const statuses = [...(o.quoteStatus ?? [])];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url), headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ method: init?.method ?? "GET", url: u, headers });
    if (u === `https://${AWX_SANDBOX_HOST}/api/v1/authentication/login`) return Response.json({ token: TOKEN, expires_at: o.loginExpires ?? "2026-11-04T10:30:00+0000" }, { status: 201 });
    if (u === `https://${AWX_SANDBOX_HOST}/api/v1/fx/quotes/create`) {
      const s = statuses.shift() ?? 200;
      return s === 200 ? Response.json(o.body ?? QUOTE) : Response.json({ code: "unauthorized", message: `bad token ${TOKEN} for key ${KEY}` }, { status: s });
    }
    throw new Error(`unexpected call ${u}`);
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}
const ask = { buyCurrency: "EUR", sellCurrency: "USD", buyAmount: "1850.00" };

describe("the key: Max's scoped sandbox key, set by Max, never by the repo", () => {
  /** Every file the repo could deploy or run from: the CLI and libraries, the Worker, scripts, CI, the package files. */
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (f === "node_modules" || f.startsWith(".") && f !== ".github") return [];
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  }
  const root = new URL("..", import.meta.url).pathname;
  const all = [...files(join(root, "src")), ...files(join(root, "worker/src")), ...files(join(root, ".github")), join(root, "package.json"), join(root, "worker/package.json"), join(root, "worker/wrangler.jsonc")]
    .filter((f) => /\.(ts|js|mjs|cjs|json|jsonc|toml|ya?ml|sh)$/.test(f) && !f.endsWith(".gen.js"));

  it("no code in the repo writes AIRWALLEX_CLIENT_ID or AIRWALLEX_API_KEY into the Worker's secrets or vars", () => {
    const writers = all.filter((f) => /wrangler|secret\s*(put|bulk)|"secret",\s*"put"/.test(readFileSync(f, "utf8")));
    expect(writers.length).toBeGreaterThan(0);
    for (const f of writers) {
      const text = readFileSync(f, "utf8");
      // A line that puts a secret, or a [vars] entry: none of them names the Airwallex key.
      const puts = text.split("\n").filter((l) => /secret\s*(put|bulk)|"secret",\s*"put"|^\s*AIRWALLEX_(CLIENT_ID|API_KEY)\s*=/.test(l));
      expect({ f: f.slice(root.length), bad: puts.filter((l) => /AIRWALLEX_(CLIENT_ID|API_KEY)/.test(l)) }).toEqual({ f: f.slice(root.length), bad: [] });
    }
    expect(readFileSync(join(root, "worker/wrangler.jsonc"), "utf8")).not.toMatch(/AIRWALLEX_(CLIENT_ID|API_KEY)/);
    // The deploy script puts exactly one secret: the relay's token.
    expect(readFileSync(join(root, "src/cli/relay-deploy.ts"), "utf8").match(/\["secret", "put", "([A-Z_]+)"\]/g)).toEqual(['["secret", "put", "RELAY_TOKEN"]']);
  });

  // The same guard for two more names: the Anthropic key is a Worker secret Max sets himself, and Metal's keyed RPC URL
  // is never one (the Worker reads no Metal RPC); no script, config or workflow here puts either.
  it("no code in the repo writes METAL_RPC_URL or ANTHROPIC_API_KEY into the Worker's secrets or vars", () => {
    const names = /METAL_RPC_URL|ANTHROPIC_API_KEY/;
    for (const f of all) {
      // Code, not comments: a comment may say how Max sets it himself.
      const puts = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).filter((l) => /secret\s*(put|bulk)|"secret",\s*"put"|^\s*"?(METAL_RPC_URL|ANTHROPIC_API_KEY)"?\s*[=:]/.test(l));
      expect({ f: f.slice(root.length), bad: puts.filter((l) => names.test(l)) }).toEqual({ f: f.slice(root.length), bad: [] });
    }
    expect(readFileSync(join(root, "worker/wrangler.jsonc"), "utf8")).not.toMatch(names);
  });

  // The live agents' emergency switch (TRY_SIGN_AGENTS=off, or its old name TRY_SIGN_HAIKU=off) is Max's, set by hand
  // when needed: nothing here sets it.
  it.each(["TRY_SIGN_AGENTS", "TRY_SIGN_HAIKU"])("no script, config or workflow sets %s; the Worker only reads it", (name) => {
    const re = new RegExp(`(^|[\\s{,"'])${name}"?\\s*[=:](?!=)|--var[\\s=]+"?${name}|secret\\s*(put|bulk)[^\\n]*${name}|"${name}"\\s*\\]`);
    for (const f of all) {
      const sets = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).filter((l) => re.test(l));
      expect({ f: f.slice(root.length), sets }).toEqual({ f: f.slice(root.length), sets: [] });
    }
    expect(readFileSync(join(root, "worker/wrangler.jsonc"), "utf8")).not.toMatch(new RegExp(name));
    expect(readFileSync(join(root, "src/cli/relay-deploy.ts"), "utf8")).not.toMatch(new RegExp(name));
  });

  it("the Worker reads the key from its secrets only, and only into the quote client", () => {
    const index = readFileSync(join(root, "worker/src/index.ts"), "utf8");
    expect(index.match(/AIRWALLEX_(CLIENT_ID|API_KEY)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(index).toMatch(/new SandboxQuotes\(\{ clientId: id, apiKey: key \}\)/);
    const others = files(join(root, "worker/src")).filter((f) => !/index\.ts$|fxQuote\.ts$/.test(f) && /AIRWALLEX_(CLIENT_ID|API_KEY)|apiKey/.test(readFileSync(f, "utf8")));
    expect(others.map((f) => f.slice(root.length))).toEqual([]);
  });
});

describe("the Airwallex client: two calls, one host, nothing else", () => {
  it("the table is login and quote creation on the sandbox host, and nothing else gets past it", () => {
    // Exactly the host the repo's adapter uses (src/airwallex/client.ts).
    expect(AWX_SANDBOX_HOST).toBe(new URL(SANDBOX_BASE).host);
    expect(AWX_SANDBOX_HOST).toBe("api.sandbox.airwallex.com");
    expect(AWX_ALLOWED).toEqual([{ method: "POST", path: "/api/v1/authentication/login" }, { method: "POST", path: "/api/v1/fx/quotes/create" }]);
    expect(allowedUrl("POST", "https://api.sandbox.airwallex.com/api/v1/fx/quotes/create").pathname).toBe("/api/v1/fx/quotes/create");
    for (const [m, u] of [
      ["POST", "https://api.sandbox.airwallex.com/api/v1/fx/conversions/create"], ["POST", "https://api.sandbox.airwallex.com/api/v1/transfers/create"],
      ["POST", "https://api.sandbox.airwallex.com/api/v1/issuing/cards/create"], ["GET", "https://api.sandbox.airwallex.com/api/v1/fx/quotes/create"],
      ["POST", "https://api.airwallex.com/api/v1/fx/quotes/create"], ["POST", "https://api-demo.airwallex.com/api/v1/fx/quotes/create"],
      ["POST", "http://api.sandbox.airwallex.com/api/v1/fx/quotes/create"], ["POST", "https://api.sandbox.airwallex.com/api/v1/fx/quotes/create?x=1"],
      ["POST", "https://user:pw@api.sandbox.airwallex.com/api/v1/fx/quotes/create"], ["POST", "https://api.sandbox.airwallex.com.evil.example/api/v1/fx/quotes/create"],
      ["POST", "https://api.sandbox.airwallex.com/api/v1/fx/quotes/create/../../transfers/create"], ["POST", "not a url"],
    ] as const) expect({ m, u, throws: (() => { try { allowedUrl(m, u); return false; } catch (e) { return e instanceof AirwallexCallNotAllowed; } })() }).toEqual({ m, u, throws: true });
  });

  it("the module names no other Airwallex path or host (read from its source)", () => {
    const src = readFileSync(new URL("../worker/src/fxQuote.ts", import.meta.url), "utf8");
    expect([...new Set(src.match(/\/api\/v1\/[a-z/_-]+/g))].sort()).toEqual(["/api/v1/authentication/login", "/api/v1/fx/quotes/create"]);
    expect([...new Set(src.match(/[a-z0-9.-]*airwallex\.com/g))]).toEqual(["api.sandbox.airwallex.com"]);
    expect(src).not.toMatch(/\/(conversions|transfers|payouts|beneficiaries|issuing|simulation)\b/i);
  });

  it("logs in once, keeps the token in memory until shortly before it expires, and sends only the table's calls", async () => {
    let now = t0.getTime();
    const s = fakeSandbox();
    const c = new SandboxQuotes({ clientId: ID, apiKey: KEY, fetchImpl: s.fetchImpl, now: () => now });
    await c.quote(ask); await c.quote(ask);
    expect(s.calls.map((x) => x.url.replace(`https://${AWX_SANDBOX_HOST}`, ""))).toEqual(["/api/v1/authentication/login", "/api/v1/fx/quotes/create", "/api/v1/fx/quotes/create"]);
    expect(s.calls[0]!.headers).toMatchObject({ "x-client-id": ID, "x-api-key": KEY });
    expect(s.calls[1]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(s.calls.every((x) => x.method === "POST")).toBe(true);
    // 29 minutes on (the token said 10:30; it is renewed a minute early): a new login.
    now += 29.5 * 60_000;
    await c.quote(ask);
    expect(s.calls.filter((x) => x.url.endsWith("/login"))).toHaveLength(2);
  });

  it("a token the sandbox no longer takes: one new login and one retry, then a fixed reason", async () => {
    const s = fakeSandbox({ quoteStatus: [401, 200] });
    const c = new SandboxQuotes({ clientId: ID, apiKey: KEY, fetchImpl: s.fetchImpl, now: () => t0.getTime() });
    expect((await c.quote(ask)).quote_id).toBe(QUOTE.quote_id);
    expect(s.calls.filter((x) => x.url.endsWith("/login"))).toHaveLength(2);
    const bad = fakeSandbox({ quoteStatus: [500] });
    await expect(new SandboxQuotes({ clientId: ID, apiKey: KEY, fetchImpl: bad.fetchImpl, now: () => t0.getTime() }).quote(ask)).rejects.toThrow(/gave no quote \(HTTP 500\)/);
  });

  it("never says the key or the token: not in an error, not when the sandbox echoes them back", async () => {
    for (const s of [fakeSandbox({ quoteStatus: [403] }), fakeSandbox({ quoteStatus: [401, 401] })]) {
      const err = await new SandboxQuotes({ clientId: ID, apiKey: KEY, fetchImpl: s.fetchImpl, now: () => t0.getTime() }).quote(ask).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(QuoteUnavailable);
      const said = JSON.stringify({ m: (err as Error).message, s: (err as Error).stack, r: (err as QuoteUnavailable).reason });
      for (const secret of [KEY, ID, TOKEN]) expect(said).not.toContain(secret);
    }
  });

  it("reads the sandbox's answer into the terms' form: strings, two decimals, UTC; refuses anything else", () => {
    expect(toQuote(QUOTE, ask)).toEqual({ quote_id: QUOTE.quote_id, sell_currency: "USD", buy_currency: "EUR", buy_amount: "1850.00", sell_amount: "2089.90", client_rate: "1.129677", valid_to_at: "2026-11-04T10:15:00Z", source: "airwallex-sandbox" });
    for (const bad of [{ quote_id: "" }, { buy_amount: 1851 }, { buy_currency: "GBP" }, { valid_to_at: "soon" }, { client_rate: "x" }, { sell_amount: -1 }]) {
      expect(() => toQuote({ ...QUOTE, ...bad }, ask)).toThrow(QuoteUnavailable);
    }
  });
});

/** A desk with a quote source, and a visitor with a passkey in a world of their own. */
async function visitor(fx: StandInQuotes | null, ip = "203.0.113.50") {
  const d = desk(undefined, fx);
  const auth = new FakeAuthenticator();
  const res = await call(d.d, "world", {}, { ip });
  expect(res.status).toBe(201);
  const opened = (await res.json()) as { world: { id: string; token: string; expires_at: string }; proposals: Proposal[]; passkey_options: { challenge: string } };
  // The agents' steps; the quote is step 3's (spec 6b).
  const steps = await walkAgents(d.d, opened.world.token, ip);
  const w = { ...opened, proposals: (steps.ready as unknown as { proposals: Proposal[] }).proposals, fx: (steps.quote!.result as { fx: { status: string; quote?: FxQuote; reason?: string } }).fx };
  expect((await call(d.d, "passkey", { token: w.world.token, credential: auth.register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP }) }, { ip })).status).toBe(201);
  return { ...d, w, auth, ip, b: w.proposals.find((p) => p.check === "pass")! };
}
const termsOf = (p: Proposal) => JSON.parse(p.canonical) as { schema: string; fx: (FxQuote & Record<string, string>) | null };

describe("the quote in the terms (v3): the signature binds to it", () => {
  it("the waiting payment's terms carry the live quote; the blocked one's none", async () => {
    const fx = new StandInQuotes(() => t0.getTime());
    const v = await visitor(fx);
    expect(TRY_TERMS_SCHEMA).toBe("kit11.try-terms/v4");
    // The quote buys exactly the shortfall code planned: EUR 1,870.00 needed, EUR 1,000.00 free, EUR 870.00 short.
    expect(v.w.fx).toMatchObject({ status: "live", quote: { buy_currency: "EUR", sell_currency: "USD", buy_amount: "870.00", sell_amount: "982.82", client_rate: "1.129677" } });
    expect(termsOf(v.b).fx).toEqual(v.w.fx.quote);
    expect(termsOf(v.w.proposals.find((p) => p.check === "fail")!).fx).toBeNull();
    // The terms' fields, now with fx: the hash covers every one of them.
    expect(Object.keys(proposalTerms(FIXED_PROPOSALS[1]!, "0123456789abcdef", "2026-11-04T11:00:00Z", v.w.fx.quote!)).sort()).toContain("fx");
  });

  it.each(["quote_id", "client_rate", "buy_amount", "sell_amount", "sell_currency", "buy_currency", "valid_to_at", "source"])("changing the quote's %s changes the hash, and the same signature is refused", async (field) => {
    const v = await visitor(new StandInQuotes(() => t0.getTime()));
    const sig = v.auth.sign({ challenge: challengeOf(v.b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
    const t = termsOf(v.b);
    const changed = canonical({ ...t, fx: { ...t.fx!, [field]: field === "valid_to_at" ? "2026-11-04T11:00:00Z" : `${t.fx![field]}1` } } as never);
    const r = await call(v.d, "sign", signBody(v.w.world.token, v.b, sig, changed), { ip: v.ip });
    expect([r.status, ((await r.json()) as { why: string }).why]).toEqual([200, "challenge"]);
    expect((await call(v.d, "sign", signBody(v.w.world.token, v.b, sig), { ip: v.ip })).status).toBe(200);
  });

  it("an expired quote is refused even with a good signature; a new quote means new terms, signed again", async () => {
    const fx = new StandInQuotes(() => t0.getTime());
    const v = await visitor(fx);
    const sig = v.auth.sign({ challenge: challengeOf(v.b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
    v.at(new Date(t0.getTime() + 15 * 60_000)); // the quote's valid_to_at: no longer valid
    const late = await call(v.d, "sign", signBody(v.w.world.token, v.b, sig), { ip: v.ip });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ why: "quote_expired", verified: true, error: "Quote expired. Get a fresh one and sign again.", expired_at: "2026-11-04T10:15:00Z" });
    expect(v.db.prepare("SELECT status FROM ts_proposals WHERE world = ? AND id = ?").get(v.w.world.id, v.b.proposal_id)).toEqual({ status: "waiting" });
    // Get a new quote: new terms, a new hash; the old signature does not fit them, a new one runs.
    fx.now = () => t0.getTime() + 15 * 60_000;
    const q = await call(v.d, "quote", { token: v.w.world.token }, { ip: v.ip });
    expect(q.status).toBe(200);
    const nq = (await q.json()) as { proposal: Proposal; fx: { status: string; quote: FxQuote } };
    expect(nq.fx.status).toBe("live");
    expect(nq.proposal.terms_sha256).not.toBe(v.b.terms_sha256);
    expect(termsOf(nq.proposal).fx!.quote_id).not.toBe(termsOf(v.b).fx!.quote_id);
    expect(((await (await call(v.d, "sign", signBody(v.w.world.token, nq.proposal, sig), { ip: v.ip })).json()) as { why: string }).why).toBe("challenge");
    const sig2 = v.auth.sign({ challenge: challengeOf(nq.proposal.terms_sha256), origin: BASE, rpId: RP, counter: 2 });
    const ok = await call(v.d, "sign", signBody(v.w.world.token, nq.proposal, sig2), { ip: v.ip });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { executed: { fx_quote_id: string } }).executed.fx_quote_id).toBe(termsOf(nq.proposal).fx!.quote_id);
    // Once it ran, it is not quoted again: a new quote goes to the next invoice (T-0003), which waits with its own.
    const next = await call(v.d, "quote", { token: v.w.world.token }, { ip: v.ip });
    expect(next.status).toBe(200);
    expect(((await next.json()) as { proposal: Proposal }).proposal.proposal_id).toBe("T-0003");
  });

  it("/quote takes the world's token and nothing else", () => {
    expect(wellFormed("/quote", { token: "x".repeat(43) })).toBe(true);
    expect(wellFormed("/quote", { token: "x".repeat(43), amount: "1.00" })).toBe(false);
  });
});

describe("limits and fallbacks: never a made-up quote", () => {
  it("no sandbox key: no quote in the terms, and the page is told why", async () => {
    const v = await visitor(null);
    expect(v.w.fx).toEqual({ status: "unavailable", reason: "this server has no Airwallex sandbox key" });
    expect(termsOf(v.b).fx).toBeNull();
    expect((await call(v.d, "quote", { token: v.w.world.token }, { ip: v.ip })).status).toBe(503);
  });

  it(`per address: ${TRY_SIGN_FX_PER_HOUR} quotes an hour; past it, the last live quote while it has time, else none`, async () => {
    const fx = new StandInQuotes(() => t0.getTime());
    const v = await visitor(fx, "203.0.113.77");
    for (let i = 1; i < TRY_SIGN_FX_PER_HOUR; i++) expect((await call(v.d, "quote", { token: v.w.world.token }, { ip: v.ip })).status).toBe(200);
    expect(fx.calls).toBe(TRY_SIGN_FX_PER_HOUR);
    const shared = (await (await call(v.d, "quote", { token: v.w.world.token }, { ip: v.ip })).json()) as { fx: { status: string; quote: FxQuote } };
    expect(fx.calls).toBe(TRY_SIGN_FX_PER_HOUR);
    expect(shared.fx.status).toBe("reused");
    // 14 minutes on, the last quote has under two minutes left: none, and no call.
    v.at(new Date(t0.getTime() + 14 * 60_000));
    const none = await call(v.d, "quote", { token: v.w.world.token }, { ip: v.ip });
    expect(none.status).toBe(503);
    expect(((await none.json()) as { fx: { status: string } }).fx.status).toBe("unavailable");
    expect(fx.calls).toBe(TRY_SIGN_FX_PER_HOUR);
  });

  it(`for everyone: ${TRY_SIGN_FX_ALL_PER_MINUTE} quotes a minute, then no more calls to the sandbox`, async () => {
    const fx = new StandInQuotes(() => t0.getTime());
    const d = desk(undefined, fx);
    for (let i = 0; i < TRY_SIGN_FX_ALL_PER_MINUTE + 3; i++) {
      const ip = `198.18.${i}.1`;
      const w = (await (await call(d.d, "world", {}, { ip })).json()) as { world: { token: string } };
      const steps = await walkAgents(d.d, w.world.token, ip);
      expect((steps.quote!.result as { fx: { status: string } }).fx.status).toBe(i < TRY_SIGN_FX_ALL_PER_MINUTE ? "live" : "reused");
    }
    expect(fx.calls).toBe(TRY_SIGN_FX_ALL_PER_MINUTE);
  });

  it("a sandbox that fails: the last live quote while it has time, else none; the reason is fixed text", async () => {
    const fx = new StandInQuotes(() => t0.getTime());
    fx.failing = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const v = await visitor(fx);
    expect(v.w.fx).toEqual({ status: "unavailable", reason: "the Airwallex sandbox gave no quote" });
    expect(termsOf(v.b).fx).toBeNull();
    expect(err).toHaveBeenCalledWith("try-sign: no live FX quote:", "the Airwallex sandbox gave no quote");
    err.mockRestore();
  });

  it("the recorded fallback is the main run's quote, from its record", () => {
    expect(recordedQuote()).toEqual({ quote_id: "f6a63046-6e8c-3eee-9098-e3c605832015", buy_currency: "EUR", buy_amount: "110.00", sell_currency: "USD", sell_amount: "124.29", client_rate: "1.129917", valid_to: "2026-11-03T11:45:31.000Z", run: "main run, 3 Nov" });
  });
});

describe("the receipt carries the quote", () => {
  it("verifies, reports the quote id and expiry, and fails when the quote id changes", async () => {
    const v = await visitor(new StandInQuotes(() => t0.getTime()));
    const a = v.auth.sign({ challenge: challengeOf(v.b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
    const ans = (await (await call(v.d, "sign", signBody(v.w.world.token, v.b, a), { ip: v.ip })).json()) as { terms_sha256: string; public_key: TryReceipt["public_key"]; executed: { at: string } };
    const receipt: TryReceipt = { receipt: RECEIPT_FORMAT, note: "", terms: JSON.parse(v.b.canonical) as Record<string, unknown>, terms_sha256: ans.terms_sha256, algorithm: "ES256", public_key: ans.public_key,
      credential_id: a.id, rp_id: RP, origin: BASE, assertion: { authenticatorData: a.response.authenticatorData, clientDataJSON: a.response.clientDataJSON, signature: a.response.signature } };
    const r = verifyReceipt(receipt);
    expect(r.ok).toBe(true);
    const q = termsOf(v.b).fx!;
    expect(r.checks.find((c) => c.check === "fx quote")!.detail).toBe(`quote ${q.quote_id}, EUR 870.00 for USD ${q.sell_amount} at 1.129677, valid to ${q.valid_to_at}: in the signed terms (that Airwallex issued it is not checked offline)`);
    const t = receipt.terms as { fx: Record<string, string> };
    const bad = verifyReceipt({ ...receipt, terms: { ...t, fx: { ...t.fx, quote_id: "another-quote-0000" } } });
    expect(bad.checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(["terms hash"]);
  });
});
