// Blind oracle: session-v74 contract P1, "the head anchor reads past a
// qualifier" (session-v74/contracts/p1-head-anchor.md), rules 1-9 AS AMENDED
// by amendment 1 (visibility keywords only) and amendment 2 (the head is the
// qualifier run plus the cut of what remains). Every row below is a black-box
// assertion against the exported extractRequestedFunction. Written against the
// contract only; src/** was never read.
//
// Run: SKIP_LIVE=1 node --test test/blind-v74-p1-head-anchor.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v74-p1-head-anchor",
  `export { extractRequestedFunction } from "../src/core/instructPostprocess";\n`
);
const { extractRequestedFunction } = mod;
test.after(cleanup);

// Returns the first line of a result that must be defined. The failure message
// carries the whole call so a red row names the reply that produced it.
function headOf(out, what) {
  assert.ok(out !== undefined, `${what}: expected a head match, got undefined`);
  return out.text.split("\n")[0];
}

// ---------------------------------------------------------------------------
// Rule 1: identity. A head line that matches the signature head exactly returns
// exactly what it returns today.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 R1] identity: a single-line body, the function is the whole reply", () => {
  const reply = "fn f() -> u8 { 1 }";
  assert.deepEqual(extractRequestedFunction(reply, "fn f() -> u8"), {
    text: "fn f() -> u8 { 1 }",
    trimmedBefore: 0,
    trimmedAfter: 0,
  });
});

test("[BLIND-V74-P1 R1] identity: prose lines before and after the function", () => {
  const reply = "Sure, here you go:\n\nfn f() -> u8 {\n    1\n}\n\nHope that helps!";
  assert.deepEqual(extractRequestedFunction(reply, "fn f() -> u8"), {
    text: "fn f() -> u8 {\n    1\n}",
    trimmedBefore: 1,
    trimmedAfter: 1,
  });

  const oneLine = "Sure:\nfn f() -> u8 { 1 }\nDone.";
  assert.deepEqual(extractRequestedFunction(oneLine, "fn f() -> u8"), {
    text: "fn f() -> u8 { 1 }",
    trimmedBefore: 1,
    trimmedAfter: 1,
  });
});

test("[BLIND-V74-P1 R1] identity: the function is the only content", () => {
  const reply = "fn f() -> u8 {\n    1\n}";
  assert.deepEqual(extractRequestedFunction(reply, "fn f() -> u8"), {
    text: "fn f() -> u8 {\n    1\n}",
    trimmedBefore: 0,
    trimmedAfter: 0,
  });
});

test("[BLIND-V74-P1 R1] identity: an already-matching head is unmoved in every language, with and without languageId", () => {
  const rows = [
    ["rust", "fn foo(a: u8) -> u8 {\n    a\n}", "fn foo(a: u8) -> u8"],
    ["csharp", "int Foo(int a)\n{\n    return a;\n}", "int Foo(int a)"],
    [
      "typescript",
      "function foo(a: number): number {\n    return a;\n}",
      "function foo(a: number): number",
    ],
    ["python", "def f(a):\n    return a\n", "def f(a)"],
    ["go", "func F(a int) int {\n\treturn a\n}", "func F(a int) int"],
  ];
  for (const [lang, reply, signature] of rows) {
    const expected = { text: reply, trimmedBefore: 0, trimmedAfter: 0 };
    assert.deepEqual(
      extractRequestedFunction(reply, signature),
      expected,
      `${lang}: an exact head with languageId omitted must return the reply unchanged`
    );
    assert.deepEqual(
      extractRequestedFunction(reply, signature, lang),
      expected,
      `${lang}: passing languageId must not move an exact head`
    );
  }
});

