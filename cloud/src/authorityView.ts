// The Authority section under each agent's card on the console's Agents page (26 Nov): who may pay what, from the
// authority map the runner pushed (GET /v1/authority-map, cloud/src/authorityMap.ts). Quiet and folded: a <details>
// whose summary is "Authority", and in it one short block per kind of payment (what, then a definition list: rail, per
// payment, in all, from, to, when, under which grant, what needs the CFO). Semantic markup, the console's own classes
// (fine, the read definition list) and no styling of its own, so a restyle of the console carries it. Every value is set
// as text. Hidden while there is no map, or for an agent the map does not name.
//
// Runs inside the Agents page's script (cloud/src/agentWallet.ts), with the console's el, dl, api and NL.

export const AUTHORITY_JS = String.raw`
const AUTH_W={en:{h:'Authority',rail:'Rail',per:'Per payment',all:'In all',from:'From',to:'To',when:'When',under:'Under',cfo:'Needs the CFO',src:'From the runner’s policy, read {at}'},
  nl:{h:'Bevoegdheid',rail:'Rail',per:'Per betaling',all:'In totaal',from:'Van',to:'Aan',when:'Wanneer',under:'Op grond van',cfo:'Naar de CFO',src:'Uit het beleid van de runner, gelezen {at}'}};
let AUTH_MAP=null,AUTH_AT=0;
function authorityOf(id){
  const W=AUTH_W[NL?'nl':'en'];
  const box=el('details','fine');box.hidden=true;
  if(!AUTH_MAP||Date.now()-AUTH_AT>30000){AUTH_AT=Date.now();AUTH_MAP=api('/v1/authority-map').then((r)=>r&&r.authority_map||null,()=>null)}
  AUTH_MAP.then((m)=>{
    const a=m&&Array.isArray(m.agents)?m.agents.find((x)=>x&&x.agent===id):null;
    if(!a||!Array.isArray(a.rows)||!a.rows.length)return;
    box.replaceChildren(el('summary','',W.h),...a.rows.map((r)=>el('div','',[el('p','',el('b','',String(r.what))),
      dl([[W.rail,r.rail],[W.per,r.per_payment],[W.all,r.in_all],[W.from,r.from],[W.to,r.to],[W.when,r.when],[W.under,r.under],[W.cfo,r.needs_cfo]])])),
      el('p','fine',W.src.split('{at}').join(String(m.generated_at||'').slice(0,16).replace('T',' '))));
    box.hidden=false});
  return box}
`;
