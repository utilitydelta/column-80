/**
 * The span's types-in-play, for a repair round.
 *
 * The defect this closes (session-v28 goal item 1, two live captures): the
 * repair surface followed the DIAGNOSTIC's one named type per round, so a span
 * whose fix needs two types never saw both, and a diagnostic class the
 * classifier did not know injected nothing at all. Disclosure follows the
 * question, not the diagnostic: what the model is asked to repair is the SPAN,
 * so the span is what names the types.
 *
 * Pure, offline, never throws. The per-language signature legs are the ones the
 * FIM whole-block detector already uses (fimWholeBlock.ts); what is new here is
 * the BODY scan, which is what the captures needed - `LodBand` appears only in
 * the failing body, never in the signature.
 */

import { CS_STD_TYPE_NAMES, csUsingNamespaces } from "./csExtraction";
import { commentTypesIn } from "./commentTypes";
import { PRELUDE_TYPES, typesNamedIn } from "./compilerDirected";
import { PY_STD_TYPE_NAMES, STD_TYPE_NAMES } from "./crossFileShape";
import { maskNonCode } from "./fimInject";
import {
  csTypesInPlay,
  goTypesInPlay,
  pyTypesInPlay,
  tsTypesInPlay,
  typesInPlay,
} from "./fimWholeBlock";
import { GO_STD_TYPE_NAMES, goImportedPackageNames } from "./goExtraction";
import { TS_LANGUAGE_IDS, TS_STD_TYPE_NAMES } from "./tsExtraction";

export interface SpanTypesInput {
  languageId: string;
  /** The failing target's signature, when the resolver produced one. */
  signature?: string;
  docComment?: string;
  /** The failing span's text as it sits in the document, signature included. */
  code: string;
  /** Type names this round's diagnostics named (a CS0019 operand pair, a CS1061
   *  receiver). Last in the order: the compiler named them, but the span is the
   *  question. */
  diagnosticTypes?: readonly string[];
}

// The static entry points a body reaches through by name. They are not the
// std CONTAINER names the extraction sets carry (those are parameter and field
// types), they are the qualifiers a body writes - `Console.WriteLine`,
// `Math.Max`, `Enumerable.Range` - and the qualifier leg below would otherwise
// take every one of them as a type to resolve. Kept local to this module: the
// extraction sets answer a different question and other legs read them.
export const STATIC_ENTRY_POINTS = new Set([
  "Console", "Math", "Convert", "Enumerable", "File", "Directory", "Path",
  "Environment", "Debug", "Trace", "Regex", "Encoding", "Thread", "Interlocked",
  "Activator", "Guid", "DateTime", "TimeSpan", "Task", "JSON", "Object",
  "Number", "Promise", "Array", "String", "Boolean", "Symbol", "Reflect",
  "System",
]);

// Rust's prelude VALUES. They are PascalCase, they sit in exactly the positions
// the body scan reads (`field: None`, `-> Self`, `Ok(x)`), and none of them is a
// type worth resolving. Measured: they were 21 of the Rust scan's 30 junk slots.
const PRELUDE_VALUES = new Set(["Some", "None", "Ok", "Err", "Self"]);

/** Every character is a capital, a digit or an underscore: `T`, `U1`, `UUID`,
 *  `MAX_LOD`. REPAIR's net, and it is deliberately the wide one.
 *
 *  Repair reads a FAILING BODY, where a shouted name is overwhelmingly a
 *  constant or a type parameter, and a candidate that resolves nothing costs a
 *  round trip inside a latency budget the developer is watching. Being wrong
 *  about `U1` there is cheap.
 *
 *  Named and exported so the other write path can see the rule rather than
 *  re-derive it. session-v36 froze "an ALL-CAPS name is a constant, not a type"
 *  as a claim about NAMES, which binds both paths; repair honoured it and fn-gen
 *  did not for a whole session (session-v37 scraps S37-2), because the rule lived
 *  inside one function's filter loop where nothing else could reach it. */
export function isShoutedName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

/** SCREAMING_SNAKE_CASE: capitals with at least one underscore separating them.
 *  `MAX_LOD`, `TTL_SECS`, `GENESIS_HASH`. FN-GEN's net, and it is narrower than
 *  `isShoutedName` on purpose.
 *
 *  The two paths differ because their costs differ, and the difference is written
 *  here rather than left to drift. fn-gen mines a signature and a doc comment,
 *  where a shouted name may well be a real type: `test/blind-v7-prepare.test.cjs`
 *  P3 pins a `pub struct T` and an imported `ext::U1` both surviving the budget,
 *  and repair's wider net eats both. The underscore is what actually separates a
 *  constant from a short type name in the corpus, and every ALL-CAPS name in the
 *  237-row zero-byte population carries one.
 *
 *  fn-gen refuses a lone capital only when the signature's own generic parameter
 *  list DECLARES it, which is a fact about the signature rather than the name. */
