/**
 * Cursor to the block of prose `Column 80: Tighten Doc Comment` is allowed to touch, and
 * nothing wider.
 *
 * The command exists because a mic emits a stream and the editor drops it where the cursor
 * was, so a dictated doc comment arrives as ONE line. What this file answers is the question
 * that has to be answered before a single character moves: which lines are the comment, what
 * column does it sit at, what opener does it use, and what are the words with the markers
 * taken off.
 *
 * Three shapes are accepted and everything else refuses. A refusal is a serve the developer
 * retries; re-wrapping a line of code is a corruption they cannot undo, so the naked-prose gate
 * below is deliberately mean, and the adversarial review made it meaner.
 *
 * Two things this file will not do again, both of them found by review rather than by reasoning:
 *
 * - It does NOT decide where a comment is by matching text. `scanDocument` decides, because it
 *   skips string literals, and a raw `startsWith` per line re-flowed the inside of a TypeScript
 *   template literal and CHANGED THE STRING'S VALUE. That scan owns its walk rather than
 *   delegating, because a shared scanner that does not know a Rust char literal went dark on
 *   two thirds of a real file.
 * - It does NOT treat every comment-led line as prose. A `//go:build` constraint, a `///
 *   <reference/>` and a `# pylint:` pragma are instructions to a toolchain. Adding the opener's
 *   space to one deletes it silently, and merging two leaves at most one alive.
 *
 * The opener itself is never hand-rolled. `commentSyntaxFor` owns the table and this file reads
 * it. The one thing the table does not carry is the DOC convention (Rust and C# double the
 * opener's last slash), so that delta is stated once, here, as a delta.
 *
 * Pure: no vscode, no clock, no I/O, and it never throws. Malformed input is a refusal sentence.
 */

import { endOfLiteral, opensLineComment } from "./brackets";
import { CommentSyntax, commentSyntaxFor } from "./fimComment";
import { TS_LANGUAGE_IDS } from "./tsExtraction";

/** The column the product is named for. */
export const TIGHTEN_COLUMN = 80;

/** Columns a tab occupies when the render measures width. */
export const TIGHTEN_TAB_WIDTH = 4;

export interface TightenTarget {
  /** The whole document text. */
  text: string;
  languageId: string;
  /** UTF-16 offset of the cursor into `text`. */
  cursor: number;
  /** Columns a tab occupies when measuring width. Default TIGHTEN_TAB_WIDTH. */
  tabWidth?: number;
}

export type TightenRegionKind = "line-comment" | "docstring" | "prose";

export interface TightenRegion {
  kind: TightenRegionKind;
  /** UTF-16 offsets of the text this render replaces. Line-granular: `start` is at a line
   *  start, `end` is just past the last line's newline (or at end of text). */
  start: number;
  end: number;
  /** The column the rendered block sits at, verbatim (spaces or tabs as the file has them). */
  indent: string;
  /** The comment opener plus one space, e.g. "/// ", "// ", "# ". Empty for a docstring. */
  prefix: string;
  /** The words, markers and indentation stripped. Paragraph breaks in the source survive as
   *  a blank line ("\n\n"); every other newline inside a paragraph becomes a single space.
   *
   *  A fence line, an indented code block, a table row, a link reference definition, a
   *  directive, a list line and a heading line each keep their own newline: the render treats
   *  each as its own unit, and joining them here would destroy the structure before the wrapper
   *  ever saw it. */
  prose: string;
  /** The docstring delimiter, `"""` or `'''`, verbatim. Only for kind "docstring". */
  quote?: string;
  /** Whether the replaced span ended with a newline. Beyond the contract's field list on
   *  purpose: `renderRegion` is handed a region and no text, so without this it cannot know
   *  whether the last line of the file carried a terminator. Absent means yes, which is the
   *  shape every region but a final unterminated line has. */
  endsWithNewline?: boolean;
  /** The line ending the replaced span used. Here for the same reason `endsWithNewline` is: a
   *  caller holding only the contract's facade calls `renderRegion` directly, and a region that
   *  does not carry its own terminator drops an LF block into the middle of a CRLF file.
   *  Absent means "\n". */
  lineEnding?: "\n" | "\r\n";
}

export type TightenRegionResult =
  | { ok: true; region: TightenRegion }
  | { ok: false; refusal: string };

/**
 * The whitespace this command may move: space, tab, CR and LF, and nothing else.
 *
 * `\s` is wrong here and quietly rewrites the human's words. A non-breaking space and an
 * ideographic space are CHARACTERS the developer said, not layout, and a tokenizer that splits
 * on them puts ASCII spaces back in their place. Standing rule 1 says the words are the
 * human's, so every other whitespace character is part of the token beside it.
 *
 * Worse than the bug was the instrument: ship condition 1's oracle stripped `\s` from both
 * sides, so the substitution was invisible to the one test built to catch exactly this class.
 */
const WS_RUN = /[ \t\r\n]+/;
const WS_LEAD = /^[ \t\r\n]+/;
const WS_TAIL = /[ \t\r\n]+$/;

/** `String.prototype.trim` under the fold above. */
export function tightenTrim(text: string): string {
  return text.replace(WS_LEAD, "").replace(WS_TAIL, "");
}

/** `trimEnd` under the fold above. */
export function tightenTrimEnd(text: string): string {
  return text.replace(WS_TAIL, "");
}

/** Whitespace-separated words under the fold above. */
export function tightenWords(text: string): string[] {
  return text.split(WS_RUN).filter((word) => word !== "");
}

/** Columns a string occupies, a tab counting `tabWidth`. Code POINTS, not code units: a
 *  surrogate pair is one glyph and counting it twice would wrap a line early. */
export function tightenWidth(text: string, tabWidth: number): number {
  let columns = 0;
  for (const ch of text) {
    columns += ch === "\t" ? tabWidth : 1;
  }
  return columns;
}

