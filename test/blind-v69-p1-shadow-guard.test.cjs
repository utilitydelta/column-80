// Blind oracle for session-v69 phase 1: the generated test must not shadow the
// function under test [session-v69/contracts/phase1-shadow-guard.md].
//
// Written from the contract alone, WITHOUT READING src/**. Not one file, not
// one grep, not one peek at src/core/tddShadow.ts. Every assertion below is
// derived from the contract's numbered rules 1-10, from the surface block, and
// from the falsification paragraph at the bottom. Nothing else.
//
// Surface exercised, exactly as the contract declares it:
//   guardShadowedTestNames(languageId, generatedTests, targetName, existingText)
//     => { text, renames: [{from, to}], refusals: [name] }
//
// EXPECTED RED: phase 1 is not implemented, so src/core/tddShadow.ts does not
// exist and the bundle cannot build. Every row below therefore fails with the
// same bundle error. That is the red-before-green state, not a harness bug: the
// bundle row names the difference explicitly. Rows FAIL rather than skip here,
// because the absence of the surface IS the finding this file exists to make.
//
// Run: SKIP_LIVE=1 node --test test/blind-v69-p1-shadow-guard.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const TAG = "blind-v69-p1-shadow-guard";

let mod = {};
// bundleCore writes its entry file BEFORE esbuild runs, so a bundle that
// throws - which is the expected state until phase 1 lands - leaves the entry
// behind. Sweep it either way rather than dropping a stray file into test/ on
// every red run.
let cleanup = () => {
  for (const f of [`.${TAG}.entry.ts`, `.${TAG}.bundle.cjs`]) {
    fs.rmSync(path.join(__dirname, f), { force: true });
  }
};
let bundleError;
try {
  ({ mod } = bundleCore(TAG, `export { guardShadowedTestNames } from "../src/core/tddShadow";\n`));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const { guardShadowedTestNames } = mod;

// Rows fail, they do not skip: while the module is missing the contract's
// surface does not exist, and that is a finding. The message separates the two
// reasons a row can be red here - "no surface yet" from "the surface answered
// wrongly" - so nobody has to guess which one they are looking at.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    assert.strictEqual(
      bundleError,
      undefined,
      `the phase 1 surface does not build, so this row is RED for absence rather than for a wrong answer.\n` +
        `Expected src/core/tddShadow.ts to export guardShadowedTestNames.\n${bundleError}`
    );
    assert.strictEqual(
      typeof guardShadowedTestNames,
      "function",
      "src/core/tddShadow.ts built but does not export guardShadowedTestNames(languageId, generatedTests, targetName, existingText)"
    );
    return fn(ctx);
  });

// ===========================================================================
// Helpers. Nothing here encodes an implementation guess: `guard` only checks
// the three fields the contract's ShadowGuardResult declares, and `wordCount`
// uses a word boundary because rule 5 speaks of a name appearing "as any other
// word" - `first_even` is not a word inside `first_even_test`.
// ===========================================================================

const TARGET = "first_even";

function guard(label, languageId, generatedTests, targetName, existingText = "") {
  let res;
  assert.doesNotThrow(() => {
    res = guardShadowedTestNames(languageId, generatedTests, targetName, existingText);
  }, `${label}: guardShadowedTestNames threw\n---- GENERATED ----\n${generatedTests}\n---- END ----`);
  assert.ok(res && typeof res === "object", `${label}: returned ${JSON.stringify(res)}, not a ShadowGuardResult`);
  assert.strictEqual(typeof res.text, "string", `${label}: ShadowGuardResult.text is not a string, got ${JSON.stringify(res.text)}`);
  assert.ok(Array.isArray(res.renames), `${label}: ShadowGuardResult.renames is not an array, got ${JSON.stringify(res.renames)}`);
  assert.ok(Array.isArray(res.refusals), `${label}: ShadowGuardResult.refusals is not an array, got ${JSON.stringify(res.refusals)}`);
  for (const r of res.renames) {
    assert.ok(
      r && typeof r.from === "string" && typeof r.to === "string",
      `${label}: a rename is not a {from, to} pair: ${JSON.stringify(r)}`
    );
  }
  return res;
}

const pairsOf = (res) => res.renames.map((r) => [r.from, r.to]);

const wordCount = (text, word) => (text.match(new RegExp(`\\b${word}\\b`, "g")) || []).length;

const dump = (label, input, res, why) =>
  `${label}: ${why}\n` +
  `  renames:  ${JSON.stringify(pairsOf(res))}\n` +
  `  refusals: ${JSON.stringify(res.refusals)}\n` +
  `---- INPUT ----\n${input}\n---- OUTPUT ----\n${res.text}\n---- END ----`;

// "The input is returned unchanged, renames empty, refusals empty." Used by
// rules 2, 3, 4 and 9, which all land on the same three assertions.
function assertUntouched(label, res, input, why) {
  assert.strictEqual(res.text, input, dump(label, input, res, `${why} - text is not BYTE-IDENTICAL to the input`));
  assert.deepStrictEqual(pairsOf(res), [], dump(label, input, res, `${why} - renames must be empty`));
  assert.deepStrictEqual(res.refusals, [], dump(label, input, res, `${why} - refusals must be empty`));
}

// ===========================================================================
// The fixtures.
// ===========================================================================

// The falsification paragraph, verbatim in spirit: "a Rust `mod tests` body
// declaring `fn first_even` and calling `first_even(xs)` inside it, with target
// `first_even`."
const DOGFOOD = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_even() {
        let xs = vec![1, 2, 3, 4];
        let expected = Some(2);
        assert_eq!(first_even(xs), expected);
    }
}
`;

const EXISTING_RS = `pub fn first_even(xs: Vec<i32>) -> Option<i32> {
    xs.into_iter().find(|n| n % 2 == 0)
}
`;

const PY_SHADOW = `from numbers_mod import *


def first_even():
    xs = [1, 2, 3, 4]
    assert first_even(xs) == 2
    assert first_even([]) is None
`;

const EXISTING_PY = `def first_even(xs):
    for n in xs:
        if n % 2 == 0:
            return n
    return None
