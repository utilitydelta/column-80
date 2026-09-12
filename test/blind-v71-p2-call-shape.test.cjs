// Blind oracle for session-v71 phase 2, item B: a test call is known by its
// ARGUMENTS [session-v68/contracts/P8-bare-reply.md amendment 5, rules 11 and
// 12; session-v71/goal.md item B]. Written from the contract text and from
// TypeScript/JavaScript grammar, WITHOUT READING ANYTHING UNDER src/**. The
// only things taken from that tree are the two exported signatures, which the
// contract states verbatim.
//
// Surface exercised, both through the public seam:
//   extractTestFunctions(reply, languageId)  ../src/core/instructPostprocess
//   extractTestModule(reply)                 ../src/core/instructPostprocess
//
// What this file is for. `TEST_FUNCTION_SHAPES.typescript` was a NAME pattern,
// `\b(?:it|test)\s*(?:\.\w+)?\s*\(`, and `\b` holds after a dot. So a plain
// implementation whose only test-shaped token is `RE.test(s)` read as a test
// file on the fenced path, and the bare path's `(?<![.$])` patch refused that
// AND refused every runner that spells its entry point on a namespace. One
// reply, two answers: rule 5 broken. Amendment 5 replaces both with one rule
// keyed on the ARGUMENT SHAPE - a string or template literal, a comma, a
// function - and deletes the bare gate, so rule 12 restores one answer.
//
// The rows below enumerate: every runner amendment 5 names, every second
// argument spelling it names, every title spelling it names, the refusals it
// claims, the two limits it declares, the cost it measured, and a differential
// against BOTH pinned commits so that the fenced move rule 1 authorises is
// bounded to exactly the direction the goal predicts.
//
// EXPECTED RED: the fix is being written in parallel with this file. A failing
// assert here is a contract finding, not a harness fault. A bundling crash IS
// a harness fault, which is why the bundle rows are separate and loud and
// everything else skips behind them.
//
// Run: SKIP_LIVE=1 node --test test/blind-v71-p2-call-shape.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Facade 1: the working tree.
// ===========================================================================

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind71p2",
    `export { extractTestModule, extractTestFunctions } from "../src/core/instructPostprocess";\n`
  ));
} catch (e) {
  bundleError = e;
}

// ===========================================================================
// Facades 2 and 3: the two pinned commits amendment 5 names. Both are
// COMMITS, never the `main` ref: a pull-request checkout has `origin/main` and
// no local `main`, and once this branch merges `main` IS this code, so a
// differential against the ref would compare the new rule with itself.
//
//   1fb757f - 3.5.0, the S35 measurement baseline, pre-session-v70.
//   a81e986 - 3.5.1, the shipped code this rule moves off.
//
// Amendment 5 asks for the move to be named against BOTH.
// ===========================================================================

const REPO = path.join(__dirname, "..");

const FACADE_REFS = [
  { tag: "3.5.0", ref: "1fb757f415b7dd1f9f956d0b761dfbcd78750ebb" },
  { tag: "3.5.1", ref: "a81e986b962babed74333da0a1705149f4139923" },
];

const facades = [];
let facadeError;
try {
  for (const { tag, ref } of FACADE_REFS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `c80-v71p2-${tag.replace(/\./g, "")}-`));
    const tar = execFileSync("git", ["-C", REPO, "archive", ref, "src"], {
      maxBuffer: 256 * 1024 * 1024,
    });
    execFileSync("tar", ["-x", "-C", dir], { input: tar });
    const entry = path.join(dir, "src", "core", "instructPostprocess");
    const built = bundleCore(
      `blind71p2f${tag.replace(/\./g, "")}`,
      `export { extractTestModule, extractTestFunctions } from ${JSON.stringify(entry)};\n`
    );
    facades.push({ tag, ref, dir, mod: built.mod, cleanup: built.cleanup });
  }
} catch (e) {
  facadeError = e;
}

test.after(() => {
  cleanup();
  for (const f of facades) {
    try {
      f.cleanup();
    } catch {}
    try {
      fs.rmSync(f.dir, { recursive: true, force: true });
    } catch {}
  }
});

const { extractTestModule, extractTestFunctions } = mod;

// Every row except the bundle rows skips while a facade is broken, so a
// harness break stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("the working-tree bundle failed to build; see row 1");
    return fn(ctx);
  });

const dtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError || facadeError) return ctx.skip("a facade failed to build; see rows 1 and 2");
    return fn(ctx);
  });

test("[BLIND-V71-P2 1] bundle: the working-tree surface builds and exports both extractors", () => {
  assert.strictEqual(
    bundleError,
    undefined,
    `the bundle failed, so every row below is a harness error rather than a finding: ${bundleError}`
  );
  assert.strictEqual(
    typeof extractTestFunctions,
    "function",
    "extractTestFunctions(reply, languageId) => { text, testCount } | undefined"
  );
  assert.strictEqual(
    typeof extractTestModule,
    "function",
    "extractTestModule(reply) => { text, testCount } | undefined"
  );
});

test("[BLIND-V71-P2 2] bundle: both pinned facades (3.5.0 and 3.5.1) build, so the differentials can run", () => {
  assert.strictEqual(
    facadeError,
    undefined,
    `a pinned commit could not be extracted or bundled, so every differential row is a harness error rather than a finding: ${facadeError}`
  );
  assert.strictEqual(facades.length, 2, "amendment 5 names two baselines: 1fb757f and a81e986");
  for (const f of facades) {
    assert.strictEqual(typeof f.mod.extractTestFunctions, "function", `${f.tag} has no extractTestFunctions`);
    assert.strictEqual(typeof f.mod.extractTestModule, "function", `${f.tag} has no extractTestModule`);
  }
});

// ===========================================================================
// Helpers.
// ===========================================================================

const L = (...lines) => lines.join("\n");
const BT = "`"; // one backtick, so the fixtures stay readable in a .cjs file
const FENCE = "```";
const fencedOf = (tag, body) => `${FENCE}${tag}\n${body}\n${FENCE}\n`;

