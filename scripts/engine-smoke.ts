// npm run cloud:smoke -- <base URL>: the company engine's chain once against a running cloud (purser-try, on test
// money), step by step with each step's wall time, exiting non-zero on the first answer that is not as it should be.
//
// It makes a company as the platform does (POST /v1/admin/tenants, with the platform admin token from the environment
// variable PURSER_ADMIN_TOKEN: read here, never printed), enrols the owner's sign-in passkey and signs in (a software
// passkey, as the cloud's tests do), then runs the engine: the English test invoice uploaded, its payment filed, the
// approval passkey set up (a software passkey on the deployment's own relying party), a signature over other terms
// (refused), the right one (paid on the stand-in bank), and the invoice, the ledger and the archive read back.
//
// Test money only: the engine pays on its stand-in bank. The company it makes is a test company named as such.
//
// Flags (after the base URL):
//   --plain              the cloud alone: health, a company, a sign-in, its invoices (the engine is not asked)
//   --parallel N         N companies at once, each running the chain
//   --poll <ms>          with --parallel: each company polls GET /v1/engine/events?after= every <ms> (default 1000)
//                        while its upload and its payment are in flight, as the page does
// A parallel run reports p50 and p95 per step and per poll, every answer that was not 2xx word for word, and the 429s
// and 5xx by route; it exits non-zero when a company fails or any answer was not 2xx.
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { pdfOf } from "../src/e2e/documents.js";
import { REFUSED_OTHER_TERMS } from "../src/engine/host.js";
import { sha256Hex } from "../src/lib/terms.js";
import { softPasskey } from "../src/metal/softPasskey.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "../test/fakes/apInvoices.js";

export const CHANGED_TERMS = REFUSED_OTHER_TERMS;
/** The variable that holds the platform admin token (the token whose SHA-256 is the Worker's ADMIN_TOKEN_SHA256). */
export const TOKEN_VAR = "PURSER_ADMIN_TOKEN";

export const SMOKE_STEPS = [
  "make a company", "enrol the owner's sign-in passkey", "sign in", "upload the invoice", "file the payment",
  "set up the approval passkey", "approve other terms (refused)", "approve", "read the invoice back", "read the ledger back", "read the archive back",
] as const;
/** --plain: the cloud alone, before anything of the engine (the first deploy of the cloud Worker with the engine). */
export const PLAIN_STEPS = ["check health", "make a company", "enrol the owner's sign-in passkey", "sign in", "list the invoices"] as const;
type Step = (typeof SMOKE_STEPS)[number] | (typeof PLAIN_STEPS)[number];
/** The steps a parallel run polls the engine's events during: the ones that may take the engine a while. */
const POLLED: readonly Step[] = ["upload the invoice", "approve"];

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export interface SmokeResult { steps: { step: Step; ms: number }[]; failed: { step: Step; reason: string } | null }

class Mismatch extends Error {}
const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");

