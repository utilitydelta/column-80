/**
 * Gated cross-model repair: the state machine that decides, after a check,
 * whether one more repair round is allowed and by which route. Decisions
 * only; the vscode layer executes them through the EXISTING fn-gen
 * producer guards and splice/preview path. No new insertion route exists,
 * which is what makes this module removable without touching oracle or
 * fn-gen code.
 *
 * Bar 4 lives here, structurally:
 * - roundsUsed is typed 0 | 1 | 2 and only next() advances it; no code path
 *   can request a third model call.
 * - assertion-failure diagnostics are refused by classifyEligibility with a
 *   logged reason; same-model repair of wrong values is measured useless
 *   even at 30B (prior-art/spike-harness q2_* evidence).
 *
 * Contract: docs/architecture/compiler-oracle.md.
 */

import { LogFn } from "./completionService";
import { fenceFor } from "./instructPostprocess";
import { Diagnostic, DiagnosticSpan, OracleCheckResult, resolveDiagnosticPath, rustcAssertionMessage } from "./compilerOracle";
import { dedentReplyCode } from "./placeReply";
import { dedentDocComment } from "./reindent";
import { ContextBlock, GenKind, SECTION_SEPARATOR, renderContextBlock } from "./prompt";

/** Which producer emitted the output that failed the check. Routing hangs
 *  on this: same-model self-repair below ~30B is dead (spike-proven), so
 *  FIM output is only ever repaired cross-model by the 30b. */
export type GenerationSource = "fim" | "fngen";

export type RepairRoute = "cross-model" | "self-repair";

export type IneligibleReason = "assertion-failure" | "no-location" | "warning" | "out-of-span";

export interface EligibilityDecision {
  eligible: boolean;
  /** Present exactly when ineligible; every refusal is loggable. */
  reason?: IneligibleReason;
}

/** The byte range repair may touch: the accepted (or last repaired)
 *  function. filePath is the document's absolute path and crateRoot is the
 *  checked crate's root; span fileNames arrive crate- or workspace-relative
 *  and resolve to absolute through resolveDiagnosticPath — the same
 *  function the Problems mirror uses, so eligibility and display cannot
 *  disagree about which file an error lives in (path identity,
 *  never suffix). Byte offsets, rustc's own unit, not UTF-16. */
export interface RepairScope {
  filePath: string;
  crateRoot: string;
  byteStart: number;
  byteEnd: number;
  /** Injectable for headless grids; absent means the real filesystem. */
  fileExists?: (p: string) => boolean;
  /** Manifest text for the workspace-anchor walk (Q6). Absent reads the real
   *  filesystem. A scope that models a layout as a path list alone cannot say
   *  WHICH manifest is the workspace root, and since the anchor rule reads
   *  content that is now under-specified rather than merely terse. */
  readManifest?: (p: string) => string | undefined;
  /** The oracle's own span-path resolution. Absent falls back to the
   *  Rust-shaped resolveDiagnosticPath — the default the frozen contract
   *  oracles pin; the live path always passes the strategy's resolver. */
  resolvePath?: (crateRoot: string, fileName: string) => string;
}

/** Per-language strategy hooks for eligibility. The kind tag stays refused
 *  unconditionally because kind is producer-assigned and bar 4 is
 *  zero-tolerance; the hook only replaces the message-text family. Absent
 *  falls back to the rustc family the frozen contract oracles pin. */
export interface EligibilityHooks {
  assertionShaped?: (diagnostic: Diagnostic) => boolean;
}

