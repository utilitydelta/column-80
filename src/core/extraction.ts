/**
 * Extraction interface: one language-pluggable seam over the mechanisms that
 * serve the real API surface (rust-analyzer now; rustdoc JSON / syn later, same
 * interface). Every v2 injection path reads the surface through here, so the
 * fn-gen loop and FIM candidate set never talk to a transport directly. Returns
 * plain data, never a vscode type, so core stays headless and a second language
 * is a new implementation, not a rewrite.
 */

import { dedentToZeroBase, replyBaseIndent, withoutBase } from "./reindent";

/** `text` is not an API member at all: it is VS Code's own word-based fallback
 *  item, a word scraped out of the buffer and offered when no language server
 *  bound the receiver. A transport carries those ONLY when the answer held
 *  nothing else, as evidence that the server said something and none of it was
 *  semantic; every consumer that treats the set as the receiver's legal surface
 *  drops them through `semanticMembers`.
 *
 *  `keyword` is not an API member either, but it IS something the caller may
 *  legally write at the site: the keyword and postfix completions a server
 *  serves at a `.` (rust-analyzer's `await`, and its 19 postfix snippets -
 *  `ref`, `dbg`, `match` - measured live at every Rust receiver). It renders
 *  nothing, ever, and only ever widens the output gate's legal list. */
export type MemberKind = "method" | "function" | "field" | "other" | "text" | "keyword";

/** A cursor in a source buffer, LSP coordinates (0-based line, UTF-16 column). */
export interface SourceCursor {
  uri: string;
  line: number;
  character: number;
}

/** One valid member at a `.`/`::` site. `name` is the bare member with trait
 *  provenance stripped; `viaTrait` names the trait when the member is from a
 *  trait impl, so a caller can drop universal blanket-impl noise. */
export interface CompletionMember {
  name: string;
  signature?: string;
  kind: MemberKind;
  viaTrait?: string;
  /** The SERVER's own relevance tier for this member: 0 is the receiver's
   *  own/relevant surface, 1 is the universal blanket every type grows
   *  (penalized by the server itself). Absent reads as tier 0 — only positive
   *  blanket evidence ever demotes. The discriminator is always a signal the
   *  server emitted (rust-analyzer's sortText family, Python's dunder shape,
   *  Roslyn's object-declared rendering), never a hand-written own-vs-trait
   *  name list: a plain viaTrait test would demote a human's domain trait
   *  impls along with the noise. The capture that forced the rule, the
 *  per-language discriminators and the arm results are in
 *  docs/architecture/surface-injection.md, "Member ordering". */
  tier?: 0 | 1;
  /** The provider's RAW sortText, carried as ranking EVIDENCE only — the
   *  scope-surface log line prints it so the next preselect/ranking mystery
   *  arrives with its own answer (the clone() mystery took three eliminations
   *  to close because this was invisible). Never a
   *  classifier: `tier` is the classifier, this is the observable it was
   *  derived from. Rust transports stamp it; others may. */
  sortText?: string;
  /** This member has NO signature because a fan-out CAP cut it, not because it
   *  has none to give: `"count"` when the per-type ask limit spent its slots
   *  elsewhere, `"budget"` when the ask went out and did not answer in time.
   *
   *  Set only by the hover backfill, which is the one place that knows the
   *  difference. It exists so the render can DISCLOSE the loss — a bare member
   *  is dropped by `renderMemberSignatures`, and a block that quietly ships 31
   *  of a type's 38 members is the silent-truncation failure this codebase keeps
   *  removing. Absent means the member's signature status is its own.
   *
   *  THREE CAUSES, not two. `budget` used to cover two different things: a
   *  hover that never answered inside the wall clock, and a hover that answered
   *  INSTANTLY with text the language's builder then refused (unparseable, or
   *  naming another symbol). Measured: 5 members, an instant hover returning
   *  text that names nobody, all 5 reported as `budget` with the clock never
   *  involved. Nothing vanished silently, so it
   *  was a label rather than a hole, but it sends a reader to the fan-out budget
   *  when the dial that matters is the builder. `unusable` is that case. */
  capped?: "count" | "budget" | "unusable";
  /** The 0-based line of the member's OWN declaration in the file its type is
   *  defined in, when the transport knew it. Only a documentSymbol node carries
   *  it; a member built from a completion list has none, and a caller that needs
   *  it must treat its absence as an answer rather than go looking in the text
   *  (`src/core/memberVisibility.ts`). */
  declLine?: number;
  /** The member's NAME TOKEN at its declaration - the documentSymbol
   *  `selectionRange`, carried verbatim off the node.
   *
   *  The COLUMN is the part `declLine` cannot supply, and it is what tells one
   *  declarator apart from another sharing the same line: in
   *  `private int _a; public int B;` the line says `private` for both. Present
   *  ONLY when the node carried a selection range. A node that carries only
   *  `range` points at the start of the whole declaration, so a modifier prefix
   *  sliced from there is empty, which would read a private member as
   *  unmodified - a silent drop-direction error, so that case carries the line
   *  and no column. */
  selectionRange?: { start: { line: number; character: number } };
}

/** The macro-resolved per-symbol surface hover renders: signature always, doc
 *  and example when present. This is the clean form of the human's ctrl+click,
 *  resolved through macros so the raw macro template never reaches a prompt. */
export interface HoverSurface {
  signature: string;
  doc?: string;
  example?: string;
}

export interface DefinitionLocation {
  uri: string;
  range: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
}

/** A single deterministic text rewrite: replace the bytes in `range` with
 *  `newText`. The qualify-import fix is resolved by the tool, NEVER the model, and
 *  its `range` carries a real document position, so the consumer routes by where
 *  the edit lands: it MAY be an IN-SPAN FQN rewrite (Rust/C# — `BloomFilter` ->
 *  `fastbloom::BloomFilter`, which resolves the import without an import line and
 *  keeps the function-boundary invariant) OR an IMPORTS-REGION insertion (TS and
 *  Python — `from models import X` at the top of the file). The out-of-span
 *  form rides the existing detached-consent presenter gate (offerOutOfSpanImport),
 *  never the in-span splice; the range disambiguates the two, so no `kind` field
 *  is needed. */
export interface QualifyEdit {
  range: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
  newText: string;
}

/** One occurrence of a symbol somewhere in the workspace, LSP coordinates, the
 *  range flattened into four numbers the way DefinitionLocation is not — a
 *  caller holds a LIST of these and reads them back against file text, so the
 *  nested `{start,end}` shape costs a level of indirection on every read.
 *
 *  The range is the NAME TOKEN at the use site, which is all a reference
 *  provider knows. How much code around it is a usable window (the statement,
 *  the enclosing call, N lines) is the CALLER's budget question, answered
 *  against the file, never asked of the server. */
export interface ReferenceLocation {
  uri: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
}

/** What a reference query is allowed to ask for. Every field is a HINT with a
 *  safe absent-reading, because the servers disagree about all three and a
 *  caller must never depend on one having been obeyed. */
export interface ReferenceQuery {
  /** Include the declaration itself. Default false: a declaration is not a
   *  usage, and the caller is asking how the symbol is CALLED. */
  includeDeclaration?: boolean;
  /** Stop after this many locations. A NON-POSITIVE or non-finite value is NOT
   *  a cap and returns everything, because zero results is never what a caller
   *  meant by asking the question. A caller computing remaining slots
   *  (`cap - used`) must therefore check for zero itself rather than pass it
   *  down: passing 0 asks for all of them. */
  maxResults?: number;
  /** How much of the caller's window is left, a hint. NOT honoured by any
   *  transport today: every reference query here is one round trip with nothing
   *  to bound but the caller's own race. Kept because a transport that grows a
   *  second round trip will need it, and stated so nobody reads an unhonoured
   *  field as a deadline. */
  budgetMs?: number;
}

/** The LSP `Location[]` reply of a reference query, as ReferenceLocations.
 *
 *  Every degrade is silent and empty-shaped ON PURPOSE: a reference list is
 *  evidence a caller ADDS to a prompt, so a half-parsed entry is worth less
 *  than no entry. `null` (which several servers send instead of `[]` for "no
 *  hits"), a non-array, an entry missing its uri or range, or a range missing
 *  an endpoint each drop out rather than fabricate a position that would send
 *  the caller reading the wrong bytes.
 *
 *  Truncation happens HERE, after the server answered, never as a request
 *  parameter: the LSP reference request carries no limit, so a transport that
 *  pretended to bound the server would be bounding nothing. */
export function toReferenceLocations(reply: unknown, maxResults?: number): ReferenceLocation[] {
  if (!Array.isArray(reply)) {
    return [];
  }
  const out: ReferenceLocation[] = [];
  for (const raw of reply) {
    const loc = raw as {
      uri?: unknown;
      range?: { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } };
    };
    const start = loc?.range?.start;
    const end = loc?.range?.end;
    // Number.isFinite, not typeof number: `typeof NaN` is "number", and a NaN
    // coordinate is exactly the fabricated position the paragraph above refuses
    // to pass on. No LSP server can send one (JSON has no NaN), but this is an
    // exported pure function and one transport converts its own offsets before
    // calling it. `capReferences` below already reads its input this way.
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    if (
      typeof loc?.uri !== "string" ||
      !finite(start?.line) ||
      !finite(start?.character) ||
      !finite(end?.line) ||
      !finite(end?.character)
    ) {
      continue;
    }
    out.push({
      uri: loc.uri,
      line: start.line,
      character: start.character,
      endLine: end.line,
      endCharacter: end.character,
    });
  }
  return capReferences(out, maxResults);
}

/** The same reply, as the vscode command API hands it back: `vscode.Location[]`,
 *  whose `uri` is a Uri OBJECT and whose range is a `vscode.Range` (`start`/`end`
 *  with `line`/`character`, structurally the LSP shape once the uri is a string).
 *  A provider that answers with `LocationLink[]` instead - which the definition
 *  command does whenever the client advertises linkSupport, the divergence that
 *  cost this codebase a whole field set once - is read through its target fields
 *  rather than dropped.
 *
 *  Truncation is deliberately NOT done here. The vscode command carries no
 *  `includeDeclaration` context, so the product transports drop the declaration
 *  themselves AFTER the answer arrives, and a cap applied before that drop would
 *  spend a slot on the one hit the caller asked not to have. The transports call
 *  `capReferences` last. */
export function vscodeReferenceLocations(reply: unknown): ReferenceLocation[] {
  if (!Array.isArray(reply)) {
    return [];
  }
  const out: ReferenceLocation[] = [];
  for (const raw of reply) {
    const loc = raw as {
      uri?: { toString(): string };
      range?: { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } };
      targetUri?: { toString(): string };
      targetSelectionRange?: { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } };
      targetRange?: { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } };
    };
    const uri = loc?.uri ?? loc?.targetUri;
    const range = loc?.range ?? loc?.targetSelectionRange ?? loc?.targetRange;
    const start = range?.start;
    const end = range?.end;
    if (
      uri === undefined ||
      uri === null ||
      typeof uri.toString !== "function" ||
      typeof start?.line !== "number" ||
      typeof start?.character !== "number" ||
      typeof end?.line !== "number" ||
      typeof end?.character !== "number"
    ) {
      continue;
    }
    out.push({
      uri: uri.toString(),
      line: start.line,
      character: start.character,
      endLine: end.line,
      endCharacter: end.character,
    });
  }
  return out;
}

/** `includeDeclaration: false`, enforced by the transport because its server was
 *  never asked. `vscode.executeReferenceProvider` sends no reference context at
 *  all, so every product transport gets the declaration back whether the caller
 *  wanted it or not, and the seam's contract says the flag is the TRANSPORT's to
 *  honor where the server ignores it.
 *
 *  The declaration is identified by the definition provider's own answer for the
 *  same cursor, matched on uri and start position - never by guessing which hit
 *  "looks like" a declaration. An unresolved definition drops nothing, which is
 *  the honest degrade: a caller asking how a symbol is USED is better served by
 *  one extra window than by a filter that removed a real call site on a hunch. */
