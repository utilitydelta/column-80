// Blind oracle for session-v71 phase 1, item A: `let mut` is part of the
// binding, and a COMMENT inside the list is not a row
// [session-v68/contracts/P9-annotated-table.md AMENDMENT 4, session-v71/goal.md
// item A]. Written from those two documents alone, WITHOUT READING src/** - not
// one file, not one grep, not one peek at the bundled source text. Every
// assertion below comes from the contract's numbered rules and from Rust,
// Python, Go, TypeScript and C# grammar.
//
// Surface exercised, through the public seam, as production reaches it:
//   tddLangFor, frameworkFor, blankExpectedValues   ../src/core/tddLang
//   TestFramework.expectedValueSpans(text)          off the resolved framework
//   TestFramework.unresolvedAssertions(text)        off the resolved framework
//   TddLang.deadTableColumns(text)                  off the resolved language
// No per-framework locator is imported by name.
//
// What amendment 4 closes, from goal.md item A:
//
//     let mut cases: Vec<(i32, i32)> = vec![ (1, 2), (3, 4) ];
//     for (a, want) in cases { assert_eq!(f(a), want); }
//
//     let cases: Cases = [ // note
//         (1, 2),
//     ];
//
// The first loses every annotation form because the token before the name is
// `mut`. The second loses the table because the list reader meets a comment
// where it expects a row. Both were pinned as KNOWN LIMITs by session-v70
// (S70-8, row [REV70-P4B 6]); amendment 4 makes them rules.
//
// Two ways to fail, and they are not equally expensive:
//   A LOST table.     Zero spans, zero holes, the third floor refuses, and the
//                     human gets a generated table with the model's guessed
//                     expected values already filled in. Silent-wrong.
//   An INVERTED table. Holes land somewhere that is not the expected column:
//                     inside the annotation, inside a COMMENT, on a loop
//                     variable, on an input, or on a list no runner walks. The
//                     human types into the wrong place and every guessed row
//                     ships green.
// Every message below says which one the row is holding the line on.
//
// No expected byte offset here was computed by hand. Rule 12's triple
// differential is exact by CONSTRUCTION: the three builds of a fixture share a
// byte-identical BODY (the right-hand side, the rows and the runner) and differ
// only in the binding prefix, so the span sets are compared after subtracting
// each build's own prefix length. Everything else is pinned with
// text.indexOf(<the literal I placed there>).
//
// EXPECTED RED: the fix is not written yet. A failing `assert` here is a
// contract finding, which is the file's purpose. A bundling crash, or a
// TypeError on an export that should exist, would be a harness bug instead, so
// the bundle row is its own loud test and every other row skips behind it.
//
// Run: SKIP_LIVE=1 node --test test/blind-v71-p1-mut-binding.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v71-p1-mut-binding",
    `export { tddLangFor, frameworkFor, blankExpectedValues } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const { tddLangFor, frameworkFor, blankExpectedValues } = mod;

// Row numbering. Registration is synchronous and in source order, so `n` is
// stable across runs.
let ROW = 0;
const L = () => `[BLIND-V71-P1 ${++ROW}]`;

const gtest = (name, fn) =>
  test(`${L()} ${name}`, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

test(`${L()} bundle: the amendment 4 surface builds and exports tddLangFor + frameworkFor + blankExpectedValues [P9 'Surface under contract']`, () => {
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

// Rust is the language under contract. The other five legs are here for rule 8.
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
  ["python", "unittest", "/nowhere", () => depsOf([], {}, {}, { probe: () => ({ exitCode: 1 }) })],
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
const GO = "go/gotest";
const VITEST = "typescript/vitest";
const PYTEST = "python/pytest";
const UNITTEST = "python/unittest";
const XUNIT = "csharp/xunit";
const ALL_KEYS = [RUST, GO, VITEST, PYTEST, UNITTEST, XUNIT];

gtest("[P9 'Surface under contract'] all six legs resolve through frameworkFor and declare expectedValueSpans", () => {
  for (const key of ALL_KEYS) {
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

// Comment ranges, computed off the fixture text rather than off any knowledge
// of the implementation. My fixtures hold no string literal containing `//`,
// `/*` or `#`, so a plain scan is exact here.
function commentRanges(text, { hash = false } = {}) {
  const re = hash ? /#[^\n]*/g : /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

// [P9 §13] "A comment must never become a ROW. No span may start or end inside
// one." A hole inside a comment is the INVERTED direction: the human is asked
// to type a value into prose while the real expected value ships as guessed.
function assertNoSpanInComment(label, text, spans, opts) {
  const ranges = commentRanges(text, opts);
  assert.ok(ranges.length > 0, `${label}: fixture bug, this fixture was supposed to carry a comment and carries none`);
  for (const s of spans) {
    for (const c of ranges) {
      assert.ok(
        s.end <= c.start || s.start >= c.end,
        show(label, text, spans, `[P9 §13] a span overlaps the comment at bytes ${c.start}..${c.end} (${JSON.stringify(text.slice(c.start, c.end))}). "A comment must never become a ROW. No span may start or end inside one." That is an INVERTED table with the hole inside prose`)
      );
    }
  }
}

// ===========================================================================
// The Rust fixture. One table, one runner, one assertion. Only the BINDING
// PREFIX (`let` / `let mut`, annotated or not) and the ROWS (comments spliced
// in) vary. Two builds that share a `body` are directly comparable after each
// side's own prefix length is subtracted, and the differential rows assert the
// bodies are byte-identical before comparing.
// ===========================================================================

const HEAD = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_of_cases() {
        `;

const RUNNER = "assert_eq!(shard_of(key), want);";

const R1 = `            ("alpha", 101),`;
const R2 = `            ("beta", 202),`;
const R3 = `            ("gamma", 303),`;
const CLOSE = `        ];`;

// `open` is whatever sits on the opening line after the `[`. `before2` goes
// above the middle row, `afterLast` below the last row and above the `]`.
const rowsWith = ({ open = "", before2 = null, afterLast = null } = {}) =>
  `${open}\n${R1}\n${before2 === null ? "" : before2 + "\n"}${R2}\n${R3}\n${afterLast === null ? "" : afterLast + "\n"}${CLOSE}`;

const ROWS = rowsWith();
const WANTS = ["101", "202", "303"];

function build({ mut = false, annotation = "", rhs = "[", rows = ROWS, pattern = "(key, want)", name = "cases", walk = null, runner = RUNNER }) {
  const bind = `let ${mut ? "mut " : ""}${name}${annotation} = `;
  const body = `${rhs}${rows}
        for ${pattern} in ${walk === null ? name : walk} {
            ${runner}
        }
    }
}
`;
  return { text: HEAD + bind + body, prefixLen: HEAD.length + bind.length, body, bind };
}

const norm = (spans, prefixLen) => spans.map((s) => ({ start: s.start - prefixLen, end: s.end - prefixLen }));

// Identifiers and numbers the annotation contributes. None of these may ever
// be the text of a span: blanking one hands the human a hole where a TYPE
// belongs, and the file stops compiling.
const tokensOf = (annotation) => (annotation.match(/[A-Za-z_0-9]+/g) || []).filter((t) => t.length > 0);

// ===========================================================================
// [P9 §12 CONTROL] goal.md item A's own example, unannotated. "`let mut cases
// = [ … ]` unannotated is ALREADY found. It is the control, not the fix." If
// this row is red the whole file is measuring the wrong thing.
// ===========================================================================

