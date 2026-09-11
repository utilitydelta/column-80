// Blind oracle for session-v69 phase 6: an error in the tests WE wrote is
// named as one [session-v69/contracts/phase6-our-tests-are-named.md].
//
// Written from the contract alone, WITHOUT READING src/**. Not one file, not
// one grep, not one peek at src/core/repair.ts. Every assertion below is
// derived from the contract's numbered rules 1-8, from the surface block, and
// from the falsification paragraph at the bottom. Nothing else.
//
// Surface exercised, exactly as the contract declares it:
//   generatedTestErrors(diagnostics, { markerId, markerPrefix, resolvePath, readFile })
//     => GeneratedTestError[] , each { filePath, markerId, diagnostic }
//
// EXPECTED RED: phase 6 is not implemented, so src/core/repair.ts does not
// export generatedTestErrors. The bundle itself SUCCEEDS - esbuild cannot tell
// a missing TS named export from a type-only one, so the binding simply comes
// back `undefined` - and every row below therefore fails on the same named
// absence: "built but does not export generatedTestErrors". That is the
// red-before-green state, not a harness bug. Rows FAIL rather than skip here,
// because the absence of the surface IS the finding this file exists to make.
// The one green row is [P6 fixture], which checks this file's own offset
// arithmetic so a broken fixture can never masquerade as a broken build.
//
// Run: SKIP_LIVE=1 node --test test/blind-v69-p6-generated-test-errors.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const TAG = "blind-v69-p6-generated-test-errors";

let mod = {};
// bundleCore writes its entry file BEFORE esbuild runs, so a bundle that
// throws - which is the expected state until phase 6 lands - leaves the entry
// behind. Sweep it either way rather than dropping a stray file into test/ on
// every red run.
let cleanup = () => {
  for (const f of [`.${TAG}.entry.ts`, `.${TAG}.bundle.cjs`]) {
    fs.rmSync(path.join(__dirname, f), { force: true });
  }
};
let bundleError;
try {
  ({ mod } = bundleCore(TAG, `export { generatedTestErrors } from "../src/core/repair";\n`));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const { generatedTestErrors } = mod;

// Rows fail, they do not skip: while the export is missing the contract's
// surface does not exist, and that is a finding. The message separates the two
// reasons a row can be red here - "no surface yet" from "the surface answered
// wrongly" - so nobody has to guess which one they are looking at.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    assert.strictEqual(
      bundleError,
      undefined,
      `the phase 6 surface does not build, so this row is RED for absence rather than for a wrong answer.\n` +
        `Expected src/core/repair.ts to export generatedTestErrors.\n${bundleError}`
    );
    assert.strictEqual(
      typeof generatedTestErrors,
      "function",
      "src/core/repair.ts built but does not export generatedTestErrors(diagnostics, { markerId, markerPrefix, resolvePath, readFile })"
    );
    return fn(ctx);
  });

// ===========================================================================
// Helpers. Nothing here encodes an implementation guess. The marker strings
// are spelled exactly as rule 2 spells them: `<prefix> column80-tests:<id>:begin`
// and `<prefix> column80-tests:<id>:end`.
// ===========================================================================

const MARKER = "first_even";
const RUST_PREFIX = "//";
const PY_PREFIX = "#";
const ROOT = "/repo";

const beginOf = (id, prefix) => `${prefix} column80-tests:${id}:begin`;
const endOf = (id, prefix) => `${prefix} column80-tests:${id}:end`;

// A span carries fileName + byteStart + byteEnd + isPrimary. `byteStart` -1 is
// the "no byte offset could be converted" sentinel of rule 3.
const span = (fileName, byteStart, byteEnd = byteStart, isPrimary = true) => ({
  fileName,
  byteStart,
  byteEnd,
  isPrimary,
});

const err = (code, message, spans) => ({
  kind: "compile-error",
  level: "error",
  code,
  message,
  spans,
  suggestions: [],
});

const warn = (code, message, spans) => ({ ...err(code, message, spans), level: "warning" });

