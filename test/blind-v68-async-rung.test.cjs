// Blind oracle for session-v68 phase 5: the ASYNC RUNG, five languages
// [session-v68/contracts/P5-async.md]. Written from the contract alone,
// WITHOUT READING src/** — not one file, not one grep. A file that agreed with
// the implementation would be worthless, so every assertion here is derived
// from P5's numbered rules 1..9 and properties 10..15 and from nothing else.
//
// What is oracled, all through the public seam:
//   tddLangFor, frameworkFor, testGenFieldsFor   ../src/core/tddLang
//   assembleTestGenPrompt                        ../src/core/prompt
//   lang.classifyTestability(signature, docComment, ctx)
//   lang.testabilityContextFor(...)              — the project-fact resolver
//
// THE CTX IS NEVER INSPECTED. P5 rule 9 says the classifier is pure over an
// injected ctx and that the manifest read and the probe are
// `testabilityContextFor`'s job. Its exact FIELDS are the implementation's
// choice, so this file never names one: it calls `testabilityContextFor` with
// fake deps and hands whatever comes back straight to `classifyTestability`,
// then asserts on the VERDICT (`testable`, `reason`, `detail`) only. The call
// SHAPE of `testabilityContextFor` is also unknown here, so `resolveCtx` below
// tries the plausible argument orders and keeps the richest answer, reporting
// everything it tried when a row goes red. A red that names only a call shape
// is a seam finding, not a classifier finding. The winning order was found by
// CALLING, not by reading: no assertion in this file depends on it.
//
// EXPECTED RED. Phase 5 is the build; the rows for rules 1..7 and 10..15 fail
// until it lands. The rule 8 rows ("nothing changes for a non-async target")
// are the exception: they pin behaviour that is GREEN TODAY and must stay
// green, which is the only way a blind file can express "unchanged".
//
// Run: SKIP_LIVE=1 node --test test/blind-v68-async-rung.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v68-async-rung",
    `export { tddLangFor, frameworkFor, testGenFieldsFor } from "../src/core/tddLang";\n` +
      `export { assembleTestGenPrompt } from "../src/core/prompt";\n`
  ));
} catch (e) {
  bundleError = e;
}
// A failed bundle never returns a cleanup and still wrote the entry file.
test.after(() => {
  cleanup();
  for (const leftover of [".blind-v68-async-rung.entry.ts", ".blind-v68-async-rung.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
});

const { tddLangFor, frameworkFor, testGenFieldsFor, assembleTestGenPrompt } = mod;

test("bundle: the P5 surface builds and exports the seam plus the prompt [P5 'Surface under contract']", () => {
  assert.strictEqual(
    bundleError,
    undefined,
    `the bundle failed, so every row below is a harness error rather than a contract finding: ${bundleError && bundleError.message}`
  );
  assert.strictEqual(typeof tddLangFor, "function", "tddLangFor(languageId) => TddLang | undefined");
  assert.strictEqual(typeof testGenFieldsFor, "function", "testGenFieldsFor(lang, framework) => prompt fields");
  assert.strictEqual(typeof assembleTestGenPrompt, "function", "assembleTestGenPrompt(input) => string");
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ===========================================================================
// Fixtures: a virtual filesystem and an injected probe. Nothing on disk, and
// no real cargo, python or dotnet is ever spawned.
// ===========================================================================

const vdeps = ({ files = [], texts = {}, probe } = {}) => {
  const all = files.concat(Object.keys(texts));
  return {
    fileExists: (p) => all.includes(p),
    readFile: (p) => texts[p],
    readDir: (d) => {
      const kids = new Set();
      for (const p of all) {
        if (p.startsWith(d + path.sep)) kids.add(p.slice(d.length + 1).split(path.sep)[0]);
      }
      return kids.size ? [...kids] : undefined;
    },
    log: () => {},
    probe: probe || (() => ({ exitCode: 1 })),
  };
};

// A probe answering exit 0 exactly when the joined arguments match `yes`.
const probeFor = (yes) => (command, args) => ({ exitCode: yes((args || []).join(" ")) ? 0 : 1 });

// --- Rust -----------------------------------------------------------------
const RUST_ROOT = "/w/crate";
const RUST_SRC = path.join(RUST_ROOT, "src", "lib.rs");
const CARGO = path.join(RUST_ROOT, "Cargo.toml");
const manifest = (devDeps) =>
  '[package]\nname = "widgets"\nversion = "0.1.0"\nedition = "2021"\n\n' +
  '[dependencies]\nserde = "1"\n\n[dev-dependencies]\n' +
  devDeps;
const RUST_MANIFESTS = {
  tokioMacros: manifest('tokio = { version = "1", features = ["macros", "rt"] }\n'),
  tokioNoMacros: manifest('tokio = { version = "1", features = ["rt", "net"] }\n'),
  asyncStd: manifest('async-std = { version = "1", features = ["attributes"] }\n'),
  smol: manifest('smol = "2"\nsmol-potat = "1"\n'),
  none: manifest('serde_json = "1"\n'),
};
const rustDeps = (which) => vdeps({ files: [RUST_SRC], texts: { [CARGO]: RUST_MANIFESTS[which] } });

// --- Python ---------------------------------------------------------------
const PY_ROOT = "/w/proj";
const PY_SRC = path.join(PY_ROOT, "pkg", "mod.py");
const PY_FILES = [
  path.join(PY_ROOT, "pyproject.toml"),
  path.join(PY_ROOT, ".venv", "bin", "python"),
  path.join(PY_ROOT, "pkg", "__init__.py"),
  PY_SRC,
];
const PY_TEXTS = { [path.join(PY_ROOT, "pyproject.toml")]: '[project]\nname = "proj"\nversion = "0.0.1"\n' };
const pyDeps = (probe) => vdeps({ files: PY_FILES, texts: PY_TEXTS, probe });
// pytest imports, and so does pytest-asyncio.
const PY_PYTEST_ASYNCIO = pyDeps(probeFor((s) => /pytest/.test(s)));
// pytest imports; neither pytest-asyncio nor anyio does.
const PY_PYTEST_BARE = pyDeps(probeFor((s) => /pytest/.test(s) && !/asyncio|anyio/.test(s)));
// pytest imports, pytest-asyncio does not, anyio does — the contract's fallback.
const PY_PYTEST_ANYIO = pyDeps(probeFor((s) => (/pytest/.test(s) && !/asyncio/.test(s)) || /anyio/.test(s)));
// Nothing imports, so pytest cannot detect and the stdlib runner is what is left.
const PY_UNITTEST = pyDeps(probeFor(() => false));

// --- Go, TypeScript, C#: signature-only or nothing to detect ---------------
const GO_ROOT = "/w/mod";
const GO_SRC = path.join(GO_ROOT, "pkg", "foo.go");
const GO_DEPS = vdeps({ files: [path.join(GO_ROOT, "go.mod"), GO_SRC] });

const TS_ROOT = "/w/app";
const TS_SRC = path.join(TS_ROOT, "src", "shard.ts");
const TS_DEPS = vdeps({
  files: [TS_SRC],
  texts: { [path.join(TS_ROOT, "package.json")]: '{"name":"app","devDependencies":{"vitest":"1"}}' },
});

const CS_ROOT = "/w/sln";
const CS_SRC = path.join(CS_ROOT, "Lib", "Shard.cs");
const CS_DEPS = vdeps({ files: [CS_SRC, path.join(CS_ROOT, "Lib", "Lib.csproj")] });

// --- Doc comments, one per language, in that language's own spelling -------
const DOC = {
  rust: "/// Widens n and returns the widened value.",
  go: "// Widen returns n widened.",
  typescript: "/** Returns twice the given count of shards. */",
  python: "Return the widened value of n.",
  csharp: "/// <summary>Widens n.</summary>",
};

// ===========================================================================
// The ctx bridge. P5 rule 9 puts project facts in `testabilityContextFor`; its
// argument order is not in the contract, so try the plausible shapes and keep
// the richest result. Never inspect a field of what comes back.
// ===========================================================================

const CTX_SHAPES = [
  ["(sourcePath, placement, deps)", (a) => [a.sourcePath, a.placement, a.deps]],
  ["(sourcePath, projectRoot, deps)", (a) => [a.sourcePath, a.projectRoot, a.deps]],
  ["(projectRoot, deps)", (a) => [a.projectRoot, a.deps]],
  ["(sourcePath, deps)", (a) => [a.sourcePath, a.deps]],
  ["(projectRoot, deps, sourcePath)", (a) => [a.projectRoot, a.deps, a.sourcePath]],
  ["(deps, projectRoot)", (a) => [a.deps, a.projectRoot]],
  [
    "(one options object)",
    (a) => [
      {
        sourcePath: a.sourcePath,
        filePath: a.sourcePath,
        projectRoot: a.projectRoot,
        root: a.projectRoot,
        placement: a.placement,
        deps: a.deps,
      },
    ],
  ],
];

const isRich = (o) => o && typeof o === "object" && Object.values(o).some((v) => v !== undefined);

// A TestPlacement-shaped literal, with the framework resolved through the
// PUBLIC seam (`frameworkFor`) rather than assumed: the pytest/unittest split
// is a project fact and this is the seam that decides it.
function placementLike(lang, a) {
  let frameworkId;
  try {
    const r = frameworkFor(lang, a.projectRoot, a.deps);
    if (r && r.ok) frameworkId = r.framework.id;
  } catch (e) {
    frameworkId = undefined;
  }
  return {
    targetPath: a.sourcePath,
    exists: false,
    mode: "same-file",
    runRoot: a.projectRoot,
    packageArg: undefined,
    importLine: undefined,
    frameworkId,
  };
}

function resolveCtx(lang, args) {
  if (typeof lang.testabilityContextFor !== "function") {
    return { ctx: undefined, shape: "testabilityContextFor is absent for this language", tried: [] };
  }
  const a = { ...args, placement: args.placement || placementLike(lang, args) };
  const tried = [];
  let fallback;
  for (const [label, build] of CTX_SHAPES) {
    let out;
    let err;
    try {
      out = lang.testabilityContextFor(...build(a));
    } catch (e) {
      err = e && e.message;
    }
    tried.push(`${label} -> ${err ? "threw " + err : JSON.stringify(out)}`);
    if (isRich(out)) return { ctx: out, shape: label, tried };
    if (!fallback && out && typeof out === "object") fallback = { ctx: out, shape: label, tried };
  }
  return fallback || { ctx: undefined, shape: "no shape produced a ctx object", tried };
}

const why = (label, v, extra) =>
  `${label}: ${extra}\n---- VERDICT ----\n${JSON.stringify(v)}\n---- END ----`;

const whyCtx = (label, v, c, extra) =>
  `${label}: ${extra}\n---- VERDICT ----\n${JSON.stringify(v)}\n---- testabilityContextFor SHAPE ----\n${c.shape}\n${c.tried.join("\n")}\n---- END ----`;

// The verdict shape. Shipped rows read `reason === undefined` for a pass, and
// the P5 brief names a `testable` field, so a pass must satisfy both readings.
function assertTestable(label, v, c) {
  assert.ok(v && typeof v === "object", `${label}: classifyTestability returned ${JSON.stringify(v)}`);
  assert.strictEqual(v.reason, undefined, whyCtx(label, v, c || { shape: "n/a", tried: [] }, "refused, and P5 says this target is testable"));
  assert.notStrictEqual(v.testable, false, whyCtx(label, v, c || { shape: "n/a", tried: [] }, "testable:false on a target P5 admits"));
}

function assertRefused(label, v) {
  assert.ok(v && typeof v === "object", `${label}: classifyTestability returned ${JSON.stringify(v)}`);
  assert.ok(
    v.reason !== undefined || v.testable === false,
    why(label, v, "P5 refuses this target, and the verdict admits it")
  );
}

// P5 rule 15 / property 15: the blanket sentence is retired for every refusal
// this phase touches.
const BLANKET = /a blind unit test cannot drive it/i;

function assertNames(label, v, needles) {
  assertRefused(label, v);
  assert.strictEqual(typeof v.detail, "string", why(label, v, "the refusal carries no detail string at all"));
  assert.ok(v.detail.length > 0, why(label, v, "the refusal detail is empty"));
  for (const n of needles) {
    assert.ok(
      new RegExp(n, "i").test(v.detail),
      why(label, v, `P5 rule 15 wants the detail to NAME what is missing: nothing matched /${n}/i`)
    );
  }
  assert.ok(
    !BLANKET.test(v.detail),
    why(label, v, "P5 rule 15: the old blanket sentence 'a blind unit test cannot drive it' is exactly what this phase retires")
  );
}

const LANG = (id) => {
  const l = tddLangFor(id);
  assert.ok(l, `tddLangFor(${JSON.stringify(id)}) must resolve; the seam registers all five legs`);
  return l;
};

// ===========================================================================
// 1. Rule 1 + property 10 + property 13's unittest half: the three languages
//    with nothing to detect.
// ===========================================================================

gtest("[P5 §1 + §10] C# admits async unconditionally: `async Task<int>` with a doc comment and a value return is TESTABLE", () => {
  const cs = LANG("csharp");
  const c = resolveCtx(cs, { sourcePath: CS_SRC, projectRoot: CS_ROOT, deps: CS_DEPS });
  for (const sig of [
    "public static async Task<int> WidenAsync(int n)",
    "public static async ValueTask<int> WidenAsync(int n)",
    "public static Task<int> WidenAsync(int n)",
  ]) {
    assertTestable(`csharp ${sig}`, cs.classifyTestability(sig, DOC.csharp, c.ctx), c);
  }
});

gtest("[P5 §1] C# admits async with NO ctx at all - rule 1 says there is nothing to detect, so the verdict cannot depend on a resolved project fact", () => {
  const cs = LANG("csharp");
  const sig = "public static async Task<int> WidenAsync(int n)";
  for (const ctx of [undefined, {}]) {
    assertTestable(`csharp ctx=${JSON.stringify(ctx)}`, cs.classifyTestability(sig, DOC.csharp, ctx));
  }
});

gtest("[P5 §1 + §11] TypeScript admits async unconditionally: `async function f(): Promise<number>` is TESTABLE", () => {
  const ts = LANG("typescript");
  const c = resolveCtx(ts, { sourcePath: TS_SRC, projectRoot: TS_ROOT, deps: TS_DEPS });
  for (const sig of [
    "export async function widen(n: number): Promise<number> {",
    "export function widen(n: number): Promise<number> {",
  ]) {
    assertTestable(`ts ${sig}`, ts.classifyTestability(sig, DOC.typescript, c.ctx), c);
  }
});

gtest("[P5 §1 + §13] Python under unittest admits async EITHER WAY - the stdlib IsolatedAsyncioTestCase needs no plugin, so a probe that says no to everything still admits", () => {
  const py = LANG("python");
  const sig = "async def widen(n: int) -> int:";
  const c = resolveCtx(py, { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_UNITTEST });
  assertTestable("python/unittest async def", py.classifyTestability(sig, DOC.python, c.ctx), c);
});

// ===========================================================================
// 2. Rule 2 + property 10's second half: `async void` stays refused BY NAME.
// ===========================================================================

gtest("[P5 §2 + §10 + §15] C# `async void` STAYS REFUSED and the detail says `async void` - it cannot be awaited, so a test that calls it observes nothing", () => {
  const cs = LANG("csharp");
  const c = resolveCtx(cs, { sourcePath: CS_SRC, projectRoot: CS_ROOT, deps: CS_DEPS });
  const v = cs.classifyTestability("public static async void FireAndForget(int n)", DOC.csharp, c.ctx);
  assertNames("csharp async void", v, ["async void"]);
});

gtest("[P5 §2] the C# `async void` refusal is about the SHAPE, not the doc comment - it stays refused with a doc comment present, which is what makes the detail the actionable part", () => {
  const cs = LANG("csharp");
  const v = cs.classifyTestability("public static async void FireAndForget(int n)", DOC.csharp, undefined);
  assertRefused("csharp async void, no ctx", v);
  assert.ok(!BLANKET.test(String(v.detail || "")), why("csharp async void", v, "the blanket sentence is retired"));
});

// ===========================================================================
// 3. Rule 3 + property 12: Go splits the rung on the SIGNATURE alone.
// ===========================================================================

gtest("[P5 §3 + §12] Go: a `context.Context` parameter NO LONGER REFUSES - context.Background() satisfies it, so a blind test can drive the call", () => {
  const go = LANG("go");
  const c = resolveCtx(go, { sourcePath: GO_SRC, projectRoot: GO_ROOT, deps: GO_DEPS });
  for (const sig of [
    "func Widen(ctx context.Context, n int) int",
    "func Widen(ctx context.Context, n int) (int, error)",
  ]) {
    assertTestable(`go ${sig}`, go.classifyTestability(sig, DOC.go, c.ctx), c);
  }
});

gtest("[P5 §3 + §12 + §15] Go: a `chan` in the signature STILL REFUSES, and the detail NAMES THE CHANNEL rather than saying 'async'", () => {
  const go = LANG("go");
  const c = resolveCtx(go, { sourcePath: GO_SRC, projectRoot: GO_ROOT, deps: GO_DEPS });
  for (const sig of ["func Drain(c chan int) int", "func Drain(c <-chan int) int", "func Fanout(n int) chan int"]) {
    assertNames(`go ${sig}`, go.classifyTestability(sig, DOC.go, c.ctx), ["chan"]);
  }
});

gtest("[P5 §3 + §12] Go: a signature carrying BOTH a context and a channel refuses - the channel decides, and one satisfiable parameter does not buy the other", () => {
  const go = LANG("go");
  const c = resolveCtx(go, { sourcePath: GO_SRC, projectRoot: GO_ROOT, deps: GO_DEPS });
  const v = go.classifyTestability("func Fetch(ctx context.Context, out chan int) int", DOC.go, c.ctx);
  assertNames("go ctx+chan", v, ["chan"]);
});

gtest("[P5 §3] Go: with the context leg lifted, a METHOD taking a context reports the next real blocker (its receiver) rather than an async refusal", () => {
  const go = LANG("go");
  const c = resolveCtx(go, { sourcePath: GO_SRC, projectRoot: GO_ROOT, deps: GO_DEPS });
  const v = go.classifyTestability("func (s *Shard) Fetch(ctx context.Context, n int) int", DOC.go, c.ctx);
  assertRefused("go method + ctx", v);
  assert.strictEqual(
    v.reason,
    "needs-fixture",
    why("go method + ctx", v, "the context no longer refuses, so the receiver is what is left to report")
  );
});

// ===========================================================================
// 4. Rule 4 + property 13: Python/pytest ASKS, through the probe.
// ===========================================================================

gtest("[P5 §4 + §13] Python/pytest: `async def` is TESTABLE when the probe reports pytest-asyncio present", () => {
  const py = LANG("python");
  const c = resolveCtx(py, { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_PYTEST_ASYNCIO });
  assertTestable("python/pytest + pytest-asyncio", py.classifyTestability("async def widen(n: int) -> int:", DOC.python, c.ctx), c);
});

gtest("[P5 §4] Python/pytest: `anyio` is the FALLBACK the contract names - a project without pytest-asyncio but with anyio still admits", () => {
  const py = LANG("python");
  const c = resolveCtx(py, { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_PYTEST_ANYIO });
  assertTestable("python/pytest + anyio", py.classifyTestability("async def widen(n: int) -> int:", DOC.python, c.ctx), c);
});

gtest("[P5 §4 + §13 + §15] Python/pytest: with NEITHER plugin the refusal NAMES pytest-asyncio and says the gesture never installs anything", () => {
  const py = LANG("python");
  const c = resolveCtx(py, { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_PYTEST_BARE });
  const v = py.classifyTestability("async def widen(n: int) -> int:", DOC.python, c.ctx);
  assertNames("python/pytest, no plugin", v, ["pytest-asyncio"]);
  assert.ok(
    /install/i.test(v.detail),
    whyCtx("python/pytest, no plugin", v, c, "the frameworkRefusalDetail wording says the gesture never installs anything")
  );
});

gtest("[P5 §4 + §9] Python: the plugin answer rides `TddDeps.probe` - two ctxs resolved from probes that DISAGREE give opposite verdicts, which is what proves the dep is the channel", () => {
  const py = LANG("python");
  const sig = "async def widen(n: int) -> int:";
  const yes = resolveCtx(py, { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_PYTEST_ASYNCIO });
  const no = resolveCtx(py, { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_PYTEST_BARE });
  const vYes = py.classifyTestability(sig, DOC.python, yes.ctx);
  const vNo = py.classifyTestability(sig, DOC.python, no.ctx);
  assert.notDeepStrictEqual(
    vYes,
    vNo,
    `both probes produced the same verdict ${JSON.stringify(vYes)}, so the injected probe decided nothing\n---- shapes ----\npresent: ${yes.shape}\nabsent: ${no.shape}\n${no.tried.join("\n")}`
  );
  assertTestable("python plugin present", vYes, yes);
  assertRefused("python plugin absent", vNo);
});

// ===========================================================================
// 5. Rule 5 + property 14: Rust reads Cargo.toml dev-dependencies.
// ===========================================================================

const rustCtx = (which) => {
  const rs = LANG("rust");
  return { rs, c: resolveCtx(rs, { sourcePath: RUST_SRC, projectRoot: RUST_ROOT, deps: rustDeps(which) }) };
};

gtest("[P5 §5 + §14] Rust: `pub async fn` is TESTABLE when dev-dependencies carry tokio with features = [\"macros\"]", () => {
  const { rs, c } = rustCtx("tokioMacros");
  assertTestable("rust async + tokio macros", rs.classifyTestability("pub async fn widen(n: u32) -> u64", DOC.rust, c.ctx), c);
});

gtest("[P5 §5] Rust: `async-std` with the attributes feature is a runtime, and so is smol - tokio is FIRST in precedence, not the only entry", () => {
  for (const which of ["asyncStd", "smol"]) {
    const { rs, c } = rustCtx(which);
    assertTestable(`rust async + ${which}`, rs.classifyTestability("pub async fn widen(n: u32) -> u64", DOC.rust, c.ctx), c);
  }
});

gtest("[P5 §5 + §14 + §15] Rust: NO runtime in dev-dependencies refuses, and the detail NAMES ALL THREE it looked for - tokio, async-std, smol", () => {
  const { rs, c } = rustCtx("none");
  const v = rs.classifyTestability("pub async fn widen(n: u32) -> u64", DOC.rust, c.ctx);
  assertNames("rust async, no runtime", v, ["tokio", "async[-_ ]?std", "smol"]);
});

gtest("[P5 §5 + §15] Rust: `tokio` WITHOUT the macros feature does not provide #[tokio::test], so it refuses and the detail SAYS SO - emitting an attribute that does not exist is the failure this rule prevents", () => {
  const { rs, c } = rustCtx("tokioNoMacros");
  const v = rs.classifyTestability("pub async fn widen(n: u32) -> u64", DOC.rust, c.ctx);
  assertNames("rust async, tokio without macros", v, ["macros"]);
});

gtest("[P5 §5] Rust: the manifest is what decides - the SAME async signature flips verdict on the manifest alone, with the signature and the doc held fixed", () => {
  const sig = "pub async fn widen(n: u32) -> u64";
  const withRt = rustCtx("tokioMacros");
  const without = rustCtx("none");
  const a = withRt.rs.classifyTestability(sig, DOC.rust, withRt.c.ctx);
  const b = without.rs.classifyTestability(sig, DOC.rust, without.c.ctx);
  assert.notDeepStrictEqual(
    a,
    b,
    `the manifest changed and the verdict did not: ${JSON.stringify(a)}\n---- shapes ----\nwith: ${withRt.c.shape}\nwithout: ${without.c.shape}\n${without.c.tried.join("\n")}`
  );
});

gtest("[P5 §5 + §9] Rust: testabilityContextFor EXISTS on the Rust leg - the manifest read has to live somewhere, and rule 9 forbids it inside classifyTestability", () => {
  const rs = LANG("rust");
  assert.strictEqual(
    typeof rs.testabilityContextFor,
    "function",
    "P5 rule 9: the manifest and the probe are testabilityContextFor's job"
  );
  const c = resolveCtx(rs, { sourcePath: RUST_SRC, projectRoot: RUST_ROOT, deps: rustDeps("tokioMacros") });
  assert.ok(
    c.ctx && typeof c.ctx === "object",
    `no call shape produced a ctx object:\n${c.tried.join("\n")}`
  );
});

gtest("[P5 §9] Python: testabilityContextFor EXISTS on the Python leg - the pytest-asyncio probe is a project fact and rule 9 puts project facts here", () => {
  const py = LANG("python");
  assert.strictEqual(typeof py.testabilityContextFor, "function", "P5 rule 9, the probe is testabilityContextFor's job");
});

// ===========================================================================
// 6. Rule 6: the classifier never reads a staged context block.
// ===========================================================================

gtest("[P5 §6] a staged context block in the ctx CANNOT flip a refusal - a rung whose verdict depends on what is staged is a rung whose refusals move under the human without warning", () => {
  const { rs, c } = rustCtx("none");
  const sig = "pub async fn widen(n: u32) -> u64";
  const bare = rs.classifyTestability(sig, DOC.rust, c.ctx);
  const staged = rs.classifyTestability(sig, DOC.rust, {
    ...(c.ctx || {}),
    contextBlocks: ["#[my_runtime::test]\nasync fn t() {}"],
    stagedBlocks: ["#[my_runtime::test]"],
    contextBlock: "#[my_runtime::test]",
    testTemplate: "#[my_runtime::test]",
  });
  assert.deepStrictEqual(
    staged,
    bare,
    `a staged block changed the verdict: bare ${JSON.stringify(bare)} vs staged ${JSON.stringify(staged)}`
  );
  assertRefused("rust async, no runtime, block staged", staged);
});

gtest("[P5 §6] a staged context block cannot flip a PASS either - the block is a prompt input in both directions", () => {
  const { rs, c } = rustCtx("tokioMacros");
  const sig = "pub async fn widen(n: u32) -> u64";
  const bare = rs.classifyTestability(sig, DOC.rust, c.ctx);
  const staged = rs.classifyTestability(sig, DOC.rust, { ...(c.ctx || {}), contextBlocks: ["nonsense"], contextBlock: "nonsense" });
  assert.deepStrictEqual(staged, bare, "a staged block is not a classifier input");
});

// ===========================================================================
// 7. Rule 7: the INSTRUCTION asks for the async shape, off the language and its
//    resolved framework, never a guess.
// ===========================================================================

const fwOf = (lang, id) => {
  const f = (lang.frameworks || []).find((x) => x.id === id);
  assert.ok(f, `${lang.languageId} registers no framework ${id}`);
  return f;
};

// The product's own framework-to-prompt mapping. This file originally GUESSED
// its third argument, offering the resolved ctx two ways and saying it did not
// care which channel carried the fact. The real mapping takes the TARGET -
// signature plus resolved ctx - because deciding the async clause needs both
// halves (is THIS signature async; how does THIS project drive an async test)
// and neither half alone is enough. Corrected to the product's shape; every
// assertion below is unchanged.
const promptFor = (languageId, frameworkId, signature, docComment, ctx) => {
  const lang = LANG(languageId);
  const f = fwOf(lang, frameworkId);
  const extra = {};
  return assembleTestGenPrompt({ signature, docComment, ...testGenFieldsFor(lang, f, { signature, ctx }), ...extra });
};

// The prompt QUOTES the target's signature and doc comment, so an idiom check
// run over the whole prompt would pass on the echo alone: `async Task<int>` in
// a C# signature is not an instruction to write an async TEST. Every idiom
// assertion below runs over the prompt with those two echoes removed.
const instructionOf = (p, signature, docComment) =>
  p.split(signature).join(" ").split(String(docComment || " ")).join(" ");

const withPrompt = (id, p, m) => `${id}: ${m}\n---- PROMPT ----\n${p}\n---- END ----`;

gtest("[P5 §7] Rust: an async target's prompt asks for the DETECTED runtime's attribute, #[tokio::test], and for an awaited call", () => {
  const { c } = rustCtx("tokioMacros");
  const sig = "pub async fn widen(n: u32) -> u64";
  const p = promptFor("rust", "libtest", sig, DOC.rust, c.ctx);
  const i = instructionOf(p, sig, DOC.rust);
  assert.ok(/#\[tokio::test\]/.test(i), withPrompt("rust/libtest", p, "the detected runtime's attribute never reached the instruction"));
  assert.ok(/await/.test(i), withPrompt("rust/libtest", p, "the instruction never asks the test to await the call"));
});

gtest("[P5 §7] Python/pytest: an async target's prompt asks for @pytest.mark.asyncio", () => {
  const c = resolveCtx(LANG("python"), { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_PYTEST_ASYNCIO });
  const sig = "async def widen(n: int) -> int:";
  const p = promptFor("python", "pytest", sig, DOC.python, c.ctx);
  assert.ok(
    /@pytest\.mark\.asyncio/.test(instructionOf(p, sig, DOC.python)),
    withPrompt("python/pytest", p, "the pytest async marker never reached the instruction")
  );
});

gtest("[P5 §7] Python/unittest: an async target's prompt asks for IsolatedAsyncioTestCase", () => {
  const c = resolveCtx(LANG("python"), { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_UNITTEST });
  const sig = "async def widen(n: int) -> int:";
  const p = promptFor("python", "unittest", sig, DOC.python, c.ctx);
  assert.ok(
    /IsolatedAsyncioTestCase/.test(instructionOf(p, sig, DOC.python)),
    withPrompt("python/unittest", p, "the stdlib async case class never reached the instruction")
  );
});

gtest("[P5 §7] C#: an async target's prompt asks for an `async Task` test method, in all three registered runners", () => {
  const cs = LANG("csharp");
  const c = resolveCtx(cs, { sourcePath: CS_SRC, projectRoot: CS_ROOT, deps: CS_DEPS });
  const sig = "public static async Task<int> WidenAsync(int n)";
  for (const id of ["mstest", "xunit", "nunit"]) {
    const p = promptFor("csharp", id, sig, DOC.csharp, c.ctx);
    const i = instructionOf(p, sig, DOC.csharp);
    assert.ok(/async\s+Task/.test(i), withPrompt(`csharp/${id}`, p, "the async Task shape never reached the instruction, the echoed signature aside"));
    assert.ok(/await/i.test(i), withPrompt(`csharp/${id}`, p, "the instruction never asks the test to await the call"));
  }
});

gtest("[P5 §7] TypeScript: an async target's prompt asks for an async callback and an awaited call, in vitest and jest", () => {
  const ts = LANG("typescript");
  const c = resolveCtx(ts, { sourcePath: TS_SRC, projectRoot: TS_ROOT, deps: TS_DEPS });
  const sig = "export async function widen(n: number): Promise<number> {";
  for (const id of ["vitest", "jest"]) {
    const p = promptFor("typescript", id, sig, DOC.typescript, c.ctx);
    const i = instructionOf(p, sig, DOC.typescript);
    assert.ok(/async/.test(i), withPrompt(`ts/${id}`, p, "the instruction never says async, the echoed signature aside"));
    assert.ok(/await/.test(i), withPrompt(`ts/${id}`, p, "the instruction never asks the test to await the call"));
  }
});

gtest("[P5 §7 + §8] a NON-ASYNC target gets NO async instruction, in any language - the shape comes off the target, not the language", () => {
  const rows = [
    ["rust", "libtest", "pub fn widen(n: u32) -> u64", DOC.rust, [/#\[tokio::test\]/, /#\[async_std::test\]/, /#\[smol_potat::test\]/]],
    ["python", "pytest", "def widen(n: int) -> int:", DOC.python, [/@pytest\.mark\.asyncio/]],
    ["python", "unittest", "def widen(n: int) -> int:", DOC.python, [/IsolatedAsyncioTestCase/]],
    ["csharp", "mstest", "public static int Widen(int n)", DOC.csharp, [/async\s+Task/]],
    ["csharp", "xunit", "public static int Widen(int n)", DOC.csharp, [/async\s+Task/]],
    ["typescript", "vitest", "export function widen(n: number): number {", DOC.typescript, [/\bawait\b/]],
    ["go", "gotest", "func Widen(n int) int", DOC.go, [/\bawait\b/, /async/]],
  ];
  for (const [languageId, frameworkId, sig, doc, banned] of rows) {
    const p = promptFor(languageId, frameworkId, sig, doc, undefined);
    const i = instructionOf(p, sig, doc);
    for (const re of banned) {
      const m = i.match(re);
      assert.strictEqual(
        m,
        null,
        withPrompt(`${languageId}/${frameworkId}`, p, `a synchronous target's instruction carries the async idiom ${re} (matched ${JSON.stringify(m && m[0])})`)
      );
    }
  }
});

gtest("[P5 §7] Rust: the attribute is the DETECTED runtime and never a guess - an async-std project's prompt must not carry #[tokio::test]", () => {
  const { c } = rustCtx("asyncStd");
  const sig = "pub async fn widen(n: u32) -> u64";
  const p = promptFor("rust", "libtest", sig, DOC.rust, c.ctx);
  const i = instructionOf(p, sig, DOC.rust);
  assert.ok(!/#\[tokio::test\]/.test(i), withPrompt("rust/async-std", p, "tokio was named in a project that does not depend on tokio"));
  assert.ok(/#\[async_std::test\]/.test(i), withPrompt("rust/async-std", p, "the detected async-std attribute never reached the instruction"));
});

// ===========================================================================
// 8. Rule 8: NOTHING changes for a non-async target. A blind file cannot diff
//    against "before", so these rows PIN the verdicts observable today. They
//    are GREEN NOW and a red here is a regression this phase caused.
// ===========================================================================

const NON_ASYNC_ROWS = [
  ["rust", "pub fn widen(n: i32) -> i64", DOC.rust, undefined],
  ["rust", "pub fn widen(n: i32) -> i64", undefined, "underspecified"],
  ["rust", "pub fn read_all(p: &Path) -> io::Result<String>", DOC.rust, "io"],
  ["rust", "pub fn total(&self) -> u64", DOC.rust, "needs-fixture"],
  ["go", "func Widen(n int) int", DOC.go, undefined],
  ["go", "func ParseShard(s string) (int, error)", DOC.go, undefined],
  ["go", "func Widen(n int) int", undefined, "underspecified"],
  ["go", "func Dump(fh *os.File) int", DOC.go, "io"],
  ["go", "func (s *Shard) Total(a int) int", DOC.go, "needs-fixture"],
  ["typescript", "export function widen(n: number): number {", DOC.typescript, undefined],
  ["typescript", "function helper(n: number): number {", DOC.typescript, "not-exported"],
  ["typescript", "export function log(n: number): void {", DOC.typescript, "underspecified"],
  ["typescript", "export function widen(n: number): number {", undefined, "underspecified"],
  ["python", "def widen(n: int) -> int:", DOC.python, undefined],
  ["python", "def widen(n: int) -> int:", undefined, "underspecified"],
  ["python", "def widen(self, n: int) -> int:", DOC.python, "needs-fixture"],
  ["python", "def widen(n: int) -> None:", DOC.python, "underspecified"],
  ["csharp", "public static int Widen(int n)", DOC.csharp, undefined],
  ["csharp", "private static int Widen(int n)", DOC.csharp, "not-exported"],
  ["csharp", "public static void Apply(int n)", DOC.csharp, "underspecified"],
  ["csharp", "public int Widen(int n)", DOC.csharp, "needs-fixture"],
];

gtest("[P5 §8] every non-async row keeps the verdict it has TODAY, in all five languages - lifting the async rung must move nothing else", () => {
  for (const [id, sig, doc, expected] of NON_ASYNC_ROWS) {
    const v = LANG(id).classifyTestability(sig, doc, undefined);
    assert.strictEqual(
      v.reason,
      expected,
      why(`${id} ${JSON.stringify(sig)} doc=${doc ? "yes" : "no"}`, v, `P5 rule 8: expected reason ${JSON.stringify(expected)}`)
    );
  }
});

gtest("[P5 §8 + §9] a non-async verdict is BYTE-IDENTICAL with and without a resolved ctx - same verdict, same detail, because the project fact is about async and nothing else", () => {
  const ctxs = {
    rust: rustCtx("tokioMacros").c.ctx,
    go: resolveCtx(LANG("go"), { sourcePath: GO_SRC, projectRoot: GO_ROOT, deps: GO_DEPS }).ctx,
    typescript: resolveCtx(LANG("typescript"), { sourcePath: TS_SRC, projectRoot: TS_ROOT, deps: TS_DEPS }).ctx,
    python: resolveCtx(LANG("python"), { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_PYTEST_ASYNCIO }).ctx,
    csharp: resolveCtx(LANG("csharp"), { sourcePath: CS_SRC, projectRoot: CS_ROOT, deps: CS_DEPS }).ctx,
  };
  for (const [id, sig, doc] of NON_ASYNC_ROWS) {
    const lang = LANG(id);
    const bare = lang.classifyTestability(sig, doc, undefined);
    const withCtx = lang.classifyTestability(sig, doc, ctxs[id]);
    assert.deepStrictEqual(
      withCtx,
      bare,
      `${id} ${JSON.stringify(sig)}: a resolved ctx changed a NON-ASYNC verdict. bare ${JSON.stringify(bare)} vs ctx ${JSON.stringify(withCtx)}`
    );
  }
});

// ===========================================================================
// 9. Rule 11: precedence. Promise<void> is underspecified, not async.
// ===========================================================================

gtest("[P5 §11] TypeScript `Promise<void>` is 'underspecified', NOT 'async' - there is nothing to assert, and the precedence must not silently reorder now that async is admitted", () => {
  const ts = LANG("typescript");
  for (const sig of [
    "export async function log(n: number): Promise<void> {",
    "export function log(n: number): Promise<void> {",
  ]) {
    const v = ts.classifyTestability(sig, DOC.typescript, undefined);
    assert.strictEqual(v.reason, "underspecified", why(`ts ${sig}`, v, "a void promise carries no value to assert on"));
  }
});

gtest("[P5 §11] the same precedence in C#: `async Task` with NO type argument is 'underspecified', because an awaited unit is still a unit", () => {
  const cs = LANG("csharp");
  const v = cs.classifyTestability("public static async Task ApplyAsync(int n)", DOC.csharp, undefined);
  assert.strictEqual(v.reason, "underspecified", why("csharp async Task", v, "a bare Task returns nothing to assert on"));
});

gtest("[P5 §11] an async target with NO doc comment is 'underspecified' - admitting async does not admit a function with no contract", () => {
  const rows = [
    ["csharp", "public static async Task<int> WidenAsync(int n)"],
    ["typescript", "export async function widen(n: number): Promise<number> {"],
  ];
  for (const [id, sig] of rows) {
    const v = LANG(id).classifyTestability(sig, undefined, undefined);
    assert.strictEqual(v.reason, "underspecified", why(`${id} ${sig}`, v, "no doc comment, nothing to write a blind test against"));
  }
});

// ===========================================================================
// 10. Rule 9: the classifier is PURE over its injected ctx.
// ===========================================================================

const FS_SYNC = ["readFileSync", "existsSync", "readdirSync", "statSync", "lstatSync", "openSync"];
const CP_SYNC = ["execFileSync", "spawnSync", "execSync"];

function withWorldBlocked(fn) {
  const saved = [];
  const block = (obj, keys, kind) => {
    for (const k of keys) {
      if (typeof obj[k] !== "function") continue;
      saved.push([obj, k, obj[k]]);
      obj[k] = (...a) => {
        throw new Error(`classifyTestability touched the world: ${kind}.${k}(${JSON.stringify(a[0])})`);
      };
    }
  };
  block(fs, FS_SYNC, "fs");
  block(cp, CP_SYNC, "child_process");
  try {
    return fn();
  } finally {
    for (const [obj, k, orig] of saved) obj[k] = orig;
  }
}

gtest("[P5 §9] classifyTestability reads NO filesystem and spawns NOTHING - with fs and child_process blocked, every language still returns a verdict", () => {
  const rows = [
    ["rust", "pub async fn widen(n: u32) -> u64", DOC.rust],
    ["rust", "pub fn widen(n: u32) -> u64", DOC.rust],
    ["go", "func Widen(ctx context.Context, n int) int", DOC.go],
    ["typescript", "export async function widen(n: number): Promise<number> {", DOC.typescript],
    ["python", "async def widen(n: int) -> int:", DOC.python],
    ["csharp", "public static async Task<int> WidenAsync(int n)", DOC.csharp],
  ];
  const langs = Object.fromEntries(rows.map(([id]) => [id, LANG(id)]));
  withWorldBlocked(() => {
    for (const [id, sig, doc] of rows) {
      const v = langs[id].classifyTestability(sig, doc, undefined);
      assert.ok(v && typeof v === "object", `${id}: no verdict returned with the world blocked`);
    }
  });
});

gtest("[P5 §9] classifyTestability is DETERMINISTIC - the same arguments twice give the same verdict, in all five languages, async rows included", () => {
  const rows = [
    ["rust", "pub async fn widen(n: u32) -> u64", DOC.rust, rustCtx("tokioMacros").c.ctx],
    ["rust", "pub async fn widen(n: u32) -> u64", DOC.rust, rustCtx("none").c.ctx],
    ["go", "func Drain(c chan int) int", DOC.go, undefined],
    ["go", "func Widen(ctx context.Context, n int) int", DOC.go, undefined],
    ["typescript", "export async function widen(n: number): Promise<number> {", DOC.typescript, undefined],
    ["python", "async def widen(n: int) -> int:", DOC.python, resolveCtx(LANG("python"), { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_PYTEST_BARE }).ctx],
    ["csharp", "public static async void FireAndForget(int n)", DOC.csharp, undefined],
  ];
  for (const [id, sig, doc, ctx] of rows) {
    const lang = LANG(id);
    const a = lang.classifyTestability(sig, doc, ctx);
    const b = lang.classifyTestability(sig, doc, ctx);
    assert.deepStrictEqual(b, a, `${id} ${JSON.stringify(sig)}: two identical calls disagreed, ${JSON.stringify(a)} then ${JSON.stringify(b)}`);
  }
});

gtest("[P5 §9] classifyTestability NEVER THROWS on nonsense - an empty signature, a half-written one and a junk ctx all return a verdict", () => {
  const junk = ["", "   ", "async", "async fn", "func", "def", "public async", "{}(){}", "🌀 async ∅", "chan"];
  const ctxs = [undefined, null, {}, { nonsense: true }, { runtime: 42 }, "not an object", 7];
  for (const id of ["rust", "go", "typescript", "python", "csharp"]) {
    const lang = LANG(id);
    for (const sig of junk) {
      for (const ctx of ctxs) {
        let v;
        assert.doesNotThrow(() => {
          v = lang.classifyTestability(sig, undefined, ctx);
        }, `${id}: classifyTestability threw on ${JSON.stringify(sig)} with ctx ${JSON.stringify(ctx)}`);
        assert.ok(v && typeof v === "object", `${id}: ${JSON.stringify(sig)} returned ${JSON.stringify(v)}`);
      }
    }
    // A doc comment is `string | undefined` at the type level, so a number is
    // not nonsense the classifier has to survive; only the two reachable
    // absent-doc spellings are pinned here.
    for (const doc of [undefined, ""]) {
      assert.doesNotThrow(
        () => lang.classifyTestability("", doc, undefined),
        `${id}: an empty signature with doc ${JSON.stringify(doc)} threw`
      );
    }
  }
});

gtest("[P5 §9] testabilityContextFor never throws on a filesystem that answers NOTHING - a project with no manifest and a probe that cannot spawn still resolves to a usable ctx", () => {
  const dead = {
    fileExists: () => false,
    readFile: () => undefined,
    readDir: () => undefined,
    log: () => {},
    probe: () => undefined,
  };
  for (const id of ["rust", "go", "typescript", "python", "csharp"]) {
    const lang = LANG(id);
    if (typeof lang.testabilityContextFor !== "function") continue;
    const c = resolveCtx(lang, { sourcePath: "/nowhere/x", projectRoot: "/nowhere", deps: dead });
    let v;
    assert.doesNotThrow(() => {
      v = lang.classifyTestability("pub async fn f(n: u32) -> u64", "/// Doc.", c.ctx);
    }, `${id}: an empty project's ctx made classifyTestability throw\n${c.tried.join("\n")}`);
    assert.ok(v && typeof v === "object", `${id}: no verdict from an empty project's ctx`);
  }
});

// ===========================================================================
// 11. Rule 15, gathered: every refusal this phase touches NAMES something, and
//     none of them is the blanket sentence.
// ===========================================================================

gtest("[P5 §15] the blanket sentence 'a blind unit test cannot drive it' appears in NO async-phase refusal detail, in any of the five languages", () => {
  const rows = [
    ["csharp", "public static async void FireAndForget(int n)", DOC.csharp, undefined],
    ["go", "func Drain(c chan int) int", DOC.go, undefined],
    ["go", "func Fetch(ctx context.Context, out chan int) int", DOC.go, undefined],
    ["python", "async def widen(n: int) -> int:", DOC.python, resolveCtx(LANG("python"), { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_PYTEST_BARE }).ctx],
    ["rust", "pub async fn widen(n: u32) -> u64", DOC.rust, rustCtx("none").c.ctx],
    ["rust", "pub async fn widen(n: u32) -> u64", DOC.rust, rustCtx("tokioNoMacros").c.ctx],
  ];
  for (const [id, sig, doc, ctx] of rows) {
    const v = LANG(id).classifyTestability(sig, doc, ctx);
    assertRefused(`${id} ${sig}`, v);
    assert.strictEqual(typeof v.detail, "string", why(`${id} ${sig}`, v, "P5 rule 15 wants a detail that names what is missing"));
    assert.ok(!BLANKET.test(v.detail), why(`${id} ${sig}`, v, "the blanket sentence is exactly what P5 retires"));
    assert.ok(
      /[A-Za-z]{3}/.test(v.detail),
      why(`${id} ${sig}`, v, "the detail names nothing at all")
    );
  }
});

gtest("[P5 §15] each async-phase refusal names ITS OWN missing thing, and the details are DISTINCT - one sentence reused across six causes is the blanket sentence with extra steps", () => {
  const details = [
    ["csharp async void", LANG("csharp").classifyTestability("public static async void FireAndForget(int n)", DOC.csharp, undefined)],
    ["go chan", LANG("go").classifyTestability("func Drain(c chan int) int", DOC.go, undefined)],
    [
      "python no plugin",
      LANG("python").classifyTestability(
        "async def widen(n: int) -> int:",
        DOC.python,
        resolveCtx(LANG("python"), { sourcePath: PY_SRC, projectRoot: PY_ROOT, deps: PY_PYTEST_BARE }).ctx
      ),
    ],
    ["rust no runtime", LANG("rust").classifyTestability("pub async fn widen(n: u32) -> u64", DOC.rust, rustCtx("none").c.ctx)],
    ["rust tokio without macros", LANG("rust").classifyTestability("pub async fn widen(n: u32) -> u64", DOC.rust, rustCtx("tokioNoMacros").c.ctx)],
  ];
  const seen = new Map();
  for (const [label, v] of details) {
    const d = String(v && v.detail);
    const prior = seen.get(d);
    assert.ok(
      prior === undefined,
      `${label} and ${prior} share one refusal detail ${JSON.stringify(d)}, so neither names its own cause`
    );
    seen.set(d, label);
  }
});
