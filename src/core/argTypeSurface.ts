import { CompletionMember, SourceCursor, SurfaceExtractor } from "./extraction";
import { FimArgType, argumentTypeNames } from "./fimInject";
import { findTypeAnchorInText, goFindTypeAnchorInText, pyFindTypeAnchorInText } from "./fimWholeBlock";

/** The document an argument type is NAMED in. Everything the resolution needs
 *  from an editor buffer, as plain data, so the ladder can be driven outside
 *  one. */
export interface ArgTypeSource {
  uri: string;
  languageId: string;
  text: string;
}

/** How many argument types one member site may resolve.
 *
 *  Each costs a definition round trip plus a documentSymbol read against the
 *  language server, and they run in SEQUENCE inside the sub-budget. The measured
 *  arity fix came from ONE argument type; a wide member set naming a dozen would
 *  spend the whole budget and land nothing. */
export const MAX_ARG_TYPES = 2;

/** The margin the argument-type leg leaves unspent on the injection window.
 *
 *  This is the ONLY lever on how late the whole injection can land. The caller
 *  hands the leg `INJECTION_DEADLINE_MS - elapsed - margin`, so the injection
 *  finishes at `elapsed + legMs`; substitute and `elapsed` cancels:
 *
 *      total = INJECTION_DEADLINE_MS - margin + (legMs - budgetMs)
 *
 *  A leg that returns later than its budget by more than the margin therefore
 *  puts the injection past the window for EVERY value of `elapsed`, on every
 *  language, and the service discards the receiver block and the enforcement
 *  set along with the argument types. The floor below cannot substitute for
 *  this: it decides whether the leg runs, never how late it lands once it does.
 *
 *  The number is the measured overshoot in a real extension host, at forced
 *  budgets sweeping 5-40ms over the four dogfood repos. Where the budget covers
 *  what the leg costs, so the deadline is what ends it, the leg came back 0-1ms
 *  late on every language across repeated runs. Where the budget is BELOW what
 *  the leg costs, overshoot reached 13ms — but that is the leg's own
 *  unfinishable cost showing through a timer the busy extension-host loop
 *  cannot service, not slip, and the per-language floor below is what removes
 *  that case.
 *
 *  So 8 is 1ms of measured slip and 7ms of headroom for how much a leg's cost
 *  varies above the floor: the same TypeScript leg was measured between 11 and
 *  35ms. The render this margin was once justified by is free — one hundred
 *  `renderFimCandidates` calls over a settled member set finish inside a
 *  millisecond on every language. It was 10 before, on an unmeasured guess, and
 *  briefly 2, which is under the variance above and lost whole injections on
 *  Python. */
export const ARG_TYPE_DEADLINE_MARGIN_MS = 8;

/** The budget below which a language's leg is not worth starting, so it is
 *  skipped and costs nothing rather than being started and abandoned.
 *
 *  This is about WASTE, not overrun. It cannot bound how late the injection
 *  lands — `elapsed` cancels out of the arithmetic above, so no floor changes
 *  the worst case once the leg is running. Anyone reading it as cover for a
 *  smaller margin has the two backwards.
 *
 *  Per-language because the leg costs what its server costs. Measured at forced
 *  budgets in a real extension host over the dogfood repos across repeated
 *  runs, warm: TypeScript legs 11-35ms, Python 2-11ms, C# and Rust 0-2ms.
 *  TypeScript is the outlier because it recovers its signatures with a hover
 *  fan-out the other three do not need.
 *
 *  Each number is the highest floor every measured keystroke on that language
 *  still clears. Higher would refuse the leg on a slow receiver — TypeScript's
 *  own receiver was measured between 6 and 21ms, leaving budgets of 21-36ms —
 *  and lower would admit legs that spend the window and come back empty, which
 *  is the whole failure the floor exists to prevent.
 *
 *  Where the two bounds cross, the language does not fit and no floor makes it
 *  fit. Python is there today: its receiver alone spends 27-64ms of the window
 *  and the floor is what makes that visible instead of silent. */
