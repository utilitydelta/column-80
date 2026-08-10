// IMPLEMENTER test for session-v24 phase 2 - what the blind oracle cannot see
// from outside a rendered payload.
//
// The blind file (test/blind-v24-p2-surface.test.cjs) reads strings and log
// lines. It cannot see the four seams this phase actually turns on, and each of
// them has a failure mode that leaves the blind rows green:
//
//   1. The RULE TABLE, per language and per shape. The blind rows exercise one
//      private and one public member each; the rule has to be right for the
//      shapes no fixture happens to carry (`pub(crate)`, a C# `protected`, a Go
//      caseless rune, a TS `get`ter).
//   2. The POSITION, and that it is the ONLY route to the signal. A name search
//      of the def text answers from call sites and macro arguments as
//      confidently as from declarations, and would pass every blind row.
//   3. The SCOPE BOUNDARY from the inside: the resolver serves the FIM
//      whole-block path too, and a visibility pass that ran unconditionally
//      would change FIM bytes while every phase-2 row stayed green.
//   4. The TWO PASSES as data. The blind rows read the log lines; this reads the
//      arrays behind them, so "the visibility pass took a producer and the role
//      pass got blamed for it" is caught at the seam rather than in prose.
//
// Run: SKIP_LIVE=1 node --test test/impl-v24-p2-surface.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v24-p2-surface",
  `export { visibilityFor } from "../src/core/memberVisibility";
export { membersFromDocumentSymbols, membersWithHoverSignatures, withDeclLine } from "../src/core/extraction";
export { resolveCrossFileShape } from "../src/core/crossFileShape";
export { FIRM_INSTRUCTION, firmInstructionFor, ofTypes, assembleSurfacePayload } from "../src/core/compilerDirected";
export { csShapeGraphBlock } from "../src/core/csExtraction";\n`,
);
test.after(() => cleanup());
const {
  visibilityFor,
  membersFromDocumentSymbols,
  membersWithHoverSignatures,
  withDeclLine,
  resolveCrossFileShape,
  FIRM_INSTRUCTION,
  firmInstructionFor,
  ofTypes,
  assembleSurfacePayload,
  csShapeGraphBlock,
} = mod;

// ===========================================================================
// 1. The rule table. One parameterized run over every language's signal, each
// case naming the shape it stands for and the answer the rule owes it.
// `lines` is the def text; the member's position is its NAME TOKEN on
// `lines[declLine]`, located here so a case cannot drift from its own fixture.
// `at` overrides that column, which is how a position that does NOT land on the
// token gets a row. No `declLine` at all means the member carries no position,
// which is a different claim from "the line says nothing".
// ===========================================================================

// A member as a documentSymbol-derived transport hands it over: the name token's
// line and column, carried off the node (extraction.ts withDeclLine).
function memberOf(c) {
  const m = { name: c.member, kind: c.kind ?? "method" };
  if (c.declLine === undefined) {
    return m;
  }
  m.declLine = c.declLine;
  const character = c.at ?? (c.lines[c.declLine] ?? "").indexOf(c.member);
  m.selectionRange = { start: { line: c.declLine, character } };
  return m;
}

