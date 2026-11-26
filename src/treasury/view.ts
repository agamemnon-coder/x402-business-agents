// What the runner's dashboard shows of the money loop (GET /api/treasury on the local dashboard, src/servers/dashboard.ts):
// the 13-week forecast from the ledger (labelled a forecast), FX exposure per currency against the CFO's floors, and the
// receivables: aged debtors, the payments waiting for a person, and the reminder drafts. Read-only; no rate is read here
// (that is `npm run treasury -- fx`, which asks Airwallex), so no conversion is suggested on this view.

import type { DB } from "../db/open.js";
import { agedDebtors, reviewQueue } from "../receivables/ar.js";
import { fxThresholdCents, ledgerForecast } from "./advisor.js";
import type { Forecast } from "./forecastCore.js";
import { fxExposure, type Exposure } from "./fxCore.js";

export interface TreasuryView {
  label: string;
  forecast: Forecast;
  exposures: Exposure[];
  fx_threshold_eur: string | null;
  receivables: { aged: ReturnType<typeof agedDebtors>; review: ReturnType<typeof reviewQueue>; reminders_drafted: number };
}

export function treasuryView(db: DB, now: Date): TreasuryView {
  const asOf = now.toISOString().slice(0, 10);
  const forecast = ledgerForecast(db, asOf);
  const t = fxThresholdCents(db);
  return {
    label: "A forecast from the ledger (test money, Airwallex sandbox): not a promise of cash.",
    forecast, exposures: fxExposure(forecast), fx_threshold_eur: t === null ? null : (t / 100).toFixed(2),
    receivables: {
      aged: agedDebtors(db, asOf), review: reviewQueue(db),
      reminders_drafted: (db.prepare("SELECT COUNT(*) AS n FROM ar_dunning").get() as { n: number }).n,
    },
  };
}
