// The top of /metal (C2, 6 November): the main run's Metal story on one screen. Every number and every link on it comes
// from the main run's record (docs/demo/main-run.json), recomputed here from the raw file; the 86 payments are checked
// against the run's payment-by-payment check against the chain; the separate runs below it are dated, each with its run
// record, and none of their transactions is the main run's.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { metalStoryHtml } from "../src/redesign/partners.js";
import { EXPLORER, MAIN_RUN_CHECK, REPO_BLOB, SEPARATE_RUNS, explorerLink, metalStory, refusalNote, separateRuns } from "../src/redesign/metalStory.js";
import { loadRecord } from "../src/redesign/run.js";
import { esc } from "../src/redesign/ui.js";
import { METAL_PAGE } from "../src/servers/dashboard.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const MAIN = "docs/demo/main-run.json";
const raw = read(MAIN);
type Row = { event: string; subject: string | null; payload: Record<string, unknown> };
const rec = JSON.parse(raw) as {
  snapshot: { world: { business: string }; flows: { kind: string; rail: string; count?: number; refused?: unknown }[]; budgets: { agents: { agent: string; cap: string; last_tx: string }[] }; refusals: { reason: string }[] };
  ledger: { events: Row[] };
};
const story = metalStory(loadRecord().record);
const top = metalStoryHtml(story);
const text = top.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const hrefs = [...top.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);

