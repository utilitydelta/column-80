/**
 * The Criticize gesture: one command, fourteen dimensions, five languages, and a
 * diff the human answers.
 *
 * ONE GESTURE. The plurality lives inside the pipeline rather than in the
 * palette. There is no "criticize file", no "criticize workspace", and no
 * second entry for the student against the professional: the scorecard is two
 * reading depths of one output, so the student reads the whole rubric and the
 * professional reads the elevated rows and the blast radius, and both read the
 * same artefact. Two artefacts would drift.
 *
 * IT PROPOSES, AND THE HUMAN ANSWERS. Session-v61 shipped this gesture writing
 * nothing, and the human read the result and said "it's useless as it is now":
 * a fourteen-row panel is knowledge a developer has to re-enter by hand, and a
 * rubric that knows the line number can put the criticism ON the line. So step 9
 * plans a comment for every elevated finding and offers the function back as a
 * diff. Accept and the comments land; reject and nothing was ever written.
 *
 * THE WRITE IS `ProposalPresenter.present()` AND NOTHING ELSE. That is the
 * extension's ONE consent gate and ONE document write, which fn-gen and repair
 * already go through, so criticize is its THIRD CALLER rather than a fourth
 * write path and the invariant survives by construction rather than by
 * discipline. Every other name a write in this extension can go through is
 * still absent from this file - deliberately not listed here, because the pin
 * that enforces it is a substring search over this very source, and a doc
 * comment naming them would defeat it. `test/impl-v61-p5-gesture.test.cjs` holds
 * the list, and pins the absence rather than trying to provoke every branch in a
 * host. The presenter arrives through the wiring
 * record and is never constructed here: a second one would keep a second preview
 * registry, and `column80.proposalAccept` would settle the wrong diff. It
 * publishes no diagnostics either: the Problems panel belongs to the compiler,
 * and this extension publishes none.
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
 * (refused BY NAMING the language), no function at the cursor, BUILD THE SCORING
 * VIEW, score, blast radius best-effort, explain best-effort behind the tier
 * gate, WRITE THE FIX SENTENCE best-effort behind the same gate, render,
 * propose.
 *
 * THE RUBRIC SCORES THE COMMENT-FREE DOCUMENT, and that is the newest step. A
 * second press was scoring the criticism the first press planted: a documented
 * Rust function read as undocumented, an undocumented Go function read as
 * documented, and every comment below a planted one drifted down the body
 * (S62-7). So the slice, the score and the plan all read the same stripped
 * lines, and `ScoringView.documentLine` is the map that puts the card's numbers
 * back on the file the human is looking at. Measured at 3.8ms on a
 * 20,000-line file, once per press, against a call-hierarchy walk in the same
 * gesture.
 * The card is the product and the proposal is built FROM it; every enrichment
 * failure degrades to a COMPLETE card rather than to an error, and a card with
 * nothing above the bar proposes nothing at all rather than opening an empty
 * diff.
 */

import * as vscode from "vscode";

import { InstructGenerateFn } from "../core/ollama";
import {
  ExplainAuthorization,
  ExplainFailure,
  ExplainTransport,
  attachExplanations,
  explainFinding,
  findingKey,
  isExplainCancellation,
} from "../core/criticizeExplain";
import { blastRadius } from "../core/criticizeBlast";
import {
  FIX_CALLEE_CAP,
  FIX_CALL_SITE_CAP,
  FIX_SHIPPED_ARM,
  FixContext,
  FixFailure,
  admissibleFix,
  buildFixPrompt,
} from "../core/criticizeFix";
import { CriticizeLang, criticizeLangFor, signatureParts } from "../core/criticizeLang";
import { orderFor } from "../core/criticizeVoice";
import {
  CANCELLED_LINE,
  NO_EDITOR_REASON,
  NO_EDITOR_TOAST,
  NO_FUNCTION_REASON,
  NO_FUNCTION_TOAST,
  NO_PROPOSAL_LINE,
  blastLine,
  cardInDocumentLines,
  criticizeToast,
  critiqueLine,
  critiqueOutcomeLines,
  explainableRows,
  explainedLine,
  explainerSkippedLine,
  honestyBlindLine,
  honestyJudgedLine,
  fixContextLine,
  fixRefusedLine,
  fixSkippedLine,
  fixUnreachableLine,
  fixedLine,
  hasProposal,
  injectingDimensions,
  injectionRegion,
  proposalOfferedLine,
  proposalTitle,
  refusalLine,
  ScoringView,
  scoringLine,
  scoringView,
  sliceRefusalReason,
  staleCardLine,
  staleEvidenceLine,
  summariseCard,
  summaryLine,
  unregisteredLanguageReason,
  unregisteredLanguageToast,
  viewLineAtOrAfter,
  viewLineAtOrBefore,
  wantsBlastRadius,
} from "../core/criticizeGesture";
import { planInjection } from "../core/criticizePlan";
import { renderScorecard } from "../core/criticizeRender";
import { blastRadiusFor, DEFAULT_ELEVATION, ElevationPolicy, Scorecard, ScorecardRow, signatureLevel } from "../core/criticizeScore";
import { DimensionOutcome } from "../core/criticizeTypes";
import { sliceFunction } from "../core/criticizeSlice";
import {
  HONESTY_DIMENSIONS,
  HonestyDimension,
  HonestyTransport,
  judgeHonesty,
} from "../core/criticizeHonestyModel";
import { applyHonesty, scoreFunction } from "../core/criticizeScore";
import { DetectorFinding } from "../core/criticizeTypes";

