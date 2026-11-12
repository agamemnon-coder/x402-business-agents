// GET /x402/proof: an x402 endpoint a juror can call (master-list line 107). Without a payment it answers HTTP 402 with
// x402 payment requirements (version 2, scheme "exact" on Metal testnet, 0.01 test *USDZ), labelled as test money. The
// resource is the signed receipt of the Airwallex run awx-1 (docs/runs/2026-11-07-awx-1/receipt-P-0002.json).
//
// A payment comes in the PAYMENT-SIGNATURE header and is refused unless it accepts exactly these requirements (a wrong
// amount, asset, payee or network is refused) and its nonce is new (a replay is refused). Two kinds:
//   - a local stand-in payment ({"standIn": STAND_IN_LABEL, "nonce": …}): no money moves; the answer says so. It shows
//     the protocol while testnet settlement is off, which is the default.
//   - a signed payment: only with X402_TESTNET_SETTLE set to "on" (the owner's go, through the orchestrator). It is then
//     verified and settled by Metal's facilitator (the @x402/core client Purser's sellers use), within a hard cap per
//     request and per UTC day. With the switch off it is refused before anything is sent anywhere.

import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import receipt from "../../docs/runs/2026-11-07-awx-1/receipt-P-0002.json" with { type: "json" };
import { CHAIN_ID, FACILITATOR_URL, USDZ } from "../../src/metal/network.js";

export const X402_PATH = "/x402/proof";
export const NETWORK = `eip155:${CHAIN_ID}`;
/** 0.01 test *USDZ, in base units (18 decimals). */
export const PRICE_BASE_UNITS = "10000000000000000";
/** Hard caps for testnet settlement: the most one request may settle, and how many may settle in one UTC day. */
export const PER_REQUEST_CAP_BASE_UNITS = 10_000_000_000_000_000n;
export const DAILY_SETTLE_CAP = 20;
export const STAND_IN_LABEL = "local stand-in payment, test money, nothing moves";
export const MONEY_LABEL = "test money, Metal testnet (*USDZ); no real money";
/** The token's EIP-712 domain as Metal's scheme names it (@metalntwx/metal-pay USDZ; test/x402-endpoint.test.ts holds them equal). */
export const USDZ_EXTRA = { name: "USD Zero", version: "1", primaryType: "TransferWithAuthorization" } as const;
/** Northwind Outdoor's business account on Metal testnet (docs/demo/metal.json): the payee when no other is set. */
export const DEFAULT_PAY_TO = "0x828c7DE12cab8149AA516958433F6EEe23aEC875";

export interface Sql { exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] } }

interface Requirements { scheme: string; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number; extra: Record<string, unknown> }
interface Payload { x402Version: number; resource?: unknown; accepted: Requirements; payload: Record<string, unknown> }

/** What the endpoint needs of Metal's facilitator: verify, then settle (HTTPFacilitatorClient in @x402/core). */
export interface Facilitator {
  verify(p: Payload, r: Requirements): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }>;
  settle(p: Payload, r: Requirements): Promise<{ success: boolean; errorReason?: string; transaction: string; network: string; payer?: string }>;
}

export interface X402Options {
  /** "on" lets signed payments settle on Metal testnet; anything else (the default) keeps settlement off. */
  settle?: string | undefined;
  payTo?: string | undefined;
  facilitator?: () => Promise<Facilitator>;
  now?: () => Date;
}

const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff", "access-control-allow-origin": "*", "access-control-expose-headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE" };
const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 1), { status, headers: { ...HEADERS, "content-type": "application/json; charset=utf-8", ...extra } });

/** Metal's facilitator through the client Purser's x402 sellers use; loaded only when settlement is on. */
async function metalFacilitator(): Promise<Facilitator> {
  const { HTTPFacilitatorClient } = await import("@x402/core/server");
  return new HTTPFacilitatorClient({ url: FACILITATOR_URL }) as unknown as Facilitator;
}

export class X402Desk {
  private readonly on: boolean;
  private readonly payTo: string;
  private readonly now: () => Date;
  private readonly facilitator: () => Promise<Facilitator>;

  constructor(private readonly sql: Sql, o: X402Options = {}) {
    this.on = o.settle?.trim().toLowerCase() === "on";
    this.payTo = o.payTo?.trim() || DEFAULT_PAY_TO;
    this.now = o.now ?? (() => new Date());
    this.facilitator = o.facilitator ?? metalFacilitator;
    sql.exec("CREATE TABLE IF NOT EXISTS x402_payments (nonce TEXT PRIMARY KEY, kind TEXT NOT NULL, amount TEXT NOT NULL, payer TEXT, tx TEXT, status TEXT NOT NULL, day TEXT NOT NULL, at TEXT NOT NULL)");
  }

  requirements(): Requirements {
    return { scheme: "exact", network: NETWORK, asset: USDZ, amount: PRICE_BASE_UNITS, payTo: this.payTo, maxTimeoutSeconds: 60, extra: { ...USDZ_EXTRA } };
  }

  private paymentRequired(url: string, error?: string) {
    return {
      x402Version: 2, ...(error ? { error } : {}),
      resource: { url, description: "The signed receipt of Purser's Airwallex run awx-1 (7 November 2026): the exact terms the CFO approved", mimeType: "application/json" },
      accepts: [this.requirements()],
    };
  }

