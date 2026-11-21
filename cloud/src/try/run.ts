// /try's start screen, the run's clock and score, Share, "Same step, live" and the guided tour (14 Nov, owner: "/try is
// the crown jewel for partners: the start screen must look enterprise-grade; do more"). Plain script strings the page
// (cloud/src/tryPage.ts) places as they are; RUN_JS is pure (no DOM, no clock, no network) and test/try-run.test.ts runs
// the same text in Node. Every word is in cloud/src/tryCopy.ts (START, SAME_STEP, RUN, GUIDE).
//
// - The start: one headline, the three steps as a picture (Read, Check, You sign) and what a one-cent change gets, one
//   button, a quiet trailer link, and the partners' official logos, unaltered (/assets/logo-*, served by the site and by
//   purser-try from cloud/src/try/logos.gen.ts), Visa as text, "No endorsement implied" beside them.
// - The run: S.t0 when the start answers, S.t1 when the finish is first shown; S.passed, the steps passed (read, check,
//   sign, pay, and refuse once the one-cent change was refused). The clock ticks in the band (runTimer, once a second,
//   only while the run is on); the finish shows the time and the steps passed, never as a fraction, and Share.
// - "Same step, live": on each screen after the start, beside the band, a link to that step in a live run on /proof.
// - ?tour=1: a card with one tip per screen; the control it means is lit, and Next presses it. On screen 4, Next changes
//   the amount by one cent first; after the refusal it goes to the finish. Nothing is pressed without a tap on Next.

/**
 * The step on /proof (src/redesign/proof.ts, served at /proof) that shows the same thing in a live run, by screen. Each
 * id is held to the built /proof page by test/try-run.test.ts.
 * - invoice: the main run (three Claude agents run a company for a day). work: the stops (nothing paid over a limit).
 * - approve: a payout approved with the owner's own iPhone Face ID. pay: a real approval to check offline (change one
 *   cent and it says NOT VALID). books: the hash the CFO signed, in Airwallex's own record. did: the books.
 */
export const STEP_PROOF: Record<string, string> = {
  invoice: "run-main-1",
  work: "stops",
  approve: "run-awx-faceid-1",
  pay: "h-pverify",
  books: "awx-hash",
  did: "pg-the-books",
};

/**
 * The partners' logos on the start screen: path, alt, intrinsic width and height (the files' own). 14 Nov (owner): no
 * Airwallex logo here; Airwallex is the platform, shown as the site header's "Built on Airwallex" badge.
 */
export const START_LOGOS: { src: string; alt: string; w: number; h: number; key: string }[] = [
  { src: "/assets/logo-alta.svg", alt: "Alta (formerly Metal)", w: 475, h: 250, key: "alta" },
  { src: "/assets/logo-claude-slate.svg", alt: "Claude", w: 9156, h: 2000, key: "claude" },
];

