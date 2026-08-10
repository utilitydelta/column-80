// Implementer tests for session-v31 phase 3: the TypeScript leg
// (src/core/tddTs.ts), written alongside the implementation and sitting under
// the blind oracle blind-v31-ts.
//
// What these pin that the contract alone does not:
//   - the INVERTED BLANK, first and hardest. vitest's expected value is the
//     argument of the matcher that ENDS the expect chain, not a positional
//     argument of the call being scanned. Point Rust's locator at
//     `expect(widen(3)).toBe(7)` and it blanks `widen(3)` — the call under test
//     — and keeps the model's guessed 7. Every row in section 5 exists because
//     of that one failure mode;
//   - the TWO-WAY COLLISION in the parse: a filter miss and an unresolvable
//     import both report zero passed and zero failed, and only numPendingTests
//     and success tell them apart;
//   - the third no-run outcome the contract said did not exist: a generated test
//     with a SYNTAX error fails to transform, which is a build error arriving in
//     exactly the import failure's shape (measured, see section 8);
//   - the depth-counted parameter list, which a `):`-regex gets wrong on a
//     function-typed parameter, an object-type parameter and a generic
//     constraint;
//   - the import EXTENSION, which is right for bundler and wrong for nodenext,
//     and which must say so when nothing determines it;
//   - Rust's and Go's locators do not move, because this phase widened the
//     shared literal scanner they both read through.
//
// Run: SKIP_LIVE=1 node --test test/impl-v31-ts.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v31-ts",
  `export { tddLangFor, frameworkFor } from "../src/core/tddLang";\n` +
    `export { tsReturnTypeOf, classifyTsTestability, tsRenderBlankValue, tsExpectedValueSpans, parseVitestJson, parseJestJson, importExtensionRule, VITEST_IMPORT, JEST_IMPORT } from "../src/core/tddTs";\n` +
    `export { tsSignatureFromSpanText } from "../src/core/tsExtraction";\n` +
    `export { goExpectedValueSpans, goReturnTypeOf } from "../src/core/tddGo";\n` +
    `export { runFrameworkTestsAt } from "../src/core/compilerOracle";\n` +
    `export { rustExpectedValueSpans, skipLiteralOrComment, matchDelim, topLevelArgs, blankTestModule } from "../src/core/testAssembly";\n`
);
const {
  tddLangFor,
  frameworkFor,
  tsReturnTypeOf,
  classifyTsTestability,
  tsRenderBlankValue,
  tsExpectedValueSpans,
  parseVitestJson,
  parseJestJson,
  importExtensionRule,
  VITEST_IMPORT,
  JEST_IMPORT,
  tsSignatureFromSpanText,
  goExpectedValueSpans,
  goReturnTypeOf,
  runFrameworkTestsAt,
  rustExpectedValueSpans,
  skipLiteralOrComment,
  matchDelim,
  topLevelArgs,
  blankTestModule,
} = mod;

