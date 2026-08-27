/**
 * Criticize's detector seam: what a detector is handed, what it says back, and
 * the two readers it must go through to look at the code.
 *
 * WHY A DETERMINISTIC SEAM AT ALL. Session-v60 let a model decide what a
 * function's findings were and got a different list on every press of unchanged
 * bytes: 0 of 3 identical finding sets on three real functions at temperature 0,
 * and the arm that reached 3 of 3 did it by returning nothing. A finding set
 * that is a function of the model's sampling cannot be stabilised, so the
 * findings here are a function of the CODE. The model's later job is to explain
 * a finding in the developer's terms, never to add or drop one.
 *
 * TWO RULES BELOW WERE PAID FOR IN MEASURED SCOUT FAILURES, and both produced a
 * zero that looked exactly like a real one:
 *
 *  - THE SLICE INCLUDES THE DOC COMMENT. The scout's "stated contract,
 *    unenforced" probe read 0.0% because its slicer began at the `fn` line, so
 *    the doc it inspects was never in its input. Fixed, it reads 0.8%. On the
 *    same table, one genuine 0.0% (command-query separation in Rust) sat beside
 *    it and the two were indistinguishable from the output alone.
 *  - THE DOC HARVESTER READS DOWNWARD IN PYTHON. Measured on 510 Python
 *    functions: 68.0% put the doc inside the body as a docstring, 1.4% put it
 *    above the signature the way the other four languages do. A harvester that
 *    walks upward finds nothing two times in three.
 *
 * Detectors never index into `lines` themselves for the doc, and never test a
 * pattern against a raw body line. `docLines` and `maskedBody` are the only two
 * ways in, because each carries one of those measured lessons.
 *
 * Never imports vscode (the src/core rule). Pure, total and deterministic: no
 * clock, no filesystem, no throw, and the same input gives the same output.
 */

// ===========================================================================
// The unit under review
// ===========================================================================

/**
 * One function, sliced out of its document, with everything a detector is
 * allowed to see.
 *
 * The invariants are load-bearing rather than decorative, and a violation is a
 * defect in the producer rather than something a detector shrugs at:
 *
 *   0 <= headIndex < bodyIndex <= lines.length
 *
 * `lines.slice(0, headIndex)` CONTAINS the doc block for the four brace
 * languages, and is not identical to it. An attribute, a decorator or a
 * toolchain directive may sit between the doc comment and the head, and does on
 * 29.2% of the documented functions in the measured Rust crate. `docLines`
 * steps over those; nothing else may slice the doc by hand.
 *
 * `lines.slice(headIndex, bodyIndex)` is the declaration head, and in Python it
 * also holds the docstring, because Python's doc lives inside the body. The
 * head's LAST line may also carry the whole body: see `bodyLines`.
 */
export interface FunctionUnderReview {
  languageId: string;
  name: string;
  /** Every line of the function's slice, DOC COMMENT FIRST. A slice that begins
   *  at the declaration head is a defect: it is the scout's second rig failure
   *  and it read a real detector as 0.0%. */
  lines: readonly string[];
  /** 1-based document line number of lines[0]. */
  startLine: number;
  /** Index into `lines` of the declaration head. 0 means no doc comment above. */
  headIndex: number;
  /** Index into `lines` of the first line of the body proper. For Python this
   *  is AFTER the docstring, because Python puts its doc inside the body. */
  bodyIndex: number;
}

/**
 * Why a `FunctionUnderReview` cannot be reviewed, or undefined when it can.
 *
 * A detector calls this before it looks at anything, because the alternative is
 * a silent zero: a bodyIndex past the end of `lines` makes every body scan read
 * an empty body and report a clean function that was never examined. The
 * session rule is that a zero from a rig that cannot fire is a fact about the
 * rig, so the malformed case is refused BY NAME instead.
 */
export function unitDefect(fn: FunctionUnderReview): string | undefined {
  if (fn.lines.length === 0) {
    return `the slice for ${fn.name} has no lines, so there is nothing to review`;
  }
  if (fn.startLine < 1) {
    return `the slice for ${fn.name} starts at document line ${fn.startLine}, and document lines are 1-based`;
  }
  if (fn.headIndex < 0 || fn.headIndex >= fn.bodyIndex) {
    return `the slice for ${fn.name} has headIndex ${fn.headIndex} and bodyIndex ${fn.bodyIndex}, which breaks 0 <= headIndex < bodyIndex`;
  }
  if (fn.bodyIndex > fn.lines.length) {
    return `the slice for ${fn.name} has bodyIndex ${fn.bodyIndex} past its ${fn.lines.length} lines, so its body was never in the input`;
  }
  return undefined;
}

// ===========================================================================
// The per-language profile
// ===========================================================================

/**
 * One parameter, as the language spelled it.
 *
 * `type` is optional because Python is optional. Measured on 510 Python
 * functions: 13.7% annotate every parameter, so the four dimensions that read a
 * type are blind on most Python code and have to say so.
 */
