/**
 * The Python leg of the TDD language seam.
 *
 * Python is the leg that can be validated END TO END on real code: 7 of 89
 * functions in `mcp-graph-engine/src` survive the classifier, level with the
 * shipped Rust control, and six of the seven are parsers taking a string and
 * returning a structured value: the ideal blind-unit-test target.
 *
 * Three things make it unlike the three legs before it:
 *
 *  1. **The import must be PROVEN before a file is written.** `from atlas import
 *     fanout` works when the module sits at the rootdir and fails in a src-layout
 *     project whose package is not installed, and that failure reaches the human
 *     as a collection error they cannot act on. So the derived module is run
 *     through the project's own interpreter (`-c "import <module>"`, offline)
 *     and a definite failure refuses with `unresolvable-import`.
 *  2. **The run is parsed from `--junit-xml`, never from the text.** MEASURED
 *     against pytest 9.0.2: a `print()` in the code under test lands at COLUMN 0
 *     in the captured-stdout section, so a parser scanning for `^FAILED` or the
 *     trailing count line gets a phantom test and a forged count. The XML's
 *     `<testsuite>` ATTRIBUTES cannot be reached from inside a test.
 *  3. **There is no visibility leg and no build error.** Python has no privacy,
 *     so `not-exported` can never fire. `_is_port_available` is one of the seven
 *     survivors. And Python has no build step, so a syntax error in the generated
 *     file arrives as a COLLECTION ERROR, which is `environmentError`.
 *
 * Never imports vscode (the src/core rule).
 * Contract: docs/architecture/tdd-language-seam.md.
 */

import * as os from "os";
import * as path from "path";
import type { TestCaseResult, TestFailureDetail, TestOutcome } from "./compilerOracle";
import { resolvePythonInterpreter } from "./pyOracle";
import {
  LiteralProfile,
  TestInsertionPlan,
  matchDelim as matchDelimIn,
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
  TestPlacement,
  TestRunCommand,
  TestRunParse,
  fileExistsOf,
  probeOf,
  readFileOf,
  readDirOf,
} from "./tddLang";
import { XmlTag, attrNumber, elementText, scanXmlTags } from "./xmlReader";

// ===========================================================================
// The Python literal profile, and the depth scanner every Python rule shares
// ===========================================================================

/** Python against the shared scanner's Rust defaults: `'…'` is a full string,
 *  `#` opens a comment and `//` does NOT (it is floor division), triple-quoted
 *  strings run across lines, and an f-string's `{…}` holds an expression. */
const PY_LITERALS: LiteralProfile = {
  singleQuoteStrings: true,
  hashComments: true,
  tripleQuotedStrings: true,
  fStringInterpolation: true,
};

const OPENERS = "([{";
const CLOSERS = ")]}";

function isIdentChar(c: string): boolean {
  return /\w/.test(c ?? "");
}

function skipSpace(text: string, i: number): number {
  while (i < text.length && /[ \t]/.test(text[i])) {
    i++;
  }
  return i;
}

/** The delimiter matching the one at `open`, over Python's literal profile. The
 *  shared depth scanner from testAssembly.ts, bound to this profile: the fifth
 *  language reuses it rather than growing a fifth copy. */
function matchDelim(text: string, open: number): number {
  return matchDelimIn(text, open, PY_LITERALS);
}

/** Split on TOP-LEVEL commas, respecting `()[]{}` nesting, so
 *  `dict[str, list[int]]` splits into two and not three. */
