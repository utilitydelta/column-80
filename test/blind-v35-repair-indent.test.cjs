// Blind oracle (v35): the repair round must not walk the human's file one
// indent level deeper every time it runs.
//
// The proven defect: `assembleRepairPrompt` embeds `input.code` VERBATIM, and
// that value is raw span text read out of the document. A span starts at the
// declaration's first character, so line 1 is flush-left while every later line
// still carries the FILE's absolute column. The model echoes what it was shown
// (signature flush, body at the file's column); `placeGeneratedReply` derives
// the reply's base from the FIRST non-blank line, which is that flush-left
// signature, so the base is empty, nothing is dedented, and the target's indent
// is added ON TOP of the indent the body already had. Four spaces a round,
// cumulative, silent. Three rounds on a Rust `create_ca` inside an `impl` took
// its body 8 -> 12 -> 16 and its closing brace 4 -> 8 -> 12.
//
// The contract under test: the failing code embedded in the repair prompt is
// NORMALISED TO 0-BASED, exactly as the generation prompt shows a definition.
// The fix is at the prompt INPUT, never in the reply-base computation.
//
// Every assertion here compares ACTUAL LEADING WHITESPACE, exact strings. A
// trimmed or normalised compare cannot see this bug at all.
//
// Blind discipline: written from the contract only. The public surface read was
// the `assembleRepairPrompt` / `RepairPromptInput` and `placeGeneratedReply` /
// `ReplyPlacement` declarations, plus existing tests for idiom. Several of these
// are expected RED until the fix lands; none may be weakened to go green.
//
// Run: SKIP_LIVE=1 node --test test/blind-v35-repair-indent.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v35-repair-indent",
  `export { assembleRepairPrompt } from "../src/core/repair";
export { placeGeneratedReply } from "../src/core/placeReply";\n`,
);
const { assembleRepairPrompt, placeGeneratedReply } = mod;
test.after(cleanup);

const FENCE = "```";
const L = (...parts) => parts.join("\n");

// The leading whitespace of every line, so a failure names the column instead
// of making a human count spaces in a diff.
const columns = (text) => text.split("\n").map((l) => /^[ \t]*/.exec(l)[0]);

// A readable rendering of a column list: 4 spaces reads as "sp4", a tab as "TAB".
const show = (cols) =>
  JSON.stringify(
    cols.map((c) => (c === "" ? "-" : c.replace(/ /g, "sp").replace(/\t/g, "TAB"))),
  );

const diag = (over = {}) => ({
  kind: "compile-error",
  level: "error",
  code: "E0308",
  message: "mismatched types",
  rendered: "error[E0308]: mismatched types\n --> src/ca.rs:2:5",
  spans: [],
  suggestions: [],
  ...over,
});

// Pull the failing code back out of the prompt's own fenced block. The section
// is the one introduced by "... failed the compiler check:"; the assembler
// appends a trailing newline to `code`, which shows up as the final line before
// the closing fence, so the extracted text is the code without it.
function fencedCode(prompt) {
  const lines = prompt.split("\n");
  const i = lines.findIndex((l) => l.endsWith("failed the compiler check:"));
  assert.ok(i >= 0, "the prompt has a failing-code section");
  assert.ok(lines[i + 1].startsWith(FENCE), "the code section opens with a fence");
  let j = i + 2;
  while (j < lines.length && lines[j] !== FENCE) j++;
  assert.ok(j < lines.length, "the code fence closes");
  const body = lines.slice(i + 2, j);
  if (body.length && body[body.length - 1] === "") body.pop(); // assembler's trailing \n
  return body.join("\n");
}

// One repair round, end to end: document span text in, spliced reply out.
// The model is modelled as a perfect echo of the code it was shown - which is
// what real models do here, and what makes the defect observable without a
// live server.
function repairRound(spanText, { languageId, headerIndent, ...rest }) {
  const prompt = assembleRepairPrompt({
    languageId,
    code: spanText,
    diagnostics: [diag()],
    ...(rest.bodyOnly ? { bodyOnly: true } : {}),
  });
  const echoed = fencedCode(prompt);
  return placeGeneratedReply(echoed, {
    languageId,
    headerIndent,
    ...(rest.bodyOnly ? { bodyOnly: true, bodyIndent: rest.bodyIndent } : {}),
  });
}

