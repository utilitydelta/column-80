// WHITE-BOX, session-v42 phase 0 (S40-3). The qualified-usage mining legs
// refuse a mined name immediately followed by `(` BEFORE it reaches
// resolveTypeCursorByName - every emission is one live workspace/symbol round
// trip, and ~90% of Go emissions were calls, not types. Blind-style rows: each
// states the observable (the emitted list), not the mechanism.
//
// Run: SKIP_LIVE=1 node --test test/impl-v42-p0-call-guard.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v42-p0-call-guard",
  `export { goTypesFromQualifiedUsage, csTypesFromQualifiedUsage } from "../src/core/repairTypes";\n`,
);
const { goTypesFromQualifiedUsage, csTypesFromQualifiedUsage } = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// Go. fullText carries the import block; span is the masked gesture text.
// ---------------------------------------------------------------------------

const GO_FULL = [
  "package app",
  "",
  'import (',
  '    "github.com/spf13/pflag"',
  ')',
  "",
].join("\n");

const goMine = (span) => goTypesFromQualifiedUsage("func run()", undefined, span, GO_FULL);

test("go: a call `pflag.NewFlagSet(` is refused before the lookup fires", () => {
  assert.deepEqual(goMine('fs := pflag.NewFlagSet("app", 1)'), []);
});

test("go: a bare type use `pflag.FlagSet` is kept", () => {
  assert.deepEqual(goMine("var fs *pflag.FlagSet"), ["FlagSet"]);
});

test("go: a name at the very end of the text is kept (no char after it, no false call)", () => {
  assert.deepEqual(goMine("x := pflag.FlagSet"), ["FlagSet"]);
});

test("go: a method call on a local `x.Foo(` emits nothing", () => {
  // Refused twice over: `x` is no import, and the name is call-shaped.
  assert.deepEqual(goMine("x.Foo(1)"), []);
});

test("go: a call occurrence does not poison a later bare use of the same name", () => {
  assert.deepEqual(goMine("a := pflag.FlagSet(v)\nvar b *pflag.FlagSet"), ["FlagSet"]);
});

test("go: a type conversion `pflag.ErrorHandling(0)` is knowingly refused - call-shaped, measured flat on the ceiling", () => {
  assert.deepEqual(goMine("h := pflag.ErrorHandling(0)"), []);
});

// ---------------------------------------------------------------------------
// C#. Same seam, same shape; the one grammar-proven exception is `new`.
// ---------------------------------------------------------------------------

const CS_FULL = ["using Newtonsoft.Json.Linq;", "using Company.Data;", "", "class C {}", ""].join("\n");

const csMine = (span) => csTypesFromQualifiedUsage("void Run()", undefined, span, CS_FULL);

test("csharp: a call `Company.Data.Load(` is refused", () => {
  assert.deepEqual(csMine("var x = Company.Data.Load(path);"), []);
});

test("csharp: a bare type use `Newtonsoft.Json.Linq.JObject` is kept", () => {
  assert.deepEqual(csMine("Newtonsoft.Json.Linq.JObject o;"), ["JObject"]);
});

test("csharp: `new Ns.Type(` is a TYPE by grammar and stays kept", () => {
  assert.deepEqual(csMine("var o = new Newtonsoft.Json.Linq.JObject(x);"), ["JObject"]);
});

test("csharp: a name at line end is kept", () => {
  assert.deepEqual(csMine("typeof(Company.Data.Exporter)\nvar y = Company.Data.Exporter"), ["Exporter"]);
});
