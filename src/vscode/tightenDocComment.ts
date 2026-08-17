/**
 * `Column 80: Tighten Doc Comment` - the gesture that turns one dictated line
 * into a wrapped doc comment whose type names are backticked, and nothing else.
 *
 * WHY THIS FILE IS NOT GLUE. Four pure modules decide; this one owns the
 * guarantees that only exist once they are wired in an order:
 *
 *  - THE WORDS ARE PROVABLY THE HUMAN'S. Nothing here composes a word. Every
 *    edit is a backtick around a span the developer already said, a deletion
 *    they ticked, or whitespace. `verbatimBreach` re-derives that from the
 *    bytes before the write is offered, so the claim is checked against the
 *    command's own output rather than trusted from the parts.
 *  - ONLY A FOLD MATCH AUTO-APPLIES. `Proposal.autoApply` is read, never
 *    re-derived from `match`: a plural strip is a guess about English and a
 *    repo holding both `Plan` and `Plane` would have "planes" silently
 *    respelled.
 *  - NO BACKTICK WITHOUT A TIER 1 OR TIER 2 HIT, and every strip is a channel
 *    line naming the word and the tier that refused it. Silent removal is the
 *    one behaviour this must not have.
 *  - ONE `resolvePrefill` PER INVOCATION. It is a pre-fill-class resolve at
 *    roughly 285ms; both the delta gate and the diff's consequence lines read
 *    the ledger it hands over, and neither may buy a second one. That is why
 *    the command is MANUAL and is wired to no keystroke.
 *  - THE RENDER IS THE BASELINE EDIT. It applies whenever the region resolved,
 *    whatever happens to the rows: the names are the optional half. Two
 *    versions of this file got that backwards in two different places - first
 *    by refusing when no name survived, then by discarding the render when no
 *    row was accepted - and both left the feature's primary input, a dictated
 *    120-column line, exactly as long as it started.
 *  - THE QUERY BUDGET IS BOUNDED AND MEASURED. `TIGHTEN_QUERY_BUDGET` caps the
 *    whole invocation, because two caps that multiply are not a cap.
 *
 * EVERY DEPENDENCY ON `fnGen.ts` IS TYPE-ONLY. The registration passes the four
 * functions this needs, so there is no runtime edge from the tighten command
 * into the generate command (and no import cycle). It is also what lets the
 * headless suite drive the whole pipeline with a counting `resolvePrefill`.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { withDocumentEol } from "./eol";

import { InstructGenerateFn } from "../core/ollama";
import { FnGenConfig } from "../core/config";
import { SurfaceExtractor } from "../core/extraction";
import { availablePromptTok, estimateTextTok, splitInjectedUnits } from "../core/promptBudget";
import { isAllCapsConstant, stopNamesFor } from "../core/repairTypes";
import { spliceSpan } from "../core/span";
import { foldName, identifierVariants, matchByFold, spokenWords } from "../core/spokenName";
import {
  Candidate,
  PrefillLedgerView,
  Proposal,
  classifyCandidate,
  deltaProposals,
} from "../core/tightenClassify";
import { ORDINARY_ENGLISH, RestatementPair, UndefinedTerm, findRestatements, findUndefinedTerms } from "../core/tightenFlags";
import { PROPOSER_SPAN_CAP, assembleProposerPrompt, parseProposerReply } from "../core/tightenProposer";
import {
  ImportPathDeps,
  RATIFY_QUERY_CAP,
  RatifyVerdict,
  TYPE_ISH_KINDS,
  WorkspaceSymbolHit,
  ratifyWorkspaceHits,
} from "../core/tightenRatify";
import { TightenRegion, renderRegion, servesTighten, tightenAtCursor } from "../core/tightenRender";
import { readCloudConfig, readFnGenConfig } from "./config";
import type { ProposalPresenter, ResolvedFunction, prefillLangFor, resolveFunctionAtCursor, resolvePrefill } from "./fnGen";

/** The command id and its palette title, spelled once. `refine` is taken:
 *  `src/core/refine.ts` is the style rewrite of CODE, and two unrelated refines
 *  in one palette is a collision in the product's own surface. */
export const TIGHTEN_COMMAND_ID = "column80.tightenDocComment";

/**
 * WORKSPACE-SYMBOL QUERIES ONE INVOCATION MAY SPEND, in total.
 *
 * `PROPOSER_SPAN_CAP` (12) times `RATIFY_QUERY_CAP` (9) is 108, and the first
 * version of this command could reach 85 of them serially with a second sweep
 * on top (session-v52 phase 5 adversarial, defect 8). Nothing capped the
 * product of the two caps.
 *
 * TWELVE, which is one first query per span the developer could ever be shown.
 * The allocation is breadth before depth: every unresolved span gets its first
 * query before any span gets a second, because the first query is what the
 * recall measurement says answers. A budget that binds is a channel line, never
 * a silent truncation.
 *
 * SIZED AGAINST A MEASUREMENT, not against the ~500ms Roslyn floor the contract
 * quoted, which is for a REFERENCE call and is the wrong operation. Warm
 * `workspace/symbol` p95, measured in session-v52/ratify-query-cost.md: Roslyn
 * 0.9ms, gopls 4.4ms, rust-analyzer 5.3ms, tsserver `navto` 16.9ms. Twelve
 * queries is therefore about 0.2s at the slowest of the four, against a model
 * round of seconds and a pre-fill of ~285ms.
 */
export const TIGHTEN_QUERY_BUDGET = 12;

/** Queries ONE phrase may spend: the first, plus two of the sweep's variants.
 *  The measured marginal recall of the whole nine-variant sweep over the first
 *  query is 0 of 451 names, so this is already generous; it is not zero because
 *  the corpus is two of the five providers. */
export const TIGHTEN_SWEEP_CAP = 3;

/**
 * A hit as this file collects it from `vscode.executeWorkspaceSymbolProvider`.
 *
 * The scheme is PINNED to `"vscode"` rather than left as the ratifier's union.
 * Every hit this file produces comes from VS Code's own provider, so it is
 * always vscode's 0-indexed `SymbolKind`, and a raw-LSP kind reaching this type
 * is a wiring mistake the compiler should refuse: LSP numbers Class 5 where
 * vscode numbers it 4, so the two silently disagree about what a type is.
 */
export type TightenSymbolHit = WorkspaceSymbolHit & { kindScheme: "vscode" };

/** What the command must be handed because it lives in `fnGen.ts`. Passed at
 *  registration rather than imported, so this module carries no runtime edge to
 *  the generate command and the whole pipeline drives headless. */
export interface TightenWiring {
  presenter: ProposalPresenter;
  resolveFunction: typeof resolveFunctionAtCursor;
  /** THE ONE PRE-FILL. Called exactly once per invocation; a test counts it. */
  resolvePrefill: typeof resolvePrefill;
  /** Tier 1's dispatcher: `PrefillLang.typeReference` per language. No second
   *  anchor is built here (phase 3 contract, tier 1). */
  prefillLangFor: typeof prefillLangFor;
  /** The injection extractor for a language, or undefined when injection is off
   *  - in which case there is no ledger and every candidate degrades to class 4,
   *  which `classifyCandidate` states as a degrade rather than a guess. */
  extractorFor: (languageId: string) => SurfaceExtractor | undefined;
  /** The tier-resolved transport, the SAME one fn-gen's rounds go through. Not
   *  `FnGenService.generate`: that postprocesses a CODE reply (trims to a
   *  function, rejects a reply not containing the requested function) and a
   *  proposer reply is a list of phrases. */
  transport: () => InstructGenerateFn;
  /** What the evidence should call the model, from the same service. */
  modelTag: () => string;
}

