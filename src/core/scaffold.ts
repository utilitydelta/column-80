/**
 * The scaffold harvest: a developer sketches a function as comments, `// step 1`,
 * `// step 2`, `// step 3`, and asks fn-gen to write it. Those comments are the
 * spec the human just typed, and the product used to throw them away.
 *
 * Only comments scoped DIRECTLY to the function body are the spec. A comment
 * inside an `if`, a `for` or a closure is commentary on code that already
 * exists, at a different granularity, so depth is the whole predicate.
 *
 * This feeds GENERATION only. `generateTests` must never see a body-scoped
 * comment: `// loop backwards to avoid index shift` is an algorithm note, and a
 * test authored from it couples to the algorithm instead of the behaviour.
 *
 * Pure: no vscode, no clock, no I/O.
 */

import { BracketSyntax, endOfLiteral, scanBrackets } from "./brackets";
import { CommentHit, CommentSyntax, commentSyntaxFor, nextComment } from "./fimComment";

export interface ScaffoldHarvest {
  /** The comment lines, verbatim and trimmed of leading indentation, in
   *  document order. Empty when nothing was harvested. */
  comments: string[];
  /** Every comment line found in the body, harvested or not. Diagnostic only. */
  considered: number;
}

/**
 * The comments the developer left at the function body's own depth.
 *
 * `bodyText` is the text INSIDE the body: past the opening `{`, or past the
 * Python header's `:`. `bodyTextOfSpan` cuts it off a resolved span. Depth is
 * counted from its first character, so a comment at body depth is one the
 * preceding text leaves no opener unclosed before.
 *
 * `bodyIndent` is Python's predicate and Python's alone. Empty means "derive
 * it", because the resolver only computes it for a docstring target; see
 * `pyBodyIndent`.
 */
export function harvestBodyComments(
  bodyText: string,
  languageId: string,
  bodyIndent: string,
): ScaffoldHarvest {
  const syntax = commentSyntaxFor(languageId);
  if (syntax === undefined) {
    return { comments: [], considered: 0 };
  }
  const atBodyDepth =
    languageId === "python"
      ? pyBodyDepthTest(bodyText, bodyIndent, syntax)
      : braceBodyDepthTest(bodyText, languageId, syntax);

  const comments: string[] = [];
  let considered = 0;
  let from = 0;
  for (;;) {
    const hit = nextComment(bodyText, syntax, from);
    if (hit === undefined) {
      break;
    }
    from = hit.end;
    // A Python docstring is not scaffolding. It is the doc channel already, read
    // as the spec and preserved outside the span, and harvesting it would put
    // the same words on the prompt twice.
    if (hit.kind === "doc") {
      continue;
    }
    const lines = commentLines(bodyText, hit, syntax);
    considered += lines.length;
    if (atBodyDepth(hit.index)) {
      comments.push(...lines);
    }
  }
  return { comments, considered };
}

/**
 * The body text of a resolved span, ready for `harvestBodyComments`.
 *
 * `spanStartsInBody` is the Python Fork A span: the resolver already moved
 * `span.start` past the preserved docstring, so there is no header left to cut
 * and looking for a `:` would cut at the first annotated local instead.
 *
 * Empty when the target has no body block at all - a C# expression-bodied
 * member, a bodyless interface signature - which harvests nothing, correctly.
 */
export function bodyTextOfSpan(spanText: string, languageId: string, spanStartsInBody = false): string {
  if (spanStartsInBody) {
    return spanText;
  }
  const syntax = commentSyntaxFor(languageId);
  if (syntax === undefined) {
    return "";
  }
  // Python's body opens at the header's own `:`, the same depth-0 terminator
  // `pySignatureFromSpanText` cuts the signature at. Every other registered
  // language opens at the declaration's `{`; a `{` in a destructured parameter
  // or a generic argument sits at depth > 0 and is skipped for that reason.
  const opener = languageId === "python" ? ":" : "{";
  const at = firstAtDepthZero(spanText, syntax, opener);
  return at < 0 ? "" : spanText.slice(at + 1);
}

// The first `opener` the text reaches with no bracket left open, skipping string
// literals and comments. `nextComment` is the comment scanner the FIM rules run
// on, not a second copy, and `endOfLiteral` is `brackets`'s for the same reason.
function firstAtDepthZero(text: string, syntax: CommentSyntax, opener: string): number {
  let hit = nextComment(text, syntax, 0);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    while (hit !== undefined && hit.index < i) {
      hit = nextComment(text, syntax, i);
    }
    if (hit !== undefined && hit.index === i) {
      i = hit.end - 1;
      continue;
    }
    const ch = text[i];
    if (syntax.quotes.includes(ch)) {
      i = endOfLiteral(text, i);
    } else if (ch === "(" || ch === "[" || ch === "{") {
      if (ch === opener && depth === 0) {
        return i;
      }
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
    } else if (ch === opener && depth === 0) {
      return i;
    }
  }
  return -1;
}