// A fake filesystem that COUNTS its reads. Rule 7 is the only rule that can be
// measured, and this is the instrument. `resolvePath` is deliberately the only
// thing that turns a relative fileName into a key this map holds, so a caller
// that skips resolvePath reads nothing at all.
function tree(files) {
  const reads = [];
  return {
    reads,
    resolvePath: (fileName) => (fileName.startsWith("/") ? fileName : `${ROOT}/${fileName}`),
    readFile: (absPath) => {
      reads.push(absPath);
      return Object.prototype.hasOwnProperty.call(files, absPath) ? files[absPath] : undefined;
    },
  };
}

function run(label, diagnostics, opts) {
  let res;
  assert.doesNotThrow(() => {
    res = generatedTestErrors(diagnostics, opts);
  }, `${label}: generatedTestErrors threw. Rule 4 says "No throw, ever"`);
  assert.ok(Array.isArray(res), `${label}: returned ${JSON.stringify(res)}, not a GeneratedTestError[]`);
  for (const e of res) {
    assert.ok(e && typeof e === "object", `${label}: an entry is not an object: ${JSON.stringify(e)}`);
    assert.strictEqual(typeof e.filePath, "string", `${label}: GeneratedTestError.filePath is not a string: ${JSON.stringify(e.filePath)}`);
    assert.strictEqual(typeof e.markerId, "string", `${label}: GeneratedTestError.markerId is not a string: ${JSON.stringify(e.markerId)}`);
    assert.ok(e.diagnostic && typeof e.diagnostic === "object", `${label}: GeneratedTestError.diagnostic is not a Diagnostic: ${JSON.stringify(e.diagnostic)}`);
  }
  return res;
}

const dump = (label, res, why) =>
  `${label}: ${why}\n` +
  `  returned ${res.length} entr${res.length === 1 ? "y" : "ies"}: ` +
  JSON.stringify(res.map((e) => ({ filePath: e.filePath, markerId: e.markerId, code: e.diagnostic && e.diagnostic.code })), null, 2);

// ===========================================================================
// The dogfood tree, straight out of the falsification paragraph: "a Rust file
// with `first_even` and a marked `column80-tests:first_even` region whose test
// does not compile". ASCII only, so a byte offset and a string index agree.
// ===========================================================================

const RS_REL = "src/tdd.rs";
const RS_ABS = `${ROOT}/${RS_REL}`;

const RS_BEGIN = beginOf(MARKER, RUST_PREFIX);
const RS_END = endOf(MARKER, RUST_PREFIX);

const RS_TEXT = `pub fn first_even(xs: Vec<i32>) -> Option<i32> {
    xs.into_iter().find(|n| n % 2 == 0)
}

${RS_BEGIN}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_even_test() {
        assert_eq!(first_even(vec![1, 2, 3, 4]), Some(2));
        assert_eq!(first_even(), None);
    }
}
${RS_END}

// A line BELOW the region, so a byte exists after the end marker and the
// "one byte AFTER" row can actually fail. Without it RS_END_END + 1 is EOF and
// that row died on its own fixture guard.
pub fn untouched() {}
`;

const RS_BEGIN_START = RS_TEXT.indexOf(RS_BEGIN);
const RS_END_END = RS_TEXT.indexOf(RS_END) + RS_END.length;
// Two offsets INSIDE the region, at the two failing calls.
const RS_IN_A = RS_TEXT.indexOf("first_even(vec![1, 2, 3, 4])");
const RS_IN_B = RS_TEXT.indexOf("first_even(), None");
// One offset ABOVE the begin marker: the body of the function under test.
const RS_ABOVE = RS_TEXT.indexOf("xs.into_iter()");

// Fixture arithmetic, asserted once so a broken fixture cannot masquerade as a
// broken implementation.
test("[P6 fixture] the dogfood tree's offsets are ordered above < begin < inside < end", () => {
  for (const [name, v] of [["begin", RS_BEGIN_START], ["end", RS_END_END], ["inA", RS_IN_A], ["inB", RS_IN_B], ["above", RS_ABOVE]]) {
    assert.ok(v > 0, `fixture bug: offset ${name} is ${v}`);
  }
  assert.ok(RS_ABOVE < RS_BEGIN_START, "fixture bug: the 'above' offset is not above the begin marker");
  assert.ok(RS_BEGIN_START < RS_IN_A && RS_IN_A < RS_IN_B && RS_IN_B < RS_END_END, "fixture bug: the in-region offsets are not inside the region");
  assert.strictEqual(RS_TEXT.indexOf(RS_BEGIN), RS_TEXT.lastIndexOf(RS_BEGIN), "fixture bug: two begin markers");
  assert.strictEqual(RS_TEXT.indexOf(RS_END), RS_TEXT.lastIndexOf(RS_END), "fixture bug: two end markers");
});

