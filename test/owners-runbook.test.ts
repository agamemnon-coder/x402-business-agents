// The live run's runbook (docs/runs/driver/faceid-onchain-runbook.md) says only what the code does. Breaks when a call
// estimate, a total, an amount, a command, an expected output line or a setting's name in the runbook drifts from the
// code; when the runbook names a URL or holds something that looks like a secret; or when it reads as if a real phone
// had signed on chain already (it is a plan). No number in it is typed by hand: the block between the two markers is
// built here from ownersPlan and planTotals and compared byte for byte.
//
// To write the block after the plan changed: OWNERS_RUNBOOK_WRITE=1 npx vitest run test/owners-runbook.test.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fromCents } from "../src/lib/money.js";
import { RECEIPT_POLLS } from "../src/metal/ownersChain.js";
import { ACCOUNT_CENTS, MANDATE, ownersPlan, planTotals, SPONSOR_CENTS } from "../src/metal/ownersFlow.js";
import { CREDENTIAL_FILE, LABEL, NAME } from "../docs/runs/driver/test-controller.js";

const REPO = resolve(import.meta.dirname, "..");
const FILE = join(REPO, "docs/runs/driver/faceid-onchain-runbook.md");
const BEGIN = "<!-- owners-plan:begin (built from ownersPlan and planTotals by test/owners-runbook.test.ts; never edited by hand) -->";
const END = "<!-- owners-plan:end -->";
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");
const flow = read("src/metal/ownersFlow.ts");
/** A number the flow holds without exporting it, read from its source; the test fails loudly if the line moves. */
function fromFlow(what: string, re: RegExp): number {
  const m = re.exec(flow);
  if (!m) throw new Error(`src/metal/ownersFlow.ts no longer holds ${what} where this test reads it; update the pattern here`);
  return Number(m[1]);
}
const SIGN_MINUTES = fromFlow("the minutes both owners have to sign", /const SIGN_MINUTES = (\d+);/);
const DEADLINE_SECONDS = fromFlow("the seconds the signed deadline outlives the proposal", /Math\.floor\(expires\.getTime\(\) \/ 1000\) \+ (\d+)/);
const AMOUNTS = { cap: fromCents(MANDATE.capCents), budget: fromCents(MANDATE.budgetCents), over: fromCents(MANDATE.capCents + 1), sponsor: fromCents(SPONSOR_CENTS), account: fromCents(ACCOUNT_CENTS) };

/** The plan of a donor-funded run as the runbook's block: every step the code plans appears here without a hand edit. */
function planBlock(): string {
  const plan = ownersPlan({ funding: "donor", polls: RECEIPT_POLLS });
  const t = planTotals(plan);
  const range = (r: { min: number; max: number }) => (r.min === r.max ? String(r.min) : `${r.min} to ${r.max}`);
  const requests = { min: plan.reduce((n, s) => n + s.requests.min, 0), max: plan.reduce((n, s) => n + s.requests.max, 0) };
  return [
    "| Step | Command | Requests | CLI runs | Transactions |",
    "|---|---|---|---|---|",
    ...plan.map((s) => `| ${s.step} | \`${s.command}\` | ${range(s.requests)} | ${s.cli_runs} | ${s.transactions.length ? s.transactions.join("; ") : "none"} |`),
    `| **Total** | | ${range(requests)} | ${t.cli_runs} | ${t.transactions} transactions |`,
    "",
    `Lines in the call log: ${range(t.lines)}. Every request is one line and every CLI run is one line; the requests inside a CLI run are not counted. The higher number is when every receipt takes all ${RECEIPT_POLLS} polls.`,
    "",
    `Amounts, from the code: the mandate allows up to ${AMOUNTS.cap} per payment and ${AMOUNTS.budget} in total, to ${MANDATE.payee.name} only; the payment over the cap is ${AMOUNTS.over}; the gas sponsor gets ${AMOUNTS.sponsor} test USD and the account ${AMOUNTS.account} test USD; a proposal is open for ${SIGN_MINUTES} minutes and its signed deadline ends ${DEADLINE_SECONDS} seconds later.`,
    "",
    "On the phone, by step:",
    "",
    ...plan.filter((s) => !s.phone.startsWith("nothing")).map((s) => `- **${s.step}**: ${s.phone}`),
  ].join("\n");
}

