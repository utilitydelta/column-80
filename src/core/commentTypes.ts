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

import { endOfLiteral } from "./brackets";
import { backtickedTypeNames } from "./compilerDirected";
import { CommentSyntax, commentSyntaxFor, nextComment } from "./fimComment";

/** The span with every PHANTOM literal opener blanked out, same length so every
 *  offset still indexes the original text.
 *
 *  A phantom is a quote that opens a literal the scan then runs across a NEWLINE
 *  to close. Rust is where this bites and it is a Rust-row fault: its quote set
 *  leaves `'` out, because in Rust a tick is a lifetime far more often than a
 *  char delimiter, so the bare `"` inside a `'"'` char literal is read as a
 *  string opener. It then swallows everything to the next `"` in the span, and
 *  every comment inside that run is gone - the whole backtick gesture goes
 *  silently dead for a body that handles a quote character, which is every
 *  parser, escaper, CSV writer and JSON writer. C# and Go carry `'` and get it
 *  right (session-v36 `[RECORD]` C2 is the control).
 *
 *  THE CHEAP FIX, and it is the one ratified rather than the right one. The
 *  right fix is the quote set in `commentSyntaxFor`, which is a v25 contract
 *  change and needs its own blind oracle over lifetimes; it is queued, not done
 *  here. What is done here is local to this leg, so no other consumer of
 *  `nextComment` moves.
 *
 *  THE COST, stated rather than discovered later, and it is NOT Rust-only. Any
 *  literal that legally spans lines is blanked by this rule, so the comment
 *  scanner reads its contents: a Rust multi-line string, a TypeScript template
 *  literal, a Go raw string, a C# `@"..."`. A `//` inside one contributes a
 *  backticked name it should not, and it contributes it FIRST, so under the type
 *  cap it is the real name that gets evicted. The anchor half pays too: a `/*`
 *  inside such a literal opens a block comment that never closes, and every code
 *  position after it in the span is then refused. That refusal falls back to the
 *  use/import scan, which is degraded rather than wrong, and it is the OPPOSITE
 *  direction from the under-rejection the header below still describes as safe.
 *  That is the trade the ratified rule takes: a false name competes for a cap
 *  slot, where a phantom kills the gesture for the whole span. Measured at
 *  review, the cost fires zero times on 102 real Rust files (glommio, 5,196
 *  anchor probes, 0 differences) and this repo's own 1,023 TypeScript spans move
 *  93 anchors right against 15 the truth oracle could not confirm either way.
 *
 *  RESIDUAL, and it is not the shape the entry named. `let q = '"'; let s = "x";`
 *  with the comment on a LATER line is CLOSED by this rule, by luck rather than
 *  design: the char literal's `"` pairs with the opener of `"x"`, which leaves
 *  that string's closer unpaired to cross the newline and be blanked. Any odd
 *  count of remaining quotes on the line lands the same way. What survives is a
 *  comment on the phantom's OWN line, between the opener and the quote it wrongly
 *  pairs with: `let q = '"';` then a BLOCK comment holding the name then
 *  `let s = "x";`, all on one line. Nothing crosses a newline there, nothing is
 *  blanked, and only the quote set closes it. Pinned as `A14-2` in
 *  `test/adversarial-v55-p14-phantom-literal.test.cjs`. */
function withoutPhantomLiterals(code: string, syntax: CommentSyntax): string {
  if (syntax.quotes.length === 0) {
    return code;
  }
  let out: string[] | undefined;
  for (let i = 0; i < code.length; i++) {
    // ORDER IS LOAD-BEARING HERE FOR THE SAME REASON IT IS IN `nextComment`: a
    // doc opener is tested before the quote that starts it, or Python's `"""`
    // reads as a quote and this pass blanks the first character of a docstring.
    // Measured: without this the unterminated-docstring shape loses every name
    // in it, which is three rows of session-v55 phase 11's oracle.
    const doc = syntax.doc.find((d) => code.startsWith(d, i));
    if (doc !== undefined) {
      const close = code.indexOf(doc, i + doc.length);
      i = (close < 0 ? code.length : close + doc.length) - 1; // the loop's i++ lands past it
      continue;
    }
    if (!syntax.quotes.includes(code[i])) {
      continue;
    }
    const end = endOfLiteral(code, i);
    if (code.slice(i, Math.min(end + 1, code.length)).includes("\n")) {
      // A phantom. Blank the OPENER only, and carry on from the next character:
      // the closing quote of the char literal that produced it is ordinary text
      // and the scan must be free to meet a real literal after it.
      out = out ?? [...code];
      out[i] = " ";
      continue;
    }
    i = end; // a real literal on one line; the loop's i++ lands past its close
  }
  return out === undefined ? code : out.join("");
}

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
  // The comment scan runs over the PHANTOM-FREE copy and every name is read out
  // of the ORIGINAL, which is why the blanking preserves length: `hit.index` and
  // `hit.end` index both strings identically.
  const scan = withoutPhantomLiterals(code, syntax);
  let from = 0;
  // `nextComment` resumes at `from` and never rescans what it passed, so the
  // whole walk is linear in the span however many comments it holds. Every kind
  // counts: a Python docstring nested in the body and a `/* */` above a local
  // are both places a developer writes down a type, and the gesture is "backtick
  // it in any comment", not "in the kinds one language calls documentation".
  for (;;) {
    const hit = nextComment(scan, syntax, from);
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
 * S36-1's under-rejection is CLOSED here, and the direction it failed in has
 * flipped. The Rust row in `commentSyntaxFor` still leaves `'` out of its quote
 * set, so a `'"'` char literal still opens a phantom string for every other
 * consumer of `nextComment`; what changed is that this function and
 * `commentTypesIn` both scan the `withoutPhantomLiterals` copy, so the comment
 * after the char literal is a comment again and its occurrences are refused.
 *
 * The new failure direction is OVER-rejection, and it is stated here because it
 * is not the safe one this paragraph used to claim. Blanking a legal multi-line
 * literal lets a `/*` inside it open a block comment that never closes, and then
 * every real code position after it in the span is refused. The caller falls
 * back to its use/import scan, so the type degrades to no anchor rather than to
 * a dead one; a local type that no import line names gets nothing. Measured at
 * review on 102 real Rust files: zero occurrences. Pinned as `A14-5` in
 * `test/adversarial-v55-p14-phantom-literal.test.cjs`.
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
  // The SAME phantom-free copy the extraction walks, and this is not tidiness.
  // These two functions are the two halves of one gesture: one finds a name in a
  // comment, the other refuses to anchor there, and the header above says they
  // read the same scanner for exactly that reason. Fixing the phantom in the
  // extraction alone would be worse than fixing neither - the gesture would
  // start extracting a name out of a comment the anchor still accepted as a code
  // position, which is the dead anchor the header calls worse than nothing.
  // Matches are taken from the ORIGINAL; the copy preserves length.
  const scan = withoutPhantomLiterals(code, syntax);
  let hit = nextComment(scan, syntax, 0);
  for (const match of code.matchAll(word)) {
    while (hit !== undefined && hit.end <= match.index) {
      // Same zero-width guard as the walk above: an opener the scanner reports
      // with no width must not spin here.
      hit = nextComment(scan, syntax, Math.max(hit.end, hit.index + 1));
    }
    if (hit !== undefined && match.index >= hit.index && match.index < hit.end) {
      continue;
    }
    return match.index;
  }
  return undefined;
}
