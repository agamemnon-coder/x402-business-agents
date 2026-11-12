// The payables batch on the phone is a Dutch page: its countdown and amounts are Dutch (the Kit 11 pages stay English).
import { describe, expect, it } from "vitest";
import { countdown, nlMoney } from "../src/approve/client.js";

describe("the phone batch in Dutch", () => {
  it("writes amounts the Dutch way", () => {
    expect(nlMoney("EUR 4,617.20")).toBe("€ 4.617,20");
    expect(nlMoney("EUR 1,309.00 to Bergtex")).toBe("€ 1.309,00 to Bergtex");
    expect(nlMoney("USD 12.50")).toBe("USD 12,50");
    expect(nlMoney("EUR 1,234,567.89")).toBe("€ 1.234.567,89");
  });
  it("counts down in Dutch when asked, English otherwise", () => {
    const soon = new Date(Date.now() + 14 * 60_000 + 26_000).toISOString();
    expect(countdown(soon, "nl").text).toMatch(/^verloopt over 1[34]m \d\ds$/);
    expect(countdown(soon).text).toMatch(/^expires in 1[34]m \d\ds$/);
    expect(countdown(new Date(Date.now() - 1000).toISOString(), "nl").text).toBe("verlopen");
  });
});
