// Purser Cloud's console: the pages a company uses in the browser, served by the same Worker as the API. One page with
// one script (the response's nonce, no inline handlers, no 'unsafe-inline'), which talks to /v1 with the person's
// passkey session as a bearer token kept in the tab (sessionStorage): no cookie, so another site cannot ride on it,
// and the Worker refuses a state change whose Origin is not this one (app.ts). Every value from the API is put on the
// page as text (textContent), never as HTML; account numbers come masked from the runner. The console reads and
// manages; it never pays: a payment is approved on the CFO's phone with Face ID, through the runner's approval flow.

import { escAttr, ICON_SET, PAYABLES_CSS, svg } from "../../src/ui/payablesKit.js";
import { fromB64 } from "./crypto.js";
import { INTER_WOFF2_B64 } from "./font.gen.js";
import type { CloudEnv } from "./app.js";

const ICONS = ["wallet", "calendar-range", "clock", "inbox", "octagon-x", "chevron-right", "circle-check", "triangle-alert", "circle-minus", "file-text",
  "download", "mail", "scan-face", "users", "key-round", "log-out", "arrow-left", "flask", "x", "arrow-down-left", "arrow-up-right", "shield-check"];

const EXTRA_CSS = `
.tabs { display: flex; gap: 4px; margin-left: 18px; overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tabs a { padding: 7px 11px; border-radius: 10px; text-decoration: none; color: var(--muted); font-weight: 600; font-size: 14px; white-space: nowrap; }
.tabs a[aria-current="page"] { color: var(--text); background: var(--sunken); }
.who-am-i { display: none; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; white-space: nowrap; }
.signed-in .who-am-i { display: inline-flex; }
.who-am-i button { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 6px; border-radius: 8px; display: inline-flex; }
.who-am-i button:hover { color: var(--text); background: var(--sunken); }
.signed-out .tabs, .signed-out .who-am-i { display: none; }
header.top .test { margin-left: 12px; }
header.top .spacer { margin-left: auto; }
.auth { max-width: 460px; margin: 7vh auto 40px; padding: 28px; }
.auth h1 { font-size: 26px; letter-spacing: -.02em; margin: 0 0 6px; }
.auth p { color: var(--muted); margin: 0 0 18px; }
.auth label { display: block; font-weight: 650; font-size: 14px; margin: 14px 0 6px; }
.field { width: 100%; font: inherit; padding: 11px 13px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
.field:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.addr { display: flex; align-items: center; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; }
.addr .field { border: 0; border-radius: 0; min-width: 0; }
.addr span { padding: 0 12px; color: var(--muted); font-size: 14px; white-space: nowrap; }
.auth .btn.primary { width: 100%; justify-content: center; margin-top: 18px; }
.auth .alt { margin-top: 14px; font-size: 14px; text-align: center; }
.note-ok, .note-bad, .note-info { padding: 10px 13px; border-radius: 12px; font-size: 14px; font-weight: 550; margin: 12px 0 0; }
.note-ok { background: var(--ok-soft); color: var(--ok); }
.note-bad { background: var(--bad-soft); color: var(--bad); }
.note-info { background: var(--sunken); color: var(--muted); }
.steps { list-style: none; padding: 0; margin: 18px 0 18px; display: grid; gap: 10px; }
.auth .inbox { margin: 0 0 12px; }
.auth .btn + .btn, .auth .note-ok + .btn { margin-left: 8px; }
.auth p + .btn, .auth .once + p { margin-top: 12px; }
.steps li { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.steps li .n { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--sunken); color: var(--muted); font-weight: 700; font-size: 13px; }
.steps li.done .n { background: var(--ok-soft); color: var(--ok); }
.steps li.now { border-color: var(--accent); }
.steps li.now .n { background: var(--accent); color: #fff; }
.steps li b { display: block; }
.steps li span.s { color: var(--muted); font-size: 14px; }
.cmd { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.55; background: var(--sunken); padding: 12px 14px; border-radius: 12px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 10px 0 0; }
.waits { margin-top: 22px; }
.form-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin-top: 12px; }
.form-row > div { flex: 1 1 180px; min-width: 0; }
.form-row label { display: block; font-size: 13px; font-weight: 650; color: var(--muted); margin-bottom: 5px; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th { text-align: left; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; font-weight: 650; padding: 10px 14px; background: var(--sunken); }
.table td { padding: 11px 14px; border-top: 1px solid var(--border); vertical-align: top; overflow-wrap: anywhere; }
.table td.r, .table th.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.scroll { overflow-x: auto; }
.pill { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 12.5px; font-weight: 650; background: var(--sunken); color: var(--muted); }
.pill.ok { background: var(--ok-soft); color: var(--ok); } .pill.bad { background: var(--bad-soft); color: var(--bad); } .pill.warn { background: var(--warn-soft); color: var(--warn); }
.split2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; }
@media (max-width: 900px) { .split2 { grid-template-columns: minmax(0, 1fr); } }
.panel h2 { margin: 0 0 12px; font-size: 17px; }
.findings { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.findings li { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; }
.findings li .ic { flex: none; margin-top: 2px; }
.findings li.block { color: var(--bad); } .findings li.review, .findings li.wait { color: var(--warn); } .findings li.ok { color: var(--ok); }
.timeline { list-style: none; margin: 0; padding: 0 0 0 4px; display: grid; gap: 12px; }
.timeline li { padding-left: 16px; border-left: 2px solid var(--border); font-size: 14px; }
.timeline li b { display: block; }
.timeline li span { color: var(--muted); }
.once { border: 1px dashed var(--warn); background: var(--warn-soft); color: var(--text); padding: 12px 14px; border-radius: 12px; margin-top: 12px; font-size: 14px; }
.once code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.expired { max-width: 460px; margin: 10vh auto; text-align: center; }
@media (max-width: 900px) {
  /* Two rows on a phone or a narrow window: the brand, who is signed in and the test-money label; then the pages. */
  header.top .wrap { height: auto; flex-wrap: wrap; row-gap: 0; padding-top: 10px; }
  header.top nav.tabs { order: 9; flex: 1 0 100%; margin: 6px 0 0; padding-bottom: 8px; }
  .who-am-i #who { max-width: 46vw; overflow: hidden; text-overflow: ellipsis; }
}
@media (max-width: 640px) {
  header.top .test .tl { display: none; }
  .who-am-i #who { max-width: 52vw; }
  .auth { margin-top: 3vh; padding: 20px; }
}
`;

