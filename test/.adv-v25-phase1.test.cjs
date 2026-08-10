// ADVERSARIAL REVIEW - session-v25 phase 1 (src/core/fimBound.ts + the
// openStack extraction in src/core/postprocess.ts).
//
// Every test here asserts the behaviour the reviewer believes is CORRECT, so a
// failure is the defect. Dot-prefixed so `npm test` ignores it.
//
// Run: SKIP_LIVE=1 node --test test/.adv-v25-phase1.test.cjs
//
// Evidence behind each block is in the review report; the measured corpora are
// session-v25/harness/results/spike1{,-go,-python}.json (750 real generations)
// and the five repos those sites were harvested from.

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adv-v25-phase1",
  `export { MAX_BOUND_LINES, boundContinuation, boundReached, sealCut } from "../src/core/fimBound";\n` +
    `export { postprocessBounded } from "../src/core/postprocess";\n`
);
const { boundContinuation, sealCut, postprocessBounded } = mod;
test.after(cleanup);

const ctxOf = (languageId, currentLinePrefix = "", extra = {}) => ({ languageId, currentLinePrefix, ...extra });
const bound = (raw, ctx) => boundContinuation(raw, ctx);

// =========================================================================
// A1. sealCut is NOT idempotent when the served text ends inside an
//     unterminated literal. The contract says "Idempotent" twice and
//     postprocessBounded's comment leans on it ("it is idempotent, so where
//     nothing moved it costs nothing"). It grows without bound instead.
// =========================================================================

test("A1: sealCut is idempotent even when the text ends inside an unterminated literal", () => {
  const ctx = ctxOf("typescript", "  const v = ");
  const once = sealCut('foo("bar', ctx);
  const twice = sealCut(once.text, ctx);
  assert.strictEqual(twice.text, once.text, "sealCut grew its own output");
  assert.strictEqual(twice.appended, "");
});

test("A1b: sealCut applied four times does not append four closers", () => {
  const ctx = ctxOf("typescript", "  const v = ");
  let t = 'foo("bar';
  for (let i = 0; i < 4; i++) t = sealCut(t, ctx).text;
  assert.strictEqual(t, 'foo("bar)');
});

test("A1c: boundContinuation is a fixpoint on its own output for an unterminated literal", () => {
  const ctx = ctxOf("typescript", "  const v = ");
  const once = bound('foo("bar', ctx).text;
  assert.strictEqual(bound(once, ctx).text, once);
});

// =========================================================================
// A2. The real pipeline doubles the closer. Captured verbatim from
//     spike1.json - the raw is a real model generation, the apostrophe in
//     "it's" opens a literal that swallows the rest of the ghost, so the
//     balance step invents a `}` the text already had, and then the seal
//     invents a second one. 5 of 750 real generations do this.
// =========================================================================

const APOSTROPHE_RAW =
  "waitForController(page: Page): Promise<void> {\n" +
  "  // The SW is registered and active, but it's not yet controlling the page.\n" +
  "  await page.waitForFunction(() => navigator.serviceWorker?.controller !== undefined);\n" +
  "}";

test("A2: an apostrophe in a prose comment does not make the balance step invent a closer", () => {
  const ctx = ctxOf("typescript", "async function ");
  const r = bound(APOSTROPHE_RAW, ctx);
  assert.strictEqual(r.appended, "", `invented ${JSON.stringify(r.appended)} for an already-balanced ghost`);
});

test("A2b: the wired pipeline does not append a second copy of the same closer", () => {
  const ctx = { suffix: "", currentLinePrefix: "async function ", multiline: true, bound: ctxOf("typescript", "async function ") };
  const b = bound(APOSTROPHE_RAW, ctx.bound);
  const p = postprocessBounded(APOSTROPHE_RAW, ctx);
  assert.strictEqual(p.text, b.text, "sealCut lengthened the text the bound had already sealed");
});

// =========================================================================
// A3. Closers land inside a line comment. Captured from spike1.json (rust
//     decl-name); 9 of 750 real generations end their served text on a
//     comment line and get closers appended after the comment text, where
//     they are inert AND visible.
// =========================================================================

test("A3: a closer is never appended at the end of a line comment", () => {
  const raw =
    "check_journal(node: &str, text: &str) -> CheckResult {\n" +
    "    let mut result = CheckResult::pass(\"Journal\");\n" +
    "\n" +
    "    // check for panic strings\n" +
    "    if text.contains(\"panic\") {";
  const r = bound(raw, ctxOf("rust", "fn "));
  const lastLine = r.text.split("\n").pop();
  assert.ok(
    !(r.appended !== "" && lastLine.includes("//")),
    `appended ${JSON.stringify(r.appended)} inside a comment: ${JSON.stringify(lastLine)}`
  );
});

