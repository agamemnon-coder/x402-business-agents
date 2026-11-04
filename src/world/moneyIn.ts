// `npm run world -- money-in`: the day's sales have settled on Metal; the Treasury agent hears what came in (a running
// total of net earnings, not new money). Shared with the blind holdouts' simulated worlds, so both say the same words.

import type { DB } from "../db/open.js";
import { netEarnings } from "../agents/sweep.js";
import { fromCents } from "../lib/money.js";

export function metalMoneyIn(db: DB): { payload: { text: string }; sold: number; netCents: number } {
  const e = netEarnings(db);
  const sold = (db.prepare("SELECT COUNT(*) AS n FROM sales WHERE status = 'DELIVERED'").get() as { n: number }).n;
  const netCents = Math.max(0, e.netCents);
  return { payload: { text: `The day's sales have settled on Metal: ${sold} stock checks sold for ${fromCents(e.revenueCents)}; net earnings ${fromCents(netCents)} sit on the business account, not yet swept to Airwallex.` }, sold, netCents };
}
