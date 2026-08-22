/**
 * FIM candidate-set injection: at a `.`/`::` member site, inject the receiver's
 * real member SIGNATURES into the FIM prefix so the 1.5b completes a real member
 * instead of an invented one. Trigger-based: the dangerous
 * positions - right after `.`/`::` - are exactly the resolvable ones, so the
 * trigger char is the cheap selector and a fresh, unanchored position is never
 * injected into. Signatures, not bare names: the return type is the
 * load-bearing signal. De-risk on the reference box: bare 0/6 (invents `new`),
 * injected 5/6, TTFT +1ms.
 *
 * Pure. The vscode layer runs the rust-analyzer query and threads the result in.
 */

import { CompletionMember, renderMemberSignatures } from "./extraction";
import { PY_STD_TYPE_NAMES, STD_TYPE_NAMES, isConstructionMember } from "./crossFileShape";
import { TS_LANGUAGE_IDS, TS_STD_TYPE_NAMES } from "./tsExtraction";
import { CS_STD_TYPE_NAMES, csMemberTypeContainer, csMemberTypeName, csTypeSpelling } from "./csExtraction";
import { GO_STD_TYPE_NAMES } from "./goExtraction";

/** A member/path access at the end of the prefix: `foo.`, `foo.ba`, `Type::`,
 *  `Type::wi`. `partial` is the already-typed member name (may = ""), used to
 *  narrow the candidate set. undefined when the cursor is not at such a site -
 *  a fresh position, a literal, whitespace - where nothing is injected.
 *
 *  `lineComments` is the language's line-comment token set, so a `.`/`::` on a
 *  comment line fires no resolver query. It defaults to `["//"]`, keeping every
 *  existing Rust/TS/C# call site byte-identical; Python passes `["#"]`. The
 *  token set is DATA, never hardcoded to one language: `#`-darkness must be
 *  opt-in, because in Rust `#[serde::` is an attribute path a query should
 *  still resolve, not a comment. */
export function fimMemberSite(
  prefix: string,
  lineComments: readonly string[] = ["//"],
): { partial: string } | undefined {
  // A `.`/`::` inside a line comment is not member access; skip it so no
  // resolver query fires while the human writes a comment.
  const currentLine = prefix.slice(prefix.lastIndexOf("\n") + 1).trimStart();
  if (lineComments.some((token) => currentLine.startsWith(token))) {
    return undefined;
  }
  // An optional identifier, immediately preceded by `.` or `::`, at the very end.
  const m = /(?:\.|::)([A-Za-z_][A-Za-z0-9_]*)?$/.exec(prefix);
  if (!m) {
    return undefined;
  }
  // Rule out the `.` that is not member access: a float (`1.`) and a range or
  // struct-update (`0..`, `Foo { ..`). `::` never has this ambiguity.
  if (prefix[m.index] === ".") {
    const before = prefix[m.index - 1] ?? "";
    if (/[0-9.]/.test(before)) {
      return undefined;
    }
  }
  return { partial: m[1] ?? "" };
}

/** The Python member-site detector. Unlike the shared
 *  C-family `fimMemberSite`, Python has NO `::` member operator (`::` appears only
 *  inside a slice, `arr[1::`), so every `::` is NON-member here: `pyMemberSite`
 *  only fires on a trailing `.` after an identifier / call / subscript / f-string
 *  hole, never on `::`. `#` is the Python comment token, so a current line that
 *  (after trimming) starts with `#` is dark. Float `.` (`1.`, `42.`) and a double
 *  dot are excluded, exactly as the shared helper excludes them. `partial` is the
 *  already-typed member name (may = ""), narrowing the candidate set. undefined at
 *  a dark position. */
export function pyMemberSite(prefix: string): { partial: string } | undefined {
  const currentLine = prefix.slice(prefix.lastIndexOf("\n") + 1);
  // A `#` comment line fires no resolver query while the human writes a comment.
  if (currentLine.trimStart().startsWith("#")) {
    return undefined;
  }
  // A trailing `.` with an optional member identifier, at the very end. `::`
  // never matches (no `.`), so a slice `arr[1::` / `std::` reads as dark.
  const m = /\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(prefix);
  if (!m) {
    return undefined;
  }
  // Rule out the `.` that is not member access: a float (`1.`, `42.`) or a double
  // dot (`user..`). The char before the matched `.` decides.
  const before = prefix[m.index - 1] ?? "";
  if (/[0-9.]/.test(before)) {
    return undefined;
  }
  return { partial: m[1] ?? "" };
}

/** The Go member-site detector: `.`-only beside Python's (`::` never occurs
 *  in Go — a `std::` prefix stays dark because there is no `.` to match),
 *  with `//` as the comment token instead of `#`. Float `.` and double dot
 *  are excluded exactly as everywhere else. */
export function goMemberSite(prefix: string): { partial: string } | undefined {
  const currentLine = prefix.slice(prefix.lastIndexOf("\n") + 1);
  // A `//` comment line fires no resolver query while the human writes one.
  if (currentLine.trimStart().startsWith("//")) {
    return undefined;
  }
  const m = /\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(prefix);
  if (!m) {
    return undefined;
  }
  const before = prefix[m.index - 1] ?? "";
  if (/[0-9.]/.test(before)) {
    return undefined;
  }
  return { partial: m[1] ?? "" };
}

/** The RECEIVER name at a member site: the identifier the trailing `.`/`::`
 *  hangs off, so the output gate can recognise `receiver.NAME` again further
 *  down a multi-line ghost. undefined when the receiver is not a plain
 *  identifier (`foo().`, `arr[0].`, a bare `.`): a receiver we cannot name is a
 *  receiver we cannot match, and guessing one would gate the wrong references.
 *  Only the LAST segment of a path is returned - in `a.b.` the ghost writes
 *  `b`'s members, not `a`'s. */