const RS_OPTS = () => {
  const t = tree({ [RS_ABS]: RS_TEXT });
  return { t, opts: { markerId: MARKER, markerPrefix: RUST_PREFIX, resolvePath: t.resolvePath, readFile: t.readFile } };
};

const E0061 = (offset) =>
  err("E0061", "this function takes 1 argument but 0 arguments were supplied", [span(RS_REL, offset, offset + 12)]);
const E0308 = (offset) =>
  err("E0308", "mismatched types: expected `Option<i32>`, found `i32`", [span(RS_REL, offset, offset + 12)]);

// ===========================================================================
// The surface itself.
// ===========================================================================

test("[P6 surface] the phase 6 module builds and exports generatedTestErrors", () => {
  assert.strictEqual(
    bundleError,
    undefined,
    `src/core/repair.ts does not export generatedTestErrors. Until it does, every row in this file is RED for absence.\n${bundleError}`
  );
  assert.strictEqual(
    typeof generatedTestErrors,
    "function",
    "THE PHASE 6 SURFACE DOES NOT EXIST YET. src/core/repair.ts bundles, but the binding for generatedTestErrors is undefined, " +
      "so every other row in this file is RED for absence rather than for a wrong answer. Expected: " +
      "generatedTestErrors(diagnostics, { markerId, markerPrefix, resolvePath, readFile }) => GeneratedTestError[]"
  );
});

gtest("[P6 surface] an entry carries the ABSOLUTE path, the marker id, and the diagnostic whole", () => {
  const { opts } = RS_OPTS();
  const d = E0061(RS_IN_B);
  const res = run("surface shape", [d], opts);
  assert.strictEqual(res.length, 1, dump("surface shape", res, "one error landed inside the region"));
  assert.strictEqual(
    res[0].filePath,
    RS_ABS,
    dump("surface shape", res, `[P6 surface] "Absolute path of the file the region lives in". resolvePath turned ${JSON.stringify(RS_REL)} into ${JSON.stringify(RS_ABS)}; the entry must carry that, not the raw span fileName`)
  );
  assert.strictEqual(
    res[0].markerId,
    MARKER,
    dump("surface shape", res, "[P6 surface] \"The marker id the region carries, which is the target's symbol name\"")
  );
  assert.deepStrictEqual(
    res[0].diagnostic,
    d,
    dump("surface shape", res, "[P6 what the human sees] the channel prints \"each diagnostic whole\", so the diagnostic must arrive unmodified")
  );
});

gtest("[P6 surface] an empty diagnostics list returns an empty array and reads nothing", () => {
  const { t, opts } = RS_OPTS();
  const res = run("empty input", [], opts);
  assert.deepStrictEqual(res, [], dump("empty input", res, "nothing in, nothing out"));
  assert.deepStrictEqual(t.reads, [], `no diagnostic points at a file, so there is nothing to read; readFile was called ${t.reads.length} time(s): ${JSON.stringify(t.reads)}`);
});

// ===========================================================================
// Rule 1. Only ERROR-level diagnostics are considered.
// ===========================================================================

