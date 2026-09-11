// Blind oracle for session-v68 phase 9: a type-annotated case table is still a
// table [session-v68/contracts/P9-annotated-table.md]. Written from the
// contract alone, WITHOUT READING src/** - not one file, not one grep, not one
// peek at src/core/tddTable.ts or at the bundled source text. An oracle that
// agreed with the implementation would be worthless, so every assertion below
// is derived from the contract's numbered rules 1-10 and from nothing else.
//
// Surface exercised, all through the public seam, as production reaches it:
//   tddLangFor, frameworkFor, blankExpectedValues   ../src/core/tddLang
//   TestFramework.expectedValueSpans(text)          off the resolved framework
//   TestFramework.unresolvedAssertions(text)        off the resolved framework
//   TddLang.deadTableColumns(text)                  off the resolved language
// No per-framework locator is imported by name.
//
// Framework resolution uses an INJECTED fake TddDeps (the depsOf helper copied
// from blind-v68-table-locator.test.cjs), not a path outside this repo, so a
// missing clone of an external corpus cannot turn a contract finding into a
// harness error. REAL_TDD_DEPS is exported by the bundle entry and asserted to
// exist, but no row depends on the real filesystem.
//
// No expected byte offset in this file was computed by hand. Rule 1's
// differential is exact by CONSTRUCTION: every fixture is built unannotated
// first, then the annotation is SPLICED in at a known index, so the annotated
// text is the unannotated text with `annotation.length` bytes inserted before
// the `=`. Every span from the annotated form must therefore equal a span from
// the unannotated form shifted by exactly that many bytes. Everything else is
// pinned with text.indexOf(<the literal I placed there>).
//
// EXPECTED RED: phase 9 is not implemented. The rows asserting that an
// ANNOTATED table is found should fail now; that is the file's purpose. A
// failing `assert` is a contract finding. A bundling crash, or a TypeError on
// an export that should exist, would be a harness bug instead, so the bundle
// row is its own loud test and every other row skips behind it.
//
// Run: SKIP_LIVE=1 node --test test/blind-v68-p9-annotated-table.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v68-p9-annotated-table",
    `export { tddLangFor, frameworkFor, blankExpectedValues, REAL_TDD_DEPS } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const { tddLangFor, frameworkFor, blankExpectedValues, REAL_TDD_DEPS } = mod;

// Every row except the bundle row skips (not fails) while the bundle is broken,
// so a harness break stays ONE loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

test("bundle: the P9 surface builds and exports tddLangFor + frameworkFor + blankExpectedValues [P9 'Surface under contract']", () => {
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
  assert.ok(REAL_TDD_DEPS && typeof REAL_TDD_DEPS === "object", "REAL_TDD_DEPS is the production TddDeps object");
});

// ===========================================================================
// Resolution. Fake deps, the path production takes, with the registration
// array as a fallback ONLY so a detection wobble cannot mask the annotation
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

// Rust is the language under contract. The other four are here for rule 8.
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
  ["csharp", "xunit", "/repo/Acme.Tests", () => csDeps("xunit.v3")],
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

gtest("[P9 'Surface under contract'] rust resolves through frameworkFor and declares expectedValueSpans + unresolvedAssertions + deadTableColumns", () => {
  const r = resolveAll().get(RUST);
  assert.ok(r && r.fw, "rust/libtest did not resolve at all");
  assert.ok(r.viaFrameworkFor, "rust/libtest is only reachable off the registration array, not through frameworkFor");
  assert.strictEqual(typeof r.fw.expectedValueSpans, "function", "TestFramework.expectedValueSpans(text)");
  assert.strictEqual(typeof r.fw.unresolvedAssertions, "function", "TestFramework.unresolvedAssertions(text)");
  assert.strictEqual(typeof r.lang.deadTableColumns, "function", "TddLang.deadTableColumns(text)");
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

function spansOf(label, text) {
  let spans;
  assert.doesNotThrow(() => {
    spans = fwOf(RUST).expectedValueSpans(text);
  }, `${label}: expectedValueSpans threw.\n---- TEXT ----\n${text}\n---- END TEXT ----`);
  assert.ok(Array.isArray(spans), `${label}: expectedValueSpans did not return an array, got ${JSON.stringify(spans)}`);
  return spans;
}

// [P9 §5] ascending and non-overlapping, and every span a real range inside the
// text. §5 says this is safety-critical: a wrong argument position blanks the
// call under test while keeping the model's guessed value.
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
// The fixtures. Each is built UNANNOTATED first; the annotation is spliced in
// at the index right after `let cases`, so the annotated text is the
// unannotated text with exactly annotation.length bytes inserted before the
// `=`. That is what makes rule 1's differential exact rather than approximate.
// ===========================================================================

const MARK = "let cases";

// `iter` is what the runner walks. It defaults to the plain moved form; rule 11
// varies it and nothing else. Everything the locator has to find lives ABOVE
// the `for` line, so changing the spelling cannot move a row span by one byte.
function plainOf(f, iter = "cases") {
  return `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ${f.fn}() {
        ${MARK} = ${f.table}
        for ${f.binds} in ${iter} {
            ${f.runner}
        }
    }
}
`;
}

// The splice point: immediately after `let cases`, which is where a Rust type
// annotation goes.
function annIndex(plain, label) {
  const i = plain.indexOf(MARK);
  assert.ok(i >= 0, `${label}: fixture bug, ${JSON.stringify(MARK)} is not in the text`);
  assert.strictEqual(plain.indexOf(MARK, i + 1), -1, `${label}: fixture bug, ${JSON.stringify(MARK)} occurs twice`);
  return i + MARK.length;
}

function annotatedOf(f, annotation, iter = "cases") {
  const plain = plainOf(f, iter);
  const i = annIndex(plain, f.id);
  return plain.slice(0, i) + (annotation === undefined ? f.annotation : annotation) + plain.slice(i);
}

// All five annotation forms rule 2 names.
const FORMS = [
  {
    id: "form 1 - array with a length",
    rule2: "`let cases: [(Vec<u8>, usize, Option<u128>); 3] = [ … ];`   array, with a length",
    fn: "read_option_u128_le_cases",
    annotation: ": [(Vec<u8>, usize, Option<u128>); 3]",
    // The exact shape the goal amendment measured at 0 spans.
    table: `[
            (vec![1, 42, 0, 0], 0, Some(42)),
            (vec![0, 0, 0, 0], 0, None),
            (vec![1, 7, 0, 0], 1, Some(7)),
        ];`,
    binds: "(buf, offset, want)",
    runner: "assert_eq!(read_option_u128_le(&buf, offset), want);",
    wants: ["Some(42)", "None", "Some(7)"],
    returnType: "Option<u128>",
    // Identifiers the annotation contributes. None of these may ever be a span.
    typeTokens: ["Vec<u8>", "usize", "Option<u128>", "Vec", "u8", "u128", "3"],
  },
  {
    id: "form 2 - array, scalar columns",
    rule2: "`let cases: [(u32, u64); 3] = [ … ];`                        array, scalar columns",
    fn: "scale_cases",
    annotation: ": [(u32, u64); 3]",
    table: `[
            (1, 101),
            (2, 202),
            (4, 303),
        ];`,
    binds: "(n, want)",
    runner: "assert_eq!(scale(n), want);",
    wants: ["101", "202", "303"],
    returnType: "u64",
    typeTokens: ["u32", "u64", "3"],
  },
  {
    id: "form 3 - Vec, with vec!",
    rule2: "`let cases: Vec<(String, bool)> = vec![ … ];`                Vec, with `vec!`",
    fn: "is_ready_cases",
    annotation: ": Vec<(String, bool)>",
    table: `vec![
            ("alpha".to_string(), true),
            ("beta".to_string(), false),
        ];`,
    binds: "(key, want)",
    runner: "assert_eq!(is_ready(&key), want);",
    wants: ["true", "false"],
    returnType: "bool",
    typeTokens: ["Vec", "String", "bool", "Vec<(String, bool)>"],
  },
  {
    id: "form 4 - slice reference",
    rule2: "`let cases: &[(u8, u8)] = &[ … ];`                           slice reference",
    fn: "clamp_cases",
    annotation: ": &[(u8, u8)]",
    table: `&[
            (1, 101),
            (2, 202),
        ];`,
    binds: "&(n, want)",
    runner: "assert_eq!(clamp(n), want);",
    wants: ["101", "202"],
    returnType: "u8",
    typeTokens: ["u8", "&[(u8, u8)]"],
  },
  {
    id: "form 5a - a nested generic argument",
    rule2: "Generic arguments nest: `HashMap<String, Vec<(u8, u16)>>` inside an annotation is normal",
    fn: "fan_out_cases",
    annotation: ": Vec<(HashMap<String, Vec<(u8, u16)>>, u32)>",
    table: `vec![
            (empty_index(), 101),
            (small_index(), 202),
        ];`,
    binds: "(index, want)",
    runner: "assert_eq!(fan_out(&index), want);",
    wants: ["101", "202"],
    returnType: "u32",
    typeTokens: ["HashMap", "String", "Vec", "u8", "u16", "u32", "HashMap<String, Vec<(u8, u16)>>"],
  },
  {
    id: "form 5b - a nested array type",
    rule2: "… and so is a nested array type `Vec<[u8; 4]>`",
    fn: "be_u32_cases",
    annotation: ": Vec<([u8; 4], u32)>",
    table: `vec![
            ([0, 0, 0, 1], 101),
            ([255, 0, 0, 0], 202),
        ];`,
    binds: "(bytes, want)",
    runner: "assert_eq!(be_u32(&bytes), want);",
    wants: ["101", "202"],
    returnType: "u32",
    typeTokens: ["Vec", "u8", "u32", "[u8; 4]", "4"],
  },
];

// ===========================================================================
// Rule 1, the differential, and it is the strongest instrument in the file.
// Every form gets three rows:
//   CONTROL     the unannotated table finds its expected column. Green today.
//               A red control is a fixture or walker finding, NOT phase 9.
//   ANNOTATED   the annotated table finds the same expected column.
//   DIFFERENTIAL the two span sets are EQUAL once the annotation's bytes are
//               subtracted. This cannot be satisfied by a fix that finds the
//               table but mis-locates the column.
// ===========================================================================

for (const f of FORMS) {
  const plain = plainOf(f);
  const ann = annotatedOf(f);
  const shift = f.annotation.length;

  gtest(`[P9 §1 CONTROL, unannotated] ${f.id}: the same table WITHOUT the annotation finds its ${f.wants.length} expected values`, () => {
    const spans = spansOf(`${f.id} control`, plain);
    assertAscending(`${f.id} control`, plain, spans);
    assert.deepStrictEqual(
      pairs(spans),
      f.wants.map((lit) => rangeOf(`${f.id} control`, plain, lit)),
      show(`${f.id} control`, plain, spans, `the UNANNOTATED form does not find ${JSON.stringify(f.wants)}. This row is the baseline for the differential: if it is red, the finding is the fixture's table shape or its walker, not the annotation`)
    );
  });

  gtest(`[P9 §1 an annotated table is found] ${f.id}: ${f.rule2}`, () => {
    const spans = spansOf(f.id, ann);
    assertAscending(f.id, ann, spans);
    assert.deepStrictEqual(
      pairs(spans),
      f.wants.map((lit) => rangeOf(f.id, ann, lit)),
      show(f.id, ann, spans, `[P9 §1] a \`let\` binding whose table is preceded by a TYPE ANNOTATION is found. Expected the ${f.wants.length} spans ${JSON.stringify(f.wants)}. Zero spans here is the measured defect: zero holes trips the third floor, the gesture refuses, and nothing is written`)
    );
  });

  gtest(`[P9 §1 DIFFERENTIAL] ${f.id}: the annotated spans are the unannotated spans shifted by exactly the annotation's ${shift} bytes, and by nothing else`, () => {
    const a = spansOf(`${f.id} annotated`, ann);
    const p = spansOf(`${f.id} plain`, plain);
    // The fixture is built by SPLICING, so this relationship is exact.
    assert.strictEqual(
      ann,
      plain.slice(0, annIndex(plain, f.id)) + f.annotation + plain.slice(annIndex(plain, f.id)),
      `${f.id}: fixture bug, the annotated text is not the plain text with the annotation spliced in`
    );
    // A differential between two EMPTY sets is a falsifier that cannot fail:
    // it would go green on a build where neither form finds the table. The
    // unannotated side must have found something for this row to mean anything.
    assert.ok(
      p.length > 0,
      `${f.id}: [P9 §1] this differential is VACUOUS - the unannotated form found no spans either, so "the two sets are equal" is satisfied by two empty sets. ` +
        `The table shape itself is not found today, which is a finding rule 1 alone cannot express. See the CONTROL row for this form.\n---- PLAIN ----\n${plain}\n---- END ----`
    );
    assert.deepStrictEqual(
      a.map((s) => ({ start: s.start - shift, end: s.end - shift })),
      pairs(p),
      `${f.id}: [P9 §1] "its spans are identical to the spans the same table produces with the annotation deleted. The annotation changes nothing about which values are blanked."\n` +
        `  annotated span texts: ${JSON.stringify(textsOf(ann, a))}\n` +
        `  plain     span texts: ${JSON.stringify(textsOf(plain, p))}\n` +
        `---- ANNOTATED ----\n${ann}\n---- PLAIN ----\n${plain}\n---- END ----`
    );
  });

  // =========================================================================
  // Rule 3, the dangerous direction. `[(Vec<u8>, usize, Option<u128>); 5]` is a
  // bracketed list of parenthesised, comma-separated things, which is the exact
  // shape of a row. A fix that starts the scan at the FIRST `[` after `let`
  // reads it as one and hands the human a hole where a TYPE belongs.
  // =========================================================================

  gtest(`[P9 §3 the annotation is never scanned as rows] ${f.id}: no span falls inside the annotation, and none begins before the \`=\``, () => {
    const spans = spansOf(`${f.id} rule 3`, ann);
    const start = annIndex(plain, f.id);
    const end = start + shift;
    const eq = ann.indexOf("=", end);
    assert.ok(eq > 0, `${f.id}: fixture bug, no \`=\` after the annotation`);
    for (const s of spans) {
      assert.ok(
        s.start >= end && s.end <= ann.length,
        show(`${f.id} rule 3`, ann, spans, `[P9 §3] a span lands INSIDE the annotation ${JSON.stringify(f.annotation)} (bytes ${start}..${end}). "No span may ever fall inside an annotation" - blanking there hands the human a hole where a type name belongs and the file stops compiling`)
      );
      assert.ok(
        s.start > eq,
        show(`${f.id} rule 3`, ann, spans, `[P9 §3] a span begins at ${s.start}, before the \`=\` at ${eq}. Every expected value lives on the right-hand side of the binding; a span to the left of it is the annotation being read as rows`)
      );
    }
  });

  gtest(`[P9 §3 no span's text is a type name] ${f.id}: none of ${JSON.stringify(f.typeTokens)} is ever blanked`, () => {
    const spans = spansOf(`${f.id} type names`, ann);
    const got = textsOf(ann, spans);
    for (const t of got) {
      assert.ok(
        !f.typeTokens.includes(t.trim()),
        show(`${f.id} type names`, ann, spans, `[P9 §3] the span text ${JSON.stringify(t)} is a TYPE NAME the annotation contributed. Reading the annotation as a row blanks a type, which is worse than finding nothing`)
      );
    }
  });

  // =========================================================================
  // Rule 7. An annotation does not change unresolvedAssertions' answer.
  // =========================================================================

  gtest(`[P9 §7 unresolvedAssertions does not change its answer] ${f.id}: annotated and unannotated report the same count`, () => {
    let a;
    let p;
    assert.doesNotThrow(() => {
      a = fwOf(RUST).unresolvedAssertions(ann);
      p = fwOf(RUST).unresolvedAssertions(plain);
    }, `${f.id}: unresolvedAssertions threw`);
    assert.strictEqual(
      a,
      p,
      `${f.id}: [P9 §7] the annotation changed unresolvedAssertions from ${p} to ${a}. The two texts hold the same rows and the same runner\n---- ANNOTATED ----\n${ann}\n---- PLAIN ----\n${plain}\n---- END ----`
    );
  });

  // =========================================================================
  // The surface's fourth entry. blankExpectedValues over an annotated table
  // must put one hole per row and hand the runner back verbatim.
  // =========================================================================

  gtest(`[P9 'Surface under contract'] ${f.id}: blankExpectedValues puts one hole per row and leaves the runner byte-identical`, () => {
    const { lang, fw } = at(RUST);
    const res = blankExpectedValues(lang, fw, ann, f.returnType);
    assert.ok(res && typeof res.snippet === "string", `${f.id}: blankExpectedValues returned no snippet: ${JSON.stringify(res)}`);
    const tail = `\n---- SNIPPET ----\n${res.snippet}\n---- END SNIPPET ----`;
    const base = blankExpectedValues(lang, fw, plain, f.returnType);

    assert.strictEqual(
      res.holes,
      f.wants.length,
      `${f.id}: [P9 §1] expected one hole per row (${f.wants.length}), got ${res.holes}. The unannotated form gives ${base.holes}. Zero holes is the measured defect: the third floor refuses and nothing is written${tail}`
    );
    assert.strictEqual(
      res.holes,
      base.holes,
      `${f.id}: [P9 §1] the annotated table produced ${res.holes} hole(s) and the unannotated one ${base.holes}${tail}`
    );
    assert.ok(
      res.snippet.includes(f.runner),
      `${f.id}: the runner ${JSON.stringify(f.runner)} is not in the snippet unchanged; a hole in the runner blanks the LOOP VARIABLE and ships every guessed row green${tail}`
    );
    assert.ok(
      res.snippet.includes(f.annotation),
      `${f.id}: [P9 §3] the annotation ${JSON.stringify(f.annotation)} did not survive the blanker verbatim, so a hole was opened inside a type${tail}`
    );
  });
}

