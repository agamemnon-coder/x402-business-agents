// The public demo page (K5): a recorded run's steps, public facts only, played back with no request.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { buildStory } from "../src/demo/story.js";
import { DEMO_CSP, demoPage } from "../src/servers/dashboard.js";

const TX = (n: number) => "0x" + String(n).padStart(2, "0").repeat(32);

function ledger() {
  const db = openDb(":memory:");
  audit(db, "owner-signer", "mandate.bound", "sourcing", { cap: "0.03", budget: "10.00", payee: "0xf1" });
  audit(db, "sourcing", "upstream.paid", "1", { seq: 1, tx: TX(1) });
  audit(db, "system", "sale.delivered", "1", { tx: TX(2) });
  audit(db, "sourcing", "upstream.refused", "41", { seq: 41, reason: "mandate_cap_exceeded" });
  return db;
}

describe("the demo story", () => {
  it("tells only the steps that ran, in order, with explorer links for transactions", () => {
    const s = buildStory(ledger(), "test run", new Date("2026-11-01T10:00:00Z"));
    expect(s.steps.map((x) => x.id)).toEqual(["buy", "refused", "audit"]);
    expect(s.steps[0]!.facts.find((f) => f.label === "Summit's first payment to us")).toEqual({ label: "Summit's first payment to us", value: `${TX(2).slice(0, 10)}…${TX(2).slice(-4)}`, href: `https://testnet.metalntwx.com/tx/${TX(2)}` });
    expect(s.steps[0]!.facts.find((f) => f.label === "Sourcing agent's mandate")?.value).toBe("0.03 a payment, 10.00 in total, Stockline only");
    expect(s.steps.at(-1)!.facts[0]!.value).toMatch(/^4, chain intact, head /);
    // Every link is to the public explorer.
    expect(s.steps.flatMap((x) => x.facts).filter((f) => f.href).every((f) => f.href!.startsWith("https://testnet.metalntwx.com/tx/0x"))).toBe(true);
  });

  it("tells how an outside agent got a card, paid within it and asked for more, each step approved with Face ID", () => {
    const db = ledger();
    const at = "2026-10-29T18:26:42.000Z";
    for (const [id, kind] of [["P-0011", "agent_onboard"], ["P-0012", "policy_change"]] as const) {
      db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, ?, '{}', ?, 'ext:acme-research', 'EXECUTED', ?, ?)").run(id, kind, `h${id}`, at, at);
      db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, 'max (passkey k_EWzUuv)', 'passkey', '', ?)").run(id, `h${id}`, at);
    }
    audit(db, "ext:acme-research", "agent.card_requested", "ext:acme-research", { agent_id: "ext:acme-research", name: "Acme Research purchasing agent", purpose: "market reports", per_tx: "20.00", monthly: "80.00", currency: "EUR", proposal_id: "P-0011" });
    audit(db, "awx-executor", "card.issued", "ext:acme-research", { agent: "ext:acme-research", last4: "3616", limits: "20.00 / 80.00", currency: "EUR", proposal_id: "P-0011" });
    audit(db, "ext:acme-research", "card.charge_approved", "legacy-t1", { agent: "ext:acme-research", amount: "19.00", currency: "EUR", merchant: "TrailData Reports" });
    audit(db, "ext:acme-research", "card.charge_approved", "t1", { agent: "ext:acme-research", amount: "19.00", currency: "EUR", merchant: "TrailData Reports" });
    audit(db, "system", "card.duplicate_merged", "legacy-t1", { kept: "t1", amount: "19.00" });
    audit(db, "human", "policy.changed", "card.ext:acme-research.per_tx", { key: "card.ext:acme-research.per_tx", from: "20.00", to: "45.00", proposal_id: "P-0012" });
    const step = buildStory(db, "test").steps.find((x) => x.id === "outside")!;
    expect(step.approval).toEqual({ who: "Max · Face ID", proposal: "P-0011", what: "issue Acme Research purchasing agent a company card" });
    expect(step.facts.map((f) => [f.label, f.value])).toEqual([
      ["Agent", "Acme Research purchasing agent (ext:acme-research), connected over MCP"],
      ["Card", "Visa •••• 3616: 20.00 per purchase, 80.00 a month"],
      ["Paid on its card", "19.00 EUR (1 charge, approved by Airwallex)"],
      ["Raise it asked for", "20.00 → 45.00 per purchase, P-0012, Max · Face ID"],
    ]);
  });

  it("shows the card control on the kind of shop, and the emergency stop with who turned it on and off", () => {
    const db = ledger();
    const at = "2026-10-30T18:40:00.000Z";
    for (const id of ["P-0020", "P-0021"]) {
      db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, 'policy_change', '{}', ?, 'human', 'EXECUTED', ?, ?)").run(id, `h${id}`, at, at);
      db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, 'max (passkey k_EWzUuv)', 'passkey', '', ?)").run(id, `h${id}`, at);
    }
    audit(db, "sourcing", "card.charge_declined", "t1", { agent: "sourcing", amount: "45.00", currency: "EUR", merchant: "Packwise", reason: "LIMIT_EXCEEDED" });
    audit(db, "support", "card.charge_declined", "t2", { agent: "support", amount: "19.99", currency: "EUR", merchant: "Packwise", reason: "MERCHANT_CATEGORY_NOT_ALLOWED" });
    audit(db, "human", "policy.changed", "freeze", { key: "freeze", from: "off", to: "on", proposal_id: "P-0020" });
    audit(db, "human", "policy.changed", "freeze", { key: "freeze", from: "on", to: "off", proposal_id: "P-0021" });
    const s = buildStory(db, "test");
    expect(s.steps.find((x) => x.id === "card")!.facts.find((f) => f.label === "Wrong kind of shop")?.value)
      .toBe("19.99 EUR at Packwise on the Support agent's card: declined by Airwallex (MERCHANT_CATEGORY_NOT_ALLOWED)");
    const stop = s.steps.find((x) => x.id === "stop")!;
    expect(stop.tab).toBe("Emergency stop");
    expect(stop.approval).toEqual({ who: "Max · Face ID", proposal: "P-0020", what: "Emergency stop: on" });
    expect(stop.facts.map((f) => f.label)).toEqual(["Stop on", "Stop off"]);
    expect(s.steps.map((x) => x.id).indexOf("stop")).toBeLessThan(s.steps.map((x) => x.id).indexOf("audit"));
  });

  it("never shows null, undefined or NaN, opens with the company card, and writes amounts as money", () => {
    const text = readFileSync(new URL("../docs/demo/story.json", import.meta.url), "utf8");
    const story = JSON.parse(text) as { steps: { id: string; title: string; text: string; details?: string; tab?: string; facts: { label: string; value: string }[]; approval: { who: string; what: string } | null }[] };
    expect(story.steps[0]!.id).toBe("card");
    for (const st of story.steps) {
      const shown = [st.title, st.text, st.details ?? "", st.tab ?? "", ...st.facts.flatMap((f) => [f.label, f.value]), st.approval?.who ?? "", st.approval?.what ?? ""];
      for (const v of shown) expect(v, `${st.id}: ${v}`).not.toMatch(/\b(null|undefined|NaN)\b/);
      expect(st.tab, st.id).toBeTruthy();
      // The first sentences are plain words; the jargon sits under "How it works".
      expect(st.text, st.id).not.toMatch(/x402|EUR\/USD stock check|mandate_|SHA-256|\*USDZ/);
    }
    expect(text).toContain("1,850.00");
    expect(text).not.toMatch(/[^\d,]1850\.00/);
  });

  it("puts a null fact nowhere: the page filters it before rendering", () => {
    const html = readFileSync(new URL("../src/demo/demo.html", import.meta.url), "utf8");
    expect(html).toContain(".filter(function (n) { return n != null; })");
    // The approval banner is not the article's tone class (a shared name broke the layout).
    expect(html).not.toMatch(/^\.approval \{/m);
  });

  it("holds no secret, key or private URL in the committed recording", () => {
    const text = readFileSync(new URL("../docs/demo/story.json", import.meta.url), "utf8");
    expect(text).not.toMatch(/privateKey|api[_-]?key|secret|Bearer|https?:\/\/(?!testnet\.metalntwx\.com\/tx\/)/i);
    expect(JSON.parse(text).steps.length).toBeGreaterThanOrEqual(6);
  });
});

describe("the demo page", () => {
  it("carries the story inside the page, escaped, under a CSP that matches its one script", () => {
    const s = buildStory(ledger(), "test");
    s.steps[0]!.title = "</script><script>alert(1)</script>";
    const html = demoPage(s);
    expect(html).not.toContain("</script><script>alert(1)");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(DEMO_CSP).toContain(`'sha256-${createHash("sha256").update(script).digest("base64")}'`);
    expect(DEMO_CSP).toContain("connect-src 'self'");
  });
});
