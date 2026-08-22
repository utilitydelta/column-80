// IMPLEMENTER tests — session-v40 item 3, phase 2: the Go measurement rig.
// Proves the pieces that don't need a live LSP or GPU: the function scanner
// (session-complxity-research/spikes/lib-go-scan.cjs) and the byte-splice
// logic (session-complxity-research/spikes/lib-go.cjs), against synthetic Go
// snippets and against real functions pulled by hand out of cobra/gin. The
// live check that lib-go.cjs's buildTests really runs `go build -o /dev/null
// ./...` against a real repo lives in impl-v40-p2-go-rig-live.test.cjs — this
// file needs neither a GPU nor a network, which is what the phase's process
// section required.
//
// Run: SKIP_LIVE=1 node --test test/impl-v40-p2-go-rig.test.cjs

// THE MEASUREMENT RIG LIVES IN A DIFFERENT REPOSITORY (2026-08-10). It and the
// session archives were split into a private repo because they carry corpora
// taken against private client code and cannot be published, so a public clone
// has no `session-complxity-research/` and the rows below have no subject.
//
// The whole file skips, with the reason on the channel. It SKIPS rather than
// passing vacuously: a row that goes green when the thing it tests is absent is
// the false green this suite exists to prevent. Where a baseline can be
// vendored instead, vendor it (see test/fixtures/prompt) and do not use this.
const { RIG_PRESENT, SKIP_REASON } = require("./.rig-present.cjs");
if (!RIG_PRESENT) {
  require("node:test")("rig-dependent rows", { skip: SKIP_REASON }, () => {});
  return;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { scanFunctions, receiverTypeOf } = require("../session-complxity-research/spikes/lib-go-scan.cjs");

// ---------------------------------------------------------------------------
// scanFunctions: synthetic snippets
// ---------------------------------------------------------------------------

test("scanFunctions: byte-exact declStart/bodyOpen/bodyClose for a plain function", () => {
  const src = 'package foo\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n';
  const fns = scanFunctions(src);
  assert.equal(fns.length, 1);
  const f = fns[0];
  assert.equal(f.name, "Add");
  assert.equal(src.slice(f.declStart, f.declStart + 4), "func");
  assert.equal(src[f.bodyOpen], "{");
  assert.equal(src[f.bodyClose], "}");
  assert.equal(src.slice(f.declStart, f.bodyOpen + 1), "func Add(a, b int) int {");
  assert.equal(src.slice(f.bodyOpen, f.bodyClose + 1), "{\n\treturn a + b\n}");
  assert.equal(f.signature, "func Add(a, b int) int");
});

test("scanFunctions: nested braces (if block) resolve to the function's OWN closing brace", () => {
  const src = [
    "package foo",
    "",
    "func Classify(a int) string {",
    "\tif a < 0 {",
    "\t\treturn \"neg\"",
    "\t}",
    "\treturn \"nonneg\"",
    "}",
    "",
  ].join("\n");
  const f = scanFunctions(src)[0];
  assert.equal(src[f.bodyClose], "}");
  // The closing brace is the LAST one, not the if-block's.
  assert.equal(f.bodyClose, src.lastIndexOf("}"));
});

test("scanFunctions: multi-value return type in parens does not end the signature early", () => {
  const src = "package foo\n\nfunc pair(a int) (int, error) {\n\treturn a, nil\n}\n";
  const f = scanFunctions(src)[0];
  assert.equal(f.signature, "func pair(a int) (int, error)");
  assert.equal(src[f.bodyOpen], "{");
});

test("scanFunctions: doc comment attaches contiguous // lines immediately above, stops at a blank line", () => {
  const src = [
    "package foo",
    "",
    "// unrelated paragraph, separated by a blank line",
    "",
    "// Add returns the sum of a and b.",
    "// It is trivial.",
    "func Add(a, b int) int {",
    "\treturn a + b",
    "}",
    "",
  ].join("\n");
  const f = scanFunctions(src)[0];
  assert.equal(f.docComment, "// Add returns the sum of a and b.\n// It is trivial.");
});

test("scanFunctions: no doc comment above yields undefined, not an empty string", () => {
  const src = "package foo\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n";
  const f = scanFunctions(src)[0];
  assert.equal(f.docComment, undefined);
});

test("scanFunctions: receiver detection — pointer, value, generic, and none", () => {
  const src = [
    "package foo",
    "",
    "func (s *Stack) Push(x int) {",
    "\ts.items = append(s.items, x)",
    "}",
    "",
    "func (s Stack) Len() int {",
    "\treturn len(s.items)",
    "}",
    "",
    "func (s *Stack[T]) PushT(x T) {",
    "\ts.items = append(s.items, x)",
    "}",
    "",
    "func Plain(a int) int {",
    "\treturn a",
    "}",
    "",
  ].join("\n");
  const fns = scanFunctions(src);
  const byName = Object.fromEntries(fns.map((f) => [f.name, f]));
  assert.equal(byName.Push.implHeader, "Stack");
  assert.equal(byName.Len.implHeader, "Stack");
  assert.equal(byName.PushT.implHeader, "Stack"); // generic instantiation stripped
  assert.equal(byName.Plain.implHeader, undefined);
});

test("receiverTypeOf: strips pointer star and generic instantiation, keeps a plain name as-is", () => {
  assert.equal(receiverTypeOf("s *Stack"), "Stack");
  assert.equal(receiverTypeOf("s Stack"), "Stack");
  assert.equal(receiverTypeOf("s *Stack[T]"), "Stack");
  assert.equal(receiverTypeOf(undefined), undefined);
});

test("scanFunctions: a bodyless declaration (assembly/cgo stub) is not a task", () => {
  const src = [
    "package foo",
    "",
    "func asmAdd(a, b int) int",
    "",
    "func Real(a int) int {",
    "\treturn a",
    "}",
    "",
  ].join("\n");
  const fns = scanFunctions(src);
  assert.deepEqual(
    fns.map((f) => f.name),
    ["Real"],
  );
});

test("scanFunctions: an indented func literal inside a body is not mistaken for a top-level declaration", () => {
  const src = [
    "package foo",
    "",
    "func Outer() int {",
    "\tf := func(a, b int) int {",
    "\t\treturn a + b",
    "\t}",
    "\treturn f(1, 2)",
    "}",
    "",
  ].join("\n");
  const fns = scanFunctions(src);
  assert.deepEqual(
    fns.map((f) => f.name),
    ["Outer"],
  );
  // The whole inner literal is inside Outer's own body span.
  const f = fns[0];
  assert.ok(src.slice(f.bodyOpen, f.bodyClose + 1).includes("func(a, b int) int"));
});

test("scanFunctions: braces inside a raw (backtick) string body do not desync brace matching", () => {
  const src = [
    "package foo",
    "",
    "func Tmpl() string {",
    "\treturn `{{ if .X }}{{ end }}`",
    "}",
    "",
  ].join("\n");
  const f = scanFunctions(src)[0];
  assert.equal(src[f.bodyClose], "}");
  assert.equal(f.bodyClose, src.lastIndexOf("}"));
});

test("scanFunctions: braces inside a line comment do not desync brace matching", () => {
  const src = [
    "package foo",
    "",
    "func Weird() int {",
    "\t// this comment has a stray } in it",
    "\treturn 1",
    "}",
    "",
  ].join("\n");
  const f = scanFunctions(src)[0];
  assert.equal(f.bodyClose, src.lastIndexOf("}"));
});

test("scanFunctions: multi-line signature (params split across lines) still finds the real body open", () => {
  const src = ["package foo", "", "func Multi(", "\ta int,", "\tb string,", ") error {", "\treturn nil", "}", ""].join(
    "\n",
  );
  const f = scanFunctions(src)[0];
  assert.equal(src[f.bodyOpen], "{");
  assert.equal(f.signature, "func Multi(\n\ta int,\n\tb string,\n) error");
});

// ---------------------------------------------------------------------------
// scanFunctions: real functions, pulled by hand from the v23 Go corpus
// (cobra/gin), embedded verbatim so this test does not depend on the
// sandbox's live state. Offsets are computed from the embedded snippet
// itself, not asserted against absolute file offsets.
// ---------------------------------------------------------------------------

test("scanFunctions: real function from cobra's bash_completions.go (GenBashCompletion)", () => {
  // Pulled verbatim from ~/sandbox/v23-corpus/cobra/bash_completions.go.
  const src = [
    "package cobra",
    "",
    "// GenBashCompletion generates bash completion file and writes to the passed writer.",
    "func (c *Command) GenBashCompletion(w io.Writer) error {",
    "\tbuf := new(bytes.Buffer)",
    "\twritePreamble(buf, c.Name())",
    "\tif len(c.BashCompletionFunction) > 0 {",
    '\t\tbuf.WriteString(c.BashCompletionFunction + "\\n")',
    "\t}",
    "\tgen(buf, c)",
    "\t_, err := buf.WriteTo(w)",
    "\treturn err",
    "}",
    "",
  ].join("\n");
  const f = scanFunctions(src)[0];
  assert.equal(f.name, "GenBashCompletion");
  assert.equal(f.implHeader, "Command");
  assert.equal(f.docComment, "// GenBashCompletion generates bash completion file and writes to the passed writer.");
  assert.equal(f.signature, "func (c *Command) GenBashCompletion(w io.Writer) error");
  assert.equal(src[f.bodyOpen], "{");
  assert.equal(f.bodyClose, src.lastIndexOf("}"));
});

test("scanFunctions: real function from gin's auth.go (processAccounts, no doc comment)", () => {
  // Pulled verbatim from ~/sandbox/v23-corpus/gin/auth.go.
  const src = [
    "package gin",
    "",
    "func processAccounts(accounts Accounts) authPairs {",
    "\tlength := len(accounts)",
    '\tassert1(length > 0, "Empty list of authorized credentials")',
    "\tpairs := make(authPairs, 0, length)",
    "\tfor user, password := range accounts {",
    '\t\tassert1(user != "", "User can not be empty")',
    "\t\tvalue := authorizationHeader(user, password)",
    "\t\tpairs = append(pairs, authPair{",
    "\t\t\tvalue: value,",
    "\t\t\tuser:  user,",
    "\t\t})",
    "\t}",
    "\treturn pairs",
    "}",
    "",
  ].join("\n");
  const f = scanFunctions(src)[0];
  assert.equal(f.name, "processAccounts");
  assert.equal(f.implHeader, undefined);
  assert.equal(f.docComment, undefined);
  assert.equal(f.signature, "func processAccounts(accounts Accounts) authPairs");
  // The struct literal's own `{`/`}` (authPair{...}) must not be read as the
  // function's close; the function's close is the LAST brace.
  assert.equal(f.bodyClose, src.lastIndexOf("}"));
  assert.ok(src.slice(f.bodyOpen, f.bodyClose + 1).includes("authPair{"));
});

// ---------------------------------------------------------------------------
// lib-go.cjs: splice / restore / assertOffsets, against a throwaway repo.
// STUDY_ROOT_GO must be set BEFORE requiring lib-go.cjs — its ROOT constant
// reads the env once at module load.
// ---------------------------------------------------------------------------

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "v40-go-rig-"));
const REPO = "fixture-repo";
const REPO_ROOT = path.join(SCRATCH, REPO);
fs.mkdirSync(REPO_ROOT, { recursive: true });
// lib-go.cjs's ROOT is the v23-corpus PARENT (many sibling repos), not one
// repo — the same shape lib-cargo.cjs's ROOT is the cargo WORKSPACE root.
// So a candidate's `file` must be relative to ROOT/SCRATCH, carrying the
// repo name as its first segment, exactly what 01-corpus-go.cjs now writes
// (`path.relative(ROOT, file)`, fixed after this test first caught the
// mismatch: readPristine joined ROOT with a repo-root-relative path and
// missed the repo directory entirely).
const REL_FILE = path.join(REPO, "pkg", "foo.go");
fs.mkdirSync(path.join(REPO_ROOT, "pkg"), { recursive: true });
const ORIGINAL_SRC = [
  "package pkg",
  "",
  "func Add(a, b int) int {",
  "\treturn a + b",
  "}",
  "",
  "func Sub(a, b int) int {",
  "\treturn a - b",
  "}",
  "",
].join("\n");
fs.writeFileSync(path.join(SCRATCH, REL_FILE), ORIGINAL_SRC);