// ===========================================================================
// Attribution for rule 2's fourth form. `let cases: &[(u8, u8)] = &[ … ];` has
// TWO things a reader could blame when it finds nothing: the annotation, and
// the `&[` on the right-hand side. This row isolates them. The same rows and
// the same `&(n, want)` destructure behind a plain `[` are found today, so a
// red form-4 CONTROL above is the `&[` opener and nothing else.
// ===========================================================================

const SLICE_ROWS = `
            (1, 101),
            (2, 202),
        ];`;

const sliceFixture = (rhs, bind) => `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_cases() {
        let cases = ${rhs}${SLICE_ROWS}
        for ${bind} in cases {
            assert_eq!(clamp(n), want);
        }
    }
}
`;

gtest("[P9 §2 form 4 attribution] the `&(n, want)` destructure is not the blocker: the same rows behind a plain `[` are found", () => {
  const text = sliceFixture("[", "&(n, want)");
  const spans = spansOf("slice attribution, `[` opener", text);
  assert.deepStrictEqual(
    textsOf(text, spans),
    ["101", "202"],
    show("slice attribution, `[` opener", text, spans, "a `&(a, b)` destructuring loop over a plain `[` table is found, so if it is red the walker reads the `&` and form 4's red is not about the `&[` opener")
  );
});

