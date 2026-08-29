/**
 * Dimension 13: can this function fail in a way its signature never admits.
 *
 * ONE IDEA, FIVE DETECTORS, and the meaning genuinely changes per language.
 * This is the dimension that proves the per-language axis is real rather than a
 * table of spellings:
 *
 *  - RUST fires on `unwrap`, `expect`, `panic!`, `unreachable!` or `todo!` in a
 *    body whose return type is neither `Result` nor `Option`. The same call
 *    inside a `Result`-returning function is CLEAN: the signature already told
 *    the caller failure was possible. Measured at 14.1%, the highest-firing
 *    dimension in the rubric, and the measured crate carries 446 bare
 *    `.unwrap()` calls outside its tests. That is a refactor worklist, not a
 *    verdict on the crate.
 *  - GO fires on a DROPPED ERROR, not a panic. Go does not idiomatically panic:
 *    measured in the standard library, 3.4% of functions drop an error against
 *    4.3% that panic, and the dropped error is the one a Go developer
 *    recognises as the failure. `(T, error)` is enforced honesty, and `_ =`
 *    is how a developer opts out of it.
 *  - C# fires on a throw the doc comment never lists in an `<exception>`
 *    element.
 *  - PYTHON fires on a `raise` with no `Raises:` section in the docstring.
 *  - TYPESCRIPT IS ALWAYS BLIND. The language has no checked exceptions, so
 *    nothing in a signature could ever have admitted a throw, and there is no
 *    version of this question TypeScript can answer. The refusal says exactly
 *    that. Reporting `clean` would be claiming every TypeScript function is
 *    safe, which is the most expensive lie this seam could tell.
 *
 * ADVISE ONLY. Nothing here adds a `?`, wraps a return type or writes an
 * `<exception>` element: every one of those changes the signature.
 *
 * Never imports vscode (the src/core rule).
 */

import { signatureParts } from "./criticizeLang";
import {
  BodyLine,
  CriticizeLang,
  Detector,
  DetectorFinding,
  DimensionOutcome,
  FunctionUnderReview,
  bodyLines,
  docLines,
  unitDefect,
} from "./criticizeTypes";

/** A return type that already admits failure. Both spellings hand the failure
 *  to the caller, which is the whole of what this dimension asks for. */
const ADMITS_FAILURE = /\b(Result|Option)\b/;

/** The comparison and assignment operators a `=` can be part of without being
 *  an assignment. Go's dropped-error scan splits on the assignment and must not
 *  split on `==`. */
const NOT_AN_ASSIGNMENT = /[=!<>+\-*/%&|^]=|=[=]/;

function findings(lines: readonly { line: BodyLine; detail: string }[]): DimensionOutcome {
  const out: DetectorFinding[] = [];
  const seen = new Set<number>();
  for (const entry of lines) {
    if (seen.has(entry.line.line) || entry.line.raw.trim() === "") {
      continue;
    }
    seen.add(entry.line.line);
    out.push({
      dimension: "unadmitted-failure",
      line: entry.line.line,
      evidence: entry.line.raw.trim(),
      detail: entry.detail,
    });
  }
  return out.length === 0 ? { state: "clean" } : { state: "flagged", findings: out };
}

// ===========================================================================
// The five rules
// ===========================================================================

/** Rust: a panic in a body whose signature admits no failure. */
function rustPanics(fn: FunctionUnderReview, lang: CriticizeLang, spellings: readonly RegExp[], body: readonly BodyLine[]): DimensionOutcome {
  const parts = signatureParts(fn, lang);
  if (parts === undefined) {
    return {
      state: "blind",
      reason: `the declaration head of this ${lang.displayName} function could not be read, so what its signature admits is unknown`,
    };
  }
  if (ADMITS_FAILURE.test(parts.result)) {
    return { state: "clean" };
  }
  const hits = body
    .filter((line) => spellings.some((spelling) => spelling.test(line.masked)))
    .map((line) => ({ line, detail: "the body can panic and the return type admits no failure" }));
  return findings(hits);
}

