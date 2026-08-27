import * as vscode from "vscode";
import * as fs from "fs";
import {
  CompilerOracle,
  Diagnostic,
  OracleCheckResult,
  TestOracleResult,
  oracleFor,
  resolveDiagnosticPath,
  runOracleCheck,
} from "../core/compilerOracle";
// toastText is a leaf that imports nothing, so this edge cannot cycle back
// through fnGen, which registers this surface.
import { oneLineWithPointer } from "./toastText";
// Type only: no runtime edge from this surface to the registry, which is
// constructed in fnGen.ts and passed in.
import type { InFlightClaim } from "./inFlight";
// The one exception, and it is a leaf predicate rather than the registry:
// `isCancellation` is the product's single definition of "this throw was the
// user's own stop", and the covering-test run leg has to tell that apart from a
// runner that could not spawn. A second copy here would be a second definition.
import { isCancellation } from "./inFlight";
// The product's one line-bound definition, for the same reason: the shared
// covering-test runner renders a spawn failure with it.
import { firstLine } from "./toastText";
// The call-hierarchy transport. `callHierarchy.ts` imports vscode and nothing
// else in this layer, so this edge cannot cycle back through fnGen.
import { makeLineReader, makeResolveCallers, prepareCallRoot } from "./callHierarchy";
import { discoverCoveringTests } from "../core/testDiscovery";
import {
  coveringTestPlan,
  discoveredFilters,
  failuresOf,
  outcomesThatDidNotRun,
  runCoveringGroups,
  runTotals,
  withinDiscoveredSet,
} from "../core/coveringTestRun";
import { GroupOutcome } from "../core/runTestsReport";
import { FailureLocation, digestFailures, renderFailureEvidence } from "../core/failureDigest";
import {
  runDelta,
  shapesWithinDiscoveredSet,
  testCheckResult,
  testFailureDiagnostics,
  worseThanBeforeMessage,
} from "../core/testRepairEvidence";
import { CrateResolution } from "../core/compilerDirected";
import { buildResolution } from "../core/crateResolution";
import { fetchMetadataJson, resolveHostTriple } from "../core/catalog";
import { FnGenService } from "../core/fnGenService";
import { isPromptWindowError } from "../core/promptBudget";
import {
  GenerationSource,
  RepairScope,
  RepairSession,
  TestRepairAuthorization,
  assembleRepairPrompt,
  spanScopedMessage,
  spanScopedVerdict,
} from "../core/repair";
import {
  HallucinationClass,
  assembleCsMemberPayload,
  assembleGoMemberPayload,
  assembleLocalSymbolPayload,
  assembleNeedsFeaturePayload,
  assemblePyMemberPayload,
  assembleSurfacePayload,
  assembleTsMemberPayload,
  assembleTsWrongItemPayload,
  classifyCsHallucination,
  classifyGoHallucination,
  classifyHallucination,
  classifyPyHallucination,
  classifyTsHallucination,
  csUnresolvedNameCursor,
  firmInstructionFor,
  harvestDiagnosticTypes,
  pyUnresolvedNameCursor,
  tsUnresolvedNameCursor,
  unresolvedNameCursor,
} from "../core/compilerDirected";
import { DisclosedType, membersOfType, undisclosedMemberRefusal } from "../core/repairGate";
import {
  REFINE_ROUND_CAP,
  RefineBudget,
  RefineTarget,
  assembleRefinePrompt,
  introducedErrors,
  refineTargets,
  usageHeaderFor,
  usageSitesOutsideSpan,
} from "../core/refine";
import { orderSurfaceByRelevance } from "../core/surfaceRelevance";
import { collectUsageWindows, renderUsageSection } from "../core/usageWindows";
import { spanTypesInPlay, stopNamesFor } from "../core/repairTypes";
import { PY_STDLIB_MODULES, pyOwnedImportEdit } from "../core/pyExtraction";
import { placeGeneratedReply } from "../core/placeReply";
import { fenceFor, fileLocalDefinitions } from "../core/instructPostprocess";
import { QualifyEdit, ReferenceLocation, SourceCursor, SurfaceExtractor, renderMemberSignatures, semanticMembers } from "../core/extraction";
import { ContextStop, budgetProfileFor } from "../core/budgetProfile";
import { DerivedType, isRustSysrootDef, parseStructHoverFields, renderDerivedDef } from "../core/crossFileShape";
import { TS_LANGUAGE_IDS, parseTsHoverFields, tsRenderDerivedDef } from "../core/tsExtraction";
import { ContextBlock } from "../core/prompt";
import { CatalogEntry, renderCatalog } from "../core/catalog";
import { FunctionSpan } from "../core/span";
import { fnGenModelClass, injectedContextStop, readOracleConfig } from "./config";
import type { ProposalPresenter } from "./fnGen";
import type { ResolvedFunction } from "./fnGen";

/**
 * Surface-at-edit-site display plus the post-accept oracle flow. This file
 * is the ONLY consumer of oracle results in the vscode layer, and it only
 * ever writes displays. One-way rule: results flow core -> here -> screen;
 * nothing here (or anywhere) reads vscode.languages.getDiagnostics back
 * into the loop, because flycheck runs against unsaved buffers and its
 * flattening drops the spans and suggestions repair needs.
 *
 * Repair execution rides existing paths end to end: prompts go through
 * FnGenService.generateRaw (the same producer-guard pipeline as generate),
 * proposals through ProposalPresenter.present (the same consent gate and
 * the extension's only document write). Deleting this session loop plus
 * src/core/repair.ts leaves check-and-surface fully working.
 *
 * Concurrency: sessions run one at a time (which makes single-flight
 * trivially true), with one pending slot per (language, project root)
 * session key where the newest accept wins. An accept can therefore never
 * abort another session's in-flight model round; a superseded pending
 * accept leaves evidence.
 */

export interface PostAcceptContext {
  document: vscode.TextDocument;
  /** Where the accepted text now sits: resolved span start, plus the
   *  replacement's length. The display anchors here. */
  landedSpan: FunctionSpan;
  source: GenerationSource;
  /** The cancel affordance's registry (roadmap item 67, ruled 2026-08-22). The
   *  progress over these rounds is `withVerifyStatus`, a
   *  ProgressLocation.Window spinner carrying no cancellation token, so a claim
   *  here is the ONLY thing that can stop a hung repair or refine.
   *
   *  Optional, and absent is exactly the pre-phase-5 behaviour: a headless
   *  caller owns no status bar and every call site uses `?.`. */
  inFlight?: { begin(label: string, controller: AbortController): InFlightClaim };
  /** Repair rounds go through this same service: same producer guards,
   *  same splice/preview consent gate, no second insertion route. */
  service: FnGenService;
  output: vscode.OutputChannel;
  /** The one consent gate; injected so this module never grows its own. */
  presenter: ProposalPresenter;
  /** Symbol resolution lives in fnGen.ts; injected to keep the dependency
   *  arrow one-way at runtime (fnGen -> here, types only the other way). */
  resolveFunction: (
    document: vscode.TextDocument,
    position: vscode.Position,
  ) => Promise<ResolvedFunction | undefined>;
  /** Tier gate for repair rounds. The extension's entry points
   *  always pass it, fail-closed (unresolved tier = closed). Closed:
   *  check-and-surface still runs, the session starts disabled, and the
   *  reason lands on the record before any round could start. Absent means
   *  allowed - headless oracle callers own their service and tier. */
  repairTierGate?: { allowed: boolean; reason?: string };
  /** v2 compiler-directed loop. Absent = v1 behaviour exactly (no injection, no
   *  deterministic qualify): every new path here is gated on this being present,
   *  so the frozen v1 repair oracles are byte-for-byte unchanged. When present,
   *  it is the language's registered extractor (extractorFor). */
  extractor?: SurfaceExtractor;
  /** The installed-dependency catalog for the crate, used to steer an
   *  unresolved-crate hallucination to an installed crate.
   *  Absent = no steering; the missing crate is surfaced as add-it-to-Cargo.toml. */
  fetchCatalog?: (crateRoot: string) => Promise<CatalogEntry[]>;
  /** The user's manually-added context blocks, read LIVE at repair-prompt
   *  assembly time - never snapshotted, so a block removed before a queued
   *  round fires cannot reach the prompt. Absent means the repair prompt
   *  carries no context, exactly as before. Every entry point passes the same
   *  shared store's live reader.
   *
   *  ASYNC, and the asynchrony is the feature: the reader
   *  slices each block out of the document as it reads NOW, which means opening
   *  a file no editor has open. A repair round happens later than the
   *  generation that led to it, so "later" is exactly when its blocks should be
   *  read. */
  readContextBlocks?: () => Promise<ContextBlock[]>;
  /** The refine gesture, MANUAL ONLY. Set by
   *  `column80.repairFunction` and by nothing else: an automatic post-accept
   *  check that comes back green still ends at `why=clean`, silently, exactly as
   *  it always has. The human said "if the user initiates the repair command",
   *  and the v22 verdict admitted usage injection into fn-gen only as a user
   *  gesture with visible context, so a silent version would be a
   *  prompt-identity change rather than a tuning choice. Absent or false is the
   *  pre-v29 behaviour byte for byte. */
  manualRefine?: boolean;
  /** The span-surface resolver (`resolvePrefill`, fnGen.ts): the same engine
   *  round-0 generation uses, injected for the same reason `resolveFunction` is
   *  - the runtime dependency arrow runs fnGen -> here, and types only the other
   *  way. Absent means a repair round injects the diagnostic-keyed blocks alone,
   *  which is the pre-v28 behaviour the frozen oracles pin. */
  resolveSpanSurface?: (
    extractor: SurfaceExtractor,
    document: vscode.TextDocument,
    resolved: ResolvedFunction,
    log: (line: string) => void,
    opts: {
      extraCandidates?: readonly string[];
      omitInstruction?: boolean;
      onDisclosed?: (types: DisclosedType[]) => void;
      extraCursors?: ReadonlyMap<string, SourceCursor>;
    },
  ) => Promise<string | undefined>;
  /** The call-owner resolver (`resolveCallOwners`, fnGen.ts). Injected through
   *  the same seam and for the same reason as `resolveSpanSurface`. Absent
   *  means a repair round discloses only the types the span NAMES, which is
   *  the pre-v30 behaviour and the whole defect: the receiver of a chained call
   *  is named nowhere, so its parameter list never reached the prompt and the
   *  model deleted the call it was asked to fix. */
  resolveCallOwners?: (
    extractor: SurfaceExtractor,
    document: vscode.TextDocument,
    targets: readonly RefineTarget[],
    log: (line: string) => void,
    skip?: ReadonlySet<string>,
  ) => Promise<Array<{ member: string; name: string; cursor: SourceCursor }>>;
}

// Display handles created once at activation; undefined means display-less
// (never the case in a running extension, but the flow must not depend on
// registration order to stay safe).
//
// This extension publishes NO diagnostics, and no code here may start. Owning a
// diagnostic means owning its whole lifecycle, including clearing it the moment
// the human fixes the code by hand. A check-scoped publisher cannot do that: it
// only learns anything at the NEXT check on the same root, so its errors strand
// in the Problems panel with nothing able to clear them. The language server
// publishes the same errors and does own that lifecycle. The check speaks
// through the edit-site annotation and the output channel; Problems belongs to
// the compiler.
interface SurfaceDisplay {
  decoration: vscode.TextEditorDecorationType;
}
let display: SurfaceDisplay | undefined;

// Queue entries key on (language, root), not root alone: two languages can share
// one project root (a repo with Cargo.toml and tsconfig.json at the top), and
// language A's accept must never supersede language B's parked check.
function sessionKey(language: string, root: string): string {
  return `${language}\u0000${root}`;
}

// The session queue: one runner, one pending slot per (language, root).
let sessionRunning = false;
const pendingBySession = new Map<string, PostAcceptContext>();

/**
 * Owns the edit-site presentation. Registered once at activation so disposal is
 * tied to the extension host. No DiagnosticCollection: see SurfaceDisplay.
 *
 * The annotation describes a check of the text as it was when the check ran, so
 * the first edit to that document retires it. Without that it is the Problems
 * mirror again in miniature: an error on screen that the human's own fix cannot
 * clear, because the next check needs another accept to happen. What replaces a
 * stale annotation is the language server's own live diagnostics, which is the
 * whole point of not competing with them.
 */
export function registerOracleSurface(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  void output; // evidence flows per-run through runPostAcceptOracle's log
  const decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    after: {
      margin: "0 0 0 2em",
      color: new vscode.ThemeColor("editorCodeLens.foreground"),
    },
  });
  display = { decoration };
  context.subscriptions.push(
    decoration,
    vscode.workspace.onDidChangeTextDocument((event) => clearCheckAnnotation(event.document)),
    {
      dispose: () => {
        display = undefined;
      },
    },
  );
}

/** Drop the check annotation from every editor showing `document`. Cheap and
 *  unconditional: setting an empty range array on an editor that carries no
 *  decoration of this type is a no-op. */
function clearCheckAnnotation(document: vscode.TextDocument): void {
  if (!display) {
    return;
  }
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === document.uri.toString()) {
      editor.setDecorations(display.decoration, []);
    }
  }
}

/**
 * Post-accept entry point for every trigger. Applies the language gate,
 * then either runs the session now or parks it in its session key's
 * pending slot (newest wins). The session itself: save-if-dirty, cargo check, surface,
 * and drive a RepairSession scoped to the accepted function's span.
 * Reads column80.repairEnabled at call time; check-and-surface
 * runs regardless of that setting.
 */
export function runPostAcceptOracle(ctx: PostAcceptContext): Promise<void> {
  return runOrQueue(ctx, false);
}

// drained=true means this context was parked and is being revalidated at
// drain time: its entry-gate failures must log and must NOT strand the
// crates parked behind it; queue liveness never waits for a fresh accept.
async function runOrQueue(ctx: PostAcceptContext, drained: boolean): Promise<void> {
  const log = (line: string) => ctx.output.appendLine(line);
  // Gates every trigger: a document with no registered oracle never spawns
  // a check. Fresh accepts fail this silently (a skip line per inapplicable
  // tab accept would be channel noise); a drained context leaves evidence.
  const oracle = oracleFor(ctx.document.languageId, { log });
  if (!oracle) {
    if (drained) {
      log(`[oracle] check skipped: drained accept has no oracle (${ctx.document.languageId})`);
      drainPending();
    }
    return;
  }
  const crateRoot = oracle.detectCrateRoot(ctx.document.uri.fsPath);
  if (crateRoot === undefined) {
    log(`[oracle] check skipped: no crate root for ${ctx.document.uri.fsPath}`);
    // Everything reaching this flow is a user gesture (an
    // accept or an explicit repair), so a strategy that can DESCRIBE why its
    // oracle half cannot run states the one-line reason on the verdict
    // surface. Strategies without the method (Rust) keep the silent skip.
    surfaceEnvReason(oracle.describeMissingRoot?.(ctx.document.uri.fsPath));
    if (drained) {
      drainPending();
    }
    return;
  }

  if (sessionRunning) {
    // Newest-pending-wins: a rapid re-accept replaces the parked one; the
    // replaced accept's check is subsumed by the newer state of the file,
    // and the supersession lands on the superseded session's own channel.
    const key = sessionKey(oracle.language, crateRoot);
    const superseded = pendingBySession.get(key);
    if (superseded) {
      superseded.output.appendLine(`[oracle] check superseded crate=${crateRoot}`);
    }
    pendingBySession.set(key, ctx);
    log(`[oracle] check queued crate=${crateRoot}`);
    return;
  }

  sessionRunning = true;
  try {
    await executeSession(ctx, oracle, log);
  } finally {
    sessionRunning = false;
    drainPending();
  }
}

// Pop the head parked session and revalidate it. Fire-and-forget like the
// accept handlers: a drained session's failure is its own channel line,
// never the finishing caller's rejection.
function drainPending(): void {
  if (sessionRunning) {
    return;
  }
  const head = pendingBySession.entries().next();
  if (head.done) {
    return;
  }
  const [nextKey, nextCtx] = head.value;
  pendingBySession.delete(nextKey);
  void runOrQueue(nextCtx, true).catch((err) =>
    nextCtx.output.appendLine(`[oracle] post-accept hook failed: ${String(err)}`),
  );
}

// One line on the status bar (a verdict surface, auto-dismissing - never a
// modal, never a panel), stating why an explicit gesture's oracle half could
// not run. The output channel keeps the detailed record. Guarded for
// headless stubs.
function surfaceEnvReason(reason: string | undefined): void {
  if (reason !== undefined && typeof vscode.window.setStatusBarMessage === "function") {
    vscode.window.setStatusBarMessage(`Column 80: ${reason}`, 8000);
  }
}

