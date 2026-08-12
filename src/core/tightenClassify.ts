/**
 * The delta gate: which proposed backticks would CHANGE the injected surface,
 * and which would only evict something already in it.
 *
 * A REDUNDANT BACKTICK IS NOT A NO-OP, IT IS AN EVICTION, and that is the whole
 * reason this file exists. `PREFILL_TYPE_CAP` is 4, and `fnGen.ts` pushes the
 * comment-backtick tier ABOVE `referencedLocalSymbols` and above
 * `typesFromUses`; its own comment says four backticked comment names evict a
 * type the file is known to define, and that the eviction is intended. That
 * ranking is right for a backtick the developer meant. It is a straight loss
 * for one a proposer added to a name the walk already reached. So a proposal
 * for a type already in the surface is a DEFECT, not a precision miss, and it
 * is dropped here before any caller can see it.
 *
 * What a backtick actually buys is a RE-ROOT. Walk depth is 2 at every context
 * stop and is deliberately not a dial, so a type at level 3 of the downward
 * walk is unreachable at every stop, at every budget, forever. Backticking its
 * name makes it a root and the walk restarts at depth 2 from there. Class 4 is
 * exactly that population, which is why it ranks ahead of class 3.
 *
 * THE MODEL DECIDES NOTHING HERE. Every test below is deterministic and reads
 * only the ledger `resolvePrefill` handed over. The proposer's job was to guess
 * which spoken words are type names; this file's job is to refuse most of them.
 *
 * Pure: no vscode, no clock, no I/O, and it never throws on any input.
 */

import { foldName } from "./spokenName";
import { isAllCapsConstant, prefillStopNamesFor } from "./repairTypes";

/**
 * What one pre-fill DID, as this module needs to read it.
 *
 * STRUCTURALLY IDENTICAL to `PrefillLedger` in `src/vscode/fnGen.ts`, which is
 * the producer. It is redeclared rather than imported because `src/core/` never
 * imports a module that imports `vscode`, and `fnGen.ts` does. The two are
 * pinned together by a compile-time assertion beside the producer, so a field
 * added or renamed on either side breaks the build there rather than reading as
 * `undefined` here.
 */
export interface PrefillLedgerView {
  /** Type names whose own block rendered into the surface. Root, injected. */
  rendered: readonly string[];
  /** Every type name the prompt's walks EMITTED, root or not. A name here
   *  already has its surface in the prompt without being a root. */
  visited: readonly string[];
  /** Candidates that took a cap slot and rendered nothing, reason verbatim. */
  noBlock: readonly { type: string; reason: string }[];
  /** Candidates a cap never looked at. */
  notLookedAt: readonly string[];
  /** Types a walk dropped ENTIRELY, with the cap that did it. Never a name that
   *  also rendered: the producer filters the held-back class out, so a name here
   *  really is absent from the prompt. */
  dropped: readonly { name: string; cause: string }[];
  /** The root cap in force for this language and stop. */
  typeCap: number;
  /** Slots spent. `admitted >= typeCap` means a new root displaces one. */
  admitted: number;
  /** The rendered surface text, verbatim. */
  surface: string;
}

export type ProposalClass = 1 | 2 | 3 | 4;

export interface Candidate {
  /** The identifier as the repo spells it. */
  identifier: string;
  /** The prose span the model named, verbatim, and where it sits. */
  phrase: string;
  start: number;
  end: number;
  /** HOW the identifier was reached from the phrase. Provenance, for the diff to
   *  label. It is NOT the permission to apply: read `autoApply` for that. */
  match: "fold" | "plural" | "guess";
}

/**
 * MAY THIS SUBSTITUTION BE APPLIED WITHOUT ASKING?
 *
 * Only a `fold` match, and the rule is the goal's own ship condition read
 * strictly: "a substitution whose folded spoken span equals the folded
 * identifier is safe, because the developer said that name and the product only
 * respelled it".
 *
 * A `plural` MATCH DOES NOT HAVE THAT EQUALITY, and the first version of this
 * phase let it auto-apply (session-v52 adversarial, promoted HIGH). `client
 * sets` folds to `clientsets`; `ClientSet` folds to `clientset`. The strip is a
 * guess about English, not a respelling of what was said, and a repo holding
 * both `Plan` and `Plane`, or `Stat` and `State`, is a repo where the guess can
 * be wrong about which one the developer meant.
 *
 * CONTRACT AMENDMENT 17 DOES NOT CHANGE THIS. It made the retry try both strips
 * and let the identifier set decide, which turned the `Plan`/`Plane` case from a
 * confident wrong answer into a refusal and recovered the whole silent-`e` class
 * (549 of 549 pluralisable celeriant-db type names, up from 447). A better guess
 * is still a guess: the folds still differ, so the developer still accepts it.
 *
 * The retry earns its keep exactly there. It turns "no candidate at all" into "a
 * candidate the developer accepts in one keystroke", which is the whole
 * difference between the leg finding `ClientSet` and finding nothing.
 */
