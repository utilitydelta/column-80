/** The first non-blank line of a multi-line message, for a one-line toast.
 *
 *  A leaf module on purpose: fnGen, tightenDocComment and firstRun all bound
 *  their toasts with it, and neither tightenDocComment nor firstRun may import
 *  fnGen (fnGen registers both, so a value edge back would be a cycle). */
export function firstLine(s: string | undefined): string {
  return (s ?? "").split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
}

/** What a disabled tier toasts. The tier's message is written to the channel
 *  whole and rendered here as ONE line, because a tier message can interpolate
 *  a thrown error and a notification that carries a newline is the defect this
 *  closes (roadmap item 63, third string).
 *
 *  The channel pointer is CONDITIONAL, and that is the point: every tier message
 *  authored in the product is already one line, so on the ordinary path nothing
 *  is dropped and a pointer would be a promise with nothing behind it. It is
 *  appended only when the cut actually removed something.
 *
 *  Here rather than in fnGen.ts for the reason the file header gives:
 *  tightenDocComment renders this same refusal and must not take a value edge
 *  back to fnGen, which registers it. */
export function tierDisabledToast(why: string, end = ""): string {
  const one = firstLine(why);
  // `end` is punctuation the CALLER wants on the sentence. It is applied after
  // the cut, never before: a caller that builds `${why}.` and hands the result
  // in loses its own period to the cut and glues the pointer onto a truncated
  // clause.
  return one === why.trim() ? `${one}${end}` : `${one}${end} The full message is in the output channel.`;
}