async function executeSession(
  ctx: PostAcceptContext,
  oracle: CompilerOracle,
  log: (line: string) => void,
): Promise<void> {
  // The strategy's own path resolution, threaded to every place a span
  // fileName becomes an absolute path, so a second language's session
  // resolves paths its toolchain's way (never the Cargo anchor walk).
  const resolvePath = (root: string, fileName: string) => oracle.resolveDiagnosticPath(root, fileName);
  // cargo reads disk; checking a stale buffer would be the flycheck sin in
  // new clothes. A failed save throws into the caller's catch line. Only
  // THIS document is saved: other dirty files in the crate are checked as
  // they sit on disk (named residual in the surface).
  if (ctx.document.isDirty && !(await ctx.document.save())) {
    throw new Error(`could not save ${ctx.document.uri.fsPath} before the check`);
  }

  const filePath = ctx.document.uri.fsPath;
  let check = await runOracleCheck(oracle, filePath, { log, envReason: surfaceEnvReason });
  if (!check) {
    return; // outside any crate or not an input: skip already logged (and
    // surfaced, where the strategy describes the env reason)
  }
  surfaceCheck(ctx, check, oracle);

  // The file's own definitions, so an unresolved import
  // whose leaf is a same-file type classifies as local-symbol (drop the import)
  // instead of wrong-item (which would inject the external crate's surface and
  // amplify the hallucination). Stable across repair rounds - a body rewrite
  // never adds/removes a module-scope definition - so it is computed once here.
  const localDefs = fileLocalDefinitions(ctx.document.getText());

  // The E0433 feature-graph resolution, built once per session and only when
  // an E0433 `cannot find X in Y` is present (the disambiguation's trigger), so
  // the metadata cost is paid only when it can change a verdict. Gated on the
  // extractor like every other surface path.
  let resolution: CrateResolution | undefined;
  if (ctx.extractor && check.diagnostics.some(isPotentialNeedsFeature)) {
    resolution = await buildCrateResolution(check.crateRoot, log);
  }

  // Diagnostic trace: exactly what the checker reported and how each error
  // classifies, so a run that behaves unexpectedly is self-explanatory on the
  // channel. The classifier is the language's own (the per-language seam).
  const classify = repairLangFor(ctx.document.languageId).classify;
  if (!check.success) {
    for (const d of check.diagnostics.filter((e) => e.level === "error")) {
      const cls = classify(d, resolution, localDefs);
      const primary = d.spans.find((s) => s.isPrimary);
      const where = primary ? resolvePath(check.crateRoot, primary.fileName) : "-";
      log(`[oracle] error ${d.code ?? "-"} class=${cls?.kind ?? "none"} file=${where === filePath ? "target" : where}: ${d.message.slice(0, 70)}`);
    }
  }

  // needs-a-feature is TERMINAL steering, not a repair round. The path exists
  // but its Cargo.toml feature is off - a fix the model structurally cannot make
  // (it is a manifest edit outside any function span). Surface
  // "enable feature X on crate Y" to the human rather than spending a repair round
  // the model would only fail. Scoped to the touched file so an unrelated
  // pre-existing gated import never stops repair of this generation.
  if (resolution !== undefined) {
    const needsFeature: Array<{ crate: string; module: string; feature: string }> = [];
    const seen = new Set<string>();
    for (const d of check.diagnostics) {
      if (d.level !== "error") {
        continue;
      }
      const primary = d.spans.find((s) => s.isPrimary);
      if (!primary || resolvePath(check.crateRoot, primary.fileName) !== filePath) {
        continue;
      }
      const cls = classifyHallucination(d, resolution, localDefs);
      if (cls?.kind === "needs-feature" && !seen.has(`${cls.crate}::${cls.module}`)) {
        seen.add(`${cls.crate}::${cls.module}`);
        needsFeature.push({ crate: cls.crate, module: cls.module, feature: cls.feature });
      }
    }
    if (needsFeature.length > 0) {
      const human = needsFeature
        .map((f) => `enable feature \`${f.feature}\` on \`${f.crate}\` (for \`${f.crate}::${f.module}\`)`)
        .join("; ");
      log(
        `[repair] needs-feature ${needsFeature.map((f) => `${f.crate}::${f.module}->${f.feature}`).join(",")}; ` +
          `terminal, no repair round`,
      );
      if (typeof vscode.window.setStatusBarMessage === "function") {
        vscode.window.setStatusBarMessage(`Column 80: ${human}, then regenerate`, 8000);
      }
      return;
    }
  }

  // Detect a crate the generation reached for that is not a dependency. The
  // catalog (installed crates) is resolved here; whether it can STEER (inject
  // into a repair round) depends on the crate error landing in the accepted
  // function, which is only known after the session's first decision below.
  let missingCrates: string[] = [];
  let catalogSurface: string | undefined;
  if (ctx.extractor) {
    missingCrates = documentMissingCrates(check.diagnostics, filePath, check.crateRoot, resolvePath);
    log(`[repair] missing-crate scan: ${missingCrates.length ? missingCrates.join(",") : "none"}`);
    if (missingCrates.length > 0 && ctx.fetchCatalog) {
      const catalog = renderCatalog(await ctx.fetchCatalog(check.crateRoot));
      if (catalog) {
        catalogSurface = catalog;
      }
    }
  }

  // Tier gate before any session mechanics: a closed gate disables repair
  // exactly like repairEnabled=false (same why=disabled surface, zero
  // model calls) with its own reason line first - "ends pre-generateRaw
  // with a logged reason" is this ordering.
  const gateClosed = ctx.repairTierGate !== undefined && !ctx.repairTierGate.allowed;
  if (gateClosed) {
    log(`[repair] gate closed reason=${ctx.repairTierGate?.reason ?? "unknown"}`);
  }
  const session = new RepairSession(
    ctx.source,
    !gateClosed && readOracleConfig().repairEnabled,
    log,
    { assertionShaped: (d) => oracle.isAssertionShaped(d) },
  );
  // The service's own tag, not the base settings': on tiers where applyTier
  // swapped the model, evidence must name the model that serves the rounds.
  const modelTag = ctx.service.modelTag;

  // Scope every decision to the accepted function: a FIM accept's landed
  // span is the completion, so the enclosing function is resolved first;
  // when nothing resolves the landed span itself is the scope, which keeps
  // unrelated pre-existing errors out of the model's reach either way.
  let resolved = await ctx.resolveFunction(
    ctx.document,
    ctx.document.positionAt(ctx.landedSpan.start),
  );
  let scope = byteScope(ctx.document, filePath, check.crateRoot, resolved?.span ?? ctx.landedSpan, resolvePath);
  if (resolved) {
    // Evidence for diagnosing splice surprises: the exact 1-based line range the
    // repair/qualify will replace. A range that starts above the declaration
    // head means a doc-comment or attribute is being swept into the span.
    const s = ctx.document.positionAt(resolved.span.start).line + 1;
    const e = ctx.document.positionAt(resolved.span.end).line + 1;
    log(`[repair] resolved fn=${resolved.symbolName} spanLines=${s}-${e}`);
  }

  // Deterministic pass: a missing-but-resolvable import is the compiler's to
  // fix, not the model's. Qualify such names in-span through the same consent
  // gate, re-checking after each, WITHOUT spending a repair round. Gated on the
  // extractor, so v1 behaviour is exactly unchanged when it is absent.
  if (ctx.extractor) {
    const qualified = await runQualifyPass(ctx, oracle, ctx.extractor, check, resolved, filePath, log);
    if (qualified) {
      check = qualified.check;
      resolved = qualified.resolved;
      scope = byteScope(ctx.document, filePath, check.crateRoot, resolved?.span ?? ctx.landedSpan, resolvePath);
    }
  }

  let action = session.next(check, scope);

  // A missing crate is steerable only when it is an ELIGIBLE (in-function)
  // error the catalog can be injected against. When it is not - the catalog is
  // empty (nothing installed to steer to), or the crate error landed OUTSIDE the
  // accepted function (a duplicated main, the de-risk's case) - the model cannot
  // fix it, so surface "add it to Cargo.toml" and stop rather than run a futile
  // round (or, worse, silently do nothing).
  if (missingCrates.length > 0) {
    const steerable =
      catalogSurface !== undefined &&
      action.kind === "repair" &&
      action.eligible.some((d) => classifyHallucination(d)?.kind === "unresolved-crate");
    if (!steerable) {
      const list = missingCrates.map((c) => `\`${c}\``).join(", ");
      log(`[repair] missing dependency ${missingCrates.join(",")} not steerable (catalog=${catalogSurface ? "present" : "empty"}); surfaced, no repair round`);
      void vscode.window.showWarningMessage(
        `Column 80: the generated code uses ${list}, which ${missingCrates.length > 1 ? "are" : "is"} not a dependency. Add ${missingCrates.length > 1 ? "them" : "it"} to Cargo.toml, then regenerate.`,
      );
      return;
    }
    log(`[repair] unresolved crate ${missingCrates.join(",")}; steering with the installed-crate catalog`);
  }

  while (action.kind === "repair") {
    const round = action.round;
    // Exactly one outcome line per executed round, on every exit path.
    const outcome = (result: string) => log(`[repair] outcome round=${round} result=${result}`);

    if (!resolved) {
      // The round was already consumed (abandoned rounds count, the
      // conservative direction for a hard cap); diagnostics stay surfaced.
      outcome("aborted");
      return;
    }
    const versionAtResolve = ctx.document.version;
    const code = ctx.document.getText(
      new vscode.Range(
        ctx.document.positionAt(resolved.span.start),
        ctx.document.positionAt(resolved.span.end),
      ),
    );
    // What the round is allowed to see. Two legs, in this order:
    //
    // 1. the SPAN's types-in-play, resolved through the pre-fill engine (the
    //    instruct-shaped sibling of the FIM whole-block leg, same cross-file
    //    resolver). Disclosure follows the question: the model is asked to
    //    repair this span, so the span's types are what it needs, not the one
    //    type this round's diagnostic happens to name;
    // 2. the diagnostic-keyed blocks, minus any type leg 1 already disclosed.
    //
    // Closed by ONE firm instruction naming every type that rendered. An
    // instruction scoped to one type while another type's block sits above it is
    // the exact shape that made the model rewrite the human's intent rather than
    // name a member it could not see (goal.md capture A).
    let surface: string | undefined;
    let usage: string[] = [];
    let terminalSteer = false;
    const disclosed: DisclosedType[] = [];
    if (ctx.extractor) {
      const diagnosticTypes: string[] = [];
      // The operand pairs, kept apart from the rest: they are what the steer
      // below asks the resolved graph about.
      const operandTypes: string[] = [];
      // The receiver an ARITY diagnostic named outright. Kept apart from the
      // rest because it enters at a different PRIORITY: it is the owner of the
      // failing call, exactly what the call-owner leg spends two round trips
      // resolving, and the compiler handed it over for free. Taken with the
      // owners rather than with `diagnosticTypes`, which are taken last and
      // measured to be evicted by `PREFILL_TYPE_CAP` in five of six
      // configurations - so the "cheaper route, no round trip" the goal claims
      // for C# bought nothing until this.
      const arityReceivers: string[] = [];
      for (const d of action.eligible) {
        const cls = classify(d, resolution, localDefs);
        if (cls?.kind === "arity-mismatch" && cls.type !== undefined) {
          if (!arityReceivers.includes(cls.type)) {
            arityReceivers.push(cls.type);
          }
        }
        if (cls?.kind === "operand-mismatch") {
          diagnosticTypes.push(...cls.types);
          for (const t of cls.types) {
            if (!operandTypes.includes(t)) {
              operandTypes.push(t);
            }
          }
        } else if (cls && "type" in cls && cls.type !== undefined) {
          // The arity class carries its type OPTIONALLY: C# and Go print the
          // whole signature and name the receiver, Rust, TypeScript and pyright
          // name nothing. An absent type contributes nothing rather than the
          // string "undefined".
          diagnosticTypes.push(cls.type);
        }
      }
      const spanTypes = spanTypesInPlay({
        languageId: resolved.languageId,
        signature: resolved.signature,
        docComment: resolved.docComment,
        code,
        diagnosticTypes,
        // The target is never its own collaborator. Raw, as the symbol provider
        // spells it: the reader reduces it per language.
        excludeName: resolved.symbolName,
      });
      // The fifth source: the types that OWN the member calls the span makes.
      // Everything the span NAMES is above; a call's receiver is named nowhere,
      // and in the capture that is exactly the type whose parameter list the
      // round needed.
      //
      // Ordered by proximity to the first eligible diagnostic, because budget
      // spent nearest the error is budget spent well and because the scout
      // measured that document order never puts the failing call first.
      const { targets: callTargets, anchor } = roundCallTargets(ctx, resolved, code, action.eligible);
      // The compiler-named receivers first: they cost nothing and they are the
      // same fact the resolve leg below is about to pay for. Then the resolved
      // owners, then the types the span names.
      const arityStop = stopNamesFor(resolved.languageId);
      const named = arityReceivers.filter((t) => !arityStop.has(t) && /^[A-Z]/.test(t));
      const callOwners = await resolveOwnersForRound(
        ctx,
        callTargets,
        anchor,
        new Set([...named, ...spanTypes]),
        log,
      );
      const ownerCursors = new Map<string, SourceCursor>(callOwners.map((o) => [o.name, o.cursor]));
      const allTypes = [...named, ...callOwners.map((o) => o.name), ...spanTypes].filter(
        (t, i, all) => all.indexOf(t) === i,
      );
      if (named.length > 0) {
        log(`[repair] call receiver named by the compiler, no resolve spent: ${named.join(", ")}`);
      }
      log(
        `[repair] span types-in-play: ${allTypes.length > 0 ? allTypes.join(", ") : "none named by the span"}` +
          `${callOwners.length > 0 ? ` (${callOwners.map((o) => `${o.name} owns ${o.member}`).join(", ")})` : ""}` +
          `; the receiver, doc and imports are mined by the resolver either way`,
      );
      const startedResolve = Date.now();
      // The pre-fill engine logs under its own `[fngen] pre-fill` tag: the same
      // engine really is running, and renaming its lines per caller would make
      // one subsystem answer to two names on the channel. These `[repair]` lines
      // bracket it.
      //
      // Run it even when the span names no type of its own: the engine mines the
      // receiver, the doc and the imports too, and a span that names nothing is
      // exactly the span that has nothing else to offer the model.
      const spanSurface =
        ctx.resolveSpanSurface !== undefined
          ? await ctx.resolveSpanSurface(ctx.extractor, ctx.document, resolved, log, {
              extraCandidates: allTypes,
              omitInstruction: true,
              onDisclosed: (types) => disclosed.push(...types),
              extraCursors: ownerCursors,
            })
          : undefined;
      const skipTypes = new Set(disclosed.map((d) => d.name));
      log(
        `[repair] span surface: injected types=${skipTypes.size}` +
          `${skipTypes.size > 0 ? ` (${[...skipTypes].join(", ")})` : " (nothing resolved)"}` +
          ` ms=${Date.now() - startedResolve}`,
      );
      const diagSurface = await resolveSurfaceInjection(
        ctx.extractor,
        ctx.document,
        action.eligible,
        log,
        catalogSurface,
        resolution,
        localDefs,
        {
          skipTypes,
          omitInstruction: true,
          onDisclosed: (types) => {
            for (const t of types) {
              if (!disclosed.some((d) => d.name === t.name)) {
                disclosed.push(t);
              }
            }
          },
          onTerminalSteer: () => {
            terminalSteer = true;
          },
        },
      );
      if (terminalSteer) {
        // The catalog and the enable-this-feature message are injected ALONE,
        // by their own contract: until the crate is a dependency its methods
        // cannot resolve, and a manifest edit is not an API the model got wrong.
        // A member surface above either one is noise, and a call-only-these
        // instruction below it points at names that cannot compile yet.
        log(`[repair] terminal steer: injected alone, the span surface is dropped for this round`);
        surface = diagSurface;
        disclosed.length = 0;
      } else {
        // The operand-mismatch steer. Disclosure alone was measured insufficient
        // here: given CS0019 naming both operand types, plus the whole member
        // list of each, the model returned its input unchanged ten runs out of
        // ten. That run's own file did not survive the session it was made in, so
        // this comment is its only record; the surviving evidence for the same
        // thesis is in docs/architecture/compiler-oracle.md, "Disclosure alone is
        // not enough". What it was never told is
        // which member in scope answers the type the compiler named, and that is
        // a fact the resolved graph already holds.
        const steers: string[] = [];
        for (const t of operandTypes) {
          const answering = membersOfType(disclosed, t);
          if (answering.length > 0) {
            steers.push(`Members in scope whose type is \`${t}\`: ${answering.join(", ")}.`);
          }
        }
        if (steers.length > 0) {
          log(`[repair] operand steer: ${steers.join(" ")}`);
        }
        const parts = [spanSurface, diagSurface, ...steers].filter((p): p is string => p !== undefined && p !== "");
        if (parts.length > 0) {
          const combined = parts.join("\n\n");
          // The instruction governs an injected API SURFACE. A payload of only
          // steers (a local-symbol drop-the-import) discloses no type, and
          // closing it with a call-only-these instruction would point at a
          // surface that is not there.
          surface = disclosed.length > 0 ? `${combined}\n\n${firmInstructionFor(disclosed.map((d) => d.name))}` : combined;
        }
      }
      // The usage leg. Last of the resolvers, because it is the one whose
      // budget is spent against a prompt the surface legs have already filled,
      // and because a terminal steer must not carry examples of calling a crate
      // that is not a dependency yet.
      if (!terminalSteer && readOracleConfig().repairUsageWindows) {
        usage = await resolveUsageForRound(ctx, resolved, callTargets, log);
      }
    }
    // Read LIVE, once per round, and held so the SAME bytes reach the prompt
    // and the transport. A backend that caches the block head keys on those
    // bytes, so a second read here could hand it a head the prompt does not
    // actually start with.
    const repairBlocks = await ctx.readContextBlocks?.();
    const prompt = assembleRepairPrompt({
      languageId: resolved.languageId,
      docComment: resolved.docComment,
      code,
      diagnostics: action.eligible,
      surface,
      usage,
      // A struct/enum target gets a type-shaped repair instruction; a
      // function (kind undefined for a v1-shaped resolver) keeps v1 bytes.
      kind: resolved.kind,
      // Python Fork A: the code is the BODY (the span excludes the preserved
      // docstring), so the repair asks for a corrected body, never a whole
      // definition that would duplicate the header into the body-only span.
      bodyOnly: resolved.bodyOnly,
      // The column this span was cut from, so the 0-based normalisation is
      // exact instead of inferred. It is the SAME value handed to
      // placeGeneratedReply below, which is the point: one number decides both
      // directions, so they cannot disagree about where the code sits.
      //
      // `?? ""` for the same reason the placement leg has it, and the two must
      // agree or the claim above is false: `resolveFunction` is an INJECTED
      // hook, so a record built outside fnGen can arrive with neither field.
      // Undefined here does NOT mean "infer" - it means "do not shift", exactly
      // as it does on the way back. Left raw, the dedent would infer and strip
      // while the placement did nothing, and the two directions would disagree
      // precisely where the comment promises they cannot (review D2).
      spanIndent: (resolved.bodyOnly ? resolved.bodyIndent : resolved.headerIndent) ?? "",
      // The DOC's column, separately from the code's. A bodyOnly target is
      // Python Fork A, whose docstring `stripPyDocstring` already returned
      // 0-based; stripping the body's column again eats its prose, and in
      // Fork A the docstring IS the spec (review D2).
      docIndent: resolved.bodyOnly ? "" : resolved.headerIndent ?? "",
      // Read LIVE, once per round: the user's staged context reaches the repair
      // the same way it reaches generation. A block removed since the accept is
      // gone from this read, so it never lands in the prompt.
      contextBlocks: repairBlocks,
    });
    log(
      `[repair] round ${round}/2 model=${modelTag} route=${action.route}${surface ? " surface=injected" : ""}` +
        `${usage.length > 0 ? ` usage=${usage.length} section(s)` : ""}`,
    );

    // The ONLY thing that can stop this round. The progress over it is
    // `withVerifyStatus`, a ProgressLocation.Window spinner with no
    // cancellation token, so before the claim a repair against a hung server
    // could not be cancelled at all: the spinner spun, the status bar was
    // empty, and the cancel command said "nothing in flight". Roadmap
    // item 67's ruling replaced the watchdog with cancellation, and this is the
    // path a user reaches by ACCEPTING a generation.
    const controller = new AbortController();
    const claim = ctx.inFlight?.begin(`Repairing ${resolved.symbolName}`, controller);
    let result;
    try {
      result = await ctx.service.generateRaw(prompt, {
        docComment: resolved.docComment,
        signature: resolved.signature,
        span: resolved.span,
        // The prompt asked for a BODY, so the service must not hold the reply to
        // a declaration head it was told not to write. Without this the trim
        // rejects every obedient reply and a Python docstring target can never
        // repair at all.
        bodyOnly: resolved.bodyOnly,
        // The blocks this prompt LEADS with. A repair re-sends the user's
        // context by construction, so it should hit the checkpoint the
        // generation before it already paid for rather than build a second one.
        contextBlocks: repairBlocks,
      }, controller.signal);
    } catch (err) {
      // A WINDOW REFUSAL IS NOT A FAILURE (adversarial review D1). Nothing
      // broke: the prompt did not fit and no model was called. A repair prompt
      // carries the diagnostics, the code, the injected surface AND the
      // developer's context blocks, so it is one of the fattest prompts the
      // product builds - and until now it was one of the three that never
      // checked. The developer gets the sentence, not just a channel line;
      // otherwise the repair simply appears to do nothing.
      if (isPromptWindowError(err)) {
        void vscode.window.showWarningMessage(err.message);
        outcome("failed");
        return;
      }
      // The service already logged the failure detail ([fngen] request
      // failed); the session ends, remaining diagnostics stay surfaced.
      outcome("failed");
      return;
    } finally {
      // Released the instant the MODEL CALL settles, not at the end of the
      // round: the placement and preview after it are local work, and an item
      // that stayed up for them would say "still talking to the server" when
      // nothing is.
      claim?.release();
    }
    if (!result) {
      // An abort lands here, because the service returns undefined on a
      // cancelled round rather than throwing. No toast: cancelling is the
      // user's own action.
      outcome("aborted");
      return;
    }

    // Place the corrected reply at the target's column before it is spliced back,
    // through the same dispatcher generation uses (placeReply.ts). Repair needs
    // this as much as generation: the splice replaces the same span, so without
    // it the brace lands at column 0 and the body one level short (goal.md
    // "broken indentation").
    result.text = placeGeneratedReply(result.text, {
      // `resolved.languageId`, NOT the document's. The dedent above keyed off
      // the resolved record; a document whose languageId differs from it would
      // dedent through one language's scanner and re-indent through another's,
      // and the inverse property the pair rests on would not hold (review D2).
      languageId: resolved.languageId ?? ctx.document.languageId,
      bodyOnly: resolved.bodyOnly,
      // resolveFunction is an INJECTED hook, so a record built outside fnGen can
      // arrive without these. Missing means "do not shift", never "prepend the
      // word undefined to every line".
      headerIndent: resolved.headerIndent ?? "",
      bodyIndent: resolved.bodyIndent ?? "",
    });

    // A repair that only reshuffles whitespace fixed nothing - it happens when
    // the model cannot actually fix the error (a missing Cargo.toml feature, an
    // unfixable path) and regenerates a near-identical body. Proposing it is a
    // pointless diff (the "blank line" surprise). Skip it and surface instead.
    if (isNoOpRepair(code, result.text)) {
      log(`[repair] round ${round} made no meaningful change; not proposed`);
      outcome("no-change");
      return;
    }

    // The output gate, where a surface was injected. The FIM leg has judged its
    // ghost against the resolved member set since v18; repair output faced only
    // the compiler, which is how an invented member survived a round cap and
    // stayed in the human's file. Refuses on resolved evidence only: a type
    // whose member list was truncated refuses nothing, and no receiver's type is
    // ever guessed.
    const refusal = undisclosedMemberRefusal(result.text, disclosed);
    if (refusal !== undefined) {
      log(`[repair] round ${round} refused: ${refusal}`);
      outcome("refused");
      // Back to the table, not out of the session. The round is spent (an
      // abandoned round counts, which is the cap's conservative direction), but
      // the buffer is unchanged, so the next decision is made against the same
      // check: the cap decides whether another round runs, and when it does not,
      // the give-up path below still tells the human what is left in their file.
      // Returning here instead ate the remaining round AND said nothing, which
      // made a false refusal strictly worse than no gate at all.
      action = session.next(check, scope);
      continue;
    }

    // A FIM-sourced session is background work the user never invoked: its
    // system discard (the version race lost to the user's own typing) goes to
    // the channel, not a toast. Explicit-gesture sessions keep the presenter's
    // warning toast. Roadmap item 64, mechanical half.
    const fnName = resolved.symbolName;
    let discardWhy: string | undefined;
    const proposal = await ctx.presenter.present({
      document: ctx.document,
      span: resolved.span,
      versionAtResolve,
      title: `${fnName}: repair round ${round} (preview)`,
      text: result.text,
      service: ctx.service,
      onSystemDiscard:
        ctx.source === "fim"
          ? (why) => {
              discardWhy = why;
              log(`[repair] round ${round} proposal for ${fnName} discarded — ${why} (background fim session: no toast)`);
            }
          : undefined,
    });
    if (proposal === "discarded") {
      // The outcome log says "discarded"; result=rejected here contradicted
      // it (witnessed live, item 64). A human reject stays "rejected" below.
      outcome(discardWhy === undefined ? "discarded" : `discarded (${discardWhy})`);
      return;
    }
    if (proposal !== "accept") {
      outcome("rejected");
      return;
    }

    // Wave semantics: re-check after every executed splice; never assume a
    // fixed diagnostic means a clean crate. A save or re-check failure is
    // still a round outcome before it becomes the caller's error.
    if (ctx.document.isDirty && !(await ctx.document.save())) {
      outcome("failed");
      throw new Error(`could not save ${ctx.document.uri.fsPath} before the re-check`);
    }
    try {
      check = await runOracleCheck(oracle, filePath, { log, envReason: surfaceEnvReason });
    } catch (err) {
      outcome("failed");
      throw err;
    }
    if (!check) {
      outcome("failed");
      return;
    }
    surfaceCheck(ctx, check, oracle);
    const errorsRemain = check.diagnostics.filter((d) => d.level === "error").length;
    outcome(errorsRemain === 0 ? "clean" : `errors-remain=${errorsRemain}`);

    // The splice moved bytes: re-resolve so the next decision's scope is
    // the repaired function as it sits now. The function head is a stable
    // anchor across body rewrites.
    const anchorStart = resolved.span.start;
    resolved = await ctx.resolveFunction(ctx.document, ctx.document.positionAt(anchorStart));
    scope = byteScope(ctx.document, filePath, check.crateRoot, resolved?.span ?? ctx.landedSpan, resolvePath);
    action = session.next(check, scope);
  }
  // action.kind === "surface": the session logged its why line; the last
  // surfaceCheck call already put the final diagnostics on screen.

  // The refine branch of that same decision. `why=clean` on a MANUAL repair
  // gesture is the human asking for something the compiler cannot give them:
  // the code is correct and reads wrong. Everything else about the session is
  // over by here - the RepairSession is finished, so no refine can reach a
  // repair round, and the refine's own budget is separate by construction.
  //
  // roundsUsed === 0 is deliberate. A repair round that succeeded also ends at
  // `clean`, and stacking a style rewrite on top of a fix the human just
  // accepted is a second proposal they did not ask for.
  if (ctx.manualRefine === true && action.why === "clean" && session.roundsUsed === 0) {
    // A gesture that decided to do nothing owes a line. On a clean build
    // `RepairSession.next` surfaces before it ever consults `enabled`, so
    // neither the `why=disabled` line nor the gate line ties itself to the
    // refine, and the human who switched repair off and pressed the command got
    // no word about it at all.
    if (gateClosed) {
      log("[repair] the test leg and the refine are both skipped: the hardware tier gate is closed, so no model round can run");
    } else if (!readOracleConfig().repairEnabled) {
      log("[repair] the test leg and the refine are both skipped: column80.repairEnabled is off, and both ride that switch");
    } else {
      // THE TEST LEG EVALUATES FIRST. `runRefine`'s own comment gives its reason
      // as nothing else having had work to do, and red covering tests are work
      // to do, so the refine keeps exactly the case where the tests passed, none
      // were found, or the leg did not run.
      const leg = await runTestLeg(
        ctx,
        oracle,
        log,
        resolved,
        filePath,
        check.crateRoot,
        modelTag,
        !gateClosed && readOracleConfig().repairEnabled,
        resolvePath,
      );
      if (leg === "not-run") {
        await runRefine(ctx, oracle, log, resolved, check, filePath, modelTag);
      }
    }
  } else if (ctx.manualRefine === true && action.why === "clean" && session.roundsUsed > 0) {
    // The guard above stays `roundsUsed === 0` deliberately: the test leg fires
    // only when the compile was ALREADY CLEAN when the gesture ran, which is the
    // ruled flow (fn-gen, the automatic compiler repair, then the developer
    // presses Repair Function on code that now compiles). It also holds the
    // total model calls for one gesture at invariant 4's two, because the test
    // leg runs its own `RepairSession` with its own cap.
    //
    // Said rather than silently skipped: from where the developer sits, a press
    // that ran a compiler round and then did nothing else is indistinguishable
    // from a press that did nothing at all.
    log(
      `[tests] the covering tests were not run: this press spent ${session.roundsUsed} compiler repair round(s)` +
        ` getting the build clean. Press Repair Function again to run them against the code as it stands now.`,
    );
  }

  // The give-up. The rounds ran out (route-exhausted) or hit the cap
  // (cap-exhausted) with errors still in the buffer, which is the one surface
  // outcome that leaves the human holding broken code. In the capture it said
  // nothing and the human found it by reading the file, so it now says how many
  // errors remain and what the first one is. Every other why is silent by
  // design: "clean" is success, "disabled" is the human's own setting, and the
  // no-eligible reasons mean the errors were never this loop's to fix.
  if (action.why === "route-exhausted" || action.why === "cap-exhausted") {
    const errors = action.diagnostics.filter((d) => d.level === "error");
    if (errors.length > 0) {
      const first = errors[0];
      const code = first.code ? `${first.code}: ` : "";
      // The channel gets the diagnostic WHOLE, and this line is new: the
      // give-up path had no channel record of the message it was about to put
      // in a notification, so the pointer below would have promised something
      // that was not there (roadmap item 69, second shape).
      log(`[repair] give-up why=${action.why} errors=${errors.length} first=${first.code ?? "-"}\n${first.message}`);
      void vscode.window.showWarningMessage(
        oneLineWithPointer(
          `Column 80: repair stopped with ${errors.length} error${errors.length === 1 ? "" : "s"} still in ` +
            `${resolved?.symbolName ?? "the generated code"}. First: ${code}${first.message}`,
        ),
      );
    }
  }

  // Span-scoped success verdict. The crate-wide check.success is
  // left exactly as cargo reported it - this scopes only the message the human
  // reads. When the crate is not green but no error landed inside the touched
  // span, one unrelated broken file must not read as a failed generation. Green
  // crates and in-span errors are v1-unchanged (spanScopedMessage returns
  // undefined for both).
  //
  // Surfacing is deliberately non-intrusive: the [oracle] line is the durable
  // record, and the human-facing note is an auto-dismissing status-bar message,
  // never a notification popup. This targets a persistently-broken crate, so a
  // popup per accept would break the design thread (persona gate).
  if (!check.success) {
    const verdict = spanScopedVerdict(check.diagnostics, scope);
    if (verdict.kind === "clean-out-of-span") {
      const symbol = resolved?.symbolName;
      const files = verdict.outOfSpanFiles.map((f) => f.split(/[\\/]/).pop()).join(",");
      log(`[oracle] span-scoped clean symbol=${symbol ?? "-"} out-of-span=${verdict.outOfSpan.length} files=${files || "-"}`);
      const message = spanScopedMessage(verdict, symbol);
      // Defensive for headless stubs that do not implement setStatusBarMessage.
      if (message && typeof vscode.window.setStatusBarMessage === "function") {
        vscode.window.setStatusBarMessage(`Column 80: ${message}`, 8000);
      }
    }
  }
}

