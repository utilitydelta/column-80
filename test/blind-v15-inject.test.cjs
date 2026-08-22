// Blind oracle: the v15 P2 injection surface.
// Three pure functions in src/core/fimInject.ts:
//
//   1. lineCommentFor(languageId)                      - "#" for python, "//" otherwise
//   2. renderFimCandidates(members, partial, lineComment?, argTypes?)
//   3. argumentTypeNames(members, languageId)
//
// The contract under test: the two NEW trailing parameters of
// renderFimCandidates are OPTIONAL, and omitting them must leave the function
// byte-identical to today (every existing call site and ~2600 existing tests
// ride on it). The new behaviour is a language-correct comment prefix and an
// argument-type construction surface appended AFTER the receiver's members.
//
// Written against the frozen surface only. src/core/fimInject.ts is never read;
// esbuild resolves it at bundle time. RED today: the surface does not exist -
// lineCommentFor and argumentTypeNames are absent exports, and
// renderFimCandidates ignores its new parameters.
//
// Run: SKIP_LIVE=1 node --test test/blind-v15-inject.test.cjs
// (Hermetic: pure functions, no model, no network, no vscode.)

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v15-inject",
  `export { lineCommentFor, renderFimCandidates, argumentTypeNames } from "../src/core/fimInject";\n`
);
const { lineCommentFor, renderFimCandidates, argumentTypeNames } = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// Fixtures. CompletionMember is { name, signature?, kind, viaTrait? }. The
// canonical scenario is the scout's: a Stripe receiver whose EnrollTile takes a
// Tile, and a Tile whose constructor is the arity the 1.5b gets wrong 8/8.
// ---------------------------------------------------------------------------

const mem = (name, signature, kind = "method") => ({ name, signature, kind });

// The receiver's members, per language, in the rendered form each language's
// extractor produces. Order is input order and the render preserves it.
const RECEIVER = {
  rust: [
    mem("enroll_tile", "enroll_tile(&mut self, tile: Tile) -> bool"),
    mem("aggregate_fanout", "aggregate_fanout(&self) -> i32"),
  ],
  typescript: [
    mem("enrollTile", "enrollTile(tile: Tile): boolean"),
    mem("aggregateFanout", "aggregateFanout(): number"),
  ],
  csharp: [
    mem("EnrollTile", "EnrollTile(Tile) : bool"),
    mem("AggregateFanout", "AggregateFanout() : int"),
  ],
  python: [
    mem("enroll_tile", "enroll_tile(self, tile: Tile) -> bool"),
    mem("aggregate_fanout", "aggregate_fanout(self) -> int"),
  ],
};

// The Tile argument type: its constructor is the whole point of the phase.
const TILE_CTOR = {
  rust: [mem("new", "new(morton_code: u32, lod: u8) -> Tile", "constructor")],
  typescript: [mem("Tile", "Tile(mortonCode: number, lod: number)", "constructor")],
  csharp: [mem("Tile", "Tile(int mortonCode, int lod)", "constructor")],
  python: [mem("__init__", "__init__(self, morton_code: int, lod: int)", "constructor")],
};

const HEADER = "available here (use one of these exact names, do not invent):";

const lines = (block) => String(block).split("\n");

// ===========================================================================
// 1. BACKWARD COMPATIBILITY. The single most important invariant in this file:
// the two new parameters are optional and their absence changes NOTHING.
// [P2 "Both omitted must produce byte-identical output to today"]
// ===========================================================================

const LEGACY_MEMBERS = [
  mem("with_num_bits", "with_num_bits(usize) -> BuilderWithBits"),
  mem("from_vec", "from_vec(&[u64]) -> BloomFilter"),
];
const LEGACY_EXPECTED =
  `// ${HEADER}\n` +
  "// with_num_bits(usize) -> BuilderWithBits\n" +
  "// from_vec(&[u64]) -> BloomFilter";

test("renderFimCandidates with both new parameters omitted emits the exact legacy block, byte for byte - header text and `// ` prefix unchanged [P2 'byte-identical to today']", () => {
  assert.strictEqual(renderFimCandidates(LEGACY_MEMBERS, ""), LEGACY_EXPECTED);
});

