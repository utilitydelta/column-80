/**
 * The Criticize gesture: one command, fifteen dimensions, five languages, and
 * nothing written.
 *
 * ONE GESTURE. The plurality lives inside the pipeline rather than in the
 * palette. There is no "criticize file", no "criticize workspace", and no
 * second entry for the student against the professional: the scorecard is two
 * reading depths of one output, so the student reads the whole rubric and the
 * professional reads the elevated rows and the blast radius, and both read the
 * same artefact. Two artefacts would drift.
 *
 * IT WRITES NOTHING. This module never touches the document, never reaches the
 * extension's one consent gate, and adds no write path, so the three-write-path
 * invariant is untouched by construction rather than by discipline. The names
 * every write in this extension goes through are absent from this file, and
 * `test/impl-v61-p5-gesture.test.cjs` pins their absence rather than trying to
 * provoke every branch in a host. It publishes no diagnostics either: the
 * Problems panel belongs to the compiler, and this extension publishes none.
 *
 * WHAT THE MODEL IS AND IS NOT ALLOWED TO DO. The detectors decide what the
 * findings are. The model's only job is to explain one finding a detector
 * already produced, and `ExplainAuthorization` makes that structural rather
 * than conventional. Session-v60 measured a prose critique at GATE 0/3 on
 * unchanged bytes, and the v61 scout proved every stability mechanism is one
 * dial whose currency is recall: the arm that scored a perfect 3/3 did it by
 * returning nothing on all three functions. So the unstable component is moved
 * off the load-bearing path instead of being fought on it.
 *
 * THE ORDER OF OPERATIONS IS THE CONTRACT. No editor, unregistered language
 * (refused BY NAMING the language), no function at the cursor, score, blast
 * radius best-effort, explain best-effort behind the tier gate, render. Steps
 * four and seven are the product; five and six are enrichment, and every one of
 * their failure modes degrades to a COMPLETE card rather than to an error.
 */

import * as vscode from "vscode";

import { InstructGenerateFn } from "../core/ollama";
import {
  ExplainAuthorization,
  ExplainTransport,
  attachExplanations,
  explainFinding,
  findingKey,
} from "../core/criticizeExplain";
import { blastRadius } from "../core/criticizeBlast";
import { criticizeLangFor } from "../core/criticizeLang";
import {
  CANCELLED_LINE,
  NO_EDITOR_REASON,
  NO_EDITOR_TOAST,
  NO_FUNCTION_REASON,
  NO_FUNCTION_TOAST,
  blastLine,
  criticizeToast,
  critiqueLine,
  explainableRows,
  explainerSkippedLine,
  refusalLine,
  scoringLine,
  sliceRefusalReason,
  staleCardLine,
  staleEvidenceLine,
  summariseCard,
  summaryLine,
  unregisteredLanguageReason,
  unregisteredLanguageToast,
  wantsBlastRadius,
} from "../core/criticizeGesture";
import { renderScorecard } from "../core/criticizeRender";
import { blastRadiusFor, DEFAULT_ELEVATION, ElevationPolicy, ScorecardRow, signatureLevel } from "../core/criticizeScore";
import { sliceFunction } from "../core/criticizeSlice";
import { scoreFunction } from "../core/criticizeScore";
import { DetectorFinding } from "../core/criticizeTypes";

import { makeResolveCallers, prepareCallRoot } from "./callHierarchy";
import { readFnGenConfig } from "./config";
import { ResolvedFunction, resolveFunctionAtCursor } from "./fnGen";
import { InFlightRegistry, isCancellation } from "./inFlight";
import { callRootPosition } from "./oracleSurface";
import { firstLine } from "./toastText";

export const CRITICIZE_COMMAND_ID = "column80.criticizeFunction";

/**
 * How many tokens one explanation may cost. CHOSEN, not measured.
 *
 * The explainer is handed ONE finding and asked for a short paragraph about the
 * principle behind it, and `criticizeExplain` drops prose that runs past its own
 * line cap anyway. This bound exists so a model that ignores the format cannot
 * spend a minute per row before the drop.
 */
