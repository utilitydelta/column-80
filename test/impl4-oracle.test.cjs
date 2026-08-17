// Implementer oracle: what the blind set cannot see in compilerOracle.ts —
// crate-root walk edge cases (workspace shapes, missing-manifest chains,
// the real-fs default), parser behavior against malformed and truncated
// rustc JSON beyond the committed captures, and runOracleCheck orchestration
// details (signal pass-through, first build-finished wins, integer ms).
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl4-oracle",
  `export { RustOracle, runOracleCheck, resolveDiagnosticPath } from "../src/core/compilerOracle";\n`
);
const { RustOracle, runOracleCheck, resolveDiagnosticPath } = mod;
test.after(cleanup);

const FIXTURES = path.join(__dirname, "fixtures", "rustc");
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

const vfs = (manifestDirs) => {
  const calls = [];
  const fileExists = (p) => {
    calls.push(p);
    return manifestDirs.some((d) => p === path.join(d, "Cargo.toml"));
  };
  return { fileExists, calls };
};

// ---- crate-root walk edges

test("workspace member missing its own Cargo.toml: the walk continues to the workspace root (chain, not nearest-dir-only)", () => {
  const { fileExists } = vfs(["/w/ws"]);
  const root = new RustOracle({ fileExists }).detectCrateRoot("/w/ws/member/src/deep/mod.rs");
  assert.strictEqual(root, "/w/ws");
});

test("manifest at the filesystem root is found, and the walk terminates there instead of spinning", () => {
  const { fileExists, calls } = vfs(["/"]);
  const root = new RustOracle({ fileExists }).detectCrateRoot("/a/b/f.rs");
  assert.strictEqual(root, "/");
  assert.strictEqual(calls[calls.length - 1], path.join("/", "Cargo.toml"));
});

test("file directly under the filesystem root with no manifest anywhere: exactly one probe, undefined", () => {
  const { fileExists, calls } = vfs([]);
  const root = new RustOracle({ fileExists }).detectCrateRoot("/f.rs");
  assert.strictEqual(root, undefined);
  assert.deepStrictEqual(calls, [path.join("/", "Cargo.toml")], "dirname('/') === '/' ends the walk after the root probe");
});

test("missing-manifest chain probes every ancestor exactly once, in order", () => {
  const { fileExists, calls } = vfs([]);
  new RustOracle({ fileExists }).detectCrateRoot("/a/b/c/f.rs");
  assert.deepStrictEqual(calls, [
    path.join("/a/b/c", "Cargo.toml"),
    path.join("/a/b", "Cargo.toml"),
    path.join("/a", "Cargo.toml"),
    path.join("/", "Cargo.toml"),
  ]);
});

