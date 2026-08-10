/**
 * The document schemes Column 80 serves, defined ONCE: the inline provider
 * registers for exactly these, and cross-file eviction fires for exactly
 * these. One list, not two drifting copies - the schemes that can mint cache
 * entries are the only schemes whose edits can change resolvable surface.
 *
 * Eviction keys on an ALLOWLIST, never a denylist: onDidChangeTextDocument
 * also fires for the SCM commit box (vscode-scm), comment widgets, the debug
 * REPL, interactive-window inputs, and chat code blocks. None of those can
 * ever mint an entry, so a keystroke there must not touch the caches - the
 * dogfood capture had a 20-char commit message paying 19 cache misses at a
 * warm site (hits=1) because the old `scheme !== "output"` denylist let every
 * commit-box keystroke wipe both caches.
 *
 * vscode-free on purpose: the pin suite bundles this module headless.
 */
import { fimServesLanguage } from "../core/fimLanguages";

export const DOCUMENT_SCHEMES = ["file", "untitled", "vscode-notebook-cell"] as const;

/** True exactly when an edit in `scheme` can change completable surface. */
export function isDocumentScheme(scheme: string): boolean {
  return (DOCUMENT_SCHEMES as readonly string[]).includes(scheme);
}

/**
 * Can an edit in this document change anything the caches hold? Both halves,
 * because since v29 there are two ways to be unable to mint an entry.
 *
 * The scheme half is the older one, argued above. The language half is v29's:
 * FIM serves code only, so a markdown buffer cannot mint an entry either, and
 * without this a human writing a paragraph of prose in a `file:` scheme
 * document wipes every other file's completion cache and injection block on
 * every keystroke. That is the same defect the scheme allowlist exists to
 * prevent, arriving through the door v29 opened.
 *
 * `readExtra` is lazy on purpose. The default set answers with a set lookup, so
 * a keystroke in real code never reads configuration here; only an unserved
 * language pays the read, and that language is about to pay it in the provider
 * anyway.
 */
export function canMintEntries(
  scheme: string,
  languageId: string,
  readExtra: () => readonly string[],
): boolean {
  if (!isDocumentScheme(scheme)) {
    return false;
  }
  return fimServesLanguage(languageId) || fimServesLanguage(languageId, readExtra());
}