export function memberReceiverName(prefix: string): string | undefined {
  return /([A-Za-z_$][A-Za-z0-9_$]*)(?:\.|::)(?:[A-Za-z_$][A-Za-z0-9_$]*)?$/.exec(prefix)?.[1];
}

/** An ENUM-RHS site: the cursor sits just past a comparison operator whose LEFT
 *  side is a member access, so what the human types next is a VALUE of that
 *  member's type. `member` is the left side's last member token and `offset` is
 *  where it starts in the prefix; together they are a cursor the resolver can
 *  hover, which is all the detector can honestly claim from text alone.
 *
 *  Why the site is worth a surface at all: at `t.Band == ` the 1.5b wrote
 *  ` Band.Regional).Count();`, a value that does not exist, and with the type
 *  merely NAMED in a scoped comment it wrote ` == LodBand.Regional).Count();`
 *  (three captures). An enum is a closed set, so the
 *  variant list is both small and complete, the highest-precision surface in
 *  the product. */
export interface EnumRhsSite {
  /** The member token on the left of the operator (`Band` in `t.Band == `). */
  readonly member: string;
  /** Where that token's first character sits in the PREFIX, so the caller can
   *  turn it back into a document cursor without re-parsing anything. */
  readonly offset: number;
}

// The identifier immediately ahead of an equality operator at the very end of
// the line. `==` and `!=` only: `>=` and `<=` are orderings (and never match
// here, the char before the `=` is not an identifier), a lone `=` is an
// assignment whose RHS is not a comparison at all, and `===`/`!==` cannot match
// because the character ahead of the matched `==` is another operator character
// rather than an identifier. The match STARTS at the member token, so the
// match index is the token's offset.
const EQUALITY_TAIL = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:==|!=)\s*$/;

// How far back from the cursor the detector reads. A site is one identifier,
// some whitespace and the operator, so nothing further left can be part of one,
// and the longest identifier-character run in the two real C# corpora is 86
// characters.
//
// The bound is not tidiness, it is the latency invariant. EQUALITY_TAIL is
// end-anchored and NOT start-anchored, so the engine retries from every offset
// and its `[A-Za-z0-9_]*` backtracks a character at a time from each: measured
// 624ms for one keystroke on a 40,000-character identifier run, ahead of the
// debounce, against a 200ms warm-TTFT invariant. maskNonCode allocates a
// character array the size of what it is handed, which cost another 4.5ms per
// keystroke on a generated single-line file. Both are now bounded by a constant.
//
// What the bound costs: on a line LONGER than this, a string or comment opened
// before the tail is invisible, so a `==` written inside one can fire the site.
// Same class of accepted miss the line scoping already makes for a multi-line
// block comment, and it buys a detector that cannot hang.
const SITE_TAIL_CHARS = 200;

/** The C# enum-RHS detector. Prefix-only, no query: the cursor's line must end
 *  in `==`/`!=` and the identifier ahead of it must be a MEMBER access, because
 *  a member is the only left side whose type a hover can name in one round trip.
 *  `a == ` (a local, a parameter, a literal) is deliberately dark.
 *
 *  Dark inside comments and strings, which is what `maskNonCode` buys: a `==`
 *  the human is writing about is not a comparison, and the mask preserves every
 *  offset so the match index still points into the real prefix. Line-scoped and
 *  then tail-scoped on purpose: this runs on the keystroke path ahead of the
 *  debounce, so every step of it is bounded by SITE_TAIL_CHARS rather than by
 *  the size of whatever the human is editing. */
export function csEnumRhsSite(prefix: string): EnumRhsSite | undefined {
  // The tail first, then the line start INSIDE it. A `lastIndexOf` over the
  // whole prefix walks the document backwards looking for a newline a generated
  // single-line file does not contain, and that scan alone was 50us per
  // keystroke on a 200KB line. Where the cursor's line starts inside the tail
  // this finds it and nothing from the line above leaks in; where it does not,
  // the bound IS the start.
  const from = Math.max(0, prefix.length - SITE_TAIL_CHARS);
  const tailStart = from + prefix.slice(from).lastIndexOf("\n") + 1;
  const tail = maskNonCode(prefix.slice(tailStart));
  // The operator is the last thing on the line or there is no site, and that
  // test is a string comparison rather than a search. It is the answer on every
  // keystroke that is not a site, which is almost all of them, and it keeps the
  // backtracking regex below off inputs that cannot match it.
  const code = tail.replace(/\s+$/, "");
  if (!code.endsWith("==") && !code.endsWith("!=")) {
    return undefined;
  }
  const m = EQUALITY_TAIL.exec(tail);
  if (!m) {
    return undefined;
  }
  const at = m.index;
  // A member access, not a bare name: the char ahead of the token is the `.`
  // (`t?.Band` included; the `?` sits one further left). The same float and
  // double-dot exclusions the member detector makes apply, for the same reason.
  // A token running back to the tail's own start has no char ahead of it to
  // read, so it goes dark: a member name that long is not real, and guessing
  // past the bound would be reading text the detector did not look at.
  if (tail[at - 1] !== "." || /[0-9.]/.test(tail[at - 2] ?? "")) {
    return undefined;
  }
  return { member: m[1], offset: tailStart + at };
}

/** The enum-RHS detector registry, the `wholeBlockSiteFor` analog: undefined
 *  keeps the gesture dark for a language with no detector, which is every
 *  language but C# today (all three captures are C#).
 *
 *  A language joins by adding a row HERE, a row in `memberTypeNameFor` and a row
 *  in `typeSpellingFor`. The leg needs all three: a site to fire at, a way to
 *  read the member's type off that language's hover, and a way to spell that
 *  type so it compiles where the block lands. Any one missing resolves nothing,
 *  or worse, resolves a name the site cannot use. */
export function enumRhsSiteFor(
  languageId: string,
): ((prefix: string) => EnumRhsSite | undefined) | undefined {
  if (languageId === "csharp") {
    return csEnumRhsSite;
  }
  return undefined;
}