`;

// ===========================================================================
// The surface itself.
// ===========================================================================

test("[P1 surface] the phase 1 module builds and exports guardShadowedTestNames", () => {
  assert.strictEqual(
    bundleError,
    undefined,
    `src/core/tddShadow.ts does not build. Until it does, every row in this file is RED for absence.\n${bundleError}`
  );
  assert.strictEqual(
    typeof guardShadowedTestNames,
    "function",
    "guardShadowedTestNames(languageId, generatedTests, targetName, existingText) => ShadowGuardResult"
  );
});

gtest("[P1 surface] rust: the result carries exactly text + renames + refusals, with the declared types", () => {
  const res = guard("surface shape", "rust", DOGFOOD, TARGET, EXISTING_RS);
  assert.strictEqual(typeof res.text, "string", "text is a string");
  assert.ok(Array.isArray(res.renames) && Array.isArray(res.refusals), "renames and refusals are arrays");
});

// ===========================================================================
// THE FALSIFICATION. The red-before-green case, straight out of the dogfood
// run. If exactly one row in this file has to go green for the phase to mean
// anything, it is this one.
// ===========================================================================

gtest("[P1 falsification] rust: the dogfood reply - `fn first_even` becomes `fn first_even_test` and the call still reads `first_even(xs)`", () => {
  const res = guard("dogfood", "rust", DOGFOOD, TARGET, EXISTING_RS);

  assert.deepStrictEqual(
    res.refusals,
    [],
    dump("dogfood", DOGFOOD, res, "a free replacement name was available, so nothing may be refused")
  );
  assert.deepStrictEqual(
    pairsOf(res),
    [["first_even", "first_even_test"]],
    dump("dogfood", DOGFOOD, res, "[P1 §1 + §5] the shadowing declaration is renamed to the first free name in `<target>_test`, `<target>_test_2`, ...")
  );
  assert.ok(
    res.text.includes("    fn first_even_test() {"),
    dump("dogfood", DOGFOOD, res, "[P1 falsification] \"After the guard, the declaration reads `fn first_even_test`\". In Rust a locally declared item beats a glob import, so while it reads `fn first_even` the assertion compiles as a zero-argument call to the TEST and the file does not build")
  );
  assert.ok(
    res.text.includes("        assert_eq!(first_even(xs), expected);"),
    dump("dogfood", DOGFOOD, res, "[P1 falsification + §7] \"and the call still reads `first_even(xs)`\". Rewriting the call is the failure mode that silently retargets the test at a function that does not exist")
  );
  assert.ok(
    !res.text.includes("fn first_even()"),
    dump("dogfood", DOGFOOD, res, "[P1 §1] the shadowing declaration `fn first_even()` survived the guard")
  );
});

// ===========================================================================
// Rule 1. Rust: a declaration `fn <name>` equal to the target shadows.
// ===========================================================================

gtest("[P1 §1] rust: an indented `fn first_even` inside `mod tests` is a shadowing declaration and is renamed", () => {
  const res = guard("rule 1 indented", "rust", DOGFOOD, TARGET, EXISTING_RS);
  assert.strictEqual(res.renames.length, 1, dump("rule 1 indented", DOGFOOD, res, "[P1 §1] exactly one declaration shadows the target"));
  assert.strictEqual(res.renames[0].from, TARGET, dump("rule 1 indented", DOGFOOD, res, "[P1 surface] ShadowRename.from is \"the name the model wrote\""));
});

gtest("[P1 §1] rust: `fn first_even_works` is not the target's name and is left alone", () => {
  const input = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_even_works() {
        assert_eq!(first_even(vec![1, 2]), Some(2));
    }
}
`;
  assertUntouched("rule 1 prefix", guard("rule 1 prefix", "rust", input, TARGET, EXISTING_RS), input, "[P1 §1] `<name>` must EQUAL targetName; a prefix match renames a test that never shadowed anything");
});

gtest("[P1 §1] rust: `fn not_first_even` and `fn first_even_2` are not the target's name and are left alone", () => {
  const input = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_first_even() {
        assert_eq!(first_even(vec![1, 2]), Some(2));
    }

    #[test]
    fn first_even_2() {
        assert_eq!(first_even(vec![4]), Some(4));
    }
}
`;
  assertUntouched("rule 1 suffix", guard("rule 1 suffix", "rust", input, TARGET, EXISTING_RS), input, "[P1 §1] a substring match on either side of the name is not an equality");
});

gtest("[P1 §1] rust: a reply with no `fn first_even` at all is returned byte-identical", () => {
  const input = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_the_first_even_number() {
        assert_eq!(first_even(vec![1, 2, 3, 4]), Some(2));
    }
}
`;
  assertUntouched("rule 1 clean", guard("rule 1 clean", "rust", input, TARGET, EXISTING_RS), input, "[P1 surface] \"Byte-identical to the input when nothing shadowed\"");
});

// ===========================================================================
// Rule 2. Python: only a `def <name>(` at COLUMN ZERO shadows.
// ===========================================================================

gtest("[P1 §2] python: a `def first_even(` at column zero is renamed to `test_first_even`", () => {
  const res = guard("rule 2 col zero", "python", PY_SHADOW, TARGET, EXISTING_PY);
  assert.deepStrictEqual(
    pairsOf(res),
    [["first_even", "test_first_even"]],
    dump("rule 2 col zero", PY_SHADOW, res, "[P1 §2 + §5] \"Python has the same hazard through `from mod import *` followed by `def first_even():`\". The Python sequence is `test_<target>`, `test_<target>_2`, ...")
  );
  assert.ok(
    res.text.includes("def test_first_even():"),
    dump("rule 2 col zero", PY_SHADOW, res, "[P1 §2] the module-level declaration was not rewritten")
  );
  assert.deepStrictEqual(res.refusals, [], dump("rule 2 col zero", PY_SHADOW, res, "a free name existed"));
});

gtest("[P1 §2] python: an INDENTED `def first_even` is a method and shadows nothing - byte-identical", () => {
  const input = `from numbers_mod import *


class TestFirstEven:
    def first_even(self):
        assert first_even([1, 2, 3, 4]) == 2
`;
  assertUntouched(
    "rule 2 method",
    guard("rule 2 method", "python", input, TARGET, EXISTING_PY),
    input,
    "[P1 §2] \"An indented `def` is a method or a closure and shadows nothing at module scope\". Renaming a method changes the test class's own API for no reason"
  );
});

gtest("[P1 §2] python: an indented `def first_even` closure inside a test function shadows nothing - byte-identical", () => {
  const input = `from numbers_mod import *


def test_first_even_handles_empty():
    def first_even(xs):
        return None

    assert first_even([]) is None
`;
  assertUntouched(
    "rule 2 closure",
    guard("rule 2 closure", "python", input, TARGET, EXISTING_PY),
    input,
    "[P1 §2] a closure is indented, and rule 2 scopes the hazard to column zero"
  );
});

