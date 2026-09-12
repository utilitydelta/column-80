/**
 * The case-table locator: where a generated table's EXPECTED VALUES are.
 *
 * Session-v68 phase 2, and it exists because of what phase 1 did. The
 * test-authoring prompt used to ask for one inline assertion per case; it now
 * asks for ONE parameterised table of rows plus one runner (supersession S31).
 * On that shape the shipped INLINE locators do not merely miss - eight of the
 * nine find the runner's assertion and blank the LOOP VARIABLE. That produces a
 * snippet whose runner reads a hole while the ROWS still carry the model's
 * guessed values: the blank-value invariant inverted, the human ratifying
 * nothing, every guess shipping green. Only Go's fails safe, by finding nothing.
 *
 * So this module answers two questions for every language:
 *
 *   1. Where are the rows, and which byte range is each row's LAST COLUMN?
 *      That column is the expected value in all five languages, because the
 *      prompt says so in one shared sentence (`LAST_COLUMN_CLAUSE`).
 *   2. Which located spans are REFERENCES into a row rather than values? A span
 *      reading `want`, `tt.want` or `c.expected` is the runner reading the
 *      table, and blanking it is the inversion above.
 *
 * A row reference found with NO table parsed is not silence and must never be
 * treated as one: it means the model wrote a table this locator could not read,
 * so it counts as UNRESOLVED and the all-or-nothing floor refuses the whole
 * pass. Refusing is honest; blanking the wrong place is not.
 *
 * One scanner. Everything here reads through `skipLiteralOrComment` /
 * `matchDelim` with the language's own `LiteralProfile`, exactly as the inline
 * locators do. A second regex reader is how two locators drift apart.
 */

import { LiteralProfile, matchDelim, skipLiteralOrComment } from "./testAssembly";

export interface TableSpan {
  start: number;
  end: number;
}

/** One parsed case table. */
export interface CaseTable {
  /** The table's own byte range: the declaration or the attribute run, NOT the
   *  runner. Bounding the runner would need Python indentation parsing in one
   *  leg and block matching in four; the row-reference rule covers the runner
   *  instead, and covers it in every language the same way. */
  region: TableSpan;
  /** One span per row: that row's LAST column. */
  expected: TableSpan[];
  /** The column names the table binds, in declaration order. Empty when the
   *  shape names none, which leaves only the conventional-name fallback. */
  knobs: string[];
  /** The RUNNER's body: where a bound column has to be READ for the column to
   *  be doing anything. Deliberately NOT `region`: the header that BINDS the
   *  names must sit outside it, or binding a column would count as using it and
   *  the dead-column rung could never fire. Absent when the shape has no body
   *  the finder could bound, which reports nothing rather than guessing. */
  body?: TableSpan;
}

/** The names a generated runner conventionally uses to read a row. The fallback
 *  when knob discovery fails, so a table this locator could not PARSE is still
 *  not silently mis-blanked. `want` leads because the prompt asks for it by
 *  name in all five languages. */
//
// SPLIT IN TWO after the phase 2 adversarial review, because a bare name and a
// dotted path are different questions and one list answered them both badly.
//
// A BARE name is a row read only if it says so on its own. The first cut also
// held `c`, `cs`, `row` and `case` here, and that was greedy in the direction
// that COSTS: with no table parsed, a local legitimately named `c` turned a pass
// that used to blank correctly into a refusal.
const CONVENTIONAL_EXPECTED_NAMES = new Set(["want", "wants", "expected", "exp"]);

// A DOTTED path is a row read when its ROOT is the row variable. These names are
// safe here and unsafe above: `c.expected` is unambiguous where a bare `c` is
// not, because something is being read OUT of `c`.
const CONVENTIONAL_ROW_HOLDERS = new Set(["tt", "tc", "c", "cs", "row", "case", "testCase", "cse"]);

/** Bare names that are VALUES, not references, in one language or another. A
 *  human keeps these; blanking them is right and dropping them is wrong. */
//
// `string` and `default` were in the first cut and are gone: `default` is a real
// C# expected value AND a plausible column name, and the review found a table
// declaring a column called `default` whose runner read was then blanked. A
// DECLARED KNOB now wins over this set, which settles that collision the right
// way round; these are only the bare names that are values when nothing declared
// them.
const LITERAL_NAMES = new Set([
  "None",
  "null",
  "nil",
  "undefined",
  "true",
  "false",
  "True",
  "False",
  "NaN",
  "Infinity",
]);

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Is this span's text a REFERENCE into a case row rather than a value?
 *
 * A bare identifier or a dotted path whose ROOT segment is a declared knob or a
 * conventional row name. `int.MaxValue`, `math.inf` and `Decimal.Zero` are
 * dotted paths too and are legitimate expected values, which is why only the
 * ROOT decides and why the sets above are closed rather than "anything that
 * looks like a name".
 */
export function isRowReference(text: string, knobs: readonly string[]): boolean {
  // A Rust `for` over an array by reference binds `&T`, so the runner reads
  // `*want`. Stripping the sigils is not a widening of what counts as a name: a
  // deref of a row read is still a row read, and leaving it out blanked `*want`
  // as a fourth hole beside the three real rows.
  const t = text.trim().replace(/^[*&\s]+/, "");
  if (t.length === 0) {
    return false;
  }
  const parts = t.split(".");
  for (const p of parts) {
    if (!IDENT.test(p.trim())) {
      return false;
    }
  }
  const root = parts[0].trim();
  const leaf = parts[parts.length - 1].trim();
  // A DECLARED knob wins over the literal names. A table is free to call a
  // column `default`, and when it does, the runner's read of it is a reference
  // whatever the name would otherwise mean.
  if (knobs.includes(root) || (parts.length > 1 && knobs.includes(leaf))) {
    return true;
  }
  if (LITERAL_NAMES.has(root)) {
    return false;
  }
  if (parts.length === 1) {
    return CONVENTIONAL_EXPECTED_NAMES.has(root);
  }
  // Dotted: either the root is a known row holder, or the LEAF is the expected
  // column by its conventional name. `c.expected` and `row.Expected` are row
  // reads whatever the root is called; the leaf compares case-insensitively
  // because C# spells it `Expected`.
  return CONVENTIONAL_ROW_HOLDERS.has(root) || CONVENTIONAL_EXPECTED_NAMES.has(leaf.toLowerCase());
}

/**
 * The matching closer and the TOP-LEVEL element spans of the bracketed group
 * whose opener sits at `open`. Generalises `topLevelArgs` off `(` alone, so one
 * parse reads a Rust array, a Go composite literal, a TS row array, a Python
 * tuple and a C# attribute argument list.
 *
 * Element spans are trimmed. undefined when unbalanced, which is a
 * half-generated reply and must never throw.
 */
export function topLevelElements(
  text: string,
  open: number,
  profile?: LiteralProfile,
): { elements: TableSpan[]; close: number } | undefined {
  const close = matchDelim(text, open, profile);
  if (close === -1) {
    return undefined;
  }
  const raw: TableSpan[] = [];
  let depth = 0;
  let elemStart = open + 1;
  let i = open + 1;
  while (i < close) {
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
    } else if (c === "," && depth === 0) {
      raw.push({ start: elemStart, end: i });
      elemStart = i + 1;
    }
    i++;
  }
  const tail = trimSpan(text, { start: elemStart, end: close }, profile);
  if (tail.end > tail.start) {
    raw.push({ start: elemStart, end: close });
  }
  return { elements: raw.map((s) => trimSpan(text, s, profile)), close };
}

