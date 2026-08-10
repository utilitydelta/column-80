// ADVERSARIAL REVIEW - session-v42 phase 2 (the per-language prefill type cap).
// Rules as ever: FAILING rows are defect claims with evidence, PASSING rows
// are attacks that did not land, kept as the record.
//
// Sections:
//   S - seam pins the blind contract does not carry: the exact per-language
//       cap values, the Go UPPER bound (blind offers only 6 types, so a
//       runaway cap passes its row), the typeCap<=resolveCap coupling, and
//       the injectedSurface config interactions (minimal/generous).
//   R - the RIG: the cap-arm patch mechanism (lib-core.cjs loadPrefillCap,
//       quoted regex `var PREFILL_TYPE_CAP = 4;`) patches the four-language
//       default and can no longer move GO's cap, because Go now reads
//       GO_PREFILL_TYPE_CAP. Its own guard ("the arm would have silently run
//       at the shipped value") cannot fire - the pattern still matches. A
//       future Go cap arm below 8 silently measures the shipped 8. R1 makes
//       that concrete with the identical patch applied to this file's own
//       bundle.
//   B - the bytes/starvation claim: 8 fat types against the shared
//       DATASHAPE_TOTAL_TOK budget; where the render-pass truncation lands,
//       and whether the top-priority type's def survives whole (the S39-1
//       root-starvation shape).
//   L - the 359 lowercase local-leg recoveries: REAL in the shipped path, or
//       a funnel artifact.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v42-p2.test.cjs