gtest("[P1 §2] python: `def first_even_works(` at column zero is not the target's name - byte-identical", () => {
  const input = `from numbers_mod import *


def first_even_works():
    assert first_even([1, 2]) == 2
`;
  assertUntouched("rule 2 prefix", guard("rule 2 prefix", "python", input, TARGET, EXISTING_PY), input, "[P1 §2] `<name>` must EQUAL targetName");
});

gtest("[P1 §2] python: `first_even = 3` at column zero is an assignment, not a `def <name>(` - byte-identical", () => {
  const input = `from numbers_mod import *

first_even_expected = 2


def test_it():
    assert first_even([1, 2]) == first_even_expected
`;
  assertUntouched("rule 2 assign", guard("rule 2 assign", "python", input, TARGET, EXISTING_PY), input, "[P1 §2] rule 2 names a `def <name>(` declaration and nothing else");
});

// ===========================================================================
// Rule 3. Six languages where no shadowing is possible. One row each. Each
// fixture is deliberately adversarial: it carries the exact Rust and Python
// declaration TEXT that rules 1 and 2 act on, so a guard that dispatches on
// the text rather than on the languageId turns these red.
// ===========================================================================

const GO_TESTS = `func TestFirstEven(t *testing.T) {
	// the model sometimes leaves this behind: fn first_even() {} / def first_even():
	got := FirstEven([]int{1, 2, 3, 4})
	if got != 2 {
		t.Errorf("FirstEven() = %v, want 2", got)
	}
}

func first_even(xs []int) int {
	return 0
}
`;

const CS_TESTS = `public class FirstEvenTests
{
    // fn first_even() {} and def first_even(): are not C#
    [Fact]
    public void first_even()
    {
        Assert.Equal(2, Numbers.first_even(new[] { 1, 2, 3, 4 }));
    }
}
`;

const TS_TESTS = `describe("first_even", () => {
  // fn first_even() {} / def first_even():
  it("first_even returns the first even number", () => {
    expect(first_even([1, 2, 3, 4])).toBe(2);
  });
});

function first_even(xs: number[]): number | undefined {
  return undefined;
}
`;

const TSX_TESTS = `describe("<FirstEven />", () => {
  // fn first_even() {} / def first_even():
  it("first_even renders the first even number", () => {
    render(<FirstEven xs={[1, 2, 3, 4]} />);
    expect(first_even([1, 2, 3, 4])).toBe(2);
  });
});
`;

const JS_TESTS = `describe("first_even", () => {
  // fn first_even() {} / def first_even():
  it("first_even returns the first even number", () => {
    expect(first_even([1, 2, 3, 4])).toBe(2);
  });
});

function first_even(xs) {
  return undefined;
}
`;

const JSX_TESTS = `describe("<FirstEven />", () => {
  // fn first_even() {} / def first_even():
  it("first_even renders the first even number", () => {
    render(<FirstEven xs={[1, 2, 3, 4]} />);
    expect(first_even([1, 2, 3, 4])).toBe(2);
  });
});
`;

const NO_SHADOW_LANGS = [
  ["go", GO_TESTS, "a Go test is `func TestXxx`"],
  ["csharp", CS_TESTS, "a C# test is a method on a test class"],
  ["typescript", TS_TESTS, "a TypeScript test is a string argument to `it(...)`"],
  ["typescriptreact", TSX_TESTS, "a TypeScript test is a string argument to `it(...)`"],
  ["javascript", JS_TESTS, "a JavaScript test is a string argument to `it(...)`"],
  ["javascriptreact", JSX_TESTS, "a JavaScript test is a string argument to `it(...)`"],
];

for (const [languageId, input, why] of NO_SHADOW_LANGS) {
  gtest(`[P1 §3] ${languageId}: no shadowing is possible - the input is returned unchanged, renames empty, refusals empty (${why})`, () => {
    assertUntouched(
      `rule 3 ${languageId}`,
      guard(`rule 3 ${languageId}`, languageId, input, TARGET, EXISTING_RS),
      input,
      `[P1 §3] "${why}". This fixture carries the literal text \`fn first_even() {}\` and \`def first_even():\` in a comment, so a guard dispatching on the TEXT instead of the languageId rewrites a comment in a language that has no hazard`
    );
  });
}

// ===========================================================================
// Rule 4. An unregistered languageId. It never throws.
// ===========================================================================

const UNREGISTERED = [
  ["ruby", "a language the product does not support at all"],
  ["plaintext", "the languageId VS Code gives an unsaved buffer"],
  ["", "the empty string"],
  ["Rust", "the right language, the WRONG CASE - rule 1 says `languageId === \"rust\"`"],
  ["Python", "the right language, the WRONG CASE - rule 2 says `languageId === \"python\"`"],
  ["rust-analyzer", "a server id that merely starts with `rust`"],
];

for (const [languageId, why] of UNREGISTERED) {
  gtest(`[P1 §4] ${JSON.stringify(languageId)}: an unregistered languageId returns the input unchanged, empty, empty, and never throws (${why})`, () => {
    assertUntouched(
      `rule 4 ${languageId}`,
      guard(`rule 4 ${languageId}`, languageId, DOGFOOD, TARGET, EXISTING_RS),
      DOGFOOD,
      `[P1 §4] "An unregistered languageId returns the input unchanged, empty, empty. It never throws." (${why}). The fixture is the Rust dogfood reply, so a loose match on the id rewrites it`
    );
  });
}

// ===========================================================================
// Rule 5. The replacement name, and what makes a name FREE.
// ===========================================================================

gtest("[P1 §5] rust: the first replacement is `<target>_test`", () => {
  const res = guard("rule 5 rust first", "rust", DOGFOOD, TARGET, EXISTING_RS);
  assert.deepStrictEqual(
    pairsOf(res),
    [["first_even", "first_even_test"]],
    dump("rule 5 rust first", DOGFOOD, res, "[P1 §5] \"For Rust, the first free name in the sequence `<target>_test`, `<target>_test_2`, `<target>_test_3`, ...\"")
  );
});

