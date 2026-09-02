import * as vscode from "vscode";
import { readFileSync } from "fs";
import { CompletionService, INJECTION_DEADLINE_MS } from "../core/completionService";
import { DICTATION_SURFACE_TOK } from "../core/budgetProfile";
import { declarationGhost, type DeclarationGhost } from "../core/dictationDoc";
import { trailingOverlapLength } from "../core/postprocess";
import {
  EnumRhsSite,
  FimInjection,
  argTypeStopRulesFor,
  echoedNameRun,
  enumRhsSiteFor,
  lineCommentFor,
  memberTypeContainerFor,
  memberTypeNameFor,
  separatorRunAt,
  separatorRunTolerant,
  memberReceiverName,
  memberSiteFor,
  memberSiteLegalNames,
  narrowToPartial,
  recordDarkSite,
  renderEnumVariants,
  renderFimCandidates,
  typeSpellingFor,
} from "../core/fimInject";
import { COMMENT_PREFIX_CHARS, InCommentKind, commentSyntaxFor, cursorInComment } from "../core/fimComment";
import { fimServesLanguage } from "../core/fimLanguages";
import { noteSuppression, sessionSuppressions } from "../core/suppressionLedger";
import {
  createInjectionCache,
  findTypeAnchorInText,
  goFindTypeAnchorInText,
  pyFindTypeAnchorInText,
  renderWholeBlockInjection,
  wholeBlockSiteFor,
  FileVersionInjectionCache,
} from "../core/fimWholeBlock";
import { WalkBounds } from "../core/dataShape";
import { HoverSurface, SourceCursor, SurfaceExtractor, semanticMembers } from "../core/extraction";
import { absorbCsWarmSurface, createChainCache, fillMissingSignatures } from "../core/chainSurface";
import { csReceiverType } from "../core/csExtraction";
import { goElideDef, goElisionLogLine } from "../core/goExtraction";
import { CHAIN_WARM_RESOLVE_CAP } from "./csExtractor";
import { TS_LANGUAGE_IDS } from "../core/tsExtraction";
import {
  CrossFileBound,
  CrossFileShape,
  DerivedType,
  resolveCrossFileShape,
  shapeHooksFor,
  toResolveStruct,
} from "../core/crossFileShape";
import { ARG_TYPE_DEADLINE_MARGIN_MS, resolveArgTypesInBudget } from "../core/argTypeSurface";
import { resolveUsageInBudget } from "../core/usageSurface";
import {
  ScopeState,
  bareMemberName,
  createScopeState,
  dropHeldScope,
  heldScopeName,
  heldStateKey,
  memberIdentifier,
  namesAMember,
  onCursorMoved as scopeCursorMoved,
  onExpiry as scopeExpiry,
  onRequest as scopeRequest,
  onSecondEscape as scopeSecondEscape,
  onServe as scopeServe,
  scopedGhostKey,
  windowDeadline,
} from "../core/scopeLifecycle";
import { readConfig, readOracleConfig } from "./config";
import { extractorFor } from "./extractors";

// The window constant lives with the machine now; re-exported because the
// extension manifest docs and the v20 contract tests name it here.
export { PASSIVE_SCOPE_MS } from "../core/scopeLifecycle";

// The whole-block bound mirrors fnGen.ts's DATASHAPE_BOUNDS /
// CROSS_FILE_BOUND / DATASHAPE_TOTAL_TOK verbatim, so FIM whole-block emits under
// the SAME 2-D bound + aggregate budget the prefill path uses (one bound, not a
// second drifting one). Kept as literals here to avoid a vscode-heavy import.
const DATASHAPE_BOUNDS: WalkBounds = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 200 };
const CROSS_FILE_BOUND: CrossFileBound = { D_MAX: DATASHAPE_BOUNDS.D_MAX, N_MAX: 12 };
const DATASHAPE_TOTAL_TOK = 300;

/** The member the native suggest widget picked, in force for one request.
 *  `range` is the widget's OWN replacement range and is present only while the
 *  widget is open; once it is dismissed the scope lives on but there is no
 *  widget range to match, so the item anchors at the cursor. */
interface SelectionScope {
  /** The widget's text, copied verbatim. Whether it carries a leading
   *  separator, a bare name, or a rendered argument list is the server's
   *  choice and varies by language and by state. */
  readonly text: string;
  /** The bare member name: no leading `.`, no leading `::`. */
  readonly name: string;
  readonly range?: vscode.Range;
}

/** The passive window's dependencies, injected so a test drives the window
 *  instead of waiting 1.5 real seconds. */
export interface ScopeHooks {
  /** Milliseconds since the epoch. */
  now(): number;
  /** Arm a one-shot timer; the returned function cancels it. */
  setTimer(ms: number, fn: () => void): () => void;
  /** A passive window has closed and its record is already dropped. The
   *  editor has to be ASKED to re-render, because nothing re-invokes an
   *  inline completion provider on the passage of time - without this the
   *  expired ghost sits on screen until the next keystroke, which is the
   *  revert never happening. */
  onExpired(): void;
  /** The second-Escape state turned on or off: true while a scope is in
   *  force, SERVED OR NOT, because a scope whose ghost starved is exactly the
   *  one the fast revert must still reach - false when the record is gone.
   *  Fired only on a CHANGE. Drives the editor context key behind the
   *  second-Escape keybinding; the key deliberately does NOT encode "widget
   *  closed", because the machine's only widget signal is requests and those
   *  are not guaranteed to arrive. The widget owning the first Escape is the
   *  keybinding's `!suggestWidgetVisible`, which the editor evaluates live. */
  onScopedGhost?(visible: boolean): void;
}

/** A dictated intent waiting for its one request. `comment` is the rendered
 *  comment block; `eol` and `indent` are appended to the ghost so the accept
 *  lands the cursor on a fresh line at the block's indent. */
export interface ArmedIntent {
  /** The gesture this intent belongs to; `onServed` answers carry it back so a
   *  replaced intent's `false` cannot end its successor. */
  id: number;
  uri: string;
  line: number;
  /** `line`: the sentence is a throwaway comment and the ghost is the next statement.
   *  `declaration`: the sentence is the DOC COMMENT, kept in the file above the head FIM
   *  writes; both land in the one accept (session-v65 gesture 2, first half). */
  kind: "line" | "declaration";
  /** The cleaned sentence, for the declaration ghost's doc comment or docstring. */
  sentence: string;
  /** One indent unit of the file, for the body line a declaration opens. */
  unit: string;
  comment: string;
  /** Type names the dictation spoke and the matcher ticked, resolved FIRST
   *  (session-v65 pipeline ruling: above the signature's types and the body
   *  walk, at the root cap and at the render). */
  roots: readonly string[];
  eol: string;
  indent: string;
  onServed(ghost: boolean): void;
}

/** The production clock and timer, with a no-op re-render. Exported so the
 *  extension spreads it and overrides `onExpired` alone, rather than keeping a
 *  second untested copy of the timer plumbing. */
export const REAL_SCOPE_HOOKS: ScopeHooks = {
  now: () => Date.now(),
  setTimer: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
  onExpired: () => {},
};

// The member name the buffer will spell once an item lands, read off the line
// the edit PRODUCES rather than reassembled from the pieces that compose it.
// Reassembly needs a premise about every piece; this needs one, and a narrower
// one. The caller splices with `range.start.character` and `range.end.character`
// into the CURSOR's line and never reads `range.start.line`, so `head + text +
// tail` is the landed line exactly while the item's range lies on the cursor's
// line. Every range this provider builds does: the cursor-anchored ones are
// constructed from `position`, and the widget's own range is single-line.
//
// `floor` is the earliest column the name could start at - the character after
// the separator in the buffer, or the start of the item's own range when the
// item respells the separator itself. Skipping the separator run from there,
// rather than assuming its length, is what lets a `::` member and a `.` member
// read the same way.
function landedMemberName(line: string, floor: number): string {
  return memberIdentifier(line.slice(floor));
}


// One spelling of "which document state is this". The machine treats keys as
// opaque and compares them by equality, so this format is the provider's own;
// the separator is NUL because no uri and no number contains one, which is
// what lets the cursor hook read the uri and version back out.
function stateKey(uri: string, version: number, line: number, character: number): string {
  return `${uri}\0${version}\0${line}\0${character}`;
}

const NO_ECHO = { lead: "", echoed: "" };

// `$` is a legal identifier character in JS and TS, it is in `IDENTIFIER_RUN`
// above, and it is a RegExp metacharacter. So this is load-bearing today for a
// member named `$foo`, not merely defensive against a server handing back
// something exotic.
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Thin adapter: document + position in, ghost text out. All pipeline logic
// (debounce, cache, single-flight, postprocess) lives in the headless service.
export class FimCompletionProvider implements vscode.InlineCompletionItemProvider {
  // One per-file-version cache instance across every completion call: a warm
  // fire (unchanged uri+version) is a Map hit that wins the 50ms race; an edit
  // bumps document.version and invalidates. Provider state, not per-call.
  private readonly injectionCache: FileVersionInjectionCache = createInjectionCache();

  // The DISTINCT dark member sites seen this session (a `.` site that injected
  // nothing), each with the reasons already reported for it. Provider state;
  // keyed on `uri:line:character`, every language.
  private readonly darkSites = new Map<string, Set<string>>();

  // The same counter for the in-comment rule, keyed on `uri:line` rather than
  // `uri:line:character`. Writing a comment moves the column on every
  // keystroke, so a column in the key would put the line back to once per
  // keystroke, which is the thing the counter exists to avoid. A comment line
  // is the site.
  private readonly commentDarkSites = new Map<string, Set<string>>();

  // Languages with no row in the comment table, already reported. One line per
  // session each, so "the comment rules are silently dead here" is a fact
  // someone can read rather than infer.
  private readonly commentDarkLanguages = new Set<string>();
  // Languages this session has already refused. One line per language, not one
  // per keystroke: a human writing a paragraph of markdown would otherwise get
  // a line per character, which buries everything else on the channel.
  private readonly unservedLanguages = new Set<string>();
  // The `column80.fimLanguages` value the set above was filled under. A change
  // empties it, so the answer is given again after the human moves the setting.
  private unservedEpoch = "";

  // The whole scope/sticky/window/revert decision, owned by the pure machine.
  // The provider translates editor types into its events and mirrors two of
  // its outputs into the world: the window timer (below) and the context key
  // (syncScopeMirrors). VS Code re-invokes the provider once more with
  // `selectedCompletionInfo` UNDEFINED when the user presses Escape, at the
  // same position and document version (measured against real VS Code); the
  // machine is what remembers the selection past that.
  private readonly scope: ScopeState = createScopeState();

  // Cancels the pending passive-window timer, if one is armed. The machine
  // decides when a window exists; this is the real timer mirroring it, and it
  // is cancelled whenever the machine's window goes away for any OTHER reason
  // (an edit, a cursor move, a new selection) rather than leaving one to fire
  // against a state the machine no longer holds.
  private cancelExpiry: (() => void) | undefined;

  // The re-render fired by an expiry arrives as a MANUAL invoke, which the
  // service reads as debounce-bypassed and fans out to alternatives. The
  // provider asked for that request, the user did not, so the next request
  // consumes this flag and is dispatched as automatic. One-shot: a genuine
  // user Invoke after it still fans out.
  private downgradeNextManual = false;

