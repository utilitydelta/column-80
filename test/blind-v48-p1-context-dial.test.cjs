// BLIND ORACLE - session-v48 phase 1, "the context dial".
//
// Binds to the phase-1 contract and to NOTHING ELSE. While writing the
// assertions in this file, src/core/budgetProfile.ts, src/vscode/fnGen.ts,
// src/vscode/config.ts and package.json's contributes.configuration were never
// opened. The implementation was being built in parallel; a red row here means
// the implementation is absent or does not hold the contract, which is the
// correct output of this job, not a regression.
//
// WHAT THE CONTRACT NAMES, AND WHAT IT DOES NOT.
//
// It names the setting (`column80.injectedContext`), its four values, its
// default, the five stops and every number in the stops table, and exactly ONE
// code symbol: `rootCap` (P4). It does NOT name the function that resolves a stop
// to those numbers, nor the field names for breadth, total types, budget, the
// resolve cap or the provenance cap, nor the function that reads the setting.
// Guessing five names would make this file a test of the implementer's naming
// taste rather than of the contract, so section 0 DISCOVERS them instead:
//
//   - every export of budgetProfile / config / fnGen is probed with each of the
//     five stop names, under four plausible call shapes, and a candidate is
//     accepted only if it answers an object for all five stops and those answers
//     are not all the same object-shape (a dial that does not move is not a dial);
//   - the concept -> field-name mapping is resolved per concept from an ordered
//     candidate list that starts with the contract's own word and continues with
//     this repo's existing vocabulary (`typeCap`, `resolveCap`, `provenanceCap`
//     from the PrefillLang seam; `surfaceBudgetTok`, `walkTokMax` from the v46
//     budget-profile seam).
//
// Discovery is deliberately liberal; every ASSERTION on a discovered value is
// exact. A concept that cannot be found is a LOUD failure that prints the keys
// that were actually there, never a skipped row.
//
// THE STRUCTURAL ASSUMPTION IN THE P1 RENDER ROWS. `walkDataShape` from
// src/core/dataShape.ts is the one exported, documented entry point that takes
// the walk's `{ D_MAX, B_MAX, N_MAX, TOK_MAX }` bounds (the surface
// blind-v6-item3-walk.test.cjs and blind-v40-render-budget.test.cjs already
// drive). The contract's stops table is in the dial's own vocabulary, so the two
// have to be joined somewhere. Section 0 looks for a PRODUCT function that does
// the joining and uses it if one exists; only if none is exported does it derive
// the bounds itself (depth -> D_MAX, breadth -> B_MAX, total types -> N_MAX,
// walk budget -> TOK_MAX). Which of the two happened is printed by the discovery
// guard row, because a re-derived mapping is exactly the thing that has inverted
// a measurement in this project before. P1 is ALSO asserted end to end through
// `resolvePrefill`, which uses the product's own mapping and no assumption of
// mine, so the property does not rest on the derivation.
//
// Run: SKIP_LIVE=1 node --test test/blind-v48-p1-context-dial.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const show = (v) => JSON.stringify(v);
const ROOT = path.join(__dirname, "..");

// ===========================================================================
// THE CONTRACT, TRANSCRIBED. Nothing below reads a number from anywhere else.
// ===========================================================================

const SETTING = "column80.injectedContext";
const REPLACED_SETTING = "column80.injectedSurface";
// "Four values, in this order, default `small`".
const SETTING_VALUES = ["small", "medium", "large", "frontier"];
// The stops table. `shipped` is a stop but NOT a setting value.
const STOPS = ["shipped", "small", "medium", "large", "frontier"];
const TABLE = {
  shipped: { roots: 4, breadth: 4, totalTypes: 6, budgetTok: 300, resolveCap: 8, provenanceCap: 24 },
  small: { roots: 8, breadth: 6, totalTypes: 24, budgetTok: 600, resolveCap: 16, provenanceCap: 24 },
  medium: { roots: 8, breadth: 12, totalTypes: 48, budgetTok: 1200, resolveCap: 16, provenanceCap: 24 },
  large: { roots: 12, breadth: 24, totalTypes: 96, budgetTok: 2400, resolveCap: 24, provenanceCap: 36 },
  frontier: { roots: 16, breadth: 48, totalTypes: 192, budgetTok: 4000, resolveCap: 32, provenanceCap: 48 },
};
// "Depth is 2 at every stop and is not a dial."
const DEPTH = 2;
const LANGS = ["rust", "typescript", "csharp", "python", "go"];
const CELLS = ["roots", "breadth", "totalTypes", "budgetTok", "resolveCap", "provenanceCap"];

// The pre-dial walk bounds, as the shipped tree spells them and as the two
// existing walk oracles pin them (blind-v6-item3-walk.test.cjs line 53). Used by
// P3 as the byte-identity stand-in: a fresh file has no HEAD render to diff
// against, so the honest substitute is "the `shipped` stop renders exactly what
// the pre-dial CONSTANTS render", on the same graph.
const PRE_DIAL_BOUNDS = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 200 };
// The walk's share of the aggregate budget. The CONTRACT does not state what
// fraction of the "budget (tok)" column reaches the walk; goal.md does
// ("walkTokMax is two thirds of it") and the shipped pair 300 -> 200 agrees.
// Only used when the product exposes no mapping of its own; see the note above.
const WALK_TOK_FRACTION = 2 / 3;

// ===========================================================================
// 0. HARNESS. One bundle, three namespaces plus the pure walk, built against a
// vscode stub whose configuration is settable, countable, and removable.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v48-p1-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
  with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(p) {
    const ps = p.start ? p.start : p, pe = p.end ? p.end : p;
    const geS = ps.line > this.start.line || (ps.line === this.start.line && ps.character >= this.start.character);
    const leE = pe.line < this.end.line || (pe.line === this.end.line && pe.character <= this.end.character);
    return geS && leE;
  }
  with(s, e) { return new Range(s || this.start, e || this.end); }
}
class Selection extends Range {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));