/**
 * The call-owner leg of a repair round.
 *
 * `refineTargets` already finds every member call in a span with document
 * coordinates, over comment- and string-masked text, with the junk sets applied.
 * It is reused rather than reimplemented, so a repair round and a refine round
 * of the same span can never disagree about which calls the span makes.
 *
 * The ANCHOR is the first eligible diagnostic's primary span. It reorders the
 * targets so the call the error is inside comes first; without it the order is
 * document order, and the scout measured that the failing call is never first in
 * any of the five languages.
 *
 * Returns [] and says why on the channel whenever anything is missing: no
 * resolver hook, no extractor, no targets, no owner. Never throws.
 */
function roundCallTargets(
  ctx: PostAcceptContext,
  resolved: ResolvedFunction,
  code: string,
  eligible: readonly Diagnostic[],
): { targets: RefineTarget[]; anchor?: { line: number; character: number } } {
  const spanStart = ctx.document.positionAt(resolved.span.start);
  const spanEnd = ctx.document.positionAt(resolved.span.end);
  // The first eligible diagnostic whose primary span lands INSIDE the span being
  // repaired. Eligibility admits a diagnostic when SOME primary is in scope
  // (`classifyEligibility`, src/core/repair.ts), and a diagnostic can carry more
  // than one, so taking the first primary unconditionally would convert
  // coordinates from another file into this span's and order the targets by a
  // position that means nothing here. A round with no in-span primary falls back
  // to document order rather than guessing.
  let anchor: { line: number; character: number } | undefined;
  for (const d of eligible) {
    for (const s of d.spans) {
      if (!s.isPrimary) {
        continue;
      }
      const line = s.lineStart - 1;
      if (line >= spanStart.line && line <= spanEnd.line) {
        anchor = { line, character: s.columnStart - 1 };
        break;
      }
    }
    if (anchor) {
      break;
    }
  }
  return {
    anchor,
    targets: refineTargets({
      languageId: resolved.languageId,
      code,
      spanStartLine: spanStart.line,
      spanStartCharacter: spanStart.character,
      signature: resolved.signature,
      docComment: resolved.docComment,
      max: REFINE_TARGET_CAP,
      anchor,
      excludeName: resolved.symbolName,
    }),
  };
}

async function resolveOwnersForRound(
  ctx: PostAcceptContext,
  targets: readonly RefineTarget[],
  anchor: { line: number; character: number } | undefined,
  skip: ReadonlySet<string>,
  log: (line: string) => void,
): Promise<Array<{ member: string; name: string; cursor: SourceCursor }>> {
  if (ctx.resolveCallOwners === undefined || ctx.extractor === undefined) {
    return [];
  }
  const calls = targets.filter((t) => t.via === "member");
  if (calls.length === 0) {
    log(`[repair] call owners: the span makes no member call, so there is no receiver to disclose`);
    return [];
  }
  const started = Date.now();
  let owners: Array<{ member: string; name: string; cursor: SourceCursor }>;
  try {
    owners = await ctx.resolveCallOwners(ctx.extractor, ctx.document, targets, log, skip);
  } catch {
    log(`[repair] call owners: the resolver failed; the round runs on the types the span names`);
    return [];
  }
  log(
    `[repair] call owners: calls=${calls.map((c) => c.name).join(", ")}` +
      ` (ordered by ${anchor ? "proximity to the first eligible diagnostic" : "document order, no diagnostic carried a span"})` +
      ` resolved=${owners.length > 0 ? owners.map((o) => `${o.member} -> ${o.name}`).join(", ") : "none"}` +
      ` ms=${Date.now() - started}`,
  );
  return owners;
}

/**
 * The usage leg of a repair round.
 *
 * The machinery is the refine round's, shipped since v29 and unchanged:
 * `refineTargets`, `extractor.references`, `usageSitesOutsideSpan`,
 * `collectUsageWindows`, `renderUsageSection`, every window logged by file and
 * line. What is new is that it runs on the branch that has a compiler error,
 * which is the branch it was structurally excluded from.
 *
 * The bounds start at the refine's, because they were chosen against this seam.
 * Two differences, both deliberate:
 *
 *  - The targets are ordered by proximity to the diagnostic, not by document
 *    order. The refine char budget is spent in target order, and the scout
 *    measured that the failing call is never first, so junk in front exhausts
 *    the budget before the call that matters is reached.
 *  - Latency is not the constraint. A repair round's floor is seconds. Prompt
 *    budget is the constraint, and it is the same number until an arm moves it.
 *
 * A member with no references gets a channel line and nothing adjacent, which is
 * already the shipped answer in both neighbouring legs.
 */
async function resolveUsageForRound(
  ctx: PostAcceptContext,
  resolved: ResolvedFunction,
  targets: readonly RefineTarget[],
  log: (line: string) => void,
): Promise<string[]> {
  const extractor = ctx.extractor;
  if (!extractor || typeof extractor.references !== "function") {
    log(`[repair] usage: ${ctx.document.languageId}'s extractor has no reference leg; nothing injected`);
    return [];
  }
  const calls = targets.filter((t) => t.via === "member");
  if (calls.length === 0) {
    return [];
  }
  const uri = ctx.document.uri.toString();
  const spanStart = ctx.document.positionAt(resolved.span.start);
  const spanEnd = ctx.document.positionAt(resolved.span.end);
  const readLines = fileLineReader();
  const sections: string[] = [];
  const totalChars = refineCharBudget(ctx, log);
  let charsLeft = totalChars;
  let windowCount = 0;
  let refsFound = 0;
  const started = Date.now();
  for (let i = 0; i < calls.length; i++) {
    const target = calls[i];
    if (charsLeft <= 0) {
      log(`[repair] usage: the ${totalChars}-char budget is spent; ${calls.length - i} target(s) not looked up`);
      break;
    }
    let hits: ReferenceLocation[];
    try {
      hits = await extractor.references(
        { uri, line: target.line, character: target.character },
        { includeDeclaration: false, maxResults: REFINE_REFERENCE_CAP },
      );
    } catch {
      hits = [];
    }
    refsFound += hits.length;
    const sites = usageSitesOutsideSpan(hits, { uri, startLine: spanStart.line, endLine: spanEnd.line });
    const windows = collectUsageWindows(sites, readLines, {
      maxWindows: REFINE_WINDOWS_PER_TARGET,
      linesBefore: REFINE_LINES_BEFORE,
      linesAfter: REFINE_LINES_AFTER,
      maxChars: charsLeft,
    });
    log(`[repair] usage references ${target.name}: hits=${hits.length} outside-span=${sites.length} windows=${windows.length}`);
    const section = renderUsageSection(windows, usageHeaderFor(target.name));
    if (section === undefined) {
      continue;
    }
    // Charged against the RENDERED section, fences and attribution included, and
    // dropped WHOLE rather than trimmed: half a call is worse than no call,
    // because the model completes what it can see.
    if (section.length > charsLeft) {
      log(`[repair] usage: \`${target.name}\`'s windows would cross the budget; dropped whole, ${calls.length - i - 1} target(s) not looked up`);
      break;
    }
    for (const w of windows) {
      log(`[repair] usage window ${refineDisplayPath(w.uri)}#L${w.startLine + 1}-L${w.endLine + 1}`);
    }
    windowCount += windows.length;
    charsLeft -= section.length;
    sections.push(section);
  }
  log(
    `[repair] usage: targets=${calls.length} hits=${refsFound} windows=${windowCount}` +
      ` chars=${totalChars - charsLeft} ms=${Date.now() - started}`,
  );
  if (sections.length === 0) {
    // The honest answer, and the same one both neighbouring legs already give:
    // say so, inject nothing adjacent. An example that lacks the needed call
    // displaces context that would have helped, which is what made the v22
    // blind-mining arms lose.
    log(
      refsFound === 0
        ? `[repair] usage dark: the workspace has no call site outside this function for ${calls.map((c) => c.name).join(", ")}`
        : `[repair] usage dark: ${refsFound} reference(s) found but no window could be cut from them`,
    );
  }
  return sections;
}

// How many symbols a refine round asks the reference provider about. A budget,
// not a preference: every target is a round trip, and C# alone charges a ~500ms
// floor per answering query (measured warm, flat in the answer size). Six puts
// the worst language's resolve at roughly three seconds inside a gesture whose
// model round is already four to eight.
const REFINE_TARGET_CAP = 6;
// Locations kept per target before any window is cut. The provider can answer
// with hundreds for a common helper; the window cutter would drop the tail
// anyway, and truncating first saves reading files that can never be rendered.
const REFINE_REFERENCE_CAP = 12;
// Windows per target, and how much code each one carries. One line above the
// call and two below: the call plus what the repo does with its result, which is
// the shape half of what usage teaches.
const REFINE_WINDOWS_PER_TARGET = 2;
const REFINE_LINES_BEFORE = 1;
const REFINE_LINES_AFTER = 2;
// The whole usage payload's ceiling, across every target. From the budget
// profile's cell for the active backend and this document's language (2400 at
// identity): twice the whole-block injection's 1200, because that budget
// defends a latency bar this path does not sit behind, and the fn-gen
// mini-spike this gesture descends from injected three windows as a context
// block and moved pooled method recall 22.0% to 47.7%. Not a measured
// optimum, and the run that carried what it actually cost did not survive the
// session it was made in.
const refineCharBudget = (ctx: PostAcceptContext, log: (line: string) => void): number =>
  // THE LIVE STOP, not a pin. An earlier cut pinned this to `shipped` and said
  // the contract required it; it does not. That contract's "what must NOT
  // change" list carves OUT exactly what `surfaceCap` and `refineTotalChars`
  // already derive from the aggregate budget, and this is one of the two. The
  // list is reproduced in docs/constants.md under "The prompt-versus-window
  // arbitration". A
  // developer who sets `frontier` because their model has the room has no
  // second setting for the repair prompt and no channel line saying it stayed
  // at the local-30B point, so a pin here is a silent refusal of the thing they
  // asked for.
  budgetProfileFor(fnGenModelClass(log), ctx.document.languageId, injectedContextStop(log)).refineTotalChars;

/**
 * What one press of Repair Function's TEST LEG did, for the caller's one
 * decision: whether the refine still has work to do.
 *
 * "not-run" means the leg reached no failing covering test, so the refine branch
 * keeps exactly the case its own comment describes - nothing else had work to do.
 */
type TestLegVerdict = "ran" | "not-run";

/**
 * The call-hierarchy root position for a resolved function.
 *
 * The document-symbol tree the resolution was cut out of already holds the NAME
 * token's range (`selectionRange`), which is the position a call-hierarchy
 * prepare wants; `span.start` is the declaration HEAD, and for a Python
 * body-only target it is not even that - it is the first line of the body, below
 * the `def`. A prepare at either can come back empty, and an empty prepare here
 * reads as "no test calls this function", which is the false sentence this
 * feature exists to refuse.
 *
 * No tree (a record built outside fnGen's resolver) degrades to the span start,
 * which is what the gesture would have had anyway.
 *
 * SHARED BY BOTH GESTURES, AND THAT SHARING IS LOAD-BEARING (adversarial review
 * row A2). Run Covering Tests used to prepare the hierarchy at the RAW cursor
 * while the repair leg normalised here, and `vscode.prepareCallHierarchy`
 * answers for the symbol AT the position: a cursor sitting on `foo.bar()` inside
 * a body resolves to `bar`, and a cursor on whitespace resolves to nothing at
 * all. So one press of Run Covering Tests and one press of Repair Function
 * discovered two different functions' covering tests for one cursor, and the
 * whole design rests on the developer seeing exactly what the model gets.
 * Exported rather than copied: a second normalisation would be a second answer.
 */
export function callRootPosition(document: vscode.TextDocument, resolved: ResolvedFunction): vscode.Position {
  const at = document.positionAt(resolved.span.start);
  const tree = resolved.symbols;
  if (tree === undefined) {
    return at;
  }
  let best: vscode.DocumentSymbol | undefined;
  const visit = (symbols: readonly vscode.DocumentSymbol[]): void => {
    for (const symbol of symbols) {
      if (!symbol.range.contains(at)) {
        continue;
      }
      // Deepest wins: a method's own range sits inside its class's, and the
      // class's name token would prepare the hierarchy for the wrong symbol.
      best = symbol;
      visit(symbol.children ?? []);
    }
  };
  visit(tree);
  return best?.selectionRange.start ?? at;
}

/** The groups' results as ONE result, for `runDelta`.
 *
 *  Concatenation, not a re-derivation: `runDelta` keys on the runner's own case
 *  names and only compares names present in both runs, so a group that ran
 *  before and failed to spawn after simply drops out of the comparison rather
 *  than being reported as broken. `crateRoot` is the first group's, and it is
 *  display detail here - nothing downstream of this merge reads it. */
function mergeRunResults(outcomes: readonly GroupOutcome[]): TestOracleResult | undefined {
  const results = outcomes.map((o) => o.result).filter((r): r is TestOracleResult => r !== undefined);
  if (results.length === 0) {
    return undefined;
  }
  return {
    ran: results.some((r) => r.ran),
    success: results.every((r) => r.success),
    cases: results.flatMap((r) => r.cases),
    failures: results.flatMap((r) => r.failures),
    passed: results.reduce((n, r) => n + r.passed, 0),
    failed: results.reduce((n, r) => n + r.failed, 0),
    ignored: results.reduce((n, r) => n + r.ignored, 0),
    durationMs: results.reduce((n, r) => n + r.durationMs, 0),
    crateRoot: results[0].crateRoot,
  };
}

/**
 * Repair Function's TEST LEG: the manual gesture's clean-compile case, when the
 * repo's own covering tests are red.
 *
 * `runRefine`'s comment gives its reason as nothing else having had work to do.
 * RED TESTS ARE WORK TO DO, so this evaluates first and refine keeps exactly the
 * case where the tests passed, none were found, or this leg did not run.
 *
 * The flow is dictated (goal.md, human 2026-08-26) and not up for redesign:
 * discover and run - which is free, because the round needs the failures to
 * build its prompt anyway - repair, then re-run THE SAME discovered set
 * automatically. A newly red test drives the next round under the existing cap.
 *
 * WHAT OPENS THE ONE-WAY DOOR. `classifyEligibility` refuses an
 * `assertion-failure` diagnostic unless BOTH halves of `TestRepairAuthorization`
 * are true, and both are COMPUTED here rather than assumed: the developer
 * invoked this gesture themselves (`ctx.manualRefine`), and the failing test is
 * in the walk's own discovered set for THIS target. The automatic post-fn-gen
 * path constructs its session with the default `NO_TEST_REPAIR` and runs no
 * test, so neither half can ever be true there.
 *
 * MEASURED (session-v60 scout, `qwen3-coder:30b`, four seeded compiling defects,
 * positive control on every arm): no evidence 0/4, the bare-message shape the
 * old ADR measured 0/4, the specced failure evidence 1/4, evidence PLUS the
 * receiver's API surface 3/4. That is why the surface below is not optional and
 * why its allowance is ADDITIONAL to `surfaceBudgetTok` rather than carved out
 * of it - evidence says WHAT IS WRONG, injected surface says WHAT TO WRITE, and
 * they are not substitutes.
 */