gtest("[P1 §5] rust: `<target>_test` DECLARED in generatedTests is taken, so the rename is `<target>_test_2`", () => {
  const input = `#[cfg(test)]
mod tests {
    use super::*;

    fn first_even_test() -> Vec<i32> {
        vec![1, 2, 3, 4]
    }

    #[test]
    fn first_even() {
        assert_eq!(first_even(first_even_test()), Some(2));
    }
}
`;
  const res = guard("rule 5 taken in generated", "rust", input, TARGET, EXISTING_RS);
  assert.deepStrictEqual(
    pairsOf(res),
    [["first_even", "first_even_test_2"]],
    dump("rule 5 taken in generated", input, res, "[P1 §5] \"A name is FREE when it appears as neither a declaration nor any other word in `generatedTests`\". `first_even_test` is declared AND called here, so the sequence must advance")
  );
  assert.ok(
    res.text.includes("fn first_even_test() -> Vec<i32> {"),
    dump("rule 5 taken in generated", input, res, "[P1 §7] the helper that already owned the name was rewritten")
  );
});

gtest("[P1 §5] rust: `<target>_test` appearing as any other WORD in generatedTests is taken, so the rename is `<target>_test_2`", () => {
  const input = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_even() {
        // paired with first_even_test in the integration suite
        assert_eq!(first_even(vec![1, 2, 3, 4]), Some(2));
    }
}
`;
  const res = guard("rule 5 word in generated", "rust", input, TARGET, EXISTING_RS);
  assert.deepStrictEqual(
    pairsOf(res),
    [["first_even", "first_even_test_2"]],
    dump("rule 5 word in generated", input, res, "[P1 §5] the clause is \"neither a declaration NOR ANY OTHER WORD in generatedTests\", with no carve-out for comments. Reusing a name a comment already refers to is exactly the collision the sequence exists to avoid")
  );
});

gtest("[P1 §5] rust: `<target>_test` DECLARED in existingText is taken, so the rename is `<target>_test_2`", () => {
  const existing = `${EXISTING_RS}
#[cfg(test)]
mod other_tests {
    use super::*;

    #[test]
    fn first_even_test() {
        assert_eq!(first_even(vec![2]), Some(2));
    }
}
`;
  const res = guard("rule 5 taken in existing", "rust", DOGFOOD, TARGET, existing);
  assert.deepStrictEqual(
    pairsOf(res),
    [["first_even", "first_even_test_2"]],
    dump("rule 5 taken in existing", DOGFOOD, res, "[P1 §5] \"and as no declaration in `existingText`\". The generated tests land in THAT file, so a name already declared there is a compile error waiting")
  );
});

gtest("[P1 §5] rust: `<target>_test` merely MENTIONED in existingText is still free - only a declaration there takes it", () => {
  const existing = `${EXISTING_RS}
// first_even_test lives in tests/integration.rs, not here
`;
  const res = guard("rule 5 mention in existing", "rust", DOGFOOD, TARGET, existing);
  assert.deepStrictEqual(
    pairsOf(res),
    [["first_even", "first_even_test"]],
    dump("rule 5 mention in existing", DOGFOOD, res, "[P1 §5] the existingText clause is narrower than the generatedTests clause: \"as no DECLARATION in existingText\". Skipping a perfectly free name on a mere mention walks the sequence for nothing")
  );
});

gtest("[P1 §5] python: the first replacement is `test_<target>`, not `<target>_test`", () => {
  const res = guard("rule 5 python first", "python", PY_SHADOW, TARGET, EXISTING_PY);
  assert.deepStrictEqual(
    pairsOf(res),
    [["first_even", "test_first_even"]],
    dump("rule 5 python first", PY_SHADOW, res, "[P1 §5] \"For Python, the first free name in `test_<target>`, `test_<target>_2`, `test_<target>_3`, ...\". The prefix matters: pytest collects `test_*`, so the Rust suffix form would produce a test nothing runs")
  );
});

gtest("[P1 §5] python: `test_<target>` DECLARED in existingText is taken, so the rename is `test_<target>_2`", () => {
  const existing = `${EXISTING_PY}

def test_first_even():
    assert first_even([2]) == 2
`;
  const res = guard("rule 5 python taken", "python", PY_SHADOW, TARGET, existing);
  assert.deepStrictEqual(
    pairsOf(res),
    [["first_even", "test_first_even_2"]],
    dump("rule 5 python taken", PY_SHADOW, res, "[P1 §5] the Python sequence advances on the same freeness rule as the Rust one")
  );
});

gtest("[P1 §5] python: `test_<target>` appearing as a WORD in generatedTests is taken, so the rename is `test_<target>_2`", () => {
  const input = `from numbers_mod import *


def first_even():
    # mirrors test_first_even in tests/test_numbers.py
    assert first_even([1, 2, 3, 4]) == 2
`;
  const res = guard("rule 5 python word", "python", input, TARGET, EXISTING_PY);
  assert.deepStrictEqual(
    pairsOf(res),
    [["first_even", "test_first_even_2"]],
    dump("rule 5 python word", input, res, "[P1 §5] \"neither a declaration nor any other word in generatedTests\"")
  );
});

// ===========================================================================
// Rule 6. The search is bounded at 50 candidates, and a refusal is total.
//
// The blocked sets are built programmatically: candidate 1 is `<target>_test`
// and candidate N (N > 1) is `<target>_test_N`, which is the sequence rule 5
// spells out.
// ===========================================================================

const candidate = (i) => (i === 1 ? `${TARGET}_test` : `${TARGET}_test_${i}`);
const candidatesUpTo = (n, from = 1) => {
  const out = [];
  for (let i = from; i <= n; i++) out.push(candidate(i));
  return out;
};

// Blocked as DECLARATIONS in existingText: rule 5's existingText clause.
const blockedExisting = (names) =>
  `${EXISTING_RS}
#[cfg(test)]
mod already_here {
    use super::*;

${names.map((n) => `    #[test]\n    fn ${n}() {\n        assert_eq!(first_even(vec![2]), Some(2));\n    }`).join("\n\n")}
}
`;

// Blocked as DECLARATIONS inside generatedTests itself: rule 5's other clause.
const blockedGenerated = (names) => `#[cfg(test)]
mod tests {
    use super::*;

${names.map((n) => `    fn ${n}() -> Vec<i32> {\n        vec![1, 2, 3, 4]\n    }`).join("\n\n")}

    #[test]
    fn first_even() {
        assert_eq!(first_even(vec![1, 2, 3, 4]), Some(2));
    }
}
`;

function assertRefused(label, res, input, why) {
  assert.ok(
    res.refusals.length > 0,
    dump(label, input, res, `${why} - refusals must be NON-EMPTY`)
  );
  assert.ok(
    res.refusals.includes(TARGET),
    dump(label, input, res, `[P1 §6] refusals holds "Shadowing names for which no free replacement could be found", which is ${JSON.stringify(TARGET)} here`)
  );
  assert.strictEqual(
    res.text,
    input,
    dump(label, input, res, "[P1 §6] \"`text` is then the input unchanged\". The caller REFUSES the whole pass on a non-empty refusals, so a mutated text here is a rewrite nobody will ever look at again")
  );
  assert.deepStrictEqual(
    pairsOf(res),
    [],
    dump(label, input, res, "[P1 §6] \"and `renames` is empty\"")
  );
}

gtest("[P1 §6] rust: 50 candidates all taken as declarations in existingText - the name is refused, text unchanged, renames empty", () => {
  const existing = blockedExisting(candidatesUpTo(50));
  const res = guard("rule 6 existing 50", "rust", DOGFOOD, TARGET, existing);
  assert.strictEqual(candidatesUpTo(50).length, 50, "fixture bug: the blocked set is not 50 names");
  assertRefused("rule 6 existing 50", res, DOGFOOD, "[P1 §6] \"After 50 candidates with none free, the name goes into `refusals`\"");
});

gtest("[P1 §6] rust: 50 candidates all taken as declarations inside generatedTests - the name is refused, text unchanged, renames empty", () => {
  const input = blockedGenerated(candidatesUpTo(50));
  const res = guard("rule 6 generated 50", "rust", input, TARGET, EXISTING_RS);
  assertRefused("rule 6 generated 50", res, input, "[P1 §6] the bound applies whichever clause of rule 5 makes the candidates unfree");
});

gtest("[P1 §6] rust: 60 candidates taken - refused under any reading of where the 50th candidate falls", () => {
  const existing = blockedExisting(candidatesUpTo(60));
  const res = guard("rule 6 existing 60", "rust", DOGFOOD, TARGET, existing);
  assertRefused("rule 6 existing 60", res, DOGFOOD, "[P1 §6] this row over-blocks on purpose: it is red only if the search is unbounded or the refusal is partial, never because of an off-by-one on the 50th name");
});

gtest("[P1 §6] python: 50 candidates all taken in existingText - the name is refused, text unchanged, renames empty", () => {
  const pyCandidate = (i) => (i === 1 ? `test_${TARGET}` : `test_${TARGET}_${i}`);
  const blocked = [];
  for (let i = 1; i <= 50; i++) blocked.push(pyCandidate(i));
  const existing = `${EXISTING_PY}

${blocked.map((n) => `def ${n}():\n    assert first_even([2]) == 2`).join("\n\n")}
`;
  const res = guard("rule 6 python 50", "python", PY_SHADOW, TARGET, existing);
  assertRefused("rule 6 python 50", res, PY_SHADOW, "[P1 §6] the bound is a property of the search, not of Rust");
});

gtest("[P1 §6] rust: 49 candidates taken - the search does NOT refuse, it takes the 50th", () => {
  const existing = blockedExisting(candidatesUpTo(49));
  const res = guard("rule 6 existing 49", "rust", DOGFOOD, TARGET, existing);
  assert.deepStrictEqual(
    res.refusals,
    [],
    dump("rule 6 existing 49", DOGFOOD, res, "[P1 §6] the bound is 50 candidates. With 49 taken a free name still exists, and refusing here costs the human the whole gesture for nothing")
  );
  assert.strictEqual(res.renames.length, 1, dump("rule 6 existing 49", DOGFOOD, res, "[P1 §6] one declaration shadowed and one free name existed"));
  const taken = new Set(candidatesUpTo(49));
  assert.ok(
    !taken.has(res.renames[0].to),
    dump("rule 6 existing 49", DOGFOOD, res, `[P1 §5] the chosen name ${JSON.stringify(res.renames[0].to)} is one of the 49 already declared in existingText`)
  );
  assert.strictEqual(
    res.renames[0].to,
    candidate(50),
    dump("rule 6 existing 49", DOGFOOD, res, `[P1 §5] "the FIRST free name in the sequence". With candidates 1..49 taken the first free one is ${JSON.stringify(candidate(50))}`)
  );
});

gtest("[P1 §6] rust: a PARTIAL rename is never returned - one renameable shadow plus one unrenameable refuses the whole result", () => {
  // `first_even_test` is left free, so the FIRST declaration can be renamed.
  // Everything from `_test_2` to `_test_80` is taken, so the SECOND cannot,
  // whichever candidate the search counts as its 50th.
  const existing = blockedExisting(candidatesUpTo(80, 2));
  const input = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_even() {
        assert_eq!(first_even(vec![1, 2]), Some(2));
    }

    #[test]
    fn first_even() {
        assert_eq!(first_even(vec![3, 4]), Some(4));
    }
}
`;
  const res = guard("rule 6 partial", "rust", input, TARGET, existing);
  assertRefused("rule 6 partial", res, input, "[P1 §6] \"A partial rename is never returned: refusing one name refuses the whole result.\" A half-applied pass writes a file where one test compiles and the other still calls itself");
});