const EXPLAIN_MAX_TOKENS = 384;

/**
 * Everything the gesture reaches the world through.
 *
 * Shaped like `TightenWiring` and for the same reason: the decisions are
 * testable without a host only if the host arrives through a record. The tier
 * gate and the transport are GETTERS, read at invoke time, so a settings change
 * that rebuilds the service is followed here rather than pinned at activation.
 */
export interface CriticizeWiring {
  resolveFunction: typeof resolveFunctionAtCursor;
  /** The SAME tier gate every model-call gesture consults, FAIL CLOSED and
   *  consulted BEFORE the transport is touched. A closed gate here is not a
   *  failure: the card is already complete without a word of prose. */
  tierGate: () => Promise<{ allowed: boolean; reason?: string }>;
  /** The disabled tier's recorded reason, for the channel line to name. */
  tierMessage: () => string | undefined;
  /** The tier-resolved transport, the same one fn-gen's rounds go through. */
  transport: () => InstructGenerateFn;
  /** What is running, and how a user stops it. A getter for the same TDZ reason
   *  `TightenWiring.inFlight` is one. */
  inFlight?: () => InFlightRegistry | undefined;
  /** The elevation policy. Defaulted, and a parameter because a human ruling on
   *  a held dimension must move one value rather than a build. */
  policy?: ElevationPolicy;
}

/**
 * The command.
 *
 * MANUAL, and wired to no keystroke. Scoring is pure and costs no round trip,
 * but the blast radius is a call-hierarchy walk and the explainer is one model
 * round per elevated row, and neither belongs anywhere near a keystroke. This
 * is a gesture a developer asks for, like `tightenDocComment`.
 */
export function registerCriticize(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  wiring: CriticizeWiring,
): void {
  const log = (line: string) => output.appendLine(line);
  context.subscriptions.push(
    vscode.commands.registerCommand(CRITICIZE_COMMAND_ID, async () => {
      try {
        await runCriticize(output, log, wiring);
      } catch (err) {
        // The user's own cancel ends the gesture and says nothing. Everything
        // else is a bug rather than a refusal, and it still wrote nothing,
        // because this gesture has no write path to leave half-done.
        if (isCancellation(err)) {
          log(CANCELLED_LINE);
          return;
        }
        log(`${critiqueLine(`failed: ${String(err)}`)}`);
        void vscode.window.showWarningMessage(
          `Column 80: the criticize gesture failed (${firstLine(String(err))}); nothing was changed. The full message is in the output channel.`,
        );
      }
    }),
  );
}

