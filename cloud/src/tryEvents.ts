// An engine event (src/engine/events.ts) as a row of the /try page's live panel: who did it, what, which kind of step,
// and whether it is an open Claude call. The words are in cloud/src/tryCopy.ts (LIVE): one line per event on the
// engine's allowlist, filled from the few fields that event's allowlist lets through (an amount, a status, finding
// codes, a model), never a field dump. An event with no line of its own gets one neutral sentence.
//
// Who: "Claude {model}" only for a claude.* event whose own fields say Claude answered (source "claude", or a model
// and no other source); an open call (claude.asking) is "{agent or Reader} · Claude {model}". "You" for the person's
// own signing and approval steps. Everything else is "Purser's code". Lines where money moves end with "simulated bank
// · test money".
//
// The agents (task A6): a decision (ap.checker_decided, ap.coded, ap.payer_proposed) is one row, "<Agent> agent ·
// Claude {model}" (or "· Purser's code" when code decided), its lead ("Decided: pay, because"), the reason in the
// line's own words (own, marked so on the page), and under it what Purser's code enforced (enforced), each from the
// event's allowlisted fields only. Their working rows (agent.*, and claude.asking or claude.read of an agent's turn) are
// fold rows: the page keeps them in the "All steps" fold.
//
// One implementation serves the page and this module: EVENT_LINE_JS is plain script the page carries as it is
// (cloud/src/tryPage.ts), and eventLine() below runs that same text once, here in Node. It is pure: no DOM, no clock, no
// network. The page never builds code from text; a Worker never calls eventLine().
import type { EngineEvent } from "../../src/engine/events.js";
import { LIVE } from "./tryCopy.js";

export interface TryEventLine {
  who: string;
  text: string;
  tag: "claude" | "code" | "money" | "sign" | null;
  /** A Claude call that has not answered yet: the page counts its running time. */
  asking: boolean;
  /** An agent's working step (a tool call, its words, its run): shown only in the "All steps" fold. */
  fold: boolean;
  /** An agent's decision: the line's start, and the reason in its own words after it ("" when the event has none). */
  lead: string;
  own: string;
  /** An agent's decision: "Purser's code enforced: …", when the event says what code enforced ("" otherwise). */
  enforced: string;
}

