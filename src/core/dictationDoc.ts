/**
 * Gesture 2, the first half: dictate a declaration. At a declaration site (a blank line that
 * is not inside a function body) the heard sentence is the DOC COMMENT and stays in the file;
 * FIM writes the declaration under it, and both land through the one inline-completion accept,
 * whose command forwards to the post-accept compiler check and repair (so an empty body that
 * does not compile is repaired from the doc comment and the head). Roadmap item 78 still owes
 * the dictated name and parameters matched rather than guessed.
 *
 * Pure: the ghost text is assembled here from the served head, the sentence and the site's
 * indent, so the shape per language is one table and one test.
 */
import { tightenTokens, wrapTokens, TIGHTEN_COLUMN, TIGHTEN_TAB_WIDTH } from "./tightenRegion";
import { TS_LANGUAGE_IDS } from "./tsExtraction";

export type DocStyle = "triple-slash" | "double-slash" | "block" | "docstring";

/** How the language spells a doc comment on a declaration. Python's goes INSIDE the body as a
 *  docstring, so nothing precedes the head there. */
export function docStyleFor(languageId: string): DocStyle | undefined {
  if (languageId === "rust" || languageId === "csharp") {
    return "triple-slash";
  }
  if (languageId === "go") {
    return "double-slash";
  }
  if (TS_LANGUAGE_IDS.has(languageId)) {
    return "block";
  }
  if (languageId === "python") {
    return "docstring";
  }
  return undefined;
}

const MIN_WRAP_BUDGET = 20;

function wrapped(sentence: string, lead: string, indentColumns: number): string[] {
  const words = tightenTokens(sentence.replace(/\s+/g, " "));
  const budget = Math.max(MIN_WRAP_BUDGET, TIGHTEN_COLUMN - Math.max(0, Math.floor(indentColumns)));
  return wrapTokens(words, budget, lead, lead, TIGHTEN_TAB_WIDTH);
}

/** The doc comment that precedes the head, unindented (the injection and the ghost add the
 *  indent), or undefined where the language keeps its doc inside the body. */
export function docCommentAbove(sentence: string, languageId: string, indentColumns: number = 0): string | undefined {
  if (typeof sentence !== "string" || sentence.trim() === "") {
    return undefined;
  }
  const style = docStyleFor(languageId);
  switch (style) {
    case "triple-slash":
      return wrapped(sentence, "/// ", indentColumns).join("\n");
    case "double-slash":
      return wrapped(sentence, "// ", indentColumns).join("\n");
    case "block":
      return ["/**", ...wrapped(sentence, " * ", indentColumns), " */"].join("\n");
    default:
      return undefined;
  }
}

/**
 * The fresh line a dictated ghost carries after its last content line, so the caret lands on a
 * new line with nothing pressed. Empty at module level: the editor never renders an inline
 * completion that ends on an empty line (measured on VS Code 1.124.2 and 1.132.0, session-v66),
 * so a fresh line with no indent would lose the whole item. There the item ends at the end of
 * its last content line and the human presses Enter once.
 */
export function freshLineAfter(eol: string, indent: string): string {
  const nl = typeof eol === "string" ? eol : "";
  const ind = typeof indent === "string" ? indent : "";
  return ind === "" ? "" : `${nl}${ind}`;
}

export interface DeclarationGhost {
  /** The whole item text: doc comment, head, and the body's first line where the head opens
   *  one. Every line after the first carries `indent`. */
  text: string;
  /** Where the caret should land after the accept, as an offset into `text`. */
  caretOffset: number;
}

/** The line without a trailing line comment, the opener found outside string literals
 *  (`base = "https://x.y"` keeps its `//`; `sep: str = "#"` keeps its `#`). */
function stripTrailingLineComment(line: string, opener: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote !== "") {
      if (ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (line.startsWith(opener, i)) {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * The served head, dressed as the ghost that lands. A head that opens a body (`{` in the brace
 * languages, `:` in Python) gets an empty body line at one more indent unit and, for braces,
 * the closer, and the caret goes onto that body line. A head that does not (a `struct Foo;`, a
 * trait method, a bound cut) gets a fresh line after it at the site's indent.
 */
export function declarationGhost(
  served: string,
  sentence: string,
  languageId: string,
  eol: string,
  indent: string,
  unit: string,
): DeclarationGhost {
  const head = typeof served === "string" ? served.replace(/\s+$/, "") : "";
  const style = docStyleFor(languageId);
  const above = docCommentAbove(sentence, languageId, indent.replace(/\t/g, "    ").length);
  const lines: string[] = [];
  // The first line of the item lands at the caret, which already sits after `indent`; every
  // later line is a fresh line and carries the indent itself.
  // A head can span lines: an attribute or decorator the bound read through sits above the
  // declaration proper (`#[derive(Debug)]` then `pub enum Kind {`); every line after the
  // item's first carries the indent.
  const headLines = head === "" ? [""] : head.split("\n");
  if (above !== undefined) {
    above.split("\n").forEach((l, i) => lines.push(i === 0 ? l : indent + l));
    headLines.forEach((l) => lines.push(indent + l));
  } else {
    headLines.forEach((l, i) => lines.push(i === 0 ? l : indent + l));
  }
  // C# puts the brace on its own line, so the bound's one content line is the head without it;
  // a head that names a type or ends its parameter list opens a body there.
  // A head that ends with `;` or `}` closed itself (`public record Point(int X, int Y);`, an
  // auto-property) and opens nothing, whatever words it carries.
  // Judged on the head's last line with any trailing line comment removed (`...); // a point`
  // is still closed); what renders is the head as served.
  const lastLine = head.slice(head.lastIndexOf("\n") + 1);
  const bare = stripTrailingLineComment(lastLine, style === "docstring" ? "#" : "//").trimEnd();
  const closed = /[;}]$/.test(bare);
  const allman =
    languageId === "csharp" && !closed && !/\{$/.test(bare) && (/\b(class|struct|interface|enum|record)\b/.test(bare) || /\)$/.test(bare));
  const opensBody = style === "docstring" ? /:$/.test(bare) : allman || /\{$/.test(bare);
  let caretLine: number;
  let caretColumn: number;
  if (opensBody && style === "docstring") {
    const body = indent + unit;
    lines.push(`${body}"""${sentence.replace(/\s+/g, " ").trim()}"""`);
    lines.push(body);
    caretLine = lines.length - 1;
    caretColumn = body.length;
  } else if (opensBody) {
    const body = indent + unit;
    if (allman) {
      lines.push(`${indent}{`);
    }
    lines.push(body);
    lines.push(`${indent}}`);
    caretLine = lines.length - 2;
    caretColumn = body.length;
  } else if (freshLineAfter(eol, indent) !== "") {
    lines.push(indent);
    caretLine = lines.length - 1;
    caretColumn = indent.length;
  } else {
    // Module level: no fresh line (see `freshLineAfter`). An empty head would leave an empty
    // last line under the doc comment, and that is the shape the editor drops, so it goes too.
    if (head === "" && lines.length > 1) {
      lines.pop();
    }
    caretLine = lines.length - 1;
    caretColumn = lines[caretLine].length;
  }
  const text = lines.join(eol);
  const caretOffset = lines.slice(0, caretLine).reduce((n, l) => n + l.length + eol.length, 0) + caretColumn;
  return { text, caretOffset };
}