export function tightenTabWidth(tabWidth: number | undefined): number {
  return typeof tabWidth === "number" && Number.isFinite(tabWidth) && tabWidth > 0
    ? Math.floor(tabWidth)
    : TIGHTEN_TAB_WIDTH;
}

/** The five the product has an extractor and an oracle for. Not `fimLanguages`: this is a
 *  manual command over prose, and widening it is a contract change rather than a config. */
const SERVED_LANGUAGE_IDS = new Set(["rust", "csharp", "go", "python"]);

/** The two languages whose DOC comment doubles the table's last slash. `commentSyntaxFor`
 *  carries `//` for both and is right to: `///` is a documentation convention layered on the
 *  line opener, not a second comment syntax, and Go and TypeScript layer nothing. */
const DOC_SLASH_LANGUAGE_IDS = new Set(["rust", "csharp"]);

export function servesTighten(languageId: string): boolean {
  return SERVED_LANGUAGE_IDS.has(languageId) || TS_LANGUAGE_IDS.has(languageId);
}

/** The opener a NAKED prose line is turned into a comment with, opener plus one space.
 *  Only used for kind "prose": an existing comment block keeps whatever opener the developer
 *  already typed, `//!` included. */
export function docPrefixFor(languageId: string): string | undefined {
  if (!servesTighten(languageId)) {
    return undefined;
  }
  const syntax = commentSyntaxFor(languageId);
  const opener = syntax?.line[0];
  if (opener === undefined) {
    return undefined;
  }
  return `${DOC_SLASH_LANGUAGE_IDS.has(languageId) ? `${opener}/` : opener} `;
}

// ---------------------------------------------------------------- directives

/**
 * A comment line that is an INSTRUCTION TO A TOOLCHAIN, not prose.
 *
 * `//go:build linux` re-flowed as `// go:build linux` is an ordinary comment: the build
 * constraint is gone and the file now compiles on every platform with nothing to warn you. The
 * legacy `// +build` pair merged onto one line dies the same way, so does a second
 * `/// <reference/>`, so does a second `# pylint: disable`, and a shebang gains a space and
 * stops being a shebang.
 *
 * A directive is emitted VERBATIM and is never merged with a neighbour. It keeps whatever
 * spacing it had, which is why the parse hands the render the text after the opener with no
 * space stripped: `//go:build` has none to strip and `// +build` must not lose the one it has.
 *
 * Matched on the TRIMMED text so the parse and the render agree whether or not a space was
 * taken off. That makes the Python arm position-free, where the review's rule said "a
 * first-line `#!`": a `#!` anywhere reads as a directive here. That is the safe direction,
 * because the only consequence is a line left exactly as the human typed it, and a
 * position-dependent rule would have the parse and the render disagree on press two.
 *
 * Rust and C# have no row. `#[derive]` is not a comment, `#region` is C's preprocessor and
 * neither reaches a comment-led line. The absence is deliberate, not an omission.
 */
const DIRECTIVE_BY_LANGUAGE: readonly (readonly [ReadonlySet<string>, RegExp])[] = [
  // `nolint` and the cgo `export` are as space-sensitive as `go:`: golangci-lint ignores
  // `// nolint:errcheck` and cgo ignores `// export Name`. Both are shaped tightly so an
  // ordinary Go comment opening with the word "export" is still prose.
  [new Set(["go"]), /^(?:go:|\+build\b|nolint(?::|$)|export[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*$)/],
  [TS_LANGUAGE_IDS, /^<(?:reference\b|amd-)/],
  [new Set(["python"]), /^(?:!|type:|pylint:|noqa|mypy:|fmt:|isort:)/],
];

export function tightenIsDirective(languageId: string, content: string): boolean {
  const trimmed = tightenTrim(content);
  if (trimmed === "") {
    return false;
  }
  return DIRECTIVE_BY_LANGUAGE.some(([ids, pattern]) => ids.has(languageId) && pattern.test(trimmed));
}

/**
 * Words a paragraph runs to before the next sentence boundary closes it.
 *
 * A JUDGMENT CALL, anchored on the scout's measured 46 words between breaks in round 2 - the
 * spec that made a 30B produce correct linear code - against 60 in written Rust doc comments
 * and 94 in dictation. It is NOT a measurement of this product: nobody has run "does breaking
 * a long comment change what a model generates". `docs/constants.md` carries the row saying
 * exactly that.
 */
export const TIGHTEN_PARAGRAPH_WORDS = 50;

/**
 * Prose to tokens, where a BACKTICKED SPAN IS ONE TOKEN however many spaces it holds.
 *
 * The span glues to whatever punctuation is welded to it, so `` (`Vec<T, A>`) `` survives as
 * one token and comes out on one line with its brackets. A backtick with no partner is an
 * ordinary character: an unmatched tick must not swallow the rest of the paragraph into a
 * single unwrappable token.
 *
 * Splits on ASCII whitespace only. A non-breaking space is a character the human said, so it
 * stays inside the token beside it rather than being replaced by a plain space on the way out.
 */
export function tightenTokens(prose: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const blank = (ch: string) => ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
  while (i < prose.length) {
    if (blank(prose[i])) {
      i++;
      continue;
    }
    const start = i;
    let open = false;
    while (i < prose.length && (open || !blank(prose[i]))) {
      if (prose[i] === "`") {
        open = open ? false : prose.indexOf("`", i + 1) >= 0;
      }
      i++;
    }
    tokens.push(prose.slice(start, i));
  }
  return tokens;
}

/**
 * Greedy fill. A token joins the line when the line's width plus one plus the token's width is
 * within budget, and the FIRST token of a line always joins: a token wider than the whole
 * budget overflows its own line rather than being cut in half.
 */
export function wrapTokens(
  tokens: readonly string[],
  budget: number,
  firstIndent: string,
  contIndent: string,
  tabWidth: number,
): string[] {
  if (tokens.length === 0) {
    return [firstIndent];
  }
  const lines: string[] = [];
  let line = firstIndent;
  let columns = tightenWidth(firstIndent, tabWidth);
  let filled = false;
  for (const token of tokens) {
    const w = tightenWidth(token, tabWidth);
    if (!filled) {
      line += token;
      columns += w;
      filled = true;
      continue;
    }
    if (columns + 1 + w <= budget) {
      line += ` ${token}`;
      columns += 1 + w;
      continue;
    }
    lines.push(line);
    line = contIndent + token;
    columns = tightenWidth(contIndent, tabWidth) + w;
  }
  lines.push(line);
  return lines;
}

/**
 * One ordinary unit to its paragraphs.
 *
 * Prefix-greedy over sentences, which is the property that makes the second press a no-op: a
 * paragraph this function produced closed at the first sentence that carried it to the cap, so
 * re-running it on that paragraph alone finds the same close at the same place and returns it
 * whole. A paragraph that arrived already broken is never merged with its neighbour, because
 * the neighbour is a different unit and this never sees the two together.
 */
export function tightenParagraphs(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])[ \t\r\n]+/).filter((sentence) => sentence !== "");
  const paragraphs: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    current.push(sentence);
    words += tightenWords(sentence).length;
    if (words >= TIGHTEN_PARAGRAPH_WORDS) {
      paragraphs.push(current.join(" "));
      current = [];
      words = 0;
    }
  }
  if (current.length > 0) {
    paragraphs.push(current.join(" "));
  }
  return paragraphs;
}

