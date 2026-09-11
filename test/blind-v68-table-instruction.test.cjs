// Blind oracle for session-v68 phase 1: the test-authoring instruction asks for
// a TABLE [session-v68/contracts/P1-instruction.md]. Written from the contract
// alone, WITHOUT READING src/** — not one file, not one grep. If this file
// agreed with the implementation it would be worthless, so every assertion is
// derived from the contract's numbered invariants and nothing else.
//
// Assertions match on STABLE substrings and properties (regexes over the
// assembled prompt, framework object properties), NEVER on exact prompt bytes.
// The two exceptions are the byte-IDENTITY invariants 15 and 16, where equality
// of two assemblies is the contract itself.
//
// Surface exercised, all through the public seam:
//   assembleTestGenPrompt   ../src/core/prompt
//   tddLangFor, frameworkFor ../src/core/tddLang
// The nine registered frameworks are reached two ways: enumerated off the public
// `TddLang.frameworks` array (the same seam blind-v31-{cs,py,ts}.test.cjs read),
// and separately resolved through `frameworkFor(lang, root, deps)` with injected
// TddDeps so the reachability itself is oracled. No private import path is used.
//
// EXPECTED RED: phase 1 is not finished, so failing rows here are the point.
// A failing assert.ok is a contract finding. A bundling crash or a TypeError on
// an export that should exist would be a harness bug instead, and there are
// none: the bundle builds and all nine frameworks resolve.
//
// Run: SKIP_LIVE=1 node --test test/blind-v68-table-instruction.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v68-table-instruction",
    `export { assembleTestGenPrompt } from "../src/core/prompt";\n` +
      `export { tddLangFor, frameworkFor, testGenFieldsFor } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const { assembleTestGenPrompt, tddLangFor, frameworkFor, testGenFieldsFor } = mod;

test("bundle: the P1 surface builds and exports assembleTestGenPrompt + tddLangFor + frameworkFor [P1 'Surface under contract']", () => {
  assert.strictEqual(bundleError, undefined, `the bundle failed, so every row below is a harness error rather than a contract finding: ${bundleError}`);
  assert.strictEqual(typeof assembleTestGenPrompt, "function", "assembleTestGenPrompt(input) => string");
  assert.strictEqual(typeof tddLangFor, "function", "tddLangFor(languageId) => TddLang | undefined");
  assert.strictEqual(typeof frameworkFor, "function", "frameworkFor(lang, root, deps)");
});

// ===========================================================================
// Fixtures.
// ===========================================================================

// Invariant 18 names the eight registered ids explicitly.
const LANG_IDS = [
  "rust",
  "go",
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "python",
  "csharp",
];

const SIG = {
  rust: "pub fn shard_of(key: &str, buckets: usize) -> usize",
  go: "func ShardOf(key string, buckets int) int",
  typescript: "export function shardOf(key: string, buckets: number): number",
  typescriptreact: "export function shardOf(key: string, buckets: number): number",
  javascript: "export function shardOf(key, buckets)",
  javascriptreact: "export function shardOf(key, buckets)",
  python: "def shard_of(key: str, buckets: int) -> int",
  csharp: "public static int ShardOf(string key, int buckets)",
};
const NAME = {
  rust: "Rust",
  go: "Go",
  typescript: "TypeScript",
  typescriptreact: "TypeScript",
  javascript: "JavaScript",
  javascriptreact: "JavaScript",
  python: "Python",
  csharp: "C#",
};

const DOC_SENTINEL = "Maps a key onto a bucket. DOC_VERBATIM_SENTINEL_V68";
const CALLEE_SENTINEL = "struct Ring { fn len(&self) -> usize } CALLEE_BLOCK_SENTINEL_V68";

// The base input carries NO assertionInstruction, so a language-agnostic
// negative (invariants 13 and 14) is judged on the instruction the product
// authors, not on a string a test injected.
const base = (id, over = {}) => ({
  signature: SIG[id],
  docComment: DOC_SENTINEL,
  languageId: id,
  languageName: NAME[id],
  ...over,
});

const promptFor = (id, over = {}) => assembleTestGenPrompt(base(id, over));

// The prompt the PRODUCT sends once a framework is resolved. It reads the
// product's own framework-to-prompt mapping rather than listing the fields here,
// which is the whole point: the first cut of this oracle injected
// `assertionInstruction` alone, so the shipped NUnit clause banning `[Test]` —
// the clause that broke the C# reply guard — sat in no prompt any test read.
const shippedPrompt = (languageId, frameworkId) => {
  const lang = tddLangFor(languageId);
  const f = lang.frameworks.find((x) => x.id === frameworkId);
  assert.ok(f, `${languageId} has no framework ${frameworkId}`);
  return assembleTestGenPrompt({ signature: SIG[languageId], docComment: DOC_SENTINEL, ...testGenFieldsFor(lang, f) });
};

// Every (language, framework) pair the seam registers, so no clause reaches a
// human through a prompt no oracle has read.
const ALL_FRAMEWORKS = [
  ["rust", "libtest"],
  ["go", "gotest"],
  ["typescript", "vitest"],
  ["typescript", "jest"],
  ["python", "pytest"],
  ["python", "unittest"],
  ["csharp", "mstest"],
  ["csharp", "xunit"],
  ["csharp", "nunit"],
];

test("[P1 §19+§20 the SHIPPED prompt] every framework-resolved prompt is judged, not just the languageId default", () => {
  for (const [languageId, frameworkId] of ALL_FRAMEWORKS) {
    const p = shippedPrompt(languageId, frameworkId);
    const why = (m) => withPrompt(`${languageId}/${frameworkId}`, p, m);
    assert.ok(/last column of every row/i.test(p), why("no last-column clause"));
    assert.ok(/(do not|don't|never)[\s\S]{0,80}implementation/i.test(p), why("the blind directive is gone"));
    assert.ok(/mock/i.test(p) && /real/i.test(p), why("the no-mocks clause is gone"));
    assert.ok(!/NEVER loop over a table of rows/i.test(p), why("the superseded clause is back"));
    assert.ok(
      !/property-based|fuzz|mutation testing|boundary value|equivalence partition|differential testing/i.test(p),
      why("testing vocabulary leaked into a framework-resolved prompt")
    );
  }
});

test("[P1 §12 the SHIPPED C# prompt] the constant-only carve-out and the constructed-column rule never share a prompt", () => {
  for (const [languageId, frameworkId] of ALL_FRAMEWORKS) {
    const p = shippedPrompt(languageId, frameworkId);
    const constructs = /Prefer a column carrying a value the test CONSTRUCTS/.test(p);
    const constOnly = /takes compile-time constants only/.test(p);
    assert.ok(
      !(constructs && constOnly),
      withPrompt(`${languageId}/${frameworkId}`, p, "one prompt asks for a constructed column and says the row cannot hold one")
    );
  }
});

test("[P1 §1 the SHIPPED idiom] each framework's own row spelling reaches the prompt", () => {
  const SPELLING = {
    "rust/libtest": /let cases = \[/,
    "go/gotest": /\[\]struct/,
    "typescript/vitest": /it\.each/,
    "typescript/jest": /it\.each/,
    "python/pytest": /@pytest\.mark\.parametrize/,
    "python/unittest": /self\.subTest/,
    "csharp/mstest": /\[DataRow\(/,
    "csharp/xunit": /\[InlineData\(/,
    "csharp/nunit": /\[TestCase\(/,
  };
  for (const [languageId, frameworkId] of ALL_FRAMEWORKS) {
    const key = `${languageId}/${frameworkId}`;
    const p = shippedPrompt(languageId, frameworkId);
    assert.ok(SPELLING[key].test(p), withPrompt(key, p, `the prompt never spells ${SPELLING[key]}`));
  }
});

// A failure that does not print the prompt is a failure you cannot act on.
const withPrompt = (id, p, why) => `${id}: ${why}\n---- PROMPT ----\n${p}\n---- END ----`;

// ===========================================================================
// 1. The table (invariants 1, 2, 3, 4, 5, 6, 7).
// ===========================================================================

test("[P1 §1 the table] every language asks for ONE parameterised table over rows plus ONE runner, not one test function per case", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(/\btable\b/i.test(p), withPrompt(id, p, "the instruction never says 'table'"));
    assert.ok(/\brows?\b/i.test(p), withPrompt(id, p, "the instruction never says 'row'"));
    assert.ok(
      /\b(one|single)\b[\s\S]{0,80}\btable\b/i.test(p),
      withPrompt(id, p, "the instruction does not ask for ONE table")
    );
    // The shipped clause this REVERSES must be gone. Targeted at the shipped
    // wording rather than any near-match, because the surviving half of the
    // inline rule and the multi-group rule both legitimately say "not" near
    // the word "table".
    for (const gone of [
      /a table of rows/i,
      /no table[-\s]driven/i,
      /(never|do not|don't|avoid)\s+(use\s+|write\s+|build\s+)?(a\s+)?table\b/i,
      /(never|do not|don't|avoid)\s+(use\s+|write\s+)?(a\s+)?loop\b/i,
    ]) {
      const m = p.match(gone);
      assert.strictEqual(m, null, withPrompt(id, p, `the instruction still FORBIDS a table/loop (${gone} matched ${JSON.stringify(m && m[0])}); P1 reverses that clause`));
    }
  }
});

test("[P1 §1 about five rows] the instruction names the ~five-row size", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(/\bfive\b|\b5\b/i.test(p), withPrompt(id, p, "the instruction never names the ~five-row size"));
  }
});

test("[P1 §1 the idiom, per language] each language is asked for ITS parameterised idiom, not a generic 'table'", () => {
  const IDIOM = {
    rust: [/let\s+cases\s*=/, /\bfor\b[\s\S]{0,60}`?cases`?/, /assert_eq!/],
    go: [/\[\]struct/, /for\s+_,\s*tt\s*:?=\s*range/, /t\.Run/],
    typescript: [/it\.each/],
    typescriptreact: [/it\.each/],
    javascript: [/it\.each/],
    javascriptreact: [/it\.each/],
    // Python carries two frameworks, so the prompt must reach at least one of
    // the two idioms with no framework instruction supplied; the per-framework
    // rows below pin each one individually.
    python: [/@pytest\.mark\.parametrize|subTest/],
    // Same for C#'s three.
    csharp: [/\[TestCase\(|\[InlineData\(|\[DataRow\(/],
  };
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    for (const re of IDIOM[id]) {
      assert.ok(re.test(p), withPrompt(id, p, `the instruction never spells its idiom ${re}`));
    }
  }
});

test("[P1 §1 the idiom, per framework] python reaches parametrize under pytest and subTest under unittest", () => {
  const pytest = frameworkNamed("python", "pytest");
  const unittest = frameworkNamed("python", "unittest");
  const withPytest = promptFor("python", { assertionInstruction: pytest.assertionInstruction });
  assert.ok(
    /@pytest\.mark\.parametrize/.test(withPytest),
    withPrompt("python/pytest", withPytest, "the pytest prompt never names @pytest.mark.parametrize")
  );
  const withUnittest = promptFor("python", { assertionInstruction: unittest.assertionInstruction });
  assert.ok(
    /subTest/.test(withUnittest),
    withPrompt("python/unittest", withUnittest, "the unittest prompt never names self.subTest")
  );
  assert.ok(
    /\bcases\s*=/.test(withUnittest),
    withPrompt("python/unittest", withUnittest, "the unittest prompt never names the `cases = [ ... ]` list the loop walks")
  );
});

test("[P1 §1 the idiom, per framework] C# reaches [TestCase] under NUnit, [Theory]+[InlineData] under xUnit, [DataTestMethod]+[DataRow] under MSTest", () => {
  const cases = [
    ["nunit", [/\[TestCase\(/]],
    ["xunit", [/\[Theory\]/, /\[InlineData\(/]],
    ["mstest", [/\[DataTestMethod\]/, /\[DataRow\(/]],
  ];
  for (const [fwId, res] of cases) {
    const fw = frameworkNamed("csharp", fwId);
    const p = promptFor("csharp", { assertionInstruction: fw.assertionInstruction });
    for (const re of res) {
      assert.ok(re.test(p), withPrompt(`csharp/${fwId}`, p, `the instruction never names ${re}`));
    }
  }
});

test("[P1 §2 expected value is the last column] every language states it", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(
      /last column/i.test(p),
      withPrompt(id, p, "the instruction never says the expected value is the LAST column of every row")
    );
    assert.ok(
      /expected/i.test(p),
      withPrompt(id, p, "the last-column clause is not tied to the EXPECTED value")
    );
  }
});

test("[P1 §2 the SAME sentence] the last-column clause is byte-identical across all eight languageIds, because ONE locator rule reads it", () => {
  const CLAUSE = /the expected value (?:is|in|goes) (?:in )?the last column of every row/i;
  const seen = new Map();
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    const m = p.match(CLAUSE);
    assert.ok(m, withPrompt(id, p, "no last-column clause to compare"));
    seen.set(id, m[0]);
  }
  const distinct = [...new Set(seen.values())];
  assert.strictEqual(
    distinct.length,
    1,
    "the last-column rule is worded differently per language, so one locator rule cannot read one sentence. Per language:\n" +
      [...seen].map(([id, c]) => `  ${id}: ${JSON.stringify(c)}`).join("\n")
  );
});

test("[P1 §3 one row per line] each row is typed on its own line", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(
      /one row per line/i.test(p) ||
        /\brow\b[\s\S]{0,60}\b(own|one|a single)\s+line\b/i.test(p) ||
        /\b(own|one|a single)\s+line\b[\s\S]{0,60}\brow\b/i.test(p),
      withPrompt(id, p, "the instruction never says one row per line / each row on its own line")
    );
  }
});

test("[P1 §4 a literal, never a name] the expected value is spelled out in the row, never pulled from a shared variable or a named constant", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(
      /\bliteral\b/i.test(p) || /spelled out|written out|inline/i.test(p),
      withPrompt(id, p, "the instruction never says the expected value is a literal spelled out in the row")
    );
    assert.ok(
      /(never|not|no|don't|do not|avoid)[\s\S]{0,120}(shared variable|constant|variable)/i.test(p),
      withPrompt(id, p, "the instruction never forbids pulling the expected value from a shared variable or a named constant")
    );
  }
});

test("[P1 §5 knob rule 1, the constructed column] a column carrying a CONSTRUCTED value is preferred over a scalar stand-in", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(
      /construct/i.test(p),
      withPrompt(id, p, "the instruction never mentions a constructed value")
    );
    assert.ok(
      /\bprefer\b/i.test(p),
      withPrompt(id, p, "the instruction never states the PREFERENCE for the constructed column")
    );
    assert.ok(
      /\bcolumn\b/i.test(p),
      withPrompt(id, p, "the instruction never speaks of a column")
    );
  }
});

test("[P1 §6 knob rule 2, no dead knob] every column the table declares must be READ by the loop body", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(
      /(every|each)\s+column[\s\S]{0,140}\b(read|used|use)\b/i.test(p) ||
        /(never|not|no|don't|do not)[\s\S]{0,120}\bcolumn\b[\s\S]{0,80}\b(never|not)\b[\s\S]{0,40}\b(read|use[sd]?)\b/i.test(p),
      withPrompt(id, p, "the instruction never forbids a dead knob: a declared column the loop body never reads")
    );
    assert.ok(
      /\bbody\b/i.test(p),
      withPrompt(id, p, "the no-dead-knob rule never names the loop body that must read the column")
    );
  }
});

test("[P1 §7 the multi-group rule] a case that is not a row of this table becomes its OWN separate test, and a case that fits no shape is refused out loud", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(
      /\bits own\b[\s\S]{0,40}\bseparate\b|\bseparate\b[\s\S]{0,40}\b(test|fn|method|function)\b|\bits own\b[\s\S]{0,40}\b(test|fn|method|function)\b/i.test(p),
      withPrompt(id, p, "the instruction never says a non-fitting case gets its own separate test")
    );
    assert.ok(
      /refus|say so|out loud|do not write a test that checks nothing|checks nothing/i.test(p),
      withPrompt(id, p, "the instruction never says a case that fits no shape is refused out loud rather than written as a test that checks nothing")
    );
  }
});

// ===========================================================================
// 2. The clauses that survive unchanged (invariants 8, 9, 10, 11, 12).
// ===========================================================================

const BLIND_DIRECTIVE = /(do not|don't|never|without)[\s\S]{0,80}implementation/i;

test("[P1 §8 blind authoring survives] every language forbids writing, assuming or inferring a reference implementation", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(BLIND_DIRECTIVE.test(p), withPrompt(id, p, "the blind-authoring directive is gone"));
  }
});

test("[P1 §9 no mocks survives] every language addresses mocks and prefers the real collaborator", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(/mock/i.test(p), withPrompt(id, p, "the no-mocks clause is gone"));
    assert.ok(/\breal\b/i.test(p), withPrompt(id, p, "the no-mocks clause no longer prefers the real collaborator"));
  }
});

test("[P1 §10 Rust's panic clause survives] bare #[should_panic] only on an explicit contract panic, no expected=\"...\" unless quoted, never unsafe", () => {
  const p = promptFor("rust");
  assert.ok(/should_panic/.test(p), withPrompt("rust", p, "the should_panic clause is gone"));
  assert.ok(
    /(only if|only when|explicit)[\s\S]{0,80}panic/i.test(p) || /panic[\s\S]{0,80}(only if|only when|explicit)/i.test(p),
    withPrompt("rust", p, "should_panic is no longer gated on the contract EXPLICITLY stating a panic")
  );
  assert.ok(
    /(never|not|avoid|don't|do not|only|unless|no)[\s\S]{0,100}expected/i.test(p) ||
      /expected[\s\S]{0,100}(unless|only|never|not|avoid)/i.test(p),
    withPrompt("rust", p, "the expected=\"...\" form is no longer restricted to a contract-quoted message")
  );
  assert.ok(
    /unsafe/i.test(p) && /(never|not|no|don't|do not)[\s\S]{0,60}unsafe/i.test(p),
    withPrompt("rust", p, "the instruction no longer forbids forcing a panic with unsafe")
  );
});

test("[P1 §11 reply shape survives] Rust asks for one #[cfg(test)] mod tests block", () => {
  const p = promptFor("rust");
  assert.ok(/cfg\(test\)/.test(p), withPrompt("rust", p, "the reply-shape clause no longer names #[cfg(test)]"));
  assert.ok(/mod tests/.test(p), withPrompt("rust", p, "the reply-shape clause no longer names the `mod tests` block"));
});

test("[P1 §11 reply shape survives] the other four languages keep a framework-specific reply shape, not the generic fallback", () => {
  // The pin review-v31-phase6 already established: falling back to this exact
  // generic sentence is the failure the per-language clauses exist to prevent.
  const GENERIC = "Reply with ONE fenced code block containing ONLY the test functions and nothing else";
  for (const id of LANG_IDS.filter((x) => x !== "rust")) {
    const p = promptFor(id);
    assert.ok(
      !p.includes(GENERIC),
      withPrompt(id, p, "this languageId fell back to the generic reply shape instead of the one its framework states")
    );
    assert.ok(/fenced|code block/i.test(p), withPrompt(id, p, "no reply-shape clause at all"));
  }
});

test("[P1 §12 C# says what its attributes cannot carry] compile-time constants only, so a constructed case becomes its own test method under rule 7", () => {
  const p = promptFor("csharp");
  assert.ok(
    /compile[-\s]time constant/i.test(p),
    withPrompt("csharp", p, "the instruction never states that the attributes take compile-time constants only")
  );
  for (const attr of [/\[TestCase\]|\[TestCase\(/, /\[InlineData\]|\[InlineData\(/, /\[DataRow\]|\[DataRow\(/]) {
    assert.ok(attr.test(p), withPrompt("csharp", p, `the compile-time-constant clause never names ${attr}`));
  }
  assert.ok(
    /own test method|separate test|its own test/i.test(p),
    withPrompt("csharp", p, "the instruction never routes a constructed C# case to its own test method rather than scalarising it into the attribute")
  );
});

// ===========================================================================
// 3. The negatives (invariants 13, 14).
// ===========================================================================

const BANNED_TECHNIQUE = [
  /property[-\s]based/i,
  /\bfuzz/i,
  /\bmutation\b/i,
  /\bmutant/i,
  /boundary[-\s]value/i,
  /equivalence[-\s]partition/i,
  /\bdifferential\b/i,
  /\bgolden\b/i,
  /\bsnapshot\b/i,
  /\bquickcheck\b/i,
  /\bhypothesis\b/i,
  /\bproptest\b/i,
  /\brstest\b/i,
];

test("[P1 §13 no testing vocabulary] no assembled prompt names a testing TECHNIQUE or library, for any languageId", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    for (const re of BANNED_TECHNIQUE) {
      const m = p.match(re);
      assert.strictEqual(
        m,
        null,
        withPrompt(id, p, `the instruction names a testing technique/library ${re} (matched ${JSON.stringify(m && m[0])}); measured over 26 conditions x 80 runs, naming one does not work`)
      );
    }
  }
});

test("[P1 §13 no testing vocabulary] no framework assertionInstruction names a testing TECHNIQUE or library either", () => {
  for (const { languageId, fw } of allFrameworks()) {
    for (const re of BANNED_TECHNIQUE) {
      const m = fw.assertionInstruction.match(re);
      assert.strictEqual(
        m,
        null,
        `${languageId}/${fw.id}: assertionInstruction names ${re} (matched ${JSON.stringify(m && m[0])}). It reaches the same prompt.\n${fw.assertionInstruction}`
      );
    }
  }
});

test("[P1 §14 nothing about the function body] no prompt mentions coverage or a mutant, for any languageId", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(!/\bcoverage\b/i.test(p), withPrompt(id, p, "the instruction speaks of coverage; the prompt carries the signature, the doc and the collaborator surface, nothing about the body"));
    assert.ok(!/\bmutant/i.test(p), withPrompt(id, p, "the instruction speaks of a mutant"));
  }
});

test("[P1 §14 nothing about the function body] an implementation body handed in on the input never reaches the prompt", () => {
  const SENTINEL = "BODY_SENTINEL_V68_MUST_NOT_LEAK";
  for (const id of LANG_IDS) {
    const plain = promptFor(id);
    for (const key of ["body", "implementation", "functionBody"]) {
      const withBody = assembleTestGenPrompt(base(id, { [key]: SENTINEL }));
      assert.ok(!withBody.includes(SENTINEL), withPrompt(id, withBody, `a \`${key}\` field leaked into the test prompt`));
      assert.strictEqual(withBody, plain, `${id}: a \`${key}\` field changed the test prompt's bytes; the prompt must carry no body channel at all`);
    }
  }
});

