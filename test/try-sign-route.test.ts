// Judge panel, 13 Nov: https://kit11.max-31b.workers.dev/try/sign answered 404. The page is still in the code, but only a
// bundle built with TRY_SIGN_ENABLED carries it, and the site is deployed without it (the Try tab has led to /try since
// 12 Nov). Without it, /try/sign (with or without a trailing slash) now answers 301 to /try, so the README's badge, old
// screenshots and the film never land on a 404; with it, the page is served as before.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageResponse } from "../worker/src/core.js";
import { buildPages } from "../src/relay/assets.js";

const SITE = "https://kit11.max-31b.workers.dev";
const ON = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
const OFF = buildPages({} as NodeJS.ProcessEnv);
const get = (path: string, pages: typeof ON) => pageResponse(new Request(`${SITE}${path}`), pages);

describe("GET /try/sign is never a 404", () => {
  it("as deployed (no TRY_SIGN_ENABLED): 301 to /try, query kept, with or without a trailing slash, and /try answers 200", () => {
    for (const path of ["/try/sign", "/try/sign/"]) {
      const r = get(path, OFF);
      expect(r?.status, path).toBe(301);
      expect(r?.headers.get("location")).toBe("/try");
    }
    expect(get("/try/sign?from=readme", OFF)?.headers.get("location")).toBe("/try?from=readme");
    expect(get("/try", OFF)?.status).toBe(200);
  });

  it("in a bundle built with TRY_SIGN_ENABLED: the page itself, 200", () => {
    expect(get("/try/sign", ON)?.status).toBe(200);
  });

  it("the README's badge and screenshot tiles lead to a page that answers, not to /try/sign", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).not.toMatch(/kit11\.max-31b\.workers\.dev\/try\/sign/);
  });
});
