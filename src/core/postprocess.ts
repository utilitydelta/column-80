/**
 * Output hygiene for raw FIM text before it becomes ghost text.
 *
 * Pipeline shape, trimStopTokens, toSingleLine, and the char-level suffix
 * overlap trim ported from utilitydelta/human-replay-vscode-extension
 * src/postprocess.ts. dropDuplicateSuffixLines' line matching,
 * limitScopeByIndentation, removeRepetitiveBlocks, and dropDuplicatedHead
 * adapted from TabbyML/tabby (Apache-2.0) clients/tabby-agent/src/
 * codeCompletion/postprocess/{removeDuplicateSuffixLines,
 * limitScopeByIndentation,removeRepetitiveBlocks,dropDuplicated}.ts and
 * src/utils/string.ts, simplified to pure (text, context) functions with no
 * language plumbing; the edit distance is a plain Levenshtein in place of
 * tabby's fast-levenshtein dependency. The bracket-balance scan deciding
 * whether trailing closers belong to the completion lives in `brackets.ts`;
 * the quote-parity tracking around it is this module's.
 */

import { openStack } from "./brackets";
import { boundContinuation, BoundContext, BoundRule, retractToSafeCut, sealCut } from "./fimBound";

export interface PostprocessContext {
  /** Text after the cursor, already truncated to the config window. */
  suffix: string;
  /** Text on the cursor's line before the cursor; anchors indentation scope. */
  currentLinePrefix: string;
  multiline: boolean;
  /** The synthetic candidate block injected into the prefix, when injection
   *  fired. The model sometimes echoes its lines back out (dogfood capture:
   *  `theme; // available here (use one of these exact names...`); any echo
   *  is scaffolding, never code, and the completion is cut at the first one. */
  injectedBlock?: string;
  /** Set at a site the plain-continuation bound applies to: one syntactic
   *  unit, four content lines, never cut mid-expression. Exclusive with
   *  `multiline: false` - a bounded call passes `multiline: true` and this,
   *  and the bound replaces the single-line collapse rather than stacking on
   *  it. Unset leaves every filter exactly as it was. */
  bound?: BoundContext;
}

/** What the bound decided, for the caller's evidence line. The service logs
 *  it; nothing downstream branches on it. */
export interface BoundOutcome {
  rule: BoundRule;
  /** Content lines the bound cut from the raw generation. A count, never the
   *  text. */
  droppedLines: number;
  /** Content lines in the served text, after every filter. */
  keptLines: number;
  /** Closers sitting on the served text. The seal runs last and re-balances,
   *  so its answer supersedes the bound's wherever it moved anything. */
  appended: string;
  /** The safety rule found no safe cut point and the whole ghost was refused.
   *  A suppression the product chose, counted apart from an empty generation. */
  refusedUnsafe: boolean;
}

export interface PostprocessResult {
  text: string;
  /** Present exactly when `ctx.bound` was. */
  bound?: BoundOutcome;
}

/** Cut the completion at the first echo of any injected-block line. Needles
 *  are the block's trimmed lines (injection re-indents them), all comment-
 *  shaped and distinctive. A needle matches LINE-ANCHORED, never as a
 *  substring: the echo must be the completion line's entire trimmed tail
 *  (the whole line, or a mid-line echo after real code - the dogfood capture
 *  `theme; // available here (...)`). A genuine comment that merely EXTENDS
 *  a needle (`// x: Type registry entry` over the needle `// x: T`) never
 *  matches, so real code after it survives. */
function stripInjectionEcho(text: string, injectedBlock: string | undefined): string {
  if (injectedBlock === undefined) {
    return text;
  }
  const needles = injectedBlock
    .split("\n")
    .map((line) => line.trim())
    .filter((needle) => needle !== "");
  let offset = 0;
  for (const line of text.split("\n")) {
    const tail = line.replace(/\s+$/, "");
    // Longest matching needle wins: it starts earliest in the line, and the
    // cut must land before the whole echo, not inside it.
    let at = -1;
    for (const needle of needles) {
      if (tail.endsWith(needle)) {
        const start = offset + tail.length - needle.length;
        if (at === -1 || start < at) {
          at = start;
        }
      }
    }
    if (at !== -1) {
      return text.slice(0, at).trimEnd();
    }
    offset += line.length + 1;
  }
  return text;
}

