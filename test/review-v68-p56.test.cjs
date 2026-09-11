// ADVERSARIAL REVIEW of session-v68 phases 5 (the async rung) and 6 (the
// receiver rung). Every row here is EVIDENCE for a review finding: a red row is
// a defect claim with a runnable input, a green row is an attack that found
// nothing and is kept so the next session does not re-run it by hand.
//
// Governing rule under attack [P5-async.md]: "lifting a rung without the
// machinery just swaps an honest refusal for a red test."
//
// Run: SKIP_LIVE=1 node --test --test-reporter=tap test/review-v68-p56.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
({ mod, cleanup } = bundleCore(
  "review-v68-p56",
  `export { tddLangFor, testGenFieldsFor } from "../src/core/tddLang";\n` +
    `export { assembleTestGenPrompt } from "../src/core/prompt";\n` +
    `export { surfaceProducesType } from "../src/core/receiver";\n`
));
test.after(() => {
  cleanup();
  for (const leftover of [".review-v68-p56.entry.ts", ".review-v68-p56.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
});

const { tddLangFor, testGenFieldsFor, assembleTestGenPrompt, surfaceProducesType } = mod;

// --------------------------------------------------------------------------
// Rust: the Cargo.toml manifest reader
// --------------------------------------------------------------------------

const CRATE = "/tmp/crate/src/lib.rs";

/** deps that answer exactly one Cargo.toml, at the crate root. */
const manifestDeps = (toml) => ({
  fileExists: (p) => p === "/tmp/crate/Cargo.toml",
  readFile: (p) => (p === "/tmp/crate/Cargo.toml" ? toml : undefined),
  probe: () => undefined,
});

// The resolver takes the SIGNATURE as a 4th argument (added in response to F10:
// a resolver that costs a process spawn has to know whether the answer can be
// used), so every call here passes the signature it is about.
const rustCtx = (toml, sig) => tddLangFor("rust").testabilityContextFor(CRATE, {}, manifestDeps(toml), sig);
const rustVerdict = (sig, doc, toml) => tddLangFor("rust").classifyTestability(sig, doc, rustCtx(toml, sig));

const ASYNC_FN = "pub async fn bucket_of(key: &str, n: u32) -> u32";
const DOC = "Maps a key onto a bucket.";

test("F1 rust: `full` on ANY unrelated crate satisfies the tokio macros check", () => {
  // tokio is present WITHOUT `macros`; `full` belongs to syn, which is a
  // proc-macro dependency and has nothing to do with the async runtime.
  // `#[tokio::test]` does not exist in this crate.
  const toml = [
    "[dependencies]",
    'tokio = { version = "1", features = ["rt"] }',
    "",
    "[dev-dependencies]",
    'syn = { version = "2", features = ["full"] }',
  ].join("\n");
  const v = rustVerdict(ASYNC_FN, DOC, toml);
  assert.strictEqual(
    v.testable,
    false,
    "admitted an async fn and will emit `#[tokio::test]`, which this crate does not provide"
  );
});

test("F1b rust: `macros` on ANY unrelated crate satisfies the check", () => {
  const toml = [
    "[dependencies]",
    'tokio = { version = "1", features = ["rt", "sync"] }',
    'wasm-bindgen = { version = "0.2", features = ["macros"] }',
  ].join("\n");
  assert.strictEqual(rustVerdict(ASYNC_FN, DOC, toml).testable, false);
});

test("F1c rust: `full` inside a COMMENT satisfies the check", () => {
  const toml = [
    "[dependencies]",
    "# we deliberately avoid tokio's `full` feature: it pulls in the whole world",
    'tokio = { version = "1", features = ["rt"] }',
  ].join("\n");
  assert.strictEqual(rustVerdict(ASYNC_FN, DOC, toml).testable, false);
});

test("F2 rust: tokio under [build-dependencies] is not linked into tests", () => {
  // build-dependencies are for build.rs only. They are NOT available to a test
  // target, so `#[tokio::test]` still does not exist.
  const toml = ["[build-dependencies]", 'tokio = { version = "1", features = ["macros", "rt"] }'].join("\n");
  assert.strictEqual(rustVerdict(ASYNC_FN, DOC, toml).testable, false);
});

test("F3 rust: workspace-inherited tokio is misdiagnosed", () => {
  // The member crate inherits the feature list from the workspace root, where
  // `macros` really is enabled. Refusing is safe; the SENTENCE is false.
  const toml = ["[dependencies]", "tokio = { workspace = true }"].join("\n");
  const v = rustVerdict(ASYNC_FN, DOC, toml);
  assert.ok(
    !/declares tokio but not its `macros` feature/.test(v.detail ?? ""),
    `refusal asserts a fact it did not check: ${v.detail}`
  );
});

test("F3b rust: the walk stops at the member manifest and never sees the workspace root", () => {
  // A real workspace: the member declares nothing, the ROOT carries tokio.
  const deps = {
    fileExists: (p) => p === "/tmp/ws/member/Cargo.toml" || p === "/tmp/ws/Cargo.toml",
    readFile: (p) =>
      p === "/tmp/ws/member/Cargo.toml"
        ? '[package]\nname = "member"\n'
        : '[workspace.dependencies]\ntokio = { version = "1", features = ["macros", "rt"] }\n',
    probe: () => undefined,
  };
  const ctx = tddLangFor("rust").testabilityContextFor("/tmp/ws/member/src/lib.rs", {}, deps, ASYNC_FN);
  assert.ok(ctx.asyncTest !== undefined, "a runtime that IS there was missed (cheap direction, still a miss)");
});

test("CLEAN rust: `tokio-util` alone does not match the tokio check", () => {
  const toml = ["[dev-dependencies]", 'tokio-util = { version = "0.7", features = ["full"] }'].join("\n");
  assert.strictEqual(rustVerdict(ASYNC_FN, DOC, toml).testable, false);
  assert.ok(/looked for tokio/.test(rustVerdict(ASYNC_FN, DOC, toml).detail ?? ""));
});

test("CLEAN rust: a commented-out tokio line does not match", () => {
  const toml = ["[dev-dependencies]", '# tokio = { version = "1", features = ["macros"] }'].join("\n");
  assert.strictEqual(rustVerdict(ASYNC_FN, DOC, toml).testable, false);
});

test("CLEAN rust: tokio with macros IS admitted and the attribute is tokio's", () => {
  const toml = ["[dev-dependencies]", 'tokio = { version = "1", features = ["macros", "rt"] }'].join("\n");
  assert.strictEqual(rustVerdict(ASYNC_FN, DOC, toml).testable, true);
  assert.strictEqual(rustCtx(toml, ASYNC_FN).asyncTest.shape, "#[tokio::test]");
});

// --------------------------------------------------------------------------
// Rule 8: nothing changes for a NON-async target
// --------------------------------------------------------------------------

test("F4 rust: a fn that TAKES a future gets the async prompt clause", () => {
  // classifyTestability tests the RETURN type only, so this is testable and
  // synchronous. isAsyncSignature tests the WHOLE signature, so the prompt is
  // told to `.await` the call — which does not compile on a `-> u32`.
  const sig = "pub fn drive(f: BoxFuture<'static, u32>) -> u32";
  const lang = tddLangFor("rust");
  const toml = ["[dev-dependencies]", 'tokio = { version = "1", features = ["macros"] }'].join("\n");
  assert.strictEqual(lang.classifyTestability(sig, DOC, rustCtx(toml, sig)).testable, true, "precondition: testable");
  const fields = testGenFieldsFor(lang, lang.frameworks[0], { signature: sig, ctx: rustCtx(toml, sig) });
  assert.strictEqual(
    fields.asyncTestShape,
    undefined,
    "P5 rule 8: a non-async target must keep every prompt byte. This one is told to `.await` a u32"
  );
});

test("CLEAN prompt: a synchronous free function is byte-identical in all five languages", () => {
  for (const id of ["rust", "go", "typescript", "python", "csharp"]) {
    const lang = tddLangFor(id);
    const f = lang.frameworks[0];
    const before = assembleTestGenPrompt({ signature: "x", docComment: DOC, ...testGenFieldsFor(lang, f) });
    const after = assembleTestGenPrompt({
      signature: "x",
      docComment: DOC,
      ...testGenFieldsFor(lang, f, { signature: "fn plain(n: u32) -> u32" }),
    });
    assert.strictEqual(after, before, `${id}: sync free function prompt moved`);
  }
});

// --------------------------------------------------------------------------
// surfaceProducesType: a false positive admits a target whose test cannot compile
// --------------------------------------------------------------------------

test("F5 receiver: an INSTANCE method returning the type counts as a producer", () => {
  // You need a Widget to call it. Nothing in these surfaces constructs the
  // first one, and the target is admitted anyway. C# is the one leg that
  // escapes, and only because its branch cannot see a return type at all (F5b).
  const rows = [
    ["rust", "    pub fn with_size(&self, n: u32) -> Widget"],
    ["python", "    def with_size(self, n: int) -> Widget: ..."],
    ["typescript", "    withSize(n: number): Widget"],
    ["go", "func (w *Widget) WithSize(n int) *Widget"],
  ];
  const admitted = rows.filter(([id, line]) => surfaceProducesType(id, line, "Widget"));
  assert.deepStrictEqual(admitted, [], `admitted on an instance method: ${JSON.stringify(admitted)}`);
});

test("F5b receiver: C# cannot see a static factory, which its own comment claims it does", () => {
  // "a static factory returns the type" — the regex only ever matches the
  // CONSTRUCTOR name form, so every factory-only C# type refuses after paying
  // for the pre-fill.
  assert.strictEqual(surfaceProducesType("csharp", "    public static Widget Create(int n)", "Widget"), true);
});

test("F5c receiver: C# matches a `new Widget(` inside a doc comment", () => {
  assert.strictEqual(surfaceProducesType("csharp", "    /// <example>new Widget(1)</example>", "Widget"), false);
});

test("F6 receiver: C# admits a constructor a test cannot call", () => {
  assert.strictEqual(surfaceProducesType("csharp", "    private Widget(int n)", "Widget"), false, "private ctor");
  assert.strictEqual(surfaceProducesType("csharp", "    protected Widget(int n)", "Widget"), false, "abstract-base ctor");
});

test("F6b receiver: TypeScript admits a private constructor and a commented one", () => {
  assert.strictEqual(surfaceProducesType("typescript", "    private constructor(secret: string)", "Widget"), false);
  assert.strictEqual(surfaceProducesType("typescript", "    // do not call constructor() directly", "Widget"), false);
});

test("F6c receiver: Go admits a callback parameter that produces the type", () => {
  // Nothing here constructs a Widget; the caller must already have one.
  assert.strictEqual(surfaceProducesType("go", "func Register(make func() *Widget) Handler", "Widget"), false);
});

test("CLEAN receiver: a method that merely TAKES the type is not a producer", () => {
  assert.strictEqual(surfaceProducesType("csharp", "    public void Add(Widget w)", "Widget"), false);
  assert.strictEqual(surfaceProducesType("csharp", "    public int Score(Widget w)", "Widget"), false);
  assert.strictEqual(surfaceProducesType("go", "func Save(w *Widget) error", "Widget"), false);
  assert.strictEqual(surfaceProducesType("python", "    def add(self, w: Widget) -> None: ...", "Widget"), false);
});

test("CLEAN receiver: a longer name is not the type", () => {
  assert.strictEqual(surfaceProducesType("csharp", "    public WidgetBuilder Builder()", "Widget"), false);
  assert.strictEqual(surfaceProducesType("python", "    def make() -> WidgetList: ...", "Widget"), false);
  assert.strictEqual(surfaceProducesType("rust", "    pub fn new() -> WidgetSet", "Widget"), false);
});

test("CLEAN receiver: a real producer is found in every language", () => {
  assert.strictEqual(surfaceProducesType("rust", "    pub fn new(n: u32) -> Self", "Widget"), true);
  assert.strictEqual(surfaceProducesType("csharp", "    public Widget(int n)", "Widget"), true);
  assert.strictEqual(surfaceProducesType("typescript", "    constructor(n: number)", "Widget"), true);
  assert.strictEqual(surfaceProducesType("python", "    def __init__(self, n: int)", "Widget"), true);
  assert.strictEqual(surfaceProducesType("go", "func NewWidget(n int) *Widget", "Widget"), true);
});

test("F7 receiver: a generic receiver type can never match", () => {
  // typeName goes through `replace(/[^\w]/g,"")`, so `Widget<T>` becomes
  // `WidgetT` and no surface line can carry it. A whole class of Rust and C#
  // methods refuses with "nothing in `Widget<T>`'s surface produces one" after
  // paying for the pre-fill that answered nothing.
  assert.strictEqual(surfaceProducesType("rust", "    pub fn new() -> Widget<T>", "Widget<T>"), true);
});

// --------------------------------------------------------------------------
// Precedence: `receiverConstructible: true` must skip ONLY the fixture rung
// --------------------------------------------------------------------------

const MATRIX = {
  rust: {
    async: ["pub async fn tick(&self) -> u32", DOC],
    io: ["pub fn load(&self, f: File) -> u32", DOC],
    undocumented: ["pub fn area(&self) -> f64", undefined],
    unit: ["pub fn reset(&mut self)", DOC],
    good: ["pub fn area(&self) -> f64", DOC],
  },
  go: {
    io: ["func (w *Widget) Load(f *os.File) int", DOC],
    undocumented: ["func (w *Widget) Area() float64", undefined],
    unit: ["func (w *Widget) Reset()", DOC],
    good: ["func (w *Widget) Area() float64", DOC],
  },
  python: {
    async: ["async def tick(self, n: int) -> int", DOC],
    io: ["def load(self, p: Path) -> int", DOC],
    undocumented: ["def area(self) -> float", undefined],
    unit: ["def reset(self) -> None", DOC],
    good: ["def area(self) -> float", DOC],
  },
  csharp: {
    io: ["public int Load(Stream s)", DOC],
    undocumented: ["public double Area()", undefined],
    unit: ["public void Reset()", DOC],
    good: ["public double Area()", DOC],
  },
  typescript: {
    async: ["  async tick(n: number): Promise<number>", DOC],
    io: ["  load(p: fs.PathLike): number", DOC],
    undocumented: ["  area(): number", undefined],
    unit: ["  reset(): void", DOC],
    good: ["  area(): number", DOC],
  },
};

// The ctx the gate hands in, minus the receiver flag: async support present so
// the async rung is the ADMITTED one, matching what fnGen resolves.
const BASE_CTX = {
  rust: { asyncTest: { shape: "#[tokio::test]" } },
  go: {},
  python: { asyncTest: { shape: "@pytest.mark.asyncio" } },
  csharp: { asyncTest: { shape: "a `public async Task` test method" } },
  typescript: { asyncTest: { shape: "an `async` callback" } },
};

for (const [id, cases] of Object.entries(MATRIX)) {
  for (const [name, [sig, doc]] of Object.entries(cases)) {
    test(`F8 precedence ${id}/${name}: the flag must lift the fixture rung and nothing else`, () => {
      const lang = tddLangFor(id);
      const off = lang.classifyTestability(sig, doc, BASE_CTX[id]);
      const on = lang.classifyTestability(sig, doc, { ...BASE_CTX[id], receiverConstructible: true });
      if (off.reason === "needs-fixture") {
        assert.notStrictEqual(on.reason, "needs-fixture", `${id}/${name}: flag did not lift the fixture rung`);
        return;
      }
      assert.deepStrictEqual(
        { testable: on.testable, reason: on.reason, detail: on.detail },
        { testable: off.testable, reason: off.reason, detail: off.detail },
        `${id}/${name}: the flag moved a verdict that is not the fixture rung`
      );
    });
  }
}

test("F9 typescript: `receiverConstructible` alone must not lift `not-exported`", () => {
  // The surface resolving proves a producer exists. It says NOTHING about
  // whether the test file can import the class, and the generated test lives in
  // a separate module.
  const lang = tddLangFor("typescript");
  const sig = "  area(): number";
  const on = lang.classifyTestability(sig, DOC, { asyncTest: { shape: "x" }, receiverConstructible: true });
  assert.strictEqual(on.testable, false, "a class member was admitted with no proof its class is reachable");
  assert.strictEqual(on.reason, "not-exported");
});

test("F9b typescript: with the class proven exported, the member IS admitted", () => {
  const lang = tddLangFor("typescript");
  const on = lang.classifyTestability("  area(): number", DOC, {
    asyncTest: { shape: "x" },
    receiverConstructible: true,
    receiverExported: true,
  });
  assert.strictEqual(on.testable, true, `still refused: ${on.reason} ${on.detail}`);
});

test("CLEAN: absent flag is today's behaviour (the fixture rung still refuses everywhere)", () => {
  for (const [id, cases] of Object.entries(MATRIX)) {
    const lang = tddLangFor(id);
    const [sig, doc] = cases.good;
    const v = lang.classifyTestability(sig, doc, BASE_CTX[id]);
    assert.strictEqual(v.reason, "needs-fixture", `${id}: a documented value-returning method should still be needs-fixture`);
  }
});

// --------------------------------------------------------------------------
// Python: the probe runs on EVERY gesture, async or not
// --------------------------------------------------------------------------

// RE-CUT. The finding was real and is fixed, but this fixture called the
// resolver with NO signature, which is not how production calls it and is not
// what the fix turns on. An absent signature still answers, deliberately: a
// resolver that went quiet when a caller forgot the argument would disable the
// async leg invisibly, which is worse than a spawn. What production does is pass
// the signature, and a SYNCHRONOUS one now costs nothing.
test("F10 python: no interpreter is spawned for a synchronous target (production passes the signature)", () => {
  const spawns = [];
  const deps = {
    fileExists: () => true,
    readFile: () => undefined,
    probe: (cmd, args) => {
      spawns.push(args.join(" "));
      return { exitCode: 1 };
    },
  };
  tddLangFor("python").testabilityContextFor(
    "/tmp/proj/src/a.py",
    { runRoot: "/tmp/proj", frameworkId: "pytest" },
    deps,
    "def widen(n: int) -> int:",
  );
  assert.deepStrictEqual(spawns, [], `probe spawned for a synchronous target: ${JSON.stringify(spawns)}`);

  // And it DOES spawn for an async one, or the leg would be dead.
  tddLangFor("python").testabilityContextFor(
    "/tmp/proj/src/a.py",
    { runRoot: "/tmp/proj", frameworkId: "pytest" },
    deps,
    "async def widen(n: int) -> int:",
  );
  assert.ok(spawns.length > 0, "an async target must still reach the probe");
});

test("CLEAN python: unittest needs no probe at all", () => {
  const spawns = [];
  const deps = { fileExists: () => true, readFile: () => undefined, probe: (c, a) => (spawns.push(a.join(" ")), { exitCode: 1 }) };
  const ctx = tddLangFor("python").testabilityContextFor(
    "/tmp/proj/src/a.py",
    { runRoot: "/tmp/proj", frameworkId: "unittest" },
    deps,
    "async def tick(self, n: int) -> int"
  );
  assert.strictEqual(ctx.asyncTest.shape, "unittest.IsolatedAsyncioTestCase");
  assert.deepStrictEqual(spawns, []);
});

// --------------------------------------------------------------------------
// C#: async ValueTask and async void
// --------------------------------------------------------------------------

test("CLEAN csharp: async void refused BY NAME, async Task<T> admitted, bare Task underspecified", () => {
  const lang = tddLangFor("csharp");
  const ctx = { asyncTest: { shape: "a `public async Task` test method" } };
  const v = lang.classifyTestability("public static async void Fire(int n)", DOC, ctx);
  assert.strictEqual(v.reason, "async");
  assert.match(v.detail, /async void/);
  assert.strictEqual(lang.classifyTestability("public static async Task<int> Load(int n)", DOC, ctx).testable, true);
  assert.strictEqual(lang.classifyTestability("public static async ValueTask<int> Load(int n)", DOC, ctx).testable, true);
  assert.strictEqual(lang.classifyTestability("public static async Task Fire(int n)", DOC, ctx).reason, "underspecified");
});

// --------------------------------------------------------------------------
// The prompt when a target is BOTH async and a method
// --------------------------------------------------------------------------

test("CLEAN prompt: the async clause and the receiver clause coexist without contradiction", () => {
  const lang = tddLangFor("rust");
  const p = assembleTestGenPrompt({
    signature: "pub async fn area(&self) -> f64",
    docComment: DOC,
    ...testGenFieldsFor(lang, lang.frameworks[0], {
      signature: "pub async fn area(&self) -> f64",
      ctx: { asyncTest: { shape: "#[tokio::test]" } },
      receiverTypeName: "Widget",
    }),
  });
  assert.match(p, /#\[tokio::test\]/);
  assert.match(p, /METHOD on `Widget`/);
  assert.strictEqual((p.match(/one table of rows/g) ?? []).length, 1, "the table shape is restated twice");
});

// --------------------------------------------------------------------------
// F11: the producer that needs one already
// --------------------------------------------------------------------------

test("F11 receiver: a producer that CONSUMES the type is still read as a producer", () => {
  // The rewritten `producesLine` excludes instance methods, so `w.Clone()` no
  // longer counts. The free-function and static forms of the same chicken-and-egg
  // are still admitted in all five languages, and a test still has no first
  // Widget to start from.
  const rows = [
    ["go", "func Clone(w *Widget) *Widget"],
    ["python", "def merge(a: Widget, b: Widget) -> Widget: ..."],
    ["csharp", "    public static Widget Combine(Widget a, Widget b)"],
    ["rust", "    pub fn merge(a: Widget, b: Widget) -> Widget"],
    ["typescript", "    static combine(a: Widget, b: Widget): Widget"],
  ];
  const admitted = rows.filter(([id, line]) => surfaceProducesType(id, line, "Widget"));
  assert.deepStrictEqual(
    admitted.map(([id]) => id),
    [],
    "admitted: every one of these needs a `Widget` before it can make a `Widget`"
  );
});

test("CLEAN receiver: the rewrite excludes instance methods, private members and comments", () => {
  assert.strictEqual(surfaceProducesType("go", "func (w *Widget) WithSize(n int) *Widget", "Widget"), false);
  assert.strictEqual(surfaceProducesType("rust", "    pub fn with_size(&self, n: u32) -> Widget", "Widget"), false);
  assert.strictEqual(surfaceProducesType("python", "    def with_size(self, n: int) -> Widget: ...", "Widget"), false);
  assert.strictEqual(surfaceProducesType("typescript", "    withSize(n: number): Widget", "Widget"), false);
  assert.strictEqual(surfaceProducesType("typescript", "    private constructor(n: number)", "Widget"), false);
  assert.strictEqual(surfaceProducesType("csharp", "    private Widget(int n)", "Widget"), false);
  assert.strictEqual(surfaceProducesType("csharp", "    /// <example>new Widget(1)</example>", "Widget"), false);
});
