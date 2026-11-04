import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crossCheckNotice, parsePriceNoticeFallback } from "../src/agents/notices.js";

describe("price notice", () => {
  const text = readFileSync(new URL("../fixtures/stockline-price-notice.txt", import.meta.url), "utf8");
  it("extracts the old and new price", () => {
    expect(parsePriceNoticeFallback(text)).toMatchObject({ supplier: "stockline", old_price: "0.02", new_price: "0.04", effective_at: "2026-10-30T10:30:00.000Z" });
  });
  it("matches only the live offer", () => {
    const n = parsePriceNoticeFallback(text);
    expect(crossCheckNotice(n, 4)).toEqual({ ok: true });
    expect(crossCheckNotice(n, 5).ok).toBe(false);
  });
});
