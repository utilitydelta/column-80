// White-box: the Criticize gesture PROPOSES (session-v62 phase 3).
//
// Phase 3 is the wiring phase: the card still renders exactly as it did, and
// then the planner's text goes to `ProposalPresenter.present()` so the human can
// Accept or Reject. The gesture itself needs a host, so every decision it makes
// on the way there lives in `src/core/criticizeGesture.ts` where a headless row
// can reach it, the way session-v61 pushed the refusals down.
//
// The four things this file has to prove, named in the phase contract:
//
//  - THE REGION IS THE HEAD TO THE END OF THE FUNCTION, not the writable span.
//    Python's Fork A moves `span.start` past a leading docstring, and the
//    head-line dimensions (`param-count`, `adjacent-params`, `undocumented`)
//    would then fall outside the replaced region and land nowhere.
//  - NOTHING TO PROPOSE IS NOT AN EMPTY DIFF. planted 0 and stripped 0 is no
//    preview at all; planted 0 with stripped > 0 is a real proposal, because
//    the criticism was addressed and the stale comments should come out.
//  - THE OUTCOME SINK IS NOT FN-GEN'S. `[fngen] outcome=accept` for a gesture
//    that generated nothing is wrong twice over: it misnames the gesture, and
//    fn-gen's accept/reject evidence is MEASURED, so a second gesture's
//    verdicts landing on those tokens corrupt the number. Oracles match
//    `outcome=` whole.
//  - A SECOND PRESS REPLACES, IT DOES NOT STACK. The region reaches back over
//    the comments the last accept planted above the declaration head, or the
//    strip pass never sees them and every head-line criticism doubles.
//
// Run: node --test test/impl-v62-p3-gesture.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v62-p3-gesture",
  `export * from "../src/core/criticizeGesture";
export { planInjection } from "../src/core/criticizePlan";
export { scoreFunction, DEFAULT_ELEVATION } from "../src/core/criticizeScore";
export { sliceFunction } from "../src/core/criticizeSlice";
export { criticizeLangFor } from "../src/core/criticizeLang";
export { C80_TAG } from "../src/core/criticizeVoice";
export { FnGenService } from "../src/core/fnGenService";\n`,
);
test.after(cleanup);

const {
  injectionRegion,
  hasProposal,
  proposalTitle,
  proposalOfferedLine,
  injectingDimensions,
  critiqueOutcomeLines,
  NO_PROPOSAL_LINE,
  CRITIQUE_PREFIX,
  planInjection,
  scoreFunction,
  DEFAULT_ELEVATION,
  sliceFunction,
  criticizeLangFor,
  C80_TAG,
  FnGenService,
} = mod;

const RUST = criticizeLangFor("rust");

const SRC = (lines) => lines.join("\n");
/** The 0-based offset of the first character of 1-based line `n`. */
const lineStart = (text, n) => {
  let at = 0;
  for (let i = 1; i < n; i++) {
    at = text.indexOf("\n", at) + 1;
  }
  return at;
};

// A METHOD, not a free function, and that is the point of the fixture: the
// declaration head is indented, so a region that began at `headOffset` itself
// would hand the planner a first line with no indent on it and the head-line
// criticism would land at column 0 inside an impl block.
const RUST_LINES = [
  "use std::time::Instant;",
  "",
  "impl Parser {",
  "    /// Parses a header.",
  "    ///",
  "    /// The caller must ensure `raw` is non-empty.",
  "    #[inline]",
  "    pub fn parse_header(&self, raw: &str, flag: bool) -> Header {",
  "        let started = Instant::now();",
  "        Header::from(raw, started, flag)",
  "    }",
  "}",
];
const RUST_TEXT = SRC(RUST_LINES);
const HEAD_LINE = 8;
const END_LINE = 11;
// What the symbol provider hands over: the head is the `pub`, not the indent
// before it, and the span ends at the closing brace.
const HEAD_OFFSET = RUST_TEXT.indexOf("pub fn parse_header");
const SPAN_END = lineStart(RUST_TEXT, END_LINE) + RUST_LINES[END_LINE - 1].length;

