/**
 * The sketch keeper: the comments a developer sketched a body with survive the
 * model's reply, in order, so regenerating from the result reads the same spec.
 *
 * The model is the only party that knows which statement implements which
 * step, so where it kept a sketch line, that placement stands untouched. Only
 * the lines it dropped or reworded are placed by code, before the next
 * body-depth statement, which is approximate and reported as such.
 *
 * The reply is never edited. Every reply line survives byte-identical,
 * including comments the model added: the developer removes those if unwanted.
 *
 * Pure: no vscode, no clock, no I/O.
 */

import { scanBrackets } from "./brackets";
import { CommentHit, CommentSyntax, commentSyntaxFor, nextComment } from "./fimComment";
import {
  BodyCommentHit,
  bodyCommentHits,
  bodyTextOfSpan,
  bracketSyntaxFrom,
  harvestBodyComments,
  leadingWhitespace,
  pyBodyIndent,
} from "./scaffold";

export interface KeepSketchInput {
  languageId: string;
  /** The span the developer had: the full function, or for Python bodyOnly the body. */
  originalSpan: string;
  /** The model's extracted reply, the same shape as `originalSpan`. */
  reply: string;
  bodyOnly?: boolean;
  /** Python only, as `harvestBodyComments` takes it. Empty or absent derives it. */
  bodyIndent?: string;
}

export interface KeepSketchResult {
  text: string;
  /** Sketch lines the model kept, in order, unaided. */
  keptByModel: number;
  /** Sketch lines the tool placed, as the harvest renders them. */
  placedByTool: string[];
  /** Always empty: the tool never removes a comment. The field stays so that
   *  adding stripping later is a shape change a test sees. */
  stripped: string[];
  /** Sketch lines with no slot inside the reply's body, as the harvest renders
   *  them. A one-line function, an expression body or an empty reply has no
   *  line to place on without editing a reply line, and a line placed outside
   *  the function would not be the developer's spec anywhere. */
  unplaced: string[];
}

// One comment of the developer's sketch. A multi-line block comment is one unit
// with several lines: it is placed whole or counted kept whole, because half a
// block cannot be inserted without duplicating the half the model kept.
interface SketchUnit {
  lines: string[];
  /** The comment as written, one entry per source line, indentation removed. */
  source: string[];
  indent: string;
  /** False for a comment trailing the opener (`fn f() { // step`): its
   *  `indent` is then the gap after `{`, not a line-start indent. */
  ownLine: boolean;
}

interface ReplyLine {
  start: number;
  content: string;
  eol: string;
}

export function keepSketch(input: KeepSketchInput): KeepSketchResult {
  return keepSketchIn(input, true);
}

// `mayMakeSlot` is false on the pass over a reply that already had its slot
// made, so a shape the slot maker misjudges cannot recurse.
function keepSketchIn(input: KeepSketchInput, mayMakeSlot: boolean): KeepSketchResult {
  const { languageId, originalSpan, reply } = input;
  const bodyOnly = input.bodyOnly ?? false;
  const bodyIndent = input.bodyIndent ?? "";
  const unchanged: KeepSketchResult = {
    text: reply,
    keptByModel: 0,
    placedByTool: [],
    stripped: [],
    unplaced: [],
  };
  const syntax = commentSyntaxFor(languageId);
  if (syntax === undefined) {
    return unchanged;
  }
  const units = sketchUnits(bodyTextOfSpan(originalSpan, languageId, bodyOnly), languageId, bodyIndent, bodyOnly);
  const sketch = units.flatMap((u) => u.lines);
  if (sketch.length === 0) {
    return unchanged;
  }

  const replyBody = bodyTextOfSpan(reply, languageId, bodyOnly);
  const layout = layoutOf(reply, reply.length - replyBody.length, languageId, bodyIndent, syntax);
  const replyHits = bodyCommentHits(replyBody, languageId, bodyIndent).filter(
    (h) => h.atBodyDepth && h.lines.length > 0,
  );

  const kept = keptHits(units, replyHits);
  // An expression body whose expression starts on the `=>` line always breaks
  // there: its later lines are the same expression (`x switch\n{ ... }`), and a
  // line placed before one of them would land inside it.
  if (mayMakeSlot && (!layout.hasSlot || layout.expressionBody) && kept.some((k) => k === undefined)) {
    const made = withSlot(reply, layout, slotIndents(originalSpan, reply, units, bodyIndent));
    if (made !== undefined) {
      return keepSketchIn({ ...input, reply: made }, false);
    }
  }
  const first = place(units, kept, replyHits, layout, reply);
  const landing = layout.hasSlot ? sketch : units.filter((_, ui) => kept[ui] !== undefined).flatMap((u) => u.lines);
  if (kept.every((k) => k === undefined) || roundTrips(first.text, landing, input)) {
    return first;
  }
  // Two kept units sharing one line leave no line between them to place a
  // dropped unit on. Placing every unit by code is always in order, so it is
  // the answer whenever the model's placement cannot be honoured.
  return place(
    units,
    units.map(() => undefined),
    replyHits,
    layout,
    reply,
  );
}