  private ask(url: string, status: number, error?: string): Response {
    const pr = this.paymentRequired(url, error);
    return json(status, { ...pr, money: MONEY_LABEL, settlement: this.on ? "on: a signed payment is verified and settled by Metal's facilitator, within the caps" : "off: a signed payment is refused and nothing is sent; a local stand-in payment shows the flow", stand_in: { payload: { standIn: STAND_IN_LABEL, nonce: "<a new random string>" } } },
      { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(pr as never) });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== X402_PATH) return json(404, { error: "not found" });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "access-control-allow-methods": "GET, HEAD", "access-control-allow-headers": "PAYMENT-SIGNATURE" } });
    if (req.method !== "GET" && req.method !== "HEAD") return json(405, { error: "method not allowed: GET" });
    const resourceUrl = `${url.origin}${X402_PATH}`;
    const header = req.headers.get("payment-signature");
    if (!header) return this.ask(resourceUrl, 402);
    if (header.length > 8192) return this.ask(resourceUrl, 402, "the payment header is too long");

    let p: Payload;
    try { p = decodePaymentSignatureHeader(header) as unknown as Payload; } catch { return this.ask(resourceUrl, 402, "the payment header is not a base64 x402 payment payload"); }
    const want = this.requirements();
    const a = p?.accepted;
    if (!a || typeof p.payload !== "object" || p.payload === null) return this.ask(resourceUrl, 402, "the payment names no accepted requirements");
    if (p.x402Version !== 2) return this.ask(resourceUrl, 402, "x402Version must be 2");
    if (a.amount !== want.amount) return this.ask(resourceUrl, 402, `the amount must be exactly ${want.amount} base units (0.01 test *USDZ), not ${String(a.amount).slice(0, 40)}`);
    if (a.scheme !== want.scheme || a.network !== want.network || String(a.asset).toLowerCase() !== want.asset.toLowerCase() || String(a.payTo).toLowerCase() !== want.payTo.toLowerCase()) {
      return this.ask(resourceUrl, 402, "the payment does not accept these requirements (scheme, network, asset or payee)");
    }

    const standIn = p.payload.standIn === STAND_IN_LABEL;
    const auth = p.payload.authorization as { nonce?: unknown; value?: unknown; to?: unknown; from?: unknown } | undefined;
    const nonce = standIn ? p.payload.nonce : auth?.nonce;
    if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 100) return this.ask(resourceUrl, 402, "the payment carries no nonce of 8 to 100 characters");
    if (this.sql.exec("SELECT 1 FROM x402_payments WHERE nonce = ?", nonce).toArray().length) return json(409, { error: "this payment was used already: a replay is refused", money: MONEY_LABEL });
    const at = this.now();
    const day = at.toISOString().slice(0, 10);

    if (standIn) {
      this.sql.exec("INSERT INTO x402_payments (nonce, kind, amount, status, day, at) VALUES (?, 'stand-in', ?, 'served', ?, ?)", nonce, a.amount, day, at.toISOString());
      return json(200, { paid_with: STAND_IN_LABEL, money: MONEY_LABEL, resource: receipt },
        { "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: "", network: NETWORK, payer: "stand-in" } as never) });
    }

    if (!this.on) return json(503, { error: "testnet settlement is switched off: a signed payment is not verified or settled, and nothing was sent. A local stand-in payment shows the flow.", money: MONEY_LABEL });
    // The hard caps, before anything is sent: the signed amount, and the day's settled payments.
    if (typeof auth?.value !== "string" || !/^\d{1,40}$/.test(auth.value) || BigInt(auth.value) !== BigInt(want.amount) || BigInt(auth.value) > PER_REQUEST_CAP_BASE_UNITS) {
      return this.ask(resourceUrl, 402, "the signed amount is not exactly the price, or is over the cap per request");
    }
    const settledToday = this.sql.exec("SELECT COUNT(*) AS n FROM x402_payments WHERE kind = 'testnet' AND day = ? AND status IN ('settling', 'settled')", day).toArray()[0] as { n: number };
    if (settledToday.n >= DAILY_SETTLE_CAP) return json(429, { error: `the day's cap of ${DAILY_SETTLE_CAP} testnet settlements is reached; nothing was sent`, money: MONEY_LABEL });

    // The nonce is taken before any call, so a second copy of this payment is refused while the first one settles.
    this.sql.exec("INSERT INTO x402_payments (nonce, kind, amount, payer, status, day, at) VALUES (?, 'testnet', ?, ?, 'settling', ?, ?)", nonce, a.amount, typeof auth?.from === "string" ? auth.from.slice(0, 42) : null, day, at.toISOString());
    const f = await this.facilitator();
    const fail = (why: string) => { this.sql.exec("UPDATE x402_payments SET status = 'refused' WHERE nonce = ?", nonce); return this.ask(resourceUrl, 402, why); };
    let v: Awaited<ReturnType<Facilitator["verify"]>>;
    try { v = await f.verify(p, want); } catch (e) { return fail(`Metal's facilitator could not verify the payment: ${(e as Error).message.slice(0, 160)}`); }
    if (!v.isValid) return fail(`Metal's facilitator refused the payment: ${v.invalidReason ?? "invalid"}`);
    let s: Awaited<ReturnType<Facilitator["settle"]>>;
    try { s = await f.settle(p, want); } catch (e) { return fail(`Metal's facilitator could not settle the payment: ${(e as Error).message.slice(0, 160)}`); }
    if (!s.success) return fail(`Metal's facilitator did not settle the payment: ${s.errorReason ?? "unknown"}`);
    this.sql.exec("UPDATE x402_payments SET status = 'settled', tx = ? WHERE nonce = ?", s.transaction.slice(0, 80), nonce);
    return json(200, { paid_with: "Metal testnet, settled by Metal's facilitator", money: MONEY_LABEL, transaction: s.transaction, resource: receipt },
      { "PAYMENT-RESPONSE": encodePaymentResponseHeader(s as never) });
  }
}