/** The reader that turns a def-site hover signature into the DECLARED TYPE of
 *  the member under it: the enum-RHS leg's second half, paired with
 *  `enumRhsSiteFor` above. undefined keeps the leg dark: a language whose
 *  resolver cannot answer "what type is this member" cheaply stays dark rather
 *  than guessing, the rule the oracle and extractor seams already follow. */
export function memberTypeNameFor(
  languageId: string,
): ((signature: string | undefined) => string | undefined) | undefined {
  if (languageId === "csharp") {
    return csMemberTypeName;
  }
  return undefined;
}

/** The reader that pulls the NAMESPACE off the same hover `memberTypeNameFor`
 *  reads the type name from, so an ambiguous short name can be disambiguated
 *  instead of refused. Paired with it, never used alone: it answers "which
 *  `DataOrigin`", which is only a question once the name is in hand.
 *
 *  Its own row rather than a wider return from `memberTypeNameFor`, because the
 *  two answers travel to different places - the name to the resolver and the
 *  render, the container only to the workspace-symbol leg - and a language may
 *  well have a hover that names the type without ever qualifying it. undefined
 *  costs that language nothing: the by-name rung then asks with no hint and the
 *  ambiguity refusal stands, which is what it did before this row existed. */
export function memberTypeContainerFor(
  languageId: string,
): ((signature: string | undefined) => string | undefined) | undefined {
  if (languageId === "csharp") {
    return csMemberTypeContainer;
  }
  return undefined;
}

/** The reader that turns a TYPE's own def hover into the spelling that resolves
 *  in a given buffer, the enum-RHS leg's third half. Two questions with one
 *  answer, because they are the same question:
 *
 *  - what the block must SAY. The def hover carries the fully qualified name and
 *    the consuming file's imports decide whether the short form reaches it, so a
 *    block that always prints the last segment instructs the model to write a
 *    name that does not compile wherever the file reaches the type through a
 *    namespace it does not import.
 *  - whether an anchor landed on a TYPE at all. undefined here means the hover
 *    declares something else, which is exactly the same-named property C# idiom
 *    puts in the way of the anchor.
 *
 *  undefined for a language with no reader, which keeps the leg dark there: a
 *  leg that cannot say what to write has nothing worth saying. */
export function typeSpellingFor(
  languageId: string,
): ((defSignature: string | undefined, fileText: string) => string | undefined) | undefined {
  if (languageId === "csharp") {
    return csTypeSpelling;
  }
  return undefined;
}

/** The member-site detector registry the FIM provider dispatches on (the
 *  `wholeBlockSiteFor` analog). TOTAL — every language yields a concrete
 *  detector, never undefined: `python` gets `pyMemberSite` (darkens `::`);
 *  every other language gets a thin detector delegating to the shared
 *  `fimMemberSite` (BYTE-IDENTICAL, so `::` keeps firing for Rust/C# scope). This
 *  lets call sites use `memberSiteFor(lang)(prefix)` uniformly
 *  without changing rust/ts/cs prompt bytes. */
export function memberSiteFor(languageId: string): (prefix: string) => { partial: string } | undefined {
  if (languageId === "python") {
    return pyMemberSite;
  }
  if (languageId === "go") {
    return goMemberSite;
  }
  // The C-family default: delegate to the shared helper, verbatim. `::` is a real
  // scope member operator in Rust/C# and MUST keep firing (darkening `::` is
  // Python-scoped, never a change to the shared helper).
  return (prefix) => fimMemberSite(prefix);
}

/** Record one dark member site (a `.` site that injected nothing) against the
 *  provider's running `seen` map, keyed on `uri:line:character` and REASON.
 *  `firstSeen` is true once per site-and-reason: one keystroke that was merely
 *  slow must not silence the site's real reason for the rest of the session,
 *  and a reason repeating at its own site still logs once, which is what keeps
 *  the channel from carrying a line per keystroke.
 *
 *  `sessionCount` stays the number of DISTINCT SITES that have been dark for any
 *  reason, slowness included — the summary counter, not a count of lines.
 *
 *  Pure — the dedup/count is blind-testable; the provider owns the map and does
 *  the logging. */
export function recordDarkSite(
  seen: Map<string, Set<string>>,
  key: string,
  reason: string,
): { firstSeen: boolean; sessionCount: number } {
  const reasons = seen.get(key);
  if (reasons === undefined) {
    seen.set(key, new Set([reason]));
    return { firstSeen: true, sessionCount: seen.size };
  }
  const firstSeen = !reasons.has(reason);
  reasons.add(reason);
  return { firstSeen, sessionCount: seen.size };
}

/** The language's line-comment token, so an injected block is a COMMENT in the
 *  buffer it lands in rather than a syntax error. The `memberSiteFor` sibling:
 *  total, and `//` is the fallback for every unmapped and unknown language —
 *  never that language's own token guessed at. Python is the one mapping that
 *  matters today: a `//`-prefixed block is a syntax error there. */
export function lineCommentFor(languageId: string): string {
  return languageId === "python" ? "#" : "//";
}

/** What a language excludes from the argument-type scan: the std/builtin
 *  stop-set, and whether Rust's non-constructible POSITION rules apply. */
interface ArgTypeStopRules {
  readonly std: Set<string>;
  readonly rustPositions: boolean;
}

/** The stop rules for a language. One registry over the sets each extractor
 *  already keeps, dispatching the way `shapeHooksFor` does; Rust's set is the
 *  default because it is the codebase's unqualified `STD_TYPE_NAMES`. The
 *  position rules are NOT part of that default: `impl` and `dyn` are Rust
 *  keywords, and an unmapped language (Java, C++) must not have its
 *  parameter types judged by a grammar that is not its own. Exported since
 *  v23: the Go row is pinned by its blind suite, and shape-level pins need
 *  the object, not just argumentTypeNames' behavior. */
