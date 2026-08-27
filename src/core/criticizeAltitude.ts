/**
 * Dimensions 12, 13 and 15: does every line of the body sit at one altitude.
 *
 * Wirth's stepwise refinement, read backwards. A body that reads as a series of
 * named steps is at one altitude; a body that zooms into character codes, back
 * out to business logic and down into a hand-rolled search is mixing bricks
 * with brick-making. Three tells this can see without understanding the code:
 * a function that is only a call, a body stacked deep enough that the reader
 * has to hold five conditions at once, and a comment labelling a section that
 * wanted to be a function.
 *
 * ALL THREE ADVISE, and dimension 12 especially. Never auto-split a function:
 * the Ousterhout-Martin debate is unresolved among humans, and Martin's own
 * showcase decomposition carried a measured 3 to 4x performance regression. A
 * product that splits a function is taking a side with someone else's code.
 *
 * PYTHON COUNTS INDENTATION AND THE OTHER FOUR COUNT BRACES. This is not a
 * tidiness point. A brace counter reads every Python function as depth zero,
 * and depth zero is spelled exactly like a clean result, which is this
 * session's whole failure mode wearing a different hat.
 *
 * DIMENSION 15 SHIPS SCORED BUT NOT ELEVATED. It fires on 31.0% of real Rust
 * functions, and whether that is a nit flood or the most teachable line in the
 * rubric depends on who is reading it. That ruling is a human's, so the
 * detector carries a `held` flag and the renderer reads the FLAG rather than
 * the dimension id: the ruling then moves one boolean and touches no rendering.
 *
 * Never imports vscode (the src/core rule).
 */

import { parseParams } from "./criticizeLang";
import {
  BodyLine,
  CriticizeLang,
  Detector,
  DetectorFinding,
  DimensionOutcome,
  FunctionUnderReview,
  bodyLines,
  unitDefect,
} from "./criticizeTypes";

/** A line that carries no code of its own: blank after masking, or nothing but
 *  the punctuation that closes what an earlier line opened. */
function isStructural(masked: string): boolean {
  return /^[\s)}\];,]*$/.test(masked);
}

function slice(fn: FunctionUnderReview, lang: CriticizeLang): { body: readonly BodyLine[] } | { reason: string } {
  const defect = unitDefect(fn);
  if (defect !== undefined) {
    return { reason: `this function's slice cannot be read: ${defect}` };
  }
  return { body: bodyLines(fn, lang) };
}

// ===========================================================================
// Dimension 12, shallow pass-through
// ===========================================================================

/** The one call a pass-through body is made of, or undefined when the body is
 *  anything else. A `return` of a literal or of a field is not a call, and a
 *  body of two statements is not a pass-through however shallow it looks. */
function soleCall(body: readonly BodyLine[]): { line: BodyLine; args: readonly string[] } | undefined {
  const meaningful = body.filter((entry) => !isStructural(entry.masked));
  if (meaningful.length !== 1) {
    return undefined;
  }
  const line = meaningful[0];
  const text = line.masked.trim().replace(/;$/, "").replace(/^return\s+/, "").trim();
  const open = text.indexOf("(");
  if (open <= 0 || !text.endsWith(")")) {
    return undefined;
  }
  const callee = text.slice(0, open);
  if (!/^[A-Za-z_$][\w$]*([.:]{1,2}[A-Za-z_$][\w$]*)*$/.test(callee)) {
    return undefined;
  }
  const inner = text.slice(open + 1, -1).trim();
  const args = inner === "" ? [] : inner.split(",").map((a) => a.trim());
  return { line, args };
}

