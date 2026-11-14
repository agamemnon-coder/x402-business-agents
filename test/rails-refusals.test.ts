// The CFO dashboard's Metal line about refusals counts only real refusals over the mandate's cap, split into "refused
// by Purser before signing" and "recorded by Metal on chain". A purchase the Sourcing agent chose not to make (its buy
// policy) is not a cap refusal, and a payment Metal refused because the old mandate was revoked is said apart. Checked
// against agent run 1's own rows (docs/demo/agent-run.json, ledger), replayed into an empty ledger.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { railsView } from "../src/dashboard/rails.js";
import type { RunLedger } from "../src/demo/runLedger.js";

const rec = JSON.parse(readFileSync(new URL("../docs/demo/agent-run.json", import.meta.url), "utf8")) as { ledger: RunLedger; snapshot: { rails: { metal: { what: string; detail: string }[] } } };

function replay(events: string[]) {
  const db = openDb(":memory:");
  const ins = db.prepare("INSERT INTO audit_log (seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, '', ?)");
  for (const r of rec.ledger.events.filter((x) => events.includes(x.event))) ins.run(r.seq, r.ts, r.actor, r.event, r.subject, JSON.stringify(r.payload), `replayed-${r.seq}`);
  return db;
}

describe("the dashboard's refusal line (agent run 1)", () => {
  it("has the run's refusal rows: one over the cap refused by Purser, five buy-policy holds, one revoked mandate, one recorded on chain", () => {
    const refused = rec.ledger.events.filter((r) => r.event === "upstream.refused");
    expect(refused).toHaveLength(7);
    expect(refused.filter((r) => /^mandate_cap_exceeded/.test(String(r.payload.reason)))).toHaveLength(1);
    expect(rec.ledger.events.filter((r) => r.event === "upstream.refused_on_chain")).toHaveLength(1);
  });

  it("counts only the refusals over the cap: 1 refused by Purser before signing, 1 recorded by Alta on chain", () => {
    const m = railsView(replay(["upstream.refused", "upstream.refused_on_chain"])).metal;
    const cap = m.find((x) => /over the mandate's cap/i.test(x.what))!;
    expect(cap.detail).toMatch(/^1 refused by Purser before signing, 1 recorded by Alta on chain/);
    expect(cap.proof?.href).toMatch(/0x3ad8de2f1a4896567f089786438418f0bf3be0d2c61807a9f157b89ed7d9a84d$/);
    expect(m.map((x) => x.detail).join(" ")).not.toMatch(/\b7 payments\b/);
    // Alta's own refusal of a payment under the revoked mandate is its own line, not a cap refusal.
    expect(m.find((x) => /revoked/i.test(x.what))?.detail).toMatch(/^1 payment/);
  });

  it("is what the committed record shows", () => {
    const line = rec.snapshot.rails.metal.find((x) => /over the mandate's cap/i.test(x.what));
    expect(line?.detail).toMatch(/^1 refused by Purser before signing, 1 recorded by Metal on chain/);
    expect(rec.snapshot.rails.metal.map((x) => x.detail).join(" ")).not.toMatch(/\b7 payments over the mandate's cap/);
  });
});
