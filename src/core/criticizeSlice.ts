// ===========================================================================
// The slicer: a document range in, a FunctionUnderReview out.
//
// This lives in src/core rather than in a harness because a grading harness
// that builds its own unit is measuring its own slicer and not the product's.
// Session-v29 measured exactly that defect: a re-derived mapping inverted an
// arm result, and nothing in the output said so. The gesture and the grader
// both call this function, so a slicing bug shows up in both or in neither.
// ===========================================================================

import {
  CriticizeLang,
  FunctionUnderReview,
  bodyLines,
  maskLine,
  unitDefect,
} from "./criticizeTypes";

/** Lines that may sit between a doc comment and the declaration head. Four of
 *  the five languages put something there (Rust `#[...]`, C# `[...]`,
 *  TypeScript decorators, Python `@...`), so an upward walk that stops at the
 *  first non-doc line finds no doc at all on any annotated function. Go has no
 *  such line and needs no entry. */
const ANNOTATION = /^(#!?\[|\[[A-Za-z_]|@[A-Za-z_])/;

/** Line shapes that are comment text in one of the five languages. Rust `///`
 *  and `//!`, Go's plain `//`, the C# `///`, the `/** ... *\/` block in three
 *  languages, and Python's `#`. This duplicates a private predicate in
 *  criticizeTypes on purpose: that one decides what COUNTS as doc text for a
 *  detector, this one decides how far up the slice reaches, and collapsing
 *  them would make a change to either silently move the other. */
const COMMENTARY = /^(\/\/|\/\*|\*|#(?!!?\[))/;

/** How many lines above `startLine` the upward walk may reach before it gives
 *  up. A doc block longer than this is real but vanishingly rare, and the
 *  bound keeps a malformed document from turning the walk into a file scan.
 *  CHOSEN, not measured. */
const MAX_DOC_WALK = 200;

/**
 * Builds the unit a detector reads, from a document's lines.
 *
 * `startLine` may point at the declaration head or at the first doc line. The
 * slicer walks UPWARD over contiguous doc comment and annotation lines either
 * way, so a caller holding only a symbol-tree head cannot hand the detectors a
 * slice with no doc in it. That accident read a real detector as 0.0% during
 * the scout, and the zero looked exactly like a clean result. Measured again
 * on the graded set: a slicer that drops the doc reads 29% of documented Rust
 * functions as undocumented.
 *
 * Returns undefined when no declaration head can be found in the range, or
 * when the slice that came out would not survive `unitDefect`. That is a
 * refusal, and it is never an empty-but-valid unit: a unit whose body was
 * never in the input reads clean on every body dimension, and a clean answer
 * nothing examined is the failure mode this whole subsystem is built around.
 *
 * Both line numbers are 1-based document lines, inclusive at both ends.
 */
export function sliceFunction(
  documentLines: readonly string[],
  startLine: number,
  endLine: number,
  name: string,
  lang: CriticizeLang,
): FunctionUnderReview | undefined {
  if (documentLines.length === 0 || startLine < 1 || endLine < startLine) {
    return undefined;
  }
  const from = startLine - 1;
  const to = Math.min(endLine, documentLines.length) - 1;
  if (from > to) {
    return undefined;
  }

  const headAt = findHead(documentLines, from, to);
  if (headAt === undefined) {
    return undefined;
  }
  const docAt = walkUp(documentLines, headAt);
  const bodyAt = findBody(documentLines, headAt, to, lang);
  if (bodyAt === undefined) {
    return undefined;
  }

  const fn: FunctionUnderReview = {
    languageId: lang.languageIds[0],
    name,
    lines: documentLines.slice(docAt, to + 1),
    startLine: docAt + 1,
    headIndex: headAt - docAt,
    // A body that shares the declaration line has no line of its own, so
    // `bodyIndex` lands one past the end. That is not a refusal: `bodyLines`
    // reads the head line's remainder for exactly this shape, and refusing
    // instead would blind the rubric to 307 expression-bodied members in the
    // production C# corpus and 79 of 697 functions in the measured Rust crate.
    bodyIndex: Math.min(bodyAt, to + 1) - docAt,
  };
  if (unitDefect(fn) !== undefined) {
    return undefined;
  }
  // The refusal that has to survive: a range stopping at the declaration head
  // with nothing after the opener yields a unit whose body was never in the
  // input. `unitDefect` permits that shape, because an empty body is legal for
  // a real function, so the check happens HERE, and it asks the SEAM rather
  // than re-deriving the answer. Every body dimension reads an empty body as
  // clean, and a clean answer nothing examined is what this subsystem exists
  // to stop.
  if (bodyLines(fn, lang).length > 0 || bodyAt <= to) {
    return fn;
  }
  // Nothing after the opener AND nothing below it. Two different things look
  // like this and only one is a defect. `fn stub(&self) {}` is a real function
  // with a genuinely empty body, and clean is the honest answer for it, so the
  // signature dimensions still get their card. A range TRUNCATED at the
  // declaration head is the defect, and the tell is that its opener is never
  // closed on the same line.
  const headEnd = maskLine(documentLines[Math.min(bodyAt - 1, to)], lang);
  const closesItself = lang.lineComment !== "#" && headEnd.includes("}");
  return closesItself ? fn : undefined;
}

/**
 * The declaration head, as the first line in the range that is neither blank,
 * nor commentary, nor an annotation.
 *
 * This is deliberately not a per-language declaration pattern. Five languages
 * spell a head five ways and two of them (C# and TypeScript) have no keyword
 * that reliably marks one, so a pattern per language would refuse real
 * functions and refusals here are invisible downstream. What IS true in all
 * five is that everything between the top of a function's slice and its head
 * is doc, annotation or blank.
 */
function findHead(
  lines: readonly string[],
  from: number,
  to: number,
): number | undefined {
  for (let i = from; i <= to; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || COMMENTARY.test(trimmed) || ANNOTATION.test(trimmed)) {
      continue;
    }
    return i;
  }
  return undefined;
}

/** The first line of the slice: walk up from the head over contiguous
 *  commentary and annotation lines. A blank line, or anything that is code,
 *  ends the block, so the walk cannot reach back into the function above. */
function walkUp(lines: readonly string[], headAt: number): number {
  let at = headAt;
  const floor = Math.max(0, headAt - MAX_DOC_WALK);
  while (at > floor) {
    const trimmed = lines[at - 1].trim();
    if (!COMMENTARY.test(trimmed) && !ANNOTATION.test(trimmed)) {
      break;
    }
    at--;
  }
  return at;
}

/**
 * The first line of the body proper.
 *
 * The four brace languages open a block, so the body starts after the line
 * carrying the `{` that follows a balanced parameter list. Python opens with a
 * `:` and then puts its DOC inside the body, so its body starts after the
 * docstring: `bodyIndex` pointing at the docstring would hand every honesty
 * detector a body whose first lines are prose.
 */
function findBody(
  lines: readonly string[],
  headAt: number,
  to: number,
  lang: CriticizeLang,
): number | undefined {
  const headEnd = findHeadEnd(lines, headAt, to, lang);
  if (headEnd === undefined) {
    return undefined;
  }
  if (lang.lineComment !== "#") {
    return headEnd + 1;
  }
  return headEnd + 1 + pythonDocstringSpan(lines, headEnd + 1, to);
}

/** The last line of the declaration head: the line carrying the body's opening
 *  brace, or Python's trailing colon. A `where` clause or a multi-line
 *  parameter list puts that several lines below the head. */
function findHeadEnd(
  lines: readonly string[],
  headAt: number,
  to: number,
  lang: CriticizeLang,
): number | undefined {
  let depth = 0;
  let opened = false;
  for (let i = headAt; i <= to; i++) {
    const masked = maskLine(lines[i], lang);
    for (const ch of masked) {
      if (ch === "(") {
        depth++;
        opened = true;
      } else if (ch === ")") {
        depth--;
      }
    }
    if (!opened || depth > 0) {
      continue;
    }
    if (lang.lineComment === "#") {
      if (masked.trimEnd().endsWith(":")) {
        return i;
      }
      continue;
    }
    if (masked.includes("{")) {
      return i;
    }
    // An expression-bodied member (`=> expr;`) never opens a block, and its
    // body is the head line itself. Reporting the head line as the head end
    // gives a body of whatever follows, which is the honest reading of a
    // declaration that has no block.
    if (masked.includes(";")) {
      return i;
    }
  }
  return undefined;
}

/** How many lines the docstring occupies at `at`, or 0 when there is none.
 *  Blank lines before the docstring count as part of the span so `bodyIndex`
 *  lands on real code either way. */
function pythonDocstringSpan(
  lines: readonly string[],
  at: number,
  to: number,
): number {
  let i = at;
  while (i <= to && lines[i].trim() === "") {
    i++;
  }
  if (i > to) {
    return 0;
  }
  const opener = lines[i].trim().match(/^(?:[rbfuRBFU]{0,2})('''|"""|'|")/);
  if (opener === null) {
    return 0;
  }
  const quote = opener[1];
  const first = lines[i].trim();
  const rest = first.slice(first.indexOf(quote) + quote.length);
  if (rest.includes(quote)) {
    return i + 1 - at;
  }
  for (let j = i + 1; j <= to; j++) {
    if (lines[j].includes(quote)) {
      return j + 1 - at;
    }
  }
  // An unterminated docstring is a broken file, and pretending the body starts
  // after it would drop the whole function. Leave the body where it was.
  return 0;
}