const RULE_CASES = [
  // --- rust: `pub` at the declaration ---------------------------------------
  { lang: "rust", why: "a `pub fn` is callable", member: "roll_active", declLine: 0, lines: ["    pub fn roll_active(&self) -> u64 {"], want: "public" },
  { lang: "rust", why: "a bare `fn` is not", member: "detach", declLine: 0, lines: ["    fn detach(&mut self) {"], want: "non-public" },
  { lang: "rust", why: "`pub(crate)` is visible where the target is", member: "tick", declLine: 0, lines: ["    pub(crate) fn tick(&self) {"], want: "public" },
  { lang: "rust", why: "a macro invocation is not a declaration - no `pub`, and no answer either", member: "tick_count", declLine: 0, lines: ["column80_accessors!(Owner, tick_count, slot_count);"], want: "unknown" },
  { lang: "rust", why: "a member whose line declares a DIFFERENT member says nothing about it", member: "absorb", declLine: 0, lines: ["    fn detach(&mut self) {"], want: "unknown" },
  { lang: "rust", why: "a pub field", member: "slots", kind: "field", declLine: 0, lines: ["    pub slots: u32,"], want: "public" },
  { lang: "rust", why: "a private field", member: "slots", kind: "field", declLine: 0, lines: ["    slots: u32,"], want: "non-public" },
  { lang: "rust", why: "no position is no signal", member: "from_elsewhere", lines: ["    pub fn from_elsewhere(&self) {"], want: "unknown" },
  { lang: "rust", why: "a position past the end of the file is no signal", member: "ghost", declLine: 99, lines: ["    fn ghost(&self) {"], want: "unknown" },

  // --- go: the first rune of the name, no file read -------------------------
  { lang: "go", why: "upper-case first rune is exported", member: "RollActive", lines: [], want: "public" },
  { lang: "go", why: "lower-case is not", member: "detach", lines: [], want: "non-public" },
  { lang: "go", why: "gopls names a method after its receiver; the rule is on the member", member: "(*Owner).Absorb", lines: [], want: "public" },
  { lang: "go", why: "...and the receiver's case never decides it", member: "(*owner).absorb", lines: [], want: "non-public" },
  { lang: "go", why: "a leading underscore is unexported", member: "_scratch", lines: [], want: "non-public" },
  { lang: "go", why: "a caseless rune is not a claim Go's rule makes", member: "中文", lines: [], want: "unknown" },

  // --- typescript: the `#` name, or the modifier at the declaration ---------
  { lang: "typescript", why: "a plain method is public", member: "rollActive", declLine: 0, lines: ["  rollActive(): number {"], want: "public" },
  { lang: "typescript", why: "the `private` keyword", member: "detach", declLine: 0, lines: ["  private detach(): void {"], want: "non-public" },
  { lang: "typescript", why: "`protected` is not callable from outside either", member: "mix", declLine: 0, lines: ["  protected mix(): void {"], want: "non-public" },
  { lang: "typescript", why: "a `#` name needs no position at all - it has no word boundary to anchor on", member: "#hidden", lines: [], want: "non-public" },
  { lang: "typescript", why: "a private STATIC producer", member: "fromRaw", declLine: 0, lines: ["  private static fromRaw(w: Widget): Owner {"], want: "non-public" },
  { lang: "typescript", why: "a field with an initializer", member: "slots", kind: "field", declLine: 0, lines: ["  slots: number = 0;"], want: "public" },
  { lang: "typescript", why: "a getter declares its name too", member: "total", declLine: 0, lines: ["  get total(): number {"], want: "public" },
  { lang: "typescript", why: "a member sharing a line with a private one is read from its OWN declarator", member: "label", declLine: 0, lines: ["export class C { private key = 1; label = 'x'; }"], want: "public" },
  { lang: "typescript", why: "...and the private one on that same line still says private", member: "key", declLine: 0, lines: ["export class C { private key = 1; label = 'x'; }"], want: "non-public" },
  { lang: "typescript", why: "no position is no signal, whatever the line would have said", member: "detach", lines: ["  private detach(): void {"], want: "unknown" },

  // --- typescript: constructor parameter properties -------------------------
  // tsserver hands these over as class properties, so they arrive with
  // positions like any other member - but the declarator before them ends at a
  // COMMA, and the parameter list gives that comma no `;` and no `{` to be
  // found by. A public one after a private one is the whole reason the boundary
  // exists: it is dropped silently, and nothing downstream notices.
  { lang: "typescript", why: "a PUBLIC parameter property after a private one is read from its own declarator", member: "label", kind: "field", declLine: 0, lines: ["  constructor(private slots: number, public label: string) {}"], want: "public" },
  { lang: "typescript", why: "...and the private one before it is still private", member: "slots", kind: "field", declLine: 0, lines: ["  constructor(private slots: number, public label: string) {}"], want: "non-public" },
  { lang: "typescript", why: "the order does not matter: a private one after a public one", member: "label", kind: "field", declLine: 0, lines: ["  constructor(public slots: number, private label: string) {}"], want: "non-public" },
  { lang: "typescript", why: "...and the public one before it", member: "slots", kind: "field", declLine: 0, lines: ["  constructor(public slots: number, private label: string) {}"], want: "public" },
  { lang: "typescript", why: "a lone private parameter property has no comma to be confused by", member: "slots", kind: "field", declLine: 0, lines: ["  constructor(private slots: number) {}"], want: "non-public" },
  { lang: "typescript", why: "a lone public one", member: "slots", kind: "field", declLine: 0, lines: ["  constructor(public slots: number) {}"], want: "public" },
  { lang: "typescript", why: "`readonly` is not an accessibility modifier and does not displace one", member: "label", kind: "field", declLine: 0, lines: ["  constructor(private readonly slots: number, public readonly label: string) {}"], want: "public" },
  { lang: "typescript", why: "`protected` in a parameter list is still not callable from outside", member: "label", kind: "field", declLine: 0, lines: ["  constructor(protected slots: number, protected label: string) {}"], want: "non-public" },
  { lang: "typescript", why: "a comma inside a parameter DEFAULT closes before the next parameter, so the parameter's own comma is still the boundary", member: "label", kind: "field", declLine: 0, lines: ["  constructor(private slots: number = sizeOf(1, 2), public label: string) {}"], want: "public" },
  { lang: "typescript", why: "a comma inside a GENERIC argument likewise", member: "label", kind: "field", declLine: 0, lines: ["  constructor(private slots: Map<string, number>, public label: string) {}"], want: "public" },
  { lang: "typescript", why: "...and that generic parameter itself reads its own modifier", member: "slots", kind: "field", declLine: 0, lines: ["  constructor(private slots: Map<string, number>, public label: string) {}"], want: "non-public" },
  { lang: "typescript", why: "three parameter properties: the middle one is bounded on both sides", member: "label", kind: "field", declLine: 0, lines: ["  constructor(private slots: number, public label: string, private key: number) {}"], want: "public" },
  { lang: "typescript", why: "...and the last of the three reads its own, not the one two declarators back", member: "key", kind: "field", declLine: 0, lines: ["  constructor(public slots: number, public label: string, private key: number) {}"], want: "non-public" },
  // The guard on the C# fallback below, and the reason it is language-neutral
  // rather than a C# branch. `readonly` alone makes a parameter a class member
  // (tsc: `this.b` resolves; a bare `b: string` parameter does not), and it is
  // not an accessibility keyword - so if the fallback fired on "no accessibility
  // keyword here", the enclosing `private constructor` would capture a public
  // property. A declarator that claims ANY modifier keeps the answer.
  { lang: "typescript", why: "a `readonly` parameter property is a public member, and a PRIVATE constructor must not lend it its modifier", member: "tag", kind: "field", declLine: 0, lines: ["  private constructor(readonly tag: string) {}"], want: "public" },
  { lang: "typescript", why: "...and the same after a separating comma, where the fallback would be reachable", member: "tag", kind: "field", declLine: 0, lines: ["  private constructor(private slots: number, readonly tag: string) {}"], want: "public" },
  { lang: "typescript", why: "a private constructor's own parameter property still reads private from its own declarator", member: "slots", kind: "field", declLine: 0, lines: ["  private constructor(private slots: number, readonly tag: string) {}"], want: "non-public" },
  { lang: "typescript", why: "a PUBLIC parameter property of a private constructor is public: the enclosing modifier never reaches it", member: "label", kind: "field", declLine: 0, lines: ["  private constructor(private slots: number, public label: string) {}"], want: "public" },

  // --- csharp: the accessibility modifier, and the container's kind ---------
  { lang: "csharp", why: "an explicit `public`", member: "RollActive", declLine: 0, lines: ["    public long RollActive()"], want: "public" },
  { lang: "csharp", why: "NO modifier on a CLASS member is private", member: "Detach", declLine: 0, lines: ["    void Detach()"], want: "non-public", type: "Owner", signature: "class Owner" },
  { lang: "csharp", why: "NO modifier on a STRUCT member is private too - the default is not class-only", member: "Detach", declLine: 0, lines: ["    void Detach()"], want: "non-public", type: "Owner", signature: "struct Owner" },
  { lang: "csharp", why: "`static` is not an accessibility modifier", member: "FromRaw", declLine: 0, lines: ["    static Owner FromRaw(Widget w)"], want: "non-public", type: "Owner", signature: "class Owner" },
  { lang: "csharp", why: "an explicit `private`", member: "Reattach", declLine: 0, lines: ["    private void Reattach()"], want: "non-public" },
  { lang: "csharp", why: "`internal` is callable from where the target plausibly is", member: "Sync", declLine: 0, lines: ["    internal void Sync()"], want: "public" },
  { lang: "csharp", why: "`protected` likewise - item 9 says the doubtful case keeps", member: "Seed", declLine: 0, lines: ["    protected void Seed()"], want: "public" },
  { lang: "csharp", why: "`protected internal` is not `private` anything", member: "Hook", declLine: 0, lines: ["    protected internal void Hook()"], want: "public" },
  { lang: "csharp", why: "`private protected` is callable from a derived type in the same assembly, and must be tested BEFORE bare `private`", member: "Hook", declLine: 0, lines: ["    private protected void Hook()"], want: "public" },
  { lang: "csharp", why: "NO modifier on an INTERFACE member is PUBLIC - the default is a class rule", member: "RollActive", declLine: 0, lines: ["    long RollActive();"], want: "public", type: "IOwner", signature: "interface IOwner" },
  { lang: "csharp", why: "...and the def text answers it when the hover did not", member: "RollActive", declLine: 1, lines: ["public interface IOwner", "    long RollActive();"], want: "public", type: "IOwner" },
  { lang: "csharp", why: "an ENUM member carries no modifier because the syntax FORBIDS one - the class default must not fire", member: "Idle", kind: "field", declLine: 1, lines: ["public enum Mode", "    Idle,"], want: "public", type: "Mode", signature: "enum Mode" },
  { lang: "csharp", why: "...and the def text answers the enum too, with no hover at all", member: "Idle", kind: "field", declLine: 1, lines: ["public enum Mode", "    Idle,"], want: "public", type: "Mode" },
  { lang: "csharp", why: "an enum member with no position is STILL public - there is no modifier to miss", member: "Idle", kind: "field", lines: [], want: "public", type: "Mode", signature: "enum Mode" },
  { lang: "csharp", why: "a public field keeps", member: "Slots", kind: "field", declLine: 0, lines: ["    public int Slots;"], want: "public" },
  { lang: "csharp", why: "a `_`-named member declared public is PUBLIC - the fact overrules the convention", member: "_RollActive", declLine: 0, lines: ["    public long _RollActive()"], want: "public" },
  { lang: "csharp", why: "...and a `_`-named private one goes for its MODIFIER", member: "_scratch", declLine: 0, lines: ["    private int _scratch()"], want: "non-public" },
  { lang: "csharp", why: "a dotted, namespace-qualified field type is not a parsing problem", member: "_timer", kind: "field", declLine: 0, lines: ["    private System.Timers.Timer _timer;"], want: "non-public" },
  { lang: "csharp", why: "the SECOND declarator of a multi-declarator line, whose name is nowhere near the modifier", member: "_b", kind: "field", declLine: 0, lines: ["    private int _a, _b;"], want: "non-public" },
  { lang: "csharp", why: "a generic whose argument list carries a comma", member: "_map", kind: "field", declLine: 0, lines: ["    private Dictionary<string, int> _map;"], want: "non-public" },
  // The comma C# reads the other way. One modifier covers every declarator on
  // the line, so a boundary at these commas would leave `_c` with no modifier
  // and the class default would drop it. What separates them from a TypeScript
  // parameter list is that no paren is open where the name sits.
  { lang: "csharp", why: "the THIRD declarator is as far from the modifier as the line gets", member: "_c", kind: "field", declLine: 0, lines: ["    private int _a, _b, _c;"], want: "non-public" },
  { lang: "csharp", why: "a multi-declarator line whose modifier is public keeps every declarator", member: "B", kind: "field", declLine: 0, lines: ["    public int A, B;"], want: "public" },
  { lang: "csharp", why: "a TUPLE type's comma sits in a paren that CLOSED before the name, so it is nobody's boundary", member: "Size", kind: "field", declLine: 0, lines: ["    public (int, int) Size;"], want: "public" },
  { lang: "csharp", why: "...and the private one of the same shape still reads private", member: "_size", kind: "field", declLine: 0, lines: ["    private (int, int) _size;"], want: "non-public" },
  { lang: "csharp", why: "a tuple nested inside a generic argument", member: "Map", kind: "field", declLine: 0, lines: ["    public Dictionary<string, (int, int)> Map;"], want: "public" },
  { lang: "csharp", why: "a tuple RETURN type on a method", member: "Split", declLine: 0, lines: ["    public (int, int) Split()"], want: "public" },
  { lang: "csharp", why: "an attribute argument list is a closed paren too", member: "Count", kind: "field", declLine: 0, lines: ["    [Trace(1, 2)] public int Count;"], want: "public" },
  { lang: "csharp", why: "a PUBLIC member sharing a line with a private one is read from its own declarator", member: "B", kind: "field", declLine: 0, lines: ["public class Cache { private int _a; public int B; }"], want: "public" },
  { lang: "csharp", why: "...and the private one on that line is still private", member: "_a", kind: "field", declLine: 0, lines: ["public class Cache { private int _a; public int B; }"], want: "non-public" },

  // --- csharp: positional records, where the accessibility is on the TYPE ----
  // C# forbids an accessibility modifier on a record parameter, so every
  // positional property's declarator claims nothing and the class default would
  // drop all of them. The one modifier on the line is the record's own, before
  // the `(` - which is exactly the prefix a declarator inside an OPEN paren
  // group falls back to. The declarator-claims-its-own half of that rule is
  // proven by the TypeScript parameter-property rows above; it has no legal C#
  // shape to be proven with.
  { lang: "csharp", why: "the FIRST positional property of a public record", member: "Amount", kind: "field", declLine: 0, lines: ["public sealed record Money(decimal Amount, string Currency);"], want: "public" },
  { lang: "csharp", why: "...and the SECOND, whose declarator sits after the separating comma and says nothing at all", member: "Currency", kind: "field", declLine: 0, lines: ["public sealed record Money(decimal Amount, string Currency);"], want: "public" },
  { lang: "csharp", why: "a third positional property is no further from the type's modifier than the second", member: "Rate", kind: "field", declLine: 0, lines: ["public record Money(decimal Amount, string Currency, double Rate);"], want: "public" },
  { lang: "csharp", why: "a positional property whose type carries a comma of its own", member: "Currency", kind: "field", declLine: 0, lines: ["public record Money(Dictionary<string, int> Parts, string Currency);"], want: "public" },
  { lang: "csharp", why: "...and the generic one before it", member: "Parts", kind: "field", declLine: 0, lines: ["public record Money(Dictionary<string, int> Parts, string Currency);"], want: "public" },
  { lang: "csharp", why: "a `record struct` is the same shape", member: "Y", kind: "field", declLine: 0, lines: ["public readonly record struct Point(int X, int Y);"], want: "public" },
  { lang: "csharp", why: "an attribute on the parameter closes its paren before the name, so it is not the group the name is in", member: "Amount", kind: "field", declLine: 0, lines: ["public record Money([property: Range(0, 99)] decimal Amount);"], want: "public" },
  { lang: "csharp", why: "`internal` on the record keeps its properties - internal is callable from where the target plausibly is", member: "Currency", kind: "field", declLine: 0, lines: ["internal record Money(decimal Amount, string Currency);"], want: "public" },
  { lang: "csharp", why: "a nested record declared after a `{` reads the record's modifier, not the outer type's", member: "Amount", kind: "field", declLine: 0, lines: ["public class Wallet { public record Money(decimal Amount); }"], want: "public" },
  { lang: "csharp", why: "a member in the record's BODY is its own declarator: the record's `public` never reaches it, because the paren closed first", member: "_tag", kind: "field", declLine: 0, lines: ["public record Money(decimal Amount) { private int _tag; }"], want: "non-public" },
  { lang: "csharp", why: "...and a public body member of the same record keeps", member: "Currency", kind: "field", declLine: 0, lines: ["public record Money(decimal Amount) { public string Currency; }"], want: "public" },
  // KNOWN MISSES, pinned rather than claimed as correct. Both properties below
  // are public C#; the rule answers non-public and drops them.
  //   1. The fallback reaches the prefix before the `(` and no further, so a
  //      record broken across lines leaves the parameter line with no modifier
  //      anywhere on it. Every rule here is single-line by construction.
  //   2. A record's positional properties are public whatever the record's own
  //      accessibility is, so inheriting `private` from the type is wrong. It is
  //      not new: before the declarator boundary existed the prefix ran to the
  //      line start and read the same `private`.
  { lang: "csharp", why: "KNOWN MISS: a record split across lines has no modifier on the parameter's line, and the rule never leaves it", member: "Currency", kind: "field", declLine: 2, lines: ["public sealed record Money(", "    decimal Amount,", "    string Currency);"], want: "non-public" },
  { lang: "csharp", why: "KNOWN MISS: a private record's positional properties are public C#, but the type's modifier is the only one on the line", member: "Amount", kind: "field", declLine: 0, lines: ["private record Money(decimal Amount, string Currency);"], want: "non-public" },
];

