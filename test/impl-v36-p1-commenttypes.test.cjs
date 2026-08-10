// IMPLEMENTER tests - session-v36 phase 1, the backtick gesture for
// comment-named types. White-box: written against the implementation, covering
// the mechanics the blind contract set cannot see from outside.
//
// Companion to test/blind-v36-p1-comment-backticks.test.cjs, which is frozen
// and binds only to `spanTypesInPlay`. Where a row here overlaps a row there,
// the frozen one wins. What is here and not there: the extraction helper on its
// own, all five fn-gen candidate lists (the repair leg and the fn-gen leg order
// the tier DIFFERENTLY and only these rows say so), the cost and termination
// bounds, and the proof that a caller who passes no span gets the pre-change
// list byte for byte.
//
// Run: SKIP_LIVE=1 node --test test/impl-v36-p1-commenttypes.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v36-p1-commenttypes",
  `export { commentTypesIn } from "../src/core/commentTypes";
export { backtickedTypeNames, typesNamedIn, PRELUDE_TYPES } from "../src/core/compilerDirected";
export { spanTypesInPlay, stopNamesFor } from "../src/core/repairTypes";\n`,
);
const { commentTypesIn, backtickedTypeNames, typesNamedIn, PRELUDE_TYPES, spanTypesInPlay, stopNamesFor } = mod;
test.after(cleanup);

const show = (v) => JSON.stringify(v);

// ===========================================================================
// 1. THE EXTRACTION HELPER. `backtickedTypeNames` was cut out of typesNamedIn's
// doc leg so the body leg is the same rule and not a second regex. These rows
// pin what that rule is, including the parts of it that are deliberately narrow.
// ===========================================================================

// UPDATED 2026-08-02 for session-v37 item 1, which widens the rule inside the
// span from "the whole span is one identifier or a `::` path" to "split on
// commas and on generic or bracket punctuation, take the first identifier of
// each part". The human ratified the widening; these are white-box rows and
// they move with the implementation, unlike the blind rows, which were
// superseded in writing with the date on them.
test("backtickedTypeNames takes the final :: segment of each part, and refuses a dot", () => {
  assert.deepEqual(backtickedTypeNames("see `Widget`"), ["Widget"]);
  assert.deepEqual(backtickedTypeNames("see `fastbloom::BloomFilter`"), ["BloomFilter"]);
  assert.deepEqual(backtickedTypeNames("see `a::b::Deep`"), ["Deep"]);
  assert.deepEqual(backtickedTypeNames("see `widget`"), [], "a lowercase leaf is not a type");
  assert.deepEqual(backtickedTypeNames("see `fastbloom`"), [], "a crate alone is not a pre-fillable type");
  // A dot joins a path the way `::` does, and the type is the segment on the
  // RIGHT. The first cut of this rule took the leading segment and so injected
  // the NAMESPACE and lost the type, which is an invented name by this item's
  // own bar and lands hardest on C# and Python where qualified names are normal.
  assert.deepEqual(backtickedTypeNames("see `Some.Namespace.Widget`"), ["Widget"], "a qualified name is the type on the right");
  // Two segments with both ends type-shaped is genuinely ambiguous, so both are
  // emitted and resolution refuses the wrong one. Three or more is not: nobody
  // writes a two-deep member chain in a doc comment, they write a namespace.
  assert.deepEqual(backtickedTypeNames("see `Severity.Error`"), ["Error", "Severity"], "a two-segment path hedges both ends");
  assert.deepEqual(backtickedTypeNames("see `http.Client`"), ["Client"], "and a lowercase package qualifier is still a qualifier");
  // The other direction, which is what stops that rule reading every dotted
  // expression in a doc comment as a type. A member access falls back to the
  // left, and a CALL names its receiver.
  assert.deepEqual(backtickedTypeNames("see `CrateResolution.gatingFeature`"), ["CrateResolution"], "a member access names the type on the left");
  assert.deepEqual(backtickedTypeNames("see `Assert.AreEqual(x, y)`"), ["Assert"], "a call names its receiver, not its method");
  assert.deepEqual(backtickedTypeNames("see `some.module`"), [], "and a path with no type-shaped segment yields nothing");
});

