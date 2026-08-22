// Blind oracle: doc-comment attachment (the phase 1 attach contract, goal item
// 1). Black-box contract tests for `attachRunStart` and
// `attachedCandidateIndex`, written from the CONTRACT ALONE.
//
// REWRITTEN after the phase-1 predicate was REPLACED. An adversarial review
// proved the first predicate defective, so the contract it was written from is
// gone and so are the rows that only made sense against it:
//   - `maxMisses` no longer exists. It was a correctness knob, not a cost knob:
//     every interior line of a block comment spent a miss, so a doc comment
//     past ~18 lines silently stopped attaching. Every miss-budget row is
//     deleted, and a doc-comment LENGTH sweep replaces them.
//   - the run start is now found by scanning DOWN from the contiguity boundary
//     and taking the FIRST candidate that reaches the name line, not by walking
//     up taking the last confirmation.
//   - the auditor is no longer `declarationHeadLine`. Reading its
//     shrink-forward answer at face value is what confirmed a comment above a
//     `});` as trivia of the declaration below the brace.
//
// Covers:
//   §attachRunStart          the two steps: the blank-line contiguity boundary,
//                            then topmost-candidate-first with a jump past
//                            every line that is provably not trivia
//   §attachRunStart          the three guaranteed properties: line 0 answers 0,
//                            the return sits in [0, nameLine], every line in
//                            [runStart, nameLine-1] is non-blank
//   §attachRunStart          doc-comment length parameterized over
//                            1/3/15/16/17/40 interior lines, cursor on the
//                            first interior line, the middle and the closer
//   §attachedCandidateIndex  eligibility, ascending order, first match wins,
//                            the blank-line ceiling, the empty array, order
//                            independence, no mutation
//   §"Cases the phase-1 tests must cover"  every row of the case table, in the
//                            five languages whose trivia grammar differs
//                            (rust ///+#[attr], TS JSDoc+@decorator,
//                             C# ///+[Attribute], Go //, Python #+@decorator)
//
// Never read src/**. The whole point of this file is independence from the
// implementation. Every expectation below is derived from the contract's two
// steps, its statement of the walk's grammar, and its case table. Nothing was
// derived from the code, and nothing assumes which function does the auditing.
//
// Run: SKIP_LIVE=1 node --test test/blind-v32-p1-attach.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v32-p1-attach",
    `export { attachRunStart, attachedCandidateIndex } from "../src/core/symbols";\n`
  ));
} catch (e) {
  bundleError = e;
}
// A FAILED bundle never returns a cleanup, and it still wrote the entry file.
// Sweep both paths so a red run leaves nothing behind in the tree.
test.after(() => {
  cleanup();
  for (const leftover of [".blind-v32-p1-attach.entry.ts", ".blind-v32-p1-attach.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
});

const { attachRunStart, attachedCandidateIndex } = mod;

test("bundle: symbols.ts exports attachRunStart + attachedCandidateIndex [contract-p1-attach.md 'Two new pure exports from src/core/symbols.ts']", () => {
  if (bundleError) {
    assert.fail(`bundle failed to build: ${bundleError.message}`);
  }
  assert.strictEqual(typeof attachRunStart, "function", "attachRunStart is a plain exported function");
  assert.strictEqual(
    typeof attachedCandidateIndex,
    "function",
    "attachedCandidateIndex is a plain exported function"
  );
});

// Every other test skips (not fails) while the bundle is broken, so a broken
// bundle stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Fixture mechanics. Real code in each language, split on "\n" into the line
// accessor the contract asks for. Lines are found by a UNIQUE substring rather
// than a hardcoded number, so a failure names the line the author meant.
// ---------------------------------------------------------------------------

function fixture(label, source, lineComments) {
  const lines = source.replace(/^\n/, "").split("\n");
  const getLine = (line) => {
    // Contract step 1: "getLine is never called with a negative line."
    assert.ok(line >= 0, `${label}: getLine was called with a negative line (${line}); the contract forbids it`);
    // "a getLine that answers "" past the end rather than throwing".
    return lines[line] === undefined ? "" : lines[line];
  };
  const at = (needle) => {
    const hits = [];
    lines.forEach((text, i) => {
      if (text.includes(needle)) hits.push(i);
    });
    assert.strictEqual(
      hits.length,
      1,
      `${label}: fixture needle ${JSON.stringify(needle)} must match exactly one line, matched ${hits.length}`
    );
    return hits[0];
  };
  return { label, lines, getLine, at, lineComments };
}

const cand = (nameLine) => ({ nameLine });

// Returns the nameLine of the attached candidate, or -1. Keeps the assertions
// readable while still proving the return is an INDEX into the given array.
function attachedNameLine(fx, candidates, cursorLine) {
  const i = attachedCandidateIndex(candidates, fx.getLine, cursorLine, fx.lineComments);
  assert.strictEqual(typeof i, "number", `${fx.label}: the return is a number`);
  if (i === -1) return -1;
  assert.ok(
    Number.isInteger(i) && i >= 0 && i < candidates.length,
    `${fx.label}: ${i} must be an index into the candidate array of length ${candidates.length}`
  );
  return candidates[i].nameLine;
}

const runStart = (fx, nameLine) => attachRunStart(fx.getLine, nameLine, fx.lineComments);

// ---------------------------------------------------------------------------
// RUST. rust-analyzer already puts the doc comment inside the range, so these
// rows are the ones that must keep working rather than start working. `///`
// runs, a bare `///` line, an `#[inline]` attribute, a detached section marker,
// and a documented fn whose line above is the previous fn's closing brace.
// ---------------------------------------------------------------------------

const RUST = fixture(
  "rust",
  `
use crate::stripe::Stripe;

/// Adds two stripe counts and returns the total.
///
/// Returns zero when both counts are zero.
#[inline]
pub fn stripe_total(a: u32, b: u32) -> u32 {
    a + b
}
/// Doubles a stripe count.
pub fn stripe_double(n: u32) -> u32 {
    n * 2
}

// ---- section marker, deliberately detached ----

pub fn stripe_reset(s: &mut Stripe) {
    s.count = 0;
}
`,
  []
);

const RUST_DOC_TOP = RUST.at("/// Adds two stripe counts");
const RUST_DOC_BARE = RUST_DOC_TOP + 1;
const RUST_DOC_LAST = RUST.at("/// Returns zero when both counts");
const RUST_ATTR = RUST.at("#[inline]");
const RUST_TOTAL = RUST.at("pub fn stripe_total(");
const RUST_TOTAL_CLOSE = RUST.at("pub fn stripe_double(") - 2;
const RUST_DOUBLE_DOC = RUST.at("/// Doubles a stripe count");
const RUST_DOUBLE = RUST.at("pub fn stripe_double(");
const RUST_MARKER = RUST.at("// ---- section marker");
const RUST_RESET = RUST.at("pub fn stripe_reset(");
const RUST_CANDIDATES = [RUST_TOTAL, RUST_DOUBLE, RUST_RESET].map(cand);

// ---------------------------------------------------------------------------
// TYPESCRIPT. The flagship shapes: a JSDoc block with an opener, interior and
// closing line, a multi-line `@memoize({...})` decorator between the doc and
// the head, a class doc comment above a documented method, and two top-level
// functions - one documented straight after a closing brace, one undocumented.
// ---------------------------------------------------------------------------

const TS = fixture(
  "typescript",
  `
import { memoize } from "./memo";

/** A group of stripe helpers. */
export class StripeAuditor {
  /**
   * Audits every band in the stripe.
   * @param bands the band count
   */
  @memoize({
    ttlMs: 500,
  })
  auditBands(bands: number): number {
    return bands * 2;
  }

  reset(): void {
    this.total = 0;
  }
}

/** Adds one to the stripe count. */
export function bump(n: number): number {
  return n + 1;
}
/** Nudges the stripe seed. */
export function nudge(): number {
  return bump(stripeSeed);
}

const bandSeed = 3;
/** Widens the band. */
export function widen(): number {
  return bandSeed;
}

const tailSeed = 5;
export function tail(): number {
  return tailSeed;
}
`,
  []
);

const TS_CLASS_DOC = TS.at("/** A group of stripe helpers. */");
const TS_CLASS = TS.at("export class StripeAuditor");
const TS_JSDOC_INTERIOR = TS.at("@param bands the band count");
const TS_JSDOC_OPENER = TS.at("* Audits every band") - 1;
const TS_JSDOC_CLOSING = TS_JSDOC_INTERIOR + 1;
const TS_DECORATOR_OPEN = TS.at("@memoize({");
const TS_DECORATOR_ARG = TS.at("ttlMs: 500");
const TS_DECORATOR_CLOSE = TS_DECORATOR_ARG + 1;
const TS_AUDIT = TS.at("  auditBands(bands");
const TS_AUDIT_CLOSE = TS.at("  reset(): void") - 2;
const TS_RESET = TS.at("  reset(): void");
const TS_BLANK_IN_CLASS = TS_RESET - 1;
const TS_BUMP_DOC = TS.at("/** Adds one to the stripe count. */");
const TS_BUMP = TS.at("export function bump(");
const TS_BUMP_CLOSE = TS.at("/** Nudges the stripe seed. */") - 1;
const TS_NUDGE_DOC = TS.at("/** Nudges the stripe seed. */");
const TS_NUDGE = TS.at("export function nudge(");
const TS_BAND_SEED = TS.at("const bandSeed = 3;");
const TS_WIDEN_DOC = TS.at("/** Widens the band. */");
const TS_WIDEN = TS.at("export function widen(");
const TS_TAIL_SEED = TS.at("const tailSeed = 5;");
const TS_TAIL = TS.at("export function tail(");
const TS_BLANK_ABOVE_BUMP = TS_BUMP_DOC - 1;
const TS_CANDIDATES = [TS_CLASS, TS_AUDIT, TS_RESET, TS_BUMP, TS_NUDGE, TS_WIDEN, TS_TAIL].map(cand);

// ---------------------------------------------------------------------------
// C#. `///` XML doc, a single-line `[Fact]`, and a `[Theory(...)]` whose
// argument list spans two lines - the continuation line is the row the contract
// calls "a multi-line C# attribute's ARGUMENT line".
// ---------------------------------------------------------------------------

const CS = fixture(
  "csharp",
  `
using Xunit;

namespace Playground;

public class Fns
{
    /// <summary>Adds two stripe counts.</summary>
    /// <returns>The sum of both counts.</returns>
    [Fact]
    public static int Add(int a, int b)
    {
        return a + b;
    }

    /// <summary>Doubles a stripe count.</summary>
    [Theory(
        DisplayName = "doubles a stripe count")]
    public static int Double(int n)
    {
        return n * 2;
    }
}
`,
  []
);

const CS_CLASS = CS.at("public class Fns");
const CS_ADD_DOC_TOP = CS.at("<summary>Adds two stripe counts.");
const CS_ADD_DOC_RETURNS = CS.at("<returns>The sum of both counts.");
const CS_FACT = CS.at("[Fact]");
const CS_ADD = CS.at("public static int Add(");
const CS_DOUBLE_DOC = CS.at("<summary>Doubles a stripe count.");
const CS_THEORY_OPEN = CS.at("[Theory(");
const CS_THEORY_ARG = CS.at("DisplayName = ");
const CS_DOUBLE = CS.at("public static int Double(");
const CS_BLANK_BEFORE_DOUBLE = CS_DOUBLE_DOC - 1;
const CS_CANDIDATES = [CS_CLASS, CS_ADD, CS_DOUBLE].map(cand);

// ---------------------------------------------------------------------------
// GO. Plain `//` doc runs, a detached section marker, and a `var` line sitting
// directly on top of a documented func.
// ---------------------------------------------------------------------------

const GO = fixture(
  "go",
  `
package stripe

// stripeFanout reports the fanout width for the given seed.
// It never returns zero.
func stripeFanout(seed int) int {
	return seed + 1
}

// ---- helpers below ----

func stripeReset(s *Stripe) {
	s.count = 0
}

var stripeBase = 3
// stripeBump adds one to the base.
func stripeBump() int {
	return stripeBase + 1
}
`,
  []
);

const GO_PACKAGE = GO.at("package stripe");
const GO_DOC_TOP = GO.at("// stripeFanout reports the fanout width");
const GO_DOC_LAST = GO.at("// It never returns zero.");
const GO_FANOUT = GO.at("func stripeFanout(");
const GO_MARKER = GO.at("// ---- helpers below ----");
const GO_RESET = GO.at("func stripeReset(");
const GO_BASE_VAR = GO.at("var stripeBase = 3");
const GO_BUMP_DOC = GO.at("// stripeBump adds one to the base.");
const GO_BUMP = GO.at("func stripeBump(");
const GO_CANDIDATES = [GO_FANOUT, GO_RESET, GO_BUMP].map(cand);

// ---------------------------------------------------------------------------
// PYTHON. A `#` run above a `@staticmethod` decorator, a `#` comment above the
// class itself, and an undocumented method after a blank line. Python is the
// one language the contract says passes `["#"]` as lineComments.
// ---------------------------------------------------------------------------

const PY = fixture(
  "python",
  `
from stripe import Stripe

# A small group of stripe helpers.
class Fns:
    # Adds two stripe counts.
    # Returns the sum.
    @staticmethod
    def spike_add(a: int, b: int) -> int:
        return a + b

    def spike_reset(self) -> None:
        self.count = 0
`,
  ["#"]
);

const PY_CLASS_DOC = PY.at("# A small group of stripe helpers.");
const PY_CLASS = PY.at("class Fns:");
const PY_DOC_TOP = PY.at("# Adds two stripe counts.");
const PY_DOC_LAST = PY.at("# Returns the sum.");
const PY_DECORATOR = PY.at("@staticmethod");
const PY_ADD = PY.at("def spike_add(");
const PY_RESET = PY.at("def spike_reset(");
const PY_BLANK_BEFORE_RESET = PY_RESET - 1;
const PY_CANDIDATES = [PY_CLASS, PY_ADD, PY_RESET].map(cand);

// ---------------------------------------------------------------------------
// CLOSER. The shape the replaced predicate got wrong, straight out of the
// corrected contract: "a comment sitting above a `});` was 'confirmed' as
// trivia of the declaration below the brace, and a cursor parked in an object
// literal resolved to the next function."
// ---------------------------------------------------------------------------

const CLOSER = fixture(
  "ts-object-literal",
  `
import { memoize } from "./memo";

const auditCache = memoize({
  // the ttl this cache keeps entries for
  ttlMs: 500,
});
/** Bumps the stripe seed. */
export function bumpSeed(): number {
  return auditCache.ttlMs + 1;
}
`,
  []
);

const CLOSER_LITERAL_OPEN = CLOSER.at("const auditCache = memoize({");
const CLOSER_COMMENT = CLOSER.at("// the ttl this cache keeps");
const CLOSER_ARG = CLOSER.at("ttlMs: 500,");
const CLOSER_BRACE = CLOSER.at("});");
const CLOSER_DOC = CLOSER.at("/** Bumps the stripe seed. */");
const CLOSER_BUMP = CLOSER.at("export function bumpSeed(");
const CLOSER_CANDIDATES = [CLOSER_BUMP].map(cand);

// ---------------------------------------------------------------------------
// CSINIT. A bare bracket-balanced `[...]` line - which the walk's grammar reads
// as an attribute - sitting above a `};`. The contract's case table row: the
// `};` between it and the documented member is a line the walk stops at, so
// nothing at or above it can be trivia for that member.
// ---------------------------------------------------------------------------

const CSINIT = fixture(
  "csharp-collection-init",
  `
namespace Playground;

public class Grids
{
    private static readonly int[][] Grid =
    {
        [1, 2, 3],
    };
    /// <summary>Sums the first row of the grid.</summary>
    public static int SumFirstRow() => Grid[0][0] + Grid[0][1] + Grid[0][2];
}
`,
  []
);

const CSINIT_CLASS = CSINIT.at("public class Grids");
const CSINIT_FIELD = CSINIT.at("int[][] Grid =");
const CSINIT_OPEN_BRACE = CSINIT_FIELD + 1;
const CSINIT_BARE_BRACKET = CSINIT.at("[1, 2, 3],");
const CSINIT_CLOSE_BRACE = CSINIT.at("};");
const CSINIT_DOC = CSINIT.at("<summary>Sums the first row");
const CSINIT_SUM = CSINIT.at("SumFirstRow() =>");
const CSINIT_CANDIDATES = [CSINIT_CLASS, CSINIT_SUM].map(cand);

// ---------------------------------------------------------------------------
// ALLMAN. Two lone-`{` shapes: a class's opening brace directly above a
// documented member, and a method body's opening brace further up the same run.
// The contract: "A lone `{` (Allman C#) and a lone `}` are also lines it stops
// at, so a cursor parked on either does not attach."
// ---------------------------------------------------------------------------

const ALLMAN = fixture(
  "csharp-allman",
  `
namespace Playground;

public class Allman
{
    /// <summary>Returns one.</summary>
    public static int Only() => 1;

    public static int First()
    {
        return 1;
    }
    /// <summary>Returns two.</summary>
    public static int Second() => 2;
}
`,
  []
);

const ALLMAN_CLASS = ALLMAN.at("public class Allman");
const ALLMAN_CLASS_BRACE = ALLMAN_CLASS + 1;
const ALLMAN_ONLY_DOC = ALLMAN.at("<summary>Returns one.");
const ALLMAN_ONLY = ALLMAN.at("int Only() => 1;");
const ALLMAN_FIRST = ALLMAN.at("int First()");
const ALLMAN_FIRST_BRACE = ALLMAN_FIRST + 1;
const ALLMAN_FIRST_CLOSE = ALLMAN.at("return 1;") + 1;
const ALLMAN_SECOND_DOC = ALLMAN.at("<summary>Returns two.");
const ALLMAN_SECOND = ALLMAN.at("int Second() => 2;");
const ALLMAN_CANDIDATES = [ALLMAN_CLASS, ALLMAN_ONLY, ALLMAN_FIRST, ALLMAN_SECOND].map(cand);

// ---------------------------------------------------------------------------
// CEILING. A detached marker, one blank line, then FOUR documented functions.
// The contract's blank-line ceiling: "the first blank line at or below the
// cursor is a hard ceiling on every remaining candidate".
// ---------------------------------------------------------------------------

const CEILING = fixture(
  "ts-blank-ceiling",
  `
// a detached section marker, and nothing below owns it

/** Doc for alpha. */
export function alpha(): number {
  return 1;
}
/** Doc for beta. */
export function beta(): number {
  return 2;
}
/** Doc for gamma. */
export function gamma(): number {
  return 3;
}
/** Doc for delta. */
export function delta(): number {
  return 4;
}
`,
  []
);

const CEILING_MARKER = CEILING.at("// a detached section marker");
const CEILING_BLANK = CEILING_MARKER + 1;
const CEILING_ALPHA_DOC = CEILING.at("/** Doc for alpha. */");
const CEILING_ALPHA = CEILING.at("export function alpha(");
const CEILING_BETA_DOC = CEILING.at("/** Doc for beta. */");
const CEILING_BETA = CEILING.at("export function beta(");
const CEILING_GAMMA_DOC = CEILING.at("/** Doc for gamma. */");
const CEILING_GAMMA = CEILING.at("export function gamma(");
const CEILING_DELTA_DOC = CEILING.at("/** Doc for delta. */");
const CEILING_DELTA = CEILING.at("export function delta(");
const CEILING_CANDIDATES = [CEILING_ALPHA, CEILING_BETA, CEILING_GAMMA, CEILING_DELTA].map(cand);

// ---------------------------------------------------------------------------
// DOC LENGTH. A JSDoc block of N interior lines above a documented function,
// built rather than pasted so the length is a parameter. Line numbers come from
// the construction, not from a needle, because the whole point is the count.
//
// The contract: "Auditing from the TOP of the run consumes the block in one
// walk", and "A doc comment of any length is a single walk." No cliff, at any
// length.
// ---------------------------------------------------------------------------

function jsdocOfLength(interior) {
  const lines = ["const seed = 1;", ""];
  const openerLine = lines.length;
  lines.push("/**");
  const firstInterior = lines.length;
  for (let i = 1; i <= interior; i++) lines.push(` * interior line ${i} of ${interior}`);
  const lastInterior = lines.length - 1;
  const closingLine = lines.length;
  lines.push(" */");
  const nameLine = lines.length;
  lines.push("export function documented(): number {");
  lines.push("  return seed;");
  lines.push("}");
  return {
    fx: fixture(`jsdoc-${interior}-interior`, lines.join("\n"), []),
    interior,
    openerLine,
    firstInterior,
    middleInterior: firstInterior + Math.floor((interior - 1) / 2),
    lastInterior,
    closingLine,
    nameLine,
    candidates: [cand(nameLine)],
  };
}

// The old contract's cliff sat at 16 and no fixture in the repo was long enough
// to find it. 1 and 3 are ordinary, 15/16/17 straddle the old boundary, 40 is
// past any plausible one.
const DOC_LENGTHS = [1, 3, 15, 16, 17, 40];
const LONGDOC = jsdocOfLength(24);

// A 22-line `///` run, so the 20+ row is covered on the line-comment grammar
// as well as the block-comment one.
const CS_LONGDOC = fixture(
  "csharp-long-doc",
  ["namespace Playground;", ""]
    .concat(["public class Long", "{"])
    .concat(Array.from({ length: 22 }, (_, i) => `    /// <para>doc line ${i + 1} of 22</para>`))
    .concat(["    public static int Wide() => 1;", "}"])
    .join("\n"),
  []
);

const CS_LONGDOC_FIRST = CS_LONGDOC.at("doc line 1 of 22");
const CS_LONGDOC_LAST = CS_LONGDOC.at("doc line 22 of 22");
const CS_LONGDOC_WIDE = CS_LONGDOC.at("int Wide() => 1;");
const CS_LONGDOC_CLASS = CS_LONGDOC.at("public class Long");
const CS_LONGDOC_CANDIDATES = [CS_LONGDOC_CLASS, CS_LONGDOC_WIDE].map(cand);

const ALL = [RUST, TS, CS, GO, PY, CLOSER, CSINIT, ALLMAN, CEILING, LONGDOC.fx, CS_LONGDOC];

const ALL_WITH_CANDIDATES = [
  [RUST, RUST_CANDIDATES],
  [TS, TS_CANDIDATES],
  [CS, CS_CANDIDATES],
  [GO, GO_CANDIDATES],
  [PY, PY_CANDIDATES],
  [CLOSER, CLOSER_CANDIDATES],
  [CSINIT, CSINIT_CANDIDATES],
  [ALLMAN, ALLMAN_CANDIDATES],
  [CEILING, CEILING_CANDIDATES],
  [LONGDOC.fx, LONGDOC.candidates],
  [CS_LONGDOC, CS_LONGDOC_CANDIDATES],
];

// ===========================================================================
// 1. attachRunStart: the two steps. Step 1 is the blank-line contiguity
//    boundary; step 2 scans DOWN from it and takes the FIRST candidate that
//    reaches nameLine, jumping past every line that is provably not trivia.
// ===========================================================================

gtest("attachRunStart rust: the `///` run + `#[inline]` above `pub fn stripe_total` starts at the FIRST doc line [contract steps 1 and 2]", () => {
  assert.strictEqual(
    runStart(RUST, RUST_TOTAL),
    RUST_DOC_TOP,
    "the blank line above the doc run is the contiguity boundary, and the walk from there reaches the fn"
  );
});

gtest("attachRunStart ts: the JSDoc opener is the run start even with a MULTI-LINE decorator between doc and head [contract 'Scan DOWN from that boundary ... The FIRST candidate that reaches it is the run start']", () => {
  assert.strictEqual(
    runStart(TS, TS_AUDIT),
    TS_JSDOC_OPENER,
    "the boundary is the class doc comment; its walk stops at the class head, the scan jumps past it, and the next candidate is the `/**` that reaches auditBands through the bracket-balanced decorator"
  );
});

gtest("attachRunStart go: a `//` doc run directly above `func stripeFanout` starts at the first comment line [contract case table 'Go //']", () => {
  assert.strictEqual(runStart(GO, GO_FANOUT), GO_DOC_TOP, "two comment lines, blank above");
});

gtest("attachRunStart python: the `#` run above `@staticmethod` starts at the first `#` line, with lineComments ['#'] [contract 'Python passes [\"#\"] as lineComments']", () => {
  assert.strictEqual(
    runStart(PY, PY_ADD),
    PY_DOC_TOP,
    "`class Fns:` is a line the walk stops at, so the scan jumps past it to the `#` run below"
  );
});

gtest("attachRunStart python: lineComments [] makes the `#` run stop being trivia, so the run stops at the decorator [contract 'Pass [] for Python and its # run stops being trivia']", () => {
  const r = attachRunStart(PY.getLine, PY_ADD, []);
  assert.strictEqual(
    r,
    PY_DECORATOR,
    "with no `#` token the decorator is the topmost candidate that reaches the def, so the `#` lines are outside the run"
  );
});

gtest("attachRunStart csharp: a multi-line `[Theory(...)]` between the `///` and the head still yields the `///` line [contract case table 'multi-line C# attribute']", () => {
  assert.strictEqual(
    runStart(CS, CS_DOUBLE),
    CS_DOUBLE_DOC,
    "the `///` is the contiguity boundary and its walk consumes the bracket-balanced attribute on the way to the head"
  );
});

gtest("attachRunStart csharp: the `///` run above a `[Fact]` inside a class body starts at the first `///` [contract 'a member's trivia run can never reach up across its container's head line']", () => {
  assert.strictEqual(
    runStart(CS, CS_ADD),
    CS_ADD_DOC_TOP,
    "the boundary is `public class Fns`; that line and the lone `{` below it are both lines the walk stops at, so the scan jumps to the `///`"
  );
});

gtest("attachRunStart: NO run returns nameLine itself - an undocumented declaration behind a blank line [contract 'Returns nameLine itself when there is no run']", () => {
  assert.strictEqual(runStart(RUST, RUST_RESET), RUST_RESET, "rust: blank line directly above the fn");
  assert.strictEqual(runStart(GO, GO_RESET), GO_RESET, "go: blank line directly above the func");
  assert.strictEqual(runStart(PY, PY_RESET), PY_RESET, "python: blank line directly above the def");
});

gtest("attachRunStart: a code line directly above an undocumented declaration is not trivia, so the answer is nameLine [contract 'It stops at the first line that is none of those']", () => {
  assert.strictEqual(
    runStart(TS, TS_TAIL),
    TS_TAIL,
    "`const tailSeed = 5;` is the only candidate in the contiguous region and it is not trivia"
  );
});

gtest("attachRunStart: a lone `}` above a documented declaration is never the run start - the auditor has no shrink-forward [contract 'a comment sitting above a `});` was \"confirmed\" as trivia of the declaration below the brace']", () => {
  assert.strictEqual(
    runStart(TS, TS_NUDGE),
    TS_NUDGE_DOC,
    `the run is the one doc line; bump's closing brace on line ${TS_BUMP_CLOSE} must not be inside nudge's run`
  );
  assert.strictEqual(
    runStart(RUST, RUST_DOUBLE),
    RUST_DOUBLE_DOC,
    "rust: the run is the one doc line above stripe_double, not the closing brace above that"
  );
});

gtest("attachRunStart: a comment above a `});` belongs to NOTHING below the brace [contract 'the auditor is NOT declarationHeadLine ... WITHOUT the shrink-forward step']", () => {
  assert.strictEqual(
    runStart(CLOSER, CLOSER_BUMP),
    CLOSER_DOC,
    "the run is the `/** Bumps */` line alone; `});` is a line the walk stops at, so the object literal's comment is above the run start"
  );
});

gtest("attachRunStart: a bare `[...]` line above a `};` is not pulled into the member's run [contract case table 'cursor on a bare [...] line (a C# collection initializer) above a };']", () => {
  assert.strictEqual(
    runStart(CSINIT, CSINIT_SUM),
    CSINIT_DOC,
    "the `};` stops the walk, so nothing at or above it - including the attribute-shaped `[1, 2, 3],` - can be trivia for SumFirstRow"
  );
});

gtest("attachRunStart: lineComments OMITTED behaves as the documented default [] [contract 'lineComments?: readonly string[] // default []']", () => {
  assert.strictEqual(
    attachRunStart(TS.getLine, TS_AUDIT),
    TS_JSDOC_OPENER,
    "the TS run resolves with no lineComments argument at all"
  );
  assert.strictEqual(
    attachRunStart(TS.getLine, TS_AUDIT),
    attachRunStart(TS.getLine, TS_AUDIT, []),
    "omitting lineComments is the same call as passing []"
  );
});

gtest("attachRunStart: there is NO miss budget - a stray fourth argument cannot change any answer [contract 'There is no miss budget, and its absence is a fix rather than a simplification']", () => {
  // The replaced predicate took maxMisses here and a value of 1 changed the
  // answer. If any of these differ, the budget is back.
  for (const [fx, nameLine, label] of [
    [TS, TS_AUDIT, "typescript: the multi-line decorator run"],
    [CS, CS_DOUBLE, "csharp: the multi-line attribute run"],
    [LONGDOC.fx, LONGDOC.nameLine, "a 24-interior-line JSDoc"],
    [CS_LONGDOC, CS_LONGDOC_WIDE, "a 22-line /// run"],
  ]) {
    const plain = attachRunStart(fx.getLine, nameLine, fx.lineComments);
    for (const stray of [0, 1, 2, 16]) {
      assert.strictEqual(
        attachRunStart(fx.getLine, nameLine, fx.lineComments, stray),
        plain,
        `${label}: a fourth argument of ${stray} changed the answer, so a miss budget still exists`
      );
    }
  }
});

// ===========================================================================
// 2. attachRunStart: doc-comment LENGTH. The parameter the old contract had a
//    silent cliff in.
// ===========================================================================

for (const interior of DOC_LENGTHS) {
  gtest(`attachRunStart: a JSDoc of ${interior} interior line(s) attaches from its opener, and the cursor attaches on the first interior line, the middle and the closer [contract 'A doc comment of any length is a single walk']`, () => {
    const d = jsdocOfLength(interior);
    assert.strictEqual(
      runStart(d.fx, d.nameLine),
      d.openerLine,
      `${interior} interior lines: the run start must be the /** on line ${d.openerLine}`
    );
    for (const [label, line] of [
      ["opener `/**`", d.openerLine],
      ["first interior line", d.firstInterior],
      ["middle interior line", d.middleInterior],
      ["last interior line", d.lastInterior],
      ["closing ` */` line", d.closingLine],
    ]) {
      assert.strictEqual(
        attachedNameLine(d.fx, d.candidates, line),
        d.nameLine,
        `${interior} interior lines: a cursor on the ${label} (line ${line}) must attach to the function on line ${d.nameLine}`
      );
    }
  });
}

gtest("row 'cursor on an INTERIOR line of a doc comment 20+ lines long | attaches' - TYPESCRIPT, every one of the 24 interior lines", () => {
  for (let line = LONGDOC.firstInterior; line <= LONGDOC.lastInterior; line++) {
    assert.strictEqual(
      attachedNameLine(LONGDOC.fx, LONGDOC.candidates, line),
      LONGDOC.nameLine,
      `interior line ${line} of a ${LONGDOC.interior}-line JSDoc must attach; a budget that spends a miss per interior line is what broke this`
    );
  }
});

gtest("row 'cursor on an INTERIOR line of a doc comment 20+ lines long | attaches' - C#, a 22-line `///` run inside a class body", () => {
  assert.strictEqual(
    runStart(CS_LONGDOC, CS_LONGDOC_WIDE),
    CS_LONGDOC_FIRST,
    "the whole `///` run is the trivia run, no matter how long it is"
  );
  for (let line = CS_LONGDOC_FIRST; line <= CS_LONGDOC_LAST; line++) {
    assert.strictEqual(
      attachedNameLine(CS_LONGDOC, CS_LONGDOC_CANDIDATES, line),
      CS_LONGDOC_WIDE,
      `csharp: doc line ${line} of a 22-line run must attach to Wide`
    );
  }
});

// ===========================================================================
// 3. attachRunStart: the guaranteed properties, swept over every fixture.
// ===========================================================================

gtest("PROPERTY attachRunStart(getLine, 0) === 0 in every fixture [contract 'Nothing above line 0']", () => {
  for (const fx of ALL) {
    assert.strictEqual(attachRunStart(fx.getLine, 0, fx.lineComments), 0, `${fx.label}: line 0 answers 0`);
  }
});

gtest("PROPERTY the return is always within [0, nameLine], for EVERY line of every fixture [contract 'The return value is always in [0, nameLine]']", () => {
  for (const fx of ALL) {
    for (let nameLine = 0; nameLine < fx.lines.length; nameLine++) {
      const r = runStart(fx, nameLine);
      assert.ok(
        Number.isInteger(r) && r >= 0 && r <= nameLine,
        `${fx.label}: nameLine ${nameLine} answered ${r}, outside [0, ${nameLine}]`
      );
    }
  }
});

gtest("PROPERTY every line in [runStart, nameLine-1] is non-blank, for EVERY line of every fixture [contract 'It follows that a cursor on a blank line can never attach']", () => {
  for (const fx of ALL) {
    for (let nameLine = 0; nameLine < fx.lines.length; nameLine++) {
      const r = runStart(fx, nameLine);
      for (let line = r; line < nameLine; line++) {
        assert.notStrictEqual(
          fx.getLine(line).trim(),
          "",
          `${fx.label}: nameLine ${nameLine} gave runStart ${r}, but line ${line} is blank; a blank ENDS the run`
        );
      }
    }
  }
});

gtest("PROPERTY getLine is never called with a negative line, even at the very top of the file [contract 'getLine is never called with a negative line']", () => {
  let lowest = Number.POSITIVE_INFINITY;
  const watched = (line) => {
    lowest = Math.min(lowest, line);
    return TS.getLine(line);
  };
  for (const nameLine of [0, 1, 2, 3]) {
    attachRunStart(watched, nameLine, []);
  }
  attachedCandidateIndex([cand(1), cand(2), cand(3)], watched, 0, []);
  assert.ok(lowest >= 0, `the lowest line requested was ${lowest}; a negative line is forbidden`);
});

// ===========================================================================
// 4. The case table, row by row. Names carry the row so a failure says which
//    one broke. [contract 'Cases the phase-1 tests must cover']
// ===========================================================================

gtest("row 'cursor on a ///-style line directly above a fn, no blank between | attaches' - RUST", () => {
  for (const [label, line] of [
    ["first /// line", RUST_DOC_TOP],
    ["bare /// line", RUST_DOC_BARE],
    ["last /// line", RUST_DOC_LAST],
    ["#[inline] attribute line", RUST_ATTR],
  ]) {
    assert.strictEqual(
      attachedNameLine(RUST, RUST_CANDIDATES, line),
      RUST_TOTAL,
      `rust: a cursor on the ${label} belongs to stripe_total`
    );
  }
});

gtest("row 'cursor on a ///-style line directly above a fn | attaches' - C# `///` above a `[Fact]`, which today resolves to the enclosing CLASS", () => {
  for (const [label, line] of [
    ["first /// summary line", CS_ADD_DOC_TOP],
    ["/// returns line", CS_ADD_DOC_RETURNS],
    ["[Fact] attribute line", CS_FACT],
  ]) {
    assert.strictEqual(
      attachedNameLine(CS, CS_CANDIDATES, line),
      CS_ADD,
      `csharp: a cursor on the ${label} belongs to Add, not to the class that today's range test returns`
    );
  }
});

gtest("row 'cursor in a /// run above a C# [Fact] attribute | attaches' - and the Fns class is NOT eligible, it sits above the cursor", () => {
  const i = attachedCandidateIndex(CS_CANDIDATES, CS.getLine, CS_ADD_DOC_TOP, []);
  assert.notStrictEqual(i, -1, "the doc comment attaches to something");
  assert.strictEqual(
    CS_CANDIDATES[i].nameLine,
    CS_ADD,
    "only candidates with nameLine > cursorLine are eligible, so `public class Fns` above the cursor cannot win"
  );
});

gtest("row 'cursor on the JSDoc opener line (/**) | attaches' - TYPESCRIPT", () => {
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_JSDOC_OPENER),
    TS_AUDIT,
    "the `/**` line belongs to auditBands"
  );
});

