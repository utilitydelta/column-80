// Implementer oracle for the FIM enum-RHS leg (session-v28 goal item 3): the
// site detector, the hover reader that names the member's type, and the variant
// block. Pure and headless - no model, no language server. The resolution ladder
// between them (hover -> anchor -> cross-file shape) lives in the vscode layer
// and is proven live, not here.
//
// Run: SKIP_LIVE=1 node --test test/impl-v28-p3-enumrhs.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v28-p3-enumrhs",
  `export { csEnumRhsSite, enumRhsSiteFor, memberTypeNameFor, memberTypeContainerFor, memberSiteFor, renderEnumVariants, typeSpellingFor } from "../src/core/fimInject";
export { csDeclaredTypeName, csMemberTypeContainer, csMemberTypeName, csTypeSpelling, exactCsTypeHits, resolveCsTypeCursorWithHint, selectCsTypeCursor } from "../src/core/csExtraction";
export { CompletionService } from "../src/core/completionService";\n`
);
const {
  csEnumRhsSite,
  enumRhsSiteFor,
  memberTypeNameFor,
  memberTypeContainerFor,
  memberSiteFor,
  renderEnumVariants,
  typeSpellingFor,
  csDeclaredTypeName,
  csMemberTypeContainer,
  csMemberTypeName,
  csTypeSpelling,
  exactCsTypeHits,
  resolveCsTypeCursorWithHint,
  selectCsTypeCursor,
  CompletionService,
} = mod;
test.after(cleanup);

// ---- The site: a comparison whose left side is a member access.

for (const { prefix, member } of [
  { prefix: "if (t.Band == ", member: "Band" },
  { prefix: "if (t.Band ==", member: "Band" }, // the operator alone: one keystroke earlier
  { prefix: "if (t.Band != ", member: "Band" },
  { prefix: "if (t.Band  ==   ", member: "Band" }, // whatever whitespace the human left
  { prefix: "if (t?.Band == ", member: "Band" }, // null-conditional access
  { prefix: "return tiles.Where(t => t.Band == ", member: "Band" }, // the captured site
  { prefix: "var x = a.b.Kind == ", member: "Kind" }, // the LAST segment of a path
]) {
  test(`csEnumRhsSite fires on ${JSON.stringify(prefix)}`, () => {
    const site = csEnumRhsSite(prefix);
    assert.ok(site, "expected a site");
    assert.strictEqual(site.member, member);
    // The offset anchors the resolver: it must point at the member token itself.
    assert.strictEqual(prefix.slice(site.offset, site.offset + member.length), member);
  });
}

for (const { prefix, why } of [
  { prefix: "if (a == ", why: "no member access on the left" },
  { prefix: "if (count == ", why: "a bare local is not a member" },
  { prefix: "if (t.Band >= ", why: "an ordering, not an equality" },
  { prefix: "if (t.Band <= ", why: "an ordering, not an equality" },
  { prefix: "if (t.Band > ", why: "an ordering, not an equality" },
  { prefix: "t.Band = ", why: "an assignment, not a comparison" },
  { prefix: "if (t.Band === ", why: "not C#, and the char ahead of the == is an operator" },
  { prefix: "if (t.Band == LodBand.", why: "a member site: the member leg wins here" },
  { prefix: "if (t.Band == LodBand.Reg", why: "still the member leg's site" },
  { prefix: "if (t.Band == LodBand.Regional) ", why: "the comparison is finished" },
  { prefix: "// compare t.Band == ", why: "inside a line comment" },
  { prefix: "    /// when t.Band == ", why: "inside a doc comment" },
  { prefix: 'var s = "t.Band == ', why: "inside a string literal" },
  { prefix: "var s = $\"{x}\" + \"t.Band == ", why: "inside the second string literal" },
  { prefix: "if (1.5 == ", why: "a literal is not a member access" },
  { prefix: "", why: "nothing typed" },
  { prefix: "if (", why: "a fresh position" },
]) {
  test(`csEnumRhsSite dark on ${JSON.stringify(prefix)} (${why})`, () => {
    assert.strictEqual(csEnumRhsSite(prefix), undefined);
  });
}

test("csEnumRhsSite reads the CURSOR's line, and its offset is into the whole prefix", () => {
  const prefix = "class C {\n  bool F(Tile t) {\n    return t.Band == ";
  const site = csEnumRhsSite(prefix);
  assert.ok(site);
  assert.strictEqual(site.member, "Band");
  assert.strictEqual(prefix.slice(site.offset, site.offset + 4), "Band");
});

test("csEnumRhsSite: an equality on an EARLIER line is not the cursor's site", () => {
  assert.strictEqual(csEnumRhsSite("if (t.Band == \n    x"), undefined);
});

test("csEnumRhsSite: a receiver ending in a digit is the member detector's accepted false negative", () => {
  // `t1.Band` is real member access, and the shared float guard (the char ahead
  // of the `.` is a digit) rejects it here exactly as fimMemberSite rejects
  // `t1.`. One idea of member access across the two detectors beats a second
  // one that is right slightly more often; the site degrades to plain FIM.
  assert.strictEqual(csEnumRhsSite("if (t1.Band == "), undefined);
});

// ---- Ordering: at `LodBand.` the member site is the one that answers.

test("the member site wins where both could look plausible", () => {
  const prefix = "if (t.Band == LodBand.";
  assert.deepStrictEqual(memberSiteFor("csharp")(prefix), { partial: "" });
  assert.strictEqual(csEnumRhsSite(prefix), undefined);
});

// ---- The registries: C# ships, every other language stays dark.

test("enumRhsSiteFor: C# only, and its detector is the C# one", () => {
  assert.strictEqual(enumRhsSiteFor("csharp"), csEnumRhsSite);
  for (const lang of ["rust", "typescript", "typescriptreact", "javascript", "python", "go", "java"]) {
    assert.strictEqual(enumRhsSiteFor(lang), undefined, lang);
  }
});

