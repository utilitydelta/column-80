/**
 * Python-shaped pure extraction helpers, the Python siblings of csExtraction.ts's
 * C# parsers and extraction.ts's Rust ones. They live in their own module because
 * the Rust helpers are pinned by blind suites and must not grow language branches;
 * both Python transports (pyExtractor product, pyLspExtractor headless) render
 * through these so the two produce byte-identical member shapes (the parity bar).
 *
 * Python carries no trait provenance, so no member built here ever sets viaTrait.
 * Unlike C#, Python IS example-bearing: a source-followable symbol whose docstring
 * carries a `>>>` doctest surfaces it. The signature rides the RESOLVED
 * completion item's `documentation` as a ```python fence (captured live:
 * `detail` is undefined), and the fence marker must NEVER leak into the rendered
 * signature (the C# green-but-wrong defect).
 */

import { CompletionMember, HoverSurface, MemberKind, SymbolRole } from "./extraction";
import { dedentToZeroBase, replyBaseIndent, withoutBase } from "./reindent";

// ---------------------------------------------------------------------------
// Dunder filter. Name-prefix, not kind. Single-underscore
// `_private` members are real API and are KEPT — dropping them would hide
// legitimate members a hallucination gate should still vouch for. `__x`, `__`,
// and `_x` are NOT dunders (a dunder is `__name__`, two-under both sides).
// ---------------------------------------------------------------------------

/** True when `name` is a Python dunder (`__init__`, `__doc__`, `__match_args__`).
 *  `/^__.+__$/`: two leading underscores, at least one character, two trailing.
 *  Single-underscore privates and half-dunders (`__x`) are not dunders. */
export function isDunder(name: string): boolean {
  return /^__.+__$/.test(name);
}

// ---------------------------------------------------------------------------
// Kind / role mappers. The vscode enums are 0-indexed; the raw LSP enums are
// 1-indexed (the SAME concept numbered one higher). Each transport passes its
// own mapper, never a shared table — the two enums genuinely disagree.
//
// The correction captured live: pyright returns instance methods as BOTH
// CompletionItemKind.Method (some receivers, e.g. Path) AND .Function (others,
// e.g. pydantic), so both map to a callable kind. Class attributes arrive as
// Variable, which is KEPT (never dropped) — a Variable at a `.` site is a real
// member.
// ---------------------------------------------------------------------------

/** vscode CompletionItemKind (0-indexed) -> MemberKind, or undefined for a kind
 *  that is never a member (Text=0/Keyword=13/Snippet=14). Method=1, Function=2,
 *  Field=4, Variable=5 (kept — a class attribute surfaces here), Property=9. */
export function pyVscodeMemberKind(kind: unknown): MemberKind | undefined {
  if (typeof kind !== "number") {
    return "other";
  }
  switch (kind) {
    case 0: // Text
    case 13: // Keyword
    case 14: // Snippet
      return undefined;
    case 1: // Method
      return "method";
    case 2: // Function
      return "function";
    case 4: // Field
    case 5: // Variable — a class attribute; KEPT
    case 9: // Property
      return "field";
    default:
      return "other";
  }
}

/** Raw LSP CompletionItemKind (1-indexed) -> MemberKind, or undefined for a kind
 *  that is never a member (Text=1/Keyword=14/Snippet=15). Method=2, Function=3,
 *  Field=5, Variable=6 (kept), Property=10. The vscode number PLUS ONE. */
export function pyLspMemberKind(kind: unknown): MemberKind | undefined {
  if (typeof kind !== "number") {
    return "other";
  }
  switch (kind) {
    case 1: // Text
    case 14: // Keyword
    case 15: // Snippet
      return undefined;
    case 2: // Method
      return "method";
    case 3: // Function
      return "function";
    case 5: // Field
    case 6: // Variable — a class attribute; KEPT
    case 10: // Property
      return "field";
    default:
      return "other";
  }
}

/** vscode SymbolKind (0-indexed) -> the documentSymbol role membersOfType needs.
 *  Class=4 is the container; members are Method=5, Property=6, Field=7, and
 *  Variable=12 (a class-body attribute — KEPT as a field). Function=11 is NOT a
 *  container, so a function's body-local Variables are structurally excluded
 *  from a class's member set (the shared descent only descends the container). */
export function pyVscodeSymbolRole(kind: unknown): SymbolRole {
  switch (kind) {
    case 4: // Class
      return "container";
    case 5: // Method
    case 11: // Function
      return "method";
    case 6: // Property
    case 7: // Field
    case 12: // Variable — a class attribute; KEPT as field
      return "field";
    default:
      return "other";
  }
}

/** Raw LSP SymbolKind (1-indexed) -> the documentSymbol role membersOfType needs.
 *  Class=5 is the container; members are Method=6, Property=7, Field=8, and
 *  Variable=13 (KEPT as a field). Function=12 is NOT a container. The vscode
 *  number PLUS ONE. */
export function pyLspSymbolRole(kind: unknown): SymbolRole {
  switch (kind) {
    case 5: // Class
      return "container";
    case 6: // Method
    case 12: // Function
      return "method";
    case 7: // Property
    case 8: // Field
    case 13: // Variable — a class attribute; KEPT as field
      return "field";
    default:
      return "other";
  }
}

// ---------------------------------------------------------------------------
// Enum base detection. Roslyn's C# hover says `enum Atlas.LodBand` in plain
// text, so csShapeHooks.enumMemberLine reads the TYPE off the hover. Pyright's
// class hover carries nothing of the kind — `(class) LodBand`, verified live
// against ~/repos/python-scratch/atlas_py/_core.py, byte for byte the same
// shape whether the class is a plain class, a dataclass, or an Enum subclass.
//
// documentSymbol's `kind` field looked like a substitute (Constant=14 for
// LodBand's CONTINENTAL/REGIONAL/MUNICIPAL/PARCEL, Variable=13 for
// StripeSummary's aggregate/tile_tally/bands_touched/label), but a second live
// probe against a synthetic fixture killed it: a PLAIN non-enum class's
// ALL_CAPS attribute (`MAX_RETRIES = 3`) and a dataclass field with no default
// at all (`MAX: int`) both come back Constant too — pyright's own member hover
// spells them `(constant) MAX_RETRIES: Literal[3]`, the identical shape to the
// real enum variant's `(constant) CONTINENTAL: Literal[0]`. And a REAL Enum
// subclass with lowercase variants (`class LowerEnum(Enum): continental = 0`)
// comes back Variable, same as an ordinary field. The kind is pyright's own
// ALL_CAPS naming heuristic, not an Enum signal, and using it would misrender
// a plain class's or a dataclass's screaming-case field as `Type.FIELD` —
// wrong, not merely absent.
//
// The one place Python's own truth survives is the declaration source itself:
// `class LodBand(IntEnum):`. It is syntax, not a heuristic, and the definition
// file is already open by the time this can be asked (crossFileShape.ts's
// walk opens it for the member fetch). Multi-line class headers are out of
// scope: a header this cannot find on one line resolves as "not an enum" —
// dark, not guessed.
// ---------------------------------------------------------------------------