// ===========================================================================
// 4. Properties (invariants 15, 16, 17, 18).
// ===========================================================================

test("[P1 §15 deterministic] same input, same bytes, every language, with and without a doc comment", () => {
  for (const id of LANG_IDS) {
    assert.strictEqual(promptFor(id), promptFor(id), `${id}: full input is not deterministic`);
    const minimal = { signature: SIG[id], languageId: id, languageName: NAME[id] };
    assert.strictEqual(
      assembleTestGenPrompt(minimal),
      assembleTestGenPrompt(minimal),
      `${id}: minimal input is not deterministic`
    );
    const full = base(id, { calleeSurface: CALLEE_SENTINEL, assertionInstruction: "ASSERT_INSTR_SENTINEL_V68" });
    assert.strictEqual(
      assembleTestGenPrompt(full),
      assembleTestGenPrompt(full),
      `${id}: input carrying a calleeSurface and an assertionInstruction is not deterministic`
    );
  }
});

test("[P1 §16 calleeSurface: undefined is byte-identical to omitting it] every language", () => {
  for (const id of LANG_IDS) {
    const omitted = promptFor(id);
    assert.ok(!omitted.includes("CALLEE_BLOCK_SENTINEL_V68"), `${id}: no calleeSurface supplied, yet a collaborator section leaked in`);
    assert.strictEqual(
      assembleTestGenPrompt(base(id, { calleeSurface: undefined })),
      omitted,
      `${id}: calleeSurface: undefined does not degrade to the no-calleeSurface prompt byte-for-byte`
    );
  }
});

