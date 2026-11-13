import { proofPage } from "../src/redesign/proof.js";
const h = proofPage();
const m = /<main[\s\S]*<\/main>/.exec(h)![0];
const i = m.indexOf("657909460959"); console.log(m.slice(i - 300, i + 40));