/** Pure helpers: the clock, the steps passed, the score, the share text, a step's proof link, the tour's tip, one cent less. */
export const RUN_JS = String.raw`
const runKit=(()=>{
  const ORDER=['read','check','sign','pay','refuse'];
  const clock=(ms)=>{const s=Math.max(0,Math.floor((Number(ms)||0)/1000));const h=Math.floor(s/3600),m=Math.floor(s/60)%60,x=s%60;return (h?h+':'+String(m).padStart(2,'0'):String(m))+':'+String(x).padStart(2,'0')};
  const mark=(passed,step)=>{
    const have=Array.isArray(passed)?passed.filter((x)=>ORDER.indexOf(x)>=0):[];
    const at=ORDER.indexOf(step);if(at<0)return ORDER.filter((x)=>have.indexOf(x)>=0);
    const add=step==='refuse'?['refuse']:ORDER.slice(0,at+1);
    return ORDER.filter((x)=>have.indexOf(x)>=0||add.indexOf(x)>=0);
  };
  const stamp=(t)=>typeof t==='number'&&isFinite(t)&&t>0;
  const elapsed=(t0,t1,now)=>stamp(t0)?Math.max(0,(stamp(t1)?t1:now)-t0):null;
  // The steps the visit passed (read, checked, signed, paid); the one-cent refusal is its own line, never counted twice.
  // A visit left open for hours is not a run time: up to two hours only, everywhere (the clock, the score, the share text).
  const CAP=7200000;
  const runTime=(t0,t1,now)=>{const ms=elapsed(t0,t1,now);return ms!==null&&ms<CAP?ms:null};
  const score=(passed,t0,t1,now)=>{const p=mark(passed,'');return {steps:p.filter((x)=>x!=='refuse').length,refused:p.indexOf('refuse')>=0,ms:runTime(t0,t1,now)}};
  // Whether a refused payment differed from the signed terms only by one cent of the amount.
  const cents=(v)=>{const m=/^(\d+)\.(\d{2})$/.exec(String(v));return m?Number(m[1])*100+Number(m[2]):null};
  const oneCent=(signed,sent)=>{if(!signed||!sent)return false;const a=cents(signed.amount),b=cents(sent.amount);
    return a!==null&&b!==null&&Math.abs(a-b)===1&&['currency','beneficiary_name','iban_last4','bic','invoice_no'].every((k)=>String(signed[k])===String(sent[k]))};
  const shareText=(R,sc)=>[R.shareText,sc.ms===null?'':R.shareTime.replace('{time}',clock(sc.ms)),sc.refused?R.shareCent:''].filter(Boolean).join(' ');
  const proofHref=(base,map,screen)=>Object.prototype.hasOwnProperty.call(map,screen)?base+'#'+map[screen]:null;
  const tipOf=(G,screen,refused)=>screen==='pay'&&refused?G.tips.refused:Object.prototype.hasOwnProperty.call(G.tips,screen)?G.tips[screen]:null;
  const oneCentLess=(amount)=>{const m=/^(\d+)\.(\d{2})$/.exec(String(amount));if(!m)return null;const c=Number(m[1])*100+Number(m[2])-1;return c<0?null:Math.floor(c/100)+'.'+String(c%100).padStart(2,'0')};
  return {ORDER,clock,mark,elapsed,runTime,score,oneCent,shareText,proofHref,tipOf,oneCentLess};
})();
`;

/** The start screen (screen 0), in the page's script: its words from C.start, the logos from LOGOS. */
export const START_JS = String.raw`
// 0 Start (14 Nov, owner; the fork 21 Nov): eyebrow, headline, the line under it, the steps forking into paying alone
// within the limit and the passkey above it, and the one-cent refusal as a picture,
// the button with the trailer beside it, the small print, then the partners. The layout is CSS (START_CSS).
screen('start',{heading:C.start.heading,band:false,draw(box){
  const T=C.start;box.classList.add('start');
  const eyebrow=el('p','eyebrow',[el('span','dot'),T.eyebrow]);
  const text=el('p','lede',T.text);
  // 21 Nov (the new direction): Read and Check, then the flow forks: within the limit the agent pays alone, above it
  // you approve with your passkey; then what a one-cent change gets. A light runs the path (CSS; still with reduced motion).
  const flow=el('ol','flow');flow.setAttribute('aria-label',T.heading);
  const glyphs=['file-text','shield-check','scan-face'];
  const step=(i,f)=>el('li','fs fs'+(i+1),[el('span','fi',icon(glyphs[i],22)),el('span','fx',[el('span','fn',[el('span','num',String(i+1)),f.name]),el('span','fl',f.line)])]);
  flow.append(step(0,T.flow[0]),step(1,T.flow[1]));
  const lane=(cls,glyph,tag,name,line)=>el('div','lane '+cls,[el('span','lt',tag),el('span','fx',[el('span','fn',[el('span','fi',icon(glyph,18)),name]),el('span','fl',line)])]);
  flow.append(el('li','fork',[el('div','lanes',[lane('alone','zap',T.lanes.alone.tag,T.lanes.alone.name,T.lanes.alone.line),lane('face','scan-face',T.lanes.face.tag,T.flow[2].name,T.flow[2].line)]),el('p','ln',T.lanes.note)]));
  flow.append(el('li','fs fend',[el('span','fi',icon('ban',20)),el('span','fx',el('span','fn',T.flowEnd))]));
  const b=btn(T.button,true);
  const label=(words,glyph)=>b.replaceChildren(...[words,glyph?icon('arrow-right',18):null].filter(Boolean));label(T.button,true);
  const trailer=el('a','trailer',[el('span','play',icon('play',12)),T.trailer]);trailer.href=C.trailer.url;trailer.target='_blank';trailer.rel='noopener';
  const logos=el('ul','logos');
  for(const l of LOGOS){
    const img=el('img');img.src=l.src;img.alt=l.alt;img.width=l.w;img.height=l.h;img.decoding='async';img.className='lg lg-'+l.key;
    // 15 Nov (judges: the strip read "(formerly Metal)" alone): the logo's alt names it, "Alta (formerly Metal)"; the
    // visible "(formerly Metal)" beside it is the same words for the eye, so screen readers hear them once.
    const was=el('span','was',T.formerly);was.setAttribute('aria-hidden','true');
    logos.append(el('li','tile'+(l.key==='alta'?' alta':''),l.key==='alta'?[img,was]:img));
    if(l.key==='alta')logos.append(el('li','tile tname',T.visa));
  }
  const partners=el('div','partners',[el('p','pl',T.worksWith),logos,el('p','pn',T.runs_note)]);
  // Proof in numbers (15 Nov, owner): the recorded runs' figures, each linked to its record, and the suite's count.
  box.append(eyebrow,text,flow,el('div','cta',[b,trailer]),el('p','fine',T.fine),partners,proofBand());
  b.addEventListener('click',async()=>{
    b.disabled=true;label(T.starting,false);
    const r=await call('POST','/v1/try/start',TOKEN?{token:TOKEN}:{});
    if((r.status===201||r.status===200)&&typeof r.json.session==='string'){
      for(const k of ['tenant','session','visitor_token','expires_at','pool','mode'])S[k]=r.json[k]??null;
      // The run's clock starts with the company.
      S.t0=Date.now();S.t1=null;S.passed=[];S.proposal=null;S.settled=null;S.cred=null;S.awx=null;S.proof=null;S.refusedProof=null;S.cost=null;
      // Warm the company's engine while screen 1 is read: its status (which loads the engine object) and the samples, in
      // parallel and not awaited, so the engine is warm when the visitor files an invoice. Only here, after the click:
      // never on load or on hover, which would start a company for every crawler and spend the start limits.
      S.after=0;save();armRenewal();WARM.engine=api('GET','/v1/engine');WARM.samples=api('GET','/v1/engine/samples');show('invoice');return;
    }
    b.disabled=false;label(T.button,true);
    const said=typeof r.json.message==='string'&&r.json.message?r.json.message:T.failed;
    const why=el('div','',[el('p','note',said)]);
    if(r.status===429||r.status===503){const a=el('a','',T.runs);a.href=RUNS;a.rel='noopener';why.append(el('p','',a))}
    text.replaceWith(why);
  });
}});
`;

