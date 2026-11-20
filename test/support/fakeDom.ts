// A small stand-in DOM for page scripts that build their screens with createElement (src/approve/client.ts): enough
// of Node, Element, classList, dataset, events and simple selectors to run the page's code in the test process and
// read what it drew. Selectors: tag, #id, .class, [attr] and [attr="value"], combined (a.back, link[rel="manifest"]),
// and descendant chains ("header .sub"). Text is what the page put there, joined as textContent joins it.

type Listener = (e: FakeEvent) => unknown;
export interface FakeEvent { type: string; target: FakeElement; isTrusted: boolean; preventDefault(): void }

export class FakeText {
  parentElement: FakeElement | null = null;
  constructor(public data: string) {}
  get textContent(): string { return this.data; }
  set textContent(v: string) { this.data = v; }
  remove(): void { this.parentElement?.removeChild(this); }
}

export type FakeNode = FakeElement | FakeText;

class ClassList {
  constructor(private readonly owner: FakeElement) {}
  private get set(): string[] { return this.owner.className.split(/\s+/).filter(Boolean); }
  contains(c: string): boolean { return this.set.includes(c); }
  add(...cs: string[]): void { this.owner.className = [...new Set([...this.set, ...cs])].join(" "); }
  remove(...cs: string[]): void { this.owner.className = this.set.filter((c) => !cs.includes(c)).join(" "); }
  toggle(c: string, force?: boolean): boolean {
    const on = force ?? !this.contains(c);
    if (on) this.add(c); else this.remove(c);
    return on;
  }
}

