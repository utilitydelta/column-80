// Implementer's tests for the v11 Python internals the blind oracle cannot see
// from the interface alone: the dark-site dedup/count helper (recordDarkSite),
// the memberSiteFor registry's TOTALITY over unknown languages, the rung-2 owned
// inserter over a stdlib-UNION-venv module universe (the seam the repair layer
// orchestrates in phase 4), the auto-import title matcher, and the
// signature-from-documentation fence-strip edge paths. Bundled headless exactly
// like the blind suite (nothing here imports vscode).
//
// Run: SKIP_LIVE=1 node --test test/impl-v11-pyinternals.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "impl-v11-pyinternals",
    `export { pyMemberSite, memberSiteFor, recordDarkSite, fimMemberSite } from "../src/core/fimInject";\n` +
      `export * as py from "../src/core/pyExtraction";\n`,
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".impl-v11-pyinternals.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".impl-v11-pyinternals.bundle.cjs"), { force: true });
  };
}
const { pyMemberSite, memberSiteFor, recordDarkSite, fimMemberSite, py = {} } = mod;
test.after(() => cleanup());

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip(`bundle failed: ${bundleError.message}`);
    return fn(ctx);
  });

test("bundle: the impl entry builds headless [invariant: entry compiles, no vscode]", () => {
  if (bundleError) assert.fail(`bundle failed: ${bundleError.message}`);
});

// ---------------------------------------------------------------------------
// recordDarkSite — dedup (firstSeen once per key) + distinct-site session count.
// ---------------------------------------------------------------------------

gtest("recordDarkSite: firstSeen is true exactly once per distinct key; sessionCount tracks DISTINCT sites [invariant: dedup + count]", () => {
  const seen = new Map();
  const a = "file:///x.py:12:4";
  const b = "file:///x.py:20:6";
  const why = "the receiver resolved to no members";
  const r1 = recordDarkSite(seen, a, why);
  assert.deepStrictEqual(r1, { firstSeen: true, sessionCount: 1 }, "first sighting of a is firstSeen, count 1");
  const r2 = recordDarkSite(seen, a, why);
  assert.deepStrictEqual(r2, { firstSeen: false, sessionCount: 1 }, "second sighting of a is deduped, count unchanged");
  const r3 = recordDarkSite(seen, b, why);
  assert.deepStrictEqual(r3, { firstSeen: true, sessionCount: 2 }, "a distinct site b is firstSeen, count 2");
  const r4 = recordDarkSite(seen, b, why);
  assert.deepStrictEqual(r4, { firstSeen: false, sessionCount: 2 }, "b deduped, count still 2");
});

gtest("recordDarkSite: many repeats of one site stay count 1 (the honest per-session summary) [invariant: idempotent per key]", () => {
  const seen = new Map();
  const key = "file:///a.py:1:1";
  let last;
  for (let i = 0; i < 10; i++) last = recordDarkSite(seen, key, "the receiver resolved to no members");
  assert.deepStrictEqual(last, { firstSeen: false, sessionCount: 1 }, "one site, seen ten times, is one distinct dark site");
});

gtest("recordDarkSite: a SECOND reason at the same site is reported, and the site is still one site [invariant: the first reason cannot silence the rest]", () => {
  const seen = new Map();
  const key = "file:///a.py:1:1";
  const slow = "the resolver did not answer inside the injection deadline";
  const empty = "the receiver resolved to no members";
  assert.deepStrictEqual(recordDarkSite(seen, key, slow), { firstSeen: true, sessionCount: 1 });
  assert.deepStrictEqual(
    recordDarkSite(seen, key, empty),
    { firstSeen: true, sessionCount: 1 },
    "one slow keystroke must not silence the site's real reason for the session",
  );
  assert.deepStrictEqual(recordDarkSite(seen, key, empty), { firstSeen: false, sessionCount: 1 }, "and a repeat is still once");
});

// ---------------------------------------------------------------------------
// memberSiteFor — totality: EVERY language yields a concrete detector, and the
// non-python detector is byte-identical to the shared fimMemberSite.
// ---------------------------------------------------------------------------