gtest("[P9 §12 CONTROL] rust: `let mut cases = vec![ … ]` UNANNOTATED is already found today", () => {
  const { text } = build({ mut: true, rhs: "vec![" });
  const spans = spansOf("mut control", text);
  assertAscending("mut control", text, spans);
  assert.deepStrictEqual(
    pairs(spans),
    WANTS.map((lit) => rangeOf("mut control", text, lit)),
    show("mut control", text, spans, "[P9 §12] this is the CONTROL, not the fix: an unannotated `let mut` table is found at HEAD. A red here means the fixture shape or the walker is wrong and every rule 12 row below is measuring something other than `mut`")
  );
});

gtest("[P9 §12 CONTROL] rust: `let mut cases = [ … ]` unannotated agrees with `let cases = [ … ]` byte for byte", () => {
  const m = build({ mut: true });
  const p = build({ mut: false });
  assert.strictEqual(m.body, p.body, "fixture bug: the two builds do not share a body");
  const ms = spansOf("mut control plain rhs", m.text);
  const ps = spansOf("let control plain rhs", p.text);
  assert.ok(ps.length > 0, "[P9 §12] the `let` control found nothing either, so this differential is vacuous");
  assert.deepStrictEqual(
    norm(ms, m.prefixLen),
    norm(ps, p.prefixLen),
    `[P9 §12] "\`let mut\` binds a name exactly as \`let\` does." Unannotated, the two already agree at HEAD; a red here is the control moving, not the fix\n  mut texts: ${JSON.stringify(textsOf(m.text, ms))}\n  let texts: ${JSON.stringify(textsOf(p.text, ps))}\n---- MUT ----\n${m.text}\n---- LET ----\n${p.text}\n---- END ----`
  );
});

// ===========================================================================
// [P9 §12] Every annotation form rule 2 lists, plus the plain type-NAME form
// amendment 3 brought in, crossed with `let mut`. Each fixture is built three
// ways and the three span sets must be equal.
// ===========================================================================

const SCALAR_ROWS = rowsWith().replace('("alpha", 101)', "(1, 101)").replace('("beta", 202)', "(2, 202)").replace('("gamma", 303)', "(3, 303)");
const ARRAY_ROWS = rowsWith()
  .replace('("alpha", 101)', "([1, 2, 3, 4], 101)")
  .replace('("beta", 202)', "([5, 6, 7, 8], 202)")
  .replace('("gamma", 303)', "([9, 10, 11, 12], 303)");
const BOOL_ROWS = `
            (String::from("alpha"), true),
            (String::from("beta"), false),
${CLOSE}`;

const SHAPES = [
  {
    id: "an ARRAY with a length",
    annotation: ": [(&str, u32); 3]",
    rhs: "[",
    why: "rule 2's first form, and the exact spelling the P9 defect was measured on",
  },
  {
    id: "an ARRAY with scalar columns",
    annotation: ": [(u32, u32); 3]",
    rhs: "[",
    rows: SCALAR_ROWS,
    why: "rule 2's second form. Scalar columns, so the annotation is the only thing between `mut` and the list",
  },
  {
    id: "a VEC with `vec!`",
    annotation: ": Vec<(String, bool)>",
    rhs: "vec![",
    rows: BOOL_ROWS,
    wants: ["true", "false"],
    why: "rule 2's third form, spelled exactly as rule 2 spells it. The expected column is a bool, which is what a predicate under test returns",
  },
  {
    id: "a SLICE reference",
    annotation: ": &[(u8, u8)]",
    rhs: "&[",
    pattern: "&(key, want)",
    why: "rule 2's fourth form. `&[` yields references, so the compiling pattern is a reference pattern; grading a locator on source that could never reach a compiler is how a locator passes a test it should fail",
  },
  {
    id: "a NESTED array type inside a generic",
    annotation: ": Vec<([u8; 4], u32)>",
    rhs: "vec![",
    rows: ARRAY_ROWS,
    why: "rule 2's last bullet, `Vec<[u8; 4]>`: brackets inside angles, the depth-counting case",
  },
  {
    id: "a NESTED generic argument",
    annotation: ": Vec<(&'static str, HashMap<String, Vec<(u8, u16)>>)>",
    rhs: "vec![",
    rows: BOOL_ROWS,
    wants: ["true", "false"],
    why: "rule 2's `HashMap<String, Vec<(u8, u16)>>` nested inside the annotation, plus a LIFETIME whose apostrophe is the character a string-aware scanner mistakes for an opening quote",
  },
  {
    id: "a plain type NAME",
    annotation: ": Cases",
    rhs: "[",
    why: "the form amendment 3 brought into scope. Amendment 4 says it must survive `mut` like every other form",
  },
  {
    id: "a plain type NAME over `vec!`",
    annotation: ": CaseVec",
    rhs: "vec![",
    why: "the name-shaped annotation crossed with the second-commonest right-hand side",
  },
];