function splitTopLevelPy(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (OPENERS.includes(c)) {
      depth++;
    } else if (CLOSERS.includes(c)) {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** The `(` opening the PARAMETER list of a `def`, or -1. Found by scanning past
 *  the name and an optional 3.12 type-parameter list rather than by indexOf, so
 *  `def f[T](x: T)` finds the real one. */
function paramListOpen(sig: string): number {
  const defM = /\bdef\b/.exec(sig);
  let i = defM === null ? 0 : skipSpace(sig, defM.index + 3);
  const nameM = /^[A-Za-z_]\w*/.exec(sig.slice(i));
  if (nameM !== null) {
    i = skipSpace(sig, i + nameM[0].length);
  }
  if (sig[i] === "[") {
    const close = matchDelim(sig, i);
    if (close === -1) {
      return -1;
    }
    i = skipSpace(sig, close + 1);
  }
  return sig[i] === "(" ? i : -1;
}

// ===========================================================================
// returnTypeOf
// ===========================================================================

/**
 * The return type text of a Python signature, or undefined when there is none.
 * Python spells it `->` like Rust, which is why the shipped Rust regex looks
 * like it would do, and it does not: its capture runs to end of text and
 * SWALLOWS THE TRAILING COLON, so `def f() -> str:` yields `"str:"`.
 *
 *   def f(a: int) -> str:                  -> "str"
 *   def f(a: int) -> list[int]:            -> "list[int]"
 *   def f(a: int):                         -> undefined
 *   def f(a: int) -> None:                 -> undefined
 *   def f(a: dict[str, int]) -> bool:      -> "bool"
 *   def f(a: Callable[[int], int]) -> str: -> "str"
 *
 * The last two are what a naive regex breaks on: a parameter annotation holding
 * its own `->` inside a `Callable`, and one holding a colon inside a `dict`. So
 * the parameter list is closed BY DEPTH first, and the type then runs from `->`
 * to the first colon at depth zero: the colon that opens the body.
 *
 * `-> None` answers undefined, the Rust precedent this session ratified
 * (supersession S1): a unit return is nothing to assert on, so the consumer's
 * "returns no value to assert" gate must be able to fire.
 */
export function pyReturnTypeOf(signature: string): string | undefined {
  const sig = signature ?? "";
  const open = paramListOpen(sig);
  if (open === -1) {
    return undefined;
  }
  const close = matchDelim(sig, open);
  if (close === -1) {
    return undefined;
  }
  let i = skipSpace(sig, close + 1);
  if (sig[i] !== "-" || sig[i + 1] !== ">") {
    return undefined;
  }
  i += 2;
  const start = i;
  let end = sig.length;
  let depth = 0;
  while (i < sig.length) {
    const skipped = skipLiteralOrComment(sig, i, PY_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = sig[i];
    if (OPENERS.includes(c)) {
      depth++;
    } else if (CLOSERS.includes(c)) {
      depth--;
    } else if (c === ":" && depth === 0) {
      end = i;
      break;
    }
    i++;
  }
  const ret = sig.slice(start, end).trim();
  return ret.length === 0 || ret === "None" ? undefined : ret;
}

/** The parameter list's top-level elements (`self`, `a: int = 3`), or [] when
 *  the signature has no readable one. */
function parametersOf(signature: string): string[] {
  const open = paramListOpen(signature);
  if (open === -1) {
    return [];
  }
  const close = matchDelim(signature, open);
  return close === -1 ? [] : splitTopLevelPy(signature.slice(open + 1, close));
}

// ===========================================================================
// Testability
// ===========================================================================

// `async def`, plus the return types that mean the same thing to a caller. An
// `asyncio.create_task` in the BODY is invisible to a signature-only classifier
// and is an accepted residual, named here so it is not rediscovered as a bug.
const PY_ASYNC_KEYWORD = /\basync\s+def\b/;
const PY_ASYNC_RETURN = /^(Awaitable|Coroutine|AsyncIterator|AsyncIterable|AsyncGenerator)\b/;

// The IO/network marker set, from the goal: an `open(` default, a path type, a
// socket, a requests session.
//
// MEASURED 0 on mcp-graph-engine, and that ZERO IS FALSE:
// `_is_port_available(host: str, port: int) -> bool` opens a socket in its BODY
// and passes this leg, because classifyTestability sees a signature and never a
// body. Shared with the product's Rust and C# classifiers, not fixable here, and
// recorded so nobody files it as a bug against this leg.
const PY_IO = /\bopen\s*\(|\bpathlib\b|\bPath\b|\bsocket\b|\brequests\b/;

/**
 * Classify a Python function as a blind-unit-test target or an honest failure.
 * First-match-wins over the same FIXED precedence as every other leg, so the
 * reported reason is stable: async → io → needs-fixture → underspecified →
 * testable. Pure; never throws.
 *
 * `not-exported` is UNREACHABLE BY DESIGN and must stay so. Python has no
 * privacy: a leading underscore is a convention about intent, not a barrier to
 * an importer, and refusing on it would refuse `_is_port_available`, which is one
 * of the seven functions that survive on the real corpus.
 *
 * Largest refusal, measured: needs-fixture at 71.9%, from a `self`/`cls` first
 * parameter. Unlike TypeScript (Amendment 4), Python's receiver is a DECLARED
 * PARAMETER, so the method form needs no separate tell and this leg does not
 * over-refuse a free function that happens to sit in a class-shaped file.
 */
export function classifyPyTestability(signature: string, docComment?: string): TestabilityVerdict {
  const sig = signature ?? "";
  const returnType = pyReturnTypeOf(sig);

  if (PY_ASYNC_KEYWORD.test(sig) || (returnType !== undefined && PY_ASYNC_RETURN.test(returnType))) {
    return {
      testable: false,
      reason: "async",
      detail: "async def, or an awaitable return: a blind unit test cannot drive it",
    };
  }
  if (PY_IO.test(sig)) {
    return {
      testable: false,
      reason: "io",
      detail: "IO/network in the signature (open, Path, socket, requests): integration territory, not a blind unit test",
    };
  }
  const first = parametersOf(sig)[0];
  if (first !== undefined && /^(self|cls)\b/.test(first)) {
    return {
      testable: false,
      reason: "needs-fixture",
      detail: `method taking \`${/^\w+/.exec(first)?.[0] ?? "self"}\`: needs a constructed fixture`,
    };
  }
  if (docComment === undefined || docComment.trim() === "") {
    return { testable: false, reason: "underspecified", detail: "no docstring: no contract to author a blind test from" };
  }
  if (returnType === undefined) {
    return {
      testable: false,
      reason: "underspecified",
      detail: "no return annotation, or `-> None`: nothing to assert on",
    };
  }
  return { testable: true };
}

// ===========================================================================
// Blank values
// ===========================================================================

const PY_SCALAR = /^(int|str|bool|float|complex|bytes)$/;

/** `list[int]` -> `{ name: "list", args: ["int"] }`, undefined when the type is
 *  not subscripted. Both spellings are read: PEP 585's builtin generics and
 *  `typing`'s capitalized aliases, which real code still carries. */
function parsePySubscript(ty: string): { name: string; args: string[] } | undefined {
  const m = /^([A-Za-z_][\w.]*)\s*\[([\s\S]*)\]$/.exec(ty.trim());
  if (m === null) {
    return undefined;
  }
  const bare = m[1].includes(".") ? m[1].slice(m[1].lastIndexOf(".") + 1) : m[1];
  return { name: bare, args: splitTopLevelPy(m[2]) };
}

/**
 * The blank-value RHS for a Python return type. Scaffold what the TYPE
 * determines (no contract leak), keep as ONE hole what the CONTRACT determines
 * (a leak would defeat blank-value). Amendment 2's rule throughout: a SCALAR
 * gets a bare hole, everything else gets a hole carrying a type-hint comment,
 * and a container's contents are hinted with the ELEMENT type.
 *
 * The hint spelling is `/* T *​/`, which contract-py.md gives literally and which
 * is NOT a Python comment. That is deliberate and it is the same text every other
 * leg emits: the hint is a snippet PLACEHOLDER the human types over, not code
 * meant to survive. A human who tabs past it without typing is left with invalid
 * Python, which is the blank-value gesture working, since an unfilled expected
 * value must never look like a finished test.
 *
 * Pure; never throws.
 */
export function pyRenderBlankValue(returnType: string, opts?: { startHole?: number }): BlankValueResult {
  const start = opts?.startHole ?? 1;
  const ty = (returnType ?? "").trim();
  const hole = (i: number) => `\${${start + i}}`;
  const hint = (t: string) => `\${${start}:/* ${escapeSnippet(t)} */}`;

  // A scalar is one bare hole: nothing about it is type-determined.
  if (PY_SCALAR.test(ty)) {
    return { rhs: hole(0), holes: 1 };
  }

  // `T | None` and `Optional[T]`: the variant IS the answer, so one hinted hole,
  // the Option/Result precedent Rust set and every leg has kept.
  if (splitTopLevelPy(ty.replace(/\|/g, ",")).length > 1 && ty.includes("|")) {
    return { rhs: hint(ty), holes: 1 };
  }

  const sub = parsePySubscript(ty);
  if (sub !== undefined) {
    if (sub.name === "Optional") {
      return { rhs: hint(ty), holes: 1 };
    }
    // A tuple's ARITY is type-determined, so it scaffolds one hole per element:
    // the shipped Rust tuple branch, with Python's brackets around it.
    if ((sub.name === "tuple" || sub.name === "Tuple") && sub.args.length > 0 && !sub.args.includes("...")) {
      return { rhs: `(${sub.args.map((_, i) => hole(i)).join(", ")})`, holes: sub.args.length };
    }
    // The CONSTRUCTOR is type-determined and leaks nothing; how many elements and
    // which they are is contract-determined and stays ONE hole.
    if ((sub.name === "list" || sub.name === "List" || sub.name === "Sequence") && sub.args.length === 1) {
      return { rhs: `[${hint(sub.args[0])}]`, holes: 1 };
    }
    if ((sub.name === "set" || sub.name === "Set" || sub.name === "frozenset" || sub.name === "FrozenSet") && sub.args.length === 1) {
      return { rhs: `{${hint(sub.args[0])}}`, holes: 1 };
    }
    if ((sub.name === "dict" || sub.name === "Dict" || sub.name === "Mapping") && sub.args.length === 2) {
      return { rhs: `{${hint(`${sub.args[0]}, ${sub.args[1]}`)}}`, holes: 1 };
    }
  }

  // A named class, a TypedDict, an unrecognised generic: one hole hinting the
  // type, which is the honest fallback for every shape that is not scaffoldable.
  return { rhs: hint(ty), holes: 1 };
}

// ===========================================================================
// The expected-value locators
// ===========================================================================

/** True when `i` opens a STATEMENT: the previous non-blank character is a line
 *  break, a `;`, a `:` (a one-line suite: `if x: assert …`), or nothing. Keeps
 *  the `assert` of `x = assert_shaped` and any in-expression match out. */
function isStatementStart(text: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (text[j] === " " || text[j] === "\t")) {
    j--;
  }
  return j < 0 || text[j] === "\n" || text[j] === ";" || text[j] === ":";
}

/**
 * The end of the expected value that starts at `start`: a top-level `,` (which
 * begins the assert MESSAGE and must never be blanked), a `;`, a `#` comment, a
 * closing delimiter that is not ours, or the end of the logical line.
 *
 * A newline ends it only at depth zero and only when the line does not continue:
 * Python continues a line inside brackets and after a trailing backslash, so
 * `assert f() == [\n  1,\n]` is one value and blanking half of it would leave
 * the model's other half in the human's buffer.
 */
function valueEnd(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (depth === 0 && c === "#") {
      break;
    }
    const skipped = skipLiteralOrComment(text, i, PY_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (OPENERS.includes(c)) {
      depth++;
    } else if (CLOSERS.includes(c)) {
      if (depth === 0) {
        break;
      }
      depth--;
    } else if (depth === 0 && (c === ";" || c === ",")) {
      break;
    } else if (depth === 0 && c === "\n") {
      let j = i - 1;
      while (j >= start && (text[j] === " " || text[j] === "\t" || text[j] === "\r")) {
        j--;
      }
      if (text[j] !== "\\") {
        break;
      }
    }
    i++;
  }
  while (i > start && /\s/.test(text[i - 1])) {
    i--;
  }
  return i;
}

/** The `==` at depth zero between `from` and `limit`, or -1. `!=`, `<=`, `>=`
 *  and a bare `=` are not it, and neither is an `==` nested inside a call or a
 *  literal: `assert d == {"a": 1 == 2}` blanks the OUTER right-hand side. */
function topLevelEquals(text: string, from: number, limit: number): number {
  let depth = 0;
  let i = from;
  while (i < limit) {
    const skipped = skipLiteralOrComment(text, i, PY_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = text[i];
    if (OPENERS.includes(c)) {
      depth++;
    } else if (CLOSERS.includes(c)) {
      if (depth === 0) {
        return -1;
      }
      depth--;
    } else if (depth === 0 && c === "=" && text[i + 1] === "=" && text[i + 2] !== "=" && !"!<>=".includes(text[i - 1] ?? "")) {
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * The `==` this `assert` compares on, seeing through ONE redundant enclosing
 * paren: `assert (f(3) == 7)` and its multi-line form compare on the `==` inside
 * the parens, and depth zero alone never finds it.
 *
 * Not a nicety. `black` and `ruff format` wrap an assert in exactly this shape
 * the moment the line is long, so it is the ordinary spelling of a long
 * assertion, and a locator that misses it hands the model's guessed value
 * straight to the human: the blank-value invariant inverted, silently.
 *
 * ONE paren, and only when it wraps the WHOLE statement. `assert (a == b) and c`
 * is left alone: its parens are not redundant, and blanking inside them would
 * blank one operand of a shape this locator does not otherwise handle
 * (scraps.md D5, deferred to phase 6).
 */
function assertEquals(text: string, from: number, limit: number): number {
  const direct = topLevelEquals(text, from, limit);
  if (direct !== -1) {
    return direct;
  }
  const open = skipWhitespaceAndContinuations(text, from);
  if (text[open] !== "(") {
    return -1;
  }
  const close = matchDelim(text, open);
  if (close === -1 || close >= limit) {
    return -1;
  }
  // Whole-statement only: past the `)` there may be nothing but the assert
  // MESSAGE (`, "msg"`) or a comment.
  const after = skipSpace(text, close + 1);
  if (after < limit && text[after] !== "," && text[after] !== "#") {
    return -1;
  }
  return topLevelEquals(text, open + 1, close);
}

/**
 * The EXPECTED-VALUE spans in generated pytest text: the right-hand side of the
 * TOP-LEVEL `==` inside an `assert` statement, and nothing else.
 *
 * Safety-critical. It must not blank the left-hand side (that is the call under
 * test), an `assert` spelled inside a string or a docstring, or the MESSAGE of
 * `assert x == y, "msg"`: each would keep the model's guessed value, which is
 * the blank-value invariant inverted. Spans come back ascending and
 * non-overlapping.
 *
 * FAILS OPEN, deliberately and with a known cost: `assert x != y`, `assert x`
 * and `assert x is None` have no top-level `==` and yield NO span, so a module
 * of only those shapes blanks nothing and the human is shown the model's values.
 * The general per-assertion floor is scraps.md D5, deferred to phase 6; this leg
 * owes it a locator that does not make the shape worse.
 */
export function pytestExpectedValueSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, PY_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (
      text.startsWith("assert", i) &&
      !isIdentChar(text[i + 6]) &&
      !isIdentChar(text[i - 1] ?? "") &&
      isStatementStart(text, i)
    ) {
      // The statement's own extent first, so an `==` on a LATER line can never be
      // read as this assert's comparison.
      const stmtEnd = valueEnd(text, i + 6);
      const eq = assertEquals(text, i + 6, stmtEnd);
      if (eq !== -1) {
        // A CHAINED comparison (`assert f(1) == 2 == 3`) blanks `2 == 3` whole,
        // as one value. That is a CHOICE, not an oversight: the value end runs to
        // the end of the logical line, so both operands go, `assert f(1) ==
        // ${1}` is valid Python, and no guessed number survives. Blanking only
        // the first operand would leave the model's `3` in the human's buffer,
        // which is the one outcome this locator exists to prevent.
        const start = skipWhitespaceAndContinuations(text, eq + 2);
        const end = valueEnd(text, start);
        if (end > start) {
          spans.push({ start, end });
          i = end;
          continue;
        }
      }
      i = Math.max(stmtEnd, i + 6);
      continue;
    }
    i++;
  }
  return spans;
}

/** A comparison operator that carries an expected VALUE the human would type,
 *  spelled at depth zero of an `assert` statement. `==` is the one this locator
 *  resolves; every other member of this set is a comparison it does NOT resolve,
 *  and each is therefore a MISS rather than a value-free assertion.
 *
 *  `assert x`, `assert x is None` and `assert isinstance(x, T)` are absent
 *  deliberately: there is no expected value to blank in them, so counting them
 *  would refuse a good pass. */
const PY_UNRESOLVED_COMPARISONS = ["!=", "<=", ">=", "<", ">"];

/**
 * How many `assert` statements the locator WALKED that compare against an
 * expected value it could not place.
 *
 * scraps D5's all-or-nothing floor, spelled for pytest. `assert x != y` is the
 * measured instance: no top-level `==`, so no span, so the OTHER asserts in the
 * module still produce holes and a holes-based floor passes while the model's
 * guessed `y` ships into the file.
 *
 * This does not teach the locator `!=`. Blanking `!=`'s right-hand side would be
 * a new SHAPE, and the shapes are endless; refusing the pass is the floor.
 */
export function pytestUnresolvedAssertions(text: string): number {
  let unresolved = 0;
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, PY_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (
      text.startsWith("assert", i) &&
      !isIdentChar(text[i + 6]) &&
      !isIdentChar(text[i - 1] ?? "") &&
      isStatementStart(text, i)
    ) {
      const stmtEnd = valueEnd(text, i + 6);
      if (assertEquals(text, i + 6, stmtEnd) === -1 && comparesWithoutEquals(text, i + 6, stmtEnd)) {
        unresolved++;
      }
      i = Math.max(stmtEnd, i + 6);
      continue;
    }
    i++;
  }
  return unresolved;
}

/** Does the statement compare at depth zero with an operator this locator does
 *  not resolve? `assert (a != b)` is included through the same one-redundant-
 *  paren rule the `==` locator uses, so a formatter-wrapped miss is still a miss. */
function comparesWithoutEquals(text: string, from: number, limit: number): boolean {
  if (hasTopLevelComparison(text, from, limit)) {
    return true;
  }
  const open = skipWhitespaceAndContinuations(text, from);
  if (text[open] !== "(") {
    return false;
  }
  const close = matchDelim(text, open);
  if (close === -1 || close >= limit) {
    return false;
  }
  const after = skipSpace(text, close + 1);
  if (after < limit && text[after] !== "," && text[after] !== "#") {
    return false;
  }
  return hasTopLevelComparison(text, open + 1, close);
}

function hasTopLevelComparison(text: string, from: number, limit: number): boolean {
  let depth = 0;
  let i = from;
  while (i < limit) {
    const skipped = skipLiteralOrComment(text, i, PY_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = text[i];
    if (OPENERS.includes(c)) {
      depth++;
    } else if (CLOSERS.includes(c)) {
      if (depth === 0) {
        return false;
      }
      depth--;
    } else if (depth === 0) {
      const op = PY_UNRESOLVED_COMPARISONS.find((o) => text.startsWith(o, i));
      // `<=`/`>=` are found before `<`/`>` by list order, and an `=` after the
      // operator would make it something else entirely.
      if (op !== undefined && text[i + op.length] !== "=") {
        return true;
      }
    }
    i++;
  }
  return false;
}

/** Past spaces, and past a backslash line continuation, so the span starts at
 *  the value rather than at the whitespace before it. */
function skipWhitespaceAndContinuations(text: string, i: number): number {
  for (;;) {
    const next = skipSpace(text, i);
    if (text[next] === "\\" && (text[next + 1] === "\n" || (text[next + 1] === "\r" && text[next + 2] === "\n"))) {
      i = next + (text[next + 1] === "\r" ? 3 : 2);
      continue;
    }
    return next;
  }
}

/**
 * The EXPECTED-VALUE spans in generated unittest text: the SECOND top-level
 * argument of each `assertEqual`, which is the Rust locator's shape with a
 * different callee name, PLUS the right-hand side of a bare `assert x == y`.
 *
 * `assertEqual` alone, per the contract's table. `assertTrue`, `assertIn` and
 * `assertNotEqual` carry no positional expected VALUE in the same sense, and the
 * fail-open shape above covers them: no span, nothing blanked, nothing wrong
 * blanked.
 *
 * The bare `assert` limb is not a second shape, it is the same Python statement
 * pytest's locator already walks. A unittest MODULE is Python: a model told to
 * write `self.assertEqual` may still write `assert add(2, 2) == 4` in one method,
 * and it is legal there. Without this limb that value is neither blanked nor
 * counted: the guessed number ships beside the other methods' holes, which is
 * scraps D5's fail-open exactly. The two limbs cannot overlap: `assertEqual` is
 * an attribute call and never matches the `assert` STATEMENT scan.
 */
export function unittestExpectedValueSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [...pytestExpectedValueSpans(text)];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, PY_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (text.startsWith("assertEqual", i) && !isIdentChar(text[i - 1] ?? "") && text[i - 1] === ".") {
      const open = skipSpace(text, i + "assertEqual".length);
      if (text[open] === "(") {
        const parsed = topLevelArgs(text, open, PY_LITERALS);
        if (parsed !== undefined && parsed.args.length >= 2) {
          spans.push(parsed.args[1]);
          i = parsed.close + 1;
          continue;
        }
      }
    }
    i++;
  }
  // The seam requires ascending, non-overlapping spans, and the two limbs are
  // gathered in different passes.
  return spans.sort((a, b) => a.start - b.start);
}

/** unittest's assert METHODS that compare against an expected value this locator
 *  does not resolve. `assertTrue`, `assertIsNone` and friends are absent: they
 *  carry no expected value to type, so they are not misses. */
const UNITTEST_UNRESOLVED_CALLS = ["assertNotEqual", "assertAlmostEqual", "assertNotAlmostEqual", "assertListEqual", "assertDictEqual", "assertSetEqual", "assertTupleEqual"];

/**
 * How many unittest assertion calls the locator walked that carry an expected
 * value it could not place: an `assertEqual` whose arguments it could not read,
 * and the equality-shaped siblings it deliberately does not blank.
 *
 * scraps D5's floor for unittest. Same reasoning as pytest's: refusing the pass
 * is the fix, teaching the locator each sibling call is the treadmill.
 *
 * The bare-`assert` misses come from pytest's own counter, because the locator's
 * bare-`assert` limb comes from pytest's own walker: `assert x != y` written in a
 * TestCase method is the same silence in either framework.
 */
export function unittestUnresolvedAssertions(text: string): number {
  const resolved = new Set(unittestExpectedValueSpans(text).map((s) => s.start));
  let unresolved = pytestUnresolvedAssertions(text);
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, PY_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const callee = text[i - 1] === "." ? [...UNITTEST_UNRESOLVED_CALLS, "assertEqual"].find((c) => text.startsWith(c, i) && !isIdentChar(text[i + c.length] ?? "")) : undefined;
    if (callee !== undefined) {
      const open = skipSpace(text, i + callee.length);
      if (text[open] === "(") {
        const parsed = topLevelArgs(text, open, PY_LITERALS);
        if (parsed === undefined || parsed.args.length < 2 || !resolved.has(parsed.args[1].start)) {
          unresolved++;
        }
        i = parsed === undefined ? i + callee.length : parsed.close + 1;
        continue;
      }
    }
    i++;
  }
  return unresolved;
}

// ===========================================================================
// The junit XML reader
// ===========================================================================

// The reader itself now lives in xmlReader.ts, moved there UNCHANGED in phase 5
// so C#'s TRX reads through the same scanner rather than a second one. What is
// left here is the junit-specific reading of what it returns.

/** A `<failure>` / `<error>` element as one message: the `message` attribute,
 *  then the body, whichever of the two exist. */
function reportedMessage(xml: string, tag: XmlTag): string {
  return [tag.attrs.message ?? "", elementText(xml, tag)].map((s) => s.trim()).filter((s) => s.length > 0).join("\n");
}

/**
 * WHICH PHASE an `<error>` element reports. The element carries three different
 * meanings and only its `message` attribute tells them apart; pytest spells the
 * phase into it, MEASURED against pytest 9.0.2:
 *
 *   message="collection failure"                        the module would not import
 *   message='failed on setup with "RuntimeError: …"'     a FIXTURE raised before the test
 *   message='failed on teardown with "RuntimeError: …"'  the test already PASSED, then cleanup raised
 *
 * Collapsing all three onto the environment tells a human whose own fixture is
 * broken that their environment could not start, and tells them nothing at all
 * about a test that passed. The setup and teardown cases are the human's OWN
 * code; only collection is the environment.
 */
function errorPhaseOf(message: string): "setup" | "teardown" | "collection" {
  if (/^failed on setup\b/i.test(message)) {
    return "setup";
  }
  if (/^failed on teardown\b/i.test(message)) {
    return "teardown";
  }
  return "collection";
}

// ===========================================================================
// The framework: pytest
// ===========================================================================

/**
 * Parse a pytest `--junit-xml` report.
 *
 * `report` IS THE XML DOCUMENT, read from the file `pytestJunitPath` names, NOT
 * the runner's stdout. That distinction is the whole security property, and it is
 * measured rather than assumed: a `print()` in the code under test lands at
 * column 0 in the captured-stdout section, so a forged `<testsuite tests="99">`
 * or a forged `1 failed, 99 passed` reaches stdout verbatim. It cannot reach the
 * FILE, because only pytest writes that. A parser that scanned stdout for the XML
 * would hand the forgery straight back.
 *
 * Which is why a document that does not BEGIN as a junit report is treated as no
 * report at all rather than searched for one: a caller who passes raw stdout gets
 * an honest did-not-run, never a run assembled out of whatever a test printed.
 *
 * `buildError` is never set. PYTHON HAS NO BUILD STEP: nothing compiles ahead of
 * the run, so a syntax error in the generated test file arrives as a COLLECTION
 * ERROR, exactly like an unresolvable import, and both are `environmentError`.
 * This gets rediscovered otherwise.
 */
export function parsePytestJunitXml(report: string, stderr: string, _exitCode: number): TestRunParse {
  const xml = (report ?? "").trim();
  const noReport = (why: string): TestRunParse => ({
    ran: false,
    cases: [],
    failures: [],
    passed: 0,
    failed: 0,
    ignored: 0,
    casesComplete: true,
    environmentError: (stderr ?? "").trim() || why,
  });
  if (!/^<(\?xml|testsuites?\b)/.test(xml)) {
    return noReport("pytest wrote no JUnit report, so the run did not start");
  }

  const tags = scanXmlTags(xml);
  // A report pytest did not finish writing is not a report. It writes the file
  // in one go at the end of the session, so a `<testsuite>` left unclosed means
  // the run was cut short, and its attributes would be counts for a session
  // that never ended. Trusting them is how a partial write becomes a green.
  const suites = tags.filter((t) => t.name === "testsuite");
  if (suites.length === 0 || suites.filter((t) => !t.selfClosing).length > tags.filter((t) => t.name === "/testsuite").length) {
    return noReport("pytest's JUnit report is truncated, so the run did not finish");
  }
  const cases: TestCaseResult[] = [];
  const failures: TestFailureDetail[] = [];
  const collectionErrors: string[] = [];
  let tests = 0;
  let failureCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  // `<error>` elements that were NOT collection failures: a fixture that raised
  // in setup is a red the human must fix in their own code, and one that raised
  // in teardown happened AFTER the assertion passed.
  let setupFailures = 0;
  let teardownErrors = 0;

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (tag.name === "testsuite") {
      // COUNTS COME FROM THE ATTRIBUTES. That is the point of the format: they
      // are written by pytest into a file, and no amount of printing from inside
      // a test can put a number here.
      tests += attrNumber(tag.attrs, "tests");
      failureCount += attrNumber(tag.attrs, "failures");
      errorCount += attrNumber(tag.attrs, "errors");
      skippedCount += attrNumber(tag.attrs, "skipped");
      continue;
    }
    if (tag.name !== "testcase") {
      continue;
    }
    const name = tag.attrs.name ?? "";
    // A childless <testcase> PASSED; the outcome elements are its children, and
    // they can only be the tags between this one and the next testcase.
    let outcome: TestOutcome | undefined = tag.selfClosing ? "pass" : undefined;
    let collectionFailed = false;
    for (let j = i + 1; j < tags.length && tags[j].name !== "testcase" && tags[j].name !== "/testsuite"; j++) {
      const child = tags[j];
      if (child.name === "failure") {
        outcome = "fail";
        failures.push({ name, message: reportedMessage(xml, child) });
      } else if (child.name === "skipped") {
        outcome = "ignored";
      } else if (child.name === "error") {
        const message = reportedMessage(xml, child);
        switch (errorPhaseOf(child.attrs.message ?? "")) {
          case "setup":
            // The human's own fixture raised before the test body ran. A real
            // red in code they wrote, reported as one.
            outcome = "fail";
            setupFailures++;
            failures.push({ name, message });
            break;
          case "teardown":
            // The assertion ALREADY PASSED; cleanup raised afterwards. Reporting
            // this as an environment failure hides a passing test, and dropping
            // the case while the counts still hold it invents a phantom pass.
            outcome = outcome ?? "pass";
            teardownErrors++;
            break;
          default:
            // NOT a test result: pytest reports a collection error as a
            // synthetic testcase whose name is the MODULE. Counting it as a
            // failing test tells the human their code is wrong when their
            // environment is.
            collectionFailed = true;
            collectionErrors.push(message);
            break;
        }
      } else if (child.name === "/testcase") {
        break;
      }
    }
    if (collectionFailed) {
      continue;
    }
    cases.push({ name, outcome: outcome ?? "pass" });
  }

  // The counts come from the ATTRIBUTES, which no printing test can reach. The
  // `errors` attribute covers all three phases at once, so a setup error is
  // already out of `passed` and only has to be added back as a FAILURE; a
  // teardown error leaves its test counted as the pass it was.
  const passed = Math.max(0, tests - failureCount - errorCount - skippedCount);
  const failed = failureCount + setupFailures;
  const parse: TestRunParse = {
    // `ran` means the runner produced TEST RESULTS (Amendment 6b). pytest reports
    // a COLLECTION ERROR as a `<testcase>` carrying an `<error>` child, so
    // "at least one testcase element" would answer true for a run in which
    // nothing ran, and the consumer would look for results that do not exist.
    ran: passed + failed + skippedCount > 0,
    cases,
    failures,
    passed,
    failed,
    ignored: skippedCount,
    // pytest enumerates PASSING tests as childless elements, unlike C#.
    casesComplete: true,
  };

  if (collectionErrors.length > 0 || errorCount > setupFailures + teardownErrors + collectionErrors.length) {
    // THE EXIT CODE CANNOT SEPARATE THIS FROM A FILTER MISS: both are exit 4.
    // The `errors` attribute can, and it is checked FIRST: third language with
    // this collision after Go and TypeScript, and getting it backwards tells a
    // human whose import does not resolve that their filter matched nothing.
    parse.environmentError = collectionErrors.join("\n\n") || "pytest could not collect the tests";
  } else if (cases.length === 0 && tests === 0) {
    parse.filterMatchedNothing = true;
  }
  return parse;
}

/**
 * Where pytest writes its JUnit report: a SYSTEM TEMP path, never inside the
 * human's repo, derived from the target file so the same rung always names the
 * same file and the parse can find what the command wrote.
 *
 * THE CALLER MUST DELETE THIS PATH BEFORE SPAWNING. pytest leaves the previous
 * report in place when it cannot start, and a stale report parsed as a live one
 * is a false green, the one failure mode this whole format exists to prevent.
 * Deleting it again after the parse is tidiness rather than correctness: the path
 * is per target file, so the reports do not accumulate without bound, but they do
 * outlive the run.
 */
export function pytestJunitPath(placement: TestPlacement): string {
  let hash = 0;
  for (const ch of placement.targetPath) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return path.join(os.tmpdir(), `column80-pytest-${hash.toString(36)}.xml`);
}

/** The interpreter a command must run, which is the project's venv when there is
 *  one. `python3` is the honest fallback: a project with no venv still has an
 *  interpreter, and PyOracle's resolution is the one both rungs share. */
function interpreterOf(placement: TestPlacement): string {
  return placement.interpreter ?? "python3";
}

/** A test file's pytest node-id prefix: its path relative to the run root, in
 *  forward slashes whatever the platform. */
function nodeIdPath(placement: TestPlacement): string {
  const rel = path.relative(placement.runRoot, placement.targetPath);
  return rel.split(path.sep).join("/");
}

const PYTEST: TestFramework = {
  id: "pytest",
  displayName: "pytest",

  // The project's interpreter is ASKED: `-c "import pytest"` through the probe
  // dep, which is the same question `python -m pytest` will answer at run time
  // and the only one that cannot be wrong. Pure over the injected deps, so a test
  // supplies a fake probe rather than a real interpreter.
  //
  // Offline evidence answers when the probe cannot: no venv beside the root, or
  // no probe. Installation is checked before configuration for the reason the
  // TypeScript leg measured: a declared-but-absent runner cannot spawn at all,
  // so a `[tool.pytest.ini_options]` section alone is intent, not a runner.
  detect(root, deps) {
    return importResolves(root, "pytest", deps) ?? (pytestInstalled(root, deps) || pytestConfigured(root, deps));
  },

  // `<interpreter> -B -m pytest <nodeid…> -q -p no:cacheprovider --junit-xml=<tmp>`
  // from the run root. Every flag is load-bearing and every one was measured:
  //
  //  - NODE IDS, never `-k`. A bad node id is `ERROR: not found` at exit 4 and an
  //    empty suite in the report; `-k` matching nothing is `deselected` at exit 5
  //    and is a filter language of its own. Node ids compose as positional
  //    arguments with no regex to escape, and they select EXACTLY the named test:
  //    `::test_ok` does not also select `test_ok_extra`, which is the superset
  //    trap the Go filter had to be anchored against.
  //  - `-B` AND `-p no:cacheprovider`, both. Measured: with only the pytest flag
  //    the run still leaves `__pycache__` directories in the human's repo. With
  //    both, it leaves nothing behind.
  //  - `--junit-xml` into the SYSTEM TEMP area. It writes a file, and this
  //    product does not write files into a repo unbidden.
  buildCommand(placement, testNames): TestRunCommand {
    const names = testNames.filter((n) => n.length > 0);
    if (names.length === 0) {
      // No node ids means pytest runs the WHOLE suite, which would blame this
      // function for every test in the project. The floor under the caller's
      // refusal, never a command that reports someone else's red.
      throw new Error("pytest needs at least one node id: an empty filter runs the whole suite");
    }
    const file = nodeIdPath(placement);
    const report = pytestJunitPath(placement);
    return {
      command: interpreterOf(placement),
      args: [
        "-B",
        "-m",
        "pytest",
        ...names.map((n) => `${file}::${n}`),
        "-q",
        "-p",
        "no:cacheprovider",
        `--junit-xml=${report}`,
      ],
      cwd: placement.runRoot,
      // The runner reads this file after the spawn and hands its CONTENT to
      // parseOutput as `stdout`. Declared here so the framework that writes the
      // report is the one that says where it lands.
      outputFile: report,
    };
  },

  parseOutput: parsePytestJunitXml,

  assertionInstruction:
    "Assert with a plain `assert <call> == <expected>`: the EXPECTED value is the RIGHT-hand side of the " +
    "`==`, and the call under test is the left. Write each expected value inline in its own assert, one " +
    "case per test function. Every test function must be named `test_` followed by the function under test.",

  expectedValueSpans: pytestExpectedValueSpans,
  classifiesBuildError: true,
  unresolvedAssertions: pytestUnresolvedAssertions,
};

// ===========================================================================
// The framework: unittest
// ===========================================================================

/** A verbose result line: `test_ok (tests.test_atlas.TestAtlas.test_ok) ... ok`.
 *  The trailing id spelling changed in 3.11 (it gained the method name) and the
 *  leading NAME did not, so the name is taken from the front. */
const UNITTEST_RESULT = /^(\w+) \(([\w.]+)\)(?: \([^)]*\))? \.\.\. (.+)$/;