import { calleeDocs, callSiteLines, makeResolveCallers, prepareCallRoot } from "./callHierarchy";
import { readFnGenConfig } from "./config";
import {
  ProposalOutcomeSink,
  ProposalPresenter,
  ResolvedFunction,
  resolveFunctionAtCursor,
} from "./fnGen";
// A TYPE-ONLY edge, so the wiring record can name the resolve's exact shape
// without this module taking a second runtime import of it. `tightenDocComment`
// reaches the same function the same way, for the same reason.
import type { resolvePrefill } from "./fnGen";
import type { SurfaceExtractor } from "../core/extraction";
import type { FunctionUnderReview } from "../core/criticizeTypes";
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
 * How many tokens one fix sentence may cost. CHOSEN, not measured.
 *
 * The gate bounds the answer at 160 characters, which is about forty tokens, so
 * this is four times what a kept sentence needs. The slack is for a model that
 * thinks out loud before it answers: a reasoning model spends `num_predict`
 * BEFORE the sentence arrives, and a cap sized to the sentence would truncate
 * every one of them mid-thought and refuse the lot.
 */
const FIX_MAX_TOKENS = 192;

/**
 * How long the type-shape resolve may take before the prompt goes without it.
 * CHOSEN, not measured.
 *
 * `resolvePrefill` drives up to eight cross-file walks against a language
 * server, and this gesture is manual with no deadline, so the bound is generous
 * rather than tight. What it exists to stop is the OTHER failure: a server that
 * never answers at all leaves the whole gesture hanging, after the card was
 * already computed and before the human ever sees it.
 */
