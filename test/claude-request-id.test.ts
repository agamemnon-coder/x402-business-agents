// The reader's calls carry Anthropic's request id, as the agents' calls do (live /try, 19 November: every claude.read
// had request_id null). The SDK's beta.messages.parse() returns a copy of the message, which loses the non-enumerable
// `_request_id` the SDK puts on what it returns; the reader takes the id from the response's request-id header instead.
// A real client is used here, with a stand-in fetch, so the SDK's own parse path is what is tested.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeReader } from "../src/claude/reader.js";
import { openDb } from "../src/db/open.js";
import { publicEvent, type EventRow } from "../src/engine/events.js";

/** An Anthropic client whose every call answers `answer` as JSON text, with `requestIds` as the request-id headers in turn. */
function clientAnswering(answer: unknown, requestIds: string[]): { client: Anthropic; calls: () => number } {
  let n = 0;
  const fetch = async () => {
    const id = requestIds[Math.min(n, requestIds.length - 1)]!;
    n++;
    const message = {
      id: `msg_${n}`, type: "message", role: "assistant", model: "claude-sonnet-5-5",
      content: [{ type: "text", text: JSON.stringify(answer) }],
      stop_reason: "end_turn", stop_sequence: null, stop_details: null,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json", "request-id": id } });
  };
  return { client: new Anthropic({ apiKey: "sk-test", fetch: fetch as never, maxRetries: 0 }), calls: () => n };
}

const schema = z.object({ kind: z.string() });
const reads = (db: ReturnType<typeof openDb>) =>
  (db.prepare("SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event = 'claude.read' ORDER BY seq").all() as EventRow[]);

describe("the reader's request id", () => {
  it("is recorded on claude.read for a structured read, and shown in the engine's events", async () => {
    const db = openDb(":memory:");
    const { client } = clientAnswering({ kind: "invoice" }, ["req_011ReaderAsk001"]);
    const r = await new ClaudeReader(db, client).ask({ task: "t", role: "act", actor: "claude", schema, instruction: "Read it.", document: "doc" }, () => ({ kind: "fallback" }));
    expect(r).toMatchObject({ source: "claude", value: { kind: "invoice" } });
    const [row] = reads(db);
    expect(JSON.parse(row!.payload_json).request_id).toBe("req_011ReaderAsk001");
    expect(publicEvent(row!).fields).toMatchObject({ source: "claude", request_id: "req_011ReaderAsk001" });
  });

  it("is recorded for a read of a PDF", async () => {
    const db = openDb(":memory:");
    const { client } = clientAnswering({ kind: "invoice" }, ["req_011ReaderPdf001"]);
    await new ClaudeReader(db, client).askPdf({ task: "t", role: "act", actor: "claude", schema, instruction: "Read it.", pdf: new Uint8Array([37, 80, 68, 70]) }, () => ({ kind: "fallback" }));
    expect(JSON.parse(reads(db)[0]!.payload_json).request_id).toBe("req_011ReaderPdf001");
  });

  it("is each call's own, never the one before it", async () => {
    const db = openDb(":memory:");
    const { client, calls } = clientAnswering({ kind: "invoice" }, ["req_011First", "req_011Second"]);
    const reader = new ClaudeReader(db, client);
    for (let i = 0; i < 2; i++) await reader.ask({ task: "t", role: "classify", actor: "claude", schema, instruction: "Read it.", document: `doc ${i}` }, () => ({ kind: "fallback" }));
    expect(calls()).toBe(2);
    expect(reads(db).map((r) => JSON.parse(r.payload_json).request_id)).toEqual(["req_011First", "req_011Second"]);
  });
});
