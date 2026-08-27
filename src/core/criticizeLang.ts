/**
 * The five language profiles Criticize reads code through.
 *
 * ONE BUILD WITH FIVE TABLES, PROVEN BEFORE IT WAS BUILT. All five honesty
 * grammars were written side by side in the scout harness and not one of them
 * needed its own control flow: a clock is a list of spellings, and so are a
 * PRNG, the environment and a file read. The per-language cost in this
 * subsystem sits in the later dimensions, where "what is a parameter" and
 * "what does public mean" genuinely differ.
 *
 * The registry is oracleFor's pattern, copied because it has survived five
 * languages: a strategy list, `undefined` for an unregistered language so the
 * caller refuses by NAMING the language rather than falling back to a guess.
 *
 * WHAT THE TABLES ARE AND ARE NOT. Every rate quoted below is a SIGNAL rate on
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
 * Dimension 8 fires at or above this many parameters.
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
 * Dimension 13 fires at or above this block depth.
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
 * Rust. The language already enforces most of the honesty frame mechanically:
 * `&` declares reading, `&mut` declares mutation. What it cannot declare is a
 * read of the universe, which is why the clock leg is Rust's highest at 3.6%.
 */
export const RUST_CRITICIZE_LANG: CriticizeLang = {
  languageIds: ["rust"],
  displayName: "Rust",
  honesty: {
    clock: [
      /\bInstant::now\s*\(/,
      /\bSystemTime::now\s*\(/,
      /\bUtc::now\s*\(/,
      /\bLocal::now\s*\(/,
    ],
    // `rand::thread_rng` is covered by the bare spelling: `::` ends a word, so
    // the boundary holds for both the qualified and the imported form.
    prng: [
      /\bthread_rng\s*\(/,
      /\brand::random\s*(::<[^>]*>)?\s*\(/,
      /\brand::rng\s*\(/,
      /\bfrom_entropy\s*\(/,
      /\bOsRng\b/,
    ],
    env: [
      /\benv::var(_os)?\s*\(/,
      /\benv::vars\s*\(/,
      /\benv::args\s*\(/,
    ],
    world: [
      /\bFile::open\s*\(/,
      /\bfs::read(_to_string|_dir)?\s*\(/,
      /\bfs::metadata\s*\(/,
      /\bread_to_string\s*\(\s*&?\s*mut\b/,
    ],
  },
  lineComment: "//",
  verbatimStrings: [RUST_RAW_STRING],
  logWrites: [
    /\b(e)?print(ln)?!\s*\(/,
    /\btracing::\w+!/,
    /\blog::\w+!/,
    /\b(info|warn|error|debug|trace)!\s*\(/,
  ],
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
    // `?` is a guard in exactly the sense dimension 10 means: it hands the
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
 * four, because the honesty spellings are the runtime's and the runtime is the
 * same one; the type system, which is what actually differs, is not what these
 * tables read.
 */
export const TS_CRITICIZE_LANG: CriticizeLang = {
  languageIds: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
  displayName: "TypeScript",
  honesty: {
    clock: [
      /\bDate\.now\s*\(/,
      /\bnew Date\s*\(\s*\)/,
      /\bperformance\.now\s*\(/,
      /\bhrtime\s*(\.\w+)?\s*\(/,
    ],
    prng: [
      /\bMath\.random\s*\(/,
      /\brandomUUID\s*\(/,
      /\brandomBytes\s*\(/,
      /\bgetRandomValues\s*\(/,
    ],
    env: [
      /\bprocess\.env\b/,
      /\bprocess\.argv\b/,
    ],
    // RECEIVER-AWARE, and that is the whole difference between flagging a
    // file read and flagging the fix for one. A bare `/\breadFile\(/` fires on
    // `ctx.files.readFile(p)`, which is the honest shape this dimension's own
    // source line prescribes: the reader came in through the signature. It was
    // the only false positive on the 138-row labelled set (row ts-030), and in
    // this repo's own src/ the bare pattern fires on 29 lines that are not
    // `fs.`, three of which are interface member DECLARATIONS and not calls at
    // all. `this.` is kept, and is not the same case: a read through the
    // receiver's own state did not come through the signature either, and the
    // labelled set's one TypeScript world true positive (ts-002) is exactly
    // that wrapper spelling.
    world: [
      /\bfs(Promises|p)?\.read\w*\s*\(/,
      /\bfs(Promises|p)?\.(exists|stat|lstat|open)\w*\s*\(/,
      /\bfs(Promises|p)?\.createReadStream\s*\(/,
      /\bthis\.read(File|Text|Bytes)\w*\s*\(/,
      // The `Sync` suffix is node's own naming for the `fs` module function,
      // so a bare one is the import rather than an injected reader; this
      // repo's injected readers are all spelled `readFile`.
      /(?<![\w.])readFileSync\s*\(/,
    ],
  },
  lineComment: "//",
  // JavaScript's only spanning literal is the backtick, which the shared
  // masker already carries.
  verbatimStrings: [],
  logWrites: [
    /\bconsole\.\w+\s*\(/,
    /\blogger\.\w+\s*\(/,
    /\blog\.\w+\s*\(/,
  ],
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
 * C#. `Guid.NewGuid` sits in the PRNG table on purpose: a fresh guid is a read
 * of a generator the signature never mentions, and it is why the C# PRNG leg
 * has anything to say at all where the bare `new Random` spelling is rare. The
 * per-language PRNG rates this comment used to quote were measured over one
 * chosen directory per language, and widening the Rust corpus to the whole
 * repository moved its 0.0% to a non-zero number, so the ordering they claimed
 * is not a fact about the languages.
 */
export const CS_CRITICIZE_LANG: CriticizeLang = {
  languageIds: ["csharp"],
  displayName: "C#",
  honesty: {
    clock: [
      /\bDateTime\.(Now|UtcNow|Today)\b/,
      /\bDateTimeOffset\.(Now|UtcNow)\b/,
      /\bStopwatch\.GetTimestamp\s*\(/,
      /\bEnvironment\.TickCount\d*\b/,
    ],
    prng: [
      /\bnew Random\s*\(/,
      /\bRandom\.Shared\b/,
      /\bGuid\.NewGuid\s*\(/,
      /\bRandomNumberGenerator\.\w+\s*\(/,
    ],
    env: [
      /\bEnvironment\.(GetEnvironmentVariable|GetEnvironmentVariables|GetCommandLineArgs|ExpandEnvironmentVariables)\s*\(/,
    ],
    world: [
      /\bFile\.(Read|Open|Exists)\w*\s*\(/,
      /\bnew StreamReader\s*\(/,
      /\bDirectory\.(GetFiles|EnumerateFiles|Exists)\s*\(/,
    ],
  },
  lineComment: "//",
  verbatimStrings: CS_VERBATIM_STRINGS,
  logWrites: [
    /\bConsole\.(Write|WriteLine|Error)\b/,
    /\b_?[Ll]og(ger)?\.\w+\s*\(/,
    /\bDebug\.(Write|WriteLine|Log)\s*\(/,
    /\bTrace\.\w+\s*\(/,
  ],
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
 * Python. Two things about this profile are measured rather than chosen.
 *
 * `random.` carries a trailing dot so a variable a developer happened to call
 * `random_thing` is not a PRNG read; the dishonesty is the module, not the
 * name.
 *
 * The world table cannot ask for a mode argument even if it wanted to, because
 * the detector reads a MASKED line and a mode string is already spaces there.
 * So the question this leg asks is "is a file opened or read", not "is it
 * opened for reading", and it is the widest of the five legs as a result. It is
 * the loudest leg on every corpus measured, and it is the first place a larger
 * labelled set should look.
 */
export const PY_CRITICIZE_LANG: CriticizeLang = {
  languageIds: ["python"],
  displayName: "Python",
  honesty: {
    clock: [
      /\btime\.time\s*\(/,
      /\btime\.monotonic\s*\(/,
      /\btime\.perf_counter\s*\(/,
      /\bdatetime\.(now|utcnow|today)\s*\(/,
      /\bdate\.today\s*\(/,
    ],
    prng: [
      /\brandom\.\w+\s*\(/,
      /\bnp\.random\.\w+/,
      /\bnumpy\.random\.\w+/,
      /\buuid4\s*\(/,
      /\bsecrets\.\w+\s*\(/,
    ],
    env: [
      /\bos\.environ\b/,
      /\bos\.getenv\s*\(/,
      /\bsys\.argv\b/,
    ],
    // `open` STAYS receiver-blind except through `self` and `cls`, and that is
    // measured rather than assumed. Python's `open` is a builtin, so a bare
    // call is never an injected reader, and the dotted forms in the corpus are
    // `wave.open`, `zipfile.open` and `Path.open`, every one of them a real
    // file read: tightening this leg the way TypeScript's needed cost 37 true
    // positives on the measured Python corpus and removed no false one. The
    // two receivers that could not be a module or a path are excluded.
    world: [
      /(?<!self\.)(?<!cls\.)\bopen\s*\(/,
      /\.read_text\s*\(/,
      /\.read_bytes\s*\(/,
      /\bos\.listdir\s*\(/,
    ],
  },
  lineComment: "#",
  // Python's triple quotes are already the shared masker's spanning list.
  verbatimStrings: [],
  logWrites: [
    /\bprint\s*\(/,
    /\blogg(ing|er)\.\w+\s*\(/,
    /\bLOG(GER)?\.\w+\s*\(/,
    /\bsys\.std(out|err)\.write\s*\(/,
  ],
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
 * Go. The quietest of the five on every honesty leg, and that is the language
 * doing its job: `(T, error)` returns and an explicit `os` package make most
 * reads of the world visible in the signature already.
 */
export const GO_CRITICIZE_LANG: CriticizeLang = {
  languageIds: ["go"],
  displayName: "Go",
  honesty: {
    clock: [
      /\btime\.Now\s*\(/,
      /\btime\.Since\s*\(/,
    ],
    prng: [
      /\brand\.(Int|Float|Perm|Read|New|Seed|Shuffle|Uint|N)\w*\s*\(/,
    ],
    env: [
      /\bos\.Getenv\s*\(/,
      /\bos\.LookupEnv\s*\(/,
      /\bos\.Environ\s*\(/,
      /\bos\.Args\b/,
    ],
    world: [
      /\bos\.(Open|OpenFile|ReadFile|ReadDir|Stat|Lstat)\s*\(/,
      /\bioutil\.Read(File|Dir|All)\s*\(/,
    ],
  },
  lineComment: "//",
  // Go's backtick literal is already the shared masker's spanning list.
  verbatimStrings: [],
  logWrites: [
    /\bfmt\.(Print|Fprint)\w*\s*\(/,
    /\blog\.\w+\s*\(/,
    /\bslog\.\w+\s*\(/,
    /\bt\.Log\w*\s*\(/,
  ],
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
 * language. Handing back a neighbouring profile would run Python's spellings
 * over Rust and report a clean function that was never examined, which is the
 * silent zero this whole subsystem is built to avoid.
 */
export function criticizeLangFor(languageId: string): CriticizeLang | undefined {
  return PROFILES.find((profile) => profile.languageIds.includes(languageId));
}

// ===========================================================================
// Reading a declaration head
//
// Dimensions 5 to 8, 11, 12 and 14 all need the same three facts about a
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
