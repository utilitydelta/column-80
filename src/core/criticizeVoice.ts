// ===========================================================================
// The words Criticize plants in a person's source file.
//
// THE TABLE IS THE VOICE, THE FINDING IS THE FACTS. Fifteen fixed phrases, one
// per dimension, written once and never generated. v60 measured a model
// deciding a finding set and got 0 of 3 identical sets on unchanged bytes at
// temperature 0; a model deciding the WORDS is the same defect one step later,
// because a comment that reads differently on every press is a comment nobody
// trusts and a diff nobody can accept twice. The detectors decide what fired,
// this table decides how it is said, and neither asks a model.
//
// THE AESTHETIC IS RULED AND IT IS NOT NEGOTIABLE (human, 2026-08-28). Three
// beats and stop:
//
//     <what it did>. <what that costs>. <what to do>.
//
// Bare contempt, no teaching. The curriculum line, the citation and the
// principle belong in the output panel and in docs/perfect-functions.md. A
// citation in a source file is a lecture nobody asked for, and the phrase that
// ends on the complaint has no order in it.
//
// THE COMMENT ATTACKS THE CODE AND NEVER THE AUTHOR. Second person is banned
// outright for that reason and not for politeness: "you went and read the
// clock" is a different product, one that a person installs once. Hedging is
// banned because an imperative that hedges is not an imperative.
//
// THOSE BANS POLICE THE TEXT THIS MODULE AUTHORS AND NOTHING ELSE: the table,
// the blast clause, and the punctuation between them. The detector's `detail`
// passes through untouched and is exempt, because the detectors own it.
// `public static Span Splice(string? first, string? second)` is everyday C#,
// so a question mark reaches the comment through the type name; a parameter
// genuinely called `you` puts a banned word there the same way. Sanitising
// either would make this module a second author of a claim it did not make,
// and a stray `?` is the smaller price.
//
// Pure: no vscode, no clock, no I/O, no randomness, and it never throws. The
// same finding produces the same bytes forever, which is what lets phase 2
// strip and re-inject on a second press without doubling anything.
// ===========================================================================

import {
  TIGHTEN_COLUMN,
  TIGHTEN_TAB_WIDTH,
  tightenTokens,
  tightenTrimEnd,
  tightenWidth,
  wrapTokens,
} from "./tightenRegion";
import { DetectorFinding, DimensionId } from "./criticizeTypes";

/** The marker every injected comment carries, INCLUDING its trailing space.
 *  `C80 ` is what a reader greps for and what the phase 2 strip pass matches,
 *  and a strip pass wants the exact bytes it removes, so the space is part of
 *  the marker rather than part of the join. A bare `C80` would also match a
 *  `C80_SOMETHING` identifier the developer wrote. The rendered text is
 *  identical either way; only the constant moves. */
export const C80_TAG = "C80 ";

/** The width a wrapped comment respects. The product is named for this column
 *  and `TIGHTEN_COLUMN` is already the one answer to "how wide"; a second
 *  constant here would be a second answer that drifts. */
export const VOICE_COLUMN = TIGHTEN_COLUMN;

/**
 * The fixed phrase per dimension. Fifteen entries, none empty, none generated.
 *
 * Each is three beats compressed as far as it goes without inverting: the
 * defect, its price, the order. The order is ALWAYS the last sentence, because
 * a comment a developer reads at the failing line has about one second of their
 * attention and the fix is the only part that changes the code.
 *
 * Written lower case, because the shipped comment reads `C80 clock: hidden
 * wall-clock read.` when the finding carries no detail of its own, and a
 * capital mid-sentence there would read as a shout. `criticizeComment` raises
 * the first letter itself when the detail goes in front.
 *
 * FROZEN BY CONSTRUCTION, not by `Readonly<>`. The annotation is a compile-time
 * claim and this table is the "not a model" invariant: any module that ends up
 * in the same bundle could otherwise rewrite the fixed voice of the whole
 * extension, on the one path that writes into a person's source file.
 */
export const VOICE: Readonly<Record<DimensionId, string>> = Object.freeze({
  // Honesty. All four have the same price and it is not "impure": the inputs
  // are not in the signature, so the function cannot be reproduced or tested.
  clock: "hidden wall-clock read. Untestable. Pass it in.",
  prng: "unseeded randomness inside a function that claims to compute. Two runs, two answers. Take the generator as a parameter.",
  env: "configuration smuggled in through the back door. Invisible from outside and unsettable in a test. Pass it in.",
  world: "filesystem access buried in a function that claims to compute. Untestable without a disk. Inject the reader.",

  // Signature empathy. The price is paid at the call site, and NO PHRASE IN
  // THIS TABLE SAYS SO. "call site" and "caller" belong to the blast clause,
  // which only speaks when a walk measured something; a phrase that used them
  // would make an unmeasured radius read like a measured one. Found by the
  // phase 1 blind oracle, which bans the whole family from an unmeasured
  // comment.
  "adjacent-params": "two swappable arguments in a row. A transposed call still compiles. Give them distinct types.",
  "bool-param": "a flag branching on a decision made somewhere else. A bare true tells the next reader nothing. Split it in two.",
  "unused-param": "dead weight in the signature. An argument nothing reads is paid for everywhere. Delete it.",
  "param-count": "a parameter list nobody calls correctly from memory. Positional slots that deep get transposed. Group them into one type.",

  // Contract. What the function promises, against what it enforces.
  undocumented: "published with no contract. The next reader reverse-engineers the body. Write the doc.",
  "unenforced-precondition": "a promise in prose with nothing behind it. Breaking it yields garbage instead of an error. Enforce it or drop the claim.",
  cqs: "a question with a side effect. Nobody can call it twice safely. Split the command from the query.",

  // Altitude. One function, one level of abstraction.
  "pass-through": "a layer that adds no depth. It costs a name, a jump and a test, and buys nothing. Delete it and call through.",
  nesting: "a staircase of guards and loops. Nobody can hold this. Split it.",
  "section-comment": "a labelled step still living inside a bigger body. The name exists and the function does not. Extract the section.",

  // Safety. The failure the signature refuses to admit.
  "unadmitted-failure": "a failure path the signature denies. Nobody writes a handler for what the type hides. Admit it in the type or in the doc.",
});

