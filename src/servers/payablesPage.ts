// The payables pages (src/servers/payables.ts): the overview at / and one invoice at /invoices/:id. Built on the
// design system's tokens (src/redesign/ui.ts), light and dark. Each page carries one inline module script with the
// response's nonce (no 'unsafe-inline' scripts), renders every value from the JSON routes with textContent, never as
// HTML, and posts with this page's own token. The invoice's document is drawn by pdf.js from this origin
// (/assets/pdfjs.mjs, without eval): the supplier's file is never opened as a page here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clientI18n, DEFAULT_LANG, localKeys, t, type Lang } from "../ui/i18n.js";
import { escAttr, ICON_SET, PAYABLES_CSS as CSS, svg } from "../ui/payablesKit.js";

export { ICON_SET, svg };

/** Inter (OFL, src/ui/inter-LICENSE.txt). */
export const FONT = readFileSync(new URL("../ui/inter.woff2", import.meta.url));
/** pdf.js as unpdf ships it (the pinned dependency the inbox already reads documents with). */
export const PDFJS = readFileSync(fileURLToPath(import.meta.resolve("unpdf/pdfjs")));


export const shell = (o: { title: string; csrf: string; nonce: string; body: string; script: string; page?: "invoices" | "transactions"; lang?: Lang }) => {
  const lang = o.lang ?? DEFAULT_LANG;
  const other: Lang = lang === "nl" ? "en" : "nl";
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf" content="${o.csrf}">
<meta name="color-scheme" content="light dark">
<title>${escAttr(o.title)}</title>
<style>${CSS}</style></head><body>
<header class="top"><div class="wrap"><a class="brand" href="/"><span class="mk">P</span><span>Purser</span><span class="sec">${t(lang, "app.payables")}</span></a>
<nav class="tabs" aria-label="${t(lang, "app.pages")}"><a href="/"${o.page === "transactions" ? "" : ' aria-current="page"'}>${t(lang, "nav.invoices")}</a><a href="/transactions"${o.page === "transactions" ? ' aria-current="page"' : ""}>${t(lang, "nav.transactions")}</a></nav>
<a class="lang" href="?lang=${other}" hreflang="${other}" lang="${other}" title="${escAttr(t(lang, "lang.switch.title"))}" aria-label="${escAttr(t(lang, "lang.switch"))}"><span class="ll">${t(lang, "lang.switch")}</span><span class="ls">${other.toUpperCase()}</span></a>
<span class="test" title="${escAttr(t(lang, "test.title"))}">${svg("flask", 14)}<span class="tl"> ${t(lang, "test.label")}</span></span></div></header>
<main><div class="wrap">${o.body}</div></main>
<script type="module" nonce="${o.nonce}">${clientI18n(lang, localKeys)}${o.script}</script>
</body></html>`;
};

/** What the overview and the detail page share: helpers, formatting, posting with this page's token. */
export const COMMON = `
const csrf=document.querySelector('meta[name=csrf]').content;
const $=(s)=>document.querySelector(s);
const el=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids??[])){if(k===null||k===undefined||k===false)continue;e.append(typeof k==='string'?document.createTextNode(k):k)}return e};
const ic=(name)=>{const s=document.createElement('span');s.className='ic';s.innerHTML=IC[name]||'';return s};
const money=(c,v)=>{const s=el('span','num');if(c)s.append(el('small','',cur(c)));s.append(amount(v));return s};
const today=new Date().toISOString().slice(0,10);
async function post(path,body,headers){const r=await fetch(path,{method:'POST',headers:Object.assign({'x-csrf':csrf},headers||{}),body});const j=await r.json().catch(()=>({error:r.statusText}));if(!r.ok)throw new Error(j.error||r.statusText);return j}
const chip=(status,words)=>el('span','st '+status,statusWords(status,words));
`;

const OVERVIEW_BODY = (lang: Lang) => `
<div class="head"><div><h1>${t(lang, "ov.h1")}</h1><p class="lede">${t(lang, "ov.lede")}</p></div>
<div class="tools"><button class="btn" id="sync" type="button">${svg("refresh-cw", 16)} ${t(lang, "ov.check_payments")}</button>
<a class="btn" href="/api/payables/export/journal.csv">${svg("download", 16)} ${t(lang, "ov.journal")}</a><a class="btn" href="/api/payables/export/invoices.csv">${svg("download", 16)} ${t(lang, "ov.invoices_csv")}</a></div></div>
<!--inbox-->
<label class="drop" id="drop"><span class="ic">${svg("upload", 22)}</span><span><b>${t(lang, "ov.drop")}</b><span class="sub">${t(lang, "ov.drop_sub")} <span class="sub2">${t(lang, "ov.drop_sub2")}</span></span></span>
<span class="btn">${t(lang, "ov.choose")}</span><input type="file" id="file" multiple accept=".pdf,.eml,application/pdf,message/rfc822"></label>
<p id="msg" role="status"></p>
<div class="tiles" id="tiles"></div>
<section class="section"><div class="bar" id="filters"><h2>${t(lang, "ov.invoices")}</h2></div>
<div class="batchbar" id="batchbar" hidden><span class="what" id="batchwhat"></span><button class="btn" id="batchall" type="button">${t(lang, "ov.batch_all")}</button><button class="btn primary" id="batchpay" type="button">${svg("scan-face", 16)} ${t(lang, "ov.batch_pay")}</button></div>
<div class="card list" id="list"></div></section>
<section class="section"><div class="grid2" id="more"></div></section>
<p class="foot">${t(lang, "ov.foot")}</p>`;

const OVERVIEW_SCRIPT = `
const IC=${ICON_SET(["triangle-alert", "clock", "circle-check", "octagon-x", "inbox", "wallet", "chevron-right", "calendar-range"])};
${COMMON}
const msg=(t,tone)=>{const m=$('#msg');m.textContent=t;m.className=tone||''};
const FILTERS=[['all',t('filter.all'),()=>true],['act',t('filter.act'),(i)=>['ready','needs_review','needs_vendor'].includes(i.status)],['waiting_cfo',t('filter.waiting_cfo'),(i)=>i.status==='waiting_cfo'],['paid',t('filter.paid'),(i)=>i.status==='paid'],['blocked',t('filter.blocked'),(i)=>i.status==='blocked'],['rejected',t('filter.rejected'),(i)=>i.status==='rejected']];
let filter='all';let all=[];const picked=new Set();
const sum=(a)=>a&&a.length?a:null;
function tile(label,icon,value,extra,tone){const t=el('div','card tile'+(tone?' '+tone:''));const l=el('div','l',[ic(icon),label]);const v=el('div','v num');if(value instanceof Node)v.append(value);else v.textContent=value;t.append(l,v);if(extra)t.append(el('div','x',extra));return t}
function amounts(a){if(!a)return null;const f=a[0];const s=el('span');s.append(el('small','',cur(f.currency)),amount(f.total));return s}
function rest(a){if(!a)return null;const others=a.slice(1).map(x=>ma(x.currency,x.total));const n=a.reduce((k,x)=>k+x.count,0);return [tn('n_invoices',n),...others].join(' · ')}
function why(i){if(i.status==='paid')return i.paid_at?t('paid_on',{date:day(i.paid_at)}):t('paid');if(i.status==='ready')return t('all_checks_passed');if(i.status==='waiting_cfo')return t('filed_for_face_id');const f=i.findings.filter(x=>x.level!=='warn')[0]||i.findings[0];return f?cap(finding(f)):''}
function rows(){
  const list=$('#list');list.replaceChildren();
  const shown=all.filter(FILTERS.find(f=>f[0]===filter)[2]).slice().reverse();
  if(!all.length){list.append(el('div','empty',[el('b','',t('no_invoices_yet')),t('ov.empty')]));return}
  list.append(el('div','row th',[el('span','',t('supplier')),el('span','',t('invoice')),el('span','',t('due')),el('span','amt',t('amount')),el('span','',t('status')),el('span','',t('why')),el('span','')]));
  if(!shown.length){list.append(el('div','empty',[el('b','',t('nothing_here')),t('no_invoice_in_state')]));return}
  for(const i of shown){
    const a=el('a','row');a.href='/invoices/'+encodeURIComponent(i.id);
    const sup=el('span','sup',[i.vendor||t('unknown_supplier')]);sup.title=i.vendor;
    if(i.status==='ready'&&i.payable!==false){const cb=el('input','pick');cb.type='checkbox';cb.checked=picked.has(i.id);cb.setAttribute('aria-label',t('ov.batch_pick',{no:i.invoice_no||i.id}));cb.onclick=(e)=>{e.preventDefault();e.stopPropagation();const on=!picked.has(i.id);if(on)picked.add(i.id);else picked.delete(i.id);setTimeout(()=>{cb.checked=on},0);bar()};sup.prepend(cb)}
    const no=el('span','no',[i.invoice_no||t('no_number'),el('span','sub',i.id)]);no.title=i.invoice_no;
    const late=i.due_date&&i.due_date<today&&!['paid','rejected'].includes(i.status);
    const due=el('span','due num'+(late?' late':''),i.due_date?day(i.due_date):'–');
    const amt=el('span','amt',[el('span','c',cur(i.currency)),amount(i.total)||'–']);
    const w=why(i);const wy=el('span','why',w);wy.title=w;
    const st=chip(i.status,i.status_words);st.title=statusWords(i.status,i.status_words);
    a.append(sup,no,due,amt,el('span','stc',[st]),wy,ic('chevron-right'));a.lastChild.className='go';
    list.append(a)}
}
// One Face ID for many: the picked ready invoices become one batch the CFO signs on the phone (each line its own payment).
function bar(){const ready=all.filter(i=>i.status==='ready'&&i.payable!==false);for(const id of [...picked])if(!ready.some(i=>i.id===id))picked.delete(id);
  const b=$('#batchbar');b.hidden=!ready.length;const sel=ready.filter(i=>picked.has(i.id));const tot={};for(const i of sel)tot[i.currency]=(tot[i.currency]||0)+Math.round(parseFloat(i.total)*100);
  const sums=Object.keys(tot).sort().map(c=>ma(c,(tot[c]/100).toFixed(2))).join(' · ');
  $('#batchwhat').replaceChildren(...(sel.length?[el('b','',t('ov.batch_picked',{n:sel.length})),' · '+sums]:[t('ov.batch_hint')]));
  $('#batchpay').disabled=!sel.length;$('#batchall').style.display=sel.length===ready.length?'none':''}
