/**
 * The prompt-versus-window arbitration (session-v48 phase 2,
 * session-v48/contract-phase2.md; roadmap item 43).
 *
 * THE DEFECT THIS EXISTS FOR. `GEN_NUM_CTX` bounds the prompt AND the
 * generation together, and past it ollama silently truncates the prompt to fit,
 * eating the HEAD. `assembleFnGenPrompt` renders the developer's context blocks
 * first, so the head is the instruction and the product's own injected type
 * surface. A developer who adds two context files is therefore tipped over by
 * bytes that are not theirs, loses the injection they asked for through
 * `column80.injectedContext`, and still gets a confident answer from a bare
 * signature. Nothing anywhere said so.
 *
 * THE RULE, ruled by the human: the developer's manually added files win. Their
 * context shrinks nothing; ours shrinks to fit, down to and including zero
 * injected types. Where it does not fit even then, refuse - and say what the
 * total was and HOW MUCH OF IT WAS OURS, because a refusal that names only
 * their bytes blames them for ours.
 *
 * PURE and headless on purpose: the whole ladder (exempt / fits / shrink /
 * refuse) is drivable from the suite with no editor, no model and no config,
 * and the decision cannot quietly acquire a dependency on a global. The vscode
 * layer supplies the numbers, renders the surface at whatever size this module
 * chooses, and performs the refusal.
 */

import { SECTION_SEPARATOR } from "./prompt";

/**
 * ASCII characters per estimated token. A JUDGMENT CALL, not a measurement -
 * see docs/constants.md, row "PROMPT_ASCII_CHARS_PER_TOK".
 *
 * It was `4` (the convention `WalkBounds.TOK_MAX` uses for a RENDER budget) and
 * adversarial review D6 showed 4 under-estimates dense source, which is the one
 * direction this module's contract forbids. Prose runs near 4 chars/token on a
 * BPE vocabulary; source code does not - punctuation, indentation runs, snake
 * and camel identifiers split into several pieces each, and a fenced block is
 * mostly punctuation. 3 is the pessimistic end of that range.
 *
 * IT IS A PROXY AND IT IS SPELLED AS ONE everywhere it reaches a human: every
 * number derived from it is printed with "about" or "~". A real tokenizer is not
 * available here - the product does not ship one, and the backend's is not
 * reachable before the request. What WOULD settle it: ollama returns the real
 * `prompt_eval_count` on every response, so a session that logged (estimate,
 * prompt_eval_count) pairs over a corpus could calibrate this number instead of
 * reasoning about it. Nothing reads that field today.
 */
export const PROMPT_ASCII_CHARS_PER_TOK = 3;

/**
 * Tokens charged per NON-ASCII UTF-16 unit. A JUDGMENT CALL - see
 * docs/constants.md, row "PROMPT_NON_ASCII_TOK_PER_CHAR".
 *
 * `String.length` counts UTF-16 units, not bytes and not tokens. Adversarial
 * review D6 measured an ASCII, a CJK and an emoji prompt of the SAME 25355
 * UTF-16 units estimating identically at chars/4, while their UTF-8 sizes were
 * 25355 / 75355 / 100355 bytes. A BPE tokenizer of the Qwen class encodes CJK at
 * roughly one token per character, so the CJK prompt was a ~4x under-estimate.
 * Charging every non-ASCII unit a whole token covers that, and over-charges an
 * astral character (2 units, so 2 tokens) - which is the safe direction.
 */
export const PROMPT_NON_ASCII_TOK_PER_CHAR = 1;

/**
 * A flat allowance for the chat template and the model's own role/BOS
 * scaffolding, which the prompt string does not contain and the server adds.
 * A JUDGMENT CALL - see docs/constants.md, row "PROMPT_TEMPLATE_TOK".
 *
 * Nothing in this module can see the template: it lives in the model's
 * Modelfile. A Qwen-family chat template wraps one user turn in a handful of
 * special tokens plus a system preamble, which is tens of tokens, not hundreds.
 * 48 is that order of magnitude with room over it, and it is ~0.3% of the 14336
 * window, so it cannot be what refuses a real prompt.
 *
 * Charged by the CALLERS (`FnGenService`), not inside `arbitratePrompt`, which
 * stays a pure ladder over the numbers it is handed.
 */
