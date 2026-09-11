// Adversarial review evidence for session-v68 phases 8 and 9.
//
// WHITE BOX. Every row here is a defect claim with a runnable case behind it,
// written to FAIL against the working tree at the time of review. A green row
// in this file means the defect it names has been closed.
//
// Reviewed artifact, pinned:
//   src/core/instructPostprocess.ts  md5 a8e41f5e9cb74fe944c48be53a6fcb62
//   src/core/tddTable.ts             md5 51f9506773218a0e7920effbe4246ebb  (post rule-11 iterableAt)
//
// Rules cited are from session-v68/contracts/P8-bare-reply.md and
// session-v68/contracts/P9-annotated-table.md.
//
// NOT REPORTED HERE, because they are known and accepted:
//   - extractTestFunctions counts on the RUST neutralisation lens for all five
//     languages, so a TypeScript single-quoted string inflates testCount. Two
//     rows of test/blind-v68-p8-bare-reply.test.cjs are red for that already.
//   - The bare path refuses a reply that documents its tests with a fenced
//     example (P8 amendment 2).
//
// Run: SKIP_LIVE=1 node --test test/review-v68-p89.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "review-v68-p89",
    `export { extractTestModule, extractTestFunctions } from "../src/core/instructPostprocess";\n` +
      `export { tddLangFor } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const rtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed: ${bundleError}`);
    return fn(ctx);
  });

const extract = (languageId, reply) =>
  languageId === "rust" ? mod.extractTestModule(reply) : mod.extractTestFunctions(reply, languageId);

const spansOf = (languageId, frameworkId, text) =>
  mod
    .tddLangFor(languageId)
    .frameworks.find((f) => f.id === frameworkId)
    .expectedValueSpans(text)
    .map((s) => text.slice(s.start, s.end));

const refused = (languageId, reply, why) =>
  assert.strictEqual(
    extract(languageId, reply),
    undefined,
    `${why}\n---- REPLY ----\n${reply}\n---- WHAT WAS ADMITTED ----\n${JSON.stringify(extract(languageId, reply), null, 2)}`
  );

// REACHABILITY of the prose rows, on the exact backend phase 8 exists to unblock.
// claudeCodeInstruct's stripOuterFence removes the first and last lines when they
// are a fence pair; it does not look at what is BETWEEN them. So a Claude Code
// reply shaped
//
//     ```rust
//     mod tests { ... }
//
//     Note: covers add(1, 2).
//     ```
//
// arrives at the extractors as code + a prose line and NO fence line anywhere,
// which is precisely the bare path. The prose does not have to be outside the
// model's fence to reach it.
//
// ===========================================================================
// P8 rule 9 - a bare reply with prose on either side is REFUSED, not spliced
//
// The tail gate is `CODE_PUNCTUATION = /[{}()[\];=]/` applied to the last
// non-blank line of the neutralised text. An English sentence carrying a call,
// a bracket or a semicolon walks straight through it, and the opener gate only
// ever reads the FIRST line, so prose UNDER the tests is unguarded except by
// that one character class.
// ===========================================================================

rtest("[P8 R1 §9] rust: a trailing prose sentence containing a call is REFUSED", () => {
  refused(
    "rust",
    `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds() {
        assert_eq!(add(1, 2), 3);
    }
}
Note: these tests cover add(1, 2) and the overflow path.`,
    "rule 9: bare tests followed by a trailing prose sentence are refused, not spliced. " +
      "The sentence balances its parens and carries `(`, so CODE_PUNCTUATION passes it and the " +
      "prose line is written into the human's source file."
  );
});

rtest("[P8 R1b §9] rust: a trailing markdown bullet list is REFUSED", () => {
  refused(
    "rust",
    `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds() {
        assert_eq!(add(1, 2), 3);
    }
}

Coverage notes:
- the zero case
- the overflow case (wrapping)`,
    "rule 9 / the contract's own framing (`is NOTHING BUT the tests`): a markdown list after the " +
      "module is admitted because its last bullet happens to carry parens."
  );
});

rtest("[P8 R2 §9 amendment 2] csharp: a LEADING prose line is REFUSED", () => {
  refused(
    "csharp",
    `using the signature above, here are the tests for the method.
using Xunit;

public class AdderTests
{
    [Fact]
    public void Adds()
    {
        Assert.Equal(3, Adder.Add(1, 2));
    }
}`,
    "rule 9 (amendment 2 extends it to LEADING prose): the opener regex accepts `using\\s`, so an " +
      "English sentence starting with `using ` opens the reply and is spliced above the usings."
  );
});

