/**
 * Refine: what the repair gesture becomes when the build is already clean.
 *
 * Today `RepairSession.next` surfaces `why=clean` the moment the error list is
 * empty, so a function the compiler is happy with has no path to a model at
 * all. The human's complaint is not about correctness: "whatever was generated
 * doesn't really match the style of what they want to implement". So the manual
 * repair command, on a green build, asks the 30b to rewrite the function the way
 * THIS repository already writes code, with real call sites of the types and
 * members the function uses in front of it.
 *
 * Three things keep this from being a second repair loop wearing a hat:
 *
 * - **Its own budget.** A refine is not a fix. Product invariant 4 caps repair
 *   at two rounds because that is what the compiler needs, and a style pass must
 *   not eat one of them. `RefineBudget` is a separate counter with its own name
 *   on the channel, and it grants exactly one round.
 * - **Manual only.** The automatic post-accept path still ends at `why=clean`,
 *   silently. The v22 verdict admitted usage injection for fn-gen only as a
 *   USER GESTURE with visible, ordered context; a silent version is a
 *   prompt-identity change, not a tuning choice.
 * - **No usage means no round.** A function whose symbols the repo never calls
 *   anywhere gets a channel line and nothing else. Injecting something adjacent
 *   and hoping is the retrieval mistake the v22 spike already paid for.
 *
 * Pure: no vscode, no I/O, no clock. The vscode layer resolves the references,
 * reads the files and runs the compiler; every decision on this page is a
 * function of its arguments.
 */

import { Diagnostic } from "./compilerOracle";
import { fenceFor } from "./instructPostprocess";
import { ContextBlock, GenKind, SECTION_SEPARATOR, renderContextBlock } from "./prompt";
import { maskNonCode } from "./fimInject";
import { dedentReplyCode } from "./placeReply";
import { dedentDocComment } from "./reindent";
import { STATIC_ENTRY_POINTS, SpanTypesInput, spanTypesInPlay } from "./repairTypes";
import { UsageSite } from "./usageWindows";

/** How many rounds a refine may spend. Deliberately its own constant and its
 *  own type, not a second reading of the repair cap: the two answer different
 *  questions and a shared number would invite one to drift into the other. One,
 *  because a refine has no compiler signal to iterate against - the build was
 *  green before the round and the human is the only judge of whether the second
 *  attempt reads better than the first. */
export const REFINE_ROUND_CAP = 1;

export type RefineDeclineReason =
  | "budget-exhausted"
  | "no-targets"
  | "no-usage"
  | "no-reference-provider";

export type RefineAction =
  | { kind: "refine"; round: 1 }
  | { kind: "decline"; why: RefineDeclineReason };

/**
 * The refine budget, structurally separate from `RepairSession`'s cap.
 *
 * `rounds` is typed `0 | 1` and only `next()` advances it, the same shape bar 4
 * uses. What that buys, precisely: a refine round can never be a repair round.
 * It shares no counter, no reset and no state with the repair session, so the
 * two rounds the compiler is guaranteed cannot be spent on style.
 *
 * What it does NOT buy, said plainly because the first draft of this comment
 * implied otherwise: it is one round per GESTURE, not per function or per
 * session. The instance is created inside the refine and dies with it, so two
 * consecutive `column80.repairFunction` presses on the same clean function spend
 * two rounds. That is the intended behaviour - each press is a fresh human
 * gesture through the consent gate, and a human who asks twice meant to - but it
 * means the decline branch is unreachable on the shipped path and exists for a
 * caller that loops.
 */
export class RefineBudget {
  private rounds: 0 | 1 = 0;

  get roundsUsed(): 0 | 1 {
    return this.rounds;
  }

  /** Consume the round, or decline with the reason. The round is consumed
   *  BEFORE any model call, like the repair cap: an abandoned round still
   *  counts, which is the conservative direction for a hard budget. */
  next(): RefineAction {
    if (this.rounds === REFINE_ROUND_CAP) {
      return { kind: "decline", why: "budget-exhausted" };
    }
    this.rounds = 1;
    return { kind: "refine", round: 1 };
  }
}

