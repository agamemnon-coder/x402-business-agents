// Purser Cloud's Connections page (20 Nov, the owner: "Purser connects to everything and everyone, findable in Purser
// Cloud"; 21 Nov: its own tab, one card per connection). The list GET /v1/connections returns (cloud/src/connections.ts),
// in six sections by what a company connects: money rails, bookkeeping and ERP, AI and agents, messaging and alerts, the
// API, data and export, sign-in and workspace (the hub, docs/integrations/README.md, keeps its own groups). Each card:
// the product's own logo (or letters, or an icon for Purser's own ways in and out), the name, its honest label (live,
// sandbox, testnet, format export, built and not tested live, run once in a sandbox, planned), one line on what it does,
// where it stands for THIS company (GET /v1/connections/mine, when the reader may see it), the rest and what a company
// needs to connect it folded, and its guide and dated run record. Buttons only where the console really does something
// (o.action, cloud/src/console.ts); nothing here claims more than the catalogue's label.
//
// One implementation serves the console and its test: CONNECTIONS_VIEW_JS is plain script the console carries as it is
// (cloud/src/console.ts puts it in at __UI__), and test/connections-hub.test.ts runs the same text with a stand-in for
// the page's el(). It builds elements only through el() and sets text as text; it calls nothing and reads no clock.

import { AIRWALLEX_LOGO_DATA_URL } from "./awxLogo.gen.js";
import { BRAND_LOGOS } from "./brandLogos.gen.js";