const j = (res) => (res === undefined ? "undefined" : JSON.stringify({ testCount: res.testCount }));

const show = (label, reply, res) =>
  `${label}\n---- REPLY ----\n${reply}\n---- END REPLY ----\n` +
  `---- RESULT ----\n${res === undefined ? "undefined" : JSON.stringify(res, null, 2)}\n---- END RESULT ----`;

const tsIds = ["typescript", "typescriptreact", "javascript", "javascriptreact"];

// ===========================================================================
// Rule 11, the ADMIT side. Every runner amendment 5 names, every second
// argument spelling, every title spelling. Each carries a HAND count: the
// number of test calls a human reads in the fixture. A hand count is the right
// expectation here precisely because the old behaviour is what is being
// changed, so a captured baseline would capture the defect.
//
// `bareNote` marks a fixture that a bare reply refuses for a reason that is
// NOT the count. There is exactly one, and it is rule 9's tail gate.
// ===========================================================================

const ADMIT = [];
const admit = (kind, name, count, body, bareNote) => ADMIT.push({ kind, name, count, body, bareNote });

// -- the runners amendment 5 names -----------------------------------------

admit("runner", "it(", 2, L(
  'it("adds two positives", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});",
  "",
  'it("adds zero", () => {',
  "  expect(add(0, 0)).toBe(0);",
  "});"
));

admit("runner", "test(", 2, L(
  'test("adds two positives", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});",
  "",
  'test("adds zero", () => {',
  "  expect(add(0, 0)).toBe(0);",
  "});"
));

admit("runner", "it.only(", 1, L(
  'it.only("adds two positives", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});"
));

admit("runner", "it.skip(", 1, L(
  'it.skip("adds two positives", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});"
));

admit("runner", "it.concurrent(", 1, L(
  'it.concurrent("awaits the fetch", async () => {',
  "  expect(await fetchOne()).toBe(7);",
  "});"
));

// Amendment 5: "it.each([[1, 2]])(\"adds %i\", (a, b) => …) answers on the
// SECOND group, so every group in the chain is asked and not only the first."
admit("runner", "it.each([...])( - the chain answers on the second group", 1, L(
  "it.each([",
  "  [1, 2, 3],",
  "  [0, 0, 0],",
  '])("adds %i and %i", (a, b, want) => {',
  "  expect(add(a, b)).toBe(want);",
  "});"
));

admit("runner", "test.each`table`( - a tagged template between the name and the call", 1, L(
  "test.each" + BT,
  "  a    | b    | want",
  "  ${1} | ${2} | ${3}",
  "  ${0} | ${0} | ${0}",
  BT + '("adds $a + $b", ({ a, b, want }) => {',
  "  expect(add(a, b)).toBe(want);",
  "});"
));

admit("runner", "Deno.test( - the namespaced runner the (?<![.$]) gate refused bare", 2, L(
  'Deno.test("adds two positives", () => {',
  "  assertEquals(add(1, 2), 3);",
  "});",
  "",
  'Deno.test("adds zero", () => {',
  "  assertEquals(add(0, 0), 0);",
  "});"
));

admit("runner", "QUnit.test( - a parenthesised single-parameter arrow", 1, L(
  'QUnit.test("adds two positives", (assert) => {',
  "  assert.equal(add(1, 2), 3);",
  "});"
));

admit("runner", "t.test( - a one-letter namespace", 2, L(
  't.test("adds two positives", (t) => {',
  "  t.equal(add(1, 2), 3);",
  "});",
  "",
  't.test("adds zero", (t) => {',
  "  t.equal(add(0, 0), 0);",
  "});"
));

// -- the second-argument spellings amendment 5 names ------------------------

admit("arg", "() =>", 1, L(
  'it("adds two positives", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});"
));

admit("arg", "async () =>", 1, L(
  'it("awaits the fetch", async () => {',
  "  expect(await fetchOne()).toBe(7);",
  "});"
));

admit("arg", "function () {}", 1, L(
  'it("adds two positives", function () {',
  "  expect(add(1, 2)).toBe(3);",
  "});"
));

admit("arg", "async function () {}", 1, L(
  'it("awaits the fetch", async function () {',
  "  expect(await fetchOne()).toBe(7);",
  "});"
));

admit("arg", "a bare-parameter arrow, done => {}", 1, L(
  'it("calls back", done => {',
  "  run(() => done());",
  "});"
));

admit("arg", "a destructured-parameter arrow, ({ a, b }) => {}", 1, L(
  'it.each([{ a: 1, b: 2 }])("adds the fields", ({ a, b }) => {',
  "  expect(add(a, b)).toBe(3);",
  "});"
));

admit("arg", "a typed arrow, async (): Promise<void> =>", 1, L(
  'it("awaits the fetch", async (): Promise<void> => {',
  "  expect(await fetchOne()).toBe(7);",
  "});"
));

admit("arg", "a third timeout argument, with a plain test after it", 2, L(
  'it("is slow", async () => {',
  "  expect(await slow()).toBe(1);",
  "}, 10000);",
  "",
  'it("is fast", () => {',
  "  expect(fast()).toBe(1);",
  "});"
));

// The same third argument LAST in the reply. Rule 9 reads the tail only and
// wants nothing but closing delimiters, `;` and `,` on the last non-blank
// line; `}, 10000);` carries a number. So this one is refused BARE for a
// rule 9 reason, not a count reason, and its rule 12 row says so.
admit(
  "arg",
  "a third timeout argument on the LAST call",
  1,
  L('it("is slow", async () => {', "  expect(await slow()).toBe(1);", "}, 10000);"),
  "rule 9: the last non-blank line is `}, 10000);`, which carries a number, so the tail gate refuses it bare. Not a count disagreement."
);

// -- the title spellings amendment 5 names ----------------------------------

admit("title", 'a double-quoted title', 1, L(
  'it("adds two positives", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});"
));

admit("title", "a single-quoted title", 1, L(
  "it('adds two positives', () => {",
  "  expect(add(1, 2)).toBe(3);",
  "});"
));