/** The masked text, unless masking RAN AWAY.
 *
 *  `maskNonCode`'s literal scanner is C-shaped: it pairs quotes and honours a
 *  backslash escape. Two ordinary shapes in the shipped languages defeat it, and
 *  when they do the damage is total, because an unclosed literal blanks
 *  everything from the opener to the end of the span. A function full of calls
 *  then reports no targets and the human is told there is nothing here.
 *
 *  - Rust: an odd number of apostrophes, which is every `&\'static str`, every
 *    `+ \'static` bound and every single lifetime parameter.
 *  - C#: `@"C:\data\"`, a verbatim string whose last character is a backslash.
 *    The scanner reads the closing quote as escaped and walks past it.
 *
 *  Fixing the scanner per language is the real answer and is a change to a
 *  primitive three subsystems share. This is the guard that keeps the failure
 *  from being total, and it tests for the runaway's SIGNATURE rather than for
 *  how much was removed: a long blank TAIL where the raw text has code. A
 *  comment-heavy function legitimately loses half its characters and must keep
 *  its masking, which a share-based threshold gets wrong (measured: an ordinary
 *  five-line Rust function with one comment and one string keeps 0.495 of its
 *  non-whitespace, and a single lifetime tick keeps 0.143).
 *
 *  The cost of reading raw is a name from a comment or a string reaching the
 *  reference provider, which spends one query and finds nothing.
 */
function maskedOrRaw(code: string): string {
  const masked = maskNonCode(code);
  const lastCode = masked.search(/\S(?=\s*$)/);
  const tailStart = lastCode < 0 ? 0 : lastCode + 1;
  const droppedTail = code.slice(tailStart).replace(/\s/g, "").length;
  const total = code.replace(/\s/g, "").length;
  if (total === 0) {
    return masked;
  }
  return droppedTail / total > 0.3 ? code : masked;
}

/** A symbol the span uses, at the position where it uses it. The position is a
 *  DOCUMENT cursor, not a span-relative one, because the only thing that ever
 *  consumes it is a reference query against the document. */
export interface RefineTarget {
  name: string;
  /** 0-based, as everywhere else in this codebase. */
  line: number;
  character: number;
  /** Which scan found it. On the channel, so a target list that looks wrong can
   *  be traced to the leg that produced it. */
  via: "member" | "type";
}

export interface RefineTargetInput {
  languageId: string;
  /** The span's text as it sits in the document, signature included. */
  code: string;
  /** Where `code` starts in the document. The first line of `code` is offset by
   *  `spanStartCharacter`; every later line starts at column 0. */
  spanStartLine: number;
  spanStartCharacter: number;
  signature?: string;
  docComment?: string;
  /** How many targets to return. A budget, not a preference: every target costs
   *  a reference round trip, and C# alone charges a ~500ms floor per call. */
  max: number;
  /** Where the round's FIRST eligible diagnostic points, in the same document
   *  coordinates the targets come back in. Absent keeps document order, which is
   *  what a refine round has: a clean build has no diagnostic to steer by.
   *
   *  Present, it reorders. The scout ran this scan over one reproduction per
   *  language and the failing call was NEVER first: `value`/`Value` outranked it
   *  in all five, `Console.WriteLine`, `fmt.Println` and `json.dumps` outranked
   *  it in three, and the character budget is spent in target order. Ordering by
   *  proximity is therefore a requirement rather than a preference. */
  anchor?: { line: number; character: number };
  /** The declared symbol being refined, as the symbol provider spells it, passed
   *  straight through to `spanTypesInPlay`. A refine and a repair of one span
   *  must not disagree about what is in play, which is why this reader is shared
   *  at all; a field on one side only would be exactly that disagreement.
   *
   *  Its effect here is smaller than it looks, and that is measured rather than
   *  assumed: target positions come from comment- and string-MASKED text, so a
   *  name reaching the type leg only through prose has no position to anchor at
   *  and is already dropped before it can be returned. The shapes where it does
   *  change the answer are the ones where masking degrades - an unterminated
   *  block comment or docstring puts the position scan back on raw text. */
  excludeName?: string;
}