/** An element's span, with whitespace AND comments taken off both ends.
 *
 *  P9 rule 13's other half. Stepping over a comment at the head of a LIST bought
 *  the table back; the span of a COLUMN is a separate question and it was the
 *  dangerous one. `(1, 2, // the answer\n)` leaves an element after the last
 *  comma that is nothing but a note, and it was returned as the expected column:
 *  the hole landed on the comment, the model's guessed `2` shipped unblanked,
 *  and the third floor counted the hole and let the gesture through. Same for a
 *  comment in front of a value (`(1, /* pick *\/ 2)`), which in a KEYED row
 *  swallowed the field name and emitted `{in: 1, ${1}}`.
 *
 *  So the trim is comment-aware, once, here, rather than at each of the three
 *  column readers. A comment-only element trims to a ZERO-LENGTH span, which the
 *  row readers refuse - that shape is not valid source in any of the five
 *  languages, and refusing is the cheap direction. The one exception is a
 *  comment-only TAIL after the last comma, which is a trailing comma with a note
 *  on it and is dropped exactly as a bare trailing comma already was.
 *
 *  A STRING is not a comment and is never trimmed: it is a legitimate column. */
function trimSpan(text: string, span: TableSpan, profile?: LiteralProfile): TableSpan {
  let firstCode = -1;
  let lastCode = -1;
  let i = span.start;
  while (i < span.end) {
    const past = skipCommentAt(text, i, profile);
    if (past > i) {
      i = past;
      continue;
    }
    const literal = skipLiteralOrComment(text, i, profile);
    if (literal > i) {
      if (firstCode === -1) {
        firstCode = i;
      }
      lastCode = Math.min(literal, span.end) - 1;
      i = literal;
      continue;
    }
    if (!/\s/.test(text[i])) {
      if (firstCode === -1) {
        firstCode = i;
      }
      lastCode = i;
    }
    i++;
  }
  if (firstCode === -1) {
    return { start: span.start, end: span.start };
  }
  const s = firstCode;
  const e = lastCode + 1;
  return { start: s, end: e };
}

/** The identifier ending at `i` (exclusive), or "" when none does. */
function identBefore(text: string, i: number): string {
  let s = i;
  while (s > 0 && /[A-Za-z0-9_$]/.test(text[s - 1])) {
    s--;
  }
  return text.slice(s, i);
}

/** Does a `:` sit in front of the identifier starting at `start`? The gate on
 *  the annotation walk when the annotation is itself identifier-shaped, and no
 *  more than a gate: the second `:` of a path separator answers true here on
 *  purpose, because `let cases: crate::fixtures::Cases = …` has to reach the
 *  same walk. Telling a binding `:` from a path `::` is the walk's job, not
 *  this one's. */
function colonBefore(text: string, start: number): boolean {
  let p = start - 1;
  while (p >= 0 && /\s/.test(text[p])) {
    p--;
  }
  return p >= 0 && text[p] === ":";
}

/** The next non-space index at or after `i`. */
function skipSpace(text: string, i: number): number {
  let j = i;
  while (j < text.length && /\s/.test(text[j])) {
    j++;
  }
  return j;
}

/** The index just past the COMMENT starting at `i`, or `i` when none does.
 *
 *  P9 rule 13's primitive. `skipLiteralOrComment` cannot be used for this: it
 *  steps over a STRING too, and a string is a legitimate table column, so
 *  stepping over one would move a span onto the wrong value - the inversion
 *  direction. Block comments are handed to the shared scanner so nesting follows
 *  the profile; a line comment is read here because its terminator is the
 *  newline and the profile decides whether that is `//` or `#`. */
function skipCommentAt(text: string, i: number, profile: LiteralProfile | undefined): number {
  if (isLineCommentOpener(text, i, profile)) {
    const nl = text.indexOf("\n", i);
    return nl === -1 ? text.length : nl;
  }
  if (profile?.hashComments !== true && text[i] === "/" && text[i + 1] === "*") {
    return skipLiteralOrComment(text, i, profile);
  }
  return i;
}

/** Is `i` the start of a whole word (not mid-identifier)? */
function atWordStart(text: string, i: number): boolean {
  return i === 0 || !/[A-Za-z0-9_$]/.test(text[i - 1]);
}

/**
 * Every occurrence of `word` at a word boundary, outside literals and comments.
 * The one primitive every finder below is built from.
 */
