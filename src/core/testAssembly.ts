/**
 * Pure cores the TDD gesture wires together:
 *  - blankTestModule: turn the model's `#[cfg(test)] mod tests` block into a VS
 *    Code snippet whose expected values are blank tabstop holes (the human types
 *    them — blank-the-value), with all other literal text snippet-escaped.
 *  - planTestInsertion: detect-and-extend placement (never clobber the
 *    developer's tests; idempotent regeneration via a distinctive marker).
 */

import * as path from "path";
import { StructFieldShape, renderBlankValue } from "./tabstop";

export interface BlankTestModule {
  snippet: string;
  holes: number;
}

/** What differs between one language's literals and another's. The defaults ARE
 *  Rust's, so every shipped caller passing no profile reads exactly as before.
 *  One scanner, a profile per language: a second comment reader is how the
 *  blank-value locator and the insertion planner drift apart. */
export interface LiteralProfile {
  /** The raw-string delimiter, inside which a backslash is an ordinary
   *  character: Go's backtick. Absent means the language has none. */
  rawStringDelimiter?: string;
  /** Rust's block comments nest and Go's do not: a block comment holding a
   *  second opener ends at the FIRST closer in Go and at the second in Rust.
   *  Defaults to true, which is Rust. */
  nestedBlockComments?: boolean;
  /** `'…'` is a full STRING with escapes, not a char literal: TypeScript,
   *  JavaScript and Python. Defaults to false, which is Rust's `'a'` char
   *  literal plus the lifetime special case. */
  singleQuoteStrings?: boolean;
  /** The template-literal delimiter, inside which `${…}` holds an arbitrary
   *  EXPRESSION — nested strings, nested templates and braces of its own:
   *  TypeScript's backtick. Absent means the language has none.
   *
   *  Distinct from rawStringDelimiter, which is Go's backtick and has no
   *  escapes and no interpolation. Reading a TypeScript template as a Go raw
   *  string ends it at the first backtick INSIDE an interpolation, and then
   *  every following quote reads inverted. */
  templateLiteralDelimiter?: string;
  /** `#` to end of line is a comment, and neither `//` nor a C block comment is
   *  one: Python. Defaults to false, the C-family reading every shipped caller
   *  has today.
   *
   *  ONE flag turns both directions on and off deliberately. Python's `//` is
   *  FLOOR DIVISION, so a scanner that keeps the C reading swallows the rest of
   *  the line in `assert halve(7) == 7 // 2` and the expected-value span comes
   *  back short, the model's `// 2` left in the human's buffer, which is the
   *  blank-value invariant inverted. A language has one comment syntax, so this
   *  is one switch rather than two that can be set inconsistently. */
  hashComments?: boolean;
  /** `"""…"""` and `'''…'''` are STRINGS, and a quote inside one is ordinary:
   *  Python. Defaults to false. Checked before the single-character quote
   *  branches, or a docstring reads as an empty string followed by code. */
  tripleQuotedStrings?: boolean;
  /** An `f`-prefixed string holds `{…}` EXPRESSIONS, which since 3.12 may reuse
   *  the string's own quote (`f"{d["k"]}"`): Python. Defaults to false, so a
   *  prefixed string reads as an ordinary one. */
  fStringInterpolation?: boolean;
  /** `@"…"` is a VERBATIM string: `""` is the escaped quote and `\` is an
   *  ORDINARY character: C#. Defaults to false.
   *
   *  Opt-in because it inverts the escape rule. A scanner keeping the C reading
   *  ends `@"C:\path\"` at the closing quote it should have escaped past, and a
   *  scanner keeping the verbatim reading of an ORDINARY string swallows the
   *  rest of the file at the first `\"`. Both directions lose every later
   *  expected-value span in a generated module.
   *
   *  Both prefix orders are verbatim: `$@"…"` and `@$"…"` are the same literal,
   *  and the second reaches the plain-quote branch rather than the `@` one. */
  verbatimStrings?: boolean;
  /** `"""…"""` (three or more quotes) is a RAW string literal with NO escapes at
   *  all, closed by a run of at least as many quotes: C#. Defaults to false.
   *
   *  Distinct from tripleQuotedStrings, which is Python's and DOES honour a
   *  backslash escape; reading a C# raw string that way ends it early on a
   *  trailing backslash. Checked before the plain-quote branch or a raw string
   *  reads as an empty string followed by code. */
  csRawStrings?: boolean;
  /** A `$`-prefixed string holds `{…}` EXPRESSIONS and `{{` is an escaped
   *  brace: C#'s `$"…{expr}…"`, including `$@"…"` and `@$"…"`. Defaults to
   *  false, so a prefixed string reads as an ordinary one. */
  dollarInterpolation?: boolean;
  /** `/…/flags` is a REGEX LITERAL: TypeScript and JavaScript only. Defaults to
   *  false, so Rust and Go read `/` exactly as before.
   *
   *  Opt-in because it is the one construct that cannot be recognised from its
   *  opening character alone — `/` is also division — and because getting it
   *  wrong is expensive in both directions. A regex holding a quote
   *  (`splitOn(/'/, s)`) reads as an OPENING quote to a scanner that does not
   *  model it, and the string it opens then swallows the rest of the file, so
   *  every later assertion in a generated module goes unblanked. */
  regexLiteral?: boolean;
}

