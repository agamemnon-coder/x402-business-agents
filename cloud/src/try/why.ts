// Why Purser holds or refuses, on the hands-on page (14 Nov, owner and a tester): the reason big and first, the evidence
// that triggered it side by side, the rule in one line, the details folded. The page's script carries this text as it
// is (WHY_JS), and test/try-why.test.ts runs the same text in Node. Every word comes from the copy (WHY, TAMPER in
// cloud/src/tryCopy.ts); every value comes from the engine's answer (the upload, the invoice, its findings and the
// evidence they carry: the earlier invoice, the signals with what the invoice asks beside what is on file). Plain
// script only: no TypeScript, no newer syntax than the page's.

/**
 * whyKit.whyOf(W, up, fmt): the held answer of screen 2, or null when the invoice is ready to pay.
 * - W: the copy (WHY). up: the upload's answer ({kind, sha256, invoice}). fmt: {money(cur, amount), date(iso)}.
 * - Returns {tone, code, head, rows, said, rule, words}: tone 'refuse' (a check refuses it), 'hold' (a person must
 *   look) or 'flag' (shown only); rows the evidence side by side, each [label, value, the part of it to mark: what
 *   differs, or '']; said the engine's own
 *   sentence when there is no side by side; rule the check in one line; words every finding's own sentence (the fold).
 * - The finding shown is the first of the most severe level (block, then wait, review, warn), as the engine ordered them.
 *
 * whyKit.tamperRows(signed, sent, changed, labels, fmt): the refused payment's side by side, one row per field the
 * visitor changed: [field label, signed value, sent value]; the amount as money. None changed: one row of the amount.
 */
export const WHY_JS = String.raw`
const whyKit=(()=>{
  const RANK={block:0,wait:1,review:2,warn:3};
  const str=(v)=>v===null||v===undefined?'':String(v);
  const fill=(s,o)=>str(s).replace(/\{(\w+)\}/g,(m,k)=>Object.prototype.hasOwnProperty.call(o,k)?str(o[k]):m);
  const cap=(s)=>{s=str(s).trim();return s?s[0].toUpperCase()+s.slice(1)+(/[.!?]$/.test(s)?'':'.'):''};
  const line=(W,x,fmt)=>{
    const paid=!!x.paid_at;
    return fill(paid?W.paidOn:W.issuedOn,{vendor:x.vendor,no:x.invoice_no,money:fmt.money(x.currency,x.total),date:fmt.date(paid?x.paid_at:x.issue_date)});
  };
  const rank=(l)=>RANK[l]!==undefined?RANK[l]:9;
  const pick=(fs)=>{let best=null;for(const f of fs){if(best===null||rank(f.level)<rank(best.level))best=f}return best};
  const toneOf=(code,level,W)=>{const h=str((W.codes[code]||{}).head);return /^Refused/.test(h)?'refuse':level==='warn'?'flag':'hold'};
  function whyOf(W,up,fmt){
    const inv=up&&up.invoice&&typeof up.invoice==='object'?up.invoice:null;
    if(up&&up.kind==='duplicate_document'&&inv){
      const paid=inv.status==='paid';
      return {tone:'hold',code:'duplicate_document',head:paid?W.again.head:W.again.headFiled,
        rows:[[paid?W.earlierPaid:W.earlier,line(W,inv,fmt),''],[W.thisOne,fill(W.sameFile,{sha:str(up.sha256).slice(0,12)}),'']],
        said:'',rule:W.again.rule,words:[]};
    }
    if(!inv||inv.payable===true||(inv.proposal&&inv.proposal.status==='PENDING_APPROVAL'))return null;
    const fs=Array.isArray(inv.findings)?inv.findings.filter((f)=>f&&typeof f.code==='string'):[];
    const words=fs.map((f)=>cap(f.message)).filter(Boolean);
    const f=pick(fs);
    if(!f)return {tone:'hold',code:'',head:W.other.head,rows:[],said:cap(inv.status_words),rule:'',words};
    const c=W.codes[f.code]||null;
    let head=c?c.head:W.other.head,rule=c&&c.rule?c.rule:'',rows=[],said='';
    if(f.earlier&&typeof f.earlier==='object'){
      const e=f.earlier;
      if(c&&c.headPaid&&e.paid_at)head=c.headPaid;
      const me={vendor:inv.vendor,invoice_no:inv.invoice_no,currency:inv.currency,total:inv.total,issue_date:inv.issue_date,paid_at:null};
      rows=[[e.paid_at?W.earlierPaid:W.earlier,line(W,e,fmt),''],[W.thisOne,line(W,me,fmt),str(e.invoice_no)!==str(inv.invoice_no)?str(inv.invoice_no):'']];
      if(f.code==='possible_duplicate'&&!f.twin_of&&c&&c.ruleLoose)rule=c.ruleLoose;
    }else if(f.code==='possible_fraud'&&Array.isArray(f.signals)){
      const first=f.signals.find((s)=>s&&W.codes[s.code]);
      if(first)head=W.codes[first.code].head;
      for(const s of f.signals)if(s&&typeof s.asked==='string')rows.push([W.onInvoice,s.asked,s.asked],[W.onFile,str(s.on_file),'']);
    }else if(f.code==='new_supplier'){
      rows=[[W.onInvoice,str(inv.vendor),str(inv.vendor)],[W.onFile,W.notOnFile,'']];
    }
    if(!rows.length)said=cap(f.message);
    return {tone:toneOf(f.code,f.level,W),code:f.code,head,rows,said,rule,words};
  }
  function tamperRows(signed,sent,changed,labels,fmt){
    const keys=['amount','beneficiary_name','iban_last4'];
    const named=Array.isArray(changed)?changed.map((x)=>typeof x==='string'?x:x&&typeof x.field==='string'?x.field:'').filter(Boolean):null;
    let ks=keys.filter((k)=>str(signed[k])!==str(sent[k]));
    if(named)ks=ks.filter((k)=>named.indexOf(k)>=0);
    if(!ks.length)ks=['amount'];
    const v=(k,o)=>k==='amount'?fmt.money(o.currency||signed.currency,o.amount):k==='iban_last4'?'…'+str(o[k]):str(o[k]);
    return ks.map((k)=>[labels[k]||k,v(k,signed),v(k,sent)]);
  }
  return {whyOf,tamperRows};
})();
`;