const REPO = path.resolve(__dirname, "..");
const CORPUS = path.join(os.homedir(), "work", "utilitydelta", "react-mobx-mvvm");
const CORPUS_TS = path.join(CORPUS, "node_modules", "typescript");
const corpusTs = fs.existsSync(CORPUS_TS) ? require(CORPUS_TS) : undefined;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v31-ts-"));
test.after(() => {
  cleanup();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const ts = () => tddLangFor("typescript");
const vitest = () => ts().frameworks[0];
const jest = () => ts().frameworks[1];

// A project at /p holding /p/package.json, an installed vitest, and /p/src/foo.ts.
const PROJECT_FILES = ["/p/package.json", "/p/node_modules/.bin/vitest", "/p/src/foo.ts"];
const PKG_VITEST = JSON.stringify({ devDependencies: { vitest: "^4.1.7" }, scripts: { test: "vitest run" } });

function deps(files, contents = {}, log) {
  const set = new Set(files.map((f) => path.normalize(f)));
  return {
    fileExists: (p) => set.has(path.normalize(p)),
    readFile: (p) => contents[path.normalize(p)],
    log,
  };
}

const projectDeps = (extraFiles = [], extraContents = {}, log) =>
  deps([...PROJECT_FILES, ...extraFiles], { "/p/package.json": PKG_VITEST, ...extraContents }, log);

const spans = (text) => tsExpectedValueSpans(text).map((s) => text.slice(s.start, s.end));

// ===========================================================================
// 1. The registry
// ===========================================================================

test("all four TypeScript/JavaScript languageIds resolve, and nothing else moved", () => {
  for (const id of ["typescript", "typescriptreact", "javascript", "javascriptreact"]) {
    const lang = tddLangFor(id);
    assert.ok(lang, `${id} must resolve`);
    assert.equal(lang.languageId, id);
    assert.equal(lang.markerPrefix, "//");
    assert.deepEqual(
      lang.frameworks.map((f) => f.id),
      ["vitest", "jest"],
      "vitest before jest, the contract's precedence",
    );
  }
  assert.equal(tddLangFor("typescript").displayName, "TypeScript");
  assert.equal(tddLangFor("javascript").displayName, "JavaScript");
  // Phase 4 registered python and phase 5 registered csharp, so the whole set
  // the goal names now resolves. This row asserted `csharp === undefined` until
  // phase 5 and flipped when that leg landed, which is the flip it was written
  // to make.
  assert.equal(tddLangFor("python").languageId, "python");
  assert.equal(tddLangFor("csharp").languageId, "csharp");
  assert.equal(tddLangFor("rust").languageId, "rust");
  assert.equal(tddLangFor("go").languageId, "go");
});

test("no testNameIsValid: vitest runs whatever `it` declares", () => {
  assert.equal(ts().testNameIsValid, undefined);
});

// ===========================================================================
// 2. returnTypeOf
// ===========================================================================

test("returnTypeOf reads the contract's seven rows", () => {
  assert.equal(tsReturnTypeOf("function f(a: number): number {"), "number");
  assert.equal(tsReturnTypeOf("export const g = (a: number): string =>"), "string");
  assert.equal(tsReturnTypeOf("function h(a: number)"), undefined);
  assert.equal(tsReturnTypeOf("async function i(): Promise<number>"), "Promise<number>");
  assert.equal(tsReturnTypeOf("function j(cb: (x: number) => number): string"), "string");
  assert.equal(tsReturnTypeOf("method(a: number): boolean {"), "boolean");
  assert.equal(tsReturnTypeOf("function k(a: {x: number}): number"), "number");
});

test("returnTypeOf depth-counts rather than finding the first `)` or `:`", () => {
  // The three shapes a naive regex inverts: a function-typed parameter carries
  // `=>` and a colon, an object-type parameter carries a colon and braces, and a
  // generic constraint carries a whole parameter list of its own.
  assert.equal(tsReturnTypeOf("function gen<T extends (x: number) => void>(a: T): string {"), "string");
  assert.equal(tsReturnTypeOf("export function token<T>(name: string): Token<T>"), "Token<T>");
  assert.equal(tsReturnTypeOf("function deep(a: { b: { c: number } }, d: string): boolean {"), "boolean");
  assert.equal(tsReturnTypeOf("function label(a: string = 'x: y'): number {"), "number");
});

test("returnTypeOf keeps a braced return type and a function-typed return whole", () => {
  assert.equal(tsReturnTypeOf("function o(): { count: number } {"), "{ count: number }");
  assert.equal(tsReturnTypeOf("export function makeAdder(n: number): (x: number) => number {"), "(x: number) => number");
  assert.equal(tsReturnTypeOf("function u(): 'a' | 'b' {"), "'a' | 'b'");
  assert.equal(tsReturnTypeOf("function arr(): Array<{ id: string }> {"), "Array<{ id: string }>");
});

test("returnTypeOf answers undefined for a unit return, the supersession-S1 precedent", () => {
  // Rust's `-> ()` used to yield the string "()", passed the "returns no value
  // to assert" gate, and got the human a tabstop hole for a unit value. The
  // human ruled the documented behaviour correct; `void` is the same value.
  assert.equal(tsReturnTypeOf("function v(): void {"), undefined);
  assert.equal(tsReturnTypeOf("const noop = () => {}"), undefined);
  assert.equal(tsReturnTypeOf(""), undefined);
  assert.equal(tsReturnTypeOf("not a signature at all"), undefined);
});

// ===========================================================================
// 3. Testability
// ===========================================================================

const DOC = "/** Widen a number. */";

test("classify: the precedence is fixed and first-match-wins", () => {
  assert.equal(classifyTsTestability("export async function load(): Promise<number> {", DOC).reason, "async");
  assert.equal(classifyTsTestability("export const load = async (a: number): Promise<number> =>", DOC).reason, "async");
  assert.equal(classifyTsTestability("export function later(): Promise<Widget> {", DOC).reason, "async");
  assert.equal(classifyTsTestability("export function read(p: string): fs.Stats {", DOC).reason, "io");
  assert.equal(classifyTsTestability("export function get(url: string): ReturnType<typeof fetch> {", DOC).reason, "io");
  // A type spelled through a module specifier is the same world, reached a
  // different way: `import("http").Server`, `import("node:fs").Stats`.
  assert.equal(classifyTsTestability('export function serve(s: import("http").Server): string', DOC).reason, "io");
  assert.equal(classifyTsTestability("export function stat(s: import('node:fs').Stats): string", DOC).reason, "io");
  assert.equal(classifyTsTestability("  counterValue(name: string): number {", DOC).reason, "needs-fixture");
  assert.equal(classifyTsTestability("export function scale(this: Widget, n: number): number {", DOC).reason, "needs-fixture");
  assert.equal(classifyTsTestability("function escapeValue(value: string): string {", DOC).reason, "not-exported");
  assert.equal(classifyTsTestability("export function widen(n: number): number {", undefined).reason, "underspecified");
  assert.equal(classifyTsTestability("export function widen(n: number): void {", DOC).reason, "underspecified");
  assert.equal(classifyTsTestability("export function widen(n) {", DOC).reason, "underspecified");
  assert.deepEqual(classifyTsTestability("export function widen(n: number): number {", DOC), { testable: true });
});

test("classify: Promise<void> is `async`, not `underspecified` (Amendment 3)", () => {
  // goal.md item 3 listed it under both. Precedence stands: the reported reason
  // must be predictable, and it is the first and most fundamental blocker.
  const v = classifyTsTestability("export async function save(w: Widget): Promise<void> {", DOC);
  assert.equal(v.testable, false);
  assert.equal(v.reason, "async");
  // Plain void and an absent annotation are unaffected.
  assert.equal(classifyTsTestability("export function save(w: Widget): void {", DOC).reason, "underspecified");
});

test("classify: needs-fixture is the METHOD FORM, because a body is never in scope (Amendment 4)", () => {
  // The classifier receives a signature and a doc comment. Whether a method
  // touches `this` is a fact about a body it never sees, so the form is the
  // tell — and the over-refusal is the stated, honest direction.
  for (const sig of [
    "  now(): number {",
    "  private helper(a: string): string {",
    "  static build(a: string): Widget {",
    "  get value(): number {",
    "  ['computed'](a: number): number {",
    "  wrap<T>(a: T): T {",
  ]) {
    assert.equal(classifyTsTestability(sig, DOC).reason, "needs-fixture", sig);
  }
  // Precedence still outranks the form: an async method reports `async`, which
  // is the first and most fundamental blocker.
  assert.equal(classifyTsTestability("  async load(): Promise<Widget> {", DOC).reason, "async");
  // And what must NOT read as a method: the three declaration forms.
  assert.notEqual(classifyTsTestability("function f(a: number): number {", DOC).reason, "needs-fixture");
  assert.notEqual(classifyTsTestability("export function f(a: number): number {", DOC).reason, "needs-fixture");
  assert.notEqual(classifyTsTestability("export const g = (a: number): number =>", DOC).reason, "needs-fixture");
  assert.notEqual(classifyTsTestability("const g = (a: number): number =>", DOC).reason, "needs-fixture");
});

test("classify: not-exported names the fix, and fires only where the import cannot reach", () => {
  const v = classifyTsTestability("function escapeValue(value: string): string {", DOC);
  assert.equal(v.reason, "not-exported");
  assert.match(v.detail, /export/, "the detail must name the fix");
  assert.equal(classifyTsTestability("export default function main(a: string): string {", DOC).testable, true);
  // The reason Rust and Go never need it: their tests reach private names. Pin
  // that those legs still cannot produce it.
  assert.notEqual(tddLangFor("rust").classifyTestability("fn escape(v: &str) -> String", DOC).reason, "not-exported");
  assert.notEqual(tddLangFor("go").classifyTestability("func escape(v string) string", DOC).reason, "not-exported");
});

test("classify is pure and never throws", () => {
  for (const sig of [undefined, "", "((((", "export function f(", "`${", "'"]) {
    assert.doesNotThrow(() => classifyTsTestability(sig, DOC));
  }
});

// ===========================================================================
// 4. Blank values (Amendment 2)
// ===========================================================================

test("blank value: a SCALAR is a bare hole, everything else is hinted", () => {
  for (const t of ["number", "string", "boolean", "bigint"]) {
    assert.deepEqual(tsRenderBlankValue(t), { rhs: "${1}", holes: 1 }, t);
  }
  assert.deepEqual(tsRenderBlankValue("Widget"), { rhs: "${1:/* Widget */}", holes: 1 });
  assert.deepEqual(tsRenderBlankValue("Record<string, number>"), { rhs: "${1:/* Record<string, number> */}", holes: 1 });
  assert.deepEqual(tsRenderBlankValue("Map<string, number>"), { rhs: "${1:/* Map<string, number> */}", holes: 1 });
  assert.deepEqual(tsRenderBlankValue("Set<number>"), { rhs: "${1:/* Set<number> */}", holes: 1 });
});

test("blank value: an array scaffolds the brackets and hints the ELEMENT type", () => {
  assert.deepEqual(tsRenderBlankValue("number[]"), { rhs: "[${1:/* number */}]", holes: 1 });
  assert.deepEqual(tsRenderBlankValue("Array<string>"), { rhs: "[${1:/* string */}]", holes: 1 });
  assert.deepEqual(tsRenderBlankValue("readonly string[]"), { rhs: "[${1:/* string */}]", holes: 1 });
  assert.deepEqual(tsRenderBlankValue("Widget[]"), { rhs: "[${1:/* Widget */}]", holes: 1 });
});

test("blank value: an inline object type scaffolds its KEYS, one hole each", () => {
  assert.deepEqual(tsRenderBlankValue("{a: number, b: string}"), { rhs: "{ a: ${1}, b: ${2} }", holes: 2 });
  assert.deepEqual(tsRenderBlankValue("{ a: number; b: Widget }"), { rhs: "{ a: ${1}, b: ${2:/* Widget */} }", holes: 2 });
  assert.deepEqual(tsRenderBlankValue("{ a?: number }"), { rhs: "{ a: ${1} }", holes: 1 });
});

test("blank value: a UNION is one hole, because the variant IS the answer", () => {
  assert.deepEqual(tsRenderBlankValue("number | undefined"), { rhs: "${1:/* number | undefined */}", holes: 1 });
  assert.deepEqual(tsRenderBlankValue("'a' | 'b'"), { rhs: "${1:/* 'a' | 'b' */}", holes: 1 });
  // The container check must not win over the union check.
  assert.deepEqual(tsRenderBlankValue("string[] | undefined"), { rhs: "${1:/* string[] | undefined */}", holes: 1 });
});

test("blank value: holes number from startHole, and snippet metacharacters are escaped", () => {
  assert.deepEqual(tsRenderBlankValue("number", { startHole: 4 }), { rhs: "${4}", holes: 1 });
  assert.deepEqual(tsRenderBlankValue("{a: number, b: number}", { startHole: 3 }), { rhs: "{ a: ${3}, b: ${4} }", holes: 2 });
  // A `}` inside a hint would close the placeholder early and corrupt the
  // snippet the human sees.
  assert.equal(tsRenderBlankValue("Record<string, {a: number}>").rhs.includes("\\}"), true);
});

// ===========================================================================
// 5. The expected-value locator. Safety-critical.
// ===========================================================================

test("locator: the span is the matcher's argument, NEVER the call under test", () => {
  const text = "expect(widen(3)).toBe(7);";
  assert.deepEqual(spans(text), ["7"]);
  // The inversion, stated as the thing that must not happen: Rust's locator
  // blanks the FIRST call's second argument, which here is the call under test.
  const rust = rustExpectedValueSpans(text.replace("expect", "assert_eq!"));
  assert.equal(rust.length, 0, "the Rust locator has nothing to say about vitest text");
});

test("locator: `not` is a chain link, and the terminator past it still wins", () => {
  assert.deepEqual(spans("expect(a).not.toBe(b);"), ["b"]);
  assert.deepEqual(spans("await expect(p).resolves.toBe(9);"), ["9"]);
  assert.deepEqual(spans("expect(f())\n  // why\n  .not\n  .toStrictEqual([1, 2]);"), ["[1, 2]"]);
});

test("locator: a zero-argument matcher blanks NOTHING", () => {
  for (const t of ["expect(x).toBeTruthy();", "expect(x).toBeNull();", "expect(x).toBeUndefined();", "expect(f).toThrow();"]) {
    assert.deepEqual(spans(t), [], t);
  }
});

test("locator: toBeCloseTo blanks the value and leaves the precision", () => {
  assert.deepEqual(spans("expect(v).toBeCloseTo(3.14, 2);"), ["3.14"]);
  assert.deepEqual(spans("expect(list).toHaveLength(3);\nexpect(list).toContain('a');"), ["3", "'a'"]);
});

test("locator: an `expect` inside a literal or a comment is never matched", () => {
  assert.deepEqual(spans("// expect(nope).toBe(1);\nexpect(yes).toBe(2);"), ["2"]);
  assert.deepEqual(spans("/* expect(nope).toBe(1); */ expect(yes).toBe(2);"), ["2"]);
  assert.deepEqual(spans("const s = 'expect(nope).toBe(1)';\nexpect(yes).toBe(2);"), ["2"]);
  assert.deepEqual(spans('const s = "expect(nope).toBe(1)";\nexpect(yes).toBe(2);'), ["2"]);
  // The template literal, including an interpolation holding an expression with
  // its own braces, quotes and backticks.
  assert.deepEqual(spans("const s = `expect(${a ? `${b}` : '}'}).toBe(1)`;\nexpect(yes).toBe(2);"), ["2"]);
  assert.deepEqual(spans("expect(s).toBe('a) fake, not real');"), ["'a) fake, not real'"]);
  assert.deepEqual(spans("expect(t).toBe(`a${x}b`);"), ["`a${x}b`"]);
});

test("locator: a nested expect inside the argument produces ONE span, not an overlapping pair", () => {
  const text = "expect(outer(1)).toEqual(inner(expect(1).toBe(2)));";
  const s = tsExpectedValueSpans(text);
  assert.equal(s.length, 1);
  assert.equal(text.slice(s[0].start, s[0].end), "inner(expect(1).toBe(2))");
});

test("locator: spans come back ascending and non-overlapping over a whole module", () => {
  const text = [
    "describe('widen', () => {",
    "  it('a', () => { expect(widen(3)).toBe(7); });",
    "  it('b', () => { expect(widen(0)).toEqual({ a: 1 }); });",
    "  it('c', () => { expect(widen(1)).toBeTruthy(); });",
    "});",
  ].join("\n");
  const s = tsExpectedValueSpans(text);
  assert.deepEqual(
    s.map((x) => text.slice(x.start, x.end)),
    ["7", "{ a: 1 }"],
  );
  for (let i = 1; i < s.length; i++) {
    assert.ok(s[i].start >= s[i - 1].end, "ascending and non-overlapping");
  }
});

test("locator: `expect` as a member or a prefix is not the global expect", () => {
  assert.deepEqual(spans("harness.expect(x).toBe(1);"), []);
  assert.deepEqual(spans("expectations(x).toBe(1);"), []);
  assert.deepEqual(spans("myexpect(x).toBe(1);"), []);
});

test("locator is pure and never throws on truncated text", () => {
  for (const t of ["expect(", "expect(x).toBe(", "expect(x).", "`${", "'unterminated", "expect(x).toBe(`a"]) {
    assert.doesNotThrow(() => tsExpectedValueSpans(t), t);
  }
});

// ===========================================================================
// 6. Placement
// ===========================================================================

test("placement: the sibling file, the package root, and the import line", () => {
  const r = ts().placementFor("/p/src/foo.ts", "widen", projectDeps());
  assert.equal(r.ok, true);
  assert.deepEqual(r.placement, {
    targetPath: path.normalize("/p/src/foo.test.ts"),
    exists: false,
    mode: "sibling-file",
    runRoot: path.normalize("/p"),
    importLine: "import { widen } from './foo';",
    frameworkImportLine: VITEST_IMPORT,
  });
  // vitest takes the test FILE path; there is no package argument to get wrong.
  assert.equal(r.placement.packageArg, undefined);
});

test("placement: the extension follows the source, and `exists` is read from disk", () => {
  const d = projectDeps(["/p/src/foo.test.tsx", "/p/src/foo.tsx"]);
  const r = ts().placementFor("/p/src/foo.tsx", "widen", d);
  assert.equal(r.placement.targetPath, path.normalize("/p/src/foo.test.tsx"));
  assert.equal(r.placement.exists, true);
  assert.equal(tddLangFor("javascript").placementFor("/p/src/foo.js", "widen", d).placement.targetPath, path.normalize("/p/src/foo.test.js"));
});

test("placement: no package.json anywhere is a no-project-root refusal that NAMES what is missing", () => {
  const r = ts().placementFor("/nowhere/src/foo.ts", "widen", deps([]));
  assert.equal(r.ok, false);
  assert.equal(r.refusal.reason, "no-project-root");
  assert.match(r.refusal.detail, /package\.json/);
});

test("placement: a file that IS a test file has no sibling to make", () => {
  for (const f of ["/p/src/foo.test.ts", "/p/src/foo.spec.ts", "/p/src/foo.contract.test.ts"]) {
    const r = ts().placementFor(f, "helper", projectDeps([f]));
    assert.equal(r.placement.mode, "same-file", f);
    assert.equal(r.placement.targetPath, path.normalize(f));
    // Nothing to import: a helper in a test file is already in scope.
    assert.equal(r.placement.importLine, undefined);
  }
});

test("placement: a symbol that cannot be spelled as an import is refused, not guessed", () => {
  const r = ts().placementFor("/p/src/foo.ts", "", projectDeps());
  assert.equal(r.ok, false);
  assert.equal(r.refusal.reason, "unresolvable-import");
});

// ---------------------------------------------------------------------------
// The import extension. Extensionless is right for bundler and WRONG for
// nodenext, and this is the thing that breaks silently.
// ---------------------------------------------------------------------------

const tsconfigDeps = (config, extra = {}) =>
  projectDeps(["/p/tsconfig.json", ...Object.keys(extra)], { "/p/tsconfig.json": JSON.stringify(config), ...extra });

test("import extension: bundler, node and classic stay extensionless", () => {
  for (const moduleResolution of ["bundler", "node", "node10", "classic", "Bundler"]) {
    const d = tsconfigDeps({ compilerOptions: { moduleResolution } });
    assert.equal(ts().placementFor("/p/src/foo.ts", "widen", d).placement.importLine, "import { widen } from './foo';", moduleResolution);
    assert.equal(importExtensionRule("/p/src", d).needsExtension, false);
  }
});

test("import extension: node16 and nodenext need the EMITTED extension, from a .ts file", () => {
  for (const moduleResolution of ["node16", "nodenext", "NodeNext"]) {
    const d = tsconfigDeps({ compilerOptions: { moduleResolution } });
    assert.equal(ts().placementFor("/p/src/foo.ts", "widen", d).placement.importLine, "import { widen } from './foo.js';", moduleResolution);
  }
  const d = tsconfigDeps({ compilerOptions: { moduleResolution: "nodenext" } });
  assert.equal(ts().placementFor("/p/src/foo.mts", "widen", d).placement.importLine, "import { widen } from './foo.mjs';");
  assert.equal(ts().placementFor("/p/src/foo.cts", "widen", d).placement.importLine, "import { widen } from './foo.cjs';");
  assert.equal(ts().placementFor("/p/src/foo.tsx", "widen", d).placement.importLine, "import { widen } from './foo.js';");
});

test("import extension: `module` decides when moduleResolution is unset, and `extends` is followed", () => {
  assert.equal(importExtensionRule("/p/src", tsconfigDeps({ compilerOptions: { module: "nodenext" } })).needsExtension, true);
  assert.equal(importExtensionRule("/p/src", tsconfigDeps({ compilerOptions: { module: "esnext" } })).needsExtension, false);
  const chained = tsconfigDeps(
    { extends: "./tsconfig.base.json" },
    { "/p/tsconfig.base.json": JSON.stringify({ compilerOptions: { moduleResolution: "nodenext" } }) },
  );
  const rule = importExtensionRule("/p/src", chained);
  assert.equal(rule.needsExtension, true);
  assert.match(rule.evidence, /tsconfig\.base\.json/, "the evidence names the config that decided it");
});

test("import extension: undetermined prefers extensionless and SAYS SO on the evidence channel", () => {
  const lines = [];
  const d = projectDeps([], {}, (l) => lines.push(l));
  const r = ts().placementFor("/p/src/foo.ts", "widen", d);
  assert.equal(r.placement.importLine, "import { widen } from './foo';");
  const said = lines.find((l) => l.includes("undetermined"));
  assert.ok(said, `the evidence channel must carry it: ${JSON.stringify(lines)}`);
  assert.match(said, /nodenext/i, "and must name what it would be wrong for");
  // A solution-style tsconfig that only carries `references` — which is the
  // REAL corpus shape — determines nothing, and says nothing false.
  const shell = tsconfigDeps({ files: [], references: [{ path: "./tsconfig.app.json" }] });
  assert.equal(importExtensionRule("/p/src", shell).needsExtension, undefined);
  // A tsconfig that is not valid JSON is undetermined, never a throw.
  const broken = projectDeps(["/p/tsconfig.json"], { "/p/tsconfig.json": "{ not json" });
  assert.equal(importExtensionRule("/p/src", broken).needsExtension, undefined);
  // JSONC in the wild: comments and trailing commas parse.
  const jsonc = projectDeps(["/p/tsconfig.json"], {
    "/p/tsconfig.json": '{\n  // the resolution\n  "compilerOptions": { "moduleResolution": "nodenext", },\n}',
  });
  assert.equal(importExtensionRule("/p/src", jsonc).needsExtension, true);
});

// ===========================================================================
// 7. Framework detection and the command
// ===========================================================================

test("framework: a DECLARED dependency is the whole rule, and vitest wins over jest", () => {
  const both = JSON.stringify({ devDependencies: { vitest: "1", jest: "1" } });
  const d = deps(["/p/package.json", "/p/node_modules/.bin/vitest", "/p/node_modules/.bin/jest"], { "/p/package.json": both });
  assert.equal(frameworkFor(ts(), "/p", d).framework.id, "vitest");

  const jestOnly = deps(["/p/package.json", "/p/node_modules/.bin/jest"], {
    "/p/package.json": JSON.stringify({ dependencies: { jest: "^29" } }),
  });
  assert.equal(frameworkFor(ts(), "/p", jestOnly).framework.id, "jest");
});

test("framework: declared but NOT INSTALLED still resolves, and the channel names the real problem", () => {
  // An uninstalled project is not a project that tests with nothing. Answering
  // "no test framework, I looked for vitest and jest" there would name the wrong
  // problem; the missing binary goes on the evidence channel instead.
  const lines = [];
  const notInstalled = deps(["/p/package.json"], { "/p/package.json": PKG_VITEST }, (l) => lines.push(l));
  const r = frameworkFor(ts(), "/p", notInstalled);
  assert.equal(r.ok, true);
  assert.equal(r.framework.id, "vitest");
  const said = lines.find((l) => l.includes(".bin/vitest"));
  assert.ok(said, `the difference must be logged: ${JSON.stringify(lines)}`);
  assert.match(said, /npx/, "and must say the product will not fall back to npx");
});

test("framework: no package.json and no dependency are both an honest refusal naming both", () => {
  for (const d of [deps([]), deps(["/p/package.json"], { "/p/package.json": JSON.stringify({ devDependencies: { mocha: "1" } }) })]) {
    const r = frameworkFor(ts(), "/p", d);
    assert.equal(r.ok, false);
    assert.deepEqual(r.lookedFor, ["vitest", "jest"]);
  }
  // Unparseable package.json: refuse, never throw.
  assert.doesNotThrow(() => frameworkFor(ts(), "/p", deps(["/p/package.json"], { "/p/package.json": "{oops" })));
});

test("framework: a hoisted monorepo bin resolves from an ancestor", () => {
  const d = deps(["/repo/pkg/a/package.json", "/repo/node_modules/.bin/vitest"], { "/repo/pkg/a/package.json": PKG_VITEST });
  assert.equal(frameworkFor(ts(), "/repo/pkg/a", d).framework.id, "vitest");
});

test("command: the local binary, the test FILE, an END-anchored filter, and JSON", () => {
  const placement = ts().placementFor("/p/src/foo.ts", "widen", projectDeps()).placement;
  const cmd = vitest().buildCommand(placement, ["widen(3) is 7", "widen(0) is 4"]);
  assert.equal(cmd.command, path.normalize("/p/node_modules/.bin/vitest"), "the LOCAL binary, never npx");
  assert.deepEqual(cmd.args, [
    "run",
    path.normalize("/p/src/foo.test.ts"),
    "-t",
    "(widen\\(3\\) is 7|widen\\(0\\) is 4)$",
    "--reporter=json",
  ]);
  assert.equal(cmd.cwd, path.normalize("/p"));
  // `^` can never match, because -t matches the describe-joined FULL name.
  assert.equal(cmd.args[3].startsWith("^"), false);
  assert.equal(cmd.args[3].endsWith("$"), true);
});

test("command: a title is DATA and is regex-escaped", () => {
  const placement = ts().placementFor("/p/src/foo.ts", "widen", projectDeps()).placement;
  const cmd = vitest().buildCommand(placement, ["a.b|c(d)[e]*+?^${}"]);
  assert.equal(cmd.args[3], "(a\\.b\\|c\\(d\\)\\[e\\]\\*\\+\\?\\^\\$\\{\\})$");
});

test("command: an empty name list is refused, never turned into a filter that runs everything", () => {
  const placement = ts().placementFor("/p/src/foo.ts", "widen", projectDeps()).placement;
  // `-t "()$"` is an empty alternation and selects EVERY test, so a silent
  // fall-through here would report another function's failures as this one's.
  assert.throws(() => vitest().buildCommand(placement, []), /at least one test name/);
  assert.throws(() => vitest().buildCommand(placement, [""]), /at least one test name/);
  assert.throws(() => jest().buildCommand(placement, []), /at least one test name/);
});

test("command: jest spells its own CLI and keeps the same end-anchored filter", () => {
  const placement = ts().placementFor("/p/src/foo.ts", "widen", projectDeps()).placement;
  const cmd = jest().buildCommand(placement, ["a", "b"]);
  assert.equal(cmd.command, path.normalize("/p/node_modules/.bin/jest"));
  assert.deepEqual(cmd.args, ["--json", "--runTestsByPath", path.normalize("/p/src/foo.test.ts"), "-t", "(a|b)$"]);
});

// ===========================================================================
// 8. The parse. Every fixture below is REAL vitest 4.1.7 output, reduced.
// ===========================================================================

const report = (o) => JSON.stringify(o);

test("parse: a real mixed run fills cases, failures and the three counts", () => {
  const parse = parseVitestJson(
    report({
      numTotalTests: 3,
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 1,
      success: false,
      testResults: [
        {
          status: "failed",
          message: "",
          assertionResults: [
            { title: "a", fullName: "widen a", status: "passed", failureMessages: [] },
            { title: "b", fullName: "widen b", status: "failed", failureMessages: ["AssertionError: expected 5 to be 99"] },
            { title: "c", fullName: "widen c", status: "skipped", failureMessages: [] },
          ],
        },
      ],
    }),
    "",
    1,
  );
  assert.equal(parse.ran, true);
  assert.deepEqual(parse.cases, [
    { name: "a", outcome: "pass" },
    { name: "b", outcome: "fail" },
    { name: "c", outcome: "ignored" },
  ]);
  assert.deepEqual(parse.failures, [{ name: "b", message: "AssertionError: expected 5 to be 99" }]);
  assert.equal(parse.passed, 1);
  assert.equal(parse.failed, 1);
  assert.equal(parse.ignored, 1);
  // vitest enumerates PASSING tests, unlike C#.
  assert.equal(parse.casesComplete, true);
  assert.equal(parse.filterMatchedNothing, undefined);
  assert.equal(parse.environmentError, undefined);
  assert.equal(parse.buildError, undefined);
  // The case name is the TITLE: that is what the marker region declares and what
  // -t filters on.
  assert.equal(parse.cases[0].name, "a");
});

const FILTER_MISS = report({
  numTotalTests: 3,
  numPassedTests: 0,
  numFailedTests: 0,
  numPendingTests: 3,
  success: true,
  testResults: [
    {
      status: "passed",
      message: "",
      assertionResults: [
        { title: "a", status: "skipped", failureMessages: [] },
        { title: "b", status: "skipped", failureMessages: [] },
        { title: "c", status: "skipped", failureMessages: [] },
      ],
    },
  ],
});

const BROKEN_IMPORT = report({
  numTotalTests: 0,
  numPassedTests: 0,
  numFailedTests: 0,
  numPendingTests: 0,
  success: false,
  testResults: [{ status: "failed", message: "Cannot find module './nosuchmodule' imported from /p/src/foo.test.ts", assertionResults: [] }],
});

test("parse: THE COLLISION — a filter miss and a broken import both report 0 passed and 0 failed", () => {
  const miss = parseVitestJson(FILTER_MISS, "", 0);
  const broken = parseVitestJson(BROKEN_IMPORT, "", 1);
  // Identical on the counts a naive reader would use.
  assert.equal(miss.passed + miss.failed, 0);
  assert.equal(broken.passed + broken.failed, 0);
  // And they must not be told apart by the exit code alone either: the
  // discriminator is numPendingTests plus success.
  assert.equal(miss.filterMatchedNothing, true);
  assert.equal(miss.environmentError, undefined);
  assert.equal(broken.filterMatchedNothing, undefined, "a broken import must NEVER read as `your filter matched nothing`");
  assert.match(broken.environmentError, /Cannot find module/);
  assert.equal(broken.buildError, undefined, "an unresolvable import is not a compile error");
});

test("parse: `ran` answers `did the runner produce test results`, and a filter miss DID", () => {
  // Deliberately different from Go, where a filter miss emits no test-tagged
  // events at all. What stops a miss reading green is the executed>0 guard and
  // filterMatchedNothing, never `ran`.
  assert.equal(parseVitestJson(FILTER_MISS, "", 0).ran, true);
  assert.equal(parseVitestJson(BROKEN_IMPORT, "", 1).ran, false);
});

test("parse: a SYNTAX error in the generated test is a buildError, not an environment failure", () => {
  // Measured on vitest 4.1.7: vitest does not TYPE-check, but it does parse, and
  // a transform failure arrives in exactly the broken-import shape. Reporting it
  // as an environment failure would send the human looking at their toolchain
  // for a syntax error in the text the product just wrote.
  const transform = report({
    numTotalTests: 0,
    numPassedTests: 0,
    numFailedTests: 0,
    numPendingTests: 0,
    success: false,
    testResults: [{ status: "failed", message: "Transform failed with 1 error:\n\n\u001b[31m[PARSE_ERROR] \u001b[0mUnexpected token", assertionResults: [] }],
  });
  const parse = parseVitestJson(transform, "", 1);
  assert.match(parse.buildError, /Transform failed/);
  assert.equal(parse.environmentError, undefined);
  // ANSI colour must not reach the human channel.
  assert.equal(parse.buildError.includes("\u001b"), false);
});

test("parse: the LAST JSON document wins, so a banner never takes the rung down", () => {
  const parse = parseVitestJson(`npm warn Unknown project config\nnpm warn something else\n${FILTER_MISS}`, "", 0);
  assert.equal(parse.filterMatchedNothing, true);
  // A pretty-printed document spanning many lines still parses.
  const pretty = JSON.stringify(JSON.parse(FILTER_MISS), null, 2);
  assert.equal(parseVitestJson(`banner\n${pretty}`, "", 0).filterMatchedNothing, true);
});

test("parse: no JSON at all is an ENVIRONMENT error carrying whatever evidence there is", () => {
  const parse = parseVitestJson("", "vitest: command not found", 127);
  assert.equal(parse.ran, false);
  assert.equal(parse.environmentError, "vitest: command not found");
  assert.equal(parse.buildError, undefined);
  assert.equal(parse.passed + parse.failed + parse.ignored, 0);
  assert.match(parseVitestJson("garbage", "", 1).environmentError, /no JSON report/);
});

test("parse is garbage-tolerant and never throws", () => {
  for (const stdout of ["", "{", "{}", "null", "[]", '{"testResults": 7}', '{"testResults":[{"assertionResults":"no"}]}']) {
    assert.doesNotThrow(() => parseVitestJson(stdout, "", 1), stdout);
  }
  assert.deepEqual(parseVitestJson("{}", "", 0).cases, []);
});

// ===========================================================================
// 9. The scaffold
// ===========================================================================

const PLACEMENT = () => ts().placementFor("/p/src/foo.ts", "widen", projectDeps()).placement;
const GENERATED = "describe('widen', () => {\n  it('widen(3) is 7', () => {\n    expect(widen(3)).toBe(7);\n  });\n});";

test("scaffold: a new file carries both imports, the marked region, and nothing else", () => {
  const plan = ts().scaffold({ existingText: "", generatedTests: GENERATED, markerId: "m1", placement: PLACEMENT() });
  assert.equal(plan.mode, "new-module");
  assert.equal(plan.start, 0);
  assert.equal(plan.end, 0);
  assert.equal(
    plan.text,
    `import { describe, expect, it } from 'vitest';\nimport { widen } from './foo';\n\n` +
      `// column80-tests:m1:begin\n${GENERATED}\n// column80-tests:m1:end\n`,
  );
});

test("scaffold: the framework import comes from the framework, and defaults to vitest", () => {
  const jestPlacement = { ...PLACEMENT(), frameworkImportLine: JEST_IMPORT };
  const plan = ts().scaffold({ existingText: "", generatedTests: GENERATED, markerId: "m1", placement: jestPlacement });
  assert.ok(plan.text.startsWith(JEST_IMPORT));
  // A hand-built placement without the field still produces the documented bytes.
  const bare = { targetPath: "/p/src/foo.test.ts", exists: false, mode: "sibling-file", runRoot: "/p", importLine: "import { widen } from './foo';" };
  assert.ok(ts().scaffold({ existingText: "", generatedTests: GENERATED, markerId: "m1", placement: bare }).text.startsWith(VITEST_IMPORT));
});

test("scaffold: regenerating replaces EXACTLY the marked region and touches nothing else", () => {
  const existing =
    `import { describe, expect, it } from 'vitest';\nimport { widen } from './foo';\n\n` +
    `it('a developer test', () => { expect(1).toBe(1); });\n\n` +
    `// column80-tests:m1:begin\nOLD\n// column80-tests:m1:end\n`;
  const plan = ts().scaffold({ existingText: existing, generatedTests: GENERATED, markerId: "m1", placement: PLACEMENT() });
  assert.equal(plan.mode, "replace-generated");
  const after = existing.slice(0, plan.start) + plan.text + existing.slice(plan.end);
  assert.ok(after.includes("a developer test"), "the developer's own test survives");
  assert.ok(!after.includes("OLD"));
  assert.equal(after.split("column80-tests:m1:begin").length, 2, "idempotent: still exactly one region");
});

test("scaffold: an append stays an APPEND when the imports are already there", () => {
  const existing = `import { describe, expect, it } from 'vitest';\nimport { widen } from './foo';\n\nit('mine', () => {});\n`;
  const plan = ts().scaffold({ existingText: existing, generatedTests: GENERATED, markerId: "m2", placement: PLACEMENT() });
  assert.equal(plan.mode, "extend-existing");
  assert.equal(plan.start, existing.length, "narrow: the edit is exactly what it needs to be");
  assert.equal(plan.end, existing.length);
});

test("scaffold: a missing import forces a whole-file span, and it is DETECTABLE without the mode", () => {
  // The Go leg hit this wall too: a TestInsertionPlan is one contiguous
  // replacement, the import goes at the top and the tests at the bottom. Phase 6
  // owns the fix; what this leg owes it is that `extend-existing` over the whole
  // file cannot be confused with a small append by anything reading the plan.
  const existing = `const local = 1;\n\nit('mine', () => { expect(local).toBe(1); });\n`;
  const plan = ts().scaffold({ existingText: existing, generatedTests: GENERATED, markerId: "m3", placement: PLACEMENT() });
  assert.equal(plan.mode, "extend-existing");
  assert.equal(plan.start, 0);
  assert.equal(plan.end, existing.length);
  assert.ok(plan.text.includes(VITEST_IMPORT));
  assert.ok(plan.text.includes("import { widen } from './foo';"));
  assert.ok(plan.text.includes("const local = 1;"), "the developer's file survives");
});

test("scaffold: an existing import is MERGED, never duplicated", () => {
  const existing = `import { it } from 'vitest';\nimport { widen } from './foo';\n\nit('mine', () => {});\n`;
  const plan = ts().scaffold({ existingText: existing, generatedTests: GENERATED, markerId: "m4", placement: PLACEMENT() });
  const after = existing.slice(0, plan.start) + plan.text + existing.slice(plan.end);
  assert.equal(after.match(/from 'vitest'/g).length, 1, "one vitest import, not two");
  assert.equal(after.match(/from '\.\/foo'/g).length, 1);
  assert.match(after, /import \{ it, describe, expect \} from 'vitest';/);
});

test("scaffold: an `import` inside a string or a comment is not an import declaration", () => {
  const existing = `// import { describe, expect, it } from 'vitest';\nconst s = "import { widen } from './foo';";\n`;
  const plan = ts().scaffold({ existingText: existing, generatedTests: GENERATED, markerId: "m5", placement: PLACEMENT() });
  const after = existing.slice(0, plan.start) + plan.text + existing.slice(plan.end);
  assert.equal(after.match(/^import \{ describe/m).length, 1, "the real import was added");
});

test("generatedTestNames reads the `it` TITLE, and a word boundary keeps `submit(` out", () => {
  const file =
    `// column80-tests:m1:begin\n` +
    `describe('widen', () => {\n` +
    `  it('widen(3) is 7', () => { submit('not a test'); });\n` +
    `  it("widen(0) is 4", () => {});\n` +
    "  it(`widen(1) is 5`, () => {});\n" +
    `});\n` +
    `// column80-tests:m1:end\n` +
    `it('outside the region', () => {});\n`;
  assert.deepEqual(ts().generatedTestNames(file, "m1"), ["widen(3) is 7", "widen(0) is 4", "widen(1) is 5"]);
  assert.deepEqual(ts().generatedTestNames(file, "other"), []);
  assert.deepEqual(ts().generatedTestNames("", "m1"), []);
  // An unterminated region yields nothing rather than running to EOF.
  assert.deepEqual(ts().generatedTestNames("// column80-tests:m1:begin\nit('a', () => {});\n", "m1"), []);
});

test("the marker prefix is shared, so scaffold and generatedTestNames cannot drift", () => {
  const plan = ts().scaffold({ existingText: "", generatedTests: GENERATED, markerId: "m6", placement: PLACEMENT() });
  assert.deepEqual(ts().generatedTestNames(plan.text, "m6"), ["widen(3) is 7"]);
});

// ===========================================================================
// 10. The freeze: phase 3 widened the shared literal scanner
// ===========================================================================

test("the shared scanner's Rust default is unchanged by the TypeScript profile", () => {
  // A char literal, a lifetime, nested block comments: Rust's three special
  // cases, read with no profile exactly as before.
  assert.equal(skipLiteralOrComment("'a' rest", 0), 3);
  assert.equal(skipLiteralOrComment("'lifetime", 0), 0, "a lifetime is not a literal");
  assert.equal(skipLiteralOrComment("/* /* nested */ */ rest", 0), 18);
  assert.equal(skipLiteralOrComment("'a' rest", 0, { singleQuoteStrings: true }), 3, "TS reads it as a string of the same length");
  assert.equal(skipLiteralOrComment("/* /* nested */ */", 0, { nestedBlockComments: false }), 15, "Go stops at the first closer");
});

test("Rust's and Go's expected-value locators are byte-identical after the widening", () => {
  const rust = "assert_eq!(widen(3), 7);\nassert_eq!(s, \"a, b\");\n// assert_eq!(x, 1);";
  assert.deepEqual(
    rustExpectedValueSpans(rust).map((s) => rust.slice(s.start, s.end)),
    ["7", '"a, b"'],
  );
  const go = "got := f()\nwant := 7\nwant := `raw \\ string`\n";
  assert.deepEqual(
    goExpectedValueSpans(go).map((s) => go.slice(s.start, s.end)),
    ["7", "`raw \\ string`"],
  );
  // And the shipped Rust blanker still blanks the second macro argument.
  assert.equal(blankTestModule("assert_eq!(widen(3), 7);", "u32").snippet, "assert_eq!(widen(3), ${1});");
});

test("the shared depth scanner and argument splitter serve every profile", () => {
  assert.equal(matchDelim("f(a, (b), c)", 1), 11);
  assert.equal(matchDelim("f(a", 1), -1);
  // Rust's default reads `'` as a char literal; TypeScript's profile reads a
  // string, and the comma inside it must not split an argument either way.
  const ts1 = "f('a, b', c)";
  const parsed = topLevelArgs(ts1, 1, { singleQuoteStrings: true });
  assert.deepEqual(
    parsed.args.map((a) => ts1.slice(a.start, a.end)),
    ["'a, b'", "c"],
  );
});

// ===========================================================================
// 11. Absorbed from the phase-3 adversarial review
//
// Every row below was written by the reviewer against src/core/tddTs.ts and is
// kept here in intent. Two kinds:
//
//   the reviewer's NEGATIVE results — independent checks that already held, the
//   most valuable of which compare the locator against the real TypeScript AST
//   over the corpus and pin Rust and Go byte-identical through the widened
//   shared scanner;
//
//   the reviewer's DEFECTS — each written as the behaviour the contract asks
//   for, so it failed when written and passes now. The comment on each says
//   what was measured.
//
// One review row was deliberately NOT made to pass and is rewritten below (the
// zero-count no-message report); one was deleted by triage and is recorded as
// X2 in session-v31/scraps.md.
// ===========================================================================

const TS_LITERALS = { singleQuoteStrings: true, templateLiteralDelimiter: "`", nestedBlockComments: false, regexLiteral: true };
const GO_LITERALS = { rawStringDelimiter: "`", nestedBlockComments: false };
const ESC = "\u001b";

const spansAscending = (sp, text) =>
  sp.every((s, i) => s.start >= 0 && s.end <= text.length && s.start <= s.end && (i === 0 || sp[i - 1].end <= s.start));

// --- the locator against the real parser ----------------------------------

const VALUE_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual", "toBeCloseTo", "toContain", "toHaveLength"]);

/** Ground truth from the TypeScript compiler: the first argument of every
 *  value-matcher call whose receiver chain roots at `expect(...)`. */
function astExpectedValueSpans(ts, text, tsx) {
  const sf = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const rootsAtExpect = (node) => {
    let e = node;
    for (;;) {
      if (ts.isCallExpression(e)) {
        if (ts.isIdentifier(e.expression) && e.expression.text === "expect") return true;
        e = e.expression;
        continue;
      }
      if (ts.isPropertyAccessExpression(e) || ts.isAwaitExpression(e)) {
        e = e.expression;
        continue;
      }
      return false;
    }
  };
  const visit = (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      VALUE_MATCHERS.has(n.expression.name.text) &&
      n.arguments.length > 0 &&
      rootsAtExpect(n.expression.expression)
    ) {
      out.push({ start: n.arguments[0].getStart(sf, false), end: n.arguments[0].getEnd() });
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

function corpusTestFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) corpusTestFiles(p, out);
    else if (/\.(test|spec)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

test("locator: every expected-value span in the corpus matches the TypeScript AST", { skip: corpusTs === undefined ? "react-mobx-mvvm not present" : false }, () => {
  const files = corpusTestFiles(CORPUS);
  assert.ok(files.length >= 10, `expected the corpus test files, found ${files.length}`);
  let located = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const got = tsExpectedValueSpans(text);
    located += got.length;
    assert.ok(spansAscending(got, text), `spans not ascending in ${f}`);
    assert.deepEqual(got, astExpectedValueSpans(corpusTs, text, f.endsWith("x")), `span set differs from the AST in ${f}`);
  }
  assert.ok(located > 150, `expected the corpus's assertion population, got ${located}`);
});

test("locator: 20000 fuzzed inputs never throw and never produce an out-of-range or overlapping span", () => {
  const toks = ["expect(", ")", ".toBe(", ".not", ".toEqual(", "`", "${", "}", "'", '"', "//", "/*", "*/", "\n", "{", "(", "a", ",", " ", "\\", "[", "]", "expect.soft(", "<", ">", "/", "it(", "toHaveLength("];
  let seed = 4242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 20000; k++) {
    let t = "";
    const len = 2 + Math.floor(rnd() * 26);
    for (let j = 0; j < len; j++) t += toks[Math.floor(rnd() * toks.length)];
    assert.ok(spansAscending(tsExpectedValueSpans(t), t), `bad spans for ${JSON.stringify(t)}`);
  }
});

test("locator: every shape the contract names locates the expected value and not the call under test", () => {
  const rows = [
    ["expect(widen(3)).toBe(7);", "7"],
    ["expect(widen(3)).not.toBe(7);", "7"],
    ["expect(f(1)).resolves.toBe(7);", "7"],
    ["expect(f(1)).rejects.toBe(7);", "7"],
    ["expect(f(1)).not.not.toBe(7);", "7"],
    ["expect(f()).toBeCloseTo(3.14, 2);", "3.14"],
    ["expect(f(1)).toBe(7 as unknown as number);", "7 as unknown as number"],
    ["expect(f(1)).toEqual({\n  a: 1,\n  b: 2,\n});", "{\n  a: 1,\n  b: 2,\n}"],
    ["expect(f())\n  // why\n  .toBe(7);", "7"],
    ['const s = "expect(x).toBe(1)";\nexpect(f()).toBe(2);', "2"],
    ["const s = `x ${a}.toBe( ${b}`;\nexpect(f(1)).toBe(7);", "7"],
    ["expect(f(1)).toBe(expect(g(2)).toBe(3));", "expect(g(2)).toBe(3)"],
    ["expect(getValue(expect(x).toBe(1))).toEqual(9);", "9"],
  ];
  for (const [text, want] of rows) {
    const sp = tsExpectedValueSpans(text);
    assert.ok(spansAscending(sp, text), `not ascending: ${text}`);
    assert.deepEqual(sp.map((s) => text.slice(s.start, s.end)), [want], `wrong span for ${JSON.stringify(text)}`);
  }
});

// --- the three measured locator gaps, all fixed ---------------------------

test("locator: `expect.soft(` is an entry point, not a link the locator walks past", () => {
  // The failure mode this closes is FAIL-OPEN, not a wrong span: the ordinary
  // assertion still produced a hole, so the consumer's zero-hole floor passed
  // and the soft assertion shipped carrying the model's guessed value.
  const text =
    "it('widen doubles', () => { expect(widen(3)).toBe(6); });\n" +
    "it('widen keeps zero', () => { expect.soft(widen(0)).toBe(0); });";
  assert.deepEqual(spans(text), ["6", "0"]);
  assert.ok(spansAscending(tsExpectedValueSpans(text), text));
  // An unknown link is not invented into an entry point.
  assert.deepEqual(spans("expect.unknownEntry(x).toBe(1);"), []);
});

test("locator: an explicit type argument on the matcher does not hide the expected value", () => {
  assert.deepEqual(spans("expect(parse(s)).toEqual<Map<string, number>>(m);"), ["m"]);
  assert.deepEqual(spans("expect(f()).toBe<number>(7);"), ["7"]);
  // A `<` that is a comparison rather than a type-argument list still leaves the
  // chain readable rather than running away with the rest of the file.
  assert.deepEqual(spans("expect(a).toBe(1) < 2;"), ["1"]);
});

test("locator: a regex literal holding a quote no longer swallows every assertion after it", () => {
  // The highest-value fix in the review. `/'/` opened what the scanner read as a
  // single-quoted string, which then ran to the end of the module — so the first
  // assertion was blanked, the zero-hole floor passed, and everything after it
  // shipped with the model's guesses.
  const text =
    "it('a', () => { expect(widen(3)).toBe(6); });\n" +
    "it('b', () => { expect(splitOn(/'/, s)).toEqual(['a']); });\n" +
    "it('c', () => { expect(widen(4)).toBe(8); });";
  assert.deepEqual(spans(text), ["6", "['a']", "8"]);
  // Division is still division: the heuristic reads the previous significant
  // character, and an identifier, `)` or `]` ends an expression.
  assert.deepEqual(spans("expect(a / b).toBe(2);"), ["2"]);
  assert.deepEqual(spans("expect(f(x) / g(y)).toBe(2);"), ["2"]);
  assert.deepEqual(spans("expect(xs[0] / 2).toBe(2);"), ["2"]);
  // A character class holds a `/` of its own, and flags follow the close.
  assert.deepEqual(spans("expect(s.replace(/[a/b]/gi, '')).toBe('x');"), ["'x'"]);
});

// --- the shared scanner: Rust and Go are byte-frozen -----------------------

const RUST_CASES = [
  "assert_eq!(a, 2);",
  'assert_eq!(f("x, y"), 2);',
  "assert_eq!(c, 'a');",
  "assert_eq!(v, vec!['a', 'b']);",
  "let s: &'a str = x; assert_eq!(s, \"a\");",
  "/* /* nested */ assert_eq!(a, 1); */ assert_eq!(b, 2);",
  "// assert_eq!(a, 1);\nassert_eq!(b, 2);",
  'assert_eq!(a, "unterminated',
  "assert_eq!(a, `backtick`);",
  "assert_eq!(a, 'unterminated",
  "assert_ne!(map[&k], Foo { x: 1, y: 2 });",
  "assert_eq!(f(a, b), g(c, d));",
  "assert_eq!(\n  a,\n  2,\n);",
  "assert_eq!(a, 2",
  "assert_eq!(s, \"it's\");",
  "assert_eq!(s, '\\'');",
  'assert_eq!(a, "a\\"b");',
  "assert_eq!(t, (1, 2));",
  "assert_eq!(x, [1, 2, 3]);",
  'assert_eq!(x, "${a}");',
  'assert_eq!(x, r#"raw"#);',
  "assert_eq!(x, 1); // trailing 'quote",
  "fn t() { assert_eq!(a, 2); assert_eq!(b, 3); }",
  "",
  "assert_eq!()",
  "assert_eq!(a)",
  "let c = '\\'' ; assert_eq!(a, 2);",
  "assert_eq!(a / b, 2);",
];

// The last commit before session-v31 opened. The Rust blanker is compared
// against THAT implementation rather than against HEAD, so the row keeps meaning
// something once this session is committed.
const PRE_V31 = "45b4778";
const preV31Exists = (() => {
  try {
    execFileSync("git", ["cat-file", "-e", `${PRE_V31}:src/core/testAssembly.ts`], { cwd: REPO });
    return true;
  } catch {
    return false;
  }
})();

test("freeze: blankTestModule is byte-identical to the pre-v31 implementation, adversarial corpus plus 4000 fuzz", { skip: preV31Exists ? false : `${PRE_V31} is not reachable from this checkout` }, () => {
  const dir = path.join(scratch, "prev31");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ["testAssembly.ts", "tabstop.ts"]) {
    fs.writeFileSync(path.join(dir, f), execFileSync("git", ["show", `${PRE_V31}:src/core/${f}`], { cwd: REPO, maxBuffer: 1 << 26 }));
  }
  fs.writeFileSync(path.join(dir, "entry.ts"), `export { blankTestModule } from "./testAssembly";\n`);
  const outfile = path.join(dir, "bundle.cjs");
  esbuild.buildSync({ entryPoints: [path.join(dir, "entry.ts")], bundle: true, outfile, format: "cjs", platform: "node" });
  const before = require(outfile);

  for (const c of RUST_CASES) {
    for (const rt of ["u32", "Option<u32>", "Vec<String>", "MyStruct"]) {
      assert.deepEqual(blankTestModule(c, rt), before.blankTestModule(c, rt), `Rust drift on ${JSON.stringify(c)} / ${rt}`);
    }
  }

  const toks = ["assert_eq!(", "assert_ne!(", "a", ",", ")", '"', "'", "\\", "/*", "*/", "//", "\n", "`", "{", "}", "(", 'r#"', "#", " ", "$", "${", "/"];
  let seed = 20260727;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 4000; k++) {
    let t = "";
    const len = 3 + Math.floor(rnd() * 20);
    for (let j = 0; j < len; j++) t += toks[Math.floor(rnd() * toks.length)];
    assert.deepEqual(blankTestModule(t, "u32"), before.blankTestModule(t, "u32"), `Rust fuzz drift on ${JSON.stringify(t)}`);
  }
});

test("freeze: the Go leg is byte-identical with all three TypeScript LiteralProfile fields removed from the shared scanner", () => {
  const dir = path.join(scratch, "nots");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, "src", "core"))) {
    fs.copyFileSync(path.join(REPO, "src", "core", f), path.join(dir, f));
  }
  // Undo exactly what phase 3 added to the shared scanner: single-quote strings,
  // the template-literal delimiter and the regex literal. If Go reads one byte
  // differently with them gone, the generalisation was not inert for Go.
  const ta = path.join(dir, "testAssembly.ts");
  let src = fs.readFileSync(ta, "utf8");
  for (const [from, to] of [
    [`if (c === '"' || (c === "'" && profile?.singleQuoteStrings === true)) {`, `if (c === '"') {`],
    ["const tmpl = profile?.templateLiteralDelimiter;", "const tmpl = undefined as string | undefined;"],
    [`if (c === "/" && profile?.regexLiteral === true && regexOpensAt(text, i)) {`, `if (false as boolean) {`],
  ]) {
    assert.ok(src.includes(from), `the phase-3 scanner addition was not found where expected: ${from}`);
    src = src.replace(from, to);
  }
  fs.writeFileSync(ta, src);
  fs.writeFileSync(
    path.join(dir, "entry.ts"),
    `export { goExpectedValueSpans, goReturnTypeOf } from "./tddGo";\nexport { skipLiteralOrComment } from "./testAssembly";\n`,
  );
  const outfile = path.join(dir, "bundle.cjs");
  esbuild.buildSync({ entryPoints: [path.join(dir, "entry.ts")], bundle: true, outfile, format: "cjs", platform: "node" });
  const noTs = require(outfile);

  const goCases = [
    'want := 7\nif got != want { t.Errorf("x") }',
    'want := `raw ` + "s"\nif got != want {}',
    "want := 'a'\nif got != want {}",
    "want := \"it's\"\nif got != want {}",
    "want := `a'b`\nif got != want {}",
    'want := `a"b`\nif got != want {}',
    "want := `a${b}c`\nif got != want {}",
    "/* /* */ want := 1",
    "// want := 1\nwant := 2",
    'want := "unterminated',
    "want := 'unterminated",
    "want := `unterminated",
    "want := struct{ A int }{A: 1}",
    'func (s *Shard) M(a int) string { return "" }',
    "want := map[string]struct{}{}",
    "want := []int{1, 2, 3}",
    "want := 1 // 'quote",
    "want :=\n  7",
    "want := a / b",
    "want := f(x) / 2",
  ];
  for (const c of goCases) {
    assert.deepEqual(goExpectedValueSpans(c), noTs.goExpectedValueSpans(c), `Go span drift on ${JSON.stringify(c)}`);
    assert.deepEqual(goReturnTypeOf(c), noTs.goReturnTypeOf(c), `Go returnTypeOf drift on ${JSON.stringify(c)}`);
    assert.deepEqual(skipLiteralOrComment(c, 0, GO_LITERALS), noTs.skipLiteralOrComment(c, 0, GO_LITERALS), `Go scanner drift on ${JSON.stringify(c)}`);
  }

  const toks = ["want := ", "got != want", "`", '"', "'", "\\", "/*", "*/", "//", "\n", "{", "}", "(", ")", "[", "]", "a", ",", " ", "$", "${", "func ", "if ", "/"];
  let seed = 31337;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 4000; k++) {
    let t = "";
    const len = 3 + Math.floor(rnd() * 24);
    for (let j = 0; j < len; j++) t += toks[Math.floor(rnd() * toks.length)];
    assert.deepEqual(goExpectedValueSpans(t), noTs.goExpectedValueSpans(t), `Go fuzz drift on ${JSON.stringify(t)}`);
    assert.deepEqual(skipLiteralOrComment(t, 0, GO_LITERALS), noTs.skipLiteralOrComment(t, 0, GO_LITERALS), `Go fuzz scanner drift on ${JSON.stringify(t)}`);
  }
});

