/**
 * The plain-continuation bound: one syntactic unit, capped at four content
 * lines, never cut mid-expression.
 *
 * Plain FIM continues what the human is typing; it never authors a body. The
 * only bound before this module was `num_predict` plus an indentation trim,
 * and at a declaration head that trim's scope is the whole top level, which is
 * no bound at all. Measured on 850 sites: 83% of plain ghosts are multi-line,
 * and of the 7,397 lines served past line 1, 208 are right and 7,189 are
 * wrong. Bounding costs no correctness in any of 15 cells.
 *
 * The line, statement and construct rules are the arms of spike 8
 * (docs/architecture/fim-completion.md, "The plain-continuation bound");
 * the numbers quoted here were
 * measured against exactly these shapes, so the tables are not widened without
 * measuring again.
 *
 * Pure: no vscode, no clock, no I/O. The caller streams, calls `boundReached`
 * after each chunk to decide when to abort the read, and emits the evidence
 * line from `BoundResult`.
 */

import { BracketSyntax, scanBrackets } from "./brackets";
import { commentSyntaxFor } from "./fimComment";
import { TS_LANGUAGE_IDS } from "./tsExtraction";

/** Content lines, not raw lines: leading blank lines never count. Seven of the
 *  eight whole constructs the model gets right are 2 to 4 lines; past four the
 *  whole-construct rate is 1 in 73 and the ghost is authoring a body. */
export const MAX_BOUND_LINES = 4;

export interface BoundContext {
  /** VS Code languageId. Decides the statement terminator rules and the
   *  construct-opener table. An unmapped language gets the C-family rules. */
  languageId: string;
  /** Text on the cursor's line before the cursor. Part of the statement when
   *  the ghost continues that line (no leading blank line), and not part of it
   *  when the ghost starts a fresh line. */
  currentLinePrefix: string;
  /** Override for MAX_BOUND_LINES. Tests only; production passes nothing. */
  maxLines?: number;
}

export type BoundRule = "line" | "statement" | "construct" | "cap" | "empty";

export interface BoundResult {
  /** The text to serve, closers appended. Leading blank lines are PRESERVED:
   *  at `fn f() {|` the ghost legitimately starts on the next line. */
  text: string;
  /** Which rule decided the cut. "empty" means nothing survived. */
  rule: BoundRule;
  /** Content lines in the raw text that the bound dropped. */
  droppedLines: number;
  /** Closers the balance step appended, "" when none. */
  appended: string;
  /** True when the safety rule could find no safe cut point at all and the
   *  whole ghost was refused. */
  refusedUnsafe: boolean;
}

// A line that opens with one of these continues the statement above it: the
// LINQ, iterator-chain and promise-chain population.
const CONTINUATION = /^\s*(\.|\?\.|=>|&&|\|\||\+|\?\?|\|>|\))/;

// A tail that dangles. Cutting here triples syntax errors (40 to 92 tsc
// diagnostics over a spliced TypeScript project) while the number of sites
// breaking syntax barely moves: one cut inside an expression cascades into a
// dozen TS1005s. `,` is the one token with an escape hatch, in safeTail.
//
// `\` is here because a Python explicit line continuation served bare lets the
// buffer's own next line silently join the ghost.
const DANGLING = /(=>|&&|\|\||\?\?|\?\.|->|::|[-+*/%&|^!<>=,.?:\\])$/;

// Trailing words that cannot end an expression in ANY of the five languages.
// `return` and `else` are deliberately absent: both legitimately end a
// statement, and refusing them would cost serves to catch nothing. The measured
// miss this closes is `for (const x of` served as `for (const x of)` - rule 6
// bolting a closer onto a tail rule 5 should have refused, which is worse than
// a false positive.
const DANGLING_WORD = /(?:^|[^A-Za-z0-9_$])(of|in|and|or|not|await|new|match|typeof|instanceof|as)$/;

// A Python declaration head, tested against the whole cursor line (the `def`
// usually sits in `currentLinePrefix` while the ghost supplies the parameters).
const PY_DECLARATION = /^\s*(async\s+)?(def|class)\b/;