test("the visibility rule answers each language's own signal, and answers `unknown` rather than guessing", () => {
  for (const c of RULE_CASES) {
    const lang = visibilityFor(c.lang);
    assert.ok(lang, `${c.lang} must have a rule`);
    const got = lang.rule(memberOf(c), {
      lines: c.lines,
      typeName: c.type ?? "Owner",
      typeSignature: c.signature,
    });
    assert.strictEqual(got, c.want, `[${c.lang}] ${c.why}: ${JSON.stringify(c.member)} on ${JSON.stringify(c.lines[c.declLine ?? 0])}`);
  }
});

test("python has NO rule at all, so its surface cannot change by accident", () => {
  assert.strictEqual(visibilityFor("python"), undefined, "a rule for python would reverse a standing human decision");
  assert.strictEqual(visibilityFor("ruby"), undefined, "a language with no entry filters nothing");
});

test("the signal is read from the POSITION only - a name elsewhere in the file never answers for it", () => {
  const rust = visibilityFor("rust").rule;
  // The member IS declared `pub` in this file, three lines below where its
  // position points. A name search finds the declaration and says public; the
  // position says the line it was actually given, which declares nothing.
  const lines = ["mod inner {", "    // detach is fine", "}", "    pub fn detach(&self) {"];
  assert.strictEqual(
    rust({ name: "detach", kind: "method", declLine: 1 }, { lines, typeName: "Owner" }),
    "unknown",
    "a comment mentioning the member is not its declaration",
  );
  assert.strictEqual(
    rust({ name: "detach", kind: "method", declLine: 3 }, { lines, typeName: "Owner" }),
    "public",
    "...and the real declaration line still answers",
  );
});

