/**
 * The fn-gen pipeline: assemble prompt, stream from the instruct model,
 * postprocess to a replacement function text. Pure of vscode; the command in
 * src/vscode/ resolves the span, calls this, and owns accept/reject.
 *
 * Deliberate differences from CompletionService: no cache and no debounce
 * (this is an explicit human gesture, not a keystroke storm), and failures
 * REJECT instead of degrading to undefined — a person who asked for a
 * generation needs the error, a person mid-keystroke does not.
 */

import { FnGenConfig } from "./config";
import { InstructGenerateFn, generateInstruct } from "./ollama";
import {
  ContextBlock,
  FnGenPromptInput,
  GenKind,
  SECTION_SEPARATOR,
  assembleFnGenPrompt,
  assembleTestGenPrompt,
  fnGenPromptShare,
  renderContextPrefix,
} from "./prompt";
import {
  PROMPT_TEMPLATE_TOK,
  PromptWindowError,
  arbitratePrompt,
  estimatePromptTok,
  estimateTextTok,
  promptRefusalChannelLine,
  promptShrinkChannelLine,
  splitInjectedUnits,
} from "./promptBudget";
import {
  extractRequestedFunction,
  extractTestFunctions,
  extractTestModule,
  postprocessInstructOutput,
  stripLeadingThink,
} from "./instructPostprocess";
import { FunctionSpan } from "./span";
import { LogFn } from "./completionService";
import { escapeBreaks } from "./errorBound";

export interface FnGenRequest {
  signature: string;
  docComment?: string;
  /** Ordered, user-selected; the service never adds blocks. Default []. */
  contextBlocks?: ContextBlock[];
  languageId?: string;
  /** Evidence only: logged, never used to touch text in this service. */
  span?: FunctionSpan;
  /** Raw model chunks in arrival order, for streamed previews. */
  onChunk?: (text: string) => void;
  /** The assembled prompt bytes, handed back before the model is called. A
   *  caller that must ask again ABOUT THIS SAME ATTEMPT (the punt circle-back)
   *  re-sends exactly these rather than re-assembling from remembered inputs,
   *  so the retry cannot silently lose the context blocks or the injected
   *  surface the first attempt had. */
  onPrompt?: (prompt: string) => void;
  /** Round-1 pre-fill: auto-injected surface for types named in the
   *  signature/doc. Forwarded to assembleFnGenPrompt; absent keeps the v1
   *  prompt bytes exactly. */
  injectedSurface?: string;
  /** The doc comment's own column, forwarded to assembleFnGenPrompt so the doc
   *  renders 0-based. A bodyOnly target passes "": a Python docstring is already
   *  0-based. Absent keeps the v1 prompt bytes. */
  spanIndent?: string;
  /** Punt mitigation: firm "no stubs" directive on the prompt. */
  noPunt?: boolean;
  /** Structure generation: the resolved symbol's kind, routing the prompt
   *  shape. Omitted or "function" keeps the v1 function bytes exactly. */
  kind?: GenKind;
  /** Python Fork A: generate only the body below a preserved docstring. Omitted
   *  keeps the full-definition prompt. */
  bodyOnly?: boolean;
  /** Same-file definition names the signature/doc references, forwarded to
   *  assembleFnGenPrompt so the model refers to them directly instead of
   *  inventing an import. Absent/empty keeps v1 bytes. */
  localSymbols?: string[];
  /** The comments the developer left at the target body's own depth, harvested
   *  by `harvestBodyComments`. Forwarded to assembleFnGenPrompt; absent or empty
   *  keeps the prompt bytes exactly. Deliberately absent from TestGenRequest:
   *  the test-authoring pass must never see a body-scoped comment. */
  scaffoldComments?: string[];
  /**
   * How `injectedSurface` shrinks, when the window arbitration needs it to.
   * `blocks` is how many droppable type blocks it carries; `keep(n)`
   * RE-RENDERS it with only the first n of them.
   *
   * A re-render rather than a slice, because dropping a type block also has to
   * narrow the payload's own "use only these types" instruction - a sentence
   * that named a block the shrink removed would point the model at a surface
   * that is no longer in the prompt.
   *
   * Absent: the service splits the surface itself (fence-aware, see
   * `splitInjectedUnits`). Every caller that CAN re-render should pass this.
   */
  injectedShrink?: { blocks: number; keep: (keep: number) => string | undefined };
}