// ===========================================================================
// Rule 7. ONLY THE DECLARATION MOVES. This is the rule that, done wrong,
// corrupts every call site: a global replace of the target's name rewrites the
// calls under test as well, and the test then exercises nothing.
// ===========================================================================

const RULE7_RS = `#[cfg(test)]
mod tests {
    use super::*;

    /// first_even is the function under test.
    #[test]
    fn first_even() {
        let xs = vec![1, 2, 3, 4];
        assert_eq!(first_even(xs.clone()), Some(2));
        assert_eq!(super::first_even(vec![]), None);
        assert_eq!(first_even(first_even_input()), Some(2));
        let label = "first_even";
        assert_eq!(label, "first_even");
    }

    fn first_even_input() -> Vec<i32> {
        vec![1, 2, 3, 4]
    }
}
`;

gtest("[P1 §7] rust: every occurrence of the target that is NOT the declaration is byte-identical in the output", () => {
  const res = guard("rule 7 rust occurrences", "rust", RULE7_RS, TARGET, EXISTING_RS);
  assert.strictEqual(res.renames.length, 1, dump("rule 7 rust occurrences", RULE7_RS, res, "[P1 §1] exactly one declaration shadows"));

  const survivors = [
    "        assert_eq!(first_even(xs.clone()), Some(2));",
    "        assert_eq!(super::first_even(vec![]), None);",
    "        assert_eq!(first_even(first_even_input()), Some(2));",
    '        let label = "first_even";',
    '        assert_eq!(label, "first_even");',
    "    /// first_even is the function under test.",
    "    fn first_even_input() -> Vec<i32> {",
  ];
  for (const line of survivors) {
    assert.ok(
      res.text.includes(line),
      dump("rule 7 rust occurrences", RULE7_RS, res, `[P1 §7] "Every other occurrence of targetName in generatedTests - every call to the function under test - is byte-identical in text." This line is gone: ${JSON.stringify(line)}. A global replace here retargets the test at a function that does not exist`)
    );
  }
});