function cardFor(lines, headLine, endLine, name = "parse_header") {
  const unit = sliceFunction(lines, headLine, endLine, name, RUST);
  assert.ok(unit !== undefined, "the fixture must slice");
  return scoreFunction(unit, RUST, DEFAULT_ELEVATION);
}

// ---------------------------------------------------------------------------
// 1. The region handed to the presenter
// ---------------------------------------------------------------------------

test("the region runs from the head's own line to the end of the function", () => {
  const region = injectionRegion(RUST_TEXT, HEAD_OFFSET, SPAN_END, "rust");
  assert.equal(region.startLine, HEAD_LINE);
  assert.equal(region.lines[0], RUST_LINES[HEAD_LINE - 1]);
  assert.equal(region.lines[region.lines.length - 1], RUST_LINES[END_LINE - 1]);
  assert.equal(region.end, SPAN_END);
  // The bytes it replaces are the bytes it was built from, or the splice
  // rewrites something nobody looked at.
  assert.equal(RUST_TEXT.slice(region.start, region.end), region.lines.join("\n"));
});

test("the region starts at the head LINE, so an indented method keeps its column", () => {
  const region = injectionRegion(RUST_TEXT, HEAD_OFFSET, SPAN_END, "rust");
  assert.ok(region.start < HEAD_OFFSET, "the four spaces before `pub` belong to the region");
  assert.equal(RUST_TEXT.slice(region.start, HEAD_OFFSET), "    ");
  assert.ok(region.lines[0].startsWith("    pub fn"), region.lines[0]);
});

test("the walk back to the line start crosses whitespace and nothing else", () => {
  // A head with code in front of it on the same line: the region starts AT the
  // head rather than eating the statement beside it.
  const text = "let a = 1; fn f() {\n}";
  const at = text.indexOf("fn f()");
  const region = injectionRegion(text, at, text.length, "rust");
  assert.equal(region.start, at, "a non-whitespace neighbour stops the walk");
  assert.equal(region.startLine, 1);
});

test("the region's first line is the DECLARATION, which is why it is not span.start", () => {
  // Python's Fork A: `span.start` sits below the docstring, so a region built
  // from it has no `def` in it and the head-line dimensions have nowhere to go.
  const py = SRC([
    "def span_probe(first: int, second: int) -> int:",
    '    """Probe."""',
    "    started = time.time()",
    "    return first + second + int(started)",
  ]);
  const head = py.indexOf("def span_probe");
  const forkA = py.indexOf("    started = time.time()");
  const fromHead = injectionRegion(py, head, py.length, "python");
  const fromSpan = injectionRegion(py, forkA, py.length, "python");
  assert.ok(fromHead.lines[0].startsWith("def span_probe"), fromHead.lines[0]);
  assert.equal(fromHead.startLine, 1);
  assert.ok(
    !fromSpan.lines.some((l) => l.includes("def span_probe")),
    "this is the defect the head offset exists to prevent: no declaration in the region",
  );
  assert.equal(fromSpan.startLine, 3);
});

test("the region carries no carriage returns and reports lines the planner can count", () => {
  const crlf = RUST_LINES.join("\r\n");
  const head = crlf.indexOf("pub fn parse_header");
  const end = crlf.length - "\r\n}".length;
  const region = injectionRegion(crlf, head, end, "rust");
  for (const line of region.lines) {
    assert.ok(!line.includes("\r"), JSON.stringify(line));
  }
  assert.equal(region.startLine, HEAD_LINE, "a CRLF document numbers its lines the same way");
});