for (const s of SHAPES) {
  const wants = s.wants || WANTS;
  const common = { rhs: s.rhs, rows: s.rows, pattern: s.pattern };
  const A = build({ ...common, mut: true, annotation: s.annotation }); // let mut + annotation
  const B = build({ ...common, mut: false, annotation: s.annotation }); // let + annotation
  const C = build({ ...common, mut: true, annotation: "" }); // let mut, unannotated

  gtest(`[P9 §12 CONTROL, unannotated] rust: \`let mut\` with ${s.id}'s table and NO annotation finds ${JSON.stringify(wants)}`, () => {
    const spans = spansOf(`${s.id} control`, C.text);
    assertAscending(`${s.id} control`, C.text, spans);
    assert.deepStrictEqual(
      pairs(spans),
      wants.map((lit) => rangeOf(`${s.id} control`, C.text, lit)),
      show(`${s.id} control`, C.text, spans, `[P9 §12] the unannotated \`let mut\` control for this table shape. A red here is the table shape or the walker, NOT \`mut\` and NOT the annotation, and the triple differential below would be vacuous`)
    );
  });

  gtest(`[P9 §12 the table is found] rust: \`let mut cases${s.annotation} = …\`, ${s.id} - ${s.why}`, () => {
    const spans = spansOf(s.id, A.text);
    assertAscending(s.id, A.text, spans);
    assert.deepStrictEqual(
      pairs(spans),
      wants.map((lit) => rangeOf(s.id, A.text, lit)),
      show(s.id, A.text, spans, `[P9 §12] "Every annotation form rule 2 lists, and the plain type-NAME form amendment 3 brought in, must find the SAME span set under \`let mut cases: T = …\`." Expected ${JSON.stringify(wants)}. Zero spans is a LOST table: no holes, the third floor refuses, and the model's guessed expected values ship looking checked`)
    );
  });

  gtest(`[P9 §12 TRIPLE DIFFERENTIAL] rust: ${s.id} agrees across \`let mut\` + annotation, \`let\` + annotation, and \`let mut\` unannotated`, () => {
    assert.strictEqual(A.body, B.body, `${s.id}: fixture bug, the mut and let builds do not share a body`);
    assert.strictEqual(A.body, C.body, `${s.id}: fixture bug, the annotated and unannotated builds do not share a body`);
    const a = norm(spansOf(`${s.id} mut+ann`, A.text), A.prefixLen);
    const b = norm(spansOf(`${s.id} let+ann`, B.text), B.prefixLen);
    const c = norm(spansOf(`${s.id} mut+plain`, C.text), C.prefixLen);
    // Three empty sets satisfy "the sets are equal". A differential that cannot
    // fail is worse than no differential.
    assert.ok(
      c.length > 0,
      `${s.id}: [P9 §12] this differential is VACUOUS, the unannotated \`let mut\` control found nothing either. See the CONTROL row above\n---- CONTROL ----\n${C.text}\n---- END ----`
    );
    assert.deepStrictEqual(
      a,
      c,
      `${s.id}: [P9 §12] "the \`let mut\` fixture … agrees with its own unannotated control." The annotation is not allowed to change which values are blanked once \`mut\` is in front of the name\n  mut+annotated texts: ${JSON.stringify(textsOf(A.text, spansOf(s.id, A.text)))}\n  mut+plain     texts: ${JSON.stringify(textsOf(C.text, spansOf(s.id, C.text)))}\n---- MUT+ANNOTATED ----\n${A.text}\n---- MUT+PLAIN ----\n${C.text}\n---- END ----`
    );
    assert.deepStrictEqual(
      a,
      b,
      `${s.id}: [P9 §12] "for each annotation form, the \`let mut\` fixture and the \`let\` fixture agree." \`mut\` is part of the binding, not a barrier\n  mut texts: ${JSON.stringify(textsOf(A.text, spansOf(s.id, A.text)))}\n  let texts: ${JSON.stringify(textsOf(B.text, spansOf(s.id, B.text)))}\n---- MUT ----\n${A.text}\n---- LET ----\n${B.text}\n---- END ----`
    );
  });

  gtest(`[P9 §3 the annotation is never scanned as rows] rust: \`let mut\` + ${s.id} puts no span inside the annotation and none before the \`=\``, () => {
    const spans = spansOf(`${s.id} rule 3`, A.text);
    const annStart = A.text.indexOf(s.annotation);
    assert.ok(annStart > 0, `${s.id}: fixture bug, the annotation is not in the text`);
    const annEnd = annStart + s.annotation.length;
    const eq = A.text.indexOf("=", annEnd);
    assert.ok(eq > 0, `${s.id}: fixture bug, no \`=\` after the annotation`);
    const banned = tokensOf(s.annotation);
    for (const x of spans) {
      assert.ok(
        x.start >= annEnd,
        show(`${s.id} rule 3`, A.text, spans, `[P9 §3] a span lands INSIDE the annotation ${JSON.stringify(s.annotation)} (bytes ${annStart}..${annEnd}). "No span may ever fall inside an annotation." That is an INVERTED table: the hole sits where a type name belongs and the source stops compiling`)
      );
      assert.ok(
        x.start > eq,
        show(`${s.id} rule 3`, A.text, spans, `[P9 §3] a span begins at ${x.start}, before the \`=\` at ${eq}. Every expected value is on the right-hand side of the binding, so a span left of it is the annotation or the binding being read as rows`)
      );
    }
    for (const t of textsOf(A.text, spans)) {
      assert.ok(
        !banned.includes(t.trim()) && t.trim() !== "mut" && t.trim() !== "cases",
        show(`${s.id} rule 3`, A.text, spans, `[P9 §3 + §12] the span text ${JSON.stringify(t)} is a token the annotation or the binding contributed (${JSON.stringify(banned)} plus \`mut\` and \`cases\`). Blanking one is worse than finding nothing: the human is asked to type a value where a type or a name goes`)
      );
    }
  });
}

// ===========================================================================
// [P9 §12] Falsification. "A fix that special-cases the literal string `mut` in
// the wrong place, so `let mutable_cases: T = …` is read as `let` +
// `able_cases`." And `mut` is the ONLY modifier: an arbitrary run of
// identifiers must not name a table.
// ===========================================================================

gtest("[P9 §12 FALSIFICATION] rust: `let mutable_cases: Cases = …` is a name that merely STARTS with `mut`, and its table is still found", () => {
  const b = build({ mut: false, annotation: ": Cases", name: "mutable_cases" });
  const spans = spansOf("mutable_cases", b.text);
  assertAscending("mutable_cases", b.text, spans);
  assert.deepStrictEqual(
    pairs(spans),
    WANTS.map((lit) => rangeOf("mutable_cases", b.text, lit)),
    show("mutable_cases", b.text, spans, "[P9 §12 falsification note] \"a fix that special-cases the literal string `mut` in the wrong place, so `let mutable_cases: T = …` (an identifier that merely starts with `mut`) is read as `let` + `able_cases`.\" A name read as `able_cases` has no walker, the table is LOST, and the human keeps three guessed expected values. This is a plain annotated `let`, so it is green at HEAD: a red here is the fix eating its own tail")
  );
});