gtest("[P6 §1] only error-level diagnostics count: a warning inside the region is not reported", () => {
  const { opts } = RS_OPTS();
  const w = warn("unused_variables", "unused variable: `xs`", [span(RS_REL, RS_IN_A, RS_IN_A + 12)]);
  const e = E0061(RS_IN_B);

  const onlyWarning = run("rule 1 warning alone", [w], opts);
  assert.deepStrictEqual(
    onlyWarning,
    [],
    dump("rule 1 warning alone", onlyWarning, "[P6 §1] \"A warning inside the region is not a compile failure and is not reported here.\" A warning toast that says the generated tests do not compile, on a crate that compiles, is a false alarm the human cannot act on")
  );

  const mixed = run("rule 1 warning beside error", [w, e], opts);
  assert.strictEqual(mixed.length, 1, dump("rule 1 warning beside error", mixed, "[P6 §1] exactly one of the two diagnostics is error-level"));
  assert.strictEqual(mixed[0].diagnostic.code, "E0061", dump("rule 1 warning beside error", mixed, "[P6 §1] the surviving entry is the ERROR, not the warning"));
});

// ===========================================================================
// Rule 2. What makes a diagnostic qualify: a complete region, a PRIMARY span
// in that file, and an offset within the bounds.
// ===========================================================================

gtest("[P6 §2] a primary span inside a complete region qualifies", () => {
  const { opts } = RS_OPTS();
  const res = run("rule 2 inside", [E0061(RS_IN_B)], opts);
  assert.strictEqual(
    res.length,
    1,
    dump("rule 2 inside", res, "[P6 §2] the file carries both markers and the span's offset is between them. This is the whole point of the phase: the error is in code THIS PRODUCT WROTE")
  );
});

gtest("[P6 §2] a span at the EXACT begin-marker start offset qualifies (\"at or after\")", () => {
  const { opts } = RS_OPTS();
  const res = run("rule 2 begin boundary", [E0061(RS_BEGIN_START)], opts);
  assert.strictEqual(
    res.length,
    1,
    dump("rule 2 begin boundary", res, `[P6 §2] "at or AFTER the begin marker's start". The span sits at exactly ${RS_BEGIN_START}, the begin marker's own start byte, and an exclusive comparison drops it`)
  );
});

gtest("[P6 §2] a span at the EXACT end-marker end offset qualifies (\"at or before\")", () => {
  const { opts } = RS_OPTS();
  const res = run("rule 2 end boundary", [E0061(RS_END_END, RS_END_END)], opts);
  assert.strictEqual(
    res.length,
    1,
    dump("rule 2 end boundary", res, `[P6 §2] "at or BEFORE the end marker's end". The span sits at exactly ${RS_END_END}, the last byte the end marker occupies, and an exclusive comparison drops it`)
  );
});

gtest("[P6 §2] one byte BEFORE the begin marker does not qualify", () => {
  const { opts } = RS_OPTS();
  const res = run("rule 2 before begin", [E0061(RS_BEGIN_START - 1, RS_BEGIN_START - 1)], opts);
  assert.deepStrictEqual(
    res,
    [],
    dump("rule 2 before begin", res, "[P6 §2] a byte outside the region is the human's own code. Naming it as OUR generated test sends them to a region they never wrote a line of")
  );
});

gtest("[P6 §2] one byte AFTER the end marker does not qualify", () => {
  const { opts } = RS_OPTS();
  const after = RS_END_END + 1;
  assert.ok(after < RS_TEXT.length, "fixture bug: no byte exists after the end marker");
  const res = run("rule 2 after end", [E0061(after, after)], opts);
  assert.deepStrictEqual(res, [], dump("rule 2 after end", res, "[P6 §2] the region's upper bound is the end marker's end"));
});

gtest("[P6 §2] a NON-primary span inside the region does not qualify on its own", () => {
  const { opts } = RS_OPTS();
  const d = err("E0308", "mismatched types", [span(RS_REL, RS_IN_A, RS_IN_A + 12, false)]);
  const res = run("rule 2 non-primary", [d], opts);
  assert.deepStrictEqual(
    res,
    [],
    dump("rule 2 non-primary", res, "[P6 §2] \"SOME PRIMARY span resolves to a file...\". A secondary span points at a note site - the definition, the expected type - which is routinely elsewhere; qualifying on one attributes the human's error to our region")
  );
});