gtest("[P9 §2 form 4 attribution] an UNANNOTATED `&[` table is not found today either, so rule 2's slice form needs more than the annotation fix", () => {
  const text = sliceFixture("&[", "(n, want)");
  const spans = spansOf("slice attribution, `&[` opener", text);
  assert.deepStrictEqual(
    textsOf(text, spans),
    ["101", "202"],
    show("slice attribution, `&[` opener", text, spans, "[P9 §2] rule 2 puts `let cases: &[(u8, u8)] = &[ … ];` in scope, but the right-hand `&[` is not read as a table opener even with NO annotation. Rule 1's differential goes GREEN on this form while nothing is blanked, because both sides are empty")
  );
});

// ===========================================================================
// Rule 4, red-before-green. A list of tuples is a table only when a runner
// WALKS it and binds a name per column. Phase 2's review found the inversion
// the hard way: `let inputs = [(1, 2), (3, 4)];` above a set of inline asserts
// had every second element blanked. Annotating it must not reopen it.
// ===========================================================================

const NO_WALKER_BARE = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_its_inputs() {
        let inputs = [(1, 2), (3, 4)];
        let _ = inputs;
    }
}
`;

const NO_WALKER_ASSERTS = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shards_the_pairs() {
        let inputs = [(1, 2), (3, 4)];
        assert_eq!(shard_of(inputs[0].0, inputs[0].1), 101);
        assert_eq!(shard_of(inputs[1].0, inputs[1].1), 202);
    }
}
`;

