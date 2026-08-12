/**
 * The render half of `Column 80: Tighten Doc Comment`: a region to the bytes that replace it.
 *
 * THE WORDS ARE THE HUMAN'S. This module moves whitespace and nothing else. No word is
 * composed, deleted or reordered here, which is what makes the no-new-claims rule unnecessary
 * rather than unenforceable: a renderer that cannot write cannot invent. The ship condition is
 * mechanical, not reviewed - strip ASCII whitespace and backticks from the region's prose and
 * from the replacement's prose and the two strings are equal, byte for byte. ASCII, because an
 * oracle that strips `\s` cannot see the one substitution it exists to catch.
 *
 * Four rules here each corrupt the comment if they are missed, and none of them is obvious:
 *
 * - A token wider than the budget takes its own line and OVERFLOWS it. A wrap that splits a
 *   path or a fully qualified name destroys the thing the next phase is about to backtick.
 * - A backticked span is ONE token, spaces included. It is the gesture that resolves a type's
 *   surface into the prompt, and half of it on each line resolves nothing.
 * - Some lines are not prose at all. A fence, an indented code block, a table row and a
 *   toolchain directive are emitted verbatim, and a link reference and a list item are their
 *   own unit. Merging any of them destroys the thing they are for, silently.
 * - The indent is the region's OWN, used verbatim. This product has shipped the indent-drift
 *   bug into three separate write paths, every one of them by re-deriving a column at write
 *   time instead of using the one the read captured. There is a press-twice test per language
 *   in `test/impl-v52-p1-render.test.cjs`, and it exists because reasoning about this bug has
 *   failed three times.
 *
 * Pure: no vscode, no clock, no I/O, and it never throws.
 */

import {
  TIGHTEN_COLUMN,
  TightenRegion,
  TightenTarget,
  docPrefixFor,
  resolveTightenRegion,
  tightenIsDirective,
  tightenListMarker,
  tightenOpensFence,
  tightenTabWidth,
  tightenTrim,
  tightenTrimEnd,
  tightenVerbatimLine,
  tightenParagraphs,
  tightenTokens,
  tightenWidth,
  wrapTokens,
} from "./tightenRegion";

export {
  TIGHTEN_COLUMN,
  TIGHTEN_PARAGRAPH_WORDS,
  tightenParagraphs,
  tightenTokens,
  TIGHTEN_TAB_WIDTH,
  docPrefixFor,
  resolveTightenRegion,
  servesTighten,
  tightenIsDirective,
  tightenListMarker,
  tightenOpensFence,
  tightenTrim,
  tightenVerbatimLine,
  tightenWords,
} from "./tightenRegion";
export type {
  TightenRegion,
  TightenRegionKind,
  TightenRegionResult,
  TightenTarget,
} from "./tightenRegion";

export type TightenRenderResult =
  | { ok: true; start: number; end: number; replacement: string; region: TightenRegion }
  | { ok: false; refusal: string };

type Unit =
  | { kind: "verbatim"; lines: string[] }
  | { kind: "marker"; indent: string; text: string }
  | { kind: "ordinary"; text: string };

type Item = { sep: true } | { sep: false; unit: Unit };

/**
 * Prose to units. A unit is never merged with its neighbour.
 *
 * `resolveTightenRegion` has already joined consecutive ordinary lines and every wrapped
 * continuation, so on the product path the joins below are a no-op. They are here for a caller
 * that builds a region by hand.
 *
 * The own-unit kinds are tested BEFORE the join, or an indented code block under a paragraph
 * would be swallowed by the paragraph. The one exception is a marker's continuation, which is
 * tested first of all so a line indented four columns under a `12. ` item is not read as an
 * indented code block.
 */
function unitsOf(prose: string, languageId: string, directives: boolean): Item[] {
  const items: Item[] = [];
  let fence: { kind: "verbatim"; lines: string[] } | undefined;
  for (const line of prose.split("\n")) {
    const trimmed = tightenTrim(line);
    if (fence !== undefined) {
      fence.lines.push(tightenTrimEnd(line));
      if (tightenOpensFence(trimmed)) {
        fence = undefined;
      }
      continue;
    }
    if (tightenOpensFence(trimmed)) {
      fence = { kind: "verbatim", lines: [tightenTrimEnd(line)] };
      items.push({ sep: false, unit: fence });
      continue;
    }
    if (trimmed === "") {
      if (items.length > 0 && items[items.length - 1].sep !== true) {
        items.push({ sep: true });
      }
      continue;
    }
    if (directives && tightenIsDirective(languageId, line)) {
      items.push({ sep: false, unit: { kind: "verbatim", lines: [tightenTrimEnd(line)] } });
      continue;
    }
    // Verbatim BEFORE the marker join, or a table row indented under a list item is swallowed
    // by the item. `normalizeProse` has already folded away every wrapped continuation, so an
    // indented line still standing here is a shape the human wrote.
    if (tightenVerbatimLine(line)) {
      items.push({ sep: false, unit: { kind: "verbatim", lines: [tightenTrimEnd(line)] } });
      continue;
    }
    const last = items[items.length - 1];
    const marker = tightenListMarker(trimmed);
    if (
      last !== undefined &&
      last.sep === false &&
      last.unit.kind === "marker" &&
      /^[ \t]/.test(line) &&
      marker === undefined
    ) {
      last.unit.text += ` ${trimmed}`;
      continue;
    }
    if (marker !== undefined) {
      // A nested list item keeps its own column. Dropping it was how a two-level list came back
      // as one level.
      items.push({
        sep: false,
        unit: { kind: "marker", indent: /^[ \t]*/.exec(line)?.[0] ?? "", text: trimmed },
      });
      continue;
    }
    if (last !== undefined && last.sep === false && last.unit.kind === "ordinary") {
      last.unit.text += ` ${trimmed}`;
      continue;
    }
    items.push({ sep: false, unit: { kind: "ordinary", text: trimmed } });
  }
  while (items.length > 0 && items[items.length - 1].sep === true) {
    items.pop();
  }
  return items;
}