const camelToData = (k: string) => `data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;

export class FakeElement {
  parentElement: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  className = "";
  attributes = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  disabled = false;
  hidden = false;
  value = "";
  type = "";
  href = "";
  title = "";
  lang = "";
  focused = 0;
  readonly classList = new ClassList(this);
  readonly dataset: Record<string, string | undefined>;
  // Assigned by the page as plain properties (input settings); kept so nothing throws.
  [key: string]: unknown;

  constructor(public readonly tagName: string, private readonly doc: FakeDocument) {
    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get: (_t, k) => (typeof k === "string" ? this.attributes.get(camelToData(k)) : undefined),
      set: (_t, k, v) => { this.attributes.set(camelToData(String(k)), String(v)); return true; },
    });
  }

  get id(): string { return this.attributes.get("id") ?? ""; }
  set id(v: string) { this.attributes.set("id", v); }
  get children(): FakeElement[] { return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement); }
  get textContent(): string { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(v: string) { this.replaceChildren(); if (v !== "") this.appendChild(new FakeText(String(v))); }
  get ownerDocument(): FakeDocument { return this.doc; }

  setAttribute(k: string, v: string): void { this.attributes.set(k, String(v)); }
  getAttribute(k: string): string | null { return this.attributes.get(k) ?? null; }
  hasAttribute(k: string): boolean { return this.attributes.has(k); }

  private adopt(n: FakeNode | string): FakeNode {
    const node = typeof n === "string" ? new FakeText(n) : n;
    node.parentElement?.removeChild(node);
    node.parentElement = this;
    return node;
  }
  removeChild(n: FakeNode): void { this.childNodes = this.childNodes.filter((c) => c !== n); n.parentElement = null; }
  appendChild<T extends FakeNode>(n: T): T { this.childNodes.push(this.adopt(n)); return n; }
  append(...ns: (FakeNode | string)[]): void { for (const n of ns) this.childNodes.push(this.adopt(n)); }
  prepend(...ns: (FakeNode | string)[]): void { this.childNodes.unshift(...ns.map((n) => this.adopt(n))); }
  replaceChildren(...ns: (FakeNode | string)[]): void {
    for (const c of this.childNodes) c.parentElement = null;
    this.childNodes = [];
    this.append(...ns);
  }
  after(...ns: (FakeNode | string)[]): void {
    const p = this.parentElement;
    if (!p) return;
    const at = p.childNodes.indexOf(this) + 1;
    const nodes = ns.map((n) => p["adopt"](n) as FakeNode);
    p.childNodes.splice(at, 0, ...nodes);
  }
  remove(): void { this.parentElement?.removeChild(this); }
  focus(): void { this.focused++; this.doc.activeElement = this; }

  addEventListener(type: string, fn: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  /** Runs the listeners as a person's own event would, and returns what they returned (async handlers' promises). */
  dispatch(type: string, isTrusted = true): unknown[] {
    const e: FakeEvent = { type, target: this, isTrusted, preventDefault: () => undefined };
    return (this.listeners.get(type) ?? []).map((fn) => fn(e));
  }
  /** A press: awaits the click handlers (async ones included). */
  async click(isTrusted = true): Promise<void> { await Promise.all(this.dispatch("click", isTrusted)); }

  /** Every element under this one, depth first. */
  descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (e: FakeElement) => { for (const c of e.children) { out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelectorAll(sel: string): FakeElement[] { return this.descendants().filter((e) => matches(e, sel, this)); }
  querySelector(sel: string): FakeElement | null { return this.querySelectorAll(sel)[0] ?? null; }
  matches(sel: string): boolean { return matches(this, sel, null); }
  closest(sel: string): FakeElement | null {
    if (this.matches(sel)) return this;
    return this.parentElement ? this.parentElement.closest(sel) : null;
  }
}

function matchesSimple(e: FakeElement, s: string): boolean {
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(s))) {
    consumed += m[0].length;
    if (m[1] && e.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
    if (m[2] && e.id !== m[2]) return false;
    if (m[3] && !e.classList.contains(m[3])) return false;
    if (m[4]) {
      const v = m[4] === "id" ? (e.id || null) : m[4] === "class" ? e.className : e.getAttribute(m[4]);
      if (v === null || (m[5] !== undefined && v !== m[5])) return false;
    }
  }
  if (consumed !== s.length) throw new Error(`fakeDom: selector not supported: ${s}`);
  return true;
}

function matches(e: FakeElement, sel: string, root: FakeElement | null): boolean {
  return sel.split(",").map((x) => x.trim()).some((one) => {
    const parts = one.split(/\s+/);
    if (!matchesSimple(e, parts[parts.length - 1]!)) return false;
    let at: FakeElement | null = e.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (at && at !== root && !matchesSimple(at, parts[i]!)) at = at.parentElement;
      if (!at || at === root) return false;
      at = at.parentElement;
    }
    return true;
  });
}

export class FakeDocument {
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  readonly head: FakeElement;
  activeElement: FakeElement | null = null;
  constructor() {
    this.documentElement = new FakeElement("html", this);
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.documentElement.append(this.head, this.body);
  }
  createElement(tag: string): FakeElement { return new FakeElement(tag, this); }
  createElementNS(_ns: string, tag: string): FakeElement { return new FakeElement(tag, this); }
  createTextNode(s: string): FakeText { return new FakeText(s); }
  getElementById(id: string): FakeElement | null { return this.documentElement.descendants().find((e) => e.id === id) ?? null; }
  querySelectorAll(sel: string): FakeElement[] { return this.documentElement.querySelectorAll(sel); }
  querySelector(sel: string): FakeElement | null { return this.documentElement.querySelector(sel); }
}

/** A page as the relay serves it: a header line, the app's box and the sheet, and the body's data-page. */
export function pageDocument(page?: string, o: { manifest?: boolean } = {}): FakeDocument {
  const d = new FakeDocument();
  if (o.manifest) { const l = d.createElement("link"); l.setAttribute("rel", "manifest"); d.head.append(l); }
  const header = d.createElement("header");
  const sub = d.createElement("span");
  sub.className = "sub";
  sub.textContent = "Approvals · Kit 11";
  header.append(sub);
  const app = d.createElement("main");
  app.id = "app";
  const sheet = d.createElement("div");
  sheet.id = "sheet";
  sheet.hidden = true;
  d.body.append(header, app, sheet);
  if (page) d.body.dataset.page = page;
  return d;
}

/** The visible words of an element, whitespace collapsed. */
export const textOf = (e: FakeElement | null | undefined): string => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
