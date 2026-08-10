/**
 * The comment rules: the ghost never introduces a comment, and inside a comment
 * there is no ghost at all.
 *
 * The second one is argued on identity, not on a number. A doc comment is the
 * developer's spec, and a model writing the spec is the one thing the manifesto
 * forbids outright. The measurement behind it (7 of 189 in-comment ghosts
 * continued the real prose, all 7 in Python, 34% ran out of the comment into
 * code) is why it is cheap, not why it exists; a rule argued on a number
 * reopens when the number moves.
 *
 * The first one is a survivor. 189 of 749 ghosts introduce a comment and 174 of
 * those introductions sit past line 1, so the plain-continuation bound already
 * removes 92% of the population. What is left is 5 comment-led lines and 10
 * trailing comments, and Python carries most of it: 11 of 60 there against 3 of
 * 113 in the brace languages, five times denser.
 *
 * Why a table here rather than either of the two that already exist.
 * `maskSpans` (`fimInject.ts`) hardcodes `#` as a comment opener in EVERY
 * language, so under it the cut would eat a Rust `#[derive]`, a C# `#region`
 * and a TypeScript private `#field` - 1 line in 449 ghosts, small enough that
 * the answer is to build it right rather than price it as a feature.
 * `lineCommentFor` is `languageId === "python" ? "#" : "//"`; under it the
 * rules are silently dead for Ruby, shell, YAML, Perl, R, Elixir, PowerShell,
 * TOML, Lua, SQL, Haskell and Clojure. Reaching for it swaps one
 * language-blind table for another.
 *
 * This table is NOT the list of languages FIM serves, and reading it as one
 * would undo the v29 gate. That list is `fimLanguages.ts`, it is the five the
 * product has an oracle or extractor for, and the provider consults it before
 * this file is reached. The rows below stay wide because
 * `column80.fimLanguages` can point FIM at any of them.
 *
 * An unmapped languageId returns `undefined`, the rules do not run, and the
 * provider says so once on the channel rather than guessing.
 *
 * Pure: no vscode, no clock, no I/O.
 */

import { endOfLiteral, opensLineComment } from "./brackets";
import { TS_LANGUAGE_IDS } from "./tsExtraction";

export interface CommentSyntax {
  /** Line-comment openers, longest first so `///` is tried before `//`. */
  readonly line: readonly string[];
  /** Block-comment delimiter pairs, e.g. ["/*", "*\/"]. */
  readonly block: readonly (readonly [string, string])[];
  /** Prose literals that open a body and are comments for these rules:
   *  Python's `"""` and `'''`. Empty for every other row. */
  readonly doc: readonly string[];
  /** String/char delimiters the scanners must skip so a `//` inside a literal
   *  is not read as a comment. Rust's `'` is a lifetime tick, not a quote. */
  readonly quotes: readonly string[];
}

// The blank `block` and `doc` columns below are literal. Lua's `--[[ ]]` and
// Ruby's `=begin` are real syntax and get no row in v25: the rules are a
// courtesy in those languages and load-bearing in the five that ship, so
// widening the table is a contract change rather than an implementation
// liberty.
const C_BLOCK: readonly (readonly [string, string])[] = [["/*", "*/"]];
const NO_BLOCK: readonly (readonly [string, string])[] = [];
const NO_DOC: readonly string[] = [];

// Rust's `///` and `//!` need no rows: `//` subsumes them, and so does C#'s
// `///`. `'` is absent from the quote set because in Rust it is a lifetime tick
// far more often than a char literal, and skipping from one would swallow the
// rest of the line.
const RUST: CommentSyntax = { line: ["//"], block: C_BLOCK, doc: NO_DOC, quotes: ['"'] };
const TS: CommentSyntax = { line: ["//"], block: C_BLOCK, doc: NO_DOC, quotes: ['"', "'", "`"] };
const CSHARP: CommentSyntax = { line: ["//"], block: C_BLOCK, doc: NO_DOC, quotes: ['"', "'"] };
const GO: CommentSyntax = { line: ["//"], block: C_BLOCK, doc: NO_DOC, quotes: ['"', "'", "`"] };
const C_FAMILY: CommentSyntax = { line: ["//"], block: C_BLOCK, doc: NO_DOC, quotes: ['"', "'"] };
// Python needs its own row twice over: `#` is the line token, and `"""`/`'''`
// opening a body is invented prose by the same argument that makes a `#` line
// one - 16 of 30 Python empty-body ghosts open with a docstring. The shebang
// `#!` is a comment, and that is correct.
const PYTHON: CommentSyntax = { line: ["#"], block: NO_BLOCK, doc: ['"""', "'''"], quotes: ['"', "'"] };
const HASH: CommentSyntax = { line: ["#"], block: NO_BLOCK, doc: NO_DOC, quotes: ['"', "'"] };
const DASH: CommentSyntax = { line: ["--"], block: NO_BLOCK, doc: NO_DOC, quotes: ['"', "'"] };
// Haskell's prime (`xs'`) and Ada's attribute tick (`Foo'Length`) are the same
// trap as Rust's lifetime. Dropping `'` from the quote set costs a missed
// comment inside a char literal, which is a serve; keeping it costs a scan that
// swallows the rest of the line, which is also a serve. The first is the one
// that stays right when the line has no tick at all.
const TICK_DASH: CommentSyntax = { line: ["--"], block: NO_BLOCK, doc: NO_DOC, quotes: ['"'] };
// `'` in the Lisps is quote/quasiquote, never a string delimiter.
const SEMI: CommentSyntax = { line: [";"], block: NO_BLOCK, doc: NO_DOC, quotes: ['"'] };

