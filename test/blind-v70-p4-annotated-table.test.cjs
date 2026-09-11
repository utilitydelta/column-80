// Blind oracle for session-v70 phase 4: the annotation GRAMMAR, from the
// outside [session-v68/contracts/P9-annotated-table.md, session-v70/goal.md
// defect 3]. Written from those two documents alone, WITHOUT READING src/** -
// not one file, not one grep, not one peek at src/core/tddTable.ts or at the
// bundled source text. Every assertion below comes from the contract's numbered
// rules, from goal.md's defect 3, and from Rust and Python grammar.
//
// Surface exercised, through the public seam, as production reaches it:
//   tddLangFor, frameworkFor, blankExpectedValues   ../src/core/tddLang
//   TestFramework.expectedValueSpans(text)          off the resolved framework
//   TestFramework.unresolvedAssertions(text)        off the resolved framework
//   TddLang.deadTableColumns(text)                  off the resolved language
// No per-framework locator is imported by name.
//
// What phase 4 closes, from goal.md defect 3:
//
//     let cases: Cases = [ (1, 2), (3, 4) ];
//     for (a, want) in cases { assert_eq!(f(a), want); }
//
// A type annotation that is a plain type NAME loses the table. The same table
// unannotated is found. Every other annotation spelling ends in `]` or `>`, so
// only the name-shaped one survives as a defect. Rule 1 is stated of ANY type
// annotation with no shape qualifier, so the contract already covers it.
//
// Two ways to fail, and they are not equally expensive:
//   A LOST table.     Zero spans, zero holes, the third floor refuses, and the
//                     human gets a generated table with the model's guessed
//                     expected values already filled in. Silent-wrong.
//   An INVERTED table. Holes land somewhere that is not the expected column:
//                     inside the annotation, on a loop variable, on an input,
//                     or on the second element of a list no runner walks. The
//                     human types into the wrong place, ratifies nothing, and
//                     every guessed row ships green.
// Every message below says which one the row is holding the line on.
//
// No expected byte offset here was computed by hand. Rule 1's differential is
// exact by CONSTRUCTION: each fixture is built unannotated first, then the
// annotation is SPLICED in at a known index, so the annotated text is the
// unannotated text with `annotation.length` bytes inserted before the `=`.
// Everything else is pinned with text.indexOf(<the literal I placed there>).
//
// EXPECTED RED: the fix is being written in parallel. A failing `assert` here
// is a contract finding, which is the file's purpose. A bundling crash, or a
// TypeError on an export that should exist, would be a harness bug instead, so
// the bundle row is its own loud test and every other row skips behind it.
//
// Run: SKIP_LIVE=1 node --test test/blind-v70-p4-annotated-table.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v70-p4-annotated-table",
    `export { tddLangFor, frameworkFor, blankExpectedValues } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const { tddLangFor, frameworkFor, blankExpectedValues } = mod;

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

test("bundle: the phase 4 surface builds and exports tddLangFor + frameworkFor + blankExpectedValues [P9 'Surface under contract']", () => {
  assert.strictEqual(
    bundleError,
    undefined,
    `the bundle failed, so every row below is a harness error rather than a contract finding: ${bundleError}`
  );
  assert.strictEqual(typeof tddLangFor, "function", "tddLangFor(languageId) => TddLang | undefined");
  assert.strictEqual(typeof frameworkFor, "function", "frameworkFor(lang, root, deps)");
  assert.strictEqual(
    typeof blankExpectedValues,
    "function",
    "blankExpectedValues(lang, framework, text, returnType) => { snippet, holes, unresolved }"
  );
});

// ===========================================================================
// Resolution. Fake deps, the path production takes, with the registration
// array as a fallback ONLY so a detection wobble cannot mask the grammar
// findings this file exists to make.
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

const PYPROJECT_PYTEST = '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n';

const REACHABLE = [
  ["rust", "libtest", "/w/crate", () => depsOf(["/w/crate/Cargo.toml", "/w/crate/src/lib.rs"])],
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
];

const RESOLVED = new Map();

function resolveAll() {
  if (RESOLVED.size || bundleError) return RESOLVED;
  for (const [languageId, frameworkId, root, mkDeps] of REACHABLE) {
    const lang = tddLangFor(languageId);
    let fw;
    let viaFrameworkFor = false;
    try {
      const res = frameworkFor(lang, root, mkDeps());
      if (res && res.ok && res.framework && res.framework.id === frameworkId) {
        fw = res.framework;
        viaFrameworkFor = true;
      }
    } catch {
      /* fall through to the registration array */
    }
    if (!fw && lang && Array.isArray(lang.frameworks)) fw = lang.frameworks.find((f) => f.id === frameworkId);
    RESOLVED.set(`${languageId}/${frameworkId}`, { languageId, frameworkId, lang, fw, viaFrameworkFor });
  }
  return RESOLVED;
}

const at = (key) => {
  const r = resolveAll().get(key);
  assert.ok(r && r.fw, `${key} did not resolve at all, so no row below can run`);
  return r;
};

const fwOf = (key) => at(key).fw;
const RUST = "rust/libtest";
const PYTEST = "python/pytest";
const UNITTEST = "python/unittest";

gtest("[P9 'Surface under contract'] rust, pytest and unittest all resolve through frameworkFor and declare expectedValueSpans", () => {
  for (const key of [RUST, PYTEST, UNITTEST]) {
    const r = resolveAll().get(key);
    assert.ok(r && r.fw, `${key} did not resolve at all`);
    assert.ok(r.viaFrameworkFor, `${key} is only reachable off the registration array, not through frameworkFor`);
    assert.strictEqual(typeof r.fw.expectedValueSpans, "function", `${key}: TestFramework.expectedValueSpans(text)`);
    assert.strictEqual(typeof r.fw.unresolvedAssertions, "function", `${key}: TestFramework.unresolvedAssertions(text)`);
  }
  assert.strictEqual(typeof at(RUST).lang.deadTableColumns, "function", "TddLang(rust).deadTableColumns(text)");
});

// ===========================================================================
// Span helpers. A locator failure that does not print the span TEXTS is a
// failure nobody can act on, so every message below carries them.
// ===========================================================================

const textsOf = (text, spans) => spans.map((s) => text.slice(s.start, s.end));
const pairs = (spans) => spans.map((s) => ({ start: s.start, end: s.end }));

const show = (label, text, spans, why) =>
  `${label}: ${why}\n` +
  `  span texts: ${JSON.stringify(textsOf(text, spans))}\n` +
  `  span offsets: ${JSON.stringify(spans.map((s) => [s.start, s.end]))}\n` +
  `---- TEXT ----\n${text}\n---- END TEXT ----`;

function rangeOf(label, text, literal) {
  const start = text.indexOf(literal);
  assert.ok(start >= 0, `${label}: fixture bug, ${JSON.stringify(literal)} is not in the text`);
  assert.strictEqual(
    text.indexOf(literal, start + 1),
    -1,
    `${label}: fixture bug, ${JSON.stringify(literal)} occurs more than once so an offset pin would be ambiguous`
  );
  return { start, end: start + literal.length };
}

function spansOn(key, label, text) {
  let spans;
  assert.doesNotThrow(() => {
    spans = fwOf(key).expectedValueSpans(text);
  }, `${label}: expectedValueSpans threw.\n---- TEXT ----\n${text}\n---- END TEXT ----`);
  assert.ok(Array.isArray(spans), `${label}: expectedValueSpans did not return an array, got ${JSON.stringify(spans)}`);
  return spans;
}

const spansOf = (label, text) => spansOn(RUST, label, text);

// [P9 §5] ascending, non-overlapping, every span a real range inside the text.
// §5 calls this safety-critical: a wrong argument position blanks the call
// under test while keeping the model's guessed value, which INVERTS the
// blank-value invariant instead of merely failing it.
function assertAscending(label, text, spans) {
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    assert.ok(
      Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end <= text.length && s.start < s.end,
      show(label, text, spans, `[P9 §5] span ${i} is not a valid non-empty range inside the text`)
    );
    if (i > 0) {
      assert.ok(
        spans[i - 1].end <= s.start,
        show(label, text, spans, `[P9 §5] spans ${i - 1} and ${i} descend or overlap; blankExpectedValues's slice loop corrupts the snippet on this`)
      );
    }
  }
}

