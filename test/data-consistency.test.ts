// Data QA: every figure a judge sees in more than one place must say what its one source says. The landing and the
// dashboard read docs/demo/snapshot.json; this recomputes their headline figures from the recorded audit log
// (docs/audit/friday-1-audit.jsonl), then checks the README's Kit 11 table against docs/demo/metal.json and
// src/config/policy.ts, the separate test-world figures against their run files in docs/runs/, and every relative
// markdown link in README.md and docs/ against the files and headings it points to. Offline: files only.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INITIAL_MANDATES, LICENCE_FEE_EUR_CENTS, TOTAL_BUDGET_CENTS, type Agent } from "../src/config/policy.js";
import { AGENT_DISPLAY } from "../src/config/brand.js";
import { fromCents } from "../src/lib/money.js";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const text = (path: string) => readFileSync(join(ROOT, path), "utf8");
const json = <T>(path: string) => JSON.parse(text(path)) as T;
// Markdown wraps lines; the checks read prose with whitespace collapsed.
const flat = (path: string) => text(path).replace(/\s+/g, " ");
const cents = (s: string) => Math.round(Number(s.replace(/[^\d.]/g, "")) * 100);
const eur = (c: number) => `€${(c / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface AuditRow { seq: number; event: string; payload_json: string; row_hash: string }
interface Snapshot {
  run: string;
  proof: { alone: number; blocked: number; face_id: number; fake_invoices: number; ai_tricks: number; card_declines: number; chain_refusals: number; over_limit_eur: string };
  snapshot: {
    counts: { alone: number; blocked: number };
    money: { blocked_eur: string; blocked_fraud_eur: string; blocked_fraud_n: number; blocked_declined_eur: string; blocked_declined_n: number; blocked_declined_later_paid_n: number; blocked_rejected_n: number };
    audit: { rows: number; head: string; intact: boolean };
    decisions: { proposal_id: string; status: string; by: string | null }[];
  };
}
interface Mandate { role: string; agent: string; cap: string; budget: string; history: { cap: string; budget: string }[] }
interface Metal { features: { id: string; figure: string; source: string }[]; mandates: Mandate[] }
interface Step { step: string; outcome: string; tx?: string; finality?: { status: string; signers: number; participants: number } | null }
interface Run { steps: Step[] }
interface Load { attempted: number; paid: number; failed: number; seconds: number; throughput_per_second: number; latency_ms: { p50: number; p95: number }; deposits: { transactions: number } }

const rows = text("docs/audit/friday-1-audit.jsonl").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AuditRow);
const payload = (r: AuditRow) => JSON.parse(r.payload_json) as Record<string, unknown>;
const of = (event: string) => rows.filter((r) => r.event === event);
const rec = json<Snapshot>("docs/demo/snapshot.json");
const story = json<{ audit: { rows: number; head: string } }>("docs/demo/story.json");
const metal = json<Metal>("docs/demo/metal.json");

/** The landing's and the dashboard's headline figures, recomputed from the audit log alone (as snapshot.ts counts). */
function fromAudit() {
  const passkey = [...of("proposal.approved"), ...of("proposal.rejected")].filter((r) => payload(r).method === "passkey");
  const injections = new Set(of("document.injection_flagged").map((r) => String(payload(r).document_sha256 ?? r.seq)));
  type Charge = { seq: number; last4?: string; merchant?: string; amount?: string };
  const charge = (r: AuditRow): Charge => ({ seq: r.seq, ...(payload(r) as Omit<Charge, "seq">) });
  const approved = of("card.charge_approved").map(charge);
  const declined = of("card.charge_declined").map(charge);
  // A decline is money kept out only if the same purchase was not paid later (after the CFO raised the limit).
  const laterPaid = (d: Charge) => approved.some((a) => a.seq > d.seq && a.last4 === d.last4 && a.merchant === d.merchant && a.amount === d.amount);
  const fraud = of("invoice.fraud_suspected").map(payload).filter((p) => p.currency === "EUR");
  const keptOut = fraud.reduce((s, p) => s + cents(String(p.amount)), 0) + declined.filter((d) => !laterPaid(d)).reduce((s, d) => s + cents(String(d.amount)), 0);
  const chainRefusals = of("upstream.refused").filter((r) => String(payload(r).reason ?? "").startsWith("mandate_")).length;
  return {
    alone: of("sale.delivered").length + of("upstream.paid").length + of("refund.paid").length + of("sweep.paid").length + approved.length,
    blocked: of("upstream.refused").length + declined.length + of("proposal.rejected").length + of("invoice.fraud_suspected").length + injections.size,
    face_id: passkey.length,
    fake_invoices: of("invoice.fraud_suspected").length,
    ai_tricks: injections.size,
    card_declines: declined.length,
    chain_refusals: chainRefusals,
    kept_out_cents: keptOut,
    fraud_cents: fraud.reduce((s, p) => s + cents(String(p.amount)), 0),
    declined_later_paid: declined.filter(laterPaid).length,
    rows: rows.length,
    head: rows.at(-1)!.row_hash,
  };
}

describe("the recorded run's headline figures (landing, dashboard, README, claims)", () => {
  const a = fromAudit();

  it("the snapshot the pages read says what the audit log says", () => {
    expect(rec.proof).toMatchObject({ alone: a.alone, blocked: a.blocked, face_id: a.face_id, fake_invoices: a.fake_invoices, ai_tricks: a.ai_tricks, card_declines: a.card_declines, chain_refusals: a.chain_refusals, over_limit_eur: "0.00" });
    expect(rec.snapshot.counts).toMatchObject({ alone: a.alone, blocked: a.blocked });
    expect(cents(rec.snapshot.money.blocked_eur)).toBe(a.kept_out_cents);
    expect(cents(rec.snapshot.money.blocked_fraud_eur)).toBe(a.fraud_cents);
    expect(rec.snapshot.money.blocked_fraud_n).toBe(a.fake_invoices);
    expect(rec.snapshot.money.blocked_declined_n).toBe(a.card_declines);
    expect(rec.snapshot.money.blocked_declined_later_paid_n).toBe(a.declined_later_paid);
    expect(rec.snapshot.money.blocked_rejected_n).toBe(of("proposal.rejected").length);
    // The dashboard's decision list shows the same Face ID decisions the landing counts.
    expect(rec.snapshot.decisions.filter((d) => d.by?.includes("Face ID")).length).toBe(a.face_id);
  });

  it("the audit row count and head agree in the export, the snapshot and the story", () => {
    expect(a.rows).toBe(194);
    expect(rec.snapshot.audit).toEqual({ rows: a.rows, head: a.head, intact: true });
    expect(story.audit).toEqual({ rows: a.rows, head: a.head });
  });

  it("claims.md, the audit README, metal-award.md and the requirements matrix repeat the same figures", () => {
    const claims = flat("docs/claims.md");
    expect(claims).toContain(`| Payments inside the limits with no person needed | ${a.alone} |`);
    expect(claims).toContain(`| Stops by the card, the chain, the fraud checks or the CFO | ${a.blocked} |`);
    expect(claims).toContain(`| Money kept out for good | ${eur(a.kept_out_cents)} |`);
    expect(claims).toContain(`| Decisions signed with Face ID | ${a.face_id} |`);
    expect(claims).toContain(`| Fake invoices and AI tricks stopped | ${a.fake_invoices} + ${a.ai_tricks} |`);
    expect(claims).toContain(`| Audit log | ${a.rows} rows, hash chain intact`);
    expect(claims).toContain(`| ${a.alone} with no approval at the time`);
    expect(claims).toContain(`| ${a.blocked} stops: ${a.blocked - a.ai_tricks} payments and ${a.ai_tricks} planted instructions |`);
    expect(flat("docs/audit/README.md")).toContain(`stored: ${a.rows} rows`);
    expect(flat("docs/audit/README.md")).toContain(`--anchor ${a.rows}:${a.head}`);
    expect(flat("docs/metal-award.md")).toContain(`its ${a.rows}-row chain`);
    expect(flat("docs/requirements-matrix.md")).toContain(`the recorded Friday run: ${a.alone} alone, ${a.blocked} stops, ${a.face_id} Face ID decisions`);
  });

  it("the form's proof list repeats them (6 payments and 2 planted instructions make the 8 stops)", () => {
    const form = flat("docs/submission/README.md");
    expect(form).toContain(`${a.blocked} stops by the card, the chain, the fraud checks or the CFO (${a.blocked - a.ai_tricks} payments, ${a.ai_tricks} planted instructions)`);
    expect(form).toContain(`${eur(a.kept_out_cents)} kept out for good`);
  });
});

describe("Claude's cost and the red team, where the docs repeat them", () => {
  interface Claude { calls: number; models: { model: string; role: string; calls: number; cost_usd_micros: number }[]; cost_usd_micros: number; per_call_usd_micros: number; eur_paid: string; per_1000_eur_usd_micros: number }
  const c = (rec.snapshot as unknown as { claude: Claude }).claude;
  // As the doc rounds: cents, or four decimals under a cent.
  const usd = (micros: number) => `$${(micros / 1e6).toFixed(micros >= 10_000 ? 2 : 4)}`;

  it("docs/claude.md's table is the snapshot's (the Agents tab reads the same)", () => {
    const doc = text("docs/claude.md");
    expect(c.models.reduce((s, m) => s + m.calls, 0)).toBe(c.calls);
    expect(c.models.reduce((s, m) => s + m.cost_usd_micros, 0)).toBe(c.cost_usd_micros);
    expect(of("claude.read")).toHaveLength(c.calls);
    for (const m of c.models) expect(doc).toContain(`| ${m.model} | ${m.role} | ${m.calls} | ${usd(m.cost_usd_micros)} |`);
    expect(doc).toContain(`| **All** | | **${c.calls}** | **${usd(c.cost_usd_micros)}**, or $${(c.per_call_usd_micros / 1e6).toFixed(4)} per call |`);
    expect(flat("docs/claude.md")).toContain(`${c.calls} Claude calls`);
    expect(flat("docs/claude.md")).toContain(`Against the ${eur(cents(c.eur_paid))} the agents paid`);
    expect(flat("docs/claude.md")).toContain(`$${(c.per_1000_eur_usd_micros / 1e6).toFixed(3)} of AI per €1,000 paid`);
    expect(flat("docs/claims.md")).toContain(`$${(c.per_1000_eur_usd_micros / 1e6).toFixed(3)} per €1,000 paid`);
  });

  it("the red team's scripted attacks are counted as the report has them", () => {
    const rt = json<{ attempts: number; blocked: number; inconclusive: number; caught_after: number; results: { id: string }[] }>("docs/redteam/report.json");
    const scripted = rt.results.filter((r) => r.id !== "document").length;
    for (const d of ["docs/security.md", "docs/hardening.md", "docs/claims.md", "docs/submission/README.md"]) expect(flat(d), d).toContain(`${scripted} scripted attacks`);
    expect(flat("docs/hardening.md")).toContain(`${rt.attempts} attempts, all failed`);
    expect(flat("docs/claims.md")).toContain(`${rt.blocked} of ${rt.attempts} failed, ${rt.inconclusive} inconclusive: ${rt.blocked - rt.caught_after} stopped before anything moved, ${rt.caught_after} found afterwards`);
  });
});

describe("Kit 11's three mandates (README table) against the chain recording and the policy in code", () => {
  const readme = text("README.md");
  const table = readme.split("| Kit 11 agent | Its job in the brief |")[1]!.split("\n\n")[0]!.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("|---"));
  const kit = metal.mandates.filter((m) => ["sourcing", "support", "treasury"].includes(m.role));
  const arrow = (from: string, to: string) => (from === to ? from : `${from} → ${to}`);

  it("has one row per Kit 11 agent, and each budget (and cap, where shown) is the recorded one, bound and after the replace", () => {
    expect(table).toHaveLength(3);
    expect(kit).toHaveLength(3);
    for (const m of kit) {
      // The row named as the pages name the agent (AGENT_DISPLAY: Kit 11's names, word for word).
      const row = table.find((l) => l.split("|")[1]!.trim() === AGENT_DISPLAY[m.role as Agent].name);
      expect(row, m.role).toBeDefined();
      const cell = row!.split("|")[3]!.trim();
      const bound = m.history[0]!;
      expect(cell.startsWith(arrow(bound.budget, m.budget)), `${m.role}: "${cell}"`).toBe(true);
      // A cap the row states must be the recorded one.
      const cap = cell.match(/cap ([\d.]+(?: → [\d.]+)?)/)?.[1];
      if (cap) expect(cap).toBe(arrow(bound.cap, m.cap));
    }
  });

  it("binds what src/config/policy.ts says, and both before and after add up to TOTAL_BUDGET_CENTS, as the README says", () => {
    for (const m of kit) {
      const p = INITIAL_MANDATES[m.role as Agent];
      expect(cents(m.history[0]!.budget), m.role).toBe(p.budgetCents);
      expect(cents(m.history[0]!.cap), m.role).toBe(p.capCents);
    }
    const before = kit.reduce((s, m) => s + cents(m.history[0]!.budget), 0);
    const after = kit.reduce((s, m) => s + cents(m.budget), 0);
    expect(before).toBe(TOTAL_BUDGET_CENTS);
    expect(after).toBe(TOTAL_BUDGET_CENTS);
    expect(readme).toContain(`${fromCents(TOTAL_BUDGET_CENTS)} test USD between them, before and after, held in code (\`TOTAL_BUDGET_CENTS\`)`);
  });
});

