/**
 * The pure half of span resolution: the declaration-head trivia walk and
 * the symbol-shape guard. Lives in core so decorator/attribute shapes are
 * provable headless; src/vscode/fnGen.ts supplies line access and positions.
 */

/**
 * First line of the declaration itself: walks down from the symbol range
 * start past doc comments, line comments, block comments, attributes
 * (`#[...]` / `#![...]` and bare `[...]`, multi-line via bracket balance),
 * and decorators (`@...`, multi-line via combined paren/brace/bracket
 * balance). Enclosure counting skips string/template-literal contents
 * (`"`, `'`, backtick, with backslash escapes), so a `)` inside a
 * decorator string never closes the construct early.
 *
 * Two safety properties, both span-shrinking:
 * - the walk never passes `nameLine` (the line holding the symbol name);
 * - when the walk breaks before `nameLine` on a line that starts with a
 *   closer (`)`, `]`, `}`) — provably mid-construct, the counting must
 *   have been fooled — the head falls forward to `nameLine` instead of
 *   landing inside the construct.
 *
 * These shapes are the documented extent of what head normalization
 * handles; leading trivia outside them stays inside the span.
 */
export function declarationHeadLine(
  getLine: (line: number) => string,
  startLine: number,
  nameLine: number,
  // The language's line-comment token(s). Defaults to `[]`,
  // which makes the bare-comment skip below DEAD for every existing Rust/TS/C#
  // caller (byte-identical). Python passes `["#"]` so a `#` comment between a
  // decorator and the `def` is walked. Ordered AFTER the `#[`/`#![` attribute
  // branch, so a Rust `#[derive]` opens an attribute construct, never a skip, and
  // a C# `#region`/`#pragma` (which passes `[]`) is never treated as a comment.
  lineComments: readonly string[] = [],
): number {
  const candidate = triviaWalk(getLine, startLine, nameLine, lineComments);
  if (candidate < nameLine && /^[)\]}]/.test(getLine(candidate).trim())) {
    // The break line opens with a closer: the walk is provably inside a
    // construct the counting failed to model. Shrink to the name line —
    // never hand out a mid-construct head.
    return nameLine;
  }
  return candidate;
}

/**
 * The raw walk: the first line at or after `startLine` that is not trivia, or
 * `nameLine`, whichever comes first. No shrink-forward.
 *
 * Split out of `declarationHeadLine` because its two callers want opposite
 * things from the mid-construct case. Head normalization wants the SAFE answer
 * (shrink to the name line, never hand out a mid-construct head), which is the
 * span-shrinking direction. An AUDITOR wants the TRUE answer, because
 * "the walk broke on a closer" is a "the counting was fooled" signal, and
 * reading the shrunk answer as a confirmation is how a comment above a `});`
 * attaches to the declaration below it.
 */
function triviaWalk(
  getLine: (line: number) => string,
  startLine: number,
  nameLine: number,
  lineComments: readonly string[],
): number {
  let line = startLine;
  let inBlockComment = false;
  // A multi-line attribute/decorator currently being consumed.
  let construct: Construct | undefined;
  while (line < nameLine) {
    const text = getLine(line).trim();
    if (inBlockComment) {
      if (text.includes("*/")) {
        inBlockComment = false;
      }
      line++;
      continue;
    }
    if (construct) {
      scanLine(text, construct.state, construct.allEnclosures);
      if (construct.state.depth <= 0 && construct.state.literal === undefined) {
        construct = undefined;
      }
      line++;
      continue;
    }
    if (text === "" || text.startsWith("//")) {
      line++;
      continue;
    }
    if (text.startsWith("/*")) {
      if (!text.includes("*/")) {
        inBlockComment = true;
      }
      line++;
      continue;
    }
    // Rust-style and bare (C#-style) attributes: bracket-balanced.
    if (text.startsWith("#[") || text.startsWith("#![") || text.startsWith("[")) {
      construct = openConstruct(text, false);
      line++;
      continue;
    }
    // Language line comments: a Python `#` comment inside decorator trivia.
    // AFTER the `#[`/`#![` attribute branch above, so a Rust attribute is never
    // caught here; dead when lineComments is [] (every non-Python caller).
    if (lineComments.some((token) => text.startsWith(token))) {
      line++;
      continue;
    }
    // Decorators take arbitrary argument expressions (`@Component({...})`),
    // so continuation tracks parens, braces, and brackets together.
    if (text.startsWith("@")) {
      construct = openConstruct(text, true);
      line++;
      continue;
    }
    break;
  }
  return Math.min(line, nameLine);
}