gtest("[P1 §7] rust: the word-count arithmetic is exact - exactly ONE occurrence of the target's name disappears", () => {
  const res = guard("rule 7 rust arithmetic", "rust", RULE7_RS, TARGET, EXISTING_RS);
  const before = wordCount(RULE7_RS, TARGET);
  const after = wordCount(res.text, TARGET);
  assert.ok(before >= 6, `fixture bug: the rule 7 fixture only carries ${before} occurrences of the target`);
  assert.strictEqual(
    after,
    before - 1,
    dump("rule 7 rust arithmetic", RULE7_RS, res, `[P1 §7] the input holds ${before} occurrences of \`${TARGET}\` as a whole word and the output holds ${after}. Exactly one - the declaration - may go. Anything else is call sites being rewritten (too few) or a name being introduced (too many)`)
  );
});

gtest("[P1 §7] rust: the output is the input with the DECLARATION SITE identifier substituted, and with no other edit anywhere", () => {
  const res = guard("rule 7 rust delta", "rust", DOGFOOD, TARGET, EXISTING_RS);
  assert.strictEqual(res.renames.length, 1, dump("rule 7 rust delta", DOGFOOD, res, "one declaration shadows"));
  const decl = `fn ${TARGET}(`;
  assert.strictEqual(DOGFOOD.indexOf(decl), DOGFOOD.lastIndexOf(decl), "fixture bug: the dogfood reply has more than one declaration site");
  assert.strictEqual(
    res.text,
    DOGFOOD.replace(decl, `fn ${res.renames[0].to}(`),
    dump("rule 7 rust delta", DOGFOOD, res, "[P1 §7] \"The rename rewrites the identifier at the declaration site and nothing else.\" The output is not the input with that single identifier swapped, so some other byte moved")
  );
});

gtest("[P1 §7] rust: the length delta equals exactly `to.length - from.length`", () => {
  const res = guard("rule 7 rust length", "rust", DOGFOOD, TARGET, EXISTING_RS);
  assert.strictEqual(res.renames.length, 1, dump("rule 7 rust length", DOGFOOD, res, "one declaration shadows"));
  const { from, to } = res.renames[0];
  assert.strictEqual(
    res.text.length - DOGFOOD.length,
    to.length - from.length,
    dump("rule 7 rust length", DOGFOOD, res, `[P1 §7] one identifier moved, so the text may grow by exactly ${to.length - from.length} bytes and by no more. Any other delta is a second edit`)
  );
});

gtest("[P1 §7] rust: the line count is unchanged - no line is added, removed, or re-wrapped", () => {
  const res = guard("rule 7 rust lines", "rust", RULE7_RS, TARGET, EXISTING_RS);
  assert.strictEqual(
    res.text.split("\n").length,
    RULE7_RS.split("\n").length,
    dump("rule 7 rust lines", RULE7_RS, res, "[P1 §7] renaming an identifier cannot change how many lines the reply has; the caller splices this text into a real file at a real offset")
  );
});

const RULE7_PY = `from numbers_mod import *


def first_even():
    xs = [1, 2, 3, 4]
    assert first_even(xs) == 2
    assert first_even([]) is None
    assert first_even(first_even_input()) == 2
    label = "first_even"
    assert label == "first_even"


def first_even_input():
    return [1, 2, 3, 4]
`;

gtest("[P1 §7] python: every occurrence of the target that is NOT the declaration is byte-identical in the output", () => {
  const res = guard("rule 7 python occurrences", "python", RULE7_PY, TARGET, EXISTING_PY);
  assert.strictEqual(res.renames.length, 1, dump("rule 7 python occurrences", RULE7_PY, res, "[P1 §2] exactly one column-zero declaration shadows"));
  const survivors = [
    "    assert first_even(xs) == 2",
    "    assert first_even([]) is None",
    "    assert first_even(first_even_input()) == 2",
    '    label = "first_even"',
    '    assert label == "first_even"',
    "def first_even_input():",
  ];
  for (const line of survivors) {
    assert.ok(
      res.text.includes(line),
      dump("rule 7 python occurrences", RULE7_PY, res, `[P1 §7] this line is gone: ${JSON.stringify(line)}. Under \`from mod import *\` the calls resolve to the imported function; rewriting them points the test at a name that does not exist`)
    );
  }
  const before = wordCount(RULE7_PY, TARGET);
  const after = wordCount(res.text, TARGET);
  assert.strictEqual(
    after,
    before - 1,
    dump("rule 7 python occurrences", RULE7_PY, res, `[P1 §7] the input holds ${before} whole-word occurrences and the output holds ${after}; exactly one may go`)
  );
});

gtest("[P1 §7] python: the output is the input with the column-zero `def` identifier substituted, and nothing else", () => {
  const res = guard("rule 7 python delta", "python", PY_SHADOW, TARGET, EXISTING_PY);
  assert.strictEqual(res.renames.length, 1, dump("rule 7 python delta", PY_SHADOW, res, "one declaration shadows"));
  const decl = `\ndef ${TARGET}(`;
  assert.strictEqual(PY_SHADOW.indexOf(decl), PY_SHADOW.lastIndexOf(decl), "fixture bug: more than one column-zero declaration");
  assert.strictEqual(
    res.text,
    PY_SHADOW.replace(decl, `\ndef ${res.renames[0].to}(`),
    dump("rule 7 python delta", PY_SHADOW, res, "[P1 §7] \"The rename rewrites the identifier at the declaration site and nothing else\"")
  );
});