const spliceInputs = (text, annotation) => {
  const i = text.indexOf("let inputs") + "let inputs".length;
  return text.slice(0, i) + annotation + text.slice(i);
};

const NO_WALKER_ANNOTATION = ": [(u32, u32); 2]";

gtest("[P9 §4 walkerAfter is unchanged and load-bearing] an annotated `let` with NO destructuring loop after it yields ZERO spans", () => {
  const text = spliceInputs(NO_WALKER_BARE, NO_WALKER_ANNOTATION);
  const spans = spansOf("no walker, annotated", text);
  assertAscending("no walker, annotated", text, spans);
  assert.deepStrictEqual(
    textsOf(text, spans),
    [],
    show("no walker, annotated", text, spans, "[P9 §4] \"An annotated `let` with no destructuring loop after it is still NOT a table, exactly as the unannotated form is not.\" A span here is the phase-2 inversion reopened by the annotation: every second element of a plain data list gets blanked")
  );
});

gtest("[P9 §4 CONTROL, unannotated] the same `let` with no loop after it yields ZERO spans", () => {
  const spans = spansOf("no walker, plain", NO_WALKER_BARE);
  assert.deepStrictEqual(
    textsOf(NO_WALKER_BARE, spans),
    [],
    show("no walker, plain", NO_WALKER_BARE, spans, "the UNANNOTATED baseline for §4 already emits a span, so a red annotated row above is not attributable to the annotation")
  );
});

gtest("[P9 §4 DIFFERENTIAL] an annotated non-table above inline asserts blanks exactly what the unannotated one blanks: the two inline expected values, and nothing in the list", () => {
  const ann = spliceInputs(NO_WALKER_ASSERTS, NO_WALKER_ANNOTATION);
  const a = spansOf("no walker asserts, annotated", ann);
  const p = spansOf("no walker asserts, plain", NO_WALKER_ASSERTS);
  assertAscending("no walker asserts, annotated", ann, a);

  assert.deepStrictEqual(
    a.map((s) => ({ start: s.start - NO_WALKER_ANNOTATION.length, end: s.end - NO_WALKER_ANNOTATION.length })),
    pairs(p),
    `[P9 §4 + §1] the annotation changed which values are blanked on a NON-table\n` +
      `  annotated: ${JSON.stringify(textsOf(ann, a))}\n` +
      `  plain:     ${JSON.stringify(textsOf(NO_WALKER_ASSERTS, p))}\n---- ANNOTATED ----\n${ann}\n---- END ----`
  );

  assert.deepStrictEqual(
    textsOf(ann, a),
    ["101", "202"],
    show("no walker asserts, annotated", ann, a, "[P9 §4] the holes belong to the two INLINE assertions. A span over `2` or `4` inside `[(1, 2), (3, 4)]` is the inversion phase 2 closed, reopened by annotating a plain data list")
  );

  const list = rangeOf("no walker asserts", ann, "[(1, 2), (3, 4)]");
  for (const s of a) {
    assert.ok(
      s.end <= list.start || s.start >= list.end,
      show("no walker asserts, annotated", ann, a, "[P9 §4] a span landed inside `[(1, 2), (3, 4)]`, which no runner walks. That list is data, not a case table")
    );
  }
});