// ---------------------------------------------------------------- structure

/** A markdown list marker or an ATX heading, matched on the TRIMMED content of a line.
 *
 *  The `(?=\s|$)` is what keeps a sentence out: "1.5x faster" and "#hashtag" are prose, and
 *  admitting them would indent the rest of the paragraph under a marker that is not one. */
const LIST_OR_HEADING = /^(?:[-*+]|\d+\.|#{1,6})(?=[ \t]|$)[ \t]*/;

/** A markdown table row. The interior alignment is the whole point of a table, so the line is
 *  emitted verbatim rather than re-flowed. */
const TABLE_ROW = /^\|.*\|$/;

/** A markdown link reference definition. Common in Rust doc comments, and merging two of them
 *  stops the second from being a definition at all. */
const LINK_REFERENCE = /^\[[^\]]+\]:[ \t]/;

/** Four leading spaces, or a tab, is markdown for a code block. Counted in CHARACTERS rather
 *  than columns so the parse and the render cannot disagree about it through a `tabWidth` the
 *  caller passed to one and not the other. */
const INDENTED_CODE = /^(?: {4,}|\t)/;

/** A fence delimiter, matched on the trimmed content of a line. Shared with the render so
 *  the thing that PRESERVES a fence and the thing that re-reads it agree on where one is. */
export function tightenOpensFence(trimmed: string): boolean {
  return trimmed.startsWith("```");
}

/** The list or heading marker a trimmed line opens with, including its trailing whitespace,
 *  or undefined for ordinary prose. Shared with the render for the same reason. */
export function tightenListMarker(trimmed: string): string | undefined {
  return LIST_OR_HEADING.exec(trimmed)?.[0];
}

/**
 * The kinds of prose line that are their OWN unit and are emitted verbatim. A caller that wraps
 * one of these destroys the thing it is for.
 *
 * A LINK REFERENCE DEFINITION is on this list rather than merely being its own wrapped unit, and
 * that is defect 1 of the second round. `[spec]: <url>` wider than the budget wrapped to
 * `[spec]:` on one line and the URL on the next, and `[spec]:` alone is no longer a definition:
 * on press two it was ordinary prose and the paragraph above absorbed it. 6,663 of the 31,151
 * link reference definitions in this box's crates.io cache are already wider than 76 columns. A
 * definition split over two lines is not a definition, so it is unsplittable, and ship condition
 * 2 names it with the other verbatim shapes.
 */
export function tightenVerbatimLine(line: string): boolean {
  const trimmed = tightenTrim(line);
  return trimmed !== "" && (INDENTED_CODE.test(line) || TABLE_ROW.test(trimmed) || LINK_REFERENCE.test(trimmed));
}

function refuse(refusal: string): TightenRegionResult {
  return { ok: false, refusal };
}

/** The start of the line `offset` sits on.
 *
 *  The `offset <= 0` arm is not a tidy-up. `lastIndexOf` CLAMPS a negative `fromIndex` to 0, so
 *  on a document whose first character is a newline the naive expression answers 1 rather than
 *  0. The upward block walk then sets `start = prev` with `prev === start` and never terminates,
 *  growing an array every turn: a wedged extension host on a file that merely opens with a blank
 *  line. The same clamp also made a cursor at offset 0 resolve the line BELOW a blank first line. */
function lineStartAt(text: string, offset: number): number {
  return offset <= 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1;
}

/** Just past the line's newline, or the end of the text when the last line has none. */
function lineEndAt(text: string, offset: number): number {
  const nl = text.indexOf("\n", offset);
  return nl < 0 ? text.length : nl + 1;
}

function lineAt(text: string, start: number): string {
  return text.slice(start, lineEndAt(text, start)).replace(/\r?\n$/, "");
}

// ---------------------------------------------------------------- the scan

interface DocRun {
  index: number;
  end: number;
  closed: boolean;
}

interface DocumentScan {
  /** Offsets of the openers that are really comment-LED line comments. A line whose first
   *  non-blank character is not in here only LOOKS like a comment. */
  ledLineComments: ReadonlySet<number>;
  /** Triple-quoted runs that open a content line: Python's docstrings. */
  docRuns: readonly DocRun[];
  /** The string, char, regex and non-led docstring runs the walk steps over. */
  literals: readonly (readonly [number, number])[];
}

/** Only whitespace precedes `at` on its own line. `fimComment`'s rule, which is not exported. */
function ledAt(text: string, at: number): boolean {
  return tightenTrim(text.slice(text.lastIndexOf("\n", at - 1) + 1, at)) === "";
}

