// BLIND ORACLE - session-v28 phase 1: the repair round sees the SPAN's types,
// not the one type a diagnostic happened to name.
//
// Written from the contract only: `session-v28/goal.md` item 1 plus its
// acceptance bar, and `session-v28/design-p1.md`. Nothing here has read
// src/core/repairTypes.ts, src/core/repairGate.ts, the body of
// classifyCsHallucination, src/vscode/fnGen.ts or src/vscode/oracleSurface.ts.
// The harness shape (esbuild bundle of src/core into a throwaway .cjs, required
// headless) is copied from blind-v6-item1 / blind-v24-p2-surface; none of their
// assertions are.
//
// WHY THESE THREE SURFACES, AND WHY BLACK-BOX
//
// Capture A disclosed `Tile` alone because the diagnostic said CS1061 on Tile,
// so `LodBand`'s variants were invisible and the model rewrote the human's
// intent into a compiling lie. Capture B disclosed `LodBand`'s variants alone
// because round 1 said CS0117 on LodBand, so `Band` was invisible; round 2's
// CS0019 classified to nothing and injected nothing at all, and the model
// invented `tile.LodBand`. One defect, three faces: the surface follows the
// diagnostic instead of the span, and where a surface WAS injected nothing
// checked the answer against it.
//
// Phase 1 answers with three pure pieces, and all three are testable without a
// language server, a model or a network:
//
//   A. `spanTypesInPlay`         - what the span itself puts in play.
//   B. `undisclosedMemberRefusal` - the repair gate that closes `tile.LodBand`.
//   C. CS0019 joins the classified set, so round 2 stops reading `class=none`.
//
// STATE AT WRITING. 51 rows, 48 green, 3 RED. The C# leg of the span scan, both
// gate legs and the CS0019 class were already standing when this file first ran,
// so most rows are pins rather than bars. The three reds are the human's "should
// work for all languages" standard failing at two languages and one spill:
//
//   A2 [python]  a plain `Foo = 0` assignment is read as a type. Python has no
//                type prefix on an assignment, so the `Tile x = ` evidence
//                pattern has nothing to anchor on and matches the bare name.
//   A2 [go]      `var band LodBand = LodBandRegional` puts LodBand in play in
//                Go's own declaration position, and the scan does not see it.
//                The span comes back with the signature type alone, which is
//                the exact half-disclosure capture A shipped.
//   A6 [csharp]  the repaired method's OWN name comes back as a type in play.
//
// These rows are FROZEN. Fix the implementation, never the row (AGENTS.md).
//
// Run: SKIP_LIVE=1 node --test test/blind-v28-p1-spansurface.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness. Two bundles, deliberately: the NEW modules may not exist yet, and a
// build failure there must not take the CS0019 rows down with it. A missing
// module is a LOUD FAILURE, never a skip - a skipped contract row proves
// nothing, and this file exists to be red before it is green.
// ===========================================================================

function bundle(tag, entrySource) {
  const entry = path.join(__dirname, `.${tag}.entry.ts`);
  const outfile = path.join(__dirname, `.${tag}.bundle.cjs`);
  const cleanup = () => [entry, outfile].forEach((f) => fs.rmSync(f, { force: true }));
  try {
    fs.writeFileSync(entry, entrySource);
    esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node" });
    return { mod: require(outfile), err: undefined, cleanup };
  } catch (e) {
    return { mod: {}, err: e, cleanup };
  }
}

const NEW = bundle(
  "blind-v28-p1-new",
  `export { spanTypesInPlay } from "../src/core/repairTypes";\n` +
    `export { undisclosedMemberRefusal } from "../src/core/repairGate";\n`,
);
const OLD = bundle("blind-v28-p1-old", `export { classifyCsHallucination } from "../src/core/compilerDirected";\n`);

test.after(() => {
  NEW.cleanup();
  OLD.cleanup();
});

// Resolve an export or fail with the reason. A bundle error and a missing
// export read differently, which is the whole point: the first is "the module
// is not there", the second is "the module is there and the contract is not".
function need(b, name) {
  if (b.err) assert.fail(`${name}: the bundle failed to build, so the module or its export is missing.\n  ${b.err.message}`);
  assert.equal(typeof b.mod[name], "function", `${name} must be exported as a function from its core module`);
  return b.mod[name];
}

