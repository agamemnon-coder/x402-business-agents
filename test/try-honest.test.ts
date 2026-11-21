// 19 Nov 2026 (live review of /try during judging): on the hosted demo the Claude switch cap_action_micros was unset, so
// every reservation failed closed (cloud/src/engine/spend.ts reserve(): "action_budget") and every run fell back to
// Purser's code: claude.capped, agent.run { status: "unavailable", latency_ms: 0 }, ap.received { read_by: "parser" }.
// The page still said "Claude is reading…", "what Claude read", "$0.0000 · 3 calls this run" and "Claude read the
// invoice… This run: 3 calls". The project's rule: never claim something ran live that did not. These pin the fix: a
// call is counted only when the engine's own fields say Claude answered, and the run-specific words follow who read
// the invoice in this run (the engine's read_by), with the fallback words tryCopy.ts already had.
import { describe, expect, it } from "vitest";
import { apiTrail } from "../src/airwallex/apiTrail.js";
import { AWX_TRAIL_CALLS } from "../cloud/src/try/proof.gen.js";
import { claudeCall, pausedNotice, presentExtra, PRESENT_GUIDE, PRESENT_GUIDE_CODE, PRESENT_PARTNERS, PRESENT_VERIFY, readerOf } from "../cloud/src/try/presentMode.js";
import { INVOICE, LIVE, WORK } from "../cloud/src/tryCopy.js";
import { tryPage } from "../cloud/src/tryPage.js";
import { VERIFY_BUNDLE_VERDICT, verdictWords } from "../src/proof/verifyPage.js";

const cfg = { origin: "https://x.test", rpId: "x.test" };

describe("a Claude call is counted only when Claude answered (19 Nov 2026)", () => {
  // The hosted run of 19 Nov, as the engine wrote it (src/agents/loop.ts finish, src/engine/events.ts "agent.run").
  const capped = (agent: string) => ({ agent, model: "claude-haiku-5-5", status: "unavailable", turns: 0, cost_usd_micros: 0, latency_ms: 0 });

  it("does not count an agent's run that never reached Claude (status unavailable, nothing spent, no call's time)", () => {
    for (const a of ["checker", "coder", "payer"]) expect(claudeCall("agent.run", capped(a))).toBeNull();
    expect(claudeCall("agent.run", { agent: "checker", status: "unavailable" })).toBeNull();
    // Any status the loop does not write as a run that asked Claude, with nothing to show a call, is not one either.
    expect(claudeCall("agent.run", { agent: "checker", status: "skipped", cost_usd_micros: 0 })).toBeNull();
    expect(claudeCall("agent.run", { agent: "checker" })).toBeNull();
  });

  it("counts each call of a run that did ask Claude: one per entry of claude_ms, the calls' own times", () => {
    expect(claudeCall("agent.run", { agent: "checker", status: "done", claude_ms: "812,640", cost_usd_micros: 2100, request_id: "req_abcdef123456" })).toEqual({ n: 2 });
    expect(claudeCall("agent.run", { agent: "payer", status: "incomplete", claude_ms: "900,700,650", cost_usd_micros: 3000 })).toEqual({ n: 3 });
    // A run that ended unavailable after a call (a later turn failed or hit its cap): the call it made is real.
    expect(claudeCall("agent.run", { agent: "coder", status: "unavailable", claude_ms: "1200", cost_usd_micros: 900 })).toEqual({ n: 1 });
    expect(claudeCall("agent.run", { agent: "coder", status: "unavailable", cost_usd_micros: 900 })).toEqual({ n: 1 });
    expect(claudeCall("agent.run", { agent: "coder", status: "unavailable", request_id: "req_abcdef123456" })).toEqual({ n: 1 });
    // A finished run from before claude_ms was recorded: at least the one call.
    expect(claudeCall("agent.run", { agent: "checker", status: "done", cost_usd_micros: 1500 })).toEqual({ n: 1 });
  });

  it("counts the reader's answer (claude.read is written only when Claude answered) and nothing else", () => {
    expect(claudeCall("claude.read", { source: "claude", model: "claude-haiku-5-5", cost_usd_micros: 700 })).toEqual({ n: 1 });
    for (const e of ["claude.capped", "claude.fallback", "claude.asking", "ap.received", "ap.checker_decided"]) expect(claudeCall(e, { cost_usd_micros: 5 })).toBeNull();
  });

  it("is the page's own function, as text, and the tally adds each run's calls", () => {
    for (const kind of ["public", "present"] as const) {
      const { script } = presentExtra(kind);
      expect(script).not.toContain("__CLAUDE_CALL__");
      expect(script).toContain(`const claudeCall=${claudeCall.toString()};`);
      expect(script).toContain("const cc=claudeCall(String(e.event||''),f);if(cc&&!CALLS.has(e.seq))");
      expect(script).not.toContain("if((e.event==='claude.read'||e.event==='agent.run')&&!CALLS.has(e.seq))");
      expect(script).toContain("const nCalls=(cs)=>cs.reduce((x,c)=>x+(Number(c.n)||1),0);");
      expect(() => new Function(script)).not.toThrow();
    }
  });
});