test("[BLIND-V74-P1 R1] identity: a semantic qualifier on BOTH sides is still an exact match", () => {
  const rows = [
    ["rust", "async fn foo(a: u8) -> u8 {\n    a\n}", "async fn foo(a: u8) -> u8"],
    ["rust", "const unsafe fn foo(a: u8) -> u8 {\n    a\n}", "const unsafe fn foo(a: u8) -> u8"],
    ["python", "async def f(a):\n    return a\n", "async def f(a)"],
    [
      "typescript",
      "async function foo(a: number): Promise<number> {\n    return a;\n}",
      "async function foo(a: number): Promise<number>",
    ],
  ];
  for (const [lang, reply, signature] of rows) {
    assert.deepEqual(
      extractRequestedFunction(reply, signature, lang),
      { text: reply, trimmedBefore: 0, trimmedAfter: 0 },
      `${lang}: a semantic qualifier inside the anchor still matches itself`
    );
  }
});

// ---------------------------------------------------------------------------
// Rule 2 as amended by amendment 1: VISIBILITY keywords are read through, and
// nothing else is.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 R2] rust: a visibility keyword prefixed to the head is read through", () => {
  const signature = "fn foo(a: u8) -> u8";
  const body = "fn foo(a: u8) -> u8 {\n    a\n}";
  for (const q of ["pub", "pub(crate)", "pub(super)", "pub(in ::some::path)"]) {
    const out = extractRequestedFunction(`${q} ${body}`, signature, "rust");
    assert.ok(out !== undefined, `rust: '${q} fn foo(' must be found`);
    assert.equal(out.text, body, `rust: '${q}' must be dropped and the rest returned verbatim`);
  }
});

test("[BLIND-V74-P1 R2 + A1] rust: a semantic modifier is NOT read through, it is refused", () => {
  const signature = "fn foo(a: u8) -> u8";
  const body = "fn foo(a: u8) -> u8 {\n    a\n}";
  const modifiers = ["async", "unsafe", "const", "extern", 'extern "C"', "default"];
  for (const q of modifiers) {
    assert.equal(
      extractRequestedFunction(`${q} ${body}`, signature, "rust"),
      undefined,
      `rust: '${q}' decides whether the body compiles, so '${q} fn foo(' must be REFUSED against 'fn foo('`
    );
  }
  for (const q of modifiers) {
    assert.equal(
      extractRequestedFunction(`pub ${q} ${body}`, signature, "rust"),
      undefined,
      `rust: a visibility keyword in front of '${q}' does not make the modifier readable through`
    );
  }
});

test("[BLIND-V74-P1 R2] csharp: a visibility keyword prefixed to the head is read through", () => {
  const signature = "int Foo(int a)";
  const body = "int Foo(int a)\n{\n    return a;\n}";
  for (const q of ["public", "private", "protected", "internal", "protected internal"]) {
    const out = extractRequestedFunction(`${q} ${body}`, signature, "csharp");
    assert.ok(out !== undefined, `csharp: '${q} int Foo(' must be found`);
    assert.equal(out.text, body, `csharp: '${q}' must be dropped and the rest returned verbatim`);
  }
});

test("[BLIND-V74-P1 R2 + A1] csharp: a modifier is NOT read through, it is refused", () => {
  const signature = "int Foo(int a)";
  const body = "int Foo(int a)\n{\n    return a;\n}";
  const modifiers = [
    "static",
    "async",
    "virtual",
    "override",
    "sealed",
    "abstract",
    "partial",
    "unsafe",
    "extern",
    "new",
    "readonly",
  ];
  for (const q of modifiers) {
    assert.equal(
      extractRequestedFunction(`${q} ${body}`, signature, "csharp"),
      undefined,
      `csharp: '${q} int Foo(' must be REFUSED against 'int Foo('`
    );
    assert.equal(
      extractRequestedFunction(`public ${q} ${body}`, signature, "csharp"),
      undefined,
      `csharp: 'public ${q} int Foo(' must be REFUSED, the modifier is part of the identity`
    );
  }
});

test("[BLIND-V74-P1 R2] typescript: export is read through at a function head", () => {
  const signature = "function foo(a: number): number";
  const body = "function foo(a: number): number {\n    return a;\n}";
  const out = extractRequestedFunction(`export ${body}`, signature, "typescript");
  assert.ok(out !== undefined, "typescript: 'export function foo(' must be found");
  assert.equal(out.text, body, "typescript: 'export' must be dropped and the rest verbatim");
});