/**
 * THE ONE-WAY DOOR. What opens `classifyEligibility`'s two assertion refusals,
 * and it takes BOTH halves.
 *
 * ARCHITECTURE.md invariant 4 refused assertion failures outright, on a v1
 * measurement of const-eval assertion TEXT with no test run, no location and no
 * receiver surface. Session-v60 measured the new input directly on the default
 * local model, `qwen3-coder:30b`, over four seeded compiling defects with a
 * positive control on every arm:
 *
 *   no evidence                                 0/4
 *   the bare-message shape the old ADR measured 0/4
 *   the specced failure evidence                1/4
 *   evidence PLUS the receiver's API surface    3/4
 *
 * so the clause moves, and only that clause. The 2-round cap does not change,
 * and assertion failures stay refused on the AUTOMATIC path, where neither half
 * below can ever be true: nothing there runs a test.
 *
 * Both fields are REQUIRED and plain. A conditional spread is invisible to tsc
 * (v58's lesson), and this is the guard that decides whether a model gets to
 * rewrite a function because a test went red.
 */
export interface TestRepairAuthorization {
  /** The developer invoked Repair Function on this target THEMSELVES. Never
   *  true on the automatic post-fn-gen path, which runs no tests at all. */
  manualRepairGesture: boolean;
  /** This failing test is in the call walk's discovered set for THIS target:
   *  it reaches the function, directly or through callers the walk followed.
   *  A red test elsewhere in the repo is not this function's problem. */
  inDiscoveredSet: boolean;
}

/** Unauthorized. The value every existing call site means, spelled once so the
 *  intent is legible at each of them. */
export const NO_TEST_REPAIR: TestRepairAuthorization = {
  manualRepairGesture: false,
  inDiscoveredSet: false,
};

function testRepairOpen(auth: TestRepairAuthorization | undefined): boolean {
  // Runtime-undefined is UNAUTHORIZED, the safe direction. The parameter is
  // required so tsc forces every TypeScript call site to state its stance;
  // the frozen contract oracles call this with one argument from plain JS and
  // must keep meaning exactly what they always meant.
  return auth !== undefined && auth.manualRepairGesture && auth.inDiscoveredSet;
}

function scopeResolvePath(scope: RepairScope, fileName: string): string {
  return scope.resolvePath
    ? scope.resolvePath(scope.crateRoot, fileName)
    : resolveDiagnosticPath(scope.crateRoot, fileName, scope.fileExists, scope.readManifest);
}

function primarySpanInScope(span: DiagnosticSpan, scope: RepairScope): boolean {
  // Identity, never suffix: a workspace-root "src/lib.rs" must not collide
  // with a member scope that owns the same relative path.
  if (scopeResolvePath(scope, span.fileName) !== scope.filePath) {
    return false;
  }
  // Zero-width primaries are real (E0596 points AT the binding), so a
  // point on the boundary counts as inside.
  if (span.byteStart === span.byteEnd) {
    return span.byteStart >= scope.byteStart && span.byteStart <= scope.byteEnd;
  }
  return span.byteStart < scope.byteEnd && span.byteEnd > scope.byteStart;
}

/** Pure classifier over one diagnostic. Repair wants things that name a
 *  location INSIDE the accepted function and describe a compiler-visible
 *  fault: wrong-value assertion failures are refused no matter how they
 *  were produced, and pre-existing faults elsewhere in the crate surface
 *  without ever reaching a model. No scope means no span filtering (the
 *  contract grid exercises the classifier without one). Precedence is
 *  fixed so the logged reason is always the honest one. */
