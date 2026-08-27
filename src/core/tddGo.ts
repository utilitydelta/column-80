/**
 * The Go leg of the TDD language seam.
 *
 * Go is the near miss on Rust's same-file design: the tests live in a SIBLING
 * `foo_test.go` that declares the SAME package as the code under test, so it
 * reaches unexported names exactly the way `use super::*` reaches private ones.
 * That is why `not-exported` can never fire here and why an unexported function
 * is a first-class target — counted across cobra and gin, 56 of 57 `*_test.go`
 * files declare the same package as the code beside them.
 *
 * The rung is stdlib `testing`, the only guaranteed framework of the five: no
 * detection, no install, nothing to look for.
 *
 * Never imports vscode (the src/core rule).
 * Contract: docs/architecture/tdd-language-seam.md.
 */

import * as path from "path";
import { GO_SPAWN_ENV, GoOracle } from "./goOracle";
import type { TestCaseResult, TestFailureDetail, TestOutcome } from "./compilerOracle";
import type { FailureLocation } from "./failureDigest";
import {
  LiteralProfile,
  TestInsertionPlan,
  matchDelim as matchDelimIn,
  reindent,
  skipLiteralOrComment,
  testMarkers,
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
  readFileOf,
} from "./tddLang";

// ===========================================================================
// The Go literal profile, and the one depth scanner every Go rule shares
// ===========================================================================

/** Go's wrinkles against the shared scanner's Rust defaults: a backtick raw
 *  string in which a backslash is an ordinary character, and block comments
 *  that do NOT nest. */
const GO_LITERALS: LiteralProfile = { rawStringDelimiter: "`", nestedBlockComments: false };

const OPENERS = "([{";
const CLOSERS = ")]}";

function isIdentChar(c: string): boolean {
  return /\w/.test(c ?? "");
}

function skipSpace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) {
    i++;
  }
  return i;
}

/**
 * The delimiter matching the one at `open`, over Go's literal profile. The
 * depth-counting body moved to testAssembly.ts in phase 3, where TypeScript
 * needs the same scanner; this is the Go-profile binding of it and every call
 * site below reads exactly as before.
 */
function matchDelim(text: string, open: number): number {
  return matchDelimIn(text, open, GO_LITERALS);
}

/** Split on TOP-LEVEL commas, respecting `()[]{}` nesting, so `(map[string]int,
 *  error)` is two results rather than three. */