gtest("[P6 §2] SOME primary span is enough: a secondary span elsewhere plus a primary span inside qualifies", () => {
  const t = tree({ [RS_ABS]: RS_TEXT });
  const opts = { markerId: MARKER, markerPrefix: RUST_PREFIX, resolvePath: t.resolvePath, readFile: t.readFile };
  const d = err("E0061", "this function takes 1 argument but 0 arguments were supplied", [
    span("src/other.rs", 4, 20, false),
    span(RS_REL, RS_IN_B, RS_IN_B + 12, true),
  ]);
  const res = run("rule 2 some primary", [d], opts);
  assert.strictEqual(
    res.length,
    1,
    dump("rule 2 some primary", res, "[P6 §2] \"SOME primary span\" - the qualifying span need not be the first span, and a span pointing elsewhere does not veto it")
  );
  assert.strictEqual(res[0].filePath, RS_ABS, dump("rule 2 some primary", res, "[P6 surface] filePath is the file the REGION lives in, which is the file the qualifying span resolved to"));
});

gtest("[P6 §2] a different markerId's region does not match", () => {
  const t = tree({ [RS_ABS]: RS_TEXT });
  const opts = { markerId: "last_odd", markerPrefix: RUST_PREFIX, resolvePath: t.resolvePath, readFile: t.readFile };
  const res = run("rule 2 wrong id", [E0061(RS_IN_B)], opts);
  assert.deepStrictEqual(
    res,
    [],
    dump("rule 2 wrong id", res, "[P6 §2] the markers are `column80-tests:<markerId>:begin/end`. The file carries a region for `first_even`, and the caller asked about `last_odd`: the cursor is in a different function and the toast would name the wrong one")
  );
});

gtest("[P6 §2] the markers are found with the given markerPrefix, not a hard-coded `//`", () => {
  const pyRel = "tests/test_numbers.py";
  const pyAbs = `${ROOT}/${pyRel}`;
  const pyBegin = beginOf(MARKER, PY_PREFIX);
  const pyEnd = endOf(MARKER, PY_PREFIX);
  const pyText = `def first_even(xs):
    for n in xs:
        if n % 2 == 0:
            return n
    return None


${pyBegin}
def test_first_even():
    assert first_even() == 2
${pyEnd}
`;
  const inside = pyText.indexOf("first_even() == 2");
  assert.ok(inside > pyText.indexOf(pyBegin), "fixture bug: the python offset is not inside the region");

  const t = tree({ [pyAbs]: pyText });
  const d = err("E0061", "first_even() missing 1 required positional argument: 'xs'", [span(pyRel, inside, inside + 12)]);

  const hit = run("rule 2 python prefix", [d], { markerId: MARKER, markerPrefix: PY_PREFIX, resolvePath: t.resolvePath, readFile: t.readFile });
  assert.strictEqual(
    hit.length,
    1,
    dump("rule 2 python prefix", hit, "[P6 surface] \"markerPrefix is the line-comment token the region's markers were written with\". Python's is `#`, and a hard-coded `//` finds no region in any Python file the product ever wrote tests into")
  );

  const t2 = tree({ [pyAbs]: pyText });
  const miss = run("rule 2 wrong prefix", [d], { markerId: MARKER, markerPrefix: RUST_PREFIX, resolvePath: t2.resolvePath, readFile: t2.readFile });
  assert.deepStrictEqual(
    miss,
    [],
    dump("rule 2 wrong prefix", miss, "[P6 §2] the marker text includes the prefix, so a `#`-marked region is not a `//`-marked one")
  );
});

gtest("[P6 §2] an end marker that appears BEFORE the begin marker is not a region", () => {
  const rel = "src/inverted.rs";
  const abs = `${ROOT}/${rel}`;
  const text = `${RS_END}
pub fn first_even(xs: Vec<i32>) -> Option<i32> {
    xs.into_iter().find(|n| n % 2 == 0)
}
${RS_BEGIN}
`;
  const offset = text.indexOf("xs.into_iter()");
  const t = tree({ [abs]: text });
  const d = err("E0308", "mismatched types", [span(rel, offset, offset + 12)]);
  const res = run("rule 2 inverted", [d], { markerId: MARKER, markerPrefix: RUST_PREFIX, resolvePath: t.resolvePath, readFile: t.readFile });
  assert.deepStrictEqual(
    res,
    [],
    dump("rule 2 inverted", res, "[P6 §2] \"contains both ...:begin and, AFTER IT, ...:end\". Here the end precedes the begin, so there is no region and the span sits in the human's own function")
  );
});