describe("who read the invoice in this run, from the engine's own events (19 Nov 2026)", () => {
  it("is sure from ap.received's read_by, and only a hint from claude.read, claude.capped or claude.fallback", () => {
    expect(readerOf("ap.received", { read_by: "parser" })).toEqual({ by: "code", sure: true });
    expect(readerOf("ap.received", { read_by: "claude:claude-haiku-5-5" })).toEqual({ by: "claude", sure: true });
    expect(readerOf("ap.received", { read_by: "claude-scan:claude-haiku-5-5" })).toEqual({ by: "claude", sure: true });
    expect(readerOf("claude.capped", { reason: "action_budget" })).toEqual({ by: "code", sure: false });
    expect(readerOf("claude.fallback", { source: "fallback" })).toEqual({ by: "code", sure: false });
    expect(readerOf("claude.read", { source: "claude" })).toEqual({ by: "claude", sure: false });
    expect(readerOf("ap.received", {})).toBeNull();
    expect(readerOf("agent.run", { status: "unavailable" })).toBeNull();
  });

  it("is the page's own function, and a new filing forgets the last one's reader", () => {
    for (const kind of ["public", "present"] as const) {
      const { script } = presentExtra(kind);
      expect(script).toContain(`const readerOf=${readerOf.toString()};`);
      expect(script).toContain("INJ.since=INJ.max;INJ.flag=false;EVT.length=0;forgetRead();FILED.seq=INJ.max;");
      expect(script).toContain("const forgetRead=()=>{READ.by='';READ.sure=false;READ.why='';keepRead()};");
      // A new test company forgets it too.
      expect(script).toContain("CALLS.clear();keepCalls();forgetRead()");
    }
  });

  it("has fallback words for every run-specific line that says Claude reads, and none of them says Claude read", () => {
    expect(PRESENT_GUIDE_CODE.reading.t).toBe(WORK.readingCode);
    for (const k of ["invoice", "reading", "work", "workInj"] as const) {
      expect(PRESENT_GUIDE_CODE[k].k).toBe(PRESENT_GUIDE[k].k);
      expect(`${PRESENT_GUIDE_CODE[k].t} ${PRESENT_GUIDE_CODE[k].d}`).not.toMatch(/Claude (reads|read |is reading)|AI agent (read|is reading|will read)/);
    }
    // The finish's first line: who read it in this run, in tryCopy's own fallback words.
    expect(PRESENT_VERIFY.code.h).toBe(LIVE.ev["claude.fallback"]!.split(". ")[0]);
    expect(`${PRESENT_VERIFY.code.h} ${PRESENT_VERIFY.code.p}`).not.toMatch(/Claude read the invoice/);
    const { script } = presentExtra("public");
    // The live words stay for a run Claude did read.
    expect(script).toContain("Claude read the invoice");
    expect(script).toContain("'what Claude read'");
    expect(script).toContain("'Claude reads the PDF'");
    // The fallback words, chosen by who read it.
    expect(script).toContain("readerIs()==='code'");
    expect(script).toContain("what Purser’s code read");
  });

  it("the reading line under the skeleton turns to the code's words when the engine says Claude was not asked", () => {
    const html = tryPage("n0nce", cfg);
    expect(html).toContain("if(live&&stage===0&&/^claude\\.(capped|fallback)$/.test(String(e&&e.event||''))){said.textContent=C.work.readingCode;n.remove()}");
  });
});

