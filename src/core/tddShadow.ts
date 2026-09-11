import { neutralizeCommentsAndStrings, neutralizePythonCommentsAndStrings } from "./instructPostprocess";

/**
 * THE SHADOW GUARD. A generated test must not be named after the function it
 * tests.
 *
 * Session-v68's prompt asks for a SINGLE test function per target, and one test
 * invites naming it after the target. In Rust a locally declared item beats a
 * glob import, so a `fn first_even` inside `mod tests { use super::*; }` IS the
 * name `first_even` in there, and the loop that calls `first_even(xs)` calls the
 * zero-argument test with an argument. The file does not compile, and until
 * session-v69 the oracle could not see it (`cargo check` skips `#[cfg(test)]`).
 *
 * Python has the same hazard through `from mod import *` followed by a column-0
 * `def first_even():`. Go, C# and TypeScript do not: `TestXxx`, a method on a
 * test class and `it("…")` are all structurally distinct from the target's name.
 *
 * A RENAME rather than a refusal, and the trade is not close. The three existing
 * floors refuse because they cannot know what the human meant; this one knows
 * exactly what is wrong and exactly what to write instead. A test function's own
 * name is referenced by nothing, so moving it is deterministic and total. The
 * alternative charges the human a whole generation for a defect the product
 * introduced by asking for one test.
 */

export interface ShadowRename {
  /** The name the model wrote. */
  readonly from: string;
  /** The name it was given. */
  readonly to: string;
}

export interface ShadowGuardResult {
  /** The generated tests with every shadowing declaration renamed.
   *  Byte-identical to the input when nothing shadowed. */
  readonly text: string;
  /** Every rename applied, in the order the declarations appear. */
  readonly renames: readonly ShadowRename[];
  /** Shadowing names for which no free replacement was found. Non-empty means
   *  the caller must REFUSE the whole pass; `text` is then the input unchanged
   *  and `renames` is empty. A partly renamed result is never returned. */
  readonly refusals: readonly string[];
}

/** How many candidate names to try before giving up and refusing. Fifty
 *  `first_even_test_N` collisions in one file is not a real document; the bound
 *  exists so a pathological input cannot spin. */
const MAX_CANDIDATES = 50;

interface ShadowLens {
  /** Comments and strings blanked to spaces, newlines preserved, LENGTH
   *  PRESERVED — the offsets found here index the raw text. */
  neutralize(source: string): string;
  /** Declaration sites of `name` that shadow the target. */
  declarations(name: string): RegExp;
  /** The same shape with the name left open, for reading what a file already
   *  declares. Written out rather than derived from `declarations`, because the
   *  name there is REGEX-ESCAPED and a character class handed to it would be
   *  matched literally. */
  anyDeclaration(): RegExp;
  /** Does a declaration at this offset in the NEUTRALISED text actually shadow
   *  the target, or is it in some inner scope where the name is somebody else's?
   *  Absent means every match shadows. */
  shadowsAt?(neutral: string, offset: number): boolean;
  /** The Nth candidate replacement, 1-based. */
  candidate(target: string, n: number): string;
}

/**
 * Is the offset at MODULE scope — outside every `impl`, `trait` and `fn` body?
 *
 * The guard exists because a module-scope `fn first_even` inside
 * `mod tests { use super::*; }` beats the glob import. A method does not: an
 * inherent `impl Fixture { fn first_even(&self) }` lives in `Fixture`'s
 * namespace, a trait method lives in the trait's, and a nested helper lives in
 * its enclosing body. None of them shadows anything, and renaming one is the
 * exact corruption this file exists to prevent — the declaration moves and, by
 * rule 7, its call site does not. Adversarial review found it: the model's own
 * text compiled and the guard's output did not.
 *
 * A brace walk with a kind per open block, over the neutralised text so a brace
 * in a comment or a string cannot move the depth. Every open block being a `mod`
 * is module scope; anything else on the stack is not.
 */
