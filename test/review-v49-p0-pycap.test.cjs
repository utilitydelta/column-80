// ADVERSARIAL REVIEW - session-v49 phase 0, the headless Python hover backfill.
//
// Phase 0 gave `PyLspExtractor.membersOfType` the shared hover backfill so the
// headless transport stops rendering an empty surface. The shared helper carries
// the product's caps: HOVER_SIGNATURE_CAP members asked, HOVER_FANOUT_BUDGET_MS
// to answer, and a member left without a signature is DROPPED by the renderer.
//
// WHAT THIS FILE FOUND, and it was found on the phase-0 baseline's own artifact:
// `session-v49/baseline-py.txt` records the gate answering
// `membersOfType(GraphEngine) -> 38 members` and, four lines later, the timed
// row for the same type reading `members=31`. Seven members left the surface and
// nothing anywhere said so. Every count downstream was a silent lower bound.
//
// ---------------------------------------------------------------------------
// RE-CUT 2026-08-10, BY THE REVIEWER WHO WROTE THE ORIGINAL ROW.
//
// WHAT THE MIDDLE ROW USED TO ASSERT: `signed.length === 38` - that the cap must
// not bind at all, and that losing 7 of 38 members is itself the defect.
//
// WHY IT CHANGED. That was an over-assertion and I had no evidence behind it. It
// is a TUNING claim (raise HOVER_SIGNATURE_CAP above 32) dressed as a
// correctness one, and raising that cap is a latency decision against
// INJECTION_DEADLINE_MS that belongs to a measurement, not to a review row. The
// defect I actually produced evidence for was that the loss was INVISIBLE, and
// the disclosure that has since landed is its fix.
//
// It would also have been inconsistent. Every other cap in this system is
// allowed to bind provided it says so: the walk names the types it dropped, the
// total-type cap and the token budget both truncate and both report. goal.md
// sets that same bar for this one, in words: "Either the cap reports what it
// dropped, on the channel, the way the walk already reports its own drops, or
// Python does not ship." That is disclosure, not absence of loss. Demanding zero
// loss from this one cap alone would be a standard nothing else in the product
// is held to.
//
// So the row now binds the DISCLOSURE, and binds it harder than "a marker
// exists": the named set must BE the lost set, in both directions, with a cause
// on every member. A build that marks everything, marks nothing, or marks a set
// that does not match what actually went missing turns it red.
//
// TWO RESIDUES, recorded rather than asserted, because neither breaks the
// promise above and neither has a measurement behind it yet:
//
//   1. The count cap binds at 32 on GraphEngine, the largest class in the
//      largest real Python on this box. A cap chosen so that it would not bind
//      (see HOVER_SIGNATURE_CAP's own comment, "raising it to 32 unbinds the
//      surface") does bind on the real corpus. That is worth a measured decision
//      when the Python leg is graded; it is not a defect, and it is disclosed.
//   2. A member whose hover ANSWERED inside the budget but whose reply the
//      builder refused (unparseable, or naming another symbol) is attributed
//      `budget`, because the mark reads "was it asked" rather than "did it
//      answer". Measured here: 5 members, a hover returning "this hover names
//      nobody" instantly, all 5 marked `budget` with the clock never involved.
//      The member is still disclosed, so nothing vanishes silently; the line
//      just points the reader at the wrong dial. A label nit, not a hole.
// ---------------------------------------------------------------------------
//
// Run: SKIP_LIVE=1 CI=1 node --test test/review-v49-p0-pycap.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, ".review-v49-pycap.entry.ts");
const OUT = path.join(__dirname, ".review-v49-pycap.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { membersWithHoverSignatures, HOVER_SIGNATURE_CAP, HOVER_FANOUT_BUDGET_MS } from "../src/core/extraction";\n` +
    `export { pyLspSymbolRole, toPySymbolMember } from "../src/core/pyExtraction";\n`,
);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node" });
const M = require(OUT);
test.after(() => [ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

const URI = "file:///repo/graph_engine.py";
const CLASS_LINE = 17;
const show = (v) => JSON.stringify(v);

// One pyright-shaped Function child. `detail` is empty, which is what pyright
// actually returns for every member; `positioned` false is a node the helper
// cannot ask a hover about at all, which is the member that must NOT be marked.
function child(i, positioned = true) {
  const line = CLASS_LINE + 1 + i;
  const node = { name: `method_${String(i).padStart(2, "0")}`, kind: 12, detail: "" };
  if (positioned) {
    node.range = { start: { line, character: 4 }, end: { line, character: 40 } };
    node.selectionRange = { start: { line, character: 8 }, end: { line, character: 20 } };
  }
  return node;
}

function classOf(children) {
  return [
    {
      name: "GraphEngine",
      kind: 5,
      detail: "",
      range: { start: { line: CLASS_LINE, character: 0 }, end: { line: CLASS_LINE + children.length + 1, character: 0 } },
      selectionRange: { start: { line: CLASS_LINE, character: 6 }, end: { line: CLASS_LINE, character: 17 } },
      children,
    },
  ];
}

const classWith = (n) => classOf(Array.from({ length: n }, (_, i) => child(i)));
const cursor = { uri: URI, line: CLASS_LINE, character: 6 };

// An instant, well-formed hover, so nothing below can be blamed on the clock:
// what binds in the count-cap rows is the COUNT alone.
const instantHover = async (at) => {
  const i = at.line - (CLASS_LINE + 1);
  return `(method) def method_${String(i).padStart(2, "0")}(self, a: int) -> None`;
};
// A hover that never answers, so the fan-out budget is the only thing that can
// end the ask.
const silentHover = () => new Promise(() => {});

const backfill = (symbols, hover) =>
  M.membersWithHoverSignatures(symbols, cursor, M.pyLspSymbolRole, M.toPySymbolMember, hover);

const bareOf = (out) => out.filter((m) => !m.signature).map((m) => m.name).sort();
const markedOf = (out) => out.filter((m) => m.capped !== undefined).map((m) => m.name).sort();

// ---------------------------------------------------------------------------

test("CONTROL: below the cap, every member comes back signed and nothing is marked", async () => {
  const out = await backfill(classWith(5), instantHover);
  assert.equal(out.length, 5);
  assert.deepEqual(bareOf(out), [], `every member must be signed below the cap; got ${show(out.map((m) => m.signature))}`);
  assert.deepEqual(markedOf(out), [], "and a call that lost nothing must mark nothing, or the mark means nothing");
});

test("at 38 members - the baseline's own GraphEngine - every member the caps cost is NAMED, with a cause", async () => {
  const N = 38;
  const out = await backfill(classWith(N), instantHover);
  assert.equal(out.length, N, `the member SET is complete: ${out.length} of ${N}`);

  const bare = bareOf(out);
  const marked = markedOf(out);

  // ANTI-VACUITY. The cap must actually bind at 38, or the equality below is a
  // claim about two empty sets and this row proves nothing.
  assert.ok(
    bare.length > 0,
    `CONTROL - the cap must bind at ${N} for this row to have a subject. Cap=${M.HOVER_SIGNATURE_CAP}, ` +
      `budget=${M.HOVER_FANOUT_BUDGET_MS}ms`,
  );

  // THE PROMISE, in both directions. `renderMemberSignatures` drops a bare
  // member, so the bare set IS the set that leaves the block. Marking a subset
  // of it lets a member vanish silently, which is the defect; marking a superset
  // tells the developer a member is missing when it is not.
  assert.deepEqual(
    marked,
    bare,
    `every member absent from the block must be named on the way out, and only those. ` +
      `${bare.length} of ${N} came back bare and ${marked.length} were marked.\n` +
      `  bare but UNMARKED (these vanish silently): ${show(bare.filter((n) => !marked.includes(n)))}\n` +
      `  marked but NOT bare (these are reported lost and are not): ${show(marked.filter((n) => !bare.includes(n)))}`,
  );

  // A cause on every one of them, from the closed vocabulary. "N members went
  // missing" without a cause points at no dial.
  for (const m of out.filter((x) => x.capped !== undefined)) {
    assert.ok(
      m.capped === "count" || m.capped === "budget",
      `${show(m.name)} is marked ${show(m.capped)}, which is not one of ["count","budget"]. The cause names ` +
        `which dial to reach for, so an unrecognised one is the same as none`,
    );
  }
});

test("the cause discriminates: the count cap and the fan-out budget are told apart, and neither is hardcoded", async () => {
  // Two calls that differ ONLY in what runs out. A build that stamps one
  // constant cause on everything passes neither half.
  const byCount = await backfill(classWith(38), instantHover);
  const causesFromCount = [...new Set(byCount.filter((m) => m.capped).map((m) => m.capped))];
  assert.deepEqual(
    causesFromCount,
    ["count"],
    `38 members against an INSTANT hover: the clock cannot have run out, so every loss is the per-type ask ` +
      `limit spending its slots elsewhere. Got ${show(causesFromCount)}`,
  );

  const byBudget = await backfill(classWith(5), silentHover);
  const causesFromBudget = [...new Set(byBudget.filter((m) => m.capped).map((m) => m.capped))];
  assert.deepEqual(
    causesFromBudget,
    ["budget"],
    `5 members - well under the cap - against a hover that never answers: the only thing that can end this ` +
      `is the fan-out budget. Got ${show(causesFromBudget)}`,
  );
  assert.equal(
    bareOf(byBudget).length,
    5,
    "CONTROL - the silent hover must actually have starved every member, or the row above measured nothing",
  );
});

test("a member that simply has no signature to give is NOT marked - the mark means a cap, not a bare name", async () => {
  // Three askable members and one node the helper cannot position, so it is
  // never eligible for a hover at all. It ends bare for a reason that is not a
  // cap, and reporting it would send a reader to a dial that did not fire.
  const out = await backfill(classOf([child(0), child(1), child(2), child(3, false)]), instantHover);
  assert.equal(out.length, 4);
  const unpositioned = out.find((m) => m.name === "method_03");
  assert.ok(unpositioned, `CONTROL - the unpositioned member must survive into the set; got ${show(out.map((m) => m.name))}`);
  assert.equal(unpositioned.signature, undefined, "CONTROL - and it must genuinely be bare, or this row has no subject");
  assert.equal(
    unpositioned.capped,
    undefined,
    `${show("method_03")} was never eligible for a hover, so no cap cost it anything. Marking it would make ` +
      `the channel line over-report and would make the mark mean "bare" rather than "the caps took this"`,
  );
  assert.deepEqual(
    markedOf(out),
    [],
    `and with three askable members against an instant hover, nothing at all should be marked; got ${show(markedOf(out))}`,
  );
});