/**
 * The run's clock in the rail, "Same step, live" beside the band, the marks of the steps passed, the score and Share on
 * the finish. Called from the page's show(), steps() and band(), and screen 6.
 */
export const RUN_UI_JS = String.raw`
// The clock: figures only, ticking once a second while the run is on (started, not finished).
let runTimer=null;
const runMs=()=>runKit.runTime(S.t0,S.t1,Date.now());
function runTick(){const ms=runMs();for(const t of document.querySelectorAll('#main .clock .t'))t.textContent=ms===null?'':runKit.clock(ms);if(ms===null||S.t1){clearInterval(runTimer);runTimer=null}}
function runClock(){
  const ms=runMs();if(ms===null)return null;
  const c=el('span','clock',[icon('clock',13),el('span','t',runKit.clock(ms))]);c.setAttribute('role','timer');c.setAttribute('aria-label',C.run.clock);
  if(!S.t1&&!runTimer)runTimer=setInterval(runTick,1000);
  return c;
}
// "Same step, live": this step in a live run on /proof, in a new tab.
function sameStep(name){
  const href=runKit.proofHref(PROOF,STEP_PROOF,name);if(!href)return null;
  const a=el('a','same',[C.same.label,icon('external-link',13)]);a.href=href;a.target='_blank';a.rel='noopener';return a;
}
// The steps passed, as the visit reaches them; the clock stops when the finish is first shown.
function runMark(name,arg){
  if(name==='approve')S.passed=runKit.mark(S.passed,'check');
  if(name==='books'&&!settledErr(arg))S.passed=runKit.mark(S.passed,'pay');
  if(name==='company'&&S.t0&&!S.t1){S.t1=Date.now();runTick()}
}
// The finish's score: the time, the steps passed, the one-cent change (refused, or a way to try it), and Share.
// "Proof in numbers" (15 Nov, owner): only figures measured in a recorded run, each a link to its record (PROOF_FIGS,
// cloud/src/try/proof.gen.ts), and the suite's count from its last full run (TESTS_PASSING). Never a fraction.
function proofBand(){
  const P=C.proofBand;const ul=el('ul','rl');
  const item=(n,label,href)=>{const a=el('a','',[el('span','pv',n),el('span','pk',label)]);a.href=href;a.target='_blank';a.rel='noopener';ul.append(el('li','',a))};
  for(const f of PROOF_FIGS)if(P.labels[f.key])item(String(f.n),P.labels[f.key],f.href);
  if(TESTS_PASSING)item(TESTS_PASSING,P.labels.tests,TESTS_HREF);
  // One more line from a record, across the band, when there is one (BAND_LINE: a slot, empty until it lands).
  if(BAND_LINE){const a=el('a','',[el('span','ph2',BAND_LINE.head),el('span','pk',BAND_LINE.line)]);a.href=BAND_LINE.href;a.target='_blank';a.rel='noopener';ul.append(el('li','wide',a))}
  const s=el('section','real proofband',[el('p','rh',P.head),ul]);s.setAttribute('aria-label',P.head);return s;
}
function runScore(){
  const R=C.run,sc=runKit.score(S.passed,S.t0,S.t1,Date.now());
  if(!sc.steps&&sc.ms===null)return null;
  const tile=(v,l,cls)=>el('li','tile'+(cls?' '+cls:''),[el('span','v',v),el('span','l',l)]);
  const tiles=el('ul','tiles');
  if(sc.ms!==null)tiles.append(tile(runKit.clock(sc.ms),R.time));
  tiles.append(tile(String(sc.steps),R.steps));
  if(sc.refused)tiles.append(tile(icon('circle-check',24),R.refused,'ok'));
  else if(S.proposal&&S.proposal.id){const t=el('button','link cent',R.tryCent);t.type='button';t.addEventListener('click',()=>show('pay'));tiles.append(el('li','tile go',t))}
  const share=el('button','btn share',[icon('arrow-up-right',16),el('span','',R.share)]);share.type='button';
  const said=el('p','hint shared');said.hidden=true;said.setAttribute('role','status');
  share.addEventListener('click',async()=>{
    const url=location.origin+location.pathname,text=runKit.shareText(R,runKit.score(S.passed,S.t0,S.t1,Date.now()));
    if(typeof navigator.share==='function'&&matchMedia('(pointer: coarse)').matches){
      try{await navigator.share({title:R.shareTitle,text,url});return}catch(e){if(e&&e.name==='AbortError')return}
    }
    let ok=false;try{await navigator.clipboard.writeText(text+' '+url);ok=true}catch(e){}
    said.hidden=false;said.textContent=ok?R.copied:R.copyThis+' '+url;
  });
  return el('section','score',[el('div','sh',[el('p','st',R.head),share]),tiles,said]);
}
`;