async function runTestLeg(
  ctx: PostAcceptContext,
  oracle: CompilerOracle,
  log: (line: string) => void,
  resolved: ResolvedFunction | undefined,
  filePath: string,
  crateRoot: string,
  modelTag: string,
  enabled: boolean,
  resolvePath: (crateRoot: string, fileName: string) => string,
): Promise<TestLegVerdict> {
  if (!resolved) {
    log(`[tests] test leg skipped: no function resolved at the cursor`);
    return "not-run";
  }
  // BOTH gestures gate on a function target, and they must agree (adversarial
  // review row A2b). Without this the leg would run a repair round on a struct
  // or class that Run Covering Tests refuses outright, so one press of each on
  // the same cursor would do two different things. `column80.runTddTests` has
  // gated the same way since it shipped, and what a type target's "covering
  // tests" even means is not something anyone has measured.
  if (resolved.kind !== "function") {
    log(`[tests] test leg skipped: the target is a ${resolved.kind}, and covering tests are only defined for a function here`);
    return "not-run";
  }
  // The tier gate and the repair switch, refused the same way the refine branch
  // refuses them, and BEFORE anything spawns: a closed gate means no round can
  // run, and discovering and running a whole suite to then say so would spend
  // the developer's seconds proving something known up front.
  if (!enabled) {
    log(`[tests] test leg skipped: repair rounds are unavailable, so a red test could not be acted on`);
    return "not-run";
  }
  // ONE mechanism, two entry points. Same bounds, same scope predicate, same
  // run-target resolution as Run Covering Tests, because what the developer just
  // looked at has to be exactly what the model gets.
  const plan = coveringTestPlan({ languageId: ctx.document.languageId, targetFilePath: filePath, log });
  if (plan === undefined) {
    log(`[tests] test leg skipped: no covering-test leg registered for ${ctx.document.languageId}`);
    return "not-run";
  }

  const symbolName = resolved.symbolName;
  const controller = new AbortController();
  const runClaim = ctx.inFlight?.begin(`Running covering tests for ${symbolName}`, controller);
  let discovery;
  let outcomes: GroupOutcome[];
  try {
    const target = await prepareCallRoot(ctx.document, callRootPosition(ctx.document, resolved), log);
    if (target === undefined) {
      // A RESULT, not an error, and emphatically not a zero: the server could
      // not place this cursor, so the search never started.
      log(
        `[tests] the ${ctx.document.languageId} language server could not place ${symbolName} for a` +
          ` call-hierarchy query, so no covering test was searched for`,
      );
      return "not-run";
    }
    discovery = await discoverCoveringTests({
      target,
      lang: plan.classifyLang,
      resolveCallers: makeResolveCallers(log),
      readLines: makeLineReader(),
      inScope: plan.inScope,
      bounds: plan.bounds,
      runScope: plan.runScope,
      resolveTarget: plan.resolveTarget,
      signal: controller.signal,
      hangGuardMs: plan.hangGuardMs,
      log,
    });
    if (discovery.groups.length === 0) {
      // SAID, never green, and never treated as a pass: nothing ran, so nothing
      // about this function's behaviour was checked. The refine still has its
      // own work to do, so the caller falls through to it.
      log(
        `[tests] no covering ${plan.classifyLang === "typescript" ? "test file" : "test"} could be run for ${symbolName}` +
          ` in this ${plan.scopeWord}; the repair had no test evidence to work from`,
      );
      return "not-run";
    }
    const before = await runCoveringGroups({
      groups: discovery.groups,
      frameworkAt: plan.frameworkAt,
      signal: controller.signal,
      isCancellation,
      firstLine,
      log,
    });
    if (before.cancelled) {
      log(`[tests] the covering-test run for ${symbolName} was cancelled; no repair round ran`);
      return "not-run";
    }
    outcomes = before.outcomes;
  } finally {
    runClaim?.release();
  }

  // A RUN THAT DID NOT RUN IS NOT A PASS, and it is not evidence either
  // (phaseB1 wording rule 9, adversarial review row A1). `buildError`,
  // `environmentError`, `filterMatchedNothing` and a runner that executed zero
  // tests all enumerate NO failing test, so a leg that read its verdict off the
  // failure list alone would take every one of them for "nothing is red".
  // `outcomesThatDidNotRun` names WHICH of the four it was, in the vocabulary
  // `runTestsReport.ts` already ships, rather than inventing a fifth.
  //
  // Refused rather than partially continued: the before-state is what the
  // after-run is compared against, and a delta measured against a state that was
  // never established is not a result about the repair.
  const beforeNotRun = outcomesThatDidNotRun(outcomes);
  if (beforeNotRun.length > 0) {
    for (const notRun of beforeNotRun) {
      log(`[tests] ${notRun.frameworkName}: ${notRun.detail}`);
    }
    log(
      `[tests] the covering tests for ${symbolName} did not run (${beforeNotRun.map((n) => n.reason).join(", ")}),` +
        ` so there is no failure evidence and nothing here authorises a repair round`,
    );
    return "not-run";
  }

  // THE AUTHORIZATION, both halves computed and neither assumed.
  //
  // `inDiscoveredSet` is membership of the FAILING tests in the set the walk
  // just produced, tested through `caseMatchesFilter` inside
  // `shapesWithinDiscoveredSet` rather than by string identity: libtest reports
  // `shard_wal::tests::x` for a filter the call hierarchy named `x`, and a
  // `Set.has` membership test matched zero of 40 real failures when it was tried.
  const filters = discoveredFilters(discovery.groups);
  const failures = failuresOf(outcomes);
  // THE NUMBERS MUST BE THE DISCOVERED SET'S (adversarial review rows A4 and
  // A5). A bare Rust name makes `buildTestCommand` skip `--exact`, so libtest
  // substring-matches and the spawn executes tests the walk never selected.
  // Unscoped, those cases became the "N of 3 covering test(s) failed" header the
  // MODEL reads, the "N covering test(s) now pass" toast the DEVELOPER reads,
  // and the population `runDelta` blamed the repair over - which let one press
  // warn that the repair made things worse about a neighbour and inform that the
  // covering tests now pass, in the same breath. The substring behaviour itself
  // stays (session-v60/scraps.md S60-2); a count that claims to be the covering
  // set and is not does not.
  const scoped = withinDiscoveredSet(outcomes, filters, plan.classifyLang);
  const totals = runTotals(scoped);
  // The digest's per-framework hooks: the failure LOCATION extractor and the
  // wrapper-frame strip. Taken from the FIRST group, because one gesture is one
  // language and `frameworkFor` answers the same way for every root in it in
  // every layout measured. A repo that really did resolve two frameworks across
  // two roots would digest the second one's output with the first one's hooks,
  // and both hooks DECLINE safely (`tryHook` treats a throw or an undefined as
  // "no location, no strip"), so the cost is a coarser digest rather than a
  // wrong one.
  const framework = plan.lang.frameworks.find((f) => f.id === discovery.groups[0].frameworkId);
  const shapes = shapesWithinDiscoveredSet(
    digestFailures(failures, {
      strip: framework?.stripHarnessFrames,
      locate: framework?.failureLocation,
    }),
    filters,
    plan.classifyLang,
  );
  const admitted = new Set(shapes.flatMap((s) => s.names));
  const admittedFailures = failures.filter((f) => admitted.has(f.name));
  log(
    `[tests] before: ran=${totals.ran} passed=${totals.passed} failed=${totals.failed}` +
      ` discovered-filters=${filters.size} in-set-failures=${admittedFailures.length} shapes=${shapes.length}`,
  );
  if (admittedFailures.length === 0) {
    if (failures.length > 0) {
      // A red test somewhere else in the repo is not this function's problem and
      // must not become evidence about it.
      log(
        `[tests] ${failures.length} test(s) failed but none of them is in the walk's discovered set for ${symbolName};` +
          ` nothing here authorises a repair round`,
      );
    } else {
      log(`[tests] every covering test for ${symbolName} passed, so the test leg has nothing to repair`);
    }
    return "not-run";
  }
  const auth: TestRepairAuthorization = {
    manualRepairGesture: ctx.manualRefine === true,
    inDiscoveredSet: admittedFailures.length > 0,
  };
  log(`[tests] authorization manual=${auth.manualRepairGesture} in-discovered-set=${auth.inDiscoveredSet}`);

  // A round's evidence is bounded by `failureTokMax`, which is ADDITIONAL to
  // `surfaceBudgetTok` and never carved out of it. The test payload must not
  // evict the type surface to fit: that trade is the difference between 1/4 and
  // 3/4 on the measured arms.
  const budget = budgetProfileFor(fnGenModelClass(log), ctx.document.languageId, injectedContextStop(log));
  const readLines = makeLineReader();
  const readSourceLine = (loc: FailureLocation): { line: string; before?: string; after?: string } | undefined => {
    // Runner locations are usually relative to the run root, so they are tried
    // against every root this gesture actually ran in. An absolute path resolves
    // on the first hit.
    const roots = [...new Set(discovery.groups.map((g) => g.placement.runRoot))];
    for (const candidate of [loc.filePath, ...roots.map((r) => `${r}/${loc.filePath}`)]) {
      const lines = readLines(candidate);
      if (lines === undefined || loc.line < 1 || loc.line > lines.length) {
        continue;
      }
      return {
        line: lines[loc.line - 1],
        before: loc.line >= 2 ? lines[loc.line - 2] : undefined,
        after: loc.line < lines.length ? lines[loc.line] : undefined,
      };
    }
    return undefined;
  };

  const session = new RepairSession(
    ctx.source,
    enabled,
    log,
    { assertionShaped: (d) => oracle.isAssertionShaped(d) },
    auth,
  );
  let scope = byteScope(ctx.document, filePath, crateRoot, resolved.span, resolvePath);
  let beforeResult = mergeRunResults(scoped);
  let evidence = renderFailureEvidence({
    shapes,
    tokMax: budget.failureTokMax,
    readSourceLine,
    ran: totals.ran,
    passed: totals.passed,
  });
  log(
    `[tests] evidence tok=${evidence.spentTok}/${budget.failureTokMax} reached=${evidence.reached.join(",") || "none"}` +
      ` dropped-names=${evidence.droppedNames}`,
  );
  let action = session.next(
    testCheckResult(
      testFailureDiagnostics({
        failures: admittedFailures,
        filePath,
        byteStart: scope.byteStart,
        byteEnd: scope.byteEnd,
        evidence: evidence.section,
      }),
      crateRoot,
    ),
    scope,
  );
  if (action.kind !== "repair") {
    // The session refused before any model call. Said, never silent: the
    // developer pressed a button and is owed the reason.
    log(`[tests] no repair round ran why=${action.why}`);
    void vscode.window.showWarningMessage(
      `Column 80: ${admittedFailures.length} covering test(s) fail for ${symbolName}, and no repair round could run (${action.why}). See the output channel.`,
    );
    return "ran";
  }

  let stillRed = admittedFailures.length;
  let fixedCount = 0;
  // The LAST run's numbers, so the verdict below reports what is true now rather
  // than what was true before the first round.
  let nowPassing = totals.passed;
  while (action.kind === "repair") {
    const round = action.round;
    const outcome = (result: string) => log(`[tests] repair outcome round=${round} result=${result}`);
    const versionAtResolve = ctx.document.version;
    const code = ctx.document.getText(
      new vscode.Range(ctx.document.positionAt(resolved.span.start), ctx.document.positionAt(resolved.span.end)),
    );

    // The API surface, resolved exactly as a compiler repair round resolves it:
    // the span's types-in-play through the pre-fill engine, plus the receivers
    // that OWN the member calls the span makes, closed by ONE firm instruction
    // naming every type that rendered. `resolveSurfaceInjection` runs over the
    // eligible diagnostics the same way, and contributes nothing on this leg by
    // construction - a synthesised test failure names no type - which is exactly
    // why the span and owner legs above are the ones that carry the round.
    //
    // RELEVANCE ORDERING IS LOAD-BEARING HERE, and `orderSurfaceByRelevance`
    // below is where it happens. Measured on the real Rust corpus with a seeded
    // defect, `qwen3-coder:30b` at temperature 0, three repetitions per arm,
    // every candidate fix spliced back and verified by `cargo test`: evidence
    // alone 0/3 green, evidence plus a SOURCE-ordered surface 0/3, evidence plus
    // a RELEVANCE-ordered surface 3/3. Same 100 signatures, same budget, same
    // model. Only the order differs. The source-ordered arms wrote a member that
    // does not exist, or a real but wrong one.
    //
    // It is not that the needed member came earlier: relevance order put it at
    // index 66 where source order had it at 14. What earns the 3/3 is that the
    // members semantically near the failure sit at the top. Truncating the same
    // relevance-ordered list to its top 16 was 0/3, so the cap and the order are
    // one decision and this leg orders WITHOUT narrowing.
    //
    // The compiler repair round is deliberately untouched: it has its own
    // anchor-based ordering through `roundCallTargets`, its own frozen
    // prompt-identity oracles, and nothing measured here says anything about it.
    let surface: string | undefined;
    const disclosed: DisclosedType[] = [];
    if (ctx.extractor) {
      const spanTypes = spanTypesInPlay({
        languageId: resolved.languageId,
        signature: resolved.signature,
        docComment: resolved.docComment,
        code,
        diagnosticTypes: [],
        excludeName: resolved.symbolName,
      });
      const { targets: callTargets, anchor } = roundCallTargets(ctx, resolved, code, action.eligible);
      const callOwners = await resolveOwnersForRound(ctx, callTargets, anchor, new Set(spanTypes), log);
      const ownerCursors = new Map<string, SourceCursor>(callOwners.map((o) => [o.name, o.cursor]));
      const allTypes = [...callOwners.map((o) => o.name), ...spanTypes].filter((t, i, all) => all.indexOf(t) === i);
      const spanSurface =
        ctx.resolveSpanSurface !== undefined
          ? await ctx.resolveSpanSurface(ctx.extractor, ctx.document, resolved, log, {
              extraCandidates: allTypes,
              omitInstruction: true,
              onDisclosed: (types) => disclosed.push(...types),
              extraCursors: ownerCursors,
            })
          : undefined;
      const skipTypes = new Set(disclosed.map((d) => d.name));
      const diagSurface = await resolveSurfaceInjection(
        ctx.extractor,
        ctx.document,
        action.eligible,
        log,
        undefined,
        undefined,
        undefined,
        {
          skipTypes,
          omitInstruction: true,
          onDisclosed: (types) => {
            for (const t of types) {
              if (!disclosed.some((d) => d.name === t.name)) {
                disclosed.push(t);
              }
            }
          },
        },
      );
      const parts = [spanSurface, diagSurface].filter((p): p is string => p !== undefined && p !== "");
      if (parts.length > 0) {
        // Ordered BEFORE the firm instruction is appended, so the sentence that
        // names the permitted types can never be caught up in a member reorder.
        // The seam identifies a member line structurally rather than by shape:
        // only the lines between the fence that `assembleSurfacePayload` opens
        // under its own "API surface for `T` (real signatures...)" header move,
        // and each block is ordered on its own so a signature never drifts out
        // from under the header naming its owner. Data shapes, usage examples,
        // import hints and constructor blocks carry different headers and are
        // left byte-identical.
        const combined = orderSurfaceByRelevance(parts.join("\n\n"), {
          targetText: code,
          evidenceText: evidence.section,
          docComment: resolved.docComment,
        });
        surface = disclosed.length > 0 ? `${combined}\n\n${firmInstructionFor(disclosed.map((d) => d.name))}` : combined;
      }
      log(
        `[tests] round ${round} surface: types=${disclosed.length}` +
          `${disclosed.length > 0 ? ` (${disclosed.map((d) => d.name).join(", ")})` : " (nothing resolved)"}` +
          ` ordered=relevance`,
      );
    }

    const repairBlocks = await ctx.readContextBlocks?.();
    const prompt = assembleRepairPrompt({
      languageId: resolved.languageId,
      docComment: resolved.docComment,
      code,
      // EMPTY, and that is the point: the failing code COMPILES. The evidence
      // block replaces the diagnostics block rather than sitting beside an empty
      // fence, and the intro sentence changes with `oracle`.
      diagnostics: [],
      failureEvidence: evidence.section,
      oracle: "tests",
      surface,
      kind: resolved.kind,
      bodyOnly: resolved.bodyOnly,
      spanIndent: (resolved.bodyOnly ? resolved.bodyIndent : resolved.headerIndent) ?? "",
      docIndent: resolved.bodyOnly ? "" : resolved.headerIndent ?? "",
      contextBlocks: repairBlocks,
    });
    log(
      `[tests] round ${round}/2 model=${modelTag} route=${action.route} failing=${action.eligible.length}` +
        `${surface ? " surface=injected" : ""}`,
    );

    const roundController = new AbortController();
    const claim = ctx.inFlight?.begin(`Repairing ${symbolName}`, roundController);
    let result;
    try {
      result = await ctx.service.generateRaw(prompt, {
        docComment: resolved.docComment,
        signature: resolved.signature,
        span: resolved.span,
        bodyOnly: resolved.bodyOnly,
        contextBlocks: repairBlocks,
      }, roundController.signal);
    } catch (err) {
      if (isPromptWindowError(err)) {
        void vscode.window.showWarningMessage(err.message);
        outcome("failed");
        return "ran";
      }
      outcome("failed");
      return "ran";
    } finally {
      claim?.release();
    }
    if (!result) {
      outcome("aborted");
      return "ran";
    }
    result.text = placeGeneratedReply(result.text, {
      languageId: resolved.languageId ?? ctx.document.languageId,
      bodyOnly: resolved.bodyOnly,
      headerIndent: resolved.headerIndent ?? "",
      bodyIndent: resolved.bodyIndent ?? "",
    });
    if (isNoOpRepair(code, result.text)) {
      // MEASURED TWICE in the scout, on the blame cases: given a correct
      // function and one corrupted test, the model left the function
      // BYTE-IDENTICAL rather than bending it to satisfy the bad test. That is
      // the honest outcome, and the still-red run below is the blame signal.
      log(`[tests] round ${round} returned the function unchanged; not proposed`);
      outcome("no-change");
      void vscode.window.showWarningMessage(
        `Column 80: the repair left ${symbolName} unchanged, and ${stillRed} covering test(s) still fail. See the output channel.`,
      );
      return "ran";
    }
    const refusal = undisclosedMemberRefusal(result.text, disclosed);
    if (refusal !== undefined) {
      log(`[tests] round ${round} refused: ${refusal}`);
      outcome("refused");
      break;
    }

    // The ONE write path. No second insertion route exists for this leg any more
    // than for a compiler round.
    const proposal = await ctx.presenter.present({
      document: ctx.document,
      span: resolved.span,
      versionAtResolve,
      title: `${symbolName}: repair from failing tests, round ${round} (preview)`,
      text: result.text,
      service: ctx.service,
    });
    if (proposal === "discarded") {
      outcome("discarded");
      return "ran";
    }
    if (proposal !== "accept") {
      outcome("rejected");
      void vscode.window.showInformationMessage(
        `Column 80: ${symbolName} is unchanged. ${stillRed} covering test(s) still fail.`,
      );
      return "ran";
    }

    if (ctx.document.isDirty && !(await ctx.document.save())) {
      outcome("failed");
      throw new Error(`could not save ${ctx.document.uri.fsPath} before the covering tests were re-run`);
    }
    // WAVE SEMANTICS, the same rule the compiler loop above follows: re-check
    // after every executed splice, and never assume a splice the human accepted
    // still compiles (adversarial review row A1, HIGH). A repair that broke the
    // build made every runner answer `buildError`, which enumerates no failing
    // test, which read as "every covering test now passes" on code that does not
    // compile. Checking here also spares the developer a whole test spawn on a
    // crate that cannot build, and names the ERRORS, which a runner's build
    // output does not.
    const rechecked = await runOracleCheck(oracle, filePath, { log, envReason: surfaceEnvReason });
    const errorsAfterSplice = rechecked?.diagnostics.filter((d) => d.level === "error").length ?? 0;
    if (rechecked !== undefined && errorsAfterSplice > 0) {
      surfaceCheck(ctx, rechecked, oracle);
      outcome(`broke-the-build=${errorsAfterSplice}`);
      log(
        `[tests] the repair of ${symbolName} left ${errorsAfterSplice} compiler error(s), so the covering tests were` +
          ` not re-run and nothing at all can be said about them`,
      );
      void vscode.window.showWarningMessage(
        oneLineWithPointer(
          `Column 80: the repair of ${symbolName} left ${errorsAfterSplice} compiler error(s), so the covering tests` +
            ` were not re-run. Nothing passed. See the output channel.`,
        ),
      );
      return "ran";
    }
    // THE SAME `RunGroup[]` OBJECT the first run used. Not a re-derived filter:
    // the function changed, but "which tests cover it" was answered before the
    // change, and re-answering mid-loop would compare two different sets and
    // call the difference a result.
    const afterController = new AbortController();
    const afterClaim = ctx.inFlight?.begin(`Re-running covering tests for ${symbolName}`, afterController);
    let after;
    try {
      after = await runCoveringGroups({
        groups: discovery.groups,
        frameworkAt: plan.frameworkAt,
        signal: afterController.signal,
        isCancellation,
        firstLine,
        log,
      });
    } finally {
      afterClaim?.release();
    }
    if (after.cancelled) {
      outcome("after-run-cancelled");
      log(`[tests] the re-run was cancelled, so nothing can be said about what the repair did to the tests`);
      return "ran";
    }
    // The same rule 9 guard on the AFTER run. The compiler re-check above catches
    // the build error; this catches the rest of the four, and a run that
    // executed nothing. Never a green: the tests were not proved to pass, they
    // were not asked.
    const afterNotRun = outcomesThatDidNotRun(after.outcomes);
    if (afterNotRun.length > 0) {
      for (const notRun of afterNotRun) {
        log(`[tests] ${notRun.frameworkName}: ${notRun.detail}`);
      }
      outcome(`after-run-did-not-run=${afterNotRun.map((n) => n.reason).join(",")}`);
      void vscode.window.showWarningMessage(
        oneLineWithPointer(
          `Column 80: the covering tests for ${symbolName} were re-run and did not run` +
            ` (${afterNotRun[0].detail}). Nothing passed and nothing failed, so nothing is known about what the` +
            ` repair did. See the output channel.`,
        ),
      );
      return "ran";
    }
    const afterScoped = withinDiscoveredSet(after.outcomes, filters, plan.classifyLang);
    const afterResult = mergeRunResults(afterScoped);
    // ONE population for both claims. `broke` and `stillRed` used to be computed
    // over different sets, which is how one press could say both (review row A4).
    const delta = runDelta(beforeResult, afterResult);
    fixedCount = delta.fixed.length;
    const broke = worseThanBeforeMessage(delta, symbolName);
    const afterTotals = runTotals(afterScoped);
    nowPassing = afterTotals.passed;
    const afterFailures = failuresOf(after.outcomes);
    const afterShapes = shapesWithinDiscoveredSet(
      digestFailures(afterFailures, {
        strip: framework?.stripHarnessFrames,
        locate: framework?.failureLocation,
      }),
      filters,
      plan.classifyLang,
    );
    const afterAdmitted = new Set(afterShapes.flatMap((s) => s.names));
    const afterAdmittedFailures = afterFailures.filter((f) => afterAdmitted.has(f.name));
    stillRed = afterAdmittedFailures.length;
    outcome(stillRed === 0 ? "all-green" : `still-red=${stillRed}`);
    log(
      `[tests] after: ran=${afterTotals.ran} passed=${afterTotals.passed} failed=${afterTotals.failed}` +
        ` fixed=${delta.fixed.length} broken=${delta.broken.length} still-red=${delta.stillRed.length}`,
    );
    if (broke !== undefined) {
      // Said in those words, at warning severity, because the alternative is a
      // developer discovering it later by reading their own test output.
      log(`[tests] ${broke}`);
      void vscode.window.showWarningMessage(oneLineWithPointer(`Column 80: ${broke}`));
    }

    // The splice moved bytes: re-resolve so the next round's scope is the
    // repaired function as it sits now.
    const anchorStart = resolved.span.start;
    const reresolved = await ctx.resolveFunction(ctx.document, ctx.document.positionAt(anchorStart));
    resolved = reresolved ?? resolved;
    scope = byteScope(ctx.document, filePath, crateRoot, resolved.span, resolvePath);
    beforeResult = afterResult;
    evidence = renderFailureEvidence({
      shapes: afterShapes,
      tokMax: budget.failureTokMax,
      readSourceLine,
      ran: afterTotals.ran,
      passed: afterTotals.passed,
    });
    action = session.next(
      testCheckResult(
        testFailureDiagnostics({
          failures: afterAdmittedFailures,
          filePath,
          byteStart: scope.byteStart,
          byteEnd: scope.byteEnd,
          evidence: evidence.section,
        }),
        crateRoot,
      ),
      scope,
    );
  }

  // The verdict. Never that the function is CORRECT: the tests that pass are the
  // tests the walk found, and finding them is not the same as covering the
  // behaviour.
  if (stillRed === 0) {
    log(`[tests] every covering test for ${symbolName} now passes; this says nothing about whether the function is right`);
    void vscode.window.showInformationMessage(
      `Column 80: ${nowPassing} covering test(s) for ${symbolName} now pass. They are the tests the call walk found for it, which is not a statement that the function is right.`,
    );
    return "ran";
  }
  const why = action.kind === "surface" ? action.why : "cap-exhausted";
  log(`[tests] give-up why=${why} still-red=${stillRed} fixed=${fixedCount}`);
  void vscode.window.showWarningMessage(
    oneLineWithPointer(
      `Column 80: ${stillRed} covering test(s) for ${symbolName} still fail after the repair rounds` +
        `${fixedCount > 0 ? ` (${fixedCount} were fixed)` : ""}. See the output channel.`,
    ),
  );
  return "ran";
}

