// BLIND ORACLE for session-v55 phase 11 (Q12): the repair surface has no
// `excludeName`. Bound to `session-v55/contract-phase11.md` and to
// `session-v36/scraps.md` S36-3 (`[RECORD] E6`), written before the fix exists.
//
// Two pure core functions are driven directly over an esbuild bundle, with no
// vscode stub: `spanTypesInPlay` (`src/core/repairTypes.ts`) and `refineTargets`
// (`src/core/refine.ts`). Nothing here reads either function's body. The input
// shapes come from the exported interfaces and the doc comments; every expected
// value below was MEASURED against the pre-fix bundle and inlined, so this file
// stands alone.
//
// THE DEFECT. Both prose legs - the span's own body comments, and the doc
// comment - hand `undefined` down as `excludeName`. So a backticked mention of
// the repair target's OWN NAME comes back as a candidate collaborator and
// spends a slot of a cap. Under a cap that is an eviction of something real.
//
// Run: SKIP_LIVE=1 node --test test/blind-v55-p11-exclude-name.test.cjs
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE COULD NOT WITNESS, AND WHAT CONTRADICTS THE CONTRACT
// ---------------------------------------------------------------------------
//
// 1. CONTRACT ITEM 4 IS ALL BUT UNOBSERVABLE AT `refineTargets`, and this is
//    measured, not suspected. `refineTargets` reports a DOCUMENT POSITION for
//    every target, and it takes those positions from comment- and string-MASKED
//    span text. A name that reaches `spanTypesInPlay` only through a prose leg
//    has no position in masked text, so it is dropped before it can ever be
//    returned. Measured on the pre-fix bundle:
//
//      code:   void Build() { /* line comment */ Log("StripeFanout"); Log(Alpha); }
//              with `StripeFanout` backticked in the comment
//      types:  ["Alpha","StripeFanout"]
//      refine: [{ name: "Alpha", via: "type" }]        <- StripeFanout gone
//
//    It is not a cap effect either: measured at max 1, 2, 3 and 8 the answer is
//    the same single `Alpha`, so an unlocatable prose name does not even spend a
//    budget slot. And a prose name that IS locatable in masked code is a name
//    the body-CODE leg has already supplied, and that leg is out of scope by the
//    contract's own section, so it survives the fix regardless.
//
//    Section G therefore drives the one shape where the prose leg IS
//    observable: a span carrying an UNTERMINATED block comment (or, in Python,
//    an unterminated `"""`). There the masking falls back to raw text, the
//    backticked comment name acquires a real position, and it comes back as a
//    `via: "type"` target today. That is a degenerate span, but it is a span a
//    developer mid-edit genuinely has, and it is exactly when repair fires.
//    Section G's rows are anti-vacuity paired: strip the backticks from the same
//    fixture and types-in-play is `[]` and refine returns `[]`, so the targets
//    provably come from the backtick comment leg and nothing else.
//
//    CONSEQUENCE FOR THE BUILD: threading the field through `RefineTargetInput`
//    is still right - a refine and a repair must not disagree - but the payoff
//    the contract implies (a refine round that stops asking the reference
//    provider about the target itself) is already delivered by the masking, for
//    every non-degenerate span. Do not expect a measurable refine saving.
//
// 2. WHERE THE GO REDUCTION LIVES IS AN ASSUMPTION THIS FILE PINS. Contract item
//    4 says `oracleSurface.ts:603` "has `resolved` in hand and passes it
//    directly", so the reduction of `(*Stripe).Summarize` to `Summarize` must
//    happen INSIDE `spanTypesInPlay`. Section D asserts exactly that. If the
//    build instead reduces at each call site and lets `spanTypesInPlay` take an
//    already-bare name, D2/D3/D5 go red on a correct fix - and that is a
//    contract disagreement worth surfacing, not a test to soften. D4 pins the
//    already-bare name and holds either way.
//
// 3. THE NON-GO REDUCTION IS UNSPECIFIED AND NOT ASSERTED. `parseGoReceiverSymbol`
//    answers `undefined` for `StripeFanout`, `Summarize` and `Stripe.Summarize`
//    alike (measured), so the `?? excludeName` fallback `fnGen.ts:5012` uses is
//    load-bearing for the other four languages. What a DOTTED C# or Python
//    symbol name should do - `Billing.StripeFanout` reduces under
//    `/^[A-Za-z_][A-Za-z0-9_]*/` to `Billing`, which excludes the wrong thing -
//    is outside the contract. No row here asserts it.
//
// 4. `resolvePrefill`'s own placement (`fnGen.ts:2524`) and the two
//    `refineTargets` call sites (`oracleSurface.ts:1033`, `:1281`) are vscode-layer
//    wiring. This file cannot reach them; it pins the two core contracts they
//    must satisfy.
//
// EXPECTED AT THE TIME OF WRITING: sections A, B, C, D2-D5 and G are RED.
// Sections D1, E and F are GREEN today and must stay green after the fix.

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v55-p11-exclude-name",
  `export { spanTypesInPlay } from "../src/core/repairTypes";
   export { refineTargets } from "../src/core/refine";\n`,
);
const { spanTypesInPlay, refineTargets } = mod;
test.after(cleanup);