// The C#/TS half of the same claim, and the one the old name search got wrong in
// BOTH directions. The column is an assertion about a position the server gave,
// never a search for the name on the line: a position landing off the token
// answers `unknown` rather than reading whatever modifiers happen to precede it.
test("a C#/TypeScript position that does not land on the member's own name token answers `unknown`", () => {
  const cs = visibilityFor("csharp").rule;
  const lines = ["    private int cache;", "    public void Detach()", "        this.Detach();"];
  assert.strictEqual(
    cs({ name: "Detach", kind: "method", declLine: 1, selectionRange: { start: { line: 1, character: 16 } } }, { lines, typeName: "Owner" }),
    "public",
    "the column the server gave lands on the name",
  );
  assert.strictEqual(
    cs({ name: "Detach", kind: "method", declLine: 1, selectionRange: { start: { line: 1, character: 4 } } }, { lines, typeName: "Owner" }),
    "unknown",
    "a column landing on `public` is not this member's name, so there is nothing to read",
  );
  assert.strictEqual(
    cs({ name: "Detach", kind: "method", declLine: 2, selectionRange: { start: { line: 2, character: 13 } } }, { lines, typeName: "Owner" }),
    "non-public",
    "a call site DOES parse as a declarator with no modifier, so the class default fires - keep-direction is not available here, and this is why the column must come from the server rather than a search",
  );
  assert.strictEqual(
    cs({ name: "Detach", kind: "method", declLine: 1 }, { lines, typeName: "Owner" }),
    "unknown",
    "a member carrying a LINE but no column cannot say whose declarator it is",
  );
});

