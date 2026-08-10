// FINAL adversarial review, session-v25. Composition, wiring, comment rules,
// floor, ledger. Dot-prefixed so the runner ignores it.
//
// Every test here asserts the behaviour the goal's acceptance bar and the
// contracts state, and every one of them is RED against the current tree. Each
// names the smallest fix in its comment.
//
// Run: node --test test/.adv-v25-final.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adv-v25-final",
  `export { CompletionService, belowGhostFloor } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";
export { createSuppressionLedger } from "../src/core/suppressionLedger";
export { commentSyntaxFor, cursorInComment, cutIntroducedComment } from "../src/core/fimComment";
export { postprocess } from "../src/core/postprocess";\n`,
);
const {
  CompletionService,
  belowGhostFloor,
  DEFAULT_FIM_CONFIG,
  createSuppressionLedger,
  commentSyntaxFor,
  cursorInComment,
  cutIntroducedComment,
  postprocess,
} = mod;
test.after(cleanup);

const CFG = { ...DEFAULT_FIM_CONFIG, cacheCapacity: 0, debounceMs: 0 };

// Drives the real service with a scripted generate fn. `texts` is consumed in
// CALL order, and the service launches the extras BEFORE awaiting the primary,
// so with one entry it is the primary's.
function drive(texts, request, config = {}) {
  const logs = [];
  const ledger = createSuppressionLedger();
  let i = 0;
  const svc = new CompletionService(
    { ...CFG, ...config },
    async () => ({ text: texts[Math.min(i++, texts.length - 1)], ttftMs: 1, totalMs: 2 }),
    (l) => logs.push(l),
    ledger,
  );
  return { svc, logs, ledger, run: (r) => svc.complete({ suffix: "", uri: "u", ...request, ...r }) };
}

// ---------------------------------------------------------------------------
// F1. The bound runs in EVERY languageId, and in prose it refuses everything.
//
// The provider registers on document scheme alone, so markdown, plaintext,
// yaml and every other non-code buffer reach the bound. `fimBound` says "an
// unmapped language gets the C-family rules", and under those rules rule 5's
// DANGLING class contains `.` `,` `:` `?` - which is how a prose line ends.
// Every forward and backward safe point dangles, so the whole ghost is refused.
//
// contract-comment.md promises "an unmapped languageId changes nothing about
// today's behaviour". The bound made that false and no contract covers it.
//
// Smallest fix: gate the bound on a known languageId (the five shipped ones,
// the same test `constructOpenersFor`/`commentSyntaxFor` already make), and
// leave every other language on the pre-v25 pipeline.
// ---------------------------------------------------------------------------
test("F1 prose: a markdown ghost is not refused outright", async () => {
  const raw = "keyed on the model input window.\nEvery entry is windowed.\n";
  const { run, logs } = drive([raw], { prefix: "# Notes\n\nThe cache is ", languageId: "markdown" });
  const r = await run();
  assert.ok(
    r && r.text !== "",
    `markdown ghost refused entirely. logs:\n${logs.join("\n")}\n` +
      `unbounded pipeline serves: ${JSON.stringify(postprocess(raw, { suffix: "", currentLinePrefix: "The cache is ", multiline: true }))}`,
  );
});

test("F1b prose: the refusal rate over this repo's own ARCHITECTURE.md is not 100%", async () => {
  const doc = fs.readFileSync(path.join(__dirname, "..", "ARCHITECTURE.md"), "utf8");
  const lines = doc
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("```") && l.length > 40);
  let total = 0;
  let refused = 0;
  for (let i = 0; i < lines.length - 2; i++) {
    const cut = Math.floor(lines[i].length / 2);
    const prefix = lines.slice(Math.max(0, i - 3), i).join("\n") + "\n" + lines[i].slice(0, cut);
    const raw = lines[i].slice(cut) + "\n" + lines[i + 1] + "\n";
    const { run } = drive([raw], { prefix, languageId: "markdown" });
    const r = await run();
    total++;
    if (!r || r.text === "") {
      refused++;
    }
  }
  assert.ok(total > 20, "fixture sanity");
  assert.ok(refused < total, `every one of ${total} simulated markdown sites was refused`);
});

