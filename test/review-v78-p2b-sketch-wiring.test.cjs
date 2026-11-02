// Adversarial review, session-v78 phase 2 loop 2: the slot maker (brace
// one-liners, Python one-liners, `=>` expression bodies), the TS/JS concise
// arrow body read, the refusal, and the line-wise onlyCommentsDiffer.
//
// Every test states what the human's intent requires and fails against the
// code as reviewed. Compile rows use the real compiler when it is installed and
// skip when it is not.
//
// Run: node --test test/review-v78-p2b-sketch-wiring.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { bundleCore } = require("./.blind-util.cjs");

const core = bundleCore(
  "review-v78-p2b-core",
  [
    `export { keepSketch, keepSketchForPreview } from "../src/core/scaffoldKeep";`,
    `export { harvestBodyComments, bodyTextOfSpan } from "../src/core/scaffold";`,
    "",
  ].join("\n"),
);
test.after(() => core.cleanup());
const { keepSketch, keepSketchForPreview, harvestBodyComments, bodyTextOfSpan } = core.mod;

const keep = (languageId, originalSpan, reply, extra = {}) =>
  keepSketch({ languageId, originalSpan, reply, bodyIndent: "", ...extra });
const preview = (languageId, originalSpan, reply, extra = {}) =>
  keepSketchForPreview({
    languageId,
    originalSpan,
    reply,
    bodyIndent: "",
    channelTag: "[repair]",
    title: "f: repair round 1 (preview)",
    ...extra,
  });
const harvestOf = (text, languageId) =>
  harvestBodyComments(bodyTextOfSpan(text, languageId, false), languageId, "").comments;

const has = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.status === 0;
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "review-v78-p2b-"));

// ---------------------------------------------------------------------------
// Finding 1 (high): a Python METHOD one-liner gets a slot indented one level
// from column 0, not from the header. The span starts at the `def` keyword
// (flush first line), resolved.bodyIndent is "" when there is no docstring, so
// withSlot's indent is "" + 4 spaces. Spliced at the method's column the body
// sits at the def's own column: IndentationError. The developer's own sketch
// indent (8 spaces here) was in the original span and unused.
// ---------------------------------------------------------------------------

test("F1 python: a method one-liner with a dropped sketch still compiles once spliced into its class", (t) => {
  // The span as the document holds it: first line flush, later lines absolute.
  const original = "def f(self):\n        # step one\n        pass";
  const r = keep("python", original, "def f(self): return 1");
  assert.deepEqual(r.unplaced, []);
  const file = "class A:\n    " + r.text + "\n";
  if (!has("python3", ["--version"])) {
    t.skip("python3 not installed");
    return;
  }
  const dir = tmp();
  const p = path.join(dir, "a.py");
  fs.writeFileSync(p, file);
  const c = spawnSync("python3", ["-c", `compile(open(${JSON.stringify(p)}).read(), "a.py", "exec")`], {
    encoding: "utf8",
  });
  assert.equal(c.status, 0, `spliced file does not compile:\n${file}\n${c.stderr}`);
});

test("F1 python: the made slot uses the developer's body column, not one level from column 0", () => {
  const original = "def f(self):\n        # step one\n        pass";
  const r = keep("python", original, "def f(self): return 1");
  assert.equal(r.text, "def f(self):\n        # step one\n        return 1");
});

// ---------------------------------------------------------------------------
// Finding 2 (high, narrow): the brace slot maker breaks INSIDE a Rust char
// literal. Rust's `'` is not a quote to the bracket scan (lifetimes), so
// closingBrace takes the `}` in `'}'` as the body's closer and withSlot puts a
// line break between `'` and `}`. Generated code no longer compiles.
// ---------------------------------------------------------------------------

const rustOriginal = "fn is_close(c: char) -> bool {\n    // step one\n    todo!()\n}";
const rustReply = "fn is_close(c: char) -> bool { c == '}' }";

test("F2 rust: a one-liner comparing against '}' keeps the char literal whole", () => {
  const r = keep("rust", rustOriginal, rustReply);
  assert.ok(r.text.includes("'}'"), `char literal split: ${JSON.stringify(r.text)}`);
});