// ===========================================================================
// 1b. THE EXEMPT SCOPE, which is the half no modifier can answer. The blind
// oracle proves the four languages disagree; this proves WHERE each draws the
// line, including the two edges no fixture reaches - a Go type in the same
// package but a different FILE (exempt), and a C# type of the same name in
// another file (still the target's own type by name, which is the accepted
// cost of not resolving partial classes).
// ===========================================================================

const SCOPE_CASES = [
  { lang: "rust", why: "the target's own file is its module, by proxy", type: { name: "Owner", defUri: "file:///w/a/owner.rs" }, target: { uri: "file:///w/a/owner.rs", enclosingType: "Owner" }, want: true },
  { lang: "rust", why: "a SIBLING type in that same file is in the same module", type: { name: "Sibling", defUri: "file:///w/a/owner.rs" }, target: { uri: "file:///w/a/owner.rs", enclosingType: "Owner" }, want: true },
  { lang: "rust", why: "another file is another module, even in the same directory - the proxy is wrong here and knowingly so", type: { name: "Neighbour", defUri: "file:///w/a/other.rs" }, target: { uri: "file:///w/a/owner.rs", enclosingType: "Owner" }, want: false },
  { lang: "rust", why: "a vendored crate is the capture", type: { name: "Remote", defUri: "file:///w/vendor/lru.rs" }, target: { uri: "file:///w/a/owner.rs", enclosingType: "Owner" }, want: false },
  { lang: "rust", why: "a free function still has a module", type: { name: "Owner", defUri: "file:///w/a/owner.rs" }, target: { uri: "file:///w/a/owner.rs" }, want: true },

  { lang: "go", why: "a Go package IS a directory, so a DIFFERENT FILE beside the target is the same package", type: { name: "Neighbour", defUri: "file:///w/store/neighbour.go" }, target: { uri: "file:///w/store/owner.go", enclosingType: "Owner" }, want: true },
  { lang: "go", why: "the target's own file, trivially", type: { name: "Owner", defUri: "file:///w/store/owner.go" }, target: { uri: "file:///w/store/owner.go", enclosingType: "Owner" }, want: true },
  { lang: "go", why: "another directory is another package", type: { name: "Remote", defUri: "file:///w/store/vendor/remote.go" }, target: { uri: "file:///w/store/owner.go", enclosingType: "Owner" }, want: false },

  { lang: "csharp", why: "`private` is TYPE-scoped: the target's own enclosing type", type: { name: "Owner", defUri: "file:///w/Owner.cs" }, target: { uri: "file:///w/Owner.cs", enclosingType: "Owner" }, want: true },
  { lang: "csharp", why: "...and a DIFFERENT class in the same file is not exempt, which is where the cheap same-file shortcut breaks", type: { name: "Sibling", defUri: "file:///w/Owner.cs" }, target: { uri: "file:///w/Owner.cs", enclosingType: "Owner" }, want: false },
  { lang: "csharp", why: "a partial class split across files is still the target's own type - by NAME, which is the accepted cost", type: { name: "Owner", defUri: "file:///w/Owner.Part2.cs" }, target: { uri: "file:///w/Owner.cs", enclosingType: "Owner" }, want: true },
  { lang: "csharp", why: "a construction target OUTSIDE the type it builds is inside nothing of it - 7a working, not an exception to it", type: { name: "Owner", defUri: "file:///w/Owner.cs" }, target: { uri: "file:///w/Factory.cs", enclosingType: "OwnerFactory" }, want: false },
  { lang: "csharp", why: "a target with no enclosing type exempts nothing", type: { name: "Owner", defUri: "file:///w/Owner.cs" }, target: { uri: "file:///w/Owner.cs" }, want: false },

  { lang: "typescript", why: "the target's own class", type: { name: "Owner", defUri: "file:///w/owner.ts" }, target: { uri: "file:///w/owner.ts", enclosingType: "Owner" }, want: true },
  { lang: "typescript", why: "a sibling class in the same module file is still a different type", type: { name: "Sibling", defUri: "file:///w/owner.ts" }, target: { uri: "file:///w/owner.ts", enclosingType: "Owner" }, want: false },
];

