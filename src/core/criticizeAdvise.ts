// ===========================================================================
// The model-authored path: the model writes the comment blocks and says where
// they go.
//
// This is a SECOND PATH, built alongside the rubric rather than replacing it,
// on the human's instruction of 2026-08-29. The rubric gesture still runs its
// fourteen detectors and still plants their comments; this path is measured
// against it, and the detectors come out only when the measurement says the
// model's blocks are better. Deleting the baseline in the same stroke that
// ships the replacement is how a session ends up with no number.
//
// WHAT THE MODEL IS GIVEN
//   - the diagnostics the developer's OWN tools already produced for this
//     function, and nothing this product re-derived
//   - the function itself
//   - the signature and doc comment of every function it calls
//   - the rubric as prose: what makes a good function, and the fourteen
//     dimensions, walked out of the same registry the scorer walks
//
// WHAT THE MODEL DECIDES
//   Everything: which dimensions fire, what each comment says, and which line
//   each block goes above.
//
// WHY THIS IS NOT ANOTHER LINTER. Nothing here matches a spelling. The
// diagnostics come from clippy, tsc, ruff, Roslyn or go vet, which the
// developer already runs and which are maintained by the people who own the
// language. Where those tools are silent the model infers, and the product
// contributes the one thing neither can do alone: the resolved facts about what
// this function reaches outside itself.
//
// PLACEMENT IS BY TEXT, NOT BY LINE NUMBER. The model quotes the line its block
// belongs above and the product finds that text. Three reasons, and the third
// is the one that matters:
//
//   1. A model one line out still lands correctly. Line arithmetic does not
//      survive an off-by-one and an anchor does.
//   2. There is no edge-case list. One rule covers a doc comment, a one-line
//      body, an attribute, a decorator and a blank line, because none of them
//      is a special case of "find this text".
//   3. A block can only be planted where its own quoted text really is, so the
//      product CANNOT write a comment about a line the developer did not write.
//      That was the invariant the line-number build needed guards for, and here
//      it falls out of the mechanism.
//
// An anchor that matches nothing is DROPPED. An anchor that matches more than
// once is DROPPED, because a block planted on the wrong one of two identical
// lines is a comment about the wrong code, and a model that wants to be planted
// can quote a distinctive line.
//
// Never imports vscode (the src/core rule). Every function here is pure.
// ===========================================================================

import { CriticizeLang } from "./criticizeLang";
import { ReachFact, renderReach } from "./criticizeReach";
import { rubricDimensions } from "./criticizeScore";
import { FunctionUnderReview, unitDefect } from "./criticizeTypes";

/** One diagnostic the developer's own toolchain already produced.
 *
 *  READ OUT OF THE EDITOR, not by running a checker. `cargo clippy` on a cold
 *  crate is minutes and a gesture is not. The language server the developer is
 *  already running has computed these, and slightly stale is the right trade
 *  for evidence handed to a model: the compiler oracle refuses this source, but
 *  it refuses it for GRADING A GENERATED FUNCTION, where a stale diagnostic
 *  makes you accept broken code. Different job, different tolerance. */
export interface ToolDiagnostic {
  /** 1-based document line. */
  line: number;
  severity: "error" | "warning" | "information" | "hint";
  /** Which tool said it: `clippy`, `rust-analyzer`, `ts`, `Pylance`. */
  source: string;
  /** The tool's own rule id, when it has one. `clippy::ptr_arg`, `CS1591`. */
  code: string;
  message: string;
}

/** One downstream callee, as a contract rather than as a body. */
export interface CalleeContract {
  name: string;
  /** The callee's signature, when a server resolved one. */
  signature: string;
  /** Its doc comment, often empty. Measured in phase 5: a callee carries one
   *  30.7-41.5% of the time in Rust, 39.3% in Python, 2.5% in TypeScript. The
   *  NAME still earns the entry's place when the doc does not. */
  doc: string;
}

/** Everything the model is shown besides the function. Every field optional,
 *  every absence a shipped state. */