/**
 * First line of the contiguous trivia run belonging to the declaration whose
 * name sits on `nameLine`, or `nameLine` itself when there is no run.
 *
 * This is the other half of the doc-comment question. `declarationHeadLine`
 * walks DOWN from a symbol range start and answers "where does the declaration
 * begin"; this walks UP from a name line and answers "how far above the
 * declaration does its trivia reach". Four of the five language servers exclude
 * a doc comment from the symbol's range, so a cursor parked in one is outside
 * every function and resolves to the enclosing container or to nothing at all.
 * This run is what makes that cursor mean the function it documents.
 *
 * Two steps, and there is still no second comment scanner. This function owns
 * exactly ONE rule, the blank line; `triviaWalk`, the shipped grammar, judges
 * everything that is trivia at all.
 *
 * 1. Find the contiguity boundary. A blank line ends the run, so a comment
 *    separated from a declaration by a blank line is a section marker rather
 *    than its doc.
 * 2. From that boundary, walk DOWN and ask the grammar to walk each candidate
 *    line all the way to `nameLine`. The first candidate that reaches it is the
 *    run start. A candidate that stops short stops at a line that is provably
 *    not trivia, so nothing at or above THAT line can be either, and the scan
 *    jumps straight past it.
 *
 * Topmost-first is what makes this correct, and it took a review to see why.
 * The earlier shape walked upward taking the last confirmation, which reads
 * `declarationHeadLine`'s answer at face value — and that function SHRINKS
 * FORWARD to `nameLine` when it breaks mid-construct. So a comment sitting
 * above a `});` was confirmed as trivia of the declaration below the brace, and
 * a cursor parked in an object literal resolved to the next function.
 * `triviaWalk` is the same walk without the shrink, which is the honest
 * auditor. There is no miss budget any more either, and that removes a second
 * defect: every interior line of a `/** ... *​/` cost one miss, so a doc comment
 * past about eighteen lines silently stopped attaching.
 *
 * A candidate indented DEEPER than the declaration is refused, and that rule is
 * Python's. In a brace language the `}` closing the previous body is not trivia,
 * so a trailing comment at the end of one function can never reach the next one.
 * Python has no such line: measured against live Pylance on 2026-07-28, a
 * function's range ENDS before a trailing `# note` (`range = L12-L14` with the
 * comment on L15), so that comment sits outside every symbol and the run walked
 * straight into the `def` below it. Generate and repair would have rewritten the
 * wrong method. Indentation is what a Python developer means by "belongs to", and
 * a doc comment is never indented deeper than the thing it documents in any of
 * the five languages. Block-comment interior lines ARE indented one deeper, and
 * they are unaffected: only the opener is ever a candidate in its own right.
 *
 * Cost is one pass to the boundary plus one grammar walk per non-trivia line
 * inside the run. A doc comment of any length is a single walk. The bad shape
 * is a long run with many non-trivia lines and no blank line in it, which is a
 * user-pressed gesture spending microseconds, never the keystroke path.
 */
export function attachRunStart(
  getLine: (line: number) => string,
  nameLine: number,
  lineComments: readonly string[] = [],
): number {
  let runTop = nameLine;
  while (runTop > 0 && getLine(runTop - 1).trim() !== "") {
    runTop--;
  }
  const headIndent = indentWidth(getLine(nameLine));
  let line = runTop;
  while (line < nameLine) {
    const reached = triviaWalk(getLine, line, nameLine, lineComments);
    if (reached !== nameLine) {
      line = reached + 1;
      continue;
    }
    if (indentWidth(getLine(line)) > headIndent) {
      line++;
      continue;
    }
    return line;
  }
  return nameLine;
}