/** Test-authoring request (sibling of FnGenRequest). Never carries a
 *  reference implementation — the pass is blind by construction. */
export interface TestGenRequest {
  signature: string;
  docComment?: string;
  calleeSurface?: string;
  languageId?: string;
  /** ADDED phase 6. The RESOLVED framework's assertion idiom, so the model
   *  writes the spelling this project's runner actually reads. Absent, or a
   *  `rust` languageId, keeps the frozen Rust instruction. */
  assertionInstruction?: string;
  /** ADDED phase 6 loop 2. The RESOLVED framework's reply SHAPE, for a framework
   *  whose shape is not its language's default (python/unittest). Absent falls
   *  back to the languageId default. */
  replyShape?: string;
  /** ADDED phase 6. The language's human name for the instruction's first line. */
  languageName?: string;
  /** Evidence only. */
  span?: FunctionSpan;
  onChunk?: (text: string) => void;
}

export interface FnGenResult {
  /** Postprocessed complete function definition; replaces the span. */
  text: string;
  /** The model that actually served the request. */
  model: string;
  ttftMs: number;
  totalMs: number;
}

/** Options for the pre-assembled-prompt path (repair rounds). The subset of
 *  FnGenRequest that still matters once the prompt bytes exist. */
export interface RawGenerateOptions {
  /** Doc comment sitting above the target span; a reply that re-types it is
   *  deduped exactly as in generate(), by the shared pipeline. */
  docComment?: string;
  /** The target function's signature. When present the reply is held to it:
   *  trimmed to the one requested function, rejected if the function is not
   *  in the reply at all. The same guard generate() applies. */
  signature?: string;
  /** Evidence only, as in FnGenRequest. */
  span?: FunctionSpan;
  /** The prompt asked for a BODY, not a whole definition, so the reply carries
   *  no declaration head and the head-anchored trim must not run on it. Repair
   *  and refine reach a Python docstring target this way; without the flag the
   *  trim refuses every obedient reply and the round dies with "generation does
   *  not contain the requested function". `generate()` has always passed it. */
  bodyOnly?: boolean;
  onChunk?: (text: string) => void;
  /** The blocks this pre-assembled prompt LEADS with, so a backend that caches
   *  a prefix reaches the same checkpoint a generation built. Repair, refine
   *  and TDD re-send the user's context by construction, so a repair after a
   *  generation should hit the warm checkpoint rather than pay to build a
   *  second one. Omitted means the prompt has no stable head; nothing is
   *  inferred from the prompt text itself. */
  contextBlocks?: readonly ContextBlock[];
}

/** Line terminators to LF. Only real terminators: a backslash-r escape inside a
 *  string literal is two characters and nothing here parses source. */