// Every way a legacy-equivalent call can be spelled must land on the same
// bytes: the defaults are "//" and "no argument types", nothing else.
for (const { name, args } of [
  { name: "both omitted", args: [] },
  { name: "lineComment explicitly undefined", args: [undefined] },
  { name: 'lineComment explicitly "//"', args: ["//"] },
  { name: "argTypes an empty array", args: [undefined, []] },
  { name: 'lineComment "//" and argTypes empty', args: ["//", []] },
]) {
  test(`renderFimCandidates default-equivalence (${name}): the new parameters at their defaults produce the identical legacy bytes [P2 'Defaults to "//"']`, () => {
    assert.strictEqual(renderFimCandidates(LEGACY_MEMBERS, "", ...args), LEGACY_EXPECTED);
  });
}

test("renderFimCandidates still narrows to the already-typed partial when the new parameters are supplied - the new surface does not disturb narrowing [P2 'byte-identical']", () => {
  const members = [
    mem("with_num_bits", "with_num_bits(usize) -> B"),
    mem("with_false_pos", "with_false_pos(f64) -> B"),
    mem("from_vec", "from_vec() -> B"),
  ];
  const legacy = renderFimCandidates(members, "with");
  const extended = renderFimCandidates(members, "with", "//", []);
  assert.strictEqual(extended, legacy, "an empty argTypes and the default prefix change nothing");
  assert.ok(!String(legacy).includes("from_vec"), "a candidate not matching the partial stays excluded");
});

// ===========================================================================
// 2. lineCommentFor. [P2 §1]
// ===========================================================================

for (const { languageId, expected, why } of [
  { languageId: "python", expected: "#", why: "python comments with #; `//` is a syntax error there" },
  { languageId: "rust", expected: "//", why: "rust" },
  { languageId: "typescript", expected: "//", why: "typescript" },
  { languageId: "typescriptreact", expected: "//", why: "the TS family" },
  { languageId: "javascript", expected: "//", why: "javascript" },
  { languageId: "csharp", expected: "//", why: "csharp" },
  { languageId: "plaintext", expected: "//", why: "an unknown language falls back to //" },
  { languageId: "", expected: "//", why: "an empty language id falls back to //" },
  { languageId: "haskell", expected: "//", why: "an unmapped language still falls back to //, never to its own token" },
]) {
  test(`lineCommentFor(${JSON.stringify(languageId)}) is ${JSON.stringify(expected)} - ${why} [P2 §1]`, () => {
    assert.strictEqual(lineCommentFor(languageId), expected);
  });
}

// ===========================================================================
// 3. The Python rendering path. The whole reason lineComment exists: a Python
// buffer must never receive a `//` line. [P2 §1 rationale + §2 'header
// included']
// ===========================================================================

test("renderFimCandidates with lineComment '#' prefixes EVERY line including the header, and emits no `//` anywhere - a Python injection is valid Python [P2 'the token every emitted line is prefixed with, header included']", () => {
  const block = renderFimCandidates(RECEIVER.python, "", "#", [
    { name: "Tile", members: TILE_CTOR.python },
  ]);
  assert.ok(block !== undefined, "the Python receiver carries signatures, so a block must render");
  const ls = lines(block);
  assert.ok(ls.length >= 4, `expected header + 2 members + the Tile section, got:\n${block}`);
  for (const l of ls) {
    assert.ok(l.startsWith("# "), `every line carries the '# ' prefix; offending line: ${JSON.stringify(l)}`);
    assert.ok(!l.includes("//"), `no line may carry a '//' comment token in Python; offending line: ${JSON.stringify(l)}`);
  }
  assert.strictEqual(ls[0], `# ${HEADER}`, "the header is the same text, only the prefix changes");
});

test("renderFimCandidates honours an arbitrary lineComment token - the prefix is data, not a python special case [P2 'lineComment?: string']", () => {
  const block = renderFimCandidates(RECEIVER.python, "", "--");
  assert.ok(block !== undefined);
  for (const l of lines(block)) {
    assert.ok(l.startsWith("-- "), `expected the supplied token and one space; got ${JSON.stringify(l)}`);
  }
});

// ===========================================================================
// 4. argTypes rendering: content, prefix, and ORDER. [P2 §2 'Rendering, in
// order' - receiver members first, then `to build a <Name>:` and its lines]
// ===========================================================================