/**
 * The replacement text for `region.start`..`region.end`. Ends with a newline when the region
 * did (`endsWithNewline`, absent meaning yes), in the region's own line ending (`lineEnding`,
 * absent meaning LF).
 *
 * `languageId` decides two things and no layout: which directives this language has, and the
 * FALLBACK prefix for a region built by hand with none. The region's own prefix wins whenever
 * it has one, captured from the line the developer wrote: re-deriving it from the language is
 * how a `//!` block would come back as `///`.
 */
export function renderRegion(region: TightenRegion, languageId: string, tabWidth?: number): string {
  if (region === null || typeof region !== "object" || typeof region.prose !== "string") {
    return "";
  }
  const tw = tightenTabWidth(tabWidth);
  const isDoc = region.kind === "docstring";
  const indent = typeof region.indent === "string" ? region.indent : "";
  const own = typeof region.prefix === "string" ? region.prefix : "";
  const prefix = isDoc ? "" : own !== "" ? own : docPrefixFor(languageId) ?? "";
  const opener = tightenTrimEnd(prefix);
  // Never below 1: a pathological indent must still terminate the fill, one token a line.
  const budget = Math.max(1, TIGHTEN_COLUMN - tightenWidth(indent, tw) - tightenWidth(prefix, tw));
  const out: string[] = [];
  const emit = (content: string) => out.push(tightenTrimEnd(`${indent}${prefix}${content}`));
  // A directive keeps whatever spacing it had, which is why it is put back on the OPENER and
  // not on the prefix: `//go:build` has no space to lose and `// +build` must not lose the one
  // it has. The parse hands the text after the opener over untouched for exactly this.
  const emitVerbatim = (content: string) => out.push(tightenTrimEnd(`${indent}${opener}${content}`));

  for (const item of unitsOf(region.prose, languageId, region.kind === "line-comment")) {
    if (item.sep) {
      // A paragraph separator is a BARE OPENER line, trailing whitespace stripped. In a
      // docstring the prefix is empty and it is a blank line.
      emit("");
      continue;
    }
    const unit = item.unit;
    if (unit.kind === "verbatim") {
      for (const line of unit.lines) {
        if (region.kind === "line-comment" && tightenIsDirective(languageId, line)) {
          emitVerbatim(line);
        } else {
          emit(line);
        }
      }
      continue;
    }
    if (unit.kind === "marker") {
      const marker = tightenListMarker(unit.text) ?? "";
      // The marker's own trailing whitespace is normalised to one space, which is the only
      // whitespace this branch invents and is why a wrapped list is stable on press two.
      const head = `${unit.indent}${tightenTrimEnd(marker)} `;
      const rest = unit.text.slice(marker.length);
      const cont = " ".repeat(tightenWidth(head, tw));
      for (const line of wrapTokens(tightenTokens(rest), budget, head, cont, tw)) {
        emit(line);
      }
      continue;
    }
    const paragraphs = tightenParagraphs(unit.text);
    for (let n = 0; n < paragraphs.length; n++) {
      if (n > 0) {
        emit("");
      }
      for (const line of wrapTokens(tightenTokens(paragraphs[n]), budget, "", "", tw)) {
        emit(line);
      }
    }
  }

  if (isDoc) {
    const quote = typeof region.quote === "string" && region.quote !== "" ? region.quote : '"""';
    // Delimiters keep their own lines even for a one-line docstring. Three lines is the only
    // shape that comes back identical on the second press.
    out.unshift(`${indent}${quote}`);
    out.push(`${indent}${quote}`);
  }
  const eol = region.lineEnding === "\r\n" ? "\r\n" : "\n";
  const body = out.join(eol);
  return region.endsWithNewline === false ? body : `${body}${eol}`;
}

/**
 * Cursor to an edit. This is the product path; every ship condition is stated against it.
 *
 * A refusal never edits: there is no `start`, no `end` and no `replacement` on that branch, so
 * a caller that forgets to check has nothing to apply.
 */
export function tightenAtCursor(target: TightenTarget): TightenRenderResult {
  const resolved = resolveTightenRegion(target);
  if (!resolved.ok) {
    return resolved;
  }
  const region = resolved.region;
  return {
    ok: true,
    start: region.start,
    end: region.end,
    replacement: renderRegion(region, target.languageId, target.tabWidth),
    region,
  };
}
