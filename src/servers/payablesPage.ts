// The payables pages (src/servers/payables.ts): the overview at / and one invoice at /invoices/:id. Built on the
// design system's tokens (src/redesign/ui.ts), light and dark. Each page carries one inline module script with the
// response's nonce (no 'unsafe-inline' scripts), renders every value from the JSON routes with textContent, never as
// HTML, and posts with this page's own token. The invoice's document is drawn by pdf.js from this origin
// (/assets/pdfjs.mjs, without eval): the supplier's file is never opened as a page here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { escAttr, ICON_SET, PAYABLES_CSS as CSS, svg } from "../ui/payablesKit.js";

export { ICON_SET, svg };

/** Inter (OFL, src/ui/inter-LICENSE.txt). */
export const FONT = readFileSync(new URL("../ui/inter.woff2", import.meta.url));
/** pdf.js as unpdf ships it (the pinned dependency the inbox already reads documents with). */
export const PDFJS = readFileSync(fileURLToPath(import.meta.resolve("unpdf/pdfjs")));


export const shell = (o: { title: string; csrf: string; nonce: string; body: string; script: string; page?: "invoices" | "transactions" }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf" content="${o.csrf}">
<meta name="color-scheme" content="light dark">
<title>${escAttr(o.title)}</title>
<style>${CSS}</style></head><body>
<header class="top"><div class="wrap"><a class="brand" href="/"><span class="mk">P</span><span>Purser</span><span class="sec">Payables</span></a>
<nav class="tabs" aria-label="Pages"><a href="/"${o.page === "transactions" ? "" : ' aria-current="page"'}>Invoices</a><a href="/transactions"${o.page === "transactions" ? ' aria-current="page"' : ""}>Transactions</a></nav>
<span class="test" title="This build pays only in the Airwallex sandbox">${svg("flask", 14)}<span class="tl"> Test money</span></span></div></header>
<main><div class="wrap">${o.body}</div></main>
<script type="module" nonce="${o.nonce}">${o.script}</script>
</body></html>`;

/** What the overview and the detail page share: helpers, formatting, posting with this page's token. */
export const COMMON = `
const csrf=document.querySelector('meta[name=csrf]').content;
const $=(s)=>document.querySelector(s);
const el=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids??[])){if(k===null||k===undefined||k===false)continue;e.append(typeof k==='string'?document.createTextNode(k):k)}return e};
const ic=(name)=>{const s=document.createElement('span');s.className='ic';s.innerHTML=IC[name]||'';return s};
const group=(int)=>int.replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');
const amount=(v)=>{const m=/^(-?)(\\d+)\\.(\\d{2})$/.exec(String(v||''));return m?m[1]+group(m[2])+'.'+m[3]:String(v||'')};
const money=(cur,v)=>{const s=el('span','num');if(cur)s.append(el('small','',cur));s.append(amount(v));return s};
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const day=(iso)=>{const m=/^(\\d{4})-(\\d{2})-(\\d{2})/.exec(iso||'');return m?(+m[3])+' '+MONTHS[+m[2]-1]+' '+m[1]:''};
const stamp=(iso)=>{const d=new Date(iso);if(isNaN(d))return '';return day(iso)+', '+String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0')+' UTC'};
const today=new Date().toISOString().slice(0,10);
async function post(path,body,headers){const r=await fetch(path,{method:'POST',headers:Object.assign({'x-csrf':csrf},headers||{}),body});const j=await r.json().catch(()=>({error:r.statusText}));if(!r.ok)throw new Error(j.error||r.statusText);return j}
const chip=(status,words)=>el('span','st '+status,words||status.replace(/_/g,' '));
`;

const OVERVIEW_BODY = `
<div class="head"><div><h1>Payables</h1><p class="lede">Supplier invoices in, read and checked by Purser, paid only with the CFO's Face ID, and booked.</p></div>
<div class="tools"><button class="btn" id="sync" type="button">${svg("refresh-cw", 16)} Check payments</button>
<a class="btn" href="/api/payables/export/journal.csv">${svg("download", 16)} Journal</a><a class="btn" href="/api/payables/export/invoices.csv">${svg("download", 16)} Invoices</a></div></div>
<!--inbox-->
<label class="drop" id="drop"><span class="ic">${svg("upload", 22)}</span><span><b>Drop PDF invoices or saved e-mails here</b><span class="sub">PDF or .eml, up to 16 MB <span class="sub2">· each file is read, checked and filed; nothing is paid without the CFO</span></span></span>
<span class="btn">Choose files</span><input type="file" id="file" multiple accept=".pdf,.eml,application/pdf,message/rfc822"></label>
<p id="msg" role="status"></p>
<div class="tiles" id="tiles"></div>
<section class="section"><div class="bar" id="filters"><h2>Invoices</h2></div>
<div class="batchbar" id="batchbar" hidden><span class="what" id="batchwhat"></span><button class="btn" id="batchall" type="button">Pick every ready invoice</button><button class="btn primary" id="batchpay" type="button">${svg("scan-face", 16)} Pay selected with one Face ID</button></div>
<div class="card list" id="list"></div></section>
<section class="section"><div class="grid2" id="more"></div></section>
<p class="foot">Test money only: this build pays through the Airwallex sandbox. Every figure comes from the ledger on this computer.</p>`;

const OVERVIEW_SCRIPT = `
const IC=${ICON_SET(["triangle-alert", "clock", "circle-check", "octagon-x", "inbox", "wallet", "chevron-right", "calendar-range"])};
${COMMON}
const msg=(t,tone)=>{const m=$('#msg');m.textContent=t;m.className=tone||''};
const FILTERS=[['all','All',()=>true],['act','To act on',(i)=>['ready','needs_review','needs_vendor'].includes(i.status)],['waiting_cfo','Waits for Face ID',(i)=>i.status==='waiting_cfo'],['paid','Paid',(i)=>i.status==='paid'],['blocked','Blocked',(i)=>i.status==='blocked'],['rejected','Rejected',(i)=>i.status==='rejected']];
let filter='all';let all=[];const picked=new Set();
const REASON={possible_fraud:'possible fraud',duplicate:'a copy of an invoice on file',iban_invalid:'an invalid IBAN',sum_mismatch:'amounts that do not add up',bank_details_invalid:'invalid bank details',payee_blocked:'a blocked supplier'};
const sum=(a)=>a&&a.length?a:null;
function tile(label,icon,value,extra,tone){const t=el('div','card tile'+(tone?' '+tone:''));const l=el('div','l',[ic(icon),label]);const v=el('div','v num');if(value instanceof Node)v.append(value);else v.textContent=value;t.append(l,v);if(extra)t.append(el('div','x',extra));return t}
function amounts(a){if(!a)return null;const f=a[0];const s=el('span');s.append(el('small','',f.currency),amount(f.total));return s}
function rest(a,word){if(!a)return null;const others=a.slice(1).map(x=>x.currency+' '+amount(x.total));const n=a.reduce((k,x)=>k+x.count,0);return [n+' '+word+(n===1?'':'s'),...others].join(' · ')}
function why(i){if(i.status==='paid')return 'Paid'+(i.paid_at?' '+day(i.paid_at):'');if(i.status==='ready')return 'All checks passed';if(i.status==='waiting_cfo')return 'Filed for the CFO\\'s Face ID';const f=i.findings.filter(x=>x.level!=='warn')[0]||i.findings[0];return f?f.detail.charAt(0).toUpperCase()+f.detail.slice(1):''}
function rows(){
  const list=$('#list');list.replaceChildren();
  const shown=all.filter(FILTERS.find(f=>f[0]===filter)[2]).slice().reverse();
  if(!all.length){list.append(el('div','empty',[el('b','','No invoices yet'),'Drop a PDF invoice or a saved e-mail above, or forward it to the watched folder.']));return}
  list.append(el('div','row th',[el('span','','Supplier'),el('span','','Invoice'),el('span','','Due'),el('span','amt','Amount'),el('span','','Status'),el('span','','Why'),el('span','')]));
  if(!shown.length){list.append(el('div','empty',[el('b','','Nothing here'),'No invoice is in this state right now.']));return}
  for(const i of shown){
    const a=el('a','row');a.href='/invoices/'+encodeURIComponent(i.id);
    const sup=el('span','sup',[i.vendor||'Unknown supplier']);sup.title=i.vendor;
    if(i.status==='ready'&&i.payable!==false){const cb=el('input','pick');cb.type='checkbox';cb.checked=picked.has(i.id);cb.setAttribute('aria-label','Pick '+(i.invoice_no||i.id)+' to pay with one Face ID');cb.onclick=(e)=>{e.preventDefault();e.stopPropagation();const on=!picked.has(i.id);if(on)picked.add(i.id);else picked.delete(i.id);setTimeout(()=>{cb.checked=on},0);bar()};sup.prepend(cb)}
    const no=el('span','no',[i.invoice_no||'(no number)',el('span','sub',i.id)]);no.title=i.invoice_no;
    const late=i.due_date&&i.due_date<today&&!['paid','rejected'].includes(i.status);
    const due=el('span','due num'+(late?' late':''),i.due_date?day(i.due_date):'–');
    const amt=el('span','amt',[el('span','c',i.currency),amount(i.total)||'–']);
    const w=why(i);const wy=el('span','why',w);wy.title=w;
    const st=chip(i.status,i.status_words);st.title=i.status_words;
    a.append(sup,no,due,amt,el('span','stc',[st]),wy,ic('chevron-right'));a.lastChild.className='go';
    list.append(a)}
}
// One Face ID for many: the picked ready invoices become one batch the CFO signs on the phone (each line its own payment).
function bar(){const ready=all.filter(i=>i.status==='ready'&&i.payable!==false);for(const id of [...picked])if(!ready.some(i=>i.id===id))picked.delete(id);
  const b=$('#batchbar');b.hidden=!ready.length;const sel=ready.filter(i=>picked.has(i.id));const tot={};for(const i of sel)tot[i.currency]=(tot[i.currency]||0)+Math.round(parseFloat(i.total)*100);
  const sums=Object.keys(tot).sort().map(c=>c+' '+amount((tot[c]/100).toFixed(2))).join(' · ');
  $('#batchwhat').replaceChildren(...(sel.length?[el('b','',sel.length+' picked'),' · '+sums]:['Pick ready invoices to pay them with one Face ID']));
  $('#batchpay').disabled=!sel.length;$('#batchall').style.display=sel.length===ready.length?'none':''}
$('#batchall').onclick=()=>{for(const i of all)if(i.status==='ready'&&i.payable!==false)picked.add(i.id);rows();bar()};
$('#batchpay').onclick=async()=>{const ids=[...picked];const btn=$('#batchpay');btn.disabled=true;
  try{const j=await post('/api/payables/batch',JSON.stringify({ids}),{'content-type':'application/json'});picked.clear();
    const left=j.not_planned.length?' Not filed: '+j.not_planned.map(x=>x.id+' ('+x.reason+')').join('; ')+'.':'';
    msg(j.batch?'Batch '+j.batch.proposal_id+': '+j.batch.count+' payment'+(j.batch.count===1?'':'s')+' wait for the CFO\\'s one Face ID on the phone.'+left:'Nothing was filed.'+left,j.batch&&!left?'ok':'bad');await load()}
  catch(e){msg(e.message,'bad');btn.disabled=false}};
function filters(){const bar=$('#filters');bar.querySelectorAll('.chip').forEach(c=>c.remove());for(const [k,label,fn] of FILTERS){const n=all.filter(fn).length;if(k!=='all'&&!n&&k!=='act')continue;const b=el('button','chip',[label,' ',el('b','',String(n))]);b.type='button';b.setAttribute('aria-pressed',String(filter===k));b.onclick=()=>{filter=k;filters();rows()};bar.append(b)}}
function more(x){
  const box=$('#more');box.replaceChildren();
  const spend=el('div','card mini',[el('h3','','Spend per supplier, last 90 days')]);const kv=el('div','kv');
  for(const s of x.spend_90d.slice(0,5))kv.append(el('span','',s.vendor+' ('+s.count+')'),el('span','',s.currency+' '+amount(s.total)));
  if(!x.spend_90d.length)kv.append(el('span','','Nothing booked yet'),el('span',''));spend.append(kv);
  const cost=el('div','card mini',[el('h3','','What paying cost')]);const kv2=el('div','kv');
  kv2.append(el('span','','Transfer fees'),el('span','',x.costs.swift_fees.length?x.costs.swift_fees.map(f=>f.currency+' '+amount(f.total)).join(', '):'none'));
  kv2.append(el('span','','Currency conversions'),el('span','',String(x.costs.fx.conversions)));
  kv2.append(el('span','','Median time to pay'),el('span','',x.time_to_pay.median_hours===null?'–':x.time_to_pay.median_hours+' h'));
  kv2.append(el('span','','Paid invoices'),el('span','',String(x.time_to_pay.paid)));cost.append(kv2);
  const rise=el('div','card mini',[el('h3','','Price changes')]);const kv3=el('div','kv');
  for(const r of x.price_rises)kv3.append(el('span','',r.vendor),el('span','','+'+r.change_pct+'% ('+r.currency+' '+amount(r.last)+')'));
  if(!x.price_rises.length)kv3.append(el('span','','No supplier raised its price'),el('span',''));rise.append(kv3);
  box.append(spend,cost,rise)}
async function load(){
  const [list,x]=await Promise.all([fetch('/api/payables/invoices').then(r=>r.json()),fetch('/api/payables/insights').then(r=>r.json())]);
  all=list;
  const tiles=$('#tiles');tiles.replaceChildren();
  const wait=x.waiting.waiting_cfo+x.waiting.needs_review+x.waiting.needs_vendor;
  const top=x.blocked.reasons.slice().sort((a,b)=>b.count-a.count)[0];
  tiles.append(
    sum(x.credits)?tile('Open','wallet',amounts(sum(x.open_net))||'None',rest(sum(x.open),'invoice')+' · after credit '+x.credits.map(a=>a.currency+' '+amount(a.total)).join(' · ')):tile('Open','wallet',amounts(sum(x.open))||'None',rest(sum(x.open),'invoice')||'Nothing to pay'),
    tile('Due in 7 days','calendar-range',amounts(sum(x.due_7))||'None',sum(x.due_30)?'30 days: '+x.due_30.map(a=>a.currency+' '+amount(a.total)).join(' · '):'Nothing due in 30 days'),
    tile('Overdue','clock',amounts(sum(x.overdue))||'None',sum(x.overdue)?rest(sum(x.overdue),'invoice'):'Every open invoice is in time',sum(x.overdue)?'alert':'calm'),
    tile('Waits for you','inbox',String(wait),x.waiting.waiting_cfo+' Face ID · '+x.waiting.needs_review+' check · '+x.waiting.needs_vendor+' supplier'),
    tile('Blocked','octagon-x',String(x.blocked.count),top?'Most: '+(REASON[top.code]||top.code.replace(/_/g,' ')):'Nothing blocked',x.blocked.count?'alert':'calm'));
  filters();rows();bar();more(x);
}
async function send(files){let n=0;for(const f of files){msg('Filing '+f.name+' …');try{const j=await post('/api/payables/documents',f,{'content-type':'application/octet-stream','x-filename':encodeURIComponent(f.name)});n++;msg(f.name+': '+(j.kind==='email'?j.results.length+' PDF(s) from the e-mail':j.kind==='duplicate_document'?'filed before, not again':j.invoice.id+', '+(j.invoice.status_words||j.invoice.status)),'ok')}catch(e){msg(f.name+': '+e.message,'bad')}}await load()}
$('#file').onchange=(e)=>send(e.target.files);
const drop=$('#drop');drop.ondragover=(e)=>{e.preventDefault();drop.classList.add('over')};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=(e)=>{e.preventDefault();drop.classList.remove('over');send(e.dataTransfer.files)};
$('#sync').onclick=async()=>{try{const j=await post('/api/payables/sync');msg(j.changed.length?j.changed.length+' invoice(s) changed':'Nothing changed','ok');load()}catch(e){msg(e.message,'bad')}};
load().catch(e=>msg('Could not load the invoices: '+e.message,'bad'));
`;

/** The overview: upload, the figures, the invoices. */
export function overviewPage(csrf: string, nonce: string, inboxAddress: string | null = null): string {
  // The company's own inbox address, when configured: invoices mailed there arrive here (Purser Cloud).
  const inbox = inboxAddress ? `<p class="inbox">${svg("mail", 16)} Mail invoices to <b class="mono">${escAttr(inboxAddress)}</b> <span class="sub2">· they arrive here, read and checked</span></p>` : "";
  return shell({ title: "Purser · Payables", csrf, nonce, body: OVERVIEW_BODY.replace("<!--inbox-->", inbox), script: OVERVIEW_SCRIPT });
}

const DETAIL_BODY = (id: string) => `
<a class="back" href="/">${svg("arrow-left", 16)} All invoices</a>
<div id="d" data-id="${escAttr(id)}"><p class="lede">Loading ${escAttr(id)} …</p></div>`;

const DETAIL_SCRIPT = `
const IC=${ICON_SET(["circle-check", "triangle-alert", "octagon-x", "clock", "circle-minus", "file-text", "external-link", "scan-face", "users", "ban", "sparkles", "bot", "info"])};
${COMMON}
const id=$('#d').dataset.id;
const RES={passed:['circle-check','Passed'],warn:['triangle-alert','Note'],wait:['clock','Waits'],review:['triangle-alert','Needs a person'],block:['octagon-x','Blocks payment'],not_checked:['circle-minus','Not checked']};
const SRC={upload:'Uploaded',email:'E-mail',folder:'Watched folder',api:'API'};
const dl=(pairs)=>{const d=el('dl','read');for(const [k,v,cls] of pairs){if(v===null||v===undefined||v==='')continue;d.append(el('dt','',k));const dd=el('dd',cls||'');if(v instanceof Node)dd.append(v);else dd.textContent=v;d.append(dd)}return d};
async function drawPdf(box){
  try{const {getDocument}=await import('/assets/pdfjs.mjs');
    const data=new Uint8Array(await (await fetch('/api/payables/invoices/'+encodeURIComponent(id)+'/document')).arrayBuffer());
    const doc=await getDocument({data,isEvalSupported:false,enableXfa:false,disableFontFace:false,useSystemFonts:false,stopAtErrors:false,verbosity:0}).promise;
    box.replaceChildren();
    for(let n=1;n<=Math.min(doc.numPages,6);n++){const page=await doc.getPage(n);const vp=page.getViewport({scale:2});const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;c.setAttribute('aria-label','Page '+n+' of the invoice');box.append(c);await page.render({canvasContext:c.getContext('2d'),viewport:vp,canvas:c}).promise}
    if(doc.numPages>6)box.append(el('p','wait',(doc.numPages-6)+' more page(s): open the PDF to see them'));
  }catch(e){box.replaceChildren(el('p','wait','The document could not be drawn here ('+e.message+'). Open the PDF instead.'))}
}
function render(d){
  const i=d.invoice,r=i.reading;
  const root=$('#d');root.replaceChildren();
  document.title='Purser · '+(i.vendor||'Invoice')+' '+(i.invoice_no||i.id);
  const late=i.due_date&&i.due_date<today&&!['paid','rejected'].includes(i.status);
  const head=el('div','dhead',[
    el('div','who',[el('h1','',i.vendor||'Unknown supplier'),el('div','meta',[chip(i.status,i.status_words),el('span','','Invoice '+(i.invoice_no||'(no number)')),el('span','','·'),el('span','',i.id),el('span','','·'),el('span','',(SRC[d.document.source]||d.document.source)+' '+day(i.received_at))])]),
    el('div','money',[el('div','big',[el('small','',i.currency),amount(i.total)||'–']),el('div','when',i.status==='paid'&&i.paid_at?'Paid '+day(i.paid_at):i.due_date?(late?'Was due ':'Due ')+day(i.due_date):'No due date')])]);
  // Actions
  const bar=el('div','card actions');
  const pay=el('button','btn primary big',[ic('scan-face'),'Pay with the CFO\\'s Face ID']);pay.type='button';pay.disabled=!d.actions.pay.allowed;
  const sup=el('button','btn big',[ic('users'),'Request supplier']);sup.type='button';sup.disabled=!d.actions.supplier_request.allowed;
  const rej=el('button','btn danger big',[ic('ban'),'Reject']);rej.type='button';rej.disabled=!d.actions.reject.allowed;
  const note=el('div','note');
  const closed=d.actions.pay.allowed?null:d.actions.pay.why;
  const bnote=d.batch?el('span','batchnote',[ic('scan-face'),' In batch '+d.batch.id+' of '+d.batch.count+' payment'+(d.batch.count==='1'?'':'s')+(d.batch.waiting?': it waits for the CFO\\'s one Face ID for the whole batch. ':' ('+d.batch.status.toLowerCase().replace(/_/g,' ')+'). ')]):null;if(bnote)note.append(bnote);
  note.append(d.actions.pay.allowed?el('span','',['Files the payment; ',el('b','','nothing moves until the CFO approves it with Face ID'),' on the phone.']):el('span','',['Pay: ',closed.charAt(0).toUpperCase()+closed.slice(1)+'.']));
  const status=el('p','');status.setAttribute('role','status');status.style.cssText='margin:0;flex-basis:100%;font-size:14px';
  // A paid, rejected or filed invoice has nothing left to do here: the bar says where it stands instead of showing dead buttons.
  const done=['paid','rejected','waiting_cfo'].includes(i.status);
  if(done){note.replaceChildren(el('span','',[el('b','',i.status==='paid'?'Paid'+(i.paid_at?' on '+day(i.paid_at):''):i.status==='rejected'?'Rejected':'Waits for the CFO\\'s Face ID'),i.proposal_id?' · payment '+i.proposal_id:'',i.status==='paid'?' · paid through the Airwallex sandbox.':i.status==='waiting_cfo'?' · the CFO approves or rejects it on the phone.':' · it is never paid.']))}
  if(done&&bnote)note.prepend(bnote);
  bar.append(...(done?[]:d.actions.supplier_request.allowed?[sup,pay,rej]:[pay,rej]),note,status);
  const box=el('div','card rejectbox');const ta=document.createElement('textarea');ta.placeholder='Why is this invoice rejected? (kept with the invoice and in the audit log)';ta.maxLength=300;
  const go=el('button','btn danger',['Reject this invoice']);go.type='button';const cancel=el('button','btn',['Cancel']);cancel.type='button';
  box.append(el('b','','Reject '+(i.invoice_no||i.id)+': it will never be paid.'),ta,el('div','row2',[go,cancel]));
  const say=(t,bad)=>{status.textContent=t;status.style.color=bad?'var(--bad)':'var(--ok)'};
  pay.onclick=async()=>{pay.disabled=true;try{const j=await post('/api/payables/invoices/'+encodeURIComponent(id)+'/pay');say(j.kind==='proposed'?'Filed as '+j.proposal_id+': it waits for the CFO\\'s Face ID on the phone.':'Not filed: '+j.reason,j.kind!=='proposed');setTimeout(load,900)}catch(e){say(e.message,true);pay.disabled=false}};
  sup.onclick=async()=>{sup.disabled=true;try{const j=await post('/api/payables/invoices/'+encodeURIComponent(id)+'/supplier-request');say(j.add_id+' requested: a person now verifies the bank details with the supplier on a number already on file (npm run payables -- supplier-verify).');setTimeout(load,900)}catch(e){say(e.message,true);sup.disabled=false}};
  rej.onclick=()=>{box.classList.toggle('open');ta.focus()};cancel.onclick=()=>box.classList.remove('open');
  go.onclick=async()=>{go.disabled=true;try{await post('/api/payables/invoices/'+encodeURIComponent(id)+'/reject',JSON.stringify({reason:ta.value}),{'content-type':'application/json'});await load()}catch(e){say(e.message,true);go.disabled=false}};
  // Document
  const pages=el('div','pages',[el('p','wait','Drawing the document …')]);
  const open=el('a','',[ic('external-link'),'Open PDF']);open.href='/api/payables/invoices/'+encodeURIComponent(id)+'/document';open.target='_blank';open.rel='noopener';
  const docv=el('div','card docv',[el('div','bar2',[ic('file-text'),el('span','fn',d.document.filename||'document.pdf'),open]),pages]);
  // What Purser read
  const line=d.total_line?el('span','',d.total_line):null;
  const payTo=r.iban?'IBAN '+r.iban+(r.bic?' · BIC '+r.bic:''):r.account_number?'Account '+r.account_number+(r.routing_value?' · '+r.routing_type.toUpperCase().replace('_',' ')+' '+r.routing_value:''):'';
  const read=el('div','card panel',[el('h2','',['What Purser read',el('span','cnt',i.read_by==='parser'?'Read by Purser\\'s code':'Read by '+i.read_by)]),dl([
    ['Supplier',i.vendor],['VAT ID',r.vat_id],['Invoice number',i.invoice_no],['Invoice date',day(i.issue_date)],['Due date',day(i.due_date)],
    ['Subtotal',i.subtotal?i.currency+' '+amount(i.subtotal):''],['VAT',i.tax?i.currency+' '+amount(i.tax):''],['Total',i.total?i.currency+' '+amount(i.total):''],
    ['On the invoice',line,'line'],['Pay to',payTo,'mono'],['Bank country',r.bank_country],['Reference',r.reference],['Booked to',i.gl_account?(i.gl_account+(i.gl_rule?' · '+i.gl_rule:'')):'']])]);
  // Checks
  const ul=el('ul','checks');let passed=0;
  for(const c of d.checks){const [icon,word]=RES[c.result];if(c.result==='passed')passed++;const li=el('li','',[el('span','ic res-'+c.result),el('span','t',c.title),el('span','r res-'+c.result,word)]);li.firstChild.innerHTML=IC[icon];for(const w of c.reasons)li.append(el('span','why',w.charAt(0).toUpperCase()+w.slice(1)));ul.append(li)}
  const checks=el('div','card panel',[el('h2','',['Checks',el('span','cnt',passed+' of '+d.checks.length+' passed')]),ul]);
  // Note
  const by=i.review_by||'';const noteCard=i.review_note?el('div','card notecard',[el('div','who',by.startsWith('claude:')?'Note by '+by.slice(7)+' (advisory, changes nothing)':'Note by Purser\\'s code'),el('p','',i.review_note)]):null;
  // Timeline
  const ol=el('ol','tl');for(const t of d.timeline)ol.append(el('li','',[el('div','',[el('span','w',t.what),el('span','at',stamp(t.at))]),t.detail?el('div','d',t.detail.charAt(0).toUpperCase()+t.detail.slice(1)):null]));
  const tl=el('div','card panel',[el('h2','','Timeline'),ol]);
  root.append(head,el('div','banner',[ic('info'),'Test money: this build pays only through the Airwallex sandbox. No real money moves.']),bar,box,el('div','split',[docv,el('div','stack',[read,checks,noteCard,tl])]));
  drawPdf(pages);
}
async function load(){const r=await fetch('/api/payables/invoices/'+encodeURIComponent(id)+'/detail');if(!r.ok){$('#d').replaceChildren(el('p','lede','No invoice '+id+'.'));return}render(await r.json())}
load().catch(e=>$('#d').replaceChildren(el('p','lede','Could not load '+id+': '+e.message)));
`;

/** One invoice: its document, what Purser read, every check, the note, the timeline and the actions. */
export function detailPage(csrf: string, nonce: string, id: string): string {
  return shell({ title: `Purser · ${id}`, csrf, nonce, body: DETAIL_BODY(id), script: DETAIL_SCRIPT });
}