export function isAllCapsConstant(name: string): boolean {
  return /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(name);
}

/** The names this language treats as standard library, and therefore not worth
 *  a resolver round trip. Exported for the call-owner leg (session-v30 item 1),
 *  which resolves the type that OWNS a call and gets `Vec`, `Duration` and
 *  `PathBuf` as readily as it gets a repo type. */
export function stopNamesFor(languageId: string): ReadonlySet<string> {
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return TS_STD_TYPE_NAMES;
  }
  if (languageId === "csharp") {
    return CS_STD_TYPE_NAMES;
  }
  if (languageId === "python") {
    return PY_STD_TYPE_NAMES;
  }
  if (languageId === "go") {
    return GO_STD_TYPE_NAMES;
  }
  return STD_TYPE_NAMES;
}

/**
 * The names the PRE-FILL refuses as a comment-named candidate, per language.
 *
 * Identical to `stopNamesFor` in four languages and DIFFERENT IN RUST, which is
 * the whole reason it exists. `stopNamesFor` answers "is this std, so not worth
 * a resolver round trip" and hands Rust `STD_TYPE_NAMES`. The pre-fill's doc and
 * comment legs hand Rust `PRELUDE_TYPES`, which also carries `None`, `Some`,
 * `Ok`, `Err` and `Self` - names that are in scope everywhere and can never be a
 * candidate.
 *
 * The delta gate has to answer the pre-fill's question and not the resolver's.
 * The census measured what the difference costs: 29 of Rust's 109 class-4
 * instances were those five words, proposed to a developer who accepts them and
 * gets nothing, because the pre-fill throws each one away the moment it is
 * backticked (`session-v52/census-delta.md`).
 *
 * ONE SOURCE, read by both. `fnGen.ts`'s five comment legs call this rather than
 * naming a set each, so the gate and the pre-fill cannot drift again. The values
 * are the ones those call sites already passed, so no prompt byte moves.
 */
export function prefillStopNamesFor(languageId: string): ReadonlySet<string> {
  return languageId === "rust" ? PRELUDE_TYPES : stopNamesFor(languageId);
}

function signatureTypes(languageId: string, signature: string): string[] {
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return tsTypesInPlay(signature);
  }
  if (languageId === "csharp") {
    return csTypesInPlay(signature);
  }
  if (languageId === "python") {
    return pyTypesInPlay(signature);
  }
  if (languageId === "go") {
    return goTypesInPlay(signature);
  }
  return typesInPlay(signature);
}

