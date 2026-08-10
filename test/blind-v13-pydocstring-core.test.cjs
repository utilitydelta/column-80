// BLIND ORACLE — v13 (Python docstring-is-the-spec), PURE CORE surfaces. Three
// contracts, all black-box from session-v13/goal.md + session-v13/scout.md ONLY.
// Never reads src/**; esbuild resolves modules at bundle time only.
//
//   #1  pyLeadingDocstring(spanText) — a NEW pure core helper (Fork A's detector).
//       Locates the leading docstring's [start,end) inside a def/class SPAN TEXT
//       (headStart..range.end, no leading indent — begins at `def`/`class`), and
//       whether it sits on the header's physical line. undefined when the first
//       body statement is not a string. Every row of scout.md's edge table below.
//
//   #2  stripPyDocstring(literal) — a NEW pure core helper. The docstring's INNER
//       text for the PROMPT: quotes + r/f/b prefix stripped, PEP-257 dedented.
//       The BUFFER docstring stays byte-exact and SEPARATE (Fork A keeps it out
//       of the span); this cleaned form is ONLY what the model reads.
//
//   #3  assembleFnGenPrompt bodyOnly variant — when generating BELOW a preserved
//       docstring the prompt must instruct BODY-ONLY output. New optional signal
//       `bodyOnly?: boolean` on FnGenPromptInput. bodyOnly false/omitted is
//       byte-identical to today (FROZEN); a Rust/Python non-bodyOnly render must
//       not be perturbed.
//
// ============================ ASSUMED SURFACE (PIN) ==========================
// The implementer MUST conform to these names/signatures (or negotiate a rename
// as a recorded supersession — never a quiet edit to make a test pass):
//
//   src/core/pyExtraction.ts:
//     export function pyLeadingDocstring(spanText: string):
//       { start: number; end: number; sameLineAsHeader: boolean } | undefined
//     export function stripPyDocstring(literal: string): string
//       // `literal` is the raw docstring text pyLeadingDocstring sliced out
//       // (quotes + any r/f/b prefix INCLUDED). Returns quotes+prefix stripped,
//       // PEP-257 dedented inner prose.
//
//   src/core/prompt.ts  (FnGenPromptInput):
//     bodyOnly?: boolean   // true => "write the body below the shown header/
//                          // docstring; OUTPUT ONLY THE BODY".
// ============================================================================
//
// RED today: pyExtraction helpers do not exist (bundle B fails -> those tests
// skip behind one loud guard); assembleFnGenPrompt exists (bundle A builds) so
// the bodyOnly routing tests RUN and FAIL red, while the FROZEN + no-op pins run
// GREEN. A red FROZEN guard = this file mismodelled current bytes; fix the guard.
//
// Run: SKIP_LIVE=1 node --test test/blind-v13-pydocstring-core.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// --- Bundle A: the prompt surface (exists today, builds GREEN) --------------
let promptMod = {};
let promptErr;
let cleanupA = () => {};
try {
  const b = bundleCore(
    "blind-v13-pydoc-prompt",
    `export { assembleFnGenPrompt } from "../src/core/prompt";\n`,
  );
  promptMod = b.mod;
  cleanupA = b.cleanup;
} catch (e) {
  promptErr = e;
}

// --- Bundle B: the two NEW pyExtraction helpers (RED until they land) --------
let pyMod = {};
let pyErr;
let cleanupB = () => {};
try {
  const b = bundleCore(
    "blind-v13-pydoc-pyextraction",
    `export { pyLeadingDocstring, stripPyDocstring } from "../src/core/pyExtraction";\n`,
  );
  pyMod = b.mod;
  cleanupB = b.cleanup;
} catch (e) {
  pyErr = e;
}

test.after(() => {
  cleanupA();
  cleanupB();
});

const { assembleFnGenPrompt } = promptMod;
const { pyLeadingDocstring, stripPyDocstring } = pyMod;

// Skip (not fail) a body when its bundle is broken, so a RED run is one loud
// guard failure per surface rather than a wall of TypeErrors.
const ptest = (name, fn) =>
  test(name, (ctx) => {
    if (promptErr) return ctx.skip(`prompt surface bundle failed: ${promptErr.message}`);
    return fn(ctx);
  });
const pytest = (name, fn) =>
  test(name, (ctx) => {
    if (pyErr) return ctx.skip(`pyExtraction surface bundle failed (helpers not implemented yet): ${pyErr.message}`);
    return fn(ctx);
  });

// ===========================================================================
// #1 — pyLeadingDocstring(spanText). RED until the detector lands.
// ===========================================================================

