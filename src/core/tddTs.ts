/**
 * The TypeScript leg of the TDD language seam, registered
 * for `typescript`, `typescriptreact`, `javascript` and `javascriptreact`.
 *
 * TypeScript is the first leg that reaches the unit under test through an
 * IMPORT. Rust's tests sit in the same file and `use super::*` sees private
 * items; Go's sibling declares the same package. Here the generated
 * `foo.test.ts` is a separate MODULE, so a function that is not `export`ed
 * cannot be reached at all — which is why `not-exported` exists in the seam's
 * reason set, and why the import line has to be spelled correctly rather than
 * guessed.
 *
 * READ THIS BEFORE CHANGING THE CLASSIFIER. Measured on the corpus
 * (`react-mobx-mvvm`, 157 functions): this leg refuses EVERY function there, and
 * the human ruled it ships that way (goal.md Amendment 1). The cause is the
 * doc-comment leg inherited from Rust against a codebase documenting 7.0% of its
 * functions, NOT the `not-exported` leg, which costs three functions. Relaxing a
 * leg to manufacture survivors is a decision for the human, not a change to make
 * here.
 *
 * Never imports vscode (the src/core rule).
 * Contract: docs/architecture/tdd-language-seam.md.
 */

import * as fs from "fs";
import * as path from "path";
import type { TestCaseResult, TestFailureDetail, TestOutcome } from "./compilerOracle";
import type { FailureLocation } from "./failureDigest";
import {
  LiteralProfile,
  TestInsertionPlan,
  matchDelim,
  reindent,
  skipLiteralOrComment,
  testMarkers,
  topLevelArgs,
} from "./testAssembly";
import type { TestabilityVerdict } from "./testability";
import { BlankValueResult, escapeSnippet } from "./tabstop";
import {
  PlacementResult,
  ScaffoldInput,
  TddDeps,
  TddLang,
  TestFramework,
  TestRunCommand,
  TestRunParse,
  fileExistsOf,
  readFileOf,
} from "./tddLang";

// ===========================================================================
// The TypeScript literal profile
// ===========================================================================

/** TypeScript against the shared scanner's Rust defaults: `'…'` is a STRING and
 *  not a char literal, backticks open a template whose `${…}` holds an arbitrary
 *  expression, `/…/` is a regex literal, and block comments do not nest. Every
 *  structural scan below goes through this so an `expect` inside a string or a
 *  `:` inside a template is never read as code.
 *
 *  `regexLiteral` is the one that cost the most to leave out: `expect(splitOn(/'/,
 *  s))` reads the apostrophe inside the regex as an opening quote, and the
 *  string it opens then runs to the end of the module, so every assertion AFTER
 *  it goes unblanked and ships with the model's guessed value. The flag is
 *  opt-in and set here only — Rust's `/` is division and Go's is too. */
const TS_LITERALS: LiteralProfile = {
  singleQuoteStrings: true,
  templateLiteralDelimiter: "`",
  nestedBlockComments: false,
  regexLiteral: true,
};

function isIdentChar(c: string): boolean {
  return /[\w$]/.test(c ?? "");
}

function skipSpace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) {
    i++;
  }
  return i;
}

/** Whitespace AND comments. A chain link can sit on its own line with a comment
 *  between it and the next one, and `expect(x)\n  // why\n  .toBe(7)` is one
 *  expression. */
function skipTrivia(text: string, i: number): number {
  for (;;) {
    const afterSpace = skipSpace(text, i);
    const afterComment = skipLiteralOrComment(text, afterSpace, TS_LITERALS);
    // Only a COMMENT continues the trivia run; a string literal here is a value
    // and ends it.
    if (afterComment > afterSpace && text[afterSpace] === "/") {
      i = afterComment;
      continue;
    }
    return afterSpace;
  }
}

/** The index after the `>` matching the `<` at `i`, or `i` when it does not
 *  balance (a `<` that was a comparison, or a truncated signature). Angle depth
 *  with `()[]{}` groups jumped whole, so `f<T extends (x: number) => void>` ends
 *  at the right `>`. */
function skipAngles(text: string, i: number): number {
  if (text[i] !== "<") {
    return i;
  }
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const skipped = skipLiteralOrComment(text, j, TS_LITERALS);
    if (skipped > j) {
      j = skipped;
      continue;
    }
    const c = text[j];
    if (c === "(" || c === "[" || c === "{") {
      const close = matchDelim(text, j, TS_LITERALS);
      if (close === -1) {
        return i;
      }
      j = close + 1;
      continue;
    }
    if (c === "<") {
      depth++;
    } else if (c === ">") {
      depth--;
      if (depth === 0) {
        return j + 1;
      }
    } else if (c === ";" || c === ")") {
      // Never a type-argument list: bail rather than run to the end of the text.
      return i;
    }
    j++;
  }
  return i;
}

// ===========================================================================
// returnTypeOf
// ===========================================================================

/** The `(` opening the PARAMETER list of a signature, or -1. Found by scanning
 *  rather than `indexOf("(")`, because a type-parameter list can hold one:
 *  `function f<T extends (x: number) => void>(a: T): T`. */
