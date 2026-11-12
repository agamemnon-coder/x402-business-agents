// The Airwallex dossier (docs/airwallex.md) is what an Airwallex judge reads after the page. Jury panel, 12 Nov: the
// dossier had fallen behind the runs. Since then every claim in it rests on a run of record, and this file holds it
// there. It breaks when the dossier shows an id, an amount, a call count or an endpoint that its run record does not
// hold, links a file that does not exist, leans on a 29 October rehearsal for a step the Airwallex-only run made, loses
// one of the sections on Airwallex products added that day, or grows beyond its length of before.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { oldNamesIn } from "../src/demo/oldNames.js";

const root = (p: string) => new URL(`../${p}`, import.meta.url);
const read = (p: string) => readFileSync(root(p), "utf8");
const json = <T>(p: string) => JSON.parse(read(p)) as T;

const DOSSIER = read("docs/airwallex.md");

/** Every text file under a folder, as paths from the repository's root. */
function textFiles(dir: string): string[] {
  return readdirSync(root(dir)).flatMap((name) => {
    const p = `${dir}/${name}`;
    if (statSync(root(p)).isDirectory()) return textFiles(p);
    return /\.(md|json|jsonl|txt|log)$/.test(name) ? [p] : [];
  });
}
/** The run records: everything under docs/runs and docs/demo. */
const RECORDS = new Map([...textFiles("docs/runs"), ...textFiles("docs/demo")].map((p) => [p, read(p)]));