// The settable half. A key is looked up section-qualified first, then bare, so a
// caller that asks getConfiguration("column80").get("injectedContext", d) and one
// that asks getConfiguration().get("column80.injectedContext", d) both see what
// the test set. Every other key falls back, exactly as the real API does.
const readCfg = (section, key, fallback) => {
  const cfg = globalThis.__V48_CONFIG__ || {};
  const qualified = section ? section + "." + key : key;
  if (Object.prototype.hasOwnProperty.call(cfg, qualified)) return cfg[qualified];
  if (Object.prototype.hasOwnProperty.call(cfg, key)) return cfg[key];
  return fallback;
};
const realGetConfiguration = (section) => {
  globalThis.__V48_CFG_CALLS__ = (globalThis.__V48_CFG_CALLS__ || 0) + 1;
  const mode = globalThis.__V48_CFG_MODE__;
  if (mode === "no-object") return undefined;
  if (mode === "throws-object") throw new Error("configuration provider is unavailable");
  return {
    get: (k, f) => {
      if (globalThis.__V48_CFG_MODE__ === "throws-get") throw new Error("get() blew up");
      if (globalThis.__V48_CFG_MODE__ === "no-get-fn") return undefined;
      return readCfg(section, k, f);
    },
    has: (k) => readCfg(section, k, undefined) !== undefined,
    inspect: () => undefined,
    update: async () => {},
  };
};
const workspace = {
  openTextDocument: (arg) => {
    const files = globalThis.__V48_FILES__ || {};
    const key = keyOf(arg);
    return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
  },
};
// ABSENT, not stubbed: with __V48_NO_GETCONFIG__ set, the property reads
// undefined, so any caller that does not guard blows up with a TypeError. That
// is P5's "a host that stubs vscode without getConfiguration".
Object.defineProperty(workspace, "getConfiguration", {
  configurable: true,
  enumerable: true,
  get() { return globalThis.__V48_NO_GETCONFIG__ ? undefined : realGetConfiguration; },
});
module.exports = {
  Position, Range, Selection, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {},
  // A REAL output channel, not {}. resolvePrefill leaves background work in
  // flight; a straggler that logs into a window stub with no createOutputChannel
  // throws after the test that started it has ended, and node:test reports that
  // as a file-level failure with no row attached - a mechanical red that reads
  // like a product defect.
  window: {
    createOutputChannel: () => ({
      name: "column80",
      append() {},
      appendLine() {},
      replace() {},
      clear() {},
      show() {},
      hide() {},
      dispose() {},
    }),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    withProgress: async (_o, task) => task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }),
  },
  commands: { executeCommand: async () => undefined },
  workspace,
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v48-p1.entry.ts");
const OUT = path.join(__dirname, ".blind-v48-p1.bundle.cjs");
let BP = {};
let CFG = {};
let FN = {};
let walkDataShape;
let bundleErr;
let bundleSrc = "";
try {
  fs.writeFileSync(
    ENTRY,
    `export * as BP from "../src/core/budgetProfile";\n` +
      `export * as CFG from "../src/vscode/config";\n` +
      `export * as FN from "../src/vscode/fnGen";\n` +
      `export { walkDataShape } from "../src/core/dataShape";\n`,
  );
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUT,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  const m = require(OUT);
  BP = m.BP || {};
  CFG = m.CFG || {};
  FN = m.FN || {};
  walkDataShape = m.walkDataShape;
  bundleSrc = fs.readFileSync(OUT, "utf8");
} catch (e) {
  bundleErr = e;
}
test.after(() => [STUB, ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

// ---------------------------------------------------------------------------
// Discovery. See the file header for why this exists.
// ---------------------------------------------------------------------------

// Concept -> ordered candidate field names. The contract's own word first, then
// this repo's shipped vocabulary, then the plainest spelling.
const FIELD_CANDIDATES = {
  roots: ["rootCap", "roots", "rootsCap", "typeCap", "prefillTypeCap", "injectedTypeCap"],
  breadth: ["breadthCap", "breadth", "bMax", "B_MAX", "fieldBreadth", "breadthMax"],
  totalTypes: ["totalTypeCap", "totalTypes", "nMax", "N_MAX", "typeTotalCap", "walkTypeCap", "totalCap"],
  budgetTok: ["surfaceBudgetTok", "budgetTok", "totalTok", "dataShapeTotalTok", "budget", "surfaceBudget"],
  resolveCap: ["resolveCap", "prefillResolveCap", "resolveTypeCap"],
  provenanceCap: ["provenanceCap", "prefillProvenanceCap"],
  depth: ["depthCap", "depth", "dMax", "D_MAX", "depthMax"],
  walkTokMax: ["walkTokMax", "walkTok", "tokMax", "TOK_MAX"],
};

// A probe result is only a candidate profile if it is a plain object. A PROMISE
// is not, and an async export called with junk arguments rejects: left alone
// that surfaces as an unhandled rejection with no test attached, which node
// reports as a file-level failure. So promises are neutralised on sight.
const isObj = (v) => {
  if (v === null || typeof v !== "object") return false;
  if (typeof v.then === "function") {
    v.then(
      () => {},
      () => {},
    );
    return false;
  }
  return true;
};
const keyFor = (obj, concept) =>
  FIELD_CANDIDATES[concept].find((k) => isObj(obj) && typeof obj[k] === "number");

// Every named export of the three namespaces, tagged with where it came from.
function allExports() {
  const out = [];
  for (const [ns, mod] of [["budgetProfile", BP], ["config", CFG], ["fnGen", FN]]) {
    for (const k of Object.keys(mod || {})) {
      let v;
      try {
        v = mod[k];
      } catch {
        continue;
      }
      out.push({ ns, name: k, value: v });
    }
  }
  return out;
}

// Which exports get CALLED with junk arguments. Calling all of them is not free:
// this module's exports include gesture entry points that start background work,
// and a probe call leaves a rejection with no test attached, which node reports
// as a file-level failure. The filter is on the SEARCH, never on an assertion,
// and it is deliberately broad enough to catch any name the four numbers could
// plausibly live behind. Everything it skipped is printed by the discovery
// guard, so a reader can see what was not tried.
const PROBE_NAME = /(bound|profile|context|stop|dial|budget|cap|inject|walk|surface|shape)/i;
const probeable = () => allExports().filter((e) => PROBE_NAME.test(e.name));

// The four call shapes a stop-taking resolver plausibly has, plus the shape of a
// declared table keyed by stop name.
const CALL_SHAPES = [
  { how: "f(stop)", call: (f, stop) => f(stop) },
  { how: "f(stop, languageId)", call: (f, stop, lang) => f(stop, lang) },
  { how: "f(languageId, stop)", call: (f, stop, lang) => f(lang, stop) },
  { how: "f(modelClass, languageId, stop)", call: (f, stop, lang) => f("local-mid", lang, stop) },
];

function scoreProfile(p) {
  return CELLS.filter((c) => keyFor(p, c) !== undefined).length;
}

// The four dialled numbers as a signature. A candidate that answers the SAME
// four numbers for every stop is not the stop resolver: it is something that
// takes a string and reads the dial from somewhere else. `budgetProfileFor`
// called as f(stop) is exactly that - the string lands on its model-class
// parameter and the answer is whatever the setting says. Ranking on how many
// DISTINCT signatures the five stops produce separates the two without this
// file having to know either name.
function cellSignature(p) {
  return show(CELLS.map((c) => {
    const k = keyFor(p, c);
    return k === undefined ? null : p[k];
  }));
}

function discoverDial() {
  const tried = [];
  let best;
  for (const { ns, name, value } of probeable()) {
    const shapes = [];
    if (typeof value === "function") {
      for (const s of CALL_SHAPES) shapes.push({ how: `${ns}.${name} ${s.how}`, get: (stop, lang) => s.call(value, stop, lang) });
    } else if (isObj(value) && STOPS.every((s) => isObj(value[s]))) {
      shapes.push({ how: `${ns}.${name}[stop] (declared table)`, get: (stop) => value[stop] });
    }
    for (const shape of shapes) {
      let ok = true;
      const profiles = {};
      for (const stop of STOPS) {
        let r;
        try {
          r = shape.get(stop, "rust");
        } catch {
          ok = false;
          break;
        }
        if (!isObj(r)) {
          ok = false;
          break;
        }
        profiles[stop] = r;
      }
      if (!ok) continue;
      const concepts = Math.min(...STOPS.map((s) => scoreProfile(profiles[s])));
      // A dial that answers the same numbers for every stop is not a dial.
      const distinct = new Set(STOPS.map((s) => cellSignature(profiles[s]))).size;
      const score = concepts * 10 + distinct;
      tried.push({ how: shape.how, concepts, distinct });
      if (concepts >= 4 && distinct > 1 && (!best || score > best.score)) {
        best = { how: shape.how, get: shape.get, score, concepts, distinct, profiles };
      }
    }
  }
  return { best, tried };
}

// The walk-bounds mapping, if the product exports one: any function that answers
// an object carrying D_MAX / N_MAX / TOK_MAX.
function discoverWalkBounds(dial) {
  if (!dial) return undefined;
  const hasBounds = (r) => isObj(r) && ["D_MAX", "N_MAX", "TOK_MAX"].every((k) => typeof r[k] === "number");
  const probes = [
    { how: "g(profile)", call: (f, stop) => f(dial.get(stop, "rust")) },
    { how: "g(stop)", call: (f, stop) => f(stop) },
    { how: "g(stop, languageId)", call: (f, stop) => f(stop, "rust") },
    { how: "g(profile, languageId)", call: (f, stop) => f(dial.get(stop, "rust"), "rust") },
  ];
  for (const { ns, name, value } of probeable()) {
    if (typeof value !== "function") continue;
    for (const p of probes) {
      let ok = true;
      const seen = [];
      for (const stop of STOPS) {
        let r;
        try {
          r = p.call(value, stop);
        } catch {
          ok = false;
          break;
        }
        if (!hasBounds(r)) {
          ok = false;
          break;
        }
        seen.push(JSON.stringify(r));
      }
      if (ok && new Set(seen).size > 1) {
        return { how: `${ns}.${name} ${p.how}`, get: (stop) => p.call(value, stop) };
      }
    }
  }
  return undefined;
}

const DISCOVERY = bundleErr ? { best: undefined, tried: [] } : discoverDial();
const DIAL = DISCOVERY.best;
const WALK_MAP = bundleErr ? undefined : discoverWalkBounds(DIAL);

const dialReport = () =>
  `\n  DIAL: ${DIAL ? DIAL.how : "NOT FOUND"}` +
  `\n  WALK-BOUNDS MAPPING: ${WALK_MAP ? WALK_MAP.how : "none exported - derived by this file"}` +
  `\n  candidates that answered an object for all five stops ` +
  `(how / table-concepts-found / distinct-cell-signatures across the five stops):\n` +
  (DISCOVERY.tried.filter((t) => t.concepts > 0).length
    ? DISCOVERY.tried
        .filter((t) => t.concepts > 0)
        .map((t) => `    ${t.how}  concepts=${t.concepts}  distinct=${t.distinct}`)
        .join("\n")
    : "    (none)") +
  `\n  exports NOT probed (their names do not match ${PROBE_NAME}): ` +
  show(allExports().filter((e) => !PROBE_NAME.test(e.name)).map((e) => `${e.ns}.${e.name}`));

// Every row that needs the dial goes through here, so a missing implementation
// is one clear sentence per row rather than a wall of TypeErrors.
const dtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) assert.fail(`the bundle did not build: ${bundleErr.message}`);
    if (!DIAL)
      assert.fail(
        `no stop resolver was found. The contract names the four stops and every number in them, but ` +
          `names no symbol that maps a stop to those numbers, so this file discovers one: any export of ` +
          `budgetProfile / config / fnGen that answers an object for all five stop names, under one of ` +
          `four call shapes, with at least four of the six table concepts present as numeric fields, and ` +
          `whose answers differ between stops.${dialReport()}`,
      );
    return fn(ctx);
  });

