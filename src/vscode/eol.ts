/**
 * The one place a document's line ending is applied to text this extension
 * writes. Queue Q15.
 *
 * The split of responsibility, because getting it wrong is how the defect
 * happened: CORE is LF-canonical. `FnGenService.generate` normalises every
 * reply on arrival, so its doc-comment dedup, fence scan and function trim can
 * all be written against "\n" without guessing what the model answered in. This
 * module is the other end, and it is the only code that reads `document.eol`.
 *
 * Two write paths existed with no shared helper (the generate/repair splice and
 * the tighten write), and that is exactly how the second one came to exist
 * without one. A third and fourth path insert snippets rather than edits.
 */
import * as vscode from "vscode";

/**
 * Rewrite `text`'s line terminators to `document`'s own.
 *
 * Apply BEFORE the human is shown a preview, never between the preview and the
 * write: a diff reviewed in one ending and spliced in another is a quieter
 * version of the bug being fixed.
 *
 * Only real terminators move. A body whose SOURCE TEXT contains a backslash-r
 * escape inside a string literal keeps it, because that is two characters and
 * nothing here parses source.
 */
export function withDocumentEol(text: string, document: vscode.TextDocument): string {
  // `vscode.EndOfLine.CRLF` is 2 in the API, and the literal is the fallback
  // because a headless stub can supply a document without supplying the enum -
  // which is not hypothetical, it threw here first. Same defensiveness the
  // status-bar and progress calls in this layer already carry. A document with
  // no `eol` at all reads as LF, which is the safe direction: it leaves text
  // exactly as core produced it.
  const crlf = vscode.EndOfLine?.CRLF ?? 2;
  const eol = document.eol === crlf ? "\r\n" : "\n";
  return text.replace(/\r\n|\n/g, eol);
}