function splitTopLevelGo(s: string): string[] {
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

// ===========================================================================
// returnTypeOf
// ===========================================================================

/** The `{` that opens the BODY: the first one at bracket depth zero that is not
 *  the opener of a `struct{…}` / `interface{…}` type literal, which is part of
 *  the return TYPE. -1 when the signature carries no body brace. */
function bodyBraceIndex(text: string): number {
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, GO_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const c = text[i];
    if (c === "(" || c === "[") {
      const close = matchDelim(text, i);
      if (close === -1) {
        return -1;
      }
      i = close + 1;
      continue;
    }
    if (c === "{") {
      if (/\b(struct|interface)\s*$/.test(text.slice(0, i))) {
        const close = matchDelim(text, i);
        if (close === -1) {
          return -1;
        }
        i = close + 1;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * The return type text of a Go func signature, or undefined when it returns
 * nothing. Go puts the return AFTER the parameter list's closing paren and
 * BEFORE the body brace, so the whole job is finding that paren by depth:
 *
 *   func f(a int) int              -> "int"
 *   func f(a int) (int, error)     -> "(int, error)"
 *   func (s *Shard) M(a int) string-> "string"
 *   func f(a func(int) int) string -> "string"
 *   func f(a int) {                -> undefined
 *
 * A parenthesized result list comes back VERBATIM, named results included; the
 * blank-value renderer treats them by position.
 */
export function goReturnTypeOf(signature: string): string | undefined {
  const sig = signature ?? "";
  const funcM = /\bfunc\b/.exec(sig);
  if (funcM === null) {
    return undefined;
  }
  let i = skipSpace(sig, funcM.index + 4);
  // The receiver, when there is one: `func (s *Shard) M(…)`.
  if (sig[i] === "(") {
    const close = matchDelim(sig, i);
    if (close === -1) {
      return undefined;
    }
    i = skipSpace(sig, close + 1);
  }
  const nameM = /^[A-Za-z_]\w*/.exec(sig.slice(i));
  if (nameM !== null) {
    i = skipSpace(sig, i + nameM[0].length);
  }
  // Type parameters: `func Map[T any](s []T) []T`.
  if (sig[i] === "[") {
    const close = matchDelim(sig, i);
    if (close === -1) {
      return undefined;
    }
    i = skipSpace(sig, close + 1);
  }
  if (sig[i] !== "(") {
    return undefined;
  }
  const paramClose = matchDelim(sig, i);
  if (paramClose === -1) {
    return undefined;
  }
  const rest = sig.slice(paramClose + 1);
  const body = bodyBraceIndex(rest);
  const ret = (body === -1 ? rest : rest.slice(0, body)).trim();
  return ret.length === 0 ? undefined : ret;
}

/** How many values a Go signature returns: the top-level element count of a
 *  parenthesized result list, 1 for a bare type, 0 for nothing. */
function returnArity(returnType: string | undefined): number {
  if (returnType === undefined) {
    return 0;
  }
  if (returnType.startsWith("(") && returnType.endsWith(")")) {
    return splitTopLevelGo(returnType.slice(1, -1)).length;
  }
  return 1;
}

// ===========================================================================
// Testability
// ===========================================================================

// Go has no `async` keyword. Its equivalents in a SIGNATURE are a channel type
// and a context parameter. A goroutine in the BODY is invisible to a
// signature-only classifier and is an accepted residual, named here so it is not
// rediscovered as a bug.
const GO_ASYNC = /\bchan\b|\bcontext\.Context\b/;

// The IO/network marker set: a qualified type from `os`, `net`, `io`, `bufio` or
// `http`. `http.` is in the set because of a measurement, not a hunch: net/http
// imports AS `http`, and ten of Go's 104 surviving functions across cobra and gin
// carry an `http.ResponseWriter` or `*http.Request` and are integration territory
// dressed as survivors. The `\b` keeps `bio.Reader` off `io.` and `myos.X` off
// `os.`.
const GO_IO = /\b(os|net|io|bufio|http)\./;

// A method receiver: the paren group that sits between `func` and the name.
// Constructing a meaningful receiver is the fixture problem this gesture does not
// attempt, and it is Go's largest refusal at 60.6% of cobra and gin.
const GO_RECEIVER = /^\s*func\s*\(/;

/**
 * Classify a Go function as a blind-unit-test target or an honest failure.
 * First-match-wins over the same FIXED precedence as Rust so the reported reason
 * is stable: async → io → needs-fixture → underspecified → testable. Pure; never
 * throws.
 *
 * `not-exported` is unreachable BY DESIGN. The generated `foo_test.go` declares
 * the same package as the code under test, so an unexported function is visible
 * to it and is a first-class target — `rpad`, `safeUint16` and
 * `getMapFromFormData` are all real survivors from the corpus.
 */
export function classifyGoTestability(signature: string, docComment?: string): TestabilityVerdict {
  const sig = signature ?? "";

  if (GO_ASYNC.test(sig)) {
    return {
      testable: false,
      reason: "async",
      detail: "a channel or context.Context in the signature — a blind unit test cannot drive it",
    };
  }
  if (GO_IO.test(sig)) {
    return {
      testable: false,
      reason: "io",
      detail: "IO/network in the signature (os, net, io, bufio, http) — integration territory, not a blind unit test",
    };
  }
  if (GO_RECEIVER.test(sig)) {
    return {
      testable: false,
      reason: "needs-fixture",
      detail: "method with a receiver — needs a constructed fixture",
    };
  }
  // Go's own convention is that a doc comment opens with the function name. It is
  // NOT required here: a comment that does not is still a contract.
  if (docComment === undefined || docComment.trim() === "") {
    return { testable: false, reason: "underspecified", detail: "no doc comment — no contract to author a blind test from" };
  }
  const returnType = goReturnTypeOf(sig);
  const arity = returnArity(returnType);
  if (arity === 0) {
    return { testable: false, reason: "underspecified", detail: "no return value to assert — side-effect only" };
  }
  // `(T, error)` stays testable: blank the T, assert the error separately. Three
  // or more results is where a single `want` stops expressing the contract; the
  // rule cost exactly one function across cobra and gin, so it is cheap.
  if (arity >= 3) {
    return {
      testable: false,
      reason: "underspecified",
      detail: `${arity} return values — too many for one blind expected value`,
    };
  }
  return { testable: true };
}

// ===========================================================================
// Blank values
// ===========================================================================

const GO_SCALAR = /^(u?int(8|16|32|64)?|uintptr|float32|float64|complex64|complex128|string|bool|byte|rune)$/;

// A result element that OPENS with one of these keywords is a type, never a
// `name type` pair — `func(int) int` must not be read as a result named `func`.
const GO_TYPE_KEYWORD = /^(chan|func|map|struct|interface)\b/;

// Past this many elements a fixed array stops being a gesture: `[65536]byte`
// scaffolds 65,536 tabstops and `[1000000]byte` a 10.9 MB snippet, and a snippet
// the human cannot Tab through is not a blank-value gesture. Above the cap the
// array renders like a slice: one hinted hole.
const GO_ARRAY_HOLE_CAP = 8;

/** The TYPE half of a `name type` result element (`n int` -> `int`), or
 *  undefined when the element is a bare TYPE (`error`, `[]byte`) or a bare NAME
 *  awaiting one. A keyword-led type is bare however many spaces it holds:
 *  `func(int) int` is not a result named `func`. */
function namedResultType(elem: string): string | undefined {
  const e = elem.trim();
  if (GO_TYPE_KEYWORD.test(e)) {
    return undefined;
  }
  const named = /^[A-Za-z_]\w*\s+([\s\S]+)$/.exec(e);
  return named === null ? undefined : named[1].trim();
}

/**
 * The TYPE of each element of a result list, resolved the way Go's own parser
 * reads one: a RUN of names shares the type of the first typed element after it,
 * so `(a, b int)` is two ints and NOT a result named `a` of type `a`. Corpus:
 * `(scaleX, scaleY float64)`, `(truth, ok bool)`, `(location, context string)`,
 * seven such lists across cobra, gin and hugo.
 *
 * An UNNAMED list is the same shape with no typed element ever arriving
 * (`(int, error)`), so a run left pending at the end is types all along.
 */
function resultTypes(elems: string[]): string[] {
  const out: string[] = elems.map((e) => e.trim());
  let pending: number[] = [];
  for (let i = 0; i < elems.length; i++) {
    const ty = namedResultType(elems[i]);
    if (ty === undefined) {
      pending.push(i);
      continue;
    }
    out[i] = ty;
    for (const j of pending) {
      out[j] = ty;
    }
    pending = [];
  }
  return out;
}

function renderGoType(ty: string, start: number): BlankValueResult {
  const hole = (i: number) => `\${${start + i}}`;
  const hint = (t: string) => `\${${start}:/* ${escapeSnippet(t)} */}`;

  // A result LIST, by position. `(T, error)` renders the T by these rules and
  // then the error as its own hole: the error variant IS the answer, the same
  // Option/Result precedent Rust set.
  if (ty.startsWith("(") && ty.endsWith(")")) {
    const elems = splitTopLevelGo(ty.slice(1, -1));
    if (elems.length > 0) {
      const parts: string[] = [];
      let next = start;
      for (const elemType of resultTypes(elems)) {
        const rendered = renderGoType(elemType, next);
        parts.push(rendered.rhs);
        next += rendered.holes;
      }
      return { rhs: parts.join(", "), holes: next - start };
    }
  }

  // A scalar is one bare hole: nothing about it is type-determined.
  if (GO_SCALAR.test(ty)) {
    return { rhs: hole(0), holes: 1 };
  }

  // `[N]T` with a LITERAL N: the length IS type-determined, so scaffold N holes —
  // up to the cap, past which the human could not Tab through them and the array
  // renders like a slice.
  const fixedArray = /^\[\s*(\d+)\s*\](.+)$/.exec(ty);
  if (fixedArray !== null) {
    const n = parseInt(fixedArray[1], 10);
    if (n > GO_ARRAY_HOLE_CAP) {
      return { rhs: `${ty}{${hint(fixedArray[2].trim())}}`, holes: 1 };
    }
    if (n > 0) {
      return { rhs: `${ty}{${Array.from({ length: n }, (_, i) => hole(i)).join(", ")}}`, holes: n };
    }
  }

  // `[]T` and `map[K]V`: the CONSTRUCTOR is type-determined and leaks nothing;
  // how many elements and which are contract-determined and stay ONE hole.
  if (ty.startsWith("[]")) {
    return { rhs: `${ty}{${hint(ty.slice(2).trim())}}`, holes: 1 };
  }
  if (ty.startsWith("map[")) {
    const close = matchDelim(ty, 3);
    if (close !== -1) {
      // `/* K, V */`, the spelling contract-go.md's table gives.
      return { rhs: `${ty}{${hint(`${ty.slice(4, close)}, ${ty.slice(close + 1).trim()}`)}}`, holes: 1 };
    }
  }

  // A named struct, an interface, a pointer, `error`: one hole hinting the type.
  return { rhs: hint(ty), holes: 1 };
}

/**
 * The blank-value RHS for a Go return type. Scaffold what the TYPE determines
 * (no contract leak), keep as ONE hole what the CONTRACT determines (a leak
 * would defeat blank-value). Pure; never throws.
 */
export function goRenderBlankValue(returnType: string, opts?: { startHole?: number }): BlankValueResult {
  return renderGoType((returnType ?? "").trim(), opts?.startHole ?? 1);
}

// ===========================================================================
// The expected-value locator
// ===========================================================================

/** True when `i` opens a STATEMENT: the previous non-space character is a line
 *  break, a `;`, a brace, or nothing. Keeps `got, want := f(), 7` out — the
 *  multi-assign form is not the generated shape, and blanking the wrong half of
 *  it would blank the call under test. */
function isStatementStart(text: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (text[j] === " " || text[j] === "\t")) {
    j--;
  }
  return j < 0 || text[j] === "\n" || text[j] === ";" || text[j] === "{" || text[j] === "}";
}

// Go's automatic semicolon insertion, from the other side: a semicolon is
// inserted at end of line only when the last token is an identifier, a literal,
// or one of `) ] }` and a few keywords. A line ending in a BINARY OPERATOR or an
// opener therefore CONTINUES, and `want := "aaaa" +\n\t"bbbb"` is one statement.
// Blanking half of that leaves the model's second operand in the human's buffer
// and a syntax error behind it, which is the blank-value invariant inverted.
const GO_LINE_CONTINUES = "+-*/%&|^<>=!,.([{:";

/** The last non-blank character before `i`, or "" at the start of the text. */
function prevNonBlank(text: string, i: number): string {
  let j = i - 1;
  while (j >= 0 && (text[j] === " " || text[j] === "\t")) {
    j--;
  }
  return j < 0 ? "" : text[j];
}

/** The end of the statement whose value starts at `start`: a `;` at depth zero, a
 *  newline that Go would insert a semicolon before, a closing delimiter that is
 *  not ours, or a trailing comment. */
function statementEnd(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    // A comment at depth zero ends the value; inside a composite literal it is
    // part of the spanned text and gets skipped like any other literal.
    if (depth === 0 && c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      break;
    }
    const skipped = skipLiteralOrComment(text, i, GO_LITERALS);
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
    } else if (depth === 0 && c === ";") {
      break;
    } else if (depth === 0 && c === "\n" && !GO_LINE_CONTINUES.includes(prevNonBlank(text, i))) {
      break;
    }
    i++;
  }
  while (i > start && /\s/.test(text[i - 1])) {
    i--;
  }
  return i;
}

/**
 * The EXPECTED-VALUE spans in generated Go test text: the right-hand side of
 * each `want := …` assignment, and nothing else.
 *
 * Safety-critical. It must not match `got :=` (that is the call under test), a
 * `want` inside a string or a comment, or a `want` that is a struct FIELD — all
 * three would blank the wrong bytes and keep the model's guessed value, which
 * inverts the blank-value invariant. Spans come back in ascending,
 * non-overlapping order.
 */
export function goExpectedValueSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, GO_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (
      text.startsWith("want", i) &&
      !isIdentChar(text[i + 4]) &&
      !isIdentChar(text[i - 1] ?? "") &&
      isStatementStart(text, i)
    ) {
      const afterName = skipSpace(text, i + 4);
      // `:=` and only `:=`. A struct field spelled `want:` has a single colon and
      // is left alone.
      if (text.startsWith(":=", afterName)) {
        const start = skipSpace(text, afterName + 2);
        const end = statementEnd(text, start);
        if (end > start) {
          spans.push({ start, end });
          i = end;
          continue;
        }
      }
    }
    i++;
  }
  return spans;
}

/**
 * How many generated TEST FUNCTIONS the locator walked without resolving a single
 * expected-value span inside them.
 *
 * scraps D5's all-or-nothing floor, spelled for Go, and the UNIT is the test
 * function rather than the assertion because that is what the assertion
 * instruction makes it: one case per test function, `got :=` then `want :=` then
 * the comparison. A function with no `want :=` span either wrote its expected
 * value in a shape this locator does not read (`var want = 7`, measured) or
 * asserted nothing at all. Both are the SILENCE that ships the model's guess
 * beside the other function's holes, and both must refuse the whole pass.
 *
 * This deliberately does NOT teach the locator `var want = <v>`. The floor is
 * the fix; a smarter locator is the treadmill it defers away from.
 */
export function goUnresolvedAssertions(text: string): number {
  const spans = goExpectedValueSpans(text);
  let unresolved = 0;
  for (const body of goTestFunctionBodies(text)) {
    if (!spans.some((s) => s.start >= body.start && s.end <= body.end)) {
      unresolved++;
    }
  }
  return unresolved;
}

/** The BODY span of every top-level `func TestX(...) { … }`, literals and
 *  comments skipped so a brace inside a string never closes the body early.
 *
 *  `TestMain` is EXCLUDED. It matches the name shape but it is Go's runner hook,
 *  not a test: `func TestMain(m *testing.M) { os.Exit(m.Run()) }` legitimately
 *  asserts nothing, so counting it would refuse the whole pass over an ordinary
 *  idiom of the language. It is the one name `go test` treats specially, so the
 *  exclusion is exact rather than a heuristic. */
function goTestFunctionBodies(text: string): Array<{ start: number; end: number }> {
  const bodies: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, GO_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    const m = /^func\s+(Test[A-Z_]\w*)\s*\(/.exec(text.slice(i));
    if (m === null || isIdentChar(text[i - 1] ?? "") || m[1] === "TestMain") {
      i++;
      continue;
    }
    const open = text.indexOf("{", i + m[0].length);
    if (open === -1) {
      break;
    }
    const close = matchDelim(text, open);
    if (close === -1) {
      break;
    }
    bodies.push({ start: open + 1, end: close });
    i = close + 1;
  }
  return bodies;
}

// ===========================================================================
// The framework: gotest
// ===========================================================================

/** The three actions that END a test. `pause` and `cont` carry a `Test` field
 *  too and are neither. */
const GO_TERMINAL = new Set(["pass", "fail", "skip"]);

// `[setup failed]` is NOT a compile error. Measured on a cold module cache: the
// package-level output event carries `FAIL\t<pkg> [setup failed]`. Reporting it
// as "the tests did not compile" sends the human to code that compiles fine.
//
// A setup failure and a compile failure BOTH emit `build-output` and
// `build-fail`, and the bracketed token is the only thing telling them apart.
const GO_SETUP_FAILED = /\[setup failed\]/;

// The remediation `go test` prints for a missing module is `go get`, which this
// product FORBIDS. Name the problem and stop; never hand the human a command
// this product will not run and does not want run.
const GO_REMEDIATION_LINE = /^\s*go\s+(get|mod|install|work)\b/;

/** A build-output text with the toolchain's `go get` remediation removed, and the
 *  `; to add:` that introduced it left dangling nowhere. */
function withoutRemediation(text: string): string {
  return text
    .split("\n")
    .filter((l) => !GO_REMEDIATION_LINE.test(l))
    .join("\n")
    .replace(/[;,]?\s*to add:?\s*$/, "")
    .trim();
}

/** One `go test -json` event. Every field is `unknown` because the parser must
 *  survive a line that is JSON but not an event. */
interface GoTestEvent {
  Action?: unknown;
  Test?: unknown;
  Output?: unknown;
}

/** One JSON-Lines record, or undefined when the line is not one. Garbage
 *  tolerance, the same discipline `parseCheckOutput` keeps: a line that does not
 *  parse is SKIPPED, never thrown on. */
function parseEventLine(line: string): GoTestEvent | undefined {
  const t = line.trim();
  if (!t.startsWith("{")) {
    return undefined;
  }
  try {
    const v: unknown = JSON.parse(t);
    return typeof v === "object" && v !== null ? (v as GoTestEvent) : undefined;
  } catch {
    return undefined;
  }
}

function stringField(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A failing test's detail: its own `output` events, minus the two lines
 *  `go test` frames every test with. Those two name THIS test, so dropping them
 *  cannot drop anything the test itself printed. */
function failureDetail(name: string, chunks: string[]): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const framing = new RegExp(`^\\s*(?:=== (?:RUN|PAUSE|CONT)\\s+${esc}|--- (?:PASS|FAIL|SKIP): ${esc} \\(.*\\))$`);
  return chunks
    .join("")
    .split("\n")
    .filter((l) => !framing.test(l))
    .join("\n")
    .replace(/\s+$/, "");
}

/**
 * Parse `go test -json` output: one JSON object per line, a line that does not
 * parse SKIPPED.
 *
 * `-json` rather than `-v` text because the phase 2 review proved the text format
 * forgeable BY THE CODE UNDER TEST. `go test` indents a failure message, and the
 * generated assertion idiom prints the value under test, so a function returning
 * `"line1\n--- PASS: TestPhantom (0.00s)"` puts a verdict line in the output of a
 * test that failed. Narrowing the regex only narrows the channel.
 *
 * The structure closes it: a VERDICT is an `Action` of `pass`/`fail`/`skip`
 * carrying a `Test` field, and a forged one can only ever land inside an
 * `Action: "output"` event's `Output` string, ATTRIBUTED to the real test that
 * printed it. The two cannot be confused whatever the test prints.
 *
 * Three more things fall out for free rather than needing a rule each:
 *   - the parallel-output contamination the review found, because `t.Parallel`
 *     interleaving is attributed per event by the `Test` field;
 *   - the filter miss, which is a package-level terminal action with zero
 *     `Test`-tagged events — derived from structure, no regex to forge;
 *   - the bare `PASS` / bare `FAIL` traps, which are package-scoped output events
 *     and so are excluded by construction.
 */
export function parseGoTestOutput(stdout: string, stderr: string, _exitCode: number): TestRunParse {
  const cases: TestCaseResult[] = [];
  const failures: TestFailureDetail[] = [];
  const open = new Map<string, string[]>();
  const closed = new Set<string>();
  const buildOutput: string[] = [];
  let testEvents = 0;
  let packagePassed = false;
  let buildFailed = false;
  let setupFailed = false;

  for (const line of (stdout ?? "").replace(/\r/g, "").split("\n")) {
    const ev = parseEventLine(line);
    if (ev === undefined) {
      continue;
    }
    const action = stringField(ev.Action);
    const output = stringField(ev.Output);
    // The compile error arrives on STDOUT as `build-output` events and stderr is
    // EMPTY, which is the plumbing change `-json` forces.
    if (action === "build-output") {
      buildOutput.push(output);
      continue;
    }
    if (action === "build-fail") {
      buildFailed = true;
      continue;
    }
    const test = typeof ev.Test === "string" && ev.Test.length > 0 ? ev.Test : undefined;
    if (test === undefined) {
      if (action === "output" && GO_SETUP_FAILED.test(output)) {
        setupFailed = true;
      }
      if (action === "pass") {
        packagePassed = true;
      }
      continue;
    }
    testEvents++;
    if (action === "run") {
      open.set(test, []);
      closed.delete(test);
      continue;
    }
    if (action === "output") {
      const buf = open.get(test);
      if (buf !== undefined && !closed.has(test)) {
        buf.push(output);
      }
      continue;
    }
    if (!GO_TERMINAL.has(action)) {
      continue;
    }
    closed.add(test);
    const outcome: TestOutcome = action === "pass" ? "pass" : action === "fail" ? "fail" : "ignored";
    cases.push({ name: test, outcome });
    if (outcome === "fail") {
      failures.push({ name: test, message: failureDetail(test, open.get(test) ?? []) });
    }
  }

  const parse: TestRunParse = {
    ran: testEvents > 0,
    cases,
    failures,
    passed: cases.filter((c) => c.outcome === "pass").length,
    failed: cases.filter((c) => c.outcome === "fail").length,
    ignored: cases.filter((c) => c.outcome === "ignored").length,
    // `-json` emits an event for every case, passing ones included, unlike C#.
    casesComplete: true,
  };
  if (setupFailed) {
    // The environment could not be assembled: a module the cache does not hold
    // and no way to fetch it offline. Not a compile error and not a test failure.
    parse.environmentError =
      withoutRemediation(buildOutput.join("")) || withoutRemediation(stderr) || "go test could not set the package up";
  } else if (buildFailed) {
    parse.buildError = buildOutput.join("").trim() || stderr.trim();
  } else if (packagePassed && testEvents === 0) {
    // A filter miss ends `Action: "pass"` at exit 0. Requiring only ZERO test
    // events would catch a setup failure too — same structure, and it ends
    // `Action: "fail"` — and tell a human with a cold module cache that their
    // filter matched nothing, which is a worse lie than the one this parser is
    // here to stop.
    parse.filterMatchedNothing = true;
  }
  return parse;
}

/** Escape a test name for the `-run` regex. Generated names are `Test\w+` and
 *  need no escaping, but the filter is a REGEX and a name is data. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ===========================================================================
// The failure hooks (session-v60 phase B2)
// ===========================================================================

/**
 * `go test`'s failure LOCATION, out of what parseGoTestOutput left in the
 * message.
 *
 * The shape, from the committed capture at test/fixtures/gotest/fail.json:
 *
 *     widget_test.go:8: Add(2, 3) = -1, want 5
 *
 * The FIRST such line wins: `t.Errorf` does not stop the test, so a message can
 * carry several and the first is the first thing that went wrong. Go reports no
 * COLUMN, so the field stays absent rather than being invented.
 *
 * Three things this DECLINES on, and each of them is a wrong location avoided:
 *
 *  - a line that is not INDENTED. `go test` indents every location line it
 *    writes, one level per subtest depth, so a flush-left match is something the
 *    code under test printed. The same forgery reasoning that put this leg on
 *    `-json` in the first place applies to the text inside an output event.
 *  - a file that is not a `.go` file. The location go reports is always a Go
 *    source file, and requiring the extension is what separates it from
 *    `config.yaml:12:` in a message a test wrote.
 *  - `host:port:` shapes, which fall out of the same rule for free.
 */
export function goTestFailureLocation(message: string): FailureLocation | undefined {
  // The path may hold spaces but never a colon: go writes it relative to the
  // package directory, and the colon is the field separator.
  const m = /^[ \t]+([^\s:][^:\n]*?\.go):(\d+):(?: |$)/m.exec(message ?? "");
  return m === null ? undefined : { filePath: m[1], line: Number(m[2]) };
}

/**
 * `go test`'s own framing: the `--- FAIL: Name (0.00s)` verdict lines and the
 * `=== RUN Name` markers. What is left is what the test itself printed.
 *
 * parseGoTestOutput already drops the pair naming the test the message BELONGS
 * to, so what this catches is the framing go attributes to a test that is not
 * the one it frames - a parent whose subtest verdicts are indented under it -
 * plus any text-format output that did not come through the `-json` parse.
 *
 * The package trailer (`FAIL`, `ok example.com/widget 0.001s`) is NOT touched:
 * those are package-scoped output events, so they never reach a failure message,
 * and a bare `FAIL` line inside one is something the test printed.
 */
export function goTestStripHarnessFrames(message: string): string {
  return (message ?? "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*--- (?:FAIL|PASS|SKIP):\s+\S+\s+\([\d.]+s\)\s*$/.test(l))
    .filter((l) => !/^\s*=== (?:RUN|PAUSE|CONT|NAME)\s+\S+\s*$/.test(l))
    .join("\n")
    .replace(/\s+$/, "");
}

const GO_TESTING: TestFramework = {
  id: "gotest",
  displayName: "go test (testing)",

  failureLocation: goTestFailureLocation,
  stripHarnessFrames: goTestStripHarnessFrames,

  // Always. `testing` is in the standard library, so a resolved module root IS
  // the framework: there is nothing to look for, nothing to install and nothing
  // to be honest-dark about. Go is the only one of the five like this.
  detect() {
    return true;
  },

  // `go test -run '^(TestA|TestB)$' -json <packageArg>` from the module root.
  //
  //  - `-json` is not optional and it REPLACES `-v`. The text format is forgeable
  //    by the code under test (see parseGoTestOutput); `-json` emits the same
  //    per-test output plus the structure that makes it unforgeable, so `-v` is
  //    redundant and is dropped.
  //  - the filter is ANCHORED. Measured: unanchored, `TestAggregateFanoutHappy`
  //    also selects `TestAggregateFanoutHappyPath`, so the rung would blame this
  //    function for a superset-named test it did not generate.
  //  - the env is GoOracle's, so the rung and the check agree about GOFLAGS and
  //    about the network being off.
  buildCommand(placement: TestPlacement, testNames: string[]): TestRunCommand {
    const names = testNames.filter((n) => n.length > 0);
    if (names.length === 0) {
      // `-run '^()$'` matches nothing, exits 0 and prints PASS. Refusing here is
      // the floor under the caller's refusal, never a command that cannot fail.
      throw new Error("go test needs at least one test name: an empty filter runs nothing and reports a pass");
    }
    const args = ["test", "-run", `^(${names.map(escapeRegex).join("|")})$`, "-json"];
    if (placement.packageArg !== undefined) {
      args.push(placement.packageArg);
    }
    return { command: "go", args, cwd: placement.runRoot, env: { ...GO_SPAWN_ENV } };
  },

  parseOutput: parseGoTestOutput,

  assertionInstruction:
    "Go has no assert library in the standard library. Write ONE case per test function, no table-driven loops: " +
    "`got := <call>` on one line, then `want := <expected>` on the next, then " +
    "`if got != want { t.Errorf(\"<call> = %v, want %v\", got, want) }`. " +
    "The EXPECTED value is the right-hand side of `want :=` and nothing else. " +
    "Every test function must be named `Test` followed by an uppercase letter and take `t *testing.T`.",

  expectedValueSpans: goExpectedValueSpans,

  classifiesBuildError: true,
  unresolvedAssertions: goUnresolvedAssertions,
};

// ===========================================================================
// Placement
// ===========================================================================

/** The package a Go file DECLARES, read structurally so a `package` word inside
 *  a comment or a string is never mistaken for the clause. */
export function goPackageClauseOf(text: string): string | undefined {
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, GO_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (text.startsWith("package", i) && !isIdentChar(text[i - 1] ?? "")) {
      const m = /^package\s+([A-Za-z_]\w*)/.exec(text.slice(i));
      if (m !== null) {
        return m[1];
      }
    }
    i++;
  }
  return undefined;
}

/** The source file's directory as a Go relative package path, always with
 *  forward slashes whatever the platform: `.` at the module root,
 *  `./internal/foo` below it. */
function packageArgFor(moduleRoot: string, dir: string): string {
  const rel = path.relative(moduleRoot, dir);
  return rel === "" ? "." : `./${rel.split(path.sep).join("/")}`;
}

// ===========================================================================
// The scaffold
// ===========================================================================

/** Every top-level `import` declaration's span, in source order. Go allows
 *  several, and they must all precede the first non-import declaration — which
 *  is why `"testing"` cannot simply be appended beside the generated tests. */
function importDecls(text: string): Array<{ start: number; end: number; blockClose: number }> {
  const out: Array<{ start: number; end: number; blockClose: number }> = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipLiteralOrComment(text, i, GO_LITERALS);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (text.startsWith("import", i) && !isIdentChar(text[i - 1] ?? "") && !isIdentChar(text[i + 6] ?? "")) {
      const after = skipSpace(text, i + 6);
      if (text[after] === "(") {
        const close = matchDelim(text, after);
        if (close !== -1) {
          out.push({ start: i, end: close + 1, blockClose: close });
          i = close + 1;
          continue;
        }
      } else {
        let k = after;
        while (k < text.length && text[k] !== "\n") {
          k++;
        }
        out.push({ start: i, end: k, blockClose: -1 });
        i = k;
        continue;
      }
    }
    i++;
  }
  return out;
}

