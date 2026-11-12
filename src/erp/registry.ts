// Which ERP connectors exist, what each needs from the environment, and how to build one live or for a dry run.
// A dry run sends nothing: a recording transport answers each request plausibly, and with no settings at all it runs
// on example settings, labelled as such, so the requests can be seen before anyone has an ERP account.

import { CHART } from "../config/gl.js";
import { entraTokens, exactTokens, fileTokenStore, staticToken } from "./auth.js";
import { BusinessCentralConnector, type BcConfig } from "./businessCentral.js";
import { liveTransport } from "./callBudget.js";
import { fetchTransport, RecordingTransport, type ConnectorName, type ErpConnector, type HttpRequest, type HttpResponse, type Transport } from "./connector.js";
import { exactConfigFromEnv, ExactConnector, type ExactConfig } from "./exact.js";
import { moneybirdCallName, moneybirdConfigFromEnv, MoneybirdConnector, type MoneybirdConfig } from "./moneybird.js";
import type { VatCode } from "./model.js";
import { OdooConnector, type OdooConfig } from "./odoo.js";
import { jsonMap } from "./rest.js";
import { encodeValue, type XmlValue } from "./xmlrpc.js";

type Env = Record<string, string | undefined>;

const UNTESTED = "not tested against a live ERP yet";

/**
 * The settings each connector reads: secrets first (never printed, only whether they are set). `live` is what was
 * really proven against the ERP itself, said by `npm run erp -- list`; it changes only with a recorded run.
 */
export const SETTINGS: Record<ConnectorName, { label: string; secrets: string[]; settings: string[]; optional: string[]; live: string }> = {
  exact: {
    label: "Exact Online", live: UNTESTED,
    secrets: ["ERP_EXACT_CLIENT_ID", "ERP_EXACT_CLIENT_SECRET", "ERP_EXACT_REFRESH_TOKEN"],
    settings: ["ERP_EXACT_DIVISION", "ERP_EXACT_PURCHASE_JOURNAL", "ERP_EXACT_GENERAL_JOURNAL", "ERP_EXACT_BANK_JOURNALS", "ERP_EXACT_VAT_CODES"],
    optional: ["ERP_EXACT_BASE_URL", "ERP_EXACT_GL_MAP", "ERP_EXACT_DOCUMENT_TYPE", "ERP_EXACT_AP_ACCOUNT", "ERP_EXACT_PAYMENT_SIGN"],
  },
  bc: {
    label: "Microsoft Dynamics 365 Business Central", live: UNTESTED,
    secrets: ["ERP_BC_CLIENT_ID", "ERP_BC_CLIENT_SECRET"],
    settings: ["ERP_BC_TENANT", "ERP_BC_ENVIRONMENT", "ERP_BC_COMPANY_ID", "ERP_BC_GENERAL_JOURNAL_ID", "ERP_BC_PAYMENT_JOURNAL_ID", "ERP_BC_VAT_CODES"],
    optional: ["ERP_BC_LOCAL_CURRENCY", "ERP_BC_GL_MAP", "ERP_BC_POST_INVOICES"],
  },
  odoo: {
    label: "Odoo", live: UNTESTED,
    secrets: ["ERP_ODOO_API_KEY"],
    settings: ["ERP_ODOO_URL", "ERP_ODOO_DB", "ERP_ODOO_LOGIN", "ERP_ODOO_PURCHASE_JOURNAL_ID", "ERP_ODOO_GENERAL_JOURNAL_ID", "ERP_ODOO_BANK_JOURNALS", "ERP_ODOO_TAX_IDS"],
    optional: ["ERP_ODOO_COMPANY_CURRENCY", "ERP_ODOO_GL_MAP", "ERP_ODOO_POST"],
  },
  moneybird: {
    // 12 November 2026, docs/runs/2026-11-12-moneybird-sandbox.md: the chart, the contacts and the tax rates were read.
    label: "Moneybird", live: "read live from a sandbox administration; nothing sent to one yet: docs/moneybird.md",
    secrets: ["ERP_MONEYBIRD_TOKEN"],
    settings: ["ERP_MONEYBIRD_ADMINISTRATION_ID", "ERP_MONEYBIRD_TAX_RATES"],
    optional: ["ERP_MONEYBIRD_GL_MAP", "ERP_MONEYBIRD_PROJECTS", "ERP_MONEYBIRD_IGNORE_COST_CENTRES", "ERP_MONEYBIRD_BASE_CURRENCY", "ERP_MONEYBIRD_BASE_URL", "ERP_MONEYBIRD_SANDBOX_ONLY"],
  },
};

