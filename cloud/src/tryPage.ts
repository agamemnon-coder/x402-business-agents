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
import { consoleCsp } from "./console.js";
import { BAND, CHROME, ENDED, GONE, INVOICE, INVOICE_FIELDS, LIVE, START, WORK } from "./tryCopy.js";
import { EVENT_LINE_JS } from "./tryEvents.js";
import { TOKENS } from "../../src/redesign/ui.js";
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
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 520px) { .btn.big { width: 100%; } h1 { font-size: 26px; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
`;

// The client: plain JS (no template literals in it, so it sits in this file as a raw string).
const SCRIPT = String.raw`
const C=__COPY__;
const W=C.live;
__EVENT_LINE__
const lineOf=eventLineOf(W);
const CFG=JSON.parse(document.querySelector('meta[name=purser-try]').content);
const RUNS=__RUNS__;
const $=(s)=>document.querySelector(s);
const el=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids??[])){if(k===null||k===undefined||k===false)continue;e.append(typeof k==='string'?document.createTextNode(k):k)}return e};
const btn=(label,main)=>{const b=el('button','btn'+(main?' primary big':''),label);b.type='button';return b};
const fill=(s,v)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??''));
const secs=(ms)=>(Math.max(0,ms)/1000).toFixed(1);
const say=(text)=>{$('#say').textContent=text};

// The token from the link (#e=… or #j=…): read once, taken out of the address bar at once, and sent only in the start
// request's body.
const TOKEN=(()=>{const m=/^#([ej])=([A-Za-z0-9_.~-]{1,256})$/.exec(location.hash);if(location.hash)history.replaceState(null,'',location.pathname+location.search);return m?m[2]:null})();

// The state: one object, kept in this tab (sessionStorage), or in memory only where storage throws.
const KEY='purser.try';
const KEEP=['tenant','session','visitor_token','expires_at','pool','mode','screen','after'];
const S={tenant:null,session:null,visitor_token:null,expires_at:null,pool:null,mode:null,screen:null,after:0};
const save=()=>{const o={};for(const k of KEEP)o[k]=S[k];try{sessionStorage.setItem(KEY,JSON.stringify(o))}catch(e){}};
const restore=()=>{try{const o=JSON.parse(sessionStorage.getItem(KEY)||'null');if(o&&typeof o==='object')for(const k of KEEP)if(o[k]!==undefined)S[k]=o[k]}catch(e){}};
const forget=()=>{for(const k of KEEP)S[k]=k==='after'?0:null;try{sessionStorage.removeItem(KEY)}catch(e){}};
const tenantId=()=>typeof S.tenant==='string'?S.tenant:S.tenant&&S.tenant.id;

// One request with the session. Status 0: no answer came.
async function call(method,path,body){
  const headers={};if(S.session)headers.authorization='Bearer '+S.session;if(body!==undefined)headers['content-type']='application/json';
  let r;try{r=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})}catch(e){return {status:0,json:{}}}
  let json={};try{json=await r.json()}catch(e){}
  return {status:r.status,json:json&&typeof json==='object'?json:{}};
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
function show(name,arg){
  const d=SCREENS[name];if(!d)return false;
  pollStop();askCloseAll();
  S.screen=name;save();
  const h=el('h1','',typeof d.heading==='function'?d.heading(arg):d.heading);h.tabIndex=-1;
  const box=el('div','screen');
  $('#main').replaceChildren(...(d.band===false||!S.session?[]:[band()]),h,box);
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
  if(items.length)show('work',{kind:'reload',invoice:items[items.length-1]});else show('invoice');
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
  const copy = { band: BAND, start: START, invoice: INVOICE, work: WORK, fields: INVOICE_FIELDS, gone: GONE, ended: ENDED, live: LIVE };
  const script = SCRIPT.replace("__COPY__", () => json(copy)).replace("__EVENT_LINE__", () => EVENT_LINE_JS).replace("__RUNS__", () => json(RUNS_URL));
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