test("[BLIND-V74-P1 R2 + A1] typescript: declare, default, async and the member modifiers are refused", () => {
  const signature = "function foo(a: number): number";
  const body = "function foo(a: number): number {\n    return a;\n}";
  for (const q of ["declare", "async", "export default", "export async", "export declare"]) {
    assert.equal(
      extractRequestedFunction(`${q} ${body}`, signature, "typescript"),
      undefined,
      `typescript: '${q} function foo(' must be REFUSED, only visibility is read through`
    );
  }

  const memberSignature = "foo(a: number): number";
  const memberBody = "foo(a: number): number {\n    return a;\n}";
  for (const q of ["static", "override", "readonly", "abstract", "async", "public static"]) {
    assert.equal(
      extractRequestedFunction(`${q} ${memberBody}`, memberSignature, "typescript"),
      undefined,
      `typescript: '${q} foo(' must be REFUSED at a member head`
    );
  }
});

test("[BLIND-V74-P1 R2] typescript: public, private and protected are read through at a member head", () => {
  const signature = "foo(a: number): number";
  const body = "foo(a: number): number {\n    return a;\n}";
  for (const q of ["public", "private", "protected"]) {
    const out = extractRequestedFunction(`${q} ${body}`, signature, "typescript");
    assert.ok(out !== undefined, `typescript: '${q} foo(' must be found`);
    assert.equal(out.text, body, `typescript: '${q}' must be dropped and the rest verbatim`);
  }
});

test("[BLIND-V74-P1 R2] javascript and the react spellings share the typescript visibility set", () => {
  const signature = "function foo(a)";
  const body = "function foo(a) {\n    return a;\n}";
  for (const lang of ["javascript", "javascriptreact", "typescriptreact"]) {
    const out = extractRequestedFunction(`export ${body}`, signature, lang);
    assert.ok(out !== undefined, `${lang}: 'export function foo(' must be found`);
    assert.equal(out.text, body, `${lang}: 'export' must be dropped and the rest verbatim`);
    assert.equal(
      extractRequestedFunction(`async ${body}`, signature, lang),
      undefined,
      `${lang}: 'async function foo(' must be REFUSED, async is identity`
    );
  }
});

test("[BLIND-V74-P1 R2 + A1] python: nothing is read through, async def is refused", () => {
  const body = "def f(a):\n    return a\n";
  assert.equal(
    extractRequestedFunction(`async ${body}`, "def f(a)", "python"),
    undefined,
    "python: 'async def f(' against a 'def f(' signature must be REFUSED, splicing it back would be a SyntaxError"
  );
  for (const q of ["pub", "export", "public"]) {
    assert.equal(
      extractRequestedFunction(`${q} ${body}`, "def f(a)", "python"),
      undefined,
      `python: python has no visibility set, so '${q} def f(' must be REFUSED`
    );
  }
});

test("[BLIND-V74-P1 R2] go: there are no go qualifiers, a prefixed word is not a head", () => {
  const signature = "func F(a int) int";
  const body = "func F(a int) int {\n\treturn a\n}";
  assert.deepEqual(
    extractRequestedFunction(body, signature, "go"),
    { text: body, trimmedBefore: 0, trimmedAfter: 0 },
    "go: a bare func head is found, unchanged"
  );
  for (const q of ["async", "public", "pub", "export", "static"]) {
    assert.equal(
      extractRequestedFunction(`${q} ${body}`, signature, "go"),
      undefined,
      `go: '${q} func F(' must NOT be read as a head, go has no qualifier set`
    );
  }
});

