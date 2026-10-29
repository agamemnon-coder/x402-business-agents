// The relay between Max's phone and the runner (tier 2 item 5), as plain logic over a SQL handle so it runs in a
// Cloudflare Durable Object and in Node tests alike. It stores the last state the runner pushed, queues what the
// phone submits, and shows the runner's verdict. It holds no key and approves nothing: the runner verifies every
// signature itself. Its own checks (origin, hash, queue and rate limits, the enrolment code) only refuse early.

import { normalizeCode } from "../../src/passkey/code.js";

export type SqlValue = string | number | null;
export interface Sql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): unknown[] };
}

export interface Pages {
  dashboard: string;
  approve: string;
  enrol: string;
  /** The CFO policy editor. */
  policy: string;
  /** The approval and enrolment pages' script and stylesheet, served as /assets/approve.js and .css. */
  client: string;
  css: string;
  csp: { dashboard: string; approve: string; enrol: string; policy: string };
}

const MAX_STATE_BYTES = 1_500_000;
const MAX_SUBMISSION_BYTES = 16_384;
const MAX_QUEUED_PER_PROPOSAL = 3;
const MAX_QUEUED = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
const ENROL_ATTEMPTS = 5;
const ANSWERED_KEEP_MS = 60 * 60 * 1000;
const QUEUED_KEEP_MS = 30 * 60 * 1000;
const PROPOSAL_ID = /^P-\d{4,}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TICKET = /^[A-Za-z0-9_-]{22}$/;
const ACK_STATUSES = new Set(["approved", "rejected", "pending", "executed", "failed", "refused", "too_late", "already", "enrolled"]);

const COMMON_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8" } });
}
const error = (status: number, message: string, extra: Record<string, unknown> = {}) => json(status, { error: message, ...extra });

/** The pages; anything else is not ours. Ids in paths are checked, so nothing odd reaches the page script. */
export function pageResponse(req: Request, pages: Pages): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const path = new URL(req.url).pathname;
  const page = (body: string, csp: string) => new Response(body, {
    headers: {
      ...COMMON_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": csp,
      "permissions-policy": "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=()",
      "cross-origin-opener-policy": "same-origin", "strict-transport-security": "max-age=31536000",
    },
  });
  if (path === "/") return page(pages.dashboard, pages.csp.dashboard);
  if (path.startsWith("/approve/") && PROPOSAL_ID.test(path.slice("/approve/".length))) return page(pages.approve, pages.csp.approve);
  if (path === "/enrol") return page(pages.enrol, pages.csp.enrol);
  if (path === "/policy") return page(pages.policy, pages.csp.policy);
  if (path === "/assets/approve.js") return new Response(pages.client, { headers: { ...COMMON_HEADERS, "content-type": "text/javascript; charset=utf-8" } });
  if (path === "/assets/approve.css") return new Response(pages.css, { headers: { ...COMMON_HEADERS, "content-type": "text/css; charset=utf-8" } });
  return null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The viewer key the runner derives in src/relay/config.ts viewKey(): HMAC-SHA256(relay token, "kit11 view v1"), 32 hex. */
async function viewKeyOf(token: string): Promise<string> {
  return (await hmacHex(token, "kit11 view v1")).slice(0, 32);
}

