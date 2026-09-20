// Implementer oracle, session-v74 phase 1: the qualifier leg on the
// head-anchored trim, white-box.
//
// The blind file binds session-v74/contracts/p1-head-anchor.md. What it cannot
// see from the contract alone:
//   * the TWO-PASS ordering. Pass 1 is today's exact anchor over the whole
//     reply and pass 2 only runs when pass 1 found nothing, which is what makes
//     rule 1 (identity) free rather than argued;
//   * check-before-strip at every depth, the thing that keeps a Rust method
//     literally named `new` matching while `new` is a C# modifier in the union
//     set;
//   * the alias table: javascript / javascriptreact / typescriptreact share the
//     typescript set, and an UNKNOWN language falls back to the union rather
//     than to empty;
//   * the two qualifier spellings that carry an argument, `pub(crate)` and
//     `extern "C"`;
//   * the real refused reply from the scout (session-v74/spikes), end to end
//     through postprocess.
//
// Run: SKIP_LIVE=1 node --test test/impl-v74-p1-head-anchor.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v74-p1",
  `export { extractRequestedFunction, postprocessInstructOutput } from "../src/core/instructPostprocess";
export { FnGenService } from "../src/core/fnGenService";\n`
);
const { extractRequestedFunction, postprocessInstructOutput, FnGenService } = mod;
test.after(cleanup);

// ---- pass ordering

test("[IMPL-V74-P1 1] pass 1 wins over the whole reply: an exact head LATER beats a qualified head EARLIER", () => {
  // `pub fn foo(` on line 0 would match under the tolerant pass. The exact
  // `fn foo(` on line 4 must win, because pass 1 runs to completion first.
  const reply = [
    "pub fn foo(a: u8) -> u8 {",
    "    a",
    "}",
    "",
    "fn foo(a: u8) -> u8 {",
    "    a + 1",
    "}",
  ].join("\n");
  const ex = extractRequestedFunction(reply, "fn foo(a: u8) -> u8", "rust");
  assert.equal(ex.text.split("\n")[0], "fn foo(a: u8) -> u8 {");
  assert.equal(ex.text.includes("a + 1"), true);
  assert.equal(ex.trimmedBefore, 3);
});

test("[IMPL-V74-P1 2] pass 2 never rewrites a line pass 1 matched: bytes are returned untouched", () => {
  const reply = "  pub fn foo(a: u8) -> u8 {\n    a\n  }";
  // Signature already carries `pub`, so pass 1 matches and the odd indent and
  // the two-space closing brace come back exactly as written.
  const ex = extractRequestedFunction(reply, "pub fn foo(a: u8) -> u8", "rust");
  assert.equal(ex.text, reply);
});

// ---- check-before-strip

test("[IMPL-V74-P1 3] a method named `new` anchors at depth 0 under the UNION set", () => {
  // `new` is a C# modifier. With no languageId the union applies, and a greedy
  // strip would eat the method's own name.
  const reply = "new(String, Arc<PoolOptions>) -> Self {\n    todo\n}";
  const ex = extractRequestedFunction(reply, "new(String, Arc<PoolOptions>) -> Self");
  assert.notEqual(ex, undefined);
  assert.equal(ex.text.split("\n")[0], "new(String, Arc<PoolOptions>) -> Self {");
});

test("[IMPL-V74-P1 4] `static` as a C# method name still anchors before it is stripped", () => {
  const reply = "static(int x) {\n    return x;\n}";
  const ex = extractRequestedFunction(reply, "static(int x)", "csharp");
  assert.notEqual(ex, undefined);
  assert.equal(ex.text.split("\n")[0], "static(int x) {");
});

// ---- qualifier spellings that carry an argument

test("[IMPL-V74-P1 5] `pub(crate)` is one qualifier, argument included", () => {
  const ex = extractRequestedFunction("pub(crate) fn foo(a: u8) {\n    ()\n}", "fn foo(a: u8)", "rust");
  assert.equal(ex.text.split("\n")[0], "fn foo(a: u8) {");
});

