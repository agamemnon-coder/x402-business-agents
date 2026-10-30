// The relay between Max's phone and the runner (tier 2 item 5), as plain logic over a SQL handle so it runs in a
// Cloudflare Durable Object and in Node tests alike. It stores the last state the runner pushed, queues what the
// phone submits, and shows the runner's verdict. It holds no key and approves nothing: the runner verifies every
// signature itself. Its own checks (origin, hash, queue and rate limits, the enrolment code) only refuse early.

import { normalizeCode } from "../../src/passkey/code.js";
import { publicHealth, type Health } from "../../src/ops/publicHealth.js";

export type SqlValue = string | number | null;
export interface Sql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): unknown[] };
}

export interface Pages {
  dashboard: string;
  /** The month replay (simulated, its data inside the page). */
  month: string;
  /** The public demo: a recorded live run played back (K5), its data inside the page. */
  demo: string;
  /** "Purser live": the animated day, its timeline inside the page. */
  live: string;
  /** The film (about three minutes), its facts inside the page. */
  film: string;
  /** Try Purser: anyone types a task; its requests go to POST /api/try. */
  try: string;
  /** The Scenario Lab's recorded results (docs/lab/results.json), its data inside the page. */
  lab: string;
  /** How Purser uses Metal: features, mandates and the Dispute desk case, its data inside the page. */
  metal: string;
  /** The recorded case's evidence report (no script); empty when no case was recorded. */
  metalReport: string;
  approve: string;
  enrol: string;
  /** The CFO policy editor. */
  policy: string;
  /** The approval and enrolment pages' script and stylesheet, served as /assets/approve.js and .css. */
  client: string;
  css: string;
  /** Inter (woff2, base64), served as /assets/inter.woff2. */
  font: string;
  /** The sponsors' logos (base64), served as /assets/<name>. */
  images: Record<string, { type: string; data: string }>;
  csp: { dashboard: string; month: string; demo: string; live: string; film: string; try: string; lab: string; metal: string; metalReport: string; approve: string; enrol: string; policy: string };
}

const MAX_STATE_BYTES = 1_500_000;
const MAX_SUBMISSION_BYTES = 16_384;
const MAX_QUEUED_PER_PROPOSAL = 3;
const MAX_QUEUED = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
/** Failed viewer-key and webhook-signature attempts per address in the same window, before it is refused (HF1). */
const FAILS_MAX = 20;
const ENROL_ATTEMPTS = 5;
const ANSWERED_KEEP_MS = 60 * 60 * 1000;
const QUEUED_KEEP_MS = 30 * 60 * 1000;
const PROPOSAL_ID = /^P-\d{4,}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TICKET = /^[A-Za-z0-9_-]{22}$/;
const MAX_HOOK_BYTES = 65_536;
const MAX_HOOKS = 500;
const HOOKS_PER_SYNC = 50;
const HOOK_KEEP_MS = 24 * 60 * 60 * 1000;
/** How far Airwallex's x-timestamp may be from our clock (a replay of an old event is refused). */
const HOOK_TOLERANCE_MS = 5 * 60 * 1000;
const ACK_STATUSES = new Set(["approved", "rejected", "pending", "executed", "failed", "refused", "too_late", "already", "enrolled", "drafted", "cosigned", "answered"]);
/** The CFO's policy in plain words (P2): Opus drafts rules from it on the runner. */
const MAX_POLICY_TEXT = 2000;
/** A chat message to Purser (Ask Purser): the runner reads it and proposes a task card for Face ID. */
const MAX_ASK_TEXT = 500;

const COMMON_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  // On every answer, JSON included (HF2); workers.dev is HTTPS-only, so this is defence in depth.
  "strict-transport-security": "max-age=31536000",
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
      "cross-origin-opener-policy": "same-origin",
    },
  });
  if (path === "/") return page(pages.dashboard, pages.csp.dashboard);
  if (path === "/month") return page(pages.month, pages.csp.month);
  if (path === "/demo") return page(pages.demo, pages.csp.demo);
  if (path === "/live") return page(pages.live, pages.csp.live);
  if (path === "/film") return page(pages.film, pages.csp.film);
  if (path === "/try") return page(pages.try, pages.csp.try);
  if (path === "/lab") return page(pages.lab, pages.csp.lab);
  if (path === "/metal") return page(pages.metal, pages.csp.metal);
  if (path === "/metal/report" && pages.metalReport) return page(pages.metalReport, pages.csp.metalReport);
  if (path.startsWith("/approve/") && PROPOSAL_ID.test(path.slice("/approve/".length))) return page(pages.approve, pages.csp.approve);
  if (path === "/enrol") return page(pages.enrol, pages.csp.enrol);
  if (path === "/policy") return page(pages.policy, pages.csp.policy);
  if (path === "/assets/approve.js") return new Response(pages.client, { headers: { ...COMMON_HEADERS, "content-type": "text/javascript; charset=utf-8" } });
  if (path === "/assets/inter.woff2") {
    return new Response(Uint8Array.from(atob(pages.font), (c) => c.charCodeAt(0)), {
      headers: { ...COMMON_HEADERS, "content-type": "font/woff2", "cache-control": "public, max-age=86400" },
    });
  }
  if (path.startsWith("/assets/") && Object.hasOwn(pages.images, path.slice("/assets/".length))) {
    const img = pages.images[path.slice("/assets/".length)]!;
    return new Response(Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0)), {
      headers: { ...COMMON_HEADERS, "content-type": img.type, "cache-control": "public, max-age=86400" },
    });
  }
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
/** The body as text, or null when it is over the limit (a declared size over it is refused before a byte is read). */
async function readText(req: Request, limit: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? "0") > limit) return null;
  const text = await req.text();
  return new TextEncoder().encode(text).length > limit ? null : text;
}