test("bundle guard: pyExtraction exports pyLeadingDocstring + stripPyDocstring [surface: two NEW pure helpers]", () => {
  if (pyErr) assert.fail(`pyExtraction helpers not implemented yet: ${pyErr.message}`);
  assert.strictEqual(typeof pyLeadingDocstring, "function", 'pyLeadingDocstring(spanText) not exported (assumed name — see PIN)');
  assert.strictEqual(typeof stripPyDocstring, "function", 'stripPyDocstring(literal) not exported (assumed name — see PIN)');
});

// A multi-line PEP-257 docstring literal reused by the detector (#1 row 10) and
// the cleaner (#2). Summary line, a blank line, an indented body line, close.
const ML =
  '"""Parse the wire format.\n' +
  "\n" +
  "    second line, indented body follows.\n" +
  '    """';

// Each row: a SPAN TEXT (begins at def/class, header + body, no leading indent)
// and the expected detector result — undefined, or { lit, sameLine }. The
// assertion pins spanText.slice(start,end) === lit exactly (start/end land on
// the docstring bytes) and sameLineAsHeader === sameLine.
const DETECT = [
  // -- no docstring: first body statement is not a string -> undefined --------
  { name: "no docstring — code first (return 1)", span: "def f():\n    return 1", expect: undefined },
  { name: "no docstring — pass", span: "def f():\n    pass", expect: undefined },
  { name: "no docstring — ellipsis (...)", span: "def f():\n    ...", expect: undefined },
  { name: "one-liner, no docstring (def f(): return 1)", span: "def f(): return 1", expect: undefined },
  { name: "one-liner multi-stmt, no docstring (def f(): x=1; return x)", span: "def f(): x=1; return x", expect: undefined },
  { name: "class, pass-only — no docstring", span: "class C:\n    pass", expect: undefined },

  // -- single-line triple ------------------------------------------------------
  { name: "single-line triple-quoted docstring", span: 'def f():\n    """doc"""\n    return 1', expect: { lit: '"""doc"""', sameLine: false } },
  { name: "docstring-only body (no code below)", span: 'def f():\n    """only"""', expect: { lit: '"""only"""', sameLine: false } },

  // -- single-quote forms (escape-aware) --------------------------------------
  { name: "single-quoted docstring 'doc'", span: "def f():\n    'doc'\n    return 1", expect: { lit: "'doc'", sameLine: false } },
  { name: 'double-quoted docstring "doc"', span: 'def f():\n    "doc"\n    return 1', expect: { lit: '"doc"', sameLine: false } },
  { name: "escape-aware single quote 'a\\'b'", span: "def f():\n    'a\\'b'\n    return 1", expect: { lit: "'a\\'b'", sameLine: false } },

  // -- multi-line triple -------------------------------------------------------
  { name: "multi-line triple docstring, body below", span: `def parse(data):\n    ${ML}\n    return data`, expect: { lit: ML, sameLine: false } },

  // -- r/f/b prefixes (prefix INCLUDED in start) ------------------------------
  { name: 'raw-prefixed r"""raw"""', span: 'def f():\n    r"""raw"""\n    return 1', expect: { lit: 'r"""raw"""', sameLine: false } },
  { name: 'f-string prefix f"fdoc"', span: 'def f():\n    f"fdoc"\n    return 1', expect: { lit: 'f"fdoc"', sameLine: false } },
  { name: 'bytes prefix b"bdoc"', span: 'def f():\n    b"bdoc"\n    return 1', expect: { lit: 'b"bdoc"', sameLine: false } },

  // -- one-liner WITH docstring (sameLineAsHeader TRUE) -----------------------
  { name: 'one-liner WITH docstring (def f(): """d""")', span: 'def f(): """d"""', expect: { lit: '"""d"""', sameLine: true } },

  // -- trivia before the docstring (comment / blank line skipped) -------------
  { name: "# comment before the docstring (trivia skipped)", span: 'def f():\n    # a comment\n    """doc"""\n    return 1', expect: { lit: '"""doc"""', sameLine: false } },
  { name: "blank line before the docstring (trivia skipped)", span: 'def f():\n\n    """doc"""\n    return 1', expect: { lit: '"""doc"""', sameLine: false } },

  // -- CLASS shapes ------------------------------------------------------------
  { name: "class with docstring, member below", span: 'class C:\n    """doc"""\n    x: int', expect: { lit: '"""doc"""', sameLine: false } },
  { name: "enum-subclass with docstring, member below", span: 'class C(Enum):\n    """doc"""\n    RED = 1', expect: { lit: '"""doc"""', sameLine: false } },
];