process.env.STUDY_ROOT_GO = SCRATCH;
const lib = require("../session-complxity-research/spikes/lib-go.cjs");
test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

function candidateFor(name) {
  const f = scanFunctions(ORIGINAL_SRC).find((x) => x.name === name);
  return { file: REL_FILE, name, ...f };
}

test("lib-go: ROOT resolves from STUDY_ROOT_GO", () => {
  assert.equal(lib.ROOT, SCRATCH);
});

test("lib-go: assertOffsets accepts fresh offsets and rejects stale ones", () => {
  const add = candidateFor("Add");
  assert.doesNotThrow(() => lib.assertOffsets(add, ORIGINAL_SRC));
  const stale = { ...add, declStart: add.declStart + 1000 };
  assert.throws(() => lib.assertOffsets(stale, ORIGINAL_SRC), /stale offsets/);
});

test("lib-go: spliceFunction replaces exactly the target function, leaving the rest of the file untouched", () => {
  const add = candidateFor("Add");
  lib.spliceFunction(add, "func Add(a, b int) int {\n\treturn b + a // swapped\n}");
  const onDisk = fs.readFileSync(path.join(SCRATCH, REL_FILE), "utf8");
  assert.ok(onDisk.includes("return b + a // swapped"));
  assert.ok(onDisk.includes("func Sub(a, b int) int {\n\treturn a - b\n}"), "Sub is untouched");
  assert.notEqual(onDisk, ORIGINAL_SRC);
  lib.restore(add);
});