/**
 * The refine round: what the manual repair gesture does when the build is
 * already clean.
 *
 * Ordering is the load-bearing part, and it diverges on purpose from what the
 * feature was originally asked for. That amendment's own file did not survive
 * the session it was made in, so this comment is its only record. The ask was
 * "a refine that introduces an error is refused with the reason, not proposed",
 * which needs the candidate CHECKED before the human sees it. Both
 * ways to do that break a named product invariant: checking it means writing the
 * candidate to disk for the real compiler (the consented-write invariant says
 * two, and only two, code paths write to a document), and reading the language
 * server's diagnostics back instead means the one-way-diagnostics invariant
 * (nothing reads `vscode.languages.getDiagnostics` back into the loop). So the
 * check happens where every other check on this page happens - after the accept -
 * and a refine that introduced an error is said LOUDLY, on the channel and in a
 * warning naming the count and the first error, with the editor's own undo as
 * the way back. What is refused instead is the silence.
 *
 * The refine deliberately does NOT spend repair rounds cleaning up after itself.
 * The human asked for a style pass; turning a bad one into a two-round repair
 * loop would be the tool deciding to keep going on its own.
 */
async function runRefine(
  ctx: PostAcceptContext,
  oracle: CompilerOracle,
  log: (line: string) => void,
  resolved: ResolvedFunction | undefined,
  before: OracleCheckResult,
  filePath: string,
  modelTag: string,
): Promise<void> {
  if (!resolved) {
    log(`[repair] refine skipped: no function resolved at the cursor`);
    return;
  }
  if (!ctx.extractor) {
    log(`[repair] refine skipped: no extractor for ${ctx.document.languageId}, so no reference provider`);
    return;
  }
  if (typeof ctx.extractor.references !== "function") {
    // The seam's reference leg is optional. A transport without it cannot
    // answer the only question this gesture asks, and inventing an adjacent
    // payload is the retrieval mistake the v22 spike already paid for.
    log(`[repair] refine skipped: ${ctx.document.languageId}'s extractor has no reference leg`);
    return;
  }

  // The budget, named separately on the channel every time it is spent, so a
  // reader of the log can never mistake a refine for one of the two rounds
  // product invariant 4 reserves for the compiler.
  const budget = new RefineBudget();
  log(`[repair] refine: build is clean and the gesture is manual; budget=${REFINE_ROUND_CAP} round, separate from the 2-round repair cap`);

  const versionAtResolve = ctx.document.version;
  const code = ctx.document.getText(
    new vscode.Range(
      ctx.document.positionAt(resolved.span.start),
      ctx.document.positionAt(resolved.span.end),
    ),
  );
  const spanStart = ctx.document.positionAt(resolved.span.start);
  const spanEnd = ctx.document.positionAt(resolved.span.end);
  const targets = refineTargets({
    languageId: resolved.languageId,
    code,
    spanStartLine: spanStart.line,
    spanStartCharacter: spanStart.character,
    signature: resolved.signature,
    docComment: resolved.docComment,
    max: REFINE_TARGET_CAP,
    excludeName: resolved.symbolName,
  });
  log(
    `[repair] refine targets: ${targets.length === 0 ? "none" : targets.map((t) => `${t.name}(${t.via})`).join(", ")}`,
  );
  if (targets.length === 0) {
    log(`[repair] refine: the span names no member call and no resolvable type; nothing to look up, no round spent`);
    return;
  }

  // Reference resolution, one target at a time. Serial rather than raced: the
  // servers behind this seam answer one request at a time anyway (Roslyn
  // demonstrably so), and a parallel fan-out would only make the per-target
  // timings on the channel unreadable.
  const uri = ctx.document.uri.toString();
  const sections: string[] = [];
  const readLines = fileLineReader();
  const totalChars = refineCharBudget(ctx, log);
  let charsLeft = totalChars;
  let windowCount = 0;
  let refsFound = 0;
  const startedRefs = Date.now();
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (charsLeft <= 0) {
      log(`[repair] refine: usage budget of ${totalChars} chars spent; ${targets.length - i} target(s) not looked up`);
      break;
    }
    const startedOne = Date.now();
    const hits = await ctx.extractor.references(
      { uri, line: target.line, character: target.character },
      { includeDeclaration: false, maxResults: REFINE_REFERENCE_CAP },
    );
    refsFound += hits.length;
    const sites = usageSitesOutsideSpan(hits, {
      uri,
      startLine: spanStart.line,
      endLine: spanEnd.line,
    });
    const windows = collectUsageWindows(sites, readLines, {
      maxWindows: REFINE_WINDOWS_PER_TARGET,
      linesBefore: REFINE_LINES_BEFORE,
      linesAfter: REFINE_LINES_AFTER,
      maxChars: charsLeft,
    });
    log(
      `[repair] refine references ${target.name}: hits=${hits.length} outside-span=${sites.length} windows=${windows.length} ms=${Date.now() - startedOne}`,
    );
    const section = renderUsageSection(windows, usageHeaderFor(target.name));
    if (section === undefined) {
      continue;
    }
    // The budget is charged against the RENDERED section, header, attribution
    // lines and fences included. The window cutter only ever sees the code
    // text, so charging that alone is the same overrun the C# whole-block
    // injection was fixed for. A section that would cross the line is dropped
    // whole rather than trimmed: half a call is worse than no call, because the
    // model completes what it can see.
    if (section.length > charsLeft) {
      log(
        `[repair] refine: \`${target.name}\`'s windows would cross the ${totalChars}-char usage budget; dropped whole, ${targets.length - i - 1} target(s) not looked up`,
      );
      break;
    }
    // Every injected window on the channel, with its file and line. The v22
    // verdict on usage injection was conditional on the context being visible
    // and attributable, and a human who cannot go and read the example the model
    // was shown cannot judge the proposal that came back.
    for (const w of windows) {
      log(`[repair] refine window ${refineDisplayPath(w.uri)}#L${w.startLine + 1}-L${w.endLine + 1}`);
    }
    windowCount += windows.length;
    charsLeft -= section.length;
    sections.push(section);
  }
  log(`[repair] refine reference resolve: targets=${targets.length} hits=${refsFound} windows=${windowCount} ms=${Date.now() - startedRefs}`);

  if (sections.length === 0) {
    // The honest answer to a first use, or to a function whose helpers this repo
    // calls in exactly one place: say so and stop. Injecting something adjacent
    // and hoping is what made the v22 blind-mining arms lose - an example that
    // lacks the needed call displaces context that would have helped.
    //
    // Two different silences, said differently, because they send a reader to
    // two different places. Nothing came back at all, or hits came back and no
    // window survived them: the second one contradicted its own `hits=` lines
    // above when it borrowed the first one's words, and it is what an
    // unreadable path looks like from the channel.
    log(
      refsFound === 0
        ? `[repair] refine: no usage anywhere for ${targets.map((t) => t.name).join(", ")}; nothing injected, no round spent`
        : `[repair] refine: ${refsFound} reference(s) found for ${targets.map((t) => t.name).join(", ")}` +
          ` but no window could be cut from them (unreadable files, or every hit inside this function);` +
          ` nothing injected, no round spent`,
    );
    void vscode.window.showInformationMessage(
      `Column 80: ${resolved.symbolName} builds clean, but this repo has no other call sites for the symbols it uses, so there is no style to show the model. Nothing changed.`,
    );
    return;
  }

  // The span's types-in-play, the same leg a repair round leads with, resolved
  // through the same engine. A refine gets it for the same reason a repair does:
  // the model is being asked about THIS span, so the span's types are what it
  // needs, and a rewrite that reaches for a member the type does not have is
  // exactly the failure the disclosure exists to prevent.
  const startedSurface = Date.now();
  const disclosed: DisclosedType[] = [];
  const spanSurface =
    ctx.resolveSpanSurface !== undefined
      ? await ctx.resolveSpanSurface(ctx.extractor, ctx.document, resolved, log, {
          omitInstruction: true,
          onDisclosed: (types) => disclosed.push(...types),
        })
      : undefined;
  // The blocks come back bare and are closed by ONE firm instruction naming
  // every type that rendered, the same rule the repair path follows: an API
  // surface with no instruction over it is decoration, and an instruction
  // scoped to one type while another type's block sits above it cannot be
  // obeyed and satisfied at once. A payload that disclosed nothing gets no
  // instruction, because it would point at a surface that is not there.
  const surface =
    spanSurface && disclosed.length > 0
      ? `${spanSurface}\n\n${firmInstructionFor(disclosed.map((d) => d.name))}`
      : spanSurface;
  log(
    `[repair] refine span surface: types=${disclosed.length}` +
      `${disclosed.length > 0 ? ` (${disclosed.map((d) => d.name).join(", ")})` : " (nothing resolved)"}` +
      ` ms=${Date.now() - startedSurface}`,
  );

  const action = budget.next();
  if (action.kind !== "refine") {
    log(`[repair] refine declined why=${action.why}`);
    return;
  }
  // Held, not read twice: the same bytes must reach the prompt and the
  // transport, for the reason spelled out on the repair round above.
  const refineBlocks = await ctx.readContextBlocks?.();
  const prompt = assembleRefinePrompt({
    languageId: resolved.languageId,
    docComment: resolved.docComment,
    code,
    usage: sections,
    surface,
    kind: resolved.kind,
    bodyOnly: resolved.bodyOnly,
    // The column this span was cut from, same field and same defence as the
    // repair round above. Refine was the third path feeding a model absolute
    // columns and then placing the reply, so it walked the body one level per
    // press exactly as repair did (review D1).
    spanIndent: (resolved.bodyOnly ? resolved.bodyIndent : resolved.headerIndent) ?? "",
    // The doc's column, separately: see the repair round above.
    docIndent: resolved.bodyOnly ? "" : resolved.headerIndent ?? "",
    // Read LIVE, once, exactly as generation and repair read it: a block the
    // human removed since the gesture started is gone from this read.
    contextBlocks: refineBlocks,
  });
  log(
    `[repair] refine round ${action.round}/${REFINE_ROUND_CAP} model=${modelTag} windows=${windowCount} usage-chars=${totalChars - charsLeft}${surface ? " surface=injected" : ""}`,
  );
  const outcome = (result: string) => log(`[repair] refine outcome round=${action.round} result=${result}`);

  // As on the repair round: `withVerifyStatus` carries no token, so this claim
  // is the only way to stop a refine against a hung server.
  const controller = new AbortController();
  const claim = ctx.inFlight?.begin(`Refining ${resolved.symbolName}`, controller);
  let result;
  try {
    result = await ctx.service.generateRaw(prompt, {
      docComment: resolved.docComment,
      signature: resolved.signature,
      span: resolved.span,
      // As on the repair round: a body-only prompt gets a body-only reply, and
      // the head-anchored trim would refuse it.
      bodyOnly: resolved.bodyOnly,
      // Same checkpoint the generation and any repair round used.
      contextBlocks: refineBlocks,
    }, controller.signal);
  } catch (err) {
    // As on the repair round. Refine is the sharper case of the two: it is a
    // DIRECT user gesture reachable with no preceding generation, so before this
    // guard roadmap item 43's "no prompt-versus-window guard anywhere in the
    // product, on any path" was still literally true for it.
    if (isPromptWindowError(err)) {
      void vscode.window.showWarningMessage(err.message);
    }
    outcome("failed");
    return;
  } finally {
    claim?.release();
  }
  if (!result) {
    outcome("aborted");
    return;
  }

  // Same placement as generate and repair, through the same dispatcher: the
  // splice replaces the same span.
  result.text = placeGeneratedReply(result.text, {
    // The resolved record's, matching the dedent in assembleRefinePrompt. See
    // the repair round: dedenting through one language's scanner and
    // re-indenting through another's breaks the inverse property (review D2).
    languageId: resolved.languageId ?? ctx.document.languageId,
    bodyOnly: resolved.bodyOnly,
    // Injected hook, as on the repair round: absent means do not shift.
    headerIndent: resolved.headerIndent ?? "",
    bodyIndent: resolved.bodyIndent ?? "",
  });

  // "If it already matches, reply with it unchanged" is a real outcome the
  // prompt asks for, not a politeness, and here is where it lands. Showing the
  // human a diff of nothing is the worst version of this gesture.
  if (isNoOpRepair(code, result.text)) {
    log(`[repair] refine round ${action.round} returned the function unchanged; not proposed`);
    outcome("unchanged");
    // Defensive for headless stubs, the same guard every other status-bar call
    // on this page carries.
    if (typeof vscode.window.setStatusBarMessage === "function") {
      vscode.window.setStatusBarMessage(
        `Column 80: ${resolved.symbolName} already matches the usage the repo showed; nothing to change.`,
        8000,
      );
    }
    return;
  }

  // The one write path. No second route exists for a refine any more than for a
  // repair: the human reads the diff and accepts or rejects it.
  const proposal = await ctx.presenter.present({
    document: ctx.document,
    span: resolved.span,
    versionAtResolve,
    title: `${resolved.symbolName}: refine from repo usage (preview)`,
    text: result.text,
    service: ctx.service,
  });
  if (proposal === "discarded") {
    // present() already told the human (refine is a manual gesture, so the
    // system discard keeps its toast) and logged outcome=discarded; the
    // evidence line must agree with that log instead of calling the
    // product's own discard a human verdict (item 64 triage, same split
    // the repair round got). No why reaches this path: the presenter's
    // return value carries the verdict alone.
    outcome("discarded");
    return;
  }
  if (proposal !== "accept") {
    outcome("rejected");
    return;
  }

  // The hard bar, in the only place the invariants allow it to be: after the
  // consent gate, with the real compiler.
  if (ctx.document.isDirty && !(await ctx.document.save())) {
    outcome("failed");
    throw new Error(`could not save ${ctx.document.uri.fsPath} before the refine re-check`);
  }
  let after;
  try {
    after = await runOracleCheck(oracle, filePath, { log, envReason: surfaceEnvReason });
  } catch (err) {
    outcome("failed");
    throw err;
  }
  if (!after) {
    outcome("failed");
    return;
  }
  surfaceCheck(ctx, after, oracle);
  const introduced = introducedErrors(before.diagnostics, after.diagnostics);
  if (introduced.length === 0) {
    // A check can FAIL and parse no diagnostics: dotnet's SARIF file is written
    // out of band, so an MSBuild failure that is not a compiler error (a project
    // that is not restored, a locked output, a SARIF that never appeared) lands
    // as success=false with an empty list. Reading the diagnostics alone would
    // announce that state as a clean refine, which is the hard bar failing
    // silently at exactly the moment it matters. The verdict is BOTH.
    if (after.success === false) {
      log(
        `[repair] refine: the build no longer succeeds after this change, and the checker reported no` +
          ` parsed error to name (see the [oracle] check line above). Undo takes it back.`,
      );
      void vscode.window.showWarningMessage(
        `Column 80: the refine of ${resolved.symbolName} left the build failing, and the checker gave no error to show.` +
          ` Check the output channel, and use undo to take the change back.`,
      );
      outcome("check-failed-without-diagnostics");
      return;
    }
    outcome("clean");
    return;
  }
  // Loud, both channels. A style change that broke the build is the one outcome
  // of this gesture the human must not discover later by reading the file, and
  // the way back is the editor's own undo rather than a repair round: they asked
  // for a refine, and spending the compiler's reserved rounds cleaning up after
  // it would be the tool carrying on by itself.
  const first = introduced[0];
  const code0 = first.code ? `${first.code}: ` : "";
  log(
    `[repair] refine INTRODUCED ${introduced.length} error(s) that were not there before: ` +
      introduced.map((d) => `${d.code ?? "-"} ${d.message.slice(0, 70)}`).join(" | "),
  );
  // The digest above is a 70-char-per-error index, not the message. This line is
  // the whole first diagnostic, so the notification's channel pointer is a true
  // promise (roadmap item 69, second shape). Session-v57's S57-6 recorded that
  // the refine path already had this; it did not - it had the digest.
  log(`[repair] refine introduced first=${first.code ?? "-"}\n${first.message}`);
  outcome(`introduced-errors=${introduced.length}`);
  void vscode.window.showWarningMessage(
    // The interpolation sits MID-sentence here, so the undo instruction is the
    // `tail`: cutting the composed sentence would take the instruction with the
    // elaboration lines, and the instruction is the actionable half.
    oneLineWithPointer(
      `Column 80: the refine of ${resolved.symbolName} introduced ${introduced.length} error${introduced.length === 1 ? "" : "s"} that were not there before. ` +
        `First: ${code0}${first.message}`,
      ".",
      " Undo it with the editor's own undo (the build was clean before this change).",
    ),
  );
}

/** File text as lines for the window cutter, memoized for the round. Reads the
 *  OPEN buffer first and disk second: a reference in a file the human has edited
 *  and not saved would otherwise be rendered from stale bytes, which is the
 *  flycheck sin pointed the other way. An unreadable file yields undefined and
 *  that site is skipped, never guessed. */
function fileLineReader(): (uri: string) => readonly string[] | undefined {
  const cache = new Map<string, readonly string[] | undefined>();
  return (uri) => {
    if (cache.has(uri)) {
      return cache.get(uri);
    }
    let lines: readonly string[] | undefined;
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
    if (open) {
      lines = open.getText().split("\n");
    } else {
      try {
        // `Uri.parse().fsPath`, not a prefix strip. `Uri.toString()`
        // percent-encodes, so a workspace at `/home/me/My Projects/...` comes
        // back as `file:///home/me/My%20Projects/...`, every read is ENOENT,
        // every window is lost, and the gesture reports "no usage anywhere" for
        // a function full of call sites. The FIM sibling of this reader already
        // does it this way.
        lines = fs.readFileSync(refineFsPath(uri), "utf8").split("\n");
      } catch {
        lines = undefined;
      }
    }
    cache.set(uri, lines);
    return lines;
  };
}

/** The on-disk path for a uri. `Uri.parse().fsPath` where the editor gives one,
 *  and a decoded prefix strip where it does not: `Uri.toString()` percent-encodes,
 *  so the raw strip alone turns a workspace at `/home/me/My Projects` into an
 *  ENOENT on every reference hit, and the gesture then reports "no usage
 *  anywhere" for a function full of call sites. The fallback also covers a
 *  headless caller whose editor shim has no `fsPath`. */