// A member call: the name after a `.` or `::` that opens a parameter list. The
// call is the point - what usage teaches is call SHAPE (v22 measured arity 84%
// to 94-100%, and measured no effect on which member the model picks), so a
// member READ (`x.Field`) is not a target. `::` is in the same pattern rather
// than its own because Rust and C++ spell the same gesture that way and the
// name that follows is in the same position.
const MEMBER_CALL = /(?:\.|::)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^<>()]*>)?\s*\(/g;

// The identifiers a member-call scan would return that are not members of
// anything: a language keyword that legitimately sits after a dot is none of
// these, but a `.await` (Rust) or a `.catch` (TS promise chain) resolves to no
// user symbol and spends a reference round trip finding that out.
const NOT_A_MEMBER = new Set(["await", "catch", "then", "finally", "new", "if", "for", "while", "match", "return"]);

// The QUALIFIERS whose members are standard library and therefore teach nothing
// about how THIS repository calls things. `Console.WriteLine`, `fmt.Println` and
// `json.dumps` were targets in the scout's reproductions, each one a reference
// round trip spent on a symbol whose call sites are the language's, not the
// repo's - and in C# each one is a ~500ms Roslyn floor.
//
// Two halves because the languages spell it two ways. The PascalCase half is
// `repairTypes`' own `STATIC_ENTRY_POINTS`, consulted rather than copied so one
// list answers for both legs. The lower-case half is the module qualifier Go and
// Python write and the TS/JS globals use, which that set has no reason to carry:
// it answers "is this a type worth resolving", and `fmt` is not a type.
//
// The lower-case half is SCOPED BY LANGUAGE, and that is not tidiness. A
// lower-case module name is indistinguishable from a local, a field or a
// parameter, so every entry is a bet that no user value is called that. The bet
// is safe for `fmt` and `strconv` in Go and wrong for `context` in C#: measured
// over the real contoso solution, an unscoped list dropped `context.Fail()` and
// `context.Succeed(...)` from `HandleRequirementAsync`, where `context` is the
// method's own parameter and those two calls are what the method does. C# names
// its statics in PascalCase and has no lower-case module qualifier at all, so it
// gets none.
const GO_MODULES = [
  "fmt", "os", "io", "time", "strings", "strconv", "errors", "log", "bytes",
  "sort", "bufio", "context", "sync", "json", "math", "filepath", "exec",
];
const PY_MODULES = [
  "json", "os", "sys", "re", "math", "random", "datetime", "logging",
  "subprocess", "itertools", "collections", "typing", "time", "shutil",
  "pathlib", "asyncio",
];
const TS_GLOBALS = ["console", "process"];
// Rust reaches std through `::` paths (`std::process::id`), and the module
// segment before the call is what this sees.
const RUST_MODULES = ["std", "core", "alloc", "mem", "ptr", "fs", "env"];

const STDLIB_MODULES_BY_LANG: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["go", new Set(GO_MODULES)],
  ["python", new Set(PY_MODULES)],
  ["typescript", new Set(TS_GLOBALS)],
  ["typescriptreact", new Set(TS_GLOBALS)],
  ["javascript", new Set(TS_GLOBALS)],
  ["javascriptreact", new Set(TS_GLOBALS)],
  ["rust", new Set(RUST_MODULES)],
]);

/** Is the receiver in front of this call a standard-library entry point? Read
 *  off the masked text immediately left of the separator, so nothing is
 *  re-derived and a chained receiver (`self.cache.get(...)`) reads its LAST
 *  segment, which is the one that owns the call. */
function isStdlibQualifier(masked: string, separatorAt: number, languageId: string): boolean {
  const before = masked.slice(0, separatorAt);
  const m = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(before);
  if (!m) {
    return false;
  }
  return STATIC_ENTRY_POINTS.has(m[1]) || STDLIB_MODULES_BY_LANG.get(languageId)?.has(m[1]) === true;
}

/** The span offset of a DOCUMENT position, or -1 when it falls outside the span.
 *  Only the first line of a span is offset by where the span starts. */
function spanOffsetOf(
  at: { line: number; character: number },
  input: RefineTargetInput,
  lineStarts: readonly number[],
  length: number,
): number {
  const row = at.line - input.spanStartLine;
  if (row < 0 || row >= lineStarts.length) {
    return -1;
  }
  const column = row === 0 ? at.character - input.spanStartCharacter : at.character;
  const offset = lineStarts[row] + column;
  return offset >= 0 && offset <= length ? offset : -1;
}

