// A stand-in for the Treasury agent's Haiku sentence, for the tests and the local browser checks (no network): it
// answers as model "stand-in", which the page labels "Stand-in sentence (local check, not Claude)", never as Claude.
import type { SentenceSource } from "../../src/try/claude.js";

export class StandInLine {
  calls = 0;
  inputs: { system: string; facts: string }[] = [];
  text = "Alpine Packaging's EUR 1,850.00 invoice is above the EUR 500.00 I may pay alone, so I need your signature.";
  fail = false;
  readonly source: SentenceSource = (input) => {
    this.calls++;
    this.inputs.push(input);
    if (this.fail) return Promise.reject(new Error("stand-in: no sentence"));
    return Promise.resolve({ text: this.text, requestId: `req_stand-in-${String(this.calls).padStart(4, "0")}`, costUsd: 0.0004, model: "stand-in" });
  };
}