test("memberTypeNameFor: the leg's other half, same C#-only row", () => {
  assert.strictEqual(memberTypeNameFor("csharp"), csMemberTypeName);
  for (const lang of ["rust", "typescript", "python", "go"]) {
    assert.strictEqual(memberTypeNameFor(lang), undefined, lang);
  }
});

// ---- The hover reader: the member's declared type leads the render.

for (const { signature, expected } of [
  { signature: "LodBand Tile.Band { get; }", expected: "LodBand" },
  { signature: "LodBand? Tile.Band { get; set; }", expected: "LodBand" },
  { signature: "Atlas.LodBand Tile.Band { get; }", expected: "LodBand" }, // last segment
  { signature: "int Stripe.TileTally { get; }", expected: "int" }, // the caller judges user-ness
  { signature: "(local variable) LodBand band", expected: "LodBand" },
  { signature: "(extension) LodBand TileExtensions.BandOf(Tile t)", expected: "LodBand" },
  { signature: "  LodBand Tile.Band { get; }  ", expected: "LodBand" },
  { signature: "enum Atlas.LodBand", expected: undefined }, // the TYPE's own hover
  { signature: "class Atlas.Stripe", expected: undefined },
  { signature: "List<Tile> Stripe.Tiles { get; }", expected: undefined }, // no name to anchor
  { signature: "Tile[] Stripe.All { get; }", expected: undefined },
  { signature: "Tile.Band", expected: undefined }, // no declared type at all
  { signature: undefined, expected: undefined },
]) {
  test(`csMemberTypeName(${JSON.stringify(signature)})`, () => {
    assert.strictEqual(csMemberTypeName(signature), expected);
  });
}

// ---- The block: the variants as comments under a header naming the type.

test("renderEnumVariants renders a header naming the type and one comment line per variant", () => {
  const block = renderEnumVariants("LodBand", [
    "LodBand.Continental",
    "LodBand.Regional",
    "LodBand.Municipal",
    "LodBand.Parcel",
  ]);
  assert.strictEqual(
    block,
    [
      "// LodBand values (use one of these exact names, do not invent):",
      "// LodBand.Continental",
      "// LodBand.Regional",
      "// LodBand.Municipal",
      "// LodBand.Parcel",
    ].join("\n"),
  );
  // Every line is a comment: the block lands in the buffer the model continues.
  for (const line of block.split("\n")) {
    assert.match(line, /^\/\/ /);
  }
});

test("renderEnumVariants carries the language's own comment token", () => {
  const block = renderEnumVariants("Lod", ["Lod.A"], "#");
  assert.strictEqual(block, "# Lod values (use one of these exact names, do not invent):\n# Lod.A");
});

test("renderEnumVariants: no variants is the honest degrade, not an empty header", () => {
  assert.strictEqual(renderEnumVariants("LodBand", []), undefined);
});

test("renderEnumVariants truncates a runaway enum and says how many it cut", () => {
  const variants = Array.from({ length: 47 }, (_, i) => `Wide.V${i}`);
  const block = renderEnumVariants("Wide", variants);
  const lines = block.split("\n");
  assert.strictEqual(lines.length, 1 + 40 + 1); // header + cap + the truncation line
  assert.strictEqual(lines[41], "// ... and 7 more, not shown here");
  assert.ok(!block.includes("Wide.V40"));
});

// ===========================================================================
// The four defects the phase-3 review found, one fence each. Every row here is
// a real site or a real cost, not a hypothetical: the evidence that opened them
// is in test/scratch-v28-p3-review/.
// ===========================================================================

// ---- 1. The block must spell a name that COMPILES where it lands.
//
// The corpus's most common enum comparison, 11 fires in two files: the enum
// lives in `Contoso.DataModel.Enums`, the consuming file imports
// `Contoso.DataModel` and no further, and the last-segment rule instructed the
// model to write `DataOrigin.None` under a header forbidding anything else.

const IMPORTS_THE_ENUM_NAMESPACE = `using Contoso.DataModel;
using Contoso.DataModel.Enums;

namespace Contoso.ProcessingLogic.Service;

public class FileLoading { }
`;
const IMPORTS_ONE_LEVEL_SHORT = `using Contoso.DataModel;
using Contoso.DataModel.InputCsv;

namespace Contoso.ProcessingLogic.Service;

public class FileLoading { }
`;

test("csTypeSpelling: the short form only where the file's own usings reach it", () => {
  const hover = "enum Contoso.DataModel.Enums.DataOrigin";
  assert.strictEqual(csTypeSpelling(hover, IMPORTS_THE_ENUM_NAMESPACE), "DataOrigin");
  assert.strictEqual(
    csTypeSpelling(hover, IMPORTS_ONE_LEVEL_SHORT),
    "Contoso.DataModel.Enums.DataOrigin",
    "the real corpus file: `using Contoso.DataModel;` does not make `DataOrigin` a name",
  );
});

test("csTypeSpelling: a file's own namespace reaches its enclosing ones without importing them", () => {
  const hover = "enum Contoso.DataModel.Enums.DataOrigin";
  for (const [ns, expected] of [
    ["namespace Contoso.DataModel.Enums;", "DataOrigin"], // the enum's own namespace
    ["namespace Contoso.DataModel.Enums.Csv;", "DataOrigin"], // nested inside it
    ["namespace Contoso.DataModel;", "Contoso.DataModel.Enums.DataOrigin"], // a PARENT sees nothing
    ["namespace Contoso.ProcessingLogic;", "Contoso.DataModel.Enums.DataOrigin"],
    ["namespace Contoso.DataModel.EnumsExtra;", "Contoso.DataModel.Enums.DataOrigin"], // segment boundary
  ]) {
    assert.strictEqual(csTypeSpelling(hover, `${ns}\n\npublic class C { }\n`), expected, ns);
  }
});