function sketchUnits(body: string, languageId: string, bodyIndent: string, startsAtLine: boolean): SketchUnit[] {
  return bodyCommentHits(body, languageId, bodyIndent)
    .filter((h) => h.atBodyDepth && h.lines.length > 0)
    .map((h) => {
      const lineStart = body.lastIndexOf("\n", h.hit.index - 1);
      const indent = leadingWhitespace(body.slice(lineStart + 1));
      const raw = body.slice(h.hit.index, h.hit.end).replace(/\r?\n$/, "");
      const source = raw.split("\n").map((line, i) => {
        const bare = line.replace(/\r$/, "");
        if (i === 0) {
          return bare;
        }
        // A continuation line keeps its alignment relative to the opener's line.
        return bare.startsWith(indent) ? bare.slice(indent.length) : bare.trimStart();
      });
      return { lines: h.lines, source, indent, ownLine: lineStart >= 0 || startsAtLine };
    });
}

/**
 * For each sketch unit, the reply hits that keep it, or `undefined`.
 *
 * The longest in-order common subsequence of sketch lines against reply hits,
 * where a reply hit matches only as a whole run of consecutive sketch lines. A
 * unit only partly matched cannot be kept, so the hits matching it are taken
 * out and the match runs again; each round removes at least one hit.
 */
function keptHits(units: SketchUnit[], replyHits: BodyCommentHit[]): (number[] | undefined)[] {
  const sketch = units.flatMap((u) => u.lines);
  const unitOfLine = units.flatMap((u, ui) => u.lines.map(() => ui));
  const allowed = replyHits.map(() => true);
  for (;;) {
    const hitOfLine = lcsMatch(sketch, replyHits, allowed);
    let partial = false;
    const result = units.map((_, ui) => {
      const lineHits = hitOfLine.filter((_, li) => unitOfLine[li] === ui);
      if (lineHits.every((h) => h !== undefined)) {
        return [...new Set(lineHits as number[])];
      }
      for (const h of lineHits) {
        if (h !== undefined) {
          allowed[h] = false;
          partial = true;
        }
      }
      return undefined;
    });
    if (!partial) {
      return result;
    }
  }
}

function lcsMatch(sketch: string[], hits: BodyCommentHit[], allowed: boolean[]): (number | undefined)[] {
  const n = hits.length;
  const m = sketch.length;
  const fits = (i: number, j: number): boolean => {
    const lines = hits[i].lines;
    return allowed[i] && j >= lines.length && lines.every((l, k) => sketch[j - lines.length + k] === l);
  };
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const len = hits[i - 1].lines.length;
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], fits(i - 1, j) ? dp[i - 1][j - len] + len : 0);
    }
  }
  const hitOfLine: (number | undefined)[] = new Array(m).fill(undefined);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const len = hits[i - 1].lines.length;
    if (fits(i - 1, j) && dp[i][j] === dp[i - 1][j - len] + len) {
      for (let k = j - len; k < j; k++) {
        hitOfLine[k] = i - 1;
      }
      i--;
      j -= len;
    } else if (dp[i][j] === dp[i - 1][j]) {
      i--;
    } else {
      j--;
    }
  }
  return hitOfLine;
}

// Where things can go in the reply, computed once: its lines, which of them are
// body-depth statements, and the line a body-end placement goes before.
interface Layout {
  lines: ReplyLine[];
  bodyStart: number;
  firstBodyLine: number;
  /** A line starts inside the body before its closing brace, so a placed line
   *  can sit inside the function without editing any reply line. */
  hasSlot: boolean;
  isCode: boolean[];
  endLine: number;
  eol: string;
  /** The body follows a `=>` (C#, TypeScript concise arrow). It has no closing
   *  brace of its own, so no `}` in it is ever the body's closer. */
  expressionBody: boolean;
  /** Offset of the body's closing brace in the reply, or -1. */
  closerAt: number;
}

