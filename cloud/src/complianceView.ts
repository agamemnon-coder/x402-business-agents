// The Compliance section at the foot of the console's Company page (27 Nov): the runner's compliance evidence in short,
// from the snapshot it pushed (GET /v1/compliance, cloud/src/compliance.ts). Quiet and folded, as the authority map's
// section is (./authorityView.ts): a <details> whose summary is "Compliance evidence", and in it the period, one line per
// framework (with evidence, mapped with no records, documented, gaps), the controls that left no record, the gaps, and
// the runner's own line on what this is and is not. Semantic markup, the console's own classes, no styling of its own;
// every value set as text. Hidden while there is no snapshot.
//
// Runs inside the Company page's script (cloud/src/consoleCompany.ts), with the console's el, api and NL.

export const COMPLIANCE_JS = String.raw`
const COMP_W={en:{h:'Compliance evidence',from:'From the runner’s ledger, {from} to {to}: audit rows {a} to {b}.',fw:'{name}: {e} with evidence in the period, {n} mapped with no records, {d} documented, {g} gaps ({r} requirements)',
  idle:'Controls with no records in the period',gaps:'Gaps',check:'The signed evidence is made and checked on the runner: npm run compliance-evidence, npm run verify-compliance-evidence.'},
  nl:{h:'Bewijs voor compliance',from:'Uit het grootboek van de runner, {from} tot en met {to}: auditregels {a} tot {b}.',fw:'{name}: {e} met bewijs in de periode, {n} gekoppeld zonder regels, {d} gedocumenteerd, {g} hiaten ({r} eisen)',
  idle:'Controles zonder regels in de periode',gaps:'Hiaten',check:'Het getekende bewijs wordt op de runner gemaakt en gecontroleerd: npm run compliance-evidence, npm run verify-compliance-evidence.'}};
function compFill(s,v){return String(s).replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??''))}
function complianceBox(){
  const W=COMP_W[NL?'nl':'en'];
  const box=el('details','fine');box.hidden=true;
  api('/v1/compliance').then((r)=>r&&r.compliance||null,()=>null).then((s)=>{
    if(!s||!Array.isArray(s.frameworks))return;
    const short=(f)=>String(f.name||f.framework).split(',')[0];
    const idle=(s.controls||[]).filter((c)=>c&&c.status==='no-records-in-period');
    const names=Object.fromEntries((s.frameworks||[]).map((f)=>[f.framework,short(f)]));
    box.replaceChildren(...[el('summary','',W.h),
      el('p','',compFill(W.from,{from:s.period&&s.period.from,to:s.period&&s.period.to,a:s.audit&&s.audit.first_seq,b:s.audit&&s.audit.last_seq})),
      el('ul','',s.frameworks.map((f)=>el('li','',compFill(W.fw,{name:short(f),e:f.evidence_in_period,n:f.no_records_in_period,d:f.documented,g:f.gap,r:f.requirements})))),
      idle.length?el('p','',el('b','',W.idle)):null,idle.length?el('ul','',idle.map((c)=>el('li','',String(c.id)+' '+String(c.name)))):null,
      (s.gaps||[]).length?el('p','',el('b','',W.gaps)):null,(s.gaps||[]).length?el('ul','',s.gaps.map((g)=>el('li','',(names[g.framework]||String(g.framework))+' '+String(g.clause)+': '+String(g.gap)))):null,
      el('p','fine',String(s.note||'')),el('p','fine',W.check)].filter(Boolean));
    box.hidden=false});
  return box}
`;
