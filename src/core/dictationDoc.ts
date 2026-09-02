/**
 * Gesture 2, the first half: dictate a declaration. At a declaration site (a blank line that
 * is not inside a function body) the heard sentence is the DOC COMMENT and stays in the file;
 * FIM writes the declaration under it, and both land through the one inline-completion accept.
 * The compiler check and repair on the head, then fn-gen's body, are roadmap item 78.
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

export interface DeclarationGhost {
  /** The whole item text: doc comment, head, and the body's first line where the head opens
   *  one. Every line after the first carries `indent`. */
  text: string;
  /** Where the caret should land after the accept, as an offset into `text`. */
  caretOffset: number;
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
  if (above !== undefined) {
    above.split("\n").forEach((l, i) => lines.push(i === 0 ? l : indent + l));
    lines.push(indent + head);
  } else {
    lines.push(head);
  }
  const opensBody = style === "docstring" ? /:\s*$/.test(head) : /\{\s*$/.test(head);
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
    lines.push(body);
    lines.push(`${indent}}`);
    caretLine = lines.length - 2;
    caretColumn = body.length;
  } else {
    lines.push(indent);
    caretLine = lines.length - 1;
    caretColumn = indent.length;
  }
  const text = lines.join(eol);
  const caretOffset = lines.slice(0, caretLine).reduce((n, l) => n + l.length + eol.length, 0) + caretColumn;
  return { text, caretOffset };
}
