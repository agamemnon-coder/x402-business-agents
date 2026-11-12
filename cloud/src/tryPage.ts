// The hands-on page at /try: a visitor starts a test company of their own on Purser's real engine, files an invoice
// and watches the engine work. One page with one script under the console's nonce policy (cloud/src/console.ts): no
// inline handlers, no 'unsafe-inline', every value from the API put on the page as text (textContent through el()),
// never as HTML. English only; every word is in cloud/src/tryCopy.ts.
//
// The script, for whoever adds screens 3 to 6:
// - State lives in one object, S ({tenant, session, visitor_token, expires_at, pool, mode, screen, after}), kept in
//   sessionStorage under one key (try/catch: when storage throws it stays in memory only).
// - Screens are registered with screen(name, {heading, band?, draw(box, arg)}) and shown with show(name, arg), which
//   draws the band (after the start), the heading, then the screen, and moves focus to the heading.
// - api(method, path, body) carries the session and renews it once on a 401; renew() is the one renewal
//   (POST /v1/try/session), single-flight; a 410 shows the "gone" screen.
// - The poller (pollStart, pollDone) reads GET /v1/engine/events every 1,000 ms while a request is in flight and once
//   more 1 s after it returned; never while the page is hidden; it stops at its first 401 and renews once; a 429
//   slow_down waits retry_ms.
// - Timers exist for three things only (a test holds this): pollTimer, renewTimer (two minutes before the session
//   ends) and askTimer (the running time of an open Claude call).
// - Screens 3 (approve) and 4 (pay) sign and pay: the pure helpers are SIGN_JS (below, tested in Node). S also keeps
//   the proposal ({id, challenge, terms_sha256, invoice}) and the approval's credential (cred) for screen 4, and the
//   pay route's settled answer for screen 5 (books, a placeholder until B3 draws it).
// - Icons are SVG elements made one by one with createElementNS from shape data (src/ui/icons.ts), never from markup.
import { consoleCsp } from "./console.js";
import { APPROVE, BAND, BOOKS, CHROME, ENDED, GONE, INVOICE, INVOICE_FIELDS, LIVE, METHOD, PAY, PROPOSAL_FIELDS, START, STEPS, WORK } from "./tryCopy.js";
import { EVENT_LINE_JS } from "./tryEvents.js";
import { TOKENS } from "../../src/redesign/ui.js";
import { ICONS } from "../../src/ui/icons.js";
import { MORE } from "../../src/ui/payablesKit.js";
import type { CloudEnv } from "./app.js";

/** Recorded real runs on the site, for when the demo is busy or paused. */
const RUNS_URL = "https://kit11.max-31b.workers.dev/runs";

const CSS = `${TOKENS.replace("url(assets/inter.woff2)", "url(/assets/inter.woff2)")}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 400 16px/1.5 Inter, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
.top, main { max-width: 560px; margin: 0 auto; padding: 0 var(--gut); }
.top { display: flex; align-items: center; height: 56px; }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: -.01em; }
.brand .mk { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; background: var(--text); color: var(--bg); font-size: 14px; }
main { padding-bottom: 56px; }
h1 { font-size: 28px; line-height: 1.15; letter-spacing: -.02em; margin: 20px 0 12px; }
h1:focus { outline: none; }
p { margin: 0 0 12px; }
.lede { color: var(--muted); font-size: 17px; }
.muted { color: var(--muted); }
.band { display: flex; flex-wrap: wrap; gap: 2px 8px; margin: 8px 0 0; padding: 8px 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); color: var(--muted); font-size: 13px; }
.band .mode { color: var(--text); font-weight: 600; }
.band .mode.live { color: var(--claude); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 16px; border-radius: 999px; font: 650 15px/1.2 Inter, system-ui, sans-serif; text-decoration: none; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
.btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn.big { min-height: 52px; padding: 0 24px; font-size: 16px; margin-top: 8px; }
.btn:disabled { opacity: .55; cursor: progress; }
.btn:focus-visible, a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.link { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
a { color: var(--accent); }
.tabs { display: flex; gap: 4px; padding: 4px; margin: 4px 0 16px; background: var(--sunken); border-radius: 999px; }
.tabs button { flex: 1; min-height: 40px; border: 0; border-radius: 999px; background: none; color: var(--muted); font: 600 15px/1.2 Inter, system-ui, sans-serif; cursor: pointer; }
.tabs button[aria-selected="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
.samples { display: grid; gap: 8px; }
.samples .btn { justify-content: flex-start; text-align: left; border-radius: 14px; padding: 12px 16px; font-weight: 600; }
.samples .btn[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
.panel + .panel + .btn.big { margin-top: 16px; }
form { display: grid; gap: 12px; }
.f { display: grid; gap: 4px; min-width: 0; }
.f label { font-size: 13px; font-weight: 600; color: var(--muted); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
input, select { width: 100%; min-width: 0; height: 46px; padding: 0 12px; font: 400 16px/1.2 Inter, system-ui, sans-serif; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .02em; }
.hint { font-size: 14px; color: var(--muted); margin: 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); box-shadow: var(--shadow); padding: 16px; }
.live { list-style: none; margin: 0; padding: 0; }
.live li { display: grid; grid-template-columns: 1fr auto; gap: 0 12px; padding: 8px 0; border-top: 1px solid var(--border); font-size: 14px; line-height: 1.4; }
.live li:first-child { border-top: 0; }
.live:not(.open) li:nth-last-child(n+4) { display: none; }
.live .who { font-weight: 650; }
.live .claude .who { color: var(--claude); }
.live .money .who { color: var(--ok); }
.live .sign .who { color: var(--accent); }
.live .what { grid-column: 1; color: var(--muted); overflow-wrap: anywhere; }
.live .t { grid-column: 2; grid-row: 1 / span 2; color: var(--faint); font-variant-numeric: tabular-nums; font-size: 13px; }
.steps { margin-top: 4px; font-size: 14px; }
.result { margin-top: 20px; }
.result .big { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
.result .ok { color: var(--ok); }
.result .bad { color: var(--bad); }
.result ul { margin: 0 0 12px; padding-left: 20px; }
.note { padding: 12px 14px; border-radius: 12px; background: var(--bad-soft); color: var(--text); }
details { margin: 12px 0; }
details summary { cursor: pointer; color: var(--muted); font-size: 14px; }
dl.read { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 8px 0 0; font-size: 14px; }
dl.read dt { color: var(--muted); }
dl.read dd { margin: 0; overflow-wrap: anywhere; }
.progw { display: flex; align-items: center; gap: 10px; margin: 10px 2px 0; }
.prog { flex: 1; display: flex; gap: 4px; list-style: none; margin: 0; padding: 0; }
.prog li { flex: 1; height: 4px; border-radius: 2px; background: var(--border); }
.prog li.done, .prog li.on { background: var(--accent); }
.stepname { font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.screen { animation: rise .24s ease-out; }
@keyframes rise { from { opacity: .01; transform: translateY(6px); } }
.i { flex: none; vertical-align: -3px; }
.art { display: inline-grid; place-items: center; width: 56px; height: 56px; border-radius: 18px; background: var(--accent-soft); color: var(--accent); margin: 4px 0 8px; }
.art.ok { background: var(--ok-soft); color: var(--ok); }
.art.pop { animation: pop .5s ease-out; }
@keyframes pop { 0% { transform: scale(.6); opacity: .01; } 60% { transform: scale(1.08); } 100% { transform: scale(1); } }
.amount { font-size: 40px; line-height: 1.1; font-weight: 750; letter-spacing: -.02em; font-variant-numeric: tabular-nums; margin: 4px 0 12px; overflow-wrap: anywhere; }
.short { margin: 12px 0 0; font-size: 13px; color: var(--muted); }
pre.terms { margin: 8px 0 0; padding: 12px; border-radius: 12px; background: var(--sunken); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.f.big input { height: 60px; font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.outcome { margin-top: 16px; }
.stamp { display: inline-block; margin: 0 0 10px; padding: 2px 10px; border: 2px solid var(--bad); border-radius: 8px; color: var(--bad); font-weight: 750; font-size: 17px; letter-spacing: .02em; }
.layer { margin: 0 0 6px; font-size: 15px; }
.hash { margin: 0; font-size: 12px; line-height: 1.6; color: var(--faint); overflow-wrap: anywhere; }
.hash .hl { display: inline-block; min-width: 52px; color: var(--muted); font-family: Inter, system-ui, sans-serif; font-weight: 600; }
.hash mark { background: none; color: var(--text); font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
.verdict { margin: 12px 0 8px; font-weight: 650; }
.proof { margin: 0; font-size: 14px; color: var(--muted); }
pre.raw { margin: 8px 0 0; padding: 12px; border-radius: 12px; background: var(--sunken); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 520px) { .btn.big { width: 100%; } h1 { font-size: 26px; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
`;