function layoutOf(
  reply: string,
  bodyStart: number,
  languageId: string,
  bodyIndent: string,
  syntax: CommentSyntax,
): Layout {
  const lines = splitLines(reply);
  const body = reply.slice(bodyStart);
  const commentEnds = new Map(allComments(body, syntax).map((h) => [h.index + bodyStart, h.end + bodyStart]));
  const bracketSyntax = bracketSyntaxFrom(syntax, languageId);
  const python = languageId === "python";
  const indent = python ? (bodyIndent === "" ? pyBodyIndent(body, syntax) : bodyIndent) : "";
  const expressionBody = !python && reply.slice(bodyStart - 2, bodyStart) === "=>";
  const closer = python || expressionBody ? -1 : closingBrace(body, bracketSyntax);
  const closerAt = closer < 0 ? -1 : closer + bodyStart;

  const isCode = lines.map((line) => {
    if (line.start < bodyStart) {
      return false;
    }
    const lead = leadingWhitespace(line.content);
    const first = line.start + lead.length;
    if (!hasCode(line, first, commentEnds)) {
      return false;
    }
    if (closerAt >= 0 && first >= closerAt) {
      return false;
    }
    if (python && lead !== indent) {
      return false;
    }
    // A statement starts outside every bracket, string and block comment, so a
    // continuation line or a multi-line literal's inside is never a target.
    const scan = scanBrackets(body.slice(0, line.start - bodyStart), bracketSyntax);
    return scan.stack.length === 0 && !scan.inLiteral && !scan.inBlockComment && !scan.inLineComment;
  });

  const firstBodyLine = firstIndex(lines, (l) => l.start >= bodyStart, lines.length);
  return {
    lines,
    bodyStart,
    firstBodyLine,
    hasSlot:
      firstBodyLine < lines.length &&
      (closerAt < 0 || lines[lineOf(lines, closerAt)].start >= bodyStart) &&
      !(python && bodyStart > 0 && pyHeaderHoldsCode(lines, bodyStart, commentEnds)),
    isCode,
    endLine: endLineOf(lines, closerAt, firstBodyLine),
    eol: reply.includes("\r\n") ? "\r\n" : "\n",
    expressionBody,
    closerAt,
  };
}

/**
 * The reply with a line break made where its body shares a line with the
 * opener, so a placed line has somewhere to go. Only line breaks and
 * indentation are added, at token boundaries, which no supported language
 * reads as a change of meaning:
 *
 * - a brace body `{ a + b }`: a break after `{`, and before `}` when it shares
 *   the line; text after the `}` stays after it;
 * - a Python one-liner `def f(): stmt`: the whole tail after `:` moves down,
 *   its continuation lines untouched;
 * - an expression body `=> a + b;` (C#, TypeScript concise arrow): a break
 *   after the `=>`.
 *
 * Undefined when there is no code after the opener to move: an empty body, a
 * signature only, an empty reply. Those stay unplaced.
 */
interface SlotIndents {
  /** The column the moved code and the placed lines take. */
  slot: string;
  /** The column a moved closing brace takes. */
  close: string;
}

// The developer's own columns, read off the span they wrote. The span's first
// line starts at the keyword, so its indent is not the document's; every later
// line carries the absolute column, and the sketch sits at body depth by
// definition (for Python the harvest only takes a comment at the body indent).
// The human's flush `fn main()` sketch has comments at column 0, so the last
// fallback, the closing column plus one level, still decides there.
function slotIndents(originalSpan: string, reply: string, units: SketchUnit[], bodyIndent: string): SlotIndents {
  const spanLines = originalSpan.split("\n").filter((l) => l.trim() !== "");
  const last = spanLines.length > 0 ? spanLines[spanLines.length - 1] : "";
  const close = last.trim().startsWith("}") ? leadingWhitespace(last) : leadingWhitespace(reply);
  const slot =
    bodyIndent !== ""
      ? bodyIndent
      : units.length > 0 && units[0].ownLine && units[0].indent !== ""
        ? units[0].indent
        : close + (close.includes("\t") ? "\t" : "    ");
  return { slot, close };
}