const profileAt = (stop, lang) => DIAL.get(stop, lang || "rust");

// Exact read of one table cell. A concept whose field cannot be found is a loud
// failure naming the keys that WERE there - never a pass and never a skip.
function cellOf(profile, concept, ctxLabel) {
  const k = keyFor(profile, concept);
  assert.ok(
    k !== undefined,
    `${ctxLabel}: no field on the resolved profile carries the "${concept}" number. Tried ` +
      `${show(FIELD_CANDIDATES[concept])}. The profile's own numeric keys are ` +
      `${show(Object.keys(profile || {}).filter((x) => typeof profile[x] === "number"))}. ` +
      `The contract names only \`rootCap\`, so if the implementation calls it something else the name ` +
      `has to be added here deliberately.${dialReport()}`,
  );
  return profile[k];
}

// ---------------------------------------------------------------------------
// 0a. Guards. One loud row each, so a mechanical failure never reads as a
// contract failure.
// ---------------------------------------------------------------------------

test("guard: the bundle builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof walkDataShape, "function", "walkDataShape must be exported from src/core/dataShape");
  assert.equal(typeof FN.resolvePrefill, "function", "resolvePrefill must still be exported from src/vscode/fnGen");
  assert.equal(typeof FN.prefillLangFor, "function", "prefillLangFor must still be exported from src/vscode/fnGen");
});

test("guard: a stop resolver is reachable, and this file reports how it found it", (ctx) => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  // Printed on the PASSING path too. Which symbol was found, under which call
  // shape, and whether the walk-bounds mapping is the product's or this file's,
  // is the one thing a reader has to know before trusting any row below.
  ctx.diagnostic(dialReport());
  assert.ok(DIAL, `no stop resolver found.${dialReport()}`);
});

// ---------------------------------------------------------------------------
// 0b. The graph and the render, declared before the rows that use them.
//
// Wide (60 candidate children, so breadth 48 has somewhere to go), two levels
// deep, every def FAT so the render budget binds at the low stops exactly as it
// does in the shipped tree. ONE graph serves both the positive P1 rows and the
// negative control, which is the only way the control can have teeth: a positive
// row passing on a graph the control never saw would prove nothing about the
// same walk.
// ---------------------------------------------------------------------------

const SENTINEL = (name) => `<<DEF ${name}>>`;
function node(name, childTypes, scalars) {
  const fields = [
    ...childTypes.map((c, i) => ({ name: `f${i}`, typeName: c, isLocal: true })),
    ...Array.from({ length: scalars }, (_, i) => ({
      name: `descriptive_scalar_field_number_${i}_of_this_type`,
      typeName: "u64",
      isLocal: false,
    })),
  ];
  const def = [`${SENTINEL(name)} pub struct ${name} {`, ...fields.map((f) => `  ${f.name}: ${f.typeName},`), "}"].join("\n");
  return { def, fields };
}

// Sizing matters and is deliberate. The ROOT's own def must fit inside the
// SHIPPED budget (200 walk tokens, 800 chars) or every low stop renders one
// truncated root and the stops become indistinguishable by count - which is a
// property of the fixture, not of the dial. Its 50 children are short lines for
// that reason; the children are the fat ones, so each extra rung of budget buys
// a visible number of extra defs.
function dialGraph() {
  const map = new Map();
  const grandkids = Array.from({ length: 8 }, (_, i) => `G${i}`);
  for (const g of grandkids) map.set(g, node(g, [], 4));
  const children = Array.from({ length: 50 }, (_, i) => `C${String(i).padStart(2, "0")}`);
  for (const c of children) map.set(c, node(c, grandkids, 8));
  map.set("Root", node("Root", children, 0));
  return map;
}

function resolverOver(map) {
  return (typeName) => map.get(typeName);
}

// The stop -> WalkBounds join. Product mapping if one is exported (preferred: a
// re-derived mapping has inverted an arm in this project before); otherwise
// derived from the table's own vocabulary, as the file header states.
function boundsFor(stop) {
  if (WALK_MAP) {
    const b = WALK_MAP.get(stop);
    return { D_MAX: b.D_MAX, B_MAX: b.B_MAX, N_MAX: b.N_MAX, TOK_MAX: b.TOK_MAX };
  }
  const p = profileAt(stop);
  const walkKey = keyFor(p, "walkTokMax");
  const depthKey = keyFor(p, "depth");
  return {
    D_MAX: depthKey === undefined ? DEPTH : p[depthKey],
    B_MAX: cellOf(p, "breadth", `stop ${show(stop)} / breadth`),
    N_MAX: cellOf(p, "totalTypes", `stop ${show(stop)} / totalTypes`),
    TOK_MAX:
      walkKey === undefined
        ? Math.round(cellOf(p, "budgetTok", `stop ${show(stop)} / budgetTok`) * WALK_TOK_FRACTION)
        : p[walkKey],
  };
}

function renderWith(bounds, map) {
  return String(walkDataShape("Root", resolverOver(map), bounds).block || "");
}
function renderAt(stop, map) {
  return renderWith(boundsFor(stop), map);
}

// ===========================================================================
// 1. THE STOPS TABLE, CELL BY CELL. Five stops x six numbers, written out.
// ===========================================================================

for (const stop of STOPS) {
  dtest(`stops table [${stop}]: all six numbers resolve to the contract's values`, () => {
    const p = profileAt(stop);
    for (const concept of CELLS) {
      assert.equal(
        cellOf(p, concept, `stop ${show(stop)} / ${concept}`),
        TABLE[stop][concept],
        `stop ${show(stop)}: ${concept} must be ${TABLE[stop][concept]}. Resolved profile: ${show(p)}`,
      );
    }
  });
}

dtest("stops table: depth is 2 at every stop and is not a dial", () => {
  // "Depth is 2 at every stop and is not a dial." Two claims: the value, and the
  // non-movement. If the profile carries no depth field at all that is also
  // consistent with "not a dial" - but then nothing may vary, so the row falls
  // back to the walk bounds, where D_MAX must be 2 everywhere.
  const seen = [];
  for (const stop of STOPS) {
    const p = profileAt(stop);
    const k = keyFor(p, "depth");
    if (k !== undefined) seen.push([stop, p[k]]);
  }
  if (seen.length) {
    assert.equal(seen.length, STOPS.length, `depth must be present at every stop or none; got ${show(seen)}`);
    for (const [stop, v] of seen) {
      assert.equal(v, DEPTH, `stop ${show(stop)}: depth must be ${DEPTH}. Got ${show(v)}, from ${show(seen)}`);
    }
  } else {
    for (const stop of STOPS) {
      assert.equal(
        boundsFor(stop).D_MAX,
        DEPTH,
        `stop ${show(stop)}: the walk's D_MAX must be ${DEPTH}. Depth is not a dial and no stop may move it`,
      );
    }
  }
});

dtest("stops table: the four dialled numbers are strictly monotone up the stops, and the two latency caps never fall", () => {
  // Not decoration. The stops are ordered small -> frontier and each is "for" a
  // bigger model; a table where a number went DOWN a rung would be a transcription
  // error the cell rows above cannot see, because each of them reads one stop.
  const dialled = ["breadth", "totalTypes", "budgetTok"];
  const ladder = SETTING_VALUES; // the four offered stops, in the contract's order
  for (const concept of dialled) {
    const vals = ladder.map((s) => cellOf(profileAt(s), concept, `stop ${show(s)} / ${concept}`));
    for (let i = 1; i < vals.length; i++) {
      assert.ok(
        vals[i] > vals[i - 1],
        `${concept} must grow strictly from ${show(ladder[i - 1])} to ${show(ladder[i])}; got ${show(vals)}`,
      );
    }
  }
  for (const concept of ["roots", "resolveCap", "provenanceCap"]) {
    const vals = ladder.map((s) => cellOf(profileAt(s), concept, `stop ${show(s)} / ${concept}`));
    for (let i = 1; i < vals.length; i++) {
      assert.ok(vals[i] >= vals[i - 1], `${concept} must never fall going up the stops; got ${show(vals)}`);
    }
  }
});

dtest("stops table: roots never exceeds the resolve cap, at any stop", () => {
  // The contract's own reasoning for why the fifth and sixth numbers had to move:
  // "roots beyond the resolve cap cannot be injected, because a type that was
  // never resolved has no surface, so a stop with 16 roots and the shipped
  // resolve cap of 8 would be inert above 8".
  for (const stop of STOPS) {
    const p = profileAt(stop);
    const roots = cellOf(p, "roots", `stop ${show(stop)} / roots`);
    const resolve = cellOf(p, "resolveCap", `stop ${show(stop)} / resolveCap`);
    const prov = cellOf(p, "provenanceCap", `stop ${show(stop)} / provenanceCap`);
    assert.ok(roots <= resolve, `stop ${show(stop)}: roots ${roots} above resolveCap ${resolve} is inert above ${resolve}`);
    assert.ok(resolve <= prov, `stop ${show(stop)}: resolveCap ${resolve} above provenanceCap ${prov} resolves candidates whose provenance was never established`);
  }
});

