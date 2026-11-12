// The zero-trust report, built from the model (src/zerotrust/model.ts) and from what the matrix measured
// (test/zero-trust.test.ts writes its results as JSON when ZERO_TRUST_OUT names a file). Pure: no file, no clock, no
// network. `npm run zero-trust` (src/cli/zeroTrust.ts) writes docs/zero-trust/report.json and docs/zero-trust.md from
// it, and a test at the end of the matrix holds the committed files to what this builds from that run's own results.
//
// Nothing here is typed as a result: every number is counted from the results or from the model, and every sentence
// that makes a claim is the model's (PRINCIPLE, READING, the attacks, the limits) or a test's own record.

import { coverageView, type CoverageView } from "./coverage.js";
import {
  ATTACKS, COMPONENTS, FIXES, LAYERS, LIMITS, MONEY_PATHS, PENDING_ATTACKS, PRINCIPLE, RAIL_REFUSALS, READING, STAND_INS,
  type ComponentId, type Evidence, type Fix, type Layer, type LayerId, type Limit, type MoneyPath, type Owner, type RailRefusal, type StandIn, type Target,
} from "./model.js";

export const REPORT_JSON = "docs/zero-trust/report.json";
export const REPORT_MARKDOWN = "docs/zero-trust.md";

// ---------------------------------------------------------------------------------------------------------------------
// What the matrix writes.

export interface DepthMode {
  depth: number; layers_that_must_fail: LayerId[]; combinations_tried: number; combinations_where_money_moved: number;
  /** Each guard alone, holding while every other guard of the path has failed: how that push ended. */
  last_line: { held: LayerId; failed: LayerId[]; ended: string }[];
}

export interface HostileRun {
  attack: string; task: string; agent: string; tried: number; refused_by_code: number; refused_at_a_rail: number; ran_inside_the_limits: number;
  /** The tools whose calls ran inside the limits, by name: a reader sees what "inside" was. */
  inside: string[];
}

export interface HostileModel {
  tool_calls_tried: number; refused_by_code: number; refused_at_a_rail: number; ran_inside_the_limits: number;
  unsafe_by_ledger_verdict: number;
  verdict: { by: string; ledgers: number; unsafe: number; double_payments: number; missing_origin: number; payment_details_withheld_by_code: string[]; not_judged: string[] };
  money_moved: number;
  runs: HostileRun[];
  swept: { flow: string; tools: string[] }[];
  not_counted: string;
}

/** One run of test/zero-trust.test.ts. A part is absent when its tests did not run (a run filtered with -t). */
export interface MatrixResults {
  /** The numbers a page may quote, counted by the test from the rest of this object when the whole file ran. */
  summary?: {
    attacks_run: number; attacks_stopped: number; attacks_where_money_moved: number; layers: number;
    minimum_depth: number; minimum_depth_with_optional_controls: number;
    hostile_tool_calls_tried: number; hostile_tool_calls_refused_by_code: number; hostile_tool_calls_unsafe_by_ledger_verdict: number;
    pending_attacks: number; holes_found_and_fixed: number; open_limits: number;
  };
  attacks: { id: string; test: string; moved: number; stopped_by: LayerId; control: string; record: string }[];
  depth?: {
    layers_counted: LayerId[]; record_not_counted: string;
    paths: { path: MoneyPath; optional_off: DepthMode; optional_on: DepthMode }[];
    stop_in_force: { path: MoneyPath; failed: LayerId[]; moved: boolean; ended: string }[];
  };
  property?: { seed: number; runs: number; moved_with_every_guard_void: number; moved_with_a_guard_holding: number };
  coverage?: CoverageView;
  pending?: { id: string; description: string; pending: string; waits_for: string }[];
  hostile_model?: HostileModel;
}

// ---------------------------------------------------------------------------------------------------------------------
// The report.

/** The day and the commit the matrix was run on. The only part of the report that is not a result. */
export interface Generated { date: string; commit: string }

