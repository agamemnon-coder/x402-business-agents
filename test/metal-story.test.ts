// /metal as one story (jury panel, 12 Nov; src/redesign/metalMandates.ts), every figure and link from a record: the four
// mandates in one table, each cap linking the transaction that set it (the trace of the main run's ledger, and Metal's
// own MandateBound events in the check of 12 November); the spend from that read-only check, labelled as recorded until a
// live read answers; the 86 payments recomputed from the main run's record and its payment-by-payment check; #24's
// refusal as it ran; who signed the replaces on chain (one owner key, held by the runner: the chain did not check Face
// ID); what else ran on Metal, each dated with its own record and none of it the main run's, the hold said as not
// finished; both refusals decoded, with the raw log beside them.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXPLORER, MAIN_RUN_CHECK, REPO_BLOB, SEPARATE_RUNS, explorerLink, metalStory, refusalNote, separateRuns } from "../src/redesign/metalStory.js";
import { HOLD_NOT_FINISHED, INSPECTOR_URL, MAIN_RUN_TRACE, METAL_HOLD_RECORD, METAL_INSPECT_JS, METAL_INSPECTOR_RECORD, coverageRows, inspectorRecord, mandateRows, replaceSigner } from "../src/redesign/metalMandates.js";
import { loadRecord } from "../src/redesign/run.js";
import { METAL_CSP, METAL_PAGE } from "../src/servers/dashboard.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const MAIN = "docs/demo/main-run.json";
const raw = read(MAIN), traceRaw = read(MAIN_RUN_TRACE), inspRaw = read(METAL_INSPECTOR_RECORD);
type Row = { event: string; subject: string | null; actor: string; payload: Record<string, unknown> };
type Budget = { agent: string; cap: string; budget: string; spent: string; payee: string; expires_on: string };
const rec = JSON.parse(raw) as {
  snapshot: { world: { business: string }; flows: { kind: string; rail: string; count?: number; refused?: unknown }[]; budgets: { agents: Budget[]; counterparty: Budget }; refusals: { reason: string }[] };
  ledger: { events: Row[] };
};
const trace = JSON.parse(traceRaw) as { mandates: { event: "mandate.bound" | "mandate.replaced"; agent: string; cap: string; budget: string; tx: string; proposal_id: string | null }[] };
const record = loadRecord().record;
const story = metalStory(record);
const insp = inspectorRecord();
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
const main = /<main[\s\S]*<\/main>/.exec(METAL_PAGE)![0];
const top = main.slice(0, main.indexOf('<div class="folds card">'));
const table = /<section class="mt card"[\s\S]*?<\/section>/.exec(main)![0];
const grid = main.slice(main.indexOf('<div class="mgrid">'), main.indexOf('<div class="folds card">'));
const also = /<details class="fold" id="also"[\s\S]*?<\/details>/.exec(main)?.[0] ?? "";
const decoded = /<details class="fold" id="refusals"[\s\S]*?<\/details>/.exec(main)?.[0] ?? "";
const simulated = /<details class="fold"><summary>What is simulated<\/summary>[\s\S]*?<\/details>/.exec(main)?.[0] ?? "";
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
const link = (href: string, label: string) => new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"[^>]*>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ↗</a>`);

describe("/metal plays the main run's record", () => {
  it("is labelled with the main run, and opens on its four mandates", () => {
    expect(loadRecord().file).toBe(MAIN);
    expect(METAL_PAGE).toMatch(/Replay of the main run, 3 Nov/);
    expect(text(table)).toContain("4 mandates on chain, one per agent");
  });
});