function paramListOpen(sig: string): number {
  let i = 0;
  while (i < sig.length) {
    const skipped = skipLiteralOrComment(sig, i, TS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = sig[i];
    if (c === "<") {
      const after = skipAngles(sig, i);
      if (after > i) {
        i = after;
        continue;
      }
    }
    if (c === "(") {
      return i;
    }
    if (c === "{") {
      // A body brace before any parameter list: not a function signature.
      return -1;
    }
    i++;
  }
  return -1;
}

/**
 * The return type text of a TypeScript signature, or undefined when there is
 * none. TypeScript puts it after the parameter list's closing paren and a colon,
 * so the whole job is finding that paren BY DEPTH and then reading to the body:
 *
 *   function f(a: number): number {                 -> "number"
 *   export const g = (a: number): string =>         -> "string"
 *   function h(a: number)                           -> undefined
 *   async function i(): Promise<number>             -> "Promise<number>"
 *   function j(cb: (x: number) => number): string   -> "string"
 *   method(a: number): boolean {                    -> "boolean"
 *   function k(a: {x: number}): number              -> "number"
 *
 * The last three are what a naive regex breaks on: a function-typed parameter
 * carries a `=>` and a colon, an object-type parameter carries a colon and
 * braces, and a method has no `function` keyword to anchor on.
 *
 * `void` answers undefined, which is the Rust precedent this session ratified
 * (supersession S1: `-> ()` used to yield the string "()" and got the human a
 * tabstop hole for a unit value). A unit return is nothing to assert on, so the
 * defensive "returns no value to assert" gate in the consumer must be able to
 * fire. classifyTestability refuses it as `underspecified` first either way.
 *
 * `never` and an assertion signature (`asserts c`) answer undefined for exactly
 * the same reason, spelled two more ways: a function that only ever throws and a
 * function whose return type is a claim about a PARAMETER both hand the caller
 * no value. Left as strings they came back TESTABLE and earned a tabstop hole
 * for a value that does not exist. A TYPE PREDICATE (`x is T`) is a real boolean
 * and is deliberately untouched.
 */
export function tsReturnTypeOf(signature: string): string | undefined {
  const sig = signature ?? "";
  const open = paramListOpen(sig);
  if (open === -1) {
    return undefined;
  }
  const close = matchDelim(sig, open, TS_LITERALS);
  if (close === -1) {
    return undefined;
  }
  let i = skipTrivia(sig, close + 1);
  if (sig[i] !== ":") {
    return undefined;
  }
  i++;
  const start = i;
  let end = sig.length;
  while (i < sig.length) {
    const skipped = skipLiteralOrComment(sig, i, TS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = sig[i];
    if (c === "{") {
      // An object TYPE opens the return (`): { count: number } {`); anything
      // after the type has begun is the BODY brace and ends it.
      if (sig.slice(start, i).trim().length > 0) {
        end = i;
        break;
      }
      const objClose = matchDelim(sig, i, TS_LITERALS);
      if (objClose === -1) {
        break;
      }
      i = objClose + 1;
      continue;
    }
    if (c === "(" || c === "[") {
      const groupClose = matchDelim(sig, i, TS_LITERALS);
      if (groupClose === -1) {
        break;
      }
      i = groupClose + 1;
      continue;
    }
    if (c === "<") {
      const after = skipAngles(sig, i);
      if (after > i) {
        i = after;
        continue;
      }
    }
    if (c === "=" && sig[i + 1] === ">") {
      // An arrow function's `=>` ends the return type. A FUNCTION-TYPED return
      // (`): (x: number) => number {`) also carries one, and the tell is that
      // everything read so far is exactly a parenthesized parameter list.
      const soFar = sig.slice(start, i).trim();
      if (soFar.startsWith("(") && soFar.endsWith(")")) {
        i += 2;
        continue;
      }
      end = i;
      break;
    }
    if (c === ";") {
      end = i;
      break;
    }
    i++;
  }
  const ret = sig.slice(start, end).trim();
  if (ret.length === 0 || ret === "void" || ret === "never" || /^asserts\b/.test(ret)) {
    return undefined;
  }
  return ret;
}

// ===========================================================================
// Testability
// ===========================================================================

// `async function f`, `async (a) =>`, `async foo(` (a method) and `async <T>(`.
// A parameter merely NAMED async cannot match: every form requires the keyword
// to be followed by a declaration head.
const TS_ASYNC_KEYWORD = /\basync\s+function\b|\basync\s*[(<]|\basync\s+[A-Za-z_$][\w$]*\s*[(<]/;

// A future-shaped return. `Promise<void>` lands HERE and not in underspecified:
// goal.md item 3 listed it under both and Amendment 3 ruled that precedence
// stands, because the reported reason must be predictable rather than the
// highest-numbered leg that happens to match.
const TS_ASYNC_RETURN = /^(Promise|PromiseLike|Thenable)\s*<|^(AsyncGenerator|AsyncIterable|AsyncIterableIterator)\b/;

// The IO/network marker set named by the contract: `node:` builtins that do IO,
// an `fs.`/`http.`/`https.` qualified type, and `fetch`. Word-bounded so
// `myfs.Thing` and `prefetch` never trip it. Measured 0 on the corpus, and that
// is a FALSE zero: the classifier sees a signature and not a body, so a function
// that opens a file behind a `string` parameter passes. Shared with the product,
// not fixable here.
const TS_IO =
  /\bnode:(fs|http|https|net|dgram|tls|dns|child_process|readline|stream)\b|\bfs\s*\.|\bhttps?\s*\.|\bfetch\b|\bFileHandle\b|\b(Read|Write)Stream\b|\b(import|require)\s*\(\s*['"](node:)?(fs|http|https|net|dgram|tls|dns|child_process|readline|stream)(\/[\w-]+)?['"]/;

// An explicit `this` parameter: the unambiguous fixture case.
const TS_THIS_PARAM = /\(\s*this\s*:/;

// The METHOD FORM. Optional member modifiers, then a name, then a parameter or
// type-parameter list — with no `function` keyword, no arrow binding and no
// `export` anywhere in front of it, which is what a class member looks like and
// nothing else does. `function f(` cannot match: `function` would have to be the
// NAME, and the `f` after it breaks the `name(` shape. Neither can `export …`
// or `const g = (…) =>`, whose heads are not member modifiers.
const TS_METHOD_FORM =
  /^\s*(?:(?:public|private|protected|readonly|static|abstract|override|declare|async|get|set)\s+)*\*?\s*(?:[A-Za-z_$][\w$]*|\[[^\]]*\]|'[^']*'|"[^"]*")\s*[(<]/;

// A CLASS FIELD holding a function: `private onKeyDown = (e: KeyboardEvent):
// void => …`, optionally with its own type annotation before the `=`.
//
// Amendment 5, correcting Amendment 4, which exempted "an arrow binding" from
// the method form. That exemption dropped this shape through to the visibility
// leg, where it came back `not-exported` and the detail told the human to add
// `export` — and a class property CANNOT be exported, so the reason was
// unactionable. Measured as 8 of the 23 not-exported verdicts on the corpus:
// the MobX bound-action idiom, and therefore the dominant member form there.
const TS_CLASS_FIELD_ARROW =
  /^\s*(?:(?:public|private|protected|readonly|static|abstract|override|declare|accessor)\s+)*(?:[A-Za-z_$][\w$]*|\[[^\]]*\]|'[^']*'|"[^"]*")\s*[!?]?\s*(?::[\s\S]*?)?=\s*(?:async\s+)?[(<]/;

// What a TOP-LEVEL declaration opens with, and the whole of what separates
// `private onKeyDown = (e) => …` in a class body from `export const ok = <T>(v:
// T) => …` at module scope: the class member has no binding keyword ahead of it
// because a class body needs none.
const TS_TOP_LEVEL_BINDING = /^\s*(?:export|const|let|var|function|async\s+function|declare\s+(?:const|let|var|function))\b/;

// `export function f`, `export const g =`, `export default function`, and a
// re-exported declaration head. Only the DECLARATION's own export keyword counts;
// a function exported later through `export { escapeValue }` reads as
// not-exported, which is the conservative direction (a refusal naming a fix the
// human can apply, rather than a generated import that does not resolve).
const TS_EXPORTED = /^\s*export\b/;

/**
 * Classify a TypeScript function as a blind-unit-test target or an honest
 * failure. First-match-wins over a FIXED precedence so the reported reason is
 * stable: async → io → needs-fixture → not-exported → underspecified → testable.
 * Pure; never throws.
 *
 * TWO STATED TRADES, both deliberate and both in the over-refusing direction.
 *
 * 1. `needs-fixture` is detected from the MEMBER FORM, not from a body-level
 *    `this`, because this function only ever receives a signature and a doc
 *    comment (goal.md Amendment 4). A class method that never touches `this` is
 *    refused anyway. The alternative is generating a test that constructs no
 *    receiver and then fails for a reason the human did not cause. Amendment 5
 *    added the class FIELD holding an arrow to the same leg, which Amendment 4
 *    had wrongly exempted.
 * 2. `not-exported` reads the declaration's own `export` keyword. A function
 *    exported by a later `export { … }` statement is refused, because the
 *    signature is all there is to read and a wrong import line produces a red the
 *    human cannot act on.
 */
export function classifyTsTestability(signature: string, docComment?: string): TestabilityVerdict {
  const sig = signature ?? "";
  const returnType = tsReturnTypeOf(sig);

  if (TS_ASYNC_KEYWORD.test(sig) || (returnType !== undefined && TS_ASYNC_RETURN.test(returnType))) {
    return {
      testable: false,
      reason: "async",
      detail: "async function or a promise-returning function — a blind unit test cannot drive it",
    };
  }
  if (TS_IO.test(sig)) {
    return {
      testable: false,
      reason: "io",
      detail: "IO/network in the signature (node:fs, fs, fetch, http, https) — integration territory, not a blind unit test",
    };
  }
  if (TS_THIS_PARAM.test(sig)) {
    return {
      testable: false,
      reason: "needs-fixture",
      detail: "an explicit `this` parameter — needs a constructed receiver",
    };
  }
  if (!TS_TOP_LEVEL_BINDING.test(sig) && TS_METHOD_FORM.test(sig)) {
    return {
      testable: false,
      reason: "needs-fixture",
      detail: "class method — needs a constructed instance the blind test has no contract for",
    };
  }
  if (!TS_TOP_LEVEL_BINDING.test(sig) && TS_CLASS_FIELD_ARROW.test(sig)) {
    // Amendment 5: this is a class member too, and the reason has to say so.
    // Falling through to the visibility leg told the human to `export` a class
    // property, which cannot be done.
    return {
      testable: false,
      reason: "needs-fixture",
      detail: "class field holding a function — needs a constructed instance, and a class property cannot be exported",
    };
  }
  if (!TS_EXPORTED.test(sig)) {
    // The one refusal Rust and Go never need. The generated tests live in a
    // SEPARATE MODULE and reach the unit through an import, so the fix is
    // named rather than implied.
    return {
      testable: false,
      reason: "not-exported",
      detail: "not exported — the sibling test file imports the unit, so add `export` or it stays untestable",
    };
  }
  if (docComment === undefined || docComment.trim() === "") {
    return { testable: false, reason: "underspecified", detail: "no doc comment — no contract to author a blind test from" };
  }
  if (returnType === undefined) {
    // `void`, or no annotation at all. `Promise<void>` never reaches here: async
    // claimed it, per Amendment 3.
    return { testable: false, reason: "underspecified", detail: "returns void or has no return annotation — nothing to assert" };
  }
  return { testable: true };
}

// ===========================================================================
// Blank values
// ===========================================================================

const TS_SCALAR = /^(number|string|boolean|bigint)$/;

/** Split on TOP-LEVEL commas (and semicolons, which separate object-type
 *  members), respecting `()[]{}<>` nesting and literals. */
function splitTopLevelTs(s: string, separators: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const skipped = skipLiteralOrComment(s, i, TS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = s[i];
    if ("([{<".includes(c)) {
      depth++;
    } else if (")]}>".includes(c)) {
      depth--;
    } else if (depth === 0 && separators.includes(c)) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** `Name<A, B>` -> { name, args }, or undefined when the type is not a single
 *  generic application. */
function parseTsGeneric(ty: string): { name: string; args: string[] } | undefined {
  const lt = ty.indexOf("<");
  if (lt === -1 || !ty.endsWith(">")) {
    return undefined;
  }
  const name = ty.slice(0, lt).trim();
  if (!/^[A-Za-z_$][\w$.]*$/.test(name)) {
    return undefined;
  }
  return { name, args: splitTopLevelTs(ty.slice(lt + 1, -1), ",") };
}

/**
 * The blank-value RHS for a TypeScript return type. Amendment 2's rule, which is
 * the shipped Rust renderer's measured behaviour: a SCALAR is a bare hole,
 * everything else is a hole carrying a type-hint comment, and a container's
 * contents are hinted with the ELEMENT type (the human is typing a `number`, not
 * a `number[]`).
 *
 * Scaffold what the TYPE determines — it is visible in the signature and leaks
 * nothing. Keep as ONE hole what the CONTRACT determines, because leaking that
 * is what blank-value exists to prevent. A union is one hole for exactly that
 * reason: the variant IS the answer, which is Rust's Option/Result precedent.
 *
 * Pure; never throws.
 */
export function tsRenderBlankValue(returnType: string, opts?: { startHole?: number }): BlankValueResult {
  const start = opts?.startHole ?? 1;
  const ty = (returnType ?? "").trim().replace(/^readonly\s+/, "");
  const bare = (i: number) => `\${${start + i}}`;
  const hint = (i: number, t: string) => `\${${start + i}:/* ${escapeSnippet(t)} */}`;
  // One hole per value whose shape the type does not fix: bare for a scalar,
  // hinted for everything else.
  const oneHole = (i: number, t: string): string => (TS_SCALAR.test(t.trim()) ? bare(i) : hint(i, t.trim()));

  if (ty.length === 0) {
    return { rhs: bare(0), holes: 1 };
  }
  if (TS_SCALAR.test(ty)) {
    return { rhs: bare(0), holes: 1 };
  }

  // A union: one hole. Checked before the containers so `number[] | undefined`
  // does not scaffold an array the contract may not want.
  if (splitTopLevelTs(ty, "|").length > 1) {
    return { rhs: hint(0, ty), holes: 1 };
  }

  // `T[]` and `Array<T>`: the brackets are type-determined and leak nothing;
  // how many elements and which are contract-determined and stay ONE hole
  // hinting the ELEMENT type. Leaving the comment in place reads as `[]`.
  if (ty.endsWith("[]")) {
    return { rhs: `[${hint(0, ty.slice(0, -2).trim())}]`, holes: 1 };
  }
  const generic = parseTsGeneric(ty);
  if (generic !== undefined) {
    if ((generic.name === "Array" || generic.name === "ReadonlyArray") && generic.args.length === 1) {
      return { rhs: `[${hint(0, generic.args[0])}]`, holes: 1 };
    }
    // Record, Map, Set: one HINTED hole, per the contract's table. Their
    // contents are contract-determined all the way down and the constructor
    // spelling differs per type, so there is nothing type-determined to scaffold.
    return { rhs: hint(0, ty), holes: 1 };
  }

  // An INLINE OBJECT TYPE: the KEYS are type-determined, so scaffold them, one
  // hole each, the way the Rust struct branch scaffolds fields. Each hole is
  // bare or hinted by ITS OWN field type, which is the same rule one level down.
  if (ty.startsWith("{") && ty.endsWith("}")) {
    const members = splitTopLevelTs(ty.slice(1, -1), ",;");
    const fields: string[] = [];
    let holes = 0;
    for (const member of members) {
      const colon = splitMemberAtColon(member);
      if (colon === undefined) {
        fields.length = 0;
        break;
      }
      fields.push(`${colon.key}: ${oneHole(holes, colon.type)}`);
      holes++;
    }
    if (fields.length > 0) {
      return { rhs: `{ ${fields.join(", ")} }`, holes };
    }
  }

  // A named type, an interface, a tuple, a literal type: one hinted hole.
  return { rhs: hint(0, ty), holes: 1 };
}

/** An object-type member `a: number` / `a?: number` split at its OWN colon, or
 *  undefined when the member is not a `key: type` pair (an index signature, a
 *  method member). */
function splitMemberAtColon(member: string): { key: string; type: string } | undefined {
  let depth = 0;
  let i = 0;
  while (i < member.length) {
    const skipped = skipLiteralOrComment(member, i, TS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = member[i];
    if ("([{<".includes(c)) {
      depth++;
    } else if (")]}>".includes(c)) {
      depth--;
    } else if (c === ":" && depth === 0) {
      const key = member.slice(0, i).trim();
      const type = member.slice(i + 1).trim();
      if (!/^[A-Za-z_$][\w$]*\??$/.test(key) || type.length === 0) {
        return undefined;
      }
      return { key: key.replace(/\?$/, ""), type };
    }
    i++;
  }
  return undefined;
}

// ===========================================================================
// The expected-value locator
// ===========================================================================

/** The matchers that ASSERT A VALUE and end the chain. Their first argument is
 *  the expected value and is exactly what the human must type.
 *
 *  Zero-argument matchers (`toBeTruthy`, `toBeNull`, `toBeUndefined`) are
 *  deliberately absent: there is no expected value to blank. `not`, `resolves`
 *  and `rejects` are chain LINKS, not terminators — `expect(a).not.toBe(b)`
 *  terminates at `toBe` and `b` is the span. */
const TS_VALUE_MATCHERS = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toBeCloseTo",
  "toContain",
  "toHaveLength",
]);

/**
 * The EXPECTED-VALUE spans in generated vitest/jest text: the FIRST argument of
 * the matcher that TERMINATES each `expect` chain, and nothing else.
 *
 * Safety-critical, and a different SHAPE from every other language in this
 * build. The expected value is not a positional argument of the call being
 * scanned; it is the argument of a method invoked ON the result of `expect(…)`.
 * Point Rust's locator at `expect(widen(3)).toBe(7)` and it blanks `widen(3)` —
 * the call under test — leaving the model's guessed `7` in the human's buffer.
 * That is the blank-value invariant inverted (goal.md item 6).
 *
 * Rules it has to hold:
 *   - only value-asserting terminators match, so `toBeTruthy()` blanks nothing;
 *   - `not` / `resolves` / `rejects` are walked THROUGH, not matched;
 *   - `toBeCloseTo(3.14, 2)` blanks the value and leaves the precision;
 *   - a nested `expect` inside a matcher argument cannot produce a second,
 *     overlapping span, because the scan resumes past the matcher's `)`;
 *   - an `expect` inside a string, a template literal or a comment is never
 *     matched at all;
 *   - spans come back ascending and non-overlapping, or blankTestModule's slice
 *     loop emits a corrupt snippet.
 */
export function tsExpectedValueSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, TS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (
      text.startsWith("expect", i) &&
      !isIdentChar(text[i + 6] ?? "") &&
      !isIdentChar(text[i - 1] ?? "") &&
      text[i - 1] !== "."
    ) {
      const open = expectEntry(text, i + 6);
      if (text[open] === "(") {
        const close = matchDelim(text, open, TS_LITERALS);
        if (close !== -1) {
          const end = chainTerminator(text, close + 1, spans);
          if (end > close) {
            i = end;
            continue;
          }
          // No value-asserting terminator on this chain: step past the
          // `expect(…)` group so its ARGUMENT is never rescanned as a
          // subject of its own.
          i = close + 1;
          continue;
        }
      }
    }
    i++;
  }
  return spans;
}

/** The matchers that assert something with NO expected value for the human to
 *  type. A chain ending in one of these is not a locator miss, so counting it as
 *  one would refuse a perfectly good pass. Anything OUTSIDE both this set and
 *  TS_VALUE_MATCHERS is unknown, and unknown counts as a MISS: an unrecognised
 *  matcher is exactly the silence scraps D5 is about. */
const TS_VALUE_FREE_MATCHERS = new Set([
  "toBeTruthy",
  "toBeFalsy",
  "toBeNull",
  "toBeUndefined",
  "toBeDefined",
  "toBeNaN",
  "toBeInstanceOf",
  "toThrow",
  "toThrowError",
  "toHaveBeenCalled",
  "toBeCalled",
]);

/**
 * How many `expect(…)` chains the locator WALKED without resolving an
 * expected-value span, excluding the chains that legitimately have no value to
 * type.
 *
 * scraps D5's all-or-nothing floor, spelled for vitest and jest. Measured
 * instances of the silence this catches: `expect.soft`, an explicit matcher type
 * argument, and a regex literal containing an apostrophe (all three fixed in
 * phase 3, but the SHAPE remains and the next one is not predictable). The other
 * assertions in the module still produce holes, so a holes-based floor passes
 * and the model's guess ships beside them.
 */
export function tsUnresolvedAssertions(text: string): number {
  let unresolved = 0;
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, TS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (
      text.startsWith("expect", i) &&
      !isIdentChar(text[i + 6] ?? "") &&
      !isIdentChar(text[i - 1] ?? "") &&
      text[i - 1] !== "."
    ) {
      const open = expectEntry(text, i + 6);
      if (text[open] === "(") {
        const close = matchDelim(text, open, TS_LITERALS);
        if (close === -1) {
          // An unterminated `expect(` is the regex-apostrophe shape: the scanner
          // cannot see where the chain ends, so it resolves nothing and says so.
          unresolved++;
          return unresolved;
        }
        const spans: Array<{ start: number; end: number }> = [];
        const end = chainTerminator(text, close + 1, spans);
        if (spans.length === 0 && !endsValueFree(text, close + 1)) {
          unresolved++;
        }
        i = end > close ? end : close + 1;
        continue;
      }
    }
    i++;
  }
  return unresolved;
}

/** Did the chain starting at `i` reach a matcher that asserts without an
 *  expected value? Walks the same `.member` links the locator does. */
function endsValueFree(text: string, i: number): boolean {
  let j = skipTrivia(text, i);
  while (text[j] === ".") {
    const nameStart = skipTrivia(text, j + 1);
    const nameM = /^[A-Za-z_$][\w$]*/.exec(text.slice(nameStart));
    if (nameM === null) {
      return false;
    }
    const name = nameM[0];
    let afterName = skipTrivia(text, nameStart + name.length);
    if (text[afterName] === "<") {
      const afterAngles = skipAngles(text, afterName);
      if (afterAngles > afterName) {
        afterName = skipTrivia(text, afterAngles);
      }
    }
    if (text[afterName] !== "(") {
      j = afterName;
      continue;
    }
    if (TS_VALUE_FREE_MATCHERS.has(name)) {
      return true;
    }
    const parsed = topLevelArgs(text, afterName, TS_LITERALS);
    if (parsed === undefined) {
      return false;
    }
    j = skipTrivia(text, parsed.close + 1);
  }
  return false;
}

/** The ENTRY POINTS to an expect chain that are not the bare call: vitest's
 *  `expect.soft(x)` runs the assertion without aborting the test, and its chain
 *  from there is identical. Structurally the same category as the `.not` /
 *  `.resolves` links the walk already steps through — an extra link between the
 *  subject and the terminator — and an entry point the locator does not know is
 *  worse than one it refuses, because the chain's expected value silently keeps
 *  the model's guess. */
const TS_EXPECT_ENTRIES = new Set(["soft"]);

/** The index of the subject `(` for an `expect` whose name ended at `i`, walking
 *  through a known entry-point link. Returns `i` when there is none, so the
 *  caller's `text[open] === "("` test decides. */
function expectEntry(text: string, i: number): number {
  const afterName = skipTrivia(text, i);
  if (text[afterName] !== ".") {
    return afterName;
  }
  const linkStart = skipTrivia(text, afterName + 1);
  const link = /^[A-Za-z_$][\w$]*/.exec(text.slice(linkStart));
  if (link === null || !TS_EXPECT_ENTRIES.has(link[0])) {
    return afterName;
  }
  return skipTrivia(text, linkStart + link[0].length);
}

/** Walk the `.member` chain that starts at `i`, pushing the expected-value span
 *  of the first value-asserting matcher. Returns the index after that matcher's
 *  call, or `i` when the chain holds none. */
function chainTerminator(text: string, i: number, spans: Array<{ start: number; end: number }>): number {
  let j = skipTrivia(text, i);
  while (text[j] === ".") {
    const nameStart = skipTrivia(text, j + 1);
    const nameM = /^[A-Za-z_$][\w$]*/.exec(text.slice(nameStart));
    if (nameM === null) {
      return i;
    }
    const name = nameM[0];
    let afterName = skipTrivia(text, nameStart + name.length);
    if (text[afterName] === "<") {
      // An EXPLICIT type argument on the matcher: `toEqual<Map<string,
      // number>>(m)`. The call's `(` sits past it, and without the skip the
      // matcher reads as a bare link and its expected value is never blanked.
      const afterAngles = skipAngles(text, afterName);
      if (afterAngles > afterName) {
        afterName = skipTrivia(text, afterAngles);
      }
    }
    if (text[afterName] !== "(") {
      // A bare link: `not`, `resolves`, `rejects`. Keep walking.
      j = afterName;
      continue;
    }
    const parsed = topLevelArgs(text, afterName, TS_LITERALS);
    if (parsed === undefined) {
      return i;
    }
    if (TS_VALUE_MATCHERS.has(name) && parsed.args.length > 0) {
      // The FIRST argument only: `toBeCloseTo(3.14, 2)` blanks the value and
      // leaves the precision, which is not an expected value.
      spans.push(parsed.args[0]);
      return parsed.close + 1;
    }
    // A zero-argument or non-value matcher (`toBeTruthy()`, `toThrow()`), or a
    // link spelled as a call (`rejects.toThrow()`): nothing to blank, and the
    // chain may continue past it.
    j = skipTrivia(text, parsed.close + 1);
  }
  return i;
}

// ===========================================================================
// tsconfig: the import extension, and the one thing that silently breaks it
// ===========================================================================

/** How many `extends` hops to follow before giving up. A cycle in the wild is
 *  rare and a config chain deeper than this is not worth resolving; both end as
 *  "undetermined", which is honest. */
const TSCONFIG_EXTENDS_LIMIT = 8;

/** The module resolutions that require the EMITTED extension on a relative
 *  import (`./foo.js`, even from a `.ts` file). Everything else — `bundler`,
 *  `node`, `node10`, `classic` — takes the extensionless specifier the corpus
 *  uses. Getting this backwards produces an import that does not resolve, and
 *  the human reads the red as their own bug. */
const EXTENSION_REQUIRED = /^(node16|nodenext|node18|node20)$/i;

function stripJsonc(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
}

interface TsConfigShape {
  extends?: unknown;
  compilerOptions?: { moduleResolution?: unknown; module?: unknown };
}

function readTsConfig(file: string, deps: TddDeps): TsConfigShape | undefined {
  const raw = readFileOf(deps)(file);
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(stripJsonc(raw));
    return typeof parsed === "object" && parsed !== null ? (parsed as TsConfigShape) : undefined;
  } catch {
    return undefined;
  }
}

/** The nearest `tsconfig.json` at or above `dir`, or undefined. */
function nearestTsConfig(dir: string, deps: TddDeps): string | undefined {
  const exists = fileExistsOf(deps);
  let d = dir;
  for (;;) {
    const candidate = path.join(d, "tsconfig.json");
    if (exists(candidate)) {
      return candidate;
    }
    const parent = path.dirname(d);
    if (parent === d) {
      return undefined;
    }
    d = parent;
  }
}

/** An `extends` target resolved to a file path: relative against the extending
 *  config's directory, bare through `node_modules` walking up. */
function resolveExtends(spec: string, fromFile: string, deps: TddDeps): string | undefined {
  const exists = fileExistsOf(deps);
  const withJson = (p: string) => (p.endsWith(".json") ? [p] : [p, `${p}.json`, path.join(p, "tsconfig.json")]);
  if (spec.startsWith(".")) {
    return withJson(path.resolve(path.dirname(fromFile), spec)).find(exists);
  }
  let d = path.dirname(fromFile);
  for (;;) {
    const found = withJson(path.join(d, "node_modules", spec)).find(exists);
    if (found !== undefined) {
      return found;
    }
    const parent = path.dirname(d);
    if (parent === d) {
      return undefined;
    }
    d = parent;
  }
}

interface ExtensionRule {
  /** True when a relative import must carry the emitted extension. undefined
   *  when nothing said so — which is NOT the same as false and gets said on the
   *  evidence channel. */
  needsExtension?: boolean;
  /** The config and setting the answer came from, for the evidence line. */
  evidence: string;
}

/**
 * Whether a relative import in this project must carry an extension, read from
 * the nearest `tsconfig.json` and its `extends` chain.
 *
 * Extensionless is right for `bundler` (what the corpus uses), `node`, `node10`
 * and `classic`, and WRONG for `node16`/`nodenext`, which need `./foo.js` even
 * from a `.ts` file. When `moduleResolution` is absent the `module` setting
 * decides it, because `module: "node16"` implies the matching resolution.
 *
 * When nothing determines it the answer is undefined and the caller prefers
 * extensionless AND SAYS SO. Guessing silently is how a generated import breaks
 * in a way the human reads as their own bug.
 */
export function importExtensionRule(fromDir: string, deps: TddDeps): ExtensionRule {
  const nearest = nearestTsConfig(fromDir, deps);
  if (nearest === undefined) {
    return { evidence: `no tsconfig.json at or above ${fromDir}; moduleResolution undetermined` };
  }
  let file: string | undefined = nearest;
  const seen = new Set<string>();
  for (let hop = 0; hop < TSCONFIG_EXTENDS_LIMIT && file !== undefined && !seen.has(file); hop++) {
    seen.add(file);
    const config = readTsConfig(file, deps);
    if (config === undefined) {
      return { evidence: `${file} could not be read as JSON; moduleResolution undetermined` };
    }
    const resolution = typeof config.compilerOptions?.moduleResolution === "string" ? config.compilerOptions.moduleResolution : undefined;
    if (resolution !== undefined) {
      return {
        needsExtension: EXTENSION_REQUIRED.test(resolution),
        evidence: `moduleResolution=${resolution} from ${file}`,
      };
    }
    const module = typeof config.compilerOptions?.module === "string" ? config.compilerOptions.module : undefined;
    if (module !== undefined) {
      // `module: "node16"` implies `moduleResolution: "node16"`, so the import
      // spelling follows it when the resolution itself is unset.
      return { needsExtension: EXTENSION_REQUIRED.test(module), evidence: `module=${module} from ${file}` };
    }
    const ext = config.extends;
    const first = typeof ext === "string" ? ext : Array.isArray(ext) ? ext.find((e) => typeof e === "string") : undefined;
    file = typeof first === "string" ? resolveExtends(first, file, deps) : undefined;
  }
  return {
    evidence: `neither moduleResolution nor module set in ${nearest} or its extends chain; moduleResolution undetermined`,
  };
}

/** The extension a relative import must carry for a source file, when one is
 *  required: TypeScript imports the EMITTED file, so `./foo.ts` is spelled
 *  `./foo.js`. */
function emittedExtension(sourceExt: string): string {
  switch (sourceExt) {
    case ".mts":
      return ".mjs";
    case ".cts":
      return ".cjs";
    case ".ts":
    case ".tsx":
      return ".js";
    default:
      return sourceExt;
  }
}

// ===========================================================================
// Placement
// ===========================================================================

/** A file that IS already a test: `foo.test.ts`, `foo.spec.tsx`, `foo.test.mjs`. */
const TS_TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** The source extensions this leg names a sibling for. */
const TS_SOURCE_EXT = /\.([cm]?[jt]sx?)$/;

/** The nearest ancestor directory holding a `package.json`, or undefined. */
function nearestPackageRoot(fromDir: string, deps: TddDeps): string | undefined {
  const exists = fileExistsOf(deps);
  let d = fromDir;
  for (;;) {
    if (exists(path.join(d, "package.json"))) {
      return d;
    }
    const parent = path.dirname(d);
    if (parent === d) {
      return undefined;
    }
    d = parent;
  }
}

// ===========================================================================
// The frameworks
// ===========================================================================

interface PackageJsonShape {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
}

function readPackageJson(root: string, deps: TddDeps): PackageJsonShape | undefined {
  const raw = readFileOf(deps)(path.join(root, "package.json"));
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as PackageJsonShape) : undefined;
  } catch {
    return undefined;
  }
}