/**
 * The page's pure helpers for signing and paying (screens 3 and 4), as plain script: the page carries this text as it
 * is, and test/try-page.test.ts runs the same text in Node. No DOM, no clock, no network.
 * - b64u, fromB64u: base64url, as WebAuthn's ArrayBuffers go to the API and come back.
 * - registrationOf, signedOf: a new passkey and a passkey's signature as @simplewebauthn/server reads them (copied from
 *   the console's credOf, registrationOf and signedOf, the same as src/approve/client.ts serializeRegistration and
 *   serializeAssertion).
 * - hashDiff(a, b): each hash as runs of [text, differs], every character where the two differ marked.
 * - normAmount(raw, like): an amount typed with a comma or a dot, in the format of the terms' own amount (like), or null.
 * - payBody(terms, values, credential): the pay route's body: the stored terms with the three fields' values written in,
 *   and the kept credential; nothing else.
 * - changedFields, verdict: what changed, from the signed and the sent values (the route's `changed` is lane C's: an
 *   array of field names or of {field, from, to}; only its field names are read, the values are the page's own).
 * - methodOf(M, ua): the device's word for its passkey, by a simple guess from the platform.
 */
export const SIGN_JS = String.raw`
const signKit=(()=>{
  const b64u=(buf)=>{let s='';for(const b of new Uint8Array(buf))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
  const fromB64u=(s)=>{const n=String(s).replace(/-/g,'+').replace(/_/g,'/');const bin=atob(n+'==='.slice((n.length+3)%4));return Uint8Array.from(bin,(c)=>c.charCodeAt(0))};
  const credOf=(c,response)=>Object.assign({id:c.id,rawId:b64u(c.rawId),type:c.type,response:response,clientExtensionResults:c.getClientExtensionResults()},c.authenticatorAttachment?{authenticatorAttachment:c.authenticatorAttachment}:{});
  const registrationOf=(c)=>{const r=c.response;return credOf(c,{clientDataJSON:b64u(r.clientDataJSON),attestationObject:b64u(r.attestationObject),transports:typeof r.getTransports==='function'?r.getTransports():[]})};
  const signedOf=(c)=>{const r=c.response;return credOf(c,Object.assign({clientDataJSON:b64u(r.clientDataJSON),authenticatorData:b64u(r.authenticatorData),signature:b64u(r.signature)},r.userHandle?{userHandle:b64u(r.userHandle)}:{}))};
  const hashDiff=(a,b)=>{
    const runs=(s,o)=>{const out=[];for(let i=0;i<s.length;i++){const d=s[i]!==o[i];const last=out[out.length-1];if(last&&last[1]===d)last[0]+=s[i];else out.push([s[i],d])}return out};
    a=String(a);b=String(b);return {a:runs(a,b),b:runs(b,a)};
  };
  const normAmount=(raw,like)=>{
    const m=/^(\d{1,12})(?:[.,](\d{1,6}))?$/.exec(String(raw).replace(/\s/g,''));if(!m)return null;
    const d=(/\.(\d+)$/.exec(String(like))||['',''])[1].length;const frac=m[2]||'';
    if(frac.length>d)return null;
    const int=m[1].replace(/^0+(?=\d)/,'');return d?int+'.'+frac.padEnd(d,'0'):int;
  };
  const FIELDS=['amount','beneficiary_name','iban_last4'];
  const payBody=(terms,v,credential)=>{const t=Object.assign({},terms);for(const k of FIELDS)t[k]=v[k];return {terms:t,credential:credential}};
  const changedFields=(signed,sent,changed)=>{
    const named=Array.isArray(changed)?changed.map((x)=>typeof x==='string'?x:x&&typeof x.field==='string'?x.field:'').filter(Boolean):null;
    const differ=FIELDS.filter((k)=>String(signed[k])!==String(sent[k]));
    return named?FIELDS.filter((k)=>named.indexOf(k)>=0&&differ.indexOf(k)>=0):differ;
  };
  const cents=(s)=>{const m=/^(\d+)\.(\d{2})$/.exec(String(s));return m?Number(m[1])*100+Number(m[2]):null};
  const verdict=(W,signed,sent,changed)=>{
    const out=[];
    for(const k of changedFields(signed,sent,changed)){
      if(k==='amount'){const a=cents(signed.amount),b=cents(sent.amount);out.push(a!==null&&b!==null&&Math.abs(a-b)===1?W.vAmountCent:W.vAmount.replace('{from}',String(signed.amount)).replace('{to}',String(sent.amount)))}
      else if(k==='beneficiary_name')out.push(W.vPayee);else out.push(W.vAccount);
    }
    if(!out.length)out.push(W.vOther);
    return out.join(' ')+' '+W.vCover;
  };
  const methodOf=(M,ua)=>/iPhone|iPad|iPod/.test(ua)?M.ios:/Android/.test(ua)?M.android:/Macintosh|Mac OS X/.test(ua)?M.mac:/Windows/.test(ua)?M.windows:M.other;
  return {b64u,fromB64u,registrationOf,signedOf,hashDiff,normAmount,payBody,changedFields,verdict,methodOf};
})();
`;

