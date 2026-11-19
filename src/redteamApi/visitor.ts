// A visitor of the hands-on demo, driven over HTTP the way the /try page drives it (cloud/src/try/presentMode.ts): start
// a test company, file an invoice, set up the passkey (a software authenticator, src/redteam/authenticator.ts), file the
// payment, approve it, read the signed terms, pay with the signature. Every step is one request to a local server.
import { FakeAuthenticator } from "../redteam/authenticator.js";
import { send, type Answer } from "./net.js";

/** A server under attack: its base URL (where requests go), its origin (what a browser on its page sends) and RP id. */
export interface Target { name: "judge" | "edge"; base: string; origin: string; rpId: string }

export interface CallOpts {
  key?: string | null;
  json?: unknown;
  raw?: string | Uint8Array;
  headers?: Record<string, string>;
  /** The Origin header: the target's own unless given; null sends none (as a program does). */
  origin?: string | null;
  from?: string;
  chunked?: boolean;
}

/** One request to the target, as its own page would send it unless the options say otherwise. */
export function api(t: Target, method: string, path: string, o: CallOpts = {}): Promise<Answer> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.key) headers.authorization = `Bearer ${o.key}`;
  const origin = o.origin === undefined ? (method === "GET" || method === "HEAD" ? null : t.origin) : o.origin;
  if (origin !== null && !Object.keys(headers).some((k) => k.toLowerCase() === "origin")) headers.origin = origin;
  return send(t.base, { method, path, headers, ...(o.json !== undefined ? { json: o.json } : {}), ...(o.raw !== undefined ? { raw: o.raw } : {}), ...(o.from ? { from: o.from } : {}), ...(o.chunked ? { chunked: true } : {}) });
}

export interface Proposal { id: string; terms_sha256: string; challenge: string; status?: string }

export class Visitor {
  static composed = 0;
  phone: FakeAuthenticator | null = null;
  private counter = 0;
  constructor(readonly t: Target, readonly tenant: string, public session: string, readonly visitorToken: string, readonly from?: string) {}

  static async start(t: Target, from?: string): Promise<Visitor> {
    const r = await api(t, "POST", "/v1/try/start", { json: {}, ...(from ? { from } : {}) });
    if (r.status !== 201 || !r.json) throw new Error(`start answered ${r.status}: ${r.text.slice(0, 200)}`);
    return new Visitor(t, r.json.tenant as string, r.json.session as string, r.json.visitor_token as string, from);
  }

  call(method: string, path: string, o: CallOpts = {}): Promise<Answer> {
    return api(this.t, method, path, { key: this.session, ...(this.from ? { from: this.from } : {}), ...o });
  }

  /** A fresh session with the visitor's token (after the clock moved past 15 minutes). */
  async renew(): Promise<void> {
    const r = await api(this.t, "POST", "/v1/try/session", { json: { tenant_id: this.tenant, visitor_token: this.visitorToken }, ...(this.from ? { from: this.from } : {}) });
    if (r.status !== 200) throw new Error(`renew answered ${r.status}: ${r.text.slice(0, 200)}`);
    this.session = r.json!.session as string;
  }

  /** The approval passkey of this company: a new software authenticator, or the one given (another world's). */
  async enrol(phone = new FakeAuthenticator()): Promise<FakeAuthenticator> {
    const st = await this.call("POST", "/v1/engine/passkey/start");
    if (st.status !== 200) throw new Error(`passkey/start answered ${st.status}: ${st.text.slice(0, 200)}`);
    const fin = await this.call("POST", "/v1/engine/passkey/finish", { json: { code: st.json!.code, credential: phone.register({ challenge: st.json!.challenge as string, origin: this.t.origin, rpId: this.t.rpId }) } });
    if (fin.status !== 200) throw new Error(`passkey/finish answered ${fin.status}: ${fin.text.slice(0, 200)}`);
    this.phone = phone;
    return phone;
  }