test("F2 rust: the slotted one-liner compiles", (t) => {
  if (!has("rustc", ["--version"])) {
    t.skip("rustc not installed");
    return;
  }
  const r = keep("rust", rustOriginal, rustReply);
  const dir = tmp();
  const p = path.join(dir, "a.rs");
  fs.writeFileSync(p, r.text + "\nfn main() {}\n");
  const c = spawnSync("rustc", ["--edition", "2021", "--crate-type", "bin", "-o", path.join(dir, "a"), p], {
    encoding: "utf8",
  });
  assert.equal(c.status, 0, `does not compile:\n${r.text}\n${c.stderr}`);
});

// ---------------------------------------------------------------------------
// Finding 3 (medium): the same split inside a TS/JS regex literal that is the
// whole concise-arrow body. `(s) => /}/` has no bracket around the regex, so
// the `}` is read as a closing brace. Inside a call `(/}/g)` the paren hides it.
// ---------------------------------------------------------------------------

test("F3 typescript: a concise arrow returning /}/ keeps the regex whole", () => {
  const original = "const d = (s: string) => {\n  // step one\n  return /a/;\n};";
  const reply = "const d = (s: string) => /}/;";
  const r = keep("typescript", original, reply);
  assert.ok(r.text.includes("/}/"), `regex split: ${JSON.stringify(r.text)}`);
});

// ---------------------------------------------------------------------------
// Finding 4 (medium, low for Go alone): every made slot in a brace language is
// indented one level from column 0 with spaces, and the moved closing brace
// goes to column 0. The span's first line is flush, so headerIndent reads ""
// for every nested target: every C# member, every method. Go gets 4 spaces in
// a tab file. Compiles, but the developer's preview shows a misindented body
// and a `}` at column 0 under a method at column 4.
// ---------------------------------------------------------------------------

test("F4 go: the made slot indents with the file's tab, as the developer's sketch did", () => {
  const original = "func f() int {\n\t// step one\n\treturn 0\n}";
  const r = keep("go", original, "func f() int { return 1 }");
  assert.equal(r.text, "func f() int {\n\t// step one\n\treturn 1\n}");
});

test("F4 csharp: a class member's made slot sits at the member's body column", () => {
  // A member at column 4: the span's later lines carry the absolute column.
  const original = "public int Add(int a, int b)\n    {\n        // step one\n        return 0;\n    }";
  const r = keep("csharp", original, "public int Add(int a, int b) => a + b;");
  const commentLine = r.text.split("\n").find((l) => l.includes("// step one"));
  assert.equal(commentLine, "        // step one");
});

// ---------------------------------------------------------------------------
// Finding 5 (low-medium): onlyCommentsDiffer drops every comment-only line,
// including directive comments the toolchain reads. A repair whose whole fix
// is a suppression directive reads as "made no meaningful change" and is not
// proposed. Only with a sketch present.
// ---------------------------------------------------------------------------

test("F5 typescript: a repair that adds a @ts-expect-error directive is a change", () => {
  const original = "function f(a: number) {\n  // step one\n  const s: string = a;\n  return s;\n}";
  const reply = "function f(a: number) {\n  // step one\n  // @ts-expect-error\n  const s: string = a;\n  return s;\n}";
  assert.equal(preview("typescript", original, reply).onlyCommentsDiffer, false);
});

test("F5 go: a repair that adds a //go:noinline-style directive line is a change", () => {
  const original = "func f() {\n\t// step one\n\tx := 1 //nolint\n\t_ = x\n}";
  const reply = "func f() {\n\t// step one\n\t//nolint:ineffassign\n\tx := 1 //nolint\n\t_ = x\n}";
  assert.equal(preview("go", original, reply).onlyCommentsDiffer, false);
});

// ---------------------------------------------------------------------------
// Finding 6 (low): a reply with an EMPTY brace body `{}` is refused as "no
// function body", though a slot can be made inside it (`{\n    // s\n}` is
// legal in every brace language). A legal generation is thrown away and the
// message is wrong about what came back.
// ---------------------------------------------------------------------------

