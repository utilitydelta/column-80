// session-v66 adversarial review, round 2: the fixes as defect sites. Each row is a claim about
// a pure function the first round's fixes touched; a red row is the finding's evidence.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");
const bound = bundleCore("review-v66-round2-bound", 'export * from "../src/core/fimBound";\n');
const doc = bundleCore("review-v66-round2-doc", 'export * from "../src/core/dictationDoc";\n');
test.after(() => { bound.cleanup(); doc.cleanup(); });
const { boundContinuation, boundReached } = bound.mod;
const { declarationGhost } = doc.mod;
const ctx = (languageId) => ({ languageId, currentLinePrefix: "", headThroughAttributes: true });

// Finding: the trailing-comment strip in declarationGhost is not literal-aware. A default value
// holding `//` or `#` is cut as if it were a comment, and the head that opens a body is judged
// as one that does not: no body line, no closer, no docstring.
test("declarationGhost: a `//` or `#` inside a string literal in the head is not a comment", () => {
  const ts = declarationGhost('export function fetchIt(base = "https://x.y"): void {', "Fetch it.", "typescript", "\n", "", "  ");
  assert.ok(ts.text.endsWith("{\n  \n}"), `the TS head opened a body and the ghost must close it: ${JSON.stringify(ts.text)}`);
  const py = declarationGhost('def split(s: str, sep: str = "#") -> list[str]:', "Split it.", "python", "\n", "", "    ");
  assert.ok(py.text.includes('"""Split it."""'), `the Python head opened a body and the docstring must follow: ${JSON.stringify(py.text)}`);
  const cs = declarationGhost('public static string Tag(string channel = "#general")', "Tag it.", "csharp", "\n", "", "    ");
  assert.ok(cs.text.endsWith("{\n    \n}"), `the C# head ended its parameter list and the Allman body must follow: ${JSON.stringify(cs.text)}`);
});

// Finding: boundReached counts the cap from the first content line (the attribute), computeBound
// counts it from the head. The stream stops on a prefix whose bound is not what the whole
// generation's bound is, which is the invariant boundReached's own doc states.
test("boundReached and boundContinuation agree on a dictated head under attribute lines", () => {
  const whole = "#[inline]\npub fn place(\n    name: &str,\n    x: f64,\n    y: f64,\n) {\n    todo!()\n}\n";
  const lines = whole.split("\n");
  for (let n = 1; n < lines.length; n++) {
    const prefix = lines.slice(0, n).join("\n") + "\n";
    if (boundReached(prefix, ctx("rust"))) {
      assert.strictEqual(
        boundContinuation(prefix, ctx("rust")).text,
        boundContinuation(whole, ctx("rust")).text,
        `decided at ${n} complete lines, but the prefix serves a different cut than the whole generation`,
      );
    }
  }
});

test("a decided prefix never serves nothing where the whole generation serves a head (three attributes over a call)", () => {
  // AMENDED after the fix (finding 2): the stop no longer counts the attribute lines, so the
  // precondition this row first asserted (a stop at four lines counted from the attribute)
  // is gone. The invariant itself is what stays pinned: at the first decided prefix, what is
  // served is not empty and equals what the whole serves.
  const whole = "#[a]\n#[b]\n#[c]\nlet v = foo(\n    1,\n    2,\n);\n";
  assert.strictEqual(boundReached("#[a]\n#[b]\n#[c]\nlet v = foo(\n", ctx("rust")), false, "an unsafe tail under attributes is not a decided cut");
  let stopAt = -1;
  for (let i = 1; i <= whole.length; i++) {
    if (boundReached(whole.slice(0, i), ctx("rust"))) { stopAt = i; break; }
  }
  assert.ok(stopAt > 0, "the stop fires somewhere on the whole");
  const served = boundContinuation(whole.slice(0, stopAt), ctx("rust"));
  assert.notStrictEqual(served.text, "", `a decided prefix serves nothing: ${JSON.stringify(served)}`);
  assert.strictEqual(served.text, boundContinuation(whole, ctx("rust")).text, "the prefix serves what the whole serves");
});
