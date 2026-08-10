// BLIND ORACLE — session-v23 phase 3: the Go fn-gen rows. The Go punt row
// (`noPuntInstructionFor("go")` naming panic("unimplemented"), dispatch-map
// row 8), the shipped `looksLikePunt` coverage over Go stub bodies (row 8:
// the marker regex already covers them — pinned, not extended), the type-gen
// prompt noun for Go ("members", the non-Rust branch, row 7 NO ROW), and the
// Go file-local definitions scan (`fileLocalDefinitionsFor("go")`, row 10:
// a column-0 func/type scanner). Black-box: written from session-v23/goal.md
// + dispatch-map.md and the exported surfaces of src/core/punt.ts,
// src/core/prompt.ts, src/core/instructPostprocess.ts AS SHIPPED TODAY; no
// Go implementation is opened.
//
// Contract points:
//   noPuntInstructionFor("go")   its own row: names panic("unimplemented")
//                                (what gopls's own stub generator emits) and
//                                differs from the Rust/Python/C# rows and
//                                from the unregistered-language fallback.
//   looksLikePunt                the SHIPPED matcher already catches Go stub
//                                bodies: panic("unimplemented") via
//                                /\bunimplemented\b/i and
//                                panic("not implemented") via
//                                /\bnot implemented\b/i. panic("TODO") is NOT
//                                covered by the shipped markers (no bare
//                                /\btodo\b/; only todo!( and the Rust panic!(
//                                form) and is deliberately NOT pinned here —
//                                pin what the matcher guarantees, invent
//                                nothing.
//   typeInstruction (via assembleFnGenPrompt)  languageId "go" rides the
//                                non-Rust branch: the member noun is
//                                "members", never Rust's fields/variants/
//                                impl-blocks framing. typeInstruction itself
//                                is module-private; the public surface is
//                                assembleFnGenPrompt, the same pin the v12
//                                Python typegen suite used.
//   fileLocalDefinitionsFor("go")  returns the top-level defined names of a
//                                Go source: column-0 `func Name(` and
//                                `type Name ...` at minimum (the Set shape the
//                                Python sibling returns). Indented (local)
//                                func text is not top-level; names inside
//                                strings and comments are not definitions.
//
// Expected today: the bundle BUILDS (every export exists) — the reds are
// behavioral: the go punt row (today the neutral fallback) and the go
// definitions scan (today the empty Set). The looksLikePunt and type-noun
// tests pin behavior that already holds (rows 7 and 8 are NO-ROW/covered
// decisions) and run GREEN, the blind-v22 convention for unchanged
// invariants.
//
// Run: SKIP_LIVE=1 node --test test/blind-v23-fngen-go.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v23-fngen-go",
    `export { noPuntInstructionFor, looksLikePunt, NO_PUNT_INSTRUCTION } from "../src/core/punt";\n` +
      `export { assembleFnGenPrompt } from "../src/core/prompt";\n` +
      `export { fileLocalDefinitionsFor } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const { noPuntInstructionFor, looksLikePunt, NO_PUNT_INSTRUCTION, assembleFnGenPrompt, fileLocalDefinitionsFor } = mod;

test("bundle: the punt/prompt/instructPostprocess surfaces build (the Go rows land INSIDE existing exports) [surface: dispatch-map rows 7, 8, 10]", () => {
  if (bundleError) {
    assert.fail(`the surface failed to build: ${bundleError.message}`);
  }
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// 1. The Go punt row. RED today: "go" currently falls to the neutral
//    unregistered-language form.
// ---------------------------------------------------------------------------

gtest("noPuntInstructionFor('go'): a Go row exists — it differs from the unregistered-language fallback [surface: dispatch-map row 8 'Go row naming panic(\"unimplemented\")']", () => {
  const go = noPuntInstructionFor("go");
  assert.strictEqual(typeof go, "string", "the go directive is a string");
  assert.notStrictEqual(
    go,
    noPuntInstructionFor("zig"),
    "go must have its OWN row, not the neutral fallback an unregistered language gets",
  );
});

gtest("noPuntInstructionFor('go'): names panic(\"unimplemented\") — the stub gopls's own generator emits — and no foreign idiom [surface: goal 'Punt idiom panic(\"unimplemented\")']", () => {
  const go = noPuntInstructionFor("go");
  assert.ok(go.includes('panic("unimplemented")'), `the go directive names the Go stub idiom verbatim; got ${JSON.stringify(go)}`);
  assert.ok(!go.includes("todo!("), "no Rust idiom in the Go directive");
  assert.ok(!go.includes("NotImplementedError"), "no Python idiom in the Go directive");
  assert.ok(!go.includes("NotImplementedException"), "no C# idiom in the Go directive");
});

gtest("noPuntInstructionFor: the Go row differs from the Rust/Python/C# rows, and each keeps its own idiom [surface: 'differs from the Rust/Python/C# rows' + the frozen rust bytes]", () => {
  const go = noPuntInstructionFor("go");
  const rows = {
    rust: noPuntInstructionFor("rust"),
    python: noPuntInstructionFor("python"),
    csharp: noPuntInstructionFor("csharp"),
  };
  for (const [lang, text] of Object.entries(rows)) {
    assert.notStrictEqual(go, text, `the go row is not the ${lang} row`);
  }
  assert.strictEqual(rows.rust, NO_PUNT_INSTRUCTION, "the rust bytes stay the pinned NO_PUNT_INSTRUCTION identity");
  assert.ok(rows.rust.includes("todo!()"), "rust still names todo!()");
  assert.ok(rows.python.includes("NotImplementedError"), "python still names NotImplementedError");
  assert.ok(rows.csharp.includes("NotImplementedException"), "csharp still names NotImplementedException");
});

// ---------------------------------------------------------------------------
// 2. looksLikePunt over Go stub bodies — pinning the SHIPPED matcher's
//    guarantee (row 8: /\bunimplemented\b/i covers it). GREEN today.
// ---------------------------------------------------------------------------

const GO_PUNT_BODIES = [
  ["the gopls stub body", 'func (s *Stripe) Enroll(t Tile) error {\n\tpanic("unimplemented")\n}'],
  ["bare panic(\"unimplemented\") line", '\tpanic("unimplemented")'],
  ["panic(\"not implemented\") variant", 'func Fill(b *LodBand) error {\n\tpanic("not implemented")\n}'],
];

gtest("looksLikePunt: Go stub bodies — panic(\"unimplemented\") and panic(\"not implemented\") — read as punts under the SHIPPED markers [surface: dispatch-map row 8 'PUNT_MARKERS already matches /\\bunimplemented\\b/i']", () => {
  for (const [name, body] of GO_PUNT_BODIES) {
    assert.strictEqual(looksLikePunt(body), true, `[${name}] must read as a punt: ${JSON.stringify(body)}`);
  }
  // panic("TODO") is deliberately unpinned: the shipped markers carry no bare
  // /\btodo\b/ (only todo!( and Rust's panic!(...) phrasing), and this suite
  // pins what the matcher guarantees, not invented coverage.
});

gtest("looksLikePunt: a real Go body is NOT a punt (error handling is work, not a stub) [surface: 'kept tight so a legitimate function is not re-generated']", () => {
  const real =
    "func (s *Stripe) Enroll(t Tile) error {\n" +
    "\tif t.id == 0 {\n" +
    '\t\treturn fmt.Errorf("zero tile id")\n' +
    "\t}\n" +
    "\ts.tiles[t.band] = append(s.tiles[t.band], t)\n" +
    "\treturn nil\n" +
    "}";
  assert.strictEqual(looksLikePunt(real), false, "a working Go body never reads as a stub");
});

// ---------------------------------------------------------------------------
// 3. The type-gen noun for Go: "members" via the non-Rust branch, pinned
//    through the public assembleFnGenPrompt (typeInstruction is private —
//    the v12 Python pin's route). GREEN today (row 7: NO ROW needed).
// ---------------------------------------------------------------------------

gtest("typeInstruction via assembleFnGenPrompt: languageId 'go' says 'members' for struct AND interface kinds — never Rust's fields/variants/impl-blocks framing [surface: dispatch-map row 7 'non-Rust branch says members, fine for Go']", () => {
  for (const [kind, signature] of [
    ["struct", "type Stripe struct"],
    ["interface", "type Banded interface"],
  ]) {
    const prompt = assembleFnGenPrompt({ signature, languageId: "go", kind });
    assert.ok(prompt.includes(`Complete the ${kind} definition below`), `[${kind}] the type instruction routes for go`);
    assert.ok(prompt.includes("members"), `[${kind}] the member noun is "members"`);
    assert.ok(!prompt.includes("its fields"), `[${kind}] never Rust's "fields" noun`);
    assert.ok(!prompt.includes("variants"), `[${kind}] never Rust's "variants" noun`);
    assert.ok(!prompt.includes("impl blocks"), `[${kind}] never the Rust-only impl-blocks framing`);
  }
});