export const PROMPT_TEMPLATE_TOK = 48;

/**
 * Characters to an estimated token count, ROUNDED UP.
 *
 * `nonAsciiChars` of the `chars` are charged a whole token each and the rest at
 * the ASCII rate. A caller that knows only a LENGTH passes 0 and every character
 * is charged at the ASCII rate, which is the cheaper of the two - so a caller
 * that can see the text should use `estimateTextTok` instead.
 *
 * WHICH WAY THIS ROUNDS AND WHY. Up, always, and each part is rounded
 * separately before they are summed, so the total can only ever come out at or
 * above the whole-string figure. The two failure directions are not symmetric:
 * over-estimating shrinks (or at worst refuses) a prompt that would have fitted
 * and the developer is TOLD, while under-estimating lets ollama truncate the
 * head in silence, which is the exact defect this module exists to end. So the
 * error is spent on the side that speaks.
 *
 * Total: a negative or non-finite input answers 0 rather than throwing, and a
 * non-ASCII count outside 0..chars is clamped rather than believed.
 */
export function estimatePromptTok(chars: number, nonAsciiChars = 0): number {
  if (!Number.isFinite(chars) || chars <= 0) {
    return 0;
  }
  const nonAscii = Number.isFinite(nonAsciiChars) ? Math.min(Math.max(0, nonAsciiChars), chars) : 0;
  return Math.ceil((chars - nonAscii) / PROMPT_ASCII_CHARS_PER_TOK) + nonAscii * PROMPT_NON_ASCII_TOK_PER_CHAR;
}

/** How many of a string's UTF-16 units are outside ASCII. The one place the
 *  ASCII test is spelled, so the estimate and anything that reports it cannot
 *  disagree about what "non-ASCII" means. */
export function countNonAsciiChars(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      n++;
    }
  }
  return n;
}

/** The estimate for a string whose bytes the caller actually holds. Always
 *  preferred over `estimatePromptTok(text.length)`: only this form can see the
 *  non-ASCII characters, and only it is conservative on a CJK prompt. */
export function estimateTextTok(text: string): number {
  return estimatePromptTok(text.length, countNonAsciiChars(text));
}

/**
 * The space a prompt may occupy for a LOCAL serving class: the context window
 * less the output ceiling the same window has to hold. At the shipped local
 * values that is 16384 - 2048 = 14336 tokens.
 */
export function availablePromptTok(numCtx: number, maxTokens: number): number {
  const room = (Number.isFinite(numCtx) ? numCtx : 0) - (Number.isFinite(maxTokens) ? maxTokens : 0);
  return room > 0 ? room : 0;
}

/** The three parts of the estimate, named apart because the arbitration and the
 *  message both need them apart. */
export interface PromptShare {
  /** The rendered context blocks. UNTOUCHABLE - the developer added them. */
  developerChars: number;
  /** The product's own injected type surface: pre-fill blocks, member lists and
   *  data-shape defs. The ONLY part that shrinks. */
  injectedChars: number;
  /** Everything else: instruction, signature, doc comment, scaffold comments,
   *  local-symbol line, section separators. Irreducible - the gesture is
   *  meaningless without it. */
  fixedChars: number;
}

export interface PromptArbitrationInput {
  /** Does a context window bind this request at all? FALSE for the frontier
   *  class: `numCtx` means nothing to a cloud transport, so the whole path is
   *  skipped - no estimate, no shrink, no refusal. */
  windowed: boolean;
  numCtx: number;
  maxTokens: number;
  developerTok: number;
  fixedTok: number;
  /** How many DROPPABLE injected type blocks the surface carries. */
  injectedBlocks: number;
  /**
   * The injected surface's estimated token cost when only the first `keep`
   * blocks are rendered, for any `keep` in 0..injectedBlocks.
   *
   * A FUNCTION rather than an array because the caller must RE-RENDER to answer
   * it (dropping a block also narrows the payload's own "only these types"
   * instruction), and the overwhelmingly common case fits at full size and must
   * never pay for a single one of those renders. It is asked at most
   * `injectedBlocks + 1` times, and only on a prompt that is already too big.
   */
  injectedTokFor: (keep: number) => number;
}

