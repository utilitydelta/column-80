// The five-language resolution rows for the doc-comment attachment pass
// (session-v32 phase 1, goal item 1), driving the REAL
// `resolveFunctionAtCursor` over a fake vscode module.
//
// The fixture geometry is not invented. Every symbol range below encodes what
// the LIVE server was measured to return on 2026-07-28 (session-v32
// scout-findings.md finding 1):
//
//   rust-analyzer  doc comments AND attributes INSIDE symbol.range
//   tsserver       doc lines EXCLUDED, decorators INCLUDED
//   Roslyn         `///` EXCLUDED, attributes INCLUDED
//   gopls          doc lines EXCLUDED
//   Pylance        `#` runs EXCLUDED, decorators INCLUDED
//
// So the symptom has two shapes and both are rows here: C# and a TS METHOD
// resolve to the enclosing CLASS today, while a top-level TS, Go or Python
// function resolves to NOTHING and the gesture refuses. Four of the five rows
// go from a refusal to a target, one goes from the wrong target to the right
// one. Rust is the control: its server already answers correctly, so the pass
// must never fire there.
//
// The stub is the shared one in `test/.vscode-stub.cjs`: real Position/Range so
// Range.contains and the span math run honestly, and the provider commands
// answering from a fixture map.
//
// Run: SKIP_LIVE=1 node --test test/impl-v32-p1-resolve.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleWithVscodeStub, makeDoc } = require("./.vscode-stub.cjs");

const { mod: surf, vscode, cleanup, error: surfErr } = bundleWithVscodeStub(
  "impl-v32-p1-resolve",
  `export { resolveFunctionAtCursor } from "../src/vscode/fnGen";\n`,
);
test.after(cleanup);

const { Position, Range } = vscode;
const P = (l, c) => new Position(l, c);
const R = (sl, sc, el, ec) => new Range(sl, sc, el, ec);
const K = vscode.SymbolKind;
const sym = (name, kind, range, sel, children = []) => ({ name, detail: "", kind, range, selectionRange: sel, children });

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (surfErr) return ctx.skip(`surface bundle failed to build: ${surfErr.message}`);
    return fn(ctx);
  });

test("bundle guard: resolveFunctionAtCursor builds headless against the vscode stub", () => {
  if (surfErr) assert.fail(`surface bundle failed: ${surfErr.message}`);
});

// One row: fixture text + symbol tree, resolve at a cursor, hand back the record.
async function resolveAt(fixture, line, character, admitTypes) {
  const uriStr = `file:///fixture/${fixture.name}`;
  const doc = makeDoc(vscode, fixture.text, uriStr, fixture.languageId);
  globalThis.__C80_SYMBOLS__ = { [uriStr]: fixture.symbols(R) };
  globalThis.__C80_DOCS__ = { [uriStr]: doc };
  globalThis.__C80_OPEN_DOCS__ = [doc];
  return surf.resolveFunctionAtCursor(doc, P(line, character), admitTypes);
}

// ===========================================================================
// Rust — the CONTROL. rust-analyzer puts the doc comment INSIDE symbol.range,
// so innermostFunction already answers the function and the attachment pass
// must never fire. Any change here is a regression, not a fix.
// ===========================================================================
const RUST = {
  name: "lib.rs",
  languageId: "rust",
  //  0 /// Fan out the stripe totals.
  //  1 /// Zero until the oracle lands.
  //  2 pub fn stripe_total_fanout() -> u32 {
  //  3     0
  //  4 }
  //  5
  //  6 /// A band of levels of detail.
  //  7 pub struct LodBand {
  //  8     pub lo: u32,
  //  9 }
  text: [
    "/// Fan out the stripe totals.",
    "/// Zero until the oracle lands.",
    "pub fn stripe_total_fanout() -> u32 {",
    "    0",
    "}",
    "",
    "/// A band of levels of detail.",
    "pub struct LodBand {",
    "    pub lo: u32,",
    "}",
  ].join("\n"),
  symbols: (R) => [
    sym("stripe_total_fanout", K.Function, R(0, 0, 4, 1), R(2, 7, 2, 26)),
    sym("LodBand", K.Struct, R(6, 0, 9, 1), R(7, 11, 7, 18), [sym("lo", K.Field, R(8, 4, 8, 16), R(8, 8, 8, 10))]),
  ],
};

