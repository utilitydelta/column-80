// White-box: the Criticize detector seam and the honesty block (session-v61
// phase 1). Written against the implementation, so it pins the internals a
// blind oracle cannot see: what masking does to a Rust lifetime, what carries
// across a line boundary, where the Python doc walk starts from, and the two
// refusal paths that exist to stop a silent zero.
//
// Run: node --test test/impl-v61-p1-honesty.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v61-p1-honesty",
  `export { maskLine, maskedBody, docLines, unitDefect } from "../src/core/criticizeTypes";
export { criticizeLangFor, RUST_CRITICIZE_LANG, TS_CRITICIZE_LANG, CS_CRITICIZE_LANG, PY_CRITICIZE_LANG, GO_CRITICIZE_LANG } from "../src/core/criticizeLang";
export { HONESTY_DETECTORS } from "../src/core/criticizeHonesty";\n`,
);
const {
  maskLine,
  maskedBody,
  docLines,
  unitDefect,
  criticizeLangFor,
  RUST_CRITICIZE_LANG,
  TS_CRITICIZE_LANG,
  CS_CRITICIZE_LANG,
  PY_CRITICIZE_LANG,
  GO_CRITICIZE_LANG,
  HONESTY_DETECTORS,
} = mod;
test.after(cleanup);

const detector = (dimension) => HONESTY_DETECTORS.find((d) => d.dimension === dimension);

/** A brace-language unit: doc lines, then the head, then the body. */
function braceUnit(languageId, doc, head, body, startLine = 1) {
  return {
    languageId,
    name: "sample",
    lines: [...doc, head, ...body],
    startLine,
    headIndex: doc.length,
    bodyIndex: doc.length + 1,
  };
}

// ---------------------------------------------------------------------------
// maskLine
// ---------------------------------------------------------------------------

test("maskLine blanks a line comment and keeps the width", () => {
  const line = "    let x = 1; // Instant::now()";
  const masked = maskLine(line, RUST_CRITICIZE_LANG);
  assert.strictEqual(masked.length, line.length);
  assert.strictEqual(masked.trimEnd(), "    let x = 1;");
});

test("maskLine blanks a string literal but leaves the call around it", () => {
  const masked = maskLine('    open("Instant::now()")', PY_CRITICIZE_LANG);
  assert.match(masked, /^\s+open\(\s+\)$/);
});

test("maskLine leaves a Rust lifetime alone when the tick never closes", () => {
  const line = "    let s: &'a str = name;";
  assert.strictEqual(maskLine(line, RUST_CRITICIZE_LANG), line);
});

test("maskLine blanks a char literal that does close", () => {
  const masked = maskLine("    if c == '/' { go(); }", RUST_CRITICIZE_LANG);
  assert.strictEqual(masked, "    if c ==     { go(); }");
});

test("maskLine blanks a same-line block comment", () => {
  const masked = maskLine("    let x = /* Date.now() */ 1;", TS_CRITICIZE_LANG);
  assert.strictEqual(masked.replace(/\s+/g, " "), " let x = 1;");
});

test("maskLine uses the profile's own line comment, so a hash is code in Rust", () => {
  const line = "    let v = vec![1]; # not a comment here";
  assert.strictEqual(maskLine(line, RUST_CRITICIZE_LANG), line);
  assert.match(maskLine("    x = 1  # time.time()", PY_CRITICIZE_LANG), /^\s+x = 1\s+$/);
});

// ---------------------------------------------------------------------------
// maskedBody
// ---------------------------------------------------------------------------

test("maskedBody carries a block comment across line boundaries", () => {
  const fn = braceUnit("typescript", [], "function f() {", [
    "  /* an example:",
    "     const t = Date.now();",
    "  */",
    "  return 1;",
    "}",
  ]);
  const body = maskedBody(fn, TS_CRITICIZE_LANG);
  assert.strictEqual(body.length, 5);
  assert.ok(!body.some((l) => l.includes("Date.now")), body.join("\n"));
  assert.match(body[3], /return 1;/);
});

test("maskedBody carries a template literal across line boundaries", () => {
  const fn = braceUnit("typescript", [], "function f() {", [
    "  const prompt = `read the clock with",
    "  Date.now() and stop`;",
    "  return prompt;",
    "}",
  ]);
  const body = maskedBody(fn, TS_CRITICIZE_LANG);
  assert.ok(!body.some((l) => l.includes("Date.now")), body.join("\n"));
});

