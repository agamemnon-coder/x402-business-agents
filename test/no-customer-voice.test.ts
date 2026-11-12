// The jury panel (12 Nov): llms.txt labelled two finance quotes as the voice of customers, one line after "no customers
// yet". There are no customers: that label appears nowhere in the repository's tracked files (this file included).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter((f) => f && !/\.(png|gif|jpe?g|pdf|woff2?|sqlite|ico)$/i.test(f));

describe("no customers' voice where there are no customers (jury panel, 12 Nov)", () => {
  it("appears in no tracked file", () => {
    const label = ["Customer", "voice"].join(" ");
    const hits = tracked.filter((f) => { try { return readFileSync(new URL(f, root), "utf8").includes(label); } catch { return false; } });
    expect(hits).toEqual([]);
  });
});
