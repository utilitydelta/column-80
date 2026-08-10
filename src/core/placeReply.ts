/**
 * Place a generated reply at the target's column, for every registered language.
 *
 * THE one dispatcher. Generation, repair and refine all splice a model reply
 * into a resolved span, and each used to carry its own copy of the language
 * chain. The copies drifted: two of the three had no Python leg for a target
 * without a docstring, so a nested Python function got a flush-left body spliced
 * at a nested span. One function, three callers, no room to drift again.
 *
 * The rule every leg holds is in reindent.ts: the reply's own base column comes
 * off before the target's goes on, because a model shown written code answers in
 * place. Registered here: python, csharp, rust, go and the TS ids.
 *
 * dedentReplyCode is the same table read backwards, for the repair path: code
 * going INTO a prompt is normalised to column zero by the same language's
 * scanner that will place the reply coming out. One table, two directions, no
 * room for them to disagree about a language.
 *
 * Pure: no vscode, no clock, no I/O.
 */

import { dedentCsBody, reindentCsBody } from "./csExtraction";
import { dedentRustBody, reindentRustBody } from "./extraction";
import { dedentGoBody, reindentGoBody } from "./goExtraction";
import { dedentPyBody, reindentPyBlock, reindentPyBody } from "./pyExtraction";
import { TS_LANGUAGE_IDS, dedentTsBody, reindentTsBody } from "./tsExtraction";

export interface ReplyPlacement {
  languageId: string;
  /** Python Fork A: the reply is the BODY that goes below a preserved docstring,
   *  not a whole definition. */
  bodyOnly?: boolean;
  /** The leading whitespace of the target's header line. Empty (a top-level
   *  target) makes every leg a byte-for-byte no-op. REQUIRED, so a new caller
   *  that forgets it is a compile error rather than a silent return of the bug
   *  this dispatcher exists to kill; pass "" to mean "do not shift". */
  headerIndent: string;
  /** The body column for a bodyOnly target: the docstring's own indentation,
   *  never a hardcoded four. */
  bodyIndent?: string;
}

/**
 * The reply as it should be spliced. A bodyOnly reply leads with a newline,
 * because it lands below a docstring that stays on its own line.
 *
 * An unregistered language is returned untouched: no leg means no guess about
 * where its code sits.
 */
export function placeGeneratedReply(text: string, placement: ReplyPlacement): string {
  const { languageId } = placement;
  // Required in the type so a new caller cannot forget it, and normalised anyway
  // so a JS caller or an injected record that omits it means "do not shift".
  // Untyped, an absent indent reaches the legs as `undefined` and every code line
  // in the human's file gets the word "undefined" nailed to its front.
  const headerIndent = placement.headerIndent ?? "";
  if (languageId === "python") {
    return placement.bodyOnly
      ? "\n" + reindentPyBlock(text, placement.bodyIndent ?? "")
      : reindentPyBody(text, headerIndent);
  }
  if (languageId === "csharp") {
    return reindentCsBody(text, headerIndent);
  }
  if (languageId === "rust") {
    return reindentRustBody(text, headerIndent);
  }
  if (languageId === "go") {
    return reindentGoBody(text, headerIndent);
  }
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return reindentTsBody(text, headerIndent);
  }
  return text;
}

/**
 * The declared INVERSE of placeGeneratedReply: code read out of a document,
 * normalised to its own column zero.
 *
 * A span starts at the declaration's first character, so its first line is
 * flush while every later line carries the file's absolute column. Handed to a
 * model that way, the reply comes back in the same shape and the placement adds
 * the target's indent on top of an indent the body already had — one level per
 * round, cumulative. Normalising here means every reply the placement sees is
 * relative to a flush-left head, which is the one thing that rule assumes.
 *
 * An unregistered or absent language is returned untouched, the same rule
 * placeGeneratedReply states: no leg means no guess about where its code sits.
 *
 * `spanIndent` is the column the span was cut from, when the caller holds it:
 * the same `headerIndent` this module's other half is handed on the way back,
 * or `bodyIndent` for a body-only span. Supplied, the dedent is exact. Absent,
 * each leg infers, which is right for a braced language and cannot be for
 * Python (see dedentToZeroBase).
 */
export function dedentReplyCode(
  code: string,
  languageId: string | undefined,
  spanIndent?: string,
): string {
  if (languageId === undefined) {
    return code;
  }
  if (languageId === "python") {
    return dedentPyBody(code, spanIndent);
  }
  if (languageId === "csharp") {
    return dedentCsBody(code, spanIndent);
  }
  if (languageId === "rust") {
    return dedentRustBody(code, spanIndent);
  }
  if (languageId === "go") {
    return dedentGoBody(code, spanIndent);
  }
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return dedentTsBody(code, spanIndent);
  }
  return code;
}