export interface ParsedParam {
  name: string;
  /** The declared type as written, or undefined when the language did not make
   *  the developer write one. Python is the reason this is optional. */
  type: string | undefined;
  /** True when the language spelled several names against one type, as Go's
   *  `func f(a, b int)` does. Dimension 5 must not fire on these: the grouped
   *  spelling is 8.3% of the Go standard library, measured over 39,394
   *  declarations, so flagging it would be flagging Go rather than the code. */
  grouped: boolean;
}

/**
 * How dimension 14 changes MEANING across the five languages.
 *
 * One idea, five detectors: "can this fail in a way the signature never
 * admits". Rust answers with a panic against a plain return type, Go with a
 * dropped error, C# with a throw the doc never lists, Python with an
 * undocumented raise, and TypeScript cannot answer at all. The last case is a
 * `blind` outcome with a reason, never a clean one, because a language with no
 * checked exceptions has nothing in a signature that could have admitted a
 * throw.
 */
export type FailureRule =
  | { kind: "panic-without-result"; spellings: readonly RegExp[] }
  | { kind: "dropped-error" }
  | { kind: "undocumented-throw" }
  | { kind: "raise-without-doc" }
  | { kind: "unknowable"; reason: string };

/**
 * A string literal whose delimiters are not a bare quote.
 *
 * THE MASK IS THE PRECISION, so a literal form the mask does not know is a
 * literal form whose contents are handed to the detectors as code. Three of
 * these were measured leaking: Rust's `r#"..."#` (234 of the 245 lines carrying
 * `r#"` in the measured Rust crate hold an inner `"`, because they are JSON, so
 * the guarantee was broken on 95% of that crate's raw strings), C# 11's
 * `"""..."""`, and C#'s `@"..."`. The last one leaked the OTHER way: `@"C:\"`
 * has no backslash escape, so a masker that honours one decides the closing
 * quote is escaped, finds no close, and blanks the rest of a real line of code.
 *
 * `open` is anchored at the scan position with a `^`. Its one optional capture
 * group is a delimiter run the closer has to mirror, which is how Rust spells
 * `r##"..."##`: `%` in `closeTemplate` is replaced by whatever was captured.
 */
export interface VerbatimString {
  open: RegExp;
  /** The closing delimiter, with `%` standing for the mirrored capture. */
  closeTemplate: string;
  /** True where the literal has NO backslash escape and doubles its closing
   *  delimiter instead, which is how C# writes a quote inside `@"..."`. */
  doubledClose: boolean;
  /** True where the literal may legally run past the end of its line, so
   *  `maskedBody` carries it forward. */
  spans: boolean;
}

/** What makes a declaration part of a public surface. Five languages, five
 *  different answers, and the profile decides rather than the detector. */
export type PublicSurface =
  | { kind: "keyword"; pattern: RegExp }
  | { kind: "capitalised" }
  | { kind: "leading-underscore" };

/**
 * The knobs dimensions 5 to 15 read, which is where the per-language cost of
 * this subsystem actually sits.
 *
 * The honesty block above needed five name tables and no control flow. This
 * block does not get off so lightly: "what is a parameter", "what is public"
 * and "what enforces a precondition" are genuinely five different questions,
 * and dimension 14 is five different detectors wearing one dimension id.
 */
export interface CriticizeCraft {
  /** How the parameter list is spelled. Drives `parseParams`. */
  paramStyle: "rust" | "go" | "csharp" | "typescript" | "python";
  /** The language's boolean, as a parameter would spell it. */
  boolTypes: readonly string[];
  /** Return types that mean "this is a command, it answers nothing". Empty for
   *  Go, which says the same thing by writing no result at all. */
  unitReturns: readonly string[];
  /** True where a leading underscore is the language's OWN way of saying
   *  "deliberately unused". C# has no such convention, so an unused C#
   *  parameter fires however it is named. */
  underscoreMeansUnused: boolean;
  /** CHOSEN, not measured. See docs/constants.md. */
  paramCountThreshold: number;
  /** CHOSEN, not measured. See docs/constants.md. */
  nestingThreshold: number;
  /** Python counts INDENTATION. A brace counter reads every Python function as
   *  depth zero, and that zero is spelled exactly like a clean result. */
  blocks: "braces" | "indentation";
  publicSurface: PublicSurface;
  /** The line dimension 9 speaks with. Python's names the fact that the
   *  language enforces its own convention nowhere, because that belongs in the
   *  finding rather than in a refusal. */
  undocumentedDetail: string;
  /** Vocabulary that ENFORCES a stated precondition. Shares nothing across the
   *  five, which is why it is a table and not a shared regex. */
  guards: readonly RegExp[];
  /** Assignments to state that outlives the call. */
  mutations: readonly RegExp[];
  /** Whether the receiver alone is the mutation (Rust's `&mut self` declares
   *  it in the signature), whether it must be written through (Go's pointer
   *  receiver), or whether the receiver says nothing. */
  receiverMutation: "mut-self" | "pointer-receiver" | "none";
  failure: FailureRule;
}