test("the exempt scope is the LANGUAGE's, not the file's: module, package and type draw three different lines", () => {
  for (const c of SCOPE_CASES) {
    const lang = visibilityFor(c.lang);
    assert.strictEqual(
      lang.exempt(c.type, c.target),
      c.want,
      `[${c.lang}] ${c.why}: \`${c.type.name}\` from ${c.type.defUri}, target in ${c.target.uri} inside ${c.target.enclosingType ?? "nothing"}`,
    );
  }
});

// ===========================================================================
// 2. Threading the position out. The member-building step used to keep name,
// kind and signature and drop the node; the node is where the position lives.
// ===========================================================================

const SK_CLASS = 4;
const SK_METHOD = 5;
const role = (kind) => (kind === SK_CLASS ? "container" : "method");
const at = (line, ch, endCh) => ({ start: { line, character: ch }, end: { line, character: endCh } });

test("membersFromDocumentSymbols carries each member's declaration line off the symbol node", () => {
  const tree = [
    {
      name: "Owner",
      kind: SK_CLASS,
      range: at(0, 0, 40),
      selectionRange: at(0, 6, 11),
      children: [
        { name: "roll_active", kind: SK_METHOD, detail: "fn(&self) -> u64", range: at(4, 0, 6), selectionRange: at(4, 11, 22) },
        // No selectionRange: the node's own range start is the fallback, which is
        // still the declaration's line - what the rule reads.
        { name: "detach", kind: SK_METHOD, detail: "fn(&mut self)", range: at(9, 4, 20) },
        // Neither: nothing to carry, and the member must say so rather than
        // default to line 0, which would read a stranger's declaration.
        { name: "ghost", kind: SK_METHOD, detail: "fn(&self)" },
      ],
    },
  ];
  const members = membersFromDocumentSymbols(tree, { uri: "file:///w/o.rs", line: 0, character: 8 }, role);
  const byName = new Map(members.map((m) => [m.name, m]));
  assert.strictEqual(byName.get("roll_active").declLine, 4, "the selection range's line");
  assert.strictEqual(byName.get("detach").declLine, 9, "the node range's line, when there is no selection");
  assert.strictEqual(byName.get("ghost").declLine, undefined, "no position on the node is no position on the member");
  assert.strictEqual(byName.get("roll_active").signature, "roll_active(&self) -> u64", "the rendered signature is untouched");
});

// The COLUMN, and the one case where carrying it would be a silent drop. A node
// with a selectionRange points at the NAME; a node with only a range points at
// the head of the declaration, so a modifier prefix sliced from THERE is empty
// and a `private int x` reads as unmodified - a member the target can't call
// presented as if it could, or a public one dropped, depending on the language's
// default. Line without column is the honest half-answer.
test("the name token's COLUMN rides only the selectionRange - a range-only node carries the line and no column", () => {
  const tree = [
    {
      name: "Cache",
      kind: SK_CLASS,
      range: at(0, 0, 40),
      selectionRange: at(0, 13, 18),
      children: [
        { name: "_a", kind: SK_METHOD, range: at(2, 4, 24), selectionRange: at(2, 16, 18) },
        { name: "_b", kind: SK_METHOD, range: at(3, 4, 24) },
        { name: "ghost", kind: SK_METHOD },
      ],
    },
  ];
  const byName = new Map(
    membersFromDocumentSymbols(tree, { uri: "file:///w/c.cs", line: 0, character: 14 }, role).map((m) => [m.name, m]),
  );
  assert.deepStrictEqual(byName.get("_a").selectionRange, { start: { line: 2, character: 16 } }, "the name token, verbatim");
  assert.strictEqual(byName.get("_b").selectionRange, undefined, "a range-only node knows the line and not the name's column");
  assert.strictEqual(byName.get("_b").declLine, 3, "...and the line still rides, for the rules that read one");
  assert.strictEqual(byName.get("ghost").selectionRange, undefined, "no position at all is no position");
  // Asserted at the seam rather than only through the descent, because the
  // descent is one of two routes into it.
  const bare = withDeclLine({ name: "_c", kind: "field" }, { range: at(7, 4, 20) });
  assert.strictEqual(bare.declLine, 7);
  assert.strictEqual(bare.selectionRange, undefined, "the range fallback never invents a column");
});