gtest("row 'cursor on a JSDoc INTERIOR line ( * text) | attaches' - TYPESCRIPT, the row a naive forward walk fails", () => {
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_JSDOC_INTERIOR),
    TS_AUDIT,
    "an interior ` * @param` line has no comment opener on it and must still attach"
  );
});

gtest("row 'cursor on a JSDoc CLOSING line ( */) | attaches' - TYPESCRIPT", () => {
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_JSDOC_CLOSING),
    TS_AUDIT,
    "the ` */` line belongs to auditBands"
  );
});

gtest("row 'cursor in a JSDoc with a multi-line decorator between the doc and the head | attaches' - TYPESCRIPT, all three decorator lines included", () => {
  for (const [label, line] of [
    ["decorator opener `@memoize({`", TS_DECORATOR_OPEN],
    ["decorator argument line", TS_DECORATOR_ARG],
    ["decorator closing `})` line", TS_DECORATOR_CLOSE],
  ]) {
    assert.strictEqual(
      attachedNameLine(TS, TS_CANDIDATES, line),
      TS_AUDIT,
      `a cursor on the ${label} sits at or below the run start, so it attaches`
    );
  }
});

gtest("row 'cursor in a multi-line C# attribute's ARGUMENT line | attaches' - the continuation line is inside the run", () => {
  assert.strictEqual(
    attachedNameLine(CS, CS_CANDIDATES, CS_THEORY_ARG),
    CS_DOUBLE,
    "`DisplayName = ...)]` is below the run start `///`, so cursorLine >= runStart holds"
  );
  assert.strictEqual(
    attachedNameLine(CS, CS_CANDIDATES, CS_THEORY_OPEN),
    CS_DOUBLE,
    "the `[Theory(` opener attaches too"
  );
  assert.strictEqual(
    attachedNameLine(CS, CS_CANDIDATES, CS_DOUBLE_DOC),
    CS_DOUBLE,
    "and so does the `///` above it"
  );
});

