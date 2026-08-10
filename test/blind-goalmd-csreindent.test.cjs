// BLIND ORACLE — goal.md "broken indentation on C#/TS function generation".
// The generate splice re-indents on the Python path only (fnGen.ts gated on
// languageId==="python"); C#/TS splice the model's flush-left function verbatim,
// so the brace lands at column 0 and the body one level short. The fix mirrors
// the Python path: a `reindentCsBody(generated, indent)` sibling of
// reindentPyBody, with the SAME contract — keep line 1 (it lands after the
// buffer's existing indent), prepend `indent` to every later code line, byte-exact
// inside strings, and `indent===""` returns unchanged (top-level untouched).
//
// String-safety is the hard part: a line INSIDE a C# verbatim string (@"...")
// must never be shifted or the string's value corrupts. That is the crux case.
//
// RED by design until reindentCsBody lands. Pure; never reads src/**.
// Run: SKIP_LIVE=1 node --test test/blind-goalmd-csreindent.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleErr;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-goalmd-csreindent",
    `export { reindentCsBody } from "../src/core/csExtraction";\n`,
  ));
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());
const { reindentCsBody } = mod;

test("bundle guard: reindentCsBody is exported from csExtraction", () => {
  if (bundleErr) assert.fail(`bundle failed (reindentCsBody not yet exported): ${bundleErr.message}`);
});

// The exact bug: model emits a flush-left function; the splice needs every line
// after the header shifted by the header's indent (4 spaces here).
test("reindentCsBody: header kept, brace and body shifted by indent", () => {
  const input = [
    "public static int StripeFanout()",
    "{",
    "    var stripe = new Stripe();",
    "    return stripe.AggregateFanout();",
    "}",
  ].join("\n");
  const out = reindentCsBody(input, "    ").split("\n");
  assert.strictEqual(out[0], "public static int StripeFanout()", "line 1 (header) is untouched — the buffer already holds its indent");
  assert.strictEqual(out[1], "    {", "the opening brace is shifted to the header's column");
  assert.strictEqual(out[2], "        var stripe = new Stripe();", "body line keeps its own indent PLUS the header indent");
  assert.strictEqual(out[4], "    }", "the closing brace lands at the header's column");
});

// Top-level target (Rust-shaped, column 0): unchanged, byte for byte.
test("reindentCsBody: indent==='' returns the text unchanged", () => {
  const input = "int F()\n{\n    return 0;\n}";
  assert.strictEqual(reindentCsBody(input, ""), input);
});

// THE CRUX: a physical line INSIDE a verbatim string must NOT be shifted, or the
// string value changes.
test("reindentCsBody: a line inside a verbatim @\"...\" string is byte-exact", () => {
  const input = [
    "public string M()",
    "{",
    '    return @"line one',
    'line two";',
    "}",
  ].join("\n");
  const out = reindentCsBody(input, "    ").split("\n");
  assert.strictEqual(out[2], '        return @"line one', "the line that OPENS the verbatim string is shifted (it is code)");
  assert.strictEqual(out[3], 'line two";', "the line INSIDE the verbatim string is untouched — shifting it would corrupt the string");
  assert.strictEqual(out[4], "    }", "code after the string resumes normal shifting");
});
