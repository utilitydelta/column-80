/**
 * The model-authored gesture, as a SECOND command.
 *
 * `Column 80: Review Function (model)` sits next to `Criticize Function` rather
 * than replacing it. A developer presses both on the same function and compares
 * what lands. That is deliberate and it is the human's instruction of
 * 2026-08-29: the fourteen detectors are the only baseline that can say whether
 * the model's comment blocks are better, and deleting them in the same stroke
 * that ships the replacement leaves a session with no number.
 *
 * WHAT IS SHARED WITH THE RUBRIC GESTURE, and it is nearly everything below the
 * model round: the function resolver, the scoring view, the injection region,
 * the strip pass, the presenter and its consent gate. A second answer to "which
 * function is the developer in" or "what did this product write" is the defect
 * class this codebase has paid for twice, so neither is written again here.
 *
 * WHAT IS NEW is the round in the middle. The model is handed the developer's
 * own diagnostics for this function, the function, the callees' signatures and
 * doc comments, and the rubric as prose, and it answers with comment blocks that
 * quote the line each belongs above.
 */

import * as vscode from "vscode";
import {
  AdviceEvidence,
  AdviceTransport,
  CalleeContract,
  PlacedAdvice,
  ToolDiagnostic,
  adviseFunction,
} from "../core/criticizeAdvise";
import { CriticizeWiring, buildFixContext } from "./criticize";
import { reachQueries } from "../core/criticizeReach";
import { resolveReach } from "./criticizeReachResolver";
import {
  ScoringView,
  critiqueLine,
  critiqueOutcomeLines,
  injectionRegion,
  scoringView,
  viewLineAtOrAfter,
  viewLineAtOrBefore,
} from "../core/criticizeGesture";
import { criticizeLangFor } from "../core/criticizeLang";
import { planAdviceInjection } from "../core/criticizePlan";
import { sliceFunction } from "../core/criticizeSlice";
import { isExplainCancellation } from "../core/criticizeExplain";
import { readFnGenConfig } from "./config";
import { InstructGenerateFn } from "../core/ollama";
import { ProposalOutcomeSink } from "./fnGen";

export const CRITICIZE_ADVISE_COMMAND_ID = "column80.reviewFunctionModel";

/** How many tokens the round may spend.
 *
 *  Larger than the honesty judge's 256 because this reply carries PROSE, six
 *  blocks of it, each quoting a line of source. RAISED from 2048 to 4096 after
 *  the first live run truncated a five-block Go answer mid-JSON: a cut-off reply
 *  is not a partial answer, it is an unreadable one, and the whole round is
 *  lost. CHOSEN, not measured, and recorded as chosen in docs/constants.md. */
const ADVISE_MAX_TOKENS = 4096;

/**
 * The diagnostics the developer's own tools already produced, for THIS function
 * only.
 *
 * READ OUT OF THE EDITOR rather than by running a checker. `cargo clippy` on a
 * cold crate is minutes and a gesture is not; the language server the developer
 * is already running has computed these and they cost nothing.
 *
 * `compilerOracle.ts` refuses this source by name, and that refusal is right for
 * the job it was written for: grading a function the product just generated,
 * where a stale diagnostic makes you accept broken code. This is a different
 * job. The diagnostics are EVIDENCE handed to a model about a function the
 * developer is looking at, the worst case is a sentence about a warning that has
 * since been fixed, and the alternative is no evidence at all.
 */
function diagnosticsFor(document: vscode.TextDocument, fromLine: number, toLine: number): ToolDiagnostic[] {
  const out: ToolDiagnostic[] = [];
  for (const d of vscode.languages.getDiagnostics(document.uri)) {
    const line = d.range.start.line + 1;
    if (line < fromLine || line > toLine) {
      continue;
    }
    out.push({
      line,
      severity: severityOf(d.severity),
      source: typeof d.source === "string" && d.source.trim() !== "" ? d.source.trim() : "the toolchain",
      code: codeOf(d.code),
      message: String(d.message ?? "").trim(),
    });
  }
  // By line, so the model reads them in the order it reads the function.
  return out.sort((a, b) => a.line - b.line);
}

