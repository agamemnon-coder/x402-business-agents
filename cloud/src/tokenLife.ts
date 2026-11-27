// Tokenisation as the future of how agents pay (23 Nov, the owner: "for tokenisation it needs more: it is a nice visual
// but this will be the future, so think critically"). The page used to show one invoice token. It now leads with what
// changes for a business: every agent purchase gets its own credential, bound to one amount and one merchant, used once,
// and refused when presented again. Two recorded runs show it, each with its own label, nothing beyond them:
//   - vic-5 (docs/runs/2026-11-14-vic-5.json): Airi's single-use credential on Airi's test card (Airi reports token_type
//     DPAN; not a Visa network token Purser holds; review 21 Nov), via Airwallex's Airi wallet in the Airwallex sandbox. The CFO's Face ID, Airi's mandate for EUR 45.00 at one merchant with Purser's terms hash read back, one
//     payment, then the same credential refused for another amount and for a second use, before any Airwallex call;
//   - the partner-rails run (docs/runs/2026-11-20-partner-rails.json): Purser's own agent tokens over the agents'
//     Airwallex sandbox cards, each bound to a mandate made from the CFO's limits; the misuse its record refused.
// Ids are masked (the first eight and the last four characters); no credential, token or card number is in either record.
// No Visa mark on this page (review 21 Nov): the card says "Airi's test card" in text.
//
// TOKEN_LIFE_JS goes into the console at __UI__ (cloud/src/console.ts) and draws with its el(), ic(), cur() and day();
// tokensView (cloud/src/consoleUi.ts) calls tokenLifeSections(r.token_life) before the invoice token.

import VIC from "../../docs/runs/2026-11-14-vic-5.json" with { type: "json" };
import { partnerFromRecord } from "./partnerRails.js";

const REPO = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
/** An id with its middle left out: the first eight and the last four characters. */
export const maskId = (id: string | null | undefined): string | null => (id ? (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id) : null);

interface VicAudit { seq: number; ts: string; event: string; payload: Record<string, unknown> }
interface VicPurchase { step: string; what: string; request: { amount: string; currency: string; merchant: string }; rail_choice: { by?: string; model?: string } | null; proposal_id: string | null; mandate_id: string | null; payment_intent_id: string | null; terms_sha256: string | null; read_back: { mandate?: { equal?: boolean }; payment_intent?: { equal?: boolean } } | null; outcome: { status?: string; code?: string; reason?: string } | null; calls: { anthropic: number; airwallex: number; airi: number } }
interface VicRecord { run: string; mode: string; label: string; started_at: string; preflight: { cli: string; card: string }; purchases: VicPurchase[]; audit: VicAudit[]; credential_deleted: boolean; earlier_attempt?: { started_at: string; outcome: { code?: string; reason?: string } } }

export interface TokenLife {
  vic: {
    label: string; run: string; cli: string; record: string; story: string;
    card: { network: string; last4: string | null };
    purchase: { agent: string; model: string | null; amount: string; currency: string; merchant: string; proposal: string | null };
    steps: { key: "issue" | "bind" | "use" | "reuse"; at: string | null; ok: boolean; id: string | null; code: string | null }[];
    token: { type: string | null; expires: string | null; terms: string | null; deleted: boolean };
    misuse: { key: string; amount: string; currency: string; merchant: string; code: string; calls: number }[];
    first_try: { at: string; code: string | null } | null;
  };
  agent_tokens: {
    label: string; record: string | null;
    tokens: { agent: string; id: string; last4: string; card_last4: string; status: string; currency: string; per_purchase: string | null; per_month: string | null; mccs: string[]; expires_at: string | null; used: number; refused: string[] }[];
    /** Misuse a rail refused, not Purser (the card number charged without the token). */
    rail_refusals: { code: string; by: string }[];
  };
}