admit("title", "a template-literal title", 1, L(
  "it(" + BT + "adds two positives" + BT + ", () => {",
  "  expect(add(1, 2)).toBe(3);",
  "});"
));

admit("title", "a template-literal title with an interpolation", 1, L(
  "it(" + BT + "adds ${1} and ${2}" + BT + ", () => {",
  "  expect(add(1, 2)).toBe(3);",
  "});"
));

admit("title", "a title containing a comma", 1, L(
  'it("adds 1, 2 and gets 3", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});"
));

// The sharp title. A rule that finds the comma by scanning for the first `,`
// or the function by scanning for the first `=>` reads this title as the
// argument boundary and answers wrong.
admit("title", "a title containing ) =>", 1, L(
  'it("rejects a bare ) => written in prose", () => {',
  "  expect(parse(\"bad\")).toBeNull();",
  "});"
));

admit("title", "a title containing an escaped double quote", 1, L(
  'it("adds \\"one\\" and two", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});"
));

admit("title", "a single-quoted title containing an escaped apostrophe", 1, L(
  "it('it\\'s additive', () => {",
  "  expect(add(1, 2)).toBe(3);",
  "});"
));

// A real test whose BODY calls a regex `.test(`. The old name pattern counted
// two here: the `it(` head and the `re.test(` call. Rule 11 counts one,
// because `re.test("alpha-1")` takes a string and then a `)`, never a comma
// and a function. This is the count row the goal's false-admit direction
// implies for a reply that is genuinely tests.
admit("mixed", "a real test whose body calls re.test( on a string", 1, L(
  'it("matches the id pattern", () => {',
  "  const re = /^[a-z]+-\\d+$/;",
  '  expect(re.test("alpha-1")).toBe(true);',
  "});"
));

admit("mixed", "two real tests, one of which calls RE.test( twice", 2, L(
  "const RE = /^[a-z-]+$/;",
  "",
  'it("accepts a slug", () => {',
  '  expect(RE.test("a-b")).toBe(true);',
  "});",
  "",
  'it("rejects a shout", () => {',
  '  expect(RE.test("A_B")).toBe(false);',
  "});"
));

// ===========================================================================
// Rule 11, the REFUSE side. Every one of these is written MULTI-LINE and
// closes on a line that is nothing but a `}`, so rule 9's tail gate is
// satisfied and the refusal has to come from the count. A one-liner would be
// refused bare by rule 9 whatever the count did, and would prove nothing.
// The goal's own one-liner is kept as its own row and labelled.
// ===========================================================================

const REFUSE = [];
const refuse = (name, body, note) => REFUSE.push({ name, body, note });

refuse("goal item B's implementation, multi-line so the tail gate is satisfied", L(
  "export function isSlug(s: string) {",
  "  return /^[a-z-]+$/.test(s);",
  "}"
));

refuse(
  "goal item B's implementation exactly as written, on one line",
  "export function isSlug(s: string) { return /^[a-z-]+$/.test(s); }",
  "bare is also refused by rule 9 (a module on one line), so only the FENCED half of this row is evidence about rule 11"
);

refuse("a bare RE.test(input) on a named regex", L(
  "const RE = /^[a-z-]+$/;",
  "",
  "export function isSlug(input: string): boolean {",
  "  return RE.test(input);",
  "}"
));

refuse("function test(value: string): boolean - the declaration site, S70-11", L(
  "export function test(value: string): boolean {",
  "  return value.length > 0;",
  "}"
));

refuse("`it` and `test` as ordinary variables", L(
  "const it = rows[Symbol.iterator]();",
  "const test = buildPredicate(pattern);",
  "",
  "export function firstMatch(rows: string[]) {",
  "  return rows.find((row) => test(row));",
  "}"
));

// THE SHARPEST ROW. A title check on its own admits this: the argument IS a
// template literal. Only the second half of rule 11 - a comma and then a
// function - refuses it.
refuse("RE.test(`abc`) - a template-literal argument with no function after it", L(
  "const RE = /^[a-z-]+$/;",
  "",
  "export function looksSlugLike(): boolean {",
  "  return RE.test(" + BT + "abc" + BT + ");",
  "}"
));

refuse('RE.test("abc") - a string-literal argument with no function after it', L(
  "const RE = /^[a-z-]+$/;",
  "",
  "export function looksSlugLike(): boolean {",
  '  return RE.test("abc");',
  "}"
));

refuse("an implementation whose only test-shaped token is an inline regex .test(", L(
  "export function classify(input: string): string {",
  "  if (/^\\d+$/.test(input)) {",
  '    return "number";',
  "  }",
  '  return "text";',
  "}"
));

// ===========================================================================
// The two limits amendment 5 DECLARES, both in the refusing direction. These
// rows exist so that a later widening is visible: if one of them turns red,
// the rule got wider than the contract says and the contract needs rewriting
// beside the code.
// ===========================================================================

const LIMITS = [];
const limitRow = (name, body, why) => LIMITS.push({ name, body, why });

limitRow(
  'it(name, () => {}) with the title in a variable',
  L(
    'const name = "adds two positives";',
    "",
    "it(name, () => {",
    "  expect(add(1, 2)).toBe(3);",
    "});"
  ),
  "amendment 5, declared limits: \"it(name, () => {}) with the title in a variable is not counted\". Accepting any first argument is the false admit rule 11 exists to close, and a refusal costs a re-run."
);

limitRow(
  "Deno.test({ name, fn }) - the object form",
  L(
    "Deno.test({",
    '  name: "adds two positives",',
    "  fn: () => {",
    "    assertEquals(add(1, 2), 3);",
    "  },",
    "});"
  ),
  "amendment 5, declared limits: \"Deno's object form, Deno.test({ name: \\\"x\\\", fn: () => {} }), is not counted\"."
);