function wordOccurrences(text: string, word: string, profile?: LiteralProfile): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (
      text.startsWith(word, i) &&
      atWordStart(text, i) &&
      !/[A-Za-z0-9_$]/.test(text[i + word.length] ?? "")
    ) {
      out.push(i);
      i += word.length;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * Rows whose elements are all bracketed groups of at least two columns, with the
 * LAST column taken as the expected value. The shared body of the four
 * list-of-tuples shapes (Rust, Go, TypeScript, both Python legs).
 *
 * A row that is NOT a bracketed group is what separates a case table from
 * ordinary data: `let expected = [1, 2, 3]` is three scalars and no table, while
 * `let cases = [(1, 2, 3), (4, 5, 6)]` is two rows. Requiring every row to be a
 * group, and every group to have at least two columns, is that discriminator.
 * undefined when the list is not a table.
 */
function rowsFromList(
  text: string,
  listOpen: number,
  openers: string,
  profile: LiteralProfile | undefined,
  lastColumnOf: (text: string, rowOpen: number, profile?: LiteralProfile) => TableSpan | undefined,
): { expected: TableSpan[]; close: number } | undefined {
  const parsed = topLevelElements(text, listOpen, profile);
  if (parsed === undefined || parsed.elements.length === 0) {
    return undefined;
  }
  const expected: TableSpan[] = [];
  for (const el of parsed.elements) {
    // `topLevelElements` has already taken the comments off both ends, so the
    // element's first character IS its first token (rule 13). A ZERO-LENGTH
    // element is one that was nothing but a comment, which only a mid-list
    // `, /* x */ ,` produces and which is not valid source anywhere: refused,
    // the cheap direction. A comment-only TAIL never reaches here.
    if (el.start >= el.end || !openers.includes(text[el.start])) {
      return undefined;
    }
    const last = lastColumnOf(text, el.start, profile);
    if (last === undefined) {
      return undefined;
    }
    expected.push(last);
  }
  return expected.length === 0 ? undefined : { expected, close: parsed.close };
}

/** The last top-level column of the bracketed row opening at `rowOpen`, when the
 *  row declares at least two columns. A one-column row is not a table row: there
 *  is no input to distinguish it from its own expected value. */
function lastPositionalColumn(text: string, rowOpen: number, profile?: LiteralProfile): TableSpan | undefined {
  const parsed = topLevelElements(text, rowOpen, profile);
  if (parsed === undefined || parsed.elements.length < 2) {
    return undefined;
  }
  return parsed.elements[parsed.elements.length - 1];
}

/** Go's rows may be KEYED (`{name: "a", want: 3}`), in which case the expected
 *  value is the `want:` field wherever it sits, not the last element. */
function goLastColumn(text: string, rowOpen: number, profile?: LiteralProfile): TableSpan | undefined {
  const parsed = topLevelElements(text, rowOpen, profile);
  if (parsed === undefined || parsed.elements.length < 2) {
    return undefined;
  }
  for (const el of parsed.elements) {
    const m = /^([A-Za-z_]\w*)\s*:\s*/.exec(text.slice(el.start, el.end));
    if (m !== null && m[1] === "want") {
      return { start: el.start + m[0].length, end: el.end };
    }
  }
  // Positional, or keyed on some other field name: the last column stands.
  const last = parsed.elements[parsed.elements.length - 1];
  const keyed = /^([A-Za-z_]\w*)\s*:\s*/.exec(text.slice(last.start, last.end));
  return keyed === null ? last : { start: last.start + keyed[0].length, end: last.end };
}

/**
 * Where the runner's ` in <table>` starts, allowing the table to be BORROWED.
 *
 * `for x in cases` moves the array; `for x in &cases` does not, and the second is
 * what a model writes the moment a column has to outlive the row — a `name`
 * column read by a `{}` in the assertion's message is enough to force it. The
 * match used to be the literal string ` in cases`, so an `&` in the way cost
 * every hole in the table and ended the gesture in a refusal.
 *
 * Found by the live gate rather than by a unit test: Claude wrote
 * `for (name, path, expected) in &cases` against the real corpus and the locator
 * returned zero spans where the moved form returns eight.
 *
 * Returns the index of the whitespace before `in`, which is what the caller
 * slices the destructuring header up to, so the borrow is invisible to it.
 */
function iterableAt(text: string, listName: string, from: number): number {
  const re = new RegExp(`\\sin\\s+&?(?:mut\\s+)?${listName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  re.lastIndex = from;
  const m = re.exec(text);
  return m === null ? -1 : m.index;
}

/**
 * The `for` header that walks `listName`: the names it binds, and where the body
 * it guards starts.
 *
 * Rust's `for (a, b, want) in cases { … }` and Python's
 * `for a, b, want in cases:` are the two shapes; Go's
 * `for _, tt := range cases { … }` binds the ROW rather than the columns, so it
 * comes through here for the body alone.
 *
 * The header is outside the returned body ON PURPOSE. Binding a column is not
 * using it, and that is the whole of the dead-column rule.
 */
function walkerAfter(
  text: string,
  listName: string,
  from: number,
  profile?: LiteralProfile,
): { knobs: string[]; body?: TableSpan } | undefined {
  for (const at of wordOccurrences(text.slice(from), "for", profile)) {
    const i = from + at;
    const inAt = iterableAt(text, listName, i);
    const rangeAt = text.indexOf(`range ${listName}`, i);
    const headEnd = inAt !== -1 && (rangeAt === -1 || inAt < rangeAt) ? inAt : rangeAt;
    if (headEnd === -1 || headEnd - i > 200) {
      continue;
    }
    // The header must be a HEADER: an unrelated `for` earlier in the module
    // would otherwise be paired with this table's `in cases` hundreds of bytes
    // later, and the garbage between them read as column names. A real header
    // holds no block opener and no statement terminator.
    const header = text.slice(i + 3, headEnd);
    if (/[{};]/.test(header)) {
      continue;
    }
    const knobs = header
      .trim()
      .replace(/^\(|\)$/g, "")
      .split(",")
      .map((n) => n.trim())
      .filter((n) => IDENT.test(n) && n !== "_");
    // KEEP LOOKING when this `for` binds nothing. Returning here on the first
    // match lost the table outright: phase 2 requires a walker with at least one
    // column, so one unrelated `for` ahead of the real one discarded a table the
    // locator had parsed perfectly.
    if (knobs.length === 0) {
      continue;
    }
    return { knobs, body: blockAfter(text, headEnd, profile) };
  }
  return undefined;
}

/** The braced block, or the indented suite, that starts after `from`.
 *
 *  A brace language gives an exact span. Python's suite is bounded by INDENTATION
 *  (see `pySuiteEnd`): running it to the end of the text was over-broad in the
 *  direction that costs nothing at refusal time but hides real findings, and the
 *  review proved it — a second parametrized test reading a name the first left
 *  dead masked the first test's defect entirely. */
function blockAfter(text: string, from: number, profile?: LiteralProfile): TableSpan | undefined {
  let i = from;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (text[i] === "{") {
      const close = matchDelim(text, i, profile);
      return close === -1 ? { start: i + 1, end: text.length } : { start: i + 1, end: close };
    }
    if (text[i] === ":" && text[i + 1] !== "=") {
      return { start: i + 1, end: pySuiteEnd(text, i) };
    }
    // A `;` ends a member that has no block at all: an abstract method, an
    // interface declaration, an expression-bodied one. There is no body to read,
    // so there is nothing to call dead.
    if (text[i] === ";") {
      return undefined;
    }
    i++;
  }
  return undefined;
}

/** How far back a type annotation may run. A real one is a few dozen
 *  characters; the bound exists so pathological input cannot turn the backwards
 *  walk quadratic on a locator that also runs on the fn-gen path. */
const ANNOTATION_BUDGET = 512;

/** What may bind the name in front of a type annotation. Rust's `let`, plus the
 *  two item forms a generated test module can legally hang a case table off. */
const BINDING_KEYWORD = /^(let|const|static)$/;

/** What may bind the name when `mut` sits between the keyword and the name.
 *  `let mut` and `static mut` are the two Rust spells; `const mut` is not a
 *  thing, so it is not here. */
const MUT_BINDING_KEYWORD = /^(let|static)$/;

/** Is the identifier ending at `end` (exclusive) a binding keyword for the name
 *  that follows it, `mut` allowed in between?
 *
 *  P9 rule 12. `mut` is part of the binding and not a barrier, and reading it as
 *  the binding keyword lost EVERY annotated table the moment a model wrote
 *  `let mut cases: … = …`, which is what a model writes whenever the runner
 *  needs the table by value and then mutates it, and what it writes by habit
 *  otherwise. The unannotated `let mut` form was always found, because the walk
 *  back from the `=` lands on the name and never asks this question, so the
 *  annotation was the whole difference.
 *
 *  Only `mut`, and only as a WHOLE token. `identBefore` cannot return a prefix,
 *  so `let mutable_cases: T = …` reads its keyword as `let` and its name as
 *  `mutable_cases`, which is what it is. Admitting an arbitrary identifier here
 *  would let `foo bar cases: T = …` name a table.
 *
 *  And the keyword has to be CODE, which is the same question `commentOwns` is
 *  already asked about the colon. The backwards walk skips whitespace including
 *  newlines, so a line comment ending in the word `let` supplies the keyword for
 *  the line below it:
 *
 *      // this used to be a let
 *      mut cases: Vec<(i32, i32)> = vec![ (1, 2), (3, 4) ];
 *
 *  `mut cases: T = …` with no keyword is not a binding in any Rust, and that
 *  shape was admitted with the model's guessed values blanked out of a list
 *  nothing declares. The `mut` hop made it reachable; the same lens closes both
 *  hops at once. */
function bindsName(text: string, end: number, profile: LiteralProfile | undefined): boolean {
  const word = identBefore(text, end);
  if (word.length === 0) {
    return false;
  }
  if (commentOwns(text, end - word.length, profile)) {
    return false;
  }
  if (word !== "mut") {
    return BINDING_KEYWORD.test(word);
  }
  let b = end - word.length - 1;
  while (b >= 0 && /\s/.test(text[b])) {
    b--;
  }
  const keyword = identBefore(text, b + 1);
  return MUT_BINDING_KEYWORD.test(keyword) && !commentOwns(text, b + 1 - keyword.length, profile);
}

// ===========================================================================
// The per-language finders
// ===========================================================================


/** Does a COMMENT, or a string, own the character at `at`?
 *
 *  Two callers: the annotation walk's `:`, and the BINDING KEYWORD in front
 *  of the name. Both are tokens a backwards walk can pick up out of prose.
 *
 *  The backwards walk reads raw characters, so `/// let cases:` on the line
 *  above a list hands it a colon, an identifier and a binding keyword that are
 *  all comment PROSE. `annotationRunsTo` cannot catch it: it guards the region
 *  after the colon, and in that shape the region is a bare identifier that
 *  verifies cleanly. A block comment is caught, because its closer lands inside
 *  the verified region; a line comment's terminator is the newline, which is
 *  behind the colon, not in front of it.
 *
 *  So the question is asked backwards, with the same literal/comment lens the
 *  rest of this file uses: re-lex forward from the first line start inside the
 *  budget and see whether a skipped region covers the colon. That reads `//`
 *  inside a string as ordinary text for free, which a scan for the characters
 *  would not. The lex starts at the budget floor and not at the colon's own
 *  line because a block comment or a string can OPEN on an earlier line: from
 *  the colon's line the comment's closer is plain text and a string's closing
 *  quote reads as an opening one. That admitted a `let cases: rows` sitting in
 *  a block comment whose closer lands on the next line, and refused a real
 *  table behind a string closed on the binding's line. Reading from the floor
 *  sees both open, and the budget already pays for that distance.
 *
 *  Two narrower gates were on the table. Refusing a NEWLINE between the colon
 *  and the `=` is smaller, but it admits `// let cases: rows` with the `=` on
 *  the next line, where colon and name share the comment's line, and it loses a
 *  real annotation written across two lines. Scanning back for a literal `//`
 *  is the same size as this and cannot tell one inside a string from a real
 *  one. This gate is keyed on the thing that is actually wrong: the colon is
 *  not code.
 *
 *  Bounded like the walk it guards. No line boundary inside the budget is
 *  answered "owned", which refuses the table: losing one costs a gesture,
 *  naming the wrong list blanks a column the human wrote. */
function commentOwns(text: string, at: number, profile: LiteralProfile | undefined): boolean {
  const floor = Math.max(0, at - ANNOTATION_BUDGET);
  let lineStart = floor;
  while (lineStart > 0 && lineStart < at && text[lineStart - 1] !== "\n") {
    lineStart++;
  }
  if (lineStart >= at) {
    return true;
  }
  let i = lineStart;
  while (i < at) {
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      if (skipped > at) {
        return true;
      }
      i = skipped;
      continue;
    }
    i++;
  }
  return false;
}

/** The bound name in front of a TYPE ANNOTATION, or undefined when what sits
 *  between the name and the `=` is not one.
 *
 *  `end` is the index of the last character before the `=`'s leading whitespace,
 *  i.e. the annotation's final character. Walks back to the annotation's `:`
 *  with bracket depth, then VERIFIES by scanning forward from the candidate name
 *  through the existing literal/comment machinery and checking it arrives at
 *  exactly the `=` it started from. The forward pass is what makes this safe: a
 *  backwards walk cannot tell a `:` inside a string from a real one, and the
 *  forward scan already knows how.
 *
 *  Bounded on purpose. A real annotation is short, and an unbounded backwards
 *  walk over pathological input is how a locator that runs on the fn-gen path
 *  turns into a hang. */
function nameBeforeAnnotation(text: string, end: number, profile: LiteralProfile | undefined): string | undefined {
  const FLOOR = Math.max(0, end - ANNOTATION_BUDGET);
  let depth = 0;
  let k = end;
  while (k >= FLOOR) {
    const c = text[k];
    if (c === "]" || c === ")" || c === ">") {
      depth++;
    } else if (c === "[" || c === "(" || c === "<") {
      depth--;
      if (depth < 0) {
        return undefined;
      }
    } else if (depth === 0) {
      // `;`, `{` and `}` cannot appear in an annotation at depth 0, so hitting
      // one means this `=` was never a `let` binding's.
      if (c === ";" || c === "{" || c === "}" || c === "=") {
        return undefined;
      }
      // The binding's `:`, and not one half of a `::` path separator.
      if (c === ":" && text[k - 1] !== ":" && text[k + 1] !== ":") {
        let n = k - 1;
        while (n >= 0 && /\s/.test(text[n])) {
          n--;
        }
        const candidate = identBefore(text, n + 1);
        if (candidate.length === 0 || commentOwns(text, k, profile)) {
          return undefined;
        }
        if (!annotationRunsTo(text, k + 1, end, profile)) {
          return undefined;
        }
        // And the name must be BOUND, right here. The flag above keeps this walk
        // off the Python leg; this keeps it anchored even if a third caller is
        // ever wired in, because `identifier : type =` is a binding in Rust and a
        // dictionary entry, a slice, an annotation or a label in other languages.
        // Closing the class costs two lines and the alternative is trusting every
        // future caller to remember.
        let b = n - candidate.length;
        while (b >= 0 && /\s/.test(text[b])) {
          b--;
        }
        return bindsName(text, b + 1, profile) ? candidate : undefined;
      }
    }
    k--;
  }
  return undefined;
}

/** Forward verification for nameBeforeAnnotation: scan `from` to `end` with the
 *  shared literal/comment lens and confirm the region closes every delimiter it
 *  opens. A region that does not is not an annotation, whatever it looked like
 *  backwards. */
function annotationRunsTo(text: string, from: number, end: number, profile: LiteralProfile | undefined): boolean {
  let depth = 0;
  let i = from;
  while (i <= end) {
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      // A literal or a comment inside what claimed to be a type annotation.
      return false;
    }
    const c = text[i];
    if (c === "[" || c === "(" || c === "<") {
      depth++;
    } else if (c === "]" || c === ")" || c === ">") {
      depth--;
      if (depth < 0) {
        return false;
      }
    } else if (c === ";") {
      // `[T; N]` is an array type and `[T; ]` is not a type at all. Balanced
      // brackets are a weaker test than "is a type", and this is the gap between
      // the two that a half-written reply actually lands in. Refusing costs a
      // human a pass on a file that would not have compiled anyway; admitting
      // means trusting a delimiter count to tell a type from a fragment.
      const after = skipSpace(text, i + 1);
      if (after > end || text[after] === "]" || text[after] === ")" || text[after] === ">") {
        return false;
      }
    }
    i++;
  }
  return depth === 0;
}

/** `let cases = [ (…, want), … ];` — Rust, and the same shape for Python's
 *  unittest leg (`cases = [ (…, want), … ]`). One finder, two callers, because
 *  the only thing that differs is the `let` keyword, which is optional here. */
function findAssignedTupleTable(
  text: string,
  profile: LiteralProfile | undefined,
  annotations: boolean,
): CaseTable[] {
  const out: CaseTable[] = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (text[i] !== "[") {
      i++;
      continue;
    }
    // Walk back over `= ` to the bound name. `vec![` is Rust's other spelling,
    // in which the `[` is preceded by `!`, and `&[ … ]` / `&vec![ … ]` are the
    // slice-reference spellings, in which it is preceded by `&`.
    let j = i - 1;
    if (text[j] === "!" && identBefore(text, j) === "vec") {
      j -= 4;
    }
    while (j >= 0 && /\s/.test(text[j])) {
      j--;
    }
    if (text[j] === "&") {
      j--;
      while (j >= 0 && /\s/.test(text[j])) {
        j--;
      }
      if (text[j] === "!" && identBefore(text, j) === "vec") {
        j -= 4;
        while (j >= 0 && /\s/.test(text[j])) {
          j--;
        }
      }
    }
    if (text[j] !== "=" || text[j - 1] === "=" || text[j - 1] === "!" || text[j - 1] === "<" || text[j - 1] === ">") {
      i++;
      continue;
    }
    j--;
    while (j >= 0 && /\s/.test(text[j])) {
      j--;
    }
    let name = identBefore(text, j + 1);
    if (name.length === 0) {
      // A TYPE ANNOTATION sits between the bound name and the `=`:
      // `let cases: [(Vec<u8>, usize, Option<u128>); 5] = [ … ];`. Walking
      // straight back from the `=` lands on the annotation's own closing
      // bracket rather than on an identifier, so the binding was invisible and
      // the whole table with it. That is not a rare spelling: an array of
      // tuples whose element type will not infer REQUIRES the annotation, and
      // that is precisely the constructed-column case the table's own knob rule
      // asks the model to write.
      //
      // The annotation is stepped over as ONE opaque region and is never
      // scanned for rows. It is a bracketed list of parenthesised,
      // comma-separated things, which is the exact shape of a row, and reading
      // it as one would blank a TYPE NAME and hand the human a hole where a
      // type belongs.
      // RUST ONLY, and structurally so rather than by assertion. This finder has
      // TWO callers: `assignedTupleTables` (Rust) and `pyTables`, which feeds both
      // the pytest and the unittest legs. The backwards walk stops at `;`, `{` or
      // `}` at depth 0, and Rust ends every statement and block with one of those,
      // so the walk cannot leave the binding. PYTHON WRITES NONE OF THEM: the walk
      // crossed statement and block boundaries and found the `:` that ends an
      // `if`/`for`/`while`/`with` header, and the identifier in front of THAT colon
      // became the table's name. Measured: an inline hole on `b` turned into two
      // holes on `2` and `4`, the second column of a list no runner walks, while
      // `b` — the assertion's real expected value — shipped as the model guessed
      // it. That is the blank-value INVERSION, not a refusal, in the language the
      // contract had declared out of scope.
      //
      // The flag is rule 8 written in code instead of asserted in a document.
      const annotated = annotations ? nameBeforeAnnotation(text, j, profile) : undefined;
      if (annotated === undefined) {
        i++;
        continue;
      }
      name = annotated;
    } else if (annotations && colonBefore(text, j + 1 - name.length)) {
      // The identifier that walk just found may be the TYPE, not the bound
      // name: `let cases: Cases = [ … ];`. A plain type name is the one
      // annotation spelling that ENDS in an identifier, so unlike every form
      // above it the walk back from the `=` lands on something and the branch
      // above is never entered. The finder then hunts for a runner that loops
      // over `Cases`, finds none, and drops the table with every hole in it,
      // which ships the model's guessed expected values as if a human had
      // checked them.
      //
      // The `:` is only the question. The same character sits in front of the
      // identifier in `let cases: crate::fixtures::Cases = [ … ]`, where it is
      // the tail of a path separator, and that spelling has to reach the same
      // answer as the plain one. So `nameBeforeAnnotation` is what decides:
      // it carries the `::` rule, the forward verification and the binding
      // keyword that keep a struct-literal field, a match arm and an ascription
      // from turning into a table name, and it is bounded, which this walk on
      // the fn-gen path has to stay.
      //
      // When it refuses, the identifier stands as the name and this finder
      // answers exactly what it answered before the question was asked. Losing
      // a table costs a gesture; naming the wrong list blanks a column the human
      // never wrote, so an ambiguous shape is answered with no table.
      const annotated = nameBeforeAnnotation(text, j, profile);
      if (annotated !== undefined) {
        name = annotated;
      }
    }
    const rows = rowsFromList(text, i, "(", profile, lastPositionalColumn);
    if (rows === undefined) {
      i++;
      continue;
    }
    // A LIST OF TUPLES IS NOT A TABLE. It is a table when a runner WALKS it and
    // binds a name per column, and requiring that is the discriminator the first
    // cut was missing: the review fed `let inputs = [(1, 2), (3, 4)];` — ordinary
    // shared setup above a set of inline asserts — and every second element was
    // blanked as if it were an expected value, so the human was asked to type
    // into the test's own INPUTS while the real expected values shipped as the
    // model guessed them. No destructuring loop, no table.
    const walker = walkerAfter(text, name, rows.close, profile);
    if (walker === undefined || walker.knobs.length === 0) {
      i = rows.close + 1;
      continue;
    }
    out.push({
      region: { start: i, end: rows.close + 1 },
      expected: rows.expected,
      knobs: walker.knobs,
      ...(walker.body === undefined ? {} : { body: walker.body }),
    });
    i = rows.close + 1;
  }
  return out;
}