function withSlot(reply: string, layout: Layout, indents: SlotIndents): string | undefined {
  const { lines, bodyStart } = layout;
  if (bodyStart <= 0 || bodyStart >= reply.length) {
    return undefined;
  }
  const openLine = lines[lineOf(lines, bodyStart - 1)];
  const lineEnd = openLine.start + openLine.content.length;
  let codeStart = bodyStart;
  while (codeStart < lineEnd && (reply[codeStart] === " " || reply[codeStart] === "\t")) {
    codeStart++;
  }
  if (codeStart >= lineEnd) {
    return undefined;
  }
  const indent = indents.slot;
  const head = reply.slice(0, bodyStart);
  const closerAt = layout.closerAt;
  if (closerAt >= 0 && closerAt < lineEnd) {
    const inner = reply.slice(codeStart, closerAt).trimEnd();
    if (inner === "") {
      return undefined;
    }
    return head + layout.eol + indent + inner + layout.eol + indents.close + reply.slice(closerAt);
  }
  return head + layout.eol + indent + reply.slice(codeStart);
}

// Before the closing brace's line, or after the last non-blank body line for
// Python and a truncated reply. Only read when the layout has a slot, so a
// closing brace here always starts a body line of its own.
function endLineOf(lines: ReplyLine[], closerAt: number, firstBodyLine: number): number {
  if (closerAt >= 0) {
    return lineOf(lines, closerAt);
  }
  for (let i = lines.length - 1; i >= firstBodyLine; i--) {
    if (lines[i].content.trim() !== "") {
      return i + 1;
    }
  }
  return firstBodyLine;
}

// Whether anything but whitespace and comments sits on the line from `first`.
// `/* a */ go();` is a statement line; `// a` and `/* a */` alone are not.
function hasCode(line: ReplyLine, first: number, commentEnds: Map<number, number>): boolean {
  const lineEnd = line.start + line.content.length;
  let at = first;
  for (;;) {
    const end = commentEnds.get(at);
    if (end === undefined) {
      return at < lineEnd;
    }
    if (end > lineEnd) {
      return false;
    }
    at = end;
    while (at < lineEnd && (line.content[at - line.start] === " " || line.content[at - line.start] === "\t")) {
      at++;
    }
  }
}

// Python cannot open an indented suite after a simple statement on the header
// line, so `def f(): return g(` is a one-liner however many lines its brackets
// run on. A header tail of whitespace or a `#` comment still opens a suite.
function pyHeaderHoldsCode(lines: ReplyLine[], bodyStart: number, commentEnds: Map<number, number>): boolean {
  const header = lines[lineOf(lines, bodyStart - 1)];
  const lineEnd = header.start + header.content.length;
  let at = bodyStart;
  while (at < lineEnd && (header.content[at - header.start] === " " || header.content[at - header.start] === "\t")) {
    at++;
  }
  return hasCode(header, at, commentEnds);
}

function closingBrace(body: string, bracketSyntax: ReturnType<typeof bracketSyntaxFrom>): number {
  for (let at = body.indexOf("}"); at >= 0; at = body.indexOf("}", at + 1)) {
    // A Rust `'}'` or `b'}'`: the prefix scan ends at the opening tick, where a
    // char literal cannot match yet, so it never sees one. `'}` is never a lifetime.
    if ((bracketSyntax.charQuote ?? "").includes("'") && body[at - 1] === "'" && body[at + 1] === "'") {
      continue;
    }
    const scan = scanBrackets(body.slice(0, at), bracketSyntax);
    if (scan.stack.length === 0 && !scan.inLiteral && !scan.inBlockComment && !scan.inLineComment) {
      return at;
    }
  }
  return -1;
}

function allComments(text: string, syntax: CommentSyntax): CommentHit[] {
  const hits: CommentHit[] = [];
  for (let hit = nextComment(text, syntax, 0); hit !== undefined; hit = nextComment(text, syntax, hit.end)) {
    hits.push(hit);
  }
  return hits;
}

