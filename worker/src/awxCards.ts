// The agents' live sandbox cards, kit11's side (14 Nov): the one place the sandbox key is used for cards. Purser Cloud
// reaches it only through a service binding to the named entrypoint AwxCards (./index.ts), which no HTTP request can
// reach. Every call to Airwallex is checked against the card allow-list (src/airwallex/cardGate.ts) before it is sent,
// goes to the sandbox host only, and its answer is cut down to what the Cloud may see: the last four digits, never the
// full card number, never a CVV, never the cardholder.
//
// Two locks on this side: without the key nothing is called, and anything but a read needs AWX_CARDS_WRITE=on (a plain
// var, off by default). Purser Cloud has its own switch (awx_cards), the CFO's passkey and the caps in front of this one.
import { fromCents } from "../../src/lib/money.js";
import { createControlsBody, limitsUpdateBody } from "../../src/airwallex/cardBody.js";
import {
  CARD_ID, CARDS_SANDBOX_BASE, cardCallCheck, safeCard, safeTx, SHA256_HEX,
  type CardsAnswer, type CardsAsk, type CardsRefusal, type SafeCard, type SafeTx,
} from "../../src/airwallex/cardGate.js";
import { agentOfCard } from "../../src/airwallex/agentCardSet.js";

export interface CardsEnv {
  AIRWALLEX_CLIENT_ID?: string;
  AIRWALLEX_API_KEY?: string;
  /** "on": card writes and the purchase simulation are allowed (reads always are, with a key). Off when missing. */
  AWX_CARDS_WRITE?: string;
}

const TIMEOUT_MS = 12_000;
const TOKEN_EARLY_MS = 60_000;
const TOKEN_MS = 25 * 60_000;
/** Reads a minute, for this isolate: a runaway page cannot hammer the sandbox. */
const READS_PER_MINUTE = 60;
/** The card list: pages of 100 read, and cards read one by one for their limits. */
const LIST_PAGES = 5;
const LIST_DETAILS = 15;
const plainId = (v: string | null) => (v && /^[A-Za-z0-9._:-]{1,128}$/.test(v) ? v : null);
const codeOf = (j: unknown) => {
  const c = (j as { code?: unknown } | null)?.code;
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(c) ? c : null;
};
const no = (code: CardsRefusal["code"], reason: string, extra: Partial<CardsRefusal> = {}): CardsRefusal => ({ ok: false, code, reason, ...extra });
const eur = (cents: number) => Number(fromCents(cents));

type Raw = { ok: true; json: unknown } | CardsRefusal;