/** The nearest `node_modules/.bin/<name>` at or above `root`, or undefined.
 *  Walks up because a pnpm/npm workspace hoists the bin to the repo root while
 *  the package.json that DECLARES the dependency sits in the package. */
function resolveLocalBin(root: string, name: string, exists: (p: string) => boolean): string | undefined {
  let d = root;
  for (;;) {
    const candidate = path.join(d, "node_modules", ".bin", name);
    if (exists(candidate)) {
      return candidate;
    }
    const parent = path.dirname(d);
    if (parent === d) {
      return undefined;
    }
    d = parent;
  }
}

/**
 * A framework is CONFIGURED when the project declares it in either dependency
 * map. That is the whole rule, and the binary deliberately does not enter it: a
 * declared framework whose `node_modules` is missing is an uninstalled project,
 * not a project that tests with nothing, and answering "no test framework, I
 * looked for vitest and jest" there would name the wrong problem.
 *
 * The missing binary is said on the EVIDENCE CHANNEL instead, and the run then
 * fails to spawn and lands as an environment error. What never happens either
 * way is a fallback to `npx`, which can reach the network (the offline
 * invariant) and prints npm warnings onto stdout ahead of the JSON.
 */
function detectNodeFramework(root: string, name: string, deps: TddDeps): boolean {
  const pkg = readPackageJson(root, deps);
  if (pkg === undefined) {
    return false;
  }
  if (pkg.dependencies?.[name] === undefined && pkg.devDependencies?.[name] === undefined) {
    return false;
  }
  // The `test` script is a CROSS-CHECK and not a requirement: a project can
  // carry vitest and drive it another way.
  const script = typeof pkg.scripts?.test === "string" ? pkg.scripts.test : undefined;
  if (script !== undefined && !script.includes(name)) {
    deps.log?.(`[tdd] ts: ${name} declared in ${root}/package.json but the test script is \`${script}\``);
  }
  if (resolveLocalBin(root, name, fileExistsOf(deps)) === undefined) {
    deps.log?.(
      `[tdd] ts: ${name} is declared in ${root}/package.json but node_modules/.bin/${name} is absent; ` +
        "the run cannot spawn until the project is installed, and this product never installs and never falls back to npx",
    );
  }
  return true;
}

