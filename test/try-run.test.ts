// /try's start screen, the run's clock and score, Share, "Same step, live" and the guided tour (cloud/src/try/run.ts,
// 14 Nov): the pure helpers run in Node as the page carries them; each step's live proof is an id on the built /proof
// page; the partners' logos are the official files, byte for byte, served at the site's paths; the tour's words are short.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUIDE, RUN, SAME_STEP, START, STEPS } from "../cloud/src/tryCopy.js";
import { RUN_JS, START_LOGOS, STEP_PROOF, TOUR_JS } from "../cloud/src/try/run.js";
import { LOGO_FILES } from "../cloud/src/try/logos.gen.js";
import { tryPage } from "../cloud/src/tryPage.js";
import { proofPage } from "../src/redesign/proof.js";
import { ORIGIN, RP, testCloud } from "./support/cloud.js";

type Kit = {
  ORDER: string[]; clock: (ms: number) => string; mark: (p: unknown, s: string) => string[];
  elapsed: (t0: unknown, t1: unknown, now: number) => number | null;
  score: (p: unknown, t0: unknown, t1: unknown, now: number) => { steps: number; refused: boolean; ms: number | null };
  oneCent: (signed: unknown, sent: unknown) => boolean;
  shareText: (R: typeof RUN, sc: { steps: number; refused: boolean; ms: number | null }) => string;
  proofHref: (base: string, map: Record<string, string>, screen: string) => string | null;
  tipOf: (G: typeof GUIDE, screen: string, refused: boolean) => string | null;
  oneCentLess: (a: string) => string | null;
};
const kit = new Function(`${RUN_JS}\nreturn runKit;`)() as Kit;
const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

describe("the run's clock", () => {
  it("says minutes and seconds, and hours only past an hour", () => {
    expect(kit.clock(0)).toBe("0:00");
    expect(kit.clock(999)).toBe("0:00");
    expect(kit.clock(42_000)).toBe("0:42");
    expect(kit.clock(102_400)).toBe("1:42");
    expect(kit.clock(3_725_000)).toBe("1:02:05");
    expect(kit.clock(-5)).toBe("0:00");
    expect(kit.clock(Number.NaN)).toBe("0:00");
  });
  it("runs from the start to the finish, or to now; none before a start", () => {
    expect(kit.elapsed(1000, null, 5000)).toBe(4000);
    expect(kit.elapsed(1000, 3000, 9000)).toBe(2000);
    expect(kit.elapsed(null, null, 9000)).toBeNull();
    expect(kit.elapsed(5000, null, 1000)).toBe(0);
  });
});

describe("the steps passed", () => {
  it("counts each step once, in order; a later step passes the ones before it; the refusal only itself", () => {
    expect(kit.mark(null, "check")).toEqual(["read", "check"]);
    expect(kit.mark(["read", "check"], "pay")).toEqual(["read", "check", "sign", "pay"]);
    expect(kit.mark(["read", "check", "sign", "pay"], "pay")).toEqual(["read", "check", "sign", "pay"]);
    expect(kit.mark(["read", "check", "sign", "pay"], "refuse")).toEqual(["read", "check", "sign", "pay", "refuse"]);
    expect(kit.mark(["nonsense", "pay"], "")).toEqual(["pay"]);
  });
  it("scores the steps, the refusal and the time; never as a fraction", () => {
    // The refusal is its own line, never counted with the steps.
    expect(kit.score(["read", "check", "sign", "pay", "refuse"], 1000, 103_000, 0)).toEqual({ steps: 4, refused: true, ms: 102_000 });
    expect(kit.score(null, null, null, 0)).toEqual({ steps: 0, refused: false, ms: null });
    for (const v of Object.values(RUN)) expect(v).not.toMatch(/\d+\s*\/\s*\d+|\bof \d/);
  });
  it("shares what happened, the time only when there is one, the cent line only when it was refused", () => {
    expect(kit.shareText(RUN, { steps: 4, refused: false, ms: 62_000 })).toBe("I signed an invoice with my passkey on Purser, on test money. My run: 1:02.");
    expect(kit.shareText(RUN, { steps: 5, refused: true, ms: null })).toBe("I signed an invoice with my passkey on Purser, on test money. Then I changed one cent: refused.");
  });
});