export function tokenLifeOf(v: VicRecord = VIC as unknown as VicRecord): TokenLife {
  const b = v.purchases.find((p) => p.step === "B")!;
  const ev = (event: string, pred: (p: Record<string, unknown>) => boolean = () => true) => [...v.audit].reverse().find((a) => a.event === event && pred(a.payload));
  const forB = (p: Record<string, unknown>) => p.action_id === b.proposal_id;
  const created = ev("airi.mandate_created", forB), readBack = ev("airi.mandate_read_back", forB), cred = ev("airi.credential_received", forB), result = ev("airi.checkout_result", forB);
  const reuse = ev("vic3.credential_check", (p) => p.refused === "PURSER_CREDENTIAL_ALREADY_USED");
  const card = /^(\w+)\s+•+\s*(\d{4})$/.exec(v.preflight.card);
  const misuse = v.purchases.filter((p) => p.step !== "B" && p.outcome?.status === "refused").map((p) => ({
    key: p.step, amount: p.request.amount, currency: p.request.currency, merchant: p.request.merchant, code: String(p.outcome?.code ?? ""), calls: p.calls.anthropic + p.calls.airwallex + p.calls.airi,
  }));
  const P = partnerFromRecord();
  return {
    vic: {
      label: v.label, run: v.run, cli: v.preflight.cli, record: `${REPO}docs/runs/${v.run === "vic-5" ? "2026-11-14-vic-5" : v.run}.json`, story: `${REPO}docs/runs/${v.run === "vic-5" ? "2026-11-14-vic-5" : v.run}.md`,
      card: { network: card ? card[1]!.toLowerCase() : "visa", last4: card ? card[2]! : null },
      purchase: { agent: "sourcing", model: b.rail_choice?.by === "claude" ? b.rail_choice.model ?? null : null, amount: b.request.amount, currency: b.request.currency, merchant: b.request.merchant, proposal: b.proposal_id },
      steps: [
        { key: "issue", at: created?.ts ?? null, ok: !!created, id: maskId(b.mandate_id), code: null },
        { key: "bind", at: readBack?.ts ?? null, ok: readBack?.payload.match === true && b.read_back?.payment_intent?.equal === true, id: maskId(b.terms_sha256), code: null },
        { key: "use", at: result?.ts ?? null, ok: b.outcome?.status === "succeeded", id: maskId(b.payment_intent_id), code: b.outcome?.code ?? null },
        { key: "reuse", at: reuse?.ts ?? null, ok: reuse?.payload.refused === "PURSER_CREDENTIAL_ALREADY_USED", id: null, code: reuse ? String(reuse.payload.refused) : null },
      ],
      token: { type: typeof cred?.payload.token_type === "string" ? cred.payload.token_type : null, expires: typeof cred?.payload.token_expiration === "string" ? cred.payload.token_expiration : null, terms: maskId(b.terms_sha256), deleted: v.credential_deleted },
      misuse,
      first_try: v.earlier_attempt ? { at: v.earlier_attempt.started_at, code: v.earlier_attempt.outcome.code ?? null } : null,
    },
    agent_tokens: {
      label: P.label, record: P.record,
      tokens: P.tokens.map((t) => ({ agent: t.agent, id: maskId(t.token_id)!, last4: t.token_last4, card_last4: t.card_last4, status: t.status, currency: t.currency, per_purchase: t.per_purchase, per_month: t.per_month, mccs: t.mccs, expires_at: t.expires_at,
        used: t.events.filter((e) => e.kind === "used").length, refused: t.events.filter((e) => e.kind === "refused").map((e) => e.outcome.split(":")[0]!) })),
      rail_refusals: P.refusals.map((x) => ({ code: x.code, by: x.by })),
    },
  };
}