gtest("rust: a cursor in the doc comment resolves to the function, as it already did", async () => {
  for (const line of [0, 1]) {
    const r = await resolveAt(RUST, line, 4, false);
    assert.strictEqual(r?.symbolName, "stripe_total_fanout", `doc line ${line}`);
  }
});

gtest("rust: the resolved span still starts at the declaration head, not the doc", async () => {
  const cursorInDoc = await resolveAt(RUST, 0, 4, false);
  const cursorInBody = await resolveAt(RUST, 3, 4, false);
  // The doc lines are trivia the head walk skips; a doc cursor and a body
  // cursor must produce the SAME record, or the pass has changed Rust.
  assert.deepStrictEqual(cursorInDoc.span, cursorInBody.span);
  assert.strictEqual(cursorInDoc.signature, cursorInBody.signature);
  assert.strictEqual(cursorInDoc.docComment, cursorInBody.docComment);
});

gtest("rust: a cursor in a struct's doc comment resolves to the struct, not to a field", async () => {
  const r = await resolveAt(RUST, 6, 4, true);
  assert.strictEqual(r?.symbolName, "LodBand");
  assert.strictEqual(r?.kind, "struct");
});

// ===========================================================================
// TypeScript — tsserver EXCLUDES doc lines from range. A top-level function's
// doc cursor resolves to NOTHING today; the class/method pair resolves to the
// CLASS. Both are rows.
// ===========================================================================
const TS = {
  name: "fanout.ts",
  languageId: "typescript",
  //  0 /**
  //  1  * Fan out the stripe totals.
  //  2  */
  //  3 export function stripeFanout(): number {
  //  4   return 0;
  //  5 }
  //  6
  //  7 export class StripeAuditor {
  //  8   /**
  //  9    * Audit one band.
  // 10    */
  // 11   auditBands(): void {}
  // 12 }
  text: [
    "/**",
    " * Fan out the stripe totals.",
    " */",
    "export function stripeFanout(): number {",
    "  return 0;",
    "}",
    "",
    "export class StripeAuditor {",
    "  /**",
    "   * Audit one band.",
    "   */",
    "  auditBands(): void {}",
    "}",
  ].join("\n"),
  symbols: (R) => [
    // Doc lines 0-2 are OUTSIDE the range: measured, not assumed.
    sym("stripeFanout", K.Function, R(3, 0, 5, 1), R(3, 16, 3, 28)),
    sym("StripeAuditor", K.Class, R(7, 0, 12, 1), R(7, 13, 7, 26), [
      sym("auditBands", K.Method, R(11, 2, 11, 23), R(11, 2, 11, 12)),
    ]),
  ],
};

gtest("ts: a cursor anywhere in a top-level function's JSDoc resolves to the function", async () => {
  for (const line of [0, 1, 2]) {
    const r = await resolveAt(TS, line, 1, false);
    assert.strictEqual(r?.symbolName, "stripeFanout", `JSDoc line ${line} (opener, interior, closer)`);
  }
});

gtest("ts: a cursor in a method's JSDoc resolves to the method, not the class", async () => {
  for (const admitTypes of [false, true]) {
    for (const line of [8, 9, 10]) {
      const r = await resolveAt(TS, line, 3, admitTypes);
      assert.strictEqual(r?.symbolName, "auditBands", `line ${line}, admitTypes=${admitTypes}`);
      assert.strictEqual(r?.kind, "function");
    }
  }
});