gtest("row 'cursor in a # run above a Python @staticmethod decorator | attaches' - PYTHON", () => {
  for (const [label, line] of [
    ["first # line", PY_DOC_TOP],
    ["second # line", PY_DOC_LAST],
    ["@staticmethod line", PY_DECORATOR],
  ]) {
    assert.strictEqual(
      attachedNameLine(PY, PY_CANDIDATES, line),
      PY_ADD,
      `python: a cursor on the ${label} belongs to spike_add, which today resolves to NOTHING`
    );
  }
});

gtest("row 'cursor on a //-style line directly above a func | attaches' - GO, which today resolves to NOTHING", () => {
  for (const [label, line] of [
    ["first // doc line", GO_DOC_TOP],
    ["second // doc line", GO_DOC_LAST],
  ]) {
    assert.strictEqual(
      attachedNameLine(GO, GO_CANDIDATES, line),
      GO_FANOUT,
      `go: a cursor on the ${label} belongs to stripeFanout`
    );
  }
});

gtest("row 'free-floating comment with a BLANK line before the next declaration | refuses' - RUST and GO", () => {
  assert.strictEqual(
    attachedNameLine(RUST, RUST_CANDIDATES, RUST_MARKER),
    -1,
    "rust: a section marker separated by a blank line owns nothing"
  );
  assert.strictEqual(
    attachedNameLine(GO, GO_CANDIDATES, GO_MARKER),
    -1,
    "go: same shape, same refusal - contiguity is the whole point"
  );
});

