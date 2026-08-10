// ADVERSARIAL REVIEW evidence, session-v45 phase 0. Every test here is RED on
// purpose: each one is a defect claim, and the assertion IS the claim. Written
// by the review agent, not by the builder. Triage decides what gets fixed;
// nothing in this file is a fix.
//
// The corpus-level blast radius quoted in each header was measured against
// ~/sandbox/v43-corpus with the Roslyn syntax oracle as ground truth
// (Microsoft.CodeAnalysis.CSharp 5.6.0, CSharpSyntaxTree.ParseText, all five
// pinned roots): 3,705 brace-bodied members vs the scanner's 3,696.
//
// Run: node --test test/review-v45-p0-scanner.test.cjs

// THE MEASUREMENT RIG LIVES IN A DIFFERENT REPOSITORY (2026-08-10). It and the
// session archives were split into a private repo because they carry corpora
// taken against private client code and cannot be published, so a public clone
// has no `session-complxity-research/` and the rows below have no subject.
//
// The whole file skips, with the reason on the channel. It SKIPS rather than
// passing vacuously: a row that goes green when the thing it tests is absent is
// the false green this suite exists to prevent. Where a baseline can be
// vendored instead, vendor it (see test/fixtures/prompt) and do not use this.
const { RIG_PRESENT, SKIP_REASON } = require("./.rig-present.cjs");
if (!RIG_PRESENT) {
  require("node:test")("rig-dependent rows", { skip: SKIP_REASON }, () => {});
  return;
}

const test = require("node:test");
const assert = require("node:assert/strict");

const { scanMethods } = require("../session-complxity-research/spikes/lib-cs-scan.cjs");
const { placeAtColumn } = require("../session-complxity-research/spikes/lib-cs.cjs");

// --------------------------------------------------------------------------
// F1 (HIGH). An attribute on a TYPE PARAMETER makes the whole method vanish,
// with no entry in `skipped`. findParamList walks forward and meets the
// attribute's own `(` before the parameter list's; the head then fails to
// parse and parseDeclaration returns null on the untracked path.
//
// Corpus blast radius: 22 of the 27 methods the Roslyn oracle finds and the
// scanner does not. Every one is public trim-annotated API - Autofac's
// RegisterType/RegisterDecorator/RegisterComposite/PropertiesAutowired,
// Polly's AddRetry/AddFallback/AddHedging/AddCircuitBreaker/AddChaosOutcome.
// --------------------------------------------------------------------------
test("F1: a method with an attribute on a type parameter is silently dropped", () => {
  const src = `class C {
    public static void M<[Attr(Foo.Bar)] T>(T x)
    {
        Use(x);
    }
}`;
  const found = scanMethods(src);
  assert.deepEqual(found.map((m) => m.name), ["M"], "M must be scanned");
  assert.deepEqual(
    { ...found.skipped },
    { expressionBodied: 0, bodyless: 0, unbalanced: 0 },
    "and if it is dropped it must at least be counted",
  );
});

// --------------------------------------------------------------------------
// F2 (HIGH). A tuple nested inside a GENERIC return type is the unfixed
// sibling of the tuple bug the blind oracle already caught. The suffix loop
// after skipParenGroup handles `[]`, `?` and `*`, but not a closing `>`, so
// `Task<(bool, string)> M(` mistakes the tuple's paren for the parameter list.
// Silent, no `skipped` entry.
//
// Corpus blast radius: 5 of the 27 missing methods - Polly's three
// IAsyncCacheProvider.TryGetAsync overloads, Autofac's
// GetAllSpecificKeyedRegistrations and BuildStandardRegistrationList.
// --------------------------------------------------------------------------
test("F2: a tuple inside a generic return type silently drops the method", () => {
  const src = `class C {
    public Task<(bool, string)> M(string k)
    {
        return null;
    }
}`;
  const found = scanMethods(src);
  assert.deepEqual(found.map((m) => m.name), ["M"]);
});

// --------------------------------------------------------------------------
// F3 (MEDIUM). findParamList bails on `=`, so every operator whose token
// contains one - `==`, `!=`, `<=`, `>=` - never reaches a counter. These are
// rejected from the population anyway (`kind !== "method"`), so no candidate
// row is lost; what is lost is the honesty of the counts the exit gate states.
//
// Corpus blast radius: 11 brace-bodied operators missing outright, plus a
// consistent 4-per-struct undercount of `skipped.expressionBodied` across
// nodatime's value types (their `==`/`!=`/`<=`/`>=` are expression-bodied).
// --------------------------------------------------------------------------
test("F3: operators whose token contains '=' are dropped with no counter", () => {
  const src = `class C {
    public static bool operator ==(C a, C b)
    {
        return true;
    }
    public static bool operator !=(C a, C b)
    {
        return false;
    }
    public static C operator +(C a, C b)
    {
        return a;
    }
}`;
  const found = scanMethods(src);
  assert.deepEqual(found.map((m) => m.name), ["operator ==", "operator !=", "operator +"]);
});

