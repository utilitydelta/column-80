// BLIND contract oracle for session-v38 item 3: the three candidate refusals in
// the Rust fn-gen pre-fill. Written from the ratified contract and the declared
// facade only, before the implementation existed.
//
// FILES NEVER OPENED to write this. `src/vscode/fnGen.ts` and
// `src/core/compilerDirected.ts` were not read, grepped, or listed. The facade
// below was taken from the callers in `test/adversarial-v37-p1.test.cjs` and
// `test/blind-v37-p1-backtick-r4.test.cjs`, and every "currently" number in a
// comment came from CALLING the built product, never from reading it.
//
// WHAT THE CONTRACT SAYS. The pre-fill mines candidate TYPE names out of four
// legs: the function signature, the doc comment, the backticked names in the
// body comments, and the file's `use` imports. Each candidate costs one language
// server round trip and, if kept, one of only four injection slots. Three
// classes of name can never resolve to a useful surface and must be refused as
// candidates, FOR RUST ONLY:
//
//   1. DECLARED GENERIC PARAMETERS. A name the signature's own generic parameter
//      list declares. The rule keys on the DECLARATION, not on the shape of the
//      name: acme-db contains `fn request_sync_two_phase<C, S, T, Fut2>`,
//      and `Fut` and `Fut2` are type parameters a lone-capital rule would miss.
//      A `where` clause is part of the same declaration.
//   2. DERIVE-MACRO TRAITS. `Serialize`, `Deserialize`, `Decode`, `Encode`,
//      `DeepSizeOf`. They arrive on the `use` leg, are named only inside
//      `#[derive(...)]`, and resolve to nothing useful.
//   3. ALL-CAPS CONSTANTS. `MAX_LOD`, `TTL_SECS`. A constant is not a type and
//      has no definition to inject.
//
// Measured population, from the goal's own table over the cap-4 `nothing
// renderable` log: derive traits 26 (15%), type parameters 26 (15%), ALL-CAPS
// constants 4 (2%). Every count is a lower bound because the harness recorded
// `injLog.slice(0, 6)`. Slot reclamation is worth much less than it looks and
// the goal says so; these are done because they are cheap and obviously right.
//
// THE FROZEN COUNTER-EXAMPLE, and it is the whole difficulty of rule 1. A real
// type may legitimately be called `T`. `test/blind-v7-prepare.test.cjs` P3 pins a
// genuine `pub struct T` and requires it to survive the budget. So rule 1 may
// refuse only a name the SIGNATURE ITSELF DECLARES as a parameter, and never a
// lone capital the signature merely USES. Section B is that guard, at this
// facade's own level, and every row in it is GREEN today and must stay green.
//
// SCOPE IS RUST ONLY. Go, C#, Python and TypeScript candidate lists must not
// change by a single name; the goal's "Explicitly out" section says so. Section E
// pins four shapes those languages get WRONG today in exactly the way Rust does,
// so a fix applied to a shared helper is visible as a green row going red rather
// than as an improvement nobody asked for. This repo has been bitten by a shared
// path swept without measuring the other four languages.
//
// WHAT THIS FILE DOES NOT DUPLICATE. Two rows elsewhere already pin part of this
// contract and are red on purpose:
//   - `test/blind-v37-p1-backtick-r4.test.cjs`, "F in cap: EXPECTED RED,
//     PRE-EXISTING. An ALL-CAPS constant reaches fn-gen and spends a slot", is
//     rule 3 on the SPAN leg. Section D here pins the other three legs.
//   - `test/adversarial-v37-p1.test.cjs`, "[DEFECT] D: a type parameter takes a
//     cap slot when it arrives on the signature leg", is rule 1 on the plain
//     `fn go<T, U>` shape. Section A here starts where that row stops: the `Fut2`
//     widening, the `where` clause, lifetimes, const generics, and declaration
//     keying.
// Both are read as the expected shape of the fix, not re-asserted.
//
// A ROW THAT WILL BREAK WHEN THIS SHIPS, said out loud so nobody reads it as a
// regression: `[RECORD] D` in `test/adversarial-v37-p1.test.cjs` asserts
// `["T", "U", "Widget", "Gadget"]` as the in-cap list and that `Sprocket` is
// evicted. That is a record of the defect, and rule 1 inverts it. It needs
// retagging when item 3 lands, the same way that file retagged its other rows.
//
// ANTI-VACUITY. Every row that expects a refusal carries a real name in the SAME
// fixture that must survive, so a green row cannot be green because the leg died
// or the fixture never parsed. Every row asserts the EXACT list, because an extra
// name is not harmless: it spends a slot and a round trip.
//
// THE POINT IS THE SLOT, NOT THE LIST. Section F is the section that matters. A
// refusal implemented as a filter in the wrong place, after the budget rather
// than before it, passes every row in A, C and D and delivers nothing. Each F row
// puts more candidates in play than the cap and asserts that a real type which is
// evicted today survives.
//
// ─────────────────────────────────────────────────────────────────────────────
// EXPECTED RED, this being written against an unbuilt contract. 17 rows:
//
//   A1 A2 A3 A4 A5 A6 A7   rule 1, declared generic parameters               (7)
//   B5                     the collision: the file declares `pub struct T`
//                          AND the signature declares a generic `T`          (1)
//   C1 C3                  rule 2, derive-macro traits on the use leg        (2)
//   D1 D2 D3               rule 3, ALL-CAPS constants on the other legs      (3)
//   F1 F2 F3 F4            the slot is actually freed                        (4)
//
// EXPECTED GREEN, and these are the guards: B1 B2 B3 B4, C2, C4, D4, E1 E2 E3 E4
// E5. If one of them goes red the fix went wider than the contract.
//
// C3 is labelled DERIVED and may legitimately stay red forever: see its comment.
//
// AS RUN, first run, against the working tree of 2026-08-03: 17 red and 12 green,
// exactly the two lists above. No row was green when it was expected red, so
// nothing in item 3 is already built, and no guard row was red, so nothing in the
// working tree has already moved the other four languages.
// ─────────────────────────────────────────────────────────────────────────────
//
// WHAT THE CONTRACT LEAVES UNDER-SPECIFIED, each carried by the row that would
// have to change:
//
//   (i)   Is rule 2 a list of five names, or the mechanism "a use-imported name
//         whose only occurrence in the file is inside a `#[derive(...)]`"? The
//         contract states both in one breath. C1 pins the five names, C3 pins the
//         mechanism on `Arbitrary`, and a five-name build leaves C3 red.
//   (ii)  Is rule 2 keyed on the use LEG or on the NAME? If a developer backticks
//         `Serialize` in their own gesture they asked for it by hand. C4 pins that
//         it survives. A name-keyed build turns C4 red, which is a contract
//         change and should be argued, not absorbed.
//   (iii) What counts as ALL-CAPS? `MAX_LOD` and `TTL_SECS` both carry an
//         underscore. `UUID` is all capitals and is a plausible real type. Repair's
//         own filter refuses `UUID` today, measured through `spanTypesInPlay`. D4
//         pins that fn-gen keeps it, on the reading that the contract's examples
//         are SCREAMING_SNAKE constants. A build mirroring repair turns D4 red and
//         that is defensible; the row exists to make the choice visible.
//   (iv)  A method inside `impl<T> Store<T>` has `T` declared on the impl block,
//         not on the signature the facade receives. The contract says the
//         signature's own list, so B3 pins that this `T` is NOT refused. It is a
//         real hole in the population the goal counted and no row here asks for it
//         to be closed.
//   (v)   Trait bounds are left alone. `where F: Into<Gadget>` yields `Into` and
//         `Gadget` today and A3 keeps them. The contract refuses three classes and
//         a bound is none of them, but a bound trait is also rarely the surface
//         the developer wants, so this may be the next item rather than a defect.
//
// Run: SKIP_LIVE=1 node --test test/blind-v38-p3-candidate-refusals.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ── the facade ───────────────────────────────────────────────────────────────
// `fnGen.ts` imports vscode, so it comes through the same stub the other
// provider-level oracles use. Mechanics copied from
// test/blind-v37-p1-backtick-r4.test.cjs; nothing here touches the editor API.
const STUB = path.join(__dirname, ".blind-v38-p3-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
module.exports = {
  Position, Range, Selection: Range, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: {}, ProgressLocation: {}, EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: {},
  workspace: { getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }) },
};
`,
);
const ENTRY = path.join(__dirname, ".blind-v38-p3.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v38-p3.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { prioritizedTypes, tsPrioritizedTypes, csPrioritizedTypes, pyPrioritizedTypes, goPrioritizedTypes } from "../src/vscode/fnGen";\n`,
);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const FNGEN = require(OUTFILE);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const show = (v) => JSON.stringify(v);
const NO_LOCALS = new Set();