function passThrough(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome {
  const read = slice(fn, lang);
  if ("reason" in read) {
    return { state: "blind", reason: read.reason };
  }
  const params = parseParams(fn, lang);
  if (params === undefined) {
    return {
      state: "blind",
      reason: `the parameter list of this ${lang.displayName} declaration could not be read, and the width of the interface is half of this question`,
    };
  }
  const call = soleCall(read.body);
  // Zero parameters is not a wide interface, it is the narrowest one there is,
  // so there is nothing here for an implementation to be as wide as. Without
  // this line the arity test reads `0 < 0` as false and the argument check is
  // vacuously true on an empty list, so every no-argument accessor shipped a
  // finding whose own detail line refuted it: "carrying 0 of the signature's 0
  // parameters straight through".
  if (call === undefined || params.length === 0 || call.args.length < params.length) {
    return { state: "clean" };
  }
  // A body that TRANSFORMS its arguments before delegating has done work, and
  // work is depth. A COMPOUND argument is the tell for that: an operator, an
  // index, or a nested call means the body computed something. A bare name, a
  // literal, or a field reference does not, so `j.cookies(u, false)` is still
  // a pass-through even though `false` is not one of the parameters. The
  // contract defines this dimension by arity, and demanding every argument be
  // a parameter name cost it two thirds of its recall.
  const compound = call.args.some((arg) => /[-+*/%<>!&|^]|\(|\[/.test(arg));
  if (compound) {
    return { state: "clean" };
  }
  const finding: DetectorFinding = {
    dimension: "pass-through",
    line: call.line.line,
    evidence: call.line.raw.trim(),
    detail: `the body is one delegating call taking ${call.args.length} arguments against the signature's ${params.length} parameters, so the interface is as wide as the implementation`,
  };
  return { state: "flagged", findings: [finding] };
}

// ===========================================================================
// Dimension 13, nesting depth
// ===========================================================================

/**
 * The deepest block depth in the body, and the line that reaches it.
 *
 * A line that ENDS with `{` opens a block and a line that STARTS with `}`
 * closes one, which is how all four brace languages are actually written. The
 * alternative, counting every brace character, would read a Rust struct literal
 * or a `format!` argument as a block and inflate the depth of code that is not
 * nested at all.
 */
function braceDepth(body: readonly BodyLine[]): { depth: number; at: BodyLine | undefined } {
  let depth = 0;
  let max = 0;
  let deepest: BodyLine | undefined;
  for (const entry of body) {
    const text = entry.masked.trim();
    if (text === "") {
      continue;
    }
    if (text.startsWith("}")) {
      depth = Math.max(0, depth - 1);
    }
    if (depth > max) {
      max = depth;
      deepest = entry;
    }
    if (text.endsWith("{")) {
      depth++;
    }
  }
  return { depth: max, at: deepest };
}

/**
 * The same measurement for Python, counting INDENTATION.
 *
 * The indent stack is what makes this robust to a file that mixes four spaces
 * with two: what matters is that a line is further in than the line that
 * opened its block, not by how much.
 */
function indentDepth(body: readonly BodyLine[]): { depth: number; at: BodyLine | undefined } {
  const coded = body.filter((entry) => entry.masked.trim() !== "");
  if (coded.length === 0) {
    return { depth: 0, at: undefined };
  }
  const indentOf = (entry: BodyLine) => entry.masked.length - entry.masked.trimStart().length;
  const stack = [indentOf(coded[0])];
  let max = 0;
  let deepest: BodyLine | undefined;
  // A deeper line only opens a block when the line ABOVE it ended in a colon.
  // Without that test every wrapped expression counts as nesting: a dict
  // literal or a call whose arguments run over four lines read as four blocks
  // deep, on a body that opens none. The four brace languages are immune
  // because `braceDepth` requires a line to END with `{`, and Python's block
  // opener is just as recognisable. Measured: both of this dimension's false
  // positives on the labelled set were this shape.
  let opensBlock = false;
  for (const entry of coded) {
    const indent = indentOf(entry);
    while (stack.length > 1 && indent < stack[stack.length - 1]) {
      stack.pop();
    }
    if (indent > stack[stack.length - 1] && opensBlock) {
      stack.push(indent);
    }
    opensBlock = entry.masked.trimEnd().endsWith(":");
    if (stack.length - 1 > max) {
      max = stack.length - 1;
      deepest = entry;
    }
  }
  return { depth: max, at: deepest };
}

function nesting(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome {
  const read = slice(fn, lang);
  if ("reason" in read) {
    return { state: "blind", reason: read.reason };
  }
  const measured = lang.craft.blocks === "indentation" ? indentDepth(read.body) : braceDepth(read.body);
  const threshold = lang.craft.nestingThreshold;
  if (measured.depth < threshold || measured.at === undefined) {
    return { state: "clean" };
  }
  const finding: DetectorFinding = {
    dimension: "nesting",
    line: measured.at.line,
    evidence: measured.at.raw.trim(),
    detail: `the body nests ${measured.depth} blocks deep, at or above the chosen threshold of ${threshold} for ${lang.displayName}`,
  };
  return { state: "flagged", findings: [finding] };
}

// ===========================================================================
// Dimension 15, section comment betrays mixed altitude
// ===========================================================================

/** The tells that a commented line is COMMENTED-OUT CODE rather than a label.
 *  A section comment is prose; a line of code ends in punctuation. */
const CODE_TELLS = [";", "{", "}", "("];

function sectionComment(fn: FunctionUnderReview, lang: CriticizeLang): DimensionOutcome {
  const read = slice(fn, lang);
  if ("reason" in read) {
    return { state: "blind", reason: read.reason };
  }
  const findings: DetectorFinding[] = [];
  for (let i = 0; i < read.body.length; i++) {
    const entry = read.body[i];
    // Masked to blank plus a raw line that starts with the line comment is
    // exactly "a comment alone on its own line": a comment sharing a line with
    // code leaves the code behind in the mask, and a line inside a block
    // comment or a docstring does not start with the marker.
    if (entry.masked.trim() !== "" || !entry.raw.trim().startsWith(lang.lineComment)) {
      continue;
    }
    const text = entry.raw.trim().slice(lang.lineComment.length).trim();
    if (text === "" || CODE_TELLS.some((tell) => text.endsWith(tell))) {
      continue;
    }
    // A comment with nothing under it is a note, not a section label. The
    // section is the code the label introduces, and with no code there is no
    // section.
    const codeBelow = read.body.slice(i + 1).some((later) => !isStructural(later.masked));
    if (!codeBelow) {
      continue;
    }
    findings.push({
      dimension: "section-comment",
      line: entry.line,
      evidence: entry.raw.trim(),
      detail: "a comment labels the lines under it, and a labelled section is a step at its own altitude",
    });
  }
  // Ascending by line and one per line by construction: the walk visits each
  // body line once, in order.
  return findings.length === 0 ? { state: "clean" } : { state: "flagged", findings };
}

/**
 * Dimensions 12, 13 and 15, in rubric order.
 *
 * The nesting threshold is CHOSEN, not measured, and `docs/constants.md`
 * records it with that word. Nothing in the scout's corpora locates a knee in
 * block depth, and what depth costs a reader is a taste the audience dictates.
 */
export const ALTITUDE_DETECTORS: readonly Detector[] = [
  {
    dimension: "pass-through",
    axis: "understandable",
    source: "Ousterhout 2018, a philosophy of software design: deep functions, a simple interface over a substantial implementation",
    run: passThrough,
  },
  {
    dimension: "nesting",
    axis: "understandable",
    source: "McCabe 1976, cyclomatic complexity: the first attempt to measure too branchy, with Sonar's cognitive complexity fixing its nesting blindness in 2017",
    run: nesting,
  },
  {
    dimension: "section-comment",
    axis: "understandable",
    source: "Wirth 1971, program development by stepwise refinement: a comment that labels a section is the tell that the section wanted to be a function",
    // Held pending the human ruling on the nit-flood question. 31.0% of real
    // Rust functions carry one, and the elevation threshold is the only thing
    // the ruling moves in either direction.
    held: true,
    run: sectionComment,
  },
];