/** Seams the suite replaces. Every one defaults to the real host. */
export interface TightenDeps {
  /** `vscode.executeWorkspaceSymbolProvider`, tier 2's only round trip. */
  querySymbols?: (query: string) => Promise<readonly TightenSymbolHit[]>;
  fileExists?: (p: string) => boolean;
  readFile?: (p: string) => string | undefined;
  workspaceRoot?: () => string | undefined;
  /** The fn-gen settings the budget line and the proposer request read. */
  config?: () => FnGenConfig;
  /** Whether this backend has a local window at all. Cloud and Claude Code have
   *  none (`buildFnGenService` deletes `numCtx` for both), and a budget line
   *  quoting a window the backend does not have is a number nobody can act on. */
  windowed?: () => boolean;
  /** The review: rows in, the indices the developer accepted out. `undefined`
   *  is a cancel and writes nothing. */
  review?: (review: TightenReview) => Promise<readonly number[] | undefined>;
  /** The one write. */
  applyEdit?: (document: vscode.TextDocument, start: number, end: number, text: string) => Promise<boolean>;
  /** The refusal surface. */
  warn?: (message: string) => void;
}

/** One line the developer can tick. A row is an EDIT; a note never is. */
export interface TightenRow {
  kind: "respell" | "backtick" | "delete";
  /** The identifier for a backtick, the restated span's opening words for a
   *  deletion. Never composed: both are read out of the buffer or out of the
   *  workspace's own spelling. */
  label: string;
  detail: string;
  /** Ticked by default. Only a `fold` match is, and the rule is read off
   *  `Proposal.autoApply` rather than re-derived from `match`. */
  checked: boolean;
  /** The span of the PROSE this row rewrites, and what it becomes. */
  start: number;
  end: number;
  replacement: string;
}

export interface TightenReview {
  title: string;
  rows: readonly TightenRow[];
  /** Information, never an edit: the strips, the flags, the budget. */
  notes: readonly string[];
  /** The whole buffer as it would read with exactly these rows applied. */
  renderWith: (accepted: readonly number[]) => string;
}

export type TightenOutcome =
  | { status: "refused"; reason: string }
  | { status: "nothing"; reason: string }
  | { status: "cancelled" }
  | { status: "applied"; text: string; rows: readonly TightenRow[]; accepted: readonly number[] };

// ------------------------------------------------------------------ the order

/**
 * The command, end to end, in the order phase 5's contract fixes:
 *
 *  1. the region at the cursor, or a refusal that edits nothing
 *  2. the render (whitespace only)
 *  3. ONE `resolvePrefill`, with `onLedger`
 *  4. the proposer, one model call
 *  5. the delta gate (classes 1 and 2 dropped silently, loudly on the channel)
 *  6. the existence gate (tier 1, tier 2, then strip and say so)
 *  7. the flags
 *  8. the diff
 *  9. on accept, one edit
 *
 * Steps 3 and 4 are NOT run in parallel even though nothing couples them. The
 * proposer's prompt is cheap to assemble and the ledger's channel lines have to
 * read in the order the work happened, or a developer reading the channel
 * cannot tell which pre-fill a drop belongs to.
 */