/** Whether the `/` at `i` OPENS a regex rather than dividing. A bounded
 *  heuristic over the previous significant character, not a tokenizer: an
 *  identifier character, `)` or `]` ends an expression, so the `/` after one is
 *  division; anything else (an operator, a comma, an opening bracket, the start
 *  of the text) means a value is expected and a regex opens.
 *
 *  Wrong only where a full parse would be needed to tell (`a++ /re/` is not
 *  real code), and wrong in the SAFE direction: a misread regex is skipped as a
 *  division and the scan continues character by character, which is what a
 *  scanner with no regex support does everywhere today. */
function regexOpensAt(text: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) {
    j--;
  }
  if (j < 0) {
    return true;
  }
  const prev = text[j];
  return !(/[\w$]/.test(prev) || prev === ")" || prev === "]");
}

/** Whether the quote at `i` opens an f-STRING: one or two prefix letters from
 *  `rbufRBUF` immediately before it, at least one of them an `f`, and no
 *  identifier character before the run, so `foo"x"` is a plain string that
 *  happens to follow a name, and `rf"…"` is an f-string. */
function isFStringAt(text: string, i: number, profile?: LiteralProfile): boolean {
  if (profile?.fStringInterpolation !== true) {
    return false;
  }
  let j = i;
  while (j > 0 && i - j < 2 && /[rbufRBUF]/.test(text[j - 1])) {
    j--;
  }
  return j < i && /[fF]/.test(text.slice(j, i)) && !/[\w$]/.test(text[j - 1] ?? "");
}

/** The at most two `$`/`@` prefix characters immediately before the quote at
 *  `i`, empty when the run is the tail of an identifier so `cash@"x"` carries no
 *  prefix at all. C# allows `$"`, `@"`, `$@"` and `@$"` and nothing longer. */
function literalPrefixAt(text: string, i: number): string {
  let j = i;
  while (j > 0 && i - j < 2 && (text[j - 1] === "$" || text[j - 1] === "@")) {
    j--;
  }
  return /[\w]/.test(text[j - 1] ?? "") ? "" : text.slice(j, i);
}

/** Whether the literal opening at `i` carries a C# `$` interpolation prefix. */
function isDollarPrefixedAt(text: string, i: number, profile?: LiteralProfile): boolean {
  if (profile?.dollarInterpolation !== true) {
    return false;
  }
  return literalPrefixAt(text, i).includes("$");
}

/** Whether the quote at `i` opens a VERBATIM string whose `@` the scan has
 *  already walked past: `@$"…"`, the prefix order the `@`-first branch below
 *  never sees.
 *
 *  Both orders are the same literal in C#, and reading `@$"C:\"` as an ordinary
 *  interpolated string makes the backslash escape the closing quote. The literal
 *  then runs to the next quote in the file, which is somewhere in the
 *  developer's next string: every later expected value goes unblanked and the
 *  locator can match bytes that are really string CONTENT. */
function isVerbatimPrefixedAt(text: string, i: number, profile?: LiteralProfile): boolean {
  if (profile?.verbatimStrings !== true) {
    return false;
  }
  return literalPrefixAt(text, i).includes("@");
}

/** The index after a C# VERBATIM string whose body starts at `i`. `""` is one
 *  escaped quote, a lone `"` ends it, and a backslash is an ordinary character.
 *  `interpolated` reads `$@"…{expr}…"`'s braces the same way an ordinary
 *  interpolated string's are read. */
function skipVerbatim(text: string, i: number, interpolated: boolean, profile?: LiteralProfile): number {
  while (i < text.length) {
    if (text[i] === '"') {
      if (text[i + 1] === '"') {
        i += 2;
        continue;
      }
      return i + 1;
    }
    if (interpolated && text[i] === "{") {
      i = text[i + 1] === "{" ? i + 2 : skipInterpolation(text, i + 1, profile);
      continue;
    }
    i++;
  }
  return i;
}

/** The index after the `}` closing an interpolation whose body starts at `i`,
 *  counted by brace DEPTH with this file's own scanner recursing, so a nested
 *  string, a nested interpolation and an object initializer inside the
 *  expression all end where they really end. */
function skipInterpolation(text: string, i: number, profile?: LiteralProfile): number {
  let depth = 1;
  while (i < text.length && depth > 0) {
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (text[i] === "{") {
      depth++;
    } else if (text[i] === "}") {
      depth--;
    }
    i++;
  }
  return i;
}

/** The index after the string whose BODY starts at `i` and whose terminator is
 *  `close` (one character, or Python's three). A backslash escapes the next
 *  character in every spelling, raw strings included: `r"a\"b"` really does run
 *  to the final quote. `interpolated` reads an f-string's `{…}` as an EXPRESSION
 *  by brace depth, so a nested string of the same quote (legal since 3.12) does
 *  not end the literal early; `{{` is an escaped brace and opens nothing.
 *  Unterminated ends at the end of the text, never past it. */