// ===========================================================================
// Rule 3. The -1 no-byte-offset sentinel.
// ===========================================================================

gtest("[P6 §3] a span carrying the -1 no-byte-offset sentinel never qualifies", () => {
  const { opts } = RS_OPTS();
  const d = err("E0061", "this function takes 1 argument but 0 arguments were supplied", [span(RS_REL, -1, -1)]);
  const res = run("rule 3 sentinel", [d], opts);
  assert.deepStrictEqual(
    res,
    [],
    dump("rule 3 sentinel", res, "[P6 §3] \"There is no geometry to place it with, and guessing is the wrong direction.\" -1 is less than every begin offset, so a naive `>= begin` comparison is FALSE by luck; a `<= end` one is TRUE and admits it")
  );
});

gtest("[P6 §3] a -1 span alongside a real in-region primary span still qualifies on the other span", () => {
  const { opts } = RS_OPTS();
  const d = err("E0061", "this function takes 1 argument but 0 arguments were supplied", [
    span(RS_REL, -1, -1, true),
    span(RS_REL, RS_IN_B, RS_IN_B + 12, true),
  ]);
  const res = run("rule 3 sentinel beside real", [d], opts);
  assert.strictEqual(
    res.length,
    1,
    dump("rule 3 sentinel beside real", res, "[P6 §3 + §2] rule 3 disqualifies the SPAN, not the diagnostic. Rule 2 asks whether SOME primary span qualifies, and one here does")
  );
});

// ===========================================================================
// Rule 4. A file that cannot be read.
// ===========================================================================

gtest("[P6 §4] a file that cannot be read contributes nothing and never throws", () => {
  const t = tree({}); // readFile returns undefined for every path
  const opts = { markerId: MARKER, markerPrefix: RUST_PREFIX, resolvePath: t.resolvePath, readFile: t.readFile };
  const res = run("rule 4 unreadable", [E0061(RS_IN_B), E0308(RS_IN_A)], opts);
  assert.deepStrictEqual(
    res,
    [],
    dump("rule 4 unreadable", res, "[P6 §4] \"A file that cannot be read contributes nothing. No throw, ever.\" A deleted or unsaved file must not take down a manual Repair Function press")
  );
  assert.ok(
    t.reads.length >= 1,
    `[P6 §4] readFile was never called, so the row proves nothing about the unreadable path. reads: ${JSON.stringify(t.reads)}`
  );
});

// ===========================================================================
// Rule 5. Half a region.
// ===========================================================================

gtest("[P6 §5] a file with a begin marker and no end marker contributes nothing", () => {
  const rel = "src/half.rs";
  const abs = `${ROOT}/${rel}`;
  const text = `pub fn first_even(xs: Vec<i32>) -> Option<i32> {
    xs.into_iter().find(|n| n % 2 == 0)
}

${RS_BEGIN}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_even_test() {
        assert_eq!(first_even(), None);
    }
}
`;
  const inside = text.indexOf("first_even(), None");
  assert.ok(inside > text.indexOf(RS_BEGIN), "fixture bug: the offset is not after the begin marker");
  assert.strictEqual(text.indexOf(RS_END), -1, "fixture bug: the half region carries an end marker");

  const t = tree({ [abs]: text });
  const d = err("E0061", "this function takes 1 argument but 0 arguments were supplied", [span(rel, inside, inside + 12)]);
  const res = run("rule 5 half region", [d], { markerId: MARKER, markerPrefix: RUST_PREFIX, resolvePath: t.resolvePath, readFile: t.readFile });
  assert.deepStrictEqual(
    res,
    [],
    dump("rule 5 half region", res, "[P6 §5] \"an incomplete region has no bounds\". Treating a missing end marker as end-of-file claims every error below the begin marker, including code the human wrote after it")
  );
});

// ===========================================================================
// Rule 6. Order, and duplicates.
// ===========================================================================

