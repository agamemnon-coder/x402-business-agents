// The run log of `npm run alta-refusals` (src/cli/altaRefusals.ts), written from its record only: no network, no keys.

const EXPLORER_TX = "https://testnet.metalntwx.com/tx/";

export interface AltaRefusalStep {
  n: number; mandate: string; kind: string; step: string; outcome: string; tx: string | null; block: number | null;
  amount?: string; event?: string; expected?: string; reason?: string; reason_as_expected?: boolean; payee_delta?: string; account_delta?: string; detail: string;
}
export interface AltaRefusalsRecord {
  run: string; ran_at: string; finished_at: string; network: string; chain_id: number; made_by: string;
  account: string; owner: string; payee: string; gas_only_key: string;
  mandates: { mandate: string; reference: string; terms: string; starts: string | null; expiry: string | null; bound: string | null; revoked: string | null; spent: string | null; payments: string | null }[];
  summary: { payments_paid: number; paid_total: string; refusals_planned: number; refusals_sent: number; refused_before_sending: number; refused_on_chain: number; reasons: string[]; reasons_as_expected: number; unexpected: number; transactions: number };
  steps: AltaRefusalStep[];
  note?: string;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
const txCell = (tx: string | null) => (tx ? `[\`${tx.slice(0, 10)}…${tx.slice(-4)}\`](${EXPLORER_TX}${tx})` : "not sent");

export function altaRefusalsMarkdown(r: AltaRefusalsRecord): string {
  const s = r.summary;
  const day = r.ran_at.slice(0, 10);
  return [
    `# Alta testnet: four more mandate refusals on chain, and one the CLI stops before sending (${day})`,
    "",
    `Live on ${r.network}, chain id ${r.chain_id}, test money only (*USDZ from the testnet faucet). Run from this session with no person's hands: no passkey, no Face ID. Made by \`npm run alta-refusals\` ([src/cli/altaRefusals.ts](../../src/cli/altaRefusals.ts)) with the pinned \`metal-agent\` CLI, in a test world of its own; keys in a folder outside this repository, none in this record. This page is written from [${r.run}.json](${r.run}.json) by \`npm run alta-refusals -- --md\`.`,
    "",
    "**Why.** The 19 Nov series ([2026-11-19-alta-series.md](2026-11-19-alta-series.md)) sent three payments its mandate does not allow (over the cap, another payee, over the budget). This run sends the refusals it did not: a mandate whose payment count is used up, a revoked mandate, a mandate that has not started, an expired mandate, and a payment signed by a key that is not the mandate's. Each is sent with `--record-refusal`, so Alta's Mandate Binding itself refuses it in a transaction of its own: here they go to the chain on purpose.",
    "",
    `**Result:** ${s.payments_paid} payments paid inside their mandates (${s.paid_total} test USD); ${s.refused_on_chain} of ${s.refusals_sent} refusals sent were refused on chain, ${s.reasons_as_expected} with the reason expected (${s.reasons.map((x) => `\`${x}\``).join(", ")}), each moving 0.00 for the payee and the account. ${s.refused_before_sending ? `${s.refused_before_sending} more (a payment signed by another key) was refused by the pinned CLI before it signed anything, so it never reached the chain and Alta's own signature check was not exercised. ` : ""}${s.transactions} transactions in all; ${s.unexpected} unexpected.`,
    "",
    ...(r.note ? [`**Note.** ${r.note}`, ""] : []),
    "| | |",
    "|---|---|",
    `| Account (one owner) | \`${r.account}\` |`,
    `| Owner (plain test key) | \`${r.owner}\` |`,
    `| Payee every mandate names (test payee) | \`${r.payee}\` |`,
    `| Gas-only key (pays the recorded refusals' gas, owns nothing) | \`${r.gas_only_key}\` |`,
    `| Ran | ${r.ran_at} to ${r.finished_at} |`,
    "",
    "## The mandates, as the chain has them after the run",
    "",
    "| Mandate | Terms | Starts | Expiry | Revoked | Spent | Payments | Reference |",
    "|---|---|---|---|---|---|---|---|",
    ...r.mandates.map((m) => `| ${m.mandate} | ${esc(m.terms)} | ${esc(m.starts ?? "–")} | ${esc(m.expiry ?? "–")} | ${m.revoked ?? "–"} | ${esc(m.spent ?? "–")} | ${m.payments ?? "–"} | \`${m.reference}\` |`),
    "",
    "## Every step, read back from its receipt",
    "",
    "\"Payee\" and \"Account\" are the balance changes read before and after each pull.",
    "",
    "| # | Mandate | Step | Outcome | Expected | Event on chain | Payee | Account | Block | Transaction |",
    "|---:|---|---|---|---|---|---|---|---|---|",
    ...r.steps.map((x) => `| ${x.n} | ${x.mandate} | ${esc(x.step)} | ${x.outcome}${x.reason ? ` (${x.reason})` : ""} | ${x.expected ?? "–"} | ${x.event ?? "–"} | ${x.payee_delta ?? "–"} | ${x.account_delta ?? "–"} | ${x.block ?? "–"} | ${txCell(x.tx)} |`),
    "",
    "## What this does not show",
    "",
    "- `NonceUsed` (the same signed payment sent twice): the CLI keeps each payment id and reports a paid one again instead of sending it, so it was not sent.",
    "- `BadSignature` on chain: the pinned CLI refuses a key that is not the mandate's before signing; a payment signed by another key would need a client other than the CLI.",
    "- Anything about real money: testnet, test USD from the faucet.",
    "",
  ].join("\n");
}