function skipQuoted(text: string, i: number, close: string, interpolated: boolean, profile?: LiteralProfile): number {
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text.startsWith(close, i)) {
      return i + close.length;
    }
    if (interpolated && text[i] === "{") {
      if (text[i + 1] === "{") {
        i += 2;
        continue;
      }
      let depth = 1;
      i++;
      while (i < text.length && depth > 0) {
        const skipped = skipLiteralOrComment(text, i, profile);
        if (skipped > i) {
          i = skipped;
          continue;
        }
        if (text[i] === "{") {
          depth++;
        } else if (text[i] === "}") {
          depth--;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

// If a string/char literal or comment begins at `i`, return the index AFTER it;
// otherwise return `i` unchanged. Keeps the structural scanners below from
// counting a paren/comma/brace that lives inside a literal or a comment.
//
// Exported so the seam's Rust preamble skipper and the per-language
// expected-value locators (tddLang.ts, tddGo.ts) reuse this one scanner instead
// of growing a second comment reader that can drift from it.
export function skipLiteralOrComment(text: string, i: number, profile?: LiteralProfile): number {
  const c = text[i];
  const c2 = text[i + 1];
  if (profile?.hashComments === true && c === "#") {
    while (i < text.length && text[i] !== "\n") {
      i++;
    }
    return i;
  }
  if (profile?.tripleQuotedStrings === true && (c === '"' || c === "'") && c2 === c && text[i + 2] === c) {
    return skipQuoted(text, i + 3, c.repeat(3), isFStringAt(text, i, profile), profile);
  }
  if (profile?.csRawStrings === true && c === '"' && c2 === '"' && text[i + 2] === '"') {
    // A C# raw string literal: N>=3 quotes open it and a run of at least N
    // close it, with NO escape character inside at all. The fence LENGTH is the
    // terminator, which is exactly why the construct exists — a raw string can
    // hold `"""` by opening with four quotes.
    let fence = 0;
    while (text[i + fence] === '"') {
      fence++;
    }
    let j = i + fence;
    while (j < text.length) {
      if (text[j] !== '"') {
        j++;
        continue;
      }
      let run = 0;
      while (text[j + run] === '"') {
        run++;
      }
      if (run >= fence) {
        return j + run;
      }
      j += run;
    }
    return text.length;
  }
  if (profile?.verbatimStrings === true && c === "@" && c2 === '"') {
    // `@"…"`, and `$@"…"` when the `$` sits in front of the `@`. The scan
    // reaches this index one character at a time, so the `$` is behind us and
    // the prefix has to be read backwards.
    return skipVerbatim(text, i + 2, isDollarPrefixedAt(text, i, profile), profile);
  }
  const raw = profile?.rawStringDelimiter;
  if (raw !== undefined && c === raw) {
    // No escapes inside: the delimiter itself is the only terminator, which is
    // exactly why a Go raw string can hold a lone backslash.
    const close = text.indexOf(raw, i + 1);
    return close === -1 ? text.length : close + 1;
  }
  if (c === '"' || (c === "'" && profile?.singleQuoteStrings === true)) {
    // `@$"…"` arrives here rather than at the `@` branch above, because the `$`
    // sits between the `@` and the quote. The prefix is read backwards, so the
    // `@` is still visible and the literal gets the verbatim escape rule it
    // really has.
    if (c === '"' && isVerbatimPrefixedAt(text, i, profile)) {
      return skipVerbatim(text, i + 1, isDollarPrefixedAt(text, i, profile), profile);
    }
    return skipQuoted(text, i + 1, c, isFStringAt(text, i, profile) || isDollarPrefixedAt(text, i, profile), profile);
  }
  const tmpl = profile?.templateLiteralDelimiter;
  if (tmpl !== undefined && c === tmpl) {
    i++;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i] === tmpl) {
        return i + 1;
      }
      if (text[i] === "$" && text[i + 1] === "{") {
        // An interpolation is an EXPRESSION, so it can hold quotes, braces and
        // further templates. Counted by brace depth with this same scanner
        // recursing, which is what makes `` `a${b ? `${c}` : "}"}d` `` end in
        // the right place.
        let depth = 1;
        i += 2;
        while (i < text.length && depth > 0) {
          const skipped = skipLiteralOrComment(text, i, profile);
          if (skipped > i) {
            i = skipped;
            continue;
          }
          if (text[i] === "{") {
            depth++;
          } else if (text[i] === "}") {
            depth--;
          }
          i++;
        }
        continue;
      }
      i++;
    }
    return i;
  }
  if (c === "/" && c2 === "/" && profile?.hashComments !== true) {
    while (i < text.length && text[i] !== "\n") {
      i++;
    }
    return i;
  }
  if (c === "/" && c2 === "*" && profile?.hashComments !== true) {
    const nests = profile?.nestedBlockComments ?? true;
    let depth = 1;
    i += 2;
    while (i < text.length && depth > 0) {
      if (nests && text[i] === "/" && text[i + 1] === "*") {
        depth++;
        i += 2;
      } else if (text[i] === "*" && text[i + 1] === "/") {
        depth--;
        i += 2;
      } else {
        i++;
      }
    }
    return i;
  }
  if (c === "/" && profile?.regexLiteral === true && regexOpensAt(text, i)) {
    // `/…/flags`. A `/` inside a CHARACTER CLASS is an ordinary character, so
    // the class has to be tracked; a newline ends the literal in the grammar,
    // and reaching one here means the `/` was not a regex after all.
    let j = i + 1;
    let inClass = false;
    while (j < text.length) {
      const ch = text[j];
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === "\n") {
        return i;
      }
      if (ch === "[") {
        inClass = true;
      } else if (ch === "]") {
        inClass = false;
      } else if (ch === "/" && !inClass) {
        j++;
        while (j < text.length && /[a-z]/.test(text[j])) {
          j++;
        }
        return j;
      }
      j++;
    }
    return i;
  }
  if (c === "'") {
    // A char literal (`'a'`, `'\n'`, `'\''`) — consume it whole. A lifetime
    // (`'a` with no closing quote) is not a literal: leave `i` for the caller.
    const m = /^'(\\.|[^'\\])'/.exec(text.slice(i));
    if (m) {
      return i + m[0].length;
    }
  }
  return i;
}