// ===========================================================================
// Rule 6. deadTableColumns reads the same table, and reports the same name.
// ===========================================================================

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

const DEAD_ANNOTATION = ": [(&str, u32, u32, u32); 2]";
const DEAD_ANN = DEAD_PLAIN.slice(0, DEAD_PLAIN.indexOf(MARK) + MARK.length) +
  DEAD_ANNOTATION +
  DEAD_PLAIN.slice(DEAD_PLAIN.indexOf(MARK) + MARK.length);

const deadOf = (label, text) => {
  const { lang } = at(RUST);
  assert.strictEqual(typeof lang.deadTableColumns, "function", `${label}: TddLang(rust).deadTableColumns is not a function`);
  let got;
  assert.doesNotThrow(() => {
    got = lang.deadTableColumns(text);
  }, `${label}: deadTableColumns threw\n---- TEXT ----\n${text}\n---- END ----`);
  assert.ok(Array.isArray(got), `${label}: deadTableColumns returned ${JSON.stringify(got)}, not an array`);
  return [...got].sort();
};

gtest("[P9 §6 CONTROL, unannotated] deadTableColumns reports `limit` on the unannotated table", () => {
  assert.deepStrictEqual(
    deadOf("dead plain", DEAD_PLAIN),
    ["limit"],
    `the UNANNOTATED baseline for §6 does not report the bound-and-never-read column, so a red annotated row is not attributable to the annotation\n---- TEXT ----\n${DEAD_PLAIN}\n---- END ----`
  );
});

gtest("[P9 §6 deadTableColumns reads the same table] a column bound by an ANNOTATED table and never read is still reported dead, with the same name", () => {
  const a = deadOf("dead annotated", DEAD_ANN);
  const p = deadOf("dead plain", DEAD_PLAIN);
  assert.deepStrictEqual(
    a,
    p,
    `[P9 §6] the annotation changed the lint's answer from ${JSON.stringify(p)} to ${JSON.stringify(a)}\n---- ANNOTATED ----\n${DEAD_ANN}\n---- END ----`
  );
  assert.deepStrictEqual(
    a,
    ["limit"],
    `[P9 §6] "A column bound by an annotated table and never read in the runner body is still reported dead, with the same name it would carry unannotated." Got ${JSON.stringify(a)}\n---- ANNOTATED ----\n${DEAD_ANN}\n---- END ----`
  );
});

gtest("[P9 §6 + §3] deadTableColumns never reports a TYPE from the annotation as a column name", () => {
  const got = deadOf("dead annotated types", DEAD_ANN);
  for (const n of got) {
    assert.ok(
      !["&str", "u32", "str", "2"].includes(n),
      `[P9 §3] deadTableColumns returned ${JSON.stringify(n)}, which is a type out of the annotation ${JSON.stringify(DEAD_ANNOTATION)}, not a bound column name. Got ${JSON.stringify(got)}`
    );
  }
});

// ===========================================================================
// Rule 9, as far as this seam can reach it. blind-v8-assembly is the real pin
// on rustExpectedValueSpans; what is checkable HERE is that a table-free Rust
// reply still behaves exactly as it does today, and that an annotated table
// does not disturb a separate single-case test beside it.
// ===========================================================================