export function autoAppliesUnderFold(match: Candidate["match"]): boolean {
  return match === "fold";
}

export interface Proposal extends Candidate {
  klass: ProposalClass;
  /** The type this backtick pushes out of the prompt, when the cap is already
   *  full. Absent means the cap has a free slot and this is a pure addition. */
  displaces?: string;
  /** Whether the diff may apply this substitution WITHOUT an explicit human
   *  accept. `autoAppliesUnderFold(match)`, materialised on every proposal so a
   *  consumer cannot get the rule wrong by reading `match` and reasoning. False
   *  for `plural` and for `guess`; both reach the developer labelled. */
  autoApply: boolean;
}

/** An identifier-shaped run of characters. The boundary rule for "the surface
 *  names it as a whole word" (contract amendment 3) is exactly this class on
 *  neither side: `foo.ShardMemCache` is a hit because `.` is not in it, and
 *  `my_ShardMemCache` and `ShardMemCache2` are not, because their runs are
 *  longer words that happen to contain the name. */
const WORD_RUN = /[A-Za-z0-9_]+/g;

/**
 * The key a name is compared under: its fold, or the RAW STRING when the fold
 * is empty.
 *
 * The fold is ASCII-only on purpose, and the fallback is what stops that
 * decision leaking into the eviction guarantee (session-v52 adversarial
 * defect 3). Python, C#, TypeScript and Rust all accept a CJK, Cyrillic or
 * Greek type identifier, and every one of those folds to the empty string. With
 * the empty key skipped, a candidate that was LITERALLY the string in
 * `rendered` came back class 4 and was proposed - the exact eviction the phase
 * exists to prevent. `____` did the same.
 *
 * Falling back to exact equality cannot merge two names that the fold would
 * have kept apart: a raw non-ASCII string only ever equals itself, and no
 * folded ASCII key can collide with one. ASCII-only MATCHING is what the fold's
 * doc justifies; an empty-key hole in the gate is not.
 */
function keyOf(name: string): string {
  const folded = foldName(name);
  return folded !== "" ? folded : name;
}

/** Keys of the identifier-shaped words in `text`. ASCII runs only, which is why
 *  the empty-fold case below scans the surface a second way. */
function wordFolds(text: string): Set<string> {
  const out = new Set<string>();
  if (typeof text !== "string" || text === "") {
    return out;
  }
  for (const m of text.matchAll(WORD_RUN)) {
    const key = foldName(m[0]);
    if (key !== "") {
      out.add(key);
    }
  }
  return out;
}

/**
 * Whether `text` names `raw` with no `[A-Za-z0-9_]` on either side, which is
 * amendment 3's boundary rule applied literally to a name the word-run scan
 * cannot see.
 *
 * It OVER-MATCHES on scripts with no word separator: `顧客` is reported as a
 * whole word inside `顧客管理`, because neither neighbour is an ASCII word
 * character. That is the safe direction and it is chosen, not overlooked. Ship
 * condition 1 makes a class 1 or 2 proposal a defect while a missed class 4 is
 * only a missed opportunity, so the bias goes toward dropping.
 */
function namesWholeWord(text: string, raw: string): boolean {
  if (typeof text !== "string" || text === "" || raw === "") {
    return false;
  }
  const wordChar = /[A-Za-z0-9_]/;
  for (let at = text.indexOf(raw); at >= 0; at = text.indexOf(raw, at + 1)) {
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + raw.length] ?? "";
    if (!wordChar.test(before) && !wordChar.test(after)) {
      return true;
    }
  }
  return false;
}

/** Keys of a list of names, skipping anything that is not a non-empty string. A
 *  ledger arriving with a hole in an array must not take the gate down. */
function foldsOf(names: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(names)) {
    return out;
  }
  for (const name of names) {
    if (typeof name === "string" && name !== "") {
      out.add(keyOf(name));
    }
  }
  return out;
}

