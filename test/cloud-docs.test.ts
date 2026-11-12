// docs/cloud.md lists every endpoint the route table serves, with the scope it needs (the reference must not drift).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTES } from "../cloud/src/app.js";

describe("the cloud API reference", () => {
  it("lists every endpoint with the scope it needs", () => {
    const doc = readFileSync("docs/cloud.md", "utf8");
    const need = (n: string) => (n === "public" ? "anyone" : n === "platform" ? "platform admin" : n);
    const missing = ROUTES.filter((r) => !doc.includes(`| \`${r.method} ${r.path}\` | ${need(r.need)} |`)).map((r) => `${r.method} ${r.path}`);
    expect(missing).toEqual([]);
  });
});