/** The numbers every non-exempt verdict carries, so the message and the channel
 *  line are built from ONE set of figures rather than two. */
export interface PromptArbitrationNumbers {
  availableTok: number;
  numCtx: number;
  maxTokens: number;
  /** developerTok + injectedTok + fixedTok, at the size actually chosen. */
  totalTok: number;
  developerTok: number;
  /** The injected share AS SENT: what survived the shrink, 0 at a refusal. */
  injectedTok: number;
  fixedTok: number;
}

export type PromptArbitration =
  /** Frontier: nothing was measured and nothing was decided. */
  | { verdict: "exempt" }
  /** It fits. The prompt is byte-identical to what it would have been. */
  | ({ verdict: "fits" } & PromptArbitrationNumbers)
  /** It fits once OUR injected surface gives ground. Theirs is untouched. */
  | ({
      verdict: "shrink";
      keptBlocks: number;
      droppedBlocks: number;
      /** The injected share before the shrink, so the line can say from what to what. */
      injectedTokBefore: number;
    } & PromptArbitrationNumbers)
  /** It does not fit with ZERO injection. No model call. */
  | ({
      verdict: "refuse";
      /** How many injected type blocks were given up before refusing. */
      droppedBlocks: number;
      /** What those blocks were worth. The honesty constraint: a refusal has to
       *  be able to say "we already dropped all of ours". */
      injectedTokDropped: number;
    } & PromptArbitrationNumbers);

/**
 * The whole ladder, in the contract's order:
 *   1. frontier -> exempt, decide nothing;
 *   2. it fits -> do nothing, the prompt is unchanged;
 *   3. otherwise drop injected blocks from the TAIL until it fits (the first
 *      block is the receiver, which is the type the body is certain to touch);
 *   4. still too big with zero injection -> refuse.
 */
export function arbitratePrompt(input: PromptArbitrationInput): PromptArbitration {
  if (!input.windowed) {
    return { verdict: "exempt" };
  }
  const availableTok = availablePromptTok(input.numCtx, input.maxTokens);
  const blocks = Number.isFinite(input.injectedBlocks) && input.injectedBlocks > 0 ? Math.trunc(input.injectedBlocks) : 0;
  const developerTok = Math.max(0, input.developerTok);
  const fixedTok = Math.max(0, input.fixedTok);
  // What the prompt costs before any injection at all. The floor a refusal is
  // decided against: it is exactly what step 4 tests.
  const base = developerTok + fixedTok;
  const full = Math.max(0, input.injectedTokFor(blocks));
  const nums = (injectedTok: number): PromptArbitrationNumbers => ({
    availableTok,
    numCtx: input.numCtx,
    maxTokens: input.maxTokens,
    totalTok: base + injectedTok,
    developerTok,
    injectedTok,
    fixedTok,
  });
  if (base + full <= availableTok) {
    return { verdict: "fits", ...nums(full) };
  }
  // Largest surviving prefix wins: the candidate order is meaning-ordered
  // (receiver first, then the span's own types), so the tail is the cheapest
  // thing to lose.
  for (let keep = blocks - 1; keep >= 0; keep--) {
    const tok = Math.max(0, input.injectedTokFor(keep));
    if (base + tok <= availableTok) {
      return {
        verdict: "shrink",
        keptBlocks: keep,
        droppedBlocks: blocks - keep,
        injectedTokBefore: full,
        ...nums(tok),
      };
    }
  }
  // `injectedTokFor(0)` rather than a hard 0: what the caller renders with no
  // type blocks left is the honest floor, and a caller whose zero-block surface
  // still costs something must not be reported as having given up everything.
  // On the generation path it is 0.
  const floor = blocks === 0 ? full : Math.max(0, input.injectedTokFor(0));
  return {
    verdict: "refuse",
    droppedBlocks: blocks,
    injectedTokDropped: Math.max(0, full - floor),
    ...nums(floor),
  };
}

