// docs/cloud.md lists every endpoint the route table serves, with the scope it needs (the reference must not drift).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTES } from "../cloud/src/app.js";
import { ENGINE_MODE } from "../cloud/src/engine/client.js";
import { cloudWranglerConfig } from "./support/wranglerConfig.js";

describe("the cloud API reference", () => {
  it("lists every endpoint with the scope it needs", () => {
    const doc = readFileSync("docs/cloud.md", "utf8");
    const need = (n: string) => (n === "public" ? "anyone" : n === "platform" ? "platform admin" : n);
    const missing = ROUTES.filter((r) => !doc.includes(`| \`${r.method} ${r.path}\` | ${need(r.need)} |`)).map((r) => `${r.method} ${r.path}`);
    expect(missing).toEqual([]);
  });

  it("says where the engine runs as the deploy wires it: the entry point, the object's binding and the switch", () => {
    const doc = readFileSync("docs/cloud.md", "utf8");
    const w = cloudWranglerConfig();
    expect(doc).toContain(`\`cloud/${w.main}\``);
    for (const b of w.durable_objects.bindings) expect(doc).toContain(`\`${b.name}\``);
    expect(doc).toContain(`\`ENGINE_MODE=${ENGINE_MODE}\``);
    expect(doc).not.toMatch(/starts it with none|keeps each company's ledger in memory/);
    // The engine's lists do not page with a cursor: the convention names them as its exceptions.
    expect(doc).not.toMatch(/Every list pages this way\./);
  });
});