// ===========================================================================
// The Rust fixture. One table, one runner, one assertion. Only the ANNOTATION
// and the right-hand opener vary, which is exactly what the annotation grammar
// varies. The annotation is spliced in immediately after `let cases`, so the
// annotated text is the plain text with annotation.length bytes inserted.
// ===========================================================================

const MARK = "let cases";

const ROW_LINES = `
            ("alpha", 101),
            ("beta", 202),
            ("gamma", 303),
        ];`;

const WANTS = ["101", "202", "303"];
const RUNNER = "assert_eq!(shard_of(key), want);";

// `&[` yields references, so the pattern derefs. That is the compiling form,
// and grading a locator on source that could never reach a compiler is how a
// locator passes a test it should fail.
const bindsFor = (rhs) => (rhs === "&[" ? "&(key, want)" : "(key, want)");

const rustPlain = (rhs) => `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_of_cases() {
        ${MARK} = ${rhs}${ROW_LINES}
        for ${bindsFor(rhs)} in cases {
            ${RUNNER}
        }
    }
}
`;

function annIndex(plain, label) {
  const i = plain.indexOf(MARK);
  assert.ok(i >= 0, `${label}: fixture bug, ${JSON.stringify(MARK)} is not in the text`);
  assert.strictEqual(plain.indexOf(MARK, i + 1), -1, `${label}: fixture bug, ${JSON.stringify(MARK)} occurs twice`);
  return i + MARK.length;
}

function rustAnnotated(rhs, annotation, label) {
  const plain = rustPlain(rhs);
  const i = annIndex(plain, label);
  return plain.slice(0, i) + annotation + plain.slice(i);
}

// Identifiers and numbers the annotation contributes. None of these may ever
// be the text of a span: blanking one hands the human a hole where a TYPE
// belongs, and the file stops compiling.
const tokensOf = (annotation) => (annotation.match(/[A-Za-z_0-9]+/g) || []).filter((t) => t.length > 0);

// ===========================================================================
// The annotation grammar. Rule 1 is stated of ANY type annotation. goal.md
// defect 3 says the plain-NAME spelling is the one that loses the table,
// because every other spelling ends in `]` or `>`. So the list below is built
// to straddle that line: the name-shaped ones are the build, the bracket- and
// angle-shaped ones are the regression guard beside them.
// ===========================================================================

