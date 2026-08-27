/**
 * Dimensions 1 to 4 of the rubric: does the signature tell the truth about what
 * comes IN.
 *
 * An honest function touches the world only through its signature. It reads
 * nothing and writes nothing the caller did not hand it, which is purity with
 * the religion removed: an in-place sort is honest because it mutates only what
 * you gave it and says so, and `getTime()` is dishonest because its signature
 * is a lie of omission and the real input is the state of the universe. These
 * four detectors read the four spellings of that lie a name table can see: the
 * wall clock, a pseudorandom generator, the process environment, and a file.
 *
 * ALL FOUR ADVISE AND NONE OF THEM REPAIRS, and the reason is structural rather
 * than cautious: the honest fix injects the dependency at the topmost level and
 * passes it in as an argument, which changes the signature and ripples to every
 * caller. Nothing in this file may name that fix, either. The rubric says which
 * law was broken and shows the line; the developer decides what it costs.
 *
 * WHAT THIS DOES NOT ANSWER, and the surface must not imply otherwise. The
 * honesty question's core is "does this function read a name bound outside
 * it", and no name table can answer it, because the name is whatever the
 * developer called their variable. Proven by running the name table over the
 * product's own canonical dishonest function: it catches the clock read and
 * misses BOTH the module-state read and the module-state write, which is the
 * headline dishonesty in that example. The free-identifier half needs scope
 * resolution through the symbol tree and is a build of its own.
 *
 * WRITING A LOG IS NOT ONE OF THESE. Measured at 16.1% of Python functions, and
 * printing does not make a result unreproducible. Reading the world does. Left
 * in, the Python leg would spend its entire budget telling people their scripts
 * print, so dimension 4 is guarded against it explicitly.
 *
 * Never imports vscode (the src/core rule).
 */

import {
  CriticizeLang,
  Detector,
  DetectorFinding,
  DimensionId,
  DimensionOutcome,
  FunctionUnderReview,
  bodyLines,
  unitDefect,
} from "./criticizeTypes";

export type { Detector } from "./criticizeTypes";

/** The detail line each dimension speaks with. One line, lower case, and it
 *  never names a fix: the same words every time a dimension fires, because a
 *  detail that varied with the code would be a second finding hiding inside
 *  the first. */
const DETAIL: Record<"clock" | "prng" | "env" | "world", string> = {
  clock: "reads the wall clock",
  prng: "reads a pseudorandom generator",
  env: "reads the process environment",
  world: "opens or reads a file",
};

/** Whether `[start, end)` of `masked` sits entirely inside something the
 *  profile calls a log write.
 *
 *  This is the structural half of the log guard. The other half is that no log
 *  spelling is in any `world` table to begin with, which is what keeps
 *  `print(...)` and `println!(...)` clean today. This one holds the invariant
 *  when a table is edited later: a world spelling that only ever appears inside
 *  a log call is a log call, and dimension 4 stays off it. A read nested in a
 *  log's ARGUMENTS still fires, and should: `print(open(p).read())` really does
 *  read the world. */
function insideLogWrite(masked: string, start: number, end: number, logWrites: readonly RegExp[]): boolean {
  for (const write of logWrites) {
    const scan = new RegExp(write.source, write.flags.includes("g") ? write.flags : `${write.flags}g`);
    for (const hit of masked.matchAll(scan)) {
      const at = hit.index ?? 0;
      if (at <= start && at + hit[0].length >= end) {
        return true;
      }
    }
  }
  return false;
}

/** The first spelling on a masked line that is not swallowed by a log write. */
function firstHit(masked: string, patterns: readonly RegExp[], logWrites: readonly RegExp[]): boolean {
  for (const pattern of patterns) {
    const hit = masked.match(pattern);
    if (hit === null || hit.index === undefined) {
      continue;
    }
    if (!insideLogWrite(masked, hit.index, hit.index + hit[0].length, logWrites)) {
      return true;
    }
  }
  return false;
}