  /** The dictated intent armed for the NEXT invocation at its site, and only
   *  that one. Session-v65 ruling 3: the comment rides on the request it was
   *  spoken for; chaining is a new press. `onServed` tells the gesture whether
   *  a ghost went on screen, because nothing else in the editor says so. */
  private pendingIntent: ArmedIntent | undefined;

  /** Arm a dictated intent for the next request at `uri:line`. The trigger
   *  that follows is the editor's explicit one, which the provider would read
   *  as a manual fan-out; the downgrade flag makes it one generation, and the
   *  intent makes the service skip the debounce and the cache. */
  armIntent(intent: ArmedIntent): void {
    if (this.pendingIntent !== undefined) {
      this.output.appendLine(`[dictate] intent replaced before it was served at ${this.pendingIntent.uri}:${this.pendingIntent.line}`);
      this.pendingIntent.onServed(false);
    }
    this.pendingIntent = intent;
    this.downgradeNextManual = true;
  }

  /** Whether a dictated intent is waiting for THIS site, without consuming it. */
  private intentArmedFor(uri: string, line: number): boolean {
    return this.pendingIntent !== undefined && this.pendingIntent.uri === uri && this.pendingIntent.line === line;
  }

  /** Consume the armed intent if this invocation is at its site; an invocation
   *  anywhere else drops it, on the record, because a comment spoken for one
   *  line must never ride a request for another. */
  private takeIntent(uri: string, line: number): ArmedIntent | undefined {
    const intent = this.pendingIntent;
    if (intent === undefined) {
      return undefined;
    }
    this.pendingIntent = undefined;
    if (intent.uri !== uri || intent.line !== line) {
      this.output.appendLine(`[dictate] intent dropped: the next request was at ${uri}:${line}, not ${intent.uri}:${intent.line}`);
      intent.onServed(false);
      return undefined;
    }
    return intent;
  }

  // The machine's context key as last reported to the editor. Held so the
  // hook fires on transitions rather than on every request: the context key
  // it drives is a command round trip per call.
  private scopedGhostShown = false;

  // The chain-surface cache (src/core/chainSurface.ts): signatures for the
  // members a provider's resolve cap can never reach, filled by a background
  // warm and merged into starved member sets at render time. Provider state,
  // so it lives for the extension session — one extension host is one
  // workspace, and it survives config-driven CompletionService rebuilds
  // (getService is a closure; this provider instance is never rebuilt).
  private readonly chainCache = createChainCache();
  // One warm per starved RECEIVER TYPE per session (the key IS the derived
  // `csharp\0<type>` namespace string, triage-p3 finding 2), one in flight at
  // a time: the warm resolves the provider's whole order (~600ms of
  // serialized Roslyn work), so an unthrottled per-keystroke storm would
  // contend with the very completions it exists to help. A failed or
  // stale-version warm releases its key (warmChainSurface); a capped warm
  // succeeded and keeps it.
  private readonly chainWarmedSites = new Set<string>();
  private chainWarmInFlight = false;

  constructor(
    private readonly getService: () => CompletionService,
    private readonly output: vscode.OutputChannel,
    /** Called when a member site is seen with the suggest widget open. The
     *  rust-analyzer snippet nudge hangs off this; optional so every test
     *  harness constructing a provider does not have to know about it. */
    private readonly onWidgetMemberSite?: (languageId: string) => void,
    /** Clock, timer and re-render hook for the passive preselect window.
     *  Defaults to the real ones with a no-op re-render; extension.ts wires
     *  the editor command, a test wires a fake clock. */
    private readonly timing: ScopeHooks = REAL_SCOPE_HOOKS,
  ) {}

  /** Extension-wired: an edit in `uri` evicts other files' cached injection
   *  blocks (their member lists may name surface the edit changed). */
  onDocumentChanged(uri: string): void {
    this.injectionCache.retainOnly(uri);
    // An edit in the record's OWN file kills it, and the timer with it. The
    // record is already dead to the next request - it pins a document version
    // the edit has bumped - but the pending timer does not go through a
    // request, so without this it survives the edit and fires a re-render
    // nobody asked for. Accepting a widget item IS such an edit, so the case
    // is a first-class gesture rather than a corner. The uri filter lives
    // here because the machine's keys are opaque to it; this provider minted
    // them, so it is the one that can read the uri back out.
    if (heldStateKey(this.scope)?.split("\0")[0] === uri) {
      dropHeldScope(this.scope);
      this.syncScopeMirrors();
    }
  }

  /** Background chain-surface warm (C# only today): a second completion
   *  request at the same cursor with a resolve count covering the provider's
   *  WHOLE order, absorbed into the workspace cache by stripped name.
   *  Object-declared signatures are excluded before absorb — the
   *  wrong-substitution and tier-invariant reasons live on
   *  absorbCsWarmSurface.
   *
   *  `namespace` is the derived `csharp\0<receiverType>` string, and it is
   *  ALSO the dedup key (triage-p3 findings 1 and 2): one warm per starved
   *  receiver TYPE per session. The same type at another uri is a cache hit
   *  (the surface is workspace-constant, the cache's premise); the same
   *  spelled receiver of a DIFFERENT type derives its own key and re-warms,
   *  so one type's entries can never pin another type dark. A failed warm and
   *  a stale-version skip both RELEASE the key, so the next site at that type
   *  retries. One warm in flight at a time — the warm is ~600ms of serialized
   *  Roslyn resolves and must never contend per keystroke with the live
   *  completion path.
   *
   *  This runs detached and OUTLIVES cancellation of the request that fired
   *  it; the document-version guard is what makes that survivable (triage-p3
   *  finding 3): the resolve may execute against a buffer that changed after
   *  fire time, and whatever surface lives at the stale position then must
   *  not enter the cache — version moved means absorb nothing, release the
   *  key, say so once. */
  private async warmChainSurface(
    extractor: SurfaceExtractor,
    document: vscode.TextDocument,
    cursor: SourceCursor,
    namespace: string,
  ): Promise<void> {
    const resolveAll = extractor.resolveAllMembers;
    if (resolveAll === undefined || this.chainWarmInFlight || this.chainWarmedSites.has(namespace)) {
      return;
    }
    this.chainWarmedSites.add(namespace);
    this.chainWarmInFlight = true;
    const versionAtFire = document.version;
    const typeName = namespace.split("\0")[1] ?? namespace;
    try {
      const all = await resolveAll.call(extractor, cursor);
      if (document.isClosed || document.version !== versionAtFire) {
        this.chainWarmedSites.delete(namespace);
        this.output.appendLine(
          `[fim] chain warm for ${typeName}: skipped, the document changed during the resolve`,
        );
        return;
      }
      const absorbed = absorbCsWarmSurface(this.chainCache, all, namespace);
      // A surface wider than the resolve cap keeps its key (the head still
      // absorbed) but says so: the unwarmable tail is the widening trigger
      // for the deferred cap finding (triage-p3 finding 8).
      const capped =
        all.length > CHAIN_WARM_RESOLVE_CAP ? `, capped at ${CHAIN_WARM_RESOLVE_CAP} of ${all.length}` : "";
      this.output.appendLine(
        `[fim] chain warm for ${typeName}: resolved ${all.length} members, absorbed ${absorbed} new signatures${capped}`,
      );
    } catch {
      // A background warm has nobody to tell; releasing the key lets the next
      // site at this type retry.
      this.chainWarmedSites.delete(namespace);
    } finally {
      this.chainWarmInFlight = false;
    }
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    // Consumed before every gate below it, whatever they decide. The flag
    // disowns ONE request, the re-render the provider itself asked for, and
    // leaving it armed for a later request silently downgrades a fan-out the
    // user did ask for. docs/architecture/fim-completion.md, "The one-request
    // downgrade flag", files that against the enabled
    // gate and named this fix; v29 added a second early return, which is the
    // reason it is now taken.
    const providerTriggered = this.downgradeNextManual;
    this.downgradeNextManual = false;

    const config = readConfig();
    // Every invocation, not just a refused one. A human widens to cpp, gets
    // served (so nothing is reported), then narrows again: an epoch that only
    // moved inside the report path would still be holding the first refusal and
    // the second one would be silent.
    this.syncUnservedEpoch(config.fimLanguages);
    // FIM off is keystroke FIM off. A DICTATED request is the human asking, and it is served
    // with the setting off; the automatic request on the fresh line after it is refused here
    // like any other keystroke.
    if (!config.enabled && !this.intentArmedFor(document.uri.toString(), position.line)) {
      return this.noGhost("column80.fim is disabled");
    }

    // FIM runs on code, and only on code. The provider registers on document
    // SCHEME, so without this every file VS Code opens reached the model:
    // markdown, plaintext, latex, asciidoc, JSON, YAML, lock files. A model call
    // per keystroke in a `.md` for a serve nobody wants.
    //
    // Ahead of the `invoked` line below, deliberately, and that is the one place
    // this breaks that line's "first, before anything can return" rule. The
    // reason the invoked line exists is to tell "the provider was never asked"
    // apart from "the provider was asked and said nothing", and for an unserved
    // language the once-per-language refusal below answers that question for
    // the whole session. Printing both would mean a line per character while a
    // human writes a paragraph of prose, which buries the events around it.
    //
    // A set lookup, so this is also the cheapest exit in the provider: before
    // the comment scan's bounded copy, before the debounce, before the cache,
    // before any resolver query.
    if (!fimServesLanguage(document.languageId, config.fimLanguages)) {
      return this.reportLanguageUnserved(document.languageId);
    }

    // ONE line per invocation, before anything can return. The exits all name
    // their reason now, but an exit line only exists for an invocation that
    // HAPPENED - and "no log at all when I arrow" is ambiguous between the
    // provider never being asked and the provider returning through a path that
    // still says nothing. This is the line that tells those apart, and it has to
    // be first for that to hold.
    this.output.appendLine(
      `[fim] invoked ${vscode.InlineCompletionTriggerKind[context.triggerKind] ?? context.triggerKind}` +
        ` selection=${context.selectedCompletionInfo === undefined ? "none" : JSON.stringify(context.selectedCompletionInfo.text)}` +
        ` at ${position.line}:${position.character}`,
    );

    // Inside a comment there is no ghost. This is argued on identity, not on a
    // measurement: a doc comment is the developer's spec, and a model writing
    // the spec is the one thing the manifesto forbids outright.
    //
    // Here rather than in the service, and before anything else runs, because
    // going dark should cost no model call and no resolver query - which is
    // also the cheapest latency in the product. The predicate itself is
    // core-side; this layer only adapts.
    //
    // It reads a BOUNDED tail rather than the document, and the whole prefix and
    // suffix are materialised below it rather than above. The scan windows
    // itself to COMMENT_SCAN_CHARS, so everything past COMMENT_PREFIX_CHARS was
    // being copied only to be dropped. A flat copy of that size costs 896us in
    // V8 at 1.4MB, and the corpus this product is used on carries a 553KB source
    // file; the copy inside the running editor is not measured, so this is work
    // removed rather than a latency figure. The
    // verdict is unchanged by construction and pinned by a characterisation
    // test over the shapes that depend on history, unterminated block comments
    // included.
    const commentSyntax = commentSyntaxFor(document.languageId);
    if (commentSyntax === undefined) {
      this.reportCommentRulesDark(document.languageId);
    } else {
      const at = cursorInComment(
        document.getText(new vscode.Range(commentScanStart(document, position), position)),
        commentSyntax,
      );
      if (at.inComment && at.kind !== undefined) {
        return this.darkInComment(document.uri.toString(), position.line, at.kind);
      }
    }

    const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const lastLine = document.lineCount - 1;
    const suffix = document.getText(new vscode.Range(position, document.lineAt(lastLine).range.end));

    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());