export function dropDeclaration(
  locations: readonly ReferenceLocation[],
  declaration: DefinitionLocation | undefined,
): ReferenceLocation[] {
  if (declaration === undefined) {
    return [...locations];
  }
  return locations.filter(
    (l) =>
      !(
        l.uri === declaration.uri &&
        l.line === declaration.range.startLine &&
        l.character === declaration.range.startCharacter
      ),
  );
}

/** The truncation half of toReferenceLocations, for a transport whose server
 *  does not speak LSP shapes (the in-process TS service) and maps its own. A
 *  non-positive or non-finite cap is not a cap: 0 results is never what a
 *  caller meant by asking a question. */
export function capReferences(locations: ReferenceLocation[], maxResults?: number): ReferenceLocation[] {
  if (typeof maxResults !== "number" || !Number.isFinite(maxResults) || maxResults <= 0) {
    return locations;
  }
  return locations.slice(0, Math.floor(maxResults));
}

/** What the CALLER already knows about a bare type name it is asking the
 *  workspace-symbol leg to resolve. Both fields are evidence the caller read
 *  from the buffer or from a hover it already paid for, never a preference: they
 *  exist so a name declared in two namespaces can be DISAMBIGUATED instead of
 *  refused, and a resolver that cannot narrow to one namespace with them still
 *  refuses.
 *
 *  - `container`: the namespace the name was written under where the caller saw
 *    it, as the language server rendered it. Minimally qualified, so it is a
 *    SUFFIX of the declaring namespace, not necessarily the whole of it.
 *  - `fileText`: the buffer the name was written in. Its imports say which
 *    candidate namespaces an unqualified occurrence could even have meant. */
export interface TypeNameHint {
  container?: string;
  fileText?: string;
}

/** What the CALLER of `membersOfType` knows that the transport cannot: which
 *  path the answer is for. Additive and optional, so a caller that passes
 *  nothing gets the behaviour it always got. */
export interface MemberSurfaceOptions {
  /** How many members may buy a hover to recover their signature. Absent means
   *  `HOVER_SIGNATURE_CAP`, the keystroke-deadline number; the pre-fill path
   *  passes `PREFILL_HOVER_SIGNATURE_CAP`. See both constants for why they are
   *  two numbers and not one. */
  signatureCap?: number;
}

/** The language-pluggable seam: six primitives every language implements.
 *  Rust rides rust-analyzer (raExtractor / raLspClient); TypeScript rides the
 *  TS language service (tsExtractor / tsLsExtractor), same interface. */
export interface SurfaceExtractor {
  /** The member/candidate set the resolver returns AT THE CURSOR, verbatim. It
   *  does not judge whether the position is a good injection site: at a fresh,
   *  unanchored position rust-analyzer returns a wide in-scope set (100+) and
   *  this returns all of it. A non-empty result is NOT proof of a narrow,
   *  injectable scope. The caller gates on the trigger char (`.`/`::`), where the
   *  set is small and is where crate-API hallucination happens; a fresh position
   *  injects nothing. Empty means the receiver is genuinely unresolved.
   *
   *  A set made ENTIRELY of `text` members is the editor's own word-based
   *  fallback and means no server bound anything - distinct from empty, and the
   *  distinction is what tells "this file does not parse" from "this receiver
   *  has no members". Read the surface through `semanticMembers`. */
  completeMembers(cursor: SourceCursor): Promise<CompletionMember[]>;
  hoverSurface(cursor: SourceCursor): Promise<HoverSurface | undefined>;
  definition(cursor: SourceCursor): Promise<DefinitionLocation | undefined>;
  /** The canonical usage example for the type/crate at a `Type::`/`crate::`
   *  cursor, code only, fences stripped. undefined when nothing is documented.
   *  This is the payload that moves builder-crate hallucination;
   *  the resolver reaches it through a constructor's documentation. `prefer`
   *  biases candidate selection toward the type the caller actually wants (the
   *  name the compiler named), so a sibling type's example is not injected in
   *  its place - the confident-wrong hazard. */
  example(cursor: SourceCursor, prefer?: string): Promise<string | undefined>;
  /** The in-span fix for an unimported-but-resolvable name at the cursor: the
   *  fully-qualified-path rewrite from rust-analyzer's "Qualify as" assist. The
   *  compiler resolves the path deterministically, so imports never need the
   *  model. undefined when the name is genuinely unresolvable (no such symbol),
   *  which is a real hallucination for the surface loop, not an import. */
  qualifyImport(cursor: SourceCursor): Promise<QualifyEdit | undefined>;
  /** The member set of the type whose DEFINITION contains `defCursor`, read from
   *  the definition's AST via documentSymbol, with signatures — no receiver/`::`
   *  site needed. File-scoped (file-local impls only). Empty when the definition
   *  is not a struct/enum/impl container or cannot be resolved. Never throws.
   *
   *  `budgetMs` is how much of the caller's window is left. It is a hint, and
   *  the transports that need no second round trip ignore it; the two whose
   *  servers leave documentSymbol `detail` empty spend it on the hover fan-out
   *  that recovers the argument lists, and return the members that answered
   *  inside it rather than overrunning and losing the whole set. Absent means
   *  the caller is not racing anything.
   *
   *  `opts.signatureCap` is HOW MANY members may buy a hover, and it exists
   *  because the caller is the only one who knows which path this is. The
   *  transports have never been able to tell a keystroke-deadline FIM injection
   *  from a gesture a developer is waiting on, so both spent the tighter
   *  number. Absent keeps `HOVER_SIGNATURE_CAP`, so every caller that does not
   *  pass it behaves byte for byte as before. The three transports whose servers
   *  populate documentSymbol `detail` (Roslyn, rust-analyzer, gopls) ask no
   *  hovers at all and ignore it. */
  membersOfType(defCursor: SourceCursor, budgetMs?: number, opts?: MemberSurfaceOptions): Promise<CompletionMember[]>;
  /** OPTIONAL, workspace-symbol leg: resolve a bare type NAME to the cursor at
   *  its DEFINITION's name token, with NO in-span or same-file cursor required.
   *  For a collaborator named only in a doc-comment and defined in another file
   *  or project (which the pure per-file `typeReference` cannot anchor), this is
   *  the fallback that reaches its def so `membersOfType` / `resolveCrossFileShape`
   *  can read its surface. Picks the EXACT-name TYPE (class/struct/interface/
   *  enum/record), preferring a workspace (non-metadata) location; undefined when
   *  no such type exists (a partial/overloaded/non-type hit is never accepted).
   *  The C# and Go transports implement it (Go's rides gopls's
   *  workspace/symbol — same shape, cheaper hint resolution, since gopls's
   *  containerName is already a real import path); absent means the
   *  language has no workspace-symbol fallback and the caller degrades to the
   *  per-file cursor. */
  resolveTypeCursorByName?(name: string, hint?: TypeNameHint): Promise<SourceCursor | undefined>;
  /** OPTIONAL, the out-of-span AUTO-IMPORT leg (C#): the code action that adds an
   *  import DIRECTIVE at the top of the file — Roslyn's AddImport `using X;` for
   *  an unimported-but-reachable type (CS0246) — distinct from the IN-SPAN
   *  fully-qualify `qualifyImport` returns. Recognized by the action's structured
   *  AddImport tag, never English title text (isCsAddImportAction). The edit's
   *  range lands OUTSIDE the function span (the imports region, line 0), so the
   *  consumer routes it through the detached out-of-span consent gate
   *  (offerOutOfSpanImport), never the in-span splice. undefined when no
   *  unambiguous import action is offered (already imported, or genuinely
   *  unresolvable). Only the C# transports implement it: TS/Python's auto-import
   *  already rides qualifyImport's out-of-span form, and Rust qualifies in span. */
  importAction?(cursor: SourceCursor): Promise<QualifyEdit | undefined>;
  /** OPTIONAL, the chain-surface warm: the SAME surface as completeMembers but
   *  resolved to the provider order's TAIL, wide enough to reach the members
   *  the per-keystroke resolve cap can never touch (Roslyn parks the LINQ
   *  verbs at position 113 of 115 — measure-chains.md). Runs off the
   *  keystroke/deadline path only, fire-and-forget; errors degrade to [] (a
   *  background warm has nobody to tell). Only the C# product transport
   *  implements it today: rust-analyzer is eager (raEagerDetail), tsserver's
   *  surface fits the cap, pyright leads with own members, gopls has no chain
   *  receiver. */
  resolveAllMembers?(cursor: SourceCursor): Promise<CompletionMember[]>;
  /** OPTIONAL, the reference leg: where the workspace USES the symbol at the
   *  cursor, from the language server's own reference provider. The provider,
   *  not a text search, is the point: it resolves through an alias, an import
   *  rename and a re-export, and it never matches the same word on an unrelated
   *  type — which is exactly the set of mistakes a grep-shaped usage miner makes
   *  and cannot detect it made.
   *
   *  NEVER THROWS. A server that does not answer, times out, errors, or is not
   *  running returns `[]`, like every other leg here: a caller adds usage to a
   *  prompt when it has some, and degrades to the surface it already had when it
   *  does not. `[]` therefore reads as "no usage available", never as "this
   *  symbol is unused" — the two are indistinguishable from outside and no
   *  caller may spend a decision on telling them apart.
   *
   *  All three query fields are hints the SERVERS disagree about, so the
   *  contract is the transport's, not the server's: `includeDeclaration` is
   *  enforced by the transport where its server ignores the flag, `maxResults`
   *  truncates after the answer arrives (the LSP request carries no limit), and
   *  `budgetMs` is ignored by every transport whose query is one round trip,
   *  because there is nothing to bound but the caller's own race. */
  references?(cursor: SourceCursor, query?: ReferenceQuery): Promise<ReferenceLocation[]>;
}

/** Blanket-impl traits whose methods are noise at a crate-API completion site:
 *  every type grows them, none is the call the model was reaching for.
 *  Provenance from the `(as Trait)` label suffix lets us
 *  drop exactly these while keeping inherent and domain-trait members. */
const UNIVERSAL_TRAITS = new Set([
  "Clone", "Copy", "ToOwned", "Borrow", "BorrowMut", "AsRef", "AsMut",
  "From", "Into", "TryFrom", "TryInto", "PartialEq", "Eq", "PartialOrd",
  "Ord", "Hash", "Default", "Deref", "DerefMut",
]);

/** rust-analyzer's own relevance verdict, read off the completion item's
 *  sortText FAMILY: the leading hex digit, never exact values. The harvest
 *  over 44 real member sites (docs/architecture/surface-injection.md,
 *  "Member ordering") shows two
 *  families — `7fffff**` spanning `7fffffd9`-`7fffffff` (own members, with
 *  type-matched fields BOOSTED below the neutral value) and `8000000*`
 *  spanning `80000000`-`8000000b` (penalized: blanket impls, needs-import,
 *  extension traits). Matching the exact `7fffffff` silently demotes the
 *  boosted own fields — the measurement's run-1 mispartition, kept on the
 *  record as the warning. Absent sortText carries no verdict: tier 0, only
 *  positive penalty evidence ever demotes.
 *
 *  Lives in core so BOTH Rust transports stamp from the one rule — the
 *  vscode command path and the headless LSP client must produce the same
 *  tier for the same wire item, or a headless measurement inherits an
 *  unstamped surface (review-p2 finding 1). */
export function raSortTextTier(sortText: unknown): 0 | 1 {
  return typeof sortText === "string" && sortText.startsWith("8") ? 1 : 0;
}