/** Keys off one field of a record array (`noBlock[].type`, `dropped[].name`). */
function foldsOfField(rows: unknown, field: string): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(rows)) {
    return out;
  }
  for (const row of rows) {
    const value = row === null || typeof row !== "object" ? undefined : (row as Record<string, unknown>)[field];
    if (typeof value === "string" && value !== "") {
      out.add(keyOf(value));
    }
  }
  return out;
}

/**
 * Which of the four classes `identifier` falls into, against the surface this
 * ledger describes. First hit wins.
 *
 *  1. `rendered` names it. Already a root, block injected. Redundant, evicts.
 *  2. `visited` names it, or the surface text names it as a whole word.
 *     Reached as a non-root, so its surface is already in the prompt.
 *  3. `notLookedAt`, `dropped` or `noBlock` names it. Reachable in principle,
 *     and a cap or the budget took it. A backtick here is a SWAP.
 *  4. None of the above. Off the walk entirely, which is the case the whole
 *     command exists for.
 *
 * EVERY TEST IS UNDER THE FOLD (contract amendment 2), not by exact spelling,
 * and under the RAW STRING when the fold is empty (see `keyOf`). The bias has to
 * be toward dropping, because ship condition 1 makes a class 1 or class 2
 * proposal a defect while a missed class 4 is only a missed opportunity. What
 * that costs is measured: 37 collisions over 4,863 declared celeriant-db
 * symbols at 487f8c1, 0.97% of 3,798 keys, and ZERO of the 37 are a type
 * against a type - which is the only collision a list of proposed type names
 * can suffer.
 *
 * A LEDGER THAT SAYS NOTHING - undefined, null, or a value of the wrong shape -
 * classifies everything as class 4. THAT IS A DEGRADE AND NOT A GUESS: a caller
 * with no ledger has disclosed no surface, so nothing can be shown to be in it.
 * It is stated rather than hidden because the caller that hits it is a caller
 * whose `resolvePrefill` never ran, and the proposals it gets back are
 * unfiltered by definition.
 */
export function classifyCandidate(identifier: string, ledger: PrefillLedgerView): ProposalClass {
  if (typeof identifier !== "string" || identifier === "" || ledger === null || typeof ledger !== "object") {
    return 4;
  }
  const key = keyOf(identifier);
  // A name the fold cannot see is matched against the surface RAW, because the
  // word-run scan only walks ASCII runs and would never find it there.
  const ascii = foldName(identifier) !== "";
  const surface = typeof ledger.surface === "string" ? ledger.surface : "";
  if (foldsOf(ledger.rendered).has(key)) {
    return 1;
  }
  if (foldsOf(ledger.visited).has(key) || (ascii ? wordFolds(surface).has(key) : namesWholeWord(surface, identifier))) {
    return 2;
  }
  if (
    foldsOf(ledger.notLookedAt).has(key) ||
    foldsOfField(ledger.dropped, "name").has(key) ||
    foldsOfField(ledger.noBlock, "type").has(key)
  ) {
    return 3;
  }
  return 4;
}

/** A candidate with the fields this module reads, or `undefined` when the
 *  shape is not one. Nothing throws, so a malformed row is dropped rather than
 *  carried with holes in it. */
function usable(candidate: unknown): Candidate | undefined {
  if (candidate === null || typeof candidate !== "object") {
    return undefined;
  }
  const c = candidate as Partial<Candidate>;
  if (typeof c.identifier !== "string" || c.identifier === "" || typeof c.phrase !== "string") {
    return undefined;
  }
  if (!Number.isFinite(c.start) || !Number.isFinite(c.end)) {
    return undefined;
  }
  const match = c.match === "fold" || c.match === "plural" ? c.match : "guess";
  return {
    identifier: c.identifier,
    phrase: c.phrase,
    start: c.start as number,
    end: c.end as number,
    match,
  };
}