// Qwen2.5-coder FIM specials. Ollama stops at these itself when it applies
// the native template; this is the seatbelt for leaks.
//
// `<|cursor|>` is not one of qwen's own specials, but the base model emits the
// literal string anyway - it is all over the FIM corpora it trained on - so it
// slips past ollama's native stops and lands in the buffer as `mod tests
// {<|cursor|>`. Truncate at it like any other marker: whatever the model writes
// after a cursor marker is format confusion, not infill.
const STOP_TOKENS = [
  "<|fim_prefix|>",
  "<|fim_suffix|>",
  "<|fim_middle|>",
  "<|fim_pad|>",
  "<|repo_name|>",
  "<|file_sep|>",
  "<|endoftext|>",
  "<|cursor|>",
];

export function trimStopTokens(text: string): string {
  let cut = text.length;
  for (const token of STOP_TOKENS) {
    const idx = text.indexOf(token);
    if (idx !== -1 && idx < cut) {
      cut = idx;
    }
  }
  return text.slice(0, cut);
}

export function toSingleLine(text: string): string {
  const idx = text.indexOf("\n");
  const line = idx === -1 ? text : text.slice(0, idx);
  // CRLF documents put the \r before the cut point; a trailing \r in ghost
  // text renders as a phantom character.
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

export function dropDuplicateSuffixLines(text: string, suffix: string): string {
  return dropLineLevelSuffixRepeat(dropCharLevelSuffixOverlap(text, suffix), suffix);
}

// (a) The completion's tail equals the head of the suffix (leading
// whitespace trimmed). Largest overlap wins; iterate to a fixpoint so the
// filter stays idempotent even when trimming exposes a new overlap. Two
// shapes qualify: an overlap starting at a completion line boundary (or
// consuming the whole completion), and a mid-line run of closing
// brackets/quotes — the auto-closed characters an editor already put after
// the cursor. A sub-line fragment without closers (a lone `;`) is the
// completion finishing the current statement, not duplication; the provider
// layer dedups that case by extending the accept range.
function dropCharLevelSuffixOverlap(completion: string, suffix: string): string {
  const trimmedSuffix = suffix.trimStart();
  if (!trimmedSuffix) {
    return completion;
  }
  for (;;) {
    const max = Math.min(completion.length, trimmedSuffix.length);
    let overlap = 0;
    for (let len = max; len > 0; len--) {
      if (!completion.endsWith(trimmedSuffix.slice(0, len))) {
        continue;
      }
      if (overlapQualifies(completion, len)) {
        overlap = len;
        break;
      }
    }
    if (overlap === 0) {
      return completion;
    }
    completion = completion.slice(0, completion.length - overlap);
  }
}

function overlapQualifies(completion: string, len: number): boolean {
  if (len === completion.length) {
    return true;
  }
  const before = completion.slice(0, completion.length - len);
  if (before.endsWith("\n")) {
    return true;
  }
  // Closer-run only counts mid-statement: on a line of its own (whitespace
  // before it) the closer is real block structure, which the line-level
  // filter judges instead. And the run must be unmatched inside the
  // completion: closers pairing with opens the completion itself introduced
  // are its own tokens, not duplication of the buffer's auto-closed chars.
  const lineBefore = before.slice(before.lastIndexOf("\n") + 1);
  const run = completion.slice(completion.length - len);
  return isCloserRun(run) && lineBefore.trim() !== "" && closersAllExternal(before, run);
}

function isCloserRun(s: string): boolean {
  return /^["'`)\]}]+[;,]?$/.test(s);
}

const OPEN_FOR: { [closer: string]: string } = { ")": "(", "]": "[", "}": "{" };
const OPENERS = new Set(["(", "[", "{"]);
const QUOTES = new Set(['"', "'", "`"]);

// True when no closer or quote in `run` pairs with an open the completion
// text before it introduced. Quotes are undirected, so parity stands in for a
// stack.
function closersAllExternal(before: string, run: string): boolean {
  const stack = openStack(before);
  const quoteParity: { [q: string]: number } = { '"': 0, "'": 0, "`": 0 };
  for (const ch of before) {
    if (QUOTES.has(ch)) {
      quoteParity[ch] ^= 1;
    }
  }
  for (const ch of run) {
    if (OPEN_FOR[ch]) {
      if (stack.length > 0 && stack[stack.length - 1] === OPEN_FOR[ch]) {
        return false; // closes an open the completion made
      }
    } else if (QUOTES.has(ch)) {
      if (quoteParity[ch] === 1) {
        return false; // closes a quote the completion opened
      }
      quoteParity[ch] ^= 1;
    } else if (OPENERS.has(ch)) {
      stack.push(ch);
    }
  }
  return true;
}

// CRLF documents put a \r before every split point while model output is
// LF-only; line-level comparisons need EOL parity, and only the trailing \r
// goes — leading whitespace (indentation identity) is untouched.
function splitLines(s: string): string[] {
  return s.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

// (b) A completion line equals the first non-blank suffix line and everything
// after it only repeats subsequent suffix lines: cut the completion before
// that line. Raw line equality, whitespace included — a closer at a
// different indentation is a different token stream (an inner `  }` against
// an outer `}` must survive), so the "modulo whitespace" matching tabby's
// filter avoids is avoided here too.
function dropLineLevelSuffixRepeat(text: string, suffix: string): string {
  const suffixLines = splitLines(suffix).filter((l) => l.trim() !== "");
  if (suffixLines.length === 0) {
    return text;
  }
  const lines = splitLines(text);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== suffixLines[0]) {
      continue;
    }
    let si = 0;
    let fullMatch = true;
    for (let ci = i; ci < lines.length; ci++) {
      if (lines[ci].trim() === "") {
        continue;
      }
      if (si >= suffixLines.length || lines[ci] !== suffixLines[si]) {
        fullMatch = false;
        break;
      }
      si++;
    }
    if (fullMatch) {
      return lines.slice(0, i).join("\n");
    }
  }
  return text;
}

// The completion's opening lines fuzzy-match the suffix head: the model
// re-typed what is already below the cursor, and whatever follows is
// unanchored — drop the whole completion, not just the matching head.
export function dropDuplicatedHead(text: string, suffix: string): string {
  const inputLines = splitLines(text);
  const suffixLines = splitLines(suffix);
  let ii = 0;
  while (ii < inputLines.length && inputLines[ii].trim() === "") {
    ii++;
  }
  let si = 0;
  while (si < suffixLines.length && suffixLines[si].trim() === "") {
    si++;
  }
  const lineCount = Math.min(3, inputLines.length - ii, suffixLines.length - si);
  if (lineCount < 1) {
    return text;
  }
  const inputToCompare = inputLines.slice(ii, ii + lineCount).join("").trim();
  const suffixToCompare = suffixLines.slice(si, si + lineCount).join("").trim();
  const threshold = Math.max(1, 0.05 * inputToCompare.length, 0.05 * suffixToCompare.length);
  if (levenshtein(inputToCompare, suffixToCompare) <= threshold) {
    // A lone separator ghost is judged on this filter's actual contract -
    // duplication - not on raw distance. `;` `,` `)` are each edit distance 1
    // from `}` and the threshold floors at 1, so the bare fuzzy judgement
    // deleted the exact correct separator at 4 of 47 real scoped member
    // sites, 16% of the lone-separator class
    // (session-v26/measure-emptyserve.md). Two shapes are exempt:
    //
    //  - The ghost shares no character with the suffix line's leading closer
    //    run (the maximal leading run over `)]};,`). Nothing is duplicated,
    //    so a duplicate filter has nothing to drop: a `,` finishing a tuple
    //    element above the `)` that closes the tuple.
    //  - Characters are shared, but the suffix line leads with `}`. The `}`
    //    proves that line's closers belong to the ENCLOSING block, so the
    //    ghost ends the statement in one scope and the suffix closes another
    //    - cross-scope, not duplicate (`);` over `});`).
    //
    // What remains - shared characters with no cross-scope marker - is the
    // ghost re-closing what the buffer already closes (`);` over a next line
    // `)` double-closes the call) and still drops. Identical text is full
    // duplication and always drops.
    if (isLoneSeparator(inputToCompare) && inputToCompare !== suffixToCompare) {
      const crossScope = suffixToCompare.startsWith("}") && !inputToCompare.includes("}");
      const leadingRun = suffixToCompare.match(/^[)\]};,]+/)?.[0] ?? "";
      const disjoint = ![...inputToCompare].some((ch) => leadingRun.includes(ch));
      if (crossScope || disjoint) {
        return text;
      }
    }
    return "";
  }
  return text;
}