export interface ReportAttack {
  id: string; description: string; target: Target; also_tries: MoneyPath[]; action: string;
  /** What the attacker is assumed to control. */
  breach: { id: ComponentId; name: string }[];
  /** The layers the breach gets past. */
  bypassed: LayerId[];
  stopped_by: { layer: LayerId; name: string; owner: Owner; control: string };
  needs: string | null; note: string | null;
  /** Payments beyond what was signed, as the test counted them. */
  moved: number;
  evidence: { /** Its test in test/zero-trust.test.ts. */ test: string; /** What the stop left behind. */ record: string; /** The same refusal on the live rails, when a run record shows it. */ live: Evidence | null };
}

type Minimum = { depth: number; paths: MoneyPath[] };

export interface Report {
  // The numbers a page may quote.
  attacks_run: number; attacks_stopped: number; attacks_where_money_moved: number;
  layers: number;
  /** The smallest depth over the ways money leaves, with the optional controls off. */
  min_depth: number;
  /** The same with four eyes and Airwallex's transfer approval switched on. */
  min_depth_with_optional_controls: number;
  hostile_tool_calls: number; hostile_refused_by_code: number; hostile_refused_by_rail: number; hostile_ran_inside_limits: number; hostile_unsafe_by_ledger: number;
  holes_found_and_fixed: number;
  // What they mean.
  principle: string[];
  reading: typeof READING;
  layer_list: Layer[];
  attacks: ReportAttack[];
  coverage: { paths: { id: MoneyPath; name: string }[] } & CoverageView;
  depth: {
    layers_counted: LayerId[]; record_not_counted: string;
    minimum: { optional_off: Minimum; optional_on: Minimum };
    paths: { path: MoneyPath; name: string; hostile: string; optional: { layer: LayerId; when: string }[]; not_counted: string | null; optional_off: DepthMode; optional_on: DepthMode }[];
    stop_in_force: { path: MoneyPath; failed: LayerId[]; moved: boolean; ended: string }[];
    property: NonNullable<MatrixResults["property"]>;
  };
  hostile_model: HostileModel;
  stand_ins: { id: string; stands_for: string; stand_in: string; behaves: string }[];
  rail_refusals: { id: RailRefusal["id"]; rail: RailRefusal["rail"]; answer: string; stand_in: string; source: string; live: Evidence | null }[];
  /** Every run record cited above, once, with who cites it. */
  live_records: (Evidence & { cited_by: string[] })[];
  fixes: Fix[];
  /** Listed apart: no test, no result, in no count. */
  pending: { counted: false; note: string; rows: { id: string; description: string; target: Target; action: string; breach: { id: ComponentId; name: string }[]; expected_stop: LayerId; pending: string; waits_for: string }[] };
  open_risks: Limit[];
  generated: Generated;
}

const layerOf = (id: LayerId): Layer => LAYERS.find((l) => l.id === id)!;
const breachOf = (ids: readonly ComponentId[]) => ids.map((id) => ({ id, name: COMPONENTS.find((c) => c.id === id)!.name }));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function minimum(paths: { path: MoneyPath; optional_off: DepthMode; optional_on: DepthMode }[], mode: "optional_off" | "optional_on"): Minimum {
  const depth = Math.min(...paths.map((p) => p[mode].depth));
  return { depth, paths: paths.filter((p) => p[mode].depth === depth).map((p) => p.path) };
}

/**
 * The report of one whole run of the matrix. Throws when the run was not whole (a filtered run proves less) or when
 * it disagrees with the model: an attack without a result, a result without an attack, another stopping layer, a
 * summary that does not add up.
 */