const spanTypes = (input) => need(NEW, "spanTypesInPlay")(input);
const refusal = (code, disclosed) => need(NEW, "undisclosedMemberRefusal")(code, disclosed);
const classifyCs = (d) => need(OLD, "classifyCsHallucination")(d);

test("bundle guard: the phase-1 pure cores build headless, with no vscode and no network", () => {
  if (NEW.err) assert.fail(`src/core/repairTypes.ts + src/core/repairGate.ts must bundle standalone (src/core never imports vscode).\n  ${NEW.err.message}`);
  if (OLD.err) assert.fail(`src/core/compilerDirected.ts must keep bundling standalone.\n  ${OLD.err.message}`);
  for (const [b, n] of [[NEW, "spanTypesInPlay"], [NEW, "undisclosedMemberRefusal"], [OLD, "classifyCsHallucination"]]) {
    assert.equal(typeof b.mod[n], "function", `${n} must be exported`);
  }
});

const show = (v) => JSON.stringify(v);

// ===========================================================================
// A. `spanTypesInPlay` - the span's types, not the diagnostic's.
//
// Contract: design-p1.md, "New pure core: src/core/repairTypes.ts". Four tiers,
// first-seen wins, deduped across all of them, std/prelude names excluded,
// pure, never throws.
// ===========================================================================

// A1. THE CAPTURE. Capture A's span puts two types in play and the old keying
// could only ever name one of them. `List<Tile>` in the signature and
// `LodBand.Regional` in the body is the exact shape whose second type went
// missing, so this row is the defect stated as a bar.
test("A1 [csharp]: the capture span yields BOTH the signature type and the body-only type", () => {
  const out = spanTypes({
    languageId: "csharp",
    signature: "public int RegionLodCount(List<Tile> tiles)",
    docComment: "/// <summary>How many tiles where LodBand is Region.</summary>",
    code: `public int RegionLodCount(List<Tile> tiles)
{
    return tiles.Count(tile => tile.Lod == LodBand.Regional);
}`,
  });
  assert.ok(out.includes("Tile"), `the signature names List<Tile>, so Tile is in play; got ${show(out)}`);
  assert.ok(
    out.includes("LodBand"),
    `LodBand appears ONLY in the body, and a surface keyed to the diagnostic could never see it. That hole is capture A. Got ${show(out)}`,
  );
});

// A2. Every language with these patterns, which is the human's standing
// standard for this session ("should work for all languages that have similar
// functional iterator patterns"). One table, one shape, the row named in every
// failure message. Each row carries:
//   sigType   a user type named in the signature      -> tier 1
//   bodyType  a user type named ONLY in the body, in a qualifier, construction
//             or declaration position                 -> tier 2
//   std       names from the language's own std/prelude set, which are never
//             worth resolving and must never be emitted
//   notTypes  PascalCase words that are a local variable, a call, or a bare
//             constant. The contract is explicit: the qualifier/construction
//             POSITION is the evidence, a capital letter is not.
const LANGS = [
  {
    languageId: "csharp",
    sigType: "Tile",
    bodyType: "LodBand",
    std: ["List"],
    notTypes: ["Foo", "Helper"],
    signature: "public int RegionLodCount(List<Tile> tiles)",
    code: `public int RegionLodCount(List<Tile> tiles)
{
    var Foo = 0;
    Helper();
    return tiles.Count(tile => tile.Lod == LodBand.Regional) + Foo;
}`,
  },
  {
    languageId: "typescript",
    sigType: "Tile",
    bodyType: "LodBand",
    std: ["Array"],
    notTypes: ["Foo", "Helper"],
    signature: "export function regionLodCount(tiles: Array<Tile>): number",
    code: `export function regionLodCount(tiles: Array<Tile>): number {
  const Foo = 0;
  Helper();
  return tiles.filter((t) => t.lod === LodBand.Regional).length + Foo;
}`,
  },
  {
    languageId: "python",
    sigType: "Tile",
    bodyType: "LodBand",
    std: ["List"],
    notTypes: ["Foo", "Helper"],
    signature: "def region_lod_count(tiles: List[Tile]) -> int:",
    code: `def region_lod_count(tiles: List[Tile]) -> int:
    Foo = 0
    Helper()
    return len([t for t in tiles if t.lod == LodBand.Regional]) + Foo`,
  },
  {
    // Rust's qualifier is `::`, the same evidence class as the `.` the contract
    // spells out for the dotted languages. A leg that only knows `.` leaves
    // Rust spans half-disclosed, which is the defect this session closes.
    languageId: "rust",
    sigType: "Tile",
    bodyType: "LodBand",
    std: ["Vec"],
    notTypes: ["Foo"],
    signature: "pub fn region_lod_count(tiles: &Vec<Tile>) -> usize",
    code: `pub fn region_lod_count(tiles: &Vec<Tile>) -> usize {
    let Foo = 0;
    tiles.iter().filter(|t| t.lod == LodBand::Regional).count() + Foo
}`,
  },
  {
    // Go names a type in a DECLARATION position (`var band LodBand`), which the
    // contract lists as `Tile x = `. `LodBandRegional` on the right of the `=`
    // is a constant, not a type, and is the sharpest bare-PascalCase negative
    // in the table: it even starts with the type's own name.
    languageId: "go",
    sigType: "Tile",
    bodyType: "LodBand",
    std: ["Context"],
    notTypes: ["Foo", "Helper", "LodBandRegional"],
    signature: "func RegionLodCount(ctx Context, tiles []Tile) int",
    code: `func RegionLodCount(ctx Context, tiles []Tile) int {
\tFoo := 0
\tHelper()
\tvar band LodBand = LodBandRegional
\tn := 0
\tfor _, t := range tiles {
\t\tif t.Lod == band {
\t\t\tn++
\t\t}
\t}
\treturn n + Foo
}`,
  },
];

