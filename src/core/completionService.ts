/**
 * The FIM completion pipeline: truncate, cache lookup (exact + prefix-walk),
 * debounce, single-flight gating, ollama call, postprocess. Pure of vscode;
 * the provider in src/vscode/ is a thin adapter over this.
 *
 * Debounce semantics (newest call wins, superseded calls resolve without a
 * model hit) follow continuedev/continue (Apache-2.0)
 * core/autocomplete/util/AutocompleteDebouncer.ts; overall pipeline shape
 * follows utilitydelta/human-replay-vscode-extension src/completionProvider.ts
 * with the logic lifted out of the vscode layer.
 */

import { FimConfig } from "./config";
import { FimGenerateFn, generateFim } from "./ollama";
import { escapeBreaks } from "./errorBound";
import { CompletionCache, WALK_WINDOW } from "./cache";
import { BoundOutcome, contentLines, postprocessBounded } from "./postprocess";
import { boundReached, endsOnBlockOpener, sealCut, MAX_BOUND_LINES } from "./fimBound";
import { FIM_NUM_CTX } from "./budgetProfile";
import { CommentCut, commentSyntaxFor, cutIntroducedComment } from "./fimComment";
import { echoedNameRun, FimInjection, ghostNamesMember, injectBeforeCursorLine } from "./fimInject";
import { SuppressionLedger, createSuppressionLedger, noteSuppression } from "./suppressionLedger";

// The candidate injection sits before the model on the TTFT path. Warm
// rust-analyzer answers in single-digit ms; a cold or big-workspace
// query can take seconds. Cap the wait so injection never blows the 200ms bar:
// past this, drop injection and generate plain FIM.
// Exported so a resolver can carve its own best-effort sub-budget out of the
// SAME window the race enforces, rather than keeping a second copy that drifts.
export const INJECTION_DEADLINE_MS = 50;

/** The injection race for a DICTATED request. A keystroke has a 200ms bar and
 *  the 50ms race protects it; a dictated request follows a mic close the human
 *  waited for, its bar is a second from mic close to ghost (session-v65), and
 *  the surfaces it resolves are the point of the pipeline ruling. 400ms leaves
 *  the FIM p50 (184ms) plus decode (250ms) inside the bar on the reference box. */
export const INTENT_INJECTION_DEADLINE_MS = 400;

// The gate's own bound on the SAME resolver query, and the reason it is not
// INJECTION_DEADLINE_MS: the two consumers sit at different points on the clock.
// The block goes INTO the prompt, so it must beat the model. The gate runs after
// generation RETURNS, by which time the resolver has already had the whole model
// call to finish - a dogfood capture measured ttft at 1045ms against a member
// list that would have landed at 80ms.
//
// So this is not a second attempt at the same race. It is the deadline the gate
// always needed and was borrowing from the block. It bites only when a language
// server is pathologically slow, and its job is to stop a hung one hanging the
// completion, not to shape normal behaviour. Kept under a second so that a hang
// costs less than the model call the user already waited through.
export const GATE_DEADLINE_MS = 500;

// A `.`/`::` completion is a single member access, never a block. Constrain it:
// single-line, short. This is correct on the merits (you are finishing one
// expression), and it defends two failure modes the injected comment block
// invites in a comment-heavy file - the base model continuing into fabricated
// comment lines / a whole fake function, and the longer generation widening the
// window a fast keystroke aborts it in. Deterministic, not a scope-cut heuristic.
const MEMBER_SITE_MAX_TOKENS = 64;

/**
 * JetBrains' minimum-length filter: a ghost carries at least `minChars`
 * characters, of which at least `minAlnum` are alphanumeric. Their full-line
 * completion drops single-token suggestions this way, and the reason applies
 * harder here - every ghost costs a human review, and this product has no
 * confidence score to spend instead.
 *
 * Judged on the SERVED text, so what the floor measures is what the human would
 * have seen.
 *
 * A ghost that ends on a block opener is EXEMPT, and that exemption is not a
 * refinement of the rule, it is what makes the rule's number true. The bound
 * makes a declaration head serve the rest of the signature and stop, so the
 * ghost at those sites is `) {`, `Self {`, `self):` - short, punctuation-heavy,
 * and exactly what the floor was built to refuse. The two were measured apart
 * and compose badly: over the 710 served ghosts of `verify-decl.json`, the run
 * of the pipeline that has that behaviour, the bare floor trips 17 times (2.4%)
 * and NINE of the 17 are byte-identical to the line the developer went on to
 * write (7 Go `) {`, a Rust `Self {`, a Python `self):`).
 *
 * With the exemption: 7 of 710 (1.0%, matching JetBrains' published ~1% of
 * valuable suggestions lost), and 0 of the 7 matched what the developer wrote
 * next. The whole refused population is `vec![];`, `e.code;`, `Get()`, `Get()`,
 * `);`, `false`, `+ 9 * 4`.
 *
 * `minChars <= 0` disables the floor outright, both legs, which is the switch
 * that restores pre-floor behaviour exactly. `minAlnum <= 0` disables the
 * alphanumeric leg alone, leaving the length test.
 *
 * Unicode classes rather than `\w`: `café` and `日本` are identifier text a
 * ghost really carries, and `_` is not alphanumeric in anyone's reading, which
 * is what keeps `__();` under the floor.
 */