/** `cases := []struct{ … }{ {…}, … }` — Go's own convention. */
function findGoStructTable(text: string, profile: LiteralProfile | undefined): CaseTable[] {
  const out: CaseTable[] = [];
  for (const at of wordOccurrences(text, "struct", profile)) {
    // `[]struct` — the slice-of-anonymous-struct shape and nothing else.
    const before = text.slice(Math.max(0, at - 8), at);
    if (!/\[\s*\]\s*$/.test(before)) {
      continue;
    }
    const fieldsOpen = skipSpace(text, at + "struct".length);
    if (text[fieldsOpen] !== "{") {
      continue;
    }
    const fieldsClose = matchDelim(text, fieldsOpen, profile);
    if (fieldsClose === -1) {
      continue;
    }
    const knobs = goStructFieldNames(text.slice(fieldsOpen + 1, fieldsClose));
    const valuesOpen = skipSpace(text, fieldsClose + 1);
    if (text[valuesOpen] !== "{") {
      continue;
    }
    const rows = rowsFromList(text, valuesOpen, "{", profile, goLastColumn);
    if (rows === undefined) {
      continue;
    }
    const walker = goWalkerAfter(text, rows.close, goAssignedName(text, at), profile);
    out.push({
      region: { start: at, end: rows.close + 1 },
      expected: rows.expected,
      knobs,
      ...(walker === undefined ? {} : { body: walker }),
    });
  }
  return out;
}

