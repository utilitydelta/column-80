// ===========================================================================
// The honesty judge, and why it is not a name table.
//
// Dimensions 1 to 4 ask whether a function's signature tells the truth about
// what comes IN. Until 2026-08-29 they were 67 regular expressions across five
// languages, naming library calls someone had thought to write down:
// `Instant::now`, `os.environ`, `Directory.GetFiles`. That engine could only
// ever find the spellings in its own list, so a row rendered `clean` meant
// "none of my patterns matched" while reading as "this function is honest".
// The module it replaced said so itself, and proved it on the product's own
// canonical dishonest function: the table caught the clock read and missed both
// the module-state read and the module-state write, which was the headline
// dishonesty in that example.
//
// A model reads the function instead. Human ruling, 2026-08-29, recorded in the
// amendment at the end of session-v64/goal.md along with the counter-evidence
// that was put to the human first.
//
// WHAT THE MODEL DECIDES, AND WHAT IT DOES NOT. It decides whether a dimension
// fires and on which line. It does not write the evidence, it does not word the
// detail, and it cannot reach the other ten dimensions. Those are structural
// rather than conventional:
//
//   - The model returns LINE NUMBERS. There is nowhere in the reply to put a
//     sentence, so no model text can reach `DetectorFinding.evidence`. The
//     evidence is read out of the function's own lines, exactly as the name
//     tables read it.
//   - A line the function does not have is DISCARDED. Not clamped, not moved to
//     the nearest line, not repaired. A card that quotes a line the developer
//     never wrote is worse than a missed finding.
//   - `HONESTY_DETAIL` is a constant table and the reply cannot address it.
//
// A FAILED ROUND IS `blind`, NEVER `clean`. This is the whole point of the
// change. `clean` from a model that never answered is the same false
// certificate the regexes gave, and the card already has a word for "nothing
// here can tell you": `blind`, with a reason that names the backend.
//
// Never imports vscode (the src/core rule). Nothing here reads a clock or a
// filesystem, and `honestyOutcomes` is pure.
// ===========================================================================

import { CriticizeLang } from "./criticizeLang";
import { DetectorFinding, DimensionOutcome, FunctionUnderReview, bodyLines, unitDefect } from "./criticizeTypes";

export type HonestyDimension = "clock" | "prng" | "env" | "world";

/** The four, in rubric order. Fixed by this module: a reply naming anything
 *  else decides nothing, because the dimension set is not the model's to
 *  extend. */
export const HONESTY_DIMENSIONS: readonly HonestyDimension[] = ["clock", "prng", "env", "world"];

/** The one-line detail each dimension speaks with, unchanged from the name
 *  tables it replaces.
 *
 *  These stay CONSTANT while the finding set becomes a model's, and the split
 *  is deliberate: a detail that varied with the code would be a second finding
 *  hiding inside the first, and it would vary between two presses on unchanged
 *  bytes. The model moves the row; the words the row speaks do not move. */
export const HONESTY_DETAIL: Readonly<Record<HonestyDimension, string>> = {
  clock: "reads the wall clock",
  prng: "reads a pseudorandom generator",
  env: "reads the process environment",
  world: "opens or reads a file",
};

/** What each dimension asks, in the words the model is asked to apply. This is
 *  a definition of the QUESTION and not a list of answers: no library, crate,
 *  package or API spelling appears here or anywhere else in the prompt. That is
 *  the ruling. A table smuggled into a prompt is the same table. */
const HONESTY_QUESTION: Readonly<Record<HonestyDimension, string>> = {
  clock: "reads the current time from outside the function, so two runs with identical arguments can differ",
  prng: "draws randomness the caller did not supply, so a run cannot be reproduced from its arguments",
  env: "reads process-wide configuration the caller did not supply, such as environment variables or command-line arguments",
  world: "reads a file or directory from the filesystem, which is state the caller did not hand it",
};

/** One round against a model. The same shape as `ExplainTransport`, so a caller
 *  wires one transport and both model legs use it. */
export type HonestyTransport = (prompt: string) => Promise<string>;

/** Everything the model may be shown besides the function itself.
 *
 *  Every field is optional and every absence is a shipped state: a language
 *  server that does not answer outgoing calls costs the prompt a block and
 *  costs the product nothing. */
export interface HonestyContext {
  /** Downstream callees and whatever contract they publish. A call into a
   *  helper is how most real dishonesty hides, and the callee's name alone
   *  carries some of it even when the doc is empty. */
  callees?: readonly { name: string; doc: string }[];
}

/** Why the four rows could not be decided. Both kinds render as `blind`. */
export type HonestyFailure =
  | { kind: "transport"; detail: string }
  | { kind: "unreadable"; detail: string };

/** Which document lines the model named, per dimension. Numbers only: the
 *  reply has nowhere to put prose. */
export type HonestyLines = Readonly<Record<HonestyDimension, readonly number[]>>;