for (const languageId of ["rust", "typescript", "csharp", "python"]) {
  const prefix = languageId === "python" ? "#" : "//";
  test(`renderFimCandidates (${languageId}): argTypes appends 'to build a Tile:' and the Tile constructor AFTER the receiver's members, all with the same prefix [P2 §2 rendering order]`, () => {
    const block = renderFimCandidates(RECEIVER[languageId], "", prefix, [
      { name: "Tile", members: TILE_CTOR[languageId] },
    ]);
    assert.ok(block !== undefined, "a receiver carrying signatures must render");
    const ls = lines(block);
    const ctorSig = TILE_CTOR[languageId][0].signature;
    const receiverSig = RECEIVER[languageId][0].signature;

    const iHeader = ls.indexOf(`${prefix} ${HEADER}`);
    const iReceiver = ls.indexOf(`${prefix} ${receiverSig}`);
    const iBuild = ls.indexOf(`${prefix} to build a Tile:`);
    const iCtor = ls.indexOf(`${prefix} ${ctorSig}`);

    assert.strictEqual(iHeader, 0, `the existing header leads the block:\n${block}`);
    assert.ok(iReceiver > 0, `the receiver member line must be present and prefixed:\n${block}`);
    assert.ok(iBuild > 0, `the 'to build a Tile:' line must be present and prefixed:\n${block}`);
    assert.ok(iCtor > 0, `the Tile constructor signature must be present and prefixed:\n${block}`);
    assert.ok(iReceiver < iBuild, `receiver members come BEFORE the argument-type section:\n${block}`);
    assert.ok(iBuild < iCtor, `the 'to build a Tile:' header comes BEFORE its signatures:\n${block}`);
    for (const l of ls) {
      assert.ok(l.startsWith(`${prefix} `), `every line carries the prefix; offending: ${JSON.stringify(l)}`);
    }
  });
}

test("renderFimCandidates renders MULTIPLE argTypes in the supplied order, each with its own 'to build a' header [P2 'For each entry in argTypes']", () => {
  const block = renderFimCandidates(RECEIVER.csharp, "", "//", [
    { name: "Tile", members: TILE_CTOR.csharp },
    { name: "Stripe", members: [mem("Stripe", "Stripe(string atlasId)", "constructor")] },
  ]);
  assert.ok(block !== undefined);
  const iTile = String(block).indexOf("to build a Tile:");
  const iStripe = String(block).indexOf("to build a Stripe:");
  assert.ok(iTile > 0 && iStripe > 0, `both argument types render a section:\n${block}`);
  assert.ok(iTile < iStripe, `argTypes render in the supplied order:\n${block}`);
  assert.match(String(block), /^\/\/ Stripe\(string atlasId\)$/m);
});

test("renderFimCandidates with argTypes passed while lineComment is omitted still defaults the prefix to '//' [P2 'Defaults to \"//\"']", () => {
  const block = renderFimCandidates(RECEIVER.csharp, "", undefined, [
    { name: "Tile", members: TILE_CTOR.csharp },
  ]);
  assert.ok(block !== undefined);
  for (const l of lines(block)) {
    assert.ok(l.startsWith("// "), `offending line: ${JSON.stringify(l)}`);
  }
  assert.match(String(block), /^\/\/ to build a Tile:$/m);
});

// ===========================================================================
// 5. The skip rules. [P2 §2 'Returns undefined when...' + 'never produces a
// bare header' + 'argTypes alone never rescues' + 'the cap counts the
// receiver's member lines']
// ===========================================================================

for (const { name, argTypes } of [
  { name: "an entry whose members carry no signatures", argTypes: [{ name: "Tile", members: [mem("Tile", undefined, "constructor")] }] },
  { name: "an entry with an empty members array", argTypes: [{ name: "Tile", members: [] }] },
]) {
  test(`renderFimCandidates skips ${name} - no bare 'to build a Tile:' header with nothing under it [P2 'never produces a bare to build a X: header']`, () => {
    const block = renderFimCandidates(RECEIVER.csharp, "", "//", argTypes);
    assert.ok(block !== undefined, "the receiver still renders; only the argument-type section is skipped");
    assert.ok(
      !String(block).includes("to build a"),
      `an argument type that renders no signatures emits no header at all:\n${block}`
    );
    assert.strictEqual(
      block,
      renderFimCandidates(RECEIVER.csharp, ""),
      "a fully-skipped argTypes list leaves the block identical to the legacy render"
    );
  });
}

test("renderFimCandidates renders the surviving argType when a sibling entry renders nothing - one skip does not suppress the rest [P2 'For each entry ... that renders at least one signature']", () => {
  const block = renderFimCandidates(RECEIVER.csharp, "", "//", [
    { name: "Empty", members: [] },
    { name: "Tile", members: TILE_CTOR.csharp },
  ]);
  assert.ok(block !== undefined);
  assert.ok(!String(block).includes("to build a Empty:"), `the empty entry is skipped:\n${block}`);
  assert.match(String(block), /^\/\/ to build a Tile:$/m);
});

