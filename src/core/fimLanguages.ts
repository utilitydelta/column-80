/**
 * Where FIM runs at all.
 *
 * The product owner, flat: "we only FIM CODE. no comments, no markdown, no
 * natural language. only FIM in .cs/.rs/etc that we know is code, and NEVER
 * inside comment blocks." Half of that already shipped as the in-comment
 * refusal (`fimComment.ts`). This is the other half.
 *
 * Until now the inline provider registered on document SCHEME alone, so every
 * file VS Code opens reached the model: markdown, plaintext, latex, asciidoc,
 * JSON, YAML, lock files. That is a model call per keystroke in a `.md` for a
 * serve the human does not want. This registry is the gate, and the provider
 * consults it before the debounce, before the cache and before any model call.
 *
 * WHY THIS LIST AND NOT THE COMMENT TABLE. `commentSyntaxFor` has rows for
 * Ruby, Lua, SQL, Haskell and a dozen more, and that table answers a different
 * question: how a comment is SPELLED where FIM runs. It is a courtesy row set,
 * deliberately wide, and reading it as a serve list would put the model back in
 * every language VS Code opens. The list here is the product's own definition
 * of "we understand this": exactly the languages carrying a registered oracle
 * (`oracleFor`) or extractor (`extractorFor`), which today are the same five.
 *
 * WHY languageId AND NOT THE FILE EXTENSION. VS Code hands the provider a
 * `languageId`, which is what every other registry in this product keys on
 * (`oracleFor`, `extractorFor`, `memberSiteFor`, `commentSyntaxFor`), and it is
 * the right answer for a file the human has retyped: a scratch buffer the human
 * set to Rust is Rust, and a `.txt` full of Python is prose until they say
 * otherwise.
 *
 * WHAT THIS COSTS, on the record. C, C++, Java, Kotlin, Swift, Scala, PHP,
 * Dart, Ruby and the shells are code, plain FIM works in them, and they go dark
 * here because the product has no oracle and no extractor for any of them. That
 * is the owner's call as stated, and `column80.fimLanguages` is how a human who
 * writes one of them turns it back on. The setting only ever WIDENS: nothing
 * removes a language the product understands.
 *
 * Pure: no vscode, no clock, no I/O.
 */

import { TS_LANGUAGE_IDS } from "./tsExtraction";

// The one set the gate reads. Module-private on purpose: `Object.freeze` does
// nothing to a Set (it seals own properties, not the internal slots `add` and
// `delete` write to), so the only way an exported set cannot change the
// product's answers is for the answers to come from a set nobody else holds.
//
// The TypeScript family comes from `TS_LANGUAGE_IDS` rather than a second
// hand-written copy of the same four ids: the two lists disagreeing is the bug
// this import prevents.
const SERVED = new Set<string>(["rust", "csharp", "python", "go", ...TS_LANGUAGE_IDS]);

/**
 * The language ids FIM serves with no setting in play, for readers and tests.
 * A copy of the gate's set rather than the set itself, so a caller that adds to
 * it widens nothing: `fimServesLanguage` is the only answer of record.
 */
export const FIM_LANGUAGES: ReadonlySet<string> = new Set(SERVED);

/**
 * True exactly when FIM may run in `languageId`.
 *
 * `extra` is the user's widening list (`column80.fimLanguages`). It is read
 * forgivingly because it is typed by a human into a settings array: entries are
 * trimmed, compared case-insensitively, and blank entries are ignored. A blank
 * entry must never widen anything, or an empty row left in the settings UI
 * would serve every language including the empty one.
 */
export function fimServesLanguage(languageId: string, extra?: readonly string[]): boolean {
  if (SERVED.has(languageId)) {
    return true;
  }
  if (extra === undefined || extra.length === 0) {
    return false;
  }
  const wanted = languageId.trim().toLowerCase();
  if (wanted === "") {
    return false;
  }
  return extra.some((id) => typeof id === "string" && id.trim().toLowerCase() === wanted);
}
