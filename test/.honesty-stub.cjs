// A deterministic stand-in for the model that decides the four honesty rows.
//
// WHY THIS EXISTS. Until 2026-08-29 `clock`, `prng`, `env` and `world` were 67
// regular expressions, so a test could put `Date.now()` in a fixture and the
// finding appeared with no model in the room. They are a model's judgement now,
// which means a test that asserts a clock finding has to SUPPLY that judgement,
// exactly as it already supplies a fix sentence.
//
// THIS IS NOT THE OLD TABLE MOVED INTO THE TESTS. The product carries no
// spelling list any more and must not. What a test stub carries is a scripted
// answer for one fixture, the same way `answer: () => GOOD` scripts a fix
// sentence: it says "assume the model spotted THIS line", so the rows after it
// are measuring the plumbing rather than the model. A test that wants to
// measure the model's judgement calls a real backend, and that lives in
// `session-v64/rig/honesty.cjs`, not here.

/** The marker every honesty prompt opens with, so a stub can tell the two
 *  rounds apart the way `FIX_PROMPT_MARK` does for the fix round. */
const HONESTY_PROMPT_MARK = "You are judging whether one function's signature tells the truth";

/**
 * An honesty reply naming every listed line that matches `patterns`.
 *
 * The prompt lists the function as `<document line>\t<text>`, so the stub reads
 * the numbers out of the prompt itself rather than being told them. A fixture
 * that moves down its file therefore keeps working, which is the same reason
 * the product reports document lines rather than slice offsets.
 *
 * `patterns` is `{ clock: /Date\.now/, ... }`. A dimension with no pattern
 * answers `none`.
 */
function honestyReply(prompt, patterns = {}) {
  const listed = [];
  for (const line of String(prompt).split("\n")) {
    const hit = /^(\d+)\t(.*)$/.exec(line);
    if (hit !== null) {
      listed.push({ line: Number(hit[1]), text: hit[2] });
    }
  }
  const out = [];
  for (const dimension of ["clock", "prng", "env", "world"]) {
    const pattern = patterns[dimension];
    const hits =
      pattern === undefined ? [] : listed.filter((l) => pattern.test(l.text)).map((l) => l.line);
    out.push(`${dimension}: ${hits.length === 0 ? "none" : hits.join(" ")}`);
  }
  return out.join("\n");
}

/** Whether this prompt is the honesty round's. */
function isHonestyPrompt(prompt) {
  return String(prompt).includes(HONESTY_PROMPT_MARK);
}

/**
 * The common shape: answer the honesty round from `patterns`, and hand every
 * other prompt to `rest`.
 *
 * A stub that answered the honesty prompt with a fix sentence would leave the
 * four rows `blind`, which is correct product behaviour and is almost never
 * what the row under test meant.
 */
function withHonesty(patterns, rest) {
  return (prompt) =>
    isHonestyPrompt(prompt) ? honestyReply(prompt, patterns) : rest === undefined ? "" : rest(prompt);
}

module.exports = { HONESTY_PROMPT_MARK, honestyReply, isHonestyPrompt, withHonesty };