const FIX_TYPE_SHAPE_MS = 8000;

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
  /** THE consent gate, and the only way this module reaches a document. A
   *  GETTER because it arrives on the same record the transport and the tier
   *  gate do, and it is HANDED OVER rather than constructed: a second
   *  `ProposalPresenter` would keep a second preview registry, and the one
   *  `column80.proposalAccept` command would settle the wrong tab's diff. */
  presenter: () => ProposalPresenter;
  /** What is running, and how a user stops it. A getter for the same TDZ reason
   *  `TightenWiring.inFlight` is one. */
  inFlight?: () => InFlightRegistry | undefined;
  /** The elevation policy. Defaulted, and a parameter because a human ruling on
   *  a held dimension must move one value rather than a build. */
  policy?: ElevationPolicy;
  /** The type-shape resolve, and it is the SAME one repair and tighten drive:
   *  `shard: u64` is on the signature already, and what decides whether "make
   *  them newtypes" is advice or nonsense is whether `Budget` is a struct with
   *  three fields or a newtype over `u64`.
   *
   *  OPTIONAL, LIKE EVERY BLOCK IN THE CONTEXT. A wiring that omits it drops one
   *  block from the prompt and nothing else: the fix round still runs, the card
   *  is still complete, and the comment still carries a sentence. */
  resolvePrefill?: typeof resolvePrefill;
  /** The registered extractor for a language, or nothing when injection is off
   *  or the language has no resolver. Paired with `resolvePrefill` because
   *  `resolvePrefill` answers `undefined` immediately without one. */
  extractorFor?: (languageId: string) => SurfaceExtractor | undefined;
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
        // else is a bug rather than a refusal, and the toast below may say
        // "nothing was changed" because the ONE path that can change a document
        // catches its own failures: `proposeInjection` never rethrows, so an
        // error that reaches here happened before any preview was ever opened.
        // The sentence is true by construction rather than by hope: a product
        // that says "nothing was written" while something was written is a
        // worse defect than the failure it is reporting.
        //
        // BOTH SPELLINGS OF A CANCEL, for the same reason the explainer pass
        // takes both: `inFlight.isCancellation` sees only an `Error` named
        // `AbortError`, and the enrichment steps below run vscode providers
        // that cancel under the names `Canceled` and `CancellationError`. With
        // the narrow check alone, a developer pressing escape got
        // `[critique] failed: Canceled: user cancelled` on the channel and a
        // toast telling them the gesture had failed.
        if (isExplainCancellation(err) || isCancellation(err)) {
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
  //    of fourteen blind rows.
  const lang = criticizeLangFor(document.languageId);
  if (lang === undefined) {
    log(refusalLine(unregisteredLanguageReason(document.languageId)));
    void vscode.window.showWarningMessage(unregisteredLanguageToast(document.languageId));
    return;
  }

  // THE STALENESS ANCHOR, CAPTURED BEFORE THE SYMBOL-PROVIDER AWAIT, the way
  // `src/vscode/fnGen.ts` captures its own and for the same reason.
  // `resolved.headOffset` and `resolved.span.end` are offsets into the text the
  // PROVIDER saw, so a keystroke landing during resolution moves the bytes they
  // point at while leaving the numbers alone. Read after the await, this would
  // be the version the buffer has AFTER that keystroke - the one number
  // `present()`'s guard blesses - and the proposal would splice text computed
  // from offsets into a file that no longer exists. The reviewer reproduced it:
  // five characters deleted above the function put the head-line comment inside
  // `pub fn`, and the card on screen was correct throughout, so nothing warned.
  //
  // It is also the version the CARD is scored from. Steps 5 and 6 take real
  // time, and a developer who types in between leaves every line number on the
  // card pointing at bytes that moved. The card is not discarded for that,
  // because it is still a true reading of what it read; what it must not do is
  // present itself as a reading of the file as it now stands. Capturing here
  // rather than below the await is what lets the stale notice cover the
  // resolution window too, which it could not before.
  const scoredAtVersion = document.version;

  // 3. No function at the cursor. NEVER SCORE THE FILE: the rubric is about one
  //    function, and a file-level card would be the "criticize file" gesture the
  //    one-gesture rule refuses.
  const resolved = await wiring.resolveFunction(document, editor.selection.active);
  if (resolved === undefined) {
    log(refusalLine(NO_FUNCTION_REASON));
    void vscode.window.showWarningMessage(NO_FUNCTION_TOAST);
    return;
  }

  // THE RUBRIC READS THE COMMENT-FREE DOCUMENT. Every line below is in the
  // SCORING VIEW, which is this file with the comments a previous accept
  // planted taken back out, and `view.documentLine` is the map home. Scoring the
  // document as it stands made the second press wrong three ways (S62-7): a
  // documented Rust function read as undocumented because a planted `// C80`
  // block sits between the `///` and the head, an undocumented Go function read
  // as documented because `//` IS Go's doc prefix, and `section-comment` fired
  // on this product's own comment. On a FIRST press the view is the document and
  // the map is the identity, which is why nothing about the first press moves.
  const view = scoringView(document.getText().split(/\r?\n/), document.languageId);
  // THE SLICE STARTS AT THE DECLARATION HEAD, AND `span.start` IS NOT ALWAYS IT.
  // `sliceFunction` walks UPWARD from the head over contiguous doc and
  // annotation lines, so the doc comment is inside the unit. Handing it the head
  // and letting it walk is the whole fix: measured on the graded set, a slice
  // that begins BELOW the doc reads 29% of documented Rust functions as
  // undocumented, and dimensions 8 and 9 both go silently and permanently
  // wrong. This session's rig hit that twice.
  //
  // IT READS `headOffset`, NEVER `span.start`. The span is the WRITABLE region,
  // and Python's Fork A moves it past a leading docstring so that generation
  // rewrites only the body. Slicing from there put the start BELOW the `def`,
  // left no declaration in the range for `findHead`, and refused the function
  // outright: measured in the v61 host tier at 7 of the 10 functions in a real
  // Python file, against 0 of 13 in TypeScript, 0 of 11 in Rust, 0 of 10 in Go
  // and 0 of 11 in C#. Every one of the seven had a docstring, which is to say
  // the gesture refused Python's documented functions and scored only its
  // undocumented ones.
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
    log(refusalLine(sliceRefusalReason(resolved.symbolName)));
    void vscode.window.showWarningMessage(NO_FUNCTION_TOAST);
    return;
  }


  // 4. Score. Ten of the fourteen dimensions, and for those no model and no
  //    network are involved.
  const policy = wiring.policy ?? DEFAULT_ELEVATION;
  // IN VIEW LINES. `scored` is what the PLANNER reads, because the planner maps
  // findings onto the stripped region; `cardInDocumentLines` is what the human
  // reads. Every number that leaves this function for a person goes through that
  // map first.
  const scored = scoreFunction(unit, lang, policy);

  // 5. THE HONESTY JUDGE, and it is not enrichment. The other four dimensions
  //    come back from `scoreFunction` as `blind`, because a `Detector.run` is
  //    synchronous and asking a model is not. This round is what decides them,
  //    so it runs BEFORE the card is logged, before the blast radius and before
  //    anything is shown to a person.
  //
  //    Ordering matters twice over. The blast radius is walked only when an
  //    elevated dimension has a fix that changes the signature, and the honest
  //    fix for every honesty finding does exactly that: it injects the
  //    dependency and ripples to every caller. A honesty round after the walk
  //    would elevate a row whose call-site count nobody went and measured.
  //
  //    It also pays for the gate and the context bundle ONCE. Both rounds need
  //    them and each costs a call-hierarchy pair and a type resolve against a
  //    language server.
  // THE SCORING LINE GOES FIRST, BEFORE THE ROUND. It names the function, the
  // language and the head line, and none of those depend on what a model says.
  // Until phase 10 it was logged with no await between the scoring and the log;
  // afterwards a press cancelled during the honesty round threw the scoring line
  // and the summary away together, and the whole channel for a cancelled press
  // read as two lines that never said which function it was. Ten of the
  // fourteen rows were already computed, synchronously and for free.
  const preview = cardInDocumentLines(scored, view);
  log(scoringLine(preview.name, document.languageId, preview.headLine));

  const judged = await withHonesty(document, resolved, unit, lang, scored, wiring, log);
  const card = cardInDocumentLines(judged.card, view);
  // THE SUMMARY IS AFTER, because it counts elevated rows and four of them are
  // the round's to decide.
  const summary = summariseCard(card, policy);
  log(summaryLine(summary));

  // 6. Blast radius, BEST EFFORT. Undefined stays undefined all the way to the
  //    text: "0 call sites" is a claim the walk never made.
  const rows = await withBlastRadius(document, resolved, judged.card.rows, policy, log);

  // 6. Explain and FIX, BEST EFFORT and GATED. The gate is consulted before the
  //    transport is touched, and one pass over the elevated rows does both
  //    rounds: prose for the card, and the one sentence a model puts in a
  //    person's file. Every way the fix can fail - no model, a closed gate, a
  //    timeout, a sentence the gate turns down - ends on the table's phrase,
  //    which has shipped since 2.5.0, so the comment is complete either way and
  //    the channel says which happened.
  const modelled = await withModelRounds(rows, wiring, log, judged.session, judged.noSession);
  const explained = modelled.rows;
  const fixes = modelled.fixes;

  // 7. Render, and reveal.
  output.appendLine("");
  if (document.version !== scoredAtVersion) {
    log(staleEvidenceLine(scoredAtVersion, document.version));
    output.appendLine(staleCardLine(card.name));
    output.appendLine("");
  }
  // The enriched card in BOTH coordinate systems: the view-numbered one goes to
  // the planner, the document-numbered one to the human.
  const enriched: Scorecard = { ...judged.card, rows: explained };
  output.appendLine(renderScorecard(cardInDocumentLines(enriched, view), policy));
  output.show(true);
  void vscode.window.showInformationMessage(criticizeToast(card.name, summary));

  // 8. Propose, which the phase contract numbers 9 because it counts the slice
  //    as a step of its own. THE CARD ABOVE IS UNCHANGED BY THIS: everything
  //    from here reads the card and writes nothing to it, so a proposal that
  //    finds nothing to offer, or a presenter that fails, still leaves the
  //    developer the complete rubric they pressed for.
  //
  //    The ENRICHED card, not the scored one: the blast radius rides the
  //    signature-level comment, and the rows carrying it are the ones step 5
  //    handed back.
  await proposeInjection(document, resolved, enriched, view, policy, scoredAtVersion, wiring, log, fixes);
}