gtest("[P9 §12 FALSIFICATION] rust: `let mutable_cases = …` unannotated, the same name with no annotation at all", () => {
  const b = build({ mut: false, annotation: "", name: "mutable_cases" });
  const spans = spansOf("mutable_cases plain", b.text);
  assertAscending("mutable_cases plain", b.text, spans);
  assert.deepStrictEqual(
    pairs(spans),
    WANTS.map((lit) => rangeOf("mutable_cases plain", b.text, lit)),
    show("mutable_cases plain", b.text, spans, "[P9 §12] the unannotated half of the same falsification. `mutable_cases` is one identifier and always was")
  );
});

gtest("[P9 §12 + §4 FALSIFICATION] rust: `let mut cases: Cases = …` whose loop walks a DIFFERENT name is not that table's walker", () => {
  const b = build({ mut: true, annotation: ": Cases", walk: "cases_extra" });
  const spans = spansOf("mut wrong walker", b.text);
  assertAscending("mut wrong walker", b.text, spans);
  const rows = [
    rangeOf("mut wrong walker", b.text, '("alpha", 101)'),
    rangeOf("mut wrong walker", b.text, '("beta", 202)'),
    rangeOf("mut wrong walker", b.text, '("gamma", 303)'),
  ];
  for (const s of spans) {
    for (const r of rows) {
      assert.ok(
        s.end <= r.start || s.start >= r.end,
        show("mut wrong walker", b.text, spans, "[P9 §4] `for (key, want) in cases_extra` walks a different list. Blanking `cases`'s rows on the strength of a loop over `cases_extra` is an INVERTED table: holes in a list the runner never reads. Amendment 2's `\\b` fix exists for exactly this, and accepting `mut` must not route around it")
      );
    }
  }
});

gtest("[P9 §12 SCOPE, `mut` is the only modifier] rust: `let foo bar cases: Cases = …` must not name a table", () => {
  const b = build({ mut: false, annotation: ": Cases", name: "foo bar cases" });
  const spans = spansOf("foo bar cases", b.text);
  assertAscending("foo bar cases", b.text, spans);
  const rows = [
    rangeOf("foo bar cases", b.text, '("alpha", 101)'),
    rangeOf("foo bar cases", b.text, '("beta", 202)'),
    rangeOf("foo bar cases", b.text, '("gamma", 303)'),
  ];
  for (const s of spans) {
    for (const r of rows) {
      assert.ok(
        s.end <= r.start || s.start >= r.end,
        show("foo bar cases", b.text, spans, "[P9 §12] \"`mut` is the only modifier in scope … admitting an arbitrary run of identifiers there would let `foo bar cases: T = …` name a table.\" The contract names that outcome as the thing not to do, so a span in these rows is the widening going too far")
      );
    }
  }
});

// ===========================================================================
// [P9 §4] The false-admit direction under `mut`. An annotated `let mut` with no
// destructuring loop is still not a table.
// ===========================================================================

const MUT_NO_WALKER = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_its_inputs() {
        let mut cases: Cases = [(1, 2), (3, 4)];
        cases.sort();
        assert_eq!(shard_of(cases[0].0), 101);
        assert_eq!(shard_of(cases[1].0), 202);
    }
}
`;

gtest("[P9 §4 walkerAfter is load-bearing] rust: a `let mut` annotated list with no destructuring loop is not a table", () => {
  const spans = spansOf("mut, no walker", MUT_NO_WALKER);
  assertAscending("mut, no walker", MUT_NO_WALKER, spans);
  assert.deepStrictEqual(
    textsOf(MUT_NO_WALKER, spans),
    ["101", "202"],
    show("mut, no walker", MUT_NO_WALKER, spans, "[P9 §4] \"An annotated `let` with no destructuring loop after it is still NOT a table, exactly as the unannotated form is not.\" `let mut` is the spelling a model reaches for precisely when it is about to MUTATE the list, which is when the list is data rather than a case table. The holes belong to the two INLINE assertions; a span over `2` or `4` is an INVERTED table where the human retypes the test's own inputs")
  );
  const list = rangeOf("mut, no walker", MUT_NO_WALKER, "[(1, 2), (3, 4)]");
  for (const s of spans) {
    assert.ok(
      s.end <= list.start || s.start >= list.end,
      show("mut, no walker", MUT_NO_WALKER, spans, "[P9 §4] a span landed inside `[(1, 2), (3, 4)]`, which no runner walks")
    );
  }
});

// ===========================================================================
// [P9 §6 + §7] The lint and the refusal counter under `mut`.
// ===========================================================================

const DEAD_MUT = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_of_cases() {
        let mut cases: Cases = [
            ("alpha", 8, 4, 101),
            ("beta", 16, 8, 202),
        ];
        for (key, buckets, limit, want) in cases {
            assert_eq!(shard_of(key, buckets), want);
        }
    }
}
`;

gtest("[P9 §6 deadTableColumns reads the same table] rust: a `let mut` annotated table still reports its dead column, by name", () => {
  const { lang } = at(RUST);
  const plain = DEAD_MUT.replace("let mut cases: Cases =", "let cases =");
  let p;
  let a;
  assert.doesNotThrow(() => {
    p = [...lang.deadTableColumns(plain)].sort();
    a = [...lang.deadTableColumns(DEAD_MUT)].sort();
  }, "deadTableColumns threw");
  assert.deepStrictEqual(
    p,
    ["limit"],
    `the UNANNOTATED, non-mut baseline for §6 does not report the bound-and-never-read column, so a red on the mut row is not attributable to \`mut\`. Got ${JSON.stringify(p)}`
  );
  assert.deepStrictEqual(
    a,
    p,
    `[P9 §6 + §12] "A column bound by an annotated table and never read in the runner body is still reported dead, with the same name it would carry unannotated." \`let mut\` moved the lint's answer from ${JSON.stringify(p)} to ${JSON.stringify(a)}, so the human loses the knob warning\n---- MUT ----\n${DEAD_MUT}\n---- END ----`
  );
  for (const n of a) {
    assert.ok(
      !["Cases", "mut", "cases"].includes(n),
      `[P9 §3] deadTableColumns returned ${JSON.stringify(n)}, which is the annotation, the modifier or the binding name, not a bound column. Got ${JSON.stringify(a)}`
    );
  }
});