// ===========================================================================
// A CONSEQUENCE of rule 11, argued rather than discovered. Rule 11 keys on the
// ARGUMENTS and amendment 5 admits `t.test(`, a one-letter namespace. There is
// no way to admit `t.test("x", fn)` and refuse `anything.test("x", fn)`
// without a name allowlist, and rule 11 names no allowlist. So the row below
// must be ADMITTED for the rule to be self-consistent. If it is red, the
// implementation carries a namespace allowlist that the contract does not, and
// the contract needs that allowlist written into rule 11.
// ===========================================================================

const CONSEQUENCE_BODY = L(
  'harness.test("adds two positives", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});"
);

// ===========================================================================
// Rows 3..n: rule 11 ADMIT, fenced and bare, against the hand count.
// ===========================================================================

let n = 2;
const row = () => ++n;

for (const f of ADMIT) {
  const label = `[BLIND-V71-P2 ${row()}] rule 11 ADMIT (${f.kind}) ${f.name}`;
  gtest(`${label}: FENCED counts ${f.count}`, () => {
    const reply = fencedOf("typescript", f.body);
    const res = extractTestFunctions(reply, "typescript");
    assert.notStrictEqual(
      res,
      undefined,
      show(`${label} FENCED: the reply is nothing but test calls and it was refused outright`, reply, res)
    );
    assert.strictEqual(
      res.testCount,
      f.count,
      show(
        `${label} FENCED: rule 11 reads a test call as a name (it|test) plus an optional member/call chain, a string or template first argument, a comma, and a function. A human counts ${f.count} such calls here`,
        reply,
        res
      )
    );
  });
}

for (const f of ADMIT) {
  const label = `[BLIND-V71-P2 ${row()}] rule 11 ADMIT (${f.kind}) ${f.name}`;
  gtest(`${label}: BARE counts ${f.count}${f.bareNote ? " [rule 9 exception]" : ""}`, () => {
    const res = extractTestFunctions(f.body, "typescript");
    if (f.bareNote) {
      assert.strictEqual(
        res,
        undefined,
        show(`${label} BARE: ${f.bareNote} If this admits, the tail gate widened and rule 9 needs rewriting`, f.body, res)
      );
      return;
    }
    assert.notStrictEqual(
      res,
      undefined,
      show(
        `${label} BARE: rule 12 deletes BARE_TEST_FUNCTION_SHAPES, so the bare path runs the same rule 11 as the fenced one. This reply is balanced and closes on a delimiter line, so rules 3 and 9 are satisfied and the refusal can only be the count`,
        f.body,
        res
      )
    );
    assert.strictEqual(
      res.testCount,
      f.count,
      show(`${label} BARE: a human counts ${f.count} test calls here`, f.body, res)
    );
  });
}

// ===========================================================================
// Rule 11 REFUSE, fenced and bare.
// ===========================================================================

for (const f of REFUSE) {
  const label = `[BLIND-V71-P2 ${row()}] rule 11 REFUSE ${f.name}`;
  gtest(`${label}: FENCED and BARE both undefined`, () => {
    const reply = fencedOf("typescript", f.body);
    const fenced = extractTestFunctions(reply, "typescript");
    assert.strictEqual(
      fenced,
      undefined,
      show(
        `${label} FENCED: this is an implementation, not a test file. Rule 11 refuses it because its only test-shaped call takes an identifier, a lone literal, or a parameter list, never a literal followed by a comma and a function. This is the FALSE ADMIT direction goal item B names: the human's own implementation gets written into their test file${f.note ? ". NOTE: " + f.note : ""}`,
        reply,
        fenced
      )
    );
    const bare = extractTestFunctions(f.body, "typescript");
    assert.strictEqual(
      bare,
      undefined,
      show(`${label} BARE: same reply, no fence, same refusal${f.note ? ". NOTE: " + f.note : ""}`, f.body, bare)
    );
  });
}

// ===========================================================================
// The declared limits.
// ===========================================================================

for (const f of LIMITS) {
  const label = `[BLIND-V71-P2 ${row()}] DECLARED LIMIT ${f.name}`;
  gtest(`${label}: refused, fenced and bare`, () => {
    for (const [pathName, reply] of [
      ["FENCED", fencedOf("typescript", f.body)],
      ["BARE", f.body],
    ]) {
      const res = extractTestFunctions(reply, pathName === "FENCED" ? "typescript" : "typescript");
      assert.strictEqual(
        res,
        undefined,
        show(
          `${label} ${pathName}: this row asserts a DECLARED LIMIT, not a defect. ${f.why} If this row is RED the rule widened past the contract, and the widening has to be written into amendment 5 rather than left in the code`,
          reply,
          res
        )
      );
    }
  });
}

// ===========================================================================
// The consequence row.
// ===========================================================================

{
  const label = `[BLIND-V71-P2 ${row()}] rule 11 CONSEQUENCE an unknown namespace with a runner's argument shape`;
  gtest(`${label}: admitted, because rule 11 names no allowlist`, () => {
    const reply = fencedOf("typescript", CONSEQUENCE_BODY);
    const res = extractTestFunctions(reply, "typescript");
    assert.notStrictEqual(
      res,
      undefined,
      show(
        `${label}: amendment 5 admits t.test( - a one-letter namespace - and keys the whole rule on the ARGUMENTS. There is no way to admit t.test("x", fn) and refuse harness.test("x", fn) without an allowlist of namespaces, and rule 11 names none. A RED row here means the implementation carries an allowlist the contract does not, and the allowlist belongs in rule 11`,
        reply,
        res
      )
    );
    assert.strictEqual(res.testCount, 1, show(`${label}: one test call`, reply, res));
  });
}

// ===========================================================================
// Rule 12, the bare/fenced consistency, as ONE property over every fixture
// this file owns. Rule 5 says a bare and a fenced copy of the same tests
// return the same count; amendment 5 restores it for the three dotted runners
// by deleting the separate bare gate. A rule that is fixed on one path and not
// the other cannot pass this row.
// ===========================================================================