function severityOf(severity: vscode.DiagnosticSeverity | undefined): ToolDiagnostic["severity"] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "information";
    default:
      return "hint";
  }
}

/** A diagnostic's rule id, which arrives as a string, a number or an object
 *  depending on the server. `clippy::ptr_arg` is the whole reason this is worth
 *  carrying: it tells the model which rule already fired so it does not spend a
 *  block repeating it. */
function codeOf(code: vscode.Diagnostic["code"]): string {
  if (typeof code === "string") {
    return code;
  }
  if (typeof code === "number") {
    return String(code);
  }
  const value = (code as { value?: string | number } | undefined)?.value;
  return value === undefined ? "" : String(value);
}

export function registerCriticizeAdvise(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  wiring: CriticizeWiring,
): void {
  const log = (line: string) => output.appendLine(line);
  context.subscriptions.push(
    vscode.commands.registerCommand(CRITICIZE_ADVISE_COMMAND_ID, async () => {
      try {
        await runAdvise(log, wiring);
      } catch (err) {
        if (isExplainCancellation(err) || isCancellation(err)) {
          log(critiqueLine("cancelled"));
          return;
        }
        log(critiqueLine(`model review failed: ${String(err)}`));
        void vscode.window.showWarningMessage(
          `Column 80: the model review failed (${firstLine(String(err))}); nothing was changed. The full message is in the output channel.`,
        );
      }
    }),
  );
}

function isCancellation(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  return name === "AbortError" || name === "Canceled" || name === "CancellationError";
}

function firstLine(text: string): string {
  return String(text).split("\n")[0];
}