/** Go binds the ROW (`for _, tt := range cases`), not the columns, so only the
 *  body is wanted here. The list name is not required to match: a table declared
 *  at file scope is walked by a loop that may name it anything.
 *
 *  TWO SHAPES, and missing the second refused every reply that used it. The
 *  table may be declared and then ranged over by name, in which case the `range`
 *  is AFTER it; or it may be written inline INSIDE the range header
 *  (`for _, tt := range []struct{…}{…} {`), in which case the `range` is BEFORE
 *  it and the body is simply the block that opens once the literal closes. The
 *  inline form is idiomatic Go and the first cut searched forward only, so it
 *  paired table one with table two's loop and called every column of the first
 *  dead. */
function goWalkerAfter(
  text: string,
  from: number,
  listName: string | undefined,
  profile?: LiteralProfile,
): TableSpan | undefined {
  // Inline: nothing but whitespace between the literal's close and the block.
  const next = skipSpace(text, from + 1);
  if (text[next] === "{") {
    return blockAfter(text, from + 1, profile);
  }
  // Named: range over THIS table. Taking the first `range` after the declaration
  // bounded the body to whatever loop happened to come next — one unrelated
  // `for _, s := range []string{"warm"}` between the table and its own loop was
  // enough to call every column dead.
  if (listName !== undefined) {
    const at = text.indexOf(`range ${listName}`, from);
    if (at !== -1) {
      return blockAfter(text, at, profile);
    }
  }
  for (const at of wordOccurrences(text.slice(from), "range", profile)) {
    return blockAfter(text, from + at, profile);
  }
  return undefined;
}

/** The name a `[]struct` table is assigned to, when it is: `cases := []struct…`
 *  or `var cases = []struct…`. undefined for the inline form. */
