// 15 Nov (jury: "if a script that always says pay is just as safe, what does Claude add?"): two pure helpers for /try's
// screen 2, made only from the engine's events for this invoice (src/engine/events.ts, its allowlisted fields):
//   traceOf(items)    the Checker agent's steps, one row each, in the engine's order: each Claude call with its own
//                     measured time (agent.run's claude_ms, by turn), each tool it called (agent.tool: its name, how many
//                     input fields, the first sentence of its answer, the tool's own ms; refused when code refused it), a
//                     reminder (agent.nudged), its decision and reason (ap.checker_decided), what Purser's rails did with
//                     it and the rule (outcome, overridden_by, code's why), and the run (turns, time, cost). A step the
//                     events do not hold is not shown; nothing is made up.
//   compareOf(items)  the same invoice through the worst-case policy (src/evals/worstCaseWords.ts ALWAYS_PAY), as the
//                     engine recorded it beside the decision (script_outcome, script_overridden_by): Claude's outcome and
//                     the script's side by side, and which of four verdicts holds (same, stopped, stricter, fallback).
//
// One implementation serves the page and the tests: AGENT_TRACE_JS is plain script the page carries as it is (the
// page's one script, cloud/src/tryPage.ts), and the functions below run that same text here in Node. Pure: no DOM, no
// clock, no network. T is TRACE, S is SCRIPT and W is LIVE of cloud/src/tryCopy.ts.
import { LIVE, SCRIPT, TRACE } from "../tryCopy.js";

export interface TraceRow {
  /** claude: one Claude call; tool: one tool call; nudge; decision; rails; run. */
  kind: "claude" | "tool" | "nudge" | "decision" | "rails" | "run";
  text: string;
  /** The muted part on the same line (a tool's input and answer, code's why); "" when none. */
  sub: string;
  /** The agent's own words (its reason), shown marked as its own; "" when none. */
  own: string;
  /** The step's own time ("0.8 s", "3 ms"), from the event; "" when the event has none. */
  time: string;
  /** A tool call Purser's code refused. */
  refused: boolean;
}
export interface Compared {
  verdict: "same" | "stopped" | "stricter" | "fallback" | "missing";
  claude: { action: string; outcome: string; rails: string; rule: string } | null;
  script: { action: string; outcome: string; rails: string; rule: string } | null;
  /** The verdict's sentence (SCRIPT), then the record's own line and the close. */
  say: string;
}

