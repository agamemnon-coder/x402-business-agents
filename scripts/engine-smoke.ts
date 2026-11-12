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
type Step = (typeof SMOKE_STEPS)[number];

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export interface SmokeResult { steps: { step: Step; ms: number }[]; failed: { step: Step; reason: string } | null }

class Mismatch extends Error {}
const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");

export async function runSmoke(o: { base: string; adminToken: string; fetch: Fetch; log: (line: string) => void }): Promise<SmokeResult> {
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

  for (const step of SMOKE_STEPS) {
    const t0 = Date.now();
    try {
      await run[step]();
    } catch (e) {
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

/** The command line: 0 when every step passed, 1 on a mismatch, 2 when the base URL or the token is missing. */
export async function main(argv: string[], env: Record<string, string | undefined>, io: { fetch: Fetch; log: (line: string) => void }): Promise<number> {
  const base = argv[0];
  let ok: boolean;
  try { ok = !!base && /^https?:$/.test(new URL(base).protocol); } catch { ok = false; }
  if (!ok) { io.log("usage: npm run cloud:smoke -- <base URL, e.g. https://purser-try.<account>.workers.dev>"); return 2; }
  const token = env[TOKEN_VAR];
  if (!token) { io.log(`set ${TOKEN_VAR} to the platform admin token (it is read, never printed)`); return 2; }
  io.log(`smoke: ${new URL(base!).origin}, on test money (the stand-in bank)`);
  const out = await runSmoke({ base: base!, adminToken: token, fetch: io.fetch, log: io.log });
  return out.failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2), process.env, { fetch: (input, init) => fetch(input, init), log: (line) => console.log(line) });
}
