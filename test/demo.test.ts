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
    expect(s.steps[0]!.facts.find((f) => f.label === "Kestrel's first payment to us")).toEqual({ label: "Kestrel's first payment to us", value: `${TX(2).slice(0, 10)}…${TX(2).slice(-4)}`, href: `https://testnet.metalntwx.com/tx/${TX(2)}` });
    expect(s.steps[0]!.facts.find((f) => f.label === "Sourcing mandate")?.value).toBe("0.03 a payment, 10.00 in total, Feedstock Labs only");
    expect(s.steps.at(-1)!.facts[0]!.value).toMatch(/^4, chain intact, head /);
    // Every link is to the public explorer.
    expect(s.steps.flatMap((x) => x.facts).filter((f) => f.href).every((f) => f.href!.startsWith("https://testnet.metalntwx.com/tx/0x"))).toBe(true);
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
