/**
 * The five language profiles Criticize reads code through.
 *
 * WHAT A PROFILE MAY CONTAIN, ruled 2026-08-29 and recorded in the amendment
 * at the end of session-v64/goal.md. Every pattern here describes the
 * LANGUAGE'S OWN SYNTAX: how a comment opens, how a string that spans lines is
 * spelled, how a parameter list is written, what enforces a precondition, what
 * writes to state that outlives the call. That syntax is fixed and published,
 * and it does not vary with what the developer imported.
 *
 * What a profile may NOT contain is a name table for a third party's API. The
 * honesty block used to carry four of those per language, naming the library
 * calls someone had thought to write down, plus a fifth naming logging calls.
 * They decided dimensions 1 to 4, and a row that read `clean` meant only that
 * none of the listed spellings appeared. All of it is gone; a model reads the
 * function instead, in `criticizeHonestyModel.ts`.
 *
 * The registry is oracleFor's pattern, copied because it has survived five
 * languages: a strategy list, `undefined` for an unregistered language so the
 * caller refuses by NAMING the language rather than falling back to a guess.
 *
 * WHAT THE RATES ARE AND ARE NOT. Every rate quoted below is a SIGNAL rate on
 * code the repo already considers good, measured by the scout across five real
 * corpora. It says the channel is quiet. It says nothing about whether any one
 * flag is correct; no detector's precision has been measured yet, and until a
 * labelled set says otherwise, nothing here may claim it.
 *
 * Never imports vscode (the src/core rule).
 */

import {
  CriticizeLang,
  FunctionUnderReview,
  ParsedParam,
  VerbatimString,
  maskLine,
  unitDefect,
} from "./criticizeTypes";

export type { CriticizeLang, ParsedParam, VerbatimString } from "./criticizeTypes";

/**
 * Rust's raw string. `r"..."`, `r#"..."#`, `r##"..."##`, and the byte forms.
 *
 * The `#` run is the point of the form: inside it a bare `"` is text. A masker
 * that closes on the first inner quote hands the rest of the literal to the
 * detectors as code, and in the measured Rust crate 234 of the 245 lines
 * carrying `r#"` hold an inner quote, because they are JSON.
 */