/** The offset of the `)` closing the argument list that opens at or after
 *  `from`, or -1. Bracket-depth over the masked text, so a paren inside a string
 *  cannot close a call. */
function closingParen(masked: string, from: number): number {
  const open = masked.indexOf("(", from);
  if (open < 0) {
    return -1;
  }
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * The symbols a refine round should ask the reference provider about, in the
 * order it should ask.
 *
 * Members lead. What the repo's other call sites carry is call shape, and at a
 * member call the shape is the whole question; a type name's usage is one step
 * further from what the model has to write. Types follow, so a function whose
 * body is mostly construction still has something to show.
 *
 * Read over comment- and string-masked text: a method named in a comment is not
 * called by this function, and a name inside a string literal is data. The
 * positions come back in document coordinates, so the caller hands each one
 * straight to the extractor without re-deriving anything.
 */
export function refineTargets(input: RefineTargetInput): RefineTarget[] {
  const code = typeof input.code === "string" ? input.code : "";
  const masked = maskedOrRaw(code);
  const lineStarts = offsetsOfLineStarts(masked);
  const seen = new Set<string>();
  const out: RefineTarget[] = [];

  const push = (name: string, at: number, via: "member" | "type"): void => {
    if (out.length >= input.max || seen.has(name) || name === "") {
      return;
    }
    seen.add(name);
    const { line, character } = positionOf(at, lineStarts);
    out.push({
      name,
      line: input.spanStartLine + line,
      // Only the FIRST line of a span is offset by where the span starts; the
      // rest begin at the document's own column 0.
      character: line === 0 ? input.spanStartCharacter + character : character,
      via,
    });
  };

  // The member calls, collected before any of them is pushed, because the ORDER
  // is not the order they were found in when an anchor is present.
  const anchorAt =
    input.anchor !== undefined
      ? spanOffsetOf(input.anchor, input, lineStarts, masked.length)
      : -1;
  const calls: Array<{ name: string; at: number; rank: number; distance: number }> = [];
  for (const m of masked.matchAll(MEMBER_CALL)) {
    const name = m[1];
    if (NOT_A_MEMBER.has(name)) {
      continue;
    }
    const separatorAt = m.index ?? 0;
    if (isStdlibQualifier(masked, separatorAt, input.languageId)) {
      continue;
    }
    const at = separatorAt + m[0].lastIndexOf(name);
    // Rank 0 is "the diagnostic is INSIDE this call". The anchor is the enclosing
    // CALL, not the diagnostic's own token: in the session's live capture rustc
    // pointed at the argument `&active_file.cursor`, not at
    // `.to_shard_log_header`, so a scan that ranked by distance to the name
    // alone would have put a nearer, irrelevant call first. Among enclosing
    // calls the innermost wins, which is what `distance` orders on.
    const close = closingParen(masked, at + name.length);
    const encloses = anchorAt >= 0 && close >= 0 && anchorAt >= at && anchorAt <= close;
    calls.push({
      name,
      at,
      rank: anchorAt < 0 ? 0 : encloses ? 0 : 1,
      distance: anchorAt < 0 ? at : encloses ? close - at : Math.abs(at - anchorAt),
    });
  }
  if (anchorAt >= 0) {
    calls.sort((a, b) => a.rank - b.rank || a.distance - b.distance || a.at - b.at);
  }
  for (const c of calls) {
    push(c.name, c.at, "member");
  }

  // The type leg reuses the repair surface's own types-in-play reader rather
  // than a second PascalCase scan, so a refine and a repair round of the same
  // span never disagree about which types are in play - and the junk classes
  // that reader has already been taught (namespace segments, prelude values,
  // ALL_CAPS constants) stay taught.
  const typeInput: SpanTypesInput = {
    languageId: input.languageId,
    signature: input.signature,
    docComment: input.docComment,
    code,
    excludeName: input.excludeName,
  };
  for (const name of spanTypesInPlay(typeInput)) {
    const at = firstWordOccurrence(masked, name);
    if (at >= 0) {
      push(name, at, "type");
    }
    // A type with no occurrence in the text handed in has no cursor to anchor
    // at, and is dropped rather than guessed: a reference query needs a real
    // position, and the span surface leg already discloses that type's shape by
    // name. That is rarer than it sounds on the shipped call shape, and an
    // earlier version of this comment got it wrong: `runRefine` passes the WHOLE
    // span including the signature, so a type named only in the signature does
    // anchor, there.
  }
  return out;
}

/** Byte-free line-start table over the span text. */
function offsetsOfLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function positionOf(at: number, lineStarts: readonly number[]): { line: number; character: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= at) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo, character: at - lineStarts[lo] };
}