/**
 * One language's tables. The honesty block is one build with five of these:
 * all five grammars were written side by side in the scout harness and not one
 * needed its own control flow. A clock is a list of spellings.
 */
export interface CriticizeLang {
  languageIds: readonly string[];
  displayName: string;
  honesty: {
    clock: readonly RegExp[];
    prng: readonly RegExp[];
    env: readonly RegExp[];
    world: readonly RegExp[];
  };
  lineComment: string;
  /** Spellings that write a log rather than read the world. Dimension 4 must
   *  never fire on one. Measured: "writes a log" is 16.1% of Python functions
   *  and it is NOT the dishonesty the frame is about, because printing does not
   *  make a result unreproducible. Left in, the Python leg would spend its
   *  whole budget telling people their scripts print. */
  logWrites: readonly RegExp[];
  /** String literals this language spells with something other than a bare
   *  quote, longest and most specific first. Empty for a language that has
   *  none. See `VerbatimString` for why a profile has to declare these. */
  verbatimStrings: readonly VerbatimString[];
  /** The dimension 5 to 15 knobs. Phase 1 reads none of them. */
  craft: CriticizeCraft;
}

// ===========================================================================
// Findings and outcomes
// ===========================================================================

export type DimensionId =
  | "clock" | "prng" | "env" | "world"
  | "adjacent-params" | "bool-param" | "unused-param" | "param-count"
  | "undocumented" | "unenforced-precondition" | "cqs"
  | "pass-through" | "nesting"
  | "unadmitted-failure"
  | "section-comment";

export interface DetectorFinding {
  dimension: DimensionId;
  /** 1-based DOCUMENT line, not an index into `lines`. */
  line: number;
  /** The offending line's own text, trimmed. The evidence itself, never a
   *  summary of it. Empty string is never valid. */
  evidence: string;
  /** What fired, in the detector's words. One line, lower case, no prose, no
   *  advice, and it never names a fix. The rubric advises; it does not
   *  repair, because the honest fix for every honesty finding changes the
   *  signature and ripples to every caller. */
  detail: string;
}

/**
 * How one dimension read one function.
 *
 * `blind` is how a leg refuses BY NAME, and it is the difference between "this
 * function does not read the clock" and "nothing here can tell you whether it
 * does". The two are the same output otherwise, which is exactly how the
 * scout's rig failure hid. `reason` is required, is a sentence, and names the
 * language and the cause.
 */
export type DimensionOutcome =
  | { state: "clean" }
  | { state: "flagged"; findings: readonly DetectorFinding[] }
  | { state: "blind"; reason: string };

/**
 * One dimension of the rubric.
 *
 * `source` is the curriculum line, and naming the principle is the whole
 * difference between a lint and a teacher: a lint says line 14 mutates and
 * returns, a teacher says which law that breaks. It comes from the lineage
 * section of docs/perfect-functions.md and is never empty.
 */
