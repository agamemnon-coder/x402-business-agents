// awx-1's live deps (src/awx/live.ts liveDeps) without a call to Airwallex: without keys nothing is made; the conductor
// waits in the ledger for what the runner records (a webhook, the CFO's decision) and says what did not come: a missing
// webhook is written to the audit chain, never hidden, and a proposal that ended other than EXECUTED stops the run.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { liveDeps, WAIT } from "../src/awx/live.js";
import { createProposal } from "../src/policy/approvals.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";

let db: DB;
let lines: string[];
beforeEach(() => {
  db = openDb(":memory:");
  lines = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  vi.stubEnv("AIRWALLEX_CLIENT_ID", "test-client");
  vi.stubEnv("AIRWALLEX_API_KEY", "test-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const deps = () => liveDeps(db, (l) => lines.push(l));
const proposal = (id: string, kind = "refund_batch") => createProposal(db, { terms: { schema: TERMS_SCHEMA, kind, proposal_id: id, expires_at: new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"), total: "0.15" } as Terms, createdBy: "support" }, new Date());
const setStatus = (id: string, s: string) => db.prepare("UPDATE proposals SET status = ? WHERE proposal_id = ?").run(s, id);

describe("awx-1's live deps", () => {
  it("are not made without the sandbox keys", () => {
    vi.stubEnv("AIRWALLEX_CLIENT_ID", "");
    expect(() => liveDeps(db, () => undefined)).toThrow("no Airwallex sandbox keys; nothing was called");
  });

  it("wait for a value, polling every 2 s, and say what did not happen in time", async () => {
    const d = deps();
    expect(d.agents).toBe(true);
    let n = 0;
    const got = d.waitFor("the third look", () => (++n >= 3 ? "here" : undefined), 60_000);
    await vi.advanceTimersByTimeAsync(2 * WAIT.pollMs);
    await expect(got).resolves.toBe("here");
    const never = d.waitFor("a raise", () => undefined, 5000).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await never).toBe("waited 5 s for a raise; it did not happen");
  });

  it("find a transfer's webhook in the ledger; a missing one is audited and logged, and with no card nothing is polled", async () => {
    const d = deps();
    db.prepare("INSERT INTO airwallex_events (event_id, name, object, object_id, outcome, received_at) VALUES ('evt_1', 'payout.transfer.paid', 'transfer', 'tr_1', 'recorded', '2026-11-20T10:00:00Z')").run();
    await d.awaitWebhooks({ transfers: ["tr_1"] });
    expect(lines).toEqual([]);
    const missing = d.awaitWebhooks({ transfers: ["tr_2"] });
    await vi.advanceTimersByTimeAsync(WAIT.webhookMs + WAIT.pollMs * 2);
    await missing;
    expect(lines).toEqual([expect.stringMatching(/^WEBHOOK MISSING {2}waited 120 s for Airwallex's webhooks for tr_2; it did not happen; polling the cards once$/)]);
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'awx1.webhook_missing'").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ ids: { transfers: ["tr_2"] } });
  });

  it("wait for the CFO's decision and its execution; anything else than EXECUTED stops the run", async () => {
    const d = deps();
    proposal("P-0001");
    const ok = d.approve("P-0001");
    await vi.advanceTimersByTimeAsync(WAIT.pollMs);
    setStatus("P-0001", "EXECUTED");
    await vi.advanceTimersByTimeAsync(WAIT.pollMs);
    await expect(ok).resolves.toBeUndefined();
    expect(lines[0]).toMatch(/^FACE ID {10}/);

    proposal("P-0002", "invoice_payment");
    setStatus("P-0002", "REJECTED");
    await expect(d.approve("P-0002")).rejects.toThrow("P-0002 ended REJECTED");
  });

  it("an invoice waits 20 minutes for the CFO, a raise an hour", async () => {
    const d = deps();
    proposal("P-0003", "invoice_payment");
    const late = d.approve("P-0003").catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(WAIT.invoiceMs + WAIT.pollMs * 2);
    expect(await late).toBe("waited 1200 s for P-0003 to be decided and executed; it did not happen");
  });
});