/** unittest's own tell that a test MODULE failed to import: the loader
 *  substitutes a synthetic `_FailedTest` and reports it as an error. A positive
 *  structural marker, not a message match. */
const UNITTEST_FAILED_IMPORT = /unittest\.loader\._FailedTest/;

/**
 * unittest's own tally of the run, and the one part of its report a test CANNOT
 * forge: `Ran 2 tests in 0.001s` and `FAILED (failures=1, errors=0)` are written
 * AFTER every test has finished, so anything a test wrote lands EARLIER in the
 * stream. The LAST of each is therefore the runner's, whatever was printed
 * before it. undefined when the run produced no tally at all.
 *
 * This is what closes the forgery the verbose result lines are open to: a
 * function under test writing `\n<name> (<id>) ... ok\n` to stderr lands between
 * the prefix unittest writes before the test and the verdict it writes after, so
 * it reads as a whole extra result line and takes the real test's verdict with
 * it. The tally cannot be moved, so it CAPS what those lines may claim.
 */
function unittestTally(text: string): { total: number; failed: number; ignored: number } | undefined {
  const rans = [...text.matchAll(/^Ran (\d+) tests? in /gm)];
  const last = rans[rans.length - 1];
  if (last === undefined) {
    return undefined;
  }
  const verdicts = [...text.matchAll(/^(?:OK|FAILED)\b[^\n]*/gm)];
  const verdict = verdicts[verdicts.length - 1]?.[0] ?? "";
  const count = (re: RegExp) => {
    const m = re.exec(verdict);
    return m === null ? 0 : parseInt(m[1], 10);
  };
  // `expected failures=N` is its own tally and is NOT a failure, so the plain
  // `failures=` reader has to refuse the one that carries the prefix.
  const failed = count(/(?<!expected )failures=(\d+)/) + count(/errors=(\d+)/) + count(/unexpected successes=(\d+)/);
  const ignored = count(/skipped=(\d+)/) + count(/expected failures=(\d+)/);
  return { total: parseInt(last[1], 10), failed, ignored };
}