export interface Detector {
  dimension: DimensionId;
  /** Which half of the rubric this serves. */
  axis: "safer" | "understandable" | "both";
  source: string;
  /** True while a dimension ships SCORED but NOT ELEVATED, pending a human
   *  ruling on whether it is a nit flood or a thing worth teaching. The
   *  renderer reads this FLAG and never a dimension id, so the ruling moves one
   *  boolean and touches no rendering code. */
  held?: boolean;
  run(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome;
}

// ===========================================================================
// Masking
// ===========================================================================

/**
 * How a construct that opened on an earlier line continues onto this one.
 *
 * `maskLine` starts from `open` every time it is called; only `maskedBody`
 * carries the state forward, which is why a block comment spanning three lines
 * is only fully hidden when a detector reads the body through `maskedBody`.
 */
type Carry =
  | { kind: "open" }
  | { kind: "block-comment" }
  | { kind: "string"; delimiter: string }
  | { kind: "verbatim"; close: string; doubledClose: boolean };

/** The quoting and commenting shapes, derived from the one field the profile
 *  already carries. The four brace languages share `//`, `/* ... *\/` and
 *  backtick templates; Python is the one profile spelled `#`, and it is also
 *  the one with triple-quoted strings. Reading it off `lineComment` keeps
 *  CriticizeLang exactly the shape the seam contract pins. */
function syntaxOf(lang: CriticizeLang): {
  blockOpen?: string;
  blockClose?: string;
  /** Delimiters that may legally span lines, longest first so `"""` is tried
   *  before `"`. */
  spanning: readonly string[];
} {
  if (lang.lineComment === "#") {
    return { spanning: ['"""', "'''"] };
  }
  return { blockOpen: "/*", blockClose: "*/", spanning: ["`"] };
}

/** Index of the next `needle` at or after `from` that is not backslash-escaped,
 *  or -1. An odd run of backslashes escapes; an even run is itself escaped. */
function indexOfUnescaped(line: string, needle: string, from: number): number {
  let at = line.indexOf(needle, from);
  while (at > 0) {
    let slashes = 0;
    for (let i = at - 1; i >= 0 && line[i] === "\\"; i--) {
      slashes++;
    }
    if (slashes % 2 === 0) {
      return at;
    }
    at = line.indexOf(needle, at + 1);
  }
  return at;
}

/**
 * The end of a verbatim literal that opened at `from`, or -1 when it runs past
 * the end of this line.
 *
 * A doubled closing delimiter is an ESCAPED one and the literal continues:
 * `@"say ""hi"" now"` is one string, not three. Skipping the pair rather than
 * closing on the first half is the whole difference.
 */
function endOfVerbatim(line: string, close: string, doubledClose: boolean, from: number): number {
  let at = line.indexOf(close, from);
  while (at >= 0) {
    if (doubledClose && line.startsWith(close, at + close.length)) {
      at = line.indexOf(close, at + close.length * 2);
      continue;
    }
    return at + close.length;
  }
  return -1;
}

/** The verbatim form opening at `at`, with its capture already mirrored into
 *  the closing delimiter, or undefined when none opens here. */
function verbatimAt(
  line: string,
  at: number,
  forms: readonly VerbatimString[],
): { close: string; doubledClose: boolean; spans: boolean; length: number } | undefined {
  // An opener that starts with a letter (Rust's `r#"`) must not be read out of
  // the tail of an identifier, or `substr#` would open a raw string.
  const previous = at > 0 ? line[at - 1] : "";
  for (const form of forms) {
    const hit = form.open.exec(line.slice(at));
    if (hit === null) {
      continue;
    }
    if (/[A-Za-z_]/.test(hit[0][0]) && /[\w$]/.test(previous)) {
      continue;
    }
    return {
      close: form.closeTemplate.replace("%", hit[1] ?? ""),
      doubledClose: form.doubledClose,
      spans: form.spans,
      length: hit[0].length,
    };
  }
  return undefined;
}

/** Mask `[from, to)` of `chars` with spaces. Width survives so a finding can
 *  still quote the ORIGINAL line and a column position still means something. */
function blank(chars: string[], from: number, to: number): void {
  for (let i = from; i < to && i < chars.length; i++) {
    chars[i] = " ";
  }
}

/** A quoted form whose braces hold CODE rather than text: a JavaScript template
 *  literal and a Python f-string. Both blank their text and keep their
 *  interpolations, and they differ only in how they spell the three parts. */
interface InterpolationShape {
  open: string;
  close: string;
  /** Python escapes a literal brace by doubling it; JavaScript does not. */
  doubledBrace: boolean;
}

const TEMPLATE_SHAPE: InterpolationShape = { open: "${", close: "`", doubledBrace: false };

/** Whether the quote at `at` opens an f-string. The prefix letters sit in front
 *  of the quote and any order of them is legal, so `rf"..."` and `fr"..."` both
 *  count and `rb"..."` does not. */
function fStringShape(line: string, at: number, quote: string): InterpolationShape | undefined {
  const prefix = line.slice(0, at).match(/[A-Za-z]+$/)?.[0] ?? "";
  if (prefix.length > 2 || !/[fF]/.test(prefix) || !/^[rbfuRBFU]+$/.test(prefix)) {
    return undefined;
  }
  return { open: "{", close: quote, doubledBrace: true };
}

/**
 * Mask an interpolated string from `at`, leaving its interpolations INTACT.
 *
 * An interpolation is code, not string content. Blanking it was measured
 * against this repo's own TypeScript: `return \`${node.filePath}#${node.line}\`;`
 * hides both reads of `node`, and dimension 7 then reports a parameter the body
 * uses on its only line as never mentioned. It ran at 7.9% of 2197 functions.
 * The same hole runs the other way for the honesty block, where a `Date.now()`
 * inside an interpolation is a real clock read that nothing could see. Python's
 * f-string is the same shape with different punctuation, and it carried 25 of
 * the 308 unused-parameter findings on a 4,412-function Python corpus.
 *
 * Returns where the scan should continue and whether the literal closed on this
 * line. A brace that does not close on the line leaves the rest of it intact,
 * which is the safe direction: exposing code loses nothing, and hiding it loses
 * a signal.
 */
function maskTemplate(
  chars: string[],
  line: string,
  at: number,
  opened: boolean,
  shape: InterpolationShape = TEMPLATE_SHAPE,
): { next: number; closed: boolean } {
  let i = opened ? at : at + 1;
  if (!opened) {
    chars[at] = " ";
  }
  while (i < line.length) {
    if (line[i] === "\\") {
      blank(chars, i, i + 2);
      i += 2;
      continue;
    }
    // Python writes a literal brace as `{{`, and reading that as an
    // interpolation would expose the rest of the string as code.
    if (shape.doubledBrace && (line.startsWith("{{", i) || line.startsWith("}}", i))) {
      blank(chars, i, i + 2);
      i += 2;
      continue;
    }
    if (line.startsWith(shape.open, i)) {
      let depth = 0;
      let j = i + shape.open.length - 1;
      for (; j < line.length; j++) {
        if (line[j] === "{") {
          depth++;
        } else if (line[j] === "}") {
          depth--;
          if (depth === 0) {
            break;
          }
        }
      }
      if (j >= line.length) {
        return { next: line.length, closed: false };
      }
      i = j + 1;
      continue;
    }
    if (line.startsWith(shape.close, i)) {
      blank(chars, i, i + shape.close.length);
      return { next: i + shape.close.length, closed: true };
    }
    chars[i] = " ";
    i++;
  }
  return { next: line.length, closed: false };
}

/**
 * Mask one line, given what the previous line left open, and report what this
 * line leaves open in turn.
 *
 * SINGLE QUOTES ARE ONLY MASKED WHEN THEY CLOSE ON THE SAME LINE. Rust spells a
 * lifetime `&'a str`, and treating that apostrophe as a string opener would
 * blank the rest of a real line of code. The cost is the other direction: two
 * lifetimes on one line look like a quoted region and the code between them is
 * hidden. That trade is deliberate, because hiding code loses a signal while
 * exposing a comment invents one, and this seam's precision comes from never
 * inventing.
 *
 * A double-quoted string that does not close on its line is masked to the end
 * of the line and NOT carried. Rust and C# can both hold a newline inside one,
 * so carrying would sometimes be more correct, but a single mis-parse would
 * then blank the whole rest of the function and hand back a silent clean.
 * Bounded damage beats correct-until-it-is-not.
 */
function maskWithCarry(line: string, lang: CriticizeLang, carry: Carry): { masked: string; carry: Carry } {
  const syntax = syntaxOf(lang);
  const chars = line.split("");
  let i = 0;
  let state = carry;

  while (i < line.length) {
    if (state.kind === "block-comment") {
      const close = line.indexOf(syntax.blockClose ?? "*/", i);
      if (close < 0) {
        blank(chars, i, line.length);
        break;
      }
      blank(chars, i, close + 2);
      i = close + 2;
      state = { kind: "open" };
      continue;
    }

    if (state.kind === "verbatim") {
      const end = endOfVerbatim(line, state.close, state.doubledClose, i);
      if (end < 0) {
        blank(chars, i, line.length);
        break;
      }
      blank(chars, i, end);
      i = end;
      state = { kind: "open" };
      continue;
    }

    if (state.kind === "string" && state.delimiter === "`") {
      const step = maskTemplate(chars, line, i, true);
      i = step.next;
      if (!step.closed) {
        break;
      }
      state = { kind: "open" };
      continue;
    }

    if (state.kind === "string") {
      const close = indexOfUnescaped(line, state.delimiter, i);
      if (close < 0) {
        blank(chars, i, line.length);
        break;
      }
      blank(chars, i, close + state.delimiter.length);
      i = close + state.delimiter.length;
      state = { kind: "open" };
      continue;
    }

    if (line.startsWith(lang.lineComment, i)) {
      blank(chars, i, line.length);
      break;
    }

    if (syntax.blockOpen && line.startsWith(syntax.blockOpen, i)) {
      // The opener is CONSUMED before the search for the closer begins. Leaving
      // the index on it lets `/*/` find the overlapping `*/` at offset 1 and
      // read an unterminated comment as an empty one, which exposes the whole
      // commented-out remainder of the line as code.
      blank(chars, i, i + syntax.blockOpen.length);
      i += syntax.blockOpen.length;
      state = { kind: "block-comment" };
      continue;
    }

    // Before any bare-quote handling: a verbatim opener starts with characters
    // a plain-string scanner would either skip past or mis-close on.
    const verbatim = verbatimAt(line, i, lang.verbatimStrings);
    if (verbatim !== undefined) {
      const end = endOfVerbatim(line, verbatim.close, verbatim.doubledClose, i + verbatim.length);
      if (end < 0) {
        blank(chars, i, line.length);
        if (verbatim.spans) {
          state = { kind: "verbatim", close: verbatim.close, doubledClose: verbatim.doubledClose };
        }
        break;
      }
      blank(chars, i, end);
      i = end;
      continue;
    }

    const spanning = syntax.spanning.find((d) => line.startsWith(d, i));
    if (spanning === "`") {
      const step = maskTemplate(chars, line, i, false);
      i = step.next;
      if (!step.closed) {
        state = { kind: "string", delimiter: "`" };
        break;
      }
      continue;
    }
    if (spanning) {
      const close = indexOfUnescaped(line, spanning, i + spanning.length);
      if (close < 0) {
        blank(chars, i, line.length);
        state = { kind: "string", delimiter: spanning };
        break;
      }
      blank(chars, i, close + spanning.length);
      i = close + spanning.length;
      continue;
    }

    const ch = line[i];
    if (ch === '"' || ch === "'") {
      const shape = fStringShape(line, i, ch);
      if (shape !== undefined) {
        i = maskTemplate(chars, line, i, false, shape).next;
        continue;
      }
    }
    if (ch === '"') {
      const close = indexOfUnescaped(line, '"', i + 1);
      blank(chars, i, close < 0 ? line.length : close + 1);
      i = close < 0 ? line.length : close + 1;
      continue;
    }
    if (ch === "'") {
      const close = indexOfUnescaped(line, "'", i + 1);
      if (close >= 0) {
        blank(chars, i, close + 1);
        i = close + 1;
        continue;
      }
    }
    i++;
  }

  return { masked: chars.join(""), carry: state };
}

/**
 * One line with its line comment, its string literals and its char literals
 * replaced by spaces of the same width, so column positions survive.
 *
 * MASKING IS WHERE PRECISION COMES FROM. `Instant::now()` inside a comment, a
 * doc example, a string literal or a `//` line is not a clock read, and a
 * detector that fires on one has told the developer something false about their
 * own function. Every honesty detector reads the body through this.
 *
 * Called with no history, so a line sitting in the middle of a block comment is
 * masked as though it were code. Use `maskedBody` for anything spanning lines.
 */
export function maskLine(line: string, lang: CriticizeLang): string {
  return maskWithCarry(line, lang, { kind: "open" }).masked;
}

/**
 * The body lines, masked, with block comments and multi-line strings removed
 * across line boundaries. Index i of the result corresponds to
 * `lines[bodyIndex + i]`.
 *
 * A malformed unit yields an empty body here, which is why every detector calls
 * `unitDefect` first rather than treating the emptiness as a clean function.
 */
export function maskedBody(fn: FunctionUnderReview, lang: CriticizeLang): readonly string[] {
  return bodyLines(fn, lang).map((entry) => entry.masked);
}

/**
 * Where the body opens on a masked declaration head line, or -1.
 *
 * The opener is the first `{` or `=>` (Python: the first `:`) at bracket depth
 * zero. Depth matters: `function f(cb = () => {}) {` writes an arrow and a brace
 * inside its own parameter list, and taking either of those as the body opener
 * would hand a piece of the signature to the detectors as body.
 */
function bodyOpenerEnd(masked: string, lang: CriticizeLang): number {
  const openers = lang.craft.blocks === "indentation" ? [":"] : ["{", "=>"];
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if ("([".includes(ch)) {
      depth++;
      continue;
    }
    if (")]".includes(ch)) {
      depth--;
      continue;
    }
    if (depth > 0) {
      continue;
    }
    const opener = openers.find((o) => masked.startsWith(o, i));
    if (opener !== undefined) {
      return i + opener.length;
    }
  }
  return -1;
}