// The sub-line tokens that close a statement or argument list rather than
// start a line of code: a run of closers with at most one trailing `;` or
// `,`, or that trailing separator alone. The measured empty-serve class is
// exactly these (`;` `,` `)` `);`); quote runs stay with the char-level
// filter, which owns the auto-closed-character shapes.
function isLoneSeparator(s: string): boolean {
  return s !== "" && /^[)\]}]*[;,]?$/.test(s);
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = [...curr];
  }
  return prev[b.length];
}

/** Largest k where `following.slice(0, k)` equals the tail of `text`. The
 *  provider layer uses this to extend an inline completion's replace range
 *  over characters the completion re-types (the lone-terminator dedup the
 *  headless pipeline deliberately leaves alone). */
export function trailingOverlapLength(text: string, following: string): number {
  const max = Math.min(text.length, following.length);
  for (let len = max; len > 0; len--) {
    if (!text.endsWith(following.slice(0, len))) {
      continue;
    }
    // Same balance rule as the strip filter: a closer the completion itself
    // opened is its own token, so the range must not consume the buffer's.
    if (closersAllExternal(text.slice(0, text.length - len), text.slice(text.length - len))) {
      return len;
    }
  }
  return 0;
}

export function limitScopeByIndentation(text: string, currentLinePrefix: string): string {
  const lines = text.split("\n");
  if (lines.length <= 1) {
    return text;
  }
  const depth = indentation(currentLinePrefix);
  // Line 0 continues the cursor's own line, so it can never escape the block.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      continue;
    }
    if (indentation(line) < depth) {
      const cut = isBlockClosingLine(line) ? i + 1 : i;
      return cut >= lines.length ? text : lines.slice(0, cut).join("\n");
    }
  }
  return text;
}

