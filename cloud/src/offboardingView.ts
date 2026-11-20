// Settings, "Close and offboard the company" (20 Nov): the console's screen for POST /v1/offboarding
// (cloud/src/privacy.ts offboardTenant; docs/privacy/retention.md). It walks a signed-in owner through what the API
// already demands, in its order, and adds no rule of its own: (1) the company's staged export, made and downloaded
// (POST /v1/export/staged, then its manifest and parts by their signed links); (2) the company's address typed again;
// (3) a fresh passkey check (cloud/src/stepUp.ts: offboarding always asks, whatever the step-up setting); then the
// POST. The API's answer is shown as it comes: the counts on success, its refusal word for word otherwise.
//
// Only an owner signed in with their passkey sees it (the route refuses anyone else: a key, a Google, Microsoft or Apple
// sign-in, a CFO, an accountant, a viewer, the demo company's guest).
//
// One implementation serves the console and its test, as ./connectionsView.ts: OFFBOARDING_VIEW_JS is plain script the
// console carries as it is, and test/console-offboarding.test.ts runs the same text with stand-ins for el(), btn() and
// the four actions (the console's own export download, stepUp() and api()). It builds elements only through el() and
// btn(), sets text as text, and reaches the network and the passkey only through the actions it is handed.

import { SITE_ORIGIN } from "./siteHeader.js";

/** The privacy page the screen links: the site's /privacy (src/redesign/privacy.ts). */
export const OFFBOARDING_PRIVACY_URL = `${SITE_ORIGIN}/privacy`;

export const OFFBOARDING_VIEW_JS = String.raw`
// --- Settings, Close and offboard the company ------------------------------------------------------------------------
// Who sees it: the one caller POST /v1/offboarding accepts, an owner's own passkey session (not the demo company's).
function offboardingShown(m){return !!(m&&m.kind==='session'&&m.role==='owner'&&m.signed_in_with==='passkey'&&!m.demo&&m.tenant&&m.tenant.slug&&[].concat(m.scopes||[]).includes('admin'))}
// The card's contents, or null for anyone else. a: exportNow() -> {id,parts,bytes,expires_at,reused}; passkey() ->
// {until}; offboard(confirm,exportId) -> the API's answer; quiet(e): an error the page already handled (a session ended);
// signedOut(): the session is gone after offboarding. f: stamp(iso) and day(iso), as the page writes them.
function offboardingViewOf(m,t,el,btn,a,f){
  if(!offboardingShown(m))return null;
  const slug=m.tenant.slug,name=m.tenant.name||slug;
  const st={exportId:null,checked:false,done:false};
  const say=(box,text,tone)=>{box.replaceChildren(el('p','note-'+(tone||'info'),text))};
  const fail=(box,e)=>{if(!a.quiet(e))say(box,(e&&e.message)||String(e),'bad')};
  const status=()=>{const d=el('div','');d.setAttribute('role','status');return d};
  const privacy=el('a','',t('cs.off.privacy'));privacy.href=__OFF_PRIVACY__;privacy.target='_blank';privacy.rel='noopener noreferrer';

  // Step 1: the export, made and saved to this device.
  const exp=btn(t('cs.off.export'),'primary','download');exp.id='off-export';const expMsg=status();
  // Step 2: the company's address, as the API compares it.
  const typed=el('input','field');typed.id='off-confirm';typed.autocomplete='off';typed.spellcheck=false;typed.maxLength=80;typed.placeholder=slug;typed.disabled=true;
  const typedLab=el('label','',t('cs.off.address'));typedLab.htmlFor='off-confirm';
  // Step 3: the passkey, checked now.
  const pk=btn(t('cs.off.passkey'),'primary','scan-face');pk.id='off-passkey';pk.disabled=true;const pkMsg=status();
  // Then the request itself.
  const go=btn(t('cs.off.go',{name:name}),'danger','x');go.id='off-go';go.disabled=true;const goMsg=status();

  const matches=()=>String(typed.value||'').trim()===slug;
  const sync=()=>{if(st.done){exp.disabled=typed.disabled=pk.disabled=go.disabled=true;return}
    typed.disabled=!st.exportId;pk.disabled=!(st.exportId&&matches());go.disabled=!(st.exportId&&matches()&&st.checked)};
  exp.onclick=async()=>{exp.disabled=true;say(expMsg,t('cs.off.exporting'));
    try{const x=await a.exportNow();st.exportId=x.id;
      const said=[el('p','note-ok',t('cs.off.exported',{id:x.id,parts:x.parts,mb:(Math.max(0,Number(x.bytes)||0)/1048576).toFixed(1),when:f.stamp(x.expires_at)}))];
      if(x.reused)said.push(el('p','note-info',t('cs.off.reused')));expMsg.replaceChildren(...said)}
    catch(e){fail(expMsg,e)}finally{exp.disabled=st.done;sync()}};
  typed.oninput=()=>{st.checked=false;pkMsg.replaceChildren();sync()};
  pk.onclick=async()=>{pk.disabled=true;
    try{const r=await a.passkey();st.checked=true;say(pkMsg,t('cs.off.checked',{when:f.stamp(r.until)}),'ok')}
    catch(e){st.checked=false;fail(pkMsg,e)}finally{sync()}};
  go.onclick=async()=>{if(!(st.exportId&&matches()&&st.checked))return;go.disabled=true;
    try{const r=await a.offboard(String(typed.value).trim(),st.exportId);st.done=true;
      goMsg.replaceChildren(el('p','note-ok',t('cs.off.done',{name:name})),
        el('p','note-info',t('cs.off.kept',{day:f.day(r.purge_after)})),
        el('p','note-info',t('cs.off.removed',{people:r.people_pseudonymised,passkeys:r.passkeys_removed,links:r.sign_in_links_removed,sessions:r.sessions_removed,keys:r.keys_revoked,hooks:r.hooks_removed})),
        el('p','note-info',t('cs.off.signed_out')));
      a.signedOut()}
    catch(e){fail(goMsg,e)}finally{sync()}};

  return [el('h2','',t('cs.off.title')),
    el('p','',t('cs.off.lede',{name:name})),el('p','sub',[privacy]),
    el('h2','sub-h',t('cs.off.step1_h')),el('p','',t('cs.off.step1')),el('p','sub',t('cs.off.step1_docs')),el('div','row2',[exp]),expMsg,
    el('h2','sub-h',t('cs.off.step2_h')),el('p','',t('cs.off.step2',{slug:slug})),el('div','form-row',[el('div','',[typedLab,typed])]),
    el('h2','sub-h',t('cs.off.step3_h')),el('p','',t('cs.off.step3')),el('div','row2',[pk]),pkMsg,
    el('h2','sub-h',t('cs.off.step4_h')),el('p','',t('cs.off.step4')),el('div','row2',[go]),goMsg];
}
`.replace("__OFF_PRIVACY__", () => JSON.stringify(OFFBOARDING_PRIVACY_URL));