for (const c of DETECT) {
  pytest(`pyLeadingDocstring: ${c.name} [invariant: exact docstring extent + sameLineAsHeader]`, () => {
    const got = pyLeadingDocstring(c.span);
    if (c.expect === undefined) {
      assert.strictEqual(got, undefined, `first body statement is not a string -> undefined, got ${JSON.stringify(got)}`);
      return;
    }
    assert.ok(got && typeof got === "object", `a leading docstring must be found, got ${JSON.stringify(got)}`);
    assert.ok(Number.isInteger(got.start) && Number.isInteger(got.end), "start/end are integer offsets");
    assert.ok(got.start >= 0 && got.end <= c.span.length && got.start < got.end, `0 <= start < end <= len, got ${JSON.stringify(got)}`);
    assert.strictEqual(
      c.span.slice(got.start, got.end),
      c.expect.lit,
      `slice(start,end) must be the docstring literal exactly (start/end land on the docstring bytes), got ${JSON.stringify(c.span.slice(got.start, got.end))}`,
    );
    assert.strictEqual(got.sameLineAsHeader, c.expect.sameLine, `sameLineAsHeader must be ${c.expect.sameLine}`);
  });
}

// ===========================================================================
// #2 — stripPyDocstring(literal): quotes + prefix stripped, PEP-257 dedented.
// The prompt-facing INNER text; the buffer copy is preserved byte-exact and
// separate (Fork A). RED until it lands.
// ===========================================================================

// Unambiguous single-line forms -> exact expected inner text.
const STRIP_EXACT = [
  { lit: '"""Add two ints."""', want: "Add two ints.", why: "triple-quoted, quotes stripped" },
  { lit: 'r"""raw"""', want: "raw", why: "r prefix + triple quotes stripped" },
  { lit: "'single'", want: "single", why: "single-quoted, quotes stripped" },
  { lit: '"double"', want: "double", why: "double-quoted, quotes stripped" },
  { lit: 'f"fdoc"', want: "fdoc", why: "f prefix + quotes stripped" },
  { lit: 'b"bdoc"', want: "bdoc", why: "b prefix + quotes stripped" },
];

for (const c of STRIP_EXACT) {
  pytest(`stripPyDocstring(${JSON.stringify(c.lit)}) === ${JSON.stringify(c.want)} [contract: ${c.why}]`, () => {
    assert.strictEqual(stripPyDocstring(c.lit), c.want, c.why);
  });
}

// A multi-line PEP-257 docstring: summary line + indented body. The cleaner
// drops the quotes and removes the common leading whitespace of the body lines.
// (Blank-line handling between summary and body is left to the implementer;
// this pins the load-bearing invariants: quotes gone AND the body dedented.)
pytest("stripPyDocstring: multi-line PEP-257 docstring -> dedented prose, quotes gone [contract: PEP-257 dedent]", () => {
  const out = stripPyDocstring(ML);
  assert.ok(!out.includes('"""'), `the triple quotes must be gone, got ${JSON.stringify(out)}`);
  assert.ok(out.includes("Parse the wire format."), "the summary line survives");
  assert.ok(
    out.split("\n").some((l) => l === "second line, indented body follows."),
    `the body line must be dedented to column 0 (common indent removed), got ${JSON.stringify(out)}`,
  );
  assert.ok(!out.includes("    second line"), "the common 4-space indent must be stripped from the body");
});

// ===========================================================================
// #3 — assembleFnGenPrompt bodyOnly variant. Prompt surface (bundle A).
// ===========================================================================

function render(input) {
  if (promptErr) assert.fail(`prompt surface bundle failed: ${promptErr.message}`);
  try {
    return assembleFnGenPrompt(input);
  } catch (e) {
    assert.fail(`assembleFnGenPrompt threw for ${JSON.stringify({ languageId: input.languageId, kind: input.kind, bodyOnly: input.bodyOnly })}: ${e.message}`);
  }
}

// Frozen v1 function instruction + shipped Rust struct instruction, pinned as
// today's bytes (transcribed from blind-v12-typegen-python.test.cjs).
const FN_INSTR =
  "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block.";
const RUST_STRUCT_INSTR =
  "Complete the struct definition below. Reply with one fenced code block containing the complete struct definition: the header and its fields, staying strictly inside this one type. The block must contain only this one struct: no other types, no impl blocks, no functions, no code before or after it. The doc comment above the header describes what the struct must hold. Output nothing outside the code block.";