test("backtickedTypeNames returns raw hits: duplicates kept, no stop set, one shape rule", () => {
  // The caller owns dedup and the stop set. Two callers with different stop sets
  // share this function, so a std-name filter here would be one language's
  // opinion imposed on the other four.
  assert.deepEqual(backtickedTypeNames("`Widget` then `Widget`"), ["Widget", "Widget"]);
  assert.deepEqual(backtickedTypeNames("`Vec` `Result`"), ["Vec", "Result"], "Rust prelude names are the caller's problem");
  // The ONE shape rule that is not the caller's problem, and it moved here with
  // the widening. A lone capital is a type parameter in all five languages, and
  // splitting now manufactures them: `Map<K, V>` would contribute `K` and `V`,
  // neither of which has a definition to resolve. Repair would drop them at
  // `repairTypes.ts:425`; fn-gen has no shape filter at all, so without this
  // clause four cap slots go to type parameters and the real type never ships.
  assert.deepEqual(backtickedTypeNames("`MAX_LOD` `T`"), ["MAX_LOD"], "a lone capital is a type parameter, not a type");
  assert.deepEqual(backtickedTypeNames("`Map<K, V>`"), ["Map"], "and splitting does not manufacture them either");
  // ALL-CAPS is still the caller's problem, and only one caller solves it. Repair
  // drops `MAX_LOD`, fn-gen does not. That asymmetry pre-dates this phase.
});

test("backtickedTypeNames survives malformed backticks without throwing", () => {
  for (const bad of ["`", "``", "`Widget", "Widget`", "```Widget```", "`a`b`Widget`", "`éType`", "`Wid get`"]) {
    assert.ok(Array.isArray(backtickedTypeNames(bad)), `no throw on ${show(bad)}`);
  }
  // The one that could plausibly regress: an empty pair adjacent to a real hit.
  // It DID regress during the widening, because a span body that must be
  // non-empty makes the scanner pair the second backtick of the empty pair with
  // the opener of the name beside it. Allowing an empty span body is the fix.
  assert.deepEqual(backtickedTypeNames("`` `Widget`"), ["Widget"]);
  // And the CR case, found by the fuzz in test/adversarial-v36-p1.test.cjs: a
  // span must not cross a line ending, or a file with CRLF endings pairs the
  // backtick opening one line with the one opening the next.
  assert.deepEqual(backtickedTypeNames("`Widget`\r\n`Gadget`"), ["Widget", "Gadget"]);
  assert.deepEqual(backtickedTypeNames("x `a\r`Widget`"), ["Widget"], "no span spans the CR");
});

test("the doc leg moves on exactly three of fifteen inputs, and each is a ratified widening", () => {
  // SUPERSEDES "the doc leg is byte-identical to the pre-refactor inline regex",
  // 2026-08-02. Byte-identity was v36's acceptance criterion, whose whole claim
  // was that the refactor changed nothing. session-v37 item 1 changes the rule
  // on purpose, so identity is no longer the bar. The corpus is kept and the
  // question becomes the useful one: WHICH inputs moved.
  //
  // Three of fifteen. That is the number worth having, because the argument
  // against widening was that it drags junk out of committed doc prose, and a
  // corpus this hostile moving three times is evidence about how narrow the
  // change is.
  const MOVED = new Map([
    // A lone capital is now refused. `Upper` and `MAX` are untouched.
    ["`lower` `Upper` `_Under` `9Digit` `MAX` `T`", ["Upper", "MAX"]],
    // The inner type is now recovered, which is the shape the whole item exists
    // for: reading this span as `Wrapper` alone injects nothing once a container
    // name meets the stop set.
    ["`Wrapper<Inner>`", ["Wrapper", "Inner"]],
    // A call names its receiver. A developer writing a constructor by its call
    // path is naming a type, which the goal argued and then recorded as out of
    // scope; the path rule closes it for free.
    ["`Widget::new()`", ["Widget"]],
  ]);
  const legacy = (docComment) => {
    const out = [];
    for (const m of docComment.matchAll(/`([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)`/g)) {
      const seg = m[1].split("::").pop();
      if (seg !== undefined && /^[A-Z]/.test(seg)) {
        out.push(seg);
      }
    }
    return out;
  };
  const CORPUS = [
    "plain prose with no ticks at all",
    "one `Widget`",
    "`Widget` and `Gadget` and `Widget` again",
    "`fastbloom::BloomFilter` plus `std::collections::HashMap`",
    "`lower` `Upper` `_Under` `9Digit` `MAX` `T`",
    "trailing tick `Widget",
    "`",
    "``",
    "`a``b`",
    "line one `Widget`\r\nline two `Gadget`",
    "`Wrapper<Inner>`",
    "`Widget::new()`",
    "code fence:\n```rust\nlet x: Widget = y;\n```\n",
    "`Widget`,`Gadget`",
    "é `ÉType` `Widget`",
  ];
  for (const doc of CORPUS) {
    const want = MOVED.get(doc) ?? legacy(doc);
    assert.deepEqual(backtickedTypeNames(doc), want, `unexpected movement on ${show(doc)}`);
    // And through the real entry point, where the stop set and dedup apply.
    assert.deepEqual(
      typesNamedIn("", doc),
      want.filter((n, i, all) => all.indexOf(n) === i && !PRELUDE_TYPES.has(n)),
      `typesNamedIn disagreement on ${show(doc)}`,
    );
  }
  // Anti-vacuity: both entries in MOVED must actually be in the corpus, or a
  // typo in a key would turn this row into the identity row it replaced.
  for (const key of MOVED.keys()) {
    assert.ok(CORPUS.includes(key), `MOVED names an input the corpus does not carry: ${show(key)}`);
  }
});

