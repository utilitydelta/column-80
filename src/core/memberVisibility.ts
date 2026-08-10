/**
 * Can the target legally call this member?
 *
 * There is no uniform signal. Each language spells visibility somewhere else,
 * and one of the five spells it nowhere at all, so this is a per-language table
 * rather than a shared predicate. The injected surface is headed "real
 * signatures, use these exact names", which makes a private member an invitation
 * to a guaranteed compile error - the live capture listed four of the lru
 * crate's.
 *
 * TWO QUESTIONS, NOT ONE, and conflating them is the defect this module was
 * rebuilt around. `pub` and an accessibility modifier answer "is this visible
 * OUTSIDE its own scope". What the caller needs is "can THIS TARGET call it".
 * The two agree for an external crate and disagree whenever the target sits
 * inside the type's own scope - which is the normal case, because the first
 * block in a pre-fill payload is the human's own enclosing type. So a rule never
 * runs alone: `exempt` decides whether the target is already inside the scope
 * that can see privates, and only outside it does the modifier get a vote.
 *
 * THE EXEMPT SCOPE IS LANGUAGE-DEFINED. Rust privacy is MODULE-scoped and Go
 * exportedness PACKAGE-scoped, so a sibling type declared alongside the target
 * is reachable; C# and TypeScript `private` is TYPE-scoped, so a different class
 * in the same file is not. Collapsing the four onto one rule is wrong in the
 * expensive direction for two of them either way it is done.
 *
 * UNKNOWN IS KEPT. The fallback is asymmetric because the costs are. Injecting a
 * private member costs one compile error the oracle catches in about 200ms;
 * dropping a public one costs the model the API it needed, and nothing
 * downstream can detect a surface that is merely absent.
 *
 * WHERE THE DECLARATION COMES FROM, per rule, because it is not uniform:
 *   C# and TypeScript  the POSITION, never a name. The member carries its name
 *                      token's line AND column off the documentSymbol node, and
 *                      the modifier is read out of that declarator alone. A
 *                      member with no column answers `unknown`; the column is
 *                      never recovered by searching the line for the name,
 *                      which answers from a call site or a macro argument as
 *                      confidently as from a declaration.
 *   Rust               the position to the LINE, plus a text test on that line.
 *                      The test is what keeps a macro-generated member unknown,
 *                      and the column alone does not preserve it.
 *   Go                 no position at all - the signal is the first rune of the
 *                      name.
 */

import { CompletionMember } from "./extraction";
import { TS_LANGUAGE_IDS } from "./tsExtraction";

/** What the language's own signal says about one member. `unknown` is a real
 *  answer - it means the signal could not be read here, not that the member is
 *  private. */
export type MemberVisibility = "public" | "non-public" | "unknown";

/** Everything a rule may read: the def file's lines (already split by the
 *  caller, which holds the text anyway), the type the members belong to, and its
 *  def-site hover signature - the one place C# can learn that the container is
 *  an INTERFACE or an ENUM, where the no-modifier default inverts or is illegal
 *  outright. */
export interface VisibilityContext {
  lines: string[];
  typeName: string;
  typeSignature?: string;
}

export type VisibilityRule = (member: CompletionMember, ctx: VisibilityContext) => MemberVisibility;

/** Where the target sits, which is what decides whether the filter runs at all.
 *  `uri` is the file the generated body lands in; `enclosingType` is the type it
 *  is a member of, absent for a free function or a target the symbol tree could
 *  not place. */
export interface TargetScope {
  uri: string;
  enclosingType?: string;
}

/** Is the target already INSIDE the scope that can see this type's privates? */
export type ScopeExemption = (type: { name: string; defUri: string }, target: TargetScope) => boolean;