for (const row of LANGS) {
  test(`A2 [${row.languageId}]: signature type first, body-only type after it, std out, bare PascalCase not a type`, () => {
    const out = spanTypes({ languageId: row.languageId, signature: row.signature, code: row.code });
    const where = `\n  LANG=${row.languageId}\n  GOT=${show(out)}`;

    assert.ok(out.includes(row.sigType), `${row.sigType} is named in the signature and must be in play.${where}`);
    assert.ok(
      out.includes(row.bodyType),
      `${row.bodyType} is named ONLY in the body. A surface that reads the signature alone cannot see it, and that blindness is what the model filled in with an invention.${where}`,
    );
    assert.ok(
      out.indexOf(row.sigType) < out.indexOf(row.bodyType),
      `tier order: signature-named types come before body-only types, so a budget that truncates cuts the weaker evidence first.${where}`,
    );

    for (const s of row.std) {
      assert.ok(
        !out.includes(s),
        `${s} is a std/prelude name. Resolving it burns the budget the span's own types need.${where}`,
      );
    }
    for (const n of row.notTypes) {
      assert.ok(
        !out.includes(n),
        `${n} is a local, a call or a constant, never a type. The qualifier/construction POSITION is the evidence; a capital letter is not.${where}`,
      );
    }

    assert.equal(new Set(out).size, out.length, `no name may repeat.${where}`);
  });
}

// A3. Cross-tier order, all four tiers in one span. Order is not cosmetic: the
// list feeds a budget-capped resolver, so whatever sorts last is what a narrow
// budget drops. The compiler's own named type sorts LAST on purpose - it is the
// evidence that keyed the broken surface, and the span is the question.
test("A3 [csharp]: signature, then body-only, then doc-backticked, then diagnostic-named", () => {
  const out = spanTypes({
    languageId: "csharp",
    signature: "public int Build(Tile tile)",
    docComment: "/// <summary>Writes through `Ledger` when the band changes.</summary>",
    code: `public int Build(Tile tile)
{
    return LodBand.Regional == tile.Band ? 1 : 0;
}`,
    diagnosticTypes: ["Parcel"],
  });
  const at = (n) => {
    const i = out.indexOf(n);
    assert.ok(i >= 0, `${n} must be in play; got ${show(out)}`);
    return i;
  };
  assert.ok(at("Tile") < at("LodBand"), `signature tier before body tier; got ${show(out)}`);
  assert.ok(at("LodBand") < at("Ledger"), `body tier before the doc-backticked tier; got ${show(out)}`);
  assert.ok(at("Ledger") < at("Parcel"), `diagnostic-named types sort last, because the span is the question and the diagnostic is only a witness; got ${show(out)}`);
});