gtest(`[BLIND-V71-P2 ${row()}] rule 12: every fixture in this file answers the same bare as it does fenced`, () => {
  const rows = [
    ...ADMIT.map((f) => ({ name: `ADMIT ${f.name}`, body: f.body, bareNote: f.bareNote })),
    ...REFUSE.map((f) => ({ name: `REFUSE ${f.name}`, body: f.body, bareNote: f.note })),
    ...LIMITS.map((f) => ({ name: `LIMIT ${f.name}`, body: f.body })),
    { name: "CONSEQUENCE an unknown namespace", body: CONSEQUENCE_BODY },
  ];

  const disagreed = [];
  const excused = [];
  for (const r of rows) {
    const fenced = extractTestFunctions(fencedOf("typescript", r.body), "typescript");
    const bare = extractTestFunctions(r.body, "typescript");
    const same =
      (fenced === undefined && bare === undefined) ||
      (fenced !== undefined && bare !== undefined && fenced.testCount === bare.testCount);
    if (same) continue;
    if (r.bareNote) {
      excused.push(`${r.name}: fenced ${j(fenced)}, bare ${j(bare)} - excused, ${r.bareNote}`);
      continue;
    }
    disagreed.push(`---- ${r.name} ----\n${r.body}\n  fenced: ${j(fenced)}\n  bare:   ${j(bare)}`);
  }

  assert.strictEqual(
    disagreed.length,
    0,
    `[BLIND-V71-P2] ${disagreed.length} of ${rows.length} fixtures answered differently bare than fenced. Rule 5 says a bare and a fenced copy of one reply return the same count, and rule 12 restores that by deleting BARE_TEST_FUNCTION_SHAPES so one rule serves both paths. The dotted runners (Deno.test, QUnit.test, t.test) are the ones S70-10 recorded as split.` +
      (excused.length ? `\n\nEXCUSED (refused bare for a reason that is not the count):\n${excused.join("\n")}` : "") +
      `\n\n${disagreed.join("\n\n")}`
  );
});

// The four TypeScript-family ids share one grammar. A rule keyed on the id has
// to give all four the same answer, or a .tsx file and a .ts file with
// identical tests are counted differently.
gtest(`[BLIND-V71-P2 ${row()}] rule 11: the four TS-family ids agree with each other, fenced and bare`, () => {
  const bodies = [...ADMIT.map((f) => f.body), ...REFUSE.map((f) => f.body)];
  for (const body of bodies) {
    const reply = fencedOf("typescript", body);
    const answers = tsIds.map((id) => ({
      id,
      fenced: extractTestFunctions(reply, id),
      bare: extractTestFunctions(body, id),
    }));
    const first = answers[0];
    for (const a of answers.slice(1)) {
      assert.strictEqual(
        j(a.fenced),
        j(first.fenced),
        `[BLIND-V71-P2] FENCED: ${a.id} answered ${j(a.fenced)} and ${first.id} answered ${j(first.fenced)} for the same source:\n${body}`
      );
      assert.strictEqual(
        j(a.bare),
        j(first.bare),
        `[BLIND-V71-P2] BARE: ${a.id} answered ${j(a.bare)} and ${first.id} answered ${j(first.bare)} for the same source:\n${body}`
      );
    }
  }
});

// ===========================================================================
// Rule 1, the DIFFERENTIAL, part 1: a clean fenced corpus that does not move.
//
// Rule 1 says a fenced reply behaves exactly as it does today. Amendment 5
// licenses ONE exception and names its direction: "only replies whose only
// `.test(` is a regex call or a `function test(` declaration move, and they
// move to refusal". So a corpus with NO `.test(` in it at all must not move a
// single byte, against EITHER pinned commit.
//
// The corpus is generated combinatorially rather than hand-written, because
// the value of this row is coverage of shapes, and 200 hand-written replies
// would all be the same reply.
// ===========================================================================

const CLEAN_RUNNERS = ["it", "test", "it.only", "it.skip", "it.concurrent"];
const CLEAN_TITLES = [
  '"adds two positives"',
  "'adds two positives'",
  BT + "adds two positives" + BT,
  '"adds 1, 2 and gets 3"',
  '"adds \\"one\\" and two"',
];
const CLEAN_FNS = ["() =>", "async () =>", "function ()", "(done) =>"];
const CLEAN_BODIES = [
  ["  expect(add(1, 2)).toBe(3);"],
  ["  const re = /^[a-z]+$/;", '  expect(re.source).toBe("^[a-z]+$");'],
  ["  // Ordinary English about the case, nothing a counter should key on.", "  expect(add(0, 0)).toBe(0);"],
  ["  const line = " + BT + "shard ${n} of 8" + BT + ";", '  expect(line).toContain("shard");'],
];

// 5 runners x 5 titles x 4 second arguments x 4 bodies = 400 replies, half of
// them wrapped in a `describe`. Generated rather than hand-written: the value
// of this row is coverage of shapes, and 200 hand-written replies would all be
// the same reply.
const CLEAN_TS = [];
for (const r of CLEAN_RUNNERS) {
  for (const t of CLEAN_TITLES) {
    for (const f of CLEAN_FNS) {
      for (const body of CLEAN_BODIES) {
        const one = L(`${r}(${t}, ${f} {`, ...body, "});");
        CLEAN_TS.push(
          CLEAN_TS.length % 2 === 0
            ? one
            : L('describe("the adder", () => {', ...one.split("\n").map((l) => "  " + l), "});")
        );
      }
    }
  }
}
// A handful of shapes the grid cannot reach.
CLEAN_TS.push(L(
  "it.each([",
  '  ["alpha", 8, 101],',
  '  ["beta", 16, 202],',
  '])("shardOf(%s, %i)", (key, buckets, want) => {',
  "  expect(shardOf(key, buckets)).toBe(want);",
  "});"
));
CLEAN_TS.push(L(
  "beforeEach(() => {",
  "  reset();",
  "});",
  "",
  'it("starts from zero", () => {',
  "  expect(counter()).toBe(0);",
  "});"
));
CLEAN_TS.push(L(
  'it("awaits and rejects", async (): Promise<void> => {',
  "  await expect(fetchOne(-1)).rejects.toThrow();",
  "});"
));
CLEAN_TS.push(L(
  'it("keeps braces inside a string", () => {',
  '  expect(render("{ }")).toBe("{ }");',
  "});"
));

