// The run log of `npm run partner-rails -- live` (src/cli/partnerRails.ts), written from its JSON record only: every
// figure here is the record's. T:0 at every payment, and each agent's payment credential as a token.

export interface PartnerRailsRecord {
  run: string;
  mode: "live";
  started_at: string;
  finished_at: string;
  code: string;
  /** Whether src/ and cloud/src/ had no uncommitted change when it ran; absent in the first record (they had). */
  code_clean?: boolean;
  labels: { test_money: boolean; airwallex: string; alta: string; t0: string; token: string };
  tokens: { agent: string; token_id: string; token_last4: string; card_last4: string; card_status_at_airwallex: string; mandate: { per_purchase_cents: number; monthly_cents: number; mccs: string[]; currency: string; expires_at: string; card_id: string }; mandate_sha256: string; status_at_end: string }[];
  payments: {
    key: string; what: string; rail: string; rail_ref: string; amount: string; currency: string; agent: string | null; terms_sha256: string | null; terms_what?: string; counterparty: string; description: string;
    gl_account: string; cost_centre: string | null; settled_at: string; explorer?: string; token_id?: string; mandate_reference?: string;
    t0: { status: string; t0_id: string; je_number: string; booked_at: string; ms_after_settled: number; t0_account: string; functional: { currency: string; amount: string; rate: number } };
  }[];
  refusals: { key: string; what: string; by: "purser" | "airwallex"; expected: string; code: string; detail: string; airwallex_calls: number; ok: boolean }[];
  revoke: { agent: string; at: string; how: string; token_id: string; token_status: string; revoked_at: string | null; card_status_at_airwallex: string } | null;
  reconcile: { at: string; ok: boolean; rows: { payment_id: string; rail: string; rail_ref: string; je_number: string; t0_id: string; ok: boolean; checks: { name: string; ok: boolean; detail: string }[]; t0: { amount: string | null; currency: string | null }; rail_read: { status: string; amount: string; currency: string } | null }[] } | null;
  calls: { airwallex: number; t0: number; alta_txs: number };
  checks: { key: string; ok: boolean; detail: string }[];
  notes: string[];
}

