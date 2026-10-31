// Scenario S1, the supplier price rise, live on Metal testnet.
//   npm run s1:raise   supplier moves to 0.04; the next purchase is refused on chain; the treasury proposes
//   npm run approve -- <id> <prefix>   a person approves one option; mandates are replaced
//   npm run s1:resume  the old credential is refused as revoked; sales resume at the approved price

import { approvalHint } from "./hint.js";
import { resolve } from "node:path";
import { crossCheckNotice } from "../agents/notices.js";
import { attachReview } from "../claude/review.js";
import { Tools } from "../claude/tools.js";
import { mandatesNow, priceRiseContext, proposePriceRise, type MandateReplaceTerms } from "../agents/treasury.js";
import { designPriceRise } from "../agents/treasuryAgent.js";
import { agentsOn } from "../agents/loop.js";
import { meetPriceRise } from "../agents/sourcingAgent.js";
import { RAISED_UPSTREAM_PRICE_CENTS, type Agent } from "../config/policy.js";
import { openDb } from "../db/open.js";
import { baseUnitsToCents, fromCents, toCents } from "../lib/money.js";
import { metalAgent } from "../metal/agentCli.js";
import { activeMandate, credentialFiles, loadCredentialFile, mandateSpent } from "../metal/mandate.js";
import { EXPLORER_TX } from "../metal/network.js";
import { liveOfferCents } from "../metal/offer.js";
import { SUPPLIER_ROUTE } from "../servers/supplier.js";
import { sellPrice, startRuntime } from "../world/runtime.js";
import { setSetting } from "../world/settings.js";
import { readFileSync } from "node:fs";

const phase = process.argv[2];
const db = openDb();
const rt = await startRuntime(db);
const supplierUrl = `http://127.0.0.1:4101${SUPPLIER_ROUTE}?seq=1`;
/** The next stock check to sell: one past the highest stock check already delivered. */
const nextSeq = () =>
  ((db.prepare("SELECT MAX(CAST(json_extract(request_params_json, '$.seq') AS INTEGER)) AS s FROM sales").get() as { s: number | null }).s ?? 0) + 1;

