/**
 * The bridge between what a mic heard and how the repo spells it.
 *
 * A dictated type name arrives as separate lowercase words with arbitrary
 * speech-to-text capitalisation. The repo spells the same concept
 * `ShardMemCache`, `ShardMemcache`, `shard_mem_cache` or `SHARD_MEM_CACHE`
 * depending on the language and the position. Nothing downstream can compare a
 * spoken span to an identifier without collapsing that difference first.
 *
 * ONE FOLD, TWO JOBS, and the second is the reason this file is small.
 *
 *  1. It MATCHES. Lowercase, drop everything that is not a letter or a digit,
 *     and every spelling above collapses to `shardmemcache`.
 *  2. It is the AUTO-ACCEPT GATE. A substitution whose folded spoken span
 *     equals the folded identifier is safe to apply without asking, because the
 *     developer said that name and the product only respelled it. Anything
 *     else went beyond what was said and never reaches the buffer without a
 *     human accept.
 *
 * ONLY A `fold` MATCH IS THAT EQUALITY. The plural retry below is NOT, and
 * treating it as auto-applicable was the sharpest defect the adversarial review
 * of this phase found. `client sets` folds to `clientsets` and `ClientSet` folds
 * to `clientset`; the strip is a guess about English. `autoAppliesUnderFold` in
 * `tightenClassify.ts` owns the rule and every `Proposal` carries its answer.
 *
 * Collision risk, measured over the celeriant-db Rust corpus at commit 487f8c1
 * (2026-08-08, `git archive HEAD` so the count is reproducible; the run is
 * recorded in docs/architecture/tighten-doc-comment.md): 4,863 declared
 * symbols, 3,798 distinct
 * fold keys, 37 of them (0.97%) carrying more than one spelling.
 *
 * THE CLAIM THAT MATTERS IS NARROWER AND STRONGER than the one the first draft
 * made. The draft said each collision paired a type with a const or a function,
 * and that is false: 13 of the 37 involve no type at all (`create|CREATE`,
 * `name|NAME`, `CLIENT_ID|client_id`). What is true, and what the gate actually
 * rests on, is that ZERO of the 37 are a type against a type. A list of proposed
 * TYPE names cannot be silently merged on this corpus. `matchByFold` refuses on
 * ambiguity rather than picking anyway, so the residual risk is a refusal and
 * never a wrong pick.
 *
 * THE FOLD COMPARES, THE SWEEP QUERIES. A workspace symbol provider is a query
 * API, not a dump, so a fold key is useless to it. `identifierVariants` is what
 * you hand the provider: the spellings the five languages actually use,
 * bounded and deterministic. Ported from the scout's variant generator, which
 * recovered 100% of the 543 declared type names in that corpus at 487f8c1
 * - a number to DISCOUNT, because the spoken form it swept with was derived by
 * splitting each identifier on its own humps, so the generator was measured as
 * the inverse of the splitter.
 *
 * THE NON-CIRCULAR HALF IS 0%, and the adversarial review measured it. Of the
 * type names whose spoken form differs from their own humps, 53 carry an
 * abbreviation a person expands (`mem` said "memory", `args` said "arguments")
 * and the sweep recovers 0 of 53. That is 9.6% of the corpus's type names
 * reaching the developer as a `guess` and never auto-applying - the goal's
 * designed behaviour for the abbreviation case, now with a number on it. The
 * sweep's real reach on dictated speech is far narrower than 100%.
 *
 * Pure: no vscode, no clock, no I/O, and it never throws. Garbage in is an
 * empty list or `undefined`, never an exception.
 */

/**
 * Lowercase, drop everything that is not a letter or a digit.
 *
 * "shard mem cache", "Shard Mem Cache", `ShardMemCache`, `ShardMemcache`,
 * `shard_mem_cache` and `SHARD_MEM_CACHE` all fold to `shardmemcache`.
 *
 * Deliberately NOT unicode-aware. The identifiers this compares against come
 * out of a symbol provider for five languages whose type names are ASCII in
 * every corpus measured, and a fold that kept `é` would answer "same name" for
 * two strings a `\b`-based scanner downstream cannot even find.
 */
export function foldName(s: string): string {
  if (typeof s !== "string") {
    return "";
  }
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A spoken span into the words a person said.
 *
 * Whitespace and punctuation split it. So do humps and underscores, and that
 * second half is not redundant: a developer who TYPED `ShardMemCache` into the
 * prose and a mic that heard "shard mem cache" must reach the same word list,
 * or the variant sweep asks the provider for `Shardmemcache` on one path and
 * `ShardMemCache` on the other.
 *
 * SPELLING UNTOUCHED (contract amendment 4). "Shard Mem Cache" splits to
 * `["Shard", "Mem", "Cache"]`, not to the lowercase of it. Lowercasing belongs
 * to `identifierVariants` and to `foldName`, both of which do it themselves,
 * and a splitter that also normalises is a splitter a caller cannot use to see
 * what the developer actually typed.
 *
 * The two hump rules run in this order for the acronym case. `WALSegment`
 * splits to `WAL Segment`, not `W A L Segment`: the first rule only fires on a
 * lower-to-upper boundary, and the second peels a trailing capital off a run of
 * them when a lowercase letter follows.
 */
export function spokenWords(phrase: string): string[] {
  if (typeof phrase !== "string" || phrase === "") {
    return [];
  }
  return phrase
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "");
}

