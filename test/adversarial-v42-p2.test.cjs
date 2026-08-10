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
    `export { resolvePrefill, prefillLangFor, injectedTypeCap } from "../src/vscode/fnGen";\n`,
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
function goFixture(names, { fat = false } = {}) {
  const uri = "file:///work/adv42p2/main.go";
  const fields = (n) =>
    fat
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

async function runWith(resolvePrefill, fx, cfg) {
  const files = { [fx.uri]: fx.src };
  const logs = [];
  const disclosed = [];
  globalThis.__ADV42P2_FILES__ = files;
  if (cfg) globalThis.__ADV42P2_CFG__ = cfg;
  let text;
  try {
    text = (await resolvePrefill(makeExtractor(files, fx.defTypes), makeDoc(fx.src, fx.uri), fx.record, (l) => logs.push(String(l)), {
      onDisclosed: (d) => disclosed.push(...d.map((x) => x.name)),
    })) || "";
  } finally {
    delete globalThis.__ADV42P2_FILES__;
    delete globalThis.__ADV42P2_CFG__;
  }
  return { text, logs, disclosed };
}

const TEN = ["Alpha", "Bravo", "Chart", "Delta", "Echos", "Foxes", "Golfs", "Hotel", "India", "Julie"];

// ===========================================================================
// S. SEAM PINS the blind file does not carry.
// ===========================================================================

btest("S1: the seam's exact values - go 8, rust/ts/csharp/python 4, and go's typeCap never exceeds its resolveCap", () => {
  const { prefillLangFor, injectedTypeCap } = mod;
  const caps = {};
  for (const id of ["go", "rust", "typescript", "csharp", "python"]) {
    const lang = prefillLangFor(id);
    caps[id] = { typeCap: lang.typeCap, resolveCap: lang.resolveCap, auto: injectedTypeCap(lang) };
  }
  assert.equal(caps.go.typeCap, 8, "the measured Go cap");
  for (const id of ["rust", "typescript", "csharp", "python"]) {
    assert.equal(caps[id].typeCap, 4, `${id} stays at the inherited 4 - no cross-language bleed`);
    assert.equal(caps[id].auto, 4, `${id} auto reads the typeCap`);
  }
  assert.equal(caps.go.auto, 8, "go auto reads the measured cap");
  // The coupling the ladder leaned on: a type cap above the resolve cap
  // promises slots that can never fill (the report's own clamp doctrine). The
  // blind file does not pin this; a future resolveCap change re-opens the
  // knee argument silently. Pinned HERE.
  assert.ok(
    caps.go.typeCap <= caps.go.resolveCap,
    `GO typeCap (${caps.go.typeCap}) > resolveCap (${caps.go.resolveCap}): slots promised that cannot fill; the ladder's knee argument is void`,
  );
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

btest("S3: config interactions - minimal halves Go to 4; generous stays clamped at the resolve cap (8)", async () => {
  const fxMin = goFixture(["Alpha", "Bravo", "Chart", "Delta", "Echos", "Foxes"]);
  const rMin = await runWith(mod.resolvePrefill, fxMin, { injectedSurface: "minimal" });
  assert.equal(
    rMin.disclosed.length,
    4,
    `minimal = max(1, round(8/2)) = 4 (got ${rMin.disclosed.length}: ${rMin.disclosed.join(", ")})`,
  );
  const fxGen = goFixture(TEN);
  const rGen = await runWith(mod.resolvePrefill, fxGen, { injectedSurface: "generous" });
  assert.equal(
    rGen.disclosed.length,
    8,
    `generous = min(8*3, resolveCap 8) = 8, the honest clamp (got ${rGen.disclosed.length})`,
  );
});

// ===========================================================================
// R. THE RIG's cap-arm mechanism vs the new seam.
// ===========================================================================

btest("R1: the cap-arm patch (lib-core loadPrefillCap's exact regex) must still move GO's cap - a cap-6 arm may not silently measure 8", async () => {
  // session-complxity-research/spikes/lib-core.cjs:115-120 patches the bundle
  // with /var PREFILL_TYPE_CAP = 4;/ -> `var PREFILL_TYPE_CAP = ${cap};` and
  // throws when the pattern is missing so an arm can never "silently run at
  // the shipped value". After phase 2, Go reads GO_PREFILL_TYPE_CAP: the
  // pattern still MATCHES (the four-language default is still 4), the guard
  // stays quiet, and the patch no longer reaches Go. This row applies the
  // identical patch to this file's own bundle and runs a Go cap-6 arm: eight
  // perfect candidates must disclose 6. Today they disclose 8 - the exact
  // silent-shipped-value failure the guard exists to prevent.
  const src = fs.readFileSync(OUTFILE, "utf8");
  const re = /var PREFILL_TYPE_CAP = 4;/;
  assert.ok(re.test(src), "precondition: the rig's guard pattern still matches the bundle");
  fs.writeFileSync(PATCHED, src.replace(re, "var PREFILL_TYPE_CAP = 6;"));
  const patched = require(PATCHED);
  const fx = goFixture(["Alpha", "Bravo", "Chart", "Delta", "Echos", "Foxes", "Golfs", "Hotel"]);
  const r = await runWith(patched.resolvePrefill, fx);
  assert.equal(
    r.disclosed.length,
    6,
    `a cap-6 arm on Go disclosed ${r.disclosed.length} types: GO_PREFILL_TYPE_CAP is out of the ` +
      `patch's reach and the arm silently measured the shipped 8. The rig's own guard cannot fire ` +
      `because the four-language default still matches its pattern.`,
  );
});

// ===========================================================================
// B. THE BYTES CLAIM under the shared data-shape budget.
// ===========================================================================

btest("B1: RULING - the S39-1 starvation shape is UNREACHABLE for Go prefill: no data-shape block exists to starve, and eight fat types render eight member blocks", async () => {
  // The attack was: 8 types share DATASHAPE_TOTAL_TOK and the root's def gets
  // gutted to a marker-only stub. It cannot land: goShapeBlock (fnGen.ts
  // ~3543) renders MEMBER SIGNATURES ONLY and never reads a def - the field
  // walk is documented dark for Go, and 0 of the 907 shipped funnel rows
  // carry a data-shape line. The near-free-bytes claim therefore holds, but
  // its mechanism is the member-list-only render plus per-type MEMBER_CAP
  // truncation, not the shared data-shape budget the report's phrasing
  // gestures at.
  const names = ["Alpha", "Bravo", "Chart", "Delta", "Echos", "Foxes", "Golfs", "Hotel"];
  const fx = goFixture(names, { fat: true });
  const r = await runWith(mod.resolvePrefill, fx);
  assert.equal(r.disclosed.length, 8, `all eight disclose (got ${r.disclosed.length})`);
  for (const n of names) {
    assert.ok(
      r.text.includes(`Members of \`${n}\``),
      `every disclosed type carries its member block.\nPROMPT:\n${r.text}`,
    );
  }
  assert.ok(
    !/Data shape of/.test(r.text),
    `a data-shape block appeared for Go prefill - the dark-leg premise of this ruling no longer holds; re-review the starvation angle.\nPROMPT:\n${r.text}`,
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