// ---------------------------------------------------------------------------
// 4. fileLocalDefinitionsFor("go") — the column-0 func/type scanner (row 10).
//    RED today: "go" currently scans nothing (empty Set).
// ---------------------------------------------------------------------------

// A gofmt-shaped source: column-0 func, method, type struct, type interface,
// var, const; an indented func literal; ghosts inside a comment and a string.
const GO_SOURCE = [
  "package atlas",
  "",
  'import "fmt"',
  "",
  "const MaxBands = 12",
  "",
  "var registry = map[string]Stripe{}",
  "",
  "type Stripe struct {",
  "\ttiles []Tile",
  "}",
  "",
  "type Banded interface {",
  "\tBands() []LodBand",
  "}",
  "",
  "func EnrollTile(s *Stripe, t Tile) error {",
  "\thandler := func(x Tile) bool {",
  "\t\treturn true",
  "\t}",
  "\t_ = handler",
  "\tfunc InnerGhost() {}",
  "\t// func CommentGhost() {}",
  '\tmsg := "type StringGhost struct"',
  "\tfmt.Println(msg)",
  "\treturn nil",
  "}",
  "",
  "func (s *Stripe) Reset() {",
  "}",
  "",
].join("\n");

gtest("fileLocalDefinitionsFor('go'): returns the top-level names — column-0 func and type names at minimum [surface: dispatch-map row 10 'goFileLocalDefinitions: column-0 func/type scanner']", () => {
  const defs = fileLocalDefinitionsFor("go", GO_SOURCE);
  assert.ok(defs instanceof Set, `the scan returns a Set (the Python sibling's shape); got ${Object.prototype.toString.call(defs)}`);
  assert.ok(defs.size > 0, "the Go scan is no longer the empty unregistered-language Set");
  for (const name of ["EnrollTile", "Stripe", "Banded"]) {
    assert.ok(defs.has(name), `top-level ${JSON.stringify(name)} is defined; got ${JSON.stringify([...defs])}`);
  }
});

gtest("fileLocalDefinitionsFor('go'): an indented func is not top-level; names inside strings and comments are not definitions [surface: row 10 'column-0' + the neutralize discipline every sibling scanner keeps]", () => {
  const defs = fileLocalDefinitionsFor("go", GO_SOURCE);
  // Anchor on a positive first, so an empty (unarmed) scan cannot pass these
  // negatives vacuously.
  assert.ok(defs.has("EnrollTile"), "the scan is armed (a column-0 func lands) before the negatives mean anything");
  assert.ok(!defs.has("InnerGhost"), "an indented (method-local) func is NOT a top-level definition");
  assert.ok(!defs.has("handler"), "a func-literal binding is not a func definition");
  assert.ok(!defs.has("CommentGhost"), "a func inside a // comment is prose, not a definition");
  assert.ok(!defs.has("StringGhost"), "a type inside a string literal is data, not a definition");
});