export async function tightenDocComment(
  document: vscode.TextDocument,
  position: vscode.Position,
  log: (line: string) => void,
  wiring: TightenWiring,
  deps: TightenDeps = {},
): Promise<TightenOutcome> {
  const languageId = document.languageId;
  const warn = deps.warn ?? ((message: string) => void vscode.window.showWarningMessage(message));
  const refuse = (reason: string): TightenOutcome => {
    log(`[tighten] refused: ${reason}`);
    warn(`Column 80: ${reason}`);
    return { status: "refused", reason };
  };
  if (!servesTighten(languageId)) {
    return refuse(`the tighten gesture does not serve ${languageId}.`);
  }

  // 1 + 2. The region and its render. A refusal has no span and no replacement,
  // so a caller that forgets to check has nothing to apply.
  const text = document.getText();
  const tabWidth = tabWidthOf(document);
  const rendered = tightenAtCursor({ text, languageId, cursor: document.offsetAt(position), tabWidth });
  if (!rendered.ok) {
    return refuse(rendered.refusal);
  }
  const region = rendered.region;
  const prose = region.prose;
  log(
    `[tighten] region=${region.kind} lang=${languageId} indent=${region.indent.length}` +
      ` prefix=${JSON.stringify(region.prefix)} prose=${prose.length}ch`,
  );

  // 3. THE ONE PRE-FILL. Its `log` is ours, so `resolvePrefill`'s own stop and
  // type-cap lines land on the channel under their existing prefixes and this
  // file does not print a second, drifting copy of them.
  const versionAtResolve = document.version;
  const resolved = await wiring.resolveFunction(document, position, true);
  let ledger: PrefillLedgerView | undefined;
  if (resolved === undefined) {
    // A doc comment with no function under it. The command still runs: the
    // classifier's documented degrade is that a caller who disclosed no surface
    // classifies everything as class 4, and the channel says so rather than
    // letting an empty ledger read as "nothing was in the prompt".
    log("[tighten] no function at the cursor: no pre-fill, every candidate classifies as class 4");
  } else {
    await wiring.resolvePrefill(wiring.extractorFor(languageId), document, resolved, log, {
      onLedger: (l) => {
        ledger = l;
      },
    });
  }
  log(ledgerLine(ledger));
  log(budgetLine(ledger, deps));

  // 4. The proposer. One model call, and it POINTS: every span it returns is
  // sliced out of the prose at an offset `parseProposerReply` found.
  const proposed = await runProposer(prose, languageId, log, wiring, deps);
  const spans = proposed.spans;
  if (proposed.failed) {
    // Ship condition 8, and the review found this one silent: an unreachable
    // model used to leave a channel line and nothing on the surface. The
    // gesture still does its other half, so this warns rather than refuses.
    warn("Column 80: the model could not be reached, so no type names were offered. The re-wrap needs no model.");
  } else if (spans.length === 0) {
    log("[tighten] the proposer named no spans");
  }

  // 5 + 6. Identifier, delta gate, existence gate. Ordered by cost: the fold
  // against the disclosed surface is free and runs first, then ONE provider
  // query per span, then the sweep on a miss while the budget lasts (phase 3
  // contract, "Cost", as re-sized by the latency measurement in
  // session-v52/ratify-query-cost.md).
  //
  // EVERY REFUSAL IS COLLECTED, not only logged: contract p5 says a refused
  // backtick is shown to the developer with the tier that refused it, and a
  // strip that lives only on the channel is a silent removal from where they
  // are looking.
  const strips: string[] = [];
  const strip = (sentence: string) => {
    strips.push(sentence);
    log(`[tighten] strip: ${sentence}`);
  };
  const disclosed = disclosedNames(ledger);
  const budget = { left: TIGHTEN_QUERY_BUDGET, bound: false };
  const found: { candidate: Candidate; hits: readonly TightenSymbolHit[]; fromLedger: boolean }[] = [];

  // Pass 0: the free legs. A span already inside backticks is press two, a span
  // the disclosed surface names is answered by the pre-fill's own walk, and an
  // ordinary English word is not a type name in any repo.
  const unresolved: { span: (typeof spans)[number]; hits: TightenSymbolHit[] }[] = [];
  const claimed = new Set<string>();
  const asked = new Set<string>();
  for (const span of spans) {
    if (alreadyTicked(prose, span.start, span.end)) {
      // Press two. The span is already a backticked name, so a proposal for it
      // would render ``ClientSet`` and the second press would not be a no-op.
      log(`[tighten] skip: ${JSON.stringify(span.phrase)} is already inside a backticked span`);
      continue;
    }
    const fromSurface = matchByFold(span.phrase, disclosed);
    if (fromSurface !== undefined) {
      if (claimed.has(fromSurface.identifier)) {
        continue;
      }
      claimed.add(fromSurface.identifier);
      found.push({
        candidate: { ...fromSurface, phrase: span.phrase, start: span.start, end: span.end },
        hits: [],
        fromLedger: true,
      });
      continue;
    }
    if (isOrdinaryWord(span.phrase)) {
      // Defect 8, fix 3. A CLI that prefaces its answer claims `the`, `a` and
      // `walker` as spans, and each of them bought a full sweep. No repo names
      // a type with one ordinary English word in lower case, and the ones that
      // come close are in the language's own stop set anyway.
      log(`[tighten] skip: ${JSON.stringify(span.phrase)} is an ordinary word, not a type name`);
      continue;
    }
    // Defect 11, the half that costs money: two spans that would ask the
    // provider the SAME question cannot produce two different identifiers, so
    // the second one is dropped here rather than after its query comes back.
    // A model that lists a phrase three times used to buy three lookups and
    // write one backtick.
    const query = firstVariantOf(span.phrase);
    if (asked.has(query)) {
      log(`[tighten] skip: ${JSON.stringify(span.phrase)} asks the same question, already proposed once`);
      continue;
    }
    asked.add(query);
    unresolved.push({ span, hits: [] });
  }

  // Pass 1: ONE query each, in the convention most likely for a type name.
  // Measured: on tsserver, gopls and rust-analyzer the first query answers
  // everything the sweep answers, so the budget buys breadth before depth.
  for (const row of unresolved) {
    const first = await queryOnce(firstVariantOf(row.span.phrase), row.hits, budget, log, deps);
    row.hits = first;
  }
  // Pass 2: the sweep, only for what pass 1 missed, capped per span AND against
  // the invocation's own budget.
  for (const row of unresolved) {
    const phrase = row.span.phrase;
    let match: { identifier: string; match: Candidate["match"] } | undefined = matchByFold(
      phrase,
      typeIsh(row.hits).map((h) => h.name),
    );
    if (match === undefined) {
      match = await sweepForIdentifier(phrase, row.hits, budget, log, deps);
    }
    if (match === undefined) {
      strip(
        `${JSON.stringify(phrase)} - tier 2: no type of that name in the workspace ` +
          `(${row.hits.length} hits from the symbol provider)`,
      );
      continue;
    }
    // Defect 11, ruled: ONE backtick per identifier. The gesture buys a
    // re-root and one root is one root, so phase 2's amendment 15 wins over
    // amendment 10, and the dedupe happens HERE rather than after ratification
    // so the duplicate's queries are never paid.
    if (claimed.has(match.identifier)) {
      log(`[tighten] skip: ${JSON.stringify(phrase)} names ${match.identifier}, already proposed once`);
      continue;
    }
    claimed.add(match.identifier);
    found.push({
      candidate: { ...match, phrase, start: row.span.start, end: row.span.end },
      hits: row.hits,
      fromLedger: false,
    });
  }
  if (budget.bound) {
    log(`[tighten] the query budget of ${TIGHTEN_QUERY_BUDGET} bound; some names were not swept`);
  }

  // The delta gate. Classes 1 and 2 are dropped silently FROM THE REVIEW and
  // never from the channel: "dropped silently" means silent to the developer's
  // review, and a developer who wants to know why a name did not survive reads
  // the channel and finds the answer.
  for (const f of found) {
    const klass = ledger === undefined ? 4 : classifyCandidate(f.candidate.identifier, ledger);
    const collided = klass === 1 || klass === 2 ? collidedWith(f.candidate.identifier, ledger) : undefined;
    log(
      `[tighten] candidate ${f.candidate.identifier} (${JSON.stringify(f.candidate.phrase)}, match=${f.candidate.match})` +
        ` class=${klass}` +
        (collided === undefined ? "" : ` - dropped, already in the prompt as ${collided}`),
    );
  }
  const proposals = deltaProposals(
    found.map((f) => f.candidate),
    // A LEDGER THAT SAYS NOTHING is a documented degrade in the classifier, not
    // an error: a caller whose pre-fill never ran disclosed no surface, so
    // nothing can be shown to be in it and everything classifies as class 4.
    // The cast is what says that out loud rather than inventing an empty ledger
    // here, which would read as "the prompt was empty" and is a different claim.
    ledger as PrefillLedgerView,
    languageId,
  );
  // THE DELTA GATE'S OWN DROPS, named (defect 4). The per-candidate line above
  // reports the CLASS, and a candidate can survive its class and still be
  // dropped by `deltaProposals` on the pre-fill's stop set or on
  // `isAllCapsConstant` - which used to print `class=4` and then vanish. A
  // developer reading the channel for "why did my name not survive" has to find
  // the answer, whichever gate took it.
  const survived = new Set(proposals.map((p) => p.identifier));
  for (const f of found) {
    const identifier = f.candidate.identifier;
    if (survived.has(identifier)) {
      continue;
    }
    const klass = ledger === undefined ? 4 : classifyCandidate(identifier, ledger);
    if (klass === 1 || klass === 2) {
      continue; // already named above, with the name it collided with
    }
    strip(`${identifier} - the delta gate refused it: ${gateReasonFor(identifier, languageId)}`);
  }
  const hitsFor = new Map(found.map((f) => [f.candidate.identifier, f.hits]));
  const ledgerSourced = new Set(found.filter((f) => f.fromLedger).map((f) => f.candidate.identifier));

  // The existence gate. Tier 1 first: it is the anchor the injection leg uses
  // afterwards, so a name that anchors here needs no round trip at all.
  const ratified: { proposal: Proposal; verdict: Extract<RatifyVerdict, { ok: true }> }[] = [];
  for (const proposal of proposals) {
    const verdict = await ratify(
      proposal.identifier,
      hitsFor.get(proposal.identifier) ?? [],
      ledgerSourced.has(proposal.identifier),
      budget,
      { document, languageId, resolved, log, wiring, deps },
    );
    if (verdict.ok) {
      ratified.push({ proposal, verdict });
      continue;
    }
    strip(`${verdict.detail} (${verdict.reason})`);
  }

  // 7. The flags. Neither is an edit the product may make on its own: a
  // restatement offers a DELETION, which cannot introduce a claim, and an
  // undefined term is a question and never a write.
  const resolvedNames = [
    ...(ledger?.rendered ?? []),
    ...(ledger?.visited ?? []),
    ...ratified.map((r) => r.verdict.identifier),
  ];
  const restatements = findRestatements(prose);
  const terms = findUndefinedTerms({ prose, resolved: resolvedNames, stopNames: stopNamesFor(languageId) });
  for (const pair of restatements.pairs) {
    log(
      `[tighten] flag restatement (${pair.grain}, containment ${pair.containment}): ` +
        `${JSON.stringify(clip(pair.a.text))} against ${JSON.stringify(clip(pair.b.text))}`,
    );
  }
  for (const term of terms) {
    log(`[tighten] flag undefined term ${JSON.stringify(term.term)} (${term.uses} use${term.uses === 1 ? "" : "s"}) in ${JSON.stringify(clip(term.sentence))}`);
  }

  // 8. The diff.
  //
  // THE RE-WRAP IS AN EDIT ON ITS OWN, and the first version of this file made
  // it conditional on a row surviving - so a dictated one-liner with no type
  // name in it was answered with "nothing to tighten" and left at 200 columns,
  // which is the whole gesture failing to do the thing it is named for. The
  // rows are the optional half; the render is the baseline. On press two the
  // render is idempotent, so this is false and the no-op is preserved.
  const rows = buildRows(ratified, restatements.pairs, ledger, ledger !== undefined);
  const rewraps = renderRegion(region, languageId, tabWidth) !== text.slice(region.start, region.end);
  if (rows.length === 0 && !rewraps) {
    const reason = "nothing to tighten: the comment is already wrapped and no name survived both gates.";
    log(`[tighten] ${reason}`);
    warn(`Column 80: ${reason}`);
    return { status: "nothing", reason };
  }
  const notes = buildNotes(ledger, deps, terms, restatements.pairs.length, rows, strips);
  const renderWith = (accepted: readonly number[]): string =>
    spliceSpan(text, region, renderRegion({ ...region, prose: applyRows(prose, rows, accepted) }, languageId, tabWidth));
  const review = deps.review ?? ((r: TightenReview) => defaultReview(document, r, wiring.presenter));
  const accepted = await review({
    title: `Column 80: tighten ${region.kind === "docstring" ? "docstring" : "doc comment"}`,
    rows,
    notes,
    renderWith,
  });
  if (accepted === undefined) {
    log("[tighten] cancelled: nothing was written");
    return { status: "cancelled" };
  }
  // AN ACCEPT OF A ROW THAT DOES NOT EXIST IS A BROKEN CALLER, and the answer is
  // a refusal rather than a quiet subset: a review that returns an index nobody
  // offered has lost track of what it showed, and writing the rows it DID get
  // right would be this command deciding which of its own edits the developer
  // meant. Checked before the rows are resolved, because `effectiveRows` filters
  // and a filter here would be the silent subset.
  const bogus = accepted.filter((i) => !Number.isInteger(i) || i < 0 || i >= rows.length);
  if (bogus.length > 0) {
    return refuse(`the review accepted a row that does not exist (${bogus.join(", ")}); nothing was written.`);
  }
  // THE RENDER IS THE BASELINE EDIT AND IT DOES NOT DEPEND ON A ROW. The
  // empty-accept guard used to return here, which put amendment 2's own failure
  // back one step later: the developer saw a wrapped preview, pressed Apply, and
  // the 121-column line stayed 121 columns (defect 1). The guard was aimed at
  // "an accept of nothing must not dirty the buffer with identical bytes", so
  // the test is whether the RENDER changed anything.
  const effective = effectiveRows(rows, accepted, log);
  if (effective.length === 0 && !rewraps) {
    const reason = "nothing was accepted and the comment is already wrapped, so nothing was written.";
    log(`[tighten] ${reason}`);
    warn(`Column 80: ${reason}`);
    return { status: "nothing", reason };
  }

  // 9. One edit, and the verbatim check runs against the BYTES it would write.
  // Ship condition 2 is a property of this file's output, so it is proved here
  // rather than assumed from the parts that produced it.
  const finalText = renderWith(effective);
  const breach = verbatimBreach(prose, region, finalText, languageId, tabWidth, rows, effective);
  if (breach !== undefined) {
    return refuse(`the tightened comment is not word-for-word what you wrote (${breach}); nothing was changed.`);
  }
  if (document.version !== versionAtResolve) {
    return refuse("the document changed while the comment was being reviewed; nothing was written.");
  }
  const replacement = renderRegion({ ...region, prose: applyRows(prose, rows, effective) }, languageId, tabWidth);
  const applyEdit = deps.applyEdit ?? defaultApplyEdit;
  const ok = await applyEdit(document, region.start, region.end, replacement);
  if (!ok) {
    return refuse("the editor refused the edit; nothing was written.");
  }
  // THE COUNT IS THE ROWS THAT REACHED THE BUFFER, not the ones ticked: a
  // backtick inside an accepted deletion is superseded by it, and a channel line
  // claiming two when one landed is the channel lying about a write (defect 3).
  log(`[tighten] applied ${effective.length} of ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  return { status: "applied", text: finalText, rows, accepted: effective };
}

// ------------------------------------------------------------- the proposer

/** One model round. A transport that throws is a refusal to propose, never a
 *  failed command: the render still stands on its own. */
async function runProposer(
  prose: string,
  languageId: string,
  log: (line: string) => void,
  wiring: TightenWiring,
  deps: TightenDeps,
): Promise<{ spans: ReturnType<typeof parseProposerReply>; failed: boolean }> {
  const config = (deps.config ?? readFnGenConfig)();
  const prompt = assembleProposerPrompt({ prose, languageId });
  const controller = new AbortController();
  let reply: string;
  try {
    const result = await wiring.transport()({
      apiBase: config.apiBase,
      model: config.model,
      prompt,
      // A reply is at most PROPOSER_SPAN_CAP short lines. Sized off the cap
      // rather than the code budget: a body's `maxTokens` here would let a
      // model that ignores the format burn a minute before the parse drops it.
      maxTokens: Math.max(64, PROPOSER_SPAN_CAP * 16),
      temperature: 0,
      numGpu: config.numGpu,
      numCtx: config.numCtx,
      think: config.think,
      signal: controller.signal,
    });
    reply = result.text;
  } catch (err) {
    log(`[tighten] the proposer round failed (${String(err)}); no backticks are proposed`);
    return { spans: [], failed: true };
  }
  const spans = parseProposerReply(reply, prose);
  log(`[tighten] proposer model=${wiring.modelTag()} named ${spans.length} span${spans.length === 1 ? "" : "s"}`);
  return { spans, failed: false };
}

// -------------------------------------------------------------- the sweep

/** The spelling the FIRST query uses: the convention a type name is most likely
 *  to be spelled in, which every measured provider answers whatever convention
 *  the repo really uses. */
function firstVariantOf(phrase: string): string {
  return identifierVariants(spokenWords(phrase))[0] ?? phrase;
}

/** One query, charged to the invocation's budget. A provider that throws is a
 *  miss, never a broken gesture, and the query is still charged: a server that
 *  fails slowly costs the same wall clock as one that answers. */
async function queryOnce(
  variant: string,
  into: TightenSymbolHit[],
  budget: { left: number; bound: boolean },
  log: (line: string) => void,
  deps: TightenDeps,
): Promise<TightenSymbolHit[]> {
  if (variant === "") {
    return into;
  }
  if (budget.left <= 0) {
    budget.bound = true;
    return into;
  }
  budget.left--;
  try {
    into.push(...(await (deps.querySymbols ?? defaultQuerySymbols)(variant)));
  } catch (err) {
    log(`[tighten] symbol query ${JSON.stringify(variant)} failed: ${String(err)}`);
  }
  return into;
}

/**
 * The rest of the variants, for a phrase the first query missed.
 *
 * WHAT THIS IS WORTH, MEASURED (session-v52/ratify-query-cost.md): the marginal
 * recall of the whole sweep over the first query is 0 of 451 real type names,
 * on tsserver and on gopls. Amendment 5 kept the full nine "because it costs
 * nothing when the first query hits", and the phase 5 review was right that the
 * justification is backwards: a miss is the only case where it runs. So it is
 * capped twice over, at `TIGHTEN_SWEEP_CAP` per phrase and at
 * `TIGHTEN_QUERY_BUDGET` for the whole invocation.
 *
 * It is not deleted, because the recall corpus is two languages and both of
 * those providers are hump-aware. A provider that is not would need it, and one
 * extra query is what finding out costs.
 */
async function sweepForIdentifier(
  phrase: string,
  hits: TightenSymbolHit[],
  budget: { left: number; bound: boolean },
  log: (line: string) => void,
  deps: TightenDeps,
): Promise<{ identifier: string; match: Candidate["match"] } | undefined> {
  const variants = identifierVariants(spokenWords(phrase));
  let spent = 1; // the first query, already paid in pass 1
  for (const variant of variants.slice(1, RATIFY_QUERY_CAP)) {
    if (spent >= TIGHTEN_SWEEP_CAP) {
      return undefined;
    }
    if (budget.left <= 0) {
      budget.bound = true;
      return undefined;
    }
    spent++;
    await queryOnce(variant, hits, budget, log, deps);
    // TYPE-ISH KINDS ONLY, and it has to happen HERE rather than in the
    // ratifier alone. `matchByFold` refuses when a key reaches two different
    // spellings, and a repo with a `ClientSet` type beside a `client_set`
    // function has exactly that collision - which is the collision the kind
    // filter was measured to clear. Folding over raw provider names inherits it
    // and turns a resolvable type into an ambiguity refusal.
    const found = matchByFold(phrase, typeIsh(hits).map((h) => h.name));
    if (found !== undefined) {
      log(`[tighten] sweep: ${JSON.stringify(phrase)} needed ${spent} queries (first was ${JSON.stringify(variants[0])})`);
      return found;
    }
  }
  return undefined;
}

// ------------------------------------------------------------ the two tiers

/**
 * Tier 1, then tier 2, then a refusal. Tier 1 is `PrefillLang.typeReference`
 * and is NOT rebuilt here: a code occurrence in the span, an import line, a
 * same-file definition, and it is the same anchor the injection leg uses
 * afterwards.
 *
 * NO SECOND SWEEP (defect 8, fix 2). The first version re-swept whenever it held
 * no hits, which is exactly the surface-matched candidate: a name the pre-fill's
 * own walk emitted, dropped or declined to look at. Those are already resolved
 * types by construction, and the sweep it bought was a full nine queries for a
 * fact the ledger had. A ledger-sourced candidate that tier 1 cannot anchor gets
 * ONE query, charged to the same budget, and no sweep.
 */
async function ratify(
  identifier: string,
  known: readonly TightenSymbolHit[],
  fromLedger: boolean,
  budget: { left: number; bound: boolean },
  ctx: {
    document: vscode.TextDocument;
    languageId: string;
    resolved: ResolvedFunction | undefined;
    log: (line: string) => void;
    wiring: TightenWiring;
    deps: TightenDeps;
  },
): Promise<RatifyVerdict> {
  if (ctx.resolved !== undefined && anchorsInFile(identifier, ctx)) {
    return { ok: true, tier: 1, identifier };
  }
  let hits = known;
  if (hits.length === 0 && fromLedger) {
    hits = await queryOnce(firstVariantOf(identifier), [], budget, ctx.log, ctx.deps);
  }
  const deps: ImportPathDeps = {
    fileExists: ctx.deps.fileExists ?? ((p) => fs.existsSync(p)),
    readFile: ctx.deps.readFile ?? readFileOrUndefined,
    workspaceRoot: (ctx.deps.workspaceRoot ?? defaultWorkspaceRoot)(),
  };
  return ratifyWorkspaceHits(identifier, hits, ctx.languageId, targetPathOf(ctx.document), deps);
}

/** Tier 1 as a predicate. `typeReference` wants the file's own type definitions,
 *  which the language's own `localTypeDefs` derives; a language whose dispatch
 *  throws on a malformed buffer is a miss, never a broken gesture. */
function anchorsInFile(
  identifier: string,
  ctx: {
    document: vscode.TextDocument;
    languageId: string;
    resolved: ResolvedFunction | undefined;
    wiring: TightenWiring;
    log: (line: string) => void;
  },
): boolean {
  if (ctx.resolved === undefined) {
    return false;
  }
  try {
    const lang = ctx.wiring.prefillLangFor(ctx.languageId);
    const fullText = ctx.document.getText();
    const localTypeDefs = lang.localTypeDefs(fullText, new Set<string>());
    return lang.typeReference(identifier, ctx.document, ctx.resolved, fullText, localTypeDefs) !== undefined;
  } catch (err) {
    ctx.log(`[tighten] tier 1 anchor for ${identifier} failed: ${String(err)}`);
    return false;
  }
}

// ---------------------------------------------------------------- the rows

/**
 * What the developer ticks.
 *
 * A respelling ("client set" -> `ClientSet`) and a bare backtick (the words
 * already spell the identifier) are different rows because they are different
 * claims: one changes characters the human typed and the other only adds
 * punctuation around them. Both carry the same consequence line.
 */
function buildRows(
  ratified: readonly { proposal: Proposal; verdict: Extract<RatifyVerdict, { ok: true }> }[],
  pairs: readonly RestatementPair[],
  ledger: PrefillLedgerView | undefined,
  measured: boolean,
): TightenRow[] {
  const rows: TightenRow[] = [];
  for (const { proposal, verdict } of ratified) {
    // The HIT's spelling, never the candidate's (phase 3 amendment 3): the
    // repo's spelling is what `findTypeReference` reads back one phase later.
    const identifier = verdict.identifier;
    const respell = proposal.phrase !== identifier;
    rows.push({
      kind: respell ? "respell" : "backtick",
      label: identifier,
      detail: consequenceOf(proposal, verdict, ledger, measured),
      // READ, never re-derived. A plural strip is a guess about English and
      // reaches the developer unticked, exactly as an abbreviation guess does.
      checked: proposal.autoApply,
      start: proposal.start,
      end: proposal.end,
      replacement: `\`${identifier}\``,
    });
  }
  for (const pair of pairs) {
    // The LATER span is the one offered for deletion: the first statement is
    // the one the developer wrote first, and a deletion cannot introduce a
    // claim only while what survives is still their sentence.
    rows.push({
      kind: "delete",
      label: clip(pair.b.text),
      detail: `restates an earlier ${pair.grain} (containment ${pair.containment}); deleting is the only prose edit this command may make`,
      checked: false,
      start: pair.b.start,
      end: pair.b.end,
      replacement: "",
    });
  }
  return rows;
}