const INLINE_RUST = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shards_alpha() {
        assert_eq!(shard_of("alpha", 8), 404);
    }
}
`;

gtest("[P9 §9 the bare inline locator is untouched] a table-free Rust reply still yields one span per assertion, covering the expected value", () => {
  const spans = spansOf("inline only", INLINE_RUST);
  assertAscending("inline only", INLINE_RUST, spans);
  assert.deepStrictEqual(
    pairs(spans),
    [rangeOf("inline only", INLINE_RUST, "404")],
    show("inline only", INLINE_RUST, spans, "[P9 §9] the annotation work moved the bare inline locator; a table-free reply must behave exactly as it does today")
  );
});

gtest("[P9 §9 + §1] an annotated table beside a single-case test yields BOTH, merged and ascending", () => {
  const f = FORMS[1];
  const ann = `${annotatedOf(f)}\n${INLINE_RUST}`;
  const plain = `${plainOf(f)}\n${INLINE_RUST}`;
  const a = spansOf("annotated + inline", ann);
  const p = spansOf("plain + inline", plain);
  assertAscending("annotated + inline", ann, a);
  assert.deepStrictEqual(
    a.map((s) => ({ start: s.start - f.annotation.length, end: s.end - f.annotation.length })),
    pairs(p),
    `[P9 §1] the annotation changed the merged answer\n  annotated: ${JSON.stringify(textsOf(ann, a))}\n  plain:     ${JSON.stringify(textsOf(plain, p))}\n---- ANNOTATED ----\n${ann}\n---- END ----`
  );
  assert.deepStrictEqual(
    textsOf(ann, a),
    [...f.wants, "404"],
    show("annotated + inline", ann, a, "[P9 §1 + §9] the merge dropped one half; the annotated table's rows AND the separate test's expected value are both holes, in source order")
  );
});

// ===========================================================================
// Rule 10. A malformed annotation does not throw, does not hang, and answers
// as it does today, which is no table.
// ===========================================================================

const BASE = FORMS[1];
const MALFORMED = [
  ["an unbalanced bracket", ": [(u32, u64); 3"],
  ["an unclosed generic", ": Vec<(String, bool"],
  ["a lone opening generic", ": Vec<"],
  ["a `;` with no length", ": [(u32, u64);]"],
  ["a closing bracket with no opener", ": u32, u64); 3]"],
  ["200 unclosed generics", ": " + "Vec<".repeat(200)],
  ["200 unclosed brackets", ": " + "[(".repeat(200)],
];

for (const [what, annotation] of MALFORMED) {
  gtest(`[P9 §10 a malformed annotation does not throw and does not hang] ${what}`, () => {
    const text = annotatedOf(BASE, annotation);
    const t0 = Date.now();
    let spans;
    assert.doesNotThrow(() => {
      spans = fwOf(RUST).expectedValueSpans(text);
    }, `[P9 §10] expectedValueSpans threw on ${what}\n---- TEXT ----\n${text}\n---- END ----`);
    assert.doesNotThrow(() => {
      fwOf(RUST).unresolvedAssertions(text);
    }, `[P9 §10] unresolvedAssertions threw on ${what}`);
    const { lang } = at(RUST);
    if (typeof lang.deadTableColumns === "function") {
      assert.doesNotThrow(() => {
        lang.deadTableColumns(text);
      }, `[P9 §10] deadTableColumns threw on ${what}`);
    }
    const ms = Date.now() - t0;
    assert.ok(
      ms < 1000,
      `[P9 §10] ${what} took ${ms}ms. "does not hang" - a nested-generic scanner that backtracks is the shape that turns a keystroke-rate path into a stall`
    );
    assert.ok(Array.isArray(spans), `[P9 §10] expectedValueSpans returned ${JSON.stringify(spans)} on ${what}, not an array`);
    assertAscending(`malformed / ${what}`, text, spans);
  });

  gtest(`[P9 §10 a malformed annotation answers as it does today, which is no table] ${what}`, () => {
    const text = annotatedOf(BASE, annotation);
    const spans = spansOf(`malformed / ${what}`, text);
    assert.deepStrictEqual(
      textsOf(text, spans),
      [],
      show(`malformed / ${what}`, text, spans, "[P9 §10] \"It answers as it does today, which is no table.\" A span emitted off a broken annotation is a guess about where the rows start")
    );
  });
}

// ===========================================================================
// Rule 8. RUST ONLY. The four non-Rust finders must not change by one byte.
//
// This file cannot diff against the previous build, so it asserts the shipped
// behaviour of each of the four positively: the canonical table each finder
// reads still yields exactly its expected column. A widening of any of them
// onto Rust's evidence turns these red. It also hands each of them the Rust
// annotated fixture, which they must treat as text they do not understand.
// ===========================================================================

const OTHERS = {
  "go/gotest": {
    what: "Go `[]struct`",
    wants: ["101", "202", "303"],
    text: `func TestShardOf(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		buckets int
		want    int
	}{
		{"alpha", "a", 8, 101},
		{"beta", "b", 16, 202},
		{"gamma", "g", 32, 303},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got := ShardOf(tt.key, tt.buckets)
			if got != tt.want {
				t.Errorf("ShardOf() = %v, want %v", got, tt.want)
			}
		})
	}
}
`,
  },
  "typescript/vitest": {
    what: "`it.each`",
    wants: ["101", "202", "303"],
    text: `it.each([
  ["alpha", 8, 101],
  ["beta", 16, 202],
  ["gamma", 32, 303],
])("shardOf(%s, %i)", (key, buckets, want) => {
  expect(shardOf(key, buckets)).toBe(want);
});
`,
  },
  "python/pytest": {
    what: "`@pytest.mark.parametrize`",
    wants: ["101", "202", "303"],
    text: `@pytest.mark.parametrize("key,buckets,want", [
    ("alpha", 8, 101),
    ("beta", 16, 202),
    ("gamma", 32, 303),
])
def test_shard_of(key, buckets, want):
    assert shard_of(key, buckets) == want
`,
  },
  "csharp/xunit": {
    what: "C# `[InlineData]`",
    wants: ["101", "202", "303"],
    text: `[Theory]
[InlineData("alpha", 8, 101)]
[InlineData("beta", 16, 202)]
[InlineData("gamma", 32, 303)]
public void ShardOfCases(string key, int buckets, int want)
{
    Assert.Equal(want, ShardOf(key, buckets));
}
`,
  },
};

for (const [key, f] of Object.entries(OTHERS)) {
  gtest(`[P9 §8 Rust only] ${key}: the ${f.what} finder returns exactly what it returns today`, () => {
    const fw = fwOf(key);
    const spans = fw.expectedValueSpans(f.text);
    assert.ok(Array.isArray(spans), `${key}: expectedValueSpans did not return an array`);
    for (let i = 1; i < spans.length; i++) {
      assert.ok(spans[i - 1].end <= spans[i].start, show(key, f.text, spans, "[P9 §5] spans descend or overlap"));
    }
    assert.deepStrictEqual(
      pairs(spans),
      f.wants.map((lit) => rangeOf(key, f.text, lit)),
      show(key, f.text, spans, `[P9 §8] "The four non-Rust finders are out of scope and must not change by one byte." This finder's canonical table no longer yields ${JSON.stringify(f.wants)}, so the Rust annotation work widened it`)
    );
    assert.strictEqual(
      fw.unresolvedAssertions(f.text),
      0,
      `${key}: [P9 §8] the canonical table parsed, yet unresolvedAssertions now reports a refusal`
    );
  });

  gtest(`[P9 §8 Rust only] ${key}: a RUST annotated table is not a table to this finder, and does not throw`, () => {
    const fw = fwOf(key);
    const text = annotatedOf(FORMS[0]);
    let spans;
    assert.doesNotThrow(() => {
      spans = fw.expectedValueSpans(text);
    }, `${key}: expectedValueSpans threw on a Rust annotated table`);
    assert.ok(Array.isArray(spans), `${key}: expectedValueSpans did not return an array on Rust source`);
    for (let i = 1; i < spans.length; i++) {
      assert.ok(spans[i - 1].end <= spans[i].start, show(key, text, spans, "[P9 §5] spans descend or overlap"));
    }
    for (const s of spans) {
      assert.ok(
        s.start >= 0 && s.end <= text.length && s.start < s.end,
        show(key, text, spans, "[P9 §5] a span is not a valid range inside the text")
      );
    }
  });
}