// ---------------------------------------------------------------------------
// Amendment 1's identity property: a semantic qualifier is part of the
// function's identity, a visibility keyword is not.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 A1] rust: pub async fn foo against an async fn foo signature matches and keeps async", () => {
  const reply = "pub async fn foo(a: u8) -> u8 {\n    a\n}";
  const out = extractRequestedFunction(reply, "async fn foo(a: u8) -> u8", "rust");
  assert.equal(
    headOf(out, "A1 pub async against async"),
    "async fn foo(a: u8) -> u8 {",
    "A1: the visibility is stripped, the async stays because the document has it"
  );
  assert.equal(
    out.text,
    "async fn foo(a: u8) -> u8 {\n    a\n}",
    "A1: only the visibility run is removed"
  );
});

test("[BLIND-V74-P1 A1] rust: async fn foo against a fn foo signature is refused, async is identity", () => {
  assert.equal(
    extractRequestedFunction(
      "async fn foo(a: u8) -> u8 {\n    a.await\n}",
      "fn foo(a: u8) -> u8",
      "rust"
    ),
    undefined,
    "A1: stripping the async back off and splicing would be E0728, so the reply is refused instead"
  );
  assert.equal(
    extractRequestedFunction(
      "fn foo(a: u8) -> u8 {\n    a\n}",
      "async fn foo(a: u8) -> u8",
      "rust"
    ),
    undefined,
    "A1: the other direction too, a reply whose async differs from the document's is refused"
  );
});

// ---------------------------------------------------------------------------
// Rule 3 as amended: the drop direction covers visibility only.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 R3] rust: a reply that drops the signature's visibility run is still found", () => {
  const reply = "fn foo(a: u8) -> u8 {\n    a\n}";
  for (const run of ["pub", "pub(crate)", "pub(super)", "pub(in ::some::path)"]) {
    const out = extractRequestedFunction(reply, `${run} fn foo(a: u8) -> u8`, "rust");
    assert.ok(
      out !== undefined,
      `rust: signature '${run} fn foo(', reply head 'fn foo(' must be found`
    );
    assert.ok(out.text.includes("    a\n"), `rust: the body must come back with the head ('${run}')`);
  }

  const kept = extractRequestedFunction(
    "async fn foo(a: u8) -> u8 {\n    a\n}",
    "pub(crate) async fn foo(a: u8) -> u8",
    "rust"
  );
  assert.ok(
    kept !== undefined,
    "rust: dropping only the visibility from 'pub(crate) async fn foo(' is still a match"
  );
});

test("[BLIND-V74-P1 R3 + A1] csharp: dropping the visibility is found, dropping the whole run is the accepted loss", () => {
  const body = "int Foo(int a)\n{\n    return a;\n}";
  const out = extractRequestedFunction(body, "public int Foo(int a)", "csharp");
  assert.ok(out !== undefined, "csharp: signature 'public int Foo(', reply 'int Foo(' must be found");
  assert.ok(out.text.includes("    return a;"), "csharp: the body must come back with the head");

  const partial = extractRequestedFunction(
    "static int Foo(int a)\n{\n    return a;\n}",
    "public static int Foo(int a)",
    "csharp"
  );
  assert.ok(
    partial !== undefined,
    "csharp: a reply that drops only the visibility from 'public static int Foo(' is found"
  );

  assert.equal(
    extractRequestedFunction(body, "public static int Foo(int a)", "csharp"),
    undefined,
    "csharp A1: a reply that drops the WHOLE run off 'public static int Foo(' is refused, the named accepted loss"
  );
});

// ---------------------------------------------------------------------------
// Rule 4: the document wins the head. First line, byte for byte.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 R4] the measured case: a pub reply returns the document's unqualified first line", () => {
  const signature = "fn err_pool_timeout(&self, gate: &AtomicU64) -> ClientError";
  const reply =
    "pub fn err_pool_timeout(&self, gate: &AtomicU64) -> ClientError {\n" +
    "    gate.fetch_add(1, Ordering::Relaxed);\n" +
    "    ClientError::PoolTimeout { address: self.address.clone() }\n" +
    "}";
  const out = extractRequestedFunction(reply, signature, "rust");
  assert.equal(
    headOf(out, "R4 err_pool_timeout"),
    "fn err_pool_timeout(&self, gate: &AtomicU64) -> ClientError {",
    "R4: the first line carries the signature's (empty) qualifier run, and the rest of the line verbatim"
  );
  assert.equal(
    out.text,
    "fn err_pool_timeout(&self, gate: &AtomicU64) -> ClientError {\n" +
      "    gate.fetch_add(1, Ordering::Relaxed);\n" +
      "    ClientError::PoolTimeout { address: self.address.clone() }\n" +
      "}",
    "R4: every other line is returned verbatim"
  );
});

