/**
 * The Criticize gesture: one command, fifteen dimensions, five languages, and a
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
 * a fifteen-row panel is knowledge a developer has to re-enter by hand, and a
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
 * gate, render, propose.
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
  NO_PROPOSAL_LINE,
  blastLine,
  cardInDocumentLines,
  criticizeToast,
  critiqueLine,
  critiqueOutcomeLines,
  explainableRows,
  explainerSkippedLine,
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
import { sliceFunction } from "../core/criticizeSlice";
import { scoreFunction } from "../core/criticizeScore";
import { DetectorFinding } from "../core/criticizeTypes";

import { makeResolveCallers, prepareCallRoot } from "./callHierarchy";
import { readFnGenConfig } from "./config";
import {
  ProposalOutcomeSink,
  ProposalPresenter,
  ResolvedFunction,
  resolveFunctionAtCursor,
} from "./fnGen";
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
  // undocumented, and dimensions 9 and 10 both go silently and permanently
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


  // 4. Score. Every dimension, always, and no model and no network are involved.
  //    This is the product; everything after it is enrichment.
  const policy = wiring.policy ?? DEFAULT_ELEVATION;
  // IN VIEW LINES. `scored` is what the PLANNER reads, because the planner maps
  // findings onto the stripped region; `cardInDocumentLines` is what the human
  // reads. Every number that leaves this function for a person goes through that
  // map first.
  const scored = scoreFunction(unit, lang, policy);
  const card = cardInDocumentLines(scored, view);
  log(scoringLine(card.name, document.languageId, card.headLine));
  const summary = summariseCard(card, policy);
  log(summaryLine(summary));

  // 5. Blast radius, BEST EFFORT. Undefined stays undefined all the way to the
  //    text: "0 call sites" is a claim the walk never made.
  const rows = await withBlastRadius(document, resolved, scored.rows, policy, log);

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
  // The enriched card in BOTH coordinate systems: the view-numbered one goes to
  // the planner, the document-numbered one to the human.
  const enriched: Scorecard = { ...scored, rows: explained };
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
  await proposeInjection(document, resolved, enriched, view, policy, scoredAtVersion, wiring, log);
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