describe("the top of /metal tells the main run's Metal story from its record", () => {
  it("plays the main run's record", () => {
    expect(loadRecord().file).toBe(MAIN);
    expect(METAL_PAGE).toContain(top);
    expect(METAL_PAGE).toMatch(/Replay of the main run, 3 Nov/);
  });

  it("counts 86 payments on Metal, each kind summed from the record's flows", () => {
    const paid = rec.snapshot.flows.filter((f) => f.rail === "metal" && !f.refused);
    const n = (kind: string) => paid.filter((f) => f.kind === kind).reduce((k, f) => k + (f.count ?? 1), 0);
    expect(story.payments).toMatchObject({ sales: n("sale"), purchases: n("upstream"), refunds: n("refund"), sweeps: n("sweep") });
    expect(story.payments.total).toBe(n("sale") + n("upstream") + n("refund") + n("sweep"));
    expect(story.payments.total).toBe(86);
    expect(text).toContain(`${story.payments.total} Metal payments, each its own transaction`);
  });

  it("matches the run's payment-by-payment check against the chain: every Metal payment matched, none skipped", () => {
    const qa = read(MAIN_RUN_CHECK);
    const row = (kind: string) => new RegExp(`\\| Metal ${kind} \\| (\\d+) \\| (\\d+) \\| (\\d+) \\| 0 \\| 0 \\|`).exec(qa);
    expect(Number(row("sale")?.[1])).toBe(story.payments.sales);
    expect(Number(row("refund")?.[1])).toBe(story.payments.refunds);
    expect(Number(row("sweep")?.[1])).toBe(story.payments.sweeps);
    // Upstream rows hold the refused purchases too, which have no transaction; the paid ones are the story's.
    const paidUpstream = [...qa.matchAll(/\| Metal upstream purchase \| `\d+` \| [\d.]+ \*USDZ to the supplier, PAID \| n\/a \| match \| match \|/g)].length;
    expect(paidUpstream).toBe(story.payments.purchases);
    expect(story.payments.checked.href).toBe(`${REPO_BLOB}${MAIN_RUN_CHECK}`);
    expect(existsSync(new URL(`../${MAIN_RUN_CHECK}`, import.meta.url))).toBe(true);
  });

  it("links one mandate per agent: the replace that bound it, or a payment under it, with the record's cap", () => {
    expect(story.mandates.map((m) => m.agent)).toEqual(rec.snapshot.budgets.agents.map((b) => b.agent));
    for (const m of story.mandates) {
      const b = rec.snapshot.budgets.agents.find((x) => x.agent === m.agent)!;
      expect(m.cap).toBe(b.cap);
      const bound = rec.ledger.events.filter((e) => e.event === "mandate.replaced" && e.subject === m.agent).at(-1);
      expect(m.proof.href).toBe(`${EXPLORER}/tx/${bound ? String(bound.payload.tx) : b.last_tx}`);
      expect(m.how).toBe(bound ? "bound" : "paid under it");
    }
    expect(text).toMatch(/Support 0\.10, a payment under it/);
  });

  it("shows #24 refused on chain with the tx, the amount and the cap the ledger recorded", () => {
    const onChain = rec.ledger.events.find((e) => e.event === "upstream.refused_on_chain")!;
    const let1 = rec.ledger.events.find((e) => e.event === "upstream.let_through" && e.subject === onChain.subject)!;
    expect(story.refusal).toEqual({ seq: "24", amount: String(onChain.payload.amount), cap: String(let1.payload.bound_cap), code: "mandate_cap_exceeded", proof: { label: expect.any(String), href: `${EXPLORER}/tx/${String(onChain.payload.tx)}` },
      agent: "sourcing", mandate: String(onChain.payload.mandate) });
    expect(text).toContain("#24 refused on chain");
    expect(text).toContain("0.04 over the 0.03 cap");
    // What the explorer shows beside the link (jury review, 7 Nov, #3), the mandate and the amount from the same row.
    const m = String(onChain.payload.mandate);
    expect(refusalNote(story.refusal)).toBe(`On the explorer: log #0 is Metal's MandateRefused event (undecoded there); topic 1 is the Sourcing mandate ${m.slice(0, 8)}…${m.slice(-4)} and its data carries ${String(onChain.payload.amount)}.`);
    expect(refusalNote(story.refusal)).toBe("On the explorer: log #0 is Metal's MandateRefused event (undecoded there); topic 1 is the Sourcing mandate 0x11734e…9901 and its data carries 0.04.");
    expect(text).toContain(refusalNote(story.refusal)!);
    expect(refusalNote(null)).toBeNull();
    expect(refusalNote({ ...story.refusal!, mandate: "" })).toBeNull();
  });

  it("shows the mandate replace after Face ID: both replace txs of P-0002, its two signers, #37 refused on the old mandate", () => {
    const replaced = rec.ledger.events.filter((e) => e.event === "mandate.replaced");
    expect(story.replace?.proposal).toBe("P-0002");
    expect(story.replace?.steps.map((s) => s.proof.href)).toEqual(replaced.map((e) => `${EXPLORER}/tx/${String(e.payload.tx)}`));
    expect(story.replace?.signers).toEqual(["max", "test-controller"]);
    expect(rec.snapshot.refusals.some((r) => /#37 .*revoked by a replacement/.test(r.reason))).toBe(true);
    expect(text).toMatch(/P-0002: the CFO's Face ID in Purser \+ a test passkey pressed by the build tool \(labelled\); the runner's owner key signed on chain\. #37 on the old mandate: mandate_revoked/);
  });

  it("puts no number on it that the record does not hold", () => {
    const allowed = new Set([
      String(story.mandates.length), ...story.mandates.map((m) => m.cap),
      ...[story.payments.total, story.payments.sales, story.payments.purchases, story.payments.refunds, story.payments.sweeps].map(String),
      story.refusal!.seq, story.refusal!.amount, story.refusal!.cap, story.replace!.revoked!.seq, story.replace!.proposal.replace(/^P-/, ""),
      ...story.replace!.steps.map((s) => s.cap),
    ]);
    for (const v of allowed) expect(raw).toContain(v);
    // Ids and the explorer's own positions (log #0, topic 1) are names, not figures.
    const shown = text.replace(/tx 0x[0-9a-f]+…[0-9a-f]+/g, "").replace(/0x[0-9a-f]+…[0-9a-f]+|log #0|topic 1/g, "").match(/\d+(\.\d+)?/g) ?? [];
    expect(shown.length).toBeGreaterThan(10);
    for (const n of shown) expect(allowed, `${n} is not from the record`).toContain(n);
  });

  it("links every claim to Metal's explorer, with hashes and the account from the record (the check's record aside)", () => {
    expect(hrefs.length).toBeGreaterThanOrEqual(8);
    for (const h of hrefs) {
      if (h === story.payments.checked.href) continue;
      const link = explorerLink(h);
      expect(link, h).not.toBeNull();
      expect(raw).toContain(link!.id);
    }
    expect(hrefs).toContain(`${EXPLORER}/address/${rec.snapshot.world.business}`);
    // At least one tx for each of the four claims.
    expect(hrefs.filter((h) => h.includes("/tx/")).length).toBeGreaterThanOrEqual(story.mandates.length + 1 + story.replace!.steps.length);
  });
});

describe("an explorer link", () => {
  const TX = `0x${"ab".repeat(32)}`;
  it("is a tx or an address on Metal's testnet explorer, its host compared exactly", () => {
    expect(explorerLink(`${EXPLORER}/tx/${TX}`)).toEqual({ kind: "tx", id: TX });
    expect(explorerLink(`${EXPLORER}/address/0x6e621D0f1ff6a03cAF1dbFE9747eCEc4513Efefc`)).toEqual({ kind: "address", id: "0x6e621D0f1ff6a03cAF1dbFE9747eCEc4513Efefc" });
  });
  it("refuses look-alike hosts and anything else", () => {
    for (const bad of [
      `https://testnetXmetalntwx.com/tx/${TX}`, `https://testnet.metalntwx.com.evil.test/tx/${TX}`, `https://metalntwx.com.evil.test/tx/${TX}`,
      `https://evil.test/testnet.metalntwx.com/tx/${TX}`, `https://xtestnet.metalntwx.com/tx/${TX}`, `http://testnet.metalntwx.com/tx/${TX}`,
      `https://user@testnet.metalntwx.com/tx/${TX}`, `https://testnet.metalntwx.com:8443/tx/${TX}`, `https://testnet.metalntwx.com/tx/${TX}?x=1`,
      `https://testnet.metalntwx.com/tx/0x12`, `https://testnet.metalntwx.com/block/1`, "not a url", "", null,
    ]) expect(explorerLink(bad), String(bad)).toBeNull();
  });
});

describe("the separate runs on /metal", () => {
  const runs = separateRuns();
  const fold = /<details class="fold"><summary>Beyond the kit: separate runs, each dated \(not the main run\)<\/summary>([\s\S]*?)<\/details>/.exec(METAL_PAGE)?.[1] ?? "";

  it("are folded under their own label, each with its date and its run record", () => {
    expect(fold).not.toBe("");
    expect(runs.map((r) => r.id)).toEqual(SEPARATE_RUNS.map((r) => r.id));
    for (const r of runs) {
      const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${r.date}T12:00:00Z`));
      expect(fold).toContain(esc(`${day}, a separate run · ${r.title}`));
      expect(fold).toContain(r.record.href!);
      const path = r.record.href!.slice(REPO_BLOB.length).replace(/#.*$/, "");
      expect(existsSync(new URL(`../${path}`, import.meta.url)), path).toBe(true);
    }
  });

  it("carry the date their record states", () => {
    const longDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
    for (const r of SEPARATE_RUNS) {
      const path = r.record.replace(/#.*$/, "");
      if (path.endsWith(".json")) expect((JSON.parse(read(path)) as { ran_at: string }).ran_at.slice(0, 10)).toBe(r.date);
      else if (/^docs\/runs\/\d{4}-\d\d-\d\d-/.test(path)) expect(path.slice(10, 20)).toBe(r.date);
      else expect(r.record).toContain(longDay(r.date).toLowerCase().replace(" ", "-"));
    }
  });

  it("link only their own transactions: each is in their records, none is the main run's", () => {
    const own = read("docs/demo/metal.json") + read("docs/runs/passkey-owners.json");
    const txs = fold.match(/0x[0-9a-f]{64}/g) ?? [];
    expect(txs.length).toBeGreaterThanOrEqual(10);
    for (const tx of txs) {
      expect(own).toContain(tx);
      expect(raw).not.toContain(tx);
    }
  });

  it("show only figures their own records hold", () => {
    const own = read("docs/demo/metal.json") + read("docs/runs/passkey-owners.json");
    const shown = fold.replace(/<[^>]+>/g, " ").replace(/0x[0-9a-f]+…[0-9a-f]+/g, " ").replace(/src\/metal\/\w+\.ts/g, " ")
      .replace(/\b\d{1,2} (October|November)\b/g, " ").replace(/\b\d+-of-\d+\b/g, "2").match(/\d[\d,]*(\.\d+)?/g) ?? [];
    expect(shown.length).toBeGreaterThan(5);
    for (const n of shown) expect(own, `${n} is in no separate run's record`).toContain(n);
  });

  it("say the stand-ins: software passkeys, a separate test account", () => {
    expect(fold).toMatch(/software passkeys .*not a phone/);
    expect(fold).toMatch(/Face ID approves the change in Purser and the account's owner key, held by Purser's runner, signs the replace on chain/);
  });
});