/** Settings a person fills in from what a pull lists, so a pull itself does not need them (Moneybird's tax rate ids). */
const FILLED_FROM_A_PULL: Partial<Record<ConnectorName, string[]>> = { moneybird: ["ERP_MONEYBIRD_TAX_RATES"] };

/** Which required settings are missing for a connector (names only); for a pull, without the ones the pull is for. */
export function missingSettings(name: ConnectorName, env: Env, forPull = false): string[] {
  const s = SETTINGS[name];
  const later = forPull ? FILLED_FROM_A_PULL[name] ?? [] : [];
  return [...s.secrets, ...s.settings].filter((k) => !env[k] && !later.includes(k));
}

const intMap = (m: Record<string, string>, name: string) => Object.fromEntries(Object.entries(m).map(([k, v]) => {
  if (!/^\d+$/.test(v)) throw new Error(`${name}: ${k} must be a number`);
  return [k, Number(v)];
}));

export function bcConfigFromEnv(env: Env): BcConfig {
  return {
    tenant: env.ERP_BC_TENANT ?? "", environment: env.ERP_BC_ENVIRONMENT ?? "", companyId: env.ERP_BC_COMPANY_ID ?? "", localCurrency: env.ERP_BC_LOCAL_CURRENCY ?? "EUR",
    generalJournalId: env.ERP_BC_GENERAL_JOURNAL_ID ?? "", paymentJournalId: env.ERP_BC_PAYMENT_JOURNAL_ID ?? "", vatCodes: jsonMap(env, "ERP_BC_VAT_CODES") as Record<VatCode, string>,
    glMap: jsonMap(env, "ERP_BC_GL_MAP", true), postInvoices: env.ERP_BC_POST_INVOICES === "on",
  };
}

export function odooConfigFromEnv(env: Env): OdooConfig {
  return {
    url: env.ERP_ODOO_URL ?? "", db: env.ERP_ODOO_DB ?? "", login: env.ERP_ODOO_LOGIN ?? "", apiKey: env.ERP_ODOO_API_KEY ?? "", companyCurrency: env.ERP_ODOO_COMPANY_CURRENCY ?? "EUR",
    purchaseJournalId: Number(env.ERP_ODOO_PURCHASE_JOURNAL_ID), generalJournalId: Number(env.ERP_ODOO_GENERAL_JOURNAL_ID),
    bankJournalIds: intMap(jsonMap(env, "ERP_ODOO_BANK_JOURNALS"), "ERP_ODOO_BANK_JOURNALS"), taxIds: intMap(jsonMap(env, "ERP_ODOO_TAX_IDS"), "ERP_ODOO_TAX_IDS") as Record<VatCode, number>,
    glMap: jsonMap(env, "ERP_ODOO_GL_MAP", true), post: env.ERP_ODOO_POST === "on",
  };
}

const exactFromEnv = (env: Env) => exactConfigFromEnv(env, { vat: jsonMap(env, "ERP_EXACT_VAT_CODES"), gl: jsonMap(env, "ERP_EXACT_GL_MAP", true), banks: jsonMap(env, "ERP_EXACT_BANK_JOURNALS") });

/**
 * A connector that really calls the ERP. Every request goes through the run's call budget (src/erp/callBudget.ts):
 * without the owner's go, the approved number and the call log, none is built. `inner` is what sends (fetch; a test's
 * stand-in).
 */
