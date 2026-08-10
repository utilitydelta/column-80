/**
 * Function-span math: validate a span against document text, splice a
 * replacement body, and the byte-compare-outside-span oracle.
 *
 * This module IS the enforcement point for the boundary invariant:
 * generation must never modify code outside the
 * target function's span. Splice and oracle live together so the exact
 * arithmetic the extension uses to apply an edit is the arithmetic the
 * integration oracle checks.
 */

/**
 * Half-open [start, end) offsets in UTF-16 code units into the document
 * text, the same unit VS Code's offsetAt/positionAt use. Producers live in
 * src/vscode/ (symbol provider) or tests; core never resolves spans itself.
 */
export interface FunctionSpan {
  start: number;
  end: number;
}

/**
 * Undefined when the span is well-formed for `text` (and, when
 * `expectedText` is given, still covers exactly that text — the stale-span
 * guard for edits that land after the document moved). Otherwise a
 * human-readable reason.
 *
 * The validity conditions are pure code-unit arithmetic; an offset that
 * splits a surrogate pair passes. Span producers (the symbol provider in
 * src/vscode/) never emit such offsets because their positions come from
 * document symbols, which sit on code-point boundaries.
 */
export function validateSpan(
  text: string,
  span: FunctionSpan,
  expectedText?: string,
): string | undefined {
  if (!Number.isInteger(span.start)) {
    return `span start ${span.start} is not an integer`;
  }
  if (!Number.isInteger(span.end)) {
    return `span end ${span.end} is not an integer`;
  }
  if (span.start < 0) {
    return `span start ${span.start} is negative`;
  }
  if (span.end < span.start) {
    return `span is inverted: start ${span.start} > end ${span.end}`;
  }
  if (span.end > text.length) {
    return `span end ${span.end} is past the text length ${text.length}`;
  }
  if (expectedText !== undefined && text.slice(span.start, span.end) !== expectedText) {
    return `span ${span.start}-${span.end} no longer covers the expected text (document changed since the span was resolved)`;
  }
  return undefined;
}

/** Replace exactly [span.start, span.end) of `text` with `replacement`.
 *  Throws on any span validateSpan would reject. */
export function spliceSpan(text: string, span: FunctionSpan, replacement: string): string {
  const reason = validateSpan(text, span);
  if (reason !== undefined) {
    throw new Error(`spliceSpan: ${reason}`);
  }
  return text.slice(0, span.start) + replacement + text.slice(span.end);
}

/**
 * The boundary oracle: true iff `result` could only have been produced from
 * `original` by replacing the span's interior — everything before span.start
 * and everything from span.end on is unchanged.
 */
export function byteCompareOutsideSpan(
  original: string,
  result: string,
  span: FunctionSpan,
): boolean {
  const reason = validateSpan(original, span);
  if (reason !== undefined) {
    throw new Error(`byteCompareOutsideSpan: ${reason}`);
  }
  const suffixLength = original.length - span.end;
  return (
    // Without the length floor, repetitive text can make the two slice
    // comparisons pass on a result that lost span-adjacent characters.
    result.length >= original.length - (span.end - span.start) &&
    result.slice(0, span.start) === original.slice(0, span.start) &&
    result.slice(result.length - suffixLength) === original.slice(span.end)
  );
}