gtest("ts: a cursor in the CLASS's own doc comment resolves to the class (the regression guard)", async () => {
  const fixture = {
    name: "auditor.ts",
    languageId: "typescript",
    //  0 /**
    //  1  * Audits stripe bands.
    //  2  */
    //  3 export class StripeAuditor {
    //  4   /** Audit one band. */
    //  5   auditBands(): void {}
    //  6 }
    text: [
      "/**",
      " * Audits stripe bands.",
      " */",
      "export class StripeAuditor {",
      "  /** Audit one band. */",
      "  auditBands(): void {}",
      "}",
    ].join("\n"),
    symbols: (R) => [
      sym("StripeAuditor", K.Class, R(3, 0, 6, 1), R(3, 13, 3, 26), [
        sym("auditBands", K.Method, R(5, 2, 5, 23), R(5, 2, 5, 12)),
      ]),
    ],
  };
  for (const line of [0, 1, 2]) {
    const r = await resolveAt(fixture, line, 1, true);
    assert.strictEqual(r?.symbolName, "StripeAuditor", `class doc line ${line} must not steal the method`);
    assert.strictEqual(r?.kind, "class");
  }
  // With types not admitted the class is not a target at all, so a doc cursor
  // has nothing to resolve to and refuses. It must NOT fall through to the
  // method, which is the failure the nearest-below rule prevents.
  for (const line of [0, 1, 2]) {
    assert.strictEqual(await resolveAt(fixture, line, 1, false), undefined, `class doc line ${line}, types not admitted`);
  }
});

gtest("ts: a JSDoc with a decorator between it and the head still attaches", async () => {
  const fixture = {
    name: "widgets.ts",
    languageId: "typescript",
    //  0 /**
    //  1  * The widget list.
    //  2  */
    //  3 @Component({
    //  4   selector: "app-widgets",
    //  5 })
    //  6 export class Widgets {
    //  7   render(): void {}
    //  8 }
    text: [
      "/**",
      " * The widget list.",
      " */",
      "@Component({",
      '  selector: "app-widgets",',
      "})",
      "export class Widgets {",
      "  render(): void {}",
      "}",
    ].join("\n"),
    // tsserver INCLUDES decorators in the range and excludes the doc, so the
    // range starts at the decorator on line 3.
    symbols: (R) => [
      sym("Widgets", K.Class, R(3, 0, 8, 1), R(6, 13, 6, 20), [
        sym("render", K.Method, R(7, 2, 7, 19), R(7, 2, 7, 8)),
      ]),
    ],
  };
  for (const line of [0, 1, 2]) {
    const r = await resolveAt(fixture, line, 1, true);
    assert.strictEqual(r?.symbolName, "Widgets", `doc line ${line} above a multi-line decorator`);
  }
});

gtest("ts: a free-floating comment behind a blank line resolves as it does today", async () => {
  const fixture = {
    name: "sections.ts",
    languageId: "typescript",
    //  0 // ---- fanout section ----
    //  1
    //  2 /** Fan out. */
    //  3 export function stripeFanout(): number {
    //  4   return 0;
    //  5 }
    text: [
      "// ---- fanout section ----",
      "",
      "/** Fan out. */",
      "export function stripeFanout(): number {",
      "  return 0;",
      "}",
    ].join("\n"),
    symbols: (R) => [sym("stripeFanout", K.Function, R(3, 0, 5, 1), R(3, 16, 3, 28))],
  };
  assert.strictEqual(await resolveAt(fixture, 0, 4, false), undefined, "the section marker owns nothing");
  assert.strictEqual(await resolveAt(fixture, 1, 0, false), undefined, "the blank line owns nothing");
  const r = await resolveAt(fixture, 2, 4, false);
  assert.strictEqual(r?.symbolName, "stripeFanout", "the contiguous doc still attaches");
});