export function liveConnector(name: ConnectorName, env: Env, inner: Transport = fetchTransport()): ErpConnector {
  if (name === "moneybird") {
    // A personal API token or an OAuth access token; Moneybird's access tokens do not expire for now (its
    // Authentication page), so a fixed Bearer token from the environment is all it takes. The call log names each
    // request under its administration.
    const cfg = moneybirdConfigFromEnv(env);
    return new MoneybirdConnector(cfg, liveTransport(env, inner, (req) => moneybirdCallName(req, cfg)), staticToken(env.ERP_MONEYBIRD_TOKEN ?? ""));
  }
  const transport = liveTransport(env, inner);
  switch (name) {
    case "exact": {
      const cfg = exactFromEnv(env);
      const tokens = exactTokens({ baseUrl: cfg.baseUrl, clientId: env.ERP_EXACT_CLIENT_ID ?? "", clientSecret: env.ERP_EXACT_CLIENT_SECRET ?? "", store: fileTokenStore("data/erp/exact.token.json"), ...(env.ERP_EXACT_REFRESH_TOKEN ? { seedRefreshToken: env.ERP_EXACT_REFRESH_TOKEN } : {}), transport });
      return new ExactConnector(cfg, transport, tokens);
    }
    case "bc": {
      const cfg = bcConfigFromEnv(env);
      return new BusinessCentralConnector(cfg, transport, entraTokens({ tenantId: cfg.tenant, clientId: env.ERP_BC_CLIENT_ID ?? "", clientSecret: env.ERP_BC_CLIENT_SECRET ?? "", transport }));
    }
    case "odoo":
      return new OdooConnector(odooConfigFromEnv(env), transport);
  }
}

// ---- Dry runs: example settings and plausible answers. ----

const VAT_EXAMPLE: Record<VatCode, string> = { NL21: "VAT21", NL9: "VAT9", NL0: "VAT0", EU_RC: "EU-RC", NONEU_RC: "IMP-RC", EXEMPT: "EXEMPT", NONE: "NONE" };
export const EXAMPLE = {
  exact: { baseUrl: "https://start.exactonline.nl", division: 1000000, purchaseJournal: "60", bankJournals: { "1200": "20", "1201": "21", "1202": "22", "1203": "23" }, generalJournal: "90", vatCodes: VAT_EXAMPLE, glMap: {}, apAccount: "1600", documentType: 20, paymentSign: -1 } satisfies ExactConfig,
  bc: { tenant: "example.onmicrosoft.com", environment: "sandbox", companyId: "00000000-0000-0000-0000-000000000001", localCurrency: "EUR", generalJournalId: "00000000-0000-0000-0000-00000000000a", paymentJournalId: "00000000-0000-0000-0000-00000000000b", vatCodes: VAT_EXAMPLE, glMap: {}, postInvoices: false, verifyTotals: false } satisfies BcConfig,
  moneybird: {
    baseUrl: "https://moneybird.com/api/v2", administrationId: "100000000000000000", baseCurrency: "EUR",
    taxRates: { NL21: "100000000000000021", NL9: "100000000000000009", NL0: "100000000000000010", EU_RC: "100000000000000031", NONEU_RC: "100000000000000032", EXEMPT: "100000000000000040", NONE: "100000000000000041" },
    glMap: {}, projects: {}, ignoreCostCentres: true, verifyTotals: false,
  } satisfies MoneybirdConfig,
  odoo: { url: "https://example.odoo.com", db: "example", login: "purser@example.com", apiKey: "dry-run", companyCurrency: "EUR", purchaseJournalId: 2, bankJournalIds: { "1200": 6, "1201": 7, "1202": 8, "1203": 9 }, generalJournalId: 3, taxIds: { NL21: 21, NL9: 9, NL0: 10, EU_RC: 31, NONEU_RC: 32, EXEMPT: 0, NONE: 0 }, glMap: {}, post: false, verifyTotals: false } satisfies OdooConfig,
};

const chartCodes = [...Object.keys(CHART), "1600"];
const json = (o: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: JSON.stringify(o) });
const xml = (v: XmlValue): HttpResponse => ({ status: 200, headers: {}, body: `<?xml version="1.0"?><methodResponse><params><param>${encodeValue(v)}</param></params></methodResponse>` });