const LANGS = ["csharp", "rust", "typescript", "python", "go"];

// Each language's real comment opener and the shape of a body that names NO
// type of its own, so a comment or a doc comment is the only thing in the
// fixture that could possibly resolve.
const SPAN = {
  rust: { head: "fn build() {", tail: "}", line: "//", indent: "    " },
  csharp: { head: "void build() {", tail: "}", line: "//", indent: "    " },
  typescript: { head: "function build() {", tail: "}", line: "//", indent: "  " },
  python: { head: "def build():", tail: "    pass", line: "#", indent: "    " },
  go: { head: "func build() {", tail: "}", line: "//", indent: "\t" },
};

const span = (languageId, ...bodyLines) => {
  const s = SPAN[languageId];
  return [s.head, ...bodyLines.map((l) => `${s.indent}${l}`), s.tail].join("\n");
};

// The repair target's own name, and a genuinely different type sitting in the
// same sentence. Every defect row below asserts BOTH halves: the self name is
// gone AND the peer survives, so a row cannot go green because the leg died.
const SELF = "StripeFanout";
const PEER_C = "CommentPeer";
const PEER_D = "DocPeer";

const commentSpan = (languageId) =>
  span(languageId, `${SPAN[languageId].line} folds a \`${PEER_C}\` for \`${SELF}\``);
const DOC = `Folds a \`${PEER_D}\` for \`${SELF}\`.`;

// ===========================================================================
// SECTION A. The body-comment leg (contract item 1, first half).
//
// C# leads: it is the language `[RECORD] E6` was measured on and the row that
// reproduces the original finding. Then the other four, because the exclusion
// is a per-language string question.
// ===========================================================================

test("A0 [csharp] anti-vacuity: the peer and the self name BOTH resolve today", () => {
  // Pre-fix capture. If this row ever changes, every A row below is measuring
  // a different fixture and their reds mean nothing.
  assert.deepEqual(spanTypesInPlay({ languageId: "csharp", code: commentSpan("csharp") }), [
    PEER_C,
    SELF,
  ]);
});

test("A1 [csharp] a body comment naming the target yields no self-candidate", () => {
  const out = spanTypesInPlay({
    languageId: "csharp",
    code: commentSpan("csharp"),
    excludeName: SELF,
  });
  assert.deepEqual(out, [PEER_C], `self name survived the comment leg: ${JSON.stringify(out)}`);
});

for (const languageId of LANGS.filter((l) => l !== "csharp")) {
  test(`A2 [${languageId}] a body comment naming the target yields no self-candidate`, () => {
    const code = commentSpan(languageId);
    assert.deepEqual(
      spanTypesInPlay({ languageId, code }),
      [PEER_C, SELF],
      "fixture drifted: both names must resolve without excludeName",
    );
    const out = spanTypesInPlay({ languageId, code, excludeName: SELF });
    assert.deepEqual(out, [PEER_C], `self name survived: ${JSON.stringify(out)}`);
  });
}

// ===========================================================================
// SECTION B. The doc-comment leg (contract item 1, second half).
//
// S36-3's own reasoning: this leg has carried the hole since before the comment
// leg existed. Contract item 2 makes it half of the falsification line.
// ===========================================================================