// The table, one row per shared syntax. Kept as ids-to-row so the file reads
// the way the contract's table does.
const ROWS: readonly (readonly [readonly string[], CommentSyntax])[] = [
  [["rust"], RUST],
  [["csharp"], CSHARP],
  [["go"], GO],
  [["c", "cpp", "java", "kotlin", "swift", "scala", "php", "dart"], C_FAMILY],
  [["python"], PYTHON],
  [
    ["ruby", "shellscript", "bash", "yaml", "perl", "r", "elixir", "powershell", "toml", "makefile", "dockerfile"],
    HASH,
  ],
  [["lua", "sql", "elm"], DASH],
  [["haskell", "ada"], TICK_DASH],
  [["clojure", "lisp", "scheme", "racket"], SEMI],
];

const SYNTAX_BY_LANGUAGE = new Map<string, CommentSyntax>(
  ROWS.flatMap(([ids, syntax]) => ids.map((id): [string, CommentSyntax] => [id, syntax])),
);

/** The language's comment syntax, or `undefined` where the rules do not run.
 *  The TypeScript family comes from the existing `TS_LANGUAGE_IDS` rather than
 *  a second list of the same four ids. */
export function commentSyntaxFor(languageId: string): CommentSyntax | undefined {
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return TS;
  }
  return SYNTAX_BY_LANGUAGE.get(languageId);
}

export type CommentCut = "none" | "led" | "trailing";

export type InCommentKind = "line" | "block" | "doc";

/** How far back `cursorInComment` reads. `maskSpans` allocates a
 *  document-sized array and this runs per keystroke, so the scan is bounded and
 *  what it could not see is reported rather than assumed. */
export const COMMENT_SCAN_CHARS = 4000;

/** How much of the prefix a CALLER needs to read before asking the question.
 *
 *  The scan windows itself, so a caller that hands over the whole document is
 *  paying to materialise text the scan will drop, on every keystroke, before a
 *  refusal that needs none of it. What is measured is the copy: forcing a flat
 *  string of the prefix and suffix costs 6.5us at 14KB and 896us at 1.4MB in
 *  V8, and `getText` builds a real string out of the editor's piece tree rather
 *  than a view. What is NOT measured is that copy inside the running editor, so
 *  read the saving as the work removed, not as a latency number.
 *  `acme_shard/src/shard_wal.rs` is 553KB.
 *
 *  Wider than the scan window on purpose. At exactly the window the two would
 *  agree, but a caller reading precisely as much as the scan keeps leaves no
 *  room for the scan's own line-start alignment, and a bound that has to be
 *  exact is a bound that breaks silently when either number moves. */
export const COMMENT_PREFIX_CHARS = COMMENT_SCAN_CHARS * 2;

export interface CommentHit {
  /** Offset of the opener. */
  index: number;
  kind: InCommentKind;
  /** Only whitespace precedes the opener on its own line. */
  led: boolean;
  /** Offset just past the terminator, or the end of the text when it never
   *  terminates. */
  end: number;
  /** The comment closed inside the text handed in. */
  closed: boolean;
}