gtest("[P9 §7 unresolvedAssertions does not change its answer] rust: `let mut` + annotation reports what `let` + annotation reports", () => {
  const A = build({ mut: true, annotation: ": Cases" });
  const B = build({ mut: false, annotation: ": Cases" });
  const C = build({ mut: true, annotation: "" });
  let a;
  let b;
  let c;
  assert.doesNotThrow(() => {
    a = fwOf(RUST).unresolvedAssertions(A.text);
    b = fwOf(RUST).unresolvedAssertions(B.text);
    c = fwOf(RUST).unresolvedAssertions(C.text);
  }, "unresolvedAssertions threw on a `let mut` fixture");
  assert.strictEqual(a, b, `[P9 §7] \`mut\` moved unresolvedAssertions from ${b} to ${a}. The three texts hold the same rows and the same runner`);
  assert.strictEqual(a, c, `[P9 §7] the annotation moved unresolvedAssertions from ${c} to ${a} on the \`let mut\` binding`);
});

gtest("[P9 'Surface under contract'] rust: blankExpectedValues opens one hole per row on a `let mut` annotated table and hands the runner back byte-identical", () => {
  const { lang, fw } = at(RUST);
  const A = build({ mut: true, annotation: ": Cases" });
  const C = build({ mut: true, annotation: "" });
  const res = blankExpectedValues(lang, fw, A.text, "u32");
  const base = blankExpectedValues(lang, fw, C.text, "u32");
  assert.ok(res && typeof res.snippet === "string", `blankExpectedValues returned no snippet: ${JSON.stringify(res)}`);
  const tail = `\n---- SNIPPET ----\n${res.snippet}\n---- END SNIPPET ----`;
  assert.strictEqual(
    res.holes,
    WANTS.length,
    `[P9 §12] expected one hole per row (${WANTS.length}), got ${res.holes}. The unannotated \`let mut\` table gives ${base.holes}. Zero holes is a LOST table: the third floor refuses, nothing is written, and the model's three guesses stand${tail}`
  );
  assert.strictEqual(res.holes, base.holes, `[P9 §12] the annotation changed the hole count from ${base.holes} to ${res.holes} on a \`let mut\` binding${tail}`);
  assert.ok(
    res.snippet.includes(RUNNER),
    `the runner ${JSON.stringify(RUNNER)} is not in the snippet unchanged. A hole in the runner blanks the LOOP VARIABLE, which is an INVERTED table${tail}`
  );
  assert.ok(res.snippet.includes("let mut cases: Cases"), `[P9 §3] the binding \`let mut cases: Cases\` did not survive the blanker verbatim, so a hole was opened inside the binding or its type${tail}`);
});

// ===========================================================================
// [P9 §13] A comment inside the list is not a row, and does not lose the table.
// Every position the amendment names, annotated and unannotated.
// ===========================================================================

const COMMENTS = [
  {
    id: "a trailing LINE comment on the opening line",
    rows: rowsWith({ open: " // the interesting ones" }),
    why: "amendment 4's own example, and row [REV70-P4B 6]. The comment sits between the list's `[` and its first row",
  },
  {
    id: "a LINE comment before a MIDDLE row",
    rows: rowsWith({ before2: "            // the wide one" }),
    why: "\"a line comment before ANY row, not only the first\". A reader that only steps over the opening line still loses this one",
  },
  {
    id: "a LINE comment after the LAST row, before the `]`",
    rows: rowsWith({ afterLast: "            // and that is all" }),
    why: "\"a line comment after the last row, before the `]`\". The reader has to reach the `]` without treating the comment as an unterminated row",
  },
  {
    id: "a BLOCK comment on the opening line",
    rows: rowsWith({ open: " /* the interesting ones */" }),
    why: "\"a block comment in the same positions\". `/* … */` does not end at the newline, so a line-comment-only step-over misses it",
  },
  {
    id: "a BLOCK comment before a MIDDLE row",
    rows: rowsWith({ before2: "            /* the wide one */" }),
    why: "the block spelling in the middle position",
  },
  {
    id: "a BLOCK comment after the LAST row",
    rows: rowsWith({ afterLast: "            /* and that is all */" }),
    why: "the block spelling in the trailing position",
  },
  {
    id: "Rust's `///` doc spelling",
    rows: rowsWith({ before2: "            /// the wide one" }),
    why: "\"Rust's `///` and `//!` spellings, which are line comments to a lexer\". A reader keyed on exactly two slashes reads the third as content",
  },
  {
    id: "Rust's `//!` inner doc spelling",
    rows: rowsWith({ before2: "            //! the wide one" }),
    why: "the inner doc spelling, a line comment to a lexer and nothing else",
  },
  {
    id: "a MULTI-LINE block comment before a middle row",
    rows: rowsWith({ before2: "            /* the wide one,\n               and why it matters */" }),
    why: "a block comment that spans lines. A reader that steps over one LINE steps into the middle of this one",
  },
];

for (const c of COMMENTS) {
  for (const annotation of [": Cases", ""]) {
    const what = annotation === "" ? "unannotated" : `annotated \`${annotation.trim()}\``;
    const b = build({ mut: false, annotation, rows: c.rows });
    const plain = build({ mut: false, annotation, rows: ROWS });

    gtest(`[P9 §13 a comment does not lose the table] rust, ${what}: ${c.id} - ${c.why}`, () => {
      const spans = spansOf(`${c.id} / ${what}`, b.text);
      assertAscending(`${c.id} / ${what}`, b.text, spans);
      assertNoSpanInComment(`${c.id} / ${what}`, b.text, spans);
      assert.deepStrictEqual(
        pairs(spans),
        WANTS.map((lit) => rangeOf(`${c.id} / ${what}`, b.text, lit)),
        show(`${c.id} / ${what}`, b.text, spans, `[P9 §13] "Annotated or not, this is the same table as the comment-free form and produces the same spans. … the list reader must step over it the way it steps over one anywhere else inside the list." Expected ${JSON.stringify(WANTS)}. Zero spans is a LOST table and the model's guesses ship looking checked`)
      );
    });

    gtest(`[P9 §13 DIFFERENTIAL] rust, ${what}: ${c.id} blanks exactly what the comment-free table blanks`, () => {
      const withC = spansOf(`${c.id} / ${what} commented`, b.text);
      const without = spansOf(`${c.id} / ${what} plain`, plain.text);
      assert.ok(
        without.length > 0,
        `[P9 §13] this differential is VACUOUS: the comment-free form found nothing either\n---- PLAIN ----\n${plain.text}\n---- END ----`
      );
      assert.deepStrictEqual(
        textsOf(b.text, withC),
        textsOf(plain.text, without),
        `[P9 §13] the comment changed WHICH values are blanked.\n  with comment: ${JSON.stringify(textsOf(b.text, withC))}\n  comment-free: ${JSON.stringify(textsOf(plain.text, without))}\n---- WITH COMMENT ----\n${b.text}\n---- COMMENT-FREE ----\n${plain.text}\n---- END ----`
      );
    });
  }
}