/** Compares secrets through their digests, in constant time. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function ticketId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Reads a body up to a limit. Null means too large; undefined means not JSON. */
async function readJson(req: Request, limit: number): Promise<{ text: string; value: unknown } | null | undefined> {
  // A declared size over the limit is refused before a byte is read.
  if (Number(req.headers.get("content-length") ?? "0") > limit) return null;
  const text = await req.text();
  if (new TextEncoder().encode(text).length > limit) return null;
  try {
    return { text, value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function b64urlToText(s: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

function hexToB64url(hex: string): string {
  const bytes = hex.match(/../g)!.map((h) => parseInt(h, 16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Whether the browser said it signed exactly this hash on this site (WebAuthn clientDataJSON). Not a signature
 * check (the runner does that); it keeps junk made from public data out of the queue.
 */
function signedFor(clientDataJSON: unknown, termsSha256: string, origin: string): boolean {
  if (typeof clientDataJSON !== "string") return false;
  const text = b64urlToText(clientDataJSON);
  if (text === null) return false;
  try {
    const c = JSON.parse(text) as Record<string, unknown>;
    return c.type === "webauthn.get" && c.challenge === hexToB64url(termsSha256) && c.origin === origin && c.crossOrigin !== true;
  } catch {
    return false;
  }
}

/** The rate-limit key: an IPv4 address as is, an IPv6 address by its /64 (one subscriber gets a whole /64). */
export function rateKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

interface StoredState {
  generated_at: string;
  snapshot: Record<string, unknown>;
  approvals: {
    proposals: { proposal_id: string; terms_sha256: string; expires_at: string }[];
    names: Record<string, string>;
    passkey: { rp_id: string; credentials: { id: string; label: string; enrolled_at: string }[] };
  };
  enrolment: null | { window_id: string; challenge: string; user_id: string; user_name: string; code_mac: string; rp_id: string; expires_at: string };
}

interface TicketRow {
  ticket: string;
  kind: string;
  proposal_id: string | null;
  body: string;
  received_at: string;
  status: string;
  message: string | null;
  updated_at: string;
}

export class Relay {
  private readonly now: () => Date;

  constructor(private readonly sql: Sql, private readonly opts: { relayToken: string; now?: () => Date }) {
    this.now = opts.now ?? (() => new Date());
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS inbox (
      ticket TEXT PRIMARY KEY, kind TEXT NOT NULL, proposal_id TEXT, window_id TEXT, body TEXT NOT NULL,
      received_at TEXT NOT NULL, status TEXT NOT NULL, message TEXT, updated_at TEXT NOT NULL)`);
    this.sql.exec("CREATE TABLE IF NOT EXISTS hits (ip TEXT NOT NULL, at INTEGER NOT NULL)");
  }

  private get(k: string): string | null {
    const rows = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray() as { v: string }[];
    return rows[0]?.v ?? null;
  }

  private put(k: string, v: string): void {
    this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
  }

  private state(): StoredState | null {
    const s = this.get("state");
    return s ? (JSON.parse(s) as StoredState) : null;
  }

  private relayInfo(state: StoredState) {
    const synced = this.get("synced_at") ?? state.generated_at;
    return { synced_at: synced, generated_at: state.generated_at, age_ms: Math.max(0, this.now().getTime() - Date.parse(synced)) };
  }

  /** Counts this request against its address; true while under the limit. */
  private underRateLimit(req: Request): boolean {
    const ip = rateKey(req.headers.get("cf-connecting-ip") ?? "unknown");
    const now = this.now().getTime();
    this.sql.exec("DELETE FROM hits WHERE at <= ?", now - RATE_WINDOW_MS);
    const [{ n }] = this.sql.exec("SELECT COUNT(*) AS n FROM hits WHERE ip = ?", ip).toArray() as [{ n: number }];
    if (n >= RATE_MAX) return false;
    this.sql.exec("INSERT INTO hits (ip, at) VALUES (?, ?)", ip, now);
    return true;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const route = (method: string, p: string | RegExp) => (typeof p === "string" ? path === p : p.test(path)) && (req.method === method || (method === "GET" && req.method === "HEAD"));
    const known = ["/api/runner/sync", "/api/snapshot", "/api/approvals", "/api/assertions", "/api/policy", "/api/enrol/options", "/api/enrol"];

    if (route("POST", "/api/runner/sync")) return this.sync(req);
    // Everything else under /api/ is the CFO's: the dashboard data, the pending terms, the phone's submissions.
    // Without the viewer key (from the link the runner prints) it answers nothing (security review M2).
    if (path.startsWith("/api/") && !(await sameSecret(req.headers.get("x-kit11-view") ?? "", await viewKeyOf(this.opts.relayToken)))) {
      return error(401, "this relay needs its viewer link: open the link from the runner once on this device");
    }
    if (route("GET", "/api/snapshot")) return this.snapshot();
    if (route("GET", "/api/approvals")) return this.approvals();
    if (route("GET", /^\/api\/tickets\/[^/]+$/)) return this.ticket(path.slice("/api/tickets/".length));
    // Everything the phone posts must come from the relay's own pages.
    if (req.method === "POST" && (path === "/api/assertions" || path === "/api/policy" || path.startsWith("/api/enrol"))) {
      if (req.headers.get("origin") !== url.origin) return error(403, "requests must come from this site's own pages");
      if (!this.underRateLimit(req)) return error(429, "too many requests from this address; wait ten minutes");
      if (path === "/api/assertions") return this.assertion(req);
      if (path === "/api/policy") return this.policyChange(req);
      if (path === "/api/enrol/options") return this.enrolOptions(req);
      if (path === "/api/enrol") return this.enrol(req);
    }
    if (known.includes(path) || path.startsWith("/api/tickets/")) return error(405, "method not allowed");
    return error(404, "not found");
  }

  private async sync(req: Request): Promise<Response> {
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.startsWith("Bearer ") || !(await sameSecret(auth.slice(7), this.opts.relayToken))) return error(401, "the relay token is missing or wrong");
    const body = await readJson(req, MAX_STATE_BYTES);
    if (body === null) return error(413, "state too large");
    if (body === undefined || !isObject(body.value) || typeof body.value.state_hash !== "string") return error(400, "malformed sync");
    const { state_hash, state, acks } = body.value;
    const now = this.now();
    if (state !== undefined) {
      if (!isObject(state) || !isObject(state.snapshot) || !isObject(state.approvals)) return error(400, "malformed state");
      this.put("state", JSON.stringify(state));
      this.put("state_hash", state_hash);
    }
    this.put("synced_at", now.toISOString());
    if (Array.isArray(acks)) {
      for (const a of acks) {
        if (!isObject(a) || typeof a.ticket !== "string" || typeof a.status !== "string" || !ACK_STATUSES.has(a.status)) continue;
        const message = typeof a.message === "string" ? a.message.slice(0, 500) : null;
        this.sql.exec("UPDATE inbox SET status = ?, message = ?, updated_at = ? WHERE ticket = ?", a.status, message, now.toISOString(), a.ticket);
      }
    }
    // Answered tickets are kept an hour for the phone to read; unanswered ones are dropped after thirty minutes.
    this.sql.exec("DELETE FROM inbox WHERE status != 'queued' AND updated_at <= ?", new Date(now.getTime() - ANSWERED_KEEP_MS).toISOString());
    this.sql.exec("DELETE FROM inbox WHERE status = 'queued' AND received_at <= ?", new Date(now.getTime() - QUEUED_KEEP_MS).toISOString());
    const inbox = (this.sql.exec("SELECT ticket, kind, proposal_id, body, received_at FROM inbox WHERE status = 'queued' ORDER BY received_at, ticket LIMIT ?", MAX_QUEUED).toArray());
    return json(200, { need_state: this.get("state_hash") !== state_hash, inbox });
  }

  private snapshot(): Response {
    const s = this.state();
    if (!s) return error(503, "the runner has not connected yet");
    return json(200, { ...s.snapshot, relay: this.relayInfo(s) });
  }

  private approvals(): Response {
    const s = this.state();
    if (!s) return error(503, "the runner has not connected yet");
    const open = s.enrolment !== null && Date.parse(s.enrolment.expires_at) > this.now().getTime();
    return json(200, { ...s.approvals, generated_at: s.generated_at, relay: this.relayInfo(s), enrolment_open: open });
  }

  private ticket(id: string): Response {
    if (!TICKET.test(id)) return error(404, "no such ticket");
    const rows = this.sql.exec("SELECT ticket, kind, proposal_id, status, message, received_at, updated_at FROM inbox WHERE ticket = ?", id).toArray();
    return rows[0] ? json(200, rows[0]) : error(404, "no such ticket");
  }

  private queue(kind: "assertion" | "registration" | "policy", proposalId: string | null, windowId: string | null, text: string): string {
    const ticket = ticketId();
    const at = this.now().toISOString();
    this.sql.exec("INSERT INTO inbox (ticket, kind, proposal_id, window_id, body, received_at, status, message, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, ?)",
      ticket, kind, proposalId, windowId, text, at, at);
    return ticket;
  }

  private queued(where: string, ...bindings: SqlValue[]): number {
    const [{ n }] = this.sql.exec(`SELECT COUNT(*) AS n FROM inbox WHERE status = 'queued' AND ${where}`, ...bindings).toArray() as [{ n: number }];
    return n;
  }

  private async assertion(req: Request): Promise<Response> {
    const body = await readJson(req, MAX_SUBMISSION_BYTES);
    if (body === null) return error(413, "submission too large");
    const v = body?.value;
    if (!isObject(v) || typeof v.proposal_id !== "string" || !PROPOSAL_ID.test(v.proposal_id) || typeof v.terms_sha256 !== "string" || !HEX64.test(v.terms_sha256)
      || !isObject(v.credential) || typeof v.credential.id !== "string" || !isObject(v.credential.response)
      || (v.decision !== undefined && v.decision !== "APPROVED" && v.decision !== "REJECTED")) return error(400, "malformed submission");
    const rejecting = v.decision === "REJECTED";
    const s = this.state();
    if (!s) return error(503, "the runner has not connected yet");
    const p = s.approvals.proposals.find((x) => x.proposal_id === v.proposal_id);
    if (!p || p.terms_sha256 !== v.terms_sha256 || Date.parse(p.expires_at) <= this.now().getTime()) {
      return error(409, `${v.proposal_id} with these terms is not waiting for approval (expired, decided or changed)`);
    }
    const credentialId = v.credential.id;
    if (!s.approvals.passkey.credentials.some((c) => c.id === credentialId)) return error(403, "this passkey is not the enrolled one");
    // To reject, the passkey signs the hash derived from the terms hash (src/lib/terms.ts rejectionSha256).
    const challenge = rejecting ? await sha256Hex(`kit11 reject v1 ${p.terms_sha256}`) : p.terms_sha256;
    if (!signedFor((v.credential.response as Record<string, unknown>).clientDataJSON, challenge, new URL(req.url).origin)) {
      return error(400, `this signature is not ${rejecting ? "a rejection of" : "for"} these terms on this site`);
    }
    if (this.queued("proposal_id = ?", p.proposal_id) >= MAX_QUEUED_PER_PROPOSAL || this.queued("1 = 1") >= MAX_QUEUED) {
      return error(429, "too many approvals are waiting for the runner; wait a moment");
    }
    return json(202, { ticket: this.queue("assertion", p.proposal_id, null, body!.text) });
  }

  /**
   * A policy change the phone wrote and signed itself. The relay checks that the canonical terms hash to the signed
   * hash, that they are a policy change with a phone id, the enrolled passkey and the browser's own statement; the
   * runner checks the change and the signature again before it becomes a proposal.
   */
  private async policyChange(req: Request): Promise<Response> {
    const body = await readJson(req, MAX_SUBMISSION_BYTES);
    if (body === null) return error(413, "submission too large");
    const v = body?.value;
    if (!isObject(v) || typeof v.canonical !== "string" || v.canonical.length > 8192 || typeof v.terms_sha256 !== "string" || !HEX64.test(v.terms_sha256)
      || !isObject(v.credential) || typeof v.credential.id !== "string" || !isObject(v.credential.response)) return error(400, "malformed submission");
    const s = this.state();
    if (!s) return error(503, "the runner has not connected yet");
    const credentialId = v.credential.id;
    if (!s.approvals.passkey.credentials.some((c) => c.id === credentialId)) return error(403, "this passkey is not the enrolled one");
    if ((await sha256Hex(v.canonical)) !== v.terms_sha256) return error(400, "the terms do not hash to the signed hash");
    let terms: unknown;
    try {
      terms = JSON.parse(v.canonical);
    } catch {
      return error(400, "malformed terms");
    }
    if (!isObject(terms) || terms.kind !== "policy_change" || typeof terms.proposal_id !== "string" || !/^C-[0-9a-f]{8}$/.test(terms.proposal_id)) {
      return error(400, "not a policy change made on the phone");
    }
    if (!signedFor((v.credential.response as Record<string, unknown>).clientDataJSON, v.terms_sha256, new URL(req.url).origin)) {
      return error(400, "this signature is not for these terms on this site");
    }
    if (this.queued("kind = 'policy'") >= MAX_QUEUED_PER_PROPOSAL) return error(429, "too many policy changes are waiting for the runner");
    return json(202, { ticket: this.queue("policy", terms.proposal_id, null, body!.text) });
  }

  /** The open enrolment, after checking the code; counts wrong codes and closes the window after five. */
  private async checkCode(code: unknown): Promise<{ ok: true; e: NonNullable<StoredState["enrolment"]>; s: StoredState } | { ok: false; res: Response }> {
    const s = this.state();
    const e = s?.enrolment;
    if (!s || !e || Date.parse(e.expires_at) <= this.now().getTime()) return { ok: false, res: error(409, "no enrolment is open; ask for a new code") };
    // Every try is counted before the first await, so tries that arrive together cannot share one count.
    const tries = `enrol_tries:${e.window_id}`;
    const rights = `enrol_rights:${e.window_id}`;
    const tried = Number(this.get(tries) ?? "0");
    const wrongSoFar = tried - Number(this.get(rights) ?? "0");
    if (wrongSoFar >= ENROL_ATTEMPTS) return { ok: false, res: error(403, "too many wrong codes; ask for a new code") };
    this.put(tries, String(tried + 1));
    const normal = typeof code === "string" ? normalizeCode(code) : null;
    if (normal === null || !(await sameSecret(await hmacHex(this.opts.relayToken, await sha256Hex(normal)), e.code_mac))) {
      const wrong = Number(this.get(tries) ?? "0") - Number(this.get(rights) ?? "0");
      return { ok: false, res: error(403, "wrong code", { attempts_left: Math.max(0, ENROL_ATTEMPTS - wrong) }) };
    }
    this.put(rights, String(Number(this.get(rights) ?? "0") + 1));
    return { ok: true, e, s };
  }

  private async enrolOptions(req: Request): Promise<Response> {
    const body = await readJson(req, 1024);
    if (body === null) return error(413, "too large");
    if (!isObject(body?.value)) return error(400, "malformed request");
    const c = await this.checkCode(body.value.code);
    if (!c.ok) return c.res;
    return json(200, {
      challenge: c.e.challenge,
      rp: { id: c.e.rp_id, name: "Tidemark Data approvals" },
      user: { id: c.e.user_id, name: c.e.user_name, displayName: c.e.user_name },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      timeout: 120_000,
      attestation: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      // Empty on purpose: a replacement passkey may be made on the same phone, which then overwrites the old one.
      excludeCredentials: [],
      expires_at: c.e.expires_at,
    });
  }

  private async enrol(req: Request): Promise<Response> {
    const body = await readJson(req, MAX_SUBMISSION_BYTES);
    if (body === null) return error(413, "submission too large");
    const v = body?.value;
    if (!isObject(v) || !isObject(v.credential) || typeof v.credential.id !== "string") return error(400, "malformed submission");
    const c = await this.checkCode(v.code);
    if (!c.ok) return c.res;
    if (this.queued("window_id = ?", c.e.window_id) >= 2) return error(429, "a passkey for this code is already waiting for the runner");
    return json(202, { ticket: this.queue("registration", null, c.e.window_id, body!.text) });
  }
}