// ===== Fixtures: five languages, every one NESTED ===========================
// A top-level target cannot show this bug (its header indent is empty, so every
// leg is a no-op), so nothing below relies on one except the invariant-D
// no-op pins, which exist to prove the fix did not disturb that case.

// Rust: the proven case. `create_ca` inside an `impl`, header at column 4,
// body at 8, closing brace at 4. The span starts at `fn`, so line 1 is flush.
const RUST = {
  languageId: "rust",
  headerIndent: "    ",
  span: L(
    "fn create_ca(&self) -> Result<Ca> {",
    "        let key = self.key()?;",
    "        Ok(Ca { key })",
    "    }",
  ),
  zeroBased: L(
    "fn create_ca(&self) -> Result<Ca> {",
    "    let key = self.key()?;",
    "    Ok(Ca { key })",
    "}",
  ),
};

// TypeScript: a method inside a class, header at 4.
const TS = {
  languageId: "typescript",
  headerIndent: "    ",
  span: L(
    "async load(id: string): Promise<Entry> {",
    "        const raw = await this.fetch(id);",
    "        return parse(raw);",
    "    }",
  ),
  zeroBased: L(
    "async load(id: string): Promise<Entry> {",
    "    const raw = await this.fetch(id);",
    "    return parse(raw);",
    "}",
  ),
};

// C#: a method inside a class, Allman brace. The brace lines sit at the
// header's own column 4, so after normalisation they are the 0-column lines.
const CS = {
  languageId: "csharp",
  headerIndent: "    ",
  span: L(
    "public Entry Load(string id)",
    "    {",
    "        var raw = Fetch(id);",
    "        return Parse(raw);",
    "    }",
  ),
  zeroBased: L(
    "public Entry Load(string id)",
    "{",
    "    var raw = Fetch(id);",
    "    return Parse(raw);",
    "}",
  ),
};

// Go: a func literal bound inside an enclosing func, header at one tab. Tabs on
// purpose - Go's real indentation is tabs, and a space-only dedent would miss it.
const GO = {
  languageId: "go",
  headerIndent: "\t",
  span: L(
    "handler := func(r io.Reader) error {",
    "\t\tdata, err := io.ReadAll(r)",
    "\t\tif err != nil {",
    "\t\t\treturn err",
    "\t\t}",
    "\t\treturn use(data)",
    "\t}",
  ),
  zeroBased: L(
    "handler := func(r io.Reader) error {",
    "\tdata, err := io.ReadAll(r)",
    "\tif err != nil {",
    "\t\treturn err",
    "\t}",
    "\treturn use(data)",
    "}",
  ),
};

// Python: a method inside a class, header at 4, body at 8.
const PY = {
  languageId: "python",
  headerIndent: "    ",
  span: L(
    "def load(self, key):",
    "        raw = self.fetch(key)",
    "        return parse(raw)",
  ),
  zeroBased: L(
    "def load(self, key):",
    "    raw = self.fetch(key)",
    "    return parse(raw)",
  ),
};

// Python bodyOnly: the span excludes the preserved header and docstring, so the
// failing code is the BODY of a method in a class - line 1 flush (the span
// starts at the first statement's first character), every later line at 8.
const PY_BODY = {
  languageId: "python",
  headerIndent: "    ",
  bodyOnly: true,
  bodyIndent: "        ",
  span: L(
    "raw = self.fetch(key)",
    "        if raw is None:",
    "            raise KeyError(key)",
    "        return parse(raw)",
  ),
  zeroBased: L(
    "raw = self.fetch(key)",
    "if raw is None:",
    "    raise KeyError(key)",
    "return parse(raw)",
  ),
};

const NESTED = [RUST, TS, CS, GO, PY, PY_BODY];
const nameOf = (f) => (f.bodyOnly ? `${f.languageId} (bodyOnly)` : f.languageId);