gtest("[P9 §12 + §13] rust: `let mut cases: Cases = [ // note` crosses both new rules at once", () => {
  const b = build({ mut: true, annotation: ": Cases", rows: rowsWith({ open: " // the interesting ones" }) });
  const spans = spansOf("mut + comment", b.text);
  assertAscending("mut + comment", b.text, spans);
  assertNoSpanInComment("mut + comment", b.text, spans);
  assert.deepStrictEqual(
    pairs(spans),
    WANTS.map((lit) => rangeOf("mut + comment", b.text, lit)),
    show("mut + comment", b.text, spans, "[P9 §12 + §13] both rules on one binding. A fix that lands one and not the other is still a LOST table here, and this is the spelling goal.md item A puts at the top of the file")
  );
});

// ===========================================================================
// [P9 §13 FALSIFICATION] "a comment read as a row". The comment's TEXT is
// row-shaped, so a reader that does not lex comments finds `(1, 2)` where a row
// should be and blanks the `2` - a hole inside prose, which is the INVERTED
// direction and worse than losing the table.
// ===========================================================================

for (const annotation of [": Cases", ""]) {
  const what = annotation === "" ? "unannotated" : `annotated \`${annotation.trim()}\``;
  const b = build({ mut: false, annotation, rows: rowsWith({ open: " // (1, 2)" }) });

  gtest(`[P9 §13 FALSIFICATION] rust, ${what}: \`[ // (1, 2)\` - the real table below is found and the row-shaped COMMENT contributes no span`, () => {
    const spans = spansOf(`row-shaped comment / ${what}`, b.text);
    assertAscending(`row-shaped comment / ${what}`, b.text, spans);
    const comment = rangeOf(`row-shaped comment / ${what}`, b.text, "// (1, 2)");
    for (const s of spans) {
      assert.ok(
        s.end <= comment.start || s.start >= comment.end,
        show(`row-shaped comment / ${what}`, b.text, spans, "[P9 §13 falsification note] \"`let cases: Cases = [ // (1, 2)` has a comment whose text is row-shaped; the table below it must be found and the comment must not contribute a span.\" A hole inside a comment is INVERTED: the human types a value into prose, the source still compiles, and the real expected value ships as the model guessed it")
      );
    }
    for (const t of textsOf(b.text, spans)) {
      assert.ok(
        t.trim() !== "1" && t.trim() !== "2",
        show(`row-shaped comment / ${what}`, b.text, spans, `[P9 §13] the span text ${JSON.stringify(t)} can only have come from inside the comment \`// (1, 2)\`; the real rows hold no 1 and no 2`)
      );
    }
    assert.deepStrictEqual(
      pairs(spans),
      WANTS.map((lit) => rangeOf(`row-shaped comment / ${what}`, b.text, lit)),
      show(`row-shaped comment / ${what}`, b.text, spans, `[P9 §13] the real table below the comment must still be found: ${JSON.stringify(WANTS)}`)
    );
  });
}

const COMMENTS_ONLY = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shard_of_cases() {
        let cases: Cases = [
            // ("alpha", 101),
            // ("beta", 202),
        ];
        for (key, want) in cases {
            assert_eq!(shard_of(key), want);
        }
    }
}
`;

gtest("[P9 §13] rust: a list whose only \"rows\" are commented out is not a table", () => {
  const spans = spansOf("comments only", COMMENTS_ONLY);
  assertAscending("comments only", COMMENTS_ONLY, spans);
  assertNoSpanInComment("comments only", COMMENTS_ONLY, spans);
  assert.deepStrictEqual(
    spans,
    [],
    show("comments only", COMMENTS_ONLY, spans, "[P9 §13] \"a table whose only 'rows' are comments is not a table.\" Every span here is a hole inside prose: an INVERTED table where the human edits a commented-out line and the empty runner still passes")
  );
});

// ===========================================================================
// [P9 §8] The other five legs. The annotation walk is RUST ONLY, and rule 13's
// list reader is SHARED. Amendment 4: "the Python, Go, `it.each` and C#
// attribute finders are measured before and after: … stepping over one is
// allowed to CHANGE those answers only in the direction of finding a table that
// a comment was hiding. Any other move is a finding."
//
// Two rows per leg. The PIN row fixes the comment-free answer, which may not
// move at all. The DIRECTION row fixes what a commented list is allowed to
// answer: the same values, or nothing, and never a value from somewhere else
// and never a span inside the comment.
// ===========================================================================

const OTHERS = [
  {
    key: GO,
    what: "Go `[]struct`",
    wants: ["101", "202", "303"],
    plain: `func TestShardOf(t *testing.T) {
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
    comment: `\t\t// the wide one\n`,
    anchor: `\t\t{"beta", "b", 16, 202},\n`,
  },
  {
    key: VITEST,
    what: "`it.each`",
    wants: ["101", "202", "303"],
    plain: `it.each([
  ["alpha", 8, 101],
  ["beta", 16, 202],
  ["gamma", 32, 303],
])("shardOf(%s, %i)", (key, buckets, want) => {
  expect(shardOf(key, buckets)).toBe(want);
});
`,
    comment: `  // the wide one\n`,
    anchor: `  ["beta", 16, 202],\n`,
  },
  {
    key: PYTEST,
    what: "`@pytest.mark.parametrize`",
    wants: ["101", "202", "303"],
    hash: true,
    plain: `@pytest.mark.parametrize("key,buckets,want", [
    ("alpha", 8, 101),
    ("beta", 16, 202),
    ("gamma", 32, 303),
])
def test_shard_of(key, buckets, want):
    assert shard_of(key, buckets) == want
`,
    comment: `    # the wide one\n`,
    anchor: `    ("beta", 16, 202),\n`,
  },
  {
    key: XUNIT,
    what: "C# `[InlineData]`",
    wants: ["101", "202", "303"],
    plain: `[Theory]
[InlineData("alpha", 8, 101)]
[InlineData("beta", 16, 202)]
[InlineData("gamma", 32, 303)]
public void ShardOfCases(string key, int buckets, int want)
{
    Assert.Equal(want, ShardOf(key, buckets));
}
`,
    comment: `// the wide one\n`,
    anchor: `[InlineData("beta", 16, 202)]\n`,
  },
];