export interface AdviceEvidence {
  diagnostics?: readonly ToolDiagnostic[];
  callees?: readonly CalleeContract[];
  /** Where every name the body uses is actually defined, and what it is
   *  declared as. See `criticizeReach.ts` for why this block exists and what it
   *  is honestly good for: it kills an INVENTED FAILURE MODE, which is the loss
   *  class that cost a 27B the head-to-head, and it does nothing about a model
   *  misreading the function's own text. */
  reach?: readonly ReachFact[];
}

/** One comment block the model wants planted. */
export interface AdviceBlock {
  /** The dimension this is about, in the model's words. Used for the `C80`
   *  tag. NOT validated against the fourteen: this path exists to find out
   *  whether a model finds things the rubric's dimensions do not name, and a
   *  filter against the list would hide exactly that. */
  dimension: string;
  /** The line's own text, verbatim, that this block goes above. */
  anchor: string;
  /** The document line the model thinks that text is on. A TIE-BREAKER ONLY.
   *
   *  The text stays authoritative: a `line` that names a line whose text does
   *  not match the anchor is ignored entirely, so a model that miscounts still
   *  cannot plant a comment on the wrong code. It is consulted only when the
   *  anchor's text matches SEVERAL lines, which is the one case text alone
   *  cannot resolve.
   *
   *  Measured on the first live run: Opus placed 13 of 15 blocks, and both
   *  misses were one TypeScript signature line that appears twice in its file.
   *  Dropping a correct block over a duplicate `}` or a repeated declaration is
   *  the commonest way this path loses good advice, and the model already knows
   *  which of the two it meant. */
  line?: number;
  /** What the comment says. */
  text: string;
}

export type AdviceFailure =
  | { kind: "transport"; detail: string }
  | { kind: "unreadable"; detail: string };

export type AdviceRead = { ok: true; blocks: readonly AdviceBlock[] } | { ok: false; failure: AdviceFailure };

/** A block that found its line. */
export interface PlacedAdvice {
  block: AdviceBlock;
  /** 1-based document line the block goes above. */
  line: number;
  /** That line's own text, RAW, indentation included, read out of the document
   *  rather than out of the reply.
   *
   *  RAW AND NOT TRIMMED, and the reason is that a trimmed value cannot be
   *  checked. A match only happens when the anchor's trimmed text equals the
   *  line's trimmed text, so a trimmed `lineText` is byte-identical whether it
   *  came from the document or from the model's reply, and the invariant it
   *  exists to demonstrate becomes unfalsifiable. The phase 12 blind oracle
   *  found this and could not write a row for it. The raw line separates the
   *  two on any indented line, and it is the more useful value anyway. */
  lineText: string;
}

/** A block that did not, and why. Kept rather than discarded silently: a path
 *  whose failures are invisible cannot be measured against the one it replaces. */
export interface UnplacedAdvice {
  block: AdviceBlock;
  reason:
    | "no line matches this anchor"
    | "more than one line matches this anchor"
    | "this line already carries the most comments one line may take"
    | "this line is above the region the gesture may write to";
}

export type AdviceTransport = (prompt: string) => Promise<string>;

/** How many blocks one function may collect.
 *
 *  CHOSEN, not measured, and it is a bound on a comment BUDGET rather than on
 *  the model's opinion. Fourteen dimensions on a short function is a wall of
 *  comment nobody reads, and the rubric's own elevation policy exists because
 *  the same problem killed the read-only card in v61. Recorded as chosen in
 *  docs/constants.md. */
export const ADVICE_MAX_BLOCKS = 6;

/**
 * How many blocks may sit above ONE line.
 *
 * WAS ONE, AND THAT WAS WRONG. The first build dropped every block after the
 * first on a given line, justified as "stacking comments on one line is how the
 * tool started reading its own output as the code". That justification named the
 * wrong defect: v62's S62-7 was the tool reading its own comments ACROSS
 * PRESSES, which the strip pass handles, and it says nothing about two comments
 * above one line within a press. The rubric's own planner has always grouped
 * several findings onto one line and rendered each as its own head.
 *
 * The rule cost real advice. Measured 2026-08-29 across every model tried,
 * same-line collision was the LARGEST single loss bucket: 20 of 21 dropped
 * blocks on `qwen3-coder:30b` in the line shape, 16 of 20 in json. Those blocks
 * were not wrong, they were a second thing to say about a line that already had
 * a comment.
 *
 * Bounded rather than unbounded, because a wall of comment above one line is its
 * own defect and `ADVICE_MAX_BLOCKS` alone does not stop six blocks landing on
 * one statement. CHOSEN, recorded in docs/constants.md.
 */