test("freeze: the template scanner ends in the right place and never runs past the end", () => {
  const rows = [
    ["`a${b ? `${c}` : \"}\"}d`", 23],
    ['`x${ "{" }y`', 12],
    ['`x${ "}" }y`', 12],
    ["`x${ '{' }y`", 12],
    ["`a${`b${`c${d}c`}b`}a`", 22],
    ["`abc${d", 7],
    ["`abc", 4],
    ["`a\\`b`", 6],
    ["`a$b`", 5],
    ["`a${ /* } */ b }c`", 18],
    ["`don't ${a} stop`", 17],
  ];
  for (const [text, want] of rows) {
    const end = skipLiteralOrComment(text, 0, TS_LITERALS);
    assert.ok(end <= text.length, `ran past the end on ${JSON.stringify(text)}`);
    assert.equal(end, want, `wrong end for ${JSON.stringify(text)}`);
  }
});

// --- returnTypeOf ---------------------------------------------------------

test("returnTypeOf survives every shape the review threw at it", () => {
  const rows = [
    ["function f<T = (() => void)>(a: T): number", "number"],
    ["function g({a = {b: 1}}: Opts): string", "string"],
    ["function h(a: number): string;", "string"],
    ["function k(@Inject() a: number): boolean", "boolean"],
    ["const h = x => x", undefined],
    ["function i(): (a: number) => string", "(a: number) => string"],
    ["export function m(\n  a: number,\n  b: string,\n): Promise<number> {", "Promise<number>"],
    ["function j(cb: (x: number) => number): string", "string"],
    ["method(a: number): boolean {", "boolean"],
    ["function k(a: {x: number}): number", "number"],
    ["function f(a: number) /* c */ : number {", "number"],
    ["function f(): { count: number } {", "{ count: number }"],
    ["function f(): void {", undefined],
    ["function f<T extends (x: number) => void>(a: T): T", "T"],
    ["function f(s = ')'): number", "number"],
    ["constructor(a: number)", undefined],
  ];
  for (const [sig, want] of rows) {
    assert.equal(tsReturnTypeOf(sig), want, `wrong return type for ${JSON.stringify(sig)}`);
  }
});

