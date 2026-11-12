// The Books screen's own parts (master list 137 and 134), as plain browser JavaScript the console includes, beside
// the report cards and the vault tree of cloud/src/consoleBooks.ts (cloud-demo-1112):
//   - the entries as a timeline: one line per document, newest first, with its amount, its party and its status;
//     the entries and their lines folded under it;
//   - the one line "Purser = T0 = Moneybird", from the recorded sandbox checks, computed on the server
//     (src/accounting/recordedChecks.ts) and put on the page as data. The tick shows only when the computed difference
//     is 0, and the label "Recorded sandbox check of …" stands right next to it.
// Every amount is computed from the ledger lines the cloud serves (GET /v1/ledger/entries). Nothing is typed in.

import { threeWayLine, type ThreeWayLine } from "../../src/accounting/recordedChecks.js";

/** What the page carries for the three-way line: the computed line, never a fixed sentence. */
export function booksViewData(line: ThreeWayLine = threeWayLine()): { three_way: { tick: boolean; text: string; label: string; differences: string[] } } {
  return { three_way: { tick: line.tick, text: line.text, label: line.label, differences: line.differences } };
}

export const BOOKS_VIEW_JS = String.raw`
// One line per document, newest first, from the ledger's entries: what the document amounts to, who it is with, and
// where it stands. A document is the doc_ref on its lines; an entry without one stands alone. An entry that was
// reversed and its reversal leave the totals together (both stay listed under the document).
function docTimeline(entries){
  const list=entries||[];
  const reversed=new Set(list.filter((e)=>e.reverses).map((e)=>e.reverses));
  const docs=new Map();
  for(const e of list){
    const refs=new Set((e.lines||[]).map((l)=>l.doc_ref).filter(Boolean));
    const key=refs.size===1?'doc:'+[...refs][0]:(e.doc_ref?'doc:'+e.doc_ref:'entry:'+e.entry_id);
    let d=docs.get(key);
    if(!d){d={key,doc_ref:key.startsWith('doc:')?key.slice(4):null,party:null,date:e.posting_date,owed:{},paid:{},due:{},received:{},moved:{},live:0,approval_sha256:null,rail_refs:[],entries:[]};docs.set(key,d)}
    d.entries.push(e);
    if(e.posting_date>d.date)d.date=e.posting_date;
    if(!d.approval_sha256&&e.approval_sha256)d.approval_sha256=e.approval_sha256;
    if(e.rail_ref&&!d.rail_refs.includes(e.rail_ref))d.rail_refs.push(e.rail_ref);
    for(const l of e.lines||[])if(l.party&&!d.party&&!/^Simulated financier/.test(l.party))d.party=l.party;
    if(e.reverses||reversed.has(e.entry_id))continue;
    d.live++;
    for(const l of e.lines||[]){
      const add=(m,c)=>{if(c)m[l.currency]=(m[l.currency]||0)+c};
      if(l.account==='2100'){add(d.owed,l.credit_cents);add(d.paid,l.debit_cents)}
      else if(l.account==='1300'){add(d.due,l.debit_cents);add(d.received,l.credit_cents)}
      add(d.moved,l.debit_cents);
    }
  }
  const out=[];
  for(const d of docs.values()){
    const open=(gross,settled)=>Object.keys(gross).reduce((n,c)=>n+gross[c]-(settled[c]||0),0);
    let kind,amount,status;
    if(!d.live){kind='entry';amount={};status='reversed'}
    else if(Object.keys(d.owed).length){kind='payable';amount=d.owed;status=open(d.owed,d.paid)<=0?'paid':'open'}
    else if(Object.keys(d.due).length){kind='receivable';amount=d.due;status=open(d.due,d.received)<=0?'received':'open'}
    else{kind='entry';amount=d.moved;status='booked'}
    const last=Math.max(...d.entries.map((e)=>e.entry_id));
    out.push({key:d.key,doc_ref:d.doc_ref,party:d.party,date:d.date,kind,amount,status,approval_sha256:d.approval_sha256,rail_refs:d.rail_refs,last,
      description:(d.entries[0]&&d.entries[0].description)||'',entries:d.entries.slice().sort((a,b)=>b.entry_id-a.entry_id)});
  }
  return out.sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:b.last-a.last);
}
`;