/**
 * A Rust char literal, anchored. EXACTLY one character or one escape between the ticks, which is
 * what keeps a lifetime out: `'a>(x: &'a str)` holds two ticks with a whole parameter list
 * between them and does not match.
 *
 * It has a row here because `commentSyntaxFor`'s Rust row leaves `'` out of the quote set (a
 * lifetime tick is far commoner than a char literal, and skipping from one swallows the rest of
 * the line). The consequence is that `s.find('"')` opens a phantom string on the `"` inside the
 * char literal, and that phantom ate 19 of 27 comment lines in one real file.
 */
const RUST_CHAR_LITERAL = /'(?:[^'\\\n]|\\(?:u\{[0-9a-fA-F]{1,6}\}|.))'/y;

/** Words after which a `/` opens a REGEX rather than a division. `return` is on the list because
 *  `return /^["'`)\]}]+[;,]?$/.test(s);` is the line that killed 69 of 95 comment lines in this
 *  product's own `src/core/postprocess.ts`. */
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do",
  "else", "yield", "await",
]);

/** Whether a `/` at `at` opens a regex literal. A `/` after an identifier, a number or a closing
 *  bracket is division; after an operator, a keyword or a line start it is a regex. */
function regexCanStart(text: string, at: number): boolean {
  let k = at - 1;
  while (k >= 0 && (text[k] === " " || text[k] === "\t")) {
    k--;
  }
  if (k < 0 || text[k] === "\n") {
    return true;
  }
  if (!/[A-Za-z0-9_$)\]]/.test(text[k])) {
    return true;
  }
  let w = k;
  while (w >= 0 && /[A-Za-z_$]/.test(text[w])) {
    w--;
  }
  return REGEX_KEYWORDS.has(text.slice(w + 1, k + 1));
}

/**
 * Just past a JS/TS template literal opening at `at`.
 *
 * `endOfLiteral` scans for the next unescaped delimiter, which is right for every quote but a
 * backtick. A template's `${ ... }` can hold ANOTHER template, and this repo writes one:
 * `` `... ${x ? "" : ` and the \`${y}.\` qualifier`}` ``. The inner opener closed the outer
 * literal, the rest of the file paired up wrong, and 15 comment lines below it went dark. So a
 * substitution is walked with brace depth, and a template inside one recurses.
 */
function templateEnd(text: string, at: number): number {
  let j = at + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "`") {
      return j + 1;
    }
    if (c === "$" && text[j + 1] === "{") {
      j = substitutionEnd(text, j + 2);
      continue;
    }
    j++;
  }
  return text.length;
}

/** Just past the `}` closing a `${` substitution, with its own nested strings skipped. */
function substitutionEnd(text: string, from: number): number {
  let depth = 1;
  let j = from;
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "`") {
      j = Math.max(templateEnd(text, j), j + 1);
      continue;
    }
    if (c === '"' || c === "'") {
      j = Math.max(endOfLiteral(text, j) + 1, j + 1);
      continue;
    }
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    }
    j++;
  }
  return j;
}

/** Just past a JS/TS regex literal opening at `at`, or undefined. A regex never spans a line, and
 *  a `/` inside a character class does not close it. */
function tsRegexEnd(text: string, at: number): number | undefined {
  let j = at + 1;
  let inClass = false;
  while (j < text.length) {
    const c = text[j];
    if (c === "\n") {
      return undefined;
    }
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "[") {
      inClass = true;
    } else if (c === "]") {
      inClass = false;
    } else if (c === "/" && !inClass) {
      return j + 1;
    }
    j++;
  }
  return undefined;
}

/**
 * Where the comments are, and where the literals are, in ONE forward walk.
 *
 * This is `nextComment`'s algorithm and precedence (a doc opener before the quote that starts it,
 * then a line opener via `opensLineComment`, then a block opener, then a quote via
 * `endOfLiteral`), with three things the shared table cannot express. It is not a second opinion
 * about a character: both primitives are `brackets`'s, so this and the bracket scan cannot
 * disagree about where a literal ends.
 *
 * It owns the walk rather than delegating because the first round made `nextComment` the SOLE
 * authority, and its quote scanner does not know a Rust char literal or a TypeScript regex
 * literal. One odd quote desynchronised it and every comment line below went dark: 819 of 11,088
 * comment lines in this product's own TypeScript, across 20 of 97 files. Going dead on two thirds
 * of a file is worse than the template-literal bug the delegation fixed.
 *
 * The three additions:
 *
 * 1. A Rust char literal is an atom, so the `"` inside `s.find('"')` never opens anything.
 * 2. A JS/TS regex literal is an atom, so the quotes inside a character class never do either.
 * 3. RESYNC. A quote whose literal runs to EOF without closing is the scanner being wrong far
 *    more often than the file being broken, so the quote is dropped and the walk resumes one
 *    character later. That is the backstop for every trigger nobody has measured yet.
 *
 * And one narrowing, which is defect 3 of the second round: a `'` run that crosses a newline is
 * an apostrophe ("don't", "the caller's map"), not a literal, and is dropped. A `"` run that
 * crosses a newline is a real multi-line string in Rust and in C#'s `@"..."`, and is KEPT: 27
 * lines inside such strings, SQL among them, were being served to the naked-prose gate.
 */