gtest("row 'cursor on a blank line | refuses' - all five languages", () => {
  for (const [fx, candidates, line, label] of [
    [RUST, RUST_CANDIDATES, RUST_MARKER + 1, "rust: blank between the marker and the next fn"],
    [TS, TS_CANDIDATES, TS_BLANK_ABOVE_BUMP, "typescript: blank above a documented function"],
    [TS, TS_CANDIDATES, TS_BLANK_IN_CLASS, "typescript: blank inside a class body"],
    [CS, CS_CANDIDATES, CS_BLANK_BEFORE_DOUBLE, "csharp: blank above a documented method"],
    [GO, GO_CANDIDATES, GO_MARKER + 1, "go: blank above a func"],
    [PY, PY_CANDIDATES, PY_BLANK_BEFORE_RESET, "python: blank above a method"],
  ]) {
    assert.strictEqual(attachedNameLine(fx, candidates, line), -1, `${label} must not attach`);
  }
});

gtest("row 'cursor on a code line above a documented declaration | refuses' - TYPESCRIPT and GO", () => {
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_BAND_SEED),
    -1,
    "typescript: `const bandSeed = 3;` is not trivia, so it sits above widen's run start"
  );
  assert.strictEqual(
    attachedNameLine(GO, GO_CANDIDATES, GO_BASE_VAR),
    -1,
    "go: `var stripeBase = 3` sits above the doc run, not inside it"
  );
  assert.strictEqual(
    attachedNameLine(GO, GO_CANDIDATES, GO_PACKAGE),
    -1,
    "go: the package clause attaches to nothing"
  );
});