// ===========================================================================
// 2. P3. `shipped` REPRODUCES THE PRE-DIAL POINT.
// ===========================================================================

dtest("P3: the `shipped` stop is the pre-dial point - roots 4, breadth 4, total types 6, budget 300, resolve 8, provenance 24", () => {
  const p = profileAt("shipped");
  assert.deepEqual(
    Object.fromEntries(CELLS.map((c) => [c, cellOf(p, c, `shipped / ${c}`)])),
    TABLE.shipped,
    `the shipped stop is what phase 1b renders as its before-side; any drift here makes the whole ` +
      `measurement a comparison against something that never shipped. Resolved profile: ${show(p)}`,
  );
});

dtest("P3: the `shipped` stop's walk bounds ARE the pre-dial constants", () => {
  // The byte-identity claim, as close as a file with no HEAD render can get:
  // the bounds the walk is handed at `shipped` must equal the literal constants
  // the pre-dial tree used (D_MAX 2, B_MAX 4, N_MAX 6, TOK_MAX 200 - the bounds
  // blind-v6-item3-walk.test.cjs has pinned since v6). Same bounds, same walk,
  // same bytes.
  const b = boundsFor("shipped");
  for (const k of ["D_MAX", "B_MAX", "N_MAX", "TOK_MAX"]) {
    assert.equal(
      b[k],
      PRE_DIAL_BOUNDS[k],
      `shipped: ${k} must be ${PRE_DIAL_BOUNDS[k]}, the pre-dial constant. Got ${show(b)}` +
        (WALK_MAP ? ` via the product mapping ${WALK_MAP.how}` : ` via this file's derivation (no product mapping exported)`),
    );
  }
});

dtest("P3: the `shipped` stop renders BYTE-IDENTICALLY to the pre-dial constants, on a graph wide enough to bite", () => {
  const map = dialGraph();
  const viaStop = renderAt("shipped", map);
  const viaConstants = renderWith(PRE_DIAL_BOUNDS, map);
  assert.equal(
    viaStop,
    viaConstants,
    `the shipped stop must render what the pre-dial bounds render, byte for byte. ` +
      `stop=${viaStop.length} chars, constants=${viaConstants.length} chars`,
  );
  // Control: the graph is big enough for the comparison to mean something.
  assert.ok(viaConstants.length > 0, "CONTROL - the pre-dial bounds must render SOMETHING on this graph");
});

// ===========================================================================
// 3. P1. THE DIAL IS NOT INERT. The centrepiece.
// ===========================================================================

dtest("P1: the rendered data-shape block DIFFERS between every adjacent pair of stops", () => {
  const map = dialGraph();
  const blocks = STOPS.map((s) => ({ stop: s, block: renderAt(s, map), bounds: boundsFor(s) }));
  // Control first: every stop must render something, or "they differ" could be
  // satisfied by one stop rendering nothing at all.
  for (const b of blocks) {
    assert.ok(
      b.block.length > 0,
      `stop ${show(b.stop)} rendered an EMPTY block with bounds ${show(b.bounds)} - the graph is 69 fat ` +
        `types deep-2 wide-60, so nothing rendering means the bounds never reached the walk`,
    );
  }
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    const cur = blocks[i];
    assert.notEqual(
      cur.block,
      prev.block,
      `${show(prev.stop)} and ${show(cur.stop)} render a BYTE-IDENTICAL block. This is the exact failure ` +
        `session-v48 exists to prevent: three of the four numbers make the fourth inert, so a stop that ` +
        `moves one or two of them is a slider that silently does nothing. ` +
        `${show(prev.stop)} bounds=${show(prev.bounds)} chars=${prev.block.length}; ` +
        `${show(cur.stop)} bounds=${show(cur.bounds)} chars=${cur.block.length}`,
    );
  }
  // And the rendered TYPE SET must grow, not merely churn: a dial whose blocks
  // differ by reordering would satisfy "differs" while injecting no more context.
  const counts = blocks.map((b) => (b.block.match(/<<DEF \w+>>/g) || []).length);
  for (let i = 1; i < counts.length; i++) {
    assert.ok(
      counts[i] > counts[i - 1],
      `going ${show(blocks[i - 1].stop)} -> ${show(blocks[i].stop)} the block must carry MORE type ` +
        `definitions, not the same number rearranged; got ${show(STOPS)} -> ${show(counts)}`,
    );
  }
});

dtest("P1 NEGATIVE CONTROL: with total types and budget pinned at the shipped values, breadth alone changes NOTHING", () => {
  // The row that gives the positive one its teeth. session-v48's own trap proof:
  // at depth 2 with N_MAX 6, one root plus four children is already five of six,
  // and the render budget truncates whatever the structural caps let through. So
  // the SAME graph, walked with only B_MAX moving across the stops' own breadth
  // rungs, must produce a byte-identical block. If the positive row above can
  // pass while the product moved one number, it is not testing anything.
  const map = dialGraph();
  const rungs = STOPS.map((s) => TABLE[s].breadth); // 4, 6, 12, 24, 48
  const base = { D_MAX: DEPTH, N_MAX: TABLE.shipped.totalTypes, TOK_MAX: PRE_DIAL_BOUNDS.TOK_MAX };
  const rendered = rungs.map((b) => ({ breadth: b, block: renderWith({ ...base, B_MAX: b }, map) }));
  assert.ok(rendered[0].block.length > 0, "CONTROL - the pinned bounds must render something to compare");
  for (const r of rendered.slice(1)) {
    assert.equal(
      r.block,
      rendered[0].block,
      `breadth ${rendered[0].breadth} -> ${r.breadth} changed the block while total types stayed at ` +
        `${base.N_MAX} and the budget at ${base.TOK_MAX} tokens. The trap proof says it must not: this ` +
        `control is what makes the P1 row above evidence that all four numbers moved. ` +
        `${rendered[0].block.length} chars vs ${r.block.length} chars`,
    );
  }
});

// ===========================================================================
// 4. P4. EVERY LANGUAGE GETS THE SAME NUMBERS. Go's 8-root exception is gone.
// ===========================================================================

for (const stop of STOPS) {
  dtest(`P4 [${stop}]: rust, go, typescript, python and csharp resolve the same rootCap - and the same whole profile`, () => {
    const per = LANGS.map((l) => ({ lang: l, p: profileAt(stop, l) }));
    for (const { lang, p } of per) {
      assert.equal(
        cellOf(p, "roots", `stop ${show(stop)} / ${lang} / roots`),
        TABLE[stop].roots,
        `${lang} at ${show(stop)}: rootCap must be ${TABLE[stop].roots}. Go's 8-root exception is gone and ` +
          `no language carries its own. Got profile ${show(p)}`,
      );
      // "C#'s aggregate budget keeps its existing CS_BUDGET_FACTOR treatment,
      // which is 1, so C# equals the others at every stop today."
      for (const concept of CELLS) {
        assert.equal(
          cellOf(p, concept, `stop ${show(stop)} / ${lang} / ${concept}`),
          TABLE[stop][concept],
          `${lang} at ${show(stop)}: ${concept} must be ${TABLE[stop][concept]}, the same as every other language`,
        );
      }
    }
  });
}

// ===========================================================================
// 5. P5. THE RESOLUTION IS TOTAL AND NEVER THROWS.
//
// Driven at the seam that actually reads the host: the resolved stop is observed
// through the numbers in force, because the contract names no resolver symbol. A
// host with no getConfiguration at all is the sharpest case and the one the
// contract calls out by name.
// ===========================================================================

const settingCfg = (v) => (v === undefined ? {} : { [SETTING]: v, injectedContext: v });

const HOSTILE_HOSTS = [
  ["an absent setting", settingCfg(undefined), undefined],
  ["an empty string", settingCfg(""), undefined],
  ["an unrecognised value", settingCfg("enormous"), undefined],
  ["the stop name `shipped`, which no setting value may resolve to", settingCfg("shipped"), undefined],
  ["a value with stray whitespace", settingCfg(" small "), undefined],
  ["a non-string value", settingCfg(4), undefined],
  ["the replaced setting's old value", { [REPLACED_SETTING]: "generous", injectedSurface: "generous" }, undefined],
  ["an absent configuration provider (getConfiguration answers undefined)", {}, "no-object"],
  ["a configuration provider that throws", {}, "throws-object"],
  ["a configuration object whose get() answers undefined", {}, "no-get-fn"],
  ["a configuration object whose get() throws", {}, "throws-get"],
  ["a host with NO getConfiguration at all", {}, "absent-getConfiguration"],
];