// =========================================================================
// A4. refusedUnsafe on ordinary code. 41 of 750 real generations (5.5%) are
//     suppressed whole; python is 27/150 (18%).
// =========================================================================

test("A4a: a single-line declaration head ending in `{` is served, not refused", () => {
  // spike1-go.json, `func init(|` and `func main(|`: the model returns exactly
  // ") {" and the whole ghost is suppressed. 7 of 750.
  const go = bound(") {", ctxOf("go", "func main("));
  assert.strictEqual(go.refusedUnsafe, false, "go: `func main() {` refused");
  const ts = bound("page: Page): Promise<void> {", ctxOf("typescript", "async function seed("));
  assert.strictEqual(ts.refusedUnsafe, false, "typescript: a whole signature line refused");
});

test("A4b: a parameter-list continuation whose `(` is in currentLinePrefix is not refused", () => {
  // The trailing-comma exception requires an opener the SERVED text opened, so
  // at `fn f(|` every parameter line dangles on `,` with an empty stack and the
  // retract finds nothing. 15 of 750 real generations, 13 of them python.
  const rust = bound(
    "\n        &self,\n        account_id: u128,\n        event_id: Option<u128>,\n    ) -> Result<(), AccountError> {",
    ctxOf("rust", "    pub async fn catch_up(")
  );
  assert.strictEqual(rust.refusedUnsafe, false, "rust: multi-line parameter list refused");
  const py = bound(
    "\n    depth_map: np.ndarray,\n    extrinsic: np.ndarray,\n    intrinsic: np.ndarray,\n) -> tuple:",
    ctxOf("python", "def depth_to_world_coords_points(")
  );
  assert.strictEqual(py.refusedUnsafe, false, "python: multi-line parameter list refused");
});

test("A4c: a python signature line followed by a docstring is not refused", () => {
  // 10 of 150 python generations. `:` is in DANGLING, so the signature line is
  // unsafe, and every forward line inside the cap is docstring prose ending in
  // `.` or `:`, which is unsafe too.
  const r = bound(
    'read_intrinsics(intr_file: Path) -> np.ndarray:\n    """Read camera intrinsics file in BSS v2 format.\n\n    Format (one line per frame):\n        frame_idx fx fy cx cy\n',
    ctxOf("python", "def ")
  );
  assert.strictEqual(r.refusedUnsafe, false, "python: `def f(...) -> T:` + docstring refused whole");
});

test("A4d: go's postfix increment is a complete statement, not a dangling operator", () => {
  // 180 `count++` / `i--` lines in the SevenDB corpus. DANGLING's `[-+...]`
  // class calls every one of them an unsafe tail.
  assert.strictEqual(bound("count++", ctxOf("go", "\t")).refusedUnsafe, false);
  assert.strictEqual(bound("i--", ctxOf("go", "\t")).refusedUnsafe, false);
});

test("A4e: a declaration line ending in a generic close `>` is not a dangling tail", () => {
  // 175 such lines in the C# corpus, e.g. an Allman-brace class declaration.
  const r = bound("public class ForceDecimalDoubleConverter : JsonConverter<double>", ctxOf("csharp", "    "));
  assert.strictEqual(r.refusedUnsafe, false);
});

// =========================================================================
// A5. What DANGLING misses. A miss is worse than a false positive: the bound
//     serves the tail AND rule 6 appends a closer behind it.
// =========================================================================

test("A5a: a tail dangling on a keyword is not served with a closer bolted on", () => {
  const r = bound("for (const x of", ctxOf("typescript", "  "));
  assert.notStrictEqual(r.text, "for (const x of)", "served `for (const x of)`");
});

test("A5b: a python explicit line continuation is a dangling tail", () => {
  const r = bound("total = a + \\\n    b\n    print(total)", ctxOf("python", "    "));
  assert.notStrictEqual(r.text, "total = a + \\", "served a bare trailing backslash");
});

test("A5c: a python boolean-operator tail is a dangling tail", () => {
  const r = bound("total = a and\n    b\n    use(total)", ctxOf("python", "    "));
  assert.notStrictEqual(r.text, "total = a and", "served `total = a and`");
});