gtest("row 'cursor on the previous declaration's closing } | refuses' - TYPESCRIPT and RUST", () => {
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_BUMP_CLOSE),
    -1,
    "typescript: bump's `}` is a line the walk stops at, never inside nudge's run"
  );
  assert.strictEqual(
    attachedNameLine(RUST, RUST_CANDIDATES, RUST_TOTAL_CLOSE),
    -1,
    "rust: stripe_total's `}` does not attach to stripe_double below it"
  );
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_AUDIT_CLOSE),
    -1,
    "typescript: auditBands' `}` does not attach to the next member"
  );
  assert.strictEqual(
    attachedNameLine(ALLMAN, ALLMAN_CANDIDATES, ALLMAN_FIRST_CLOSE),
    -1,
    "csharp: First's Allman `}` does not attach to the documented Second below it"
  );
});

gtest("row 'cursor on a comment line ABOVE a `});`, with a documented declaration below | refuses' - TYPESCRIPT", () => {
  for (const [label, line] of [
    ["the `// the ttl` comment inside the object literal", CLOSER_COMMENT],
    ["the `ttlMs: 500,` property line", CLOSER_ARG],
    ["the `});` line itself", CLOSER_BRACE],
    ["the `memoize({` opener", CLOSER_LITERAL_OPEN],
  ]) {
    assert.strictEqual(
      attachedNameLine(CLOSER, CLOSER_CANDIDATES, line),
      -1,
      `a cursor on ${label} must not resolve to bumpSeed below the brace - this is the defect the predicate was replaced over`
    );
  }
  assert.strictEqual(
    attachedNameLine(CLOSER, CLOSER_CANDIDATES, CLOSER_DOC),
    CLOSER_BUMP,
    "and the doc comment directly above bumpSeed still attaches to it"
  );
});