// ===========================================================================
// 2. commentTypesIn ON ITS OWN. The blind set reaches this only through
// spanTypesInPlay, whose own filter hides which of the two dropped a name.
// ===========================================================================

const SPANS = {
  rust: "fn f() {\n  // holds a `Widget`\n  let x = 1;\n}",
  csharp: "void F() {\n  // holds a `Widget`\n}",
  typescript: "function f() {\n  // holds a `Widget`\n}",
  go: "func F() {\n\t// holds a `Widget`\n}",
  python: "def f():\n    # holds a `Widget`\n    pass",
};

test("every supported language reads its own line-comment syntax from the table", () => {
  for (const [lang, code] of Object.entries(SPANS)) {
    assert.deepEqual(commentTypesIn(code, lang), ["Widget"], `${lang} line comment`);
  }
});

test("the languages with block comments read those too, and Python's triple quote counts", () => {
  assert.deepEqual(commentTypesIn("fn f() {\n  /* a `Widget` */\n}", "rust"), ["Widget"]);
  assert.deepEqual(commentTypesIn("void F() {\n  /* a `Widget` */\n}", "csharp"), ["Widget"]);
  assert.deepEqual(commentTypesIn("function f() {\n  /* a `Widget` */\n}", "typescript"), ["Widget"]);
  assert.deepEqual(commentTypesIn("func F() {\n\t/* a `Widget` */\n}", "go"), ["Widget"]);
  // Python's own comment table calls `"""` a doc construct, not a string. The
  // gesture is "backtick it in any comment", so a docstring nested in a body is
  // read like every other comment kind.
  assert.deepEqual(commentTypesIn('def f():\n    """a `Widget`"""\n    pass', "python"), ["Widget"]);
});

test("a language with no row in the comment table contributes nothing rather than guessing", () => {
  assert.deepEqual(commentTypesIn("// a `Widget`", "klingon"), []);
  assert.deepEqual(commentTypesIn("// a `Widget`", "json"), []);
});

test("first-seen order, deduped across comments", () => {
  const code = "fn f() {\n  // `Beta` then `Alpha`\n  // `Alpha` again, then `Gamma`\n}";
  assert.deepEqual(commentTypesIn(code, "rust"), ["Beta", "Alpha", "Gamma"]);
});

test("excludeName drops the declared symbol, reduced to its leading identifier", () => {
  const code = "// generate `Summarize` using `Widget`";
  assert.deepEqual(commentTypesIn(code, "csharp", "Summarize"), ["Widget"]);
  // The C# transport hands over Roslyn's documentSymbol name verbatim, chrome
  // and all. An exact-string compare would never match, which is the same trap
  // typesNamedIn documents.
  assert.deepEqual(commentTypesIn(code, "csharp", "Summarize() : int"), ["Widget"], "chrome-carrying symbol name");
  assert.deepEqual(commentTypesIn(code, "csharp", "PickLargest<T>(...) : T?"), ["Summarize", "Widget"], "a different symbol");
});