test("csTypeSpelling: a using that is not an import of the namespace does not shorten anything", () => {
  const hover = "enum Contoso.DataModel.Enums.DataOrigin";
  for (const line of [
    "using static Contoso.DataModel.Enums;", // imports members, not the namespace
    "using Origins = Contoso.DataModel.Enums;", // an alias is not an import of the name
    "using Contoso.DataModel.Enums.Extra;", // a longer namespace is a different one
  ]) {
    assert.strictEqual(
      csTypeSpelling(hover, `${line}\n\nnamespace App;\n`),
      "Contoso.DataModel.Enums.DataOrigin",
      line,
    );
  }
  // A `global using` in THIS file is a real import and does shorten it. One in
  // another file cannot be seen from here, and the qualified spelling those
  // files get is longer than the human would write and still compiles.
  assert.strictEqual(
    csTypeSpelling(hover, "global using Contoso.DataModel.Enums;\n\nnamespace App;\n"),
    "DataOrigin",
  );
});

test("csTypeSpelling: a NESTED enum keeps its container, which is what compiles outside it", () => {
  // Roslyn renders a nested type qualified by its CONTAINER, in the same dotted
  // shape a namespace uses, and no `using` names a type. `LodBand.Regional` is
  // not a name anywhere but inside `Tile`.
  assert.strictEqual(csTypeSpelling("enum Atlas.Tile.LodBand", "using Atlas;\n"), "Atlas.Tile.LodBand");
});

test("csTypeSpelling: an unqualified type is already the whole name", () => {
  assert.strictEqual(csTypeSpelling("enum LodBand", ""), "LodBand");
});

test("csTypeSpelling: undefined is the answer for a hover that declares no type", () => {
  // The same-named property C# idiom puts in the anchor's way, and the shapes
  // either side of it. This answer is what fix 2 reads to reject an anchor.
  for (const hover of [
    "DataOrigin FileParsingResults.DataOrigin { get; set; }",
    "LodBand Tile.Band { get; }",
    "(field) LodBand Tile.band",
    "delegate LodBand Picker(Tile t)", // a different grammar: the return type leads
    "",
    undefined,
  ]) {
    assert.strictEqual(csTypeSpelling(hover, "using Atlas;\n"), undefined, JSON.stringify(hover));
  }
  for (const hover of ["class Atlas.Stripe", "struct Atlas.Point", "interface Atlas.ITile", "record Atlas.Span"]) {
    assert.ok(csTypeSpelling(hover, ""), hover);
  }
});

test("typeSpellingFor: the leg's third half, same C#-only row as the other two", () => {
  assert.strictEqual(typeSpellingFor("csharp"), csTypeSpelling);
  for (const lang of ["rust", "typescript", "python", "go", "java"]) {
    assert.strictEqual(typeSpellingFor(lang), undefined, lang);
  }
});

test("the block renders off the spelling, so every line in it compiles at the site", () => {
  // What the provider does with the two answers: the hook composed the variants
  // off the SHORT name, and the qualifier is swapped onto the front.
  const typeName = "DataOrigin";
  const spelling = csTypeSpelling("enum Contoso.DataModel.Enums.DataOrigin", IMPORTS_ONE_LEVEL_SHORT);
  const variants = ["DataOrigin.None", "DataOrigin.AAMS"].map((l) => spelling + l.slice(typeName.length));
  const block = renderEnumVariants(spelling, variants);
  assert.strictEqual(
    block,
    [
      "// Contoso.DataModel.Enums.DataOrigin values (use one of these exact names, do not invent):",
      "// Contoso.DataModel.Enums.DataOrigin.None",
      "// Contoso.DataModel.Enums.DataOrigin.AAMS",
    ].join("\n"),
  );
});

// ---- 2. An anchor is accepted only when it resolved to a TYPE.
//
// `findTypeAnchor` takes the first non-comment occurrence of the bare word, and
// C# idiom names a property after its enum type, so at three real sites the
// anchor landed on `file.DataOrigin` and the leg went dark holding a property
// hover - after paying the whole ladder, with the by-name rung never running
// because an anchor WAS found. The discriminator is the spelling reader: a
// hover that declares no type is a missed anchor, not an answer.

test("the property-shadow anchor is refused, and the enum's own hover is not", () => {
  const file = "using Contoso.DataModel;\n\nnamespace App;\n";
  assert.strictEqual(
    csTypeSpelling("DataOrigin FileParsingResults.DataOrigin { get; set; }", file),
    undefined,
    "the property the anchor lands on must not be read as the type it is named after",
  );
  assert.strictEqual(
    csTypeSpelling("enum Contoso.DataModel.Enums.DataOrigin", file),
    "Contoso.DataModel.Enums.DataOrigin",
    "and the by-name rung's answer is accepted, spelled the way this file has to write it",
  );
});

// ---- 3. An honest "nothing here" is not a degraded resolve.
//
// The enum leg hands the service a resolver at EVERY C# `x.Y == ` site and 112
// of 143 real fires resolve nothing BY DESIGN. The cache rule refused to bank
// any of them, so each re-generated on every identical keystroke forever and
// the channel claimed an injection had degraded.

const CACHE_CFG = {
  apiBase: "http://127.0.0.1:1",
  model: "fake",
  maxTokens: 64,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 3000,
  suffixChars: 1000,
  cacheCapacity: 100,
  minGhostChars: 0,
  minGhostAlnum: 0,
  logPrompts: false,
};

const ENUM_REQ = {
  prefix: "class C {\n  bool F(Tile t) {\n    return t.Owner == ",
  suffix: ";\n  }\n}\n",
  uri: "file:///x/Fim.cs",
  languageId: "csharp",
  manual: true,
  memberSite: false,
  wholeBlockSite: false,
};

function countingGenerate(text) {
  const calls = [];
  return { calls, fn: async (p) => (calls.push(p), { text, ttftMs: 10, totalMs: 20 }) };
}