test("[BLIND-V74-P1 R4] leading whitespace on the head line is preserved when the visibility run is dropped", () => {
  const reply = "    pub fn foo(a: u8) -> u8 {\n        a\n    }";
  const out = extractRequestedFunction(reply, "fn foo(a: u8) -> u8", "rust");
  assert.equal(
    headOf(out, "R4 indented head"),
    "    fn foo(a: u8) -> u8 {",
    "R4: the reply's indentation survives, the reply's visibility run does not"
  );
  assert.equal(
    out.text,
    "    fn foo(a: u8) -> u8 {\n        a\n    }",
    "R4: the indented body is returned verbatim"
  );
});

test("[BLIND-V74-P1 R4] a dropped visibility is put back: the signature's run is written onto the head", () => {
  const reply = "fn foo(a: u8) -> u8 {\n    a\n}";
  for (const run of ["pub", "pub(crate)", "pub(super)", "pub(in ::some::path)"]) {
    const out = extractRequestedFunction(reply, `${run} fn foo(a: u8) -> u8`, "rust");
    assert.equal(
      headOf(out, `R4 dropped visibility '${run}'`),
      `${run} fn foo(a: u8) -> u8 {`,
      `R4: the document's visibility run wins, so the head comes back with '${run}'`
    );
  }
});

test("[BLIND-V74-P1 R4] a model cannot raise visibility: public on a private csharp signature is discarded", () => {
  const out = extractRequestedFunction(
    "public int Foo(int a)\n{\n    return a;\n}",
    "private int Foo(int a)",
    "csharp"
  );
  assert.equal(
    headOf(out, "R4 csharp visibility"),
    "private int Foo(int a)",
    "R4: the signature says private, so the returned head says private"
  );
});

test("[BLIND-V74-P1 R4] every other line is verbatim: blank lines, tabs and trailing spaces survive", () => {
  const body = "fn foo(a: u8) -> u8 {\n\tlet b = a;   \n\n\tb\n}";
  const out = extractRequestedFunction(`pub ${body}`, "fn foo(a: u8) -> u8", "rust");
  assert.ok(out !== undefined, "R4: the pub head must be found");
  assert.equal(out.text, body, "R4: nothing but the visibility run is touched");
});

// ---------------------------------------------------------------------------
// Rule 5: whole words only, and a qualifier is followed by whitespace.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 R5] rust: pubfn is not pub, it is refused", () => {
  assert.equal(
    extractRequestedFunction("pubfn foo(a: u8) -> u8 {\n    a\n}", "fn foo(a: u8) -> u8", "rust"),
    undefined,
    "R5: 'pubfn' is one word and is not a qualifier run"
  );
  assert.equal(
    extractRequestedFunction("publicfn foo(a: u8) -> u8 {\n    a\n}", "fn foo(a: u8) -> u8", "rust"),
    undefined,
    "R5: 'publicfn' is one word and is not a qualifier run"
  );
});

test("[BLIND-V74-P1 R5] rust: a method literally named new keeps matching", () => {
  const reply = "new(name: String) -> Self {\n    Self { name }\n}";
  const out = extractRequestedFunction(reply, "new(name: String) -> Self", "rust");
  assert.ok(out !== undefined, "R5: 'new(' is not followed by whitespace, so it is not a qualifier");
  assert.equal(out.text, reply, "R5: the new() method comes back whole and unchanged");

  const shorter = "new(String) -> Self {\n    todo!()\n}";
  const out2 = extractRequestedFunction(shorter, "new(name: String) -> Self", "rust");
  assert.ok(out2 !== undefined, "R5: the anchor is 'new(' and the reply head starts with it");
  assert.equal(out2.text, shorter, "R5: the reply comes back whole");
});