/**
 * The consequence, not the punctuation.
 *
 * A running total against the window is a number the developer cannot act on.
 * Two facts they can: whether the type is in the prompt today (the class), and
 * what accepting costs (`displaces`).
 *
 * THE MEMBER COUNT THE CONTRACT ASKS FOR IS NOT DERIVABLE FOR THE TYPE BEING
 * PROPOSED, and this is the one place the contract asks for something the one
 * ledger cannot answer. A surviving proposal is class 3 or class 4, which means
 * by definition that `resolvePrefill` rendered no block for it - so its member
 * count and its token cost are exactly what the single call did not resolve.
 * What IS in the ledger is the DISPLACED type's block, so the token figure is
 * attached there: `displaces SegmentIndex (~60 tok)` is the same decision, read
 * off the same call, and honest about which side of the swap was measured.
 */
function consequenceOf(
  proposal: Proposal,
  verdict: Extract<RatifyVerdict, { ok: true }>,
  ledger: PrefillLedgerView | undefined,
  measured: boolean,
): string {
  const parts: string[] = [];
  // NOT MEASURED IS NOT THE SAME AS NOT INJECTED (defect 6). With no pre-fill -
  // no function under the comment, or injection switched off - every candidate
  // classifies as class 4 by the classifier's documented degrade, and the row
  // used to state "not currently injected" as a fact about a surface nobody
  // built. Phase 4 draws the same distinction with `unmeasured`, for the same
  // reason: a number nobody can act on beats a silence that reads as a verdict.
  parts.push(
    !measured
      ? "not measured: no pre-fill ran, so nothing is known about what is injected"
      : proposal.klass === 4
        ? "not currently injected"
        : `reachable but dropped${causeOf(proposal.identifier, ledger)}`,
  );
  if (proposal.displaces !== undefined) {
    const block = blockTokFor(proposal.displaces, ledger);
    parts.push(`displaces ${proposal.displaces}${block === undefined ? "" : ` (~${block} tok)`}`);
  }
  if (verdict.tier === 2) {
    parts.push(
      verdict.sameScope === true
        ? `defined in ${path.basename(verdict.path)}, already in scope`
        : `defined in ${path.basename(verdict.path)}, needs ${verdict.importLine}${verdict.qualifier === undefined ? "" : ` and the \`${verdict.qualifier}.\` qualifier`}`,
    );
  }
  return parts.join(", ");
}

/** Why the walk let this name go, verbatim from the ledger that said so. */
function causeOf(identifier: string, ledger: PrefillLedgerView | undefined): string {
  const key = foldName(identifier);
  const dropped = (ledger?.dropped ?? []).find((d) => foldName(d.name) === key);
  if (dropped !== undefined) {
    return ` (${dropped.cause})`;
  }
  const noBlock = (ledger?.noBlock ?? []).find((n) => foldName(n.type) === key);
  if (noBlock !== undefined) {
    return ` (${noBlock.reason})`;
  }
  return (ledger?.notLookedAt ?? []).some((n) => foldName(n) === key) ? " (the cap never looked at it)" : "";
}

/**
 * The estimated cost of ONE rendered block, off the surface the single pre-fill
 * already returned. `splitInjectedUnits` and `estimateTextTok` are
 * `promptBudget.ts`'s own, so this is a read of the product's arithmetic and not
 * a second one.
 *
 * MATCHED BY HEADER, never by substring (defect 5). `surface.indexOf(type)` finds
 * the type's name wherever it first appears, which is routinely a MEMBER LINE of
 * an earlier block (`- index: SegmentIndex`) or the import-hint block that
 * renders first, and the run-to-the-next-blank-line then priced four tokens of
 * somebody else's block instead of twenty-eight of this one. Amendment 1 moved
 * this number to the displaced side precisely so it would be a measurement; a
 * 7x under-report is the same garment.
 */
function blockTokFor(type: string, ledger: PrefillLedgerView | undefined): number | undefined {
  const surface = ledger?.surface;
  if (typeof surface !== "string" || surface === "" || type === "") {
    return undefined;
  }
  const key = foldName(type);
  for (const unit of splitInjectedUnits(surface)) {
    // The HEADER is the unit's first non-empty line, and it names the block's
    // type. A member line can carry the name too and is never a header.
    const header = unit.split("\n").find((l) => l.trim() !== "") ?? "";
    const named = header.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    if (named.some((n) => foldName(n) === key)) {
      return estimateTextTok(unit);
    }
  }
  return undefined;
}

/** The notes: everything the review shows and nothing it can tick. */
function buildNotes(
  ledger: PrefillLedgerView | undefined,
  deps: TightenDeps,
  terms: readonly UndefinedTerm[],
  restatements: number,
  rows: readonly TightenRow[],
  strips: readonly string[],
): string[] {
  const notes: string[] = [budgetLine(ledger, deps).replace(/^\[tighten] /, "")];
  // THE REFUSED BACKTICKS, where the developer is looking (defect 7). Contract
  // p5: "A refused backtick is shown too, with the tier that refused it. Silent
  // removal is the one behaviour this must not have." A strip that reaches only
  // the output channel is silent from the review, which is the surface the
  // sentence is about.
  for (const sentence of strips) {
    notes.push(`refused: ${sentence}`);
  }
  for (const term of terms) {
    notes.push(`undefined term "${term.term}" - the comment instructs with it and never says what it is`);
  }
  if (restatements > 0) {
    notes.push(`${restatements} restatement${restatements === 1 ? "" : "s"} found; deleting one is offered above and is never automatic`);
  }
  const guesses = rows.filter((r) => r.kind !== "delete" && !r.checked).length;
  if (guesses > 0) {
    notes.push(`${guesses} row${guesses === 1 ? " is a guess" : "s are guesses"}: the folded words do not equal the identifier, so they are unticked`);
  }
  return notes;
}

// --------------------------------------------------------------- the edits

/**
 * THE ROWS THAT WILL ACTUALLY REACH THE BUFFER, out of the ones ticked.
 *
 * A DELETION SUPERSEDES ANY SUBSTITUTION INSIDE IT, and that is the ruling the
 * first version was missing (defect 3). A restatement span routinely contains a
 * backticked name; `applyRows` walks right to left and skipped whichever row
 * crossed the last one applied, so the DELETION was the row that vanished, and
 * the channel then said "applied 2 of 2". The span is going away and the
 * backtick in it goes with it: that is the only resolution where the developer
 * gets what they ticked.
 *
 * Any other overlap is refused rather than resolved. Two substitutions cannot
 * overlap (the proposer's spans do not), so an overlap here is a defect and
 * splicing one edit into the middle of another would produce bytes neither row
 * asked for.
 */
function effectiveRows(
  rows: readonly TightenRow[],
  accepted: readonly number[],
  log: (line: string) => void,
): number[] {
  const chosen = [...new Set(accepted)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < rows.length)
    .sort((a, b) => rows[a].start - rows[b].start);
  const deletions = chosen.filter((i) => rows[i].kind === "delete");
  const kept: number[] = [];
  for (const index of chosen) {
    const row = rows[index];
    if (row.kind !== "delete") {
      const inside = deletions.find((d) => row.start >= rows[d].start && row.end <= rows[d].end);
      if (inside !== undefined) {
        log(
          `[tighten] superseded: \`${row.label}\` sits inside a restatement you chose to delete, ` +
            `so the deletion carries it away`,
        );
        continue;
      }
    }
    const clash = kept.find((k) => row.start < rows[k].end && rows[k].start < row.end);
    if (clash !== undefined) {
      log(`[tighten] dropped: ${JSON.stringify(row.label)} overlaps ${JSON.stringify(rows[clash].label)}, which is a defect report`);
      continue;
    }
    kept.push(index);
  }
  return kept;
}

