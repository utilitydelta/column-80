/**
 * The usage leg at a member site: real call sites of the member the cursor is
 * on, injected under the signature block so the model copies the repo's own
 * call shape.
 *
 * Measured before it was built (`session-v29/measure-p3.md`), 40 real member
 * sites in acme-db, scored by rust-analyzer's own diagnostics on the served
 * line: signatures alone leave 8 of 40 continuations type-wrong, signatures plus
 * usage windows leave 3. The failures it removes are arity and operand type
 * (`expected 1 argument, found 2`, `expected 4 arguments, found 0`), which is
 * the v22 finding reproducing at a site v22 never measured: examples do not
 * choose the member, they fix the call SHAPE, and at a member site the member is
 * already chosen. It is not free, and the cost has one shape: a window from
 * another call site brings that site's locals with it and the model sometimes
 * reaches for them. The compiler says the trade is better than two to one.
 *
 * WHERE IT FIRES, and the reason it is narrower than it looks. The block needs a
 * reference query, and a reference query needs the symbol to be IN THE
 * DOCUMENT. At the widget-open state - the human typed `enr` and arrowed onto
 * `enrollTile` - the member name lives in the widget and in the rewritten
 * prompt, and nowhere in the file. Putting it in the file to ask a question is a
 * document write, and this product has exactly two of those, both consented. So
 * the leg fires where the buffer already spells the member, which is the state
 * the measurement was taken in, and stays dark otherwise.
 *
 * THE BUDGET is the other half. The references call is not a bounded cost: over
 * 60 distinct symbols on a warm rust-analyzer the same repo gives p50 1ms, p90
 * 12ms and a 7.9s worst case, because the server memoizes per symbol and a FIM
 * session asks a new question every keystroke. So this runs AFTER the member
 * surface has rendered, against what is LEFT of the injection window, and a leg
 * that loses that race costs the signature block nothing. The pattern is
 * `resolveArgTypesInBudget`'s, for the same reason.
 *
 * In C# it will effectively never fire: Roslyn has a fixed 500ms floor per
 * references call, warm, regardless of hit count. The honest outcome there is
 * the control arm, which is what a lost race already produces.
 *
 * Core, so no vscode. The extractor and the file reader are handed in.
 */

import { SourceCursor, SurfaceExtractor } from "./extraction";
import { UsageWindowBounds, collectUsageWindows, renderUsageComment } from "./usageWindows";

/** Left for the caller's own bookkeeping after the leg answers, in ms. Same
 *  role as `ARG_TYPE_DEADLINE_MARGIN_MS`: a leg that spends the last
 *  millisecond of the window leaves the request nothing to do with the answer. */
export const USAGE_DEADLINE_MARGIN_MS = 5;

/** Below this there is no point starting: the fastest observed answer on a warm
 *  server is about 1ms, but a cold one is not, and a query begun with 2ms left
 *  is a query whose answer arrives too late to use. */
export const USAGE_MIN_BUDGET_MS = 8;

/**
 * The shipped bounds, and every number in them is what the arms ran with rather
 * than a guess: 3 windows, one line of context either side, 900 characters.
 * The sweep that would tune them was not run, deliberately, because a sweep over
 * a mechanism decides nothing until the mechanism has beaten its control, and
 * the arms that beat it ran at these values.
 */
export const USAGE_WINDOW_BOUNDS: Omit<UsageWindowBounds, "perLineChars" | "perWindowChars"> = {
  maxWindows: 3,
  linesBefore: 1,
  linesAfter: 1,
  maxChars: 900,
};

export interface UsageLegResult {
  /** The rendered comment block, or undefined when nothing was found in time. */
  block?: string;
  /** Why there is no block, for the channel. Undefined when there is one. */
  reason?: string;
  windows: number;
  references: number;
  ms: number;
}

/**
 * Resolve the usage block for `member` at `cursor`, inside `budgetMs`.
 *
 * `readLines` returns a file's lines or undefined; an unreadable location is
 * skipped rather than fatal. `exclude` is the site being completed, which is not
 * an example of itself.
 */
export async function resolveUsageInBudget(
  extractor: SurfaceExtractor,
  cursor: SourceCursor,
  member: string,
  lineComment: string,
  readLines: (uri: string) => readonly string[] | undefined,
  budgetMs: number,
): Promise<UsageLegResult> {
  const startedAt = Date.now();
  if (extractor.references === undefined) {
    return { reason: "this language's extractor has no reference leg", windows: 0, references: 0, ms: 0 };
  }
  if (budgetMs < USAGE_MIN_BUDGET_MS) {
    return {
      reason: `only ${Math.max(0, Math.round(budgetMs))}ms of the injection window was left`,
      windows: 0,
      references: 0,
      ms: 0,
    };
  }
  // The race is the caller's, not the server's: the LSP request carries no
  // deadline, so a slow answer keeps arriving and is simply not used. Racing a
  // timer here rather than awaiting is what keeps the keystroke path honest.
  const references = await Promise.race([
    extractor.references(cursor, { includeDeclaration: false }),
    delay(budgetMs - USAGE_DEADLINE_MARGIN_MS).then(() => undefined),
  ]);
  const ms = Date.now() - startedAt;
  if (references === undefined) {
    return { reason: "the reference query did not answer inside the injection window", windows: 0, references: 0, ms };
  }
  if (references.length === 0) {
    // A first use, or a member only called from another project. The honest
    // answer is the control arm, said once, never something adjacent.
    return { reason: "the workspace has no other call site for this member", windows: 0, references: 0, ms };
  }
  const header = `how ${member} is called in this repo:`;
  const windows = collectUsageWindows(
    references,
    readLines,
    {
      ...USAGE_WINDOW_BOUNDS,
      // The block is comments, so every line pays the opener and a space, and
      // every window pays its own provenance line. Charged inside the budget
      // rather than after it, because the ceiling a caller cares about is what
      // the prompt actually carries.
      maxChars: USAGE_WINDOW_BOUNDS.maxChars - header.length - lineComment.length - 1,
      perLineChars: lineComment.length + 1,
      perWindowChars: lineComment.length + 32,
    },
    { uri: cursor.uri, line: cursor.line },
  );
  const block = renderUsageComment(windows, header, lineComment);
  if (block === undefined) {
    return {
      reason: "every call site was the cursor's own line or unreadable",
      windows: 0,
      references: references.length,
      ms,
    };
  }
  return { block, windows: windows.length, references: references.length, ms };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
