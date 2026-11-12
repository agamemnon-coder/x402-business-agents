// The illustration of the console's sign-in and /try's start (cloud/src/scene.ts): every number in it is read from the
// try samples' clean invoice or computed here, never typed; it is one named image; it stands still for reduced motion.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { SCENE_AMOUNT, SCENE_CHANGED, SCENE_CSS, SCENE_HASH, SCENE_NAME, SCENE_TERMS, SCENE_TERMS_SHA256, sceneSvg } from "../cloud/src/scene.js";
import { CLEAN, SAMPLE_SOURCES } from "../src/engine/tryWorld.js";

const svg = sceneSvg();

describe("the scene", () => {
  it("shows the try samples' clean invoice: its supplier, number, IBAN ending and amount", () => {
    const clean = SAMPLE_SOURCES.find((s) => s.key === "clean")!.text;
    expect(clean).toContain(CLEAN.supplier.name);
    expect(clean).toContain(`Total due ${SCENE_AMOUNT}`);
    expect(svg).toContain(`>${CLEAN.supplier.name}<`);
    expect(svg).toContain(`>INVOICE ${CLEAN.invoiceNo}<`);
    expect(svg).toContain(`>···· ${CLEAN.iban.slice(-4)}<`);
    expect(svg).toContain(`>${SCENE_AMOUNT}<`);
    expect(SCENE_AMOUNT).toBe(`EUR ${(CLEAN.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    // The changed amount is one cent more.
    expect(svg).toContain(`>${SCENE_CHANGED}<`);
    expect(SCENE_CHANGED).toBe(`EUR ${((CLEAN.amountCents + 1) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  });

  it("stamps the SHA-256 of the canonical terms it shows (JCS: keys sorted), shortened", () => {
    expect(SCENE_TERMS).toEqual({ amount: (CLEAN.amountCents / 100).toFixed(2), currency: "EUR", due_date: CLEAN.dueDate, iban_last4: CLEAN.iban.slice(-4), invoice_no: CLEAN.invoiceNo, payee: CLEAN.supplier.name });
    const canonical = `{"amount":"${SCENE_TERMS.amount}","currency":"EUR","due_date":"${CLEAN.dueDate}","iban_last4":"${CLEAN.iban.slice(-4)}","invoice_no":"${CLEAN.invoiceNo}","payee":"${CLEAN.supplier.name}"}`;
    expect(SCENE_TERMS_SHA256).toBe(createHash("sha256").update(canonical).digest("hex"));
    expect(SCENE_HASH).toBe(SCENE_TERMS_SHA256.slice(0, 10));
    expect(svg).toContain(`>terms ${SCENE_HASH}<`);
  });

  it("is one image named as an illustration, its own text hidden from screen readers, with nothing that runs", () => {
    expect(SCENE_NAME).toBe("How Purser pays an invoice: an illustration");
    expect(svg).toMatch(new RegExp(`^<svg class="scene" viewBox="[\\d ]+" role="img" aria-label="${SCENE_NAME}" xmlns="http://www.w3.org/2000/svg"><g aria-hidden="true">`));
    expect(svg).not.toMatch(/<script|\son[a-z]+=|href|style=|<image|url\(/i);
  });

  it("moves only through CSS keyframes, and not at all for reduced motion", () => {
    expect(SCENE_CSS).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(SCENE_CSS).toContain("@media (prefers-reduced-motion: reduce) { .scene, .scene * { animation: none !important; } }");
    expect(SCENE_CSS).not.toMatch(/url\(/);
  });

  it("is on the console's page too, with its CSS in the one nonce style", () => {
    const page = consolePage("n0nce", { origin: "https://cloud.example", rpId: "cloud.example", mailDomain: "" });
    expect(page).toContain(`<div class="hero">${svg}</div>`);
    expect(page).toContain(SCENE_CSS);
    expect(page).not.toMatch(/class="mk">P</);
  });
});