// ===== Invariant A: the fenced failing code is 0-based =======================

for (const f of NESTED) {
  // THE RULING, kept verbatim from when this row was `todo`:
  //
  // PYTHON is `todo`, and only python. This row and its byte-for-byte sibling
  // assert against the SAME value and demand different answers: the sibling
  // requires the body at 4, this one requires a minimum of zero across the
  // remaining lines. Zero is not an alternative reading, it is corruption - the
  // body lands level with `def` once the placement adds the header's column,
  // which is `IndentationError: expected an indented block`. A `def` has no
  // closing token, so its body is strictly deeper than its header by definition
  // and invariant A's braced-language shape cannot hold here.
  //
  // Marked rather than relaxed: the assertion stands exactly as written, and the
  // other five languages keep it as a live demand. Take the todo off only by
  // fixing the invariant, never by softening the row.
  //
  // INVERTED 2026-08-10, because a test that must be red is not a test. The
  // python row USED TO demand a minimum indent of `""` across the remaining
  // lines and was red every run. It now demands the four spaces the assembler
  // actually emits, which the ruling above already named as the CORRECT answer:
  // invariant A's zero-minimum is the braced-language shape and python is
  // superseded by the ruling, not failing it. The other five languages are
  // untouched and keep the zero as a live demand, which is what stops this
  // becoming a blanket relaxation.
  const wholeDefPython = f.languageId === "python" && !f.bodyOnly;
  const wantMin = wholeDefPython ? "    " : "";
  const aTitle = wholeDefPython
    ? `SUPERSEDED: A/${nameOf(f)}: a Python def body stays one level deeper than its flush header`
    : `A/${nameOf(f)}: the repair prompt's fenced code is 0-based (first line flush, min indent of the rest is zero)`;
  test(aTitle, () => {
    const code = fencedCode(
      assembleRepairPrompt({
        languageId: f.languageId,
        code: f.span,
        diagnostics: [diag()],
        ...(f.bodyOnly ? { bodyOnly: true } : {}),
      }),
    );
    const cols = columns(code);
    assert.strictEqual(cols[0], "", `first line must be flush-left, got ${show([cols[0]])}`);
    const rest = code
      .split("\n")
      .slice(1)
      .filter((l) => l.trim() !== "")
      .map((l) => /^[ \t]*/.exec(l)[0]);
    assert.ok(rest.length > 0, "fixture has lines after the first");
    const min = rest.reduce((a, b) => (b.length < a.length ? b : a));
    assert.strictEqual(
      min,
      wantMin,
      `min indent across the remaining non-blank lines must be ${show([wantMin])}, got ${show([min])} (all: ${show(rest)})`,
    );
  });

  test(`A/${nameOf(f)}: the fenced code is exactly the definition normalised to 0-based, byte for byte`, () => {
    const code = fencedCode(
      assembleRepairPrompt({
        languageId: f.languageId,
        code: f.span,
        diagnostics: [diag()],
        ...(f.bodyOnly ? { bodyOnly: true } : {}),
      }),
    );
    assert.strictEqual(code, f.zeroBased);
  });
}

test("A/rust: the nested span the prompt was handed really is file-indented (fixture self-check)", () => {
  // Not a product assertion - it pins that the input to invariant A carries the
  // file's absolute columns, so a green A above cannot be green by accident.
  assert.deepStrictEqual(columns(RUST.span), ["", "        ", "        ", "    "]);
});

// ===== Invariant B: round-trip stability, and no compounding =================

// The next round reads the span out of the document again: it starts at the
// declaration's first character, so line 1 comes back flush-left. For a bodyOnly
// target the placed reply leads with a newline (it lands under a docstring on
// its own line), so the re-read drops that newline and flushes line 1.
function reSpan(placed, f) {
  let text = placed;
  if (f.bodyOnly) {
    assert.ok(text.startsWith("\n"), "a bodyOnly placement leads with a newline");
    text = text.slice(1);
  }
  const lines = text.split("\n");
  lines[0] = lines[0].replace(/^[ \t]+/, "");
  return lines.join("\n");
}