export function buildReport(results: MatrixResults, generated: Generated): Report {
  const { depth, property, hostile_model: hostile, coverage, pending } = results;
  if (!depth || !property || !hostile || !coverage || !pending || depth.paths.length !== MONEY_PATHS.length || depth.stop_in_force.length !== MONEY_PATHS.length) {
    throw new Error("the matrix did not run in full, so there is no report: run the whole of test/zero-trust.test.ts");
  }
  const known = new Set(ATTACKS.map((a) => a.id));
  for (const r of results.attacks) if (!known.has(r.id)) throw new Error(`a result for ${r.id}, which is not an attack in the model`);
  if (results.attacks.length !== ATTACKS.length) throw new Error(`the matrix did not run in full: ${results.attacks.length} results for ${ATTACKS.length} attacks`);
  const attacks = ATTACKS.map((a): ReportAttack => {
    const r = results.attacks.find((x) => x.id === a.id);
    if (!r) throw new Error(`the matrix did not run in full: no result for ${a.id}`);
    if (r.stopped_by !== a.stoppedBy) throw new Error(`${a.id} was stopped by ${r.stopped_by}; the model says ${a.stoppedBy}`);
    const layer = layerOf(a.stoppedBy);
    return {
      id: a.id, description: a.description, target: a.target, also_tries: [...(a.alsoTries ?? [])], action: a.action,
      breach: breachOf(a.breach), bypassed: [...a.bypasses],
      stopped_by: { layer: layer.id, name: layer.name, owner: layer.owner, control: r.control },
      needs: a.needs ?? null, note: a.note ?? null, moved: r.moved,
      evidence: { test: r.test, record: r.record, live: a.evidence ?? null },
    };
  });
  // The coverage view is the model's; the run reports the one its tests held, and the two must be one.
  const view = coverageView();
  if (!same(view, coverage)) throw new Error("the coverage view the matrix ran with is not the model's");
  if (!same(pending.map((p) => p.id), PENDING_ATTACKS.map((p) => p.id))) throw new Error("the pending attacks the matrix ran with are not the model's");
  for (const p of depth.paths) if (!MONEY_PATHS.some((m) => m.id === p.path)) throw new Error(`a depth for ${p.path}, which is not a way money leaves in the model`);

  const cited = new Map<string, Evidence & { cited_by: string[] }>();
  const cite = (e: Evidence | null | undefined, by: string) => {
    if (!e) return;
    const key = `${e.path}\n${e.quote}`;
    const row = cited.get(key) ?? { path: e.path, fact: e.fact, quote: e.quote, cited_by: [] };
    row.cited_by.push(by);
    cited.set(key, row);
  };
  for (const r of RAIL_REFUSALS) cite(r.live, `rail refusal ${r.id}`);
  for (const a of ATTACKS) cite(a.evidence, `attack ${a.id}`);

  const report: Report = {
    attacks_run: attacks.length,
    attacks_stopped: attacks.filter((a) => a.moved === 0).length,
    attacks_where_money_moved: attacks.filter((a) => a.moved !== 0).length,
    layers: LAYERS.length,
    min_depth: minimum(depth.paths, "optional_off").depth,
    min_depth_with_optional_controls: minimum(depth.paths, "optional_on").depth,
    hostile_tool_calls: hostile.tool_calls_tried,
    hostile_refused_by_code: hostile.refused_by_code,
    hostile_refused_by_rail: hostile.refused_at_a_rail,
    hostile_ran_inside_limits: hostile.ran_inside_the_limits,
    hostile_unsafe_by_ledger: hostile.unsafe_by_ledger_verdict,
    holes_found_and_fixed: FIXES.length,
    principle: [...PRINCIPLE],
    reading: READING,
    layer_list: LAYERS.map((l) => ({ ...l, where: [...l.where] })),
    attacks,
    coverage: { paths: MONEY_PATHS.map((p) => ({ id: p.id, name: p.name })), ...view },
    depth: {
      layers_counted: depth.layers_counted, record_not_counted: depth.record_not_counted,
      minimum: { optional_off: minimum(depth.paths, "optional_off"), optional_on: minimum(depth.paths, "optional_on") },
      paths: MONEY_PATHS.map((m) => {
        const p = depth.paths.find((x) => x.path === m.id)!;
        return { path: m.id, name: m.name, hostile: m.hostile, optional: m.optional.map((o) => ({ ...o })), not_counted: m.notCounted ?? null, optional_off: p.optional_off, optional_on: p.optional_on };
      }),
      stop_in_force: depth.stop_in_force,
      property,
    },
    hostile_model: hostile,
    stand_ins: STAND_INS.map((s: StandIn) => ({ id: s.id, stands_for: s.standsFor, stand_in: s.standIn, behaves: s.behaves })),
    rail_refusals: RAIL_REFUSALS.map((r) => ({ id: r.id, rail: r.rail, answer: r.answer, stand_in: r.standIn, source: r.source, live: r.live })),
    live_records: [...cited.values()],
    fixes: FIXES.map((f) => ({ ...f })),
    pending: {
      counted: false, note: READING.pending,
      rows: PENDING_ATTACKS.map((a) => ({ id: a.id, description: a.description, target: a.target, action: a.action, breach: breachOf(a.breach), expected_stop: a.stoppedBy, pending: a.pending, waits_for: a.waitsFor })),
    },
    open_risks: LIMITS.map((l) => ({ ...l })),
    generated: { date: generated.date, commit: generated.commit },
  };

  // The run's own summary, where it has one, must be these numbers.
  const s = results.summary;
  if (s) {
    const pairs: [string, number, number][] = [
      ["attacks run", s.attacks_run, report.attacks_run], ["attacks stopped", s.attacks_stopped, report.attacks_stopped], ["attacks where money moved", s.attacks_where_money_moved, report.attacks_where_money_moved],
      ["layers", s.layers, report.layers], ["minimum depth", s.minimum_depth, report.min_depth], ["minimum depth with optional controls", s.minimum_depth_with_optional_controls, report.min_depth_with_optional_controls],
      ["hostile tool calls", s.hostile_tool_calls_tried, report.hostile_tool_calls], ["hostile tool calls refused by code", s.hostile_tool_calls_refused_by_code, report.hostile_refused_by_code],
      ["hostile tool calls unsafe by the ledger verdict", s.hostile_tool_calls_unsafe_by_ledger_verdict, report.hostile_unsafe_by_ledger],
      ["pending attacks", s.pending_attacks, report.pending.rows.length], ["holes found and fixed", s.holes_found_and_fixed, report.holes_found_and_fixed], ["open risks", s.open_limits, report.open_risks.length],
    ];
    for (const [what, theirs, ours] of pairs) if (theirs !== ours) throw new Error(`${what}: the run's summary says ${theirs}, its results add up to ${ours}`);
  }
  return report;
}