/**
 * Parse `python -m unittest -v` output.
 *
 * IT READS STDERR, AND THAT IS THE POINT. Measured: unittest writes its whole
 * report to stderr while `print()` from the code under test goes to stdout, so
 * the print-forgery that defeats a pytest TEXT parser cannot reach these lines at
 * all.
 *
 * Said plainly rather than oversold: this raises the bar, it does not close the
 * channel. A function under test that writes to `sys.stderr` directly can still
 * forge a result line, because unittest has no structured output format to fall
 * back on. That is exactly why pytest takes precedence over unittest whenever it
 * is present: its `--junit-xml` closes what this can only narrow.
 */
export function parseUnittestOutput(stdout: string, stderr: string, _exitCode: number): TestRunParse {
  const text = (stderr ?? "").replace(/\r/g, "");
  const cases: TestCaseResult[] = [];
  const failures: TestFailureDetail[] = [];
  const importErrors: string[] = [];
  let ranLine = false;
  let noTestsRan = false;

  for (const line of text.split("\n")) {
    if (/^Ran \d+ tests? in /.test(line)) {
      ranLine = true;
      continue;
    }
    if (line.trim() === "NO TESTS RAN") {
      noTestsRan = true;
      continue;
    }
    const m = UNITTEST_RESULT.exec(line.trim());
    if (m === null) {
      continue;
    }
    if (UNITTEST_FAILED_IMPORT.test(m[2])) {
      importErrors.push(m[2]);
      continue;
    }
    const verdict = m[3].trim();
    cases.push({
      name: m[1],
      outcome: verdict === "ok" ? "pass" : verdict.startsWith("skipped") ? "ignored" : "fail",
    });
  }

  // The detail blocks: `FAIL: <name> (<id>)`, a rule line, then the traceback,
  // fenced by the `====` separators unittest prints between them.
  for (const block of text.split(/^={10,}$/m).slice(1)) {
    const head = /^\s*(FAIL|ERROR):\s*(\w+)/.exec(block);
    if (head === null) {
      continue;
    }
    // The block is `FAIL: <name> (<id>)`, a rule line, then the traceback. The
    // head names this test and the rule is furniture, so the detail is what is
    // left, up to the rule line that closes the run.
    const body = block.replace(/^\s*\n/, "").replace(/^[^\n]*\n/, "").replace(/^-{10,}\n/, "").split(/\n-{10,}\n/)[0].trim();
    if (UNITTEST_FAILED_IMPORT.test(block)) {
      importErrors.push(body);
      continue;
    }
    failures.push({ name: head[2], message: body });
  }

  // A DETAIL BLOCK beats a verdict line. Measured: a function under test writing
  // `ok\n<forged line> ... ok\n` to stderr completes the real test's prefix with
  // its own `ok`, so the failing test reads as passing and a phantom test joins
  // the list. The traceback block still names the real one, and unittest writes
  // those blocks after every test has finished.
  const blockFailed = new Set(failures.map((f) => f.name));
  for (const c of cases) {
    if (blockFailed.has(c.name)) {
      c.outcome = "fail";
    }
  }

  // And the tally CAPS the list. The counts are still taken from `cases`, so this
  // never invents a result, but a run that says it ran one test cannot hold two
  // and the extra one is the forgery. A case with a traceback block claims its
  // place FIRST, so the evidence outranks the ordering.
  const tally = unittestTally(text);
  const keepIdx = new Set<number>();
  if (tally !== undefined) {
    const room: Record<TestOutcome, number> = {
      fail: tally.failed,
      ignored: tally.ignored,
      pass: Math.max(0, tally.total - tally.failed - tally.ignored),
    };
    const claim = (index: number) => {
      const outcome = cases[index].outcome;
      if (room[outcome] > 0) {
        room[outcome]--;
        keepIdx.add(index);
      }
    };
    for (const [index, c] of cases.entries()) {
      if (blockFailed.has(c.name)) {
        claim(index);
      }
    }
    for (let index = 0; index < cases.length; index++) {
      if (!keepIdx.has(index)) {
        claim(index);
      }
    }
  }
  const kept = tally === undefined ? cases : cases.filter((_, index) => keepIdx.has(index));
  const keptNames = new Set(kept.map((c) => c.name));

  const parse: TestRunParse = {
    // Amendment 6b's rule, spelled the same way as pytest's: the import-failure
    // placeholder unittest substitutes for a module is not a test result.
    ran: kept.length > 0,
    cases: kept,
    failures: failures.filter((f) => keptNames.has(f.name)),
    passed: kept.filter((c) => c.outcome === "pass").length,
    failed: kept.filter((c) => c.outcome === "fail").length,
    ignored: kept.filter((c) => c.outcome === "ignored").length,
    // `-v` names every test, passing ones included.
    casesComplete: true,
  };
  if (importErrors.length > 0) {
    // A module that would not import. Not a compile error (Python has no build
    // step) and not a test failure, whatever `FAILED (errors=1)` looks like.
    parse.environmentError = importErrors.join("\n\n");
  } else if (kept.length === 0 && (noTestsRan || ranLine)) {
    // `NO TESTS RAN` at exit 5, or a `Ran 0 tests` line. Distinct from a report
    // that never appeared, which leaves ran=false and both fields unset.
    parse.filterMatchedNothing = true;
  } else if (kept.length === 0 && !ranLine) {
    parse.environmentError = text.trim() || (stdout ?? "").trim() || "python -m unittest produced no report";
  }
  return parse;
}

