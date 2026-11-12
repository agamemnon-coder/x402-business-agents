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
  const amount=(f)=>/^-?\d{1,15}(\.\d{1,4})?$/.test(String(f.amount))&&/^[A-Z]{3}$/.test(String(f.currency))?f.currency+' '+f.amount:'';
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
    if(!/^[a-z_]+\.[a-z_]+$/.test(name)||!own(W.ev,name))return {who:W.who.purser,text:W.step,tag:null,asking:false};
    const asking=name==='claude.asking';
    let who=W.who.code,tag='code';
    // Task A6: an agent's decision is the agent's line when a model answered; agent_model names the model whose answer code overrode.
    const DECIDED=own(W.agents,name);
    if(name.indexOf('claude.')===0||name.indexOf('agent.')===0||DECIDED){const src=code(f.source);if(asking||src==='claude'||(!src&&code(f.model))){who=modelName(f.model);tag='claude'}else if(DECIDED&&code(f.agent_model)){who=modelName(f.agent_model);tag='claude'}}
    if(asking){const a=code(f.agent);who=(a?cap(words(a)):W.reader)+' · '+who}
    if(DECIDED&&tag==='claude')who=W.agents[name]+' · '+who;
    if(PERSON.test(name)){who=W.who.you;tag=null}
    if(SIGN.test(name))tag='sign';else if(MONEY.test(name))tag='money';
    // An agent's own sentence and code's, as the server masked and cut them (text nodes only, never markup).
    const said=(v)=>typeof v==='string'&&v.length<=200?v.replace(/[.\s]+$/,''):'';
    const v={money:amount(f),status:status(f.status),why:found(f.findings),method:code(f.method)&&own(W.method,f.method)?W.method[f.method]:'',pages:num(f.pages),files:num(f.files),paid:num(f.paid),of:num(f.of),
      action:code(f.action)?words(f.action):'',outcome:code(f.outcome)?words(f.outcome):'',reason:said(f.reason),enforced:said(f.enforced)||said(f.refused),
      account:code(f.account),vat:code(f.vat_code)||W.noVat,rail:code(f.rail)?words(f.rail):'',pay_on:code(f.pay_on),currency:/^[A-Z]{3}$/.test(String(f.pay_currency))?f.pay_currency:''};
    let text=null;
    for(const k of [name+'_why',name,name+'_plain'])if(text===null&&own(W.ev,k))text=fill(W.ev[k],v);
    if(text===null)text=W.step;
    if(tag==='money')text=text.replace(/\.$/,'')+' · '+W.money;
    return {who:who,text:text,tag:tag,asking:asking};
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