// A4. `Console` is the row that matters here. It is not in a signature, so no
// signature-only scan ever met it, but a BODY scan meets it constantly and it
// is std by any reading. A body tier that ships without widening the std set
// spends the budget on System.Console. `new List<Tile>()` also proves the
// construction position does not smuggle a std name back in.
test("A4 [csharp]: std names never appear, in a signature or in the body", () => {
  const out = spanTypes({
    languageId: "csharp",
    signature: "public async Task<IEnumerable<Tile>> Load(List<String> names)",
    code: `public async Task<IEnumerable<Tile>> Load(List<String> names)
{
    Console.WriteLine(names.Count);
    return new List<Tile>();
}`,
  });
  assert.ok(out.includes("Tile"), `the one user type survives; got ${show(out)}`);
  for (const s of ["List", "String", "Task", "IEnumerable", "Console"]) {
    assert.ok(!out.includes(s), `${s} is std and must never be offered for resolution; got ${show(out)}`);
  }
});

// A5. Dedup across tiers. `Tile` sits in the signature AND is constructed in
// the body; two mentions of one type must not eat two budget slots.
test("A5 [csharp]: a type named in both the signature and the body appears once", () => {
  const out = spanTypes({
    languageId: "csharp",
    signature: "public Tile Pick(List<Tile> tiles)",
    code: `public Tile Pick(List<Tile> tiles)
{
    return new Tile();
}`,
  });
  assert.deepEqual(out.filter((t) => t === "Tile"), ["Tile"], `Tile is one type, however many times the span writes it; got ${show(out)}`);
});

// A6. Two things in the signature are not types in play, and both cost a budget
// slot that the span's real collaborators need.
//
// `T` is a generic parameter the signature itself declares, and the contract
// excludes it by name. `Pick` is the declared method's own name, and a
// PascalCase C# method name walks straight into a naive type scan - the same
// defect `typesNamedIn`'s `excludeName` was added to close, arriving through a
// new door. `SpanTypesInput` carries no symbolName, so the fix is to hand the
// language's `typesInPlay` sibling the parameter and return region rather than
// the whole header.
test("A6 [csharp]: neither a declared generic parameter nor the method's own name is a type in play", () => {
  const out = spanTypes({
    languageId: "csharp",
    signature: "public T Pick<T>(List<T> items, Tile probe)",
    code: `public T Pick<T>(List<T> items, Tile probe)
{
    return items[0];
}`,
  });
  assert.ok(!out.includes("T"), `T is declared by this signature, so there is nothing to disclose about it; got ${show(out)}`);
  assert.ok(!out.includes("Pick"), `Pick is the method being repaired, not a collaborator; resolving it fills a slot with garbage. Got ${show(out)}`);
  assert.deepEqual(out, ["Tile"], `Tile is the only resolvable type here; got ${show(out)}`);
});

// A7. The body scan reads over comment/string-masked text. A type name inside a
// comment is prose and a type name inside a string is data. Neither is in play,
// and both are cheap ways to fill a budget with nothing.
test("A7 [csharp]: names inside comments and string literals are not in play", () => {
  const out = spanTypes({
    languageId: "csharp",
    signature: "public int Count(Tile tile)",
    code: `public int Count(Tile tile)
{
    // Ghost.Member is not real
    var s = "Phantom.Member";
    return tile.Band == LodBand.Regional ? 1 : 0;
}`,
  });
  assert.ok(out.includes("Tile") && out.includes("LodBand"), `the real types survive; got ${show(out)}`);
  assert.ok(!out.includes("Ghost"), `a name in a comment is prose; got ${show(out)}`);
  assert.ok(!out.includes("Phantom"), `a name in a string literal is data; got ${show(out)}`);
});