const BODY = `
<header class="top"><div class="wrap"><a class="brand" href="#/"><span class="mk">P</span><span>Purser</span><span class="sec">Cloud</span></a>
<nav class="tabs" id="tabs" aria-label="Pages"><a href="#/overview" data-tab="overview">Overview</a><a href="#/invoices" data-tab="invoices">Invoices</a><a href="#/transactions" data-tab="transactions">Transactions</a><a href="#/books" data-tab="books">Books</a><a href="#/settings" data-tab="settings">Settings</a></nav>
<span class="spacer"></span>
<span class="who-am-i"><span id="who"></span><button type="button" id="out" title="Sign out" aria-label="Sign out">${svg("log-out", 16)}</button></span>
<span class="test" title="This build pays only in the Airwallex sandbox">${svg("flask", 14)}<span class="tl"> Test money</span></span></div></header>
<main><div class="wrap" id="view" aria-live="polite"></div></main>
<p class="foot wrap">Purser Cloud · test money only: payments go through the Airwallex sandbox, approved on the CFO's phone with Face ID. The console never pays.</p>`;

// The client: plain JS (no template literals in it, so it can sit in this file as a raw string).
const SCRIPT = String.raw`
const IC=__ICONS__;
const CFG=JSON.parse(document.querySelector('meta[name=purser-cloud]').content);
const $=(s)=>document.querySelector(s);
const el=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids??[])){if(k===null||k===undefined||k===false)continue;e.append(typeof k==='string'?document.createTextNode(k):k)}return e};
const ic=(name)=>{const s=document.createElement('span');s.className='ic';s.innerHTML=IC[name]||'';return s};
const btn=(label,cls,icon)=>{const b=el('button','btn'+(cls?' '+cls:''),[icon?ic(icon):null,label]);b.type='button';return b};
const group=(int)=>int.replace(/\B(?=(\d{3})+(?!\d))/g,',');
const cents=(c)=>{const n=Math.round(Number(c)||0);const neg=n<0;const a=Math.abs(n);return (neg?'-':'')+group(String(Math.floor(a/100)))+'.'+String(a%100).padStart(2,'0')};
const amount=(v)=>{const m=/^(-?)(\d+)\.(\d{2})$/.exec(String(v||''));return m?m[1]+group(m[2])+'.'+m[3]:String(v||'')};
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const day=(iso)=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso||'');return m?(+m[3])+' '+MONTHS[+m[2]-1]+' '+m[1]:''};
const stamp=(iso)=>{const d=new Date(iso);if(isNaN(d))return '';return day(iso)+', '+String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0')+' UTC'};
const today=new Date().toISOString().slice(0,10);
const view=()=>$('#view');
const note=(text,tone)=>el('p','note-'+(tone||'info'),text);
const chip=(status,words)=>el('span','st '+String(status||'').replace(/[^a-z_]/g,''),words||String(status||'').replace(/_/g,' '));
const dl=(pairs)=>{const d=el('dl','read');for(const [k,v,cls] of pairs){if(v===null||v===undefined||v==='')continue;d.append(el('dt','',k));const dd=el('dd',cls||'');if(v instanceof Node)dd.append(v);else dd.textContent=String(v);d.append(dd)}return d};

// Base64url and the passkey: WebAuthn hands out ArrayBuffers; the API takes base64url.
const b64u=(buf)=>{let s='';for(const b of new Uint8Array(buf))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const fromB64u=(s)=>{const n=s.replace(/-/g,'+').replace(/_/g,'/');const bin=atob(n+'==='.slice((n.length+3)%4));return Uint8Array.from(bin,(c)=>c.charCodeAt(0))};
const assertionOf=(cred)=>({authenticatorData:b64u(cred.response.authenticatorData),clientDataJSON:b64u(cred.response.clientDataJSON),signature:b64u(cred.response.signature)});
const hasPasskeys=()=>!!(window.PublicKeyCredential&&navigator.credentials);

// The session: in this tab only, gone when it closes or after 15 minutes.
const KEY='purser.cloud.session';
const load=()=>{try{const s=JSON.parse(sessionStorage.getItem(KEY)||'null');return s&&s.exp>Date.now()?s:null}catch(e){return null}};
const save=(s)=>{try{sessionStorage.setItem(KEY,JSON.stringify(s))}catch(e){}};
const forget=()=>{try{sessionStorage.removeItem(KEY)}catch(e){}};
let S=load();let ME=null;let notice=null;

class Expired extends Error{}
async function api(path,o){
  o=o||{};const token=o.token||(S&&S.token);
  const headers={};if(token)headers.authorization='Bearer '+token;if(o.body!==undefined)headers['content-type']='application/json';
  const r=await fetch(path,{method:o.method||'GET',headers,body:o.body===undefined?undefined:JSON.stringify(o.body)});
  if(r.status===401&&!o.token&&S){forget();S=null;ME=null;notice='Your sign-in ended (sessions last 15 minutes). Sign in again with your passkey.';go('#/sign-in');throw new Expired('signed out')}
  if(o.raw){if(!r.ok){const j=await r.json().catch(()=>({error:r.statusText}));throw new Error(j.error||r.statusText)}return r}
  const j=await r.json().catch(()=>({error:r.statusText}));
  if(!r.ok)throw new Error(j.error||r.statusText);
  return j}
async function download(path,name){const r=await api(path,{raw:true});const url=URL.createObjectURL(await r.blob());const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000)}
const go=(h)=>{if(location.hash===h)route();else location.hash=h};

function shell(){
  document.body.className=S?'signed-in':'signed-out';
  if(S){const left=Math.max(0,Math.round((S.exp-Date.now())/60000));$('#who').textContent=(ME&&ME.user&&ME.user.display_name?ME.user.display_name+' · ':'')+(ME&&ME.tenant?ME.tenant.name+' · ':'')+'ends in '+left+' min'}
  const tab=(location.hash.split('/')[1]||'').split('?')[0];
  for(const a of document.querySelectorAll('#tabs a'))if(a.dataset.tab===tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
}
async function me(){if(!ME)ME=await api('/v1/me');return ME}
const title=(t)=>{document.title=t?'Purser Cloud · '+t:'Purser Cloud'};
const head=(h,sub,tools)=>el('div','head',[el('div','',[el('h1','',h),sub?el('p','lede',sub):null]),tools?el('div','tools',tools):null]);

// --- Signing in -------------------------------------------------------------------------------------------------
async function signIn(slug,status){
  status.replaceChildren(note('Waiting for your passkey …'));
  const ch=await api('/v1/auth/challenge',{method:'POST',body:{tenant:slug},token:'-'});
  const cred=await navigator.credentials.get({publicKey:{challenge:fromB64u(ch.challenge),rpId:CFG.rpId,userVerification:'required',timeout:60000}});
  const r=await api('/v1/auth/login',{method:'POST',token:'-',body:{tenant:slug,challenge_id:ch.challenge_id,credential_id:b64u(cred.rawId),assertion:assertionOf(cred)}});
  S={token:r.session,exp:Date.now()+r.expires_in*1000-5000,slug:slug};save(S);ME=null;
}
function signInView(){
  title('Sign in');
  const slug=el('input','field');slug.id='slug';slug.autocomplete='organization';slug.placeholder='your-company';slug.spellcheck=false;
  try{slug.value=localStorage.getItem('purser.cloud.slug')||''}catch(e){}
  const status=el('div','');status.setAttribute('role','status');
  const b=btn('Sign in with your passkey','primary big','scan-face');
  const card=el('div','card auth',[el('h1','','Sign in'),el('p','','Purser Cloud keeps your company\'s supplier invoices, payments and books in one place. Sign in with the passkey on your phone or computer: no password.'),
    el('label','','Company address'),el('div','addr',[slug,el('span','',CFG.mailDomain?'@'+CFG.mailDomain:'.purser')]),b,status,
    el('p','alt',['New company? ',(()=>{const a=el('a','','Set it up');a.href='#/start';return a})()])]);
  if(notice){status.append(note(notice,'bad'));notice=null}
  if(!hasPasskeys()){b.disabled=true;status.append(note('This browser has no passkeys. Use a current Safari, Chrome, Edge or Firefox.','bad'))}
  b.onclick=async()=>{const s=slug.value.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,40}$/.test(s)){status.replaceChildren(note('A company address is lowercase letters, digits and dashes.','bad'));return}
    b.disabled=true;try{await signIn(s,status);try{localStorage.setItem('purser.cloud.slug',s)}catch(e){}go('#/overview')}catch(e){if(!(e instanceof Expired))status.replaceChildren(note(e.name==='NotAllowedError'?'The passkey was cancelled or timed out.':e.message,'bad'))}finally{b.disabled=false}};
  slug.onkeydown=(e)=>{if(e.key==='Enter')b.click()};
  view().replaceChildren(card);slug.focus();
}

// --- A passkey made and enrolled: two prompts, one to make it, one to prove it by signing the enrolment's secret ----
async function enrolPasskey(o){
  const userId=crypto.getRandomValues(new Uint8Array(16));
  const made=await navigator.credentials.create({publicKey:{rp:{id:CFG.rpId,name:'Purser Cloud'},user:{id:userId,name:o.name,displayName:o.name},challenge:crypto.getRandomValues(new Uint8Array(32)),
    pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{userVerification:'required',residentKey:'required'},attestation:'none',timeout:120000}});
  const spki=new Uint8Array(made.response.getPublicKey());
  // A P-256 key in SPKI ends with 0x04, x (32 bytes), y (32 bytes).
  const pt=spki.slice(spki.length-65);if(pt[0]!==4)throw new Error('this passkey does not use a P-256 key');
  const signed=await navigator.credentials.get({publicKey:{challenge:fromB64u(o.token),rpId:CFG.rpId,allowCredentials:[{type:'public-key',id:made.rawId}],userVerification:'required',timeout:120000}});
  await api('/v1/auth/enrol',{method:'POST',token:'-',body:{tenant:o.slug,enrolment_id:o.enrolment_id,token:o.token,credential_id:b64u(made.rawId),x:b64u(pt.slice(1,33)),y:b64u(pt.slice(33,65)),assertion:assertionOf(signed)}});
}

// --- First run: a new company, with the owner key Purser handed over ------------------------------------------------
function startView(){
  title('Set up your company');
  let key='',slug='',info=null,sync=null;
  const box=el('div','card auth');
  const steps=el('ol','steps');const status=el('div','');status.setAttribute('role','status');
  function stepItem(n,t,s,state){return el('li',state||'',[el('span','n',state==='done'?ic('circle-check'):String(n)),el('div','',[el('b','',t),el('span','s',s)])])}
  function draw(stage){
    steps.replaceChildren(
      stepItem(1,'Your company','The address Purser gave you and the starter key that came with it.',stage>1?'done':'now'),
      stepItem(2,'Your passkey','Face ID, Touch ID or your device\'s lock: it signs you in and nothing else can.',stage>2?'done':stage===2?'now':''),
      stepItem(3,'Your inbox and your computer','Where suppliers mail invoices, and the one command that connects Purser on your computer.',stage===3?'now':''));
  }
  const body=el('div','');
  function stage1(){
    draw(1);
    const s=el('input','field');s.placeholder='your-company';s.spellcheck=false;s.id='start-slug';
    const k=el('input','field');k.type='password';k.placeholder='pck_…';k.autocomplete='off';k.id='start-key';
    const b=btn('Continue','primary big');
    body.replaceChildren(el('label','','Company address'),el('div','addr',[s,el('span','',CFG.mailDomain?'@'+CFG.mailDomain:'.purser')]),el('label','','Starter key'),k,
      note('The starter key is used once, here, to make your passkey; afterwards you can revoke it. It is never stored by this page.'),b);
    b.onclick=async()=>{slug=s.value.trim().toLowerCase();key=k.value.trim();
      try{info=await api('/v1/me',{token:key});if(info.tenant.slug!==slug)throw new Error('this key belongs to another company');if(!info.user)throw new Error('this key is not an owner\'s key');stage2()}catch(e){status.replaceChildren(note(e.message,'bad'))}};
  }
  function stage2(){
    draw(2);status.replaceChildren();
    const name=el('input','field');name.value=info.tenant.name||'';name.id='start-name';
    const b=btn('Make my passkey','primary big','scan-face');
    body.replaceChildren(el('label','','Company name'),name,info.owner_has_passkey?note('An owner of this company already has a passkey: sign in instead, and add people under Settings.','bad'):null,b);
    if(info.owner_has_passkey)b.disabled=true;
    if(!hasPasskeys()){b.disabled=true;status.append(note('This browser has no passkeys.','bad'))}
    b.onclick=async()=>{b.disabled=true;try{
      if(name.value.trim()&&name.value.trim()!==info.tenant.name)await api('/v1/company',{method:'POST',token:key,body:{name:name.value.trim()}});
      status.replaceChildren(note('Follow your device: first to make the passkey, then to sign with it …'));
      const e=await api('/v1/users/'+encodeURIComponent(info.user.id)+'/enrolment',{method:'POST',token:key});
      await enrolPasskey({slug,name:(info.user.display_name||'Owner')+' · '+slug,enrolment_id:e.enrolment_id,token:e.token});
      status.replaceChildren(note('Passkey saved. Now sign in with it once …','ok'));
      await signIn(slug,status);
      stage3()}catch(e){if(!(e instanceof Expired))status.replaceChildren(note(e.name==='NotAllowedError'?'The passkey was cancelled or timed out.':e.message,'bad'));b.disabled=false}};
  }
  async function stage3(){
    draw(3);status.replaceChildren();
    ME=null;const m=await me();
    const inbox=m.inbox?el('p','inbox',[ic('mail'),' Suppliers mail invoices to ',el('b','mono',m.inbox)]):note('Your inbox address appears here once mail is routed to Purser Cloud.');
    const make=btn('Make the key for my computer','primary','key-round');
    const out=el('div','');
    const revoke=btn('Revoke the starter key','danger','x');
    body.replaceChildren(inbox,el('p','',['Connect Purser on your computer (the runner, which holds the bank keys and pays only after the CFO\'s Face ID) with a key that may only push data here:']),make,out,
      el('p','',['The starter key can go now: you sign in with your passkey from here on.']),revoke,
      (()=>{const a=el('a','btn big','Open the console');a.href='#/overview';return a})());
    make.onclick=async()=>{make.disabled=true;try{sync=await api('/v1/keys',{method:'POST',body:{name:'runner (sync)',scopes:['sync'],expires_in_days:90}});
      out.replaceChildren(el('div','once',[el('b','','Shown once. '),'Run this on the computer that runs Purser (keep the key in its environment, never in a file in git):',
        el('code','cmd','PURSER_CLOUD_URL='+CFG.origin+' PURSER_CLOUD_KEY='+sync.api_key+' npm run cloud -- push')]))}catch(e){out.replaceChildren(note(e.message,'bad'));make.disabled=false}};
    revoke.onclick=async()=>{revoke.disabled=true;try{await api('/v1/keys/'+encodeURIComponent(info.principal),{method:'DELETE'});revoke.replaceWith(note('The starter key is revoked.','ok'));key=''}catch(e){revoke.disabled=false;out.append(note(e.message,'bad'))}};
  }
  box.append(el('h1','','Set up your company'),el('p','','Three steps, about two minutes. Test money only: Purser Cloud pays nothing; payments are approved on the CFO\'s phone.'),steps,body,status);
  view().replaceChildren(box);stage1();
}

// --- An invited person makes their passkey (the owner shares the link; its secret is in the fragment, never sent) ---
function enrolView(q){
  title('Make your passkey');
  const status=el('div','');status.setAttribute('role','status');
  const b=btn('Make my passkey','primary big','scan-face');
  const card=el('div','card auth',[el('h1','','Make your passkey'),el('p','',['You were added to ',el('b','',q.get('t')||''),' on Purser Cloud. Your passkey signs you in; there is no password.']),b,status]);
  if(!q.get('t')||!q.get('e')||!q.get('k')){b.disabled=true;status.append(note('This link is incomplete. Ask an owner for a new one.','bad'))}
  if(!hasPasskeys()){b.disabled=true;status.append(note('This browser has no passkeys.','bad'))}
  b.onclick=async()=>{b.disabled=true;try{status.replaceChildren(note('Follow your device: first to make the passkey, then to sign with it …'));
    await enrolPasskey({slug:q.get('t'),name:q.get('n')||q.get('t'),enrolment_id:q.get('e'),token:q.get('k')});
    history.replaceState(null,'','#/sign-in');try{localStorage.setItem('purser.cloud.slug',q.get('t'))}catch(e){}
    status.replaceChildren(note('Done. Sign in with your new passkey.','ok'));setTimeout(()=>go('#/sign-in'),900)}catch(e){status.replaceChildren(note(e.name==='NotAllowedError'?'The passkey was cancelled or timed out.':e.message,'bad'));b.disabled=false}};
  view().replaceChildren(card);
}

// --- Overview ------------------------------------------------------------------------------------------------------
const byCur=(m)=>Object.entries(m||{}).filter(([,v])=>v!==0).sort(([a],[b])=>a.localeCompare(b));
function money(m,emptyWord){const e=byCur(m);if(!e.length)return emptyWord||'None';const s=el('span','');s.append(el('small','',e[0][0]),cents(e[0][1]));return s}
function others(m){const e=byCur(m).slice(1);return e.length?e.map(([c,v])=>c+' '+cents(v)).join(' · '):''}
function tile(label,icon,value,extra,tone){const t=el('div','card tile'+(tone?' '+tone:''));const v=el('div','v num');if(value instanceof Node)v.append(value);else v.textContent=value;t.append(el('div','l',[ic(icon),label]),v);if(extra)t.append(el('div','x',extra));return t}
const REASON={possible_fraud:'possible fraud',duplicate:'a copy of an invoice on file',iban_invalid:'an invalid IBAN',sum_mismatch:'amounts that do not add up',bank_details_invalid:'invalid bank details',payee_blocked:'a blocked supplier'};
async function overviewView(){
  title('Overview');
  const [m,x,w]=await Promise.all([me(),api('/v1/insights'),api('/v1/invoices?status=waiting_cfo&limit=50')]);shell();
  const blocked=Object.entries(x.blocked_by_reason||{}).sort((a,b)=>b[1]-a[1]);const nb=blocked.reduce((n,[,c])=>n+c,0);
  const waits=x.waiting.for_cfo+x.waiting.for_supplier_check+x.waiting.for_a_person;
  const tiles=el('div','tiles',[
    tile('Open','wallet',money(x.open_net_cents,'Nothing open'),[others(x.open_net_cents),byCur(x.credits_cents).length?'after credit notes':''].filter(Boolean).join(' · ')||null),
    tile('Due in 7 days','calendar-range',money(x.due_7_days_cents),byCur(x.due_30_days_cents).length?'30 days: '+byCur(x.due_30_days_cents).map(([c,v])=>c+' '+cents(v)).join(' · '):'Nothing due in 30 days'),
    tile('Overdue','clock',money(x.overdue_cents),byCur(x.overdue_cents).length?others(x.overdue_cents)||'Pay or check these first':'Every open invoice is in time',byCur(x.overdue_cents).length?'alert':'calm'),
    tile('Waits for someone','inbox',String(waits),x.waiting.for_cfo+' Face ID · '+x.waiting.for_a_person+' check · '+x.waiting.for_supplier_check+' supplier'),
    tile('Blocked','octagon-x',String(nb),blocked.length?'Most: '+(REASON[blocked[0][0]]||blocked[0][0].replace(/_/g,' ')):'Nothing blocked',nb?'alert':'calm')]);
  const inbox=m.inbox?el('p','inbox',[ic('mail'),' Suppliers mail invoices to ',el('b','mono',m.inbox)]):null;
  const wl=el('div','card list');
  if(!w.items.length)wl.append(el('div','empty',[el('b','','Nothing waits for the CFO'),'When an invoice is filed for payment, it waits here until the CFO approves or rejects it on the phone.']));
  else{wl.append(rowHead());for(const i of w.items)wl.append(invoiceRow(i))}
  view().replaceChildren(head('Overview',(m.tenant.name||'')+': what is open, what is due, what waits.'),inbox,tiles,
    el('section','section waits',[el('div','bar',[el('h2','','Waits for the CFO\'s Face ID')]),wl,note('Purser Cloud shows these; it does not pay them. The CFO approves each one on the phone, against its exact terms.')]));
}

// --- Invoices ------------------------------------------------------------------------------------------------------
function why(i){if(i.status==='paid')return 'Paid'+(i.paid_at?' '+day(i.paid_at):'');if(i.status==='ready')return 'All checks passed';if(i.status==='waiting_cfo')return 'Waits for the CFO\'s Face ID';const fs=i.findings||[];const f=fs.filter(x=>x.level!=='warn')[0]||fs[0];return f?String(f.detail||'').charAt(0).toUpperCase()+String(f.detail||'').slice(1):''}
const rowHead=()=>el('div','row th',[el('span','','Supplier'),el('span','','Invoice'),el('span','','Due'),el('span','amt','Amount'),el('span','','Status'),el('span','','Why'),el('span','')]);
function invoiceRow(i){
  const a=el('a','row');a.href='#/invoices/'+encodeURIComponent(i.id);
  const sup=el('span','sup',i.vendor||'Unknown supplier');sup.title=i.vendor||'';
  const no=el('span','no',[i.invoice_no||'(no number)',el('span','sub',i.id)]);no.title=i.invoice_no||'';
  const late=i.due_date&&i.due_date<today&&!['paid','rejected'].includes(i.status);
  const w=why(i);const wy=el('span','why',w);wy.title=w;
  a.append(sup,no,el('span','due num'+(late?' late':''),i.due_date?day(i.due_date):'–'),el('span','amt',[el('span','c',i.currency||''),amount(i.total)||'–']),el('span','stc',[chip(i.status,i.status_words)]),wy);
  const g=ic('chevron-right');g.className='go';a.append(g);return a}
const FILTERS=[['all','All',()=>true],['act','To act on',(i)=>['ready','needs_review','needs_vendor'].includes(i.status)],['waiting_cfo','Waits for Face ID',(i)=>i.status==='waiting_cfo'],['paid','Paid',(i)=>i.status==='paid'],['blocked','Blocked',(i)=>i.status==='blocked'],['rejected','Rejected',(i)=>i.status==='rejected']];
async function invoicesView(){
  title('Invoices');
  let all=[];let cursor=null;let filter='all';
  const list=el('div','card list');const bar=el('div','bar',[el('h2','','Invoices')]);const more=btn('Load more');more.hidden=true;
  function draw(){
    bar.querySelectorAll('.chip').forEach(c=>c.remove());
    for(const [k,label,fn] of FILTERS){const n=all.filter(fn).length;if(k!=='all'&&!n&&k!=='act')continue;const b=el('button','chip',[label,' ',el('b','',String(n))]);b.type='button';b.setAttribute('aria-pressed',String(filter===k));b.onclick=()=>{filter=k;draw()};bar.append(b)}
    list.replaceChildren();
    if(!all.length){list.append(el('div','empty',[el('b','','No invoices yet'),'Invoices arrive here when suppliers mail them to your inbox, or when Purser on your computer pushes them.']));return}
    const shown=all.filter(FILTERS.find(f=>f[0]===filter)[2]).slice().reverse();
    list.append(rowHead());if(!shown.length)list.append(el('div','empty',[el('b','','Nothing here'),'No invoice is in this state right now.']));
    for(const i of shown)list.append(invoiceRow(i));
  }
  async function page(){const p=await api('/v1/invoices?limit=200'+(cursor?'&cursor='+encodeURIComponent(cursor):''));all=all.concat(p.items);cursor=p.next_cursor;more.hidden=!cursor;draw()}
  more.onclick=()=>page();
  view().replaceChildren(head('Invoices','Every supplier invoice Purser read and checked, as your computer last pushed it. Read only here.'),el('section','section',[bar,list,more]));
  await page();
}
const RES={block:['octagon-x','Blocks payment'],review:['triangle-alert','Needs a person'],wait:['clock','Waits'],warn:['triangle-alert','Note']};
async function invoiceView(id){
  title('Invoice');
  const i=await api('/v1/invoices/'+encodeURIComponent(id));const r=i.reading||{};
  title((i.vendor||'Invoice')+' '+(i.invoice_no||i.id));
  const late=i.due_date&&i.due_date<today&&!['paid','rejected'].includes(i.status);
  const back=el('a','back',[ic('arrow-left'),' All invoices']);back.href='#/invoices';
  const top=el('div','dhead',[el('div','who',[el('h1','',i.vendor||'Unknown supplier'),el('div','meta',[chip(i.status,i.status_words),el('span','','Invoice '+(i.invoice_no||'(no number)')),el('span','','·'),el('span','',i.id),el('span','','·'),el('span','','Received '+day(i.received_at))])]),
    el('div','money',[el('div','big',[el('small','',i.currency||''),amount(i.total)||'–']),el('div','when',i.status==='paid'&&i.paid_at?'Paid '+day(i.paid_at):i.due_date?(late?'Was due ':'Due ')+day(i.due_date):'No due date')])]);
  const acct=r.iban?'IBAN …'+String(r.iban).slice(-4):r.account_number?'Account …'+String(r.account_number).slice(-4):(i.iban_last4?'…'+i.iban_last4:'');
  const read=el('div','card panel',[el('h2','','What Purser read'),dl([['Supplier',r.vendor||i.vendor],['VAT number',r.vat_id],['Invoice number',r.invoice_no||i.invoice_no],['Invoice date',day(r.issue_date||i.issue_date)],['Due date',day(r.due_date||i.due_date)],
    ['Subtotal',r.subtotal?(r.currency||i.currency)+' '+amount(r.subtotal):''],['VAT',r.tax?(r.currency||i.currency)+' '+amount(r.tax):''],['Total',(r.currency||i.currency||'')+' '+amount(r.total||i.total)],
    ['Pay to',[acct,r.bic?'BIC '+r.bic:''].filter(Boolean).join(' · '),'mono'],['Bank country',r.bank_country],['Reference',r.reference],['Booked to',i.gl_account?(i.gl_account+(i.cost_centre?' · '+i.cost_centre:'')):'']])]);
  const fs=i.findings||[];const fl=el('ul','findings');
  if(!fs.length)fl.append(el('li','ok',[ic('circle-check'),el('span','','Every check passed.')]));
  for(const f of fs){const m=RES[f.level]||['circle-minus',f.level];fl.append(el('li',f.level,[ic(m[0]),el('span','',[el('b','',m[1]+': '),String(f.detail||f.code||'')])]))}
  const checks=el('div','card panel',[el('h2','','Checks'),fl]);
  const tl=el('ul','timeline');
  tl.append(el('li','',[el('b','','Received'),el('span','',stamp(i.received_at))]));
  for(const v of i.earlier_versions||[])tl.append(el('li','',[el('b','','Changed (version '+v.version+' replaced)'),el('span','',stamp(v.replaced_at))]));
  if(i.status==='waiting_cfo')tl.append(el('li','',[el('b','','Filed for the CFO\'s Face ID'),el('span','',i.proposal_id?'Payment '+i.proposal_id:'')]));
  if(i.paid_at)tl.append(el('li','',[el('b','','Paid'),el('span','',stamp(i.paid_at))]));
  tl.append(el('li','',[el('b','','Last update from your computer'),el('span','',stamp(i.updated_at))]));
  const getDoc=btn('Download the document','','download');
  getDoc.onclick=async()=>{getDoc.disabled=true;try{await download('/v1/invoices/'+encodeURIComponent(id)+'/document',(i.invoice_no||i.id).replace(/[^\w.-]+/g,'_')+'.pdf')}catch(e){if(!(e instanceof Expired))getDoc.after(note(e.message,'bad'))}finally{getDoc.disabled=false}};
  const doc=el('div','card panel',[el('h2','','Document'),el('p','',['The invoice as received (',i.doc_sha256?'SHA-256 '+String(i.doc_sha256).slice(0,12)+'…':'',').']),getDoc,
    note('Payments are approved on the CFO\'s phone with Face ID, against these exact terms; nothing here pays.')]);
  view().replaceChildren(back,top,el('div','split2',[read,el('div','',[checks,el('div','card panel',[el('h2','','Timeline'),tl]),doc])]));
}

// --- Transactions --------------------------------------------------------------------------------------------------
const RAILS=[['','Every rail'],['airwallex_transfer','Transfers'],['airwallex_fx','FX'],['airwallex_card','Cards'],['airi','Airi'],['airwallex_deposit','Money in'],['metal','Metal'],['metal_clearing','Metal clearing']];
const RECS=[['','Every state'],['matched','Booked and matched'],['missing_booking','Not booked'],['missing_rail_record','No rail record'],['amount_mismatch','Amounts differ']];
async function transactionsView(){
  title('Transactions');
  const q=new URLSearchParams();
  const sel=(opts,key)=>{const s=el('select','field');for(const [v,l] of opts){const o=el('option','',l);o.value=v;s.append(o)}s.onchange=()=>{if(s.value)q.set(key,s.value);else q.delete(key);load()};return s};
  const cur=el('input','field');cur.placeholder='EUR';cur.maxLength=4;cur.onchange=()=>{const v=cur.value.trim().toUpperCase();if(/^[A-Z]{3,4}$/.test(v))q.set('currency',v);else q.delete('currency');load()};
  const from=el('input','field');from.type='date';from.onchange=()=>{if(from.value)q.set('from',from.value);else q.delete('from');load()};
  const to=el('input','field');to.type='date';to.onchange=()=>{if(to.value)q.set('to',to.value);else q.delete('to');load()};
  const csv=btn('CSV','','download');csv.onclick=()=>download('/v1/transactions/export.csv?'+q.toString(),'transactions.csv').catch(e=>{if(!(e instanceof Expired))list.before(note(e.message,'bad'))});
  const tiles=el('div','tiles');const list=el('div','card list');
  const filters=el('div','form-row',[el('div','',[el('label','','Rail'),sel(RAILS,'rail')]),el('div','',[el('label','','State'),sel(RECS,'reconciliation')]),el('div','',[el('label','','Currency'),cur]),el('div','',[el('label','','From'),from]),el('div','',[el('label','','To'),to])]);
  view().replaceChildren(head('Transactions','Every money movement on every rail: what moved, under whose approval, how it is booked and how it proves itself.',[csv]),tiles,filters,el('section','section',[list]));
  async function load(){
    const [s,p]=await Promise.all([api('/v1/transactions/summary?'+q.toString()),api('/v1/transactions?limit=200&'+q.toString())]);
    const tot=s.totals||[];const inn={},out={},fee={};for(const t of tot){inn[t.currency]=Math.round(Number(t.in||0)*100);out[t.currency]=Math.round(Number(t.out||0)*100);if(t.fees)fee[t.currency]=Math.round(Number(t.fees)*100)}
    tiles.replaceChildren(tile('In','arrow-down-left',money(inn),others(inn)||null),tile('Out','arrow-up-right',money(out),others(out)||null),tile('Fees','wallet',money(fee),'What the rails charged'),
      tile('Not reconciled','shield-check',String(s.check.unreconciled),s.check.unreconciled?'Look at these':'Every movement matches its booking',s.check.unreconciled?'alert':'calm'),
      tile('Without approval','octagon-x',String(s.check.without_approval.length),s.check.without_approval.length?'Money moved with no approval on file':'Every one was approved',s.check.without_approval.length?'alert':'calm'));
    list.replaceChildren(el('div','trow th',[el('span','','Date'),el('span','','What'),el('span','','Rail'),el('span','amt','Amount'),el('span','','Status'),el('span','','Books'),el('span','')]));
    if(!p.items.length)list.append(el('div','empty',[el('b','','No movements'),'Nothing matches these filters.']));
    for(const r of p.items){const b=el('div','trow');
      const amt=el('span','amt'+(r.flow==='in'?' in':''),[el('span','c',r.currency),(r.flow==='in'?'+':'−')+amount(r.amount)]);if(!r.moved)amt.classList.add('not');
      b.append(el('span','when',day(r.at)),el('span','what',[el('b','',r.counterparty||''),el('span','sub',r.description||'')]),el('span','rail',[r.rail_label||r.rail,el('span','sub',r.proof?String(r.proof).slice(0,18):'no proof')]),amt,
        el('span','',[el('span','pill '+(r.moved?'ok':'bad'),r.status_words||r.status)]),el('span','',[el('span','pill '+(r.reconciliation==='matched'?'ok':r.reconciliation==='not_applicable'?'':'warn'),r.reconciliation_words||r.reconciliation)]),el('span',''));
      list.append(b)}
    if(p.next_cursor)list.append(note('Showing the newest 200; narrow the filters or download the CSV for all of them.'));
  }
  await load();
}

// --- Books ---------------------------------------------------------------------------------------------------------
const RUBRIC={'1a':'1a Sales, high rate','1b':'1b Sales, low rate','1e':'1e Sales at 0% or not taxed here','2a':'2a Reverse charge in NL','3a':'3a Supplies to non-EU countries','3b':'3b Supplies within the EU','4a':'4a Services from outside the EU','4b':'4b Supplies and services from EU countries'};
async function booksView(){
  title('Books');
  const now=new Date();const qs=[];for(let k=0;k<6;k++){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-3*k,1));qs.push(d.getUTCFullYear()+'Q'+(Math.floor(d.getUTCMonth()/3)+1))}
  const pick=el('select','field');for(const v of qs){const o=el('option','',v);o.value=v;pick.append(o)}
  const vat=el('div','card panel');const journal=el('div','card panel');
  view().replaceChildren(head('Books','Purser\'s own bookkeeping, as your computer last pushed it: the VAT overview per quarter and the journal.'),el('div','split2',[vat,journal]));
  async function drawVat(){
    const v=await api('/v1/reports/vat?quarter='+encodeURIComponent(pick.value));
    const t=el('table','table',[el('thead','',[el('tr','',[el('th','','Rubric'),el('th','r','Base'),el('th','r','VAT')])])]);const tb=el('tbody','');
    for(const [k,r] of Object.entries(v.rubrics||{})){if(!r.base_cents&&!r.vat_cents)continue;tb.append(el('tr','',[el('td','',RUBRIC[k]||k),el('td','r','EUR '+cents(r.base_cents)),el('td','r','EUR '+cents(r.vat_cents))]))}
    if(!tb.children.length)tb.append(el('tr','',[el('td','','Nothing in this quarter'),el('td',''),el('td','')]));
    tb.append(el('tr','',[el('td','',el('b','','5a Owed')),el('td',''),el('td','r','EUR '+cents(v.owed_5a_cents))]),el('tr','',[el('td','',el('b','','5b Input VAT')),el('td',''),el('td','r','EUR '+cents(v.input_5b_cents))]),el('tr','',[el('td','',el('b','','5c To pay (or back)')),el('td',''),el('td','r',el('b','','EUR '+cents(v.balance_5c_cents)))]));
    t.append(tb);
    vat.replaceChildren(el('h2','','VAT overview'),el('div','form-row',[el('div','',[el('label','','Quarter'),pick])]),el('div','scroll',t),
      v.uncoded_lines?note(v.uncoded_lines+' line(s) carry VAT without a code: a person looks at them before filing.','bad'):null,note(v.notice||'An overview, not a filing.'));
  }
  pick.onchange=()=>drawVat().catch(e=>{if(!(e instanceof Expired))vat.append(note(e.message,'bad'))});
  const j=await api('/v1/ledger/entries?limit=30');
  const t=el('table','table',[el('thead','',[el('tr','',[el('th','','Date'),el('th','','Entry'),el('th','r','Debit'),el('th','r','Credit')])])]);const tb=el('tbody','');
  for(const e of j.items.slice().reverse()){tb.append(el('tr','',[el('td','',day(e.posting_date)),el('td','',[el('b','','#'+e.entry_id+' '),e.description||'']),el('td',''),el('td','')]));
    for(const l of e.lines||[])tb.append(el('tr','',[el('td',''),el('td','',l.account+(l.vat_code?' · VAT '+l.vat_code:'')),el('td','r',l.debit_cents?l.currency+' '+cents(l.debit_cents):''),el('td','r',l.credit_cents?l.currency+' '+cents(l.credit_cents):'')]))}
  if(!j.items.length)tb.append(el('tr','',[el('td','','No entries yet'),el('td',''),el('td',''),el('td','')]));
  t.append(tb);journal.replaceChildren(el('h2','','Journal'),el('div','scroll',t),note('Each entry is hash-chained to the one before it; the cloud refuses a push that would change one.'));
  await drawVat();
}

// --- Settings ------------------------------------------------------------------------------------------------------
async function settingsView(){
  title('Settings');
  const m=await me();
  const owner=m.scopes.includes('admin');
  const company=el('div','card panel',[el('h2','','Company'),dl([['Name',m.tenant.name],['Address',m.tenant.slug],['Inbox',m.inbox||'Not routed yet','mono']])]);
  if(!owner){view().replaceChildren(head('Settings'),company,note('Only an owner manages people, keys and the company\'s data. Ask an owner of '+m.tenant.name+'.'));return}
  const people=el('div','card panel');const keys=el('div','card panel');const data=el('div','card panel');
  view().replaceChildren(head('Settings','People, keys and your data. Only owners see this.'),company,el('div','split2',[people,keys]),data);
  async function drawPeople(){
    const u=await api('/v1/users?limit=200');
    const t=el('table','table',[el('thead','',[el('tr','',[el('th','','Person'),el('th','','Role'),el('th','')])])]);const tb=el('tbody','');
    for(const p of u.items){const acts=el('td','r');
      if(!p.erased_at){const inv=btn('Passkey link','','key-round');inv.onclick=async()=>{inv.disabled=true;try{const e=await api('/v1/users/'+encodeURIComponent(p.id)+'/enrolment',{method:'POST'});
          const link=CFG.origin+'/#/enrol?t='+encodeURIComponent(m.tenant.slug)+'&e='+encodeURIComponent(e.enrolment_id)+'&k='+encodeURIComponent(e.token)+'&n='+encodeURIComponent(p.display_name);
          people.append(el('div','once',[el('b','','Single use, for 30 minutes, for '+p.display_name+' only. '),'Send it to them yourself (not by e-mail to many): ',el('code','cmd',link)]))}catch(e){if(!(e instanceof Expired))people.append(note(e.message,'bad'))}finally{inv.disabled=false}};
        const er=btn('Erase','danger','x');er.onclick=async()=>{const typed=prompt('Erase '+p.display_name+'? Their personal data goes; the bookkeeping stays for 7 years. Type their name to confirm.');if(typed===null)return;if(typed.trim()!==p.display_name){people.append(note('The name did not match; nothing was erased.','bad'));return}
          try{await api('/v1/users/'+encodeURIComponent(p.id)+'/erase',{method:'POST'});await drawPeople()}catch(e){if(!(e instanceof Expired))people.append(note(e.message,'bad'))}};
        acts.append(inv,' ',er)}
      tb.append(el('tr','',[el('td','',[el('b','',p.erased_at?'(erased)':p.display_name),p.email?el('span','sub',' '+p.email):null]),el('td','',[el('span','pill'+(p.role==='owner'?' warn':''),p.role)]),acts]))}
    t.append(tb);
    const name=el('input','field');name.placeholder='Name';const role=el('select','field');for(const r of ['cfo','accountant','viewer','owner']){const o=el('option','',r);o.value=r;role.append(o)}
    const add=btn('Add person','primary');add.onclick=async()=>{if(!name.value.trim())return;add.disabled=true;try{await api('/v1/users',{method:'POST',body:{display_name:name.value.trim(),role:role.value}});await drawPeople()}catch(e){if(!(e instanceof Expired))people.append(note(e.message,'bad'))}finally{add.disabled=false}};
    people.replaceChildren(el('h2','','People'),el('div','scroll',t),el('div','form-row',[el('div','',[el('label','','Name'),name]),el('div','',[el('label','','Role'),role]),el('div','',[add])]),
      note('A person signs in with their own passkey, made from a single-use link you start here. A CFO, accountant or viewer reads; only owners manage.'));
  }
  async function drawKeys(){
    const k=await api('/v1/keys?limit=200');
    const t=el('table','table',[el('thead','',[el('tr','',[el('th','','Key'),el('th','','May'),el('th','','Expires'),el('th','')])])]);const tb=el('tbody','');
    for(const x of k.items){const live=!x.revoked_at&&x.expires_at>new Date().toISOString();const acts=el('td','r');
      if(live){const rv=btn('Revoke','danger','x');rv.onclick=async()=>{if(!confirm('Revoke '+x.name+'? Every key it made stops working too.'))return;try{await api('/v1/keys/'+encodeURIComponent(x.id),{method:'DELETE'});await drawKeys()}catch(e){if(!(e instanceof Expired))keys.append(note(e.message,'bad'))}};acts.append(rv)}
      tb.append(el('tr','',[el('td','',[el('b','',x.name),el('span','sub',' '+x.id)]),el('td','',x.scopes),el('td','',live?day(x.expires_at):[el('span','pill bad',x.revoked_at?'revoked':'expired')]),acts]))}
    t.append(tb);
    const name=el('input','field');name.placeholder='e.g. accountant export';const scope=el('select','field');for(const [v,l] of [['read','read'],['sync','sync (the runner)'],['read sync','read and sync']]){const o=el('option','',l);o.value=v;scope.append(o)}
    const days=el('input','field');days.type='number';days.min='1';days.max='365';days.value='90';
    const out=el('div','');
    const mk=btn('Make key','primary','key-round');mk.onclick=async()=>{if(!name.value.trim())return;mk.disabled=true;try{const r=await api('/v1/keys',{method:'POST',body:{name:name.value.trim(),scopes:scope.value.split(' '),expires_in_days:Math.max(1,Math.min(365,Number(days.value)||90))}});
        await drawKeys();keys.append(el('div','once',[el('b','','Shown once. '),'Copy it now into the place that uses it: ',el('code','cmd',r.api_key)]))}catch(e){if(!(e instanceof Expired))keys.append(note(e.message,'bad'))}finally{mk.disabled=false}};
    keys.replaceChildren(el('h2','','API keys'),el('div','scroll',t),el('div','form-row',[el('div','',[el('label','','Name'),name]),el('div','',[el('label','','May'),scope]),el('div','',[el('label','','Days'),days]),el('div','',[mk])]),out,
      note('For programs: your runner, an accountant\'s tool, an ERP. A key never has more than it needs, and expires.'));
  }
  const exp=btn('Download everything (JSON)','','download');exp.onclick=()=>download('/v1/export','purser-cloud-export.json').catch(e=>{if(!(e instanceof Expired))data.append(note(e.message,'bad'))});
  data.replaceChildren(el('h2','','Your data'),el('p','','Everything Purser Cloud holds for '+m.tenant.name+', as one file: invoices, payments, the register, the books and the audit trail. Documents are listed by their SHA-256.'),exp);
  await Promise.all([drawPeople(),drawKeys()]);
}

// --- The router ----------------------------------------------------------------------------------------------------
async function route(){
  const h=location.hash||'#/';const [path,qs]=h.slice(1).split('?');const q=new URLSearchParams(qs||'');
  S=load();shell();
  const open={'/sign-in':signInView,'/start':startView};
  try{
    if(path==='/enrol')return enrolView(q);
    if(open[path])return open[path]();
    if(!S)return go('#/sign-in');
    if(path==='/'||path==='')return go('#/overview');
    view().replaceChildren(el('p','lede','Loading …'));
    const m=/^\/invoices\/([^/]+)$/.exec(path);
    if(m)return await invoiceView(decodeURIComponent(m[1]));
    const pages={'/overview':overviewView,'/invoices':invoicesView,'/transactions':transactionsView,'/books':booksView,'/settings':settingsView};
    if(!pages[path])return view().replaceChildren(el('div','expired',[el('h1','','Not here'),(()=>{const a=el('a','btn','Back to the overview');a.href='#/overview';return a})()]));
    await pages[path]();shell();
  }catch(e){if(e instanceof Expired)return;view().replaceChildren(note('Could not load this page: '+e.message,'bad'))}
}
$('#out').onclick=async()=>{try{await api('/v1/auth/logout',{method:'POST'})}catch(e){}forget();S=null;ME=null;go('#/sign-in')};
window.addEventListener('hashchange',route);
setInterval(()=>{if(S&&S.exp<=Date.now()){forget();S=null;ME=null;notice='Your sign-in ended (sessions last 15 minutes). Sign in again with your passkey.';go('#/sign-in')}else shell()},30000);
route();
`;