test("[IMPL-V74-P1 6] `pub(in ::a::b)` is one qualifier", () => {
  const ex = extractRequestedFunction("pub(in ::a::b) fn foo(a: u8) {\n    ()\n}", "fn foo(a: u8)", "rust");
  assert.equal(ex.text.split("\n")[0], "fn foo(a: u8) {");
});

test("[IMPL-V74-P1 7] `extern \"C\"` stays INSIDE the anchor; the `pub` in front of it does not", () => {
  // The string-literal branch of the strip regex is still there, and this is
  // what keeps it honest: `extern "C"` is part of what the function IS, so it
  // has to survive into the anchor while the visibility in front of it comes
  // off. A reply that invents `extern "C"` the document never had is refused.
  const ex = extractRequestedFunction(
    'pub extern "C" fn foo(a: u8) {\n    ()\n}',
    'extern "C" fn foo(a: u8)',
    "rust"
  );
  assert.equal(ex.text.split("\n")[0], 'extern "C" fn foo(a: u8) {');
  assert.equal(
    extractRequestedFunction('pub extern "C" fn foo(a: u8) {\n    ()\n}', "fn foo(a: u8)", "rust"),
    undefined
  );
});

test("[IMPL-V74-P1 8] one visibility word comes off a run; the modifiers behind it stay", () => {
  const reply = "public static async Task<int> Foo(int x)\n{\n    return x;\n}";
  const ex = extractRequestedFunction(reply, "static async Task<int> Foo(int x)", "csharp");
  assert.equal(ex.text.split("\n")[0], "static async Task<int> Foo(int x)");
  // And the same reply against a signature with NO modifiers is refused: the
  // `static async` is the model's invention and would not compile as written.
  assert.equal(extractRequestedFunction(reply, "Task<int> Foo(int x)", "csharp"), undefined);
});

// ---- language routing

test("[IMPL-V74-P1 9] javascript, javascriptreact and typescriptreact share the typescript set", () => {
  for (const lang of ["javascript", "javascriptreact", "typescriptreact", "typescript"]) {
    const ex = extractRequestedFunction(
      "export async function foo(a) {\n  return a;\n}",
      "async function foo(a)",
      lang
    );
    assert.notEqual(ex, undefined, lang);
    assert.equal(ex.text.split("\n")[0], "async function foo(a) {", lang);
  }
});

test("[IMPL-V74-P1 10] an UNKNOWN languageId falls back to the union, not to empty", () => {
  const ex = extractRequestedFunction("public fn foo(a) {\n  a\n}", "fn foo(a)", "brainfuck");
  assert.notEqual(ex, undefined);
  assert.equal(ex.text.split("\n")[0], "fn foo(a) {");
});

test("[IMPL-V74-P1 11] go has an EMPTY set: `pub func` is not a go head", () => {
  const ex = extractRequestedFunction("pub func Foo(a int) int {\n\treturn a\n}", "func Foo(a int) int", "go");
  assert.equal(ex, undefined);
});

test("[IMPL-V74-P1 12] python reads through NOTHING: it has no visibility keyword", () => {
  // `async` used to be here and the cost was a spliced `def fetch(self):` over
  // a body that awaits. Python's own SyntaxError, written by us.
  assert.equal(extractRequestedFunction("async def foo(a):\n    return a", "def foo(a)", "python"), undefined);
  assert.equal(extractRequestedFunction("export def foo(a):\n    return a", "def foo(a)", "python"), undefined);
  // The exact-match path is untouched.
  const ex = extractRequestedFunction("async def foo(a):\n    return a", "async def foo(a)", "python");
  assert.equal(ex.text.split("\n")[0], "async def foo(a):");
});

// ---- the real reply the scout captured