const PY_ENUM_BASE_NAMES = new Set(["Enum", "IntEnum", "StrEnum", "Flag", "IntFlag", "ReprEnum"]);

/** True when `defLines` contains a single-line `class TypeName(...):` header
 *  whose base-class list names Enum / IntEnum / StrEnum / Flag / IntFlag /
 *  ReprEnum, bare or qualified (`enum.IntEnum`). See the block comment above
 *  for why this reads the source instead of a hover or an LSP kind. */
export function pyEnumBaseDecl(defLines: readonly string[], typeName: string): boolean {
  const escaped = typeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^\\s*class\\s+${escaped}\\s*\\(([^)]*)\\)\\s*:`);
  for (const line of defLines) {
    const match = header.exec(line);
    if (!match) {
      continue;
    }
    const bases = match[1].split(",").map((b) => b.trim().replace(/^enum\./, ""));
    return bases.some((b) => PY_ENUM_BASE_NAMES.has(b));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Docstring / hover parsing. A pyright hover (and a resolved completion item's
// documentation) is a ```python signature fence, then optionally `---` and doc
// prose, then optionally a bare ``` fence holding a `>>>` doctest. The three-way
// split: signature (the python fence) vs prose (doc) vs doctest.
// ---------------------------------------------------------------------------

interface PyFence {
  lang: string;
  body: string;
}

// Walk markdown once: the fenced blocks (lang + body), the `---` divider line,
// and the non-fence prose that sits after that divider. The doctest fence is a
// block, so prose never contains the `>>>` lines.
function scanPyMarkdown(markdown: string): { blocks: PyFence[]; proseAfterDivider: string } {
  const lines = markdown.split("\n");
  const blocks: PyFence[] = [];
  const proseAfter: string[] = [];
  let inFence = false;
  let lang = "";
  let body: string[] = [];
  let dividerSeen = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      if (!inFence) {
        inFence = true;
        lang = trimmed.slice(3).trim().toLowerCase();
        body = [];
      } else {
        inFence = false;
        blocks.push({ lang, body: body.join("\n") });
      }
      continue;
    }
    if (inFence) {
      body.push(line);
      continue;
    }
    if (!dividerSeen && line.trim() === "---") {
      dividerSeen = true;
      continue;
    }
    if (dividerSeen) {
      proseAfter.push(line);
    }
  }
  return { blocks, proseAfterDivider: proseAfter.join("\n").trim() };
}

// Extract the documentation `value` from an LSP MarkupContent / plain string.
function docValue(documentation: unknown): string | undefined {
  if (typeof documentation === "string") {
    return documentation;
  }
  if (
    documentation &&
    typeof documentation === "object" &&
    typeof (documentation as { value?: unknown }).value === "string"
  ) {
    return (documentation as { value: string }).value;
  }
  return undefined;
}

/** The signature pyright hangs on a RESOLVED completion item's `documentation`
 *  (captured live: NOT `detail`, which is undefined). It is the body of the
 *  first ```python fence — the ``` marker must never leak into the rendered
 *  signature. undefined when there is no documentation or no fence (the member
 *  then renders signature-less, never with an invented signature). Accepts the
 *  raw MarkupContent object or a plain string. */
export function pySignatureFromDocumentation(documentation: unknown): string | undefined {
  const value = docValue(documentation);
  if (value === undefined) {
    return undefined;
  }
  const { blocks } = scanPyMarkdown(value);
  // Prefer a python fence; fall back to the first bare fence (the sig always
  // leads, so a bare-only doc is only ever hit on a degenerate payload).
  const sig = blocks.find((b) => b.lang === "python")?.body ?? blocks.find((b) => b.lang === "")?.body;
  const trimmed = sig?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/** Parse a pyright hover's markdown into a HoverSurface: the ```python fence body
 *  is the signature, the prose below the `---` divider is doc (doctest removed —
 *  it rides its own fence, so prose never carries `>>>`), and a `>>>` doctest in
 *  any fence is the example. undefined when there is no fence at all (a prose-only
 *  or unresolved hover degrades to no surface, never a guess). */
export function parsePyHover(markdown: string): HoverSurface | undefined {
  const { blocks, proseAfterDivider } = scanPyMarkdown(markdown);
  const sigBlock = blocks.find((b) => b.lang === "python") ?? blocks.find((b) => b.lang === "");
  const signature = sigBlock?.body.trim();
  if (signature === undefined || signature.length === 0) {
    return undefined;
  }
  const surface: HoverSurface = { signature };
  if (proseAfterDivider.length > 0) {
    surface.doc = proseAfterDivider;
  }
  const doctestBlock = blocks.find((b) => b.body.includes(">>>"));
  if (doctestBlock) {
    const example = parsePyDoctest(doctestBlock.body);
    if (example !== undefined) {
      surface.example = example;
    }
  }
  return surface;
}

/** Partition a docstring into `{ prose, doctest }`: prose is everything before
 *  the first `>>>` line, the doctest is the runnable `>>>` run (markers stripped,
 *  undefined when absent). The three-way split's prose/doctest halves; the
 *  signature is the hover fence, parsed by parsePyHover. */
export function splitPyDocstring(text: string): { prose: string; doctest?: string } {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trimStart().startsWith(">>>"));
  if (start < 0) {
    return { prose: text.trim() };
  }
  const prose = lines.slice(0, start).join("\n").trim();
  const doctest = parsePyDoctest(text);
  return doctest !== undefined ? { prose, doctest } : { prose };
}