// A8. Never throws. This runs inside a repair round on text the model just
// wrote, which is the least trustworthy text in the product. A throw here costs
// the human their repair; an empty list costs them nothing they had.
const GARBAGE = [
  ["empty code", { languageId: "csharp", code: "" }, true],
  ["whitespace only", { languageId: "csharp", code: "   \n\t\n  " }, true],
  ["punctuation soup", { languageId: "csharp", code: ")))) <<<< >>>> ;;;; @#$% ``` \"" }, true],
  ["empty language id", { languageId: "", code: "" }, true],
  ["unbalanced generics", { languageId: "csharp", signature: "public List<Tile Broken(", code: "public List<Tile Broken(" }, false],
  ["unknown language id", { languageId: "cobol", code: "return tiles.Count(tile => tile.Lod == LodBand.Regional);" }, false],
  ["no optional fields at all", { languageId: "typescript", code: "return new Tile();" }, false],
  ["long repeated text", { languageId: "csharp", code: "Tile.Band == LodBand.Regional; ".repeat(500) }, false],
  ["empty diagnostic list", { languageId: "csharp", code: "return 0;", diagnosticTypes: [] }, true],
];

for (const [name, input, expectEmpty] of GARBAGE) {
  test(`A8 [${name}]: returns a string array rather than throwing`, () => {
    const out = spanTypes(input);
    assert.ok(Array.isArray(out), `must return an array; got ${show(out)}`);
    for (const t of out) assert.equal(typeof t, "string", `every entry is a type name; got ${show(out)}`);
    if (expectEmpty) assert.deepEqual(out, [], `nothing is in play here, so the answer is the empty list; got ${show(out)}`);
  });
}

// ===========================================================================
// B. `undisclosedMemberRefusal` - the gate that closes `tile.LodBand`.
//
// Contract: design-p1.md, "The repair member gate". Two legs, both anchored in
// capture B, neither needing type inference. Pure and language-neutral: the
// signature takes code and a disclosed list, no languageId, so the same dotted
// evidence is read the same way everywhere.
//
// A refusal leaves the human exactly where the round started, so the gate may
// only fire on COMPLETE evidence. Half of these rows exist to hold it shut.
// ===========================================================================

const LODBAND = { name: "LodBand", members: ["Continental", "Municipal", "Parcel", "Regional"], complete: true };
const TILE = { name: "Tile", members: ["Band", "Lod", "Weight"], complete: true };

// B1. Capture B round 1, verbatim. `LodBand.Region` after a surface that listed
// all four variants: the model named a variant the type does not have, and the
// disclosed evidence is complete, so the gate has everything it needs to say no.
test("B1 static leg: a member absent from a COMPLETE disclosed type refuses, naming the type and the member", () => {
  const why = refusal("return tiles.Count(tile => tile.Lod == LodBand.Region);", [TILE, LODBAND]);
  assert.equal(typeof why, "string", `LodBand.Region contradicts a complete four-variant surface; got ${show(why)}`);
  assert.match(why, /\bLodBand\b/, `the reason must name the type, so the channel line is diagnosable: ${show(why)}`);
  assert.match(why, /\bRegion\b/, `the reason must name the member that does not exist: ${show(why)}`);
});

// B2. The paired positive, and it is what stops B1 being a gate that refuses
// everything. Same span, right variant, accepted.
test("B2 static leg: the same code with a real member is accepted", () => {
  assert.equal(
    refusal("return tiles.Count(tile => tile.Lod == LodBand.Regional);", [TILE, LODBAND]),
    undefined,
    "Regional is in the disclosed list, so nothing is contradicted",
  );
});

// B3. Truncation is the reason the `complete` flag exists. A list cut at a cap
// says nothing about what is missing, and refusing on it would reject correct
// repairs at exactly the wide types where the cap bites.
test("B3 static leg: a type with complete:false never refuses, however wrong the member", () => {
  const partial = { name: "LodBand", members: ["Regional"], complete: false };
  assert.equal(refusal("return tiles.Count(tile => tile.Lod == LodBand.Nonsense);", [partial]), undefined);
  assert.equal(refusal("var x = LodBand.AbsolutelyNotAVariant;", [partial]), undefined);
});

// B4. Capture B round 2, verbatim. `tile.LodBand` is the invention that shipped
// into the human's file. The gate closes it without knowing what `tile` is: a
// type is not a member of a value, and that is the whole rule.
test("B4 type-as-member leg: a disclosed TYPE name used as a member refuses", () => {
  const why = refusal("return tiles.Count(tile => tile.LodBand == LodBand.Regional);", [TILE, LODBAND]);
  assert.equal(typeof why, "string", `tile.LodBand names a type where a member belongs; got ${show(why)}`);
  assert.match(why, /\bLodBand\b/, `the reason must name the type the model used as a member: ${show(why)}`);
});

