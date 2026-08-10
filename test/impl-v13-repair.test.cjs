// Implementer oracle (v13): the repair path knows bodyOnly (DO-1). After a
// body-only generation, repair re-resolves as bodyOnly (code = the body only), so
// the repair prompt must ask for a corrected BODY, not a full definition — else
// the model returns a whole def that splices into the body-only span and
// duplicates the header+docstring (the review BLOCKER). The reply is then indented
// to the docstring's own column (bodyIndent), not a hardcoded 4.
//
// The disobedient-model case is NOT guarded by a fragile strip anymore (dropped
// after review showed it eats legitimate bodies and misses decorated
// redeclarations); real model obedience under the body-only prompt is measured by
// the live rung (impl-v13-bodyonly-live).
//
// Run: SKIP_LIVE=1 node --test test/impl-v13-repair.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v13-repair",
  `export { assembleRepairPrompt } from "../src/core/repair";\n` +
    `export { reindentPyBlock } from "../src/core/pyExtraction";\n` +
    `export { spliceSpan } from "../src/core/span";\n`,
);
const { assembleRepairPrompt, reindentPyBlock, spliceSpan } = mod;
test.after(cleanup);

let pythonOk = true;
try {
  execFileSync("python3", ["-c", "import ast"], { stdio: "ignore" });
} catch {
  pythonOk = false;
}
const parses = (src) => {
  try {
    execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: src, stdio: ["pipe", "ignore", "pipe"] });
    return true;
  } catch {
    return false;
  }
};

const DIAG = [{ rendered: 'error: name "undefined_name" is not defined\n' }];

// ===== DO-1: the repair prompt routes body-only ============================

test("DO-1: assembleRepairPrompt(bodyOnly) asks for ONLY the corrected body, not a complete definition", () => {
  const prompt = assembleRepairPrompt({
    languageId: "python",
    docComment: "Add two ints.",
    code: "\n    return a + undefined_name",
    diagnostics: DIAG,
    kind: "function",
    bodyOnly: true,
  });
  assert.ok(!/complete function definition|complete .* definition/i.test(prompt), "must NOT ask for the complete definition");
  assert.ok(/only the corrected body/i.test(prompt), "must ask for only the corrected body");
  assert.ok(/(not|n't)[\s\S]{0,80}(signature|header|docstring)/i.test(prompt), "must tell the model not to repeat the signature/header/docstring");
});

test("FROZEN: assembleRepairPrompt without bodyOnly is unchanged (function keeps the v1 repair instruction)", () => {
  const base = { languageId: "python", code: "    return 1", diagnostics: DIAG };
  const prompt = assembleRepairPrompt(base);
  assert.ok(prompt.includes("corrected complete function definition, signature and body"), "the v1 repair instruction is unchanged when bodyOnly is omitted");
  assert.strictEqual(prompt, assembleRepairPrompt({ ...base, bodyOnly: false }), "bodyOnly:false is a no-op vs omitted");
});

// ===== The obedient-body repair splice stays valid + docstring once ========

// [name, doc, docstring, bodyIndent, modelBodyReply]
const REPAIR_CASES = [
  ["4-space file", 'def add(a, b):\n    """Add two ints."""\n    return a + undefined_name\n', '"""Add two ints."""', "    ", "return a + b"],
  ["2-space file (BLOCKER fix: body indents to the docstring column, not 4)", 'def add(a, b):\n  """Add two ints."""\n  return a + undefined_name\n', '"""Add two ints."""', "  ", "return a + b"],
];

for (const [name, doc, docstring, bodyIndent, reply] of REPAIR_CASES) {
  test(`repair splice stays valid + docstring once — ${name}`, () => {
    const spanStart = doc.indexOf(docstring) + docstring.length;
    const spanEnd = doc.indexOf("undefined_name") + "undefined_name".length;
    const bodyText = "\n" + reindentPyBlock(reply, bodyIndent);
    const result = spliceSpan(doc, { start: spanStart, end: spanEnd }, bodyText);
    assert.strictEqual(result.split(docstring).length - 1, 1, `the docstring appears exactly once, got:\n${result}`);
    assert.ok(result.includes(`\n${bodyIndent}return a + b`), `the body indents to the docstring column, got:\n${result}`);
    if (pythonOk) assert.ok(parses(result), `the repaired buffer must be valid Python, got:\n${result}`);
  });
}