// The client: plain JS (no template literals in it, so it sits in this file as a raw string).
const SCRIPT = String.raw`
const C=__COPY__;
const W=C.live;
__EVENT_LINE__
__SIGN__
const {fromB64u,registrationOf,signedOf,hashDiff,normAmount,payBody,verdict,methodOf}=signKit;
const IC=__ICONS__;
const lineOf=eventLineOf(W);
const CFG=JSON.parse(document.querySelector('meta[name=purser-try]').content);
const RUNS=__RUNS__;
const $=(s)=>document.querySelector(s);
const el=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids??[])){if(k===null||k===undefined||k===false)continue;e.append(typeof k==='string'?document.createTextNode(k):k)}return e};
const btn=(label,main)=>{const b=el('button','btn'+(main?' primary big':''),label);b.type='button';return b};
const fill=(s,v)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??''));
const secs=(ms)=>(Math.max(0,ms)/1000).toFixed(1);
const say=(text)=>{$('#say').textContent=text};
const note=(text)=>el('p','note',text);
const words=(j,fallback)=>typeof j.message==='string'&&j.message?j.message:typeof j.error==='string'&&j.error?j.error:fallback;
// An icon: an SVG element made here from shape data, one element at a time.
function icon(name,size){
  const s=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [k,v] of [['viewBox','0 0 24 24'],['width',size],['height',size],['fill','none'],['stroke','currentColor'],['stroke-width','1.75'],['stroke-linecap','round'],['stroke-linejoin','round'],['aria-hidden','true'],['class','i']])s.setAttribute(k,String(v));
  for(const [tag,a] of IC[name]||[]){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const k of Object.keys(a))e.setAttribute(k,a[k]);s.append(e)}
  return s;
}

// The token from the link (#e=… or #j=…): read once, taken out of the address bar at once, and sent only in the start
// request's body.
const TOKEN=(()=>{const m=/^#([ej])=([A-Za-z0-9_.~-]{1,256})$/.exec(location.hash);if(location.hash)history.replaceState(null,'',location.pathname+location.search);return m?m[2]:null})();

// The state: one object, kept in this tab (sessionStorage), or in memory only where storage throws.
const KEY='purser.try';
const KEEP=['tenant','session','visitor_token','expires_at','pool','mode','screen','after','proposal','cred','settled'];
const S={tenant:null,session:null,visitor_token:null,expires_at:null,pool:null,mode:null,screen:null,after:0,proposal:null,cred:null,settled:null};
const save=()=>{const o={};for(const k of KEEP)o[k]=S[k];try{sessionStorage.setItem(KEY,JSON.stringify(o))}catch(e){}};
const restore=()=>{try{const o=JSON.parse(sessionStorage.getItem(KEY)||'null');if(o&&typeof o==='object')for(const k of KEEP)if(o[k]!==undefined)S[k]=o[k]}catch(e){}};
const forget=()=>{for(const k of KEEP)S[k]=k==='after'?0:null;try{sessionStorage.removeItem(KEY)}catch(e){}};
const tenantId=()=>typeof S.tenant==='string'?S.tenant:S.tenant&&S.tenant.id;

// One request with the session. Status 0: no answer came. text: the answer exactly as it came (the raw answer's fold).
async function call(method,path,body){
  const headers={};if(S.session)headers.authorization='Bearer '+S.session;if(body!==undefined)headers['content-type']='application/json';
  let r;try{r=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})}catch(e){return {status:0,json:{},text:''}}
  let text='';try{text=await r.text()}catch(e){}
  let json={};try{json=JSON.parse(text)}catch(e){}
  return {status:r.status,json:json&&typeof json==='object'?json:{},text};
}
// The same, renewing the session once when it answers 401.
async function api(method,path,body){
  const r=await call(method,path,body);
  if(r.status!==401||!S.session)return r;
  return (await renew())?call(method,path,body):r;
}

// The session: renewed two minutes before it ends, and when the page comes back into view (before any poll).
let renewTimer=null;let renewing=null;
const due=()=>!!S.expires_at&&Date.parse(S.expires_at)-Date.now()<120000;
function armRenewal(){clearTimeout(renewTimer);renewTimer=null;if(!S.expires_at)return;
  renewTimer=setTimeout(()=>{renewTimer=null;if(!document.hidden)renew()},Math.min(2147483000,Math.max(0,Date.parse(S.expires_at)-Date.now()-120000)))}
function renew(){if(!renewing)renewing=renewOnce().finally(()=>{renewing=null});return renewing}
async function renewOnce(){
  if(!tenantId()||!S.visitor_token){ended('ended');return false}
  const r=await call('POST','/v1/try/session',{tenant_id:tenantId(),visitor_token:S.visitor_token});
  if(r.status===200&&typeof r.json.session==='string'){S.session=r.json.session;S.expires_at=r.json.expires_at||null;save();armRenewal();return true}
  if(r.status===0)return false;
  ended(r.status===410?'gone':'ended');return false;
}
function ended(name){pollStop();clearTimeout(renewTimer);renewTimer=null;forget();show(name)}

// The live panel's polling: every second while a request is in flight, once more a second after it returned.
let pollTimer=null;
const P={on:false,inflight:false,final:false,busy:false,waiting:false,renewed:false,onEvents:null};
function pollLater(ms){clearTimeout(pollTimer);pollTimer=setTimeout(pollTick,ms)}
function pollStart(onEvents){P.on=true;P.inflight=true;P.final=false;P.renewed=false;P.waiting=false;P.onEvents=onEvents;pollLater(1000)}
function pollDone(){P.inflight=false;P.final=true;if(P.on&&!P.busy&&!P.waiting)pollLater(1000)}
function pollStop(){P.on=false;P.waiting=false;clearTimeout(pollTimer);pollTimer=null}
async function pollTick(){
  pollTimer=null;
  if(!P.on)return;
  if(document.hidden){P.waiting=true;return}
  P.waiting=false;
  const last=!P.inflight;if(last)P.final=false;
  P.busy=true;
  const r=await call('GET','/v1/engine/events?after='+encodeURIComponent(S.after||0)+'&limit=200');
  P.busy=false;
  if(!P.on)return;
  if(r.status===401){
    // Stop at the first 401 and renew once; a second 401 after that ends the visit.
    P.on=false;
    if(P.renewed){ended('ended');return}
    P.renewed=true;
    if(!(await renew()))return;
    P.on=true;pollLater(0);return;
  }
  if(r.status===429&&r.json.code==='slow_down'){pollLater(Math.min(30000,Math.max(250,Number(r.json.retry_ms)||1000)));return}
  if(r.status===200&&Array.isArray(r.json.items)){
    const items=r.json.items.filter((e)=>e&&typeof e.seq==='number'&&e.seq>(S.after||0));
    if(typeof r.json.next==='number'&&r.json.next>=(S.after||0))S.after=r.json.next;else if(items.length)S.after=items[items.length-1].seq;
    save();
    if(items.length&&P.onEvents)P.onEvents(items);
  }
  if(P.inflight||P.final)pollLater(1000);else if(last)pollStop();
}
document.addEventListener('visibilitychange',async()=>{
  if(document.hidden||!S.session)return;
  if(due()&&!(await renew()))return;
  if(P.on&&P.waiting){P.waiting=false;pollLater(0)}
});

// The running time of an open Claude call, counted in the browser from the moment its row arrived.
let askTimer=null;const OPEN=new Map();
function askTick(){const now=performance.now();for(const o of OPEN.values())o.span.textContent=secs(now-o.t0)+' s'}
function askOpen(key,span){OPEN.set(key,{span,t0:performance.now()});askTick();if(!askTimer)askTimer=setInterval(askTick,200)}
function askClose(key){if(OPEN.has(key)){askTick();OPEN.delete(key)}if(!OPEN.size&&askTimer){clearInterval(askTimer);askTimer=null}}
function askCloseAll(){for(const k of [...OPEN.keys()])askClose(k)}

// The screens: a registry, one shown at a time.
const SCREENS={};
function screen(name,def){SCREENS[name]=def}
function band(){const live=!!(S.mode&&S.mode.claude==='live');return el('p','band',[el('span','',C.band.line),el('span','mode'+(live?' live':''),live?C.band.claudeLive:C.band.claudeCode)])}
// Where the visit stands: one segment per step, and the current step's name.
function steps(name){
  const order=C.steps.order,at=order.indexOf(name);if(at<1)return null;
  const ol=el('ol','prog');ol.setAttribute('aria-label',fill(C.steps.where,{n:at+1,of:order.length}));
  for(let i=0;i<order.length;i++){const li=el('li',i<at?'done':i===at?'on':'');if(i===at)li.setAttribute('aria-current','step');ol.append(li)}
  return el('div','progw',[ol,el('span','stepname',C.steps.names[name])]);
}
function show(name,arg){
  const d=SCREENS[name];if(!d)return false;
  pollStop();askCloseAll();
  S.screen=name;save();
  const h=el('h1','',typeof d.heading==='function'?d.heading(arg):d.heading);h.tabIndex=-1;
  const box=el('div','screen');
  const top=d.band===false||!S.session?[]:[band(),steps(name)].filter(Boolean);
  $('#main').replaceChildren(...top,h,box);
  d.draw(box,arg);
  window.scrollTo(0,0);h.focus();
  return true;
}

// 0 Start.
screen('start',{heading:C.start.heading,band:false,draw(box){
  const text=el('p','lede',C.start.text);const b=btn(C.start.button,true);
  box.append(text,b);
  b.addEventListener('click',async()=>{
    b.disabled=true;b.textContent=C.start.starting;
    const r=await call('POST','/v1/try/start',TOKEN?{token:TOKEN}:{});
    if((r.status===201||r.status===200)&&typeof r.json.session==='string'){
      for(const k of ['tenant','session','visitor_token','expires_at','pool','mode'])S[k]=r.json[k]??null;
      S.after=0;save();armRenewal();show('invoice');return;
    }
    b.disabled=false;b.textContent=C.start.button;
    const said=typeof r.json.message==='string'&&r.json.message?r.json.message:C.start.failed;
    const why=el('div','',[el('p','note',said)]);
    if(r.status===429||r.status===503){const a=el('a','',C.start.runs);a.href=RUNS;a.rel='noopener';why.append(el('p','',a))}
    text.replaceWith(why);
  });
}});

// 1 Invoice: a sample, or one written here.
function today(plus){const d=new Date(Date.now()+(plus||0)*86400000);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function field(label,input,id){input.id=id;const l=el('label','',label);l.htmlFor=id;return el('div','f',[l,input])}
function input(type,value){const i=el('input');i.type=type;if(value!==undefined)i.value=value;return i}
async function catchUp(){for(let i=0;i<20;i++){const r=await call('GET','/v1/engine/events?after='+encodeURIComponent(S.after||0)+'&limit=200');if(r.status!==200||!Array.isArray(r.json.items))return;if(typeof r.json.next==='number')S.after=r.json.next;save();if(r.json.items.length<200)return}}
screen('invoice',{heading:C.invoice.heading,draw(box){
  // Two tabs and one main button under both: it files the sample picked, or the invoice written.
  const tabs=el('div','tabs');tabs.setAttribute('role','tablist');
  const pick=el('div','panel'),write=el('div','panel');pick.setAttribute('role','tabpanel');write.setAttribute('role','tabpanel');
  const tA=el('button','',C.invoice.tabSample),tB=el('button','',C.invoice.tabWrite);
  for(const [t,p,id] of [[tA,pick,'tab-pick'],[tB,write,'tab-write']]){t.type='button';t.id=id;t.setAttribute('role','tab');p.setAttribute('aria-labelledby',id)}
  let writing=false;
  const choose=(w)=>{writing=w;tA.setAttribute('aria-selected',String(!w));tB.setAttribute('aria-selected',String(w));pick.hidden=w;write.hidden=!w};
  tA.addEventListener('click',()=>choose(false));tB.addEventListener('click',()=>choose(true));
  const send=btn(C.invoice.send,true);
  tabs.append(tA,tB);box.append(tabs,pick,write,send);choose(false);
  // Where the events stand now, so the live panel shows only what this invoice's request does.
  catchUp();
  // Pick a sample: one button per sample, the title only; the first is picked.
  let picked=null;
  pick.append(el('p','muted',C.invoice.loading));
  api('GET','/v1/engine/samples').then((r)=>{
    if(r.status!==200||!Array.isArray(r.json.items)){pick.replaceChildren(el('p','note',typeof r.json.message==='string'?r.json.message:C.invoice.failed));return}
    const list=el('div','samples');list.setAttribute('role','group');
    for(const s of r.json.items){if(!s||typeof s.key!=='string')continue;
      const b=btn(String(s.title??s.key));b.setAttribute('aria-pressed','false');
      b.addEventListener('click',()=>{picked=s;for(const x of list.children)x.setAttribute('aria-pressed',String(x===b))});
      list.append(b);if(!picked){picked=s;b.setAttribute('aria-pressed','true')}}
    pick.replaceChildren(list);
  });
  // Write your own: a supplier on file, the number, the amount, the dates and the IBAN (prefilled, editable).
  const sup=el('select');const no=input('text','INV-'+String(1000+crypto.getRandomValues(new Uint16Array(1))[0]%9000));no.required=true;no.maxLength=40;
  const amt=input('text');amt.inputMode='decimal';amt.required=true;amt.autocomplete='off';amt.placeholder='120.50';
  const iss=input('date',today(0)),dueOn=input('date',today(14));iss.required=true;dueOn.required=true;
  const iban=input('text');iban.className='mono';iban.required=true;iban.autocomplete='off';iban.spellcheck=false;iban.setAttribute('autocapitalize','characters');
  const msg=el('div','');
  const form=el('form','',[field(C.invoice.supplier,sup,'f-sup'),el('div','two',[field(C.invoice.invoiceNo,no,'f-no'),field(C.invoice.amount,amt,'f-amt')]),
    el('div','two',[field(C.invoice.issued,iss,'f-iss'),field(C.invoice.due,dueOn,'f-due')]),field(C.invoice.iban,iban,'f-iban'),el('p','hint',C.invoice.ibanHint),msg]);
  write.append(form);
  let suppliers=[];
  sup.addEventListener('change',()=>{const s=suppliers.find((x)=>x.key===sup.value);if(s)iban.value=String(s.iban??'')});
  amt.addEventListener('input',()=>amt.setCustomValidity(''));
  api('GET','/v1/engine/suppliers').then((r)=>{
    if(r.status!==200||!Array.isArray(r.json.items)){msg.replaceChildren(el('p','note',typeof r.json.message==='string'?r.json.message:C.invoice.failed));return}
    suppliers=r.json.items.filter((s)=>s&&typeof s.key==='string');
    sup.replaceChildren(...suppliers.map((s)=>{const o=el('option','',String(s.name??s.key));o.value=s.key;return o}));
    if(suppliers[0])iban.value=String(suppliers[0].iban??'');
  });
  function file(){
    if(!writing){if(picked)show('work',{kind:'sample',key:picked.key,title:String(picked.title??'')});return}
    const raw=amt.value.replace(/\s/g,'');
    if(raw&&!/^\d{1,9}([.,]\d{1,2})?$/.test(raw)){amt.setCustomValidity(C.invoice.amountBad);amt.reportValidity();return}
    if(!form.reportValidity())return;
    show('work',{kind:'compose',body:{supplier_key:sup.value,invoice_no:no.value.trim(),amount:raw.replace(',','.'),issue_date:iss.value,due_date:dueOn.value,iban:iban.value.replace(/\s/g,'').toUpperCase()}});
  }
  send.addEventListener('click',file);
  form.addEventListener('submit',(ev)=>{ev.preventDefault();file()});
}});

// 2 At work: the live panel while the request is in flight, then the invoice's status from the answer.
function livePanel(){
  const list=el('ol','live');list.setAttribute('aria-live','off');
  const more=el('button','link steps',C.live.allSteps);more.type='button';more.hidden=true;more.setAttribute('aria-expanded','false');
  more.addEventListener('click',()=>{const open=!list.classList.contains('open');list.classList.toggle('open',open);more.setAttribute('aria-expanded',String(open))});
  const node=el('div','card',[list,more]);node.hidden=true;
  const keyOf=(e)=>{const a=e.fields&&typeof e.fields.agent==='string'&&/^[A-Za-z_-]{1,32}$/.test(e.fields.agent)?e.fields.agent.toLowerCase():'reader';return a};
  const agentRow=(e)=>typeof e.event==='string'&&(e.event.indexOf('claude.')===0||e.event.indexOf('agent.')===0||!!(e.fields&&e.fields.agent));
  function add(items,t0){
    for(const e of items){
      if(agentRow(e))askClose(keyOf(e));
      const l=lineOf(e);
      const t=el('span','t',t0===undefined?'':fill(W.at,{s:secs(performance.now()-t0)}));
      list.append(el('li',l.tag||'',[el('span','who',l.who),el('span','what',l.text),t]));
      if(l.asking)askOpen(keyOf(e),t);
      say(l.who+' · '+l.text);
    }
    node.hidden=!list.children.length;more.hidden=list.children.length<=3;
  }
  return {node,add};
}
function invoiceFold(inv){
  const d=el('dl','read');
  for(const [k,v] of [[C.fields.vendor,inv.vendor],[C.fields.number,inv.invoice_no],[C.fields.total,[inv.currency,inv.total].filter(Boolean).join(' ')],[C.fields.due,inv.due_date],[C.fields.status,inv.status_words]]){if(v===null||v===undefined||v==='')continue;d.append(el('dt','',k),el('dd','',String(v)))}
  return el('details','',[el('summary','',C.work.invoiceFold),d]);
}
function drawResult(box,r,ms){
  const took=ms===null?null:el('p','muted',fill(C.work.took,{s:secs(ms)}));
  const inv=r.json&&r.json.invoice&&typeof r.json.invoice==='object'?r.json.invoice:null;
  let main;
  if((r.status===200||r.status===201)&&inv){
    if(r.json.kind==='duplicate_document')box.append(el('p','big',C.work.duplicate));
    if(inv.payable===true){
      box.append(el('p','big ok',C.work.ready),el('p','muted',C.work.readySub));
      main=btn(C.work.pay,true);main.addEventListener('click',()=>show('approve',{invoice:inv}));
    }else{
      box.append(el('p','big bad',[C.work.notReady,' ',String(inv.status_words||inv.status||'')]));
      const fs=Array.isArray(inv.findings)?inv.findings.filter((f)=>f&&typeof f.message==='string'):[];
      if(fs.length)box.append(el('ul','',fs.map((f)=>el('li','',f.message))));
      main=btn(C.work.another,true);main.addEventListener('click',()=>show('invoice'));
    }
    box.append(...(took?[took]:[]),invoiceFold(inv),main);
    return;
  }
  if(r.status===200||r.status===201)box.append(el('p','big',C.work.noInvoice),...(took?[took]:[]));
  else box.append(el('p','note',typeof r.json.message==='string'&&r.json.message?r.json.message:C.work.failed));
  main=btn(C.work.another,true);main.addEventListener('click',()=>show('invoice'));
  box.append(main);
}
screen('work',{heading:C.work.heading,draw(box,arg){
  const live=livePanel();const result=el('div','result');
  box.append(live.node,result);
  if(arg&&arg.kind==='reload'){
    // After a reload: the newest invoice as the server has it, and its steps so far (no times: they were not measured here).
    call('GET','/v1/engine/events?after=0&limit=200').then((r)=>{if(r.status===200&&Array.isArray(r.json.items))live.add(r.json.items)});
    drawResult(result,{status:200,json:{invoice:arg.invoice}},null);
    return;
  }
  result.append(el('p','muted',C.work.working));
  const t0=performance.now();
  pollStart((items)=>live.add(items,t0));
  const req=arg.kind==='sample'?api('POST','/v1/engine/samples/'+encodeURIComponent(arg.key)):api('POST','/v1/engine/compose',arg.body);
  req.then((r)=>{
    const ms=performance.now()-t0;
    pollDone();
    if(S.screen!=='work')return;
    result.replaceChildren();drawResult(result,r,ms);
    const b=result.querySelector('.btn.primary');if(b)b.focus();
  });
}});

// The passkey: whether this device can make one, and its word for it (a guess from the platform, never proven).
const hasPasskeys=()=>!!(window.PublicKeyCredential&&navigator.credentials);
const method=()=>methodOf(C.method,navigator.userAgent||'');
// The engine's approval passkey signs the proposal's challenge (the SHA-256 of its exact terms).
async function signTerms(challenge,credentialId){
  const c=await navigator.credentials.get({publicKey:{challenge:fromB64u(challenge),rpId:CFG.rpId,allowCredentials:[{type:'public-key',id:fromB64u(credentialId)}],userVerification:'required',timeout:120000}});
  return signedOf(c);
}
const cancelled=(e)=>e&&typeof e.name==='string'&&/^(NotAllowedError|AbortError|InvalidStateError|SecurityError|NotSupportedError)$/.test(e.name);
// One main button whose label and action change with the step; it is off while a request or a prompt is open.
function mainButton(){
  const b=btn('',true);let act=null;
  b.addEventListener('click',async()=>{if(b.disabled||!act)return;b.disabled=true;try{await act()}finally{if(b.isConnected)b.disabled=false}});
  return {node:b,set(label,fn){b.textContent=label;act=fn;b.hidden=false},off(label){b.textContent=label;act=null;b.disabled=true}};
}

// 3 Approve: the proposal's facts, its short hash and the exact terms in a fold; one button in two labelled stages.
function factRows(p,inv){
  const facts=Array.isArray(p.facts)?p.facts.filter((f)=>Array.isArray(f)&&f.length===2):[];
  const amount=facts[0]?String(facts[0][1]):'';
  const payee=facts.find((f)=>f[0]==='Payee')||facts[1];
  const m=payee?/^(.*), IBAN \S*?(\w{2,8})$/.exec(String(payee[1])):null;
  const pairs=[];
  if(payee)pairs.push(m?[String(payee[0]),m[1]]:[String(payee[0]),String(payee[1])]);
  if(m)pairs.push([C.proposal.account,'…'+m[2]]);
  if(inv&&inv.due_date)pairs.push([C.proposal.due,String(inv.due_date)]);
  const d=el('dl','read');for(const [k,v] of pairs)d.append(el('dt','',k),el('dd','',v));
  return {amount,list:d};
}
function termsFold(p){
  const pre=el('pre','terms mono');const f=el('details','',[el('summary','',C.approve.terms),pre]);
  let asked=false;
  f.addEventListener('toggle',()=>{if(!f.open||asked)return;asked=true;
    api('GET','/v1/engine/proposals/'+encodeURIComponent(p.id)+'/terms').then((r)=>{
      if(r.status===200&&typeof r.json.canonical==='string')pre.textContent=r.json.canonical;else{asked=false;pre.replaceWith(note(words(r.json,C.approve.failed)))}})});
  return f;
}
screen('approve',{heading:C.approve.heading,draw(box,arg){
  const A=C.approve;const inv=arg&&arg.invoice||null;
  const top=el('div','');const said=el('div','');said.setAttribute('role','status');
  const main=mainButton();main.off(A.filing);
  const live=livePanel();
  box.append(top,said,main.node,live.node);
  let p=null,eng=null;
  const saves=el('span','',' '+fill(A.saves,{host:CFG.rpId}));
  const track=(req)=>{const t0=performance.now();pollStart((items)=>live.add(items,t0));return req.then((r)=>{pollDone();return r})};
  async function file(){
    said.replaceChildren();main.off(A.filing);
    const ready=inv&&inv.proposal&&inv.proposal.status==='PENDING_APPROVAL'&&!arg.again?inv.proposal:null;
    const r=ready?{status:200,json:{proposal:ready}}
      :inv&&inv.id?await track(api('POST','/v1/engine/invoices/'+encodeURIComponent(inv.id)+'/pay'))
      :S.proposal?await api('GET','/v1/engine/proposals/'+encodeURIComponent(S.proposal.id)):{status:0,json:{}};
    const st=await api('GET','/v1/engine');
    if(S.screen!=='approve')return;
    if(r.status!==200||!r.json.proposal||typeof r.json.proposal.id!=='string'){said.replaceChildren(note(words(r.json,A.failed)));main.set(A.fileAgain,()=>{arg=Object.assign({},arg,{again:true});return file()});return}
    p=r.json.proposal;eng=st.status===200?st.json:{passkey:null};
    S.proposal={id:p.id,challenge:p.challenge,terms_sha256:p.terms_sha256,invoice:inv&&inv.id||(S.proposal&&S.proposal.invoice)||null};S.cred=null;save();
    const f=factRows(p,inv);
    top.replaceChildren(el('span','art',icon('key-round',28)),el('p','amount',f.amount),f.list,
      el('p','short mono',String(p.terms_sha256||'').slice(0,12)+'…'),termsFold(p),el('p','muted',[A.signs,saves]));
    stage();
  }
  function stage(){
    if(!hasPasskeys()){main.node.hidden=true;said.replaceChildren(note(A.noPasskey));return}
    saves.hidden=!!(eng&&eng.passkey);
    if(!eng||!eng.passkey){main.set(A.create,createPasskey);return}
    main.set(fill(A.approve,{amount:factRows(p,inv).amount,method:method()}),approve);
  }
  async function createPasskey(){
    said.replaceChildren();main.node.textContent=A.waiting;
    const s=await api('POST','/v1/engine/passkey/start');
    if(s.status!==200||!s.json.user){said.replaceChildren(note(words(s.json,A.failed)));stage();return}
    let made;
    try{made=await navigator.credentials.create({publicKey:{rp:{id:s.json.rp.id,name:s.json.rp.name},user:{id:new TextEncoder().encode(s.json.user.id),name:s.json.user.name,displayName:s.json.user.displayName},
      challenge:fromB64u(s.json.challenge),pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],excludeCredentials:(s.json.exclude||[]).map((id)=>({type:'public-key',id:fromB64u(id)})),
      authenticatorSelection:{userVerification:'required',residentKey:'discouraged'},attestation:'none',timeout:120000}})}
    catch(e){said.replaceChildren(note(cancelled(e)?A.cancelled:A.failed));stage();return}
    const f=await api('POST','/v1/engine/passkey/finish',{code:s.json.code,credential:registrationOf(made)});
    if(f.status!==200){said.replaceChildren(note(words(f.json,A.failed)));stage();return}
    const st=await api('GET','/v1/engine');if(st.status===200)eng=st.json;
    stage();
  }
  async function approve(){
    said.replaceChildren();main.node.textContent=A.waiting;
    let signed;
    try{signed=await signTerms(p.challenge,eng.passkey.credential_id)}catch(e){said.replaceChildren(note(A.cancelled));stage();return}
    const r=await track(api('POST','/v1/engine/proposals/'+encodeURIComponent(p.id)+'/approve',{terms_sha256:p.terms_sha256,credential:signed}));
    if(S.screen!=='approve')return;
    if(r.status===200&&r.json.status==='approved'&&r.json.held===true){
      // Held: the approval is stored and nothing is paid; the signature is kept for screen 4.
      S.cred=signed;save();
      said.replaceChildren(el('p','big ok',A.approved));
      main.set(A.next,()=>show('pay'));main.node.focus();return;
    }
    if(r.status===200&&r.json.status==='approved'){S.settled=r.json.settled||null;save();show('books',{settled:S.settled});return}
    said.replaceChildren(note(words(r.json,A.failed)));
    if(r.json.status==='expired')main.set(A.fileAgain,()=>{arg=Object.assign({},arg,{again:true});return file()});else stage();
  }
  file();
}});

// 4 Pay with your signature: the signed terms in three fields; the one button sends the fields' terms with the kept
// signature to the one pay route, and only the answer, once back, is drawn.
screen('pay',{heading:C.pay.heading,draw(box){
  const Y=C.pay;const pid=S.proposal&&S.proposal.id;
  const top=el('div','',[el('p','muted',Y.loading)]);const out=el('div','outcome');out.setAttribute('role','status');
  const main=mainButton();main.off(Y.button);
  const live=livePanel();
  box.append(top,main.node,out,live.node);
  if(!pid){top.replaceChildren(note(Y.failed));return}
  let T=null;const F={};
  const field4=(label,key,cls)=>{const i=input('text');i.autocomplete='off';i.spellcheck=false;F[key]=i;return el('div','f'+(cls?' '+cls:''),[el('label','',label),i])};
  const reset=()=>{F.amount.value=String(T.terms.amount);F.beneficiary_name.value=String(T.terms.beneficiary_name);F.iban_last4.value=String(T.terms.iban_last4);F.amount.setCustomValidity('')};
  const values=()=>({amount:normAmount(F.amount.value,T.terms.amount),beneficiary_name:F.beneficiary_name.value.trim(),iban_last4:F.iban_last4.value.trim()});
  api('GET','/v1/engine/proposals/'+encodeURIComponent(pid)+'/terms').then((r)=>{
    if(S.screen!=='pay')return;
    if(r.status!==200||!r.json.terms||typeof r.json.terms!=='object'){top.replaceChildren(note(words(r.json,Y.failed)));return}
    T=r.json;
    const form=el('form','',[field4(C.proposal.amount,'amount','big'),field4(C.proposal.payee,'beneficiary_name'),field4(C.proposal.account,'iban_last4')]);
    for(const [k,id] of [['amount','p-amt'],['beneficiary_name','p-payee'],['iban_last4','p-acct']]){F[k].id=id;F[k].parentNode.firstChild.htmlFor=id}
    F.amount.inputMode='decimal';F.amount.classList.add('mono');F.iban_last4.classList.add('mono');F.amount.addEventListener('input',()=>F.amount.setCustomValidity(''));
    form.addEventListener('submit',(ev)=>{ev.preventDefault();if(!main.node.disabled)main.node.click()});
    const when=Date.parse(T.expires_at||'');
    const intro=el('div','',[el('p','muted',Y.line),isFinite(when)?el('p','hint',fill(Y.until,{time:new Date(when).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})})):null]);
    top.replaceChildren(form,intro);reset();
    main.set(Y.button,()=>send(intro));
  });
  async function send(intro){
    const v=values();
    if(v.amount===null){F.amount.setCustomValidity(Y.amountBad);F.amount.reportValidity();return}
    let cred=S.cred;
    if(!cred){
      // After a reload without the kept signature: the passkey again, for the same terms (the challenge is their hash).
      const st=await api('GET','/v1/engine');
      try{cred=await signTerms(S.proposal.challenge,st.json.passkey&&st.json.passkey.credential_id)}catch(e){out.replaceChildren(note(C.approve.cancelled));return}
      S.cred=cred;save();
    }
    main.node.textContent=Y.sending;out.replaceChildren();
    const body=payBody(T.terms,v,cred);
    const t0=performance.now();
    pollStart((items)=>live.add(items,t0));
    const r=await api('POST','/v1/engine/proposals/'+encodeURIComponent(pid)+'/pay',body);
    const ms=performance.now()-t0;
    pollDone();
    if(S.screen!=='pay')return;
    main.set(Y.button,()=>send(intro));
    outcome(r,ms,body.terms,intro);
  }
  function outcome(r,ms,sent,intro){
    const j=r.json,o=r.status===200?j.outcome:null;
    if(o==='paid'){S.settled=j.settled||null;save();show('books',{settled:S.settled});return}
    if(o==='not_signed'){S.cred=null;save();show('approve',{});return}
    if(o==='refused'){intro.hidden=true;out.replaceChildren(refused(r,ms,sent));return}
    if(o==='paid_once'){out.replaceChildren(el('p','big',Y.paidOnce));return}
    if(o==='expired'){out.replaceChildren(note(words(j,Y.failed)));main.set(Y.fileAgain,()=>show('approve',{invoice:S.proposal.invoice?{id:S.proposal.invoice}:null,again:true}));return}
    if(o==='failed'){out.replaceChildren(note(words(j,j.settled&&j.settled.error||Y.failed)));main.set(Y.retry,retry);return}
    out.replaceChildren(note(words(j,Y.failed)));
  }
  async function retry(){
    const r=await api('POST','/v1/engine/proposals/'+encodeURIComponent(pid)+'/retry');
    if(S.screen!=='pay')return;
    if(r.status===200&&r.json.settled&&!r.json.settled.error){S.settled=r.json.settled;save();show('books',{settled:S.settled});return}
    out.replaceChildren(note(words(r.json,r.json.settled&&r.json.settled.error||Y.failed)));
  }
  function refused(r,ms,sent){
    const j=r.json,L=j.layers&&typeof j.layers==='object'?j.layers:{};const sig=L.signature||{},ex=L.executor||{};
    const card=el('div','card',[el('p','stamp',Y.stamp)]);
    if(sig.verified===false){const why=typeof sig.reason==='string'&&/\s/.test(sig.reason.trim())?sig.reason.trim():Y.signatureOff;card.append(el('p','layer',fill(Y.signature,{reason:why})))}
    if(ex.accepted===false){card.append(el('p','layer',Y.executor));
      if(typeof ex.said==='string'&&ex.said)card.append(el('details','',[el('summary','',Y.executorFold),el('p','',ex.said),el('p','hint',Y.executorNote)]))}
    const d=hashDiff(typeof j.signed_sha256==='string'?j.signed_sha256:'',typeof j.sent_sha256==='string'?j.sent_sha256:'');
    const line=(label,runs)=>el('p','hash mono',[el('span','hl',label),...runs.map((x)=>x[1]?el('mark','',x[0]):x[0])]);
    card.append(line(Y.signed,d.a),line(Y.sent,d.b));
    card.append(el('p','verdict',verdict(Y,T.terms,sent,j.changed)));
    card.append(el('p','proof',fill(Y.roundTrip,{n:Math.round(ms)})));
    const made=Number(j.transfers_after)-Number(j.transfers_before);
    if(isFinite(made))card.append(el('p','proof',fill(Y.transfers,{n:made})));
    if(S.mode&&S.mode.rail_awx==='on'&&typeof j.sandbox_calls==='number')card.append(el('p','proof',fill(Y.sandbox,{n:j.sandbox_calls})));
    const raw=el('pre','raw mono');raw.textContent=r.text;
    card.append(el('details','',[el('summary','',Y.raw),raw]));
    const back=el('button','link',Y.putBack);back.type='button';back.addEventListener('click',()=>{reset();F.amount.focus()});
    card.append(el('p','',back));
    return card;
  }
}});

// 5 Paid (a placeholder until B3 draws the books): the pay route's settled answer, as it came back.
screen('books',{heading:C.books.heading,draw(box,arg){
  const s=arg&&arg.settled&&typeof arg.settled==='object'?arg.settled:{};
  const d=el('dl','read');
  for(const [k,v] of [[C.books.invoice,s.invoice_status],[C.books.transfer,s.transfer_status],[C.books.ledger,s.ledger_entries]]){if(v===null||v===undefined||v==='')continue;d.append(el('dt','',k),el('dd','',String(v)))}
  box.append(el('span','art ok pop',icon('circle-check',30)),el('p','lede',C.books.sub),d);
  if(typeof s.error==='string'&&s.error)box.append(note(s.error));
}});

// The visit is over: the company is gone, or the session could not be renewed.
for(const [name,words] of [['gone',C.gone],['ended',C.ended]])screen(name,{heading:words.heading,band:false,draw(box){
  const b=btn(words.button,true);b.addEventListener('click',()=>{forget();show('start')});box.append(b);
}});

// A reload returns to the screen the server's state calls for.
async function boot(){
  restore();
  if(!S.session){show('start');return}
  if(due()&&!(await renew()))return;
  armRenewal();
  const r=await api('GET','/v1/engine/invoices');
  if(!S.session)return;
  const items=r.status===200&&Array.isArray(r.json.items)?r.json.items:[];
  const last=items[items.length-1];
  // Signing and paying return where they were: the proposal and the kept signature are in this tab's state.
  if(S.screen==='books'&&S.settled){show('books',{settled:S.settled});return}
  if(S.screen==='pay'&&S.proposal){show('pay');return}
  if(S.screen==='approve'&&last){show('approve',{invoice:last});return}
  if(last)show('work',{kind:'reload',invoice:last});else show('invoice');
}
boot();
`;