/** One language's whole answer: when the filter applies, and what it says. */
export interface LanguageVisibility {
  rule: VisibilityRule;
  exempt: ScopeExemption;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The member's own declaration line, or undefined when it carries no position
// (or one outside the file). Never a search: see the module header.
function declarationLine(member: CompletionMember, ctx: VisibilityContext): string | undefined {
  const line = member.declLine;
  if (line === undefined || line < 0 || line >= ctx.lines.length) {
    return undefined;
  }
  return ctx.lines[line];
}

const isCallable = (m: CompletionMember) => m.kind === "method" || m.kind === "function";

// ---------------------------------------------------------------------------
// The exempt scopes.
// ---------------------------------------------------------------------------

// SAME FILE IS A PROXY FOR SAME MODULE, and it is wrong at both edges,
// deliberately. A child `mod inner { }` in the same file cannot see its parent's
// privates; a `mod x;` sibling in another file often can. The resolver's signal
// is the file the type was defined in, the proxy is free, and a miss at either
// edge is one compile error the oracle already catches.
const sameFile: ScopeExemption = (type, target) => type.defUri === target.uri;

// A Go package IS a directory, so the directory comparison is the rule rather
// than a proxy for it - modulo an `_test` package, which shares the directory
// and is exempt here. Keep-direction, and a test file calling into its own
// package's unexported members is the common case anyway.
const samePackage: ScopeExemption = (type, target) => dirOf(type.defUri) === dirOf(target.uri);

const dirOf = (uri: string) => uri.slice(0, uri.lastIndexOf("/") + 1);

// C# and TypeScript `private` is TYPE-scoped. Only the target's OWN enclosing
// type is exempt: a different class in the same file genuinely cannot reach its
// privates, and a target with no enclosing type at all (a free function, a
// static utility outside the type it builds) is inside nothing and exempts
// nothing.
const sameType: ScopeExemption = (type, target) =>
  target.enclosingType !== undefined && type.name === target.enclosingType;

// ---------------------------------------------------------------------------
// The rules.
// ---------------------------------------------------------------------------

// Rust: `pub` at the member's own declaration. A line the member is not declared
// on is unknown, which is what keeps a macro-generated member
// (`column80_accessors!(Owner, tick_count)` - no `pub`, and no visibility answer
// either) out of the drop set. `pub(crate)` counts as public: the target is in
// the crate that can see it, and the alternative is dropping real API.
//
// `pub` is matched anywhere on the line, comments included, so
// `fn attach(&mut self) { } // pub API uses this` reads public. Keep-direction
// and left as it is on purpose: narrowing it to the declarator would mean giving
// up the `declares` test above, which is the thing holding macro-generated
// members on the keep side.
const rustVisibility: VisibilityRule = (member, ctx) => {
  const line = declarationLine(member, ctx);
  if (line === undefined) {
    return "unknown";
  }
  const name = escapeRe(member.name);
  const declares = isCallable(member)
    ? new RegExp(`\\bfn\\s+${name}\\b`)
    : new RegExp(`^\\s*(?:pub\\s*(?:\\([^)]*\\))?\\s+)?${name}\\s*:`);
  if (!declares.test(line)) {
    return "unknown";
  }
  return /\bpub\b/.test(line) ? "public" : "non-public";
};

// Go: the first rune of the name, and nothing else. Exported iff upper-case, so
// this costs no file read. Exact for a cased rune and `unknown` for anything
// else - a digit or a caseless script has no case for the rule to read, and Go
// makes no claim there either. gopls names a method symbol `(*Owner).Absorb`, so
// the test is on the last segment.
const goVisibility: VisibilityRule = (member) => {
  const bare = member.name.slice(member.name.lastIndexOf(".") + 1);
  const first = bare[0];
  if (first === undefined) {
    return "unknown";
  }
  if (first === "_") {
    return "non-public";
  }
  if (first !== first.toLowerCase()) {
    return "public";
  }
  if (first !== first.toUpperCase()) {
    return "non-public";
  }
  return "unknown"; // a digit or a caseless rune: not a claim Go's rule makes
};

/** The member's own declaration: the text of its line and the column its NAME
 *  TOKEN starts at, both taken off the position the server gave. */
interface Declaration {
  line: string;
  at: number;
}

// The declaration a C#/TS rule reads, or undefined when the member does not
// carry one. The name check is an ASSERTION about the position, not a search: a
// provider that points a little wide of the token, or a member built from a
// completion list with no position at all, must answer `unknown` rather than
// read a stranger's modifiers. `startsWith` rather than an exact slice so a
// name the transport normalized (a C# `Name : Type` label reduced to the bare
// identifier) still agrees with the source.
function declarationAt(member: CompletionMember, ctx: VisibilityContext): Declaration | undefined {
  const start = member.selectionRange?.start;
  if (start === undefined || start.line < 0 || start.line >= ctx.lines.length) {
    return undefined;
  }
  const line = ctx.lines[start.line];
  if (!line.startsWith(member.name, start.character)) {
    return undefined;
  }
  return { line, at: start.character };
}

// The member's OWN declarator, back to the last `;`, `{`, opening `(` or
// separating comma before its name - never the whole line. Two members can share
// a source line
// (`public class Cache { private int _a; public int B; }`), and a modifier found
// anywhere on that line drops the public one, which is the expensive direction:
// an injected private member costs one compile error, a lost public member costs
// the model an API and has no oracle at all.
//
// THE OPENING `(` ENDS A DECLARATOR the same way the comma inside it does,
// otherwise the FIRST parameter in a list still reads the whole line and a
// `private constructor(readonly b: string)` drops a public property for a
// modifier that belongs to the constructor.
//
// A DECLARATOR INSIDE AN OPEN PARAMETER LIST THAT CLAIMS NOTHING INHERITS THE
// PREFIX BEFORE THE `(`, because one language leaves the accessibility on the
// type instead of on each parameter:
//
//   public sealed record Money(decimal Amount, string Currency);
//
// Both properties are public and neither declarator says so. Read alone, the
// second one is a C# class member with no modifier and the class default drops
// it - a public member gone with no oracle to notice. The fallback is guarded on
// the declarator claiming NOTHING, so a parameter that carries its own modifier
// still outranks the type's, which is what keeps this off TypeScript: a
// parameter property is only a class member at all when it carries an
// accessibility keyword or `readonly`, so its own claim always wins and a
// `private constructor(readonly b: string)` never lends its `private` to `b`.
function modifierPrefix(decl: Declaration): string {
  const before = decl.line.slice(0, decl.at);
  const { comma, open } = enclosingGroup(before);
  const own = before.slice(Math.max(punctuationEnd(before), comma, open) + 1);
  if (open < 0 || /\b(?:public|private|protected|internal|readonly)\b/.test(own)) {
    return own;
  }
  const outer = before.slice(0, open);
  return `${outer.slice(punctuationEnd(outer) + 1)} ${own}`;
}

// Where the previous declarator ended for punctuation that ends one outright.
const punctuationEnd = (before: string) => Math.max(before.lastIndexOf(";"), before.lastIndexOf("{"));

/** The `(` of the still-open group the name sits in, and the comma inside it
 *  that ends the previous declarator - both -1 when the name is not in one. */
interface EnclosingGroup {
  comma: number;
  open: number;
}

// Not every comma ends a declarator, and the two kinds differ by nesting rather
// than by language:
//
//   constructor(private a: number, public b: string)   TS parameter properties
//   private int _a, _b;                                one C# modifier, two fields
//
// The first comma separates two declarators that each carry their own modifier,
// and dropping `b` for `a`'s `private` loses a public member. The second sits
// between declarators the one modifier covers, so a boundary there would read
// `_b` as having no modifier and the C# class default would drop it. What tells
// them apart is that the parameter list is still OPEN where the name sits: the
// comma is inside it, the C# one is at depth zero.
//
// So: scan back from the name, and a comma counts only when nothing has closed
// between it and the name AND an unclosed `(` lies further left. That second
// half is what keeps a paren that closed before the name from voting -
// `public (int, int) Size;` and `[Trace(1, 2)] public int X;` are one declarator
// each, and their commas belong to a group the name is not in.
function enclosingGroup(before: string): EnclosingGroup {
  let closed = 0;
  let comma = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    const c = before[i];
    if (c === ")") {
      closed++;
    } else if (c === "(") {
      if (closed === 0) {
        return { comma, open: i }; // the list the name is a member of
      }
      closed--;
    } else if (c === "," && closed === 0 && comma < 0) {
      comma = i;
    }
  }
  return { comma: -1, open: -1 };
}