function scanDocument(text: string, syntax: CommentSyntax, languageId: string): DocumentScan {
  const ledLineComments = new Set<number>();
  const docRuns: DocRun[] = [];
  const literals: [number, number][] = [];
  const rustChars = languageId === "rust";
  const tsRegexes = TS_LANGUAGE_IDS.has(languageId);
  let i = 0;
  while (i < text.length) {
    const doc = syntax.doc.find((opener) => text.startsWith(opener, i));
    if (doc !== undefined) {
      const close = text.indexOf(doc, i + doc.length);
      const end = close < 0 ? text.length : close + doc.length;
      if (ledAt(text, i)) {
        docRuns.push({ index: i, end, closed: close >= 0 });
      } else {
        literals.push([i, end]);
      }
      i = end;
      continue;
    }
    const line = syntax.line.find((opener) => text.startsWith(opener, i));
    if (line !== undefined && opensLineComment(text, i, line)) {
      if (ledAt(text, i)) {
        ledLineComments.add(i);
      }
      i = lineEndAt(text, i);
      continue;
    }
    const block = syntax.block.find((pair) => text.startsWith(pair[0], i));
    if (block !== undefined) {
      const close = text.indexOf(block[1], i + block[0].length);
      i = close < 0 ? text.length : close + block[1].length;
      continue;
    }
    if (rustChars && text[i] === "'") {
      RUST_CHAR_LITERAL.lastIndex = i;
      const m = RUST_CHAR_LITERAL.exec(text);
      if (m !== null && m.index === i) {
        literals.push([i, i + m[0].length]);
        i += m[0].length;
        continue;
      }
    }
    if (tsRegexes && text[i] === "/" && regexCanStart(text, i)) {
      const end = tsRegexEnd(text, i);
      if (end !== undefined) {
        literals.push([i, end]);
        i = end;
        continue;
      }
    }
    if (syntax.quotes.includes(text[i])) {
      const end = tsRegexes && text[i] === "`" ? templateEnd(text, i) : endOfLiteral(text, i) + 1;
      if (end > text.length) {
        // Unclosed to EOF: drop the quote and resync one character on.
        i++;
        continue;
      }
      if (text[i] === "'" && text.slice(i, end).includes("\n")) {
        // An apostrophe, not a literal.
        i++;
        continue;
      }
      literals.push([i, end]);
      i = Math.max(end, i + 1);
      continue;
    }
    i++;
  }
  return { ledLineComments, docRuns, literals };
}

function insideLiteral(scan: DocumentScan, offset: number): boolean {
  return scan.literals.some(([from, to]) => offset > from && offset < to);
}

// ---------------------------------------------------------------- openers

interface OpenerHit {
  indent: string;
  /** The opener as WRITTEN. `///`, `//!` and `//` are three different blocks. */
  opener: string;
  /** The line with the indent and the opener taken off, and one following space with them
   *  UNLESS the line is a directive. Relative indentation inside the comment survives, because
   *  a fenced example and an indented code block are emitted verbatim and their columns mean
   *  something. */
  content: string;
  directive: boolean;
}

/**
 * The opener of a comment-LED line: only whitespace before it, and `nextComment` agrees it is a
 * comment at all.
 *
 * A trailing comment on a line of code answers `undefined`, which is the whole point: this
 * command never re-flows a line that has code on it. So does a `//` that is really two
 * characters inside a template literal.
 */
function commentLedOpener(
  text: string,
  lineStart: number,
  syntax: CommentSyntax,
  scan: DocumentScan,
  languageId: string,
): OpenerHit | undefined {
  const line = lineAt(text, lineStart);
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  if (!scan.ledLineComments.has(lineStart + indent.length)) {
    return undefined;
  }
  const rest = line.slice(indent.length);
  const base = syntax.line.find((opener) => rest.startsWith(opener));
  if (base === undefined) {
    return undefined;
  }
  let n = base.length;
  // Only a slash opener extends. Rust writes `///` and `//!` and C# writes `///`, so those
  // characters are part of the opener and must come back byte-identical. `#` deliberately
  // does NOT extend: Python has no `##` doc convention, and a `## Heading` inside a `#` block
  // is a markdown heading the render already knows how to wrap.
  if (base.endsWith("/")) {
    while (n < rest.length && (rest[n] === "/" || rest[n] === "!")) {
      n++;
    }
  }
  const opener = rest.slice(0, n);
  const after = rest.slice(n);
  const directive = tightenIsDirective(languageId, after);
  const content = directive || !(after.startsWith(" ") || after.startsWith("\t")) ? after : after.slice(1);
  return { indent, opener, content, directive };
}

// ---------------------------------------------------------------- the prose

interface ProseOptions {
  languageId: string;
  /** Columns the wrapped block has to play with. Needed for one decision and one only: telling
   *  a hand-written NESTED list item apart from a wrapped continuation that happens to open
   *  with a marker token. See `normalizeProse`. */
  budget: number;
  tabWidth: number;
  /** Directives are a line-comment concept. A docstring has no opener to attach one to, and a
   *  naked prose line has no leading space to preserve. */
  directives: boolean;
}

/**
 * Content lines to `prose`.
 *
 * Ordinary lines join with a single space, because a wrapped paragraph is one paragraph and the
 * second press has to see what the first one saw. Structure does not join: a fence, an indented
 * code block, a table row, a link reference, a directive, a list line and a heading line each
 * keep their newline, and a blank line becomes the "\n\n" that survives as a paragraph break.
 *
 * ## Ask "was the line above full" FIRST, and only then read the line's kind
 *
 * Every rule below decides a line's kind from the line's own text, and it is reading text THIS
 * RENDER PRODUCED, after the wrap erased the evidence. The second adversarial round found the
 * same failure wearing three faces, and one question answers all three:
 *
 *     ...shipped in version 12.        `12.` gained a line start from the wrap and read as a
 *     The map returns none...          list marker, which then swallowed the unit below it
 *
 *     - the shard map columns are      the table row is indented under a list item, and a
 *       | name | kind |                continuation test that ran first merged it into the item
 *
 * A wrapped continuation exists ONLY because the previous line could not take one more token,
 * and greedy fill guarantees that. So the question is "could the previous line have taken this
 * line's first token". If it could not, this line is a continuation whatever it looks like, and
 * its own kind is never read. If it had room, the line was written by a human and its kind is
 * read normally.
 *
 * The previous line must be one the WRAPPER produced. A fence line, a directive and a verbatim
 * line are emitted byte for byte, so nothing below them is ever a wrap artifact of them.
 *
 * It also settles the older question, a wrapped continuation against a hand-written nested list,
 * which sit at exactly the same column and which the indent alone cannot separate:
 *
 *     /// - outer item one             room to spare above, so this is a NESTED item
 *     ///   - inner item one
 *
 *     # 12. aaaa aaaa ... aaaa         full above, so this is a CONTINUATION
 *     #     ## tail words here
 *
 * KNOWN LIMIT, scraps S52-8, narrowed by the second round to the exact-fit case: a nested item
 * whose parent's LAST rendered line happens to be full still reads as a continuation. Every word
 * survives and the second press is a no-op. The alternative is markdown's own reading, under
 * which the nested item always wins, and that puts 166 of 3000 fuzz rows back to
 * non-idempotent.
 */