const SHAPES = [
  {
    id: "a plain alias NAME",
    annotation: ": Cases",
    rhs: "[",
    why: "goal.md defect 3, the exact spelling. identBefore answers `Cases`, the annotation branch is never entered, and walkerAfter then hunts for a loop over `Cases` and finds none",
  },
  {
    id: "a plain alias NAME, longer, with an underscore",
    annotation: ": Case_Table",
    rhs: "[",
    why: "the same class. An alias is whatever the model called it, so the fix cannot key on the literal string `Cases`",
  },
  {
    id: "a plain alias NAME over a `vec!`",
    annotation: ": CaseVec",
    rhs: "vec![",
    why: "the name-shaped annotation crossed with the `vec!` opener, which is the second-commonest table right-hand side",
  },
  {
    id: "a full crate PATH",
    annotation: ": crate::tests::Cases",
    rhs: "[",
    why: "a path ends in an identifier just like a bare name, and it carries three colons. Two of them are `::` and belong to the path; one is the binding colon. A walk that stops at the first `:` it meets lands inside `crate::`",
  },
  {
    id: "a two-segment module PATH",
    annotation: ": fixtures::Cases",
    rhs: "[",
    why: "the shortest path spelling, and the one a generated test module reaches for when the alias lives beside it",
  },
  {
    id: "a `self::` PATH",
    annotation: ": self::Cases",
    rhs: "[",
    why: "`self` is a keyword, not an ordinary identifier. A binding-keyword check that scans backwards over words can trip on it",
  },
  {
    id: "a spaced binding colon before a NAME",
    annotation: " : Cases",
    rhs: "[",
    why: "rustfmt writes `let cases: Cases`, but a model writes what it writes. Whitespace either side of the binding colon is legal Rust and must not decide whether the table is found",
  },
  {
    id: "a GENERIC ending in `>`",
    annotation: ": Vec<(&'static str, u32)>",
    rhs: "vec![",
    why: "the regression guard beside the build. This shape is in rule 2 and works today, and it carries a LIFETIME, whose apostrophe is the character a string-aware scanner mistakes for an opening quote",
  },
  {
    id: "a FIXED ARRAY ending in `]`",
    annotation: ": [(&str, u32); 3]",
    rhs: "[",
    why: "rule 2's first form. Works today and must keep working while the name-shaped walk is added beside it",
  },
  {
    id: "a fixed array whose LENGTH is a const NAME",
    annotation: ": [(&str, u32); CASE_COUNT]",
    rhs: "[",
    why: "the annotation ends in `]` but its last identifier is a name. A fix that asks `did the backwards walk land on an identifier` must not be confused by an identifier that is inside the brackets",
  },
  {
    id: "a REFERENCE with a lifetime",
    annotation: ": &'static [(&str, u32)]",
    rhs: "&[",
    why: "`&'static [...]` is what you write for a table you do not want to move. The `'` before `static` is a lifetime, not a char literal, and a scanner that reads it as one runs to the next apostrophe",
  },
  {
    id: "a plain slice REFERENCE",
    annotation: ": &[(&str, u32)]",
    rhs: "&[",
    why: "rule 2's fourth form, the lifetime elided",
  },
  {
    id: "an alias NAME nested inside a generic",
    annotation: ": Vec<(CaseKey, u32)>",
    rhs: "vec![",
    why: "the annotation ends in `>` so the old path handles it, but it holds a bare type name in the middle. Neither the name walk nor the bracket walk may read the inner name as the binding",
  },
  {
    id: "a PATH nested inside a generic",
    annotation: ": Vec<(crate::CaseKey, u32)>",
    rhs: "vec![",
    why: "`::` inside angle brackets. The nastiest combination of the two, and a model writes it whenever the column type is not in scope unqualified",
  },
  {
    id: "a NESTED generic over an array type",
    annotation: ": Vec<([u8; 4], u32)>",
    rhs: "vec![",
    why: "brackets inside angles. Rule 2 names it, and it is here as the depth-counting control",
  },
];