/** Where `name` first appears as a whole word. -1 when it does not. */
function firstWordOccurrence(masked: string, name: string): number {
  const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const m = pattern.exec(masked);
  return m ? m.index : -1;
}

/** The document region the refine is rewriting, in the reference provider's own
 *  0-based line unit. */
export interface RefineSpanLines {
  uri: string;
  startLine: number;
  endLine: number;
}

/**
 * Reference locations as usage sites, with the function's OWN uses dropped.
 *
 * Every target cursor sits inside the span being rewritten, so the provider
 * always answers with at least the site that was asked about. Handing that back
 * as an example shows the model the code it is being asked to improve and calls
 * it an idiom - the exact failure `collectUsageWindows`'s `exclude` parameter
 * exists to prevent, widened here from one line to the whole span because a
 * function calls the same member more than once.
 */
export function usageSitesOutsideSpan(
  locations: ReadonlyArray<{ uri: string; line: number }>,
  span: RefineSpanLines,
): UsageSite[] {
  const out: UsageSite[] = [];
  for (const loc of locations) {
    if (loc.uri === span.uri && loc.line >= span.startLine && loc.line <= span.endLine) {
      continue;
    }
    out.push({ uri: loc.uri, line: loc.line });
  }
  return out;
}

/** The header the usage section carries into the prompt and onto the channel.
 *  Names the symbol, because a block of code with no stated relationship to the
 *  target is context the model has to guess the purpose of. */
export function usageHeaderFor(name: string): string {
  return `How this repository already calls \`${name}\`:`;
}

export interface RefinePromptInput {
  /** The function as it sits in the document now, signature included. It
   *  compiles: that is the premise of the whole gesture. */
  code: string;
  docComment?: string;
  languageId?: string;
  /** The rendered usage sections, in the order they should appear. */
  usage?: readonly string[];
  /** The span's types-in-play surface, the same leg a repair round leads with. */
  surface?: string;
  kind?: GenKind;
  /** Python Fork A: the code is the BODY below a preserved docstring. */
  bodyOnly?: boolean;
  /** The column this span was cut from: the target's `headerIndent`, or
   *  `bodyIndent` for a body-only span. Same field, same meaning and the same
   *  reason as `RepairPromptInput.spanIndent` - refine is the THIRD path that
   *  shows a model file-indented code and then places its reply, so it walked
   *  the body one level deeper per press exactly as repair did. Found by review,
   *  session-v35 item 1. */
  spanIndent?: string;
  /** The doc comment's own column. Same field, same reason as
   *  `RepairPromptInput.docIndent`: a bodyOnly target's docstring is already
   *  0-based and must not be stripped again. */
  docIndent?: string;
  /** The user's staged context, read live, exactly as generation and repair
   *  read it. */
  contextBlocks?: readonly ContextBlock[];
}

/**
 * Deterministic, byte-for-byte, the same discipline as `assembleFnGenPrompt` and
 * `assembleRepairPrompt`. Its own function rather than a flag on the repair
 * assembler, because the repair prompt's bytes are pinned by frozen identity
 * oracles and a refine has no diagnostics section to put where they expect one.
 *
 * Section order, and the one thing in it that is a judgement call: the usage
 * windows sit LAST before the code. v28 measured a position effect at the fn-gen
 * surface - the model reaches for whatever sits nearest the code - and the whole
 * point of this round is that the model reaches for the repo's idiom. That is a
 * reasoned placement, not a measured one; the arm that would settle it costs a
 * second model run per function and is not in this session's budget.
 *
 * The instruction is where the hard bar lives in prose: the build was GREEN
 * before this round, so a refine that changes behaviour is a regression however
 * good it looks. It says so, and it says a function that already matches should
 * come back unchanged - which is a real outcome the measurement counts, not a
 * politeness.
 */