gtest("ts: a cursor inside a function body is byte-identical to today", async () => {
  const body = await resolveAt(TS, 4, 5, false);
  assert.strictEqual(body?.symbolName, "stripeFanout");
  assert.strictEqual(body?.signature, "export function stripeFanout(): number");
  assert.strictEqual(body?.docComment, "/**\n * Fan out the stripe totals.\n */");
  // Resolving from the head line must give the identical record. The
  // post-accept oracle re-resolves at the declaration head, and its answer is
  // the one this pass must not disturb (scout finding, open question 2).
  const head = await resolveAt(TS, 3, 0, false);
  assert.deepStrictEqual(head.span, body.span);
  assert.strictEqual(head.signature, body.signature);
  assert.strictEqual(head.docComment, body.docComment);
});

// ===========================================================================
// C# — Roslyn EXCLUDES `///` and INCLUDES attributes, and wraps everything in a
// file-scoped Namespace. This is the row that goes from the WRONG TARGET to the
// right one rather than from a refusal.
// ===========================================================================
const CS = {
  name: "Fns.cs",
  languageId: "csharp",
  //  0 namespace Playground;
  //  1
  //  2 public class Fns
  //  3 {
  //  4     /// <summary>Fan out the stripe totals.</summary>
  //  5     [Fact]
  //  6     public static int StripeFanout()
  //  7     {
  //  8         return 0;
  //  9     }
  // 10 }
  text: [
    "namespace Playground;",
    "",
    "public class Fns",
    "{",
    "    /// <summary>Fan out the stripe totals.</summary>",
    "    [Fact]",
    "    public static int StripeFanout()",
    "    {",
    "        return 0;",
    "    }",
    "}",
  ].join("\n"),
  symbols: (R) => [
    sym("Playground", K.Namespace, R(0, 0, 10, 1), R(0, 10, 0, 20), [
      sym("Fns", K.Class, R(2, 0, 10, 1), R(2, 13, 2, 16), [
        // The attribute on line 5 is INSIDE the range; the `///` on line 4 is not.
        sym("StripeFanout", K.Method, R(5, 4, 9, 5), R(6, 22, 6, 34)),
      ]),
    ]),
  ],
};

gtest("csharp: a cursor in the `///` doc resolves to the method, not the enclosing class", async () => {
  for (const admitTypes of [false, true]) {
    const r = await resolveAt(CS, 4, 10, admitTypes);
    assert.strictEqual(r?.symbolName, "StripeFanout", `admitTypes=${admitTypes}`);
    assert.strictEqual(r?.kind, "function");
  }
});

gtest("csharp: the attached method still carries its `///` doc AND its attribute", async () => {
  const fromDoc = await resolveAt(CS, 4, 10, false);
  const fromBody = await resolveAt(CS, 8, 10, false);
  // The doc channel is built off the resolved symbol, so attaching must produce
  // the same record a body cursor does. If the attribute ate the doc, or the doc
  // was dropped, this is where it shows.
  assert.deepStrictEqual(fromDoc.span, fromBody.span);
  assert.strictEqual(fromDoc.docComment, fromBody.docComment);
  assert.match(fromDoc.docComment, /<summary>Fan out the stripe totals\.<\/summary>/);
  assert.match(fromDoc.docComment, /\[Fact\]/);
});

gtest("csharp: a cursor in the class's own `///` doc resolves to the class", async () => {
  const fixture = {
    name: "Documented.cs",
    languageId: "csharp",
    //  0 namespace Playground;
    //  1
    //  2 /// <summary>Stripe helpers.</summary>
    //  3 public class Fns
    //  4 {
    //  5     /// <summary>Fan out.</summary>
    //  6     public static int StripeFanout() => 0;
    //  7 }
    text: [
      "namespace Playground;",
      "",
      "/// <summary>Stripe helpers.</summary>",
      "public class Fns",
      "{",
      "    /// <summary>Fan out.</summary>",
      "    public static int StripeFanout() => 0;",
      "}",
    ].join("\n"),
    symbols: (R) => [
      sym("Playground", K.Namespace, R(0, 0, 7, 1), R(0, 10, 0, 20), [
        sym("Fns", K.Class, R(3, 0, 7, 1), R(3, 13, 3, 16), [
          sym("StripeFanout", K.Method, R(6, 4, 6, 42), R(6, 22, 6, 34)),
        ]),
      ]),
    ],
  };
  const cls = await resolveAt(fixture, 2, 10, true);
  assert.strictEqual(cls?.symbolName, "Fns");
  assert.strictEqual(cls?.kind, "class");
  const method = await resolveAt(fixture, 5, 10, true);
  assert.strictEqual(method?.symbolName, "StripeFanout");
});