const CLEAN_REGEX_ONLY = [];
{
  const patterns = [
    "/^[a-z-]+$/",
    "/^\\d+$/",
    "/^[A-Z][a-z]+$/",
    "/\\s+/g",
    "/^(?:alpha|beta)$/i",
    "/^[a-z]+-\\d+$/",
    "/[{}()\\[\\]]/",
    "/^#[0-9a-f]{6}$/i",
    "/^\\w+@\\w+\\.\\w{2,}$/",
    "/^\\/[a-z]+(?:\\/[a-z]+)*$/",
  ];
  const shapes = [
    (i, p) => L(`const RE_${i} = ${p};`, "", `export function match${i}(input: string): boolean {`, `  return RE_${i}.test(input);`, "}"),
    (i, p) => L(`export function match${i}(input: string): boolean {`, `  return ${p}.test(input);`, "}"),
    (i, p) => L(`export function match${i}(input: string): string {`, `  if (${p}.test(input.trim())) {`, '    return "yes";', "  }", '  return "no";', "}"),
    (i, p) => L(`const RE_${i} = ${p};`, "", `export const match${i} = (input: string): boolean => {`, `  return RE_${i}.test(input);`, "};"),
    (i, p) => L(`export function filter${i}(rows: string[]): string[] {`, `  const re = ${p};`, "  return rows.filter((row) => re.test(row));", "}"),
    (i, p) => L(
      `export class Matcher${i} {`,
      `  private readonly re = ${p};`,
      "",
      "  public accepts(input: string): boolean {",
      "    return this.re.test(input);",
      "  }",
      "}"
    ),
    (i, p) => L(
      `export function summarise${i}(rows: string[]): number {`,
      `  const re = ${p};`,
      "  let seen = 0;",
      "  for (const row of rows) {",
      "    if (re.test(row)) {",
      "      seen += 1;",
      "    }",
      "  }",
      "  return seen;",
      "}"
    ),
    (i, p) => L(`const RE_${i} = ${p};`, "", `export function reject${i}(input: string): boolean {`, `  return !RE_${i}.test(input);`, "}"),
    (i, p) => L(
      `export function normalise${i}(input: string): string {`,
      `  const re = ${p};`,
      "  return re.test(input) ? input.toLowerCase() : input;",
      "}"
    ),
    (i, p) => L(
      `export function pick${i}(input: string): string | undefined {`,
      `  const re = ${p};`,
      "  if (!re.test(input)) {",
      "    return undefined;",
      "  }",
      "  return input;",
      "}"
    ),
    (i, p) => L(
      `const RE_${i} = ${p};`,
      "",
      `export function looks${i}(input: string): boolean {`,
      `  return RE_${i}.test(` + BT + "${input}" + BT + ");",
      "}"
    ),
  ];
  for (let s = 0; s < shapes.length; s += 1) {
    for (let p = 0; p < patterns.length; p += 1) {
      CLEAN_REGEX_ONLY.push(shapes[s](s * patterns.length + p, patterns[p]));
    }
  }
}