rtest("[P8 R2b §9 amendment 2] python: a LEADING prose line is REFUSED", () => {
  refused(
    "python",
    `from the docstring, parse raises ValueError on empty input.
import pytest

def test_parse_empty():
    with pytest.raises(ValueError):
        parse("")`,
    "rule 9: the opener regex accepts `from\\s`, so a sentence starting with `from ` is admitted."
  );
});

rtest("[P8 R2c §9 amendment 2] typescript: a LEADING prose line is REFUSED", () => {
  refused(
    "typescript",
    `let me know if you want more edge cases covered.
import { it, expect } from "vitest";

it("adds", () => {
  expect(add(1, 2)).toBe(3);
});`,
    "rule 9: the opener regex accepts `let\\s`, so a sentence starting with `let ` is admitted."
  );
});

rtest("[P8 R3 §3+§9] typescript: a unified DIFF is REFUSED", () => {
  refused(
    "typescript",
    `@@ -1,4 +1,9 @@
 import { add } from "./add";
+
+it("adds", () => {
+  expect(add(1, 2)).toBe(3);
+});`,
    "the reply is a patch, not source. The TS opener regex accepts a bare `@`, so a hunk header " +
      "opens the reply; the body balances; the tail carries `;`. What gets written into the test " +
      "file is `@@ -1,4 +1,9 @@` plus a column of `+` signs."
  );
});

// ===========================================================================
// P8 rule 3 - a TRUNCATED reply is refused
//
// scanBare's completeness test is a delimiter count. Python has no delimiters
// at statement or block level, so the test is close to vacuous there: 28 of the
// 107 truncation points of one well-formed two-test module are ADMITTED,
// including a `def` header with no body and an `assert` with a dangling `==`.
// Go admits a func signature with no body.
// ===========================================================================

rtest("[P8 R4 §3] python: a reply truncated at a `def` header is REFUSED", () => {
  refused(
    "python",
    `import pytest


def test_adds():`,
    "rule 3: a truncated reply is refused. This is an IndentationError the moment it is written. " +
      "The delimiter count is satisfied because Python opens no delimiter for a suite."
  );
});

rtest("[P8 R4b §3] python: a reply truncated mid-comparison is REFUSED", () => {
  refused(
    "python",
    `import pytest


def test_adds():
    assert add(1, 2) ==`,
    "rule 3: `assert add(1, 2) ==` is a SyntaxError. Its parens balance and `=` satisfies the tail " +
      "gate, so the bare path admits it."
  );
});

rtest("[P8 R5 §3] go: a reply truncated at a func signature is REFUSED", () => {
  refused(
    "go",
    `package main

import "testing"

func TestAdd(t *testing.T)`,
    "rule 3: a func declaration with no body does not compile. Its parens balance and the tail " +
      "gate sees `)`."
  );
});

// ===========================================================================
// P8 - scanBare mis-lexes four real literal forms, and REFUSES a complete reply
//
// FALSE REFUSAL, not a false admit: the gesture writes nothing and the human is
// told the model returned no usable tests. Each of these is admitted on the
// FENCED path today, so the bare path is strictly narrower than the contract's
// "every guard a fenced block is subject to, unchanged" (rule 4) implies.
// ===========================================================================

const admitted = (languageId, reply, why) =>
  assert.notStrictEqual(extract(languageId, reply), undefined, `${why}\n---- REPLY ----\n${reply}`);

rtest("[P8 R6 §3] rust: a char literal holding a double quote is not an unterminated string", () => {
  admitted(
    "rust",
    `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_quote() {
        assert_eq!(split_on('"'), 2);
    }
}`,
    "BARE_LANG_RULES.rust lists only `\"` as a quote, so the `\"` inside the char literal `'\"'` " +
      "opens a phantom string that never closes and scanBare answers undefined. The same reply " +
      "inside a fence extracts. neutralizeCommentsAndStrings (the counting lens) does track Rust " +
      "char literals; scanBare does not."
  );
});

rtest("[P8 R6b §3] csharp: a verbatim string ending in a backslash is not an unterminated string", () => {
  admitted(
    "csharp",
    String.raw`using Xunit;

public class PathTests
{
    [Fact]
    public void Normalises()
    {
        var root = @"C:\dir\";
        Assert.Equal("c:/dir/", Normalise(root));
    }
}`,
    "scanBare applies C-style backslash escaping inside every string. A C# VERBATIM string " +
      "(@\"...\") has no backslash escape, so `@\"C:\\dir\\\"` has its closing quote eaten and the " +
      "scan runs to EOF unterminated. A path fixture is the ordinary way this shape appears."
  );
});

rtest("[P8 R6c §3] go: a raw backtick string ending in a backslash is not unterminated", () => {
  admitted(
    "go",
    "package main\n\nimport \"testing\"\n\nfunc TestPath(t *testing.T) {\n\twant := `C:\\dir\\`\n\tif Clean(want) != want {\n\t\tt.Fatal(\"bad\")\n\t}\n}",
    "same mechanism as the C# row: a Go raw string has no escapes, so the trailing backslash eats " +
      "the closing backtick."
  );
});

