// BLIND ORACLE — v11 (Python, 4th language) contract tests for two pure
// shared helpers. Written from the DOCUMENTED CONTRACT ONLY; the implementation
// of src/core/fimInject.ts and src/core/symbols.ts was never opened.
//
// Three tiers of assertion live here:
//   1. Already-green contract points — behavior current main already honors
//      (member-site detection, numeric-float darkness, the #/// asymmetry on
//      the read side, and every declarationHeadLine decorator/bare shape).
//   2. The DRIVEN-TO-GREEN red baseline: fimMemberSite `["#"]` line-comment
//      darkness. These were genuinely red before the `lineComments` param
//      landed and are now green — they lock that the Python comment token
//      darkens the current line (and only the current line).
//   3. NOT-YET-MET tripwires, marked node:test `{ todo: true }`: two Python
//      shapes the C-family-shaped helpers still mis-detect (slice `::` seen as
//      scope; a bare `#` line inside decorator trivia stopping the head walk).
//      Python detection for these lands in phase 3/4; a failing todo reports as
//      "todo" (green gate intact) and flips loud when the phase clears it.
//
// Run: SKIP_LIVE=1 node --test test/blind-v11-seam.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v11-seam",
  `export { fimMemberSite, memberSiteFor, pyMemberSite } from "../src/core/fimInject";\n` +
    `export { declarationHeadLine } from "../src/core/symbols";\n`,
);
test.after(() => cleanup());
const { fimMemberSite, memberSiteFor, pyMemberSite, declarationHeadLine } = mod;

// ---------------------------------------------------------------------------
// CONTRACT 1 — fimMemberSite(prefix, lineComments?) -> {partial} | undefined
// ---------------------------------------------------------------------------

// A member site: prefix ends with an OPTIONAL identifier immediately preceded
// by `.` or `::`. `partial` is the already-typed member name (may be "").
const MEMBER_SITE_CASES = [
  // [name, prefix, lineComments (undefined => default), expectedPartial]
  ["ident then dot, nothing typed", "user.", undefined, ""],
  ["ident then dot, partial typed", "user.na", undefined, "na"],
  ["dot after a call", "get_user().", undefined, ""],
  ["dot after a subscript", "items[0].", undefined, ""],
  ["dot inside f-string interpolation hole", 'f"{user.', undefined, ""],
  ["dot+partial inside f-string hole", 'f"greeting {obj.attr', undefined, "attr"],
  [":: scope then dot-less member (partial)", "std::string", undefined, "string"],
  [":: scope, nothing typed", "std::", undefined, ""],
];

test("fimMemberSite: member sites return {partial}", (t) => {
  for (const [name, prefix, lineComments, expectedPartial] of MEMBER_SITE_CASES) {
    const got =
      lineComments === undefined
        ? fimMemberSite(prefix)
        : fimMemberSite(prefix, lineComments);
    assert.deepStrictEqual(
      got,
      { partial: expectedPartial },
      `[${name}] prefix=${JSON.stringify(prefix)} lineComments=${JSON.stringify(
        lineComments,
      )} -> expected {partial:${JSON.stringify(expectedPartial)}}, got ${JSON.stringify(
        got,
      )}`,
    );
  }
});

// Dark (undefined): fresh position / whitespace / literal with no trailing
// .member; numeric float; or current line starts with a lineComments token.
const DARK_CASES = [
  // [name, prefix, lineComments (undefined => default)]
  ["fresh empty position", "", undefined],
  ["pure whitespace", "   ", undefined],
  ["bare identifier, no trailing dot", "user", undefined],
  ["literal with no trailing .member", '"hello"', undefined],
  // numeric-float darkness: char before `.` is a digit
  ["numeric float: 1.", "1.", undefined],
  ["numeric float: 3.14 (char before . is a digit)", "3.14", undefined],
  ["numeric float: x = 42.", "x = 42.", undefined],
  // char before `.` is another `.` -> dark
  ["double dot", "user..", undefined],
];

test("fimMemberSite: dark positions return undefined", (t) => {
  for (const [name, prefix, lineComments] of DARK_CASES) {
    const got =
      lineComments === undefined
        ? fimMemberSite(prefix)
        : fimMemberSite(prefix, lineComments);
    assert.strictEqual(
      got,
      undefined,
      `[${name}] prefix=${JSON.stringify(prefix)} -> expected undefined, got ${JSON.stringify(
        got,
      )}`,
    );
  }
});

// (a) Python `#`-comment darkness fires ONLY when ["#"] is passed.
test("fimMemberSite: Python #-comment line is dark with ['#']", (t) => {
  const prefix = "    # see user.name";
  const got = fimMemberSite(prefix, ["#"]);
  assert.strictEqual(
    got,
    undefined,
    `Python comment line with lineComments=['#'] must be dark; got ${JSON.stringify(
      got,
    )}`,
  );
});