/** The browser side: the page's words (English and Dutch) and the drawing. */
export const TOKEN_LIFE_JS = String.raw`
// --- One purchase, one token (23 Nov) ---------------------------------------------------------------------------------
const TL_W={en:{
  lede:'How an agent pays without ever holding your card, from the recorded runs, each with its label.',
  h:'One purchase, one credential',sub:'Airi\'s single-use credential (Airi reports token_type DPAN; sandbox test card), one recorded run (vic-5): bound to one amount and one merchant, it worked once.',
  sandbox:'Airwallex sandbox · Airi beta · test money',
  why:'If it leaks, it buys one thing, once: not your company\'s card.',
  s:{issue:'Issued',bind:'Bound',use:'Used once',reuse:'Reuse refused'},
  sd:{issue:'CFO\'s Face ID, then Airi\'s mandate',bind:'{amt} · one merchant · Purser\'s terms hash read back',use:'Paid at the merchant',reuse:'Before any call to Airwallex'},
  ntok:'Airi credential',dpan:'Airi credential (token_type DPAN)',bound:'Bound to',at_m:'at',once:'one use',deleted:'Deleted after the run',not_kept:'Its number never enters Purser\'s records',
  mis_h:'Try to misuse it',mis_sub:'What the record shows when the credential, or the agent, is pushed past its mandate.',
  mis:{F1:'Same token, another amount',F2:'Same token, a second time',C:'Above the CFO\'s hard cap',D:'A merchant not on the list'},calls0:'0 calls to Airwallex',refused:'Refused',
  cmp_h:'What a leak can cost',cmp:['A card on file','Agent token','Token per purchase'],cmp_k:['Where','How much','How long'],
  cmp_v:[['Wherever the card\'s controls allow','Its mandate\'s merchant categories','One merchant'],['Up to the card\'s limits','Within its mandate','The exact amount'],['Until the card is frozen or closed','Until revoked or it expires','One use']],
  tok_h:'The tokens on record',tok_sub:'Masked; no credential, token or card number is in any record.',
  t_vic:'Airi credential (vic-5)',t_agent:'Purser agent token',used_n:'{n} paid',refused_n:'{n} refused',active:'Active',revoked:'Revoked',used_once:'Used once, then deleted',
  per:'{amt} a purchase',month:'{amt} a month',mcc:'MCC {m}',card:'card •••• {l}',test_card:'Airi\'s test card •••• {l}',until:'until {d}',
  now_h:'Proven, and not yet',proven:'Proven in the sandbox',notyet:'Not yet',
  p1:'The credential bound to one purchase and read back before it was used (vic-5)',p2:'Reuse and another amount refused before any Airwallex call',p3:'Revoking an agent revokes its tokens in the same call',
  n1:'Live money: sandbox and test cards only',n2:'Airi is in beta ({cli}); its credential waits for the owner\'s tap in Airi',n3:'One recorded run: the first try timed out waiting for the tap, nothing was charged',
  agent:'Sourcing agent',model:'chose the rail',record:'Run record',story:'What happened',
  inv_h:'Invoices as tokens'},
nl:{
  lede:'Hoe een agent betaalt zonder ooit je kaart te hebben, uit de vastgelegde runs, elk met zijn label.',
  h:'Eén aankoop, één credential',sub:'De credential van Airi voor één gebruik (Airi meldt token_type DPAN; testkaart in de sandbox), één vastgelegde run (vic-5): gebonden aan één bedrag en één winkel, hij werkte één keer.',
  sandbox:'Airwallex-sandbox · Airi bèta · testgeld',
  why:'Lekt het uit, dan koopt het één ding, één keer: niet de kaart van je bedrijf.',
  s:{issue:'Uitgegeven',bind:'Gebonden',use:'Eén keer gebruikt',reuse:'Hergebruik geweigerd'},
  sd:{issue:'Face ID van de CFO, dan het mandaat in Airi',bind:'{amt} · één winkel · hash van Purser teruggelezen',use:'Betaald bij de winkel',reuse:'Vóór elke aanroep naar Airwallex'},
  ntok:'Airi-credential',dpan:'Airi-credential (token_type DPAN)',bound:'Gebonden aan',at_m:'bij',once:'één keer',deleted:'Na de run verwijderd',not_kept:'Het nummer komt nooit in de administratie van Purser',
  mis_h:'Probeer het te misbruiken',mis_sub:'Wat het record laat zien als de credential, of de agent, buiten zijn mandaat gaat.',
  mis:{F1:'Zelfde token, ander bedrag',F2:'Zelfde token, tweede keer',C:'Boven de harde limiet van de CFO',D:'Een winkel die niet op de lijst staat'},calls0:'0 aanroepen naar Airwallex',refused:'Geweigerd',
  cmp_h:'Wat een lek kan kosten',cmp:['Een opgeslagen kaart','Agent-token','Token per aankoop'],cmp_k:['Waar','Hoeveel','Hoe lang'],
  cmp_v:[['Waar de controles van de kaart het toestaan','De merchantcategorieën van zijn mandaat','Eén winkel'],['Tot de limieten van de kaart','Binnen zijn mandaat','Precies het bedrag'],['Tot de kaart bevroren of opgezegd is','Tot intrekking of verloop','Eén keer']],
  tok_h:'De vastgelegde tokens',tok_sub:'Gemaskeerd; geen credential, token of kaartnummer staat in een record.',
  t_vic:'Airi-credential (vic-5)',t_agent:'Agent-token van Purser',used_n:'{n} betaald',refused_n:'{n} geweigerd',active:'Actief',revoked:'Ingetrokken',used_once:'Eén keer gebruikt, daarna verwijderd',
  per:'{amt} per aankoop',month:'{amt} per maand',mcc:'MCC {m}',card:'kaart •••• {l}',test_card:'testkaart van Airi •••• {l}',until:'tot {d}',
  now_h:'Bewezen, en nog niet',proven:'Bewezen in de sandbox',notyet:'Nog niet',
  p1:'De credential gebonden aan één aankoop en teruggelezen vóór gebruik (vic-5)',p2:'Hergebruik en een ander bedrag geweigerd vóór elke aanroep naar Airwallex',p3:'Een agent intrekken trekt zijn tokens in dezelfde aanroep in',
  n1:'Echt geld: alleen sandbox en testkaarten',n2:'Airi is in bèta ({cli}); de credential wacht op de tik van de eigenaar in Airi',n3:'Eén vastgelegde run: de eerste poging wachtte tevergeefs op de tik, er is niets afgeschreven',
  agent:'Inkoopagent',model:'koos de rail',record:'Runrecord',story:'Wat er gebeurde',
  inv_h:'Facturen als token'}};
function tw(k,v){const W=TL_W[NL?'nl':'en'];let s=k.split('.').reduce((o,p)=>o&&o[p],W);if(s===undefined)s=k.split('.').reduce((o,p)=>o&&o[p],TL_W.en);s=String(s);for(const [a,b] of Object.entries(v||{}))s=s.split('{'+a+'}').join(String(b));return s}
const TL_IC={issue:'scan-face',bind:'lock',use:'circle-check',reuse:'ban'};
const tlMoney=(c,a)=>cur(c)+' '+a;
// The lifecycle: four stops on a track, a token travelling along it, lit in turn once the panel is in view.
function tlTrack(V){
  const amt=tlMoney(V.purchase.currency,V.purchase.amount);
  const stops=V.steps.map((s,k)=>{const li=el('li','tl-stop '+s.key+(s.ok?' ok':''),[el('span','tl-dot',ic(TL_IC[s.key])),el('b','',tw('s.'+s.key)),el('span','tl-d',tw('sd.'+s.key,{amt})),
    s.id||s.code?el('code','tl-id',s.code&&s.key==='reuse'?s.code.replace(/^PURSER_/,''):s.id+(s.code?' · '+s.code:'')):null,s.at?el('time','tl-t',stamp(s.at)):null]);li.style.setProperty('--i',String(k));return li});
  const ol=el('ol','tl-track',[el('span','tl-rail',el('span','tl-tok')),...stops]);
  return ol}
function tlTokenCard(V){
  return el('div','acard p-midnight tl-card',[el('span','ac-shine'),
    el('div','ac-top',[el('span','ac-mark',ic('lock')),el('span','ac-who',[el('b','ac-name',tw('ntok')),el('span','ac-co','token_type '+(V.token.type||'DPAN')+' · '+tw('bound')+' '+tlMoney(V.purchase.currency,V.purchase.amount))]),el('span','ac-plate',(()=>{const i=el('img','');i.src=BRAND_LOGOS.airwallex.uri;i.alt='Airwallex';return i})())]),
    el('div','ac-mid',[el('span','ac-chip'),el('span','ac-st',[el('i',''),tw('once')])]),
    el('div','ac-num','•••• •••• •••• ••••'),
    el('div','ac-meter',el('span','ac-ml',[el('b','',tw('at_m')+' '),el('span','',V.purchase.merchant)])),
    el('div','ac-foot',[V.purchase.model?el('span','ac-model',[(()=>{const i=el('img','');i.src=BRAND_LOGOS.claude.uri;i.alt='Claude';return i})(),V.purchase.model.replace(/^claude-([a-z]+)-(\d+)-(\d+).*$/,(_,n,a,b)=>n.charAt(0).toUpperCase()+n.slice(1)+' '+a+'.'+b)]):null,
      el('span','ac-tag','Sandbox'),el('span','ac-tag',tw('test_card',{l:V.card.last4||'····'}))])])}
function tlHero(V){
  const sec=el('section','card tl-hero',[
    el('div','tl-hh',[el('div','',[el('h2','',tw('h')),el('p','tl-sub',tw('sub'))]),el('span','rlabel',tw('sandbox'))]),
    el('div','tl-body',[el('div','tl-cardw',[tlTokenCard(V),el('p','tl-fine',[ic('shield-check'),' '+tw('not_kept')+(V.token.deleted?' · '+tw('deleted'):'')])]),tlTrack(V)]),
    el('p','tl-why',[ic('sparkles'),el('b','',tw('why'))]),
    el('p','fine tl-label',[V.label+' · ',ext(V.record,tw('record')),' ',ext(V.story,tw('story'))])]);
  // Lit in turn once in view; at once with reduced motion or without an observer.
  const go=()=>sec.classList.add('play');
  if(RM()||!('IntersectionObserver' in window))go();else{const io=new IntersectionObserver((es)=>{if(es.some((e)=>e.isIntersecting)){go();io.disconnect()}},{threshold:.35});io.observe(sec)}
  return sec}
function tlMisuse(V){
  const tile=(title,amt,code,by)=>el('li','tl-mis',[el('span','tl-x',ic('ban')),el('div','',[el('b','',title),el('span','tl-amt num',amt)]),el('code','',code.replace(/^PURSER_/,'')),el('span','tl-calls',by)]);
  const order=['F1','F2','C','D'];
  const items=order.map((k)=>V.misuse.find((m)=>m.key===k)).filter(Boolean).map((m)=>tile(tw('mis.'+m.key),tlMoney(m.currency,m.amount),m.code,m.calls===0?tw('calls0'):''));
  return el('section','card panel tl-sec',[el('h2','',tw('mis_h')),el('p','sub',tw('mis_sub')),el('ul','tl-misl',items)])}
function tlCompare(){
  const cols=TL_W[NL?'nl':'en'].cmp,keys=TL_W[NL?'nl':'en'].cmp_k,vals=TL_W[NL?'nl':'en'].cmp_v;
  const head=el('div','tl-cr tl-ch',[el('span',''),...cols.map((c,i)=>el('b','c'+i,c))]);
  const rows=keys.map((k,r)=>el('div','tl-cr',[el('span','tl-ck',k),...vals[r].map((v,i)=>el('span','c'+i,[i===2?ic('circle-check'):i===0?ic('triangle-alert'):ic('circle-dot'),v]))]));
  return el('section','card panel tl-sec',[el('h2','',tw('cmp_h')),el('div','tl-cmp',[head,...rows])])}
function tlTokens(V,A){
  const vic=el('li','tl-tk vic',[el('span','tl-tkk',tw('t_vic')),el('code','','token_type '+(V.token.type||'DPAN')+(V.card.last4?' · '+tw('test_card',{l:V.card.last4}):'')),
    el('span','tl-tkd',tlMoney(V.purchase.currency,V.purchase.amount)+' · '+V.purchase.merchant),el('span','obadge ok',[ic('circle-check'),tw('used_once')])]);
  const ag=A.tokens.map((x)=>{const on=x.status==='active';return el('li','tl-tk',[el('span','tl-tkk',tw('t_agent')+' · '+(NL&&(ROSTER.find((r)=>r.id===x.agent)||{}).name||x.agent.charAt(0).toUpperCase()+x.agent.slice(1))),el('code','',x.id+' ··'+x.last4+' · '+tw('card',{l:x.card_last4})),
    el('span','tl-tkd',[x.per_purchase?tw('per',{amt:tlMoney(x.currency,x.per_purchase)}):null,x.per_month?' · '+tw('month',{amt:tlMoney(x.currency,x.per_month)}):null,x.mccs.length?' · '+tw('mcc',{m:x.mccs.join(', ')}):null,x.expires_at?' · '+tw('until',{d:day(x.expires_at)}):null]),
    el('span','tl-tkb',[el('span','obadge '+(on?'ok':'bad'),[ic(on?'circle-check':'ban'),tw(on?'active':'revoked')]),x.used?el('span','sub',tw('used_n',{n:x.used})):null,x.refused.length?el('span','sub',tw('refused_n',{n:x.refused.length})+': '+x.refused.join(', ')):null])])});
  return el('section','card panel tl-sec',[el('h2','',tw('tok_h')),el('p','sub',tw('tok_sub')),el('ul','tl-tks',[vic,...ag]),el('p','fine',[A.label+' · ',A.record?ext(A.record,tw('record')):null])])}
function tlNow(V){
  const col=(h,cls,icon,items)=>el('div','tl-nc '+cls,[el('h3','',[ic(icon),' '+h]),el('ul','',items.map((x)=>el('li','',x)))]);
  return el('section','card panel tl-sec',[el('h2','',tw('now_h')),el('div','tl-now',[col(tw('proven'),'ok','circle-check',[tw('p1'),tw('p2'),tw('p3')]),col(tw('notyet'),'wait','clock',[tw('n1'),tw('n2',{cli:'airi-cli '+V.cli}),tw('n3')])])])}
function tokenLifeSections(L){
  if(!L||!L.vic)return [];
  return [tlHero(L.vic),el('div','tl-grid',[tlMisuse(L.vic),tlCompare()]),tlTokens(L.vic,L.agent_tokens),tlNow(L.vic),el('h2','section-h tl-inv',tw('inv_h'))]}
`;