// Brace languages count depth off the one bracket scan. `blockComment` is passed
// because `/* step 1 { */` is a comment, not an unclosed brace, and comment-shaped
// scaffolding is exactly the input this harvest invites.
function braceBodyDepthTest(
  bodyText: string,
  languageId: string,
  syntax: CommentSyntax,
): (index: number) => boolean {
  const bracketSyntax = bracketSyntaxFrom(syntax, languageId);
  return (index) => scanBrackets(bodyText.slice(0, index), bracketSyntax).stack.length === 0;
}

// The comment table already names each language's line openers, block pairs and
// quotes, so the scan's syntax is that row rather than a fourth hand-written
// list. The shortest line opener is the one that always matches first (`///`
// starts with `//`), which is the rule `fimBound` uses too.
function bracketSyntaxFrom(syntax: CommentSyntax, languageId: string): BracketSyntax {
  let shortestLine = "";
  for (const opener of syntax.line) {
    if (shortestLine === "" || opener.length < shortestLine.length) {
      shortestLine = opener;
    }
  }
  return {
    literalQuotes: syntax.quotes.join(""),
    lineComment: shortestLine,
    // Rust's `'` is a lifetime tick far more often than a char literal, so it is
    // absent from the quote set and only opens a literal where the text has
    // char-literal shape.
    charQuote: languageId === "rust" ? "'" : "",
    blockComment: syntax.block.length > 0 ? [syntax.block[0][0], syntax.block[0][1]] : undefined,
  };
}

// Python has no braces to count, so the body's own indentation IS its depth. The
// compare is exact string equality: a body indented with tabs and a comment
// indented with spaces are not at the same level to any reader, and guessing a
// tab width would harvest from inside an `if`.
function pyBodyDepthTest(
  bodyText: string,
  bodyIndent: string,
  syntax: CommentSyntax,
): (index: number) => boolean {
  const indent = bodyIndent === "" ? pyBodyIndent(bodyText, syntax) : bodyIndent;
  return (index) => {
    const lineStart = bodyText.lastIndexOf("\n", index - 1) + 1;
    return leadingWhitespace(bodyText.slice(lineStart)) === indent;
  };
}

/**
 * Where the body sits, when the resolver did not say.
 *
 * `ResolvedFunction.bodyIndent` is only computed for a docstring target (it is
 * the docstring's own column), so a plain `def` arrives with an empty one and
 * the column has to come off the body itself.
 *
 * The first non-comment statement is the answer: Python's parser puts the body's
 * first statement at the body's column by definition. Comments are the fallback,
 * not the first choice, because the parser lets a `#` sit at ANY column - a
 * hanging comment would otherwise redefine the whole body's depth. When comments
 * are all there is (the pure scaffold, with a `pass` yet to be typed), the
 * shallowest of them is the level the human was writing at.
 */
function pyBodyIndent(bodyText: string, syntax: CommentSyntax): string {
  let shallowestComment: string | undefined;
  for (const line of bodyText.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const indent = leadingWhitespace(line);
    if (syntax.line.some((opener) => line.trim().startsWith(opener))) {
      if (shallowestComment === undefined || indent.length < shallowestComment.length) {
        shallowestComment = indent;
      }
      continue;
    }
    return indent;
  }
  return shallowestComment ?? "";
}

function leadingWhitespace(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? "";
}

/**
 * One comment as the prompt lines it becomes: the human's words, with the syntax
 * stripped off.
 *
 * A multi-line block comment is one entry per line - the human wrote it as a
 * list of steps, and one blob would flatten the list they typed. Blank lines and
 * marker-only lines are dropped: an empty entry says nothing and the label above
 * it would be the only content.
 */
function commentLines(bodyText: string, hit: CommentHit, syntax: CommentSyntax): string[] {
  if (hit.kind === "line") {
    const opener = syntax.line.find((o) => bodyText.startsWith(o, hit.index)) ?? "";
    const text = stripDecoration(bodyText.slice(hit.index + opener.length, hit.end), opener);
    return text === "" ? [] : [text];
  }
  const pair = syntax.block.find((p) => bodyText.startsWith(p[0], hit.index));
  if (pair === undefined) {
    return [];
  }
  const end = hit.closed ? hit.end - pair[1].length : hit.end;
  const inner = bodyText.slice(hit.index + pair[0].length, end);
  return inner
    .split("\n")
    // ` * ` continuation stars and a `/**` opener's own star are syntax, not
    // words; `!` covers Rust's `//!` and `/*!` inner-doc forms.
    .map((line) => stripDecoration(line, "*"))
    .filter((line) => line !== "");
}

function stripDecoration(text: string, opener: string): string {
  const decoration = new Set([...opener, "!"]);
  let i = 0;
  while (i < text.length && (decoration.has(text[i]) || text[i] === " " || text[i] === "\t")) {
    i++;
  }
  return text.slice(i).trim();
}
