// npm run readme-draft: writes docs/readme-v2-draft.md, the README's next structure for an enterprise reader (12 Nov),
// not README.md itself (the orchestrator integrates it). Every number is read from a run record or computed here:
// the refusals and the main run's counts from their records, the test counts from a vitest JSON report
// (`npx vitest run --reporter=json --outputFile.json=<file>`, then `npm run readme-draft -- --tests <file>`), the CI
// steps from .github/workflows/ci.yml, the repository's counts from the tree. Nothing typed in.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { airwallexHold, railRefusals } from "../visuals/facts.js";
import { agentRun, faceIdDecisions, split } from "../redesign/run.js";
import { metalStory } from "../redesign/metalStory.js";
import { hashTravel } from "../redesign/airwallexProof.js";
import { awxRun } from "../redesign/awxRun.js";
import { AIRI_RUN_FILE, AIRI_RUN_LOG } from "../redesign/airiRun.js";
import { SOCIAL_SENTENCE } from "../visuals/svg.js";
import { BUILT_WITH, BUILT_WITH_PNG, LEFT_OUT } from "../visuals/logos.js";

const OUT = "docs/readme-v2-draft.md";
const LIVE = "https://kit11.max-31b.workers.dev";
const read = (p: string) => readFileSync(p, "utf8");
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

// The test counts: from a vitest JSON report when one is given (kept as docs/assets/test-summary.json, with the commit
// it ran on), else from that summary, so `--check` can rebuild the draft without running the tests.
interface VitestReport { numTotalTests: number; numPassedTests: number; numFailedTests: number; numPendingTests: number; numTodoTests: number; testResults: unknown[] }
interface TestSummary { total: number; passed: number; failed: number; skipped: number; files: number; commit: string }
const SUMMARY = "docs/assets/test-summary.json";
const reportPath = arg("--tests"), check = process.argv.includes("--check");
const report = reportPath ? JSON.parse(read(reportPath)) as VitestReport : null;
const summary: TestSummary | null = report
  ? { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests + report.numTodoTests, files: report.testResults.length,
      commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim() }
  : existsSync(SUMMARY) ? JSON.parse(read(SUMMARY)) as TestSummary : null;

// The repository, counted.
function files(dir: string, re: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f.startsWith(".")) return [];
    return statSync(p).isDirectory() ? files(p, re) : re.test(f) ? [p] : [];
  });
}
const count = (dir: string, re = /\.(ts|sol|sql|json|md|jsonc)$/) => files(dir, re).length;
const testFiles = files("test", /\.test\.ts$/).length;
const browserChecks = files("test/browser", /\.check\.ts$/).length;
const ciSteps = [...new Set([...read(".github/workflows/ci.yml").matchAll(/^\s*- name: (.+)$/gm)].map((m) => m[1]!.trim()))].filter((s) => !/^(Playwright browsers|xmllint)/.test(s));
const workflows = readdirSync(".github/workflows").filter((f) => f.endsWith(".yml"));
const runLogs = readdirSync("docs/runs").filter((f) => /^\d{4}-\d\d-\d\d-.*\.md$/.test(f)).length;

// The records.
const run = agentRun(), r = run.record, sp = split(r), m = metalStory(r), h = hashTravel(r), awx = awxRun();
const refusals = railRefusals(), twoLocks = airwallexHold();
const declines = [...new Set(awx?.card_transactions.filter((t) => !t.approved && t.decline_code).map((t) => t.decline_code) ?? [])];
const airi = JSON.parse(read(AIRI_RUN_FILE)) as { purchases: { step: string; route: string; outcome?: string }[]; checks: Record<string, { ok: boolean }>; started_at: string };
const airiChecks = Object.values(airi.checks), airiPaid = airi.purchases.filter((p) => p.outcome === "SUCCEEDED").length;
const t0 = /(\d+) journal entries posted to T:0's shared sandbox entity/.exec(read("docs/runs/2026-11-10-t0-journal-sandbox.md"))?.[1];
const mb = JSON.parse(read("docs/runs/2026-11-12-moneybird-sandbox.json")) as { labels: string[]; reconciliation: { documents: number; differences: number }; calls: { used: number; approved: number } };
const mainDay = run.events.find((e) => e.k === "money")?.at ?? r.snapshot.flows[0]!.at;

const pic = (name: string, alt: string) => `<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="assets/${name}-tall-dark.svg">
  <source media="(max-width: 600px)" srcset="assets/${name}-tall-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="assets/${name}-wide-dark.svg">
  <img src="assets/${name}-wide-light.svg" alt="${alt}" width="100%">
</picture>`;