// Leading-whitespace character count, as in Tabby's getIndentationLevel with
// indentation auto-detection off: tabs and spaces each count 1.
function indentation(line: string): number {
  return line.match(/^[ \t]*/)?.[0].length ?? 0;
}

/**
 * Bound the completion to the block the cursor is in, by brace balance rather
 * than indentation. limitScopeByIndentation cannot bound a completion whose
 * cursor sits on the block's own OPENING line (`fn f() {<caret>`): that line's
 * indentation is 0, nothing below it is smaller, so a run-on into a sibling
 * item (a second `fn`, an `impl`) is not trimmed. Scan the braces instead: the
 * first `}` that closes a block the completion did NOT open is the enclosing
 * block's own closer - keep it, drop everything after (the sibling item). Only
 * `}` triggers the cut; an external `)`/`]` is left alone, since it may be a
 * legitimate method chain after closing a call the cursor sat inside. String
 * literals are skipped so a `}` inside `"..."` never counts.
 */
export function limitToEnclosingBlock(text: string): string {
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") {
        i++; // skip the escaped character
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{" || ch === "(" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === ")" || ch === "]") {
      const opener = ch === "}" ? "{" : ch === ")" ? "(" : "[";
      if (stack.length > 0 && stack[stack.length - 1] === opener) {
        stack.pop();
      } else if (ch === "}") {
        return text.slice(0, i + 1);
      }
    }
  }
  return text;
}

function isBlockClosingLine(line: string): boolean {
  const trimmed = line.trim();
  return /^[)\]}]+[;,]?$/.test(trimmed) || trimmed === "end";
}

export function removeRepetitiveBlocks(text: string): string {
  const lines = text.split("\n");
  const MAX_BLOCK_LINES = 8;
  // Trigger at 3 consecutive repeats, keep 2: the kept output re-runs the
  // filter without re-triggering, which is what makes it idempotent.
  const TRIGGER_REPEATS = 3;
  const KEEP_REPEATS = 2;
  for (let start = 0; start < lines.length; start++) {
    for (let blockLen = 1; blockLen <= MAX_BLOCK_LINES && start + blockLen * TRIGGER_REPEATS <= lines.length; blockLen++) {
      const block = lines.slice(start, start + blockLen);
      // Blank or near-empty blocks (brace ladders, separator lines) repeat
      // legitimately in real code; only substantial blocks count as run-on.
      if (block.join("").trim().length < 4) {
        continue;
      }
      let repeats = 1;
      while (blockRepeatsAt(lines, block, start + repeats * blockLen)) {
        repeats++;
      }
      if (repeats >= TRIGGER_REPEATS) {
        return lines.slice(0, start + KEEP_REPEATS * blockLen).join("\n");
      }
    }
  }
  return text;
}