// The same `#` line WITHOUT ["#"] (default / ["//"]) is NOT a comment, so the
// trailing .name IS a member site. This asymmetry is the whole point.
test("fimMemberSite: #-line is a member site under DEFAULT lineComments", (t) => {
  const prefix = "    # see user.name";
  const got = fimMemberSite(prefix);
  assert.deepStrictEqual(
    got,
    { partial: "name" },
    `Under default lineComments the '#' line is not a comment; trailing .name must resolve. got ${JSON.stringify(
      got,
    )}`,
  );
});

test("fimMemberSite: #-line is a member site under explicit ['//']", (t) => {
  const prefix = "    # see user.name";
  const got = fimMemberSite(prefix, ["//"]);
  assert.deepStrictEqual(
    got,
    { partial: "name" },
    `With lineComments=['//'] the '#' line is not a comment; trailing .name must resolve. got ${JSON.stringify(
      got,
    )}`,
  );
});

// (b) DEFAULT behavior on `//` lines is unchanged: a `// foo.bar` line is dark.
test("fimMemberSite: '//' comment line is dark under DEFAULT lineComments", (t) => {
  const prefix = "    // see foo.bar";
  const got = fimMemberSite(prefix);
  assert.strictEqual(
    got,
    undefined,
    `Default lineComments=['//'] must treat the '//' line as dark; got ${JSON.stringify(
      got,
    )}`,
  );
});

// Multi-line prefix: only the CURRENT LINE (after last \n, leading ws trimmed)
// is inspected for the comment token.
test("fimMemberSite: only the current line's comment token darkens", (t) => {
  // Prior line is a Python comment, but the current line is live code.
  const live = "# a comment on the previous line\nuser.na";
  assert.deepStrictEqual(
    fimMemberSite(live, ["#"]),
    { partial: "na" },
    "comment token on a PRIOR line must not darken the current live line",
  );
  // Current line is the Python comment.
  const dark = "user = get()\n    # note obj.attr";
  assert.strictEqual(
    fimMemberSite(dark, ["#"]),
    undefined,
    "current line starting with '#' (after trim) must be dark with ['#']",
  );
});

// F2 RESOLVED (phase 3): a Python slice `::` (`arr[1::2]`, `arr[::2]`) is NOT a
// member site. Resolution is a NEW Python-specific detector `pyMemberSite`,
// dispatched via a total `memberSiteFor(languageId)` registry — NOT a change to
// the shared `fimMemberSite`, which deliberately keeps `::` firing because it
// is a real scope operator in Rust/C#. This test asserts the ACTUAL mechanism
// and keeps the contrast that proves the fix is Python-scoped.
test("memberSiteFor('python'): Python slices are dark, real members still light", (t) => {
  // Python slices -> dark.
  assert.strictEqual(
    memberSiteFor("python")("arr[1::"),
    undefined,
    `Python slice 'arr[1::2]' start must be dark under memberSiteFor('python'), got ${JSON.stringify(
      memberSiteFor("python")("arr[1::"),
    )}`,
  );
  assert.strictEqual(
    memberSiteFor("python")("arr[::"),
    undefined,
    `Python slice 'arr[::2]' start must be dark under memberSiteFor('python'), got ${JSON.stringify(
      memberSiteFor("python")("arr[::"),
    )}`,
  );
  // Real `.` member sites still light under the Python detector.
  assert.deepStrictEqual(
    memberSiteFor("python")("obj.attr"),
    { partial: "attr" },
    `real '.' member site 'obj.attr' must stay lit under memberSiteFor('python'), got ${JSON.stringify(
      memberSiteFor("python")("obj.attr"),
    )}`,
  );
});

// CONTRAST — the fix is Python-scoped, not a shared-helper change. The C-family
// `fimMemberSite` keeps firing on `::` (this is the whole reason F2 needed its
// own detector), and the Rust dispatch delegates byte-identically to it.
test("memberSiteFor: C-family keeps '::' firing; rust delegates to fimMemberSite", (t) => {
  assert.deepStrictEqual(
    fimMemberSite("arr[1::"),
    { partial: "" },
    `shared C-family fimMemberSite must still fire on '::', got ${JSON.stringify(
      fimMemberSite("arr[1::"),
    )}`,
  );
  assert.deepStrictEqual(
    memberSiteFor("rust")("arr[1::"),
    fimMemberSite("arr[1::"),
    `memberSiteFor('rust') must delegate byte-identically to fimMemberSite`,
  );
});