describe("live Claude did not read this invoice: said plainly in the main flow (Max, 19 Nov 2026)", () => {
  const tail = (done: boolean) => ` Purser's code ${done ? "read" : "reads"} this invoice instead. Every limit, check and signature works exactly the same.`;
  it("names why, in tryCopy's own words for each budget that is used", () => {
    for (const r of ["action_budget", "pool_day_cap", "company_cap", "address_cap", "all_time_cap"]) {
      expect(pausedNotice(r, true, LIVE.caps)).toBe(`Live Claude is paused right now: ${LIVE.caps[r]}.${tail(true)}`);
      expect(pausedNotice(r, false, LIVE.caps)).toBe(`Live Claude is paused right now: ${LIVE.caps[r]}.${tail(false)}`);
    }
    expect(pausedNotice("all_time_cap", true, LIVE.caps)).toBe(`Live Claude is paused right now: the live budget for Claude is used.${tail(true)}`);
  });

  it("says switched off, not set up, busy, off for this demo, or only that Claude's reading was not used", () => {
    expect(pausedNotice("switch_off", true, LIVE.caps)).toBe(`Live Claude is switched off right now.${tail(true)}`);
    expect(pausedNotice("no_key", true, LIVE.caps)).toBe(`Live Claude is not set up here.${tail(true)}`);
    expect(pausedNotice("busy", false, LIVE.caps)).toBe(`Live Claude is busy right now.${tail(false)}`);
    expect(pausedNotice("mode_code", true, LIVE.caps)).toBe(`Live Claude is off for this demo right now.${tail(true)}`);
    // A fallback with no cap (a refusal, a reading that did not fit): no reason is made up.
    expect(pausedNotice("", true, LIVE.caps)).toBe(`Claude's reading was not used for this invoice.${tail(true)}`);
    expect(pausedNotice("something_else", true, LIVE.caps)).toBe(`Claude's reading was not used for this invoice.${tail(true)}`);
  });

  it("is the page's own function, shown on the reading step and the end card, and only when Purser's code read the invoice", () => {
    for (const kind of ["public", "present"] as const) {
      const { script } = presentExtra(kind);
      expect(script).toContain(`const pausedNotice=${pausedNotice.toString()};`);
      expect(script).toContain("const pausedText=(done)=>readerIs()==='code'?pausedNotice(READ.why||(modeOf()==='code'?'mode_code':''),done,PC.caps):'';");
      expect(script).toContain("const t=wk?pausedText(!wk.querySelector('.skel')):''");
      expect(script).toContain("const paused=pausedText(true);");
      // The reason is the engine's own claude.capped reason, kept only when it is one tryCopy names.
      expect(script).toContain("if(ev==='claude.capped'&&typeof f.reason==='string'&&Object.prototype.hasOwnProperty.call(PC.caps,f.reason)");
    }
  });
});

describe("the small labels of the 19 Nov review", () => {
  it("the partner card's Airwallex count is the count /airwallex lists (src/airwallex/apiTrail.ts)", () => {
    expect(AWX_TRAIL_CALLS).toBe(apiTrail().calls);
    expect(PRESENT_PARTNERS.cards[0]!.link).toBe(`${apiTrail().calls} sandbox calls on /airwallex`);
  });

  it("the refusal is credited to Purser's code, and the zero-extra-calls line waits for the one-cent change", () => {
    const { script } = presentExtra("public");
    expect(script).toContain("state(i)==='bad'?'Purser’s code':");
    expect(script).not.toContain("mk('b','',n),mk('span','',state(i)==='wait'");
    // Only once the change was tried (the refusal on screen), never on the step that offers it.
    expect(script).toContain("if(g==='refused')PAYAT.tried=true;");
    expect(script).toContain("...(PAYAT.tried&&extra>=0?");
  });

  it("the EUR 1,850.00 sample says it needs a signature, and the held group starts at the first held sample", () => {
    expect(INVOICE.hints.clean).toMatch(/^Needs your signature/);
    expect(INVOICE.hints.clean).not.toMatch(/Ready to pay/);
    expect(INVOICE.heldGroup).not.toMatch(/\bfour\b/);
    const html = tryPage("n0nce", cfg);
    expect(html).toContain("if(!paid(s)&&!list.querySelector('.igroup'))list.append(el('div','igroup',C.invoice.heldGroup));");
  });

  it("/verify says the proof is valid and the payment refused for a refusal's bundle; its checks are unchanged", () => {
    expect(VERIFY_BUNDLE_VERDICT.validRefused).toBe("Proof valid · payment refused");
    expect(verdictWords(true, { decision: { outcome: "refused" } }, VERIFY_BUNDLE_VERDICT)).toBe(VERIFY_BUNDLE_VERDICT.validRefused);
    expect(verdictWords(true, { decision: { outcome: "paid" } }, VERIFY_BUNDLE_VERDICT)).toBe(VERIFY_BUNDLE_VERDICT.valid);
    expect(verdictWords(false, { decision: { outcome: "refused" } }, VERIFY_BUNDLE_VERDICT)).toBe(VERIFY_BUNDLE_VERDICT.invalid);
    expect(verdictWords(true, null, VERIFY_BUNDLE_VERDICT)).toBe(VERIFY_BUNDLE_VERDICT.valid);
  });

  it("on a phone the start's button comes before the three steps (390 x 844: on the first screen)", () => {
    const { css } = presentExtra("public");
    expect(css).toContain("@media (max-width: 1023px) { body.pv-shell:has(.screen.start) main { grid-template-areas: \"eyebrow\" \"h1\" \"lede\" \"cta\" \"fine\" \"flow\" \"partners\" \"real\"; } }");
  });
});