const RUST_RAW_STRING: VerbatimString = {
  open: /^b?r(#*)"/,
  closeTemplate: '"%',
  doubledClose: false,
  spans: true,
};

/**
 * C#'s two literals that a backslash-aware scanner reads wrong.
 *
 * `"""..."""` (C# 11) spans lines, so a masker that only carries backticks
 * hands every line but the first to the detectors as code. `@"..."` has NO
 * backslash escape and doubles its quote instead, so `@"C:\"` closes on its
 * line while an escape-aware scanner decides the quote is escaped, finds no
 * close, and blanks the rest of a real line of code.
 *
 * The raw form is listed first because `"""` also starts with `"`.
 */
const CS_VERBATIM_STRINGS: readonly VerbatimString[] = [
  { open: /^"""/, closeTemplate: '"""', doubledClose: false, spans: true },
  { open: /^\$?@\$?"/, closeTemplate: '"', doubledClose: true, spans: true },
];

/**
 * Dimension 7 fires at or above this many parameters.
 *
 * CHOSEN, not measured. Nothing in the scout's corpora says where the knee is,
 * and the honest position is that a threshold on parameter count is a taste
 * dictated by the audience rather than a number derived from evidence. It sits
 * on the profile per language so a measurement can move ONE language later
 * without touching the other four; today all five carry the same chosen value
 * because nothing has measured a difference between them. Recorded in
 * docs/constants.md with the word chosen.
 */
const PARAM_COUNT_THRESHOLD = 5;

/**
 * Dimension 12 fires at or above this block depth.
 *
 * CHOSEN, not measured, on the same terms as the parameter threshold. Depth 4
 * is two levels above the depth an ordinary guard-plus-loop body reaches, so a
 * body has to be genuinely stacked to reach it. Recorded in docs/constants.md.
 */
const NESTING_THRESHOLD = 4;

// ===========================================================================
// Rust
// ===========================================================================

/**
 * Rust. The language declares in its own syntax what most languages leave to
 * a convention: `&` declares reading, `&mut self` declares mutation, and a
 * `Result` declares failure. That is why `receiverMutation` is `mut-self` here
 * and why the failure rule reads a panic against a missing `Result`.
 */
export const RUST_CRITICIZE_LANG: CriticizeLang = {
  languageIds: ["rust"],
  displayName: "Rust",
  lineComment: "//",
  verbatimStrings: [RUST_RAW_STRING],
  craft: {
    paramStyle: "rust",
    boolTypes: ["bool", "&bool"],
    unitReturns: ["()"],
    underscoreMeansUnused: true,
    paramCountThreshold: PARAM_COUNT_THRESHOLD,
    nestingThreshold: NESTING_THRESHOLD,
    blocks: "braces",
    publicSurface: { kind: "keyword", pattern: /^\s*pub\b/ },
    undocumentedDetail: "public surface with no doc comment",
    // rustc's own lint, allow-by-default and enabled with
    // `#![warn(missing_docs)]`. Verified reporting this exact finding.
    undocumentedRule: "rustc's `missing_docs`, enabled with `#![warn(missing_docs)]`",
    // `?` is a guard in exactly the sense dimension 9 means: it hands the
    // failure back to the caller instead of letting a stated precondition go
    // unchecked. Rust is the one language of the five whose guard vocabulary
    // is mostly punctuation.
    guards: [
      /\bassert(_eq|_ne)?!\s*\(/,
      /\bdebug_assert(_eq|_ne)?!\s*\(/,
      /\breturn\s+Err\s*\(/,
      /\bErr\s*\(.*\)\s*$/,
      /\?\s*;/,
      /\bif\s+let\b/,
      /\bmatch\b/,
      /\bensure!\s*\(/,
      /\bbail!\s*\(/,
    ],
    // A `&mut` PARAMETER written through, which is the other half of the
    // contract's Rust row. The `&mut self` receiver is the half the signature
    // declares, and it is read off the head rather than out of the body.
    mutations: [/^\s*\*\w+\s*(\+|-|\*|\/|\|)?=[^=]/],
    receiverMutation: "mut-self",
    failure: {
      kind: "panic-without-result",
      spellings: [
        /\.unwrap\s*\(\s*\)/,
        /\.expect\s*\(/,
        /\bpanic!\s*\(/,
        /\bunreachable!\s*\(/,
        /\btodo!\s*\(/,
      ],
    },
  },
};

// ===========================================================================
// TypeScript, and the three languageIds that share its grammar
// ===========================================================================

/**
 * TypeScript, JavaScript and the two React dialects. One profile rather than
 * four, because everything a profile now carries is syntax the four dialects
 * share: the same comment marker, the same backtick literal, the same
 * parameter list, the same `export`. The type system is what actually differs
 * between them, and nothing here reads it.
 */
export const TS_CRITICIZE_LANG: CriticizeLang = {
  languageIds: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
  displayName: "TypeScript",
  lineComment: "//",
  // JavaScript's only spanning literal is the backtick, which the shared
  // masker already carries.
  verbatimStrings: [],
  craft: {
    paramStyle: "typescript",
    boolTypes: ["boolean"],
    unitReturns: ["void", "Promise<void>"],
    underscoreMeansUnused: true,
    paramCountThreshold: PARAM_COUNT_THRESHOLD,
    nestingThreshold: NESTING_THRESHOLD,
    blocks: "braces",
    publicSurface: { kind: "keyword", pattern: /^\s*export\b/ },
    undocumentedDetail: "exported surface with no doc comment",
    // "An early return on a checked condition" is the shared guard shape, and
    // it is handled structurally for every language rather than spelled here.
    // What is left is the vocabulary TypeScript alone uses.
    guards: [/\bthrow\s+new\b/, /\bassert\s*\(/, /^\s*if\s*\(.*\)\s*return\b/],
    mutations: [/^\s*this\.\w+(\.\w+)*\s*(\+|-|\*|\/|\|\||\?\?)?=[^=]/],
    receiverMutation: "none",
    failure: {
      kind: "unknowable",
      reason:
        "TypeScript has no checked exceptions, so nothing in a signature could have admitted a throw and this dimension cannot tell you anything about a TypeScript function",
    },
  },
};

// ===========================================================================
// C#
// ===========================================================================

/**
 * C#. Two knobs here are the language rather than a taste.
 * `underscoreMeansUnused` is false because a leading underscore in C# names a
 * FIELD and says nothing about an unused parameter, and the mutation rule has
 * to demand a trailing semicolon, because an object-initializer clause is
 * spelled exactly like a static write and ends in a comma or a brace instead.
 */
export const CS_CRITICIZE_LANG: CriticizeLang = {
  languageIds: ["csharp"],
  displayName: "C#",
  lineComment: "//",
  verbatimStrings: CS_VERBATIM_STRINGS,
  craft: {
    paramStyle: "csharp",
    boolTypes: ["bool", "Boolean", "bool?"],
    unitReturns: ["void", "Task", "ValueTask"],
    // C# has no _-prefix convention for an unused parameter: a leading
    // underscore there names a FIELD. So an unused C# parameter fires however
    // it is spelled, and that difference is the whole reason this is a knob.
    underscoreMeansUnused: false,
    paramCountThreshold: PARAM_COUNT_THRESHOLD,
    nestingThreshold: NESTING_THRESHOLD,
    blocks: "braces",
    publicSurface: { kind: "keyword", pattern: /\b(public|protected)\b/ },
    undocumentedDetail: "public surface with no doc comment",
    // Roslyn reports this as CS1591 once `GenerateDocumentationFile` is set,
    // which is the standard way a C# library ships its XML docs. Verified.
    undocumentedRule: "Roslyn's CS1591, with `<GenerateDocumentationFile>true</GenerateDocumentationFile>`",
    guards: [
      /\bthrow\s+new\s+Argument\w*Exception\b/,
      /\bArgumentNullException\.ThrowIfNull\b/,
      /\bArgumentException\.ThrowIf\w+\b/,
      /\bArgumentOutOfRangeException\.ThrowIf\w+\b/,
      /\bDebug\.Assert\s*\(/,
      /\bthrow\s+new\b/,
    ],
    mutations: [
      /^\s*this\.\w+(\.\w+)*\s*(\+|-|\*|\/|\|\||\?\?)?=[^=]/,
      /^\s*_\w+\s*(\+|-|\*|\/|\|\||\?\?)?=[^=]/,
      // A static or auto-property write, and it must be a STATEMENT. The
      // trailing semicolon is what separates it from an object-initializer
      // clause, which is spelled identically and ends in a comma or a brace:
      // `new RetroJob { StartDate = from, EndDate = to }` writes nothing that
      // outlives the call, and a query method building a fresh result object
      // is exactly the shape this dimension must stay quiet on. Measured on
      // the labelled set as the only C# false positive this dimension had.
      /^\s*[A-Z]\w*\s*(\+|-|\*|\/|\|\||\?\?)?=[^=].*;\s*$/,
    ],
    receiverMutation: "none",
    failure: { kind: "undocumented-throw" },
  },
};

// ===========================================================================
// Python
// ===========================================================================

/**
 * Python. The profile that pays the most for not being a parser. Blocks are
 * counted by INDENTATION, because a brace counter reads every Python function
 * as depth zero and depth zero renders exactly like a clean function. Public
 * surface is the leading-underscore convention, which the language enforces
 * nowhere, so the detail line says so rather than the refusal.
 */
export const PY_CRITICIZE_LANG: CriticizeLang = {
  languageIds: ["python"],
  displayName: "Python",
  lineComment: "#",
  // Python's triple quotes are already the shared masker's spanning list.
  verbatimStrings: [],
  craft: {
    paramStyle: "python",
    boolTypes: ["bool"],
    unitReturns: ["None"],
    underscoreMeansUnused: true,
    paramCountThreshold: PARAM_COUNT_THRESHOLD,
    nestingThreshold: NESTING_THRESHOLD,
    // Python has no braces, and a brace counter reads every Python function as
    // depth zero. Depth zero renders exactly like a clean function, which is
    // this session's whole failure mode.
    blocks: "indentation",
    publicSurface: { kind: "leading-underscore" },
    undocumentedDetail:
      "public by the leading-underscore convention, which python enforces nowhere, and no docstring",
    // ruff reports this as `D103`, selected with `--select D` or a `[tool.ruff]`
    // pydocstyle ruleset. Verified reporting this exact finding on a fixture
    // that trips the detector below.
    undocumentedRule: "ruff's `D103`, selected with `--select D`",
    guards: [/\braise\b/, /^\s*assert\b/],
    mutations: [/^\s*self\.\w+(\.\w+)*\s*(\+|-|\*|\/|\|)?=[^=]/, /^\s*global\s+\w/],
    receiverMutation: "none",
    failure: { kind: "raise-without-doc" },
  },
};

// ===========================================================================
// Go
// ===========================================================================

/**
 * Go. The language says most of this in its own syntax: `(T, error)` returns
 * make failure visible in the signature, a capital letter is what exports, and
 * a pointer receiver is what declares a mutation. The failure rule reads a
 * dropped error rather than a panic, which is measured: in the standard
 * library 3.4% of functions drop an error against 4.3% that panic, and the
 * dropped one is what a Go developer recognises as the craft failure.
 */
export const GO_CRITICIZE_LANG: CriticizeLang = {
  languageIds: ["go"],
  displayName: "Go",
  lineComment: "//",
  // Go's backtick literal is already the shared masker's spanning list.
  verbatimStrings: [],
  craft: {
    paramStyle: "go",
    boolTypes: ["bool"],
    // Go writes no result at all rather than naming a unit type, so the list is
    // empty and the "does it answer anything" question is answered by whether
    // any result was written.
    unitReturns: [],
    underscoreMeansUnused: true,
    paramCountThreshold: PARAM_COUNT_THRESHOLD,
    nestingThreshold: NESTING_THRESHOLD,
    blocks: "braces",
    publicSurface: { kind: "capitalised" },
    undocumentedDetail: "exported by capitalisation, and no doc comment above the declaration",
    guards: [
      /\bif\s+err\s*!=\s*nil\b/,
      /\bif\s+\w+\s*==\s*nil\b/,
      /\bif\s+len\s*\(.*\)\s*==\s*0\b/,
      /\breturn\s+.*errors\.New\s*\(/,
      /\breturn\s+.*fmt\.Errorf\s*\(/,
    ],
    mutations: [/^\s*\w+(\.\w+)+\s*(\+|-|\*|\/|\|)?=[^=]/],
    receiverMutation: "pointer-receiver",
    // Go does not idiomatically panic. Measured in the standard library: 3.4%
    // of functions drop an error against 4.3% that panic, and the dropped
    // error is the one a Go developer recognises as the craft failure.
    failure: { kind: "dropped-error" },
  },
};

/** Registration order is display order, and nothing else depends on it. */
const PROFILES: readonly CriticizeLang[] = [
  RUST_CRITICIZE_LANG,
  TS_CRITICIZE_LANG,
  CS_CRITICIZE_LANG,
  PY_CRITICIZE_LANG,
  GO_CRITICIZE_LANG,
];

/**
 * The profile for a VS Code languageId, or `undefined` when Criticize has no
 * tables for it.
 *
 * `undefined` is the honest state and the caller must refuse by naming the
 * language. Handing back a neighbouring profile would count Rust's braces by
 * Python's indentation and report a clean function that was never examined,
 * which is the silent zero this whole subsystem is built to avoid.
 */
export function criticizeLangFor(languageId: string): CriticizeLang | undefined {
  return PROFILES.find((profile) => profile.languageIds.includes(languageId));
}

// ===========================================================================
// Reading a declaration head
//
// Dimensions 5 to 7, 10, 11 and 13 all need the same three facts about a
// signature: what the parameters are, what it gives back, and what it is
// called. Each of the five languages spells those in a different order, and
// two of them put something in front of the parameter list that is NOT a
// parameter. That knowledge lives here rather than in the detectors, so a
// detector reads "the result is empty" and never "the text after the second
// close paren".
// ===========================================================================

/** The three facts a detector needs off a declaration head, already masked so a
 *  comment or a string inside the head cannot be read as code. */
export interface SignatureParts {
  /** The whole declaration head, masked and joined into one line. */
  head: string;
  /** The text between the parameter parens. The receiver is NOT in here. */
  params: string;
  /** The declared result as written, or "" when the language wrote none. Go
   *  writes none for a command; the other four spell a unit type. */
  result: string;
  /** The name as the declaration spells it, which is what Go and Python read to
   *  decide whether a function is public. `FunctionUnderReview.name` is what
   *  the CALLER chose to call this slice, and it is not the same thing. */
  declaredName: string;
}

/** Bracket depth carried across one scan. Angle brackets are counted so a
 *  `HashMap<K, V>` parameter is one entry and not two. */
function bracketDelta(text: string, at: number): { delta: number; skip: number } {
  // `->` is a Rust and Python result arrow, not a closing angle bracket, and
  // counting its `>` would unbalance every `impl Fn(u8) -> u8` parameter.
  if (text.startsWith("->", at)) {
    return { delta: 0, skip: 2 };
  }
  if ("([{<".includes(text[at])) {
    return { delta: 1, skip: 1 };
  }
  if (")]}>".includes(text[at])) {
    return { delta: -1, skip: 1 };
  }
  return { delta: 0, skip: 1 };
}

/** Split on `separator` at bracket depth zero. */
function splitTopLevel(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; ) {
    if (depth === 0 && text.startsWith(separator, i)) {
      out.push(text.slice(from, i));
      i += separator.length;
      from = i;
      continue;
    }
    const step = bracketDelta(text, i);
    depth += step.delta;
    i += step.skip;
  }
  out.push(text.slice(from));
  return out.map((entry) => entry.trim()).filter((entry) => entry !== "");
}

/** The index of the `)` matching the `(` at `open`, or -1. */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") {
      depth++;
    } else if (text[i] === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** Split on whitespace outside brackets, so `Dictionary<string, int> Get` is
 *  two tokens and not three. */
function tokensOutsideBrackets(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    const step = bracketDelta(text, i);
    if (depth === 0 && step.delta === 0 && /\s/.test(ch)) {
      if (current !== "") {
        out.push(current);
      }
      current = "";
      i += 1;
      continue;
    }
    depth += step.delta;
    current += text.slice(i, i + step.skip);
    i += step.skip;
  }
  if (current !== "") {
    out.push(current);
  }
  return out;
}

/**
 * The masked declaration head, joined into one line, or undefined when the
 * parameter parens never balance inside the slice.
 *
 * The walk stops at the line where paren depth returns to zero rather than at
 * `bodyIndex`, because in Python `bodyIndex` sits AFTER the docstring and
 * joining that far would put the doc text inside the signature.
 */
function joinHead(fn: FunctionUnderReview, lang: CriticizeLang): string | undefined {
  let depth = 0;
  let opened = false;
  const parts: string[] = [];
  for (let i = fn.headIndex; i < fn.lines.length; i++) {
    const masked = maskLine(fn.lines[i], lang);
    parts.push(masked);
    for (let at = 0; at < masked.length; at++) {
      if (masked[at] === "(") {
        depth++;
        opened = true;
      } else if (masked[at] === ")") {
        depth--;
      }
    }
    if (opened && depth <= 0) {
      return parts.join(" ");
    }
  }
  return undefined;
}

/** The declaration keyword and the name after it, for the three languages that
 *  write the name FIRST. Go's pattern swallows the method receiver on the way
 *  past, which is why nothing downstream has to know Go has one. */
const DECLARED_NAME: Record<string, RegExp> = {
  rust: /\bfn\s+([A-Za-z_]\w*)/,
  go: /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  python: /\bdef\s+([A-Za-z_]\w*)/,
};

/**
 * The parameters, the result and the name, off one declaration head.
 *
 * Undefined means the head could not be read, which every caller must treat as
 * a `blind` outcome. It is never a clean one: a signature this cannot parse is
 * a signature nothing here examined.
 */
export function signatureParts(fn: FunctionUnderReview, lang: CriticizeLang): SignatureParts | undefined {
  if (unitDefect(fn) !== undefined) {
    return undefined;
  }
  const head = joinHead(fn, lang);
  if (head === undefined) {
    return undefined;
  }

  // The parameter list is the first paren group AFTER THE NAME, never the first
  // one on the line. `pub(crate) fn f(x: u8)` opens a paren before the `fn`
  // keyword, and reading that one as the parameter list made 61 of 618 real
  // Rust functions unparseable, every one of them a `pub(crate)`. Go's method
  // receiver is a second instance of the same trap and the name pattern eats it.
  const named = DECLARED_NAME[lang.craft.paramStyle];
  let declaredName = "";
  let from = 0;
  if (named !== undefined) {
    const hit = head.match(named);
    if (hit === null || hit.index === undefined) {
      return undefined;
    }
    declaredName = hit[1];
    from = hit.index + hit[0].length;
  } else {
    // C# and TypeScript write the name last, so an attribute or a decorator in
    // front of it is what has to be stepped over.
    from = (head.match(/^\s*((\[[^\]]*\]|@\w+(\([^)]*\))?)\s*)+/)?.[0] ?? "").length;
  }

  const open = head.indexOf("(", from);
  if (open < 0) {
    return undefined;
  }
  const close = matchingParen(head, open);
  if (close < 0) {
    return undefined;
  }
  if (named === undefined) {
    const tokens = tokensOutsideBrackets(head.slice(from, open));
    declaredName = (tokens[tokens.length - 1] ?? "").replace(/^.*[.<]/, "");
  }

  return {
    head,
    params: head.slice(open + 1, close),
    result: declaredResult(head, head.slice(0, open), close, lang),
    declaredName,
  };
}

/** What the declaration says it gives back, "" when it says nothing. C# is the
 *  one language of the five that writes the result BEFORE the name. */
function declaredResult(head: string, beforeParams: string, close: number, lang: CriticizeLang): string {
  if (lang.craft.paramStyle === "csharp") {
    const tokens = tokensOutsideBrackets(beforeParams);
    // A constructor writes modifiers and then the name, with no result at all,
    // so the token before the name has to be checked against the modifiers
    // rather than assumed to be a type.
    const candidate = tokens[tokens.length - 2];
    if (candidate === undefined || CS_MODIFIERS.has(candidate)) {
      return "";
    }
    return candidate;
  }
  let after = head.slice(close + 1);
  const brace = after.indexOf("{");
  if (brace >= 0) {
    after = after.slice(0, brace);
  }
  after = after.trim().replace(/:$/, "").trim();
  if (after.startsWith("->")) {
    return after.slice(2).trim();
  }
  if (after.startsWith(":")) {
    return after.slice(1).trim();
  }
  // Rust and Python write an arrow or nothing; TypeScript writes a colon or
  // nothing; Go writes the bare result. A Rust head with no arrow returns unit
  // and a Go head with nothing returns nothing, and both read as "".
  return lang.craft.paramStyle === "go" ? after : "";
}

/** C# tokens that may sit between `public` and a method name without being a
 *  result type. A constructor's head ends in one of these. */
const CS_MODIFIERS: ReadonlySet<string> = new Set([
  "public", "private", "protected", "internal", "static", "async", "override",
  "virtual", "sealed", "abstract", "extern", "unsafe", "partial", "new",
  "readonly",
]);

/** Modifiers that sit in front of a parameter without being part of its type. */
const PARAM_MODIFIERS: ReadonlySet<string> = new Set([
  "ref", "out", "in", "params", "this", "mut", "readonly", "public", "private",
  "protected",
]);

/**
 * The parameters of one function, with the receiver excluded.
 *
 * Undefined means THIS function's parameter list could not be read, which is a
 * blind result for every dimension that depends on it and never a clean one.
 *
 * The receiver is not a parameter in any of the five: Rust's `self` / `&self` /
 * `&mut self`, Go's method receiver, Python's `self` and `cls`, and C#'s `this`
 * on an extension method are all dropped here, so a detector never has to know
 * that "the first parameter is sometimes not one".
 */
export function parseParams(
  fn: FunctionUnderReview,
  lang: CriticizeLang,
): readonly ParsedParam[] | undefined {
  const parts = signatureParts(fn, lang);
  if (parts === undefined) {
    return undefined;
  }
  const entries = splitTopLevel(parts.params, ",");
  switch (lang.craft.paramStyle) {
    case "rust":
      return rustParams(entries);
    case "go":
      return goParams(entries);
    case "csharp":
      return csharpParams(entries);
    case "typescript":
      return typescriptParams(entries);
    case "python":
      return pythonParams(entries);
  }
}

/** `left: String`, with `self`, `&self` and `&mut self` dropped. */
function rustParams(entries: readonly string[]): readonly ParsedParam[] | undefined {
  const out: ParsedParam[] = [];
  for (const entry of entries) {
    if (/^(&\s*('\w+\s+)?(mut\s+)?)?(mut\s+)?self$/.test(entry)) {
      continue;
    }
    const colon = splitAtFirstColon(entry);
    if (colon === undefined) {
      // Rust always writes the type. A parameter without one is a head this
      // cannot read, and reporting the rest would be reporting a guess.
      return undefined;
    }
    out.push({ name: colon.before.replace(/^mut\s+/, "").trim(), type: colon.after, grouped: false });
  }
  return out;
}

/** `dst, src []byte` is TWO parameters against ONE type, and the grouped flag
 *  is what stops dimension 5 firing on 8.3% of the Go standard library. */
function goParams(entries: readonly string[]): readonly ParsedParam[] | undefined {
  const out: ParsedParam[] = [];
  let pending: string[] = [];
  for (const entry of entries) {
    const tokens = tokensOutsideBrackets(entry);
    if (tokens.length === 0) {
      continue;
    }
    if (tokens.length === 1) {
      // A bare name waits for the type its group shares.
      pending.push(tokens[0]);
      continue;
    }
    const type = tokens.slice(1).join(" ");
    const grouped = pending.length > 0;
    for (const name of pending) {
      out.push({ name, type, grouped: true });
    }
    pending = [];
    out.push({ name: tokens[0], type, grouped });
  }
  // Names still pending means a type-only list, as an interface method may
  // write. Nothing here can name those parameters, so nothing here judges them.
  return pending.length > 0 ? undefined : out;
}

/** `string left`, plus the modifiers C# allows in front of one. */
function csharpParams(entries: readonly string[]): readonly ParsedParam[] | undefined {
  const out: ParsedParam[] = [];
  for (const raw of entries) {
    const entry = raw.split("=")[0].trim();
    let tokens = tokensOutsideBrackets(entry).filter((t) => !t.startsWith("["));
    const isExtensionReceiver = tokens[0] === "this";
    while (tokens.length > 0 && PARAM_MODIFIERS.has(tokens[0])) {
      tokens = tokens.slice(1);
    }
    if (isExtensionReceiver) {
      continue;
    }
    if (tokens.length < 2) {
      return undefined;
    }
    out.push({
      name: tokens[tokens.length - 1],
      type: tokens.slice(0, -1).join(" "),
      grouped: false,
    });
  }
  return out;
}

/** `width: number`, `x?: string`, `...rest: string[]`, `x = 3`. */
function typescriptParams(entries: readonly string[]): readonly ParsedParam[] | undefined {
  const out: ParsedParam[] = [];
  for (const raw of entries) {
    let entry = raw;
    let type: string | undefined;
    const colon = splitAtFirstColon(entry);
    if (colon !== undefined) {
      type = colon.after.split("=")[0].trim();
      entry = colon.before;
    } else {
      entry = entry.split("=")[0];
    }
    const name = entry.replace(/^\.\.\./, "").replace(/\?$/, "").trim().split(/\s+/).pop() ?? "";
    if (name === "" || !/^[A-Za-z_$][\w$]*$/.test(name)) {
      // A destructured parameter has no single name, so there is nothing here
      // to call unused or to compare types against.
      return undefined;
    }
    out.push({ name, type, grouped: false });
  }
  return out;
}

/** `width: float`, with `self` and `cls` dropped and the type left undefined
 *  where the developer wrote none. 13.7% of measured Python functions annotate
 *  every parameter, and that number is why `type` is optional at all. */
function pythonParams(entries: readonly string[]): readonly ParsedParam[] | undefined {
  const out: ParsedParam[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === "*" || entry === "/") {
      continue;
    }
    if (i === 0 && (entry === "self" || entry === "cls")) {
      continue;
    }
    const colon = splitAtFirstColon(entry);
    const namePart = (colon === undefined ? entry.split("=")[0] : colon.before).trim();
    const name = namePart.replace(/^\*+/, "").trim();
    if (!/^[A-Za-z_]\w*$/.test(name)) {
      return undefined;
    }
    out.push({
      name,
      type: colon === undefined ? undefined : colon.after.split("=")[0].trim(),
      grouped: false,
    });
  }
  return out;
}

/** Split `name: Type` at the annotation colon, ignoring a colon nested inside
 *  a bracket, which is how a dict default value writes one. */
function splitAtFirstColon(entry: string): { before: string; after: string } | undefined {
  const parts = splitTopLevel(entry, ":");
  if (parts.length < 2) {
    return undefined;
  }
  return { before: parts[0].trim(), after: parts.slice(1).join(":").trim() };
}