test.skip("F6 go: an empty-body reply keeps the sketch inside the braces instead of being refused [triage-p2b finding 6 deleted: an empty body is a non-generation and the refusal stands]", () => {
  const original = "func f() {\n\t// step one\n}";
  const p = preview("go", original, "func f() {}");
  assert.equal(p.refusal, undefined);
  assert.deepEqual(harvestOf(p.text, "go"), ["step one"]);
});

// ---------------------------------------------------------------------------
// Finding 7 (low): body reads that miss a developer's sketch, so the prompt
// gets no sketch and the keeper restores nothing.
// (a) TS function type returning an object type: TS_TYPE_GROUP_HEAD has no
//     `=>`, so the `{` of the return type is taken as the body. Pre-existing
//     in shape (HEAD cut at the first `{` too), and tsSignatureFromSpanText
//     has the same hole.
// (b) A curried concise arrow: the body is read after the LAST `=>`, so a
//     sketch written between the arrows is outside it.
// ---------------------------------------------------------------------------

test.skip("F7a typescript: a return type `(a) => { x: number }` does not hide the body's sketch [deferred: S78-6 in session-v78/scraps.md]", () => {
  const span = "function f(): (a: number) => { x: number } {\n  // step one\n  return (a) => ({ x: a });\n}";
  assert.deepEqual(harvestOf(span, "typescript"), ["step one"]);
});

test.skip("F7b typescript: a sketch between the arrows of a curried concise arrow is read [deferred: S78-6 in session-v78/scraps.md]", () => {
  const span = "const f = (a: number) =>\n  // step one\n  (b: number) => a + b;";
  assert.deepEqual(harvestOf(span, "typescript"), ["step one"]);
});

// ---------------------------------------------------------------------------
// Holds (green, kept as regression guards for what the review checked):
// block-bodied TS with `=>` in a parameter type, return type or annotation
// reads the real body; slotted Go/C#/Python/TS one-liners compile.
// ---------------------------------------------------------------------------

test("holds: `=>` in a TS signature does not move the body read off the body brace", () => {
  for (const span of [
    "function f(cb: (x: number) => void) {\n  // step one\n  return 1;\n}",
    "function f(): () => void {\n  // step one\n  return () => {};\n}",
    "const f: (a: number) => number = (a) => {\n  // step one\n  return a;\n};",
    "function f(a = () => 1) {\n  // step one\n}",
    "m(cb: (e: Event) => void): void {\n  // step one\n}",
    "function f(): () => void\n{\n  // step one\n}",
  ]) {
    assert.deepEqual(harvestOf(span, "typescript"), ["step one"], span);
  }
  assert.equal(bodyTextOfSpan("function f(cb: (x: number) => void) {\n  return 1;\n}", "typescript"), "\n  return 1;\n}");
});

test("holds: slotted Go one-liners are valid Go", (t) => {
  if (!has("go", ["version"])) {
    t.skip("go not installed");
    return;
  }
  const o = (name, ret) => `func ${name}() ${ret} {\n\t// step one\n\treturn\n}`;
  const parts = [
    keep("go", o("a", "int"), "func a() int { return 1 }").text,
    keep("go", o("b", "string"), 'func b() string { return "}" }').text,
    keep("go", o("d", "rune"), "func d() rune { return '}' }").text,
    keep("go", o("e", "string"), "func e() string { return `}` }").text,
    keep("go", o("g", "(r int)"), "func g() (r int) { r = 1; return }").text,
  ];
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "a.go"), "package main\n" + parts.join("\n") + "\nfunc main() {}\n");
  const c = spawnSync("go", ["build", "-o", path.join(dir, "a"), path.join(dir, "a.go")], {
    encoding: "utf8",
    env: { ...process.env, GOFLAGS: "", GO111MODULE: "off", GOCACHE: path.join(dir, "cache") },
  });
  assert.equal(c.status, 0, c.stderr);
});
