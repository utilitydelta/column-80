// Implementer oracle for the per-language local-definition scanners (de-rust
// phase 3 triage do-list): the TS scanner must lex TS (single-quote strings,
// non-nesting block comments, `const enum`), the reference probes must find
// $-adjacent TS names, and the Python neutralizer's proven-solid behaviors get
// pinned so they stay solid. Pure, headless.
//
// Run: SKIP_LIVE=1 node --test test/impl-derust-localsyms.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-derust-localsyms",
  `export { tsFileLocalDefinitions, pyFileLocalDefinitions, fileLocalDefinitionsFor, referencedLocalSymbols, fileLocalDefinitions } from "../src/core/instructPostprocess";\n`
);
const { tsFileLocalDefinitions, pyFileLocalDefinitions, fileLocalDefinitionsFor, referencedLocalSymbols, fileLocalDefinitions } = mod;
test.after(cleanup);

const set = (s) => [...s].sort();

// ---------------------------------------------------------------------------
// TS scanner lexing: the three proven review repros.
// ---------------------------------------------------------------------------

test("tsFileLocalDefinitions: a single-quoted string with an embedded double quote never corrupts the scan", () => {
  const src = [
    `const a = 'say "hi';`,
    `function realFn() {}`,
    `const b = 'done"';`,
    `function other() {}`,
  ].join("\n");
  assert.deepStrictEqual(set(tsFileLocalDefinitions(src)), ["a", "b", "other", "realFn"]);
});

test("tsFileLocalDefinitions: TS block comments do not nest - `/* see /* legacy */` closes at the first `*/`", () => {
  const src = `/* see /* legacy */\nfunction after() {}\n`;
  assert.deepStrictEqual(set(tsFileLocalDefinitions(src)), ["after"]);
});

test("tsFileLocalDefinitions: `export const enum Color` yields Color, never the literal name 'enum'", () => {
  const src = `export const enum Color {\n  Red,\n}\nconst enum Bare {}\n`;
  assert.deepStrictEqual(set(tsFileLocalDefinitions(src)), ["Bare", "Color"]);
});

// The declared prefix/keyword surface, in one table.
test("tsFileLocalDefinitions: column-0 definitions across the declared prefixes and keywords", () => {
  const src = [
    `export function helper(n: number): number { return n; }`,
    `export default class Widget {}`,
    `declare const RATE: number;`,
    `export abstract class Base {}`,
    `async function loader() {}`,
    `interface Order {}`,
    `type Alias = string;`,
    `let counter = 0;`,
    `var legacy = 1;`,
    `enum Direction { Up }`,
    `  function indented() {}`, // nested: never file-level
    `// function commented() {}`,
  ].join("\n");
  assert.deepStrictEqual(set(tsFileLocalDefinitions(src)), [
    "Alias", "Base", "Direction", "Order", "RATE", "Widget", "counter", "helper", "legacy", "loader",
  ]);
});

test("tsFileLocalDefinitions: a template literal spanning lines never leaks its interior as definitions", () => {
  const src = "const tpl = `\nfunction restart() {}\n`;\nfunction real() {}\n";
  assert.deepStrictEqual(set(tsFileLocalDefinitions(src)), ["real", "tpl"]);
});

// ---------------------------------------------------------------------------
// referencedLocalSymbols: $-adjacent TS names, and Rust semantics unchanged.
// ---------------------------------------------------------------------------

test("referencedLocalSymbols: $-suffixed, $-prefixed, and plain names in the signature are all found", () => {
  const defs = new Set(["users$", "$state", "plain"]);
  const sig = "export function wire(users$: Stream, $state: State, plain: number): void";
  assert.deepStrictEqual(referencedLocalSymbols(sig, undefined, defs), ["users$", "$state", "plain"]);
});

test("referencedLocalSymbols: a short name still never matches inside a longer identifier (Rust semantics preserved)", () => {
  const defs = new Set(["Reg"]);
  assert.deepStrictEqual(referencedLocalSymbols("fn induct(r: &CohortRegister)", undefined, defs), []);
  assert.deepStrictEqual(referencedLocalSymbols("fn induct(r: &Reg)", undefined, defs), ["Reg"]);
});

test("referencedLocalSymbols: a backticked doc mention of a $-name is a reference", () => {
  const defs = new Set(["users$"]);
  const out = referencedLocalSymbols("export function drain(): void", "/** Drains `users$` fully. */", defs);
  assert.deepStrictEqual(out, ["users$"]);
});

// ---------------------------------------------------------------------------
// Python scanner: pin the probe set the review ran (all passed; keep it so).
// ---------------------------------------------------------------------------

test("pyFileLocalDefinitions: def / async def / class at column 0; indented and commented never", () => {
  const src = [
    `def helper(n):`,
    `    return n`,
    `async def fetch_all():`,
    `    pass`,
    `class Cohort:`,
    `    def method(self):`,
    `        pass`,
    `# def commented(): ...`,
  ].join("\n");
  assert.deepStrictEqual(set(pyFileLocalDefinitions(src)), ["Cohort", "fetch_all", "helper"]);
});

test("pyFileLocalDefinitions: a docstring containing a column-0 def is blanked, never captured", () => {
  const src = `def real():\n    pass\n\nDOC = """\ndef fake():\n    pass\n"""\n`;
  assert.deepStrictEqual(set(pyFileLocalDefinitions(src)), ["real"]);
});

test("pyFileLocalDefinitions: an unterminated triple quote terminates the scan (no hang) and hides the tail", () => {
  const src = `def real():\n    pass\nBROKEN = """\ndef ghost():\n`;
  assert.deepStrictEqual(set(pyFileLocalDefinitions(src)), ["real"]);
});

test("pyFileLocalDefinitions: f-strings with nested quotes and raw strings never corrupt the scan", () => {
  const src = `MSG = f"hello {'x'} world"\nPAT = r"\\d+"\ndef real():\n    pass\n`;
  assert.deepStrictEqual(set(pyFileLocalDefinitions(src)), ["real"]);
});

test("pyFileLocalDefinitions: a backslash at end of a single-quote string line keeps line alignment", () => {
  const src = `S = 'one\\\n'\ndef real():\n    pass\n`;
  assert.deepStrictEqual(set(pyFileLocalDefinitions(src)), ["real"]);
});

// ---------------------------------------------------------------------------
// Dispatch: rust routes to the original scanner; csharp and unknown stay dark.
// ---------------------------------------------------------------------------

test("fileLocalDefinitionsFor: rust routes to the original scanner byte-for-byte", () => {
  const src = `pub struct Manifest {\n}\nfn load() {}\n`;
  assert.deepStrictEqual(set(fileLocalDefinitionsFor("rust", src)), set(fileLocalDefinitions(src)));
  assert.deepStrictEqual(set(fileLocalDefinitionsFor("rust", src)), ["Manifest", "load"]);
});

test("fileLocalDefinitionsFor: csharp and unregistered languages scan nothing (deliberately dark)", () => {
  const cs = `namespace App;\npublic class Basket {}\n`;
  assert.deepStrictEqual(set(fileLocalDefinitionsFor("csharp", cs)), []);
  // go left this set at v23 supersession (goFileLocalDefinitions shipped);
  // its scan is pinned in full by blind-v23-fngen-go.test.cjs.
  assert.deepStrictEqual(set(fileLocalDefinitionsFor("java", "class X {}\n")), []);
});