function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export class FnGenService {
  private inflight: AbortController | undefined;
  private disposed = false;

  // Injected generate fn keeps the pipeline testable headless.
  constructor(
    private readonly config: FnGenConfig,
    private readonly generateFn: InstructGenerateFn = generateInstruct,
    private readonly log?: LogFn,
    /** What the EVIDENCE should call the server, when that differs from the id
     *  the request carries. Only a backend that can decline to send the model
     *  id at all needs this: the Claude Code CLI picks its own model when none
     *  is passed, and reporting the untouched `fnGenModel` setting then names
     *  an ollama tag as the server of a round no ollama served. Defaults to the
     *  config's model, which is right for every backend that sends it. */
    private readonly modelLabel?: string,
  ) {}

  /** The model tag this service's requests actually carry. Evidence must
   *  name the server of a round, not whatever the base settings say - on
   *  tiers where applyTier swapped the model, the two differ, and on a backend
   *  that sends no model id at all the setting names nobody. */
  get modelTag(): string {
    return this.modelLabel ?? this.config.model;
  }

  /** The tier-resolved transport this service's rounds go through, for a
   *  gesture that is NOT a function generation and must not be postprocessed as
   *  one. `Column 80: Tighten Doc Comment` asks a model to POINT at spans of a
   *  comment, and `generate` would trim that reply to a function and reject it
   *  for not containing the one it asked for. Read-only: nothing may swap a
   *  service's transport after construction. */
  get transport(): InstructGenerateFn {
    return this.generateFn;
  }

  async generate(request: FnGenRequest, signal?: AbortSignal): Promise<FnGenResult | undefined> {
    const blocks = request.contextBlocks ?? [];
    const promptInput: FnGenPromptInput = {
      signature: request.signature,
      docComment: request.docComment,
      contextBlocks: blocks,
      languageId: request.languageId,
      spanIndent: request.spanIndent,
      injectedSurface: request.injectedSurface,
      noPunt: request.noPunt,
      kind: request.kind,
      bodyOnly: request.bodyOnly,
      localSymbols: request.localSymbols,
      scaffoldComments: request.scaffoldComments,
    };
    // THE WINDOW GUARD (roadmap item 43). Here and not in
    // the command, because this is the one place that turns a request into the
    // prompt string AND holds the transport's own `numCtx`/`maxTokens`: an
    // estimate taken anywhere else would be an estimate of a prompt somebody
    // else assembled. Throws a PromptWindowError rather than returning
    // undefined, because undefined already means "aborted" on this path and a
    // refusal owes the human a sentence.
    const prompt = assembleFnGenPrompt(this.fitToWindow(promptInput, request));
    return this.run(prompt, {
      docComment: request.docComment,
      signature: request.signature,
      span: request.span,
      onChunk: request.onChunk,
      blocksLabel: String(blocks.length),
      bodyOnly: request.bodyOnly,
      onPrompt: request.onPrompt,
      cachePrefix: renderContextPrefix(blocks),
    }, signal);
  }

  /**
   * The prompt-versus-window arbitration for ONE generation. Returns the prompt
   * input to assemble - unchanged when it fits, with a smaller injected surface
   * when only ours had to give - and THROWS when it does not fit even with zero
   * injection.
   *
   * THE RULE, ruled by the human: the developer's manually added context wins.
   * Ours shrinks; theirs never does. Past `num_ctx` ollama truncates the prompt
   * silently and eats the HEAD, which is our injected surface, so the current
   * behaviour already drops ours and keeps theirs - just invisibly, and after
   * the model has been handed the worse prompt.
   *
   * FRONTIER IS EXEMPT, and the signal is the transport's own: `numCtx` is
   * absent exactly when no `num_ctx` is sent (see `generateInstruct`, and the
   * cloud/Claude-Code service arms that drop it because it reaches nothing).
   * No local window means nothing to arbitrate: no estimate, no shrink, no
   * refusal, and the prompt is assembled exactly as it is today.
   */
  private fitToWindow(promptInput: FnGenPromptInput, request: FnGenRequest): FnGenPromptInput {
    const numCtx = this.config.numCtx;
    if (numCtx === undefined) {
      return promptInput;
    }
    const surface = request.injectedSurface;
    // The caller's own re-render when it has one; otherwise the fence-aware
    // split. Nothing is pre-summed: a size is only ever costed on a prompt that
    // is ALREADY too big, and the estimate now has to see the characters (a
    // length alone cannot tell a CJK identifier from an ASCII one - review D6).
    const units = request.injectedShrink === undefined ? splitInjectedUnits(surface) : [];
    const blockCount = request.injectedShrink?.blocks ?? units.length;
    const keepText = (keep: number): string | undefined =>
      request.injectedShrink !== undefined
        ? request.injectedShrink.keep(keep)
        : keep <= 0
          ? undefined
          : keep >= units.length
            ? surface
            : units.slice(0, keep).join(SECTION_SEPARATOR);
    const share = fnGenPromptShare(promptInput);
    const decision = arbitratePrompt({
      windowed: true,
      numCtx,
      maxTokens: this.config.maxTokens,
      // Each part rounds UP on its own, so the total can only over-state the
      // prompt. Over-estimating shrinks (at worst refuses) something that would
      // have fitted and SAYS SO; under-estimating lets the head-truncation
      // through in silence, which is the defect this exists to end.
      developerTok: estimatePromptTok(share.developerChars, share.developerNonAscii),
      // The chat template's own tokens are charged to `fixed`, because that is
      // what they are: bytes the gesture cannot do without and the developer
      // cannot remove. The prompt STRING does not contain them - the server's
      // Modelfile wraps this turn - so no character count can see them.
      fixedTok: estimatePromptTok(share.fixedChars, share.fixedNonAscii) + PROMPT_TEMPLATE_TOK,
      injectedBlocks: blockCount,
      injectedTokFor: (keep) =>
        keep >= blockCount
          ? estimatePromptTok(share.injectedChars, share.injectedNonAscii)
          : estimateTextTok(keepText(keep) ?? ""),
    });
    if (decision.verdict === "refuse") {
      this.log?.(promptRefusalChannelLine(decision));
      throw new PromptWindowError(decision);
    }
    if (decision.verdict === "shrink") {
      this.log?.(promptShrinkChannelLine(decision));
      return { ...promptInput, injectedSurface: keepText(decision.keptBlocks) };
    }
    return promptInput;
  }

  /**
   * Test-authoring: assemble the blind test prompt and stream it through the
   * SAME producer guards as generate(), but with the test-module shape guard
   * (extractTestModule) instead of the single-function one. A reply that is not
   * a `#[cfg(test)] mod tests` block is rejected exactly as a non-matching
   * function reply is. Blind by construction: the request cannot carry an impl.
   */
  async generateTests(request: TestGenRequest, signal?: AbortSignal): Promise<FnGenResult | undefined> {
    const prompt = assembleTestGenPrompt({
      signature: request.signature,
      docComment: request.docComment,
      calleeSurface: request.calleeSurface,
      languageId: request.languageId,
      assertionInstruction: request.assertionInstruction,
      replyShape: request.replyShape,
      languageName: request.languageName,
    });
    // Test-gen is one of the four ways into the model, and until now only one of
    // the four was guarded. Its ceiling is `testMaxTokens`, not `maxTokens` - a
    // test module is several times a function - so the window it has to fit is
    // measured against that, not against the generation's.
    this.refuseUnfittablePrompt(prompt, "", this.config.testMaxTokens ?? this.config.maxTokens);
    return this.run(prompt, {
      docComment: request.docComment,
      signature: request.signature,
      span: request.span,
      onChunk: request.onChunk,
      blocksLabel: "-",
      shape: "test-module",
      languageId: request.languageId,
    }, signal);
  }

  /**
   * THE WINDOW GUARD FOR A PROMPT THAT IS ALREADY A STRING (adversarial review
   * D1/D7). `generate()` arbitrates; this is what the other three ways into the
   * model get - the punt circle-back retry, repair, refine and test-gen all
   * arrive here with finished bytes.
   *
   * NOT A REPAIR CHANGE. goal.md excludes repair work, and that exclusion is
   * about changing how repair GENERATES. This changes nothing about the repair
   * prompt: it is the prompt-versus-window guard this phase exists to build,
   * applied at the seam every gesture shares, and repair reaches the model
   * through that seam like everything else.
   *
   * IT CANNOT SHRINK, AND REFUSING IS THE HONEST OUTCOME. A finished string
   * carries no part attribution: nothing here can tell the injected surface from
   * the instruction, so there is no "ours gives first" ladder to climb. The
   * alternative is to send it anyway and let ollama truncate the HEAD - which,
   * because the head is where the developer's context blocks are rendered, is
   * also the one outcome the human's asymmetry ruling forbids. The punt retry is
   * the sharpest case: its prompt is the original prompt PLUS the anti-punt
   * directive PLUS the stub (up to `maxTokens` of it), so it is strictly larger
   * than a prompt that just passed arbitration, and it was going out unchecked.
   *
   * `cachePrefix` is the rendered context blocks when the caller knows them, so
   * the refusal can still name the developer's share honestly. When it is absent
   * (or the prompt does not actually lead with it) everything is charged to
   * `fixed`, which never over-states what is theirs.
   */
  private refuseUnfittablePrompt(prompt: string, cachePrefix: string, maxTokens: number): void {
    const numCtx = this.config.numCtx;
    if (numCtx === undefined) {
      return; // frontier: no local window, nothing to arbitrate
    }
    const developerChars = cachePrefix.length > 0 && prompt.startsWith(cachePrefix) ? cachePrefix.length : 0;
    const decision = arbitratePrompt({
      windowed: true,
      numCtx,
      maxTokens,
      developerTok: estimateTextTok(prompt.slice(0, developerChars)),
      fixedTok: estimateTextTok(prompt.slice(developerChars)) + PROMPT_TEMPLATE_TOK,
      // No blocks to give up: this path has no attribution and so no shrink.
      injectedBlocks: 0,
      injectedTokFor: () => 0,
    });
    if (decision.verdict !== "refuse") {
      return;
    }
    this.log?.(promptRefusalChannelLine(decision));
    throw new PromptWindowError(decision);
  }

  /**
   * The repair seam: a pre-assembled prompt through the SAME pipeline as
   * generate() — same stream client, same done_reason/fence/empty producer
   * guards, same evidence lines. Only prompt assembly is bypassed, because
   * a repair prompt is diagnostics-shaped, not signature-shaped. Repaired
   * output is never special-cased into the document; callers splice it
   * through the same preview path as any generation.
   */
  async generateRaw(
    prompt: string,
    opts?: RawGenerateOptions,
    signal?: AbortSignal,
  ): Promise<FnGenResult | undefined> {
    const cachePrefix = renderContextPrefix(opts?.contextBlocks);
    // See refuseUnfittablePrompt: the punt retry, repair and refine all reach
    // the model through here, and every one of them was unguarded.
    this.refuseUnfittablePrompt(prompt, cachePrefix, this.config.maxTokens);
    return this.run(prompt, {
      docComment: opts?.docComment,
      signature: opts?.signature,
      span: opts?.span,
      bodyOnly: opts?.bodyOnly,
      onChunk: opts?.onChunk,
      // No context blocks exist on this path; "-" keeps the gen line format
      // stable while staying honest about the count not applying.
      blocksLabel: "-",
      cachePrefix,
    }, signal);
  }

  // The single pipeline both entry points share. Every producer guard lives
  // here exactly once, so a repair round cannot dodge one by construction.
  private async run(
    prompt: string,
    request: {
      docComment?: string;
      signature?: string;
      span?: FunctionSpan;
      onChunk?: (text: string) => void;
      blocksLabel: string;
      /** Which reply shape to hold the output to. Absent/"function" keeps the
       *  single-function guard (extractRequestedFunction). "test-module" swaps
       *  in the `#[cfg(test)] mod tests` guard (extractTestModule). */
      shape?: "function" | "test-module";
      /** ADDED phase 6. WHICH language's test shape, when shape is
       *  "test-module". "rust" and absent keep the frozen `#[cfg(test)] mod
       *  tests` guard; the other four hold the reply to bare test FUNCTIONS,
       *  because their tests go in a separate file whose wrapper the scaffold
       *  writes. */
      languageId?: string;
      /** The request asked for a BODY, so the reply carries no declaration head
       *  and the head-anchored trim cannot apply to it. */
      bodyOnly?: boolean;
      onPrompt?: (prompt: string) => void;
      /** Forwarded verbatim to the client. Empty means no stable head. */
      cachePrefix?: string;
    },
    signal?: AbortSignal,
  ): Promise<FnGenResult | undefined> {
    if (this.disposed) {
      return undefined;
    }
    if (signal?.aborted) {
      // A dead request is still an abort outcome; the evidence channel sees
      // every gesture, even one cancelled before the pipeline started.
      this.log?.("[fngen] aborted");
      return undefined;
    }

    // Newest wins, no join: a generate while another is in flight is the
    // regenerate gesture, so the older call is cancelled, never shared.
    this.inflight?.abort();
    const controller = new AbortController();
    this.inflight = controller;
    // One-way propagation: the caller's signal aborts the derived one;
    // nothing here ever aborts or otherwise touches the caller's signal.
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort);

    try {
      // Evidence before the model call: an aborted or failed round trip
      // still leaves a trace of what was asked.
      const spanLabel = request.span ? `${request.span.start}-${request.span.end}` : "-";
      this.log?.(
        `[fngen] gen model=${this.modelTag} promptBytes=${utf8ByteLength(prompt)} blocks=${request.blocksLabel} span=${spanLabel}`,
      );
      // The full assembled prompt, verbatim, when the debug setting is on. Both
      // generation and repair reach here, so one dump exposes what the model was
      // actually shown on either path — the injected surface included.
      if (this.config.logPrompts) {
        this.log?.(`[fngen] prompt-begin bytes=${utf8ByteLength(prompt)}\n${prompt}\n[fngen] prompt-end`);
      }
      request.onPrompt?.(prompt);

      // The test-authoring shape emits a whole `mod tests` block (~5 assert
      // lines), several times a single function's output; it gets its own
      // ceiling so a full module is not cut at done_reason=length. Any other
      // shape keeps the single-function budget. Falls back to maxTokens when
      // testMaxTokens is unset (older configs / injected test constructors).
      const maxTokens =
        request.shape === "test-module"
          ? this.config.testMaxTokens ?? this.config.maxTokens
          : this.config.maxTokens;

      let raw;
      try {
        raw = await this.generateFn({
          apiBase: this.config.apiBase,
          model: this.config.model,
          prompt,
          maxTokens,
          temperature: this.config.temperature,
          numGpu: this.config.numGpu,
          numCtx: this.config.numCtx,
          think: this.config.think,
          // Empty is not a head: an empty string would ask a caching backend to
          // split a prompt at byte 0, which is a fork that can never hit.
          ...(request.cachePrefix ? { cachePrefix: request.cachePrefix } : {}),
          signal: controller.signal,
          // The transport's own evidence sink, for the RAW server body on an
          // HTTP failure. The service's `[fngen] request failed:` line below
          // carries `String(err)`, which is bounded at 400 chars; this is the
          // unshortened copy the toast's channel pointer promises (roadmap
          // item 69). The local transport is the only one reached through this
          // field - the cloud clients take theirs at construction.
          log: this.log,
          // The abort guard belongs to the real client; an injected or
          // future generateFn may lack it, so the forwarding wrapper also
          // stops chunks once this request is cancelled.
          onChunk: request.onChunk
            ? (chunk) => {
                if (!controller.signal.aborted) {
                  request.onChunk!(chunk);
                }
              }
            : undefined,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          this.log?.("[fngen] aborted");
          return undefined;
        }
        // ESCAPED, and this is the only one of the six `[fngen] request failed`
        // lines that needs it. The other five interpolate a `msg` this file
        // authored; this one interpolates the transport's throw, whose tail is
        // the server's own body. `OutputChannel.appendLine` renders one row per
        // line break, so unescaped it lets a 500 body write its own channel
        // rows wearing this tag (scrap S58-2).
        //
        // The escape runs OUTSIDE the 400-char bound the transport already
        // applied, so a body of nothing but U+2028 renders about six times that
        // - roughly 2400 chars on one row, an order under CHANNEL_BODY_CHARS.
        // Re-bounding here would cut the message the toast shows.
        this.log?.(`[fngen] request failed: ${escapeBreaks(String(err))}`);
        throw err;
      }
      if (controller.signal.aborted) {
        this.log?.("[fngen] aborted");
        return undefined;
      }

      // Core is LF-canonical from here down. A model may answer in either
      // ending and this layer's guards all compare against "\n": the
      // doc-comment dedup, the fence-line scan, the function trim. Queue Q15:
      // a CRLF reply walked straight past the dedup because `next === "\n"` is
      // false for `\r`, and the doc comment was spliced twice. Normalising once
      // here is what lets every guard below stay written in LF, and the vscode
      // layer puts the DOCUMENT's own ending back at the write
      // (`withDocumentEol`), so nothing downstream has to remember.
      raw = { ...raw, text: normalizeEol(raw.text) };

      // Producer-side truncation is failure, never material to splice: a
      // body cut at num_predict looks like code but is not a complete
      // function, and the arithmetic boundary oracle cannot see that.
      if (raw.doneReason === "length") {
        // COUPLING: the vscode toast translation (fnGen.ts,
        // SERVICE_REJECT_TOASTS) matches this reject on the substring
        // "generation truncated at num_predict". Rewording past that marker
        // silently demotes the toast to the catch-all.
        const msg = `generation truncated at num_predict=${maxTokens} (done_reason=length)`;
        this.log?.(`[fngen] request failed: ${msg}`);
        throw new Error(msg);
      }

      let text: string;
      if (request.shape === "test-module") {
        // The test pass holds the reply to a `#[cfg(test)] mod tests` block,
        // taken from the RAW reply (minus a leading think block): the full
        // postprocess would strip the fence extractTestModule keys on, and its
        // doc-dedup / fence-line / function-trim guards are all single-function-
        // shaped. But the think guard IS shared (stripLeadingThink) so a
        // `<think>` block carrying a fenced example is never extracted as the
        // module. A reply that is a bare function (or prose) is rejected here —
        // the splice-where guarantee never constrains WHAT lands.
        const languageId = request.languageId ?? "rust";
        const extraction =
          languageId === "rust"
            ? extractTestModule(stripLeadingThink(raw.text))
            : extractTestFunctions(stripLeadingThink(raw.text), languageId);
        if (extraction === undefined) {
          // COUPLING: the vscode toast translation (fnGen.ts,
          // SERVICE_REJECT_TOASTS) matches these two variants on the
          // substrings "does not contain a test module" and "test functions
          // (no fenced block". Rewording past a marker silently demotes that
          // variant's toast to the catch-all.
          const msg =
            languageId === "rust"
              ? "generation does not contain a test module (no `#[cfg(test)] mod tests` block with a `#[test]` fn)"
              : `generation does not contain ${languageId} test functions (no fenced block with a test function in it)`;
          this.log?.(`[fngen] request failed: ${msg}`);
          throw new Error(msg);
        }
        this.log?.(`[fngen] test module extracted: tests=${extraction.testCount}`);
        text = extraction.text;
      } else {
        text = postprocessInstructOutput(raw.text);
        // The doc comment lives outside the span (the vscode layer excludes it
        // when resolving); a model that re-typed it would duplicate it on
        // splice. Anchored on a following newline (or end of text): a model
        // that EXTENDED the doc line did not re-type the comment, and
        // stripping would leave a junk fragment at the top of the span.
        // Dedup can legitimately leave "" — that flows into the empty-rejects
        // path below like any other empty generation.
        //
        // Both sides are LF here because core is LF-canonical (see the
        // normalisation at the top of this method). Queue Q15: this guard used
        // to compare a possibly-CRLF reply against a possibly-CRLF doc comment
        // taken off the document, and `next === "\n"` is false for `\r`, so a
        // CRLF reply re-typed the comment straight past the guard and the
        // splice carried it twice. The vscode layer puts the document's own
        // ending back at the write.
        const docComment = request.docComment && normalizeEol(request.docComment);
        if (docComment && text.startsWith(docComment)) {
          const next = text[docComment.length];
          if (next === undefined || next === "\n") {
            text = text.slice(docComment.length);
            if (text.startsWith("\n")) {
              text = text.slice(1);
            }
          }
        }

        // A fence line (backtick or tilde) surviving to here means markdown
        // structure would land in source code (an unclosed fence made
        // postprocess fall back to the whole remainder). Never splice it.
        // Trade accepted: a legitimate function body containing a fence line
        // is un-generatable.
        if (text.split("\n").some((line) => /^(```|~~~)/.test(line.trim()))) {
          // COUPLING: the vscode toast translation (fnGen.ts,
          // SERVICE_REJECT_TOASTS) matches this reject on the substring
          // "generation contains a code-fence line".
          const msg = "generation contains a code-fence line (unclosed or nested fence in the reply)";
          this.log?.(`[fngen] request failed: ${msg}`);
          throw new Error(msg);
        }

        // The splice guarantees WHERE bytes land, not WHAT they are: extra
        // top-level items in the reply (a `use` line above the fn, a helper
        // after it) would all land inside the function span. Hold the reply
        // to the requested signature: trim to the one function, reject when
        // the function is not in the reply at all. Trimmed imports the body
        // needed become compile errors the post-accept oracle surfaces.
        // Empty text skips through to the empty-rejects path below, keeping
        // its len=0 evidence line.
        //
        // A body-only request is exempt: the reply it ASKED for has no
        // declaration head, so the head-anchored trim rejects every obedient
        // one. The exemption keys on the request flag, never on the reply
        // shape - a head-less reply to a full-definition request is still the
        // defect the trim exists to catch.
        if (request.signature !== undefined && text.length > 0 && !request.bodyOnly) {
          const extraction = extractRequestedFunction(text, request.signature);
          if (extraction === undefined) {
            // COUPLING: the vscode toast translation (fnGen.ts,
            // SERVICE_REJECT_TOASTS) matches this reject on the substring
            // "generation does not contain the requested function".
            const msg = "generation does not contain the requested function (declaration head not in the reply)";
            this.log?.(`[fngen] request failed: ${msg}`);
            throw new Error(msg);
          }
          if (extraction.trimmedBefore > 0 || extraction.trimmedAfter > 0) {
            this.log?.(
              `[fngen] trimmed to the requested function: linesBefore=${extraction.trimmedBefore} linesAfter=${extraction.trimmedAfter}`,
            );
          }
          text = extraction.text;
        }
      }

      // Timings logged as integer ms; the resolved result carries the
      // client's measurements untouched.
      this.log?.(
        `[fngen] ttft=${Math.round(raw.ttftMs)}ms total=${Math.round(raw.totalMs)}ms len=${text.length}` +
          (text.length === 0 ? " (dropped: empty after postprocess)" : ""),
      );
      if (text.length === 0) {
        // The len=0 evidence line above says only "(dropped: ...)"; the
        // channel keeps every reject's throw string verbatim, this one
        // included (roadmap item 63).
        // COUPLING: the vscode toast translation (fnGen.ts,
        // SERVICE_REJECT_TOASTS) matches this reject on the substring
        // "generation was empty after postprocess".
        const msg = "generation was empty after postprocess";
        this.log?.(`[fngen] request failed: ${msg}`);
        throw new Error(msg);
      }

      return { text, model: this.modelTag, ttftMs: raw.ttftMs, totalMs: raw.totalMs };
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
      if (this.inflight === controller) {
        this.inflight = undefined;
      }
    }
  }

  /** Evidence hook for the vscode layer. "accept"/"reject" are the human's
   *  gesture; "discarded" is the system declining to apply (document
   *  changed, closed, or the editor refused the edit) — kept distinct so
   *  accept/reject stats stay honest.
   *
   *  A reject carries its why: which check refused and the first line of what
   *  the model offered. A bare `outcome=reject` made the one repair that
   *  mattered unanalyzable — whether the model answered wrong or the machinery
   *  wrongly refused was unknowable from the log (the capture is in
   *  docs/architecture/fn-generation.md, "The dark reject").
   *
   *  A DISCARD CARRIES ITS WHY TOO, for the same reason one class down. Five of
   *  the six discard causes are product prose, but the sixth interpolates the
   *  editor's own error and the toast that renders it is cut to one line. With
   *  no copy here, that cut was the end of the message: the log said
   *  `outcome=discarded` and the reader could not find out what the editor
   *  said. The reason line is what makes the toast's channel pointer a true
   *  promise. Escaped, because that sixth reason is not the product's text and
   *  this sink renders one row per break.
   *
   *  ON ITS OWN LINE, and that is not a layout choice. `outcome=discarded` is an
   *  evidence token readers match WHOLE - the surface contract's oracle asks
   *  whether that exact string is on the log, and treats it as saying neither
   *  what nor why by design, with the story required elsewhere.
   *  Suffixing the reason onto it turns every one of those matches into a miss
   *  and says the discard never happened. A reject's detail rides on the outcome
   *  line because it was there before any reader existed. */
  logOutcome(
    outcome: "accept" | "reject" | "discarded",
    detail?: { refusedBy: string; offered: string } | { discardedBecause: string },
  ): void {
    if (detail !== undefined && "discardedBecause" in detail) {
      this.log?.(`[fngen] discarded: ${escapeBreaks(detail.discardedBecause)}`);
      this.log?.(`[fngen] outcome=${outcome}`);
      return;
    }
    const suffix =
      detail === undefined
        ? ""
        : ` refused-by=${detail.refusedBy} offered=${firstOfferedLine(detail.offered)}`;
    this.log?.(`[fngen] outcome=${outcome}${suffix}`);
  }

  dispose(): void {
    this.disposed = true;
    this.inflight?.abort();
  }
}

// Byte length under UTF-8, dependency-free so the module stays portable
// between node tests and the extension bundle (no Buffer).
function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

// The offered text's first non-blank line, trimmed and capped, so the reject
// evidence stays one log line whatever the model returned.
function firstOfferedLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return line.length > 160 ? `${line.slice(0, 160)}...` : line;
}