/** Extract the runnable doctest snippet from a docstring: the contiguous run of
 *  `>>>` prompt lines, their `...` continuations, and the expected-output lines,
 *  with the prompt markers stripped. A blank line terminates the run (classic
 *  doctest). undefined when there is no `>>>` at all — the condition on which
 *  example() lights (LIT iff a doctest rode the payload, never a
 *  source-kind guess). Takes the FIRST doctest run of a multi-block docstring. */
export function parsePyDoctest(docstring: string): string | undefined {
  const lines = docstring.split("\n");
  const start = lines.findIndex((l) => l.trimStart().startsWith(">>>"));
  if (start < 0) {
    return undefined;
  }
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trimStart();
    if (t === "") {
      break; // a blank line ends the doctest example
    }
    if (t.startsWith(">>>") || t.startsWith("...")) {
      // Strip the prompt marker and the single space that follows it.
      out.push(t.slice(3).replace(/^ /, ""));
    } else {
      out.push(t); // an expected-output line, kept verbatim
    }
  }
  const snippet = out.join("\n").trim();
  return snippet.length > 0 ? snippet : undefined;
}

// ---------------------------------------------------------------------------
// Member builders. Both transports render through these so a member is
// byte-identical whichever transport produced it (the parity bar).
// ---------------------------------------------------------------------------

/** Build a Python CompletionMember from a completion label + the resolved item's
 *  documentation + mapped kind. The name is the label verbatim (what a model
 *  types); the signature is the ```python fence body in the documentation (see
 *  pySignatureFromDocumentation), rendered for every kind because a Python
 *  attribute's type annotation is as load-bearing as a method's signature.
 *  viaTrait is never set — Python has no trait provenance. A member with no
 *  resolved documentation carries NO invented signature.
 *
 *  A dunder is stamped tier 1 — the universal blanket every object grows, the
 *  Python spelling of the server-relevance tier (`CompletionMember.tier`).
 *  Both completion transports drop dunders before this builder today, so the
 *  stamp changes no current surface; it is the classifier of record should a
 *  dunder ever reach one. */
export function toPyCompletionMember(
  label: string,
  documentation: unknown,
  kind: MemberKind,
): CompletionMember {
  const member: CompletionMember = { name: label.trim(), kind };
  const signature = pySignatureFromDocumentation(documentation);
  if (signature !== undefined) {
    member.signature = signature;
  }
  if (isDunder(member.name)) {
    member.tier = 1;
  }
  return member;
}

/** Pylance's quickinfo kind annotation (`(method) `, `(property) `,
 *  `(variable) `). UI text, not part of any declaration. */
const PY_KIND_CHROME = /^\([a-z][a-z ]*\)\s*/;

/** The first parameter a caller never supplies. `Tile(1, 0)` passes two
 *  arguments to a `__init__` whose signature lists three, so a construction
 *  block that prints the receiver states an arity nobody can write. */
const PY_IMPLICIT_RECEIVER = /^(?:self|cls)\b/;

/** Slice a member's own declaration out of a Pylance quickinfo or a pyright
 *  symbol detail, in the form a caller could type:
 *  `(method) def __init__(self: Self@Tile, morton_code: int, lod: int) -> None`
 *  -> `__init__(morton_code: int, lod: int) -> None`,
 *  `(property) band: (self: Self@Tile) -> LodBand` -> `band: LodBand`,
 *  `(variable) _lod: int` -> `_lod: int`.
 *
 *  `Self@Tile` is Pylance's UI notation for the receiver's own type and is not
 *  Python at any point; the same annotation written in source is `Tile`.
 *
 *  A display that does not state the name declaration-style yields undefined,
 *  and the member keeps its bare name. That is the deliberate floor: this text
 *  is injected under a header claiming it is how the type is built, so a
 *  best-effort reshaping of something unrecognised would be an invention with a
 *  language server's authority behind it. */
export function renderPyMemberSignature(name: string, display: string | undefined): string | undefined {
  if (display === undefined) {
    return undefined;
  }
  const bare = name.trim();
  if (bare.length === 0) {
    return undefined;
  }
  const text = display
    .replace(PY_KIND_CHROME, "")
    .replace(/\bSelf@/g, "")
    .replace(/^(?:async\s+)?def\s+/, "")
    .trim();
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The name must be followed by `(` or `:` so a same-named qualifier cannot
  // win the slice, matching the rule the TypeScript renderer holds.
  const declared = new RegExp(`(?:^|[.\\s])(${escaped}\\s*[(:][\\s\\S]*)$`).exec(text);
  if (!declared) {
    return undefined;
  }
  const decl = declared[1].trim();
  const open = decl.indexOf("(");
  const colon = decl.indexOf(":");
  return open >= 0 && (colon < 0 || open < colon)
    ? dropImplicitReceiver(decl, open)
    : collapseBoundProperty(decl, colon);
}

function dropImplicitReceiver(decl: string, open: number): string | undefined {
  const close = matchingParen(decl, open);
  if (close < 0) {
    return undefined;
  }
  const params = splitTopLevel(decl.slice(open + 1, close));
  const kept = params.length > 0 && PY_IMPLICIT_RECEIVER.test(params[0]) ? params.slice(1) : params;
  return `${decl.slice(0, open)}(${kept.join(", ")})${decl.slice(close + 1)}`.trim();
}

/** Pylance describes a property as the getter behind it:
 *  `band: (self: Tile) -> LodBand`. Read literally that says `band` is callable
 *  and the model writes `t.band()`. The bound receiver is what identifies the
 *  shape — a genuine callable-typed attribute has no `self` — so only that form
 *  collapses to the type the property actually has. */
function collapseBoundProperty(decl: string, colon: number): string | undefined {
  if (colon < 0) {
    return undefined;
  }
  const rest = decl.slice(colon + 1).trim();
  const close = rest.startsWith("(") ? matchingParen(rest, 0) : -1;
  if (close < 0) {
    return decl;
  }
  const returned = rest.slice(close + 1).trim();
  const params = splitTopLevel(rest.slice(1, close));
  if (!returned.startsWith("->") || params.length !== 1 || !PY_IMPLICIT_RECEIVER.test(params[0])) {
    return decl;
  }
  return `${decl.slice(0, colon).trim()}: ${returned.slice(2).trim()}`;
}