function refineFsPath(uri: string): string {
  const parsed = (() => {
    try {
      const p = vscode.Uri.parse(uri).fsPath;
      return typeof p === "string" && p !== "" ? p : undefined;
    } catch {
      return undefined;
    }
  })();
  if (parsed !== undefined) {
    return parsed;
  }
  const stripped = uri.replace(/^file:\/\//, "");
  try {
    return decodeURIComponent(stripped);
  } catch {
    return stripped;
  }
}

/** A uri as a human reads it. `Uri.toString()` percent-encodes, and a channel
 *  line naming `My%20Projects/x.rs` sends the reader to a path that is not on
 *  their disk. Falls back to the raw string when it does not parse, because a
 *  slightly ugly line beats a lost one. */
function refineDisplayPath(uri: string): string {
  return refineFsPath(uri);
}

// Document spans are UTF-16 offsets; compiler spans are bytes. Convert via
// UTF-8 length of the prefix so scope intersection speaks the compiler's
// unit. crateRoot and the strategy's resolvePath ride along so eligibility
// resolves span paths exactly the way the mirror does.
function byteScope(
  document: vscode.TextDocument,
  filePath: string,
  crateRoot: string,
  span: FunctionSpan,
  resolvePath: (crateRoot: string, fileName: string) => string,
): RepairScope {
  const text = document.getText();
  const encoder = new TextEncoder();
  const byteStart = encoder.encode(text.slice(0, span.start)).length;
  const byteEnd = byteStart + encoder.encode(text.slice(span.start, span.end)).length;
  return { filePath, crateRoot, byteStart, byteEnd, resolvePath };
}

// The deterministic in-span import fix, bounded. A missing-but-resolvable name
// is qualified to its full path through the ONE write path (the presenter), so
// the function-boundary and single-write invariants both hold, and no repair
// round is spent - the compiler already knows the answer.
const QUALIFY_CAP = 5;

async function runQualifyPass(
  ctx: PostAcceptContext,
  oracle: CompilerOracle,
  extractor: SurfaceExtractor,
  check: OracleCheckResult,
  resolved: ResolvedFunction | undefined,
  filePath: string,
  log: (line: string) => void,
): Promise<{ check: OracleCheckResult; resolved: ResolvedFunction | undefined } | undefined> {
  let changed = false;
  for (let i = 0; i < QUALIFY_CAP; i++) {
    if (!resolved || check.diagnostics.filter((d) => d.level === "error").length === 0) {
      break;
    }
    const target = firstQualifiable(check.diagnostics, ctx.document, resolved.span);
    if (!target) {
      break;
    }
    // Python's rung-2 owned-import spine runs first. When the undefined name is
    // exactly one top-level module (PY_STDLIB_MODULES plus the venv catalog),
    // pyOwnedImportEdit builds a deterministic `import <name>` at the imports
    // region, presented out-of-span and RATIFIED by a re-check. Rung 2 (owned,
    // deterministic) beats the LS: an identical `import numpy` whether via rung 2
    // or Pylance, so nothing is lost trying it first. If rung 2 is DARK (a symbol
    // import like `from pathlib import Path`), fall to extractor.qualifyImport
    // (Pylance code action / workspace auto-import) below.
    if (ctx.document.languageId === "python") {
      const name = pyUndefinedNameAt(check.diagnostics, ctx.document, resolved.span, target);
      const owned = name
        ? pyOwnedImportEdit(
            name,
            // Deduped: a name in BOTH the stdlib set and the venv catalog yields
            // the SAME `import <name>` edit, so it must count as one unambiguous
            // hit, not two (pyOwnedImportEdit's single-hit contract). Without the
            // Set a stdlib-shadowing package would send rung 2 dark.
            [...new Set([...PY_STDLIB_MODULES, ...(oracle.catalog?.(check.crateRoot) ?? [])])],
            ctx.document.getText(),
          )
        : undefined;
      if (owned) {
        const applied = await presentOwnedImportAndRecheck(ctx, oracle, resolved, owned, name!, filePath, log);
        if (!applied) {
          break; // offered but not accepted, or the re-check did not clear the name
        }
        check = applied;
        surfaceCheck(ctx, check, oracle);
        changed = true;
        resolved = await ctx.resolveFunction(ctx.document, ctx.document.positionAt(resolved.span.start));
        continue;
      }
      // rung 2 dark: fall through to extractor.qualifyImport (rung 1/3) below.
    }
    // C#'s out-of-span auto-import leg. Roslyn's AddImport `using X;` action adds
    // an import DIRECTIVE at the top of the file — the C#-idiomatic default per the
    // goal decision (a using is illegal inside a method body, so the in-span option
    // can only ever be fully-qualification). It rides offerOutOfSpanImport the way
    // Python/TS auto-imports do, through the one consent gate. Tried FIRST; if
    // Roslyn offers no using (already imported, or unresolvable), fall through to
    // the in-span fully-qualify (qualifyImport) below. The importAction recognizer
    // keys on the AddImport CustomTag, distinct from isCsFullyQualifyTitle, which
    // still serves the in-span path unchanged.
    if (ctx.document.languageId === "csharp" && extractor.importAction) {
      let importEdit: QualifyEdit | undefined;
      try {
        importEdit = await extractor.importAction({ uri: ctx.document.uri.toString(), ...target });
      } catch {
        importEdit = undefined;
      }
      if (importEdit) {
        offerOutOfSpanImport(ctx, resolved, importEdit, log);
        break;
      }
      // no using offered: fall through to the in-span fully-qualify below.
    }
    let edit: QualifyEdit | undefined;
    try {
      edit = await extractor.qualifyImport({ uri: ctx.document.uri.toString(), ...target });
    } catch {
      edit = undefined;
    }
    if (!edit) {
      break; // no assist: a genuinely unresolvable name is the surface loop's job
    }
    // A TS/Python/Go auto-import is ALWAYS a top-of-file import edit - outside
    // the accepted span semantically even when the function starts at offset 0
    // - so it takes the detached consent offer, never the in-span
    // splice-and-await below (gopls's Add import is an imports-region edit,
    // the same family). Rust keeps the in-span invariant unchanged.
    if (
      TS_LANGUAGE_IDS.has(ctx.document.languageId) ||
      ctx.document.languageId === "python" ||
      ctx.document.languageId === "go"
    ) {
      offerOutOfSpanImport(ctx, resolved, edit, log);
      break;
    }
    const qualifiedText = applyQualifyToFunction(ctx.document, resolved.span, edit);
    if (qualifiedText === undefined) {
      break; // the edit fell outside the function span; never touch it
    }
    const versionAtResolve = ctx.document.version;
    log(`[repair] qualify ${edit.newText}`);
    const proposal = await ctx.presenter.present({
      document: ctx.document,
      span: resolved.span,
      versionAtResolve,
      title: `${resolved.symbolName}: qualify import (preview)`,
      text: qualifiedText,
      service: ctx.service,
      // Same rule as the repair round: a background fim session's system
      // discard is a channel line, never a toast (item 64, mechanical half).
      onSystemDiscard:
        ctx.source === "fim"
          ? (why) => log(`[repair] qualify proposal discarded — ${why} (background fim session: no toast)`)
          : undefined,
    });
    if (proposal !== "accept") {
      break;
    }
    if (ctx.document.isDirty && !(await ctx.document.save())) {
      break;
    }
    const rechecked = await runOracleCheck(oracle, filePath, { log, envReason: surfaceEnvReason });
    if (!rechecked) {
      break;
    }
    check = rechecked;
    surfaceCheck(ctx, check, oracle);
    changed = true;
    resolved = await ctx.resolveFunction(ctx.document, ctx.document.positionAt(resolved.span.start));
  }
  return changed ? { check, resolved } : undefined;
}

// The out-of-span TS import offer: the auto-import edit routes through the
// ONE consent gate (a presenter proposal spanning the edit's own range),
// fire-and-forget so the session never blocks on the human decision - and the
// exact edit is stated on the verdict surface. Shown, never silently applied:
// the only write is the presenter's own accept path.
function offerOutOfSpanImport(
  ctx: PostAcceptContext,
  resolved: ResolvedFunction,
  edit: QualifyEdit,
  log: (line: string) => void,
): void {
  const start = ctx.document.offsetAt(new vscode.Position(edit.range.startLine, edit.range.startCharacter));
  const end = ctx.document.offsetAt(new vscode.Position(edit.range.endLine, edit.range.endCharacter));
  if (start > end) {
    return;
  }
  const exact = edit.newText.trim();
  log(`[repair] qualify import (out-of-span) ${exact}`);
  if (typeof vscode.window.setStatusBarMessage === "function") {
    vscode.window.setStatusBarMessage(`Column 80: import proposed: ${exact}`, 8000);
  }
  void ctx.presenter
    .present({
      document: ctx.document,
      span: { start, end },
      versionAtResolve: ctx.document.version,
      title: `${resolved.symbolName}: add import (preview)`,
      text: edit.newText,
      service: ctx.service,
      // Same rule as the repair round: a background fim session's system
      // discard is a channel line, never a toast (item 64, mechanical half).
      onSystemDiscard:
        ctx.source === "fim"
          ? (why) => log(`[repair] qualify import discarded — ${why} (background fim session: no toast)`)
          : undefined,
    })
    .then((outcome) => log(`[repair] qualify import outcome=${outcome}`))
    .catch((err) => log(`[repair] qualify import failed: ${String(err)}`));
}

// The undefined NAME at a Python qualify target: the `"X" is not defined` name
// from the first reportUndefinedVariable whose primary cursor equals `target`
// and sits inside the accepted span. undefined when none matches (rung 2 needs
// the concrete module name to build its owned `import <name>`).
function pyUndefinedNameAt(
  diagnostics: Diagnostic[],
  document: vscode.TextDocument,
  span: FunctionSpan,
  target: { line: number; character: number },
): string | undefined {
  for (const d of diagnostics) {
    if (d.level !== "error") {
      continue;
    }
    const cursor = pyUnresolvedNameCursor(d);
    if (!cursor || cursor.line !== target.line || cursor.character !== target.character) {
      continue;
    }
    const offset = document.offsetAt(new vscode.Position(cursor.line, cursor.character));
    if (offset < span.start || offset > span.end) {
      continue;
    }
    const m = /"([^"]+)" is not defined/.exec(d.message);
    if (m) {
      return m[1];
    }
  }
  return undefined;
}

// Present Python's rung-2 owned `import <name>` out-of-span (the ONE consent
// gate, awaited so the edit is ratified), then re-check. Returns the rechecked
// result ONLY when the human accepted AND the re-check cleared the name (rung 2
// is oracle-ratified: an owned import that did not resolve the name is rejected).
// undefined otherwise, so the caller stops rather than re-offering the same edit.
async function presentOwnedImportAndRecheck(
  ctx: PostAcceptContext,
  oracle: CompilerOracle,
  resolved: ResolvedFunction,
  edit: QualifyEdit,
  name: string,
  filePath: string,
  log: (line: string) => void,
): Promise<OracleCheckResult | undefined> {
  const start = ctx.document.offsetAt(new vscode.Position(edit.range.startLine, edit.range.startCharacter));
  const end = ctx.document.offsetAt(new vscode.Position(edit.range.endLine, edit.range.endCharacter));
  if (start > end) {
    return undefined;
  }
  log(`[repair] qualify import (rung 2, owned) ${edit.newText.trim()}`);
  const proposal = await ctx.presenter.present({
    document: ctx.document,
    span: { start, end },
    versionAtResolve: ctx.document.version,
    title: `${resolved.symbolName}: add import (preview)`,
    text: edit.newText,
    service: ctx.service,
    // Same rule as the repair round: a background fim session's system
    // discard is a channel line, never a toast (item 64, mechanical half).
    onSystemDiscard:
      ctx.source === "fim"
        ? (why) => log(`[repair] qualify import discarded — ${why} (background fim session: no toast)`)
        : undefined,
  });
  if (proposal !== "accept") {
    return undefined;
  }
  if (ctx.document.isDirty && !(await ctx.document.save())) {
    return undefined;
  }
  const rechecked = await runOracleCheck(oracle, filePath, { log, envReason: surfaceEnvReason });
  if (!rechecked) {
    return undefined;
  }
  // The oracle ratifies: if the name is STILL undefined, the owned import did not
  // resolve it — reject (do not keep offering the same non-fix).
  const stillUndefined = rechecked.diagnostics.some(
    (d) => d.level === "error" && d.code === "reportUndefinedVariable" && d.message.includes(`"${name}"`),
  );
  if (stillUndefined) {
    log(`[repair] qualify import (rung 2) did not resolve "${name}" — rejected`);
    return undefined;
  }
  return rechecked;
}

// The first error whose message is a missing-but-resolvable name AND whose
// primary span sits inside the accepted function (UTF-16 offsets, the document's
// unit). Cursor is 0-based line/character. The name matcher is the language's
// own: rustc's in-this-scope family, or the TS2304/TS2552 cannot-find-name
// codes (the TS qualify class).
export function firstQualifiable(
  diagnostics: Diagnostic[],
  document: vscode.TextDocument,
  span: FunctionSpan,
): { line: number; character: number } | undefined {
  // The Rust `cannot find ... in this scope` heuristic provably does NOT
  // match a CS0246/CS0234/CS0103 message, so csharp gets its
  // own cursor variant. Rust/TS dispatch is unchanged.
  const nameCursor = TS_LANGUAGE_IDS.has(document.languageId)
    ? tsUnresolvedNameCursor
    : document.languageId === "csharp"
      ? csUnresolvedNameCursor
      : document.languageId === "python"
        ? pyUnresolvedNameCursor
        : unresolvedNameCursor;
  for (const d of diagnostics) {
    if (d.level !== "error") {
      continue;
    }
    const cursor = nameCursor(d);
    if (!cursor) {
      continue;
    }
    const offset = document.offsetAt(new vscode.Position(cursor.line, cursor.character));
    if (offset >= span.start && offset <= span.end) {
      return cursor;
    }
  }
  return undefined;
}

// Apply a QualifyEdit to the accepted function's text, returning the new text.
// undefined when the edit range is not fully inside the span - the qualify fix
// must never modify bytes outside the function (invariant 2).
export function applyQualifyToFunction(
  document: vscode.TextDocument,
  span: FunctionSpan,
  edit: QualifyEdit,
): string | undefined {
  const startOff = document.offsetAt(new vscode.Position(edit.range.startLine, edit.range.startCharacter));
  const endOff = document.offsetAt(new vscode.Position(edit.range.endLine, edit.range.endCharacter));
  if (startOff < span.start || endOff > span.end || startOff > endOff) {
    return undefined;
  }
  const funcText = document.getText(
    new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)),
  );
  return funcText.slice(0, startOff - span.start) + edit.newText + funcText.slice(endOff - span.start);
}

// The distinct missing-dependency crates named by errors IN the accepted
// document (span resolves to filePath, so a pre-existing error in another file
// is not blamed on this generation). Independent of the function span, so a
// crate error that landed out of span is still caught.
export function documentMissingCrates(
  diagnostics: Diagnostic[],
  filePath: string,
  crateRoot: string,
  resolvePath: (crateRoot: string, fileName: string) => string = resolveDiagnosticPath,
): string[] {
  const crates = new Set<string>();
  for (const d of diagnostics) {
    if (d.level !== "error") {
      continue;
    }
    const cls = classifyHallucination(d);
    if (cls?.kind !== "unresolved-crate") {
      continue;
    }
    const primary = d.spans.find((s) => s.isPrimary);
    if (primary && resolvePath(crateRoot, primary.fileName) === filePath) {
      crates.add(cls.crate);
    }
  }
  return [...crates];
}