/** Whether what is left of a head line after its body opener is CODE, rather
 *  than the punctuation that ends a declaration. `fn f() {` leaves nothing;
 *  `fn f() { Instant::now() }` leaves a clock read. */
function carriesCode(remainder: string): boolean {
  return /[^\s{}();,]/.test(remainder);
}

/**
 * The head line's own body, when the declaration and the body share a line.
 *
 * A ONE-LINE FUNCTION HAS NO REPRESENTABLE BODY LINE. `public DateTime Now() =>
 * DateTime.UtcNow;` is a slice of exactly one line, so the only shape that
 * satisfies `0 <= headIndex < bodyIndex <= lines.length` is headIndex 0 and
 * bodyIndex 1, and a body scan that starts at bodyIndex reads nothing. Every
 * dimension then answered `clean` on a function nothing had looked at, which is
 * this module's own stated enemy: a zero from a rig that could not fire.
 *
 * Measured population, so this is not an edge case: 307 expression-bodied
 * members in the production C# corpus, and 79 of 697 functions (11%) in the
 * measured Rust crate with a single-line `fn` body, 123 such bodies in all.
 *
 * The remainder is masked in place, so its width, and therefore every column in
 * it, still lines up with the ORIGINAL head line. A finding on it reports the
 * head line's document number and quotes the head line as its evidence, because
 * that is the line the developer would have to open.
 */
