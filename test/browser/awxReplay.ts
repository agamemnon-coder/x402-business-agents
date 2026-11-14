// For the browser checks only: the webhooks Airwallex sent during the recorded run of 7 Nov (docs/demo/airwallex-run.json,
// "webhooks"), replayed through the relay's own webhook route with a test secret, each at its recorded time. Their event
// ids, types, object ids and times are the record's; nothing is made up. The relay then keeps what it keeps for any
// verified event (worker/src/awxEvents.ts), and its public feed answers as on the live site.
import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { sqlOver } from "../../src/relay/local.js";
import { Relay } from "../../worker/src/core.js";

const SECRET = ["whsec", "replay", "r".repeat(24)].join("_");

export async function replayedRelay(): Promise<Relay> {
  const rec = JSON.parse(readFileSync(new URL("../../docs/demo/airwallex-run.json", import.meta.url), "utf8")) as { webhooks: { event_id: string; name: string; object_id: string | null; received_at: string }[] };
  let now = new Date();
  const relay = new Relay(sqlOver(new Database(":memory:")), { relayToken: "t".repeat(64), webhookSecret: SECRET, now: () => now });
  for (const w of rec.webhooks) {
    now = new Date(w.received_at);
    const body = JSON.stringify({ id: w.event_id, name: w.name, created_at: w.received_at, data: { object: { id: w.object_id } } });
    const ts = String(now.getTime());
    const r = await relay.fetch(new Request("https://relay.internal/hooks/airwallex", { method: "POST", headers: { "x-timestamp": ts, "x-signature": createHmac("sha256", SECRET).update(ts + body).digest("hex") }, body }));
    if (r.status !== 200) throw new Error(`replay refused ${w.event_id}: ${r.status}`);
  }
  now = new Date();
  return relay;
}