// What the file holds for this definition after a correct round: for a whole
// definition, exactly the original span text; for a bodyOnly target, the body
// with EVERY line at the body column, led by the newline the placement adds.
const expectedPlacement = (f) =>
  f.bodyOnly
    ? "\n" +
      f.span
        .split("\n")
        .map((l, i) => (l.trim() === "" ? l : (i === 0 ? f.bodyIndent + l : l)))
        .join("\n")
    : f.span;

for (const f of NESTED) {
  test(`B/${nameOf(f)}: one repair round reproduces the definition's own columns, unchanged`, () => {
    const out = repairRound(f.span, f);
    assert.deepStrictEqual(
      columns(out),
      columns(expectedPlacement(f)),
      `columns after one round: got ${show(columns(out))}, want ${show(columns(expectedPlacement(f)))}`,
    );
    assert.strictEqual(out, expectedPlacement(f), "byte for byte, one round changes nothing");
  });

  test(`B/${nameOf(f)}: a second repair round changes nothing (the defect is that it COMPOUNDS)`, () => {
    const r1 = repairRound(f.span, f);
    const r2 = repairRound(reSpan(r1, f), f);
    assert.deepStrictEqual(
      columns(r2),
      columns(r1),
      `round 2 columns: got ${show(columns(r2))}, want ${show(columns(r1))}`,
    );
    assert.strictEqual(r2, r1, "round 2 is byte-identical to round 1");
  });
}

test("B/rust: three rounds on the proven case leave the body at 8 and the closing brace at 4", () => {
  // The captured defect: body 8 -> 12 -> 16, closing brace 4 -> 8 -> 12.
  let span = RUST.span;
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const placed = repairRound(span, RUST);
    seen.push(columns(placed));
    span = reSpan(placed, RUST);
  }
  for (let i = 0; i < 3; i++) {
    assert.deepStrictEqual(
      seen[i],
      ["", "        ", "        ", "    "],
      `round ${i + 1} columns: got ${show(seen[i])}, want ["-","sp8","sp8","sp4"]`,
    );
  }
});

test("B/csharp: three rounds keep the Allman brace at the header's own column", () => {
  let span = CS.span;
  for (let i = 0; i < 3; i++) {
    const placed = repairRound(span, CS);
    const cols = columns(placed);
    assert.strictEqual(cols[1], "    ", `round ${i + 1}: opening brace column, got ${show([cols[1]])}`);
    assert.strictEqual(cols[4], "    ", `round ${i + 1}: closing brace column, got ${show([cols[4]])}`);
    assert.strictEqual(cols[2], "        ", `round ${i + 1}: body column, got ${show([cols[2]])}`);
    span = reSpan(placed, CS);
  }
});

test("B/python (bodyOnly): three rounds keep every body line at the docstring's column", () => {
  let span = PY_BODY.span;
  for (let i = 0; i < 3; i++) {
    const placed = repairRound(span, PY_BODY);
    assert.deepStrictEqual(
      columns(placed),
      ["", "        ", "        ", "            ", "        "],
      `round ${i + 1} columns: got ${show(columns(placed))}`,
    );
    span = reSpan(placed, PY_BODY);
  }
});

// ===== Invariant D: a top-level target is a byte-for-byte no-op ==============
// These are GREEN today and must stay green: the fix may not disturb the
// already-correct case. A top-level target cannot demonstrate the bug, so these
// prove nothing on their own - they are freeze pins.

const TOP_RUST = L(
  "pub fn sum_even(values: &[i64]) -> i64 {",
  "    values.iter().filter(|v| *v % 2 == 0).sum::<i64>()",
  "}",
);

const INSTRUCTION =
  "Fix the function. Reply with one fenced code block containing the corrected complete function definition, signature and body. Output nothing outside the code block.";

