// ===========================================================================
// What this function reaches outside itself, resolved rather than guessed.
//
// THE MEASUREMENT THAT MADE THIS NECESSARY. Session-v64 ran a blind head-to-head
// of model-authored review comments against the fixed rubric ones, 20 real
// production functions, judge never told which side was which:
//
//     opus              19 - 1
//     gpt-5.6-luna      12 - 8
//     qwen3.8:27b-mlx    7 - 13
//
// All three placed their comments at or near 100%. Placement is mechanical and
// says nothing about truth, and truth is the gate: a confidently wrong fix in
// someone's source file is worse than a generic right one.
//
// The judge's reasons for the losses are what this module is aimed at. The
// worst class, and the one that cost qwen3.8 the contest, is an INVENTED
// FAILURE MODE:
//
//     "`format!` on a `String` and a port number cannot fail, so demanding a
//      `Result` invents a failure mode this function does not have"
//
// That is a checkable fact. `format!` returns `String`. A model told so cannot
// make that mistake; a model reasoning from the call's spelling alone can, and
// at 27B it does.
//
// WHAT THIS IS HONESTLY GOOD FOR, AND WHAT IT IS NOT. Of the four loss classes
// the judge named, this addresses ONE squarely and part of another:
//
//   FIXED      an invented failure mode on a call whose signature says
//              otherwise. The signature is resolved and shown.
//   HELPED     "this is a pass-through", which needs to know what the callee
//              actually does; its signature and doc are now in front of the
//              model.
//   NOT FIXED  misreading the function's OWN text - calling a body a
//              pass-through when a guard is visibly there, or saying an awaited
//              error is swallowed. The model already had those lines.
//   NOT FIXED  a wrong claim about the LANGUAGE, like recommending a
//              discriminated union to C#. No resolver knows that.
//
// Anyone reading a later result should hold this module to the first two and
// not to the last two. Overclaiming here would make the experiment unfalsifiable.
//
// THE PRODUCT DOES NOT GUESS, THE RIG DOES. Choosing WHICH positions to ask
// about is a text scan, and that is fine: the scan picks questions and the
// language server gives answers. That is the same split the codebase already
// uses elsewhere - the signature detects, the symbol tree resolves - and it is
// the opposite of a name table, which would be text deciding the answer.
//
// Never imports vscode (the src/core rule). Every function here is pure.
// ===========================================================================

import { CriticizeLang } from "./criticizeLang";
import { FunctionUnderReview, bodyLines, unitDefect } from "./criticizeTypes";

/** Where a name the body uses is defined, relative to the function under review. */
export type ReachWhere =
  | "this-function"
  | "this-file"
  | "this-workspace"
  | "external"
  | "unresolved";

/** One name the body reaches for, and what the server said about it. */
export interface ReachFact {
  /** The identifier as it appears in the body. */
  name: string;
  /** 1-based DOCUMENT line where this occurrence sits. */
  line: number;
  where: ReachWhere;
  /** The declaration line, when a server resolved one. This is the field the
   *  whole module exists for: it is what makes "this call cannot fail" a fact
   *  the model is told rather than one it has to infer. */
  signature?: string;
  /** The declaring file, workspace-relative, for an in-workspace definition. */
  definedIn?: string;
  /** Its doc comment, when it has one. */
  doc?: string;
}

/**
 * One position to ask a language server about.
 *
 * The `character` is 0-based and points at the FIRST character of the
 * identifier, because that is where every server this product talks to answers
 * a definition query.
 */
export interface ReachQuery {
  name: string;
  /** 1-based document line. */
  line: number;
  /** 0-based column of the identifier's first character. */
  character: number;
}

/** How many positions one function may ask about.
 *
 *  CHOSEN, recorded in docs/constants.md. Every query is a round trip to a
 *  language server, and a 60-line function can carry a hundred identifiers of
 *  which most are locals. The cap binds on the pathological case; the filtering
 *  below is what keeps the ordinary case well under it. */
export const REACH_QUERY_CAP = 24;

/** Words that are never worth a definition query in any of the five languages:
 *  keywords, and the handful of literals that scan as identifiers.
 *
 *  THIS IS NOT A NAME TABLE. A name table decides an ANSWER from a spelling.
 *  This decides which QUESTIONS are worth a round trip, and being wrong about
 *  one costs a wasted query or a missing fact, never a wrong finding. */
const NEVER_ASK = new Set([
  "if", "else", "for", "while", "loop", "match", "switch", "case", "return", "break", "continue",
  "let", "var", "const", "mut", "fn", "func", "def", "class", "struct", "enum", "impl", "trait",
  "interface", "type", "new", "this", "self", "super", "base", "null", "nil", "none", "true",
  "false", "and", "or", "not", "in", "is", "as", "await", "async", "yield", "throw", "try",
  "catch", "finally", "using", "import", "from", "export", "public", "private", "protected",
  "internal", "static", "readonly", "pub", "use", "package", "namespace", "void", "int", "string",
  "bool", "float", "double", "char", "byte", "with", "pass", "raise", "except", "elif", "lambda",
  "go", "defer", "chan", "range", "map", "make", "nil", "err", "ok", "out", "ref", "params",
]);

