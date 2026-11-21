// Purser Cloud's console: the company and the session around the pages (21 Nov, the owner: "the company block becomes a
// real switcher", "one tidy session block", "if you connect you get an extra tab"). Here:
//   cw()          this module's words, English and Dutch (and the charts' two hints)
//   the switcher  the company in the sidebar's top block: its page one click away, the companies this browser has
//                 signed in to (each opens the sign-in with its address filled in; a session is one company's), the
//                 demo company, and "Set up a new company" (the existing first run, #/start)
//   the session   who is signed in, a countdown that formats itself and updates, and sign out, in one block
//   Company page  #/company: the company at a glance from the API's own answers (nothing is typed in here)
//   connected     a tab in the menu for each connection this company really has (Airwallex, Claude), read from the
//                 same state the Connections page shows; the demo company shows what its demo world has
// Every value from the API is put on the page as text (el() and textContent), never as HTML. The console's script
// carries this at __UI__ (cloud/src/console.ts).

/** This module's words, English and Dutch. */
export const CO_WORDS = {
  en: {
    tap_open: "Tap again to open", click_open: "Click to open the list", net_so_far: "Net so far",
  },
  nl: {
    tap_open: "Tik nog eens om te openen", click_open: "Klik om de lijst te openen", net_so_far: "Netto tot nu",
  },
} as const;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export const COMPANY_JS = String.raw`
// --- The company, the session and the connected tabs (21 Nov) ---------------------------------------------------------
const CO_W=` + json(CO_WORDS) + String.raw`;
function cw(k,v){const W=CO_W[L.lang==='nl'?'nl':'en'];let s=W[k]??CO_W.en[k]??k;for(const [a,b] of Object.entries(v||{}))s=s.split('{'+a+'}').join(String(b));return s}
`;

export const COMPANY_CSS = `
`;
