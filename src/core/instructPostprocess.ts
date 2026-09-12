/**
 * Output hygiene for instruct-model replies, separate from the FIM
 * postprocess pipeline: an instruct model answers in prose + fenced code
 * block, so the job here is extraction (find the code), not infill trimming
 * (FIM's job). Keeping the two apart stops FIM filter amendments from
 * silently changing fn-gen behavior.
 */

import { TS_LANGUAGE_IDS } from "./tsExtraction";

/** The opening fence RUN on a trimmed line: the character and how many of it,
 *  or undefined when the line does not open a fence. Three or more, at the start
 *  of the line — a mid-line fence never opens. */
function fenceRun(trimmed: string): { char: string; len: number } | undefined {
  const m = /^(`{3,}|~{3,})/.exec(trimmed);
  return m ? { char: m[1][0], len: m[1].length } : undefined;
}

/**
 * Content of the first fenced code block in `reply`, or undefined when no
 * complete fenced block exists.
 *
 * An immediately closed fence yields "" — a valid empty candidate, distinct
 * from undefined (no fence). Callers that treat empty output as a failure
 * must check for "" themselves; the fn-gen service's empty-rejects path does.
 *
 * FENCE RUNS ARE HONOURED. An opener is a run of three or more; a closer is a
 * bare run of the SAME character whose length is 3 OR equal to the opener's.
 * The closer used to be `trimmed.slice(0, 3)`, so only a run of exactly three
 * ever closed anything.
 *
 * THE MEASUREMENT. 32 of 198 repair rows died in `fnGenService`'s code-fence
 * guard: 16.2% of that population refused by the product's own postprocess
 * before a repair attempt could be scored. Replaying all 32 with the model's
 * reply captured verbatim, 16 of the 32 reproduce the refusal — so the change is
 * demonstrated on half the population it is credited with — and 16 of those 16
 * open with a run of FOUR backticks and close with four. No line equalled the
 * three-backtick closer, this function reported "no complete block",
 * `postprocessInstructOutput` fell back to the whole reply, and the guard then
 * refused a complete and correct function for carrying the fence lines it had
 * just been told to keep.
 *
 * THIS IS DELIBERATELY NOT CommonMark, and the difference is one direction:
 * CommonMark lets a LONGER closer close a shorter opener, and this does not.
 * The rule shipped instead is a strict SUPERSET of the old behaviour — every
 * input that closed before closes at the same line, plus long-run pairs now
 * close — which is why it cannot regress the run-3 majority or the two callers
 * (`extractTestModule`, `extractTestFunctions`) the measurement never exercised.
 *
 * Both properties given up are unobserved, and one of them is a hazard. Counted
 * over the 131 captured model replies in `data/repair-v38-fence*.json`, one
 * opener/closer pair per reply, taking the first fence line as the opener and
 * the first bare same-character run after it as the closer — state the method
 * next to the number, because an earlier census of this said "zero mismatched"
 * and was wrong:
 *
 * - 92 openers are run-3 and NONE is followed by a longer bare run, so closing
 *   on a longer run buys nothing. It also costs: a bare run-4 line inside a
 *   run-3 block (a Rust raw string holding a markdown example) would close it
 *   early, and the truncated body carries no fence line, so the guard does not
 *   catch it. That turns a visible refusal into a silent bad write.
 * - 39 openers are run-4 or longer. 36 close with a run at least as long and
 *   THREE are open-4/close-3, each a complete correct function. A rule that
 *   refused those would lose them outright, which is why the length-3 closer is
 *   kept rather than dropped for spec purity.
 */
export function extractFirstCodeBlock(reply: string): string | undefined {
  const lines = reply.split("\n");
  let open: { char: string; len: number } | undefined;
  let openLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (open === undefined) {
      // Opening fence: the run, optionally followed by an info string.
      const run = fenceRun(trimmed);
      if (run) {
        open = run;
        openLine = i;
      }
      continue;
    }
    // Closing fence: the run and NOTHING else, same character, length 3 or the
    // opener's. Trailing prose ("``` end") does not close, unchanged.
    const close = fenceRun(trimmed);
    if (
      close &&
      close.char === open.char &&
      (close.len === 3 || close.len === open.len) &&
      trimmed.length === close.len
    ) {
      return lines.slice(openLine + 1, i).join("\n");
    }
  }
  return undefined;
}

/**
 * The fence to WRITE around `content` when the product assembles a prompt.
 *
 * IT LIVES BESIDE `fenceRun` ON PURPOSE. The writer's only job is to emit a
 * fence the content cannot close, and "cannot close" is defined by the reader
 * above, not by CommonMark. Two files would drift; one file means the rule the
 * writer beats is the rule the reader applies.
 *
 * THE RULE. A run of at least three, strictly longer than the longest backtick
 * run that OPENS a line inside the content (`fenceRun`'s own test: a run at the
 * start of the trimmed line). A mid-line run is not a fence in any markdown
 * dialect and must not inflate anything, or every backticked identifier in a
 * doc comment would widen the fence around it. Content with no line-opening run
 * gets the plain three back, byte for byte, which is the overwhelming majority
 * and what keeps the frozen prompt-identity pins green.
 *
 * WHY IT SOMETIMES ANSWERS TILDES, which length alone cannot do. `extractFirst-
 * CodeBlock` deliberately keeps a bare run of THREE as a closer for any opener
 * (see its comment: three captured replies are open-4/close-3 and refusing them
 * would lose them outright). So a bare ``` line inside the content closes the
 * block whatever length is chosen, and no backtick fence can win. A tilde fence
 * can: the reader requires the closer to be the SAME character. That case is
 * the Rust doc example and the markdown selection - real content, not a corner.
 * Content carrying a bare run of three of BOTH characters cannot be fenced at
 * all under this reader; it takes the backtick answer, which is what the
 * unadapted code already did.
 */
export function fenceFor(content: string): string {
  const backtick = lineOpeningRuns(content, "`");
  if (backtick.longest === 0) {
    return "```";
  }
  if (!backtick.bareThree) {
    return "`".repeat(backtick.longest + 1);
  }
  const tilde = lineOpeningRuns(content, "~");
  if (!tilde.bareThree) {
    return "~".repeat(Math.max(3, tilde.longest + 1));
  }
  return "`".repeat(backtick.longest + 1);
}

/** The two facts `fenceFor` needs about one fence character: the longest run
 *  that opens a line, and whether any line is a BARE run of exactly three (the
 *  closer the reader honours against every opener). */
function lineOpeningRuns(content: string, char: "`" | "~"): { longest: number; bareThree: boolean } {
  let longest = 0;
  let bareThree = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const run = fenceRun(trimmed);
    if (run === undefined || run.char !== char) {
      continue;
    }
    longest = Math.max(longest, run.len);
    if (run.len === 3 && trimmed.length === 3) {
      bareThree = true;
    }
  }
  return { longest, bareThree };
}

export interface RequestedFunctionExtraction {
  /** The reply cut down to the requested function. */
  text: string;
  /** Non-blank lines cut before the declaration head (imports, prose,
   *  re-typed comments). */
  trimmedBefore: number;
  /** Non-blank lines cut after the function's closing line (trailing helper
   *  functions, commentary). */
  trimmedAfter: number;
}

/**
 * Cut an instruct reply down to the one requested function, or undefined
 * when the reply does not contain it at all.
 *
 * The splice arithmetic guarantees WHERE bytes land (exactly the span), not
 * WHAT they are: a reply that prepends `use` lines or appends helper
 * functions would put whole extra top-level items inside the function span.
 * This guard anchors on the declaration head (the requested signature up
 * to and including its opening paren, which the prompt hands the model
 * verbatim) and keeps only the function.
 *
 * End-of-function detection is shaped for brace-language output at top
 * level (the head line unindented, the closing brace back at column 0), the
 * only shape the extension generates today. A single-line body ends on the
 * head line itself. When no closing line is found (indentation-body
 * languages, or output the model indented wholesale) the tail is kept
 * unjudged — degrading to today's behavior, never cutting mid-function.
 */
export function extractRequestedFunction(
  text: string,
  signature: string,
): RequestedFunctionExtraction | undefined {
  const sigLine = signature.split("\n")[0].trim();
  const paren = sigLine.indexOf("(");
  const head = paren === -1 ? sigLine : sigLine.slice(0, paren + 1);
  if (head === "") {
    return undefined;
  }

  // A function head ends at `(`, which is itself the boundary; a type header
  // (`pub struct Cache`) has no delimiter, so a plain startsWith would let a
  // sibling whose name extends the target steal the anchor (`pub struct
  // CacheEntry` matching `pub struct Cache`). For the no-paren case require a
  // non-identifier boundary after the head (whitespace, `{`, `<`, `(`, `;`,
  // end of line) so the match is the whole name, not a prefix of a longer one.
  const matchesHead =
    paren === -1
      ? (l: string) => {
          const t = l.trim();
          if (!t.startsWith(head)) {
            return false;
          }
          const after = t.charAt(head.length);
          return after === "" || !/[A-Za-z0-9_]/.test(after);
        }
      : (l: string) => l.trim().startsWith(head);

  const lines = text.split("\n");
  const headIdx = lines.findIndex(matchesHead);
  if (headIdx === -1) {
    return undefined;
  }

  // {…} opened and closed on the head line: a single-line body.
  let endIdx = /\{.*\}[;,]?\s*$/.test(lines[headIdx]) ? headIdx : -1;
  for (let i = headIdx + 1; endIdx === -1 && i < lines.length; i++) {
    if (/^[}\])]+[;,]?\s*$/.test(lines[i])) {
      endIdx = i;
    }
  }

  const nonBlank = (ls: string[]) => ls.filter((l) => l.trim() !== "").length;
  const end = endIdx === -1 ? lines.length - 1 : endIdx;
  return {
    text: lines.slice(headIdx, end + 1).join("\n"),
    trimmedBefore: nonBlank(lines.slice(0, headIdx)),
    trimmedAfter: nonBlank(lines.slice(end + 1)),
  };
}