// ---------------------------------------------------------------------------
// F2. Phase 4b and phase 4 were measured apart and compose badly.
//
// Finding 8 (23:56) made a declaration head serve the rest of the SIGNATURE and
// stop, so the ghost is now `) {`, `Self {`, `self):`. The length floor (00:20)
// then refuses exactly that shape. Neither was re-measured after the other.
//
// Evidence: apply the shipped floor to the shipped run
// `session-v25/harness/results/verify-decl.json` (the post-finding-8 pipeline).
// 17 of 710 served ghosts trip it, not the 1.0% quoted in `belowGhostFloor`,
// `src/core/config.ts`, `src/vscode/config.ts` and `package.json` - and 9 of the
// 17 carried a line the developer actually went on to write (7 Go `) {`, a Rust
// `Self {`, a Python `self):`).
//
// Smallest fix: exempt a ghost that ends on an unclosed block opener from the
// floor - it is the finding-8 shape and the bound already recognises it
// (`opensBlockAtTail`). Failing that, re-derive the default from verify-decl
// rather than from verify-phase2 and correct the four places quoting 1%.
// ---------------------------------------------------------------------------
test("F2 the floor does not refuse a finding-8 signature ghost", async () => {
  const go = drive([") {\n"], { prefix: "func handle(w http.ResponseWriter, r *http.Request", languageId: "go" });
  const rGo = await go.run();
  const rs = drive([" {\n"], { prefix: "        Self", languageId: "rust" });
  const rRust = await rs.run();
  assert.equal(rGo && rGo.text, ") {", `go signature ghost refused:\n${go.logs.join("\n")}`);
  assert.equal(rRust && rRust.text, " {", `rust signature ghost refused:\n${rs.logs.join("\n")}`);
});

test("F2b the floor's shipped 1.0% claim holds on the CURRENT pipeline's own run", () => {
  const file = path.join(__dirname, "..", "session-v25", "harness", "results", "verify-decl.json");
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  const served = rows.filter((r) => r.ghost);
  const tripped = served.filter((r) => belowGhostFloor(r.ghost, 8, 2));
  const costly = tripped.filter((r) => r.correct > 0);
  assert.ok(
    tripped.length / served.length <= 0.015,
    `floor trips ${tripped.length}/${served.length} = ${((100 * tripped.length) / served.length).toFixed(1)}%,` +
      ` against the 1.0% the shipped comments and package.json quote`,
  );
  assert.equal(
    costly.length,
    0,
    `${costly.length} floor-refused ghosts matched the developer's own next line: ` +
      JSON.stringify(costly.map((r) => r.ghost)),
  );
});

// ---------------------------------------------------------------------------
// F3. The comment cut MANUFACTURES floor refusals.
//
// The floor's docstring says it is "judged on the SERVED text, so what the
// floor measures is what the human would have seen". It runs after the comment
// cut, so what it measures is the ghost MINUS the comment - and a ghost that is
// well over the floor before the cut can fall under it after. Neither rule
// suppresses this on its own: the comment cut alone serves `n = 1`, the floor
// alone serves the whole 34-character ghost. Composed, the human gets nothing.
//
// One site in the 750-generation corpus (a real Python continuation cut from a
// 4-line arithmetic expression down to `+ 9 * 4`), plus the shape below.
//
// Smallest fix: judge the floor on the text BEFORE the comment cut, or skip the
// floor entirely when a comment cut fired on this candidate.
// ---------------------------------------------------------------------------
test("F3 a ghost that clears the floor before the comment cut is still served after it", async () => {
  const { run, logs, ledger } = drive(["n = 1  # the counter starts at one\n"], {
    prefix: "def f():\n    ",
    languageId: "python",
  });
  const r = await run();
  assert.equal(
    r && r.text,
    "n = 1",
    `comment cut + floor composed into a full suppression. logs:\n${logs.join("\n")}\n` +
      `ledger: ${JSON.stringify(ledger.snapshot())}`,
  );
});