for (const languageId of LANGS) {
  test(`B1 [${languageId}] a doc comment naming the target yields no self-candidate`, () => {
    const code = span(languageId);
    assert.deepEqual(
      spanTypesInPlay({ languageId, code, docComment: DOC }),
      [PEER_D, SELF],
      "fixture drifted: both names must resolve without excludeName",
    );
    const out = spanTypesInPlay({ languageId, code, docComment: DOC, excludeName: SELF });
    assert.deepEqual(out, [PEER_D], `self name survived the doc leg: ${JSON.stringify(out)}`);
  });
}

// ===========================================================================
// SECTION C. Both legs at once - contract item 2, "both legs or neither".
//
// A fix that wires one leg and not the other passes half of A/B and fails here,
// which is the point of the section.
// ===========================================================================

for (const languageId of LANGS) {
  test(`C1 [${languageId}] both prose legs at once drop the self name and keep both peers`, () => {
    const code = commentSpan(languageId);
    assert.deepEqual(
      spanTypesInPlay({ languageId, code, docComment: DOC }),
      [PEER_C, SELF, PEER_D],
      "fixture drifted: comment tier leads the doc tier, self name deduped first-seen",
    );
    const out = spanTypesInPlay({ languageId, code, docComment: DOC, excludeName: SELF });
    assert.deepEqual(
      out,
      [PEER_C, PEER_D],
      `one leg or the other still admits the self name: ${JSON.stringify(out)}`,
    );
  });
}

// ===========================================================================
// SECTION D. Go needs a reduction, and the receiver is not what gets excluded
// (contract item 3).
// ===========================================================================

const GO_SYMBOL = "(*Stripe).Summarize";
const GO_SPAN = span(
  "go",
  "// `Summarize` folds a `LedgerRow` for the owning `Stripe`",
);
const GO_SPAN_TYPES = ["Summarize", "LedgerRow", "Stripe"];

test("D1 a raw gopls method symbol reduces to NOTHING under the bare-name regex", () => {
  // Pure measurement, no product call. This is WHY an unreduced Go symbol
  // excludes nothing: `excludeBare` inside both prose readers is
  // `excludeName?.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0]`, and the first
  // character of a gopls method symbol is `(`.
  assert.equal("(*Stripe).Summarize".match(/^[A-Za-z_][A-Za-z0-9_]*/), null);
  assert.equal("(Tile).SubtendedChildren".match(/^[A-Za-z_][A-Za-z0-9_]*/), null);
  // The receiver-free form does reduce, which is the shape the reader expects.
  assert.equal("Summarize".match(/^[A-Za-z_][A-Za-z0-9_]*/)[0], "Summarize");
});

test("D2 [go] the gopls symbol name excludes the MEMBER", () => {
  assert.deepEqual(
    spanTypesInPlay({ languageId: "go", code: GO_SPAN }),
    GO_SPAN_TYPES,
    "fixture drifted",
  );
  const out = spanTypesInPlay({ languageId: "go", code: GO_SPAN, excludeName: GO_SYMBOL });
  assert.ok(
    !out.includes("Summarize"),
    `the raw gopls symbol excluded nothing: ${JSON.stringify(out)}`,
  );
});

test("D3 [go] the RECEIVER is not excluded - it is a real collaborator", () => {
  const out = spanTypesInPlay({ languageId: "go", code: GO_SPAN, excludeName: GO_SYMBOL });
  assert.deepEqual(
    out,
    ["LedgerRow", "Stripe"],
    `expected the member gone and the receiver kept, got ${JSON.stringify(out)}`,
  );
});

test("D4 [go] an already-bare symbol name still excludes", () => {
  // `parseGoReceiverSymbol("Summarize")` is undefined, so the reduction must
  // fall back to the name itself, exactly as `fnGen.ts:5012` does with
  // `?? excludeName`.
  const out = spanTypesInPlay({ languageId: "go", code: GO_SPAN, excludeName: "Summarize" });
  assert.deepEqual(out, ["LedgerRow", "Stripe"], JSON.stringify(out));
});

test("D5 [go] the value-receiver spelling reduces the same way", () => {
  const code = span("go", "// `SubtendedChildren` walks each `Tile` into a `LedgerRow`");
  assert.deepEqual(
    spanTypesInPlay({ languageId: "go", code }),
    ["SubtendedChildren", "Tile", "LedgerRow"],
    "fixture drifted",
  );
  const out = spanTypesInPlay({
    languageId: "go",
    code,
    excludeName: "(Tile).SubtendedChildren",
  });
  assert.deepEqual(out, ["Tile", "LedgerRow"], JSON.stringify(out));
});