/** Per-language lexing for the bare path's completeness scan, and the shape a
 *  bare reply's FIRST line may take.
 *
 *  This table is SEPARATE from the counting lens (`countingLensFor`) and stays
 *  separate. It is consulted only for a reply that arrived with no fence at
 *  all, and it answers a different question: whether the reply CLOSES, not what
 *  is inside it. Session-v70 phase 3 gave the counting lens its own per-language
 *  routing and measured the fenced move that came with it; the two lenses still
 *  disagree in the refusing direction, which amendment 3 of the P8 contract
 *  already settles. */
/** A literal whose body takes NO backslash escape at all. What ends it is the
 *  close delimiter and nothing else.
 *
 *  The C model that used to serve every language here eats the closing
 *  delimiter of `@"C:\dir\"` and of a Go raw `` `C:\dir\` ``, runs to EOF, and
 *  reports the reply as truncated. A path fixture is the ordinary way a
 *  trailing backslash reaches a test, so this was refusing good replies. */
interface RawStringRule {
  /** Matched anchored at the cursor, so it must carry the `y` flag. Group 1,
   *  where a language has one, is the hash run the close delimiter repeats
   *  (Rust's `r##"..."##`). */
  readonly open: RegExp;
  /** The close delimiter for a given open match. */
  readonly close: (open: RegExpExecArray) => string;
  /** A DOUBLED close delimiter inside the body is an escaped delimiter rather
   *  than the end. C# spells a quote inside a verbatim string `""`. */
  readonly doubledClose?: true;
}

interface BareLangRules {
  /** Line-comment markers. */
  readonly line: readonly string[];
  /** Block comments, when the language has them. Rust's nest; nobody else's do. */
  readonly block?: { readonly open: string; readonly close: string; readonly nests?: true };
  /** String delimiters, longest first so a triple quote wins over a single one.
   *  These are the C-style ones: opened and closed by the same delimiter, with
   *  a backslash escaping inside. Anything else goes in `raw`. */
  readonly quotes: readonly string[];
  /** Raw and verbatim string forms, tried BEFORE `quotes` so a prefixed opener
   *  (`@"`, `r#"`) wins over the bare delimiter sitting inside it. */
  readonly raw?: readonly RawStringRule[];
  /** The language spells a char or rune literal with `'`. See matchCharLiteral
   *  for why that cannot simply be another entry in `quotes`. */
  readonly charLiteral?: true;
  /** The language has regex literals delimited by `/`. See matchRegexLiteral
   *  for the division trap and how it is resolved. */
  readonly regexLiteral?: true;
  /** Suite-structured: the language ends its last statement with a newline
   *  rather than a delimiter, so the tail is anchored on INDENTATION. */
  readonly suite?: true;
  /** What may open a reply that is NOTHING BUT the tests. A reply opening with
   *  anything else is a chatty reply, and finding code inside one of those is
   *  the FENCE's job and stays the fence's job. */
  readonly opener: RegExp;
}