gtest("memberSiteFor: TOTAL — python and every other id return a function (never undefined) [invariant: the registry is total]", () => {
  for (const id of ["python", "rust", "csharp", "typescript", "go", "", "not-a-language"]) {
    assert.strictEqual(typeof memberSiteFor(id), "function", `memberSiteFor(${JSON.stringify(id)}) is a detector`);
  }
});

gtest("memberSiteFor(non-python) is byte-identical to fimMemberSite across `::`/`.`/comment/float cases [invariant: no prompt-byte drift for the C-family]", () => {
  const detect = memberSiteFor("rust");
  const CASES = ["Type::", "std::string", "foo.", "foo.ba", "1.", "// x.y", "arr[0].", "", "user..", "0.."];
  for (const p of CASES) {
    assert.deepStrictEqual(detect(p), fimMemberSite(p), `[${JSON.stringify(p)}] the C-family detector delegates verbatim`);
  }
});

gtest("memberSiteFor('python') darkens `::` where the C-family fires it (the F2 contrast) [invariant: F2 is python-scoped]", () => {
  assert.strictEqual(memberSiteFor("python")("std::"), undefined, "python: `::` dark");
  assert.deepStrictEqual(memberSiteFor("rust")("std::"), { partial: "" }, "rust: `::` fires");
});

// ---------------------------------------------------------------------------
// pyMemberSite — extra edge cases the blind list did not enumerate.
// ---------------------------------------------------------------------------

const PY_MEMBER_EXTRA = [
  ["kwarg default is not a member site", "def f(x=", undefined],
  ["attribute after a dict subscript", 'cfg["k"].', { partial: "" }],
  ["partial after chained call", "a.b().c", { partial: "c" }],
  ["ellipsis literal is dark", "...", undefined],
  ["decorator dot IS a member site", "@app.", { partial: "" }],
  ["hex-then-dot is a float-shaped dark (digit before dot)", "0x1.", undefined],
];

gtest("pyMemberSite: extra member/dark edge cases [invariant: `.`-only, digit-before-dot dark]", () => {
  for (const [name, prefix, expected] of PY_MEMBER_EXTRA) {
    assert.deepStrictEqual(pyMemberSite(prefix), expected, `[${name}] ${JSON.stringify(prefix)}`);
  }
});

// ---------------------------------------------------------------------------
// pyOwnedImportEdit + PY_STDLIB_MODULES — the rung-2 mechanism the repair layer
// composes over PY_STDLIB_MODULES UNION the venv catalog (phase 4). Here we drive
// the union directly to prove the single-hit / no-hit / collision contract.
// ---------------------------------------------------------------------------