export function belowGhostFloor(text: string, minChars: number, minAlnum: number): boolean {
  if (!(minChars > 0)) {
    return false;
  }
  if (endsOnBlockOpener(text)) {
    return false;
  }
  if (text.length < minChars) {
    return true;
  }
  return minAlnum > 0 && (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < minAlnum;
}

// A C# string literal in every spelling the language has, at the head of a
// value: plain `"x"`, verbatim `@"x"`, interpolated `$"x"`, both orders of the
// pair (`$@"` and `@$"`), the raw `"""x"""`, and the interpolated raw whose
// prefix is a run of `$` (`$$"""x"""`). Every one of them starts with a run of
// `$`/`@` followed by a double quote, and NOTHING else in C# does: `@class` is a
// verbatim identifier and `$` alone is not an expression, so requiring the quote
// after the run is what keeps those served.
//
// Leading whitespace is skipped because the model supplies its own separator
// wherever the buffer has none - the unspaced state's ghost opens ` "LodBand…`.
// The apostrophe is NOT here. A char literal cannot equal an enum either, but it
// has not been measured at this site and the bar for this gate is measured harm.
const OPENS_STRING_LITERAL = /^[\s]*[$@]*"/;

/** Whether `text`'s first value token opens a C# string literal.
 *
 *  Text-shaped on purpose: the gate that reads this runs on a ghost, which is a
 *  fragment with no parse. What it asks is answerable from the first two or
 *  three characters, and anything deeper would be judging a value rather than
 *  recognising a literal. */
function opensStringLiteral(text: string): boolean {
  return OPENS_STRING_LITERAL.test(text);
}

export interface CompletionRequest {
  /** Full document text before the cursor. The service truncates to config. */
  prefix: string;
  /** Full document text after the cursor. The service truncates to config. */
  suffix: string;
  /** Manual invocations skip the debounce. */
  manual?: boolean;
  /** The document the completion is for. Tags cache entries so an edit in a
   *  DIFFERENT document evicts them (cross-file rename staleness); absent
   *  means the entry is evicted on any foreign edit. */
  uri?: string;
  /** Total completions wanted (default 1). Honored only on MANUAL calls: the
   *  automatic path answers every keystroke under the latency bar and never
   *  pays for extras. Extras run concurrently at a floor temperature and
   *  dedupe; the editor cycles whatever survives. */
  alternatives?: number;
  /** FIM candidate injection: resolve the member-signature block for the
   *  cursor (a rust-analyzer query at a `.`/`::` site). Called once, after the
   *  debounce, only when a generation will actually happen. Returns undefined
   *  when the site is not injectable or the receiver is unresolved - degrade to
   *  plain FIM. The cache key stays the plain cursor context, so injection is a
   *  transparent generation-time enhancement. */
  resolveInjection?: () => Promise<string | FimInjection | undefined>;
  /** The cursor is at a `.`/`::` member site (set by the provider whether or not
   *  injection resolves). The completion is a single member access, so generate
   *  it single-line and short - see MEMBER_SITE_MAX_TOKENS. */
  memberSite?: boolean;
  /** The already-typed member name at the site (the provider's `site.partial`),
   *  threaded so the output gate needs no second parse of the prefix — and so the
   *  gate uses the SAME language-aware detector the provider matched (Python's
   *  `pyMemberSite` diverges from the shared `fimMemberSite` at `::`/`#`). Absent
   *  when not a member site. */
  memberPartial?: string;
  /** The receiver identifier the site's `.`/`::` hangs off, threaded from the
   *  provider for the same reason as `memberPartial`: the prefix is parsed once,
   *  where it is already being parsed. It lets the output gate recognise a
   *  `receiver.NAME` access further down a multi-line ghost instead of judging
   *  the leading identifier alone. Absent when the receiver is not a plain
   *  identifier, which degrades the gate to that leading identifier. */
  memberReceiver?: string;
  /** The document's languageId. The bound's statement terminator and
   *  construct-opener rules are per-language, and the service is where the
   *  bound is applied. Absent takes the C-family rules. */
  languageId?: string;
  /** The cursor is at a whole-block site (an empty body whose signature names a
   *  user type), set by the provider WHETHER OR NOT the resolver answers - the
   *  same discipline `memberSite` already follows. Exempts the site from the
   *  plain-continuation bound, but only where a resolver is also wired. */
  wholeBlockSite?: boolean;
  /** The site's injection is OPTIONAL: the leg asked a question whose honest
   *  answer is usually "nothing here", and got it. The enum-RHS leg fires at
   *  every `x.Y == ` and most left sides are not enum-typed, 112 of 143 real
   *  fires; the member leg is the opposite, an unanswered `.` means a resolver
   *  that could not answer.
   *
   *  Read by the cache rule below and nowhere else. Without it a leg that is
   *  DESIGNED to say nothing at most of its sites looks identical to a cold
   *  language server, so every `t.Owner == ` re-generates on every identical
   *  keystroke forever and the channel prints a degradation that did not
   *  happen. */
  optionalInjection?: boolean;
  /** A dictated intent: the heard sentence as a comment block, spliced closest
   *  to the cursor under whatever surface the site's resolver injects. Rides
   *  exactly ONE request (session-v65 ruling 3: each press is its own comment).
   *  An intent request skips the debounce (a human pressed a key and waited),
   *  is never served from the cache and never fills it (the same position
   *  without the comment is a different question), and keys the in-flight
   *  registry on the comment too, so a plain keystroke in flight at the same
   *  cursor is superseded rather than joined. */
  intent?: string;
  /** The cursor is at an enum-RHS site: the prefix ends in `==`/`!=` and the
   *  left side is a member access, so what follows is a VALUE of that member's
   *  type. Set by the provider whether or not the resolver answers, the same
   *  discipline `memberSite` and `wholeBlockSite` follow.
   *
   *  NOT the same claim as `optionalInjection`, which happens to be set at the
   *  same sites today. That one says "an empty answer here is honest, bank it";
   *  this one says "this position holds a value in a comparison". A later leg
   *  whose injection is optional at a site that is not a comparison would set
   *  the first and not the second, and reading one for the other would gate its
   *  output on a rule about enums.
   *
   *  Read by the enum-RHS value gate below, and only in combination with a
   *  LANDED injection: the site fires at every `x.Y == ` and most left sides are
   *  not enums, so the site alone proves nothing about the type. The block
   *  rendering is the proof, because the resolver renders it only where the
   *  definition hovered as `enum`. */
  enumRhsSite?: boolean;
  /** The member name the provider will RENDER ahead of the ghost, set only when
   *  the suggest widget's selection scoped the request. Such a request asks the
   *  model to continue a prefix that already ends in the member name, so the
   *  ghost opens at the argument list and carries no callee - and the arity leg
   *  needs a callee to look a signature up by. Without this a scoped
   *  `(a, b, c, d, e)` against a one-argument signature is served where the
   *  unscoped `enrollTile(a, b, c, d, e)` is suppressed.
   *
   *  Deliberately NOT set on unscoped requests, where `memberPartial` is also
   *  identifier text standing ahead of the ghost. Composing it there would
   *  widen what the arity leg judges across ordinary typing-through, which is a
   *  separate decision from restoring parity here. */
  scopedCallee?: string;
}

export interface CompletionResult {
  text: string;
  fromCache: boolean;
  /** Undefined on cache hits: no model call happened. */
  ttftMs?: number;
  totalMs?: number;
  /** Distinct extra completions, manual trigger only (request.alternatives).
   *  The editor renders them as cycle targets; order is sample order. */
  alternates?: string[];
}

// Extras sample at a floor temperature: at the user's configured temperature
// (often near 0) every extra would greedily decode the primary again, and a
// deduped singleton defeats the gesture. The primary keeps the configured
// temperature - alternates trade determinism for spread by design.
//
// A SPREAD rather than one floor, measured on the extras ladder at a 0.01
// primary: 0.7/0.7 puts best-of-3 11.6pp ahead of the primary, 0.9/1.1 puts it
// 16.3pp ahead with the primary unchanged. Raising the primary itself to 0.7
// costs it 11.6pp, which is why only this ladder moves. The first item is what
// the user Tabs and it stays cold.
//
// Past the end of the ladder the last rung repeats, so a caller asking for more
// alternatives than there are rungs gets the hottest one rather than undefined.
const ALTERNATE_TEMPERATURES = [0.9, 1.1];

export type LogFn = (line: string) => void;

// One generation, shaped into what the request might serve, plus the three
// facts a later filter or the evidence line needs about it. The extras launch
// before the primary is awaited, so any of them can become the served ghost and
// every one of these has to travel with its own text rather than be read off
// the primary.
interface Candidate {
  text: string;
  /** What the bound decided for THIS generation. Absent at an exempt site. */
  bound?: BoundOutcome;
  /** The comment cut shortened this candidate. The floor is not stacked on the
   *  remainder; see the floor's call site. */
  trimmed: boolean;
  /** The bound's `stopWhen` ended this candidate's read rather than the model
   *  running out. */
  stopped: boolean;
}

interface Inflight {
  key: string;
  controller: AbortController;
  promise: Promise<CompletionResult | undefined>;
}

const SEP = "\u0000";

export class CompletionService {
  private readonly cache: CompletionCache;
  // Documents whose resolver came back with nothing to police with, last time
  // it was asked. See the walk-refusal predicate in complete() for why the
  // outcome has to reach the read through a memo rather than directly.
  private readonly darkResolvers = new Set<string>();
  private pendingDebounceCancel: (() => void) | undefined;
  private inflight: Inflight | undefined;
  private disposed = false;

  // Injected generate fn so headless tests observe call counts and latency
  // without a live server; default is the real client.
  constructor(
    private readonly config: FimConfig,
    private readonly generate: FimGenerateFn = generateFim,
    private readonly log?: LogFn,
    // Where this service's suppressions are counted. Injected rather than
    // reached for: the extension builds a FRESH service on every settings
    // change, so the session outlives any one instance and extension.ts hands
    // in the session's ledger (the same one the provider's in-comment
    // suppression writes to). A service constructed with nothing counts its own
    // events, which is what a headless caller means by a session.
    private readonly suppressions: SuppressionLedger = createSuppressionLedger(),
  ) {
    // Keys windowed to prefixChars: identity is the model's input window,
    // and neither entry size nor lookup cost may scale with document size.
    this.cache = new CompletionCache(config.cacheCapacity, config.prefixChars);
  }

  /** Return nothing, on the record. Every silent `return undefined` on this path
   *  is a keystroke the user watched produce no ghost with no way to tell a
   *  superseded request from a cancelled one from a dead model, and a dogfood
   *  report that says "I arrowed and got nothing" is undiagnosable without it.
   *  One shape (`no ghost:`) so the whole class greps as one.
   *
   *  THE ESCAPE LIVES HERE, not at the callers, because this is the choke point
   *  the shape is named for. Most reasons are constants this file authored and
   *  the escape is the identity on them; ONE is not - the abort-after-failure
   *  branch interpolates the transport's thrown message, whose tail is the
   *  server's own 500 body. Unescaped, that body writes its own `[fim]`-tagged
   *  channel row (scrap S58-2, found by driving a real socket at this file
   *  rather than by reading it: the goal for that work named the two
   *  `request failed` sites and not this one). A future caller that interpolates
   *  something server-controlled is covered without having to know. */
  private noGhost(reason: string): undefined {
    this.log?.(`[fim] no ghost: ${escapeBreaks(reason)}`);
    return undefined;
  }

  async complete(
    request: CompletionRequest,
    signal?: AbortSignal,
  ): Promise<CompletionResult | undefined> {
    if (this.disposed || signal?.aborted) {
      return this.noGhost(this.disposed ? "the service is disposed" : "cancelled before it started");
    }

    // slice(-0) would return the whole string, not the empty window.
    const prefix = this.config.prefixChars > 0 ? request.prefix.slice(-this.config.prefixChars) : "";
    // unroot: V8 slices are views that keep the whole source string alive, so
    // a cached key sliced from a 2MB document would retain the 2MB document.
    const suffix = unroot(request.suffix.slice(0, this.config.suffixChars));
    const key = prefix + SEP + suffix + (request.intent ? SEP + request.intent : "");

    // The cache sees a bounded slice: the truncation window plus the walk
    // margin, so walk candidates can reconstruct the key of the state
    // before each typed character without any document-sized work.
    const cachePrefix = unroot(
      this.config.prefixChars > 0 ? request.prefix.slice(-(this.config.prefixChars + WALK_WINDOW)) : "",
    );

    // Plain FIM continues what the human is typing; it never authors a body.
    // Two sites are exempt, and both halves of the test are load-bearing.
    //
    // Decided from the REQUEST, before the model call and before anything the
    // resolver does. Keying it on the injection having RESOLVED would clamp
    // every whole-block site whose resolver misses the 50ms race, so a cold
    // rust-analyzer would silently delete the deliberate multi-line behaviour
    // v22 measured at 8/8 method recall. That is a correctness bound.
    //
    // And a site that can never inject - no extractor for the language,
    // compiler-directed injection switched off - keeps no licence to author.
    // `resolveInjection` present is the service-side test for that: the
    // provider supplies it only where an extractor exists.
    const bounded = !request.memberSite && !(request.wholeBlockSite && request.resolveInjection);
    // The RAW cursor line, not `scopeAnchor`'s. scopeAnchor substitutes the
    // indentation of a line above when the cursor line is blank, which is right
    // for indentation scoping and wrong for a statement-balance rule that asks
    // what brackets the cursor's OWN line left open.
    const boundCtx = bounded
      ? {
          languageId: request.languageId ?? "",
          currentLinePrefix: prefix.slice(prefix.lastIndexOf("\n") + 1),
        }
      : undefined;

    // The ghost never introduces a comment, at exactly the sites the bound
    // governs. `bounded` is the same test, and that is not a coincidence: the
    // rule and the bound both say plain FIM continues rather than authors, and
    // the two exempt sites are exempt from this for their own reasons.
    //
    // A whole-block site with a resolver wired is licensed to write a BODY, a
    // real body carries comments in it, and a "led" cut is a TRUNCATION - a
    // comment on line 3 of a six-line body deletes lines 3 to 8. That is the
    // exempt site losing its multi-line output, which is a bar of its own.
    //
    // A member site already has its own answer to a comment in the ghost, and
    // it is the opposite one. v19 measured `/*x*/enrollTile(tile)` under a
    // widget scope and decided it is REPAIRED and served: the echo strip
    // consumes the lead so the name is spelled once, and the landed-name guard
    // refuses `. /*c*/ enrollTile(t);` outright as an ambiguous repeat. Cutting
    // the comment first turns the first into nothing and the second into a bare
    // `.` the guard then blesses. Two rules deciding one string in opposite
    // directions is worse than either, and the measured population here is the
    // PLAIN one anyway (5 comment-led lines and 10 trailing comments out of
    // 749). A member ghost is also one expression, forced single-line and
    // name-gated, which is where its comment exposure was already spent.
    const commentSyntax = bounded ? commentSyntaxFor(request.languageId ?? "") : undefined;

    const alternativeCount = request.manual ? Math.max(1, request.alternatives ?? 1) : 1;

    // Before the debounce: typing through a suggestion must not stutter. A
    // manual multi-suggestion call bypasses the read: one cached text cannot
    // cycle, and the explicit gesture asked for fresh options.
    // Refuse the walk only where regenerating can actually be policed. Three
    // conditions, and each one is a configuration where an earlier version of
    // this predicate cost model calls for nothing.
    //
    // At a member site, because that is the site the gate exists for. But
    // `memberSiteFor` classifies `.`/`::` for EVERY language while the provider
    // supplies a resolver only where an extractor does, so being at a member
    // site is not sufficient: in Go, Java and C++, and in every language once
    // `compilerDirectedInjection` is off, nothing can police either path.
    //
    // And not when the resolver last came back empty for this document. The
    // read happens before the resolver is raced (below), so presence is all this
    // line can test unaided; a memo of the last outcome is how the outcome
    // reaches a line that runs ahead of it. Without it the refusal compounds
    // with the store rule into a loop that never converges: refuse the walk,
    // generate, decline to cache because the resolver degraded, then refuse the
    // walk again on the next keystroke. Measured at 7.53x model calls over 400
    // real statements against a cold resolver, where a warm one costs 2.02x and
    // converges after a single call.
    //
    // The memo is refreshed only when the resolver is consulted, and that only
    // happens on a generation - so while it is suppressing the refusal, the walk
    // keeps serving, nothing generates, and it does not refresh. It clears at
    // the next cache MISS: median 14 keystrokes, p90 40. Not one.
    //
    // That window is a cost property rather than a correctness one. A dark
    // resolver supplies no member names, so the gate does not run on the freshly
    // generated ghost either; the defect this refusal exists to close is the
    // ASYMMETRY between a ghost suppressed cold and served warm, and there is no
    // suppression on the cold path here to be asymmetric with. The window is
    // that many keystrokes of base-commit behaviour, which is the floor. Paying
    // to regenerate through it was measured at 4.2x the model calls for
    // identically unpoliced output.
    //
    // What makes refusing worth anything where it does fire: regenerating
    // issues a FRESH resolver query and gets the real member surface back, which
    // is new evidence. That is the whole asymmetry, and it is why the no-resolver
    // branch above is excluded - there, the walk fires only when what the user
    // typed is a prefix of the cached completion, so a regeneration is asked to
    // continue text the model itself wrote with nothing new to go on. Measured
    // in that branch against the author's real source line, 83% of regenerations
    // came back byte-identical to the walked remainder.
    const policeable =
      !!request.memberSite && !!request.resolveInjection && !this.darkResolvers.has(request.uri ?? "");
    const hit = alternativeCount > 1 || request.intent ? undefined : this.cache.lookup(cachePrefix, suffix, policeable);
    if (hit !== undefined) {
      // A hit is served WITHOUT the bound, deliberately. The bound is applied
      // where a ghost is authored, so every stored entry was already bounded or
      // already exempt at the position that minted it. The one case worth
      // naming: the prefix walk can serve the remainder of an exempt
      // whole-block ghost at a position that is no longer a whole-block site.
      // That remainder is text the user is actively typing through and has
      // already seen; re-clamping it per keystroke would break typing-through
      // at exactly the site the exemption exists to protect. Nothing flows the
      // other way that matters - a bounded entry served at an exempt site is
      // just a shorter ghost than that site was entitled to.
      //
      // The length floor and the comment cut are skipped here too, and for the
      // same reason rather than by oversight: a walked remainder is the tail of
      // a ghost the human is typing through and has already read, so the floor's
      // "a three-character ghost costs a full human review" does not apply - the
      // review happened at the position that minted it. A walked hit therefore
      // serves a one-character `;` by design. The consequence to keep on the
      // record is a measurement one: the floor's fire rate in `cost-v25.cjs` is
      // measured over generations only, so a real session's rate is unknown.
      // The authoring site's state, on the line. A cached ghost is served with
      // no model call and no injection query, so without this the channel shows
      // an effect whose cause happened at some earlier cursor position and left
      // no record - the whole dogfood session that found this defect had to
      // infer causality from string lengths.
      const p = hit.provenance;
      this.log?.(
        `[fim] cache hit len=${hit.completion.length} walked=${hit.walked}` +
          ` memberSite=${p.memberSite} injected=${p.injected} gated=${p.gated}`,
      );
      return { text: hit.completion, fromCache: true };
    }

    // Newest call wins: any cache-miss call supersedes an older pending wait,
    // whose complete() resolves undefined without reaching the model.
    this.pendingDebounceCancel?.();
    if (!request.manual && !request.intent && this.config.debounceMs > 0) {
      const survived = await this.debounceWait(this.config.debounceMs, signal);
      if (!survived || this.disposed || signal?.aborted) {
        // The common one, and the one a dogfood report needs named: a newer
        // keystroke arrived inside the debounce and this request was dropped for
        // it. Indistinguishable from a dead model without the line.
        return this.noGhost(
          !survived ? "superseded by a newer request during the debounce" : "cancelled during the debounce",
        );
      }
    }

    if (this.inflight) {
      if (this.inflight.key === key) {
        // Join: the caller gets the initiator's result object as-is, but its
        // own signal still means cancellation for it alone — the initiator's
        // request keeps running.
        //
        // Join asymmetry, on record: an automatic keystroke joining a manual
        // fan-out inherits its alternates (it can render a cycle list), while
        // a manual fan-out joining an inflight single-shot degrades to one
        // suggestion - the inflight key ignores alternativeCount. Both are
        // single-frame windows; neither is worth a keyed re-fan.
        return joinWithSignal(this.inflight.promise, signal);
      }
      this.inflight.controller.abort();
    }

    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort);

    const promise = (async (): Promise<CompletionResult | undefined> => {
      try {
        // Resolve the candidate injection only now, on the surviving keystroke:
        // one rust-analyzer query per generation, never per pre-debounce
        // keystroke. BOUNDED: the query sits before the model on the TTFT path,
        // so a cold or slow rust-analyzer must not blow the 200ms bar - race it
        // against a deadline and fall back to plain FIM. Degrades on any failure.
        let genPrefix = prefix;
        let injectionMs = 0;
        let injected = false;
        let injectedBlock: string | undefined;
        let memberNames: readonly string[] | undefined;
        // Kept past the injection deadline so the gate can await the same query
        // the block gave up on. Undefined when no resolver was supplied.
        let pendingInjection: Promise<FimInjection | undefined> | undefined;
        // What the gate's own wait cost, kept separate from the injection race's
        // cost so the reported latency accounts for both.
        let gateWaitMs = 0;
        if (request.resolveInjection) {
          const started = Date.now();
          // ONE query, two consumers. The promise is kept rather than raced
          // away: Promise.race does not cancel the loser, so a resolver that
          // misses the block's deadline is still running and still going to
          // answer, and throwing that answer on the floor is what left the gate
          // absent at the site that most needed it.
          // Normalised here so both consumers read the same shape; a bare string
          // is back-compat for a block with no enforcement set.
          pendingInjection = request.resolveInjection()
            .then((r) => (typeof r === "string" ? { block: r } : r))
            .catch(() => undefined);
          const deadlineMs = request.intent ? INTENT_INJECTION_DEADLINE_MS : INJECTION_DEADLINE_MS;
          const raced = await raceDeadline(pendingInjection, deadlineMs, controller.signal);
          const injection = raced.value;
          injectionMs = Date.now() - started;
          if (injection && !controller.signal.aborted) {
            memberNames = injection.memberNames;
            if (injection.block) {
              genPrefix = injectBeforeCursorLine(prefix, injection.block);
              injected = true;
              injectedBlock = injection.block;
              this.log?.(
                `[fim] injected candidates lines=${injection.block.split("\n").length - 1} ms=${injectionMs}`,
              );
            }
            // The race outcome, not a re-read of the clock: a resolver that
            // answered `undefined` in 2ms has not been skipped for slowness, and
            // an elapsed time that rounds to just under the deadline does not
            // mean the deadline was met.
          } else if (raced.timedOut) {
            this.log?.(`[fim] injection skipped: resolver slower than ${deadlineMs}ms`);
          }
        }
        // The dictated intent goes in LAST, closest to the cursor, under any
        // surface the site's own leg resolved: the scout measured the comment as
        // the engine (124 to 166 of 360 first lines) and the surfaces as flat on
        // top of it, and the pipeline ruling keeps both, in this order.
        if (request.intent) {
          const block = injectedBlock ? `${injectedBlock}\n${request.intent}` : request.intent;
          genPrefix = injectBeforeCursorLine(prefix, block);
          injected = true;
          injectedBlock = block;
          this.log?.(
            `[fim] intent injected lines=${request.intent.split("\n").length}` +
              ` under surface lines=${block.length === request.intent.length ? 0 : block.split("\n").length - request.intent.split("\n").length}`,
          );
        }
        // The full FIM context, verbatim, when the debug setting is on — the FIM
        // analog of the fn-gen prompt dump. Shows exactly what surface FIM was (or
        // was NOT) given and the prefix/suffix window the base model sees, so a
        // wrong ghost can be traced to a missing/incomplete injection vs the model.
        if (this.config.logPrompts) {
          this.log?.(
            `[fim] prompt-begin memberSite=${!!request.memberSite} injected=${injected}\n` +
              `--- injected surface ---\n${injectedBlock ?? "(none)"}\n` +
              `--- prefix (model input before cursor) ---\n${genPrefix}\n` +
              `--- suffix ---\n${suffix}\n[fim] prompt-end`,
          );
        }
        // A member site completes one expression: cap the tokens and force
        // single-line, so the injected comment block cannot run the base model
        // on into a fabricated block.
        const maxTokens = request.memberSite
          ? Math.min(this.config.maxTokens, MEMBER_SITE_MAX_TOKENS)
          : this.config.maxTokens;
        // No setting behind this any more: scope of authorship is a product
        // decision, and `column80.multiline` said "Allow multi-line
        // completions" while the bound decided it. The flag stays as an
        // internal parameter because the member-site path and the exemption
        // both need to say what they want.
        const multiline = !request.memberSite;
        // A multi-line ghost at an exempt site is the feature working, and
        // without a line saying so it reads as the bound failing.
        if (!bounded && request.wholeBlockSite) {
          this.log?.("[fim] bound exempt: whole-block site with a resolver wired");
        }
        const genParams = {
          apiBase: this.config.apiBase,
          model: this.config.model,
          prefix: genPrefix,
          suffix,
          maxTokens,
          temperature: this.config.temperature,
          signal: controller.signal,
          // Pinned on every request; see FIM_NUM_CTX for why not only the dictated ones.
          numCtx: FIM_NUM_CTX,
          // The transport's own evidence sink, for the RAW server body on an
          // HTTP failure. One object serves the primary AND the alternates, so
          // a manual call whose runs all fail writes one raw-body line per run
          // - the accepted cost of wiring the sink at all (see the field's own
          // note on FimGenerateParams).
          log: this.log,
          // Spread-when-bounded, so an exempt or member call carries no
          // `stopWhen` key at all and its stream loop is the one it always was.
          // The stop ends the READ, which releases the connection and stops
          // ollama generating: that release is the latency win (p50 300ms to
          // 141ms), not the shorter string.
          ...(boundCtx ? { stopWhen: (t: string) => boundReached(t, boundCtx) } : {}),
        };
        // Extras launch BEFORE the primary is awaited so all runs share the
        // wall clock. A failed extra degrades to one fewer option; only the
        // primary's failure fails the call.
        const extraRuns = Array.from({ length: alternativeCount - 1 }, (_, i) =>
          this.generate({
            ...genParams,
            temperature: Math.max(
              this.config.temperature,
              ALTERNATE_TEMPERATURES[Math.min(i, ALTERNATE_TEMPERATURES.length - 1)],
            ),
          }).catch(() => undefined),
        );
        const result = await this.generate(genParams).catch((err) => {
          // The primary's failure fails the whole call, so settle the extras
          // too: without the abort they keep generating for a result nobody
          // returns (dogfood: orphaned runs burning a warm server slot).
          // Abort on an already-aborted controller is a no-op, so a
          // cancelled call is unchanged. Log here: after the abort, the
          // outer catch reads the signal as cancellation and stays silent.
          if (!controller.signal.aborted) {
            // Escaped: the tail of the transport's throw is the server's own
            // body, and `OutputChannel.appendLine` renders one row per line
            // break. See the sibling site in the outer catch below.
            this.log?.(`[fim] request failed: ${escapeBreaks(String(err))}`);
            controller.abort();
          }
          throw err;
        });
        const extras = await Promise.all(extraRuns);
        if (controller.signal.aborted) {
          return this.noGhost("cancelled while the alternates were generating");
        }
        const ppCtx = {
          suffix,
          currentLinePrefix: scopeAnchor(prefix),
          multiline,
          injectedBlock,
          ...(boundCtx ? { bound: boundCtx } : {}),
        };
        // Both suppressions on this path are recorded rather than logged as
        // they fire, and the reason is one the extras path made unavoidable:
        // the extras launch BEFORE the primary is awaited, so a request whose
        // primary is refused can promote an alternate and serve. Neither rule
        // knows at the moment it fires whether the human ends up with nothing,
        // and `dropped:` on this channel means the human got nothing.
        //
        // The kind of the FIRST cut, which is what the channel names. A request
        // that cuts four candidates cut a comment once as far as the keystroke
        // is concerned.
        let commentCut: CommentCut = "none";
        // One entry per candidate the safety rule refused, saying which. An
        // alternate's refusal used to be silent, because the alternates ran
        // through `postprocess`, which discards `BoundOutcome`.
        const unsafeRefusals: string[] = [];
        // Rule 1, applied after the bound and re-sealed. The bound removes 92%
        // of the population by itself (174 of 189 comment introductions sit
        // past line 1); this is the 15 that survive it, and Python carries most
        // of them. The seal runs again because a trailing cut can leave the
        // very tail the safety rule exists to refuse - `foo(a, // note` cuts to
        // `foo(a,` - and `sealCut` is idempotent, so where nothing moved it
        // costs nothing. No seal where there is no bound context: a member site
        // has never had the safety rule applied to it and this is not the
        // change that gives it one.
        const cutComment = (t: string): { text: string; trimmed: boolean } => {
          if (commentSyntax === undefined || t === "") {
            return { text: t, trimmed: false };
          }
          const { text: kept, cut } = cutIntroducedComment(t, commentSyntax);
          if (cut === "none") {
            return { text: t, trimmed: false };
          }
          if (commentCut === "none") {
            commentCut = cut;
          }
          return { text: boundCtx ? sealCut(kept, boundCtx).text.trimEnd() : kept, trimmed: true };
        };
        // A candidate and the two facts about it a later filter needs: which
        // bound decided it (so the evidence line describes the generation the
        // human actually saw, not the primary's) and whether the comment cut
        // shortened it (so the floor is not stacked on the cut's remainder).
        const shape = (gen: { text: string; stopped?: boolean }, which: string): Candidate => {
          // A dictated request is an instruction, and the model likes to open its answer with a
          // placeholder comment ("// Write your code here") before the code. The comment rule
          // would cut the whole ghost there; for an intent the leading comment lines go and the
          // code is kept, which is the rule's intent (no comment introduced) without the loss.
          let raw = gen.text;
          if (request.intent && commentSyntax !== undefined) {
            const stripped = stripLeadingCommentLines(raw, commentSyntax.line);
            if (stripped !== raw) {
              this.log?.(`[fim] intent: leading comment line(s) stripped before the bound (${which})`);
              raw = stripped;
            }
          }
          const pp = postprocessBounded(raw, ppCtx);
          if (pp.bound?.refusedUnsafe) {
            unsafeRefusals.push(which);
          }
          const cut = cutComment(pp.text);
          return { text: cut.text, bound: pp.bound, trimmed: cut.trimmed, stopped: !!gen.stopped };
        };
        const primary = shape(result, "the primary");
        let text = primary.text;
        // The candidate the served text came from. It starts as the primary and
        // follows the promotion below, because a promoted alternate came from a
        // different generation: the primary's `bound=empty dropped=1` beside a
        // served 19-character ghost describes a generation nobody saw. `kept=`
        // was already recomputed from the served text for exactly this reason;
        // the other three fields were not.
        let servedFrom = primary;
        const seen = new Set([text]);
        const alternates: Candidate[] = [];
        for (const extra of extras) {
          if (!extra) {
            continue;
          }
          // Alternates get the rules too: any of them can be promoted into the
          // served ghost when the primary comes back empty.
          const alt = shape(extra, "an alternate");
          if (alt.text !== "" && !seen.has(alt.text)) {
            seen.add(alt.text);
            alternates.push(alt);
          }
        }
        // The member-site output gate: with the receiver's real members
        // resolved, a ghost naming an invented identifier is dropped rather
        // than shown - the injected header's "use one of these exact names"
        // enforced at the seam we own. No resolution (race lost, extractor
        // dark) means no gate: we know nothing, so we suppress nothing.
        // Hoisted out of the branch because the cache entry records whether the
        // gate ran, not just whether it dropped anything: that is what a later
        // read needs to know about the site this ghost came from.
        // The gate's turn to ask. Generation is over, so the resolver has had
        // the whole model call to finish - in the capture that motivated this,
        // 1045ms against a member list that would have landed at 80ms. If it
        // lost the block's race but has answered since, its names are here and
        // free; if it is still running, this is the first and only time anyone
        // waits on it, under a bound that is the gate's own.
        //
        // Nothing here can change the prompt: that was fixed before generation
        // started. This only decides whether the OUTPUT gets policed.
        //
        // Member sites only, and that is a correctness bound rather than an
        // optimisation. Member names have exactly two consumers, the gate below
        // and the memo, and both are member-site-only; anywhere else the awaited
        // value is read by nobody and the wait is pure latency on a keystroke.
        // The whole-block resolver that fires at non-member sites returns a
        // block, which cannot arm anything after generation has already run.
        if (
          pendingInjection &&
          request.memberSite &&
          memberNames === undefined &&
          !controller.signal.aborted
        ) {
          const waitStarted = Date.now();
          const late = (await raceDeadline(pendingInjection, GATE_DEADLINE_MS, controller.signal)).value;
          gateWaitMs = Date.now() - waitStarted;
          if (late && !controller.signal.aborted) {
            memberNames = late.memberNames;
            if (memberNames !== undefined) {
              this.log?.(`[fim] gate armed by a resolver that missed the injection deadline`);
            }
          }
        }
        // This wait is the one place the service can be cancelled AFTER a ghost
        // exists, and the abort has to end the call rather than only disarm the
        // gate. The guard above already refuses to arm `memberNames` from a
        // cancelled request - without this, that refusal was the bug: the gate
        // went absent while nothing stopped the ungated ghost being returned, so
        // an abort landing inside this window served exactly the invented member
        // the phase exists to suppress.
        if (controller.signal.aborted) {
          return this.noGhost("cancelled after generating, before the gate could run");
        }
        // The memo records what the resolver PRODUCED, so it has to be written
        // from the awaited outcome rather than the raced one. Written here for
        // that reason: at the race the answer above was not yet known, and a
        // slow-but-productive resolver would have been recorded dark, which is
        // precisely the case this phase makes common.
        //
        // Member sites only. A document gets TWO kinds of resolver, this one and
        // the whole-block resolver that fires at non-member sites. They answer
        // different questions, and a dark whole-block resolve says nothing about
        // whether the member surface is available.
        if (request.resolveInjection && request.memberSite && !controller.signal.aborted) {
          const doc = request.uri ?? "";
          if (injected || memberNames !== undefined) {
            this.darkResolvers.delete(doc);
          } else {
            this.darkResolvers.add(doc);
          }
        }
        const names = request.memberSite ? memberNames : undefined;
        const gated = names !== undefined;
        if (names !== undefined) {
          const partial = request.memberPartial ?? "";
          const receiver = request.memberReceiver;
          // The gate asks one question: does every member the ghost names
          // exist. A ghost naming a member the receiver does not have is a
          // hallucination the model states as confidently as a real one, and the
          // resolved member set is the only thing that can tell them apart.
          //
          // Two other legs were built here and withdrawn. A self-reference check
          // measured 224 false suppressions on 1.6M real member sites against no
          // true positive (docs/architecture/fim-completion.md, "The own-binding
          // suppression leg"). An arity leg - does each
          // call carry an argument count some signature accepts - was measured in
          // v19 and removed: it parsed only TypeScript's name-first render, so it
          // was dead in C#, Python and Rust, and on TypeScript it suppressed
          // slightly more correct code than the one wrong call it caught, in
          // front of the post-accept compiler oracle that catches that call
          // anyway.
          //
          // The gate deliberately does NOT strip the echo the provider strips.
          // A scoped request rewrites the prefix to end with the member name, so
          // a fresh generation re-spelling it has contradicted its own prompt.
          // That is a model failure and the honest outcome is a refusal that
          // says so. Stripping it here would also re-launder siblings, because
          // consuming `enrollTile` off `enrollTileTally(a, b)` composes a real
          // member out of a hallucinated one.
          //
          // No cache entry needs rescuing here, and the older justification that
          // said otherwise was wrong. The rewritten prefix is BOTH the prompt and
          // the cache key, so the prefix walk slices the member name off the head
          // of a pre-widget entry before it is ever returned - and a walked hit
          // returns above this gate anyway. The strip's real population is a
          // fresh scoped generation re-spelling the name where the gate is DARK,
          // which is permanent for Rust.
          const scopedCallee = request.scopedCallee ?? "";
          const rejection = (t: string): string | undefined => {
            // Separated from the hallucination refusal below because they share
            // a code path and shared a log line, which made the echo
            // uncountable: a dogfood session could not tell a model that
            // contradicted its own prompt from one that invented a member. The
            // frequency of the echo is still unmeasured, and this is what makes
            // measuring it possible.
            //
            // Two conditions, and both are load-bearing.
            //
            // The WHOLE name, not any echo `echoedNameRun` can find. Its index-0
            // branch matches the longest suffix, so a scope of `endpoint`
            // against an ordinary continuation of `e = 5` reports an echo of
            // `e`. Harmless where the result is a strip followed by a
            // landed-name check; a false suppression here, which is the T1
            // defect round 4 closed.
            //
            // And at index 0 only. Past a lead the repair wins instead: round 2
            // decided ` enrollTile(tile)` and `/*x*/enrollTile(tile)` are
            // repaired to spell the name once and SERVED, at both gate
            // settings. A model re-spelling its own last token one space late is
            // a different failure from one that opens by contradicting its
            // prompt outright, and only the second is refused here. The
            // separator branch is served for the same reason: D2's strip is what
            // handles it.
            const echo = scopedCallee === "" ? undefined : echoedNameRun(scopedCallee, t);
            if (echo !== undefined && echo.lead === "" && echo.echoed === scopedCallee) {
              return `scoped ghost re-spelled ${scopedCallee}, which its own prompt already ends with`;
            }
            if (!ghostNamesMember(t, partial, names, receiver)) {
              return `ghost names no resolved member (candidates=${names.length})`;
            }
            return undefined;
          };
          const why = text === "" ? undefined : rejection(text);
          if (why !== undefined) {
            this.log?.(`[fim] dropped: ${why}`);
            text = "";
          }
          for (let i = alternates.length - 1; i >= 0; i--) {
            if (rejection(alternates[i].text) !== undefined) {
              alternates.splice(i, 1);
            }
          }
        }
        // The enum-RHS VALUE gate. A SECOND rule, deliberately much narrower
        // than the member-name gate above, and it shares nothing with it: that
        // one asks whether a name exists on a receiver, this one asks whether a
        // C# TYPE RULE has already been broken by the ghost's first token.
        //
        // The one thing it judges: the value opens a STRING LITERAL. A C# enum
        // is never equal to a string - `t.Band == "LodBand.Regional"` does not
        // compile, at any enum, in any file - so the refusal has no
        // false-positive surface at all. Measured: at `t.Band == ` (the
        // trailing-space state, one keystroke past the capture) the block arm
        // served `"LodBand.Regional"` 5 of 5 while the control arm served
        // nothing, so the leg turned "no ghost" into "a wrong ghost". The leg
        // did not cause the model's error; it is what carried it to the screen.
        //
        // What it deliberately does NOT judge, and why the bar is exactly here.
        // It does not ask whether the ghost names a DISCLOSED VARIANT. At this
        // site the human may legitimately compare against anything in scope: a
        // local (`band).Count();`), a call (`Compute()`), a cast, a
        // parenthesised expression, another member access, `null` for a nullable
        // enum, and the literal `0`, which C# does allow against an enum. Every
        // one of those is served. Only the quoted form is measured harm, and a
        // wider rule would suppress code a human writes.
        //
        // Armed by the LANDED injection, not by the site. The site fires at
        // every `x.Y == ` and 112 of 143 real fires are not enums at all, where
        // `t.Owner == "acme"` is ordinary C#. The block renders only where the
        // definition hovered as `enum`, so `injected` at this site IS the
        // evidence that the left side is enum-typed - the same discipline the
        // member gate follows, which arms on resolved names and stays dark
        // without them.
        //
        // The alternates get it for the reason every rule below gets them: any
        // of them can be promoted into the served ghost.
        if (request.enumRhsSite && injected) {
          if (text !== "" && opensStringLiteral(text)) {
            this.log?.(
              `[fim] dropped: ghost opens a string literal at an enum-RHS site,` +
                ` and a string is never the value of an enum-typed comparison` +
                ` value=${JSON.stringify(text.trimStart().slice(0, 24))}`,
            );
            text = "";
          }
          for (let i = alternates.length - 1; i >= 0; i--) {
            if (opensStringLiteral(alternates[i].text)) {
              alternates.splice(i, 1);
            }
          }
        }
        // The length floor, last of every filter and measured on the text that
        // would have been served. A three-character ghost costs a full human
        // review and pays back almost nothing.
        //
        // PLAIN sites only, which is the same scope the bound runs at, and that
        // is a decision rather than an oversight. A member-site ghost is usually
        // a short identifier - `len`, `iter`, `Count` - and it is already policed
        // by the member-name gate above, which refuses on resolved evidence
        // instead of on length; an eight-character floor there would suppress
        // most of what the injection leg exists to produce. The floor is a
        // substitute for a confidence score at sites that have no other
        // evidence. Member sites have other evidence, and an exempt whole-block
        // site is licensed to write a body, which is never short anyway.
        //
        // The alternates get it too, for the reason the comment cut does: any of
        // them can be promoted into the served ghost two lines below.
        //
        // Not applied to a candidate the comment cut already trimmed, which is
        // the one composition the two rules get wrong. `n = 1  # the counter
        // starts at one` is 34 characters and clears the floor; the cut leaves
        // `n = 1` at five and the floor then refuses it. Neither rule suppresses
        // anything on its own there, and the ledger counts the keystroke twice
        // for one model failure. The cut has already made a judgement about that
        // ghost, and stacking a length judgement on its remainder charges the
        // human for the model's comment rather than for a short completion.
        if (bounded) {
          const under = (t: string, trimmed: boolean): boolean =>
            t !== "" && !trimmed && belowGhostFloor(t, this.config.minGhostChars, this.config.minGhostAlnum);
          // The primary is judged first because it is the one the human would
          // have seen; the alternates are judged at all because any of them can
          // be promoted into it two lines below. `text` rather than
          // `primary.text`: the member gate above may already have emptied it,
          // and a ghost the gate refused is not also under the floor.
          let refused = under(text, primary.trimmed) ? text : undefined;
          let droppedAlts = 0;
          for (let i = alternates.length - 1; i >= 0; i--) {
            if (under(alternates[i].text, alternates[i].trimmed)) {
              refused = refused ?? alternates[i].text;
              droppedAlts += 1;
              alternates.splice(i, 1);
            }
          }
          if (refused !== undefined) {
            // ONE count for the request, however many candidates it refused.
            // The keystroke is the event: a manual fan-out asking for four
            // candidates and refusing all four is one completion the human did
            // not get, and counting per candidate would price it as four.
            const alnum = refused.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
            this.log?.(
              `[fim] dropped: ghost under the length floor chars=${refused.length} alnum=${alnum}` +
                ` min=${this.config.minGhostChars}/${this.config.minGhostAlnum}` +
                (droppedAlts > 0 ? ` alts=${droppedAlts}` : "") +
                noteSuppression(this.suppressions, "below-floor"),
            );
          }
          if (under(text, primary.trimmed)) {
            text = "";
          }
        }
        // An empty primary with surviving extras promotes the first extra:
        // the gesture asked for options, and "no ghost" with options in hand
        // would be a lie of omission.
        if (text === "" && alternates.length > 0) {
          servedFrom = alternates.shift() as Candidate;
          text = servedFrom.text;
        }
        // Now the served text is known, so the two deferred suppressions can say
        // what they cost. `dropped:` keeps its one meaning across the whole
        // class: the human got nothing.
        //
        // The safety rule is counted only when nothing was served. A refused
        // candidate the request never intended to show removed nothing from what
        // the human saw, and counting it made `bound-unsafe` price a served
        // keystroke as a suppression. The comment cut is counted either way,
        // because it CHANGED the served text: the human got a shorter ghost than
        // the model produced, and that is the event the ledger is asked about.
        if (unsafeRefusals.length > 0) {
          const lost = text === "";
          const total = unsafeRefusals.length;
          unsafeRefusals.forEach((which, i) => {
            this.log?.(
              `[fim] ${lost ? "dropped" : "refused"}: no safe cut point inside the ` +
                `${MAX_BOUND_LINES}-line cap (${which})` +
                // ONE count for the request, the discipline the floor already
                // takes: the keystroke is the event, not the candidate.
                (lost && i === total - 1 ? noteSuppression(this.suppressions, "bound-unsafe") : ""),
            );
          });
        }
        if (commentCut !== "none") {
          this.log?.(
            `[fim] ${text === "" ? "dropped" : "trimmed"}: the ghost introduced a comment (${commentCut})` +
              noteSuppression(this.suppressions, "comment-introduced"),
          );
        }
        // User-perceived latency includes the injection query, which ran before
        // the model on the same critical path; report it in the numbers that
        // police the 200ms bar, not just the model's own TTFT.
        // The injection query ran BEFORE the model on the same critical path, so
        // it belongs in time-to-first-token. The gate's wait does not: it begins
        // after generation has returned, and folding it in would report a first
        // token arriving later than it did. It is real wall clock inside
        // complete() though, so it lands in the total and gets its own field on
        // the line - the phase's only latency cost has to be visible somewhere,
        // and it hides on exactly the slow hardware where it fires most.
        const ttftMs = result.ttftMs + injectionMs;
        const totalMs = result.totalMs + injectionMs + gateWaitMs;
        // Evidence before the empty-result early return: a round trip that
        // produced nothing is still a round trip that happened.
        // The TEXT, not just its length. A dogfood session spent three rounds
        // reading `len=18` as a feature failing, when 18 is exactly the length
        // of the answer the model had settled on. A length is a fact about a
        // string; the string is the evidence. Truncated because a whole-block
        // ghost is not a log line, escaped because a newline in this channel
        // reads as the next entry.
        const shown = text.length > 80 ? `${text.slice(0, 80)}...` : text;
        // What the bound DROPPED, as a count and never as the text: this is the
        // number the next dogfood report needs to find the decision, and phase
        // 6 needs it to price what the suppression costs. `stopped` is the
        // difference between the latency win landing and the read running out.
        //
        // Every field describes the generation that was SERVED, `servedFrom`
        // rather than the primary. `kept` was already recomputed from the served
        // text because the comment cut runs after `postprocessBounded`, so the
        // bound's own count describes what the bound kept and after a cut that
        // is not what the user saw; `bound=`, `dropped=` and `appended=` had the
        // same defect one promotion further out. A number on this channel that
        // means something else on some requests is worse than no number.
        const boundNote =
          servedFrom.bound === undefined
            ? ""
            : ` bound=${servedFrom.bound.rule} kept=${contentLines(text)}` +
              ` dropped=${servedFrom.bound.droppedLines} appended=${servedFrom.bound.appended.length}` +
              (servedFrom.stopped ? " stopped=true" : "");
        this.log?.(
          `[fim] ttft=${ttftMs}ms total=${totalMs}ms len=${text.length}` +
            boundNote +
            (gateWaitMs > 0 ? ` gateWait=${gateWaitMs}ms` : "") +
            (alternativeCount > 1 ? ` alts=${alternates.length}` : "") +
            // What the model actually wrote when the filters emptied it: without this an
            // empty serve at a dictated site could not be told from a model that wrote nothing.
            (text === ""
              ? ` (dropped: empty after postprocess) raw=${JSON.stringify(result.text.slice(0, 80))}`
              : ` ghost=${JSON.stringify(shown)}`),
        );
        if (text === "") {
          return undefined;
        }
        // Do NOT cache a completion that DEGRADED at an injectable site: a cold
        // or slow rust-analyzer produced nothing, so caching would serve the
        // un-injected guess forever, even once rust-analyzer warms.
        //
        // `!gated` is part of that, and it is the half that took five review
        // rounds to find. "Degraded" is meant to mean the resolver could not
        // answer - but a resolver CAN answer with the full member list and still
        // render no block, when no narrowed member carries a signature or the
        // set is over MAX_CANDIDATES. That is a property of the receiver, not of
        // a warming server, and the ghost it produced is not a guess: the gate
        // checked it against the real members. Refusing to store it made the
        // walk refusal fire again on the next keystroke and every one after,
        // generating a policed completion and throwing it away forever - 21
        // model calls against a productive block's 5.
        //
        // So both mechanisms now test the same quantity, `injected || gated`.
        // They disagreed before: the dark-resolver memo counted names as
        // policeable while this rule counted only a block as bankable, and
        // names-only fell in the gap. Two mechanisms classifying one resolver
        // outcome in opposite directions is what a non-converging refusal is
        // made of.
        //
        // Note this only ever ADDS cacheable cases. A member site with neither
        // injection nor a gate is still refused, which is what keeps an
        // unpoliced ghost out of the cache.
        //
        // `optionalInjection` is the third quantity, and it separates two things
        // this rule used to read as one. "Degraded" means the resolver could not
        // answer; a leg whose honest answer at most of its sites is "nothing
        // here" has not degraded when it says so. The enum-RHS leg asks at every
        // `x.Y == ` and most left sides are not enums, so without this every one
        // of those sites generates on every identical keystroke for the life of
        // the session. Member-site requests never set it, so that rule - which
        // has its own frozen tests and took five review rounds to get right -
        // decides exactly what it decided before.
        // An intent request never fills the cache: the same cursor without the
        // comment is a different question and must not be answered with this.
        if (request.intent) {
          this.log?.("[fim] not cached: dictated intent, one request by design");
        }
        const cacheable = !request.intent && !(
          request.resolveInjection &&
          !request.optionalInjection &&
          !injected &&
          !gated
        );
        if (cacheable) {
          this.cache.set(cachePrefix, suffix, text, request.uri, {
            memberSite: !!request.memberSite,
            injected,
            gated,
          });
        } else if (!request.intent) {
          // Every refusal costs a model call on the next identical keystroke, so
          // a silent one is an unexplained latency cost and a cache-hit-rate
          // drop with nothing in the channel to attribute it to. That is the
          // causality gap this phase exists to close; leaving the refusal side
          // dark would reopen it on the write path. One refusal reason exists,
          // so the line names it rather than printing flags to be decoded - and
          // it names it PRECISELY: the site required an injection and did not
          // get one. The old wording claimed degradation at every site that
          // merely had a resolver wired, which read as a rust-analyzer problem
          // on 112 of 143 enum-RHS fires where nothing had gone wrong at all.
          this.log?.(
            `[fim] not cached: a required injection did not land` +
              ` memberSite=${!!request.memberSite} injected=${injected} gated=${gated}`,
          );
        }
        return alternates.length > 0
          ? { text, fromCache: false, ttftMs, totalMs, alternates: alternates.map((a) => a.text) }
          : { text, fromCache: false, ttftMs, totalMs };
      } catch (err) {
        // Abort is cancellation; anything else (server down, model missing)
        // degrades to "no suggestion" rather than surfacing per keystroke.
        if (!controller.signal.aborted) {
          // ESCAPED, for the reason `channelBodyLine` escapes: a non-ok body
          // reaches this line inside the transport's throw, and an unescaped
          // break lets the server write its own `[fim]`-tagged channel row
          // (scrap S58-2). The escape runs outside the 400-char bound the
          // transport already applied, so a break-heavy body renders up to
          // about six times that on one row - well under CHANNEL_BODY_CHARS,
          // and re-bounding here would cut the message.
          this.log?.(`[fim] request failed: ${escapeBreaks(String(err))}`);
          return undefined;
        }
        // A generation that FAILED aborts the controller on its way out (see the
        // per-run catch above), so an aborted signal here does not mean the user
        // cancelled - and reporting it as cancellation points a dogfood session
        // at the editor when the real cause was a dead server. Name the failure
        // when there is one.
        //
        // A real failure LEADS with the failure. Appending it to "cancelled
        // mid-request" left the word a human scans for saying the wrong thing:
        // the silence watchdog would cut a dead server and this line still
        // opened with "cancelled". Cancellation is now only claimed when there
        // is nothing else to report.
        if (err instanceof Error && err.name !== "AbortError") {
          return this.noGhost(`${err.name}: ${err.message} (the request was then aborted)`);
        }
        return this.noGhost("cancelled mid-request");
      } finally {
        signal?.removeEventListener("abort", forwardAbort);
        if (this.inflight?.controller === controller) {
          this.inflight = undefined;
        }
      }
    })();

    this.inflight = { key, controller, promise };
    return promise;
  }

  /** An edit landed in `changedUri`: evict every cached completion minted
   *  for a DIFFERENT document. Same-document entries stay - the prefix-walk
   *  and version semantics already own same-file staleness, and they are
   *  what keeps typing-through smooth. */
  onDocumentChanged(changedUri: string): void {
    this.cache.retainOnly(changedUri);
  }

  dispose(): void {
    this.disposed = true;
    this.pendingDebounceCancel?.();
    this.inflight?.controller.abort();
    this.darkResolvers.clear();
  }

  /** Resolves true when the wait ran out, false when superseded or aborted. */
  private debounceWait(ms: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const finish = (survived: boolean) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (this.pendingDebounceCancel === cancel) {
          this.pendingDebounceCancel = undefined;
        }
        resolve(survived);
      };
      const timer = setTimeout(() => finish(true), ms);
      const onAbort = () => finish(false);
      const cancel = () => finish(false);
      signal?.addEventListener("abort", onAbort);
      this.pendingDebounceCancel = cancel;
    });
  }
}