export const ADVICE_MAX_PER_LINE = 3;

/**
 * Which reply shape the prompt asks for.
 *
 * `"json"` is one object carrying every block. Precise, easy to parse, and it
 * asks the model to hold balanced braces and escaped quotes around prose that
 * itself quotes source code.
 *
 * `"lines"` is a flat, delimited, line-oriented shape. Nothing to balance and
 * nothing to escape.
 *
 * WHY THIS EXISTS, and it is measured rather than anticipated. In a real
 * extension host on 2026-08-29, ONE PRESS against `qwen3-coder:30b` produced
 * both of these lines:
 *
 *     honesty judged by qwen3-coder:30b: 1 of 4 dimensions flagged
 *     model review got no answer (unreadable): the backend's answer was not JSON
 *
 * The same model, in the same press, answered a four-line numeric reply and
 * failed to produce parseable JSON carrying prose. That is a fact about the ASK,
 * not about the model's judgement, and it is why the shape is a parameter.
 *
 * THE READER ACCEPTS BOTH REGARDLESS of which one was asked for. A model that
 * ignores the instruction and answers in the other shape is answering, and
 * refusing it would spend a real review on formatting. The choice only decides
 * what the prompt REQUESTS.
 */
export type AdviceFormat = "json" | "lines";

/** The default the product asks for.
 *
 *  `json`, and the first answer here was WRONG. It was set to `lines` on the
 *  strength of one host press where `qwen3-coder:30b` failed to produce
 *  parseable JSON, and on a first matrix where `qwen3:8b` scored 76.9% on lines
 *  against 60.0% on json. Both readings were artefacts of THINKING MODE: with
 *  `think: false` the preference inverts and json wins on every model that fits
 *  this box.
 *
 *  Measured 2026-08-29, ten real functions, thinking off:
 *
 *    qwen3:8b     json 76.5%  lines 69.4%
 *    qwen3.5:9b   json 76.9%  lines 63.0%
 *    qwen3-coder  json 60.8%  lines 41.7%
 *
 *  `lines` keeps its place for two reasons and neither is capability: it is
 *  roughly twice as fast (1,405ms against 2,610ms on qwen3:8b), and it is the
 *  fallback for a model that genuinely cannot hold balanced braces around prose.
 *  The reader accepts both whichever is asked for. */
export const ADVICE_DEFAULT_FORMAT: AdviceFormat = "json";

/** The line format's own delimiters. Chosen to be things that do not occur at
 *  the start of a line of source in any of the five languages, so a block whose
 *  prose quotes code cannot close itself. */
const BLOCK_MARK = "@@block";
const ANCHOR_MARK = "@@anchor";
const DIM_MARK = "@@dimension";
const LINE_MARK = "@@line";
const TEXT_MARK = "@@text";
/** How a model says "nothing to say" in the line shape.
 *
 *  IT HAS TO BE EXPLICIT, and the alternative was measured to be ambiguous. The
 *  prompt used to say "write nothing at all if the function is good", and an
 *  empty reply is ALSO what a dead backend, a truncated round and a refusal look
 *  like. Read as clean, that turns an outage into a certificate of health, which
 *  is the exact defect the honesty judge's I5 exists to prevent. Read as a
 *  failure, a model that correctly found nothing is reported as broken.
 *
 *  An explicit token settles it, and it makes the two shapes agree: `@@none` is
 *  the line shape's `{"blocks":[]}`. Found by the phase 12 blind oracle, which
 *  noticed the two shapes disagreed about the same answer. */
const NONE_MARK = "@@none";

/**
 * The prompt.
 *
 * The rubric arrives as PROSE walked out of the scorer's own registry, so a
 * dimension added or renamed reaches the model without anyone remembering to
 * update a second list. That is the whole reason `rubricDimensions()` is
 * exported rather than a literal being written here.
 */