gtest("pyOwnedImportEdit over PY_STDLIB ∪ venv: a stdlib name resolves to `import <name>` [invariant: rung-2 single hit]", () => {
  const stdlib = [...py.PY_STDLIB_MODULES];
  const universe = [...stdlib, "numpy", "pandas"]; // venv top-levels unioned in
  // A PLAIN file (no prologue) genuinely inserts at line 0.
  const edit = py.pyOwnedImportEdit("json", universe, "x = 1\n");
  assert.ok(edit, "a known stdlib top-level resolves");
  assert.strictEqual(edit.newText, "import json\n");
  assert.deepStrictEqual(edit.range, { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, "plain file -> line 0");
  const venvEdit = py.pyOwnedImportEdit("numpy", universe, "x = 1\n");
  assert.ok(venvEdit && venvEdit.newText === "import numpy\n", "a venv top-level resolves the same way");
});

gtest("pyOwnedImportEdit places the import PAST the module prologue [invariant: never before __future__/docstring/shebang]", () => {
  const universe = ["numpy"];
  const lineOf = (fileText) => py.pyOwnedImportEdit("numpy", universe, fileText).range.startLine;
  // __future__: the import must land AFTER it (before it is a hard SyntaxError).
  assert.strictEqual(lineOf("from __future__ import annotations\n\nx = 1\n"), 1, "after the __future__ line");
  // A parenthesized multi-line __future__ block: past its closing line.
  assert.strictEqual(lineOf("from __future__ import (\n    annotations,\n    division,\n)\ncode()\n"), 4, "after the multi-line __future__ block");
  // A module docstring must stay the first statement (an import before demotes it).
  assert.strictEqual(lineOf('"""Module doc."""\n\nx = 1\n'), 1, "after a single-line docstring");
  assert.strictEqual(lineOf('"""\nMulti-line\ndoc.\n"""\ncode()\n'), 4, "after a multi-line triple-quoted docstring");
  // Shebang stays on line 0.
  assert.strictEqual(lineOf("#!/usr/bin/env python3\nx = 1\n"), 1, "after the shebang");
  // Shebang + docstring + __future__ stacked: past all three.
  assert.strictEqual(
    lineOf('#!/usr/bin/env python3\n"""Doc."""\nfrom __future__ import annotations\ncode()\n'),
    3,
    "past shebang + docstring + __future__ together",
  );
});

gtest("pyOwnedImportEdit: a symbol-level name (not a top-level module) is dark — those are rungs 1/3 [invariant: module-name-only]", () => {
  const universe = [...py.PY_STDLIB_MODULES, "numpy"];
  assert.strictEqual(py.pyOwnedImportEdit("Path", universe), undefined, "`Path` is a symbol in pathlib, not a top-level module");
  assert.strictEqual(py.pyOwnedImportEdit("BaseModel", universe), undefined, "`BaseModel` is a pydantic symbol, not a top-level module");
});

gtest("pyOwnedImportEdit: a name provided by two DISTINCT sources (collision, undeduped) is ambiguous -> undefined [invariant: never pick one]", () => {
  assert.strictEqual(py.pyOwnedImportEdit("json", ["os", "json", "sys", "json"]), undefined, "duplicated -> ambiguous");
});

// ---------------------------------------------------------------------------
// isPyAutoImportTitle — the rung-3 title matcher (distinct-title ambiguity).
// ---------------------------------------------------------------------------

const TITLE_CASES = [
  ['Add "from models import SpecialThing"', true],
  ['Add "import numpy"', true],
  ['Add "from a.b.c import D"', true],
  ["Create function", false],
  ['Add "# type: ignore"', false],
  ["Add import for SpecialThing", false], // no quoted import statement
  ["", false],
];

gtest("isPyAutoImportTitle: matches Pylance auto-import titles, rejects other actions [invariant: rung-3 title match]", () => {
  for (const [title, expected] of TITLE_CASES) {
    assert.strictEqual(py.isPyAutoImportTitle(title), expected, `[${JSON.stringify(title)}]`);
  }
});

// ---------------------------------------------------------------------------
// pySignatureFromDocumentation — the fence-strip: the ```python marker must NEVER
// leak (the C# green-but-wrong defect), multi-line signatures survive, a bare
// object form is accepted, no fence -> undefined.
// ---------------------------------------------------------------------------

gtest("pySignatureFromDocumentation: strips the fence marker; multi-line survives; string OR {value} accepted; no fence -> undefined [invariant: no ``` leak]", () => {
  const doc = "```python\ndef f(\n    a: int,\n) -> str\n```\n---\nprose";
  const asString = py.pySignatureFromDocumentation(doc);
  assert.ok(asString.startsWith("def f("), "signature from the fence body");
  assert.ok(!asString.includes("```"), "no fence marker leaks");
  assert.ok(asString.includes("a: int") && asString.includes("-> str"), "multi-line fence body preserved");
  const asObject = py.pySignatureFromDocumentation({ kind: "markdown", value: doc });
  assert.strictEqual(asObject, asString, "a MarkupContent object reads identically to the raw string");
  assert.strictEqual(py.pySignatureFromDocumentation("just prose, no fence"), undefined, "no fence -> undefined");
  assert.strictEqual(py.pySignatureFromDocumentation(undefined), undefined, "no documentation -> undefined");
});

gtest("parsePyDoctest: `...` continuation lines are kept, prompt markers stripped, blank ends the run [invariant: doctest run extraction]", () => {
  const snip = py.parsePyDoctest("Prose.\n\n>>> x = f(\n...     1,\n... )\n>>> x.g()\n'ok'\n\n>>> ignored_second_block");
  assert.ok(snip.includes("x = f(") && snip.includes("1,") && snip.includes("x.g()") && snip.includes("'ok'"), `first run captured, got ${JSON.stringify(snip)}`);
  assert.ok(!/^>>>/m.test(snip) && !/^\.\.\./m.test(snip), "both `>>>` and `...` markers stripped");
  assert.ok(!snip.includes("ignored_second_block"), "the blank line terminates the first run (multi-block: first only)");
});