export async function runSmoke(o: {
  base: string; adminToken: string; fetch: Fetch; log: (line: string) => void;
  /** The cloud alone (PLAIN_STEPS) instead of the engine's chain (SMOKE_STEPS). */
  plain?: boolean;
  /** Called around each step with the owner's session once there is one (a parallel run polls the events there). */
  around?: (step: Step, session: string) => () => Promise<void>;
}): Promise<SmokeResult> {
  const url = new URL(o.base);
  const rp = { rpId: url.hostname, origin: url.origin };
  const req = async (method: string, path: string, x: { key?: string; body?: unknown } = {}): Promise<{ status: number; json: Record<string, unknown> }> => {
    const headers: Record<string, string> = {};
    if (x.key) headers.authorization = `Bearer ${x.key}`;
    if (x.body !== undefined) headers["content-type"] = "application/json";
    // A browser's same-origin POST carries its origin; the cloud refuses one from another site.
    if (method !== "GET") headers.origin = rp.origin;
    const res = await o.fetch(`${rp.origin}${path}`, { method, headers, ...(x.body !== undefined ? { body: JSON.stringify(x.body) } : {}) });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
    return { status: res.status, json };
  };
  const expectThat = (ok: boolean, what: string, got: unknown) => { if (!ok) throw new Mismatch(`${what}; got ${JSON.stringify(got).slice(0, 400)}`); };

  const steps: SmokeResult["steps"] = [];
  const started = Date.now();
  const s: { slug: string; tenant: string; owner: string; starter: string; session: string; invoice: string; proposal: { id: string; terms_sha256: string; challenge: string } } =
    { slug: `smoke-${randomBytes(5).toString("hex")}`, tenant: "", owner: "", starter: "", session: "", invoice: "", proposal: { id: "", terms_sha256: "", challenge: "" } };
  const signIn = softPasskey();
  const signInId = b64u(randomBytes(16));
  const phone = new FakeAuthenticator();
  const bytes = await pdfOf(EN);

  const run: Record<Step, () => Promise<void>> = {
    "check health": async () => {
      const r = await req("GET", "/v1/health");
      expectThat(r.status === 200 && r.json.ok === true, "the cloud answers healthy (200, its database and document store up)", { status: r.status, body: r.json });
    },
    "list the invoices": async () => {
      const r = await req("GET", "/v1/invoices", { key: s.session });
      expectThat(r.status === 200 && Array.isArray(r.json.items), "the company's invoices are listed (200)", { status: r.status, error: r.json.error });
    },
    "make a company": async () => {
      const r = await req("POST", "/v1/admin/tenants", { key: o.adminToken, body: { slug: s.slug, name: `Smoke test company ${s.slug}`, owner: { display_name: "Smoke Owner" } } });
      expectThat(r.status === 201, "the platform makes the company (201)", { status: r.status, error: r.json.error });
      s.tenant = (r.json.tenant as { id: string }).id;
      s.owner = (r.json.owner as { id: string }).id;
      s.starter = r.json.api_key as string;
    },
    "enrol the owner's sign-in passkey": async () => {
      const e = await req("POST", `/v1/users/${s.owner}/enrolment`, { key: s.starter });
      expectThat(e.status === 201 || e.status === 200, "the enrolment starts", { status: e.status, error: e.json.error });
      const a = signIn.assert("0x00", { challenge: e.json.token as string, origin: rp.origin, rpId: rp.rpId });
      const r = await req("POST", "/v1/auth/enrol", { body: {
        tenant: s.slug, enrolment_id: e.json.enrolment_id, token: e.json.token, credential_id: signInId,
        x: Buffer.from(signIn.key.qx.slice(2), "hex").toString("base64url"), y: Buffer.from(signIn.key.qy.slice(2), "hex").toString("base64url"),
        assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) },
      } });
      expectThat(r.status === 201, "the owner's passkey is enrolled (201)", { status: r.status, error: r.json.error });
    },
    "sign in": async () => {
      const ch = await req("POST", "/v1/auth/challenge", { body: { tenant: s.slug } });
      const a = signIn.assert("0x00", { challenge: ch.json.challenge as string, origin: rp.origin, rpId: rp.rpId });
      const r = await req("POST", "/v1/auth/login", { body: { tenant: s.slug, challenge_id: ch.json.challenge_id, credential_id: signInId,
        assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } });
      expectThat(r.status === 200 && typeof r.json.session === "string", "the owner signs in (200, a session)", { status: r.status, error: r.json.error });
      s.session = r.json.session as string;
      // The test invoice is in English; the engine speaks the company's language.
      const lang = await req("POST", "/v1/company", { key: s.session, body: { language: "en" } });
      expectThat(lang.status === 200, "the company's language is set to English", { status: lang.status, error: lang.json.error });
    },
    "upload the invoice": async () => {
      const r = await req("POST", "/v1/engine/documents", { key: s.session, body: { filename: "bergtex-BTX-2026-21.pdf", mime: "application/pdf", base64: bytes.toString("base64") } });
      const inv = r.json.invoice as { id: string; status: string; total: string } | null;
      expectThat(r.status === 200 && r.json.kind === "invoice" && inv?.status === "ready" && inv.total === "1850.00", "the invoice is read and ready to pay (EUR 1850.00)", { status: r.status, kind: r.json.kind, invoice: inv, error: r.json.error });
      s.invoice = inv!.id;
    },
    "file the payment": async () => {
      const r = await req("POST", `/v1/engine/invoices/${s.invoice}/pay`, { key: s.session });
      const p = r.json.proposal as { id: string; status: string; terms_sha256: string; challenge: string } | undefined;
      expectThat(r.status === 200 && p?.status === "PENDING_APPROVAL" && p.challenge === challengeFor(p.terms_sha256), "the payment is filed for approval", { status: r.status, proposal: p, error: r.json.error });
      s.proposal = p!;
    },
    "set up the approval passkey": async () => {
      const start = await req("POST", "/v1/engine/passkey/start", { key: s.session });
      expectThat(start.status === 200 && (start.json.rp as { id?: string } | undefined)?.id === rp.rpId, `the passkey starts on this deployment's relying party (${rp.rpId})`, { status: start.status, rp: start.json.rp, error: start.json.error });
      const done = await req("POST", "/v1/engine/passkey/finish", { key: s.session, body: { code: start.json.code, credential: phone.register({ challenge: start.json.challenge as string, origin: rp.origin, rpId: rp.rpId }) } });
      expectThat(done.status === 200 && done.json.credential_id === phone.credentialId, "the approval passkey is set up", { status: done.status, error: done.json.error });
    },
    "approve other terms (refused)": async () => {
      const r = await req("POST", `/v1/engine/proposals/${s.proposal.id}/approve`, { key: s.session, body: { terms_sha256: s.proposal.terms_sha256, credential: phone.sign({ challenge: challengeFor(sha256Hex("other terms")), origin: rp.origin, rpId: rp.rpId, counter: 1 }) } });
      expectThat(r.status === 200 && r.json.status === "refused" && r.json.message === CHANGED_TERMS && r.json.settled === null, "a signature over other terms is refused in plain words, and nothing runs", r.json);
    },
    "approve": async () => {
      const r = await req("POST", `/v1/engine/proposals/${s.proposal.id}/approve`, { key: s.session, body: { terms_sha256: s.proposal.terms_sha256, credential: phone.sign({ challenge: s.proposal.challenge, origin: rp.origin, rpId: rp.rpId, counter: 2 }) } });
      const st = r.json.settled as { invoice_status: string; transfer_status: string; ledger_entries: number; error: string | null } | null;
      expectThat(r.status === 200 && r.json.status === "approved" && st?.invoice_status === "paid" && st.transfer_status === "PAID" && st.ledger_entries === 7 && st.error === null,
        "the right signature pays on the stand-in bank: paid, PAID, 7 entries, no error", r.json);
    },
    "read the invoice back": async () => {
      const r = await req("GET", "/v1/invoices", { key: s.session });
      const inv = (r.json.items as { id: string; status: string }[] | undefined)?.find((i) => i.id === s.invoice);
      expectThat(r.status === 200 && inv?.status === "paid", `the read model shows ${s.invoice} paid`, { status: r.status, invoice: inv });
    },
    "read the ledger back": async () => {
      const r = await req("GET", "/v1/ledger/entries", { key: s.session });
      const n = (r.json.items as unknown[] | undefined)?.length;
      expectThat(r.status === 200 && n === 7, "the read model holds the ledger's 7 entries", { status: r.status, entries: n });
    },
    "read the archive back": async () => {
      const r = await req("GET", "/v1/engine/vault", { key: s.session });
      const kinds = ((r.json.files as { kind: string }[] | undefined) ?? []).map((f) => f.kind).sort();
      expectThat(r.status === 200 && JSON.stringify(kinds) === JSON.stringify(["invoice", "receipt", "suppliers"]), "the archive lists the invoice, the receipt and the suppliers list", { status: r.status, kinds });
    },
  };

  for (const step of o.plain ? PLAIN_STEPS : SMOKE_STEPS) {
    const t0 = Date.now();
    const stop = o.around?.(step, s.session);
    try {
      await run[step]();
      await stop?.();
    } catch (e) {
      await stop?.();
      const reason = e instanceof Error ? e.message : String(e);
      steps.push({ step, ms: Date.now() - t0 });
      o.log(`${String(Date.now() - t0).padStart(7)} ms  ${step}  FAILED`);
      o.log(`smoke: FAILED at "${step}": ${reason}`);
      return { steps, failed: { step, reason } };
    }
    const ms = Date.now() - t0;
    steps.push({ step, ms });
    o.log(`${String(ms).padStart(7)} ms  ${step}`);
  }
  o.log(`smoke: all ${steps.length} steps passed in ${Date.now() - started} ms`);
  return { steps, failed: null };
}