gtest("[P1 §7] rust: the trailing newline and the leading `#[cfg(test)]` attribute survive untouched", () => {
  const res = guard("rule 7 edges", "rust", DOGFOOD, TARGET, EXISTING_RS);
  assert.ok(res.text.startsWith("#[cfg(test)]\n"), dump("rule 7 edges", DOGFOOD, res, "[P1 §7] the reply's first line moved"));
  assert.ok(res.text.endsWith("}\n"), dump("rule 7 edges", DOGFOOD, res, "[P1 §7] the reply's trailing newline was eaten; the caller splices this straight into a file"));
});

// ===========================================================================
// Rule 8. Idempotent.
// ===========================================================================

gtest("[P1 §8] rust: the guard over its own output returns that text unchanged with no renames", () => {
  const once = guard("rule 8 rust pass 1", "rust", DOGFOOD, TARGET, EXISTING_RS);
  const twice = guard("rule 8 rust pass 2", "rust", once.text, TARGET, EXISTING_RS);
  assertUntouched(
    "rule 8 rust",
    twice,
    once.text,
    "[P1 §8] \"guardShadowedTestNames over its own `text` output returns that text unchanged with no renames.\" A second pass that renames again walks `_test` -> `_test_2` on every retry"
  );
});

gtest("[P1 §8] python: the guard over its own output returns that text unchanged with no renames", () => {
  const once = guard("rule 8 python pass 1", "python", PY_SHADOW, TARGET, EXISTING_PY);
  const twice = guard("rule 8 python pass 2", "python", once.text, TARGET, EXISTING_PY);
  assertUntouched("rule 8 python", twice, once.text, "[P1 §8] idempotence holds in both registered languages");
});

gtest("[P1 §8] rust: idempotence holds on the multi-shadow reply too, where two names were consumed", () => {
  const input = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_even() {
        assert_eq!(first_even(vec![1, 2]), Some(2));
    }

    #[test]
    fn first_even() {
        assert_eq!(first_even(vec![3, 4]), Some(4));
    }
}
`;
  const once = guard("rule 8 multi pass 1", "rust", input, TARGET, EXISTING_RS);
  const twice = guard("rule 8 multi pass 2", "rust", once.text, TARGET, EXISTING_RS);
  assertUntouched("rule 8 multi", twice, once.text, "[P1 §8 + §10] after two renames the reply declares neither the target's name nor anything that shadows it");
});

// ===========================================================================
// Rule 9. Comments and strings are not declarations.
// ===========================================================================

gtest("[P1 §9] rust: `// fn first_even() {}` in a comment is not a declaration - byte-identical", () => {
  const input = `#[cfg(test)]
mod tests {
    use super::*;

    // fn first_even() {} is what the model used to write here
    #[test]
    fn returns_two() {
        assert_eq!(first_even(vec![1, 2, 3, 4]), Some(2));
    }
}
`;
  assertUntouched(
    "rule 9 rust comment",
    guard("rule 9 rust comment", "rust", input, TARGET, EXISTING_RS),
    input,
    "[P1 §9] \"`// fn first_even() {}` in Rust ... [is] not renamed.\" Rewriting a comment is a visible edit the human did not ask for, and it happens on a reply that never shadowed anything"
  );
});

gtest("[P1 §9] rust: `\"fn first_even\"` inside a string literal is not a declaration - byte-identical", () => {
  const input = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_name() {
        let decl = "fn first_even";
        assert_eq!(decl, "fn first_even");
        assert_eq!(first_even(vec![2]), Some(2));
    }
}
`;
  assertUntouched(
    "rule 9 rust string",
    guard("rule 9 rust string", "rust", input, TARGET, EXISTING_RS),
    input,
    "[P1 §9] \"Neither is `\\\"fn first_even\\\"` inside a string literal.\" Editing inside a literal changes what the test asserts"
  );
});

gtest("[P1 §9] rust: a real declaration next to a commented one renames ONLY the real one, and leaves the comment byte-identical", () => {
  const input = `#[cfg(test)]
mod tests {
    use super::*;

    // fn first_even() {} used to break the build here
    #[test]
    fn first_even() {
        let decl = "fn first_even";
        assert_eq!(decl, "fn first_even");
        assert_eq!(first_even(vec![1, 2, 3, 4]), Some(2));
    }
}
`;
  const res = guard("rule 9 rust mixed", "rust", input, TARGET, EXISTING_RS);
  assert.strictEqual(
    res.renames.length,
    1,
    dump("rule 9 rust mixed", input, res, "[P1 §9] exactly ONE of the three `fn first_even` occurrences is a declaration; the comment and the two string literals are not")
  );
  assert.ok(
    res.text.includes("    // fn first_even() {} used to break the build here"),
    dump("rule 9 rust mixed", input, res, "[P1 §9] the comment was rewritten")
  );
  assert.ok(
    res.text.includes('        let decl = "fn first_even";'),
    dump("rule 9 rust mixed", input, res, "[P1 §9] the string literal was rewritten")
  );
  assert.ok(
    res.text.includes(`    fn ${res.renames[0].to}() {`),
    dump("rule 9 rust mixed", input, res, "[P1 §1] the real declaration was not renamed")
  );
});

gtest("[P1 §9] python: `# def first_even():` in a comment is not a declaration - byte-identical", () => {
  const input = `from numbers_mod import *

# def first_even():
#     the shape that shadows the import


def test_returns_two():
    assert first_even([1, 2, 3, 4]) == 2
`;
  assertUntouched(
    "rule 9 python comment",
    guard("rule 9 python comment", "python", input, TARGET, EXISTING_PY),
    input,
    "[P1 §9] \"`# def first_even():` in Python [is] not renamed\". Note the `#` puts the comment at column zero, which is precisely where rule 2 looks"
  );
});

gtest("[P1 §9] python: `\"def first_even(\"` inside a string literal is not a declaration - byte-identical", () => {
  const input = `from numbers_mod import *

DECL = "def first_even("


def test_reports_the_name():
    assert DECL == "def first_even("
    assert first_even([1, 2]) == 2
`;
  assertUntouched(
    "rule 9 python string",
    guard("rule 9 python string", "python", input, TARGET, EXISTING_PY),
    input,
    "[P1 §9] a string literal is not a declaration in either language"
  );
});

gtest("[P1 §9] python: a triple-quoted docstring holding `def first_even():` is not a declaration - byte-identical", () => {
  const input = `from numbers_mod import *


def test_returns_two():
    """Regression for the shadowing shape:

    def first_even():
        ...
    """
    assert first_even([1, 2, 3, 4]) == 2
`;
  assertUntouched(
    "rule 9 python docstring",
    guard("rule 9 python docstring", "python", input, TARGET, EXISTING_PY),
    input,
    "[P1 §9] a docstring is a string literal. This one is indented as well, so rule 2 already excludes it; the row pins both reasons at once"
  );
});