function headRemainder(fn: FunctionUnderReview, lang: CriticizeLang): BodyLine | undefined {
  const index = fn.bodyIndex - 1;
  if (index < fn.headIndex || index >= fn.lines.length) {
    return undefined;
  }
  const raw = fn.lines[index];
  const masked = maskLine(raw, lang);
  const openerEnd = bodyOpenerEnd(masked, lang);
  if (openerEnd < 0 || !carriesCode(masked.slice(openerEnd))) {
    return undefined;
  }
  return {
    index,
    line: fn.startLine + index,
    raw,
    // Blanking the head keeps the width, so a detector reading this entry sees
    // the body and nothing of the signature.
    masked: " ".repeat(openerEnd) + masked.slice(openerEnd),
  };
}

// ===========================================================================
// The doc harvester
// ===========================================================================

/**
 * Doc markers stripped from the front of an upward-read comment line, longest
 * first so `///` is taken before `//`.
 *
 * PER LANGUAGE, BECAUSE THE SPELLING IS PER LANGUAGE. One shared set that
 * accepted a bare `//` everywhere harvested `// eslint-disable-next-line` and
 * `// TODO: rewrite this` as a Rust or TypeScript function's stated contract.
 * Neither language has a doc comment spelled `//`, and the cost of pretending
 * otherwise lands on the two dimensions that read the doc: a commented function
 * reads as documented, and a tool pragma reads as a precondition. Go is the one
 * language whose doc comment IS a bare `//`.
 */