// The budget: the candidate list is cut to its first 4 entries before anything is
// injected. PREFILL_TYPE_CAP, not a number this file invented.
const CAP = 4;

// prioritizedTypes(signature, docComment, fullText, localTypeNames, excludeName, spanText)
const rust = (signature, { doc, fullText = "", locals = NO_LOCALS, exclude, span = "" } = {}) =>
  FNGEN.prioritizedTypes(signature, doc, fullText, locals, exclude, span);

// ═════════════════════════════════════════════════════════════════════════════
// A. RULE 1. A NAME THE SIGNATURE'S OWN GENERIC PARAMETER LIST DECLARES IS NOT A
//    CANDIDATE. Keyed on the declaration, never on the shape.
//
//    `test/adversarial-v37-p1.test.cjs` [DEFECT] D owns the plain `fn go<T, U>`
//    case and is not repeated. These rows are the shapes that case does not
//    reach, and A1 is the one that decides whether the build followed the goal's
//    correction or S37-4's narrower lone-capital proposal.
// ═════════════════════════════════════════════════════════════════════════════

test("A1: `Fut2` is a declared type parameter and a lone-capital rule cannot see it", () => {
  // The corpus shape, from the goal's own list of the 26 type parameters that
  // spent a slot: `R D W T F P C S Fut Fut2`. Two of the ten are not lone
  // capitals, which is the whole reason the goal widened S37-4's proposal from
  // "refuse a lone capital" to "refuse what the parameter list declares".
  // TODAY: ["C","S","T","Fut2","Widget"], so the cap is spent before `Widget`.
  const sig = "fn request_sync_two_phase<C, S, T, Fut2>(c: C, s: S, t: T, f: Fut2) -> Widget";
  assert.deepEqual(
    rust(sig, { exclude: "request_sync_two_phase" }),
    ["Widget"],
    `four declared parameters and one real return type. \`Fut2\` is the discriminator: a rule keyed on shape keeps it. Signature: ${sig}`,
  );
});