test("D6 [go] the doc leg takes the same reduction as the comment leg", () => {
  const code = span("go");
  const docComment = "`Summarize` folds a `LedgerRow` for the owning `Stripe`.";
  assert.deepEqual(
    spanTypesInPlay({ languageId: "go", code, docComment }),
    GO_SPAN_TYPES,
    "fixture drifted",
  );
  const out = spanTypesInPlay({ languageId: "go", code, docComment, excludeName: GO_SYMBOL });
  assert.deepEqual(out, ["LedgerRow", "Stripe"], JSON.stringify(out));
});

test("D7 [go] a real method span keeps its signature types and loses only the prose self-mention", () => {
  const signature = "func (s *Stripe) Summarize(row LedgerRow) Receipt";
  const code = [
    "func (s *Stripe) Summarize(row LedgerRow) Receipt {",
    "\t// `Summarize` folds each `LedgerRow` for the owning `Stripe`",
    "\treturn Receipt{}",
    "}",
  ].join("\n");
  assert.deepEqual(
    spanTypesInPlay({ languageId: "go", signature, code }),
    ["Stripe", "LedgerRow", "Receipt", "Summarize"],
    "fixture drifted",
  );
  const out = spanTypesInPlay({ languageId: "go", signature, code, excludeName: GO_SYMBOL });
  assert.deepEqual(out, ["Stripe", "LedgerRow", "Receipt"], JSON.stringify(out));
});

// ===========================================================================
// SECTION E. Absent stays absent (contract item 5).
//
// Every expected list below was captured from the PRE-FIX bundle. They are
// literals on purpose: a regression anywhere in the reader, in any leg, in any
// language, goes red here even if the exclusion itself is perfect.
// ===========================================================================

// A five-leg fixture per language: signature, body code, body comment, doc
// comment, diagnostics. Each leg contributes one name nothing else can supply,
// plus the shared `StripeFanout` so the dedupe order is visible too.
const FIVE_LEG = {
  rust: {
    signature: "fn build(row: LedgerRow) -> Receipt",
    head: "fn build(row: LedgerRow) -> Receipt {",
    body: "let v = BodyOnly::new();",
    tail: "}",
    line: "//",
    indent: "    ",
    expected: ["LedgerRow", "Receipt", "BodyOnly", "CommentOnly", "StripeFanout", "DocOnly", "DiagOnly"],
  },
  typescript: {
    signature: "function build(row: LedgerRow): Receipt",
    head: "function build(row: LedgerRow): Receipt {",
    body: "const v = new BodyOnly();",
    tail: "}",
    line: "//",
    indent: "  ",
    expected: ["LedgerRow", "Receipt", "BodyOnly", "CommentOnly", "StripeFanout", "DocOnly", "DiagOnly"],
  },
  csharp: {
    signature: "Receipt Build(LedgerRow row)",
    head: "Receipt Build(LedgerRow row) {",
    body: "var v = new BodyOnly();",
    tail: "}",
    line: "//",
    indent: "    ",
    expected: ["Receipt", "LedgerRow", "BodyOnly", "CommentOnly", "StripeFanout", "DocOnly", "DiagOnly"],
  },
  python: {
    signature: "def build(row: LedgerRow) -> Receipt",
    head: "def build(row: LedgerRow) -> Receipt:",
    body: "v = BodyOnly()",
    tail: "    pass",
    line: "#",
    indent: "    ",
    expected: ["LedgerRow", "Receipt", "BodyOnly", "CommentOnly", "StripeFanout", "DocOnly", "DiagOnly"],
  },
  go: {
    signature: "func build(row LedgerRow) Receipt",
    head: "func build(row LedgerRow) Receipt {",
    body: "v := BodyOnly{}",
    tail: "}",
    line: "//",
    indent: "\t",
    expected: ["LedgerRow", "Receipt", "BodyOnly", "CommentOnly", "StripeFanout", "DocOnly", "DiagOnly"],
  },
};