const CLOSER_FOR: { [opener: string]: string } = { "(": ")", "[": "]", "{": "}" };

// Only the shapes the construct arm was measured on. Everything else takes the
// line and statement rules: the construct bound trades away half the line
// bound's precision, and that trade was priced on these openers alone.
const CONSTRUCT_OPENERS: { [languageId: string]: string[] } = {
  rust: ["match", "if let", "while let"],
  go: ["if err != nil", "switch", "select"],
  csharp: ["switch", "try"],
  typescript: ["switch", "try"],
  python: ["match", "try"],
};

const OPENER_PATTERNS: { [languageId: string]: RegExp[] } = Object.fromEntries(
  Object.entries(CONSTRUCT_OPENERS).map(([languageId, openers]) => [languageId, openers.map(openerPattern)])
);

// Whitespace-insensitive between the words of a phrase (`if err!=nil` is the
// same opener as `if err != nil`), anchored at the start of the trimmed line
// and closed on a word boundary so `matches` is not `match`.
function openerPattern(opener: string): RegExp {
  const words = opener.split(" ");
  let source = "^";
  for (let i = 0; i < words.length; i++) {
    if (i > 0) {
      const joinsWords = /\w$/.test(words[i - 1]) && /^\w/.test(words[i]);
      source += joinsWords ? "\\s+" : "\\s*";
    }
    source += words[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(source + (/\w$/.test(opener) ? "\\b" : ""));
}

function constructOpenersFor(languageId: string): RegExp[] {
  return OPENER_PATTERNS[TS_LANGUAGE_IDS.has(languageId) ? "typescript" : languageId] ?? [];
}

/**
 * The language has a statement grammar in this module. `CONSTRUCT_OPENERS` is
 * that list because it is the same five: the construct table, the terminator
 * split in `endsStatement`, the quote table and the DANGLING classes were all
 * measured on these languages and no other, and the header above says the
 * tables are not widened without measuring again.
 *
 * Prose no longer reaches the bound at all: since v29 the provider serves code
 * only (`fimLanguages.ts`), and markdown, plaintext, latex and asciidoc are dark
 * before the debounce. What can still reach it without a row here is a language
 * a human added to `column80.fimLanguages`, and for that one this predicate is
 * the whole answer: keep the structural half, skip the grammar, serve one
 * content line.
 *
 * The prose measurement stands as the reason the split exists. There the
 * DANGLING class was not a weaker rule, it was the wrong question: `.` `,` `:`
 * `?` are how a prose sentence ends, so every safe point dangled and the bound
 * refused 28 of 28 sites over this repo's own ARCHITECTURE.md. Applying a rule
 * outside the population it was measured on is the defect, not the bound
 * running.
 */
function hasStatementGrammar(languageId: string): boolean {
  return TS_LANGUAGE_IDS.has(languageId) || CONSTRUCT_OPENERS[languageId] !== undefined;
}

/**
 * The text ends on a block it just opened, judged without a language.
 *
 * For the length floor, which runs downstream of the bound and has no language
 * in hand. Language-blindness is safe HERE and nowhere else: the floor only
 * runs at bounded sites, and rule 5 lets a tail of either character stand only
 * where it is a block opener - `opensBlockAtTail` for `{`, the Python
 * declaration leg for `:`. So a bounded ghost that reaches the floor ending on
 * one is the finding-8 signature shape (`) {`, `Self {`, `self):`) and nothing
 * else.
 */
export function endsOnBlockOpener(text: string): boolean {
  const tail = text.replace(/\s+$/, "");
  if (tail.endsWith(":")) {
    return true;
  }
  // Same shape `opensBlockAtTail` tests, so the two cannot disagree about the
  // same character: the `{` is the only thing the served text left open.
  const stack = scanBrackets(tail, bracketSyntaxFor("")).stack;
  return tail.endsWith("{") && stack.length === 1 && stack[0] === "{";
}

/**
 * The statement is over, provable from the served text alone.
 *
 * Reading the line below to prove the statement ended is paid for at 23.5ms a
 * decoded line, and python read 2.14 content lines a request against
 * typescript's 1.15 for it. Deciding on its own line took python's live p50
 * from 160ms to 138ms and the line rule's own p90 from 191 to 170, over 150
 * sites a run. It did NOT move the language's p90, which stays at 204: that
 * number is set by the declaration sites whose parameter list genuinely spans
 * lines, and no lookahead rule reaches those.
 *
 * - C family, Rust and the TS family: the `;{}` terminator, reached.
 * - Python: zero bracket balance and no trailing `\`, in a statement that began
 *   in the served text. Python has exactly two line-continuation mechanisms,
 *   the explicit backslash and being inside brackets, and zero balance excludes
 *   the second, so a line that is neither ends the statement and a `.` or `+`
 *   opening the line below it is a syntax error. Checked rather than assumed:
 *   over 1,244 files of real python (226k code lines, 18,060 logical lines
 *   spanning more than one physical line, `tokenize` as the oracle) there is
 *   not one line at zero balance without a trailing `\` whose statement
 *   continues. `beginsHere` is the caveat that check cannot see; see
 *   `statementScan`.
 * - Go stays out. Its automatic semicolon insertion is a test on the LAST
 *   TOKEN, not on balance - a line ending in `,` or a binary operator really
 *   does continue - so the same argument needs a different rule there, and go
 *   is already inside the bar at p90 178ms.
 */
function endsStatement(tail: string, languageId: string, beginsHere: boolean): boolean {
  if (languageId === "python") {
    return beginsHere && !tail.endsWith("\\");
  }
  return languageId !== "go" && /[;{}]$/.test(tail);
}

// Where `{` opens a block. Python is the exception: `{` there is a dict or a
// set literal and the block opener is `:`, so the block-opener rules below have
// nothing to fire on in Python that is not mid-expression. Go IS included even
// though it has no statement terminator, because its declaration heads are the
// same shape and 43 of the 152 cap-rule sites were Go.
function braceBlockLanguage(languageId: string): boolean {
  return languageId !== "python";
}

/**
 * The text ends on a block it just opened, with nothing else left open.
 *
 * `fn foo(a: T) -> R {` is not a mid-expression cut. It is the normal state of a
 * half-typed function, and the tsc measurement that justified the unsafe-tail
 * rule (40 to 92 syntax errors) was about expression cuts - `compute(` served as
 * `compute()` - not about a block opener at the end of a line. Before this the
 * fresh `{` kept the statement's balance non-zero forever, so nothing could
 * terminate it: 145 of 152 cap-rule sites were declaration heads (decl-name 67,
 * decl-args 56, decl-open 22) and 117 of the 152 ended in a closing brace rule 6
 * had appended, which is a whole function, small.
 *
 * `(` and `[` never qualify and never will: `compute(` balanced to `compute()`
 * changes what the code means.
 */
function opensBlockAtTail(tail: string, stack: string[], languageId: string): boolean {
  return braceBlockLanguage(languageId) && stack.length === 1 && stack[0] === "{" && tail.endsWith("{");
}

// Which quote characters delimit a literal whose contents the bracket scan
// skips. Rust is the odd one: `'` is a lifetime tick far more often than a
// char literal, so it goes in `charQuote` and only opens a literal where the
// text at it actually has char-literal shape.
function literalQuotesFor(languageId: string): string {
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return "\"'`";
  }
  if (languageId === "go") {
    return "\"'`";
  }
  if (languageId === "python" || languageId === "csharp") {
    return "\"'";
  }
  return '"';
}

// Everything the scan skips, in one place. The comment opener comes from the
// comment table rather than a second copy of it: prose in a `//` line is not
// structure, and an apostrophe in `// it's` opened a literal that swallowed the
// rest of the scan at 97 of 290 TypeScript files in the corpus. That one
// swallowed scan makes the statement look permanently unterminated, so the
// extension runs to the cap - the cap rule is where the p90 latency miss lives.
function bracketSyntaxFor(languageId: string): BracketSyntax {
  return {
    literalQuotes: literalQuotesFor(languageId),
    lineComment: lineCommentFor(languageId),
    charQuote: languageId === "rust" ? "'" : "",
  };
}

// The SHORTEST opener in the language's row: a longer one starts with it
// (`///` with `//`, `#!` with `#`), so the shortest is the prefix that always
// matches first. An unmapped language gets no comment skipping, which is the
// scan it had before.
function lineCommentFor(languageId: string): string {
  let shortest = "";
  for (const opener of commentSyntaxFor(languageId)?.line ?? []) {
    if (shortest === "" || opener.length < shortest.length) {
      shortest = opener;
    }
  }
  return shortest;
}

/** The whole bound: cut, safe-point adjust, balance. */
export function boundContinuation(raw: string, ctx: BoundContext): BoundResult {
  const lines = raw.split("\n");
  const lead = leadingBlanks(lines);
  if (lead >= lines.length) {
    return { text: "", rule: "empty", droppedLines: 0, appended: "", refusedUnsafe: false };
  }
  const bound = computeBound(lines, lead, ctx);
  const droppedLines = droppedContentLines(lines, bound.end);
  if (bound.refusedUnsafe) {
    return { text: "", rule: "empty", droppedLines, appended: "", refusedUnsafe: true };
  }
  const cut = lines.slice(0, bound.end).join("\n");
  const appended = missingClosers(cut, ctx.languageId);
  return { text: withClosers(cut, appended), rule: bound.rule, droppedLines, appended, refusedUnsafe: false };
}

// Rule 6 puts the closers "on the same line, at the very end of the text". A
// raw that ends with a newline would otherwise put them on a line of their own,
// and in a CRLF generation after the `\r`, where the ghost renders a phantom
// character before them.
function withClosers(cut: string, appended: string): string {
  return appended === "" ? cut : cut.replace(/\s+$/, "") + appended;
}

/** Streaming predicate. True when the cut is DECIDED, so the reader may abort:
 *  at every prefix where this is true, `boundContinuation` on the prefix serves
 *  what it serves on the whole generation. Only complete lines are judged, and
 *  running out of text is never a decision. */
export function boundReached(raw: string, ctx: BoundContext): boolean {
  const lastNewline = raw.lastIndexOf("\n");
  if (lastNewline === -1) {
    return false; // the only line so far is partial, and a partial line grows
  }
  const complete = raw.slice(0, lastNewline).split("\n");
  const lead = leadingBlanks(complete);
  // Content lines, as rule 4 counts them: an interior blank line is not one of
  // the cap's slots here either.
  const contentSeen = contentLinesIn(complete, lead, complete.length);
  if (contentSeen <= 0) {
    return false;
  }
  if (contentSeen >= capOf(ctx)) {
    return true; // nothing past the cap can move the cut
  }
  return computeBound(complete, lead, ctx).decided;
}

/** The safety half on its own, for text that later filters have reshaped:
 *  retract to the last safe line boundary when the tail is unsafe, then append
 *  the missing closers. Idempotent, and never extends. */
export function sealCut(text: string, ctx: BoundContext): { text: string; appended: string } {
  const cut = retractToSafeCut(text, ctx);
  const appended = missingClosers(cut, ctx.languageId);
  return { text: withClosers(cut, appended), appended };
}

/** The retract half of the seal on its own, with no balance step.
 *
 *  For the one place the balance step is wrong: after a SUFFIX-aware filter has
 *  decided a closer belongs to the buffer and removed it. Rule 6 is blind to
 *  the suffix, so re-balancing there puts that closer straight back and the
 *  duplicate lands in the buffer on accept. Idempotent, and never extends. */
export function retractToSafeCut(text: string, ctx: BoundContext): string {
  const lines = text.split("\n");
  const head = safetyHead(leadingBlanks(lines), ctx.currentLinePrefix);
  let end = lines.length;
  while (end > 0 && !safeTail(lines.slice(0, end).join("\n"), head, ctx.languageId)) {
    end--;
  }
  return lines.slice(0, end).join("\n");
}

interface Bound {
  /** Exclusive line index of the cut. */
  end: number;
  rule: BoundRule;
  refusedUnsafe: boolean;
  /** The cut cannot move: the extension stopped for a stable reason and the
   *  tail is safe. Streaming only. */
  decided: boolean;
}

interface Scan {
  end: number;
  /** The cap stopped the scan, rather than the unit ending. */
  capped: boolean;
  /** The scan stopped for a reason a longer read cannot revisit: the statement
   *  terminated, the construct closed, the next line was already in hand and
   *  did not continue, or the cap filled. Running out of text is not one. */
  stable: boolean;
  rule: BoundRule;
}

function computeBound(lines: string[], lead: number, ctx: BoundContext): Bound {
  const cap = capOf(ctx);
  const first = lines[lead].trim();
  const opensConstruct = constructOpenersFor(ctx.languageId).some((pattern) => pattern.test(first));
  // The construct test comes first: a first content line that opens one takes
  // the construct extension, everything else takes the statement extension.
  const scan = opensConstruct ? constructScan(lines, lead, cap, ctx) : statementScan(lines, lead, cap, ctx);
  const rule = scan.capped ? "cap" : scan.end === lead + 1 ? "line" : scan.rule;
  return safePoint(lines, lead, cap, scan, rule, ctx);
}

// Extend while the statement is unterminated: brackets still open, or the next
// line opens with a continuation token. Go is the one language with neither a
// terminator nor a balance rule of its own, so for it a balanced statement ends
// as soon as the next line stops continuing it. Measured on the chained
// population: same precision as the line bound with 2.75x the correct lines.
//
// A trailing block opener terminates the statement in every brace language, Go
// included. That arm is not part of the family split, which is why it is tested
// on its own below.
function statementScan(lines: string[], lead: number, cap: number, ctx: BoundContext): Scan {
  const syntax = bracketSyntaxFor(ctx.languageId);
  // The statement includes the cursor's line only when the ghost continues it.
  // Backwards, and `fn f() {|` looks permanently unterminated, because the
  // prefix's `{` is open and nothing the ghost writes will close it.
  const head = lead === 0 ? ctx.currentLinePrefix : "";
  // Whether the statement BEGINS in the served text, which is what lets a
  // balance of zero mean anything. The balance is local: `head` is the cursor's
  // line, never the buffer above it, so a `(` opened three lines up the file is
  // invisible and the scan reads balanced in the middle of an expression. A
  // first content line that opens with a continuation token, prefix included,
  // is the local evidence that this happened, and there the next line is the
  // only signal there is. Two of the 150 python raws in the spike-1 corpus are
  // exactly that (a parenthesized sum with `+` opening every line); without
  // this they each lose three continuation lines.
  const beginsHere = !CONTINUATION.test(head + lines[lead]);
  let end = lead + 1;
  for (;;) {
    const accumulated = lines.slice(lead, end).join("\n");
    const tail = accumulated.trimEnd();
    const stack = scanBrackets(head + accumulated, syntax).stack;
    const balanced = stack.length === 0;
    // An ended statement needs no lookahead, and that is the whole latency
    // case: `a();` decides on the line it ends on, so the reader aborts at the
    // first newline after content instead of waiting out another line. Python
    // decides here too, on balance rather than on a terminator character.
    //
    // A block the text just opened terminates it too, and that is not the
    // `;{}` test with a wider net: `balanced` is false there, so a fresh `{`
    // could never satisfy it and every declaration head ran to the cap. This
    // arm is the one that fires in Go as well, where there is no terminator to
    // test for at all.
    if (balanced ? endsStatement(tail, ctx.languageId, beginsHere) : opensBlockAtTail(tail, stack, ctx.languageId)) {
      return { end, capped: false, stable: true, rule: "statement" };
    }
    if (end >= lines.length) {
      return { end, capped: false, stable: false, rule: "statement" };
    }
    if (balanced && !CONTINUATION.test(lines[end])) {
      return { end, capped: false, stable: true, rule: "statement" };
    }
    if (contentLinesIn(lines, lead, end) >= cap) {
      return { end, capped: true, stable: true, rule: "statement" };
    }
    end++;
  }
}

function constructScan(lines: string[], lead: number, cap: number, ctx: BoundContext): Scan {
  if (ctx.languageId === "python") {
    return pythonConstructScan(lines, lead, cap, ctx);
  }
  const syntax = bracketSyntaxFor(ctx.languageId);
  let started = false;
  let end = lead;
  while (end < lines.length) {
    end++;
    const depth = braceDepth(lines.slice(lead, end).join("\n"), syntax);
    started = started || depth > 0;
    // `end > lead + 1` keeps the opener's own line from closing the construct:
    // a `{` and its `}` on one line is the opener, not the whole unit.
    if (started && depth === 0 && end > lead + 1) {
      return { end, capped: false, stable: true, rule: "construct" };
    }
    if (contentLinesIn(lines, lead, end) >= cap) {
      // The cap is a decision either way: nothing past it can move the cut, and
      // the statement fallback carries its own stability.
      return started
        ? { end, capped: true, stable: true, rule: "construct" }
        : statementScan(lines, lead, cap, ctx);
    }
  }
  // Out of text. "No brace yet" is a ran-out-of-text condition, never a
  // decision: an Allman brace one line further down turns this back into a
  // construct, and propagating the statement scan's `stable` here aborted a
  // C# `switch (kind)` before its own `{` had arrived.
  return started
    ? { end, capped: false, stable: false, rule: "construct" }
    : { ...statementScan(lines, lead, cap, ctx), stable: false };
}

// Python's construct closes when the indentation returns to the opener's own
// level. `else`/`elif`/`except`/`finally` at that level continue the construct
// rather than close it.
const PY_CONTINUES = /^\s*(else|elif|except|finally)\b/;

function pythonConstructScan(lines: string[], lead: number, cap: number, ctx: BoundContext): Scan {
  // The opener's own level is its COLUMN, and when the ghost continues the
  // cursor's line that column lives in the prefix, not in the raw text. The
  // same lead-zero trap as the statement balance: measure it from the raw
  // alone and `    match cmd:|` never closes.
  const base = (lead === 0 ? ctx.currentLinePrefix.length : 0) + indentWidth(lines[lead]);
  let end = lead + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() !== "" && indentWidth(line) <= base && !PY_CONTINUES.test(line)) {
      return { end, capped: false, stable: true, rule: "construct" };
    }
    if (contentLinesIn(lines, lead, end) >= cap) {
      return { end, capped: true, stable: true, rule: "construct" };
    }
    end++;
  }
  return { end, capped: false, stable: false, rule: "construct" };
}

