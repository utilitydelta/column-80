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
  // A complete fenced block is required: a `mod tests` sitting in bare prose is
  // not a reply we splice, and demanding the fence keeps this symmetric with how
  // the model is instructed to answer (one fenced block, nothing outside).
  const block = extractFirstCodeBlock(reply);
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
  csharp: /\[\s*(?:TestMethod|Fact|Theory|Test)\s*[\]\(]/g,
};

/**
 * Cut a non-Rust instruct reply to its fenced block of TEST FUNCTIONS, or
 * undefined when the reply carries no fenced block or no test function.
 *
 * Sibling of extractTestModule, and deliberately NOT a widening of it: Rust's
 * guard requires a `mod` wrapper and counts `#[test]`, which is the shape that
 * rejects the bare-function reply — exactly the shape the other four languages
 * must ACCEPT. Same fence requirement, same comment/string neutralization before
 * counting, so a `def test_x` inside a docstring never inflates the count.
 *
 * An unregistered languageId answers undefined rather than guessing a shape.
 */
export function extractTestFunctions(reply: string, languageId: string): TestModuleExtraction | undefined {
  const pattern = TEST_FUNCTION_SHAPES[languageId];
  if (pattern === undefined) {
    return undefined;
  }
  const block = extractFirstCodeBlock(reply);
  if (block === undefined) {
    return undefined;
  }
  const testCount = (neutralizeCommentsAndStrings(block).match(pattern) ?? []).length;
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
function neutralizeCommentsAndStrings(source: string): string {
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
// Template interpolation and regex literals are not modeled - a nested backtick
// inside `${...}`, or a quote/`/*` inside a regex literal (`/`/g`, `/[/*]x/`),
// can flip parity - the accepted residuals for this scan-only consumer.
function neutralizeTsCommentsAndStrings(source: string): string {
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
function neutralizePythonCommentsAndStrings(source: string): string {
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