function blockRepeatsAt(lines: string[], block: string[], at: number): boolean {
  if (at + block.length > lines.length) {
    return false;
  }
  for (let i = 0; i < block.length; i++) {
    if (lines[at + i] !== block[i]) {
      return false;
    }
  }
  return true;
}

export function postprocess(raw: string, ctx: PostprocessContext): string {
  return postprocessBounded(raw, ctx).text;
}

/** The same pipeline, with the bound's decision handed back so the caller can
 *  put it on the evidence channel. `postprocess` is the string-only face of
 *  this, kept because most callers have no bound and want no tuple. */
export function postprocessBounded(raw: string, ctx: PostprocessContext): PostprocessResult {
  let text = trimStopTokens(raw);
  // Before any shaping: an echoed injection line must not influence the
  // single-line collapse or indentation scoping downstream.
  text = stripInjectionEcho(text, ctx.injectedBlock);
  // The bound stands where the single-line collapse used to, and for the same
  // reason: everything below is bounding text, and it should be bounding at
  // most four lines of it. `toSingleLine` is not a weaker version of this - it
  // cuts at the first newline and so returns "" at every `fn f() {|` site.
  const bound = ctx.bound === undefined ? undefined : boundContinuation(text, ctx.bound);
  if (bound !== undefined) {
    text = bound.text;
  } else if (!ctx.multiline) {
    text = toSingleLine(text);
  }
  text = removeRepetitiveBlocks(text);
  text = limitScopeByIndentation(text, ctx.currentLinePrefix);
  // Brace-balance backstop for the case indentation cannot bound: the cursor on
  // the block's own opening line (`fn f() {<caret>`), where the completion runs
  // on into a sibling item.
  text = limitToEnclosingBlock(text);
  if (bound === undefined || ctx.bound === undefined) {
    return { text: dropSuffixRepeats(text, ctx).trimEnd() };
  }
  // After the RESHAPING filters and before the suffix ones, and the split is
  // load-bearing. Each filter above can shorten the text at a line boundary -
  // the scope limit at a dedent, the repetition filter mid-run - and a filter
  // that shortens into a dangling tail undoes the safety rule the bound just
  // applied. The seal retracts and re-balances; it is idempotent, so where
  // nothing moved it costs nothing.
  const sealed = sealCut(text, ctx.bound);
  text = dropSuffixRepeats(sealed.text, ctx).trimEnd();
  // The suffix filters below the seal get the retract WITHOUT the re-balance.
  // They are the only filters that know what the buffer already owns: the dedup
  // drops a `}` the suffix has, and rule 6, which cannot see a suffix, would put
  // it straight back as a duplicate that lands in the buffer on accept. A
  // line-boundary cut can still leave a dangling tail, so the retract stays.
  text = retractToSafeCut(text, ctx.bound).trimEnd();
  return {
    text,
    bound: {
      rule: bound.rule,
      droppedLines: bound.droppedLines,
      keptLines: contentLines(text),
      appended: sealed.appended === "" ? bound.appended : sealed.appended,
      refusedUnsafe: bound.refusedUnsafe,
    },
  };
}

function dropSuffixRepeats(text: string, ctx: PostprocessContext): string {
  return dropDuplicateSuffixLines(dropDuplicatedHead(text, ctx.suffix), ctx.suffix);
}

/** Blank lines are not content: a bounded ghost at `fn f() {|` opens with one
 *  that positions it, and counting it would report a two-line serve of one line.
 *
 *  Exported for the evidence line. `BoundOutcome.keptLines` counts what THIS
 *  pipeline served, and the comment cut runs above it in the service, so a
 *  caller that cuts further has to count again or its number is a lie. */
export function contentLines(text: string): number {
  return text.split("\n").filter((line) => line.trim() !== "").length;
}