for (const [label, cfg, mode] of HOSTILE_HOSTS) {
  dtest(`P5 [${label}]: resolves to \`small\`, and nothing throws`, async () => {
    let r;
    await assert.doesNotReject(
      async () => {
        r = await runOnHost(cfg, mode, "rust", CANDIDATES.slice(0, 3));
      },
      `${label}: the resolution must be total. "A host that stubs vscode without getConfiguration must get ` +
        `\`small\`, not an exception and not a dark path"`,
    );
    assert.equal(
      stopOnChannel(r.logs),
      "small",
      `${label}: must land on the install default \`small\`. A degenerate host silently falling back to the ` +
        `pre-dial \`shipped\` point would be exactly the dark path the contract forbids${dump(label, r)}`,
    );
  });
}

dtest("P5 CONTROL: a recognised value is NOT ignored - each of the four puts its own stop in force", async () => {
  // Without this, every row above passes against a build that hard-codes small
  // and never reads the setting at all.
  const seen = [];
  for (const v of SETTING_VALUES) seen.push(stopOnChannel((await runUnder(v, "rust", CANDIDATES.slice(0, 3))).logs));
  assert.deepEqual(seen, SETTING_VALUES, `each setting value must put its own stop in force. Got ${show(seen)} for ${show(SETTING_VALUES)}`);
});

dtest("P5: the setting is read at call time, so changing it needs no reload", async () => {
  const first = stopOnChannel((await runUnder("small", "rust", CANDIDATES.slice(0, 3))).logs);
  const second = stopOnChannel((await runUnder("frontier", "rust", CANDIDATES.slice(0, 3))).logs);
  const back = stopOnChannel((await runUnder("small", "rust", CANDIDATES.slice(0, 3))).logs);
  assert.notEqual(second, first, `a value captured at module load makes the developer restart the editor to be heard; got ${first} then ${second}`);
  assert.equal(back, first, `and setting it back must give the original stop back; got ${show([first, second, back])}`);
});

// ===========================================================================
// 6. THE GESTURE. P1 end to end, P4's teeth, P6, P8 and the legacy-setting line.
//
// Everything below drives `resolvePrefill` - the product's own path, its own
// mapping, no derivation of mine. Fixtures follow blind-v37-p3 and review-v45-p3.
// ===========================================================================

const WS = "file:///work/v48p1";
const CANDIDATES = Array.from({ length: 20 }, (_, i) => `Cand${String(i).padStart(2, "0")}`);

// TWO short members per type, not six long ones. The root cap is only readable
// in the injected count while the aggregate budget still has room, and C#'s
// recursive shape block carries the member signatures into that budget: a fat
// fixture starved `small` and `medium` and the count then measured the budget
// rather than the cap.
const fatMembers = (t, ext, sig) =>
  Array.from({ length: 2 }, (_, i) => ({
    name: `compute${i}`,
    kind: "method",
    signature: sig(t, i),
    uri: `${WS}/${t.toLowerCase()}.${ext}`,
    line: 0,
    character: 5,
  }));

const FIXTURES = {
  rust: {
    ext: "rs",
    symbol: "build",
    doc: "Build the thing.",
    docLine: "/// Build the thing.",
    signature: (n) => `pub fn build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`,
    body: "    todo!()\n}",
    bodyIndent: "    ",
    def: (t) => `pub struct ${t} { pub slot_number_field: u32, pub label_for_the_slot: String }\n`,
    hover: (t) => `pub struct ${t} {\n    pub slot_number_field: u32,\n    pub label_for_the_slot: String,\n}`,
    members: (t) => fatMembers(t, "rs", (n, i) => `pub fn compute${i}(&self, operand_number_${i}: u32, label_for_operand_${i}: &str) -> u32`),
  },
  typescript: {
    ext: "ts",
    symbol: "build",
    doc: "Build the thing.",
    docLine: "/** Build the thing. */",
    signature: (n) => `export function build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}): number`,
    body: "  throw new Error();\n}",
    bodyIndent: "  ",
    def: (t) => `export class ${t} { slotNumberField: number = 0; labelForTheSlot: string = ""; }\n`,
    hover: (t) => `class ${t}`,
    members: (t) => fatMembers(t, "ts", (n, i) => `compute${i}(operandNumber${i}: number, labelForOperand${i}: string): number`),
  },
  csharp: {
    // PascalCase method name, like every real C# method: the C# candidate rule
    // reads the leading token of `public uint Build(...)` as a type.
    ext: "cs",
    symbol: "Build",
    doc: "Build the thing.",
    docLine: "/// <summary>Build the thing.</summary>",
    signature: (n) => `public uint Build(${n.map((t, i) => `${t} p${i}`).join(", ")})`,
    body: "    throw new NotImplementedException();\n}",
    bodyIndent: "    ",
    def: (t) => `public class ${t} { public uint SlotNumberField; public string LabelForTheSlot; }\n`,
    hover: (t) => `class ${t}`,
    members: (t) => fatMembers(t, "cs", (n, i) => `public System.Threading.Tasks.Task<uint> Compute${i}(uint operandNumber${i}, string labelForOperand${i})`),
  },
  python: {
    ext: "py",
    symbol: "build",
    doc: "Build the thing.",
    docLine: '"""Build the thing."""',
    signature: (n) => `def build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> int:`,
    body: "    raise NotImplementedError",
    bodyIndent: "    ",
    def: (t) => `class ${t}:\n    slot_number_field: int = 0\n    label_for_the_slot: str = ""\n`,
    hover: (t) => `class ${t}`,
    members: (t) => fatMembers(t, "py", (n, i) => `def compute${i}(self, operand_number_${i}: int, label_for_operand_${i}: str) -> int`),
  },
  go: {
    ext: "go",
    symbol: "Build",
    doc: "Build the thing.",
    docLine: "// Build the thing.",
    signature: (n) => `func Build(${n.map((t, i) => `p${i} ${t}`).join(", ")}) uint32`,
    body: '\tpanic("todo")\n}',
    bodyIndent: "\t",
    def: (t) => `type ${t} struct { SlotNumberField uint32; LabelForTheSlot string }\n`,
    hover: (t) => `type ${t} struct`,
    members: (t) => fatMembers(t, "go", (n, i) => `func (r *${t}) Compute${i}(operandNumber${i} uint32, labelForOperand${i} string) uint32`),
  },
};