/** Blanket-impl methods every Rust type grows from `Into`, `TryInto` and `Any`.
 *
 *  rust-analyzer returns them at a `.` site ahead of the type's own methods. A
 *  dogfood session on 2026-07-20 injected them at the top of the candidate list
 *  under a header reading "use one of these exact names, do not invent", and the
 *  model wrote `s.into()` and then `s.aggregate_fanout()` - items #1 and #2. The
 *  model obeyed; the list was wrong. `specs.js` declared them in `knownLeaks` on
 *  the reasoning that member-list noise was cosmetic, which that run refutes.
 *
 *  Matched on the blanket SIGNATURE rather than the name alone, so a type that
 *  defines its own `into(self) -> Config` keeps it. The blanket forms return a
 *  bare generic `T`, a `TryInto`-associated error, or `TypeId`; a real method
 *  returns a named type. Filtering by name alone would silently eat a user's own
 *  member, which is the same class of confident-wrong this whole feature exists
 *  to prevent.
 *
 *  The Clone/ToOwned family joined 2026-07-26 from the live tuple-site
 *  acceptance check (log_segments_cache.rs): rust-analyzer serves clone,
 *  clone_from, clone_into and to_owned with 7-LED sortText at that receiver —
 *  its TOP relevance family — so the tier rule correctly classifies them own
 *  and arm D keeps them, and the empty-partial block still led with clone.
 *  The same evidence closed the clone() preselect mystery: RA itself boosts
 *  clone there; the widget was innocent all along. Signature-anchored like
 *  the rest, verbatim from the dogfood log's shapes, so a user's OWN method
 *  named clone with a different signature (`clone(&self) -> LogHandle`)
 *  survives and renders. */
const BLANKET_IMPLS: ReadonlyArray<{ name: string; signature: RegExp }> = [
  { name: "into", signature: /->\s*T\s*$/ },
  { name: "try_into", signature: /TryInto</ },
  { name: "type_id", signature: /->\s*TypeId\s*$/ },
  { name: "clone", signature: /->\s*Self\s*$/ },
  { name: "clone_from", signature: /\(&mut self,\s*&Self\)\s*$/ },
  { name: "clone_into", signature: /<Self as ToOwned>::Owned/ },
  { name: "to_owned", signature: /->\s*<Self as ToOwned>::Owned\s*$/ },
];

/** In core beside raSortTextTier so BOTH Rust transports drop the same
 *  blanket impls from the same raw detail (triage-p3 finding 4). */
export function isRaBlanketImpl(name: string, detail: string | undefined): boolean {
  if (detail === undefined) {
    return false;
  }
  return BLANKET_IMPLS.some((b) => b.name === name && b.signature.test(detail));
}

/** The signature text a raw Rust completion item carries WITHOUT a resolve:
 *  `detail` when the server filled it, else `labelDetails.description`.
 *  rust-analyzer serves every Iterator method's full `fn` signature eagerly
 *  in the description on the UNRESOLVED item (measure-chains.md: all ~70
 *  methods at `tiles.iter().`, signatures included), so members past the
 *  resolve cap still render instead of being dropped as signatureless.
 *  Shared by both Rust transports, same discipline as the tier stamp. */
export function raEagerDetail(item: { detail?: unknown; labelDetails?: unknown }): string | undefined {
  if (typeof item.detail === "string" && item.detail.length > 0) {
    return item.detail;
  }
  const description = (item.labelDetails as { description?: unknown } | undefined)?.description;
  return typeof description === "string" && description.length > 0 ? description : undefined;
}

/** Split a completion label's trait provenance: "clone(as Clone)" -> name
 *  "clone", viaTrait "Clone". A bare label has no viaTrait. */
export function parseMemberLabel(label: string): { name: string; viaTrait?: string } {
  const match = /^(.*?)\s*\(as\s+(.+)\)\s*$/.exec(label);
  if (match) {
    return { name: stripCallParens(match[1].trim()), viaTrait: match[2].trim() };
  }
  return { name: stripCallParens(label.trim()) };
}

/** Drop the call parens rust-analyzer puts on a completion label.
 *
 *  It renders a callable's label WITH its parens when completing into empty
 *  space (`aggregate_fanout()`, `enroll_tile(…)`) and WITHOUT them when an
 *  identifier already follows the dot. The name is what `renderMemberSignature`
 *  splices the parameter list onto, so keeping them produced
 *  `aggregate_fanout()(&self) -> u32` - a signature no Rust parser or model
 *  accepts. Reported from a dogfood session on 2026-07-20, where every injected
 *  Rust signature carried two parameter lists.
 *
 *  A Rust identifier cannot contain `(`, so the first one is always the start of
 *  the parens rather than part of the name. The site-dependence is why this was
 *  invisible for so long: a fixture probing an existing call never sees it. */
function stripCallParens(name: string): string {
  const paren = name.indexOf("(");
  return paren >= 0 ? name.slice(0, paren).trim() : name;
}

/** Generic arguments rust-analyzer prints that the source never wrote, because
 *  they are defaults: `HashMap`'s `RandomState` hasher and the `Global`
 *  allocator on every collection.
 *
 *  They are not merely noise. In the dogfood run of 2026-07-20 they buried the
 *  one thing that mattered in a `HashMap<u8, Vec<&Tile, Global>, RandomState,
 *  Global>`: that `partition_by_lod` hands back `Vec<&Tile>` while
 *  `rehome_by_lod` wants `Vec<Tile>`. Both repair rounds burned on that
 *  mismatch without either the model or the reader being able to see it.
 *
 *  Only stripped after a comma inside a generic argument list, so a type the
 *  user actually named `Global` in first position survives. */
export function stripRustGenericDefaults(detail: string): string {
  return detail.replace(/,\s*(?:Global|RandomState)\b/g, "");
}

/** vscode `CompletionItemKind.Text` (the enum is 0-indexed). Not a member kind:
 *  it is the editor's own word-based fallback, offered when no provider bound
 *  anything, and the command transports carry it only as `kind: "text"`
 *  evidence. */
export const VSCODE_TEXT_KIND = 0;

/** The members that are the receiver's real API surface: everything except the
 *  editor's own word-based fallback items and the server's keyword/postfix
 *  completions. Empty after this filter means the server bound nothing, which
 *  is what every gate and renderer must key on - a receiver whose whole answer
 *  is `await` plus 19 postfix snippets bound nothing, and arming a gate on
 *  that list would reject every real member name. */
export function semanticMembers(members: readonly CompletionMember[]): CompletionMember[] {
  return members.filter((m) => m.kind !== "text" && m.kind !== "keyword");
}

/** The CALLABLE render: splice a member name onto its rust-analyzer detail type,
 *  name "contains_hash" + detail "fn(&self, u64) -> bool" ->
 *  "contains_hash(&self, u64) -> bool". undefined when detail is absent or not a
 *  function type - a data member's type is rendered by renderFieldSignature, and
 *  splicing a name over a non-`fn` detail would state a call that does not
 *  exist. */
export function renderMemberSignature(name: string, detail: string | undefined): string | undefined {
  if (detail === undefined || !/^fn\b/.test(detail)) {
    return undefined;
  }
  return detail.replace(/^fn\b/, name);
}

// The widest field type worth injecting. A real one is short
// (`HashMap<String, Vec<(u64, Duration)>>` is 37); past this the text is prose
// or an expanded associated-type chain, and it costs more block budget than the
// field is worth.
const FIELD_TYPE_MAX = 120;

/** The DATA render: a field's name and the type the server gave it,
 *  `alpha_code: u64`. Deliberately never call-shaped, which is what keeps a
 *  function-typed field (`on_tick: fn(u64) -> bool`) honest: the access is
 *  `x.on_tick`, and calling it is `(x.on_tick)(..)`. undefined when the server
 *  gave no type - a bare name is not a signature.
 *
 *  ONE LINE, always. The rendered signatures are joined and split on newlines by
 *  every consumer, so a `detail` carrying a second line would become a second
 *  candidate under a header that says these are exact names not to be invented -
 *  and the second line names nothing. A wrapped detail is collapsed to one line;
 *  a runaway one is dropped rather than truncated, because half a type is a
 *  wrong type. */
export function renderFieldSignature(name: string, detail: string | undefined): string | undefined {
  const type = detail?.replace(/\s+/g, " ").trim();
  if (name.length === 0 || type === undefined || type.length === 0) {
    return undefined;
  }
  return type.length > FIELD_TYPE_MAX ? undefined : `${name}: ${type}`;
}

/** Build a CompletionMember from a transport's raw label + detail + already-mapped
 *  kind. The kind chooses the RENDER, and that is the whole of the guard: a
 *  callable gets its parameter list spliced over the `fn`, a field gets
 *  `name: Type`. A field whose type is itself a function pointer is data, so it
 *  renders `on_tick: fn(u64) -> bool` and never `on_tick(u64) -> bool`, which
 *  would assert a call the code cannot make. Measured (rust-analyzer, 12/12
 *  fields same-file and 2/2 cross-crate): a field's type rides `detail` exactly
 *  as a method's does, so dropping it lost the whole field surface. */
export function toCompletionMember(
  label: string,
  detail: string | undefined,
  kind: MemberKind,
): CompletionMember {
  const { name, viaTrait } = parseMemberLabel(label);
  const member: CompletionMember = { name, kind };
  const signature =
    kind === "method" || kind === "function"
      ? renderMemberSignature(name, detail)
      : kind === "field"
        ? renderFieldSignature(name, detail)
        : undefined;
  if (signature !== undefined) {
    member.signature = signature;
  }
  if (viaTrait !== undefined) {
    member.viaTrait = viaTrait;
  }
  return member;
}

/** The ONE per-type member cap, shared by prepare (fnGen pre-fill) and repair
 *  (oracleSurface). A wide struct/enum must not flood the prompt past the
 *  ~350-token codegen knee; one shared cap keeps the two paths from drifting.
 *  This is the IDENTITY value of the budget profile's derivation
 *  (`memberCapFor` in budgetProfile.ts, 24 at the base budget) and a unit test
 *  pins the two equal: paths that know their model class ask
 *  `budgetProfileFor` for the live value, and this constant serves the ones
 *  with no class in reach. A LITERAL rather than the derivation call because
 *  the frozen v7 unification oracle pins this exact line. */
export const MEMBER_CAP = 24;

/** The FIM/fn-gen payload: one signature per line, name+params+
 *  return, never bare names, universal blanket-trait members dropped as noise.
 *  The return type is the load-bearing signal the 1.5b follows; a bare name is
 *  not, so a member with no rendered signature is dropped, never emitted raw. */
export function renderMemberSignatures(members: CompletionMember[]): string {
  return members
    .filter((m) => m.signature !== undefined && !(m.viaTrait !== undefined && UNIVERSAL_TRAITS.has(m.viaTrait)))
    .map((m) => m.signature)
    .join("\n");
}

/** A hierarchical documentSymbol node, the shape BOTH transports descend:
 *  `vscode.executeDocumentSymbolProvider` returns it directly, and the oracle's
 *  raw LSP `textDocument/documentSymbol` returns it once
 *  `hierarchicalDocumentSymbolSupport` is advertised. `kind` is the transport's
 *  raw SymbolKind number — the two enums differ (vscode 0-indexed vs LSP
 *  1-indexed), so each transport passes its own classifier, never a shared table. */
export interface DocumentSymbolLite {
  name?: unknown;
  detail?: unknown;
  kind?: unknown;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
  /** The name token alone, where `range` spans the whole declaration body. A
   *  second primitive asked at a member's position must land on its NAME: asked
   *  at the body's start a hover answers about whatever statement sits there. */
  selectionRange?: { start: { line: number; character: number }; end: { line: number; character: number } };
  children?: DocumentSymbolLite[];
}

/** What a documentSymbol node is, for membersOfType: `container` is the
 *  struct/enum whose members we enumerate; the rest are the collectible member
 *  kinds (a nested `container` child is not a member and is skipped). Each
 *  transport maps its raw SymbolKind number to this, since vscode's and LSP's
 *  SymbolKind enums number the same concepts differently. */