/** Nearest-rank percentile of a list of milliseconds (0 for none). */
function pct(ms: number[], p: number): number {
  if (!ms.length) return 0;
  const sorted = [...ms].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
const stats = (ms: number[]) => ({ n: ms.length, p50: pct(ms, 50), p95: pct(ms, 95) });
/** A path as a route: ids and numbers made generic, the query dropped. */
const routeOf = (method: string, input: string): string =>
  `${method} ${new URL(input).pathname.replace(/\/(AP|P)-\d+/g, "/{id}").replace(/\/(usr|t)_[A-Za-z0-9_]+/g, "/{id}")}`;

export interface ParallelResult {
  ok: boolean;
  runs: SmokeResult[];
  steps: Record<string, { n: number; p50: number; p95: number }>;
  polls: { n: number; p50: number; p95: number };
  /** Every answer that was not 2xx, word for word (the body, cut at 400 characters). */
  errors: { route: string; status: number; body: string }[];
  /** Answers that were not 2xx, counted by route and status. */
  byRoute: Record<string, Record<number, number>>;
}

/** N companies at once, each running the chain while it polls the engine's events during its upload and its payment. */
export async function runParallel(o: { base: string; adminToken: string; fetch: Fetch; log: (line: string) => void; n: number; pollMs: number }): Promise<ParallelResult> {
  const errors: ParallelResult["errors"] = [];
  const byRoute: ParallelResult["byRoute"] = {};
  const pollMs: number[] = [];
  const watched: Fetch = async (input, init) => {
    const res = await o.fetch(input, init);
    if (res.status < 200 || res.status > 299) {
      const route = routeOf(init?.method ?? "GET", input);
      errors.push({ route, status: res.status, body: (await res.clone().text()).slice(0, 400) });
      (byRoute[route] ??= {})[res.status] = (byRoute[route]![res.status] ?? 0) + 1;
    }
    return res;
  };
  const poller = (session: string) => {
    let after = 0, on = true;
    const loop = (async () => {
      while (on) {
        const t0 = Date.now();
        const res = await watched(`${new URL(o.base).origin}/v1/engine/events?after=${after}`, { method: "GET", headers: { authorization: `Bearer ${session}` } });
        pollMs.push(Date.now() - t0);
        if (res.ok) { const j = (await res.json()) as { next?: number }; if (typeof j.next === "number") after = j.next; }
        if (on) await new Promise((r) => setTimeout(r, o.pollMs));
      }
    })();
    return async () => { on = false; await loop; };
  };
  const runs = await Promise.all(Array.from({ length: o.n }, () => runSmoke({
    base: o.base, adminToken: o.adminToken, fetch: watched, log: () => undefined,
    around: (step, session) => (POLLED.includes(step) && session ? poller(session) : async () => undefined),
  })));
  const steps: ParallelResult["steps"] = {};
  for (const step of SMOKE_STEPS) {
    const ms = runs.flatMap((r) => r.steps.filter((x) => x.step === step).map((x) => x.ms));
    if (ms.length) steps[step] = stats(ms);
  }
  const polls = stats(pollMs);
  for (const [step, st] of Object.entries(steps)) o.log(`${String(st.p50).padStart(7)} ms p50 ${String(st.p95).padStart(7)} ms p95  ${step} (${st.n})`);
  o.log(`polls: ${polls.n}, p50 ${polls.p50} ms, p95 ${polls.p95} ms`);
  for (const e of errors) o.log(`${e.status} ${e.route}: ${e.body}`);
  for (const [route, counts] of Object.entries(byRoute)) for (const [status, n] of Object.entries(counts)) if (Number(status) === 429 || Number(status) >= 500) o.log(`${n} x ${status} on ${route}`);
  for (const [i, r] of runs.entries()) if (r.failed) o.log(`company ${i + 1}: FAILED at "${r.failed.step}": ${r.failed.reason}`);
  const passed = runs.filter((r) => !r.failed).length;
  o.log(`smoke: ${passed} of ${o.n} companies passed${errors.length ? `; ${errors.length} answers were not 2xx` : ""}`);
  return { ok: passed === o.n && errors.length === 0, runs, steps, polls, errors, byRoute };
}

/** The command line: 0 when every step passed, 1 on a mismatch, 2 when the base URL or the token is missing. */
export async function main(argv: string[], env: Record<string, string | undefined>, io: { fetch: Fetch; log: (line: string) => void }): Promise<number> {
  const base = argv[0];
  let ok: boolean;
  try { ok = !!base && /^https?:$/.test(new URL(base).protocol); } catch { ok = false; }
  if (!ok) { io.log("usage: npm run cloud:smoke -- <base URL, e.g. https://purser-try.<account>.workers.dev>"); return 2; }
  const token = env[TOKEN_VAR];
  if (!token) { io.log(`set ${TOKEN_VAR} to the platform admin token (it is read, never printed)`); return 2; }
  const flags = argv.slice(1);
  const value = (name: string): number | null => { const i = flags.indexOf(name); const v = i >= 0 ? Number(flags[i + 1]) : NaN; return Number.isInteger(v) && v > 0 ? v : null; };
  const parallel = flags.includes("--parallel") ? value("--parallel") : 1;
  const poll = flags.includes("--poll") ? value("--poll") : 1000;
  if (parallel === null || poll === null || (flags.includes("--plain") && parallel > 1)) {
    io.log("usage: npm run cloud:smoke -- <base URL> [--plain] [--parallel N [--poll <ms>]]");
    return 2;
  }
  io.log(`smoke: ${new URL(base!).origin}, on test money (the stand-in bank)`);
  if (parallel > 1) return (await runParallel({ base: base!, adminToken: token, fetch: io.fetch, log: io.log, n: parallel, pollMs: poll })).ok ? 0 : 1;
  const out = await runSmoke({ base: base!, adminToken: token, fetch: io.fetch, log: io.log, plain: flags.includes("--plain") });
  return out.failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2), process.env, { fetch: (input, init) => fetch(input, init), log: (line) => console.log(line) });
}