test("A2: a `where` clause is part of the same declaration", () => {
  // `Fut` is declared in the angle list and CONSTRAINED in the where clause. A
  // parser that reads only up to the closing angle bracket already refuses it;
  // one that mines the where clause as a second source of names puts it straight
  // back. `Send` is a real trait, is none of the three refused classes, and stays:
  // it is also this row's control.
  // TODAY: ["T","Fut","Widget","Send"].
  assert.deepEqual(
    rust("fn spawn<T, Fut>(x: T) -> Widget where Fut: Send", { exclude: "spawn" }),
    ["Widget", "Send"],
    "the where clause must not resurrect a name the angle list declared",
  );
});

test("A3: a real type named INSIDE a where-clause bound is not collateral", () => {
  // The cheapest wrong implementation of A2 deletes everything from `where` to
  // the end of the signature. `Gadget` is a real project type the developer named,
  // and it dies with that fix. TODAY: ["T","F","Widget","Into","Gadget"].
  assert.deepEqual(
    rust("fn go<T, F>(x: T) -> Widget where F: Into<Gadget>", { exclude: "go" }),
    ["Widget", "Into", "Gadget"],
    "refuse the declared parameters `T` and `F`, keep everything the bound NAMES",
  );
});

test("A4: a real type named inside the parameter list itself is not collateral", () => {
  // The same trap one bracket earlier: an implementation that strips the whole
  // `<...>` region loses `Gadget`, which is written inside it.
  // TODAY: ["T","Into","Gadget","Widget"].
  assert.deepEqual(
    rust("fn go<T: Into<Gadget>>(x: T) -> Widget", { exclude: "go" }),
    ["Into", "Gadget", "Widget"],
    "`T` is declared, `Into` and `Gadget` are named; the region is parsed, not deleted",
  );
});