export type SymbolRole = "container" | MemberKind;

function rangeContainsCursor(
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  cursor: SourceCursor,
): boolean {
  const afterStart =
    cursor.line > range.start.line ||
    (cursor.line === range.start.line && cursor.character >= range.start.character);
  const beforeEnd =
    cursor.line < range.end.line ||
    (cursor.line === range.end.line && cursor.character <= range.end.character);
  return afterStart && beforeEnd;
}

// Strip a leading balanced `<...>` generic clause: `<T: Clone> Foo` -> ` Foo`.
// Depth-tracked so a nested `<>` inside the clause does not close it early, and
// the `>` of a return arrow is not a closer at all: `<F: FnMut() -> bool> Runner`
// would otherwise end the clause at `bool` and hand back the return type as the
// self type.
function stripLeadingGenerics(s: string): string {
  if (!s.startsWith("<")) {
    return s;
  }
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "<") {
      depth++;
    } else if (s[i] === ">" && s[i - 1] !== "-") {
      depth--;
      if (depth === 0) {
        return s.slice(i + 1);
      }
    }
  }
  return s;
}

// The substring after a top-level ` for ` (the trait-impl divider), or the whole
// string when there is none. Depth-tracked so a ` for ` inside a generic argument
// is not mistaken for the divider, with the `>` of a return arrow excluded from
// the count for the same reason `stripLeadingGenerics` excludes it.
function selfTypeAfterFor(s: string): string {
  let depth = 0;
  for (let i = 0; i + 5 <= s.length; i++) {
    const c = s[i];
    if (c === "<" || c === "(" || c === "[") {
      depth++;
    } else if ((c === ">" && s[i - 1] !== "-") || c === ")" || c === "]") {
      depth--;
    } else if (depth === 0 && s.slice(i, i + 5) === " for ") {
      return s.slice(i + 5);
    }
  }
  return s;
}

// A simple path in self-type position, anchored at the start: `Connection`,
// `crate::db::Connection`, `self::Inner`, `Foo::Bar`. Deliberately not a general
// "text before the last `::`" search — see `implSelfType`.
const SIMPLE_PATH = /^(?:[A-Za-z_][A-Za-z0-9_]*::)*[A-Za-z_][A-Za-z0-9_]*/;

/** The SELF type an `impl` block is FOR — the type whose methods it holds — not
 *  merely a type mentioned in its header. `impl From<Register> for Cohort` -> the
 *  self type is `Cohort` (NOT Register): a bare-substring match would leak
 *  Cohort's `from` into `membersOfType(Register)`, injecting a wrong-type method
 *  as ground truth. Strips the leading `impl`, any `<generics>`, and (for a trait
 *  impl) everything up to and including ` for `, then takes the LAST segment of
 *  the leading simple path: `impl crate::db::Connection` is Connection's impl,
 *  and `crate`/`self`/`super` are keywords that resolve nowhere. Likewise
 *  `impl dyn Trait` is the trait, not the keyword. A dead name is not free — it
 *  holds a prefill slot under the type cap and ships a confident evidence line.
 *
 *  The path match is anchored and must cover the whole remainder up to the first
 *  non-path character. A general last-segment rule would newly resolve
 *  `impl <T as Trait>::Assoc` to `Assoc`; an associated-type projection is not a
 *  receiver, and turning that false negative into a wrong name costs more than
 *  the miss. undefined when the name is not an impl header. */
export function implSelfType(implName: string): string | undefined {
  const trimmed = implName.trim();
  const head = /^impl\b/.exec(trimmed);
  if (!head) {
    return undefined;
  }
  let rest = stripLeadingGenerics(trimmed.slice(head[0].length).trimStart()).trimStart();
  rest = selfTypeAfterFor(rest).trimStart();
  rest = rest.replace(/^dyn\b\s*/, "");
  const path = SIMPLE_PATH.exec(rest);
  if (!path) {
    return undefined;
  }
  const segments = path[0].split("::");
  return segments[segments.length - 1];
}

/** The INNERMOST container whose range encloses `cursor`, searched over the full
 *  hierarchical tree rather than the top level, plus the sibling list it lives
 *  in. undefined when nothing encloses the cursor, and undefined when
 *  the node that does is not a container — an honest miss, never the next node
 *  out.
 *
 *  `role` decides what counts as a container and is the whole safety property,
 *  not a formality: a C# namespace encloses every method in the file, and an
 *  unfiltered walk that lands on it puts a namespace's name where a type's
 *  belongs. Callers pass their own transport's kind table.
 *
 *  Two callers want two different halves of the return value. Member gathering
 *  needs `siblings`, because a module-nested type's impls sit beside it in the
 *  module's children rather than inside the type's own. The receiver lookup
 *  wants `container` alone and discards the rest. */
export function findEnclosingContainer(
  nodes: DocumentSymbolLite[],
  cursor: SourceCursor,
  role: (kind: unknown) => SymbolRole,
): { container: DocumentSymbolLite; siblings: DocumentSymbolLite[] } | undefined {
  for (const node of nodes) {
    if (!node || !node.range || !rangeContainsCursor(node.range, cursor)) {
      continue;
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      const inner = findEnclosingContainer(node.children, cursor, role);
      if (inner) {
        return inner;
      }
    }
    if (role(node.kind) === "container") {
      return { container: node, siblings: nodes };
    }
    // Sibling ranges do not overlap, so this is the one enclosing node; it is not
    // a container and holds no nested container -> honest degrade.
    return undefined;
  }
  return undefined;
}

// Split a fn parameter list on top-level commas only, so a type's own commas
// (`HashMap<u32, Vec<u64>>`) do not split it. Tracks bracket depth across the
// four bracket pairs a rust type can nest.
function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<" || c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ">" || c === ")" || c === "]" || c === "}") {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  const last = s.slice(start);
  if (last.trim().length > 0 || parts.length > 0) {
    parts.push(last);
  }
  return parts;
}

// Strip a `name:` binding from one parameter, keeping the type: `cohort: u32`
// -> `u32`. A `self` receiver (`&self`, `&mut self`, `self`) has no `name:` and
// is returned untouched. The `:(?!:)` guard keeps a single binding colon while
// leaving a path separator (`std::io`) in the type alone.
function stripParamName(param: string): string {
  const match = /^\s*(?:mut\s+)?[A-Za-z_]\w*\s*:(?!:)\s*/.exec(param);
  return match ? param.slice(match[0].length) : param;
}

/** documentSymbol `detail` for a fn carries parameter NAMES
 *  (`fn(&self, cohort: u32) -> usize`); the completion path's detail — the form
 *  `renderMemberSignature` splices a name onto — drops them
 *  (`fn(&self, u32) -> usize`). Strip each parameter's `name:` binding (keeping
 *  the type and the `self` receiver) so a member built from documentSymbol
 *  renders byte-identically to one from completion, which transport parity
 *  requires. A non-fn detail (a field's type) is returned unchanged. */