test("nonsense offsets produce a region rather than a throw", () => {
  for (const [from, to] of [
    [-5, 10],
    [10, 5],
    [0, 10_000],
    [Number.NaN, 3],
    [3, Number.NaN],
  ]) {
    const region = injectionRegion(RUST_TEXT, from, to, "rust");
    assert.ok(region.start >= 0 && region.end >= region.start, `${from}..${to}`);
    assert.ok(Array.isArray(region.lines));
    assert.ok(region.startLine >= 1);
  }
  assert.deepEqual(injectionRegion("", 0, 0, "rust").lines, [""]);
});

// ---------------------------------------------------------------------------
// 2. A second press replaces rather than stacks
//
// The comments for a head-line dimension land ABOVE the declaration head, which
// is where the NEXT press's `headOffset` no longer reaches. Without the reach
// back over them the strip pass never sees them and every head-line criticism
// doubles on every press.
// ---------------------------------------------------------------------------

test("the region reaches back over the C80 comments the last accept planted above the head", () => {
  const planted = [
    "use std::time::Instant;",
    "",
    "impl Parser {",
    "    /// Parses a header.",
    "    #[inline]",
    "    // C80 bool-param: a flag branching on a decision made somewhere else.",
    "    //     A bare true tells the next reader nothing. Split it in two.",
    "    pub fn parse_header(&self, raw: &str, flag: bool) -> Header {",
    "        let started = Instant::now();",
    "    }",
    "}",
  ];
  const text = SRC(planted);
  const head = text.indexOf("pub fn parse_header");
  const end = lineStart(text, 10) + planted[9].length;
  const region = injectionRegion(text, head, end, "rust");
  assert.equal(region.startLine, 6, "the region opens at the head of the planted comment");
  assert.ok(region.lines[0].includes("C80 bool-param"), region.lines[0]);
  assert.ok(region.lines[1].includes("A bare true"), "its continuation line comes too");
  // And it stops at the product's own text: the attribute and the doc above it
  // are the human's, and a diff that replaced them would be proposing to
  // rewrite something nobody criticised.
  assert.ok(!region.lines.some((l) => l.includes("#[inline]")), "the attribute is not ours");
  assert.ok(!region.lines.some((l) => l.includes("/// Parses")), "the doc is not ours");
});

test("a hand-written comment above the head is not swallowed by the reach-back", () => {
  const lines = [
    "impl Parser {",
    "    // FIXME: this is mine",
    "    pub fn parse_header(&self) -> Header {",
    "    }",
    "}",
  ];
  const text = SRC(lines);
  const head = text.indexOf("pub fn parse_header");
  const region = injectionRegion(text, head, lineStart(text, 4) + lines[3].length, "rust");
  assert.equal(region.startLine, 3, "only this product's own marker is reached back over");
  assert.ok(region.lines[0].includes("pub fn"), region.lines[0]);
});

test("press, accept, press again: the region reaches the planted comments, so nothing stacks", () => {
  const card = cardFor(RUST_LINES, HEAD_LINE, END_LINE);
  const first = injectionRegion(RUST_TEXT, HEAD_OFFSET, SPAN_END, "rust");
  const planA = planInjection(first.lines, first.startLine, card, DEFAULT_ELEVATION);
  assert.ok(planA.planted > 0, "the fixture must produce criticism");
  assert.equal(planA.stripped, 0, "nothing was planted here before");

  // The accept: the region's bytes become the plan's text.
  const after = RUST_TEXT.slice(0, first.start) + planA.text + RUST_TEXT.slice(first.end);
  const afterLines = after.split("\n");
  const headAt = after.indexOf("pub fn parse_header");
  const newHeadLine = after.slice(0, headAt).split("\n").length;
  const newEndLine = newHeadLine + (END_LINE - HEAD_LINE) + countBodyComments(planA.text);
  const second = injectionRegion(
    after,
    headAt,
    lineStart(after, newEndLine) + afterLines[newEndLine - 1].length,
    "rust",
  );
  // The card is the SAME card, and this row claims no more than that: it is
  // about the REGION reaching the planted comments. What re-scoring an
  // already-criticised function produces is a different question and it has a
  // different answer - the planted block shifts every finding below it and
  // blinds the doc harvester above it, which is scrap S62-7, proven and open.
  const planB = planInjection(second.lines, second.startLine, card, DEFAULT_ELEVATION);
  assert.equal(planB.stripped, planA.planted, "the second press takes back exactly what the first planted");
  assert.equal(planB.planted, planA.planted, "and plants the same number, never twice as many");
  const twice = after.slice(0, second.start) + planB.text + after.slice(second.end);
  assert.equal(twice, after, "a second accept is a byte-for-byte no-op");
});