/** The prose with exactly these rows applied, right to left so no offset moves
 *  under an edit that has not run yet. Overlap is already resolved by
 *  `effectiveRows`; a caller that skips it gets the same last-writer guard. */
function applyRows(prose: string, rows: readonly TightenRow[], accepted: readonly number[]): string {
  const chosen = [...new Set(accepted)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < rows.length)
    .map((i) => rows[i])
    .sort((a, b) => b.start - a.start);
  let out = prose;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const row of chosen) {
    if (row.end > lastStart) {
      continue;
    }
    out = out.slice(0, row.start) + row.replacement + out.slice(row.end);
    lastStart = row.start;
  }
  return out;
}

/**
 * SHIP CONDITION 2, checked against the command's own output rather than
 * trusted from the parts that produced it.
 *
 * Strip whitespace and backticks from the region's prose and from the prose the
 * buffer would carry afterwards, and the two must be equal - once every
 * accepted row is accounted for. A respelling is allowed exactly when the
 * folded spoken span equals the folded identifier or the developer ticked it by
 * hand; a deletion is allowed when the developer ticked it. Anything else is a
 * breach and the write does not happen.
 *
 * The comparison strips [ \t\r\n] and backticks ONLY. `\s` is wrong here for
 * the reason phase 1 found the hard way: a non-breaking space is a character
 * the human said, and an oracle that strips it cannot see it being replaced.
 */