export function normalizeSymbolDetail(detail: string | undefined): string | undefined {
  if (detail === undefined || !/^fn\b/.test(detail)) {
    return detail;
  }
  const open = detail.indexOf("(");
  if (open < 0) {
    return detail;
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < detail.length; i++) {
    if (detail[i] === "(") {
      depth++;
    } else if (detail[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) {
    return detail;
  }
  const params = splitTopLevelCommas(detail.slice(open + 1, close))
    .map((p) => stripParamName(p).trim())
    .filter((p) => p.length > 0);
  return `${detail.slice(0, open + 1)}${params.join(", ")}${detail.slice(close)}`;
}

/** Builds a CompletionMember from a documentSymbol child's raw name + detail +
 *  mapped kind. Each language passes its own: the detail text is
 *  language-shaped (rust-analyzer's `fn(...)` vs TS's `(x: T): R`), so a
 *  shared builder would render one language's members through the other's
 *  signature rules. */
export type SymbolMemberBuilder = (
  label: string,
  detail: string | undefined,
  kind: MemberKind,
) => CompletionMember;

// The Rust default: rust-analyzer symbol detail normalized to the no-param
// completion form, then the Rust toCompletionMember. A FIELD's detail is
// dropped, so only callables carry a signature here. The readers of this path
// (the whole-block walk, the arg-type construction block, fnGen's pre-fill) all
// present the list as ways to CALL the type; a field rendered `name: Type`
// there reads as a constructor and as a duplicate of the struct definition they
// already show. The member site renders fields, and it builds through
// `toCompletionMember` itself.
const rustSymbolMember: SymbolMemberBuilder = (label, detail, kind) =>
  toCompletionMember(label, kind === "field" ? undefined : normalizeSymbolDetail(detail), kind);

/** Descend a hierarchical documentSymbol[] to the members of the type whose
 *  DEFINITION contains `cursor`: the struct/enum symbol enclosing the cursor,
 *  plus its SIBLING `impl` blocks (methods live in the impl symbol, not the
 *  struct — the struct symbol only carries field children). Collect the
 *  Method/Function/Field children and map each through the calling
 *  transport's `build` (default: the Rust normalization + `toCompletionMember`
 *  the completion path uses). Empty when no struct/enum encloses the cursor (a
 *  free fn, a `use`, or a position in no symbol) — the honest degrade. Never
 *  throws. `role` classifies a raw SymbolKind number for the calling transport;
 *  impl blocks are found by NAME (`impl ` referencing the type), not kind. */
export function membersFromDocumentSymbols(
  symbols: unknown,
  cursor: SourceCursor,
  role: (kind: unknown) => SymbolRole,
  build: SymbolMemberBuilder = rustSymbolMember,
): CompletionMember[] {
  return memberSymbolsOfType(symbols, cursor, role).map(({ symbol, memberKind }) =>
    withDeclLine(
      build(
        typeof symbol.name === "string" ? symbol.name : "",
        typeof symbol.detail === "string" ? symbol.detail : undefined,
        memberKind,
      ),
      symbol,
    ),
  );
}

/** Carry the member's own declaration position off the node it was built from.
 *
 *  The node knows where the member is declared and the built member did not,
 *  which made the visibility signal unreachable downstream. It costs nothing
 *  here, and it is the ONLY honest route: the alternative is a name search of
 *  the def text, which answers from a call site, an import or a macro argument
 *  as confidently as from a declaration. Absent stays absent - a member with no
 *  position carries no line rather than a default one, because line 0 would read
 *  a stranger's declaration.
 *
 *  The name token's own range is carried WHOLE and only from `selectionRange`.
 *  A `range.start` fallback answers the LINE and no column, because it points at
 *  the head of the declaration rather than at the name, and a modifier prefix
 *  sliced from there is empty. */
export function withDeclLine(member: CompletionMember, symbol: DocumentSymbolLite | undefined): CompletionMember {
  const name = symbol?.selectionRange?.start;
  if (name !== undefined) {
    member.declLine = name.line;
    member.selectionRange = { start: { line: name.line, character: name.character } };
    return member;
  }
  const at = symbol?.range?.start;
  if (at !== undefined) {
    member.declLine = at.line;
  }
  return member;
}

/** One collectible member of the type enclosing `cursor`, paired with the
 *  documentSymbol node it came from. The node is what a caller needs to ask a
 *  SECOND primitive at the member's own position, which is the only way to a
 *  signature on a server that leaves `detail` empty. */
export interface MemberSymbol {
  symbol: DocumentSymbolLite;
  memberKind: MemberKind;
}

/** The member nodes of the type enclosing `cursor`: the container's own
 *  children, plus the children of every sibling impl block whose self type is
 *  that same type (Rust splits a type across a struct node and its impls). */
export function memberSymbolsOfType(
  symbols: unknown,
  cursor: SourceCursor,
  role: (kind: unknown) => SymbolRole,
): MemberSymbol[] {
  if (!Array.isArray(symbols)) {
    return [];
  }
  const found = findEnclosingContainer(symbols as DocumentSymbolLite[], cursor, role);
  if (!found) {
    return [];
  }
  const { container, siblings } = found;
  const typeName = typeof container.name === "string" ? container.name : "";
  const collected: DocumentSymbolLite[] = [...(container.children ?? [])];
  for (const s of siblings) {
    if (s === container || !s || typeof s.name !== "string" || !typeName) {
      continue;
    }
    // The impl's SELF type must EQUAL the queried type, not merely appear in the
    // header: `impl From<Register> for Cohort` is Cohort's impl, not Register's.
    if (implSelfType(s.name) === typeName) {
      collected.push(...(s.children ?? []));
    }
  }
  const out: MemberSymbol[] = [];
  for (const symbol of collected) {
    if (!symbol) {
      continue;
    }
    const memberKind = role(symbol.kind);
    if (memberKind === "container") {
      continue; // a nested type is not a member of this container
    }
    out.push({ symbol, memberKind });
  }
  return out;
}

/** The NAME of the type enclosing `cursor`, or undefined when nothing does.
 *
 *  `memberSymbolsOfType` already finds that container and then throws its
 *  identity away, because every caller until now wanted the members and not the
 *  name. The measurement rig wants both: it feeds `resolvePrefill` a translated
 *  symbol tree, and a re-derived translation is this project's classic silent
 *  defect - so the rig CHECKS its translation against this function, which
 *  reads the LSP kind table directly.
 *
 *  Symbol tree, never text. A regex walking up from the cursor for the nearest
 *  `class X` answers from a comment, a string literal or a `nameof` as
 *  confidently as from a declaration, and this codebase's standing rule is that
 *  a signature may DETECT and only the symbol tree may RESOLVE an enclosing
 *  scope. */
export function enclosingTypeName(
  symbols: unknown,
  cursor: SourceCursor,
  role: (kind: unknown) => SymbolRole,
): string | undefined {
  if (!Array.isArray(symbols)) {
    return undefined;
  }
  const found = findEnclosingContainer(symbols as DocumentSymbolLite[], cursor, role);
  const name = found?.container.name;
  return typeof name === "string" && name !== "" ? name : undefined;
}

/** The word around `character`, over `[A-Za-z0-9_]`. Empty when the position
 *  sits on punctuation, on whitespace, or past the end of the line. */
function identifierAt(lineText: string, character: number): string {
  const isWord = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c);
  let start = character;
  while (start > 0 && isWord(lineText[start - 1])) {
    start--;
  }
  let end = character;
  while (end < lineText.length && isWord(lineText[end])) {
    end++;
  }
  return lineText.slice(start, end);
}

/** The identifier a container's reported name starts with: `Box<T>` -> `Box`,
 *  `Tile : ITile` -> `Tile`, `@class` -> `class`. Servers decorate a container
 *  name with whatever they feel like - Roslyn hands back the generic clause and
 *  suffixes a member's type - and a cursor's word never carries any of it, so
 *  the two are compared at the identifier head or not at all. */
function bareContainerName(name: unknown): string {
  if (typeof name !== "string") {
    return "";
  }
  const head = /^@?([A-Za-z_]\w*)/.exec(name.trim());
  return head ? head[1] : "";
}

/** The words a C# declaration is built out of, as opposed to the type names it
 *  references. Lowercase and compared case-sensitively: every C# keyword is
 *  lowercase and type names are not, so the only thing this misses is a type
 *  genuinely named `record`, and it misses it in the safe direction (no
 *  refusal). Kept deliberately generous - a word wrongly listed here costs the
 *  refusal one shape, a word wrongly absent costs a correct surface. */
const CS_SYNTAX_WORDS = new Set([
  "abstract", "as", "async", "base", "bool", "byte", "char", "class", "const", "decimal", "default",
  "delegate", "double", "dynamic", "enum", "event", "explicit", "extern", "false", "file", "float",
  "get", "global", "implicit", "in", "init", "int", "interface", "internal", "is", "long", "nameof",
  "namespace", "new", "nint", "notnull", "nuint", "null", "object", "operator", "out", "override",
  "params", "partial", "private", "protected", "public", "readonly", "record", "ref", "required",
  "sbyte", "scoped", "sealed", "set", "short", "static", "string", "struct", "this", "true",
  "typeof", "uint", "ulong", "unmanaged", "unsafe", "ushort", "using", "value", "var", "virtual",
  "void", "volatile", "when", "where",
]);

/** Did a by-name type resolution reach the tree of some OTHER declaration?
 *
 *  `memberSymbolsOfType` cannot tell, because it only asks which container
 *  encloses the cursor. Two different callers ask it: "what type am I writing
 *  inside", where the enclosing class IS the answer, and "what is the surface
 *  of the type named X", where it is not. When a language server answers an X
 *  reference with the REFERENCE's own position, the second question gets the
 *  first question's answer: the members of whatever class the reference was
 *  written in, rendered under a header reading `to build a X:`. That is a false
 *  statement the model then follows, and it is worse than injecting nothing.
 *
 *  A correct resolution lands on the named type's own NAME TOKEN. Everything
 *  else inside a container is some other declaration's business, so the test is:
 *
 *   1. The cursor sits on an IDENTIFIER. A member site (`stripe.|`) sits on
 *      none, and that is the shape the first caller asks from - it must not be
 *      refused.
 *   2. That identifier is not the enclosing container's own name, compared at
 *      the identifier head so `Box` still answers a container Roslyn reports as
 *      `Box<T>`.
 *   3. That identifier is not a C# syntax word. This is what keeps a server
 *      answering a whole-declaration span honest: asked for `Tile`, an answer
 *      at character 0 of `public class Tile` lands on `public`, which is not a
 *      reference to anything and must not cost the surface.
 *
 *  A MEMBER's range is not consulted, and that is the correction. It used to be
 *  the third fact, on the ground that the declaration head sits outside every
 *  member and is therefore safe. It is not: a base list, a primary-constructor
 *  parameter, a generic constraint and an attribute all name OTHER types in the
 *  head, and Roslyn (2.140.9, measured) emits no child covering any of them -
 *  no constructor child for `class Seeded(Tile seed)` at all, and an attributed
 *  class's range starts at the attribute. Those five shapes rendered the
 *  enclosing class under `to build a Tile:` with the refusal watching.
 *
 *  The symbol tree resolves the scope and the text only supplies the word under
 *  the cursor - the standing split this file's `enclosingTypeName` states. No
 *  line text means no identifier evidence, which is not evidence of a wrong
 *  tree: false, and the caller keeps the behaviour it always had. */
export function resolutionReachedWrongTree(
  symbols: unknown,
  cursor: SourceCursor,
  role: (kind: unknown) => SymbolRole,
  lineText: string | undefined,
): boolean {
  if (!Array.isArray(symbols) || lineText === undefined) {
    return false;
  }
  const word = identifierAt(lineText, cursor.character);
  if (word === "" || CS_SYNTAX_WORDS.has(word)) {
    return false;
  }
  const found = findEnclosingContainer(symbols as DocumentSymbolLite[], cursor, role);
  return found !== undefined && word !== bareContainerName(found.container.name);
}

/** One workspace-symbol hit reduced to what a by-name type resolution needs.
 *  The transport-neutral sibling of `CsSymbolCandidate` / `GoSymbolCandidate`:
 *  the raw vscode and LSP hit shapes differ, and so do their SymbolKind enums,
 *  so each transport maps its own hits before selecting over them. */
export interface WorkspaceSymbolCandidate {
  name: string;
  role: SymbolRole;
  /** Whatever the server reports the hit as living in. Empty when absent. Read
   *  for INEQUALITY and for a caller's hint, never parsed: no server spells
   *  this the same way. Roslyn writes a project display string, gopls writes a
   *  real import path, and tsserver and pyright leave it empty for a top-level
   *  type and fill it with the enclosing class for a nested one. */
  containerName: string;
  uri: string;
  line: number;
  character: number;
}

/** Reduce a raw workspace-symbol answer to candidates, through the calling
 *  transport's own SymbolKind mapper. Both hit shapes are accepted because
 *  they differ in exactly one field: vscode hands a `Uri` object and the LSP
 *  wire hands a string. A hit missing a name, a location or a start position
 *  is dropped rather than defaulted - a candidate at line 0 of nowhere would
 *  resolve to a stranger's declaration. Never throws; a non-array answer is no
 *  candidates. */
export function workspaceSymbolCandidates(
  raw: unknown,
  role: (kind: unknown) => SymbolRole,
): WorkspaceSymbolCandidate[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return (raw as Array<{
    name?: unknown;
    kind?: unknown;
    containerName?: unknown;
    location?: { uri?: unknown; range?: { start?: { line?: unknown; character?: unknown } } };
  }>).flatMap((s) => {
    const rawUri = s?.location?.uri;
    const uri =
      typeof rawUri === "string"
        ? rawUri
        : typeof (rawUri as { toString?: unknown })?.toString === "function"
          ? String(rawUri)
          : undefined;
    const start = s?.location?.range?.start;
    if (
      typeof s?.name !== "string" ||
      // A URI must carry a scheme. Object.prototype.toString answers
      // "[object Object]" for anything, so a shape check is what tells a real
      // vscode Uri from a bare object that merely inherits a toString.
      uri === undefined ||
      !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri) ||
      typeof start?.line !== "number" ||
      typeof start?.character !== "number"
    ) {
      return [];
    }
    return [
      {
        name: s.name,
        role: role(s.kind),
        containerName: typeof s.containerName === "string" ? s.containerName : "",
        uri,
        line: start.line,
        character: start.character,
      },
    ];
  });
}

/** Pick the def cursor for a bare type NAME from workspace-symbol candidates,
 *  for a language where one name means one type. The `selectCsTypeCursor`
 *  sibling, and STRICTER than it on purpose: C# has to let several hits through
 *  because a `partial class` is one type split across files, and Go has to
 *  compare import paths. TypeScript and Python have neither, so two distinct
 *  declaration sites for one name are two different things and there is no
 *  textual way to say which the caller meant.
 *
 *  Every server that answers `workspace/symbol` answers it FUZZY - a query for
 *  "Tile" also returns TileSite, tileFromMorton, every test naming it - so the
 *  exact-name TYPE filter is what makes the answer mean anything.
 *
 *  AMBIGUITY IS REFUSED, not tiebroken, unless the caller brought evidence.
 *  A `hint.container` the caller already saw the name written under decides it;
 *  a container matching two candidates, or none, decides nothing. Honest
 *  no-resolution beats a wrong surface. */
export function selectSoleTypeCursor(
  candidates: WorkspaceSymbolCandidate[],
  name: string,
  hint?: TypeNameHint,
): SourceCursor | undefined {
  const exact = candidates.filter((c) => c.name === name && c.role === "container");
  // A server may report one declaration twice (pyright answers a stub and its
  // implementation for the same name). Identical positions are one hit.
  const distinct: WorkspaceSymbolCandidate[] = [];
  for (const c of exact) {
    if (!distinct.some((d) => d.uri === c.uri && d.line === c.line && d.character === c.character)) {
      distinct.push(c);
    }
  }
  if (distinct.length === 1) {
    return { uri: distinct[0].uri, line: distinct[0].line, character: distinct[0].character };
  }
  const container = hint?.container;
  if (distinct.length === 0 || container === undefined || container === "") {
    return undefined;
  }
  const survivors = distinct.filter(
    (c) => c.containerName === container || c.containerName.endsWith(`.${container}`),
  );
  return survivors.length === 1
    ? { uri: survivors[0].uri, line: survivors[0].line, character: survivors[0].character }
    : undefined;
}