test("[BLIND-V74-P1 R5 + A1] csharp: a 'new Cache(0);' continuation line cannot steal the anchor", () => {
  // Positive control: the constructor signature does find its own head, so the
  // two refusals below are refusals and not a dead fixture.
  const ctor = extractRequestedFunction(
    "Cache(int capacity)\n{\n    _cap = capacity;\n}",
    "public Cache(int capacity)",
    "csharp"
  );
  assert.equal(
    headOf(ctor, "R5 ctor control"),
    "public Cache(int capacity)",
    "control: the constructor head is found and re-qualified from the document"
  );

  assert.equal(
    extractRequestedFunction("new Cache(0);", "public Cache(int capacity)", "csharp"),
    undefined,
    "A1: 'new' left the read-through set, so a construction line is not a head for 'Cache('"
  );
  assert.equal(
    extractRequestedFunction(
      "static Cache()\n{\n    Shared = new Cache(0);\n}",
      "public Cache(int capacity)",
      "csharp"
    ),
    undefined,
    "A1: 'static' left the set too, so a static constructor is not a head for 'Cache('"
  );
});

test("[BLIND-V74-P1 R5] python: asyncdef is not async, it is refused", () => {
  assert.equal(
    extractRequestedFunction("asyncdef f(a):\n    return a\n", "async def f(a)", "python"),
    undefined,
    "R5: 'asyncdef' is one word, it is not the 'async def' head"
  );
});

// ---------------------------------------------------------------------------
// Rule 6: a comment is not a head.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 R6] rust: a commented-out head is not a head", () => {
  assert.equal(
    extractRequestedFunction("// fn foo(a: u8) -> u8 {\n//     a\n// }", "fn foo(a: u8) -> u8", "rust"),
    undefined,
    "R6: '// fn foo(' is a comment, not a head"
  );
  assert.equal(
    extractRequestedFunction(
      "/// fn foo(a: u8) -> u8 returns a\n/// and nothing else\n",
      "fn foo(a: u8) -> u8",
      "rust"
    ),
    undefined,
    "R6: '/// fn foo(' is a doc comment, not a head"
  );
  assert.equal(
    extractRequestedFunction(
      "// pub fn foo(a: u8) -> u8 {\n//     a\n// }",
      "fn foo(a: u8) -> u8",
      "rust"
    ),
    undefined,
    "R6: widening the visibility run must not turn a commented head into a head"
  );
});

test("[BLIND-V74-P1 R6] python: a hashed-out def is not a head", () => {
  assert.equal(
    extractRequestedFunction("# def f(a):\n#     return a\n", "def f(a)", "python"),
    undefined,
    "R6: '# def f(' is a comment, not a head"
  );
  assert.equal(
    extractRequestedFunction("# async def f(a):\n#     return a\n", "async def f(a)", "python"),
    undefined,
    "R6: a commented async def is still a comment"
  );
});

// ---------------------------------------------------------------------------
// Rule 7 as amended: type headers get the same VISIBILITY tolerance, and the
// prefix guard survives.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 R7] rust: pub struct Cache against signature struct Cache is found, unqualified", () => {
  const out = extractRequestedFunction(
    "pub struct Cache {\n    a: u8,\n}",
    "struct Cache",
    "rust"
  );
  assert.ok(out !== undefined, "R7: a type header tolerates a prepended pub");
  assert.equal(
    out.text,
    "struct Cache {\n    a: u8,\n}",
    "R7 + R4: the document's visibility run wins on a type header too"
  );
});

test("[BLIND-V74-P1 R7] rust: the prefix guard survives, CacheEntry is not Cache", () => {
  assert.equal(
    extractRequestedFunction("pub struct CacheEntry {\n    a: u8,\n}", "pub struct Cache", "rust"),
    undefined,
    "R7: 'pub struct CacheEntry' must stay refused against signature 'pub struct Cache'"
  );
  assert.equal(
    extractRequestedFunction("pub struct CacheEntry {\n    a: u8,\n}", "struct Cache", "rust"),
    undefined,
    "R7: reading past the visibility must not open the prefix guard in the other direction"
  );
});