function hasTestingImport(text: string): boolean {
  return importDecls(text).some((d) => /"testing"/.test(text.slice(d.start, d.end)));
}

/** `text` with `"testing"` added to its imports: into the last import BLOCK when
 *  there is one, else as a fresh `import "testing"` declaration after the last
 *  import (or after the package clause when there are none). */
function addTestingImport(text: string): string {
  const decls = importDecls(text);
  const last = decls[decls.length - 1];
  if (last !== undefined && last.blockClose !== -1) {
    const lineStart = text.lastIndexOf("\n", last.blockClose) + 1;
    return `${text.slice(0, lineStart)}\t"testing"\n${text.slice(lineStart)}`;
  }
  if (last !== undefined) {
    return `${text.slice(0, last.end)}\nimport "testing"${text.slice(last.end)}`;
  }
  const pkgM = /^[ \t]*package[ \t]+[A-Za-z_]\w*[^\n]*$/m.exec(text);
  if (pkgM === null) {
    return `import "testing"\n\n${text}`;
  }
  const at = pkgM.index + pkgM[0].length;
  return `${text.slice(0, at)}\n\nimport "testing"${text.slice(at)}`;
}

/**
 * The package the generated file must DECLARE, or a refusal.
 *
 * There is no fallback. The directory basename was one, and it is wrong twice
 * over: `go-scratch` is `package go-scratch`, which is `expected 'IDENT', found
 * 'go'` and does not compile; and the two genuinely differ once in cobra and 31
 * times in hugo, mostly `package main` under a differently named directory. A
 * guess that is illegal a third of the time is worse than saying so.
 */