// TypeScript: `#` in the name, or a `private`/`protected` modifier on the
// member's own declarator. The `#` half is a fact about the name and needs no
// position at all, which matters because a `#`-named member has no word boundary
// to anchor on.
const tsVisibility: VisibilityRule = (member, ctx) => {
  if (member.name.startsWith("#")) {
    return "non-public";
  }
  const decl = declarationAt(member, ctx);
  if (decl === undefined) {
    return "unknown";
  }
  return /\b(?:private|protected)\b/.test(modifierPrefix(decl)) ? "non-public" : "public";
};

// C#: the accessibility modifier on the member's own declarator - remembering
// that the no-modifier default has FOUR cases and not one. In a class it is
// private; in a struct it is private; in an interface it is PUBLIC; and in an
// enum a modifier is not merely absent but ILLEGAL, so the default must not fire
// there at all. Applying the class rule uniformly strips every interface
// receiver's surface and every enum's members, and nothing downstream notices.
//
// `private protected` is tested before bare `private` and answers public: it is
// callable from a derived type in the same assembly, which is where the target
// plausibly is. `protected` and `internal` keep for the same reason - neither is
// callable from everywhere, both are callable from somewhere the target
// plausibly is, and the doubtful case keeps for the reason in the header: an
// injected private member costs one compile error the oracle catches, a dropped
// public one costs the model an API and has no oracle at all.
const csVisibility: VisibilityRule = (member, ctx) => {
  if (containerKind(ctx) === "enum") {
    return "public"; // no modifier to read, and none is legal
  }
  const decl = declarationAt(member, ctx);
  if (decl === undefined) {
    return "unknown";
  }
  const before = modifierPrefix(decl);
  if (/\bprivate\s+protected\b/.test(before)) {
    return "public";
  }
  if (/\bprivate\b/.test(before)) {
    return "non-public";
  }
  if (/\b(?:public|internal|protected)\b/.test(before)) {
    return "public";
  }
  return containerKind(ctx) === "interface" ? "public" : "non-public";
};