/** The order of operations, and every refusal in it. */
async function runCriticize(
  output: vscode.OutputChannel,
  log: (line: string) => void,
  wiring: CriticizeWiring,
): Promise<void> {
  // 1. No active editor.
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    log(refusalLine(NO_EDITOR_REASON));
    void vscode.window.showWarningMessage(NO_EDITOR_TOAST);
    return;
  }
  const document = editor.document;

  // 2. Unregistered language, refused BY NAMING the language. This is checked
  //    before the symbol provider is asked anything: resolving a function in a
  //    language with no rubric tables would spend a round trip to reach a card
  //    of fifteen blind rows.
  const lang = criticizeLangFor(document.languageId);
  if (lang === undefined) {
    log(refusalLine(unregisteredLanguageReason(document.languageId)));
    void vscode.window.showWarningMessage(unregisteredLanguageToast(document.languageId));
    return;
  }

  // 3. No function at the cursor. NEVER SCORE THE FILE: the rubric is about one
  //    function, and a file-level card would be the "criticize file" gesture the
  //    one-gesture rule refuses.
  const resolved = await wiring.resolveFunction(document, editor.selection.active);
  if (resolved === undefined) {
    log(refusalLine(NO_FUNCTION_REASON));
    void vscode.window.showWarningMessage(NO_FUNCTION_TOAST);
    return;
  }

  const documentLines = document.getText().split(/\r?\n/);
  // THE SPAN THE PRODUCT RESOLVES BEGINS AT THE DECLARATION HEAD, AND THE
  // DETECTOR SLICE MUST NOT. `sliceFunction` walks UPWARD from the head over
  // contiguous doc and annotation lines, so the doc comment is inside the unit.
  // Handing it `span.start` and letting it walk is the whole fix: measured on
  // the graded set, a slice that begins at the declaration head reads 29% of
  // documented Rust functions as undocumented, and dimensions 9 and 10 both go
  // silently and permanently wrong. This session's rig hit that twice.
  const headLine = document.positionAt(resolved.span.start).line + 1;
  const endLine = document.positionAt(resolved.span.end).line + 1;
  const unit = sliceFunction(documentLines, headLine, endLine, resolved.symbolName, lang);
  if (unit === undefined) {
    log(refusalLine(sliceRefusalReason(resolved.symbolName)));
    void vscode.window.showWarningMessage(NO_FUNCTION_TOAST);
    return;
  }

  // The version the card is scored FROM. Steps 5 and 6 take real time, and a
  // developer who types in between leaves every line number on the card
  // pointing at bytes that moved. The card is not discarded for that, because
  // it is still a true reading of what it read; what it must not do is present
  // itself as a reading of the file as it now stands.
  const scoredAtVersion = document.version;

  // 4. Score. Every dimension, always, and no model and no network are involved.
  //    This is the product; everything after it is enrichment.
  const policy = wiring.policy ?? DEFAULT_ELEVATION;
  const card = scoreFunction(unit, lang, policy);
  log(scoringLine(card.name, document.languageId, card.headLine));
  const summary = summariseCard(card, policy);
  log(summaryLine(summary));

  // 5. Blast radius, BEST EFFORT. Undefined stays undefined all the way to the
  //    text: "0 call sites" is a claim the walk never made.
  const rows = await withBlastRadius(document, resolved, card.rows, policy, log);

  // 6. Explain, BEST EFFORT and GATED. The gate is consulted before the
  //    transport is touched.
  const explained = await withExplanations(rows, wiring, log);

  // 7. Render, and reveal.
  output.appendLine("");
  if (document.version !== scoredAtVersion) {
    log(staleEvidenceLine(scoredAtVersion, document.version));
    output.appendLine(staleCardLine(card.name));
    output.appendLine("");
  }
  output.appendLine(renderScorecard({ ...card, rows: explained }, policy));
  output.show(true);
  void vscode.window.showInformationMessage(criticizeToast(card.name, summary));
}

/**
 * Attaches a call-site count to the elevated signature-level rows, when the
 * caller walk produced one.
 *
 * ONE WALK, not one per row. Every signature-level dimension on one function
 * has the same callers, so the number is a property of the function rather than
 * of the dimension, and asking the server once per row would spend the same
 * request several times over for one answer.
 *
 * A walk that is cancelled, bounded out, or unavailable leaves `blastRadius`
 * undefined on every row, and the renderer emits no line at all for it.
 */
async function withBlastRadius(
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
  rows: readonly ScorecardRow[],
  policy: ElevationPolicy,
  log: (line: string) => void,
): Promise<readonly ScorecardRow[]> {
  const card = { name: resolved.symbolName, languageId: document.languageId, headLine: 0, rows };
  if (!wantsBlastRadius(card, policy)) {
    log(critiqueLine("blast radius not walked: no elevated dimension has a fix that changes the signature"));
    return rows;
  }
  // THE SHARED NORMALISATION, not a second one. `callRootPosition` is what both
  // existing gestures use to answer "which function is the developer in", and
  // a second answer to that question is exactly the defect session-v60
  // measured: one press of Run Covering Tests and one press of Repair Function
  // discovered two different functions' tests for one cursor.
  const at = callRootPosition(document, resolved);
  const target = await prepareCallRoot(document, at, log);
  const outcome = await blastRadius({
    target,
    resolveCallers: makeResolveCallers(log),
    log,
  });
  if (outcome.callSites === undefined) {
    log(critiqueLine(outcome.note));
    return rows;
  }
  const count = outcome.callSites;
  // ONE LINE FOR ONE NUMBER. The walk is per function, not per dimension, so
  // every flagged signature-level row would print the same count. Nine copies
  // of one measurement read as nine measurements.
  const first = rows.find(
    (row) => row.outcome.state === "flagged" && signatureLevel(row.dimension),
  );
  if (first !== undefined) {
    log(blastLine(first.dimension, count));
  }
  // THE HELPER DECIDES, not a second copy of its rule here. `blastRadiusFor`
  // is what the core card already uses; re-deriving the predicate at the facade
  // is how the two answers drift apart.
  return rows.map((row) => {
    const radius = blastRadiusFor({ dimension: row.dimension, callSites: count });
    return radius === undefined ? row : { ...row, blastRadius: radius };
  });
}

