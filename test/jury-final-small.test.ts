// Final jury, 13 Nov, small fixes: the hands-on demo (/try, served by purser-try) has a meta description; / and /home
// name /home as their canonical address; /security's L1 card ("The agent asks", which counts nothing) has its own short
// row in one column, with the track's dots and pulses still on each card's middle (the CSS's own geometry).
import { describe, expect, it } from "vitest";
import { tryPage, TRY_DESCRIPTION } from "../cloud/src/tryPage.js";
import { buildPages } from "../src/relay/assets.js";
import { SITE_URL } from "../src/ui/meta.js";
import { SECURITY_VIZ_CSS } from "../src/redesign/security.js";

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

  it("/security's L1 row is 64 px in one column, and the track's dots follow it", () => {
    expect(SECURITY_VIZ_CSS).toMatch(/@media \(max-width: 899px\) \{\n {2}\.zlayers \{ grid-template-rows: 64px; grid-auto-rows: 1fr; \}/);
    expect(SECURITY_VIZ_CSS).toContain(".ztrack { top: 32px; bottom: calc((100% - 104px) / 10); }");
  });
});

describe("/try's first screen", () => {
  it("says under the button what the visit is and how long, in words that hold on every device", async () => {
    const { START } = await import("../cloud/src/tryCopy.js");
    expect(START.what).toBe("About 2 minutes: read an invoice, sign it with your passkey, see it booked.");
    const html = tryPage("n0nce", { origin: "https://purser-try.example", rpId: "purser-try.example" });
    // The walkthrough on YouTube (13 Nov, owner): one small link, its address FILM_URL; since jury round 2 right under
    // the button, "Or watch the walkthrough (4:58)", then what the visit is.
    expect(html).toContain("box.append(text,b,el('p','walkl',walk),el('p','fine',C.start.what),el('p','fine',C.start.fine));if(inApp())box.append(inappCard(false));"); // and, in an in-app browser, the Open in Safari card (14 Nov)
    expect(START.walk).toBe("Or watch the walkthrough (4:58)");
  });
});