export class AwxCardsDesk {
  private token: { value: string; until: number } | null = null;
  private reads: { minute: number; n: number } = { minute: 0, n: 0 };
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly env: CardsEnv, opts: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.now = opts.now ?? Date.now;
  }

  private key() {
    const id = this.env.AIRWALLEX_CLIENT_ID, key = this.env.AIRWALLEX_API_KEY;
    return id && key ? { id, key } : null;
  }

  private async bearer(k: { id: string; key: string }): Promise<string | null> {
    if (this.token && this.token.until - TOKEN_EARLY_MS > this.now()) return this.token.value;
    this.token = null;
    const res = await this.fetchImpl(`${CARDS_SANDBOX_BASE}/authentication/login`, {
      method: "POST", headers: { "x-client-id": k.id, "x-api-key": k.key, "content-type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (!res.ok || typeof j?.token !== "string") return null;
    this.token = { value: j.token, until: this.now() + TOKEN_MS };
    return j.token;
  }

  /** One call: checked against the allow-list, sent to the sandbox, answered as JSON or a fixed refusal. Never throws. */
  async raw(method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string>): Promise<Raw> {
    const checked = cardCallCheck(method, path, body, query);
    if ("refused" in checked) return no("refused", checked.refused);
    if (checked.rule.kind !== "read" && this.env.AWX_CARDS_WRITE !== "on") return no("writes_off", "card writes are switched off at the gateway (AWX_CARDS_WRITE)");
    if (checked.rule.kind === "read") {
      const minute = Math.floor(this.now() / 60_000);
      if (this.reads.minute !== minute) this.reads = { minute, n: 0 };
      if (++this.reads.n > READS_PER_MINUTE) return no("no_answer", "too many card reads this minute; try again shortly");
    }
    const k = this.key();
    if (!k) return no("no_key", "the gateway holds no sandbox key");
    const url = new URL(CARDS_SANDBOX_BASE + path);
    for (const [q, v] of Object.entries(query ?? {})) url.searchParams.set(q, v);
    for (let attempt = 0; attempt < 2; attempt++) {
      let token: string | null;
      try { token = await this.bearer(k); } catch { return no("no_answer", "the sandbox login did not answer"); }
      if (!token) return no("forbidden", "the sandbox refused the login", { status: 401 });
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), {
          method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        return no("no_answer", "the sandbox did not answer");
      }
      if (res.status === 401 && attempt === 0) { this.token = null; continue; }
      const json = (await res.json().catch(() => null)) as unknown;
      if (res.ok) return { ok: true, json };
      const extra = { status: res.status, awx_code: codeOf(json), trace_id: plainId(res.headers.get("x-b3-traceid")) };
      if (res.status === 401 || res.status === 403) return no("forbidden", "the sandbox key may not do this (no Issuing access)", extra);
      if (res.status === 404) return no("not_found", "the sandbox has no such card", extra);
      return no("airwallex", "the sandbox refused the call", extra);
    }
    return no("forbidden", "the sandbox refused the key", { status: 401 });
  }

  private async card(cardId: string): Promise<{ ok: true; card: SafeCard } | CardsRefusal> {
    const r = await this.raw("GET", `/issuing/cards/${cardId}`);
    if (!r.ok) return r;
    const card = safeCard(r.json);
    return card ? { ok: true, card } : no("airwallex", "the sandbox's card answer could not be read");
  }

  /** The one method the entrypoint exposes. Never throws; never answers a key, a token or card data. */
  async ask(a: CardsAsk): Promise<CardsAnswer> {
    try {
      return await this.answer(a);
    } catch {
      return no("no_answer", "the card gateway failed");
    }
  }

  private async answer(a: CardsAsk): Promise<CardsAnswer> {
    if (!a || typeof a !== "object") return no("refused", "not a request");
    if ("card_id" in a && (typeof a.card_id !== "string" || !CARD_ID.test(a.card_id))) return no("refused", "not a card id");
    if (a.op !== "scope" && a.op !== "card" && a.op !== "transactions" && a.op !== "list" && !SHA256_HEX.test(String((a as { action_sha256?: unknown }).action_sha256 ?? ""))) {
      return no("refused", "a card write carries the hash of the action the CFO signed");
    }
    switch (a.op) {
      case "scope": {
        // page_size 10: Airwallex's list endpoints refuse a page smaller than 10 (HTTP 400); the read gateway uses 100.
        const r = await this.raw("GET", "/issuing/cards", undefined, { page_num: "0", page_size: "10" });
        return r.ok ? { ok: true, op: "scope", issuing: "ok" } : r;
      }
      case "list": {
        // Airwallex lists the oldest first, so every page is read (at most LIST_PAGES of 100). The list carries no limits:
        // each agent card that is not closed is read on its own (at most LIST_DETAILS).
        const rows: unknown[] = [];
        let cut = false;
        for (let page = 0; page < LIST_PAGES; page++) {
          const r = await this.raw("GET", "/issuing/cards", undefined, { page_num: String(page), page_size: "100" });
          if (!r.ok) return r;
          const j = r.json as { items?: unknown[]; has_more?: unknown } | null;
          rows.push(...(Array.isArray(j?.items) ? j.items : []));
          cut = j?.has_more === true;
          if (!cut) break;
        }
        const listed = rows.map(safeCard).filter((c): c is SafeCard => !!c && agentOfCard(c.nickname) !== null && c.status !== "CLOSED");
        const cards: SafeCard[] = [];
        let details = 0;
        for (const c of listed) {
          if (!c.limits && details < LIST_DETAILS) {
            details++;
            const full = await this.card(c.card_id);
            cards.push(full.ok ? { ...c, ...full.card, nickname: full.card.nickname ?? c.nickname, created_at: full.card.created_at ?? c.created_at } : c);
          } else cards.push(c);
        }
        return { ok: true, op: "list", cards, cut };
      }
      case "card": {
        const r = await this.card(a.card_id);
        return r.ok ? { ok: true, op: "card", card: r.card } : r;
      }
      case "transactions": {
        const r = await this.raw("GET", "/issuing/transactions", undefined, { card_id: a.card_id, page_num: "0", page_size: "20" });
        if (!r.ok) return r;
        const list = Array.isArray((r.json as { items?: unknown })?.items) ? (r.json as { items: unknown[] }).items : [];
        const items = list.map(safeTx).filter((x): x is SafeTx => !!x && x.card_id === a.card_id).sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 10);
        return { ok: true, op: "transactions", items };
      }
      case "create": {
        if (typeof a.holder?.email !== "string" || !/^[^\s@]{1,64}@[^\s@]{1,120}$/.test(a.holder.email)) return no("refused", "a cardholder needs an e-mail address");
        // The agent's cardholder: the one already there for its address, else a new delegate cardholder (an agent spends
        // for the business). The address is the business's, made up for the sandbox.
        const holders = await this.raw("GET", "/issuing/cardholders", undefined, { page_num: "0", page_size: "100" });
        if (!holders.ok) return holders;
        const items = Array.isArray((holders.json as { items?: unknown })?.items) ? (holders.json as { items: { cardholder_id?: unknown; email?: unknown }[] }).items : [];
        let holderId = items.find((h) => h.email === a.holder.email && typeof h.cardholder_id === "string")?.cardholder_id as string | undefined;
        if (!holderId) {
          const h = await this.raw("POST", "/issuing/cardholders/create", {
            type: "DELEGATE", email: a.holder.email,
            individual: {
              name: { first_name: a.holder.first_name, last_name: a.holder.last_name }, date_of_birth: "1990-01-01", express_consent_obtained: "yes",
              address: { line1: "Musterstrasse 1", city: "Berlin", postcode: "10115", country: "DE" },
            },
          });
          if (!h.ok) return h;
          holderId = typeof (h.json as { cardholder_id?: unknown })?.cardholder_id === "string" ? (h.json as { cardholder_id: string }).cardholder_id : undefined;
          if (!holderId) return no("airwallex", "the sandbox's cardholder answer could not be read");
        }
        const activeTo = new Date(this.now() + Math.min(Math.max(1, a.active_days), 365) * 86_400_000).toISOString();
        const r = await this.raw("POST", "/issuing/cards/create", {
          // Airwallex's idempotency key: the signed action's hash, so the same signed action never makes two cards.
          request_id: a.action_sha256.slice(0, 48), cardholder_id: holderId, created_by: a.created_by.slice(0, 80), form_factor: "VIRTUAL", is_personalized: false,
          program: { purpose: "COMMERCIAL" }, nick_name: a.nickname.slice(0, 100),
          authorization_controls: createControlsBody({ currency: "EUR", perTxCents: a.limits.per_tx_cents, monthlyCents: a.limits.monthly_cents }, { mccs: a.mccs, currencies: ["EUR"], activeTo }),
        });
        if (!r.ok) return r;
        const card = safeCard(r.json);
        return card ? { ok: true, op: "create", card } : no("airwallex", "the sandbox's card answer could not be read");
      }
      case "status": {
        if (a.status !== "ACTIVE" && a.status !== "INACTIVE") return no("refused", "a status is ACTIVE or INACTIVE");
        const r = await this.raw("POST", `/issuing/cards/${a.card_id}/update`, { card_status: a.status });
        if (!r.ok) return r;
        const c = await this.card(a.card_id);
        return c.ok ? { ok: true, op: "status", card: c.card } : c;
      }
      case "limits": {
        const r = await this.raw("POST", `/issuing/cards/${a.card_id}/update`, limitsUpdateBody({ currency: "EUR", perTxCents: a.limits.per_tx_cents, monthlyCents: a.limits.monthly_cents }));
        if (!r.ok) return r;
        const c = await this.card(a.card_id);
        return c.ok ? { ok: true, op: "limits", card: c.card } : c;
      }
      case "simulate": {
        const r = await this.raw("POST", "/simulation/issuing/create", {
          card_id: a.card_id, transaction_amount: eur(a.amount_cents), transaction_currency: "EUR", merchant_category_code: a.mcc, merchant_info: a.merchant.slice(0, 40),
        });
        if (!r.ok) return r;
        const tx = safeTx({ card_id: a.card_id, transaction_amount: eur(a.amount_cents), transaction_currency: "EUR", created_at: new Date(this.now()).toISOString(), ...(r.json as object) });
        return tx ? { ok: true, op: "simulate", tx } : no("airwallex", "the sandbox's simulation answer could not be read");
      }
      default:
        return no("refused", "not a card request");
    }
  }
}