function normalizeProse(
  contents: readonly { content: string; directive: boolean }[],
  options: ProseOptions,
): string {
  let out = "";
  let started = false;
  let pendingBreak = false;
  let inFence = false;
  let prevOwnLine = false;
  let prevWasMarker = false;
  // The OPEN UNIT, as the render will see it: the column a continuation of it would sit at,
  // its wrapped text, and the head the wrapper starts it with. See `continues`.
  let contWidth = 0;
  let unitText = "";
  let unitHead = "";
  for (const { content: raw, directive } of contents) {
    const trimmed = tightenTrim(raw);
    const fenceLine = inFence || tightenOpensFence(trimmed);
    if (!fenceLine && trimmed === "") {
      pendingBreak = started;
      continue;
    }
    const isDirective = options.directives && directive && !fenceLine;
    const indented = /^[ \t]/.test(raw);
    // A VERBATIM kind is decided by this line alone and outranks everything, including the
    // question below. It has to: a verbatim line that follows a paragraph follows a FULL line
    // on every press after the first, because the wrap fills its lines, so asking "was the line
    // above full" about one can never give the same answer twice. Found by the fuzz at 52 rows
    // in 4000, after the question was moved to the front and taken too literally.
    const verbatim: boolean = fenceLine || isDirective || tightenVerbatimLine(raw);
    // Asked next, and before every rule that reads this line's own text. See the fold above.
    //
    // The COLUMN is half of the question and the fuzz is what added it. "Was the line above
    // full" alone flips its answer between presses, because the wrap fills the lines it makes:
    // a hand-written heading indented two columns under a paragraph was its own unit on press
    // one and got swallowed on press two, once the paragraph above it had been packed. A
    // continuation also sits at the column the wrapper would have put it at, which is zero for
    // a paragraph and the marker's width for a list item. Both halves, or neither.
    const leadWidth = tightenWidth(/^[ \t]*/.exec(raw)?.[0] ?? "", options.tabWidth);
    const markerish = !verbatim && LIST_OR_HEADING.test(trimmed);
    const continues: boolean =
      started &&
      !pendingBreak &&
      !prevOwnLine &&
      !verbatim &&
      leadWidth === contWidth &&
      (!markerish || previousLineWasFull(unitText, unitHead, trimmed, options));
    const opensMarker = !continues && markerish;
    const ownUnit =
      !continues && (verbatim || prevOwnLine || opensMarker || (prevWasMarker && !indented));
    // Inside a fence, an indented code block, a table row or a directive the bytes are the
    // human's own layout, trailing whitespace aside.
    const piece = verbatim || opensMarker ? tightenTrimEnd(raw) : trimmed;
    if (!started) {
      out = piece;
      started = true;
    } else if (pendingBreak) {
      out += `\n\n${piece}`;
    } else {
      out += ownUnit ? `\n${piece}` : ` ${piece}`;
    }
    if (inFence) {
      // The closing delimiter is part of the fence and the line after it is not.
      inFence = !tightenOpensFence(trimmed);
    } else if (tightenOpensFence(trimmed)) {
      inFence = true;
    }
    if (!started || ownUnit) {
      // A NEW UNIT opened, so the column a continuation of it would sit at changes with it.
      // Mirrors the render's `head` exactly: the line's own indent, the marker, one space.
      // Keyed on `ownUnit` and not on `!continues`, because a line can also join the open unit
      // through the ordinary path, and resetting there told the NEXT line that the list item
      // above it had gone away.
      const marker = opensMarker ? tightenListMarker(trimmed) ?? "" : "";
      unitHead = opensMarker ? `${/^[ \t]*/.exec(raw)?.[0] ?? ""}${tightenTrimEnd(marker)} ` : "";
      contWidth = opensMarker ? tightenWidth(unitHead, options.tabWidth) : 0;
      unitText = opensMarker ? trimmed.slice(marker.length) : verbatim ? "" : trimmed;
    } else {
      unitText = unitText === "" ? trimmed : `${unitText} ${trimmed}`;
    }
    // A marker's context survives its own continuation lines, so a three-line list item folds
    // back into one, and dies at the first flush line, blank line or verbatim line.
    prevWasMarker = opensMarker || (prevWasMarker && continues);
    prevOwnLine = fenceLine || isDirective || verbatim;
    pendingBreak = false;
  }
  return out;
}

/**
 * Whether the line above had room for this line's first token.
 *
 * Measured against the line the RENDER will leave the open unit on, not against the source
 * line above. Those are different whenever the block is re-flowed, and the difference is the
 * whole defect: a heading the human wrote under a short paragraph line survived press one and
 * was swallowed by press two, once the paragraph above it had been packed full. Asking the
 * question against the rendered layout makes press one and press two ask the same question.
 *
 * It runs the render's own wrapper, on the render's own paragraph split, because a re-derived
 * copy of either is this project's classic silent defect. It is only called for a line that
 * opens with a marker token, which is the only kind that competes with a continuation, so the
 * cost never lands on an ordinary block.
 */