test("returnTypeOf: `never` and `asserts x` are nothing to assert on, and a type predicate is not", () => {
  // The same reasoning supersession S1 ratified for Rust's `-> ()`: a function
  // that only ever throws, and one whose return type is a claim about a
  // PARAMETER, both hand the caller no value. Left as strings they came back
  // TESTABLE and earned a tabstop hole for a value that does not exist.
  const doc = "/** Throws when the condition does not hold. */";
  assert.equal(tsReturnTypeOf("export function invariant(c: unknown, msg: string): asserts c"), undefined);
  assert.equal(tsReturnTypeOf("export function assertNever(x: never): never"), undefined);
  assert.equal(classifyTsTestability("export function invariant(c: unknown, msg: string): asserts c", doc).testable, false);
  assert.equal(classifyTsTestability("export function assertNever(x: never): never", doc).testable, false);
  // A TYPE PREDICATE returns a real boolean and is unaffected.
  assert.equal(tsReturnTypeOf("export function isWidget(x: unknown): x is Widget"), "x is Widget");
  assert.equal(classifyTsTestability("export function isWidget(x: unknown): x is Widget", doc).testable, true);
  // A type merely starting with the word is not the same fact.
  assert.equal(tsReturnTypeOf("export function f(a: number): NeverMind"), "NeverMind");
});