gtest("row 'cursor on a bare [...] line (a C# collection initializer) above a }; | refuses' - C#", () => {
  for (const [label, line] of [
    ["the bare `[1, 2, 3],` line", CSINIT_BARE_BRACKET],
    ["the `};` line", CSINIT_CLOSE_BRACE],
    ["the initializer's opening `{`", CSINIT_OPEN_BRACE],
    ["the field declaration line", CSINIT_FIELD],
  ]) {
    assert.strictEqual(
      attachedNameLine(CSINIT, CSINIT_CANDIDATES, line),
      -1,
      `csharp: a cursor on ${label} must not resolve to SumFirstRow - a field initializer resolving to the method below it is what repairFunction would then rewrite`
    );
  }
  assert.strictEqual(
    attachedNameLine(CSINIT, CSINIT_CANDIDATES, CSINIT_DOC),
    CSINIT_SUM,
    "and the `///` directly above SumFirstRow still attaches to it"
  );
});

gtest("row 'cursor on a lone Allman { above a documented member | refuses' - C#", () => {
  assert.strictEqual(
    attachedNameLine(ALLMAN, ALLMAN_CANDIDATES, ALLMAN_CLASS_BRACE),
    -1,
    "csharp: the class's own `{`, directly above a documented member, attaches to nothing"
  );
  assert.strictEqual(
    attachedNameLine(ALLMAN, ALLMAN_CANDIDATES, ALLMAN_FIRST_BRACE),
    -1,
    "csharp: a method body's `{` attaches to nothing either"
  );
  assert.strictEqual(
    attachedNameLine(ALLMAN, ALLMAN_CANDIDATES, ALLMAN_ONLY_DOC),
    ALLMAN_ONLY,
    "and the `///` below the class brace still attaches to Only"
  );
  assert.strictEqual(
    attachedNameLine(ALLMAN, ALLMAN_CANDIDATES, ALLMAN_SECOND_DOC),
    ALLMAN_SECOND,
    "and the `///` above Second still attaches to Second"
  );
});

gtest("row 'a class doc comment above class Foo with a documented method below | attaches to the CLASS' - TYPESCRIPT and PYTHON", () => {
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_CLASS_DOC),
    TS_CLASS,
    "typescript: the class is the nearer candidate below the cursor, so auditBands never steals its doc comment"
  );
  assert.strictEqual(
    attachedNameLine(PY, PY_CANDIDATES, PY_CLASS_DOC),
    PY_CLASS,
    "python: same, with lineComments ['#']"
  );
});

