// ADVERSARIAL evidence for session-v55 phase 11 (Q12): what `excludeName`
// actually excludes, measured against the strings REAL symbol providers hand
// `ResolvedFunction.symbolName` (`fnGen.ts:557` is `symbol.name`, verbatim).
//
// The blind oracle (`blind-v55-p11-exclude-name.test.cjs`) pins the contract.
// This file pins the two things it could not: what the five servers really
// spell, and what the exclusion costs when the target's own name is ALSO a
// legitimate collaborator.
//
// PROVENANCE OF SECTION 1. Every name in `REAL_SYMBOL_NAMES` was captured on
// 2026-08-18 from the server itself, on this box, through the project's own
// headless transports (`documentSymbolsForTest`), on a throwaway project per
// language. Nothing here is recalled or inferred:
//
//   csharp     Roslyn LS 2.140.9 (ms-dotnettools.csharp) via CsLspExtractor
//   go         gopls via GoLspExtractor
//   rust       rust-analyzer via RaLspExtractor
//   typescript tsserver via TsLsExtractor
//   python     pyright via PyLspExtractor
//
// THE HEADLINE: the dotted-symbol hazard the blind oracle flagged without a row
// ("a DOTTED symbol name would reduce under /^[A-Za-z_][A-Za-z0-9_]*/ to the
// wrong thing") DOES NOT OCCUR. No server qualifies a member name. Roslyn spells
// an EXPLICIT INTERFACE IMPLEMENTATION `Summarize(int) : int`, not
// `IStripeFeed.Summarize`; rust-analyzer keeps `impl Feed for Stripe` on the
// impl node only and names the method `summarize`; tsserver says `constructor`;
// pyright says `__init__`. gopls is the one parenthesised speller and
// `parseGoReceiverSymbol` handles every form it produced, generics included.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v55-p11-excludename.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v55-p11",
  `export { spanTypesInPlay } from "../src/core/repairTypes";
   export { refineTargets } from "../src/core/refine";
   export { parseGoReceiverSymbol } from "../src/core/goExtraction";
   export { RECEIVER_RULES } from "../src/core/receiver";\n`,
);
const { spanTypesInPlay, refineTargets, parseGoReceiverSymbol, RECEIVER_RULES } = mod;
test.after(cleanup);

// The reduction both prose readers apply to `excludeName`
// (`commentTypes.ts:54`, `compilerDirected.ts:1062`), spelled out so a row can
// say what a given symbol name really excludes.
const bare = (name) => name.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];

// ===========================================================================
// SECTION 1. What the five real servers put in `symbolName`.
// ===========================================================================

const REAL_SYMBOL_NAMES = {
  csharp: [
    ["StripeFanout", "StripeFanout"], // class
    ["StripeFanout(int)", "StripeFanout"], // constructor - the CLASS name
    ["Summarize(int) : int", "Summarize"], // EXPLICIT interface impl: not dotted
    ["Map<T>(T) : T", "Map"], // generic method
    ["Count : int", "Count"], // property
    ["this[int] : int", "this"], // indexer
    ["operator +(StripeFanout, StripeFanout) : StripeFanout", "operator"],
  ],
  go: [
    ["(*Stripe).Summarize", undefined], // pointer receiver: no bare name at all
    ["(Stripe).Value", undefined],
    ["(*Tile[T]).SubtendedChildren", undefined],
    ["(*Pair[K, V]).Key", undefined],
    ["Summarize", "Summarize"], // free function
    ["Do", "Do"], // interface method
  ],
  rust: [
    ["summarize", "summarize"],
    ["new", "new"],
    ["value", "value"],
    ["Stripe", "Stripe"],
  ],
  typescript: [
    ["constructor", "constructor"],
    ["summarize", "summarize"],
    ["Build", "Build"],
    ["StripeWidget", "StripeWidget"],
  ],
  python: [
    ["__init__", "__init__"],
    ["summarize", "summarize"],
    ["Build", "Build"],
  ],
};

test("1a no real server produces the DANGEROUS shape: an identifier, then a dot", () => {
  // The hazard is `Billing.StripeFanout`, where the reduction keeps the LEFT
  // half and excludes a type that is not the target. gopls is dotted but opens
  // with `(`, so it reduces to undefined and is caught by the Go arm inside
  // `spanTypesInPlay` instead. Nothing else is dotted at all.
  for (const [languageId, rows] of Object.entries(REAL_SYMBOL_NAMES)) {
    for (const [name] of rows) {
      assert.ok(
        !/^[A-Za-z_][A-Za-z0-9_]*\./.test(name),
        `${languageId} produced a qualified symbol name and the bare-name reduction would take the wrong half: ${JSON.stringify(name)}`,
      );
    }
  }
});