for (const { name, members, partial } of [
  { name: "no member carries a signature", members: [mem("a"), mem("b")], partial: "" },
  { name: "the member list is empty", members: [], partial: "" },
  { name: "the partial narrows every member away", members: [mem("from_vec", "from_vec() -> B")], partial: "with" },
]) {
  test(`renderFimCandidates returns undefined when ${name}, EVEN with a fully-renderable argTypes - argTypes never rescues a dead receiver block [P2 'argTypes alone never rescues']`, () => {
    const withArgs = renderFimCandidates(members, partial, "//", [
      { name: "Tile", members: TILE_CTOR.csharp },
    ]);
    assert.strictEqual(withArgs, undefined, `expected undefined, got:\n${withArgs}`);
    assert.strictEqual(renderFimCandidates(members, partial), undefined, "and the legacy call agrees");
  });
}

const wideReceiver = Array.from({ length: 60 }, (_, i) => mem(`m${i}`, `m${i}() -> ()`));

test("renderFimCandidates still gates a runaway receiver set, and a renderable argTypes does not lift the gate [P2 'the receiver set exceeds the existing width cap']", () => {
  assert.strictEqual(renderFimCandidates(wideReceiver, ""), undefined, "legacy cap behaviour, unchanged");
  assert.strictEqual(
    renderFimCandidates(wideReceiver, "", "//", [{ name: "Tile", members: TILE_CTOR.csharp }]),
    undefined,
    "over the cap: skip, do not inject a wall - argTypes cannot rescue it"
  );
});

test("the width cap counts the RECEIVER's member lines only - a large argTypes payload never trips it [P2 'The existing width cap counts the receiver's member lines, unchanged']", () => {
  const fatArgType = Array.from({ length: 60 }, (_, i) => mem(`Make${i}`, `Make${i}(int a) : Tile`));
  const block = renderFimCandidates(RECEIVER.csharp, "", "//", [{ name: "Tile", members: fatArgType }]);
  assert.ok(
    block !== undefined,
    "a two-member receiver is under the cap; the argument type's size is not the receiver's size"
  );
  assert.match(String(block), /^\/\/ to build a Tile:$/m);
});

// ===========================================================================
// 6. argumentTypeNames. [P2 §3]
// ===========================================================================

// Per-language signature builders in each extractor's RENDERED form: the
// parameter position and the return position, spelled the way that language's
// members actually arrive.
const SIG = {
  rust: {
    param: (t) => `take(&self, x: ${t})`,
    ret: (t) => `produce(&self) -> ${t}`,
  },
  typescript: {
    param: (t) => `take(x: ${t}): void`,
    ret: (t) => `produce(): ${t}`,
  },
  csharp: {
    param: (t) => `Take(${t}) : void`,
    ret: (t) => `Produce() : ${t}`,
  },
  python: {
    param: (t) => `take(self, x: ${t}) -> None`,
    ret: (t) => `produce(self) -> ${t}`,
  },
};

// A name that IS in this language's stop-set, and a name that is a std name in
// SOME OTHER language but not this one - the pair that proves the stop-set is
// per-language rather than one merged pile.
const STOPSET = {
  rust: { std: "Cow", foreign: "Guid" },
  typescript: { std: "Buffer", foreign: "Cow" },
  csharp: { std: "Guid", foreign: "Cow" },
  python: { std: "Coroutine", foreign: "Guid" },
};

const LANGS = ["rust", "typescript", "csharp", "python"];

