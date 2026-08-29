/**
 * Dimensions 8 to 10: does the function promise something, and hold to it.
 *
 * Three questions a reader of the INTERFACE asks. Is there a contract at all.
 * Does the contract say something the body never checks. And does the function
 * quietly do two jobs, answering a question while changing the world.
 *
 * ALL THREE ADVISE. Nothing here writes a doc comment, inserts a guard or
 * splits a query off a command.
 *
 * WHAT IS PUBLIC IS FIVE DIFFERENT THINGS, and the profile decides rather than
 * the detector: Rust's `pub`, C#'s `public` and `protected`, TypeScript's
 * `export`, Go's CAPITALISATION, and Python's leading-underscore convention.
 * A PRIVATE undocumented function is CLEAN in every one of them, because
 * Knuth's point is about the reader of an interface and a private function has
 * no readers but its own module.
 *
 * PYTHON ANSWERS DIMENSION 9 RATHER THAN REFUSING IT. The underscore convention
 * is enough to tell public from private, so the detector answers; what the
 * language does not do is ENFORCE it, and that fact belongs in the finding's
 * detail. A refusal is for a question the language cannot answer at all, and
 * this is not one.
 *
 * DIMENSION 11 CHANGES MACHINERY AND VALUE ACROSS THE FIVE. Rust reads a
 * `&mut self` receiver, Go a pointer receiver written through, and the other
 * three a field assignment. It measures 6.0% in C# and 0.0% in Rust, and the
 * Rust zero is genuine and hand-verified: ownership and `&mut` make Meyer's
 * violation culturally rare there. This detector earns its keep in C# and is
 * close to dead weight in Rust, and that is the per-language aesthetic working
 * rather than a broken leg.
 *
 * Never imports vscode (the src/core rule).
 */

import { parseParams, signatureParts } from "./criticizeLang";
import {
  BodyLine,
  CriticizeLang,
  Detector,
  DimensionId,
  DimensionOutcome,
  FunctionUnderReview,
  bodyLines,
  docLines,
  unitDefect,
} from "./criticizeTypes";

/** One finding, one outcome. Every dimension in this file reports at most one
 *  site per function: the contract is a property of the whole function, not of
 *  each line that participates in it.
 *
 *  The site is one argument rather than three because `evidence` and `detail`
 *  are both strings and were adjacent: the rubric's own dimension 5 fired on
 *  this function, and a caller that swapped them would have compiled. */
function one(dimension: DimensionId, site: { line: number; evidence: string; detail: string }): DimensionOutcome {
  const { line, evidence, detail } = site;
  if (evidence.trim() === "") {
    return {
      state: "blind",
      reason: `the line this finding would quote is blank, and a finding with no evidence is a defect rather than a weak finding`,
    };
  }
  return { state: "flagged", findings: [{ dimension, line, evidence: evidence.trim(), detail }] };
}