test("1b each captured name reduces to what the prose readers will match on", () => {
  for (const [languageId, rows] of Object.entries(REAL_SYMBOL_NAMES)) {
    for (const [name, expected] of rows) {
      assert.equal(bare(name), expected, `${languageId} ${JSON.stringify(name)}`);
    }
  }
});

test("1c gopls is the only parenthesised speller, and every form it produced parses", () => {
  // Contract item 3, against the live capture rather than the two examples the
  // contract names. The multi-parameter generic `(*Pair[K, V]).Key` is the one
  // the regex's `\\[[^\\]]*\\]` had to survive.
  assert.deepEqual(parseGoReceiverSymbol("(*Stripe).Summarize"), { receiver: "Stripe", member: "Summarize" });
  assert.deepEqual(parseGoReceiverSymbol("(Stripe).Value"), { receiver: "Stripe", member: "Value" });
  assert.deepEqual(parseGoReceiverSymbol("(*Tile[T]).SubtendedChildren"), { receiver: "Tile", member: "SubtendedChildren" });
  assert.deepEqual(parseGoReceiverSymbol("(*Pair[K, V]).Key"), { receiver: "Pair", member: "Key" });
  // And the unparenthesised ones fall through to the `?? excludeName` arm.
  for (const n of ["Summarize", "Do", "Stripe"]) {
    assert.equal(parseGoReceiverSymbol(n), undefined, n);
  }
});

test("1d a real gopls generic method name excludes its MEMBER through the product reader", () => {
  const code = "func (p *Pair[K, V]) Key() K {\n\t// the `Key` of a `LedgerRow`\n}";
  assert.deepEqual(spanTypesInPlay({ languageId: "go", code }), ["Key", "LedgerRow"]);
  assert.deepEqual(
    spanTypesInPlay({ languageId: "go", code, excludeName: "(*Pair[K, V]).Key" }),
    ["LedgerRow"],
  );
});

// ===========================================================================
// SECTION 2. OVER-EXCLUSION. The exclusion is by BARE NAME with no kind and no
// position check, so whenever a real symbol name reduces to a TYPE name the
// prose legs lose that type. Two shapes, both measured.
// ===========================================================================

test("2a [csharp] a CONSTRUCTOR excludes its own enclosing class from both prose legs", () => {
  // Roslyn names a constructor `StripeFanout(int)` (section 1, captured), which
  // reduces to the CLASS name. `withoutDeclaredName` has already blanked it on
  // the signature leg, so after this change the class can only reach the round
  // through the body CODE leg, the diagnostic leg, or the pre-fill's own
  // receiver leg - never through what the developer wrote in prose.
  const input = {
    languageId: "csharp",
    signature: "public StripeFanout(int n)",
    docComment: "Seeds a `StripeFanout` from a `LedgerRow`.",
    code: "public StripeFanout(int n) {\n    // seeds a `StripeFanout`\n}",
  };
  assert.deepEqual(spanTypesInPlay(input), ["StripeFanout", "LedgerRow"]);
  assert.deepEqual(spanTypesInPlay({ ...input, excludeName: "StripeFanout(int)" }), ["LedgerRow"]);
});

test("2b the same constructor in TypeScript and Python keeps the class - the servers name it differently", () => {
  // The asymmetry is entirely in the SPELLING, not in the reader: tsserver says
  // `constructor` and pyright says `__init__`, neither of which is a type name,
  // so the identical source shape loses nothing in those two languages.
  const ts = {
    languageId: "typescript",
    signature: "constructor(n: number)",
    docComment: "Seeds a `StripeFanout` from a `LedgerRow`.",
    code: "constructor(n: number) {\n}",
  };
  assert.deepEqual(spanTypesInPlay({ ...ts, excludeName: "constructor" }), ["StripeFanout", "LedgerRow"]);
  const py = {
    languageId: "python",
    signature: "def __init__(self, n: int) -> None",
    docComment: "Seeds a `StripeFanout` from a `LedgerRow`.",
    code: "def __init__(self, n: int) -> None:\n    pass",
  };
  assert.deepEqual(spanTypesInPlay({ ...py, excludeName: "__init__" }), ["StripeFanout", "LedgerRow"]);
});