/**
 * Which positions in this function's body are worth resolving.
 *
 * ONE QUERY PER DISTINCT NAME, at its first occurrence. A name used six times
 * resolves to the same place every time, and six round trips for one answer is
 * how a gesture becomes a wait.
 *
 * The masked body is the input, so a name that only appears inside a comment or
 * a string literal is never asked about. That is the same masking the detectors
 * use and it is why a doc comment mentioning `Instant::now` costs nothing here.
 */
export function reachQueries(fn: FunctionUnderReview, lang: CriticizeLang): readonly ReachQuery[] {
  if (unitDefect(fn) !== undefined) {
    return [];
  }
  const seen = new Set<string>();
  const out: ReachQuery[] = [];
  for (const entry of bodyLines(fn, lang)) {
    for (const hit of entry.masked.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const name = hit[0];
      if (name.length < 2 || NEVER_ASK.has(name.toLowerCase()) || seen.has(name)) {
        continue;
      }
      seen.add(name);
      out.push({ name, line: entry.line, character: hit.index ?? 0 });
      if (out.length >= REACH_QUERY_CAP) {
        return out;
      }
    }
  }
  return out;
}

/**
 * The evidence block, as prose for the prompt.
 *
 * ONLY WHAT REACHES OUTSIDE THE FUNCTION. A local variable resolving to a line
 * three above is not evidence about anything, and listing it would spend prompt
 * budget teaching the model what it can already see. What earns a line is a name
 * defined somewhere the model CANNOT see.
 *
 * `unresolved` entries are omitted rather than reported as external: a server
 * that did not answer is not evidence that a name is foreign, and saying so
 * would be the same false certainty this module exists to remove.
 */
export function renderReach(facts: readonly ReachFact[]): readonly string[] {
  const outside = facts.filter(
    (f) =>
      (f.where === "this-workspace" || f.where === "external" || f.where === "this-file") &&
      isDeclaration(f.signature),
  );
  if (outside.length === 0) {
    return [];
  }
  const out: string[] = [
    "",
    "What this function reaches outside itself. These are RESOLVED FACTS from the language server,",
    "not guesses: where each name is defined and what it is declared as. A claim that contradicts one",
    "of these is wrong.",
  ];
  for (const fact of outside) {
    const place =
      fact.where === "external"
        ? "outside this workspace"
        : fact.where === "this-file"
          ? "elsewhere in this file"
          : (fact.definedIn ?? "elsewhere in this workspace");
    const head = fact.signature === undefined || fact.signature.trim() === "" ? "" : `  ${fact.signature.trim()}`;
    out.push(`- ${fact.name} (${place})${head === "" ? "" : `\n  ${head.trim()}`}`);
    if (fact.doc !== undefined && fact.doc.trim() !== "") {
      out.push(`    ${fact.doc.trim().split("\n")[0]}`);
    }
  }
  return out;
}

/**
 * Whether a resolved line is a DECLARATION rather than a module or crate root.
 *
 * MEASURED, not anticipated. The first live capture over a real Rust crate
 * resolved 22 of one function's 24 names to something outside it, and the list
 * was mostly noise: `u128` resolved to `mod prim_u128 {}` and `std` and `env`
 * resolved to `//! # The Rust Standard Library` and `//! Inspection and
 * manipulation of the process's environment.`. A crate's front-page doc is not
 * evidence about a call.
 *
 * The one that earned its place in the same list was `args`, resolving to
 * `pub fn args() -> Args {` - a real signature, and exactly the shape that stops
 * a model inventing a failure mode.
 *
 * Filtering here rather than at the resolver is deliberate: the FACT that `std`
 * resolves externally is true and worth keeping in the record, it is just not
 * worth prompt budget. A caller measuring resolution rates still sees it.
 */
function isDeclaration(signature: string | undefined): boolean {
  const line = (signature ?? "").trim();
  if (line === "") {
    return false;
  }
  // An inner doc comment is a module or crate root in every language that has
  // one, and a bare `mod x {}` / `namespace X` / `package x` is the same thing.
  if (/^(\/\/!|#!\[|\/\*!)/.test(line)) {
    return false;
  }
  if (/^(mod|namespace|package|module)\b/.test(line)) {
    return false;
  }
  return true;
}

/** Whether anything worth showing came back, so a caller can report an absent
 *  block as an absence rather than as an empty heading. */
export function hasReach(facts: readonly ReachFact[]): boolean {
  return renderReach(facts).length > 0;
}