rtest("[P8 R6d §3] typescript: an apostrophe inside a regex literal is not a string opener", () => {
  admitted(
    "typescript",
    String.raw`import { it, expect } from "vitest";

it("matches an apostrophe", () => {
  expect(/it's/.test("it's")).toBe(true);
});

it("adds", () => {
  expect(add(1, 2)).toBe(3);
});`,
    "scanBare has no regex-literal state, so the `'` in /it's/ opens a phantom string. The reply " +
      "is complete and extracts on the fenced path."
  );
});

// ===========================================================================
// P9 rule 8 - "Rust only". findAssignedTupleTable is shared with PYTHON, so it
// is not Rust only, and Python is the language the new guard is weakest in.
//
// nameBeforeAnnotation stops its backwards walk on `;`, `{` or `}` at depth 0.
// Rust ends every statement and block with one of those, so the walk cannot
// leave the binding. Python writes none of them, so the walk crosses statement
// and block boundaries for the whole 512-char budget and finds the `:` that
// ends an `if` / `for` / `while` header. The identifier in front of THAT colon
// becomes the table's name.
//
// The result is the inversion rule 5 names: a list that no runner walks gets
// its second column blanked, and the assertion's real expected value is left
// exactly as the model guessed it.
// ===========================================================================

const PY_INVERSION = `import unittest

class T(unittest.TestCase):
    def test_x(self):
        if cases:
            rows[0] = [(1, 2), (3, 4)]
        for a, b in cases:
            self.assertEqual(f(a), b)
`;

rtest("[P9 R7 §8+§5] python: `if cases:` + `rows[0] = [...]` must not be read as a table", () => {
  const got = spansOf("python", "unittest", PY_INVERSION);
  assert.deepStrictEqual(
    got,
    ["b"],
    "rule 8 says the fix is Rust only, and committed HEAD answers [\"b\"] - the inline hole in " +
      "`self.assertEqual(f(a), b)`. With phase 9 the answer becomes [\"2\",\"4\"]: the values inside " +
      "`rows[0]`, which no runner walks. The name `cases` was taken from the `if cases:` header, " +
      "not from the binding. Rule 5's inversion, in the language the contract excluded."
  );
});

rtest("[P9 R7b §8] pytest leg moves the same way", () => {
  const got = spansOf(
    "python",
    "pytest",
    `import pytest


def test_x():
    if cases:
        rows[0] = [(1, 2), (3, 4)]
    for a, b in cases:
        assert f(a) == b
`
  );
  assert.deepStrictEqual(got, ["b"], "pyTables feeds BOTH python frameworks through findAssignedTupleTable.");
});

rtest("[P9 R7c §8] python: an ANNOTATED python binding is a behaviour change in an out-of-scope language", () => {
  const got = spansOf(
    "python",
    "unittest",
    `import unittest

class T(unittest.TestCase):
    def test_x(self):
        cases: list[tuple[int, int]] = [(1, 2), (3, 4)]
        for a, b in cases:
            self.assertEqual(f(a), b)
`
  );
  assert.deepStrictEqual(
    got,
    ["b"],
    "Committed HEAD answers [\"b\"]. This row is the BENIGN half of the same widening and is here " +
      "to pin that Python moved at all: rule 8 says the fix is Rust only and asserts it of four " +
      "named finders, but the Python/unittest leg is the fifth caller of the finder that changed."
  );
});

// ===========================================================================
// P9 rule 1 - the annotation changes nothing about which values are blanked
// ===========================================================================

rtest("[P9 R8 §1] rust: an annotation that is a plain type NAME still loses the table", () => {
  const rows = `        let cases%ANN% = [
            (1, 2),
            (3, 4),
        ];
        for (a, want) in cases {
            assert_eq!(f(a), want);
        }`;
  const wrap = (b) => `#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn t() {\n${b}\n    }\n}`;
  const plain = spansOf("rust", "libtest", wrap(rows.replace("%ANN%", "")));
  const named = spansOf("rust", "libtest", wrap(rows.replace("%ANN%", ": Cases")));
  assert.deepStrictEqual(
    named,
    plain,
    "rule 1 is stated of any TYPE ANNOTATION, with no shape qualifier. `let cases: Cases = [...]` " +
      "(a type alias) ends in an identifier, so identBefore answers `Cases`, nameBeforeAnnotation " +
      "is never consulted, and walkerAfter then looks for a loop over `Cases`. Every rule-2 form " +
      "ends in `]` or `>` and passes; this one does not."
  );
});