export function buildAdvicePrompt(
  fn: FunctionUnderReview,
  lang: CriticizeLang,
  evidence: AdviceEvidence,
  format: AdviceFormat = ADVICE_DEFAULT_FORMAT,
): string {
  const parts: string[] = [];
  parts.push(
    "You are reviewing one function and writing the review comments that go into the source file.",
    "",
    "A good function is honest about what it touches, asks its caller for as little as possible,",
    "states its contract, stays at one level of abstraction, and admits how it can fail.",
    "An honest function reads nothing and writes nothing the caller did not hand it.",
    "",
    "The dimensions this review is written against:",
  );
  for (const entry of rubricDimensions()) {
    parts.push(`- ${entry.dimension} (${entry.group}): ${entry.title}. ${entry.source}`);
  }

  parts.push("", `Language: ${lang.displayName}`, `Function: ${fn.name}`, "", "The function:");
  for (let i = 0; i < fn.lines.length; i++) {
    parts.push(`${fn.startLine + i}\t${fn.lines[i]}`);
  }

  const diagnostics = evidence.diagnostics ?? [];
  if (diagnostics.length > 0) {
    parts.push(
      "",
      "What the developer's own tools already say about this function.",
      "These are facts, not opinions: do not repeat them as findings, and do not contradict them.",
    );
    for (const d of diagnostics) {
      parts.push(`- line ${d.line} [${d.source}${d.code === "" ? "" : ` ${d.code}`}] ${d.severity}: ${d.message}`);
    }
  } else {
    parts.push("", "The developer's tools reported nothing about this function.");
  }

  const callees = evidence.callees ?? [];
  if (callees.length > 0) {
    parts.push("", "What this function calls, and what each callee publishes about itself:");
    for (const callee of callees) {
      const head = callee.signature.trim() === "" ? callee.name : callee.signature.trim();
      parts.push(callee.doc.trim() === "" ? `- ${head}` : `- ${head}\n    ${callee.doc.trim()}`);
    }
  }

  // THE RESOLVED FACTS GO LAST, immediately before the instructions, because
  // that is the position a model is least likely to skim past and these are the
  // lines that contradict its guesses.
  parts.push(...renderReach(evidence.reach ?? []));

  parts.push(
    "",
    `Write at most ${ADVICE_MAX_BLOCKS} comment blocks, and at most ${ADVICE_MAX_PER_LINE} above any one line.`,
    "Fewer is better. An empty answer is never correct: say so explicitly if the function is good.",
    "",
    "Rules:",
    "- Attack the code, never the author. No second person, no hedging, no questions.",
    "- Each block names what is wrong and what to do, in this function's own identifiers.",
    "- Do not repeat what the developer's tools already said. They can read those.",
    "- The resolved facts above are authoritative. Do not claim a call can fail, or that a name means",
    "  something, against what its declaration says.",
    "- `anchor` must be one line COPIED EXACTLY from the function above, without its line number.",
    "  The comment is planted directly above that line. Choose a distinctive line: an anchor that",
    "  appears twice in the function is discarded, and so is one that appears not at all.",
    "",
  );
  parts.push(...(format === "json" ? jsonTail() : linesTail()));
  return parts.join("\n");
}

/** The strict shape's instructions. */
function jsonTail(): string[] {
  return [
    "Answer with JSON and nothing else. No prose, no code fence:",
    '{"blocks":[{"dimension":"<one of the names above>","anchor":"<the exact line>","line":<its line number>,"text":"<the comment>"}]}',
    'If the function is good, answer with {"blocks":[]} rather than with an empty message.',
    "",
    "`anchor` decides where the comment goes. `line` is only consulted when the same text appears twice.",
  ];
}

/** The line shape's instructions. Nothing to balance, nothing to escape. */
function linesTail(): string[] {
  return [
    "Answer in exactly this shape and nothing else. No prose around it, no code fence.",
    "Repeat the four lines once per comment block:",
    "",
    `${BLOCK_MARK}`,
    `${ANCHOR_MARK} <one line copied exactly from the function above, without its line number>`,
    `${DIM_MARK} <one of the dimension names above>`,
    `${LINE_MARK} <the anchor's line number>`,
    `${TEXT_MARK} <the comment, on one line>`,
    "",
    `If the function is good, answer with exactly ${NONE_MARK} and nothing else. Do not answer with an empty message.`,
    "The anchor decides where the comment goes. The line number is only consulted when the same text",
    "appears twice in the function.",
  ];
}