/** How many of a plan's comment lines sit below the declaration head. The head
 *  line's own comments move the head down; the body's move the closing brace. */
function countBodyComments(text) {
  const lines = text.split("\n");
  const head = lines.findIndex((l) => l.includes("pub fn parse_header"));
  return lines.slice(head).filter((l) => l.trim().startsWith(`// ${C80_TAG}`.trim())).length;
}

// ---------------------------------------------------------------------------
// 3. Nothing to propose, and the one shape that looks like nothing but is not
// ---------------------------------------------------------------------------

test("planted 0 and stripped 0 is no proposal at all", () => {
  assert.equal(hasProposal({ planted: 0, stripped: 0 }), false);
  assert.equal(hasProposal({ planted: 0, stripped: 0, text: "" }), false);
});

test("planted 0 with stale comments to strip IS a proposal", () => {
  assert.equal(
    hasProposal({ planted: 0, stripped: 2 }),
    true,
    "the criticism was addressed and the comments should come out; collapsing this loses a real proposal",
  );
  assert.equal(hasProposal({ planted: 3, stripped: 0 }), true);
  assert.equal(hasProposal({ planted: 1, stripped: 1 }), true);
});

test("a malformed plan is not a proposal", () => {
  for (const plan of [undefined, null, {}, { planted: "3", stripped: "0" }, { planted: -1, stripped: -1 }]) {
    assert.equal(hasProposal(plan), false, JSON.stringify(plan));
  }
});

test("a function with nothing above the bar proposes nothing", () => {
  const clean = [
    "impl Parser {",
    "    /// Adds two bounds together.",
    "    pub fn add(&self, first: i32, second: i64) -> i32 {",
    "        first + second as i32",
    "    }",
    "}",
  ];
  const card = cardFor(clean, 3, 5, "add");
  const text = SRC(clean);
  const region = injectionRegion(text, text.indexOf("pub fn add"), lineStart(text, 5) + clean[4].length, "rust");
  const plan = planInjection(region.lines, region.startLine, card, DEFAULT_ELEVATION);
  if (plan.planted === 0 && plan.stripped === 0) {
    assert.equal(hasProposal(plan), false, "no diff and no empty preview");
  } else {
    assert.ok(hasProposal(plan), "this fixture does flag something, which is a fact about the rubric");
  }
});

// ---------------------------------------------------------------------------
// 4. The title, which sits beside two others in a tab strip
// ---------------------------------------------------------------------------

test("the diff tab is named for the rubric and not for a generated body", () => {
  assert.equal(proposalTitle("parse_header"), "parse_header: rubric (preview)");
  assert.notEqual(proposalTitle("f"), "f: generated body (preview)");
  assert.equal(proposalTitle("f").split("\n").length, 1);
  assert.ok(proposalTitle("f").includes("(preview)"), "the human must know nothing has landed yet");
});

// ---------------------------------------------------------------------------
// 5. The outcome sink, and the trap in it
// ---------------------------------------------------------------------------

test("every outcome line is [critique] prefixed and never [fngen]", () => {
  const all = [
    ...critiqueOutcomeLines("accept"),
    ...critiqueOutcomeLines("reject"),
    ...critiqueOutcomeLines("discarded"),
    ...critiqueOutcomeLines("reject", { refusedBy: "preview-tab-closed", offered: "// C80 clock: ..." }),
    ...critiqueOutcomeLines("discarded", { discardedBecause: "the preview could not be opened" }),
  ];
  assert.ok(all.length > 0);
  for (const line of all) {
    assert.ok(line.startsWith(`${CRITIQUE_PREFIX} `), line);
    assert.ok(!line.includes("[fngen]"), `fn-gen's accept/reject evidence is measured: ${line}`);
    assert.equal(line.split("\n").length, 1, line);
  }
});