// B5. THE PERMISSION CLAUSE, and it is the expensive half. The injected
// instruction says calls on other values in scope stay allowed, and a gate that
// contradicts it would reject correct repairs wholesale. Every receiver here has
// an undisclosed type, so the gate knows nothing about any of these members and
// must therefore say nothing.
test("B5 permission: members on values whose types were never disclosed are accepted", () => {
  const code = `var sb = new StringBuilder();
sb.Append(tiles.Count);
var hot = list.Where(y => y != null).ToList();
return tiles.Count(t => t.Band == LodBand.Regional) + hot.Count;`;
  assert.equal(
    refusal(code, [TILE, LODBAND]),
    undefined,
    "sb.Append, tiles.Count and list.Where sit on undisclosed receivers. The gate only knows what it was told",
  );
});

// B6. The type-as-member leg needs the receiver to be a VALUE. `Tile.LodBand`
// is a nested-type access, and Tile is disclosed. Tile carries complete:false
// here on purpose, so the static leg cannot fire and this row tests exactly one
// clause: an implementation that drops the "receiver is not a disclosed type
// name" condition reds here and nowhere else.
test("B6 type-as-member leg: a nested-type access on a disclosed TYPE receiver is not refused", () => {
  const partialTile = { name: "Tile", members: ["Band", "Lod"], complete: false };
  assert.equal(refusal("return Tile.LodBand.Regional == LodBand.Regional;", [partialTile, LODBAND]), undefined);
});

// B7. The third clause of the type-as-member leg. A type name that is ALSO a
// member of a disclosed type is a legitimate member access, and the disclosed
// evidence says so out loud.
test("B7 type-as-member leg: a type name that is also a disclosed member is accepted", () => {
  const tileWithNested = { name: "Tile", members: ["Band", "Lod", "LodBand"], complete: true };
  assert.equal(refusal("return tiles.Count(tile => tile.LodBand == LodBand.Regional);", [tileWithNested, LODBAND]), undefined);
});

// B8. Masked text, both legs. A refusal aborts the round, so a violation the
// compiler will never see must not cost the human their repair. Every row
// carries a real, correct repair after the masked text: the gate has to read
// past the noise and land on the good code.
const TAIL = "return tiles.Count(tile => tile.Band == LodBand.Regional);";
const MASKS = [
  ["line comment", (v) => `// ${v}\n${TAIL}`],
  ["block comment", (v) => `/* ${v} */\n${TAIL}`],
  ["string literal", (v) => `var msg = "${v}";\n${TAIL}`],
];
const VIOLATIONS = [
  ["static leg", "LodBand.Region"],
  ["type-as-member leg", "tile.LodBand"],
];

for (const [legName, violation] of VIOLATIONS) {
  for (const [maskName, wrap] of MASKS) {
    test(`B8 masking [${legName} in a ${maskName}]: an occurrence outside live code is ignored`, () => {
      assert.equal(
        refusal(wrap(violation), [TILE, LODBAND]),
        undefined,
        `${violation} inside a ${maskName} is prose or data, not a call. Refusing on it costs a correct repair`,
      );
    });
  }
  // The control. Without it the masking rows above pass on a gate that never
  // fires at all, which is the failure mode a masking test invites.
  test(`B8 control [${legName}]: the same text in live code still refuses`, () => {
    const code = legName === "static leg" ? `return tiles.Count(tile => tile.Lod == ${violation});` : `return tiles.Count(tile => ${violation} == LodBand.Regional);`;
    assert.equal(typeof refusal(code, [TILE, LODBAND]), "string", `unmasked, ${violation} is the capture and must refuse`);
  });
}

// B9. No disclosed surface means no evidence, and no evidence means no refusal.
// This is the branch the repair loop takes whenever the resolver came back
// empty, which is common on a cold first visit.
test("B9: an empty disclosed list never refuses", () => {
  const code = `return tiles.Count(tile => tile.LodBand == LodBand.Region);`;
  assert.equal(refusal(code, []), undefined, "with nothing disclosed there is nothing to contradict");
  assert.equal(refusal("total garbage )))) LodBand.Region", []), undefined);
});