// A cut point is a line boundary, never mid-line: extend to the next safe
// boundary under the same cap, else retract to the last safe one before the
// bound's own cut, else refuse the whole ghost.
function safePoint(lines: string[], lead: number, cap: number, scan: Scan, rule: BoundRule, ctx: BoundContext): Bound {
  const end = scan.end;
  const head = safetyHead(lead, ctx.currentLinePrefix);
  const safeAt = (at: number): boolean => safeTail(lines.slice(lead, at).join("\n"), head, ctx.languageId);
  if (safeAt(end)) {
    return { end, rule, refusedUnsafe: false, decided: scan.stable };
  }
  // An unsafe tail is never decided: the safe point this search settles on can
  // move once lines nobody has generated yet arrive.
  let forward = end + 1;
  while (contentLinesIn(lines, lead, forward) <= cap && forward <= lines.length) {
    if (safeAt(forward)) {
      return { end: forward, rule, refusedUnsafe: false, decided: false };
    }
    forward++;
  }
  for (let back = end - 1; back > lead; back--) {
    if (safeAt(back)) {
      return { end: back, rule, refusedUnsafe: false, decided: false };
    }
  }
  return { end: lead, rule: "empty", refusedUnsafe: true, decided: false };
}

/**
 * Rule 5 and rule 6 ask different questions, and they must see different text.
 *
 * SAFETY asks "can the ghost stop here". A trailing `,` at `pub fn foo(|` is
 * legal precisely because the buffer's `(` is open around it, so this test sees
 * `currentLinePrefix`. Fifteen of 41 measured refusals were multi-line
 * parameter lists where the opener sat in the prefix and the served text opened
 * nothing, so the comma exception never fired and every line dangled.
 *
 * BALANCE asks "whose closer is missing", and that answer is the served text's
 * alone: an opener in the prefix is the buffer's, and the editor has usually
 * auto-inserted its closer into the suffix. `missingClosers` stays prefix-blind
 * for that reason. Collapsing the two is how this comes back.
 */