const ARG_TYPE_MIN_BUDGET_BY_LANGUAGE: Readonly<Record<string, number>> = {
  typescript: 20,
  python: 12,
};

/** The floor for a language nothing has been measured on. Nothing lands under a
 *  single language-server round trip. */
export const ARG_TYPE_MIN_BUDGET_MS = 5;

export function argTypeMinBudgetMs(languageId: string): number {
  return ARG_TYPE_MIN_BUDGET_BY_LANGUAGE[languageId] ?? ARG_TYPE_MIN_BUDGET_MS;
}

/** A SAFE anchor cursor for a type in play: an import line or the first
 *  NON-COMMENT reference — never a header-comment occurrence, where definition()
 *  resolves nothing, nor a shadowing same-named type. undefined when the type is
 *  not referenced in code. */
export function findArgTypeAnchor(type: string, source: ArgTypeSource): SourceCursor | undefined {
  // Python anchors on `import`/`from ... import` lines and skips `#` comments;
  // Go on `import` lines (single or grouped block, where the package path
  // lives); every other language uses the Rust-shaped `use`-line +
  // `//`-comment anchor.
  const at =
    source.languageId === "python"
      ? pyFindTypeAnchorInText(source.text, type)
      : source.languageId === "go"
        ? goFindTypeAnchorInText(source.text, type)
        : findTypeAnchorInText(source.text, type);
  return at ? { uri: source.uri, line: at.line, character: at.character } : undefined;
}

/** Whether a resolved argument type IS the receiver — a self-merge shape
 *  (`stripe.Merge(Stripe)`) is common enough to matter. Rendering it would put
 *  the receiver's own methods under `to build a Stripe:`, telling the model those
 *  methods construct it, directly beneath a header demanding exact names: not a
 *  miss, a false statement. The extractor returns members, not the receiver's
 *  type name, so identity is read off the member sets — a resolved type carrying
 *  every one of the receiver's candidate names is that receiver. */
function isReceiverItself(members: CompletionMember[], receiverNames: ReadonlySet<string>): boolean {
  if (receiverNames.size === 0) {
    return false;
  }
  const resolved = new Set(members.map((m) => m.name));
  for (const name of receiverNames) {
    if (!resolved.has(name)) {
      return false;
    }
  }
  return true;
}

/** The construction surface of ONE argument type, or undefined when it anchors
 *  nowhere, resolves to nothing, throws, or turns out to be the receiver. */
async function resolveOneArgType(
  extractor: SurfaceExtractor,
  source: ArgTypeSource,
  type: string,
  receiverNames: ReadonlySet<string>,
  deadline: number,
): Promise<FimArgType | undefined> {
  try {
    // `membersOfType` takes a DEFINITION cursor. A text anchor is NOT one: it is
    // wherever the type is MENTIONED, which for an argument type is usually a
    // reference inside some other declaration. Handing that straight to
    // membersOfType is what made a mention of `Tile` inside a helper class return
    // that HELPER's methods under a `to build a Tile:` header. `definition()` is
    // the step that turns a reference into a definition. The workspace-symbol leg
    // already answers WITH a definition, so it needs no such step and stays the
    // fallback: it is a round trip this budget cannot spend on every type, while
    // the anchor is a local text scan.
    let defCursor: SourceCursor | undefined;
    const reference = findArgTypeAnchor(type, source);
    const located = reference ? await extractor.definition(reference) : undefined;
    if (located) {
      defCursor = {
        uri: located.uri,
        line: located.range.startLine,
        character: located.range.startCharacter,
      };
    }
    if (!defCursor && extractor.resolveTypeCursorByName) {
      defCursor = (await extractor.resolveTypeCursorByName(type)) ?? undefined;
    }
    if (!defCursor) {
      return undefined;
    }
    // Reads the definition's symbols rather than a completion list, which is what
    // keeps Python's `__init__` — the one member whose signature carries the
    // constructor arity.
    //
    // The remaining window travels with the call. Without it the transport spends
    // its own fixed hover-fan-out bound, which is looser than the window it sits
    // inside, overruns, and the type is discarded whole — a surface with SOME
    // signatures is worth more than none, and this is the same partial-progress
    // rule the loop above applies one level up.
    const members = await extractor.membersOfType(defCursor, Math.max(0, deadline - Date.now()));
    if (members.length === 0 || isReceiverItself(members, receiverNames)) {
      return undefined;
    }
    return { name: type, members };
  } catch {
    return undefined;
  }
}