// --- the classifier against the real corpus -------------------------------

/** The corpus's functions under an independent AST extraction, with the
 *  product's own signature derivation. */
function corpusFunctions(ts) {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(CORPUS, "src"));
  const out = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const mk = (node, name) => {
      const start = node.getStart(sf, false);
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const headStart = lineStart + (text.slice(lineStart, start).match(/^\s*/) || [""])[0].length;
      const sig = tsSignatureFromSpanText(text.slice(Math.min(headStart, start), node.getEnd()));
      const before = text.slice(0, lineStart);
      let doc;
      const jsdoc = /\/\*\*[\s\S]*?\*\/\s*$/.exec(before);
      if (jsdoc) doc = jsdoc[0].trim();
      else {
        const lines = before.split("\n");
        const run = [];
        for (let i = lines.length - 2; i >= 0; i--) {
          const l = lines[i].trim();
          if (l.startsWith("//")) run.unshift(l);
          else break;
        }
        if (run.length) doc = run.join("\n");
      }
      return { file: path.relative(CORPUS, f), name, sig, doc };
    };
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) out.push(mk(node, node.name.text));
      else if (ts.isMethodDeclaration(node) && node.name) out.push(mk(node, node.name.getText(sf)));
      else if ((ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.name) out.push(mk(node, node.name.getText(sf)));
      else if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) out.push(mk(node, d.name.getText(sf)));
        }
      } else if (ts.isPropertyDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        out.push(mk(node, node.name.getText(sf)));
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }
  return out;
}