/** ?tour=1: the guided tour's card, the lit control and Next. */
export const TOUR_JS = String.raw`
const TOUR=(()=>{try{return new URLSearchParams(location.search).get('tour')==='1'}catch(e){return false}})();
const tour=(()=>{
  if(!TOUR)return {update(){}};
  const G=C.guide;
  const card=el('aside','guide');card.setAttribute('role','region');card.setAttribute('aria-label',G.label);
  const n=el('span','gn');const tip=el('p','gt');tip.setAttribute('aria-live','polite');
  const next=el('button','btn gnext',[el('span','',G.next),icon('arrow-right',16)]);next.type='button';
  const end=el('button','link gend',G.end);end.type='button';
  card.append(el('p','gh',[icon('sparkles',14),el('span','',G.label),n]),tip,el('div','gacts',[next,end]));
  document.body.append(card);
  let on=true,lit=null;
  const refusedNow=()=>!!$('#main .refusal');
  // The control a screen's tip means: its main button, or the try-to-cheat link after paid; none once refused.
  const target=()=>{
    const s=S.screen;
    // The control must be on screen (the try-to-cheat link waits in a hidden tail until Paid's blocks are drawn).
    const shown=(n)=>n&&n.offsetParent!==null?n:null;
    // On Paid the tip means the try-to-cheat link: Next waits for it; only without it (a failed payment) the main button.
    if(s==='books'){const ch=$('#main .cheat');return ch?shown(ch):shown($('#main .btn.primary:not([disabled])'))}
    if(s==='pay'&&refusedNow())return null;
    if(s==='company')return $('#main .score');
    // On screen 2, only Pay or Try another invoice: the tour never presses a sandbox override for the visitor.
    if(s==='work'){const b=[...document.querySelectorAll('#main .btn.primary:not([disabled])')].find((x)=>x.textContent===C.work.pay||x.textContent===C.work.another);return shown(b||null)}
    return shown($('#main .btn.primary:not([disabled])'));
  };
  const light=(t)=>{if(lit===t)return;if(lit)lit.classList.remove('tour-hl');lit=t;if(t)t.classList.add('tour-hl')};
  // After Next, keyboard focus comes back to Next once the page has answered (show() puts it on the new heading).
  let refocus=false;
  function update(){
    if(!on)return;
    const s=S.screen,words=runKit.tipOf(G,s,refusedNow());
    card.hidden=!words;if(!words){light(null);return}
    if(tip.textContent!==words)tip.textContent=words;
    const t=target();light(t);
    const last=s==='company';next.hidden=last;
    next.disabled=!(t||(s==='pay'&&refusedNow()));
    if(refocus&&!next.disabled&&!next.hidden&&document.activeElement!==next){refocus=false;next.focus({preventScroll:true})}
  }
  next.addEventListener('click',()=>{
    const s=S.screen,t=target();
    refocus=true;
    if(s==='pay'&&refusedNow()){show('company');return}
    if(s==='pay'&&t){
      // One cent less than what was signed, as a person would type it, then Pay.
      // The panel opens with the one-cent change filled in (15 Nov); only a field put back is changed here.
      const f=$('#main .screen.pay input');const v=f&&!f.closest('.f.changed')&&runKit.oneCentLess(normAmount(f.value));
      if(f&&v){f.value=v;f.dispatchEvent(new Event('input',{bubbles:true}))}
    }
    let calm=false;try{calm=matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){}
    if(t){t.scrollIntoView({block:'center',behavior:calm?'auto':'smooth'});t.click()}
  });
  end.addEventListener('click',()=>{on=false;light(null);card.remove()});
  new MutationObserver(update).observe($('#main'),{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','hidden']});
  return {update};
})();
`;