// ===========================================================================
// Go — gopls EXCLUDES doc lines. A refusal turns into a target.
// ===========================================================================
const GO = {
  name: "fanout.go",
  languageId: "go",
  //  0 package main
  //  1
  //  2 // stripeFanout fans out the stripe totals.
  //  3 // It returns zero until the oracle lands.
  //  4 func stripeFanout() uint32 {
  //  5 	return 0
  //  6 }
  text: [
    "package main",
    "",
    "// stripeFanout fans out the stripe totals.",
    "// It returns zero until the oracle lands.",
    "func stripeFanout() uint32 {",
    "\treturn 0",
    "}",
  ].join("\n"),
  symbols: (R) => [sym("stripeFanout", K.Function, R(4, 0, 6, 1), R(4, 5, 4, 17))],
};

gtest("go: a cursor in either `//` doc line resolves to the function", async () => {
  for (const line of [2, 3]) {
    const r = await resolveAt(GO, line, 6, false);
    assert.strictEqual(r?.symbolName, "stripeFanout", `doc line ${line}`);
    assert.strictEqual(r?.signature, "func stripeFanout() uint32");
  }
});

gtest("go: a cursor in a struct's doc comment resolves to the struct", async () => {
  const fixture = {
    name: "band.go",
    languageId: "go",
    //  0 package main
    //  1
    //  2 // LodBand is a band of levels of detail.
    //  3 type LodBand struct {
    //  4 	Lo uint32
    //  5 }
    text: ["package main", "", "// LodBand is a band of levels of detail.", "type LodBand struct {", "\tLo uint32", "}"].join("\n"),
    symbols: (R) => [
      sym("LodBand", K.Struct, R(3, 0, 5, 1), R(3, 5, 3, 12), [sym("Lo", K.Field, R(4, 1, 4, 10), R(4, 1, 4, 3))]),
    ],
  };
  const r = await resolveAt(fixture, 2, 6, true);
  assert.strictEqual(r?.symbolName, "LodBand");
  assert.strictEqual(r?.kind, "struct");
});

// ===========================================================================
// Python — Pylance EXCLUDES `#` runs and INCLUDES decorators, which is exactly
// why resolveFunctionAtCursor passes ["#"] to the head walk. The attachment
// pass has to pass it too, or a `#` run above a decorator does not attach.
// ===========================================================================
const PY = {
  name: "fns.py",
  languageId: "python",
  //  0 class Fns:
  //  1     # add two numbers
  //  2     @staticmethod
  //  3     def spike_add(a: int, b: int) -> int:
  //  4         return a + b
  text: [
    "class Fns:",
    "    # add two numbers",
    "    @staticmethod",
    "    def spike_add(a: int, b: int) -> int:",
    "        return a + b",
  ].join("\n"),
  symbols: (R) => [
    sym("Fns", K.Class, R(0, 0, 4, 20), R(0, 6, 0, 9), [
      // The decorator on line 2 is INSIDE the range; the `#` on line 1 is not.
      sym("spike_add", K.Method, R(2, 4, 4, 20), R(3, 8, 3, 17)),
    ]),
  ],
};

gtest("python: a cursor in a `#` run above a decorator resolves to the method", async () => {
  for (const admitTypes of [false, true]) {
    const r = await resolveAt(PY, 1, 8, admitTypes);
    assert.strictEqual(r?.symbolName, "spike_add", `admitTypes=${admitTypes}`);
    assert.strictEqual(r?.kind, "function");
  }
});