export const CONNECTIONS_VIEW_JS = String.raw`
// --- Connections ----------------------------------------------------------------------------------------------------
// 21 Nov (the owner): six sections a company reads by what it wants to connect. The catalogue keeps its own groups (the
// hub); the console sorts the cards into these by id, and a card whose id is not listed goes under API, data and export.
const CX_SECTIONS=[['rails',['airwallex','alta','visa-airi']],
  ['books',['xero','xero-runner','xero-csv','quickbooks','quickbooks-csv','exact','exact-csv','moneybird','bc-odoo','t0','peppol-ubl','peppol-network']],
  ['ai',['claude','mcp','chatgpt','cursor','vscode','gemini','windsurf','awx-codemode','agent-api','a2a']],
  ['msg',['slack-teams','alerts','inbox']],
  ['data',['rest','webhook','sdks','zapier-make','n8n','export','iso20022']],
  ['work',['sign-in','workplace']]];
const cxSlug=(s)=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
// The label's colour: live green, test money (sandbox, testnet, a run once in a sandbox) blue, built and not yet tried
// live amber, a file in another product's format and planned grey.
const CX_TONE={live:'ok',sandbox:'tmoney',testnet:'tmoney',built_run_once_in_a_sandbox:'tmoney',built_not_tested_live:'warn',planned:'plan'};
// Each card's mark: the products' own logos where they are on record (src/ui/logos/README.md; the page passes them in as logos), else
// letters; an icon for Purser's own ways in and out.
const CX_LOGO={airwallex:['airwallex'],alta:['alta'],'visa-airi':['visa'],claude:['claude'],mcp:['mcp'],chatgpt:['chatgpt'],cursor:['cursor'],vscode:['vscode'],
  gemini:['gemini'],windsurf:['windsurf'],'awx-codemode':['airwallex'],sdks:['typescript','python'],'zapier-make':['zapier','make'],n8n:['n8n'],
  'xero-csv':['xero'],'xero-runner':['xero'],xero:['xero'],'quickbooks-csv':['quickbooks'],quickbooks:['quickbooks'],'exact-csv':['exact'],exact:['exact'],
  moneybird:['moneybird'],'bc-odoo':['microsoft','odoo'],'slack-teams':['slack','teams'],inbox:['gmail','microsoft'],'sign-in':['google','microsoft','apple'],
  alerts:['whatsapp','slack','teams'],workplace:['google','microsoft']};
const CX_MARK={t0:'T:0','peppol-ubl':'P','peppol-network':'P',iso20022:'ISO'};
const CX_ICON={'agent-api':'credit-card',rest:'link-2',webhook:'zap',a2a:'sparkles',export:'download'};
// Where a connection stands for this company, from the rows of GET /v1/connections/mine it names: connected when one of
// them is, not offered when none of them is offered on this cloud, else not connected (the company can switch it on).
function cxHere(ids,mine){
  if(!mine||!ids||!ids.length)return null;
  const rows=mine.filter((x)=>ids.includes(x.id));if(!rows.length)return null;
  const on=rows.filter((x)=>x.status==='connected');
  return {status:on.length?'connected':rows.every((x)=>x.status==='not_available')?'not_available':'not_connected',detail:on.map((x)=>x.detail).filter(Boolean).join(' · ')||null}}
// The first sentence on the card; the rest, word for word, one click away.
function cxSplit(s){const m=/^(.+?[.!?])\s+(\S[^]*)$/.exec(String(s||''));return m?[m[1],m[2]]:[String(s||''),'']}
function cxSection(id){for(const [k,ids] of CX_SECTIONS)if(ids.includes(id))return k;return 'data'}
function connectionsViewOf(cat,t,tk,el,o){
  o=o||{};const mine=o.mine||null;
  const link=(href,text)=>{if(!/^https?:\/\//.test(String(href||'')))return null;const a=el('a','',text+' ↗');a.href=href;a.target='_blank';a.rel='noopener';return a};
  const all=[].concat(cat.money||[],cat.connections||[]);const planned=cat.planned||[];
  const n=(f)=>all.filter(f).length;
  const here=mine?all.filter((x)=>{const h=cxHere(x.company,mine);return h&&h.status==='connected'}).length:null;
  const stat=(v,label,tone)=>el('div','cx-stat'+(tone?' '+tone:''),[el('b','num',String(v)),el('span','',label)]);
  const sum=el('div','cx-sum',[here===null?null:stat(here,t('cs.cx.sum.here'),'here'),stat(n((x)=>x.kind==='live'),t('cs.cx.sum.live'),'ok'),
    stat(n((x)=>['sandbox','testnet','built, run once in a sandbox'].includes(x.kind)),t('cs.cx.sum.test'),'tmoney'),stat(n((x)=>x.kind==='format export'),t('cs.cx.sum.file'),''),
    stat(n((x)=>x.kind==='built, not tested live'),t('cs.cx.sum.built'),'warn'),stat(planned.length,t('cs.cx.sum.planned'),'plan')]);
  const kids=[el('h2','',t('cs.cx.title')),el('p','sub',t('cs.cx.lede')),sum,el('p','sub cx-links',[link(cat.connect_ai,t('cs.claude.guide')),' · ',link(cat.hub,t('cs.cx.hub'))])];
  const mark=(x)=>{
    const keys=(CX_LOGO[x.id]||[]).filter((k)=>o.logos&&o.logos[k]);
    // A wordmark (Airwallex, Alta, Visa) gets a wider tile than a symbol.
    if(keys.length)return el('span','cx-mark cx-logos n'+keys.length+(keys.some((k)=>k==='airwallex'||k==='alta'||k==='visa')?' wide':''),keys.map((k)=>{const i=el('img','k-'+k);i.src=o.logos[k].uri;i.alt=o.logos[k].name;i.decoding='async';return i}));
    if(CX_ICON[x.id]&&o.icon)return el('span','cx-mark ic-mark',[o.icon(CX_ICON[x.id])]);
    return el('span','cx-mark cx-letters',CX_MARK[x.id]||String(x.name||'?').slice(0,2))};
  const card=(x,kind)=>{
    const k=cxSlug(kind),tone=CX_TONE[k],h=cxHere(x.company,mine),[first,rest]=cxSplit(x.what);
    const needs=x.needs?el('p','cx-needs',[el('b','',t('cs.cx.needs')+' '),x.needs]):null;
    return el('li','cx-card'+(h&&h.status==='connected'?' on':'')+(k==='planned'?' planned':''),[
      el('div','cx-top',[mark(x),el('div','cx-nm',[el('b','',x.name),el('span','pill'+(tone?' '+tone:''),tk('cs.cx.kind.'+k,kind))])]),
      el('p','cx-what',first),
      h?el('p','cx-here '+h.status,[el('i',''),el('span','',t('cs.cx.here.'+h.status)),h.detail?el('span','sub',' · '+h.detail):null]):null,
      rest||needs?el('details','cx-more',[el('summary','',t('cs.cx.more')),rest?el('p','',rest):null,needs]):null,
      el('div','cx-acts',[o.action?o.action(x):null,link(x.doc,t('cs.cx.guide')),link(x.record,t('cs.cx.record'))])])};
  // Connected first, then the catalogue's order; planned last.
  const on=(x)=>{const h=cxHere(x.company,mine);return h&&h.status==='connected'?0:1};
  for(const [g] of CX_SECTIONS){
    const items=all.filter((x)=>cxSection(x.id)===g),later=planned.filter((x)=>cxSection(x.id)===g);
    if(!items.length&&!later.length)continue;
    const sorted=items.map((x,i)=>[x,i]).sort((a,b)=>on(a[0])-on(b[0])||a[1]-b[1]).map((p)=>p[0]);
    kids.push(el('h2','sub-h',[tk('cs.cx.sec.'+g,g),el('span','cx-n num',String(items.length+later.length))]),el('ul','plain cx-grid',[...sorted.map((x)=>card(x,x.kind)),...later.map((x)=>card(x,'planned'))]));
  }
  kids.push(el('p','note-info',t('cs.cx.rule')));
  return kids;
}
`;

/**
 * The marks the cards show, as data URLs (the console's img-src allows data:): every file of cloud/src/brandLogos.gen.ts
 * and the Airwallex wordmark of the "Built on" badge. The console passes them to connectionsViewOf as o.logos.
 */
export const CONNECTIONS_LOGOS_JS = `const BRAND_LOGOS=${JSON.stringify({ airwallex: { name: "Airwallex", uri: AIRWALLEX_LOGO_DATA_URL }, ...Object.fromEntries(Object.entries(BRAND_LOGOS).map(([k, v]) => [k, { name: v.name, uri: v.uri }])) }).replace(/</g, "\\u003c")};\n`;