test("the outcome token stands alone on its line, because readers match it whole", () => {
  assert.deepEqual(critiqueOutcomeLines("accept"), ["[critique] outcome=accept"]);
  assert.deepEqual(critiqueOutcomeLines("discarded"), ["[critique] outcome=discarded"]);
  // A reject says who refused, the way fn-gen's does: a bare outcome=reject
  // leaves "the human said no" and "the tab was closed" unknowable.
  const [reject] = critiqueOutcomeLines("reject", {
    refusedBy: "human-gesture",
    offered: "    // C80 clock: hidden wall-clock read.",
  });
  assert.ok(reject.startsWith("[critique] outcome=reject"), reject);
  assert.ok(reject.includes("refused-by=human-gesture"), reject);
  assert.ok(
    !reject.includes("C80 clock"),
    "the offered text is the card the human already has; the channel does not need it twice",
  );
});

test("a discard reason gets its own line so the outcome token survives", () => {
  const lines = critiqueOutcomeLines("discarded", {
    discardedBecause: "Error: the diff editor is gone\n  at open (x.ts:1:1)",
  });
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("[critique] discarded: "), lines[0]);
  assert.ok(lines[0].includes("the diff editor is gone"), lines[0]);
  assert.equal(lines[0].split("\n").length, 1, "a stack in a channel renders as a wall of rows");
  assert.equal(lines[1], "[critique] outcome=discarded");
});

test("fn-gen's own outcome bytes are untouched by the narrowing", () => {
  // The narrowing is a TYPE change: `ProposalRequest.service` asks for
  // `logOutcome` alone rather than for the whole service. If one byte of what
  // FnGenService writes had moved with it, every fn-gen accept/reject oracle
  // and every measured capture would be reading a different string.
  const lines = [];
  const svc = new FnGenService({ apiBase: "http://127.0.0.1:1", model: "m" }, undefined, (l) => lines.push(l));
  svc.logOutcome("accept");
  svc.logOutcome("reject", { refusedBy: "human-gesture", offered: "fn f() {}" });
  svc.logOutcome("discarded", { discardedBecause: "the preview could not be opened" });
  assert.equal(lines[0], "[fngen] outcome=accept");
  assert.ok(lines[1].startsWith("[fngen] outcome=reject refused-by=human-gesture offered="), lines[1]);
  assert.equal(lines[2], "[fngen] discarded: the preview could not be opened");
  assert.equal(lines[3], "[fngen] outcome=discarded");
  svc.dispose();
});

test("the narrowed sink is what FnGenService already is", () => {
  // Structural, not nominal: the whole point of the narrowing is that fn-gen
  // hands over the same object it always did and nothing at its call sites
  // changed.
  const svc = new FnGenService({ apiBase: "http://127.0.0.1:1", model: "m" }, undefined, () => {});
  assert.equal(typeof svc.logOutcome, "function");
  svc.dispose();
});

// ---------------------------------------------------------------------------
// 6. What the channel says about the proposal
// ---------------------------------------------------------------------------

test("the offered line names the comments, the dimensions and the strip", () => {
  assert.equal(
    proposalOfferedLine({ planted: 4, stripped: 2 }, 3),
    "[critique] proposing 4 comments over 3 dimensions, stripping 2 stale comments",
  );
  assert.equal(
    proposalOfferedLine({ planted: 1, stripped: 0 }, 1),
    "[critique] proposing 1 comment over 1 dimension, stripping 0 stale comments",
  );
  assert.equal(
    proposalOfferedLine({ planted: 0, stripped: 3 }, 0),
    "[critique] proposing 0 comments over 0 dimensions, stripping 3 stale comments",
  );
});