export function classifyEligibility(
  diagnostic: Diagnostic,
  scope: RepairScope | undefined,
  hooks: EligibilityHooks | undefined,
  auth: TestRepairAuthorization,
): EligibilityDecision {
  // The authorization opens EXACTLY these two branches, and they are the only
  // two a test failure trips. `warning`, `no-location` and `out-of-span` below
  // keep applying unchanged, and a synthesised test-failure diagnostic cannot
  // trip them by construction: it is error-level and its primary span IS the
  // target function's span. Setting that span to the PANIC LOCATION instead
  // would have been the quiet way to break this - an `assert_eq!` panics in the
  // TEST file, which is out of span, so almost every real assertion failure
  // would have been refused by a branch this session promised to leave alone.
  const open = testRepairOpen(auth);
  if (diagnostic.kind === "assertion-failure" && !open) {
    return { eligible: false, reason: "assertion-failure" };
  }
  if (!open && (hooks?.assertionShaped ?? rustcAssertionMessage)(diagnostic)) {
    return { eligible: false, reason: "assertion-failure" };
  }
  if (diagnostic.level === "warning") {
    return { eligible: false, reason: "warning" };
  }
  const primaries = diagnostic.spans.filter((s) => s.isPrimary);
  if (primaries.length === 0) {
    return { eligible: false, reason: "no-location" };
  }
  if (scope && !primaries.some((s) => primarySpanInScope(s, scope))) {
    return { eligible: false, reason: "out-of-span" };
  }
  return { eligible: true };
}

export type SpanScopeKind = "green" | "clean-out-of-span" | "in-span";

/** The span-scoped success verdict: whether the touched function/type is itself
 *  clean, independent of whether the whole crate is green. inSpan/outOfSpan
 *  partition the error-level diagnostics; outOfSpanFiles names the distinct
 *  files the out-of-span errors point at, for the human message. */
export interface SpanScopedVerdict {
  kind: SpanScopeKind;
  /** Error-level diagnostics whose primary span resolves INSIDE the scope. */
  inSpan: Diagnostic[];
  /** Error-level diagnostics not inside the scope: located elsewhere, or with
   *  no primary span to place (rustc's "aborting due to previous error"). */
  outOfSpan: Diagnostic[];
  /** Distinct absolute files among out-of-span errors that carry a locatable
   *  primary span; span-less and unplaced errors contribute nothing here. */
  outOfSpanFiles: string[];
  /** Out-of-span errors whose primaries all carry the -1 no-byte-offset
   *  sentinel (a position the strategy could not convert): they are refused
   *  for repair (safe direction) but carry NO geometry, so the human message
   *  must not claim they sit outside the span. */
  unplaced: number;
}

/**
 * Span-scoped success verdict. Pure and geometric: it asks only
 * whether an error-level diagnostic's primary span lands inside `scope`, the
 * SAME primarySpanInScope test eligibility uses, so the verdict can never
 * disagree with repair about which errors this generation owns. The crate-wide
 * cargo `success` is left untouched by design (the one-way-diagnostics
 * invariant depends on rustc JSON); this only scopes the VERDICT the human
 * reads, so a single unrelated broken file does not make a clean generation
 * read as failed.
 *
 * Warnings never fail a build (success stays true with warnings), so they are
 * ignored. A span-less error cannot be pinned inside the touched span, so it
 * does not block a clean verdict; it is still counted out of span. No scope
 * means nothing can be placed in span, so every error reads out of span (the
 * real flow always passes the touched function's byteScope).
 */