type ContainerKind = "interface" | "enum" | "type";

// What kind of container the members belong to, for the C# no-modifier default.
// The def-site hover answers it (`enum Mode`, `interface IOwner`), and the
// declaration in the def text is the fallback for a hover that did not resolve.
function containerKind(ctx: VisibilityContext): ContainerKind {
  const signature = ctx.typeSignature ?? "";
  if (/\binterface\b/.test(signature)) {
    return "interface";
  }
  if (/\benum\b/.test(signature)) {
    return "enum";
  }
  const declares = (keyword: string) => new RegExp(`\\b${keyword}\\s+${escapeRe(ctx.typeName)}\\b`);
  if (ctx.lines.some((l) => declares("interface").test(l))) {
    return "interface";
  }
  if (ctx.lines.some((l) => declares("enum").test(l))) {
    return "enum";
  }
  return "type";
}

const TABLE: Record<string, LanguageVisibility> = {
  rust: { rule: rustVisibility, exempt: sameFile },
  go: { rule: goVisibility, exempt: samePackage },
  csharp: { rule: csVisibility, exempt: sameType },
};

/** The visibility pass for a language, or undefined when the language has no
 *  signal and its surface therefore does not change.
 *
 *  PYTHON IS UNDEFINED ON PURPOSE. A single leading underscore is a convention,
 *  not a rule the interpreter enforces, and the codebase carries a standing
 *  decision to keep those members (src/vscode/pyExtractor.ts). Reversing it is a
 *  human call, not a filter. */
export function visibilityFor(languageId: string): LanguageVisibility | undefined {
  if (TABLE[languageId]) {
    return TABLE[languageId];
  }
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return { rule: tsVisibility, exempt: sameType };
  }
  return undefined;
}