/**
 * The candidates worth showing a developer, best first.
 *
 * Classes 1 and 2 are dropped SILENTLY. There is nothing for a human to decide
 * about them: the type is already in the prompt, and the only thing accepting
 * one could do is cost a real type its slot. Class 4 ranks ahead of class 3
 * because a class-4 backtick reaches a type the walk structurally cannot, and a
 * class-3 one only re-orders a type the walk already ranked and dropped. Within
 * a class, source order. This orders the PROPOSAL LIST and never the prose.
 *
 * THE GATE APPLIES THE PRE-FILL'S OWN REFUSALS FIRST, and it exists because it
 * did not (`session-v52/census-delta.md`). A proposal for a name the pre-fill
 * discards is strictly worse than no proposal: the developer accepts it, their
 * comment changes, a capped slot is spent carrying it, and the pre-fill throws
 * it away the moment it is backticked. Two refusals, both read from the pre-fill
 * rather than reimplemented:
 *
 *  - `isAllCapsConstant`. `fnGen.ts` refuses SCREAMING_CASE for every candidate
 *    tier (`refused = declared.has(n) || isAllCapsConstant(n)`). Language-free
 *    there, so language-free here: `WORKLOAD_SCHEMA` is not a type in any of the
 *    five. 21 of Rust's 109 class-4 instances and 6 of TypeScript's 300.
 *  - `prefillStopNamesFor(languageId)`, NOT `stopNamesFor`. The two differ only
 *    in Rust, and that difference is `None`, `Some`, `Ok`, `Err` and `Self` -
 *    29 more of Rust's 109. `fnGen.ts`'s five comment legs read the same
 *    function, so the sets cannot drift apart again.
 *
 * Between them they close 50 of Rust's 109 class-4 instances and 25 of
 * TypeScript's 300, every one a proposal guaranteed to be worthless.
 *
 * `languageId` ABSENT MEANS NO STOP SET AT ALL rather than Rust's, for the same
 * reason `commentTypesIn` takes the caller's: this function has no language
 * opinion of its own, and a caller that inherits Rust's idea of `Result` in C#
 * loses a real type. `isAllCapsConstant` applies either way, because it is not a
 * language opinion.
 *
 * Never throws. A malformed candidate is dropped, a malformed ledger classifies
 * everything as class 4 (see `classifyCandidate`), and neither is an exception.
 */
export function deltaProposals(
  candidates: readonly Candidate[],
  ledger: PrefillLedgerView,
  languageId?: string,
): Proposal[] {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }
  const stop = typeof languageId === "string" && languageId !== "" ? prefillStopNamesFor(languageId) : undefined;
  // The cap being FULL is a property of the run, not of any one candidate, and
  // it is read once: `admitted >= typeCap` means the next root displaces the
  // lowest-ranked injected one, which is the LAST entry of `rendered`. With
  // nothing rendered there is no name to give, and a `displaces` field naming
  // nothing is worse than no field (amendment 1).
  const capFull =
    ledger !== null &&
    typeof ledger === "object" &&
    Number.isFinite(ledger.admitted) &&
    Number.isFinite(ledger.typeCap) &&
    ledger.admitted >= ledger.typeCap;
  const renderedNames = Array.isArray(ledger?.rendered) ? ledger.rendered.filter((n) => typeof n === "string" && n !== "") : [];
  const displaces = capFull && renderedNames.length > 0 ? renderedNames[renderedNames.length - 1] : undefined;

  const seen = new Set<string>();
  const kept: { proposal: Proposal; order: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = usable(candidates[i]);
    if (candidate === undefined) {
      continue;
    }
    // Amendment 15: duplicates naming the same identifier dedupe to the FIRST.
    // Exact spelling, deliberately: two spellings of one name is a shape phase
    // 3 does not produce, and folding here would silently drop the second of
    // two genuinely distinct proposals if it ever did.
    if (seen.has(candidate.identifier)) {
      continue;
    }
    seen.add(candidate.identifier);
    // The pre-fill's refusals, before the delta gate. A name either of these
    // catches can never be injected however it classifies, so proposing it
    // spends the developer's attention and a capped slot for nothing.
    if (stop?.has(candidate.identifier) === true || isAllCapsConstant(candidate.identifier)) {
      continue;
    }
    const klass = classifyCandidate(candidate.identifier, ledger);
    if (klass === 1 || klass === 2) {
      continue;
    }
    const proposal: Proposal = { ...candidate, klass, autoApply: autoAppliesUnderFold(candidate.match) };
    if (displaces !== undefined) {
      proposal.displaces = displaces;
    }
    kept.push({ proposal, order: i });
  }
  // Stable by construction: class 4 ahead of class 3, and the recorded source
  // index breaks every tie, so no two entries ever compare equal.
  kept.sort((a, b) => b.proposal.klass - a.proposal.klass || a.order - b.order);
  return kept.map((k) => k.proposal);
}