function place(
  units: SketchUnit[],
  kept: (number[] | undefined)[],
  replyHits: BodyCommentHit[],
  layout: Layout,
  reply: string,
): KeepSketchResult {
  const { lines, bodyStart, isCode, endLine } = layout;
  const lineAt = (bodyOffset: number): number => lineOf(lines, bodyOffset + bodyStart);
  const codeIndent = firstIndex(lines, (_, i) => isCode[i], -1);
  const inserts = new Map<number, string[]>();
  const placedByTool: string[] = [];
  const unplaced: string[] = [];
  let keptByModel = 0;
  let from = layout.firstBodyLine;

  units.forEach((unit, ui) => {
    const hits = kept[ui];
    if (hits !== undefined) {
      keptByModel += unit.lines.length;
      const last = replyHits[hits[hits.length - 1]].hit;
      from = lineAt(last.end - 1) + 1;
      return;
    }
    if (!layout.hasSlot) {
      unplaced.push(...unit.lines);
      return;
    }
    const nextKept = kept.findIndex((k, i) => i > ui && k !== undefined);
    const ceiling = nextKept < 0 ? endLine : lineAt(replyHits[kept[nextKept]![0]].hit.index);
    const code = firstIndex(lines, (_, i) => i >= from && isCode[i], endLine);
    const at = Math.min(code, ceiling);
    const beforeALine = at < endLine || (nextKept >= 0 && at === ceiling);
    const indent = beforeALine
      ? leadingWhitespace(lines[at].content)
      : codeIndent >= 0
        ? leadingWhitespace(lines[codeIndent].content)
        : unit.indent;
    const bucket = inserts.get(at) ?? [];
    bucket.push(...unit.source.map((s) => indent + s));
    inserts.set(at, bucket);
    placedByTool.push(...unit.lines);
    from = at;
  });

  if (placedByTool.length === 0) {
    return { text: reply, keptByModel, placedByTool, stripped: [], unplaced };
  }
  return {
    text: assemble(lines, inserts, layout.eol),
    keptByModel,
    placedByTool,
    stripped: [],
    unplaced,
  };
}

function assemble(lines: ReplyLine[], inserts: Map<number, string[]>, eol: string): string {
  const out: string[] = [];
  for (let i = 0; i <= lines.length; i++) {
    const added = inserts.get(i) ?? [];
    if (i === lines.length) {
      if (added.length > 0) {
        // Placing after a final line that had no terminator gives that line
        // one and leaves the last placed line without, so the text's ending
        // shape is the reply's.
        if (lines.length > 0 && lines[lines.length - 1].eol === "") {
          out.push(eol);
        }
        out.push(added.join(eol));
        if (lines.length === 0 || lines[lines.length - 1].eol !== "") {
          out.push(eol);
        }
      }
      break;
    }
    for (const line of added) {
      out.push(line, eol);
    }
    out.push(lines[i].content, lines[i].eol);
  }
  return out.join("");
}

function roundTrips(text: string, sketch: string[], input: KeepSketchInput): boolean {
  const harvest = harvestBodyComments(
    bodyTextOfSpan(text, input.languageId, input.bodyOnly ?? false),
    input.languageId,
    input.bodyIndent ?? "",
  ).comments;
  let j = 0;
  for (const line of harvest) {
    if (j < sketch.length && line === sketch[j]) {
      j++;
    }
  }
  return j === sketch.length;
}

function splitLines(text: string): ReplyLine[] {
  const lines: ReplyLine[] = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf("\n", start);
    const end = nl < 0 ? text.length : nl + 1;
    const raw = text.slice(start, end);
    const eol = raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : "";
    lines.push({ start, content: raw.slice(0, raw.length - eol.length), eol });
    start = end;
  }
  return lines;
}

function lineOf(lines: ReplyLine[], offset: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].start <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

function firstIndex<T>(items: T[], pred: (item: T, i: number) => boolean, fallback: number): number {
  const i = items.findIndex(pred);
  return i < 0 ? fallback : i;
}

/** One write path's view of the sketch keeper: the reply to preview, the diff
 *  title, and the channel line. Every path that replaces a function span with
 *  a model reply goes through `keepSketchForPreview`, so the four paths cannot
 *  drift apart in how they count, word or title the outcome. */
export interface SketchPreviewInput extends KeepSketchInput {
  /** The writing path's channel prefix: "[fngen]", "[repair]" or "[tests]". */
  channelTag: string;
  /** The diff tab title the path shows without a sketch, ending in "(preview)". */
  title: string;
}