/**
 * What the two model rounds share, paid for once.
 *
 * The tier gate and the context bundle both cost real time (a call-hierarchy
 * pair, an outgoing-call round and a type resolve against a language server),
 * and both rounds need them. `undefined` means the gate was closed or the
 * context could not be built, and the explain round then skips without asking
 * again.
 */
/**
 * How many tokens the honesty round may spend.
 *
 * SMALL ON PURPOSE, and it is a bound on the ANSWER rather than on the thought.
 * The reply is four lines of line numbers; a model that needs more than this to
 * say `clock: none` three times and name two lines is not answering the
 * question it was asked, and the parser refuses a reply that arrives as prose
 * anyway. Recorded as CHOSEN, not measured, in docs/constants.md.
 */
const HONESTY_MAX_TOKENS = 256;

interface ModelSession {
  context: FixContext;
  backend: string;
}

/** Why there is no session, in the words the explain and fix skip lines print.
 *
 *  A closed tier gate has to name itself on EVERY line that mentions it. The
 *  first build of this handed `withModelRounds` a bare `undefined` and it
 *  printed a sentence of its own invention, so `fix skipped:` stopped carrying
 *  `tier-disabled` and a developer reading the channel could no longer tell a
 *  closed gate from an unreachable backend. Caught by the phase 10 table
 *  removal, which had to relax a row to accommodate it. */
type NoSession = { reason: string };

/**
 * THE HONESTY JUDGE. Four of the fourteen dimensions are decided here.
 *
 * This is not enrichment and it must not be read as enrichment. `scoreFunction`
 * returns `clock`, `prng`, `env` and `world` as `blind`, because a
 * `Detector.run` is synchronous and pure and asking a model is neither. Until
 * this round has run, those four rows are a refusal, not a pass.
 *
 * WHY THERE IS NO NAME TABLE BEHIND IT ANY MORE. Until 2026-08-29 the four were
 * 67 regular expressions naming specific library calls, so a row reading `clean`
 * meant "none of my spellings matched" while a developer read it as "this
 * function is honest". Human ruling, recorded in the amendment at the end of
 * session-v64/goal.md.
 *
 * EVERY FAILURE PATH ENDS ON `blind`, NEVER ON `clean`. A closed tier gate, an
 * unreachable backend, a cancelled press, an unreadable answer: each leaves the
 * four rows refusing by name with the cause on the channel. Falling back to a
 * pass would put the false certificate straight back, which is the one outcome
 * this whole change exists to remove.
 */
async function withHonesty(
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
  unit: FunctionUnderReview,
  lang: CriticizeLang,
  scored: Scorecard,
  wiring: CriticizeWiring,
  log: (line: string) => void,
): Promise<{ card: Scorecard; session?: ModelSession; noSession?: NoSession }> {
  const policy = wiring.policy ?? DEFAULT_ELEVATION;
  /** The four rows refusing with one reason. `scoreFunction` already returns
   *  them blind with a mechanism sentence; this replaces that with the CAUSE,
   *  which is the difference between "no round has run" and "the round could
   *  not reach ollama at localhost:11434". */
  const blindOutcomes = (reason: string): Record<HonestyDimension, DimensionOutcome> => {
    const out: Partial<Record<HonestyDimension, DimensionOutcome>> = {};
    for (const dimension of HONESTY_DIMENSIONS) {
      out[dimension] = { state: "blind", reason };
    }
    return out as Record<HonestyDimension, DimensionOutcome>;
  };
  /** Before the gate: no context was built, so there is no session to hand on.
   *  The reason travels WITH the absence, because the explain and fix lines
   *  have to print it too. */
  const blind = (reason: string): { card: Scorecard; session?: ModelSession; noSession?: NoSession } => {
    log(honestyBlindLine(reason));
    return { card: applyHonesty(scored, blindOutcomes(reason), policy), noSession: { reason } };
  };

  const gate = await wiring.tierGate();
  if (!gate.allowed) {
    const why =
      gate.reason === "tier-unresolved"
        ? "the hardware tier could not be resolved"
        : (wiring.tierMessage() ?? "the hardware tier disables function generation");
    return blind(`tier ${gate.reason}: ${why}`);
  }

  const config = readFnGenConfig();
  const backend = `${config.model} at ${config.apiBase}`;
  // THE BUNDLE IS BEST EFFORT AND SO IS THE CALL INTO IT. Every leg inside
  // `buildFixContext` guards itself, but the call into the injected resolver is
  // not itself inside a try, so a resolver that throws before it returns a
  // promise escaped here. Since phase 10 that throw travels out of the honesty
  // round, out of `runCriticize`, and the developer loses the WHOLE CARD -
  // fourteen rows, ten of which were computed synchronously and for free -
  // and gets a failure toast instead. Found by the phase 12 adversarial review.
  //
  // A CANCELLATION IS RETHROWN, everything else costs the prompt a block. The
  // developer's escape key must still stop the gesture, and every other model
  // site in this file takes both spellings.
  let context: FixContext;
  try {
    context = await buildFixContext(document, resolved, unit, lang, wiring, log);
  } catch (err) {
    if (isExplainCancellation(err) || isCancellation(err)) {
      throw err;
    }
    log(critiqueLine(`the context bundle failed, so the model round gets none of it: ${firstLine(String(err))}`));
    context = {};
  }
  log(fixContextLine(FIX_SHIPPED_ARM, context));

  // THE SESSION IS "THE GATE OPENED AND THE CONTEXT WAS BUILT", NOT "THE ROUND
  // SUCCEEDED". Every return below this line carries it. Withholding it on a
  // failed honesty round made the explain pass skip with a summary of its own
  // invention, and phase 1 of this session exists precisely to stop a dead
  // backend hiding behind a generic sentence: the explain pass has to reach its
  // own per-row failure and print `explained 0 of N` with the cause. Caught by
  // the phase 1 adversarial suite, row 1a.
  const session: ModelSession = { context, backend };
  const blindWithSession = (reason: string): { card: Scorecard; session?: ModelSession; noSession?: NoSession } => {
    log(honestyBlindLine(reason));
    return { card: applyHonesty(scored, blindOutcomes(reason), policy), session };
  };

  let generate: InstructGenerateFn;
  try {
    generate = wiring.transport();
  } catch (err) {
    if (isExplainCancellation(err) || isCancellation(err)) {
      throw err;
    }
    return blindWithSession(`${backend} is unreachable: ${firstLine(String(err))}`);
  }

  const controller = new AbortController();
  const claim = wiring.inFlight?.()?.begin("Judging a function's honesty", controller);
  // A CANCELLED ROUND STILL HAS TO RENDER FOUR ROWS, AND STILL HAS TO STOP THE
  // WALK. `judgeHonesty` swallows every transport failure into a `blind`
  // outcome by contract, because four of the fourteen rows depend on it and a
  // card with four holes is not a card. But a developer who pressed Escape must
  // not then sit through a round of explain calls. The cancellation is
  // therefore OBSERVED here, where the transport is owned, and rethrown after
  // the outcomes are in hand.
  let cancelled: unknown;
  const transport: HonestyTransport = async (prompt: string) => {
    try {
      const result = await generate({
        apiBase: config.apiBase,
        model: config.model,
        prompt,
        maxTokens: HONESTY_MAX_TOKENS,
        temperature: 0,
        numGpu: config.numGpu,
        numCtx: config.numCtx,
        think: config.think,
        signal: controller.signal,
        log,
      });
      return result.text;
    } catch (err) {
      if (isExplainCancellation(err) || isCancellation(err)) {
        cancelled = err;
      }
      throw err;
    }
  };

  let outcomes: Readonly<Record<HonestyDimension, DimensionOutcome>>;
  try {
    outcomes = await judgeHonesty(transport, unit, lang, { callees: context.callees }, backend);
  } finally {
    claim?.release();
  }
  if (cancelled !== undefined) {
    throw cancelled;
  }

  // `judgeHonesty` never throws, so a blind outcome here is its own refusal
  // carrying its own reason. Read it back off the rows rather than tracking a
  // second copy of "did it work", because two answers to that question is how a
  // card ends up saying one thing and a channel another.
  const refusal = HONESTY_DIMENSIONS.map((d) => outcomes[d]).find((o) => o.state === "blind");
  if (refusal !== undefined && refusal.state === "blind") {
    log(honestyBlindLine(refusal.reason));
    return { card: applyHonesty(scored, outcomes, policy), session: { context, backend } };
  }

  const flagged = HONESTY_DIMENSIONS.filter((d) => outcomes[d].state === "flagged").length;
  log(honestyJudgedLine(flagged, backend));
  return { card: applyHonesty(scored, outcomes, policy), session: { context, backend } };
}