    // Injection applies where the language has a registered EXTRACTOR (not
    // merely an oracle): a checker without a resolver keeps injection dark.
    // Registry lookup first: unregistered languages short-circuit on a
    // string compare and never pay the config read.
    const registered = extractorFor(document.languageId);
    const oracleConfig = readOracleConfig();
    const extractor = registered && oracleConfig.injectionEnabled ? registered : undefined;
    // The usage leg's own switch, separate from `injectionEnabled` because it is
    // a different bet: injection is the v2 thesis and this is one measured leg
    // on top of it, with its own arms in docs/architecture/fim-completion.md,
    // "Usage windows at a member site", and its own
    // way of being wrong (a window carries another call site's locals).
    const usageOn = oracleConfig.usageExamples;

    // v2 candidate injection: at a `.`/`::` site, resolve the receiver's real
    // member signatures from the user's language server and inject them. Only
    // when the setting is on. The closure runs inside the service, after the
    // debounce, so a non-surviving keystroke costs no query.
    const site = memberSiteFor(document.languageId)(prefix);
    // The member the native suggest widget has picked, if any, still in force
    // after the Escape that dismissed it. The machine owns the whole decision:
    // session tracking, the refusal record, the never-served drop, the window
    // deadline. This provider only translates the editor's shapes into the
    // event and carries the widget range, which is a VS Code artifact the
    // machine never needs.
    const selected = context.selectedCompletionInfo;
    const requested = scopeRequest(this.scope, {
      stateKey: stateKey(document.uri.toString(), document.version, position.line, position.character),
      atMemberSite: site !== undefined,
      selectedText: selected?.text,
      // A selection carrying more than the member name is a SNIPPET:
      // rust-analyzer offers `rehome_by_lod(by_lod)`, parameter names already
      // written in, where tsserver offers `.enrollTile`.
      selectionIsSnippet:
        selected === undefined ? undefined : bareMemberName(selected.text) !== memberIdentifier(selected.text),
      now: this.timing.now(),
    });
    this.syncScopeMirrors();
    const scope: SelectionScope | undefined =
      requested.scope === undefined
        ? undefined
        : { text: requested.scope.text, name: requested.scope.name, range: selected?.range };
    // On the record, because an unscoped request at a member site with the
    // widget open is otherwise indistinguishable from the product never
    // having seen the selection. (A refusal-suppressed selection that also
    // names no member reports here too; the machine folds the two drops
    // together and the diagnostic names the one a reader can verify.)
    if (scope === undefined && selected !== undefined && site !== undefined && !namesAMember(selected.text)) {
      this.output.appendLine(
        `[fim] no scope: the widget selection ${JSON.stringify(selected.text)} names no member`,
      );
    }
    // A member site with the widget genuinely OPEN is the only moment a
    // rust-analyzer nudge is worth making, and it is also the only proof
    // available that rust-analyzer is running at all. Fired here rather than at
    // activation for both reasons.
    //
    // Two independent nudges hang off this hook, each settling per workspace and
    // only on a reply. Once answered the cost is a memento read; where the
    // setting is already right nothing is recorded - deliberately, because
    // recording it is how one project's settings.json silenced the nudge
    // everywhere - so that case re-reads configuration per site. A callback
    // rather than a direct call because the provider holds no ExtensionContext
    // and should not grow one for a notification.
    if (site !== undefined && context.selectedCompletionInfo !== undefined) {
      this.onWidgetMemberSite?.(document.languageId);
    }
    // What every layer downstream treats as the already-typed member. With a
    // scope in force that is the WIDGET's member, not the user's keystrokes, or
    // the gate judges `en` while the prompt says `enrollTile`.
    const memberPartial = scope ? scope.name : site?.partial;
    // The scope the request goes out under, on the record. Nothing downstream
    // said a scope had been computed, so a report of "I arrowed and got no
    // ghost" could not distinguish the selection never arriving from the
    // selection arriving and the ghost being refused later. Fires only while a
    // widget selection is in force, so it costs one line per arrow rather than
    // one per keystroke.
    if (scope !== undefined) {
      this.output.appendLine(
        `[fim] scoped to ${scope.name} (widget ${context.selectedCompletionInfo === undefined ? "closed, sticky" : "open"},` +
          ` typed ${JSON.stringify(site?.partial ?? "")}, range ${scope.range === undefined ? "cursor" : "widget"})`,
      );
    }
    // The selection reaches the model, the gate AND the cache key through one
    // channel: the prefix the model is asked to continue. A side-channel
    // request field (how `memberSite`/`memberPartial` travel) leaves the key
    // blind to the selection, so arrowing down to member 3 and back up to
    // member 1 would recompute member 1 instead of hitting. Rewriting the
    // prefix is also the honest statement of the request - the language server
    // has already decided the name, and the model's job is what follows it.
    let genPrefix =
      scope && site ? prefix.slice(0, prefix.length - site.partial.length) + scope.name : prefix;
    // A WHOLE-BLOCK site (cursor in an empty fn body over a
    // cross-file/crate signature) is a SEPARATE branch — only when it is NOT a
    // member site. Injects the types-in-play struct graph + root methods so a
    // full-block completion uses REAL names. Rides the same 50ms race + cache.
    // Each language brings its OWN site detector through the registry (rust
    // scans fn headers, TS parses the declaration shape); a language without
    // one keeps the whole-block gesture dark.
    const detectWholeBlock = wholeBlockSiteFor(document.languageId);
    const wbSite = site || detectWholeBlock === undefined ? undefined : detectWholeBlock(prefix);
    // The THIRD site kind: the cursor sits past `==`/`!=` on a member access, so
    // what the human types next is a VALUE of that member's type. A member site
    // wins: at `t.Band == LodBand.` the human is completing a member and the
    // member leg already answers, and the whole-block site cannot coexist with
    // it (that one needs an empty body, this one needs an expression). The
    // detector is a regex over the cursor's line and runs ahead of the debounce,
    // so the keystroke path pays nothing until the site actually fires.
    const detectEnumRhs = site || wbSite ? undefined : enumRhsSiteFor(document.languageId);
    const enumSite = detectEnumRhs === undefined ? undefined : detectEnumRhs(prefix);