/** agentTraceOf(T, S, W) returns { traceOf, compareOf }. */
export const AGENT_TRACE_JS = String.raw`
const agentTraceOf=(T,S,W)=>{
  const own=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
  const code=(v)=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,48}$/.test(v)?v:'';
  const words=(v)=>code(v).replace(/[_.-]/g,' ').toLowerCase();
  const num=(v)=>typeof v==='number'&&isFinite(v)&&v>=0&&v<1e9?v:null;
  const fill=(s,v)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]===undefined||v[k]===null?'':v[k]));
  const cap=(s)=>s?s.charAt(0).toUpperCase()+s.slice(1):'';
  const model=(id)=>{const x=/^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2})(?!\d))?/.exec(code(id));return x?W.who.claude+' '+cap(x[1])+' '+x[2]+(x[3]?'.'+x[3]:''):W.who.claude};
  const secs=(ms)=>(ms/1000).toFixed(1)+' s';
  const said=(v)=>typeof v==='string'&&v.length<=200?v.replace(/\s+$/,''):'';
  const act=(v)=>code(v)?(own(W.actions,v)?W.actions[v]:words(v)):'';
  const rails=(o)=>code(o)&&own(T.rails,o)?T.rails[o]:'';
  // A rule in the trace's words where it has them (the zero agent limit), else the code in plain words.
  const ruleOf=(by)=>code(by)?fill(T.rule,{rule:own(T.rules,by)?T.rules[by]:words(by)}):'';
  // 15 Nov (jury): no concern of the agent's own and none of code's, and the CFO step is the rails' (as tryEvents.ts).
  const clearOf=(f)=>f.source==='claude'&&f.action==='ask_cfo'&&f.code_requires==='ask_cfo'&&f.outcome==='ask_cfo'&&f.concerns===0&&!code(f.codes)&&f.overridden!==true;
  // This invoice's Checker: its working rows (fields.agent checker) and its decision, in the engine's order.
  const mine=(items)=>(Array.isArray(items)?items:[]).filter((e)=>e&&typeof e==='object'&&typeof e.event==='string')
    .map((e)=>({e,f:e.fields&&typeof e.fields==='object'?e.fields:{}}))
    .filter(({e,f})=>e.event==='ap.checker_decided'||f.agent==='checker')
    .sort((a,b)=>(num(a.e.seq)||0)-(num(b.e.seq)||0));
  const last=(m,name)=>{for(let i=m.length-1;i>=0;i--)if(m[i].e.event===name)return m[i];return null};
  function traceOf(items){
    const all=mine(items),rows=[];
    // One run only: the rows of the task (the subject) of the last tool call or run, so an earlier invoice's never mix in.
    const dec=last(all,'ap.checker_decided');
    const work=all.filter((x)=>x.e.event!=='ap.checker_decided'&&(!dec||(num(x.e.seq)||0)<(num(dec.e.seq)||0)));
    const task=work.length?work[work.length-1].e.subject:null;
    const m=work.filter((x)=>x.e.subject===task);
    const run=last(m,'agent.run');
    const ms=run&&typeof run.f.claude_ms==='string'&&/^\d{1,9}(,\d{1,9}){0,11}$/.test(run.f.claude_ms)?run.f.claude_ms.split(',').map(Number):[];
    const who=model((run&&run.f.model)||(m.find((x)=>code(x.f.model))||{f:{}}).f.model);
    let turn=0;
    // A Claude call's row before the first tool call of its turn; the calls with no tool (its last words) at the run.
    const upTo=(t)=>{while(turn<t){turn++;rows.push({kind:'claude',text:fill(T.turn,{model:who,t:turn}),sub:'',own:'',time:ms[turn-1]!==undefined?secs(ms[turn-1]):'',refused:false})}};
    for(const {e,f} of m){
      if(e.event==='agent.tool'){
        const t=num(f.turn);if(t!==null&&t>=1&&t<=12)upTo(t);
        const name=code(f.tool);const n=num(f.inputs);
        const input=n===0?T.noInput:n!==null?fill(T.input,{n}):'';
        const answer=said(f.answer);
        rows.push({kind:'tool',text:own(T.tools,name)?T.tools[name]:fill(T.tool,{tool:name||'?'}),sub:[input,answer].filter(Boolean).join(' → '),own:'',time:num(f.ms)!==null?f.ms+' ms':'',refused:f.refused===true});
      }else if(e.event==='agent.nudged')rows.push({kind:'nudge',text:T.nudged,sub:said(f.reason),own:'',time:'',refused:false});
      else if(e.event==='agent.run'){const t=num(f.turns);if(t!==null&&t<=12)upTo(t)}
    }
    if(dec){
      const f=dec.f,claude=f.source==='claude';
      const clear=clearOf(f);
      rows.push(claude?{kind:'decision',text:clear?T.decidedClear:fill(T.decided,{action:act(f.action)}),sub:'',own:said(f.reason),time:'',refused:false}
        :{kind:'decision',text:T.fallback,sub:fill(T.decided,{action:act(f.action)}),own:'',time:'',refused:false});
      // The rule: what overrode the decision when something did (with code's why); else, Claude's own call within code's checks.
      const rule=code(f.overridden_by)?ruleOf(f.overridden_by):clear?ruleOf('no_alone_limit'):claude?T.ownRule:'';
      if(rails(f.outcome))rows.push({kind:'rails',text:rails(f.outcome),sub:[rule,code(f.overridden_by)||!claude?said(f.enforced):''].filter(Boolean).join(' · '),own:'',time:'',refused:false});
    }
    if(run){const t=num(run.f.turns),l=num(run.f.latency_ms),c=num(run.f.cost_usd_micros);
      if(t!==null&&l!==null&&c!==null)rows.push({kind:'run',text:fill(T.run,{turns:t,s:(l/1000).toFixed(1),usd:(c/1e6).toFixed(4)}),sub:'',own:'',time:'',refused:false})}
    return rows;
  }
  function compareOf(items){
    const dec=last(mine(items),'ap.checker_decided');
    const f=dec?dec.f:{};
    if(!dec||!rails(f.script_outcome)||!rails(f.outcome))return {verdict:'missing',claude:null,script:null,say:S.missing};
    const claude={action:clearOf(f)?T.noConcerns:act(f.action),outcome:f.outcome,rails:rails(f.outcome),rule:code(f.overridden_by)?ruleOf(f.overridden_by):clearOf(f)?ruleOf('no_alone_limit'):f.source==='claude'?T.ownRule:''};
    const script={action:act('pay'),outcome:f.script_outcome,rails:rails(f.script_outcome),rule:ruleOf(f.script_overridden_by)};
    const stop=(o)=>o==='hold'||o==='reject';
    const verdict=f.source!=='claude'?'fallback':f.outcome===f.script_outcome?'same':stop(f.outcome)&&!stop(f.script_outcome)?'stopped':'stricter';
    return {verdict,claude,script,say:S[verdict]+' '+S.line+' '+S.close};
  }
  return {traceOf,compareOf};
};
`;

type Kit = { traceOf: (items: unknown) => TraceRow[]; compareOf: (items: unknown) => Compared };
let kit: Kit | null = null;
const made = (): Kit => (kit ??= (new Function(`${AGENT_TRACE_JS}\nreturn agentTraceOf;`)() as (t: typeof TRACE, s: typeof SCRIPT, w: typeof LIVE) => Kit)(TRACE, SCRIPT, LIVE));

/** The Checker's steps on this invoice, as the page draws them: the page's own script, run here as it is. */
export const traceOf = (items: unknown): TraceRow[] => made().traceOf(items);
/** Claude's outcome beside the always-pay script's, as the page draws them. */
export const compareOf = (items: unknown): Compared => made().compareOf(items);