gtest("python: a top-level function's `#` doc run resolves to the function", async () => {
  const fixture = {
    name: "top.py",
    languageId: "python",
    //  0 # fan out the stripe totals
    //  1 # zero until the oracle lands
    //  2 def stripe_fanout() -> int:
    //  3     return 0
    text: ["# fan out the stripe totals", "# zero until the oracle lands", "def stripe_fanout() -> int:", "    return 0"].join("\n"),
    symbols: (R) => [sym("stripe_fanout", K.Function, R(2, 0, 3, 12), R(2, 4, 2, 17))],
  };
  for (const line of [0, 1]) {
    const r = await resolveAt(fixture, line, 4, false);
    assert.strictEqual(r?.symbolName, "stripe_fanout", `# doc line ${line}`);
  }
});

gtest("python: a cursor in the class's own `#` comment resolves to the class", async () => {
  const fixture = {
    name: "documented.py",
    languageId: "python",
    //  0 # stripe helpers
    //  1 class Fns:
    //  2     # add two numbers
    //  3     def spike_add(a: int, b: int) -> int:
    //  4         return a + b
    text: ["# stripe helpers", "class Fns:", "    # add two numbers", "    def spike_add(a: int, b: int) -> int:", "        return a + b"].join("\n"),
    symbols: (R) => [
      sym("Fns", K.Class, R(1, 0, 4, 20), R(1, 6, 1, 9), [sym("spike_add", K.Method, R(3, 4, 4, 20), R(3, 8, 3, 17))]),
    ],
  };
  const cls = await resolveAt(fixture, 0, 4, true);
  assert.strictEqual(cls?.symbolName, "Fns");
  const method = await resolveAt(fixture, 2, 8, true);
  assert.strictEqual(method?.symbolName, "spike_add");
});

// ===========================================================================
// Cross-language: what must NOT change.
// ===========================================================================

gtest("a cursor outside every symbol and every trivia run still refuses", async () => {
  const fixture = {
    name: "gap.ts",
    languageId: "typescript",
    //  0 const unrelated = 1;
    //  1
    //  2 /** Fan out. */
    //  3 export function stripeFanout(): number {
    //  4   return 0;
    //  5 }
    text: ["const unrelated = 1;", "", "/** Fan out. */", "export function stripeFanout(): number {", "  return 0;", "}"].join("\n"),
    symbols: (R) => [sym("stripeFanout", K.Function, R(3, 0, 5, 1), R(3, 16, 3, 28))],
  };
  assert.strictEqual(await resolveAt(fixture, 0, 5, false), undefined, "a code line above the run");
  assert.strictEqual(await resolveAt(fixture, 1, 0, false), undefined, "the blank between");
});

gtest("a cursor on the previous function's closing brace does not attach to the next one", async () => {
  const fixture = {
    name: "pair.ts",
    languageId: "typescript",
    //  0 /** A. */
    //  1 export function a(): number {
    //  2   return 1;
    //  3 }
    //  4 /** B. */
    //  5 export function b(): number {
    //  6   return 2;
    //  7 }
    text: ["/** A. */", "export function a(): number {", "  return 1;", "}", "/** B. */", "export function b(): number {", "  return 2;", "}"].join("\n"),
    symbols: (R) => [
      sym("a", K.Function, R(1, 0, 3, 1), R(1, 16, 1, 17)),
      sym("b", K.Function, R(5, 0, 7, 1), R(5, 16, 5, 17)),
    ],
  };
  // Line 3 is inside a's range, so it resolves to `a`. The closer guard in
  // attachRunStart is what keeps that true even if the geometry ever shifts.
  const r = await resolveAt(fixture, 3, 0, false);
  assert.strictEqual(r?.symbolName, "a");
});

gtest("an empty symbol tree still refuses rather than throwing", async () => {
  const fixture = {
    name: "empty.ts",
    languageId: "typescript",
    text: ["/** orphan doc */", ""].join("\n"),
    symbols: () => [],
  };
  assert.strictEqual(await resolveAt(fixture, 0, 3, false), undefined);
  assert.strictEqual(await resolveAt(fixture, 0, 3, true), undefined);
});