// ---------------------------------------------------------------------------
// F4. The ledger counts two of its four kinds in different units.
//
// `below-floor` is counted ONCE per request, with the reason written at the
// call site: "a manual fan-out asking for four candidates and refusing all four
// is one completion the human did not get, and counting per candidate would
// price it as four." `comment-introduced` does exactly that - `cutComment` runs
// per candidate and notes per candidate. Four "dropped" lines and a
// `comment-introduced=4` for one keystroke that lost NOTHING (all four ghosts
// were served, minus their comments).
//
// Smallest fix: note `comment-introduced` once per request, the way the floor
// does, and stop using the `dropped:` prefix for a cut that still serves.
// ---------------------------------------------------------------------------
test("F4 the comment cut counts one suppression per request, not per candidate", async () => {
  const texts = [
    "let a = compute(x); // step one\n",
    "let b = compute(y); // step two\n",
    "let c = compute(z); // step three\n",
    "let d = compute(w); // step four\n",
  ];
  const { run, logs, ledger } = drive(texts, { prefix: "fn f() {\n    ", suffix: "\n}", languageId: "rust" });
  const r = await run({ manual: true, alternatives: 4 });
  assert.ok(r && r.text !== "", "sanity: a ghost was served");
  assert.equal(
    ledger.snapshot()["comment-introduced"],
    1,
    `one keystroke, ${ledger.snapshot()["comment-introduced"]} suppressions counted. logs:\n${logs.join("\n")}`,
  );
});

test("F4b a keystroke that SERVED a ghost logs no `dropped:` suppression line", async () => {
  const { run, logs } = drive(["let a = compute(x); // step one\n"], {
    prefix: "fn f() {\n    ",
    suffix: "\n}",
    languageId: "rust",
  });
  const r = await run();
  assert.equal(r && r.text, "let a = compute(x);", "sanity");
  const dropped = logs.filter((l) => l.includes("[fim] dropped:"));
  assert.deepEqual(dropped, [], `a served keystroke emitted suppression lines: ${JSON.stringify(dropped)}`);
});

// ---------------------------------------------------------------------------
// F5. The alternate-promotion path reports the wrong generation, and counts a
//     suppression for a keystroke that served a ghost.
//
// The extras are launched BEFORE the primary is awaited, so when the primary is
// refused by the safety rule and an alternate is promoted, the served ghost
// came from a DIFFERENT generation than the one `boundNote` describes. The line
// reads `bound=empty dropped=1` beside a served 19-character ghost, and
// `bound-unsafe` is counted although the human got a completion.
//
// `kept=` was already recomputed from the served text for exactly this class of
// reason; `bound=`, `dropped=` and `appended=` were not.
//
// Smallest fix: carry the promoted candidate's own BoundOutcome (make the
// alternates run through `postprocessBounded` too) and emit `boundNote` from
// whichever outcome belongs to the served text; do not count `bound-unsafe`
// when the request went on to serve.
// ---------------------------------------------------------------------------
test("F5 a promoted alternate does not leave the primary's bound on the evidence line", async () => {
  // call order: extra, extra, primary. The primary is the refused one.
  const texts = ["let x = compute(a);\n", "let y = foo(\n", "let z = bar(\n"];
  const { run, logs, ledger } = drive(texts, { prefix: "fn f() {\n    ", languageId: "rust" });
  const r = await run({ manual: true, alternatives: 3 });
  assert.equal(r && r.text, "let x = compute(a);", "sanity: an alternate was promoted");
  const line = logs.find((l) => l.startsWith("[fim] ttft="));
  assert.ok(!/bound=empty/.test(line), `served a ghost, reported bound=empty: ${line}`);
  assert.equal(
    ledger.snapshot()["bound-unsafe"],
    0,
    `bound-unsafe counted for a keystroke that served a ghost. logs:\n${logs.join("\n")}`,
  );
});

test("F5b an alternate refused by the safety rule is on the record", async () => {
  const texts = ["let x = compute(a);\n", "let y = foo(\n", "let z = bar(\n"];
  const { run, logs, ledger } = drive(texts, { prefix: "fn f() {\n    ", languageId: "rust" });
  await run({ manual: true, alternatives: 3 });
  // Two candidates (`let y = foo(` and `let z = bar(`) were refused unsafe.
  // Only the primary's refusal is logged or counted; the alternate's is silent,
  // because the alternates go through `postprocess` which discards BoundOutcome.
  assert.equal(
    logs.filter((l) => l.includes("no safe cut point")).length,
    2,
    `alternate safety refusals are silent. logs:\n${logs.join("\n")}`,
  );
  assert.equal(ledger.snapshot()["bound-unsafe"], 2, "and uncounted");
});

