// White-box: the context bundle's own vocabulary (session-v64 phase 4).
//
// Phase 4 hands a model the function, its parsed signature, the shapes of the
// types it touches, the real upstream call lines and the workspace callees, then
// asks for ONE imperative sentence. This file pins the parts of that which are
// pure: what the channel SAYS about a context and about a sentence it turned
// down, and how one callee's doc comment is read out of a file.
//
// TWO SPELLINGS THAT MAY NEVER MERGE. "There was no model" and "the model's
// sentence was refused" are opposite events wanting opposite actions, and the
// whole of phase 1 of this session exists because the explainer spelled them
// identically for a release. Rows 6 to 9 are the falsifier for that here.
//
// ROWS
//    1  FIX_SHIPPED_ARM is one of the declared arms
//    2  fixContextLine names what is PRESENT
//    3  fixContextLine names what is ABSENT, rather than omitting it
//    4  an empty context still renders, and reads as empty
//    5  a malformed context does not throw
//    6  a refusal names the dimension, the reason AND the fallback
//    7  an unreachable round is a DIFFERENT sentence from a refusal
//    8  fixedLine tallies both kinds, and carries the outage's own message
//    9  fixedLine on a clean run says nothing about failures
//   10  fixedLine survives a non-array and a missing kind
//   11  calleeDoc reads a doc comment in all five languages
//   12  calleeDoc caps the lines it takes
//   13  calleeDoc caps the characters, and says it cut
//   14  calleeDoc answers "" for the undocumented, the unreadable and the
//       out-of-range, which are the same thing to a prompt
//   15  a callee with no doc renders as its NAME, not as a dangling colon
//   16  a callee WITH a doc still renders name and doc
//
// Run: SKIP_LIVE=1 node --test test/impl-v64-p4-context.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const core = bundleCore(
  "impl-v64-p4-context",
  `export { fixContextLine, fixRefusedLine, fixSkippedLine, fixUnreachableLine, fixedLine } from "../src/core/criticizeGesture";
export { FIX_ARMS, FIX_CALLEE_DOC_CHARS, FIX_CALLEE_DOC_LINES, FIX_SHIPPED_ARM, buildFixPrompt, calleeDoc } from "../src/core/criticizeFix";
export { criticizeLangFor } from "../src/core/criticizeLang";\n`,
);
test.after(() => core.cleanup());

const {
  fixContextLine,
  fixRefusedLine,
  fixSkippedLine,
  fixUnreachableLine,
  fixedLine,
  FIX_ARMS,
  FIX_CALLEE_DOC_CHARS,
  FIX_CALLEE_DOC_LINES,
  FIX_SHIPPED_ARM,
  buildFixPrompt,
  calleeDoc,
  criticizeLangFor,
} = core.mod;

// ---------------------------------------------------------------------------
// The arm the product sends.
// ---------------------------------------------------------------------------

test("1: FIX_SHIPPED_ARM is one of the arms the table declares", () => {
  assert.ok(
    FIX_ARMS.includes(FIX_SHIPPED_ARM),
    `the product sends arm ${FIX_SHIPPED_ARM}, which is not in the arm table ${FIX_ARMS.join(", ")}. `
      + "An arm nobody measured cannot be the arm that ships.",
  );
});

// ---------------------------------------------------------------------------
// What the model was shown, INCLUDING what it was not.
// ---------------------------------------------------------------------------

const FULL = {
  functionText: ["fn f(a: u64, b: u64) -> u64 {", "    a + b", "}"],
  signature: "f(a: u64, b: u64) -> u64",
  typeShapes: ["struct Budget { bytes: u64 }"],
  callSites: [{ file: "src/warm.rs", line: 12, text: "f(lod, shard)" }],
  callees: [{ name: "read_dir", doc: "Reads a directory." }],
};

test("2: fixContextLine names every block that is present, and the arm", () => {
  const line = fixContextLine("E", FULL);
  assert.match(line, /^\[critique\] /, "every gesture line carries the prefix");
  assert.match(line, /arm E/);
  assert.match(line, /3 function lines/);
  assert.match(line, /a parsed signature/);
  assert.match(line, /1 type-shape line\b/, "a count of one is singular");
  assert.match(line, /1 upstream call site\b/);
  assert.match(line, /1 callee\b/);
});

test("3: fixContextLine names what is ABSENT rather than leaving it out", () => {
  // A block that was tried and produced nothing must be visible, or an arm that
  // silently carried three of its five blocks gets measured as that arm.
  const line = fixContextLine("E", { functionText: ["fn f() {}"], signature: "f()" });
  assert.match(line, /no type-shape lines/);
  assert.match(line, /no upstream call sites/);
  assert.match(line, /no callees/);
});