/**
 * The half that can reach a person's file, and the one consent gate it goes
 * through.
 *
 * THE REGION IS THE HEAD TO THE END OF THE FUNCTION, and `injectionRegion` owns
 * the reasons: `span.start` is the WRITABLE region and Python's Fork A moves it
 * past a leading docstring, which would put every head-line finding outside the
 * replaced range. `resolved.span` is therefore never handed to the presenter.
 *
 * `versionAtResolve` is the version the card was SCORED at. The enrichment steps
 * take real time, so a developer who typed in between has already been told the
 * card is stale, and the presenter's own guard then discards the proposal rather
 * than splicing text computed from bytes that moved. That machinery exists and
 * this path only has to hand it the right number.
 *
 * IT NEVER RETHROWS, and that is what keeps the command's failure toast honest:
 * the only document write in this gesture is inside `present()`, so a failure
 * that escaped to the caller could not say whether anything landed.
 */
async function proposeInjection(
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
  card: Scorecard,
  view: ScoringView,
  policy: ElevationPolicy,
  versionAtResolve: number,
  wiring: CriticizeWiring,
  log: (line: string) => void,
  // The model's sentences, keyed by finding. EMPTY IS THE NORMAL CASE and it is
  // not a failure: every comment the planner writes carries the table's phrase
  // unless a key here has a sentence that survived the gate.
  fixes: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  const region = injectionRegion(
    document.getText(),
    resolved.headOffset,
    resolved.span.end,
    document.languageId,
  );
  // THE REGION IS DOCUMENT BYTES AND THE CARD IS VIEW LINES, so the number
  // between them has to be the view line of the region's own FIRST STRIPPED
  // line. The planner strips the region before it plants, and its first
  // surviving line is the declaration head: on a second press the region OPENS
  // on a planted comment, and handing it the region's document line would walk
  // every finding below that comment down the body by the number of comment
  // lines above it. That is S62-7's placement drift, and this is the one line
  // that closes it.
  const plan = planInjection(
    region.lines,
    viewLineAtOrAfter(view, region.startLine),
    card,
    policy,
    fixes,
  );
  // NOTHING TO PROPOSE IS NOT AN EMPTY DIFF. Nothing planted and nothing to
  // strip means the gesture ends on the card, because an empty diff tab is
  // worse than no diff tab. Nothing planted with something to strip IS a
  // proposal: the criticism was addressed and the stale comments should come
  // out.
  if (!hasProposal(plan)) {
    log(NO_PROPOSAL_LINE);
    return;
  }
  log(proposalOfferedLine(plan, injectingDimensions(card, policy)));

  // THIS GESTURE'S OWN EVIDENCE SINK, and not fn-gen's service. `[fngen]
  // outcome=accept` for a gesture that generated nothing would misname it, and
  // fn-gen's accept/reject evidence is MEASURED: oracles match `outcome=` tokens
  // whole, so a second gesture's verdicts landing there corrupt a number rather
  // than merely reading oddly.
  let accepted = false;
  const outcomes: ProposalOutcomeSink = {
    logOutcome: (outcome, detail) => {
      accepted = accepted || outcome === "accept";
      for (const line of critiqueOutcomeLines(outcome, detail)) {
        log(line);
      }
    },
  };

  try {
    // A REJECT GETS NO TOAST. The human said no; telling them so is noise, and
    // the presenter is already silent on that path. The outcome lands on the
    // channel through the sink above either way.
    await wiring.presenter().present({
      document,
      span: { start: region.start, end: region.end },
      versionAtResolve,
      title: proposalTitle(card.name),
      text: plan.text,
      service: outcomes,
      // THE NOUN, because the shared discard sentence is fn-gen's otherwise.
      // Every post-Accept discard toasts in every session - an approved edit
      // that failed to land is news - and "generation discarded" is a lie about
      // a gesture that generated nothing. The pre-consent one is routed to the
      // channel below for the same reason and was already right.
      discardNoun: "proposal",
      // THE PRE-CONSENT RACE GOES TO THE CHANNEL, not to a toast. The only way
      // to reach it here is that the developer typed while the caller walk and
      // the explainer rounds were running - their own keystrokes, against work
      // they never watched - and the card on screen ALREADY says so and already
      // tells them to press again. The default toast would repeat that in
      // fn-gen's words, and those words are "generation discarded" for a gesture
      // that generated nothing. Every post-Accept discard still toasts, because
      // an approved edit failing to land is news.
      onSystemDiscard: (why) => log(critiqueLine(`proposal discarded before it was shown: ${why}`)),
    });
  } catch (err) {
    if (isCancellation(err)) {
      throw err;
    }
    // The two sentences are DIFFERENT because the facts are: after an accept the
    // comments are in the file and a "nothing was changed" would be a lie, and
    // before one nothing has moved at all.
    log(critiqueLine(`the proposal failed: ${String(err)}`));
    void vscode.window.showWarningMessage(
      accepted
        ? `Column 80: the rubric comments landed, but the gesture failed afterwards (${firstLine(String(err))}). The full message is in the output channel.`
        : `Column 80: the criticism could not be proposed (${firstLine(String(err))}); nothing was changed. The full message is in the output channel.`,
    );
  }
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
 * THE ONE MODEL PASS: prose for the card, an imperative for the file, and a
 * reason on the channel for everything it did not produce.
 *
 * TWO ROUNDS PER ROW, ONE PASS OVER THE ROWS, AND THAT IS DELIBERATE. The
 * explainer writes a paragraph into the CARD and the fix round writes one
 * sentence into a person's SOURCE FILE, and they were built one release apart,
 * but they read the same rows under the same cap, ask the same tier gate the
 * same question, and go through the same transport. Two passes meant two gate
 * consults, two in-flight claims and two answers to "which rows are worth a
 * model round" that could drift apart. One pass has none of that, and the
 * transport is READ ONCE PER ROW and spent on both rounds.
 *
 * THE GATE IS CONSULTED BEFORE THE TRANSPORT IS TOUCHED, and it fails closed:
 * the same consult generate, repair, tighten and TDD make. A disabled service
 * is inert everywhere, and "inert" here means the card renders complete from
 * the detectors and every comment carries the table's phrase, while the channel
 * names the cause in two sentences that do not overlap.
 *
 * THE CONTEXT IS BUILT AFTER THE GATE, never before. It costs a call-hierarchy
 * pair, an outgoing-call round and a type resolve against a language server,
 * and paying for those with no model to feed them to is spending a developer's
 * editor on nothing.
 *
 * The prose is keyed by `findingKey` and handed to `attachExplanations`, which
 * iterates the ROWS rather than the map. An entry whose key matches no row is
 * unreachable, so a model that invents a finding cannot get it onto a card. The
 * fixes are keyed the same way and the planner reads them the same way, for the
 * same reason.
 *
 * THE FIXES ARE THE MODEL'S RAW SENTENCES, NOT THE GATED ONES. `orderFor` runs
 * `admissibleFix` at the moment the comment is written, which keeps the gate in
 * ONE place; handing the planner a sentence this pass had already rewritten
 * would have the second gate judging the first gate's output rather than the
 * model's.
 */
async function withModelRounds(
  rows: readonly ScorecardRow[],
  wiring: CriticizeWiring,
  log: (line: string) => void,
  session?: ModelSession,
  noSession?: NoSession,
): Promise<{ rows: readonly ScorecardRow[]; fixes: ReadonlyMap<string, string> }> {
  const noFixes: ReadonlyMap<string, string> = new Map();
  const card = { name: "", languageId: "", headLine: 0, rows };
  const targets = explainableRows(card, wiring.policy ?? DEFAULT_ELEVATION);
  if (targets.length === 0) {
    log(explainerSkippedLine("no row is above the evidence bar, so there is nothing to explain"));
    log(fixSkippedLine("no row is above the evidence bar, so there is no fix to write"));
    return { rows, fixes: noFixes };
  }

  // THE SESSION IS THE HONESTY ROUND'S, NOT A SECOND ONE. `withHonesty` already
  // consulted the tier gate and already paid for the context bundle, and both
  // cost a language-server round trip. An absent session means that round
  // already refused, and it refused for a reason it has already put on the
  // channel: repeating the gate here would ask a settled question again and
  // print the answer twice.
  //
  // A CLOSED GATE IS NOT A FAILURE. No toast, no warning: the card the
  // developer asked for is complete and about to be shown to them, every
  // comment still carries an order, and the only thing missing is prose they
  // were never promised.
  if (session === undefined) {
    const why = noSession?.reason ?? "the honesty round could not reach a model";
    log(explainerSkippedLine(why));
    log(fixSkippedLine(why));
    return { rows, fixes: noFixes };
  }
  const context = session.context;

  const config = readFnGenConfig();
  const controller = new AbortController();
  const claim = wiring.inFlight?.()?.begin("Explaining a critique", controller);

  const prose = new Map<string, string>();
  const fixes = new Map<string, string>();
  // WHY A ROUND SAID NOTHING, kept per round and tallied on the summary line.
  // The v62 release printed `explained 0 of 2 elevated row(s)` on all 44 host
  // runs with no backend running at all, and that sentence gave nobody a way to
  // see it. An outage and a quiet model now spell differently.
  const failures: ExplainFailure[] = [];
  const fixFailures: FixFailure[] = [];
  try {
    for (const row of targets) {
      if (row.outcome.state !== "flagged") {
        continue;
      }
      const finding: DetectorFinding | undefined = row.outcome.findings[0];
      if (finding === undefined) {
        continue;
      }

      // ONE TRANSPORT READ FOR THE ROW, spent on both rounds. It is read at
      // invoke time rather than captured above the loop because a settings
      // change rebuilds the service, and a getter that throws is an outage
      // rather than a bug: both rounds lose, and both say so.
      let generate: InstructGenerateFn;
      try {
        generate = wiring.transport();
      } catch (err) {
        if (isExplainCancellation(err) || isCancellation(err)) {
          throw err;
        }
        const detail = firstLine(String(err));
        failures.push({ kind: "unavailable", detail });
        log(explainerSkippedLine(`${row.dimension}: ${detail}`));
        fixFailures.push({ dimension: row.dimension, kind: "unreachable", detail });
        log(fixUnreachableLine(row.dimension, detail));
        continue;
      }

      // ROUND ONE: the card's prose. The ONLY construction site of an
      // authorization in the vscode layer, and it starts from a finding the
      // detectors produced. Grep for the type to find every one of them, the
      // way `TestRepairAuthorization` is found.
      const auth: ExplainAuthorization = { finding, source: row.source };
      const explain: ExplainTransport = async (prompt: string) => {
        const result = await generate({
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
      try {
        const text = await explainFinding(auth, explain, (failure) => {
          failures.push(failure);
          log(explainerSkippedLine(`${row.dimension}: ${failure.detail}`));
        });
        if (text.trim() !== "") {
          prose.set(findingKey(finding), text);
        }
      } catch (err) {
        // THE SAME PREDICATE `explainFinding` RETHROWS ON, not the narrower one
        // the rest of this file uses. `inFlight.isCancellation` takes only an
        // `Error` named `AbortError`, and vscode's own cancellations are named
        // `Canceled` and `CancellationError`: caught here under the narrow
        // check, the user's escape key was tallied as an unreachable backend
        // and the walk carried on to the next row. Found by the phase 1
        // adversarial review, with the channel line as its evidence.
        if (isExplainCancellation(err) || isCancellation(err)) {
          throw err;
        }
        // One row's round failing is not the explainer failing. That row keeps
        // its evidence line, which is what it would have had anyway.
        failures.push({ kind: "unavailable", detail: firstLine(String(err)) });
        log(explainerSkippedLine(`${row.dimension}: ${firstLine(String(err))}`));
      }

      // ROUND TWO: the sentence that goes in the file. THE TABLE'S OWN PHRASE
      // GOES INTO THE PROMPT, so the model is told what the generic answer
      // already is and that it will be used instead of a sentence that reads
      // the same on any function. That is the cheapest available defence
      // against the one failure mode this leg cannot afford.
      const prompt = buildFixPrompt(finding, row.source, orderFor(row.dimension), context, FIX_SHIPPED_ARM);
      let answer: string;
      try {
        const result = await generate({
          apiBase: config.apiBase,
          model: config.model,
          prompt,
          maxTokens: FIX_MAX_TOKENS,
          temperature: 0,
          numGpu: config.numGpu,
          numCtx: config.numCtx,
          think: config.think,
          signal: controller.signal,
          log,
        });
        answer = result.text;
      } catch (err) {
        if (isExplainCancellation(err) || isCancellation(err)) {
          throw err;
        }
        // AN OUTAGE, and it is spelled nothing like the refusal below.
        const detail = firstLine(String(err));
        fixFailures.push({ dimension: row.dimension, kind: "unreachable", detail });
        log(fixUnreachableLine(row.dimension, detail));
        continue;
      }
      const verdict = admissibleFix(answer);
      if ("refusal" in verdict) {
        fixFailures.push({ dimension: row.dimension, kind: "refused", detail: verdict.refusal });
        log(fixRefusedLine(row.dimension, verdict.refusal));
        continue;
      }
      fixes.set(findingKey(finding), answer);
    }
  } finally {
    claim?.release();
  }
  log(explainedLine(prose.size, targets.length, failures));
  log(fixedLine(fixes.size, targets.length, fixFailures));
  return { rows: attachExplanations(rows, prose), fixes };
}

/**
 * Everything the model may be shown about this function, and every absence.
 *
 * EVERY LEG IS BEST EFFORT AND EACH ONE FAILS ALONE. A language server that
 * will not resolve a type costs the prompt its type block and costs the other
 * three blocks nothing; a call hierarchy that places no root costs the call
 * lines. `buildFixPrompt` emits only the blocks it is given, so an absent leg
 * is a shorter prompt rather than an empty heading, and the arms table decides
 * which blocks are asked for at all.
 *
 * `callees` IS WORKSPACE-FILTERED AND CAPPED, and those are not tuning knobs.
 * The phase 5 spike measured `vscode.provideOutgoingCalls` answering on all
 * five servers in 1-27ms, then pointed it at a real Rust workspace and got 18
 * callees for the goal's own example function, every one of them `std`, 13,249
 * bytes of standard-library rustdoc and nothing about the codebase. The filter
 * is the leg. A function whose whole downstream is external contributes an
 * empty array, which `buildFixPrompt` renders as no block at all rather than as
 * a heading with nothing under it.
 *
 * Exported because the capture rig runs this same assembly inside a real host
 * over whole dogfood repositories, and an arm measured against a prompt someone
 * rebuilt by hand is a measurement of that hand.
 */
export async function buildFixContext(
  document: vscode.TextDocument,
  resolved: ResolvedFunction,
  unit: FunctionUnderReview,
  lang: CriticizeLang,
  deps: {
    resolvePrefill?: typeof resolvePrefill;
    extractorFor?: (languageId: string) => SurfaceExtractor | undefined;
    /** The type resolve's bound. Defaulted; a parameter so the capture rig can
     *  spend longer on a cold server than a developer waiting on a gesture
     *  would. */
    typeShapeMs?: number;
  },
  log: (line: string) => void,
): Promise<FixContext> {
  const context: FixContext = {};

  // Arm B, and it is free: the slice is already in hand, doc comment and all.
  if (unit.lines.length > 0) {
    context.functionText = unit.lines;
  }

  // Arm B's other half. `signatureParts` refuses a unit it cannot parse, and a
  // refusal here means the model reads the head off the function text instead,
  // which is where it already is.
  try {
    const parts = signatureParts(unit, lang);
    if (parts !== undefined) {
      const rendered = renderSignature(parts.declaredName, parts.params, parts.result);
      if (rendered !== "") {
        context.signature = rendered;
      }
    } else {
      log(fixSkippedLine(`the signature of ${unit.name} did not parse, so the prompt carries no parsed signature`));
    }
  } catch (err) {
    log(fixSkippedLine(`the signature of ${unit.name} could not be parsed: ${firstLine(String(err))}`));
  }

  // Arm C. THE SHAPES, not the names: `shard: u64` is already on the signature,
  // and what decides whether "make them newtypes" is advice or nonsense is
  // whether this codebase declares `Budget` as a struct with three fields or as
  // a newtype over `u64`. This is the same rendered block repair is handed.
  if (deps.resolvePrefill !== undefined && deps.extractorFor !== undefined) {
    const extractor = deps.extractorFor(document.languageId);
    if (extractor === undefined) {
      log(fixSkippedLine(`no surface extractor is registered for ${document.languageId}, so the prompt carries no type shapes`));
    } else {
      const ms = deps.typeShapeMs ?? FIX_TYPE_SHAPE_MS;
      const block = await withDeadline(
        // `omitInstruction` because this prompt writes its own instruction and
        // the pre-fill's would be a second, conflicting one.
        deps.resolvePrefill(extractor, document, resolved, log, { omitInstruction: true }),
        ms,
        (why) => log(fixSkippedLine(`the type shapes ${why}, so the prompt carries none`)),
      );
      const lines = (block ?? "").split(/\r?\n/).filter((line) => line.trim() !== "");
      if (lines.length > 0) {
        context.typeShapes = lines;
      }
    }
  }

  // Arms D and E. THE SAME NORMALISED CURSOR both existing gestures use to
  // answer "which function is the developer in": a second answer to that
  // question is the defect session-v60 measured, where one press of Run
  // Covering Tests and one press of Repair Function discovered two different
  // functions' tests for one cursor.
  const at = callRootPosition(document, resolved);

  // Arm D, and the goal calls it the cheapest win on the list: the walk that
  // measures the blast radius already finds these and keeps only the count.
  try {
    const sites = await callSiteLines(document, at, FIX_CALL_SITE_CAP, log);
    if (sites.length > 0) {
      context.callSites = sites;
    }
  } catch (err) {
    log(fixSkippedLine(`the call sites could not be read: ${firstLine(String(err))}`));
  }

  // Arm E. Workspace-filtered, capped, and empty on a leaf function whose
  // callees are all standard library - which the spike measured as the common
  // case on exactly the functions the signature-level detectors fire on.
  try {
    const callees = await calleeDocs(document, at, FIX_CALLEE_CAP, lang, log);
    if (callees.length > 0) {
      context.callees = callees;
    }
  } catch (err) {
    log(fixSkippedLine(`the callees could not be read: ${firstLine(String(err))}`));
  }

  return context;
}

/**
 * The parsed signature as one line a reader takes in at a glance.
 *
 * Five languages spell a declaration five ways, and the model has the real head
 * in the function text above this line anyway. What this adds is the PARSE: the
 * name, the parameter list as one string, and the declared result where the
 * language wrote one, so the model does not have to find the parameter parens
 * past a `pub(crate)` or a Go method receiver to know what the arguments are.
 */
function renderSignature(name: string, params: string, result: string): string {
  const declared = typeof name === "string" ? name.trim() : "";
  if (declared === "") {
    return "";
  }
  const args = typeof params === "string" ? params.trim() : "";
  const returns = typeof result === "string" ? result.trim() : "";
  return `${declared}(${args})${returns === "" ? "" : ` -> ${returns}`}`;
}

/**
 * A bounded wait on a best-effort leg, and NEITHER OUTCOME THROWS.
 *
 * The two ways to lose are told apart on the channel, because they want
 * different actions: a resolve that REJECTED is a defect somewhere in the
 * resolution path, and a resolve that never answered is a language server that
 * is still indexing or is gone. A shared spelling for those is the same defect
 * phase 1 of this session closed one layer up.
 *
 * The losing promise is left running. There is nothing to cancel it with, and
 * abandoning it costs a resolve nobody reads rather than a gesture that hangs.
 */
async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  onLoss: (why: string) => void,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = work.then(
    (value) => value,
    (err) => {
      onLoss(`failed: ${firstLine(String(err))}`);
      return undefined;
    },
  );
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      onLoss(`did not answer in ${ms}ms`);
      resolve(undefined);
    }, ms);
  });
  try {
    return await Promise.race([settled, deadline]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