// ===========================================================================
// Rule 11 (Amendment 1, 2026-09-11): the runner may BORROW the table.
//
// Found by the phase 10 live gate, not by a unit test: Claude wrote an
// eight-row table for parse_fallback_path walked by `for (name, path, expected)
// in &cases` with `*expected` in the assertion, and it found 0 spans. The
// identical text with `in cases` and `expected` finds 8. Pre-existing against
// committed HEAD, and the same defect class as the rest of the phase.
//
// The instrument is the differential again, and here it is exact WITHOUT any
// offset arithmetic: everything the locator has to find lives above the `for`
// line, so the four spellings share a byte-identical prefix and one span set.
// A guard below asserts that shared prefix rather than assuming it.
// ===========================================================================

const BORROW_ROWS = `[
            ("plain", "a/b", Some("b")),
            ("nested", "a/b/c", Some("c")),
            ("empty", "", None),
        ];`;

const BORROW_WANTS = ['Some("b")', 'Some("c")', "None"];

// One table, one binding list, one assertion. Only the spelling after `in`
// varies, which is precisely what rule 11 varies.
const borrowFixture = (iter, deref = false, annotation = "") => `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_fallback_path_cases() {
        let cases${annotation} = ${BORROW_ROWS}
        for (name, path, expected) in ${iter} {
            assert_eq!(parse_fallback_path(path), ${deref ? "*expected" : "expected"}, "case: {}", name);
        }
    }
}
`;

// Rule 11's four spellings, in the contract's own order.
const SPELLINGS = [
  ["cases", "the plain form, already working"],
  ["&cases", "shared borrow - the spelling the live gate measured at 0 spans"],
  ["&mut cases", "mutable borrow"],
  ["cases.iter()", "already working, and must stay working"],
];

for (const [iter, why] of SPELLINGS) {
  gtest(`[P9 §11 the runner may take the table BY REFERENCE] \`for (name, path, expected) in ${iter}\`: ${why}`, () => {
    const text = borrowFixture(iter);
    const spans = spansOf(`borrow / ${iter}`, text);
    assertAscending(`borrow / ${iter}`, text, spans);
    assert.deepStrictEqual(
      pairs(spans),
      BORROW_WANTS.map((lit) => rangeOf(`borrow / ${iter}`, text, lit)),
      show(`borrow / ${iter}`, text, spans, `[P9 §11] "All of these bind the same table and must find the same expected values as the plain form." Expected ${JSON.stringify(BORROW_WANTS)}. Zero spans costs every hole in the table and ends in a refusal, which is what the phase 10 live gate measured on this exact shape`)
    );
  });
}

gtest("[P9 §11 DIFFERENTIAL] one table, four runners, ONE span set: `in cases` / `in &cases` / `in &mut cases` / `in cases.iter()`", () => {
  const texts = SPELLINGS.map(([iter]) => [iter, borrowFixture(iter)]);

  // The prefix up to the `for` line is byte-identical across all four, so the
  // row spans must be identical offsets, not merely identical texts. Asserted,
  // never assumed.
  const prefixOf = (t) => t.slice(0, t.indexOf("        for ("));
  for (const [iter, text] of texts) {
    assert.strictEqual(
      prefixOf(text),
      prefixOf(texts[0][1]),
      `borrow / ${iter}: fixture bug, the four spellings do not share a byte-identical table above the runner`
    );
  }

  const got = texts.map(([iter, text]) => [iter, pairs(spansOf(`borrow / ${iter}`, text))]);
  const [, base] = got[0];
  for (const [iter, spans] of got.slice(1)) {
    assert.deepStrictEqual(
      spans,
      base,
      `[P9 §11] "The differential is the instrument again: the same table, run once per spelling, must give one span set."\n` +
        `  in ${iter}:    ${JSON.stringify(spans.map((s) => borrowFixture(iter).slice(s.start, s.end)))}\n` +
        `  in cases:      ${JSON.stringify(base.map((s) => borrowFixture("cases").slice(s.start, s.end)))}\n` +
        `---- in ${iter} ----\n${borrowFixture(iter)}\n---- END ----`
    );
  }
});

// ---------------------------------------------------------------------------
// The deref partner. `*expected` is what you write once the row is a reference.
// Phase 2's review closed this for the plain form; rule 11 requires it for the
// borrowed one. The dangerous direction is an EXTRA hole over `*expected`,
// which blanks the loop variable and ships every guessed row green.
// ---------------------------------------------------------------------------