// =========================================================================
// A6. Rust's `'`: the lifetime-tick exclusion breaks the bracket scan on a
//     char literal. 11 bracket char literals against 233 lifetime ticks in
//     the rust corpus, so the exclusion is the right trade - but it needs a
//     char-literal shape test, not a blanket exclusion.
// =========================================================================

test("A6a: a rust char literal holding a bracket does not unbalance the scan", () => {
  const r = bound("let d = '(';", ctxOf("rust", "    "));
  assert.strictEqual(r.appended, "", `appended ${JSON.stringify(r.appended)} to a complete statement`);
});

test("A6b: a rust match arm on a bracket char literal still closes its construct", () => {
  const r = bound("match c {\n        '(' => go(),\n    }\n    after();", ctxOf("rust", "    "));
  assert.strictEqual(r.text, "match c {\n        '(' => go(),\n    }");
  assert.strictEqual(r.rule, "construct");
});

test("A6c: the lifetime tick still is not a quote", () => {
  // Regression guard for the fix: this must keep working.
  assert.strictEqual(bound("let s: &'a str = fetch(id", ctxOf("rust", "    ")).appended, ")");
});

// =========================================================================
// A7. Rule 4 says "content lines, leading blanks excluded". The scans count
//     RAW lines from the lead, so an interior blank line eats a cap slot.
// =========================================================================

test("A7: an interior blank line does not cost a content line of the cap", () => {
  const r = bound("match x {\n        A => a(),\n\n        B => b(),\n        C => c(),\n        _ => z(),\n    }", ctxOf("rust", "    "));
  const content = r.text.split("\n").filter((l) => l.trim() !== "").length;
  assert.strictEqual(content, 4, `served ${content} content lines, cap is 4`);
});

// =========================================================================
// A8. Rule 6 says closers go "on the same line, at the very end of the
//     text". A raw that ends with a newline puts them on a line of their own,
//     and under CRLF they land after the \r.
// =========================================================================

test("A8a: appended closers stay on the last content line, not on a new one", () => {
  const r = bound("x = f(a\ny();\n", ctxOf("typescript", "  "));
  assert.ok(!/\n\)+$/.test(r.text), `closer on its own line: ${JSON.stringify(r.text)}`);
});

test("A8b: appended closers are not placed after a CR in a CRLF generation", () => {
  const r = bound("x = f(a\r\ny();\r\n", ctxOf("typescript", "  "));
  assert.ok(!/\r\n?\)+$/.test(r.text), `closer after the CR: ${JSON.stringify(r.text)}`);
});

// =========================================================================
// A9. The conservatism property of boundReached. constructScan falls back to
//     statementScan when no `{` has been seen yet, and propagates the
//     statement's `stable` as `decided`. "No brace yet" is a ran-out-of-text
//     condition, so the abort fires and a later `{` changes the answer.
//     Shape: an Allman-brace construct with a line between the head and the
//     brace.
// =========================================================================

const REACHED_CASES = [
  {
    name: "csharp allman switch with a comment before the brace",
    ctx: ctxOf("csharp", "        "),
    raw: "switch (kind)\n        // one branch per wire kind\n        {\n            case 1: return a();\n        }",
  },
  {
    name: "typescript construct whose brace is two lines down",
    ctx: ctxOf("typescript", "  "),
    raw: "try\n  x\n{\n  a();\n}",
  },
];

for (const { name, ctx, raw } of REACHED_CASES) {
  test(`A9: boundReached never fires before the answer is settled: ${name}`, () => {
    const whole = bound(raw, ctx).text;
    for (let i = 1; i <= raw.length; i++) {
      const p = raw.slice(0, i);
      if (!mod.boundReached(p, ctx)) continue;
      assert.strictEqual(bound(p, ctx).text, whole, `aborting at char ${i} would serve a different ghost`);
    }
  });
}

// =========================================================================
// A10. Composition. dropDuplicateSuffixLines removes the closer the buffer
//      already has; sealCut then puts it back, because the balance step has
//      no idea the suffix exists. The unbounded pipeline gets this right.
// =========================================================================

test("A10: the seal does not re-introduce a closer the suffix-dedup filter removed", () => {
  const raw = "if (x) {\n    go();\n  }\n  after();";
  const ctx = { suffix: "\n  }\n}\n", currentLinePrefix: "  ", multiline: true, bound: ctxOf("typescript", "  ") };
  const p = postprocessBounded(raw, ctx);
  assert.strictEqual(p.text, "if (x) {\n    go();", `seal re-added the buffer's closer: ${JSON.stringify(p.text)}`);
});