for (const s of SHAPES) {
  const label = s.id;
  const plain = rustPlain(s.rhs);
  const ann = rustAnnotated(s.rhs, s.annotation, label);
  const shift = s.annotation.length;

  gtest(`[P9 §1 CONTROL, unannotated] rust, rhs \`${s.rhs}\`: the table WITHOUT any annotation finds its three expected values`, () => {
    const spans = spansOf(`${label} control`, plain);
    assertAscending(`${label} control`, plain, spans);
    assert.deepStrictEqual(
      pairs(spans),
      WANTS.map((lit) => rangeOf(`${label} control`, plain, lit)),
      show(`${label} control`, plain, spans, `the UNANNOTATED baseline for rhs \`${s.rhs}\` does not find ${JSON.stringify(WANTS)}. This is the differential's baseline: a red here is the table shape or the walker, NOT the annotation, and a LOST table either way`)
    );
  });

  gtest(`[P9 §1 an annotated table is found] rust: ${label} \`${s.annotation.trim()}\` - ${s.why}`, () => {
    const spans = spansOf(label, ann);
    assertAscending(label, ann, spans);
    assert.deepStrictEqual(
      pairs(spans),
      WANTS.map((lit) => rangeOf(label, ann, lit)),
      show(label, ann, spans, `[P9 §1] "A \`let\` binding whose table is preceded by a TYPE ANNOTATION is found." Expected the three spans ${JSON.stringify(WANTS)}. Zero spans is a LOST table: no holes, the third floor refuses, and the human keeps the model's guessed expected values with nothing marking them as guesses`)
    );
  });

  gtest(`[P9 §1 DIFFERENTIAL] rust: ${label} shifts the spans by exactly the annotation's ${shift} bytes and changes nothing else`, () => {
    const a = spansOf(`${label} annotated`, ann);
    const p = spansOf(`${label} plain`, plain);
    assert.strictEqual(
      ann,
      plain.slice(0, annIndex(plain, label)) + s.annotation + plain.slice(annIndex(plain, label)),
      `${label}: fixture bug, the annotated text is not the plain text with the annotation spliced in`
    );
    // Two empty sets satisfy "the sets are equal". A differential that cannot
    // fail is worse than no differential, so the plain side has to have found
    // something for this row to mean anything.
    assert.ok(
      p.length > 0,
      `${label}: [P9 §1] this differential is VACUOUS, the unannotated form found nothing either, so "the two sets are equal" is two empty sets agreeing. See the CONTROL row for rhs \`${s.rhs}\`\n---- PLAIN ----\n${plain}\n---- END ----`
    );
    assert.deepStrictEqual(
      a.map((x) => ({ start: x.start - shift, end: x.end - shift })),
      pairs(p),
      `${label}: [P9 §1] "its spans are identical to the spans the same table produces with the annotation deleted. The annotation changes nothing about which values are blanked."\n` +
        `  annotated span texts: ${JSON.stringify(textsOf(ann, a))}\n` +
        `  plain     span texts: ${JSON.stringify(textsOf(plain, p))}\n` +
        `---- ANNOTATED ----\n${ann}\n---- PLAIN ----\n${plain}\n---- END ----`
    );
  });

  gtest(`[P9 §3 the annotation is never scanned as rows] rust: ${label} puts no span inside the annotation and none before the \`=\``, () => {
    const spans = spansOf(`${label} rule 3`, ann);
    const start = annIndex(plain, label);
    const end = start + shift;
    const eq = ann.indexOf("=", end);
    assert.ok(eq > 0, `${label}: fixture bug, no \`=\` after the annotation`);
    const banned = tokensOf(s.annotation);
    for (const x of spans) {
      assert.ok(
        x.start >= end,
        show(`${label} rule 3`, ann, spans, `[P9 §3] a span lands INSIDE the annotation ${JSON.stringify(s.annotation)} (bytes ${start}..${end}). "No span may ever fall inside an annotation." That is an INVERTED table: the hole sits where a type name belongs and the source stops compiling`)
      );
      assert.ok(
        x.start > eq,
        show(`${label} rule 3`, ann, spans, `[P9 §3] a span begins at ${x.start}, before the \`=\` at ${eq}. Every expected value is on the right-hand side of the binding, so a span left of it is the annotation being read as rows`)
      );
    }
    for (const t of textsOf(ann, spans)) {
      assert.ok(
        !banned.includes(t.trim()),
        show(`${label} rule 3`, ann, spans, `[P9 §3] the span text ${JSON.stringify(t)} is a token the annotation contributed (${JSON.stringify(banned)}). Blanking a type name is worse than finding nothing: the human is asked to type a value where a type goes`)
      );
    }
  });
}

// ===========================================================================
// The name-shaped annotation, driven all the way to the blanker and to the
// lint. Rule 1 is about spans, but the span is not what the human sees. These
// rows say what the human actually gets.
// ===========================================================================

const NAME_SHAPES = [": Cases", ": crate::tests::Cases", " : Cases"];

for (const annotation of NAME_SHAPES) {
  gtest(`[P9 'Surface under contract'] rust \`${annotation.trim()}\`: blankExpectedValues opens one hole per row and hands the runner back byte-identical`, () => {
    const { lang, fw } = at(RUST);
    const ann = rustAnnotated("[", annotation, annotation);
    const plain = rustPlain("[");
    const res = blankExpectedValues(lang, fw, ann, "u32");
    const base = blankExpectedValues(lang, fw, plain, "u32");
    assert.ok(res && typeof res.snippet === "string", `blankExpectedValues returned no snippet: ${JSON.stringify(res)}`);
    const tail = `\n---- SNIPPET ----\n${res.snippet}\n---- END SNIPPET ----`;

    assert.strictEqual(
      res.holes,
      WANTS.length,
      `[P9 §1] expected one hole per row (${WANTS.length}), got ${res.holes}. The unannotated table gives ${base.holes}. Zero holes is a LOST table: the third floor refuses, nothing is written, and the model's three guesses stand${tail}`
    );
    assert.strictEqual(
      res.holes,
      base.holes,
      `[P9 §1] the annotated table produced ${res.holes} hole(s) and the unannotated one ${base.holes}. The annotation is not allowed to change the count${tail}`
    );
    assert.ok(
      res.snippet.includes(RUNNER),
      `the runner ${JSON.stringify(RUNNER)} is not in the snippet unchanged. A hole in the runner blanks the LOOP VARIABLE, which is an INVERTED table: every guessed row ships green${tail}`
    );
    assert.ok(
      res.snippet.includes(annotation.trim()),
      `[P9 §3] the annotation ${JSON.stringify(annotation)} did not survive the blanker verbatim, so a hole was opened inside a type${tail}`
    );
  });

  gtest(`[P9 §7 unresolvedAssertions does not change its answer] rust \`${annotation.trim()}\`: annotated and unannotated report the same count`, () => {
    const ann = rustAnnotated("[", annotation, annotation);
    const plain = rustPlain("[");
    let a;
    let p;
    assert.doesNotThrow(() => {
      a = fwOf(RUST).unresolvedAssertions(ann);
      p = fwOf(RUST).unresolvedAssertions(plain);
    }, `unresolvedAssertions threw on ${JSON.stringify(annotation)}`);
    assert.strictEqual(
      a,
      p,
      `[P9 §7] the annotation changed unresolvedAssertions from ${p} to ${a}. The two texts hold the same rows and the same runner\n---- ANNOTATED ----\n${ann}\n---- END ----`
    );
  });
}