export function verbatimBreach(
  prose: string,
  region: TightenRegion,
  finalText: string,
  languageId: string,
  tabWidth: number | undefined,
  rows: readonly TightenRow[],
  accepted: readonly number[],
): string | undefined {
  const edited = applyRows(prose, rows, accepted);
  // What the buffer will actually carry, read back through the same parse that
  // produced the region: the render is what the developer gets, so the check
  // must run on the render and not on the string that was handed to it.
  const replacement = renderRegion({ ...region, prose: edited }, languageId, tabWidth);
  if (bare(edited) !== bare(strippedProseOf(replacement, region))) {
    return "the rendered comment does not carry the same characters as the words it was built from";
  }
  if (finalText.indexOf(replacement) < 0) {
    return "the previewed buffer does not contain the rendered comment";
  }
  // NO BACKTICK MAY BE WELDED TO A WORD THE HUMAN SAID, and this is the check
  // that can SEE the class the character-comparison cannot (defect 2). `bare`
  // strips backticks before comparing, which is exactly the character that did
  // the damage: `the walker will re`ShardMemCache` entries` passes it while
  // standing rule 1 is broken. Counting NEWLY glued backticks, rather than
  // forbidding them outright, is what keeps a developer's own `re`X`` bytes
  // from being read as this command's doing.
  const glued = gluedTicks(edited) - gluedTicks(prose);
  if (glued > 0) {
    return `${glued} backtick${glued === 1 ? " was" : "s were"} written into the middle of a word the developer typed`;
  }
  // Every accepted row, against the span it actually consumed. This is where a
  // row that composed a word dies: nothing upstream can be trusted to have
  // stayed inside the rules, because the whole point of the guarantee is that
  // it holds even when an upstream stage is wrong.
  for (const index of new Set(accepted)) {
    const row = rows[index];
    if (row === undefined) {
      return "the review accepted a row that does not exist";
    }
    const source = prose.slice(row.start, row.end);
    if (row.kind === "delete") {
      if (row.replacement !== "") {
        return "a deletion row wrote text; a deletion is the only prose edit allowed and it may only remove";
      }
      continue;
    }
    if (row.replacement !== `\`${row.label}\``) {
      return `a substitution wrote ${JSON.stringify(row.replacement)} rather than the identifier it named`;
    }
    // A row that was TICKED BY DEFAULT is the product's own judgement, so it
    // has to be a respelling: the folded spoken span equals the folded
    // identifier. A row the developer ticked themselves is their accept, which
    // is the other half of the ship condition and is allowed to differ.
    if (row.checked && foldName(source) !== foldName(row.label)) {
      return `${JSON.stringify(source)} was auto-respelled to ${row.label}, and the two do not fold to the same word`;
    }
    if (foldName(source) === "" || foldName(row.label) === "") {
      return "a substitution folds to nothing, so it cannot be shown to be the same word";
    }
    // The span itself has to be a whole word sequence. `parseProposerReply`
    // guarantees it now, and this is the same claim checked where the write
    // happens: a row whose offsets came from anywhere else cannot smuggle one
    // past by being correct in every other respect.
    const before = row.start === 0 ? "" : prose[row.start - 1];
    const after = prose[row.end] ?? "";
    if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) {
      return `${JSON.stringify(source)} sits inside a longer word, so backticking it would split the human's word`;
    }
  }
  return undefined;
}

