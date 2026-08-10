/**
 * The rule every language's re-indent leg holds: a generated reply is placed at
 * the target's column, NOT shifted by it.
 *
 * The prompt shows the model code that is already written and asks for what goes
 * under it. A model that answers IN PLACE, with its lines already indented to sit
 * where they were shown, is obeying. Adding the target's indent to those bytes is
 * what lands a generated definition a level deep: harmless-looking in a braced
 * language, an IndentationError in Python.
 *
 * So the reply's own base column comes off before the target's goes on. The base
 * is the first line's leading whitespace, because the first line is the
 * declaration head and everything else in the reply is positioned relative to it.
 * A flush-left reply has no base and passes through untouched, which is why this
 * is a no-op on every reply shape the suites were built from.
 *
 * Python needs a different base (no braces, and a `#` may sit at any column), so
 * it computes its own; see pyExtraction. Everything else shares this.
 *
 * Pure: no vscode, no clock, no I/O.
 */

/** The reply's own column zero: the leading whitespace of its declaration head,
 *  which is the first line with anything on it.
 *
 *  Not `lines[0]`. A reply that opens with a blank line has its head one line
 *  down, and measuring the blank reads a base of "" — nothing gets dedented, the
 *  head keeps its own indent on top of the target's, and the double indent is
 *  back for exactly the replies that happen to start with a newline. */
export function replyBaseIndent(lines: readonly string[]): string {
  const head = lines.find((line) => line.trim() !== "");
  return head === undefined ? "" : /^[ \t]*/.exec(head)?.[0] ?? "";
}

/** `line` with the reply's base column removed. A line that does not carry the
 *  base is left alone: it is not positioned relative to the head, so there is no
 *  sound amount to take off it. */
export function withoutBase(line: string, base: string): string {
  return base !== "" && line.startsWith(base) ? line.slice(base.length) : line;
}

/** The whitespace `selected` lines all start with, as a shared PREFIX rather
 *  than a column count: a tab-indented line and a space-indented one have no
 *  common prefix and the dedent leaves both alone, because guessing a tab width
 *  is how a dedent eats a level it did not own. The same rule pyExtraction's
 *  pyCommonIndent holds, for the same reason. */
function commonLeadingWhitespace(
  lines: readonly string[],
  selected: (n: number) => boolean,
): string {
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
  return prefix ?? "";
}

/**
 * Normalise a definition read out of a document to its own column zero — the
 * INVERSE of the re-indent legs, and the shape the generation prompt already
 * shows a model.
 *
 * The head is the first line that is non-blank and not byte-exact, and it is
 * EXCLUDED from the common-prefix measurement. A span starts at the
 * declaration's first character, so the head is flush by construction while
 * every later line still carries the file's absolute column. Include the head
 * and the shared prefix is always "", the dedent is always a no-op, and a
 * repair round hands the model file-indented code that it echoes back to be
 * indented a second time. That is the bug: four spaces a round, cumulative.
 *
 * The head is only measured when it carries whitespace of its own, which means
 * the text was already relative to something and there is nothing to discover.
 *
 * `byteExact[n]` marks a line inside a multi-line string literal, whose bytes
 * are the string's VALUE and must come back untouched. It is the caller's
 * scanner that decides, so the dedent and the re-indent agree line for line.
 *
 * `known` is the column the span was CUT from, when the caller already holds it
 * (the resolver does: it is the same `headerIndent` the placement leg is handed
 * on the way back, or `bodyIndent` for a body-only span). Supplied, nothing is
 * inferred and the result is exact. It matters most for Python, where inference
 * cannot be exact even in principle: a braced language puts its closing token
 * back at the header's own column, so the shared prefix recovers that column,
 * but a `def` has no closing token and every line below it is strictly deeper.
 * Absent, the prefix rule below is the best available reading, and Python's leg
 * re-anchors on top of it.
 */
export function dedentToZeroBase(
  lines: readonly string[],
  byteExact: readonly boolean[],
  known?: string,
): string[] {
  if (known !== undefined) {
    return known === ""
      ? lines.slice()
      : lines.map((line, n) => (byteExact[n] ? line : withoutBase(line, known)));
  }
  const measurable = (n: number) => !byteExact[n] && lines[n].trim() !== "";
  let head = -1;
  for (let n = 0; n < lines.length; n++) {
    if (measurable(n)) {
      head = n;
      break;
    }
  }
  if (head === -1) {
    return lines.slice();
  }
  const own = /^[ \t]*/.exec(lines[head])?.[0] ?? "";
  const base =
    own !== "" ? own : commonLeadingWhitespace(lines, (n) => n > head && measurable(n));
  if (base === "") {
    return lines.slice();
  }
  return lines.map((line, n) => (byteExact[n] ? line : withoutBase(line, base)));
}

/**
 * A DOC COMMENT read out of a document, normalised to its own column zero.
 *
 * Same provenance problem as the code beside it: the span starts at the first
 * character, so line 1 is flush while every later line still carries the file's
 * column. The prompt then renders a ragged block, first line hard left and the
 * rest indented under nothing:
 *
 *     /// Generate a self-signed CA keypair. Writes `ca.crt` to `ca_dir`.
 *         ///
 *         /// Uses ECDSA P-256, `BasicConstraints CA:true pathLen:0`.
 *     pub fn create_ca(...)
 *
 * Observed live on `acme-db` 2026-07-30, on both the generation and the
 * repair prompt.
 *
 * KNOWN INDENT ONLY, and that is the whole design. A doc comment is prose and
 * may carry an indented code example, so the common-prefix inference the code
 * legs use could eat indentation that means something. The caller either knows
 * the column the span was cut from or nothing happens.
 */
export function dedentDocComment(doc: string, spanIndent: string | undefined): string {
  if (spanIndent === undefined || spanIndent === "") {
    return doc;
  }
  // EVERY line, with no special case for the first. The premise that line 1
  // arrives flush holds only for the languages whose doc is `trivia` sliced from
  // the declaration's first character (Rust, Go). C# and TypeScript build the
  // doc by pushing WHOLE LINES (`csDocCommentAbove`, `tsDocCommentAbove`), so
  // their line 1 carries the file's column like every other line - and those are
  // the normal paths, not edge cases. Skipping line 1 there left it hanging one
  // level right of the rest, which INVERTS the raggedness instead of removing it
  // (adversarial review D1).
  //
  // Stripping unconditionally is safe for both shapes: a genuinely flush line
  // does not start with `spanIndent`, and `withoutBase` leaves a line that does
  // not carry the base alone.
  const lines = doc.split("\n");
  // REFUSE unless every non-blank line after the first actually carries the
  // column. That single guard separates the two shapes that reach here:
  //
  //   Rust/Go trivia   line 1 flush, every later line at the file's column  -> strip
  //   C#/TS whole-line every line at the file's column                      -> strip
  //   Python docstring already 0-based by `stripPyDocstring`, so a `Args:`
  //                    block sits at 0 and its entries at 4                 -> REFUSE
  //
  // Without it, handing a Python docstring the body's column strips a level it
  // never had, straight out of the prose - and in Fork A the docstring IS the
  // spec, so a Google-style `Args:` block or a `>>>` example reaches the model
  // flattened (adversarial review D3). The call sites pass "" for a bodyOnly
  // target, and this makes the function safe even when one forgets.
  const carriesColumn = lines
    .slice(1)
    .every((line) => line.trim() === "" || line.startsWith(spanIndent));
  if (!carriesColumn) {
    return doc;
  }
  return lines.map((line) => withoutBase(line, spanIndent)).join("\n");
}
