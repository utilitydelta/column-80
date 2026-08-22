/**
 * Pure support for the context-panel gestures, kept out of the vscode
 * layer so the sharp edges — multi-cursor ordering, selection line-range
 * math, preview clamping — test headless.
 */

import { ContextBlockRange } from "./prompt";

/** 0-based editor coordinates, as selections arrive from the editor. */
export interface SelectionShape {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/**
 * Multi-cursor add semantics: every non-empty selection becomes a block,
 * in document order — top of file first,
 * whatever order the cursors were placed in — so the panel's order is
 * predictable from the file, not from gesture history.
 */
export function orderedNonEmptySelections<T extends SelectionShape>(
  selections: readonly T[],
): T[] {
  return selections
    .filter((s) => !(s.startLine === s.endLine && s.startCharacter === s.endCharacter))
    .sort((a, b) => a.startLine - b.startLine || a.startCharacter - b.startCharacter);
}

/**
 * Cursor positions in document order, top of file first.
 *
 * Sibling of `orderedNonEmptySelections`, and the difference is the point: a
 * block gesture takes the CURSOR, so an empty selection is the normal input and
 * filtering empties would drop every cursor the human placed.
 */
export function orderedCursors<T extends { line: number; character: number }>(
  cursors: readonly T[],
): T[] {
  return [...cursors].sort((a, b) => a.line - b.line || a.character - b.character);
}

/**
 * 1-based inclusive range for a selection. A selection ending at column 0
 * dragged in the previous line's newline, not that line's content; counting it
 * would hand the model a line the human never selected, and every later resolve
 * would keep handing it over because the range is the block's identity.
 */
export function selectionLineRange(s: SelectionShape): ContextBlockRange {
  const endLine =
    s.endCharacter === 0 && s.endLine > s.startLine ? s.endLine : s.endLine + 1;
  return { startLine: s.startLine + 1, endLine };
}

/**
 * 0-based inclusive editor lines to the store's 1-based inclusive range, for a
 * symbol the AST picked rather than a selection the human dragged.
 *
 * `firstLine` is what `attachRunStart` answered for the symbol, NOT
 * `symbol.range.start.line`. That distinction is the whole point, and it was
 * measured: the symbol range carries the doc comment in Rust and drops it in
 * the other four servers, so anchoring on `range.start` ships a gesture that
 * produces a documented block in Rust and an undocumented one everywhere else,
 * on the same-looking code.
 */
export function symbolBlockRange(firstLine: number, lastLine: number): ContextBlockRange {
  return { startLine: firstLine + 1, endLine: lastLine + 1 };
}

/** A node of a selectionRange chain, in editor (0-based) coordinates. */
export interface ChainRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/** The enclosing symbol's 0-based inclusive line span: the ceiling a chain walk
 *  may not pass. */
export interface BlockBound {
  firstLine: number;
  lastLine: number;
}

/**
 * The block out of a `selectionRange` chain, or undefined when the chain offers
 * nothing usable (the caller then falls back to the enclosing symbol).
 *
 * `chain` arrives INNERMOST FIRST, the order the provider returns it in. Two
 * rules decide it, and they are the only two that need code:
 *
 * - Nothing outside `bound` qualifies. The top of every chain is the whole
 *   FILE, so a walk that runs to the end of the chain silently includes the
 *   entire file. When the enclosing symbol IS the whole file the two coincide
 *   and taking the node is the same answer.
 * - The answer is the innermost MULTI-LINE node. A one-line node is a statement
 *   or a token, never a block: the measured chains put `panic("not
 *   implemented")` and `return a + b` at that depth on all five servers.
 *
 * The other two traps the same measurement named need no code of their own,
 * and saying so beats carrying checks that look load-bearing and are not.
 * rust-analyzer's zero-width first node has `startLine === endLine`, so the
 * multi-line rule already excludes it. The near-duplicate neighbours every
 * server emits differ only by leading whitespace, so they share a LINE span;
 * the innermost of the pair is reached first and returned, and its twin is
 * never considered. Both traps come back the moment a caller wants single-line
 * blocks, which is why they are written down here rather than forgotten.
 *
 * Pure: neither argument is mutated, and the result is a COPY, so a caller
 * writing to it cannot reach back into the chain.
 */
export function chooseChainBlock(
  chain: readonly ChainRange[],
  bound: BlockBound,
): ChainRange | undefined {
  for (const node of chain) {
    if (node.startLine < bound.firstLine || node.endLine > bound.lastLine) {
      continue;
    }
    if (node.endLine > node.startLine) {
      return { ...node };
    }
  }
  return undefined;
}

// How much of a file the binary sniff reads. A 40MB file must cost the same as a
// 4KB one, and every real binary announces itself in the first page.
const BINARY_SNIFF_CHARS = 4096;
// A decode failure produces a FIELD of U+FFFD, not one. The floor keeps a source
// file that legitimately contains a replacement character out of the refusal.
const MOJIBAKE_FLOOR = 4;
const MOJIBAKE_FRACTION = 0.01;

/**
 * Whether decoded text is binary content rather than something a human meant to
 * show a model.
 *
 * The ONLY content-shaped refusal on the add-a-file path. Markdown, YAML, JSON, a
 * log and every other unsupported language add exactly like source does: the file
 * extension constrains where code may be GENERATED and has nothing to do with
 * what the human may show the model (goal decision 5).
 *
 * Empty text is NOT binary. Empty has its own refusal with its own message, and
 * conflating the two tells the human the wrong thing about their file.
 */
export function looksBinary(text: string): boolean {
  const head = text.length > BINARY_SNIFF_CHARS ? text.slice(0, BINARY_SNIFF_CHARS) : text;
  if (head.includes("\u0000")) {
    // No text file has a NUL. This is the whole of the cheap test.
    return true;
  }
  let replacements = 0;
  for (let i = 0; i < head.length; i++) {
    if (head.charCodeAt(i) === 0xfffd) {
      replacements++;
    }
  }
  return replacements >= MOJIBAKE_FLOOR && replacements > head.length * MOJIBAKE_FRACTION;
}

/**
 * Prefix of at most maxChars UTF-16 units for tooltip previews. A cut
 * landing between a high and low surrogate backs off one unit so the
 * preview always ends on a whole character — a lone surrogate renders as
 * U+FFFD garbage in the tooltip.
 */
export function truncatePreview(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const last = text.charCodeAt(maxChars - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? maxChars - 1 : maxChars;
  return text.slice(0, cut);
}
