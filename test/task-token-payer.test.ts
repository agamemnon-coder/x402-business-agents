// The Payer pays on its task token (governance round, 26 Nov): payApInvoice took agents.taskToken, but nothing passed
// one, so a payment the runner's autopilot paid alone stood on whatever mandate fit, not on the one the CFO handed the
// agent. Now the autopilot carries the agent's token (AutopilotDeps.taskToken; the CLI reads KIT11_TASK_TOKEN) into
// every payment it plans. End to end, on the stand-in bank (test money): the CFO grants a task mandate with the passkey,
// a token is issued for it, the autopilot pays an invoice inside the mandate alone, standing on that token, and an
// invoice outside it is refused, recorded, and waits for the CFO's Face ID.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drain, type AutopilotDeps } from "../src/ap/autopilot.js";
import { apInvoices } from "../src/ap/store.js";
import type { DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { setSystemDefaultAloneLimit } from "../src/policy/aloneLimit.js";
import type { TaskMandate } from "../src/policy/taskMandateCore.js";
import { grantChange, mandateInForce } from "../src/policy/taskMandates.js";
import { issueTaskToken } from "../src/policy/taskTokens.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { world } from "./support/rt4World.js";

const NOW = new Date("2026-11-10T09:00:00Z");
const RP = "purser.example", ORIGIN = `https://${RP}`;
let tickets = 0, counter = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: NOW.toISOString() });
const STOCKLINE = readFileSync(new URL("../fixtures/stockline-licence-SLL-2026-11.txt", import.meta.url), "utf8");

const MANDATE: TaskMandate = {
  agent: "treasury", purpose: "November Bergtex invoices", kinds: ["invoice_payment", "supplier_payment"], invoice_month: "2026-11",
  currency: "EUR", total: "2000.00", payees: ["Bergtex Textil GmbH"], from: "2026-11-01", until: "2026-11-30", status: "active",
};

// The executors read the clock: it is held at the day the invoices are of (the sample falls due 16 Nov 2026).
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });
const rows = (db: DB, event: string, subject: string) =>
  (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq").all(event, subject) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);

describe("the autopilot pays on the agent's task token", () => {
  it("grant with the passkey, issue a token: inside the mandate the agent pays alone on it; outside it is refused", async () => {
    const w = await world(NOW);
    const db = w.db;
    setSystemDefaultAloneLimit(db, "2000.00", NOW);
    // The CFO's passkey, then the grant: a policy change of task_mandate.nov-bergtex, signed on the phone and run.
    const phone = new FakeAuthenticator();
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, NOW);
    expect((await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, NOW)).status).toBe("pending");
    confirmPasskey(db, fingerprintOf(phone.spkiSha256), NOW);
    const grant = proposePolicyChange(db, { changes: [grantChange("nov-bergtex", MANDATE)], reason: "task mandate nov-bergtex" }, "human", NOW);
    const signed = item("assertion", { proposal_id: grant.proposal_id, terms_sha256: grant.terms_sha256, credential: phone.sign({ challenge: challengeFor(grant.terms_sha256), origin: ORIGIN, rpId: RP, counter: ++counter }) }, grant.proposal_id);
    expect((await processAssertion(db, signed, NOW)).status).toBe("approved");
    executePolicyChange(db, grant.proposal_id, NOW);
    expect(mandateInForce(db, "nov-bergtex")).not.toBeNull();
    const token = issueTaskToken(db, "nov-bergtex", NOW);

    const inside = await w.add(EN, "bergtex-21.pdf"); // Bergtex, EUR 1,850.00, an invoice of November
    const outside = await w.add(STOCKLINE, "stockline.pdf"); // Stockline: a payee the mandate does not name
    const executed: string[] = [];
    const deps: AutopilotDeps = {
      inbox: w.deps, folders: [], rail: w.awx, now: () => NOW, taskToken: token.token, owner: { id: "test", pid: process.pid, host: "test" },
      execute: async (d, id) => {
        const { kind } = d.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(id) as { kind: string };
        if (kind === "invoice_payment") await executeInvoicePayment(d, w.awx, w.awx, id);
        else await executeSupplierPayment(d, w.awx, w.awx, id);
        executed.push(id);
      },
    };

    await drain(db, deps);
    const inv = (id: string) => apInvoices(db).find((i) => i.id === id)!;
    // Inside: approved by code within the limit, standing on the mandate the token carries, and run.
    const paid = inv(inside);
    expect(paid.proposal_id).toBeTruthy();
    expect(rows(db, "proposal.within_limit", paid.proposal_id!)).toEqual([expect.objectContaining({ mandate: "nov-bergtex", task_token: token.token_id })]);
    expect(executed).toContain(paid.proposal_id);
    // Outside: refused under the token's mandate, recorded, and filed for the CFO's Face ID; nothing ran.
    const waits = inv(outside);
    expect(waits.status).toBe("waiting_cfo");
    expect(rows(db, "proposal.within_limit", waits.proposal_id!)).toEqual([]);
    expect(rows(db, "task_mandate.refused", waits.proposal_id!)).toEqual([expect.objectContaining({ mandate: "nov-bergtex", code: "mandate_payee" })]);
    expect(executed).not.toContain(waits.proposal_id);
    // The token is never written to the record: only its id.
    expect(JSON.stringify(db.prepare("SELECT payload_json FROM audit_log").all())).not.toContain(token.token);
  });
});