/**
 * Run one name table over one function's masked body.
 *
 * AN EMPTY TABLE IS BLIND, NOT CLEAN. A language that registers no spellings
 * for a dimension cannot fire on it, and reporting that as a clean function
 * would be a fact about the table rather than about the code. The scout lost a
 * detector to exactly that shape: two 0.0% cells on one table, one of them the
 * code and one of them the rig, and nothing in the output told them apart.
 */
function nameTableOutcome(
  fn: FunctionUnderReview,
  lang: CriticizeLang,
  dimension: DimensionId,
  patterns: readonly RegExp[],
  detail: string,
  logWrites: readonly RegExp[],
): DimensionOutcome {
  const defect = unitDefect(fn);
  if (defect !== undefined) {
    return { state: "blind", reason: `this function's slice cannot be read: ${defect}` };
  }
  if (patterns.length === 0) {
    return {
      state: "blind",
      reason: `${lang.displayName} registers no spellings for this dimension, so a clean result here would be a fact about the table rather than about the code`,
    };
  }

  // `bodyLines` rather than `maskedBody` plus arithmetic, because the body is
  // not always `lines[bodyIndex..]`: a function whose body shares its
  // declaration line has no body line at all, and its code arrives as the head
  // line's remainder. Doing the `bodyIndex + i` sum here would report that
  // finding against the wrong document line.
  const findings: DetectorFinding[] = [];
  for (const entry of bodyLines(fn, lang)) {
    // An empty line carries no evidence, and a finding whose evidence is the
    // empty string is a defect rather than a weak finding.
    if (entry.raw.trim() === "") {
      continue;
    }
    if (firstHit(entry.masked, patterns, logWrites)) {
      findings.push({
        dimension,
        line: entry.line,
        evidence: entry.raw.trim(),
        detail,
      });
    }
  }

  // Ascending by line and one entry per line by construction: the walk visits
  // each body line once, in order, and emits at most one finding for it.
  return findings.length === 0 ? { state: "clean" } : { state: "flagged", findings };
}

/**
 * Dimensions 1 to 4, in rubric order.
 *
 * None of the four reads the doc block. All four read the masked body only,
 * because a clock spelling in a comment, a doc example or a string literal is
 * not a clock read, and a detector that fires on one has told the developer
 * something false about their own function.
 *
 * All four carry the axis "both" rather than picking a half. Honesty is the one
 * place in the rubric where the two halves are the same property: a function
 * whose real inputs are not in its signature cannot be tested or reproduced,
 * which is the safety half, and cannot be reasoned about locally by the next
 * reader, which is the understandability half.
 */
export const HONESTY_DETECTORS: readonly Detector[] = [
  {
    dimension: "clock",
    axis: "both",
    source: "Logan Smith 2026, honest functions: an honest function touches the world only through its signature",
    run: (fn, lang) =>
      nameTableOutcome(fn, lang, "clock", lang.honesty.clock, DETAIL.clock, lang.logWrites),
  },
  {
    dimension: "prng",
    axis: "both",
    source: "Logan Smith 2026, honest functions: the PRNG is the canonical example, a function that reads a global generator is untestable and unreproducible",
    run: (fn, lang) =>
      nameTableOutcome(fn, lang, "prng", lang.honesty.prng, DETAIL.prng, lang.logWrites),
  },
  {
    dimension: "env",
    axis: "both",
    source: "Logan Smith 2026, honest functions: the signature is a lie of omission, and the real input is the state of the universe",
    run: (fn, lang) =>
      nameTableOutcome(fn, lang, "env", lang.honesty.env, DETAIL.env, lang.logWrites),
  },
  {
    dimension: "world",
    axis: "both",
    source: "Logan Smith 2026, honest functions: build the core out of honest functions and inject the I/O at the topmost level, passed in as arguments",
    run: (fn, lang) =>
      nameTableOutcome(fn, lang, "world", lang.honesty.world, DETAIL.world, lang.logWrites),
  },
];