function refusal(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome | undefined {
  const defect = unitDefect(fn);
  if (defect !== undefined) {
    return { state: "blind", reason: `this function's slice cannot be read: ${defect}` };
  }
  if (signatureParts(fn, lang) === undefined) {
    return {
      state: "blind",
      reason: `the declaration head of this ${lang.displayName} function could not be read, so nothing here examined it`,
    };
  }
  return undefined;
}

// ===========================================================================
// Dimension 8, public and undocumented
// ===========================================================================

function isPublic(fn: FunctionUnderReview, lang: CriticizeLang): boolean {
  const parts = signatureParts(fn, lang);
  if (parts === undefined) {
    return false;
  }
  const surface = lang.craft.publicSurface;
  switch (surface.kind) {
    case "keyword":
      return surface.pattern.test(parts.head);
    case "capitalised":
      return /^[A-Z]/.test(parts.declaredName);
    case "leading-underscore":
      return parts.declaredName !== "" && !parts.declaredName.startsWith("_");
  }
}

function undocumented(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome {
  // DELEGATED WHERE THE LANGUAGE ALREADY ANSWERS IT. Checked BEFORE the slice is
  // read, because whether this language's toolchain covers the question is a
  // fact about the language and not about the function: a refusal that depended
  // on the code would be answering a question this dimension no longer asks.
  const covered = lang.craft.undocumentedRule;
  if (covered !== undefined) {
    return {
      state: "blind",
      reason: `${lang.displayName} answers this itself: ${covered}. This pass does not duplicate a rule your own toolchain carries`,
    };
  }
  const no = refusal(fn, lang);
  if (no !== undefined) {
    return no;
  }
  if (!isPublic(fn, lang) || docLines(fn, lang).length > 0) {
    return { state: "clean" };
  }
  return one("undocumented", {
    line: fn.startLine + fn.headIndex,
    evidence: fn.lines[fn.headIndex],
    detail: lang.craft.undocumentedDetail,
  });
}

// ===========================================================================
// Dimension 9, states a precondition it never enforces
// ===========================================================================

/** The words a stated precondition is written with. The doc says the caller
 *  owes something; the body is then asked whether anything checks it. */
/** Words that state an obligation on the INPUTS whoever they address. These
 *  fire on their own: "assumes a 1-byte discriminant" is about what was handed
 *  in, and there is nobody else it could be about. */
const INPUT_WORDS = /\b(assume|assumes|assumed|require|requires|required|expects|panics if)\b/i;

/** `must` is the ambiguous one, and it is the whole of this dimension's
 *  measured false-positive class. A doc says "the gate must never present it
 *  as one" and means the function's own behaviour; it says "the caller must
 *  keep the filter" and means an obligation. Same word, opposite meaning, and
 *  the tell is the SUBJECT: a precondition is owed by the caller or spoken of
 *  a parameter. Anything else is the function describing itself. */
const MODAL = /\bmust\b/i;
const OBLIGED = /\b(caller|callers|you|users?\s+of\s+this)\b/i;

/** The raw lines of the doc block, with their indices, in document order.
 *  Python's doc lives INSIDE the body and the other four put it above the
 *  head, which is the one thing this function knows. */
function docRegion(fn: FunctionUnderReview, lang: CriticizeLang): readonly { index: number; text: string }[] {
  const from = lang.lineComment === "#" ? fn.headIndex : 0;
  const to = lang.lineComment === "#" ? fn.bodyIndex : fn.headIndex;
  const out: { index: number; text: string }[] = [];
  for (let i = from; i < to; i++) {
    out.push({ index: i, text: fn.lines[i] });
  }
  return out;
}

/**
 * Whether anything in the body enforces what the doc promised.
 *
 * The vocabulary is per-language and shares nothing, which is why it is a table
 * on the profile. The one shape all five share is an early return on a checked
 * condition, and that is structural rather than a spelling: an `if` whose next
 * lines leave the function.
 */
function hasGuard(lang: CriticizeLang, body: readonly BodyLine[]): boolean {
  for (let i = 0; i < body.length; i++) {
    if (lang.craft.guards.some((guard) => guard.test(body[i].masked))) {
      return true;
    }
    if (!/^\s*(\}\s*else\s+)?if\b/.test(body[i].masked)) {
      continue;
    }
    const window = body.slice(i + 1, i + 3).map((b) => b.masked);
    if (window.some((line) => /\breturn\b|\bthrow\b|\braise\b|\bpanic/.test(line))) {
      return true;
    }
  }
  return false;
}

/** Does this doc line place an obligation on whoever calls the function?
 *
 *  An input word does it alone. A bare `must` needs a subject, and the subject
 *  is looked for in the clause BEFORE the modal, because that is where English
 *  puts it. Both of this dimension's measured false positives were a `must`
 *  whose subject was the function's own behaviour, and both go quiet here
 *  without narrowing the input words, which is where its recall lives. */
function statesPrecondition(text: string, paramNames: readonly string[]): boolean {
  if (INPUT_WORDS.test(text)) {
    return true;
  }
  const at = text.search(MODAL);
  if (at < 0) {
    return false;
  }
  // Backticks and punctuation are how a doc marks a parameter name, so the
  // subject is read as bare words rather than as written.
  const clause = text.slice(0, at).split(/[.;:]/).pop() ?? "";
  if (OBLIGED.test(clause)) {
    return true;
  }
  const words = new Set(clause.toLowerCase().split(/[^A-Za-z0-9_]+/).filter(Boolean));
  // Parameter names are matched by their PARTS, because a doc says "the id
  // must be non-empty" about a parameter spelled `session_id`. Splitting on
  // underscores and camel humps is what lets the subject test read English
  // rather than identifiers.
  return paramNames.some((name) =>
    nameParts(name).some((part) => words.has(part)),
  );
}

/** Parts of a parameter name that are also ordinary English words, and so say
 *  nothing about whether a sentence is talking about the parameter. A
 *  parameter called `a` would otherwise match the article in every doc. */
const NOT_A_SUBJECT = new Set(["a", "an", "i", "the", "is", "it", "be", "of", "to", "in", "on", "at", "as", "or", "and"]);

/** A parameter name as the words a doc would use for it: `session_id` and
 *  `sessionId` both become session and id, because a doc writes "the id must
 *  be non-empty" about a parameter spelled either way. */
function nameParts(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter((part) => part !== "" && !NOT_A_SUBJECT.has(part));
}

function unenforcedPrecondition(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome {
  const no = refusal(fn, lang);
  if (no !== undefined) {
    return no;
  }
  // A function with no doc promised nothing, so there is nothing to fail to
  // enforce. That is dimension 8's question, not this one's.
  if (docLines(fn, lang).length === 0) {
    return { state: "clean" };
  }
  const names = (parseParams(fn, lang) ?? []).map((p) => p.name);
  const region = docRegion(fn, lang);
  const stated = region.find((line) => statesPrecondition(line.text, names));
  if (stated === undefined) {
    // A modal this detector could not attribute is REPORTED, not swallowed.
    // "the gate must never present it as one" is the function describing
    // itself and "the caller must keep the filter" is an obligation, and the
    // subject test above separates them at a measured cost: it fires on no
    // positive in the 138-row labelled set, whose four positives all name a
    // subject it cannot resolve. Answering `clean` there would be a false
    // clean on the one dimension whose whole subject is a promise not kept.
    const unattributed = region.find((line) => MODAL.test(line.text));
    if (unattributed !== undefined) {
      return {
        state: "blind",
        reason:
          "this doc says must, and whether that is an obligation on the caller or a description of what this function does is a question about English rather than about code, so silence here is not evidence that the contract is enforced",
      };
    }
    return { state: "clean" };
  }
  if (hasGuard(lang, bodyLines(fn, lang))) {
    return { state: "clean" };
  }
  return one("unenforced-precondition", {
    line: fn.startLine + stated.index,
    evidence: stated.text,
    detail: "the doc states a precondition and the body checks nothing",
  });
}

// ===========================================================================
// Dimension 10, answers a question AND changes the world
// ===========================================================================

/**
 * Whether the declaration gives anything back.
 *
 * A unit, `void` or `None` return is a COMMAND, and a command is allowed to
 * change the world. That is not a weaker version of Meyer's rule, it is the
 * rule: the violation is doing both in secret.
 *
 * TypeScript and Python may write no annotation at all, and only there does
 * this fall back to reading the body for a `return` with a value.
 */
function returnsValue(fn: FunctionUnderReview, lang: CriticizeLang, body: readonly BodyLine[]): boolean {
  const parts = signatureParts(fn, lang);
  if (parts === undefined) {
    return false;
  }
  const result = parts.result.trim();
  if (result !== "") {
    return !lang.craft.unitReturns.includes(result);
  }
  const optional = lang.craft.paramStyle === "typescript" || lang.craft.paramStyle === "python";
  if (!optional) {
    // Rust writes `->` or returns unit; Go writes a result or has none; C#
    // writes one always, and an empty result there is a constructor.
    return false;
  }
  return body.some((line) => /\breturn\s+[^\s;]/.test(line.masked));
}

/** Where the function changes state that outlives the call, or undefined when
 *  it does not. "receiver" is Rust's case: `&mut self` declares the mutation in
 *  the signature itself, so the head is the evidence. */
function mutationSite(
  fn: FunctionUnderReview,
  lang: CriticizeLang,
  body: readonly BodyLine[],
): BodyLine | "receiver" | undefined {
  const parts = signatureParts(fn, lang);
  if (parts === undefined) {
    return undefined;
  }
  const generic = () => body.find((line) => lang.craft.mutations.some((m) => m.test(line.masked)));

  switch (lang.craft.receiverMutation) {
    case "mut-self": {
      if (/&\s*(?:'\w+\s+)?mut\s+self\b/.test(parts.head)) {
        return "receiver";
      }
      // The other half of Rust's row is a `&mut` PARAMETER written through, and
      // the `&mut` is what makes it outlive the call. A deref assignment to a
      // local `MutexGuard` is the same three characters and is not this: it was
      // 5 of the 6 hits the first cut of this detector produced on the measured
      // crate, against a dimension the contract says reads a genuine 0.0% there.
      const borrowed = new Set(
        (parseParams(fn, lang) ?? []).filter((p) => /^&\s*mut\b/.test(p.type ?? "")).map((p) => p.name),
      );
      return body.find((line) => {
        const target = line.masked.match(/^\s*\*(\w+)/);
        return target !== null && borrowed.has(target[1]) && lang.craft.mutations.some((m) => m.test(line.masked));
      });
    }
    case "pointer-receiver": {
      // A Go pointer receiver is only a mutation once something is written
      // THROUGH it, so the assignment's root has to be the receiver's name.
      const receiver = parts.head.match(/func\s*\(\s*(\w+)\s+\*/);
      if (receiver === null) {
        return undefined;
      }
      const root = new RegExp(`^\\s*${receiver[1]}\\.`);
      return body.find(
        (line) => root.test(line.masked) && lang.craft.mutations.some((m) => m.test(line.masked)),
      );
    }
    case "none":
      return generic();
  }
}

function cqs(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome {
  const no = refusal(fn, lang);
  if (no !== undefined) {
    return no;
  }
  const body = bodyLines(fn, lang);
  if (!returnsValue(fn, lang, body)) {
    return { state: "clean" };
  }
  const site = mutationSite(fn, lang, body);
  if (site === undefined) {
    return { state: "clean" };
  }
  const line = site === "receiver" ? fn.startLine + fn.headIndex : site.line;
  const evidence = site === "receiver" ? fn.lines[fn.headIndex] : site.raw;
  return one("cqs", {
    line,
    evidence,
    detail: "answers a question and changes state that outlives the call",
  });
}

/**
 * Dimensions 8 to 10, in rubric order.
 */
export const CONTRACT_DETECTORS: readonly Detector[] = [
  {
    dimension: "undocumented",
    axis: "understandable",
    source: "Knuth 1984, literate programming: code is written for humans to read, and incidentally for machines to execute",
    run: undocumented,
  },
  {
    dimension: "unenforced-precondition",
    axis: "safer",
    source: "Hoare 1969, an axiomatic basis for computer programming: preconditions and postconditions, a function is a contract and not a ritual",
    run: unenforcedPrecondition,
  },
  {
    dimension: "cqs",
    axis: "both",
    source: "Meyer 1988, command-query separation: a function either answers a question or changes the world, never both in secret",
    run: cqs,
  },
];