test("[IMPL-V74-P1 13] the refused celeriant reply extracts, and loses the `pub` it invented", () => {
  const file = path.join(__dirname, "..", "session-v74", "spikes", "v_noonly.txt.rep2.out");
  if (!fs.existsSync(file)) {
    return; // spikes are gitignored; the row is a no-op on a clean checkout
  }
  const text = postprocessInstructOutput(fs.readFileSync(file, "utf8"));
  assert.equal(text.startsWith("pub fn err_pool_timeout("), true, "fixture drifted");
  const ex = extractRequestedFunction(text, "fn err_pool_timeout(&self, gate: &AtomicU64) -> ClientError", "rust");
  assert.notEqual(ex, undefined);
  assert.equal(ex.text.split("\n")[0], "fn err_pool_timeout(&self, gate: &AtomicU64) -> ClientError {");
  assert.equal(ex.text.includes("ClientError::PoolTimeout"), true);
});

// ---- the guard the trim exists to be

test("[IMPL-V74-P1 14] the wrong-function reply is STILL refused after the widening", () => {
  const reply = [
    "impl ClientError {",
    "    pub fn from_error_response(error_response: ErrorResponse) -> Self {",
    "        ClientError::ProtocolError",
    "    }",
    "}",
  ].join("\n");
  const ex = extractRequestedFunction(reply, "fn err_pool_timeout(&self, gate: &AtomicU64) -> ClientError", "rust");
  assert.equal(ex, undefined);
});

test("[IMPL-V74-P1 15] a qualified SIBLING whose name extends the target does not steal the anchor", () => {
  const ex = extractRequestedFunction("pub fn foo_inner(a: u8) {\n    ()\n}", "fn foo(a: u8)", "rust");
  assert.equal(ex, undefined);
});

// ---- the pre-existing bug the qualifier work exposed (contract amendment 2)

test("[IMPL-V74-P1 16] a `pub(crate)` signature no longer anchors on an unrelated `pub(crate)` item", () => {
  // The head used to be the raw signature cut at its FIRST paren, which for
  // `pub(crate) fn foo(a)` is the anchor `pub(`. Everything spelled
  // `pub(crate)` matched it. This reply used to come back starting at the
  // struct, which then went into the function's span.
  const reply = "pub(crate) struct Other;\n\npub(crate) fn foo(a: u8) -> u8 {\n    a\n}";
  const ex = extractRequestedFunction(reply, "pub(crate) fn foo(a: u8) -> u8", "rust");
  assert.equal(ex.text, "pub(crate) fn foo(a: u8) -> u8 {\n    a\n}");
  assert.equal(ex.trimmedBefore, 1);
});

test("[IMPL-V74-P1 17] a `pub(crate)` type header routes through the boundary guard", () => {
  // Same cut, one branch over: `pub(crate) struct Cache` used to reduce to the
  // anchor `pub(`, which is the paren branch, which has no prefix guard at all.
  assert.equal(
    extractRequestedFunction("pub(crate) struct CacheEntry {\n}", "pub(crate) struct Cache", "rust"),
    undefined
  );
  const ex = extractRequestedFunction("pub(crate) struct Cache {\n}", "pub(crate) struct Cache", "rust");
  assert.equal(ex.text.split("\n")[0], "pub(crate) struct Cache {");
});

// ---- line endings (adversarial review finding 4)

test("[IMPL-V74-P1 18] a CRLF reply keeps its `\\r` on the REWRITTEN head line", () => {
  // The service normalises EOL before the trim, so the product never produced
  // this. The harnesses that call the extractor directly do not, and a mixed
  // ending on one line is an artifact the product cannot make - every number
  // derived from it would be about the harness.
  const ex = extractRequestedFunction("pub fn foo(a: u8) -> u8 {\r\n    a\r\n}\r", "fn foo(a: u8) -> u8", "rust");
  assert.equal(ex.text, "fn foo(a: u8) -> u8 {\r\n    a\r\n}\r");
});

// ---- the set itself