// Build the E0433 feature-graph resolution for a crate: cargo metadata (host-
// scoped, offline) plus the crates' own on-disk lib.rs read locally under
// ~/.cargo/registry/src. undefined when metadata fails - the classifier then
// leaves an E0433 `cannot find X in Y` unclassified (rides plain repair), never
// a wrong steer. Reaches no network: cargo metadata and the registry source are
// both local.
// The diagnostics the feature-graph resolution can change a verdict on: an E0433
// `cannot find X in Y` inline path, AND - the common case a generated function
// body produces - an E0432 multi-segment `use crate::module::...` import of a
// cfg-gated module. Cheap pre-check so metadata is fetched only when it matters.
function isPotentialNeedsFeature(d: Diagnostic): boolean {
  if (d.code === "E0433" && /cannot find `[^`]+` in `[\w:]+`/.test(d.message)) {
    return true;
  }
  return d.code === "E0432" && /unresolved imports? `[\w]+(?:::[\w]+)+`/.test(d.message);
}

async function buildCrateResolution(
  crateRoot: string,
  log: (line: string) => void,
): Promise<CrateResolution | undefined> {
  const triple = await resolveHostTriple();
  const metadata = await fetchMetadataJson(crateRoot, undefined, triple);
  if (metadata === undefined) {
    log(`[repair] feature-graph resolution unavailable: cargo metadata failed`);
    return undefined;
  }
  return buildResolution(metadata as never, (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return undefined; // a crate whose lib is not at the conventional path: no gate known
    }
  });
}

// A repair is a no-op when it differs from the current function only in
// whitespace: collapse runs of whitespace, trim, compare. Catches the model
// regenerating a near-identical body because it cannot fix the error.
export function isNoOpRepair(current: string, repaired: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(current) === norm(repaired);
}

// Inject the surface for ALL classifiable eligible errors in one
// round (all-eligible), not just the first (first-eligible). Collect every
// eligible error's surface, dedup by kind:type (span identity for the empty-type
// E0599 fallback so distinct receivers do not collapse), combine the blocks with
// ONE shared FIRM_INSTRUCTION (each block omits its own), cap at the budget
// profile's surfaceCap (4 at identity) distinct surfaces with drop logging.
// Terminal steers keep short-circuiting: a steerable unresolved-crate returns
// the catalog ALONE; needs-feature returns its steer alone. local-symbol is
// NON-terminal and coexists with method blocks. undefined when no class
// resolves anything. Return stays `string | undefined` (assembleRepairPrompt
// takes a string) for minimal blast radius.
//
// The surface cap and the per-type member cap (the ONE shared cap the prepare
// side also uses, still 24 at identity) both come from `budgetProfileFor` at
// the round's entry, so a moved class-language cell reaches every leg below;
// a member list past the codegen knee is the failure both caps exist to stop.
//
// THE ONE BLOCK LEFT ON A FIXED FENCE: the derives block composes itself from `#[derive(...)]` attribute lines, so
// no line of it can open a fence run. The two data-shape blocks wrap rendered
// LSP text and take `fenceFor` instead.
const FENCE = "```";

// The DEPTH-1 struct def of the receiver type an invented
// field was accessed on. hoverSurface at the access site first (its signature IS
// the struct def when RA resolves the receiver), else assemble a struct def from
// membersOfType's FIELD members. Deliberately NOT the recursive walk - the
// diagnostic already named the exact receiver, so one level of its own fields is
// the self-terminating fix. undefined when neither query yields a shape (honest
// degrade); never throws.
// The receiver type Y (rustc-named by an E0609) resolves to a struct ONLY when
// hovered at a REAL type reference — a `use` import or a signature/type position —
// NOT at the invalid-field access cursor, where rust-analyzer yields nothing (the
// confirmed cross-file/crate gap). This finds such a reference in the
// document so the field leg resolves Y's shape wherever Y lives. Prefers a `use`
// import (the persona's imported-type case), else the first non-comment bare
// occurrence of the type name. undefined when Y is not referenced in the file.
function findReceiverTypeReference(
  document: vscode.TextDocument,
  type: string,
): { uri: string; line: number; character: number } | undefined {
  if (type.length === 0) {
    return undefined;
  }
  const uri = document.uri.toString();
  const lines = document.getText().split("\n");
  const word = new RegExp(`\\b${type}\\b`);
  const useLine = /^(?:pub\s*(?:\([^)]*\))?\s+)?use\s/;
  for (let i = 0; i < lines.length; i++) {
    if (useLine.test(lines[i].trim())) {
      const m = word.exec(lines[i]);
      if (m) {
        return { uri, line: i, character: m.index };
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("//")) {
      continue;
    }
    const m = word.exec(lines[i]);
    if (m) {
      return { uri, line: i, character: m.index };
    }
  }
  return undefined;
}

async function resolveFieldShape(
  extractor: SurfaceExtractor,
  cursor: { uri: string; line: number; character: number },
  type: string,
  log: (line: string) => void,
  memberCap: number,
): Promise<string | undefined> {
  // Build the receiver's shape from the SHARED primitives
  // (parseStructHoverFields + renderDerivedDef, crossFileShape.ts) so exactly one
  // struct-shape renderer exists across prepare and repair. hover (RA-indexed,
  // cross-file/crate) is the primary and folds byte-identically — renderDerivedDef
  // returns the hover signature verbatim. membersOfType field members are the
  // fallback (names-only; a field at an access site rarely enclosing a container).
  let derived: DerivedType | undefined;
  try {
    const hover = await extractor.hoverSurface(cursor);
    if (hover?.signature && /\b(?:struct|enum|union)\b/.test(hover.signature)) {
      const signature = hover.signature.trim();
      derived = { name: type, signature, fields: parseStructHoverFields(signature), methods: [], methodsResolved: false };
    }
  } catch {
    derived = undefined;
  }
  if (!derived) {
    try {
      const members = await extractor.membersOfType(cursor);
      const fieldMembers = members.filter((m) => m.kind === "field");
      // Cap the fields with the ONE shared member cap: a wide struct must not
      // flood the repair prompt past the codegen knee. Overflow logged, not silent.
      let capped = fieldMembers;
      if (fieldMembers.length > memberCap) {
        capped = fieldMembers.slice(0, memberCap);
        const droppedFields = fieldMembers.slice(memberCap).map((m) => m.name);
        log(
          `[repair] surface truncated \`${type}\` fields: ` +
            `kept ${memberCap} of ${fieldMembers.length} (dropped ${droppedFields.join(", ")})`,
        );
      }
      if (capped.length > 0) {
        const fields = capped.map((m) => {
          const sig = m.signature ?? m.name;
          const colon = sig.indexOf(":");
          return colon >= 0
            ? { name: sig.slice(0, colon).trim(), typeName: sig.slice(colon + 1).trim() }
            : { name: m.name, typeName: "" };
        });
        derived = { name: type, signature: "", fields, methods: [], methodsResolved: false };
      }
    } catch {
      derived = undefined;
    }
  }
  if (!derived) {
    log(`[repair] surface miss class=unresolved-field for=${type}: receiver shape unresolved`);
    return undefined;
  }
  const shape = renderDerivedDef(derived);
  const fence = fenceFor(shape);
  return `Data shape of \`${type}\` (fields and types):\n${fence}rust\n${shape}\n${fence}`;
}

/** The item-3 line for diagnostics the classifier had no rule for, on the paths
 *  that return BEFORE the harvest pass can run (the two terminal steers). Those
 *  diagnostics never reach the harvest, so what is owed is the honest smaller
 *  claim: the classifier matched nothing and this round went out steering at
 *  something else instead. */
function unclassifiedNoSurface(
  unclassified: readonly { d: Diagnostic; lead?: string }[],
  lang: RepairSurfaceLang,
  document: vscode.TextDocument,
  codeOf: (d: Diagnostic) => string,
  log: (line: string) => void,
): void {
  for (const { d, lead } of unclassified) {
    log(
      `[repair] surface none for ${codeOf(d)}: ` +
        // A diagnostic that classified and then resolved nothing reaches the
        // harvest queue too, so this line must not tell the reader no rule
        // matched when one did. Its own leg's account leads.
        `${lead ?? `no ${document.languageId} classifier rule matched`}, and a terminal steer ` +
        `returned before the diagnostic harvest could run` +
        (lang.harvestTypes === undefined ? " (this language has no harvest)" : ""),
    );
  }
}

/** One harvested name resolved to a definition block, or a REASON it produced
 *  nothing. Never throws; the reason is always populated on a miss, because a
 *  silent miss here is the exact failure this leg exists to close.
 *
 *  Depth 1 and the same renderer as the classified field path, deliberately. The
 *  two highest-value codes this leg exists for both want the definition itself
 *  rather than a walk: E0063 is a missing field, so the field list IS the answer,
 *  and E0277 is a trait bound, where what the model needs is the declaration. No
 *  new bound, no new budget and no second renderer, which is what keeps this a
 *  rule replacing a table rather than a second injection engine.
 *
 *  Provenance is checked BEFORE the shape is rendered, so a sysroot type costs
 *  one definition round trip and no prompt bytes. */
async function harvestedTypeBlock(args: {
  name: string;
  extractor: SurfaceExtractor;
  document: vscode.TextDocument;
  lang: RepairSurfaceLang;
  log: (line: string) => void;
  /** As on MemberBlockArgs: the round's resolved per-type member cap. */
  memberCap: number;
  /** The name's SHAPE is already in the prompt from another leg, so render only
   *  what that leg did not: the derives. Disclosure is per BLOCK, not per type,
   *  and the round-1 surface renders a declaration without its attributes - so
   *  treating "disclosed" as "nothing left to say" is what made item 2 buy
   *  nothing on its own E0277 worked example. */
  derivesOnly?: boolean;
}): Promise<{ payload?: string; reason?: string }> {
  const { name, extractor, document, lang, log, memberCap, derivesOnly } = args;
  // A real reference to the type in THIS document, and NO fallback to the
  // diagnostic's cursor. This is the one place the harvest leg must be stricter
  // than the classified field path it borrows, and the asymmetry is the point.
  //
  // The classified path may anchor at the error cursor because rustc named that
  // type AS the receiver at that position, so the hover there is about the right
  // thing. A harvested name has no such warrant: it is one of several names a
  // message happened to mention. Hovering the error cursor for it would resolve
  // whatever expression failed, and `resolveFieldShape` labels the shape it gets
  // with the name it was ASKED about - so a mismatch renders type B's definition
  // under the header "Data shape of `A`", inside a payload whose instruction says
  // to use these exact names. A wrong definition is worse than no definition, and
  // this codebase has paid for the wrong-type inject before.
  //
  // The cost is close to zero for the cases the item exists for. A body that
  // triggered `missing field \`x\` in initializer of \`SampledAggregate\`` wrote
  // `SampledAggregate` in the document, which is why the error fired at all, and
  // `ApiKeysConfig` is in the target's own signature.
  const cursor = findReceiverTypeReference(document, name);
  if (!cursor) {
    return { reason: `\`${name}\` is not referenced in this file, so there is no safe cursor to resolve it at` };
  }
  if (lang.isStdlibDef) {
    let defUri: string | undefined;
    try {
      defUri = (await extractor.definition(cursor))?.uri;
    } catch {
      defUri = undefined;
    }
    // An unresolvable definition is NOT treated as stdlib. The rule refuses what
    // it can prove is foreign; it must never refuse a project type because a
    // round trip failed.
    if (defUri !== undefined && lang.isStdlibDef(defUri)) {
      return { reason: `\`${name}\` is defined in the standard library (${defUri}), which the model already knows` };
    }
  }
  // SECOND guard, and the load-bearing one: the anchor has to resolve to a
  // definition that DECLARES this name.
  //
  // Checking the rendered text is not enough, and the reason is worth stating
  // because it looks enough. `resolveFieldShape` has two legs. The hover leg
  // returns rust-analyzer's real `pub struct Foo { … }` signature, where a name
  // check works. The `membersOfType` fallback SYNTHESIZES a definition through
  // `renderDerivedDef`, writing `struct <the name we asked for> { …whatever
  // members came back… }` - so a name check on that output is tautological, and
  // it passes however wrong the fields are.
  //
  // The concrete failure: `findReceiverTypeReference` skips only `//` lines, so a
  // `/* … */` comment or a string literal mentioning `Ledger` inside ANOTHER
  // struct's body anchors there. Hover resolves nothing at that position, and
  // `membersOfType` is a documentSymbol descent to the struct ENCLOSING the
  // cursor, which is the other struct. The payload then tells the model `Ledger`
  // has `Snapshot`'s fields, under "use these exact names, do not invent".
  //
  // So the harvest leg requires the HOVER to declare the name, and refuses the
  // synthesized fallback entirely. The classified path keeps that fallback: there
  // rustc named the type as the receiver AT the cursor, which is the warrant a
  // harvested name does not have. One extra hover round trip against a
  // wrong-definition inject is a trade worth making every time.
  let hoverDeclares = false;
  try {
    const hover = await extractor.hoverSurface(cursor);
    const declared = hover?.signature
      ? /\b(?:struct|enum|union|trait|type)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(hover.signature)
      : undefined;
    hoverDeclares = declared?.[1] === name;
  } catch {
    hoverDeclares = false;
  }
  if (!hoverDeclares) {
    return {
      reason:
        `\`${name}\` anchored somewhere that does not declare it, so nothing was injected ` +
        `(a synthesized shape here would have carried another type's members under this name)`,
    };
  }
  const derivesOnlyBlock = derivesOnly ? await readDeriveAttributes(extractor, cursor) : undefined;
  if (derivesOnly) {
    return derivesOnlyBlock
      ? { payload: `The type \`${name}\` is already described above. ${derivesOnlyBlock}` }
      : { reason: `\`${name}\` is already disclosed by another leg and carries no derives to add` };
  }
  const payload = await lang.fieldShape(extractor, cursor, name, log, memberCap);
  if (!payload) {
    return { reason: `\`${name}\` resolved to no definition shape` };
  }
  // THE DERIVES, which for a trait-bound error are the entire answer. Item 2's own
  // worked example is `the trait bound \`ApiKeysConfig: serde::Deserialize<'de>\`
  // is not satisfied`, and the goal says of it: "its derives are the answer". A
  // field list is not: the live witness on that row showed `ApiKeysConfig`'s
  // fields were ALREADY in the round-1 prompt and the generation still failed
  // E0277, because what the model could not see was the `#[derive(...)]` line.
  //
  // rust-analyzer's hover gives the declaration without its attributes, so the
  // derives are read from the definition FILE, upward from the declaration line.
  // That is still compiler-directed: the cursor came from `definition()`, so the
  // bytes trace to the diagnostic exactly as the shape's do.
  const derives = await readDeriveAttributes(extractor, cursor);
  return { payload: derives ? `${payload}\n${derives}` : payload };
}

/** The attribute lines immediately above a type's declaration, rendered as one
 *  line of evidence, or undefined when there are none.
 *
 *  Reads the definition's own file at the definition cursor. Scans UPWARD from the
 *  declaration and stops at the first line that is neither an attribute nor a doc
 *  comment nor blank, so it collects a type's own attributes and can never walk
 *  into the previous item's. Never throws: no derives is the honest degrade, and a
 *  repair round with a field list and no derive line is what shipped before. */
async function readDeriveAttributes(
  extractor: SurfaceExtractor,
  cursor: SourceCursorLite,
): Promise<string | undefined> {
  try {
    const def = await extractor.definition(cursor);
    if (!def) {
      return undefined;
    }
    const text = (await vscode.workspace.openTextDocument(vscode.Uri.parse(def.uri))).getText();
    const lines = text.split("\n");
    const attrs: string[] = [];
    // Bounded: no real declaration carries more than a handful of attribute
    // lines, and an unbounded walk up a file is how a malformed def location
    // turns into a scan of the whole crate.
    for (let i = def.range.startLine - 1, seen = 0; i >= 0 && seen < 12; i--, seen++) {
      const line = lines[i]?.trim() ?? "";
      if (line === "" || line.startsWith("///") || line.startsWith("//!") || line.startsWith("//")) {
        continue;
      }
      if (line.startsWith("#[") || line.startsWith("#![")) {
        attrs.unshift(line);
        continue;
      }
      break;
    }
    // Only the DERIVES, not every attribute. `#[repr(C)]` and `#[serde(rename_all
    // = "camelCase")]` are true of the type and are not what a trait-bound error
    // is about, and a repair prompt that grows for every attribute stops being
    // about the diagnostic.
    const derives = attrs.filter((a) => /^#\[derive\b/.test(a));
    return derives.length > 0 ? `Derives on it (traits it already implements):\n${FENCE}rust\n${derives.join("\n")}\n${FENCE}` : undefined;
  } catch {
    return undefined;
  }
}

// ===========================================================================
// The per-language repair-surface seam. resolveSurfaceInjection
// dispatches on the injection DOCUMENT's languageId to a
// hooks object; the Rust hooks are the pre-seam behavior verbatim, so every
// frozen Rust suite sees byte-identical decisions and log lines. No language
// branch lives inside the resolver loop itself.
// ===========================================================================

type SourceCursorLite = { uri: string; line: number; character: number };
type MemberClass = Extract<HallucinationClass, { kind: "unresolved-method" | "unresolved-assoc" | "wrong-item" }>;

interface MemberBlockArgs {
  cls: MemberClass;
  typeOrCrate: string;
  cursor: SourceCursorLite;
  extractor: SurfaceExtractor;
  document: vscode.TextDocument;
  log: (line: string) => void;
  /** The per-type member cap from the round's budget cell (the ONE shared cap,
   *  24 at identity), threaded rather than read here so every leg in one round
   *  caps against the same resolved profile. */
  memberCap: number;
}

interface RepairSurfaceLang {
  classify: (
    d: Diagnostic,
    resolution?: CrateResolution,
    localDefs?: Set<string>,
  ) => HallucinationClass | undefined;
  /** Resolve one member-class block (payload sans the shared instruction) in
   *  this language's leg order; undefined when nothing resolves. `isSurface`
   *  says whether the payload IS an injected API surface: steer-only payloads
   *  (the TS wrong-item steer) are not, so a payload of only steers must not
   *  carry the FIRM_INSTRUCTION that governs a surface. Every Rust block is a
   *  surface, which keeps the Rust bytes identical by construction. */
  memberBlock: (args: MemberBlockArgs) => Promise<{ payload: string; via: string; isSurface: boolean } | undefined>;
  /** The dedup identity for one member-class diagnostic (before the span
   *  fallback). Rust dedups by receiver/crate alone - one crate surface serves
   *  all its wrong-items. The TS wrong-item payload is ITEM-specific, so its
   *  identity carries the quoted item too; collapsing on the module would
   *  silently drop the second missing export's steer. */
  memberDedupId: (cls: MemberClass, typeOrCrate: string) => string;
  /** The unresolved-field receiver-shape resolver (hover guard + renderer
   *  are language-shaped). `memberCap` as on MemberBlockArgs. */
  fieldShape: (
    extractor: SurfaceExtractor,
    cursor: SourceCursorLite,
    type: string,
    log: (line: string) => void,
    memberCap: number,
  ) => Promise<string | undefined>;
  /** The type names this language's diagnostic NAMES, for the diagnostics its
   *  classifier has no rule for. Absent means the language keeps the
   *  classifier-only behaviour: rustc quotes with backticks, C# and TypeScript
   *  with apostrophes, and their classifiers already read their own message
   *  shapes, so one harvest cannot serve all five. Rust fills it because Rust
   *  is where the 16-of-28 measurement was taken. */
  harvestTypes?: (d: Diagnostic) => string[];
  /** Is a harvested type's DEFINITION one the model already knows, so nothing
   *  should be rendered for it? Item 1's rule on the repair round, or the same
   *  waste reappears here. Absent means no type is refused on provenance. */
  isStdlibDef?: (defUri: string) => boolean;
}

// Preserved per-diagnostic in the combine: a wrong method NAME
// (unresolved-method) gets the type's member LIST first - it guarantees the
// real method is present AND renders it as an explicit signature that reads
// as the allowed set. A usage example can bury the method in an assert (the
// live `count` -> `tally_cohort` no-op, where new()'s doctest holds
// tally_cohort only inside an assert_eq!) or omit it, and reads as a sample.
// A wrong CONSTRUCTOR/builder (unresolved-assoc) and wrong-item keep the
// worked EXAMPLE first: the construction sequence is the non-obvious part a
// flat signature list does not convey. Each falls back to the other shape
// when its preferred surface does not resolve.
async function rustMemberBlock(args: MemberBlockArgs): Promise<{ payload: string; via: string; isSurface: boolean } | undefined> {
  const { cls, typeOrCrate, cursor, extractor, log, memberCap } = args;
  const prefer = "item" in cls ? cls.item : "type" in cls ? cls.type : undefined;
  const resolveExample = async (): Promise<string | undefined> => {
    try {
      return await extractor.example(cursor, prefer);
    } catch {
      return undefined;
    }
  };
  // NO VISIBILITY PASS HERE, and that is a provable no-op rather than a gap.
  // These members come from a COMPLETION list, and a completion-list member
  // carries no declaration position (src/core/extraction.ts CompletionMember),
  // so every rule in src/core/memberVisibility.ts answers `unknown` and keeps.
  // Running it would cost a def-file read to change nothing. The exposure that
  // remains is the completion provider's: rust-analyzer's list is already
  // visibility-aware at the cursor it was asked at.
  const resolveSignatures = async (): Promise<string | undefined> => {
    try {
      const members = semanticMembers(await extractor.completeMembers(cursor));
      // Cap the RENDERABLE members (those with a fn signature), NOT the raw
      // list: completeMembers can return non-signature members first, so a raw
      // slice would starve the real methods. Mirror the
      // generate-side twin (fnGen.ts localTypeBlock): filter to renderable,
      // cap, log the dropped METHOD NAMES - no silent truncation.
      const renderable = members.filter((m) => m.signature !== undefined);
      let capped = renderable;
      if (renderable.length > memberCap) {
        capped = renderable.slice(0, memberCap);
        const droppedMembers = renderable.slice(memberCap).map((m) => m.name);
        log(
          `[repair] surface truncated \`${typeOrCrate}\` members: ` +
            `kept ${memberCap} of ${renderable.length} (dropped ${droppedMembers.join(", ")})`,
        );
      }
      const rendered = capped.length > 0 ? renderMemberSignatures(capped) : "";
      return rendered.length > 0 ? rendered : undefined;
    } catch {
      return undefined;
    }
  };
  let example: string | undefined;
  let signatures: string | undefined;
  if (cls.kind === "unresolved-method") {
    signatures = await resolveSignatures();
    if (!signatures) {
      example = await resolveExample();
    }
  } else {
    example = await resolveExample();
    if (!example) {
      signatures = await resolveSignatures();
    }
  }
  // Each block omits its own FIRM_INSTRUCTION; one shared instruction is
  // appended to the whole combined payload below (the emit-once shape).
  const payload = assembleSurfacePayload({ typeOrCrate, example, signatures, omitInstruction: true });
  // `via` reads the RENDER's own decision, not the inputs: the shared gate in
  // assembleSurfacePayload can refuse the example and fall to signatures, and
  // reporting "example" for a signatures block would lie in the channel.
  return payload
    ? { payload, via: payload.startsWith("Usage example") ? "example" : "signatures", isSurface: true }
    : undefined;
}

// The TS member legs: signatures FIRST via completeMembers at the error site;
// the fallback is the TS field shape (hover/def surface); wrong-item is the
// quoted-item steer (plus tsc's own did-you-mean). The example leg is DARK
// for TS by contract and is never consulted here.
async function tsMemberBlock(args: MemberBlockArgs): Promise<{ payload: string; via: string; isSurface: boolean } | undefined> {
  const { cls, typeOrCrate, cursor, extractor, document, log, memberCap } = args;
  if (cls.kind === "wrong-item") {
    const payload = assembleTsWrongItemPayload({
      item: cls.item,
      module: cls.crate,
      suggestion: cls.suggestion,
    });
    // Terminal steering with no injected surface (the local-symbol precedent):
    // isSurface false, so a steer-only payload never carries FIRM_INSTRUCTION.
    return { payload, via: "wrong-item-steer", isSurface: false };
  }
  const members = await resolveMemberLines(extractor, cursor, typeOrCrate, log, memberCap);
  if (members !== undefined) {
    return { payload: assembleTsMemberPayload({ type: typeOrCrate, members }), via: "signatures", isSurface: true };
  }
  // Anchor the shape queries at a REAL receiver-type reference (import or
  // first bare occurrence), mirroring the Rust field leg's cross-file lesson.
  const refCursor = findReceiverTypeReference(document, typeOrCrate) ?? cursor;
  const block = await tsResolveFieldShape(extractor, refCursor, typeOrCrate, log, memberCap);
  return block ? { payload: block, via: "field-shape", isSurface: true } : undefined;
}

// completeMembers rendered honestly: a member with a signature renders it, a
// name-only member renders its BARE NAME - never an invented type. Capped at
// the ONE shared member cap with the dropped names logged.
//
// Shared by every language whose member surface is completions-at-the-error-site
// and nothing else: TypeScript, C#, Python and Go. Rust is the exception, and
// deliberately so - it has a worked example to prefer.
async function resolveMemberLines(
  extractor: SurfaceExtractor,
  cursor: SourceCursorLite,
  type: string,
  log: (line: string) => void,
  memberCap: number,
): Promise<string | undefined> {
  try {
    const members = semanticMembers(await extractor.completeMembers(cursor));
    let capped = members;
    if (members.length > memberCap) {
      capped = members.slice(0, memberCap);
      const droppedMembers = members.slice(memberCap).map((m) => m.name);
      log(
        `[repair] surface truncated \`${type}\` members: ` +
          `kept ${memberCap} of ${members.length} (dropped ${droppedMembers.join(", ")})`,
      );
    }
    const lines = capped.map((m) => m.signature ?? m.name).join("\n");
    return lines.length > 0 ? lines : undefined;
  } catch {
    return undefined;
  }
}

// The TS hover shapes the field leg accepts: interface/class/enum/type-alias
// displays. Deliberately NOT the Rust struct/enum regex - `enum ColorMode` is
// a TS hover this hook owns, and the Rust parser would strip its members.
const TS_SHAPE_HOVER = /^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:interface|class|enum|const\s+enum|type)\b/;

async function tsResolveFieldShape(
  extractor: SurfaceExtractor,
  cursor: SourceCursorLite,
  type: string,
  log: (line: string) => void,
  memberCap: number,
): Promise<string | undefined> {
  let hoverSig: string | undefined;
  try {
    const hover = await extractor.hoverSurface(cursor);
    if (hover?.signature && TS_SHAPE_HOVER.test(hover.signature)) {
      hoverSig = hover.signature.trim();
    }
  } catch {
    hoverSig = undefined;
  }
  const hoverFields = parseTsHoverFields(hoverSig);
  let rendered: string | undefined;
  if (hoverSig !== undefined && hoverFields.length > 0) {
    // The hover display already states the real field set: verbatim.
    rendered = tsRenderDerivedDef({ name: type, signature: hoverSig, fields: hoverFields, methods: [], methodsResolved: false });
  } else {
    let fields: Array<{ name: string; typeName: string }> = [];
    try {
      const members = await extractor.membersOfType(cursor);
      const fieldMembers = members.filter((m) => m.kind === "field");
      let capped = fieldMembers;
      if (fieldMembers.length > memberCap) {
        capped = fieldMembers.slice(0, memberCap);
        const droppedFields = fieldMembers.slice(memberCap).map((m) => m.name);
        log(
          `[repair] surface truncated \`${type}\` fields: ` +
            `kept ${memberCap} of ${fieldMembers.length} (dropped ${droppedFields.join(", ")})`,
        );
      }
      fields = capped.map((m) => {
        const sig = m.signature ?? m.name;
        const colon = sig.indexOf(":");
        return colon >= 0
          ? { name: sig.slice(0, colon).trim(), typeName: sig.slice(colon + 1).trim() }
          : { name: m.name, typeName: "" };
      });
    } catch {
      fields = [];
    }
    if (fields.length > 0) {
      rendered =
        hoverSig !== undefined
          ? renderTsShapeWithHeader(hoverSig, fields)
          : tsRenderDerivedDef({ name: type, signature: "", fields, methods: [], methodsResolved: false });
    } else if (hoverSig !== undefined) {
      rendered = hoverSig; // the real hover text alone: thin, but never a guess
    }
  }
  if (rendered === undefined) {
    log(`[repair] surface miss for=${type}: receiver shape unresolved`);
    return undefined;
  }
  const fence = fenceFor(rendered);
  return `Data shape of \`${type}\`:\n${fence}ts\n${rendered}\n${fence}`;
}

// A bodyless hover header (`enum ColorMode`, `interface Order`) filled with
// the resolved members: enum members separate with commas (enum-shaped,
// names only - an enum member carries no field type); object members with
// semicolons, name-only members staying bare names.
function renderTsShapeWithHeader(header: string, fields: Array<{ name: string; typeName: string }>): string {
  const isEnum = /(?:^|\s)enum\b/.test(header);
  const lines = fields
    .map((f) => `  ${f.name}${!isEnum && f.typeName.length > 0 ? `: ${f.typeName}` : ""}${isEnum ? "," : ";"}`)
    .join("\n");
  return `${header} {\n${lines}\n}`;
}

// The C# member leg: the receiver's real members via completeMembers at
// the error site, cs-fenced signatures (name-only where the resolve tail could
// not fill a signature in budget). C# has NO worked example (metadata-as-source
// strips them), so the example leg is never consulted and there
// is no field-shape fallback — a C# hover carries no struct-field body. undefined
// when nothing resolves (the honest degrade). Sibling of tsMemberBlock.
async function csMemberBlock(args: MemberBlockArgs): Promise<{ payload: string; via: string; isSurface: boolean } | undefined> {
  const { typeOrCrate, cursor, extractor, log, memberCap } = args;
  const members = await resolveMemberLines(extractor, cursor, typeOrCrate, log, memberCap);
  if (members !== undefined) {
    return { payload: assembleCsMemberPayload({ type: typeOrCrate, members }), via: "signatures", isSurface: true };
  }
  return undefined;
}

// The Python and Go member legs, the youngest siblings of the C# one: the
// receiver's real members via completeMembers at the error site, fenced in the
// language's own tag. Neither language has a worked example (Rust's alone) and
// neither hover carries a field body to fall back to, so undefined is the honest
// degrade when the completion list is empty.
async function pyMemberBlock(args: MemberBlockArgs): Promise<{ payload: string; via: string; isSurface: boolean } | undefined> {
  const { typeOrCrate, cursor, extractor, log, memberCap } = args;
  const members = await resolveMemberLines(extractor, cursor, typeOrCrate, log, memberCap);
  if (members !== undefined) {
    return { payload: assemblePyMemberPayload({ type: typeOrCrate, members }), via: "signatures", isSurface: true };
  }
  return undefined;
}

async function goMemberBlock(args: MemberBlockArgs): Promise<{ payload: string; via: string; isSurface: boolean } | undefined> {
  const { typeOrCrate, cursor, extractor, log, memberCap } = args;
  const members = await resolveMemberLines(extractor, cursor, typeOrCrate, log, memberCap);
  if (members !== undefined) {
    return { payload: assembleGoMemberPayload({ type: typeOrCrate, members }), via: "signatures", isSurface: true };
  }
  return undefined;
}

const RUST_REPAIR_LANG: RepairSurfaceLang = {
  classify: classifyHallucination,
  memberBlock: rustMemberBlock,
  fieldShape: resolveFieldShape,
  // One crate surface serves all its wrong-items: the pre-seam key, verbatim.
  memberDedupId: (_cls, typeOrCrate) => typeOrCrate,
  // Item 2 and item 1's repair half. Rust only: the measurement that motivates
  // both was taken against rustc, and rustc's backtick convention is not C#'s or
  // TypeScript's apostrophes.
  harvestTypes: harvestDiagnosticTypes,
  isStdlibDef: isRustSysrootDef,
};

const CS_REPAIR_LANG: RepairSurfaceLang = {
  classify: classifyCsHallucination,
  memberBlock: csMemberBlock,
  // classifyCsHallucination never produces unresolved-field (a C# member miss is
  // CS1061 -> the member surface, not a struct-field def), so fieldShape is never
  // reached; a dark hook keeps the honest degrade explicit rather than borrowing
  // the Rust struct renderer (which would emit a ```rust fence on a C# document).
  fieldShape: async () => undefined,
  // One receiver surface serves the receiver's member misses: keyed by type.
  memberDedupId: (_cls, typeOrCrate) => typeOrCrate,
};

const TS_REPAIR_LANG: RepairSurfaceLang = {
  classify: classifyTsHallucination,
  memberBlock: tsMemberBlock,
  fieldShape: tsResolveFieldShape,
  // The wrong-item steer names ONE item, so the identity carries it: two
  // missing exports from the same module are two distinct steers.
  memberDedupId: (cls, typeOrCrate) =>
    cls.kind === "wrong-item" ? `${typeOrCrate}::${cls.item}` : typeOrCrate,
};

// The Python hooks. pyright's attribute miss is a MEMBER class, so the payload
// is the receiver's real member surface at the error cursor, the same leg C#
// runs; pyright emits no struct-field def and its class hover carries no field
// body, so there is no field-shape leg to fall back to and the hook is dark
// rather than borrowed from Rust (which would emit a ```rust fence on a .py
// document).
const PY_REPAIR_LANG: RepairSurfaceLang = {
  classify: classifyPyHallucination,
  memberBlock: pyMemberBlock,
  fieldShape: async () => undefined,
  memberDedupId: (_cls, typeOrCrate) => typeOrCrate,
};

// The Go hooks. Same shape as Python's: go's member miss resolves through
// completeMembers at the error site, and go has no worked example and no
// struct-def hover to fall back to.
const GO_REPAIR_LANG: RepairSurfaceLang = {
  classify: classifyGoHallucination,
  memberBlock: goMemberBlock,
  fieldShape: async () => undefined,
  memberDedupId: (_cls, typeOrCrate) => typeOrCrate,
};

function repairLangFor(languageId: string): RepairSurfaceLang {
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return TS_REPAIR_LANG;
  }
  if (languageId === "csharp") {
    return CS_REPAIR_LANG;
  }
  if (languageId === "python") {
    return PY_REPAIR_LANG;
  }
  if (languageId === "go") {
    return GO_REPAIR_LANG;
  }
  // Rust is the fall-through, and until v30 so were Python and Go. That is the
  // whole of the scout's second finding: two languages had every diagnostic
  // matched against rustc's error codes and classified as none, forever.
  return RUST_REPAIR_LANG;
}