gtest("[P6 §6] order is the order of `diagnostics`, and duplicates are not collapsed", () => {
  const { opts } = RS_OPTS();
  const a = E0061(RS_IN_B);
  const b = E0308(RS_IN_A);
  const aAgain = E0061(RS_IN_B); // byte-identical to `a`
  const res = run("rule 6 order", [a, b, aAgain], opts);

  assert.strictEqual(
    res.length,
    3,
    dump("rule 6 order", res, "[P6 §6] \"Duplicates are not collapsed.\" The channel names the count, and a de-duplicating pass under-reports how much of our own output is broken")
  );
  assert.deepStrictEqual(
    res.map((e) => e.diagnostic.code),
    ["E0061", "E0308", "E0061"],
    dump("rule 6 order", res, "[P6 §6] \"Order is the order of `diagnostics`.\" Not sorted by offset, not grouped by file: rustc's own order is what the human sees in the terminal")
  );
  assert.notStrictEqual(
    RS_IN_A,
    RS_IN_B,
    "fixture bug: the two offsets are equal, so a byte-order sort would look like input order"
  );
  assert.ok(
    RS_IN_A < RS_IN_B,
    `fixture bug: the fixture must place E0308's offset (${RS_IN_A}) BEFORE E0061's (${RS_IN_B}) so that an offset sort would reorder them`
  );
});

// ===========================================================================
// Rule 7. Each file is read at most once per call. The counting readFile is
// the instrument; without it this rule is unobservable.
// ===========================================================================

gtest("[P6 §7] each file is read at most once per call, however many diagnostics point at it", () => {
  const { t, opts } = RS_OPTS();
  const res = run("rule 7 one file", [E0061(RS_IN_B), E0308(RS_IN_A), E0061(RS_IN_B), E0308(RS_IN_A)], opts);
  assert.strictEqual(res.length, 4, dump("rule 7 one file", res, "[P6 §6] all four landed inside the region"));
  assert.strictEqual(
    t.reads.length,
    1,
    `[P6 §7] "Each file is read at most once per call, however many diagnostics point at it." Four diagnostics point at one file and readFile ran ${t.reads.length} time(s): ${JSON.stringify(t.reads)}`
  );
  assert.strictEqual(t.reads[0], RS_ABS, `[P6 surface] the read went to ${JSON.stringify(t.reads[0])}, not the resolved absolute path ${JSON.stringify(RS_ABS)}`);
});

gtest("[P6 §7] two files are read once each, not once per diagnostic", () => {
  const otherRel = "src/more.rs";
  const otherAbs = `${ROOT}/${otherRel}`;
  const otherText = RS_TEXT.replace("mod tests {", "mod more_tests {");
  const otherInside = otherText.indexOf("first_even(), None");

  const t = tree({ [RS_ABS]: RS_TEXT, [otherAbs]: otherText });
  const opts = { markerId: MARKER, markerPrefix: RUST_PREFIX, resolvePath: t.resolvePath, readFile: t.readFile };
  const otherErr = (o) => err("E0061", "this function takes 1 argument but 0 arguments were supplied", [span(otherRel, o, o + 12)]);

  const res = run("rule 7 two files", [E0061(RS_IN_B), otherErr(otherInside), E0308(RS_IN_A), otherErr(otherInside), E0061(RS_IN_B)], opts);
  assert.strictEqual(res.length, 5, dump("rule 7 two files", res, "[P6 §2] both files carry a complete `first_even` region and every span is inside one"));
  assert.strictEqual(
    t.reads.length,
    2,
    `[P6 §7] five diagnostics across two files must produce two reads; readFile ran ${t.reads.length} time(s): ${JSON.stringify(t.reads)}`
  );
  assert.deepStrictEqual(
    [...t.reads].sort(),
    [otherAbs, RS_ABS].sort(),
    `[P6 §7] the two reads are not the two distinct files: ${JSON.stringify(t.reads)}`
  );
});