$('#batchall').onclick=()=>{for(const i of all)if(i.status==='ready'&&i.payable!==false)picked.add(i.id);rows();bar()};
$('#batchpay').onclick=async()=>{const ids=[...picked];const btn=$('#batchpay');btn.disabled=true;
  try{const j=await post('/api/payables/batch',JSON.stringify({ids}),{'content-type':'application/json'});picked.clear();
    const left=j.not_planned.length?' '+t('ov.batch_left',{list:j.not_planned.map(x=>x.id+' ('+x.reason+')').join('; ')}):'';
    msg(j.batch?tn('ov.batch_filed',j.batch.count,{id:j.batch.proposal_id})+left:t('ov.batch_nothing')+left,j.batch&&!left?'ok':'bad');await load()}
  catch(e){msg(e.message,'bad');btn.disabled=false}};
function filters(){const bar=$('#filters');bar.querySelectorAll('.chip').forEach(c=>c.remove());for(const [k,label,fn] of FILTERS){const n=all.filter(fn).length;if(k!=='all'&&!n&&k!=='act')continue;const b=el('button','chip',[label,' ',el('b','',String(n))]);b.type='button';b.setAttribute('aria-pressed',String(filter===k));b.onclick=()=>{filter=k;filters();rows()};bar.append(b)}}
function more(x){
  const box=$('#more');box.replaceChildren();
  const spend=el('div','card mini',[el('h3','',t('ov.spend'))]);const kv=el('div','kv');
  for(const s of x.spend_90d.slice(0,5))kv.append(el('span','',s.vendor+' ('+s.count+')'),el('span','',ma(s.currency,s.total)));
  if(!x.spend_90d.length)kv.append(el('span','',t('ov.nothing_booked')),el('span',''));spend.append(kv);
  const cost=el('div','card mini',[el('h3','',t('ov.cost'))]);const kv2=el('div','kv');
  kv2.append(el('span','',t('ov.fees')),el('span','',x.costs.swift_fees.length?x.costs.swift_fees.map(f=>ma(f.currency,f.total)).join(', '):t('none')));
  kv2.append(el('span','',t('ov.conversions')),el('span','',String(x.costs.fx.conversions)));
  kv2.append(el('span','',t('ov.median')),el('span','',x.time_to_pay.median_hours===null?'–':t('ov.hours',{n:NL?String(x.time_to_pay.median_hours).replace('.',','):x.time_to_pay.median_hours})));
  kv2.append(el('span','',t('ov.paid_invoices')),el('span','',String(x.time_to_pay.paid)));cost.append(kv2);
  const rise=el('div','card mini',[el('h3','',t('ov.prices'))]);const kv3=el('div','kv');
  for(const r of x.price_rises)kv3.append(el('span','',r.vendor),el('span','','+'+r.change_pct+'% ('+ma(r.currency,r.last)+')'));
  if(!x.price_rises.length)kv3.append(el('span','',t('ov.no_rise')),el('span',''));rise.append(kv3);
  box.append(spend,cost,rise)}