/** Whitespace and backticks off, and NOTHING else. */
function bare(text: string): string {
  return text.replace(/[ \t\r\n`]+/g, "");
}

/** How many backticks in `text` touch a word character on one side and are the
 *  edge of a span on the other: the shape `re`ShardMemCache`` has two, and
 *  ordinary ``ShardMemCache`` has none. */
function gluedTicks(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "`") {
      continue;
    }
    const before = i === 0 ? "" : text[i - 1];
    const after = text[i + 1] ?? "";
    // A tick with a word character on BOTH sides is inside a word; one with a
    // word character behind it and a space in front is the tail of a span that
    // began mid-word. Either way the human's word has a tick in it.
    if (/[A-Za-z0-9_]/.test(before) && /[A-Za-z0-9_`]/.test(after)) {
      count++;
    }
  }
  return count;
}

/** The prose back out of a rendered block: the indent, the opener and the
 *  docstring delimiters removed, so the two sides of the verbatim check are
 *  the same kind of string. */
function strippedProseOf(replacement: string, region: TightenRegion): string {
  const opener = region.prefix.trimEnd();
  const quote = region.quote ?? '"""';
  const out: string[] = [];
  for (const raw of replacement.split(/\r?\n/)) {
    const line = raw.slice(region.indent.length === 0 ? 0 : matchedIndent(raw, region.indent));
    if (region.kind === "docstring" && line.trim() === quote) {
      continue;
    }
    out.push(opener !== "" && line.startsWith(opener) ? line.slice(opener.length) : line);
  }
  return out.join("\n");
}

/** How much of the region's indent this line actually carries. A verbatim unit
 *  may be indented further; taking the region's own width off a line that has
 *  less would eat a character of the human's text. */
function matchedIndent(line: string, indent: string): number {
  let n = 0;
  while (n < indent.length && line[n] === indent[n]) {
    n++;
  }
  return n;
}

// -------------------------------------------------------------- the channel

function ledgerLine(ledger: PrefillLedgerView | undefined): string {
  if (ledger === undefined) {
    return "[tighten] ledger: none (no pre-fill ran)";
  }
  return (
    `[tighten] ledger: typeCap=${ledger.typeCap} admitted=${ledger.admitted}` +
    ` rendered=[${ledger.rendered.join(", ")}] visited=${ledger.visited.length}` +
    ` notLookedAt=[${ledger.notLookedAt.join(", ")}] dropped=[${ledger.dropped.map((d) => `${d.name}:${d.cause}`).join(", ")}]`
  );
}

/**
 * THE BUDGET LINE READS `promptBudget.ts`. It does not compute a second total:
 * `availablePromptTok` and `estimateTextTok` are the product's own arithmetic,
 * `FnGenService.generate` already arbitrates with them, and two totals in one
 * product disagree within a session.
 */
function budgetLine(ledger: PrefillLedgerView | undefined, deps: TightenDeps): string {
  const config = (deps.config ?? readFnGenConfig)();
  const windowed = (deps.windowed ?? defaultWindowed)();
  // AN UNMEASURED SURFACE IS NOT AN EMPTY ONE (defect 6). With no pre-fill there
  // is no surface to price, and "~0 tok" is what an empty prompt looks like.
  const surface = ledger === undefined ? undefined : estimateTextTok(ledger.surface ?? "");
  const spent = surface === undefined ? "injected surface not measured (no pre-fill ran)" : `injected surface ~${surface} tok`;
  if (!windowed || config.numCtx === undefined) {
    return `[tighten] budget: ${spent}; this backend has no local window to arbitrate against`;
  }
  const available = availablePromptTok(config.numCtx, config.maxTokens);
  return (
    `[tighten] budget: ${spent} of ~${available} tok available` +
    ` (num_ctx=${config.numCtx}, num_predict=${config.maxTokens})`
  );
}

// ---------------------------------------------------------------- plumbing

/** Every type name the ledger mentions, in the order the classes read them, so
 *  a phrase can be matched against the surface for free before any query. */
function disclosedNames(ledger: PrefillLedgerView | undefined): string[] {
  if (ledger === undefined) {
    return [];
  }
  return [
    ...ledger.rendered,
    ...ledger.visited,
    ...ledger.notLookedAt,
    ...ledger.dropped.map((d) => d.name),
    ...ledger.noBlock.map((n) => n.type),
  ].filter((n) => typeof n === "string" && n !== "");
}

/**
 * WHICH GATE INSIDE `deltaProposals` TOOK IT, for the channel line.
 *
 * Re-derived rather than reported by the gate, because `deltaProposals` returns
 * survivors and nothing else. Both tests below are the gate's own, called with
 * the gate's own inputs, so a change there shows up here as "no reason found"
 * rather than as a wrong one.
 */
function gateReasonFor(identifier: string, languageId: string): string {
  if (stopNamesFor(languageId).has(identifier)) {
    return `\`${identifier}\` is in ${languageId}'s own stop set, so the pre-fill would never inject it`;
  }
  if (isAllCapsConstant(identifier)) {
    return `\`${identifier}\` is an ALL_CAPS constant spelling, not a type name`;
  }
  return "the gate dropped it and gave no reason, which is a defect report";
}

/** The name a class 1 or class 2 drop collided with, so the channel can say
 *  which one rather than only that there was one. */
function collidedWith(identifier: string, ledger: PrefillLedgerView | undefined): string | undefined {
  const key = foldName(identifier);
  for (const name of [...(ledger?.rendered ?? []), ...(ledger?.visited ?? [])]) {
    if (foldName(name) === key) {
      return name;
    }
  }
  // THE FALLBACK FOLDS TOO (defect 10). A raw `includes` misses the case the
  // fold exists for: the surface spells the same type `shard_mem_cache` and the
  // candidate is `ShardMemCache`, so the class is 2 and the line named nothing.
  for (const word of (ledger?.surface ?? "").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (foldName(word) === key) {
      return `${word} in the rendered surface`;
    }
  }
  return undefined;
}

/**
 * Is this span already inside a pair of backticks? The press-twice guard: a
 * proposal on an already-backticked name would render ``Name``.
 *
 * BACKTICKS ARE PAIRED, not toggled (defect 9). The first version flipped a
 * boolean on every backtick and returned the flag, so ONE unmatched backtick
 * anywhere earlier in the comment - a developer writing "uses a ` character",
 * or an unclosed fence - reported every later span as already ticked and
 * disabled the gesture for the rest of the comment, with a channel line giving
 * that as the reason. An unpaired trailing backtick opens nothing.
 */
function alreadyTicked(prose: string, start: number, end: number): boolean {
  for (let open = prose.indexOf("`"); open >= 0; open = prose.indexOf("`", open + 1)) {
    const close = prose.indexOf("`", open + 1);
    if (close < 0) {
      return false; // an unmatched tick is a character, not an opener
    }
    if (start <= close && open <= end) {
      return true;
    }
    open = close;
  }
  return false;
}

/**
 * ORDINARY ENGLISH, in one lower-case word, which no repo spells a type with.
 *
 * The population this exists for is a chatty reply: a CLI that answers "Here
 * are the type names I found:" hands the parser `the`, `a` and `walker` as
 * spans, because each is a substring of the prose, and each one used to buy a
 * full nine-query sweep for a name that cannot exist.
 *
 * The list is `tightenFlags.ts`'s own ordinary-English set, reused rather than
 * written again here, plus nothing. A MULTI-WORD phrase is never dropped by
 * this: "client set" is two ordinary words and is exactly what the gesture is
 * for. Neither is a capitalised single word, because `Walker` in the prose is
 * the developer spelling a type name in code style.
 */
function isOrdinaryWord(phrase: string): boolean {
  const word = phrase.trim();
  return /^[a-z]+$/.test(word) && ORDINARY_ENGLISH.has(word);
}

/** The hits that are a TYPE. VS Code's own `SymbolKind` numbering, which is
 *  what every hit this file collects carries (`kindScheme: "vscode"`). */
function typeIsh(hits: readonly TightenSymbolHit[]): TightenSymbolHit[] {
  return hits.filter((h) => TYPE_ISH_KINDS.has(h.kind));
}

function clip(text: string, max = 60): string {
  const flat = text.replace(/[ \t\r\n]+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function tabWidthOf(document: vscode.TextDocument): number | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || editor.document !== document) {
    return undefined;
  }
  const size = editor.options.tabSize;
  return typeof size === "number" ? size : undefined;
}

function targetPathOf(document: vscode.TextDocument): string {
  return document.uri.fsPath ?? document.uri.path;
}

function readFileOrUndefined(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

function defaultWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Cloud and Claude Code have no local window: `buildFnGenService` deletes
 *  `numCtx` for both, and its absence is what tells the arbitration this class
 *  is exempt. Read the same way here so the budget line cannot claim a window
 *  the backend does not have. */
function defaultWindowed(): boolean {
  return readCloudConfig() === undefined;
}

/** `vscode.executeWorkspaceSymbolProvider` into the ratifier's records. The
 *  kinds are VS Code's own numbering, which is what `kindScheme: "vscode"`
 *  declares: nothing here reads a raw LSP response. */
async function defaultQuerySymbols(query: string): Promise<readonly TightenSymbolHit[]> {
  const answered = await vscode.commands.executeCommand<vscode.SymbolInformation[] | undefined>(
    "vscode.executeWorkspaceSymbolProvider",
    query,
  );
  if (!Array.isArray(answered)) {
    return [];
  }
  return answered
    .filter((s) => s !== null && typeof s === "object" && typeof s.name === "string")
    .map((s) => ({
      name: s.name,
      kind: s.kind as unknown as number,
      path: s.location?.uri?.fsPath ?? s.location?.uri?.path ?? "",
      ...(typeof s.containerName === "string" && s.containerName !== "" ? { containerName: s.containerName } : {}),
      kindScheme: "vscode" as const,
    }));
}

async function defaultApplyEdit(
  document: vscode.TextDocument,
  start: number,
  end: number,
  text: string,
): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  // The DOCUMENT's ending, not the region's. `tightenRegion` derives the
  // ending from the region's own slice, which agrees with the document
  // everywhere except the one place it cannot: the file's last line with no
  // trailing terminator carries nothing to copy, so an LF rewrap landed in a
  // CRLF file. Region-local and document-global are two mechanisms for one
  // concern, and this is the one the whole extension shares.
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(start), document.positionAt(end)),
    withDocumentEol(text, document),
  );
  return vscode.workspace.applyEdit(edit);
}