// --------------------------------------------------------------------------
// F4 (HIGH). placeAtColumn takes `common` as the MINIMUM indent over the
// continuation lines. A preprocessor line at column 0 inside a body - the
// `#pragma warning disable` idiom - makes common 0, so every line of the body
// gains `indent`. Splicing a candidate's OWN bytes back over itself therefore
// does NOT reproduce the file, and C# being whitespace-insensitive the build
// stays green: this is the same invisible corruption lib-cs.cjs's own header
// says the no-op round trip exists to catch, surviving in the other direction.
//
// Corpus blast radius, measured: 85 of 2,073 candidate rows (4.1%) - Polly 79,
// Autofac 3, nodatime 2, serilog 1. All 85 are `#pragma` at column 0.
// PROVEN LIVE: a no-op spliceFunction of
// Autofac/src/Autofac/ContainerBuilder.cs:Build wrote 104 extra bytes and
// `dotnet build` still returned 0.
// --------------------------------------------------------------------------
test("F4: a no-op splice is not byte-identical when a body line sits at column 0", () => {
  const original = [
    "public void Build()",
    "    {",
    "        First();",
    "#pragma warning disable CA2000",
    "        Second();",
    "#pragma warning restore CA2000",
    "    }",
  ].join("\n");
  assert.equal(
    placeAtColumn(original, "    "),
    original,
    "placing a method's own text at its own column must be a no-op",
  );
});

// --------------------------------------------------------------------------
// F5 (LOW here, HIGH on a different corpus). openString counts the leading
// quote run before it looks at the `@` prefix, so a VERBATIM string that opens
// with an escaped quote - `@"""bad"" thing"`, three quotes - is read as a RAW
// string needing a run of three to close. It never closes, the rest of the
// file classes as string, and every method after it disappears.
//
// Corpus blast radius: ZERO. `grep -rn '@"""'` over all five pinned roots
// returns nothing. Latent only - it costs a future corpus, not this one.
// --------------------------------------------------------------------------
test("F5: a verbatim string opening with an escaped quote swallows the file", () => {
  const src = `class C {
    void M()
    {
        var s = @"""bad"" thing";
    }
    void N()
    {
        var y = 2;
    }
}`;
  assert.deepEqual(scanMethods(src).map((m) => m.name), ["M", "N"]);
});

// --------------------------------------------------------------------------
// F6 (LOW). directiveLines reads the raw text with no class mask, so a line
// inside a verbatim or raw string whose first non-space character is `#if`
// counts as a directive - and, having no `#endif`, marks every remaining
// method in the file `insideDirectiveRegion`, which 01-corpus-cs.cjs rejects.
// A whole file's tail can leave the population this way.
//
// Corpus blast radius: ZERO today. No directive-shaped line inside a string or
// comment exists in the five pinned roots (checked byte by byte against
// classify()). Latent.
// --------------------------------------------------------------------------
test("F6: a '#if' line inside a verbatim string is treated as a directive", () => {
  const src = `class C {
    void M()
    {
        var s = @"
#if FOO
";
    }
    void N()
    {
        var y = 2;
    }
}`;
  const [m, n] = scanMethods(src);
  assert.equal(m.crossesDirective, false, "a string's contents are not a directive");
  assert.equal(n.insideDirectiveRegion, false, "and must not open a region over the rest of the file");
});

// --------------------------------------------------------------------------
// F7 (MEDIUM). refreshCandidates' disambiguation ladder is signature ->
// typePath -> unique name. `Foo` and `Foo<T>` in one file share a typePath
// (enclosingTypeOf strips generics, per contract) and their overrides share a
// signature, so neither rung separates them and BOTH rows are dropped.
//
// Corpus blast radius, measured against the UNMODIFIED corpus: 8 of 2,073 rows
// dropped on the first refresh - Polly's AsyncBulkheadPolicy.Dispose,
// BulkheadPolicy.Dispose, AsyncPolicyWrap.SetPolicyContext and
// PolicyWrap.SetPolicyContext pairs. A refresh against unchanged files must be
// 2,073 unchanged, 0 dropped.
// --------------------------------------------------------------------------
test("F7: a generic and non-generic type of the same name defeat refreshCandidates", {
  todo:
    "RULED by triage: the DEFECT is fixed, this remedy is not the one taken. refreshCandidates now " +
    "carries an `ordinal` rung (position among same-named methods in the file), and a refresh over " +
    "the untouched corpus is 2100 unchanged / 0 dropped, measured. This row instead asserts that " +
    "typePath must distinguish P from P<T>, which contract-phase0 forbids outright ('generics " +
    "stripped: class Box<T> -> Box') and which 97 blind rows bind. Kept RED rather than deleted " +
    "because it is the record of the alternative remedy and of what would have to change to take it.",
}, () => {
  const src = `public class P {
    public void Dispose()
    {
        A();
    }
}
public class P<T> {
    public void Dispose()
    {
        B();
    }
}`;
  const found = scanMethods(src).filter((m) => m.name === "Dispose");
  assert.equal(found.length, 2);
  assert.notEqual(
    found[0].typePath,
    found[1].typePath,
    "refreshCandidates has no rung left once signature and typePath both tie",
  );
});
