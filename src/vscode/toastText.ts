/** Every character the product treats as ending a line.
 *
 *  LF, CRLF, bare CR, U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR and
 *  U+0085 NEL. CRLF is listed first so the pair is consumed as one break rather
 *  than as two, which would otherwise leave a blank segment between every pair
 *  of lines in a Windows-authored message.
 *
 *  Why the whole set and not just `\n`: `firstLine` is the product's universal
 *  toast bound and it also cuts SERVER-AUTHORED text. Splitting on `\n` alone
 *  let a bare CR, U+2028, U+2029 or NEL through, and a notification carrying one
 *  renders as two visual lines with no channel pointer - which is exactly the
 *  defect roadmap item 63 closed for `\n` and item 69 closes for the rest.
 *  `\r\n` worked by accident before this, because `trim()` eats the trailing
 *  `\r`.
 *
 *  VT and FF are deliberately absent: VS Code's text model does not break a row
 *  on them. `escapeBreaks` in `src/core/errorBound.ts` names the same five for
 *  the same reason, and the two must move together if either ever moves. */
const LINE_BREAKS = /\r\n|[\n\r\u2028\u2029\u0085]/;

/** The first non-blank line of a multi-line message, for a one-line toast.
 *
 *  A leaf module on purpose: fnGen, tightenDocComment, firstRun and
 *  oracleSurface all bound their toasts with it, and neither tightenDocComment
 *  nor firstRun nor oracleSurface may import fnGen (fnGen registers them, so a
 *  value edge back would be a cycle). */
export function firstLine(s: string | undefined): string {
  return (s ?? "").split(LINE_BREAKS).find((l) => l.trim().length > 0)?.trim() ?? "";
}

/** Whether cutting this message to one line drops anything a reader wants.
 *
 *  More than one non-blank segment means there is content past the first line,
 *  so a pointer at the channel is a true promise. One or none means the cut
 *  removed nothing but whitespace and breaks, and a pointer would be a promise
 *  with nothing behind it.
 *
 *  This is stated rather than derived from `trim()`, which is how it used to be
 *  decided (`firstLine(why) === why.trim()`). `trim()` strips U+2028 and U+2029,
 *  which are LineTerminators, and does NOT strip U+0085, which is a control
 *  character - so under the widened set a message ending in U+2029 would get no
 *  pointer and the same message ending in NEL would get one, pointing at
 *  nothing. That difference is an accident of `trim()`'s definition rather than
 *  anything about the message. On a message broken only by `\n` this answers
 *  exactly what the old comparison answered. */
export function hasMoreThanOneLine(s: string | undefined): boolean {
  return (s ?? "").split(LINE_BREAKS).filter((l) => l.trim().length > 0).length > 1;
}

/** A message cut to one line, with the channel pointer when the cut dropped
 *  something. The shape every toast that carries interpolated text should take.
 *
 *  `end` is punctuation the CALLER wants on the sentence. It is applied after
 *  the cut, never before: a caller that builds `${why}.` and hands the result in
 *  loses its own period to the cut and glues the pointer onto a truncated
 *  clause.
 *
 *  `tail` is a clause that must survive on the same line, for the callers whose
 *  interpolation sits MID-sentence rather than at the end. The repair-refine
 *  toast is the case: its message is followed by an instruction to undo, and a
 *  naive cut would take the instruction with it. The pointer, when there is one,
 *  goes after the tail, because the pointer is about the whole notification. */
export function oneLineWithPointer(text: string, end = "", tail = ""): string {
  const one = firstLine(text);
  const body = `${one}${end}${tail}`;
  return hasMoreThanOneLine(text) ? `${body} The full message is in the output channel.` : body;
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
  return oneLineWithPointer(why, end);
}
