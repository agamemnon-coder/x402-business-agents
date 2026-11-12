// Where the company's accounting links stand, for the console's "Koppelingen" card (GET /v1/integrations). The cloud
// holds no ERP credential and calls no ERP: the runner's ERP sync (src/erp/sync.ts) writes every result into the audit
// log ("erp.pushed", "erp.found_existing", "erp.push_failed", "erp.needs_review", ...; subject "<connector>:<kind>:<id>"),
// and the runner pushes that log here. A dry run writes nothing, so a link reads "connected" only after a live sync.
// Per object only its newest result counts: a failure fixed by a later push no longer counts as a failure.

import type { Sql } from "./store.js";

/** The links the console shows, in its order. Moneybird first: it is the first accounting link for small companies. */
export const INTEGRATIONS = ["moneybird"] as const;
export type Integration = (typeof INTEGRATIONS)[number];

export interface IntegrationStatus {
  connector: Integration;
  /** not_connected: nothing sent yet; connected: the newest result of every object is good; attention: something failed or waits for a person. */
  status: "not_connected" | "connected" | "attention";
  last_sync_at: string | null;
  /** Objects in the ERP as Purser sent them (newest result pushed, found, resolved or corrected). */
  sent: number;
  /** Objects whose newest result is a failure (push_failed, invalid). */
  failed: number;
  /** Objects a person must look at in the ERP (needs_review, needs_correction). */
  to_check: number;
  /** The newest failure's reason, shortened; null when nothing fails. */
  last_error: string | null;
}

const GOOD = new Set(["erp.pushed", "erp.found_existing", "erp.resolved", "erp.corrected"]);
const BAD = new Set(["erp.push_failed", "erp.invalid"]);
const CHECK = new Set(["erp.needs_review", "erp.needs_correction"]);

export async function integrations(sql: Sql, tenantId: string): Promise<{ connectors: IntegrationStatus[] }> {
  const out: IntegrationStatus[] = [];
  for (const connector of INTEGRATIONS) {
    // Newest first; the subject starts with the connector's name. Bounded: the card needs the recent state only.
    const rows = await sql.all<{ ts: string; event: string; subject: string | null; payload_json: string }>(
      "SELECT ts, event, subject, payload_json FROM audit_rows WHERE tenant_id = ? AND event LIKE 'erp.%' AND subject LIKE ? ORDER BY seq DESC LIMIT 5000",
      [tenantId, `${connector}:%`],
    );
    const newest = new Map<string, { event: string; payload_json: string }>();
    for (const r of rows) if (r.subject && !newest.has(r.subject)) newest.set(r.subject, r);
    let sent = 0;
    let failed = 0;
    let toCheck = 0;
    let lastError: string | null = null;
    for (const r of newest.values()) {
      if (GOOD.has(r.event)) sent++;
      else if (CHECK.has(r.event)) toCheck++;
      else if (BAD.has(r.event)) {
        failed++;
        if (lastError === null) {
          let p: { error?: unknown; reason?: unknown } = {};
          try { p = JSON.parse(r.payload_json) as typeof p; } catch { /* kept as unknown */ }
          lastError = String(p.error ?? p.reason ?? r.event).slice(0, 300);
        }
      }
    }
    out.push({
      connector, status: rows.length === 0 ? "not_connected" : failed + toCheck > 0 ? "attention" : "connected",
      last_sync_at: rows[0]?.ts ?? null, sent, failed, to_check: toCheck, last_error: lastError,
    });
  }
  return { connectors: out };
}