test("the stop set is the CALLER's language, and absent means no stop set at all", () => {
  const code = "// wants a `Result` and a `Widget`";
  assert.deepEqual(commentTypesIn(code, "rust", undefined, stopNamesFor("rust")), ["Widget"]);
  // `Result` is an ordinary user type in C#. A shared default would hide it,
  // which is the measured .NET regression typesNamedIn's stopNames arg exists for.
  assert.deepEqual(commentTypesIn(code, "csharp", undefined, stopNamesFor("csharp")), ["Result", "Widget"]);
  assert.deepEqual(commentTypesIn(code, "rust"), ["Result", "Widget"], "no stop set passed, none applied");
});

test("string literals are not comments, in the forms whose delimiter is itself a trap", () => {
  const rows = [
    ["rust", 'fn f() {\n  let s = "a `NotAType` here";\n}'],
    ["rust", 'fn f() {\n  let s = r#"a `NotAType` here"#;\n}'],
    ["csharp", 'void F() {\n  var s = @"a `NotAType` here";\n}'],
    ["typescript", "function f() {\n  const s = 'a `NotAType` here';\n}"],
    ["go", 'func F() {\n\ts := "a `NotAType` here"\n}'],
    ["python", "def f():\n    s = 'a `NotAType` here'"],
  ];
  for (const [lang, code] of rows) {
    assert.deepEqual(commentTypesIn(code, lang), [], `${lang}: ${show(code)}`);
  }
});

test("a Rust lifetime is not an unterminated char literal", () => {
  // The quote-set trap this repo has hit before: reading `'a` as a string opener
  // swallows the rest of the line, and the comment after it disappears.
  const code = "fn f<'a>(x: &'a str) {\n  // holds a `Widget`\n}";
  assert.deepEqual(commentTypesIn(code, "rust"), ["Widget"]);
});

test("garbage in, empty list out, never a throw", () => {
  for (const bad of [undefined, null, 0, {}, [], NaN, ""]) {
    assert.deepEqual(commentTypesIn(bad, "rust"), [], `code=${show(bad)}`);
  }
  for (const bad of [undefined, null, 0, {}, []]) {
    assert.deepEqual(commentTypesIn("// a `Widget`", bad), [], `languageId=${show(bad)}`);
  }
});

test("a malformed comment terminates the walk instead of hanging it", () => {
  assert.deepEqual(commentTypesIn("fn f() {\n  /* a `Widget`", "rust"), ["Widget"], "unterminated block");
  assert.deepEqual(commentTypesIn("fn f() { // a `Widget`", "rust"), ["Widget"], "line comment with no newline");
  assert.deepEqual(commentTypesIn("fn f() {}//", "rust"), [], "opener at the very last characters");
  assert.deepEqual(commentTypesIn("fn f() {}/", "rust"), [], "half an opener at the end");
  assert.deepEqual(commentTypesIn("// a `Widget`\r\n// a `Gadget`\r\n", "rust"), ["Widget", "Gadget"], "CRLF");
});

test("the walk is linear in the span, not quadratic in its comment count", () => {
  // This runs inside resolvePrefill and on the repair path, where a span is a
  // whole function and can be large. A quadratic walk would not fail a
  // correctness row, it would just get slower until someone noticed.
  const many = "fn f() {\n" + "  // step with a `Widget`\n".repeat(20000) + "}";
  const started = Date.now();
  const out = commentTypesIn(many, "rust");
  const ms = Date.now() - started;
  assert.deepEqual(out, ["Widget"]);
  assert.ok(ms < 2000, `20000 comments took ${ms}ms`);

  const big = "fn f() {\n  // a `Widget`\n" + "  let x = 1;\n".repeat(80000) + "}";
  const started2 = Date.now();
  assert.deepEqual(commentTypesIn(big, "rust"), ["Widget"]);
  const ms2 = Date.now() - started2;
  assert.ok(ms2 < 2000, `a ${big.length} char span took ${ms2}ms`);
});