/** The dossier's sections: from one "## " heading to the next. */
const SECTIONS = DOSSIER.split(/^(?=## )/m).map((text) => ({ title: /^## (.*)$/m.exec(text)?.[1] ?? "(top)", text }));
function section(title: RegExp): string {
  const s = SECTIONS.find((x) => title.test(x.title));
  if (!s) throw new Error(`docs/airwallex.md has no section ${String(title)}`);
  return s.text;
}
/** From a "### " heading inside a section to the next one. */
function sub(text: string, title: RegExp): string {
  const s = text.split(/^(?=### )/m).find((x) => title.test(/^### (.*)$/m.exec(x)?.[1] ?? ""));
  if (!s) throw new Error(`no subsection ${String(title)}`);
  return s;
}

/** The files a text links with Markdown links, as paths from the repository's root (the dossier lives in docs/). */
function linked(text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!)
    .filter((t) => !/^https?:/.test(t) && !t.startsWith("#"))
    .map((t) => new URL(t.split("#")[0]!, "file:///docs/").pathname.slice(1));
}
/** The run records a text links, with their contents. */
const linkedRecords = (text: string) => linked(text).filter((p) => RECORDS.has(p)).map((p) => RECORDS.get(p)!);

/** Airwallex ids and hashes written out in full: UUIDs, acct_, int_, mdt_, tr_ and SHA-256 values. */
const FULL_ID = /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|acct_[A-Za-z0-9_-]{10,}|int_[a-z0-9]{10,}|mdt_[a-z0-9]{10,}|tr_[A-Za-z0-9_-]{15,}|[0-9a-f]{64})\b/g;
/** Ids cut short for the eye: eight hex digits and an ellipsis. */
const SHORT_ID = /\b([0-9a-f]{8})…/g;
/** Money as the dossier writes it: "EUR 1,850.00" or "19.99 EUR". */
const AMOUNT = /\b(?:EUR|USD|GBP) (\d[\d,]*\.\d{2})\b|\b(\d[\d,]*\.\d{2}) (?:EUR|USD|GBP)\b/g;
const plain = (t: string) => t.replace(/(\d),(?=\d{3})/g, "$1");
const hasNumber = (text: string, n: string) => new RegExp(`(?<![\\d.])${n.replace(".", "\\.")}(?!\\d)`).test(text);

const AWX = json<{
  cards: { last4: string; read_back: { per_tx: string; monthly: string } }[];
  card_transactions: { id: string; amount: string; approved: boolean; decline_code: string | null }[];
  declines_met: { transaction_id: string; decline_code: string; proposal_id: string | null }[];
  invoices: { invoice_no: string; free_eur: string; need_eur: string; quote: { quote_id: string; buy_eur: string; sell_usd: string; rate: string } | null; conversion_id: string | null; transfer_id: string; fee: string; approval_sha256: string }[];
  calls: { airwallex: { endpoint: string; calls: number }[]; airwallex_total: number; budget: number };
}>("docs/demo/airwallex-run.json");
const AWX_LOG = "docs/runs/2026-11-07-awx-1.md";
const AWX_RECORD = "docs/demo/airwallex-run.json";

describe("the Airwallex dossier cites the runs of record", () => {
  it("links every run record it rests on, and every linked file exists", () => {
    const links = linked(DOSSIER);
    expect(links.filter((p) => !existsSync(root(p)))).toEqual([]);
    for (const record of [
      "docs/runs/2026-11-03-main-run.md", "docs/demo/main-run.json",
      "docs/runs/airwallex-transfer-approval-2026-11-06.json", "docs/runs/airwallex-cards-2026-11-06.json",
      AWX_LOG, AWX_RECORD, "docs/runs/2026-11-07-vic-1.md", "docs/demo/airi-run.json",
      "docs/runs/2026-11-10-airwallex-two-locks.md", "docs/runs/2026-11-10-connected-accounts-sandbox.md",
      "docs/runs/2026-11-10-platform-e2e.md", "docs/runs/2026-11-10-platform-e2e/facts.json",
      "docs/runs/2026-11-10-payment-acceptance-sandbox.md",
    ]) expect({ record, linked: links.includes(record) }).toEqual({ record, linked: true });
  });

  it("names no file in code type that does not exist", () => {
    const paths = [...DOSSIER.matchAll(/`((?:src|test|docs|worker|cloud|fixtures)\/[A-Za-z0-9_./-]+\.[a-z0-9]+)`/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThan(10);
    expect(paths.filter((p) => !existsSync(root(p)))).toEqual([]);
  });

  it("shows no Airwallex id or hash that a run record under docs/runs or docs/demo does not hold", () => {
    const all = [...RECORDS.values()].join("\n");
    const ids = [...new Set(DOSSIER.match(FULL_ID) ?? [])];
    expect(ids.length).toBeGreaterThan(25);
    expect(ids.filter((id) => !all.includes(id))).toEqual([]);
    const short = [...new Set([...DOSSIER.matchAll(SHORT_ID)].map((m) => m[1]!))];
    expect(short.filter((id) => !new RegExp(`\\b${id}`).test(all))).toEqual([]);
  });

  it("links, in the same section, a record that holds each id shown there", () => {
    for (const s of SECTIONS) {
      const records = linkedRecords(s.text).join("\n");
      const full = [...new Set(s.text.match(FULL_ID) ?? [])].filter((id) => !records.includes(id));
      const short = [...new Set([...s.text.matchAll(SHORT_ID)].map((m) => m[1]!))].filter((id) => !new RegExp(`\\b${id}`).test(records));
      expect({ section: s.title, not_in_a_linked_record: [...full, ...short] }).toEqual({ section: s.title, not_in_a_linked_record: [] });
    }
  });

  it("states no amount in a run's section that the records linked there do not hold", () => {
    const runs = [/Airwallex-only run/, /hash the CFO signed/, /Airi/, /^Transfer approvals/, /^Connected accounts and application fees/, /^Payment acceptance/];
    for (const title of runs) {
      const text = section(title);
      const records = plain(linkedRecords(text).join("\n"));
      const amounts = [...new Set([...text.matchAll(AMOUNT)].map((m) => plain(m[1] ?? m[2]!)))];
      expect(amounts.length).toBeGreaterThan(0);
      expect({ section: String(title), not_in_a_linked_record: amounts.filter((a) => !hasNumber(records, a)) }).toEqual({ section: String(title), not_in_a_linked_record: [] });
    }
  });
});

describe("no rehearsal stands in for a run of record", () => {
  it("names no company that left the story and carries no footnote mark", () => {
    expect(oldNamesIn(DOSSIER)).toEqual([]);
    expect(DOSSIER.includes("†")).toBe(false);
  });

  it("says plainly, on the same line, that a 29 October citation is an earlier rehearsal", () => {
    const lines = DOSSIER.split("\n").filter((l) => l.includes("2026-10-29"));
    expect(lines.filter((l) => !(/29 October/.test(l) && /rehearsal/.test(l)))).toEqual([]);
  });

  // The Airwallex-only run's record lists every endpoint it called. Each has its row in the dossier, in a section that
  // links that run, with the number of calls the record counts, and no such row leans on a 29 October rehearsal.
  it("cites the Airwallex-only run, not a 29 October rehearsal, for every endpoint that run called", () => {
    const called = AWX.calls.airwallex.filter((c) => c.endpoint !== "POST /authentication/login");
    expect(called.length).toBeGreaterThan(15);
    for (const { endpoint, calls } of called) {
      const rows = SECTIONS.flatMap((s) => s.text.split("\n").filter((l) => l.startsWith(`| \`${endpoint}\``)).map((row) => ({ row, s })));
      expect({ endpoint, rows: rows.length > 0 }).toEqual({ endpoint, rows: true });
      for (const { row, s } of rows) {
        expect({ endpoint, cites_29_october: row.includes("2026-10-29") }).toEqual({ endpoint, cites_29_october: false });
        const evidence = `7 Nov run: ${calls} call${calls === 1 ? "" : "s"}`;
        expect({ endpoint, evidence, in_row: row.includes(evidence) }).toEqual({ endpoint, evidence, in_row: true });
        const links = linked(s.text);
        expect({ endpoint, section: s.title, links_the_run: links.includes(AWX_LOG) || links.includes(AWX_RECORD) }).toEqual({ endpoint, section: s.title, links_the_run: true });
      }
    }
  });

  it("gives the Airwallex-only run's figures as its record holds them", () => {
    const text = section(/Airwallex-only run/);
    expect(text).toContain(`${AWX.calls.airwallex_total} Airwallex API calls`);
    expect(text).toContain(`budget: ${AWX.calls.budget}`);
    for (const c of AWX.cards) expect(text).toContain(`····${c.last4} (`);
    for (const c of AWX.cards) expect(text).toContain(`${c.read_back.per_tx} / ${c.read_back.monthly}`);
    for (const t of AWX.card_transactions) {
      expect(text).toContain(t.id);
      if (t.decline_code) expect(text).toContain(`\`${t.decline_code}\``);
    }
    for (const i of AWX.invoices) {
      expect(text).toContain(i.transfer_id);
      expect(text).toContain(`fee ${i.fee}`);
      expect(text).toContain(`\`${i.approval_sha256.slice(0, 8)}…\``);
      if (i.quote) for (const v of [i.quote.quote_id, i.quote.rate, i.conversion_id!]) expect(text).toContain(v);
    }
  });
});

describe("the proof that must stay", () => {
  it("shows the hash the CFO signed as Airwallex's own transfer metadata holds it", () => {
    const readBack = json<{ transfer: { id: string; status: string; fee_amount: number; metadata: { approval_sha256: string } } }>("docs/runs/airwallex-transfer-approval-2026-11-06.json").transfer;
    const main = json<{ ledger: { events: { event: string; subject: string; payload?: { terms_sha256?: string } }[]; proposals: { proposal_id: string; terms: { expires_at: string; conversion?: { quote_id: string; valid_to: string; buy_amount: string; sell_amount: string } } }[] } }>("docs/demo/main-run.json").ledger;
    const signed = main.events.find((e) => e.event === "proposal.approved" && e.subject === "P-0005")!.payload!.terms_sha256!;
    expect(readBack.metadata.approval_sha256).toBe(signed);
    const text = section(/hash the CFO signed/);
    expect(text).toContain(signed);
    expect(text).toContain(readBack.id);
    expect(text).toContain(readBack.status);
    expect(text).toContain(`EUR ${readBack.fee_amount.toFixed(2)}`);
    // FX for the shortfall only: the quote's id and its expiry are inside the terms the CFO signed, in the main run.
    const conversion = main.proposals.find((p) => p.proposal_id === "P-0005")!.terms.conversion!;
    for (const v of [conversion.quote_id, conversion.valid_to.replace(".000Z", "Z"), `EUR ${conversion.buy_amount}`, `USD ${conversion.sell_amount}`]) expect(text).toContain(v);
  });

  it("keeps the decline, the agent that asked for a raise and the same charge approved after Face ID", () => {
    const text = section(/Airwallex-only run/);
    const decline = AWX.declines_met.find((d) => d.decline_code === "LIMIT_EXCEEDED")!;
    expect(decline.proposal_id).toBe("P-0001");
    expect(text).toContain(decline.transaction_id);
    expect(text).toMatch(/asked the CFO for a raise \(P-0001\) instead of retrying/);
    const again = AWX.card_transactions.filter((t) => t.approved && t.amount === AWX.card_transactions.find((x) => x.id === decline.transaction_id)!.amount);
    expect(again).toHaveLength(1);
    expect(text).toContain(again[0]!.id);
    expect(text).toMatch(/Face ID/);
  });

  it("labels what the sandbox simulates", () => {
    for (const sim of ["POST /simulation/issuing/create", "POST /simulation/transfers/{id}/transition", "POST /simulation/deposit/create", "POST /simulation/accounts/{id}/update_status"]) {
      const rows = DOSSIER.split("\n").filter((l) => l.startsWith(`| \`${sim}\``));
      expect({ sim, rows: rows.length > 0 }).toEqual({ sim, rows: true });
      for (const row of rows) expect({ sim, marked: /\*\*sandbox only\*\*/i.test(row) }).toEqual({ sim, marked: true });
    }
    expect(DOSSIER).toMatch(/No real USDZ reaches Airwallex/);
  });
});

describe("the three sections added after the jury panel of 12 November", () => {
  const ENDPOINT = /`(?:GET|POST) \/[a-z_/{}]+`/;

  it.each([
    ["Connected accounts and application fees", ["docs/runs/2026-11-10-connected-accounts-sandbox.md", "docs/runs/2026-11-10-platform-e2e.md", "docs/runs/2026-11-10-platform-e2e/facts.json"]],
    ["Transfer approvals", ["docs/runs/2026-11-10-airwallex-two-locks.md"]],
    ["Payment acceptance", ["docs/runs/2026-11-10-payment-acceptance-sandbox.md"]],
  ])("%s: an endpoint, an id from its record, and a link to the record", (title, records) => {
    const text = section(new RegExp(`^${title}`));
    expect(text).toMatch(ENDPOINT);
    const ids = text.match(FULL_ID) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    for (const record of records) expect({ record, linked: linked(text).includes(record) }).toEqual({ record, linked: true });
    expect(ids.some((id) => RECORDS.get(records[0]!)!.includes(id))).toBe(true);
  });

  it("connected accounts: the accounts, the PAID payout, Purser's fee and the refusals as the platform run's facts hold them", () => {
    const facts = json<{ account: string; transfers: { transfer_id: string | null; status: string; amount: string; airwallex_fee: string | null; failure: string | null }[]; purser_fees: { amount: string; status: string; with_payout: string | null; to: string }[] }[]>("docs/runs/2026-11-10-platform-e2e/facts.json");
    const text = section(/^Connected accounts and application fees/);
    for (const c of facts) expect(text).toContain(c.account);
    const paid = facts.flatMap((c) => c.transfers).filter((t) => t.status === "PAID");
    expect(paid).toHaveLength(1);
    const fee = facts.flatMap((c) => c.purser_fees).find((f) => f.with_payout === paid[0]!.transfer_id)!;
    for (const v of [paid[0]!.transfer_id!, `EUR ${paid[0]!.amount}`, paid[0]!.airwallex_fee!, `EUR ${fee.amount}`, fee.to]) expect(text).toContain(v);
    const refused = facts.flatMap((c) => c.transfers).filter((t) => t.failure);
    expect(text).toContain(`${refused.length} payouts`);
    expect(refused.every((t) => t.failure!.includes("validation_failed"))).toBe(true);
    // The cause, word for word as the run log gives it.
    const log = RECORDS.get("docs/runs/2026-11-10-platform-e2e.md")!;
    for (const cause of ["validation_failed", "payer.additional_info.business_registration_number", "code 048"]) {
      expect(log).toContain(cause);
      expect(text).toContain(cause);
    }
  });

  // Another stream may publish the finished two-locks run. The dossier therefore dates its statement of the state and
  // quotes the record; while the record still says the approval was not completed, the quotes must be its own words.
  it("transfer approvals: the state is dated, quoted from the record and linked", () => {
    const text = section(/^Transfer approvals/);
    const record = RECORDS.get("docs/runs/2026-11-10-airwallex-two-locks.md")!;
    expect(text).toMatch(/at the time of writing, 12 November/);
    expect(text).toContain("`IN_APPROVAL`");
    const quotes = [...text.matchAll(/"([^"]{12,})"/g)].map((m) => m[1]!);
    expect(quotes.length).toBeGreaterThan(0);
    if (record.includes("**Not completed.**")) {
      const said = record.replace(/\*\*/g, "").replace(/\s+/g, " ");
      expect(quotes.filter((q) => !said.includes(q.replace(/\s+/g, " ")))).toEqual([]);
    }
  });
});

describe("two keys, two tables", () => {
  const KEYS = section(/^The scoped key/);

  it("lists for the company key every endpoint the Airwallex-only run called", () => {
    const table = sub(KEYS, /^The company key/);
    expect(AWX.calls.airwallex.map((c) => c.endpoint).filter((e) => !table.includes(e))).toEqual([]);
  });

  it("lists for the platform key every Airwallex endpoint in the platform run's call logs", () => {
    const table = sub(KEYS, /^The platform key/);
    const called = new Set<string>();
    for (const log of ["calls.jsonl", "calls-earlier-attempts.jsonl", "calls-retry.jsonl"]) {
      for (const line of read(`docs/runs/2026-11-10-platform-e2e/${log}`).split("\n").filter(Boolean)) {
        const c = JSON.parse(line) as { service: string; method: string; endpoint: string };
        if (c.service === "airwallex") called.add(`${c.method} ${c.endpoint}`);
      }
    }
    expect(called.size).toBeGreaterThan(10);
    expect([...called].filter((e) => !table.includes(e))).toEqual([]);
    expect(table).toContain("x-on-behalf-of");
  });

  it("no longer says the key needs no connected accounts", () => {
    expect(DOSSIER).not.toMatch(/billing or connected accounts/);
    expect(sub(KEYS, /^The company key/)).toMatch(/connected accounts/);
    expect(sub(KEYS, /^The platform key/)).toMatch(/`POST \/accounts\/create`/);
  });
});

describe("a calm document", () => {
  it("claims no endorsement and sells nothing", () => {
    expect(DOSSIER).not.toMatch(/\b(certified|endorsed) by\b|why (this|it) wins|seamless|best-in-class|world-class/i);
  });

  // Replaced, not stacked: three sections came in, the rehearsal citations went out. 4,886 words before 12 November, counted as here.
  // +316 the same day (merge of airwallex-depth-1112): its own new section, "Three more Airwallex capabilities" (batch
  // transfer, payee check, financial transactions), and their rows in the key's permissions; nothing else grew.
  it("is no longer than it was before the three sections came in", () => {
    expect(DOSSIER.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(4886 + 316);
  });
});
