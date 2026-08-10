// IMPLEMENTER tests for session-v35 item 1: the dedent direction of the column
// pair. The blind oracle (blind-v35-repair-indent) covers the product behaviour
// through `assembleRepairPrompt`; this file is white-box, on the primitive and
// on each language's leg.
//
// Two things it exists to falsify:
//
//   1. The common-prefix rule compares CHARACTERS. A tab traded for spaces is a
//      dedent eating a level it did not own, and every assertion here compares
//      exact bytes so a count-based implementation cannot pass.
//   2. The dedent and the re-indent must agree, line for line, on which lines
//      are string interior. They are inverses, so a round trip through both is
//      byte-for-byte identity - including the interior of a multi-line literal,
//      whose bytes ARE the string's value. Tested on all four languages that
//      have a multi-line literal shape: rust `r#"..."#`, go backticks, ts
//      template literals, python triple quotes.
//
// Run: SKIP_LIVE=1 node --test test/impl-v35-dedent.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v35-dedent",
  `export { dedentToZeroBase } from "../src/core/reindent";
export { dedentRustBody, reindentRustBody } from "../src/core/extraction";
export { dedentTsBody, reindentTsBody } from "../src/core/tsExtraction";
export { dedentCsBody, reindentCsBody } from "../src/core/csExtraction";
export { dedentPyBody, reindentPyBody } from "../src/core/pyExtraction";
export { dedentGoBody, reindentGoBody } from "../src/core/goExtraction";
export { dedentReplyCode, placeGeneratedReply } from "../src/core/placeReply";
export { assembleRepairPrompt } from "../src/core/repair";
export { assembleRefinePrompt } from "../src/core/refine";\n`,
);
const {
  dedentToZeroBase,
  dedentRustBody,
  reindentRustBody,
  dedentTsBody,
  reindentTsBody,
  dedentCsBody,
  dedentPyBody,
  dedentGoBody,
  reindentGoBody,
  dedentReplyCode,
  placeGeneratedReply,
  assembleRepairPrompt,
  assembleRefinePrompt,
} = mod;
test.after(cleanup);

const L = (...parts) => parts.join("\n");
const noneExact = (lines) => lines.map(() => false);
const dedent = (text) => {
  const lines = text.split("\n");
  return dedentToZeroBase(lines, noneExact(lines)).join("\n");
};

// ===== The primitive ========================================================

test("primitive: the head is excluded, so the base is the body's shared prefix", () => {
  assert.equal(
    dedent(L("fn f() {", "        let x = 1;", "        g(x);", "    }")),
    L("fn f() {", "    let x = 1;", "    g(x);", "}"),
  );
});

test("primitive: a head carrying its own indent IS the base, and the body follows it", () => {
  // Already relative to something: there is nothing to discover below.
  assert.equal(
    dedent(L("    fn f() {", "        let x = 1;", "    }")),
    L("fn f() {", "    let x = 1;", "}"),
  );
});

test("primitive: a head with its own indent that no body line carries leaves the body alone", () => {
  // withoutBase's rule: a line that does not carry the base is not positioned
  // relative to the head, so there is no sound amount to take off it.
  assert.equal(dedent(L("\tfn f() {", "        body();", "\t}")), L("fn f() {", "        body();", "}"));
});

test("primitive: tabs and spaces share no prefix, so nothing is dedented", () => {
  // A count-based dedent trades one tab for some number of spaces and eats a
  // level it did not own. Characters only.
  const mixed = L("fn f() {", "\tlet x = 1;", "        g(x);", "}");
  assert.equal(dedent(mixed), mixed);
});

test("primitive: the shared prefix stops at the first differing character", () => {
  assert.equal(
    dedent(L("head", "\t    deep();", "\t\tother();")),
    L("head", "    deep();", "\tother();"),
  );
});

test("primitive: an already-0-based definition is a no-op", () => {
  const flat = L("fn f() {", "    let x = 1;", "}");
  assert.equal(dedent(flat), flat);
});

test("primitive: a single line is a no-op, indented or not", () => {
  assert.equal(dedent("fn f() {}"), "fn f() {}");
  assert.equal(dedent("        fn f() {}"), "fn f() {}"); // its own indent IS the base
});

test("primitive: an empty string is a no-op", () => {
  assert.equal(dedent(""), "");
});

test("primitive: nothing but blanks is a no-op", () => {
  assert.equal(dedent(L("", "   ", "")), L("", "   ", ""));
});