test("an OPTIONAL injection that resolved nothing is cached, so the next identical keystroke is free", async () => {
  const g = countingGenerate("LodBand.Regional;");
  const logs = [];
  const svc = new CompletionService(CACHE_CFG, g.fn, (l) => logs.push(l));
  const req = () => ({ ...ENUM_REQ, optionalInjection: true, resolveInjection: async () => undefined });
  await svc.complete(req());
  const second = await svc.complete(req());
  assert.strictEqual(g.calls.length, 1, "two identical keystrokes, one model call");
  assert.strictEqual(second.fromCache, true);
  assert.deepStrictEqual(
    logs.filter((l) => l.startsWith("[fim] not cached:")),
    [],
    "and the channel claims no degradation, because nothing degraded",
  );
  svc.dispose();
});

test("a REQUIRED injection that resolved nothing is still refused, byte for byte as before", async () => {
  const g = countingGenerate("push(x);");
  const logs = [];
  const svc = new CompletionService(CACHE_CFG, g.fn, (l) => logs.push(l));
  const req = () => ({
    ...ENUM_REQ,
    memberSite: true,
    memberPartial: "",
    memberReceiver: "t",
    resolveInjection: async () => undefined,
  });
  await svc.complete(req());
  const second = await svc.complete(req());
  assert.strictEqual(g.calls.length, 2, "the member leg's rule is untouched: a dark resolve is not banked");
  assert.strictEqual(second.fromCache, false);
  const line = logs.find((l) => l.startsWith("[fim] not cached:"));
  assert.ok(line, "and it still says so on the channel");
  assert.match(line, /memberSite=true injected=false gated=false/);
  svc.dispose();
});

// ---- 4. The detector is bounded by a constant, not by the file.
//
// EQUALITY_TAIL is end-anchored and not start-anchored, so it retried from every
// offset: 624ms for ONE keystroke on a 40,000-character identifier run, ahead of
// the debounce, against a 200ms warm-TTFT invariant. The maskNonCode call over a
// 200KB single line cost another 4.5ms.

test("csEnumRhsSite is flat in the size of the line, on the inputs that used to hang it", () => {
  const cases = [
    ["a 40,000-char identifier run, no newline", "a".repeat(40000) + ";"],
    ["a 200KB single-line file", "var x = new[]{" + Array.from({ length: 20000 }, (_, i) => `N${i}`).join(",") + "};"],
    ["the same run ENDING in a site", "a".repeat(40000) + " == "],
  ];
  for (const [label, prefix] of cases) {
    for (let i = 0; i < 50; i++) csEnumRhsSite(prefix);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) csEnumRhsSite(prefix);
    const us = Number(process.hrtime.bigint() - t0) / 1000 / 200;
    // Two orders of magnitude of headroom under the measured 624ms, and still
    // slack for a loaded machine. The bar is the shipped member detector, which
    // costs single-digit microseconds on the same inputs.
    assert.ok(us < 500, `${label}: ${us.toFixed(1)}us per keystroke`);
  }
});

test("csEnumRhsSite: a site at the end of a very long line still fires, with the right offset", () => {
  const lead = "        if (someCall(" + "x".repeat(4000) + ") && tile.Band == ";
  const prefix = "class C {\n" + lead;
  const site = csEnumRhsSite(prefix);
  assert.ok(site, "the tail bound must not darken a real site on a long line");
  assert.strictEqual(site.member, "Band");
  assert.strictEqual(prefix.slice(site.offset, site.offset + 4), "Band");
});

test("csEnumRhsSite: the tail bound never reads past the start of the cursor's line", () => {
  // A member access on the PREVIOUS line, and a bare `==` on this one. Reading
  // back past the newline would invent a member the human is not comparing.
  assert.strictEqual(csEnumRhsSite("var x = t.Band;\n    if (y == "), undefined);
});

test("csEnumRhsSite: a member token longer than the tail bound goes dark rather than guessing", () => {
  // The token runs back past what the detector looked at, so the `.` that would
  // make it a member access is not in view. Dark is the honest answer; the
  // longest identifier-character run in the two real C# corpora is 86 chars.
  assert.strictEqual(csEnumRhsSite("t." + "M".repeat(500) + " == "), undefined);
});

// ---- 5. The enum-RHS VALUE gate: a quoted string is refused, everything else
// a human legitimately writes after `==` is served.
//
// Measured at the spaced state (`t.Band == `, one keystroke past the capture),
// 5 samples per arm: the block arm served `"LodBand.Regional"` 5/5 and the
// control arm served nothing 0/5. The leg did not cause the model's error - the
// control's raw text was `1).Count();`, an int against an enum - but it changed
// what the human sees there from nothing to something that cannot compile,
// because the product keeps the block arm's ghost and drops the control's.
//
// The rows below drive the real CompletionService. That is where the gate lives
// and it is the only thing that proves the composition: the arming condition,
// the alternates, the evidence line and the primary all come off the same call.

// The gate is armed by the LANDED block, so these requests carry one. Contents
// do not matter to the gate, only that the resolver answered - but a real block
// is what the site would carry, so this is the real block.
const ENUM_BLOCK = [
  "// LodBand values (use one of these exact names, do not invent):",
  "// LodBand.Continental",
  "// LodBand.Regional",
].join("\n");

// One request at an enum-RHS site with the block landed, driven through the real
// service. Returns the served text and the log, so a row can assert both what
// the human sees and what a reader of the channel is told.
async function servedAtEnumSite(ghost, extra = {}) {
  const logs = [];
  const svc = new CompletionService(
    CACHE_CFG,
    async () => ({ text: ghost, ttftMs: 10, totalMs: 20 }),
    (l) => logs.push(l),
  );
  try {
    const result = await svc.complete({
      ...ENUM_REQ,
      prefix: "class C {\n  bool F(Tile t) {\n    return t.Band == ",
      enumRhsSite: true,
      optionalInjection: true,
      resolveInjection: async () => ENUM_BLOCK,
      ...extra,
    });
    return { text: result?.text, logs };
  } finally {
    svc.dispose();
  }
}