// ---------------------------------------------------------------------------
// F6. Both comment rules read a `//` inside a regex literal as a comment.
//
// `nextComment` skips string and char literals but knows nothing about a
// JavaScript regex literal, and `/\/\//` contains a literal `//`.
//
// Symptom A (the worse one): the provider goes DARK on real code. `fimComment`
// states its own invariant as "the cost to control is FALSE POSITIVES: going
// dark on real code is worse than every ghost this removes" - and this is one,
// with no model call and a channel line claiming the cursor is in a comment.
//
// Symptom B: `cutIntroducedComment` truncates the regex mid-literal, after
// which `sealCut`'s safety rule usually refuses the whole ghost and blames a
// comment that was never there.
//
// Smallest fix: in the TS row's scanner, treat `/` as a literal opener when the
// preceding non-space character cannot end an expression (the standard
// regex-vs-division test), or - cheaper and sufficient - refuse to call a `//`
// a comment when the character before it is `/` or `\`.
// ---------------------------------------------------------------------------
test("F6 the in-comment rule does not go dark on a regex containing //", () => {
  const ts = commentSyntaxFor("typescript");
  const at = cursorInComment("const parts = s.split(/\\/\\//); const n = ", ts);
  assert.equal(at.inComment, false, `provider goes dark on real code: ${JSON.stringify(at)}`);
});

test("F6b the comment cut does not fire inside a regex literal", () => {
  const ts = commentSyntaxFor("typescript");
  assert.equal(
    cutIntroducedComment('url.replace(/\\/\\//g, "/");', ts).cut,
    "none",
    "comment cut fired on a regex literal",
  );
});

test("F6c and the whole ghost survives the pipeline", async () => {
  const { run, logs } = drive(['url.replace(/\\/\\//g, "/");\n'], {
    prefix: "function f() {\n  ",
    languageId: "typescript",
  });
  const r = await run();
  assert.equal(r && r.text, 'url.replace(/\\/\\//g, "/");', `refused/mangled. logs:\n${logs.join("\n")}`);
});

// ---------------------------------------------------------------------------
// F7. The floor and the comment cut are not applied to a cache hit, and the
//     prefix walk serves a remainder no filter ever measured.
//
// The cache-hit branch argues only the BOUND ("re-clamping it per keystroke
// would break typing-through"). The floor, which exists because "a
// three-character ghost costs a full human review", is silently included in
// that argument and never mentioned. A walked hit serves a one-character ghost.
//
// Lowest severity of the set, and it may well be the right behaviour - but the
// reasoning at the branch does not cover it, and phase 6's cost number for the
// floor is measured on generations only, so a session's real floor rate is
// unknown.
//
// Smallest fix: one sentence at the cache-hit branch saying the floor and the
// comment cut are deliberately skipped for a walked remainder, and why.
// ---------------------------------------------------------------------------
test("F7 the length floor applies to a walked cache hit", async () => {
  const { svc } = drive(["let total = sum(a, b);\n"], {});
  const base = "fn f() {\n    ";
  const first = await svc.complete({ prefix: base, suffix: "\n}", languageId: "rust", uri: "u" });
  const ghost = first.text;
  const svc2 = new CompletionService(
    { ...CFG, cacheCapacity: 10 },
    async () => ({ text: "let total = sum(a, b);\n", ttftMs: 1, totalMs: 2 }),
    () => undefined,
  );
  await svc2.complete({ prefix: base, suffix: "\n}", languageId: "rust", uri: "u" });
  const walked = await svc2.complete({
    prefix: base + ghost.slice(0, ghost.length - 1),
    suffix: "\n}",
    languageId: "rust",
    uri: "u",
  });
  assert.ok(
    walked === undefined || !belowGhostFloor(walked.text, 8, 2),
    `walked hit served ${JSON.stringify(walked && walked.text)}, which is under the floor`,
  );
});