const proofCards = refusals.map((x) => `| **${x.name}**<br>${x.code ? `\`${x.code}\`` : x.held} | ${x.what}${x.note ? `<br>_${x.note}_` : ""} | ${day(`${x.date}T12:00:00Z`)}, ${x.label}.<br>[Run record](${x.record.replace(/^docs\//, "")})${x.proof ? ` · [${x.proof.label}](${x.proof.href})` : ""} |`);

const testsLine = summary
  ? `**${summary.passed} of ${summary.total} tests passed** in ${summary.files} files${summary.failed ? `, ${summary.failed} failed` : ""}${summary.skipped ? `, ${summary.skipped} skipped` : ""}, on commit \`${summary.commit}\` ([summary](assets/test-summary.json)); CI runs them on every push.`
  : `The test count is not in this build: run \`npx vitest run --reporter=json --outputFile.json=vitest.json\`, then \`npm run readme-draft -- --tests vitest.json\`.`;

const md = `<!-- Draft of the README's next structure (12 Nov), written by \`npm run readme-draft\` (src/cli/readmeDraft.ts).
     Not README.md yet: the orchestrator integrates it. Every number below is read from a run record or computed;
     regenerate rather than edit. Image paths are relative to docs/. -->

# Purser

**${SOCIAL_SENTENCE}**

${pic("payment-life", "One payment's life: invoice, read by Claude, checked by Purser's code, the exact terms hashed, signed by the CFO's Face ID, checked again by the rail's own control, paid, booked.")}

Three runs where the rail itself held a payment, each a live sandbox or testnet run:

| Rail | What happened | Record |
|---|---|---|
${proofCards.join("\n")}

**Try it with your own Face ID:** [${LIVE.replace("https://", "")}/try/sign](${LIVE}/try/sign) signs a test payment
in your own test world (stand-in executors: no payment reaches Airwallex or Metal).

## How it works

${pic("architecture", "AI agents propose; three layers that do not trust each other can each stop a payment: Purser's checks in code, the CFO's Face ID over the exact terms above a limit, the rail's own controls; then the ledger.")}

1. **Agents propose.** Claude agents read invoices and propose payments. An agent cannot change its own limits.
2. **Purser's code checks.** Per-agent limits and budgets, allowed payees and merchants, the invoice's totals. It
   hashes the exact terms (SHA-256).
3. **The CFO signs.** Above a limit, the CFO approves with Face ID: a passkey signs that hash. Every change to a
   limit is a proposal the CFO signs too. Before paying, Purser hashes the terms again; changed terms are refused.
   Within the limits, a payment goes without a new signature: the CFO signed those limits.
4. **The rail checks on its own.** Airwallex (transfer approvals, card controls), Metal (a mandate cap on chain) and
   Visa Intelligent Commerce via Airwallex's Airi (the cardholder's passkey per purchase) each keep their own limit.
5. **Recorded.** Every step goes to the ledger's hash-chained audit log. Books were posted to T:0 and Moneybird in
   sandbox runs; Purser Cloud (a private preview, no customer) keeps invoices, suppliers and payments with every
   version.

## Security model

| Layer | Held by | Refuses on its own | Trusts the others? |
|---|---|---|---|
| 1. Purser's checks | Code in this repository | over a limit or budget, an unknown payee, totals that do not add up | No |
| 2. The CFO's signature | The CFO's passkey (Face ID) over the hash of the exact terms | terms changed after signing (the executor re-hashes) | No |
| 3. The rail's own controls | Airwallex, Metal, Airi | over the rail's own limit or approval, even after Purser's yes | No |

What this does not cover: the rails' limits (Metal mandate caps, Airwallex card limits) are set by Purser's runner,
which holds the keys, with the CFO's signature for each change. So the layers hold against an agent, a changed
invoice or changed terms, not against a compromised runner (see the threat model).

Threat model: [security.md](security.md). Controls: [controls.md](controls.md). Security reports:
[SECURITY.md](../SECURITY.md).

## Partners, and what ran live on each

Built with:

<img src="${BUILT_WITH_PNG.replace(/^docs\//, "")}" alt="Built with ${BUILT_WITH.map((l) => l.name).join(", ")}" height="44">

The logos are the partners' official files, unmodified ([sources](assets/logos/SOURCES.md)); no endorsement is
implied. Named in text only: ${LEFT_OUT.map((l) => l.name).join(", ")} (why: [sources](assets/logos/SOURCES.md#left-out-named-in-text-only)).
Every run is in sandbox or testnet with test money; dates and records in [runs/README.md](runs/README.md).

- **Airwallex (sandbox).** Main run, ${day(mainDay)}: ${h ? `the hash the CFO signed is in Airwallex's own record of ${h.transferMethod} transfer \`${h.transferId.slice(0, 8)}…\` (${h.currency} ${h.amount})` : "the SWIFT payment after the CFO's Face ID"}. awx-1${awx?.attempts[0]?.at ? `, ${day(awx.attempts[0].at)}` : ""}: Airwallex declined agents' cards with its own controls${declines.length ? ` (${declines.map((d) => `\`${d}\``).join(", ")})` : ""}. ${twoLocks ? `Two locks, from ${day(`${twoLocks.date}T12:00:00Z`)}: ${twoLocks.what}` : ""}
- **Metal (testnet).** Main run: a mandate on chain per agent; ${m.payments.total} payments, each its own transaction${m.refusal ? `; #${m.refusal.seq} refused on chain (\`${m.refusal.code}\`)` : ""}${m.replace ? `; the mandates replaced on chain after the CFO's Face ID` : ""}.
- **Visa Intelligent Commerce via Airwallex's Airi (sandbox, test card).** ${day(airi.started_at)}: ${airiPaid} purchase${airiPaid === 1 ? "" : "s"} paid with a single-use credential, each confirmed by the cardholder's passkey in Airi; ${airiChecks.filter((c) => c.ok).length} of ${airiChecks.length} checks passed ([run log](${AIRI_RUN_LOG.replace(/^docs\//, "")})).
- **Claude (Anthropic).** Main run: ${sp.byClaude} of ${sp.decisions} decisions by Claude, ${sp.fallbacks} fallbacks; ${faceIdDecisions(r)} Face ID signatures in the same run.
- **Books.** T:0 (sandbox): ${t0 ?? "the"} journal entries of the main run posted ([record](runs/2026-11-10-t0-journal-sandbox.md)). Moneybird (${mb.labels.join(", ")}): ${mb.reconciliation.documents} documents read back, ${mb.reconciliation.differences} differences ([record](runs/2026-11-12-moneybird-sandbox.md)).

## Run it yourself

Needs Node.js 22.13 or later and git. No keys; after \`npm ci\`, no network.

\`\`\`sh
git clone https://github.com/agamemnon-coder/x402-business-agents.git
cd x402-business-agents
npm ci
npm test                    # the tests, on stand-ins for Airwallex, Metal and Claude
npm run judge -- --check    # builds the site's pages from the main run's record, offline
npm run judge               # serves them on http://localhost:4311
npm run visuals -- --check  # the diagrams in docs/assets are what the code draws
\`\`\`

Running it live (sandbox keys, a Metal RPC): [run-it.md](run-it.md).

## Repository map

| Folder | What | Files |
|---|---|---|
| \`src/\` | Purser: agents, policy, passkey approvals, executors per rail, ledger, the site's pages | ${count("src")} |
| \`cloud/\` | Purser Cloud: the small-company product (invoices in, read, paid after Face ID, booked, archived) | ${count("cloud")} |
| \`worker/\` | The hosted site and relay (Cloudflare Worker): /try/sign, the phone-to-runner relay | ${count("worker")} |
| \`contracts/\` | Solidity contracts used on Metal testnet, with their ABIs | ${count("contracts")} |
| \`test/\` | Unit, integration and browser checks | ${count("test")} |
| \`docs/\` | Run logs, records, security, plans (the generated visuals in \`docs/assets/\` not counted) | ${files("docs", /\.(md|json|svg)$/).filter((f) => !f.startsWith("docs/assets/")).length} |
| \`fixtures/\` | Test invoices, including the hostile ones (bank change, look-alike, injection) | ${count("fixtures", /./)} |

## Tests and CI

- ${testsLine}
- ${testFiles} test files under \`test/\`, ${browserChecks} browser checks (Playwright, 390 and 1440 px), ${workflows.length} workflows.
- CI steps (from \`.github/workflows/ci.yml\`): ${ciSteps.map((s) => s.replace(/\|/g, "/")).join("; ")}.
- ${runLogs} dated run logs in [runs/](runs/).

## Limits, and what is simulated

| | Status |
|---|---|
| Money | Test money only: Airwallex sandbox, Metal testnet, Airi's test card. No real money has moved. |
| Main run (${day(mainDay)}) | Live calls to the Airwallex sandbox, Metal testnet and Claude; the CFO's Face ID on a phone. The sandbox simulates a SWIFT transfer's last steps and the merchant's card charge. |
| Customer, supplier, second approver | Run by us (the second approver is a labelled test passkey). |
| Home, Watch, Proof | Replay the main run's record. |
| /try/sign | Your own test world on stand-in executors: your passkey's signature is real, no payment reaches a rail. |
| Airi | Its own passkey step held a purchase; it has not refused one outright in a live run. |
| Two locks | Purser's lock was a labelled virtual test passkey, not a person's Face ID. Airwallex held the transfer \`IN_APPROVAL\` until a person approved it at Airwallex; \`SENT\` and \`PAID\` came from the sandbox's simulation. |
| Purser Cloud | A hosted preview behind an access key; no customer uses it; test money only. |
| Tests | Run on stand-ins for Airwallex, Metal and Anthropic. |
| Customers | Not validated with customers yet; no pilots, no revenue. |

Screenshots and short loops of the live site: [assets/screens/](assets/screens/README.md).
`;

if (check) {
  if (read(OUT) !== md) { console.error(`${OUT} differs from what the records give now: npm run readme-draft`); process.exit(1); }
  console.log(`${OUT} matches the records`);
} else {
  writeFileSync(OUT, md);
  if (report) writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wrote ${OUT}${summary ? "" : " (no test summary: test counts left out)"}`);
}
