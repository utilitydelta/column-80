/**
 * Dimensions 5 to 8: is the signature kind to the person calling it.
 *
 * The signature is used first by a HUMAN, and it is read far more often than
 * the body under it. These four read the parameter list only: two neighbours of
 * one type that the compiler will happily let a caller swap, a boolean that
 * carries a decision the caller already made, a parameter the body never
 * touches, and a list long enough that nobody remembers the order.
 *
 * ALL FOUR ADVISE. Nothing here splits a function, reorders a parameter list or
 * introduces an argument struct: every one of those fixes changes the signature
 * and ripples to every caller, and the developer is the one who knows what that
 * costs.
 *
 * TWO REFUSALS ARE MEASURED, and both are the difference between an answer and
 * a lie:
 *
 *  - GO IS EXEMPT ON DIMENSION 5. `func f(a, b int)` is adjacent-same-typed
 *    spelled by the language itself, so flagging it would be flagging Go
 *    rather than the code, and the grouped spelling refuses BY NAME. Two
 *    SEPARATELY typed Go neighbours of one type still fire; only the grouped
 *    spelling is exempt. Measured here at 8.3% of 39,394 Go standard-library
 *    declarations. The scout's 36.1% for the same shape is an over-count: its
 *    regex accepted `(sp []sparseEntry, size int64)`, which is two separately
 *    typed parameters, and the correction is written up in the session scraps.
 *  - PYTHON IS BLIND ON 5 AND 6 UNLESS EVERY PARAMETER IS ANNOTATED. Measured
 *    on 510 Python functions: 13.7% annotate all of them. On the other 86.3%
 *    there is no type to compare, and reporting `clean` would be a lie by
 *    omission dressed as a verdict.
 *
 * Never imports vscode (the src/core rule).
 */

import { parseParams } from "./criticizeLang";
import {
  CriticizeLang,
  Detector,
  DetectorFinding,
  DimensionId,
  DimensionOutcome,
  FunctionUnderReview,
  ParsedParam,
  maskedBody,
  unitDefect,
} from "./criticizeTypes";

/** The parameters of one function, or the reason no dimension here can read
 *  them. Every caller turns the reason into a `blind` outcome, because a
 *  signature nothing could parse is a signature nothing examined. */
type ParamRead =
  | { ok: true; params: readonly ParsedParam[]; evidence: string; line: number }
  | { ok: false; reason: string };

function readParams(fn: FunctionUnderReview, lang: CriticizeLang): ParamRead {
  const defect = unitDefect(fn);
  if (defect !== undefined) {
    return { ok: false, reason: `this function's slice cannot be read: ${defect}` };
  }
  const params = parseParams(fn, lang);
  if (params === undefined) {
    return {
      ok: false,
      reason: `the parameter list of this ${lang.displayName} declaration could not be read, so nothing here examined it`,
    };
  }
  const evidence = fn.lines[fn.headIndex].trim();
  if (evidence === "") {
    return {
      ok: false,
      reason: `the declaration head of this ${lang.displayName} function is blank, so there is no signature to quote`,
    };
  }
  return { ok: true, params, evidence, line: fn.startLine + fn.headIndex };
}

/**
 * The one finding these dimensions emit, always at the declaration head.
 *
 * A signature dimension reports the SIGNATURE, so several offending parameters
 * on one head are one finding naming all of them rather than several findings
 * at one line. The seam forbids a repeated (dimension, line) pair, and the
 * developer reading it wants the list anyway.
 */
function headFinding(dimension: DimensionId, read: Extract<ParamRead, { ok: true }>, detail: string): DimensionOutcome {
  const finding: DetectorFinding = { dimension, line: read.line, evidence: read.evidence, detail };
  return { state: "flagged", findings: [finding] };
}

/** "a", "a and b", "a, b and c". Used in a detail line, so it stays lower case
 *  and stays on one line. */