async function load(){
  const [list,x]=await Promise.all([fetch('/api/payables/invoices').then(r=>r.json()),fetch('/api/payables/insights').then(r=>r.json())]);
  all=list;
  const tiles=$('#tiles');tiles.replaceChildren();
  const wait=x.waiting.waiting_cfo+x.waiting.needs_review+x.waiting.needs_vendor;
  const top=x.blocked.reasons.slice().sort((a,b)=>b.count-a.count)[0];
  const list2=(a)=>a.map(v=>ma(v.currency,v.total)).join(' · ');
  tiles.append(
    sum(x.credits)?tile(t('ov.tile.open'),'wallet',amounts(sum(x.open_net))||t('none'),rest(sum(x.open))+' · '+t('ov.after_credit',{amounts:list2(x.credits)})):tile(t('ov.tile.open'),'wallet',amounts(sum(x.open))||t('none'),rest(sum(x.open))||t('ov.nothing_to_pay')),
    tile(t('ov.tile.due7'),'calendar-range',amounts(sum(x.due_7))||t('none'),sum(x.due_30)?t('ov.due30',{amounts:list2(x.due_30)}):t('ov.nothing_due30')),
    tile(t('ov.tile.overdue'),'clock',amounts(sum(x.overdue))||t('none'),sum(x.overdue)?rest(sum(x.overdue)):t('ov.all_in_time'),sum(x.overdue)?'alert':'calm'),
    tile(t('ov.tile.waits'),'inbox',String(wait),t('ov.waits_detail',{faceid:x.waiting.waiting_cfo,check:x.waiting.needs_review,supplier:x.waiting.needs_vendor})),
    tile(t('ov.tile.blocked'),'octagon-x',String(x.blocked.count),top?t('ov.most',{reason:tk('top.'+top.code,tk('finding.'+top.code,top.code.replace(/_/g,' ')))}):t('ov.nothing_blocked'),x.blocked.count?'alert':'calm'));
  filters();rows();bar();more(x);
}
async function send(files){let n=0;for(const f of files){msg(t('ov.filing',{name:f.name}));try{const j=await post('/api/payables/documents',f,{'content-type':'application/octet-stream','x-filename':encodeURIComponent(f.name)});n++;msg(f.name+': '+(j.kind==='email'?t('ov.from_email',{n:j.results.length}):j.kind==='duplicate_document'?t('ov.filed_before'):j.invoice.id+', '+statusWords(j.invoice.status,j.invoice.status_words)),'ok')}catch(e){msg(f.name+': '+e.message,'bad')}}await load()}
$('#file').onchange=(e)=>send(e.target.files);
const drop=$('#drop');drop.ondragover=(e)=>{e.preventDefault();drop.classList.add('over')};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=(e)=>{e.preventDefault();drop.classList.remove('over');send(e.dataTransfer.files)};
$('#sync').onclick=async()=>{try{const j=await post('/api/payables/sync');msg(j.changed.length?t('ov.changed',{n:j.changed.length}):t('ov.nothing_changed'),'ok');load()}catch(e){msg(e.message,'bad')}};
load().catch(e=>msg(t('ov.load_failed',{error:e.message}),'bad'));
`;

/** The overview: upload, the figures, the invoices. */
export function overviewPage(csrf: string, nonce: string, inboxAddress: string | null = null, lang: Lang = DEFAULT_LANG): string {
  // The company's own inbox address, when configured: invoices mailed there arrive here (Purser Cloud).
  const inbox = inboxAddress ? `<p class="inbox">${svg("mail", 16)} ${t(lang, "ov.mail_to")} <b class="mono">${escAttr(inboxAddress)}</b> <span class="sub2">${t(lang, "ov.mail_to_sub")}</span></p>` : "";
  return shell({ title: t(lang, "ov.title"), csrf, nonce, body: OVERVIEW_BODY(lang).replace("<!--inbox-->", inbox), script: OVERVIEW_SCRIPT, lang });
}

const DETAIL_BODY = (id: string, lang: Lang) => `
<a class="back" href="/">${svg("arrow-left", 16)} ${t(lang, "dt.all")}</a>
<div id="d" data-id="${escAttr(id)}"><p class="lede">${t(lang, "loading")} ${escAttr(id)}</p></div>`;

const DETAIL_SCRIPT = `
const IC=${ICON_SET(["circle-check", "triangle-alert", "octagon-x", "clock", "circle-minus", "file-text", "external-link", "scan-face", "users", "ban", "sparkles", "bot", "info"])};
${COMMON}
const id=$('#d').dataset.id;
const RES={passed:['circle-check',t('res.passed')],warn:['triangle-alert',t('res.warn')],wait:['clock',t('res.wait')],review:['triangle-alert',t('res.review')],block:['octagon-x',t('res.block')],not_checked:['circle-minus',t('res.not_checked')]};
const SRC=(k)=>tk('src.'+k,k);
const dl=(pairs)=>{const d=el('dl','read');for(const [k,v,cls] of pairs){if(v===null||v===undefined||v==='')continue;d.append(el('dt','',k));const dd=el('dd',cls||'');if(v instanceof Node)dd.append(v);else dd.textContent=v;d.append(dd)}return d};
// An action's closed reason and a timeline row in this page's language: Dutch from their codes, English as the API says.
function actionWhy(a){if(!NL)return a.why;if(a.code==='findings'){const cs=String(a.vars.codes||'').split(',').filter(Boolean);return cs.map(c=>finding({code:c,detail:a.why})).join('; ')}if(a.code==='status')return statusWords(a.vars.status);return t('action.'+a.code,a.vars)}
function timelineWords(r){if(!NL||!r.kind)return [r.what,r.detail];const v=r.vars||{};
  if(r.kind==='received')return [t('tl.received'),t('tl.received.detail',{filename:v.filename,source:tk('source.'+v.source,v.source)})];
  if(r.kind==='checked')return [t('tl.checked',{status:statusWords(v.status)}),v.read_by==='parser'?t('tl.read_by_code'):t('tl.read_by_model',{model:v.read_by})];
  if(r.kind==='ready_again')return [t('tl.ready_again'),data('reason',v.reason||'')];
  if(r.kind==='status')return [statusWords(v.status),data('reason',v.reason||'')];
  if(r.kind==='note')return [t('tl.note'),v.model?t('tl.note.by_model',{model:v.model}):t('tl.note.by_code')];
  if(r.kind==='cleared')return [t('tl.cleared'),t('tl.cleared.detail',{by:v.by})+(v.note?': '+v.note:'')];
  return [r.what,r.detail]}