/**
 * The comment TEXT for one finding: no comment token, no indent, one line.
 *
 * THE TABLE SUPPLIES THE VOICE AND THE FINDING SUPPLIES THE FACTS, and the join
 * puts the facts first. `detail` arrives from the detector in lower case with no
 * trailing stop and is emitted VERBATIM, because the detector owns it: it is the
 * half that names this function's parameters, this function's depth and this
 * function's threshold, and a comment that could apply to any function is not
 * criticism. Re-wording it here would be this module inventing a finding.
 *
 * A malformed finding produces the empty string rather than a throw or a
 * half-comment. `wrapComment` turns that into no lines at all, so the failure
 * mode is a missing comment and never a bare `//` in someone's file.
 */
export function criticizeComment(
  finding: DetectorFinding,
  opts?: { blastRadius?: number },
): string {
  if (finding === null || typeof finding !== "object") {
    return "";
  }
  const dimension = finding.dimension;
  const voice = VOICE[dimension];
  if (typeof voice !== "string" || voice === "") {
    return "";
  }

  const parts: string[] = [];
  const detail = typeof finding.detail === "string" ? finding.detail.trim() : "";
  if (detail !== "") {
    parts.push(closed(detail));
  }
  const blast = blastSentence(opts?.blastRadius);
  if (blast !== undefined) {
    parts.push(blast);
  }
  // Lower case when the phrase is the whole comment, so it reads as one
  // sentence off the tag. Raised when a fact sentence went in front of it.
  parts.push(parts.length === 0 ? voice : leadCap(voice));
  return `${C80_TAG}${dimension}: ${parts.join(" ")}`;
}

/**
 * How many call sites an honest fix reaches, or NOTHING.
 *
 * Anything that is not a non-negative integer is UNMEASURED and produces no
 * clause. `NaN`, `Infinity`, `-1` and `2.5` all fall in here, so a corrupt
 * measurement and an absent one do share a spelling, and that is the lesser
 * evil: rendering `2.5 call sites` into a person's source file is worse than
 * saying nothing. The walk upstream never hands this module a non-integer.
 *
 * Undefined produces no clause at all: not "0", not "unknown", not a hedge. A
 * measured zero and an unmeasured one may not share a spelling, which is why a
 * walk that ran and found none says so in WORDS while a walk that did not run
 * says nothing. The card already holds that rule and this is the same rule at
 * the injection site.
 *
 * It sits BEFORE the phrase rather than after it, because the phrase's last
 * sentence is the order and nothing gets to come after the order.
 */
function blastSentence(callSites: number | undefined): string | undefined {
  if (typeof callSites !== "number" || !Number.isInteger(callSites) || callSites < 0) {
    return undefined;
  }
  if (callSites === 0) {
    return "No call sites ride on this signature.";
  }
  const noun = callSites === 1 ? "call site rides" : "call sites ride";
  return `${callSites} ${noun} on this signature.`;
}

/** The detector's own words, closed off as a sentence. It appends a stop and
 *  changes nothing else: the detail is the detector's property and re-wording
 *  it here would be a second author for the same claim. */
function closed(detail: string): string {
  return /[.!]$/.test(detail) ? detail : `${detail}.`;
}

function leadCap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The lines to emit for one comment, each already carrying `indent` and
 * `token`.
 *
 * REUSES THE TIGHTEN WRAPPER rather than writing a second one. `wrapTokens` is
 * the greedy fill behind `Column 80: Tighten Doc Comment`, it already measures
 * width in code POINTS with tabs at their real column cost, and it already
 * overflows a token wider than the whole budget onto its own line instead of
 * cutting it in half. A comment that split `resolveTightenRegion` across two
 * lines would destroy the identifier a reader is about to grep for.
 *
 * An empty text returns an EMPTY ARRAY. A blank comment injected into a
 * person's file is worse than no comment, and this is the one place that can
 * still prevent it.
 */
export function wrapComment(text: string, indent: string, token: string): string[] {
  const body = typeof text === "string" ? text.trim() : "";
  if (body === "") {
    return [];
  }
  const pad = typeof indent === "string" ? indent : "";
  const opener = typeof token === "string" ? token.trim() : "";
  const prefix = opener === "" ? "" : `${opener} `;
  // Never below 1: a pathological indent must still terminate the fill, one
  // token to a line, rather than loop.
  const budget = Math.max(
    1,
    VOICE_COLUMN - tightenWidth(pad, TIGHTEN_TAB_WIDTH) - tightenWidth(prefix, TIGHTEN_TAB_WIDTH),
  );
  const tokens = tightenTokens(body);
  if (tokens.length === 0) {
    return [];
  }
  return wrapTokens(tokens, budget, "", "", TIGHTEN_TAB_WIDTH).map((line) =>
    tightenTrimEnd(`${pad}${prefix}${line}`),
  );
}