export type HonestyRead = { ok: true; lines: HonestyLines } | { ok: false; failure: HonestyFailure };

const EMPTY_LINES: HonestyLines = { clock: [], prng: [], env: [], world: [] };

/**
 * The prompt.
 *
 * It carries the function with its own document line numbers, and the callees
 * when a server answered for them. It carries no spelling table, by ruling: the
 * model is asked what the code DOES, not whether it matches a list.
 *
 * The line numbers in the listing are the document's, not the slice's, because
 * they are the only thing the reply is allowed to contain and a reply in slice
 * coordinates would have to be translated by the same code that trusts it.
 */
export function buildHonestyPrompt(
  fn: FunctionUnderReview,
  lang: CriticizeLang,
  context: HonestyContext,
): string {
  const parts: string[] = [];
  parts.push(
    "You are judging whether one function's signature tells the truth about what comes into it.",
    "An honest function touches the world only through its signature: it reads nothing the caller did not hand it.",
    "",
    `Language: ${lang.displayName}`,
    `Function: ${fn.name}`,
    "",
    "The function, with its document line numbers:",
  );
  for (let i = 0; i < fn.lines.length; i++) {
    parts.push(`${fn.startLine + i}\t${fn.lines[i]}`);
  }

  const callees = context.callees ?? [];
  if (callees.length > 0) {
    parts.push(
      "",
      "What this function calls, and what those callees document about themselves.",
      "A call into one of these is a read of the world if the callee performs one:",
    );
    for (const callee of callees) {
      parts.push(callee.doc.trim() === "" ? `- ${callee.name}` : `- ${callee.name}: ${callee.doc.trim()}`);
    }
  }

  parts.push("", "Four questions. For each, name the document line numbers where the function:");
  for (const dimension of HONESTY_DIMENSIONS) {
    parts.push(`- ${dimension}: ${HONESTY_QUESTION[dimension]}`);
  }
  parts.push(
    "",
    "Rules:",
    "- Judge only the body. A doc comment describing a clock read is not a clock read.",
    "- Writing output is not reading the world. Logging, printing and tracing do not fire any of the four.",
    "- Receiving a value as an argument is honest however it was produced. Only a read the function performs itself counts.",
    "- Name a line only if you can point at what on it does the reading.",
    "",
    "Answer with exactly four lines and nothing else, no prose and no code fences:",
    ...HONESTY_DIMENSIONS.map((dimension) => `${dimension}: <line numbers separated by spaces, or none>`),
  );
  return parts.join("\n");
}

/**
 * Read a reply into line numbers. TOTAL: never throws, whatever it is handed.
 *
 * A reply counts as read when at least ONE of the four dimension lines is
 * recognisable. That threshold is what separates invariant I4 from I5: a model
 * that answered and found nothing writes four `none` lines and every dimension
 * is `clean`, while a model that returned an apology, a fence, an empty string
 * or a stack trace matches nothing and the four rows go `blind`. Treating an
 * unrecognisable reply as four clean rows would put the false certificate
 * straight back.
 */
export function readHonestyReply(raw: unknown): HonestyRead {
  if (typeof raw !== "string") {
    return { ok: false, failure: { kind: "unreadable", detail: `the backend returned ${typeof raw}, not text` } };
  }
  const text = raw.trim();
  if (text === "") {
    return { ok: false, failure: { kind: "unreadable", detail: "the backend returned an empty answer" } };
  }

  const lines: Record<HonestyDimension, number[]> = { clock: [], prng: [], env: [], world: [] };
  let recognised = 0;
  for (const dimension of HONESTY_DIMENSIONS) {
    // Anchored to a line start so the word inside a sentence cannot be read as
    // an answer, and case-insensitive because a model that shouts is still
    // answering. A dimension named twice takes its LAST answer, which is what a
    // model correcting itself means.
    const hits = [...text.matchAll(new RegExp(`^\\s*${dimension}\\s*:(.*)$`, "gim"))];
    if (hits.length === 0) {
      continue;
    }
    recognised += 1;
    lines[dimension] = numbersIn(hits[hits.length - 1][1]);
  }
  if (recognised === 0) {
    return {
      ok: false,
      failure: { kind: "unreadable", detail: "the backend's answer named none of the four dimensions" },
    };
  }
  return { ok: true, lines };
}

/** Every integer in one answer's tail. `none`, prose and punctuation all yield
 *  nothing, which is the same as an empty answer and is correct: a dimension
 *  with no line numbers did not fire. */
function numbersIn(tail: string): number[] {
  const out: number[] = [];
  for (const hit of tail.matchAll(/\d+/g)) {
    const value = Number(hit[0]);
    if (Number.isSafeInteger(value)) {
      out.push(value);
    }
  }
  return out;
}

/**
 * The four outcomes. PURE, and the only place a finding is built.
 *
 * `bodyLines` is the authority on which document lines this function's body
 * actually has, and it is the same call the name tables used, so "which lines
 * may be named" does not become a second definition of a function's body that
 * can drift from the first. A number that is not one of those lines is dropped
 * on the floor. So is a line whose text is blank, because a finding whose
 * evidence is the empty string is a defect rather than a weak finding.
 */
