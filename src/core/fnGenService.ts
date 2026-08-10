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
  GenKind,
  assembleFnGenPrompt,
  assembleTestGenPrompt,
  renderContextPrefix,
} from "./prompt";
import {
  extractRequestedFunction,
  extractTestFunctions,
  extractTestModule,
  postprocessInstructOutput,
  stripLeadingThink,
} from "./instructPostprocess";
import { FunctionSpan } from "./span";
import { LogFn } from "./completionService";

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

  async generate(request: FnGenRequest, signal?: AbortSignal): Promise<FnGenResult | undefined> {
    const blocks = request.contextBlocks ?? [];
    const prompt = assembleFnGenPrompt({
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
    });
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
    return this.run(prompt, {
      docComment: opts?.docComment,
      signature: opts?.signature,
      span: opts?.span,
      bodyOnly: opts?.bodyOnly,
      onChunk: opts?.onChunk,
      // No context blocks exist on this path; "-" keeps the gen line format
      // stable while staying honest about the count not applying.
      blocksLabel: "-",
      cachePrefix: renderContextPrefix(opts?.contextBlocks),
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
        this.log?.(`[fngen] request failed: ${String(err)}`);
        throw err;
      }
      if (controller.signal.aborted) {
        this.log?.("[fngen] aborted");
        return undefined;
      }

      // Producer-side truncation is failure, never material to splice: a
      // body cut at num_predict looks like code but is not a complete
      // function, and the arithmetic boundary oracle cannot see that.
      if (raw.doneReason === "length") {
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
        if (request.docComment && text.startsWith(request.docComment)) {
          const next = text[request.docComment.length];
          if (next === undefined || next === "\n") {
            text = text.slice(request.docComment.length);
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
        throw new Error("generation was empty after postprocess");
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
   *  wrongly refused was unknowable from the log
   *  (session-v27/capture-csharp-linq.md, defect 2). */
  logOutcome(
    outcome: "accept" | "reject" | "discarded",
    rejectDetail?: { refusedBy: string; offered: string },
  ): void {
    const detail =
      rejectDetail === undefined
        ? ""
        : ` refused-by=${rejectDetail.refusedBy} offered=${firstOfferedLine(rejectDetail.offered)}`;
    this.log?.(`[fngen] outcome=${outcome}${detail}`);
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
