// The coverage view of the zero-trust model: ways money leaves (rows) against layers (columns). Each cell lists the
// attacks that prove that layer stops that way out with the layers inside it already breached. Built from the model
// alone (src/zerotrust/model.ts); the tests then hold every listed attack to the real code (test/zero-trust.test.ts).

import { ATTACKS, LAYERS, MONEY_PATHS, guardsOf, isMoneyPath, type Attack, type LayerId, type MoneyPath } from "./model.js";

/**
 * What a layer owes a way money leaves. guards: it stops the path's hostile payment on its own, always. optional: it
 * does so once the company switches the control on. records: it finds the change afterwards, and a pause or the
 * emergency stop refuses what comes next (L6). none: it does not guard this path (the model's PathSpec says why).
 */
export type CellDuty = "guards" | "optional" | "records" | "none";

export interface CoverageCell {
  path: MoneyPath;
  layer: LayerId;
  duty: CellDuty;
  /** The path's guarding layers inside this one. A proof in this cell has every one of them breached. */
  inner: LayerId[];
  /** Attacks on this path that this layer stops with every inner layer breached: the proof the cell asks for. */
  attacks: string[];
  /** Attacks on this path that this layer stops while an inner layer was not breached: evidence, not that proof. */
  also: string[];
}

export interface CoverageView {
  /** The columns: every layer that can stop something. The agent (L1) is assumed hostile and never stops anything. */
  layers: LayerId[];
  rows: { path: MoneyPath; cells: CoverageCell[] }[];
  /** The cells that should hold a proof: a layer that guards the path (always or once switched on), and the record. */
  shouldBeCovered: { path: MoneyPath; layer: LayerId }[];
  /** The cells that should hold a proof and hold none. */
  empty: { path: MoneyPath; layer: LayerId }[];
}

/** The ways money leaves that an attack tries: its target when that is one, and any others its test tries too. */
export function pathsOf(a: Pick<Attack, "target" | "alsoTries">): MoneyPath[] {
  const all = [...(isMoneyPath(a.target) ? [a.target] : []), ...(a.alsoTries ?? [])];
  return MONEY_PATHS.map((p) => p.id).filter((p) => all.includes(p));
}

/**
 * The layers inside `layer` on a path: the path's guards (optional ones included) that come before it. For the
 * record (L6) that is the agent alone, where the agent guards the path: a pause or a stop answers an agent that
 * ignores it, and acts through Purser's code and the rail, so those are not assumed breached there.
 */
export function innerLayers(path: MoneyPath, layer: LayerId): LayerId[] {
  const order = LAYERS.map((l) => l.id);
  const guards = guardsOf(path, true).filter((g) => order.indexOf(g) < order.indexOf(layer));
  return LAYERS.find((l) => l.id === layer)!.kind === "detects" ? guards.filter((g) => LAYERS.find((l) => l.id === g)!.kind === "untrusted") : guards;
}

function dutyOf(path: MoneyPath, layer: LayerId): CellDuty {
  if (LAYERS.find((l) => l.id === layer)!.kind === "detects") return "records";
  if (guardsOf(path, false).includes(layer)) return "guards";
  return guardsOf(path, true).includes(layer) ? "optional" : "none";
}

/** The coverage view of the tested attacks. Pending attacks (PENDING_ATTACKS: no test yet) are not in it: they prove nothing. */
export function coverageView(attacks: readonly Attack[] = ATTACKS): CoverageView {
  const layers = LAYERS.filter((l) => l.kind !== "untrusted").map((l) => l.id);
  const counted = attacks;
  const rows = MONEY_PATHS.map((p) => ({
    path: p.id,
    cells: layers.map((layer): CoverageCell => {
      const inner = innerLayers(p.id, layer);
      const stopped = counted.filter((a) => a.stoppedBy === layer && pathsOf(a).includes(p.id));
      const proves = (a: Attack) => inner.every((l) => a.bypasses.includes(l));
      return { path: p.id, layer, duty: dutyOf(p.id, layer), inner, attacks: stopped.filter(proves).map((a) => a.id), also: stopped.filter((a) => !proves(a)).map((a) => a.id) };
    }),
  }));
  const cells = rows.flatMap((r) => r.cells);
  const shouldBeCovered = cells.filter((c) => c.duty !== "none").map(({ path, layer }) => ({ path, layer }));
  const empty = cells.filter((c) => c.duty !== "none" && c.attacks.length === 0).map(({ path, layer }) => ({ path, layer }));
  return { layers, rows, shouldBeCovered, empty };
}