// Every C# spelling of a string literal, at both cursor states. The unspaced
// state is the one the model supplies its own separator at, which is why the
// leading-space rows are not padding.
for (const ghost of [
  '"LodBand.Regional"', // the measured ghost, spaced state
  ' "LodBand.Regional"', // the same one keystroke earlier: the model's own separator
  '  "LodBand.Regional").Count();', // whatever whitespace, and the suffix re-type
  '@"LodBand.Regional"', // verbatim
  '$"LodBand.{x}"', // interpolated
  '$@"LodBand.Regional"', // both, either order
  '@$"LodBand.Regional"',
  '"""LodBand.Regional"""', // raw
  '$$"""LodBand.{{x}}"""', // interpolated raw: the prefix is a RUN of $
  '"Regional"', // not even a variant name: still a string against an enum
]) {
  test(`the value gate refuses ${JSON.stringify(ghost)} at an enum-RHS site`, async () => {
    const { text, logs } = await servedAtEnumSite(ghost);
    assert.strictEqual(text ?? "", "", "a string cannot be the value of an enum-typed comparison");
    const line = logs.find((l) => l.startsWith("[fim] dropped:"));
    assert.ok(line, `the refusal owes an evidence line; got ${JSON.stringify(logs)}`);
    assert.match(line, /string literal at an enum-RHS site/);
    assert.match(line, /never the value of an enum-typed comparison/);
  });
}

// Everything else a human legitimately writes after `==`. The gate has exactly
// one opinion and none of these is it.
for (const { ghost, why } of [
  { ghost: " LodBand.Regional).Count();", why: "the variant the block exists to produce" },
  { ghost: " band).Count();", why: "a local in scope" },
  { ghost: " Compute()).Count();", why: "a call" },
  { ghost: " (LodBand)raw).Count();", why: "a cast" },
  { ghost: " (a ? x : y)).Count();", why: "a parenthesised expression" },
  { ghost: " other.Band).Count();", why: "another member access" },
  { ghost: " null).Count();", why: "null, which a nullable enum compares against" },
  { ghost: " 0).Count();", why: "the literal 0, which C# allows against an enum" },
  { ghost: " default).Count();", why: "the default expression" },
  { ghost: " @class.Band).Count();", why: "a verbatim IDENTIFIER, which is not a verbatim string" },
  { ghost: ' LodBand.Regional).Count() + s.IndexOf("x");', why: "a string further in is not the value" },
]) {
  test(`the value gate serves ${JSON.stringify(ghost)} (${why})`, async () => {
    const { text, logs } = await servedAtEnumSite(ghost);
    assert.strictEqual(text, ghost, `${why}: the gate judges the first value token and nothing else`);
    assert.deepStrictEqual(
      logs.filter((l) => l.startsWith("[fim] dropped:")),
      [],
      "and nothing was dropped, so nothing is on the channel",
    );
  });
}

test("the value gate is dark where the block did NOT land: most `x.Y == ` sites are not enums", async () => {
  // 112 of 143 real fires resolve nothing. `t.Owner == "acme"` is ordinary C#,
  // and the site alone proves nothing about the type - the landed block does.
  const { text, logs } = await servedAtEnumSite('"acme";', { resolveInjection: async () => undefined });
  assert.strictEqual(text, '"acme";', "an unresolved site is not evidence of an enum");
  assert.deepStrictEqual(logs.filter((l) => l.startsWith("[fim] dropped:")), []);
});

test("the value gate is dark where the request is not an enum-RHS site at all", async () => {
  // The same landed injection at a site that is not a comparison. A whole-block
  // resolver answers with a block too, and a string is a perfectly good value
  // to return from a function.
  const { text } = await servedAtEnumSite('"acme";', { enumRhsSite: false, wholeBlockSite: true });
  assert.strictEqual(text, '"acme";');
});

test("the value gate reaches the ALTERNATES, because any of them can be promoted", async () => {
  // The service's fan-out asks for extras; a quoted alternate is the same wrong
  // ghost one Tab-cycle later.
  const logs = [];
  const svc = new CompletionService(
    CACHE_CFG,
    async (p) => ({ text: p.temperature > 0.5 ? '"LodBand.Regional"' : " LodBand.Regional;", ttftMs: 10, totalMs: 20 }),
    (l) => logs.push(l),
  );
  const result = await svc.complete({
    ...ENUM_REQ,
    prefix: "class C {\n  bool F(Tile t) {\n    return t.Band == ",
    alternatives: 3,
    enumRhsSite: true,
    optionalInjection: true,
    resolveInjection: async () => ENUM_BLOCK,
  });
  assert.strictEqual(result.text, " LodBand.Regional;", "the primary is the cold one and it survives");
  assert.deepStrictEqual(result.alternates ?? [], [], "and every quoted alternate is gone");
  svc.dispose();
});

// The member-name gate is untouched, and both directions of that are checked:
// the value gate does not reach a member site, and the member gate still
// decides there on its own evidence with its own reason on the channel.
for (const { ghost, served, reason } of [
  {
    ghost: '"acme";',
    served: '"acme";',
    reason: undefined,
  },
  {
    ghost: "Fabricated;",
    served: "",
    reason: /ghost names no resolved member/,
  },
]) {
  test(`the member-name gate decides ${JSON.stringify(ghost)} at a MEMBER site, not the value gate`, async () => {
    const logs = [];
    const svc = new CompletionService(
      CACHE_CFG,
      async () => ({ text: ghost, ttftMs: 10, totalMs: 20 }),
      (l) => logs.push(l),
    );
    const result = await svc.complete({
      ...ENUM_REQ,
      memberSite: true,
      memberPartial: "",
      memberReceiver: "t",
      resolveInjection: async () => ({ block: "// members", memberNames: ["Band", "Owner"] }),
    });
    assert.strictEqual(result?.text ?? "", served);
    const line = logs.find((l) => l.startsWith("[fim] dropped:"));
    if (reason === undefined) {
      assert.strictEqual(line, undefined, "a quoted ghost at a member site is not the value gate's business");
    } else {
      assert.ok(line);
      assert.match(line, reason, "the member gate's own reason, not the value gate's");
      assert.doesNotMatch(line, /enum-RHS/);
    }
    svc.dispose();
  });
}