// A PascalCase identifier is a type CANDIDATE only where the position says so.
// A bare word is not evidence: `Helper();` is a call and `var Total = 0;` is a
// local, and taking either sends the resolver after a name that is not a type.
// The positions, all of them written by the code itself:
//
//   Name.  Name::        a qualifier - an enum variant, a static, a module path
//   new Name             a construction (C#, TS, Java shapes)
//   Name{                a Go composite literal
//   : Name   -> Name     an annotation or a return type (TS, Python, Rust, Go)
//   as Name              a cast
//   <Name    ,Name>      a generic argument
//   (Name)               a C-family cast
//   Name ident           a C-family declaration, `LodBand band = ...`
//   var x Name          a Go declaration, which puts the type after the name
//
// The annotation leg stays on ONE line. Python has no type prefix on a plain
// assignment, so a `:` that ends a header would otherwise reach across the
// newline and take the first local the body assigns.
const BODY_POSITIONS: RegExp[] = [
  /\b([A-Z][A-Za-z0-9_]*)\s*(?:\.|::)/g,
  /\bnew\s+([A-Z][A-Za-z0-9_]*)\b/g,
  /\b([A-Z][A-Za-z0-9_]*)\s*\{/g,
  // The annotation colon is a SINGLE colon. `::` ends in one, so without the
  // lookbehind every Rust path segment after a `::` reads as an annotated type
  // and every enum variant in the corpus becomes a candidate: `Write`, `Read`,
  // `Relaxed`, `Leader`. 4367 slots in one 439-file crate workspace, the
  // largest single junk class measured, in the product's founding language. The
  // variant's OWNER is still taken, by the qualifier leg above.
  //
  // Two prefixes sit between the colon and the name, both added in v30 because
  // the scout's control reproduction wrote the receiver's type down in an
  // explicit annotation and this position still missed it:
  //
  //  - BORROWS and POINTERS. `let cursor: &Cursor` and `&mut Cursor` are the
  //    common Rust local, not a corner. Three of the eleven positions in this
  //    array already tolerated a leading `&` (the return type, and both halves
  //    of the generic argument); this one did not, and it is the one a local
  //    annotation goes through. A LIFETIME-qualified borrow (`&'a Cursor`) is
  //    still missed and is left alone deliberately: 944 borrowed annotations in
  //    the real Rust corpus, none of them lifetime-qualified.
  //  - A MODULE PATH, `::`-separated and lower-case: `let cursor: atlas::Cursor`.
  //    Restricted to `::` on purpose. A `.` qualifier here would read an object
  //    literal's member value (`{ mode: colors.Red }`) as an annotated type and
  //    hand back the enum VARIANT, which is junk in three of the five languages.
  //    `::` is a path separator in Rust and is not member access anywhere else
  //    the product ships, so it carries no such reading.
  /(?<!:):[^\S\n]*(?:(?:[&*]|\b(?:mut|const|dyn|impl)\b)[^\S\n]*)*(?:[a-z_][A-Za-z0-9_]*::)*([A-Z][A-Za-z0-9_]*)\b/g,
  /->\s*\*?\s*&?\s*([A-Z][A-Za-z0-9_]*)\b/g,
  /\bas\s+([A-Z][A-Za-z0-9_]*)\b/g,
  // The generic-argument position, split into its two halves because only one
  // of them survives a line break.
  //
  // A `<` that ends a line opens a generic list and means nothing else, so that
  // half may cross the newline: `React.forwardRef<\n  React.ElementRef<...>` is
  // how real TypeScript writes a wide instantiation.
  //
  // A comma that ends a line means almost anything, and in C# it usually ends a
  // property of an object initializer - a comma-terminated list of PascalCase
  // names, one per line, every one of which the old `\s*` read as a type. 685
  // slots in one solution. Swept over three production repos, 3809 matches
  // crossed a newline; the only ones inside an open generic list were opened by
  // a trailing `<`, and the single comma-crossing match with an unclosed angle
  // in front of it was a `<<` shift. So the comma half is served same-line only.
  // What that costs is the SECOND argument of a generic list broken over lines;
  // the first is still taken by the `<` half.
  /<\s*&?\s*([A-Z][A-Za-z0-9_]*)\b/g,
  /,[^\S\n]*&?[^\S\n]*([A-Z][A-Za-z0-9_]*)\b/g,
  /\(\s*([A-Z][A-Za-z0-9_]*)\s*\)/g,
  // The C-family declaration, with the type's own suffixes between it and the
  // name. `Cursor? cursor = f();` is a nullable reference type and is everywhere
  // in modern C#; the `?` broke this position outright. The suffixes bind TIGHT
  // to the type name (no space allowed in front of them), which is what keeps a
  // ternary out: `flag ? cursor : other` writes a space before the `?` and C#
  // does not.
  /\b([A-Z][A-Za-z0-9_]*)(?:\?|\[\])*\s+[a-z_][A-Za-z0-9_]*\s*[=;,)]/g,
  // The Go declaration, which puts the type after the name. The optional
  // lower-case segment before the type name is the PACKAGE qualifier: in Go a
  // cross-package type is the norm (`var cursor atlas.Cursor`), so without it
  // this position missed the majority case and caught only same-package types.
  /\b(?:var|const)\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*\s+(?:\[\])?\*?(?:[a-z_][A-Za-z0-9_]*\.)?([A-Z][A-Za-z0-9_]*)\b/g,
];