/** unittest's `-k` is a SUBSTRING match unless the pattern holds a glob
 *  character, so a bare `test_ok` also selects `test_ok_extra`: measured, and
 *  the same superset trap the Go filter has. `*.test_ok` is matched with fnmatch
 *  against the full dotted test id, which anchors the end and selects exactly the
 *  named method. */
function unittestFilter(name: string): string {
  return `*.${name}`;
}

const UNITTEST: TestFramework = {
  id: "unittest",
  displayName: "python -m unittest",

  // Always. `unittest` ships with the interpreter, so a resolved project root IS
  // the framework: nothing to look for, nothing to install and nothing to be
  // honest-dark about. Python is like Go here and unlike TypeScript and C#,
  // which is why this leg's refusals are about placement and imports, never
  // about a missing framework.
  detect() {
    return true;
  },

  buildCommand(placement, testNames): TestRunCommand {
    const names = testNames.filter((n) => n.length > 0);
    if (names.length === 0) {
      throw new Error("python -m unittest needs at least one test name: an empty filter runs the whole module");
    }
    return {
      command: interpreterOf(placement),
      args: ["-B", "-m", "unittest", "-v", ...names.flatMap((n) => ["-k", unittestFilter(n)]), nodeIdPath(placement)],
      cwd: placement.runRoot,
    };
  },

  parseOutput: parseUnittestOutput,

  // The SHAPE, off the framework rather than off the languageId. Python's
  // languageId default asks for bare top-level `def test_...():` functions, which
  // is pytest's shape and is not collectable by `python -m unittest` at all.
  replyShape:
    "Reply with ONE fenced code block containing ONLY a single class deriving from `unittest.TestCase`, " +
    "holding the test methods and nothing else: no imports, no `if __name__` block, no prose, no code " +
    "before or after the block.",

  assertionInstruction:
    "Assert with `self.assertEqual(<call>, <expected>)`: the EXPECTED value is the SECOND argument. " +
    "Write each expected value inline as the second argument of its own assert. Every test is a method " +
    "named `test_` followed by the function under test.",

  expectedValueSpans: unittestExpectedValueSpans,
  classifiesBuildError: true,
  unresolvedAssertions: unittestUnresolvedAssertions,
};

