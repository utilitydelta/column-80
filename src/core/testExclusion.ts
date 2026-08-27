/**
 * Which discovered tests must not be RUN.
 *
 * The product's own generated tests are a ratified population. Discovered tests
 * are not: they are whatever the repo happens to contain, and this gesture runs
 * them, then a repair loop re-runs the same set under the cap. MEASURED on the
 * real C# corpus (session-v60/progress.md, Phase 0 item 2): 45 of 257 tests sit
 * in a `[Collection("postgres")]` class whose fixture runs
 *
 *   DROP TABLE IF EXISTS readings, corrections_overlay, ... CASCADE
 *
 * against a live Postgres, and `Directory.Delete(recursive: true)` on a
 * HARDCODED ABSOLUTE PATH inside the user's home directory. Firing that up to
 * three times per press is not a cost the developer agreed to when they asked
 * for their function's tests.
 *
 * READING THE ENCLOSING TYPE IS LOAD-BEARING, not an optimisation. The
 * destructive test declares only `[SkippableFact]`; the DROP lives two files
 * away in the collection fixture, and `[Collection(...)]` on the CLASS is the
 * only tell in reach of declaration text.
 *
 * WHAT THIS CANNOT SEE, and which the surface must say rather than pretend away:
 *
 *  - 5 Rust tests in the measured crate bind a real loopback socket with nothing
 *    in their declaration to say so, and 57 share a hardcoded
 *    `/tmp/test_compaction` path. Declaration text is all that exists at
 *    discovery time; a body scan is a different feature.
 *  - A MARKER ON A BASE CLASS, only PARTLY. `class ReadingTests :
 *    DatabaseTestBase` where the base holds the `[Collection(...)]` is xunit's
 *    other shared-fixture idiom (adversarial review row A5). A base declared in
 *    THIS file is resolved and read; a base declared elsewhere cannot be read at
 *    all, so it is excluded WITH ITS NAME rather than guessed at - see
 *    `inheritedMarker`. What is genuinely invisible is the marker's CONTENT in
 *    that second case: the report can say which base it could not follow, never
 *    what that base declares.
 *  - The base chain of an OUTER class when the test sits in a nested one. Only
 *    the nearest container's bases are followed.
 *
 * These gaps make the filter a FLOOR, not a guarantee: everything it names is
 * genuinely marked, and a test it does not name may still touch the world. An
 * excluded test is still DISCOVERED and reported with its reason - silence would
 * leave the developer thinking the walk missed it.
 */

import { ClassifyLang, CommentMarker, attributeWindow, codePart } from "./testClassify";

export interface ExclusionInput {
  /** The item's own name, as the server spelled it. */
  name: string;
  /** Absolute path of the item's file. */
  filePath: string;
  /** The file's lines, 0-indexed, or undefined when the file could not be read. */
  lines: readonly string[] | undefined;
  rangeStartLine: number;
  selectionStartLine: number;
}

export interface Exclusion {
  /** The marker text that excluded it, trimmed, so the report can quote it. */
  marker: string;
  /** Whether the marker sat on the test itself or on the type/module around it. */
  where: "declaration" | "enclosing" | "file";
}

/** Tabs are expanded to this many columns before two indents are compared.
 *
 *  The width is ARBITRARY. Indents are only ever compared between lines of the
 *  SAME file, so any consistent expansion answers the only question asked here:
 *  is this declaration further left than that one. Counting a tab as one
 *  character, which is what this file did before, made a class head written with
 *  four SPACES look DEEPER than its own members written with two TABS, so no
 *  container was found at all and an indent style change disarmed a safety
 *  filter (adversarial review row A4). */
const TAB_WIDTH = 4;

/** A line's leading whitespace width, tabs expanded to `TAB_WIDTH`. */
function indentOf(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") {
      width += 1;
    } else if (ch === "\t") {
      width += TAB_WIDTH;
    } else {
      break;
    }
  }
  return width;
}