test("classify: the corpus survivor count is 0, and no class member is refused with a fix it cannot apply", { skip: corpusTs === undefined ? "react-mobx-mvvm not present" : false }, () => {
  const fns = corpusFunctions(corpusTs);
  assert.ok(fns.length > 150, `expected the corpus function population, found ${fns.length}`);
  const counts = {};
  const notExported = [];
  for (const f of fns) {
    const v = classifyTsTestability(f.sig, f.doc);
    const key = v.testable ? "testable" : v.reason;
    counts[key] = (counts[key] ?? 0) + 1;
    if (key === "not-exported") notExported.push(f);
  }
  // The human ruled this leg ships refusing everything on this corpus
  // (Amendment 1). The zero is the measured truth, not a bug to relax away.
  assert.equal(counts.testable ?? 0, 0, `survivors: ${JSON.stringify(counts)}`);
  // The visibility leg still fires, and it fires on real module-scope functions.
  assert.ok((counts["not-exported"] ?? 0) > 0, `not-exported never fired: ${JSON.stringify(counts)}`);
  // Amendment 5: no surviving not-exported verdict may be a class member, whose
  // detail would tell the human to `export` a property that cannot be exported.
  // Measured: 13 of the 23 moved to needs-fixture.
  const classFields = notExported.filter((f) => /^\s*(?:(?:public|private|protected|readonly|static|override)\s+)*[A-Za-z_$][\w$]*\s*=\s*(?:async\s+)?[(<]/.test(f.sig));
  assert.deepEqual(classFields.map((f) => `${f.file}:${f.name}`), [], "a class member was told to add `export`");
  assert.ok((counts["needs-fixture"] ?? 0) > (counts["not-exported"] ?? 0), JSON.stringify(counts));
});

test("classify: a class field holding an arrow is needs-fixture, not not-exported (Amendment 5)", () => {
  // 13 of the corpus's 23 not-exported verdicts were this shape — the MobX
  // bound-action idiom. Amendment 4 exempted "an arrow binding" from the method
  // form, so they fell through to the visibility leg and the human was told to
  // add `export` to a class property, which cannot be done.
  for (const sig of [
    "private onKeyDown = (e: KeyboardEvent): void => {",
    "  toggleExpanded = (id: string): void => {",
    "  private readonly dismiss = (id: number): void => {",
    "  select = <T>(x: T): T => {",
    "  handler: (e: Event) => void = (e) => {",
  ]) {
    assert.equal(classifyTsTestability(sig, DOC).reason, "needs-fixture", sig);
  }
  // Precedence still outranks the form.
  assert.equal(classifyTsTestability("  run = async (): Promise<void> => {", DOC).reason, "async");
  const v = classifyTsTestability("private onKeyDown = (e: KeyboardEvent): void => {", DOC);
  assert.doesNotMatch(v.detail, /add `export`/, "the detail must not name a fix a class property cannot take");
  // A TOP-LEVEL arrow is unaffected: the binding keyword is what tells them
  // apart, and the visibility and doc legs still reach it.
  assert.notEqual(classifyTsTestability("export const ok = <T>(v: T): T => v;", DOC).reason, "needs-fixture");
  assert.equal(classifyTsTestability("const escape = (v: string): string => v;", DOC).reason, "not-exported");
  assert.deepEqual(classifyTsTestability("export const ok = <T>(v: T): T => v;", DOC), { testable: true });
});

// --- the no-run outcomes: positive markers, and an honest unclassified -----

const zeroCount = (over) =>
  JSON.stringify({
    numTotalTests: 0,
    numPassedTests: 0,
    numFailedTests: 0,
    numPendingTests: 0,
    success: false,
    testResults: [{ status: "failed", message: "", assertionResults: [] }],
    ...over,
  });
const withMessage = (message, over) => zeroCount({ testResults: [{ status: "failed", message, assertionResults: [] }], ...over });

test("parse: an unresolvable import is an ENVIRONMENT error even when the module is named SyntaxError", () => {
  // Measured live on vitest 4.1.7 against a file importing './SyntaxError':
  //   "Cannot find module './SyntaxError' imported from /…/unit.test.ts"
  // The old discriminator carried `\bSyntaxError\b`, so it fired on the MODULE
  // PATH and told the human to fix a compile error that does not exist. A marker
  // that can match a name the human chose is not a marker.
  const parse = parseVitestJson(withMessage("Cannot find module './SyntaxError' imported from /tmp/x/unit.test.ts"), "", 1);
  assert.equal(parse.buildError, undefined, `buildError set to: ${parse.buildError}`);
  assert.match(parse.environmentError, /Cannot find module/);
});

test("parse: a module that throws while loading is UNCLASSIFIED, not an environment failure", () => {
  // Measured live: `throw new Error('module side effect exploded')` at module
  // scope in the unit under test arrives in the identical zero-count shape, and
  // the message is just the thrown text. environmentError means "the runner
  // could not start" and sends the human to their toolchain; the cause here is
  // an exception in the code under test. Naming no outcome beats naming a false
  // one, and both fields are optional for exactly that.
  const parse = parseVitestJson(withMessage("module side effect exploded"), "", 1);
  assert.equal(parse.environmentError, undefined);
  assert.equal(parse.buildError, undefined);
  assert.equal(parse.filterMatchedNothing, undefined);
});

test("parse: a marked region declaring no test at all is UNCLASSIFIED", () => {
  // Measured live: vitest says "No test found in suite unit.test.ts" and jest
  // says "Your test suite must contain at least one test.", both at exit 1 — and
  // both are the product's own generated region being empty, not the environment
  // failing to start.
  for (const [parseOutput, message] of [
    [parseVitestJson, "No test found in suite /tmp/x/notests.test.ts"],
    [parseJestJson, "● Test suite failed to run\n\n    Your test suite must contain at least one test."],
  ]) {
    const parse = parseOutput(withMessage(message, { numRuntimeErrorTestSuites: 1 }), "", 1);
    assert.equal(parse.environmentError, undefined, message);
    assert.equal(parse.buildError, undefined, message);
  }
});

test("parse: DEFERRED to phase 6 — a zero-count report with no message names no outcome, and runRung falls back", async () => {
  // Rewritten from the review's row, which asserted the PARSE must name one of
  // the three. Under the positive-marker redesign it honestly names none: there
  // is no message to read and no structural tell. What the human then gets is
  // runRung's fallback (`parse.buildError ?? run.stderr`), and vitest's stderr is
  // EMPTY on these failures — so the sentence is "the tests did not compile"
  // with nothing to act on.
  //
  // Phase 6 owns the sentence an unclassified no-run outcome deserves; see
  // session-v31/scraps.md D6. This row pins the CURRENT fallback so the change
  // is deliberate when it comes.
  const parse = parseVitestJson(zeroCount({}), "", 1);
  assert.equal(parse.buildError, undefined);
  assert.equal(parse.environmentError, undefined);
  assert.equal(parse.filterMatchedNothing, undefined);
  const placement = ts().placementFor("/p/src/foo.ts", "widen", projectDeps()).placement;
  const result = await runFrameworkTestsAt(vitest(), placement, ["widen(3) is 7"], {
    runCommand: async () => ({ stdout: zeroCount({}), stderr: "", exitCode: 1 }),
  });
  assert.equal(result.success, false, "an unclassified no-run outcome is never green");
  assert.equal(result.buildError, "", "today the human gets an empty compile error, which is what phase 6 must fix");
});

test("parse: the build markers are PER FRAMEWORK, because neither framework's wording appears in the other's output", () => {
  // Measured on both. vitest frames a syntax error as an esbuild transform
  // failure; jest frames it in its own words. One shared regex meant a jest
  // syntax error matched nothing and was reported as a broken environment.
  const vitestSyntax = `Transform failed with 1 error:\n\n${ESC}[31m[PARSE_ERROR] ${ESC}[0mExpected a semicolon`;
  const jestSyntax = "● Test suite failed to run\n\n    Jest encountered an unexpected token\n\n    Jest failed to parse a file.";
  assert.match(parseVitestJson(withMessage(vitestSyntax), "", 1).buildError, /Transform failed/);
  assert.match(parseJestJson(withMessage(jestSyntax, { numRuntimeErrorTestSuites: 1 }), "", 1).buildError, /unexpected token/);
  // And crossed over, neither claims the other's failure as a compile error.
  assert.equal(parseJestJson(withMessage(vitestSyntax, { numRuntimeErrorTestSuites: 1 }), "", 1).buildError, undefined);
  assert.equal(parseVitestJson(withMessage(jestSyntax), "", 1).buildError, undefined);
  // ANSI never reaches the human channel.
  assert.equal(parseVitestJson(withMessage(vitestSyntax), "", 1).buildError.includes(ESC), false);
});

test("parse: jest's numRuntimeErrorTestSuites is a POSITIVE structural tell, read before any message", () => {
  // Measured on jest 29.7.0: 1 for the unresolvable import, the syntax error,
  // the throwing module and the empty suite. vitest has no such field, which is
  // why it is read from the shape instead.
  const jestImport = parseJestJson(
    withMessage("● Test suite failed to run\n\n    Cannot find module './SyntaxError' from 'unit.test.js'", { numRuntimeErrorTestSuites: 1 }),
    "some jest stderr",
    1,
  );
  assert.match(jestImport.environmentError, /Cannot find module/);
  assert.equal(jestImport.buildError, undefined);
  // Nothing is inferred from stderr being empty or not: vitest leaves it empty
  // on these failures and jest does not (751 and 17943 bytes, measured).
  assert.deepEqual(
    parseJestJson(withMessage("● Test suite failed to run\n\n    Cannot find module './SyntaxError' from 'unit.test.js'", { numRuntimeErrorTestSuites: 1 }), "", 1),
    jestImport,
  );
  // A jest filter miss is not a failed suite and must not be read as one.
  const miss = parseJestJson(FILTER_MISS, "", 0);
  assert.equal(miss.filterMatchedNothing, true);
  assert.equal(miss.environmentError, undefined);
  assert.equal(miss.buildError, undefined);
});

// --- the scaffold's import edits ------------------------------------------

const REVIEW_PLACEMENT = {
  targetPath: "/p/src/Metrics.test.ts",
  exists: true,
  mode: "sibling-file",
  runRoot: "/p",
  importLine: "import { escapeValue } from './Metrics';",
  frameworkImportLine: VITEST_IMPORT,
};
const REVIEW_GEN = "describe('escapeValue', () => {\n  it('escapeValue escapes a quote', () => { expect(escapeValue('a')).toBe('a'); });\n});";

function applyScaffold(existingText) {
  const plan = ts().scaffold({ existingText, generatedTests: REVIEW_GEN, markerId: "escapeValue", placement: REVIEW_PLACEMENT });
  return existingText.slice(0, plan.start) + plan.text + existingText.slice(plan.end);
}

test("scaffold: a value name is never merged into an `import type` declaration", () => {
  // Proven with the corpus's own tsc: the rewritten line gives
  //   TS1484: 'Labels' is a type and must be imported using a type-only import
  //           when 'verbatimModuleSyntax' is enabled.
  // react-mobx-mvvm sets verbatimModuleSyntax, and vitest does not typecheck —
  // so the rung stayed GREEN while the human's own `npm run typecheck` broke on
  // a line this product wrote.
  const out = applyScaffold("import type { Labels } from './Metrics';\n\nconst x: Labels = { a: 'b' };\n");
  assert.match(out, /^import type \{ Labels \} from '\.\/Metrics';$/m, "the type-only import must survive untouched");
  assert.match(out, /^import \{ escapeValue \} from '\.\/Metrics';$/m, "the value import gets its own line");
});

test("scaffold: missing names are computed against every declaration for the module, not the first", () => {
  const out = applyScaffold("import { describe, it } from 'vitest';\nimport { expect } from 'vitest';\n\ndescribe('own', () => {});\n");
  const bindings = [...out.matchAll(/import \{([^}]*)\} from 'vitest'/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
  assert.equal(new Set(bindings).size, bindings.length, `duplicate vitest bindings: ${JSON.stringify(bindings)}`);
  assert.ok(bindings.includes("describe") && bindings.includes("it") && bindings.includes("expect"));
});

// --- framework precedence --------------------------------------------------

test("framework: with both declared, the one actually INSTALLED and named by the test script wins", () => {
  // Both signals that said jest used to be read and then discarded: the test
  // script was logged as a cross-check that changed nothing, and the absent
  // node_modules/.bin/vitest was logged as evidence. The command was then built
  // pointing at a binary that is not there.
  const pkg = JSON.stringify({ devDependencies: { jest: "^30.0.0", vitest: "^4.1.7" }, scripts: { test: "jest" } });
  const d = {
    fileExists: (p) => p.endsWith("package.json") || p.endsWith(`${path.sep}node_modules${path.sep}.bin${path.sep}jest`),
    readFile: (p) => (p.endsWith("package.json") ? pkg : undefined),
  };
  assert.equal(frameworkFor(ts(), "/p", d).framework.id, "jest");
  // Neither installed: the test script breaks the tie.
  const noBins = { fileExists: (p) => p.endsWith("package.json"), readFile: () => pkg };
  assert.equal(frameworkFor(ts(), "/p", noBins).framework.id, "jest");
  // Both installed and no script: declaration order decides, exactly as before.
  const bothPkg = JSON.stringify({ devDependencies: { jest: "^30.0.0", vitest: "^4.1.7" } });
  assert.equal(frameworkFor(ts(), "/p", { fileExists: () => true, readFile: () => bothPkg }).framework.id, "vitest");
  // A script naming a THIRD runner leaves the installed one alone.
  const mochaScript = JSON.stringify({ devDependencies: { jest: "1", vitest: "1" }, scripts: { test: "mocha" } });
  const vitestOnly = {
    fileExists: (p) => p.endsWith("package.json") || p.endsWith(`${path.sep}node_modules${path.sep}.bin${path.sep}vitest`),
    readFile: () => mochaScript,
  };
  assert.equal(frameworkFor(ts(), "/p", vitestOnly).framework.id, "vitest");
});

test("framework: neither declared refuses honest-dark and names both", () => {
  const d = { fileExists: (p) => p.endsWith("package.json"), readFile: () => JSON.stringify({ dependencies: {} }) };
  assert.deepEqual(frameworkFor(ts(), "/p", d), { ok: false, lookedFor: ["vitest", "jest"] });
});

// --- generatedTestNames ----------------------------------------------------

test("generatedTestNames: a declaration spelled inside a string is not a test name", () => {
  const fileText =
    "// column80-tests:widen:begin\n" +
    "describe('widen', () => {\n" +
    "  it('widen doubles', () => { expect(render()).toBe(\"it('phantom')\"); });\n" +
    "});\n" +
    "// column80-tests:widen:end\n";
  assert.deepEqual(ts().generatedTestNames(fileText, "widen"), ["widen doubles"]);
  // A phantom name makes the `-t` filter match nothing, and the human gets a
  // filter miss wearing a false green's clothes.
  const commented =
    "// column80-tests:widen:begin\n" +
    "// it('commented out', () => {});\n" +
    "it('real', () => {});\n" +
    "// column80-tests:widen:end\n";
  assert.deepEqual(ts().generatedTestNames(commented, "widen"), ["real"]);
});

test("generatedTestNames: `test(` declares a test exactly as `it(` does", () => {
  const fileText =
    "// column80-tests:widen:begin\n" +
    "test('widen doubles', () => { expect(widen(3)).toBe(6); });\n" +
    "it('widen keeps zero', () => { expect(widen(0)).toBe(0); });\n" +
    "// column80-tests:widen:end\n";
  assert.deepEqual(ts().generatedTestNames(fileText, "widen"), ["widen doubles", "widen keeps zero"]);
  // A model writing `test(` used to yield no names at all, and the rung then
  // told the human to run Generate Tests first — which is not what happened.
  assert.deepEqual(ts().generatedTestNames("// column80-tests:w:begin\ntest('a', () => {});\n// column80-tests:w:end\n", "w"), ["a"]);
  // A member call named `test` is not a declaration.
  assert.deepEqual(ts().generatedTestNames("// column80-tests:w:begin\nconst m = re.test('a');\n// column80-tests:w:end\n", "w"), []);
});