test("lib-go: restore is byte-identical to the pristine original after a splice", () => {
  const add = candidateFor("Add");
  lib.spliceFunction(add, "func Add(a, b int) int {\n\treturn 0 // wrong on purpose\n}");
  lib.restore(add);
  const onDisk = fs.readFileSync(path.join(SCRATCH, REL_FILE), "utf8");
  assert.equal(onDisk, ORIGINAL_SRC);
});

test("lib-go: restore is idempotent — splice, restore, splice again, restore again all land byte-identical", () => {
  const add = candidateFor("Add");
  for (let i = 0; i < 3; i++) {
    lib.spliceFunction(add, `func Add(a, b int) int {\n\treturn ${i}\n}`);
    lib.restore(add);
    assert.equal(fs.readFileSync(path.join(SCRATCH, REL_FILE), "utf8"), ORIGINAL_SRC);
  }
});

test("lib-go: spliceFunction reindents continuation lines to the candidate's indent, leaving line 1 alone", () => {
  const add = candidateFor("Add");
  const genText = "func Add(a, b int) int {\nsum := a + b\nreturn sum\n}";
  lib.spliceFunction(add, genText);
  const onDisk = fs.readFileSync(path.join(SCRATCH, REL_FILE), "utf8");
  // Add's own indent is "" (top-level), so this is mostly a smoke check that
  // reindent doesn't corrupt content when indent is empty.
  assert.ok(onDisk.includes("sum := a + b"));
  assert.ok(onDisk.includes("return sum"));
  lib.restore(add);
});