gtest(`[BLIND-V71-P2 ${row()}] corpus sanity: the clean corpus carries no .test( and the regex corpus carries nothing else`, () => {
  assert.ok(CLEAN_TS.length >= 200, `the clean corpus has ${CLEAN_TS.length} replies; the phase brief wants at least 200`);
  const dirty = CLEAN_TS.filter((b) => b.includes(".test("));
  assert.strictEqual(
    dirty.length,
    0,
    `${dirty.length} of the ${CLEAN_TS.length} clean replies contain a ".test(", so they are not evidence about the no-move direction:\n${dirty.slice(0, 3).join("\n----\n")}`
  );

  assert.ok(
    CLEAN_REGEX_ONLY.length >= 100,
    `the regex corpus has ${CLEAN_REGEX_ONLY.length} replies; the phase brief wants at least 100`
  );
  const notRegexOnly = CLEAN_REGEX_ONLY.filter(
    (b) => !b.includes(".test(") || /(?:^|[^.\w])(?:it|test)\s*(?:\.\w+)?\s*\(/.test(b)
  );
  assert.strictEqual(
    notRegexOnly.length,
    0,
    `${notRegexOnly.length} regex-corpus replies either have no .test( or carry a real runner call, so a move there would not be attributable to rule 11:\n${notRegexOnly.slice(0, 3).join("\n----\n")}`
  );
});

for (const { tag } of FACADE_REFS) {
  dtest(`[BLIND-V71-P2 ${row()}] rule 1 differential vs ${tag}: a clean fenced corpus with no .test( does not move`, () => {
    const facade = facades.find((f) => f.tag === tag);
    const moved = [];
    for (const body of CLEAN_TS) {
      const reply = fencedOf("typescript", body);
      const now = extractTestFunctions(reply, "typescript");
      const before = facade.mod.extractTestFunctions(reply, "typescript");
      const same =
        (now === undefined && before === undefined) ||
        (now !== undefined && before !== undefined && now.text === before.text && now.testCount === before.testCount);
      if (!same) {
        moved.push(`---- ${tag} ----\n${reply}\n  ${tag}: ${j(before)}\n  now:   ${j(now)}`);
      }
    }
    assert.strictEqual(
      moved.length,
      0,
      `[BLIND-V71-P2] ${moved.length} of ${CLEAN_TS.length} clean fenced replies moved against ${tag} (${facade.ref}). NONE of them contains a ".test(" anywhere, so amendment 5's licence to move the fenced path - "only replies whose only .test( is a regex call or a function test( declaration move" - does not cover them. Rule 1 says a fenced reply behaves exactly as it does today.\n\n${moved.slice(0, 8).join("\n\n")}`
    );
  });
}

for (const { tag } of FACADE_REFS) {
  dtest(`[BLIND-V71-P2 ${row()}] rule 1 differential vs ${tag}: a regex-only corpus moves to REFUSAL and in no other direction`, () => {
    const facade = facades.find((f) => f.tag === tag);
    const wrongDirection = [];
    const stillAdmitted = [];
    let movedToRefusal = 0;
    let alreadyRefused = 0;

    for (const body of CLEAN_REGEX_ONLY) {
      const reply = fencedOf("typescript", body);
      const now = extractTestFunctions(reply, "typescript");
      const before = facade.mod.extractTestFunctions(reply, "typescript");

      if (before === undefined && now === undefined) {
        alreadyRefused += 1;
        continue;
      }
      if (before !== undefined && now === undefined) {
        movedToRefusal += 1;
        continue;
      }
      if (before === undefined && now !== undefined) {
        wrongDirection.push(`REFUSED->ADMITTED (${j(now)})\n${reply}`);
        continue;
      }
      // Both admitted. The only legal remainder is a count that fell; a count
      // that rose is a new false admit.
      if (now.testCount > before.testCount) {
        wrongDirection.push(`COUNT ROSE ${before.testCount} -> ${now.testCount}\n${reply}`);
      } else {
        stillAdmitted.push(`STILL ADMITTED ${tag} ${j(before)} -> now ${j(now)}\n${reply}`);
      }
    }

    assert.strictEqual(
      wrongDirection.length,
      0,
      `[BLIND-V71-P2] ${wrongDirection.length} of ${CLEAN_REGEX_ONLY.length} regex-only replies moved in a direction amendment 5 forbids against ${tag} (${facade.ref}). The predicted direction is one-way: to refusal.\n\n${wrongDirection.slice(0, 5).join("\n\n")}`
    );

    assert.strictEqual(
      stillAdmitted.length,
      0,
      `[BLIND-V71-P2] ${stillAdmitted.length} of ${CLEAN_REGEX_ONLY.length} regex-only replies are STILL admitted as test files. Each is an implementation whose only test-shaped call is a regex .test(, and admitting one writes the human's implementation into their test file - the false-admit direction goal item B exists to close. (${movedToRefusal} moved to refusal, ${alreadyRefused} were already refused on ${tag}.)\n\n${stillAdmitted.slice(0, 5).join("\n\n")}`
    );

    assert.ok(
      movedToRefusal > 0 || alreadyRefused === CLEAN_REGEX_ONLY.length,
      `[BLIND-V71-P2] nothing moved against ${tag}: ${movedToRefusal} to refusal, ${alreadyRefused} already refused, out of ${CLEAN_REGEX_ONLY.length}. Amendment 5 predicts these replies WERE admitted on both pinned commits, so a zero here is a fact about the corpus, not about the fix`
    );
  });
}

// ===========================================================================
// Rule 8 / scope: amendment 5 is a TypeScript rule. Go, Python, C# and Rust
// must not move against either pinned commit. A per-language pattern table is
// exactly the kind of thing a "one rule, both paths" rewrite reaches into by
// accident.
// ===========================================================================

const OTHER = [];
const other = (id, fence, body) => OTHER.push({ id, fence, body });

other("go", "go", L(
  "func TestAddPositive(t *testing.T) {",
  "\tif got := Add(1, 2); got != 3 {",
  '\t\tt.Errorf("Add(1, 2) = %v, want 3", got)',
  "\t}",
  "}",
  "",
  "func TestAddZero(t *testing.T) {",
  "\tif got := Add(0, 0); got != 0 {",
  '\t\tt.Errorf("Add(0, 0) = %v, want 0", got)',
  "\t}",
  "}"
));
other("go", "go", L(
  "func TestShardOf(t *testing.T) {",
  '\tfor _, name := range []string{"alpha", "beta"} {',
  "\t\tt.Run(name, func(t *testing.T) {",
  "\t\t\tif Parse(name) == nil {",
  '\t\t\t\tt.Errorf("Parse(%q) is nil", name)',
  "\t\t\t}",
  "\t\t})",
  "\t}",
  "}"
));
// A Go implementation whose only test-shaped token is a method call spelled
// `.test(`. Go's pattern is `func Test...(`, so this must be refused on both
// sides, before and after.
other("go", "go", L(
  "func IsSlug(s string) bool {",
  "\treturn slugRe.test(s)",
  "}"
));

other("python", "python", L(
  "def test_adds_positive():",
  "    assert add(1, 2) == 3",
  "",
  "",
  "def test_adds_zero():",
  "    assert add(0, 0) == 0"
));
other("python", "python", L(
  '@pytest.mark.parametrize("key,want", [("alpha", 101), ("beta", 202)])',
  "def test_shard_of(key, want):",
  "    assert shard_of(key) == want"
));
other("python", "python", L(
  "def is_slug(s):",
  "    return SLUG_RE.test(s)"
));

other("csharp", "csharp", L(
  "[Fact]",
  "public void AddsPositive()",
  "{",
  "    Assert.Equal(3, Add(1, 2));",
  "}",
  "",
  "[Fact]",
  "public void AddsZero()",
  "{",
  "    Assert.Equal(0, Add(0, 0));",
  "}"
));
other("csharp", "csharp", L(
  "[Theory]",
  '[InlineData("alpha", 101)]',
  "public void ShardOfCases(string key, int want)",
  "{",
  "    Assert.Equal(want, ShardOf(key));",
  "}"
));
other("csharp", "csharp", L(
  "public bool IsSlug(string s)",
  "{",
  "    return SlugRe.test(s);",
  "}"
));

const RUST_BODIES = [
  L(
    "#[cfg(test)]",
    "mod tests {",
    "    use super::*;",
    "",
    "    #[test]",
    "    fn adds_positive() { assert_eq!(add(1, 2), 3); }",
    "",
    "    #[test]",
    "    fn adds_zero() { assert_eq!(add(0, 0), 0); }",
    "}"
  ),
  L(
    "#[cfg(test)]",
    "mod tests {",
    "    use super::*;",
    "",
    "    #[test]",
    "    fn it_tests_a_slug() {",
    '        assert!(SLUG.is_match("a-b"));',
    "    }",
    "}"
  ),
  L("pub fn is_slug(s: &str) -> bool {", "    SLUG.is_match(s)", "}"),
];

for (const { tag } of FACADE_REFS) {
  dtest(`[BLIND-V71-P2 ${row()}] scope vs ${tag}: Go, Python and C# do not move at all`, () => {
    const facade = facades.find((f) => f.tag === tag);
    const moved = [];
    for (const { id, fence, body } of OTHER) {
      for (const [pathName, reply] of [["FENCED", fencedOf(fence, body)], ["BARE", body]]) {
        const now = extractTestFunctions(reply, id);
        const before = facade.mod.extractTestFunctions(reply, id);
        const same =
          (now === undefined && before === undefined) ||
          (now !== undefined && before !== undefined && now.text === before.text && now.testCount === before.testCount);
        if (!same) moved.push(`---- ${id} ${pathName} ----\n${reply}\n  ${tag}: ${j(before)}\n  now:   ${j(now)}`);
      }
    }
    assert.strictEqual(
      moved.length,
      0,
      `[BLIND-V71-P2] ${moved.length} non-TypeScript answers moved against ${tag} (${facade.ref}). Amendment 5 rewrites TEST_FUNCTION_SHAPES.typescript and deletes BARE_TEST_FUNCTION_SHAPES; it says nothing about Go, Python or C#, and rule 1 holds for them unchanged.\n\n${moved.join("\n\n")}`
    );
  });
}

for (const { tag } of FACADE_REFS) {
  dtest(`[BLIND-V71-P2 ${row()}] scope vs ${tag}: Rust, through extractTestModule, does not move at all`, () => {
    const facade = facades.find((f) => f.tag === tag);
    const moved = [];
    for (const body of RUST_BODIES) {
      for (const [pathName, reply] of [["FENCED", fencedOf("rust", body)], ["BARE", body]]) {
        const now = extractTestModule(reply);
        const before = facade.mod.extractTestModule(reply);
        const same =
          (now === undefined && before === undefined) ||
          (now !== undefined && before !== undefined && now.text === before.text && now.testCount === before.testCount);
        if (!same) moved.push(`---- rust ${pathName} ----\n${reply}\n  ${tag}: ${j(before)}\n  now:   ${j(now)}`);
      }
    }
    assert.strictEqual(
      moved.length,
      0,
      `[BLIND-V71-P2] ${moved.length} Rust answers moved against ${tag} (${facade.ref}). extractTestModule is not in amendment 5's scope at all.\n\n${moved.join("\n\n")}`
    );
  });
}

// ===========================================================================
// Cost. Amendment 5 names a measured quadratic and the fix for it: "20,000
// `it(` heads with no closers cost 544ms against 1.7ms today ... The matching
// parens are therefore computed ONCE per text with a stack, in one linear
// pass, and looked up."
//
// The bound is asserted on the MINIMUM of three runs. A minimum is the right
// statistic for a ceiling: a slow sample can be noise, but a fast sample
// cannot be luck, and the quadratic amendment 5 measured is 5x over the bound
// even on a good machine.
// ===========================================================================

const minMs = (fn, runs = 3) => {
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const t0 = process.hrtime.bigint();
    fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms < best) best = ms;
  }
  return best;
};