/** The two questions the seam asks a node framework when the project declares
 *  BOTH of them, which a repo mid-migration between jest and vitest does. The
 *  binary is deliberately not part of `detect` — an uninstalled project is not a
 *  project that tests with nothing — but it is exactly the right tie-breaker
 *  once two frameworks are already declared, because only one of them can
 *  actually spawn. */
function nodeProjectFit(root: string, name: string, deps: TddDeps): { installed: boolean; namedByTestScript: boolean } {
  const script = readPackageJson(root, deps)?.scripts?.test;
  return {
    installed: resolveLocalBin(root, name, fileExistsOf(deps)) !== undefined,
    namedByTestScript: typeof script === "string" && new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`).test(script),
  };
}

/** Escape a test TITLE for the `-t` regex. Titles are prose and routinely carry
 *  `(`, `.` and `?`, every one of which is a regex metacharacter. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The `-t` pattern: alternation, END-anchored and never START-anchored.
 *  Measured: `-t` matches the FULL name, which is the describe titles and the
 *  test title joined by spaces, so `^(a|b)$` matches NOTHING while `(a|b)$`
 *  selects exactly the two. */
function titleFilter(testNames: string[]): string {
  return `(${testNames.map(escapeRegex).join("|")})$`;
}

/** The binary the rung spawns: the local one, resolved with the real filesystem
 *  because buildCommand carries no deps (detect already validated it through the
 *  injected ones). The plain join is the fallback tsOracle set the precedent for
 *  — a direct caller gets a failing spawn rather than a throw. */
function runnerBinary(runRoot: string, bin: string): string {
  const found = resolveLocalBin(runRoot, bin, (p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
  return found ?? path.join(runRoot, "node_modules", ".bin", bin);
}

/** The `-t` pattern, or a throw when there is nothing to filter on. */
function requiredTitleFilter(bin: string, testNames: string[]): string {
  const names = testNames.filter((n) => n.length > 0);
  if (names.length === 0) {
    // `-t "()$"` is an empty alternation, which matches EVERY test rather than
    // none. Refusing here is the floor under the caller's refusal.
    throw new Error(`${bin} needs at least one test name: an empty -t pattern selects every test in the file`);
  }
  return titleFilter(names);
}

// The vitest/jest JSON report. Every field is optional and `unknown`-typed
// because the parser must survive a document that is JSON but not a report.
interface JsonAssertion {
  title?: unknown;
  fullName?: unknown;
  status?: unknown;
  failureMessages?: unknown;
}
interface JsonFileResult {
  status?: unknown;
  message?: unknown;
  assertionResults?: unknown;
}
interface JsonReport {
  numPassedTests?: unknown;
  numFailedTests?: unknown;
  numPendingTests?: unknown;
  /** jest only, and MEASURED: 1 when a suite failed to run, for both the
   *  unresolvable import and the syntax error. A positive structural tell that
   *  vitest has no equivalent of. */
  numRuntimeErrorTestSuites?: unknown;
  success?: unknown;
  testResults?: unknown;
}

function numberField(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function stringField(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The reporter colours its transform errors. The human channel is plain text,
 *  and an escape sequence in a notification reads as mojibake. */
function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * The LAST JSON document on stdout, tried from the last line that opens an
 * object and growing backwards.
 *
 * Defensive by contract: the local binary emits one clean line today, but a
 * banner or a pretty-printed report would break a naive `JSON.parse(stdout)` and
 * take the whole rung down with it.
 */
function lastJsonDocument(stdout: string): JsonReport | undefined {
  const lines = (stdout ?? "").replace(/\r/g, "").split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("{")) {
      starts.push(i);
    }
  }
  let attempts = 0;
  for (let k = starts.length - 1; k >= 0 && attempts < 200; k--, attempts++) {
    const candidate = lines.slice(starts[k]).join("\n").trim();
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as JsonReport;
      }
    } catch {
      // Not a document starting here; try an earlier opener.
    }
  }
  return undefined;
}

/**
 * THE BUILD MARKERS, one set per framework, and never one shared regex.
 *
 * A generated test that fails to PARSE is a compile error, whatever "vitest does
 * not type-check" says: vitest does not check TYPES, but it does parse. Both
 * frameworks report that failure in the identical shape as an unresolvable
 * import — zero counts, zero assertions, a message on `testResults[0]` — so only
 * the message tells them apart, and each framework words it its own way.
 * Measured on vitest 4.1.7 and jest 29.7.0:
 *
 *   vitest syntax error: "Transform failed with 1 error … [PARSE_ERROR] …"
 *   jest syntax error:   "Jest encountered an unexpected token … Jest failed to
 *                         parse a file …"
 *
 * Neither framework's markers appear in the other's output, which is exactly the
 * defect a shared regex produced: a jest syntax error matched nothing and was
 * reported to the human as a broken ENVIRONMENT.
 */
const VITEST_BUILD_MARKERS = /Transform failed|\[PARSE_ERROR\]/;
const JEST_BUILD_MARKERS = /Jest encountered an unexpected token|Jest failed to parse/;

/**
 * THE ENVIRONMENT MARKERS: positive, could-not-START text and nothing else.
 *
 * `\bSyntaxError\b` and `Failed to parse source` used to sit in the build set
 * and were DELETED, measured: a test importing `./SyntaxError` reports "Cannot
 * find module './SyntaxError' …", the marker fires on the MODULE PATH, and the
 * human is told to fix a compile error that does not exist. A marker that can
 * match a name the human chose is not a marker.
 */
const NODE_ENVIRONMENT_MARKERS = /Cannot find module|Cannot find package|Failed to load url/;

/**
 * Parse a `--reporter=json` (vitest) or `--json` (jest) report. The two carry
 * the same field names, so they share this parser and differ only by the build
 * markers passed in.
 *
 * THE DISCRIMINATION IS POSITIVE IN BOTH DIRECTIONS, and that is the design.
 * `buildError` fires on this framework's own parse markers; `environmentError`
 * fires on could-not-start text; anything matching NEITHER stays UNCLASSIFIED,
 * both fields undefined. A module that throws at load and "No test suite found
 * in file …" are both honestly unclassified: neither is a compile error and
 * neither is a broken environment, and a default that picked one of the two
 * buckets told the human something false. Phase 6 owns the sentence an
 * unclassified no-run outcome deserves.
 *
 * Nothing is inferred from whether stderr is EMPTY. Measured: vitest leaves it
 * empty on both failures and jest does not (751 and 17943 bytes), so a rung that
 * read emptiness as "the diagnostics must be on stdout" would be right for one
 * framework and wrong for the other.
 *
 * The trap this exists to avoid: a FILTER MISS and an UNRESOLVABLE IMPORT both
 * report zero passed and zero failed. Measured on both frameworks — the filter
 * miss exits 0 with `success: true` and every case `skipped` (so
 * `numPendingTests > 0`), while the import failure exits 1 with
 * `success: false`, ZERO cases and a message. Requiring `numPendingTests > 0` is
 * what keeps a broken import from being reported as "your filter matched
 * nothing", which is the same trap Go had.
 */
function parseNodeTestJson(stdout: string, stderr: string, buildMarkers: RegExp): TestRunParse {
  const report = lastJsonDocument(stdout);
  if (report === undefined) {
    // No report at all: the runner never got far enough to write one. Not a
    // compile error and not a test failure, so it must not be reported as either.
    return {
      ran: false,
      cases: [],
      failures: [],
      passed: 0,
      failed: 0,
      ignored: 0,
      casesComplete: true,
      environmentError: stripAnsi((stderr ?? "").trim()) || "the test runner produced no JSON report",
    };
  }

  const cases: TestCaseResult[] = [];
  const failures: TestFailureDetail[] = [];
  const fileMessages: string[] = [];
  const fileResults: JsonFileResult[] = Array.isArray(report.testResults) ? (report.testResults as JsonFileResult[]) : [];
  for (const file of fileResults) {
    const message = stripAnsi(stringField(file?.message)).trim();
    if (message.length > 0) {
      fileMessages.push(message);
    }
    const assertions: JsonAssertion[] = Array.isArray(file?.assertionResults) ? (file.assertionResults as JsonAssertion[]) : [];
    for (const assertion of assertions) {
      const status = stringField(assertion?.status);
      const outcome: TestOutcome = status === "passed" ? "pass" : status === "failed" ? "fail" : "ignored";
      // `title`, not `fullName`: the title is what the marker region declares and
      // what the `-t` filter deals in; fullName carries the describe prefix.
      const name = stringField(assertion?.title) || stringField(assertion?.fullName);
      cases.push({ name, outcome });
      if (outcome === "fail") {
        const messages = Array.isArray(assertion?.failureMessages) ? (assertion.failureMessages as unknown[]) : [];
        failures.push({ name, message: stripAnsi(messages.map(stringField).join("\n")).trim() });
      }
    }
  }

  const passed = numberField(report.numPassedTests);
  const failed = numberField(report.numFailedTests);
  const pending = numberField(report.numPendingTests);
  const success = report.success === true;
  const parse: TestRunParse = {
    // "Did the runner produce test results". TRUE for a filter miss, because
    // vitest emits every case as `skipped`; what stops a filter miss reading
    // green is the executed>0 guard and filterMatchedNothing, never this.
    ran: cases.length > 0,
    cases,
    failures,
    passed,
    failed,
    ignored: pending,
    // vitest enumerates PASSING tests, unlike C#.
    casesComplete: true,
  };

  if (passed + failed === 0 && pending > 0 && success) {
    parse.filterMatchedNothing = true;
    return parse;
  }

  // The SUITE FAILED TO RUN. jest says so structurally with
  // numRuntimeErrorTestSuites, which is checked FIRST and before any
  // message-based sub-classification; vitest has no such field and is read from
  // the shape instead — no cases, and a message on the file result.
  const runtimeErrorSuites = numberField(report.numRuntimeErrorTestSuites);
  if (runtimeErrorSuites === 0 && (cases.length > 0 || fileMessages.length === 0)) {
    return parse;
  }
  const message = fileMessages.join("\n\n");
  if (buildMarkers.test(message)) {
    parse.buildError = message;
  } else if (NODE_ENVIRONMENT_MARKERS.test(message)) {
    parse.environmentError = message;
  }
  // Neither: unclassified, deliberately. Naming the wrong outcome is worse than
  // naming none, and both fields are optional on TestRunParse for this reason.
  return parse;
}

/** vitest's `run --reporter=json`. Exported because the impl tests drive the
 *  parse directly against real reduced vitest output. */
export function parseVitestJson(stdout: string, stderr: string, _exitCode: number): TestRunParse {
  return parseNodeTestJson(stdout, stderr, VITEST_BUILD_MARKERS);
}

/** jest's `--json`. Same fields, its OWN parse markers, plus the
 *  `numRuntimeErrorTestSuites` tell vitest does not have. */
export function parseJestJson(stdout: string, stderr: string, _exitCode: number): TestRunParse {
  return parseNodeTestJson(stdout, stderr, JEST_BUILD_MARKERS);
}

// ===========================================================================
// The node failure hooks (session-v60 phase B2)
// ===========================================================================

/**
 * One V8 stack frame, in BOTH forms the two runners actually emit. From the
 * committed captures:
 *
 *       at /repo/widget.test.js:6:23                             vitest, bare
 *       at Object.toBe (/repo/widget.test.js:5:23)               jest, named
 *       at runWithCancel (file:///repo/node_modules/…:2323:10)   a URL frame
 *
 * The path is taken as the runner SPELLED it, `file://` scheme included, which
 * is what FailureLocation asks for. `at new Promise (<anonymous>)` matches
 * neither form and needs no rule.
 */
const NODE_FRAME = /^\s*at (?:.*?\s\((.+?):(\d+):(\d+)\)|(.+?):(\d+):(\d+))\s*$/;

/** A frame in code the human did not write. `node_modules` is the runner and
 *  every library under it; `node:` is the RUNTIME's own internals, which jest
 *  puts in the middle of a stack (`at processTicksAndRejections
 *  (node:internal/process/task_queues:103:5)`) and which no repair can act on. */
const NODE_HARNESS_FRAME = /(?:^|[\\/])node_modules[\\/]|^node:/;

/** The frame's path, whichever of the two forms matched, or undefined. */
function nodeFramePath(m: RegExpExecArray): { filePath: string; line: number; column: number } {
  return m[1] !== undefined
    ? { filePath: m[1], line: Number(m[2]), column: Number(m[3]) }
    : { filePath: m[4], line: Number(m[5]), column: Number(m[6]) };
}

/**
 * The failure LOCATION out of a vitest or jest failure message: the FIRST frame
 * that is not the runner's own.
 *
 * First, because V8 prints the stack innermost-first. On both committed
 * captures that frame is the test file and every frame under it is
 * `node_modules`, which is the ordinary shape: an expectation fails INSIDE the
 * assertion library and the library's own frames are what `node_modules` names.
 *
 * ONE pair serves both runners because they share the stack format and, in this
 * file, the parser: `parseVitestJson` and `parseJestJson` are both
 * `parseNodeTestJson`. A second copy would be a second thing to keep true.
 *
 * DECLINES when every frame is the runner's, which is what a failure raised
 * entirely inside the harness looks like, and when nothing frame-shaped is
 * there at all. `connect ECONNREFUSED 127.0.0.1:5432` carries a frame's
 * colon-digit-colon shape and is not a frame; requiring the `at ` prefix is
 * what separates them.
 */
export function nodeStackFailureLocation(message: string): FailureLocation | undefined {
  for (const line of (message ?? "").split(/\r?\n/)) {
    const m = NODE_FRAME.exec(line);
    if (m === null) {
      continue;
    }
    const frame = nodeFramePath(m);
    if (NODE_HARNESS_FRAME.test(frame.filePath)) {
      continue;
    }
    return frame;
  }
  return undefined;
}

/**
 * Every `node_modules` frame, removed.
 *
 * MEASURED on the committed vitest capture: the message is one assertion line
 * and ten stack frames, nine of them inside `@vitest/runner`. They say where
 * the runner was, never where the code under test was, and they are 85% of the
 * message's characters.
 *
 * The runtime's own `node:` frames are LEFT, because the contract names
 * `node_modules` and because a `node:` frame occasionally carries the only
 * clue about an async boundary. They cost one line each.
 */
export function nodeStackStripHarnessFrames(message: string): string {
  return (message ?? "")
    .split(/\r?\n/)
    .filter((line) => {
      const m = NODE_FRAME.exec(line);
      return m === null || !/(?:^|[\\/])node_modules[\\/]/.test(nodeFramePath(m).filePath);
    })
    .join("\n")
    .replace(/\s+$/, "");
}

const VITEST_IMPORT = "import { describe, expect, it } from 'vitest';";
const JEST_IMPORT = "import { describe, expect, it } from '@jest/globals';";

const TS_ASSERTION_INSTRUCTION =
  "Assert with `expect(<call>).toBe(<expected>)`, or `toEqual` for objects and arrays. " +
  "The EXPECTED value is the SOLE ARGUMENT OF THE MATCHER that ends the expect chain — never an " +
  "argument of the call under test. Write each expected value inline in its own matcher. " +
  "One `it` per case, and put the function's name in every `it` title.";

const VITEST: TestFramework = {
  id: "vitest",
  displayName: "vitest",
  detect: (root, deps) => detectNodeFramework(root, "vitest", deps),
  projectFit: (root, deps) => nodeProjectFit(root, "vitest", deps),
  // `<runRoot>/node_modules/.bin/vitest run <file> -t "(a|b)$" --reporter=json`,
  // from the run root. The LOCAL binary, never `npx`: measured, `npx` prints npm
  // warnings onto stdout ahead of the JSON, and it can reach the network.
  buildCommand(placement, testNames): TestRunCommand {
    return {
      command: runnerBinary(placement.runRoot, "vitest"),
      args: ["run", placement.targetPath, "-t", requiredTitleFilter("vitest", testNames), "--reporter=json"],
      cwd: placement.runRoot,
    };
  },
  parseOutput: parseVitestJson,
  failureLocation: nodeStackFailureLocation,
  stripHarnessFrames: nodeStackStripHarnessFrames,
  assertionInstruction: TS_ASSERTION_INSTRUCTION,
  expectedValueSpans: tsExpectedValueSpans,
  classifiesBuildError: true,
  unresolvedAssertions: tsUnresolvedAssertions,
};

// MEASURED, on jest 29.7.0 in `~/work/utilitydelta-io/utilitydelta-app` against
// a real 15-file suite and a scratch root. What the measurement settled:
//
//   - `-t` is a regex, alternation selects exactly the named tests, `$` works
//     and `^` matches NOTHING — the same full-name trap vitest has, so the one
//     `(a|b)$` rule is now measured on both rather than measured on one;
//   - the filter miss is the same silent false green: exit 0, success true,
//     zero passed, zero failed, numPendingTests > 0;
//   - jest carries numRuntimeErrorTestSuites, a POSITIVE structural tell that a
//     suite failed to run, which vitest has no equivalent of;
//   - and its syntax error is worded nothing like vitest's, which is why the
//     build markers are per framework.
const JEST: TestFramework = {
  id: "jest",
  displayName: "jest",
  detect: (root, deps) => detectNodeFramework(root, "jest", deps),
  projectFit: (root, deps) => nodeProjectFit(root, "jest", deps),
  buildCommand(placement, testNames): TestRunCommand {
    // jest has no `run` verb, takes the file through `--runTestsByPath`, and
    // spells its JSON report `--json` rather than a named reporter. `-t` is the
    // same end-anchored full-name regex.
    return {
      command: runnerBinary(placement.runRoot, "jest"),
      args: ["--json", "--runTestsByPath", placement.targetPath, "-t", requiredTitleFilter("jest", testNames)],
      cwd: placement.runRoot,
    };
  },
  parseOutput: parseJestJson,
  failureLocation: nodeStackFailureLocation,
  stripHarnessFrames: nodeStackStripHarnessFrames,
  assertionInstruction: TS_ASSERTION_INSTRUCTION,
  expectedValueSpans: tsExpectedValueSpans,
  classifiesBuildError: true,
  unresolvedAssertions: tsUnresolvedAssertions,
};

// ===========================================================================
// The scaffold
// ===========================================================================

interface ImportSpec {
  module: string;
  names: string[];
  /** `import type { … }`: a TYPE-ONLY declaration, which a VALUE name must never
   *  be merged into. */
  typeOnly?: boolean;
}

/** `import { a, b } from 'mod';` -> { module: "mod", names: ["a","b"] }. */
function parseImportLine(line: string): ImportSpec | undefined {
  const m = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/.exec(line);
  if (m === null) {
    return undefined;
  }
  const names = m[2]
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return { module: m[3], names, typeOnly: m[1] !== undefined };
}

interface ImportDecl {
  start: number;
  end: number;
  text: string;
  spec?: ImportSpec;
}

/** Every top-level `import` declaration, in source order, found structurally so
 *  the word `import` inside a string or a comment is never one. */
function importDecls(text: string): ImportDecl[] {
  const out: ImportDecl[] = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, TS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (
      text.startsWith("import", i) &&
      !isIdentChar(text[i - 1] ?? "") &&
      !isIdentChar(text[i + 6] ?? "") &&
      text[i + 6] !== "(" // `import(…)`, a dynamic import expression
    ) {
      // Ends at the first `;` outside a literal, or at the end of the line
      // holding the module specifier when the file omits semicolons.
      let j = i + 6;
      let quoted = false;
      while (j < text.length) {
        const inner = skipLiteralOrComment(text, j, TS_LITERALS);
        if (inner > j) {
          quoted = quoted || text[j] === "'" || text[j] === '"';
          j = inner;
          continue;
        }
        if (text[j] === ";") {
          j++;
          break;
        }
        if (text[j] === "\n" && quoted) {
          break;
        }
        j++;
      }
      const decl = text.slice(i, j);
      out.push({ start: i, end: j, text: decl, spec: parseImportLine(decl) });
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * `text` with every wanted import present: merged into an existing declaration
 * from the same module when there is one to merge into, added as a fresh line
 * otherwise. `changed` is false when the file already had them all, which is
 * what lets the plan stay a narrow append.
 *
 * Two things it must not do, both proven against the corpus's own tsc:
 *
 * 1. NEVER merge a value name into an `import type { … }`. The rewritten line
 *    loses the `type` keyword, and `react-mobx-mvvm` sets
 *    `verbatimModuleSyntax`, under which that is `error TS1484`. vitest does not
 *    typecheck, so the rung stays GREEN while the human's own `npm run
 *    typecheck` breaks on a line this product wrote. A fresh value import is
 *    always legal beside a type-only one.
 * 2. Compute what is missing against the UNION across EVERY declaration for the
 *    module, not the first match. A file with `import { describe, it } from
 *    'vitest'` and `import { expect } from 'vitest'` is legal, and merging
 *    against only the first produces a duplicate `expect` binding.
 */
function ensureImports(text: string, wanted: ImportSpec[]): { text: string; changed: boolean } {
  const decls = importDecls(text);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const fresh: string[] = [];
  for (const want of wanted) {
    const sameModule = decls.filter((d) => d.spec?.module === want.module);
    const alreadyBound = new Set(sameModule.flatMap((d) => d.spec?.names ?? []));
    const missing = want.names.filter((n) => !alreadyBound.has(n));
    if (missing.length === 0 && sameModule.length > 0) {
      continue;
    }
    const mergeInto = sameModule.find((d) => d.spec?.typeOnly !== true);
    if (mergeInto === undefined) {
      fresh.push(`import { ${missing.join(", ")} } from '${want.module}';`);
      continue;
    }
    edits.push({
      start: mergeInto.start,
      end: mergeInto.end,
      text: `import { ${[...(mergeInto.spec?.names ?? []), ...missing].join(", ")} } from '${want.module}';`,
    });
  }
  if (fresh.length > 0) {
    // After the last existing import, so the file keeps one import block.
    const last = decls[decls.length - 1];
    const at = last?.end ?? 0;
    const block = fresh.join("\n");
    edits.push({ start: at, end: at, text: last === undefined ? `${block}\n\n` : `\n${block}` });
  }
  if (edits.length === 0) {
    return { text, changed: false };
  }
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return { text: out, changed: true };
}

// ===========================================================================
// The language
// ===========================================================================

const TS_MARKER_PREFIX = "//";

/** The test DECLARATION keywords. `it` and `test` are aliases in both vitest and
 *  jest, and a model picks whichever the surrounding file uses. */
const TS_TEST_DECLARATIONS = new Set(["it", "test"]);

/** The titles declared by `it('…')` / `test('…')` in `region`, read through the
 *  literal-aware scanner so a declaration spelled inside a string, a template or
 *  a comment is never one. A title is taken only from a TERMINATED literal;
 *  anything else names a test the runner cannot have registered. */
function tsTestTitles(region: string): string[] {
  const titles: string[] = [];
  let i = 0;
  while (i < region.length) {
    const skipped = skipLiteralOrComment(region, i, TS_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(region.slice(i));
    if (word === null) {
      i++;
      continue;
    }
    const name = word[0];
    if (!TS_TEST_DECLARATIONS.has(name) || isIdentChar(region[i - 1] ?? "") || region[i - 1] === ".") {
      i += name.length;
      continue;
    }
    const open = skipTrivia(region, i + name.length);
    if (region[open] !== "(") {
      i += name.length;
      continue;
    }
    const titleStart = skipTrivia(region, open + 1);
    const quote = region[titleStart];
    if (quote !== "'" && quote !== '"' && quote !== "`") {
      i += name.length;
      continue;
    }
    const titleEnd = skipLiteralOrComment(region, titleStart, TS_LITERALS);
    if (titleEnd > titleStart + 1 && region[titleEnd - 1] === quote) {
      titles.push(region.slice(titleStart + 1, titleEnd - 1));
    }
    i = Math.max(titleEnd, i + name.length);
  }
  return titles;
}

function tsScaffold(input: ScaffoldInput): TestInsertionPlan {
  const { begin, end } = testMarkers(input.markerId, TS_MARKER_PREFIX);
  // Top-level `describe`/`it` sit at column 0 whatever the model emitted.
  const region = `${begin}\n${reindent(input.generatedTests, "")}\n${end}`;
  const text = input.existingText;

  // 1. replace-generated: a prior marked region for this markerId — swap exactly
  //    it, so regenerating is idempotent and the developer's own tests in the
  //    same file are never touched.
  const bi = text.indexOf(begin);
  if (bi !== -1) {
    const ei = text.indexOf(end, bi);
    if (ei !== -1) {
      return { start: bi, end: ei + end.length, mode: "replace-generated", text: region };
    }
  }

  const wanted: ImportSpec[] = [];
  const frameworkImport = parseImportLine(input.placement.frameworkImportLine ?? VITEST_IMPORT);
  if (frameworkImport !== undefined) {
    wanted.push(frameworkImport);
  }
  const unitImport = input.placement.importLine === undefined ? undefined : parseImportLine(input.placement.importLine);
  if (unitImport !== undefined) {
    wanted.push(unitImport);
  }

  // 2. the whole file, when there is no file yet.
  if (text.trim().length === 0) {
    const head = wanted.map((w) => `import { ${w.names.join(", ")} } from '${w.module}';`).join("\n");
    return { start: 0, end: text.length, mode: "new-module", text: `${head}\n\n${region}\n` };
  }

  // 3. extend-existing: append the marked region at end of file.
  const tail = `${text.endsWith("\n") ? "" : "\n"}\n${region}\n`;
  const withImports = ensureImports(text, wanted);
  if (!withImports.changed) {
    return { start: text.length, end: text.length, mode: "extend-existing", text: tail };
  }
  // An import has to go near the TOP while the tests go at the BOTTOM, and a
  // TestInsertionPlan is ONE contiguous replacement, so the span is the whole
  // file. The Go leg hit the same wall. Phase 6 owns the fix; what this leg owes
  // it is DETECTABILITY without a new mode string, and a whole-file plan is
  // exactly `start === 0 && end === existingText.length` over a non-empty file —
  // which the append branch above can never produce.
  return { start: 0, end: text.length, mode: "extend-existing", text: `${withImports.text}${tail}` };
}

function tsPlacementFor(filePath: string, symbolName: string, deps: TddDeps): PlacementResult {
  const exists = fileExistsOf(deps);
  const dir = path.dirname(filePath);
  const runRoot = nearestPackageRoot(dir, deps);
  if (runRoot === undefined) {
    return {
      ok: false,
      refusal: {
        reason: "no-project-root",
        detail: `no package.json in ${dir} or any parent directory, so there is no project to run the tests in`,
      },
    };
  }

  const base = path.basename(filePath);
  const extM = TS_SOURCE_EXT.exec(base);
  const ext = extM === null ? "" : `.${extM[1]}`;
  const stem = ext === "" ? base : base.slice(0, -ext.length);

  // A source file that IS a test file has no `foo.test.test.ts` sibling to make:
  // the target IS the source, and the mode has to SAY so. There is also nothing
  // to import — a helper in a test file is already in scope.
  if (TS_TEST_FILE.test(base)) {
    return {
      ok: true,
      placement: { targetPath: filePath, exists: exists(filePath), mode: "same-file", runRoot },
    };
  }

  if (!/^[A-Za-z_$][\w$]*$/.test(symbolName)) {
    // The import is spelled by NAME, so a name that cannot be spelled has no
    // import line, and a scaffold without one produces a red the human cannot act
    // on. Refuse instead.
    return {
      ok: false,
      refusal: {
        reason: "unresolvable-import",
        detail: `\`${symbolName}\` is not a plain identifier, so the test file has no name to import it by`,
      },
    };
  }

  const rule = importExtensionRule(dir, deps);
  if (rule.needsExtension === undefined) {
    deps.log?.(`[tdd] ts: ${rule.evidence}; spelling the import EXTENSIONLESS, which is right for bundler/node and wrong for node16/nodenext`);
  } else {
    deps.log?.(`[tdd] ts: ${rule.evidence}; import extension ${rule.needsExtension ? emittedExtension(ext) : "(none)"}`);
  }
  const specifier = `./${stem}${rule.needsExtension === true ? emittedExtension(ext) : ""}`;
  const targetPath = path.join(dir, `${stem}.test${ext}`);
  return {
    ok: true,
    placement: {
      targetPath,
      exists: exists(targetPath),
      mode: "sibling-file",
      runRoot,
      // vitest takes the test FILE path, which is targetPath. No package argument.
      importLine: `import { ${symbolName} } from '${specifier}';`,
      frameworkImportLine: detectNodeFramework(runRoot, "vitest", { ...deps, log: undefined })
        ? VITEST_IMPORT
        : detectNodeFramework(runRoot, "jest", { ...deps, log: undefined })
          ? JEST_IMPORT
          : VITEST_IMPORT,
    },
  };
}

/**
 * Where a DISCOVERED TypeScript test file runs from.
 *
 * `tsPlacementFor` already answers same-file for a `.test.ts`, so this leg's
 * disagreement with it is narrower than C#'s, but only by accident of naming.
 * A test file the call walk found is a test file whatever it is CALLED, and
 * `helpers.ts` full of `it(...)` would get a `helpers.test.ts` sibling that does
 * not exist and cannot be run.
 */
function tsRunTargetForTestFile(testFilePath: string, deps: TddDeps): PlacementResult {
  const dir = path.dirname(testFilePath);
  const runRoot = nearestPackageRoot(dir, deps);
  if (runRoot === undefined) {
    return {
      ok: false,
      refusal: {
        reason: "no-project-root",
        detail: `no package.json in ${dir} or any parent directory, so there is no project to run ${path.basename(testFilePath)} in`,
      },
    };
  }
  // The NEAREST package.json, not the workspace root: the runner binary and its
  // config live beside the package that declares them.
  //
  // No importLine and no frameworkImportLine: nothing is written, so there is
  // nothing to import. Which framework runs it is `frameworkFor`'s question,
  // asked at the run root this carries.
  return { ok: true, placement: { targetPath: testFilePath, exists: true, mode: "same-file", runRoot } };
}

/**
 * One TddLang per registered languageId. `typescriptreact`, `javascript` and
 * `javascriptreact` share every rule with `typescript`: the placement, the
 * frameworks and the locator are all about the MODULE SYSTEM and the test
 * runner, neither of which changes with JSX or with type annotations. The
 * displayName differs so a refusal names the language the human is actually
 * looking at.
 */
function makeTsLang(languageId: string, displayName: string): TddLang {
  return {
    languageId,
    displayName,

    placementFor: tsPlacementFor,

    // Both runners take the test FILE (vitest as a positional path, jest
    // through `--runTestsByPath`) plus a `-t` title filter. One spawn covers
    // one file.
    runScope: "file",

    runTargetForTestFile: tsRunTargetForTestFile,

    scaffold: tsScaffold,

    markerPrefix: TS_MARKER_PREFIX,

    // The name the rung filters on is the `it` TITLE, not an identifier — a real
    // difference from Rust and Go.
    //
    // Walked with the shared literal-aware scanner rather than a regex, for the
    // same reason the locator is: a title is prose and routinely contains code,
    // so `expect(render()).toBe("it('phantom')")` inside the region hands a
    // regex a test name that does not exist, the `-t` filter then matches
    // nothing, and the human gets a filter miss wearing a false green's clothes.
    //
    // BOTH `it(` and `test(` count. They are equally valid declarations in
    // vitest and in jest, and a model that wrote `test(` used to yield no names
    // at all — which the rung reports as "run Generate Tests first", which is
    // not what happened.
    generatedTestNames(fileText: string, markerId: string): string[] {
      const { begin, end } = testMarkers(markerId, TS_MARKER_PREFIX);
      const bi = fileText.indexOf(begin);
      if (bi === -1) {
        return [];
      }
      const ei = fileText.indexOf(end, bi);
      if (ei === -1) {
        return [];
      }
      return tsTestTitles(fileText.slice(bi + begin.length, ei));
    },

    // No testNameIsValid: vitest and jest run whatever `it` declares. The filter
    // consequence is real but is not a naming rule — because `-t` matches the
    // describe-joined full name, a generated title that collides with another
    // test's title in the same file is selected too, which end-anchoring narrows
    // and cannot eliminate. The prompt asks for the symbol name in the title.

    classifyTestability: classifyTsTestability,

    returnTypeOf: tsReturnTypeOf,

    renderBlankValue: tsRenderBlankValue,

    frameworks: [VITEST, JEST],
  };
}

const TS_TDD_LANGS: TddLang[] = [
  makeTsLang("typescript", "TypeScript"),
  makeTsLang("typescriptreact", "TypeScript"),
  makeTsLang("javascript", "JavaScript"),
  makeTsLang("javascriptreact", "JavaScript"),
];

export { TS_TDD_LANGS, VITEST, JEST, VITEST_IMPORT, JEST_IMPORT };