/** eventLineOf(W): W is LIVE of tryCopy.ts. It returns the function from an event to its line. */
export const EVENT_LINE_JS = String.raw`
const eventLineOf=(W)=>{
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const code=(v)=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,48}$/.test(v)?v:'';
  const words=(v)=>code(v).replace(/[_.-]/g,' ').toLowerCase();
  const num=(v)=>typeof v==='number'&&isFinite(v)&&v>=0&&v<1e9?String(v):'';
  const cap=(s)=>s?s.charAt(0).toUpperCase()+s.slice(1):'';
  const modelName=(id)=>{const x=/^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2})(?!\d))?/.exec(code(id));return x?W.who.claude+' '+cap(x[1])+' '+x[2]+(x[3]?'.'+x[3]:''):W.who.claude};
  // Amounts and dates as the whole page writes them: EUR 1,850.00 and 30 Nov 2026.
  const grouped=(a)=>{const m=/^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(String(a));if(!m)return '';const d=(m[3]||'').padEnd(2,'0');return m[1]+m[2].replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+d};
  const amount=(f)=>/^-?\d{1,15}(\.\d{1,4})?$/.test(String(f.amount))&&/^[A-Z]{3}$/.test(String(f.currency))?f.currency+' '+grouped(f.amount):'';
  const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day=(v)=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(code(v));return m&&+m[2]>=1&&+m[2]<=12?Number(m[3])+' '+MON[+m[2]-1]+' '+m[1]:''};
  const said2=(o,v)=>code(v)?(own(o,v)?o[v]:words(v)):'';
  const status=(v)=>code(v)?(own(W.status,v)?W.status[v]:words(v)):'';
  const found=(v)=>(typeof v==='string'?v:'').split(',').filter(code).slice(0,3).map(words).join(', ');
  const fill=(s,v)=>{let whole=true;const out=s.replace(/\{(\w+)\}/g,(_,k)=>{if(!v[k])whole=false;return v[k]||''});return whole?out:null};
  const PERSON=/^(proposal\.(approved|rejected|cosigned)|passkey\.enrolled|ap\.(duplicate_cleared|credit_accepted)|payee\.add_verified|batch\.line_removed)$/;
  const SIGN=/^(passkey\.|proposal\.(approved|rejected|cosigned)$|approval\.)/;
  const MONEY=/^(transfer|fx|treasury|platform_fee|batch)\./;
  return (e)=>{
    e=e&&typeof e==='object'?e:{};
    const f=e.fields&&typeof e.fields==='object'?e.fields:{};
    const name=typeof e.event==='string'?e.event:'';
    if(!/^[a-z_]+\.[a-z_]+$/.test(name)||!own(W.ev,name))return {who:W.who.purser,text:W.step,tag:null,asking:false,fold:false,lead:'',own:'',enforced:''};
    const asking=name==='claude.asking';
    let who=W.who.code,tag='code';
    // Task A6: an agent's decision is the agent's line when a model answered; agent_model names the model whose answer code overrode.
    const DECIDED=own(W.agents,name);
    if(name.indexOf('claude.')===0||name.indexOf('agent.')===0||DECIDED){const src=code(f.source);if(asking||src==='claude'||(!src&&code(f.model))){who=modelName(f.model);tag='claude'}else if(DECIDED&&code(f.agent_model)){who=modelName(f.agent_model);tag='claude'}}
    if(asking){const a=code(f.agent);who=(a?cap(words(a)):W.reader)+' · '+who}
    if(DECIDED)who=W.agents[name]+' · '+who;
    // An agent's working rows go in the fold: its tool calls, words and run, and a Claude call made in one of its turns.
    const fold=name.indexOf('agent.')===0||((asking||name==='claude.read')&&!!(code(f.agent)||num(f.turn)||/^(checker|coder|payer)$/.test(String(e.actor))));
    if(PERSON.test(name)){who=W.who.you;tag=null}
    if(SIGN.test(name))tag='sign';else if(MONEY.test(name))tag='money';
    // An agent's own sentence and code's, as the server masked and cut them (text nodes only, never markup).
    // A line the Coder left without a VAT code that the books coded from the supplier's German VAT id (final-polish, 13 Nov).
    const abroad=!code(f.vat_code)&&code(f.books_vat_code)==='PF_DE19';
    const said=(v)=>typeof v==='string'&&v.length<=200?v.replace(/[.\s]+$/,''):'';
    const v={money:amount(f),status:status(f.status),why:found(f.findings),method:code(f.method)&&own(W.method,f.method)?W.method[f.method]:'',pages:num(f.pages),files:num(f.files),paid:num(f.paid),of:num(f.of),
      action:said2(W.actions,f.action),outcome:said2(W.actions,f.outcome),reason:said(f.reason),enforced:said(f.enforced)||said(f.refused)||(abroad?W.booksVat:''),
      account:code(f.account),vat:/^P\d{1,2}$/.test(code(f.vat_code))?code(f.vat_code).slice(1)+'%':own(W.vat,code(f.vat_code))?W.vat[code(f.vat_code)]:code(f.vat_code)||(abroad?W.vat.PF_DE19:W.noVat),rail:said2(W.rails,f.rail),pay_on:day(f.pay_on)||code(f.pay_on),currency:/^[A-Z]{3}$/.test(String(f.pay_currency))?f.pay_currency:''};
    let text=null;
    for(const k of [name+'_why',name,name+'_plain'])if(text===null&&own(W.ev,k))text=fill(W.ev[k],v);
    if(text===null)text=W.step;
    if(tag==='money')text=text.replace(/\.$/,'')+' · '+W.money;
    let lead='',mine='',enforced='';
    if(DECIDED){
      // The reason is marked as the agent's own words only when a model gave it; code's own reason is plain text.
      lead=(v.reason&&fill(W.lead[name],v))||'';
      if(lead&&tag==='claude')mine=v.reason;else if(lead)lead=lead+' '+(/^[A-Z][a-z]/.test(v.reason)?v.reason.charAt(0).toLowerCase()+v.reason.slice(1):v.reason)+'.';else lead=fill(W.lead[name+'_plain'],v)||'';
      const e=v.outcome&&v.enforced?v.outcome+'; '+v.enforced:v.enforced||v.outcome;
      if(e)enforced=fill(W.enforced,{enforced:e})||'';
    }
    return {who:who,text:text,tag:tag,asking:asking,fold:fold,lead:lead,own:mine,enforced:enforced};
  };
};
`;

type MakeLine = (w: typeof LIVE) => (e: EngineEvent) => TryEventLine;
let line: ((e: EngineEvent) => TryEventLine) | null = null;

/** The event's row, as the page writes it: the page's own script, run here as it is. */
export function eventLine(e: EngineEvent): TryEventLine {
  line ??= (new Function(`${EVENT_LINE_JS}\nreturn eventLineOf;`)() as MakeLine)(LIVE);
  return line(e);
}