test("[P1 §17 the contract renders verbatim] the signature always, the doc comment when present", () => {
  for (const id of LANG_IDS) {
    const p = promptFor(id);
    assert.ok(p.includes(SIG[id]), withPrompt(id, p, `the signature ${JSON.stringify(SIG[id])} is not rendered verbatim`));
    assert.ok(p.includes(DOC_SENTINEL), withPrompt(id, p, "the doc comment is not rendered verbatim"));
  }
});

test("[P1 §17 the contract renders verbatim] neither leaks when absent: no doc supplied means no doc content, and the prompt is still valid", () => {
  for (const id of LANG_IDS) {
    const p = assembleTestGenPrompt({ signature: SIG[id], languageId: id, languageName: NAME[id] });
    assert.ok(!p.includes("DOC_VERBATIM_SENTINEL_V68"), withPrompt(id, p, "no doc supplied, yet doc content leaked in"));
    assert.ok(p.includes(SIG[id]), withPrompt(id, p, "the signature vanished when the doc was omitted"));
    assert.ok(BLIND_DIRECTIVE.test(p), withPrompt(id, p, "the blind directive vanished when the doc was omitted"));
    assert.ok(/\btable\b/i.test(p), withPrompt(id, p, "the table instruction vanished when the doc was omitted"));
  }
});