const fiveLegInput = (languageId) => {
  const f = FIVE_LEG[languageId];
  return {
    languageId,
    signature: f.signature,
    docComment: "Doc names `DocOnly` and `StripeFanout`.",
    code: [
      f.head,
      `${f.indent}${f.line} names \`CommentOnly\` and \`StripeFanout\``,
      `${f.indent}${f.body}`,
      f.tail,
    ].join("\n"),
    diagnosticTypes: ["DiagOnly", "StripeFanout"],
  };
};

for (const languageId of LANGS) {
  test(`E1 [${languageId}] all five legs, excludeName omitted, byte for byte`, () => {
    assert.deepEqual(spanTypesInPlay(fiveLegInput(languageId)), FIVE_LEG[languageId].expected);
  });

  test(`E2 [${languageId}] omitted and explicitly undefined answer the same thing`, () => {
    const base = spanTypesInPlay(fiveLegInput(languageId));
    const withUndef = spanTypesInPlay({ ...fiveLegInput(languageId), excludeName: undefined });
    assert.deepEqual(withUndef, base);
  });

  test(`E3 [${languageId}] a name nothing in the span mentions changes nothing`, () => {
    const base = spanTypesInPlay(fiveLegInput(languageId));
    const out = spanTypesInPlay({ ...fiveLegInput(languageId), excludeName: "NoSuchSymbol" });
    assert.deepEqual(out, base);
  });
}

test("E4 the prose-only fixtures are pinned too, all five languages", () => {
  for (const languageId of LANGS) {
    assert.deepEqual(
      spanTypesInPlay({ languageId, code: commentSpan(languageId) }),
      [PEER_C, SELF],
      `${languageId} comment leg drifted`,
    );
    assert.deepEqual(
      spanTypesInPlay({ languageId, code: span(languageId), docComment: DOC }),
      [PEER_D, SELF],
      `${languageId} doc leg drifted`,
    );
  }
});

test("E5 garbage in still gives an empty list, not a throw", () => {
  assert.deepEqual(spanTypesInPlay({ languageId: "csharp", code: "" }), []);
  assert.deepEqual(spanTypesInPlay({ languageId: "klingon", code: "%%%" }), []);
  assert.deepEqual(spanTypesInPlay({ languageId: "csharp", code: "", excludeName: SELF }), []);
});

// ===========================================================================
// SECTION F. The other three legs are untouched (contract item 6 and the
// deliberately-out-of-scope section).
//
// This is the section that catches an OVER-BROAD fix. Every row here is green
// today because `excludeName` is ignored; every row must be green after,
// because the contract says the fix reaches the two prose legs and no others.
// ===========================================================================

test("F1 the SIGNATURE leg keeps a return type that matches the target name", () => {
  const input = {
    languageId: "csharp",
    signature: "StripeFanout Rebuild(LedgerRow row)",
    code: "StripeFanout Rebuild(LedgerRow row) {\n}",
  };
  assert.deepEqual(spanTypesInPlay(input), ["StripeFanout", "LedgerRow"]);
  assert.deepEqual(spanTypesInPlay({ ...input, excludeName: "StripeFanout" }), [
    "StripeFanout",
    "LedgerRow",
  ]);
});

test("F2 the signature's DECLARED name is already stripped, with or without excludeName", () => {
  // `withoutDeclaredName(signature)` does this today. Pinned so the fix cannot
  // be credited with a behaviour that predates it.
  const input = {
    languageId: "csharp",
    signature: "void StripeFanout(LedgerRow row)",
    code: "void StripeFanout(LedgerRow row) {\n}",
  };
  assert.deepEqual(spanTypesInPlay(input), ["LedgerRow"]);
  assert.deepEqual(spanTypesInPlay({ ...input, excludeName: "StripeFanout" }), ["LedgerRow"]);
});

test("F3 [csharp] a SELF-CONSTRUCTION in the body code survives", () => {
  // Out of scope by name: `bodyTypes` runs on `maskNonCode` output, so a
  // self-mention it can see is a real occurrence the CODE makes.
  const input = {
    languageId: "csharp",
    code: "void Rebuild() {\n    var x = new StripeFanout();\n}",
  };
  assert.deepEqual(spanTypesInPlay(input), ["StripeFanout"]);
  assert.deepEqual(spanTypesInPlay({ ...input, excludeName: "StripeFanout" }), ["StripeFanout"]);
});