// ===========================================================================
// 6. Two projects declare the same enum, and the leg already knows which one.
//
// The fifth defect, and the only one the dogfood playgrounds could never show:
// measured over the real Contoso solution, 31 of 142 enum-RHS fires are
// enum-typed and 27 of them died at the by-name rung, because
// `selectCsTypeCursor` refuses a name two projects both declare and this
// solution declares `DataOrigin` and `ThreatLevel` twice each. The hover ONE
// RUNG EARLIER already read `DataModel.Enums.DataOrigin`.
//
// The refusal is right and stays: the two `DataOrigin`s have DIFFERENT variant
// sets, so picking the wrong one renders a block that is missing `AAMS_v2` and
// `CSVMonitor_v5` under a header reading "use one of these exact names, do not
// invent" - hallucination by omission, with the product's own authority behind
// it. So the fix hands the refusal evidence rather than a tiebreak.
//
// Every row below is the real shape, measured off the live Roslyn server
// (scratchpad `C2c-hint-probe.json`): the real hovers, the real def signatures,
// the real variant lists, and the real `containerName` strings - which are
// Roslyn PROJECT display text, not namespaces, which is why the decision is
// made on the def hover instead.

const DATAMODEL_ENUMS_CS = "file:///repo/Contoso.DataModel/Enums.cs";
const LOCALDB_DPMDATAFILE_CS = "file:///repo/Contoso.LocalDb/DpmDataFile.cs";

// workspace/symbol for "DataOrigin" on the real solution, reduced to the two
// exact-name TYPE hits (the fuzzy list also carries four properties named
// DataOrigin, which the role filter drops).
const TWO_DATA_ORIGINS = [
  { name: "DataOrigin", role: "container", containerName: "project Contoso.LocalDb (net9.0)", uri: LOCALDB_DPMDATAFILE_CS, line: 2, character: 21 },
  { name: "DataOrigin", role: "container", containerName: "project Contoso.DataModel (net9.0)", uri: DATAMODEL_ENUMS_CS, line: 8, character: 20 },
  { name: "DataOrigin", role: "field", containerName: "in FileParsingResults (project Contoso.ProcessingLogic (net9.0))", uri: "file:///repo/Contoso.ProcessingLogic/Dto/FileParsingResults.cs", line: 11, character: 26 },
];

// What each of the two hovers as, verbatim from the server.
const DEF_HOVERS = {
  [DATAMODEL_ENUMS_CS]: "enum Contoso.DataModel.Enums.DataOrigin",
  [LOCALDB_DPMDATAFILE_CS]: "enum Contoso.LocalDb.DataOrigin",
};

// And what each one's variant list is. The DataModel one has nine, the LocalDb
// one seven; `AAMS_v2` and `CSVMonitor_v5` exist in only one of them, and a real
// site in AdditionalDataProcessing.cs compares against `AAMS_v2`.
const DATAMODEL_VARIANTS = [
  "DataOrigin.None", "DataOrigin.AAMS", "DataOrigin.CSVMonitor_v1", "DataOrigin.CSVMonitor_v2",
  "DataOrigin.AlreadyProcessed", "DataOrigin.CSVMonitor_v3", "DataOrigin.CSVMonitor_v4",
  "DataOrigin.AAMS_v2", "DataOrigin.CSVMonitor_v5",
];
const LOCALDB_VARIANTS = [
  "DataOrigin.None", "DataOrigin.AAMS", "DataOrigin.CSVMonitor_v1", "DataOrigin.CSVMonitor_v2",
  "DataOrigin.AlreadyProcessed", "DataOrigin.CSVMonitor_v3", "DataOrigin.CSVMonitor_v4",
];

// The two real consuming files, cut to what decides the question: their imports.
// AdditionalDataProcessing.cs reaches the enum through `Contoso.DataModel` and
// writes `DataModel.Enums.DataOrigin`, so its hover QUALIFIES. TestLoadFormats.cs
// imports the enum's own namespace and writes `DataOrigin`, so its hover does not.
const QUALIFIES = `using Contoso.DataModel;
using Contoso.DataModel.Exceptions;
using Contoso.ProcessingLogic.Dto;

namespace Contoso.ProcessingLogic.Service;
`;
const IMPORTS_THE_ENUM = `using Moq;
using Contoso.DataModel;
using Contoso.DataModel.Enums;
using Contoso.ProcessingLogic.Service;

namespace Contoso.ProcessingLogic.Tests;
`;

// A hover function over the fixed def-hover table, counting its calls: the
// unambiguous path must not pay for one.
function defHovers() {
  const calls = [];
  return {
    calls,
    fn: async (cursor) => {
      calls.push(cursor.uri);
      return DEF_HOVERS[cursor.uri];
    },
  };
}

// ---- The two readers the rung asks with.

for (const { signature, expected } of [
  { signature: "DataModel.Enums.DataOrigin FileParsingResults.DataOrigin { get; set; }", expected: "DataModel.Enums" },
  { signature: "Enums.JobStatus RetroJob.Status { get; set; }", expected: "Enums" },
  { signature: "DataOrigin FileParsingResults.DataOrigin { get; set; }", expected: undefined }, // qualified nowhere
  { signature: "enum Contoso.DataModel.Enums.DataOrigin", expected: undefined }, // a TYPE's own hover
  { signature: "List<Tile> Stripe.Tiles { get; }", expected: undefined },
  { signature: undefined, expected: undefined },
]) {
  test(`csMemberTypeContainer(${JSON.stringify(signature)})`, () => {
    assert.strictEqual(csMemberTypeContainer(signature), expected);
    // The two readers split one parse, so neither can see a member the other cannot.
    if (expected !== undefined) {
      assert.ok(csMemberTypeName(signature), "a container implies a name");
    }
  });
}

