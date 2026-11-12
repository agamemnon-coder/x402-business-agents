// /runs and /agents/<id> (competitor gap list, 10 Nov): every live run in one list with its ids, checks and records,
// and one page per Kit 11 agent, every figure read from the records. docs/runs/README.md is the same list, generated.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { AGENT_IDS, agentView } from "../src/redesign/agents.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";
import { esc } from "../src/redesign/ui.js";
import { loadRecord, decisionsOf } from "../src/redesign/run.js";
import { KIND_LABEL, MAIN_RUN_GLOSSARY, kindOf, liveRuns, mdCell, runsPage, runsReadme, type RunKind, type RunRow } from "../src/redesign/runs.js";
import { loadTrace } from "../src/redesign/trace.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { visibleWords } from "./support/visibleWords.js";
import { scriptBlocks, scriptBody, withoutBlocks } from "./support/scriptBlocks.js";

const pages = buildPages({ ...process.env, TRY_SIGN_ENABLED: "on" }) as Pages;
const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const get = (path: string) => pageResponse(new Request(`https://kit11.example${path}`), pages);
/** Everything a visitor can read on a page, folds included: scripts, styles, drawings and tags stripped. */
const allText = (html: string) => text(withoutBlocks(html, ["script"], " "));
/** The run entries in a piece of the page: each one's classes, its key (the anchor), its HTML and its text. */
const entriesOf = (html: string) => [...html.matchAll(/<li class="run ([^"]*)" id="([^"]+)">([\s\S]*?)<\/li>/g)].map((m) => ({ cls: m[1]!.split(" "), key: m[2]!, html: m[3]!, text: allText(m[3]!) }));
/** The list of live runs, and the closed group of rehearsals after it. */
const liveList = (html: string) => /<ol class="tl">[\s\S]*?<\/ol>/.exec(html)?.[0] ?? "";
const rehGroup = (html: string) => /<details class="rehs" id="rehearsals">[\s\S]*?<\/ol>/.exec(html)?.[0] ?? "";
/** What an entry shows without opening its fold. */
const inSight = (entryHtml: string) => entryHtml.split("<details")[0]!;
const escAttr = esc;

