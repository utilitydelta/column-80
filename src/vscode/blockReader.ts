/**
 * The payload reader: a context block's uri, to whatever those lines read NOW.
 * `ContextBlockStore.resolveForPrompt` takes exactly this function, and it is
 * the whole of session-v33's "the model gets what the lines say now" at the
 * vscode layer.
 *
 * vscode-free ON PURPOSE, the same discipline documentSchemes.ts keeps. The two
 * functions below are the entire dependency, so the reader is unit-testable
 * headless with hand-built fakes and the contract's blind oracle bundles it with
 * no vscode stub at all: an import here would fail to resolve, which is the
 * cheapest honest check that this file never grew one. The vscode-facing half
 * (`workspace.textDocuments`, `workspace.openTextDocument`) is three lines in
 * fnGen.ts.
 */

/** Whatever the host knows about documents, reduced to what a read needs. */
export interface BlockReaderDeps {
  /** The documents the editor currently has open, buffers and all. */
  openDocuments(): readonly { uri: string; getText(): string }[];
  /** Read a document the editor does NOT have open, without showing it. */
  openTextDocument(uri: string): Promise<{ getText(): string }>;
}

/** A block's text as the document reads now, or `undefined` if it cannot be
 *  read at all. Never throws, and never "" in place of `undefined`. */
export type BlockReader = (uri: string) => Promise<string | undefined>;

/**
 * The reader, built over its two dependencies.
 *
 * Stateless and cache-free, and that is the point rather than an omission: two
 * calls in one resolve are two reads, measured at 0.005ms (scout finding 8),
 * and a cache would be a second source of truth about a document VS Code
 * already owns. The human types between two reads and the second read has to
 * see it.
 */
export function makeBlockReader(deps: BlockReaderDeps): BlockReader {
  return async (uri: string): Promise<string | undefined> => {
    try {
      // An OPEN document wins, matched on the uri STRING exactly as the panel
      // matches today. Its buffer carries edits that were never saved, and
      // those edits are the case this whole session exists for: reading disk
      // for a document the human is typing into hands the model text that no
      // longer exists.
      const open = deps.openDocuments().find((d) => d.uri === uri);
      if (open) {
        return open.getText();
      }
      return (await deps.openTextDocument(uri)).getText();
    } catch {
      // A deleted file, an unparseable uri, a permission error: one answer for
      // all of them, and it is `undefined` rather than "". The store reads
      // `undefined` as lost:"deleted" and drops the block; "" would resolve to
      // an empty section in the prompt and say nothing about why.
      //
      // Catching is not defensive tidiness. `openTextDocument` REJECTS for a
      // missing file, and phase 2's review proved that a reader which lets that
      // escape leaves the store mutated with its subscribers never told.
      return undefined;
    }
  };
}