function goAssignedName(text: string, structAt: number): string | undefined {
  const head = text.slice(Math.max(0, structAt - 80), structAt);
  const m = /([A-Za-z_]\w*)\s*(?::=|=)\s*\[\s*\]\s*$/.exec(head);
  return m === null ? undefined : m[1];
}

/** Field names out of an anonymous struct's body. `a, b int` binds two. */
function goStructFieldNames(body: string): string[] {
  const names: string[] = [];
  for (const line of body.split(/[;\n]/)) {
    const t = line.trim();
    if (t.length === 0) {
      continue;
    }
    // Everything up to the first token that is followed by no comma is the
    // name group; the rest is the type.
    const m = /^([A-Za-z_]\w*(\s*,\s*[A-Za-z_]\w*)*)\s+\S/.exec(t);
    if (m === null) {
      continue;
    }
    for (const n of m[1].split(",")) {
      names.push(n.trim());
    }
  }
  return names;
}

/** `it.each([ […, want], … ])('title', (a, b, want) => { … })` */
function findEachTable(text: string, profile: LiteralProfile | undefined): CaseTable[] {
  const out: CaseTable[] = [];
  for (const at of wordOccurrences(text, "each", profile)) {
    if (text[at - 1] !== ".") {
      continue;
    }
    const head = identBefore(text, at - 1);
    if (head !== "it" && head !== "test" && head !== "describe") {
      continue;
    }
    const callOpen = skipSpace(text, at + "each".length);
    if (text[callOpen] !== "(") {
      continue;
    }
    const listOpen = skipSpace(text, callOpen + 1);
    if (text[listOpen] !== "[") {
      continue;
    }
    // Rows are arrays OR objects. `it.each([{ a: 1, b: 2, want: 3 }])` is the
    // other idiomatic vitest/jest spelling (it is what `$a` in a title reads),
    // and the first cut refused to see it, so the object table fell through to
    // the inline locator and the runner's `toBe(want)` was blanked instead of
    // the rows.
    const rows =
      rowsFromList(text, listOpen, "[", profile, lastPositionalColumn) ??
      rowsFromList(text, listOpen, "{", profile, jsObjectLastColumn);
    if (rows === undefined) {
      continue;
    }
    const callClose = matchDelim(text, callOpen, profile);
    const afterList = callClose === -1 ? rows.close : callClose;
    out.push({
      region: { start: at, end: afterList + 1 },
      expected: rows.expected,
      knobs: arrowParamNames(text, afterList, profile),
      ...(() => {
        const body = callbackBody(text, afterList, profile);
        return body === undefined ? {} : { body };
      })(),
    });
  }
  return out;
}

/** A `{ a: 1, want: 3 }` row: the `want:` property when there is one, else the
 *  last property's value. Keyed rows are named, so a `want` key is authoritative
 *  wherever it sits. */