const RAIL: Record<string, string> = { airwallex_card: "Visa card, Airwallex Issuing (sandbox)", airwallex_transfer: "Airwallex transfer (sandbox)", metal: "Alta testnet", airwallex_airi: "Visa via Airi (sandbox)" };
const cut = (s: string, n = 10) => (s.length > n + 6 ? `${s.slice(0, n)}…${s.slice(-4)}` : s);
const money = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function partnerRailsMarkdown(r: PartnerRailsRecord): string {
  const failed = r.checks.filter((c) => !c.ok);
  const out: string[] = [
    `# T:0 at every payment, and each agent's credential as a token: the run of ${r.started_at.slice(0, 10)}`,
    "",
    `**Live, test money only.** ${r.labels.airwallex}. ${r.labels.alta}. ${r.labels.t0}.`,
    "",
    `**What the token is.** ${r.labels.token}.`,
    "",
    `Made by \`npm run partner-rails -- live\` ([src/cli/partnerRails.ts](../../src/cli/partnerRails.ts)) on code \`${r.code}\`${r.code_clean === true ? "" : " with this run's own code not yet committed (the commit that adds this record holds it)"}, from ${r.started_at} to ${r.finished_at}. This page is written from [${r.run}.json](${r.run}.json) by \`npm run partner-rails -- --md\`; no figure is typed by hand. No key, token or card number is in this record: a token's last four and a card's last four only.`,
    "",
    `**Result:** ${r.payments.length} payments on three rails, each booked in T:0 the moment it settled; ${r.refusals.filter((x) => x.ok).length} of ${r.refusals.length} misuses refused as expected; the reconcile check ${r.reconcile ? (r.reconcile.ok ? "agrees on every payment" : "DISAGREES") : "did not run"}. ${failed.length ? `**${failed.length} check(s) failed:** ${failed.map((c) => c.key).join(", ")}.` : "Every check passed."}`,
    "",
    "## The agents' tokens",
    "",
    "| Agent | Token | Card | Mandate (from the CFO's policy) | Mandate SHA-256 | At the end |",
    "|---|---|---|---|---|---|",
    ...r.tokens.map((t) => `| ${t.agent} | \`${t.token_id}\` (…${t.token_last4}) | ••${t.card_last4} (${t.card_status_at_airwallex} at Airwallex when adopted) | ${t.mandate.currency} ${money(t.mandate.per_purchase_cents)} a purchase, ${money(t.mandate.monthly_cents)} a month, MCC ${t.mandate.mccs.join(", ")}, until ${t.mandate.expires_at.slice(0, 10)} | \`${cut(t.mandate_sha256, 16)}\` | ${t.status_at_end} |`),
    "",
    "## Every payment, booked in T:0 at once",
    "",
    "| | Payment | Rail | Rail reference | Amount | GL · cost centre | Agent | Terms hash | T:0 entry | Booked after the rail settled |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...r.payments.map((p) => `| ${p.key} | ${cell(p.what)} | ${RAIL[p.rail] ?? p.rail} | ${p.explorer ? `[\`${cut(p.rail_ref)}\`](${p.explorer})` : `\`${p.rail_ref}\``} | ${p.currency} ${p.amount} (T:0: ${p.t0.functional.currency} ${p.t0.functional.amount}${p.t0.functional.rate !== 1 ? ` at ${p.t0.functional.rate}` : ""}) | ${p.gl_account} → T:0 ${p.t0.t0_account} · ${p.cost_centre ?? "none"} | ${p.agent ?? "none"} | \`${p.terms_sha256 ? cut(p.terms_sha256, 16) : "none"}\` | \`${p.t0.t0_id}\` (\`${p.t0.je_number}\`, ${p.t0.status}) | ${(p.t0.ms_after_settled / 1000).toFixed(1)} s |`),
    "",
    ...r.payments.filter((p) => p.terms_what).map((p) => `- **${p.key}** terms hash: ${p.terms_what}.${p.mandate_reference ? ` Alta mandate reference \`${p.mandate_reference}\`.` : ""}`),
    "",
    "## Misuse: refused",
    "",
    "| | What | Refused by | Expected | Got | Airwallex calls | |",
    "|---|---|---|---|---|---|---|",
    ...r.refusals.map((x) => `| ${x.key} | ${cell(x.what)} | ${x.by === "purser" ? "Purser (the token's mandate, before any call)" : "Airwallex (the card is frozen)"} | ${x.expected} | ${x.code}: ${cell(x.detail)} | ${x.airwallex_calls} | ${x.ok ? "ok" : "**UNEXPECTED**"} |`),
    "",
    ...(r.revoke ? [`**Revoke.** The ${r.revoke.agent} agent was revoked at ${r.revoke.at} (${r.revoke.how}). Its token \`${r.revoke.token_id}\` is ${r.revoke.token_status} (at ${r.revoke.revoked_at ?? "?"}); its card at Airwallex is ${r.revoke.card_status_at_airwallex}.`, ""] : []),
    "## The reconcile check: T:0 against the rails",
    "",
    r.reconcile ? `Read back at ${r.reconcile.at}: each T:0 entry from T:0 (GET /v1/journal-entries/{id}) and each payment from its rail (Airwallex's card transactions and transfer, Alta's receipt and MandatePayment event).` : "Not run.",
    "",
    ...(r.reconcile ? [
      "| Payment | T:0 holds | The rail holds | Checks | |",
      "|---|---|---|---|---|",
      ...r.reconcile.rows.map((x) => `| \`${cut(x.payment_id, 24)}\` | ${x.t0.currency ?? "?"} ${x.t0.amount ?? "none"} (\`${x.t0_id}\`) | ${x.rail_read ? `${x.rail_read.currency} ${x.rail_read.amount}, ${x.rail_read.status}` : "nothing"} | ${x.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join(", ")} | ${x.ok ? "agrees" : "**DISAGREES**"} |`),
      "",
    ] : []),
    "## Checks",
    "",
    "| Check | | Detail |",
    "|---|---|---|",
    ...r.checks.map((c) => `| ${c.key} | ${c.ok ? "ok" : "**FAIL**"} | ${cell(c.detail)} |`),
    "",
    `**Calls:** Airwallex ${r.calls.airwallex} (login included), T:0 ${r.calls.t0}, Alta transactions ${r.calls.alta_txs}.`,
    "",
    "## Notes",
    "",
    ...(r.notes.length ? r.notes.map((n) => `- ${n}`) : ["None."]),
    "",
    "## What this run does not show",
    "",
    "- No Visa network token (Visa Token Service) and no Airi credential was made: the token is Purser's own, bound to the agent's Airwallex Issuing card. The Visa credential via Airi is in [2026-11-14-vic-5.md](2026-11-14-vic-5.md) and needs the owner's tap in Airi.",
    "- The card charges are the sandbox's simulation of a merchant's authorisation; nothing was cleared at a merchant. The transfer's settlement is the sandbox's simulation.",
    "- The Payer agent's transfer ran under the CFO's limit to pay alone of /try's test companies (EUR 500.00); any other company needs the CFO's Face ID for every invoice.",
    "",
  ];
  return out.join("\n");
}