const V = require(STUB);

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new V.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new V.Position(Math.max(lines.length - 1, 0), 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

function makeExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    // Identifiers on the line, intersected with the known set. Same whole-word
    // semantics as a RegExp per known type and linear in the LINE instead of in
    // the world, which is what makes the nested fixture affordable.
    const on = [...new Set(line.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])].filter((w) => known.has(w));
    return on.length === 1 ? on[0] : undefined;
  };
  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (c) => {
      const t = typeAtCursor(c.uri, c);
      const h = t ? defTypes[t].hover : undefined;
      return h ? { signature: h } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return (t && defTypes[t].members) || [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

// The injected types read off the payload the way a reader would: a name in
// backticks on a header line immediately above a fenced block. Deliberately not
// a count the product reports about itself.
function injectedTypes(out) {
  const lines = (out || "").split("\n");
  const names = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(lines[i]);
    if (!m) continue;
    if (!((lines[i + 1] || "").startsWith("```") || (lines[i + 2] || "").startsWith("```"))) continue;
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

// The NESTED world, rust only, for the one row that needs the data-shape walk to
// have somewhere to go. A candidate whose fields are all scalars renders the same
// block at every budget, so `small` and `medium` - which share a root cap of 8 -
// would be byte-identical for a reason that has nothing to do with the dial.
// Each root gets six local field types, and each of those gets four of its own,
// so depth 2, breadth and the total-type cap all bite.
// Leaves are SHARED inside a root's own subtree (four of them, not four per
// mid). That keeps the world at 20 x 10 types rather than 20 x 30: the extractor
// this harness fakes is linear in the number of known types per lookup, and the
// larger world took minutes rather than seconds without buying the walk anything
// - depth is 2, so a leaf's own fields are never reached.
function rustNestedWorld(roots) {
  const extra = {};
  const rootDefs = {};
  for (const r of roots) {
    const mids = Array.from({ length: 4 }, (_, i) => `${r}Mid${i}`);
    const leaves = Array.from({ length: 2 }, (_, j) => `${r}Leaf${j}`);
    rootDefs[r] =
      `pub struct ${r} {\n${mids.map((m, i) => `    pub mid_${i}: ${m},`).join("\n")}\n    pub slot_number_field: u32,\n}\n`;
    for (const m of mids) {
      extra[m] = {
        def: `pub struct ${m} {\n${leaves.map((l, j) => `    pub leaf_${j}: ${l},`).join("\n")}\n    pub value_field: u32,\n}\n`,
      };
    }
    for (const l of leaves) {
      extra[l] = { def: `pub struct ${l} {\n    pub value_field: u32,\n    pub label_for_the_value: String,\n}\n` };
    }
  }
  return { extra, rootDefs };
}

async function runPrefill(languageId, typeNames, world) {
  const F = FIXTURES[languageId];
  const mainUri = `${WS}/main.${F.ext}`;
  const signature = F.signature(typeNames);
  const src =
    languageId === "python"
      ? `${signature}\n    ${F.docLine}\n${F.body}\n`
      : `${F.docLine}\n${signature} {\n${F.body}\n`;
  const files = { [mainUri]: src };
  const defTypes = {};
  for (const t of typeNames) {
    const uri = `${WS}/${t.toLowerCase()}.${F.ext}`;
    const rootDef = world && world.rootDefs[t];
    files[uri] = rootDef || F.def(t);
    // The hover IS the shape the walk renders and follows, so a nested world has
    // to move the hover too. A nested `def` behind a flat hover would leave the
    // walk with nowhere to go and the row would report the dial as inert when it
    // was the fixture that was flat.
    defTypes[t] = { uri, hover: rootDef ? rootDef.trim() : F.hover(t), members: F.members(t) };
  }
  for (const [name, spec] of Object.entries((world && world.extra) || {})) {
    const uri = `${WS}/${name.toLowerCase()}.${F.ext}`;
    files[uri] = spec.def;
    defTypes[name] = { uri, hover: spec.def.trim(), members: [] };
  }
  const start = src.indexOf(signature);
  const record = {
    span: { start, end: src.length - 1 },
    signature,
    docComment: F.doc,
    symbolName: F.symbol,
    languageId,
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: F.bodyIndent,
    docstringRefusal: undefined,
  };
  const logs = [];
  // MERGED, never deleted. resolvePrefill leaves background work in flight and a
  // straggler that finds the file map gone reports as an unhandled rejection
  // after the test ended - noise a reader could mistake for a product defect.
  globalThis.__V48_FILES__ = { ...(globalThis.__V48_FILES__ || {}), ...files };
  const out = await FN.resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, mainUri), record, (l) => logs.push(String(l)));
  return { text: out || "", bytes: Buffer.byteLength(out || "", "utf8"), logs, names: injectedTypes(out) };
}

async function runOnHost(cfg, mode, languageId, typeNames, world) {
  const before = [globalThis.__V48_CONFIG__, globalThis.__V48_CFG_MODE__, globalThis.__V48_NO_GETCONFIG__];
  globalThis.__V48_CONFIG__ = cfg || {};
  globalThis.__V48_CFG_MODE__ = mode;
  globalThis.__V48_NO_GETCONFIG__ = mode === "absent-getConfiguration";
  try {
    return await runPrefill(languageId, typeNames, world);
  } finally {
    [globalThis.__V48_CONFIG__, globalThis.__V48_CFG_MODE__, globalThis.__V48_NO_GETCONFIG__] = before;
  }
}

const runUnder = (settingValue, languageId, typeNames, world) =>
  runOnHost(settingCfg(settingValue), undefined, languageId, typeNames, world);

// The stop actually in force, read off the product's own channel. The contract
// requires that line (P8), and it names the stop, so it is the one observable a
// black-box caller has that does not depend on which field the numbers live in.
// Format-independent on purpose: it asks which of the five stop names the
// channel mentions, not how the line is spelled.
function stopOnChannel(logs) {
  const named = STOPS.filter((s) => logs.some((l) => new RegExp(`\\b${s}\\b`).test(l)));
  return named.length === 1 ? named[0] : `AMBIGUOUS:${show(named)}`;
}

const dump = (tag, r) => `\n  [${tag}] bytes=${r.bytes} injected=${show(r.names)}\n  logs=${show(r.logs)}`;

dtest("P1 END TO END: the fn-gen payload differs between every adjacent pair of the four offered stops", async () => {
  // The same property as the walk row, taken through the product's own mapping
  // so it rests on no derivation of this file's.
  //
  // TWO ROWS, because the four stops split into two cases and one fixture cannot
  // serve both affordably. Here: twenty flat candidates, where the root cap alone
  // separates medium (8) from large (12) from frontier (16). The `small` ->
  // `medium` pair shares a root cap of 8 and is the sharp one; it is the row
  // below, on a nested fixture, because only the other three numbers can move it.
  const seen = [];
  for (const v of SETTING_VALUES) seen.push({ v, r: await runUnder(v, "rust", CANDIDATES) });
  for (const { v, r } of seen) {
    assert.ok(r.bytes > 0, `${v}: the prefill payload must not be empty${dump(v, r)}`);
  }
  for (let i = 2; i < seen.length; i++) {
    assert.notEqual(
      seen[i].r.text,
      seen[i - 1].r.text,
      `${show(seen[i - 1].v)} and ${show(seen[i].v)} produce a byte-identical fn-gen payload - the ` +
        `developer moved the dial and the model got the same prompt` +
        dump(seen[i - 1].v, seen[i - 1].r) +
        dump(seen[i].v, seen[i].r),
    );
    assert.ok(
      seen[i].r.bytes > seen[i - 1].r.bytes,
      `and a higher stop must ship MORE injected surface, not merely different bytes` +
        dump(seen[i - 1].v, seen[i - 1].r) +
        dump(seen[i].v, seen[i].r),
    );
  }
});

dtest("P1 END TO END, THE SHARP PAIR: `small` and `medium` share a root cap of 8, and must still differ", async () => {
  // This is the row the trap proof is about. Both stops admit the same eight
  // roots, so a build where only the root cap reaches the gesture ships a dial
  // that does nothing at all between the two lowest stops - which is where the
  // default sits, and where most developers will move first. Breadth, the
  // total-type cap and the budget have to reach the walk for these to differ.
  const roots = CANDIDATES.slice(0, 8);
  const world = rustNestedWorld(roots);
  const small = await runUnder("small", "rust", roots, world);
  const medium = await runUnder("medium", "rust", roots, world);
  assert.equal(small.names.length, medium.names.length, `CONTROL - both stops must inject the same eight roots, or this row is just the cap again${dump("small", small)}${dump("medium", medium)}`);
  assert.equal(small.names.length, TABLE.small.roots, `CONTROL - and that count is the shared root cap${dump("small", small)}`);
  assert.notEqual(
    medium.text,
    small.text,
    `\`small\` and \`medium\` produce a byte-identical payload on a nested type graph. Their root caps are ` +
      `equal by design, so breadth (${TABLE.small.breadth} -> ${TABLE.medium.breadth}), total types ` +
      `(${TABLE.small.totalTypes} -> ${TABLE.medium.totalTypes}) and the budget (${TABLE.small.budgetTok} -> ` +
      `${TABLE.medium.budgetTok}) are the only things that can separate them, and none of them reached the walk` +
      dump("small", small) +
      dump("medium", medium),
  );
  assert.ok(
    medium.bytes > small.bytes,
    `and \`medium\` must ship MORE type surface, not merely different bytes${dump("small", small)}${dump("medium", medium)}`,
  );
});

for (const stop of SETTING_VALUES) {
  dtest(`P4 END TO END [${stop}]: all five languages inject exactly ${TABLE[stop].roots} of 20 candidates`, async () => {
    for (const languageId of LANGS) {
      // The control first: fewer candidates than roots injects them all, so the
      // cut below is the root cap biting and not the fixture running dry.
      const few = await runUnder(stop, languageId, CANDIDATES.slice(0, 3));
      assert.equal(few.names.length, 3, `${languageId} @ ${stop}: CONTROL - under the cap every resolvable candidate is injected${dump("control", few)}`);
      const over = await runUnder(stop, languageId, CANDIDATES);
      // Second control: the root cap is only observable in the injected count
      // while the aggregate budget leaves room. A stop whose budget truncates
      // the surface would cut the count for a reason that is not the cap, and
      // the row below would report the wrong defect. These candidates are thin
      // for exactly that reason.
      const starved = over.logs.filter((l) => /budget exhausted|injected nothing/.test(l));
      assert.deepEqual(
        starved,
        [],
        `${languageId} @ ${stop}: CONTROL - the aggregate budget bit before the root cap could be read, so ` +
          `the count below would measure the wrong thing${dump(stop, over)}`,
      );
      assert.equal(
        over.names.length,
        TABLE[stop].roots,
        `${languageId} @ ${stop}: ${CANDIDATES.length} candidates resolve and exactly ${TABLE[stop].roots} ` +
          `must be injected. Every language gets the same numbers; Go's 8-root exception is gone${dump(stop, over)}`,
      );
    }
  });
}

dtest("P6: the stop is read ONCE PER GESTURE, not once per candidate", async () => {
  // "the admission loop does not pay a getConfiguration() per iteration". The
  // observable: the number of configuration reads must not grow with the number
  // of candidates the loop walks.
  const count = async (pool) => {
    globalThis.__V48_CFG_CALLS__ = 0;
    await runUnder("frontier", "rust", pool);
    return globalThis.__V48_CFG_CALLS__;
  };
  const small = await count(CANDIDATES.slice(0, 5));
  const large = await count(CANDIDATES);
  assert.ok(
    large <= small + 2,
    `configuration reads grew from ${small} to ${large} when the candidate pool grew from 5 to ` +
      `${CANDIDATES.length}. That is a config read inside the admission loop. The slack of 2 is for reads ` +
      `that belong to some OTHER setting; 15 extra candidates cannot account for more than that`,
  );
  assert.ok(
    large <= 8,
    `a single fn-gen gesture made ${large} getConfiguration() calls. The contract says the stop is read ` +
      `once per gesture; a handful of reads for OTHER settings is fine, dozens is the per-candidate read`,
  );
});

dtest("P8: the channel names the stop in force and the four numbers it bought", async () => {
  for (const v of SETTING_VALUES) {
    const r = await runUnder(v, "rust", CANDIDATES);
    const line = r.logs.find((l) => l.includes(v));
    assert.ok(
      line,
      `under ${show(v)} no channel line names the stop. "One line per fn-gen, naming the stop and the ` +
        `four numbers, so a developer can see what their setting bought"${dump(v, r)}`,
    );
    const t = TABLE[v];
    for (const [what, n] of [["roots", t.roots], ["breadth", t.breadth], ["total types", t.totalTypes], ["budget", t.budgetTok]]) {
      assert.ok(
        new RegExp(`(^|\\D)${n}(\\D|$)`).test(line),
        `under ${show(v)} the channel line must carry the ${what} number ${n}. Line: ${show(line)}${dump(v, r)}`,
      );
    }
  }
});

dtest("P8: exactly ONE stop line per gesture", async () => {
  const r = await runUnder("large", "rust", CANDIDATES);
  // Numbers are matched with a non-digit boundary rather than \b, because the
  // channel legitimately writes units (`budget=2400tok`) and \b would not fire.
  const num = (n) => new RegExp(`(^|\\D)${n}(\\D|$)`);
  const lines = r.logs.filter((l) => /large/.test(l) && num(12).test(l) && num(2400).test(l));
  assert.equal(lines.length, 1, `"one line per fn-gen" - got ${lines.length}${dump("large", r)}`);
});

dtest("the replaced setting: a stale `injectedSurface` gets one channel line naming its replacement, and is otherwise ignored", async () => {
  const before = [globalThis.__V48_CONFIG__, globalThis.__V48_CFG_MODE__, globalThis.__V48_NO_GETCONFIG__];
  globalThis.__V48_CONFIG__ = { [REPLACED_SETTING]: "generous", injectedSurface: "generous" };
  globalThis.__V48_CFG_MODE__ = undefined;
  globalThis.__V48_NO_GETCONFIG__ = false;
  let stale;
  try {
    stale = await runPrefill("rust", CANDIDATES);
  } finally {
    [globalThis.__V48_CONFIG__, globalThis.__V48_CFG_MODE__, globalThis.__V48_NO_GETCONFIG__] = before;
  }
  const notice = stale.logs.filter((l) => /injectedSurface/.test(l) && /injectedContext/.test(l));
  assert.equal(
    notice.length,
    1,
    `a user who still has ${REPLACED_SETTING} set gets ONE channel line naming the replacement ` +
      `${SETTING}. Got ${notice.length} such lines${dump("stale", stale)}`,
  );
  const plain = await runUnder(undefined, "rust", CANDIDATES);
  assert.equal(
    stale.names.length,
    plain.names.length,
    `and their value is otherwise IGNORED: the stale ${show("generous")} must buy exactly what the default ` +
      `\`small\` buys${dump("stale", stale)}${dump("default", plain)}`,
  );
  assert.equal(stale.text, plain.text, `byte for byte ignored, not merely the same count${dump("stale", stale)}${dump("default", plain)}`);
});

// ===========================================================================
// 7. P7. FIM IS UNTOUCHED.
//
// src/vscode/completionProvider.ts is NOT one of the files this oracle was told
// to stay out of, but reading its bounds by hand would still put an
// implementation detail in the assertions, so the rows below read it at RUN time
// and assert two things from the contract's own words: the bounds are plain
// numeric literals (they cannot be reading the stop if they are), and nothing on
// the FIM path names the dial.
// ===========================================================================

const CP_PATH = path.join(ROOT, "src", "vscode", "completionProvider.ts");

// `NAME = { ... }` wherever it is declared, brace-balanced so a nested member
// does not truncate the read. Comments are stripped first so a `// note` beside
// a member cannot be read as part of that member's value. The optional digits on
// the name are for esbuild, which suffixes a symbol when two modules collide.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
function objectDecl(src, name) {
  const re = new RegExp(`\\b${name}\\d*\\b[^=\\n]*=\\s*\\{`);
  const m = re.exec(src);
  if (!m) return undefined;
  const start = src.indexOf("{", m.index);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return undefined;
}
// Top-level `key: value` members of a brace-balanced object literal.
function membersOf(text) {
  const body = text.slice(1, -1);
  const out = {};
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  for (const p of parts) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]+)$/.exec(p);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// A member is stop-independent if it is a numeric literal, or a reference to a
// member of another bounds constant in the same file that is itself one. FIM's
// CROSS_FILE_BOUND borrowing DATASHAPE_BOUNDS.D_MAX is a cross-reference between
// two frozen literals, not a read of the dial, and the contract's claim is about
// the latter.
function fimBoundValue(code, expr, seen = new Set()) {
  const t = expr.trim();
  if (/^-?\d+$/.test(t)) return Number(t);
  const ref = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(t);
  if (ref && !seen.has(t)) {
    seen.add(t);
    const decl = objectDecl(code, ref[1]);
    if (decl) {
      const v = membersOf(decl)[ref[2]];
      if (v !== undefined) return fimBoundValue(code, v, seen);
    }
  }
  return undefined;
}