function safetyHead(lead: number, prefix: string): string {
  // Only a lead of zero puts the prefix on the served text's own line. Past a
  // blank line the prefix is a line above, and a line comment in it has ended.
  return lead === 0 ? prefix : prefix + "\n";
}

function safeTail(text: string, head: string, languageId: string): boolean {
  const tail = text.replace(/\s+$/, "");
  if (tail === "") {
    return true;
  }
  const syntax = bracketSyntaxFor(languageId);
  const scan = scanBrackets(head + tail, syntax);
  // A cut inside an unterminated literal is a cut mid-string, not a cut in
  // code. This is also what makes rule 6's stated justification true: it
  // declines to balance quotes because "a dangling quote means the model is
  // mid-literal and the safety rule above already refuses that tail", and until
  // this line the safety rule only ever inspected the last character. Without
  // it `sealCut('foo("bar')` grows a closer per application forever, because
  // the closer it just appended is swallowed by that same open literal.
  if (scan.inLiteral) {
    return false;
  }
  // A cut whose last line is nothing but a comment is not a cut in code, and
  // rule 6 appends "at the very end of the text" - inside that comment, where
  // the closer is inert AND visible. 9 of 750 real generations did exactly
  // that. Two conditions keep the blast radius at the measured defect:
  //
  // - Something to append. A comment line over balanced code is an ordinary
  //   safe stop and the comment rules remove it downstream anyway.
  // - The comment is the whole line. A TRAILING comment has real code in front
  //   of it, and `cutIntroducedComment` runs after the bound to strip exactly
  //   that shape (`foo(a, // note` -> `foo(a,`); retracting here would refuse a
  //   ghost the pipeline already handles.
  if (scan.inLineComment && scan.stack.length > 0 && isCommentOnlyLine(lastLineOf(head + tail), syntax)) {
    return false;
  }
  const stack = scan.stack;
  const last = tail[tail.length - 1];
  // The one opener a ghost may end on. One content line only, which is the
  // shape the measurement covers: the model's first content line is the rest of
  // the signature and nothing else, and rule 6 leaving that `{` open is what
  // makes the ghost the signature the human was typing rather than a signature
  // plus a body plus a brace. Past one line there is a statement above the
  // opener and serving that unbalanced was never measured.
  if (opensBlockAtTail(tail, stack, languageId) && contentLinesIn(text.split("\n"), 0, Infinity) === 1) {
    return true;
  }
  if (stack[stack.length - 1] === last) {
    return false; // ends on an opener the served text itself left unclosed
  }
  // Everything above this line is structural - an open literal, an open bracket,
  // a comment the closers would land inside - and holds in any language. The
  // DANGLING classes below it are a statement grammar, so a language without one
  // keeps the structural half and stops here. A bound is if anything MORE
  // desirable in prose than in code; what it must not do is call a full stop a
  // dangling expression.
  if (!hasStatementGrammar(languageId)) {
    return true;
  }
  if (last === ",") {
    // A closer is about to follow, and a trailing comma before a closer is
    // legal in all five languages. Without this the cap and the safety rule
    // together refuse every `match`/`switch` longer than four lines: the opener
    // line dangles, every arm below it dangles on its comma, and the retract
    // finds nothing.
    return stack.length > 0;
  }
  if (last === ":" && languageId === "python" && stack.length === 0 && PY_DECLARATION.test(lastLineOf(head + tail))) {
    // A Python declaration head is a whole line, not a dangler: `def f(x) -> T:`
    // is exactly what a plain ghost is for at a signature site, and what follows
    // it is a body the bound exists to refuse. Ten of the 28 Python refusals
    // were a signature line followed by docstring prose, where every forward
    // line inside the cap ended in `.` or `:` and the retract found nothing.
    //
    // Declarations only, and deliberately. The broader claim - any `:` at zero
    // bracket balance is a block header - collides with rule 5, which lists `:`
    // as dangling without exception and whose oracle pins `if x:` extending to
    // its first body line. Every one of the ten measured refusals is a `def`,
    // so this exempts what the evidence covers. Inside brackets the same
    // character is a dict key, an annotation or a slice, and still dangles.
    return true;
  }
  return !endsDangling(tail);
}