/**
 * One injected surface's DROPPABLE UNITS, for a caller that has only the
 * finished string and cannot re-render it.
 *
 * The product's own generation path never comes here: `resolvePrefill` hands
 * the service a `keep(n)` that RE-RENDERS, because dropping a type block also
 * has to narrow the payload's "use only these types" instruction, and no string
 * surgery can do that. This is the honest fallback for every other caller, and
 * its one job is to cut only where a cut is safe.
 *
 * FENCE-AWARE, which is the whole reason this is not `surface.split("\n\n")`: a
 * data-shape block joins several struct defs with a blank line INSIDE its own
 * fence, so a naive split cuts a code fence in half and hands the model a
 * broken block. A blank line only ends a unit when no fence is open.
 */
export function splitInjectedUnits(surface: string | undefined): string[] {
  const text = surface ?? "";
  if (text === "") {
    return [];
  }
  const units: string[] = [];
  let buf: string[] = [];
  let fenceOpen = false;
  for (const line of text.split("\n")) {
    if (!fenceOpen && line.trim() === "") {
      if (buf.length > 0) {
        units.push(buf.join("\n"));
        buf = [];
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      fenceOpen = !fenceOpen;
    }
    buf.push(line);
  }
  if (buf.length > 0) {
    units.push(buf.join("\n"));
  }
  return units;
}

/** The units back into a surface. The same separator every assembler uses, so a
 *  kept prefix reads exactly as it did inside the full surface. */
export function joinInjectedUnits(units: readonly string[]): string | undefined {
  return units.length === 0 ? undefined : units.join(SECTION_SEPARATOR);
}

/**
 * The refusal, as the thing a caller catches. It carries the arbitration so the
 * UI layer can render the message (and the numbers) rather than re-deriving
 * them, and its `message` IS the user-visible sentence - a caller that only
 * knows how to show an error still shows the right one.
 */
export class PromptWindowError extends Error {
  readonly arbitration: Extract<PromptArbitration, { verdict: "refuse" }>;
  constructor(arbitration: Extract<PromptArbitration, { verdict: "refuse" }>) {
    super(promptRefusalMessage(arbitration));
    this.name = "PromptWindowError";
    this.arbitration = arbitration;
  }
}

/** Structural, never `instanceof`: the bundler can load two copies of this
 *  module (the extension host and a test bundle), and a prototype check across
 *  that seam answers false for a genuine refusal. */
export function isPromptWindowError(err: unknown): err is PromptWindowError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "PromptWindowError" &&
    typeof (err as { arbitration?: unknown }).arbitration === "object"
  );
}

/** The window clause both human-facing strings share, so the two can never
 *  quote different arithmetic. */
function windowClause(a: PromptArbitrationNumbers): string {
  return `about ${a.availableTok} available (a ${a.numCtx}-token window less the ${a.maxTokens} tokens reserved for the reply)`;
}

/**
 * What the developer can actually DO about this particular refusal, and nothing
 * they cannot (adversarial review D2).
 *
 * The message used to end "Remove a context block, or lower
 * `column80.injectedContext`" on every refusal. Measured on a real target, that
 * was three lies at once: it told a developer with NO context blocks to remove
 * one, told them to lower a setting already contributing zero, and quoted a
 * 34842-token total whose entire weight was the `fixed` share it never
 * mentioned. So the remedy is chosen by which share is actually over the line.
 *
 * The setting is still NAMED in every branch, because "raising or lowering this
 * will not help you here" is itself the thing a developer reaching for the dial
 * needs to read - a message that simply omitted it invites the wrong move.
 */
function refusalRemedy(a: Extract<PromptArbitration, { verdict: "refuse" }>): string {
  const dial =
    a.injectedTok > 0
      ? `Lowering \`column80.injectedContext\` would give back about ${a.injectedTok} more tokens.`
      : `Lowering \`column80.injectedContext\` will not help: Column 80's injected surface is already 0 tokens.`;
  if (a.fixedTok > a.availableTok) {
    // THEIR bytes are not the problem and removing them cannot fix it: even with
    // no context at all this prompt is over the window. Name what `fixed` is
    // made of, because those are things a developer can actually shorten.
    return (
      `The request itself is over the window before any context is added, so removing a context block will not ` +
      `help: shorten the doc comment or the commented-out body you sketched above the target, or split the target ` +
      `into smaller pieces. ${dial}`
    );
  }
  if (a.developerTok > 0) {
    return `Remove a context block - about ${a.developerTok} tokens of the total are yours. ${dial}`;
  }
  return `Shorten the doc comment or the commented-out body you sketched above the target. ${dial}`;
}