// --- the string mask -------------------------------------------------------
//
// Analyzer, source-generator and codegen suites embed a whole source file in a
// verbatim (`@"..."`) or raw (`"""..."""`) string and write it FLUSH LEFT. That
// makes a `public sealed class C` INSIDE THE STRING sit further left than the
// test method around it, so the upward search for an enclosing type hits the
// fake head first and the real `[Collection(...)]` class two screens above is
// never consulted - the destructive test is handed to the runner (adversarial
// review row A1).
//
// So the enclosing-declaration search skips every line that BEGINS inside a
// multi-line string or block comment. OVER-CAUTION IS THE RIGHT DIRECTION HERE
// and it is the only direction this mask is used in: a line wrongly called
// "inside a string" only ever makes the walk look FURTHER UP for a real
// container, which can add an exclusion but never remove one. For that reason
// the mask is deliberately NOT applied to the marker scans themselves, where a
// wrong answer would lose an exclusion.

interface OpenRegion {
  /** The text that ends it. */
  close: string;
  /** True when the closer written TWICE is an escape rather than an end. C#'s
   *  verbatim string is the one in reach that works this way: `""` is a quote. */
  doubled: boolean;
  /** True when a backslash escapes the next character. Raw strings say no. */
  backslash: boolean;
}

/** Which lines BEGIN inside a multi-line string literal or block comment.
 *
 *  Per language because the delimiters differ and reading the wrong ones is
 *  worse than reading none: Rust's `'a` lifetime is not a char literal opener,
 *  and Rust's `#` is an attribute sigil where Python's is a comment. Go and
 *  TypeScript get an all-false mask because neither reads declaration geometry:
 *  Go's exclusion is a file-head scan and TypeScript's is file granularity. */
