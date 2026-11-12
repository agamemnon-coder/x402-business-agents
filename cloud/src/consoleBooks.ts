// The console's Books and Vault arithmetic, as plain browser JavaScript with no page in it: the report cards' numbers
// (from the reports the cloud computes with the runner's own report code, cloud/src/read.ts), whether books, payments
// and signatures agree (the transactions register's own check), the closed months, the vault's folder tree and the
// document check (SHA-256 of the bytes, by the browser's own crypto). The console's script includes it as it is; the
// tests run the same text (test/cloud-books.test.ts), so what the page shows is what was tested.

export const BOOKS_JS = String.raw`
// Lowercase hex SHA-256 of the bytes, by the browser's own crypto.
async function sha256Hex(buf){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',buf));let s='';for(const b of d)s+=b.toString(16).padStart(2,'0');return s}
// "Verify this document": the hash of the bytes as downloaded, against the hash on record. A record that is not a
// SHA-256 never matches.
async function verifyBytes(buf,expected){const actual=await sha256Hex(buf);const want=String(expected||'').toLowerCase();return {match:/^[0-9a-f]{64}$/.test(want)&&actual===want,actual,expected:want}}
// Books, payments and signatures agree when every movement that moved is booked and matched, has the rail's proof
// and has its approval: the register's own check (GET /v1/transactions/summary), never a fixed answer.
function agreement(check){
  const c=check||{};
  const parts=[['unbooked',c.without_booking],['no_proof',c.without_proof],['unsigned',c.without_approval],['differs',c.amount_mismatch]].map(([k,ids])=>({k,ids:(ids||[]).slice()})).filter((p)=>p.ids.length);
  const unreconciled=c.unreconciled||0;const moved=c.moved||0;
  return {ok:moved>0&&!parts.length&&!unreconciled,nothing:moved===0&&!parts.length&&!unreconciled,moved,rows:c.rows||0,unreconciled,parts};
}
// The currencies of a report, EUR first, then by code.
const currencies=(m)=>Object.keys(m||{}).sort((a,b)=>a===b?0:a==='EUR'?-1:b==='EUR'?1:a<b?-1:1);
// The five report cards' numbers, in cents, from the cloud's reports (trial, pnl, balance, vat, payables).
function reportCards(r){
  const trial={};for(const x of (r.trial&&r.trial.rows)||[]){const c=trial[x.currency]||(trial[x.currency]={debit:0,credit:0});c.debit+=x.debit_cents;c.credit+=x.credit_cents}
  const pnl={};for(const [c,v] of Object.entries((r.pnl&&r.pnl.by_currency)||{}))pnl[c]={revenue:v.revenue_cents,expense:v.expense_cents,result:v.result_cents};
  const bal={};for(const [c,v] of Object.entries((r.balance&&r.balance.by_currency)||{}))bal[c]={assets:v.assets_cents,liabilities:v.liabilities_cents,equity:v.equity_cents,result:v.result_cents,balanced:!!v.balanced};
  const pay={};for(const [c,b] of Object.entries((r.payables&&r.payables.totals)||{})){const open=Object.values(b).reduce((n,x)=>n+x,0);pay[c]={open,overdue:open-(b['not due']||0)}}
  const v=r.vat||{};
  return {
    trial:{by:trial,currencies:currencies(trial),balanced:Object.values(trial).every((x)=>x.debit===x.credit),to:r.trial&&r.trial.to},
    pnl:{by:pnl,currencies:currencies(pnl),from:r.pnl&&r.pnl.from,to:r.pnl&&r.pnl.to},
    balance:{by:bal,currencies:currencies(bal),balanced:Object.values(bal).every((x)=>x.balanced),to:r.balance&&r.balance.to},
    vat:{quarter:v.quarter,owed:v.owed_5a_cents||0,input:v.input_5b_cents||0,balance:v.balance_5c_cents||0,uncoded:v.uncoded_lines||0},
    payables:{by:pay,currencies:currencies(pay),items:((r.payables&&r.payables.items)||[]).length,as_of:r.payables&&r.payables.as_of},
  };
}
// The period the cards cover: up to the last booking (the same numbers as up to today, as nothing is booked after it),
// from the first of its year. Open payables are aged on today, except in a test world, whose time stands still at its
// last booking.
function period(lastPosting,today,demo){
  const end=/^\d{4}-\d{2}-\d{2}$/.test(lastPosting||'')?lastPosting:today;
  return {end,from:end.slice(0,4)+'-01-01',quarter:end.slice(0,4)+'Q'+Math.ceil(Number(end.slice(5,7))/3),as_of:demo?end:today};
}
// The months that are closed: the vault files a month's report only once the month is closed and locked.
function closedMonths(files){return [...new Set((files||[]).filter((f)=>f.kind==='month').map((f)=>(/^month:(\d{4}-\d{2})$/.exec(f.key||'')||[])[1]).filter(Boolean))].sort()}
// The vault's folders as it stores them: each path's folders, in order, with the files in each.
function vaultTree(files){
  const root={name:'',path:'',folders:[],files:[],count:0};
  for(const f of files||[]){const parts=String(f.path).split('/');let at=root;at.count++;
    for(const p of parts.slice(0,-1)){let n=at.folders.find((x)=>x.name===p);if(!n){n={name:p,path:(at.path?at.path+'/':'')+p,folders:[],files:[],count:0};at.folders.push(n)}n.count++;at=n}
    at.files.push(Object.assign({},f,{name:parts[parts.length-1]}))}
  return root;
}
// The vault's own Dutch names (src/vault/layout.ts), each with the word an English reader gets beside it.
const DUTCH_NAMES=[[/^Inkoopfacturen$/,'purchase_invoices'],[/^Betalingen$/,'payments'],[/^Rapporten$/,'reports'],[/^_Geblokkeerd$/,'blocked'],
  [/ Maandrapport\.pdf$/,'month_report'],[/ Btw-overzicht\.pdf$/,'vat_overview'],[/ Jaarrapport\.pdf$/,'year_report'],[/^Leveranciers .*\.pdf$/,'suppliers'],[/ \(correctie( \d+)?\)\.pdf$/,'correction']];
function dutchName(name){for(const [re,k] of DUTCH_NAMES)if(re.test(String(name||'')))return k;return null}
// What a booking was, in plain words, from the key the runner booked it under (src/ledger/feed.ts: the source, its id,
// the account, the bank account, the currency; a fee is a transfer's line on 6800).
function entryKind(e){const k=String((e&&e.source_key)||'');const p=k.split('|');
  if(e&&e.reverses)return 'reversal';if(/^close-year:/.test(k))return 'closing';
  if(p[0]==='ap-accrual')return 'received';if(p[0]==='transfer')return p[2]==='6800'?'fee':'paid';if(p[0]==='platform_fee')return 'fee';
  if(p[0]==='fx')return 'converted';if(p[0]==='opening')return 'opening';return 'other'}
`;