/** Index of the `)` closing the `(` at `open`, or -1. Brackets nest through
 *  annotations (`Dict[str, Callable[[int], None]]`), so depth is counted over
 *  all three pairs rather than parens alone. */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        return c === ")" ? i : -1;
      }
    }
  }
  return -1;
}

/** Split a parameter list on the commas that are not inside a nested group.
 *  `Dict[str, int]` is one parameter, not two. */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Build a Python CompletionMember from a documentSymbol child's raw name +
 *  detail + mapped kind — the SymbolMemberBuilder membersFromDocumentSymbols
 *  calls for the Python transports. The pyright symbol name is already the bare
 *  member (`fetch`, `name`), so it passes through trimmed. Pylance leaves detail
 *  empty on documentSymbol, so this builder is also fed hover-derived quickinfo
 *  by the product transport's backfill; both go through the same renderer, and
 *  a display that does not declare this member leaves it bare.
 *  viaTrait is never set. */
export function toPySymbolMember(
  label: string,
  detail: string | undefined,
  kind: MemberKind,
): CompletionMember {
  const name = label.trim();
  const member: CompletionMember = { name, kind };
  const rendered = renderPyMemberSignature(name, detail);
  if (rendered !== undefined && rendered.length > 0 && rendered !== name) {
    member.signature = rendered;
  }
  return member;
}

// ---------------------------------------------------------------------------
// Rung 2 (the column-80-owned deterministic import inserter) pure mechanism.
// The ladder is ORCHESTRATED in the repair layer (src/vscode/oracleSurface.ts);
// this module delivers the pieces: this helper + the stdlib module set. The
// rung-2 case is
// specifically an undefined NAME that IS a known TOP-LEVEL module (`import numpy`);
// symbol-level imports (`from pathlib import Path`) are rungs 1/3.
// ---------------------------------------------------------------------------

/** The typeshed stdlib top-level module names, the always-available half of the
 *  rung-2 module universe (unioned with the venv's top-level packages from
 *  PyOracle.catalog at the repair layer). A static set so rung 2 covers stdlib
 *  with no venv and no spawn. Not exhaustive of every obscure stdlib module, but
 *  covers the importable top-level names a generation is likely to reach for. */
export const PY_STDLIB_MODULES: ReadonlySet<string> = new Set([
  "abc", "argparse", "ast", "asyncio", "base64", "bisect", "calendar", "cmath",
  "collections", "concurrent", "configparser", "contextlib", "copy", "csv",
  "ctypes", "dataclasses", "datetime", "decimal", "difflib", "dis", "doctest",
  "email", "enum", "errno", "faulthandler", "filecmp", "fileinput", "fnmatch",
  "fractions", "functools", "gc", "getopt", "getpass", "gettext", "glob",
  "graphlib", "gzip", "hashlib", "heapq", "hmac", "html", "http", "imaplib",
  "importlib", "inspect", "io", "ipaddress", "itertools", "json", "keyword",
  "linecache", "locale", "logging", "lzma", "mailbox", "math", "mimetypes",
  "mmap", "multiprocessing", "numbers", "operator", "os", "pathlib", "pickle",
  "pkgutil", "platform", "plistlib", "poplib", "pprint", "profile", "pstats",
  "pty", "queue", "random", "re", "reprlib", "sched", "secrets", "select",
  "selectors", "shelve", "shlex", "shutil", "signal", "site", "smtplib",
  "socket", "socketserver", "sqlite3", "ssl", "stat", "statistics", "string",
  "stringprep", "struct", "subprocess", "sys", "sysconfig", "tarfile",
  "tempfile", "textwrap", "threading", "time", "timeit", "tkinter", "token",
  "tokenize", "traceback", "tracemalloc", "types", "typing", "unicodedata",
  "unittest", "urllib", "uuid", "venv", "warnings", "wave", "weakref",
  "webbrowser", "xml", "xmlrpc", "zipfile", "zipimport", "zlib", "zoneinfo",
]);

/** The 0-based line at which an `import` may be safely inserted: PAST the module
 *  prologue that must stay first — an optional shebang, a leading module
 *  docstring, and any `from __future__ import ...` block. Line 0 is NOT the
 *  imports region when any of those open the file: an import before a
 *  `from __future__` import is a hard SyntaxError, and an import before the module
 *  docstring silently demotes it (the docstring becomes a bare expression). Pure
 *  over the file text; comments/blanks are trivia. The insertion lands right after
 *  the last MANDATORY-first element (the docstring, or the `__future__` block when
 *  present), never after trailing comments that belong to the code below. */
export function pyImportInsertLine(fileText: string): number {
  const lines = fileText.split("\n");
  const isTrivia = (l: string): boolean => {
    const t = l.trim();
    return t === "" || t.startsWith("#");
  };
  const parenDelta = (l: string): number =>
    (l.match(/\(/g)?.length ?? 0) - (l.match(/\)/g)?.length ?? 0);

  let i = 0;
  // (a) A shebang, only meaningful on line 0.
  if (i < lines.length && lines[i].startsWith("#!")) {
    i++;
  }
  // Trivia before the docstring.
  while (i < lines.length && isTrivia(lines[i])) {
    i++;
  }
  // (b) A module docstring: the first statement, a string literal. Handles the
  // triple-quoted (single- or multi-line) and single-line-quoted forms, with an
  // optional r/u/b/f string prefix.
  if (i < lines.length) {
    const t = lines[i].trimStart();
    const m = /^[rRuUbBfF]{0,2}("""|'''|"|')/.exec(t);
    if (m) {
      const quote = m[1];
      const afterOpen = t.slice(m[0].length);
      if ((quote === '"""' || quote === "'''") && !afterOpen.includes(quote)) {
        i++; // multi-line: scan to the closing delimiter
        while (i < lines.length && !lines[i].includes(quote)) {
          i++;
        }
      }
      i++; // past the (single-line, or closing) docstring line
    }
  }
  // (c) A `from __future__ import ...` run. Only COMMIT the insertion point past
  // it when a future import is actually there (look through trivia, but never
  // advance past trailing comments when no future import follows).
  let insertAt = i;
  let j = i;
  while (j < lines.length && isTrivia(lines[j])) {
    j++;
  }
  while (j < lines.length && /^\s*from\s+__future__\s+import\b/.test(lines[j])) {
    let open = parenDelta(lines[j]);
    j++;
    while (open > 0 && j < lines.length) {
      open += parenDelta(lines[j]);
      j++;
    }
    insertAt = j; // commit: the import lands after this future block
    while (j < lines.length && isTrivia(lines[j])) {
      j++;
    }
  }
  return insertAt;
}

