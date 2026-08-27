// Adversarial review of session-v61 phases 2 through 5: the rubric detectors,
// the scorecard, the explainer's one-way door and the gesture.
//
// Every test here is a DEFECT CLAIM with the evidence attached. They are
// expected to FAIL against the phase-5 build. They are not regressions and they
// are not a request to loosen an assertion: each states what a contract or the
// module's own header says the behaviour is, and shows the input where the
// shipped behaviour differs.
//
// The grading result these sit under (session-v61/harness/grade.cjs, 138 rows,
// the production C# corpus supplied):
//
//   eleven dimensions       precision 100.0%
//   pass-through            precision  80.0%   tp 4  fp 1  fn 8
//   cqs                     precision  66.7%   tp 2  fp 1  fn 5
//   nesting                 precision  66.7%   tp 4  fp 2  fn 0
//   unenforced-precondition precision  33.3%   tp 1  fp 2  fn 3
//
// Four of the five FALSE POSITIVES behind those numbers are reproduced below on
// synthetic input, so the diagnosis does not depend on a corpus path. The
// remaining two tests are about the one-way door and about a doc number.
//
// Run: node --test test/adversarial-v61-p2.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v61-p2",
  `export { criticizeLangFor } from "../src/core/criticizeLang";
export { sliceFunction } from "../src/core/criticizeSlice";
export { scoreFunction, DEFAULT_ELEVATION } from "../src/core/criticizeScore";
export { renderScorecard } from "../src/core/criticizeRender";
export { explainFinding } from "../src/core/criticizeExplain";\n`,
);
const {
  criticizeLangFor,
  sliceFunction,
  scoreFunction,
  DEFAULT_ELEVATION,
  renderScorecard,
  explainFinding,
} = mod;
test.after(cleanup);

const REPO = path.join(__dirname, "..");

/** The card for a whole source string, scored through the SAME slicer the
 *  gesture and the grading harness call. A harness that builds its own unit
 *  measures its own slicer. */
function cardFor(languageId, source, name) {
  const lines = source.split("\n");
  const lang = criticizeLangFor(languageId);
  const unit = sliceFunction(lines, 1, lines.length, name, lang);
  assert.notStrictEqual(unit, undefined, "the slicer refused this fixture, so nothing below was examined");
  return scoreFunction(unit, lang, DEFAULT_ELEVATION);
}

const rowFor = (card, dimension) => card.rows.find((row) => row.dimension === dimension);

// ===========================================================================
// Defect 1. Dimension 11 reads a C# object initializer as a mutation.
//
// The one cqs false positive on the graded set is row cs-007, a public method
// that builds a `new RetroJob() { StartDate = startDate, ... }` and returns a
// DTO. It mutates nothing that outlives the call: every assignment the detector
// saw is an object-initializer clause on a fresh local.
//
// The cause is the third C# mutation pattern in criticizeLang.ts,
// `/^\s*[A-Z]\w*\s*(...)?=[^=]/`, which is written for a static or auto-property
// write and matches every initializer line in the language. Object initializers
// are not rare C#; they are how the language builds a DTO, which is exactly the
// shape a query method has. contracts/phase2-rubric-dimensions.md scopes this
// dimension to "state that outlives the call".
// ===========================================================================
test("cqs: a C# object initializer on a fresh local is not state that outlives the call", () => {
  const card = cardFor(
    "csharp",
    [
      "public Dto Build(int rows)",
      "{",
      "    var job = new RetroJob()",
      "    {",
      "        StartDate = rows,",
      "        RowsProcessed = 0,",
      "    };",
      "    return new Dto() { total = job.StartDate };",
      "}",
    ].join("\n"),
    "Build",
  );
  const outcome = rowFor(card, "cqs").outcome;
  assert.notStrictEqual(
    outcome.state,
    "flagged",
    `nothing here is written that outlives the call; the detector quoted ${JSON.stringify(
      outcome.state === "flagged" ? outcome.findings[0].evidence : "",
    )}, which is an initializer clause on a local`,
  );
});