/** A word as it goes into a variant: lowercase, and stripped of anything that is
 *  not a letter or a digit. A caller may hand this module a word list it built
 *  itself rather than one `spokenWords` produced, and a stray `(` inside a word
 *  would otherwise ride into a query string the provider cannot match. */
function variantWord(word: string): string {
  return typeof word === "string" ? word.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

/**
 * The spellings a repo might use for these words, deduped, in a fixed order.
 *
 * Eight conventions, plus one more for phrases of three words or more:
 * `ShardMemCache`, `shardMemCache`, `shard_mem_cache`, `SHARD_MEM_CACHE`,
 * `shardmemcache`, `Shardmemcache`, `Shard_Mem_Cache`, `shard-mem-cache`, and
 * the awkward inner-token split `ShardMemcache` for a repo that treats a tail
 * of the phrase as one token.
 *
 * BOUNDED IS THE POINT. Each variant is a query and a workspace symbol query
 * costs a measured ~500ms Roslyn floor, so this is a fixed nine and not a
 * combinatorial expansion over which words a repo might glue together.
 *
 * A short phrase yields FEWER, because the conventions collide. One word gives
 * exactly three (`Cache`, `cache`, `CACHE`): with nothing to join, the
 * underscore, hyphen and glue conventions all collapse onto the bare lowercase
 * word, and capitalise-each-word collapses onto `Cache`. Counted, not reasoned
 * about - an earlier version of this comment said four.
 */
export function identifierVariants(words: readonly string[]): string[] {
  if (!Array.isArray(words)) {
    return [];
  }
  const w = words.map(variantWord).filter((x) => x !== "");
  if (w.length === 0) {
    return [];
  }
  const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
  const out = new Set<string>([
    w.map(cap).join(""),
    w[0] + w.slice(1).map(cap).join(""),
    w.join("_"),
    w.join("_").toUpperCase(),
    w.join(""),
    cap(w[0]) + w.slice(1).join(""),
    w.map(cap).join("_"),
    w.join("-"),
  ]);
  if (w.length >= 3) {
    out.add(cap(w[0]) + cap(w[1]) + w.slice(2).join(""));
  }
  return [...out];
}

/**
 * ONE deterministic retry with a trailing plural stripped, `es` before `s`.
 * "client sets" -> "client set". `undefined` when the last word carries neither.
 *
 * SUPERSEDED BY `pluralCandidates`, which is what `matchByFold` uses. This
 * function is kept because the phase 2 blind oracle pins its exact behaviour,
 * and because it is the honest record of a rule that was wrong.
 *
 * WHY IT WAS WRONG. Contract amendment 5 said `es` must be tried first, on the
 * reasoning that every word ending in `es` also ends in `s`, so an `s`-first
 * rule makes the `es` leg dead code. That is true only of a SINGLE strip with an
 * early exit, which is the shape the reasoning did not notice it was assuming.
 * With one strip allowed, the choice is forced and it is wrong for every word
 * ending in a silent `e`: "caches" -> "cach", "planes" -> "plan", "samples" ->
 * "sampl". Measured at 102 of 549 pluralisable celeriant-db type names, 18.6%.
 *
 * Worse than a recall loss: `matchByFold("planes", ["Plan", "Plane"])` returned
 * `Plan`, the wrong type, confidently, because `Plane` was never a candidate to
 * collide with. Amendment 17 tries both and lets the identifier set decide, and
 * neither strip is dead once both are tried.
 *
 * A last word that IS `s` or `es` strips to nothing (amendment 6), and an empty
 * word is not a name, so that returns undefined rather than a word list with a
 * hole in it.
 */
export function stripPlural(words: readonly string[]): string[] | undefined {
  if (!Array.isArray(words) || words.length === 0) {
    return undefined;
  }
  const last = words[words.length - 1];
  if (typeof last !== "string") {
    return undefined;
  }
  const lower = last.toLowerCase();
  let singular: string | undefined;
  if (lower.endsWith("es")) {
    singular = last.slice(0, -2);
  } else if (lower.endsWith("s")) {
    singular = last.slice(0, -1);
  }
  if (singular === undefined || singular === "") {
    return undefined;
  }
  return [...words.slice(0, -1), singular];
}

/**
 * BOTH plural strips, for the caller that can afford to try them (contract
 * amendment 17). `s`-stripped first, then `es`-stripped, deduped, and `[]` when
 * the last word carries no trailing plural at all.
 *
 * The whole point is that neither strip has to be chosen HERE. English cannot
 * tell "caches" (silent `e`, wants the `s` rule) from "matches" (wants the `es`
 * rule) without a dictionary, and this module has no business owning one. The
 * REPO owns the answer: exactly one of the two spellings is a declared
 * identifier, and `matchByFold` asks it rather than guessing.
 *
 *   "sets"    -> ["set"]              one candidate; it does not end in `es`
 *   "boxes"   -> ["boxe", "box"]      `boxe` resolves to nothing, `box` to Box
 *   "caches"  -> ["cache", "cach"]    `cache` resolves to Cache, `cach` to nothing
 *   "planes"  -> ["plane", "plan"]    BOTH resolve in a repo with both, so refuse
 *
 * Still bounded and still not a stemmer: two candidates, one strip each, last
 * word only. Every extra rescue widens the set of things the product will
 * respell, and the fold is the auto-accept gate.
 */
export function pluralCandidates(words: readonly string[]): string[][] {
  if (!Array.isArray(words) || words.length === 0) {
    return [];
  }
  const last = words[words.length - 1];
  if (typeof last !== "string") {
    return [];
  }
  const lower = last.toLowerCase();
  const head = words.slice(0, -1);
  const out: string[][] = [];
  const take = (singular: string): void => {
    if (singular === "" || out.some((c) => c[c.length - 1] === singular)) {
      return;
    }
    out.push([...head, singular]);
  };
  if (lower.endsWith("s")) {
    take(last.slice(0, -1));
  }
  if (lower.endsWith("es")) {
    take(last.slice(0, -2));
  }
  return out;
}

/**
 * Which of `identifiers` the phrase names, and how it got there.
 *
 * Fold equality first, then the plural retry. `undefined` when neither answers,
 * and `undefined` ALSO when the phrase reaches two DIFFERENT identifiers. That
 * second case is the ambiguity refusal: this product refuses rather than picks,
 * because a wrong pick silently rewrites a word the human said and the whole
 * command's guarantee is that it cannot.
 *
 * THE RETRY TRIES BOTH STRIPS AND LETS THE REPO DECIDE (contract amendment 17).
 * `pluralCandidates` hands over the `s`-stripped and `es`-stripped spellings and
 * this function asks the identifier set which one exists, rather than choosing
 * between them on a rule English does not support. Exactly one resolves, take
 * it. Both resolve to the same name, take it. Both resolve to DIFFERENT names,
 * refuse - `Plan` against `Plane` is precisely the case the refusal exists for,
 * and the superseded single-strip rule answered it with a confident `Plan`.
 *
 * A SINGLE STRIP THAT IS AMBIGUOUS REFUSES THE WHOLE MATCH (amendment 9), it
 * does not fall through to the other strip. Falling through would be picking one
 * reading over an ambiguity, which is the thing this function does not do.
 *
 * `match` IS PROVENANCE, NOT PERMISSION. `fold` means the folded spoken span
 * equals the folded identifier and the substitution may be applied without
 * asking. `plural` means it does not - the retry is a guess about English - so
 * it reaches the diff labelled and needs an explicit accept. The rule lives in
 * `autoAppliesUnderFold` and every `Proposal` carries its answer, because a
 * consumer reading this union and reasoning about it is how the first version
 * of this phase auto-applied a plural.
 *
 * Two identifiers spelled the same way are one identifier, not a collision - a
 * provider that returns `ClientSet` from two files has found one name twice.
 */
export function matchByFold(
  phrase: string,
  identifiers: readonly string[],
): { identifier: string; match: "fold" | "plural" } | undefined {
  if (typeof phrase !== "string" || !Array.isArray(identifiers) || identifiers.length === 0) {
    return undefined;
  }
  const spokenKey = foldName(phrase);
  if (spokenKey === "") {
    return undefined;
  }
  const folded = matchesFor(spokenKey, identifiers);
  if (folded.length > 1) {
    return undefined;
  }
  if (folded.length === 1) {
    return { identifier: folded[0], match: "fold" };
  }
  // Every distinct identifier either strip can reach, gathered before anything
  // is chosen. Gathering first is what makes the Plan/Plane case a refusal: a
  // loop that returned on the first strip to resolve would never learn the
  // other one resolves too.
  const reached = new Set<string>();
  for (const candidate of pluralCandidates(spokenWords(phrase))) {
    const key = foldName(candidate.join(""));
    if (key === "") {
      continue;
    }
    const hits = matchesFor(key, identifiers);
    if (hits.length > 1) {
      return undefined;
    }
    for (const hit of hits) {
      reached.add(hit);
    }
  }
  const only = [...reached];
  return only.length === 1 ? { identifier: only[0], match: "plural" } : undefined;
}

/** The DISTINCT identifiers folding to `key`. Two identifiers spelled the same
 *  way are one identifier, not a collision: a provider that returns `ClientSet`
 *  from two files has found one name twice. */
function matchesFor(key: string, identifiers: readonly string[]): string[] {
  const found = new Set<string>();
  for (const identifier of identifiers) {
    if (typeof identifier === "string" && foldName(identifier) === key) {
      found.add(identifier);
    }
  }
  return [...found];
}