/** The construction surfaces of the types the candidate members take as
 *  ARGUMENTS, resolved in sequence against ONE deadline.
 *
 *  Every leg degrades rather than blocks. A type that anchors nowhere, resolves
 *  to nothing, throws, or is simply too slow is absent from the result and the
 *  caller falls back to the receiver-only injection.
 *
 *  The budget is spent type by type and the types that ANSWERED are kept: an
 *  all-or-nothing race over the whole loop discards a surface already paid for
 *  because a later, slower one overran, which is exactly the work the caller has
 *  no way to redo before the keystroke expires.
 *
 *  A timed-out resolve is abandoned, not cancelled — no extractor exposes such a
 *  seam — so it keeps running against the language server and its result is
 *  dropped. That is bounded work, not a leak. */
export async function resolveArgTypesInBudget(
  extractor: SurfaceExtractor,
  source: ArgTypeSource,
  candidates: CompletionMember[],
  budgetMs: number,
): Promise<FimArgType[]> {
  const floorMs = argTypeMinBudgetMs(source.languageId);
  if (budgetMs < floorMs) {
    return [];
  }
  // The deadline is absolute and taken BEFORE the work starts, so the leg's
  // synchronous prologue — a full-text anchor scan — is charged against the
  // budget rather than added to it. On the real dogfood files that scan is
  // 0.002-0.011ms and the distinction does not show; it is load-bearing only on
  // a document large enough for one full pass to matter, which is what
  // `impl-v15-budget.test.cjs` drives it with.
  const deadline = Date.now() + budgetMs;
  const receiverNames = new Set(candidates.map((m) => m.name));
  const out: FimArgType[] = [];
  for (const type of argumentTypeNames(candidates, source.languageId).slice(0, MAX_ARG_TYPES)) {
    if (deadline - Date.now() < floorMs) {
      break;
    }
    const resolved = await raceDeadline(resolveOneArgType(extractor, source, type, receiverNames, deadline), deadline);
    if (resolved === TIMED_OUT) {
      break; // the window is gone; a further type would only be started and abandoned
    }
    if (resolved) {
      out.push(resolved);
    }
  }
  return out;
}

const TIMED_OUT = Symbol("arg type resolve overran its budget");

/** Races `work` against an ABSOLUTE instant, never a duration.
 *
 *  Each resolve opens with a synchronous prologue — a full-text anchor scan —
 *  that runs to completion before any timer scheduled after it can exist. A
 *  duration would start counting on the far side of that prologue and let the
 *  call overrun the window by its whole cost. On the dogfood files that cost is
 *  microseconds; it is enough to lose the entire injection only on a document
 *  large enough for the scan to matter. Reading the clock here charges it
 *  against the deadline instead of adding to it, so the size of the document
 *  stops being part of the accounting.
 *
 *  The timer is not a guarantee of when the value arrives. It fires from the
 *  extension host's own loop, which the language-server round trip in flight is
 *  busy on, so a leg whose budget expires mid-round-trip returns when the loop
 *  next drains — measured up to 13ms late at budgets below what the leg costs.
 *  The floor exists to keep the leg out of that regime, and
 *  `ARG_TYPE_DEADLINE_MARGIN_MS` covers what is left. */
async function raceDeadline<T>(work: Promise<T>, deadline: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((r) => {
        timer = setTimeout(() => r(TIMED_OUT), Math.max(0, deadline - Date.now()));
      }),
    ]);
  } finally {
    // This runs per keystroke, and a pending timer per call is a leak even at 5ms.
    clearTimeout(timer);
  }
}
