// The money loop's live runs on in-memory stand-ins (src/e2e/moneyLoopLive.ts), 0 network: the FX and payout fakes of
// the red team (src/redteam/airwallex.ts), and a small stand-in of the Airwallex endpoints the receivables run calls
// (payment links, Global Accounts, the deposit simulation and the deposit list). Used by
// `npm run airwallex:money-loop-live -- stand-in <run>` and by test/money-loop-live.test.ts.

import { MANUFACTURER } from "../config/payees.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { FakeAirwallex } from "../redteam/airwallex.js";
import type { GovResults } from "./governanceLive.js";
import { runFxConvert, runNegotiatedPay, runReceivables, type ConversionRead, type LoopRun, type TransferRead } from "./moneyLoopLive.js";
import type { DrillLine } from "./drillHttp.js";

type Query = Record<string, string> | undefined;
type Raw = Record<string, unknown>;

/** The endpoints the receivables run calls, answered as the sandbox answers them (the fields Purser reads). */
export class StandInAwxApi {
  calls: { method: string; path: string }[] = [];
  links = new Map<string, Raw>();
  deposits: Raw[] = [];
  readonly globalAccounts = [
    { id: "ga-standin-gbp", status: "ACTIVE", required_features: [{ currency: "GBP" }] },
    { id: "ga-standin-eur", status: "ACTIVE", required_features: [{ currency: "EUR" }], supported_features: [{ currency: "EUR" }] },
  ];
  constructor(private readonly now: () => Date = () => new Date()) {}
  async call<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    this.calls.push({ method, path });
    const b = (body ?? {}) as Raw;
    const id = path.split("/")[3] ?? "";
    let out: unknown;
    if (method === "POST" && path === "/pa/payment_links/create") {
      const lid = `plink-standin-${this.links.size + 1}`;
      out = { ...b, id: lid, url: `https://checkout.standin.invalid/${lid}`, active: true, status: "ACTIVE" };
      this.links.set(lid, out as Raw);
    } else if (method === "GET" && /^\/pa\/payment_links\/[^/]+$/.test(path)) {
      out = this.links.get(id);
    } else if (method === "POST" && /^\/pa\/payment_links\/[^/]+\/deactivate$/.test(path)) {
      const l = this.links.get(id);
      if (l) { l.active = false; l.status = "INACTIVE"; }
      out = l;
    } else if (method === "GET" && path === "/global_accounts") {
      out = { items: this.globalAccounts.filter((g) => !query?.status || g.status === query.status) };
    } else if (method === "POST" && path === "/simulation/deposit/create") {
      const d = { id: `dep-standin-${this.deposits.length + 1}`, global_account_id: b.global_account_id, amount: b.amount, currency: "EUR", reference: b.reference, payer_name: b.payer_name, status: "PENDING", created_at: this.now().toISOString() };
      this.deposits.push(d);
      out = { ...d };
    } else if (method === "GET" && path === "/deposits") {
      // A deposit settles by the second read, as the sandbox's did within a minute (docs/runs/2026-11-13-airwallex-deposits.md).
      out = { items: this.deposits.map((d) => ({ ...d })), has_more: false };
      for (const d of this.deposits) d.status = "SETTLED";
    }
    if (out === undefined) throw new Error(`stand-in: no ${method} ${path}`);
    return structuredClone(out) as T;
  }
}

/** A conversion as the stand-in holds it, in the read-back's shape. */
export const conversionReadOf = (awx: FakeAirwallex) => async (id: string): Promise<ConversionRead> => {
  const c = awx.conversions.find((x) => x.conversionId === id);
  if (!c) throw new Error(`stand-in: no conversion ${id}`);
  const q = awx.quotes.get(c.quoteId) as unknown as { buyCurrency: string; sellCurrency: string };
  return { conversion_id: c.conversionId, request_id: c.requestId, status: c.status, buy_currency: q.buyCurrency, buy_amount: fromCents(c.buyAmountCents), sell_currency: q.sellCurrency, sell_amount: fromCents(c.sellAmountCents), metadata: { approval_sha256: awx.conversionMetadata.get(id) } };
};

/** A transfer as the stand-in holds it, in the read-back's shape. */
export const transferReadOf = (awx: FakeAirwallex) => async (id: string): Promise<TransferRead> => {
  const t = awx.transfers.find((x) => x.id === id);
  if (!t) throw new Error(`stand-in: no transfer ${id}`);
  return { id: t.id, request_id: t.requestId, status: t.status, amount: fromCents(t.amountCents), currency: t.currency, reference: t.reference ?? null, metadata: { approval_sha256: t.metadata, ...(t.agreementSha256 ? { agreement_sha256: t.agreementSha256 } : {}) } };
};

export interface StandInBase { db: DB; now: () => Date; lines: () => DrillLine[]; counted: <T extends object>(o: T) => T; log?: (l: string) => void }

/** One run on the stand-ins; returns its results and the fakes, for a test to look into. */
export async function standInLoopRun(run: LoopRun, b: StandInBase): Promise<{ res: GovResults; awx: FakeAirwallex; api: StandInAwxApi }> {
  const base = { db: b.db, mode: "stand-in" as const, now: b.now, lines: b.lines, halted: () => null, ...(b.log ? { log: b.log } : {}) };
  const awx = new FakeAirwallex();
  const api = new StandInAwxApi(b.now);
  let res: GovResults;
  if (run === "fx-convert") {
    awx.ratesAny["CHF/EUR"] = "1.0700";
    res = await runFxConvert({ ...base, rail: b.counted(awx), readConversion: conversionReadOf(awx) });
  } else if (run === "receivables") {
    res = await runReceivables({ ...base, api: b.counted(api), sleep: async () => undefined });
  } else {
    await awx.createBeneficiary(MANUFACTURER);
    res = await runNegotiatedPay({ ...base, awx: b.counted(awx), readTransfer: transferReadOf(awx) });
  }
  return { res, awx, api };
}