function jsObjectLastColumn(text: string, rowOpen: number, profile?: LiteralProfile): TableSpan | undefined {
  const parsed = topLevelElements(text, rowOpen, profile);
  if (parsed === undefined || parsed.elements.length < 2) {
    return undefined;
  }
  const keyed = parsed.elements.map((el) => ({
    el,
    m: /^(?:['"]?)([A-Za-z_$][\w$]*)(?:['"]?)\s*:\s*/.exec(text.slice(el.start, el.end)),
  }));
  const want = keyed.find((k) => k.m !== null && k.m[1] === "want");
  const chosen = want ?? keyed[keyed.length - 1];
  return chosen.m === null
    ? chosen.el
    : { start: chosen.el.start + chosen.m[0].length, end: chosen.el.end };
}

/** The body of the `it.each` callback: after the arrow, or after a `function`
 *  form's parameter list. The parameter list itself is what BINDS the columns,
 *  so it is outside. */
function callbackBody(text: string, afterList: number, profile?: LiteralProfile): TableSpan | undefined {
  const second = skipSpace(text, afterList + 1);
  if (text[second] !== "(") {
    return undefined;
  }
  const parsed = topLevelElements(text, second, profile);
  if (parsed === undefined) {
    return undefined;
  }
  for (const el of parsed.elements) {
    // The arrow must be found with the SCANNER, not `indexOf`: a test title is
    // an ordinary argument of this same call, and a title reading
    // `'add(%i, %i) => %i'` put the callback body inside the title string.
    const arrow = scannedIndexOf(text, "=>", el.start, el.end, profile);
    if (arrow !== -1) {
      return blockAfter(text, arrow + 2, profile) ?? { start: arrow + 2, end: el.end };
    }
    if (/^\s*function\b/.test(text.slice(el.start, el.end))) {
      const open = text.indexOf("(", el.start);
      const close = open === -1 ? -1 : matchDelim(text, open, profile);
      if (close !== -1) {
        return blockAfter(text, close + 1, profile);
      }
    }
  }
  return undefined;
}

/** The parameter names of the callback in the SECOND call after an `it.each`
 *  list: `(…)('title', (a, b, want) => { … })`.
 *
 *  The callback may be a `function (a, b, want) { … }` rather than an arrow, and
 *  it may take ONE destructured object (`({ a, b, want })`) when the rows are
 *  objects. Missing the knobs is not a cosmetic loss: without them the runner's
 *  read falls back to the conventional-name set alone, and a column named
 *  anything else gets blanked in the assertion. */
function arrowParamNames(text: string, afterList: number, profile?: LiteralProfile): string[] {
  const second = skipSpace(text, afterList + 1);
  if (text[second] !== "(") {
    return [];
  }
  const parsed = topLevelElements(text, second, profile);
  if (parsed === undefined) {
    return [];
  }
  for (const el of parsed.elements) {
    // `(a, b, want) => …` and `function (a, b, want) { … }` both put the list in
    // the first `(` of the element.
    let open = el.start;
    if (text[open] !== "(") {
      const at = text.indexOf("(", el.start);
      if (at === -1 || at >= el.end) {
        continue;
      }
      if (!/^\s*function\b/.test(text.slice(el.start, at))) {
        continue;
      }
      open = at;
    }
    const params = topLevelElements(text, open, profile);
    if (params === undefined) {
      continue;
    }
    const names: string[] = [];
    for (const p of params.elements) {
      const raw = text.slice(p.start, p.end).trim();
      // A destructured object parameter binds every name inside it.
      if (raw.startsWith("{")) {
        const inner = topLevelElements(text, p.start, profile);
        for (const q of inner?.elements ?? []) {
          const n = text.slice(q.start, q.end).split(":")[0].trim();
          if (IDENT.test(n)) {
            names.push(n);
          }
        }
        continue;
      }
      const n = raw.split(":")[0].trim();
      if (IDENT.test(n)) {
        names.push(n);
      }
    }
    if (names.length > 0) {
      return names;
    }
  }
  return [];
}

/** `@pytest.mark.parametrize("a,b,want", [ (…, want), … ])` */
function findParametrizeTable(text: string, profile: LiteralProfile | undefined): CaseTable[] {
  const out: CaseTable[] = [];
  for (const at of wordOccurrences(text, "parametrize", profile)) {
    const callOpen = skipSpace(text, at + "parametrize".length);
    if (text[callOpen] !== "(") {
      continue;
    }
    const parsed = topLevelElements(text, callOpen, profile);
    if (parsed === undefined || parsed.elements.length < 2) {
      continue;
    }
    const knobs = pyArgNames(text.slice(parsed.elements[0].start, parsed.elements[0].end));
    const listSpan = parsed.elements[1];
    if (text[listSpan.start] !== "[") {
      continue;
    }
    const rows = rowsFromList(text, listSpan.start, "(", profile, lastPositionalColumn);
    if (rows === undefined) {
      continue;
    }
    out.push({
      region: { start: at, end: parsed.close + 1 },
      expected: rows.expected,
      knobs,
      ...(() => {
        const body = pyDefBody(text, parsed.close, profile);
        return body === undefined ? {} : { body };
      })(),
    });
  }
  return out;
}

/** The suite of the `def test_…(…):` the parametrize decorator sits on. The
 *  parameter list BINDS the argnames, so the body starts after its colon. */
function pyDefBody(text: string, from: number, profile?: LiteralProfile): TableSpan | undefined {
  for (const at of wordOccurrences(text.slice(from), "def", profile)) {
    const open = text.indexOf("(", from + at);
    if (open === -1) {
      return undefined;
    }
    const close = matchDelim(text, open, profile);
    return close === -1 ? undefined : blockAfter(text, close + 1, profile);
  }
  return undefined;
}

/** `"a,b,want"` or `["a", "b", "want"]` — parametrize's two argname spellings. */
function pyArgNames(raw: string): string[] {
  const inner = raw.trim().replace(/^[[(]|[\])]$/g, "");
  return inner
    .split(",")
    .map((n) => n.trim().replace(/^['"]|['"]$/g, "").trim())
    .filter((n) => IDENT.test(n));
}

/** `[TestCase(…, want)]`, `[InlineData(…, want)]`, `[DataRow(…, want)]`.
 *
 *  Each attribute is one row. A contiguous run of them on one method is one
 *  table, so the region covers the run and the knobs are the method's own
 *  parameter names. NUnit's named `ExpectedResult = …` wins over the last
 *  positional argument when present, because that is where NUnit reads it. */
function findAttributeTable(text: string, profile: LiteralProfile | undefined): CaseTable[] {
  const rows: Array<{ attrStart: number; attrEnd: number; expected: TableSpan }> = [];
  for (const name of ["TestCase", "InlineData", "DataRow"]) {
    for (const at of wordOccurrences(text, name, profile)) {
      // `[Name(` — the attribute form. `[TestCaseSource(` is a different thing
      // and is excluded by the word boundary.
      let b = at - 1;
      while (b >= 0 && /\s/.test(text[b])) {
        b--;
      }
      if (text[b] !== "[") {
        continue;
      }
      const callOpen = skipSpace(text, at + name.length);
      if (text[callOpen] !== "(") {
        continue;
      }
      const parsed = topLevelElements(text, callOpen, profile);
      if (parsed === undefined || parsed.elements.length === 0) {
        continue;
      }
      const expected = csExpectedArgument(text, parsed.elements);
      if (expected === undefined) {
        continue;
      }
      rows.push({ attrStart: b, attrEnd: parsed.close, expected });
    }
  }
  if (rows.length === 0) {
    return [];
  }
  rows.sort((x, y) => x.attrStart - y.attrStart);
  // Group into RUNS. Attributes on ONE method are one table; a method BODY
  // between two attributes starts a new one. Without this a reply holding a
  // table AND a separate single-case test (the multi-group rule) would report
  // one region spanning both, and the single case's own expected value would be
  // dropped as "inside the table" - a hole silently lost.
  //
  // The discriminator is a `}` or `;` in the GAP between one attribute's closing
  // paren and the next attribute's `[`. A brace inside an attribute's own
  // arguments (`[InlineData(new[]{1,2})]`) sits before that close and is not in
  // the gap.
  const out: CaseTable[] = [];
  let run = [rows[0]];
  for (let k = 1; k < rows.length; k++) {
    const gap = text.slice(rows[k - 1].attrEnd, rows[k].attrStart);
    if (/[};]/.test(gap)) {
      out.push(attributeRunTable(text, run, profile));
      run = [];
    }
    run.push(rows[k]);
  }
  out.push(attributeRunTable(text, run, profile));
  return out;
}

function attributeRunTable(
  text: string,
  run: Array<{ attrStart: number; attrEnd: number; expected: TableSpan }>,
  profile: LiteralProfile | undefined,
): CaseTable {
  const end = run[run.length - 1].attrEnd;
  const params = csMethodParamsSpan(text, end, profile);
  const body = params === undefined ? undefined : blockAfter(text, params.end + 1, profile);
  return {
    region: { start: run[0].attrStart, end: end + 1 },
    expected: run.map((r) => r.expected),
    knobs: csMethodParamNames(text, end, profile),
    ...(body === undefined ? {} : { body }),
  };
}

/** The `( … )` of the first method head after the attribute run. */
function csMethodParamsSpan(text: string, from: number, profile?: LiteralProfile): TableSpan | undefined {
  // The LAST group before the body, not the first. A method returning a tuple
  // writes `public (int, int) ShardOf(string key)`, and taking the first `(`
  // read the RETURN TYPE as the parameter list — so `int` came back as a column
  // name and the pass was refused for a column that does not exist.
  let last: TableSpan | undefined;
  let i = from;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (text[i] === "(") {
      const close = matchDelim(text, i, profile);
      if (close === -1) {
        return last;
      }
      last = { start: i, end: close };
      i = close + 1;
      continue;
    }
    if (text[i] === "{" || text[i] === ";") {
      return last;
    }
    i++;
  }
  return last;
}

/** NUnit's `ExpectedResult = <value>` if present, else the last POSITIONAL
 *  argument. A row of one argument has no input to distinguish from its own
 *  expected value and is not a row. */
function csExpectedArgument(text: string, args: readonly TableSpan[]): TableSpan | undefined {
  const named = /^([A-Za-z_]\w*)\s*=(?!=)\s*/;
  for (const a of args) {
    const m = named.exec(text.slice(a.start, a.end));
    if (m !== null && m[1] === "ExpectedResult") {
      return { start: a.start + m[0].length, end: a.end };
    }
  }
  const positional = args.filter((a) => named.exec(text.slice(a.start, a.end)) === null);
  return positional.length < 2 ? undefined : positional[positional.length - 1];
}

/** The parameter names of the first method head after the attribute run. Reads
 *  the SAME span `csMethodParamsSpan` picks, so the names and the body cannot be
 *  taken from two different parameter lists — which is exactly what happened
 *  when only one of the two was taught about a tuple return type. */
function csMethodParamNames(text: string, from: number, profile?: LiteralProfile): string[] {
  const params = csMethodParamsSpan(text, from, profile);
  if (params === undefined) {
    return [];
  }
  const parsed = topLevelElements(text, params.start, profile);
  if (parsed === undefined) {
    return [];
  }
  return parsed.elements
    .map((p) => {
      const parts = text.slice(p.start, p.end).trim().split(/\s+/);
      return parts.length > 0 ? parts[parts.length - 1].replace(/^[^A-Za-z_]*/, "") : "";
    })
    .filter((n) => IDENT.test(n));
}

// ===========================================================================
// The registry, and what the locators call
// ===========================================================================

export type TableFinder = (text: string, profile: LiteralProfile | undefined) => CaseTable[];

/** Rust and Python/unittest: `cases = [ (…), … ]` plus a destructuring loop.
 *
 *  Rust is the ONLY leg that reads a type annotation in front of the table. See
 *  the flag's use inside the finder for what happened when Python could. */
export const assignedTupleTables: TableFinder = (text, profile) => findAssignedTupleTable(text, profile, true);
export const goStructTables: TableFinder = findGoStructTable;
export const eachTables: TableFinder = findEachTable;
export const parametrizeTables: TableFinder = findParametrizeTable;
export const attributeTables: TableFinder = findAttributeTable;

/** Python carries both shapes: pytest's decorator and unittest's plain list. */
export const pyTables: TableFinder = (text, profile) => [
  ...findParametrizeTable(text, profile),
  ...findAssignedTupleTable(text, profile, false),
];

export interface MergedSpans {
  spans: TableSpan[];
  /** Located spans that were row REFERENCES with no table parsed. The floor
   *  refuses the pass on a non-zero count, which is the honest outcome for a
   *  table this locator could not read. */
  unresolvedRowRefs: number;
}

/**
 * Merge a table's row spans with whatever the language's INLINE locator found,
 * applying the two rules that keep the result safe.
 *
 * An inline span INSIDE a table's region is dropped: a pytest row carrying a
 * top-level `==` in an input column is the case, and emitting both would return
 * overlapping spans, which corrupts the blanker's slice loop.
 *
 * An inline span that is a ROW REFERENCE is dropped too, and counted when no
 * table was parsed. That count is the whole safety net: it turns "the model
 * wrote a table I cannot read" from a silently mis-blanked snippet into a
 * refusal that names itself.
 */
export function mergeTableAndInline(
  text: string,
  tables: readonly CaseTable[],
  inline: readonly TableSpan[],
): MergedSpans {
  const knobs = tables.flatMap((t) => t.knobs);
  const spans: TableSpan[] = tables.flatMap((t) => t.expected);
  let unresolvedRowRefs = 0;
  for (const s of inline) {
    if (tables.some((t) => s.start >= t.region.start && s.end <= t.region.end)) {
      continue;
    }
    if (isRowReference(text.slice(s.start, s.end), knobs)) {
      if (tables.length === 0) {
        unresolvedRowRefs++;
      }
      continue;
    }
    spans.push(s);
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  // Non-overlapping, always: the blanker's slice loop emits a corrupt snippet
  // otherwise. A later span starting inside an earlier one is dropped rather
  // than clipped, because a clipped expected value is a half-blanked literal.
  const out: TableSpan[] = [];
  let lastEnd = -1;
  for (const s of spans) {
    if (s.start < lastEnd || s.end < s.start) {
      continue;
    }
    out.push(s);
    lastEnd = s.end;
  }
  return { spans: out, unresolvedRowRefs };
}

/**
 * The columns a table BINDS and its runner never READS.
 *
 * Rows are cheap and columns are not. A sparse table is one line from being
 * better; a table whose columns cannot express a contract clause is stuck,
 * because rewriting the tuple type means rewriting every row. So the prompt asks
 * for no dead column AND this checks for one, because a model will not obey it:
 * the measured harness-and-rows arm declared a `max_bytes` knob, put it in the
 * failure message, and never used it — the cap was a module constant and could
 * not be passed in at all.
 *
 * A read is a WORD occurrence in the body, outside literals and comments. That
 * exclusion is the rung, not a detail: `t.Errorf("… under maxBytes", got)` names
 * the column in prose and passes nothing, which is exactly the arm's shape, while
 * `t.Errorf("… %d", tt.maxBytes)` reads it.
 *
 * A table with no body the finder could bound reports NOTHING. Refusing on a
 * body this could not read would cost a human a working pass to buy a guess.
 */
export function deadColumns(text: string, tables: readonly CaseTable[], profile?: LiteralProfile): string[] {
  // A HALF-WRITTEN reply gets no verdict. This rung REFUSES the whole pass, so
  // the cost of being wrong is asymmetric: a false refusal takes a working pass
  // away from the human, while a missed dead column leaves them exactly where
  // they already were. Unbalanced delimiters or an unterminated literal mean the
  // text is not the artefact this was meant to judge, and a column the human
  // never finished typing is not a column the body failed to read.
  if (!looksComplete(text, profile)) {
    return [];
  }
  const dead: string[] = [];
  for (const table of tables) {
    if (table.body === undefined) {
      continue;
    }
    const read = wordsIn(text.slice(table.body.start, table.body.end), profile);
    for (const knob of table.knobs) {
      if (!read.has(knob) && !dead.includes(knob)) {
        dead.push(knob);
      }
    }
  }
  return dead;
}

/** Every identifier in `body`, outside literals and comments. One pass with the
 *  shared scanner, so a name inside a Go raw string or a Python docstring is not
 *  a read. */
function wordsIn(body: string, profile?: LiteralProfile): Set<string> {
  const out = new Set<string>();
  let i = 0;
  while (i < body.length) {
    const skipped = skipLiteralOrComment(body, i, profile);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (/[A-Za-z_$]/.test(body[i])) {
      let j = i;
      while (j < body.length && /[A-Za-z0-9_$]/.test(body[j])) {
        j++;
      }
      out.add(body.slice(i, j));
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

/** Are the text's delimiters balanced and its literals closed?
 *
 *  Not a parser and not trying to be. It answers one question: is this text
 *  whole enough to draw a REFUSAL from. */
function looksComplete(text: string, profile?: LiteralProfile): boolean {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const opener = text[i];
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      // A skip that runs to the very end may be an UNTERMINATED literal. A line
      // comment legitimately runs to the end; a quoted string or a block comment
      // does not.
      if (skipped >= text.length && !isLineCommentOpener(text, i, profile)) {
        const region = text.slice(i, skipped);
        const closed =
          region.length > 1 &&
          (region.endsWith(opener) || region.endsWith("*/"));
        if (!closed) {
          return false;
        }
      }
      i = skipped;
      continue;
    }
    if ("([{".includes(text[i])) {
      depth++;
    } else if (")]}".includes(text[i])) {
      depth--;
      if (depth < 0) {
        return false;
      }
    }
    i++;
  }
  return depth === 0;
}

function isLineCommentOpener(text: string, i: number, profile?: LiteralProfile): boolean {
  if (profile?.hashComments === true) {
    return text[i] === "#";
  }
  return text[i] === "/" && text[i + 1] === "/";
}

/** `indexOf` that respects literals and comments, bounded to `[from, to)`.
 *  Exists because a test TITLE is an ordinary string argument sitting beside the
 *  callback, and a raw `indexOf("=>")` found the arrow inside it. */
function scannedIndexOf(
  text: string,
  needle: string,
  from: number,
  to: number,
  profile?: LiteralProfile,
): number {
  let i = from;
  while (i < to) {
    const skipped = skipLiteralOrComment(text, i, profile);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (text.startsWith(needle, i)) {
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Where a Python suite introduced by the `:` at `colon` ends.
 *
 * The suite runs while lines are blank or indented DEEPER than the line the
 * colon sits on. That is the language's own rule, and it is what stops one
 * parametrized test's body from swallowing the next one's.
 */
function pySuiteEnd(text: string, colon: number): number {
  const lineStart = text.lastIndexOf("\n", colon) + 1;
  const headerIndent = /^[ \t]*/.exec(text.slice(lineStart))?.[0].length ?? 0;
  let i = text.indexOf("\n", colon);
  if (i === -1) {
    return text.length;
  }
  while (i < text.length) {
    const nextBreak = text.indexOf("\n", i + 1);
    const end = nextBreak === -1 ? text.length : nextBreak;
    const line = text.slice(i + 1, end);
    if (line.trim().length > 0) {
      const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
      if (indent <= headerIndent) {
        return i + 1;
      }
    }
    if (nextBreak === -1) {
      return text.length;
    }
    i = nextBreak;
  }
  return text.length;
}