const DEAD_PLAIN = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_of_cases() {
        let cases = [
            ("alpha", 8, 4, 101),
            ("beta", 16, 8, 202),
        ];
        for (key, buckets, limit, want) in cases {
            assert_eq!(shard_of(key, buckets), want);
        }
    }
}
`;

const deadOf = (label, text) => {
  const { lang } = at(RUST);
  let got;
  assert.doesNotThrow(() => {
    got = lang.deadTableColumns(text);
  }, `${label}: deadTableColumns threw\n---- TEXT ----\n${text}\n---- END ----`);
  assert.ok(Array.isArray(got), `${label}: deadTableColumns returned ${JSON.stringify(got)}, not an array`);
  return [...got].sort();
};

gtest("[P9 §6 deadTableColumns reads the same table] rust: a plain-NAME annotation still lets the lint see the dead column, by name", () => {
  const i = DEAD_PLAIN.indexOf(MARK) + MARK.length;
  const ann = DEAD_PLAIN.slice(0, i) + ": Cases" + DEAD_PLAIN.slice(i);
  const p = deadOf("dead plain", DEAD_PLAIN);
  const a = deadOf("dead annotated", ann);
  assert.deepStrictEqual(
    p,
    ["limit"],
    `the UNANNOTATED baseline for §6 does not report the bound-and-never-read column, so a red annotated row is not attributable to the annotation. Got ${JSON.stringify(p)}`
  );
  assert.deepStrictEqual(
    a,
    p,
    `[P9 §6] "A column bound by an annotated table and never read in the runner body is still reported dead, with the same name it would carry unannotated." The name annotation changed the lint's answer from ${JSON.stringify(p)} to ${JSON.stringify(a)}, so the human loses the knob warning\n---- ANNOTATED ----\n${ann}\n---- END ----`
  );
  for (const n of a) {
    assert.ok(
      !["Cases", "str", "u32"].includes(n),
      `[P9 §3] deadTableColumns returned ${JSON.stringify(n)}, which is a token out of the annotation, not a bound column name. Got ${JSON.stringify(a)}`
    );
  }
});

// ===========================================================================
// The false-admit direction, and it is the expensive one. Every shape below
// has a `:` near a list of tuples and is NOT a table. Reading one as a table
// blanks the human's inputs or their types while the real expected values ship
// exactly as the model guessed them.
// ===========================================================================

const NO_WALKER = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_its_inputs() {
        let cases: Cases = [(1, 2), (3, 4)];
        assert_eq!(shard_of(cases[0].0), 101);
        assert_eq!(shard_of(cases[1].0), 202);
    }
}
`;

gtest("[P9 §4 walkerAfter is load-bearing] rust: a NAME-annotated list with no destructuring loop is not a table, and only the two inline assertions are holes", () => {
  const spans = spansOf("name annotated, no walker", NO_WALKER);
  assertAscending("name annotated, no walker", NO_WALKER, spans);
  assert.deepStrictEqual(
    textsOf(NO_WALKER, spans),
    ["101", "202"],
    show("name annotated, no walker", NO_WALKER, spans, "[P9 §4] \"An annotated `let` with no destructuring loop after it is still NOT a table, exactly as the unannotated form is not.\" The holes belong to the two INLINE assertions. A span over `2` or `4` inside `[(1, 2), (3, 4)]` is an INVERTED table: the human types into the test's own INPUTS while the real expected values ship as guessed. Teaching the walk to accept a name annotation must not reopen this")
  );
  const list = rangeOf("name annotated, no walker", NO_WALKER, "[(1, 2), (3, 4)]");
  for (const s of spans) {
    assert.ok(
      s.end <= list.start || s.start >= list.end,
      show("name annotated, no walker", NO_WALKER, spans, "[P9 §4] a span landed inside `[(1, 2), (3, 4)]`, which no runner walks. That list is data, not a case table")
    );
  }
});

const WRONG_NAME = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_of_cases() {
        let cases: Cases = [
            ("alpha", 101),
            ("beta", 202),
        ];
        for (key, want) in cases_extra {
            assert_eq!(shard_of(key), want);
        }
    }
}
`;

gtest("[P9 §4] rust: a NAME-annotated table whose loop walks a DIFFERENT name is not that table's walker", () => {
  const spans = spansOf("name annotated, wrong walker", WRONG_NAME);
  assertAscending("name annotated, wrong walker", WRONG_NAME, spans);
  const rows = rangeOf("name annotated, wrong walker", WRONG_NAME, '("alpha", 101)');
  const rows2 = rangeOf("name annotated, wrong walker", WRONG_NAME, '("beta", 202)');
  for (const s of spans) {
    for (const r of [rows, rows2]) {
      assert.ok(
        s.end <= r.start || s.start >= r.end,
        show("name annotated, wrong walker", WRONG_NAME, spans, "[P9 §4] `for (key, want) in cases_extra` walks a different list. Blanking `cases`'s rows on the strength of a loop over `cases_extra` is an INVERTED table: holes in a list the runner never reads. The amendment-2 `\\b` fix exists for exactly this, and a name-shaped annotation must not route around it")
      );
    }
  }
});