// ===========================================================================
// 3. THE REPAIR TIER. The doc is a SEPARATE input from the span text:
// `resolveFunctionAtCursor` normalizes the head, so `code` starts at the
// declaration and the doc comment is trivia above it. These rows use fixtures
// shaped the way the live callers build them.
// ===========================================================================

test("repair order is signature, body code, body comment, doc comment, diagnostic", () => {
  const out = spanTypesInPlay({
    languageId: "rust",
    signature: "fn f(a: &SigType) -> RetType",
    docComment: "returns a `DocType`",
    code: "fn f(a: &SigType) -> RetType {\n  let b: BodyType = x;\n  // needs a `CommentType`\n}",
    diagnosticTypes: ["DiagType"],
  });
  assert.deepEqual(out, ["SigType", "RetType", "BodyType", "CommentType", "DocType", "DiagType"]);
});

test("a name in BOTH the doc and a body comment lands at the higher tier, the comment", () => {
  // Written twice by the developer, so it outranks a name written once. An
  // earlier version subtracted the doc's names from this leg and inverted that,
  // ranking `Shared` below `Local`.
  const out = spanTypesInPlay({
    languageId: "rust",
    signature: "fn f()",
    docComment: "returns a `Shared`",
    code: "fn f() {\n  let b: BodyType = x;\n  // also a `Shared`, plus a `Local`\n}",
  });
  assert.deepEqual(out, ["BodyType", "Shared", "Local"]);
});

test("a doc comment swept INTO the span does not reorder anything else", () => {
  // The state `oracleSurface` logs a span-line range to catch: a language server
  // reports a range that swallows the doc. The doc's names then arrive on the
  // comment tier instead of the doc tier, and since the two are adjacent the
  // sequence is unchanged either way.
  const swept = spanTypesInPlay({
    languageId: "rust",
    signature: "fn f(a: &SigType)",
    docComment: "returns a `DocType`",
    code: "/// returns a `DocType`\nfn f(a: &SigType) {\n  let b: BodyType = x;\n  // needs a `CommentType`\n}",
    diagnosticTypes: ["DiagType"],
  });
  assert.deepEqual(swept, ["SigType", "BodyType", "DocType", "CommentType", "DiagType"]);
});

test("the doc leg still fires when the span text does not carry the doc", () => {
  // Python fork A and any resolver that hands the body alone. The doc names must
  // not vanish just because the filter had nothing to subtract them from.
  const out = spanTypesInPlay({
    languageId: "python",
    signature: "def f() -> RetType",
    docComment: "returns a `DocType`",
    code: "def f() -> RetType:\n    # needs a `CommentType`\n    pass",
  });
  assert.deepEqual(out, ["RetType", "CommentType", "DocType"]);
});

// ===========================================================================
// 4. THE FN-GEN TIER. Five language variants, each with its own stop set and
// its own excludeName handling. The comment leg sits BELOW the doc here and
// ABOVE it in repair, and only these rows state that difference.
// ===========================================================================

const STUB = path.join(__dirname, ".impl-v36-p1-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
module.exports = {
  Position, Range, Selection: Range, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: {}, EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: {},
  workspace: { getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }) },
};
`,
);
const ENTRY = path.join(__dirname, ".impl-v36-p1-v.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v36-p1-v.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { prioritizedTypes, tsPrioritizedTypes, csPrioritizedTypes, pyPrioritizedTypes, goPrioritizedTypes } from "../src/vscode/fnGen";\n`,
);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const FNGEN = require(OUTFILE);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

