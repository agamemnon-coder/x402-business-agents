// The transactions page (src/servers/payables.ts at /transactions): the register of every money movement Purser knows
// (src/money/register.ts), on every rail. The same design, rules and script discipline as the payables pages: one
// module script with the response's nonce, every value rendered with textContent, nothing posted from here.

import { COMMON, ICON_SET, shell, svg } from "./payablesPage.js";

const BODY = `
<div class="head"><div><h1>Transactions</h1><p class="lede">Every money movement Purser knows, on every rail: what moved, under whose approval, how it is booked and how it proves itself.</p></div>
<div class="tools"><a class="btn" id="csv" href="/api/payables/export/transactions.csv">${svg("download", 16)} CSV</a><a class="btn" id="json" href="/api/payables/export/transactions.json">${svg("download", 16)} JSON</a></div></div>
<p id="msg" role="status"></p>
<div class="tiles" id="tiles"></div>
<section class="section"><div class="bar" id="filters"><h2>Register</h2></div>
<div class="bar"><select class="sel" id="period" aria-label="Period"><option value="all">All dates</option><option value="month">This month</option><option value="30">Last 30 days</option></select>
<select class="sel" id="currency" aria-label="Currency"><option value="">All currencies</option></select>
<select class="sel" id="rec" aria-label="Reconciliation"><option value="">Every state</option><option value="attention">Needs attention</option><option value="matched">Booked and matched</option><option value="not_applicable">Nothing moved</option></select>
<span class="grow"></span><input class="search" id="q" type="search" placeholder="Search supplier, invoice, proof" aria-label="Search"></div>
<div class="card list" id="list"></div></section>
<p class="foot">Test money only: every Airwallex movement here is in the Airwallex sandbox, every Metal movement on Metal's testnet. Derived from the records on this computer; nothing is stored twice.</p>
<div class="scrim" id="scrim"></div><aside class="drawer" id="drawer" aria-label="Transaction" aria-hidden="true"></aside>`;