    let resolveInjection: (() => Promise<string | FimInjection | undefined>) | undefined;
    if (site && extractor) {
      // The candidate block narrows on the SAME partial the prompt and the gate
      // work from, so a scoped request injects the selected member's signature
      // rather than every sibling sharing the typed prefix.
      const injectPartial = scope ? scope.name : site.partial;
      resolveInjection = async (): Promise<FimInjection | undefined> => {
        const startedAt = Date.now();
        // WHY a member site injected nothing, in every language, once per
        // distinct site. The channel used to carry `memberSite=true
        // injected=false` and nothing more, which cannot tell a file that does
        // not parse from a receiver with no members from a resolver that was
        // late — the ambiguity cost a user an afternoon on a capture whose C#
        // did not compile.
        //
        // This is a LOG, not evidence. What an empty member set PROVES stays as
        // narrow as it was: the enforcement gate below still refuses to arm on
        // an empty set, and nothing here widens any claim about index
        // signatures.
        const darkKey = `${document.uri.toString()}:${position.line}:${position.character}`;
        const reportDark = (reason: string): void => {
          const { firstSeen, sessionCount } = recordDarkSite(this.darkSites, darkKey, reason);
          if (firstSeen) {
            // Where, then why. The receiver and the language are what a reader
            // needs to reproduce the site; the reason is what they cannot work
            // out from the buffer.
            this.output.appendLine(
              `[fim] member site dark at ${JSON.stringify(`${memberReceiverName(prefix) ?? "?"}.`)}` +
                ` (${document.languageId}, session dark sites=${sessionCount})`,
            );
            this.output.appendLine(`[fim] member site dark because: ${reason}`);
          }
        };
        // Lateness is reported from the OUTCOME, not from a timer. This
        // resolution keeps running after the service has abandoned the block, so
        // what the site actually got out of it is known only once it answers,
        // and a timer that fires at the deadline brands a receiver dark before
        // anyone can tell. With C# warm p95 at 47ms against a 50ms deadline that
        // misfire is routine, and it used to cost the site its one reason line.
        const lateBy = (grace: number): boolean =>
          Date.now() - startedAt > INJECTION_DEADLINE_MS + grace;
        const DEADLINE_REASON = "the resolver did not answer inside the injection deadline";
        const resolvedMembers = await extractor.completeMembers({
          uri: document.uri.toString(),
          line: position.line,
          character: position.character,
        });
        // The editor's word-based fallback items are not a member surface. A
        // non-zero item count is NOT proof a language server is running, and
        // reading one as liveness is what made "your file does not parse" read
        // as "this receiver has no members".
        //
        // fillMissingSignatures merges the chain-surface cache into the set: a
        // member the resolve cap starved of its signature (Roslyn parks the
        // LINQ verbs at the provider order's tail — measure-chains.md) gets
        // the warm's cached one and renders exactly like a natively-signatured
        // member. Fill never renames, drops, reorders, or overrides a resolved
        // signature, so the enforcement set and the gate are byte-identical
        // with or without it; languages with an empty namespace pass through
        // untouched.
        //
        // The namespace is per RECEIVER TYPE (triage-p3 finding 1), derived
        // once here at zero round trips from the site's own natively-resolved
        // head signatures (csReceiverType, majority declaring type): a warm at
        // a List<Tile> receiver absorbs receiver-SUBSTITUTED signatures, and
        // serving those at a List<Stripe> site put a Tile predicate in the
        // block (78 of 79 fills wrong at the measured second receiver). An
        // underivable type (tie, or nothing resolved) means no fill and no
        // warm — a dark site, never a guessed namespace. The same string is
        // the fill namespace, the absorb namespace carried into the warm
        // closure, and the warm's dedup key. Accepted edge, on the record:
        // two user types sharing a spelled name collapse to one key.
        const semantic = semanticMembers(resolvedMembers);
        const receiverType = document.languageId === "csharp" ? csReceiverType(semantic) : undefined;
        const chainNamespace =
          document.languageId === "csharp"
            ? receiverType === undefined
              ? undefined
              : `csharp\0${receiverType}`
            : document.languageId;
        const members =
          chainNamespace === undefined
            ? semantic
            : fillMissingSignatures(semantic, this.chainCache, chainNamespace);
        // The warm itself: C# only, fire-and-forget, off the deadline path.
        // Triggered by starvation evidence at THIS site (a semantic member
        // still signatureless after the fill), so fully-resolved receivers
        // never spend the background round. DELIBERATELY not scoped to chain
        // receivers (triage-p3 finding 6): the starvation class is general,
        // and under type namespacing a StringBuilder warm filling StringBuilder
        // sites is the feature, not a leak — one serialized background warm
        // per starved type per session.
        if (
          document.languageId === "csharp" &&
          chainNamespace !== undefined &&
          members.some((m) => m.kind !== "text" && m.signature === undefined)
        ) {
          void this.warmChainSurface(
            extractor,
            document,
            { uri: document.uri.toString(), line: position.line, character: position.character },
            chainNamespace,
          );
        }
        if (members.length === 0) {
          reportDark(
            resolvedMembers.length === 0
              ? "the receiver resolved to no members"
              : "the server returned only the editor's word-based fallback items, nothing semantic",
          );
          if (lateBy(0)) {
            reportDark(DEADLINE_REASON);
          }
        }
        // Who highlighted the widget's row is unanswerable after the fact: the
        // clone() capture survived three eliminations (server ranking, our own
        // ghost steering the selector, recentlyUsed memory) with no suspect
        // left. So a scoped request puts the widget's claim and the head of the
        // product's own resolved surface on the record together, and the next
        // mystery highlight is attributed at capture time. Logged here, not at
        // the scope point, because this is where the names are actually in
        // hand; the member name ties it to the same request's `scoped to`
        // line (which stays the ONLY line spelled `scoped to` - one scope, one
        // scope line). Costs nothing new: the members were resolved for
        // injection anyway, and a dark site logs its own reason above instead.
        // This closure outlives cancellation, so the line can print during a
        // later request's window; the member name is the attribution.
        if (scope !== undefined && members.length > 0) {
          // The selection's raw sortText, when the scoped member is in our
          // resolved surface: the clone() preselect mystery took three
          // eliminations because the server's own ranking verdict was
          // invisible; now the next mystery arrives with its answer attached.
          // A member the blanket table dropped never reaches this surface, so
          // its line carries no sortText — the drop itself is the answer there.
          const selectedSortText = members.find((m) => m.name === scope.name)?.sortText;
          this.output.appendLine(
            `[fim] scope surface for ${scope.name}: widget shows ${JSON.stringify(scope.text)}` +
              `${selectedSortText === undefined ? "" : ` sortText=${selectedSortText}`},` +
              ` our heads ${members.slice(0, 5).map((m) => m.name).join(", ")}`,
          );
        }
        // The enforcement set gates on POSITIVE evidence only, and only for
        // languages whose server returns the receiver's COMPLETE member set at
        // a `.` site: TS (members only, nothing else), C# (Roslyn's full set,
        // with keyword/snippet/text dropped by the kind mapper), Python
        // (pyright's full set, dunders filtered), and Go (gopls's full set
        // once the two-rule filter drops postfix snippets and deep
        // completions — the completeness the v23 scout proved and the -live
        // canary re-proves per gopls version). For those, a NON-EMPTY list
        // is the whole legal surface and travels even when no block renders
        // (no signatures, too-wide). An EMPTY list never gates: empty
        // conflates any/untyped receivers (where plain FIM keeps working) and
        // index-signature types (Record, process.env) whose legal keys no
        // list can enumerate - suppressing on absence of evidence was the
        // footgun. Rust joins the same five since v59: rust-analyzer serves
        // keyword and postfix completions (`await`, postfix `match`) at a `.`
        // site BY DESIGN, which is why gating on the RENDERED list ate
        // `.await` and switched Rust off. The answer is two lists, not one -
        // memberSiteLegalNames carries the keyword/postfix surface the render
        // filter drops, so the legal list is complete while the prompt stays
        // callable-only. The block still carries only the TOP-N resolved
        // SIGNATURES (completionItem/resolve caps at MEMBER_RESOLVE_CAP=32,
        // ~10ms each - the tail degrades to name+kind and is dropped from the
        // signature block); the enforcement set travels on NAMES alone, which
        // every member always carries. column80.fimMemberGate is the shared
        // kill switch: Rust joins it, it does not get a second one.
        const gateOn =
          (TS_LANGUAGE_IDS.has(document.languageId) ||
            document.languageId === "csharp" ||
            document.languageId === "python" ||
            document.languageId === "go" ||
            document.languageId === "rust") &&
          members.length > 0 &&
          vscode.workspace.getConfiguration("column80").get<boolean>("fimMemberGate", true);
        // The receiver's members and the enforcement set are in hand HERE, and
        // must reach the service whatever the argument-type leg does: losing
        // them to a slow parameter-type resolve silently switches the gate off,
        // which shows the user a hallucination injection was meant to catch.
        const resolved = (block?: string): FimInjection =>
          gateOn ? { block, memberNames: memberSiteLegalNames(members, resolvedMembers) } : { block };

        const lineComment = lineCommentFor(document.languageId);
        // Render BEFORE resolving argument types. A receiver set that renders
        // nothing (no signatures, or too wide to be a real member site) yields
        // a block that is thrown away, and every round trip spent enriching it
        // is budget taken from a completion that will not use it.
        const receiverOnly = renderFimCandidates(members, injectPartial, lineComment);
        if (receiverOnly === undefined) {
          if (members.length > 0) {
            reportDark(
              members.some((m) => m.signature !== undefined)
                ? "the members that carried a signature rendered no block"
                : "members came back but not one carried a signature",
            );
            if (lateBy(0)) {
              reportDark(DEADLINE_REASON);
            }
          }
          return resolved(undefined);
        }
        // A block rendered, so the receiver is not dark: it is late. Late still
        // buys the site something wherever the enforcement gate is armed, since
        // the gate waits past the block's deadline for exactly this answer - so
        // that site is never reported. Where nothing can arm (a language
        // outside the gated five, or the kill switch off) a late answer buys
        // this keystroke nothing at all, and past a grace of one more deadline
        // the site says so, once.
        if (!gateOn && lateBy(INJECTION_DEADLINE_MS)) {
          reportDark(DEADLINE_REASON);
        }
        // The receiver's member NAMES were already right; the arity of the types
        // those members TAKE was not, because a parameter type is never a
        // receiver and so is never resolved. That surface is the phase's win but
        // it is best-effort: give it only what is LEFT of the injection window
        // and fall back to the receiver-only block when it does not land.
        // The usage leg, v29 item 2. It runs AFTER the member surface has
        // rendered and against what is LEFT of the window, because a references
        // call is not a bounded cost (p90 12ms, worst case 7.9s over distinct
        // symbols on a warm rust-analyzer) and a leg that loses this race must
        // cost the signature block nothing.
        //
        // It fires only where the DOCUMENT already spells the member, which is
        // the population `measure-p3.md` measured: a reference query needs the
        // symbol to be in the file, and at the arrowed-with-a-partial state the
        // member name exists only in the widget and in the prompt. Putting it in
        // the buffer to ask a question is a document write, and this product has
        // exactly two of those.
        let usageBlock: string | undefined;
        if (usageOn && injectPartial !== "" && site.partial === injectPartial) {
          const usage = await resolveUsageInBudget(
            extractor,
            {
              uri: document.uri.toString(),
              line: position.line,
              // The last character of the member the human has typed. A cursor
              // one past the name is past the token, and the server answers
              // about nothing.
              character: Math.max(0, position.character - 1),
            },
            injectPartial,
            lineComment,
            (uri) => this.readDocumentLines(uri),
            INJECTION_DEADLINE_MS - (Date.now() - startedAt) - ARG_TYPE_DEADLINE_MARGIN_MS,
          );
          usageBlock = usage.block;
          // On the record either way. A block the human can see in the prompt
          // dump but not on the channel is a block they cannot audit, and the
          // v22 verdict on usage injection was conditional on it being visible.
          this.output.appendLine(
            usage.block === undefined
              ? `[fim] usage dark for ${injectPartial}: ${usage.reason} (refs=${usage.references} ms=${usage.ms})`
              : `[fim] usage injected for ${injectPartial}: windows=${usage.windows}` +
                ` of ${usage.references} references, ms=${usage.ms}`,
          );
        }
        const withUsage = (block: string): string =>
          usageBlock === undefined ? block : `${block}\n${usageBlock}`;
        const argTypes = await resolveArgTypesInBudget(
          extractor,
          { uri: document.uri.toString(), languageId: document.languageId, text: document.getText() },
          narrowToPartial(members, injectPartial),
          INJECTION_DEADLINE_MS - (Date.now() - startedAt) - ARG_TYPE_DEADLINE_MARGIN_MS,
        );
        if (argTypes.length === 0) {
          return resolved(withUsage(receiverOnly));
        }
        // Usage sits BELOW the signatures, nearest the cursor. Measured: above
        // and below split 4 to 3 on type-wrong continuations and 33 to 31 on
        // call shape, both inside the noise floor, so the tie goes to the
        // placement that also opened the call at 40 of 40 against 39.
        return resolved(
          withUsage(renderFimCandidates(members, injectPartial, lineComment, argTypes) ?? receiverOnly),
        );
      };
    } else if (wbSite && extractor) {
      resolveInjection = () => this.resolveWholeBlock(document, extractor, wbSite.types);
    } else if (enumSite && extractor) {
      resolveInjection = () => this.resolveEnumRhs(document, extractor, prefix, position, enumSite);
    }