for (const o of OTHERS) {
  const commented = o.plain.replace(o.anchor, o.comment + o.anchor);

  gtest(`[P9 §8 PIN, must not move] ${o.key}: the ${o.what} finder returns exactly what it returns today`, () => {
    const spans = spansOn(o.key, `${o.key} pin`, o.plain);
    assertAscending(`${o.key} pin`, o.plain, spans);
    assert.deepStrictEqual(
      pairs(spans),
      o.wants.map((lit) => rangeOf(`${o.key} pin`, o.plain, lit)),
      show(`${o.key} pin`, o.plain, spans, `[P9 §8] "The Python leg must not move by one byte … Any other move is a finding." This finder's canonical table no longer yields ${JSON.stringify(o.wants)}, so rules 12 or 13 widened it`)
    );
    assert.strictEqual(
      fwOf(o.key).unresolvedAssertions(o.plain),
      0,
      `${o.key}: [P9 §8] the canonical table parsed, yet unresolvedAssertions now reports a refusal`
    );
  });

  gtest(`[P9 §8 DIRECTION] ${o.key}: a comment inside the ${o.what} list may only move the answer toward finding the table`, () => {
    const spans = spansOn(o.key, `${o.key} commented`, commented);
    assertAscending(`${o.key} commented`, commented, spans);
    assertNoSpanInComment(`${o.key} commented`, commented, spans, { hash: !!o.hash });
    const got = textsOf(commented, spans);
    for (const t of got) {
      assert.ok(
        o.wants.includes(t.trim()),
        show(`${o.key} commented`, commented, spans, `[P9 §8 amendment 4] the span text ${JSON.stringify(t)} is not one of this table's expected values ${JSON.stringify(o.wants)}. "Stepping over one is allowed to CHANGE those answers only in the direction of finding a table that a comment was hiding. Any other move is a finding." Blanking anything else is an INVERTED table`)
      );
    }
    assert.deepStrictEqual(
      got,
      got.slice().sort((a2, b2) => o.wants.indexOf(a2) - o.wants.indexOf(b2)),
      show(`${o.key} commented`, commented, spans, "[P9 §5 + §8] the values came back out of table order, so the comment reordered the read")
    );
  });

  gtest(`[P9 §8 MEASUREMENT] ${o.key}: a comment inside the ${o.what} list does not lose the table (allowed to be red; a move is what is pinned)`, () => {
    const spans = spansOn(o.key, `${o.key} commented measure`, commented);
    const plainSpans = spansOn(o.key, `${o.key} plain measure`, o.plain);
    assert.deepStrictEqual(
      textsOf(commented, spans),
      textsOf(o.plain, plainSpans),
      `[P9 §8 amendment 4] MEASUREMENT row, not a demand. "a comment inside a list is legal in all five languages, and stepping over one is allowed to CHANGE those answers only in the direction of finding a table that a comment was hiding." Red here means a comment hides this leg's table: rule 13 PERMITS a fix and does not require one, so a red before the fix is the measurement and a red that appears AFTER a green is a regression.\n  with comment: ${JSON.stringify(textsOf(commented, spans))}\n  comment-free: ${JSON.stringify(textsOf(o.plain, plainSpans))}\n---- WITH COMMENT ----\n${commented}\n---- END ----`
    );
  });

  gtest(`[P9 §8 Rust only] ${o.key}: a RUST \`let mut\` annotated table is not a table to this finder, and does not throw`, () => {
    const b = build({ mut: true, annotation: ": Cases" });
    const spans = spansOn(o.key, `${o.key} on rust mut`, b.text);
    assertAscending(`${o.key} on rust mut`, b.text, spans);
    for (const t of textsOf(b.text, spans)) {
      assert.ok(
        !["Cases", "cases", "mut", "want", "key"].includes(t.trim()),
        show(`${o.key} on rust mut`, b.text, spans, "[P9 §8] a non-Rust finder read a Rust binding's annotation, its `mut`, or its loop variable as an expected value")
      );
    }
  });
}

// ===========================================================================
// [P9 §8] The Python assignment leg, which is the one with the scar. Amendment
// 2: `nameBeforeAnnotation` crossed statement and block boundaries and found
// the `:` that ends an `if`/`for`/`while`/`with` header, so HEAD's `b` became
// `2` and `4` - the second column of a list no runner walks - while `b`, the
// real expected value, shipped as guessed. Rules 12 and 13 widen the Rust walk
// and the shared list reader again. These rows hold that line.
// ===========================================================================

