// A language's own type must not be filtered out by another language's prelude.
//
// The capture (the human's own dogfood run, a .NET codebase whose house rules
// say "use `Result<T,E>` for anything you expect to fail"):
//
//   public static Result<int, TileCountError> RegionLodCount(List<Tile> tiles)
//
// Round 0 disclosed `TileCountError`, `Tile` and `LodBand`, and NOT `Result`.
// With no `Ok` and no `Err` in front of it the model returned the error value
// and the count bare, the compiler refused both conversions, and it took a
// repair round to land what round 0 had every chance to write. The repair round
// got it because it mines the span through `csTypesInPlay`, which filters on
// the C# set.
//
// The cause: `typesNamedIn` filters candidates through PRELUDE_TYPES, which is
// RUST's prelude - String, Vec, Option, Result, Box, Rc, Arc. Every non-Rust
// candidate miner calls it, so a C#, TypeScript, Python or Go type sharing a
// name with a Rust std type is invisible to round 0 in that language. Each
// miner then applies its OWN std set correctly, which is what makes this hard
// to see: the filtering looks right where you read it, and the wrong set was
// applied one call earlier.
//
// Run: SKIP_LIVE=1 node --test test/impl-v28-p7-preludeblind.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// The miners live in src/vscode/fnGen.ts, so the bundle needs the vscode stub
// the other provider-level oracles use. Nothing here touches the editor API;
// the alias exists so the module graph resolves.
const STUB = path.join(__dirname, ".impl-v28-p7-stub.cjs");
fs.writeFileSync(
  STUB,
  `module.exports = {
  Position: class {}, Range: class {}, ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: (s) => ({ toString: () => String(s) }), file: (s) => ({ toString: () => String(s) }) },
  workspace: { getConfiguration: () => ({ get: (k, fb) => fb }) },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  ProgressLocation: {}, EndOfLine: {}, SymbolKind: {},
};
`,
);
const ENTRY = path.join(__dirname, ".impl-v28-p7.entry.ts");
const OUT = path.join(__dirname, ".impl-v28-p7.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { typesNamedIn } from "../src/core/compilerDirected";
export { csPrioritizedTypes, tsPrioritizedTypes, pyPrioritizedTypes, goPrioritizedTypes } from "../src/vscode/fnGen";
export { spanTypesInPlay } from "../src/core/repairTypes";\n`,
);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
const mod = require(OUT);
test.after(() => [STUB, ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));
const { typesNamedIn, csPrioritizedTypes, tsPrioritizedTypes, pyPrioritizedTypes, goPrioritizedTypes, spanTypesInPlay } = mod;

const NO_LOCALS = new Set();

// The captured C# signature, verbatim.
const CS_SIGNATURE = "public static Result<int, TileCountError> RegionLodCount(List<Tile> tiles)";

test("the capture: a C# round-0 candidate list carries the user's own `Result`", () => {
  const out = csPrioritizedTypes(CS_SIGNATURE, undefined, "", NO_LOCALS, "RegionLodCount");
  assert.ok(
    out.includes("Result"),
    `without it the model has no Ok and no Err and cannot construct the return type at all; got ${JSON.stringify(out)}`,
  );
  assert.ok(out.includes("TileCountError"), `the error type is still a candidate; got ${JSON.stringify(out)}`);
  assert.ok(out.includes("Tile"), `the parameter's element type is still a candidate; got ${JSON.stringify(out)}`);
  assert.ok(
    !out.includes("List"),
    `C#'s own std set still does its job; got ${JSON.stringify(out)}`,
  );
});

// The same shape in the other three languages. A user type named after a Rust
// std type is ordinary in all of them, and none of their std sets contains
// these names.
const ROWS = [
  {
    lang: "typescript",
    miner: tsPrioritizedTypes,
    signature: "export function loadTiles(source: Box<Tile>): Result<Tile, LoadError>",
    wanted: ["Result", "Box", "LoadError"],
    stillStopped: "Array",
    stopShape: "export function f(xs: Array<Tile>): Tile",
  },
  {
    lang: "python",
    miner: pyPrioritizedTypes,
    signature: "def load_tiles(source: Cow) -> Result[Tile, LoadError]:",
    wanted: ["Result", "Cow", "LoadError"],
    stillStopped: "Optional",
    stopShape: "def f(x: Optional[Tile]) -> Tile:",
  },
  {
    lang: "go",
    miner: goPrioritizedTypes,
    signature: "func LoadTiles(source Cow) Result",
    wanted: ["Result", "Cow"],
    stillStopped: "Context",
    stopShape: "func F(ctx Context) Tile",
  },
];

for (const row of ROWS) {
  test(`[${row.lang}] a user type sharing a name with Rust's prelude is a candidate`, () => {
    const out = row.miner(row.signature, undefined, "", NO_LOCALS, undefined);
    for (const want of row.wanted) {
      assert.ok(
        out.includes(want),
        `${want} is this language's own type, not Rust's; got ${JSON.stringify(out)}`,
      );
    }
  });

  test(`[${row.lang}] its OWN std set still stops its own std names`, () => {
    const out = row.miner(row.stopShape, undefined, "", NO_LOCALS, undefined);
    assert.ok(
      !out.includes(row.stillStopped),
      `${row.stillStopped} belongs to ${row.lang}'s std surface and must stay stopped; got ${JSON.stringify(out)}`,
    );
  });
}

test("Rust is unchanged: its own prelude still stops its own names", () => {
  const out = typesNamedIn("pub fn load(source: Vec<Tile>) -> Result<Tile, LoadError>", undefined, "load");
  assert.ok(!out.includes("Result"), `Rust's Result is std and stays stopped; got ${JSON.stringify(out)}`);
  assert.ok(!out.includes("Vec"), `same for Vec; got ${JSON.stringify(out)}`);
  assert.ok(out.includes("Tile") && out.includes("LoadError"), `user types survive; got ${JSON.stringify(out)}`);
});

test("the repair leg's doc tier reads the same way: a C# doc naming `Result` keeps it", () => {
  const out = spanTypesInPlay({
    languageId: "csharp",
    signature: "public static int Count(List<Tile> tiles)",
    docComment: "Returns a `Result` when the list is empty.",
    code: "public static int Count(List<Tile> tiles)\n{\n    return 0;\n}",
  });
  assert.ok(
    out.includes("Result"),
    `the doc tier runs through the same reader and must not lose a C# type either; got ${JSON.stringify(out)}`,
  );
});