describe("the four mandates, one table", () => {
  const rows = mandateRows(record, trace);
  it("has one row per agent and the customer's, each cap linking the transaction that set it, the first bind beside a replace", () => {
    expect(rows.map((r) => r.agent)).toEqual([...rec.snapshot.budgets.agents.map((b) => b.agent), "customer"]);
    for (const r of rows) {
      const events = trace.mandates.filter((m) => m.agent === r.agent), last = events.at(-1)!, first = events[0]!;
      const b = [...rec.snapshot.budgets.agents, rec.snapshot.budgets.counterparty].find((x) => x.agent === r.agent)!;
      // The end terms: the trace's last bind or replace, the same as the record's budgets.
      expect({ cap: r.cap, budget: r.budget, tx: r.tx }).toEqual({ cap: last.cap, budget: last.budget, tx: last.tx });
      expect({ cap: r.cap, budget: r.budget, payee: r.payee, expires: r.expires, spent: r.spent }).toEqual({ cap: b.cap, budget: b.budget, payee: b.payee, expires: b.expires_on, spent: b.spent });
      expect(traceRaw).toContain(r.tx);
      expect(table).toMatch(link(`${EXPLORER}/tx/${r.tx}`, r.cap));
      if (last.event === "mandate.replaced") {
        expect(r.first).toEqual({ cap: first.cap, budget: first.budget, tx: first.tx });
        expect(table).toContain(`was ${first.cap}: `);
        expect(table).toMatch(link(`${EXPLORER}/tx/${first.tx}`, "first bind"));
        expect(text(table)).toContain(`${r.budget} (was ${first.budget})`);
      } else expect(r.first).toBeNull();
    }
    expect(rows.filter((r) => r.how === "replace").map((r) => r.agent).sort()).toEqual(["sourcing", "treasury"]);
  });

  it("agrees with Metal's own MandateBound events, read on 12 November: cap, budget, payee and expiry of the bind and the replace", () => {
    expect(insp.bindings.map((b) => b.agent).sort()).toEqual(["support", "treasury"]);
    for (const b of insp.bindings) {
      const r = rows.find((x) => x.agent === b.agent)!;
      expect({ tx: b.tx, cap: b.terms.per_payment_cap, budget: b.terms.budget, expires: b.terms.expiry_iso.slice(0, 10) }).toEqual({ tx: r.tx, cap: r.cap, budget: r.budget, expires: r.expires });
      expect(r.payee.startsWith(b.terms.payee.name)).toBe(true);
      expect(b.kind).toBe(r.how);
    }
  });

  it("shows the spend of the check of 12 November, labelled as recorded, and the customer's as the main run recorded it", () => {
    const live = insp.recorded!;
    expect(live.recorded_on).toBe("2026-11-12");
    expect(text(table)).toContain(`Spent: recorded on 12 Nov at block ${live.block}, a read-only check.`);
    expect(table).toContain(`data-rec="${METAL_INSPECTOR_RECORD}"`);
    for (const m of live.mandates) {
      expect(table).toContain(`<span data-spent="${m.agent}">${m.spent}</span>`);
      expect(table).toContain(`<span class="sub" data-pays="${m.agent}">${m.payments} ${m.payments === 1 ? "payment" : "payments"}</span>`);
      expect(table).toContain(`<span data-revoked="${m.agent}">${m.revoked ? "yes" : "no"}</span>`);
      // The chain's spend on 12 November is the spend the main run recorded on 3 November.
      expect(rec.snapshot.budgets.agents.find((b) => b.agent === m.agent)!.spent).toBe(m.spent);
    }
    expect(table).toContain(`<span data-spent="customer">${rec.snapshot.budgets.counterparty.spent}</span><span class="sub">recorded 3 Nov</span>`);
    // The read anyone can repeat: the hosted inspector, and the eth_call itself.
    expect(text(table)).toContain(`curl -s ${INSPECTOR_URL}`);
    expect(text(table)).toContain(`eth_call to ${live.account} with mandates(ref), selector ${insp.abi.mandates_selector}`);
    expect(text(table)).toContain("npm run metal-inspect");
  });

  it("says live only what the chain answered: the page's script asks its own origin and writes text, never markup", () => {
    expect(METAL_PAGE).toContain(`<script>\n${METAL_INSPECT_JS}</script>`);
    expect(METAL_INSPECT_JS).toContain('fetch("api/metal/mandates"');
    expect(METAL_INSPECT_JS).toContain('a.source === "chain"');
    expect(METAL_INSPECT_JS).toContain("Spent: read live from Metal testnet at ");
    expect(METAL_INSPECT_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(METAL_CSP).toMatch(/^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'; style-src 'sha256-[A-Za-z0-9+/=]+'; connect-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/);
  });
});

describe("the payments, the refusal and the replace", () => {
  it("counts 86 payments on Metal, each kind summed from the record's flows", () => {
    const paid = rec.snapshot.flows.filter((f) => f.rail === "metal" && !f.refused);
    const n = (kind: string) => paid.filter((f) => f.kind === kind).reduce((k, f) => k + (f.count ?? 1), 0);
    expect(story.payments).toMatchObject({ sales: n("sale"), purchases: n("upstream"), refunds: n("refund"), sweeps: n("sweep") });
    expect(story.payments.total).toBe(n("sale") + n("upstream") + n("refund") + n("sweep"));
    expect(story.payments.total).toBe(86);
    expect(text(grid)).toContain(`${story.payments.total} Metal payments, each its own transaction`);
    expect(text(grid)).toContain(`${n("sale")} sales, ${n("upstream")} supplier purchases, ${n("refund")} refunds and ${n("sweep")} sweep, in *USDZ.`);
  });

  it("matches the run's payment-by-payment check against the chain: every Metal payment matched, none skipped", () => {
    const qa = read(MAIN_RUN_CHECK);
    const row = (kind: string) => new RegExp(`\\| Metal ${kind} \\| (\\d+) \\| (\\d+) \\| (\\d+) \\| 0 \\| 0 \\|`).exec(qa);
    expect(Number(row("sale")?.[1])).toBe(story.payments.sales);
    expect(Number(row("refund")?.[1])).toBe(story.payments.refunds);
    expect(Number(row("sweep")?.[1])).toBe(story.payments.sweeps);
    const paidUpstream = [...qa.matchAll(/\| Metal upstream purchase \| `\d+` \| [\d.]+ \*USDZ to the supplier, PAID \| n\/a \| match \| match \|/g)].length;
    expect(paidUpstream).toBe(story.payments.purchases);
    expect(grid).toMatch(link(`${REPO_BLOB}${MAIN_RUN_CHECK}`, "checked one by one"));
    expect(existsSync(new URL(`../${MAIN_RUN_CHECK}`, import.meta.url))).toBe(true);
  });

  it("tells #24 as it ran: the facilitator's 402, then the refusal recorded on chain, the tx Metal decodes as MandateRefused", () => {
    const onChain = rec.ledger.events.find((e) => e.event === "upstream.refused_on_chain")!;
    const let1 = rec.ledger.events.find((e) => e.event === "upstream.let_through" && e.subject === onChain.subject)!;
    expect(story.refusal).toEqual({ seq: "24", amount: String(onChain.payload.amount), cap: String(let1.payload.bound_cap), code: "mandate_cap_exceeded", proof: { label: expect.any(String), href: `${EXPLORER}/tx/${String(onChain.payload.tx)}` },
      agent: "sourcing", mandate: String(onChain.payload.mandate) });
    const t = text(grid);
    expect(t).toContain("#24 refused on chain");
    expect(t).toContain("Our own check was off for this one test. Metal's facilitator answered 402; a second call had Metal record the refusal on chain: 0.04 *USDZ over the 0.03 cap. Nothing moved.");
    expect(grid).toContain(`href="${story.refusal!.proof.href}"`);
    const d = insp.refusals.find((x) => x.purchase === "24")!;
    expect({ tx: d.tx, mandate: d.event.mandate, amount: d.event.amount, reason: d.event.reason_name }).toEqual({ tx: String(onChain.payload.tx), mandate: String(onChain.payload.mandate), amount: "0.04", reason: "OverPerPaymentCap" });
    // What the explorer shows beside the link (jury review, 7 Nov, #3), in the decoded fold.
    const m = String(onChain.payload.mandate);
    expect(refusalNote(story.refusal)).toBe(`On the explorer: log #0 is Metal's MandateRefused event (undecoded there); topic 1 is the Sourcing mandate ${m.slice(0, 8)}…${m.slice(-4)} and its data carries ${String(onChain.payload.amount)}.`);
    expect(text(decoded)).toContain(refusalNote(story.refusal)!);
    expect(refusalNote(null)).toBeNull();
    expect(refusalNote({ ...story.refusal!, mandate: "" })).toBeNull();
  });

  it("says who signed the replaces on chain: one owner key, held by the runner; the chain did not check Face ID", () => {
    const replaced = rec.ledger.events.filter((e) => e.event === "mandate.replaced");
    expect(replaced.map((e) => e.actor)).toEqual(["owner-signer", "owner-signer"]);
    expect(replaceSigner(record)).toEqual({ actor: "owner-signer", count: 2 });
    expect(story.replace?.proposal).toBe("P-0002");
    expect(story.replace?.signers).toEqual(["max", "test-controller"]);
    expect(story.replace?.steps.map((s) => s.proof.href)).toEqual(replaced.map((e) => `${EXPLORER}/tx/${String(e.payload.tx)}`));
    const t = text(grid);
    expect(t).toContain("P-0002: the CFO's Face ID and a test passkey approved it in Purser; one owner key, held by Purser's runner, signed on chain. The chain did not check Face ID.");
    for (const e of replaced) expect(grid).toContain(`href="${EXPLORER}/tx/${String(e.payload.tx)}"`);
    expect(rec.snapshot.refusals.some((r) => /#37 .*revoked by a replacement/.test(r.reason))).toBe(true);
    expect(t).toContain("#37 on the old mandate: refused by Metal's facilitator (mandate_revoked), no transaction.");
    // Never that a phone signed anything on chain.
    expect(text(main)).not.toMatch(/phone (signed|signs)|signed (it )?(with|on) (a|the|the CFO's) phone|Face ID signed (it )?on chain/i);
  });

  it("shows no figure in sight that its records do not hold", () => {
    const shown = text(top).replace(/0x[0-9a-fA-F]+(…[0-9a-f]+)?/g, " ").replace(/https?:\S+/g, " ")
      .replace(/\b\d{1,2} (Oct|Nov|Dec)\b/g, " ").replace(/\d\d:\d\d–\d\d:\d\d UTC/g, " ").replace(/P-0002|#24|#37|mandates\(ref\)|\*USDZ|metal-inspect/g, " ")
      .match(/\d+(\.\d+)?/g) ?? [];
    expect(shown.length).toBeGreaterThan(30);
    for (const n of shown) expect(raw.includes(n) || traceRaw.includes(n) || inspRaw.includes(n), `${n} is in no record`).toBe(true);
  });

  it("links in sight only the records' own transactions and account, the payment check, the check of 12 November and the inspector", () => {
    const links = hrefs(top);
    expect(links.length).toBeGreaterThanOrEqual(10);
    for (const h of links) {
      if ([`${REPO_BLOB}${MAIN_RUN_CHECK}`, `${REPO_BLOB}docs/runs/2026-11-12-metal-inspector.md`].includes(h)) continue;
      const l = explorerLink(h);
      expect(l, h).not.toBeNull();
      expect(raw.includes(l!.id) || traceRaw.includes(l!.id), h).toBe(true);
    }
    expect(links).toContain(`${EXPLORER}/address/${rec.snapshot.world.business}`);
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

describe("what else ran on Metal, folded, each a separate run", () => {
  const rows = coverageRows();
  const own = read("docs/demo/metal.json") + read("docs/runs/passkey-owners.json");

  it("dates each run and links its own transaction, none of them the main run's", () => {
    expect(also).not.toBe("");
    expect(text(also)).toMatch(/^ ?Also on Metal: 5 separate runs, and a hold, not finished/);
    expect(rows.map((r) => r.feature)).toEqual(["Two owners, both must sign", "Passkeys as the owners", "Money from strangers held", "Clearing", "Send policy", "Hold for an approved amount"]);
    const runs = separateRuns();
    for (const r of rows.filter((x) => x.status === "done")) {
      expect(text(also)).toContain(`${r.feature} ${r.when} tx ↗ ${r.note}`);
      const tx = explorerLink(r.link!.href)!;
      expect(tx.kind).toBe("tx");
      expect(own).toContain(tx.id);
      expect(raw).not.toContain(tx.id);
      expect(runs.some((x) => x.proofs.some((p) => p.href === r.link!.href))).toBe(true);
    }
  });

  it("says the hold is not finished, wherever it is mentioned, and its record says why", () => {
    const hold = rows.find((r) => r.status === "not finished")!;
    expect(hold).toMatchObject({ feature: "Hold for an approved amount", when: "10 Nov", link: { label: "record", href: `${REPO_BLOB}${METAL_HOLD_RECORD}` } });
    expect(text(also)).toContain("Hold for an approved amount 10 Nov not finished record ↗ hold placed on testnet; its capture not sent");
    expect(text(simulated)).toContain(`${HOLD_NOT_FINISHED}.`);
    const md = read(METAL_HOLD_RECORD);
    expect(md).toMatch(/`holdFrom` \(spender places a 0\.25 \*USDZ hold\) \| sent, receipt status success/);
    expect(md).toMatch(/`captureHold` \(0\.25 \*USDZ to the supplier\) \| not sent/);
    const t = text(main);
    for (const m of t.matchAll(/\bholds?\b/gi)) {
      const around = t.slice(Math.max(0, m.index - 10), m.index + 110);
      if (!/holds? the line/i.test(around)) expect(around, around).toMatch(/not finished|not sent/);
    }
  });

  it("says the stand-ins: software passkeys, not a phone; a test passkey as the second approver", () => {
    expect(text(also)).toContain("software passkeys, not a phone");
    expect(text(simulated)).toContain("Passkeys as the account's owners ran on 1 November with software passkeys, not a phone.");
    expect(text(simulated)).toContain("The second approver on the mandate change is a labelled test passkey; in production it is a second person.");
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
});

describe("both refusals, decoded", () => {
  it("names each argument, gives the raw log and the ABI line, and the command that decodes it again", () => {
    expect(decoded).toContain(`data-rec="${METAL_INSPECTOR_RECORD}"`);
    const t = text(decoded);
    expect(t).toContain(`${insp.abi.MandateRefused} (topic 0 ${insp.abi.topic0.MandateRefused}).`);
    expect(insp.refusals).toHaveLength(2);
    for (const d of insp.refusals) {
      expect(decoded).toContain(`href="${EXPLORER}/tx/${d.tx}"`);
      expect(t).toContain(`block ${d.block}`);
      expect(t).toContain(`reason ${d.event.reason} (${d.event.reason_name})`);
      expect(t).toContain(`amount ${d.event.amount} *USDZ`);
      expect(t).toContain(`ref ${d.event.mandate}`);
      for (const [i, topic] of d.raw_log.topics.entries()) expect(t).toContain(`topic ${i} ${topic}`);
      expect(t).toContain(`data ${d.raw_log.data}`);
    }
    expect(t).toContain("A revoked credential, 30 Oct, a separate run");
    expect(t).toContain(`npm run metal-inspect -- refusal ${insp.refusals[0]!.tx}`);
  });
});