/** How many members one `membersOfType` call may buy a signature for through a
 *  second per-member round trip. This is a COUNT ceiling, deliberately set high
 *  enough that it is NOT the binding constraint for a realistic type: the fan-out
 *  COST is bounded by `HOVER_FANOUT_BUDGET_MS` (50ms, the wall-time that actually
 *  protects the injection window) and the rendered SURFACE is bounded by the
 *  whole-block char budget (`DATASHAPE_TOTAL_TOK * 4`), which drops any line that
 *  would overrun. The count cap exists only to keep the fan-out from dispatching
 *  an unbounded number of requests at a pathological type.
 *
 *  It used to be 8, and that was doing two jobs. Measured in a real extension host
 *  over the dogfood repos, parallel hover at a member's position costs, per member
 *  set size: 4 -> 6ms, 8 -> 11ms, 12 -> 17ms, 16 -> 22ms, 24 -> 32ms, 32 -> 44ms
 *  for TypeScript (LINEAR - tsserver answers one request at a time, so "parallel"
 *  buys overlap of the transport hop and nothing else), and a flat ~5ms at every
 *  size for Python. At 8, that cost fit the window; but 8 also CAPPED THE SURFACE
 *  at eight lines, and a 16-member type in play showed only half of itself. That
 *  surface cap was never the server's - it was ours, and it leaked the cost
 *  control into what the block was allowed to say.
 *
 *  Raising it to 32 unbinds the surface without moving the latency bound: the
 *  50ms fan-out budget still races every ask, so a cold TypeScript walk still
 *  spends at most the window and delivers whatever landed inside it (the rest stay
 *  bare, exactly as at 8); a warm walk, and Python at any warmth (flat ~5ms),
 *  deliver up to the full type. The whole-block injection is cached per
 *  file-version, so the fan-out cost is paid once per edit. What is NOT yet
 *  proven headlessly - the fake hover in the blind oracle answers instantly - is
 *  how many signatures a warm TypeScript walk actually DELIVERS within the window
 *  at a large type; that is a live-tier measurement (Xephyr + real tsserver),
 *  recorded as a delegate. The floor is guaranteed: never fewer than the old 8.
 *
 *  A member past the cap, or past the char budget, is ABSENT from the rendered
 *  block, not present with a bare name: renderMemberSignatures drops any member
 *  with no signature, so on TypeScript and Python that costs the whole line, and
 *  the omission is silent rather than wrong. */
export const HOVER_SIGNATURE_CAP = 32;

/** The same cap on the PRE-FILL path, which is a different path with a different
 *  clock, ruled 2026-08-11 and split from the constant above rather than moving
 *  it.
 *
 *  WHY THE TWO CANNOT SHARE A NUMBER. The constant above is spent against a
 *  KEYSTROKE: the FIM whole-block injection races a 50ms window while a
 *  developer is typing, and everything it does not deliver inside that window is
 *  gone. The pre-fill path is spent against a GESTURE a developer explicitly
 *  asked for and then waits on, and its own legs already cost hundreds of
 *  milliseconds. The two clocks are orders apart (`injection-legs-differ-by-orders`),
 *  and one number serving both was serving the tighter one.
 *
 *  WHY 48, MEASURED. Against the real Python population (11 classes across
 *  `mcp-graph-engine` and `debate-event-store`), 32 cuts 6 members off exactly
 *  one class, `GraphEngine` at 38, and 48 cuts nothing anywhere. It is sized to
 *  the population it serves, and it is not the latency bound either: the asks
 *  race one shared `HOVER_FANOUT_BUDGET_MS` deadline rather than running in
 *  sequence, and the whole 32-member fan-out on that class measures 4ms warm.
 *
 *  WHY A COUNT CAP SURVIVES A TIME CAP AT ALL, which is the question the split
 *  raises and which was answered with prose until 2026-08-11. The reasoning was:
 *  the time bound protects the DEVELOPER and nothing protects the SERVER, since
 *  `withinBudget` races each ask against a shared deadline and abandons the
 *  RESULT, not the WORK, so every request it gave up on is still queued and
 *  still competes with whatever the editor asks for next.
 *
 *  MEASURED, and it does not hold on the one server that can be driven here.
 *  A probe runs two alternating arms against a real pyright, timing the NEXT
 *  request (a hover in a different file) that lands the instant a fan-out
 *  returns. Its design and full table are in
 *  docs/architecture/surface-injection.md, "Does a count cap buy the server
 *  anything a time cap does not?":
 *
 *    class            arm      fan-out   next request (median / p95 / max)
 *    GraphEngine, 38  cap 4      1ms       0ms / 1ms / 1ms
 *    GraphEngine, 38  cap 64     3ms       0ms / 1ms / 1ms
 *    synthetic, 400   cap 4      4ms       0ms / 1ms / 1ms
 *    synthetic, 400   cap 400   14ms       0ms / 1ms / 1ms
 *
 *  400 hovers cost 14ms, so the 50ms deadline never cuts and nothing is ever
 *  abandoned: the hazard the count cap exists for is UNREACHABLE on this server
 *  at any population, real or synthetic. On pyright the cap is bounding
 *  something that costs nothing.
 *
 *  What that does NOT settle, said plainly rather than left implied: the numbers
 *  are WARM (roadmap item 45 owns the cold row), they are headless pyright and
 *  not Pylance, and TypeScript's fan-out lives in the vscode transport, which
 *  needs a real extension host and was not measured. tsserver is the slower of
 *  the two and is where a deadline would cut first. So the cap stays, sized to
 *  the population, and its server-load justification is measured false on
 *  Python and untested on TypeScript.
 *
 *  With a field walk live, every capped member is a lost EDGE and not only a
 *  lost line, so the cost of leaving the cap low is higher than it was. */
export const PREFILL_HOVER_SIGNATURE_CAP = 48;

/** How long one `membersOfType` call may spend on its hover fan-out before it
 *  returns what has answered and leaves the rest bare.
 *
 *  This is a SETTLE GUARANTEE, not a budget, and it cannot behave as one: the
 *  fan-out runs inside the injection window, whose own deadline is 50ms and
 *  which the receiver's member resolution has already spent part of, so the
 *  caller's race always cuts first. Nothing here binds; if the fan-out needs
 *  bounding, the bound belongs to whoever owns the remaining window.
 *
 *  50ms is INJECTION_DEADLINE_MS (src/core/completionService.ts), and that is
 *  the derivation: an answer that arrives after a full injection deadline
 *  cannot be used by any injection, so past that point the fan-out is only
 *  holding a promise open. The bound exists to make the call always SETTLE -
 *  a bare `Promise.all` over a hover that never answers never does, and the
 *  injection's own race abandons the RESULT rather than the work, so the
 *  promise outlives the keystroke that asked for it.
 *
 *  It is deliberately not tuned to the p50. Measured in a real extension host
 *  over the dogfood repos, `membersOfType` end to end (documentSymbol plus an
 *  eight-member fan-out) costs: TypeScript 15-16ms warm with cold first calls
 *  at 33ms and 51ms, Python 10-14ms, C# 4-6ms (Roslyn populates detail, so no
 *  hover is asked at all). A 20ms budget was tried against those same servers
 *  and clipped a COLD TypeScript fan-out, returning `encloses` and
 *  `subtendedChildren` bare - a working server losing signatures to a timeout
 *  is the darkness this whole leg exists to remove. */
export const HOVER_FANOUT_BUDGET_MS = 50;

/** The members of the type enclosing `cursor`, with the signatures a
 *  documentSymbol descent could not supply filled in by asking a second
 *  primitive at each member's own name token.
 *
 *  Real vscode leaves `detail` empty on every documentSymbol node for
 *  TypeScript and Python, so a transport reading `detail` alone renders member
 *  names with no argument list and the construction surface it feeds cannot say
 *  how to call anything. C# (Roslyn) and Rust (rust-analyzer) DO populate
 *  `detail`; a member that already carries a signature is never asked about, so
 *  those two spend no round trips here at all.
 *
 *  The asks fan out rather than running in sequence: sequence multiplies one
 *  server round trip by the member count and blows the injection window. A
 *  member whose ask fails or answers nothing keeps its bare name - a missing
 *  argument list is a degrade, an invented one is the defect. */
export interface HoverBackfillOptions {
  /** Which built members survive. Applied BEFORE the fan-out so a member the
   *  transport discards never buys a hover. */
  keep?: (member: CompletionMember) => boolean;
  /** Override HOVER_SIGNATURE_CAP. */
  cap?: number;
  /** Override HOVER_FANOUT_BUDGET_MS. */
  budgetMs?: number;
}

/** The one place a transport turns its two optional `membersOfType` arguments
 *  into fan-out options. Four transports would otherwise each spell the same
 *  three-way merge, and a fifth added later would spell it differently. Two
 *  separate defects have already been traced back to one leg being wired
 *  slightly unlike its siblings.
 *
 *  Absent stays absent, never a written-in default, so `membersWithHoverSignatures`
 *  keeps deciding what a missing option means. */
export function hoverBackfillOptions(
  budgetMs: number | undefined,
  opts: MemberSurfaceOptions | undefined,
  base: HoverBackfillOptions = {},
): HoverBackfillOptions {
  const merged: HoverBackfillOptions = { ...base };
  if (budgetMs !== undefined) {
    merged.budgetMs = budgetMs;
  }
  if (opts?.signatureCap !== undefined) {
    merged.cap = opts.signatureCap;
  }
  return merged;
}

export async function membersWithHoverSignatures(
  symbols: unknown,
  cursor: SourceCursor,
  role: (kind: unknown) => SymbolRole,
  build: SymbolMemberBuilder,
  hoverSignatureAt: (at: SourceCursor) => Promise<string | undefined>,
  options: HoverBackfillOptions = {},
): Promise<CompletionMember[]> {
  const { keep, cap = HOVER_SIGNATURE_CAP, budgetMs = HOVER_FANOUT_BUDGET_MS } = options;
  const kept = memberSymbolsOfType(symbols, cursor, role)
    .map((ms) => ({
      ...ms,
      member: withDeclLine(
        build(
          nameOf(ms.symbol),
          typeof ms.symbol.detail === "string" ? ms.symbol.detail : undefined,
          ms.memberKind,
        ),
        ms.symbol,
      ),
    }))
    // Discarded AFTER the fan-out, a member the transport was always going to
    // drop still spends one of the cap's slots, and the cap is small enough
    // that a spent slot is another member left bare.
    .filter((x) => keep === undefined || keep(x.member));
  const members = kept.map((x) => x.member);
  // Which unsigned members get a hover slot when the cap binds. Taken in pure
  // descent order this lets declaration order decide the whole surface: a type
  // whose fields are declared before its methods spends every slot on fields and
  // renders no callable, which is the inverse of what a "how to build one" block
  // is for. So the slots are dealt round-robin between callables and the rest,
  // and neither kind can be wholly starved while the other has takers. For a
  // type with <= cap unsigned members every eligible member is asked regardless
  // of kind, so this is a no-op below the cap and only bites when the cap
  // actually binds.
  const eligible: number[] = [];
  for (let i = 0; i < members.length; i++) {
    if (members[i].signature === undefined && positionOf(kept[i].symbol) !== undefined) {
      eligible.push(i);
    }
  }
  const isCallable = (i: number) => members[i].kind === "method" || members[i].kind === "function";
  const callables = eligible.filter(isCallable);
  const others = eligible.filter((i) => !isCallable(i));
  const asked: number[] = [];
  for (let c = 0, o = 0; asked.length < cap && (c < callables.length || o < others.length); ) {
    if (o < others.length) {
      asked.push(others[o++]);
    }
    if (asked.length < cap && c < callables.length) {
      asked.push(callables[c++]);
    }
  }
  asked.sort((a, b) => a - b);
  const answers = await withinBudget(
    asked.map(async (i) => {
      const at = positionOf(kept[i].symbol);
      try {
        return at && (await hoverSignatureAt({ uri: cursor.uri, line: at.line, character: at.character }));
      } catch {
        return undefined;
      }
    }),
    budgetMs,
  );
  // Which asked members got an ANSWER, whatever became of it. The difference
  // between "the clock ran out" and "the reply was refused" is only knowable
  // here, and downstream all that survives is a member with no signature.
  const answered = new Set<number>();
  asked.forEach((memberIndex, askIndex) => {
    const signature = answers[askIndex];
    if (!signature || signature.trim().length === 0) {
      return;
    }
    answered.add(memberIndex);
    const { symbol, memberKind } = kept[memberIndex];
    const rebuilt = build(nameOf(symbol), oneLine(signature), memberKind);
    // Two refusals, both degrading to the bare name the member already has.
    // The builder is the language's own renderer, so a hover string it cannot
    // parse into a signature comes back bare; swapping that in would trade a
    // name for nothing. And a signature that does not name this member is about
    // some other symbol, which the injected block would state as this member's
    // declaration.
    if (rebuilt.signature !== undefined && declares(rebuilt.signature, members[memberIndex].name)) {
      members[memberIndex] = rebuilt;
    }
  });
  // MARK WHAT THE CAPS COST, because a member that comes back bare is DROPPED by
  // the renderer and the block says nothing about it.
  //
  // This is the failure class the goal makes Python's ship condition: "a member
  // past either cap is absent from the block with no marker ... Either the cap
  // reports what it dropped, on the channel, the way the walk already reports
  // its own drops, or Python does not ship." Measured on the phase 0 baseline's
  // own type: `membersOfType(GraphEngine)` answers 38 members and the block
  // renders 31. Seven members vanish and every number downstream is a silent
  // lower bound.
  //
  // The mark is placed HERE and not at the renderer because only this function
  // knows WHY a member is bare: it was never asked (the count cap dealt its
  // slots elsewhere), or it was asked and did not answer inside the budget.
  // Downstream all that survives is the absence of a signature, which a
  // genuinely signature-less member has too.
  const askedSet = new Set(asked);
  for (let i = 0; i < members.length; i++) {
    if (members[i].signature !== undefined || positionOf(kept[i].symbol) === undefined) {
      continue; // signed, or never eligible for a hover at all — not a cap loss
    }
    const cause = !askedSet.has(i) ? "count" : answered.has(i) ? "unusable" : "budget";
    members[i] = { ...members[i], capped: cause };
  }
  return members;
}

