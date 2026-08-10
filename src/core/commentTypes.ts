/**
 * The backtick gesture for comment-named types.
 *
 * A type name written in a COMMENT is injected only when the developer
 * backticks it. `MyType` in, MyType out; an unbackticked PascalCase word in the
 * same comment is prose and is left alone. Explicit opt-in beats a scan that
 * guesses, which is the product's ethos and also what the measurement says: on
 * 6,856 human-written comment lines an unbackticked PascalCase scan admitted
 * 5,232 names of which 122 were real repo types, and the type cap binds on most
 * targets, so the other 97.7% would evict types the model actually needed.
 *
 * The rule is one rule. The extraction is `typesNamedIn`'s doc-comment leg
 * (`backtickedTypeNames`) pointed at a second source, and the comment syntax is
 * `commentSyntaxFor`'s table, never a hand-rolled `//`. What is new here is
 * only WHERE the prose comes from: the comments inside a span, which every
 * other leg blanks out by construction.
 *
 * Pure, offline, never throws. A caller that hands garbage gets an empty list.
 */

import { backtickedTypeNames } from "./compilerDirected";
import { commentSyntaxFor, nextComment } from "./fimComment";

/**
 * The backticked type names in the comments of `code`, first-seen order,
 * deduped.
 *
 * `code` is a SPAN, not a document. The population this reads is the developer's
 * sketch of one function, and pointing it at a whole file would admit every
 * comment in it competing for the same four cap slots.
 *
 * `stopNames` is the CALLER's language's std set. Absent means no stop set at
 * all rather than Rust's: this function has no language opinion of its own, and
 * a caller that inherits Rust's idea of `Result` in C# loses a real type.
 *
 * `excludeName` is the declared symbol, dropped for the same reason
 * `typesNamedIn` drops it: a C# method name is PascalCase, and a comment naming
 * the target being generated must not resolve the target as its own
 * collaborator.
 */
export function commentTypesIn(
  code: string,
  languageId: string,
  excludeName?: string,
  stopNames?: ReadonlySet<string>,
): string[] {
  if (typeof code !== "string" || code === "" || typeof languageId !== "string") {
    return [];
  }
  const syntax = commentSyntaxFor(languageId);
  if (syntax === undefined) {
    return [];
  }
  const excludeBare = excludeName?.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
  const seen = new Set<string>();
  const out: string[] = [];
  let from = 0;
  // `nextComment` resumes at `from` and never rescans what it passed, so the
  // whole walk is linear in the span however many comments it holds. Every kind
  // counts: a Python docstring nested in the body and a `/* */` above a local
  // are both places a developer writes down a type, and the gesture is "backtick
  // it in any comment", not "in the kinds one language calls documentation".
  for (;;) {
    const hit = nextComment(code, syntax, from);
    if (hit === undefined) {
      break;
    }
    // An unterminated comment reports `end` at the end of the text, which ends
    // the walk on the next call. The max() is the guard for an opener the
    // scanner reports with no width at all: without it a zero-width hit would
    // spin here forever, and a hang is the one failure mode a pure helper on a
    // repair path must not have.
    from = Math.max(hit.end, hit.index + 1);
    for (const name of backtickedTypeNames(code.slice(hit.index, hit.end))) {
      if (seen.has(name) || name === excludeBare || stopNames?.has(name) === true) {
        continue;
      }
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * The offset in `code` of the first `\bname\b` occurrence that is NOT inside a
 * comment, or `undefined` when every occurrence is (or there is none).
 *
 * This is the rejection half of the gesture above, and it lives beside it so the
 * thing that FINDS a name in a comment and the thing that refuses to ANCHOR
 * there read the same scanner. A type is injected by asking the language server
 * to resolve the identifier at a real position, and measured live on two servers
 * a comment position resolves to nothing: no definition, no hover, no shape.
 * Worse than nothing, in fact. In a file that both imports the type and names it
 * in a gesture comment, a span leg that accepted the comment position pre-empted
 * the import line and injected an empty payload where the import injected the
 * whole enum.
 *
 * NOT `maskNonCode` (`fimInject.ts`), which is the obvious reach and is wrong
 * here: it is language-agnostic, so `#` always opens a line comment (blanking a
 * Rust `#[derive]`) and `'` always delimits a literal (mangling lifetimes). Run
 * `fn get<'a>(&'a self) -> &'a Widget` through it and the third unpaired tick
 * blanks `Widget`, which is exactly the name being anchored.
 *
 * STRING literals are deliberately not rejected. A name inside one is also a
 * dead anchor, but that case is unmeasured and widening the refusal on a guess
 * would drop anchors that work today.
 *
 * KNOWN UNDER-REJECTION, session-v36/scraps.md S36-1: the Rust row in
 * `commentSyntaxFor` leaves `'` out of its quote set, so a `'"'` char literal
 * earlier in the span opens a phantom string and the scanner then walks past
 * every comment after it. Those comment occurrences are accepted as anchors,
 * which is today's behaviour, so the failure direction is the safe one.
 *
 * An unmapped `languageId` has no comment syntax to judge with and returns the
 * first occurrence unchanged, for the same reason.
 */
export function firstCodeOccurrence(code: string, languageId: string, name: string): number | undefined {
  if (typeof code !== "string" || code === "" || typeof name !== "string" || name === "") {
    return undefined;
  }
  const word = new RegExp(`\\b${name}\\b`, "g");
  const syntax = typeof languageId === "string" ? commentSyntaxFor(languageId) : undefined;
  if (syntax === undefined) {
    return word.exec(code)?.index;
  }
  // The comment walk and the match walk both run forward over the same text, so
  // the comment cursor is advanced lazily rather than materialising every
  // comment range up front. Both are monotonic, which keeps this linear.
  let hit = nextComment(code, syntax, 0);
  for (const match of code.matchAll(word)) {
    while (hit !== undefined && hit.end <= match.index) {
      // Same zero-width guard as the walk above: an opener the scanner reports
      // with no width must not spin here.
      hit = nextComment(code, syntax, Math.max(hit.end, hit.index + 1));
    }
    if (hit !== undefined && match.index >= hit.index && match.index < hit.end) {
      continue;
    }
    return match.index;
  }
  return undefined;
}