/**
 * Read a reply into blocks. TOTAL: never throws, whatever it is handed.
 *
 * The fence comes off first. A model told not to fence still fences roughly
 * half the time (the v43 trap, measured on the CLI backend), and refusing the
 * reply over punctuation would spend a real answer on formatting.
 */
export function readAdviceReply(raw: unknown): AdviceRead {
  if (typeof raw !== "string") {
    return { ok: false, failure: { kind: "unreadable", detail: `the backend returned ${typeof raw}, not text` } };
  }
  const text = stripFence(raw.trim());
  if (text === "") {
    return { ok: false, failure: { kind: "unreadable", detail: "the backend returned an empty answer" } };
  }

  // THE LINE SHAPE FIRST, because its markers are unambiguous: no JSON reply
  // opens a line with `@@block`, and no line-shaped reply parses as JSON. A
  // model that was asked for one shape and answered in the other is still
  // answering, and refusing it would spend a real review on formatting.
  if (new RegExp(`^\\s*${BLOCK_MARK}\\b`, "m").test(text)) {
    return { ok: true, blocks: readLineShape(text) };
  }
  // AN EXPLICIT NOTHING IS AN ANSWER. It reads exactly as `{"blocks":[]}` does,
  // so the same verdict about the same function does not depend on which shape
  // the prompt asked for.
  if (new RegExp(`^\\s*${NONE_MARK}\\b`, "m").test(text)) {
    return { ok: true, blocks: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      failure: {
        kind: "unreadable",
        detail: `the backend's answer was neither JSON nor ${BLOCK_MARK} sections`,
      },
    };
  }
  // A BARE ARRAY IS THE BLOCKS ARRAY. The prompt asks for `{"blocks":[...]}` and
  // a model that answers `[...]` has given the same answer with one less layer,
  // not a different one. Measured 2026-08-29: this was the ONLY unreadable reply
  // `qwen3.8:27b-mlx` produced across ten functions, and refusing a whole round
  // over a missing wrapper is the same trade the fence strip already declines to
  // make.
  const parsedRaws = Array.isArray(parsed) ? parsed : (parsed as { blocks?: unknown })?.blocks;
  if (!Array.isArray(parsedRaws)) {
    return {
      ok: false,
      failure: { kind: "unreadable", detail: "the backend's answer carried no `blocks` array" },
    };
  }
  const raws = parsedRaws;

  const blocks: AdviceBlock[] = [];
  for (const entry of raws) {
    const dimension = stringField(entry, "dimension");
    const anchor = stringField(entry, "anchor");
    const body = stringField(entry, "text");
    const rawLine = (entry as Record<string, unknown> | null)?.["line"];
    const line = typeof rawLine === "number" && Number.isSafeInteger(rawLine) ? rawLine : undefined;
    // A block missing any of the three cannot be planted and is not a partial
    // finding: it is dropped, and the whole reply is NOT failed for it. One
    // malformed block in six is a model slip, not an outage.
    if (dimension !== undefined && anchor !== undefined && body !== undefined) {
      blocks.push(line === undefined ? { dimension, anchor, text: body } : { dimension, anchor, text: body, line });
    }
    if (blocks.length >= ADVICE_MAX_BLOCKS) {
      break;
    }
  }
  return { ok: true, blocks };
}

/**
 * The line shape, read leniently.
 *
 * LENIENT ON PURPOSE, and the leniency is bounded to things that cannot change
 * WHERE a comment lands. A missing `@@line` is fine because the line number is
 * only ever a tie-breaker; a missing `@@dimension` is not fatal because the
 * planner has a slug for a dimension it does not recognise; a missing `@@anchor`
 * or a missing `@@text` drops that block alone, because without either of them
 * there is nothing to plant or nowhere to plant it.
 *
 * A `@@text` may run over several lines: everything up to the next marker is
 * folded into one. A small model asked for "on one line" frequently wraps, and
 * discarding a good comment over a newline is the trade this shape exists to
 * avoid.
 */