export function assembleRefinePrompt(input: RefinePromptInput): string {
  // Normalised to 0-based before it goes in the fence, exactly as
  // assembleRepairPrompt does and for exactly the same reason: the span's later
  // lines carry the FILE's absolute column, a model echoes what it was shown,
  // and the placement then adds the target's indent on top of one the body
  // already had. One level deeper every press. Refine was the third caller of
  // placeGeneratedReply and the last one still feeding it absolute columns.
  const dedented = dedentReplyCode(input.code, input.languageId, input.spanIndent);
  const code = dedented.endsWith("\n") ? dedented : dedented + "\n";
  // Normalised with the code, same reason and same known-column-only rule as
  // assembleRepairPrompt.
  const doc =
    input.docComment === undefined
      ? ""
      : dedentDocComment(input.docComment, input.docIndent).replace(/\s+$/, "") + "\n";
  const isType = input.kind !== undefined && input.kind !== "function";
  const what = input.bodyOnly ? "body" : isType ? String(input.kind) : "function";

  const intro = input.bodyOnly
    ? `The body below (of a ${isType ? "type" : "function"} whose header and docstring are already written) compiles and is correct:`
    : `The ${what} below compiles and is correct:`;
  // Same content classes as the repair code section, same one rule.
  const codeBody = `${doc}${code}`;
  const codeFence = fenceFor(codeBody);
  const codeSection = `${intro}\n${codeFence}${input.languageId ?? ""}\n${codeBody}${codeFence}`;

  const instruction = [
    `Rewrite the ${what} so it reads the way this repository already writes code: the same idioms, the same call shapes, the same helpers as the usage above.`,
    `Do not change what it does. Do not change its name, its signature, or the types it returns. Do not add or remove parameters.`,
    `If it already matches the repository's style, reply with it unchanged.`,
    input.bodyOnly
      ? `Reply with one fenced code block containing ONLY the ${what} — do not repeat the signature, the header, or the docstring. Output nothing outside the code block.`
      : `Reply with one fenced code block containing the complete ${what} definition, signature and body. Output nothing outside the code block.`,
  ].join(" ");

  const sections = [
    ...(input.contextBlocks ?? []).map(renderContextBlock),
    ...(input.surface ? [input.surface] : []),
    ...(input.usage ?? []),
    codeSection,
    instruction,
  ];
  return sections.join(SECTION_SEPARATOR);
}

/**
 * The errors the refine INTRODUCED: present in the post-accept check and not in
 * the pre-refine one.
 *
 * A multiset diff keyed on (file, code, message), never on line or byte offset.
 * A refine rewrites a function body, so every line below it moves; keying on
 * position would report the whole file as new. Keying on the message text alone
 * would hide a genuinely new second instance of an error the file already had,
 * which is why the count matters and not just the key.
 *
 * Warnings are not errors and never fail a build, so they are out of scope here
 * the same way they are out of scope for repair eligibility. A refine that adds
 * a warning is a style question, which is exactly what the human is judging.
 */
export function introducedErrors(
  before: readonly Diagnostic[],
  after: readonly Diagnostic[],
): Diagnostic[] {
  const budget = new Map<string, number>();
  for (const d of before) {
    if (d.level !== "error") {
      continue;
    }
    const key = errorKey(d);
    budget.set(key, (budget.get(key) ?? 0) + 1);
  }
  const out: Diagnostic[] = [];
  for (const d of after) {
    if (d.level !== "error") {
      continue;
    }
    const key = errorKey(d);
    const left = budget.get(key) ?? 0;
    if (left > 0) {
      budget.set(key, left - 1);
      continue;
    }
    out.push(d);
  }
  return out;
}

// The identity of an error for the diff. The file comes off the primary span
// because a message alone travels: "cannot convert" in two files is two faults.
// The span's file NAME is used as reported, not resolved to an absolute path -
// both sides of the diff came from the same checker run shape, so they spell it
// the same way, and resolving would drag a filesystem dependency into a pure
// function for no gain.
function errorKey(d: Diagnostic): string {
  const primary = d.spans.find((s) => s.isPrimary);
  return `${primary?.fileName ?? "-"}\0${d.code ?? "-"}\0${d.message}`;
}
