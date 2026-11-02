// What Max sees on the dashboard while Airwallex refuses a payout for its fee configuration and Purser retries it (agent
// run 1: P-0005 failed on one fee_unknown and the feed said only "transfer.refused"), and after: a refusal, a close by
// his command, an alarm. Breaks if a line hides the trace id, says money moved when none did, or an alarm is not red.
import { describe, expect, it } from "vitest";
import { REFUSAL_EVENTS, describe as describeFeed } from "../src/dashboard/snapshot.js";

const RID = "bc1aca54-1629-401d-8693-e460d5a5c9ff";
const row = (event: string, payload: Record<string, unknown>, subject = RID) =>
  ({ seq: 1, ts: "2026-11-02T11:01:41.000Z", actor: "awx-executor", event, subject, payload_json: JSON.stringify(payload), prev_hash: "", row_hash: "" }) as never;
const feed = (event: string, payload: Record<string, unknown>, subject?: string) => describeFeed(row(event, payload, subject), () => undefined);

describe("the dashboard while the payout is retried and after", () => {
  it("a refused attempt with a next one: says what we do (the code, the trace id, when it is retried, under the same request_id), not a promise", () => {
    const f = feed("transfer.retry", { attempt: 1, code: "fee_unknown", trace_id: "6f1c2a9e4b7d3c10", amount: "EUR 240.00", next_attempt_in_s: 15, stopped: null });
    expect(f.text).toBe("Airwallex refused attempt 1 of the EUR 240.00 payout (fee_unknown, trace 6f1c2a9e4b7d3c10). Retried in 15 s under the same request_id; Airwallex refused each attempt so far");
    expect(f.text).not.toMatch(/cannot pay twice/);
    expect(f.tone).toBe("info");
  });

  it("the last refused attempt says why no further one is made", () => {
    expect(feed("transfer.retry", { attempt: 6, code: "fee_unknown", trace_id: null, amount: "EUR 240.00", next_attempt_in_s: null, stopped: "no attempts left (6 made)" }).text)
      .toBe("Airwallex refused attempt 6 of the EUR 240.00 payout (fee_unknown). No further attempt: no attempts left (6 made)");
    expect(feed("transfer.left_open", { attempts: 6, amount: "EUR 240.00", reason: "the look-up by request_id after 6 attempts failed: timeout" })).toMatchObject({
      tone: "refusal", text: "Airwallex refused the EUR 240.00 payout 6 times, but it could not be shown that nothing exists under its request_id (the look-up by request_id after 6 attempts failed: timeout); the payout stays under way until a person checks it",
    });
    expect(feed("transfer.retry_stopped", { after_attempt: 2, reason: "the treasury agent is paused by the CFO" }).text)
      .toBe("The payout's retries stopped after attempt 2: the treasury agent is paused by the CFO; nothing was paid");
  });

  it("the refusal, the close by the CFO's command and the alarms are shown as refusals, in plain words", () => {
    const refused = feed("transfer.refused", { code: "fee_unknown", amount: "EUR 240.00", trace_id: "6f1c2a9e4b7d3c10", attempts: 6 });
    expect(refused).toMatchObject({ text: "Airwallex refused the EUR 240.00 payout (fee_unknown, trace 6f1c2a9e4b7d3c10) after 6 attempts; nothing was paid and the payout is closed. A new proposal with Face ID pays the invoice", tone: "refusal" });
    expect(feed("transfer.closed_unsent", { invoice_no: "SLL-2026-11", amount: "EUR 240.00", proposal_id: "P-0005" }).text)
      .toBe("Payout of invoice SLL-2026-11 (EUR 240.00, P-0005) closed by your command: Airwallex holds no transfer under it; the invoice can be proposed again");
    expect(feed("transfer.row_conflict", { request_id: RID, row_status: "CANCELLED", amount: "EUR 240.00" }, "tr-1")).toMatchObject({ tone: "refusal", text: expect.stringMatching(/^Alarm: Airwallex holds transfer tr-1 .*CANCELLED.*a person checks it now/) });
    expect(feed("transfer.found_after_close", { request_id: RID, invoice_no: "SLL-2026-11", amount: "EUR 240.00", status: "PAID" }, "tr-1")).toMatchObject({ tone: "refusal", text: expect.stringMatching(/^Alarm: Airwallex holds transfer tr-1 \(EUR 240\.00, PAID\).*SLL-2026-11/) });
    for (const e of ["transfer.refused", "transfer.row_conflict", "transfer.found_after_close", "transfer.left_open"]) expect(REFUSAL_EVENTS.has(e), e).toBe(true);
  });
});