describe("/runs", () => {
  const rows = liveRuns();

  it("lists the live runs newest first, the last one on top", () => {
    expect(rows.map((r) => r.key)).toEqual(["vic-3", "two-locks-1", "platform-e2e-1", "t0-1", "connected-1", "vic-2", "vic-1", "awx-1", "main-1", "agent-1", "tap-1", "friday-1"]);
    // The connected-accounts row, held to its run log: every id and amount on it is in the log.
    const cx = rows.find((r) => r.key === "connected-1")!;
    const cxLog = readFileSync("docs/runs/2026-11-10-connected-accounts-sandbox.md", "utf8");
    for (const id of cx.ids) expect(cxLog).toContain(id.value);
    for (const amount of `${cx.what} ${cx.checks}`.match(/EUR \d+\.\d{2}/g) ?? []) expect(cxLog).toContain(amount);
    expect(cxLog).toMatch(/17 calls in all/);
    expect(cx.checks).toMatch(/simulat/);
    // The platform end-to-end row, held to its run log the same way.
    const pe = rows.find((r) => r.key === "platform-e2e-1")!;
    const peLog = readFileSync("docs/runs/2026-11-10-platform-e2e.md", "utf8");
    for (const id of pe.ids.flatMap((x) => x.value.split(", "))) expect(peLog).toContain(id);
    for (const amount of `${pe.what} ${pe.checks}`.match(/EUR \d+\.\d{2}/g) ?? []) expect(peLog).toContain(amount);
    expect(pe.what).toMatch(/test passkey \(not Face ID\)/);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.iso >= rows[i]!.iso).toBe(true);
    expect(text(pages.runs!)).toContain(`Last live run: ${rows[0]!.date}`);
  });

  // The two-locks run has two dated logs: created and held on 10 Nov, approved at Airwallex and PAID on 12 Nov.
  const twoLocksFirst = () => readFileSync("docs/runs/2026-11-10-airwallex-two-locks.md", "utf8");
  const twoLocksPaid = () => readFileSync("docs/runs/2026-11-12-airwallex-two-locks-paid.md", "utf8");

  it("has a 12 Nov log of the two-locks run: the ids, IN_APPROVAL then PROCESSING then PAID, the signer and the approver", () => {
    const log = twoLocksPaid();
    for (const id of ["4074d684-4704-406c-a527-2832753baf4f", "c25bfc22-64fe-4ff3-aeb2-102a3684fc19", "SLL-2026-11B", "P-0001", "f9ba0fe8758eadbef3b48f23e571ea92e3208f4ebd802703b413a414d444ac28", "EUR 240.00", "Stockline Data GmbH"]) expect(log).toContain(id);
    // The steps of 12 Nov, each on its own line with its UTC time, in this order.
    const steps = [/09:35:59[^\n]*`IN_APPROVAL`/, /owner approved the transfer in the Airwallex sandbox web app[^\n]*Business Accounts, Transfers, Pending your approval/, /09:43:45[^\n]*`PROCESSING`/, /09:43:57[^\n]*`SENT`[^\n]*simulated settlement/, /09:43:58[^\n]*`PAID`[^\n]*simulated settlement/];
    const at = steps.map((re) => log.search(re));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The signer is the labelled virtual test passkey the tool enrols, by its own label; the approver is the owner.
    expect(readFileSync("src/cli/twoLocks.ts", "utf8")).toContain('TWO_LOCKS_PASSKEY_LABEL = "two-locks virtual test passkey"');
    expect(log).toMatch(/"two-locks virtual test passkey", a labelled virtual test passkey, not a person's device/);
    expect(log).toMatch(/At Airwallex[^\n]*the owner/);
    // The calls: 14 in total, 7 on each day, within the budget the owner raised.
    expect(log).toMatch(/14 Airwallex calls in total/);
    expect(log).toMatch(/from 10 to 12 to 14/);
    const counts = [...log.matchAll(/^\| `(?:POST|GET) [^`]+` \| (\d+) \|$/gm)].map((m) => Number(m[1]));
    expect(counts).toEqual([5, 3, 1, 3, 2]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(14);
    expect(log).toMatch(/7 of them on 10 November[^\n]*7 on 12 November/);
    // What it does not show, said plainly.
    expect(log).toMatch(/not by a real Face ID/);
    expect(log).toMatch(/approved only at Airwallex/);
    expect(log).toMatch(/`SENT` and `PAID` came from the sandbox's simulation endpoints/);
    // The 10 Nov log keeps its sentences and gains one dated line under its title that links this one.
    const first = twoLocksFirst().split("\n");
    expect(first[0]).toBe("# Two locks on one payout: the CFO's passkey, then Airwallex's own approval workflow (10 November 2026)");
    expect(first[2]).toMatch(/^\*\*12 November 2026:\*\* .*PAID.*\(2026-11-12-airwallex-two-locks-paid\.md\)/);
    expect(first.join("\n")).toMatch(/\*\*Not completed\.\*\*/);
    expect(log).toContain("(2026-11-10-airwallex-two-locks.md)");
  });

  it("holds the two-locks row to its two logs: it ends PAID, settlement simulated, a test passkey, approved by the owner at Airwallex", () => {
    const tl = rows.find((r) => r.key === "two-locks-1")!;
    const logs = twoLocksFirst() + twoLocksPaid();
    // The card is dated at the moment the transfer ended PAID, which the 12 Nov log has to the second.
    expect(tl.iso).toBe("2026-11-12T09:43:58.000Z");
    expect(tl.date).toBe("12 Nov 2026");
    expect(twoLocksPaid()).toMatch(/\(12 November 2026\)[\s\S]*09:43:58[^\n]*`PAID`/);
    // Every id and amount on the row is in the two logs taken together.
    expect(tl.ids.map((i) => i.value)).toEqual(["4074d684-4704-406c-a527-2832753baf4f", "c25bfc22-64fe-4ff3-aeb2-102a3684fc19", "P261110-48HWOJN", "P-0001", "f9ba0fe8758eadbef3b48f23e571ea92e3208f4ebd802703b413a414d444ac28"]);
    for (const id of tl.ids) expect(logs).toContain(id.value);
    const said = `${tl.what} ${tl.checks}`;
    const amounts = said.match(/EUR \d+\.\d{2}/g) ?? [];
    expect(amounts).toEqual(["EUR 240.00"]);
    for (const amount of amounts) expect(logs).toContain(amount);
    // The finished story, with its limits.
    expect(tl.what).toMatch(/[Cc]reated on 10 Nov/);
    expect(tl.what).toMatch(/test passkey \(not a person's Face ID\)/);
    expect(tl.what).toMatch(/the owner approved it in Airwallex's sandbox web app/);
    expect(said).toMatch(/PAID/);
    expect(said).toMatch(/simulat/);
    expect(said).not.toMatch(/not completed|is not paid|SCHEDULED/);
    expect(tl.checks).toMatch(/PROCESSING/);
    expect(tl.checks).toMatch(/14 Airwallex calls \(7 on 10 Nov, 7 on 12 Nov\)/);
    expect(twoLocksPaid()).toMatch(/14 Airwallex calls in total/);
    expect(`${tl.title} ${tl.rails}`).not.toMatch(/CFO/);
    // The entry's one line ends in PAID, said to be simulated settlement and signed by a test passkey; its amount is the
    // logs' (12 Nov, the timeline: the big numbers per card went, the one line replaces them).
    expect(tl.line).toMatch(/PAID/);
    expect(tl.line).toMatch(/settlement simulated/);
    expect(tl.line).toMatch(/test passkey/);
    expect(tl.line!.match(/EUR \d+\.\d{2}/g)).toEqual(["EUR 240.00"]);
    expect(`${tl.name} ${tl.line}`).not.toMatch(/CFO/);
    expect(tl.stats).toBeUndefined();
    // Both logs are linked, the 12 Nov one first, and both exist.
    expect(tl.files.map((f) => f.href)).toEqual(["../../docs/runs/2026-11-12-airwallex-two-locks-paid.md", "../../docs/runs/2026-11-10-airwallex-two-locks.md"]);
    for (const f of tl.files) expect(existsSync(f.href.replace("../../", ""))).toBe(true);
    // The page dates the last live run by it and shows it as the newest entry, under its plain name.
    expect(text(pages.runs!)).toContain("Last live run: 12 Nov 2026.");
    // The newest entry is vic-3 since 12 Nov, 14:3x (test/vic3-visa.test.ts); two-locks is the next.
    expect(entriesOf(liveList(pages.runs!))[0]!.key).toBe("vic-3");
    const first = entriesOf(liveList(pages.runs!)).find((x) => x.key === "two-locks-1")!;
    expect(inSight(first.html)).toContain(`<h2>${escAttr(tl.name!)}</h2>`);
    expect(inSight(first.html)).toContain('<time datetime="2026-11-12T09:43:58.000Z" title="12 Nov 2026">12 Nov</time>');
  });

  it("takes every id from its record", () => {
    const raw = (f: string) => readFileSync(f, "utf8");
    const main = rows.find((r) => r.key === "main-1")!;
    const trace = loadTrace();
    expect(main.ids.map((i) => i.value)).toContain(trace.payments.find((p) => p.kind === "transfer")!.ref);
    const awx = rows.find((r) => r.key === "awx-1")!;
    for (const i of awx.ids) expect(raw("docs/demo/airwallex-run.json")).toContain(i.value);
    const vic1 = rows.find((r) => r.key === "vic-1")!;
    for (const i of vic1.ids) expect(raw("docs/demo/airi-run.json")).toContain(i.value);
    const tap = rows.find((r) => r.key === "tap-1")!;
    for (const i of tap.ids) expect(raw("docs/runs/visa-tap-live-2026-11-02.json")).toContain(i.value);
    expect(rows.find((r) => r.key === "friday-1")!.ids[0]!.value).toBe(JSON.parse(raw("docs/demo/metal.json")).dispute.case_id);
  });

  it("labels every run's money and links files that exist", () => {
    for (const r of rows) {
      expect(r.money).toMatch(/test money|no money moved|Nothing bought/i);
      for (const f of r.files) if (f.href.startsWith(REPO_BLOB)) expect(existsSync(f.href.slice(REPO_BLOB.length))).toBe(true);
    }
  });

  // Review 12 Nov (DC-1): the rows typed from a markdown log carried "../../docs/runs/….md", right in docs/runs/README.md
  // and a 404 on the site. On the page every link is absolute, a fragment or a path the site serves; every repository link
  // points at a file in the checkout, a row added later with a "../../docs/…" href included.
  it("links nothing the site does not serve: every href is absolute, a fragment or a served path", () => {
    const hrefsOf = (html: string) => [...html.matchAll(/\shref="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
    const check = (html: string) => {
      const hrefs = hrefsOf(html);
      expect(hrefs.length).toBeGreaterThan(20);
      for (const href of hrefs) {
        if (href.startsWith("#")) continue;
        if (/^https:\/\//.test(href)) {
          if (href.startsWith(REPO_BLOB)) expect(existsSync(href.slice(REPO_BLOB.length).replace(/#.*$/, "")), href).toBe(true);
          continue;
        }
        const u = new URL(href, "https://kit11.example/runs");
        expect(u.origin, href).toBe("https://kit11.example");
        expect(get(u.pathname + u.search)?.status, href).toBe(200);
      }
    };
    check(pages.runs!);
    // A row in the old shape with a link relative to docs/runs/README.md opens the file on GitHub, on the page only.
    const later: RunRow = { ...rows.find((r) => r.key === "connected-1")!, key: "later-x", files: [{ label: "run log", href: "../../docs/runs/2026-11-10-connected-accounts-sandbox.md" }] };
    const page = runsPage([...rows, later]);
    check(page);
    expect(page).toContain(`href="${REPO_BLOB}docs/runs/2026-11-10-connected-accounts-sandbox.md"`);
    expect(page).not.toContain('href="../');
    // The README keeps its links relative to its own folder.
    expect(runsReadme([...rows, later])).toContain("[run log](../../docs/runs/2026-11-10-connected-accounts-sandbox.md)");
    expect(runsReadme()).not.toContain(REPO_BLOB);
  });

  it("explains main-run.json's fields, each one in the record", () => {
    const rec = JSON.parse(readFileSync("docs/demo/main-run.json", "utf8")) as Record<string, Record<string, unknown>>;
    for (const [k] of MAIN_RUN_GLOSSARY) {
      const [a, b] = k.split(".");
      expect(b ? Object.hasOwn(rec[a!]!, b) : Object.hasOwn(rec, a!)).toBe(true);
    }
  });

  it("escapes a table cell's backslashes before its pipes", () => {
    expect(mdCell("a|b")).toBe("a\\|b");
    expect(mdCell("a\\|b")).toBe("a\\\\\\|b");
    expect(mdCell("C:\\path")).toBe("C:\\\\path");
  });

  it("docs/runs/README.md is the same list (npx tsx src/cli/runs-readme.ts)", () => {
    expect(readFileSync("docs/runs/README.md", "utf8")).toBe(runsReadme());
  });

  it("is served by the Worker under a style-only policy", async () => {
    const r = get("/runs")!;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toMatch(/script-src|default-src 'none'/);
    expect(await r.text()).toContain("Every live run");
    // The policy is computed from the page's one inline script and one inline style: the page keeps to one of each.
    expect(scriptBlocks(pages.runs!)).toHaveLength(1);
    expect(pages.runs!.match(/<style>/g)).toHaveLength(1);
  });
});

// The timeline (jury, 12 Nov): plain names, rehearsals folded, series as rates, one run marked as the product, filters
// that work without JavaScript and never hide the newest run.
describe("/runs as a timeline", () => {
  const rows = liveRuns();
  const html = pages.runs!;
  const raw = (f: string) => readFileSync(f, "utf8");
  const row = (key: string) => rows.find((r) => r.key === key)!;
  // The kind of each run listed on 12 Nov. A row added later (in the old shape or the new) is held by the tests that
  // go over every row; the ones that name runs go over these.
  const KINDS: Record<string, RunKind> = {
    "vic-3": "sandbox", "two-locks-1": "sandbox", "platform-e2e-1": "sandbox", "t0-1": "sandbox", "connected-1": "sandbox", "vic-2": "nothing", "vic-1": "sandbox",
    "awx-1": "sandbox", "main-1": "both", "agent-1": "rehearsal", "tap-1": "sandbox", "friday-1": "rehearsal",
  };
  const known = (keys: string[]) => keys.filter((k) => k in KINDS);
  const CODE_NAMES = /\b(awx-1|vic-1|vic-2|vic-3|main-1|agent-1|friday-1|tap-1|rel-1b?|two-locks-1|platform-e2e-1|connected-1|t0-1)\b|\brun 1\b|\bsecond run\b/i;
  // Two rows a later session could add: a series of payouts reported as one entry, and a row in the old shape.
  const series: RunRow = {
    key: "series-x", iso: "2026-11-13T10:00:00.000Z", date: "13 Nov 2026", title: "A series of payouts", name: "Twenty supplier payouts in a row",
    line: "Twenty payouts were created; two were refused by the bank.", kind: "sandbox", rate: { done: 18, of: 20, what: "paid" },
    rails: "Airwallex sandbox (payouts)", what: "Twenty payouts.", checks: "Each read back.", money: "Sandbox · test money",
    ids: [{ label: "First payout", value: "pay-0001" }], files: [{ label: "run log", href: "../../docs/runs/series-x.md" }],
  };
  const oldShape: RunRow = {
    key: "old-x", iso: "2026-11-11T08:00:00.000Z", date: "11 Nov 2026", title: "Payouts to five suppliers", rails: "Airwallex sandbox (payouts), Claude",
    what: "Five payouts of EUR 1.50 were created. Each went PAID.", checks: "Each read back from Airwallex.", money: "Sandbox · test money",
    ids: [{ label: "Payout", value: "pay-aaaa-1111" }, { label: "Second payout", value: "pay-bbbb-2222" }], files: [{ label: "run log", href: "../../docs/runs/old-x.md" }],
    stats: [{ v: "5", l: "payouts created" }],
  };

  it("shows no code name in what a visitor reads: not in a name, a line, an id chip or a fold", () => {
    const t = allText(html);
    expect(t).toContain("Every live run");
    expect(CODE_NAMES.exec(t)?.[0]).toBeUndefined();
    // The keys stay as the rows' keys and as anchors, which are not text.
    expect(entriesOf(html).map((e) => e.key).sort()).toEqual(rows.map((r) => r.key).sort());
    // No row's own words carry one either (its name, line, what, checks, id labels and values, file labels).
    for (const r of rows) expect(CODE_NAMES.exec([r.name, r.line, r.what, r.checks, r.money, ...r.ids.flatMap((i) => [i.label, i.value]), ...r.files.map((f) => f.label)].join(" | "))?.[0]).toBeUndefined();
  });

  it("names every run by what it shows, with one line, each typed figure held to the run's log", () => {
    for (const r of rows.filter((x) => x.key in KINDS)) {
      expect(r.name, r.key).toBeTruthy();
      expect(r.line, r.key).toBeTruthy();
      expect(r.name!.length, r.key).toBeLessThanOrEqual(90);
      // One sentence, two at most, and short enough for three lines on a phone.
      expect(r.line!.length, r.key).toBeLessThanOrEqual(170);
      const e = entriesOf(html).find((x) => x.key === r.key)!;
      expect(e.html).toContain(`<h2>${escAttr(r.name!)}</h2>`);
      expect(e.html).toContain(`<p class="ln">${escAttr(r.line!)}`);
      // Its date, without the year the page's first line carries (the full date is the element's title).
      expect(r.date).toMatch(/^\d{1,2} \w{3} 2026$/);
      expect(e.html).toContain(`<time datetime="${r.iso}" title="${r.date}">${r.date.replace(" 2026", "")}</time>`);
    }
    // The rows typed from a markdown run log: every amount and count in the name and the line is in the log.
    const logs: Record<string, string> = {
      "two-locks-1": raw("docs/runs/2026-11-10-airwallex-two-locks.md") + raw("docs/runs/2026-11-12-airwallex-two-locks-paid.md"),
      "platform-e2e-1": raw("docs/runs/2026-11-10-platform-e2e.md"), "t0-1": raw("docs/runs/2026-11-10-t0-journal-sandbox.md"), "connected-1": raw("docs/runs/2026-11-10-connected-accounts-sandbox.md"),
    };
    for (const [key, log] of Object.entries(logs)) {
      const said = `${row(key).name} ${row(key).line}`;
      for (const amount of said.match(/EUR \d+\.\d{2}/g) ?? []) expect(log, `${key} ${amount}`).toContain(amount);
    }
    expect(logs["platform-e2e-1"]).toMatch(/three fictional companies/);
    expect(row("platform-e2e-1").line).toMatch(/A test passkey signed\./);
    expect(logs["platform-e2e-1"]).toMatch(/\*\*test passkey\*\*[^.]*it is not Face\s+ID/);
    expect(row("t0-1").line).toMatch(/0 differences/);
    expect(logs["t0-1"]).toMatch(/there are 0 differences/);
    expect(row("t0-1").line).toMatch(/second push posted 0/);
    expect(logs["t0-1"]).toMatch(/\*\*Second push:\*\* posted 0/);
    expect(row("connected-1").line).toMatch(/[Ss]imulated/);
    expect(row("two-locks-1").line).toMatch(/simulated/);
    // The computed lines say what was simulated where the record says so.
    expect(row("awx-1").line).toMatch(/SWIFT settlement simulated/);
    expect(row("tap-1").line).toMatch(/merchant was simulated/);
    expect(raw("docs/runs/visa-tap-live-2026-11-02.json")).toMatch(/a merchant we run, simulated/);
    expect(row("main-1").line).toMatch(/Simulated: customer, supplier, settlement, second approver\./);
    const v2 = JSON.parse(raw("docs/demo/vic-2-run.json")) as { outside_calls: { airi: number; airwallex: number }; planted_attack: string; label: string };
    expect(row("vic-2").line).toContain(`${v2.outside_calls.airi} Airi and ${v2.outside_calls.airwallex} Airwallex calls`);
    expect(v2.planted_attack).toMatch(/^our own planted attack/);
    expect(v2.label).toMatch(/^live: the CFO's Face ID on the relay/);
  });

  it("gives every run exactly one honest badge, the kind its record says", () => {
    expect(KIND_LABEL).toEqual({ sandbox: "Live sandbox", testnet: "Live testnet", both: "Live testnet and sandbox", simulated: "Simulated", rehearsal: "Rehearsal", nothing: "Live, nothing bought" });
    expect(known(rows.map((r) => r.key)).sort()).toEqual(Object.keys(KINDS).sort());
    for (const r of rows) {
      // Every row, exactly one badge of the allowed set: its kind's.
      const e = entriesOf(html).find((x) => x.key === r.key)!;
      const badges = [...e.html.matchAll(/<span class="kd [a-z]+">([^<]+)<\/span>/g)].map((m) => m[1]);
      expect(badges, r.key).toEqual([KIND_LABEL[kindOf(r)]]);
      expect(Object.values(KIND_LABEL)).toContain(badges[0]);
      expect(e.cls.filter((c) => c.startsWith("k-")), r.key).toEqual([`k-${kindOf(r)}`]);
    }
    for (const r of rows.filter((x) => x.key in KINDS)) {
      expect(r.kind, r.key).toBe(KINDS[r.key]);
      expect(kindOf(r)).toBe(KINDS[r.key]);
      // A row in the old shape (no kind of its own) gets the same badge from its rails and money words, except the one
      // whose money words say simulated (review 12 Nov, DC-4): the TAP run's merchant was simulated, so without its own
      // kind it can claim no more than Simulated; its explicit kind keeps it a live sandbox run.
      expect(kindOf({ ...r, kind: undefined }), r.key).toBe(r.key === "tap-1" ? "simulated" : KINDS[r.key]);
    }
    expect(row("tap-1").money).toBe("Simulated merchant · test money");
    // What the records say: the main run ran on Metal testnet and in the Airwallex sandbox; the second Airi run was live
    // and called nobody; the two rehearsals call themselves rehearsals.
    expect(row("main-1").rails).toMatch(/Metal testnet, Airwallex sandbox/);
    const v2 = JSON.parse(raw("docs/demo/vic-2-run.json")) as { mode: string; outside_calls: { airi: number; airwallex: number } };
    expect([v2.mode, v2.outside_calls.airi, v2.outside_calls.airwallex]).toEqual(["live", 0, 0]);
    expect(raw("docs/runs/2026-11-02-agent-run-1.md")).toMatch(/\(rehearsal\)/);
    for (const k of ["agent-1", "friday-1"]) expect(row(k).money).toMatch(/Rehearsal/);
    // The page says once, at the top, that every run used test money and where the simulated parts are said.
    expect(text(html)).toMatch(/Test money only; what was simulated is said on each run\./);
  });

  it("has a kind for a run on Purser's own fakes, Simulated, shown only when such a run is listed", () => {
    const fake: RunRow = { ...oldShape, key: "fake-x", iso: "2026-11-11T09:00:00.000Z", title: "A day on fake rails", rails: "Purser's own fake rails", money: "Simulated · test money" };
    expect(kindOf(fake)).toBe("simulated");
    const page = runsPage([...rows, { ...fake, kind: "simulated" }]);
    const e = entriesOf(page).find((x) => x.key === "fake-x")!;
    expect(e.html).toContain('<span class="kd simulated">Simulated</span>');
    expect(e.cls).toContain("f-simulated");
    expect(page).toMatch(/<a href="#simulated">Simulated <b>1<\/b><\/a>/);
    expect(html).not.toContain('<a href="#simulated">');
    expect(html).not.toContain('id="simulated"');
  });

  // Review 12 Nov (DC-4): an old-shape row for a run on Purser's own fakes that names the partners it faked was badged
  // "Live testnet and sandbox", counted as live and could become the last live run.
  it("never badges a row as live when its own words say simulated, fake or mock", () => {
    const faked: RunRow[] = [
      { ...oldShape, key: "fake-a", iso: "2026-11-13T09:00:00.000Z", date: "13 Nov 2026", title: "A day on simulated rails", rails: "Simulated Airwallex and Metal (Purser's own fakes)", money: "Simulated · test money" },
      { ...oldShape, key: "fake-b", iso: "2026-11-13T08:00:00.000Z", date: "13 Nov 2026", title: "Payouts on fakes", rails: "Fake Airwallex sandbox, fake Metal testnet", money: "Simulated · no partner called" },
      { ...oldShape, key: "fake-c", iso: "2026-11-13T07:00:00.000Z", date: "13 Nov 2026", title: "Payouts to a mock bank", rails: "Airwallex sandbox (mocked), Metal testnet", money: "Test money" },
    ];
    for (const f of faked) expect(kindOf(f), f.key).toBe("simulated");
    const page = runsPage([...rows, ...faked]);
    for (const f of faked) {
      const e = entriesOf(page).find((x) => x.key === f.key)!;
      expect(e.html, f.key).toContain('<span class="kd simulated">Simulated</span>');
      expect(e.html, f.key).not.toMatch(/class="kd (sandbox|testnet|both)"/);
      expect(e.cls, f.key).not.toEqual(expect.arrayContaining(["f-sandbox"]));
      expect(e.cls, f.key).not.toEqual(expect.arrayContaining(["f-testnet"]));
      // The partners it names are the ones it faked: no partner chip or filter for them.
      expect(e.cls.filter((c) => /^f-(airwallex|metal|visa)$/.test(c)), f.key).toEqual([]);
      expect(e.html, f.key).not.toMatch(/class="rl (awx|metal|visa)"/);
    }
    // Not counted as live sandbox or testnet runs, and not the last live run: the counts are today's.
    const count = (h: string, id: string) => Number(new RegExp(`<a href="#${id}">[^<]+ <b>(\\d+)</b>`).exec(h)?.[1] ?? 0);
    for (const id of ["sandbox", "testnet", "airwallex", "metal"]) expect(count(page, id), id).toBe(count(html, id));
    expect(count(page, "simulated")).toBe(3);
    expect(text(page)).toContain(`Last live run: ${rows[0]!.date}.`);
    expect(runsReadme([...rows, ...faked])).toContain(`**Last live run:** ${rows[0]!.date}.`);
    // "Rehearsal" is read from the money words, not from a title that mentions one.
    const after: RunRow = { ...oldShape, key: "again-x", title: "The main run again, after its rehearsal", rails: "Metal testnet, Airwallex sandbox", money: "Test money" };
    expect(kindOf(after)).toBe("both");
    expect(kindOf({ ...after, money: "Rehearsal · test money" })).toBe("rehearsal");
    // A row with its own kind keeps it.
    expect(kindOf({ ...faked[0]!, kind: "sandbox" })).toBe("sandbox");
  });

  it("cuts an old-shape row's one line at its first full sentence, not at an abbreviation or a date", () => {
    const line = (what: string) => {
      const e = entriesOf(runsPage([...rows, { ...oldShape, what }])).find((x) => x.key === "old-x")!;
      return /<p class="ln">([\s\S]*?) <a /.exec(e.html)![1];
    };
    expect(line("Paid on 12 Nov. at 09:00 UTC by the owner. Simulated settlement.")).toBe("Paid on 12 Nov. at 09:00 UTC by the owner.");
    expect(line("Paid on 12 Nov. 2026, then booked. Each read back.")).toBe("Paid on 12 Nov. 2026, then booked.");
    expect(line("Fees, e.g. EUR 0.05, were taken. Each read back.")).toBe("Fees, e.g. EUR 0.05, were taken.");
    expect(line("Five payouts of EUR 1.50 were created. Each went PAID.")).toBe("Five payouts of EUR 1.50 were created.");
    expect(line("One sentence only")).toBe("One sentence only");
    expect(line("Did it pay? Yes, PAID.")).toBe("Did it pay?");
  });

  it("keeps the rehearsals out of the live list, in one closed group with its count", () => {
    const live = entriesOf(liveList(html)), reh = entriesOf(rehGroup(html));
    expect(live.map((e) => e.key)).toEqual(rows.filter((r) => kindOf(r) !== "rehearsal").map((r) => r.key));
    expect(known(reh.map((e) => e.key))).toEqual(["agent-1", "friday-1"]);
    expect(reh.map((e) => e.key)).toEqual(rows.filter((r) => kindOf(r) === "rehearsal").map((r) => r.key));
    for (const e of live) expect(e.cls).not.toContain("k-rehearsal");
    // Closed by default (no open attribute), named with its count, with one link to the folder of the dry runs' logs.
    expect(html).toContain(`<details class="rehs" id="rehearsals"><summary>Rehearsals and dry runs · ${reh.length}`);
    expect(rehGroup(html) + html.slice(html.indexOf(rehGroup(html)) + rehGroup(html).length).split("</details>")[0]).toMatch(/<a class="f" href="https:\/\/github\.com\/agamemnon-coder\/x402-business-agents\/tree\/main\/docs\/runs"[^>]*>docs\/runs on GitHub/);
    expect(existsSync("docs/runs")).toBe(true);
    // Rehearsals do not count as live runs.
    expect(text(html)).toContain(`${live.length} live runs, newest first`);
    expect(known(live.map((e) => e.key))).toHaveLength(10);
  });

  it("marks exactly one run as the product: the main run", () => {
    expect(rows.filter((r) => r.product).map((r) => r.key)).toEqual(["main-1"]);
    const marked = entriesOf(html).filter((e) => e.cls.includes("prod"));
    expect(marked.map((e) => e.key)).toEqual(["main-1"]);
    expect(inSight(marked[0]!.html)).toContain('<span class="mk prod">The product, end to end</span>');
    expect(html.match(/class="mk prod"/g)).toHaveLength(1);
  });

  it("filters by partner and by kind with plain links and CSS, and never hides the newest run", () => {
    const live = entriesOf(liveList(html));
    const nav = /<nav class="flt" aria-label="Filter the runs">([\s\S]*?)<\/nav>/.exec(html)![1]!;
    const links = [...nav.matchAll(/<a(?: class="all")? href="#([a-z]+)">([^<]+) <b>(\d+)<\/b><\/a>/g)].map((m) => ({ id: m[1]!, label: m[2]!, n: Number(m[3]) }));
    expect(nav.match(/<a /g)).toHaveLength(links.length);
    // All first, then the partners, then the kinds present; only filters with at least one run.
    expect(links.map((l) => [l.id, l.label])).toEqual([["all", "All"], ["airwallex", "Airwallex"], ["metal", "Metal"], ["visa", "Visa"], ["claude", "Claude"], ["sandbox", "Live sandbox"], ["testnet", "Live testnet"]]);
    expect(links[0]!.n).toBe(live.length);
    for (const l of links.slice(1)) {
      expect(l.n, l.id).toBe(live.filter((e) => e.cls.includes(`f-${l.id}`)).length);
      expect(l.n, l.id).toBeGreaterThan(0);
    }
    // Which runs carry which filter: from their rails and kind.
    const carrying = (id: string) => known(live.filter((e) => e.cls.includes(`f-${id}`)).map((e) => e.key));
    expect(carrying("metal")).toEqual(["main-1"]);
    expect(carrying("testnet")).toEqual(["main-1"]);
    expect(carrying("claude")).toEqual(["vic-3", "platform-e2e-1", "main-1"]);
    // Review 12 Nov (DC-3): a partner's chip, class and count are for the runs it took part in, by the records. The second
    // Airi run made 0 Airi and 0 Airwallex calls: no Airwallex, no Visa. Visa: the runs that used a Visa credential.
    expect(carrying("visa")).toEqual(["vic-3", "vic-1", "tap-1"]);
    expect(carrying("airwallex")).toEqual(["vic-3", "two-locks-1", "platform-e2e-1", "connected-1", "vic-1", "awx-1", "main-1", "tap-1"]);
    const v2 = JSON.parse(raw("docs/demo/vic-2-run.json")) as { outside_calls: { airi: number; airwallex: number } };
    expect([v2.outside_calls.airi, v2.outside_calls.airwallex]).toEqual([0, 0]);
    const v2e = live.find((e) => e.key === "vic-2")!;
    expect(v2e.cls.filter((c) => /^f-(airwallex|visa|metal|claude)$/.test(c))).toEqual([]);
    expect(v2e.html).not.toMatch(/class="rl (awx|visa)"/);
    expect(row("vic-2").partners).toEqual([]);
    expect(links.find((l) => l.id === "visa")!.n).toBe(3);
    expect(links.find((l) => l.id === "airwallex")!.n).toBe(8);
    expect(carrying("sandbox")).toEqual(["vic-3", "two-locks-1", "platform-e2e-1", "t0-1", "connected-1", "vic-1", "awx-1", "main-1", "tap-1"]);
    // Each filter is an empty anchor before the list (a sibling the CSS can select from), and so is "All".
    const listAt = html.indexOf('<ol class="tl">');
    for (const l of links) {
      const at = html.indexOf(`<span class="fa" id="${l.id}"></span>`);
      expect(at, l.id).toBeGreaterThan(-1);
      expect(at, l.id).toBeLessThan(listAt);
      expect(at, l.id).toBeLessThan(html.indexOf('<nav class="flt"'));
    }
    // The hiding is CSS only, on :target, one rule per filter; every rule that hides a run excludes the newest one.
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    // Review 12 Nov (DC-6): a filter tap does not jump to the top. The anchors sit directly before the filter row, in the
    // flow, with no height and a margin for the sticky header (without the script a tap lands at the filter row); with
    // the script on they take no box, so going to one does not scroll, and the focus stays on the tapped link.
    expect(html).toMatch(/<span class="fa" id="all"><\/span>(?:<span class="fa" id="[a-z]+"><\/span>)+\n<nav class="flt"/);
    expect(css).toContain(".runsp .fa { display: block; height: 0; scroll-margin-top: 72px; } .runsp.js .fa { display: none; }");
    expect(css).not.toMatch(/\.fa \{[^}]*position: absolute/);
    const script = scriptBody(scriptBlocks(html)[0]!);
    expect(script).toContain('document.querySelector("main.runsp").classList.add("js");');
    expect(script).toContain("a.focus({ preventScroll: true });");
    const hiding = css.split("}").filter((rule) => /li\.run/.test(rule.split("{")[0]!) && /display:\s*none/.test(rule));
    expect(hiding.length).toBeGreaterThanOrEqual(links.length - 1);
    for (const rule of hiding) for (const selector of rule.split("{")[0]!.split(",")) expect(selector).toMatch(/:target[^,]*:not\(\.newest\)/);
    for (const l of links.slice(1)) expect(css).toContain(`#${l.id}:target ~ ol.tl > li.run:not(.f-${l.id}):not(.newest)`);
    expect(css).not.toMatch(/#all:target[^{]*\{[^}]*display:\s*none/);
    // The first row is the newest: it carries the class and a small mark, and it is a PAID run.
    expect(live.filter((e) => e.cls.includes("newest")).map((e) => e.key)).toEqual([live[0]!.key]);
    // Since 12 Nov, 14:35 UTC the newest is vic-3: one purchase paid after the CFO's Face ID, said as its rate.
    expect(known(live.map((e) => e.key))[0]).toBe("vic-3");
    expect(inSight(live[0]!.html)).toContain('<span class="mk new">Newest</span>');
    expect(inSight(live[0]!.html)).toMatch(/\d+ of \d+ purchases paid/);
    // Nothing in the filtering depends on the script: it only names the active link and copies ids.
    const js = scriptBody(scriptBlocks(html)[0]!);
    expect(js).toContain("aria-current");
    expect(js).not.toMatch(/display|hidden = true;[^}]*li\.run/);
  });

  it("reports a series as a rate: today's checks from their records, a later run's \"N of M paid\"", () => {
    const counted = (file: string) => {
      const all = Object.values((JSON.parse(raw(file)) as { checks: Record<string, { ok: boolean }> }).checks);
      return { done: all.filter((c) => c.ok).length, of: all.length, what: "checks passed" };
    };
    expect(row("awx-1").rate).toEqual(counted("docs/demo/airwallex-run.json"));
    expect(row("vic-1").rate).toEqual(counted("docs/demo/airi-run.json"));
    expect(row("vic-2").rate).toEqual(counted("docs/demo/vic-2-run.json"));
    // Two rates typed from a markdown run log, held to it: the journal entries posted and the payouts paid.
    const t0 = raw("docs/runs/2026-11-10-t0-journal-sandbox.md");
    expect(row("t0-1").rate).toEqual({ done: 95, of: 95, what: "entries posted" });
    expect(t0).toMatch(/\| Posted \| 95 of 95\./);
    const pe = raw("docs/runs/2026-11-10-platform-e2e.md");
    expect(row("platform-e2e-1").rate).toEqual({ done: (pe.match(/\| \*\*PAID\*\* /g) ?? []).length, of: (pe.match(/\| \*\*PAID\*\* |\| \*\*refused at create\*\* /g) ?? []).length, what: "payouts paid" });
    expect(row("platform-e2e-1").rate).toEqual({ done: 1, of: 4, what: "payouts paid" });
    expect(known(rows.filter((r) => r.rate).map((r) => r.key))).toEqual(["vic-3", "platform-e2e-1", "t0-1", "vic-2", "vic-1", "awx-1"]);
    for (const r of rows.filter((x) => x.rate)) {
      const e = entriesOf(html).find((x) => x.key === r.key)!;
      const words = `${r.rate!.done} of ${r.rate!.of} ${r.rate!.what}`;
      // A full rate carries the tick and the colour of success; one that fell short carries neither.
      const full = r.rate!.done === r.rate!.of;
      expect(inSight(e.html), r.key).toMatch(new RegExp(full ? `<span class="rt ok"><svg[^>]*>.*?</svg>${words}</span>` : `<span class="rt">${words}</span>`));
      expect(runsReadme()).toContain(words);
    }
    for (const r of rows.filter((x) => !x.rate)) expect(entriesOf(html).find((x) => x.key === r.key)!.html, r.key).not.toContain('class="rt');
    // A later session reports a whole series of payouts as one entry.
    const page = runsPage([...rows, series]);
    const e = entriesOf(liveList(page))[0]!;
    expect(e.key).toBe("series-x");
    expect(e.cls).toContain("newest");
    expect(inSight(e.html)).toContain('<span class="rt">18 of 20 paid</span>');
    expect(text(page)).toContain("Last live run: 13 Nov 2026.");
    expect(entriesOf(page).filter((x) => x.cls.includes("newest"))).toHaveLength(1);
    const readme = runsReadme([...rows, series]);
    expect(readme).toContain("18 of 20 paid");
    expect(readme).toContain("**Last live run:** 13 Nov 2026.");
    expect(readme).toContain("Twenty supplier payouts in a row");
  });

  it("still renders a row in the old shape truthfully: name, derived badge, date, first id, record link", () => {
    const page = runsPage([...rows, oldShape]);
    const e = entriesOf(liveList(page)).find((x) => x.key === "old-x")!;
    const seen = inSight(e.html);
    expect(seen).toContain("<h2>Payouts to five suppliers</h2>");
    expect(seen).toContain('<span class="kd sandbox">Live sandbox</span>');
    expect(seen).toContain('<time datetime="2026-11-11T08:00:00.000Z" title="11 Nov 2026">11 Nov</time>');
    // Its what, cut at the first sentence, is its one line (the decimal point in an amount does not end it).
    expect(seen).toContain('<p class="ln">Five payouts of EUR 1.50 were created.');
    expect(seen).not.toContain("Each went PAID.");
    expect(seen).toContain("pay-aaaa-1111");
    expect(seen).not.toContain("pay-bbbb-2222");
    expect(seen).toContain(`<a class="f" href="${REPO_BLOB}docs/runs/old-x.md" target="_blank" rel="noopener" aria-label="run log">Log ↗</a>`);
    expect(seen).not.toContain('class="rt');
    // The partners come from its rails; it sits in date order; its big numbers are listed quietly in its fold.
    expect(e.cls).toEqual(expect.arrayContaining(["k-sandbox", "f-airwallex", "f-claude", "f-sandbox"]));
    expect(entriesOf(liveList(page)).map((x) => x.key).slice(0, 3)).toEqual(["vic-3", "two-locks-1", "old-x"]);
    const fold = e.html.slice(seen.length);
    expect(fold).toContain("pay-bbbb-2222");
    expect(fold).toContain("Five payouts of EUR 1.50 were created. Each went PAID.");
    expect(fold).toContain("5 payouts created");
    expect(seen).not.toContain("5 payouts created");
    expect(runsReadme([...rows, oldShape])).toContain("Payouts to five suppliers");
  });

  it("shows the first id in sight and lists every id in full in the fold, with the longer text, the checks, the rails and the money words", () => {
    for (const r of rows.filter((x) => kindOf(x) !== "rehearsal")) {
      const e = entriesOf(liveList(html)).find((x) => x.key === r.key)!;
      const seen = inSight(e.html), fold = e.html.slice(seen.length);
      // One fold per entry, named by what is in it and how many more ids.
      expect(e.html.match(/<details/g), r.key).toHaveLength(1);
      const more = r.ids.slice(1).filter((i) => i.value !== "Trace any payment").length;
      expect(fold, r.key).toContain(`<summary aria-label="Ids, what ran and the checks${more ? `: ${more} more id${more === 1 ? "" : "s"}` : ""}">`);
      if (r.ids[0]) expect(seen, r.key).toContain(escAttr(r.ids[0].value));
      for (const i of r.ids.slice(1)) expect(seen, r.key).not.toContain(escAttr(i.value));
      // Review 12 Nov (DC-2): the chip in sight may be cut on a phone; the fold lists every id, the first one included,
      // under its full label, so each can be read in full without JavaScript.
      const foldIds = [...fold.matchAll(/<span class="idc"><span class="k">([^<]+)<\/span><(?:a|code) class="v"[^>]*>([^<]+?)(?: ↗)?<\/(?:a|code)>/g)].map((m) => [m[1], m[2]]);
      expect(foldIds, r.key).toEqual(r.ids.map((i) => [escAttr(i.label), escAttr(i.value)]));
      // A link relative to docs/runs/README.md opens the file on GitHub from the page.
      for (const f of r.files) expect(seen, r.key).toContain(`href="${f.href.replace(/^\.\.\/\.\.\//, REPO_BLOB)}"`);
      for (const part of [r.what, r.checks, r.rails, r.money]) expect(fold, r.key).toContain(escAttr(part));
      expect(seen, r.key).not.toContain(escAttr(r.checks));
    }
    // In the rehearsals group (itself the fold) an entry shows the same parts without a fold of its own.
    for (const e of entriesOf(rehGroup(html))) {
      expect(e.html).not.toContain("<details");
      for (const part of [row(e.key).what, row(e.key).checks, row(e.key).money]) expect(e.html).toContain(escAttr(part));
      // Review 12 Nov (DC-8): what ran is said once; an entry whose one line already says it does not repeat it below.
      expect(e.text.split(row(e.key).what).length - 1, e.key).toBe(1);
      expect(e.html, e.key).toContain(`Rails: ${escAttr(row(e.key).rails)}. Money: ${escAttr(row(e.key).money)}.`);
      // Every id once, in full, in the list under it (no cut chip above it).
      expect(/<div class="ch">([^\n]*)<\/div>/.exec(e.html)![1], e.key).not.toContain('class="idc"');
      for (const i of row(e.key).ids) expect(e.text.split(i.value).length - 1, `${e.key} ${i.value}`).toBe(1);
    }
    // No id chip names a run by its code name: the second Airi run shows the hash the CFO signed, from its record.
    const v2 = JSON.parse(raw("docs/demo/vic-2-run.json")) as { audit: { event: string; payload: { terms_sha256?: string } }[] };
    expect(row("vic-2").ids[0]!.value).toBe(v2.audit.find((a) => a.event === "proposal.created")!.payload.terms_sha256);
    expect(row("vic-2").ids[0]!.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the moment of each connected-account payout beside its own record, so two runs of one day never read as one", () => {
    // The orchestrator, 12 Nov: /runs showed EUR 5.00 with a EUR 0.05 fee while /airwallex shows EUR 4.84 with EUR 0.02;
    // both are real sandbox runs of 10 Nov. Each entry's line names its run's moment (from its own iso), its amount and
    // its fee, and the link right after the line opens that run's own log.
    const html = pages.runs!;
    const cases = [
      { key: "connected-1", moment: "10 Nov, 05:02 UTC", amount: "EUR 5.00", fee: "EUR 0.05", log: "docs/runs/2026-11-10-connected-accounts-sandbox.md" },
      { key: "platform-e2e-1", moment: "10 Nov, 07:06 UTC", amount: "EUR 4.84", fee: "EUR 0.02", log: "docs/runs/2026-11-10-platform-e2e.md" },
    ];
    for (const c of cases) {
      const row = rows.find((r) => r.key === c.key)!;
      expect(row.iso.slice(11, 16)).toBe(c.moment.slice(8, 13));
      const ln = /<p class="ln">([\s\S]*?)<\/p>/.exec(entriesOf(html).find((e) => e.key === c.key)!.html)![1]!;
      const line = allText(ln.split("<a ")[0]!);
      for (const w of [`Run of ${c.moment}`, c.amount, c.fee]) expect({ key: c.key, w, has: line.includes(w) }).toEqual({ key: c.key, w, has: true });
      // The first link after the line is this run's own log, and the log has the amount, the fee and the moment.
      expect(/<a class="f" href="([^"]+)"/.exec(ln)?.[1]).toBe(`${REPO_BLOB}${c.log}`);
      const log = readFileSync(c.log, "utf8");
      for (const w of [c.amount, c.fee, c.moment.slice(8, 13)]) expect({ log: c.log, w, has: log.includes(w) }).toEqual({ log: c.log, w, has: true });
      // The fold says the same moment.
      expect(row.what).toContain(`(${c.moment})`);
    }
  });

  it("starts its title with Purser, once", () => {
    expect(html).toContain("<title>Purser · Every live run</title>");
    expect(html).toContain('<meta property="og:title" content="Purser · Every live run">');
    expect(html).toContain("<h1>Every live run</h1>");
  });

  it("docs/runs/README.md lists the live runs under their plain names, then the rehearsals in a smaller table", () => {
    const md = runsReadme();
    const [liveTable, rest] = md.split("## Rehearsals and dry runs");
    expect(rest).toBeDefined();
    const rehTable = rest!.split("## What")[0]!;
    for (const r of rows) {
      const table = kindOf(r) === "rehearsal" ? rehTable : liveTable!;
      expect(table, r.key).toContain(`**${mdCell(r.name ?? r.title)}**`);
      // Its line of the table: the kind once, then the money words the kind does not already say.
      const line = table.split("\n").find((l) => l.includes(`**${mdCell(r.name ?? r.title)}**`))!;
      expect(line, r.key).toContain(`<br>${KIND_LABEL[kindOf(r)]}`);
      expect(line, r.key).toMatch(/test money|nothing bought/i);
      expect(line, r.key).not.toMatch(/Rehearsal · Rehearsal|nothing bought · Nothing bought/i);
      for (const f of r.files) expect(table, r.key).toContain(`[${f.label}](`);
    }
    expect(liveTable).toContain("| Date | Run | Rails | What ran | Checks | Key ids | Files |");
    expect(rehTable).toContain("| Date | Run | What ran | Key ids | Files |");
    expect(liveTable).not.toContain(row("agent-1").name!);
    expect(liveTable).toContain("The product, end to end");
    // Review 12 Nov (DC-9): each row says what the page's entry says was simulated: every sentence of its one line that
    // says simulated, fake or mock is in its row of the table (the main run and its rehearsal included).
    const rowOf = (r: RunRow) => md.split("\n").find((l) => l.includes(`**${mdCell(r.name ?? r.title)}**`))!;
    const saidSimulated = (r: RunRow) => r.line!.split(/(?<=[.!?]) (?=[A-Z0-9])/).filter((x) => /simulat|fake|mock/i.test(x));
    let simulated = 0;
    for (const r of rows) for (const sentence of saidSimulated(r)) {
      expect(rowOf(r), r.key).toContain(mdCell(sentence));
      simulated++;
    }
    expect(simulated).toBeGreaterThanOrEqual(7);
    for (const k of ["main-1", "agent-1"]) expect(rowOf(row(k)), k).toContain("Simulated: customer, supplier, settlement, second approver.");
    // The name a run goes by in the docs follows its plain name, only where the docs use that name.
    const docs = readdirSync("docs", { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".md") && f !== "runs/README.md").map((f) => raw(`docs/${f}`)).join("\n");
    const named = [...md.matchAll(/\(in the docs: `([^`]+)`\)/g)].map((m) => m[1]!);
    expect(named.sort()).toEqual(["agent-1", "awx-1", "friday-1", "main-1", "vic-1", "vic-2"]);
    for (const n of named) expect(docs, n).toMatch(new RegExp(`\\b${n}\\b`));
  });

  it("keeps each entry short and the frame around the entries short, so that a truthful row added later stays green", () => {
    // 12 Nov: 479 words in sight as built (501 before the timeline). Review 12 Nov (DC-5): one pin on the whole page went
    // red at the next row added; the pins are now per entry (60 words in sight at most) and on the frame around the
    // entries: the heading, the line, the filters, the closed groups and the last links (68 words as of the review fix;
    // the pin leaves room for one more filter, such as "Simulated 1").
    const frame = (h: string) => visibleWords(h.replace(liveList(h), ""));
    for (const page of [html, runsPage([...rows, oldShape]), runsPage([...rows, oldShape, series])]) {
      // 12 Nov (wire-in): +12 for the one "Face ID to paid" line (master list 81, src/redesign/runTimes.ts).
      expect(frame(page)).toBeLessThanOrEqual(84);
      for (const e of entriesOf(liveList(page))) expect(visibleWords(`<main>${e.html}</main>`), e.key).toBeLessThanOrEqual(60);
    }
    // The frame is what is not an entry: the page is the frame plus its entries.
    const entryWords = entriesOf(liveList(html)).reduce((n, e) => n + visibleWords(`<main>${e.html}</main>`), 0);
    expect(frame(html) + entryWords).toBe(visibleWords(html));
  });
});

describe("/agents/<id>", () => {
  const rec = loadRecord().record, trace = loadTrace();

  it("one page per Kit 11 agent; anything else is not a page", () => {
    expect(AGENT_IDS).toEqual(["sourcing", "support", "treasury"]);
    for (const id of AGENT_IDS) expect(get(`/agents/${id}`)!.status).toBe(200);
    expect(get("/agents/customer")).toBeNull();
    expect(get("/agents/__proto__")).toBeNull();
    expect(get("/agents/Sourcing")).toBeNull();
  });

  it("reads limits, decisions and payments from the records", () => {
    for (const id of AGENT_IDS) {
      const v = agentView(id, rec, trace);
      expect(v.decisions.length).toBe(decisionsOf(rec).filter((d) => d.agent === id).length);
      expect(v.payments.length).toBe(trace.payments.filter((p) => (p as unknown as { origin: { agent?: string } }).origin?.agent === id).length);
      const t = text(pages.agents![id]!.page);
      if (v.card) expect(t).toContain(`····${v.card.last4}`);
      for (const d of v.decisions) if (d.requestId) expect(t).toContain(d.requestId);
      expect(t).toContain(`What Claude decided · ${v.decisions.length}`);
      expect(t).toContain("test money");
    }
    expect(agentView("sourcing", rec, trace).payments.length).toBe(42);
    expect(agentView("support", rec, trace).payments.length).toBe(3);
  });

  it("links and assets work one level down", () => {
    for (const id of AGENT_IDS) {
      const html = pages.agents![id]!.page;
      expect(html).not.toMatch(/(href|src)="(?!https?:|#|\/|data:)/);
      expect(html).not.toMatch(/url\(assets\//);
    }
  });

  it("say none of the site's forbidden words (test/site-v4.test.ts)", () => {
    for (const html of [pages.runs!, ...AGENT_IDS.map((id) => pages.agents![id]!.page)]) expect(text(html)).not.toMatch(/warehouse software|stand-in|\bdry-1\d*|every limit|can['’]t break/i);
  });

  it("are linked from /runs", () => {
    for (const id of AGENT_IDS) expect(pages.runs).toContain(`href="agents/${id}"`);
  });
});