// ===========================================================================
// The project root, and reading just enough TOML
// ===========================================================================

/** What names a Python PROJECT for the rung. Deliberately narrower than
 *  PyOracle's marker list, which the CHECK uses: pyright needs no manifest and
 *  accepts a bare workspace folder, but a test RUN needs a real project: the
 *  seam already says the rung's root and the check's root are not the same
 *  thing. */
const PY_ROOT_MARKERS = ["pyproject.toml", "setup.py", "setup.cfg", "tox.ini"];

function detectProjectRoot(filePath: string, exists: (p: string) => boolean): string | undefined {
  let dir = path.dirname(filePath);
  for (;;) {
    if (PY_ROOT_MARKERS.some((marker) => exists(path.join(dir, marker)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * The value of `key` inside TOML table `table`, as a list of strings. A targeted
 * reader, not a TOML parser: two keys are needed from pyproject.toml
 * (`testpaths` and `where`) and neither is worth a dependency this product does
 * not have. Comments are stripped, single and double quotes both read, and an
 * array may span lines.
 *
 * Anything it cannot read answers [], which lands on the same fallbacks a
 * project without the key gets.
 */
function tomlStringList(toml: string, table: string, key: string): string[] {
  const section = new RegExp(`^\\s*\\[${table.replace(/[.[\]]/g, "\\$&")}\\]\\s*$`, "m").exec(toml);
  if (section === null) {
    return [];
  }
  const from = section.index + section[0].length;
  const nextSection = /^\s*\[/m.exec(toml.slice(from));
  const body = toml.slice(from, nextSection === null ? toml.length : from + nextSection.index);
  const entry = new RegExp(`^\\s*${key}\\s*=\\s*`, "m").exec(body);
  if (entry === null) {
    return [];
  }
  const at = entry.index + entry[0].length;
  // An ARRAY runs to its `]` however many lines that takes, which real
  // pyproject.toml files do spell across lines; anything else is one line.
  const close = body[at] === "[" ? body.indexOf("]", at) : -1;
  const raw = (close === -1 ? (body.slice(at).split("\n")[0] ?? "") : body.slice(at, close)).replace(/#[^\n]*/g, "");
  return [...raw.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]).filter((s) => s.length > 0);
}

// ===========================================================================
// Framework detection, pure over the injected deps
// ===========================================================================

/** pytest present in the project's own environment: its console script beside
 *  the interpreter, or its package in the venv's site-packages. The offline
 *  filesystem answer to "does `-c \"import pytest\"` resolve", which detect
 *  cannot spawn to ask: detect is pure over deps by contract, and a subprocess
 *  per detection would be spawned on every gesture. */
function pytestInstalled(root: string, deps: TddDeps): boolean {
  const exists = fileExistsOf(deps);
  const readDir = readDirOf(deps);
  for (const venv of [".venv", "venv"]) {
    if (exists(path.join(root, venv, "bin", "pytest")) || exists(path.join(root, venv, "Scripts", "pytest.exe"))) {
      return true;
    }
    if (exists(path.join(root, venv, "Lib", "site-packages", "pytest"))) {
      return true;
    }
    const lib = path.join(root, venv, "lib");
    for (const sub of readDir(lib) ?? []) {
      if (sub.startsWith("python") && exists(path.join(lib, sub, "site-packages", "pytest"))) {
        return true;
      }
    }
  }
  return false;
}

/** pytest CONFIGURED by the project, which is a project saying it tests with
 *  pytest whether or not a venv sits beside the checkout. */
function pytestConfigured(root: string, deps: TddDeps): boolean {
  const exists = fileExistsOf(deps);
  const readFile = readFileOf(deps);
  if (exists(path.join(root, "pytest.ini"))) {
    return true;
  }
  if (/\[tool\.pytest\.ini_options\]/.test(readFile(path.join(root, "pyproject.toml")) ?? "")) {
    return true;
  }
  if (/^\s*\[tool:pytest\]/m.test(readFile(path.join(root, "setup.cfg")) ?? "")) {
    return true;
  }
  return /^\s*\[pytest\]/m.test(readFile(path.join(root, "tox.ini")) ?? "");
}

// ===========================================================================
// The import, and PROVING it before a file is written
// ===========================================================================

/**
 * Ask the project's own interpreter whether one import STATEMENT resolves,
 * offline: true, or undefined when the question could not be ASKED (no venv
 * beside the root, or a probe that could not spawn). undefined is not false, and
 * the callers treat it as unproven rather than as a refusal.
 *
 * `sysPath` is prepended to `sys.path` exactly as pytest's own
 * `[tool.pytest.ini_options] pythonpath` is, because the question this answers is
 * "will pytest be able to import this", not "will a bare interpreter".
 *
 * `-B` is not decoration: without it the interpreter leaves `__pycache__`
 * directories in the human's repo just for answering, which is measured.
 *
 * **THIS RUNS THE TARGET'S MODULE-LEVEL CODE**, including every `__init__.py` on
 * the way in, which is the same code pytest's own collection would run. A package
 * whose `__init__.py` writes a file has that file written HERE, while the product
 * is still deciding where a test would go and before the human has agreed to
 * anything. It is an accepted trade, not an oversight: the alternative is a static
 * guess, and a wrong guess reaches the human as a collection error they cannot act
 * on. The blast radius is bounded by the probe timeout in `REAL_TDD_DEPS`, not by
 * anything about the code being imported.
 */
function importStatementResolves(root: string, statement: string, sysPath: string[], deps: TddDeps): boolean | undefined {
  const interpreter = resolvePythonInterpreter(root, fileExistsOf(deps));
  if (interpreter === undefined) {
    return undefined;
  }
  // No shell is involved (the probe spawns argv directly), and the paths are
  // JSON-quoted, which Python reads with the same escapes.
  const prefix = sysPath.length === 0 ? "" : `import sys; sys.path[0:0]=[${sysPath.map((p) => JSON.stringify(p)).join(", ")}]; `;
  const result = probeOf(deps)(interpreter, ["-B", "-c", `${prefix}${statement}`], root);
  return result === undefined ? undefined : result.exitCode === 0;
}

/** Whether a bare `import <module>` resolves. The question pytest DETECTION asks,
 *  and it is a genuinely different one from the import proof below: a framework
 *  is a module and nothing is imported FROM it. */
function importResolves(root: string, module: string, deps: TddDeps): boolean | undefined {
  if (!/^[A-Za-z_][\w.]*$/.test(module)) {
    return undefined;
  }
  return importStatementResolves(root, `import ${module}`, [], deps);
}

/** `[tool.pytest.ini_options] pythonpath`, made absolute. pytest puts these on
 *  `sys.path` before collection, so a src-layout project that sets it needs no
 *  install and its imports resolve perfectly at run time. A probe that does not
 *  honour it refuses a project whose tests pass. */
function pytestPythonPath(root: string, deps: TddDeps): string[] {
  const toml = readFileOf(deps)(path.join(root, "pyproject.toml")) ?? "";
  return tomlStringList(toml, "tool.pytest.ini_options", "pythonpath").map((entry) => path.resolve(root, entry));
}

/**
 * The module the generated test must import the unit FROM, or undefined when the
 * path does not spell one.
 *
 * Derived from the source file's position under the package base, which is
 * `[tool.setuptools.packages.find] where` when pyproject.toml sets it: the
 * corpus sets `where = ["src"]`, so `src/mcp_graph_engine/cypher.py` is
 * `mcp_graph_engine.cypher` and NOT `src.mcp_graph_engine.cypher`.
 *
 * `src/` is honoured as a base even without that key, because src-layout is a
 * convention older than any one build backend and a project using hatchling or
 * poetry spells it somewhere this reader does not look. The guess is safe
 * precisely because it is PROVEN before anything is written.
 */
function moduleNameFor(filePath: string, root: string, deps: TddDeps): string | undefined {
  const toml = readFileOf(deps)(path.join(root, "pyproject.toml")) ?? "";
  const where = tomlStringList(toml, "tool.setuptools.packages.find", "where");
  // CONTAINMENT is the whole test: a base the file does not sit under cannot
  // spell its module, and one it does sit under exists by construction. The
  // declared `where` first, then the src-layout convention, then the root.
  const bases = [...where, "src", "."].map((w) => path.resolve(root, w));
  const base =
    bases.find((b) => {
      const rel = path.relative(b, filePath);
      return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
    }) ?? root;

  const rel = path.relative(base, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return undefined;
  }
  const parts = rel.replace(/\.pyi?$/, "").split(path.sep);
  // A package's `__init__.py` IS the package: `pkg/__init__.py` imports as `pkg`.
  if (parts[parts.length - 1] === "__init__") {
    parts.pop();
  }
  if (parts.length === 0 || !parts.every((p) => /^[A-Za-z_]\w*$/.test(p))) {
    return undefined;
  }
  return parts.join(".");
}

// ===========================================================================
// The scaffold
// ===========================================================================

const PY_MARKER_PREFIX = "#";

/** Every top-level `import x` / `from x import y` statement, with the names a
 *  `from` form binds. Read through the literal-aware scanner so an import
 *  spelled inside a docstring is never one: a module docstring showing usage is
 *  ordinary Python, and a regex reads it as an import that is already there. */
function importStatements(text: string): Array<{ end: number; module?: string; names: string[] }> {
  const out: Array<{ end: number; module?: string; names: string[] }> = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, PY_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const atLineStart = i === 0 || text[i - 1] === "\n";
    if (atLineStart && (text.startsWith("import ", i) || text.startsWith("from ", i))) {
      // The statement runs to the end of the line, or past a parenthesized name
      // list: `from x import (\n  a,\n  b,\n)` is one statement over four lines.
      let j = i;
      let end = text.length;
      while (j < text.length) {
        if (text[j] === "(") {
          const close = matchDelim(text, j);
          j = close === -1 ? text.length : close + 1;
          continue;
        }
        if (text[j] === "\n" && text[j - 1] !== "\\") {
          end = j;
          break;
        }
        j++;
      }
      const stmt = text.slice(i, end);
      const fromM = /^from\s+([.\w]+)\s+import\s+([\s\S]+)$/.exec(stmt);
      if (fromM !== null) {
        out.push({
          end,
          module: fromM[1],
          names: [...fromM[2].matchAll(/[A-Za-z_]\w*/g)].map((m) => m[0]).filter((n) => n !== "as"),
        });
      } else {
        const importM = /^import\s+([\s\S]+)$/.exec(stmt);
        out.push({ end, names: importM === null ? [] : splitTopLevelPy(importM[1]) });
      }
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

/** Is `line` (a whole `import`/`from` statement) already in `text`? Answered
 *  by what it BINDS, not by string equality: a `from mod import other` beside it
 *  is a different statement and both are legal, but the same name from the same
 *  module twice is a duplicate. */
function importAlreadyPresent(text: string, line: string): boolean {
  const wanted = /^from\s+([.\w]+)\s+import\s+([\s\S]+)$/.exec(line.trim());
  const statements = importStatements(text);
  if (wanted === null) {
    const bare = /^import\s+([.\w]+)/.exec(line.trim());
    return bare !== null && statements.some((s) => s.module === undefined && s.names.includes(bare[1]));
  }
  const names = [...wanted[2].matchAll(/[A-Za-z_]\w*/g)].map((m) => m[0]);
  return statements.some((s) => s.module === wanted[1] && names.every((n) => s.names.includes(n)));
}

/** `text` with `line` inserted after the last top-level import, or at the top
 *  (past a module docstring) when there are none. */
function withImport(text: string, line: string): string {
  const statements = importStatements(text);
  const last = statements[statements.length - 1];
  if (last !== undefined) {
    return `${text.slice(0, last.end)}\n${line}${text.slice(last.end)}`;
  }
  // Past a module docstring, which must stay the FIRST statement in the file or
  // it stops being the docstring and becomes a stray expression.
  const start = /^\s*/.exec(text)![0].length;
  const afterDocstring = skipLiteralOrComment(text, start, PY_LITERALS);
  return afterDocstring > start
    ? `${text.slice(0, afterDocstring)}\n\n${line}${text.slice(afterDocstring)}`
    : `${line}\n\n${text}`;
}

function pyScaffold(input: ScaffoldInput): TestInsertionPlan {
  const { begin, end } = testMarkers(input.markerId, PY_MARKER_PREFIX);
  // Top-level `def test_…` sits at column 0 whatever the model emitted. Python is
  // the one language where this is not cosmetic: an indented def is a syntax
  // error or a nested function the runner never sees.
  const region = `${begin}\n${reindent(input.generatedTests, "")}\n${end}`;
  const text = input.existingText;

  // 1. replace-generated: a prior marked region for this markerId: swap exactly
  //    it, so regenerating is idempotent and the developer's own tests in the
  //    same file are never touched.
  const bi = text.indexOf(begin);
  if (bi !== -1) {
    const ei = text.indexOf(end, bi);
    if (ei !== -1) {
      return { start: bi, end: ei + end.length, mode: "replace-generated", text: region };
    }
  }

  const wanted = [input.placement.frameworkImportLine, input.placement.importLine].filter(
    (l): l is string => l !== undefined && l.length > 0,
  );

  // 2. the whole file, when there is no file yet.
  if (text.trim().length === 0) {
    const head = wanted.length === 0 ? "" : `${wanted.join("\n")}\n\n`;
    return { start: 0, end: text.length, mode: "new-module", text: `${head}${region}\n` };
  }

  // 3. extend-existing: append the marked region at end of file.
  const tail = `${text.endsWith("\n") ? "" : "\n"}\n${region}\n`;
  const missing = wanted.filter((line) => !importAlreadyPresent(text, line));
  if (missing.length === 0) {
    return { start: text.length, end: text.length, mode: "extend-existing", text: tail };
  }
  // An import belongs near the TOP while the tests go at the BOTTOM, and a
  // TestInsertionPlan is ONE contiguous replacement, so the span is the whole
  // file. Both legs before this one hit the same wall. What this leg owes phase 6
  // is DETECTABILITY without a new mode string: a whole-file plan is exactly
  // `start === 0 && end === existingText.length` over a NON-EMPTY file, which the
  // append branch above can never produce.
  const withImports = missing.reduce((acc, line) => withImport(acc, line), text);
  return { start: 0, end: text.length, mode: "extend-existing", text: `${withImports}${tail}` };
}

/** The names of the `def test_…` functions previously generated for markerId.
 *
 *  Walked with the shared literal-aware scanner rather than a regex, for the
 *  reason phase 3 learned the hard way: its regex found a phantom test name
 *  inside `submit('save')`. A docstring showing `def test_x()` as example usage
 *  does exactly the same thing here, the node-id filter then names a test pytest
 *  never registered, and the run comes back as a filter miss the human did not
 *  cause. */
function pyGeneratedTestNames(fileText: string, markerId: string): string[] {
  const { begin, end } = testMarkers(markerId, PY_MARKER_PREFIX);
  const bi = fileText.indexOf(begin);
  if (bi === -1) {
    return [];
  }
  const ei = fileText.indexOf(end, bi);
  if (ei === -1) {
    return [];
  }
  const region = fileText.slice(bi + begin.length, ei);
  const names: string[] = [];
  let i = 0;
  while (i < region.length) {
    const skipped = skipLiteralOrComment(region, i, PY_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (region.startsWith("def", i) && !isIdentChar(region[i - 1] ?? "") && !isIdentChar(region[i + 3])) {
      // `test…`, not `test_…`: pytest collects every function whose name starts
      // with `test`, so a stricter rule would drop a name the runner really runs.
      const nameM = /^\s*(test\w*)\s*\(/.exec(region.slice(i + 3));
      if (nameM !== null) {
        names.push(nameM[1]);
        i += 3 + nameM[0].length;
        continue;
      }
    }
    i++;
  }
  return names;
}

// ===========================================================================
// Placement
// ===========================================================================

/** The directory the test file goes in, first match wins: the project's own
 *  `testpaths`, then a `tests/` directory, then beside the module. Python is the
 *  only leg whose target directory is configurable, and the corpus configures
 *  it. */
function testDirFor(root: string, sourceDir: string, deps: TddDeps): string {
  const exists = fileExistsOf(deps);
  const readFile = readFileOf(deps);
  const testpaths = tomlStringList(readFile(path.join(root, "pyproject.toml")) ?? "", "tool.pytest.ini_options", "testpaths");
  if (testpaths.length > 0) {
    return path.resolve(root, testpaths[0]);
  }
  return exists(path.join(root, "tests")) ? path.join(root, "tests") : sourceDir;
}

function pyPlacementFor(filePath: string, symbolName: string, deps: TddDeps): PlacementResult {
  const exists = fileExistsOf(deps);
  const root = detectProjectRoot(filePath, exists);
  if (root === undefined) {
    return {
      ok: false,
      refusal: {
        reason: "no-project-root",
        detail:
          `no pyproject.toml, setup.py, setup.cfg or tox.ini in ${path.dirname(filePath)} or any parent ` +
          "directory, so there is no project to run the tests in",
      },
    };
  }

  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const stem = base.replace(/\.pyi?$/, "");
  const interpreter = resolvePythonInterpreter(root, exists);
  const frameworkImportLine = PYTEST.detect(root, { ...deps, log: undefined }) ? undefined : "import unittest";

  // A source file that IS a test file has no `test_test_foo.py` sibling to make:
  // the target IS the source, the mode has to SAY so, and there is nothing to
  // import because a helper in a test file is already in scope.
  if (/^test_/.test(stem) || /_test$/.test(stem)) {
    return {
      ok: true,
      placement: {
        targetPath: filePath,
        exists: exists(filePath),
        mode: "same-file",
        runRoot: root,
        ...(interpreter === undefined ? {} : { interpreter }),
        ...(frameworkImportLine === undefined ? {} : { frameworkImportLine }),
      },
    };
  }

  if (!/^[A-Za-z_]\w*$/.test(symbolName)) {
    return {
      ok: false,
      refusal: {
        reason: "unresolvable-import",
        detail: `\`${symbolName}\` is not a plain identifier, so the test file has no name to import it by`,
      },
    };
  }

  const moduleName = moduleNameFor(filePath, root, deps);
  if (moduleName === undefined) {
    return {
      ok: false,
      refusal: {
        reason: "unresolvable-import",
        detail: `${filePath} does not sit at an importable module path under ${root}, so the test file has no module to import \`${symbolName}\` from`,
      },
    };
  }

  // PROVE THE IMPORT BEFORE ANY FILE IS WRITTEN. A src-layout project whose
  // package is not installed reports a guessed import as a COLLECTION ERROR,
  // which reaches the human as "the tests did not run" with a traceback through
  // pytest's own internals: a red they cannot act on. The probe is one offline
  // process and costs milliseconds.
  //
  // THE LINE PROBED IS THE LINE THE SCAFFOLD WILL WRITE, symbol and all. Proving
  // the MODULE is a weaker question that the corpus itself defeats: `import
  // ...visualization.web_server` exits 0 while `from ...web_server import
  // _is_port_available` exits 1, because that name is a @staticmethod on a class
  // and not a module attribute. The proof passed, the file was written, and the
  // run died at collection — on one of the seven functions this leg exists for.
  //
  // Reading this probe: it EXECUTES the target package, see importStatementResolves.
  const importLine = `from ${moduleName} import ${symbolName}`;
  const resolved = importStatementResolves(root, importLine, pytestPythonPath(root, deps), deps);
  // Only a DEFINITE failure refuses, and one definite failure is downgraded. A
  // root `conftest.py` runs at COLLECTION time and can put anything on
  // `sys.path` (`sys.path.insert(0, 'src')` is the ordinary spelling), and a bare
  // `python -c` cannot see what it will do. So its `false` is not trustworthy:
  // log it and proceed, the same escape hatch an unanswerable probe already gets.
  // The alternative is refusing a project whose tests pass and telling the human
  // to install a project deliberately configured to need no install.
  const conftest = exists(path.join(root, "conftest.py"));
  if (resolved === false && !conftest) {
    return {
      ok: false,
      refusal: {
        reason: "unresolvable-import",
        detail:
          `\`${importLine}\` does not resolve in ${interpreter}, so a generated test importing ` +
          `\`${symbolName}\` from \`${moduleName}\` would fail to collect. Install the project into that ` +
          "environment (for example an editable install), or select an interpreter that has it.",
      },
    };
  }
  if (resolved !== true) {
    deps.log?.(
      `[tdd] python: \`${importLine}\` is UNPROVEN (${
        resolved === false
          ? `it did not resolve in ${interpreter}, but ${path.join(root, "conftest.py")} may put it on sys.path at collection time`
          : interpreter === undefined
            ? `no venv interpreter beside ${root}`
            : "the probe did not run"
      }); scaffolding it anyway`,
    );
  }

  const targetPath = path.join(testDirFor(root, dir, deps), `test_${stem}.py`);
  // No packageArg: pytest's filter is node ids, which are paths relative to the
  // run root, and the file path is already carried by targetPath.
  return {
    ok: true,
    placement: {
      targetPath,
      exists: exists(targetPath),
      mode: "project-file",
      runRoot: root,
      importLine,
      ...(interpreter === undefined ? {} : { interpreter }),
      ...(frameworkImportLine === undefined ? {} : { frameworkImportLine }),
    },
  };
}

// ===========================================================================
// The language
// ===========================================================================

const PY_TDD_LANG: TddLang = {
  languageId: "python",
  displayName: "Python",

  placementFor: pyPlacementFor,

  scaffold: pyScaffold,

  // The one leg that is not `//`. testMarkers already takes the prefix, so the
  // marker format has one source across all five languages.
  markerPrefix: PY_MARKER_PREFIX,

  generatedTestNames: pyGeneratedTestNames,

  // No testNameIsValid. pytest collects any function whose name starts with
  // `test`, and unittest collects any method of a TestCase that does: neither
  // silently ignores a badly named function the way `go test` does.

  classifyTestability: classifyPyTestability,

  returnTypeOf: pyReturnTypeOf,

  renderBlankValue: pyRenderBlankValue,

  // pytest first: it is the project's declared runner when it is there at all,
  // and its `--junit-xml` is the only Python format a printing test cannot forge.
  frameworks: [PYTEST, UNITTEST],
};

export { PY_TDD_LANG, PYTEST, UNITTEST, PY_LITERALS };