// ===========================================================================
// Defect 2. Dimension 13 counts Python CONTINUATION indentation as block depth.
//
// Both nesting false positives on the graded set are Python (py-010 truth 1
// measured 4, py-025 truth 3 measured 6), and both flag a line inside a
// multi-line literal. `indentDepth` pushes a level for any line further in than
// the line above it, and a wrapped call argument is further in than the line
// above it without opening a block.
//
// The four brace languages do not have this bug: `braceDepth` requires a line
// to END with `{`. The Python arm has no equivalent test, and a Python block is
// just as recognisable: the line that opens it ends with `:`.
//
// The fixture below contains no `if`, no `for`, no `with` and no `try`. Its true
// block depth is zero.
// ===========================================================================
test("nesting: a Python body with no block statement at all is not four blocks deep", () => {
  const card = cardFor(
    "python",
    [
      "def f(x):",
      '    """Doc."""',
      "    return run(",
      "        [",
      "            [",
      "                [",
      '                    "a",',
      "                ],",
      "            ],",
      "        ],",
      "    )",
    ].join("\n"),
    "f",
  );
  const outcome = rowFor(card, "nesting").outcome;
  assert.notStrictEqual(
    outcome.state,
    "flagged",
    `the body opens no block; the detector said ${JSON.stringify(
      outcome.state === "flagged" ? outcome.findings[0].detail : "",
    )} and quoted a line inside a list literal`,
  );
});

// ===========================================================================
// Defect 3. Dimension 12 flags a function with NO parameters at all.
//
// The one pass-through false positive on the graded set is rust-026,
// `fn is_follower_reachable(&self) -> bool { self.follower_reachable.get() }`.
// `soleCall` returns zero arguments, `params` is empty, `0 < 0` is false, and
// `[].every(...)` is vacuously true, so a zero-arity accessor is flagged.
//
// contracts/phase2-rubric-dimensions.md: the dimension fires when "the
// interface is as wide as the implementation". A function that takes nothing
// has no width to be as wide as, and the detail line the product ships says so
// out loud: "carrying 0 of the signature's 0 parameters straight through".
// ===========================================================================
test("pass-through: a zero-parameter accessor has no interface width to be as wide as", () => {
  const card = cardFor(
    "rust",
    ["fn is_ready(&self) -> bool {", "    self.ready.get()", "}"].join("\n"),
    "is_ready",
  );
  const outcome = rowFor(card, "pass-through").outcome;
  assert.notStrictEqual(
    outcome.state,
    "flagged",
    `zero parameters and zero arguments; the detector said ${JSON.stringify(
      outcome.state === "flagged" ? outcome.findings[0].detail : "",
    )}`,
  );
});

// ===========================================================================
// Defect 4. Dimension 10 cannot tell an obligation on the CALLER from a
// sentence about what the function itself does.
//
// Both unenforced-precondition false positives on the graded set are this, and
// they are the reason its precision is 33.3%:
//
//   ts-027  "... is not a member NAME and the gate must never present it as
//           one"   -> the subject of "must" is the gate, not the caller, and
//           the one-line body IS the check.
//   cs-028  "... a site that has tiered nothing yet must read hot-only"
//           -> a statement about behaviour, and lines 48-49 are the check.
//
// PRECONDITION_WORDS matches a bare `must` anywhere in the doc region, and
// `hasGuard` looks for a guard SPELLING or an early return. A body that is a
// single `return <predicate>` is a whole function of checking and matches
// neither. The fixture below is ts-027 reduced to its shape.
// ===========================================================================
test("unenforced-precondition: a modal about the function's own behaviour is not a caller obligation", () => {
  const card = cardFor(
    "typescript",
    [
      "/** A bare Go identifier: unicode letter or `_` first, letters/digits/`_`",
      " *  after. Anything else is not a member NAME and the gate must never",
      " *  present it as one. */",
      "export function isPlainGoIdentifier(label: string): boolean {",
      "  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(label);",
      "}",
    ].join("\n"),
    "isPlainGoIdentifier",
  );
  const outcome = rowFor(card, "unenforced-precondition").outcome;
  assert.notStrictEqual(
    outcome.state,
    "flagged",
    "the doc places no obligation on the caller, and the body is itself the check",
  );
});