/** What a combining caller (the repair round, which now injects the span's
 *  types-in-play alongside these diagnostic-keyed blocks) needs from this
 *  resolver beyond the payload itself. Absent keeps every byte and every log
 *  line exactly as they were, which the frozen v6 oracle pins. */
export interface SurfaceInjectionOpts {
  /** Types another leg has already disclosed: their blocks are skipped here
   *  rather than rendered twice into one prompt. */
  skipTypes?: ReadonlySet<string>;
  /** Return the blocks without the trailing firm instruction, for a caller that
   *  closes the whole combined surface with one instruction naming every type. */
  omitInstruction?: boolean;
  /** The types whose surface actually rendered. Reported without member lists:
   *  these blocks are rendered text by the time they get here, so the honest
   *  claim is "this type was disclosed", not "these are all its members". */
  onDisclosed?: (types: DisclosedType[]) => void;
  /** Called when the payload is TERMINAL steering: the installed-crate catalog,
   *  or the enable-this-feature message. Both carry a do-not-combine contract in
   *  their own comments - until the crate is a dependency its methods cannot
   *  resolve, and a manifest edit is not an API the model got wrong - so a
   *  combining caller must inject this one alone. */
  onTerminalSteer?: () => void;
  /** The context stop to spend, INSTEAD of the one the setting names. Absent
   *  means the setting decides, which is every product call. It exists for the
   *  measurement rig, whose arms must render the pre-dial `shipped` point from
   *  a bundle whose settings host answers the default for every key - the same
   *  escape `resolvePrefill.opts.contextStop` carries, for the same reason. */
  contextStop?: ContextStop;
}

export async function resolveSurfaceInjection(
  extractor: SurfaceExtractor,
  document: vscode.TextDocument,
  eligible: Diagnostic[],
  log: (line: string) => void,
  catalog?: string,
  resolution?: CrateResolution,
  localDefs?: Set<string>,
  opts?: SurfaceInjectionOpts,
): Promise<string | undefined> {
  const uri = document.uri.toString();
  // The language's hooks (4B seam): classifier, member-block legs, field
  // shape. Dispatched ONCE on the injection document's languageId, as is the
  // budget cell the caps below are read from.
  const lang = repairLangFor(document.languageId);
  // The LIVE stop, for the reason `refineCharBudget` above states: what
  // `surfaceCap` and `memberCap` derive from the aggregate budget is carved OUT
  // of the contract's do-not-change list, and a repair prompt that ignores the
  // dial hands a frontier user the local-30B surface with nothing on the
  // channel to say so.
  //
  // `contextStop` overrides it for exactly one caller: the measurement rig,
  // which has to render the pre-dial before-side from a bundle whose settings
  // host answers defaults for everything. No setting value resolves to
  // `shipped`, so it cannot be acquired by accident.
  const budget = budgetProfileFor(
    fnGenModelClass(log),
    document.languageId,
    opts?.contextStop ?? injectedContextStop(log),
  );
  const surfaceCap = budget.surfaceCap;
  // Deduped, first-seen-ordered blocks. `seen` keys on kind:identity (span
  // identity when the identity is empty). `hasSurface` gates the trailing
  // FIRM_INSTRUCTION: it governs an injected API surface, so a payload of only
  // steers (local-symbol, the TS wrong-item steer) carries none - keeping the
  // N=1 local-symbol path byte-identical.
  const seen = new Set<string>();
  const blocks: string[] = [];
  const dropped: string[] = [];
  let hasSurface = false;
  // The types the instruction is allowed to speak about: the ones whose surface
  // BLOCKS rendered, in the order they rendered. A steer carries no surface and
  // contributes no name, and a diagnostic whose receiver came back empty (the
  // E0599 fallback) contributes none either - the instruction then constrains
  // the surface without naming a type it cannot point at.
  const scope: string[] = [];
  const inScope = (type: string) => {
    if (type !== "" && !scope.includes(type)) {
      scope.push(type);
    }
  };
  // A type another leg already disclosed is skipped rather than rendered twice.
  const alreadyDisclosed = (type: string): boolean => opts?.skipTypes?.has(type) === true;

  // Every diagnostic that reaches here and produces no surface, with the
  // reason. This resolver returning `undefined` in silence is how the harvest
  // gap went unnoticed for so long: 16 of 28 real diagnostics fell outside the
  // classifier, `surfaceBytes` was 0 on 8 of 9 measured repair rounds, and
  // nothing on any channel said so. A code that lands here is the next gap, and
  // it should take minutes to find rather than days.
  const noSurface: { code: string; reason: string }[] = [];
  const codeOf = (d: Diagnostic): string => d.code ?? "no-code";
  // One line per diagnostic that bought nothing. Called before EVERY exit, not
  // just the ordinary one: the two terminal steers below `return` out of the loop
  // mid-collection, and a reason discarded on the way out is the same silence
  // this accounting exists to end. Per-diagnostic rather than one summary line,
  // because the CODE is what tells a reader which rule to write next and four
  // codes can have four different reasons.
  const flushNoSurface = (): void => {
    for (const n of noSurface) {
      log(`[repair] surface none for ${n.code}: ${n.reason}`);
    }
    noSurface.length = 0;
  };

  // The diagnostics held for the harvest pass below. They run AFTER every
  // classified block so a compiler-named receiver always wins the cap over a
  // harvested name: the classifier knows WHICH role the type plays in the error
  // and the harvest only knows the error mentioned it.
  //
  // Two ways in, and `lead` is which. Absent, the classifier had NO rule, which
  // is the harvest's original population. Present, a rule matched and its
  // member leg then resolved NOTHING, and the string is that leg's own account
  // of itself. Carried per diagnostic because every verdict sentence below
  // opens with it, and "no classifier rule matched" is simply false for a
  // diagnostic that classified.
  const unclassified: { d: Diagnostic; lead?: string }[] = [];
  // Fall-throughs are held in their OWN queue and harvested after every genuine
  // no-rule diagnostic. Pushed onto `unclassified` they interleave ahead of
  // later no-rule entries, and under the surface cap a fall-through then takes
  // a slot a no-rule harvest used to get - measured turning a row that got a
  // surface into a row that got none. The
  // priority this file already states runs classifier-named ahead of harvested;
  // a name whose own leg resolved nothing is weaker still, so it goes last.
  const fellThrough: { d: Diagnostic; lead?: string }[] = [];
  // Names the language, as the "no harvest" sentence always did. The other four
  // verdicts did not, and one message in five carrying the language while the
  // rest do not is an inconsistency, not a convention.
  const NO_RULE = `no ${document.languageId} classifier rule matched`;

  for (const d of eligible) {
    const cls = lang.classify(d, resolution, localDefs);
    if (!cls) {
      unclassified.push({ d });
      continue;
    }
    if (cls.kind === "operand-mismatch") {
      // No receiver at an operator site, so nothing to resolve members at. The
      // operand types this class carries reach the model through the span's
      // types-in-play leg instead; here it only keeps the exhaustiveness guard
      // honest and the channel line off class=none.
      log(`[repair] surface class=operand-mismatch for=${cls.types.join(",")}: no block of its own, the operands ride the span's types-in-play`);
      continue;
    }
    if (cls.kind === "arity-mismatch") {
      // Same shape as operand-mismatch: no block of its own. What the compiler
      // named rides the span's types-in-play, and what it did NOT name is the
      // gap item 1's disclosure leg fills. The line says which of the two
      // happened, because in C# and Go the receiver arrives free and in the
      // other three it has to be resolved.
      log(
        `[repair] surface class=arity-mismatch for=${cls.member || "the call"}: ` +
          (cls.type !== undefined
            ? `the compiler named the receiver \`${cls.type}\`, which rides the span's types-in-play`
            : `the compiler named no receiver, so this call has no type of its own to disclose`),
      );
      continue;
    }
    if (cls.kind === "unresolved-crate") {
      // Terminal short-circuit: steer to an installed crate with the
      // capability-catalog and inject it ALONE - until the crate is a dependency
      // its methods cannot resolve, so combining a member list with a steer-to-
      // installed-crate is noise. Absent catalog (none installed): skip and keep
      // collecting (the missing crate is surfaced upstream, not here).
      if (catalog) {
        log(`[repair] surface injected class=unresolved-crate via=catalog for=${cls.crate}`);
        // Everything collected so far still owes the channel a line. This return
        // abandons the collection, and the diagnostics already in it are exactly
        // the ones nobody would otherwise know about.
        flushNoSurface();
        unclassifiedNoSurface([...unclassified, ...fellThrough], lang, document, codeOf, log);
        opts?.onTerminalSteer?.();
        return catalog;
      }
      noSurface.push({
        code: codeOf(d),
        reason: `class=unresolved-crate for \`${cls.crate}\` but no installed-crate catalog was resolved`,
      });
      continue;
    }
    if (cls.kind === "needs-feature") {
      // Terminal steering, not a worked example: the path exists but its feature
      // is off, so the fix is a Cargo.toml edit, not an API the model got wrong.
      // Injected alone (no extractor call, no network); in the real flow it is
      // already returned upstream of the loop.
      log(
        `[repair] surface injected class=needs-feature via=enable-feature ` +
          `for=${cls.crate}::${cls.module} feature=${cls.feature}`,
      );
      flushNoSurface();
      unclassifiedNoSurface([...unclassified, ...fellThrough], lang, document, codeOf, log);
      opts?.onTerminalSteer?.();
      return assembleNeedsFeaturePayload({ crate: cls.crate, module: cls.module, feature: cls.feature });
    }
    if (cls.kind === "local-symbol") {
      // The offending name is defined in this file. Steer "drop the
      // import, it is local" - never resolve/inject the crate's surface, which is
      // exactly the amplification (atlas::CohortRegister -> atlas::Tile) the bug
      // named. NON-terminal: it coexists with method blocks in the combine.
      const key = `local-symbol:${cls.name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (blocks.length >= surfaceCap) {
        dropped.push(`local-symbol:${cls.name}`);
        continue;
      }
      log(`[repair] surface injected class=local-symbol via=drop-import for=${cls.name}`);
      blocks.push(assembleLocalSymbolPayload({ name: cls.name }));
      continue;
    }
    if (cls.kind === "unresolved-field") {
      // An invented field on receiver type Y. Inject Y's
      // DEPTH-1 struct def (its real fields, so the model sees the field it wrote
      // is not one) - NOT the recursive generate-time walk. NON-terminal: coexists
      // with method blocks in the combine. Dedup by kind:type, span
      // identity when the type is empty, mirroring the method path.
      const dedupId = cls.type !== "" ? cls.type : `span:${cls.cursor.line}:${cls.cursor.character}`;
      const key = `unresolved-field:${dedupId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (alreadyDisclosed(cls.type)) {
        log(`[repair] surface skipped class=unresolved-field for=${cls.type}: already disclosed by the span surface`);
        continue;
      }
      if (blocks.length >= surfaceCap) {
        dropped.push(cls.type || dedupId);
        continue;
      }
      // Anchor at a REAL Y reference (use/signature) — hovering at the invalid
      // field cursor resolves nothing (the cross-file/crate gap). Fall back to the
      // diagnostic cursor only when Y is not referenced in the file.
      const cursor =
        findReceiverTypeReference(document, cls.type) ??
        { uri, line: cls.cursor.line, character: cls.cursor.character };
      const block = await lang.fieldShape(extractor, cursor, cls.type, log, budget.memberCap);
      if (block) {
        log(`[repair] surface injected class=unresolved-field via=struct-def for=${cls.type}`);
        blocks.push(block);
        hasSurface = true;
        inScope(cls.type);
      } else {
        // Classified and STILL no surface. A silent exit here reads on the
        // channel exactly like a diagnostic that was never eligible, which is
        // the confusion item 3 exists to end: the classifier worked, the
        // resolver did not.
        noSurface.push({
          code: codeOf(d),
          reason: `class=unresolved-field named \`${cls.type}\` and the field-shape leg resolved nothing for it`,
        });
      }
      continue;
    }
    if (
      cls.kind === "unresolved-method" ||
      cls.kind === "unresolved-assoc" ||
      cls.kind === "wrong-item"
    ) {
      const typeOrCrate = "type" in cls ? cls.type : cls.crate;
      // Dedup by kind:identity so two errors on the same receiver inject its
      // surface once; the identity is the language's own (memberDedupId - the
      // TS wrong-item key carries the item). CRITICAL: the E0599 fallback
      // leaves type === "" (member/type are best-effort), so an empty identity
      // falls back to SPAN IDENTITY - two distinct empty-type receivers must
      // NOT collapse into one block. Dedup BEFORE resolving:
      // resolving is the rust-analyzer round trip.
      const dedupBase = lang.memberDedupId(cls, typeOrCrate);
      const dedupId = dedupBase !== "" ? dedupBase : `span:${cls.cursor.line}:${cls.cursor.character}`;
      const key = `${cls.kind}:${dedupId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (alreadyDisclosed(typeOrCrate)) {
        log(`[repair] surface skipped class=${cls.kind} for=${typeOrCrate}: already disclosed by the span surface`);
        continue;
      }
      if (blocks.length >= surfaceCap) {
        dropped.push(typeOrCrate || dedupId);
        continue;
      }
      // The legs and their order are the language's own (rustMemberBlock /
      // tsMemberBlock above); each block omits its own FIRM_INSTRUCTION - one
      // shared instruction is appended to the whole combined payload below
      // (the emit-once shape).
      const cursor = { uri, line: cls.cursor.line, character: cls.cursor.character };
      const resolvedBlock = await lang.memberBlock({ cls, typeOrCrate, cursor, extractor, document, log, memberCap: budget.memberCap });
      if (resolvedBlock) {
        log(`[repair] surface injected class=${cls.kind} via=${resolvedBlock.via} for=${typeOrCrate}`);
        blocks.push(resolvedBlock.payload);
        // A steer-only block (TS wrong-item) is not a surface: it must not
        // flip the instruction gate on its own, nor name a type the payload
        // never described. Mixed payloads keep both.
        if (resolvedBlock.isSurface) {
          hasSurface = true;
          inScope(typeOrCrate);
        }
      } else {
        // FALL THROUGH to the harvest. A rule matched and then resolved
        // nothing, and before this that was the end of the road: the round went
        // out with no surface at all while the name the harvest wanted sat in
        // the diagnostic's own message. Captured on
        // `error[E0433]: cannot find \`EcdsaKeyPair\` in \`rcgen\`` - classified
        // `wrong-item` on crate `rcgen`, the member leg resolved nothing for
        // `rcgen`, and `[repair] surface EMPTY`.
        //
        // The reason becomes the harvest's opening clause WHEN the harvest also
        // comes back empty, so a row that fails twice reports both failures.
        // When the harvest succeeds the verdict is never pushed and this leg's
        // account does NOT reach the channel - one of the exits this accounting
        // newly lit goes dark again on exactly the rows that ended well.
        // That is the deliberate trade: an injected surface is reported by its
        // own `surface injected class=harvest` line, and a round that produced
        // a surface is not the round anyone is debugging. The harvest's
        // discipline is unchanged: a harvested name still has to resolve before
        // a byte is injected.
        fellThrough.push({
          d,
          lead: `class=${cls.kind} named \`${typeOrCrate || "no receiver"}\` and the member leg resolved nothing for it`,
        });
      }
      continue;
    }
    // Exhaustiveness guard: a new HallucinationClass must grow a branch above,
    // not silently fall through to the wrong injection. Compile-time signal.
    const _exhaustive: never = cls;
    void _exhaustive;
  }

  // THE HARVEST PASS. Sixteen of 28 real diagnostics fall outside the
  // classifier, and every one of them used to leave here having injected
  // nothing. The diagnostic already named the type; this resolves the name and
  // injects the definition, which replaces a code-by-code table with a rule.
  // The v6 principle holds: every byte still traces to a rustc diagnostic.
  for (const { d, lead = NO_RULE } of [...unclassified, ...fellThrough]) {
    const names = lang.harvestTypes?.(d) ?? [];
    if (names.length === 0) {
      noSurface.push({
        code: codeOf(d),
        reason:
          lang.harvestTypes === undefined
            ? `${lead}, and this language has no diagnostic harvest`
            : `${lead} and the diagnostic named no type to resolve`,
      });
      continue;
    }
    // Why each harvested name bought nothing, kept per name rather than per
    // diagnostic: an E0308 naming two types where one resolves and one does not
    // is a different state from one where neither does, and the next rule to
    // write depends on which.
    const misses: string[] = [];
    let injectedForThis = 0;
    // Counted apart from `misses`, because "the cap was already full" and "this
    // name resolved to nothing" ask the reader to do different things and a line
    // that conflates them is worse than no line. Before this the cap case
    // reported "every harvested name was already covered", which was false.
    let cappedForThis = 0;
    // Names another leg ALREADY described. Counted apart from the misses for the
    // same reason the cap is: a name that resolved fine and was skipped because it
    // resolved is the opposite diagnosis from a name that did not resolve, and the
    // verdict line used to lump the two together and report the second.
    let coveredForThis = 0;
    for (const name of names) {
      const key = `harvest:${name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      // ALREADY DESCRIBED by another leg - the span surface, or a classified block
      // earlier in this same payload. Its shape must not render twice. Its DERIVES
      // still can, because no other leg renders them: round 1 emits a declaration
      // without its attributes, so "disclosed" means the fields are in the prompt
      // and says nothing about the traits. On item 2's own E0277 worked example
      // that distinction is the whole value of the leg.
      const covered = alreadyDisclosed(name) || scope.includes(name);
      if (blocks.length >= surfaceCap) {
        dropped.push(`harvest:${name}`);
        cappedForThis++;
        continue;
      }
      const { payload, reason } = await harvestedTypeBlock({
        name,
        extractor,
        document,
        lang,
        log,
        memberCap: budget.memberCap,
        ...(covered ? { derivesOnly: true } : {}),
      });
      if (covered && !payload) {
        log(`[repair] surface skipped class=harvest for=${name}: already disclosed, and ${reason ?? "nothing to add"}`);
        coveredForThis++;
        continue;
      }
      if (payload) {
        log(
          `[repair] surface injected class=harvest via=${covered ? "derives-only" : "diagnostic-name"} ` +
            `for=${name} code=${codeOf(d)}`,
        );
        blocks.push(payload);
        hasSurface = true;
        inScope(name);
        injectedForThis++;
      } else {
        // Logged PER NAME, here, and not only folded into the per-diagnostic
        // no-surface line below. A diagnostic naming two types where one injects
        // and one is refused reports `injectedForThis > 0`, so the refusal would
        // never reach the channel at all - which is the silence item 3 exists to
        // close, reappearing one level down.
        log(`[repair] surface none for ${codeOf(d)}: ${reason ?? `\`${name}\` produced nothing`}`);
        misses.push(reason ?? `\`${name}\` produced nothing`);
      }
    }
    if (injectedForThis === 0) {
      // Three distinct states, three distinct sentences. The per-name reasons are
      // already on the channel above; this is the diagnostic-level verdict.
      const reason =
        cappedForThis > 0
          ? `${lead} and ${cappedForThis} harvested name(s) were dropped over cap=${surfaceCap}, not resolved: ${names.join(", ")}`
          : misses.length > 0
            ? // Only the names that actually failed are named as failures. Listing
              // every harvested name here reported a name that resolved fine and
              // was skipped BECAUSE it resolved as a name that did not resolve,
              // which is the opposite diagnosis for whoever reads this line
              // looking for the next rule to write.
              `${lead} and no harvested name added a surface` +
              (coveredForThis > 0 ? `; ${coveredForThis} were already covered by another block` : "") +
              `. Failed: ${misses.join("; ")}`
            : `${lead} and every harvested name was already covered by another block (${names.join(", ")})`;
      noSurface.push({ code: codeOf(d), reason });
    }
  }

  if (dropped.length > 0) {
    // No silent truncation: name the dropped surfaces.
    log(`[repair] surface dropped ${dropped.length} over cap=${surfaceCap}: ${dropped.join(", ")}`);
  }
  flushNoSurface();
  if (blocks.length === 0) {
    // The whole-payload version of the same honesty. Repair still runs and the
    // model still sees the diagnostics verbatim; what it does NOT get is any
    // type surface, and that is the fact that was invisible.
    log(
      `[repair] surface EMPTY: ${eligible.length} eligible diagnostic(s) produced no surface at all ` +
        `(codes ${eligible.map(codeOf).join(", ") || "none"}); repair goes out with the diagnostics alone`,
    );
    return undefined;
  }
  opts?.onDisclosed?.(scope.map((name) => ({ name, members: [], complete: false })));
  const combined = blocks.join("\n\n");
  // ONE instruction governs the whole surface (never one per block), scoped to
  // every type that rendered; omitted when there is no API surface for it to
  // govern (local-symbol only), and omitted on request when a combining caller
  // closes several surfaces with one instruction of its own.
  return hasSurface && opts?.omitInstruction !== true
    ? `${combined}\n\n${firmInstructionFor(scope)}`
    : combined;
}

// Display only, one direction: an after-line summary anchored at the landed
// span, carrying the full rendered diagnostics on its hover. Exact rendering is
// human F5 territory. Nothing here publishes a diagnostic — the file's own
// language server does that, and it is the only thing that can clear one when
// the human fixes the code by hand.
function surfaceCheck(ctx: PostAcceptContext, check: OracleCheckResult, oracle: CompilerOracle): void {
  if (!display) {
    return;
  }
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === ctx.document.uri.toString(),
  );
  if (!editor) {
    return;
  }
  const errors = check.diagnostics.filter((d) => d.level === "error").length;
  const warnings = check.diagnostics.filter((d) => d.level === "warning").length;
  if (errors === 0 && warnings === 0) {
    editor.setDecorations(display.decoration, []);
    return;
  }
  const line = ctx.document.positionAt(ctx.landedSpan.start).line;
  const hover = new vscode.MarkdownString();
  for (const d of check.diagnostics) {
    hover.appendCodeblock(d.rendered ?? d.message, "text");
  }
  editor.setDecorations(display.decoration, [
    {
      range: ctx.document.lineAt(line).range,
      hoverMessage: hover,
      renderOptions: {
        after: { contentText: `${oracle.checkLabel}: ${errors} error(s), ${warnings} warning(s)` },
      },
    },
  ]);
}