export const TOKEN_LIFE_CSS = `
.tl-hero { padding: 20px; display: grid; gap: 16px; overflow: hidden; background: radial-gradient(120% 120% at 100% 0%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 60%), var(--surface); }
.tl-hh { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.tl-hh h2 { margin: 0; font-size: 22px; letter-spacing: -.01em; }
.tl-sub { margin: 4px 0 0; color: var(--muted); max-width: 60ch; }
.tl-body { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 24px; align-items: center; }
.tl-cardw { display: grid; gap: 8px; min-width: 0; }
.acard.tl-card { display: grid; grid-template-rows: auto 1fr auto auto auto; gap: 8px; padding: 16px 18px; font-size: 12px; background: linear-gradient(140deg, #1a1838, #09090f 62%, #14122b); }
.tl-card .ac-top { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.tl-card .ac-mark { flex: none; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: rgba(255,255,255,.1); }
.tl-card .ac-who { flex: 1; display: grid; gap: 2px; min-width: 0; } .tl-card .ac-name { font-size: 13.5px; } .tl-card .ac-co { opacity: .7; }
.tl-card .ac-plate { flex: none; padding: 4px 6px; border-radius: 6px; background: #fff; } .tl-card .ac-plate img { display: block; height: 11px; width: auto; }
.tl-card .ac-mid { display: flex; align-items: center; justify-content: space-between; }
.tl-card .ac-chip { width: 34px; height: 25px; border-radius: 6px; background: linear-gradient(135deg, #e9dcae, #b4975c); }
.tl-card .ac-st { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; } .tl-card .ac-st i { width: 7px; height: 7px; border-radius: 50%; background: #3ccf82; }
.tl-card .ac-num { font: 600 14px/1 ui-monospace, Menlo, monospace; letter-spacing: .14em; opacity: .9; }
.tl-card .ac-meter { opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-card .ac-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.tl-card .ac-tag, .tl-card .ac-model { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); font-size: 10.5px; font-weight: 600; }
.tl-card .ac-model img { width: 12px; height: 12px; }
.tl-fine { margin: 0; font-size: 12.5px; color: var(--muted); display: flex; gap: 6px; align-items: flex-start; } .tl-fine .ic svg { width: 14px; height: 14px; }
.tl-track { list-style: none; margin: 0; padding: 0; position: relative; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.tl-rail { position: absolute; left: 22px; right: 22px; top: 21px; height: 3px; border-radius: 3px; background: var(--border); overflow: visible; }
.tl-tok { position: absolute; top: -5px; left: 0; width: 13px; height: 13px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent), 0 0 18px var(--accent); opacity: 0; }
.tl-hero.play .tl-tok { animation: tl-travel 3.2s cubic-bezier(.45,.05,.3,1) .2s forwards; }
@keyframes tl-travel { 0% { left: 0; opacity: 1; } 70% { left: calc(66.6% - 6px); opacity: 1; } 82% { left: calc(83% - 6px); } 88% { left: calc(74% - 6px); } 100% { left: calc(66.6% - 6px); opacity: 1; } }
.tl-stop { position: relative; display: grid; gap: 3px; align-content: start; min-width: 0; opacity: .35; transform: translateY(6px); transition: opacity .4s, transform .4s; transition-delay: calc(var(--i) * .75s + .2s); }
.tl-hero.play .tl-stop { opacity: 1; transform: none; }
.tl-dot { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--surface); border: 2px solid var(--border); color: var(--muted); position: relative; z-index: 1; margin-bottom: 4px; }
.tl-stop.ok .tl-dot { border-color: var(--ok, #067647); color: var(--ok, #067647); background: var(--ok-soft, #ecfdf3); }
.tl-stop.reuse.ok .tl-dot { border-color: var(--bad, #b42318); color: var(--bad, #b42318); background: var(--bad-soft, #fef3f2); }
.tl-hero.play .tl-stop.reuse.ok .tl-dot { animation: tl-shake .5s ease 2.9s; }
@keyframes tl-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
.tl-stop b { font-size: 14px; } .tl-d { font-size: 12.5px; color: var(--muted); line-height: 1.35; }
.tl-id { font-size: 11.5px; overflow-wrap: anywhere; color: var(--text); } .tl-t { font-size: 11.5px; color: var(--faint, var(--muted)); }
.tl-why { margin: 0; display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 12px; background: var(--accent-soft); color: var(--text); } .tl-why .ic { color: var(--accent); }
.tl-label { margin: 0; overflow-wrap: anywhere; }
.tl-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; }
.tl-sec { display: grid; gap: 10px; align-content: start; } .tl-sec h2 { margin: 0; } .tl-sec > p { margin: 0; }
#view > .tl-sec { margin-top: 16px; }
.tl-misl { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.tl-mis { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 3px 10px; align-items: center; padding: 9px 11px; border: 1px solid var(--border); border-radius: 12px; }
.tl-mis > div { display: grid; min-width: 0; } .tl-mis b { font-size: 13.5px; } .tl-amt { font-size: 12.5px; color: var(--muted); }
.tl-x { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: var(--bad-soft, #fef3f2); color: var(--bad, #b42318); grid-row: span 3; align-self: start; }
.tl-mis code { grid-column: 2; font-size: 11px; color: var(--bad, #b42318); overflow-wrap: anywhere; } .tl-calls { grid-column: 2; font-size: 11.5px; color: var(--muted); }
.tl-cmp { display: grid; gap: 0; font-size: 13px; }
.tl-cr { display: grid; grid-template-columns: 74px repeat(3, minmax(0, 1fr)); gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--border); align-items: start; }
.tl-cr:last-child { border-bottom: 0; } .tl-ch b { font-size: 12.5px; } .tl-ck { color: var(--muted); font-size: 12px; font-weight: 650; }
.tl-cr > span { display: flex; gap: 5px; align-items: flex-start; min-width: 0; overflow-wrap: anywhere; } .tl-cr .ic svg { width: 13px; height: 13px; margin-top: 2px; }
.tl-cr .c0 .ic { color: var(--bad, #b42318); } .tl-cr .c1 .ic { color: var(--muted); } .tl-cr .c2 .ic { color: var(--ok, #067647); } .tl-ch .c2 { color: var(--ok, #067647); }
.tl-tks { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 10px; }
.tl-tk { display: grid; gap: 4px; padding: 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--sunken); min-width: 0; }
.tl-tk.vic { background: linear-gradient(135deg, #0b1020, #1e3a8a); color: #fff; border-color: transparent; } .tl-tk.vic .tl-tkd { color: rgba(255,255,255,.8); }
.tl-tkk { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .75; }
.tl-tk code { font-size: 12.5px; overflow-wrap: anywhere; } .tl-tkd { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.tl-tkb { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 12px; } .tl-tk .obadge { justify-self: start; }
.tl-now { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.tl-nc h3 { margin: 0 0 6px; font-size: 14px; display: flex; gap: 6px; align-items: center; } .tl-nc.ok h3 { color: var(--ok, #067647); } .tl-nc.wait h3 { color: var(--warn, #b54708); }
.tl-nc ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13.5px; }
.section-h.tl-inv { margin-top: 24px; }
@media (max-width: 860px) { .tl-body { grid-template-columns: minmax(0, 1fr); } .tl-cardw { max-width: 360px; } .tl-grid, .tl-now { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 560px) { .tl-hero { padding: 16px; } .tl-track { grid-template-columns: minmax(0, 1fr); gap: 12px; } .tl-rail { left: 21px; right: auto; top: 22px; bottom: 22px; width: 3px; height: auto; }
  .tl-tok { display: none; } .tl-stop { grid-template-columns: 44px minmax(0, 1fr); column-gap: 12px; } .tl-stop > :not(.tl-dot) { grid-column: 2; } .tl-dot { grid-row: span 4; margin: 0; }
  .tl-cr { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr); } .tl-ck { grid-column: 1 / -1; } .tl-ch > span:first-child { display: none; } }
@media (prefers-reduced-motion: reduce) { .tl-stop { transition: none; opacity: 1; transform: none; } .tl-hero.play .tl-tok, .tl-hero.play .tl-stop.reuse.ok .tl-dot { animation: none; } .tl-tok { display: none; } }
`;