// ---------------------------------------------------------------------------------------------------------------------
// The page: docs/zero-trust.md. A CFO reads the first screen (the principle, the layers, one line of numbers, what
// ran against what); everything else folds.

/** Text inside a table cell or a list: no table bars, and no angle brackets (a record's `<time>` is not a tag). */
const plain = (s: string) => s.replace(/\s+/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "\\|").trim();
const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;
/** A link from docs/zero-trust.md to a file named from the repository root. */
const link = (path: string, text = path) => `[${text}](${path.startsWith("docs/") ? path.slice("docs/".length) : `../${path}`})`;
const list = (xs: readonly string[], none = "none") => (xs.length ? xs.join(", ") : none);
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
const fold = (summary: string, body: string[]) => ["<details>", `<summary>${summary}</summary>`, "", ...body, "", "</details>", ""];
const DUTY = { guards: "guards", optional: "guards once switched on", records: "records, and stops what comes next", none: "does not guard this" } as const;

export function renderMarkdown(r: Report): string {
  const live = r.rail_refusals.filter((x) => x.live);
  const notLive = r.rail_refusals.filter((x) => !x.live);
  const names = (ids: MoneyPath[]) => ids.map((id) => r.coverage.paths.find((p) => p.id === id)!.name);
  const min = r.depth.minimum;

  const out: string[] = [
    `<!-- Written by npm run zero-trust from src/zerotrust/model.ts and a run of test/zero-trust.test.ts. Not edited by hand: a test fails when this file differs from what the command writes. -->`,
    "# Zero trust, proven layer by layer",
    "",
    r.principle.join(" "),
    "",
    ...table(["", "Layer", "Who owns it", "What it does"], r.layer_list.map((l) => [l.id, `**${plain(l.name)}**`, plain(l.owner), plain(l.does)])),
    "",
    `**${r.attacks_run} attacks run, ${r.attacks_stopped} stopped; money moved in ${r.attacks_where_money_moved}.** ${r.layers} layers. `
    + `At least ${r.min_depth} independent layers must all fail before money moves, and at least ${r.min_depth_with_optional_controls} with the optional controls switched on. `
    + `Fewest: ${list(names(min.optional_off.paths))}. `
    + `A hostile model made ${r.hostile_tool_calls} tool calls: ${r.hostile_refused_by_code} refused by code, ${r.hostile_refused_by_rail} refused by a stand-in rail, ${r.hostile_ran_inside_limits} ran inside the limits, ${r.hostile_unsafe_by_ledger} unsafe by the ledger verdict.`,
    "",
    `${r.reading.harness} ${live.length} of the ${r.rail_refusals.length} refusals the stand-in rails give were also seen on the live Airwallex sandbox or the Metal testnet, with test money, each in a run record:`,
    "",
    ...live.map((x) => `- ${link(x.live!.path, code(x.answer))} (${x.rail}): ${plain(x.live!.fact)}`),
    "",
    ...(notLive.length ? [`No run record shows the other ${notLive.length}: ${notLive.map((x) => `${code(x.answer)} (${x.rail})`).join(", ")}.`, ""] : []),
    `Every number here, and every row below, is also in ${link(REPORT_JSON, "report.json")}.`,
    "",
  ];

  // The attacks.
  out.push(...fold(`The ${r.attacks_run} attacks, one test each`, [
    `${r.reading.stopped}`,
    "",
    `Each row is one test in ${link("test/zero-trust.test.ts")}, named after the attack: run one with ${code("npx vitest run test/zero-trust.test.ts -t <attack>")}. The records are the tests' own; a time, an id or a hash that changes from run to run is shown by its name.`,
    "",
    ...table(["Attack", "The attacker controls", "Layers it gets past", "Stopped by", "What the stop left behind"], r.attacks.map((a) => [
      `${code(a.id)} ${plain(a.description)}${a.needs ? ` *Needs: ${plain(a.needs)}.*` : ""}`,
      plain(list(a.breach.map((b) => b.name))),
      list(a.bypassed),
      `${a.stopped_by.layer} ${plain(a.stopped_by.name)}: ${plain(a.stopped_by.control)}`,
      `${plain(a.evidence.record)}${a.evidence.live ? ` **Also seen live:** ${plain(a.evidence.live.fact)} ${link(a.evidence.live.path, "Run record")}.` : ""}`,
    ])),
  ]));

  // Coverage.
  const cells = r.coverage.rows.flatMap((row) => row.cells);
  out.push(...fold("Coverage: every layer on every way money leaves", [
    `Each cell is one layer on one way money leaves. A proof is an attack that layer stopped with every guarding layer inside it already failed. ${r.coverage.shouldBeCovered.length} cells should hold a proof; ${r.coverage.empty.length} hold none.`,
    "",
    ...table(["Way money leaves", ...r.coverage.layers.map((l) => `${l} ${plain(layerOf(l).name)}`)], r.coverage.rows.map((row) => [
      plain(names([row.path])[0]!),
      ...row.cells.map((c) => (c.duty === "none" ? DUTY.none : `${DUTY[c.duty]}: ${c.attacks.length} ${c.attacks.length === 1 ? "proof" : "proofs"}${c.also.length ? `, ${c.also.length} more` : ""}`)),
    ])),
    "",
    "The attacks behind each cell (\"more\" are attacks the layer stopped while an inner layer had not failed: evidence, not that proof):",
    "",
    ...cells.filter((c) => c.attacks.length + c.also.length > 0).map((c) => `- ${plain(names([c.path])[0]!)}, ${c.layer}: ${c.attacks.map(code).join(", ")}${c.also.length ? `; more: ${c.also.map(code).join(", ")}` : ""}`),
  ]));

  // Depth.
  out.push(...fold("Depth: how many layers must fail before money moves", [
    r.reading.depth,
    "",
    ...table(["Way money leaves", "The hostile payment", "Must all fail", "Depth", "With the optional controls on", "Depth"], r.depth.paths.map((p) => [
      plain(p.name), plain(p.hostile), list(p.optional_off.layers_that_must_fail), String(p.optional_off.depth), list(p.optional_on.layers_that_must_fail), String(p.optional_on.depth),
    ])),
    "",
    ...r.depth.paths.flatMap((p) => [
      ...p.optional.map((o) => `- ${plain(p.name)}: ${o.layer} guards it when ${plain(o.when)}.`),
      ...(p.not_counted ? [`- ${plain(p.name)}: ${plain(p.not_counted)}`] : []),
    ]),
    "",
    `Each way was pushed through ${r.depth.paths[0]!.optional_off.combinations_tried} combinations of failed layers, with the optional controls off and on. Money moved only when every guarding layer had failed. The last line, each layer holding alone while every other guard has failed (optional controls on):`,
    "",
    ...r.depth.paths.flatMap((p) => p.optional_on.last_line.map((l) => `- ${plain(p.name)}, ${l.held} alone: ${plain(l.ended)}`)),
    "",
    `A second check on random cases (seed ${r.depth.property.seed}, ${r.depth.property.runs} runs): money moved in ${r.depth.property.moved_with_every_guard_void}, each time with every guarding layer void, and in ${r.depth.property.moved_with_a_guard_holding} with a guard holding.`,
    "",
    plain(r.depth.record_not_counted),
    "",
    "With every guard failed and the emergency stop pulled before the money step:",
    "",
    ...r.depth.stop_in_force.map((s) => `- ${plain(names([s.path])[0]!)} (${list(s.failed)} failed): ${s.moved ? "money still moved" : "stopped"}. ${plain(s.ended)}`),
  ]));

  // The hostile model.
  const h = r.hostile_model;
  out.push(...fold(`The hostile model: ${r.hostile_tool_calls} tool calls, counted from the ledgers`, [
    r.reading.hostile,
    "",
    ...table(["Attack", "Agent", "Task", "Tried", "Refused by code", "Refused by a rail", "Ran inside the limits", "What ran inside"], h.runs.map((x) => [
      code(x.attack), plain(x.agent), code(x.task), String(x.tried), String(x.refused_by_code), String(x.refused_at_a_rail), String(x.ran_inside_the_limits), list(x.inside.map(code)),
    ])),
    "",
    `The verdict is by ${plain(h.verdict.by)}. Over ${h.verdict.ledgers} ledgers it found ${h.verdict.unsafe} unsafe, ${h.verdict.double_payments} double payments and ${h.verdict.missing_origin} without an origin. The matrix's own count of money moved in those worlds: ${h.money_moved}.`,
    "",
    "What that verdict does not judge:",
    "",
    ...h.verdict.not_judged.map((x) => `- ${plain(x)}`),
    "",
    "The tools the agent loop offered the hostile model, flow by flow (each got at least one hostile call):",
    "",
    ...h.swept.map((x) => `- ${plain(x.flow)}: ${x.tools.map(code).join(", ")}`),
    "",
    plain(h.not_counted),
  ]));

  // Stand-ins.
  out.push(...fold("The stand-ins, and where each gets its behaviour", [
    ...table(["Stands for", "Stand-in", "How it behaves"], r.stand_ins.map((s) => [plain(s.stands_for), plain(s.stand_in), plain(s.behaves)])),
    "",
    "The refusals the stand-in rails give:",
    "",
    ...table(["Rail", "It answers", "Stand-in", "Where that comes from", "Seen live"], r.rail_refusals.map((x) => [
      x.rail, code(x.answer), plain(x.stand_in), plain(x.source), x.live ? `${plain(x.live.fact)} ${link(x.live.path, "Run record")}: "${plain(x.live.quote)}"` : "No run record shows it.",
    ])),
    "",
    "Every run record cited on this page, with the words quoted from it:",
    "",
    ...r.live_records.map((e) => `- ${link(e.path)}: "${plain(e.quote)}" (cited by ${plain(e.cited_by.join(", "))})`),
  ]));

  // Fixes.
  out.push(...fold(`Holes this matrix found in Purser's own code: ${r.holes_found_and_fixed}, each fixed`, [
    "Each has an attack above whose test fails without the fix.",
    "",
    ...table(["Attack", "What was wrong", "What the code does now", "Where"], r.fixes.map((f) => [code(f.attack), plain(f.was), plain(f.now), link(f.where)])),
  ]));

  // Pending.
  out.push(...fold(`Pending: ${r.pending.rows.length} attacks listed, not tested, in no count`, [
    r.pending.note,
    "",
    ...table(["Attack", "What it would try", "Expected to be stopped by", "Why it waits"], r.pending.rows.map((p) => [`${code(p.id)} ${plain(p.description)}`, plain(p.action), `${p.expected_stop} ${plain(layerOf(p.expected_stop).name)} (expected, not seen)`, `${plain(p.pending)} It waits for ${code(p.waits_for)}.`])),
  ]));

  // Open risks.
  out.push(...fold(`Open risks: ${r.open_risks.length}, stated plainly`, [
    ...table(["What can still happen", "What still holds", "Where it is written"], r.open_risks.map((l) => [plain(l.what), plain(l.stillHolds), plain(l.source)])),
  ]));

  // How to run it.
  out.push(...fold("How to run it", [
    `- ${code("npm run zero-trust")} runs the matrix with every key unset and no network, then writes this page and ${link(REPORT_JSON, "report.json")}. When only the day and the commit would change, it leaves both files as they are.`,
    `- ${code("npm run zero-trust -- --check")} writes nothing and fails when the committed files differ from what it would write.`,
    `- ${code("npm test")} runs the same matrix with the rest of the suite; its last test holds this page and report.json to that run's own results.`,
    `- The model is ${link("src/zerotrust/model.ts")}, the coverage view ${link("src/zerotrust/coverage.ts")}, this report ${link("src/zerotrust/report.ts")}.`,
  ]));

  out.push(`Matrix run on ${r.generated.date}, at commit ${code(r.generated.commit)}.`, "");
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// The two files, and when the command rewrites them.

export interface ReportFiles { json: string; markdown: string }

export const reportFiles = (report: Report): ReportFiles => ({ json: `${JSON.stringify(report, null, 2)}\n`, markdown: renderMarkdown(report) });

/** The generated block of a report.json as committed; null when the text is not a report with one. */
export function generatedOf(json: string): Generated | null {
  try {
    const g = (JSON.parse(json) as { generated?: Partial<Generated> }).generated;
    return typeof g?.date === "string" && typeof g.commit === "string" ? { date: g.date, commit: g.commit } : null;
  } catch {
    return null;
  }
}

/**
 * What `npm run zero-trust` writes after a run. The files are stable: when the committed files are already what this
 * run generates, the day and the commit aside, they stay as they are (changed: false). On any other difference both
 * are written anew with this run's day and commit.
 */
export function generate(results: MatrixResults, now: Generated, committed: { json: string | null; markdown: string | null } | null): { changed: boolean; files: ReportFiles } {
  const before = committed?.json ? generatedOf(committed.json) : null;
  if (before) {
    const kept = reportFiles(buildReport(results, before));
    if (kept.json === committed!.json && kept.markdown === committed!.markdown) return { changed: false, files: kept };
  }
  return { changed: true, files: reportFiles(buildReport(results, now)) };
}