const COST_ROWS = [
  {
    name: "20,000 `it(` heads with no closing parens - the exact shape amendment 5 measured at 544ms",
    boundMs: 100,
    why: "a scan per candidate is quadratic here: every head is a candidate and every scan runs to EOF without finding a match. Amendment 5's answer is one linear stack pass per text, so the shape is linear and 100ms is generous",
    build: () => Array.from({ length: 20000 }, () => 'it("t", () => {').join("\n"),
  },
  {
    name: "4,000 real, closed tests",
    boundMs: 1000,
    why: "the ordinary large reply. A linear pass over ~180KB is milliseconds; a bound of 1s only fails a rule that is superlinear in the number of test calls",
    build: () =>
      Array.from({ length: 4000 }, (_, i) => L(`it("case ${i}", () => {`, `  expect(add(${i}, 1)).toBe(${i + 1});`, "});")).join("\n\n"),
  },
  {
    name: "20,000 `RE.test(x)` calls - candidates that every one of them must reject",
    boundMs: 250,
    why: "each is a candidate name that rule 11 must look past. Rejecting it must cost a bounded look, not a scan of the rest of the file",
    build: () => L("const RE = /^[a-z]+$/;", ...Array.from({ length: 20000 }, () => "RE.test(x);")),
  },
];

for (const c of COST_ROWS) {
  gtest(`[BLIND-V71-P2 ${row()}] cost: ${c.name} stays under ${c.boundMs}ms`, () => {
    const reply = fencedOf("typescript", c.build());
    let last;
    const ms = minMs(() => {
      last = extractTestFunctions(reply, "typescript");
    });
    assert.ok(
      ms < c.boundMs,
      `[BLIND-V71-P2] cost: ${c.name} took ${ms.toFixed(1)}ms, over the ${c.boundMs}ms bound (best of 3, reply is ${reply.length} bytes, answer ${j(last)}). ${c.why}. This runs on the REQUEST THREAD.`
    );
  });
}

// The same three shapes on the BARE path. Rule 12 puts one rule on both paths,
// so a paren walk that is linear fenced and quadratic bare is the same defect
// wearing the other hat.
for (const c of COST_ROWS) {
  gtest(`[BLIND-V71-P2 ${row()}] cost, BARE path: ${c.name} stays under ${c.boundMs}ms`, () => {
    const reply = c.build();
    let last;
    const ms = minMs(() => {
      last = extractTestFunctions(reply, "typescript");
    });
    assert.ok(
      ms < c.boundMs,
      `[BLIND-V71-P2] cost BARE: ${c.name} took ${ms.toFixed(1)}ms, over the ${c.boundMs}ms bound (best of 3, reply is ${reply.length} bytes, answer ${j(last)}). Rule 12 says one rule serves both paths, so the linear-pass fix has to serve both. ${c.why}`
    );
  });
}