test("[IMPL-V74-P1 19] not one SEMANTIC qualifier is read through, in any language", () => {
  // A guard on the set, not on one reply. Widening this table back is how the
  // E0728 / SyntaxError / CS4032 splices come back, and they came back from a
  // table edit the first time.
  const semantic = {
    rust: ["async", "unsafe", "const", "extern", "default"],
    csharp: ["static", "async", "virtual", "override", "sealed", "abstract", "partial", "unsafe", "new", "readonly"],
    typescript: ["default", "declare", "abstract", "async", "static", "override", "readonly"],
    python: ["async"],
    go: ["async"],
  };
  // `public` is deliberately NOT in the go row. Go's own set is empty and
  // refuses it, but the UNION fallback is a union of VISIBILITY words, so a
  // round that reached the trim with no languageId reads it through. That is
  // the declared cost of the fallback, not a leak, and it is why finding 1 -
  // languageId never reaching the trim - had to be fixed as well.
  const head = { rust: "fn foo(a: u8)", csharp: "int Foo(int a)", typescript: "function foo(a)", python: "def foo(a)", go: "func Foo(a int)" };
  for (const [lang, words] of Object.entries(semantic)) {
    for (const word of words) {
      const reply = `${word} ${head[lang]} {\n}`;
      assert.equal(
        extractRequestedFunction(reply, head[lang], lang),
        undefined,
        `${lang} read through \`${word}\``
      );
      // And the union fallback does not read it through either: every word in
      // the union is a visibility keyword, so no semantic one can enter by it.
      assert.equal(extractRequestedFunction(reply, head[lang]), undefined, `union read through \`${word}\``);
    }
  }
});

test("[IMPL-V74-P1 20] go refuses a visibility word it was NAMED for, and reads it through when it was not", () => {
  // Both halves of the languageId fix in one row. Go capitalises a name to
  // export it and has no visibility keyword, so `public func Foo(` is not a go
  // head. Reached with no languageId at all, the union strips it - which is
  // exactly what shipped for every function-shape round until the request
  // literal started carrying the language.
  const reply = "public func Foo(a int) int {\n\treturn a\n}";
  assert.equal(extractRequestedFunction(reply, "func Foo(a int) int", "go"), undefined);
  assert.notEqual(extractRequestedFunction(reply, "func Foo(a int) int"), undefined);
});

// ---- the seam the unit rows above could not see (adversarial review finding 1)

test("[IMPL-V74-P1 21] the language reaches the trim through the real service", () => {
  // EVERY row above calls the trim directly, and the trim was correct in all of
  // them while the product ran the cross-language union on 100% of rounds: the
  // `run()` request literal did not carry `languageId`. A green unit file is
  // not evidence that a per-language table is alive. This row drives the real
  // FnGenService with an injected generate fn, which is the only place the
  // wiring shows.
  const cfg = {
    apiBase: "http://127.0.0.1:1", // never reached: generate is injected
    model: "fake-30b",
    fallbackModel: "fake-14b",
    maxTokens: 128,
    temperature: 0.2,
  };
  const reply = (text) => async () => ({ text, ttftMs: 1, totalMs: 2 });

  // Go has no visibility keyword, so a `public func` reply is not the requested
  // function and the service must refuse it.
  const go = new FnGenService(cfg, reply("```go\nexport func Foo(a int) int {\n\treturn a\n}\n```"));
  return go
    .generate({ signature: "func Foo(a int) int", languageId: "go" })
    .then(
      () => assert.fail("the go round accepted a reply with an invented keyword on its head"),
      (err) => assert.match(String(err), /does not contain the requested function/)
    )
    .then(() => {
      // And the visibility case the phase exists for still gets through, with
      // the document's own head rather than the model's.
      const rust = new FnGenService(cfg, reply("```rust\npub fn foo(a: u8) -> u8 {\n    a\n}\n```"));
      return rust.generate({ signature: "fn foo(a: u8) -> u8", languageId: "rust" });
    })
    .then((res) => assert.equal(res.text.split("\n")[0], "fn foo(a: u8) -> u8 {"));
});