async function readJson(req: Request, limit: number): Promise<{ text: string; value: unknown } | null | undefined> {
  const text = await readText(req, limit);
  if (text === null) return null;
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

  constructor(private readonly sql: Sql, private readonly opts: { relayToken: string; webhookSecret?: string; now?: () => Date }) {
    this.now = opts.now ?? (() => new Date());
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS inbox (
      ticket TEXT PRIMARY KEY, kind TEXT NOT NULL, proposal_id TEXT, window_id TEXT, body TEXT NOT NULL,
      received_at TEXT NOT NULL, status TEXT NOT NULL, message TEXT, updated_at TEXT NOT NULL)`);
    this.sql.exec("CREATE TABLE IF NOT EXISTS hits (ip TEXT NOT NULL, at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS hooks (id TEXT PRIMARY KEY, ts TEXT NOT NULL, signature TEXT NOT NULL, body TEXT NOT NULL, received_at TEXT NOT NULL)");
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

  private failKey(req: Request): string {
    return `fail:${rateKey(req.headers.get("cf-connecting-ip") ?? "unknown")}`;
  }

  /** True once this address has failed the viewer key or a webhook signature FAILS_MAX times in the window (HF1). */
  private failedTooOften(req: Request): boolean {
    this.sql.exec("DELETE FROM hits WHERE at <= ?", this.now().getTime() - RATE_WINDOW_MS);
    const [{ n }] = this.sql.exec("SELECT COUNT(*) AS n FROM hits WHERE ip = ?", this.failKey(req)).toArray() as [{ n: number }];
    return n >= FAILS_MAX;
  }

  private countFailure(req: Request): void {
    this.sql.exec("INSERT INTO hits (ip, at) VALUES (?, ?)", this.failKey(req), this.now().getTime());
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const route = (method: string, p: string | RegExp) => (typeof p === "string" ? path === p : p.test(path)) && (req.method === method || (method === "GET" && req.method === "HEAD"));
    const known = ["/api/runner/sync", "/api/snapshot", "/api/approvals", "/api/assertions", "/api/policy", "/api/policy-text", "/api/ask", "/api/enrol/options", "/api/enrol"];

    if (route("POST", "/api/runner/sync")) return this.sync(req);
    // Monitoring (B7), for an uptime monitor and anyone: all well or not, alarm codes only, 503 while anything is wrong
    // or the runner has stopped syncing. No amounts, names or ids; the details stay behind the viewer key.
    if (route("GET", "/health")) {
      const state = this.state();
      const raw = state?.snapshot.health as Health | undefined;
      // A runner too old to send health is "unknown", never "ok".
      const ok = raw && typeof raw.at === "string" && Array.isArray(raw.alerts) ? raw : null;
      const h = publicHealth(ok, state ? this.relayInfo(state).age_ms : null);
      return new Response(JSON.stringify(h.body), { status: h.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    // An address that keeps failing the viewer key or the webhook signature is refused before either is checked,
    // so guessing is slowed and shows up (HF1). The runner's route has its own token and is not counted.
    if ((path === "/hooks/airwallex" || path.startsWith("/api/")) && this.failedTooOften(req)) {
      return error(429, "too many failed attempts from this address; wait ten minutes");
    }
    // Airwallex's webhooks: no viewer key (Airwallex has none), its own signature instead.
    if (path === "/hooks/airwallex") return req.method === "POST" ? this.hook(req) : error(405, "method not allowed");
    // Everything else under /api/ is the CFO's: the dashboard data, the pending terms, the phone's submissions.
    // Without the viewer key (from the link the runner prints) it answers nothing (security review M2).
    if (path.startsWith("/api/") && !(await sameSecret(req.headers.get("x-kit11-view") ?? "", await viewKeyOf(this.opts.relayToken)))) {
      this.countFailure(req);
      return error(401, "this relay needs its viewer link: open the link from the runner once on this device");
    }
    if (route("GET", "/api/snapshot")) return this.snapshot();
    if (route("GET", "/api/approvals")) return this.approvals();
    if (route("GET", /^\/api\/tickets\/[^/]+$/)) return this.ticket(path.slice("/api/tickets/".length));
    // Everything the phone posts must come from the relay's own pages.
    if (req.method === "POST" && (path === "/api/assertions" || path === "/api/policy" || path === "/api/policy-text" || path === "/api/ask" || path.startsWith("/api/enrol"))) {
      if (req.headers.get("origin") !== url.origin) return error(403, "requests must come from this site's own pages");
      if (!this.underRateLimit(req)) return error(429, "too many requests from this address; wait ten minutes");
      if (path === "/api/assertions") return this.assertion(req);
      if (path === "/api/policy") return this.policyChange(req);
      if (path === "/api/policy-text") return this.policyText(req);
      if (path === "/api/ask") return this.ask(req);
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
    const { state_hash, state, acks, hook_acks } = body.value;
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
    // Webhook events the runner has recorded are dropped; the rest go out again (at most a day).
    if (Array.isArray(hook_acks)) for (const id of hook_acks.slice(0, 200)) if (typeof id === "string") this.sql.exec("DELETE FROM hooks WHERE id = ?", id);
    this.sql.exec("DELETE FROM hooks WHERE received_at <= ?", new Date(now.getTime() - HOOK_KEEP_MS).toISOString());
    const hooks = this.sql.exec("SELECT id, ts, signature, body FROM hooks ORDER BY received_at, id LIMIT ?", HOOKS_PER_SYNC).toArray();
    return json(200, { need_state: this.get("state_hash") !== state_hash, inbox, hooks });
  }

  /**
   * An Airwallex webhook: x-signature must be HMAC-SHA256(secret, x-timestamp + raw body) and the timestamp recent.
   * The event is kept for the runner, which checks the signature again; the answer to Airwallex does not wait for it.
   */
  private async hook(req: Request): Promise<Response> {
    const secret = this.opts.webhookSecret;
    if (!secret) return error(503, "webhooks are not set up on this relay");
    const text = await readText(req, MAX_HOOK_BYTES);
    if (text === null) return error(413, "event too large");
    const ts = req.headers.get("x-timestamp") ?? "";
    const signature = (req.headers.get("x-signature") ?? "").toLowerCase();
    const age = Math.abs(this.now().getTime() - Number(ts));
    // The body is checked exactly as received, before anything parses it (HF10: also when it is not JSON).
    if (!/^\d{10,16}$/.test(ts) || !(age <= HOOK_TOLERANCE_MS) || !/^[0-9a-f]{64}$/.test(signature) || !(await sameSecret(signature, await hmacHex(secret, ts + text)))) {
      this.countFailure(req);
      return error(401, "bad or missing webhook signature");
    }
    let v: unknown;
    try { v = JSON.parse(text); } catch { return error(400, "malformed event"); }
    if (!isObject(v) || typeof v.id !== "string" || v.id.length > 128) return error(400, "malformed event");
    this.sql.exec("INSERT INTO hooks (id, ts, signature, body, received_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING", v.id, ts, signature, text, this.now().toISOString());
    // A flood cannot grow the store: the oldest events go first (the runner's poll still finds their transactions).
    this.sql.exec("DELETE FROM hooks WHERE id IN (SELECT id FROM hooks ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ?)", MAX_HOOKS);
    return json(200, { received: true });
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

  private queue(kind: "assertion" | "registration" | "policy" | "policy_text" | "ask", proposalId: string | null, windowId: string | null, text: string): string {
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

  /**
   * The CFO's policy in their own words, for Opus to draft rules from on the runner (P2). It signs nothing and changes
   * nothing: the runner checks every drafted rule, refuses any that would loosen the policy (it came from the phone),
   * and the rest becomes a proposal that still needs Face ID. One at a time.
   */
  private async policyText(req: Request): Promise<Response> {
    const body = await readJson(req, MAX_SUBMISSION_BYTES);
    if (body === null) return error(413, "submission too large");
    const v = body?.value;
    if (!isObject(v) || typeof v.text !== "string" || v.text.trim() === "" || v.text.length > MAX_POLICY_TEXT) {
      return error(400, `write the policy in at most ${MAX_POLICY_TEXT} characters`);
    }
    if (!this.state()) return error(503, "the runner has not connected yet");
    if (this.queued("kind = 'policy_text'") >= 1) return error(429, "the runner is still reading your last text; wait for it");
    return json(202, { ticket: this.queue("policy_text", null, null, JSON.stringify({ text: v.text })) });
  }

  private async ask(req: Request): Promise<Response> {
    const body = await readJson(req, MAX_SUBMISSION_BYTES);
    if (body === null) return error(413, "submission too large");
    const v = body?.value;
    if (!isObject(v) || typeof v.text !== "string" || v.text.trim() === "" || v.text.length > MAX_ASK_TEXT) {
      return error(400, `write your request in at most ${MAX_ASK_TEXT} characters`);
    }
    if (!this.state()) return error(503, "the runner has not connected yet");
    if (this.queued("kind = 'ask'") >= 1) return error(429, "Purser is still answering your last message; wait for it");
    return json(202, { ticket: this.queue("ask", null, null, JSON.stringify({ text: v.text })) });
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
      rp: { id: c.e.rp_id, name: "Purser for Northwind Outdoor" },
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