// B10. Never throws, for the same reason A8 exists: this runs on model output,
// after post-processing, one step before the human sees a proposal. The
// metacharacter row is the sharp one - a matcher built by string-concatenating
// names into a regex blows up on it.
const GATE_GARBAGE = [
  ["empty code", "", [TILE, LODBAND]],
  ["punctuation soup", ")))) .... @#$% `` \" \"", [TILE, LODBAND]],
  ["a complete type with no members", "Empty.Anything", [{ name: "Empty", members: [], complete: true }]],
  ["regex metacharacters in the names", "x.y", [{ name: "Weird[a-z]", members: ["A+B", "C*"], complete: true }]],
  ["a lone dot", ".", [TILE]],
  ["trailing dot", "tile.", [TILE, LODBAND]],
  ["long repeated text", "tile.Band == LodBand.Regional; ".repeat(500), [TILE, LODBAND]],
];

for (const [name, code, disclosed] of GATE_GARBAGE) {
  test(`B10 [${name}]: returns a reason or undefined, never a throw`, () => {
    const why = refusal(code, disclosed);
    assert.ok(why === undefined || typeof why === "string", `must be a reason string or undefined; got ${show(why)}`);
  });
}

// ===========================================================================
// C. CS0019 joins the classified set.
//
// Contract: design-p1.md, "CS0019 joins the classified set". Round 2 of capture
// B read class=none on this exact message and injected NOTHING, and the model
// filled the silence with `tile.LodBand`. The class resolves no member block of
// its own; what it does is carry the operand type names to the span resolver.
// ===========================================================================

// The Diagnostic shape the C# transport hands the classifier: 1-based lines and
// columns in the span, and the classifier hands back a 0-based cursor.
const csDiag = (code, message, lineStart = 5, columnStart = 9) => ({
  code,
  level: "error",
  message,
  spans: [{ isPrimary: true, lineStart, lineEnd: lineStart, columnStart, columnEnd: columnStart + 3 }],
  suggestions: [],
});

test("C1: CS0019 classifies to operand-mismatch, carrying BOTH operand types and a 0-based cursor", () => {
  const cls = classifyCs(csDiag("CS0019", "Operator '==' cannot be applied to operands of type 'int' and 'LodBand'", 12, 21));
  assert.equal(cls && cls.kind, "operand-mismatch", `CS0019 read as class=none is the round that injected nothing; got ${show(cls)}`);
  assert.ok(Array.isArray(cls.types), `the operand types ride the class as an array; got ${show(cls)}`);
  assert.deepEqual(
    [...cls.types].sort(),
    ["LodBand", "int"],
    `BOTH operands are named, because either one may be the type the span never disclosed; got ${show(cls.types)}`,
  );
  assert.deepEqual(cls.cursor, { line: 11, character: 20 }, `the cursor is the primary span, converted 0-based; got ${show(cls.cursor)}`);
});

// C2. No primary span means nowhere to point, which is the same restraint every
// other class already keeps.
for (const [name, spans] of [
  ["no spans at all", []],
  ["a span that is not primary", [{ isPrimary: false, lineStart: 3, lineEnd: 3, columnStart: 7, columnEnd: 9 }]],
]) {
  test(`C2 [${name}]: a CS0019 with no primary span classifies to undefined`, () => {
    assert.equal(
      classifyCs({ code: "CS0019", level: "error", message: "Operator '==' cannot be applied to operands of type 'int' and 'LodBand'", spans, suggestions: [] }),
      undefined,
    );
  });
}

// C3. Restraint unchanged. Adding one code must not turn the classifier into a
// thing that classifies everything: a conversion error and an unresolved name
// are not hallucinated surfaces and still inject nothing.
for (const [code, message] of [
  ["CS0029", "Cannot implicitly convert type 'int' to 'string'"],
  ["CS0161", "'Tile.Band': not all code paths return a value"],
  ["CS0103", "The name 'Missing' does not exist in the current context"],
  ["CS0246", "The type or namespace name 'Nonexistent' could not be found (are you missing a using directive or an assembly reference?)"],
]) {
  test(`C3 [${code}]: a code outside the classified set still returns undefined`, () => {
    assert.equal(classifyCs(csDiag(code, message)), undefined, `${code} is not a hallucinated surface`);
  });
}