export function spanScopedVerdict(diagnostics: Diagnostic[], scope?: RepairScope): SpanScopedVerdict {
  const inSpan: Diagnostic[] = [];
  const outOfSpan: Diagnostic[] = [];
  const files = new Set<string>();
  let unplaced = 0;
  for (const error of diagnostics) {
    if (error.level !== "error") {
      continue;
    }
    const primaries = error.spans.filter((s) => s.isPrimary);
    if (scope !== undefined && primaries.some((s) => primarySpanInScope(s, scope))) {
      inSpan.push(error);
      continue;
    }
    outOfSpan.push(error);
    if (scope !== undefined) {
      // A -1 byte offset is the no-conversion sentinel: the error is refused
      // for repair but has no geometry, so it may not name a file as
      // "outside" (it can sit inside the accepted file, merely unconverted).
      const placeable = primaries.filter((s) => s.byteStart >= 0);
      if (primaries.length > 0 && placeable.length === 0) {
        unplaced++;
      }
      for (const s of placeable) {
        files.add(scopeResolvePath(scope, s.fileName));
      }
    }
  }
  const kind: SpanScopeKind =
    inSpan.length === 0 && outOfSpan.length === 0
      ? "green"
      : inSpan.length > 0
        ? "in-span"
        : "clean-out-of-span";
  return { kind, inSpan, outOfSpan, outOfSpanFiles: [...files], unplaced };
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * The human-facing span-scoped line, or undefined when there is nothing new to
 * say: a green crate, or in-span errors that repair already
 * handles. States only what the span geometry supports: no
 * error landed INSIDE the touched span, and N error(s) remain OUTSIDE it in the
 * named files. It does NOT claim the symbol is "clean" or the errors are
 * "pre-existing" - an out-of-span error can be downstream of the new signature
 * (rustc reports a bad signature at the caller site), so those are unfounded.
 */
export function spanScopedMessage(verdict: SpanScopedVerdict, symbol?: string): string | undefined {
  if (verdict.kind !== "clean-out-of-span") {
    return undefined;
  }
  const what = symbol ? `\`${symbol}\`` : "the generated code";
  const n = verdict.outOfSpan.length;
  // Unplaced errors have no geometry: the message may not claim they sit
  // outside the span (one could be inside the accepted file, merely
  // unconverted). All-unplaced drops the geometry claim entirely; a mixed
  // set states the placed count and names only placed files.
  if (verdict.unplaced >= n) {
    const noun = n === 1 ? "error" : "errors";
    return `no error could be placed against ${what}'s span; ${n} ${noun} could not be located precisely`;
  }
  const placed = n - verdict.unplaced;
  const noun = placed === 1 ? "error" : "errors";
  const verb = placed === 1 ? "remains" : "remain";
  const where = verdict.outOfSpanFiles.length
    ? `, in ${verdict.outOfSpanFiles.map(basename).join(", ")}`
    : "";
  const unplacedTail = verdict.unplaced > 0 ? ` (+${verdict.unplaced} not precisely located)` : "";
  return `no error landed inside ${what}; ${placed} ${noun} ${verb} outside the touched span${where}${unplacedTail}`;
}

export interface RepairPromptInput {
  /** The failing replacement text as it sits in the document now: the
   *  complete function, signature included. */
  code: string;
  docComment?: string;
  /** Eligible diagnostics only; rendered text plus suggestions feed the
   *  prompt because that is exactly what the spike's repair round fed. */
  diagnostics: Diagnostic[];
  languageId?: string;
  /** v2 compiler-directed surface: the resolved crate API (example or
   *  signatures) for a hallucination-class round. Prepended as its own section
   *  when present; absent keeps the repair prompt byte-identical to v1. */
  surface?: string;
  /** The rendered usage sections, real call sites of the members this span
   *  calls, from the repo's own reference provider.
   *
   *  This leg used to be structurally out of reach of a repair round. Repair
   *  and refine are the same command and mutually exclusive branches of one
   *  decision (`src/vscode/oracleSurface.ts`): errors present runs rounds with
   *  span types plus diagnostic-keyed blocks and NO usage windows; a clean build
   *  plus a manual gesture runs the refine, which is where the usage leg lives.
   *  So the branch that had a compiler error to fix was the branch that could not
   *  see how the repo calls the thing it was fixing.
   *
   *  Absent reproduces the prompt byte for byte, which the frozen identity
   *  oracles pin. */
  usage?: readonly string[];
  /** Structure generation: the failing target's kind, routing the repair
   *  instruction the same way assembleFnGenPrompt routes generation. Omitted or
   *  "function" reproduces the exact v1 repair bytes (the frozen blind7 repair
   *  identity hangs on that). */
  kind?: GenKind;
  /** Python Fork A: the failing code is the BODY ONLY (the span excludes the
   *  preserved header + docstring), so the repair asks for a corrected body, not a
   *  whole definition. Omitted keeps the v1 repair bytes. */
  bodyOnly?: boolean;
  /** The column the failing span was cut from: the target's `headerIndent`, or
   *  `bodyIndent` for a body-only span. The resolver already holds it and hands
   *  the same value to the placement leg on the way back, so supplying it here
   *  makes the 0-based normalisation EXACT rather than inferred. Omitted, each
   *  language infers from the code's own shape, which is right for a braced
   *  language and cannot be for Python: a `def` has no closing token at the
   *  header's column to measure against. Omitting it reproduces the inferred
   *  bytes, which is what the harness and the frozen oracles exercise. */
  spanIndent?: string;
  /** The DOC COMMENT's own column, which is NOT always the code's. A bodyOnly
   *  target is Python Fork A: `stripPyDocstring` has already returned a 0-based
   *  docstring, so this is "" while `spanIndent` is the body's column. Handing
   *  the doc the code's column strips a level the docstring never had, out of
   *  the prose - and in Fork A the docstring IS the spec (review D2). */
  docIndent?: string;
  /** ADDED v60. The rendered failing-test evidence, from
   *  `renderFailureEvidence`. Present ONLY on a manually-invoked Repair Function
   *  whose covering tests went red; the automatic post-fn-gen path never runs a
   *  test and never sets it.
   *
   *  When present, `diagnostics` is normally EMPTY: the failing-test round has no
   *  compiler errors to show, and the evidence block replaces the diagnostics
   *  block rather than sitting beside an empty fence. Absent reproduces the v1
   *  repair bytes exactly, which the frozen identity oracles pin. */
  failureEvidence?: string;
  /** ADDED v60. Which oracle produced the failure, which decides the intro
   *  sentence and the instruction. Omitted means "compiler", the v1 bytes. */
  oracle?: "compiler" | "tests";
  /** The user's manually-added context, same list the generate path injects.
   *  Rendered as leading `Context:` sections so a repair round sees what the
   *  human staged, not just the failing code. Undefined or empty reproduces the
   *  exact v1 repair bytes - the frozen identity oracles hang on that. */
  contextBlocks?: ContextBlock[];
}

// Trailing-whitespace strip plus exactly one newline: rustc's rendered text
// arrives with a trailing blank line that would otherwise double-space the
// diagnostics block.
function normalizeBlock(text: string): string {
  return text.replace(/\s+$/, "") + "\n";
}

/** Deterministic, byte-for-byte, same discipline as assembleFnGenPrompt.
 *  Code-then-errors order with the trailing instruction is the shape the
 *  spike measured (prior-art/spike-harness/driver3.py REPAIR_PROMPT),
 *  ported not reinvented. Output
 *  goes through the existing FnGenService, so its reply obeys the same
 *  postprocess and producer guards as any generation. */
export function assembleRepairPrompt(input: RepairPromptInput): string {
  // The prompt must show the failing code exactly as the generation prompt shows
  // a definition: head flush, body relative to it. The span text arrives with the
  // FILE's absolute columns on every line but the first, and a model echoes what
  // it was shown, so placement then adds the target's indent on top of an indent
  // the body already carried — one level deeper every round. Normalising here
  // keeps ONE placement rule correct on both paths; the reply-base computation is
  // untouched, because round 0's reply is already relative to a flush-left head.
  const dedented = dedentReplyCode(input.code, input.languageId, input.spanIndent);
  const code = dedented.endsWith("\n") ? dedented : dedented + "\n";
  // The doc rides the same span and carries the same absolute columns on every
  // line but the first, so it is normalised with the code (review of the live
  // acme-db capture). Prose, so a KNOWN column only: never inferred.
  const doc =
    input.docComment === undefined
      ? ""
      : normalizeBlock(dedentDocComment(input.docComment, input.docIndent));
  // A type target routes the intro and the instruction to the type definition;
  // a function (or an omitted kind) keeps the exact v1 bytes. The kind word
  // (struct/enum/class/interface) rides straight into the prose. bodyOnly
  // (Python, below a preserved docstring) takes precedence: the failing code IS
  // the body, so the repair asks for a corrected body, never a full definition
  // (which would be spliced into the body-only span and duplicate the header —
  // review BLOCKER 1).
  const isType = input.kind !== undefined && input.kind !== "function";
  // A test round's failing code COMPILES. Saying it "failed the compiler check"
  // would be false on its face and would point the model at the wrong kind of
  // fault, so the test leg gets its own sentence. It says the tests disagree
  // with the implementation and stops there: which of the two is wrong is not
  // something a test run settles, and test repair stays banned.
  const testOracle = input.oracle === "tests";
  const failedWhat = testOracle ? "compiles, but the tests that cover it fail" : "failed the compiler check";
  const intro = input.bodyOnly
    ? `The body below (of ${isType ? "a type" : "a function"} whose header and docstring are already written) ${failedWhat}:`
    : isType
      ? `The ${input.kind} definition below ${failedWhat}:`
      : `The function below ${failedWhat}:`;
  // The doc comment is repository prose and can hold a fenced example of its
  // own; the span can be a docstring body. One rule, stated in
  // instructPostprocess beside the reader that decides what closes a block.
  const codeBody = `${doc}${code}`;
  const codeFence = fenceFor(codeBody);
  const codeSection = `${intro}\n${codeFence}${input.languageId ?? ""}\n${codeBody}${codeFence}`;

  // rendered carries spans, expected/found labels, and rustc's own help
  // lines (suggested_replacement content) in the exact form a human reads;
  // no second serialization.
  const body = input.diagnostics.map((d) => normalizeBlock(d.rendered ?? d.message)).join("");
  // rustc renders the offending source INTO the diagnostic, so a docstring
  // line carrying a fence arrives here too.
  const diagFence = fenceFor(body);
  const diagnosticsSection = `Compiler diagnostics:\n${diagFence}\n${body}${diagFence}`;
  // The evidence block REPLACES the diagnostics block when there are no
  // diagnostics, rather than sitting beside an empty fence. A test round
  // normally has exactly that shape.
  const evidence = input.failureEvidence;
  const evidenceSection =
    evidence === undefined || evidence.trim().length === 0
      ? undefined
      : (() => {
          const text = normalizeBlock(evidence);
          const fence = fenceFor(text);
          return `Test failures:\n${fence}\n${text}${fence}`;
        })();

  const testInstruction = input.bodyOnly
    ? `Fix the body so the failing tests pass. Reply with one fenced code block containing ONLY the corrected body - do not repeat the signature, the header, or the docstring, and add no code before or after the body. Do NOT change any test. Output nothing outside the code block.`
    : isType
      ? `Fix the ${input.kind} so the failing tests pass, staying strictly inside this one type. Reply with one fenced code block containing the corrected complete ${input.kind} definition. Do NOT change any test. Output nothing outside the code block.`
      : `Fix the function so the failing tests pass. Reply with one fenced code block containing the corrected complete function definition, signature and body. Do NOT change any test, and do not weaken the function to satisfy one: the tests below are the specification. Output nothing outside the code block.`;
  const compilerInstruction = input.bodyOnly
    ? `Fix the body below. Reply with one fenced code block containing ONLY the corrected body — do not repeat the signature, the header, or the docstring, and add no code before or after the body. Output nothing outside the code block.`
    : isType
      ? `Fix the ${input.kind}. Reply with one fenced code block containing the corrected complete ${input.kind} definition, staying strictly inside this one type. Output nothing outside the code block.`
      : "Fix the function. Reply with one fenced code block containing the corrected complete function definition, signature and body. Output nothing outside the code block.";
  const instruction = testOracle ? testInstruction : compilerInstruction;

  // The user's manually-added context leads, exactly as it does in generation
  // (assembleFnGenPrompt), then the v2 compiler-directed surface, then the
  // failing code. No blocks and no surface reproduces the v1 repair bytes.
  const contextSections = (input.contextBlocks ?? []).map(renderContextBlock);
  // Usage sits between the injected surface and the failing code, which is where
  // `assembleRefinePrompt` puts it and for the same reason: the model reaches
  // for whatever sits nearest the code (v28 measured the effect at the fn-gen
  // surface, v29 at the FIM member site), and what this round wants it to reach
  // for is the repo's own call shape. Reasoned placement, not a measured one.
  const sections = [
    ...contextSections,
    ...(input.surface ? [input.surface] : []),
    ...(input.usage ?? []),
    codeSection,
    // Failure evidence goes where the compiler diagnostics go, so the model
    // reads "here is the code, here is what went wrong, fix it" in one shape
    // whichever oracle produced the wrongness. When both exist, diagnostics
    // lead: an error is a harder fact than a red test.
    ...(input.diagnostics.length > 0 ? [diagnosticsSection] : []),
    ...(evidenceSection === undefined ? [] : [evidenceSection]),
    ...(input.diagnostics.length === 0 && evidenceSection === undefined ? [diagnosticsSection] : []),
    instruction,
  ];
  return sections.join(SECTION_SEPARATOR);
}

export type RepairRoundIndex = 1 | 2;

export type SurfaceReason =
  | "clean"
  | "disabled"
  | "no-eligible"
  | "no-eligible-in-span"
  | "cap-exhausted"
  | "route-exhausted";

export type RepairAction =
  | {
      kind: "repair";
      round: RepairRoundIndex;
      route: RepairRoute;
      /** The diagnostics this round is allowed to see. */
      eligible: Diagnostic[];
    }
  | {
      kind: "surface";
      why: SurfaceReason;
      /** Everything the human should see, warnings included. */
      diagnostics: Diagnostic[];
    };

/**
 * One session per accepted generation. next() is the only mutator: feeding
 * it a check result either consumes a round (kind "repair") or ends the
 * session (kind "surface"). After any "surface" the session is finished and
 * every later next() throws; after roundsUsed reaches 2 a "repair" action
 * is unrepresentable — the cap branch precedes the routing table, and no
 * reset or second counter exists.
 */
export class RepairSession {
  private rounds: 0 | 1 | 2 = 0;
  private done = false;
  /** The error count the PREVIOUS granted round was handed, so round 2 can ask
   *  whether the count is still falling. Undefined before the first grant. */
  private lastErrorCount: number | undefined;

  constructor(
    private readonly source: GenerationSource,
    private readonly enabled: boolean,
    private readonly log?: LogFn,
    private readonly hooks?: EligibilityHooks,
    /** Defaults to UNAUTHORIZED, so a session constructed the way every shipped
     *  call site constructs it refuses assertion failures exactly as before.
     *  Only the manual Repair Function gesture's test leg passes anything else. */
    private readonly auth: TestRepairAuthorization = NO_TEST_REPAIR,
  ) {}

  get roundsUsed(): 0 | 1 | 2 {
    return this.rounds;
  }

  get finished(): boolean {
    return this.done;
  }

  next(check: OracleCheckResult, scope?: RepairScope): RepairAction {
    if (this.done) {
      throw new Error("RepairSession.next called after the session surfaced");
    }
    const errors = check.diagnostics.filter((d) => d.level === "error");
    if (errors.length === 0) {
      return this.surface("clean", check.diagnostics);
    }
    // The check already ran; disabling repair never disables the oracle.
    if (!this.enabled) {
      return this.surface("disabled", check.diagnostics);
    }
    const eligible: Diagnostic[] = [];
    let refusedOutOfSpan = 0;
    for (const error of errors) {
      const decision = classifyEligibility(error, scope, this.hooks, this.auth);
      if (decision.eligible) {
        eligible.push(error);
      } else {
        if (decision.reason === "out-of-span") {
          refusedOutOfSpan++;
        }
        this.log?.(`[repair] ineligible code=${error.code ?? "-"} reason=${decision.reason}`);
      }
    }
    if (eligible.length === 0) {
      // no-eligible-in-span when span scoping did the refusing: the crate
      // has repairable-shaped errors, just not in what this accept touched.
      return this.surface(
        refusedOutOfSpan > 0 ? "no-eligible-in-span" : "no-eligible",
        check.diagnostics,
      );
    }
    // The structural cap: this branch precedes routing, so no route can
    // fire past it.
    if (this.rounds === 2) {
      return this.surface("cap-exhausted", check.diagnostics);
    }
    const round: RepairRoundIndex = this.rounds === 0 ? 1 : 2;
    // Routing on (source, round). FIM output crosses to the 30b once; after
    // that the failing text IS 30b output, so round 2 is self-repair. For
    // fngen there is no bigger model to cross to, so round 2 is granted only
    // when the errors are STILL FALLING. It used to end flat at round 1, which
    // quit with the count dropping: the capture went 12 errors, then 2, then 1,
    // and stopped, and the human read the file to find out.
    //
    // This does NOT raise the cap. The cap branch above is structural and runs
    // first, so this only grants the round the table already refused.
    //
    // FALLING means the TOTAL error count went down. That is the obvious
    // reading and deliberately not the only one: a round that trades two errors
    // for one different error counts as progress here, and whether it should is
    // not settled by this corpus, which records counts and not per-round codes.
    //
    // MEASURED before it was granted, on all 156 compile-failure rows of the
    // complexity study's own corpus, re-run with two repair gestures per row (a
    // fresh session per press against the body the last one left, which is the
    // gesture a developer can already perform by hand). Neither the corpus file
    // nor the runner survived that session, so the numbers below are their only
    // record. 30 rows fell without clearing; a second round CLEARED 3 of them,
    // exactly the one-in-ten the goal set as the bar, at a median 8.3s. Three
    // more fell further without clearing and three got worse.
    //
    // Read the margin honestly: 3 of 30 is a knife edge, and one row either way
    // moves it to 6.7% (refuted) or 13.3%. What supports keeping it is the wider
    // population - across all 96 rows where a second press ran, 20 improved and
    // 6 got worse.
    const falling =
      this.lastErrorCount !== undefined && errors.length < this.lastErrorCount;
    const route: RepairRoute | undefined =
      this.source === "fim"
        ? round === 1
          ? "cross-model"
          : "self-repair"
        : round === 1
          ? "self-repair"
          : falling
            ? "self-repair"
            : undefined;
    if (route === undefined) {
      if (round === 2 && this.lastErrorCount !== undefined) {
        // Say WHY the second round was refused. "route-exhausted" alone reads as
        // "the table ran out" when the real answer is that this round bought
        // nothing, and those want different fixes.
        this.log?.(
          `[repair] round 2 refused: errors ${this.lastErrorCount} -> ${errors.length}, not falling`,
        );
      }
      return this.surface("route-exhausted", check.diagnostics);
    }
    // Consumed before any model call happens: an abandoned round still
    // counts, the conservative direction for a hard cap.
    this.rounds = round;
    // Recorded at the GRANT, so round 2 compares against what round 1 was handed
    // rather than against whatever the last call happened to see.
    this.lastErrorCount = errors.length;
    this.log?.(`[repair] decision round=${round}/2 route=${route} source=${this.source} eligible=${eligible.length}`);
    return { kind: "repair", round, route, eligible };
  }

  private surface(why: SurfaceReason, diagnostics: Diagnostic[]): RepairAction {
    this.done = true;
    const errors = diagnostics.filter((d) => d.level === "error").length;
    const warnings = diagnostics.filter((d) => d.level === "warning").length;
    this.log?.(`[repair] surface why=${why} errors=${errors} warnings=${warnings}`);
    return { kind: "surface", why, diagnostics };
  }
}
