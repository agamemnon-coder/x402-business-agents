// The console's folder view (master list 476): "Verify this proof" and corrections, as plain browser JavaScript the
// console includes beside the vault tree of cloud/src/consoleBooks.ts (cloud-demo-1112), which draws the folders from
// GET /v1/vault (Company/Year/Quarter/Inkoopfacturen | Betalingen | Rapporten, src/vault/layout.ts). The bytes come from
// GET /v1/documents/{sha256}, the store the console already serves documents from.
//
// Verify this proof recomputes, in the browser:
//   - the file's SHA-256, against the hash the vault filed it under (one changed byte fails);
//   - for an invoice, that hash against the invoice's document hash on record and the ledger entry's doc_sha256;
//   - for a payment receipt, the CFO's Face ID hash: the signed approval must be APPROVED over exactly the terms hash,
//     and every ledger entry of the payment that names an approval hash must name that one.
// A check that has nothing to compare with says so ("not checked"); it never counts as passed.
//
// Corrections: the vault never overwrites a file. A corrected one is a new file "… (correctie N).pdf" beside the
// original; correctionsOf pairs each with the file it corrects, so the page shows it as a correction with its reference.

export const VAULT_VIEW_JS = String.raw`
async function proofSha256(buf){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',buf));let s='';for(const b of d)s+=b.toString(16).padStart(2,'0');return s}
const isSha=(x)=>/^[0-9a-f]{64}$/.test(String(x||''));
// One proof: the file as filed, its document or its payment's signed approval, and the ledger. Each check is ok,
// failed or not_checked; the proof holds only when none failed and the file itself matched.
function verifyProof(p){
  const checks=[];const add=(what,state,detail)=>checks.push({what,state,detail});
  const actual=String(p.bytes_sha256||'');const filed=String((p.file&&p.file.sha256)||'').toLowerCase();
  add('file',isSha(filed)&&actual===filed?'ok':'failed',{actual,filed});
  const entries=p.entries||[];
  if(p.file&&p.file.kind==='invoice'){
    const doc=p.document&&String(p.document.doc_sha256||'').toLowerCase();
    add('document',!isSha(doc)?'not_checked':doc===actual?'ok':'failed',{actual,on_record:doc||null});
    const named=entries.filter((e)=>isSha(e.doc_sha256));
    const same=named.filter((e)=>e.doc_sha256===actual);
    add('booked',!named.length?'not_checked':same.length?'ok':'failed',{entries:same.map((e)=>e.entry_id)});
  }
  if(p.file&&p.file.kind==='receipt'){
    const s=p.signed||null;
    const signed=s&&String(s.approved_sha256||s.terms_sha256||'').toLowerCase();
    const terms=s&&String(s.terms_sha256||'').toLowerCase();
    const faceId=!!s&&s.decision==='APPROVED'&&isSha(terms)&&signed===terms;
    add('face_id',!s?'not_checked':faceId?'ok':'failed',{terms_sha256:terms||null,signed_sha256:signed||null,method:s&&s.method||null});
    const linked=entries.filter((e)=>isSha(e.approval_sha256));
    add('ledger_approval',!linked.length?'not_checked':linked.every((e)=>e.approval_sha256===terms)?'ok':'failed',{entries:linked.map((e)=>({entry_id:e.entry_id,approval_sha256:e.approval_sha256}))});
  }
  const failed=checks.filter((c)=>c.state==='failed').length;
  return {ok:checks[0].state==='ok'&&failed===0,failed,checks};
}
// Each corrected file with the one it corrects: "X (correctie 2).pdf" corrects "X.pdf" in the same folder (src/vault/layout.ts).
function correctionsOf(files){
  const byPath=new Map((files||[]).map((f)=>[f.path,f]));const out=[];
  for(const f of files||[]){const m=/^(.*) \(correctie(?: (\d+))?\)(\.[A-Za-z0-9]+)$/.exec(f.path);if(!m)continue;
    const base=m[1]+m[3];const original=byPath.get(base)||null;out.push({path:f.path,sha256:f.sha256,number:m[2]?Number(m[2]):1,corrects:base,corrects_sha256:original?original.sha256:null,original_kept:!!original})}
  return out.sort((a,b)=>a.corrects<b.corrects?-1:a.corrects>b.corrects?1:a.number-b.number);
}
`;