/** Settle every ask, or the budget, whichever comes first. One shared deadline
 *  is raced against each ask individually, so the members that DID answer keep
 *  their signatures and only the outstanding ones fall back to bare names -
 *  an all-or-nothing timeout would throw away work already paid for. The timer
 *  is cleared once the asks settle: this runs per keystroke, and a pending
 *  timer per call is a leak even at 20ms. */
async function withinBudget<T>(asks: Promise<T | undefined>[], budgetMs: number): Promise<(T | undefined)[]> {
  if (asks.length === 0) {
    return [];
  }
  let clear = () => {};
  const expired = new Promise<undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), budgetMs);
    clear = () => clearTimeout(timer);
  });
  try {
    return await Promise.all(asks.map((ask) => Promise.race([ask, expired])));
  } finally {
    clear();
  }
}

const nameOf = (symbol: DocumentSymbolLite) => (typeof symbol.name === "string" ? symbol.name : "");

/** Does a rendered signature declare `name` at all? The backfill asks a hover at
 *  a position derived from the member's own node, and nothing binds the server's
 *  answer to that node: a member whose `selectionRange` is absent is asked at
 *  the start of its whole declaration range, and a language renderer that cannot
 *  slice the member's declaration out of a quickinfo passes the quickinfo
 *  through whole. Either way the block would print another symbol's declaration
 *  under this member's name, which the model reads as fact. Requiring the name
 *  to appear as a whole token is the weakest check that refuses that, and it
 *  costs a legitimate signature nothing: every language's rendered form states
 *  the member it declares. */
function declares(signature: string, name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(signature);
}

/** Flatten a hover signature onto one line. A signature is rendered one per line
 *  into a comment block, so an embedded newline turns one member into several
 *  block lines - which pads the prompt and can push the block past the
 *  candidate-count gate that decides whether it is injected at all. Pylance is
 *  the case that needs this: it pretty-prints a wide `def` across five lines. */
function oneLine(signature: string): string {
  return signature.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
}

function positionOf(
  symbol: DocumentSymbolLite | undefined,
): { line: number; character: number } | undefined {
  return symbol?.selectionRange?.start ?? symbol?.range?.start;
}

/** Completion names that are std/blanket-trait methods carrying no crate-specific
 *  worked example: injecting Clone's `let hello = "Hello"; ...hello.clone()` in
 *  place of a builder constructor is worse than injecting nothing (a wrong-shape
 *  example is a falsification bar). Used only when provenance is absent - when the
 *  `(as Trait)` label is present, the trait itself is the stronger signal. `from`
 *  and `try_from` are deliberately NOT here: they may be the crate's real
 *  constructor, so those get the constructor tier, never a name-denylist. */
const STD_EXAMPLE_DENYLIST = new Set([
  "clone", "to_owned", "clone_into", "extend", "borrow", "borrow_mut",
]);

/** Blanket traits that CAN be a crate's real construction path, so their members
 *  are kept (not filtered as noise) and given the constructor tier: `From`/
 *  `TryFrom` conversions and `Default::default` are legitimate ways to build the
 *  type. Everything else in UNIVERSAL_TRAITS (Clone/ToOwned/Borrow/Into/...) is
 *  noise at a construction site. */
const CONSTRUCTION_TRAITS = new Set(["From", "TryFrom", "Default"]);

/** The universal traits whose members are pure noise at a construction site:
 *  UNIVERSAL_TRAITS minus the construction-capable ones. A member via one of these
 *  never carries the construction example the model needs. */
const EXAMPLE_NOISE_TRAITS = new Set(
  [...UNIVERSAL_TRAITS].filter((t) => !CONSTRUCTION_TRAITS.has(t)),
);

/** A builder/primary constructor name: the entry the model actually needs for an
 *  E0599 on an invented associated function - `BloomFilter::with_num_bits(1024)`,
 *  `File::open`, `TcpStream::connect`, `Foo::build`. Prefix-style names
 *  (`new_for`, `with_num_bits`, `try_new_in`) plus the idiomatic whole-word
 *  constructors, boundary-anchored so `opener`/`parser`/`connection` are not
 *  mistaken for constructors. These outrank every other candidate below the prefer
 *  tier. */
const BUILDER_CONSTRUCTOR_NAME =
  /^(new|with_|try_new|default|builder)|^(open|create|connect|build|make|load|parse)(_|$)/;

/** A from-conversion constructor name (`from`, `from_vec`, `try_from_bytes`).
 *  Still a real constructor that outranks a plain method, but its example is
 *  method-shaped next to the builder's, so it sits below the builder tier. */
const FROM_CONSTRUCTOR_NAME = /^(from|try_from)/;

/** A doc-example candidate: the member name, its trait provenance when known, and
 *  whether the completion kind was Constructor. Decoupled from the vscode/LSP kind
 *  enums so ranking is pure and blind-testable over a fixed completion-item list. */
export interface ExampleCandidate {
  name: string;
  viaTrait?: string;
  isConstructor?: boolean;
}

/** True when a candidate is a std/blanket-trait item that must never win the
 *  example slot: provenance is a noise blanket trait (not a construction trait),
 *  or (provenance absent) the bare name is an unambiguous std method. The caller
 *  exempts a candidate whose name equals `prefer` before consulting this - the
 *  compiler naming a member is ground truth that it is real. */
function isNoiseExampleCandidate(c: ExampleCandidate): boolean {
  if (c.viaTrait !== undefined && EXAMPLE_NOISE_TRAITS.has(c.viaTrait)) {
    return true;
  }
  return c.viaTrait === undefined && STD_EXAMPLE_DENYLIST.has(c.name);
}

/** The constructor tier of a candidate (lower wins): 0 for a builder/primary
 *  constructor (Constructor completion kind, a `with_`/`new`/`open`/... name so
 *  `with_num_bits` wins even when RA surfaces it as a plain function, or a
 *  `Default` impl), 1 for a from-conversion constructor (`from_vec`, or a `From`/
 *  `TryFrom` impl), 2 for a plain method or field. The builder tier is what an
 *  E0599-on-associated-function needs; the from-tier still beats a plain method. */
function constructorTier(c: ExampleCandidate): number {
  if (c.isConstructor === true || c.viaTrait === "Default" || BUILDER_CONSTRUCTOR_NAME.test(c.name)) {
    return 0;
  }
  if (c.viaTrait === "From" || c.viaTrait === "TryFrom" || FROM_CONSTRUCTOR_NAME.test(c.name)) {
    return 1;
  }
  return 2;
}

/** How well a name matches the caller's prefer hint (the type/member the compiler
 *  named): exact 0, prefix 1, substring 2, none 3. Lower wins. */
function examplePreferenceRank(name: string, prefer?: string): number {
  if (!prefer || name === prefer) {
    return 0;
  }
  if (name.startsWith(prefer)) {
    return 1;
  }
  return name.includes(prefer) ? 2 : 3;
}

/** Rank doc-example candidates into selection order, dropping std/blanket-trait
 *  noise entirely so it can never win the example slot when a crate-specific
 *  candidate exists. Order: prefer-hint first (the name the compiler named), then
 *  constructor-shaped above plain method, then input order. When the prefer hint is
 *  a hallucinated name that matches nothing every candidate ties at the prefer
 *  tier, so the constructor tier decides - an E0599 on an invented associated
 *  function reaches the builder constructor, not clone's std example or an
 *  arbitrary method. When only std-trait candidates exist the result is empty: no
 *  example is correct, because a wrong-shape example is worse than none. A
 *  candidate whose name equals `prefer` is never filtered - the compiler naming it
 *  (e.g. an E0599 on an inherent `extend`) is ground truth that it is real, which
 *  overrides the std-name denylist. Generic so the caller keeps each candidate's
 *  identity (its source completion item) through the sort. */
export function rankExampleCandidates<T extends ExampleCandidate>(candidates: T[], prefer?: string): T[] {
  return candidates
    .filter((c) => c.name === prefer || !isNoiseExampleCandidate(c))
    .map((c, index) => ({ c, index }))
    .sort(
      (a, b) =>
        examplePreferenceRank(a.c.name, prefer) - examplePreferenceRank(b.c.name, prefer) ||
        constructorTier(a.c) - constructorTier(b.c) ||
        a.index - b.index,
    )
    .map((ranked) => ranked.c);
}

/** One fenced code block from hover markdown: its language tag and body, plus
 *  where it sat relative to the `---` divider that separates code from prose. */
interface FencedBlock {
  lang: string;
  body: string;
  startLine: number;
}

/** Walk hover markdown once, returning the fenced blocks, the divider line, and
 *  the Examples-heading line. rust-analyzer hover is code fences, then `---`,
 *  then doc prose that may hold a `# Examples` section with a rust example. */
function scanHover(markdown: string): { blocks: FencedBlock[]; dividerLine: number; examplesLine: number } {
  const lines = markdown.split("\n");
  const blocks: FencedBlock[] = [];
  let dividerLine = -1;
  let examplesLine = -1;
  let inFence = false;
  let current: FencedBlock | undefined;
  const bodyLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      if (!inFence) {
        inFence = true;
        current = { lang: line.trim().slice(3).trim(), body: "", startLine: i };
        bodyLines.length = 0;
      } else {
        inFence = false;
        if (current) {
          current.body = bodyLines.join("\n");
          blocks.push(current);
          current = undefined;
        }
      }
      continue;
    }
    if (inFence) {
      bodyLines.push(line);
      continue;
    }
    if (dividerLine < 0 && line.trim() === "---") {
      dividerLine = i;
    }
    if (examplesLine < 0 && /^#+\s+Examples\b/.test(line.trim())) {
      examplesLine = i;
    }
  }
  return { blocks, dividerLine, examplesLine };
}

