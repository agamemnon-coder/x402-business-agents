// /alta's price-rise scene since 21 Nov (the owner, Max: "Our Kit 11 point is: a supplier raises its price, and you see
// it refused on chain. That has to go at the top, not so much text."; src/redesign/altaScene.ts). Every figure from the
// main run's record and trace: the Sourcing mandate in force at #24 (its first bind), the purchases paid before it under
// that cap, the supplier's price before and after, the refusal's code and transaction, and that Purser's own check was
// off for this one purchase; the architecture; one play, nothing moving under reduced motion.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALTA_SCENE_CSS, altaArchHtml, altaScene, altaSceneHtml } from "../src/redesign/altaScene.js";
import { EXPLORER } from "../src/redesign/metalStory.js";
import { loadRecord } from "../src/redesign/run.js";
import { METAL_PAGE } from "../src/servers/dashboard.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const rec = JSON.parse(read("docs/demo/main-run.json")) as { ledger: { events: { event: string; subject: string; ts: string; payload: Record<string, unknown> }[] } };
const trace = JSON.parse(read("docs/demo/main-run-trace.json")) as { payments: { kind: string; ref: string; amount: string; rail_id: string }[]; mandates: { event: string; agent: string; cap: string; budget: string; tx: string }[] };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const main = /<main[\s\S]*<\/main>/.exec(METAL_PAGE)![0];

describe("/alta: the price rise, refused on chain", () => {
  const s = altaScene(loadRecord().record)!;
  const onChain = rec.ledger.events.find((e) => e.event === "upstream.refused_on_chain")!;
  const bind = trace.mandates.find((m) => m.agent === "sourcing" && m.event === "mandate.bound")!;

  it("reads the scene from the main run: the mandate at the time, the purchases paid under it, the price rise, the refusal", () => {
    expect(s.refused).toEqual({ seq: onChain.subject, amount: String(onChain.payload.amount), code: "mandate_cap_exceeded", tx: String(onChain.payload.tx) });
    expect([s.agent, s.supplier, s.cap, s.budget, s.bindTx]).toEqual(["Sourcing agent", "Stockline", bind.cap, bind.budget, bind.tx]);
    // The four purchases before #24, each paid within the cap, the last at the price before the rise.
    const before = trace.payments.filter((p) => p.kind === "purchase" && Number(p.ref) < Number(s.refused.seq)).slice(-4);
    expect(s.paid).toEqual(before.map((p) => ({ ref: p.ref, amount: p.amount, tx: p.rail_id })));
    expect(s.before).toBe(before.at(-1)!.amount);
    expect(s.after).toBe(s.refused.amount);
    expect(Number(s.before)).toBeLessThanOrEqual(Number(s.cap));
    expect(Number(s.after)).toBeGreaterThan(Number(s.cap));
    // The record says Purser's own check was off for this purchase, to prove the chain holds the cap.
    expect(s.ownCheckOff).toBe(true);
    expect(rec.ledger.events.find((e) => e.event === "upstream.let_through" && e.subject === s.refused.seq)!.payload.purser_would_refuse).toMatch(/^mandate_cap_exceeded/);
    // After it, the CFO's change: the new Sourcing cap on chain.
    const replaced = trace.mandates.find((m) => m.agent === "sourcing" && m.event === "mandate.replaced")!;
    expect(s.raised).toEqual({ cap: replaced.cap, proposal: "P-0002", tx: replaced.tx });
  });

  it("opens /alta on the scene, with the refusal's transaction on Alta's testnet explorer and its honest line", () => {
    const scene = /<section class="ascene card" id="alta-scene"[\s\S]*?<\/section>/.exec(main)![0];
    expect(main.indexOf('id="alta-scene"')).toBeGreaterThan(main.indexOf("</h1>"));
    expect(main.indexOf('id="alta-scene"')).toBeLessThan(main.indexOf('id="alta-facts"'));
    expect(main.indexOf('id="alta-facts"')).toBeLessThan(main.indexOf('id="alta-arch"'));
    expect(main.indexOf('id="alta-arch"')).toBeLessThan(main.indexOf("<details"));
    expect(scene).toContain(`href="${EXPLORER}/tx/${s.refused.tx}"`);
    expect(scene).toContain(`href="${EXPLORER}/tx/${s.bindTx}"`);
    const t = text(scene.replace(/<svg[\s\S]*?<\/svg>/, " "));
    expect(t).toContain(`The mandate Sourcing agent may pay Stockline up to ${s.cap} a purchase budget ${s.budget}, on chain bind`);
    expect(t).toContain(`The price rise Stockline: ${s.before} → ${s.after} a stock check`);
    expect(t).toContain(`Refused on chain #${s.refused.seq}: ${s.after} over the ${s.cap} cap mandate_cap_exceeded; nothing moved.`);
    expect(t).toContain(`Purser refuses this before signing; for #${s.refused.seq} its check was off, to show the chain holds the cap. Alta testnet, test money (*USDZ).`);
    // The chart: one bar per purchase, the refused one over the dashed cap.
    const svg = /<svg class="as-chart"[\s\S]*?<\/svg>/.exec(scene)![0];
    expect(svg.match(/<g class="as-b ok/g)).toHaveLength(s.paid.length);
    expect(svg.match(/<g class="as-b no/g)).toHaveLength(1);
    expect(svg).toContain(`mandate cap ${s.cap}`);
    expect(altaSceneHtml(null)).toBe("");
    expect(text(altaArchHtml())).toBe("Two locks on every payment Agent asks to pay, over x402 Purser policy the CFO's rules, before signing Alta mandate cap, budget, payee, expiry Alta testnet pays, or records MandateRefused");
  });

  it("plays once, and not at all under reduced motion", () => {
    const motion = /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/.exec(ALTA_SCENE_CSS)![0];
    expect(ALTA_SCENE_CSS.replace(motion, "")).not.toMatch(/animation:/);
    expect(ALTA_SCENE_CSS).not.toMatch(/infinite/);
  });
});
