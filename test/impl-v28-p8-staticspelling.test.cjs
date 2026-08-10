// A static member must be spelled the way the caller has to type it.
//
// The capture (the human's dogfood run, round 0, verbatim from the channel):
//
//   Members of `Result` ...
//   Ok(T) : Result<T, E>
//   Err(E) : Result<T, E>
//
//   -> return Err(TileCountError.NoTiles);   CS0103: the name 'Err' does not
//                                            exist in the current context
//
// `Ok` and `Err` are statics of `Result<T, E>`. Rendered bare they read as
// functions in scope, and the model wrote them that way. Measured at the round-0
// prompt, 5 generations an arm:
//
//   the capture's own block order, bare render      0 of 5 compile
//   the same order, `Result<T, E>.Ok(T)` render     5 of 5
//
// A second arm moved the `Result` block to the END of the surface and also got
// 5 of 5 with the bare render, which says the model reaches for whatever sits
// nearest the code. That is a position effect, not a fix: it depends on which
// type happens to render last. The spelling is intrinsic, so the spelling is
// what this pins.
//
// Run: SKIP_LIVE=1 node --test test/impl-v28-p8-staticspelling.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v28-p8",
  `export { csStaticQualifier, csQualifyStatics } from "../src/core/csExtraction";\n`,
);
test.after(cleanup);
const { csStaticQualifier, csQualifyStatics } = mod;

// The real hovers, from a live probe of the Roslyn server.
const RESULT_HOVER = "readonly struct Atlas.Result<T, E>";
const TILE_HOVER = "class Atlas.Tile";
const ENUM_HOVER = "enum Atlas.LodBand";

test("the qualifier keeps the generic clause the caller has to write", () => {
  assert.equal(
    csStaticQualifier(RESULT_HOVER),
    "Result<T, E>",
    "`Result.Ok(...)` does not compile for a generic type; the arity is part of the spelling",
  );
});

test("the qualifier reads a hover that opens with modifiers", () => {
  assert.equal(csStaticQualifier("readonly struct Atlas.Result<T, E>"), "Result<T, E>");
  assert.equal(csStaticQualifier("public sealed class Atlas.Tile"), "Tile");
  assert.equal(csStaticQualifier(TILE_HOVER), "Tile");
  assert.equal(csStaticQualifier(ENUM_HOVER), "LodBand");
});

test("a hover that declares no type yields no qualifier, and nothing is guessed", () => {
  for (const shape of [undefined, "", "LodBand Tile.Band { get; }", "(local variable) Tile tile"]) {
    assert.equal(csStaticQualifier(shape), undefined, `nothing to qualify with in ${JSON.stringify(shape)}`);
  }
});

// The real declaration lines from Atlas/Result.cs, at their real line numbers.
const RESULT_LINES = [
  "namespace Atlas;",
  "",
  "public readonly struct Result<T, E>",
  "{",
  "    private readonly T _value;",
  "",
  "    public static Result<T, E> Ok(T value) => new(value, default!, true);",
  "",
  "    public static Result<T, E> Err(E error) => new(default!, error, false);",
  "",
  "    public R Match<R>(Func<T, R> ok, Func<E, R> err) => _ok ? ok(_value) : err(_error);",
];
const member = (name, signature, declLine) => ({ name, kind: "method", signature, declLine });

test("the capture: a static renders qualified, an instance member does not", () => {
  const out = csQualifyStatics(
    [
      member("Ok", "Ok(T) : Result<T, E>", 6),
      member("Err", "Err(E) : Result<T, E>", 8),
      member("Match", "Match<R>(Func<T, R>, Func<E, R>) : R", 10),
    ],
    RESULT_HOVER,
    RESULT_LINES,
  ).map((m) => m.signature);

  assert.deepEqual(out, [
    "Result<T, E>.Ok(T) : Result<T, E>",
    "Result<T, E>.Err(E) : Result<T, E>",
    "Match<R>(Func<T, R>, Func<E, R>) : R",
  ]);
});

test("nothing else about a member changes", () => {
  const before = member("Ok", "Ok(T) : Result<T, E>", 6);
  const [after] = csQualifyStatics([before], RESULT_HOVER, RESULT_LINES);
  assert.equal(after.name, "Ok", "the NAME is what the gate matches on and it must not move");
  assert.equal(after.kind, "method");
  assert.equal(after.declLine, 6);
  assert.equal(before.signature, "Ok(T) : Result<T, E>", "the input array is not mutated");
});

test("a member whose declaration cannot be read is left alone", () => {
  // No declLine, a line past the end, and a line that is not its declaration.
  // Each is absence of evidence, and a wrong qualifier is a name that does not
  // compile, which is the defect this fixes arriving from the other side.
  const cases = [
    member("Ok", "Ok(T) : Result<T, E>", undefined),
    member("Ok", "Ok(T) : Result<T, E>", 999),
    member("Ok", "Ok(T) : Result<T, E>", 3),
  ];
  for (const m of cases) {
    const [out] = csQualifyStatics([m], RESULT_HOVER, RESULT_LINES);
    assert.equal(out.signature, "Ok(T) : Result<T, E>", `left alone when the declaration says nothing: ${m.declLine}`);
  }
});

test("no qualifier means no rewrite", () => {
  const ms = [member("Ok", "Ok(T) : Result<T, E>", 6)];
  assert.equal(csQualifyStatics(ms, undefined, RESULT_LINES)[0].signature, "Ok(T) : Result<T, E>");
  assert.equal(csQualifyStatics(ms, "LodBand Tile.Band { get; }", RESULT_LINES)[0].signature, "Ok(T) : Result<T, E>");
});

test("a static that is already qualified is not qualified twice", () => {
  const ms = [member("Ok", "Result<T, E>.Ok(T) : Result<T, E>", 6)];
  assert.equal(
    csQualifyStatics(ms, RESULT_HOVER, RESULT_LINES)[0].signature,
    "Result<T, E>.Ok(T) : Result<T, E>",
    "the enum leg already spells its variants qualified, and both legs feed the same renderer",
  );
});

test("`static` inside a name or a string is not a modifier", () => {
  const lines = [
    "public sealed class Helper",
    "{",
    '    public string staticLabel = "static";',
    "    public int StaticCount() => 1;",
  ];
  const out = csQualifyStatics(
    [member("staticLabel", "staticLabel : string", 2), member("StaticCount", "StaticCount() : int", 3)],
    "class Atlas.Helper",
    lines,
  ).map((m) => m.signature);
  assert.deepEqual(out, ["staticLabel : string", "StaticCount() : int"], "neither declaration carries the modifier");
});
