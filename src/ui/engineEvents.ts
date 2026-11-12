// An engine event (src/engine/events.ts) as a line a person reads: who did it, and what, in one short sentence. The
// words are in the catalogue (src/ui/i18n.ts, cs.eng.*): one line per event on the engine's allowlist, built from the
// few fields that event shows (an amount, a status, what the checks found), never a field dump. An event with no line
// of its own gets one neutral sentence.
//
// One implementation serves the console's page and this module: EVENT_LINE_JS is plain script the page carries as it
// is (cloud/src/console.ts), and eventLine() below runs that same text. It is pure: no DOM, no clock, no network.
//
// Words must be true: an engine in the cloud pays on its stand-in bank with test money, so no line says a real bank did
// something.
import type { EngineEvent } from "../engine/events.js";
import { fmtMoney, MESSAGES, type Lang } from "./i18n.js";

export interface EventLine {
  /** The model's name ("Claude Sonnet 5.5"), "the parser", "code", or a plain word for a person. */
  who: string;
  text: string;
  /** What kind of actor it was; null for a person. */
  tag: "claude" | "parser" | "code" | null;
}

/**
 * eventLineOf(m, money): m is a catalogue (key to words), money(currency, amount) writes an amount the reader's way.
 * It returns the function from an event to its line.
 *
 * The line: the first of cs.eng.ev.<event>_why, cs.eng.ev.<event>, cs.eng.ev.<event>_plain whose every {placeholder}
 * the event can fill; else cs.eng.step. A value from the event is only ever used as words: a code that is not a plain
 * code is left out, so JSON or markup in a field cannot reach the line.
 */
export const EVENT_LINE_JS = String.raw`
const eventLineOf=(m,money)=>{
  const has=(k)=>Object.prototype.hasOwnProperty.call(m,k);
  const lower=(s)=>s?s.charAt(0).toLowerCase()+s.slice(1):'';
  const code=(v)=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,48}$/.test(v)?v:'';
  const words=(v)=>code(v).replace(/[_.]/g,' ').toLowerCase();
  const num=(v)=>typeof v==='number'&&isFinite(v)?String(v):'';
  const modelName=(id)=>{const x=/^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2})(?!\d))?/.exec(String(id||''));return x?'Claude '+x[1].charAt(0).toUpperCase()+x[1].slice(1)+' '+x[2]+(x[3]?'.'+x[3]:''):'Claude'};
  const amount=(f)=>/^-?\d{1,15}(\.\d{1,4})?$/.test(String(f.amount))&&/^[A-Z]{3,4}$/.test(String(f.currency))?String(money(f.currency,String(f.amount))):'';
  const status=(v)=>code(v)?(has('status.'+v)?lower(m['status.'+v]):words(v)):'';
  const found=(v)=>(typeof v==='string'?v:'').split(',').filter(code).slice(0,3).map((c)=>lower(has('cs.w.f.'+c)?m['cs.w.f.'+c]:has('finding.'+c)?m['finding.'+c]:words(c))).join('; ');
  const fill=(s,v)=>{let whole=true;const out=s.replace(/\{(\w+)\}/g,(_,k)=>{if(!v[k])whole=false;return v[k]||''});return whole?out:null};
  return (e)=>{
    e=e||{};const f=e.fields||{};const name=typeof e.event==='string'?e.event:'';
    const by=/^claude(?:-scan)?:(.+)$/.exec(typeof f.read_by==='string'?f.read_by:'');
    const claude=by?by[1]:(name==='claude.read'||name==='ap.scan_read'||name==='claude.asking')?String(f.model||''):null;
    let who=m['cs.eng.who.code'],tag='code';
    if(claude!==null){who=modelName(claude);tag='claude'}
    else if(f.read_by==='parser'){who=m['cs.eng.who.parser'];tag='parser'}
    else if(e.actor==='human'){who=m['cs.eng.who.person'];tag=null}
    const v={money:amount(f),status:status(f.status),why:found(f.findings),model:code(f.model)?modelName(f.model):'',method:code(f.method)&&has('cs.eng.method.'+f.method)?m['cs.eng.method.'+f.method]:'',files:num(f.files),paid:num(f.paid),of:num(f.of)};
    let text=null;
    for(const k of ['cs.eng.ev.'+name+'_why','cs.eng.ev.'+name,'cs.eng.ev.'+name+'_plain'])if(text===null&&has(k))text=fill(m[k],v);
    return {who:who,text:text===null?m['cs.eng.step']:text,tag:tag};
  };
};
`;

type MakeLine = (m: Readonly<Record<string, string>>, money: (currency: string, amount: string) => string) => (e: EngineEvent) => EventLine;
let make: MakeLine | null = null;

/**
 * The event's line in a language. The page's script is run here as it is, so both write the same words; it is made on
 * the first call only (a Worker never calls this: its page carries the script, and a Worker may not build code from text).
 */
export function eventLine(e: EngineEvent, lang: Lang): EventLine {
  make ??= new Function(`${EVENT_LINE_JS}\nreturn eventLineOf;`)() as MakeLine;
  return make(MESSAGES[lang], (currency, amount) => fmtMoney(lang, currency, amount))(e);
}