/**
 * The review, in two gestures.
 *
 * A multi-select pick decides WHICH rows, because a diff cannot express "this
 * one but not that one" and the fold rule needs exactly that: a respelling the
 * product proved is ticked, a guess is not, and the developer moves through
 * them with the space bar. Then the product's own preview-and-confirm gate
 * shows the whole buffer as it would land - the same `ProposalPresenter` every
 * other write in this extension goes through, so there is still exactly one
 * consent gate in the product.
 */
async function defaultReview(
  document: vscode.TextDocument,
  review: TightenReview,
  presenter: ProposalPresenter,
): Promise<readonly number[] | undefined> {
  const notesLine = review.notes.join(" · ");
  // A ZERO-ROW REVIEW SKIPS THE PICK, and this is the real-host half of defect
  // 1. `showQuickPick([])` resolves `undefined` the moment it is shown, and
  // `undefined` is this command's CANCEL - so a comment that only needs
  // re-wrapping would have been cancelled by its own empty menu, in the host,
  // where no headless row can see it. With nothing to tick, the diff IS the
  // whole question.
  if (review.rows.length === 0) {
    const only = await presenter.confirmDiff({
      document,
      previewFullText: review.renderWith([]),
      title: review.title,
      prompt: `Column 80: re-wrap this comment?${notesLine === "" ? "" : ` (${notesLine})`}`,
      acceptLabel: "Apply",
    });
    return only === "accept" ? [] : undefined;
  }
  type Item = vscode.QuickPickItem & { index: number };
  const items: Item[] = review.rows.map((row, index) => ({
    index,
    label: row.kind === "delete" ? `$(trash) ${row.label}` : `$(symbol-class) ${row.label}`,
    description: row.kind === "respell" ? "respelling" : row.kind === "backtick" ? "backtick" : "delete a restatement",
    detail: row.detail,
    picked: row.checked,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: review.title,
    placeHolder: notesLine === "" ? "Space to tick, Enter to preview" : notesLine,
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (picked === undefined) {
    return undefined;
  }
  const accepted = picked.map((p) => p.index);
  const decision = await presenter.confirmDiff({
    document,
    previewFullText: review.renderWith(accepted),
    title: review.title,
    prompt: `Column 80: apply ${accepted.length} change${accepted.length === 1 ? "" : "s"} to this comment?`,
    acceptLabel: "Apply",
  });
  return decision === "accept" ? accepted : undefined;
}

/**
 * The command. MANUAL, and wired to no keystroke: one `resolvePrefill` at
 * roughly 285ms, one model round, and at most `TIGHTEN_QUERY_BUDGET` symbol
 * queries (about 0.2s at the slowest measured provider). Fine for a gesture a
 * developer asks for, indefensible anywhere near a keystroke.
 */
export function registerTightenDocComment(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  wiring: TightenWiring,
  deps: TightenDeps = {},
): void {
  const log = (line: string) => output.appendLine(line);
  context.subscriptions.push(
    vscode.commands.registerCommand(TIGHTEN_COMMAND_ID, async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined) {
        void vscode.window.showWarningMessage("Column 80: no active editor.");
        return;
      }
      try {
        await tightenDocComment(editor.document, editor.selection.active, log, wiring, deps);
      } catch (err) {
        // A refusal is a sentence and a crash is not: this command edits a
        // human's words, so an unexpected throw must still leave the buffer
        // untouched and say so.
        log(`[tighten] failed: ${String(err)}`);
        void vscode.window.showWarningMessage(`Column 80: the tighten gesture failed (${String(err)}); nothing was changed.`);
      }
    }),
  );
}