const PY_LEGS = [
  {
    key: PYTEST,
    id: "pytest",
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
      show(`${leg.id} control`, text, spans, "[P2 'The shape, per language'] a python `cases = [...]` walked by a destructuring `for` is a table, and its expected column is each tuple's last element. This is the baseline the rows below are measured against")
    );
  });

  gtest(`[P9 §8 Rust only, python ${leg.id}] an ANNOTATED python binding answers as HEAD answers, because the annotation walk is gated off this leg`, () => {
    const text = leg.table("cases: list[tuple[int, int]] = [(1, 2), (3, 4)]");
    const spans = spansOn(leg.key, `${leg.id} annotated`, text);
    assertAscending(`${leg.id} annotated`, text, spans);
    assert.deepStrictEqual(
      textsOf(text, spans),
      ["b"],
      show(`${leg.id} annotated`, text, spans, "[P9 §8 amendment 2 + amendment 4] \"The annotated Python rows amendment 2 reverted answer today what they answered at `a81e986`.\" HEAD answers `b`, the inline locator's read of the runner. If this row turns to `[\"2\", \"4\"]` the `mut` widening leaked onto Python and the human gets an INVERTED table: holes on a list no runner walks while the real expected value ships as guessed")
    );
  });

  gtest(`[P9 §8 + §12, python ${leg.id}] a python name that starts with \`mut\` is not a Rust binding`, () => {
    const text = leg
      .table("mutable_cases: list[tuple[int, int]] = [(1, 2), (3, 4)]")
      .replace("for a, b in cases:", "for a, b in mutable_cases:");
    const spans = spansOn(leg.key, `${leg.id} mutable_cases`, text);
    assertAscending(`${leg.id} mutable_cases`, text, spans);
    assert.deepStrictEqual(
      textsOf(text, spans),
      ["b"],
      show(`${leg.id} mutable_cases`, text, spans, "[P9 §8] the python leg keeps HEAD's answer whatever the identifier is called. `[\"2\", \"4\"]` here is the amendment 2 inversion arriving through rule 12's `mut` handling")
    );
  });

  const PY_HEADERS = [
    ["if cases:", "an `if` header"],
    ["for c in cases:", "a `for` header, which is the walker's own shape"],
  ];

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
    });
  }

  gtest(`[P9 §8 + §13 DIRECTION, python ${leg.id}] a comment inside a python assigned list may only move the answer toward the table`, () => {
    const text = leg.table("cases = [  # the interesting ones\n        (1, 2),\n        (3, 4),\n    ]");
    const spans = spansOn(leg.key, `${leg.id} commented`, text);
    assertAscending(`${leg.id} commented`, text, spans);
    assertNoSpanInComment(`${leg.id} commented`, text, spans, { hash: true });
    for (const t of textsOf(text, spans)) {
      assert.ok(
        ["2", "4", "b"].includes(t.trim()),
        show(`${leg.id} commented`, text, spans, `[P9 §8 amendment 4] the span text ${JSON.stringify(t)} is neither this table's expected column (\`2\`, \`4\`) nor HEAD's inline answer (\`b\`). Stepping over a comment is allowed to find a hidden table and nothing else`)
      );
    }
  });

  gtest(`[P9 §7 + §8] python ${leg.id}: unresolvedAssertions does not change because a python list carried a comment`, () => {
    const plain = leg.table("cases = [(1, 2), (3, 4)]");
    const commented = leg.table("cases = [  # the interesting ones\n        (1, 2),\n        (3, 4),\n    ]");
    let p;
    let c;
    assert.doesNotThrow(() => {
      p = fwOf(leg.key).unresolvedAssertions(plain);
      c = fwOf(leg.key).unresolvedAssertions(commented);
    }, `${leg.id}: unresolvedAssertions threw`);
    assert.strictEqual(
      c,
      p,
      `${leg.id}: [P9 §7 + §8] the comment moved unresolvedAssertions from ${p} to ${c}. The two texts hold the same rows and the same runner\n---- COMMENTED ----\n${commented}\n---- END ----`
    );
  });

  gtest(`[P9 §8 Rust only] python ${leg.id}: a RUST \`let mut\` annotated table with a comment is not a table to this finder, and does not throw`, () => {
    const b = build({ mut: true, annotation: ": Cases", rows: rowsWith({ open: " // the interesting ones" }) });
    const spans = spansOn(leg.key, `${leg.id} on rust mut+comment`, b.text);
    assertAscending(`${leg.id} on rust mut+comment`, b.text, spans);
    for (const t of textsOf(b.text, spans)) {
      assert.ok(
        !["Cases", "cases", "mut", "want", "key", "interesting", "ones"].includes(t.trim()),
        show(`${leg.id} on rust mut+comment`, b.text, spans, "[P9 §8] a python finder read a Rust binding's annotation, its `mut`, its loop variable or its COMMENT as an expected value")
      );
    }
  });
}

// ===========================================================================
// [P9 §10] Neither new rule may throw or hang on text that is not what it
// expects. A comment scanner that backtracks, or one that runs to EOF looking
// for a `*/` that is not there, is the shape that stalls a keystroke-rate path.
// ===========================================================================

const RAGGED = [
  ["an UNCLOSED block comment inside the list", rowsWith({ before2: "            /* the wide one" })],
  ["a `*/` with no opener", rowsWith({ before2: "            the wide one */" })],
  ["a comment holding an unbalanced `[`", rowsWith({ open: " // [(1, 2" })],
  ["a comment holding a `]` and a `;`", rowsWith({ open: " // )]; done" })],
  ["200 comment lines inside the list", rowsWith({ before2: Array.from({ length: 200 }, (_, i) => `            // note ${i}`).join("\n") })],
];

for (const [what, rows] of RAGGED) {
  gtest(`[P9 §10 neither throws nor hangs] rust: \`let mut cases: Cases\` with ${what}`, () => {
    const b = build({ mut: true, annotation: ": Cases", rows });
    const t0 = Date.now();
    let spans;
    assert.doesNotThrow(() => {
      spans = fwOf(RUST).expectedValueSpans(b.text);
    }, `[P9 §10] expectedValueSpans threw on ${what}\n---- TEXT ----\n${b.text}\n---- END ----`);
    assert.doesNotThrow(() => {
      fwOf(RUST).unresolvedAssertions(b.text);
    }, `[P9 §10] unresolvedAssertions threw on ${what}`);
    assert.doesNotThrow(() => {
      at(RUST).lang.deadTableColumns(b.text);
    }, `[P9 §10] deadTableColumns threw on ${what}`);
    const ms = Date.now() - t0;
    assert.ok(ms < 1000, `[P9 §10] ${what} took ${ms}ms. A comment scanner that backtracks is the shape that stalls a keystroke-rate path`);
    assert.ok(Array.isArray(spans), `[P9 §10] expectedValueSpans returned ${JSON.stringify(spans)} on ${what}, not an array`);
    assertAscending(`ragged / ${what}`, b.text, spans);
    const eq = b.text.indexOf("=", b.text.indexOf(": Cases"));
    for (const s of spans) {
      assert.ok(
        s.start > eq,
        show(`ragged / ${what}`, b.text, spans, "[P9 §3 + §10] a span landed left of the `=` on ragged input. Guessing where the rows start off text the reader cannot parse is how a hole ends up inside a type")
      );
    }
  });
}
