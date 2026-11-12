// /go (master list 181): the short URL next to the QR code answers 302 to the hands-on demo; the target is a Worker
// variable with a safe default, and no token is ever in code.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GO_PATH, TRY_GO_DEFAULT, goResponse, goTarget } from "../worker/src/go.js";

const req = (path: string, method = "GET") => new Request(`https://kit11.example${path}`, { method });

describe("/go", () => {
  it("answers 302 to the default without TRY_GO_URL", () => {
    const r = goResponse(req("/go"), undefined)!;
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(TRY_GO_DEFAULT);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
  });

  it("follows TRY_GO_URL when it is an https URL, and ignores anything else", () => {
    expect(goTarget("https://example.org/try?x=1")).toBe("https://example.org/try?x=1");
    for (const bad of ["", "  ", "http://example.org/try", "javascript:alert(1)", "not a url", "https://u:p@example.org/"]) expect(goTarget(bad)).toBe(TRY_GO_DEFAULT);
  });

  it("answers GET and HEAD on /go and /go/ only, and drops the query", () => {
    expect(goResponse(req("/go/"), undefined)?.status).toBe(302);
    expect(goResponse(req("/go", "HEAD"), undefined)?.status).toBe(302);
    expect(goResponse(req("/go?token=abc"), undefined)?.headers.get("location")).toBe(TRY_GO_DEFAULT);
    expect(goResponse(req("/go", "POST"), undefined)).toBeNull();
    expect(goResponse(req("/gone"), undefined)).toBeNull();
    expect(goResponse(req("/go/x"), undefined)).toBeNull();
  });

  it("is wired into the Worker before the pages, and its default carries no token", () => {
    const index = readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8");
    expect(index).toMatch(/goResponse\(req, env\.TRY_GO_URL\)/);
    expect(index.indexOf("goResponse(req")).toBeLessThan(index.indexOf("pageResponse(req"));
    expect(new URL(TRY_GO_DEFAULT).search).toBe("");
    expect(GO_PATH).toBe("/go");
  });
});