test("P7: FIM's own DATASHAPE_BOUNDS and CROSS_FILE_BOUND resolve to fixed numbers - they cannot be reading the stop", () => {
  const code = stripComments(fs.readFileSync(CP_PATH, "utf8"));
  for (const name of ["DATASHAPE_BOUNDS", "CROSS_FILE_BOUND"]) {
    const decl = objectDecl(code, name);
    assert.ok(decl, `${name} must be declared in ${CP_PATH}; the contract says it keeps its shipped values`);
    const members = membersOf(decl);
    assert.ok(Object.keys(members).length > 0, `${name}: no members parsed out of ${show(decl)}`);
    for (const [k, v] of Object.entries(members)) {
      assert.ok(
        fimBoundValue(code, v) !== undefined,
        `${name}.${k} is ${show(v)}, which does not resolve to a fixed number. "FIM caps spend latency ` +
          `against a keystroke deadline, not prompt budget, and the dial is about the fn-gen model's ` +
          `context window." A bound derived from the resolved stop is exactly the FIM change the contract ` +
          `excludes. Declaration: ${show(decl)}`,
      );
    }
  }
});

test("P7: nothing on the FIM path names the context dial", () => {
  const code = stripComments(fs.readFileSync(CP_PATH, "utf8"));
  assert.ok(!/injectedContext/.test(code), `${CP_PATH} names the dial setting; FIM must not read the stop`);
  // The discovered resolver's own export name, whatever the implementer called
  // it. A FIM file that calls it is reading the stop - UNLESS the stop was folded
  // into a pre-existing seam that FIM already used for its own reasons, which is
  // what `budgetProfileFor` and `modelClassFor` are (session-v46 phase 0b). Those
  // two are exempt: for them the "does FIM read the stop" question is answered by
  // the fixed-numbers row above, not by a name.
  const V46_SEAM = ["budgetProfileFor", "modelClassFor"];
  const symbol = DIAL ? DIAL.how.split(" ")[0].split(".").pop() : undefined;
  if (symbol && !V46_SEAM.includes(symbol)) {
    assert.ok(
      !new RegExp(`\\b${symbol}\\b`).test(code),
      `${CP_PATH} calls ${show(symbol)}, the stop resolver. "FIM caps spend latency against a keystroke ` +
        `deadline, not prompt budget"; this diverges from goal.md phase 1 on purpose and the contract says so`,
    );
  }
  // The control: the file being scanned is the right one and does hold the bounds.
  assert.ok(/DATASHAPE_BOUNDS/.test(code), `CONTROL - ${CP_PATH} must be the file that declares the FIM bounds`);
});

test("P7: FIM's bounds are the shipped ones (D_MAX 2, B_MAX 4, N_MAX 6; cross-file D_MAX 2, N_MAX 12)", () => {
  // The values, from the pre-dial point goal.md states for completionProvider.ts
  // and from the CROSS_FILE_BOUND value adversarial-v39-p1.test.cjs records.
  // Split from the row above deliberately: that one is the contract's claim,
  // this one is the numbers, so a wrong number and a dial-reading bound do not
  // report as the same failure.
  const code = stripComments(fs.readFileSync(CP_PATH, "utf8"));
  const read = (name, member) => fimBoundValue(code, membersOf(objectDecl(code, name) || "{}")[member] ?? "");
  for (const [k, want] of [["D_MAX", 2], ["B_MAX", 4], ["N_MAX", 6]]) {
    assert.equal(read("DATASHAPE_BOUNDS", k), want, `FIM DATASHAPE_BOUNDS.${k} must stay ${want}. Declaration: ${show(objectDecl(code, "DATASHAPE_BOUNDS"))}`);
  }
  for (const [k, want] of [["D_MAX", 2], ["N_MAX", 12]]) {
    assert.equal(read("CROSS_FILE_BOUND", k), want, `FIM CROSS_FILE_BOUND.${k} must stay ${want}. Declaration: ${show(objectDecl(code, "CROSS_FILE_BOUND"))}`);
  }
});