test("the no-proposal line says why there is no diff", () => {
  assert.ok(NO_PROPOSAL_LINE.startsWith(`${CRITIQUE_PREFIX} `), NO_PROPOSAL_LINE);
  assert.equal(NO_PROPOSAL_LINE.split("\n").length, 1);
  assert.ok(NO_PROPOSAL_LINE.length > 30, "a branch with no sentence is a branch nobody can audit");
  assert.ok(!NO_PROPOSAL_LINE.includes("outcome="), "nothing was offered, so nothing was decided");
});

test("the dimension count counts dimensions that plant, not rows that flagged", () => {
  const card = cardFor(RUST_LINES, HEAD_LINE, END_LINE);
  const dims = injectingDimensions(card, DEFAULT_ELEVATION);
  const region = injectionRegion(RUST_TEXT, HEAD_OFFSET, SPAN_END, "rust");
  const plan = planInjection(region.lines, region.startLine, card, DEFAULT_ELEVATION);
  assert.ok(dims >= 1);
  assert.ok(
    dims <= plan.planted,
    `one dimension can plant several comments, never fewer: ${dims} > ${plan.planted}`,
  );
  // A held dimension scores and stays out of the source, so it is not counted.
  const allHeld = injectingDimensions(card, { held: card.rows.map((r) => r.dimension) });
  assert.equal(allHeld, 0);
  assert.equal(injectingDimensions(undefined, DEFAULT_ELEVATION), 0);
});

// ---------------------------------------------------------------------------
// 7. The wiring, pinned at the source
// ---------------------------------------------------------------------------

const readSrc = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

test("criticize reaches the ONE presenter through the wiring record, and constructs none", () => {
  const source = readSrc("vscode", "criticize.ts");
  assert.ok(/presenter\s*:\s*\(\)\s*=>\s*ProposalPresenter/.test(source), "a getter, like the transport");
  assert.ok(/\.present\(/.test(source), "the consent gate is reached");
  assert.ok(!source.includes("new ProposalPresenter"), "a second presenter is a second preview registry");
  const fnGen = readSrc("vscode", "fnGen.ts");
  assert.equal(
    (fnGen.match(/new ProposalPresenter\(/g) ?? []).length,
    1,
    "ONE presenter in the extension, or column80.proposalAccept reaches the wrong registry",
  );
  assert.ok(
    /presenter:\s*\(\)\s*=>\s*presenter/.test(fnGen),
    "and it is handed out through the model-gesture record rather than imported",
  );
});

test("the presenter asks for an outcome SINK, not for the fn-gen service", () => {
  const fnGen = readSrc("vscode", "fnGen.ts");
  assert.ok(
    /service:\s*ProposalOutcomeSink;/.test(fnGen),
    "ProposalRequest.service must be the narrowest thing present() uses",
  );
  const criticize = readSrc("vscode", "criticize.ts");
  assert.ok(
    !/FnGenService/.test(criticize),
    "criticize must not be able to write [fngen] lines: those numbers are measured",
  );
});

test("the gesture slices from the head and proposes to the end of the span", () => {
  const source = readSrc("vscode", "criticize.ts");
  assert.ok(source.includes("resolved.headOffset"), "the declaration head, never span.start");
  assert.ok(source.includes("resolved.span.end"), "and the region runs to the end of the function");
  assert.ok(
    !/span:\s*resolved\.span\b/.test(source),
    "handing over `resolved.span` would put every head-line finding outside the replaced region",
  );
});

test("the module's header no longer claims it writes nothing", () => {
  const source = readSrc("vscode", "criticize.ts");
  const header = source.slice(0, source.indexOf("import "));
  assert.ok(!/WRITES NOTHING/i.test(header), "that became a lie the moment this phase landed");
  assert.ok(
    /consent gate|present\(\)|proposal/i.test(header),
    "the header must say where the write goes instead",
  );
});