function endsDangling(tail: string): boolean {
  // Go's `count++` and `i--` are whole statements. The operator class was
  // calling all 180 of them in the SevenDB corpus an unsafe tail.
  if (/(\+\+|--)$/.test(tail)) {
    return false;
  }
  if (DANGLING_WORD.test(tail)) {
    return true;
  }
  // A generic close is not the `>` operator: 175 lines in the C# corpus are an
  // Allman-brace declaration ending in one (`: JsonConverter<double>`), and
  // each cost a serve. The line's own `<`/`>` must balance, which `->` and a
  // bare comparison never do, and `=>` keeps its own meaning.
  if (tail.endsWith(">") && !tail.endsWith("=>") && anglesBalance(lastLineOf(tail))) {
    return false;
  }
  return DANGLING.test(tail);
}

function anglesBalance(line: string): boolean {
  let depth = 0;
  for (const ch of line) {
    if (ch === "<") {
      depth++;
    } else if (ch === ">") {
      depth--;
    }
    if (depth < 0) {
      return false;
    }
  }
  return depth === 0;
}

function lastLineOf(text: string): string {
  return text.slice(text.lastIndexOf("\n") + 1);
}

function isCommentOnlyLine(line: string, syntax: BracketSyntax): boolean {
  const marker = syntax.lineComment ?? "";
  return marker !== "" && line.trimStart().startsWith(marker);
}

