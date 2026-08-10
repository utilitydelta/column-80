/**
 * The one bracket scan in the codebase, and the literal scanner under it.
 *
 * The stack scan is adapted from continuedev/continue (Apache-2.0)
 * core/autocomplete/filtering/BracketMatchingService.ts ("only complete bracket
 * pairs that we started"), extended with per-language literal, comment and
 * char-literal skipping.
 *
 * It lives in its own module because four callers with four reasons ask the
 * same question: `postprocess`'s suffix-overlap filters, the bound's balance
 * step (`fimBound`), `fimComment`'s "is this `//` inside a string", and
 * `scaffold`'s "is this comment at the function body's own depth". One
 * scanner means a language whose quote rules are wrong is wrong in one place
 * rather than three, and it keeps `fimBound` from importing `postprocess` for a
 * primitive neither of them owns.
 *
 * Pure: no vscode, no clock, no I/O.
 */

const OPEN_FOR: { [closer: string]: string } = { ")": "(", "]": "[", "}": "{" };
const OPENERS = new Set(["(", "[", "{"]);

/** What the scan skips over, per language. Every field defaults to off, and
 *  with all of them off the scan is the quote-blind bracket count the overlap
 *  filters have always run. */
export interface BracketSyntax {
  /** Characters that open a literal whose body is skipped. `'` delimits a
   *  string in TS and Python; in Rust it is a lifetime tick, so it belongs in
   *  `charQuote` there instead. */
  literalQuotes?: string;
  /** Line-comment opener. Prose inside a comment is not structure: an
   *  apostrophe in `// it's` opened a literal that swallowed the rest of the
   *  scan, and a whole-file oracle over the corpora had 97 of 290 TypeScript
   *  files scanning unbalanced for that reason alone. */
  lineComment?: string;
  /** A quote that opens a literal only where the text has char-literal shape.
   *  Rust's `'` is a lifetime tick 233 times against 11 bracket char literals
   *  in the acme-db corpus, so skipping from every tick swallows the rest
   *  of the line - but `let d = '(';` must not unbalance the scan either. */
  charQuote?: string;
  /** Block-comment delimiters, e.g. `["/*", "*\/"]`. A block comment's contents
   *  are not structure: `/* step 1 { *\/` is one comment, not an unclosed brace,
   *  and comment-shaped scaffolding is exactly what the scaffold harvest counts
   *  depth over. Absent leaves every existing caller's scan byte-identical.
   *
   *  Nesting is NOT supported: `/* /* *\/` closes at the first terminator, which
   *  is what C, C#, Java, JavaScript, TypeScript and Go all do. Rust DOES nest,
   *  and that is a documented limitation; it fails toward a depth count that
   *  reads too shallow, which under-harvests rather than mis-harvests. */
  blockComment?: readonly [string, string];
}

export interface BracketScan {
  /** The openers `text` leaves unclosed, outermost first. */
  stack: string[];
  /** The text ends inside a literal that never closed. The model is mid-string
   *  there, and a cut at that point is not a cut in code. */
  inLiteral: boolean;
  /** The text ends inside a line comment that never closed. Anything appended
   *  at that point lands inside the comment, inert and visible. */
  inLineComment: boolean;
  /** The text ends inside a block comment that never closed. Always false when
   *  `blockComment` is absent, so the field costs existing callers nothing. */
  inBlockComment: boolean;
}

// `'x'`, `'\n'`, `'\''`. Four characters is the whole shape, so the slice the
// test runs on is O(1). Verified against the rust corpus: no match on `&'a `,
// `<'a>` or `<'a, 'b>`, match on `'\''`.
const CHAR_LITERAL = /^'(\\.|[^'\\])'/;

/**
 * Whether the line-comment opener sitting at `at` really opens a comment.
 *
 * `//` inside a JavaScript regex literal is not one: `/\/\//` contains a
 * literal `//`, and reading it as a comment made `cursorInComment` answer true
 * for `s.split(/\/\//)` - the provider going dark on real code, which is the
 * one cost `fimComment` says it exists to control - and made the comment cut
 * truncate the regex mid-literal.
 *
 * The proper test is the standard regex-vs-division one, which needs to know
 * what can end an expression. This is the cheap sufficient half: the character
 * before a real `//` is never `/` or `\`, while inside a regex it is exactly
 * one of those (the escape of `\/`, or the closing slash of the literal). `///`
 * is unaffected - its opener is at the first slash, where the character before
 * belongs to the code.
 *
 * Every other opener in the table (`#`, `--`, `;`) is returned unjudged: none
 * of those languages has a regex literal in its grammar.
 */
export function opensLineComment(text: string, at: number, opener: string): boolean {
  if (!text.startsWith(opener, at)) {
    return false;
  }
  if (opener !== "//") {
    return true;
  }
  const before = text[at - 1];
  return before !== "/" && before !== "\\";
}

export function scanBrackets(text: string, syntax: BracketSyntax = {}): BracketScan {
  const literalQuotes = syntax.literalQuotes ?? "";
  const lineComment = syntax.lineComment ?? "";
  const charQuote = syntax.charQuote ?? "";
  const blockOpen = syntax.blockComment?.[0] ?? "";
  const blockClose = syntax.blockComment?.[1] ?? "";
  const stack: string[] = [];
  let inLiteral = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (lineComment !== "" && opensLineComment(text, i, lineComment)) {
      const nl = text.indexOf("\n", i);
      if (nl < 0) {
        inLineComment = true;
        break;
      }
      i = nl;
    } else if (blockOpen !== "" && text.startsWith(blockOpen, i)) {
      // A line-comment opener inside a block comment is inert, and so is a
      // quote: the whole span is skipped in one jump. The reverse holds by scan
      // order - the branch above consumed the rest of the line already, so a
      // `/*` inside a `//` never reaches here.
      const close = text.indexOf(blockClose, i + blockOpen.length);
      if (close < 0) {
        inBlockComment = true;
        break;
      }
      i = close + blockClose.length - 1;
    } else if (literalQuotes.includes(ch)) {
      const end = endOfLiteral(text, i);
      inLiteral = end >= text.length;
      i = end;
    } else if (charQuote.includes(ch)) {
      const shape = CHAR_LITERAL.exec(text.slice(i, i + 4));
      if (shape !== null) {
        i += shape[0].length - 1;
      }
    } else if (OPENERS.has(ch)) {
      stack.push(ch);
    } else if (OPEN_FOR[ch] && stack[stack.length - 1] === OPEN_FOR[ch]) {
      stack.pop();
    }
  }
  return { stack, inLiteral, inLineComment, inBlockComment };
}

/**
 * The openers `text` leaves unclosed, outermost first.
 *
 * `literalQuotes` names the characters that open a literal whose contents are
 * skipped, and it has to be per-language. The default is quote-blind, which is
 * what the overlap filters in `postprocess` have always been: they track quote
 * parity separately, and their behaviour is pinned by the contract set.
 */
export function openStack(text: string, literalQuotes = ""): string[] {
  return scanBrackets(text, { literalQuotes }).stack;
}

/** Index of the closing quote, or the end of the text when the literal never
 *  closes. An unterminated literal swallowing the rest is the useful answer: it
 *  is the model cut mid-string, and a stray opener inside it is not real
 *  structure. */
export function endOfLiteral(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
    } else if (text[i] === quote) {
      return i;
    }
  }
  return text.length;
}