const CONST_NO_WALKER = `#[cfg(test)]
mod tests {
    use super::*;

    const CASES: Cases = [(1, 2), (3, 4)];

    #[test]
    fn shards() {
        assert_eq!(shard_of(1), 101);
    }
}
`;

gtest("[P9 §4] rust: a `const` with a NAME annotation and no walker anywhere is not a table", () => {
  const spans = spansOf("const, no walker", CONST_NO_WALKER);
  assertAscending("const, no walker", CONST_NO_WALKER, spans);
  assert.deepStrictEqual(
    textsOf(CONST_NO_WALKER, spans),
    ["101"],
    show("const, no walker", CONST_NO_WALKER, spans, "[P9 §4] `const` is a binding keyword, so the annotation walk reaches it. It is still not a table without a runner that walks it. The only hole here is the inline assertion's `101`; a span inside `[(1, 2), (3, 4)]` is an INVERTED table")
  );
});

const STRUCT_LITERAL_COLUMN = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn area_cases() {
        let cases: Cases = [
            (Rect { w: 2, h: 3 }, 101),
            (Rect { w: 4, h: 5 }, 202),
        ];
        for (rect, want) in cases {
            assert_eq!(area(rect), want);
        }
    }
}
`;

gtest("[P9 §3 + §5] rust: a struct-literal INPUT column carries `:` of its own, and none of its fields may become a hole", () => {
  const spans = spansOf("struct literal column", STRUCT_LITERAL_COLUMN);
  assertAscending("struct literal column", STRUCT_LITERAL_COLUMN, spans);
  assert.deepStrictEqual(
    textsOf(STRUCT_LITERAL_COLUMN, spans),
    ["101", "202"],
    show("struct literal column", STRUCT_LITERAL_COLUMN, spans, "[P9 §5] the expected column is the LAST column. `Rect { w: 2, h: 3 }` is the INPUT, and its `w:` and `h:` are struct-field colons, not binding colons. A hole on `2`, `3`, `4` or `5` is an INVERTED table: the human retypes the input the model chose and never sees the expected value")
  );
});

const MATCH_ARM = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_of_cases() {
        let cases: Cases = [
            ("alpha", 101),
            ("beta", 202),
        ];
        for (key, want) in cases {
            let bucket = match classify(key) {
                Kind::Wide { limit: 8 } => 1,
                Kind::Narrow { limit: 2 } => 0,
                _ => 9,
            };
            assert_eq!(shard_of(key, bucket), want);
        }
    }
}
`;

gtest("[P9 §3 + §5] rust: a `match` arm pattern holds a `:` inside the runner, and the table's rows are still the only holes", () => {
  const spans = spansOf("match arm", MATCH_ARM);
  assertAscending("match arm", MATCH_ARM, spans);
  assert.deepStrictEqual(
    textsOf(MATCH_ARM, spans),
    ["101", "202"],
    show("match arm", MATCH_ARM, spans, "[P9 §5] `Kind::Wide { limit: 8 }` is a pattern, not a binding. A hole on `8`, `2`, `1`, `0` or `9` is an INVERTED table: the human edits the runner's own control flow and the guessed expected values ship untouched")
  );
});

// A spelling the contract does not settle, recorded as a question rather than
// asserted as a defect. `static` is a binding keyword and a module-level table
// walked by a test is legal Rust, but no rule names it and no arm produced it.
// A red here is a question for the contract's author.
const STATIC_WALKED = `#[cfg(test)]
mod tests {
    use super::*;

    static CASES: Cases = [
        ("alpha", 101),
        ("beta", 202),
    ];

    #[test]
    fn shard_of_cases() {
        for (key, want) in CASES {
            assert_eq!(shard_of(key), want);
        }
    }
}
`;

gtest("[P9 §1 NOT SETTLED, a contract question] rust: a module-level `static CASES: Cases` walked by the test body", () => {
  const spans = spansOf("static walked", STATIC_WALKED);
  assertAscending("static walked", STATIC_WALKED, spans);
  assert.deepStrictEqual(
    textsOf(STATIC_WALKED, spans),
    ["101", "202"],
    show("static walked", STATIC_WALKED, spans, "rule 1 says `let`; goal.md defect 3 says `let`; `BINDING_KEYWORD` is named in amendment 2 as `let`/`const`/`static`. A module-level static walked by the test body binds one name per column over one list, so the CLASS argument in amendment 1's follow-up puts it in scope. Treat a red here as a question for the contract, not as a defect against it. What the human loses if it stays red is a LOST table")
  );
});

// ===========================================================================
// Rule 8, and it is the rule with a scar. The annotation walk is RUST ONLY.
// Amendment 2 records what happened when it reached the Python leg:
// `nameBeforeAnnotation` stops its backwards walk on `;`, `{` or `}` at depth
// zero. Rust ends every statement and block with one of those. Python writes
// none of them, so the walk crossed statement and block boundaries and found
// the `:` that ends an `if`/`for`/`while`/`with` header. HEAD blanks `b`, the
// real expected value. The first fix blanked `2` and `4`, the second column of
// a list no runner walks, while `b` shipped exactly as the model guessed it.
//
// Phase 4 widens the Rust walk again. These rows hold the line the widening
// must not cross.
// ===========================================================================