/**
 * The refusal, in the product's own voice, carrying the honest breakdown.
 *
 * ALL THREE SHARES, ALWAYS, INCLUDING `fixed` (adversarial review D2). A
 * breakdown that names two of three accounts for less than the total it quotes,
 * and the case where the missing one is the whole answer is REACHABLE: a target
 * whose body is a long commented-out block produced a 34842-token prompt with no
 * context blocks and no injection at all.
 *
 * THE INJECTED LINE IS NOT OPTIONAL. At refusal time our share is zero, and
 * saying so is the fact that makes refusing the developer's own files fair: we
 * gave up all of ours first. A message that quoted only the total and their
 * context would blame them for our bytes.
 */
export function promptRefusalMessage(a: Extract<PromptArbitration, { verdict: "refuse" }>): string {
  const gaveUp =
    a.injectedTokDropped > 0
      ? `about ${a.injectedTokDropped} tokens of it were dropped to make room before this refusal`
      : `there was none to drop`;
  return (
    `Column 80: this prompt does not fit the model's context window, so nothing was generated. ` +
    `The estimate is approximate: about ${a.totalTok} tokens against ${windowClause(a)}. ` +
    `Of that, your own added context blocks are about ${a.developerTok} tokens; Column 80's own ` +
    `injected type surface is ${a.injectedTok} tokens (${gaveUp}); and about ${a.fixedTok} tokens are the ` +
    `request itself - the signature, the doc comment, any body you sketched as comments, and the instruction. ` +
    refusalRemedy(a)
  );
}

/** The sentence that overrides the pre-fill's own "raise the stop" advice
 *  (adversarial review D5).
 *
 *  `resolvePrefill` logs its drop ledger BEFORE the service ever sees the
 *  prompt, and that line ends "Raise `column80.injectedContext` to fit more of
 *  them". When the window then shrinks or refuses, that is the exact wrong move:
 *  a bigger stop enlarges the only part the arbitration is cutting. The earlier
 *  line is already out on the channel and cannot be recalled, so the arbitration
 *  line says plainly that it is superseded. */
const DIAL_OVERRIDE =
  `Any "raise \`column80.injectedContext\`" advice logged earlier in this gesture is superseded: ` +
  `the context window is what bound here, and a larger stop is exactly what had to give.`;

/** The same numbers on the channel. Same register as the other `[fngen]` lines. */
export function promptRefusalChannelLine(a: Extract<PromptArbitration, { verdict: "refuse" }>): string {
  return (
    `[fngen] refused: estimated prompt ~${a.totalTok} tok exceeds the ~${a.availableTok} tok available ` +
    `(num_ctx ${a.numCtx} - ${a.maxTokens} reserved for the reply); developer context ~${a.developerTok} tok, ` +
    `injected surface ${a.injectedTok} tok (${a.droppedBlocks} type block(s), ~${a.injectedTokDropped} tok, ` +
    `dropped first), fixed ~${a.fixedTok} tok. No model call was made. ${DIAL_OVERRIDE}`
  );
}

/**
 * A shrink is VISIBLE. The developer asked for injection through their setting
 * and got less of it; a silent shrink is the same class of defect as the silent
 * truncation this module exists to prevent.
 */
export function promptShrinkChannelLine(a: Extract<PromptArbitration, { verdict: "shrink" }>): string {
  return (
    `[fngen] injected surface shrunk to fit the context window: kept ${a.keptBlocks} of ` +
    `${a.keptBlocks + a.droppedBlocks} type block(s), ~${a.injectedTokBefore} -> ~${a.injectedTok} tok; ` +
    `the developer's context blocks (~${a.developerTok} tok) were preserved. ` +
    `Estimated prompt ~${a.totalTok} tok against ~${a.availableTok} tok available ` +
    `(num_ctx ${a.numCtx} - ${a.maxTokens} reserved for the reply). ${DIAL_OVERRIDE}`
  );
}