for (const [iter, why] of SPELLINGS.slice(1)) {
  gtest(`[P9 §11 a deref is not an extra hole] \`in ${iter}\` with \`*expected\` in the assertion: ${why}`, () => {
    const text = borrowFixture(iter, true);
    const spans = spansOf(`deref / ${iter}`, text);
    assertAscending(`deref / ${iter}`, text, spans);

    assert.deepStrictEqual(
      textsOf(text, spans),
      BORROW_WANTS,
      show(`deref / ${iter}`, text, spans, `[P9 §11] "A deref in the assertion (\`*want\`, \`*expected\`) is the natural partner of the borrowed form and must not become an extra hole." Expected exactly the ${BORROW_WANTS.length} row values`)
    );

    const star = rangeOf(`deref / ${iter}`, text, "*expected");
    for (const s of spans) {
      assert.ok(
        s.end <= star.start || s.start >= star.end,
        show(`deref / ${iter}`, text, spans, "[P9 §11] a span lands on `*expected` in the RUNNER. That blanks the loop variable while the model's guessed rows stay, which inverts the blank-value invariant rather than merely failing it")
      );
    }
    for (const t of textsOf(text, spans)) {
      assert.ok(
        !t.trim().startsWith("*"),
        show(`deref / ${iter}`, text, spans, `[P9 §11] the span text ${JSON.stringify(t)} is a DEREF of the row binding, not a value out of the table`)
      );
    }
  });

  gtest(`[P9 §11 DIFFERENTIAL, deref] \`in ${iter}\` + \`*expected\` blanks exactly what the plain moved form blanks`, () => {
    const text = borrowFixture(iter, true);
    const plain = borrowFixture("cases");
    const a = spansOf(`deref / ${iter}`, text);
    const p = spansOf("borrow / cases", plain);
    assert.ok(
      p.length > 0,
      `deref / ${iter}: [P9 §11] this differential is VACUOUS - the plain moved form found nothing either, so the comparison is two empty sets\n---- PLAIN ----\n${plain}\n---- END ----`
    );
    assert.deepStrictEqual(
      pairs(a),
      pairs(p),
      `[P9 §11] borrowing the table and dereferencing the binding changed which values are blanked\n` +
        `  in ${iter} + *expected: ${JSON.stringify(textsOf(text, a))}\n` +
        `  in cases + expected:    ${JSON.stringify(textsOf(plain, p))}\n---- BORROWED ----\n${text}\n---- END ----`
    );
  });
}

// ---------------------------------------------------------------------------
// Rule 11 crossed with rule 2. A real reply can carry both at once: an
// ANNOTATED table walked by reference. Rule 1's differential must hold there
// too, and the offsets are still exact - the annotation is spliced in above the
// runner, so every row span shifts by exactly annotation.length and the `&` in
// the `for` line shifts nothing.
// ---------------------------------------------------------------------------

for (const f of FORMS) {
  for (const iter of ["&cases", "&mut cases"]) {
    gtest(`[P9 §11 x §1 x §2] ${f.id}: an ANNOTATED table walked by \`in ${iter}\` blanks the same values as the unannotated moved form`, () => {
      const ann = annotatedOf(f, undefined, iter);
      const plain = plainOf(f);
      const a = spansOf(`${f.id} / ${iter}`, ann);
      const p = spansOf(`${f.id} / plain`, plain);
      assertAscending(`${f.id} / ${iter}`, ann, a);
      assert.ok(
        p.length > 0,
        `${f.id} / ${iter}: [P9 §11] this differential is VACUOUS - the unannotated moved form found nothing either. See this form's CONTROL row`
      );
      assert.deepStrictEqual(
        a.map((s) => ({ start: s.start - f.annotation.length, end: s.end - f.annotation.length })),
        pairs(p),
        `${f.id} / ${iter}: [P9 §1 + §11] an annotated table walked by reference is still one table with one span set\n` +
          `  annotated + ${iter}: ${JSON.stringify(textsOf(ann, a))}\n` +
          `  plain + cases:       ${JSON.stringify(textsOf(plain, p))}\n---- ANNOTATED ----\n${ann}\n---- END ----`
      );
      assert.deepStrictEqual(
        textsOf(ann, a),
        f.wants,
        show(`${f.id} / ${iter}`, ann, a, `[P9 §11] expected ${JSON.stringify(f.wants)}`)
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Rule 11's last paragraph. "Go is not affected and must not move. Its `range
// cases` branch is a different keyword and a different finder, and it is out of
// scope here exactly as rule 8 says."
// ---------------------------------------------------------------------------

gtest("[P9 §11 Go is not affected and must not move] go/gotest: the `range cases` runner still finds its last column", () => {
  const f = OTHERS["go/gotest"];
  assert.ok(f.text.includes("for _, tt := range cases {"), "fixture bug: the Go fixture no longer walks the table with `range cases`");
  const spans = fwOf("go/gotest").expectedValueSpans(f.text);
  assert.deepStrictEqual(
    pairs(spans),
    f.wants.map((lit) => rangeOf("go range", f.text, lit)),
    show("go range", f.text, spans, "[P9 §11] Go's `range` branch is a different keyword and a different finder; teaching Rust the borrow spellings must not have touched it")
  );
});

gtest("[P9 §11 Go is not affected and must not move] go/gotest: a Rust borrow spelling is not Go, and the Go finder answers on it without throwing", () => {
  const text = borrowFixture("&cases", true);
  const fw = fwOf("go/gotest");
  let spans;
  assert.doesNotThrow(() => {
    spans = fw.expectedValueSpans(text);
  }, "[P9 §11] the Go finder threw on Rust source carrying `for ... in &cases`");
  assert.ok(Array.isArray(spans), "the Go finder did not return an array on Rust source");
  assertAscending("go on rust borrow", text, spans);
});

// A spelling rule 11 does NOT list, recorded here as a contract question
// rather than a code defect. `for &(a, b, want) in &cases` is the other
// natural way to write the borrowed loop, and it is the one that needs no
// deref in the assertion, so a model reaching for a `{}` format argument can
// land on it just as easily. Rule 11's list is closed ("All of these"), and
// this is not on it. A red here is a question for the contract's author.
gtest("[P9 §11 NOT LISTED, a contract question] `for &(name, path, expected) in &cases`: a reference PATTERN over a borrowed table, the spelling that needs no deref", () => {
  const text = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_fallback_path_cases() {
        let cases = ${BORROW_ROWS}
        for &(name, path, expected) in &cases {
            assert_eq!(parse_fallback_path(path), expected, "case: {}", name);
        }
    }
}
`;
  const spans = spansOf("borrow / &pattern over &cases", text);
  assertAscending("borrow / &pattern over &cases", text, spans);
  assert.deepStrictEqual(
    textsOf(text, spans),
    BORROW_WANTS,
    show("borrow / &pattern over &cases", text, spans, "[P9 §11] rule 11 lists four spellings and closes the list with \"All of these\". This is a fifth, it compiles, it is the borrowed loop written without a deref, and the contract does not say whether it is in scope. Treat a red here as a question for the contract, not as a defect against it")
  );
});