const DOC_PREFIXES: Record<string, readonly string[]> = {
  Rust: ["/**", "/*!", "///", "//!", "*/", "*"],
  TypeScript: ["/**", "*/", "*"],
  "C#": ["/**", "///", "*/", "*"],
  Go: ["//"],
};

/** The markers this profile's doc comment may open with. An unregistered
 *  display name gets none, which reads as "no doc" rather than as a guess. */
function docPrefixes(lang: CriticizeLang): readonly string[] {
  return DOC_PREFIXES[lang.displayName] ?? [];
}

/**
 * A `//name:value` directive addressed to the toolchain rather than the reader.
 *
 * `//go:build linux` is the measured case: it sits immediately above a doc
 * comment with no blank line, so an upward walk that takes every `//` line
 * lands it as doc line one. `go doc` does not print it, and neither should a
 * dimension that reports what a function's doc says. The shape is the Go
 * spec's: `//`, then a name, then a colon, with no space anywhere in front.
 */
const TOOL_DIRECTIVE = /^\/\/[a-z0-9]+:/;

/**
 * An attribute or decorator, which sits BETWEEN the doc comment and the head.
 *
 * Measured on the production Rust crate: 493 of 1688 documented functions
 * (29.2%) put one or more attributes there, and in the production C# corpus it
 * is 10 of 198 (5.1%). Breaking the upward walk on the first one loses the
 * whole doc block and reports the function as undocumented, which is the same
 * silent zero this module is built around. The walk steps over them instead.
 *
 * A multi-line attribute whose closing line is not itself bracket-shaped (a
 * `#[derive(\n Debug,\n)]` spread over three lines) still stops the walk. That
 * is the safe direction: it under-reports a doc rather than inventing one.
 */
function isAttributeLine(trimmed: string, lang: CriticizeLang): boolean {
  if (lang.displayName === "Rust") {
    return /^#!?\[/.test(trimmed);
  }
  if (lang.displayName === "C#") {
    return /^\[[^\]]*\]\s*$/.test(trimmed);
  }
  if (lang.displayName === "TypeScript") {
    return /^@[A-Za-z_$][\w$]*/.test(trimmed);
  }
  return false;
}

/** Whether a line above the declaration head is part of the doc block. A blank
 *  line ends it: Go's rule is that the comment sits immediately above with no
 *  blank between, and applying it everywhere stops an unrelated comment three
 *  lines up from being read as this function's contract. */
function isDocLine(trimmed: string, lang: CriticizeLang): boolean {
  if (trimmed === "") {
    return false;
  }
  if (lang.lineComment === "#") {
    return trimmed.startsWith("#");
  }
  if (TOOL_DIRECTIVE.test(trimmed)) {
    return false;
  }
  const prefixes = docPrefixes(lang);
  return prefixes.some((p) => trimmed.startsWith(p)) || (prefixes.length > 0 && trimmed.endsWith("*/"));
}

/** One doc line with its markers removed. */
function stripDocMarkers(trimmed: string, lang: CriticizeLang): string {
  if (lang.lineComment === "#") {
    return trimmed.replace(/^#+/, "").trim();
  }
  let text = trimmed;
  for (const prefix of docPrefixes(lang)) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length);
      break;
    }
  }
  if (text.endsWith("*/")) {
    text = text.slice(0, -2);
  }
  return text.trim();
}

/** Drop empty entries from both ends and keep the interior ones, so a
 *  `/** ... *\/` block does not hand back the two delimiter lines as content
 *  while a paragraph break in the middle of a real doc survives. */
function trimBlank(lines: string[]): string[] {
  let from = 0;
  let to = lines.length;
  while (from < to && lines[from] === "") {
    from++;
  }
  while (to > from && lines[to - 1] === "") {
    to--;
  }
  return lines.slice(from, to);
}

/** The quote a Python docstring opens with, or undefined when this line does
 *  not start one. String prefixes (r, b, f, u, and their pairs) count. */