const OPENERS = "([{";
const CLOSERS = ")]}";

/**
 * The delimiter matching the one at `open`, by DEPTH over `()[]{}` with literals
 * and comments skipped; -1 when unbalanced.
 *
 * The depth count is the whole point, and every language needs it: `indexOf(")")`
 * finds the wrong paren on a Go pointer receiver (`func (s *Shard) M(a int) string`)
 * and on a function-typed parameter, which both Go and TypeScript have
 * (`function j(cb: (x: number) => number): string`).
 *
 * Lifted out of tddGo.ts so the language legs share ONE depth scanner rather than
 * one each. Go's call sites pass GO_LITERALS and read exactly as before.
 */
export function matchDelim(text: string, open: number, profile?: LiteralProfile): number {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = text[i];
    if (OPENERS.includes(c)) {
      depth++;
    } else if (CLOSERS.includes(c)) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

// The matching `)` and the top-level argument spans of a call whose `(`
// sits at `open`. Depth over ()[]{} only (angle brackets are ambiguous with
// comparison and do not appear in expected-value literals); literals/comments
// skipped. Arg spans are trimmed of surrounding whitespace. undefined when
// unbalanced.
//
// Exported for the per-language expected-value locators: vitest's expected value
// is the first argument of the terminating matcher, which is this same parse over
// a different call. `profile` defaults to Rust's, so the shipped Rust caller is
// byte-identical.
export function topLevelArgs(
  text: string,
  open: number,
  profile?: LiteralProfile,
): { args: Array<{ start: number; end: number }>; close: number } | undefined {
  const raw: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let argStart = open + 1;
  let i = open + 1;
  let close = -1;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      if (c === ")" && depth === 0) {
        close = i;
        break;
      }
      depth--;
    } else if (c === "," && depth === 0) {
      raw.push({ start: argStart, end: i });
      argStart = i + 1;
    }
    i++;
  }
  if (close === -1) {
    return undefined;
  }
  if (text.slice(argStart, close).trim().length > 0) {
    raw.push({ start: argStart, end: close });
  }
  const args = raw.map(({ start, end }) => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text[s])) {
      s++;
    }
    while (e > s && /\s/.test(text[e - 1])) {
      e--;
    }
    return { start: s, end: e };
  });
  return { args, close };
}

// Escape the snippet-active characters in LITERAL text: `\` and `$` (a bare `}`
// outside a placeholder is literal and safe). renderBlankValue output is already
// valid snippet syntax and is spliced in as-is.
//
// EXPORTED in phase 6 so the seam-driven blanker (five languages) escapes with
// this function rather than a second copy of it. A leg whose blanker forgot to
// escape would turn the human's own `$` and `${` into tabstops, which is the
// contract's "snippet escaping on every new leg" clause.
export function escapeSnippetLiteral(s: string): string {
  return escapeLiteral(s);
}

function escapeLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
}

/**
 * The EXPECTED-VALUE spans in Rust test text: the 2nd top-level argument of each
 * `assert_eq!`/`assert_ne!`, scanned structurally so a macro name inside a
 * string or comment is never matched. Exactly the byte ranges the human must
 * type — getting the argument number wrong would blank the call under test and
 * keep the model's guess, which inverts the blank-value invariant.
 *
 * Lifted out of blankTestModule unchanged so the per-framework seam
 * (TestFramework.expectedValueSpans) and the shipped blanker share one scanner
 * and cannot drift.
 */
export function rustExpectedValueSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const m = /^assert_(?:eq|ne)!\s*\(/.exec(text.slice(i));
    if (m) {
      const open = i + m[0].length - 1; // index of the `(`
      const parsed = topLevelArgs(text, open);
      if (parsed && parsed.args.length >= 2) {
        spans.push(parsed.args[1]); // the expected value
        i = parsed.close + 1;
        continue;
      }
    }
    i++;
  }
  return spans;
}

/**
 * How many `assert_eq!`/`assert_ne!` calls the Rust locator WALKED and could not
 * resolve to an expected-value span: it reached the macro's arguments and found
 * fewer than two top-level ones, so the assertion produced no hole.
 *
 * scraps D5's all-or-nothing floor, spelled for libtest. The consumer refuses
 * the whole pass when this is non-zero, because the OTHER asserts in the module
 * still produce holes and a `holes === 0` check would pass while the model's
 * guessed value shipped into the buffer beside them.
 *
 * Deliberately narrow: it counts the silence this scanner can SEE. An
 * `assert!(f(2) == 4)` carries an expected value the locator never walks at all,
 * and teaching this scanner that shape is the treadmill the floor defers away
 * from; the zero-hole floor still catches a module made only of those.
 */
