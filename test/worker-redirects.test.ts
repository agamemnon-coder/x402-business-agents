// The site's own redirects (worker/src/core.ts pageResponse): a link pasted with its full stop goes to the same page on
// this site and never off it (code review, 13 Nov: "//evil.com." was a 302 to //evil.com); /mcp and /connect, which are
// Purser Cloud's, go to the docs' "Connect your AI" card (review, 13 Nov). No network.
import { describe, expect, it } from "vitest";
import { CONNECT_DOCS, pageResponse, type Pages } from "../worker/src/core.js";

const pages = { images: {}, csp: {} } as unknown as Pages;
const get = (path: string) => pageResponse(new Request(`https://kit11.example${path}`), pages);

describe("redirects on the site", () => {
  it("a trailing full stop or comma goes to the same path on this site, its query kept", () => {
    for (const [from, to] of [["/tour.", "/tour"], ["/proof,", "/proof"], ["/books.?x=1", "/books?x=1"]] as const) {
      const r = get(from)!;
      expect(r.status, from).toBe(302);
      expect(r.headers.get("location"), from).toBe(to);
    }
  });

  it("never sends anyone off the site: a trimmed path that a browser would read as another host is not redirected", () => {
    for (const path of ["//evil.com.", "//evil.com,", "/\\evil.com.", "/%5Cevil.com.", "///evil.com."]) {
      const r = get(path);
      const loc = r?.headers.get("location") ?? null;
      if (loc !== null) expect(new URL(loc, "https://kit11.example").origin, path).toBe("https://kit11.example");
      expect(loc === null || !/^[/\\]{2}/.test(loc), path).toBe(true);
    }
  });

  it("sends /mcp and /connect, Purser Cloud's, to the docs' Connect your AI card", () => {
    for (const path of ["/mcp", "/connect"]) {
      const r = get(path)!;
      expect(r.status, path).toBe(302);
      expect(r.headers.get("location"), path).toBe(CONNECT_DOCS);
    }
    expect(CONNECT_DOCS).toBe("/docs#connect-ai");
  });
});