async function runAdvise(
  log: (line: string) => void,
  wiring: CriticizeWiring,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showWarningMessage("Column 80: open a file and put the cursor in a function first.");
    return;
  }
  const document = editor.document;
  const lang = criticizeLangFor(document.languageId);
  if (lang === undefined) {
    log(critiqueLine(`model review does not support ${document.languageId}`));
    void vscode.window.showWarningMessage(`Column 80: the model review does not support ${document.languageId}.`);
    return;
  }

  const versionAtResolve = document.version;
  const resolved = await wiring.resolveFunction(document, editor.selection.active);
  if (resolved === undefined) {
    log(critiqueLine("no function under the cursor"));
    void vscode.window.showWarningMessage("Column 80: put the cursor inside a function first.");
    return;
  }

  // THE SAME VIEW THE RUBRIC SCORES. The document with this product's own
  // comments taken out, so a second press reviews the code and not the last
  // review of it.
  const view = scoringView(document.getText().split(/\r?\n/), document.languageId);
  const headLine = document.positionAt(resolved.headOffset).line + 1;
  const endLine = document.positionAt(resolved.span.end).line + 1;
  const unit = sliceFunction(
    view.lines,
    viewLineAtOrAfter(view, headLine),
    viewLineAtOrBefore(view, endLine),
    resolved.symbolName,
    lang,
  );
  if (unit === undefined) {
    log(critiqueLine(`could not slice ${resolved.symbolName}`));
    void vscode.window.showWarningMessage("Column 80: that function could not be read.");
    return;
  }

  const gate = await wiring.tierGate();
  if (!gate.allowed) {
    const why = wiring.tierMessage() ?? "the hardware tier disables model calls";
    log(critiqueLine(`model review skipped: tier ${gate.reason}: ${why}`));
    void vscode.window.showWarningMessage(`Column 80: the model review needs a model (${why}).`);
    return;
  }

  const diagnostics = diagnosticsFor(document, headLine, endLine);
  const context = await buildFixContext(document, resolved, unit, lang, wiring, log);
  const callees: CalleeContract[] = (context.callees ?? []).map((callee) => ({
    name: callee.name,
    signature: callee.signature ?? "",
    doc: callee.doc,
  }));
  // THE RESOLVED FACTS. Best effort like every other leg: a server that will not
  // answer costs the prompt a block and costs the round nothing.
  let reach;
  try {
    reach = await resolveReach(document, reachQueries(unit, lang), { from: headLine, to: endLine }, lang, log);
  } catch (err) {
    if (isExplainCancellation(err) || isCancellation(err)) {
      throw err;
    }
    log(critiqueLine(`reach not resolved, so the model gets no declaration facts: ${firstLine(String(err))}`));
    reach = [];
  }
  const resolvedOutside = reach.filter((f) => f.where !== "this-function" && f.where !== "unresolved").length;

  const evidence: AdviceEvidence = { diagnostics, callees, reach };
  log(
    critiqueLine(
      `model review context: ${diagnostics.length} diagnostic(s) from the developer's tools, ` +
        `${callees.length} callee contract(s), ${resolvedOutside} of ${reach.length} name(s) resolved outside this function`,
    ),
  );

  const config = readFnGenConfig();
  let generate: InstructGenerateFn;
  try {
    generate = wiring.transport();
  } catch (err) {
    if (isExplainCancellation(err) || isCancellation(err)) {
      throw err;
    }
    log(critiqueLine(`model review has no backend: ${firstLine(String(err))}`));
    void vscode.window.showWarningMessage("Column 80: the model review could not reach a model.");
    return;
  }

  const controller = new AbortController();
  const claim = wiring.inFlight?.()?.begin("Reviewing a function", controller);
  const transport: AdviceTransport = async (prompt: string) => {
    const result = await generate({
      apiBase: config.apiBase,
      model: config.model,
      prompt,
      maxTokens: ADVISE_MAX_TOKENS,
      temperature: 0,
      numGpu: config.numGpu,
      numCtx: config.numCtx,
      // THINKING OFF, EXPLICITLY, AND AGAINST THE CONFIGURED VALUE. Measured on
      // this box 2026-08-29, `qwen3:8b` over ten real functions:
      //
      //   thinking on:   11,279ms median, 1 unreadable reply, 20 blocks placed
      //   thinking off:   1,405ms median, 0 unreadable replies, 25 blocks placed
      //
      // An eight-fold latency difference, and the only unreadable replies in the
      // whole matrix came from the thinking runs. The reason is structural
      // rather than incidental: a reasoning model spends its OUTPUT budget
      // thinking before it answers, and this round's budget is sized for six
      // blocks of prose, so the thinking eats the answer. The ask here is
      // structured extraction over evidence the prompt already carries, not a
      // problem that wants working out.
      //
      // The configured value still governs every other gesture; this overrides
      // it for this round alone.
      think: false,
      signal: controller.signal,
      log,
    });
    return result.text;
  };

  let outcome;
  try {
    outcome = await adviseFunction(transport, unit, lang, evidence);
  } finally {
    claim?.release();
  }

  // THREE OUTCOMES AND THEY MUST NOT READ ALIKE. A round that never reached a
  // model, a round that answered and found nothing, and a round that answered
  // and whose every block missed its anchor are three different events, and the
  // v62 release spent a whole cycle with "explained 0 of 2" standing for all
  // three.
  if (outcome.failure !== undefined) {
    log(critiqueLine(`model review got no answer (${outcome.failure.kind}): ${outcome.failure.detail}`));
    void vscode.window.showWarningMessage("Column 80: the model review got no usable answer; nothing was changed.");
    return;
  }
  for (const miss of outcome.unplaced) {
    log(critiqueLine(`block dropped, ${miss.reason}: ${JSON.stringify(miss.block.anchor)}`));
  }
  if (outcome.placed.length === 0) {
    log(
      critiqueLine(
        outcome.unplaced.length === 0
          ? `the model found nothing to say about ${resolved.symbolName}`
          : `the model wrote ${outcome.unplaced.length} block(s) and not one of them named a line in this function`,
      ),
    );
    void vscode.window.showInformationMessage(
      outcome.unplaced.length === 0
        ? `Column 80: the model had nothing to say about ${resolved.symbolName}.`
        : `Column 80: the model's review did not match this function's lines; nothing was changed.`,
    );
    return;
  }

  // THE DOC BLOCK'S FIRST LINE, as a document offset, so the region reaches back
  // over it. `unit.startLine` is a VIEW line (this product's own comments already
  // stripped), so it goes back through the view's map before it is an offset.
  const docStartLine = view.documentLine[unit.startLine - 1];
  const reachBackTo =
    typeof docStartLine === "number" && docStartLine >= 1
      ? document.offsetAt(new vscode.Position(docStartLine - 1, 0))
      : undefined;

  await proposeAdvice(document, resolved, view, outcome.placed, versionAtResolve, wiring, log, reachBackTo);
}