test("primitive: blank lines never gain or lose bytes", () => {
  assert.equal(
    dedent(L("fn f() {", "        a();", "", "        b();", "    }")),
    L("fn f() {", "    a();", "", "    b();", "}"),
  );
});

test("primitive: a byteExact line is returned unchanged and never measured", () => {
  // Measured, the two-space line would drag the base down to "  " and leave the
  // code at six. It is a string's interior, so it is neither measured nor moved.
  const lines = ["head", "        code();", "  frozen", "        more();"];
  const out = dedentToZeroBase(lines, [false, false, true, false]);
  assert.deepEqual(out, ["head", "code();", "  frozen", "more();"]);
});

test("primitive: every line byteExact leaves the input alone", () => {
  const lines = ["    a", "    b"];
  assert.deepEqual(dedentToZeroBase(lines, [true, true]), lines);
});

// ===== Multi-line string literals: frozen in BOTH directions ================
// The dedent and the re-indent are inverses, so the round trip is identity -
// and the interior of a literal moves in neither direction.

const RUST_RAW = {
  name: "rust r#\"...\"#",
  indent: "    ",
  span: L(
    "fn sql() -> &'static str {",
    "        let q = r#\"",
    "SELECT 1",
    "  FROM t",
    "\"#;",
    "        q",
    "    }",
  ),
  zeroBased: L(
    "fn sql() -> &'static str {",
    "    let q = r#\"",
    "SELECT 1",
    "  FROM t",
    "\"#;",
    "    q",
    "}",
  ),
  dedent: (t) => dedentRustBody(t),
  reindent: (t, i) => reindentRustBody(t, i),
};

const GO_RAW = {
  name: "go backticks",
  indent: "\t",
  span: L(
    "func sql() string {",
    "\t\tq := `",
    "SELECT 1",
    "  FROM t",
    "`",
    "\t\treturn q",
    "\t}",
  ),
  zeroBased: L(
    "func sql() string {",
    "\tq := `",
    "SELECT 1",
    "  FROM t",
    "`",
    "\treturn q",
    "}",
  ),
  dedent: (t) => dedentGoBody(t),
  reindent: (t, i) => reindentGoBody(t, i),
};

const TS_TEMPLATE = {
  name: "ts template literal",
  indent: "    ",
  span: L(
    "sql(): string {",
    "        const q = `",
    "SELECT 1",
    "  FROM t",
    "`;",
    "        return q;",
    "    }",
  ),
  zeroBased: L(
    "sql(): string {",
    "    const q = `",
    "SELECT 1",
    "  FROM t",
    "`;",
    "    return q;",
    "}",
  ),
  dedent: (t) => dedentTsBody(t),
  reindent: (t, i) => reindentTsBody(t, i),
};

const PY_TRIPLE = {
  name: "python triple quotes",
  indent: "    ",
  span: L(
    "def sql():",
    "        q = \"\"\"",
    "SELECT 1",
    "  FROM t",
    "\"\"\"",
    "        return q",
  ),
  zeroBased: L(
    "def sql():",
    "    q = \"\"\"",
    "SELECT 1",
    "  FROM t",
    "\"\"\"",
    "    return q",
  ),
  dedent: (t) => dedentPyBody(t),
  reindent: (t, i) => mod.reindentPyBody(t, i),
};

for (const f of [RUST_RAW, GO_RAW, TS_TEMPLATE, PY_TRIPLE]) {
  test(`${f.name}: the dedent moves code and freezes the literal's interior`, () => {
    assert.equal(f.dedent(f.span), f.zeroBased);
  });

  test(`${f.name}: dedent then re-indent is byte-for-byte identity`, () => {
    assert.equal(f.reindent(f.dedent(f.span), f.indent), f.span);
  });

  test(`${f.name}: a second pass changes nothing (the two directions agree)`, () => {
    const once = f.reindent(f.dedent(f.span), f.indent);
    assert.equal(f.reindent(f.dedent(once), f.indent), once);
  });
}

test("c# verbatim string: the interior is frozen in both directions", () => {
  const span = L(
    "public string Sql()",
    "    {",
    "        var q = @\"",
    "SELECT 1",
    "  FROM t\";",
    "        return q;",
    "    }",
  );
  const zeroBased = L(
    "public string Sql()",
    "{",
    "    var q = @\"",
    "SELECT 1",
    "  FROM t\";",
    "    return q;",
    "}",
  );
  assert.equal(dedentCsBody(span), zeroBased);
  assert.equal(placeGeneratedReply(zeroBased, { languageId: "csharp", headerIndent: "    " }), span);
});