test("maskedBody index i is lines[bodyIndex + i]", () => {
  const fn = braceUnit("rust", ["/// doc"], "fn f() {", ["    let a = 1;", "    let b = 2;", "}"]);
  const body = maskedBody(fn, RUST_CRITICIZE_LANG);
  assert.strictEqual(body.length, 3);
  assert.strictEqual(body[0], fn.lines[fn.bodyIndex]);
  assert.strictEqual(body[1], fn.lines[fn.bodyIndex + 1]);
});

test("maskedBody blanks a python triple-quoted block across lines", () => {
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f():", '    """Doc."""', "    note = '''", "    time.time()", "    '''", "    return note"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 2,
  };
  const body = maskedBody(fn, PY_CRITICIZE_LANG);
  assert.ok(!body.some((l) => l.includes("time.time")), body.join("\n"));
});

// ---------------------------------------------------------------------------
// docLines: four read upward, Python reads downward
// ---------------------------------------------------------------------------

test("docLines reads Rust /// upward", () => {
  const fn = braceUnit("rust", ["/// Adds one.", "/// Never panics."], "pub fn f(x: u8) -> u8 {", ["    x + 1", "}"]);
  assert.deepStrictEqual(docLines(fn, RUST_CRITICIZE_LANG), ["Adds one.", "Never panics."]);
});

test("docLines strips a TypeScript block doc down to its text", () => {
  const fn = braceUnit("typescript", ["/**", " * Adds one.", " */"], "export function f(x: number) {", ["  return x + 1;", "}"]);
  assert.deepStrictEqual(docLines(fn, TS_CRITICIZE_LANG), ["Adds one."]);
});

test("docLines handles a one-line block doc", () => {
  const fn = braceUnit("typescript", ["/** Adds one. */"], "function f(x) {", ["  return x + 1;", "}"]);
  assert.deepStrictEqual(docLines(fn, TS_CRITICIZE_LANG), ["Adds one."]);
});

test("docLines reads C# /// upward", () => {
  const fn = braceUnit("csharp", ["/// <summary>Adds one.</summary>"], "public int F(int x) {", ["    return x + 1;", "}"]);
  assert.deepStrictEqual(docLines(fn, CS_CRITICIZE_LANG), ["<summary>Adds one.</summary>"]);
});

test("docLines stops at a blank line, so an unrelated comment is not this doc", () => {
  const fn = {
    languageId: "go",
    name: "F",
    lines: ["// unrelated note", "", "// F adds one.", "func F(x int) int {", "\treturn x + 1", "}"],
    startLine: 10,
    headIndex: 3,
    bodyIndex: 4,
  };
  assert.deepStrictEqual(docLines(fn, GO_CRITICIZE_LANG), ["F adds one."]);
});

test("docLines reads a Python docstring DOWNWARD, not upward", () => {
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f(x):", '    """Adds one.', "", "    Never raises.", '    """', "    return x + 1"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 5,
  };
  assert.deepStrictEqual(docLines(fn, PY_CRITICIZE_LANG), ["Adds one.", "", "Never raises."]);
});

test("docLines reads a single-quoted Python docstring", () => {
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f(x):", '    "Adds one."', "    return x + 1"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 2,
  };
  assert.deepStrictEqual(docLines(fn, PY_CRITICIZE_LANG), ["Adds one."]);
});

test("docLines finds the Python docstring even when bodyIndex points AT it", () => {
  // A producer that pointed bodyIndex at the docstring rather than past it must
  // not turn a documented function into an undocumented one silently.
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f(x):", '    """Adds one."""', "    return x + 1"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 1,
  };
  assert.deepStrictEqual(docLines(fn, PY_CRITICIZE_LANG), ["Adds one."]);
});

test("docLines walks past a multi-line Python declaration head", () => {
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f(", "    x: int,", ") -> int:", '    """Adds one."""', "    return x + 1"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 4,
  };
  assert.deepStrictEqual(docLines(fn, PY_CRITICIZE_LANG), ["Adds one."]);
});

test("docLines is empty when a Python function has no docstring", () => {
  const fn = {
    languageId: "python",
    name: "f",
    lines: ["def f(x):", "    return x + 1"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 1,
  };
  assert.deepStrictEqual(docLines(fn, PY_CRITICIZE_LANG), []);
});

test("docLines is empty when a brace function has no doc", () => {
  const fn = braceUnit("rust", [], "fn f() {", ["    1", "}"]);
  assert.deepStrictEqual(docLines(fn, RUST_CRITICIZE_LANG), []);
});

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

test("criticizeLangFor registers five profiles and the TypeScript aliases", () => {
  assert.strictEqual(criticizeLangFor("rust").displayName, "Rust");
  assert.strictEqual(criticizeLangFor("csharp").displayName, "C#");
  assert.strictEqual(criticizeLangFor("python").displayName, "Python");
  assert.strictEqual(criticizeLangFor("go").displayName, "Go");
  for (const id of ["typescript", "javascript", "typescriptreact", "javascriptreact"]) {
    assert.strictEqual(criticizeLangFor(id).displayName, "TypeScript", id);
  }
});

test("criticizeLangFor returns undefined for an unregistered language", () => {
  assert.strictEqual(criticizeLangFor("ruby"), undefined);
  assert.strictEqual(criticizeLangFor(""), undefined);
});

test("every registered profile fills all four honesty tables and a log table", () => {
  for (const lang of [RUST_CRITICIZE_LANG, TS_CRITICIZE_LANG, CS_CRITICIZE_LANG, PY_CRITICIZE_LANG, GO_CRITICIZE_LANG]) {
    for (const dim of ["clock", "prng", "env", "world"]) {
      assert.ok(lang.honesty[dim].length > 0, `${lang.displayName} ${dim}`);
    }
    assert.ok(lang.logWrites.length > 0, lang.displayName);
    assert.ok(lang.lineComment.length > 0, lang.displayName);
  }
});

// ---------------------------------------------------------------------------
// The detector set itself
// ---------------------------------------------------------------------------

test("HONESTY_DETECTORS is the four dimensions, each with a curriculum line", () => {
  assert.deepStrictEqual(HONESTY_DETECTORS.map((d) => d.dimension), ["clock", "prng", "env", "world"]);
  for (const d of HONESTY_DETECTORS) {
    assert.ok(d.source.length > 0, d.dimension);
    assert.ok(["safer", "understandable", "both"].includes(d.axis), d.dimension);
  }
});

test("a detail line is lower case, one line, and names no fix", () => {
  const banned = /\b(should|must|consider|instead|pass|inject|extract|refactor|fix)\b/;
  for (const d of HONESTY_DETECTORS) {
    const fn = braceUnit("rust", [], "fn f() {", ["    let t = Instant::now();", "    let g = thread_rng();", "    let v = env::var(\"HOME\");", "    let s = fs::read_to_string(p);", "}"]);
    const out = d.run(fn, RUST_CRITICIZE_LANG);
    if (out.state !== "flagged") continue;
    for (const f of out.findings) {
      assert.strictEqual(f.detail, f.detail.toLowerCase(), f.detail);
      assert.ok(!f.detail.includes("\n"), f.detail);
      assert.ok(!banned.test(f.detail), f.detail);
    }
  }
});

// ---------------------------------------------------------------------------
// Dimension 1: the clock
// ---------------------------------------------------------------------------

const CLOCK_CASES = [
  [RUST_CRITICIZE_LANG, "rust", "fn f() {", "    let t = Instant::now();"],
  [RUST_CRITICIZE_LANG, "rust", "fn f() {", "    let t = SystemTime::now();"],
  [TS_CRITICIZE_LANG, "typescript", "function f() {", "  const t = Date.now();"],
  [TS_CRITICIZE_LANG, "typescript", "function f() {", "  const t = new Date();"],
  [CS_CRITICIZE_LANG, "csharp", "public void F() {", "    var t = DateTime.UtcNow;"],
  [CS_CRITICIZE_LANG, "csharp", "public void F() {", "    var t = DateTime.Now;"],
  [GO_CRITICIZE_LANG, "go", "func F() {", "\tt := time.Now()"],
  [PY_CRITICIZE_LANG, "python", "def f():", "    t = time.time()"],
  [PY_CRITICIZE_LANG, "python", "def f():", "    t = datetime.now()"],
];

for (const [lang, id, head, line] of CLOCK_CASES) {
  test(`clock fires on ${line.trim()} in ${lang.displayName}`, () => {
    const fn = braceUnit(id, [], head, [line, "}"]);
    const out = detector("clock").run(fn, lang);
    assert.strictEqual(out.state, "flagged");
    assert.strictEqual(out.findings.length, 1);
    assert.strictEqual(out.findings[0].evidence, line.trim());
    assert.strictEqual(out.findings[0].dimension, "clock");
  });
}

test("clock does NOT fire on a spelling inside a comment, a string, or a doc", () => {
  const fn = braceUnit(
    "rust",
    ["/// Unlike Instant::now(), this takes the time as an argument."],
    "pub fn f(t: Instant) -> Instant {",
    [
      "    // Instant::now() would be dishonest here.",
      '    let note = "SystemTime::now()";',
      "    t",
      "}",
    ],
  );
  assert.deepStrictEqual(detector("clock").run(fn, RUST_CRITICIZE_LANG), { state: "clean" });
});

test("clock reports a DOCUMENT line, not an index into the slice", () => {
  const fn = braceUnit("rust", ["/// Doc."], "fn f() {", ["    let t = Instant::now();", "}"], 200);
  const out = detector("clock").run(fn, RUST_CRITICIZE_LANG);
  // lines[0] is document line 200, so the body's first line is 202.
  assert.strictEqual(out.findings[0].line, 202);
});

test("clock findings are ascending and one per line", () => {
  const fn = braceUnit("typescript", [], "function f() {", [
    "  const a = Date.now();",
    "  const b = 1;",
    "  const c = Date.now() - Date.now();",
    "}",
  ]);
  const out = detector("clock").run(fn, TS_CRITICIZE_LANG);
  assert.strictEqual(out.findings.length, 2);
  assert.deepStrictEqual(out.findings.map((f) => f.line), [2, 4]);
});

// ---------------------------------------------------------------------------
// Dimension 2: the PRNG
// ---------------------------------------------------------------------------

test("prng fires per language", () => {
  const cases = [
    [RUST_CRITICIZE_LANG, "rust", "fn f() {", "    let mut r = thread_rng();"],
    [TS_CRITICIZE_LANG, "typescript", "function f() {", "  const r = Math.random();"],
    [CS_CRITICIZE_LANG, "csharp", "public void F() {", "    var r = new Random();"],
    [GO_CRITICIZE_LANG, "go", "func F() {", "\tr := rand.Int()"],
    [PY_CRITICIZE_LANG, "python", "def f():", "    r = random.randint(1, 5)"],
  ];
  for (const [lang, id, head, line] of cases) {
    const fn = braceUnit(id, [], head, [line, "}"]);
    const out = detector("prng").run(fn, lang);
    assert.strictEqual(out.state, "flagged", `${lang.displayName}: ${line}`);
  }
});

test("prng does NOT fire on a variable named random_thing", () => {
  const fn = braceUnit("python", [], "def f():", ["    random_thing = 4", "    return random_thing"]);
  assert.deepStrictEqual(detector("prng").run(fn, PY_CRITICIZE_LANG), { state: "clean" });
});

// ---------------------------------------------------------------------------
// Dimension 3: the environment
// ---------------------------------------------------------------------------

test("env fires per language", () => {
  const cases = [
    [RUST_CRITICIZE_LANG, "rust", "fn f() {", '    let h = env::var("HOME");'],
    [TS_CRITICIZE_LANG, "typescript", "function f() {", "  const h = process.env.HOME;"],
    [CS_CRITICIZE_LANG, "csharp", "public void F() {", '    var h = Environment.GetEnvironmentVariable("HOME");'],
    [GO_CRITICIZE_LANG, "go", "func F() {", '\th := os.Getenv("HOME")'],
    [PY_CRITICIZE_LANG, "python", "def f():", '    h = os.environ["HOME"]'],
  ];
  for (const [lang, id, head, line] of cases) {
    const fn = braceUnit(id, [], head, [line, "}"]);
    assert.strictEqual(detector("env").run(fn, lang).state, "flagged", `${lang.displayName}: ${line}`);
  }
});

// ---------------------------------------------------------------------------
// Dimension 4: the world, and the log-write rule that is load-bearing
// ---------------------------------------------------------------------------

test("world fires on a file open or read per language", () => {
  const cases = [
    [RUST_CRITICIZE_LANG, "rust", "fn f() {", "    let s = fs::read_to_string(p)?;"],
    [RUST_CRITICIZE_LANG, "rust", "fn f() {", "    let h = File::open(p)?;"],
    [TS_CRITICIZE_LANG, "typescript", "function f() {", "  const s = fs.readFileSync(p);"],
    [CS_CRITICIZE_LANG, "csharp", "public void F() {", "    var s = File.ReadAllText(p);"],
    [GO_CRITICIZE_LANG, "go", "func F() {", "\tb, err := os.ReadFile(p)"],
    [PY_CRITICIZE_LANG, "python", "def f():", "    h = open(p)"],
    [PY_CRITICIZE_LANG, "python", "def f():", "    s = Path(p).read_text()"],
  ];
  for (const [lang, id, head, line] of cases) {
    const fn = braceUnit(id, [], head, [line, "}"]);
    assert.strictEqual(detector("world").run(fn, lang).state, "flagged", `${lang.displayName}: ${line}`);
  }
});

test("world is CLEAN on a log write in all five languages", () => {
  // Measured and load-bearing: 16.1% of Python functions write a log, and
  // printing does not make a result unreproducible.
  const cases = [
    [RUST_CRITICIZE_LANG, "rust", "fn f() {", '    println!("done {}", n);'],
    [RUST_CRITICIZE_LANG, "rust", "fn f() {", '    tracing::info!("done");'],
    [TS_CRITICIZE_LANG, "typescript", "function f() {", '  console.log("done");'],
    [TS_CRITICIZE_LANG, "typescript", "function f() {", '  logger.warn("done");'],
    [CS_CRITICIZE_LANG, "csharp", "public void F() {", '    Console.WriteLine("done");'],
    [CS_CRITICIZE_LANG, "csharp", "public void F() {", '    _logger.LogInformation("done");'],
    [GO_CRITICIZE_LANG, "go", "func F() {", '\tfmt.Println("done")'],
    [GO_CRITICIZE_LANG, "go", "func F() {", '\tlog.Printf("done %d", n)'],
    [PY_CRITICIZE_LANG, "python", "def f():", '    print("done")'],
    [PY_CRITICIZE_LANG, "python", "def f():", '    logger.info("done")'],
  ];
  for (const [lang, id, head, line] of cases) {
    const fn = braceUnit(id, [], head, [line, "}"]);
    assert.deepStrictEqual(detector("world").run(fn, lang), { state: "clean" }, `${lang.displayName}: ${line}`);
  }
});

test("world still fires on a read nested inside a log call's arguments", () => {
  const fn = braceUnit("python", [], "def f(p):", ["    print(open(p).read())", "    return 1"]);
  assert.strictEqual(detector("world").run(fn, PY_CRITICIZE_LANG).state, "flagged");
});

test("world is suppressed when a log spelling COVERS the world spelling", () => {
  // The structural half of the guard. Today's five tables have no such overlap,
  // so it is exercised here with a profile that does: without the containment
  // check this fires, and dimension 4 starts reporting log writes.
  const overlapping = {
    ...PY_CRITICIZE_LANG,
    honesty: { ...PY_CRITICIZE_LANG.honesty, world: [/\bread_text\s*\(/] },
    logWrites: [/\blog\.read_text\s*\(/],
  };
  const logging = braceUnit("python", [], "def f(p):", ["    log.read_text(p)", "    return 1"]);
  assert.deepStrictEqual(detector("world").run(logging, overlapping), { state: "clean" });
  const reading = braceUnit("python", [], "def f(p):", ["    p.read_text()", "    return 1"]);
  assert.strictEqual(detector("world").run(reading, overlapping).state, "flagged");
});

// ---------------------------------------------------------------------------
// The two refusal paths. Both exist so a zero cannot be a fact about the rig.
// ---------------------------------------------------------------------------

test("an empty name table is BLIND, not clean, and the reason names the language", () => {
  const blindLang = { ...GO_CRITICIZE_LANG, honesty: { ...GO_CRITICIZE_LANG.honesty, prng: [] } };
  const fn = braceUnit("go", [], "func F() {", ["\tr := rand.Int()", "}"]);
  const out = detector("prng").run(fn, blindLang);
  assert.strictEqual(out.state, "blind");
  assert.ok(out.reason.includes("Go"), out.reason);
  assert.ok(out.reason.length > 20, out.reason);
});

test("a malformed slice is BLIND, not clean", () => {
  const past = {
    languageId: "rust",
    name: "f",
    lines: ["fn f() {", "    let t = Instant::now();", "}"],
    startLine: 1,
    headIndex: 0,
    bodyIndex: 9,
  };
  const out = detector("clock").run(past, RUST_CRITICIZE_LANG);
  assert.strictEqual(out.state, "blind");
  assert.ok(out.reason.includes("bodyIndex"), out.reason);

  for (const bad of [
    { headIndex: 2, bodyIndex: 1 },
    { headIndex: -1, bodyIndex: 1 },
    { startLine: 0 },
    { lines: [] },
  ]) {
    const fn = { ...past, bodyIndex: 1, ...bad };
    assert.strictEqual(detector("clock").run(fn, RUST_CRITICIZE_LANG).state, "blind", JSON.stringify(bad));
    assert.ok(unitDefect(fn) !== undefined, JSON.stringify(bad));
  }
});

test("unitDefect passes a well-formed slice", () => {
  const fn = braceUnit("rust", ["/// Doc."], "fn f() {", ["    1", "}"]);
  assert.strictEqual(unitDefect(fn), undefined);
});

test("an empty body is clean rather than blind: nothing to read is not nothing to say", () => {
  const fn = { languageId: "rust", name: "f", lines: ["/// Doc.", "fn f() {}"], startLine: 1, headIndex: 1, bodyIndex: 2 };
  assert.deepStrictEqual(detector("clock").run(fn, RUST_CRITICIZE_LANG), { state: "clean" });
});