export function honestyOutcomes(
  fn: FunctionUnderReview,
  lang: CriticizeLang,
  lines: HonestyLines,
): Readonly<Record<HonestyDimension, DimensionOutcome>> {
  const defect = unitDefect(fn);
  if (defect !== undefined) {
    return blindOn(`this function's slice cannot be read: ${defect}`);
  }

  // MASKED DECIDES WHETHER A LINE IS NAMEABLE, RAW SUPPLIES THE EVIDENCE. Both
  // halves matter and they are the same split the name tables held.
  //
  // The model reads the function as the developer wrote it, comments included,
  // so it can name a line that is nothing but a comment saying the code reads a
  // clock. A comment describing a read is not a read, and the prompt says so,
  // but a rule stated only in a prompt is a rule a model can decline. `masked`
  // blanks comments and string literals, so a line with no code left in it
  // cannot carry a finding whatever the reply says.
  //
  // The evidence is still the RAW line: a card must quote what the developer
  // wrote, not the product's internal masked copy.
  const evidence = new Map<number, string>();
  for (const entry of bodyLines(fn, lang)) {
    if (entry.masked.trim() === "") {
      continue;
    }
    const trimmed = entry.raw.trim();
    if (trimmed !== "") {
      evidence.set(entry.line, trimmed);
    }
  }

  const out: Partial<Record<HonestyDimension, DimensionOutcome>> = {};
  for (const dimension of HONESTY_DIMENSIONS) {
    const findings: DetectorFinding[] = [];
    // A Set because a model naming one line twice means one finding, and the
    // sort because a card's findings are read top to bottom.
    for (const line of [...new Set(lines[dimension] ?? [])].sort((a, b) => a - b)) {
      const text = evidence.get(line);
      if (text !== undefined) {
        findings.push({ dimension, line, evidence: text, detail: HONESTY_DETAIL[dimension] });
      }
    }
    out[dimension] = findings.length === 0 ? { state: "clean" } : { state: "flagged", findings };
  }
  return out as Record<HonestyDimension, DimensionOutcome>;
}

/** All four refusing with one reason. */
function blindOn(reason: string): Readonly<Record<HonestyDimension, DimensionOutcome>> {
  const out: Partial<Record<HonestyDimension, DimensionOutcome>> = {};
  for (const dimension of HONESTY_DIMENSIONS) {
    out[dimension] = { state: "blind", reason };
  }
  return out as Record<HonestyDimension, DimensionOutcome>;
}

/** The sentence a refusal speaks with. It names the backend, because "the
 *  model did not answer" and "there is no model" were byte-identical on the
 *  channel for a whole release and it cost this session 44 host runs. */
export function honestyBlindReason(backendName: string, failure: HonestyFailure): string {
  const name = backendName.trim() === "" ? "the configured model" : backendName.trim();
  return failure.kind === "transport"
    ? `${name} did not answer, so nothing here can tell you whether this function reads the world: ${failure.detail}`
    : `${name} answered, but not readably, so nothing here can tell you whether this function reads the world: ${failure.detail}`;
}

/**
 * The whole round. NEVER THROWS, including on cancellation.
 *
 * A caller that wants to know a round was cancelled reads it off the reason
 * rather than off a rejection, because the four rows have to render either way
 * and a gesture that throws part way through leaves a card with four holes in
 * it.
 */
export async function judgeHonesty(
  transport: HonestyTransport,
  fn: FunctionUnderReview,
  lang: CriticizeLang,
  context: HonestyContext,
  backendName: string,
): Promise<Readonly<Record<HonestyDimension, DimensionOutcome>>> {
  const defect = unitDefect(fn);
  if (defect !== undefined) {
    return blindOn(`this function's slice cannot be read: ${defect}`);
  }

  let raw: unknown;
  try {
    raw = await transport(buildHonestyPrompt(fn, lang, context));
  } catch (err) {
    return blindOn(honestyBlindReason(backendName, { kind: "transport", detail: detailOf(err) }));
  }

  const read = readHonestyReply(raw);
  if (!read.ok) {
    return blindOn(honestyBlindReason(backendName, read.failure));
  }
  return honestyOutcomes(fn, lang, read.lines);
}

/** One line of whatever was thrown, and never a stack: the reason reaches a
 *  developer's card. */
function detailOf(err: unknown): string {
  if (err instanceof Error && err.message.trim() !== "") {
    return err.message.trim().split("\n")[0];
  }
  const text = String(err).trim();
  return text === "" ? "no detail" : text.split("\n")[0];
}

/** The all-clear an unreached round never gets to claim. Exported so a caller
 *  building a card without a model can be explicit rather than implicit. */
export const HONESTY_EMPTY: HonestyLines = EMPTY_LINES;
