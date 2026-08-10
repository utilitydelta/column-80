// ADVERSARIAL REVIEW of session-v38 item 3: the three candidate refusals in the
// Rust fn-gen pre-fill (`declaredGenericParams`, `deriveOnlyImports`,
// `isAllCapsConstant`), plus the `isShoutedName`/`isAllCapsConstant` extraction
// in `src/core/repairTypes.ts`.
//
// Every row here ran. A row tagged [DEFECT] is RED and states a hole in the
// change; a row tagged [FINE] is GREEN and is a claim the change makes that
// this file went after and could not break, kept so a later edit cannot quietly
// undo it.
//
// Run: SKIP_LIVE=1 node --test test/review-v38-p3-candidate-refusals.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".review-v38-p3-stub.cjs");
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
const ENTRY = path.join(__dirname, ".review-v38-p3.entry.ts");
const OUTFILE = path.join(__dirname, ".review-v38-p3.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { prioritizedTypes } from "../src/vscode/fnGen";
export { isShoutedName, isAllCapsConstant } from "../src/core/repairTypes";\n`,
);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const M = require(OUTFILE);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const NO_LOCALS = new Set();
const rust = (signature, { doc, fullText = "", locals = NO_LOCALS, exclude = "go", span = "" } = {}) =>
  M.prioritizedTypes(signature, doc, fullText, locals, exclude, span);

// ═════════════════════════════════════════════════════════════════════════════
// 1. `deriveOnlyImports` interpolates file text into a regex UNESCAPED.
// ═════════════════════════════════════════════════════════════════════════════

test("[DEFECT] R1: a `#[derive(...)]` whose contents are not an identifier throws out of prioritizedTypes", () => {
  // `new RegExp(`\\b${name}\\b`)` with `name` taken verbatim from between the
  // derive parentheses. Any content that is not a valid regex fragment is a
  // SyntaxError thrown from candidate finding, which is on the
  // `column80.generateFunction` path with no try/catch between here and the
  // command handler. Reachable from a trybuild `tests/ui` fixture, a codegen
  // format template (`format!("#[derive({0})]", ..)`), or any comment or string
  // in the file that happens to contain the text.
  for (const content of ["*", "+", "?", "(", "[", "{0}"]) {
    const fullText = `use crate::m::Widget;\n#[derive(${content})]\npub struct S;\n`;
    assert.doesNotThrow(
      () => rust("fn go(x: Widget) -> Gizmo", { fullText }),
      `#[derive(${content})] must not crash candidate finding; the name needs escaping before it becomes a regex`,
    );
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. The five hard-coded derive traits are refused unconditionally, which the
//    source comment on `deriveOnlyImports` says they are not.
// ═════════════════════════════════════════════════════════════════════════════

const MANUAL_IMPL = [
  "use crate::codec::Encode;",
  "",
  "impl Encode for Widget {",
  "    fn encode(&self) -> Vec<u8> { vec![] }",
  "}",
  "",
].join("\n");

test("[DEFECT] R2: a project trait the file MANUALLY implements is refused because its name is on the list", () => {
  // `deriveOnlyImports`'s own doc comment: "A trait the code actually NAMES
  // anywhere else - a bound, a manual `impl`, a turbofish - fails the test and
  // stays a candidate." That is true of the mechanism and false of the five
  // names, which are seeded into the returned set before the mechanism runs and
  // can never be removed from it. This file has NO `#[derive]` at all.
  assert.deepEqual(
    rust("fn go(w: &Widget) -> Gizmo", { fullText: MANUAL_IMPL }),
    ["Widget", "Gizmo", "Encode"],
    "the mechanism the comment describes would keep `Encode`; the name list drops it",
  );
});

test("[FINE] R2b: the control - the identical file with the trait renamed keeps it", () => {
  assert.deepEqual(
    rust("fn go(w: &Widget) -> Gizmo", { fullText: MANUAL_IMPL.replace(/Encode/g, "Codec") }),
    ["Widget", "Gizmo", "Codec"],
    "same file shape, same leg, different answer, decided only by the hard-coded name",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. `isAllCapsConstant` is a claim about NAMES, and SCREAMING_SNAKE is a real
//    Rust TYPE naming convention in FFI and binding crates.
// ═════════════════════════════════════════════════════════════════════════════

test("[DEFECT] R3: a SCREAMING_SNAKE FFI struct is refused, and the junk path segments beside it are not", {
  todo:
    "DEFERRED by triage as scraps S38-7. The refusal is goal.md item 3 rule 3 as ratified, and repair has " +
    "applied a WIDER version of it for two sessions. The row is right that the rule is a claim about names " +
    "with a acme-only measurement behind it, and right that on an FFI file it makes the four slots " +
    "strictly worse. No cheap syntactic test separates SECURITY_ATTRIBUTES from MAX_LOD - both are imported " +
    "by name and both are spelled in the signature - so narrowing it is its own measurement, not a loop-back. " +
    "Red on purpose, and the scrap carries the evidence.",
}, () => {
  // `windows-sys`, `winapi` and bindgen output name structs this way.
  // At HEAD the list is ["SECURITY_ATTRIBUTES","Gizmo","Win32","Security"]: the
  // change deletes the one real type in it and leaves both path segments, so on
  // this file the refusal makes the four cap slots strictly worse.
  const got = rust("fn go(a: *mut SECURITY_ATTRIBUTES) -> Gizmo", {
    fullText: "use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;\n",
  });
  assert.ok(
    got.includes("SECURITY_ATTRIBUTES"),
    `a real struct named in the signature and imported by name must reach the list. Got ${JSON.stringify(got)}`,
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. `deriveOnlyImports` decides "is this an import" with a LINE-START regex, so
//    the grouped multi-line `use` - the dominant shape in real Rust - is invisible.
// ═════════════════════════════════════════════════════════════════════════════

const GROUPED_USE = [
  "use arbitrary::{",
  "    Arbitrary,",
  "};",
  "use crate::m::Widget;",
  "",
  "#[derive(Arbitrary)]",
  "pub struct S { w: Widget }",
  "",
].join("\n");
const INLINE_USE = GROUPED_USE.replace("use arbitrary::{\n    Arbitrary,\n};", "use arbitrary::Arbitrary;");

test("[DEFECT] R4: the same import written across three lines instead of one defeats the derive mechanism", () => {
  // The continuation line `    Arbitrary,` does not start with `use`, so it
  // survives the blanking, `\bArbitrary\b` matches it, and the name is judged
  // "used elsewhere". Rule 2's mechanism (blind oracle row C3) only fires on
  // single-line imports.
  assert.deepEqual(
    rust("fn go() -> Gizmo", { fullText: GROUPED_USE }),
    rust("fn go() -> Gizmo", { fullText: INLINE_USE }),
    "grouped and inline `use` of the same name are the same program and must give the same candidate list",
  );
});

test("[FINE] R4b: the control - the inline form does refuse it, so the mechanism is alive", () => {
  const got = rust("fn go() -> Gizmo", { fullText: INLINE_USE });
  assert.ok(!got.includes("Arbitrary"), `inline import + derive-only occurrence is refused. Got ${JSON.stringify(got)}`);
});

test("[DEFECT] R5: a `cfg_attr` derive is neither detected nor blanked", () => {
  // `#[cfg_attr(feature = "x", derive(Sealed))]` is how every optional-feature
  // derive in a real crate is written. Both the collection regex and the
  // blanking regex require a literal `#[derive(`, so `Sealed` is not seen as
  // derived and its only occurrence is not blanked.
  const fullText = [
    "use serde2::Sealed;",
    "use crate::m::Widget;",
    "",
    '#[cfg_attr(feature = "s", derive(Sealed))]',
    "pub struct S { w: Widget }",
    "",
  ].join("\n");
  const got = rust("fn go() -> Gizmo", { fullText });
  assert.ok(!got.includes("Sealed"), `a cfg_attr-only derive trait still spends a slot. Got ${JSON.stringify(got)}`);
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. `declaredGenericParams` - what could NOT be broken. These are green and are
//    the reason the parser is not in the defect list above.
// ═════════════════════════════════════════════════════════════════════════════

test("[FINE] R6: the sharp one - a default type parameter's real type survives", () => {
  // `<T = Widget>` puts a real type INSIDE the parameter list. Only the leading
  // identifier of each top-level part is refused, so `Widget` lives.
  assert.deepEqual(rust("fn go<T = Widget>(x: T) -> Gizmo"), ["Widget", "Gizmo"]);
  assert.deepEqual(rust("fn go<T = Vec<Vec<Widget>>>(x: T) -> Gizmo"), ["Widget", "Gizmo"], "`>>>` shift tokens");
});

test("[FINE] R7: an arrow inside the parameter list ends the scan early but refuses no real type", () => {
  // `<F: Fn() -> Widget, U>`: the `>` of `->` drops the depth to zero, so `U` is
  // never read and stays a candidate. That is the harmless direction - a
  // parameter admitted, never a type refused - and `Widget` survives.
  const got = rust("fn go<F: Fn() -> Widget, U>(f: F, u: U) -> Gadget");
  assert.ok(got.includes("Widget") && got.includes("Gadget"), JSON.stringify(got));
  assert.ok(!got.includes("F"), "the parameter before the arrow is still refused");
});

test("[FINE] R8: attributes, `pub(crate) async unsafe`, multi-line lists and where clauses all parse", () => {
  assert.deepEqual(rust("#[inline]\npub fn go<T>(x: T) -> Widget"), ["Widget"]);
  assert.deepEqual(rust("pub(crate) async unsafe fn go<T>(x: T) -> Widget"), ["Widget"]);
  assert.deepEqual(rust("fn go<\n  T,\n  U: Into<Widget>,\n>(x: T, y: U) -> Gizmo"), ["Into", "Widget", "Gizmo"]);
  assert.deepEqual(rust("fn go<T>(x: T) -> Widget\nwhere\n    T: Into<Gadget>,\n"), ["Widget", "Into", "Gadget"]);
  assert.deepEqual(rust("fn go<T: AsRef<Path> + Send>(p: T) -> Widget"), ["AsRef", "Path", "Send", "Widget"]);
  assert.deepEqual(rust("fn go<const N: bool = { 3 > 2 }>(x: Widget) -> Gizmo"), ["Widget", "Gizmo"], "`>` in a const expr");
});

test("[FINE] R9: `isShoutedName` subsumes the pair it replaced, exhaustively to length 4", () => {
  // Repair's clause was `/^[A-Z]$/.test(n) || /^[A-Z][A-Z0-9_]*$/.test(n)`.
  const old = (n) => /^[A-Z]$/.test(n) || /^[A-Z][A-Z0-9_]*$/.test(n);
  const alphabet = ["A", "Z", "a", "z", "0", "9", "_", "$", "-", "1"];
  let checked = 0;
  const walk = (prefix, depth) => {
    if (depth === 0) return;
    for (const c of alphabet) {
      const n = prefix + c;
      checked++;
      assert.equal(M.isShoutedName(n), old(n), `divergence on ${JSON.stringify(n)}`);
      walk(n, depth - 1);
    }
  };
  walk("", 4);
  assert.equal(checked, 11110);
});

test("[FINE] R10: the two nets are deliberately different and `UUID` is where they part", () => {
  assert.equal(M.isShoutedName("UUID"), true, "repair's wide net eats an acronym");
  assert.equal(M.isAllCapsConstant("UUID"), false, "fn-gen's narrow net does not");
  assert.equal(M.isAllCapsConstant("MAX_LOD"), true);
  assert.equal(M.isAllCapsConstant("T"), false);
  assert.equal(M.isAllCapsConstant("_A_B"), false, "a leading underscore is not SCREAMING_SNAKE by this rule");
});