test("2c the C# constructor's class is still reachable through the pre-fill RECEIVER leg", () => {
  // Why 2a is a cost and not a hole in the repair path: the receiver leg keys
  // off the signature and the symbol tree, not off `symbolName`, and a
  // constructor is not static.
  assert.equal(RECEIVER_RULES.csharp.hasReceiver("public StripeFanout(int n)"), true);
  assert.equal(RECEIVER_RULES.csharp.containerName("StripeFanout"), "StripeFanout");
});

test("2d [go] a method named after a package type loses that type when only prose names it", () => {
  // `func (s *Server) Ledger()` is an idiomatic Go accessor. gopls names it
  // `(*Server).Ledger`, which reduces to `Ledger` - the type.
  const proseOnly = {
    languageId: "go",
    signature: "func (s *Server) Ledger()",
    code: "func (s *Server) Ledger() {\n\t// wires the `Ledger` chain onto the `Router`\n}",
  };
  assert.deepEqual(spanTypesInPlay(proseOnly), ["Ledger", "Router"]);
  assert.deepEqual(spanTypesInPlay({ ...proseOnly, excludeName: "(*Server).Ledger" }), ["Router"]);

  // The same accessor with the type on the RETURN keeps it: the signature leg
  // runs first and is not excluded, and `withoutDeclaredName` blanks only the
  // FIRST name-before-paren, which is the method's.
  const returned = {
    languageId: "go",
    signature: "func (s *Server) Ledger() *Ledger",
    code: "func (s *Server) Ledger() *Ledger {\n\t// wires the `Ledger` chain\n}",
  };
  assert.deepEqual(spanTypesInPlay({ ...returned, excludeName: "(*Server).Ledger" }), ["Ledger"]);
});

test("2e a C# operator and a C# indexer exclude a non-type word, so they cost nothing", () => {
  const op = {
    languageId: "csharp",
    code: "static StripeFanout operator +(StripeFanout a, StripeFanout b) {\n    // adds two `StripeFanout` via `LedgerRow`\n}",
  };
  assert.deepEqual(
    spanTypesInPlay({ ...op, excludeName: "operator +(StripeFanout, StripeFanout) : StripeFanout" }),
    ["StripeFanout", "LedgerRow"],
    "the operator's reduction is the word `operator`, which no type leg emits",
  );
  assert.equal(bare("this[int] : int"), "this");
});

// ===========================================================================
// SECTION 3. In three of the five languages the change is INERT for a function
// target, because `spanTypesInPlay`'s own `take` filter already refuses any
// name that does not start with a capital.
//
// This is the fixture-fidelity note on the blind oracle: its A/B/C sections
// drive all five languages with the symbol name `StripeFanout`, and section 1
// above shows that rust-analyzer, tsserver and pyright never produce a
// PascalCase name for a function. Type-kind targets (a struct, a class) do reach
// this code with a PascalCase name in all five, so the wire is not pointless -
// but the FUNCTION-target payoff the entry describes is C# and Go only.
// ===========================================================================

for (const [languageId, symbolName, code] of [
  ["rust", "build_receipt", "fn build_receipt() {\n    // builds a `build_receipt` from a `LedgerRow`\n}"],
  ["python", "build_receipt", "def build_receipt():\n    # builds a `build_receipt` from a `LedgerRow`\n    pass"],
  ["typescript", "buildReceipt", "function buildReceipt() {\n  // builds a `buildReceipt` from a `LedgerRow`\n}"],
]) {
  test(`3 [${languageId}] an idiomatic lowercase function name changes nothing either way`, () => {
    const before = spanTypesInPlay({ languageId, code });
    const after = spanTypesInPlay({ languageId, code, excludeName: symbolName });
    assert.deepEqual(before, ["LedgerRow"]);
    assert.deepEqual(after, before, "the exclusion moved something it should not have");
  });
}

// ===========================================================================
// SECTION 4. The refine MEMBER leg is not excluded, and a recursive self-call
// therefore still becomes a target of the target itself.
// ===========================================================================

test("4 a recursive self-call is still a `via: member` refine target under excludeName", () => {
  const input = {
    languageId: "csharp",
    code: "int Summarize(int n) {\n    return this.Summarize(n - 1) + Helper.Total();\n}",
    spanStartLine: 10,
    spanStartCharacter: 4,
    signature: "int Summarize(int n)",
    max: 4,
  };
  const render = (t) => `${t.name}(${t.via})`;
  const before = refineTargets(input).map(render);
  const after = refineTargets({ ...input, excludeName: "Summarize(int) : int" }).map(render);
  assert.deepEqual(before, ["Summarize(member)", "Total(member)", "Helper(type)"]);
  assert.deepEqual(after, before, "excludeName reaches the member leg, which the contract did not ask for");
});