export function rustUnresolvedAssertions(text: string): number {
  let unresolved = 0;
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const m = /^assert_(?:eq|ne)!\s*\(/.exec(text.slice(i));
    if (m) {
      const open = i + m[0].length - 1;
      const parsed = topLevelArgs(text, open);
      if (parsed !== undefined) {
        if (parsed.args.length < 2) {
          unresolved++;
        }
        i = parsed.close + 1;
        continue;
      }
    }
    i++;
  }
  return unresolved;
}

/**
 * Turn the model's test module into a VS Code snippet whose every
 * `assert_eq!`/`assert_ne!` EXPECTED value (the 2nd top-level macro argument) is
 * a blank tabstop hole the human types. Holes number sequentially across the
 * whole module. All other literal text is snippet-escaped so it inserts verbatim.
 */
export function blankTestModule(
  moduleText: string,
  returnType: string,
  opts?: { structFields?: StructFieldShape[] },
): BlankTestModule {
  const spans = rustExpectedValueSpans(moduleText);

  let snippet = "";
  let cursor = 0;
  let hole = 1;
  for (const span of spans) {
    snippet += escapeLiteral(moduleText.slice(cursor, span.start));
    const bv = renderBlankValue(returnType, { structFields: opts?.structFields, startHole: hole });
    snippet += bv.rhs;
    hole += bv.holes;
    cursor = span.end;
  }
  snippet += escapeLiteral(moduleText.slice(cursor));
  return { snippet, holes: hole - 1 };
}