gtest("[P1 §9] python: a real declaration next to a commented one renames ONLY the real one", () => {
  const input = `from numbers_mod import *

# def first_even():


def first_even():
    assert first_even([1, 2, 3, 4]) == 2
`;
  const res = guard("rule 9 python mixed", "python", input, TARGET, EXISTING_PY);
  assert.strictEqual(
    res.renames.length,
    1,
    dump("rule 9 python mixed", input, res, "[P1 §9] the commented `def` sits at column zero too, so a column-zero test that ignores the `#` renames both")
  );
  assert.ok(
    res.text.includes("# def first_even():"),
    dump("rule 9 python mixed", input, res, "[P1 §9] the comment was rewritten")
  );
});

// ===========================================================================
// Rule 10. Multiple shadows get DISTINCT names, both reported.
// ===========================================================================

const MULTI_RS = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_even() {
        assert_eq!(first_even(vec![1, 2]), Some(2));
    }

    #[test]
    fn first_even() {
        assert_eq!(first_even(vec![3, 4]), Some(4));
    }
}
`;

gtest("[P1 §10] rust: two declarations of the target's name get two DISTINCT replacement names, both reported", () => {
  const res = guard("rule 10 rust", "rust", MULTI_RS, TARGET, EXISTING_RS);
  assert.strictEqual(
    res.renames.length,
    2,
    dump("rule 10 rust", MULTI_RS, res, "[P1 §10] \"A reply declaring the target's name twice gets two DISTINCT replacement names, BOTH REPORTED in `renames`.\" The channel line names every rename, so a missing entry is a silent edit")
  );
  assert.notStrictEqual(
    res.renames[0].to,
    res.renames[1].to,
    dump("rule 10 rust", MULTI_RS, res, "[P1 §10] the two names are identical, so the reply now declares the SAME function twice and still does not build")
  );
  assert.deepStrictEqual(
    res.renames.map((r) => r.from),
    [TARGET, TARGET],
    dump("rule 10 rust", MULTI_RS, res, "[P1 surface] both renames report the name the model wrote")
  );
  assert.deepStrictEqual(res.refusals, [], dump("rule 10 rust", MULTI_RS, res, "two free names existed"));
});

gtest("[P1 §10 + §5] rust: the two names are the first two free names in the sequence, in that order", () => {
  const res = guard("rule 10 sequence", "rust", MULTI_RS, TARGET, EXISTING_RS);
  assert.deepStrictEqual(
    pairsOf(res),
    [
      ["first_even", "first_even_test"],
      ["first_even", "first_even_test_2"],
    ],
    dump("rule 10 sequence", MULTI_RS, res, "[P1 §5 + §10] the sequence is `<target>_test`, `<target>_test_2`, ... and rule 10 requires the second declaration to take the next one")
  );
});

gtest("[P1 §10] rust: renames are reported \"in the order the declarations appear\"", () => {
  const res = guard("rule 10 order", "rust", MULTI_RS, TARGET, EXISTING_RS);
  assert.strictEqual(res.renames.length, 2, dump("rule 10 order", MULTI_RS, res, "[P1 §10] two renames"));
  const first = res.text.indexOf(res.renames[0].to);
  const second = res.text.indexOf(res.renames[1].to);
  assert.ok(first >= 0 && second >= 0, dump("rule 10 order", MULTI_RS, res, "[P1 §10] a reported replacement name is not in the output text at all"));
  assert.ok(
    first < second,
    dump("rule 10 order", MULTI_RS, res, "[P1 surface] \"Every rename applied, IN THE ORDER THE DECLARATIONS APPEAR.\" renames[0] landed after renames[1] in the text")
  );
});

gtest("[P1 §10 + §7] rust: both calls under test survive two renames byte-identical", () => {
  const res = guard("rule 10 calls", "rust", MULTI_RS, TARGET, EXISTING_RS);
  assert.ok(
    res.text.includes("        assert_eq!(first_even(vec![1, 2]), Some(2));"),
    dump("rule 10 calls", MULTI_RS, res, "[P1 §7] the first test's call was rewritten")
  );
  assert.ok(
    res.text.includes("        assert_eq!(first_even(vec![3, 4]), Some(4));"),
    dump("rule 10 calls", MULTI_RS, res, "[P1 §7] the second test's call was rewritten")
  );
  assert.strictEqual(
    wordCount(res.text, TARGET),
    wordCount(MULTI_RS, TARGET) - 2,
    dump("rule 10 calls", MULTI_RS, res, "[P1 §7 + §10] exactly two occurrences - the two declarations - may disappear")
  );
});

gtest("[P1 §10] python: two column-zero declarations get two DISTINCT replacement names, both reported", () => {
  const input = `from numbers_mod import *


def first_even():
    assert first_even([1, 2]) == 2


def first_even():
    assert first_even([3, 4]) == 4
`;
  const res = guard("rule 10 python", "python", input, TARGET, EXISTING_PY);
  assert.strictEqual(res.renames.length, 2, dump("rule 10 python", input, res, "[P1 §10] both declarations are reported"));
  assert.notStrictEqual(res.renames[0].to, res.renames[1].to, dump("rule 10 python", input, res, "[P1 §10] the two replacement names collide"));
  assert.deepStrictEqual(
    pairsOf(res),
    [
      ["first_even", "test_first_even"],
      ["first_even", "test_first_even_2"],
    ],
    dump("rule 10 python", input, res, "[P1 §5 + §10] the Python sequence, taken in declaration order")
  );
});

gtest("[P1 §10 + §2] python: one column-zero declaration and one INDENTED one produce exactly ONE rename", () => {
  const input = `from numbers_mod import *


def first_even():
    def first_even(xs):
        return None

    assert first_even([1, 2, 3, 4]) == 2
`;
  const res = guard("rule 10 python mixed depth", "python", input, TARGET, EXISTING_PY);
  assert.strictEqual(
    res.renames.length,
    1,
    dump("rule 10 python mixed depth", input, res, "[P1 §2 + §10] only the column-zero `def` shadows at module scope; the nested one is a closure")
  );
  assert.ok(
    res.text.includes("    def first_even(xs):"),
    dump("rule 10 python mixed depth", input, res, "[P1 §2] the indented closure was renamed")
  );
});