gtest("row 'a method's doc comment inside a class body | attaches to the METHOD' - TYPESCRIPT and PYTHON", () => {
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_JSDOC_INTERIOR),
    TS_AUDIT,
    "typescript: the method is the nearest candidate below the cursor"
  );
  assert.strictEqual(
    attachedNameLine(PY, PY_CANDIDATES, PY_DOC_TOP),
    PY_ADD,
    "python: the `#` run inside the class body belongs to spike_add"
  );
});

gtest("row 'no candidate below the cursor | refuses' - every fixture", () => {
  for (const [fx, candidates] of ALL_WITH_CANDIDATES) {
    const below = Math.max(...candidates.map((c) => c.nameLine)) + 1;
    assert.strictEqual(
      attachedNameLine(fx, candidates, below),
      -1,
      `${fx.label}: every candidate sits at or above line ${below}, so none can own trivia there`
    );
  }
});

gtest("row 'an undocumented declaration directly below the cursor's line | refuses (no run)' - TYPESCRIPT", () => {
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_TAIL_SEED),
    -1,
    "runStart === nameLine means no run, and a candidate with no run never matches"
  );
});

gtest("row: a cursor ON a declaration's own head line attaches to NOTHING, so a container keeps the answer innermostFunction already gave [contract 'Only candidates with nameLine > cursorLine are eligible']", () => {
  assert.strictEqual(
    attachedNameLine(PY, PY_CANDIDATES, PY_CLASS),
    -1,
    "python: a cursor on `class Fns:` must not be handed to spike_add below it"
  );
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_CLASS),
    -1,
    "typescript: a cursor on the class head line must not be handed to auditBands"
  );
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_BUMP),
    -1,
    "typescript: a cursor on a function's own head line is its own business"
  );
  assert.strictEqual(
    attachedNameLine(ALLMAN, ALLMAN_CANDIDATES, ALLMAN_CLASS),
    -1,
    "csharp: a cursor on `public class Allman` must not be handed to Only two lines below"
  );
});

gtest("row: a cursor inside a function BODY attaches to nothing, so today's resolution is byte-identical [goal.md 'Cursor inside a function body is byte-identical to today']", () => {
  for (const [fx, candidates, line, label] of [
    [RUST, RUST_CANDIDATES, RUST_TOTAL + 1, "rust: `a + b`"],
    [TS, TS_CANDIDATES, TS_AUDIT + 1, "typescript: `return bands * 2;`"],
    [CS, CS_CANDIDATES, CS_ADD + 2, "csharp: `return a + b;`"],
    [GO, GO_CANDIDATES, GO_FANOUT + 1, "go: `return seed + 1`"],
    [PY, PY_CANDIDATES, PY_ADD + 1, "python: `return a + b`"],
    [ALLMAN, ALLMAN_CANDIDATES, ALLMAN.at("return 1;"), "csharp allman: `return 1;`"],
  ]) {
    assert.strictEqual(attachedNameLine(fx, candidates, line), -1, `${label} is not trivia for anything below it`);
  }
});

// ===========================================================================
// 5. attachedCandidateIndex: the guaranteed properties.
// ===========================================================================

gtest("attachedCandidateIndex: an EMPTY candidates array returns -1 [contract 'An empty candidates array returns -1']", () => {
  for (const fx of ALL) {
    assert.strictEqual(
      attachedCandidateIndex([], fx.getLine, 0, fx.lineComments),
      -1,
      `${fx.label}: nothing to attach to`
    );
    assert.strictEqual(
      attachedCandidateIndex([], fx.getLine, 3, fx.lineComments),
      -1,
      `${fx.label}: still -1 from a doc-comment line`
    );
  }
});

gtest("attachedCandidateIndex: the BLANK-LINE CEILING - a cursor above a blank line with four documented candidates below answers -1 [contract 'the first blank line at or below the cursor is a hard ceiling on every remaining candidate']", () => {
  assert.strictEqual(
    attachedNameLine(CEILING, CEILING_CANDIDATES, CEILING_MARKER),
    -1,
    "the marker is separated from alpha by one blank line, and no candidate past that blank line can own it"
  );
  assert.strictEqual(
    attachedNameLine(CEILING, CEILING_CANDIDATES, CEILING_BLANK),
    -1,
    "and a cursor ON the blank line answers -1 as well"
  );
  // The same fixture proves the ceiling did not cost the answers BELOW it.
  for (const [docLine, nameLine, label] of [
    [CEILING_ALPHA_DOC, CEILING_ALPHA, "alpha"],
    [CEILING_BETA_DOC, CEILING_BETA, "beta"],
    [CEILING_GAMMA_DOC, CEILING_GAMMA, "gamma"],
    [CEILING_DELTA_DOC, CEILING_DELTA, "delta"],
  ]) {
    assert.strictEqual(
      attachedNameLine(CEILING, CEILING_CANDIDATES, docLine),
      nameLine,
      `${label}: nearest-first still owns its own doc comment below the ceiling`
    );
  }
});

gtest("attachedCandidateIndex: the ceiling is the FIRST blank at or below the cursor, not the whole file - a gap between two declarations answers -1 with candidates on both sides [contract 'what stops a cursor ... in the gap between two declarations from auditing the rest of the file']", () => {
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_BLANK_IN_CLASS),
    -1,
    "typescript: the blank line inside the class body, with reset and four functions below it"
  );
  assert.strictEqual(
    attachedNameLine(ALLMAN, ALLMAN_CANDIDATES, ALLMAN_ONLY + 1),
    -1,
    "csharp: the blank line between Only and First, with two candidates below it"
  );
});

gtest("attachedCandidateIndex: candidates in SCRAMBLED order give the same candidate as ascending order [contract 'candidates may arrive in any order'; 'considered in ASCENDING nameLine']", () => {
  const ascending = TS_CANDIDATES.slice().sort((a, b) => a.nameLine - b.nameLine);
  const scrambled = [TS_WIDEN, TS_RESET, TS_CLASS, TS_TAIL, TS_AUDIT, TS_NUDGE, TS_BUMP].map(cand);
  for (const cursorLine of [
    TS_CLASS_DOC,
    TS_JSDOC_OPENER,
    TS_JSDOC_INTERIOR,
    TS_DECORATOR_ARG,
    TS_BUMP_DOC,
    TS_NUDGE_DOC,
    TS_WIDEN_DOC,
    TS_BAND_SEED,
    TS_TAIL_SEED,
    TS_BLANK_ABOVE_BUMP,
  ]) {
    const a = attachedCandidateIndex(ascending, TS.getLine, cursorLine, []);
    const s = attachedCandidateIndex(scrambled, TS.getLine, cursorLine, []);
    const nameOf = (arr, i) => (i === -1 ? -1 : arr[i].nameLine);
    assert.strictEqual(
      nameOf(scrambled, s),
      nameOf(ascending, a),
      `cursor line ${cursorLine}: the winner must not depend on the array's order`
    );
  }
});

gtest("attachedCandidateIndex: two candidates sharing a nameLine break the tie on INDEX, which is tree order [contract 'Two candidates sharing a nameLine break the tie on their INDEX in candidates']", () => {
  const first = { nameLine: TS_AUDIT, tag: "first" };
  const second = { nameLine: TS_AUDIT, tag: "second" };
  const i = attachedCandidateIndex([first, second], TS.getLine, TS_JSDOC_INTERIOR, []);
  assert.strictEqual(i, 0, "the earlier index wins the tie");
  const j = attachedCandidateIndex([second, first], TS.getLine, TS_JSDOC_INTERIOR, []);
  assert.strictEqual(j, 0, "and it is the index that decides, not the object identity");
});