// Which side of the race won, reported rather than inferred. A resolver that
// answers `undefined` quickly and one that misses the deadline both yield no
// value, and callers that need to tell them apart were re-reading the wall
// clock to guess - which misreports whenever the elapsed time rounds to just
// under the deadline.
const TIMED_OUT = Symbol("deadline");
type RaceOutcome<T> = { timedOut: true; value?: undefined } | { timedOut: false; value: T };

// Awaits `work` for at most `ms`, reporting whether it settled in
// time. The loser is NOT cancelled - `work` keeps running and may be awaited
// again later, which is the whole point at the injection deadline: the block
// gives up on the query and the gate picks it up.
//
// The timer is cleared rather than left to fire. Two of these run per member
// site now, and a pending timer keeps the event loop alive; a headless test
// suite would sit waiting on a deadline nobody is listening to.
async function raceDeadline<T>(
  work: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<RaceOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
    // Cancellation has to END the wait, not just be noticed after it. Without
    // this the caller learns it was aborted only once the deadline expires, so a
    // cancelled keystroke holds the event loop for the full bound and a dispose
    // cannot shut the service down promptly.
    if (signal) {
      onAbort = () => resolve(TIMED_OUT);
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });
  try {
    const settled = await Promise.race([work, deadline]);
    return settled === TIMED_OUT ? { timedOut: true } : { timedOut: false, value: settled };
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

// Forces a flat copy so the result does not root its source string: V8
// represents slice() results as views over the parent, and cache entries
// must not pin document-sized parents in memory.
function unroot(s: string): string {
  return (" " + s).slice(1);
}

// The indentation-scope anchor for postprocess. A blank cursor line (column
// 0 on an empty line, or mid-indent) is a normal editor state inside a
// block; anchoring depth at the nearest non-blank line above (Tabby's
// reference behavior) keeps the scope filter live there.
/** Drop blank and line-comment lines from the head of a raw generation; the rest is untouched. */
function stripLeadingCommentLines(raw: string, openers: readonly string[]): string {
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t !== "" && !openers.some((o) => t.startsWith(o))) {
      break;
    }
    i++;
  }
  return i === 0 || i === lines.length ? raw : lines.slice(i).join("\n");
}

function scopeAnchor(prefix: string): string {
  const currentLinePrefix = prefix.slice(prefix.lastIndexOf("\n") + 1);
  if (currentLinePrefix.trim() !== "") {
    return currentLinePrefix;
  }
  const lines = prefix.split("\n");
  for (let i = lines.length - 2; i >= 0; i--) {
    if (lines[i].trim() !== "") {
      return lines[i].match(/^[ \t]*/)?.[0] ?? "";
    }
  }
  return currentLinePrefix;
}

// A joiner shares the in-flight result but owns its cancellation: its abort
// resolves the joiner undefined without touching the initiator's request.
function joinWithSignal(
  shared: Promise<CompletionResult | undefined>,
  signal: AbortSignal | undefined,
): Promise<CompletionResult | undefined> {
  if (!signal) {
    return shared;
  }
  if (signal.aborted) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const onAbort = () => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    void shared.then((result) => {
      signal.removeEventListener("abort", onAbort);
      resolve(signal.aborted ? undefined : result);
    });
  });
}
