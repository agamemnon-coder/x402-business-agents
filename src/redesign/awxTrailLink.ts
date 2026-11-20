// The link to /airwallex/calls that /airwallex and /proof carry (15 Nov), its counts computed from the run records
// (src/airwallex/apiTrail.ts). No record, no calls: no link.

import { apiTrail } from "../airwallex/apiTrail.js";
import { esc, icon } from "./ui.js";

export function trailLinkHtml(): string {
  const t = apiTrail();
  if (!t.calls) return "";
  const ok = t.checks.transfers.total && t.checks.transfers.match === t.checks.transfers.total ? ", every transfer's hash checked" : "";
  // Its records (data-rec): every run record the count sums (npm run airwallex-trail prints the same count).
  const recs = [...new Set(t.runs.flatMap((r) => [r.record, ...r.alsoReads]))].join(" ");
  return `<p class="awc-link" data-rec="${esc(recs)}"><a class="pf" href="airwallex/calls">${icon("file-text", 16)}${esc(`All ${t.calls} Airwallex API calls${ok}`)}</a></p>`;
}