// Convert a blank-value snippet into readable plain text for a READ-ONLY diff
// preview: snippet metacharacters are unescaped and every tabstop hole becomes a
// placeholder — the hole's own type-hint comment when it has one, else a bare
// `value` comment. So the regen diff shows the test STRUCTURE with the expected
// values still blank; the model's guessed values never appear (the automation-bias
// boundary blankTestModule enforces holds through the preview too).
export function blankSnippetToDisplay(snippet: string): string {
  let out = "";
  let i = 0;
  while (i < snippet.length) {
    const c = snippet[i];
    if (c === "\\" && i + 1 < snippet.length) {
      out += snippet[i + 1]; // unescape \\  \$  \}
      i += 2;
      continue;
    }
    if (c === "$" && snippet[i + 1] === "{") {
      let j = i + 2;
      while (j < snippet.length && /\d/.test(snippet[j])) {
        j++;
      }
      if (snippet[j] === "}") {
        out += "/* value */";
        i = j + 1;
        continue;
      }
      if (snippet[j] === ":") {
        let def = "";
        let k = j + 1;
        while (k < snippet.length && snippet[k] !== "}") {
          if (snippet[k] === "\\" && k + 1 < snippet.length) {
            def += snippet[k + 1]; // an escaped } inside the hint is literal, not the close
            k += 2;
            continue;
          }
          def += snippet[k];
          k++;
        }
        out += def.length > 0 ? def : "/* value */";
        i = k + 1; // past the closing }
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

export interface TestInsertionPlan {
  start: number;
  end: number;
  text: string;
  mode: "new-module" | "extend-existing" | "replace-generated";
}

// The `}` matching the `{` at `open`, skipping literals/comments. -1 if none.
function matchBrace(text: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = text[i];
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

// The brace span of the first `#[cfg(test)] mod <name> { … }` in the file.
function findCfgTestModule(text: string): { open: number; close: number } | undefined {
  const cfg = text.indexOf("#[cfg(test)]");
  if (cfg === -1) {
    return undefined;
  }
  const modM = /mod\s+\w+\s*\{/.exec(text.slice(cfg));
  if (!modM) {
    return undefined;
  }
  const open = cfg + modM.index + modM[0].length - 1;
  const close = matchBrace(text, open);
  return close === -1 ? undefined : { open, close };
}

/** A `mod <name>` head with the delimiter that follows it: `{` opens an inline
 *  module, `;` is a declaration whose body lives in another file.
 *
 *  The `r#` is captured rather than skipped, because libtest KEEPS it: measured
 *  on cargo 1.96, `mod r#match` lists as `r#match::widget_checks::add` and
 *  `--exact match::widget_checks::add` selects zero. Dropping the head left the
 *  brace counted and no segment pushed, which is the silent-zero shape.
 *
 *  Sticky, so the scan below never slices the source to match. */
const MOD_HEAD = /mod\s+(r#)?(\w+)\s*([{;])/y;

function isIdentChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

/**
 * The `mod` chain enclosing `index`, outermost first: the
 * `["geometry", "widget_checks"]` in libtest's `geometry::widget_checks::add`.
 *
 * It exists because `--exact` matches libtest's FULL path and nothing else.
 * Measured on cargo 1.96: `--exact add` against a bare fn name selects ZERO
 * tests, and a hard-coded `tests::` is no fix either — the generated region
 * lands in whatever `#[cfg(test)] mod <name>` the developer already wrote, and
 * `cargo test -- --list` prints an enclosing `mod` as part of the path too.
 *
 * Resolved from the REGION's own position rather than from the first
 * `#[cfg(test)]` in the file: the region is what the filter names, so its
 * enclosing modules are the only ones certain to be on the path.
 *
 * This is the INNER half of the path only. The segment a file contributes by
 * BEING a module is not in the file's own text, and `rustModulePath` is what
 * resolves it. Treating this alone as a full path is what shipped a rung that
 * selected zero on every crate whose code is not in `src/lib.rs`.
 */
export function enclosingModulePath(text: string, index: number): string[] {
  const stack: Array<{ name: string; depth: number }> = [];
  let depth = 0;
  let i = 0;
  const limit = Math.min(index, text.length);
  while (i < limit) {
    const skipped = skipLiteralOrComment(text, i);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = text[i];
    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }
      depth--;
      i++;
      continue;
    }
    if (c === "m" && !isIdentChar(text[i - 1] ?? "")) {
      MOD_HEAD.lastIndex = i;
      const m = MOD_HEAD.exec(text);
      if (m !== null) {
        if (m[3] === "{") {
          depth++;
          stack.push({ name: (m[1] ?? "") + m[2], depth });
        }
        i = MOD_HEAD.lastIndex;
        continue;
      }
    }
    i++;
  }
  return stack.map((e) => e.name);
}

// ===========================================================================
// The segment a FILE contributes, which its own text never states
// ===========================================================================

/** The crate filesystem `rustModulePath` walks, injected so the resolver stays
 *  a function of a filesystem it is handed rather than of the real one. */
export interface CrateFiles {
  readFile(p: string): string | undefined;
  fileExists(p: string): boolean;
}

/** Where the marked region lives, and which crate it lives in. */
export interface RustTestNameContext {
  /** Absolute path of the file holding the marked region. */
  filePath: string;
  /** The crate directory: the one holding Cargo.toml. */
  crateRoot: string;
  files: CrateFiles;
}

/** `#[path = "…"]` moves a module's file. Captured across the whole file up
 *  front, then matched to the `mod` head it precedes. */
const PATH_ATTR = /#\s*\[\s*path\s*=\s*"([^"]*)"\s*\]/g;

/** What may sit between a `#[path]` attribute and the `mod` it applies to:
 *  whitespace and a visibility. Anything else means the attribute belongs to
 *  something other than this module. */
const ATTR_TO_MOD_GAP = /^\s*(?:pub\s*(?:\([^)]*\)\s*)?)?$/;

/** A crate is walked file by file; the cap is a floor under a pathological
 *  tree, not a real limit. Hitting it answers "unresolved", which falls back
 *  to the substring filter. */
const CRATE_WALK_FILE_CAP = 512;

interface ModDecl {
  /** The segment libtest prints, `r#` kept. */
  name: string;
  /** The file stem rustc looks up, `r#` stripped: `mod r#match;` is `match.rs`,
   *  measured on cargo 1.96. */
  fileStem: string;
  /** Inline `mod` names enclosing the declaration, outermost first. Each one is
   *  both a path segment and a directory level. */
  ancestry: string[];
  pathAttr?: string;
}

function pathAttrFor(text: string, modStart: number, attrs: Array<{ end: number; value: string }>): string | undefined {
  for (let k = attrs.length - 1; k >= 0; k--) {
    const attr = attrs[k];
    if (attr.end > modStart) {
      continue;
    }
    return ATTR_TO_MOD_GAP.test(text.slice(attr.end, modStart)) ? attr.value : undefined;
  }
  return undefined;
}

/** Every `mod <name>;` in `text`, each with the inline `mod` chain around it. */
function modDeclarations(text: string): ModDecl[] {
  const attrs: Array<{ end: number; value: string }> = [];
  PATH_ATTR.lastIndex = 0;
  for (let a = PATH_ATTR.exec(text); a !== null; a = PATH_ATTR.exec(text)) {
    attrs.push({ end: a.index + a[0].length, value: a[1] });
  }
  const out: ModDecl[] = [];
  const stack: Array<{ name: string; depth: number }> = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = text[i];
    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }
      depth--;
      i++;
      continue;
    }
    if (c === "m" && !isIdentChar(text[i - 1] ?? "")) {
      MOD_HEAD.lastIndex = i;
      const m = MOD_HEAD.exec(text);
      if (m !== null) {
        const name = (m[1] ?? "") + m[2];
        if (m[3] === "{") {
          depth++;
          stack.push({ name, depth });
        } else {
          out.push({ name, fileStem: m[2], ancestry: stack.map((e) => e.name), pathAttr: pathAttrFor(text, i, attrs) });
        }
        i = MOD_HEAD.lastIndex;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** Where a module's OWN children live: `foo.rs` and `foo/mod.rs` both own the
 *  directory `foo/`. */
function childDirOf(file: string): string {
  const dir = path.dirname(file);
  const base = path.basename(file);
  return base === "mod.rs" ? dir : path.join(dir, base.replace(/\.rs$/, ""));
}

function resolveModFile(baseDir: string, fileDir: string, decl: ModDecl, files: CrateFiles): string | undefined {
  const candidates =
    decl.pathAttr === undefined
      ? [path.join(baseDir, `${decl.fileStem}.rs`), path.join(baseDir, decl.fileStem, "mod.rs")]
      : [path.resolve(baseDir, decl.pathAttr), path.resolve(fileDir, decl.pathAttr)];
  const hit = candidates.find((c) => files.fileExists(c));
  return hit === undefined ? undefined : path.resolve(hit);
}

/** Cargo's default lib target is `src/lib.rs`; a `[lib]` section may move it. */
function libPathFromManifest(manifest: string): string | undefined {
  const section = /^[ \t]*\[lib\][ \t]*$/m.exec(manifest);
  if (section === null) {
    return undefined;
  }
  const rest = manifest.slice(section.index + section[0].length);
  const next = rest.search(/^[ \t]*\[/m);
  const body = next === -1 ? rest : rest.slice(0, next);
  const declared = /^[ \t]*path[ \t]*=[ \t]*"([^"]*)"/m.exec(body);
  return declared === null ? undefined : declared[1];
}

function libTargetOf(crateRoot: string, files: CrateFiles): string | undefined {
  const manifest = files.readFile(path.join(crateRoot, "Cargo.toml"));
  const declared = manifest === undefined ? undefined : libPathFromManifest(manifest);
  const candidate = declared === undefined ? path.join(crateRoot, "src", "lib.rs") : path.resolve(crateRoot, declared);
  return files.fileExists(candidate) ? path.resolve(candidate) : undefined;
}

/**
 * The module path of a FILE inside a crate, outermost first: the `["geometry"]`
 * that makes `src/geometry.rs`'s tests list as `geometry::widget_checks::add`.
 *
 * Rust puts a function's tests in the function's own file, so this is the normal
 * layout and not an edge case. Nothing in the file's text says which module it
 * is; only the crate root's `mod` declarations do. Reading the text alone
 * produced a full-SHAPED path missing its head, `--exact` rode along, and the
 * rung selected ZERO — worse than the substring filter it replaced.
 *
 * Resolved by walking `mod` declarations from the `--lib` target's root file,
 * which is where `cargo test --lib` starts too. `foo.rs`, `foo/mod.rs`,
 * `#[path]` and raw identifiers are all measured against cargo 1.96.
 *
 * undefined means NOT PROVEN, and the caller must then keep the substring
 * filter: a file the walk never reached, a crate with no lib target, or a file
 * two declarations both route to. Over-selecting adds a red the human can read;
 * selecting nothing reads as a passing rung with nothing in it.
 */
export function rustModulePath(ctx: RustTestNameContext): string[] | undefined {
  const target = path.resolve(ctx.filePath);
  const libRoot = libTargetOf(ctx.crateRoot, ctx.files);
  if (libRoot === undefined) {
    return undefined;
  }
  if (libRoot === target) {
    return [];
  }
  const matches: string[][] = [];
  const seen = new Set<string>([libRoot]);
  const queue = [{ file: libRoot, dir: path.dirname(libRoot), modPath: [] as string[] }];
  let read = 0;
  while (queue.length > 0 && read < CRATE_WALK_FILE_CAP) {
    const node = queue.shift() as { file: string; dir: string; modPath: string[] };
    const text = ctx.files.readFile(node.file);
    read++;
    if (text === undefined) {
      continue;
    }
    for (const decl of modDeclarations(text)) {
      const baseDir = path.join(node.dir, ...decl.ancestry);
      const child = resolveModFile(baseDir, node.dir, decl, ctx.files);
      if (child === undefined) {
        continue;
      }
      const modPath = [...node.modPath, ...decl.ancestry, decl.name];
      if (child === target) {
        matches.push(modPath);
        continue;
      }
      if (seen.has(child)) {
        continue;
      }
      seen.add(child);
      queue.push({ file: child, dir: childDirOf(child), modPath });
    }
  }
  // Two routes to one file means two candidate paths and no way to pick; one
  // of them would select zero. Ambiguity falls back like unreachability does.
  return matches.length === 1 ? matches[0] : undefined;
}

// One indent level inside `mod tests { … }`; the generated fns are normalized to
// it so the FIRST line lines up with the rest.
const BODY_INDENT = "    ";

// The `#[test]` fn items inside a generated `mod tests { … }` block, with the
// `use super::*;` line dropped (the destination module already has scope).
// Per-line indentation is PRESERVED here (reindent normalizes it); a `.trim()`
// would strip only the first line's indent and leave `#[test]` at column 0 under
// an indented module. Falls back to the raw input when there is no brace body.
function moduleInnerFns(mod: string): string {
  const braceIdx = mod.indexOf("{");
  if (braceIdx === -1) {
    return mod;
  }
  const close = matchBrace(mod, braceIdx);
  const body = close === -1 ? mod.slice(braceIdx + 1) : mod.slice(braceIdx + 1, close);
  return body
    .split("\n")
    .filter((l) => !/^\s*use\s+super::\*\s*;/.test(l))
    .join("\n");
}

// Normalize a block's indentation: drop leading/trailing blank lines, strip the
// common leading whitespace, then prefix every non-blank line with `indent`. The
// output is indentation-uniform whatever the model emitted, so the whole marked
// region sits at one consistent level. Blank interior lines stay empty.
//
// Exported for the per-language scaffolds: Go's top-level test funcs sit at
// column 0, which is this function with an empty indent.
export function reindent(text: string, indent: string): string {
  const lines = text.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "").split("\n");
  let min = Infinity;
  for (const l of lines) {
    if (l.trim().length === 0) {
      continue;
    }
    const lead = /^[ \t]*/.exec(l)![0].length;
    if (lead < min) {
      min = lead;
    }
  }
  if (!Number.isFinite(min)) {
    min = 0;
  }
  return lines.map((l) => (l.trim().length === 0 ? "" : indent + l.slice(min))).join("\n");
}

/** The begin/end marker comments that fence a function's generated tests. The one
 *  source of the marker format, so planTestInsertion and generatedTestNames cannot
 *  drift — in any language. `prefix` is the language's line-comment token, which
 *  is `//` for four of the five and `#` for Python; Rust's callers pass none and
 *  get the shipped bytes. */
export function testMarkers(markerId: string, prefix = "//"): { begin: string; end: string } {
  const id = markerId || "default";
  return { begin: `${prefix} column80-tests:${id}:begin`, end: `${prefix} column80-tests:${id}:end` };
}

/**
 * The `#[test]` fns previously generated for `markerId` (between its markers) as
 * libtest FILTERS — for scoping the cargo test rung to EXACTLY this function's
 * tests, so a red never blames the whole crate's tests on this implementation.
 * Empty when no marked region exists (no generated tests yet).
 *
 * A name is prefixed with its libtest path (`geometry::widget_checks::add`)
 * only when that path is PROVEN COMPLETE, because `--exact` matches the whole
 * path and nothing less. Completeness has two halves and needs both: the `mod`
 * chain inside the file, and the segment the file itself contributes, which
 * comes from `ctx` and cannot be read out of the text. No `ctx`, an unresolved
 * crate layout, or nothing enclosing the region all yield BARE names, and
 * `buildTestCommand` then keeps the substring filter rather than pairing
 * `--exact` with a name libtest will not match.
 *
 * Full SHAPE is not completeness. Shipping a check that only asked whether the
 * name was colon-separated is what made this rung select zero tests on every
 * crate laid out the normal way.
 */
export function generatedTestNames(fileText: string, markerId: string, ctx?: RustTestNameContext): string[] {
  const { begin, end } = testMarkers(markerId);
  const bi = fileText.indexOf(begin);
  if (bi === -1) {
    return [];
  }
  const ei = fileText.indexOf(end, bi);
  if (ei === -1) {
    return [];
  }
  const region = fileText.slice(bi + begin.length, ei);
  // libtest keeps the `r#` on a raw test name too: `fn r#fn` lists as `r#fn`.
  const bare = [...region.matchAll(/\bfn\s+(r#)?(\w+)/g)].map((m) => (m[1] ?? "") + m[2]);
  const prefix = libtestPathPrefix(fileText, bi, ctx);
  return prefix === undefined ? bare : bare.map((n) => prefix + n);
}

/** The proven part of a libtest path, or undefined when it is not proven. */
function libtestPathPrefix(fileText: string, regionStart: number, ctx?: RustTestNameContext): string | undefined {
  if (ctx === undefined) {
    return undefined;
  }
  const fileSegments = rustModulePath(ctx);
  if (fileSegments === undefined) {
    return undefined;
  }
  const segments = [...fileSegments, ...enclosingModulePath(fileText, regionStart)];
  return segments.length === 0 ? undefined : `${segments.join("::")}::`;
}

/**
 * Decide WHERE the generated tests go, never clobbering the developer's own
 * tests. A distinctive marker makes regeneration idempotent: the marked region
 * always holds ONLY the generated `#[test]` fns, so a regenerate replaces exactly
 * that region whether it lives in a fresh module or was extended into an existing
 * one. Pure; the returned `text` is plain Rust (the caller composes the snippet).
 */
export function planTestInsertion(
  fileText: string,
  generatedModule: string,
  opts?: { markerId?: string },
): TestInsertionPlan {
  const { begin, end } = testMarkers(opts?.markerId ?? "default");
  // Normalized to one indent level so the first `#[test]` lines up with the rest.
  const innerFns = reindent(moduleInnerFns(generatedModule), BODY_INDENT);

  // 1. replace-generated: a prior marked region exists — swap exactly it. The
  //    begin marker inherits the file's existing indent before `start`; the end
  //    marker is a fresh line, so it gets BODY_INDENT like the fns.
  const bi = fileText.indexOf(begin);
  if (bi !== -1) {
    const eMark = fileText.indexOf(end, bi);
    if (eMark !== -1) {
      return {
        start: bi,
        end: eMark + end.length,
        mode: "replace-generated",
        text: `${begin}\n${innerFns}\n${BODY_INDENT}${end}`,
      };
    }
  }

  // 2. extend-existing: an existing #[cfg(test)] mod tests — insert the fns
  //    (marker-wrapped, no second module, no duplicate use) before its `}`.
  const mod = findCfgTestModule(fileText);
  if (mod) {
    return {
      start: mod.close,
      end: mod.close,
      mode: "extend-existing",
      text: `${BODY_INDENT}${begin}\n${innerFns}\n${BODY_INDENT}${end}\n`,
    };
  }

  // 3. new-module: append a fresh module wrapping the marked fns.
  return {
    start: fileText.length,
    end: fileText.length,
    mode: "new-module",
    text: `\n#[cfg(test)]\nmod tests {\n${BODY_INDENT}use super::*;\n${BODY_INDENT}${begin}\n${innerFns}\n${BODY_INDENT}${end}\n}\n`,
  };
}