  /** A signature by `phone` (this company's passkey unless given) over a challenge, with the next counter. */
  sign(challenge: string, phone: FakeAuthenticator | null = this.phone, over: { origin?: string; rpId?: string; userVerified?: boolean; counter?: number } = {}): unknown {
    if (!phone) throw new Error("no passkey");
    return phone.sign({ challenge, origin: over.origin ?? this.t.origin, rpId: over.rpId ?? this.t.rpId, counter: over.counter ?? ++this.counter, ...(over.userVerified === false ? { userVerified: false } : {}) });
  }

  async sample(key: string): Promise<Answer> { return this.call("POST", `/v1/engine/samples/${key}`); }

  /** "Write your own" invoice from Bergtex, on file (its IBAN unless given). */
  async compose(over: Record<string, string> = {}): Promise<Answer> {
    const today = new Date().toISOString().slice(0, 10);
    // A number with digits (the reader needs one: docs/evidence/fuzzing.md) and a total of its own, so no two composed
    // invoices of one company look like the same invoice under another number (the duplicate check holds those).
    const n = ++Visitor.composed;
    return this.call("POST", "/v1/engine/compose", { json: { supplier_key: "bergtex", invoice_no: `RT-${2026_000 + n}`, amount: `${1000 + (n % 3_000)}.${String(n % 100).padStart(2, "0")}`, issue_date: today, due_date: today, iban: "DE89370400440532013000", ...over } });
  }

  async propose(invoiceId: string): Promise<Answer> { return this.call("POST", `/v1/engine/invoices/${invoiceId}/pay`); }

  async terms(proposalId: string): Promise<Record<string, unknown>> {
    const r = await this.call("GET", `/v1/engine/proposals/${proposalId}/terms`);
    if (r.status !== 200) throw new Error(`terms answered ${r.status}`);
    return r.json!.terms as Record<string, unknown>;
  }

  async approve(p: Proposal, credential: unknown, sha = p.terms_sha256): Promise<Answer> {
    return this.call("POST", `/v1/engine/proposals/${p.id}/approve`, { json: { terms_sha256: sha, credential } });
  }

  async pay(proposalId: string, terms: Record<string, unknown>, credential: unknown): Promise<Answer> {
    return this.call("POST", `/v1/engine/proposals/${proposalId}/pay`, { json: { terms, credential } });
  }

  /** Transfers the company's books know of (the read model the engine feeds). */
  async payments(): Promise<{ amount: string; currency: string; status: string; request_id: string }[]> {
    const r = await this.call("GET", "/v1/payments");
    return (r.json?.items ?? []) as { amount: string; currency: string; status: string; request_id: string }[];
  }

  /**
   * An invoice filed (a sample or a composed one), its payment proposed, approved with this company's passkey and held
   * for the pay route, as the page does it: the proposal, the approval and the stored terms.
   */
  async approvedPayment(o: { sample?: string; compose?: Record<string, string> } = {}): Promise<{ invoiceId: string; p: Proposal; approval: unknown; terms: Record<string, unknown> }> {
    if (!this.phone) await this.enrol();
    const up = o.compose ? await this.compose(o.compose) : await this.sample(o.sample ?? "clean");
    const invoiceId = (up.json?.invoice as { id?: string } | undefined)?.id;
    if (!invoiceId) throw new Error(`filing answered ${up.status}: ${up.text.slice(0, 300)}`);
    const pr = await this.propose(invoiceId);
    const p = pr.json?.proposal as Proposal | undefined;
    if (!p) throw new Error(`propose answered ${pr.status}: ${pr.text.slice(0, 300)}`);
    const approval = this.sign(p.challenge);
    const a = await this.approve(p, approval);
    if (a.json?.status !== "approved") throw new Error(`approve answered ${a.status}: ${a.text.slice(0, 300)}`);
    return { invoiceId, p, approval, terms: await this.terms(p.id) };
  }
}