gtest("attachedCandidateIndex: the input array is NOT mutated - neither order nor entries [contract 'The function does not mutate it']", () => {
  const candidates = [TS_WIDEN, TS_RESET, TS_CLASS, TS_TAIL, TS_AUDIT, TS_NUDGE, TS_BUMP].map(cand);
  const orderBefore = candidates.map((c) => c.nameLine);
  const identityBefore = candidates.slice();
  attachedCandidateIndex(candidates, TS.getLine, TS_JSDOC_INTERIOR, []);
  assert.deepStrictEqual(candidates.map((c) => c.nameLine), orderBefore, "no in-place sort of the caller's array");
  assert.strictEqual(candidates.length, identityBefore.length, "no entries added or dropped");
  for (let i = 0; i < candidates.length; i++) {
    assert.strictEqual(candidates[i], identityBefore[i], `entry ${i} is the same object the caller passed`);
  }
});

gtest("attachedCandidateIndex: a FROZEN candidates array works, which is the hard proof of no mutation [contract 'The function does not mutate it']", () => {
  const frozen = Object.freeze([TS_TAIL, TS_AUDIT, TS_CLASS].map(cand));
  let i;
  assert.doesNotThrow(() => {
    i = attachedCandidateIndex(frozen, TS.getLine, TS_JSDOC_INTERIOR, []);
  }, "a frozen array must not be sorted in place");
  assert.strictEqual(frozen[i].nameLine, TS_AUDIT, "and it still answers auditBands");
});

gtest("attachedCandidateIndex: the FIRST match wins - the nearest declaration below the cursor owns the comment [contract 'The nearest declaration below the cursor owns the comment']", () => {
  // Two documented top-level functions back to back. A cursor in the first
  // one's doc must never reach past it to the second.
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_BUMP_DOC),
    TS_BUMP,
    "the doc above bump belongs to bump, not to nudge further down"
  );
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_NUDGE_DOC),
    TS_NUDGE,
    "and the doc above nudge belongs to nudge"
  );
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_WIDEN_DOC),
    TS_WIDEN,
    "and the doc above widen belongs to widen"
  );
});

gtest("attachedCandidateIndex: a candidate whose nameLine EQUALS the cursor line is ineligible [contract 'Only candidates with nameLine > cursorLine are eligible']", () => {
  assert.strictEqual(
    attachedCandidateIndex([cand(TS_AUDIT)], TS.getLine, TS_AUDIT, []),
    -1,
    "a declaration at the cursor cannot own trivia the cursor is sitting in"
  );
  assert.strictEqual(
    attachedCandidateIndex([cand(TS_AUDIT)], TS.getLine, TS_AUDIT + 5, []),
    -1,
    "and neither can one above it"
  );
});

gtest("attachedCandidateIndex: a candidate with NO run never matches, even when the cursor is right above it [contract 'A candidate matches when runStart < nameLine']", () => {
  assert.strictEqual(
    attachedCandidateIndex([cand(TS_TAIL)], TS.getLine, TS_TAIL_SEED, []),
    -1,
    "runStart === nameLine is the no-run signal"
  );
  assert.strictEqual(
    attachedCandidateIndex([cand(GO_RESET)], GO.getLine, GO_RESET - 1, []),
    -1,
    "go: a blank line above the func means no run at all"
  );
});

gtest("attachedCandidateIndex: the returned INDEX addresses the array as given, not a sorted copy [contract 'returns its INDEX in candidates']", () => {
  const candidates = [cand(TS_TAIL), cand(TS_WIDEN), cand(TS_AUDIT), cand(TS_CLASS)];
  const i = attachedCandidateIndex(candidates, TS.getLine, TS_JSDOC_CLOSING, []);
  assert.strictEqual(i, 2, "auditBands sits at index 2 of the array as handed in");
  assert.strictEqual(candidates[i].nameLine, TS_AUDIT, "and that index addresses auditBands");
});

gtest("attachedCandidateIndex: extra fields on a candidate are carried, not required - only nameLine is read [contract 'interface AttachCandidate { nameLine }']", () => {
  const candidates = [
    { nameLine: TS_CLASS, name: "StripeAuditor", kind: "class" },
    { nameLine: TS_AUDIT, name: "auditBands", kind: "method" },
  ];
  const i = attachedCandidateIndex(candidates, TS.getLine, TS_JSDOC_INTERIOR, []);
  assert.strictEqual(candidates[i].name, "auditBands", "the caller's own symbol object comes back by index");
});

gtest("attachedCandidateIndex: lineComments OMITTED uses the documented default [] [contract 'lineComments? default []']", () => {
  assert.strictEqual(
    attachedCandidateIndex(TS_CANDIDATES, TS.getLine, TS_JSDOC_INTERIOR),
    attachedCandidateIndex(TS_CANDIDATES, TS.getLine, TS_JSDOC_INTERIOR, []),
    "the three-argument call is the same call as the explicit default"
  );
  assert.strictEqual(
    attachedNameLine(TS, TS_CANDIDATES, TS_DECORATOR_ARG),
    TS_AUDIT,
    "and the multi-line decorator is still crossed with the default"
  );
});

gtest("attachedCandidateIndex: getLine answering \"\" past the end of the document is enough, it is never asked to throw [contract 'a getLine that answers \"\" past the end rather than throwing']", () => {
  const past = TS.lines.length + 40;
  assert.strictEqual(
    attachedCandidateIndex([cand(past)], TS.getLine, past - 1, []),
    -1,
    "a candidate past the end of the document has no run, because every line above it reads blank"
  );
});

gtest("attachedCandidateIndex: every attach answer obeys runStart <= cursorLine < nameLine, swept over every line of every fixture [contract 'A candidate matches when runStart < nameLine AND cursorLine >= runStart']", () => {
  for (const [fx, candidates] of ALL_WITH_CANDIDATES) {
    for (let cursorLine = 0; cursorLine < fx.lines.length; cursorLine++) {
      const i = attachedCandidateIndex(candidates, fx.getLine, cursorLine, fx.lineComments);
      if (i === -1) continue;
      const nameLine = candidates[i].nameLine;
      const r = runStart(fx, nameLine);
      assert.ok(nameLine > cursorLine, `${fx.label}: cursor ${cursorLine} attached to nameLine ${nameLine} above it`);
      assert.ok(r < nameLine, `${fx.label}: cursor ${cursorLine} attached to a candidate with no run`);
      assert.ok(cursorLine >= r, `${fx.label}: cursor ${cursorLine} is above the run start ${r} it attached to`);
      assert.notStrictEqual(
        fx.getLine(cursorLine).trim(),
        "",
        `${fx.label}: line ${cursorLine} is blank and must never attach`
      );
      // The blank-line ceiling, restated as a property: no blank line may sit
      // between the cursor and the winner's name line.
      for (let line = cursorLine; line < nameLine; line++) {
        assert.notStrictEqual(
          fx.getLine(line).trim(),
          "",
          `${fx.label}: cursor ${cursorLine} attached to nameLine ${nameLine} across the blank line ${line}`
        );
      }
    }
  }
});

gtest("attachedCandidateIndex: the ONE nearest-eligible answer never depends on how many further candidates the tree hands over [contract 'The FIRST match wins']", () => {
  // The whole flattened tree versus just the winner. Widening the candidate
  // list must not move the answer, which is what makes admitTypes safe.
  for (const [fx, candidates] of ALL_WITH_CANDIDATES) {
    for (let cursorLine = 0; cursorLine < fx.lines.length; cursorLine++) {
      const i = attachedCandidateIndex(candidates, fx.getLine, cursorLine, fx.lineComments);
      if (i === -1) continue;
      const only = [candidates[i]];
      assert.strictEqual(
        attachedCandidateIndex(only, fx.getLine, cursorLine, fx.lineComments),
        0,
        `${fx.label}: cursor ${cursorLine} chose nameLine ${candidates[i].nameLine} out of ${candidates.length} candidates, but not out of one`
      );
    }
  }
});