// A Python function generating below a preserved docstring: docComment is the
// CLEANED docstring prose; signature is the header.
const PY_FN = { languageId: "python", signature: "def add(a: int, b: int) -> int:", docComment: "Add two ints." };
const PY_CLASS = { languageId: "python", kind: "class", signature: "class ServerConfig:", docComment: "A server config: bind address, port, and TLS toggle." };
const RUST_STRUCT = { languageId: "rust", kind: "struct", signature: "pub struct ServerConfig", docComment: "/// Configuration for the server." };

// ---- FROZEN: bodyOnly false/omitted is byte-identical to today --------------

ptest("FROZEN: Python function, bodyOnly omitted === bodyOnly:false, and is the v1 function instruction [invariant: non-bodyOnly bytes identical]", () => {
  const omitted = render(PY_FN);
  const explicitFalse = render({ ...PY_FN, bodyOnly: false });
  assert.strictEqual(omitted, explicitFalse, "bodyOnly:false must be a byte-for-byte no-op vs omitted");
  assert.ok(omitted.includes(FN_INSTR), `the non-bodyOnly Python function path must carry the exact v1 function instruction. CAPTURED:\n${JSON.stringify(omitted)}`);
});

ptest("FROZEN: Python class, bodyOnly omitted === bodyOnly:false [invariant: non-bodyOnly type bytes identical]", () => {
  assert.strictEqual(render(PY_CLASS), render({ ...PY_CLASS, bodyOnly: false }), "bodyOnly:false must not perturb the class prompt");
});

ptest("FROZEN cross-guard: a Rust struct renders today's bytes, bodyOnly false/omitted both no-ops [invariant: Rust untouched]", () => {
  const omitted = render(RUST_STRUCT);
  assert.ok(omitted.includes(RUST_STRUCT_INSTR), `the Rust struct instruction bytes moved. CAPTURED:\n${JSON.stringify(omitted)}`);
  assert.strictEqual(omitted, render({ ...RUST_STRUCT, bodyOnly: false }), "bodyOnly:false must be a no-op for Rust");
});

// ---- NEW: bodyOnly:true routes a BODY-ONLY instruction. RED until it lands. --

ptest("bodyOnly:true (function): instructs BODY-ONLY output, not the full 'Implement the function' instruction [contract: body-only routing]", () => {
  const prompt = render({ ...PY_FN, bodyOnly: true });
  assert.notStrictEqual(prompt, render(PY_FN), "bodyOnly:true must change the assembled bytes vs the non-bodyOnly path");
  assert.ok(!prompt.includes(FN_INSTR), "bodyOnly must NOT be the full v1 'Implement the function' instruction");
  const lower = prompt.toLowerCase();
  assert.ok(/only[\s\S]{0,60}body|body[\s\S]{0,60}only/.test(lower), `the instruction must tell the model to output ONLY the body, got:\n${JSON.stringify(prompt)}`);
});

ptest("bodyOnly:true (function): the docComment + signature still appear as CONTEXT [contract: header+doc are shown, body is generated]", () => {
  const prompt = render({ ...PY_FN, bodyOnly: true });
  assert.ok(prompt.includes(PY_FN.signature), "the signature (header) is still shown to the model");
  assert.ok(prompt.includes(PY_FN.docComment), "the cleaned docComment is still shown to the model as the spec");
});

ptest("bodyOnly:true (function): instruction says not to repeat the header/signature or the docstring [contract: do-not-repeat]", () => {
  const prompt = render({ ...PY_FN, bodyOnly: true });
  const lower = prompt.toLowerCase();
  // A conforming body-only instruction forbids re-emitting the shown header/doc.
  assert.ok(
    /(not|n't|never|without)[\s\S]{0,80}(signature|header|docstring|doc comment|documented)/.test(lower),
    `the instruction must tell the model NOT to repeat the signature/header/docstring, got:\n${JSON.stringify(prompt)}`,
  );
});

ptest("bodyOnly:true (type: class): instructs writing the members/body below, output only, header+doc shown [contract: body-only for a type]", () => {
  const prompt = render({ ...PY_CLASS, bodyOnly: true });
  assert.notStrictEqual(prompt, render(PY_CLASS), "bodyOnly:true must change the assembled bytes for a type too");
  const lower = prompt.toLowerCase();
  assert.ok(lower.includes("only"), "the type body-only instruction constrains the reply to only the body");
  assert.ok(/body|members/.test(lower), "the type body-only instruction asks for the body/members below the header");
  assert.ok(prompt.includes(PY_CLASS.signature), "the class header is still shown");
  assert.ok(prompt.includes(PY_CLASS.docComment), "the cleaned docComment is still shown");
});