// ---------------------------------------------------------------------------
// CONTRACT 2 — declarationHeadLine(getLine, startLine, nameLine) -> number
// Walk DOWN from startLine past leading trivia (comments, attributes,
// decorators incl. multi-line) to the declaration's first line. Safety:
//   - returned head NEVER exceeds nameLine
//   - if the walk would stop on a closer line before nameLine, fall to nameLine
// Python: declarationHeadLine(getLine, firstDecoratorLine, defLine) === defLine.
// ---------------------------------------------------------------------------

// Build a getLine over a 0-based source-line array.
const linesOf = (arr) => (n) => arr[n];

const PY_CASES = [
  {
    name: "single simple decorator @staticmethod",
    lines: ["class C:", "    @staticmethod", "    def f(self): ..."],
    startLine: 1, // first decorator
    nameLine: 2, // def line
    expected: 2,
  },
  {
    name: "decorator with call args on one line",
    lines: ['@app.route("/x")', "def handler(): ..."],
    startLine: 0,
    nameLine: 1,
    expected: 1,
  },
  {
    name: "multi-line decorator (args span lines)",
    lines: [
      "@app.route(",
      '    "/users",',
      '    methods=["GET", "POST"],',
      ")",
      "def users(): ...",
    ],
    startLine: 0, // first decorator line
    nameLine: 4, // def line
    expected: 4,
  },
  {
    name: "stacked decorators @login_required then @cache",
    lines: ["@login_required", "@cache", "def view(): ..."],
    startLine: 0,
    nameLine: 2,
    expected: 2,
  },
  {
    name: "bare def, no decorator (startLine == nameLine)",
    lines: ["def bare(): ..."],
    startLine: 0,
    nameLine: 0,
    expected: 0,
  },
];

test("declarationHeadLine: Python decorated/bare shapes land on def", (t) => {
  for (const c of PY_CASES) {
    const getLine = linesOf(c.lines);
    const head = declarationHeadLine(getLine, c.startLine, c.nameLine);

    assert.strictEqual(
      head,
      c.expected,
      `[${c.name}] expected head=${c.expected} (the def line), got ${head}`,
    );
    // Safety property 1: head never exceeds nameLine.
    assert.ok(
      head <= c.nameLine,
      `[${c.name}] safety: head (${head}) must be <= nameLine (${c.nameLine})`,
    );
    // Safety property 2: head line must not start with a decorator '@'.
    assert.ok(
      !c.lines[head].trimStart().startsWith("@"),
      `[${c.name}] safety: head line ${head} (${JSON.stringify(
        c.lines[head],
      )}) must not start with '@'`,
    );
  }
});

// F1 RESOLVED (phase 4): a bare Python `#` line-comment sitting inside the
// decorator trivia. Resolution is language-scoped — declarationHeadLine gained a
// 4th param `lineComments?: readonly string[]` (default `[]`, byte-identical for
// Rust/TS/C#); the Python caller passes `["#"]`, teaching the trivia walk to
// skip a bare `#` comment between a decorator and the `def`.
test("declarationHeadLine: Python '#' comment in decorator trivia is walked with ['#']", (t) => {
  const single = ["@decorator", "# a comment", "def f(): ..."];
  const headSingle = declarationHeadLine(linesOf(single), 0, 2, ["#"]);
  assert.strictEqual(
    headSingle,
    2,
    `'#' comment between decorator and def must be walked with ['#']; expected head=2 (def), got ${headSingle}`,
  );

  const stacked = ["@a", "# note", "@b", "def f(): ..."];
  const headStacked = declarationHeadLine(linesOf(stacked), 0, 3, ["#"]);
  assert.strictEqual(
    headStacked,
    3,
    `'#' comment inside stacked decorators must be walked with ['#']; expected head=3 (def), got ${headStacked}`,
  );
});

// CONTRAST — the `#`-skip is OPT-IN, so C#/Rust/TS stay byte-identical. The SAME
// input under the DEFAULT (no 4th arg, and explicit []) stops on the legacy head
// (the `# comment` line), proving the walk only learns `#` when ['#'] is passed
// (protects C#'s `#region`/`#pragma` under the default).
test("declarationHeadLine: '#'-skip does NOT fire under the default lineComments", (t) => {
  const single = ["@decorator", "# a comment", "def f(): ..."];
  const headDefault = declarationHeadLine(linesOf(single), 0, 2);
  assert.strictEqual(
    headDefault,
    1,
    `under the default (no 4th arg) the '#' line is not comment-trivia; expected legacy head=1, got ${headDefault}`,
  );
  const headEmpty = declarationHeadLine(linesOf(single), 0, 2, []);
  assert.strictEqual(
    headEmpty,
    1,
    `with explicit [] the '#' line is not comment-trivia; expected legacy head=1, got ${headEmpty}`,
  );
});