// The one position Python needs and no other language may have: a bare
// constructor CALL on the right of an assignment, `cursor = Cursor()`.
//
// Python has no `new`, so a class instantiation is textually indistinguishable
// from a function call, and taking every PascalCase call in every language would
// hand back `Helper()` and every raised exception. Two things bound it to
// something worth a resolver round trip: the language (PEP 8 spells functions
// snake_case, so a PascalCase callee really is a class by the convention the
// whole ecosystem follows), and a BINDING `=` in front of it, which keeps
// `raise ValueError(...)` and `print(Foo())` out because neither binds a value
// the span goes on to work with.
//
// The lookbehind is what makes "binding" true rather than aspirational. A bare
// `=` also ends `==`, `!=`, `>=`, `<=` and every augmented assignment, and a
// first draft of this leg took the constructor out of `if l.mode == Mode(1)`.
//
// Two shapes are kept on purpose and both really are bindings: a keyword
// argument (`build(sink=Sink())`) constructs a value the call is about to use,
// and the walrus (`if (c := Cursor()) is not None`) binds a local the rest of
// the span then works with.
const PY_BODY_POSITIONS: RegExp[] = [
  /(?<![=!<>+\-*/%&|^])=[^\S\n]*([A-Z][A-Za-z0-9_]*)\s*\(/g,
];

function bodyPositionsFor(languageId: string): RegExp[] {
  return languageId === "python" ? [...BODY_POSITIONS, ...PY_BODY_POSITIONS] : BODY_POSITIONS;
}

// A path qualifier written in a DECLARATION position, and therefore a namespace
// for the whole span - the body's own version of what `pathQualifiersIn` does to
// a signature.
//
// `CONTAINER_TAIL` below drops the leading segments of a path three deep or
// more, so `DataModel.Enums.DataOrigin.None` loses its namespaces. A path two
// deep leaks: `Atlas.Cursor cursor = f();` came back as `[Atlas, Cursor]`, and
// `Atlas` spends a resolver round trip to resolve to nothing.
//
// A declaration is the one body position where a dotted path cannot be a member
// access, because the thing in front of the variable name is a type spelling and
// nothing else.
//
// It CAN be a nested type, though, and that is where the naive rule bit. C#
// writes `Cursor.Mode mode = ...` and the leading segment there is the owning
// TYPE, not a namespace; banning it outright dropped the receiver a span's own
// signature had already named, which is the exact failure this session exists to
// close. So the ban is conditional, and the condition is at the call site below:
// a leading segment is a container only when the span names it NOWHERE ELSE. A
// namespace is spelled as a qualifier and never as anything else, and a type
// that matters is spelled bare somewhere - in the signature, in another
// declaration, in a construction.
//
// The repetition is bounded rather than `+`. Nested `+` over a repeated group
// backtracks quadratically on a long unbroken PascalCase dot chain, and four
// segments is deeper than any real namespace path in the corpora measured.
const DECLARATION_PATH = /\b((?:[A-Z][A-Za-z0-9_]*\s*\.\s*){1,4})[A-Z][A-Za-z0-9_]*(?:\?|\[\])*[^\S\n]+[a-z_][A-Za-z0-9_]*[^\S\n]*[=;,)]/g;

function declarationQualifiersIn(masked: string): Set<string> {
  const out = new Set<string>();
  for (const m of masked.matchAll(DECLARATION_PATH)) {
    for (const segment of m[1].split(".")) {
      const name = segment.trim();
      if (name !== "") {
        out.add(name);
      }
    }
  }
  return out;
}

// A CONTAINER, not a type: what sits at this offset is followed by a separator
// AND the name after that separator is followed by another one, so the match is
// a leading segment of a longer path. `DataModel.Enums.DataOrigin.None` names
// one type and two namespaces, and a namespace resolves to nothing while
// holding a budget slot the type needed - measured on a real C# solution,
// `DataModel` took 45 candidate slots and `Enums` 19, and in the repair surface
// those two evicted the collaborator carrying the fix.
//
// The test is applied to every position rather than to the qualifier leg alone,
// because a path arrives through several of them: `Dictionary<string,
// DataModel.Cosmos.Monitor>` reaches the same junk through the generic-argument
// comma.
//
// The path's TAIL is deliberately left alone. `Regional` in `LodBand.Regional`
// is a member, not a segment, and nothing local to the text tells it apart from
// the `Monitor` in `DataModel.Cosmos.Monitor` - so the rule is the last
// QUALIFIER wins, which keeps the enum in capture A and gives up the last
// segment of a namespace-qualified type spelling.
//
// Sticky rather than a slice: this runs once per match over whole production
// files, and slicing the masked text at each one is quadratic.
const CONTAINER_TAIL = /\s*(?:\.|::)\s*[A-Za-z_][A-Za-z0-9_]*\s*(?:\.|::)/y;

function isPathContainer(masked: string, nameEnd: number): boolean {
  CONTAINER_TAIL.lastIndex = nameEnd;
  return CONTAINER_TAIL.test(masked);
}