// One shape per language. The signature names SigType, the doc names DocType,
// the span's body comment names CommentType, and the file imports ImportType.
// Every name appears in exactly one place so a tier cannot be right by accident.
const FNGEN_CASES = [
  {
    lang: "rust",
    fn: FNGEN.prioritizedTypes,
    signature: "fn f(a: &SigType)",
    doc: "builds a `DocType`",
    span: "fn f(a: &SigType) {\n  // needs a `CommentType`\n}",
    fullText: "use crate::store::ImportType;\n",
    expect: ["SigType", "DocType", "CommentType", "ImportType"],
  },
  {
    lang: "typescript",
    fn: FNGEN.tsPrioritizedTypes,
    signature: "function f(a: SigType): void",
    doc: "builds a `DocType`",
    span: "function f(a: SigType): void {\n  // needs a `CommentType`\n}",
    fullText: 'import { ImportType } from "./store";\n',
    expect: ["SigType", "DocType", "CommentType", "ImportType"],
  },
  {
    lang: "csharp",
    fn: FNGEN.csPrioritizedTypes,
    signature: "void F(SigType a)",
    doc: "builds a `DocType`",
    span: "void F(SigType a) {\n  // needs a `CommentType`\n}",
    fullText: "",
    expect: ["SigType", "DocType", "CommentType"],
  },
  {
    lang: "python",
    fn: FNGEN.pyPrioritizedTypes,
    signature: "def f(a: SigType) -> None",
    doc: "builds a `DocType`",
    span: "def f(a: SigType) -> None:\n    # needs a `CommentType`\n    pass",
    fullText: "",
    expect: ["SigType", "DocType", "CommentType"],
  },
  {
    lang: "go",
    fn: FNGEN.goPrioritizedTypes,
    signature: "func F(a *SigType)",
    doc: "builds a `DocType`",
    span: "func F(a *SigType) {\n\t// needs a `CommentType`\n}",
    fullText: "",
    expect: ["SigType", "DocType", "CommentType"],
  },
];

test("fn-gen puts the comment tier under the doc and over the ambient imports, in all five", () => {
  for (const c of FNGEN_CASES) {
    const out = c.fn(c.signature, c.doc, c.fullText, new Set(), undefined, c.span);
    assert.deepEqual(out, c.expect, `${c.lang}: ${show(out)}`);
  }
});

test("a caller that passes no span gets the pre-change list, byte for byte", () => {
  // The seam grew a sixth parameter with an empty default. Every existing caller
  // and every frozen oracle depends on this being a no-op.
  for (const c of FNGEN_CASES) {
    const withSpan = c.fn(c.signature, c.doc, c.fullText, new Set(), undefined, "");
    const withoutArg = c.fn(c.signature, c.doc, c.fullText, new Set(), undefined);
    const expected = c.expect.filter((n) => n !== "CommentType");
    assert.deepEqual(withoutArg, expected, `${c.lang} with the arg omitted`);
    assert.deepEqual(withSpan, expected, `${c.lang} with an empty span`);
  }
});

test("each language's comment leg applies its OWN stop set", () => {
  const span = (open, close) => `${open} wants a \`Result\` and a \`Widget\` ${close}`;
  // Rust refuses `Result`; C# treats it as an ordinary user type, which is the
  // measured .NET house-rules case.
  assert.deepEqual(
    FNGEN.prioritizedTypes("fn f()", undefined, "", new Set(), undefined, "fn f() {\n" + span("//", "") + "\n}"),
    ["Widget"],
    "rust drops Result",
  );
  assert.deepEqual(
    FNGEN.csPrioritizedTypes("void F()", undefined, "", new Set(), undefined, "void F() {\n" + span("//", "") + "\n}"),
    ["Result", "Widget"],
    "csharp keeps Result",
  );
});

test("Go reduces the declared symbol the same way in the comment leg as in the doc leg", () => {
  // gopls names a method symbol `(*Stripe).Summarize`. The doc leg reduces it to
  // the bare member before comparing; a comment leg that compared the raw symbol
  // would feed the target back as its own candidate.
  const span = "func (s *Stripe) Summarize() {\n\t// see `Summarize` and `Widget`\n}";
  const out = FNGEN.goPrioritizedTypes("func (s *Stripe) Summarize()", undefined, "", new Set(), "(*Stripe).Summarize", span);
  assert.deepEqual(out, ["Stripe", "Widget"], `${show(out)}`);
});

test("a name the signature or doc already carries is not repeated by the comment leg", () => {
  const out = FNGEN.prioritizedTypes(
    "fn f(a: &SigType)",
    "builds a `DocType`",
    "",
    new Set(),
    undefined,
    "fn f(a: &SigType) {\n  // needs `SigType`, `DocType` and `CommentType`\n}",
  );
  assert.deepEqual(out, ["SigType", "DocType", "CommentType"]);
});