function requiredPackageName(input: ScaffoldInput): string {
  const pkg = input.placement.packageName;
  if (pkg === undefined || !/^[A-Za-z_]\w*$/.test(pkg)) {
    throw new Error(
      `cannot scaffold ${input.placement.targetPath}: the source file's package clause was not resolved, ` +
        "and a Go package name cannot be guessed from the directory name",
    );
  }
  return pkg;
}

// ===========================================================================
// The language
// ===========================================================================

const GO_TDD_LANG: TddLang = {
  languageId: "go",
  displayName: "Go",

  // `foo_test.go` beside `foo.go`, same package, run from the module root with
  // the file's directory as a relative package argument.
  placementFor(filePath: string, _symbolName: string, deps: TddDeps): PlacementResult {
    const exists = fileExistsOf(deps);
    const readFile = readFileOf(deps);
    const oracle = new GoOracle({ fileExists: exists, readFile, log: deps.log });
    const moduleRoot = oracle.detectCrateRoot(filePath);
    if (moduleRoot === undefined) {
      // The go.work refusal is INHERITED from the check, not new here, and it
      // must be said: detectCrateRoot returns undefined for a module inside a
      // workspace, so a workspace user gets no TDD gesture either. Naming
      // go.work keeps the human from hunting for a go.mod that is right there.
      const why = oracle.describeMissingRoot?.(filePath) ?? `no go.mod above ${filePath}`;
      return {
        ok: false,
        refusal: { reason: "no-project-root", detail: `${why}; \`go test\` has no module to run in` },
      };
    }
    const dir = path.dirname(filePath);
    const base = path.basename(filePath).replace(/\.go$/, "");
    // A source file that IS a test file has no `_test_test.go` sibling to make:
    // the target IS the source, and the mode has to SAY so. `sibling-file` over a
    // targetPath equal to filePath is a lie about the target, and a consumer that
    // opens the sibling would open the file it is already reading from.
    const targetPath = base.endsWith("_test") ? filePath : path.join(dir, `${base}_test.go`);
    const placement: TestPlacement = {
      targetPath,
      exists: exists(targetPath),
      mode: targetPath === filePath ? "same-file" : "sibling-file",
      runRoot: moduleRoot,
      packageArg: packageArgFor(moduleRoot, dir),
    };
    // The package the generated file must declare, read from the SOURCE file.
    // Deriving it from the directory name is wrong often enough to matter, and
    // this is the only step holding both the source path and the deps to read it.
    const packageName = goPackageClauseOf(readFile(filePath) ?? "");
    if (packageName !== undefined) {
      placement.packageName = packageName;
    }
    return { ok: true, placement };
  },

  // `go test -run ^(a|b)$ <packageArg>` from the module root: the package
  // argument is what one spawn is scoped to, so tests in two packages are two
  // runs and tests in one package are one.
  runScope: "package",

  // The module root the CHECK resolves, deliberately: a discovered test that
  // resolved a different module from the one `go build` uses would run under
  // resolution rules the human never sees. The workspace refusal rides along
  // with it, which is why the detail comes from describeMissingRoot.
  runTargetForTestFile(testFilePath: string, deps: TddDeps): PlacementResult {
    const oracle = new GoOracle({ fileExists: fileExistsOf(deps), readFile: readFileOf(deps), log: deps.log });
    const moduleRoot = oracle.detectCrateRoot(testFilePath);
    if (moduleRoot === undefined) {
      const why = oracle.describeMissingRoot?.(testFilePath) ?? `no go.mod above ${testFilePath}`;
      return {
        ok: false,
        refusal: { reason: "no-project-root", detail: `${why}; \`go test\` has no module to run ${path.basename(testFilePath)} in` },
      };
    }
    // No packageName and no importLine: nothing is written, so there is no
    // package clause to declare and nothing to reach for.
    return {
      ok: true,
      placement: {
        targetPath: testFilePath,
        exists: true,
        mode: "same-file",
        runRoot: moduleRoot,
        packageArg: packageArgFor(moduleRoot, path.dirname(testFilePath)),
      },
    };
  },

  scaffold(input: ScaffoldInput): TestInsertionPlan {
    const { begin, end } = testMarkers(input.markerId, GO_TDD_LANG.markerPrefix);
    // Go's top-level funcs sit at column 0 whatever the model emitted.
    const region = `${begin}\n${reindent(input.generatedTests, "")}\n${end}`;
    const text = input.existingText;

    // 1. replace-generated: a prior marked region for this markerId — swap
    //    exactly it, so regenerating is idempotent and the developer's own tests
    //    in the same file are never touched.
    const bi = text.indexOf(begin);
    if (bi !== -1) {
      const ei = text.indexOf(end, bi);
      if (ei !== -1) {
        return { start: bi, end: ei + end.length, mode: "replace-generated", text: region };
      }
    }

    // 2. the whole file, when there is no file yet. Rust's `new-module` mode
    //    means the same thing here: the plan spans an empty document and the
    //    text is everything.
    if (text.trim().length === 0) {
      return {
        start: 0,
        end: text.length,
        mode: "new-module",
        text: `package ${requiredPackageName(input)}\n\nimport "testing"\n\n${region}\n`,
      };
    }

    // 3. extend-existing: append the marked region at end of file.
    const tail = `${text.endsWith("\n") ? "" : "\n"}\n${region}\n`;
    if (hasTestingImport(text)) {
      return { start: text.length, end: text.length, mode: "extend-existing", text: tail };
    }
    // The import is missing, and Go requires every import to precede the first
    // other declaration — so the edit cannot be an append. A TestInsertionPlan is
    // ONE contiguous replacement, so the span is the whole file. Rare: an
    // existing `_test.go` almost always imports testing already.
    //
    // A target holding text but NO package clause is not a Go file yet, and
    // prepending `import "testing"` into it produces `expected 'package', found
    // 'import'` — verified with `go vet`. The clause goes in first.
    const head =
      goPackageClauseOf(text) === undefined ? `package ${requiredPackageName(input)}\n\n${text}` : text;
    return { start: 0, end: text.length, mode: "extend-existing", text: `${addTestingImport(head)}${tail}` };
  },

  markerPrefix: "//",

  generatedTestNames(fileText: string, markerId: string): string[] {
    const { begin, end } = testMarkers(markerId, GO_TDD_LANG.markerPrefix);
    const bi = fileText.indexOf(begin);
    if (bi === -1) {
      return [];
    }
    const ei = fileText.indexOf(end, bi);
    if (ei === -1) {
      return [];
    }
    return [...fileText.slice(bi + begin.length, ei).matchAll(/\bfunc\s+(Test\w+)/g)].map((m) => m[1]);
  },

  // `go test` silently IGNORES a function that is not `Test` plus an uppercase
  // letter or an underscore — a badly named generated test is never run, which is
  // a false green wearing a different hat. Reject it at generation time.
  testNameIsValid(name: string): boolean {
    return /^Test[A-Z_]/.test(name);
  },

  classifyTestability: classifyGoTestability,

  returnTypeOf: goReturnTypeOf,

  renderBlankValue: goRenderBlankValue,

  frameworks: [GO_TESTING],
};

export { GO_TDD_LANG, GO_TESTING };