// ===== The dispatcher =======================================================

test("dispatcher: an unregistered or absent language is returned unchanged", () => {
  const nested = L("fn f() {", "        body();", "    }");
  assert.equal(dedentReplyCode(nested, undefined), nested);
  assert.equal(dedentReplyCode(nested, "ruby"), nested);
  assert.equal(dedentReplyCode(nested, ""), nested);
});

test("dispatcher: every registered id has a leg that normalises", () => {
  for (const languageId of ["rust", "go", "csharp", "typescript", "typescriptreact", "javascript", "javascriptreact"]) {
    const nested = L("head {", "        body();", "    }");
    assert.equal(
      dedentReplyCode(nested, languageId),
      L("head {", "    body();", "}"),
      `${languageId} did not normalise`,
    );
  }
  assert.equal(
    dedentReplyCode(L("def f():", "        body()"), "python"),
    L("def f():", "    body()"),
  );
});

// ===== Python's one correction ==============================================

test("python: a body-only block keeps its own base (no step is added)", () => {
  assert.equal(
    dedentPyBody(L("raw = fetch(key)", "        if raw is None:", "            raise KeyError(key)")),
    L("raw = fetch(key)", "if raw is None:", "    raise KeyError(key)"),
  );
});

test("python: a body-only block that LEADS with a nested def keeps its own base", () => {
  // The siblings below the nested def sit at the head's own column, so the
  // measured base is right and the correction must not fire.
  assert.equal(
    dedentPyBody(
      L("        def helper():", "            return 1", "        return helper()"),
    ),
    L("def helper():", "    return 1", "return helper()"),
  );
});

test("python: a one-liner def opens no block below it, so no step is added", () => {
  assert.equal(
    dedentPyBody(L("def helper(): return 1", "        return helper()")),
    L("def helper(): return 1", "return helper()"),
  );
});

test("python: a multi-line def header needs no correction (the `):` returns to the column)", () => {
  assert.equal(
    dedentPyBody(L("def f(", "        a,", "        b,", "    ):", "        return a + b")),
    L("def f(", "    a,", "    b,", "):", "    return a + b"),
  );
});

test("python: a trailing comment on the header does not defeat the correction", () => {
  assert.equal(
    dedentPyBody(L("def f(self):  # note", "        return 1")),
    L("def f(self):  # note", "    return 1"),
  );
});

// ===== The EXACT path: a caller that knows the column the span was cut from ==
//
// Production holds that number. `resolveFunction` already hands the same
// `headerIndent` (or `bodyIndent`) to the placement leg on the way back, so the
// repair prompt passes it in as `spanIndent` and nothing is inferred. These
// pin the two things that separates it from the inferred path.

test("known base: python keeps the file's OWN step, where inference cannot", () => {
  // A 2-space file. Inference reads the body's column (2) as the base, flattens
  // the block, and the leg re-anchors to a 4-space step - correct Python, but
  // not this file's Python. The known base is the header's real column, so the
  // 2-space step survives.
  const span = L("def f(self):", "    return 1"); // header at 2, body at 4
  assert.equal(dedentPyBody(span, "  "), L("def f(self):", "  return 1"));
  assert.equal(dedentPyBody(span), L("def f(self):", "    return 1"));
});

test("known base: an 8-space python file keeps its 8-space step", () => {
  const span = L("def f(self):", "                return 1"); // header at 8, body at 16
  assert.equal(dedentPyBody(span, "        "), L("def f(self):", "        return 1"));
});

test("known base: the braced languages agree with what they inferred", () => {
  const rust = L("fn f() -> u32 {", "        let x = 1;", "        x", "    }");
  assert.equal(dedentRustBody(rust, "    "), dedentRustBody(rust));
  const ts = L("function f(): number {", "        const x = 1;", "        return x;", "    }");
  assert.equal(dedentTsBody(ts, "    "), dedentTsBody(ts));
  const cs = L("public int F()", "    {", "        return 1;", "    }");
  assert.equal(dedentCsBody(cs, "    "), dedentCsBody(cs));
  const go = L("func f() int {", "\t\treturn 1", "\t}");
  assert.equal(dedentGoBody(go, "\t"), dedentGoBody(go));
});