    const intent = this.takeIntent(document.uri.toString(), position.line);
    // A dictated request on a BLANK line gets the block's indent virtually: the prompt ends
    // with it, so the model continues at the right column instead of inventing one at column
    // 0, and the served item carries it into the document. What Enter would have given, without
    // writing whitespace before the model has answered.
    let virtualIndent = "";
    if (intent !== undefined) {
      const lineText = document.lineAt(position.line).text;
      if (lineText.trim() === "") {
        const want = blockIndentFor(document, position.line);
        const have = /^[ \t]*/.exec(lineText)?.[0] ?? "";
        if (want.length > have.length && want.startsWith(have)) {
          virtualIndent = want.slice(have.length);
          genPrefix = genPrefix + virtualIndent;
          this.output.appendLine(`[dictate] virtual indent of ${virtualIndent.length} for the request`);
        }
      }
    }
    if (intent !== undefined && extractor !== undefined) {
      // The dictated request resolves its spoken types first, then whatever the
      // site's own leg says, and the service puts the comment under both. Not
      // a whole-block site? The dictated roots are still resolved: the ruling
      // gives the resolver the comment as a second key, and a mid-body cursor
      // is the common dictation site.
      const base = resolveInjection;
      const roots = [...intent.roots, ...(wbSite?.types ?? [])].filter((t, i, all) => all.indexOf(t) === i);
      resolveInjection = async () => {
        const [dictated, own] = await Promise.all([
          roots.length > 0 ? this.resolveWholeBlock(document, extractor, roots, { forIntent: true }) : Promise.resolve(undefined),
          base !== undefined && !wbSite ? base().catch(() => undefined) : Promise.resolve(undefined),
        ]);
        const ownInjection = typeof own === "string" ? { block: own } : own;
        const block = [dictated, ownInjection?.block].filter((b): b is string => typeof b === "string" && b !== "").join("\n");
        if (block === "" && ownInjection === undefined) {
          return undefined;
        }
        return { ...(ownInjection ?? {}), block: block === "" ? undefined : block };
      };
    }
    let intentSettled = false;
    const settleIntent = (ghost: boolean) => {
      if (intent !== undefined && !intentSettled) {
        intentSettled = true;
        intent.onServed(ghost);
      }
    };
    try {
      const manual =
        context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke && !providerTriggered && intent === undefined;
      const result = await this.getService().complete(
        {
          prefix: genPrefix,
          suffix,
          uri: document.uri.toString(),
          manual,
          alternatives: manual
            ? vscode.workspace.getConfiguration("column80").get<number>("fimAlternatives", 3)
            : undefined,
          resolveInjection,
          intent: intent?.comment,
          memberSite: !!site,
          // Told WHETHER OR NOT the resolver answers, the same discipline
          // `memberSite` follows. The service pairs it with `resolveInjection`
          // to decide the bound's exemption; the pairing stays core-side, where
          // a headless oracle can drive it.
          wholeBlockSite: !!wbSite,
          // The enum-RHS leg is the one whose injection is OPTIONAL: it fires at
          // every `x.Y == ` and most left sides are not enum-typed, so "nothing
          // to say" is its ordinary answer rather than a resolver failing. The
          // service's cache rule needs that told to it or those sites re-generate
          // forever.
          optionalInjection: !!enumSite,
          // And the SITE itself, which is a different claim from the one above
          // even though the same leg sets both today. The service's value gate
          // reads this one: at a site where the block landed, the left side is
          // proven enum-typed, and a ghost opening a quoted string there cannot
          // compile. Told whether or not the resolver answers, so the gate's
          // arming condition stays the service's to decide.
          enumRhsSite: !!enumSite,
          // The bound's statement and construct rules are per-language.
          languageId: document.languageId,
          // Thread the provider's already-computed partial so the
          // output gate needs no second prefix parse and uses the SAME
          // language-aware detector the provider matched.
          memberPartial,
          // And the receiver the site hangs off, so the gate reaches every
          // `receiver.NAME` in a multi-line ghost rather than its first line.
          memberReceiver: site ? memberReceiverName(prefix) : undefined,
          // The scoped prompt ends with the member name, so the ghost starts at
          // the arguments. The gate has to be told what it is arguments TO.
          scopedCallee: scope?.name,
        },
        controller.signal,
      );
      if (token.isCancellationRequested) {
        settleIntent(false);
        return this.noGhost("the editor cancelled this request");
      }
      if (!result) {
        settleIntent(false);
        // A completed request that put nothing on screen is a serve of zero
        // items, and the machine has to hear about it: a scoped generation
        // whose every line postprocessed to empty is exactly the state whose
        // revert clock and context key used to starve (capture invocation 3).
        this.applyServe(0, selected !== undefined, requested.requestId);
        // The service already said WHY on its own channel; this line is what
        // ties that reason to an invocation the user made, so the two read as
        // one event rather than as an orphan.
        return this.noGhost("the service returned nothing (reason above)");
      }
      // The headless pipeline keeps sub-line tails like a lone `;` (they are
      // the completion finishing the statement). When such a tail re-types
      // characters already after the cursor, extend the replace range over
      // them so accepting leaves each character in the buffer exactly once.
      // Single-line only: a multi-line completion's tail sits on a later
      // line, so consuming cursor-line characters for it would delete text
      // the completion never re-types.
      const restOfLine = document.getText(new vscode.Range(position, document.lineAt(position.line).range.end));
      // Where the item starts and what it carries ahead of the model's own
      // output. Three shapes:
      //
      //  - The widget is OPEN: it owns the range, and the item's text must
      //    extend the widget's text. VS Code silently drops an item failing
      //    either, so an unshaped item is an invisible completion. Both are
      //    COPIED, never derived: the widget's range covers the separator in
      //    one measured language-and-state pair and is empty at the cursor in
      //    three others, so anything reasoning about its shape is wrong
      //    somewhere. See docs/architecture/vscode-layer.md.
      //  - The widget is DISMISSED and the scope is sticky: anchored at the
      //    cursor as ever, except the member name is not in the buffer, so the
      //    ghost carries the part of it the user has not typed. When the
      //    selected member does not extend what IS typed the anchor reaches
      //    back over those characters, because no cursor-anchored insert can
      //    express replacing them.
      //  - No scope: unchanged.
      const typed = site?.partial ?? "";
      const widgetRange = scope?.range;
      const backtrack =
        scope === undefined || widgetRange !== undefined || scope.name.startsWith(typed) ? 0 : typed.length;
      const anchor = backtrack === 0 ? position : position.translate(0, -backtrack);
      const prelude =
        scope === undefined ? "" : widgetRange ? scope.text : scope.name.slice(typed.length - backtrack);
      // The cursor's whole line, and the column the member name starts at in it.
      // Both are needed to read what an item LANDS rather than to argue about
      // it: `prefix` runs to the cursor, `restOfLine` from it, and the typed
      // partial begins immediately after the separator. Floored against the
      // item's own range start because a scoped-and-open item MAY respell the
      // separator itself and then begins ahead of the buffer's copy of it. The
      // `min` decides that per item rather than per language, which is what
      // keeps it right for a widget range that covers the separator and for one
      // that is empty at the cursor.
      const lineText = prefix.slice(prefix.lastIndexOf("\n") + 1) + restOfLine;
      const nameFloor = position.character - typed.length;
      // One item per completion text, each with ITS OWN overlap range and
      // post-accept span: alternates differ in length, so sharing the
      // primary's range would leave duplicated or deleted characters when a
      // cycled-to suggestion is accepted. The editor cycles a returned list
      // natively (Alt+] / Alt+[).
      // A widget selection that carries more than the member name is a SNIPPET:
      // rust-analyzer offers `rehome_by_lod(by_lod)`, parameter names already
      // written in, where tsserver offers `.enrollTile`. VS Code requires our
      // item to start with that text verbatim, so everything we generate would
      // land after an argument list the server has already closed, composing
      // `rehome_by_lod(by_lod)(1, 2)`.
      //
      // There is no augmenting item to build here, and the widget's own preview
      // is already the call shape. Serve nothing while it is open and let the
      // sticky path fill the real arguments once it is dismissed, which is the
      // gesture anyway: arrow, Escape, Tab.
      const widgetCarriesSnippet =
        scope !== undefined && widgetRange !== undefined && bareMemberName(scope.text) !== scope.name;
      const toItem = (generated: string): vscode.InlineCompletionItem | undefined => {
        if (widgetCarriesSnippet) {
          this.output.appendLine(
            `[fim] no ghost while the widget is open: ${JSON.stringify(scope?.text)} is a snippet,` +
              ` not a bare name; scope held for ${scope?.name}`,
          );
          return undefined;
        }
        // A scoped composition would otherwise spell the member name twice: the
        // provider renders it as the prelude and the ghost opens by repeating
        // it. Consume the repeat so the name is spelled once, but SAY SO - the
        // strip is the difference between a plausible ghost and evidence, and a
        // dogfood session needs the evidence.
        const { lead, echoed } = scope === undefined ? NO_ECHO : echoedNameRun(scope.name, generated);
        if (echoed !== "") {
          this.output.appendLine(
            `[fim] scoped ghost re-wrote ${echoed} of ${scope?.name}; consumed ${JSON.stringify(lead + echoed)}`,
          );
        }
        const text = prelude + generated.slice(lead.length + echoed.length);
        // The widget's range is matched EXACTLY. Extending it over re-typed
        // trailing characters, as the cursor-anchored path does, would fail
        // VS Code's range check and lose the item.
        const overlap =
          widgetRange !== undefined || text.includes("\n") ? 0 : trailingOverlapLength(text, restOfLine);
        const range = widgetRange ?? new vscode.Range(anchor, position.translate(0, overlap));
        // A scoped item may name ONLY the member the widget picked. The check
        // sits here because every serve path - exact hit, walked hit, fresh
        // generation, alternate - funnels through this one construction, and
        // because the composition that has to be caught is invisible upstream:
        // the model returns `Tally(a, b)` under a scope of `enrollTile`, the
        // gate composes a real sibling out of the two and blesses it, and
        // VS Code's augmentation rule passes `.enrollTileTally` because it does
        // extend `.enrollTile`. Nothing but the landed string can tell them
        // apart, and naming a member the user did not select is worse than
        // showing nothing, because it looks authoritative.
        if (scope !== undefined) {
          const landedLine =
            lineText.slice(0, range.start.character) + text + lineText.slice(range.end.character);
          const floor = Math.min(nameFloor, range.start.character);
          const willLand = landedMemberName(landedLine, floor);
          if (willLand !== scope.name) {
            this.output.appendLine(
              `[fim] dropped: item would land ${willLand}, widget selected ${scope.name}`,
            );
            return undefined;
          }
          // Backstop to the echo strip, and it is load-bearing rather than
          // defensive. `landedMemberName` reads the FIRST name it finds, so it
          // reads `enrollTile` off `s.enrollTile.enrollTile(tile)` and off
          // `s..enrollTile(a)` and passes both. The name being right is exactly
          // what makes those lines dangerous: corrupt, and authoritative
          // looking.
          //
          // Two residues are checked, because the strip recognises a shape and
          // an unrecognised variant of that shape is what gets through.
          //
          // A separator at the floor is one. The floor is the character after
          // the buffer's own separator, EXCEPT when the item respells the
          // separator itself and its range starts on it - then exactly one
          // belongs there. Which case applies is known here rather than guessed:
          // it is whether the item's range opens ahead of the name's column.
          //
          // The name spelled twice is the other, and it is where the accepted
          // cost lives. `s.next.next` is a re-spelling the prelude manufactured
          // AND an ordinary linked-list walk, and nothing in the text separates
          // them, so refusing the shape refuses some correct code too. That is
          // deliberate: `echoedNameRun` documents why the alternative is worse,
          // and a silent `s.next = null;` where the user meant `s.next.next`
          // assigns to the wrong object while looking entirely reasonable. A
          // lost serve is recoverable by typing; a plausible wrong line is not.
          //
          // The tail guard is `ID_Continue`, not `\b`. `\b` is ASCII in a
          // non-`u` RegExp, so it would miss every name this repo's own
          // `IDENTIFIER_RUN` is built to handle - `café`, `日本` - which are
          // exactly the names already sitting in the test fixtures.
          const respellsSeparator = range.start.character < nameFloor;
          const run = separatorRunAt(landedLine.slice(floor));
          const separatorOk = respellsSeparator
            ? run.separators === "." || run.separators === "::" || run.separators === "?."
            : run.separators === "";
          const afterName = landedLine.slice(floor + run.length + willLand.length);
          // The separator class here is the shared one, so `?.` counts. It did
          // not until round 2, and the gap was not academic: at a buffer of
          // `s?.` the `.` spelling of a re-spelling was refused while the `?.`
          // spelling landed `s?.enrollTile?.enrollTile(t);`. Both spellings are
          // ordinary at an optional-chaining site, and `genPrefix` ends the
          // model's prompt at `s?.enrollTile`, so `?.` is the separator sitting
          // in front of the model's own last token.
          //
          // The lead is measured over masked text for the same reason the strip
          // measures it that way: `. /*c*/ enrollTile(t);` is the same residue
          // as `. enrollTile(t);` and a bare `\s*` saw only the second.
          const tail = separatorRunTolerant(afterName);
          const spelledTwice =
            tail.separators !== "" &&
            new RegExp(`^${escapeForRegExp(willLand)}(?![\\p{ID_Continue}$])`, "u").test(
              afterName.slice(tail.length),
            );
          if (!separatorOk || spelledTwice) {
            this.output.appendLine(
              `[fim] dropped: item would land ${JSON.stringify(landedLine.slice(floor).slice(0, 40))}` +
                ` - ${spelledTwice ? `${scope.name} spelled twice` : `a ${JSON.stringify(run)} separator run`}`,
            );
            return undefined;
          }
        }
        const item = new vscode.InlineCompletionItem(text, range);
        // Post-accept compiler oracle: VS Code runs an item's command exactly
        // when the completion is accepted, which is the FIM trigger the
        // surface contracts. The handler gates by language and never blocks
        // the accept; the landed span is [start, start + text length] because
        // any overlap characters are replaced by the completion's own bytes.
        item.command = {
          // A dictated ghost's accept runs through its own command, which
          // forwards to the post-accept check and then tells the gesture.
          command: intent === undefined ? "column80.fimAccepted" : "column80.dictationAccepted",
          title: "Column 80: post-accept compiler check",
          arguments: [
            document.uri.toString(),
            document.offsetAt(range.start),
            text.length,
            // Where the caret goes after a declaration lands: the body line, not the closer.
            ...(caretOffsetInItem === undefined || text !== primary ? [] : [document.offsetAt(range.start) + caretOffsetInItem]),
          ],
        };
        return item;
      };
      // A dictated ghost carries its own line break and the block's indent, so
      // accepting it lands the cursor on a fresh line with nothing pressed
      // (ruling: flow state is the point). It is part of the ghost text, so the
      // only writes are still the accepted ghost and that newline.
      // Only when nothing but whitespace follows the caret: on a partly written line the
      // auto-closed `)` or `"` after the caret would otherwise ride onto the fresh line (the
      // phase 4 review). There the ghost fills the rest of the line and the caret stays.
      let declaration: DeclarationGhost | undefined;
      if (intent !== undefined && intent.kind === "declaration") {
        declaration = declarationGhost(
          result.text,
          intent.sentence,
          document.languageId,
          intent.eol,
          intent.indent + virtualIndent,
          intent.unit,
        );
      }
      const primary =
        declaration !== undefined
          ? `${virtualIndent}${declaration.text}`
          : intent === undefined || restOfLine.trim() !== ""
            ? result.text
            : `${virtualIndent}${result.text}${intent.eol}${intent.indent}${virtualIndent}`;
      const caretOffsetInItem = declaration === undefined ? undefined : virtualIndent.length + declaration.caretOffset;
      const items = [primary, ...(result.alternates ?? [])]
        .map(toItem)
        .filter((item): item is vscode.InlineCompletionItem => item !== undefined);
      // The serve point, whatever the count. The machine stamps the served
      // bit, opens the passive window (a zero-items serve under a record that
      // served earlier still starts the revert clock - the served-then-dropped
      // fallback), and answers the context key: armed on scope-in-force with
      // the widget closed, ghost or no ghost, because that is the state the
      // second Escape acts on. While the widget is open, Escape belongs to
      // the widget.
      this.applyServe(items.length, selected !== undefined, requested.requestId);
      if (items.length === 0) {
        settleIntent(false);
        return this.noGhost(
          scope === undefined
            ? "every generated item was dropped (reasons above)"
            : `every generated item was dropped under the scope ${scope.name} (reasons above)`,
        );
      }
      settleIntent(true);
      return items;
    } catch (err) {
      settleIntent(false);
      if (!controller.signal.aborted) {
        this.output.appendLine(`[fim] error: ${String(err)}`);
        // A thrown request still HAPPENED to the scoped attempt: without this
        // serve the scope stays in force with no window and a stale key,
        // which is the wedge shape arriving down the error path. Aborted
        // requests stay silent - they are superseded, and the next request
        // is already in flight.
        this.applyServe(0, selected !== undefined, requested.requestId);
        return undefined;
      }
      return this.noGhost("aborted mid-request");
    }
  }

  /** Return nothing, on the record. The provider's early exits were silent, so a
   *  dogfood report of "I arrowed and no ghost appeared" had no way to separate
   *  a superseded request from a cancelled one from every item being refused by
   *  the landed-name guard. One shape (`no ghost:`) across the provider AND the
   *  service, so the whole class greps as one. */
  private noGhost(reason: string): undefined {
    this.output.appendLine(`[fim] no ghost: ${reason}`);
    return undefined;
  }

  // Serve nothing, on the record ONCE per comment line. Every keystroke inside
  // a comment reaches here, and the same line repeated per character is noise
  // that buries the events around it.
  private darkInComment(uri: string, line: number, kind: InCommentKind): undefined {
    const { firstSeen } = recordDarkSite(this.commentDarkSites, `${uri}:${line}`, kind);
    // Counted on EVERY suppressed keystroke while the line is printed once. The
    // two answer different questions: the line says which comment lines went
    // dark, the count says how many completions this rule cost, and that second
    // number is the one phase 6 prices against the corpus. So the count on the
    // first line of a comment already reads several ahead of the lines above it,
    // by design.
    //
    // The session ledger directly rather than through the service: the service
    // is rebuilt on every settings change, and this suppression runs before the
    // service is reached at all - going dark here is what makes it cost no model
    // call.
    const note = noteSuppression(sessionSuppressions, "in-comment");
    if (firstSeen) {
      this.output.appendLine(`[fim] no ghost: the cursor is inside a ${kind} comment${note}`);
    }
    return undefined;
  }

  // A language FIM does not serve, said once per language and then never again.
  // The line names the setting, because "no ghost in my .cpp" is otherwise
  // indistinguishable from the extension being broken, and the answer is one
  // settings entry away.
  // The `column80.fimLanguages` value the refusal ledger was filled under.
  // Moving the setting is the human asking the question again, so the ledger is
  // emptied and the answer is given again.
  private syncUnservedEpoch(extra: readonly string[]): void {
    const epoch = extra.join(",");
    if (epoch !== this.unservedEpoch) {
      this.unservedEpoch = epoch;
      this.unservedLanguages.clear();
    }
  }

  // A file's lines for the usage leg. VS Code's already-open documents first,
  // because the human's unsaved edits are what their call sites actually say;
  // disk otherwise. Never throws: an unreadable location costs that one window
  // and nothing else.
  private readDocumentLines(uri: string): readonly string[] | undefined {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
    if (open !== undefined) {
      return open.getText().split("\n");
    }
    try {
      const fsPath = vscode.Uri.parse(uri).fsPath;
      return readFileSync(fsPath, "utf8").split("\n");
    } catch {
      return undefined;
    }
  }

  private reportLanguageUnserved(languageId: string): undefined {
    // One line per language per SETTINGS EPOCH, not per session. The provider
    // outlives a settings change, and a human who widens to cpp and later takes
    // it away again would otherwise get nothing at all the second time: a
    // feature that stopped working with no channel line is exactly what
    // evidence discipline exists to prevent. Moving the setting is the human
    // asking the question again, so it is answered again.
    if (this.unservedLanguages.has(languageId)) {
      return undefined;
    }
    this.unservedLanguages.add(languageId);
    this.output.appendLine(
      `[fim] no ghost: languageId=${languageId} is not code Column 80 understands;` +
        ` add it to column80.fimLanguages to serve it anyway`,
    );
    return undefined;
  }

  // A language with no row in the comment table, said once and then never
  // again. Both rules simply do not run for it.
  //
  // Since v29 this can only happen in a language a human added to
  // `column80.fimLanguages`: every language served by default has a row. So the
  // line says what it costs rather than only what is missing. The owner's rule
  // has two halves ("only FIM in code" and "NEVER inside comment blocks"), and
  // this is the one state where the product serves the first and cannot promise
  // the second. Serving anyway is the deliberate choice: the human asked for
  // this language explicitly, and refusing their override because our courtesy
  // table lacks a row would be the tool managing them. The gap is loud instead.
  private reportCommentRulesDark(languageId: string): void {
    if (this.commentDarkLanguages.has(languageId)) {
      return;
    }
    this.commentDarkLanguages.add(languageId);
    this.output.appendLine(
      `[fim] comment rules dark: no comment syntax mapped for languageId=${languageId}` +
        `, so the in-comment refusal cannot run here (widened by column80.fimLanguages)`,
    );
  }


  // The serve point of the request that just completed OR failed, whatever
  // its count. Routed through the machine so the served bit, the window
  // deadline, the context key and the hand-back drop are one decision; this
  // provider's half is the real timer the deadline arms, the mirrors the sync
  // fires, and the re-render `rerender` asks for. Only a cancelled or aborted
  // request skips this: it is superseded, and the request replacing it is
  // already in flight.
  //
  // `requestId` is the machine's own attribution token, echoed back so a
  // superseded request's serve is a no-op. The drop decision lives at the
  // serve now, so mis-attribution would drop a scope the user still holds.
  private applyServe(servedCount: number, widgetOpen: boolean, requestId?: number): void {
    const now = this.timing.now();
    const name = heldScopeName(this.scope);
    const { opensWindowUntil, rerender } = scopeServe(this.scope, {
      servedCount,
      widgetOpen,
      now,
      requestId,
    });
    if (opensWindowUntil !== undefined) {
      this.armExpiry(opensWindowUntil - now);
    }
    if (rerender === true) {
      // The scoped attempt served nothing and nothing was ever on screen: the
      // machine dropped the record, and this is the active hand-back. The
      // re-render is asked for through the SAME hook the expiry uses, and it
      // is disowned the same way; loop-safe because the drop precedes the
      // trigger, so the request it provokes finds no record and a repeat
      // zero-serve has nothing left to drop.
      this.output.appendLine(
        `[fim] no ghost: the post-close attempt for ${name} served nothing; scope dropped, unscoped re-render requested`,
      );
      this.downgradeNextManual = true;
      this.syncScopeMirrors();
      this.timing.onExpired();
      return;
    }
    this.syncScopeMirrors();
  }

  /** Extension-wired: the cursor moved in `uri`. A record pins the exact
   *  position it was taken at, so a move to any other position kills it - and
   *  the timer with it, which is the whole reason this hook exists. Nothing
   *  invokes the provider on a bare cursor move, so without it the timer
   *  outlives the site and asks the editor to re-render wherever the user has
   *  navigated to. A move to the SAME position is not a move: arrowing the
   *  widget moves no cursor, and the Escape re-invocation is at the position
   *  the record was taken at. */
  onCursorMoved(uri: string, line: number, character: number): void {
    const held = heldStateKey(this.scope);
    if (held === undefined) {
      return;
    }
    // Only the record's OWN file. A selection change fires for every visible
    // editor, so keying on position alone would let a background editor's
    // cursor kill the scope in the file being typed in - which is the v19
    // defect this session exists to remove, arriving from a different
    // direction. The filter sits here because the machine's keys are opaque
    // to it; the move is re-keyed under the record's own version, which the
    // event does not carry and which a bare cursor move cannot have changed.
    const [heldUri, heldVersion] = held.split("\0");
    if (heldUri !== uri) {
      return;
    }
    scopeCursorMoved(this.scope, stateKey(uri, Number(heldVersion), line, character));
    this.syncScopeMirrors();
  }

  /** Drop whatever sticky scope is held. Returns true when there was one, so
   *  the caller can tell a real dismissal from a keybinding that fired against
   *  a scope already gone and fall back to the editor's own Escape.
   *
   *  This is the fast revert: waiting out PASSIVE_SCOPE_MS is the slow way to
   *  the generic ghost, and a second Escape is the way with the developer's
   *  finger already on the key. It applies to an ACTIVE scope too, which
   *  otherwise has no way out but typing. The refusal record and the session
   *  reset both live in the machine's onSecondEscape.
   *
   *  The re-render the caller is about to ask for is disowned here, the same
   *  way an expiry disowns its own: the developer pressed Escape, not
   *  Ctrl+Space, and neither should cost a manual fan-out. */
  dropScope(): boolean {
    const name = heldScopeName(this.scope);
    if (!scopeSecondEscape(this.scope).reached) {
      return false;
    }
    this.output.appendLine(`[fim] scope for ${name} dismissed by Escape`);
    this.syncScopeMirrors();
    this.downgradeNextManual = true;
    return true;
  }

  // Report a change in whether the second-Escape state is on. Only a change:
  // the hook drives an editor context key, and setting it per request would be
  // a command round trip per keystroke on the hot path.
  private reportScopedGhost(visible: boolean): void {
    if (visible === this.scopedGhostShown) {
      return;
    }
    this.scopedGhostShown = visible;
    this.timing.onScopedGhost?.(visible);
  }

  // Mirror the machine's decisions into the world, after every machine event:
  // the context key follows `scopedGhostKey`, and the real timer is cancelled
  // the moment the machine holds no window - an edit or a cursor move may be
  // the last thing that ever happens at a site, so neither mirror can wait
  // for the next request. The timer is only ever ARMED at a serve; this only
  // takes it down.
  private syncScopeMirrors(): void {
    if (windowDeadline(this.scope) === undefined && this.cancelExpiry !== undefined) {
      this.cancelExpiry();
      this.cancelExpiry = undefined;
    }
    this.reportScopedGhost(scopedGhostKey(this.scope));
  }

  // Arm the one-shot that closes a passive window. Armed once per window, for
  // the FULL span, on the same serve that stamps the deadline - the machine
  // opens a window at most once per record, so a second serve inside it
  // neither re-stamps nor stacks a second timer.
  //
  // Whether the fire closes anything is the machine's call, not the timer's:
  // onExpiry finds no due deadline for a window the state has since left
  // behind and asks for nothing, so a stale fire can never drop a scope the
  // user is looking at, and the request the re-render provokes finds no
  // passive record, arms nothing, and cannot loop.
  private armExpiry(delayMs: number): void {
    this.cancelExpiry?.();
    this.cancelExpiry = this.timing.setTimer(delayMs, () => {
      this.cancelExpiry = undefined;
      const name = heldScopeName(this.scope);
      if (!scopeExpiry(this.scope, this.timing.now()).rerender) {
        return;
      }
      this.syncScopeMirrors();
      this.downgradeNextManual = true;
      this.output.appendLine(`[fim] passive scope for ${name} expired`);
      this.timing.onExpired();
    });
  }

  // Resolve the whole-block injection for the types in play. Runs
  // INSIDE resolveInjection (raced against the 50ms deadline in the service), so
  // a slow cross-file resolve degrades to plain FIM and never blocks a keystroke.
  // A per-file-version cache turns a warm fire into a sub-ms Map hit. For each
  // type, resolveCrossFileShape derives its fields+methods from wherever it lives;
  // the merged graph feeds renderWholeBlockInjection under the shared bound.
  private async resolveWholeBlock(
    document: vscode.TextDocument,
    extractor: SurfaceExtractor,
    types: string[],
    opts: { forIntent?: boolean } = {},
  ): Promise<string | undefined> {
    const uri = document.uri.toString();
    const version = document.version;
    // A dictated request neither reads nor fills the per-file-version cache:
    // its root list is the spoken names, not the signature's, so the entry
    // would answer a different question at the next keystroke.
    const cached = opts.forIntent ? undefined : this.injectionCache.get(uri, version);
    if (cached !== undefined) {
      return cached;
    }

    const fullText = document.getText();
    // The language's resolver hooks (TS hover parsing/rendering; Rust defaults
    // when undefined) — the whole-block payload rides the ONE resolver.
    const hooks = shapeHooksFor(document.languageId);
    // One merged graph across every type-in-play (a nested type shared by two
    // roots resolves once); each root's own methods keyed for the render's
    // ROOT-only method scope.
    const merged: CrossFileShape = { types: new Map<string, DerivedType>(), dropped: [] };
    const methodsByRoot = new Map<string, string[]>();
    for (const type of types) {
      // Same ladder as the fn-gen pre-fill (resolvePrefill): an in-span/same-file
      // anchor first, then the workspace-symbol by-name leg for a type named ONLY
      // in the doc and defined in another project (`Stripe` from Atlas). Without
      // this fallback a doc-only cross-project collaborator resolves NOTHING, so
      // FIM whole-block gets zero injection and the 1.5b hallucinates the API
      // (goal.md Defect 2: "the FIM whole-block detector consume[s] the same new
      // capability"). Only the C# transports expose it; absent means no fallback.
      let anchor = findTypeAnchor(type, document, fullText);
      if (!anchor && extractor.resolveTypeCursorByName) {
        try {
          anchor = (await extractor.resolveTypeCursorByName(type)) ?? undefined;
        } catch {
          anchor = undefined;
        }
      }
      if (!anchor) {
        continue;
      }
      let shape: CrossFileShape | undefined;
      try {
        shape = await resolveCrossFileShape(extractor, anchor, CROSS_FILE_BOUND, openDocumentText, hooks);
      } catch {
        shape = undefined;
      }
      if (!shape) {
        continue;
      }
      for (const [name, derived] of shape.types) {
        if (!merged.types.has(name)) {
          merged.types.set(name, derived);
        }
      }
      const root = shape.types.get(type);
      methodsByRoot.set(type, root ? root.methods : []);
    }

    const resolveStruct = toResolveStruct(merged, hooks);
    // The Go defs the block is about to carry are elided hovers: gopls appends
    // its own `// size=...` layout chrome and gopls hands back every field's doc
    // paragraph. `cobra.Command` is 8363 bytes of hover for 1944 bytes of field
    // lines. The bytes are named here rather than cut in silence, and the line
    // says which CLASSES went, because a reader auditing this channel has to be
    // able to tell an elision from a truncation.
    if (document.languageId === "go") {
      for (const derived of merged.types.values()) {
        const elision = goElideDef(derived.signature);
        if (elision.beforeBytes !== elision.afterBytes) {
          this.output.appendLine(`[fim] whole-block: ${goElisionLogLine(derived.name, elision)}`);
        }
      }
    }
    const methodsOf = (t: string): string[] => methodsByRoot.get(t) ?? [];
    // The ENUMS the roots reach. The def walk cannot emit them: it follows FIELD
    // edges, and a C# hover has no field body at all, so a type reached through a
    // member's TYPE (`Band : LodBand`) never appears however well the resolver
    // resolved it. Its def line would say nothing typeable anyway - `enum
    // Atlas.LodBand` names no variant.
    //
    // Captured live: at this exact site the block disclosed `Band : LodBand` and
    // the 1.5b, unable to name a variant, invented `tile.IsRegional()`. The
    // variants were sitting in `merged` the whole time.
    //
    // Enums only, deliberately. A closed set is small, complete, and the one
    // thing a caller can write about the type; opening this to every reached
    // class would put a second type's whole member list in a block that is
    // already the widest thing FIM injects.
    const reachedEnums = [...merged.types.values()]
      .filter((t) => /\benum\b/.test(t.signature) && t.methods.length > 0)
      .map((t) => ({ type: t.name, lines: t.methods }));
    if (reachedEnums.length > 0) {
      this.output.appendLine(
        `[fim] whole-block: ${reachedEnums.map((e) => `${e.type} (${e.lines.length} values)`).join(", ")} reached through a member's type`,
      );
    }
    const block = renderWholeBlockInjection(
      types,
      resolveStruct,
      methodsOf,
      DATASHAPE_BOUNDS,
      (opts.forIntent ? DICTATION_SURFACE_TOK : DATASHAPE_TOTAL_TOK) * 4,
      lineCommentFor(document.languageId),
      reachedEnums,
    );
    if (block !== undefined) {
      // A dictated resolve never fills the per-file-version cache (the phase 4 review found it
      // did, and the next plain keystroke was answered with the spoken roots).
      if (!opts.forIntent) {
        this.injectionCache.set(uri, version, block);
      }
    }
    return block;
  }

  // Resolve the enum-RHS injection: the variants of the type on the LEFT of the
  // comparison the cursor sits past. Runs INSIDE resolveInjection, so it rides
  // the same 50ms race the whole-block leg does and a slow answer degrades to
  // plain FIM rather than holding a keystroke.
  //
  // The ladder, each rung degrading to dark rather than guessing: hover the
  // member token for its declared TYPE, anchor that type by reference or by
  // name (the whole-block leg's own two-rung anchor, with the reference rung's
  // answer checked for being a type at all), take its shape through the one
  // cross-file resolver, render the variants only where the hover says `enum`,
  // and spell them the way this buffer can compile them. Nothing here guesses a
  // variant - every line traces to a resolution of a real definition, which is
  // the resolver's own contract.
  private async resolveEnumRhs(
    document: vscode.TextDocument,
    extractor: SurfaceExtractor,
    prefix: string,
    position: vscode.Position,
    site: EnumRhsSite,
  ): Promise<string | undefined> {
    const uri = document.uri.toString();
    const version = document.version;
    // WHY the site fired, and where, once per resolution rather than once per
    // keystroke: this runs after the debounce, on a keystroke that will
    // actually generate. A site that says nothing is the defect the member leg
    // spent a session's captures learning, so every exit below has a line.
    const dark = (reason: string): undefined => {
      this.output.appendLine(`[fim] enum-rhs dark at ${JSON.stringify(site.member)}: ${reason}`);
      return undefined;
    };
    this.output.appendLine(
      `[fim] enum-rhs site at ${JSON.stringify(`${site.member} ==`)} (${document.languageId})`,
    );

    // Keyed on the SITE, not the file: the block answers "what are this member's
    // values", and two members of the same file at the same version have
    // different answers. The whole-block leg can key on (uri, version) alone
    // because its answer is the file's own signature; this one cannot, so the
    // member token and its offset ride the key. Same cache instance, so an edit
    // still evicts through the one `retainOnly` the extension already wires.
    const cacheKey = `${uri}\0enum-rhs:${site.member}@${site.offset}`;
    const cached = this.injectionCache.get(cacheKey, version);
    if (cached !== undefined) {
      return cached;
    }

    const readMemberType = memberTypeNameFor(document.languageId);
    if (readMemberType === undefined) {
      return dark("this language has no hover reader for a member's declared type");
    }
    const readTypeSpelling = typeSpellingFor(document.languageId);
    if (readTypeSpelling === undefined) {
      return dark("this language has no reader for how a type must be spelled here");
    }
    // The member token's own cursor. The detector hands back an offset into the
    // prefix precisely so this needs no second parse of the buffer.
    const lineStart = prefix.lastIndexOf("\n", Math.max(0, site.offset - 1)) + 1;
    const newlines = prefix.slice(site.offset).split("\n").length - 1;
    const memberCursor: SourceCursor = {
      uri,
      line: position.line - newlines,
      character: site.offset - lineStart,
    };
    let hover: HoverSurface | undefined;
    try {
      hover = await extractor.hoverSurface(memberCursor);
    } catch {
      hover = undefined;
    }
    const typeName = readMemberType(hover?.signature);
    if (typeName === undefined) {
      return dark("the hover named no declared type for the member");
    }
    // A primitive or a library container is not an enum worth two more round
    // trips, and refusing it HERE is what keeps `t.MortonCode == ` off the
    // resolver. C# primitives are keyword-spelled and lower case, so the
    // PascalCase test covers them; the language's own std stop-set - the one
    // registry every other type scan in the product reads - covers the rest.
    if (!/^[A-Z]/.test(typeName) || argTypeStopRulesFor(document.languageId).std.has(typeName)) {
      return dark(`the member's type \`${typeName}\` is not a user type`);
    }

    // ONE type, no edges. The whole-block bound walks a graph because a
    // signature's types collaborate; an enum is a closed set that collaborates
    // with nothing, so a walk past it would spend the deadline resolving types
    // the block will never carry. D_MAX 0 stops every edge at the root.
    const shapeAt = async (cursor: SourceCursor): Promise<DerivedType | undefined> => {
      let shape: CrossFileShape | undefined;
      try {
        shape = await resolveCrossFileShape(
          extractor,
          cursor,
          { D_MAX: 0, N_MAX: 1 },
          openDocumentText,
          shapeHooksFor(document.languageId),
        );
      } catch {
        shape = undefined;
      }
      return shape?.types.get(typeName);
    };

    // The same two-rung anchor ladder the whole-block leg uses: a real reference
    // in this file first, then the by-name workspace-symbol leg for a type
    // defined in another project.
    //
    // The first rung is a GUESS, and it has to be checked. `findTypeAnchor`
    // takes the first non-comment occurrence of the bare word, and C# idiom
    // names a property after its enum type (`public DataOrigin DataOrigin { get;
    // set; }`), so at the sites this leg was built for the word's first
    // occurrence is the PROPERTY. What comes back is then a member hover rather
    // than a type, and the leg used to go dark holding it - the by-name rung
    // never ran, because an anchor WAS found. So the answer is read for what it
    // is: a hover that declares no type is a missed anchor, not an answer, and
    // the second rung gets its turn. The read costs no round trip, it is the
    // hover the walk already took at the definition.
    const documentText = document.getText();
    let derived: DerivedType | undefined;
    let anchored = false;
    // Which rung answered, on the resolved line below. A reader looking at a
    // wrong block needs to tell "this file's own reference" from "the workspace
    // symbol", because the two fail differently and the property-shadow case is
    // invisible otherwise.
    let anchoredBy = "";
    const inFile = findTypeAnchor(typeName, document, documentText);
    if (inFile) {
      anchored = true;
      anchoredBy = "this file's own reference";
      derived = await shapeAt(inFile);
      if (derived !== undefined && readTypeSpelling(derived.signature, documentText) === undefined) {
        this.output.appendLine(
          `[fim] enum-rhs: this file's own \`${typeName}\` hovers as` +
            ` ${JSON.stringify(derived.signature.trim())}, which declares no type - resolving by name instead`,
        );
        derived = undefined;
      }
    }
    if (derived === undefined && extractor.resolveTypeCursorByName) {
      // The by-name rung asks with the qualification it ALREADY HAS. A name
      // declared in two namespaces is refused by the workspace-symbol selection
      // - correctly, because a wrong variant list under a "do not invent" header
      // is worse than nothing - and on a real solution that refusal took 27 of
      // 31 enum-typed sites, every one of them holding a hover that named the
      // namespace outright (`DataModel.Enums.DataOrigin`). Handing it over is
      // not a tiebreak: the selection still refuses whenever the evidence fails
      // to leave exactly one namespace standing. The buffer rides along for the
      // case where the hover qualified nothing, which happens precisely because
      // this file imports the namespace - which is itself the answer.
      const container = memberTypeContainerFor(document.languageId)?.(hover?.signature);
      let byName: SourceCursor | undefined;
      try {
        byName = (await extractor.resolveTypeCursorByName(typeName, { container, fileText: documentText })) ?? undefined;
      } catch {
        byName = undefined;
      }
      if (byName) {
        anchored = true;
        anchoredBy = container === undefined ? "the workspace symbol" : `the workspace symbol under \`${container}\``;
        derived = await shapeAt(byName);
      }
    }
    if (!anchored) {
      return dark(`\`${typeName}\` could not be anchored to a definition`);
    }
    if (derived === undefined) {
      return dark(`\`${typeName}\` resolved to no shape`);
    }
    const kind = derived.signature.trim();
    if (kind === "") {
      return dark(`the definition of \`${typeName}\` hovered as nothing, so its kind is unknown`);
    }
    if (!/^enum\b/.test(kind)) {
      return dark(`\`${typeName}\` is not an enum`);
    }
    // How the type has to be SPELLED in the buffer the block lands in. The def
    // hover carries the fully qualified name; this file's imports and its own
    // namespace decide whether the short form reaches it, and the block renders
    // whichever one compiles here. A block that prints a name the site cannot
    // resolve, under a header forbidding anything else, is the exact failure
    // class this leg exists to close, arriving through the surface instead of
    // through its absence.
    const spelling = readTypeSpelling(kind, documentText);
    if (spelling === undefined) {
      return dark(`the definition of \`${typeName}\` hovered without a name this file can spell`);
    }
    // The variants, as the resolver's `enumMemberLine` hook spelled them
    // (`LodBand.Regional`) - the exact text the model has to write. Filtered to
    // lines that ARE spelled as a value of this type, because the header
    // promises values: a member that arrived carrying a signature is rendered as
    // one by the resolver, and listing it under that header would make the
    // header a lie. The hook composed them off the SHORT name, so the qualifier
    // is swapped onto the front rather than the name being rebuilt.
    const variants = derived.methods
      .filter((line) => line.startsWith(`${typeName}.`))
      .map((line) => spelling + line.slice(typeName.length));
    const block = renderEnumVariants(spelling, variants, lineCommentFor(document.languageId));
    if (block === undefined) {
      return dark(`\`${typeName}\` is an enum that resolved no variants`);
    }
    // The variant count is the number a reader checks against the enum's own
    // declaration. What follows it is what a reader of a WRONG ghost needs: the
    // member-name gate does not run at this site (the ghost writes a value, not
    // a member on a receiver, and that machinery is receiver-shaped), so the one
    // rule policing this output is the value gate, which refuses a quoted string
    // and judges nothing else. Naming it beats leaving a reader to infer either
    // that everything is checked or that nothing is. The spelling is named
    // whenever it is not the short one, because that is the block telling the
    // model to write something longer than the human would.
    this.output.appendLine(
      `[fim] enum-rhs resolved ${site.member} : ${typeName}, ${variants.length} variants` +
        ` (via ${anchoredBy}, string-value gate only${spelling === typeName ? "" : `, spelled ${spelling}`})`,
    );
    this.injectionCache.set(cacheKey, version, block);
    return block;
  }
}

