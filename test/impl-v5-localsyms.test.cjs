// Implementer edge tests for the local-symbol deterministic leg (v5 goal item
// 6), complementing the blind oracle (test/blind-v5-localsyms.test.cjs). These
// reach shapes only the implementation exposes: fn qualifiers on the definition
// head, glob/self members, nested-group reconstruction, and the module-scope
// (column-0) discipline that keeps body-local and impl-local names out.
//
// Run: SKIP_LIVE=1 node --test test/impl-v5-localsyms.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v5-localsyms",
  `export { fileLocalDefinitions, stripLocalShadowingUses } from "../src/core/instructPostprocess";\n`
);
const { fileLocalDefinitions, stripLocalShadowingUses } = mod;
test.after(cleanup);

// ---- fileLocalDefinitions: fn-qualifier heads name the fn, not the qualifier
const qualifierCases = [
  ["const fn", "const fn zero() -> u8 { 0 }", "zero"],
  ["async fn", "async fn stream() {}", "stream"],
  ["unsafe fn", "unsafe fn raw() {}", "raw"],
  ["async unsafe fn", "async unsafe fn danger() {}", "danger"],
  ['extern "C" fn', 'extern "C" fn ffi() {}', "ffi"],
  ["pub const fn", "pub const fn size() -> usize { 0 }", "size"],
  ['pub const unsafe extern "C" fn', 'pub const unsafe extern "C" fn wild() {}', "wild"],
];
for (const [name, line, expected] of qualifierCases) {
  test(`fileLocalDefinitions: ${name} head names the function`, () => {
    const defs = fileLocalDefinitions(line);
    assert.ok(defs.has(expected), `expected ${expected} in {${[...defs].join(", ")}}`);
  });
}

// ---- const/static as ITEMS keep their own name (not consumed as a qualifier)
test("fileLocalDefinitions: `const C: u8 = 1;` captures C, not a following token", () => {
  const defs = fileLocalDefinitions("const C: u8 = 1;\nstatic S: u8 = 2;");
  assert.ok(defs.has("C") && defs.has("S"));
  assert.ok(!defs.has("fn"), "no keyword leaked as a name");
});

// ---- a keyword-prefixed identifier is not a false definition
test("fileLocalDefinitions: `structure_of` is not captured as a struct", () => {
  assert.ok(!fileLocalDefinitions("let structure_of = 5;").has("structure_of"));
});

// ---- module scope: indentation excludes body-local and impl-local names
test("fileLocalDefinitions: a struct nested in a fn body is not module scope", () => {
  const src = "fn outer() {\n    struct Local;\n    const X: u8 = 1;\n}";
  const defs = fileLocalDefinitions(src);
  assert.ok(defs.has("outer"), "the top-level fn is captured");
  assert.ok(!defs.has("Local"), "the body-local struct is not");
  assert.ok(!defs.has("X"), "the body-local const is not");
});

test("fileLocalDefinitions: fns inside an impl block are not module scope", () => {
  const src = "impl CohortRegister {\n    pub fn new() -> Self { todo!() }\n    fn induct(&mut self) {}\n}";
  const defs = fileLocalDefinitions(src);
  assert.ok(!defs.has("new") && !defs.has("induct"), "impl methods are indented, excluded");
});

// ---- the repro shape: the struct is captured across the whole file
test("fileLocalDefinitions: the repro file exposes CohortRegister", () => {
  const src = [
    "use atlas::{Envelope, Stripe, Tile};",
    "use std::collections::HashMap;",
    "pub struct CohortRegister {",
    "    by_cohort: HashMap<u32, Vec<u64>>,",
    "}",
    "impl CohortRegister {",
    "    pub fn new() -> Self { todo!() }",
    "}",
    "fn cohort_seven_count() -> usize { todo!() }",
  ].join("\n");
  const defs = fileLocalDefinitions(src);
  assert.ok(defs.has("CohortRegister"));
  assert.ok(defs.has("cohort_seven_count"));
  assert.ok(!defs.has("Tile"), "an imported type is not a local definition");
  assert.ok(!defs.has("new"), "an impl method is not module scope");
});

// ---- OVER-STRIP GUARD (P1 review finding #1): a definition keyword that is
// only the text of a comment or a string literal must NOT be captured, or it
// would strip a genuine external `use`. The dangerous direction — a real import
// dropped turns compiling code into non-compiling code.
test("fileLocalDefinitions: `struct Foo` inside a /* */ block comment is not a local def", () => {
  const src = "use atlas::Foo;\n/* struct Foo {\n    x: u8,\n} */\nfn use_it() {}";
  const defs = fileLocalDefinitions(src);
  assert.ok(!defs.has("Foo"), "the commented-out struct is not captured");
  assert.ok(defs.has("use_it"), "real code after the comment still is");
});

test("fileLocalDefinitions: `struct Ghost` inside a string literal is not a local def", () => {
  const src = 'const TEMPLATE: &str = "\\nstruct Ghost\\n";\nfn render() {}';
  const defs = fileLocalDefinitions(src);
  assert.ok(!defs.has("Ghost"), "the struct named in the string is not captured");
  assert.ok(defs.has("TEMPLATE") && defs.has("render"), "the real const and fn are");
});

