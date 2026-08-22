// BLIND ORACLE — session-v23 phase 3: the Go member-site detector row
// (`goMemberSite` + `memberSiteFor("go")`, dispatch-map row 4), the Go comment
// token (`lineCommentFor("go")`, row 5), and the Go arg-type stop-rules row
// (`argTypeStopRulesFor("go")`, row 6). Black-box: written from
// the v23 goal and its dispatch map, plus the exported surface of
// src/core/fimInject.ts AS SHIPPED TODAY; the Go implementation is never
// opened.
//
// Contract points:
//   goMemberSite      fires ({partial}) on a trailing `.` after an
//                     identifier / call / index (`s.`, `s.En`, `NewStripe().`,
//                     `xs[0].`); partial is the typed member prefix ("" at a
//                     bare dot). Dark: a `//`-comment current line, float
//                     literals (`1.`, `x := 42.`), a double dot (`s..`), and
//                     `::` NEVER fires for Go — Go has no `::` (the goal:
//                     "`.`-only beside Python's").
//   memberSiteFor     "go" dispatches to the goMemberSite contract — pinned
//                     BEHAVIORALLY (the registry's function may be a thin
//                     wrapper, as the C-family rows are): memberSiteFor("go")
//                     matches goMemberSite on every case, fire and dark. The
//                     C-family rows keep `::` firing, untouched.
//   lineCommentFor    "go" -> "//" (row 5 says the default suffices; the
//                     VALUE is asserted, never the mechanism).
//   argTypeStopRulesFor  "go" -> { std: GO_STD_TYPE_NAMES-shaped Set,
//                     rustPositions falsy } (row 6) — the same return shape as
//                     the shipped TS/C#/Python rows. std holds the stdlib
//                     names (time.Time / sync.Mutex shaped) and never user
//                     types (Stripe). EXPECTED EXPORT LOCATION (finding for
//                     the implementer): argTypeStopRulesFor is module-private
//                     in fimInject.ts today; this suite pins it as a named
//                     export from src/core/fimInject.ts so the Go row's shape
//                     is assertable. The behavioral cross-check rides the
//                     already-exported argumentTypeNames(members, "go").
//
// Never reads src/** contents. Expected RED today: goMemberSite and the
// argTypeStopRulesFor export do not exist, so the bundle fails; the guard
// keeps one loud surface failure and skips the rest until the impl lands.
//
// Run: SKIP_LIVE=1 node --test test/blind-v23-gomembersite.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v23-gomembersite",
    `export { goMemberSite, memberSiteFor, lineCommentFor, argTypeStopRulesFor, argumentTypeNames, fimMemberSite } from "../src/core/fimInject";\n`
  ));
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.goMemberSite !== "function") {
  bundleError = new Error("the bundle built but exports no goMemberSite from src/core/fimInject.ts");
}
if (!bundleError && typeof mod.argTypeStopRulesFor !== "function") {
  bundleError = new Error("the bundle built but exports no argTypeStopRulesFor from src/core/fimInject.ts");
}
test.after(() => cleanup());

const { goMemberSite, memberSiteFor, lineCommentFor, argTypeStopRulesFor, argumentTypeNames, fimMemberSite } = mod;