// Leading whitespace characters. A tab counts as one, which is sound because the
// comparison is only ever between two lines of the same file.
function indentWidth(text: string): number {
  let i = 0;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) {
    i++;
  }
  return i;
}

/** A symbol reduced to the only thing attachment needs: the 0-based line
 *  holding its own name (`selectionRange.start.line` on the vscode side). */
export interface AttachCandidate {
  nameLine: number;
}

/**
 * Index of the candidate whose trivia run the cursor sits in, or -1.
 *
 * Nearest below the cursor wins, and that ordering is the container guard. A
 * class doc comment sits above the `class` head and above every method's doc,
 * so the class is the nearer candidate and takes the comment; a method can
 * never steal its container's doc. A cursor in a method's own doc comment sits
 * BELOW the class head, which makes the class ineligible, so the method takes
 * it.
 *
 * `candidates` is read-only and may arrive in any order.
 */
export function attachedCandidateIndex(
  candidates: readonly AttachCandidate[],
  getLine: (line: number) => string,
  cursorLine: number,
  lineComments: readonly string[] = [],
): number {
  const eligible = candidates
    .map((candidate, index) => ({ nameLine: candidate.nameLine, index }))
    // A declaration at or above the cursor cannot own trivia the cursor is in.
    .filter((c) => c.nameLine > cursorLine)
    .sort((a, b) => a.nameLine - b.nameLine || a.index - b.index);
  // A run never crosses a blank line, so the first blank line at or below the
  // cursor is a hard ceiling on every remaining candidate. Scanning for it once,
  // amortized across the ascending loop, is what stops a cursor on a blank line
  // (or in the gap between two declarations) from auditing the rest of the file.
  let scanned = cursorLine - 1;
  for (const { nameLine, index } of eligible) {
    while (scanned < nameLine - 1) {
      scanned++;
      if (getLine(scanned).trim() === "") {
        return -1;
      }
    }
    // runStart === nameLine means "no run", and it cannot satisfy this either,
    // because every eligible nameLine is strictly below the cursor.
    if (attachRunStart(getLine, nameLine, lineComments) <= cursorLine) {
      return index;
    }
  }
  return -1;
}

interface ScanState {
  depth: number;
  /** The quote character an unterminated literal is waiting on. */
  literal: string | undefined;
}

interface Construct {
  state: ScanState;
  allEnclosures: boolean;
}

function openConstruct(text: string, allEnclosures: boolean): Construct | undefined {
  const state: ScanState = { depth: 0, literal: undefined };
  scanLine(text, state, allEnclosures);
  return state.depth > 0 || state.literal !== undefined ? { state, allEnclosures } : undefined;
}

// Enclosure balance outside string/template literals. Literal state
// survives across lines (multi-line template literals); a backslash escapes
// the next character inside a literal.
function scanLine(text: string, state: ScanState, allEnclosures: boolean): void {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (state.literal !== undefined) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === state.literal) {
        state.literal = undefined;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      state.literal = ch;
    } else if (allEnclosures) {
      if (ch === "(" || ch === "{" || ch === "[") state.depth++;
      else if (ch === ")" || ch === "}" || ch === "]") state.depth--;
    } else {
      if (ch === "[") state.depth++;
      else if (ch === "]") state.depth--;
    }
    i++;
  }
}

/**
 * True when every TOP-LEVEL entry has the DocumentSymbol shape (range +
 * selectionRange + children). Symbol providers may legally answer with
 * SymbolInformation[] instead — no hierarchy, no selectionRange — and span
 * resolution has nothing sound to do with those: the caller degrades to
 * "no function here" rather than a TypeError.
 *
 * Top-level only, deliberately. It gates `resolveFunctionAtCursor` for the whole
 * product, so a recursive version would turn one malformed child node into "the
 * gesture does not fire on this file at all", against a class of server nobody
 * has produced. The consequence a caller must own: a CHILD node carrying no
 * `selectionRange` passes this, so anything descending into children cannot read
 * a true answer here as a promise about the nodes it reaches.
 */
export function hasDocumentSymbolShape(symbols: readonly unknown[]): boolean {
  return symbols.every(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      "range" in s &&
      "selectionRange" in s &&
      "children" in s,
  );
}