if (process.env.OWNERS_RUNBOOK_WRITE === "1") {
  const now = readFileSync(FILE, "utf8");
  writeFileSync(FILE, `${now.slice(0, now.indexOf(BEGIN) + BEGIN.length)}\n${planBlock()}\n${now.slice(now.indexOf(END))}`);
}
const book = readFileSync(FILE, "utf8");
const [before = "", rest = ""] = book.split(BEGIN);
const [block = "", after = ""] = rest.split(END);
/** The runbook's own words: everything outside the generated block. */
const prose = `${before}\n${after}`;
const sources = (dir: string): string[] => readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
const code = [...sources("src"), "docs/runs/driver/test-controller.ts", "test/owners-runbook.test.ts"].map(read).join("\n");

describe("the runbook of the live Face ID run", () => {
  it("carries the plan exactly as the code computes it: steps, calls per step, totals and amounts", () => {
    expect(book.split(BEGIN)).toHaveLength(2);
    expect(book.split(END)).toHaveLength(2);
    expect(block).toBe(`\n${planBlock()}\n`);
  });

  it("types no call count, amount or time limit by hand outside that block", () => {
    expect(prose.match(/\b\d+ (?:to \d+ )?(?:requests?|calls?|lines?|transactions?|polls?|CLI runs?)\b/g) ?? []).toEqual([]);
    // Every amount in the words is one the code holds; every time limit is the code's.
    for (const amount of prose.match(/\b\d+\.\d{2}\b/g) ?? []) expect(Object.values(AMOUNTS)).toContain(amount);
    expect([...new Set(prose.match(/\b\d+ minutes\b/g) ?? [])]).toEqual([`${SIGN_MINUTES} minutes`]);
    expect([...new Set(prose.match(/\b\d+ seconds\b/g) ?? [])]).toEqual([`${DEADLINE_SECONDS} seconds`]);
    // The budget is said in words (the plan's highest number of lines), never as a number of its own.
    expect(prose).toMatch(/`OWNERS_CALL_BUDGET` to the higher number of the line "Lines in the call log"/);
    expect(prose).not.toMatch(/OWNERS_CALL_BUDGET=\d/);
  });

  it("names only commands that exist", () => {
    const commands = /const COMMANDS = \[(.+)\] as const;/.exec(read("src/cli/ownersExecute.ts"))![1]!.split(",").map((c) => c.trim().replace(/^"|"$/g, "").split(" ")[0]!);
    const named = [...book.matchAll(/npm run owners -- ([a-z-]+)/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(8);
    for (const c of named) expect(commands).toContain(c);
    // The whole scene is there: every command of the CLI is named at least once.
    for (const c of commands) expect(named).toContain(c);
    const scripts = Object.keys((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts);
    for (const m of book.matchAll(/npm run ([a-z:-]+)/g)) expect(scripts).toContain(m[1]!);
    expect(book).toContain("npm run passkey -- add <name>");
    expect(book).toContain("npx tsx docs/runs/driver/test-controller.ts enrol");
    expect(book).toContain("npx tsx docs/runs/driver/test-controller.ts approve <id>");
    // The replace's amounts are the plan's (the block above holds them); the words name none of their own.
    expect(prose).toContain("`npm run owners -- propose-replace` with the amounts in the plan above (the new cap, then the new budget)");
    expect(prose).not.toMatch(/propose-replace[ `]+<?\d/);
  });

  it("names only settings the code reads, by name and never with a value", () => {
    const names = [...new Set(book.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [])];
    for (const wanted of ["OWNERS_GO", "OWNERS_CALL_BUDGET", "OWNERS_CALL_LOG", "OWNERS_DONOR_KEY", "KIT11_PASSKEY_OWNERS", "KIT11_DB", "KIT11_KEYS_DIR", "METAL_RPC_URL", "KIT11_RELAY_URL", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "KIT11_RELAY_TOKEN", "OWNERS_DEVICE_CFO", "OWNERS_DEVICE_CONTROLLER", "OWNERS_DEVIATIONS", "KIT11_CARD_POLL_MS"]) expect(names).toContain(wanted);
    for (const name of names) expect(code, `${name} is named in the runbook but nothing in the code reads it`).toContain(name);
    // A setting is never given a value here, except the three fixed words the code asks for.
    const assigned = [...book.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)=(\S*)/g)].map((m) => `${m[1]}=${m[2]}`);
    expect(assigned).toEqual([]);
  });

  it("holds no address of a real relay or endpoint and nothing that looks like a secret", () => {
    expect(book).not.toMatch(/https?:\/\/|workers\.dev|wss?:\/\//);
    expect(book).not.toMatch(/#view=|Bearer |-----BEGIN/);
    expect(book).not.toMatch(/0x[0-9a-fA-F]{16,}/);
    expect(book).not.toMatch(/[A-Za-z0-9+_-]{32,}/);
    expect(book).not.toMatch(/[0-9A-F]{4}(-[0-9A-F]{4}){3}/);
  });

  it("quotes expected output lines the commands really print", () => {
    const printers = ["src/metal/ownersFlow.ts", "src/metal/ownersRecord.ts", "src/cli/ownersExecute.ts", "src/cli/relay.ts", "src/cli/passkey.ts", "src/executors/ownersExecute.ts", "src/metal/ownersBudget.ts", "docs/runs/driver/test-controller.ts",
      // What the runner says when an approved proposal does not run, and why (an approval relayed after its time).
      "src/relay/runner.ts", "src/policy/approvals.ts"].map(read).join("\n")
      // The driver prints its label through a constant.
      .replaceAll("${LABEL}", LABEL).replaceAll("${NAME}", NAME).replaceAll("${CREDENTIAL_FILE}", CREDENTIAL_FILE);
    const expected = [...book.matchAll(/^\s*Expect: `(.+)`$/gm)].map((m) => m[1]!);
    expect(expected.length).toBeGreaterThan(14);
    for (const line of expected) {
      // What stands between two <placeholders> is printed word for word by one of the commands.
      const fixed = line.split(/<[^<>]+>|…/).map((s) => s.trim()).filter((s) => s.length >= 6);
      expect(fixed.length, line).toBeGreaterThan(0);
      for (const part of fixed) expect(printers, `"${part}" (of the expected line "${line}") is printed by no command`).toContain(part);
    }
  });

  it("says what the phone shows in the approval page's own words", async () => {
    const client = read("src/approve/client.ts");
    for (const shown of [...prose.matchAll(/"([^"\n]{4,})"/g)].map((m) => m[1]!)) {
      const fixed = shown.split(/<[^<>]+>|…|\b\d+\.\d{2}\b|XXXX-XXXX-XXXX-XXXX/).map((s) => s.trim().replace(/^[,(]\s*|\s*[,)]$/g, "")).filter((s) => s.length >= 4);
      for (const part of fixed) expect(`${client}\n${read("src/approve/enrol.html")}\n${code}`, `the phone never shows "${part}" (quoted as "${shown}")`).toContain(part);
    }
    // The three titles, as the page builds them.
    const { describeTerms } = await import("../src/approve/client.js");
    const F = JSON.parse(read("test/fixtures/owners-execute-terms.json")) as { action: Record<string, string> };
    for (const what of ["bind", "replace", "revoke"]) {
      const verb = `${what.charAt(0).toUpperCase()}${what.slice(1)}`;
      expect(describeTerms({ ...F, action: { ...F.action, what } } as never, {}).title).toBe(`${verb} the sourcing mandate, signed on chain`);
      expect(prose).toContain(`"${verb} the sourcing mandate, signed on chain"`);
    }
  });

  it("is a plan: it claims no real phone has signed, labels the virtual approver, and uses no gendered pronoun", () => {
    expect(prose).toContain("This is a plan. No real phone has signed on chain yet.");
    expect(prose.replace("No real phone has signed on chain yet", "")).not.toMatch(/(?:phone|iPhone|Face ID) (?:has )?signed on chain|signed on chain with (?:a|the) real/i);
    expect(book).not.toMatch(/\b(?:he|she|him|his|her|hers)\b/i);
    expect(prose).toContain(LABEL);
    expect(prose).toMatch(/not a person and not a device/);
    expect(prose).toMatch(/never signs first/);
    expect(prose).toMatch(/as stated by the owner/);
  });

  it("says the replace is one proposal with one on-chain call, and what to do when it reverts", () => {
    expect(prose).toMatch(/ONE proposal with one on-chain `replace` call; each owner signs it once/);
    expect(prose).toMatch(/If the replace reverts: `npm run owners -- propose-revoke`, both sign; then `npm run owners -- propose <cap> <budget>`, both sign; then `npm run owners -- pay`/);
    // What the code does when things go wrong, in the code's own words.
    expect(read("src/cli/ownersExecute.ts")).toMatch(/code = stop \? 3 : 1/);
    expect(prose).toMatch(/exits with code 3/);
    expect(prose).toMatch(/stays EXECUTING/);
    expect(prose).toMatch(/nothing is sent twice/);
    expect(read("src/executors/ownersExecute.ts")).toContain("nothing is sent twice");
  });

  it("says what a runner needs to know that the plan's table does not", () => {
    // Where the viewer link comes from, and what the virtual approver's driver needs on the runner's machine.
    expect(prose).toMatch(/The viewer link is on the runner's `viewer` line/);
    expect(read("src/cli/relay.ts")).toMatch(/console\.log\(`viewer {3}\$\{viewerLink\(/);
    expect(prose).toMatch(/test-controller\.ts enrol`[^\n]* it needs Playwright with Chromium on the runner's machine/);
    expect(read("docs/runs/driver/test-controller.ts")).toMatch(/\("playwright"\)/);
    // Both world settings, for every owners command; and what the budget does not count, without a number.
    expect(prose).toMatch(/`KIT11_DB`, `KIT11_KEYS_DIR` \(a folder outside the repository\)\. Every owners command refuses without `KIT11_DB`, and every one but record without `KIT11_KEYS_DIR`: none falls back to a default/);
    expect(flow).toMatch(/export function worldRefusals\(/);
    expect(prose).toMatch(/the requests the metal-agent CLI makes inside each CLI run are not counted/);
    // The runner's own word for the budget's unit is the plan's: lines in the call log.
    expect(prose).toContain("Expect: `owners   relays behind the call budget: <used> of <budget> lines in the call log used in this world`");
    expect(prose).toContain("Expect: `CALLS            <used> of <budget> lines in the call log used in this world (this command: <n>); …`");
    expect(prose).not.toMatch(/Metal calls/);
    // Both signed, relayed too late: the approval is void and the proposal expired, as beginExecution has it.
    expect(prose).toMatch(/Signed in time but relayed too late \([^)]*\): the approval is void and the proposal is EXPIRED\. Either way, run the same propose command again/);
    expect(read("src/policy/approvals.ts")).toMatch(/expireIfDue\(db, p, now\), p\.expires_at\) : null;[\s\S]{0,120}expired at \$\{expired\}; approval void/);
    // The page's word for the second approver is said once, so the two names are known to be one.
    expect(prose).toContain("\"Needs your approval, and the second owner's\" (the page's name for the second approver)");
    expect(prose).not.toMatch(/two people|second person|the controller/);
  });

  // 12 November: lowered from 140 to the runbook's own length after the review's additions, so it cannot grow again unnoticed.
  it("fits one page", () => {
    expect(book.split("\n").length).toBeLessThanOrEqual(134);
  });
});