test("4: an empty context still renders, and every clause reads as an absence", () => {
  const line = fixContextLine("A", {});
  assert.match(line, /arm A/);
  assert.match(line, /no function lines/);
  assert.match(line, /no parsed signature/);
  assert.match(line, /no type-shape lines/);
  assert.match(line, /no upstream call sites/);
  assert.match(line, /no callees/);
});

test("5: a malformed context does not throw, because every leg is best effort", () => {
  // The legs are filled from language servers and each one can hand back
  // anything. A channel line that throws would take the whole gesture down
  // after the card was already computed.
  assert.doesNotThrow(() => fixContextLine("E", undefined));
  assert.doesNotThrow(() => fixContextLine("E", { functionText: "not an array" }));
  assert.doesNotThrow(() => fixContextLine("E", { typeShapes: { length: -3 } }));
  assert.doesNotThrow(() => fixContextLine("E", { callSites: { length: NaN } }));
  assert.strictEqual(typeof fixContextLine("E", { signature: 42 }), "string");
});

// ---------------------------------------------------------------------------
// The two spellings, and they may never merge.
// ---------------------------------------------------------------------------

test("6: a refusal names the dimension, the reason, and the fallback in one line", () => {
  const line = fixRefusedLine("adjacent-params", "the model answered with nothing");
  assert.match(line, /adjacent-params/);
  assert.match(line, /the model answered with nothing/);
  assert.match(
    line,
    /table/,
    "a refusal that does not name the fallback reads as a comment gone missing; the comment is there",
  );
});

test("7: an unreachable round and a refused sentence do not share a spelling", () => {
  const refused = fixRefusedLine("clock", "the model asked a question instead of giving an order");
  const down = fixUnreachableLine("clock", "connect ECONNREFUSED 127.0.0.1:11434");
  assert.notStrictEqual(refused, down);
  assert.match(down, /never reached the model/);
  assert.strictEqual(
    /never reached the model/.test(refused),
    false,
    "a refusal must not borrow the outage's words: they want opposite actions from the developer",
  );
  assert.match(down, /connect ECONNREFUSED 127\.0\.0\.1:11434/);
  // And the skip line, which is neither: a closed gate asked no model anything.
  const skipped = fixSkippedLine("tier tier-disabled: the hardware tier disables function generation");
  assert.notStrictEqual(skipped, down);
  assert.notStrictEqual(skipped, refused);
});

test("8: fixedLine tallies both kinds and carries the first outage's own message", () => {
  const line = fixedLine(1, 4, [
    { dimension: "clock", kind: "unreachable", detail: "connect ECONNREFUSED 127.0.0.1:11434" },
    { dimension: "prng", kind: "unreachable", detail: "connect ECONNREFUSED 127.0.0.1:11434" },
    { dimension: "cqs", kind: "refused", detail: "the model answered with nothing" },
  ]);
  assert.match(line, /wrote 1 of 4/);
  assert.match(line, /2 never reached the model/);
  assert.match(line, /connect ECONNREFUSED 127\.0\.0\.1:11434/);
  assert.match(line, /1 refused by the gate/);
  assert.match(line, /cqs \(the model answered with nothing\)/);
});

test("9: a clean run's summary makes no claim about failures", () => {
  const line = fixedLine(2, 2, []);
  assert.match(line, /wrote 2 of 2/);
  assert.strictEqual(line.includes(";"), false, `a clean run printed a failure clause: ${line}`);
});

test("10: fixedLine survives a non-array and an unrecognised kind", () => {
  assert.doesNotThrow(() => fixedLine(0, 2, "not an array"));
  assert.doesNotThrow(() => fixedLine(0, 2, undefined));
  const odd = fixedLine(0, 1, [{ dimension: "clock", kind: "something-new", detail: "x" }]);
  assert.strictEqual(typeof odd, "string");
  assert.strictEqual(
    odd.includes("never reached the model"),
    false,
    "an unrecognised kind must not be quietly reclassified as an outage it did not report",
  );
});

// ---------------------------------------------------------------------------
// One callee's doc comment, read by the product's own doc reader.
// ---------------------------------------------------------------------------

const DOCUMENTED = {
  rust: {
    lines: [
      "/// Reads the directory.",
      "/// Second line of the block.",
      "#[inline]",
      "pub fn read_dir(path: &Path) -> u64 {",
    ],
    declLine: 3,
    name: "read_dir",
    needle: "Reads the directory.",
  },
  typescript: {
    lines: ["/**", " * Reads the directory.", " */", "export function readDir(p: string): number {"],
    declLine: 3,
    name: "readDir",
    needle: "Reads the directory.",
  },
  csharp: {
    lines: [
      "/// <summary>Reads the directory.</summary>",
      "[Obsolete]",
      "public static long ReadDir(string p)",
    ],
    declLine: 2,
    name: "ReadDir",
    needle: "Reads the directory.",
  },
  go: {
    lines: ["// ReadDir reads the directory.", "func ReadDir(p string) int64 {"],
    declLine: 1,
    name: "ReadDir",
    needle: "ReadDir reads the directory.",
  },
  python: {
    lines: ["def read_dir(p: str) -> int:", '    """Reads the directory."""', "    return 0"],
    declLine: 0,
    name: "read_dir",
    needle: "Reads the directory.",
  },
};

