// Writes the run log ../2026-11-12-metal-inspector.md from the run record (JSON), so no value in it is typed by hand.
//   node docs/runs/2026-11-12-metal-inspector/make-md.mjs <record.json> <run log.md>   (run from the repository root)
import { readFileSync, writeFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const main = JSON.parse(readFileSync(new URL("../../demo/main-run.json", import.meta.url), "utf8"));
const EXPLORER = "https://testnet.metalntwx.com";
const short = (h) => `${h.slice(0, 10)}…${h.slice(-4)}`;
const tx = (h) => `[\`${short(h)}\`](${EXPLORER}/tx/${h})`;
const addr = (h) => `[\`${h.slice(0, 6)}…${h.slice(-4)}\`](${EXPLORER}/address/${h})`;
const utc = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC", hour12: false }).format(new Date(iso)).replace(" at ", ", ") + " UTC";
const hms = (iso) => iso.slice(11, 19);
const day = (iso) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
const recorded = Object.fromEntries(main.snapshot.budgets.agents.map((a) => [a.agent, a.spent]));
const name = (a) => `${a[0].toUpperCase()}${a.slice(1)}`;
const [r24, rOct] = r.refusals;
const call = (n) => r.calls.find((c) => c.n === n);
const rows = r.calls.map((c) => {
  if (c.method === "eth_blockNumber") return `| ${c.n} | \`eth_blockNumber\` | the block to read at | ${r.read.block} |`;
  if (c.method === "eth_call") { const m = r.read.mandates.find((x) => x.call.data === c.params[0].data); return `| ${c.n} | \`eth_call\` | \`mandates(ref)\` on Northwind's account for ${name(m.agent)}, at block ${r.read.block} | bound, ${m.revoked ? "revoked" : "not revoked"}, spent ${m.spent} |`; }
  const h = c.params[0], res = c.result, events = res.logs.map((l) => Object.entries(r.abi.topic0).find(([, t]) => t === l.topics[0])?.[0]).filter(Boolean);
  return `| ${c.n} | \`eth_getTransactionReceipt\` | ${c.purpose.replace(/^receipt of /, "")}: ${tx(h)} | ${res.status === "0x1" ? "succeeded" : "failed"}, block ${Number(BigInt(res.blockNumber))}; events: ${events.join(", ")} |`;
});
const md = `# Metal: a read-only check for the mandate inspector (12 November 2026, testnet)

**What this is.** ${r.budget.used} read-only JSON-RPC calls to the Metal testnet, made once on ${day(r.started_at)} between ${hms(r.started_at)} and ${hms(r.finished_at)} UTC, to check what the mandate inspector on /metal reads and to fetch the two refusal receipts shown there. Nothing was signed or sent, and no money moved. The budget was ${r.budget.cap} calls, counted before each call was sent; ${r.budget.used} were used (${Object.entries(r.budget.by_method).map(([m, n]) => `${n} \`${m}\``).join(", ")}). The RPC URL is a credential and is not in this record. Every request and answer is in [2026-11-12-metal-inspector.json](2026-11-12-metal-inspector.json), from which this page is written; the check itself is [check.mts](2026-11-12-metal-inspector/check.mts).

## The calls

| # | Method | What for | Answer |
|---|---|---|---|
${rows.join("\n")}

## What the chain says

**The mandates' state at block ${r.read.block}** (read ${utc(r.read.read_at)}), beside the main run's record of 3 November ([main-run.json](../demo/main-run.json), \`snapshot.budgets\`):

| Agent | Mandate reference | Bound | Revoked | Spent on chain | Spent in the record | Payments on chain | Bound in block |
|---|---|---|---|---|---|---|---|
${r.read.mandates.map((m) => `| ${name(m.agent)} | \`${short(m.ref)}\` | ${m.bound ? "yes" : "no"} | ${m.revoked ? "yes" : "no"} | ${m.spent} \\*USDZ | ${recorded[m.agent]} | ${m.occurrences} | ${m.bound_block} |`).join("\n")}

${r.read.mandates.every((m) => m.spent === recorded[m.agent]) ? "The chain and the record agree on every amount." : "THE CHAIN AND THE RECORD DISAGREE: see the table."} A replaced mandate carries its predecessor's spend: Sourcing's mandate was replaced during the run, and the mandate that replaced it counts all ${r.read.mandates.find((m) => m.agent === "sourcing").occurrences} purchases.

**What a read returns, and what it does not.** \`mandates(ref)\` returns a mandate's running state: its principal, whether it is revoked, its spend, its number of payments and the block it was bound in. The terms (cap per payment, budget, expiry, payee) cannot be read this way: they are in the \`MandateBound\` event of the bind or replace transaction. This check read that event for two mandates:

| Mandate | Transaction | Cap per payment | Budget | Expiry | Payee |
|---|---|---|---|---|---|
${r.bindings.map((b) => `| ${name(b.agent)}${b.kind === "replace" ? ", after the CFO's change" : ""} | ${tx(b.tx)}, ${utc(b.block_time)} | ${b.terms.per_payment_cap} \\*USDZ | ${b.terms.budget} \\*USDZ | ${utc(b.terms.expiry_iso)} | ${b.terms.payee.name}, ${addr(b.terms.payee.account)} |`).join("\n")}

Both match the main run's ledger. Treasury's replace also revoked its predecessor (\`${short(r.bindings[0].predecessor)}\`) in the same transaction. Sourcing's replace receipt and the customer's bind receipt were not fetched (the budget was used); their terms on /metal come from the main run's ledger.

**The two refusals.**

- Main run, purchase #${r24.purchase} (${utc(r24.block_time)}, block ${r24.block}, ${tx(r24.tx)}): \`MandateRefused\` on Northwind's account, mandate \`${short(r24.event.mandate)}\` (the Sourcing mandate the ledger names), payee ${addr(r24.event.payee)}, amount ${r24.event.amount} \\*USDZ, reason ${r24.event.reason} (\`${r24.event.reason_name}\`). The transaction itself succeeded: it is the call that records the refusal, and it moved nothing.
- Four-eyes world, a separate run (${utc(rOct.block_time)}, block ${rOct.block}, ${tx(rOct.tx)}): \`MandateRefused\` on account ${addr(rOct.account)}, mandate \`${short(rOct.event.mandate)}\`, amount ${rOct.event.amount} \\*USDZ, reason ${rOct.event.reason} (\`${rOct.event.reason_name}\`).

**How Sourcing's reference was found.** A mandate's reference is ${r.reference_derivation.rule}. The rule was first checked on Treasury: the derived reference equals the one in its \`MandateBound\` event, and the event's credential hash equals the ledger's. Sourcing's current reference was then derived from the agent key in the #${r24.purchase} refusal event (a replacement keeps the agent's key) and the replace's credential hash in the ledger, and the read confirmed that a mandate is bound under it.

## Not done

- The customer's mandate, on the customer's own account, was not read.
- No block range was scanned for events: only the four named receipts were read.
- This is a check made once. The inspector on /metal makes its own reads, behind its own cache, daily ceiling and switch (see [metal-award.md](../metal-award.md)).
`;
writeFileSync(process.argv[3], md);
console.log(md);