// The OTHER member-building route, and the one that decides whether this fix is
// real or only true of fixtures: the editor-side TypeScript and Python
// transports build through the hover-backfill path, not the plain descent. If
// that route dropped the position, TypeScript's `private`-keyword residual would
// stay open in the product while every blind row went green on fixture members
// that carry one.
test("the hover-backfill route carries the declaration line too - the editor-side TS/Python transports build through it", async () => {
  const tree = [
    {
      name: "Owner",
      kind: SK_CLASS,
      range: at(0, 0, 40),
      selectionRange: at(0, 13, 18),
      children: [
        { name: "rollActive", kind: SK_METHOD, range: at(1, 2, 30), selectionRange: at(1, 2, 12) },
        { name: "detach", kind: SK_METHOD, range: at(5, 2, 30), selectionRange: at(5, 10, 16) },
      ],
    },
  ];
  const members = await membersWithHoverSignatures(
    tree,
    { uri: "file:///w/o.ts", line: 0, character: 14 },
    role,
    (label, detail, kind) => ({ name: label, kind, ...(detail === undefined ? {} : { signature: detail }) }),
    async (cur) => `sig@${cur.line}`,
  );
  assert.deepStrictEqual(
    members.map((m) => [m.name, m.declLine, m.selectionRange.start.character]),
    [["rollActive", 1, 2], ["detach", 5, 10]],
    "each member knows the line AND the column it was declared at",
  );
});

// ===========================================================================
// 3. + 4. The resolver seam: the pass is opt-in, and the two passes stay two.
// ===========================================================================

const CTOR_URI = "file:///w/ctor.rs";
const CTOR_SRC = `pub struct Owner {
    slots: u32,
}

impl Owner {
    pub fn with_slots(w: Widget, n: u32) -> Owner {
        todo!()
    }

    fn from_raw(w: Widget) -> Owner {
        todo!()
    }

    pub fn roll_active(&self) -> u64 {
        0
    }
}
`;
const lineOf = (needle) => CTOR_SRC.slice(0, CTOR_SRC.indexOf(needle)).split("\n").length - 1;

const CTOR_MEMBERS = [
  { name: "with_slots", kind: "method", signature: "with_slots(w: Widget, n: u32) -> Owner", declLine: lineOf("pub fn with_slots") },
  { name: "from_raw", kind: "method", signature: "from_raw(w: Widget) -> Owner", declLine: lineOf("fn from_raw") },
  { name: "roll_active", kind: "method", signature: "roll_active(&self) -> u64", declLine: lineOf("pub fn roll_active") },
  // A producer the signal cannot reach: no position, so no answer.
  { name: "from_elsewhere", kind: "method", signature: "from_elsewhere(w: Widget) -> Owner" },
];

const ctorExtractor = () => ({
  definition: async () => ({ uri: CTOR_URI, range: { startLine: 0, startCharacter: 11, endLine: 0, endCharacter: 16 } }),
  hoverSurface: async () => ({ signature: "pub struct Owner { slots: u32 }" }),
  membersOfType: async () => CTOR_MEMBERS.map((m) => ({ ...m })),
  completeMembers: async () => [],
  example: async () => undefined,
  qualifyImport: async () => undefined,
});
const openCtor = async () => CTOR_SRC;
const ROOT = { uri: CTOR_URI, line: 0, character: 11 };
const BOUND = { D_MAX: 1, N_MAX: 4 };
// The target lives in another file, so Rust's module proxy puts it OUTSIDE
// `Owner`'s scope and the filter runs. `OUTSIDE`/`INSIDE` name the only thing
// that differs between them.
const OUTSIDE = { ...mod.visibilityFor("rust"), target: { uri: "file:///w/other.rs" } };
const INSIDE = { ...mod.visibilityFor("rust"), target: { uri: CTOR_URI } };

test("the visibility pass is OPT-IN: with no rule the resolver is unchanged and reports no `hidden`", async () => {
  const shape = await resolveCrossFileShape(ctorExtractor(), ROOT, BOUND, openCtor);
  assert.strictEqual(shape.hidden, undefined, "no rule means the pass never ran - this is what keeps the FIM whole-block path byte-identical");
  const methods = shape.types.get("Owner").methods;
  assert.deepStrictEqual(
    methods,
    CTOR_MEMBERS.map((m) => m.signature),
    "every member the extractor handed over still renders",
  );
});

test("the two passes are independent: visibility never explains a role drop, and role never explains a visibility drop", async () => {
  const shape = await resolveCrossFileShape(
    ctorExtractor(),
    ROOT,
    BOUND,
    openCtor,
    undefined,
    "Owner",
    "arrow",
    OUTSIDE,
  );
  const hidden = (shape.hidden ?? []).map((h) => h.member.name);
  const narrowed = (shape.narrowed ?? []).map((m) => m.name);
  assert.deepStrictEqual(hidden, ["from_raw"], "the readably-private producer left for VISIBILITY");
  assert.deepStrictEqual(narrowed, ["roll_active"], "the public instance method left for its ROLE");
  assert.ok(!narrowed.includes("from_raw"), "a visibility drop must never be reported as a narrowing");
  assert.ok(!hidden.includes("roll_active"), "a role drop must never be reported as non-public");
  const methods = shape.types.get("Owner").methods;
  assert.ok(
    methods.includes("from_elsewhere(w: Widget) -> Owner"),
    "the producer with no readable signal survives BOTH passes - dropping it is item 9's failure through the other door",
  );
  assert.ok(methods.includes("with_slots(w: Widget, n: u32) -> Owner"), "and the readably-public producer is offered");
});

// The rule reads the def text for the declaration line, so a file that cannot be
// opened must degrade to an empty shape and an empty hidden list - never to a
// shape whose members were dropped because their declarations were unreadable.
// `hidden` being present-and-empty rather than absent is the seam's own claim:
// the pass ran and took nothing.
test("no def text is no signal, and no signal keeps: an unreadable def file costs nothing but the filter", async () => {
  const shape = await resolveCrossFileShape(
    ctorExtractor(),
    ROOT,
    BOUND,
    async () => undefined,
    undefined,
    undefined,
    undefined,
    OUTSIDE,
  );
  // With no def text the walk cannot enumerate members at all, so the honest
  // outcome is a hover-only shape - never a shape whose members were dropped
  // because their declarations could not be read.
  assert.deepStrictEqual(shape.hidden, [], "nothing was hidden, because nothing could be read");
});