function readLineShape(text: string): AdviceBlock[] {
  const blocks: AdviceBlock[] = [];
  let current: { anchor?: string; dimension?: string; line?: number; text?: string } | undefined;
  let inText = false;

  const flush = () => {
    if (current === undefined) {
      return;
    }
    const anchor = current.anchor?.trim();
    const body = current.text?.replace(/\s+/g, " ").trim();
    if (anchor !== undefined && anchor !== "" && body !== undefined && body !== "") {
      const dimension = current.dimension?.trim();
      blocks.push({
        dimension: dimension === undefined || dimension === "" ? "advice" : dimension,
        anchor,
        text: body,
        ...(current.line === undefined ? {} : { line: current.line }),
      });
    }
    current = undefined;
    inText = false;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed.startsWith(BLOCK_MARK)) {
      flush();
      current = {};
      continue;
    }
    if (current === undefined) {
      continue;
    }
    if (trimmed.startsWith(ANCHOR_MARK)) {
      current.anchor = trimmed.slice(ANCHOR_MARK.length).trim();
      inText = false;
      continue;
    }
    if (trimmed.startsWith(DIM_MARK)) {
      current.dimension = trimmed.slice(DIM_MARK.length).trim().toLowerCase();
      inText = false;
      continue;
    }
    if (trimmed.startsWith(LINE_MARK)) {
      const value = Number(trimmed.slice(LINE_MARK.length).trim());
      current.line = Number.isSafeInteger(value) ? value : undefined;
      inText = false;
      continue;
    }
    if (trimmed.startsWith(TEXT_MARK)) {
      current.text = trimmed.slice(TEXT_MARK.length).trim();
      inText = true;
      continue;
    }
    // A CONTINUATION, not a stray. Only while a `@@text` is open, so prose
    // before the first marker cannot be mistaken for a comment.
    if (inText && trimmed !== "") {
      current.text = `${current.text ?? ""} ${trimmed}`;
    }
  }
  flush();
  return blocks.slice(0, ADVICE_MAX_BLOCKS);
}