const nonce = () => {
  const b = crypto.getRandomValues(new Uint8Array(18));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** The page: one document, its config in a meta tag (the origin and the passkey RP id, for the screens that sign). */
export function tryPage(n: string, cfg: { origin: string; rpId: string }): string {
  const copy = { band: BAND, steps: STEPS, start: START, invoice: INVOICE, work: WORK, fields: INVOICE_FIELDS, approve: APPROVE, proposal: PROPOSAL_FIELDS, method: METHOD, pay: PAY, books: BOOKS, gone: GONE, ended: ENDED, live: LIVE };
  const icons = { "key-round": MORE["key-round"], "circle-check": ICONS["circle-check"] };
  const script = SCRIPT.replace("__COPY__", () => json(copy)).replace("__EVENT_LINE__", () => EVENT_LINE_JS).replace("__SIGN__", () => SIGN_JS)
    .replace("__ICONS__", () => json(icons)).replace("__RUNS__", () => json(RUNS_URL));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="purser-try" content="${escAttr(JSON.stringify(cfg))}">
<title>Purser · hands-on</title>
<style nonce="${n}">${CSS}</style></head><body>
<header class="top"><span class="brand"><span class="mk">P</span>${CHROME.brand}</span></header>
<main id="main"></main>
<p class="sr" id="say" role="status" aria-live="polite"></p>
<script type="module" nonce="${n}">${script}</script>
</body></html>`;
}

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin", "permissions-policy": "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
};

/** GET /try: the page under the console's policy, with a fresh nonce. */
export function tryPageResponse(_req: Request, _url: URL, env: CloudEnv): Response {
  const n = nonce();
  return new Response(tryPage(n, { origin: env.origin, rpId: env.rpId }), { status: 200, headers: { ...PAGE_HEADERS, "content-security-policy": consoleCsp(n) } });
}