// The exemption is not a per-member answer, it is a decision not to ask. A rule
// that ran anyway and then un-dropped what it took would report the member as
// hidden, and the drop line would tell the human a member left a surface it is
// still in.
test("a type whose scope the target is INSIDE is never asked: the pass does not run, so nothing is reported hidden", async () => {
  const shape = await resolveCrossFileShape(ctorExtractor(), ROOT, BOUND, openCtor, undefined, "Owner", "arrow", INSIDE);
  assert.deepStrictEqual(shape.hidden, [], "the target is in `Owner`'s own module, so `from_raw` is callable from it");
  const methods = shape.types.get("Owner").methods;
  assert.ok(methods.includes("from_raw(w: Widget) -> Owner"), "the private producer of the type being built survives");
  assert.deepStrictEqual(
    (shape.narrowed ?? []).map((m) => m.name),
    ["roll_active"],
    "and the ROLE pass is still narrowing in the same run, so this is not a 'nothing filters' tautology",
  );
});

// ===========================================================================
// 5. The instruction, as a function of what rendered.
// ===========================================================================

const FROZEN = "Call ONLY methods and constructors";

test("the instruction names every type that rendered, and keeps the frozen phrase exactly once", () => {
  const cases = [
    { types: ["Owner"], names: ["`Owner`"] },
    { types: ["Alpha", "Beta"], names: ["`Alpha` and `Beta`"] },
    { types: ["A", "B", "C"], names: ["`A`, `B` and `C`"] },
  ];
  for (const c of cases) {
    const out = firmInstructionFor(c.types);
    assert.strictEqual(out.split(FROZEN).length - 1, 1, `the frozen phrase survives once: ${out}`);
    for (const n of c.names) {
      assert.ok(out.includes(n), `${JSON.stringify(out)} must name ${n}`);
    }
    assert.ok(out.endsWith(FIRM_INSTRUCTION), "the type-independent half stays the suffix");
  }
});

test("an empty scope still constrains the surface, and names nothing it cannot point at", () => {
  const out = firmInstructionFor([]);
  assert.ok(out.startsWith(`${FROZEN} that appear in the API surface above.`), `no type names, no dangling \`of\`: ${out}`);
  assert.ok(out.endsWith(FIRM_INSTRUCTION));
  assert.strictEqual(ofTypes([], "tail"), "tail", "the scoping clause disappears entirely rather than rendering empty backticks");
});

test("the assembled payload carries the instruction scoped to its own block", () => {
  const out = assembleSurfacePayload({ typeOrCrate: "LruCache", signatures: "get(&self, k: &K) -> Option<&V>" });
  assert.ok(out.includes("Call ONLY methods and constructors of `LruCache`"), out);
  assert.ok(out.endsWith(FIRM_INSTRUCTION), "the invariant half closes the payload");
  assert.strictEqual(assembleSurfacePayload({ typeOrCrate: "LruCache" }), "", "no surface, no instruction");
});

// ===========================================================================
// 6. The retired stand-in. `_`-prefix was a NAMING CONVENTION filling in for the
// accessibility modifier; the modifier is readable upstream now, so the
// convention stops overruling it. Two filters answering one question hide real
// API between them, and the renderer is the wrong place to answer it: it is
// handed rendered strings, where the fact was already thrown away.
// ===========================================================================

// The instruction's scope is every block in the payload, and for C# ONE
// candidate can put headers on several types. The renderer is the only place
// that knows which: the dedup and the budget both decide it here, and the
// alternative - reading the names back out of the string just rendered - is the
// re-derivation this phase exists to stop.
test("the C# graph render reports the types it actually emitted, and only those", () => {
  const graph = [
    { name: "Owner", methods: ["Absorb(Widget) : int"] },
    { name: "Ledger", methods: ["Post(int) : void"] },
    { name: "Empty", methods: [] },
  ];
  const emitted = [];
  const visited = new Set();
  const out = csShapeGraphBlock(graph, {
    memberCap: 32, fence: "```", visited, budget: { remaining: 100000 }, onEmit: (n) => emitted.push(n),
  });
  assert.deepStrictEqual(emitted, ["Owner", "Ledger"], "a method-less type renders no block, so it is in no scope");
  assert.ok(out.includes("Members of `Ledger`"), "...and the one that did render is in the payload");

  // Already emitted under another candidate: no second block, so no second
  // mention. An instruction naming it twice would be harmless; naming a type
  // whose block the BUDGET dropped points the model at a surface it cannot see.
  const again = [];
  csShapeGraphBlock(graph, { memberCap: 32, fence: "```", visited, budget: { remaining: 100000 }, onEmit: (n) => again.push(n) });
  assert.deepStrictEqual(again, [], "the shared visited set already emitted both");

  const squeezed = [];
  csShapeGraphBlock(graph, {
    memberCap: 32, fence: "```", visited: new Set(), budget: { remaining: 140 }, onEmit: (n) => squeezed.push(n),
  });
  assert.deepStrictEqual(squeezed, ["Owner"], "the budget dropped `Ledger`'s block, so the scope must not claim it");
});

test("the C# graph render no longer second-guesses a member by its name", () => {
  const out = csShapeGraphBlock(
    [{ name: "Owner", methods: ["_RollActive() : long", "Tick() : void"] }],
    { memberCap: 32, fence: "```", visited: new Set(), budget: { remaining: 100000 } },
  );
  assert.ok(out.includes("_RollActive() : long"), "a public member named with a leading underscore is still public");
  assert.ok(out.includes("Tick() : void"), "and the plainly-named one is untouched");
});