for (const { signature, expected } of [
  { signature: "enum Contoso.DataModel.Enums.DataOrigin", expected: "Contoso.DataModel.Enums.DataOrigin" },
  { signature: "enum Contoso.LocalDb.DataOrigin", expected: "Contoso.LocalDb.DataOrigin" },
  { signature: "class Ns.Box<T>", expected: "Ns.Box" }, // the argument list trails the name
  { signature: "DataOrigin FileParsingResults.DataOrigin { get; set; }", expected: undefined },
  { signature: undefined, expected: undefined },
]) {
  test(`csDeclaredTypeName(${JSON.stringify(signature)})`, () => {
    assert.strictEqual(csDeclaredTypeName(signature), expected);
  });
}

test("memberTypeContainerFor: the disambiguator's own row, same C#-only shape as its two siblings", () => {
  assert.strictEqual(memberTypeContainerFor("csharp"), csMemberTypeContainer);
  for (const lang of ["rust", "typescript", "python", "go"]) {
    assert.strictEqual(memberTypeContainerFor(lang), undefined, lang);
  }
});

// ---- The refusal, unchanged.

test("selectCsTypeCursor still refuses the two real DataOrigins outright", () => {
  assert.strictEqual(
    selectCsTypeCursor(TWO_DATA_ORIGINS, "DataOrigin"),
    undefined,
    "no evidence, no answer - the leg the whole product's by-name resolution rides is untouched",
  );
});

test("exactCsTypeHits keeps the two TYPES, drops the property of the same name, workspace locations first", () => {
  const hits = exactCsTypeHits(TWO_DATA_ORIGINS, "DataOrigin");
  assert.deepStrictEqual(hits.map((h) => h.uri), [LOCALDB_DPMDATAFILE_CS, DATAMODEL_ENUMS_CS]);
});

test("an ambiguous name with NO hint stays dark, and costs no hover doing it", async () => {
  const hover = defHovers();
  assert.strictEqual(
    await resolveCsTypeCursorWithHint(TWO_DATA_ORIGINS, "DataOrigin", undefined, hover.fn),
    undefined,
  );
  assert.deepStrictEqual(hover.calls, [], "nothing to decide with means nothing to spend");
});

test("an UNAMBIGUOUS name resolves exactly as before, and costs no hover either", async () => {
  const one = [
    { name: "JobStatus", role: "container", containerName: "project Contoso.DataModel (net9.0)", uri: DATAMODEL_ENUMS_CS, line: 28, character: 20 },
  ];
  const hover = defHovers();
  assert.deepStrictEqual(
    await resolveCsTypeCursorWithHint(one, "JobStatus", { container: "Enums", fileText: QUALIFIES }, hover.fn),
    { uri: DATAMODEL_ENUMS_CS, line: 28, character: 20 },
  );
  assert.deepStrictEqual(hover.calls, [], "the hint is spent on ambiguity, never on the common path");
  assert.deepStrictEqual(await resolveCsTypeCursorWithHint([], "JobStatus", { container: "Enums" }, hover.fn), undefined);
});

// ---- Evidence 1: the container the hover already carried.

for (const { container, expected, why } of [
  { container: "DataModel.Enums", expected: DATAMODEL_ENUMS_CS, why: "the real hover's own qualifier, a SUFFIX of the declared namespace" },
  { container: "Contoso.DataModel.Enums", expected: DATAMODEL_ENUMS_CS, why: "the whole namespace, when a file reaches it that way" },
  { container: "LocalDb", expected: LOCALDB_DPMDATAFILE_CS, why: "and the other one, by the same rule" },
  { container: "Contoso.LocalDb", expected: LOCALDB_DPMDATAFILE_CS, why: "likewise fully qualified" },
  { container: "Enums", expected: DATAMODEL_ENUMS_CS, why: "the last segment alone, which is what the real JobStatus hover carries, and it still fits only one" },
  { container: "DataModel", expected: undefined, why: "a PREFIX of the namespace is not a suffix of it, and a segment short is not evidence" },
  { container: "Contoso.Cosmos", expected: undefined, why: "evidence contradicting every candidate is a reason to trust it less, not more" },
]) {
  test(`the by-name rung under container ${JSON.stringify(container)} -> ${expected ? expected.split("/").pop() : "dark"} (${why})`, async () => {
    const hover = defHovers();
    const got = await resolveCsTypeCursorWithHint(TWO_DATA_ORIGINS, "DataOrigin", { container }, hover.fn);
    assert.strictEqual(got?.uri, expected);
    assert.strictEqual(hover.calls.length, 2, "one hover per ambiguous candidate, and only at a site that is dark today");
  });
}

test("a container fitting BOTH candidates decides nothing and refuses", async () => {
  const rivals = [
    { name: "Stripe", role: "container", containerName: "project A (net9.0)", uri: "file:///repo/A/Stripe.cs", line: 3, character: 17 },
    { name: "Stripe", role: "container", containerName: "project B (net9.0)", uri: "file:///repo/B/Stripe.cs", line: 3, character: 17 },
  ];
  const hovers = async (cursor) =>
    cursor.uri.includes("/A/") ? "class Atlas.Model.Stripe" : "class Rival.Model.Stripe";
  assert.strictEqual(
    await resolveCsTypeCursorWithHint(rivals, "Stripe", { container: "Model" }, hovers),
    undefined,
    "`Model` is a suffix of both namespaces, so it narrows nothing",
  );
  assert.strictEqual((await resolveCsTypeCursorWithHint(rivals, "Stripe", { container: "Atlas.Model" }, hovers))?.uri, "file:///repo/A/Stripe.cs");
});

test("two locations of ONE type agree on a name and resolve, whatever the containerName says", async () => {
  const partial = [
    { name: "Ledger", role: "container", containerName: "project Books (net9.0)", uri: "file:///repo/Books/Ledger.cs", line: 4, character: 17 },
    { name: "Ledger", role: "container", containerName: "in Books (project Books (net9.0))", uri: "file:///repo/Books/Ledger.Posting.cs", line: 6, character: 17 },
  ];
  const got = await resolveCsTypeCursorWithHint(partial, "Ledger", { container: "Books.Domain" }, async () => "class Books.Domain.Ledger");
  assert.strictEqual(got?.uri, "file:///repo/Books/Ledger.cs", "a partial split across files is one type, not an ambiguity");
});