test("bundle: the v23 Go member-site surface builds (goMemberSite + argTypeStopRulesFor exported from src/core/fimInject.ts) [surface: dispatch-map rows 4-6]", () => {
  if (bundleError) {
    assert.fail(`the surface is not implemented yet: ${bundleError.message}`);
  }
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// 1. goMemberSite — FIRES on a trailing `.` after ident / call / index.
// ---------------------------------------------------------------------------

const FIRE_CASES = [
  // [name, prefix, expectedPartial]
  ["ident then bare dot", "s.", ""],
  ["ident then dot with typed partial", "s.En", "En"],
  ["dot after a call", "NewStripe().", ""],
  ["dot after a call, partial typed", "NewStripe().Enr", "Enr"],
  ["dot after an index", "xs[0].", ""],
  ["chained member access", "s.repo.", ""],
  ["inside a tab-indented method body", "func (s *Stripe) Do() error {\n\ts.", ""],
  ["tab-indented with partial", "func (s *Stripe) Do() error {\n\ts.Enro", "Enro"],
];

gtest("goMemberSite: a trailing `.` after ident/call/index fires with the typed partial ('' at a bare dot) [surface: goal 'Member-site detector `.`-only beside Python's']", () => {
  for (const [name, prefix, expectedPartial] of FIRE_CASES) {
    assert.deepStrictEqual(
      goMemberSite(prefix),
      { partial: expectedPartial },
      `[${name}] prefix=${JSON.stringify(prefix)} -> expected {partial:${JSON.stringify(expectedPartial)}}, got ${JSON.stringify(goMemberSite(prefix))}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. goMemberSite — DARK: comments, floats, double dot, and `::` (Go has none).
// ---------------------------------------------------------------------------

const DARK_CASES = [
  // [name, prefix]
  ["`//` comment current line, tab-indented", "\t// s."],
  ["`//` comment current line with dotted call", "// result := s.Enroll()"],
  ["float literal `1.`", "1."],
  ["float literal `3.14`", "3.14"],
  ["float in an assignment `x := 42.`", "x := 42."],
  ["double dot", "s.."],
  ["`::` never fires for Go (`std::`)", "std::"],
  ["`::` with a partial (`std::string`)", "std::string"],
  ["fresh empty position", ""],
  ["pure whitespace", "\t\t"],
  ["bare identifier, no trailing dot", "s"],
];

gtest("goMemberSite: dark at comment lines, float dots, double dots, and every `::` — Go has no `::` [surface: 'std:: -> undefined' + the float/comment stops]", () => {
  for (const [name, prefix] of DARK_CASES) {
    assert.strictEqual(
      goMemberSite(prefix),
      undefined,
      `[${name}] prefix=${JSON.stringify(prefix)} -> expected undefined, got ${JSON.stringify(goMemberSite(prefix))}`,
    );
  }
});

gtest("goMemberSite: only the CURRENT line's `//` darkens — a prior comment line never darkens live code below it [surface: the shared current-line discipline, Go-shaped]", () => {
  assert.deepStrictEqual(
    goMemberSite("\t// enroll the tile\n\ts.En"),
    { partial: "En" },
    "a `//` on a PRIOR line must not darken the current live `s.En`",
  );
  assert.strictEqual(
    goMemberSite("s := NewStripe()\n\t// note s.Enroll"),
    undefined,
    "the CURRENT line starting (after trim) with `//` is dark",
  );
});

// ---------------------------------------------------------------------------
// 3. memberSiteFor("go") — behaviorally identical to goMemberSite on every
//    case, fire and dark; the C-family rows keep `::` firing.
// ---------------------------------------------------------------------------

gtest("memberSiteFor('go'): matches goMemberSite on every fire and dark case (identity or behavioral wrapper both pass) [surface: dispatch-map row 4 'goMemberSite .-only thin wrapper']", () => {
  const detect = memberSiteFor("go");
  assert.strictEqual(typeof detect, "function", "memberSiteFor('go') yields a detector");
  for (const [name, prefix] of [...FIRE_CASES.map(([n, p]) => [n, p]), ...DARK_CASES]) {
    assert.deepStrictEqual(
      detect(prefix),
      goMemberSite(prefix),
      `[${name}] memberSiteFor('go') and goMemberSite must agree on ${JSON.stringify(prefix)}`,
    );
  }
});

gtest("memberSiteFor: the C-family rows keep `::` firing — darkening `::` is Go/Python-scoped, never a change to the shared helper [surface: v11 precedent, F2 stays scoped]", () => {
  for (const lang of ["rust", "csharp"]) {
    const detect = memberSiteFor(lang);
    assert.strictEqual(typeof detect, "function", `memberSiteFor(${JSON.stringify(lang)}) yields a detector`);
    assert.deepStrictEqual(detect("Type::"), { partial: "" }, `[${lang}] a trailing :: remains a member site`);
  }
  assert.deepStrictEqual(fimMemberSite("std::"), { partial: "" }, "the shared helper itself is untouched: `std::` still fires there");
});

// ---------------------------------------------------------------------------
// 4. lineCommentFor("go") — the VALUE, not the mechanism.
// ---------------------------------------------------------------------------

gtest("lineCommentFor('go') returns '//' (the value is the contract; row 5 says the default suffices) [surface: dispatch-map row 5]", () => {
  assert.strictEqual(lineCommentFor("go"), "//");
  assert.strictEqual(lineCommentFor("python"), "#", "the Python mapping is untouched");
});

// ---------------------------------------------------------------------------
// 5. argTypeStopRulesFor("go") — the row 6 shape, and the behavioral
//    cross-check through the exported argumentTypeNames.
// ---------------------------------------------------------------------------

gtest("argTypeStopRulesFor('go'): { std: Set, rustPositions falsy } — the shipped rows' shape; std holds stdlib names, never user types [surface: dispatch-map row 6 '{ std: GO_STD_TYPE_NAMES, rustPositions: false }']", () => {
  const rules = argTypeStopRulesFor("go");
  assert.ok(rules && typeof rules === "object", "a rules object comes back");
  assert.ok(rules.std instanceof Set, `the std stop set is a Set (the shape every shipped row returns); got ${Object.prototype.toString.call(rules.std)}`);
  assert.ok(rules.std.size > 0, "the Go std set is non-empty");
  assert.ok(!rules.rustPositions, `rustPositions is falsy for Go — impl/dyn are Rust grammar, not Go's; got ${JSON.stringify(rules.rustPositions)}`);
  // time.Time / sync.Mutex shaped names ARE stopped. The set's spelling is the
  // implementer's (bare last segment or qualified), so either passes.
  assert.ok(rules.std.has("Time") || rules.std.has("time.Time"), "time.Time-style names are in the std set");
  assert.ok(rules.std.has("Mutex") || rules.std.has("sync.Mutex"), "sync.Mutex-style names are in the std set");
  assert.ok(!rules.std.has("Stripe"), "a user type (Stripe) is never in the std stop set");
  assert.ok(!rules.std.has("Tile"), "a user type (Tile) is never in the std stop set");
});

gtest("argumentTypeNames(.., 'go'): user param types survive, time.Time/sync.Mutex are stopped — the row 6 rules applied end to end [surface: 'std set excludes user types' behavioral cross-check]", () => {
  const members = [
    { name: "Enroll", signature: "Enroll(t Tile, at time.Time, mu sync.Mutex) error" },
    { name: "Rehome", signature: "Rehome(other Stripe) error" },
  ];
  const names = argumentTypeNames(members, "go");
  assert.deepStrictEqual(
    names,
    ["Tile", "Stripe"],
    `user types in first-appearance order, stdlib stopped; got ${JSON.stringify(names)}`,
  );
});