/** The imports-region edit rung 2 would apply for an undefined NAME: `import
 *  <name>` at the imports region, IF AND ONLY IF `name` is exactly one top-level
 *  module in `moduleUniverse`. undefined when the name matches none (not a known
 *  top-level module — a symbol-level import is rungs 1/3) or when it appears more
 *  than once (genuinely ambiguous: two DISTINCT sources provide the same
 *  top-level name — the helper never picks one). `moduleUniverse` is a flat list
 *  of top-level names (PY_STDLIB_MODULES unioned with the venv catalog); the
 *  caller dedups a stdlib/venv collision that yields the SAME edit before calling
 *  if it wants that to count as unambiguous. `fileText` places the edit past the
 *  module prologue (see pyImportInsertLine); the repair layer passes the
 *  live buffer. Defaults to "" (line 0) for a plain file with no prologue. */
export function pyOwnedImportEdit(
  name: string,
  moduleUniverse: readonly string[],
  fileText = "",
): QualifyEditShape | undefined {
  const hits = moduleUniverse.filter((m) => m === name);
  if (hits.length !== 1) {
    return undefined; // no match (rungs 1/3) or ambiguous (two sources) -> dark
  }
  const line = pyImportInsertLine(fileText);
  return {
    range: { startLine: line, startCharacter: 0, endLine: line, endCharacter: 0 },
    newText: `import ${name}\n`,
  };
}

// The QualifyEdit shape, re-declared locally so this pure module need not import
// the interface just for a return type. Structurally identical to QualifyEdit.
interface QualifyEditShape {
  range: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
  newText: string;
}

// ---------------------------------------------------------------------------
// Rung 3 (Pylance / pyright auto-import code action) title match. Enrichment
// only, never load-bearing (closed-source Pylance internals carry no invariant).
// ---------------------------------------------------------------------------

/** True when a code-action title is an auto-import action for a symbol: Pylance /
 *  pyright render these as `Add "from models import X"` or `Add "import numpy"`.
 *  A non-import action ("Create function", "Add # type: ignore") is rejected. The
 *  title carries the module, so ambiguity is counted over DISTINCT titles (two
 *  modules resolving the name -> no edit) — the C# distinct-title rule. */
export function isPyAutoImportTitle(title: string): boolean {
  return /^Add\s+"(?:from\s+\S+\s+)?import\s+.+"$/.test(title.trim());
}

// ---------------------------------------------------------------------------
// Type-generation kind classification (v12). pyright reports SymbolKind.Class
// for a plain class, a @dataclass, AND an Enum subclass alike (scout-py.md Q1),
// so the resolved kind cannot tell them apart. The SOUND signal is the base
// list: an Enum subclass names an enum base. Children-kind is NOT used — it is
// unsound (a plain class with an ALL-CAPS `RED = 1` reports the child as
// Constant, identical to an enum member; scout-py.md 2c).
// ---------------------------------------------------------------------------

const PY_ENUM_BASES = new Set(["Enum", "IntEnum", "StrEnum", "Flag", "IntFlag"]);

/** Classify a Python class HEADER — the decorator line(s) from the symbol's
 *  range.start through the `class NAME(bases):` line at its selectionRange.start
 *  — as a type-gen kind. Returns "enum" when any base in the `(...)` list is an
 *  enum base (Enum/IntEnum/StrEnum/Flag/IntFlag, a dotted form like `enum.Enum`,
 *  or any base name ending in `Enum`), else "class". It reads the BASE, never the
 *  class name (`class Enumerable(Sequence)` is a class), and tolerates whitespace,
 *  a base list wrapped across lines, and a `metaclass=`/other keyword arg. A class
 *  with no base list is "class". */