test("a candidate whose def hover says nothing is not a survivor, and never the answer", async () => {
  const got = await resolveCsTypeCursorWithHint(TWO_DATA_ORIGINS, "DataOrigin", { container: "DataModel.Enums" }, async (cursor) =>
    cursor.uri === DATAMODEL_ENUMS_CS ? undefined : DEF_HOVERS[cursor.uri],
  );
  assert.strictEqual(got, undefined, "the rung cannot confirm what it would be picking, so it does not pick");
});

// ---- Evidence 2: the buffer, where the hover qualified nothing.

for (const { fileText, expected, why } of [
  { fileText: IMPORTS_THE_ENUM, expected: DATAMODEL_ENUMS_CS, why: "the real TestLoadFormats.cs: it imports the enum's namespace, which is why its hover said only `DataOrigin`" },
  { fileText: `using Contoso.LocalDb;\n\nnamespace App;\n`, expected: LOCALDB_DPMDATAFILE_CS, why: "the other import, the other enum" },
  { fileText: `namespace Contoso.LocalDb.Sync;\n`, expected: LOCALDB_DPMDATAFILE_CS, why: "an ENCLOSING namespace reaches it without a using" },
  { fileText: `using Contoso.DataModel.Enums;\nusing Contoso.LocalDb;\n\nnamespace App;\n`, expected: undefined, why: "both reachable: real C# cannot write the name bare here at all (CS0104), so neither can this" },
  { fileText: QUALIFIES, expected: undefined, why: "neither reachable short, which is why THIS file's hover qualifies and takes the other leg" },
]) {
  test(`the by-name rung on the buffer alone -> ${expected ? expected.split("/").pop() : "dark"} (${why})`, async () => {
    const got = await resolveCsTypeCursorWithHint(TWO_DATA_ORIGINS, "DataOrigin", { fileText }, defHovers().fn);
    assert.strictEqual(got?.uri, expected);
  });
}

test("the container leads: a hover that qualified is never second-guessed by the buffer", async () => {
  const got = await resolveCsTypeCursorWithHint(
    TWO_DATA_ORIGINS,
    "DataOrigin",
    { container: "DataModel.Enums", fileText: `using Contoso.LocalDb;\n\nnamespace App;\n` },
    defHovers().fn,
  );
  assert.strictEqual(got?.uri, DATAMODEL_ENUMS_CS, "what the server said about THIS member outranks what the file imports");
});

// ---- What picking right is worth, at the real site.

test("the real AdditionalDataProcessing.cs site resolves the enum whose variants it actually compares against", async () => {
  // Rung 1, verbatim from the live server at `file.DataOrigin == `.
  const memberHover = "DataModel.Enums.DataOrigin FileParsingResults.DataOrigin { get; set; }";
  const typeName = memberTypeNameFor("csharp")(memberHover);
  const container = memberTypeContainerFor("csharp")(memberHover);
  assert.strictEqual(typeName, "DataOrigin");
  assert.strictEqual(container, "DataModel.Enums");

  const cursor = await resolveCsTypeCursorWithHint(TWO_DATA_ORIGINS, typeName, { container, fileText: QUALIFIES }, defHovers().fn);
  assert.strictEqual(cursor?.uri, DATAMODEL_ENUMS_CS, "the nine-variant one, not the seven-variant one");

  // And the block that lands. The file reaches the enum only through
  // `Contoso.DataModel`, so the spelling is the qualified one - the phase-3
  // fix and this one composing at the same site.
  const spelling = typeSpellingFor("csharp")(DEF_HOVERS[cursor.uri], QUALIFIES);
  assert.strictEqual(spelling, "Contoso.DataModel.Enums.DataOrigin");
  const block = renderEnumVariants(
    spelling,
    DATAMODEL_VARIANTS.map((v) => spelling + v.slice(typeName.length)),
    "//",
  );
  assert.match(block, /^\/\/ Contoso\.DataModel\.Enums\.DataOrigin values \(use one of these exact names, do not invent\):$/m);
  assert.ok(block.includes("// Contoso.DataModel.Enums.DataOrigin.AAMS_v2"), "the variant the file at line 153 compares against");
  assert.ok(block.includes("// Contoso.DataModel.Enums.DataOrigin.CSVMonitor_v5"));

  // The counterfactual, which is why the refusal was right to exist: the other
  // DataOrigin is not a different spelling of the same set, it is a smaller set.
  assert.ok(!LOCALDB_VARIANTS.includes("DataOrigin.AAMS_v2"));
  assert.ok(!LOCALDB_VARIANTS.includes("DataOrigin.CSVMonitor_v5"));
  const wrong = renderEnumVariants("DataOrigin", LOCALDB_VARIANTS, "//");
  assert.ok(!wrong.includes("AAMS_v2"), "picking the wrong one omits two real variants under a do-not-invent header");
});

test("the real TestLoadFormats.cs site resolves the same enum through its imports, hover or no hover", async () => {
  const memberHover = "DataOrigin FileParsingResults.DataOrigin { get; set; }";
  const typeName = memberTypeNameFor("csharp")(memberHover);
  const container = memberTypeContainerFor("csharp")(memberHover);
  assert.strictEqual(typeName, "DataOrigin");
  assert.strictEqual(container, undefined, "this file imports the namespace, so the server had nothing to qualify");

  const cursor = await resolveCsTypeCursorWithHint(TWO_DATA_ORIGINS, typeName, { container, fileText: IMPORTS_THE_ENUM }, defHovers().fn);
  assert.strictEqual(cursor?.uri, DATAMODEL_ENUMS_CS);
  // Same enum, and here the SHORT spelling is the one that compiles.
  assert.strictEqual(typeSpellingFor("csharp")(DEF_HOVERS[cursor.uri], IMPORTS_THE_ENUM), "DataOrigin");
});