/** The proposal, through the SAME region, strip pass and presenter the rubric
 *  gesture uses. */
async function proposeAdvice(
  document: vscode.TextDocument,
  resolved: { headOffset: number; span: { end: number }; symbolName: string },
  view: ScoringView,
  placed: readonly PlacedAdvice[],
  versionAtResolve: number,
  wiring: CriticizeWiring,
  log: (line: string) => void,
  // The doc block's first line. Absent leaves the region where the rubric path
  // puts it, at the declaration head.
  reachBackTo?: number,
): Promise<void> {
  const region = injectionRegion(
    document.getText(),
    resolved.headOffset,
    resolved.span.end,
    document.languageId,
    reachBackTo,
  );
  const plan = planAdviceInjection(
    region.lines,
    viewLineAtOrAfter(view, region.startLine),
    document.languageId,
    placed.map((entry) => ({ line: entry.line, dimension: entry.block.dimension, text: entry.block.text })),
  );
  // WHAT THE REGION COULD NOT TAKE, NAMED. A block anchored on the function's
  // doc comment resolves to a real line of the slice and then falls one line
  // above the writable region, because the slicer walks up over the doc block
  // and `injectionRegion` starts at the declaration head. It used to vanish
  // between the two with no `unplaced` entry and no channel line.
  for (const line of plan.outsideRegion) {
    log(
      critiqueLine(
        `block dropped, its line (${line}) is above the region this gesture may write to; a comment about the doc block cannot be planted above the doc block`,
      ),
    );
  }
  if (plan.planted === 0 && plan.stripped === 0) {
    log(
      critiqueLine(
        plan.outsideRegion.length === 0
          ? "nothing to propose"
          : `nothing to propose: all ${plan.outsideRegion.length} block(s) landed outside the writable region`,
      ),
    );
    void vscode.window.showInformationMessage(
      plan.outsideRegion.length === 0
        ? `Column 80: the model had nothing to plant on ${resolved.symbolName}.`
        : `Column 80: the model's review was all about ${resolved.symbolName}'s doc comment, which this gesture cannot write above; nothing was changed.`,
    );
    return;
  }
  log(critiqueLine(`model review offers ${plan.planted} comment(s), ${plan.stripped} stale one(s) stripped`));

  let accepted = false;
  const outcomes: ProposalOutcomeSink = {
    logOutcome: (outcome, detail) => {
      accepted = accepted || outcome === "accept";
      // THE SHARED RENDERER, not a template. `detail` is an OBJECT with two
      // different shapes, so interpolating it wrote `outcome=reject: [object
      // Object]` onto a channel a human reads. Caught in the real host, because
      // the stub tier never asserted on the outcome line's text.
      for (const line of critiqueOutcomeLines(outcome, detail)) {
        log(line);
      }
    },
  };
  try {
    await wiring.presenter().present({
      document,
      span: { start: region.start, end: region.end },
      versionAtResolve,
      title: `Column 80: model review of ${resolved.symbolName}`,
      text: plan.text,
      service: outcomes,
      discardNoun: "review",
      onSystemDiscard: (why: string) => log(critiqueLine(`model review discarded before it was shown: ${why}`)),
    });
  } catch (err) {
    if (isCancellation(err)) {
      throw err;
    }
    log(critiqueLine(`the model review proposal failed: ${String(err)}`));
    void vscode.window.showWarningMessage(
      accepted
        ? `Column 80: the review comments landed, but the gesture failed afterwards (${firstLine(String(err))}).`
        : `Column 80: the review could not be proposed (${firstLine(String(err))}); nothing was changed.`,
    );
  }
}