test("fileLocalDefinitions: `mod x` inside a raw string is not a local def", () => {
  const src = 'const DOC: &str = r#"mod secret { fn hidden() {} }"#;\nstruct Real;';
  const defs = fileLocalDefinitions(src);
  assert.ok(!defs.has("secret") && !defs.has("hidden"), "raw-string content is neutralised");
  assert.ok(defs.has("Real") && defs.has("DOC"));
});

test("fileLocalDefinitions: a def keyword after a // line comment on the same line is fine", () => {
  const src = "struct Real; // struct Fake";
  const defs = fileLocalDefinitions(src);
  assert.ok(defs.has("Real") && !defs.has("Fake"));
});

test("stripLocalShadowingUses: a genuine external use survives when its leaf only appears in a comment", () => {
  // End-to-end of the over-strip repro: the only `Foo` in the file is inside a
  // block comment, so the local set must be empty of it and the import kept.
  const src = "use atlas::Foo;\n/* struct Foo; */";
  const body = "fn f() {\n    use atlas::Foo;\n    let _ = Foo::new();\n}";
  const out = stripLocalShadowingUses(body, fileLocalDefinitions(src));
  assert.ok(/use atlas::Foo;/.test(out), "the genuine external import is NOT stripped");
});

// ---- OVER-STRIP GUARD (P1 re-review): a quote-bearing char literal (`'"'`)
// must not flip string parity and re-expose a following &str's content as code.
test("fileLocalDefinitions: a `'\"'` char literal does not re-expose a later string's content", () => {
  const src = 'const QUOTE: char = \'"\';\nconst TEMPLATE: &str = "prelude\nstruct Bar\nend";\nfn real() {}';
  const defs = fileLocalDefinitions(src);
  assert.ok(!defs.has("Bar"), "the struct named inside the &str is NOT a local def");
  assert.ok(defs.has("QUOTE") && defs.has("TEMPLATE") && defs.has("real"), "real defs captured");
});

test("stripLocalShadowingUses: external use survives past a `'\"'` char literal + code-shaped string", () => {
  const src = 'const Q: char = \'"\';\nconst T: &str = "x\nstruct Bar\ny";';
  const body = "fn f() {\n    use crate::gen::Bar;\n    Bar::default()\n}";
  const out = stripLocalShadowingUses(body, fileLocalDefinitions(src));
  assert.ok(/use crate::gen::Bar;/.test(out), "genuine external import NOT stripped");
});

test("fileLocalDefinitions: a lifetime `'a` is not mistaken for a char literal", () => {
  const src = "struct Wrapper<'a> {\n    inner: &'a str,\n}\nfn borrow<'a>(x: &'a str) {}";
  const defs = fileLocalDefinitions(src);
  assert.ok(defs.has("Wrapper") && defs.has("borrow"), "defs with lifetimes still captured");
});

// ---- stripLocalShadowingUses: glob and self members are kept
test("stripLocalShadowingUses: a glob import is kept even if a leaf-like local exists", () => {
  const body = "fn f() {\n    use atlas::*;\n    let _ = 0;\n}";
  const out = stripLocalShadowingUses(body, new Set(["Tile"]));
  assert.ok(/use atlas::\*;/.test(out), "glob survives");
});

test("stripLocalShadowingUses: `self` member is kept, local sibling dropped", () => {
  const body = "fn f() {\n    use atlas::{self, CohortRegister};\n}";
  const out = stripLocalShadowingUses(body, new Set(["CohortRegister"]));
  assert.ok(/atlas/.test(out), "self keeps the module in scope");
  assert.ok(!/CohortRegister/.test(out), "the local-shadowing member is dropped");
});

// ---- nested-group reconstruction keeps external members under a common prefix
test("stripLocalShadowingUses: nested group keeps externals, drops the local leaf", () => {
  const body = "fn f() {\n    use std::collections::{HashMap, HashSet};\n}";
  // Neither is local -> untouched, verbatim.
  assert.strictEqual(
    stripLocalShadowingUses(body, new Set(["CohortRegister"])),
    body,
  );
});

test("stripLocalShadowingUses: drops one external leaf from a real grouped import", () => {
  const body = "fn f() {\n    use std::collections::{HashMap, HashSet};\n    let _ = 0;\n}";
  const out = stripLocalShadowingUses(body, new Set(["HashSet"]));
  assert.ok(/HashMap/.test(out) && !/HashSet/.test(out), "HashMap kept, HashSet dropped");
  assert.ok(/use std::collections::/.test(out), "re-rendered under the shared prefix");
});

// ---- multiple use lines, only the shadowing one goes
test("stripLocalShadowingUses: leaves an unrelated adjacent use intact", () => {
  const body = "fn f() {\n    use atlas::CohortRegister;\n    use fastbloom::BloomFilter;\n    let _ = 0;\n}";
  const out = stripLocalShadowingUses(body, new Set(["CohortRegister"]));
  assert.ok(!/CohortRegister/.test(out), "the local shadow is gone");
  assert.ok(/use fastbloom::BloomFilter;/.test(out), "the genuine import stays");
});