test("[BLIND-V74-P1 R7 + A1] csharp: a class header tolerates public, and sealed is not read through", () => {
  const out = extractRequestedFunction(
    "public class Cache\n{\n    int a;\n}",
    "class Cache",
    "csharp"
  );
  assert.ok(out !== undefined, "R7: a csharp class header tolerates a visibility keyword");
  assert.equal(
    out.text,
    "class Cache\n{\n    int a;\n}",
    "R7 + R4: the signature's visibility run wins on the class header"
  );

  assert.equal(
    extractRequestedFunction(
      "public sealed class Cache\n{\n    int a;\n}",
      "class Cache",
      "csharp"
    ),
    undefined,
    "A1: 'sealed' left the set, so 'public sealed class Cache' is refused against 'class Cache'"
  );
});

// ---------------------------------------------------------------------------
// Rule 8: refusal survives.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 R8] a reply implementing a different function is still refused", () => {
  assert.equal(
    extractRequestedFunction("fn other(a: u8) -> u8 {\n    a\n}", "fn foo(a: u8) -> u8", "rust"),
    undefined,
    "R8: no head line for the requested function means undefined"
  );
  assert.equal(
    extractRequestedFunction("pub fn other(a: u8) -> u8 {\n    a\n}", "fn foo(a: u8) -> u8", "rust"),
    undefined,
    "R8: reading past a visibility keyword must not turn a different function into a match"
  );
});

test("[BLIND-V74-P1 R8] a reply with no code at all is still refused", () => {
  assert.equal(
    extractRequestedFunction(
      "I cannot implement that without seeing the ClientError type.",
      "fn foo(a: u8) -> u8",
      "rust"
    ),
    undefined,
    "R8: prose only means undefined"
  );
  assert.equal(
    extractRequestedFunction("", "fn foo(a: u8) -> u8", "rust"),
    undefined,
    "R8: an empty reply means undefined"
  );
});

test("[BLIND-V74-P1 R8] the measured wrong answer, impl ClientError from_error_response, is still refused", () => {
  const reply =
    "impl ClientError {\n" +
    "    pub fn from_error_response(e: ErrorResponse) -> Self {\n" +
    "        Self::Other\n" +
    "    }\n" +
    "}";
  assert.equal(
    extractRequestedFunction(
      reply,
      "fn err_pool_timeout(&self, gate: &AtomicU64) -> ClientError",
      "rust"
    ),
    undefined,
    "R8: the v74 wrong-function reply must remain a refusal after the widening"
  );
});

// ---------------------------------------------------------------------------
// Rule 9: qualifier runs are only read at the START of the trimmed line.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 R9] nothing later in the line is stripped", () => {
  const out = extractRequestedFunction(
    "pub fn foo(a: u8) -> &'static str {\n    \"x\"\n}",
    "fn foo(a: u8) -> &'static str",
    "rust"
  );
  assert.equal(
    headOf(out, "R9 later-in-line"),
    "fn foo(a: u8) -> &'static str {",
    "R9: only the leading run is dropped, the later 'static is untouched"
  );

  const cs = extractRequestedFunction(
    "public Task<int> Foo(int a, string @public)\n{\n    return a;\n}",
    "Task<int> Foo(int a, string @public)",
    "csharp"
  );
  assert.equal(
    headOf(cs, "R9 later-in-line csharp"),
    "Task<int> Foo(int a, string @public)",
    "R9: a visibility word later in the line is part of the signature, not a run"
  );
});

