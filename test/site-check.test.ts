// scripts/site-check.ts: the rules it applies to each page, offline (the live run is `npm run site:check`).
import { describe, expect, it } from "vitest";
import { pageProblems, SITE_CHECK_PAGES } from "../scripts/site-check.js";

describe("the live site check's rules", () => {
  it("passes a page that loads only from its own host", () => {
    const html = `<!doctype html><link rel="canonical" href="https://kit11.max-31b.workers.dev/home"><link rel="stylesheet" href="/assets/app.css"><img src="/assets/logo-airwallex.png" alt="Airwallex"><a href="https://github.com/x">code</a>`;
    expect(pageProblems(200, "text/html; charset=utf-8", html, "html")).toEqual([]);
  });

  it("names every image, script, frame and stylesheet from another host", () => {
    const html = `<img src="https://kit11.max-31b.workers.dev/assets/logo-airwallex.png"><script src="https://cdn.example/x.js"></script><link rel="stylesheet" href="https://fonts.example/f.css"><iframe src="https://www.youtube.com/embed/x"></iframe>`;
    expect(pageProblems(200, "text/html", html, "html")).toEqual([
      "loads https://kit11.max-31b.workers.dev/assets/logo-airwallex.png from another host",
      "loads https://cdn.example/x.js from another host",
      "loads https://fonts.example/f.css from another host",
      "loads https://www.youtube.com/embed/x from another host",
    ]);
  });

  it("fails on a status other than 200 and on the wrong content type", () => {
    expect(pageProblems(503, "text/html", "", "html")).toEqual(["status 503"]);
    expect(pageProblems(200, "text/html", "", "json")).toEqual(["content type text/html, not json"]);
    expect(pageProblems(200, "", "", "png")).toEqual(["content type (none), not png"]);
  });

  it("covers the home page, the demo in both forms, the proof pages, the partners' pages, /health and the logo", () => {
    const paths = SITE_CHECK_PAGES.map((p) => p.path);
    for (const p of ["/", "/try", "/try?present=1&phone=0", "/proof", "/verify", "/airwallex", "/alta", "/visa", "/t0", "/claude", "/health", "/assets/logo-airwallex.png"]) expect(paths).toContain(p);
  });
});