const SCRIPT = `
const IC=${ICON_SET(["arrow-down-left", "arrow-up-right", "arrow-left-right", "chevron-right", "triangle-alert", "circle-check", "wallet", "receipt", "landmark", "shield-alert", "x", "external-link"])};
${COMMON}
let all=[],totals=[],check=null,railF='all';
const RAILS=[['all','All'],['airwallex_transfer','Transfers'],['airwallex_fx','FX'],['airwallex_card','Cards'],['airwallex_airi','Airi'],['airwallex_receipt','Money in'],['metal','Metal'],['metal_clearing','Metal clearing']];
const FLAG={no_approval:'Money moved without the CFO\\'s approval on file.',no_booking:'Money moved and the ledger does not book it yet (sync the ledger, or this rail is not booked).',no_proof:'Recorded as moved, but there is no proof from the rail (no Airwallex id or transaction hash).',amount_mismatch:'The booking\\'s bank lines differ from the amount moved.',booked_not_moved:'Something is booked although no money moved.'};
const isIn=(r)=>r.direction==='in'||/\\((bought|into the wallet)\\)$/.test(r.description)||r.id.startsWith('credit:');
function periodOk(r){const v=$('#period').value;if(v==='all')return true;if(v==='month')return r.at.slice(0,7)===today.slice(0,7);const d=new Date(Date.now()-30*86400000).toISOString().slice(0,10);return r.at.slice(0,10)>=d}
function shown(){const cur=$('#currency').value,rec=$('#rec').value,q=$('#q').value.trim().toLowerCase();
  return all.filter(r=>(railF==='all'||r.rail===railF)&&(!cur||r.currency===cur)&&periodOk(r)&&(!rec||(rec==='attention'?(r.moved&&r.reconciliation!=='matched')||r.flags.length:r.reconciliation===rec))
    &&(!q||[r.id,r.counterparty,r.description,r.proof||'',r.invoice?r.invoice.supplier_no:''].some(s=>String(s).toLowerCase().includes(q))))}
function tile(label,icon,value,extra,tone){const t=el('div','card tile'+(tone?' '+tone:''));const l=el('div','l',[ic(icon),label]);const v=el('div','v num');if(value instanceof Node)v.append(value);else v.textContent=value;t.append(l,v);if(extra)t.append(el('div','x',extra));return t}
function sums(rows,pick){const m=new Map();for(const r of rows){const k=pick(r);if(!k)continue;const c=Math.round(Number(k.amount)*100);m.set(k.currency,(m.get(k.currency)||0)+c)}return [...m.entries()].sort((a,b)=>b[1]-a[1]).map(([currency,c])=>({currency,total:(c/100).toFixed(2)}))}
function first(a,none){if(!a.length)return none;const s=el('span');s.append(el('small','',a[0].currency),amount(a[0].total));return s}
const others=(a)=>a.slice(1).map(x=>x.currency+' '+amount(x.total)).join(' · ');
function tiles(){const t=$('#tiles');t.replaceChildren();const month=all.filter(r=>r.moved&&r.at.slice(0,7)===today.slice(0,7));
  const ins=sums(month.filter(r=>r.direction==='in'),r=>r),outs=sums(month.filter(r=>r.direction==='out'),r=>r),fees=sums(month,r=>r.fee);
  const open=all.filter(r=>r.moved&&r.reconciliation!=='matched');const noAppr=check?check.without_approval.length:0;
  const why=[['missing_booking','not booked'],['missing_rail_record','no proof'],['amount_mismatch','differ']].map(([k,w])=>{const n=all.filter(r=>r.reconciliation===k).length;return n?n+' '+w:null}).filter(Boolean).join(' · ');
  t.append(tile('In this month','arrow-down-left',first(ins,'None'),others(ins)||(ins.length?'':'No money in yet')),
    tile('Out this month','arrow-up-right',first(outs,'None'),others(outs)||(outs.length?'':'Nothing paid yet')),
    tile('Fees this month','receipt',first(fees,'None'),others(fees)||'What the rails charged'),
    tile('Not reconciled','shield-alert',String(open.length),why||'Every movement booked and matched',open.length?'alert':'calm'),
    tile('Without approval','landmark',String(noAppr),noAppr?'Money moved with no approval on file':'Every payment carries its approval',noAppr?'alert':'calm'))}
function filters(){const bar=$('#filters');bar.querySelectorAll('.chip').forEach(c=>c.remove());for(const [k,label] of RAILS){const n=k==='all'?all.length:all.filter(r=>r.rail===k).length;if(k!=='all'&&!n)continue;const b=el('button','chip',[label,' ',el('b','',String(n))]);b.type='button';b.setAttribute('aria-pressed',String(railF===k));b.onclick=()=>{railF=k;filters();rows()};bar.append(b)}}
function statusChip(r){const cls=r.moved?'moved':/^(failed|declined|refused|aborted|settlement failed)/.test(r.status_words)?'void':'idle';const s=chip(cls,r.status_words);s.title=r.status_words;return s}
function recChip(r){const s=chip(r.reconciliation,r.reconciliation_words);s.title=r.reconciliation_words;return s}
function rows(){const list=$('#list');list.replaceChildren();
  if(!all.length){list.append(el('div','empty',[el('b','','No money has moved yet'),'Payouts, card charges, conversions and Metal payments appear here as they happen.']));return}
  list.append(el('div','trow th',[el('span','','Date'),el('span','','What'),el('span','','Rail'),el('span','amt','Amount'),el('span','','Status'),el('span','','Books'),el('span','')]));
  const rs=shown();if(!rs.length){list.append(el('div','empty',[el('b','','Nothing here'),'No movement matches these filters.']));return}
  for(const r of rs){const b=el('button','trow');b.type='button';b.onclick=()=>open(r.id);
    const dir=el('span','dir '+(isIn(r)?'in':'out'));dir.append(ic(r.direction==='internal'?'arrow-left-right':isIn(r)?'arrow-down-left':'arrow-up-right'));
    const what=el('span','what',[dir,r.counterparty||r.description]);what.append(el('span','sub',r.description+(r.invoice&&r.invoice.ap_id?' · '+r.invoice.ap_id:'')));what.title=r.description;
    const amt=el('span','amt'+(!r.moved?' void':isIn(r)?' in':''),[el('span','c',r.currency),(r.moved?(isIn(r)?'+':'−'):'')+amount(r.amount)]);
    const rail=el('span','rail',[r.rail_label,el('span','sub',r.proof?String(r.proof).slice(0,18)+(String(r.proof).length>18?'…':''):'no proof')]);
    b.append(el('span','when',day(r.at)),what,rail,amt,el('span','stc',[statusChip(r)]),el('span','recc',[recChip(r)]),ic('chevron-right'));b.lastChild.className='go';list.append(b)}}
const dl=(pairs)=>{const d=el('dl','read');for(const [k,v,cls] of pairs){if(v===null||v===undefined||v==='')continue;d.append(el('dt','',k));const dd=el('dd',cls||'');if(v instanceof Node)dd.append(v);else dd.textContent=v;d.append(dd)}return d};
function open(id){const r=all.find(x=>x.id===id);if(!r)return;history.replaceState(null,'','#'+encodeURIComponent(id));
  const d=$('#drawer');d.replaceChildren();const x=el('button','btn x');x.type='button';x.setAttribute('aria-label','Close');x.append(ic('x'));x.onclick=close;
  const big=el('div','big num',[el('small','',r.currency),(r.moved?(isIn(r)?'+':'−'):'')+amount(r.amount)]);
  d.append(x,el('div','kicker',r.rail_label+' · '+(r.direction==='internal'?'between own accounts':r.direction==='in'?'money in':'money out')),el('h2','',r.counterparty||r.description),big,el('div','chips',[statusChip(r),recChip(r)]));
  for(const f of r.flags)d.append(el('div','flag',[ic('triangle-alert'),FLAG[f]||f]));
  if(r.moved&&!r.flags.length)d.append(el('div','flag ok',[ic('circle-check'),'Moved, approved as required, booked and proven by the rail.']));
  const inv=r.invoice?(r.invoice.ap_id?(()=>{const a=el('a','',r.invoice.supplier_no+' · '+r.invoice.ap_id);a.href='/invoices/'+encodeURIComponent(r.invoice.ap_id);return a})():r.invoice.supplier_no):null;
  const sec=(title,node)=>{const s=el('section');s.append(el('h3','',title),node);d.append(s)};
  sec('Movement',dl([['When',stamp(r.at)],['What',r.description],['Counterparty',r.counterparty],['Account',r.counterparty_account,'mono'],['Amount',r.currency+' '+amount(r.amount)],['In euro',r.eur_equivalent&&r.currency!=='EUR'?'EUR '+amount(r.eur_equivalent):null],['Fee',r.fee?r.fee.currency+' '+amount(r.fee.amount):null],['Status',r.status_words],['Invoice',inv]]));
  const a=r.approval;sec('Approval',dl([['Authority',a.authority],['Proposal',a.proposal_id,'mono'],['Decision',a.decision?a.decision.toLowerCase()+(a.method?' with '+(a.method==='passkey'?'Face ID (passkey)':a.method):''):(a.required?'none on file':null)],['When',a.approved_at?stamp(a.approved_at):null],['Terms hash',a.terms_sha256?a.terms_sha256.slice(0,16)+'…':null,'mono']]));
  sec('Books',dl([['State',r.reconciliation_words],['Ledger entries',r.booking.entry_ids.length?r.booking.entry_ids.join(', '):'none'],['Accounts',r.booking.accounts.join(', ')],['Bank lines',r.booking.booked?r.currency+' '+amount(r.booking.booked):null]]));
  sec('Proof',dl([['From the rail',r.proof||'none','mono'],['Register id',r.id,'mono']]));
  d.classList.add('open');d.setAttribute('aria-hidden','false');$('#scrim').classList.add('open');x.focus()}
function close(){$('#drawer').classList.remove('open');$('#drawer').setAttribute('aria-hidden','true');$('#scrim').classList.remove('open');history.replaceState(null,'',location.pathname)}
$('#scrim').onclick=close;document.addEventListener('keydown',(e)=>{if(e.key==='Escape')close()});
for(const s of ['#period','#currency','#rec'])$(s).onchange=rows;$('#q').oninput=rows;
async function load(){const j=await fetch('/api/payables/transactions').then(r=>{if(!r.ok)throw new Error(r.statusText);return r.json()});
  all=j.rows;totals=j.totals;check=j.check;
  const cur=$('#currency');for(const t of totals){const o=document.createElement('option');o.value=t.currency;o.textContent=t.currency;cur.append(o)}
  tiles();filters();rows();const h=decodeURIComponent(location.hash.slice(1));if(h)open(h)}
load().catch(e=>{const m=$('#msg');m.textContent='Could not load the transactions: '+e.message;m.className='bad'});
`;

export function transactionsPage(csrf: string, nonce: string): string {
  return shell({ title: "Purser · Transactions", csrf, nonce, body: BODY, script: SCRIPT, page: "transactions" });
}