const nonce = () => {
  const b = crypto.getRandomValues(new Uint8Array(18));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

/** The console's page: one document, its config in a meta tag (the origin, the passkey RP id, the mail domain). */
export function consolePage(n: string, cfg: { origin: string; rpId: string; mailDomain: string }): string {
  const script = SCRIPT.replace("__ICONS__", ICON_SET(ICONS));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="purser-cloud" content="${escAttr(JSON.stringify(cfg))}">
<title>Purser Cloud</title>
<style nonce="${n}">${PAYABLES_CSS}${EXTRA_CSS}</style></head><body class="signed-out">
${BODY}
<script type="module" nonce="${n}">${script}</script>
</body></html>`;
}

export const consoleCsp = (n: string) =>
  `default-src 'none'; script-src 'nonce-${n}'; style-src 'nonce-${n}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`;

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin", "permissions-policy": "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
};

let font: Uint8Array | null = null;

/** Everything outside /v1: the console page at /, its font, and a plain 404. Only GET and HEAD. */
export function consoleResponse(req: Request, url: URL, env: CloudEnv): Response {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" } });
  if (url.pathname === "/") {
    const n = nonce();
    return new Response(consolePage(n, { origin: env.origin, rpId: env.rpId, mailDomain: env.mailDomain ?? "" }), { status: 200, headers: { ...PAGE_HEADERS, "content-security-policy": consoleCsp(n) } });
  }
  if (url.pathname === "/assets/inter.woff2") {
    font ??= fromB64(INTER_WOFF2_B64);
    return new Response(new Uint8Array(font), { status: 200, headers: { "content-type": "font/woff2", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
  }
  return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
}