export function argTypeStopRulesFor(languageId: string): ArgTypeStopRules {
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return { std: TS_STD_TYPE_NAMES, rustPositions: false };
  }
  if (languageId === "csharp") {
    return { std: CS_STD_TYPE_NAMES, rustPositions: false };
  }
  if (languageId === "python") {
    return { std: PY_STD_TYPE_NAMES, rustPositions: false };
  }
  if (languageId === "go") {
    return { std: GO_STD_TYPE_NAMES, rustPositions: false };
  }
  return { std: STD_TYPE_NAMES, rustPositions: languageId === "rust" };
}

// A name in trait-bound position (`impl Renderer`, `dyn Renderer`) is a bound
// the CALLER satisfies with some other type, never a type to construct. Position
// is the only sound test: a name list cannot do this job, because a user-defined
// trait is named nowhere but the user's own crate, and the standard trait names
// (`Item`, `Error`, `Display`) are ordinary user type names that must keep
// resolving when they appear as plain parameters.
const RUST_TRAIT_BOUND_POSITION = /\b(?:impl|dyn)\s+$/;

// A name inside a generic argument list and followed by `=` is an
// associated-type BINDING: `IntoIterator<Item = Tile>` binds `Item` to `Tile`,
// it does not ask the caller to build an `Item`.
const RUST_ASSOCIATED_BINDING = /^\s*=[^=]/;

// The one bare name with no position to read. `Self` is a reserved word, so it
// can never be a user type, and resolving it is worse than wasting the slot: it
// anchors in any file with an `impl` block and renders the receiver's own
// members under `to build a Self:`, a false statement sitting directly under a
// header that says "do not invent".
const RUST_SELF = "Self";

/** Whether `index` falls inside an unclosed generic argument list. `->` is a
 *  return arrow rather than a closing bracket, which matters for a closure
 *  trait in a parameter position (`impl Fn(u32) -> Tile`). */
function insideGenericArgs(text: string, index: number): boolean {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    if (text[i] === "<") {
      depth++;
    } else if (text[i] === ">" && text[i - 1] !== "-") {
      depth--;
    }
  }
  return depth > 0;
}

/** The PARAMETER-list text of a rendered member signature: everything between
 *  the first `(` and its matching `)`. The member's own leading name and the
 *  RETURN type both fall outside it, which is the whole point — the model
 *  receives a return value, it only has to construct an argument. A signature
 *  with no `(` (a C# property, `TileTally : int`) has no parameters; an
 *  unclosed `(` degrades to the rest of the string rather than throwing. */
function parameterText(signature: string): string {
  const open = signature.indexOf("(");
  if (open < 0) {
    return "";
  }
  let depth = 0;
  for (let i = open; i < signature.length; i++) {
    const c = signature[i];
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) {
        return signature.slice(open + 1, i);
      }
    }
  }
  return signature.slice(open + 1);
}

/** The user-defined type names appearing in PARAMETER positions across these
 *  members' signatures — the types the model must construct in order to call
 *  them. Injecting their construction surface is what moves constructor arity
 *  from wrong to right: a parameter type is never a receiver, so the member
 *  query alone never reaches it.
 *
 *  A generic's type ARGUMENT counts and its container does not, which the flat
 *  PascalCase scan gets for free: `List<Tile>` yields `Tile` because `List` is
 *  in the stop-set. Bare single-letter names are type parameters, not types.
 *  In Rust a name in `impl`/`dyn` bound position, a name bound as an associated
 *  type, and `Self` are excluded too: they read as PascalCase user types but
 *  none of them is a type the caller constructs. Deduped, first-appearance
 *  order. Never throws: a malformed signature reads as whatever it can. */