// The text of another document, for the cross-file resolver's `openFile` seam.
// undefined when it cannot be opened, which the resolver reads as a stop edge.
async function openDocumentText(uri: string): Promise<string | undefined> {
  try {
    return (await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))).getText();
  } catch {
    return undefined;
  }
}

// Where the in-comment scan starts reading: far enough back to answer the
// question, and no further. Walks LINES rather than converting an offset, and
// measures each line by the END of its own range rather than by its text,
// because `lineAt(n).range.end` plus `getText` is the exact document surface
// this provider already depends on. A headless caller that satisfies those two
// should not have to grow `positionAt`, or `lineAt().text`, to be asked whether
// the cursor is in a comment.
//
// The walk has no line cap on purpose. A cap would be a second bound with its
// own failure mode: a block comment opened above a run of blank lines longer
// than the cap would read as code, and generating INSIDE the developer's spec
// is the one thing this rule exists to prevent. Walking is cheap and the number
// of lines it takes to reach the bound is small in any file whose lines carry
// anything.
/** The indent the next statement on a blank line inside a block should carry: the previous
 *  non-blank line's indent, plus one unit when that line opens a block. The unit is what the
 *  file already uses (a tab, or the width of the smallest indent step seen above). */
export function blockIndentFor(document: vscode.TextDocument, line: number): string {
  let prev = line - 1;
  while (prev >= 0 && document.lineAt(prev).text.trim() === "") {
    prev--;
  }
  if (prev < 0) {
    return "";
  }
  const text = document.lineAt(prev).text;
  const indent = /^[ \t]*/.exec(text)?.[0] ?? "";
  const opens = /[{(\[:]\s*$/.test(text.replace(/\/\/.*$/, "").trimEnd());
  if (!opens) {
    return indent;
  }
  if (indent.startsWith("\t")) {
    return `${indent}\t`;
  }
  let unit = 0;
  for (let i = prev; i >= 0 && i > prev - 200; i--) {
    const w = (/^[ ]*/.exec(document.lineAt(i).text)?.[0] ?? "").length;
    if (w > 0 && (unit === 0 || w < unit)) {
      unit = w;
    }
  }
  if (unit === 0) {
    unit = document.lineAt(line).text.startsWith("\t") ? 0 : 4;
  }
  return unit === 0 ? `${indent}\t` : indent + " ".repeat(unit);
}

export function commentScanStart(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Position {
  let remaining = COMMENT_PREFIX_CHARS - position.character;
  let line = position.line;
  while (remaining > 0 && line > 0) {
    line--;
    remaining -= document.lineAt(line).range.end.character + 1;
  }
  return new vscode.Position(line, 0);
}

// A SAFE anchor cursor for a type in play: a `use` import or the first NON-COMMENT
// reference (findTypeAnchorInText) — NEVER a header-comment occurrence, where
// definition() resolves nothing, nor a shadowing same-named type. undefined
// when the type is not referenced in code.
function findTypeAnchor(
  type: string,
  document: vscode.TextDocument,
  fullText: string,
): { uri: string; line: number; character: number } | undefined {
  // Python anchors on `import`/`from ... import` lines and skips `#` comments;
  // Go on `import` lines (single or grouped block, where the package path
  // lives); every other language uses the Rust-shaped `use`-line +
  // `//`-comment anchor.
  const at =
    document.languageId === "python"
      ? pyFindTypeAnchorInText(fullText, type)
      : document.languageId === "go"
        ? goFindTypeAnchorInText(fullText, type)
        : findTypeAnchorInText(fullText, type);
  return at ? { uri: document.uri.toString(), line: at.line, character: at.character } : undefined;
}