test("known base: an empty base is a no-op, so a top-level target is byte-exact", () => {
  const src = L("fn f() {", "    let x = 1;", "}");
  for (const lang of ["rust", "typescript", "csharp", "go", "python"]) {
    assert.equal(dedentReplyCode(src, lang, ""), src, lang);
  }
});

test("known base: a string interior is still byte-exact", () => {
  const span = L("fn f() {", '        let s = r#"', "        keep me", '        "#;', "    }");
  const out = dedentRustBody(span, "    ");
  assert.ok(out.includes("        keep me"), `raw-string interior moved: ${JSON.stringify(out)}`);
});

test("known base: dedent then place is identity, in all five languages", () => {
  const cases = [
    ["rust", "    ", L("fn f() -> u32 {", "        let x = 1;", "        x", "    }")],
    ["typescript", "    ", L("function f(): number {", "        const x = 1;", "        return x;", "    }")],
    ["csharp", "    ", L("public int F()", "    {", "        return 1;", "    }")],
    ["go", "\t", L("func f() int {", "\t\treturn 1", "\t}")],
    ["python", "    ", L("def f(self):", "        return 1")],
  ];
  for (const [lang, indent, span] of cases) {
    const zero = dedentReplyCode(span, lang, indent);
    const back = placeGeneratedReply(zero, { languageId: lang, headerIndent: indent });
    assert.equal(back, span, `${lang}: round trip changed the span`);
  }
});

test("known base: a SECOND round is identity too, which is the defect itself", () => {
  const indent = "    ";
  const span = L("fn f() -> u32 {", "        let x = 1;", "    }");
  let cur = span;
  for (let round = 1; round <= 3; round++) {
    cur = placeGeneratedReply(dedentReplyCode(cur, "rust", indent), {
      languageId: "rust",
      headerIndent: indent,
    });
    assert.equal(cur, span, `round ${round} drifted`);
  }
});

// ===== THREE write paths, not one =========================================
//
// The defect was found on the repair round, and repair was not the only caller
// feeding a model absolute columns and then placing the reply. `refine` is the
// third (generation is the first, and is 0-based by construction because the
// model writes the definition rather than being shown one). Review D1 measured
// refine walking a body 8 -> 12 -> 16 across three presses, the same shape as
// the capture. These rows exist so a fourth write path cannot be added without
// one of them going red.

const fencedOf = (prompt) => {
  const m = /```[a-zA-Z#+]*\n([\s\S]*?)```/.exec(prompt);
  return m ? m[1].replace(/\n$/, "") : undefined;
};

for (const [name, assemble] of [
  ["repair", (code, languageId, spanIndent) =>
    assembleRepairPrompt({ languageId, code, spanIndent, diagnostics: [{ level: "error", message: "boom", rendered: "boom\n" }] })],
  ["refine", (code, languageId, spanIndent) =>
    assembleRefinePrompt({ languageId, code, spanIndent })],
]) {
  test(`${name}: the fenced code is 0-based for a nested rust target`, () => {
    const span = L("fn total(&self) -> u32 {", "        let n = self.count;", "        n", "    }");
    assert.equal(
      fencedOf(assemble(span, "rust", "    ")),
      L("fn total(&self) -> u32 {", "    let n = self.count;", "    n", "}"),
    );
  });

  test(`${name}: three rounds over a nested target do not move the body`, () => {
    const indent = "    ";
    const span = L("fn total(&self) -> u32 {", "        let n = self.count;", "        n", "    }");
    let cur = span;
    for (let round = 1; round <= 3; round++) {
      // The model echoes the fence, which is what the capture showed it doing.
      const echoed = fencedOf(assemble(cur, "rust", indent));
      cur = placeGeneratedReply(echoed, { languageId: "rust", headerIndent: indent });
      assert.equal(cur, span, `${name} round ${round} drifted`);
    }
  });

  test(`${name}: an absent span column means DO NOT SHIFT, matching the placement leg`, () => {
    // Undefined reaches both directions as "" at the call sites. If the dedent
    // inferred here while the placement did nothing, the two would disagree
    // exactly where the code claims they cannot (review D2).
    const span = L("fn total(&self) -> u32 {", "        let n = self.count;", "    }");
    const echoed = fencedOf(assemble(span, "rust", ""));
    assert.equal(echoed, span, `${name}: an empty span column must not dedent`);
    assert.equal(placeGeneratedReply(echoed, { languageId: "rust", headerIndent: "" }), span);
  });
}