export function pyTypeGenKind(headerLines: readonly string[]): "class" | "enum" {
  const header = headerLines.join("\n");
  const open = header.indexOf("(");
  if (open === -1) {
    return "class"; // no base list — a plain class
  }
  // The matching close paren by depth, so a `(...)` nested inside a base
  // expression or a keyword-arg value never ends the base list early.
  let depth = 0;
  let close = header.length;
  for (let i = open; i < header.length; i++) {
    if (header[i] === "(") {
      depth++;
    } else if (header[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  for (const raw of header.slice(open + 1, close).split(",")) {
    const base = raw.trim();
    if (base === "" || base.includes("=")) {
      continue; // an empty slot or a keyword arg (metaclass=..., etc.)
    }
    const name = base.split(".").pop() ?? base; // enum.Enum -> Enum
    if (PY_ENUM_BASES.has(name) || name.endsWith("Enum")) {
      return "enum";
    }
  }
  return "class";
}

// ---------------------------------------------------------------------------
// Indentation-aware body re-indent (v12). Type/function generation hands the
// model a DEDENTED header (the signature sliced to column 0) and the model
// replies at column 0. Splicing that at a NESTED target (an indented header)
// lands every body line under-indented -> Python IndentationError. Re-indent the
// generated text to the target's own indent. Triple-quoted-string aware: a line
// inside a multi-line string is left byte-exact, because prefixing it would
// silently change the string's value (the scout Q3 mechanic, done soundly).
// ---------------------------------------------------------------------------

interface PyStringScan {
  /** The open triple-quote delimiter (`"""` or `'''`) if a multi-line string is
   *  in progress at the current point, else undefined. */
  triple: string | undefined;
  /** The quote of a single-quoted string carried to the next line via a trailing
   *  backslash-newline continuation (`x = "abc\` … `def"`), else undefined. A
   *  continuation line is string content and must not be re-indented. */
  single: string | undefined;
  /** Open `(`/`[`/`{` depth at this point. A line that STARTS at depth > 0 is
   *  inside a bracketed continuation, where Python allows any column at all, so
   *  its indentation says nothing about where the block sits. */
  depth: number;
  /** True when the line just scanned ended in a backslash continuation, so the
   *  next line's column is likewise arbitrary. */
  continued: boolean;
}

// Advance the line state across one line of Python source. It tracks
// `"""`/`'''` open/close (single- and multi-line), steps over single-line string
// contents (so a `"""` inside a `"..."` is not read as an opener) and a `#`
// comment (which runs to end of line), and counts bracket depth over the code it
// walks past. Not a full lexer — the two properties it must get right are a
// correct "inside a multi-line string" flag and a correct "inside a bracketed
// continuation" flag at each line start; raw/f/byte prefixes still delimit with
// the same quote chars.
function scanPyStringState(line: string, state: PyStringScan): void {
  let i = 0;
  state.continued = false;
  while (i < line.length) {
    if (state.single !== undefined) {
      // Continuing a single-quoted string across a backslash-newline. Find its
      // close honoring escapes; a further trailing `\` continues it again.
      const q = state.single;
      let closed = false;
      while (i < line.length) {
        if (line[i] === "\\") {
          i += 2;
          continue;
        }
        if (line[i] === q) {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return; // still continued past this line
      }
      state.single = undefined;
      continue;
    }
    if (state.triple !== undefined) {
      // Find the closing delimiter honoring backslash escapes, so an escaped
      // `\"""` inside the string does NOT read as a close (which would re-indent
      // the string's continuation as code and silently change its value). A raw
      // string (r"""...""") would not honor the escape, but detecting the `r`
      // prefix is beyond this line-local scan — a documented edge (scraps).
      while (i < line.length) {
        if (line[i] === "\\") {
          i += 2;
          continue;
        }
        if (line.startsWith(state.triple, i)) {
          i += 3;
          state.triple = undefined;
          break;
        }
        i++;
      }
      if (state.triple !== undefined) {
        return; // the multi-line string continues past this line
      }
      continue;
    }
    const three = line.slice(i, i + 3);
    if (three === '"""' || three === "'''") {
      const close = line.indexOf(three, i + 3);
      if (close === -1) {
        state.triple = three; // opens here, continues to a later line
        return;
      }
      i = close + 3; // a single-line triple string, opened and closed
      continue;
    }
    const ch = line[i];
    if (ch === "#") {
      return; // a comment runs to end of line
    }
    if (ch === '"' || ch === "'") {
      i++;
      let closed = false;
      while (i < line.length) {
        if (line[i] === "\\") {
          i += 2;
          continue;
        }
        if (line[i] === ch) {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        // A single-line string not closed on this line — in valid Python it was
        // continued by a trailing `\` (an unterminated string with no `\` is a
        // syntax error the buffer would already reject). Carry it to the next
        // line so the continuation is treated as string content, not code.
        state.single = ch;
        return;
      }
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      state.depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      state.depth = Math.max(0, state.depth - 1);
    }
    i++;
  }
  // Reached end of line as CODE (a comment or an open string returned early, and
  // neither can carry a backslash continuation of a statement).
  state.continued = line.trimEnd().endsWith("\\");
}

interface PyLineRoles {
  /** Re-indentable: not blank, and not inside a multi-line string, whose bytes
   *  must never move. */
  isCode: boolean[];
  /** Starts a statement at the block's own depth, so its column MEANS something.
   *  False for a comment (Python lets a `#` sit at any column), for a line inside
   *  a bracketed continuation, and for one carried over by a trailing backslash:
   *  the language allows those at any column too, so a base measured off them is
   *  measured off nothing. */
  isStatement: boolean[];
}

/** Classify every line of a generated block once, so the dedent and the
 *  re-indent below agree on all of them. */
function pyLineRoles(lines: readonly string[]): PyLineRoles {
  const state: PyStringScan = { triple: undefined, single: undefined, depth: 0, continued: false };
  const isCode: boolean[] = [];
  const isStatement: boolean[] = [];
  for (const line of lines) {
    const insideString = state.triple !== undefined || state.single !== undefined;
    const code = !insideString && line.trim() !== "";
    const free = state.depth > 0 || state.continued;
    isCode.push(code);
    isStatement.push(code && !free && !isPyCommentLine(line));
    scanPyStringState(line, state);
  }
  return { isCode, isStatement };
}

/** The whitespace the selected lines all start with, as a shared PREFIX rather
 *  than a column count: a tab-indented reply and a space-indented one have no
 *  common prefix and are left alone, because guessing a tab width is how a
 *  dedent eats a level it did not own. undefined when nothing was selected. */
function pyCommonIndent(
  lines: readonly string[],
  selected: (n: number) => boolean,
): string | undefined {
  let prefix: string | undefined;
  for (let n = 0; n < lines.length; n++) {
    if (!selected(n)) {
      continue;
    }
    const ws = /^[ \t]*/.exec(lines[n])?.[0] ?? "";
    if (prefix === undefined) {
      prefix = ws;
    } else {
      let i = 0;
      while (i < prefix.length && i < ws.length && prefix[i] === ws[i]) {
        i++;
      }
      prefix = prefix.slice(0, i);
    }
    if (prefix === "") {
      return "";
    }
  }
  return prefix;
}

/** True when the line is a `#` comment rather than a statement. */
function isPyCommentLine(line: string): boolean {
  return line.trimStart().startsWith("#");
}

/** The block's own column zero: the whitespace its STATEMENTS share.
 *
 *  Only statements, because every other line class is free to sit at any column
 *  Python likes — a `#` comment, a line inside an open bracket, a backslash
 *  continuation — and one of them at column 0 collapses the shared prefix to
 *  nothing, handing the whole block back at its original depth. That is the
 *  double indent this dedent exists to kill. The same rule scaffold.ts's
 *  pyBodyIndent holds, for the same reason. A block with no statement at all
 *  (a pure comment sketch) has only its comments to measure. */
function pyBlockBaseIndent(lines: readonly string[], roles: PyLineRoles): string {
  return (
    pyCommonIndent(lines, (n) => roles.isStatement[n]) ??
    pyCommonIndent(lines, (n) => roles.isCode[n]) ??
    ""
  );
}

/** Re-indent a generated Python definition so a nested target's body lands at
 *  the right column. `indent` is the leading whitespace of the target's header
 *  line. The first line (the header) is left as-is — it lands after the indent
 *  the document already holds before the span start. Every LATER line that is
 *  code (not inside a multi-line string, not blank) gets `indent` prepended; a
 *  line inside a triple-quoted string is byte-exact so its value never shifts.
 *  `indent === ""` (a top-level target) returns the text unchanged, byte for
 *  byte — so top-level generation is untouched.
 *
 *  A model shown an indented target answers with an indented DEFINITION, and
 *  prepending `indent` to that lands the whole thing a level deep. The header
 *  line is the anchor: whatever whitespace it carries is the reply's own column
 *  zero and is stripped off every code line before the target's indent goes on.
 *  A flush-left reply (the common one) strips nothing. */
export function reindentPyBody(generated: string, indent: string): string {
  if (indent === "") {
    return generated;
  }
  const lines = generated.split("\n");
  const roles = pyLineRoles(lines);
  // The head is the first STATEMENT, not merely the first line with something on
  // it. A `#` above the declaration may sit at any column Python allows, and read
  // as the reply's base it puts the header and its body on the SAME column:
  // `IndentationError: expected an indented block`. The postprocess re-anchors
  // every whole-definition reply at its declaration head today, so a comment ahead
  // of one does not arrive. "It cannot arrive" is the argument that deletes a
  // guard, and this leg is the wrong place to take that bet: the block leg holds
  // the same statements-only rule for the same reason.
  const head = roles.isStatement.indexOf(true);
  const base = replyBaseIndent(head === -1 ? lines : [lines[head]]);
  const out: string[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (n === 0) {
      out.push(withoutBase(line, base));
    } else if (!roles.isCode[n]) {
      out.push(line);
    } else {
      out.push(indent + withoutBase(line, base));
    }
  }
  return out.join("\n");
}

/** Re-indent a generated Python BODY BLOCK (no header line) so every statement
 *  lands at `indent`. The body-only sibling of reindentPyBody: there is no header
 *  to skip, so EVERY non-blank code line gets `indent` prepended, string-aware
 *  (a line inside a multi-line string is byte-exact). Used when generation writes
 *  the body BELOW a preserved docstring (Fork A) — `indent` is the target's body
 *  column (header indent + 4). Relative indentation inside the body is preserved.
 *
 *  The block is DEDENTED to its own column zero first. The prompt shows the model
 *  a written header and docstring and asks for the body below them, and a model
 *  that answers in place — every statement indented under that header — is
 *  obeying the instruction. Prepending `indent` to those bytes is what put the
 *  body a level too deep in the file. The shallowest code line is the block's
 *  column zero; the shape below it keeps its relative depth. A flush-left reply
 *  strips nothing and lands exactly as before. */
export function reindentPyBlock(generated: string, indent: string): string {
  if (indent === "") {
    return generated;
  }
  const lines = generated.split("\n");
  const roles = pyLineRoles(lines);
  const own = pyBlockBaseIndent(lines, roles);
  const out: string[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!roles.isCode[n]) {
      out.push(line);
      continue;
    }
    // A line that does not carry the block's base is one Python let sit at a
    // column of its own: a hung comment, or a line inside an open bracket
    // (statements all carry the base by construction). There is no depth
    // relative to the base to preserve, so it lands ON the body column.
    const body = line.startsWith(own) ? line.slice(own.length) : line.trimStart();
    out.push(indent + body);
  }
  return out.join("\n");
}

/** One level, for the one case below where Python's column has to be chosen
 *  rather than measured. PEP 8's step. */
const PY_STEP = "    ";

/** True when the line is a `def`/`class` header that opens its block on the NEXT
 *  physical line: a definition keyword leads, and nothing but a comment follows
 *  the header's depth-0 colon. A one-liner (`def f(): return 1`) opens no block
 *  below it, and a header split across lines has no depth-0 colon yet — it opens
 *  the block on a later line, which is enough. */
function pyOpensDefBlock(line: string): boolean {
  const text = line.trim();
  if (!/^(async\s+def|def|class)\b/.test(text)) {
    return false;
  }
  const colon = pyHeaderColonIndex(text);
  if (colon === -1) {
    return true;
  }
  const after = text.slice(colon + 1).trim();
  return after === "" || after.startsWith("#");
}

/** Normalise Python code read out of a document to its own column zero, the
 *  inverse of reindentPyBody and reindentPyBlock. A line inside a multi-line
 *  string is byte-exact, decided by the SAME pyLineRoles pass both re-indent
 *  legs use, so the two directions can never disagree about which bytes are a
 *  string's value.
 *
 *  Python needs one correction its braced siblings do not. The shared rule reads
 *  the base off the lines BELOW the head, which works because a braced language
 *  puts a closing brace back at the head's own column. A `def` has no closing
 *  token: every line below it is strictly deeper, so the measured base is the
 *  BODY's column, and stripping it lands the body level with its own header —
 *  `IndentationError: expected an indented block`, worse than the double indent
 *  this exists to kill. The header's column was stripped by the span and Python
 *  leaves nothing to recover it from, so the body is re-anchored one step under
 *  its header. A file indented at some other width has that one span normalised
 *  to four, which is the price of the missing column; the shape INSIDE the body
 *  keeps its own relative depth either way.
 *
 *  The correction fires only when the head really does open a block below it and
 *  the measured base flattened that block. A body-only span (Fork A) leads with
 *  an ordinary statement, and a body that happens to lead with a nested `def`
 *  has its siblings back at the head's column, so neither is touched. */
export function dedentPyBody(code: string, known?: string): string {
  const lines = code.split("\n");
  const roles = pyLineRoles(lines);
  const flat = dedentToZeroBase(lines, lines.map((_, n) => !roles.isCode[n]), known);
  // A KNOWN base is the header's real column, so the body keeps whatever step
  // the file actually uses and there is nothing to re-anchor. The re-anchor
  // below exists only for the inferred case, where the step is unrecoverable.
  //
  // NO PRODUCT PATH reaches it (review D6): both callers in oracleSurface.ts
  // always supply a base, and `resolveFunctionAtCursor` always sets
  // headerIndent/bodyIndent to a string. So the price the re-anchor pays - a
  // file indented at some other width has that one span normalised to four - is
  // paid by tests and by the measurement harness only, and the harness hardcodes
  // rust. Kept because the inferred path is a documented public contract and a
  // caller that does not hold the column still needs an answer that parses.
  if (known !== undefined) {
    return flat.join("\n");
  }
  const head = roles.isCode.indexOf(true);
  const next = head === -1 ? -1 : roles.isCode.indexOf(true, head + 1);
  if (next === -1 || !pyOpensDefBlock(flat[head]) || /^[ \t]/.test(flat[next])) {
    return flat.join("\n");
  }
  return flat
    .map((line, n) => (n > head && roles.isCode[n] ? PY_STEP + line : line))
    .join("\n");
}

// ---------------------------------------------------------------------------
// The Python docstring is the doc-comment-is-the-instruction channel — the
// analog of Rust's `///`, but INSIDE the body as its first statement (v13). The
// leading docstring is read as the spec and preserved byte-exact OUTSIDE the
// generated span (Fork A). These pure helpers locate it and clean it for the
// prompt; the buffer copy is never touched (the span excludes it).
// ---------------------------------------------------------------------------

const PY_DOCSTRING_OPENER = /^[rRuUbBfF]{0,2}("""|'''|"|')/;

/** Index of the `:` that ends a Python def/class header, at bracket depth 0, or
 *  -1. The same depth-0 scan pySignatureFromSpanText uses (a param annotation `:`
 *  or a `Dict[str, int]` subscript is at depth > 0 and never terminates). */
function pyHeaderColonIndex(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1);
    } else if (c === ":" && depth === 0) {
      return i;
    }
  }
  return -1;
}

/** Locate the leading docstring inside a Python def/class SPAN TEXT (the text of
 *  headStart..range.end — header line(s) + body, beginning at `def`/`class` with
 *  no leading indent). Returns the `[start,end)` offsets of the docstring literal
 *  WITHIN spanText (prefix + quotes included) and whether it sits on the header's
 *  physical line (the one-liner shape). Returns undefined when the body's first
 *  statement is not a string literal (no docstring: code / `pass` / `...`). */
export function pyLeadingDocstring(
  spanText: string,
): { start: number; end: number; sameLineAsHeader: boolean } | undefined {
  const colon = pyHeaderColonIndex(spanText);
  if (colon === -1) {
    return undefined;
  }
  // Skip body trivia after the colon: whitespace and `#` comments (a comment is
  // not a statement, so a `#` line before the docstring is correctly skipped).
  let i = colon + 1;
  while (i < spanText.length) {
    const c = spanText[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
    } else if (c === "#") {
      const nl = spanText.indexOf("\n", i);
      if (nl === -1) {
        return undefined;
      }
      i = nl + 1;
    } else {
      break;
    }
  }
  const opener = PY_DOCSTRING_OPENER.exec(spanText.slice(i));
  if (!opener) {
    return undefined; // the first statement is code / pass / ... — no docstring
  }
  const start = i;
  const quote = opener[1];
  const openEnd = i + opener[0].length; // just past the opening quote
  let end: number;
  if (quote === '"""' || quote === "'''") {
    // Escape-aware forward scan (mirrors scanPyStringState), so an escaped `\"""`
    // inside the docstring does NOT read as the close — otherwise the tail of the
    // docstring falls in the generation span and is eaten (review MAJOR 2). The
    // raw-string `r"""...\"""` edge stays a documented limitation, as elsewhere.
    let j = openEnd;
    let closed = false;
    while (j < spanText.length) {
      if (spanText[j] === "\\") {
        j += 2;
        continue;
      }
      if (spanText.startsWith(quote, j)) {
        j += 3;
        closed = true;
        break;
      }
      j++;
    }
    if (!closed) {
      return undefined; // unterminated
    }
    end = j;
  } else {
    // A single-line string: find the matching quote on the same line, honoring
    // backslash escapes; a newline before it means it is not a docstring.
    let j = openEnd;
    let closed = false;
    while (j < spanText.length) {
      const c = spanText[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "\n") {
        break;
      }
      if (c === quote) {
        j++;
        closed = true;
        break;
      }
      j++;
    }
    if (!closed) {
      return undefined;
    }
    end = j;
  }
  return { start, end, sameLineAsHeader: !spanText.slice(colon, start).includes("\n") };
}

/** True when the leading docstring is written as implicit string concatenation —
 *  another string literal is syntactically adjacent to the one ending at `end`
 *  (`"a " "b"` on one line, or `"a " \` newline `"b"`). Python joins them into one
 *  docstring, but pyLeadingDocstring returns only the first literal, so Fork A
 *  would leave the trailing fragment(s) inside the generation span and eat them.
 *  Adjacency is same-logical-line: inline whitespace and `\`-newline
 *  continuations are skipped, but a bare newline ends the statement (a string on
 *  the next line is a separate expression, not part of the docstring). The
 *  command refuses this shape rather than silently dropping half the human's
 *  spec (review MAJOR). */
export function pyDocstringHasAdjacentLiteral(spanText: string, end: number): boolean {
  let k = end;
  while (k < spanText.length) {
    const c = spanText[k];
    if (c === " " || c === "\t" || c === "\r") {
      k++;
    } else if (c === "\\" && spanText[k + 1] === "\n") {
      k += 2;
    } else {
      break;
    }
  }
  return PY_DOCSTRING_OPENER.test(spanText.slice(k));
}

/** The docstring's INNER text for the PROMPT: the `r`/`f`/`b` prefix and the
 *  quotes stripped, then PEP-257 dedented (the summary line trimmed, and the
 *  common leading whitespace removed from the remaining lines). `literal` is the
 *  raw docstring pyLeadingDocstring sliced out. The BUFFER docstring is preserved
 *  byte-exact and separate — this cleaned form is ONLY what the model reads,
 *  mirroring how Rust `///` reaches the prompt as prose with its markers gone. */
export function stripPyDocstring(literal: string): string {
  const opener = PY_DOCSTRING_OPENER.exec(literal);
  if (!opener) {
    return literal.trim();
  }
  const quote = opener[1];
  let inner = literal.slice(opener[0].length);
  if (inner.endsWith(quote)) {
    inner = inner.slice(0, inner.length - quote.length);
  }
  const lines = inner.split("\n");
  const first = lines[0].trim();
  const rest = lines.slice(1);
  let minIndent = Infinity;
  for (const l of rest) {
    if (l.trim() === "") {
      continue;
    }
    minIndent = Math.min(minIndent, l.length - l.trimStart().length);
  }
  if (!isFinite(minIndent)) {
    minIndent = 0;
  }
  const dedented = rest.map((l) => l.slice(minIndent).replace(/\s+$/, ""));
  return [first, ...dedented].join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