/** `own`: the customer's own Moneybird settings, when the dry run uses them. */
function dryAnswer(name: ConnectorName, own?: MoneybirdConfig): (req: HttpRequest, n: number) => HttpResponse {
  if (name === "exact") return (req, n) => {
    if (req.method === "GET" && req.url.includes("/financial/GLAccounts")) return json({ d: { results: chartCodes.map((c) => ({ ID: `dry-gl-${c}`, Code: c, Description: CHART[c] ?? "Accounts payable" })) } });
    if (req.method === "GET") return json({ d: { results: [] } });
    return json({ d: { ID: `dry-run-${n}`, EntryID: `dry-run-${n}` } }, 201);
  };
  if (name === "moneybird") return (req, n) => {
    const path = new URL(req.url).pathname;
    // Example ledger accounts carry Purser's own codes; example tax rates are purchase-invoice rates; anything created
    // gets an example id. With the customer's own maps, a dry run asks no administration, so it takes each mapped id
    // at its word (the account or rate exists and may be used); the live run checks every one against Moneybird's own
    // chart and tax rates before it sends (found on the sandbox run, 12 November 2026: the dry run stopped at the
    // first real id, because the example chart did not hold it).
    const doc = ["purchase_invoice", "general_journal_document"];
    if (req.method === "GET" && path.endsWith("/ledger_accounts.json")) return json([
      ...chartCodes.map((c, i) => ({ id: String(200000000000000000 + i), account_id: c, name: CHART[c] ?? "Accounts payable", allowed_document_types: doc, active: true })),
      ...Object.entries(own?.glMap ?? {}).map(([code, id]) => ({ id, account_id: null, name: `${CHART[code] ?? code} (as mapped; not checked in a dry run)`, allowed_document_types: doc, active: true })),
    ]);
    if (req.method === "GET" && path.endsWith("/tax_rates.json")) return json(Object.entries(own ? own.taxRates : EXAMPLE.moneybird.taxRates).map(([code, id]) => ({ id, name: code, percentage: null, tax_rate_type: "purchase_invoice", active: true })));
    if (req.method === "GET" && path.includes("/contacts/customer_id/")) return json({ error: "record not found", symbolic: {} }, 404);
    if (req.method === "GET") return json([]);
    if (path.endsWith("/attachments.json")) return { status: 200, headers: {}, body: "200" };
    return json({ id: String(300000000000000000 + n), total_price_excl_tax: null, total_price_incl_tax: null }, 201);
  };
  if (name === "bc") return (req, n) => (req.method === "GET" ? json({ value: [] }) : req.method === "PATCH" ? json({}) : req.url.endsWith("Microsoft.NAV.post") ? { status: 204, headers: {}, body: "" } : json({ id: `dry-run-${n}`, "@odata.etag": "W/\"dry\"" }, 201));
  return (req, n) => {
    const body = typeof req.body === "string" ? req.body : "";
    // common.version: a dry run asks no server, so it prints Odoo 18's request shapes (memo on a payment; 17 uses ref).
    if (req.url.endsWith("/common")) return body.includes("<methodName>version</methodName>") ? xml({ server_version: "18.0", server_version_info: [18, 0, 0, "final", 0, ""] }) : xml(1);
    if (body.includes("<string>account.account</string>") && body.includes("search_read")) return xml(chartCodes.map((c, i) => ({ id: 100 + i, code: c, name: CHART[c] ?? "Accounts payable" })));
    if (body.includes("<string>res.currency</string>")) return xml([1]);
    if (body.includes("<string>search</string>") || body.includes("<string>search_read</string>")) return xml([]);
    if (body.includes("<string>create</string>")) return xml(1000 + n);
    return xml(true);
  };
}

/** A connector that sends nothing, with the requests it would have sent in `transport.sent`. */
export function dryRunConnector(name: ConnectorName, env: Env): { connector: ErpConnector; transport: RecordingTransport; usesExampleSettings: boolean } {
  // The customer's own settings when they are all there (the token step is a placeholder; totals are not compared, since
  // nothing computed them), else the example settings.
  const own = missingSettings(name, env).length === 0;
  const ownMoneybird = own && name === "moneybird" ? moneybirdConfigFromEnv(env) : undefined;
  const transport = new RecordingTransport(dryAnswer(name, ownMoneybird));
  const connector = name === "exact" ? new ExactConnector(own ? exactFromEnv(env) : EXAMPLE.exact, transport, staticToken())
    : name === "moneybird" ? new MoneybirdConnector({ ...(ownMoneybird ?? EXAMPLE.moneybird), verifyTotals: false }, transport, staticToken())
    : name === "bc" ? new BusinessCentralConnector({ ...(own ? bcConfigFromEnv(env) : EXAMPLE.bc), verifyTotals: false }, transport, staticToken())
      : new OdooConnector({ ...(own ? odooConfigFromEnv(env) : EXAMPLE.odoo), verifyTotals: false }, transport);
  return { connector, transport, usesExampleSettings: !own };
}