// THE MEASUREMENT RIG LIVES IN A DIFFERENT REPOSITORY (2026-08-10). It and the
// session archives were split into a private repo because they carry corpora
// taken against private client code and cannot be published, so a public clone
// has no `session-complxity-research/` and the rows below have no subject.
//
// The whole file skips, with the reason on the channel. It SKIPS rather than
// passing vacuously: a row that goes green when the thing it tests is absent is
// the false green this suite exists to prevent. Where a baseline can be
// vendored instead, vendor it (see test/fixtures/prompt) and do not use this.
const { RIG_PRESENT, SKIP_REASON } = require("./.rig-present.cjs");
if (!RIG_PRESENT) {
  require("node:test")("rig-dependent rows", { skip: SKIP_REASON }, () => {});
  return;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".adversarial-v42-p2-vscode-stub.cjs");
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
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: (section) => ({
      get: (k, f) => {
        const cfg = globalThis.__ADV42P2_CFG__ || {};
        return cfg[k] !== undefined ? cfg[k] : f;
      },
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    openTextDocument: (arg) => {
      const files = globalThis.__ADV42P2_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".adversarial-v42-p2.entry.ts");
const OUTFILE = path.join(__dirname, ".adversarial-v42-p2.bundle.cjs");
const PATCHED = path.join(__dirname, ".adversarial-v42-p2.cap6.bundle.cjs");
let mod;
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { resolvePrefill, prefillLangFor } from "../src/vscode/fnGen";\n` +
      `export { budgetProfileFor, contextBoundsFor, DEFAULT_CONTEXT_STOP } from "../src/core/budgetProfile";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  mod = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
const V = (() => { try { return require(STUB); } catch { return undefined; } })();
test.after(() => [STUB, ENTRY, OUTFILE, PATCHED].forEach((f) => fs.rmSync(f, { force: true })));

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip(`bundle broken: ${bundleErr.message}`);
    return fn(ctx);
  });

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
    return new V.Position(lines.length - 1, 0);
  };
  return { uri: { toString: () => uriStr }, offsetAt, positionAt, getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text) };
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
  const typeAt = (c) => {
    const w = wordAt(files[c.uri], c);
    return w && known.has(w) ? w : undefined;
  };
  return {
    definition: async (c) => {
      const t = typeAt(c);
      if (!t) return undefined;
      const lines = files[defTypes[t].uri].split("\n");
      const ln = lines.findIndex((l) => defTypes[t].declRe.test(l));
      const ch = Math.max(0, lines[ln]?.indexOf(t) ?? 0);
      return { uri: defTypes[t].uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
    },
    hoverSurface: async (c) => {
      const t = typeAt(c);
      return t ? { signature: defTypes[t].hover } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAt(c);
      return t ? defTypes[t].members : [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

// A Go fixture with N same-file struct types, every one doc-named, anchorable,
// hover-resolvable and carrying one member - only a CAP can hold one back.
// `fieldCount` (session-v49) makes the struct as fat as a row needs. It was
// added when Go's data-shape leg lit and 10 fields per type stopped being enough
// to reach the shared budget - see B1.
function goFixture(names, { fat = false, fieldCount } = {}) {
  const uri = "file:///work/adv42p2/main.go";
  const fields = (n) =>
    fieldCount
      ? Array.from({ length: fieldCount }, (_, i) => `\tField${i} ${i % 2 ? "int" : "string"}`).join("\n")
      : fat
      ? Array.from({ length: 10 }, (_, i) => `\tField${i} ${i % 2 ? "int" : "string"}`).join("\n")
      : "\tN int";
  const decls = names.map((n) => `type ${n} struct {\n${fields(n)}\n}`).join("\n\n");
  const src = [
    "package app",
    "",
    decls,
    "",
    "// Decide implements the committed behaviour.",
    `// It works with ${names.map((n) => "`" + n + "`").join(", ")}.`,
    "func Decide() int {",
    "\treturn 0",
    "}",
    "",
  ].join("\n");
  const defTypes = {};
  for (const n of names) {
    defTypes[n] = {
      uri,
      declRe: new RegExp(`^type ${n} struct`),
      hover: `type ${n} struct {\n${fields(n)}\n}`,
      members: [{ name: "Do", kind: "method", signature: `Do() ${n}` }],
    };
  }
  const record = {
    span: { start: src.indexOf("func Decide"), end: src.length - 2 },
    signature: "func Decide() int",
    docComment: `// Decide implements the committed behaviour.\n// It works with ${names.map((n) => "`" + n + "`").join(", ")}.`,
    symbolName: "Decide",
    languageId: "go",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "\t",
  };
  return { uri, src, defTypes, record };
}

async function runWith(resolvePrefill, fx, cfg, extraOpts) {
  const files = { [fx.uri]: fx.src };
  const logs = [];
  const disclosed = [];
  globalThis.__ADV42P2_FILES__ = files;
  if (cfg) globalThis.__ADV42P2_CFG__ = cfg;
  let text;
  try {
    text = (await resolvePrefill(makeExtractor(files, fx.defTypes), makeDoc(fx.src, fx.uri), fx.record, (l) => logs.push(String(l)), {
      onDisclosed: (d) => disclosed.push(...d.map((x) => x.name)),
      ...(extraOpts || {}),
    })) || "";
  } finally {
    delete globalThis.__ADV42P2_FILES__;
    delete globalThis.__ADV42P2_CFG__;
  }
  return { text, logs, disclosed };
}

const TEN = ["Alpha", "Bravo", "Chart", "Delta", "Echos", "Foxes", "Golfs", "Hotel", "India", "Julie"];
// A pool wider than any stop's root cap, so a dial row can never be bounded by
// its own fixture instead of by the number it is measuring.
const TWENTY = [...TEN, "Kilos", "Limas", "Mikes", "Novem", "Oscar", "Papas", "Quebe", "Romeo", "Sierr", "Tango"];

// ===========================================================================
// S. SEAM PINS the blind file does not carry.
// ===========================================================================

// SUPERSEDED by session-v48 phase 1 (docs/supersessions.md). The per-language
// split this row pinned is gone by ruling of 2026-08-10: every language reads
// the context stop's root cap, and Go's measured 8 is why the dial's bottom stop
// is 8 FOR EVERYONE rather than why Go alone gets it. The coupling half of the
// row survives untouched, and is the half that was load-bearing.
btest("SUPERSEDED (v48 phase 1): one root cap for all five languages, and it never exceeds the resolve cap", () => {
  const { prefillLangFor, budgetProfileFor, contextBoundsFor, DEFAULT_CONTEXT_STOP } = mod;
  const caps = {};
  for (const id of ["go", "rust", "typescript", "csharp", "python"]) {
    assert.ok(prefillLangFor(id), `${id} must still have a prefill entry`);
    const p = budgetProfileFor("local-mid", id, DEFAULT_CONTEXT_STOP);
    caps[id] = { rootCap: p.rootCap, resolveCap: p.resolveCap };
  }
  const distinct = new Set(Object.values(caps).map((c) => JSON.stringify(c)));
  assert.equal(distinct.size, 1, `five languages, one set of caps; got ${JSON.stringify(caps)}`);
  assert.equal(caps.go.rootCap, contextBoundsFor(DEFAULT_CONTEXT_STOP).rootCap, "and it is the stop's own");
  // The coupling the ladder leaned on: a type cap above the resolve cap
  // promises slots that can never fill (the report's own clamp doctrine). It is
  // a property of EVERY stop now, which is a stronger version of the same pin.
  for (const stop of ["shipped", "small", "medium", "large", "frontier"]) {
    const b = contextBoundsFor(stop);
    assert.ok(
      b.rootCap <= b.resolveCap,
      `${stop}: rootCap (${b.rootCap}) > resolveCap (${b.resolveCap}): slots promised that cannot fill; the ladder's knee argument is void`,
    );
  }
});

btest("S2: the Go UPPER bound - ten perfect candidates disclose exactly 8, and the cap line names the two evicted", async () => {
  // The blind row offers six types, so it proves "more than 4" and nothing
  // else: a cap of 20 passes it. This row is the missing upper pin.
  const fx = goFixture(TEN);
  const r = await runWith(mod.resolvePrefill, fx);
  assert.equal(
    r.disclosed.length,
    8,
    `exactly 8 of 10 disclose under typeCap=8 (got ${r.disclosed.length}: ${r.disclosed.join(", ")})\nLOGS:\n${r.logs.join("\n")}`,
  );
  assert.ok(
    r.logs.some((l) => /dropped 2 lower-priority type\(s\)/.test(l)),
    `the eviction is LOGGED, never silent.\nLOGS:\n${r.logs.join("\n")}`,
  );
});

// SUPERSEDED by session-v48 phase 1 (docs/supersessions.md). `injectedSurface`
// and its auto/minimal/generous ladder are gone: the setting moved ONE of the
// four numbers bounding the injected surface, and the session's trap proof is
// that one alone cannot change the prompt. The row is re-cut onto the setting
// that replaced it, keeping its subject exactly - a config value in front of the
// resolver must change how many types are disclosed.
btest("SUPERSEDED (v48 phase 1): the CONTEXT setting moves the disclosed count, and an unrecognised value falls to the default", async () => {
  const { contextBoundsFor, DEFAULT_CONTEXT_STOP } = mod;
  const counts = {};
  for (const stop of ["small", "large"]) {
    const r = await runWith(mod.resolvePrefill, goFixture(TWENTY), { injectedContext: stop });
    counts[stop] = r.disclosed.length;
    assert.equal(
      r.disclosed.length,
      contextBoundsFor(stop).rootCap,
      `under ${stop} exactly the stop's root cap discloses (got ${r.disclosed.length}: ${r.disclosed.join(", ")})`,
    );
  }
  assert.ok(counts.large > counts.small, `the dial must MOVE the count: ${JSON.stringify(counts)}`);
  const junk = await runWith(mod.resolvePrefill, goFixture(TWENTY), { injectedContext: "enormous" });
  assert.equal(
    junk.disclosed.length,
    contextBoundsFor(DEFAULT_CONTEXT_STOP).rootCap,
    `an unrecognised value is the install default, never a fifth behaviour (got ${junk.disclosed.length})`,
  );
});

// ===========================================================================
// R. THE RIG's cap-arm mechanism vs the new seam.
// ===========================================================================

// RE-CUT TWICE. The original row's complaint was that Go read its own
// `GO_PREFILL_TYPE_CAP` while lib-core's loadPrefillCap patched the shared
// `PREFILL_TYPE_CAP`, so a Go cap-6 arm silently measured the shipped 8.
//
// The session-v48 phase-1 cut then re-pointed it at this file's own bundle with
// `{ contextStop: "shipped" }` passed EXPLICITLY - and that is a caller shape the
// rig does not have. The rig calls `resolvePrefill(extractor, doc, resolved,
// log)` with no options, its stub answers the default for every setting, so it
// resolved `small`, where no patched constant is read at all: five loaders, five
// byte-identical prompts, and this row green over the top of it. A guard that
// tests a caller shape nobody uses guards nothing.
//
// So the row now drives THE RIG'S OWN LOADER, with the rig's own call shape and
// no stop argument. It is the whole mechanism end to end: lib-core patches the
// bundle, pins the stop its patches feed, and the arm must come out different
// from the unpatched one.
btest("R1: a cap arm built by the RIG'S OWN LOADER, called the way the rig calls it, moves Go's cap", async () => {
  const lib = require(path.join(__dirname, "..", "session-complxity-research", "spikes", "lib-core.cjs"));
  const fx = goFixture(["Alpha", "Bravo", "Chart", "Delta", "Echos", "Foxes", "Golfs", "Hotel"]);
  const base = lib.loadPrefill();
  const arm = lib.loadPrefillCap(6, "go");
  // The rig's bundles carry the RIG's vscode stub, which serves open documents
  // out of `__CSL_DOCS__` (lib-core's makeDoc registers them there). Register
  // the fixture the same way, or the def file cannot be opened and every
  // candidate dies for a reason that has nothing to do with the cap.
  const priorDocs = globalThis.__CSL_DOCS__;
  globalThis.__CSL_DOCS__ = { [fx.uri]: { uri: { toString: () => fx.uri }, getText: () => fx.src } };
  try {
    // NO contextStop, NO settings: exactly what run-arm.cjs passes.
    const unpatched = await runWith(base.mod.resolvePrefill, fx);
    const patched = await runWith(arm.mod.resolvePrefill, fx);
    assert.equal(
      unpatched.disclosed.length,
      8,
      `CONTROL - the rig's baseline loader must render the pre-dial Go point, which is 8 roots ` +
        `(got ${unpatched.disclosed.length}: ${unpatched.disclosed.join(", ")})`,
    );
    assert.equal(
      patched.disclosed.length,
      6,
      `a cap-6 Go arm disclosed ${patched.disclosed.length} types: the patch never reached the resolved ` +
        `stop and the arm silently measured the shipped value - the failure the rig's guard exists to prevent.`,
    );
    assert.notEqual(
      patched.text,
      unpatched.text,
      "and the ARM'S PROMPT must differ from the baseline's. Five loaders rendering byte-identical prompts " +
        "is precisely how this defect hid.",
    );
  } finally {
    globalThis.__CSL_DOCS__ = priorDocs;
    base.cleanup();
    arm.cleanup();
  }
});

btest("R2: the rig's arm guard FIRES when a patched constant cannot reach the resolved stop", async () => {
  // The guard's own row. `assertArmBinds` asks the product what profile is in
  // force and compares it with what the arm asked for; the two ways an arm goes
  // inert are a stop the patches do not feed, and a patch that no longer lands.
  const lib = require(path.join(__dirname, "..", "session-complxity-research", "spikes", "lib-core.cjs"));
  assert.equal(typeof lib.assertArmBinds, "function", "the guard must be exported so it can be tested");
  const shipped = { stop: "shipped", rootCap: 4, resolveCap: 8, totalTok: 300, memberCap: 24, dataShape: { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 200 }, crossFile: { D_MAX: 2, N_MAX: 12 } };
  const probe = (profile, stopOnChannel = "shipped") => ({ rigProfile: () => profile, rigStopInForce: () => stopOnChannel });
  assert.throws(
    () => lib.assertArmBinds(probe({ ...shipped, stop: "small", rootCap: 8 }), "probe", { rootCap: 24 }),
    /stop "small"/,
    "an arm rendered at a stop the patched constants do not feed must throw, not run",
  );
  assert.throws(
    () => lib.assertArmBinds(probe(shipped), "probe", { rootCap: 24 }),
    /rootCap=24 and the product resolves rootCap=4/,
    "an arm whose cap patch did not land must throw, not silently measure the shipped value",
  );
  // The behavioural half, and the one that catches the defect that started
  // this: the table says `shipped` while the product's own channel says the
  // entry point ran at the settings default, because nothing passed the stop.
  assert.throws(
    () => lib.assertArmBinds(probe({ ...shipped, rootCap: 24 }, "small"), "probe", { rootCap: 24 }),
    /reports stop "small" on its own channel/,
    "a bundle whose resolvePrefill renders at the setting's default must throw however good the table looks",
  );
  assert.doesNotThrow(
    () => lib.assertArmBinds(probe({ ...shipped, rootCap: 24, totalTok: 4000 }), "probe", { rootCap: 24, totalTok: 4000 }),
    "and an arm that DID bind must run",
  );
});

// ===========================================================================
// B. THE BYTES CLAIM under the shared data-shape budget.
// ===========================================================================

// B1 - RE-OPENED AND RE-ARGUED 2026-08-10, session-v49 phase 1, under HUMAN
// RULING R2, by the blind non-implementer role.
//
// WHAT THE ROW USED TO ASSERT, and why it is gone. The old ruling was that the
// S39-1 starvation shape - 8 types sharing the data-shape budget until the
// top-priority type's def is gutted to a marker-only stub - was UNREACHABLE for
// Go, because Go rendered MEMBER SIGNATURES ONLY and never read a def at all.
// Its last assertion was `!/Data shape of/` with a failure message saying, in
// terms, "if this fires the dark-leg premise no longer holds, re-review the
// starvation angle". It fired. This is that re-review.
//
// THIS IS A RE-OPEN, NOT A RE-BASELINE. The premise died by design: session-v49
// phase 1 lit Go's data-shape field leg, so Go now renders a def and now shares
// the aggregate budget with everyone else. Deleting the assertion and calling the
// row green would leave the suite with no claim at all about the thing the
// original attack was aimed at, which is the outcome the human's ruling forbids:
// "starvation must be DISCLOSED. Go ships either way - a SILENT starve is the
// defect, not the starve."
//
// MEASURED, both sides, same fixture, same instrument (2026-08-10):
//
//   | 8 types            | before phase 1 | after phase 1 |
//   |--------------------|----------------|---------------|
//   | 1 field each       | 1148 bytes     | 1868 bytes    |
//   | 10 fields each     | 1148 bytes     | 2892 bytes    |
//   | data-shape blocks  | 0              | 8             |
//   | types starved      | 0 (impossible) | 0             |
//
// The before-column is the old ruling in one number: 1148 bytes whether the
// structs carried one field or ten, because no field ever reached the prompt.
// Fat types were free precisely because their shape was thrown away.
//
// THE NEW RULING. Starvation is REACHABLE for Go now, and it is DISCLOSED. Push
// the same 8 types to 30 fields each and the shared aggregate does run out: the
// last types get no shape block. Every one of them is NAMED, twice - once on its
// own walk's drop line and once on the aggregate line that also names the
// setting to raise - and every one still carries its full member block, so the
// member list a developer has today is never the thing that is lost. Zero types
// vanish silently. That is the whole claim, and it is what this row now pins.
//
// The original S39-1 shape - the ROOT gutted while later types render - still
// does not land: the budget is spent in priority order, so the first type's def
// renders whole and the starve falls on the tail.
btest("B1: RULING RE-OPENED - the S39-1 starvation shape is REACHABLE for Go prefill since session-v49, and every starved type is NAMED rather than silently dropped", async () => {
  const names = ["Alpha", "Bravo", "Chart", "Delta", "Echos", "Foxes", "Golfs", "Hotel"];

  // PART 1 - the premise reversal, stated as an assertion rather than a comment.
  // Eight fat types now render eight data-shape blocks AND eight member blocks,
  // and nothing is starved at this width.
  const fat = await runWith(mod.resolvePrefill, goFixture(names, { fat: true }));
  assert.equal(fat.disclosed.length, 8, `all eight disclose (got ${fat.disclosed.length})`);
  for (const n of names) {
    assert.ok(fat.text.includes(`Members of \`${n}\``), `every disclosed type carries its member block.\nPROMPT:\n${fat.text}`);
    assert.ok(
      fat.text.includes(`Data shape of \`${n}\``),
      `Go renders a data-shape block per type since session-v49 phase 1. If this stops, the field leg went dark ` +
        `again and the OLD ruling is what applies - do not simply re-cut this row.\nPROMPT:\n${fat.text}`,
    );
  }

  // PART 2 - reach the starvation. Same eight types, 30 fields each.
  const lean = await runWith(mod.resolvePrefill, goFixture(names, { fieldCount: 30 }));
  assert.equal(lean.disclosed.length, 8, `all eight still disclose (got ${lean.disclosed.length})`);
  const rendered = names.filter((n) => lean.text.includes(`Data shape of \`${n}\``));
  const starved = names.filter((n) => !rendered.includes(n));
  assert.ok(
    starved.length > 0,
    `THE ROW HAS GONE VACUOUS. 30 fields across 8 types no longer exhausts the shared data-shape budget, so this ` +
      `row is no longer measuring a starve. Widen the fixture until it does, or the disclosure claim below is ` +
      `asserting nothing.\nPROMPT:\n${lean.text}`,
  );

  // THE CLAIM. Every type either RENDERS or is NAMED. Never neither.
  const dropLines = lean.logs.filter((l) => /dropped/.test(l));
  for (const n of starved) {
    assert.ok(
      dropLines.some((l) => l.includes(n)),
      `\`${n}\` lost its data shape and NOTHING on the channel says so. A silent starve is the defect this ruling ` +
        `exists to forbid - the type may be dropped, it may not be dropped quietly.\nLOGS:\n${lean.logs.join("\n")}`,
    );
  }
  // The aggregate line is the one a developer actually reads: it must carry the
  // count, the names and the way out.
  const agg = lean.logs.find((l) => /injected context dropped/.test(l));
  assert.ok(agg, `an aggregate accounting line must name the starve.\nLOGS:\n${lean.logs.join("\n")}`);
  for (const n of starved) assert.ok(agg.includes(n), `the aggregate line names \`${n}\`.\nLINE: ${agg}`);
  assert.match(agg, /column80\.injectedContext/, `and it names the setting that buys the shape back.\nLINE: ${agg}`);

  // AND THE MEMBER LIST IS NEVER WHAT IS LOST. A starved type keeps the surface
  // it had before the field leg existed, which is the guard that makes shipping
  // this leg strictly better than not shipping it.
  for (const n of names) {
    assert.ok(lean.text.includes(`Members of \`${n}\``), `a starved type keeps its member block.\nPROMPT:\n${lean.text}`);
  }

  // PART 3 - the original S39-1 shape still does not land. The budget is spent
  // in priority order, so the ROOT renders whole and the starve falls on the
  // tail. A run where the first type is a marker-only stub while a later type
  // renders in full is the attack, and it is what this pins against.
  const shapeOf = (n) => {
    const i = lean.text.indexOf(`Data shape of \`${n}\``);
    return i < 0 ? "" : lean.text.slice(i, lean.text.indexOf(`Members of \`${n}\``, i));
  };
  const fieldsIn = (n) => (shapeOf(n).match(/\tField/g) || []).length;
  assert.equal(
    fieldsIn(names[0]),
    30,
    `the highest-priority type's def must survive whole - a gutted root beside fully rendered later types IS the ` +
      `S39-1 attack.\nPROMPT:\n${lean.text}`,
  );
  assert.equal(
    starved[starved.length - 1],
    names[names.length - 1],
    `the starve falls on the tail, in priority order, not at random.\nrendered=${rendered.join(",")} starved=${starved.join(",")}`,
  );
});

// ===========================================================================
// L. THE LOWERCASE LOCAL-LEG RECOVERY.
// ===========================================================================

btest("L1: a lowercase (unexported) doc-named type declared in-file is recovered by the local leg END TO END in the shipped path", async () => {
  const uri = "file:///work/adv42p2/lower.go";
  const src = [
    "package app",
    "",
    "type parser struct {",
    "\tBuf []byte",
    "}",
    "",
    "type Widget struct {",
    "\tN int",
    "}",
    "",
    "// Decide implements the committed behaviour.",
    "// It works with `parser` and `Widget`.",
    "func Decide() int {",
    "\treturn 0",
    "}",
    "",
  ].join("\n");
  const defTypes = {
    parser: { uri, declRe: /^type parser struct/, hover: "type parser struct {\n\tBuf []byte\n}", members: [{ name: "next", kind: "method", signature: "next() byte" }] },
    Widget: { uri, declRe: /^type Widget struct/, hover: "type Widget struct {\n\tN int\n}", members: [{ name: "Do", kind: "method", signature: "Do() Widget" }] },
  };
  const record = {
    span: { start: src.indexOf("func Decide"), end: src.length - 2 },
    signature: "func Decide() int",
    docComment: "// Decide implements the committed behaviour.\n// It works with `parser` and `Widget`.",
    symbolName: "Decide",
    languageId: "go",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "\t",
  };
  const r = await runWith(mod.resolvePrefill, { uri, src, defTypes, record });
  assert.ok(
    r.disclosed.includes("parser"),
    `the 359 funnel recoveries lean on the local leg re-admitting lowercase spellings; ` +
      `\`parser\` did not disclose in the shipped path (got: ${r.disclosed.join(", ")}).\nLOGS:\n${r.logs.join("\n")}`,
  );
  assert.ok(r.disclosed.includes("Widget"), `the exported control discloses (got: ${r.disclosed.join(", ")})`);
});