async function drawPdf(box){
  try{const {getDocument}=await import('/assets/pdfjs.mjs');
    const data=new Uint8Array(await (await fetch('/api/payables/invoices/'+encodeURIComponent(id)+'/document')).arrayBuffer());
    const doc=await getDocument({data,isEvalSupported:false,enableXfa:false,disableFontFace:false,useSystemFonts:false,stopAtErrors:false,verbosity:0}).promise;
    box.replaceChildren();const drawn=[];
    for(let n=1;n<=Math.min(doc.numPages,6);n++){const page=await doc.getPage(n);const vp=page.getViewport({scale:2});const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;c.setAttribute('aria-label',t('page_of_invoice',{n}));box.append(c);await page.render({canvasContext:c.getContext('2d'),viewport:vp,canvas:c}).promise;drawn.push(c)}
    if(doc.numPages>6)box.append(el('p','wait',t('dt.more_pages',{n:doc.numPages-6})));
    return drawn;
  }catch(e){box.replaceChildren(el('p','wait',t('dt.not_drawn',{error:e.message})));return []}
}
// A scan: each field the model read, beside the piece of the page it says it read it from, so a person checks one against the other.
const FIELD={vendor:'Supplier',invoice_no:'Invoice number',issue_date:'Invoice date',due_date:'Due date',currency:'Currency',subtotal:'Subtotal',tax:'VAT',total:'Total',iban:'IBAN',bic:'BIC',account_number:'Account',reference:'Reference'};
function scanCard(d){
  const s=d.scan;if(!s)return null;const i=d.invoice,r=i.reading;
  const val=(f)=>f==='total'||f==='subtotal'||f==='tax'?(i[f]?i.currency+' '+amount(i[f]):''):(i[f]??r[f]??'');
  const list=el('div','');list.style.cssText='display:grid;gap:10px';
  const summary=s.agreed?'Two independent readings agree on the IBAN, total, currency and invoice number. Check them against the page before paying.':s.readings<2?'Only one reading came back: a person checks every field against the page.':'The two readings differ on '+s.differ.map(x=>(FIELD[x]||x).toLowerCase()).join(', ')+': a person checks every field against the page.';
  const card=el('div','card panel',[el('h2','',['Read from a scan',el('span','cnt',s.agreed?'2 readings agree':'Needs a person')]),el('p','',summary),list]);
  card.fill=(pages)=>{for(const b of s.boxes){const pg=pages[b.page-1];const row=el('div','');row.style.cssText='display:grid;grid-template-columns:minmax(110px,30%) 1fr;gap:10px;align-items:center';
    const label=el('div','',[el('div','',FIELD[b.field]||b.field),el('b','',String(val(b.field)||'(empty)'))]);label.lastChild.style.cssText='word-break:break-all';
    if(pg){const c=document.createElement('canvas');const sx=Math.max(0,Math.floor(b.x*pg.width)),sy=Math.max(0,Math.floor(b.y*pg.height)),sw=Math.max(1,Math.floor(b.w*pg.width)),sh=Math.max(1,Math.floor(b.h*pg.height));c.width=sw;c.height=sh;c.getContext('2d').drawImage(pg,sx,sy,sw,sh,0,0,sw,sh);c.style.cssText='max-width:100%;border:1px solid var(--border);border-radius:6px;background:#fff';c.setAttribute('aria-label',(FIELD[b.field]||b.field)+' as on page '+b.page);row.append(label,c)}
    else row.append(label,el('span','wait','page '+b.page+' not drawn'));list.append(row)}
    if(!s.boxes.length)list.append(el('p','wait','The reading gave no places on the page: compare each field with the document on the left.'))};
  return card;
}
function render(d){
  const i=d.invoice,r=i.reading;
  const root=$('#d');root.replaceChildren();
  document.title='Purser · '+(i.vendor||t('invoice'))+' '+(i.invoice_no||i.id);
  const late=i.due_date&&i.due_date<today&&!['paid','rejected'].includes(i.status);
  const head=el('div','dhead',[
    el('div','who',[el('h1','',i.vendor||t('unknown_supplier')),el('div','meta',[chip(i.status,i.status_words),el('span','',t('dt.invoice',{no:i.invoice_no||t('no_number')})),el('span','','·'),el('span','',i.id),el('span','','·'),el('span','',SRC(d.document.source)+' '+day(i.received_at))])]),
    el('div','money',[el('div','big',[el('small','',cur(i.currency)),amount(i.total)||'–']),el('div','when',i.status==='paid'&&i.paid_at?t('paid_on',{date:day(i.paid_at)}):i.due_date?t(late?'dt.was_due':'dt.due',{date:day(i.due_date)}):t('dt.no_due'))])]);
  // Actions
  const bar=el('div','card actions');
  const pay=el('button','btn primary big',[ic('scan-face'),t('dt.pay')]);pay.type='button';pay.disabled=!d.actions.pay.allowed;
  const sup=el('button','btn big',[ic('users'),t('dt.request_supplier')]);sup.type='button';sup.disabled=!d.actions.supplier_request.allowed;
  const rej=el('button','btn danger big',[ic('ban'),t('dt.reject')]);rej.type='button';rej.disabled=!d.actions.reject.allowed;
  const note=el('div','note');
  const closed=d.actions.pay.allowed?null:actionWhy(d.actions.pay);
  const bnote=d.batch?el('span','batchnote',[ic('scan-face'),' '+(d.batch.waiting?tn('dt.in_batch_waiting',Number(d.batch.count),{id:d.batch.id}):tn('dt.in_batch',Number(d.batch.count),{id:d.batch.id,status:d.batch.status.toLowerCase().replace(/_/g,' ')}))+' ']):null;if(bnote)note.append(bnote);
  note.append(d.actions.pay.allowed?el('span','',[t('dt.files_payment'),el('b','',t('dt.nothing_moves')),t('dt.on_phone')]):el('span','',t('dt.pay_closed',{why:cap(closed)})));
  const status=el('p','');status.setAttribute('role','status');status.style.cssText='margin:0;flex-basis:100%;font-size:14px';
  // A paid, rejected or filed invoice has nothing left to do here: the bar says where it stands instead of showing dead buttons.
  const done=['paid','rejected','waiting_cfo'].includes(i.status);
  if(done){note.replaceChildren(el('span','',[el('b','',i.status==='paid'?(i.paid_at?t('dt.paid_on',{date:day(i.paid_at)}):t('paid')):statusWords(i.status)),i.proposal_id?t('dt.payment',{id:i.proposal_id}):'',i.status==='paid'?t('dt.paid_sandbox'):i.status==='waiting_cfo'?t('dt.cfo_on_phone'):t('dt.never_paid')]))}
  if(done&&bnote)note.prepend(bnote);
  bar.append(...(done?[]:d.actions.supplier_request.allowed?[sup,pay,rej]:[pay,rej]),note,status);
  const box=el('div','card rejectbox');const ta=document.createElement('textarea');ta.placeholder=t('dt.reject_why');ta.maxLength=300;
  const go=el('button','btn danger',[t('dt.reject_this')]);go.type='button';const cancel=el('button','btn',[t('cancel')]);cancel.type='button';
  box.append(el('b','',t('dt.reject_head',{no:i.invoice_no||i.id})),ta,el('div','row2',[go,cancel]));
  const say=(t,bad)=>{status.textContent=t;status.style.color=bad?'var(--bad)':'var(--ok)'};
  pay.onclick=async()=>{pay.disabled=true;try{const j=await post('/api/payables/invoices/'+encodeURIComponent(id)+'/pay');say(j.kind==='proposed'?t('dt.filed_as',{id:j.proposal_id}):t('dt.not_filed',{reason:j.reason}),j.kind!=='proposed');setTimeout(load,900)}catch(e){say(e.message,true);pay.disabled=false}};
  sup.onclick=async()=>{sup.disabled=true;try{const j=await post('/api/payables/invoices/'+encodeURIComponent(id)+'/supplier-request');say(t('dt.requested',{id:j.add_id}));setTimeout(load,900)}catch(e){say(e.message,true);sup.disabled=false}};
  rej.onclick=()=>{box.classList.toggle('open');ta.focus()};cancel.onclick=()=>box.classList.remove('open');
  go.onclick=async()=>{go.disabled=true;try{await post('/api/payables/invoices/'+encodeURIComponent(id)+'/reject',JSON.stringify({reason:ta.value}),{'content-type':'application/json'});await load()}catch(e){say(e.message,true);go.disabled=false}};
  // Document
  const pages=el('div','pages',[el('p','wait',t('drawing_document'))]);
  const open=el('a','',[ic('external-link'),t('dt.open_pdf')]);open.href='/api/payables/invoices/'+encodeURIComponent(id)+'/document';open.target='_blank';open.rel='noopener';
  const docv=el('div','card docv',[el('div','bar2',[ic('file-text'),el('span','fn',d.document.filename||'document.pdf'),open]),pages]);
  // What Purser read
  const line=d.total_line?el('span','',d.total_line):null;
  const payTo=r.iban?'IBAN '+r.iban+(r.bic?' · BIC '+r.bic:''):r.account_number?t('dt.account')+' '+r.account_number+(r.routing_value?' · '+r.routing_type.toUpperCase().replace('_',' ')+' '+r.routing_value:''):'';
  const read=el('div','card panel',[el('h2','',[t('dt.read'),el('span','cnt',i.read_by==='parser'?t('dt.read_by_code'):t('dt.read_by',{by:i.read_by}))]),dl([
    [t('supplier'),i.vendor],[t('dt.vat_id'),r.vat_id],[t('dt.invoice_number'),i.invoice_no],[t('dt.invoice_date'),day(i.issue_date)],[t('dt.due_date'),day(i.due_date)],
    [t('dt.subtotal'),i.subtotal?ma(i.currency,i.subtotal):''],[t('dt.vat'),i.tax?ma(i.currency,i.tax):''],[t('dt.total'),i.total?ma(i.currency,i.total):''],
    [t('dt.on_invoice'),line,'line'],[t('dt.pay_to'),payTo,'mono'],[t('dt.bank_country'),r.bank_country],[t('dt.reference'),r.reference],[t('dt.booked_to'),i.gl_account?(i.gl_account+(i.gl_rule?' · '+i.gl_rule:'')):'']])]);
  // Checks
  const ul=el('ul','checks');let passed=0;
  for(const c of d.checks){const [icon,word]=RES[c.result];if(c.result==='passed')passed++;const li=el('li','',[el('span','ic res-'+c.result),el('span','t',tk('check.'+c.key,c.title)),el('span','r res-'+c.result,word)]);li.firstChild.innerHTML=IC[icon];c.reasons.forEach((w,k)=>li.append(el('span','why',cap(finding({code:(c.codes||[])[k],detail:w})))));ul.append(li)}
  const checks=el('div','card panel',[el('h2','',[t('dt.checks'),el('span','cnt',t('dt.passed_of',{n:passed,m:d.checks.length}))]),ul]);
  // Note
  const by=i.review_by||'';
  // The code's own note is rebuilt in the page's language from the same facts (src/ap/review.ts codeNote); a model's note stays its own words.
  const codeNote=()=>{const fs=i.findings.map(f=>finding(f)).filter(Boolean);return statusWords(i.status)+': '+(i.vendor||t('unknown_supplier'))+' · '+t('dt.invoice',{no:i.invoice_no||t('no_number')})+(i.total?', '+ma(i.currency,i.total):'')+'. '+(fs.length?cap(fs.join('; '))+'.':t('dt.note_nothing'))};
  const noteCard=i.review_note?el('div','card notecard',[el('div','who',by.startsWith('claude:')?t('dt.note_by_model',{model:by.slice(7)}):t('dt.note_by_code')),el('p','',NL&&!by.startsWith('claude:')?codeNote():i.review_note)]):null;
  // Timeline
  const ol=el('ol','tl');for(const row of d.timeline){const [w,dt]=timelineWords(row);ol.append(el('li','',[el('div','',[el('span','w',w),el('span','at',stamp(row.at))]),dt?el('div','d',cap(dt)):null]))}
  const tl=el('div','card panel',[el('h2','',t('dt.timeline')),ol]);
  const scan=scanCard(d);
  root.append(head,el('div','banner',[ic('info'),t('dt.banner')]),bar,box,el('div','split',[docv,el('div','stack',[read,scan,checks,noteCard,tl])]));
  drawPdf(pages).then(p=>{if(scan)scan.fill(p)});
}
async function load(){const r=await fetch('/api/payables/invoices/'+encodeURIComponent(id)+'/detail');if(!r.ok){$('#d').replaceChildren(el('p','lede',t('dt.no_invoice',{id})));return}render(await r.json())}
load().catch(e=>$('#d').replaceChildren(el('p','lede',t('dt.load_failed',{id,error:e.message}))));
`;

/** One invoice: its document, what Purser read, every check, the note, the timeline and the actions. */
export function detailPage(csrf: string, nonce: string, id: string, lang: Lang = DEFAULT_LANG): string {
  return shell({ title: `Purser · ${id}`, csrf, nonce, body: DETAIL_BODY(id, lang), script: DETAIL_SCRIPT, lang });
}