function pythonDocOpener(trimmed: string): string | undefined {
  const m = trimmed.match(/^(?:[rbfuRBFU]{0,2})('''|"""|'|")/);
  return m ? m[1] : undefined;
}

/**
 * The doc comment's text lines with their comment markers stripped, and `[]`
 * when there is none.
 *
 * PYTHON READS DOWNWARD AND THE OTHER FOUR READ UPWARD, and this function is
 * the only thing in the subsystem that knows it. Measured on 510 Python
 * functions: 68.0% put the doc inside the body, 1.4% put it above the
 * signature. A detector that sliced `lines.slice(0, headIndex)` by hand would
 * read two Python functions in three as undocumented, and that wrong answer is
 * spelled the same as the right one.
 *
 * The Python walk deliberately does not trust `bodyIndex`. It finds the end of
 * the declaration head itself, because a producer that pointed `bodyIndex` at
 * the docstring rather than past it would otherwise turn every documented
 * Python function into an undocumented one without saying a word.
 */
export function docLines(fn: FunctionUnderReview, lang: CriticizeLang): readonly string[] {
  if (unitDefect(fn) !== undefined) {
    return [];
  }
  if (lang.lineComment === "#") {
    return pythonDocstring(fn, lang);
  }

  const collected: string[] = [];
  for (let i = fn.headIndex - 1; i >= 0; i--) {
    const trimmed = fn.lines[i].trim();
    // An attribute, a decorator and a toolchain directive all sit between the
    // doc and the head without being either one. The walk steps over them and
    // keeps looking upward.
    if (isAttributeLine(trimmed, lang) || TOOL_DIRECTIVE.test(trimmed)) {
      continue;
    }
    if (!isDocLine(trimmed, lang)) {
      break;
    }
    collected.unshift(stripDocMarkers(trimmed, lang));
  }
  return trimBlank(collected);
}

/** The first string literal statement inside a Python body, single or triple
 *  quoted, with its quotes removed. */
function pythonDocstring(fn: FunctionUnderReview, lang: CriticizeLang): readonly string[] {
  let afterHead = -1;
  for (let i = fn.headIndex; i < fn.lines.length; i++) {
    if (maskLine(fn.lines[i], lang).trimEnd().endsWith(":")) {
      afterHead = i + 1;
      break;
    }
  }
  if (afterHead < 0) {
    return [];
  }

  // A COMMENT IS NOT A STATEMENT, so it does not take the docstring's place.
  // `def f():` / `# set up` / `"""doc"""` still binds `__doc__`, and a walk that
  // skipped blanks only gave up at the comment and reported the function
  // undocumented.
  let at = afterHead;
  while (at < fn.lines.length) {
    const trimmed = fn.lines[at].trim();
    if (trimmed !== "" && !trimmed.startsWith(lang.lineComment)) {
      break;
    }
    at++;
  }
  if (at >= fn.lines.length) {
    return [];
  }

  const first = fn.lines[at].trim();
  const quote = pythonDocOpener(first);
  if (quote === undefined) {
    return [];
  }

  const body = first.slice(first.indexOf(quote) + quote.length);
  const closes = indexOfUnescaped(body, quote, 0);
  if (closes >= 0) {
    return trimBlank([body.slice(0, closes).trim()]);
  }

  const collected = [body.trim()];
  for (let i = at + 1; i < fn.lines.length; i++) {
    const close = indexOfUnescaped(fn.lines[i], quote, 0);
    if (close >= 0) {
      collected.push(fn.lines[i].slice(0, close).trim());
      break;
    }
    collected.push(fn.lines[i].trim());
  }
  return trimBlank(collected);
}

/**
 * The body, line by line, with the document line number and both the raw and
 * the masked text of each line.
 *
 * Every dimension that reports a body line needs all four of those facts: the
 * masked text to decide, the raw text to quote as evidence, and the document
 * line to point at. Building them here keeps `maskedBody` the only way a
 * detector reads code, and keeps the `bodyIndex + i` arithmetic in one place
 * rather than in eleven detectors.
 */
export interface BodyLine {
  /** Index into `fn.lines`. */
  index: number;
  /** 1-based DOCUMENT line, which is what a finding carries. */
  line: number;
  raw: string;
  masked: string;
}

export function bodyLines(fn: FunctionUnderReview, lang: CriticizeLang): readonly BodyLine[] {
  const out: BodyLine[] = [];
  // The head line's own remainder comes FIRST when the declaration and the body
  // share a line, and it is absent otherwise, so a function whose head ends at
  // its brace still yields exactly one entry per body line.
  const head = headRemainder(fn, lang);
  if (head !== undefined) {
    out.push(head);
  }
  let carry: Carry = { kind: "open" };
  for (let i = fn.bodyIndex; i < fn.lines.length; i++) {
    const step = maskWithCarry(fn.lines[i], lang, carry);
    out.push({ index: i, line: fn.startLine + i, raw: fn.lines[i], masked: step.masked });
    carry = step.carry;
  }
  return out;
}
