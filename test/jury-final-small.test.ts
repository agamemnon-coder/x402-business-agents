// Final jury, 13 Nov, small fixes: the hands-on demo (/try, served by purser-try) has a meta description; / and /home
// name /home as their canonical address; /security's L1 card ("The agent asks", which counts nothing) has its own short
// row in one column, with the track's dots and pulses still on each card's middle (the CSS's own geometry).
import { describe, expect, it } from "vitest";
import { tryPage, TRY_DESCRIPTION } from "../cloud/src/tryPage.js";
import { buildPages } from "../src/relay/assets.js";
import { SITE_URL } from "../src/ui/meta.js";

describe("final jury: small fixes", () => {
  it("/try has a meta description, in its head, once", () => {
    const html = tryPage("n0nce", { origin: "https://purser-try.example", rpId: "purser-try.example" });
    const head = /<head>[\s\S]*?<\/head>/.exec(html)![0];
    expect(head.match(/<meta name="description"/g)).toHaveLength(1);
    expect(head).toContain(`<meta name="description" content="${TRY_DESCRIPTION}">`);
    expect(TRY_DESCRIPTION).toMatch(/test money/i);
  });

  it("/ and /home point their canonical link at /home; other pages have none", () => {
    const pages = buildPages({} as NodeJS.ProcessEnv);
    const canon = (h: string) => /<link rel="canonical" href="([^"]+)">/.exec(h)?.[1] ?? null;
    expect(canon(pages.home!)).toBe(`${SITE_URL}/home`);
    expect(canon(pages.proof!)).toBeNull();
  });

  // /security's L1 row (13 Nov) went with the layers diagram on 21 Nov (the owner: "a lot of old things on the new page").
});

describe("/try's first screen", () => {
  it("says in the headline what the visit does, and that any passkey works, in words that hold on every device", async () => {
    const { START } = await import("../cloud/src/tryCopy.js");
    // 15 Nov (Max): the concept in the headline, AI agents and Face ID; the step under it names the other devices' words.
    // 21 Nov (Max, mockup 175: "the only purpose of this page is the demo"): one short headline; the card's rows say any
    // passkey works ("Your passkey signs the exact terms").
    expect(START.heading).toBe("Try an AI payment end-to-end.");
    expect(START.eyebrow).toBe("Live demo · Sandbox");
    expect(START.steps).toEqual(["Read", "Check", "Approve", "Pay"]);
    expect(START.card.rows[2]!.r).toBe("Your passkey signs the exact terms");
  });
});