const PY_LEGS = [
  {
    key: PYTEST,
    id: "pytest",
    // No unittest.TestCase, no self. The pytest inline locator keys on
    // `assert <call> == <expr>`, so the fixture has to be pytest-shaped for
    // the row to say anything about the pytest leg.
    table: (binding) => `def test_shard_of():
    ${binding}
    for a, b in cases:
        assert shard_of(a) == b
`,
    header: (head, body) => `def test_shard_of():
    ${head}
        ${body}
    for a, b in cases:
        assert shard_of(a) == b
`,
  },
  {
    key: UNITTEST,
    id: "unittest",
    table: (binding) => `import unittest


class ShardOfTest(unittest.TestCase):
    def test_shard_of(self):
        ${binding}
        for a, b in cases:
            self.assertEqual(shard_of(a), b)
`,
    header: (head, body) => `import unittest


class ShardOfTest(unittest.TestCase):
    def test_shard_of(self):
        ${head}
            ${body}
        for a, b in cases:
            self.assertEqual(shard_of(a), b)
`,
  },
];

for (const leg of PY_LEGS) {
  gtest(`[P9 §8 CONTROL, python ${leg.id}] an UNANNOTATED python table is found, and its holes are the rows' last column`, () => {
    const text = leg.table("cases = [(1, 2), (3, 4)]");
    const spans = spansOn(leg.key, `${leg.id} control`, text);
    assertAscending(`${leg.id} control`, text, spans);
    assert.deepStrictEqual(
      textsOf(text, spans),
      ["2", "4"],
      show(`${leg.id} control`, text, spans, "[P2 'The shape, per language'] a python `cases = [...]` walked by a destructuring `for` is a table, and its expected column is each tuple's last element. This is the baseline the annotated rows below are measured against")
    );
  });

  gtest(`[P9 §8 Rust only, python ${leg.id}] an ANNOTATED python binding answers as HEAD answers, because the annotation walk is gated off this leg`, () => {
    const text = leg.table("cases: list[tuple[int, int]] = [(1, 2), (3, 4)]");
    const spans = spansOn(leg.key, `${leg.id} annotated`, text);
    assertAscending(`${leg.id} annotated`, text, spans);
    assert.deepStrictEqual(
      textsOf(text, spans),
      ["b"],
      show(`${leg.id} annotated`, text, spans, "[P9 §8 amendment 2] \"Gating correctly also reverts the benign half: an annotated Python binding goes back to HEAD's answer, and that is the correct outcome, not a loss.\" HEAD answers `b`, the inline locator's read of the runner. Phase 4 widens the RUST walk; if this row turns to `[\"2\", \"4\"]` the widening leaked onto Python again and the human gets an INVERTED table: holes on a list no runner walks while the real expected value ships as guessed")
    );
  });

  gtest(`[P9 §8 Rust only, python ${leg.id}] an annotated python binding never blanks the annotation's own tokens`, () => {
    const text = leg.table("cases: list[tuple[int, int]] = [(1, 2), (3, 4)]");
    const spans = spansOn(leg.key, `${leg.id} annotated tokens`, text);
    for (const t of textsOf(text, spans)) {
      assert.ok(
        !["list", "tuple", "int", "list[tuple[int, int]]"].includes(t.trim()),
        show(`${leg.id} annotated tokens`, text, spans, `[P9 §3] the span text ${JSON.stringify(t)} is a python TYPE out of the annotation. The annotation list[tuple[int, int]] is a bracketed list of bracketed comma-separated things, which is the exact shape of a row. Blanking one is an INVERTED table with the hole inside a type`)
      );
    }
  });
}

// The header colons, one row per keyword per leg. Amendment 2: "the commonest
// Python line ending in `identifier:` is `for a, b in cases:`, the walker's own
// header, so the name the walk picks up is pre-selected to be one walkerAfter
// matches." That is why this is not a theoretical hazard.
const PY_HEADERS = [
  ["if cases:", "an `if` header"],
  ["while cases:", "a `while` header"],
  ["for c in cases:", "a `for` header, which is the walker's own shape"],
  ["with open(cases) as f:", "a `with` header"],
];