test("F4 [rust] a self-qualified call in the body code survives", () => {
  const input = {
    languageId: "rust",
    code: "fn rebuild() {\n    let x = StripeFanout::new();\n}",
  };
  assert.deepEqual(spanTypesInPlay(input), ["StripeFanout"]);
  assert.deepEqual(spanTypesInPlay({ ...input, excludeName: "StripeFanout" }), ["StripeFanout"]);
});

test("F5 the DIAGNOSTIC leg survives - if a compiler names the target, that is evidence", () => {
  const input = {
    languageId: "csharp",
    code: "void Rebuild() {\n}",
    diagnosticTypes: ["StripeFanout", "LedgerRow"],
  };
  assert.deepEqual(spanTypesInPlay(input), ["StripeFanout", "LedgerRow"]);
  assert.deepEqual(spanTypesInPlay({ ...input, excludeName: "StripeFanout" }), [
    "StripeFanout",
    "LedgerRow",
  ]);
});

test("F6 [go] the receiver survives on the signature leg under the reducing exclusion", () => {
  const input = {
    languageId: "go",
    signature: "func (s *Stripe) Summarize(row LedgerRow) Receipt",
    code: "func (s *Stripe) Summarize(row LedgerRow) Receipt {\n\treturn Receipt{}\n}",
  };
  assert.deepEqual(spanTypesInPlay(input), ["Stripe", "LedgerRow", "Receipt"]);
  assert.deepEqual(spanTypesInPlay({ ...input, excludeName: GO_SYMBOL }), [
    "Stripe",
    "LedgerRow",
    "Receipt",
  ]);
});

test("F7 the body-code leg keeps the self name even when the comment ALSO names it", () => {
  // The dedupe is first-seen and the body tier leads the comment tier, so this
  // is the same name arriving from an in-scope and an out-of-scope leg at once.
  // Contract-correct answer: it stays, because the CODE said it.
  const input = {
    languageId: "csharp",
    code: [
      "void Rebuild() {",
      "    // rebuilds a `StripeFanout`",
      "    var x = new StripeFanout();",
      "}",
    ].join("\n"),
  };
  assert.deepEqual(spanTypesInPlay(input), ["StripeFanout"]);
  assert.deepEqual(spanTypesInPlay({ ...input, excludeName: "StripeFanout" }), ["StripeFanout"]);
});

// ===========================================================================
// SECTION G. `refineTargets` agrees with `spanTypesInPlay` (contract item 4).
//
// Read header note 1 before reading these rows: the masked-text position scan
// hides the prose legs on every well-formed span, so these fixtures use the one
// shape where the prose leg IS observable - an unterminated block comment (an
// unterminated `"""` in Python), which pushes the position scan onto raw text.
// ===========================================================================

const RAW_FALLBACK = {
  csharp: {
    code: "void Build() {\n    /* `StripeFanout` and `Ledger` live here\n    Log(Alpha);\n}",
    plain: "void Build() {\n    /* StripeFanout and Ledger live here\n    Log(Alpha);\n}",
    self: { name: "StripeFanout", line: 1, character: 8, via: "type" },
    peer: { name: "Ledger", line: 1, character: 27, via: "type" },
  },
  rust: {
    code: "fn build() {\n    /* `StripeFanout` and `Ledger` live here\n    log(Alpha);\n}",
    plain: "fn build() {\n    /* StripeFanout and Ledger live here\n    log(Alpha);\n}",
    self: { name: "StripeFanout", line: 1, character: 8, via: "type" },
    peer: { name: "Ledger", line: 1, character: 27, via: "type" },
  },
  typescript: {
    code: "function build() {\n  /* `StripeFanout` and `Ledger` live here\n  log(Alpha);\n}",
    plain: "function build() {\n  /* StripeFanout and Ledger live here\n  log(Alpha);\n}",
    self: { name: "StripeFanout", line: 1, character: 6, via: "type" },
    peer: { name: "Ledger", line: 1, character: 25, via: "type" },
  },
  go: {
    code: "func build() {\n\t/* `StripeFanout` and `Ledger` live here\n\tlog(Alpha)\n}",
    plain: "func build() {\n\t/* StripeFanout and Ledger live here\n\tlog(Alpha)\n}",
    self: { name: "StripeFanout", line: 1, character: 5, via: "type" },
    peer: { name: "Ledger", line: 1, character: 24, via: "type" },
  },
  python: {
    code: 'def build():\n    """ `StripeFanout` and `Ledger` live here\n    log(Alpha)\n',
    plain: 'def build():\n    """ StripeFanout and Ledger live here\n    log(Alpha)\n',
    self: { name: "StripeFanout", line: 1, character: 9, via: "type" },
    peer: { name: "Ledger", line: 1, character: 28, via: "type" },
  },
};