function previousLineWasFull(
  unitText: string,
  unitHead: string,
  trimmed: string,
  options: ProseOptions,
): boolean {
  const paragraphs = unitHead === "" ? tightenParagraphs(unitText) : [unitText];
  const last = paragraphs[paragraphs.length - 1] ?? "";
  const cont = " ".repeat(tightenWidth(unitHead, options.tabWidth));
  const lines = wrapTokens(tightenTokens(last), options.budget, unitHead, cont, options.tabWidth);
  const used = tightenWidth(lines[lines.length - 1], options.tabWidth);
  const first = tightenWords(trimmed)[0] ?? "";
  return used + 1 + tightenWidth(first, options.tabWidth) > options.budget;
}

// ---------------------------------------------------------------- resolution

/** The Python docstring the cursor sits inside, or undefined. The scan already refuses a `"""`
 *  that does not open a content line, which is what keeps `x = """a # b"""` out of this. */
function pythonDocstringAt(scan: DocumentScan, cursor: number): DocRun | undefined {
  return scan.docRuns.find((run) => cursor >= run.index && cursor <= run.end);
}

/**
 * The region at the cursor, or a sentence saying why there is none.
 *
 * Order is load-bearing for Python and only for Python: a `# comment` line INSIDE a docstring
 * is prose, not a comment block, so the docstring question is asked first.
 */
export function resolveTightenRegion(target: TightenTarget): TightenRegionResult {
  if (target === null || typeof target !== "object") {
    return refuse("There is no tighten target to resolve.");
  }
  const { text, languageId, cursor } = target;
  if (typeof text !== "string" || typeof languageId !== "string" || typeof cursor !== "number") {
    return refuse("The tighten target is malformed: it needs document text, a language id and a cursor offset.");
  }
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) {
    return refuse("The cursor offset sits outside the document text.");
  }
  if (!servesTighten(languageId)) {
    return refuse(
      `Column 80 tightens comments in Rust, the TypeScript family, C#, Python and Go, and this file is ${languageId}.`,
    );
  }
  const syntax = commentSyntaxFor(languageId);
  if (syntax === undefined) {
    return refuse(`No comment syntax is mapped for ${languageId}, so there is no opener to render with.`);
  }
  const tabWidth = tightenTabWidth(target.tabWidth);
  const scan = scanDocument(text, syntax, languageId);
  if (languageId === "python") {
    const doc = pythonDocstringAt(scan, cursor);
    if (doc !== undefined) {
      return docstringRegion(text, doc, languageId, tabWidth);
    }
  }
  const start = lineStartAt(text, cursor);
  const led = commentLedOpener(text, start, syntax, scan, languageId);
  if (led !== undefined) {
    return lineCommentRegion(text, syntax, scan, languageId, start, led, tabWidth);
  }
  return nakedProseRegion(text, syntax, scan, languageId, start, tabWidth);
}

function budgetFor(indent: string, prefix: string, tabWidth: number): number {
  return Math.max(1, TIGHTEN_COLUMN - tightenWidth(indent, tabWidth) - tightenWidth(prefix, tabWidth));
}

function lineEndingOf(text: string, start: number, end: number): "\n" | "\r\n" {
  return text.slice(start, end).includes("\r\n") ? "\r\n" : "\n";
}

function docstringRegion(
  text: string,
  doc: DocRun,
  languageId: string,
  tabWidth: number,
): TightenRegionResult {
  if (!doc.closed) {
    return refuse("The docstring at the cursor never closes, so its end cannot be found.");
  }
  const quote = text.slice(doc.index, doc.index + 3);
  const start = lineStartAt(text, doc.index);
  const indent = text.slice(start, doc.index);
  const end = lineEndAt(text, doc.end);
  const tail = text.slice(doc.end, end).replace(/\r?\n$/, "");
  if (tightenTrim(tail) !== "") {
    return refuse("Code follows the docstring's closing delimiter on the same line, and this command moves whole lines.");
  }
  const interior = text.slice(doc.index + quote.length, doc.end - quote.length);
  // Line 0 sits after the opening delimiter and carries no indent of its own; every later
  // line carries the docstring's column, which comes off so the prose is column zero.
  const contents = interior.split("\n").map((raw, n) => {
    const line = raw.replace(/\r$/, "");
    const content = n > 0 && line.startsWith(indent) ? line.slice(indent.length) : line;
    return { content, directive: false };
  });
  const prose = normalizeProse(contents, {
    languageId,
    budget: budgetFor(indent, "", tabWidth),
    tabWidth,
    directives: false,
  });
  if (prose === "") {
    return refuse("The docstring at the cursor has no prose in it.");
  }
  return {
    ok: true,
    region: {
      kind: "docstring",
      start,
      end,
      indent,
      prefix: "",
      prose,
      quote,
      endsWithNewline: text[end - 1] === "\n",
      lineEnding: lineEndingOf(text, start, end),
    },
  };
}

function lineCommentRegion(
  text: string,
  syntax: CommentSyntax,
  scan: DocumentScan,
  languageId: string,
  cursorLineStart: number,
  led: OpenerHit,
  tabWidth: number,
): TightenRegionResult {
  const sameBlock = (offset: number): OpenerHit | undefined => {
    const hit = commentLedOpener(text, offset, syntax, scan, languageId);
    // The opener text AND the column both have to match. A `//!` under a `///` is a different
    // block, and a comment one level deeper belongs to something else.
    return hit !== undefined && hit.opener === led.opener && hit.indent === led.indent ? hit : undefined;
  };
  const above: OpenerHit[] = [];
  let start = cursorLineStart;
  while (start > 0) {
    const prev = lineStartAt(text, start - 1);
    const hit = sameBlock(prev);
    if (hit === undefined) {
      break;
    }
    above.unshift(hit);
    start = prev;
  }
  const below: OpenerHit[] = [];
  let end = lineEndAt(text, cursorLineStart);
  while (end < text.length) {
    const hit = sameBlock(end);
    if (hit === undefined) {
      break;
    }
    below.push(hit);
    end = lineEndAt(text, end);
  }
  const prefix = `${led.opener} `;
  const prose = normalizeProse(
    [...above, led, ...below].map((hit) => ({ content: hit.content, directive: hit.directive })),
    { languageId, budget: budgetFor(led.indent, prefix, tabWidth), tabWidth, directives: true },
  );
  if (prose === "") {
    return refuse("The comment block at the cursor has no prose in it.");
  }
  return {
    ok: true,
    region: {
      kind: "line-comment",
      start,
      end,
      indent: led.indent,
      prefix,
      prose,
      endsWithNewline: text[end - 1] === "\n",
      lineEnding: lineEndingOf(text, start, end),
    },
  };
}