/**
 * Attaches prose to elevated rows, or says why it did not.
 *
 * THE GATE IS CONSULTED BEFORE THE TRANSPORT IS TOUCHED, and it fails closed:
 * the same consult generate, repair, tighten and TDD make. A disabled service
 * is inert everywhere, and "inert" here means the card renders complete from
 * the detectors while the channel names the cause.
 *
 * The prose is keyed by `findingKey` and handed to `attachExplanations`, which
 * iterates the ROWS rather than the map. An entry whose key matches no row is
 * unreachable, so a model that invents a finding cannot get it onto a card.
 */
async function withExplanations(
  rows: readonly ScorecardRow[],
  wiring: CriticizeWiring,
  log: (line: string) => void,
): Promise<readonly ScorecardRow[]> {
  const card = { name: "", languageId: "", headLine: 0, rows };
  const targets = explainableRows(card, wiring.policy ?? DEFAULT_ELEVATION);
  if (targets.length === 0) {
    log(explainerSkippedLine("no row is above the evidence bar, so there is nothing to explain"));
    return rows;
  }

  const gate = await wiring.tierGate();
  if (!gate.allowed) {
    const why =
      gate.reason === "tier-unresolved"
        ? "the hardware tier could not be resolved"
        : (wiring.tierMessage() ?? "the hardware tier disables function generation");
    // A CLOSED GATE IS NOT A FAILURE. No toast, no warning: the card the
    // developer asked for is complete and about to be shown to them, and the
    // only thing missing is prose they were never promised.
    log(explainerSkippedLine(`tier ${gate.reason}: ${why}`));
    return rows;
  }

  const config = readFnGenConfig();
  const controller = new AbortController();
  const claim = wiring.inFlight?.()?.begin("Explaining a critique", controller);
  const transport: ExplainTransport = async (prompt: string) => {
    const result = await wiring.transport()({
      apiBase: config.apiBase,
      model: config.model,
      prompt,
      maxTokens: EXPLAIN_MAX_TOKENS,
      temperature: 0,
      numGpu: config.numGpu,
      numCtx: config.numCtx,
      think: config.think,
      signal: controller.signal,
      log,
    });
    return result.text;
  };

  const prose = new Map<string, string>();
  try {
    for (const row of targets) {
      if (row.outcome.state !== "flagged") {
        continue;
      }
      const finding: DetectorFinding | undefined = row.outcome.findings[0];
      if (finding === undefined) {
        continue;
      }
      // The ONLY construction site of an authorization in the vscode layer, and
      // it starts from a finding the detectors produced. Grep for the type to
      // find every one of them, the way `TestRepairAuthorization` is found.
      const auth: ExplainAuthorization = { finding, source: row.source };
      try {
        const text = await explainFinding(auth, transport);
        if (text.trim() !== "") {
          prose.set(findingKey(finding), text);
        }
      } catch (err) {
        if (isCancellation(err)) {
          throw err;
        }
        // One row's round failing is not the explainer failing. That row keeps
        // its evidence line, which is what it would have had anyway.
        log(explainerSkippedLine(`${row.dimension}: ${firstLine(String(err))}`));
      }
    }
  } finally {
    claim?.release();
  }
  log(critiqueLine(`explained ${prose.size} of ${targets.length} elevated row(s)`));
  return attachExplanations(rows, prose);
}