const refineInput = (languageId, code) => ({
  languageId,
  code,
  spanStartLine: 0,
  spanStartCharacter: 0,
  max: 8,
});

for (const languageId of LANGS) {
  const f = RAW_FALLBACK[languageId];

  test(`G0 [${languageId}] anti-vacuity: without the backticks there is nothing to exclude`, () => {
    // Both readers answer empty on the identical fixture with the backticks
    // removed, so every G target below provably comes from the backtick comment
    // leg and from no other scan.
    assert.deepEqual(spanTypesInPlay({ languageId, code: f.plain }), []);
    assert.deepEqual(refineTargets(refineInput(languageId, f.plain)), []);
  });

  test(`G1 [${languageId}] refine returns the comment's self name today`, () => {
    assert.deepEqual(spanTypesInPlay({ languageId, code: f.code }), ["StripeFanout", "Ledger"]);
    assert.deepEqual(refineTargets(refineInput(languageId, f.code)), [f.self, f.peer]);
  });

  test(`G2 [${languageId}] a self-named target produces no self target through refine`, () => {
    const out = refineTargets({ ...refineInput(languageId, f.code), excludeName: "StripeFanout" });
    assert.deepEqual(
      out,
      [f.peer],
      `refine still asks the reference provider about the target itself: ${JSON.stringify(out)}`,
    );
  });

  test(`G3 [${languageId}] refine with excludeName omitted is byte-identical to today`, () => {
    assert.deepEqual(refineTargets(refineInput(languageId, f.code)), [f.self, f.peer]);
    assert.deepEqual(
      refineTargets({ ...refineInput(languageId, f.code), excludeName: undefined }),
      [f.self, f.peer],
    );
  });
}

test("G4 [go] refine takes the same gopls reduction the repair round takes", () => {
  // The one row that binds contract items 3 and 4 together: if the reduction is
  // done in `spanTypesInPlay`, refine inherits it for free; if it is done at the
  // repair call site only, refine keeps the self target and this goes red.
  const f = RAW_FALLBACK.go;
  const out = refineTargets({ ...refineInput("go", f.code), excludeName: "(*Ledger).StripeFanout" });
  assert.deepEqual(
    out,
    [f.peer],
    `expected the member excluded and the receiver kept: ${JSON.stringify(out)}`,
  );
});

test("G5 refine keeps a target the BODY CODE names, exclusion or not", () => {
  // The out-of-scope guard, on the refine side. `Ledger` here is a real code
  // occurrence, not prose, and naming it as the target must not remove it.
  const code = "void Build() {\n    var x = new Ledger();\n    x.Emit();\n}";
  const expected = [
    { name: "Emit", line: 2, character: 6, via: "member" },
    { name: "Ledger", line: 1, character: 16, via: "type" },
  ];
  assert.deepEqual(refineTargets(refineInput("csharp", code)), expected);
  assert.deepEqual(
    refineTargets({ ...refineInput("csharp", code), excludeName: "Ledger" }),
    expected,
  );
});

test("G6 the masked path hides the prose legs from refine entirely - measured, not assumed", () => {
  // Header note 1's evidence, kept as a row so a future build that changes the
  // masking discovers it here. `StripeFanout` is in types-in-play from the
  // comment and is NOT a refine target, at every budget.
  const code = [
    "void Build() {",
    "    // this is `StripeFanout`",
    '    Log("StripeFanout");',
    "    Log(Alpha);",
    "}",
  ].join("\n");
  assert.deepEqual(spanTypesInPlay({ languageId: "csharp", code }), ["Alpha", "StripeFanout"]);
  const alpha = { name: "Alpha", line: 3, character: 8, via: "type" };
  for (const max of [1, 2, 3, 8]) {
    assert.deepEqual(
      refineTargets({ languageId: "csharp", code, spanStartLine: 0, spanStartCharacter: 0, max }),
      [alpha],
      `max ${max}`,
    );
  }
});
