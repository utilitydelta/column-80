// session-v76 phase 2+3 adversarial review. Probes of the macro gate lexer, the
// private tuple field marker and the host label join. Rows that assert the
// CURRENT behaviour are marked "(holds)"; rows that document a defect are
// marked "(defect)" and fail on the current tree.
//
// Run: node --test test/review-v76-p2.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "review-v76-p2",
  `export { isInsideMacroInvocation, hoverDeclaresDataType, macroGeneratedLine, macroMembersViaPath } from "../src/core/macroMembers";
export { markPrivateTupleFields, renderDerivedDef } from "../src/core/crossFileShape";
export { toCompletionMember, renderMemberSignatures, parseMemberLabel, isRaTraitLabelDetail } from "../src/core/extraction";\n`,
);
test.after(cleanup);

// The def cursor sits on the `Target` word on the last line of `src`.
function inside(src) {
  const lines = src.split("\n");
  const line = lines.findIndex((l) => /\bTarget\b/.test(l));
  return mod.isInsideMacroInvocation(src, { uri: "file:///x.rs", line, character: lines[line].search(/\bTarget\b/) });
}

const HAND_WRITTEN = {
  "after a macro_rules definition": "macro_rules! m { ($t:ident) => { pub struct $t; }; }\npub struct Target;",
  "cfg_attr + pub(crate) generic in a module":
    "mod a {\n    #[cfg_attr(feature = \"x\", derive(Debug))]\n    pub(crate) struct Target<T>(T);\n}",
  "after a char literal brace": "fn f() -> char { '{' }\npub struct Target;",
  "after a raw string with parens": 'const S: &str = r#"{("#;\npub struct Target;',
  "after a unicode escape char": "const C: char = '\\u{7B}';\npub struct Target;",
  "inside an if-not block": "fn g(x: bool) { if !(x) { struct Target; } }",
  "after lifetimes": "impl<'a> X<'a> { fn f(&self, s: &'a str) -> char { 'a' } }\nstruct Target;",
  "after a byte char quote": "const Q: u8 = b'\"';\nconst P: &str = \"(\";\nstruct Target;",
  "after nested block comment": "/* /* ( */ */\nstruct Target;",
  "after an assert! call": "fn t() { assert!(true); }\nstruct Target;",
  "CRLF file": "fn t() { assert!(true); }\r\nfn u() {}\r\nstruct Target;",
};
for (const [name, src] of Object.entries(HAND_WRITTEN)) {
  test(`gate (holds): hand-written, ${name}`, () => assert.strictEqual(inside(src), false));
}

const INVOKED = {
  parens: "newtype!(Target);",
  brackets: "newtype![Target];",
  braces: "bitflags! {\n    pub struct Target: u8 {\n        const A = 1;\n    }\n}",
  "path-qualified": "serde_with::newtype! {\n    Target\n}",
  "macro_rules body": "macro_rules! fixed { () => { pub struct Target; }; }",
  "non-ascii earlier on the line": "newtype!(/* é */ Target);",
};
for (const [name, src] of Object.entries(INVOKED)) {
  test(`gate (holds): invoked, ${name}`, () => assert.strictEqual(inside(src), true));
}

// A byte raw string is lexed as a plain string: `br#"x"f!("#` reads the `"`
// after `x` as the close, then counts `f!(` as an open invocation.
test("gate (defect, LOW): a byte raw string can leave a phantom macro open", () => {
  assert.strictEqual(inside('const B: &[u8] = br#"x"f!("#;\npub struct Target;'), false);
});

// ---------------------------------------------------------------------------
// C4 marker edge cases.
// ---------------------------------------------------------------------------
const MARK = {
  "pub(crate) then private": ["pub struct P(pub(crate) u8, u16)", "P", "pub struct P(pub(crate) u8, /* private */ u16)"],
  "nested tuple": ["pub struct N((u8, u8))", "N", "pub struct N(/* private */ (u8, u8))"],
  "fn pointer field": ["pub struct F(fn(u8) -> u8)", "F", "pub struct F(/* private */ fn(u8) -> u8)"],
  "generic with Fn bound": [
    "pub struct W<T: Fn(u8) -> Vec<u8>>(T)",
    "W",
    "pub struct W<T: Fn(u8) -> Vec<u8>>(/* private */ T)",
  ],
  "where clause": ["pub struct Wh<T>(pub T, T)\nwhere\n    T: Copy,", "Wh", "pub struct Wh<T>(pub T, /* private */ T)\nwhere\n    T: Copy,"],
  "attribute on field": ["pub struct A(#[doc(hidden)] u8)", "A", "pub struct A(#[doc(hidden)] /* private */ u8)"],
  "array field": ["pub struct Arr([u8; 4], pub u8)", "Arr", "pub struct Arr(/* private */ [u8; 4], pub u8)"],
  "named struct untouched": ["pub struct S {\n    a: u8,\n}", "S", "pub struct S {\n    a: u8,\n}"],
  "unit struct untouched": ["pub struct U;", "U", "pub struct U;"],
};
for (const [name, [sig, n, want]] of Object.entries(MARK)) {
  test(`marker (holds): ${name}`, () => assert.strictEqual(mod.markPrivateTupleFields(sig, n), want));
}

// rust-analyzer truncates a hover past its field limit with a `/* … */`
// ellipsis (src/vscode/firstRun.ts). The marker treats the ellipsis as a field
// and prefixes it, so the block claims a private field that is an elision.
test("marker (defect, LOW): the hover's own ellipsis is marked as a private field", () => {
  const sig = "pub struct Wide(u8, u8, u8, u8, u8, /* … */)";
  assert.strictEqual(
    mod.markPrivateTupleFields(sig, "Wide"),
    "pub struct Wide(/* private */ u8, /* private */ u8, /* private */ u8, /* private */ u8, /* private */ u8, /* … */)",
  );
});

// ---------------------------------------------------------------------------
// Host label join: a trait member the VS Code host labels `{ label: "clone",
// detail: "(as Clone)" }` now carries viaTrait, so the member-site block drops
// it through UNIVERSAL_TRAITS. The legal-name set is built from `members` by
// name and is unaffected; this row pins that the RENDERED block changed.
// ---------------------------------------------------------------------------
test("host join (behaviour change): Default/From/Clone leave the rendered member block", () => {
  const joined = (label, detail) => (mod.isRaTraitLabelDetail(detail) ? `${label}${detail}` : label);
  const members = [
    mod.toCompletionMember(joined("new", undefined), "fn() -> Foo", "function"),
    mod.toCompletionMember(joined("default", "(as Default)"), "fn() -> Self", "function"),
    mod.toCompletionMember(joined("from", "(as From)"), "fn(u8) -> Self", "function"),
  ];
  // At HEAD the host label was the bare name, so all three rendered.
  assert.strictEqual(mod.renderMemberSignatures(members), "new() -> Foo");
});