test("[P1 §18 every registered languageId gets a table instruction] all eight resolve and all eight carry the table clause and the last-column rule", () => {
  const missing = [];
  for (const id of LANG_IDS) {
    assert.ok(tddLangFor(id), `${id} is a registered languageId, so tddLangFor must resolve it`);
    const p = promptFor(id);
    if (!/\btable\b/i.test(p) || !/last column/i.test(p)) missing.push(id);
  }
  assert.deepStrictEqual(
    missing,
    [],
    `these registered languageIds get no table instruction, so the clause landed per FAMILY rather than per id: ${JSON.stringify(missing)}`
  );
});

// ===========================================================================
// 5. The nine assertionInstruction strings (invariants 19, 20).
// ===========================================================================

// Each framework's own assertion idiom, per invariant 20's parenthetical.
const FRAMEWORK_IDIOM = {
  "rust/libtest": [/assert_eq!/],
  "go/gotest": [/\bwant\b/],
  "typescript/vitest": [/expect\(/],
  "typescript/jest": [/expect\(/],
  "python/pytest": [/==/],
  "python/unittest": [/assertEqual/],
  "csharp/mstest": [/Assert\.AreEqual/],
  "csharp/xunit": [/Assert\.Equal/],
  "csharp/nunit": [/Is\.EqualTo/],
};

// The nine, as the contract's own table and the shipped registration name them.
const EXPECTED_FRAMEWORK_IDS = {
  rust: ["libtest"],
  go: ["gotest"],
  typescript: ["vitest", "jest"],
  python: ["pytest", "unittest"],
  csharp: ["mstest", "xunit", "nunit"],
};

function frameworkNamed(languageId, id) {
  const lang = tddLangFor(languageId);
  assert.ok(lang, `tddLangFor(${languageId}) resolves`);
  assert.ok(Array.isArray(lang.frameworks), `${languageId}: TddLang.frameworks is the public array of registered frameworks`);
  const fw = lang.frameworks.find((f) => f.id === id);
  assert.ok(fw, `${languageId} registers no framework ${id}; got ${JSON.stringify(lang.frameworks.map((f) => f.id))}`);
  return fw;
}

// All nine, off the public seam, so invariants 19/20 cover every one of them
// whether or not a fake TddDeps can steer detection to it.
function allFrameworks() {
  const out = [];
  for (const [languageId, ids] of Object.entries(EXPECTED_FRAMEWORK_IDS)) {
    for (const id of ids) out.push({ languageId, fw: frameworkNamed(languageId, id) });
  }
  return out;
}

test("[P1 §19 the nine are reachable] all nine frameworks are registered on the public seam", () => {
  const got = allFrameworks().map(({ languageId, fw }) => `${languageId}/${fw.id}`);
  assert.strictEqual(got.length, 9, `expected nine registered frameworks, got ${JSON.stringify(got)}`);
  for (const { languageId, fw } of allFrameworks()) {
    assert.strictEqual(typeof fw.assertionInstruction, "string", `${languageId}/${fw.id}: assertionInstruction is a string`);
    assert.ok(fw.assertionInstruction.length > 0, `${languageId}/${fw.id}: an empty assertionInstruction tells the model nothing`);
  }
});

test("[P1 §19 none of the nine still forbids a table] no assertionInstruction forbids a table, forbids a loop, or demands one case per test function", () => {
  const OFFENDERS = [
    /no table[-\s]driven/i,
    /(never|not|no|avoid|don't|do not)[^.\n]{0,60}\btable\b/i,
    /(never|not|no|avoid|don't|do not)[^.\n]{0,60}\bloop\b/i,
    /(never|not|no|avoid|don't|do not)[^.\n]{0,60}\brange\b/i,
    /one\s+(case|assertion)\s+per\s+(test\s+)?(function|method|fn)/i,
    /one\s+(test\s+)?(function|method|fn)\s+per\s+case/i,
  ];
  const bad = [];
  for (const { languageId, fw } of allFrameworks()) {
    for (const re of OFFENDERS) {
      const m = fw.assertionInstruction.match(re);
      if (m) bad.push(`${languageId}/${fw.id}: ${re} matched ${JSON.stringify(m[0])}`);
    }
  }
  assert.deepStrictEqual(
    bad,
    [],
    "these assertionInstruction strings still contradict the table clause; Go's shipped 'no table-driven loops' is the loudest case:\n" + bad.join("\n")
  );
});

test("[P1 §20 each names ITS assertion idiom and ITS expected-value position]", () => {
  // From the contract's own parenthetical: MSTest and xUnit expected-FIRST,
  // NUnit inside Is.EqualTo, pytest the RHS of ==, Go the `want` field, Rust
  // the second argument of assert_eq!.
  const POSITION = {
    "rust/libtest": [/\bsecond\b|\b2nd\b/i],
    "go/gotest": [/\bwant\b/],
    "typescript/vitest": [/toBe|toEqual|argument/i],
    "typescript/jest": [/toBe|toEqual|argument/i],
    "python/pytest": [/right|RHS|==/i],
    "python/unittest": [/\bsecond\b|\b2nd\b|argument/i],
    "csharp/mstest": [/FIRST argument/i],
    "csharp/xunit": [/FIRST argument/i],
    "csharp/nunit": [/Is\.EqualTo/],
  };
  for (const { languageId, fw } of allFrameworks()) {
    const key = `${languageId}/${fw.id}`;
    const s = fw.assertionInstruction;
    for (const re of FRAMEWORK_IDIOM[key]) {
      assert.ok(re.test(s), `${key}: assertionInstruction no longer names its assertion idiom ${re}:\n${s}`);
    }
    for (const re of POSITION[key]) {
      assert.ok(re.test(s), `${key}: assertionInstruction no longer names its expected-value position ${re}, so the row and the assertion can disagree in ONE prompt:\n${s}`);
    }
  }
});

test("[P1 §20 the row and the assertion agree in ONE prompt] each framework's assertion idiom reaches the prompt alongside the last-column rule", () => {
  for (const { languageId, fw } of allFrameworks()) {
    const p = promptFor(languageId, { assertionInstruction: fw.assertionInstruction });
    const key = `${languageId}/${fw.id}`;
    for (const re of FRAMEWORK_IDIOM[key]) {
      assert.ok(
        re.test(p),
        withPrompt(key, p, `the prompt never names this framework's assertion idiom ${re}, so the row and the assertion can disagree`)
      );
    }
    assert.ok(
      /last column/i.test(p),
      withPrompt(key, p, "the last-column rule is absent from the prompt that carries this framework's assertion idiom")
    );
  }
});

// ===========================================================================
// 6. Reachability through frameworkFor with injected TddDeps.
//    The contract names frameworkFor(lang, root, deps) as the way a framework
//    is reached, so the fakes below prove the nine are not orphans on the
//    registration array.
// ===========================================================================

const depsOf = (files, contents = {}, dirs = {}, extra = {}) => {
  const set = new Set(files.map((f) => path.normalize(f)));
  return {
    fileExists: (p) => set.has(path.normalize(p)) || dirs[path.normalize(p)] !== undefined,
    readFile: (p) => contents[path.normalize(p)],
    readDir: (p) => dirs[path.normalize(p)],
    log: () => {},
    ...extra,
  };
};

const PKG = (dev) => JSON.stringify({ devDependencies: dev, scripts: { test: "test" } });
const PYPROJECT_PYTEST = '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n';
const CSPROJ = (pkg) =>
  [
    '<Project Sdk="Microsoft.NET.Sdk">',
    "  <PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup>",
    `  <ItemGroup><PackageReference Include="${pkg}" Version="1.0.0" /></ItemGroup>`,
    "</Project>",
  ].join("\n");

const csDeps = (pkg) =>
  depsOf(
    ["/repo/Acme.Tests/Acme.Tests.csproj"],
    { "/repo/Acme.Tests/Acme.Tests.csproj": CSPROJ(pkg) },
    { "/repo": ["Acme.Tests"], "/repo/Acme.Tests": ["Acme.Tests.csproj"], "/": ["repo"] }
  );

const REACHABLE = [
  ["rust", "libtest", "/w/crate", () => depsOf(["/w/crate/Cargo.toml", "/w/crate/src/lib.rs"])],
  ["go", "gotest", "/m", () => depsOf(["/m/go.mod"], { "/m/go.mod": "module m\n" })],
  [
    "typescript",
    "vitest",
    "/p",
    () => depsOf(["/p/package.json", "/p/node_modules/.bin/vitest"], { "/p/package.json": PKG({ vitest: "^4.1.7" }) }),
  ],
  [
    "typescript",
    "jest",
    "/p",
    () => depsOf(["/p/package.json", "/p/node_modules/.bin/jest"], { "/p/package.json": PKG({ jest: "^29.0.0" }) }),
  ],
  [
    "python",
    "pytest",
    "/p",
    () =>
      depsOf(
        ["/p/pyproject.toml", "/p/.venv/bin/python", "/p/.venv/bin/pytest", "/p/tests"],
        { "/p/pyproject.toml": PYPROJECT_PYTEST },
        {},
        { probe: () => ({ exitCode: 0 }) }
      ),
  ],
  ["python", "unittest", "/nowhere", () => depsOf([], {}, {}, { probe: () => ({ exitCode: 1 }) })],
  ["csharp", "mstest", "/repo/Acme.Tests", () => csDeps("MSTest.TestFramework")],
  ["csharp", "xunit", "/repo/Acme.Tests", () => csDeps("xunit.v3")],
  ["csharp", "nunit", "/repo/Acme.Tests", () => csDeps("NUnit")],
];

for (const [languageId, fwId, root, mkDeps] of REACHABLE) {
  test(`[P1 §19 reachable through frameworkFor] ${languageId}/${fwId} resolves from an injected TddDeps, and the instruction it carries obeys the table clause`, () => {
    const lang = tddLangFor(languageId);
    assert.ok(lang, `tddLangFor(${languageId})`);
    const res = frameworkFor(lang, root, mkDeps());
    assert.strictEqual(res.ok, true, `${languageId}/${fwId}: frameworkFor refused: ${JSON.stringify(res)}`);
    assert.strictEqual(res.framework.id, fwId, `${languageId}: expected ${fwId}, got ${res.framework.id}`);
    const s = res.framework.assertionInstruction;
    assert.strictEqual(typeof s, "string", `${languageId}/${fwId}: assertionInstruction is a string`);
    assert.ok(
      !/no table[-\s]driven/i.test(s),
      `${languageId}/${fwId}: the instruction the resolver actually hands the prompt still forbids table-driven tests:\n${s}`
    );
  });
}