test("11: calleeDoc reads a doc comment in all five languages, upward and downward", () => {
  // FOUR OF THE FIVE WRITE THE DOC ABOVE THE DECLARATION AND PYTHON WRITES IT
  // INSIDE THE BODY. Reusing `docLines` is what buys that, along with the step
  // over the attribute lines that 29.2% of documented Rust functions carry.
  for (const [languageId, fixture] of Object.entries(DOCUMENTED)) {
    const lang = criticizeLangFor(languageId);
    assert.ok(lang !== undefined, `${languageId} must be a registered criticize language`);
    const doc = calleeDoc(fixture.lines, fixture.declLine, fixture.name, lang);
    assert.ok(
      doc.includes(fixture.needle),
      `${languageId}: expected the callee's doc to carry ${JSON.stringify(fixture.needle)}, got ${JSON.stringify(doc)}`,
    );
  }
});

test("12: calleeDoc takes the summary lines and stops", () => {
  const lang = criticizeLangFor("rust");
  const lines = [];
  for (let i = 1; i <= 8; i++) lines.push(`/// line ${i}`);
  lines.push("pub fn f() {}");
  const doc = calleeDoc(lines, lines.length - 1, "f", lang);
  assert.ok(doc.includes("line 1"), `the summary line must survive: ${doc}`);
  assert.strictEqual(
    doc.includes(`line ${FIX_CALLEE_DOC_LINES + 1}`),
    false,
    `the doc ran past the ${FIX_CALLEE_DOC_LINES}-line cap: ${doc}`,
  );
});

test("13: calleeDoc caps the characters, and the cut says it was cut", () => {
  const lang = criticizeLangFor("rust");
  const long = `/// ${"x".repeat(FIX_CALLEE_DOC_CHARS * 2)}`;
  const doc = calleeDoc([long, "pub fn f() {}"], 1, "f", lang);
  assert.ok(
    doc.length <= FIX_CALLEE_DOC_CHARS,
    `one callee's doc ran to ${doc.length} characters, past the ${FIX_CALLEE_DOC_CHARS} bound`,
  );
  assert.ok(doc.endsWith("..."), `a cut doc must say it was cut, or it reads as a complete one: ${doc}`);
});

test("14: an undocumented, unreadable or out-of-range callee all answer the same empty string", () => {
  // They ARE the same thing to a prompt: a callee that publishes no contract.
  // The name still reaches the model, which is the part that is worth most in
  // TypeScript, where real code documents 2.5% of its declarations.
  const lang = criticizeLangFor("rust");
  assert.strictEqual(calleeDoc(["pub fn f() {}"], 0, "f", lang), "");
  assert.strictEqual(calleeDoc(undefined, 0, "f", lang), "");
  assert.strictEqual(calleeDoc([], 0, "f", lang), "");
  assert.strictEqual(calleeDoc(["pub fn f() {}"], 9, "f", lang), "");
  assert.strictEqual(calleeDoc(["pub fn f() {}"], -1, "f", lang), "");
  assert.doesNotThrow(() => calleeDoc(["pub fn f() {}"], 1.5, "f", lang));
});

// ---------------------------------------------------------------------------
// How a callee reaches the prompt.
// ---------------------------------------------------------------------------

const FINDING = {
  dimension: "adjacent-params",
  line: 6,
  evidence: "pub fn warm_fs_metadata(root: &Path, shard: u64, lod: u64) -> u64 {",
  detail: "shard and lod are neighbours of type u64",
};

test("15: an undocumented callee renders as its NAME, never as a dangling colon", () => {
  const prompt = buildFixPrompt(FINDING, "King 2019", "Give them distinct types.", {
    callees: [{ name: "readDir", doc: "" }],
  }, "E");
  assert.match(prompt, /readDir/);
  assert.strictEqual(
    /readDir:\s*$/m.test(prompt),
    false,
    "a name followed by an empty promise reads as a doc that said nothing. Real TypeScript "
      + "documents 2.5% of its declarations, so this is the COMMON rendering, not the rare one.",
  );
});

test("16: a documented callee still renders its name and its doc", () => {
  const prompt = buildFixPrompt(FINDING, "King 2019", "Give them distinct types.", {
    callees: [{ name: "readDir", doc: "Reads the directory." }],
  }, "E");
  assert.match(prompt, /readDir: Reads the directory\./);
});