/** The `# Examples` fenced code block from a doc/documentation markdown that has
 *  NO leading signature fence (completionItem/resolve documentation, unlike a
 *  full hover). The code inside the first fenced block under an `# Examples`
 *  heading, fences stripped, trimmed; undefined when absent. */
// Fence info-string tokens that mark a block as NOT compiling rust: another
// language, or a rust doctest that is not meant to build. Injecting any of these
// as "an example that compiles" would be a lie (a text/shell block) or worse, a
// known-broken snippet the model would copy.
const NON_RUST_FENCE_TOKENS = new Set([
  "text", "console", "sh", "bash", "shell", "json", "toml", "yaml", "ignore",
  "compile_fail", "no_compile",
]);

function isRustExampleFence(infoString: string): boolean {
  const tokens = infoString.trim().split(/[\s,]+/).filter((t) => t.length > 0);
  return !tokens.some((t) => NON_RUST_FENCE_TOKENS.has(t.toLowerCase()));
}

/** Does this usage-example code actually NAME the type its block is headed
 *  with? The census, restated under this predicate: 40 of 49 injected example
 *  blocks never do, and every one of them shipped under a header claiming to
 *  demonstrate the type - a false sentence in a prompt whose other blocks say
 *  "do not invent".
 *
 *  The match unit is the headed type's LAST PATH SEGMENT with generic args
 *  stripped (`cache::ShardCache<V>` -> `ShardCache`; a literal `ShardCache<V>`
 *  can never occur as a word in real code). Word-boundary and case-sensitive:
 *  `V` names neither `Vec` nor a lowercase `v` binding, `Client` names neither
 *  `HttpClient` nor `Client_v2`. A `r#` raw-ident head matches either spelling
 *  in the code. The match is TEXTUAL over the whole code - a mention inside a
 *  comment counts, exactly as the census's own predicate counted, because the
 *  gate's contract is "the code names the type", not "the code compiles a use
 *  of it". A head this cannot reduce to an identifier is refused: the gate
 *  cannot vouch for a block it cannot read the header of. */
export function exampleNamesItsType(headedType: string, code: string): boolean {
  let unit = headedType.trim();
  const angle = unit.indexOf("<");
  if (angle !== -1) {
    unit = unit.slice(0, angle);
  }
  const seg = (unit.split("::").pop() ?? "").trim().replace(/^r#/, "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(seg)) {
    return false;
  }
  return new RegExp(`\\b(?:r#)?${seg}\\b`).test(code);
}

export function extractExample(markdown: string): string | undefined {
  const lines = markdown.split("\n");
  const examplesLine = lines.findIndex((l) => /^#+\s+Examples?\b/.test(l.trim()));
  if (examplesLine < 0) {
    return undefined;
  }
  // Scan the fenced blocks after the heading; take the first that is rust and
  // meant to compile. A ```text / ```compile_fail block is skipped, not injected.
  let i = examplesLine + 1;
  while (i < lines.length) {
    const trimmed = lines[i].trimStart();
    if (!trimmed.startsWith("```")) {
      i++;
      continue;
    }
    const rust = isRustExampleFence(trimmed.slice(3));
    const body: string[] = [];
    i++;
    let closed = false;
    for (; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith("```")) {
        closed = true;
        i++;
        break;
      }
      // rustdoc hides lines beginning with "# " (boilerplate the reader should
      // not see); they are not part of the shown example.
      if (lines[i].trimStart() === "#" || lines[i].trimStart().startsWith("# ")) {
        continue;
      }
      body.push(lines[i]);
    }
    if (rust && closed) {
      const example = body.join("\n").trim();
      if (example.length > 0) {
        return example;
      }
    }
  }
  return undefined;
}

/** Parse rust-analyzer hover markdown into a HoverSurface: the pre-divider
 *  signature fence, the doc prose (Examples stripped), the first Examples code
 *  block. undefined when the hover carries no rust fence at all (an unresolved
 *  or doc-only hover, which must degrade to no injection, not a guess). */
export function parseHover(markdown: string): HoverSurface | undefined {
  const { blocks, dividerLine, examplesLine } = scanHover(markdown);
  const rustBlocks = blocks.filter((b) => b.lang === "rust" || b.lang === "");
  if (rustBlocks.length === 0) {
    return undefined;
  }

  // The signature is the last rust fence before the divider; the first fence is
  // only the containing path (`fastbloom::BloomFilter`), never the signature.
  const preDivider = rustBlocks.filter((b) => dividerLine < 0 || b.startLine < dividerLine);
  const sigBlock = preDivider.length > 0 ? preDivider[preDivider.length - 1] : undefined;
  if (!sigBlock) {
    return undefined;
  }
  const surface: HoverSurface = { signature: sigBlock.body.trim() };

  // Doc is the prose after the divider, up to the Examples heading (exclusive).
  if (dividerLine >= 0) {
    const docEnd = examplesLine >= 0 ? examplesLine : markdown.split("\n").length;
    const doc = markdown.split("\n").slice(dividerLine + 1, docEnd).join("\n").trim();
    if (doc.length > 0) {
      surface.doc = doc;
    }
  }

  // Example is the first rust fence under the Examples heading.
  if (examplesLine >= 0) {
    const exampleBlock = rustBlocks.find((b) => b.startLine > examplesLine);
    if (exampleBlock) {
      surface.example = exampleBlock.body.trim();
    }
  }

  return surface;
}

// ---------------------------------------------------------------------------
// Re-indent a generated Rust body, the Rust sibling of reindentTsBody,
// reindentCsBody and reindentPyBody. The model is handed a dedented signature
// and replies flush-left; a target nested in an `impl` block then splices with
// its body one level short and its closing brace at column 0. The ONE hard
// constraint is the same as the other legs: a physical line INSIDE a string
// literal must be byte-exact, because shifting it changes the string's value.
//
// Rust has more cross-line shapes than its siblings. A PLAIN `"..."` literal may
// span lines (unlike C# or TS, where that is a compile error), a raw string
// `r#"..."#` closes only on a quote followed by the same run of hashes, and a
// `/* */` block comment NESTS. A `'` is ambiguous - `'a'` is a char literal,
// `'a` is a lifetime that never closes - so the scan decides by shape rather
// than by pairing quotes.
// ---------------------------------------------------------------------------

interface RustLineScan {
  /** Inside a plain `"..."` literal spanning lines. */
  str: boolean;
  /** Open raw-string hash count (`r"` is 0, `r#"` is 1), else undefined. */
  raw: number | undefined;
  /** Nesting depth of block comments; Rust nests them. */
  block: number;
}

/** The index PAST the close of a raw string opened with `hashes` hashes, or -1
 *  when this line does not close it. */
function rustRawClose(line: string, from: number, hashes: number): number {
  for (let i = from; i < line.length; i++) {
    if (line[i] !== '"') {
      continue;
    }
    let h = 0;
    while (line[i + 1 + h] === "#") {
      h++;
    }
    if (h >= hashes) {
      return i + 1 + hashes;
    }
  }
  return -1;
}

/** A raw-string opener at `i` (`r"`, `r#"`, `br##"`, ...), or undefined. The
 *  preceding character must not be an identifier character, so a `foo_r` never
 *  reads as a prefix. */
function rustRawOpen(line: string, i: number): { hashes: number; next: number } | undefined {
  if (i > 0 && /[A-Za-z0-9_]/.test(line[i - 1])) {
    return undefined;
  }
  let j = i;
  if (line[j] === "b" && line[j + 1] === "r") {
    j += 2;
  } else if (line[j] === "r") {
    j += 1;
  } else {
    return undefined;
  }
  let hashes = 0;
  while (line[j + hashes] === "#") {
    hashes++;
  }
  if (line[j + hashes] !== '"') {
    return undefined;
  }
  return { hashes, next: j + hashes + 1 };
}

/** The index past a `'`: a char literal (`'x'`, `'\n'`) is consumed whole, a
 *  lifetime or loop label (`'a`) is just the tick. */
function rustSkipQuote(line: string, i: number, n: number): number {
  if (line[i + 1] === "\\") {
    let j = i + 2;
    while (j < n && line[j] !== "'") {
      j++;
    }
    return j < n ? j + 1 : n;
  }
  if (line[i + 2] === "'") {
    return i + 3;
  }
  return i + 1;
}

/** Advance the cross-line scan by one physical line, mirroring
 *  advanceTsLineScan: consume whatever string or comment the previous line
 *  carried in, then scan the rest as code, opening the shapes that can span. */
function advanceRustLineScan(line: string, s: RustLineScan): void {
  const n = line.length;
  let i = 0;
  while (i < n) {
    if (s.block > 0) {
      const open = line.indexOf("/*", i);
      const close = line.indexOf("*/", i);
      if (close < 0) {
        return; // the block comment continues to the next line
      }
      if (open >= 0 && open < close) {
        s.block++;
        i = open + 2;
      } else {
        s.block--;
        i = close + 2;
      }
      continue;
    }
    if (s.raw !== undefined) {
      const close = rustRawClose(line, i, s.raw);
      if (close < 0) {
        return; // the raw string continues to the next line
      }
      s.raw = undefined;
      i = close;
      continue;
    }
    if (s.str) {
      let closed = false;
      while (i < n) {
        if (line[i] === "\\") {
          i += 2;
          continue;
        }
        if (line[i] === '"') {
          s.str = false;
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return; // the plain string continues to the next line
      }
      continue;
    }
    const c = line[i];
    if (c === "/" && line[i + 1] === "/") {
      return; // line comment: the rest of the line is inert
    }
    if (c === "/" && line[i + 1] === "*") {
      s.block = 1;
      i += 2;
      continue;
    }
    const raw = rustRawOpen(line, i);
    if (raw) {
      s.raw = raw.hashes;
      i = raw.next;
      continue;
    }
    if (c === '"') {
      s.str = true;
      i++;
      continue;
    }
    if (c === "'") {
      i = rustSkipQuote(line, i, n);
      continue;
    }
    i++;
  }
}

/** Re-indent a generated Rust definition so a nested target's body lands at the
 *  right column. Same contract as reindentTsBody: line 1 (the signature) is
 *  kept, every later code line gets `indent` prepended, a blank line stays
 *  blank rather than gaining whitespace, a line inside a string literal is
 *  byte-exact, and `indent === ""` (a top-level target, today's already-correct
 *  case) returns the text unchanged, byte for byte. */
export function reindentRustBody(generated: string, indent: string): string {
  if (indent === "") {
    return generated;
  }
  const lines = generated.split("\n");
  const s: RustLineScan = { str: false, raw: undefined, block: 0 };
  // The reply's own base column, off before the target's goes on: see reindent.ts.
  const base = replyBaseIndent(lines);
  const out: string[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const insideString = s.str || s.raw !== undefined;
    if (insideString || line.trim() === "") {
      out.push(line);
    } else if (n === 0) {
      out.push(withoutBase(line, base));
    } else {
      out.push(indent + withoutBase(line, base));
    }
    advanceRustLineScan(line, s);
  }
  return out.join("\n");
}

/** Normalise Rust code read out of a document to its own column zero, the
 *  inverse of reindentRustBody and the Rust sibling of dedentTsBody /
 *  dedentCsBody / dedentPyBody. A line inside a plain or raw string literal is
 *  byte-exact, decided by the SAME scan the re-indent leg uses, so the two
 *  directions can never disagree about which bytes are a string's value. */
export function dedentRustBody(code: string, known?: string): string {
  const lines = code.split("\n");
  const s: RustLineScan = { str: false, raw: undefined, block: 0 };
  const byteExact: boolean[] = [];
  for (const line of lines) {
    // The state ENTERING the line, exactly as reindentRustBody reads it: the
    // scan advances only after the line has been classified.
    byteExact.push(s.str || s.raw !== undefined);
    advanceRustLineScan(line, s);
  }
  return dedentToZeroBase(lines, byteExact, known).join("\n");
}