test("lib-go: refreshCandidates re-derives offsets after the file shifts, keeping the id", () => {
  // A file readPristine has never touched, so the first read genuinely sees
  // the "sandbox has moved on" state — reusing pkg/foo.go here would instead
  // hit its already-warm pristine cache from the splice tests above and read
  // stale-relative-to-disk content, defeating the point of this test.
  const relFile2 = path.join(REPO, "pkg", "baz.go");
  const add = scanFunctions(ORIGINAL_SRC).find((f) => f.name === "Add");
  const cand = { id: `fixture-repo:${relFile2}:Add:${add.declStart}`, crate: REPO, file: relFile2, ...add };
  // The candidate's offsets were captured against ORIGINAL_SRC; the sandbox
  // has since gained a leading comment line, shifting every later offset.
  const shifted = "// a leading comment line that was not there before\n\n" + ORIGINAL_SRC;
  fs.writeFileSync(path.join(SCRATCH, relFile2), shifted);
  const { rows, refreshed, dropped } = lib.refreshCandidates([cand]);
  assert.equal(dropped.length, 0);
  assert.equal(refreshed, 1);
  assert.equal(rows[0].id, cand.id, "id is kept across a refresh");
  assert.notEqual(rows[0].declStart, add.declStart, "the offset actually moved");
  assert.equal(shifted.slice(rows[0].declStart, rows[0].declStart + 4), "func");
  assert.equal(shifted[rows[0].bodyOpen], "{");
  assert.equal(shifted[rows[0].bodyClose], "}");
});

test("lib-go: refreshCandidates drops a row whose function no longer exists, with a reason", () => {
  const add = candidateFor("Add");
  const cand = { id: "fixture-repo:pkg/foo.go:Gone:" + add.declStart, crate: REPO, file: REL_FILE, name: "Gone", implHeader: undefined, signature: "func Gone() int", declStart: 0, bodyOpen: 1, bodyClose: 2, indent: "" };
  const { rows, dropped } = lib.refreshCandidates([cand]);
  assert.equal(rows.length, 0);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].id, cand.id);
  assert.match(dropped[0].reason, /no function of that name/);
});