// ===========================================================================
// 8. "WHAT MUST NOT CHANGE."
// ===========================================================================

test("must not change: GEN_NUM_CTX, GEN_TIMEOUT_MS, GEN_MAX_TOKENS and FRONTIER_MAX_TOKENS keep their values", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  // Reached through the v46 budget-profile seam, which is where these four are
  // observable from outside: `numCtx`, `timeoutMs` and `maxTokens` per model
  // class (blind-v46-budgetprofile.test.cjs is the frozen row for the same
  // values). If the dial dragged any of them along, this row is where it shows.
  assert.equal(typeof BP.budgetProfileFor, "function", "budgetProfileFor must still be exported");
  // Directly, where the constants are exported under their own names. This is
  // the sharpest form of the must-not-change row: no derivation, no profile
  // lookup, the constant itself.
  const DIRECT = { GEN_NUM_CTX: 16384, GEN_TIMEOUT_MS: 120000, GEN_MAX_TOKENS: 2048, FRONTIER_MAX_TOKENS: 64000 };
  for (const [name, want] of Object.entries(DIRECT)) {
    if (BP[name] === undefined) continue; // reached through the profile below instead
    assert.equal(BP[name], want, `${name} is on the must-not-change list and must still be ${want}`);
  }
  const WANT = { "fim-small": 2048, "local-mid": 2048, frontier: 64000 };
  for (const [cls, maxTokens] of Object.entries(WANT)) {
    for (const lang of LANGS) {
      const p = BP.budgetProfileFor(cls, lang);
      assert.equal(p.numCtx, 16384, `GEN_NUM_CTX via budgetProfileFor(${cls}, ${lang}).numCtx`);
      assert.equal(p.timeoutMs, 120000, `GEN_TIMEOUT_MS via budgetProfileFor(${cls}, ${lang}).timeoutMs`);
      assert.equal(p.maxTokens, maxTokens, `${cls === "frontier" ? "FRONTIER_MAX_TOKENS" : "GEN_MAX_TOKENS"} via budgetProfileFor(${cls}, ${lang}).maxTokens`);
    }
  }
});

dtest("must not change: none of the four survivors moves with the stop", () => {
  // The same four numbers, read once per stop. A build that made them stop-aware
  // would pass the row above (which never names a stop) and fail here.
  assert.equal(typeof BP.budgetProfileFor, "function", "budgetProfileFor must still be exported");
  for (const stop of STOPS) {
    for (const cls of ["fim-small", "local-mid", "frontier"]) {
      const withStop = BP.budgetProfileFor(cls, "rust", stop);
      const without = BP.budgetProfileFor(cls, "rust");
      for (const k of ["numCtx", "timeoutMs", "maxTokens"]) {
        assert.equal(
          withStop[k],
          without[k],
          `${cls} @ ${show(stop)}: ${k} moved with the stop (${show(withStop[k])} vs ${show(without[k])}). ` +
            `GEN_NUM_CTX, GEN_TIMEOUT_MS, GEN_MAX_TOKENS and FRONTIER_MAX_TOKENS are on the must-not-change list`,
        );
      }
    }
  }
});

test("must not change: TESTGEN_PROFILE's numbers are plain literals, chosen for construction and unmeasured at any stop", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  // Reached through the built bundle rather than the source, so the assertion
  // survives whichever module the profile is declared in. esbuild may suffix the
  // name when two modules collide, hence the optional digits.
  const decl = objectDecl(stripComments(bundleSrc), "TESTGEN_PROFILE");
  assert.ok(decl, "TESTGEN_PROFILE must still exist as a declared profile object in the bundle");
  const members = membersOf(decl);
  assert.equal(Number(members.totalTok), 500, `TESTGEN_PROFILE.totalTok must stay 500. Got ${show(decl)}`);
  // The contract's claim is that the dial does not reach it: "no measurement has
  // ever been taken against that gesture at any stop". So no member may name a
  // stop or the resolver.
  const symbol = DIAL ? DIAL.how.split(" ")[0].split(".").pop() : "__no_dial__";
  for (const [k, v] of Object.entries(members)) {
    assert.ok(
      !new RegExp(`\\b(${symbol}|${STOPS.join("|")})\\b`).test(v),
      `TESTGEN_PROFILE.${k} is ${show(v)}, which reads the dial. "Its numbers were chosen for construction ` +
        `and no measurement has ever been taken against that gesture at any stop"`,
    );
  }
});

// ===========================================================================
// 9. THE MANIFEST. A developer reads this, not the source.
// ===========================================================================

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const PROPS = (PKG.contributes && PKG.contributes.configuration && PKG.contributes.configuration.properties) || {};

test(`manifest: ${SETTING} is a string enum of exactly small, medium, large, frontier, defaulting to small`, () => {
  const p = PROPS[SETTING];
  assert.ok(p, `${SETTING} must be declared under contributes.configuration.properties. Present keys: ${show(Object.keys(PROPS))}`);
  assert.equal(p.type, "string", `${SETTING} is a named choice, not a number the developer tunes. Got ${show(p.type)}`);
  assert.deepEqual(p.enum, SETTING_VALUES, `${SETTING} offers exactly ${show(SETTING_VALUES)}, in that order. Got ${show(p.enum)}`);
  assert.equal(p.default, "small", `${SETTING} defaults to ${show("small")}, the install default for a 30B class local model. Got ${show(p.default)}`);
  assert.ok(!(p.enum || []).includes("shipped"), `\`shipped\` is NOT offered in contributes.configuration; it is the rig's before-side only. Got ${show(p.enum)}`);
});

test(`manifest: ${SETTING} carries a description and one enumDescription per value`, () => {
  const p = PROPS[SETTING] || {};
  assert.equal(typeof p.description, "string", `${SETTING} needs a description; the settings UI shows nothing else`);
  assert.ok(p.description.trim().length > 0, `${SETTING}: the description must not be empty`);
  assert.ok(Array.isArray(p.enumDescriptions), `${SETTING} needs enumDescriptions, or the picker is four bare words. Got ${show(p.enumDescriptions)}`);
  assert.equal(p.enumDescriptions.length, SETTING_VALUES.length, `one enumDescription per value. Got ${show(p.enumDescriptions)}`);
  p.enumDescriptions.forEach((d, i) =>
    assert.ok(typeof d === "string" && d.trim().length > 0, `${SETTING}: enumDescriptions[${i}] for ${show(SETTING_VALUES[i])} is empty`),
  );
});

test(`manifest: ${REPLACED_SETTING} is GONE, and it is the only injected-* key that is`, () => {
  const keys = Object.keys(PROPS);
  assert.ok(keys.length > 5, `CONTROL - the manifest must have real settings to scan; found ${keys.length}`);
  assert.ok(!keys.includes(REPLACED_SETTING), `${REPLACED_SETTING} "is gone from contributes.configuration". Present: ${show(keys.filter((k) => /injected/i.test(k)))}`);
  assert.deepEqual(
    keys.filter((k) => /injected/i.test(k)),
    [SETTING],
    `exactly ONE user-facing key governs the injected surface. Got ${show(keys.filter((k) => /injected/i.test(k)))}`,
  );
});

test(`the code: ${REPLACED_SETTING} is gone from the built bundle except where the stale-value notice names it`, () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  // "It replaces column80.injectedSurface ... `injectedSurface` is gone from
  // contributes.configuration and from the code." The one surviving mention the
  // contract itself requires is the channel line naming the replacement, so the
  // row bounds the mentions rather than banning the string outright.
  // Counted as a SETTING KEY, not as a bare identifier. `injectedSurface` is
  // also an internal field name on the prompt/punt/service inputs (the injected
  // type surface text), which has nothing to do with the setting and is not what
  // the contract retires. Only a quoted key or the qualified `column80.` form is
  // a read of the setting.
  const keyHits = (bundleSrc.match(/["'`]injectedSurface["'`]|column80\.injectedSurface/g) || []).length;
  assert.ok(
    keyHits <= 3,
    `${keyHits} reads of the ${show(REPLACED_SETTING)} SETTING KEY survive in the bundle. The setting is ` +
      `gone from the code; what the contract still needs is the one-line notice naming its replacement, ` +
      `which costs the key itself and at most its appearance in the message`,
  );
  assert.ok(
    !/\binjectedTypeCap\b/.test(bundleSrc),
    `injectedTypeCap - the function that applied injectedSurface on top of the per-language entry - is ` +
      `still in the bundle. The setting it served "is gone from ... the code"`,
  );
});