// ------------------------------------------------------------- naked prose

/**
 * A line that starts a DECLARATION. Case-sensitive and lowercase only, on purpose: real code
 * writes them in lower case, and a dictated sentence that opens "Use the shard map" or "Return
 * the value" is sentence-cased and still gets served.
 */
const DECLARATION_KEYWORDS = new Set([
  "pub", "fn", "struct", "enum", "impl", "trait", "where", "use", "mod", "type", "const",
  "static", "async", "unsafe", "public", "private", "protected", "internal", "sealed", "class",
  "interface", "record", "namespace", "using", "void", "func", "package", "import", "var",
  "def", "from", "return", "export", "declare", "function", "let", "abstract", "override",
  "virtual",
]);

/** A generic argument list: angle brackets around no whitespace. */
const GENERIC_ARGS = /<[^<>\s]*>/;

/** An apostrophe inside a word is dictation ("the caller's map"), not a string delimiter. Every
 *  other `'` is a quote and a quoted line is a literal. */
const WORD_APOSTROPHE = /([A-Za-z0-9#])'(?=[A-Za-z]|[ \t]|$)/g;

/**
 * The mic dropped text where the cursor was and it is not a comment yet.
 *
 * Every gate here is a refusal of something that might be code, and the review made the list
 * long because six real lines walked through the short one and got commented out, two of them
 * ordinary .NET Allman style. The asymmetry is the whole design: refusing a real dictated line
 * costs one retry, and re-wrapping a line of code corrupts a file.
 *
 * One item on the review's list is NOT implemented and the reason is in the report: "a line
 * ending with `.` followed by nothing" would refuse every dictated sentence, since a sentence
 * ends with a full stop. `+`, `&&` and `||` are refused; a trailing `.` is not.
 */
function nakedProseRegion(
  text: string,
  syntax: CommentSyntax,
  scan: DocumentScan,
  languageId: string,
  start: number,
  tabWidth: number,
): TightenRegionResult {
  const line = lineAt(text, start);
  const trimmed = tightenTrim(line);
  if (trimmed === "") {
    return refuse("The cursor's line is blank, so there is no prose to tighten.");
  }
  if (insideLiteral(scan, start)) {
    return refuse("The cursor's line sits inside a string literal, and re-flowing it would change the string's value.");
  }
  const opensComment =
    syntax.line.some((opener) => trimmed.startsWith(opener)) ||
    syntax.doc.some((opener) => trimmed.startsWith(opener)) ||
    syntax.block.some((pair) => trimmed.startsWith(pair[0]));
  if (opensComment) {
    return refuse(
      "The cursor's line opens a comment this command does not render: only line comments, Python docstrings and naked prose are handled.",
    );
  }
  if (/[;{}=]/.test(trimmed)) {
    return refuse("The cursor's line carries code punctuation (a `;`, `{`, `}` or `=`), so it is not treated as prose.");
  }
  const firstWord = tightenWords(trimmed)[0] ?? "";
  if (DECLARATION_KEYWORDS.has(firstWord)) {
    return refuse(`The cursor's line opens with \`${firstWord}\`, which starts a declaration rather than a sentence.`);
  }
  if (/^(?:#\[|#!|@)/.test(trimmed)) {
    return refuse("The cursor's line opens an attribute, a shebang or a decorator rather than a sentence.");
  }
  if (trimmed.includes('"') || trimmed.replace(WORD_APOSTROPHE, "$1").includes("'")) {
    return refuse("The cursor's line carries a quote character, so it is a literal rather than dictated prose.");
  }
  if (GENERIC_ARGS.test(trimmed)) {
    return refuse("The cursor's line carries a generic argument list, so it is code rather than dictated prose.");
  }
  if (/[(:,+]$|&&$|\|\|$/.test(trimmed) || /[[({<]$/.test(trimmed)) {
    return refuse("The cursor's line ends with an operator or an unclosed bracket, which opens code rather than closing a sentence.");
  }
  // A CLOSING bracket is only code when the line opened one like a call does. "shows truncated
  // hashes (a summary)" is ordinary English and 3.2% of real Rust doc sentences end in `)`; a
  // prose parenthetical has a space before its bracket and `foo(bar, baz)` does not.
  if (/[)\]>]$/.test(trimmed) && /[A-Za-z0-9_]\(/.test(trimmed)) {
    return refuse("The cursor's line closes a call rather than a parenthetical, so it is code rather than dictated prose.");
  }
  if (tightenWords(trimmed).length < 4) {
    return refuse("The cursor's line carries fewer than four words, which is too short to read as dictated prose.");
  }
  const prefix = docPrefixFor(languageId);
  if (prefix === undefined) {
    return refuse(`No doc comment prefix is defined for ${languageId}.`);
  }
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  const end = lineEndAt(text, start);
  const prose = normalizeProse([{ content: trimmed, directive: false }], {
    languageId,
    budget: budgetFor(indent, prefix, tabWidth),
    tabWidth,
    directives: false,
  });
  return {
    ok: true,
    region: {
      kind: "prose",
      start,
      end,
      indent,
      prefix,
      prose,
      endsWithNewline: text[end - 1] === "\n",
      lineEnding: lineEndingOf(text, start, end),
    },
  };
}