export function argumentTypeNames(members: CompletionMember[], languageId: string): string[] {
  const { std, rustPositions } = argTypeStopRulesFor(languageId);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    const params = parameterText(member.signature ?? "");
    for (const m of params.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
      const t = m[1];
      const at = m.index ?? 0;
      if (
        rustPositions &&
        (t === RUST_SELF ||
          RUST_TRAIT_BOUND_POSITION.test(params.slice(0, at)) ||
          (insideGenericArgs(params, at) && RUST_ASSOCIATED_BINDING.test(params.slice(at + t.length))))
      ) {
        continue;
      }
      // A qualified name contributes only its LAST segment: in `Atlas.Stripe` /
      // `atlas::Stripe` the leading segment is a namespace or module, and
      // resolving it reaches a wrong definition or none at all.
      if (/^(?:\.|::)[A-Za-z_]/.test(params.slice(at + t.length))) {
        continue;
      }
      if (seen.has(t) || std.has(t) || /^[A-Z]$/.test(t)) {
        continue;
      }
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** The candidate members a `.`/`::` site's already-typed `partial` leaves in
 *  play. Shared so a consumer resolving off the candidate set narrows it
 *  exactly as the render does, instead of keeping a second copy of the rule. */
export function narrowToPartial(members: CompletionMember[], partial: string): CompletionMember[] {
  return partial === "" ? members : members.filter((m) => m.name.startsWith(partial));
}

const HEADER = "available here (use one of these exact names, do not invent):";
// How many member lines the block carries. A wide receiver is real (a captured
// 49-property entity is one), so past this the block is TRUNCATED and says so
// rather than vanishing: the header forbids inventing a name, and a block that
// silently drops half the surface makes that instruction a lie.
const MAX_CANDIDATES = 40;
// Half again as wide as the block budget is not one receiver's surface any
// more; it is a mis-fire that resolved a whole scope. Truncating THAT would
// pick 40 arbitrary names out of a set that was never about the receiver, so
// the block is skipped whole. The names still travel to the gate either way.
const RUNAWAY_CANDIDATES = MAX_CANDIDATES + MAX_CANDIDATES / 2;

/** What a member-site injection resolution carries: the renderable comment
 *  block (absent when no member carries a signature or the set is too wide),
 *  and the resolved member NAMES - the enforcement set for the output gate.
 *  memberNames present-and-empty is a definitive "the receiver has no
 *  completable members"; absent means the resolution never happened. */
export interface FimInjection {
  block?: string;
  memberNames?: readonly string[];
}

/** The gate's LEGAL list, which is deliberately NOT the prompt's rendered list.
 *
 *  The prompt shows what the model can CALL: members with a signature, blanket
 *  noise dropped, tier-1 dropped at an empty partial. The gate must judge what
 *  the caller can WRITE, and that is a strictly wider set, because a server
 *  answers a `.` with more than API members. rust-analyzer serves 19 postfix
 *  snippets at every receiver (`ref`, `dbg`, `match`) and `await` at a Future
 *  one - measured live, 25 and 28 items at the two captured sites. Judging a
 *  ghost against the rendered list suppressed `.await`, and that is why Rust
 *  spent five sessions as the one language with injection and no enforcement.
 *
 *  `rendered` leads the result in order, so the two lists never disagree about
 *  a real member; `serverAnswer` contributes its keyword/postfix tail.
 *
 *  A qualified name contributes its head and its tail as well. That is the
 *  Future receiver: rust-analyzer relabels EVERY member as `await.<member>`,
 *  so `await`, `await.insert` and `insert` are all spellings a caller can
 *  reach from that receiver, and a gate holding only the middle one rejects
 *  the ghost the server itself proposed. Splitting only ever widens, so it
 *  costs a missed catch at worst and never a false suppression. */
export function memberSiteLegalNames(
  rendered: readonly CompletionMember[],
  serverAnswer: readonly CompletionMember[],
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (name: string): void => {
    if (name !== "" && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  };
  for (const m of rendered) {
    add(m.name);
  }
  for (const m of serverAnswer) {
    if (m.kind === "keyword") {
      add(m.name);
    }
  }
  for (const name of [...names]) {
    const dot = name.indexOf(".");
    if (dot > 0) {
      add(name.slice(0, dot));
      add(name.slice(dot + 1));
    }
  }
  return names;
}

// How many characters of whitespace and comment a ghost opens with, on its
// first line. Comments come from the pipeline's own masking, not a second
// parser, and the run stops at a newline.
function ghostLeadLength(ghost: string): number {
  return (/^[^\S\n]*/.exec(maskNonCode(ghost))?.[0] ?? "").length;
}

/** The member separators, as one definition rather than one per reader.
 *
 *  This exists because there were four private ideas of "separator" on one path
 *  and the narrowest of them shipped a corrupt line twice. The provider's
 *  landed-name backstop used `[.:]+`, which does not match `?.`, so at a buffer
 *  of `s?.` a ghost re-spelling `?.NAME` composed `s?.NAME?.NAME` and was
 *  served, while the `.` spelling of the same re-spelling was refused. Both
 *  spellings are ordinary at an optional-chaining site.
 *
 *  Shared by the provider's backstop. NOT shared by `fimMemberSite` and
 *  `pyMemberSite`: those disagree about `::` on purpose, because Python does not
 *  have it and the disagreement is what keeps a Python prompt from being told it
 *  does. A single detector across all four languages would change prompt bytes
 *  in three of them to fix a defect in one function.
 *
 *  A LONE `:` is not a separator. It was, briefly, and that refused
 *  `let v = c ? s.name : name;` as a re-spelling: the ternary's colon read as a
 *  separator and the branch after it read as the name spelled twice. `::` is
 *  matched whole for the same reason. */
export const SEPARATOR_RUN = /^(?:\?\s*\.|::|\.)+/;

/** The separator run at the head of `text`, with NO tolerance for anything
 *  before or between the pieces.
 *
 *  This is what a reader wants when it is stripping a separator off text that is
 *  supposed to BE a member reference: the widget's own text, or a landed line at
 *  the name's floor. */
export function separatorRunAt(text: string): { length: number; separators: string } {
  const separators = SEPARATOR_RUN.exec(text)?.[0] ?? "";
  return { length: separators.length, separators };
}

/** The same run, but tolerating whitespace and comments before and between the
 *  pieces, measured over MASKED text so a comment counts as lead.
 *
 *  Used for ONE job: deciding whether the text after a landed member name
 *  re-spells that name. `. /* c *\/ NAME(...)` is the same residue as
 *  `. NAME(...)` and a bare `\s*` saw only the second.
 *
 *  Deliberately NOT used for stripping a leading separator off member text, and
 *  the distinction is load-bearing rather than stylistic. `maskNonCode` treats
 *  `#` as a line comment in every language, because Python needs it to. So a
 *  lead-tolerant strip applied to the widget text `.#count` consumes the `#` and
 *  everything after it, leaves an EMPTY member name, and silently disarms three
 *  guards at once: the snippet check flips, the landed-name comparison becomes
 *  `"" !== ""`, and the twice-spelled test matches an empty name. That shipped
 *  `this.#countTotal + 1;` from a scope of `#count`. JS and TS private fields
 *  are ordinary code, not an exotic input. */
export function separatorRunTolerant(text: string): { length: number; separators: string } {
  const lead = (t: string): number => (/^[^\S\n]*/.exec(maskNonCode(t))?.[0] ?? "").length;
  let i = lead(text);
  let separators = "";
  for (;;) {
    const piece = SEPARATOR_RUN.exec(text.slice(i))?.[0];
    if (piece === undefined || piece === "") {
      return { length: separators === "" ? 0 : i, separators };
    }
    separators += piece;
    i += piece.length + lead(text.slice(i + piece.length));
  }
}

/** The run at the head of a scoped ghost that RE-SPELLS the member name the
 *  scope already supplies, split into the `lead` before it and the `echoed`
 *  name itself. Both are consumed by the caller; the remainder is the ghost's
 *  real contribution.
 *
 *  This lives in core rather than in the provider because two layers need the
 *  same answer at different times. The gate judges what the user would LAND, so
 *  it has to see the ghost with the echo already gone; the provider composes the
 *  item and has to remove it for real. Two implementations of this would drift,
 *  and the drift is invisible - it shows up as a correct completion silently
 *  refused.
 *
 *  Three shapes are real and they take DIFFERENT anchors, because the anchors
 *  have different safety arguments.
 *
 *  At index 0, any suffix of the name counts, longest first. That is what a
 *  cache entry minted before the widget opened contains: generated from a prompt
 *  ending at `s.en` it legitimately opens `rollTile(tile);`, and the provider
 *  itself manufactures the duplicate by prepending its own prelude. A legitimate
 *  continuation at index 0 opens with a non-identifier character, so an
 *  identifier-suffix match there cannot be one.
 *
 *  Past a lead, only the WHOLE name counts. That anchor is for a model that
 *  re-spells its own last token one space late. It cannot use the suffix rule:
 *  past a space an ordinary continuation routinely opens with an identifier, so
 *  a coincidence between the member's last letter and the continuation's first
 *  (`s.total` and ` length`, `s.sum` and ` m + n`) would eat a character of the
 *  model's text or drop the serve outright.
 *
 *  A ghost re-spelling the SEPARATOR as well as the name is deliberately NOT an
 *  anchor here, and a third one was built and removed. `s.NAME<sep>NAME` is a
 *  re-spelling and an ordinary chained call on a member of the same name at
 *  once, and nothing in the text separates them. Stripping it truncates the
 *  legitimate reading: with `next` fully typed, a ghost of `.next = null;` lands
 *  `s.next = null;` where it should land `s.next.next = null;` - a silent
 *  assignment to the wrong object, which is the failure class this project
 *  ranks worst. The caller refuses the shape outright instead, so the ambiguous
 *  case costs a serve rather than a wrong line.
 *
 *  Neither anchor can launder a sibling: stripping `enrollTile` off
 *  `enrollTileTally(...)` still lands `enrollTileTally`, which the caller's
 *  landed-name check then refuses. */
export function echoedNameRun(name: string, ghost: string): { lead: string; echoed: string } {
  for (let i = 0; i < name.length; i++) {
    const tail = name.slice(i);
    if (ghost.startsWith(tail)) {
      return { lead: "", echoed: tail };
    }
  }
  const lead = ghost.slice(0, ghostLeadLength(ghost));
  if (lead !== "" && ghost.startsWith(name, lead.length)) {
    return { lead, echoed: name };
  }
  return { lead: "", echoed: "" };
}

/** Blank out every span whose contents are text rather than code — line
 *  comments (`//` and `#`), block comments, and string/char/template literals —
 *  keeping the string's LENGTH so every offset still points where it did. A
 *  member name inside a comment or a string is prose, not a call, and an
 *  argument separator inside one does not separate arguments. An unterminated
 *  span blanks to the end: the model is mid-literal, and everything after it is
 *  unreadable rather than wrong. */
export function maskNonCode(text: string): string {
  return maskSpans(text, true);
}

/** Comments blanked, string and char literals LEFT INTACT, same length. The
 *  literals still have to be scanned or a `//` inside one would read as a
 *  comment and blank the rest of the line.
 *
 *  Exists for one question `maskNonCode` cannot answer: whether an argument list
 *  is empty. `maskNonCode` blanks literals too, so `startsWith("~~~")` and
 *  `reset(/* nothing *\/)` mask identically to nothing at all, and they are not
 *  the same call - one passes an argument and one passes none. */
export function maskComments(text: string): string {
  return maskSpans(text, false);
}

function maskSpans(text: string, blankLiterals: boolean): string {
  const out = text.split("");
  const blank = (from: number, to: number): void => {
    for (let j = from; j < to; j++) {
      out[j] = " ";
    }
  };
  const toLineEnd = (from: number): number => {
    const nl = text.indexOf("\n", from);
    return nl < 0 ? text.length : nl;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if ((c === "/" && text[i + 1] === "/") || c === "#") {
      const stop = toLineEnd(i);
      blank(i, stop);
      i = stop;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        j += text[j] === "\\" ? 2 : 1;
      }
      const stop = Math.min(j + 1, text.length);
      if (blankLiterals) {
        blank(i, stop);
      }
      i = stop;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** One member access the ghost makes on the receiver. `terminated` is the
 *  difference between a finished name and one the model is still typing: a
 *  reference with more ghost after it is complete and must match exactly, one
 *  running to the very end may still be growing. */
interface GhostRef {
  name: string;
  terminated: boolean;
}

/** A valid receiver is a plain identifier, which lets it go into a RegExp
 *  unescaped. Anything else is rejected rather than escaped: a receiver we
 *  cannot spell as an identifier is one the ghost cannot write either. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function ghostRefs(ghost: string, partial: string, receiver?: string): GhostRef[] {
  if (typeof ghost !== "string") {
    return [];
  }
  const refs: GhostRef[] = [];
  // The ghost begins immediately after `receiver.`, so its leading identifier is
  // a member reference and the already-typed `partial` is the head of that one
  // name. Read from the raw ghost: a leading comment or literal opens with a
  // non-word character, so masking could never change this answer.
  const lead = /^[\w$]+/.exec(ghost)?.[0] ?? "";
  if (lead !== "") {
    refs.push({ name: partial + lead, terminated: ghost.length > lead.length });
  }
  if (receiver === undefined || !IDENTIFIER.test(receiver)) {
    return refs;
  }
  // Every later `receiver.NAME` is another access on the same receiver, and the
  // gate holds that receiver's real member set. The lookbehind stops
  // `myStripe.` matching a `stripe` receiver.
  const later = new RegExp(`(?<![\\w$])${receiver}\\s*\\.\\s*([A-Za-z_$][A-Za-z0-9_$]*)`, "g");
  for (const m of maskNonCode(ghost).matchAll(later)) {
    const end = (m.index ?? 0) + m[0].length;
    refs.push({ name: m[1], terminated: end < ghost.length });
  }
  return refs;
}

/** Every member name the ghost accesses on the receiver, in source order.
 *  Hallucinated names are REPORTED here and judged elsewhere. With `receiver`
 *  omitted only the leading identifier is a reference, which is all a caller
 *  without a receiver name can honestly claim. Never throws. */
export function ghostMemberRefs(ghost: string, partial: string, receiver?: string): string[] {
  return ghostRefs(ghost, partial, receiver).map((r) => r.name);
}

/** The member-site output gate: with the receiver's real members in hand, a
 *  ghost whose completed identifier cannot be one of them is an invention -
 *  the injected header's "use one of these exact names" enforced, not
 *  requested. A ghost that adds no identifier characters is always consistent
 *  (punctuation continues the expression, not the member).
 *
 *  With `receiver` given, EVERY reference in a multi-line ghost is judged, not
 *  just the leading one: the reported bad experience is a first line that is
 *  plausible and a third that is invented, and a gate reading only the head
 *  waves the whole thing through. Omitted, the gate reads the leading
 *  identifier alone, exactly as it always has.
 *
 *  An empty `memberNames` rejects every identifier. That is deliberate and the
 *  CALLER's guard to make: the resolver only supplies a set when it resolved a
 *  non-empty one, because an empty set conflates a real empty receiver with an
 *  untyped one, and suppressing on absence of evidence was a measured footgun. */
export function ghostNamesMember(
  ghost: string,
  partial: string,
  memberNames: readonly string[],
  receiver?: string,
): boolean {
  // A reference followed by more text (`Enroll(`, `Enroll;`, `Enroll.`) is
  // COMPLETE and must name a member EXACTLY - a proper prefix like `Enroll` of
  // `EnrollTile` is a hallucinated call, not the real member being typed toward.
  // A reference running to the end of the ghost may still be growing, so a
  // prefix match is the honest keep.
  return ghostRefs(ghost, partial, receiver).every((ref) =>
    ref.terminated
      ? memberNames.includes(ref.name)
      : memberNames.some((m) => m.startsWith(ref.name)),
  );
}

// The receiver spellings that are NOT arguments: Python's `self` and Rust's
// borrowed or owned forms. A call site supplies none of them.
const SELF_RECEIVER = /^(?:&\s*)?(?:mut\s+)?self$/;

/** Split on the commas that actually separate arguments: depth-aware over
 *  parens, brackets, braces and generic argument lists, so a nested call, an
 *  array literal, a lambda's parameter list and `Map<string, number>` each stay
 *  one item. `<` opens a generic list only directly after a name, which keeps a
 *  less-than comparison from swallowing the rest of the text; `->` and `=>` are
 *  arrows, not closers. */
function splitTopLevel(text: string): string[] {
  const masked = maskNonCode(text);
  const parts: string[] = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  let angle = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(") {
      round++;
    } else if (c === ")") {
      round--;
    } else if (c === "[") {
      square++;
    } else if (c === "]") {
      square--;
    } else if (c === "{") {
      curly++;
    } else if (c === "}") {
      curly--;
    } else if (c === "<" && /[A-Za-z0-9_$>]/.test(masked[i - 1] ?? "")) {
      angle++;
    } else if (c === ">" && angle > 0 && masked[i - 1] !== "-" && masked[i - 1] !== "=") {
      angle--;
    } else if (c === "," && round <= 0 && square <= 0 && curly <= 0 && angle <= 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** An argument type's construction surface: the type NAME the model has to
 *  write, and the members whose signatures carry its arity. */
export interface FimArgType {
  name: string;
  members: CompletionMember[];
}

// A receiver taken BY VALUE, as against `&self`/`&mut self`. Consuming the
// receiver is what a builder step and a builder terminator do.
const OWNED_RECEIVER = /^(?:mut\s+)?self$/;

/** Whether this member could PRODUCE a `typeName`, which is the only thing a
 *  `to build a <Type>:` section should list. A member whose first parameter is a
 *  receiver needs one already and cannot make one.
 *
 *  Two exceptions, and both exist because the question is "could this produce
 *  one", not "does this take a receiver" - the receiver test is how the common
 *  case is answered, not the definition.
 *
 *  The construction member: Python spells its constructor `__init__(self, ...)`,
 *  so the receiver predicate would exclude exactly the member carrying the
 *  type's construction arity.
 *
 *  The builder chain: `Config::new().with_timeout(5).build()` is how Rust builds
 *  a type, and `build(self) -> Tile` is the member that produces one. A receiver
 *  taken by value plus a return of the type or `Self` is that shape. `&self` is
 *  deliberately not enough - `clone(&self) -> Tile` and `rehome(&self, ..) ->
 *  Tile` both need a Tile to start from, which is the circularity this filter
 *  exists to cut.
 *
 *  `byValueConsumes` is what keeps that carve-out out of Python. A bare `self`
 *  means consumption in Rust and means nothing of the sort in Python, where it
 *  is how every ordinary instance method is spelled - `rehome(self, o: Tile) ->
 *  Tile` is not a builder terminator. There is no textual discriminator between
 *  the two spellings, so the caller's language supplies it. */
function canConstruct(
  member: CompletionMember,
  typeName: string,
  byValueConsumes: boolean,
): boolean {
  if (isConstructionMember(member.name, typeName)) {
    return true;
  }
  const signature = member.signature ?? "";
  const first = splitTopLevel(parameterText(signature))[0]?.trim() ?? "";
  if (!SELF_RECEIVER.test(first)) {
    return true;
  }
  return byValueConsumes && OWNED_RECEIVER.test(first) && returnsBuiltType(signature, typeName);
}

/** Whether the signature's declared return type is the type being built.
 *  Reads the tail after the parameter list, so a return type that is itself
 *  parenthesised (`-> (Tile, u32)`) reads as no match, which is the direction
 *  that lists fewer members rather than more. */
function returnsBuiltType(signature: string, typeName: string): boolean {
  const close = signature.lastIndexOf(")");
  if (close < 0) {
    return false;
  }
  const tail = signature.slice(close + 1).trim();
  if (!tail.startsWith("->")) {
    return false;
  }
  const returned = tail.slice(2).trim();
  return returned === "Self" || returned === typeName;
}

/** The comment block to inject for the resolved members, narrowed to `partial`,
 *  or undefined when there is nothing useful to inject (no member carries a
 *  signature, or the set is so wide it cannot be one receiver's surface).
 *
 *  A receiver over the width budget but under the runaway ceiling renders the
 *  first MAX_CANDIDATES lines plus a line saying how many were cut. The
 *  enforcement set is built from the members, not from this block, so a cut name
 *  is still a legal completion.
 *
 *  `lineComment` is the token every emitted line carries, header included, so a
 *  Python buffer receives Python comments; it defaults to `//`, keeping every
 *  existing call site byte-identical. `argTypes` appends each argument type's
 *  construction surface AFTER the receiver's members — the receiver's member
 *  names were already right without it, the arity of the types those members
 *  TAKE was not.
 *
 *  The width cap counts the RECEIVER's lines only: it exists to catch a mis-fire
 *  that resolved a whole scope, and an argument type resolved by name is not
 *  that. An argTypes entry rendering no signature is skipped whole, header
 *  included, and argTypes never rescues a receiver block that rendered nothing —
 *  a construction surface with no call site to use it is noise.
 *
 *  Each argument type is filtered to what could actually produce one. The
 *  RECEIVER's own list is not: instance methods are exactly what is wanted when
 *  completing `receiver.`. */
export function renderFimCandidates(
  members: CompletionMember[],
  partial: string,
  lineComment: string = "//",
  argTypes: ReadonlyArray<FimArgType> = [],
): string | undefined {
  // Arm D (docs/architecture/surface-injection.md, "Member ordering"): at an
  // EMPTY partial the block
  // carries only the server's own-relevance tier; tier-1 blanket members leave
  // the BLOCK and nothing else — the enforcement set is the caller's and
  // always carries every name, every tier. Measured over 44 real Rust member
  // sites: arm D 79.5% top-1 vs control's 75.0%, blanket-first serves 0 vs 2.
  // Reordering-and-keeping LOST to control (70.5%): 0 of 13 wrong picks took
  // the first listed name — what sits nearest the CURSOR wins, so a blanket
  // tail hurts more than a blanket head ever did, and only dropping the tier
  // helps. A typed partial is the human already steering (someone typing `clo`
  // wants clone listed), so the narrowed set renders whole. Independent of the
  // UNIVERSAL_TRAITS viaTrait filter inside renderMemberSignatures: that one
  // classifies by label provenance, this one by the server's own ranking.
  const inPlay = narrowToPartial(members, partial);
  const signatures = renderMemberSignatures(
    partial === "" ? inPlay.filter((m) => m.tier !== 1) : inPlay,
  );
  if (signatures === "") {
    return undefined;
  }
  const lines = signatures.split("\n");
  if (lines.length >= RUNAWAY_CANDIDATES) {
    return undefined; // not one receiver's surface; do not inject a wall
  }
  const comment = (text: string): string => `${lineComment} ${text}`;
  const shown = lines.slice(0, MAX_CANDIDATES);
  const out = [comment(HEADER), ...shown.map(comment)];
  if (shown.length < lines.length) {
    // Say the list is cut. Under a header that forbids inventing a name, a
    // silently truncated list tells the model the missing members do not exist.
    out.push(comment(`... and ${lines.length - shown.length} more, not shown here`));
  }
  for (const argType of argTypes) {
    // `#` is Python and only Python (`lineCommentFor`), the one language here
    // where a bare `self` is an ordinary instance method rather than a consumed
    // receiver.
    const byValueConsumes = lineComment !== "#";
    const argSignatures = renderMemberSignatures(
      argType.members.filter((m) => canConstruct(m, argType.name, byValueConsumes)),
    );
    if (argSignatures === "") {
      continue;
    }
    out.push(comment(`to build a ${argType.name}:`), ...argSignatures.split("\n").map(comment));
  }
  return out.join("\n");
}

/** The enum-RHS block: the type's variants as comment lines under a header
 *  naming the type, or undefined when there is nothing to say (the honest
 *  degrade to plain FIM).
 *
 *  `variants` arrive already spelled the way the model has to write them
 *  (`LodBand.Regional`), which is what the cross-file resolver's `enumMemberLine`
 *  hook renders, so this joins lines rather than composing names, and the same
 *  spelling reaches the FIM prefix and a repair prompt.
 *
 *  Capped like the member block and truncated with the same line, for the same
 *  reason: under a header that forbids inventing a name, a silently cut list
 *  tells the model the missing variants do not exist. An enum wide enough to hit
 *  the cap is rare; a closed set is the whole point of the site. */
export function renderEnumVariants(
  typeName: string,
  variants: readonly string[],
  lineComment: string = "//",
): string | undefined {
  if (variants.length === 0) {
    return undefined;
  }
  const comment = (text: string): string => `${lineComment} ${text}`;
  const shown = variants.slice(0, MAX_CANDIDATES);
  const out = [
    comment(`${typeName} values (use one of these exact names, do not invent):`),
    ...shown.map(comment),
  ];
  if (shown.length < variants.length) {
    out.push(comment(`... and ${variants.length - shown.length} more, not shown here`));
  }
  return out.join("\n");
}

/** Insert an injection block on its own lines immediately before the cursor's
 *  line, matching that line's indentation, and return the new prefix. The
 *  cursor's own line (the code being completed) is untouched, so the model still
 *  sees `foo.` right before the cursor with the candidate list just above it. */
export function injectBeforeCursorLine(prefix: string, block: string): string {
  const lastNewline = prefix.lastIndexOf("\n");
  const currentLine = prefix.slice(lastNewline + 1);
  const indent = /^[ \t]*/.exec(currentLine)?.[0] ?? "";
  const indented = block
    .split("\n")
    .map((l) => indent + l)
    .join("\n");
  return prefix.slice(0, lastNewline + 1) + indented + "\n" + currentLine;
}