// ===========================================================================
// Defect 5. The renderer will print model prose UNDER A BLIND ROW'S REFUSAL.
//
// THIS IS THE ONE-WAY DOOR, and the hole is not in criticizeExplain.ts. That
// module's own header says: "A row that is not flagged carries no findings, so
// nothing can key to it. That is why a key aimed at a clean or blind row is
// unreachable, and why A BLIND ROW'S REFUSAL CANNOT BE TALKED OVER."
//
// `renderScorecard` contains a live branch that does exactly that:
//
//   if (row.outcome.state !== "flagged" && row.explanation !== undefined ...) {
//     out.push(`${DETAIL_INDENT}${row.explanation.trim()}`);
//   }
//
// `attachExplanations` will not put prose there, so on today's wiring this is
// unreachable. That makes it worse rather than better: it is not a guard that
// prevents the forbidden thing, it is an ACTION that performs it, sitting in
// the module that is the last gate before the developer's eyes. The rendered
// card below announces "this pass found nothing above the evidence bar" and
// then prints a fabricated second defect under a refusal, indented exactly like
// the refusal's own reason.
//
// The door has to be structural in the renderer too, because the renderer is
// the only place the prose becomes something a developer reads.
// ===========================================================================
test("one-way door: prose on a non-flagged row is never rendered", () => {
  const text = renderScorecard(
    {
      name: "f",
      languageId: "typescript",
      headLine: 1,
      rows: [
        {
          dimension: "unadmitted-failure",
          title: "Can it fail in a way the signature never admits",
          group: "safety",
          source: "Go proverbs, Rust culture",
          elevated: false,
          outcome: { state: "blind", reason: "TypeScript has no checked exceptions" },
          explanation: "There is also an unchecked null dereference on line 9.",
        },
      ],
    },
    { held: [] },
  );
  assert.ok(
    !text.includes("unchecked null dereference"),
    `a blind row's refusal was talked over by model prose:\n${text}`,
  );
});

// ===========================================================================
// Defect 6. `explainFinding` swallows a CANCELLATION, so the gesture's
// cancellation branch is unreachable and a cancel does not stop the explainer.
//
// contracts/phase5-gesture.md: "A cancel emits `[critique] cancelled` and
// leaves nothing behind."
//
// `src/vscode/criticize.ts` implements that as:
//
//   try { const text = await explainFinding(auth, transport); }
//   catch (err) { if (isCancellation(err)) throw err; log(...); }
//
// but `explainFinding` catches EVERYTHING and returns "". So when the in-flight
// registry aborts the controller mid-loop:
//
//   - the rethrow never fires, and `[critique] cancelled` is never emitted;
//   - the loop runs on and calls the transport for every remaining target row;
//   - the card renders as though the user had not cancelled;
//   - and `[critique] explainer skipped: <dimension>: <error>` is a sentence no
//     branch can reach, so a genuine per-row transport failure is also silent.
//
// A cancellation is the user's own action, not a transport that failed to
// speak. The two must not share a spelling, which is this subsystem's own rule
// about a measured zero and an unmeasured one applied to the control path.
// ===========================================================================
test("cancellation: explainFinding does not disguise a cancel as a model that never spoke", async () => {
  const cancelled = new Error("Canceled");
  cancelled.name = "Canceled";
  let calls = 0;
  const transport = async () => {
    calls += 1;
    throw cancelled;
  };
  const auth = {
    finding: { dimension: "cqs", line: 1, evidence: "x = 1;", detail: "d" },
    source: "Meyer 1988",
  };
  let threw;
  try {
    await explainFinding(auth, transport);
  } catch (err) {
    threw = err;
  }
  assert.strictEqual(calls, 1, "the transport should have been called exactly once");
  assert.strictEqual(
    threw,
    cancelled,
    "a cancellation was turned into the empty string, which is the same value a model that never spoke returns",
  );
});

// ===========================================================================
// Defect 7. Three shipped documents carry a `world` precision the harness no
// longer reproduces.
//
// docs/architecture/criticize.md, docs/user-manual.md and CHANGELOG.md all say
// the filesystem detector scores 93.3% precision with 63.6% recall. Running
// session-v61/harness/grade.cjs against the same 138-row set today:
//
//   world  tp 12  fp 0  tn 35  fn 8   precision 100.0%  recall 60.0%
//
// Both halves moved. The numbers were written before the last two fixes landed
// and every number in a doc must be reproducible by running the harness, or a
// reader cannot tell a stale claim from a measured one.
// ===========================================================================
test("docs: no shipped document carries the superseded world precision", () => {
  const stale = [];
  for (const rel of ["docs/architecture/criticize.md", "docs/user-manual.md", "CHANGELOG.md"]) {
    const text = fs.readFileSync(path.join(REPO, rel), "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      if (line.includes("93.3%") || line.includes("63.6%")) {
        stale.push(`${rel}:${i + 1}`);
      }
    }
  }
  assert.deepStrictEqual(
    stale,
    [],
    `the world leg measures 100.0% precision and 60.0% recall today; these lines still say 93.3% / 63.6%: ${stale.join(", ")}`,
  );
});