gtest("[P6 §7] a file that could not be read is not read again for the next diagnostic", () => {
  const t = tree({}); // every read misses
  const opts = { markerId: MARKER, markerPrefix: RUST_PREFIX, resolvePath: t.resolvePath, readFile: t.readFile };
  const res = run("rule 7 unreadable cached", [E0061(RS_IN_B), E0308(RS_IN_A), E0061(RS_IN_B)], opts);
  assert.deepStrictEqual(res, [], dump("rule 7 unreadable cached", res, "[P6 §4] nothing is readable, so nothing is reported"));
  assert.strictEqual(
    t.reads.length,
    1,
    `[P6 §7 + §4] "Each file is read at most once per call" holds for the failing read too - a cache that only remembers successes re-stats a missing file once per diagnostic. readFile ran ${t.reads.length} time(s): ${JSON.stringify(t.reads)}`
  );
});

// ===========================================================================
// Rule 8. An empty markerId.
// ===========================================================================

gtest("[P6 §8] an empty markerId matches nothing", () => {
  const emptyRel = "src/empty.rs";
  const emptyAbs = `${ROOT}/${emptyRel}`;
  // Adversarial on purpose: this file literally carries `column80-tests::begin`
  // and `column80-tests::end`, which is what `<markerId>` interpolated with the
  // empty string spells. An implementation that just substitutes and searches
  // finds a region here.
  const emptyText = `pub fn first_even(xs: Vec<i32>) -> Option<i32> {
    xs.into_iter().find(|n| n % 2 == 0)
}

${RUST_PREFIX} column80-tests::begin
fn broken() {
    first_even();
}
${RUST_PREFIX} column80-tests::end
`;
  const inside = emptyText.indexOf("first_even();");
  const t = tree({ [emptyAbs]: emptyText, [RS_ABS]: RS_TEXT });
  const opts = { markerId: "", markerPrefix: RUST_PREFIX, resolvePath: t.resolvePath, readFile: t.readFile };
  const d = err("E0061", "this function takes 1 argument but 0 arguments were supplied", [span(emptyRel, inside, inside + 12)]);

  const res = run("rule 8 empty id", [d, E0061(RS_IN_B)], opts);
  assert.deepStrictEqual(
    res,
    [],
    dump("rule 8 empty id", res, "[P6 §8] \"An empty `markerId` matches nothing.\" An empty target name means the caller has no symbol; reporting a region for it puts a nameless function into the toast")
  );
});

// ===========================================================================
// THE FALSIFICATION. Two rows: the dogfood tree as written, and the same
// errors moved one line ABOVE the begin marker. If exactly one pair in this
// file has to go green for the phase to mean anything, it is this pair.
// ===========================================================================

gtest("[P6 falsification] the dogfood tree: both errors come back with markerId `first_even`", () => {
  const { opts } = RS_OPTS();
  const res = run("falsification inside", [E0308(RS_IN_A), E0061(RS_IN_B)], opts);
  assert.strictEqual(
    res.length,
    2,
    dump("falsification inside", res, "[P6 falsification] \"a marked `column80-tests:first_even` region whose test does not compile. `generatedTestErrors` returns BOTH errors\"")
  );
  assert.deepStrictEqual(
    res.map((e) => e.markerId),
    [MARKER, MARKER],
    dump("falsification inside", res, "[P6 falsification] \"...with `markerId` `first_even`\"")
  );
  assert.deepStrictEqual(
    res.map((e) => e.filePath),
    [RS_ABS, RS_ABS],
    dump("falsification inside", res, "[P6 surface] both entries name the absolute path of the file the region lives in; the channel line prints the basenames from these")
  );
  assert.deepStrictEqual(
    res.map((e) => e.diagnostic.code),
    ["E0308", "E0061"],
    dump("falsification inside", res, "[P6 §6] both, in the order they arrived")
  );
});

gtest("[P6 falsification] the same errors moved ABOVE the begin marker return none", () => {
  const { opts } = RS_OPTS();
  const above = RS_ABOVE;
  assert.ok(above < RS_BEGIN_START, "fixture bug: the moved offsets are not above the begin marker");
  const res = run("falsification above", [E0308(above), E0061(above)], opts);
  assert.deepStrictEqual(
    res,
    [],
    dump("falsification above", res, "[P6 falsification] \"Move the same errors one line ABOVE the begin marker and it returns none.\" Same file, same markers, same codes - only the geometry differs. A row that stays green when the offsets move outside is a check that never looked at the region at all, and the human gets a toast blaming our tests for their own broken function")
  );
});