describe("the one-cent change", () => {
  it("is the amount alone moved by one cent; any other change is not called one", () => {
    const signed = { amount: "1850.00", beneficiary_name: "Bergtex Textil GmbH", iban_last4: "3000" };
    expect(kit.oneCent(signed, { ...signed, amount: "1849.99" })).toBe(true);
    expect(kit.oneCent(signed, { ...signed, amount: "1850.01" })).toBe(true);
    expect(kit.oneCent(signed, { ...signed, amount: "1849.00" })).toBe(false);
    expect(kit.oneCent(signed, { ...signed, iban_last4: "9999" })).toBe(false);
    expect(kit.oneCent(signed, { ...signed, amount: "1849.99", beneficiary_name: "Someone else" })).toBe(false);
    expect(kit.oneCent(signed, { ...signed, amount: "1849,99" })).toBe(false);
    expect(kit.oneCent(null, signed)).toBe(false);
  });
});

describe("Same step, live", () => {
  it("links each step after the start to an id on the built /proof page", () => {
    const proof = proofPage();
    for (const [screen, id] of Object.entries(STEP_PROOF)) {
      expect(proof, `${screen} → #${id}`).toContain(`id="${id}"`);
      expect(kit.proofHref("https://x/proof", STEP_PROOF, screen)).toBe(`https://x/proof#${id}`);
    }
    for (const s of STEPS.order.filter((x) => x !== "start" && x !== "company")) expect(STEP_PROOF[s], s).toBeTruthy();
    expect(kit.proofHref("https://x/proof", STEP_PROOF, "start")).toBeNull();
    expect(kit.proofHref("https://x/proof", STEP_PROOF, "toString")).toBeNull();
    expect(words(SAME_STEP.label)).toBeLessThanOrEqual(3);
  });
});

describe("the guided tour (?tour=1)", () => {
  it("has a short tip for every screen of the visit, and one after the refusal", () => {
    for (const s of [...STEPS.order, "did"]) expect(kit.tipOf(GUIDE, s, false), s).toBeTruthy();
    expect(kit.tipOf(GUIDE, "pay", true)).toBe(GUIDE.tips.refused);
    expect(kit.tipOf(GUIDE, "gone", false)).toBeNull();
    for (const t of Object.values(GUIDE.tips)) expect(words(t), t).toBeLessThanOrEqual(14);
  });
  it("changes the amount by one cent, as a person would type it", () => {
    expect(kit.oneCentLess("1850.00")).toBe("1849.99");
    expect(kit.oneCentLess("100.10")).toBe("100.09");
    expect(kit.oneCentLess("0.00")).toBeNull();
    expect(kit.oneCentLess("abc")).toBeNull();
  });
  it("is on only with ?tour=1, and presses a control only from a tap on Next", () => {
    expect(TOUR_JS).toContain("get('tour')==='1'");
    expect(TOUR_JS.match(/\.click\(\)/g)).toHaveLength(1);
    expect(TOUR_JS.indexOf("t.click()")).toBeGreaterThan(TOUR_JS.indexOf("next.addEventListener('click'"));
    expect(TOUR_JS).not.toMatch(/setTimeout|setInterval/);
  });
});

describe("the start's partners", () => {
  it("are the official files, unaltered, with the SHA-256 SOURCES.md records, served at the site's paths", async () => {
    const sources = readFileSync("docs/assets/logos/SOURCES.md", "utf8");
    expect(Object.keys(LOGO_FILES).sort()).toEqual(START_LOGOS.map((l) => l.src).sort());
    const c = testCloud({ engine: true });
    try {
      for (const [path, f] of Object.entries(LOGO_FILES)) {
        const bytes = readFileSync(f.source);
        expect(Buffer.from(f.b64, "base64").equals(bytes), path).toBe(true);
        expect(sources).toContain(createHash("sha256").update(bytes).digest("hex"));
        const r = await c.fetch(`${ORIGIN}${path}`);
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type")).toBe(f.type);
        expect(Buffer.from(await r.arrayBuffer()).equals(bytes)).toBe(true);
      }
    } finally { c.close(); }
  });
  it("name Alta as Alta (formerly Metal), Visa in text, and say no endorsement is implied", () => {
    expect(START.formerly).toBe("(formerly Metal)");
    expect(START.visa).toBe("Visa via Airwallex Airi");
    expect(START.runs_note).toMatch(/No endorsement implied/);
    const html = tryPage("n", { origin: ORIGIN, rpId: RP });
    expect(html).toContain(JSON.stringify(START_LOGOS));
    expect(START_LOGOS.map((l) => l.alt)).toEqual(["Airwallex", "Alta", "Claude"]);
  });
});
