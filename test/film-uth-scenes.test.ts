// "Purser, under the hood" (src/film/uth.ts): every figure on screen is read from its record at build time, never typed
// in. The scenes come in the jury's order and stay under 3:30; the one-cent scene shows the two hashes the record holds,
// with the characters that differ marked, and the transfers it made (none); the numbers are the claims' and the README's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardPage, facts, ORDER, scenes } from "../src/film/uth.js";

const cardsOf = (id: string) => scenes().find((s) => s.id === id)!.segments.flatMap((s) => ("card" in s ? [s.card] : []));

describe("the under-the-hood film's scenes", () => {
  it("come in the jury's order and add up to at most three and a half minutes", () => {
    const s = scenes();
    expect(s.map((x) => x.id)).toEqual(ORDER);
    expect(s.reduce((n, x) => n + x.min, 0)).toBeLessThanOrEqual(210);
    for (const x of s) {
      expect(x.vo.length, x.id).toBeGreaterThan(40);
      expect(x.segments.length, x.id).toBeGreaterThan(0);
    }
  });

  it("the one-cent scene shows the record's signed and sent hashes, the differing characters marked, and no transfer made", () => {
    const f = facts();
    expect(f.refused.signed_sha256).not.toBe(f.refused.sent_sha256);
    const [card] = cardsOf("u04");
    expect(card).toContain(f.refused.signed_sha256);
    expect(card).toContain("<mark>");
    expect(card).toContain(`transfers made: ${f.refused.transfers_after - f.refused.transfers_before}`);
    expect(f.refused.transfers_after - f.refused.transfers_before).toBe(0);
    expect(f.replay.transfers_after - f.replay.transfers_before).toBeLessThanOrEqual(1);
  });

  it("the numbers scene says the claims' figures and the README's test count, nothing else", () => {
    const f = facts();
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toContain(`**${f.tests} tests passing**`);
    const [card] = cardsOf("u08");
    expect(card).toContain(`<b>${f.decisions}</b>`);
    expect(card).toContain(`<b>${f.alta}</b>`);
    expect(card).toContain(`<b>${f.faceId}</b>`);
    expect(card).toContain(`(${f.stops} stops)`);
    expect(card).toContain(f.tests.toLocaleString("en-GB"));
  });

  it("the Airwallex scene carries the approval hash from Airwallex's own metadata, the passkey's challenge is the terms' hash", () => {
    const f = facts();
    expect(cardsOf("u05")[0]).toContain(f.xfer.metadata.approval_sha256);
    expect(cardsOf("u05")[0]).toContain(`Reconciled ${f.reconFlows} money flows`);
    expect(f.rec.assertion.challenge_hex).toBe(f.rec.terms.terms_sha256);
    expect(cardsOf("u03")[0]).toContain(f.rec.assertion.challenge_hex);
    expect(cardsOf("u02")[0]).toContain(f.rec.terms.terms_sha256);
  });

  it("the /verify scene: every check on the paid file passes, and the one-cent copy fails exactly the hash, the challenge and the decision", () => {
    const f = facts();
    expect(f.verify.paid.every((l) => l.startsWith("pass"))).toBe(true);
    expect(f.verify.one_cent.filter((l) => l.startsWith("FAIL")).map((l) => l.split(":")[0]!.slice(5))).toEqual(["terms hash", "challenge", "decision"]);
    expect(scenes().find((s) => s.id === "u04v")!.vo).toContain(`all ${f.verify.paid.length} checks pass`);
  });

  it("a card page is the film's 1920x1080 frame with the font it is given", () => {
    const html = cardPage("<p>x</p>", "data:font/woff2;base64,AA");
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("width:1920px;height:1080px");
    expect(html).toContain("src:url(data:font/woff2;base64,AA)");
    expect(html).toContain("<body><p>x</p></body>");
  });
});