try {
  if (phase === "raise") {
    console.log(`GOAL             keep selling stock checks at a margin, inside the 20.00 the mandates may spend`);
    setSetting(db, "system", "upstream_price", fromCents(RAISED_UPSTREAM_PRICE_CENTS));
    const noticePath = resolve(import.meta.dirname, "../../fixtures/stockline-price-notice.txt");
    const tools = new Tools(db);
    const noticeText = readFileSync(noticePath, "utf8");
    const kind = await tools.classify(noticeText);
    if (kind.value.kind !== "price_notice") throw new Error(`escalate: expected a price notice, ${kind.source} read ${kind.value.kind}`);
    const read = await tools.priceNotice(noticeText);
    const notice = read.value;
    console.log(`                 read by ${read.source === "claude" ? `${kind.model} (classify) and ${read.model} (extract)` : `the deterministic parser (${read.note})`}`);
    const live = await liveOfferCents(supplierUrl);
    const check = crossCheckNotice(notice, live.cents);
    console.log(`NEW INFORMATION  ${notice.supplier} raises its price ${notice.old_price} -> ${notice.new_price}; live offer ${fromCents(live.cents)} (${check.ok ? "matches" : check.reason})`);
    if (!check.ok) throw new Error(`escalate: ${check.reason}`);

    // The next customer query: Sourcing buys its stock check upstream under the mandate, and Metal decides.
    let served: { seq: number; p: Awaited<ReturnType<typeof rt.customer.buy>>; refusal: { id: number; refusal_reason: string } | undefined } | null = null;
    const serveNext = async () => {
      const seq = nextSeq();
      const p = await rt.customer.buy(seq);
      const refusal = db.prepare("SELECT id, refusal_reason FROM upstream_purchases WHERE outcome = 'REFUSED' ORDER BY id DESC LIMIT 1").get() as { id: number; refusal_reason: string } | undefined;
      served = { seq, p, refusal };
      return served;
    };
    // With KIT11_AGENTS=on the Sourcing agent meets the price rise itself (src/agents/sourcingAgent.ts).
    let sourcingMessage = "";
    if (agentsOn()) {
      const met = await meetPriceRise(db, { oldCents: toCents(notice.old_price), noticeCents: toCents(notice.new_price) }, {
        offer: async () => {
          const m = (await mandatesNow()).get("sourcing")!.now;
          return { liveCents: (await liveOfferCents(supplierUrl)).cents, capCents: m.capCents, budgetLeftCents: m.budgetCents - m.spentCents };
        },
        tryPurchase: async () => {
          const r = await serveNext();
          return { seq: r.seq, refused: r.refusal?.refusal_reason ?? null, charged: r.p.charged === true };
        },
        notify: (m) => { sourcingMessage = m; },
      });
      console.log(`SOURCING AGENT   ${met.source === "claude" ? `${met.run.model}: tried stock check #${met.seq}, ${met.refusal ? "refused by Metal" : "bought"}` : "not available; code serves the next query"}`);
      if (met.message) console.log(`                 to Treasury: "${met.message}"`);
    }
    const { seq, p, refusal } = served ?? (await serveNext());
    console.log(`                 stock check #${seq}: sourcing purchase ${refusal ? `refused: ${refusal.refusal_reason}` : "NOT refused"}`);
    console.log(`                 customer: ${p.outcome.kind === "paid" ? "PAID (unexpected)" : `HTTP ${p.outcome.kind === "in_doubt" || p.outcome.kind === "refused" ? p.outcome.status : "?"}, charged: ${p.charged ? "YES" : "no (not in /settlements)"}`}`);
    if (!refusal || p.charged) throw new Error("expected a refusal and no charge");

    // The Treasury agent designs the answer (Opus, with a tool); code checks the plan before it can reach the CFO.
    // Off (KIT11_AGENTS not "on"), code's fixed plan as in every recorded run.
    const sellCents = toCents(sellPrice(db));
    const design = agentsOn() ? await designPriceRise(db, {
      sellCents, oldUpstreamCents: toCents(notice.old_price), newUpstreamCents: live.cents, refusal: refusal.refusal_reason, ...(sourcingMessage ? { sourcingMessage } : {}),
      mandates: [...(await mandatesNow()).values()].map((c) => c.now),
    }) : null;
    if (design) {
      console.log(`TREASURY AGENT   ${design.source === "claude" ? `${design.run.model}: plan accepted by code after ${design.attempts} ${design.attempts === 1 ? "try" : "tries"}` : `code's fixed plan (${design.note})`}`);
      for (const c of design.run.calls.filter((x) => x.blocked)) console.log(`                 refused by code: ${c.text.slice(0, 300)}`);
      if (design.plan.advice) console.log(`                 "${design.plan.advice}"`);
    }
    const proposals = await proposePriceRise(db, rt.addr, sellCents, { noticePath, liveOfferCents: live.cents, refusal: { purchaseId: refusal.id, reason: refusal.refusal_reason } }, new Date(), design?.plan);
    console.log(`PLAN             options for the approver (limits stay within 20.00):`);
    for (const pr of proposals) {
      const t = JSON.parse(pr.terms_json) as MandateReplaceTerms;
      console.log(`                 ${pr.proposal_id}  option ${t.option}: sell ${t.query_price}, margin ${t.margin}; ${t.steps.map((s) => `${s.agent} cap ${s.cap} budget ${s.budget}`).join("; ")}`);
      console.log(`                          sha256 ${pr.terms_sha256}`);
    }
    console.log(`                 option C: pause sales (approve nothing)`);
    for (const pr of proposals) {
      const steps = (JSON.parse(pr.terms_json) as MandateReplaceTerms).steps.map((st) => st.agent as Agent);
      const r = await attachReview(db, tools, pr, await priceRiseContext(rt.addr, toCents(sellPrice(db)), notice.old_price, live.cents, refusal.refusal_reason, steps));
      console.log(`REVIEW           ${pr.proposal_id}: ${r.recommendation} (${r.source === "claude" ? "Opus, advisory" : "no model"}): ${r.summary}`);
    }
    console.log(`\nNext: npm run proposals, then ${approvalHint(db)}`);
  } else if (phase === "resume") {
    const done = db.prepare("SELECT terms_json, proposal_id FROM proposals WHERE kind = 'mandate_replace' AND status = 'EXECUTED' ORDER BY created_at DESC LIMIT 1").get() as { terms_json: string; proposal_id: string } | undefined;
    if (!done) throw new Error("no executed mandate change; approve one first");
    const terms = JSON.parse(done.terms_json) as MandateReplaceTerms;
    console.log(`REVISED DECISION ${done.proposal_id} option ${terms.option}: sell ${terms.query_price}, ${terms.steps.map((s) => `${s.agent} cap ${s.cap} budget ${s.budget}`).join("; ")}`);

    const sourcingStep = terms.steps.find((s) => s.agent === "sourcing");
    if (sourcingStep) {
      const old = credentialFiles("sourcing").map((f) => loadCredentialFile("sourcing", f)).find((m) => m.credentialHash === sourcingStep.replaces_credential_hash)!;
      const r = metalAgent(["mandate", "pull", "--credential", old.credentialPath, "--mandate-key-file", old.keyFile, "--to", rt.addr.supplier, "--amount", "0.01", "--payment-id", `revoked-check-${done.proposal_id}`], [0, 1]);
      console.log(`                 old sourcing credential: ${r.code === 1 ? "refused" : "PAID (unexpected)"}: ${r.fields.get("reason")?.[0] ?? r.fields.get("outcome")?.[0] ?? r.out.trim().split("\n").at(-1)}`);
    }
    rt.sourcing.reload();
    const from = nextSeq();
    let revenue = 0, cost = 0;
    for (let seq = from; seq < from + 10; seq++) {
      const p = await rt.customer.buy(seq);
      if (p.outcome.kind !== "paid") { console.log(`sale  #${seq}  ${p.outcome.kind}: ${p.outcome.reason}`); continue; }
      revenue += baseUnitsToCents(BigInt(p.outcome.amount));
      cost += toCents(terms.upstream_price);
      console.log(`sale  #${seq}  paid ${fromCents(baseUnitsToCents(BigInt(p.outcome.amount)))}  ${EXPLORER_TX}${p.outcome.tx}`);
    }
    const spends = [];
    for (const a of ["sourcing", "support", "treasury"] as const) {
      const m = await activeMandate(a);
      spends.push(`${a} ${fromCents(baseUnitsToCents(await mandateSpent(m)))}`);
    }
    console.log(`RESULT           10 sales: revenue ${fromCents(revenue)}, upstream ${fromCents(cost)}, margin ${fromCents(revenue - cost)}; spent: ${spends.join(", ")}`);
  } else {
    console.error("usage: tsx src/cli/s1.ts raise|resume");
    process.exitCode = 2;
  }
} finally {
  await rt.close();
}
