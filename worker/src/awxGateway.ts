// The Airwallex gateway's kit11 side (Purser Cloud's actions, 14 Nov): the one place the sandbox key for Cloud's
// actions is used. Purser Cloud reaches it only through a service binding to the named entrypoint AwxGateway
// (./index.ts), which no HTTP request can reach. Each call is checked against the shared allow-list
// (src/airwallex/gateway.ts) before anything is sent, goes to the Airwallex sandbox host only, and answers Airwallex's
// JSON, or its code and trace id: never its words, the key or the token.
//
// Two locks on this side: without the key nothing is called, and anything but a read needs AWX_GATEWAY_WRITE=on (a
// plain var, off by default). Purser Cloud has its own switch and caps in front of this one (cloud/src/engine/awxAct.ts).
import { GATEWAY_SANDBOX_BASE, gatewayCheck, type GatewayAnswer, type GatewayRequest } from "../../src/airwallex/gatewayRules.js";
import { apiVersionHeader } from "../../src/airwallex/apiVersion.js";

export interface GatewayEnv {
  /**
   * The sandbox key for Cloud's actions, Worker secrets the owner sets (never a file or a script here): AWX_ACT_* when
   * set, else the Worker's one sandbox key (worker/src/index.ts hands it in). It needs beneficiaries, FX, transfers and
   * batch transfers.
   */
  AWX_ACT_CLIENT_ID?: string;
  AWX_ACT_API_KEY?: string;
  /** "on": writes, simulations and money calls are allowed (reads always are, with a key). Off when missing. */
  AWX_GATEWAY_WRITE?: string;
  /**
   * The gateway's own cap per minute (20 Nov): a Workers rate limiting binding (worker/wrangler.jsonc, 120 calls a
   * minute for all callers together), asked before every call. A refusal, or a limiter that fails, answers 429 and
   * nothing is sent. Purser Cloud's caps per token stay in front of it.
   */
  AWX_GATEWAY_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

const TIMEOUT_MS = 20_000;
const TOKEN_EARLY_MS = 60_000;
const TOKEN_MS = 25 * 60_000;
const plainId = (v: string | null) => (v && /^[A-Za-z0-9._:-]{1,128}$/.test(v) ? v : null);
const codeOf = (j: unknown) => {
  const c = (j as { code?: unknown } | null)?.code;
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(c) ? c : null;
};

export class AwxGatewayDesk {
  private token: { value: string; until: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly env: GatewayEnv, opts: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.now = opts.now ?? Date.now;
  }

  private key(): { id: string; key: string } | null {
    const id = this.env.AWX_ACT_CLIENT_ID;
    const key = this.env.AWX_ACT_API_KEY;
    return id && key ? { id, key } : null;
  }

  private async bearer(k: { id: string; key: string }): Promise<string | null> {
    if (this.token && this.token.until - TOKEN_EARLY_MS > this.now()) return this.token.value;
    this.token = null;
    const res = await this.fetchImpl(`${GATEWAY_SANDBOX_BASE}/authentication/login`, {
      method: "POST", headers: { "x-client-id": k.id, "x-api-key": k.key, "content-type": "application/json", ...apiVersionHeader("/authentication/login") }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (!res.ok || typeof j?.token !== "string") return null;
    this.token = { value: j.token, until: this.now() + TOKEN_MS };
    return j.token;
  }

  /** One call: checked, sent to the sandbox, answered as data. Never throws. */
  async call(r: GatewayRequest): Promise<GatewayAnswer> {
    const checked = gatewayCheck(r);
    if ("refused" in checked) return { ok: false, status: 400, code: "gateway_refused", trace_id: null, refused: checked.refused };
    if (checked.rule.kind !== "read" && this.env.AWX_GATEWAY_WRITE !== "on") return { ok: false, status: 403, code: "gateway_writes_off", trace_id: null, refused: "writes are switched off at the gateway (AWX_GATEWAY_WRITE)" };
    if (this.env.AWX_GATEWAY_LIMIT) {
      const under = await this.env.AWX_GATEWAY_LIMIT.limit({ key: "awx-gateway" }).then((o) => o.success, () => false);
      if (!under) return { ok: false, status: 429, code: "gateway_rate_limited", trace_id: null, refused: "the gateway's cap per minute is reached (AWX_GATEWAY_LIMIT)" };
    }
    const k = this.key();
    if (!k) return { ok: false, status: 503, code: "gateway_no_key", trace_id: null, refused: "the gateway holds no sandbox key" };
    const url = new URL(GATEWAY_SANDBOX_BASE + r.path);
    for (const [q, v] of Object.entries(r.query ?? {})) url.searchParams.set(q, v);
    for (let attempt = 0; attempt < 2; attempt++) {
      let token: string | null;
      try { token = await this.bearer(k); } catch { return { ok: false, status: 502, code: "gateway_login_failed", trace_id: null }; }
      if (!token) return { ok: false, status: 502, code: "gateway_login_refused", trace_id: null };
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), {
          method: r.method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...apiVersionHeader(r.path) },
          body: r.body === undefined ? undefined : JSON.stringify(r.body), signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        // No answer: a POST may have happened at Airwallex. The caller looks it up by request_id; nothing is resent here.
        return { ok: false, status: 504, code: null, trace_id: null, ...(r.method === "POST" ? { ambiguous: true as const } : {}) };
      }
      if (res.status === 401 && attempt === 0) { this.token = null; continue; }
      const json = (await res.json().catch(() => null)) as unknown;
      const trace = plainId(res.headers.get("x-b3-traceid"));
      if (res.ok) return { ok: true, status: res.status, json };
      return { ok: false, status: res.status, code: codeOf(json), trace_id: trace, ...(res.status >= 500 && r.method === "POST" ? { ambiguous: true as const } : {}) };
    }
    return { ok: false, status: 401, code: "unauthorized", trace_id: null };
  }
}