for (const lang of LANGS) {
  test(`argumentTypeNames (${lang}): a user type in a PARAMETER position is reported [P2 'the types the model must construct']`, () => {
    assert.deepStrictEqual(argumentTypeNames([mem("take", SIG[lang].param("Tile"))], lang), ["Tile"]);
  });

  test(`argumentTypeNames (${lang}): a user type in the RETURN position is NOT reported - the model receives it, it does not construct it [P2 'Parameter positions only']`, () => {
    assert.deepStrictEqual(argumentTypeNames([mem("produce", SIG[lang].ret("Tile"))], lang), []);
  });

  test(`argumentTypeNames (${lang}): ${STOPSET[lang].std} is filtered as a ${lang} standard type while ${STOPSET[lang].foreign} (std elsewhere, not here) survives - the stop-set is per-language [P2 'the per-language stop-sets']`, () => {
    const out = argumentTypeNames(
      [mem("a", SIG[lang].param(STOPSET[lang].std)), mem("b", SIG[lang].param(STOPSET[lang].foreign))],
      lang
    );
    assert.ok(!out.includes(STOPSET[lang].std), `${STOPSET[lang].std} is a ${lang} builtin and must be filtered; got ${JSON.stringify(out)}`);
    assert.ok(out.includes(STOPSET[lang].foreign), `${STOPSET[lang].foreign} is not a ${lang} builtin and must survive; got ${JSON.stringify(out)}`);
  });

  for (const generic of ["T", "U"]) {
    test(`argumentTypeNames (${lang}): the bare single-letter generic ${generic} is dropped - it is a type parameter, not a constructible type [P2 'Bare single-letter names are excluded']`, () => {
      assert.deepStrictEqual(argumentTypeNames([mem("take", SIG[lang].param(generic))], lang), []);
    });
  }

  test(`argumentTypeNames (${lang}): deduped with first-appearance order preserved [P2 'Deduped, first-appearance order preserved']`, () => {
    const members = [
      mem("a", SIG[lang].param("Tile")),
      mem("b", SIG[lang].param("Stripe")),
      mem("c", SIG[lang].param("Tile")),
    ];
    assert.deepStrictEqual(argumentTypeNames(members, lang), ["Tile", "Stripe"]);
  });

  test(`argumentTypeNames (${lang}): an empty member list yields an empty array, not a throw [P2 'Empty array when nothing qualifies']`, () => {
    assert.deepStrictEqual(argumentTypeNames([], lang), []);
  });

  for (const { what, members } of [
    { what: "a member with no signature at all", members: [mem("bare")] },
    { what: "an empty signature string", members: [mem("bare", "")] },
    { what: "unbalanced brackets", members: [mem("x", "take(((<<<Tile")] },
    { what: "pure punctuation", members: [mem("x", "???")] },
    { what: "a signature that is only whitespace", members: [mem("x", "   ")] },
    { what: "a truncated generic", members: [mem("x", SIG[lang].param("List<"))] },
  ]) {
    test(`argumentTypeNames (${lang}): ${what} never throws - a malformed signature degrades to whatever it can read [P2 'Never throws on a malformed signature']`, () => {
      let out;
      assert.doesNotThrow(() => {
        out = argumentTypeNames(members, lang);
      });
      assert.ok(Array.isArray(out), `the result is always an array; got ${JSON.stringify(out)}`);
    });
  }
}

// The generic-ARGUMENT rule, in the three angle-bracket languages the contract
// spells it in: `List<Tile>` in a parameter position yields `Tile`, and the
// container itself is a std name that never survives.
for (const { lang, container } of [
  { lang: "rust", container: "Vec" },
  { lang: "typescript", container: "Array" },
  { lang: "csharp", container: "List" },
]) {
  test(`argumentTypeNames (${lang}): ${container}<Tile> in a parameter position yields Tile - a generic's type ARGUMENT counts, the container does not [P2 'List<Tile> in a parameter position yields Tile']`, () => {
    assert.deepStrictEqual(argumentTypeNames([mem("take", SIG[lang].param(`${container}<Tile>`))], lang), ["Tile"]);
  });
}

// ===========================================================================
// 7. The scout's end-to-end scenario, in the language it was measured in: the
// Stripe receiver plus the Tile argument type, C# rendered form. This is the
// exact injection that moved constructor arity to 8/8. [P2 'Why']
// ===========================================================================

test("the scout scenario (csharp): the block carries the receiver's members AND the Tile constructor's full arity, so `new Tile(1)` is unwritable from it [P2 'Why' - arity wrong 8/8 without it]", () => {
  const block = renderFimCandidates(RECEIVER.csharp, "", lineCommentFor("csharp"), [
    { name: "Tile", members: TILE_CTOR.csharp },
  ]);
  assert.strictEqual(
    block,
    `// ${HEADER}\n` +
      "// EnrollTile(Tile) : bool\n" +
      "// AggregateFanout() : int\n" +
      "// to build a Tile:\n" +
      "// Tile(int mortonCode, int lod)"
  );
});

test("the scout scenario (csharp): argumentTypeNames names Tile off the receiver's members - the type whose constructor the block must then carry [P2 §3]", () => {
  assert.deepStrictEqual(argumentTypeNames(RECEIVER.csharp, "csharp"), ["Tile"]);
});
