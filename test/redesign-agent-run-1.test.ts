// The public pages played from another real run's record: agent run 1 (2 November, docs/demo/agent-run.json) in the
// main run's place. Its own rows decide what the pages say: its follow-up (the licence paid in the afternoon), its own
// notes (who started the licence payment, docs/demo/agent-run-notes.json), its signatures, refusals and stops. The main
// run's file is read as agent run 1's for this test's file system only; nothing is written.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (orig) => {
  const fs = await orig<typeof import("node:fs")>();
  const swap = (p: unknown) => (String(p).replace(/\\/g, "/").endsWith("docs/demo/main-run.json") ? String(p).replace("main-run.json", "agent-run.json") : null);
  const readFileSync = ((p: Parameters<typeof fs.readFileSync>[0], o?: Parameters<typeof fs.readFileSync>[1]) => {
    const s = swap(p);
    return fs.readFileSync(s ? (s.startsWith("file:") ? new URL(s) : s) : p, o as never);
  }) as typeof fs.readFileSync;
  return { ...fs, default: { ...fs, readFileSync }, readFileSync };
});

const { agentRun, runSpan, stops, stopStory, payments, timings, faceIdDecisions, split, AGENT_RUN_FILE } = await import("../src/redesign/run.js");
const { homePage } = await import("../src/redesign/home.js");
const { watchPage } = await import("../src/redesign/watch.js");
const { proofPage } = await import("../src/redesign/proof.js");
const P = await import("../src/redesign/partners.js");

const raw = JSON.parse(readFileSync(new URL("../docs/demo/agent-run.json", import.meta.url), "utf8")) as { run: string; proof: { face_id: number; chain_refusals: number } };
const notes = JSON.parse(readFileSync(new URL("../docs/demo/agent-run-notes.json", import.meta.url), "utf8")) as { flows: { transfer_id: string; decided: string }[] };
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the pages, played from agent run 1's record", () => {
  const run = agentRun();
  const r = run.record as Parameters<typeof stops>[0];

  it("is agent run 1, named without its rehearsal note, with its follow-up in the label", () => {
    expect(run).toMatchObject({ file: AGENT_RUN_FILE, standIn: false, name: "agent run 1" });
    expect(r.run).toBe(raw.run);
    expect(runSpan(r).followUp).toBe(true);
    expect(run.label).toMatch(/^Replay of agent run 1 and its follow-up, 2 Nov /);
  });

  it("takes who started each noted payment from the run's notes", () => {
    for (const n of notes.flows) {
      const f = r.snapshot.flows.find((x) => (x as { proof: { full?: string } }).proof.full === n.transfer_id);
      if (f) { expect(f.decided).toBe(n.decided); expect(f.what.endsWith(`: ${n.decided}`)).toBe(true); }
    }
  });

  it("counts its own stops, payments, signatures and decisions", () => {
    const st = stops(r), story = stopStory(r);
    expect(story.total).toBeGreaterThan(0);
    // Alta refused on chain in this run too: at least one Alta stop.
    expect(raw.proof.chain_refusals).toBeGreaterThan(0);
    expect(st.metal).toBeGreaterThan(0);
    expect(run.derived.stopped).toBe(String(story.total));
    const pay = payments(r);
    expect(run.tiles[1]!.value).toBe(String(pay.onChain));
    expect(run.derived.faceId).toBe(String(faceIdDecisions(r)));
    expect(run.derived.routine).toBe(String(split(r).routine));
    const t = timings(r);
    expect(run.derived.faceToPaid).toBe(String(t.faceToPaid ?? ""));
    // Its signatures are its ledger's: a cosigned step, then the approval.
    const faces = run.events.filter((e) => e.k === "face") as { status: string }[];
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((f) => ["COSIGNED", "APPROVED", "REJECTED", "STOPPED"].includes(f.status))).toBe(true);
  });

  it("every page renders from it, with nothing undefined", { timeout: 60_000 }, () => {
    const pages = { home: homePage(run), watch: watchPage(run), proof: proofPage(run), metal: P.metalPage(run), airwallex: P.airwallexPage(run), visa: P.visaPage(run), claude: P.claudePage(run), books: P.booksPage(run), notFound: P.notFoundPage(run) };
    for (const [name, html] of Object.entries(pages)) {
      expect(html.startsWith("<!doctype html>"), name).toBe(true);
      expect(text(html), name).not.toMatch(/undefined|NaN|\[object Object\]/);
    }
    expect(text(pages.watch)).toContain("agent run 1");
  });
});
