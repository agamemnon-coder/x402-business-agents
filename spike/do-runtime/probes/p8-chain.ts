// SPIKE probe 8: does the engine's whole chain LOAD in workerd as it is? Each entry module of the chain is imported in
// turn (leaves first) and what its module code does at load is reported. Nothing is called: no database is opened here
// (the database layer is the other explorer's probe). The bundle of this probe is the whole engine as wrangler packs it.
import { DurableObject } from "cloudflare:workers";
import { json, steps } from "./_util.js";

export class Engine extends DurableObject {}

export default {
  async fetch(req: Request): Promise<Response> {
    const { out, step } = steps(req);
    const load = (name: string, imp: () => Promise<Record<string, unknown>>) => step(name, async () => { const m = await imp(); return `${Object.keys(m).length} exports`; });
    await load("src/lib/terms", () => import("../../../src/lib/terms.js"));
    await load("src/provenance/origin", () => import("../../../src/provenance/origin.js"));
    await load("src/audit/log", () => import("../../../src/audit/log.js"));
    await load("src/metal/agentCli", () => import("../../../src/metal/agentCli.js"));
    await load("src/world/options", () => import("../../../src/world/options.js"));
    await load("src/policy/approvals", () => import("../../../src/policy/approvals.js"));
    await load("src/agents/euroBill", () => import("../../../src/agents/euroBill.js"));
    await load("src/ap/ledgerKey", () => import("../../../src/ap/ledgerKey.js"));
    await load("src/ap/checks", () => import("../../../src/ap/checks.js"));
    await load("src/ap/books", () => import("../../../src/ap/books.js"));
    await load("src/ap/eml", () => import("../../../src/ap/eml.js"));
    await load("src/ap/scan", () => import("../../../src/ap/scan.js"));
    await load("src/ap/pdfText", () => import("../../../src/ap/pdfText.js"));
    await load("src/ap/inbox", () => import("../../../src/ap/inbox.js"));
    await load("src/ap/vendors", () => import("../../../src/ap/vendors.js"));
    await load("src/payouts/plan", () => import("../../../src/payouts/plan.js"));
    await load("src/ap/pay", () => import("../../../src/ap/pay.js"));
    await load("src/ap/batchPay", () => import("../../../src/ap/batchPay.js"));
    await load("src/passkey/process", () => import("../../../src/passkey/process.js"));
    await load("src/executors/invoicePayment", () => import("../../../src/executors/invoicePayment.js"));
    await load("src/executors/supplierPayment", () => import("../../../src/executors/supplierPayment.js"));
    await load("src/executors/index", () => import("../../../src/executors/index.js"));
    await load("src/ledger/core", () => import("../../../src/ledger/core.js"));
    await load("src/ledger/feed", () => import("../../../src/ledger/feed.js"));
    await load("src/ledger/close", () => import("../../../src/ledger/close.js"));
    await load("src/ledger/reports", () => import("../../../src/ledger/reports.js"));
    await load("src/vault/data", () => import("../../../src/vault/data.js"));
    await load("src/vault/pdf", () => import("../../../src/vault/pdf.js"));
    await load("src/vault/build", () => import("../../../src/vault/build.js"));
    await load("src/money/register", () => import("../../../src/money/register.js"));
    await load("src/ops/health", () => import("../../../src/ops/health.js"));
    await load("src/cloudsync/client", () => import("../../../src/cloudsync/client.js"));
    await load("src/claude/reader", () => import("../../../src/claude/reader.js"));
    await load("src/agents/loop", () => import("../../../src/agents/loop.js"));
    await load("src/airwallex/adapter", () => import("../../../src/airwallex/adapter.js"));
    await load("src/redteam/airwallex (the stand-in sandbox)", () => import("../../../src/redteam/airwallex.js"));
    await load("src/redteam/authenticator (the software passkey)", () => import("../../../src/redteam/authenticator.js"));
    await load("src/db/open (better-sqlite3 stubbed)", () => import("../../../src/db/open.js"));
    const failed = Object.entries(out).filter(([, v]) => !(v as { ok: boolean }).ok).map(([k]) => k);
    return json({ loaded: Object.keys(out).length - failed.length, failed, ...out });
  },
};