// The declared name blanked out of a signature. A C# method name is PascalCase
// and walks straight into a type scan (`public T Pick<T>(...)` offers `Pick`),
// which is the defect `typesNamedIn`'s excludeName closes for fn-gen; the span
// leg has no symbol name to be handed, so it reads the name off the signature
// itself: the identifier that opens the parameter list, generic clause and all.
function withoutDeclaredName(signature: string): string {
  const pattern = /([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^()<>]*>)?\s*\(/g;
  for (const m of signature.matchAll(pattern)) {
    // A KEYWORD in front of the paren is not the declared name. Go's receiver
    // clause puts one there (`func (t Tile) Encloses(o Tile) bool`), so a reader
    // that stops at the first paren blanks `func` and leaves the method name in
    // the scan, where Go's PascalCase exports then read as types. Measured at 38
    // percent junk before this loop looked past the keyword.
    if (DECLARATION_KEYWORDS.has(m[1])) {
      continue;
    }
    const at = (m.index ?? 0) + m[0].indexOf(m[1]);
    return signature.slice(0, at) + " ".repeat(m[1].length) + signature.slice(at + m[1].length);
  }
  return signature;
}

// The words that can sit immediately before a parameter list without being the
// declared name: a declaration keyword, or a control-flow header's own word.
const DECLARATION_KEYWORDS = new Set([
  "func", "fn", "def", "function", "class", "struct", "enum", "interface",
  "record", "async", "await", "return", "if", "for", "while", "switch", "catch",
  "foreach", "using", "lock", "new", "public", "private", "protected", "internal",
  "static", "override", "virtual", "abstract", "sealed", "partial", "extern",
]);

// Every name the SIGNATURE writes as a path QUALIFIER, and therefore a
// namespace or a module for the whole span.
//
// A signature is the one place in a span where a dotted path is never a member
// access: `public DataModel.Enums.ThreatLevel GetThreatLevel(EventMetadata m)`
// is one type spelled the long way. The per-language signature legs read it as
// three, and on the real C# solution that put `DataModel` and `Enums` into two
// of the four budget slots and dropped `ICommonDpmEvent`, which carried the fix
// the round needed. The body scan cannot use this rule (there `LodBand.Regional`
// is a member access and the qualifier is the type), so the signature's answer
// is banned across the whole span instead: a name that is a namespace in the
// header is not a type three lines further down.
const SIGNATURE_QUALIFIER = /\b([A-Z][A-Za-z0-9_]*)\s*(?:\.|::)/g;

export function pathQualifiersIn(signature: string): Set<string> {
  const out = new Set<string>();
  for (const m of signature.matchAll(SIGNATURE_QUALIFIER)) {
    out.add(m[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// session-v40 item 2's candidate leg: a type named only through an import-
// QUALIFIED selector (`pkg.Type`, `Namespace.Type`) in the signature, doc or
// body — the leg typesFromUses / tsTypesFromImports cannot have, because a
// Rust `use` / TS `import` clause spells the type name and a Go import spells
// a package PATH, a C# `using` a NAMESPACE. Neither ever contains a type
// name, so the file's import block only answers a narrower question here: is
// a qualifier the code actually wrote a REAL one. That is what tells
// `cobra.Command` (a package selector) from `resp.StatusCode` (a local
// variable's field) or `Newtonsoft.Json.Linq.JObject` from three segments of
// ordinary prose — text alone cannot, and admitting every capitalized dotted
// chain would readmit exactly the noise the comment-scan work spent a session
// refusing.
//
// Unqualified names are explicitly out of scope: goTypesInPlay / typesNamedIn
// / referencedLocalSymbols already cover a bare mention (including, for Go, a
// same-package export named with no qualifier at all — Go forbids importing
// your own package, so a bare name can never be mistaken for a qualified one
// here). Body text is read through maskNonCode first, so a qualifier spelled
// inside a comment or a string literal is never mined as a real reference.
// ---------------------------------------------------------------------------

const GO_QUALIFIED_USAGE = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Z][A-Za-z0-9_]*)\b/g;

// session-v40 phase 3's adversarial review (test/review-v40-p3-qualified-usage-
// adversarial.test.cjs): a real import name is not proof that a given
// `pkg.Name` occurrence actually resolves to the package — a local variable
// or parameter can shadow the import identifier (`strings := MyLocalType{}`
// then `strings.Foo` names the LOCAL value's field, not the `strings`
// package's `Foo`). This is a candidate-gathering leg with an existing "can't
// confidently tell, don't surface it" convention (the no-matching-import
// case above); shadowing gets the same treatment, not real scope resolution.
// Deliberately conservative and whole-body (not just text ahead of the
// occurrence): a missed real candidate here is a wash against this leg's
// zero pre-session baseline, while mining a shadowed name is a regression —
// worse than before this leg existed, `resolveTypeCursorByName`'s exact-name
// `workspace/symbol` lookup can now anchor it to some unrelated real type
// elsewhere in the workspace and inject that type's shape as if it were
// relevant. Over-refusing is the intended failure mode.
function goQualifierIsLocal(qualifier: string, text: string): boolean {
  const q = qualifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `qualifier := ...` (also `qualifier, other := ...`, the LHS naming it
  // first) — a short var decl target.
  if (new RegExp(`(?:^|[^.\\w])${q}\\s*(?:,\\s*[A-Za-z_]\\w*\\s*)*:=`, "m").test(text)) {
    return true;
  }
  // `var qualifier ...` — a single or first-in-a-list `var` decl, including
  // one line inside a grouped `var ( ... )` block.
  if (new RegExp(`\\bvar\\s+${q}\\b`, "m").test(text)) {
    return true;
  }
  // `qualifier Type` starting a parameter, receiver, or a later name in a
  // var/param list (`(qualifier *T)`, `other, qualifier Type`).
  if (new RegExp(`(?:^|[(,])\\s*${q}\\s+[A-Za-z_*[]`, "m").test(text)) {
    return true;
  }
  return false;
}

/** The types named only through a real package selector (`cobra.Command`) in
 *  the signature, doc comment and body — session-v40 item 2's Go candidate
 *  leg. `fullText` supplies the file's own import block
 *  (`goImportedPackageNames`); a qualifier that names no real import (a local
 *  variable, a struct field holder) never admits its selector's tail as a
 *  candidate — and neither does one that DOES name a real import but is
 *  locally shadowed at some point in the signature/body (`goQualifierIsLocal`).
 *  Pure, first-seen order, GO_STD_TYPE_NAMES excluded like every other Go
 *  leg. */
export function goTypesFromQualifiedUsage(
  signature: string,
  docComment: string | undefined,
  spanText: string,
  fullText: string,
): string[] {
  const imports = goImportedPackageNames(fullText);
  if (imports.size === 0) {
    return [];
  }
  const maskedSignature = maskNonCode(signature);
  const maskedSpanText = maskNonCode(spanText);
  const shadowText = `${maskedSignature}\n${maskedSpanText}`;
  const shadowCache = new Map<string, boolean>();
  const isShadowed = (qualifier: string): boolean => {
    let cached = shadowCache.get(qualifier);
    if (cached === undefined) {
      cached = goQualifierIsLocal(qualifier, shadowText);
      shadowCache.set(qualifier, cached);
    }
    return cached;
  };
  const seen = new Set<string>();
  const out: string[] = [];
  const scan = (text: string) => {
    for (const m of text.matchAll(GO_QUALIFIED_USAGE)) {
      const [whole, qualifier, name] = m;
      // S40-3: `pkg.NewFlagSet(` is a CALL. Every exported Go identifier
      // capitalizes, so without this ~90% of mined names were functions and
      // consts, each burning a live workspace/symbol round trip and a share
      // of the resolve caps. A name immediately followed by `(` never
      // reaches the lookup. A type CONVERSION (`pkg.Type(v)`) is
      // call-shaped too and is knowingly refused with them - measured on
      // the clean v42 corpus (spike-0-ceiling.cjs): round trips halved
      // (2.34 -> 1.10 per row) and the ceiling held 17.8% (497 -> 495 of
      // 2787 needed-type hits; the two lost are conversions).
      if (text[(m.index ?? 0) + whole.length] === "(") {
        continue;
      }
      if (!imports.has(qualifier) || seen.has(name) || GO_STD_TYPE_NAMES.has(name) || isShadowed(qualifier)) {
        continue;
      }
      seen.add(name);
      out.push(name);
    }
  };
  scan(maskedSignature);
  scan(docComment ?? "");
  scan(maskedSpanText);
  return out;
}

// Same shadowing hole as goQualifierIsLocal above, C# shape: a dotted
// chain's LEADING segment (`Newtonsoft.Json.Linq.JObject`'s `Newtonsoft`) is
// the only part that is ever an actual identifier lookup — `Json`, `Linq`
// are member-access tokens under it, never independently shadowable — so
// only that leading segment needs the check. Same conservative, whole-body,
// over-refuse-rather-than-mis-anchor stance.
function csQualifierIsLocal(qualifier: string, text: string): boolean {
  const q = qualifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `var qualifier = ...` — a local declared with `var`.
  if (new RegExp(`\\bvar\\s+${q}\\b`, "m").test(text)) {
    return true;
  }
  // `Type qualifier` starting a parameter, field or local decl — anchored at
  // a statement/list boundary (line start, or right after `(`, `,`, `;`,
  // `{`) so a plain member-access chain (`x.Namespace.Foo`) never matches.
  if (new RegExp(`(?:^|[({,;])\\s*[A-Za-z_][A-Za-z0-9_.<>[\\]]*\\s+${q}\\b`, "m").test(text)) {
    return true;
  }
  return false;
}

/** The types named only through a fully-qualified reference
 *  (`Newtonsoft.Json.Linq.JObject`) in the signature, doc comment and body —
 *  session-v40 item 2's C# candidate leg. `fullText` supplies the file's own
 *  plain `using` namespaces (`csUsingNamespaces`); a dotted chain is walked
 *  segment by segment and admits the FIRST segment after the longest prefix
 *  that matches a real `using` — so `Newtonsoft.Json.Linq.JObject.Parse(x)`
 *  still yields `JObject`, not the method call one segment further in, and a
 *  chain matching no `using` at all (an ordinary member-access chain on a
 *  local) admits nothing. A chain whose LEADING segment is locally shadowed
 *  (`csQualifierIsLocal` — a var/parameter/field sharing the namespace's
 *  first segment name) is refused the same way. Pure, first-seen order,
 *  CS_STD_TYPE_NAMES excluded like every other C# leg. */
export function csTypesFromQualifiedUsage(
  signature: string,
  docComment: string | undefined,
  spanText: string,
  fullText: string,
): string[] {
  const namespaces = csUsingNamespaces(fullText);
  if (namespaces.size === 0) {
    return [];
  }
  const maskedSignature = maskNonCode(signature);
  const maskedSpanText = maskNonCode(spanText);
  const shadowText = `${maskedSignature}\n${maskedSpanText}`;
  const shadowCache = new Map<string, boolean>();
  const isShadowed = (qualifier: string): boolean => {
    let cached = shadowCache.get(qualifier);
    if (cached === undefined) {
      cached = csQualifierIsLocal(qualifier, shadowText);
      shadowCache.set(qualifier, cached);
    }
    return cached;
  };
  const seen = new Set<string>();
  const out: string[] = [];
  const chain = /\b[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)+\b/g;
  const scan = (text: string) => {
    for (const m of text.matchAll(chain)) {
      const segs = m[0].split(".");
      if (isShadowed(segs[0])) {
        continue;
      }
      // Longest prefix first: the common case is a `using` naming the type's
      // full immediate namespace, and checking short-to-long would let a rare
      // top-level `using Newtonsoft;` steal the match and mine "Json" (a
      // deeper namespace segment) as if it were the type.
      for (let k = segs.length - 1; k >= 1; k--) {
        if (!namespaces.has(segs.slice(0, k).join("."))) {
          continue;
        }
        const name = segs[k];
        // S40-3, the Go leg's guard in C# shape: `Ns.Method(` is a call, not
        // a type, and mining it burns the same live lookup. The one
        // call-shaped occurrence C#'s grammar PROVES is a type - `new
        // Ns.Type(` - is exempt; Go has no such form, so the two legs differ
        // by exactly what the language guarantees.
        const nameEnd = (m.index ?? 0) + segs.slice(0, k + 1).join(".").length;
        if (text[nameEnd] === "(" && !/\bnew\s+$/.test(text.slice(0, m.index ?? 0))) {
          break;
        }
        if (!seen.has(name) && !CS_STD_TYPE_NAMES.has(name) && name.length > 1) {
          seen.add(name);
          out.push(name);
        }
        break; // the longest real-namespace prefix wins; further segments are member access, never a second type
      }
    }
  };
  scan(maskedSignature);
  scan(docComment ?? "");
  scan(maskedSpanText);
  return out;
}

/** The PascalCase type candidates the span's BODY names, first-seen order. Read
 *  over comment- and string-masked text: a type named only in a comment is not
 *  in play, and a name inside a string literal is data. */
function bodyTypes(
  code: string,
  languageId: string,
): {
  names: string[];
  /** The leading segments of every declaration-position path. CANDIDATE
   *  containers, not decided ones: the caller drops the ones the span names some
   *  other way. */
  qualifiers: Set<string>;
  /** The names this scan found somewhere OTHER than as a path qualifier. A name
   *  in here is spelled bare somewhere in the body, which is what a namespace
   *  never is. */
  spelledBare: Set<string>;
} {
  const masked = maskNonCode(code);
  const qualifiers = declarationQualifiersIn(masked);
  const positions = bodyPositionsFor(languageId);
  const hits: Array<{ at: number; name: string }> = [];
  const spelledBare = new Set<string>();
  for (let p = 0; p < positions.length; p++) {
    for (const m of masked.matchAll(positions[p])) {
      const at = (m.index ?? 0) + m[0].lastIndexOf(m[1]);
      if (isPathContainer(masked, at + m[1].length)) {
        continue;
      }
      // Position 0 is the qualifier leg, `Name.` / `Name::`. Every other
      // position reads a name that is standing on its own.
      if (p !== 0) {
        spelledBare.add(m[1]);
      }
      hits.push({ at, name: m[1] });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (!seen.has(h.name)) {
      seen.add(h.name);
      out.push(h.name);
    }
  }
  return { names: out, qualifiers, spelledBare };
}

/**
 * The span's types-in-play: what the repair round discloses, in priority order.
 *
 * 1. the signature's own types, through the language's existing leg;
 * 2. the types the BODY names in a type position;
 * 3. the backticked identifiers in the span's own COMMENTS;
 * 4. the doc comment's backticked identifiers;
 * 5. the types the diagnostics named.
 *
 * Deduped first-seen, std/prelude names and bare single letters dropped
 * throughout. A caller that hands garbage gets an empty list, never a throw.
 */
export function spanTypesInPlay(input: SpanTypesInput): string[] {
  const stop = stopNamesFor(input.languageId);
  const signature = typeof input.signature === "string" ? input.signature : "";
  const code = typeof input.code === "string" ? input.code : "";
  // Both legs are read BEFORE the filter, because the body's namespaces ban a
  // name for the whole span, the signature leg included. A name that is a
  // namespace in a declaration is not a type two lines above it either.
  const body = bodyTypes(code, input.languageId);
  const sigTypes = signature !== "" ? signatureTypes(input.languageId, withoutDeclaredName(signature)) : [];
  const namespaces = pathQualifiersIn(signature);
  // The conditional half of the declaration-path ban. `Atlas.Cursor cursor` is a
  // namespace and a type; `Cursor.Mode mode` is a type and its nested type. Text
  // cannot tell the two apart at the path, so the tie is broken everywhere ELSE
  // in the span: a leading segment the span also spells bare - in the signature,
  // in another declaration, in a construction - is a type and stays.
  const spelledBare = new Set([...sigTypes, ...body.spelledBare]);
  for (const q of body.qualifiers) {
    if (!spelledBare.has(q)) {
      namespaces.add(q);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  const take = (names: readonly string[]): void => {
    for (const name of names) {
      if (
        typeof name !== "string" ||
        name === "" ||
        seen.has(name) ||
        stop.has(name) ||
        namespaces.has(name) ||
        STATIC_ENTRY_POINTS.has(name) ||
        PRELUDE_VALUES.has(name) ||
        // `isShoutedName` subsumes the lone capital, so this is repair's rule
        // whole and unchanged: same names refused, same order, same output.
        isShoutedName(name) ||
        !/^[A-Z][A-Za-z0-9_]*$/.test(name)
      ) {
        continue;
      }
      seen.add(name);
      out.push(name);
    }
  };
  take(sigTypes);
  take(body.names);
  // The BODY COMMENT's backticked names. The body scan above ran on `maskNonCode`
  // output, which blanks comments by construction, so this is the one leg that
  // reads what the developer wrote in prose inside the span.
  //
  // Above the doc comment on purpose: in a repair round the span is the failing
  // evidence and the doc is the older statement of intent.
  //
  // Nothing is subtracted from this leg. An earlier version held the doc's own
  // names back so the doc could not be promoted a tier by the span sweeping the
  // doc comment in, and the premise was wrong twice over. `resolveFunctionAtCursor`
  // normalizes the head, so `code` starts at the declaration and the doc is
  // trivia above it; and when a language server DOES report a range that swallows
  // the doc (the state `oracleSurface` logs a span-line range to catch), the two
  // tiers are adjacent with nothing between them, so merging them reorders
  // nothing else. What the subtraction did cost was real: a type the developer
  // named in BOTH the doc and a body comment ranked below one they named once.
  take(commentTypesIn(code, input.languageId, undefined, stop));
  if (typeof input.docComment === "string" && input.docComment !== "") {
    // The doc leg only: the signature was already read by its own language's
    // leg above, and `typesNamedIn` would re-scan it under the Rust rules. The
    // stop set is this language's too, or a C# doc naming `Result` loses it to
    // Rust's prelude before the language's own filter ever runs.
    take(typesNamedIn("", input.docComment, undefined, stop));
  }
  take(input.diagnosticTypes ?? []);
  return out;
}