test("A5: lifetimes in the parameter list are not types and must not confuse the parser", () => {
  // `'a` and `'b: 'a` sit in the same list as `T`, and the second carries a colon
  // that a naive split reads as a bound. The row demands the parser survive both
  // and still refuse `T`. TODAY: ["T","Widget"].
  assert.deepEqual(
    rust("fn go<'a, 'b: 'a, T>(x: &'a T, y: &'b T) -> Widget", { exclude: "go" }),
    ["Widget"],
    "a lifetime is never a candidate and never stops the parameter after it being refused",
  );
});

test("A6: a const generic is declared in the same list and is not a type either", () => {
  // `const N: usize` is a value parameter. It has no surface to inject and it is
  // also a lone capital, so a shape rule would catch it by accident; this row
  // exists so the DECLARATION rule catches it on purpose, and so the `const`
  // keyword and the `: usize` do not derail the parse of `T` beside it.
  // TODAY: ["N","T","Widget"].
  assert.deepEqual(
    rust("fn go<const N: usize, T>(x: [T; N]) -> Widget", { exclude: "go" }),
    ["Widget"],
    "both entries of the list are refused, for different reasons, and the return type survives",
  );
});

test("A7: the rule keys on DECLARED, so a used-but-not-declared name in the same signature survives", () => {
  // One signature, two single-capital names. `T` is declared between the angle
  // brackets; `A` is a real local type the signature only uses. This is the
  // narrow version of the frozen counter-example and the row that separates the
  // ratified rule from the refuted one in a single fixture.
  // TODAY: ["T","A","Widget"].
  assert.deepEqual(
    rust("fn go<T>(a: A, t: T) -> Widget", { fullText: "pub struct A;\n", locals: new Set(["A"]), exclude: "go" }),
    ["A", "Widget"],
    "same shape, same signature, opposite answers, decided by which one the signature declares",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// B. THE FROZEN COUNTER-EXAMPLE AND ITS NEIGHBOURS. GREEN TODAY. A build that
//    turns any of B1 to B4 red has gone wider than the contract, and B1 and B2
//    are the facade-level echo of the frozen `blind-v7-prepare` P3 row, which
//    runs through the whole pre-fill and would report the same breakage far more
//    slowly.
// ═════════════════════════════════════════════════════════════════════════════

test("B1: a lone capital the signature only USES is a real type and survives", () => {
  assert.deepEqual(
    rust("fn target(a: T) -> Widget", {
      fullText: "pub struct T;\npub struct Widget;\n",
      locals: new Set(["T", "Widget"]),
      exclude: "target",
    }),
    ["T", "Widget"],
    "the file declares `pub struct T` and the signature has no generic parameter list at all",
  );
});

test("B2: the frozen P3 fixture at this facade's level, and its control", () => {
  // `test/blind-v7-prepare.test.cjs` P3 declares `pub struct A` and `pub struct T`
  // and requires both to survive the budget. `A` arrives on the signature leg and
  // `T` on the doc leg. Both are single capitals and neither is declared as a
  // parameter anywhere.
  const P3_SRC = [
    "use ext::U1;",
    "",
    "struct A {",
    "    n: u32,",
    "}",
    "",
    "struct T {",
    "    by_cohort: u32,",
    "}",
    "",
    "fn target(a: A) -> usize {",
    "    todo!()",
    "}",
    "",
  ].join("\n");
  const opts = { doc: "Fold A into the register T.", fullText: P3_SRC, exclude: "target" };
  assert.deepEqual(
    rust("fn target(a: A) -> usize", { ...opts, locals: new Set(["A", "T"]) }),
    ["A", "T", "U1"],
    "both real single-capital types reach the list, inside the 4-slot budget, ahead of the use-mined external",
  );
  // The control, so the row above cannot pass because the doc leg died: with the
  // local set empty the doc-named `T` is not mined at all, which is what makes
  // the assertion above a statement about local types rather than about prose.
  assert.deepEqual(
    rust("fn target(a: A) -> usize", { ...opts, locals: NO_LOCALS }),
    ["A", "U1"],
    "control: `T` is on the list because the file declares it, so the leg is alive and keyed on the local set",
  );
});

// B3. REVERSED BY session-v41 PHASE 3, on purpose and with the session's name
// on it.
//
// This row pinned ambiguity (iv) OPEN: `T` is declared on `impl<T> Store<T>`,
// not on the signature the facade receives, so the v38 contract's "signature's
// own parameter list" left it a candidate. The old comment deferred the fix
// itself: "closing it means reading the enclosing item, which is a different
// mechanism with its own measurement." Session-v41 supplied the measurement
// (its census reached the example leg down exactly this shape) and phase 3
// built the mechanism: `enclosingImplGenericParams` in src/vscode/fnGen.ts,
// unioned into the candidate refusal beside the signature-declared set.
//
// The new expectation is correct because the old one asserted a junk example
// block renders. A bare type variable has no surface to exemplify, whichever
// scope declared it, and an example block headed by one is the lie the gate
// now refuses. The v41 contract pins the reversal at
// test/blind-v41-p3-example-gate.test.cjs row E1, on this same shape; the
// register entry is docs/supersessions.md S13.
test("B3: a generic declared on the enclosing `impl` block is refused like a signature-declared one (v41 reversal of the v38 pin)", () => {
  const IMPL = [
    "pub struct Store<T> { v: Vec<T> }",
    "",
    "impl<T> Store<T> {",
    "    fn go(&self, x: T) -> Widget {",
    "        todo!()",
    "    }",
    "}",
    "",
  ].join("\n");
  assert.deepEqual(
    rust("fn go(&self, x: T) -> Widget", { fullText: IMPL, exclude: "go" }),
    ["Widget"],
    "the impl-declared `T` is refused; only the real surface survives",
  );
});

test("B4: an empty generic parameter list parses to nothing and refuses nothing", () => {
  assert.deepEqual(
    rust("fn go<>(x: A) -> Widget", { locals: new Set(["A"]), exclude: "go" }),
    ["A", "Widget"],
    "degenerate but legal; the parser must not treat an empty list as a wildcard",
  );
});

test("B5: the collision. The file declares `pub struct T` AND the signature declares a generic `T`", () => {
  // EXPECTED RED. The hardest case in rule 1 and the one the frozen row does not
  // settle. Inside this function body the generic parameter SHADOWS the struct, so
  // the name `T` at this position resolves to a parameter with no surface, and
  // injecting the struct's surface would be actively wrong. The declaration wins
  // over the local set. `Widget` is the control.
  // TODAY: ["T","Widget"].
  assert.deepEqual(
    rust("fn go<T>(x: T) -> Widget", {
      fullText: "pub struct T;\npub struct Widget;\n",
      locals: new Set(["T", "Widget"]),
      exclude: "go",
    }),
    ["Widget"],
    "the local set must not override the declaration; B1 is the same fixture with the declaration removed",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// C. RULE 2. DERIVE-MACRO TRAITS, WHICH REACH THE LIST ON THE `use` LEG.
//    26 of the goal's slots, the largest of the three refusals.
// ═════════════════════════════════════════════════════════════════════════════

const DERIVE_FILE = [
  "use serde::{Serialize, Deserialize};",
  "use bincode::{Decode, Encode};",
  "use deepsize::DeepSizeOf;",
  "use crate::model::Widget;",
  "",
  "#[derive(Serialize, Deserialize, Decode, Encode, DeepSizeOf)]",
  "pub struct Widget { n: u32 }",
  "",
  "fn go() -> Widget {",
  "    todo!()",
  "}",
  "",
].join("\n");

test("C1: all five named derive traits are refused on the use leg, and the real import beside them is not", () => {
  // TODAY: ["Serialize","Deserialize","Decode","Encode","DeepSizeOf","Widget"] in
  // some order, which is five useless round trips and, at cap 4, the loss of the
  // only real name in the file. F2 pins the slot half; this row pins the list.
  assert.deepEqual(
    rust("fn go() -> Widget", { fullText: DERIVE_FILE, exclude: "go" }),
    ["Widget"],
    `the five are named only inside #[derive(...)] and resolve to nothing useful. File:\n${DERIVE_FILE}`,
  );
});

test("C2: a real project trait on the use leg is NOT swept up with them", () => {
  // The goal is explicit that this fix does not reach the project traits:
  // `Validate` 15, `S3Downloader` 4, `LeaseStore` 3 are real traits with real
  // methods, they rendered nothing anyway, and no fix in item 3 touches them.
  // A rule that refuses "imported trait-looking names" would take these too and
  // would be a different, unmeasured change. GREEN today and must stay green.
  const src = "use crate::valid::Validate;\nuse crate::model::Widget;\n";
  assert.deepEqual(
    rust("fn go()", { fullText: src, exclude: "go" }),
    ["Validate", "Widget"],
    "22 slots of the goal's table are project traits and they are explicitly out of this item",
  );
});

test("C3: DERIVED. A use-imported name occurring ONLY inside #[derive(...)] is refused", () => {
  // Ambiguity (i). The contract names five traits AND describes the mechanism
  // that makes them useless. If the build hardcodes the five, this row stays red
  // and that is a legitimate reading, not a defect: it is recorded here so the
  // choice is visible and so the next crate's `Zeroize` or `Arbitrary` has a row
  // waiting for it. `Widget` is the control. TODAY: ["Arbitrary","Widget"].
  const src = [
    "use arbitrary::Arbitrary;",
    "use crate::model::Widget;",
    "",
    "#[derive(Arbitrary)]",
    "pub struct Widget;",
    "",
  ].join("\n");
  assert.deepEqual(
    rust("fn go()", { fullText: src, exclude: "go" }),
    ["Widget"],
    "the mechanism, not the name list. A five-name build leaves this red on purpose",
  );
});

test("C4: a derive trait the developer BACKTICKS by hand is still their gesture, and survives", () => {
  // Ambiguity (ii). The evidence behind rule 2 is about names arriving on the use
  // leg without anyone asking. A gesture is the opposite: the developer typed the
  // name into the comment they are writing. Refusing it there is a second,
  // unmeasured change, and gesture names are the channel every language shares.
  // GREEN today and expected to stay green. If a build turns it red, the contract
  // moved from leg-keyed to name-keyed and that should be argued out loud.
  assert.deepEqual(
    rust("fn go()", { exclude: "go", span: "fn go() {\n    // implement `Serialize` for `Widget`\n}" }),
    ["Serialize", "Widget"],
    "the use leg is ambient, a gesture is not",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// D. RULE 3. ALL-CAPS CONSTANTS, ON THE THREE LEGS THE EXISTING RED ROW DOES NOT
//    COVER. `blind-v37-p1-backtick-r4.test.cjs` owns the span leg. Only 4 slots
//    in the goal's table, and the cheapest of the three to get right.
//
//    Repair already refuses these through its own shape filter, so this is the
//    two-write-path asymmetry S37-2 recorded, closed on the Rust side only.
// ═════════════════════════════════════════════════════════════════════════════

test("D1: a constant named in the signature is not a candidate", () => {
  // A const generic argument written by name, which is how a bounded array
  // parameter reads. TODAY: ["MAX_LOD","Widget"].
  assert.deepEqual(
    rust("fn go(cap: MAX_LOD) -> Widget", { exclude: "go" }),
    ["Widget"],
    "a constant has no definition to inject, whichever leg it arrives on",
  );
});

test("D2: constants named in the doc comment are not candidates", () => {
  // TODAY: ["MAX_LOD","Widget"].
  assert.deepEqual(
    rust("fn go()", { doc: "/// bounded by `MAX_LOD`, returns `Widget`", exclude: "go" }),
    ["Widget"],
    "the doc leg and the span leg must agree; the span leg is pinned in blind-v37-p1-backtick-r4",
  );
});

test("D3: constants imported on the use leg are not candidates", () => {
  // A grouped `use` of two constants and a type, which is the ordinary shape.
  // TODAY: ["MAX_LOD","TTL_SECS","Widget"], so at cap 4 they cost two round trips
  // and push the real type toward the edge of the budget.
  const src = "use crate::limits::{MAX_LOD, TTL_SECS};\nuse crate::model::Widget;\n";
  assert.deepEqual(
    rust("fn go()", { fullText: src, exclude: "go" }),
    ["Widget"],
    "the fourth leg, and the one that admits a constant without anyone writing it",
  );
});

test("D4: an all-capital ACRONYM with no underscore is left alone", () => {
  // Ambiguity (iii). The contract's examples are SCREAMING_SNAKE and its reason is
  // "a constant is not a type". `UUID` is a plausible real type and Rust's
  // constant convention needs the underscore to be legible. MEASURED: repair's
  // `spanTypesInPlay` refuses `UUID` today, so a build that mirrors repair's
  // filter turns this row red. That is a defensible contract change and this row
  // is where it gets noticed. GREEN today.
  assert.deepEqual(
    rust("fn go(u: UUID) -> Widget", { exclude: "go" }),
    ["UUID", "Widget"],
    "if this goes red the rule became `[A-Z]+` rather than `a screaming-snake constant`",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// E. SCOPE. THE OTHER FOUR LANGUAGES DO NOT CHANGE BY A SINGLE NAME.
//
//    Every row here is GREEN today and asserts the CURRENT list, junk included.
//    Do not read them as approval of that list; read them as the goal's
//    "Explicitly out" section made executable. The four rows were chosen because
//    each is a shape the language gets wrong in exactly the way Rust does, so a
//    refusal added to a shared helper is caught here instead of shipping as an
//    unmeasured change to four languages.
// ═════════════════════════════════════════════════════════════════════════════

test("E1 [typescript]: a declared type parameter that is not a lone capital still reaches the list", () => {
  assert.deepEqual(
    FNGEN.tsPrioritizedTypes("function go<Fut2>(x: Fut2): Widget", undefined, "", NO_LOCALS, "go", ""),
    ["Fut2", "Widget"],
    "the identical defect to A1, out of scope on purpose. Rust only",
  );
});

test("E2 [csharp]: the same, through the C# ranker", () => {
  assert.deepEqual(
    FNGEN.csPrioritizedTypes("public Widget Go<Fut2>(Fut2 x)", undefined, "", NO_LOCALS, "Go", ""),
    ["Widget", "Fut2"],
    "same defect, same scope decision",
  );
});

test("E3 [typescript]: derive-shaped names on the import leg still reach the list", () => {
  const src = 'import { Serialize, Deserialize, Decode, Encode } from "x";\nimport { Widget } from "./model";\n';
  assert.deepEqual(
    FNGEN.tsPrioritizedTypes("function go()", undefined, src, NO_LOCALS, "go", ""),
    ["Serialize", "Deserialize", "Decode", "Encode", "Widget"],
    "rule 2 by name would sweep this list; the scope says it must not",
  );
});

test("E4 [all four]: an ALL-CAPS constant in a gesture still spends a slot outside Rust", () => {
  // v36's frozen F4 says "an ALL-CAPS name is a constant, not a type", which is a
  // claim about NAMES and therefore about all five languages. Item 3 fixes Rust
  // only. The inconsistency is deliberate and this row is where it is recorded,
  // so the next session can widen it as a measured change rather than notice it
  // by accident.
  const cases = [
    ["typescript", "tsPrioritizedTypes", "function build()", "build", "function build() {\n  // bounded by `MAX_LOD`, returns a `Widget`\n}"],
    ["csharp", "csPrioritizedTypes", "public void Build()", "Build", "public void Build() {\n    // bounded by `MAX_LOD`, returns a `Widget`\n}"],
    ["python", "pyPrioritizedTypes", "def build():", "build", "def build():\n    # bounded by `MAX_LOD`, returns a `Widget`\n    pass\n"],
    ["go", "goPrioritizedTypes", "func Build()", "Build", "func Build() {\n\t// bounded by `MAX_LOD`, returns a `Widget`\n}"],
  ];
  for (const [lang, ranker, signature, exclude, span] of cases) {
    assert.deepEqual(
      FNGEN[ranker](signature, undefined, "", NO_LOCALS, exclude, span),
      ["MAX_LOD", "Widget"],
      `${lang}: unchanged. The control is the Widget in the same span, so the leg is alive`,
    );
  }
});

test("E5 [python]: a type-parameter-shaped annotation still reaches the list", () => {
  assert.deepEqual(
    FNGEN.pyPrioritizedTypes("def go(x: Fut2) -> Widget:", undefined, "", NO_LOCALS, "go", ""),
    ["Fut2", "Widget"],
    "Python declares nothing in a signature, so there is nothing here for rule 1 to key on even in principle",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// F. THE SLOT. This is the section the item exists for.
//
//    A refusal that filters the OUTPUT after the budget has already been spent
//    passes every row in A, C and D and delivers nothing: the same four names are
//    resolved, the same round trips are paid, and the real type is still evicted.
//    Each row here puts more candidates in play than the cap and asserts that a
//    name evicted today survives.
//
//    The budget is `list.slice(0, 4)`, applied by the caller, so each row asserts
//    the whole list AND the in-cap prefix.
// ═════════════════════════════════════════════════════════════════════════════

test("F1: rule 1 frees a slot, and the developer's own backticked name stops being evicted", () => {
  // TODAY: ["T","Fut2","Widget","Gadget","Sprocket"], in cap
  // ["T","Fut2","Widget","Gadget"], so `Sprocket` is extracted, budgeted out, and
  // never resolved. Two declared parameters cost the developer a name they typed.
  const span = "fn go() {\n    // needs `Gadget` and `Sprocket`\n}";
  const got = rust("fn go<T, Fut2>(t: T, f: Fut2) -> Widget", { exclude: "go", span });
  assert.deepEqual(got, ["Widget", "Gadget", "Sprocket"], `the whole list. Got ${show(got)}`);
  assert.ok(
    got.slice(0, CAP).includes("Sprocket"),
    `and it must be IN CAP, not merely in the list: ${show(got.slice(0, CAP))}. A filter applied after the budget passes A1 and fails here`,
  );
});

test("F2: rule 2 frees a slot, and today the only real name in the file is evicted entirely", () => {
  // The sharpest of the four. Four derive traits are imported before the one type
  // this file defines, so the cap is full before `Widget` is reached.
  // TODAY: ["Serialize","Deserialize","Decode","Encode","Widget"], in cap the four
  // traits and nothing else. Four round trips, four slots, zero surface.
  const src = [
    "use serde::Serialize;",
    "use serde::Deserialize;",
    "use bincode::Decode;",
    "use bincode::Encode;",
    "use crate::model::Widget;",
    "",
  ].join("\n");
  const got = rust("fn go()", { fullText: src, exclude: "go" });
  assert.deepEqual(got, ["Widget"], `the whole list. Got ${show(got)}`);
  assert.ok(got.slice(0, CAP).includes("Widget"), "the one real type in the file must be inside the budget");
});

test("F3: rule 3 frees a slot", () => {
  // TODAY: ["MAX_LOD","TTL_SECS","MAX_RETRIES","Widget","Gadget"], in cap the
  // three constants and `Widget`; `Gadget` is evicted by names that cannot resolve.
  const span = "fn build() {\n    // bounded by `MAX_LOD`, `TTL_SECS`, `MAX_RETRIES` producing `Widget`, `Gadget`\n}";
  const got = rust("fn build()", { exclude: "build", span });
  assert.deepEqual(got, ["Widget", "Gadget"], `the whole list. Got ${show(got)}`);
  assert.ok(got.slice(0, CAP).includes("Gadget"), "the second real type must be inside the budget");
});

test("F4: all three classes at once, which is the shape the corpus actually has", () => {
  // Two declared parameters, a constant in the signature, a derive trait on the
  // use leg, a real import, and a gesture. Six of the seven candidates today are
  // wrong or evicted.
  // TODAY: ["T","Fut2","MAX_LOD","Widget","Sprocket","Serialize","Gadget"], in cap
  // ["T","Fut2","MAX_LOD","Widget"], so of the three real types the developer can
  // point at, one survives.
  const src = "use serde::Serialize;\nuse crate::model::Gadget;\n";
  const span = "fn go() {\n    // and a `Sprocket`\n}";
  const got = rust("fn go<T, Fut2>(t: T, f: Fut2, cap: MAX_LOD) -> Widget", { fullText: src, exclude: "go", span });
  assert.deepEqual(got, ["Widget", "Sprocket", "Gadget"], `the whole list. Got ${show(got)}`);
  assert.deepEqual(
    got.slice(0, CAP),
    ["Widget", "Sprocket", "Gadget"],
    "three real types, three slots, and one slot left over instead of three names that cannot resolve",
  );
});