function nameList(names: readonly string[]): string {
  if (names.length === 1) {
    return names[0];
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The verb that agrees with a `nameList` of this length. A single-item list is
 *  a singular subject, and both of the sentences that build one reach the
 *  developer, so "x carry none" is a defect the reader sees. */
function agrees(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/** Types compare as written, with runs of whitespace flattened. A detector that
 *  resolved aliases would need the symbol tree; this one asks the narrower
 *  question the caller sees at the call site, which is whether the two read the
 *  same in the signature.
 *
 *  This function fires on its own dimension 5, and it is left that way: the
 *  relation is symmetric, so a caller who swaps the two arguments gets the same
 *  answer. That is the whole reason the dimension ADVISES rather than repairs -
 *  the detector cannot know which adjacent pair matters. */
function sameType(left: ParsedParam, right: ParsedParam): boolean {
  if (left.type === undefined || right.type === undefined) {
    return false;
  }
  return left.type.replace(/\s+/g, " ") === right.type.replace(/\s+/g, " ");
}

/** Python's coverage gap, or undefined when every parameter carries a type.
 *  Applies to dimensions 5 and 6, the two that must read a type to answer. */
function annotationGap(lang: CriticizeLang, params: readonly ParsedParam[]): string | undefined {
  if (lang.craft.paramStyle !== "python") {
    return undefined;
  }
  const bare = params.filter((p) => p.type === undefined);
  if (bare.length === 0) {
    return undefined;
  }
  return `Python type hints are optional and ${nameList(bare.map((p) => p.name))} ${agrees(bare.length, "carries", "carry")} none, so this dimension has no type to read; 13.7% of measured Python functions annotate every parameter, and a clean result on the rest would be a lie by omission`;
}

// ===========================================================================
// Dimension 5, adjacent same-typed parameters
// ===========================================================================

function adjacentParams(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome {
  const read = readParams(fn, lang);
  if (!read.ok) {
    return { state: "blind", reason: read.reason };
  }

  // The Go exemption. It is the language's own spelling for "these two share a
  // type", present on 8.3% of the standard library's declarations, and a
  // developer who writes it has said something deliberate rather than made the
  // mistake this dimension is about.
  if (read.params.some((p) => p.grouped)) {
    return {
      state: "blind",
      reason: "Go spells several names against one type as its own idiom, on 8.3% of its standard library's declarations, so flagging a grouped parameter list would be flagging Go rather than this code",
    };
  }

  const gap = annotationGap(lang, read.params);
  if (gap !== undefined) {
    return { state: "blind", reason: gap };
  }

  const clauses: string[] = [];
  for (let i = 1; i < read.params.length; i++) {
    const left = read.params[i - 1];
    const right = read.params[i];
    if (sameType(left, right)) {
      clauses.push(`${left.name} and ${right.name} are neighbours of type ${right.type}`);
    }
  }
  if (clauses.length === 0) {
    return { state: "clean" };
  }
  return headFinding("adjacent-params", read, `${clauses.join(", ")}, and the compiler cannot see them swapped at a call site`);
}

// ===========================================================================
// Dimension 6, boolean parameter
// ===========================================================================

function boolParam(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome {
  const read = readParams(fn, lang);
  if (!read.ok) {
    return { state: "blind", reason: read.reason };
  }
  const gap = annotationGap(lang, read.params);
  if (gap !== undefined) {
    return { state: "blind", reason: gap };
  }

  // A boolean RETURN is not this dimension and never has been. `is_empty()`
  // answering true or false is the shape the frame WANTS; the flag going the
  // other way is the one that carries a decision the caller already made.
  const bools = read.params.filter((p) => p.type !== undefined && lang.craft.boolTypes.includes(p.type.trim()));
  if (bools.length === 0) {
    return { state: "clean" };
  }
  const label = agrees(bools.length, "parameter", "parameters");
  return headFinding(
    "bool-param",
    read,
    `${label} ${nameList(bools.map((p) => p.name))} ${agrees(bools.length, "carries", "carry")} a decision the caller had already made`,
  );
}

// ===========================================================================
// Dimension 7, unused parameter
// ===========================================================================

/** Whether `name` appears as an identifier anywhere in the masked body.
 *  MASKED, so a parameter named only in a comment or a string is unused: the
 *  body does not read it, and the comment saying otherwise is the problem. */
function mentionedInBody(name: string, body: readonly string[]): boolean {
  const identifier = new RegExp(`(^|[^A-Za-z0-9_$])${name.replace(/\$/g, "\\$")}([^A-Za-z0-9_$]|$)`);
  return body.some((line) => identifier.test(line));
}

function unusedParam(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome {
  const read = readParams(fn, lang);
  if (!read.ok) {
    return { state: "blind", reason: read.reason };
  }
  const body = maskedBody(fn, lang);
  const unused = read.params.filter((p) => {
    // A leading underscore is the language's OWN way of saying "deliberately
    // unused" in Rust, Go, Python and TypeScript. C# has no such convention,
    // where a leading underscore names a field, so C# fires either way.
    if (lang.craft.underscoreMeansUnused && p.name.startsWith("_")) {
      return false;
    }
    return !mentionedInBody(p.name, body);
  });
  if (unused.length === 0) {
    return { state: "clean" };
  }
  const label = unused.length === 1 ? "parameter" : "parameters";
  const verb = unused.length === 1 ? "never appears" : "never appear";
  return headFinding("unused-param", read, `${label} ${nameList(unused.map((p) => p.name))} ${verb} in the body`);
}

// ===========================================================================
// Dimension 8, parameter count
// ===========================================================================

function paramCount(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome {
  const read = readParams(fn, lang);
  if (!read.ok) {
    return { state: "blind", reason: read.reason };
  }
  const threshold = lang.craft.paramCountThreshold;
  if (read.params.length < threshold) {
    return { state: "clean" };
  }
  return headFinding(
    "param-count",
    read,
    `${read.params.length} parameters, at or above the chosen threshold of ${threshold} for ${lang.displayName}`,
  );
}

/**
 * Dimensions 5 to 8, in rubric order.
 *
 * The thresholds behind dimension 8 are CHOSEN, not measured, and they say so
 * in `docs/constants.md` with that word. Nothing in the scout's corpora says
 * where the knee in a parameter list sits; what a long list costs is a taste
 * the audience dictates, and the number is on the profile so a measurement can
 * move one language later without disturbing the other four.
 */
export const SIGNATURE_DETECTORS: readonly Detector[] = [
  {
    dimension: "adjacent-params",
    axis: "both",
    source: "King 2019, parse don't validate: put the invariant in the parameter type, because two neighbours of one type are swappable and the compiler cannot see it",
    run: adjacentParams,
  },
  {
    dimension: "bool-param",
    axis: "both",
    source: "Acton 2014, data-oriented design: a bool checked inside a function is a decision the caller already made, paid for on every element",
    run: boolParam,
  },
  {
    dimension: "unused-param",
    axis: "understandable",
    source: "Logan Smith 2026, signature empathy: ask for the weakest thing the body actually needs, because over-constraining the caller buys nothing",
    run: unusedParam,
  },
  {
    dimension: "param-count",
    axis: "understandable",
    source: "Logan Smith 2026, signature empathy: six positional arguments with implicit conversions is hostile, an args struct or strong types is kind",
    run: paramCount,
  },
];