test("D: a top-level (already 0-based) span is embedded byte-identically - the prompt is unchanged", () => {
  const rendered = diag().rendered;
  const got = assembleRepairPrompt({
    languageId: "rust",
    code: TOP_RUST,
    diagnostics: [diag()],
  });
  const codeSection =
    "The function below failed the compiler check:\n" + FENCE + "rust\n" + TOP_RUST + "\n" + FENCE;
  const diagnosticsSection = "Compiler diagnostics:\n" + FENCE + "\n" + rendered + "\n" + FENCE;
  assert.strictEqual(got, [codeSection, diagnosticsSection, INSTRUCTION].join("\n\n"));
});

test("D: placing an echoed top-level reply at an empty header indent returns the same bytes", () => {
  for (const languageId of ["rust", "typescript", "csharp", "go", "python"]) {
    const out = placeGeneratedReply(TOP_RUST, { languageId, headerIndent: "" });
    assert.strictEqual(out, TOP_RUST, `${languageId}: empty header indent must be a no-op`);
  }
});

test("D: a whole top-level round trip is a byte-for-byte no-op", () => {
  for (const languageId of ["rust", "typescript", "csharp"]) {
    const out = repairRound(TOP_RUST, { languageId, headerIndent: "" });
    assert.strictEqual(out, TOP_RUST, `${languageId}: top-level round trip changed bytes`);
  }
});

// ===== Invariant E: generation (round 0) must not regress ====================
// A round-0 reply is written against a flush-left head, so its body sits at 4.
// Placed at a target whose header indent is 4, that body must land at 8. If the
// fix were made in the reply-base computation instead of at the prompt input,
// this is the test that goes red.

const GEN_REPLY = {
  rust: L("fn create_ca(&self) -> Result<Ca> {", "    let key = self.key()?;", "}"),
  typescript: L("async load(id: string): Promise<Entry> {", "    return parse(id);", "}"),
  csharp: L("public Entry Load(string id)", "{", "    return Parse(id);", "}"),
  go: L("handler := func(r io.Reader) error {", "\treturn use(r)", "}"),
  python: L("def load(self, key):", "    return parse(key)"),
};

test("E/rust: a flush-left round-0 reply with a body at 4 lands its body at 8 under a header at 4", () => {
  const out = placeGeneratedReply(GEN_REPLY.rust, { languageId: "rust", headerIndent: "    " });
  assert.deepStrictEqual(columns(out), ["", "        ", "    "], `got ${show(columns(out))}`);
});

test("E/typescript: same, body at 4 -> 8", () => {
  const out = placeGeneratedReply(GEN_REPLY.typescript, { languageId: "typescript", headerIndent: "    " });
  assert.deepStrictEqual(columns(out), ["", "        ", "    "], `got ${show(columns(out))}`);
});

test("E/csharp: same, Allman brace 0 -> 4 and body 4 -> 8", () => {
  const out = placeGeneratedReply(GEN_REPLY.csharp, { languageId: "csharp", headerIndent: "    " });
  assert.deepStrictEqual(columns(out), ["", "    ", "        ", "    "], `got ${show(columns(out))}`);
});

test("E/python: same, body at 4 -> 8", () => {
  const out = placeGeneratedReply(GEN_REPLY.python, { languageId: "python", headerIndent: "    " });
  assert.deepStrictEqual(columns(out), ["", "        "], `got ${show(columns(out))}`);
});

test("E/go: same, one tab of body -> two", () => {
  // The contract says "every language"; it is silent on whether placement has a
  // Go leg at all. Written from the contract's plain words.
  const out = placeGeneratedReply(GEN_REPLY.go, { languageId: "go", headerIndent: "\t" });
  assert.deepStrictEqual(columns(out), ["", "\t\t", "\t"], `got ${show(columns(out))}`);
});

test("E/python (bodyOnly): a flush-left round-0 body lands every line at the docstring's column", () => {
  const reply = L("raw = self.fetch(key)", "if raw is None:", "    raise KeyError(key)", "return parse(raw)");
  const out = placeGeneratedReply(reply, {
    languageId: "python",
    bodyOnly: true,
    headerIndent: "    ",
    bodyIndent: "        ",
  });
  assert.deepStrictEqual(
    columns(out),
    ["", "        ", "        ", "            ", "        "],
    `got ${show(columns(out))}`,
  );
});