function atModuleScope(neutral: string, offset: number): boolean {
  const stack: string[] = [];
  let pending: string | undefined;
  const word = /[A-Za-z_][A-Za-z0-9_]*/y;
  let i = 0;
  while (i < offset && i < neutral.length) {
    const c = neutral[i];
    if (c === "{") {
      stack.push(pending ?? "block");
      pending = undefined;
      i++;
      continue;
    }
    if (c === "}") {
      stack.pop();
      pending = undefined;
      i++;
      continue;
    }
    if (c === ";") {
      // A `fn` with no body (a trait method signature) ends here and never
      // pushes; without this its keyword would leak onto the NEXT block.
      pending = undefined;
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      word.lastIndex = i;
      const m = word.exec(neutral);
      if (m !== null) {
        if (m[0] === "mod" || m[0] === "impl" || m[0] === "trait" || m[0] === "fn") {
          pending = m[0];
        }
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return stack.every((kind) => kind === "mod");
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LENSES: Record<string, ShadowLens> = {
  rust: {
    neutralize: neutralizeCommentsAndStrings,
    // `fn NAME` anywhere in the generated module. A helper `fn first_even`
    // beside the test shadows just as hard as the test itself does.
    // `r#` is part of the SPELLING and not of the name: `fn r#first_even` IS the
    // identifier `first_even` and shadows exactly as hard. Captured whole so the
    // rename replaces the raw prefix along with the name.
    declarations: (name) => new RegExp(String.raw`\bfn\s+((?:r#)?${escapeForRegex(name)})\b`, "g"),
    anyDeclaration: () => /\bfn\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)\b/g,
    shadowsAt: atModuleScope,
    candidate: (target, n) => (n === 1 ? `${target}_test` : `${target}_test_${n}`),
  },
  python: {
    neutralize: neutralizePythonCommentsAndStrings,
    // COLUMN ZERO only. An indented `def` is a method or a closure and shadows
    // nothing at module scope, which is the only scope the star-import lands in.
    declarations: (name) =>
      new RegExp(String.raw`^(?:async[ \t]+)?def[ \t]+(${escapeForRegex(name)})[ \t]*\(`, "gm"),
    anyDeclaration: () => /^(?:async[ \t]+)?def[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*\(/gm,
    candidate: (target, n) => (n === 1 ? `test_${target}` : `test_${target}_${n}`),
  },
};

/** Every word in the text, raw rather than neutralised: a candidate name that
 *  appears only in a comment is still a name this file has opinions about, and
 *  over-avoiding costs one underscore. */
function wordsIn(text: string): Set<string> {
  return new Set(text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
}

/** Declaration names already in the file the tests will land in. Neutralised,
 *  because a `fn` in a doc comment declares nothing. */
function declaredIn(lens: ShadowLens, existingText: string): Set<string> {
  const neutral = lens.neutralize(existingText);
  const out = new Set<string>();
  for (const m of neutral.matchAll(lens.anyDeclaration())) {
    out.add(m[1]);
  }
  return out;
}

/**
 * Rename any generated test declaration that shadows `targetName`.
 *
 * `generatedTests` is the model's reply after extraction, BEFORE scaffolding.
 * `existingText` is the current full text of the file the tests land in, empty
 * when that file does not exist yet.
 *
 * Pure, total, and idempotent over its own output. An unregistered language, an
 * empty target name, or a reply with no shadowing declaration all return the
 * input unchanged.
 */
export function guardShadowedTestNames(
  languageId: string,
  generatedTests: string,
  targetName: string,
  existingText: string,
): ShadowGuardResult {
  const unchanged: ShadowGuardResult = { text: generatedTests, renames: [], refusals: [] };
  const lens = LENSES[languageId];
  if (lens === undefined || targetName.length === 0) {
    return unchanged;
  }
  const neutral = lens.neutralize(generatedTests);
  // The NAME's offsets, not the match's: only the identifier moves, so every
  // call to the function under test is byte-identical in the output. A global
  // replace here would rewrite `first_even(xs)` and break every case.
  const sites: { start: number; end: number }[] = [];
  for (const m of neutral.matchAll(lens.declarations(targetName))) {
    const start = (m.index ?? 0) + m[0].lastIndexOf(m[1]);
    if (lens.shadowsAt !== undefined && !lens.shadowsAt(neutral, start)) {
      continue;
    }
    sites.push({ start, end: start + m[1].length });
  }
  if (sites.length === 0) {
    return unchanged;
  }

  const taken = wordsIn(generatedTests);
  for (const name of declaredIn(lens, existingText)) {
    taken.add(name);
  }
  const renames: ShadowRename[] = [];
  for (let i = 0; i < sites.length; i++) {
    let chosen: string | undefined;
    for (let n = 1; n <= MAX_CANDIDATES; n++) {
      const candidate = lens.candidate(targetName, n);
      if (!taken.has(candidate)) {
        chosen = candidate;
        break;
      }
    }
    if (chosen === undefined) {
      // All or nothing. A partly renamed pass is the shape that reads as safe
      // and is not: one declaration still shadows and the file still will not
      // build, under a message saying the guard ran.
      return { text: generatedTests, renames: [], refusals: [targetName] };
    }
    // Claimed, so a second shadowing declaration gets a DIFFERENT name.
    taken.add(chosen);
    renames.push({ from: targetName, to: chosen });
  }

  // Back to front, so an earlier splice cannot move a later offset.
  let text = generatedTests;
  for (let i = sites.length - 1; i >= 0; i--) {
    text = text.slice(0, sites[i].start) + renames[i].to + text.slice(sites[i].end);
  }
  return { text, renames, refusals: [] };
}