function stringMask(lang: ClassifyLang, lines: readonly string[]): boolean[] {
  const mask: boolean[] = new Array(lines.length).fill(false);
  if (lang === "go" || lang === "typescript") {
    return mask;
  }
  let open: OpenRegion | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (open !== undefined) {
      mask[i] = true;
    }
    const text = lines[i] ?? "";
    let j = 0;
    while (j < text.length) {
      if (open !== undefined) {
        if (open.backslash && text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text.startsWith(open.close, j)) {
          if (open.doubled && text.startsWith(open.close + open.close, j)) {
            j += open.close.length * 2; // `""` inside a verbatim string is a quote
            continue;
          }
          j += open.close.length;
          open = undefined;
          continue;
        }
        j += 1;
        continue;
      }
      const rest = text.slice(j);
      if (lang === "python") {
        if (rest.startsWith("#")) {
          break; // the rest of the line is a comment
        }
        const fence = /^("""|''')/.exec(rest);
        if (fence) {
          open = { close: fence[1], doubled: false, backslash: true };
          j += 3;
          continue;
        }
        if (rest.startsWith('"') || rest.startsWith("'")) {
          // A single-quoted Python string cannot cross a line, so it is stepped
          // over here rather than opened: leaving it open would mask the whole
          // rest of the file off the back of one apostrophe in a comment.
          const q = rest[0] as string;
          const end = skipSingleLine(rest, q);
          j += end;
          continue;
        }
        j += 1;
        continue;
      }
      if (lang === "rust") {
        if (rest.startsWith("//")) {
          break;
        }
        if (rest.startsWith("/*")) {
          open = { close: "*/", doubled: false, backslash: false };
          j += 2;
          continue;
        }
        const raw = /^b?r(#*)"/.exec(rest);
        if (raw) {
          open = { close: `"${raw[1]}`, doubled: false, backslash: false };
          j += raw[0].length;
          continue;
        }
        if (rest.startsWith('"') || rest.startsWith('b"')) {
          // A Rust string literal MAY span lines, so this one stays open.
          open = { close: '"', doubled: false, backslash: true };
          j += rest.startsWith('b"') ? 2 : 1;
          continue;
        }
        // `'` is deliberately not an opener: `'a` is a lifetime, and treating it
        // as a char literal would mask the remainder of a generic-heavy file.
        j += 1;
        continue;
      }
      // C#.
      if (rest.startsWith("//")) {
        break;
      }
      if (rest.startsWith("/*")) {
        open = { close: "*/", doubled: false, backslash: false };
        j += 2;
        continue;
      }
      const verbatim = /^\$?@\$?"/.exec(rest);
      if (verbatim) {
        open = { close: '"', doubled: true, backslash: false };
        j += verbatim[0].length;
        continue;
      }
      const rawFence = /^\$*("{3,})/.exec(rest);
      if (rawFence) {
        // A raw string literal ends on a quote run at least as long as its
        // opener, which `close` captures exactly.
        open = { close: rawFence[1], doubled: false, backslash: false };
        j += rawFence[0].length;
        continue;
      }
      if (rest.startsWith('"')) {
        j += skipSingleLine(rest, '"'); // an ordinary C# string cannot cross a line
        continue;
      }
      if (rest.startsWith("'")) {
        j += skipSingleLine(rest, "'");
        continue;
      }
      j += 1;
    }
  }
  return mask;
}

/** How far past `rest[0]` a quote that cannot cross a line reaches: to its
 *  closing quote, or to the end of the line when it never closes. */
function skipSingleLine(rest: string, quote: string): number {
  for (let k = 1; k < rest.length; k++) {
    if (rest[k] === "\\") {
      k += 1;
      continue;
    }
    if (rest[k] === quote) {
      return k + 1;
    }
  }
  return rest.length;
}

/**
 * Scan the window for the first line whose CODE matches `pattern`, returning
 * the code part trimmed.
 *
 * Comments are cut first, for the same reason classification cuts them: a
 * commented-out `[Collection("postgres")]` is not a collection, and reading one
 * as a marker would exclude a test the developer expects to run. The direction
 * is the opposite of classification's - here a false positive costs a test that
 * does not run rather than a destructive one that does - but the honest answer
 * is the same either way, and the reported `marker` reads as code rather than
 * as prose that happened to mention an attribute.
 */
function findIn(
  lines: readonly string[],
  from: number,
  to: number,
  pattern: RegExp,
  marker: CommentMarker,
): string | undefined {
  for (let i = Math.max(0, from); i <= Math.min(to, lines.length - 1); i++) {
    const code = codePart(lines[i] ?? "", marker);
    if (pattern.test(code)) {
      return code.trim();
    }
  }
  return undefined;
}

/**
 * The WHOLE CHAIN of enclosing declarations above `line`, nearest first, each
 * strictly less indented than the last and matching `head`.
 *
 * The chain rather than the nearest one, because xunit's nested-class idiom puts
 * the test in an inner `class WhenReading` while the `[Collection(...)]` sits on
 * the outer class - consulting only the nearest container hands a destructive
 * test to the runner (adversarial review row A2).
 *
 * Indent rather than brace counting on purpose: a brace matcher has to be right
 * about strings, comments and raw literals to be right at all, and being wrong
 * here means running a destructive test. A declaration at a smaller indent is
 * the enclosing one in every layout either language's formatter produces, and
 * where it is not, the answer degrades to "no enclosing type found", which
 * excludes nothing extra rather than excluding the wrong thing.
 *
 * `masked` lines are skipped entirely: see the string mask above.
 */
function enclosingDeclChain(
  lines: readonly string[],
  line: number,
  head: RegExp,
  masked: readonly boolean[],
): number[] {
  const chain: number[] = [];
  const start = Math.min(Math.max(line, 0), lines.length - 1);
  let bound = indentOf(lines[start] ?? "");
  for (let i = start - 1; i >= 0; i--) {
    if (masked[i]) {
      continue;
    }
    const text = lines[i] ?? "";
    if (text.trim().length === 0) {
      continue;
    }
    const indent = indentOf(text);
    if (indent < bound && head.test(text)) {
      chain.push(i);
      bound = indent;
      if (bound === 0) {
        break; // nothing can enclose a declaration at column zero
      }
    }
  }
  return chain;
}

/**
 * The top of the contiguous run of decoration directly above `declLine`:
 * attribute or decorator lines, blanks and comment lines, with NO fixed bound,
 * stopping at the first line that is none of those.
 *
 * This replaces a fixed `ATTRIBUTE_LOOKBACK`-line window. Four attributes on a
 * class is a house style rather than a rarity - xunit's own `TestCaseOrderer`
 * and `TestFramework` stack there - and the fixed window pushed the
 * `[Collection(...)]` out of reach (adversarial review rows A3 and A7). The run
 * is exact instead: it ends where the decoration ends, so it can neither be too
 * short for a deep stack nor reach into the previous declaration's body.
 */
function decorationTop(lines: readonly string[], declLine: number, decoration: RegExp, marker: CommentMarker): number {
  let top = Math.min(Math.max(declLine, 0), Math.max(lines.length - 1, 0));
  for (let i = top - 1; i >= 0; i--) {
    const text = lines[i] ?? "";
    const trimmed = text.trim();
    const isComment = marker !== "none" && trimmed.startsWith(marker);
    if (trimmed.length === 0 || isComment || decoration.test(codePart(text, marker))) {
      top = i;
      continue;
    }
    break;
  }
  return top;
}

/** How far BELOW a C# type's declaration head to keep reading. The base list
 *  spills onto the following lines (`: IClassFixture<...>` under the head), and
 *  a fixture declared structurally is a marker like any other. */
const CS_BASE_LIST_REACH = 3;

// --- Rust -----------------------------------------------------------------
// `#[ignore]` is the toolchain's own "do not run this by default". A
// `#[cfg(feature = ...)]` gate means the test may not even be COMPILED under the
// default feature set, so a filter naming it selects nothing and the run reports
// a filter miss the developer cannot act on.
const RUST_OWN = /#\s*\[\s*ignore\b|#\s*\[\s*cfg\s*\(\s*feature\s*=/;
const RUST_MOD_HEAD = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+\w+/;
const RUST_DECORATION = /^\s*#!?\s*\[/;

// --- C# -------------------------------------------------------------------
// Every one of these says "this test needs something this process does not own".
// `[Collection(...)]` is the reliable tell for the destructive population; the
// fixture interfaces catch the same shape declared structurally instead.
const CS_OWN =
  /\[\s*(?:[A-Za-z_]\w*\s*\.\s*)*(?:SkippableFact|SkippableTheory|Ignore|IgnoreAttribute)\s*(?:\]|\(|,)|\[\s*Trait\s*\(\s*"Category"|\[\s*Collection\s*\(/;
const CS_TYPE_HEAD = /^\s*(?:\[[^\]]*\]\s*)*(?:(?:public|internal|private|protected|abstract|sealed|static|partial|unsafe|file)\s+)*(?:class|record|struct)\s+\w/;
const CS_TYPE_MARKER = /\[\s*Collection\s*\(|\[\s*Trait\s*\(\s*"Category"|\[\s*Ignore\b|I(?:Class|Collection)Fixture\s*</;

/** How far a base type name may be chased before the walk gives up. Three is
 *  deeper than any test hierarchy in the measured corpus and stops a cyclic or
 *  pathological chain dead. */
const CS_BASE_HOPS = 3;

/** The base list of the C# type declared at `line`: the names after `:`, with
 *  generic arguments and interfaces removed.
 *
 *  Interfaces are dropped by the `I` + capital convention. That is a naming
 *  heuristic and it is the right one here: `IClassFixture<T>` and
 *  `ICollectionFixture<T>` are ALREADY caught as markers by `CS_TYPE_MARKER`, so
 *  what this drops is the ordinary interface list, and dropping too few would
 *  only ever exclude more. */
function csBaseNames(lines: readonly string[], line: number, comment: CommentMarker): string[] {
  const text = lines
    .slice(line, Math.min(lines.length, line + 1 + CS_BASE_LIST_REACH))
    .map((l) => codePart(l ?? "", comment))
    .join(" ");
  const afterColon = text.split("{")[0].split(/\bwhere\b/)[0];
  const colon = afterColon.indexOf(":");
  if (colon === -1) {
    return [];
  }
  return afterColon
    .slice(colon + 1)
    .split(",")
    .map((part) => part.trim().replace(/<[\s\S]*/, "").trim())
    .filter((name) => /^[A-Za-z_]\w*(?:\.\w+)*$/.test(name))
    .filter((name) => !/^I[A-Z]/.test(name.split(".").pop() ?? name));
}

/** The line a C# type of this name is declared on, in THIS file. */
function csTypeDeclLine(lines: readonly string[], name: string, masked: readonly boolean[]): number | undefined {
  const bare = name.split(".").pop() ?? name;
  const head = new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*(?:(?:public|internal|private|protected|abstract|sealed|static|partial|unsafe|file)\\s+)*(?:class|record|struct)\\s+${bare}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (!masked[i] && head.test(lines[i] ?? "")) {
      return i;
    }
  }
  return undefined;
}

/**
 * The OTHER half of xunit's shared-fixture idiom: `[Collection("database")]`
 * sits on an abstract base and every suite derives from it, so nothing in the
 * derived file says "database" at all. The review found this and the file's own
 * "what this cannot see" list had to grow or the rule had to.
 *
 * The rule chosen: a base declared IN THIS FILE is resolved and checked like any
 * other container, and a base declared ELSEWHERE is EXCLUDED WITH ITS NAME. That
 * second half is deliberate over-caution, and it was measured before it was
 * written: of the 257 tests in the real C# corpus, ZERO sit in a class with a
 * non-interface base, so this costs that corpus nothing while closing a real
 * idiom. The cost when it does fire is a test that does not run and IS REPORTED,
 * with the base named, which the developer can act on. The cost of the other
 * direction is a `DROP TABLE` nobody asked for.
 */
function inheritedMarker(
  lines: readonly string[],
  typeLine: number,
  masked: readonly boolean[],
  comment: CommentMarker,
): Exclusion | undefined {
  let frontier = csBaseNames(lines, typeLine, comment);
  const seen = new Set<string>();
  for (let hop = 0; hop < CS_BASE_HOPS && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const name of frontier) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      const declared = csTypeDeclLine(lines, name, masked);
      if (declared === undefined) {
        return {
          marker: `inherits from ${name}, declared outside this file`,
          where: "enclosing",
        };
      }
      const top = decorationTop(lines, declared, CS_DECORATION, comment);
      const marker = findIn(lines, top, declared + CS_BASE_LIST_REACH, CS_TYPE_MARKER, comment);
      if (marker !== undefined) {
        return { marker, where: "enclosing" };
      }
      next.push(...csBaseNames(lines, declared, comment));
    }
    frontier = next;
  }
  return undefined;
}
const CS_DECORATION = /^\s*\[/;

// --- Python ---------------------------------------------------------------
// The mark names that say "this test needs something outside the process".
const PY_MARKS = "skip|skipif|xfail|integration|usefixtures";
const PY_OWN = new RegExp(`@\\s*(?:pytest\\s*\\.\\s*)?mark\\s*\\.\\s*(?:${PY_MARKS})\\b`);
// pytest's DOCUMENTED way to mark a whole module, and what a suite needing a
// live database uses instead of decorating forty functions (adversarial review
// row A6). Top level only: an indented `pytestmark` is a class attribute or a
// local, and neither marks the module.
const PY_MODULE_MARK = new RegExp(`^pytestmark\\s*=.*\\bmark\\s*\\.\\s*(?:${PY_MARKS})\\b`);
const PY_CLASS_HEAD = /^\s*class\s+\w/;
const PY_DECORATION = /^\s*@/;

// --- Go -------------------------------------------------------------------
// A build constraint means the file is not in the default build, so `go test`
// with a `-run` filter naming one of its tests matches nothing.
const GO_BUILD_TAG = /^\s*\/\/\s*(?:go:build|\+build)\b/;
const GO_PACKAGE = /^\s*package\s+\w/;

// --- TypeScript -----------------------------------------------------------
// File granularity, so there is no per-test marker to read. What IS readable is
// a whole suite the runner will not execute: a top-level `describe.skip` or
// `xdescribe`. Anything finer belongs to a per-test leg TypeScript does not have.
const TS_FILE_SKIP = /^(?:describe\s*\.\s*skip|xdescribe|suite\s*\.\s*skip)\s*\(/;

/**
 * Is this discovered test excluded from the runnable set? Never throws.
 *
 * `undefined` means runnable as far as declaration text can tell, which is a
 * narrower claim than safe. See the file header for what that text cannot see.
 */
export function testExclusion(lang: ClassifyLang, input: ExclusionInput): Exclusion | undefined {
  const lines = input.lines;
  if (lang === "go") {
    // The constraint must sit ABOVE `package`, so the package declaration is the
    // exact end of the scan. A fixed line count was not: a 16-line licence
    // header pushed a real `//go:build` past it (adversarial review row A8).
    if (lines === undefined) {
      return undefined;
    }
    const pkg = lines.findIndex((l) => GO_PACKAGE.test(l));
    const head = findIn(lines, 0, pkg === -1 ? lines.length - 1 : pkg, GO_BUILD_TAG, "none");
    return head === undefined ? undefined : { marker: head, where: "file" };
  }
  if (lang === "typescript") {
    if (lines === undefined) {
      return undefined;
    }
    const skipped = findIn(lines, 0, lines.length - 1, TS_FILE_SKIP, "//");
    return skipped === undefined ? undefined : { marker: skipped, where: "file" };
  }
  if (lines === undefined || lines.length === 0) {
    // No text, no markers. The safe direction here is NOT to exclude: an
    // unreadable file already fails classification, so the node never became a
    // test and never reaches this function on the live path.
    return undefined;
  }

  const masked = stringMask(lang, lines);
  const own = attributeWindow(input.rangeStartLine, input.selectionStartLine, lines.length);
  const head = lang === "rust" ? RUST_MOD_HEAD : lang === "python" ? PY_CLASS_HEAD : CS_TYPE_HEAD;
  const decoration = lang === "rust" ? RUST_DECORATION : lang === "python" ? PY_DECORATION : CS_DECORATION;
  const comment: CommentMarker = lang === "python" ? "#" : "//";
  const chain = enclosingDeclChain(lines, own.to, head, masked);
  const nearest = chain.length > 0 ? chain[0] : undefined;

  // The test's OWN window starts at the top of its own decoration run, or at the
  // range head's slack, whichever reaches further up.
  //
  // It never crosses the nearest container's head. The exclusion would still be
  // right, but the reported `where` would be wrong - and `where` is what tells
  // the developer whether the marker is on the test they are looking at or on
  // everything around it.
  const runTop = decorationTop(lines, own.to, decoration, comment);
  const ownFrom = Math.max(Math.min(own.from, runTop), nearest === undefined ? 0 : nearest + 1);

  const ownPattern = lang === "rust" ? RUST_OWN : lang === "python" ? PY_OWN : CS_OWN;
  const mine = findIn(lines, ownFrom, own.to, ownPattern, comment);
  if (mine !== undefined) {
    return { marker: mine, where: "declaration" };
  }

  // Then EVERY enclosing declaration, nearest first. For Rust the enclosing
  // `mod` carries the feature gate for every test inside it; for C# the
  // enclosing class carries the `[Collection(...)]` of the measured destructive
  // population; for Python the enclosing class carries the mark.
  const containerPattern = lang === "csharp" ? CS_TYPE_MARKER : ownPattern;
  for (const container of chain) {
    const top = decorationTop(lines, container, decoration, comment);
    const bottom = lang === "csharp" ? container + CS_BASE_LIST_REACH : container;
    const marker = findIn(lines, top, bottom, containerPattern, comment);
    if (marker !== undefined) {
      return { marker, where: "enclosing" };
    }
  }

  if (lang === "csharp" && nearest !== undefined) {
    const inherited = inheritedMarker(lines, nearest, masked, comment);
    if (inherited !== undefined) {
      return inherited;
    }
  }

  if (lang === "python") {
    // Last, because a mark on the test or its class is the more specific answer
    // and reads better in the report.
    const module = findIn(lines, 0, lines.length - 1, PY_MODULE_MARK, "#");
    if (module !== undefined) {
      return { marker: module, where: "file" };
    }
  }
  return undefined;
}