const BARE_LANG_RULES: Record<string, BareLangRules> = {
  rust: {
    line: ["//"],
    block: { open: "/*", close: "*/", nests: true },
    quotes: ['"'],
    // `r"..."`, `r#"..."#`, and the byte and C-string spellings of the same.
    // The hash run is whatever the author wrote and the close repeats it, so
    // the count is read off the open rather than enumerated.
    raw: [{ open: /(?:b|c)?r(#*)"/y, close: (m) => `"${m[1]}` }],
    charLiteral: true,
    opener: /^(#!?\[|mod\s|use\s|pub\s|fn\s|impl\s|extern\s|\/\/|\/\*)/,
  },
  go: {
    line: ["//"],
    block: { open: "/*", close: "*/" },
    quotes: ['"'],
    // A backtick string is raw: it has no escapes at all, so it cannot be a
    // `quotes` entry. It was one, and a body ending in a backslash lost its
    // closing backtick to the escape rule.
    raw: [{ open: /`/y, close: () => "`" }],
    charLiteral: true,
    opener: /^(package\s|import\s|func\s|var\s|const\s|type\s|\/\/|\/\*)/,
  },
  typescript: {
    line: ["//"],
    block: { open: "/*", close: "*/" },
    quotes: ['"', "'", "`"],
    regexLiteral: true,
    // `let\s` used to accept "let me know if you want more edge cases covered."
    // and a bare `@` used to accept a unified diff's `@@ -1,4 +1,9 @@` hunk
    // header. A declaration keyword has to be followed by something being
    // declared, and a decorator by an identifier.
    opener:
      /^(import\s|export\s|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*[:=]|function\s|class\s|async\s|@[A-Za-z_$]|describe\s*[.(]|it\s*[.(]|test\s*[.(]|suite\s*\(|beforeEach\s*\(|afterEach\s*\(|\/\/|\/\*)/,
  },
  python: {
    // Python closes its last statement with a NEWLINE, not a delimiter, so the
    // "nothing after the outermost close" rule below cannot be applied to it and
    // indentation is the anchor instead.
    suite: true,
    line: ["#"],
    quotes: ['"""', "'''", '"', "'"],
    // No `raw` entry on purpose. A Python raw string is not raw for the purpose
    // of FINDING its close: `r"\""` is a valid string holding `\"`, and `r"\"`
    // is a syntax error, because the backslash still binds the quote after it.
    // The C model is already the correct one here, and a prefix rule would make
    // it wrong.
    // `from\s` used to accept "from the docstring, parse raises ValueError...".
    // A `from` line is only an import when the `import` is on it.
    opener: /^(import\s|from\s+[\w.]+\s+import\b|def\s|class\s|async\s|@[A-Za-z_]|#)/,
  },
  csharp: {
    line: ["//"],
    block: { open: "/*", close: "*/" },
    // `'` stays a plain quote here rather than moving to `charLiteral`: C# has
    // no lifetime spelling, so `'` is unambiguous, and the backslash escape it
    // gets from `quotes` is the one a C# char literal actually has.
    quotes: ['"', "'"],
    // A verbatim string takes no backslash escape and spells an embedded quote
    // `""`, in all three orderings of the prefix.
    raw: [{ open: /(?:@\$?|\$@)"/y, close: () => '"', doubledClose: true }],
    // `using\s` used to accept "using the signature above, here are the tests".
    // A using DIRECTIVE ends in a `;` on its own line; a using STATEMENT opens
    // a paren.
    opener:
      /^(using\s+static\s|using\s*\(|using\s+[\w.]+\s*(?:=[^;]*)?;|namespace\s|public\s|internal\s|private\s|protected\s|static\s|partial\s|class\s|sealed\s|\[|\/\/|\/\*)/,
  },
};
BARE_LANG_RULES.typescriptreact = BARE_LANG_RULES.typescript;
BARE_LANG_RULES.javascript = BARE_LANG_RULES.typescript;
BARE_LANG_RULES.javascriptreact = BARE_LANG_RULES.typescript;

/**
 * The whole reply as a code block, for a reply that carries no fence at all.
 *
 * The Claude Code backend takes one outer fence off every reply by design (the
 * CLI wraps code in markdown and the fn-gen splice cannot carry a fence line).
 * The test-gen path keyed its extraction on that same fence, so every
 * well-formed test reply from that backend was refused in all five languages
 * and the user was told the reply contained no usable tests. It was not a bad
 * reply; it was a fence the backend had already removed.
 *
 * The fence was doing two jobs and only one of them needs a fence. FINDING the
 * code inside a chatty reply genuinely needs a delimiter, and that stays the
 * fence's job. REFUSING a reply that is not code does not: a reply that is
 * nothing but the tests satisfies it without one, because there is no prose to
 * separate from. So the discriminator moves from "has a fence" to "is a fence,
 * or is NOTHING BUT the tests", and every guard that keeps prose and bare
 * functions out of a document still runs afterwards on what this returns.
 *
 * Three things have to hold, and the second and third are what the fence used
 * to prove for free:
 *
 *  1. No fence line anywhere, decided on the RAW text, either marker. A lens
 *     would be more precise and is not worth it: being wrong the lenient way
 *     writes a bare fence line into a source file, and being wrong the strict
 *     way refuses a reply that documents its tests with a fenced example, which
 *     is rare and costs a re-run.
 *  2. It opens and closes as code, not as prose. A fenced reply may be chatty
 *     either side of its block; a bare one may not be, because there is nothing
 *     to say where the prose stops. Splicing on a guessed boundary is worse
 *     than refusing.
 *  3. It is structurally complete. A truncated reply stops mid-block, and a
 *     fenced one advertises that by having no closing fence. Not hypothetical:
 *     the Claude Code CLI ignores the token cap, and one reply in the measured
 *     arm ran to 2,809 output tokens.
 */
function bareCodeBlock(reply: string, languageId: string): string | undefined {
  const rules = BARE_LANG_RULES[languageId];
  if (rules === undefined) {
    return undefined;
  }
  const lines = reply.split("\n");
  for (const line of lines) {
    if (fenceRun(line.trim()) !== undefined) {
      return undefined;
    }
  }
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && lines[first].trim() === "") {
    first++;
  }
  while (last > first && lines[last].trim() === "") {
    last--;
  }
  if (first > last || lines[first].trim() === "") {
    return undefined;
  }
  if (!rules.opener.test(lines[first].trim())) {
    return undefined;
  }
  const text = lines.slice(first, last + 1).join("\n");
  const scanned = scanBare(text, rules);
  if (scanned === undefined) {
    return undefined;
  }
  return closesAsCode(scanned, rules) ? text : undefined;
}

/**
 * The reply must CLOSE as code, not merely contain some punctuation.
 *
 * The first cut tested one character class against the last non-blank line, and
 * an English sentence carrying a call walked straight through it: "Note: these
 * tests cover add(1, 2) and the overflow path." was ADMITTED and spliced into the
 * source file, as were markdown bullets and a unified diff's hunk body. A model
 * appending a coverage note is everyday behaviour, and the note does not even have
 * to sit outside the model's own fence to arrive here: the Claude Code backend
 * strips only the first and last lines when they are a fence pair, so
 * fence / module / note / fence lands on this path with no fence line in it.
 *
 * Prose is not trimmed off and the rest spliced. A guessed boundary is worse than
 * a refusal, and the contract says refused rather than silently trimmed.
 *
 * Two mechanisms, because two kinds of language:
 *
 *  - A BRACE language closes its last construct with a delimiter, so the anchor is
 *    exact: nothing but whitespace, `;` or `,` may follow the point where the
 *    outermost delimiter last returned to depth 0. A comment may follow, because
 *    the lens has already blanked it.
 *  - A SUITE language (Python) closes with a newline and has no such anchor, so
 *    the last non-blank line must be INDENTED, which a top-level prose sentence is
 *    not. The cost is a module whose final line sits at column 0, and that is the
 *    honest cheap answer rather than an indentation parser.
 */
function closesAsCode(scanned: ScannedBare, rules: BareLangRules): boolean {
  const lines = scanned.text.split("\n");
  let tail = lines.length - 1;
  while (tail > 0 && lines[tail].trim() === "") {
    tail--;
  }
  if (rules.suite === true) {
    const line = lines[tail];
    if (!/^[ \t]/.test(line) || line.trim() === "") {
      return false;
    }
    // Indentation says the line belongs to a suite; it does not say the line
    // FINISHED. A delimiter count is close to vacuous in Python, because a
    // statement opens nothing, so a reply cut mid-expression balances perfectly:
    // `assert add(1, 2) ==` was admitted, and what lands is a SyntaxError. Two
    // shapes cover what truncation actually produces - a header whose suite never
    // arrived, and an expression cut after its operator.
    return !/(?::|,|[=+\-*/%<>!&|^~]|\b(?:and|or|not|in|is|if|else|return|assert|yield|await|lambda))\s*$/.test(line);
  }
  if (scanned.lastClose === undefined) {
    // No delimiter ever opened, so there is no construct here to close.
    return false;
  }
  if (scanned.lastRegexEnd !== undefined && scanned.lastRegexEnd > scanned.lastClose) {
    // A regex is blanked WHOLE, delimiters included, so a trailing prose line
    // that happens to start and end with a slash leaves a line of spaces behind
    // and the gate below reads the `});` above it. The prose is then spliced
    // into the user's test file, which is the failure rule 9 exists to stop.
    //
    // Scoped to regexes on purpose. A string keeps its delimiters, so it never
    // looks blank, and a trailing COMMENT is code the model may write and is
    // meant to be allowed. Only a regex finishing after the module's last
    // closing delimiter is evidence that the lens invented a literal.
    return false;
  }
  // The last line must be nothing BUT the closing delimiters. "Nothing after the
  // outermost close" was the first attempt and prose defeats it: a markdown
  // bullet `- the overflow case (wrapping)` opens and closes a paren of its own,
  // which drags the close position forward into the prose and then finds nothing
  // after it. Where the construct ends cannot be read off a delimiter count when
  // the trailing text has delimiters too.
  //
  // The cost is a module written entirely on one line, which is refused. A model
  // asked for a table of rows does not write one, and a false refusal is the
  // direction that costs a re-run rather than a corrupted file.
  return /^[\s})\];,]+$/.test(lines[tail]);
}
/** Identifier characters, for the two places a prefix rule must not fire in the
 *  middle of a word. */
const BARE_WORD_CHAR = /[A-Za-z0-9_$]/;

/** Keywords after which a `/` opens a regex rather than dividing, because what
 *  follows each of them is an expression and not an operand. */
// `of` is NOT in the list. It is a legal identifier, and `of / 2` read as a
// regex opener blanked everything to the next slash on the line, a real `it(`
// included. The only text the entry could ever matter for is the two-token
// sequence `of /` in a for-of head, which no test writes; `in` stays, because
// it is reserved and can never be the identifier half of that defect.
const REGEX_AFTER_KEYWORD =
  /\b(?:return|typeof|instanceof|in|new|delete|void|case|do|else|yield|await|throw)$/;

/**
 * A char or rune literal at `i`, or undefined when what sits there is not one.
 *
 * `'` is deliberately NOT a `quotes` entry for Rust or Go, and for Rust it
 * cannot be: the same character opens a LIFETIME (`&'a str`, `'static`,
 * `'outer: loop`) which never closes, so a quote rule would report every
 * borrowing test as an unterminated string. Rust's own rows failed the other
 * way instead, on `'"'`: the `"` inside the char literal opened a phantom
 * string, and `assert_eq!(split_on('"'), 2)` was refused.
 *
 * So this asks for the close rather than assuming one. A literal is a single
 * character, or a backslash escape, followed by `'` on the same line. Anything
 * else leaves the `'` as an ordinary code character, which is INERT: it opens
 * nothing, closes nothing, and counts towards no delimiter. That inertness is
 * the whole safety argument. The ambiguous case does not guess; it falls back
 * to exactly the behaviour that shipped, which is the refusing direction for a
 * genuinely broken reply and costs a re-run rather than a corrupted file.
 */
function matchCharLiteral(text: string, i: number): number | undefined {
  if (text[i] !== "'") {
    return undefined;
  }
  if (text[i + 1] === "\\") {
    // The escaped character is consumed BEFORE the hunt for the close, so
    // `'\''` reads as an escaped quote rather than as a literal that ends one
    // character early. The bound is the longest escape any of these languages
    // spells, Rust's `\u{10FFFF}`; past that it is not a char literal.
    for (let k = i + 3; k < text.length && k <= i + 13; k++) {
      if (text[k] === "\n") {
        return undefined;
      }
      if (text[k] === "'") {
        return k + 1 - i;
      }
    }
    return undefined;
  }
  if (text[i + 1] === undefined || text[i + 1] === "\n") {
    return undefined;
  }
  if (text[i + 2] === "'") {
    return 3;
  }
  // An astral character is two UTF-16 units here and still one char literal.
  const point = text.codePointAt(i + 1);
  if (point !== undefined && point > 0xffff && text[i + 3] === "'") {
    return 4;
  }
  return undefined;
}

/**
 * Does the code emitted so far end in a VALUE?
 *
 * Read off the neutralised output, where comments and literals are already
 * blank, so scanning back over whitespace steps over a comment the way a lexer
 * does. `literalEnd` is how a literal is told apart from the whitespace it was
 * blanked into: a string is a value and the blanks it left behind are not.
 */
function endsInValue(out: readonly string[], literalEnd: number): boolean {
  let p = out.length - 1;
  while (p >= 0 && (out[p] === " " || out[p] === "\n" || out[p] === "\t" || out[p] === "\r")) {
    p--;
  }
  if (literalEnd > 0 && literalEnd > p) {
    // A literal ended at or after the last surviving code character, so the
    // most recent thing here is that literal. A literal is a value. This covers
    // both shapes the lens produces: a string keeps its delimiters, so `p` IS
    // the closing quote, and a regex is blanked whole, so `p` sits before it.
    return true;
  }
  if (p < 0) {
    // Start of input. An expression may begin here.
    return false;
  }
  const c = out[p];
  if (c === ")" || c === "]" || c === "}" || c === "<") {
    return true;
  }
  if ((c === "+" || c === "-") && out[p - 1] === c) {
    // `x++ / 2` and `x-- / 2` are divisions. A single `+` or `-` is an operator
    // and a value is expected after it, so the `/` opens a regex; a doubled one
    // is a postfix increment and there is already a value in hand. Reading it as
    // an operator opened a phantom regex that swallowed `/ f(2 /`, which hid an
    // unbalanced paren from the delimiter count in one direction and refused a
    // reply that parses in the other.
    //
    // A PREFIX `++x / 2` cannot be told from `a ++ / 2` by looking at the text,
    // and `a ++ / 2` is not valid anyway, so both read as a value.
    return true;
  }
  if (BARE_WORD_CHAR.test(c)) {
    let w = p;
    while (w >= 0 && BARE_WORD_CHAR.test(out[w])) {
      w--;
    }
    return !REGEX_AFTER_KEYWORD.test(out.slice(w + 1, p + 1).join(""));
  }
  return false;
}

/**
 * A regex literal at `i`, or undefined.
 *
 * The division trap governs this one. `a / b / c` is three operands and two
 * divisions, and lexing it as a regex would blank `b` along with any delimiter
 * inside it. That is the ADMITTING direction: it hides an unbalanced brace and
 * lets a truncated reply into the human's file. Failing to spot a real regex
 * only costs a refusal and a re-run, which is why the rule below is stated as
 * a refusal and errs towards division.
 *
 * The rule is the one a real JS lexer uses: a regex can only begin where an
 * OPERAND cannot. After an identifier, a number, a `)`, a `]`, a `}` or a
 * completed literal there is already a value in hand and the `/` divides it.
 * Everywhere else - after `(`, `,`, `=`, `:`, `;`, `{`, an operator, or one of
 * the keywords that takes an expression - a value is expected and the `/` opens
 * a regex.
 *
 * Two tokens are resolved against the language and in favour of refusing.
 *
 * `}` is genuinely ambiguous: a block ends with one, and an object literal IS a
 * value. It is read as a value, so `} /re/.test(x)` is not lexed. Nobody writes
 * that and the cost is a re-run.
 *
 * `<` is read as a value too, which is plainly wrong as a matter of JavaScript:
 * `a < /re/.test(b)` is legal and this refuses it. It is read that way because
 * of .tsx. Every JSX CLOSING TAG puts a `/` immediately after a `<`, so a
 * correct reading opens a regex on `</div>` and closes it on the next `/` on the
 * line, swallowing whatever sits between two tags. Measured on
 * `expect(fn(<div>{a}</div>)).toBe(<span>{b}</span>)`, that eats a paren and the
 * reply is refused for an unbalanced delimiter. A closing tag is on every second
 * line of a React test; a comparison against a regex property is on none.
 *
 * The second guard is that a regex literal closes on its OWN line. That is a
 * real lexical rule of the language and it also bounds what a mistake here can
 * swallow to the remainder of one line.
 */
function matchRegexLiteral(text: string, i: number, prevIsValue: boolean): number | undefined {
  if (text[i] !== "/" || prevIsValue) {
    return undefined;
  }
  // `//` and `/*` were taken as comments before this point; the check is here
  // so the function is safe to call from anywhere.
  if (text[i + 1] === "/" || text[i + 1] === "*" || text[i + 1] === undefined) {
    return undefined;
  }
  let k = i + 1;
  let inClass = false;
  while (k < text.length) {
    const c = text[k];
    if (c === "\n") {
      return undefined;
    }
    if (c === "\\") {
      k += 2;
      continue;
    }
    if (c === "[") {
      inClass = true;
    } else if (c === "]") {
      inClass = false;
    } else if (c === "/" && !inClass) {
      k++;
      while (k < text.length && /[a-z]/.test(text[k])) {
        k++;
      }
      return aloneOnItsLine(text, i, k) ? undefined : k - i;
    }
    k++;
  }
  return undefined;
}

/** Is the span `[i, end)` the only thing on its line? A regex literal that
 *  fills a line by itself is an expression statement that does nothing, and no
 *  test writes one. A prose line that starts and ends with a slash is exactly
 *  that shape: `/ see helper( for the rest /` lexed as a regex, its `(` was
 *  blanked before the delimiter count saw it, and a reply that does not parse
 *  was admitted. Left as text, the paren is counted and the reply is refused,
 *  which is what main did before the scanner knew regexes at all. */
function aloneOnItsLine(text: string, i: number, end: number): boolean {
  let b = i - 1;
  while (b >= 0 && (text[b] === " " || text[b] === "\t")) {
    b--;
  }
  if (b >= 0 && text[b] !== "\n") {
    return false;
  }
  let a = end;
  while (a < text.length && (text[a] === " " || text[a] === "\t" || text[a] === "\r")) {
    a++;
  }
  return a >= text.length || text[a] === "\n";
}

/**
 * One lexing pass for the bare path: neutralise comments and literals with THIS
 * language's rules, and refuse outright when the text ends inside one or leaves
 * a delimiter open.
 *
 * Returns the neutralised text, or undefined when the reply is not structurally
 * complete. An unterminated literal is its own answer rather than something
 * inferred from the delimiter count, because a reply can be cut after its last
 * brace closes and still be half a string.
 *
 * Literals are taken in a fixed order - comment, raw string, char literal,
 * regex, plain string - and the order is load-bearing. A raw form has to be
 * tried before `quotes` or the bare `"` inside `@"` wins and the prefix rule
 * never fires.
 */
interface ScannedBare {
  /** Comments and strings blanked, so a brace inside either is invisible. */
  readonly text: string;
  /** Index just past the character at which the outermost delimiter last
   *  returned to depth 0, or undefined when nothing ever opened. */
  readonly lastClose: number | undefined;
  /** Index just past the last REGEX literal blanked by the scan, or undefined
   *  when none was. A regex is the one literal the lens erases whole, so it is
   *  the one literal that can make a line of prose look like a blank line. */
  readonly lastRegexEnd: number | undefined;
}

function scanBare(text: string, rules: BareLangRules): ScannedBare | undefined {
  const out: string[] = [];
  const blank = (ch: string) => out.push(ch === "\n" ? "\n" : " ");
  const blankRun = (from: number, length: number) => {
    for (let k = 0; k < length; k++) {
      blank(text[from + k]);
    }
  };
  // A string's DELIMITERS survive the lens; only its body is blanked. Blanking
  // the delimiters too erases the fact that a value was ever there, and the
  // suite tail gate then reads a complete `assert label(1) == "one"` as an
  // expression cut after its `==`, because everything past the operator is
  // whitespace. That refused most Python tests there are, since asserting a
  // string value is the ordinary thing a test does. A brace inside the body is
  // still invisible, which is the only thing the delimiter count needs.
  const keepRun = (from: number, length: number) => {
    for (let k = 0; k < length; k++) {
      out.push(text[from + k]);
    }
  };
  let curly = 0;
  let round = 0;
  let square = 0;
  let lastClose: number | undefined;
  let lastRegexEnd: number | undefined;
  /** Length of `out` when the most recent literal finished, so the regex rule
   *  can tell a blanked literal from the whitespace it looks like. */
  let literalEnd = 0;
  let i = 0;
  while (i < text.length) {
    const lineMarker = rules.line.find((m) => text.startsWith(m, i));
    if (lineMarker !== undefined) {
      while (i < text.length && text[i] !== "\n") {
        blank(text[i]);
        i++;
      }
      continue;
    }
    if (rules.block !== undefined && text.startsWith(rules.block.open, i)) {
      const { open, close, nests } = rules.block;
      let depth = 1;
      blankRun(i, open.length);
      i += open.length;
      while (i < text.length && depth > 0) {
        if (nests === true && text.startsWith(open, i)) {
          depth++;
          blankRun(i, open.length);
          i += open.length;
        } else if (text.startsWith(close, i)) {
          depth--;
          blankRun(i, close.length);
          i += close.length;
        } else {
          blank(text[i]);
          i++;
        }
      }
      if (depth > 0) {
        return undefined;
      }
      continue;
    }
    const rawScan = scanRawString(text, i, rules, blank, blankRun, keepRun);
    if (rawScan === "unterminated") {
      return undefined;
    }
    if (rawScan !== undefined) {
      i = rawScan;
      literalEnd = out.length;
      continue;
    }
    if (rules.charLiteral === true) {
      const charLen = matchCharLiteral(text, i);
      if (charLen !== undefined) {
        blankRun(i, charLen);
        i += charLen;
        literalEnd = out.length;
        continue;
      }
    }
    // The `/` test belongs at the CALL SITE, not inside the matcher. Asking
    // `endsInValue` at every character of a TypeScript reply made the scan
    // quadratic: it walks back over the trailing whitespace run in the output,
    // and a run of comment lines is blanked to exactly that. A regex can only
    // start at a `/`, so the question is only ever worth asking there.
    if (rules.regexLiteral === true && text[i] === "/") {
      const regexLen = matchRegexLiteral(text, i, endsInValue(out, literalEnd));
      if (regexLen !== undefined) {
        blankRun(i, regexLen);
        i += regexLen;
        literalEnd = out.length;
        lastRegexEnd = i;
        continue;
      }
    }
    const quote = rules.quotes.find((q) => text.startsWith(q, i));
    if (quote !== undefined) {
      keepRun(i, quote.length);
      i += quote.length;
      let closed = false;
      while (i < text.length) {
        if (text[i] === "\\" && i + 1 < text.length) {
          blank(text[i]);
          blank(text[i + 1]);
          i += 2;
          continue;
        }
        if (text.startsWith(quote, i)) {
          keepRun(i, quote.length);
          i += quote.length;
          closed = true;
          break;
        }
        blank(text[i]);
        i++;
      }
      if (!closed) {
        return undefined;
      }
      literalEnd = out.length;
      continue;
    }
    const c = text[i];
    if (c === "{") {
      curly++;
    } else if (c === "}") {
      if (--curly < 0) return undefined;
    } else if (c === "(") {
      round++;
    } else if (c === ")") {
      if (--round < 0) return undefined;
    } else if (c === "[") {
      square++;
    } else if (c === "]") {
      if (--square < 0) return undefined;
    }
    if (curly + round + square === 0 && (c === "}" || c === ")" || c === "]")) {
      lastClose = i + 1;
    }
    out.push(c);
    i++;
  }
  return curly === 0 && round === 0 && square === 0
    ? { text: out.join(""), lastClose, lastRegexEnd }
    : undefined;
}

/**
 * Consume a raw or verbatim string starting at `i`, blanking it as it goes.
 *
 * Answers the index just past the literal, `"unterminated"` when the text ends
 * inside it, or undefined when no raw rule opens here. The three-way answer is
 * the point: running off the end of a raw string is a real refusal and must not
 * be confused with "there was nothing here", which is a fallthrough to the next
 * literal kind.
 */
function scanRawString(
  text: string,
  i: number,
  rules: BareLangRules,
  blank: (ch: string) => void,
  blankRun: (from: number, length: number) => void,
  keepRun: (from: number, length: number) => void
): number | "unterminated" | undefined {
  for (const rule of rules.raw ?? []) {
    rule.open.lastIndex = i;
    const opened = rule.open.exec(text);
    if (opened === null) {
      continue;
    }
    // A prefixed opener must not fire inside an identifier. `r"x"` is a raw
    // string; the `r` that happens to end some other word is not a prefix, and
    // reading it as one would swallow the string that follows it whole.
    if (BARE_WORD_CHAR.test(opened[0][0]) && i > 0 && BARE_WORD_CHAR.test(text[i - 1])) {
      continue;
    }
    const close = rule.close(opened);
    keepRun(i, opened[0].length);
    let k = i + opened[0].length;
    while (k < text.length) {
      if (text.startsWith(close, k)) {
        if (rule.doubledClose === true && text.startsWith(close, k + close.length)) {
          // `""` inside a C# verbatim string is one quote in the value, not the
          // end of it.
          blankRun(k, close.length * 2);
          k += close.length * 2;
          continue;
        }
        keepRun(k, close.length);
        return k + close.length;
      }
      blank(text[k]);
      k++;
    }
    return "unterminated";
  }
  return undefined;
}

export interface TestModuleExtraction {
  /** The reply cut to the mod tests block (the fenced content). */
  text: string;
  /** Count of #[test] functions found (>=1 on success). */
  testCount: number;
}

/**
 * Sibling of extractRequestedFunction: cut an instruct reply to its
 * `#[cfg(test)] mod tests { ... }` block, or undefined when the reply is not
 * a test module (no fenced block, no `mod` wrapper, or no `#[test]` fn). The
 * single-function shape is rejected — that rejection is the whole reason the
 * test pass cannot reuse extractRequestedFunction.
 */
export function extractTestModule(reply: string): TestModuleExtraction | undefined {
  // A complete fenced block, or a reply that is NOTHING BUT the module. A
  // `mod tests` sitting in bare prose is still not a reply we splice; see
  // bareCodeBlock for why the fence alone stopped being the test.
  const block = extractFirstCodeBlock(reply) ?? bareCodeBlock(reply, "rust");
  if (block === undefined) {
    return undefined;
  }
  // Detect the module wrapper and count `#[test]` on comment/string-NEUTRALIZED
  // text, never the raw block: a bare `#[test]` set whose comment or a string
  // literal merely mentions `mod foo` must NOT pass the wrapper guard (nor inflate
  // the count), and `#[test]` sitting in a comment is not a real test. The guard
  // has to read code, not prose. The RETURNED text is still the original block
  // (neutralization is a scan-only lens).
  const scan = neutralizeCommentsAndStrings(block);
  // The module wrapper AND at least one `#[test]` fn. Requiring the wrapper is
  // what rejects the single-function shape extractRequestedFunction would accept
  // (the whole reason the test pass needs its own guard); requiring a `#[test]`
  // rejects an empty or helper-only module.
  if (!/\bmod\s+[A-Za-z_]\w*/.test(scan)) {
    return undefined;
  }
  const testCount = (scan.match(/#\[\s*test\s*\]/g) ?? []).length;
  if (testCount === 0) {
    return undefined;
  }
  return { text: block, testCount };
}

/** What a generated TEST FUNCTION looks like, per language. Four of the five
 *  languages put their tests in a separate FILE whose wrapper the scaffold
 *  writes, so the reply is bare test functions and the `mod` wrapper Rust
 *  demands would be wrong to require.
 *
 *  The guard is still a guard: a reply with no test function in it is prose, a
 *  bare implementation, or an apology, and splicing it would put non-test code
 *  in a test file under a message saying tests were generated. */
const TEST_FUNCTION_SHAPES: Record<string, RegExp> = {
  go: /\bfunc\s+Test[A-Z_]\w*\s*\(/g,
  typescript: /\b(?:it|test)\s*(?:\.\w+)?\s*\(/g,
  typescriptreact: /\b(?:it|test)\s*(?:\.\w+)?\s*\(/g,
  javascript: /\b(?:it|test)\s*(?:\.\w+)?\s*\(/g,
  javascriptreact: /\b(?:it|test)\s*(?:\.\w+)?\s*\(/g,
  python: /^[ \t]*def\s+test\w*\s*\(/gm,
  // The ROW attributes are in the set as well as the METHOD attributes, and
  // they have to be. Session-v68's table shape asks NUnit for `[TestCase(...)]`
  // rows with NO `[Test]` beside them and MSTest for `[DataTestMethod]` plus
  // `[DataRow(...)]`, and the old set matched neither: it needs `]` or `(`
  // immediately after the name, so `[TestCase(` fails on the `C` and
  // `[DataTestMethod]` fails because the alternation must match at the `D`.
  // Two of the three C# frameworks refused the exact reply the prompt had just
  // demanded. `[TestCaseSource(` still does not match, because `Source` sits
  // where the delimiter must be.
  //
  // On a table reply this counts ROWS rather than methods. Only zero-vs-non-zero
  // is load-bearing (it is the reply guard); the number itself reaches one log
  // line and nothing else.
  csharp: /\[\s*(?:DataTestMethod|TestMethod|TestCase|InlineData|DataRow|Theory|Fact|Test)\s*[\]\(]/g,
};

/** An extra ADMISSION gate for the bare path, where the fenced path's pattern
 *  is too loose to be the whole guard.
 *
 *  Rust refuses a plain implementation on the bare path with its `mod` wrapper
 *  (contract rule 6). The other four languages have no wrapper, so the shape
 *  pattern is the entire guard, and the TypeScript one takes `RE.test(s)` as a
 *  test because `\b` holds after a dot. An implementation function that calls
 *  `.test()` on a regex therefore reads as a test file, and string-handling code
 *  is full of `.test(`.
 *
 *  This was unreachable on the bare path while the lexer refused any reply
 *  carrying a regex literal, for the wrong reason. Teaching it regexes removed
 *  that accident and left the loose pattern holding a door open, so the door is
 *  closed here rather than left to the accident.
 *
 *  A GATE and not a counter, which matters. Rule 5 says a bare and a fenced copy
 *  of one reply return the same `testCount`, so the number keeps coming from the
 *  pattern above in both paths; this only decides whether the bare reply is
 *  admitted at all. `it("x", () => expect(/^\{/.test(s)))` counts 2 either way
 *  and is admitted, because the gate found the real `it(`. The implementation
 *  with nothing but `RE.test(s)` in it finds none and is refused.
 *
 *  BARE ONLY, deliberately. Rule 1 makes the fenced numbers the measurement
 *  baseline for every language arm, and amendment 3 already settles that the
 *  bare lens may be narrower than the fenced one in the REFUSING direction.
 *  Being narrower costs a re-run; being wider writes the human's own
 *  implementation into their test file. */
const BARE_TEST_FUNCTION_SHAPES: Record<string, RegExp> = {
  typescript: /(?<![.$])\b(?:it|test)\s*(?:\.\w+)?\s*\(/g,
};
BARE_TEST_FUNCTION_SHAPES.typescriptreact = BARE_TEST_FUNCTION_SHAPES.typescript;
BARE_TEST_FUNCTION_SHAPES.javascript = BARE_TEST_FUNCTION_SHAPES.typescript;
BARE_TEST_FUNCTION_SHAPES.javascriptreact = BARE_TEST_FUNCTION_SHAPES.typescript;

/**
 * Cut a non-Rust instruct reply to its fenced block of TEST FUNCTIONS, or
 * undefined when the reply carries no fenced block or no test function.
 *
 * Sibling of extractTestModule, and deliberately NOT a widening of it: Rust's
 * guard requires a `mod` wrapper and counts `#[test]`, which is the shape that
 * rejects the bare-function reply — exactly the shape the other four languages
 * must ACCEPT. Same fence requirement, and the same neutralize-then-count
 * discipline, but through the lens of the reply's OWN language: a `def test_x`
 * inside a `'''` block, an `it(` inside a template literal and a
 * `func TestX(` inside a Go raw string are literal text and never inflate the
 * count.
 *
 * An unregistered languageId answers undefined rather than guessing a shape.
 */
export function extractTestFunctions(reply: string, languageId: string): TestModuleExtraction | undefined {
  const pattern = TEST_FUNCTION_SHAPES[languageId];
  if (pattern === undefined) {
    return undefined;
  }
  // A complete fence, `""` included, is the fenced path; only a reply with no
  // fence at all falls through to the bare one and picks up the extra gate.
  const fenced = extractFirstCodeBlock(reply);
  const block = fenced ?? bareCodeBlock(reply, languageId);
  if (block === undefined) {
    return undefined;
  }
  // The reply's OWN language's lens, not Rust's. Both the count below and the
  // bare gate beside it read this one buffer, so the gate can no longer be
  // satisfied by a shape the counter does not count.
  const neutral = countingLensFor(languageId)(block);
  const gate = fenced === undefined ? BARE_TEST_FUNCTION_SHAPES[languageId] : undefined;
  if (gate !== undefined && (neutral.match(gate) ?? []).length === 0) {
    return undefined;
  }
  const testCount = (neutral.match(pattern) ?? []).length;
  return testCount === 0 ? undefined : { text: block, testCount };
}

/**
 * Strip a leading `<think>…</think>` reasoning block. An unclosed `<think>`
 * drops the entire reply: everything after the tag is thought, and thought never
 * lands in a document. A reply with no leading think tag passes through verbatim.
 *
 * Shared by every extraction path so the test-authoring pass (whose reply is a
 * `mod tests` block, extracted from the RAW reply to keep its fence) gets the
 * same think guard as the function path. Thinking is default-off, but the
 * test-authoring pass may run with it on, so the guard must hold there.
 */
export function stripLeadingThink(raw: string): string {
  if (!raw.trimStart().startsWith("<think>")) {
    return raw;
  }
  const close = raw.indexOf("</think>");
  return close === -1 ? "" : raw.slice(close + "</think>".length);
}

/**
 * Full instruct-output cleanup: think-tag strip, code-block extraction with
 * bare-reply fallback, edge-whitespace normalization. Returns "" when
 * nothing survivable remains; callers treat "" as a failed generation.
 */
export function postprocessInstructOutput(raw: string): string {
  const remainder = stripLeadingThink(raw);

  const block = extractFirstCodeBlock(remainder);
  // "" is a complete-but-empty block, still the candidate; only undefined
  // (no complete fence) falls back to the bare-code reply.
  const candidate = block !== undefined ? block : remainder;

  const lines = candidate.split("\n");
  let first = 0;
  while (first < lines.length && lines[first].trim() === "") {
    first++;
  }
  return lines.slice(first).join("\n").replace(/\s+$/, "");
}

// Split on commas NOT inside a nested `{ }` group, so a grouped use tree can be
// walked one binding at a time.
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    } else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** A `use` tree (the whitespace-stripped text between `use ` and `;`) expanded
 *  into the individual full paths it brings into scope, so a grouped import
 *  matches a single one:
 *    fastbloom::BloomFilter               -> [fastbloom::BloomFilter]
 *    std::collections::{HashMap,HashSet}  -> [std::collections::HashMap, std::collections::HashSet]
 *    a::{b::{C,D},E}                       -> [a::b::C, a::b::D, a::E]
 *    a::{self,B}                           -> [a, a::B]
 *  Aliases (`x as Y`) and globs (`x::*`) ride through verbatim, so each matches
 *  only an identical alias/glob - never stripped by accident. */
export function expandUse(tree: string): string[] {
  const p = tree.trim();
  const open = p.indexOf("{");
  if (open === -1) {
    return p.length > 0 ? [p] : [];
  }
  const prefix = p.slice(0, open);
  const inner = p.slice(open + 1, p.lastIndexOf("}"));
  const out: string[] = [];
  for (const raw of splitTopLevelCommas(inner)) {
    const part = raw.trim();
    if (part === "") {
      continue;
    }
    if (part === "self") {
      out.push(prefix.replace(/::$/, "")); // a::b::{self} -> a::b
    } else {
      out.push(...expandUse(prefix + part)); // recurse for nested groups
    }
  }
  return out;
}

/** Every individual path brought into scope by a file's MODULE-SCOPE `use`
 *  statements (column 0; a leading `pub`/`pub(crate)` is allowed since a
 *  re-export is still in the file's own scope), grouped imports expanded. */
export function fileImportBindings(source: string): Set<string> {
  const bindings = new Set<string>();
  for (const line of source.split("\n")) {
    const m = /^(?:pub\s*(?:\([^)]*\))?\s+)?use\s+([^;]+);/.exec(line);
    if (m) {
      for (const b of expandUse(m[1].replace(/\s+/g, ""))) {
        bindings.add(b);
      }
    }
  }
  return bindings;
}

/** Blank every comment and string-literal region of a Rust source to spaces,
 *  preserving newlines (and therefore every line boundary and column). So a
 *  `struct Foo` that is really the text of a block comment, a `"..."` string, or
 *  a line comment cannot be mistaken for a real module-scope definition.
 *
 *  Char literals ARE tracked, disambiguated from lifetimes by shape: a char
 *  literal is `'` + one char (or an escape) + a closing `'`; a lifetime (`'a`,
 *  `'static`) has no closing quote. This matters because a quote-bearing char
 *  literal (`'"'`) would otherwise flip string parity - its `"` opening a
 *  spurious region that closes on the NEXT genuine string's opening quote,
 *  re-exposing that string's content as live code. That is an ADD-a-false-name
 *  path, and a false name over-strips a genuine external `use`; consuming the
 *  char literal whole closes it. A `'` that is not a char literal is a lifetime
 *  and passes through as ordinary code. */
export function neutralizeCommentsAndStrings(source: string): string {
  const out: string[] = [];
  const n = source.length;
  // A neutral region emits a space for every consumed char except a newline,
  // which is preserved so line splitting and column-0 detection still align.
  const blank = (ch: string) => out.push(ch === "\n" ? "\n" : " ");
  let i = 0;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && source[i] !== "\n") {
        blank(source[i]);
        i++;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      let depth = 1; // Rust block comments nest
      blank(c);
      blank(c2);
      i += 2;
      while (i < n && depth > 0) {
        if (source[i] === "/" && source[i + 1] === "*") {
          depth++;
          blank(source[i]);
          blank(source[i + 1]);
          i += 2;
        } else if (source[i] === "*" && source[i + 1] === "/") {
          depth--;
          blank(source[i]);
          blank(source[i + 1]);
          i += 2;
        } else {
          blank(source[i]);
          i++;
        }
      }
      continue;
    }
    // Raw string: r"...", r#"..."#, and the byte-raw br#"..."# forms. The close
    // is a quote followed by the same number of `#`. Not a raw string (a bare
    // `r`/`br` identifier) falls through to the normal char path.
    if (c === "r" || (c === "b" && c2 === "r")) {
      let j = c === "b" ? i + 2 : i + 1;
      let hashes = 0;
      while (source[j] === "#") {
        hashes++;
        j++;
      }
      if (source[j] === '"') {
        for (let k = i; k <= j; k++) {
          blank(source[k]);
        }
        i = j + 1;
        const close = '"' + "#".repeat(hashes);
        while (i < n) {
          if (source.startsWith(close, i)) {
            for (let k = 0; k < close.length; k++) {
              blank(close[k]);
            }
            i += close.length;
            break;
          }
          blank(source[i]);
          i++;
        }
        continue;
      }
    }
    // Char literal: `'x'`, `'\n'`, `'\''`, `'"'`, `'\u{1F600}'`. Consumed whole
    // so a quote it contains never opens a string region. A `'` that does not
    // form a char literal is a lifetime (`'a`) and falls through to code.
    if (c === "'") {
      const lit = /^'(?:\\(?:u\{[0-9a-fA-F]{1,6}\}|x[0-9a-fA-F]{2}|['"\\nrt0])|[^'\\\n])'/.exec(
        source.slice(i),
      );
      if (lit) {
        for (let k = 0; k < lit[0].length; k++) {
          blank(lit[0][k]);
        }
        i += lit[0].length;
        continue;
      }
    }
    if (c === '"') {
      blank(c);
      i++;
      while (i < n) {
        if (source[i] === "\\") {
          blank(source[i]);
          blank(source[i + 1]);
          i += 2;
        } else if (source[i] === '"') {
          blank(source[i]);
          i++;
          break;
        } else {
          blank(source[i]);
          i++;
        }
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/** Every name DEFINED at module scope in a Rust source file: `struct` / `enum` /
 *  `fn` / `type` / `const` / `static` / `trait` / `mod` / `union`, a leading
 *  `pub` / `pub(crate)` / `pub(super)` allowed. The bare defined name only
 *  (generics and the rest of the header dropped): `struct Wrapper<T>` -> Wrapper.
 *
 *  Module scope means the definition line begins at column 0. A name defined
 *  inside a fn body or an impl block is indented and NOT a file-level symbol, so
 *  it never enters the set. `use` imports are NOT definitions - that is
 *  fileImportBindings' job. The complement to fileImportBindings: together they
 *  are every bare name resolvable in the file without a fresh import, which is
 *  what a generated body may reference without the model inventing a `use`. */
export function fileLocalDefinitions(source: string): Set<string> {
  const defs = new Set<string>();
  // Neutralise comments and strings first: a `struct Foo` that is only the text
  // of a comment or a string literal must never enter the set, or it would
  // over-strip a genuine external `use ...::Foo;` from a generated body.
  for (const line of neutralizeCommentsAndStrings(source).split("\n")) {
    // Module scope only: a leading space means the definition is nested inside
    // a fn/impl/mod block, never a file-level symbol.
    if (line === "" || /^\s/.test(line)) {
      continue;
    }
    // Strip a visibility prefix; a `pub` item is still the file's own scope.
    let rest = line.replace(/^pub\s*(?:\([^)]*\))?\s+/, "");
    // Consume fn-qualifier keywords (`const fn`, `async unsafe fn`,
    // `extern "C" fn`) so the captured name is the fn's, not the qualifier's.
    // `const`/`static` are qualifiers ONLY when a fn follows; otherwise they are
    // the item keyword and the next token is the const/static's own name.
    for (;;) {
      const m = /^(\w+)(?:\s+"[^"]*")?\s+/.exec(rest);
      if (!m) {
        break;
      }
      const word = m[1];
      if (word === "async" || word === "unsafe" || word === "extern") {
        rest = rest.slice(m[0].length);
        continue;
      }
      if (word === "const" || word === "static") {
        const after = rest.slice(m[0].length);
        if (/^(?:async\s+|unsafe\s+|extern\s+(?:"[^"]*"\s+)?)*fn\b/.test(after)) {
          rest = after;
          continue;
        }
      }
      break;
    }
    const dm =
      /^(?:struct|enum|fn|type|const|static|trait|mod|union)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
    if (dm) {
      defs.add(dm[1]);
    }
  }
  return defs;
}

// The TS sibling of neutralizeCommentsAndStrings, lexing TS rules rather than
// Rust's: `//` and NON-nesting `/* */` comments; `'`, `"`, and backtick strings
// with backslash escapes. Single/double-quote strings terminate at an unescaped
// newline (JS strings cannot span lines bare); a backtick template runs on
// across lines, so a column-0 keyword inside one is blanked, never scanned.
// Template interpolation is not modeled - a nested backtick inside `${...}` can
// flip parity - the accepted residual for this scan-only consumer.
//
// Regex literals are OPT-IN, `regexLiterals` off by default, and the default is
// what `tsFileLocalDefinitions` on the prompt path reads. Left unmodelled, a
// delimiter inside a regex is lexed as itself: a backtick in `` /`{3}/ `` opens
// a template that runs to the end of the file, so a fence-handling module's
// tests counted zero and its reply was refused. Turning the rule on for the
// COUNTING lens fixes that; turning it on for the definition finder would move
// the prompt's definition set, which is a different phase with its own rows.
//
// The rule itself is not restated here. The `/` is handed to the SAME
// `matchRegexLiteral` and `endsInValue` the bare scanner uses, so the division
// trap, the `.tsx` closing-tag reading and the alone-on-its-line guard exist in
// one place and cannot drift between the two call sites. `literalEnd` is the
// bookkeeping those two need: it marks where the most recent LITERAL ended, so
// a blanked literal is told apart from the whitespace it looks like. Comments
// do not set it, exactly as in `scanBare` - a comment is not a value, and the
// token before it is what decides the `/`.
function neutralizeTsCommentsAndStrings(source: string, opts?: { regexLiterals?: boolean }): string {
  const out: string[] = [];
  const blank = (ch: string) => out.push(ch === "\n" ? "\n" : " ");
  const n = source.length;
  /** Length of `out` when the most recent literal finished. Only read when
   *  `regexLiterals` is on. */
  let literalEnd = 0;
  let i = 0;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && source[i] !== "\n") {
        blank(source[i]);
        i++;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      blank(c);
      blank(c2);
      i += 2;
      while (i < n) {
        if (source[i] === "*" && source[i + 1] === "/") {
          blank(source[i]);
          blank(source[i + 1]);
          i += 2;
          break;
        }
        blank(source[i]);
        i++;
      }
      continue;
    }
    // Comments are taken above, so a `/` reaching here is a division or a
    // regex, and only `matchRegexLiteral` can tell them apart. Asking at the
    // `/` and nowhere else is deliberate: `endsInValue` walks back over the
    // trailing whitespace run in the output, and asking at every character
    // makes the scan quadratic on a comment-heavy file.
    if (opts?.regexLiterals === true && c === "/") {
      const regexLen = matchRegexLiteral(source, i, endsInValue(out, literalEnd));
      if (regexLen !== undefined) {
        for (let k = 0; k < regexLen; k++) {
          blank(source[i + k]);
        }
        i += regexLen;
        literalEnd = out.length;
        continue;
      }
    }
    if (c === '"' || c === "'" || c === "`") {
      blank(c);
      i++;
      while (i < n) {
        if (source[i] === "\\") {
          blank(source[i]);
          if (i + 1 < n) {
            blank(source[i + 1]);
          }
          i += 2;
          continue;
        }
        if (c !== "`" && source[i] === "\n") {
          break; // an unterminated quote string ends at the line, like the parser
        }
        if (source[i] === c) {
          blank(source[i]);
          i++;
          break;
        }
        blank(source[i]);
        i++;
      }
      literalEnd = out.length;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/** Every name DEFINED at the top level of a TS/JS source file: `function` /
 *  `class` / `interface` / `enum` / `type` / `const` / `let` / `var` (and the
 *  `const enum` compound), with `export` / `export default` / `declare` /
 *  `abstract` / `async` prefixes allowed. Column-0 discipline mirrors the Rust
 *  scanner: an indented definition belongs to an enclosing scope, never the
 *  file level. Declared scope limits: only the first declarator of a
 *  multi-declarator `const a = 1, b = 2` is captured, and `namespace`/`module`
 *  blocks are not scanned - false-misses only, the name merely goes unmentioned
 *  in the prompt. */
export function tsFileLocalDefinitions(source: string): Set<string> {
  const defs = new Set<string>();
  for (const line of neutralizeTsCommentsAndStrings(source).split("\n")) {
    if (line === "" || /^\s/.test(line)) {
      continue;
    }
    const rest = line
      .replace(/^export\s+(?:default\s+)?/, "")
      .replace(/^declare\s+/, "")
      .replace(/^abstract\s+/, "")
      .replace(/^async\s+/, "");
    // `const enum` first, so the name group never captures the keyword `enum`.
    const dm = /^(?:const\s+enum|function|class|interface|enum|type|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(rest);
    if (dm) {
      defs.add(dm[1]);
    }
  }
  return defs;
}

// The Python sibling of neutralizeCommentsAndStrings: `#` comments and
// string literals ('/"/'''/""" with escapes) blank to spaces, newlines
// preserved so column-0 detection still aligns. An f/r/b prefix falls through
// as code and the quote after it opens the string, which is all the scan needs.
export function neutralizePythonCommentsAndStrings(source: string): string {
  const out: string[] = [];
  const blank = (ch: string) => out.push(ch === "\n" ? "\n" : " ");
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    if (c === "#") {
      while (i < n && source[i] !== "\n") {
        blank(source[i]);
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const close = source.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      for (let k = 0; k < close.length; k++) {
        blank(source[i + k]);
      }
      i += close.length;
      while (i < n) {
        if (source[i] === "\\") {
          blank(source[i]);
          if (i + 1 < n) {
            blank(source[i + 1]);
          }
          i += 2;
          continue;
        }
        // An unterminated single-quote string ends at the line, like Python's
        // own tokenizer; a triple-quote block runs on.
        if (close.length === 1 && source[i] === "\n") {
          break;
        }
        if (source.startsWith(close, i)) {
          for (let k = 0; k < close.length; k++) {
            blank(source[i + k]);
          }
          i += close.length;
          break;
        }
        blank(source[i]);
        i++;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/** Every name DEFINED at the top level of a Python source file: column-0
 *  `def` / `async def` / `class`. Deliberately NOT top-level assignments -
 *  constants are prose-ambiguous and the def/class set is what a generated
 *  body would wrongly re-import. */
export function pyFileLocalDefinitions(source: string): Set<string> {
  const defs = new Set<string>();
  for (const line of neutralizePythonCommentsAndStrings(source).split("\n")) {
    const dm = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (dm) {
      defs.add(dm[1]);
    }
  }
  return defs;
}

// Go's neutralizer. NOT the TS one: a Go raw string (backticks) takes no
// escapes — `\` is a literal byte — while the TS neutralizer honors `\``
// inside template literals, so one backslash before a raw string's closing
// backtick would swallow every definition after it (review F22). Line/block
// comments, escaped `"` strings and `'` runes match the TS rules.
function neutralizeGoCommentsAndStrings(source: string): string {
  const out: string[] = [];
  const blank = (ch: string) => out.push(ch === "\n" ? "\n" : " ");
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && source[i] !== "\n") {
        blank(source[i]);
        i++;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      blank(c);
      blank(c2);
      i += 2;
      while (i < n) {
        if (source[i] === "*" && source[i + 1] === "/") {
          blank(source[i]);
          blank(source[i + 1]);
          i += 2;
          break;
        }
        blank(source[i]);
        i++;
      }
      continue;
    }
    if (c === "`") {
      blank(c);
      i++;
      while (i < n && source[i] !== "`") {
        blank(source[i]);
        i++;
      }
      if (i < n) {
        blank(source[i]);
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      blank(c);
      i++;
      while (i < n) {
        if (source[i] === "\\") {
          blank(source[i]);
          if (i + 1 < n) {
            blank(source[i + 1]);
          }
          i += 2;
          continue;
        }
        if (source[i] === "\n") {
          break; // an unterminated quote string ends at the line, like the parser
        }
        if (source[i] === c) {
          blank(source[i]);
          i++;
          break;
        }
        blank(source[i]);
        i++;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

// C#'s neutralizer, new in session-v70 phase 3. There was none before, so a
// C# reply was lexed by Rust's rules, and the three places the two grammars
// disagree all cost a real count:
//   - `@"..."` is VERBATIM: the only escape is a doubled quote, and a
//     backslash is a byte. Under the C escape rule a path ending `\"` eats its
//     own closing quote, the rest of the file reads as one string, and every
//     later `[Fact]` stops being counted. That is the under-count direction,
//     and it loses real tests rather than inventing fake ones.
//   - a block comment does NOT nest. Rust's does, so `/* a /* b */` leaves
//     Rust's lens still inside a comment while C# is back in code.
//   - `$"..."` interpolation holes and `{{`/`}}` escapes are not parsed. The
//     whole literal blanks either way, so a hole cannot change a count; what
//     it costs is that a test shape written INSIDE a hole is invisible, which
//     runs in the refusing direction and is the same residual the TS lens
//     already carries for `${...}`.
//   - the C# 11 raw string (`"""`) is its own literal, not `""` followed by a
//     one-line string. Read the second way every line of the body is code, so a
//     scaffold helper whose raw string holds a `[Fact]` was admitted as a test
//     file and a real test file's count went up by whatever its raw strings
//     quoted.
// `//`, a plain `"..."` (backslash escapes, terminated by the line like the
// compiler's own rule) and a `'c'` char literal match Rust's reading and are
// lexed the same way here.
function neutralizeCSharpCommentsAndStrings(source: string): string {
  const out: string[] = [];
  const blank = (ch: string) => out.push(ch === "\n" ? "\n" : " ");
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && source[i] !== "\n") {
        blank(source[i]);
        i++;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      blank(c);
      blank(c2);
      i += 2;
      while (i < n) {
        if (source[i] === "*" && source[i + 1] === "/") {
          blank(source[i]);
          blank(source[i + 1]);
          i += 2;
          break; // the FIRST close ends it: C# block comments do not nest
        }
        blank(source[i]);
        i++;
      }
      continue;
    }
    // Verbatim: `@"`, `$@"`, `@$"`. Spans lines, no backslash escape, and the
    // only escape is `""`. A bare `@` (the `@class` identifier prefix) falls
    // through to code.
    const verbatim =
      (c === "@" && c2 === '"' && 2) ||
      (c === "@" && c2 === "$" && source[i + 2] === '"' && 3) ||
      (c === "$" && c2 === "@" && source[i + 2] === '"' && 3);
    if (verbatim) {
      for (let k = 0; k < verbatim; k++) {
        blank(source[i + k]);
      }
      i += verbatim;
      while (i < n) {
        if (source[i] === '"' && source[i + 1] === '"') {
          blank(source[i]);
          blank(source[i + 1]);
          i += 2;
          continue;
        }
        if (source[i] === '"') {
          blank(source[i]);
          i++;
          break;
        }
        blank(source[i]);
        i++;
      }
      continue;
    }
    // A C# 11 raw string: a run of three or more `"`, optionally prefixed by a
    // run of `$` (`"""`, `$"""`, `$$"""`). The body runs to the next run of at
    // least as many quotes and blanks whole, across lines. There is no escape
    // character to model, which is the point of the form: a shorter quote run
    // inside the body is content, not a close.
    //
    // Tried BEFORE the `$"` and `"` branches below. Read by those, `"""` is an
    // empty string plus a third quote that dies at the end of its line, and
    // every line of the body is then lexed as code.
    //
    // A raw string with no closing run blanks to the end of the reply, and the
    // tests after it stop being counted. That is the refusing direction, which
    // is the one to be wrong in: a literal left open is what a truncated reply
    // looks like, and the alternative is reading its body as code.
    if (c === '"' || c === "$") {
      let dollars = 0;
      while (source[i + dollars] === "$") {
        dollars++;
      }
      let openQuotes = 0;
      while (source[i + dollars + openQuotes] === '"') {
        openQuotes++;
      }
      if (openQuotes >= 3) {
        const open = dollars + openQuotes;
        for (let k = 0; k < open; k++) {
          blank(source[i + k]);
        }
        i += open;
        while (i < n) {
          if (source[i] !== '"') {
            blank(source[i]);
            i++;
            continue;
          }
          let run = 0;
          while (source[i + run] === '"') {
            run++;
          }
          for (let k = 0; k < run; k++) {
            blank(source[i + k]);
          }
          i += run;
          if (run >= openQuotes) {
            break;
          }
        }
        continue;
      }
      // The run declined. Only the LAST `$` can open anything (`$"`, `$@"`),
      // so the rest of the run is code and goes out in one step. Pushing one
      // `$` and re-counting the whole run from the next one was quadratic:
      // 32,000 dollars cost 386ms, and a small model in a repetition loop
      // emits exactly that.
      if (dollars > 1) {
        for (let k = 0; k < dollars - 1; k++) {
          out.push(source[i + k]);
        }
        i += dollars - 1;
        continue;
      }
    }
    // A plain or `$`-interpolated string. Backslash escapes, and it cannot
    // span a line: a reply cut mid-literal must not blank every test after it.
    if (c === '"' || (c === "$" && c2 === '"')) {
      const open = c === "$" ? 2 : 1;
      for (let k = 0; k < open; k++) {
        blank(source[i + k]);
      }
      i += open;
      while (i < n) {
        if (source[i] === "\\") {
          blank(source[i]);
          if (i + 1 < n) {
            blank(source[i + 1]);
          }
          i += 2;
          continue;
        }
        if (source[i] === "\n") {
          break;
        }
        if (source[i] === '"') {
          blank(source[i]);
          i++;
          break;
        }
        blank(source[i]);
        i++;
      }
      continue;
    }
    // Char literal, consumed whole so a quote or a brace it holds never flips
    // parity: `'x'`, `'\n'`, `'\''`, `'"'`, `'\\'`, `'A'`, `'\x41'`.
    if (c === "'") {
      const lit = /^'(?:\\(?:u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|x[0-9a-fA-F]{1,4}|['"\\0abfnrtv])|[^'\\\n])'/.exec(
        source.slice(i),
      );
      if (lit) {
        for (let k = 0; k < lit[0].length; k++) {
          blank(lit[0][k]);
        }
        i += lit[0].length;
        continue;
      }
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/** The comment/string lens a reply is COUNTED through, chosen by the reply's
 *  languageId. Before session-v70 phase 3 every language was counted through
 *  the Rust lens, so a TypeScript single-quoted string, a Go raw string, a
 *  Python triple-quoted block and every C# verbatim form were not literals to
 *  the counter: a test shape hiding in one was counted as a test, and a
 *  mis-lexed C# verbatim string swallowed real ones.
 *
 *  The same choice serves the count and the bare admission gate beside it.
 *  Two lenses there is what let an implementation whose string holds `it(`
 *  satisfy the gate that exists to refuse it.
 *
 *  TypeScript is counted with the regex rule ON. The prompt path's
 *  `tsFileLocalDefinitions` reads the same lens with it off, because a regex
 *  rule changes the definition set it hands the model and that is not this
 *  phase's move. The counter needs it: a backtick or a quote inside a regex
 *  literal opened a string that ran past every later test.
 *
 *  An unregistered languageId never reaches here: `extractTestFunctions`
 *  answers undefined on the shape table first. The Rust fallback is therefore
 *  unreachable today, since every key in `TEST_FUNCTION_SHAPES` has a branch
 *  above it. It stays as the answer for an id added to that table before it is
 *  given a lens of its own. */
function countingLensFor(languageId: string): (source: string) => string {
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return (source) => neutralizeTsCommentsAndStrings(source, { regexLiterals: true });
  }
  if (languageId === "python") {
    return neutralizePythonCommentsAndStrings;
  }
  if (languageId === "go") {
    return neutralizeGoCommentsAndStrings;
  }
  if (languageId === "csharp") {
    return neutralizeCSharpCommentsAndStrings;
  }
  return neutralizeCommentsAndStrings;
}

/** Every name DEFINED at the top level of a Go source file: column-0 `func
 *  Name` and `type Name`. Methods (`func (r T) Name`) are excluded — a
 *  generated body reaches them through their receiver, never by re-import —
 *  and var/const stay out for the same prose-ambiguity reason as Python's
 *  assignments. */
export function goFileLocalDefinitions(source: string): Set<string> {
  const defs = new Set<string>();
  for (const line of neutralizeGoCommentsAndStrings(source).split("\n")) {
    const dm = /^(?:func|type)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (dm) {
      defs.add(dm[1]);
    }
  }
  return defs;
}

/** Per-language dispatch for the file-local definition scan. Rust keeps the
 *  original scanner byte-for-byte; TS and Python get the column-0 siblings
 *  above; C# is deliberately dark - its file-level definitions sit indented
 *  inside a namespace block, invisible to any column-0 scan (reaching them
 *  needs the symbol provider, out of the de-rust slice's scope); an
 *  unregistered language scans nothing. */
export function fileLocalDefinitionsFor(languageId: string, source: string): Set<string> {
  if (languageId === "rust") {
    return fileLocalDefinitions(source);
  }
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return tsFileLocalDefinitions(source);
  }
  if (languageId === "python") {
    return pyFileLocalDefinitions(source);
  }
  if (languageId === "go") {
    return goFileLocalDefinitions(source);
  }
  return new Set();
}

/** The index of a genuine CODE reference to `name` in a doc comment, or -1. The
 *  doc is prose, not code (unlike a signature), so a bare lowercase whole-word
 *  match would select an English verb that merely equals a short local name
 *  (`count`, `build`, `map`). A real reference is either backtick-quoted
 *  (`` `count` ``, or a path leaf `` `a::Reg` ``) or a PascalCase type-shaped
 *  name - the same signature-is-code / doc-is-prose split typesNamedIn makes. */
// A whole-identifier probe for `name`. `\b` cannot border `$` (not a word
// char), so a TS `users$`/`$state` would never match; explicit lookarounds on
// the identifier class replace it, behavior-identical for Rust/Python names.
function identifierProbe(name: string): RegExp {
  const safe = name.replace(/\$/g, "\\$");
  return new RegExp(`(?<![A-Za-z0-9_$])${safe}(?![A-Za-z0-9_$])`);
}

function docReferenceIndex(name: string, doc: string): number {
  // A PascalCase name is type-shaped; a bare whole-word mention is a reference.
  if (/^[A-Z]/.test(name)) {
    const m = identifierProbe(name).exec(doc);
    if (m) {
      return m.index;
    }
  }
  // Backtick-quoted mention (any case), possibly as a path leaf: `name`, `a::name`.
  const span = new RegExp("`[^`]*" + identifierProbe(name).source + "[^`]*`").exec(doc);
  if (span) {
    const inner = identifierProbe(name).exec(span[0]);
    return span.index + (inner ? inner.index : 0);
  }
  return -1;
}

/** The subset of `localDefs` (file-local definition names, from
 *  fileLocalDefinitions) that the target's signature or doc actually references,
 *  in first-seen order scanning the signature then the doc. Only a local name the
 *  model can see referenced is worth naming in the prompt; the rest is noise. The
 *  signature is code - any WHOLE-WORD match counts (so `Reg` never matches inside
 *  `CohortRegister`). The doc is prose - only a backtick-quoted or PascalCase
 *  reference counts, so a prose verb equal to a short local name is not selected.
 *  Pure. */
export function referencedLocalSymbols(
  signature: string,
  docComment: string | undefined,
  localDefs: Set<string>,
): string[] {
  if (localDefs.size === 0) {
    return [];
  }
  const doc = docComment ?? "";
  const hits: { name: string; idx: number }[] = [];
  for (const name of localDefs) {
    const inSig = identifierProbe(name).exec(signature);
    if (inSig) {
      hits.push({ name, idx: inSig.index });
      continue;
    }
    // Doc hits sort after every signature hit, preserving signature-then-doc
    // first-seen order (the +1 stands in for the separator between the two).
    const di = docReferenceIndex(name, doc);
    if (di >= 0) {
      hits.push({ name, idx: signature.length + 1 + di });
    }
  }
  hits.sort((a, b) => a.idx - b.idx);
  return hits.map((h) => h.name);
}

/** Render a set of full import paths back into one `use` tree body (the text
 *  between `use ` and `;`): a single path verbatim, or a group under the longest
 *  common `::` prefix (`std::collections::{HashMap, HashSet}`). */
function renderUseTree(paths: string[]): string {
  if (paths.length === 1) {
    return paths[0];
  }
  const split = paths.map((p) => p.split("::"));
  const prefix: string[] = [];
  for (let i = 0; ; i++) {
    const seg = split[0][i];
    // Never consume the last segment of the shortest path: the leaf must stay
    // in the group, not migrate into the shared prefix.
    if (seg === undefined || split.some((s) => i >= s.length - 1)) {
      break;
    }
    if (split.every((s) => s[i] === seg)) {
      prefix.push(seg);
    } else {
      break;
    }
  }
  const leaves = split.map((s) => s.slice(prefix.length).join("::"));
  const head = prefix.length > 0 ? prefix.join("::") + "::" : "";
  return `${head}{${leaves.join(", ")}}`;
}

/** Drop a function-local `use ...;` whose final path segment (leaf) names a
 *  symbol DEFINED in the same file - the model invented an import for a type
 *  that is right there in the file, because the prompt is signature + doc only.
 *  The deterministic kill for `use atlas::CohortRegister;` when CohortRegister is
 *  a same-file `pub struct`: the bare name already resolves locally.
 *
 *  Guarded against over-strip: a `use` whose leaf is NOT a local definition is
 *  KEPT verbatim (a genuinely external import must survive). In a grouped import
 *  only the local-shadowing members are dropped; external members are re-rendered
 *  and kept. An ALIAS (`use x::Local as Y;`) is kept - the binding is `Y`, a
 *  distinct name that does not collide with the local `Local`, so it may be
 *  intentional. A glob is kept. A blank line orphaned by a full removal is
 *  collapsed, matching stripRedundantUses. */
export function stripLocalShadowingUses(body: string, localDefs: Set<string>): string {
  if (localDefs.size === 0) {
    return body;
  }
  const keep = (path: string): boolean => {
    if (/\bas\b/.test(path) || path.endsWith("*")) {
      return true; // alias / glob: a distinct binding, never a local shadow
    }
    const leaf = path.split("::").pop() ?? "";
    return !localDefs.has(leaf.trim());
  };
  const lines = body.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)use\s+([^;]+);\s*$/.exec(lines[i]);
    if (m) {
      const paths = expandUse(m[2].trim());
      if (paths.length > 0) {
        const kept = paths.filter(keep);
        if (kept.length === 0) {
          if (lines[i + 1] !== undefined && lines[i + 1].trim() === "") {
            i++;
          }
          continue;
        }
        if (kept.length < paths.length) {
          out.push(`${m[1]}use ${renderUseTree(kept)};`);
          continue;
        }
      }
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** Drop a function-local `use ...;` the model added defensively - the fn-gen
 *  prompt is signature + doc only, so it cannot see the file's imports and
 *  re-imports a name already in scope. Strip it ONLY when EVERY path it
 *  introduces is already a file import (so a single `use a::X;` is removed
 *  against a grouped `use a::{X,Y};`, but a use bringing in something new is kept
 *  for the qualify pass or the human). A blank line orphaned by the removal is
 *  collapsed. Pure over the generated body and the file's import set. */
export function stripRedundantUses(body: string, fileBindings: Set<string>): string {
  if (fileBindings.size === 0) {
    return body;
  }
  const lines = body.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*use\s+([^;]+);\s*$/.exec(lines[i]);
    if (m) {
      const bound = expandUse(m[1].replace(/\s+/g, ""));
      if (bound.length > 0 && bound.every((b) => fileBindings.has(b))) {
        if (lines[i + 1] !== undefined && lines[i + 1].trim() === "") {
          i++;
        }
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}