export interface SketchPreview {
  text: string;
  /** True when the span had a sketch and `text` differs from `originalSpan`
   *  only by whole comment lines, blank lines and trailing whitespace. Restored
   *  lines land where the keeper can prove a slot, not always where the
   *  developer had them, so a reply that only dropped comment lines would
   *  otherwise read as a change. */
  onlyCommentsDiffer: boolean;
  /** The input title, plus a note only when a line was restored or could not be kept. */
  title: string;
  /** Undefined when the span had no sketch: nothing to say. */
  channelLine: string | undefined;
  /** Set when the reply has no body to hold the sketch (empty, or a signature
   *  only): presenting it would remove the developer's lines, so the path
   *  refuses it. Plain words, for the channel and the developer. */
  refusal: string | undefined;
}

/**
 * Runs on the reply AFTER placement, so placed lines take the document's
 * indentation, and BEFORE any "the round changed nothing" comparison, so a
 * reply that differs from the function only by dropped sketch lines compares
 * equal once they are back.
 */
export function keepSketchForPreview(input: SketchPreviewInput): SketchPreview {
  const kept = keepSketch(input);
  const placed = kept.placedByTool;
  const unplaced = kept.unplaced;
  if (kept.keptByModel + placed.length + unplaced.length === 0) {
    return { text: kept.text, title: input.title, channelLine: undefined, onlyCommentsDiffer: false, refusal: undefined };
  }
  const channelLine =
    `${input.channelTag} sketch: ${kept.keptByModel} kept by the model, ${placed.length} placed by Column 80, ` +
    `${unplaced.length} could not be placed` +
    (placed.length > 0 ? `; placed: ${placed.join(" | ")}` : "") +
    (unplaced.length > 0 ? `; not placed: ${unplaced.join(" | ")}` : "");
  const sketch = new Set(
    harvestBodyComments(
      bodyTextOfSpan(input.originalSpan, input.languageId, input.bodyOnly ?? false),
      input.languageId,
      input.bodyIndent ?? "",
    ).comments,
  );
  const before = codeLines(input.originalSpan, input, sketch);
  const after = codeLines(kept.text, input, sketch);
  return {
    text: kept.text,
    title: sketchTitle(input.title, placed.length, unplaced.length),
    channelLine,
    onlyCommentsDiffer: before.length === after.length && before.every((line, i) => line === after[i]),
    refusal:
      unplaced.length > 0
        ? `the reply has no function body to keep ${unplaced.length === 1 ? "the sketch comment" : "the sketch comments"} in`
        : undefined,
  };
}

// The comparison copy only: the reply itself is never edited. Whole lines are
// compared, and only a line that is nothing but SKETCH comment goes: that is the
// case the comparison exists for, sketch lines dropped and put back elsewhere.
// Any other comment line appearing or vanishing (`// @ts-expect-error` is a
// plausible repair) is a change. A comment inside a line never joins two tokens
// (`a/**/b` stays apart from `ab`), and leading whitespace is kept exactly,
// because Python reads it.
function codeLines(span: string, input: KeepSketchInput, sketch: ReadonlySet<string>): string[] {
  const inComment = new Array<boolean>(span.length).fill(false);
  const body = bodyTextOfSpan(span, input.languageId, input.bodyOnly ?? false);
  const offset = span.length - body.length;
  for (const h of bodyCommentHits(body, input.languageId, input.bodyIndent ?? "")) {
    if (h.lines.length > 0 && h.lines.every((line) => sketch.has(line))) {
      inComment.fill(true, h.hit.index + offset, h.hit.end + offset);
    }
  }
  const out: string[] = [];
  let start = 0;
  for (const raw of span.split("\n")) {
    const line = raw.replace(/\r$/, "");
    let code = false;
    for (let k = 0; k < line.length && !code; k++) {
      code = line[k].trim() !== "" && !inComment[start + k];
    }
    if (code) {
      out.push(line.trimEnd());
    }
    start += raw.length + 1;
  }
  return out;
}

function sketchTitle(title: string, restored: number, lost: number): string {
  const comments = (n: number) => `${n} sketch ${n === 1 ? "comment" : "comments"}`;
  const notes: string[] = [];
  if (restored > 0) {
    notes.push(`${comments(restored)} restored`);
  }
  if (lost > 0) {
    notes.push(restored > 0 ? `${lost} could not be kept` : `${comments(lost)} could not be kept`);
  }
  if (notes.length === 0) {
    return title;
  }
  return title.endsWith(")") ? `${title.slice(0, -1)}, ${notes.join(", ")})` : `${title} (${notes.join(", ")})`;
}