function stringField(entry: unknown, key: string): string | undefined {
  const value = (entry as Record<string, unknown> | null)?.[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** One outer fence pair, and no more.
 *
 *  The language class is spelled `[A-Za-z]` rather than `[a-z]` with the `i`
 *  flag, and that is not a style choice: a backtick immediately followed by
 *  `[a-z]` is exactly the shape the channel-tag hygiene row scans for as an
 *  EMITTED tag, so the lower-case spelling registered a phantom `[a-z]` channel
 *  tag and pushed the product's tag count over its bound. */
function stripFence(text: string): string {
  return text.replace(/^```[A-Za-z]*\n/, "").replace(/\n```\s*$/, "").trim();
}

/**
 * Place each block above the line it quotes. PURE.
 *
 * The comparison is on TRIMMED text, because a model re-typing a line almost
 * never reproduces the leading whitespace and the indentation is not the part
 * that identifies the line. Everything after the trim is exact: a model that
 * paraphrases the line does not get its block planted, which is the intended
 * pressure.
 */
export function placeAdvice(
  fn: FunctionUnderReview,
  blocks: readonly AdviceBlock[],
): { placed: readonly PlacedAdvice[]; unplaced: readonly UnplacedAdvice[] } {
  if (unitDefect(fn) !== undefined) {
    return { placed: [], unplaced: blocks.map((block) => ({ block, reason: "no line matches this anchor" })) };
  }

  // EVERY line of the slice is anchorable, doc comment included, because a
  // block about a wrong doc comment belongs above the doc comment. `bodyLines`
  // is the body only, so it is the wrong reader here; the finding-level guard
  // that a comment cannot CARRY a finding lives in the honesty judge, and this
  // path has no findings to guard.
  const byText = new Map<string, number[]>();
  for (let i = 0; i < fn.lines.length; i++) {
    const trimmed = fn.lines[i].trim();
    if (trimmed === "") {
      continue;
    }
    const at = byText.get(trimmed);
    const line = fn.startLine + i;
    if (at === undefined) {
      byText.set(trimmed, [line]);
    } else {
      at.push(line);
    }
  }

  const placed: PlacedAdvice[] = [];
  const unplaced: UnplacedAdvice[] = [];
  const taken = new Map<number, number>();
  for (const block of blocks) {
    const hits = byText.get(block.anchor.trim());
    if (hits === undefined || hits.length === 0) {
      unplaced.push({ block, reason: "no line matches this anchor" });
      continue;
    }
    // THE TIE-BREAK, and it can only ever CHOOSE AMONG lines whose text already
    // matched. A `line` pointing anywhere else is discarded rather than trusted,
    // so the number can never move a block onto code the anchor did not name.
    let line: number | undefined;
    if (hits.length === 1) {
      line = hits[0];
    } else if (block.line !== undefined && hits.includes(block.line)) {
      line = block.line;
    }
    if (line === undefined) {
      unplaced.push({ block, reason: "more than one line matches this anchor" });
      continue;
    }
    // TWO BLOCKS ON ONE LINE IS ONE COMMENT'S WORTH OF SPACE. The second is
    // dropped rather than stacked, for the reason v62 exists: comments that
    // SEVERAL BLOCKS MAY SHARE A LINE, up to `ADVICE_MAX_PER_LINE`. Each becomes
    // its own comment head above that line, which is what the rubric planner has
    // always done with several findings on one line.
    //
    // ITS OWN REASON WHEN THE BOUND IS REACHED, not the ambiguity one. A live run
    // once reported collisions on a THREE-LINE function as "more than one line
    // matches this anchor", which sent a reader hunting for duplicate lines in a
    // file that had none. A wrong reason on a dropped block is a false lead in
    // the one channel line that explains the drop.
    const already = taken.get(line) ?? 0;
    if (already >= ADVICE_MAX_PER_LINE) {
      unplaced.push({ block, reason: "this line already carries the most comments one line may take" });
      continue;
    }
    taken.set(line, already + 1);
    placed.push({ block, line, lineText: fn.lines[line - fn.startLine] });
  }
  // Ascending by line, and STABLE within a line so several comments above one
  // line keep the order the model wrote them in. `Array.prototype.sort` is
  // stable in every runtime this ships to, and the tie-break is written out
  // rather than relied upon so a reader does not have to know that.
  placed.sort((a, b) => a.line - b.line || placed.indexOf(a) - placed.indexOf(b));
  return { placed, unplaced };
}

/**
 * The whole round. NEVER THROWS, including on cancellation.
 *
 * A caller renders what came back; an empty `placed` with a populated
 * `unplaced` is a model that answered and missed, and it must not read the same
 * as a model that was never asked.
 */
export async function adviseFunction(
  transport: AdviceTransport,
  fn: FunctionUnderReview,
  lang: CriticizeLang,
  evidence: AdviceEvidence,
  format: AdviceFormat = ADVICE_DEFAULT_FORMAT,
): Promise<{ placed: readonly PlacedAdvice[]; unplaced: readonly UnplacedAdvice[]; failure?: AdviceFailure }> {
  const defect = unitDefect(fn);
  if (defect !== undefined) {
    return { placed: [], unplaced: [], failure: { kind: "unreadable", detail: defect } };
  }
  let raw: unknown;
  try {
    raw = await transport(buildAdvicePrompt(fn, lang, evidence, format));
  } catch (err) {
    return { placed: [], unplaced: [], failure: { kind: "transport", detail: detailOf(err) } };
  }
  const read = readAdviceReply(raw);
  if (!read.ok) {
    return { placed: [], unplaced: [], failure: read.failure };
  }
  return placeAdvice(fn, read.blocks);
}

/** One line of whatever was thrown, and never a stack: it reaches a channel a
 *  developer reads. */
function detailOf(err: unknown): string {
  if (err instanceof Error && err.message.trim() !== "") {
    return err.message.trim().split("\n")[0];
  }
  const text = String(err).trim();
  return text === "" ? "no detail" : text.split("\n")[0];
}