for (const leg of PY_LEGS) {
  for (const [head, what] of PY_HEADERS) {
    gtest(`[P9 §8 the header colon is not a binding] python ${leg.id}: ${what} above a list nobody walks`, () => {
      const text = leg.header(head, "rows[0] = [(1, 2), (3, 4)]");
      const spans = spansOn(leg.key, `${leg.id} / ${head}`, text);
      assertAscending(`${leg.id} / ${head}`, text, spans);
      assert.deepStrictEqual(
        textsOf(text, spans),
        ["b"],
        show(`${leg.id} / ${head}`, text, spans, `[P9 §8 amendment 2] ${JSON.stringify(head)} ends in \`identifier:\` and is not a binding. Python writes no \`;\` and no \`}\`, so a backwards walk has nothing to stop it crossing into this header. HEAD answers \`b\`. \`["2", "4"]\` is the measured inversion: holes on the second column of a list no runner walks, while \`b\`, the real expected value, ships exactly as the model guessed it`)
      );
      const list = rangeOf(`${leg.id} / ${head}`, text, "[(1, 2), (3, 4)]");
      for (const s of spans) {
        assert.ok(
          s.end <= list.start || s.start >= list.end,
          show(`${leg.id} / ${head}`, text, spans, "[P9 §8] a span landed inside `[(1, 2), (3, 4)]`, which is assigned into `rows[0]` and walked by nothing")
        );
      }
    });
  }

  gtest(`[P9 §8 the header colon is not a table NAME] python ${leg.id}: no span is ever a bound name or a header's subject`, () => {
    for (const [head] of PY_HEADERS) {
      const text = leg.header(head, "rows[0] = [(1, 2), (3, 4)]");
      const spans = spansOn(leg.key, `${leg.id} / ${head} names`, text);
      for (const t of textsOf(text, spans)) {
        assert.ok(
          !["cases", "rows", "f", "c", "a"].includes(t.trim()),
          show(`${leg.id} / ${head} names`, text, spans, `[P9 §8] the span text ${JSON.stringify(t)} is a NAME the header introduced or read, not a value. A hole on a name is an INVERTED table with the hole in the runner`)
        );
      }
    }
  });

  gtest(`[P9 §8 a dict entry and a slice are not bindings] python ${leg.id}: neither colon turns a nearby list into a table`, () => {
    const text = leg.header("limits = {\"alpha\": 8, \"beta\": 16}", "rows = [(1, 2), (3, 4)][0:2]");
    const spans = spansOn(leg.key, `${leg.id} dict and slice`, text);
    assertAscending(`${leg.id} dict and slice`, text, spans);
    assert.deepStrictEqual(
      textsOf(text, spans),
      ["b"],
      show(`${leg.id} dict and slice`, text, spans, "[P9 §8 amendment 2] \"`identifier : type =` is a binding in Rust and a dictionary entry, a slice, an annotation or a label elsewhere.\" A hole on `8`, `16`, `2` or `4` is an INVERTED table built out of a colon that binds nothing")
    );
  });

  gtest(`[P9 §7 + §8] python ${leg.id}: unresolvedAssertions does not change because a python binding carried an annotation`, () => {
    const plain = leg.table("cases = [(1, 2), (3, 4)]");
    const ann = leg.table("cases: list[tuple[int, int]] = [(1, 2), (3, 4)]");
    let p;
    let a;
    assert.doesNotThrow(() => {
      p = fwOf(leg.key).unresolvedAssertions(plain);
      a = fwOf(leg.key).unresolvedAssertions(ann);
    }, `${leg.id}: unresolvedAssertions threw`);
    assert.strictEqual(
      a,
      p,
      `${leg.id}: [P9 §7] the python annotation moved unresolvedAssertions from ${p} to ${a}. Rule 7 says the answer does not change because of an annotation, and rule 8 says this leg does not move at all\n---- ANNOTATED ----\n${ann}\n---- END ----`
    );
  });

  gtest(`[P9 §8 Rust only] python ${leg.id}: a RUST name-annotated table is not a table to this finder, and does not throw`, () => {
    const text = rustAnnotated("[", ": Cases", "rust into python");
    const spans = spansOn(leg.key, `${leg.id} on rust`, text);
    assertAscending(`${leg.id} on rust`, text, spans);
    for (const t of textsOf(text, spans)) {
      assert.ok(
        !["Cases", "cases", "want", "key"].includes(t.trim()),
        show(`${leg.id} on rust`, text, spans, "[P9 §8] a python finder read a Rust binding's annotation or its loop variable as an expected value")
      );
    }
  });
}

// ===========================================================================
// Rule 10, on the name-shaped walk. A malformed annotation does not throw and
// does not hang, and it answers as it does today, which is no table. A
// backtracking scanner over a nested type is the shape that turns a
// keystroke-rate path into a stall.
// ===========================================================================

const MALFORMED = [
  ["a path with a trailing `::`", ": crate::tests::"],
  ["a lone `::`", ": ::"],
  ["a bare colon and nothing else", ":"],
  ["a lifetime with no type after it", ": &'static"],
  ["an unclosed generic over a name", ": Vec<Cases"],
  ["200 path segments", ": " + "seg::".repeat(200) + "Cases"],
  ["200 nested generics over a name", ": " + "Vec<".repeat(200) + "Cases"],
];

for (const [what, annotation] of MALFORMED) {
  gtest(`[P9 §10 a malformed annotation neither throws nor hangs] rust: ${what}`, () => {
    const text = rustAnnotated("[", annotation, what);
    const t0 = Date.now();
    let spans;
    assert.doesNotThrow(() => {
      spans = fwOf(RUST).expectedValueSpans(text);
    }, `[P9 §10] expectedValueSpans threw on ${what}\n---- TEXT ----\n${text}\n---- END ----`);
    assert.doesNotThrow(() => {
      fwOf(RUST).unresolvedAssertions(text);
    }, `[P9 §10] unresolvedAssertions threw on ${what}`);
    assert.doesNotThrow(() => {
      at(RUST).lang.deadTableColumns(text);
    }, `[P9 §10] deadTableColumns threw on ${what}`);
    const ms = Date.now() - t0;
    assert.ok(
      ms < 1000,
      `[P9 §10] ${what} took ${ms}ms. A name walk that backtracks over path segments is the shape that stalls a keystroke-rate path`
    );
    assert.ok(Array.isArray(spans), `[P9 §10] expectedValueSpans returned ${JSON.stringify(spans)} on ${what}, not an array`);
    assertAscending(`malformed / ${what}`, text, spans);
    for (const s of spans) {
      assert.ok(
        s.start > text.indexOf("=", text.indexOf(MARK)),
        show(`malformed / ${what}`, text, spans, "[P9 §3 + §10] a span landed left of the `=` on a broken annotation. Guessing where the rows start off unparseable text is how a hole ends up inside a type")
      );
    }
  });
}