// Only the openers the SERVED text opened: one in `currentLinePrefix`
// is the buffer's, and the editor has usually auto-inserted its closer into the
// suffix already. Measured need: a bounded ghost leaves unbalanced parens at 7%
// of brace-language declaration heads and 45% of Python ones.
function missingClosers(text: string, languageId: string): string {
  const stack = scanBrackets(text, bracketSyntaxFor(languageId)).stack;
  const tail = text.replace(/\s+$/, "");
  // The block the ghost just opened stays open. Closing it is what turned a
  // signature into `fn foo(a: T) -> R {}`, an empty function, at 117 of 152
  // cap-rule sites. Same predicate rule 5 uses to let the tail stand, so the
  // two rules cannot disagree about the same character.
  if (opensBlockAtTail(tail, stack, languageId) && contentLinesIn(text.split("\n"), 0, Infinity) === 1) {
    return "";
  }
  let closers = "";
  for (let i = stack.length - 1; i >= 0; i--) {
    closers += CLOSER_FOR[stack[i]];
  }
  return closers;
}

function braceDepth(text: string, syntax: BracketSyntax): number {
  return scanBrackets(text, syntax).stack.filter((opener) => opener === "{").length;
}

function capOf(ctx: BoundContext): number {
  return Math.max(1, ctx.maxLines ?? MAX_BOUND_LINES);
}

function leadingBlanks(lines: string[]): number {
  let lead = 0;
  while (lead < lines.length && lines[lead].trim() === "") {
    lead++;
  }
  return lead;
}

// Trailing blank lines are not content, so a raw ending in a newline does not
// report a dropped line that was never there.
function droppedContentLines(lines: string[], end: number): number {
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === "") {
    last--;
  }
  return Math.max(0, last + 1 - end);
}

// Rule 4's budget is CONTENT lines, not raw ones. Counting raw lines from the
// lead let an interior blank line eat a slot, so a `match` with a blank between
// two arms served three arms where the rule says four.
function contentLinesIn(lines: string[], from: number, to: number): number {
  let count = 0;
  for (let i = from; i < Math.min(to, lines.length); i++) {
    if (lines[i].trim() !== "") {
      count++;
    }
  }
  return count;
}

function indentWidth(line: string): number {
  return line.match(/^[ \t]*/)?.[0].length ?? 0;
}
