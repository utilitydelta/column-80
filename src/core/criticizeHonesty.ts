/**
 * Dimensions 1 to 4 of the rubric: does the signature tell the truth about what
 * comes IN.
 *
 * An honest function touches the world only through its signature. It reads
 * nothing and writes nothing the caller did not hand it, which is purity with
 * the religion removed: an in-place sort is honest because it mutates only what
 * you gave it and says so, and `getTime()` is dishonest because its signature
 * is a lie of omission and the real input is the state of the universe.
 *
 * THIS FILE NO LONGER DECIDES THOSE FOUR ROWS. Until 2026-08-29 it ran 67
 * regular expressions across five languages, one name table per dimension per
 * language, and the file's own header confessed what the table could never
 * answer: the honesty question's core is "does this function read a name bound
 * outside it", and no name table can answer it, because the name is whatever
 * the developer called their variable. That was proven on the product's own
 * canonical dishonest function, where the table caught the clock read and
 * missed BOTH the module-state read and the module-state write, which is the
 * headline dishonesty in that example. The confession is now the reason for the
 * change rather than a caveat printed under a shipped answer. Human ruling,
 * recorded in the amendment at the end of session-v64/goal.md: no hardcoded
 * string table that matches specific code or functions, and the four dimensions
 * become a model's judgement. The judge is `criticizeHonestyModel.ts`.
 *
 * WHY THE FOUR DETECTORS STILL EXIST, AND WHY THEY REFUSE. A `Detector.run` is
 * SYNCHRONOUS AND PURE, which is the property `scoreFunction` rests on: the
 * same bytes score the same way twice, with no I/O and no clock. A model round
 * is neither synchronous nor pure. So the two cannot be the same pass, and the
 * shape that falls out is two passes: the sync pass builds a complete fourteen
 * row card in which these four rows are an honest REFUSAL, and an async pass
 * replaces those four outcomes through `applyHonesty` once the model has
 * answered. A caller that never runs the model ships a card that says nothing
 * here examined this function, which is true.
 *
 * `clean` IS THE ONE THING THEY MUST NOT SAY. A `clean` row from a judgement
 * that never ran is the same false certificate the name tables handed out, and
 * this whole change exists because that certificate was not honest. The card
 * already has a word for "nothing here can tell you": `blind`, with a reason.
 *
 * ALL FOUR ADVISE AND NONE OF THEM REPAIRS, and the reason is structural rather
 * than cautious: the honest fix injects the dependency at the topmost level and
 * passes it in as an argument, which changes the signature and ripples to every
 * caller. Nothing in this file may name that fix, either. The rubric says which
 * law was broken and shows the line; the developer decides what it costs.
 *
 * Never imports vscode (the src/core rule).
 */

import { Detector, DimensionOutcome } from "./criticizeTypes";

export type { Detector } from "./criticizeTypes";

/** The one sentence all four refuse with before a model round has run.
 *
 *  It names the mechanism rather than the backend, because at this point no
 *  backend has been chosen or reached: a reason naming one would be a guess.
 *  `honestyBlindReason` in `criticizeHonestyModel.ts` is the sentence for a
 *  round that DID run and failed, and that one names the backend. */
const UNJUDGED = "this dimension is decided by a model reading the function, and no model round has run for this card, so nothing here can tell you whether this function reads the world";

/** The refusal every one of the four carries out of the synchronous pass. */
function unjudged(): DimensionOutcome {
  return { state: "blind", reason: UNJUDGED };
}

/**
 * Dimensions 1 to 4, in rubric order.
 *
 * The shape is unchanged from the name-table build on purpose: four detectors,
 * the same four dimension ids, the same axis and the same curriculum source
 * lines. `scoreFunction` still emits four honesty rows in the same positions,
 * and the renderer, the elevation policy and the blast-radius set never learn
 * that the engine underneath moved.
 *
 * All four carry the axis "both" rather than picking a half. Honesty is the one
 * place in the rubric where the two halves are the same property: a function
 * whose real inputs are not in its signature cannot be tested or reproduced,
 * which is the safety half, and cannot be reasoned about locally by the next
 * reader, which is the understandability half.
 */
export const HONESTY_DETECTORS: readonly Detector[] = [
  {
    dimension: "clock",
    axis: "both",
    source: "Logan Smith 2026, honest functions: an honest function touches the world only through its signature",
    run: () => unjudged(),
  },
  {
    dimension: "prng",
    axis: "both",
    source: "Logan Smith 2026, honest functions: the PRNG is the canonical example, a function that reads a global generator is untestable and unreproducible",
    run: () => unjudged(),
  },
  {
    dimension: "env",
    axis: "both",
    source: "Logan Smith 2026, honest functions: the signature is a lie of omission, and the real input is the state of the universe",
    run: () => unjudged(),
  },
  {
    dimension: "world",
    axis: "both",
    source: "Logan Smith 2026, honest functions: build the core out of honest functions and inject the I/O at the topmost level, passed in as arguments",
    run: () => unjudged(),
  },
];
