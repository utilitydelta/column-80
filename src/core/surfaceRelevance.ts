/**
 * Rank injected surface lines by how much they share with the failure and the
 * target, so the member a fix needs sits near the top of what the model reads.
 *
 * WHY THIS IS NOT A NICETY. Measured on the real Rust corpus: a seeded defect,
 * `qwen3-coder:30b` at temperature 0, three repetitions per arm, and every
 * candidate fix spliced back and verified by `cargo test` rather than graded on
 * the reply text.
 *
 *   failure evidence only ............................ 0/3 restored, 0/3 green
 *   evidence + SOURCE-ordered receiver surface ....... 0/3 restored, 0/3 green
 *   evidence + RELEVANCE-ordered receiver surface .... 3/3 restored, 3/3 green
 *   evidence + relevance-ordered, top 16 only ........ 0/3 restored, 0/3 green
 *
 * Same 100 signatures, same budget, same model, same temperature. Only the
 * ORDER differs, and the order is the whole difference between 0/3 and 3/3
 * verified green by the real runner.
 *
 * It is NOT "the needed member came earlier". Relevance order put the needed
 * member at index 66 where source order had it at 14. What changed is that the
 * members semantically near the failure sit at the top. The losing arms invented
 * a member that does not exist or picked a real but wrong one: failure evidence
 * says what is wrong, injected surface says what to write, and a badly ordered
 * surface says the wrong thing confidently.
 *
 * The truncation arm is the warning attached to that result. Relevance-ordered
 * but capped at the top 16 was 0/3. The cap and the order are one decision.
 *
 * Everything here is pure, total and deterministic: no clock, no filesystem, no
 * throw, and the same input gives the same output. An empty context returns the
 * input order unchanged, which is what makes it safe to sit on a shared prompt
 * path.
 */

/** What the ordering is relevant TO. Every field is optional in effect: a
 *  context that contributes no tokens leaves the input order alone. */
export interface RelevanceContext {
  /** The target's own text, usually the span the repair round is rewriting. */
  targetText: string;
  /** The rendered failure evidence for this round, when there is one. */
  evidenceText?: string;
  /** The target's doc comment, when the resolver found one. */
  docComment?: string;
}

/** Identifier tokens of three characters or more, lower-cased. The floor is
 *  what the measured arm used: below it, `fn`, `u8` and `to` match everything
 *  and the score stops discriminating. */
function identifierTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []);
}

/**
 * Order `lines` by how many distinct identifier tokens each shares with the
 * context, highest first, with the ORIGINAL INDEX as the tiebreak.
 *
 * The stable tiebreak is load-bearing rather than tidy: an all-zero-score list
 * comes back byte-identical to its input, so a context that says nothing cannot
 * shuffle a surface that was already in a deliberate order.
 *
 * The result is always a permutation of the input. Dropping or duplicating a
 * line would shrink or corrupt the surface the firm instruction has already told
 * the model it may call from.
 */
export function orderByRelevance(lines: readonly string[], context: RelevanceContext): string[] {
  const want = identifierTokens(
    `${context.targetText ?? ""}\n${context.evidenceText ?? ""}\n${context.docComment ?? ""}`,
  );
  if (want.size === 0) {
    return [...lines];
  }
  const score = (line: string): number => {
    let hits = 0;
    for (const token of identifierTokens(line)) {
      if (want.has(token)) {
        hits++;
      }
    }
    return hits;
  };
  return lines
    .map((line, index) => ({ line, index, hits: score(line) }))
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .map((entry) => entry.line);
}

/** The header `assembleSurfacePayload` writes over a member-signature fence, and
 *  the ONE place any member surface is rendered. Matching the header rather than
 *  guessing at line shape is why this reorder cannot scramble a block: a data
 *  shape, a usage example, an import hint and the firm instruction all carry
 *  different headers or no header at all, and none of them is touched. */
const API_SURFACE_HEADER = /^API surface for `[^`]+` \(real signatures, use these exact names, do not invent\):$/;

/** A bare fence opener. `fenceFor` lengthens the run or switches to tildes when
 *  the content itself carries fences, so the token is captured rather than
 *  assumed, and the run closes only on the same token. The signatures branch
 *  emits no language tag, so a tagged opener is not this block. */
const FENCE_LINE = /^(`{3,}|~{3,})$/;

/**
 * Order the member signatures inside a RENDERED surface string, leaving every
 * other line exactly where it was.
 *
 * Each API-surface block is ordered on its own. Ordering across blocks would
 * move a signature out from under the header naming the type that owns it, which
 * is a worse lie than source order.
 *
 * A header with no fence under it, or a fence that never closes, is left alone.
 * A malformed block is not worth guessing at when the cost of guessing wrong is
 * a scrambled prompt.
 */
export function orderSurfaceByRelevance(surface: string, context: RelevanceContext): string {
  if (!API_SURFACE_HEADER.test(surface) && !surface.includes("API surface for ")) {
    return surface;
  }
  const lines = surface.split("\n");
  const out = [...lines];
  for (let i = 0; i < lines.length; i++) {
    if (!API_SURFACE_HEADER.test(lines[i])) {
      continue;
    }
    const opener = lines[i + 1];
    if (opener === undefined || !FENCE_LINE.test(opener)) {
      continue;
    }
    const close = lines.indexOf(opener, i + 2);
    if (close < 0) {
      continue;
    }
    const ordered = orderByRelevance(lines.slice(i + 2, close), context);
    for (let j = 0; j < ordered.length; j++) {
      out[i + 2 + j] = ordered[j];
    }
    i = close;
  }
  return out.join("\n");
}