// The one scanner the comment rules run on, and the scaffold harvest with them.
// It answers "where does the first comment start, at or after `from`", skipping
// string and char literals so `let s = "// not a comment";` is code.
// `endOfLiteral` is `brackets`'s, not a second copy: a language whose quote
// rules are wrong should be wrong in one place.
//
// Order is load-bearing. A doc opener is tested before the quote that starts
// it, or Python's `"""` reads as an empty string followed by another string.
// And a doc opener only counts as a COMMENT at the start of a content line:
// `x = """a # b"""` is a string literal, and treating it as prose would cut on
// the `#` inside it.
export function nextComment(text: string, syntax: CommentSyntax, from: number): CommentHit | undefined {
  let i = from;
  while (i < text.length) {
    const doc = openerAt(text, i, syntax.doc);
    if (doc !== undefined) {
      const close = text.indexOf(doc, i + doc.length);
      const end = close < 0 ? text.length : close + doc.length;
      if (ledAt(text, i)) {
        return { index: i, kind: "doc", led: true, end, closed: close >= 0 };
      }
      i = end;
      continue;
    }
    // `opensLineComment` is `brackets`'s, for the reason `endOfLiteral` is: a
    // `//` this scanner calls a comment and the bracket scan does not (or the
    // other way round) is two modules disagreeing about the same character.
    const line = openerAt(text, i, syntax.line);
    if (line !== undefined && opensLineComment(text, i, line)) {
      const nl = text.indexOf("\n", i);
      return {
        index: i,
        kind: "line",
        led: ledAt(text, i),
        end: nl < 0 ? text.length : nl + 1,
        closed: nl >= 0,
      };
    }
    const block = syntax.block.find((pair) => text.startsWith(pair[0], i));
    if (block !== undefined) {
      const close = text.indexOf(block[1], i + block[0].length);
      return {
        index: i,
        kind: "block",
        led: ledAt(text, i),
        end: close < 0 ? text.length : close + block[1].length,
        closed: close >= 0,
      };
    }
    if (syntax.quotes.includes(text[i])) {
      i = endOfLiteral(text, i) + 1;
      continue;
    }
    i++;
  }
  return undefined;
}

function openerAt(text: string, at: number, openers: readonly string[]): string | undefined {
  return openers.find((opener) => text.startsWith(opener, at));
}

function ledAt(text: string, at: number): boolean {
  return text.slice(text.lastIndexOf("\n", at - 1) + 1, at).trim() === "";
}

/** The served text with any INTRODUCED comment removed.
 *
 *  A comment-LED line cuts the ghost before that line, which at the first
 *  content line means serving nothing. A TRAILING comment cuts the opener and
 *  everything after it, keeping the code on that line. A block opener counts
 *  exactly as a line opener does: the rule is that the ghost never introduces a
 *  comment, and a block comment is a comment.
 *
 *  Both cuts `trimEnd`, so a caller never has to ask which one it got. */
export function cutIntroducedComment(
  text: string,
  syntax: CommentSyntax,
): { text: string; cut: CommentCut } {
  const hit = nextComment(text, syntax, 0);
  if (hit === undefined) {
    return { text, cut: "none" };
  }
  if (hit.led) {
    return { text: text.slice(0, text.lastIndexOf("\n", hit.index - 1) + 1).trimEnd(), cut: "led" };
  }
  return { text: text.slice(0, hit.index).trimEnd(), cut: "trailing" };
}

/** Whether the cursor sits inside a comment, judged from the prefix.
 *
 *  The cost to control is FALSE POSITIVES: going dark on real code is worse
 *  than every ghost this removes. So the scan is bounded, a line comment is
 *  decided on the cursor's own line alone and is never ambiguous, and the one
 *  genuinely ambiguous case - a block comment or docstring opened ABOVE the
 *  window - answers `inComment: false` with `windowExhausted: true`. Biasing
 *  toward serving is the deliberate choice; the other bias goes dark on real
 *  code. */
export function cursorInComment(
  prefix: string,
  syntax: CommentSyntax,
): { inComment: boolean; kind?: InCommentKind; windowExhausted: boolean } {
  // Only a multi-line construct can reach across the window's edge. A language
  // with neither a block nor a doc row can never be ambiguous from truncation,
  // so it never reports exhaustion it does not have.
  const spansLines = syntax.block.length > 0 || syntax.doc.length > 0;
  const truncated = prefix.length > COMMENT_SCAN_CHARS;
  let window = prefix;
  if (truncated) {
    window = prefix.slice(-COMMENT_SCAN_CHARS);
    const nl = window.indexOf("\n");
    if (nl < 0) {
      // One line longer than the whole window. There is no line start to scan
      // from, so every led/trailing judgement below would be taken against a
      // fragment - and a fragment that opens mid-literal reads a `//` inside a
      // string as a comment. Refuse to answer rather than answer wrong in the
      // dark direction.
      return { inComment: false, windowExhausted: true };
    }
    // Start at a real line start, not wherever the slice landed.
    window = window.slice(nl + 1);
  }
  let i = 0;
  for (;;) {
    const hit = nextComment(window, syntax, i);
    if (hit === undefined) {
      return { inComment: false, windowExhausted: truncated && spansLines };
    }
    if (!hit.closed) {
      // The comment runs to the end of the prefix, which is where the cursor
      // is. Definite, so the window's edge is not in question.
      return { inComment: true, kind: hit.kind, windowExhausted: false };
    }
    i = hit.end;
  }
}