describe("the separate test worlds' figures against their run files", () => {
  const load = json<Load>("docs/runs/clearing-load-2.json");
  const first = json<Load>("docs/runs/clearing-load-1.json");
  const compliance = json<Run>("docs/runs/compliance-policy.json");
  const fourEyes = json<Run>("docs/runs/four-eyes.json");
  const n = (v: number) => v.toLocaleString("en-GB");
  const form = flat("docs/submission/README.md");
  const docs = ["docs/submission/README.md", "docs/claims.md", "docs/controls-matrix.md", "docs/requirements-matrix.md", "docs/metal-award.md"];

  const attacks = compliance.steps.filter((s) => s.step.startsWith("attack:"));
  const certified = [...compliance.steps, ...fourEyes.steps].filter((s) => s.finality?.status === "REPORTED");
  const WORDS: Record<number, string> = { 11: "eleven", 26: "twenty-six" };

  it("clearing load: 2,000 of 2,000 at 4.24 a second, p50 and p95 as measured, and the first run's 1,879", () => {
    expect(load.paid).toBe(load.attempted);
    expect(load.failed).toBe(0);
    expect(load.throughput_per_second).toBe(Number((load.paid / load.seconds).toFixed(2)));
    const paid = `${n(load.paid)} of ${n(load.attempted)}`;
    const p50 = `p50 ${(load.latency_ms.p50 / 1000).toFixed(1)} s`;
    const p95 = `p95 ${(load.latency_ms.p95 / 1000).toFixed(1)} s`;
    expect(form).toContain(`${paid} pay-per-call payments in ${load.seconds} s (${load.throughput_per_second} a second, ${p50}, ${p95})`);
    expect(form).toContain(`A first run paid ${n(first.paid)} before`);
    expect(flat("docs/claims.md")).toContain(`${paid} paid in ${load.seconds} s (${load.throughput_per_second} a second), ${p50}, ${p95}`);
    expect(flat("docs/claims.md")).toContain(`A first run paid ${n(first.paid)}`);
    expect(flat("docs/metal-award.md")).toContain(`${paid} paid in ${load.seconds} s: ${load.throughput_per_second} a second, latency ${p50} and ${p95}`);
    expect(flat("docs/metal-award.md")).toContain(`${load.deposits.transactions} chain transactions in all`);
    expect(flat("docs/metal-award.md")).toContain(`(${n(first.paid)} of ${n(first.attempted)} paid`);
    expect(flat("docs/controls-matrix.md")).toContain(`${paid} paid, ${load.throughput_per_second} a second`);
    expect(metal.features.find((f) => f.id === "clearing")!.source).toContain(`paid ${paid} at ${load.throughput_per_second} a second`);
    // No page or doc states another throughput or count for the load test.
    for (const d of docs) {
      for (const m of flat(d).matchAll(/([\d,]+) of ([\d,]+) (?:pay-per-call payments|paid)/g)) expect([paid, `${n(first.paid)} of ${n(first.attempted)}`], `${d}: ${m[0]}`).toContain(`${m[1]} of ${m[2]}`);
      // (Not "100,000 blocks at 13.4 a second": that is the chain's block rate.)
      for (const m of flat(d).matchAll(/(?<![\d.]|blocks at )(\d[\d.]*) (?:paid )?(?:payments )?a second/g)) expect(Number(m[1]), `${d}: ${m[0]}`).toBe(load.throughput_per_second);
    }
  });

  it("compliance: 11 attacks, each reverted on chain, as every doc and the /metal card say", () => {
    expect(attacks).toHaveLength(11);
    expect(attacks.every((s) => s.outcome === "reverted" && s.tx)).toBe(true);
    expect(form).toContain("Eleven attacks reverted on chain");
    expect(metal.features.find((f) => f.id === "compliance")!.figure).toBe(`${attacks.length} attacks reverted`);
    for (const d of [...docs, "docs/compliance.md"]) {
      for (const m of flat(d).matchAll(/\b(\w+|\d+) attacks (?:on it )?reverted/gi)) {
        expect([String(attacks.length), WORDS[attacks.length]], `${d}: ${m[0]}`).toContain(m[1]!.toLowerCase());
      }
    }
  });

  it("finality: 26 transactions of the two runs carry a reported certificate, 3 of 4 validators, as the docs say", () => {
    expect(certified).toHaveLength(26);
    expect(certified.every((s) => s.tx && s.finality!.signers === 3 && s.finality!.participants === 4)).toBe(true);
    expect(metal.features.find((f) => f.id === "certificates")!.source).toContain(`all ${certified.length} of their transactions`);
    expect(metal.features.find((f) => f.id === "certificates")!.figure).toBe("3 of 4 validators");
    let seen = 0;
    for (const d of docs) {
      const body = flat(d);
      for (const m of body.matchAll(/\b(\d+) transactions\b/g)) {
        const near = body.slice(Math.max(0, m.index - 250), m.index + 250);
        if (!/certificate/i.test(near) || /chain transactions in all/.test(m[0] + body.slice(m.index, m.index + 40))) continue;
        seen++;
        expect(Number(m[1]), `${d}: …${near.slice(200, 320)}…`).toBe(certified.length);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(4);
  });

  it("four eyes: exactly the three single-owner or stranger-signed steps reverted, as the form says", () => {
    const reverted = fourEyes.steps.filter((s) => s.outcome === "reverted").map((s) => s.step);
    expect(reverted).toEqual([
      "pay 1.00 from the account, signed by the CFO alone",
      "pay 1.00 from the account, signed by the CFO and a stranger's key",
      "revoke the mandate with the CFO's signature alone",
    ]);
    expect(form).toContain("A payment signed by the CFO alone, the same payment co-signed by a stranger's key, and a mandate revoke by the CFO alone each reverted on chain");
  });

  it("Kit 11's licence fee: every doc that names its amount says EUR 240.00, the amount in code", () => {
    const fee = `EUR ${fromCents(LICENCE_FEE_EUR_CENTS)}`;
    expect(fee).toBe("EUR 240.00");
    let seen = 0;
    const all = ["README.md", ...mdFiles("docs")];
    for (const d of all) {
      const body = flat(d);
      for (const m of body.matchAll(/licen[cs]e/gi)) {
        const near = body.slice(m.index, m.index + 160);
        for (const amount of near.matchAll(/(?:EUR |€)(\d[\d,]*(?:\.\d\d)?)(?![\d,])/g)) {
          // The euro bill (€1,850) sits in the same sentences; only an amount named as the licence fee is the fee.
          if (!/^(?:EUR|€)\s?\d[\d,.]* (?:in code|to Stockline|licen)/.test(near.slice(amount.index))) continue;
          seen++;
          expect(`EUR ${amount[1]}`, `${d}: ${near}`).toBe(fee);
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(2);
    expect(flat("docs/claims.md")).toContain(`(${fee} in code, paid by the`);
    expect(flat("docs/requirements-matrix.md")).toContain(`Stockline's data licence of ${fee} kept in code (\`LICENCE_FEE_EUR_CENTS\`)`);
  });
});

// ---- Links ----

function mdFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...mdFiles(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out.sort();
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, repeats numbered. */
function anchors(md: string): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of withoutFences(md).split("\n")) {
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) {
      const plain = h[1]!.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").replace(/[*_`]/g, (c) => (c === "_" ? "_" : ""));
      const base = plain.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
      const k = seen.get(base) ?? 0;
      seen.set(base, k + 1);
      out.add(k ? `${base}-${k}` : base);
    }
    for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(m[1]!);
  }
  return out;
}

/** Fenced code (and, for links, inline code) holds examples, not links or headings. */
const withoutFences = (md: string) => md.replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
const withoutCode = (md: string) => withoutFences(md).replace(/`[^`\n]*`/g, "``");

function links(md: string): string[] {
  const body = withoutCode(md);
  const inline = [...body.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]!);
  const refs = [...body.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/gm)].map((m) => m[1]!);
  return [...inline, ...refs];
}

/** What is wrong with each relative link in `file`: a missing file, or an #anchor with no heading in the target. */
function brokenLinks(file: string, md: string, exists: (path: string) => boolean, read: (path: string) => string): { checked: number; broken: string[] } {
  const broken: string[] = [];
  let checked = 0;
  for (const target of links(md)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("/")) continue;
    checked++;
    const [rawPath, anchor] = target.split("#", 2) as [string, string | undefined];
    const dest = rawPath ? join(dirname(file), decodeURIComponent(rawPath)) : file;
    if (!exists(dest)) { broken.push(`${file}: ${target} (no file ${dest})`); continue; }
    if (anchor && dest.endsWith(".md") && !anchors(dest === file ? md : read(dest)).has(decodeURIComponent(anchor).toLowerCase())) broken.push(`${file}: ${target} (no heading #${anchor} in ${dest})`);
  }
  return { checked, broken };
}

describe("relative markdown links in README.md and docs/", () => {
  const files = ["README.md", ...mdFiles("docs")];

  it("every relative link resolves to a file, and every #anchor to a heading", () => {
    expect(files.length).toBeGreaterThan(50);
    const results = files.map((f) => brokenLinks(f, text(f), (p) => existsSync(join(ROOT, p)), text));
    expect(results.reduce((s, r) => s + r.checked, 0)).toBeGreaterThan(100);
    expect(results.flatMap((r) => r.broken)).toEqual([]);
  });

  it("the check itself catches a missing file and a missing heading, and skips code and outside links", () => {
    const docs: Record<string, string> = { "docs/a.md": "# Top\n## Kit 11: `npm run x`\n", "docs/b.md": "" };
    const md = ["[ok](a.md#kit-11-npm-run-x)", "[here](#local)", "## Local", "[gone](missing.md)", "[bad anchor](a.md#nope)", "`[in code](nowhere.md)`", "```\n[fenced](nowhere.md)\n```", "[web](https://example.com/x.md)", "[ref]: b.md#top"].join("\n");
    const r = brokenLinks("docs/b.md", md, (p) => p in docs, (p) => docs[p]!);
    expect(r.checked).toBe(5);
    expect(r.broken).toEqual(["docs/b.md: missing.md (no file docs/missing.md)", "docs/b.md: a.md#nope (no heading #nope in docs/a.md)", "docs/b.md: b.md#top (no heading #top in docs/b.md)"]);
  });

  it("computes GitHub's anchors the way GitHub does", () => {
    expect([...anchors("# The recorded run (landing, dashboard, /live, film)\n## Kit 11: `npm run x`\n## Kit 11: `npm run x`\n```\n# not a heading\n```")]).toEqual([
      "the-recorded-run-landing-dashboard-live-film", "kit-11-npm-run-x", "kit-11-npm-run-x-1",
    ]);
  });
});