/**
 * Go: an error return assigned to `_`.
 *
 * `range` is excluded because `for _, row := range rows` discards an INDEX and
 * not an error, and it is one of the most common lines in the language.
 */
function goDroppedErrors(body: readonly BodyLine[]): DimensionOutcome {
  const hits: { line: BodyLine; detail: string }[] = [];
  for (const line of body) {
    const text = line.masked;
    if (/\brange\b/.test(text)) {
      continue;
    }
    const at = text.search(/:?=/);
    if (at < 0 || NOT_AN_ASSIGNMENT.test(text.slice(Math.max(0, at - 1), at + 2))) {
      continue;
    }
    const targets = text.slice(0, at).split(",").map((t) => t.trim());
    const right = text.slice(at + 1).replace(/^=/, "").trim();
    // `_, ok := v.(*T)` is a TYPE ASSERTION, not a call, and the discarded slot
    // is the value rather than an error. Requiring the character before the
    // paren to be a word, a `)` or a `]` keeps the assertion out: only a call
    // has a NAME in front of its parenthesis.
    // THE LAST slot, not any slot. Go's convention puts the error last, so
    // `_, err = w.Seek(n)` discards a byte count and KEEPS the error, and
    // firing on it read 15.1% of the standard library against the 3.4% the
    // scout measured for a dropped error.
    if (targets[targets.length - 1] !== "_" || !/[\w\])]\s*\(/.test(right)) {
      continue;
    }
    hits.push({ line, detail: "an error returned by this call is assigned away" });
  }
  return findings(hits);
}

/** C#: a throw the doc never lists in an `<exception>` element. */
function csharpThrows(fn: FunctionUnderReview, lang: CriticizeLang, body: readonly BodyLine[]): DimensionOutcome {
  const doc = docLines(fn, lang).join(" ");
  const hits: { line: BodyLine; detail: string }[] = [];
  for (const line of body) {
    const thrown = line.masked.match(/\bthrow\s+new\s+([\w.]+)/);
    if (thrown === null) {
      continue;
    }
    const type = thrown[1].split(".").pop() ?? thrown[1];
    if (new RegExp(`<exception[^>]*${type}`).test(doc)) {
      continue;
    }
    hits.push({ line, detail: `the doc lists no <exception> element for ${type}` });
  }
  return findings(hits);
}

/** Python: a raise with no `Raises:` section in the docstring. */
function pythonRaises(fn: FunctionUnderReview, lang: CriticizeLang, body: readonly BodyLine[]): DimensionOutcome {
  if (/(^|\s)Raises:/.test(docLines(fn, lang).join("\n"))) {
    return { state: "clean" };
  }
  const hits = body
    .filter((line) => /^\s*raise\b/.test(line.masked))
    .map((line) => ({ line, detail: "the docstring has no Raises: section for this raise" }));
  return findings(hits);
}

// ===========================================================================
// The dimension
// ===========================================================================

function unadmittedFailure(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome {
  const defect = unitDefect(fn);
  if (defect !== undefined) {
    return { state: "blind", reason: `this function's slice cannot be read: ${defect}` };
  }
  const rule = lang.craft.failure;
  if (rule.kind === "unknowable") {
    return { state: "blind", reason: rule.reason };
  }
  const body = bodyLines(fn, lang);
  switch (rule.kind) {
    case "panic-without-result":
      return rustPanics(fn, lang, rule.spellings, body);
    case "dropped-error":
      return goDroppedErrors(body);
    case "undocumented-throw":
      return csharpThrows(fn, lang, body);
    case "raise-without-doc":
      return pythonRaises(fn, lang, body);
  }
}

/**
 * Dimension 13, alone in its module because it is alone in its axis: this is
 * the one dimension of the ten that is purely about SAFETY rather than about
 * the next reader.
 */
export const SAFETY_DETECTORS: readonly Detector[] = [
  {
    dimension: "unadmitted-failure",
    axis: "safer",
    source: "the Go proverbs and Rust culture: a function that can fail says so in its signature, and the caller must look the failure in the eye",
    run: unadmittedFailure,
  },
];