test("[BLIND-V74-P1 R9] a line that begins with neither a qualifier nor the anchor is not a head", () => {
  assert.equal(
    extractRequestedFunction("impl Foo { pub fn foo(a: u8) -> u8 { 1 } }", "fn foo(a: u8) -> u8", "rust"),
    undefined,
    "R9: the trimmed line starts with 'impl', which is neither a qualifier nor the anchor"
  );
  assert.equal(
    extractRequestedFunction(
      "let g = |a: u8| pub fn foo(a: u8) -> u8 { 1 };",
      "fn foo(a: u8) -> u8",
      "rust"
    ),
    undefined,
    "R9: a visibility run buried mid-line does not make the line a head"
  );
  assert.equal(
    extractRequestedFunction("pub fn bar(a: u8) -> u8 {\n    a\n}", "fn foo(a: u8) -> u8", "rust"),
    undefined,
    "R9: reading past the visibility still has to land on the anchor"
  );
});

// ---------------------------------------------------------------------------
// Amendment 2: the head is the qualifier run plus the cut of what remains, so
// a parenthesised visibility no longer leaves the anchor at 'pub('.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 A2] rust: a pub(crate) signature does not anchor on an unrelated pub(crate) item", () => {
  const reply = "pub(crate) struct Other;\n\npub(crate) fn foo(a: u8) -> u8 {\n    a\n}";
  const out = extractRequestedFunction(reply, "pub(crate) fn foo(a: u8) -> u8", "rust");
  assert.ok(out !== undefined, "A2: the function itself is still found");
  assert.equal(
    out.text,
    "pub(crate) fn foo(a: u8) -> u8 {\n    a\n}",
    "A2: the anchor is no longer the bare 'pub(', so the struct is not swallowed into the span"
  );
  assert.ok(
    !out.text.includes("struct Other"),
    "A2: an unrelated pub(crate) item must never be spliced into the function's span"
  );
});

test("[BLIND-V74-P1 A2] rust: a pub(crate) signature is refused when the reply holds only another pub(crate) item", () => {
  assert.equal(
    extractRequestedFunction(
      "pub(crate) struct Other;\n",
      "pub(crate) fn foo(a: u8) -> u8",
      "rust"
    ),
    undefined,
    "A2: a longer anchor can only refuse what the 'pub(' anchor used to accept"
  );
  assert.equal(
    extractRequestedFunction(
      "pub(super) fn other(a: u8) -> u8 {\n    a\n}",
      "pub(crate) fn foo(a: u8) -> u8",
      "rust"
    ),
    undefined,
    "A2: a different pub(...) function is not the requested one"
  );
});

// ---------------------------------------------------------------------------
// Surface: languageId is optional, and omitting it is the union of every
// language's VISIBILITY set.
// ---------------------------------------------------------------------------

test("[BLIND-V74-P1 surface] omitting languageId behaves as the union of the visibility sets", () => {
  const signature = "fn foo(a: u8) -> u8";
  const body = "fn foo(a: u8) -> u8 {\n    a\n}";
  for (const q of ["pub", "pub(crate)", "export", "internal", "public", "protected", "private"]) {
    const out = extractRequestedFunction(`${q} ${body}`, signature);
    assert.ok(
      out !== undefined,
      `union: '${q}' is a visibility keyword in some language, so it is read through`
    );
    assert.equal(out.text, body, `union: '${q}' is dropped and the rest returned verbatim`);
  }
  for (const q of ["async", "static", "declare", "sealed", "unsafe", "partial"]) {
    assert.equal(
      extractRequestedFunction(`${q} ${body}`, signature),
      undefined,
      `union: '${q}' is in no visibility set, so the fallback must refuse it too`
    );
  }
});

test("[BLIND-V74-P1 surface] passing languageId narrows the set to that language", () => {
  assert.equal(
    extractRequestedFunction(
      "export fn foo(a: u8) -> u8 {\n    a\n}",
      "fn foo(a: u8) -> u8",
      "rust"
    ),
    undefined,
    "surface: 'export' is a typescript visibility keyword and is not in rust's set"
  );
  assert.equal(
    extractRequestedFunction("pub def f(a):\n    return a\n", "def f(a)", "python"),
    undefined,
    "surface: python has no visibility set, 'pub' is not in it"
  );
});