/** The start screen's look, the rail's clock and live link, the score and the tour card. Existing tokens only. */
export const START_CSS = `
/* 14 Nov (owner): the start, enterprise-grade. One column on a phone; at 1024 px and up the words left, the steps right. */
body:has(.screen.start) { min-height: 100vh; min-height: 100svh; background:
  radial-gradient(60% 420px at 85% 0, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%) no-repeat,
  radial-gradient(50% 360px at 0 100%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%) no-repeat,
  var(--bg); }
body:has(.screen.start)::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background: radial-gradient(circle, color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 1.4px) 0 0 / 24px 24px;
  -webkit-mask-image: linear-gradient(180deg, #000, transparent 70%); mask-image: linear-gradient(180deg, #000, transparent 70%); }
body:has(.screen.start) main { max-width: 600px; padding-top: 22px; padding-bottom: 28px; display: grid; grid-template-columns: minmax(0, 1fr);
  grid-template-areas: "eyebrow" "h1" "lede" "flow" "cta" "fine" "partners" "real"; }
.screen.start { display: contents; animation: none; }
body:has(.screen.start) main > h1 { grid-area: h1; margin: 12px 0 10px; font-size: 33px; line-height: 1.08; letter-spacing: -.03em; font-weight: 780; text-wrap: balance; animation: rise .5s cubic-bezier(.2,.7,.2,1) .05s both; }
.start .eyebrow { grid-area: eyebrow; justify-self: start; display: inline-flex; align-items: center; gap: 8px; margin: 0; padding: 5px 12px 5px 10px; border-radius: 999px;
  background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); color: var(--muted); font-size: 13px; font-weight: 600; animation: rise .5s cubic-bezier(.2,.7,.2,1) both; }
.start .eyebrow .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.start .lede { grid-area: lede; margin: 0 0 18px; color: var(--muted); font-size: 16.5px; line-height: 1.5; text-wrap: pretty; animation: rise .5s cubic-bezier(.2,.7,.2,1) .1s both; }
.start .flow { grid-area: flow; list-style: none; margin: 0 0 16px; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; animation: rise .55s cubic-bezier(.2,.7,.2,1) .15s both; }
.start .fs { position: relative; display: grid; gap: 6px; align-content: start; padding: 11px 10px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow);
  animation: fslit 9s ease-in-out infinite; }
.start .fs2 { animation-delay: 1.1s; }
.start .fs .fi { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: var(--accent-soft); color: var(--accent); }
.start .fs .fx, .start .lane .fx { display: grid; gap: 2px; min-width: 0; }
.start .fs .fn, .start .lane .fn { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 14.5px; }
.start .fs .num { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--sunken); color: var(--muted); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
.start .fs .fl, .start .lane .fl { color: var(--muted); font-size: 12.5px; line-height: 1.35; text-wrap: pretty; }
/* The fork: within the limit the agent pays alone (the ok colour); above it, the passkey (the accent). */
.start .fork { grid-column: 1 / -1; position: relative; display: grid; gap: 6px; }
.start .fork .lanes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.start .lane { --lc: var(--ok); position: relative; display: grid; gap: 6px; align-content: start; padding: 10px 10px 11px; border-radius: 14px; background: var(--surface); border: 1px solid color-mix(in srgb, var(--lc) 30%, var(--border)); box-shadow: var(--shadow); overflow: hidden; animation: lanelit 9s ease-in-out 2.6s infinite; }
.start .lane.face { --lc: var(--accent); animation-delay: 4.4s; }
.start .lane::before { content: ""; position: absolute; inset: 0 0 auto; height: 2px; background: linear-gradient(90deg, transparent, var(--lc), transparent); transform: translateX(-100%); animation: lanerun 9s ease-in-out 2.6s infinite; }
.start .lane.face::before { animation-delay: 4.4s; }
.start .lane .lt { justify-self: start; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--lc) 13%, var(--surface)); color: var(--lc); font-size: 11px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
.start .lane .fn .fi { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; background: color-mix(in srgb, var(--lc) 13%, var(--surface)); color: var(--lc); flex: none; }
.start .fork .ln { margin: 0; color: var(--faint); font-size: 11.5px; text-align: center; }
/* A phone: Read and Check as two compact rows, icon beside the words, so the button stays in the first screen. */
@media (max-width: 1023px) {
  .start .fs:not(.fend) { grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; padding: 9px 10px; }
  .start .fs:not(.fend) .fi { width: 30px; height: 30px; border-radius: 9px; }
  .start .fs .num { display: none; }
  .start .lane { gap: 4px; padding: 9px 10px 10px; }
  .start .lane .fn .fi { width: 22px; height: 22px; border-radius: 7px; }
}
.start .fs.fend { grid-column: 1 / -1; grid-template-columns: auto 1fr; align-items: center; padding: 9px 12px; background: var(--bad-soft); border-color: color-mix(in srgb, var(--bad) 40%, var(--border)); box-shadow: none;
  animation: fsend 9s ease-in-out infinite; }
.start .fs.fend .fi { width: 30px; height: 30px; border-radius: 9px; background: color-mix(in srgb, var(--bad) 14%, var(--surface)); color: var(--bad); }
.start .fs.fend .fn { color: var(--bad); font-size: 14px; }
@keyframes fslit { 0%, 2% { border-color: var(--border); } 5%, 13% { border-color: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 16%, transparent), var(--shadow); } 17%, 100% { border-color: var(--border); } }
@keyframes lanelit { 0%, 2% { border-color: color-mix(in srgb, var(--lc) 30%, var(--border)); } 5%, 15% { border-color: var(--lc); box-shadow: 0 0 0 4px color-mix(in srgb, var(--lc) 16%, transparent), var(--shadow); } 20%, 100% { border-color: color-mix(in srgb, var(--lc) 30%, var(--border)); } }
@keyframes lanerun { 0% { transform: translateX(-100%); } 14%, 100% { transform: translateX(100%); } }
/* The refusal is always readable: only a shake and its border move, after the lanes have lit. */
@keyframes fsend { 0%, 70% { transform: none; border-color: color-mix(in srgb, var(--bad) 40%, var(--border)); } 72% { transform: translateX(-5px); border-color: var(--bad); } 74% { transform: translateX(4px); } 76% { transform: translateX(-2px); } 78%, 92% { transform: none; border-color: var(--bad); } 100% { border-color: color-mix(in srgb, var(--bad) 40%, var(--border)); } }
.start .cta { grid-area: cta; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; animation: rise .55s cubic-bezier(.2,.7,.2,1) .2s both; }
.start .cta .btn.big { margin: 0; width: 100%; min-height: 54px; box-shadow: 0 10px 24px -10px color-mix(in srgb, var(--accent) 70%, transparent); transition: transform .15s ease, box-shadow .15s ease; }
.start .cta .btn.big:hover { transform: translateY(-1px); box-shadow: 0 14px 28px -10px color-mix(in srgb, var(--accent) 80%, transparent); }
.start .cta .btn .i { vertical-align: 0; }
.start .trailer { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; margin: 0 auto; color: var(--text); font-size: 14px; font-weight: 600; text-decoration: none; }
.start .trailer .play { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--accent); }
.start .trailer:hover { color: var(--accent); }
.start .fine { grid-area: fine; margin: 2px 0 0; font-size: 12.5px; color: var(--faint); text-align: center; }
.start .partners { grid-area: partners; margin: 22px 0 0; padding: 16px 0 0; border-top: 1px solid var(--border); text-align: center; animation: rise .6s cubic-bezier(.2,.7,.2,1) .3s both; }
.start .partners .pl { margin: 0 0 10px; color: var(--faint); font-size: 11.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.start .logos { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
/* The official files on white tiles in both themes (their marks are dark; docs/assets/logos/SOURCES.md). */
.start .logos .tile { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 12px; border-radius: 10px; background: #fff; border: 1px solid #e3e6ec; color: #0b1220; font-size: 12.5px; font-weight: 650; }
.start .logos .tile.tname { background: none; border-color: transparent; color: var(--text); padding: 0 6px; }
.start .logos .lg { display: block; width: auto; height: 16px; }
.start .logos .lg-alta { height: 20px; }
.start .logos .was { color: #586174; font-size: 11.5px; font-weight: 600; }
.start .partners .pn { margin: 10px 0 0; color: var(--faint); font-size: 11.5px; }
@media (min-width: 1024px) {
  body:has(.screen.start) main { max-width: 1180px; padding: 36px 48px 32px; min-height: calc(100vh - 65px); min-height: calc(100svh - 65px); align-content: center;
    grid-template-columns: minmax(0, 1.08fr) minmax(0, .92fr); column-gap: 72px;
    grid-template-areas: "eyebrow flow" "h1 flow" "lede flow" "cta flow" "fine flow" "partners partners" "real real"; }
  body:has(.screen.start) main > h1 { font-size: 54px; margin: 20px 0 16px; }
  .start .lede { font-size: 19px; max-width: 34em; margin-bottom: 28px; }
  .start .flow { align-self: center; grid-template-columns: minmax(0, 1fr); gap: 10px; margin: 0; padding: 22px; border-radius: 24px; background: color-mix(in srgb, var(--surface) 70%, transparent); border: 1px solid var(--border); box-shadow: var(--shadow); position: relative; }
  .start .fs { grid-template-columns: auto 1fr; align-items: center; gap: 14px; padding: 14px 18px; }
  .start .fs .fi { width: 44px; height: 44px; border-radius: 13px; }
  .start .fs .fn, .start .lane .fn { font-size: 16px; }
  .start .fs .fl, .start .lane .fl { font-size: 13.5px; }
  .start .lane { padding: 14px 16px; }
  .start .fork { grid-column: auto; }
  .start .fs.fend { grid-column: auto; padding: 13px 18px; }
  .start .cta { justify-content: flex-start; }
  .start .cta .btn.big { width: auto; padding: 0 28px; }
  .start .trailer { margin: 0; }
  .start .fine { text-align: left; }
  .start .partners { margin-top: 40px; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 10px 18px; }
  .start .partners .pl, .start .partners .pn { margin: 0; }
}
/* 4K (Max, 21 Nov: "razor-sharp at 4K"): a wider measure and a larger headline, never a narrow column. */
@media (min-width: 1920px) { body:has(.screen.start) main { max-width: 1400px; column-gap: 96px; } body:has(.screen.start) main > h1 { font-size: 62px; } .start .lede { font-size: 20px; } }
@media (max-width: 420px) { .score .tile { padding: 9px 10px; } .score .tile .v { font-size: 21px; } }
@media (min-width: 1024px) and (max-height: 820px) { body:has(.screen.start) main > h1 { font-size: 46px; } .start .partners { margin-top: 26px; } }

/* Proof in numbers (15 Nov, owner): one band of measured figures under the partners (and on the finish), each a link. */
.start .real { grid-area: real; }
.proofband { margin: 18px 0 0; animation: rise .6s cubic-bezier(.2,.7,.2,1) .4s both; }
.proofband .rh { margin: 0 0 8px; color: var(--faint); font-size: 11.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; text-align: center; }
.proofband .rl { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.proofband li a { display: flex; flex-direction: column; gap: 2px; height: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); color: var(--text); text-decoration: none; }
.proofband li a:hover { border-color: var(--accent); }
.proofband li a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.proofband .pv { font-size: 22px; font-weight: 750; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
.proofband .pk { color: var(--muted); font-size: 12px; font-weight: 600; line-height: 1.3; }
.proofband li:last-child:nth-child(odd), .proofband li.wide { grid-column: 1 / -1; }
.proofband li.wide .ph2 { font-size: 15px; font-weight: 700; line-height: 1.3; }
.proofband li.wide .pk { font-size: 12.5px; }
@media (min-width: 1024px) { .start .proofband { margin-top: 22px; } .proofband .rl { grid-template-columns: repeat(5, minmax(0, 1fr)); } .proofband li:last-child:nth-child(odd):not(.wide) { grid-column: auto; } .proofband .pv { font-size: 24px; } }
/* The steps light one after another, each icon filling, the lanes after them, then the refusal shakes (a loop; still with reduced motion). */
.start .fs .fi { animation: fifill 9s ease-in-out infinite; }
.start .fs2 .fi { animation-delay: 1.1s; } .start .fs.fend .fi { animation: none; }
@keyframes fifill { 0%, 2% { background: var(--accent-soft); color: var(--accent); } 5%, 13% { background: var(--accent); color: #fff; } 17%, 100% { background: var(--accent-soft); color: var(--accent); } }
/* The button breathes a little light. */
.start .cta .btn.big { animation: ctaglow 2.8s ease-in-out infinite alternate; }
@keyframes ctaglow { from { box-shadow: 0 10px 24px -10px color-mix(in srgb, var(--accent) 70%, transparent), 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent); } to { box-shadow: 0 12px 28px -10px color-mix(in srgb, var(--accent) 80%, transparent), 0 0 0 6px color-mix(in srgb, var(--accent) 14%, transparent); } }
/* The band's clock and "Same step, live" (screens after the start). */
.band .clock { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.band .bx { margin-left: auto; display: inline-flex; align-items: center; gap: 10px; }
.band:not(:has(.same)) .bx { margin-left: 8px; }
/* Recording mode (/try?present=1, cloud/src/try/presentMode.ts) shows its own run figures and fits 1080p: no clock or link here. */
body.present .band .bx { display: none; }
.band .bx:empty { display: none; }
.band .same { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; text-decoration: none; white-space: nowrap; }
/* The finish's score. */
.score { margin: 0 0 16px; padding: 14px; border-radius: 16px; background: var(--bg); border: 1px solid var(--border); animation: rise .4s ease-out .3s both; }
.score .sh { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 10px; }
.score .st { margin: 0; font-weight: 700; font-size: 15px; }
.score .btn.share { min-height: 40px; padding: 0 14px; font-size: 14px; }
.score .tiles { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.score .tile { display: grid; gap: 2px; align-content: start; padding: 10px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); min-width: 0; }
.score .tile .v { font-size: 24px; font-weight: 780; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
.score .tile .l { font-size: 12.5px; line-height: 1.3; color: var(--muted); }
.score .tile.ok .v { color: var(--ok); } .score .tile.ok .v .i { vertical-align: -4px; }
.score .tile.go { place-items: center; }
.score .shared { margin: 8px 0 0; overflow-wrap: anywhere; }
/* ?tour=1: the card, and the control it means lit. */
.guide { position: fixed; z-index: 60; left: 50%; bottom: 16px; transform: translateX(-50%); width: min(420px, calc(100% - 24px)); padding: 14px 16px; border-radius: 16px;
  background: var(--text); color: var(--bg); box-shadow: 0 20px 40px -16px rgba(0,0,0,.45); animation: rise .35s ease-out both; }
.guide[hidden] { display: none; }
.guide .gh { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; opacity: .75; }
.guide .gt { margin: 0 0 10px; font-size: 15px; line-height: 1.4; font-weight: 600; }
.guide .gacts { display: flex; align-items: center; gap: 14px; }
.guide .btn.gnext { min-height: 40px; background: var(--bg); color: var(--text); border-color: transparent; }
.guide .btn.gnext[hidden] { display: none; }
.guide .gend { color: inherit; opacity: .8; font-size: 14px; }
.tour-hl { position: relative; z-index: 2; outline: 3px solid var(--accent) !important; outline-offset: 4px; animation: tourpulse 1.6s ease-out infinite; }
@keyframes tourpulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; } }
body:has(.guide:not([hidden])) main { padding-bottom: 170px; }
`;