test("no-arg constructor uses the real filesystem (ruling 1: no deps = real fs)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "impl4-walk-"));
  try {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "Cargo.toml"), '[package]\nname = "x"\n');
    const file = path.join(dir, "src", "lib.rs");
    fs.writeFileSync(file, "");
    assert.strictEqual(new RustOracle().detectCrateRoot(file), dir);
    assert.strictEqual(new RustOracle().detectCrateRoot(path.join(os.tmpdir(), "no-crate-here.rs")), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- parser against malformed shapes the captures cannot produce

const parse = (stdout) => new RustOracle().parseCheckOutput(stdout);
const wrap = (message) => JSON.stringify({ reason: "compiler-message", message }) + "\n";

const malformedCases = [
  { name: "message is a string, not an object", line: '{"reason":"compiler-message","message":"help"}\n', want: 0 },
  { name: "message is null", line: '{"reason":"compiler-message","message":null}\n', want: 0 },
  { name: "top-level JSON is an array", line: '[1,2,3]\n', want: 0 },
  { name: "top-level JSON is a number", line: '42\n', want: 0 },
  { name: "level ice is dropped like every non-error/warning level", line: wrap({ level: "ice", message: "internal compiler error", spans: [] }), want: 0 },
  { name: "level note at top level is dropped", line: wrap({ level: "note", message: "n", spans: [] }), want: 0 },
  { name: "spans: null tolerated as no spans", line: wrap({ level: "error", message: "m", spans: null }), want: 1 },
  { name: "spans key missing tolerated as no spans", line: wrap({ level: "error", message: "m" }), want: 1 },
  { name: "children: null tolerated as no suggestions", line: wrap({ level: "error", message: "m", spans: [], children: null }), want: 1 },
  { name: "child with spans: null contributes nothing", line: wrap({ level: "error", message: "m", spans: [], children: [{ message: "h", spans: null }] }), want: 1 },
  { name: "child that is itself null contributes nothing", line: wrap({ level: "error", message: "m", spans: [], children: [null] }), want: 1 },
];
for (const { name, line, want } of malformedCases) {
  test(`malformed line tolerance: ${name} -> ${want} diagnostics, no throw`, () => {
    const diags = parse(line);
    assert.strictEqual(diags.length, want);
    for (const d of diags) {
      assert.deepStrictEqual(d.spans, []);
      assert.deepStrictEqual(d.suggestions, []);
    }
  });
}

test("a real capture truncated mid-file still yields the diagnostics whose lines survived whole", () => {
  const whole = fixture("type-error.json");
  const diagLine = whole.split("\n").find((l) => l.includes('"compiler-message"'));
  const truncated = diagLine + "\n" + diagLine.slice(0, Math.floor(diagLine.length / 2));
  const diags = parse(truncated);
  assert.strictEqual(diags.length, 1, "the whole line parses; the half line is skipped, not fatal");
  assert.strictEqual(diags[0].code, "E0308");
});

test("suggestion hoist skips child spans whose suggested_replacement is null but keeps siblings", () => {
  const span = (rep) => ({
    file_name: "src/x.rs", byte_start: 1, byte_end: 2, line_start: 1, line_end: 1,
    column_start: 1, column_end: 2, is_primary: true, label: null, suggested_replacement: rep,
  });
  const line = wrap({
    level: "error", message: "m", spans: [],
    children: [{ message: "h", level: "help", spans: [span(null), span("fix_a"), span("fix_b")] }],
  });
  const [d] = parse(line);
  assert.deepStrictEqual(d.suggestions.map((s) => s.replacement), ["fix_a", "fix_b"]);
  for (const s of d.suggestions) {
    assert.ok(!("applicability" in s), "suggestion_applicability absent in input -> absent key");
  }
});

// ---- runOracleCheck orchestration details

const FILE = "/w/crate/src/task1.rs";
const oracleWith = (dirs) => new RustOracle({ fileExists: vfs(dirs).fileExists });

test("the caller's AbortSignal reaches the injected runner untouched", async () => {
  const controller = new AbortController();
  let seenSignal;
  const runCommand = async (_cmd, signal) => {
    seenSignal = signal;
    return { stdout: "", exitCode: 0 };
  };
  await runOracleCheck(oracleWith(["/w/crate"]), FILE, { runCommand, signal: controller.signal });
  assert.strictEqual(seenSignal, controller.signal);
});

test("first build-finished line wins when concatenated output carries two", async () => {
  const stdout =
    '{"reason":"build-finished","success":false}\n' +
    '{"reason":"build-finished","success":true}\n';
  const runCommand = async () => ({ stdout, exitCode: 0 });
  const result = await runOracleCheck(oracleWith(["/w/crate"]), FILE, { runCommand });
  assert.strictEqual(result.success, false);
});

test("build-finished with a non-boolean success flag reads as failure, not truthiness", async () => {
  const runCommand = async () => ({ stdout: '{"reason":"build-finished","success":"yes"}\n', exitCode: 0 });
  const result = await runOracleCheck(oracleWith(["/w/crate"]), FILE, { runCommand });
  assert.strictEqual(result.success, false, "cargo's flag is boolean; anything else is not a success verdict");
});

test("no log injected: the check still runs and resolves (evidence is optional plumbing, never load-bearing)", async () => {
  const runCommand = async () => ({ stdout: fixture("warning-only.json"), exitCode: 0 });
  const result = await runOracleCheck(oracleWith(["/w/crate"]), FILE, { runCommand });
  assert.strictEqual(result.diagnostics.length, 1);
  const skipped = await runOracleCheck(oracleWith([]), FILE, { runCommand });
  assert.strictEqual(skipped, undefined);
});

test("done-line ms is an integer even when the runner resolves instantly", async () => {
  const lines = [];
  const runCommand = async () => ({ stdout: fixture("type-error.json"), exitCode: 101 });
  await runOracleCheck(oracleWith(["/w/crate"]), FILE, { runCommand, log: (l) => lines.push(l) });
  const done = lines.find((l) => l.startsWith("[oracle] check done "));
  assert.match(done, /ms=\d+ /, "no floats in evidence");
});

test("crateRoot rides on the result for display resolution of crate-relative fileNames", async () => {
  const runCommand = async () => ({ stdout: fixture("type-error.json"), exitCode: 101 });
  const result = await runOracleCheck(oracleWith(["/w/crate"]), FILE, { runCommand });
  assert.strictEqual(result.crateRoot, "/w/crate");
});

// ---- P4-F11: malformed spans drop, never poison

const mutateSpanField = (fixtureName, field, value) => {
  const line = fixture(fixtureName).split("\n").find((l) => l.includes('"compiler-message"'));
  const obj = JSON.parse(line);
  obj.message.spans[0][field] = value;
  return JSON.stringify(obj) + "\n";
};

const malformedSpanCases = [
  { name: "byte_start is a string", field: "byte_start", value: "oops" },
  { name: "byte_end is null", field: "byte_end", value: null },
  { name: "line_start missing (undefined)", field: "line_start", value: undefined },
  { name: "column_end is NaN-producing object", field: "column_end", value: {} },
  { name: "file_name is a number", field: "file_name", value: 7 },
];
for (const { name, field, value } of malformedSpanCases) {
  test(`malformed parent span (${name}): diagnostic dropped with a logged skip, sibling diagnostics survive`, () => {
    const lines = [];
    const oracle = new RustOracle({ log: (l) => lines.push(l) });
    const bad = mutateSpanField("type-error.json", field, value);
    const diags = oracle.parseCheckOutput(bad + fixture("name-error.json"));
    assert.deepStrictEqual(diags.map((d) => d.code), ["E0425"], "the poisoned E0308 dropped, the good E0425 survived");
    assert.ok(lines.includes("[oracle] parse skipped: malformed span code=E0308"), `skip logged, got ${JSON.stringify(lines)}`);
  });
}

test("no NaN ever reaches a span consumer: every surviving span field is a finite number", () => {
  const oracle = new RustOracle({ log: () => {} });
  const soup =
    mutateSpanField("type-error.json", "byte_start", "12abc") +
    fixture("borrow-error.json") +
    fixture("warning-only.json");
  for (const d of oracle.parseCheckOutput(soup)) {
    for (const s of [...d.spans, ...d.suggestions.map((x) => x.span)]) {
      for (const field of ["byteStart", "byteEnd", "lineStart", "lineEnd", "columnStart", "columnEnd"]) {
        assert.ok(Number.isFinite(s[field]), `${field} must be finite, got ${s[field]}`);
      }
      assert.strictEqual(typeof s.fileName, "string");
    }
  }
});

test("malformed suggestion span: only the suggestion drops (logged), the parent diagnostic survives", () => {
  const line = fixture("name-error.json").split("\n").find((l) => l.includes('"compiler-message"'));
  const obj = JSON.parse(line);
  const child = obj.message.children.find((c) => c.spans.some((s) => s.suggested_replacement != null));
  child.spans.find((s) => s.suggested_replacement != null).byte_start = "junk";
  const lines = [];
  const oracle = new RustOracle({ log: (l) => lines.push(l) });
  const [d] = oracle.parseCheckOutput(JSON.stringify(obj) + "\n");
  assert.strictEqual(d.code, "E0425", "diagnostic kept");
  assert.deepStrictEqual(d.suggestions, [], "poisoned suggestion dropped");
  assert.ok(lines.includes("[oracle] parse skipped: malformed suggestion span code=E0425"), `got ${JSON.stringify(lines)}`);
});

test("no log injected: malformed spans still drop silently with identical parse results", () => {
  const bad = mutateSpanField("type-error.json", "byte_start", "oops");
  assert.deepStrictEqual(new RustOracle().parseCheckOutput(bad), []);
});

// ---- P4-F1: the const-eval assertion capture parses as an ordinary E0080 compile error

test("const-assert fixture (real capture): one E0080 diagnostic with the evaluation-panicked assertion message, failure-note dropped", () => {
  const diags = new RustOracle().parseCheckOutput(fixture("const-assert.json"));
  assert.strictEqual(diags.length, 1);
  const d = diags[0];
  assert.strictEqual(d.kind, "compile-error", "parseCheckOutput never invents assertion kinds; refusal is the classifier's job");
  assert.strictEqual(d.code, "E0080");
  assert.ok(d.message.startsWith("evaluation panicked: assertion failed:"), `got ${JSON.stringify(d.message)}`);
  assert.strictEqual(d.spans.filter((s) => s.isPrimary).length, 1, "const-eval failures carry a primary span; refusal must come from shape, not missing location");
});

// ---- P4-F2: crate-relative vs workspace-relative span paths

const pvfs = (existing) => (p) => existing.includes(p);

const resolveCases = [
  {
    name: "standalone crate: crateRoot join exists and wins",
    crateRoot: "/w/crate", fileName: "src/task1.rs",
    existing: ["/w/crate/src/task1.rs"],
    want: "/w/crate/src/task1.rs",
  },
  {
    name: "workspace member: rustc reports member-prefixed paths from the workspace root",
    crateRoot: "/ws/member", fileName: "member/src/lib.rs",
    existing: ["/ws/member/src/lib.rs"],
    want: "/ws/member/src/lib.rs",
  },
  {
    name: "nested workspace member: two levels up",
    crateRoot: "/ws/crates/member", fileName: "crates/member/src/lib.rs",
    existing: ["/ws/crates/member/src/lib.rs"],
    want: "/ws/crates/member/src/lib.rs",
  },
  {
    name: "absolute fileName passes through untouched",
    crateRoot: "/w/crate", fileName: "/registry/src/lib.rs",
    existing: [],
    want: "/registry/src/lib.rs",
  },
  {
    name: "nothing exists anywhere: deterministic crateRoot join fallback",
    crateRoot: "/w/crate", fileName: "src/ghost.rs",
    existing: [],
    want: "/w/crate/src/ghost.rs",
  },
  {
    name: "P4-F12: under a workspace anchor, root-relative src/lib.rs resolves to the WORKSPACE file even when the member has one too",
    crateRoot: "/ws/member", fileName: "src/lib.rs",
    existing: ["/ws/Cargo.toml", "/ws/member/Cargo.toml", "/ws/member/src/lib.rs", "/ws/src/lib.rs"],
    // Q6: the anchor is now the outermost manifest that DECLARES a workspace,
    // not the outermost manifest of any kind, so this fixture has to say which
    // one is the workspace root. It always meant /ws; under the old rule any
    // ancestor manifest would do, and that was the defect.
    workspaces: ["/ws/Cargo.toml"],
    want: "/ws/src/lib.rs",
  },
  {
    name: "no ancestor manifest (standalone semantics): crateRoot join wins the same collision",
    crateRoot: "/ws/member", fileName: "src/lib.rs",
    existing: ["/ws/member/Cargo.toml", "/ws/member/src/lib.rs", "/ws/src/lib.rs"],
    want: "/ws/member/src/lib.rs",
  },
  {
    name: "P4-F12: member-prefixed path under the workspace anchor resolves to the member file",
    crateRoot: "/ws/member", fileName: "member/src/lib.rs",
    existing: ["/ws/Cargo.toml", "/ws/member/Cargo.toml", "/ws/member/src/lib.rs"],
    workspaces: ["/ws/Cargo.toml"],
    want: "/ws/member/src/lib.rs",
  },
  {
    // Q6: NEAREST workspace, and this row has to be able to tell the difference.
    // Its previous form asserted "outermost wins" and was green under every
    // annotation including none, because the wanted path was reachable through
    // the downward fallback either way - a row that names a rule it cannot
    // test. Here /outer/member/src/lib.rs EXISTS, so an outermost anchor lands
    // on a real file the crate does not own, which is the whole defect class.
    // Measured against cargo 1.96: from nest/inner/member the diagnostic reads
    // `member/src/lib.rs`, relative to the INNER workspace.
    name: "NEAREST workspace wins when workspaces stack, and the outer one owns a colliding path",
    crateRoot: "/outer/inner/member", fileName: "member/src/lib.rs",
    existing: [
      "/outer/Cargo.toml",
      "/outer/member/src/lib.rs",
      "/outer/inner/Cargo.toml",
      "/outer/inner/member/Cargo.toml",
      "/outer/inner/member/src/lib.rs",
    ],
    workspaces: ["/outer/Cargo.toml", "/outer/inner/Cargo.toml"],
    want: "/outer/inner/member/src/lib.rs",
  },
];
// Q6: the anchor rule reads manifest CONTENT now, so a fixture that models a
// layout as a bare path list is under-specified - "a Cargo.toml exists" was
// enough to mean "workspace root" only while the rule was wrong. Each case
// names its workspace manifests; every other manifest reads as a plain
// [package], which is what a nested crate's own manifest really is.
const manifestReader = (workspaces = []) => (p) =>
  workspaces.includes(p) ? "[workspace]\nmembers = []\n" : '[package]\nname = "x"\n';
for (const { name, crateRoot, fileName, existing, want, workspaces } of resolveCases) {
  test(`resolveDiagnosticPath: ${name}`, () => {
    assert.strictEqual(
      resolveDiagnosticPath(crateRoot, fileName, pvfs(existing), manifestReader(workspaces)),
      want,
    );
  });
}
