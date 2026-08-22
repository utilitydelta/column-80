// BLIND ORACLE - session-v23 phase 4: the cross-cutting SEAM pins for Go as
// the fifth language. Unlike the per-surface v23 suites, most of what this
// file touches is SHIPPED shared code (oracleFor, runOracleCheck/runTestOracle,
// classifyEligibility, assembleRepairPrompt, classifyHallucination,
// renderWholeBlockInjection, renderFimCandidates); the tests pin the ensemble
// invariants a fifth language must not bend, so they may run green immediately
// (the blind-v22 convention for unchanged behavior). Black-box: written from
// the goal + the dispatch map, the allowed compilerOracle.ts /
// extraction.ts / repair.ts / classifyHallucination contract excerpts, and the
// exported surfaces as prior blind suites pinned them. goOracle.ts,
// goExtraction.ts, fimInject.ts and fimWholeBlock.ts bodies were never opened.
//
// Seam pins:
//   1. oracleFor: the five-language registry sweep - rust/typescript/csharp/
//      python/go all resolve, none swallowed by another (the blind-v11 sweep
//      shape extended to five).
//   2. LIVE end-to-end repair eligibility: a real `go build -o /dev/null ./...`
//      diagnostic from a broken function, byteStart >= 0, is eligible inside a
//      RepairScope spanning that function (resolvePath = the oracle's own
//      resolveDiagnosticPath) and out-of-span against a clean sibling; the
//      receiver-named message rides assembleRepairPrompt verbatim.
//   3. classifyHallucination is a HONEST NO-OP for Go: a real parsed Go
//      diagnostic carries no rustc E-code, so the Rust surface leg never
//      misfires - Go repair is diagnostics-shaped (the python precedent).
//   4. The whole-block seam composes headlessly: wholeBlockSiteFor("go")'s own
//      site output feeds renderWholeBlockInjection to an arm-C block (header
//      first, terminator last, every line a // comment).
//   5. memberSiteFor("go") + lineCommentFor("go") + renderFimCandidates
//      compose: `s.` fires and the candidate block is //-prefixed, never #.
//   6. runTestOracle skips honestly for Go (buildTestCommand absent), the
//      pyoracle-blind absence shape.
//
// Live tests spawn the REAL go toolchain (PATH prepends the scratchpad
// install, tmpdir fixtures, ~20-50ms warm builds); gate with SKIP_LIVE or
// automatically when no go binary is present. Everything else is hermetic.
//
// Run: node --test test/blind-v23-goseam.test.cjs
// Headless only: SKIP_LIVE=1 node --test test/blind-v23-goseam.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const GO_BIN_DIR = "/home/utilitydelta/.local/go/bin";
// Every spawn (via runOracleCheck, which inherits process.env) sees the
// scratchpad toolchain first.
process.env.PATH = `${GO_BIN_DIR}:${process.env.PATH || ""}`;

const goPresent =
  fs.existsSync(path.join(GO_BIN_DIR, "go")) ||
  spawnSync("go", ["version"], { encoding: "utf8" }).status === 0;
const SKIP = process.env.SKIP_LIVE
  ? "SKIP_LIVE set"
  : !goPresent
    ? `go binary absent (looked in ${GO_BIN_DIR} and on PATH)`
    : false;
const LIVE_TIMEOUT = 120_000;

// A stray GOWORK in the shell would flip the fixture module into the
// workspace refusal; the seam fixtures assume plain module mode.
const SAVED_GOWORK = process.env.GOWORK;
delete process.env.GOWORK;
test.after(() => {
  if (SAVED_GOWORK !== undefined) process.env.GOWORK = SAVED_GOWORK;
});

let mod = {};
let cleanupBundle = () => {};
let bundleError;
try {
  ({ mod, cleanup: cleanupBundle } = bundleCore(
    "blind-v23-goseam",
    `export { GoOracle, oracleFor, runOracleCheck, runTestOracle } from "../src/core/compilerOracle";\n` +
      `export { classifyEligibility, assembleRepairPrompt } from "../src/core/repair";\n` +
      `export { classifyHallucination } from "../src/core/compilerDirected";\n` +
      `export { wholeBlockSiteFor, renderWholeBlockInjection } from "../src/core/fimWholeBlock";\n` +
      `export { memberSiteFor, lineCommentFor, renderFimCandidates } from "../src/core/fimInject";\n`
  ));
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.oracleFor !== "function") {
  bundleError = new Error("the bundle built but exports no oracleFor");
}
if (!bundleError && typeof mod.GoOracle !== "function") {
  bundleError = new Error("the bundle built but exports no GoOracle class");
}
test.after(() => cleanupBundle());

const {
  GoOracle,
  oracleFor,
  runOracleCheck,
  runTestOracle,
  classifyEligibility,
  assembleRepairPrompt,
  classifyHallucination,
  wholeBlockSiteFor,
  renderWholeBlockInjection,
  memberSiteFor,
  lineCommentFor,
  renderFimCandidates,
} = mod;

test("bundle: the v23 seam surface builds (GoOracle + the shipped shared exports resolve in one bundle) [surface: dispatch-map rows 1,3,4,5 + the shipped repair/prompt/classifier seams]", () => {
  if (bundleError) {
    assert.fail(`the seam surface is not complete yet: ${bundleError.message}`);
  }
});

// Every other test skips (not fails) while the bundle is broken, so a red run
// stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, opts, fn) => {
  if (fn === undefined) {
    fn = opts;
    opts = {};
  }
  return test(name, opts, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });
};

// ---------------------------------------------------------------------------
// Pin 1 - the five-language registry sweep (blind-v11-pyoracle's sweep shape,
// extended: every registered language resolves to ITS OWN strategy).
// ---------------------------------------------------------------------------

const FIVE = ["rust", "typescript", "csharp", "python", "go"];

gtest("oracleFor: all five languages resolve, each to its own strategy, and Go swallows none of the other four [surface: dispatch-map row 1 'oracle registry: add new GoOracle(deps)' + the v11 sweep precedent]", () => {
  for (const id of FIVE) {
    const oracle = oracleFor(id);
    assert.ok(oracle, `oracleFor(${JSON.stringify(id)}) resolves a strategy`);
    assert.strictEqual(oracle.language, id, `the resolved strategy's language IS the asked id (no cross-language swallow)`);
    assert.strictEqual(oracle.appliesTo(id), true, `${id}: the strategy applies to its own id`);
  }
  const go = oracleFor("go");
  assert.ok(go instanceof GoOracle, "oracleFor('go') constructs a GoOracle");
  for (const id of FIVE.filter((l) => l !== "go")) {
    assert.ok(!(oracleFor(id) instanceof GoOracle), `the Go oracle did not swallow ${id}`);
  }
  for (const id of ["java", "fsharp", "golang", ""]) {
    assert.strictEqual(oracleFor(id), undefined, `oracleFor(${JSON.stringify(id)}) stays undefined (honest inapplicability; 'golang' is not the vscode languageId)`);
  }
});

// ---------------------------------------------------------------------------
// Live fixture: one module, one broken function (Shrink calls a method Widget
// does not have) beside one clean function (Grow). ASCII source, so char
// index === byte offset; the function spans below are computed from the same
// bytes the oracle's spans must be expressed in.
// ---------------------------------------------------------------------------

const scratch = [];
test.after(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });

const GO_MOD = "module x\n\ngo 1.26\n";
const SRC_MAIN =
  "package main\n" +
  "\n" +
  "type Widget struct {\n" +
  "\tSize int\n" +
  "}\n" +
  "\n" +
  "func Grow(w *Widget) {\n" +
  "\tw.Size = w.Size + 1\n" +
  "}\n" +
  "\n" +
  "func Shrink(w *Widget) {\n" +
  "\tw.Resize(3)\n" +
  "}\n" +
  "\n" +
  "func main() {\n" +
  "\tvar w Widget\n" +
  "\tGrow(&w)\n" +
  "\tShrink(&w)\n" +
  "}\n";

// The byte span of one top-level function: from its `func` keyword through
// its closing column-0 brace. ASCII fixture, so indexOf IS the byte offset.
const fnSpan = (src, header) => {
  const byteStart = src.indexOf(header);
  assert.ok(byteStart >= 0, `fixture sanity: ${JSON.stringify(header)} is in the source`);
  const close = src.indexOf("\n}", byteStart);
  assert.ok(close >= 0, `fixture sanity: ${JSON.stringify(header)} has a closing brace`);
  return { byteStart, byteEnd: close + "\n}".length };
};
const SHRINK = fnSpan(SRC_MAIN, "func Shrink");
const GROW = fnSpan(SRC_MAIN, "func Grow");

// One real check, memoized: every live seam pin reads the SAME parsed
// diagnostics, so the suite spawns go once (~20-50ms warm) and stays fast.
let liveCheckPromise;
const liveCheck = () => {
  liveCheckPromise ??= (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v23-seam-"));
    scratch.push(root);
    fs.writeFileSync(path.join(root, "go.mod"), GO_MOD);
    const mainAbs = path.join(root, "main.go");
    fs.writeFileSync(mainAbs, SRC_MAIN);
    const oracle = oracleFor("go");
    assert.ok(oracle, "oracleFor('go') resolves for the live rung");
    const logs = [];
    const result = await runOracleCheck(oracle, mainAbs, { log: (l) => logs.push(l) });
    return { root, mainAbs, oracle, result, logs };
  })();
  return liveCheckPromise;
};

// The one diagnostic the fixture produces, asserted once, reused by the pins.
const brokenDiag = (result) => {
  assert.ok(result, "runOracleCheck resolved a result over the real spawn seam");
  assert.strictEqual(result.success, false, "the broken function fails the check verdict");
  const errors = result.diagnostics.filter((d) => d.level === "error");
  assert.strictEqual(errors.length, 1, `exactly the broken function's diagnostic, got ${JSON.stringify(result.diagnostics.map((d) => d.message))}`);
  const diag = errors[0];
  assert.match(diag.message, /has no field or method Resize\b/, `the message is receiver-named, got ${JSON.stringify(diag.message)}`);
  return diag;
};

// The live RepairScope: the oracle's OWN span-path resolution, the shape the
// repair.ts contract names for the live path.
const scopeOver = (check, span) => ({
  filePath: check.mainAbs,
  crateRoot: check.result.crateRoot,
  byteStart: span.byteStart,
  byteEnd: span.byteEnd,
  resolvePath: (crateRoot, fileName) => check.oracle.resolveDiagnosticPath(crateRoot, fileName),
});

const hooksOf = (oracle) => ({ assertionShaped: (d) => oracle.isAssertionShaped(d) });

// ---------------------------------------------------------------------------
// Pin 2 - live end-to-end repair eligibility.
// ---------------------------------------------------------------------------

gtest(
  "live seam: a real go build diagnostic (byteStart >= 0) is ELIGIBLE inside the broken function's RepairScope and OUT-OF-SPAN against the clean sibling, through the oracle's own resolveDiagnosticPath [surface: falsification bar 'one repair round driven by a real go build error' + repair.ts RepairScope/classifyEligibility contract]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    const check = await liveCheck();
    const diag = brokenDiag(check.result);

    const primary = diag.spans.find((s) => s.isPrimary);
    assert.ok(primary, "the diagnostic carries a primary span (eligibility needs a location)");
    assert.ok(primary.byteStart >= 0, `byteStart is a real byte offset, never the -1 sentinel; got ${primary.byteStart}`);
    assert.ok(primary.byteEnd >= primary.byteStart, `byteEnd is ordered, got ${primary.byteStart}..${primary.byteEnd}`);
    assert.ok(
      primary.byteStart >= SHRINK.byteStart && primary.byteStart < SHRINK.byteEnd,
      `the span lands inside the broken function's bytes (${SHRINK.byteStart}..${SHRINK.byteEnd}), got ${primary.byteStart}`
    );

    const eligible = classifyEligibility(diag, scopeOver(check, SHRINK), hooksOf(check.oracle));
    assert.deepStrictEqual(eligible, { eligible: true }, `the SAME diagnostic in the broken function's scope is eligible; got ${JSON.stringify(eligible)}`);

    const outOfSpan = classifyEligibility(diag, scopeOver(check, GROW), hooksOf(check.oracle));
    assert.deepStrictEqual(
      outOfSpan,
      { eligible: false, reason: "out-of-span" },
      `the SAME diagnostic against the CLEAN function's scope is refused as out-of-span; got ${JSON.stringify(outOfSpan)}`
    );
  }
);

gtest(
  "live seam: the receiver-named message rides assembleRepairPrompt verbatim - what any Go repair round consumes [surface: repair prompt 'rendered when present else message' + goal 'per-class receiver-named messages']",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    const check = await liveCheck();
    const diag = brokenDiag(check.result);

    // The diagnostic's repair-facing text (rendered when present, else the
    // message - the pinned assembleRepairPrompt selection rule) carries the
    // receiver-named message verbatim.
    const repairText = diag.rendered !== undefined ? diag.rendered : diag.message;
    assert.match(repairText, /has no field or method Resize\b/, `the repair-facing text carries the receiver-named message, got ${JSON.stringify(repairText)}`);

    const code = SRC_MAIN.slice(SHRINK.byteStart, SHRINK.byteEnd);
    const prompt = assembleRepairPrompt({ languageId: "go", code, diagnostics: [diag] });
    assert.strictEqual(typeof prompt, "string", "assembleRepairPrompt yields a prompt string for a Go diagnostic");
    assert.ok(prompt.includes("has no field or method Resize"), `the prompt carries the receiver-named diagnostic verbatim; got ${JSON.stringify(prompt.slice(0, 400))}`);
    assert.ok(prompt.includes("func Shrink(w *Widget)"), "the prompt carries the broken function's own code");
    assert.strictEqual(prompt, assembleRepairPrompt({ languageId: "go", code, diagnostics: [diag] }), "the assembly is deterministic for the same Go input");
  }
);

// ---------------------------------------------------------------------------
// Pin 3 - classifyHallucination is an honest no-op for Go.
// ---------------------------------------------------------------------------

gtest(
  "live seam: classifyHallucination returns undefined for a real parsed Go diagnostic - no rustc E-code, so the Rust surface leg never misfires and Go repair stays diagnostics-shaped [surface: classifyHallucination's E-code gates + the python precedent]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    const check = await liveCheck();
    const diag = brokenDiag(check.result);

    assert.ok(
      diag.code === undefined || !/^E\d{4}$/.test(diag.code),
      `a Go diagnostic never carries a rustc E-code; got ${JSON.stringify(diag.code)}`
    );
    assert.strictEqual(
      classifyHallucination(diag),
      undefined,
      `the Rust classifier stays silent on a real Go diagnostic (message ${JSON.stringify(diag.message)})`
    );
    // The same honesty holds for every diagnostic the check produced, not
    // only the one this fixture pins.
    for (const d of check.result.diagnostics) {
      assert.strictEqual(classifyHallucination(d), undefined, `no parsed Go diagnostic classifies as a Rust hallucination; offender: ${JSON.stringify(d.message)}`);
    }
  }
);

// ---------------------------------------------------------------------------
// Pin 4 - the whole-block seam composes headlessly: the Go site detector's
// OWN output feeds the shipped arm-C render. Hand-authored graph data; the
// exact bounds/budget the phase-4 pin names.
// ---------------------------------------------------------------------------

const WB_BOUNDS = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 200 };
const WB_BUDGET = 1200;
const WB_HEADER = "types in play (use these real names, do not invent):";
const WB_TERMINATOR = "end of type info - the body follows:";

const nonEmptyLines = (block) => String(block).split("\n").filter((l) => l.trim() !== "");

gtest("whole-block seam: wholeBlockSiteFor('go') exists and its site output feeds renderWholeBlockInjection to an arm-C block - header first, every line a // comment, methods before defs, terminator last, within budget [surface: dispatch-map row 3 + the v22 settled render shape over Go shapes]", () => {
  const detect = wholeBlockSiteFor("go");
  assert.strictEqual(typeof detect, "function", "wholeBlockSiteFor('go') yields a detector");

  const site = detect("package atlas\n\nfunc (s *Stripe) Enroll(t Tile) error {\n\t");
  assert.ok(site, "an empty tab-indented method body under a Go header fires a site");
  assert.strictEqual(typeof site.signature, "string", "the site carries the header signature");
  assert.ok(Array.isArray(site.types) && site.types.length >= 2, `the site names the types in play, got ${JSON.stringify(site.types)}`);
  const segs = site.types.map((t) => String(t).split(".").pop());
  assert.deepStrictEqual(segs, ["Stripe", "Tile"], `receiver then param, first-appearance order (by last dotted segment); got ${JSON.stringify(site.types)}`);

  // The graph is keyed by the site's OWN spellings, so the composition is the
  // real seam: whatever the detector emits is what the render resolves.
  const spec = new Map();
  spec.set(site.types[segs.indexOf("Stripe")], {
    def: "type Stripe struct {\n\ttiles []Tile\n\tbands []LodBand\n}",
    methods: ["func (s *Stripe) Enroll(t Tile) error", "func (s *Stripe) Bands() []LodBand"],
  });
  spec.set(site.types[segs.indexOf("Tile")], {
    def: "type Tile struct {\n\tCode uint32\n\tLod uint8\n}",
    methods: [],
  });
  const block = renderWholeBlockInjection(
    site.types,
    (t) => (spec.has(t) ? { def: spec.get(t).def, fields: [] } : undefined),
    (t) => (spec.has(t) ? spec.get(t).methods : []),
    WB_BOUNDS,
    WB_BUDGET,
    "//"
  );
  assert.ok(block, "the composed site renders a block");
  assert.ok(block.length <= WB_BUDGET, `the block honors the ${WB_BUDGET} budget, got ${block.length}`);

  const lines = nonEmptyLines(block);
  for (const line of lines) {
    assert.ok(line.startsWith("//"), `every non-empty line is a // comment; offending: ${JSON.stringify(line)}`);
  }
  assert.ok(lines[0].includes(WB_HEADER), `the FIRST comment line is the header; got ${JSON.stringify(lines[0])}`);
  const last = lines[lines.length - 1];
  assert.ok(last.startsWith("//") && last.includes(WB_TERMINATOR), `the LAST comment line is the terminator; got ${JSON.stringify(last)}`);
  assert.strictEqual(last.replace("//", "").trim(), WB_TERMINATOR, "the terminator text is exact");

  const lastMethodIdx = Math.max(block.indexOf("Enroll(t Tile)"), block.indexOf("Bands() []LodBand"));
  const firstDefIdx = block.indexOf("type Stripe struct");
  assert.ok(lastMethodIdx !== -1 && firstDefIdx !== -1, "methods and the struct def both ride the block");
  assert.ok(lastMethodIdx < firstDefIdx, `arm C is methods-first over Go shapes; last method @${lastMethodIdx}, first def @${firstDefIdx}`);
});

// ---------------------------------------------------------------------------
// Pin 5 - the member-site seam composes: detector fires on `s.`, and the
// candidate render uses Go's comment token, never Python's.
// ---------------------------------------------------------------------------

const GO_MEMBERS = [
  { name: "Enroll", signature: "Enroll(t Tile) error", kind: "method" },
  { name: "Bands", signature: "Bands() []LodBand", kind: "method" },
];

gtest("member seam: memberSiteFor('go') fires on `s.` and renderFimCandidates with lineCommentFor('go') renders //-prefixed lines, never # [surface: dispatch-map rows 4-5 + the v15 render contract]", () => {
  const detect = memberSiteFor("go");
  assert.strictEqual(typeof detect, "function", "memberSiteFor('go') yields a detector");
  const site = detect("s.");
  assert.deepStrictEqual(site, { partial: "" }, `a bare receiver dot fires with an empty partial; got ${JSON.stringify(site)}`);

  const token = lineCommentFor("go");
  assert.strictEqual(token, "//", "lineCommentFor('go') is Go's own token");

  const block = renderFimCandidates(GO_MEMBERS, site.partial, token);
  assert.strictEqual(
    block,
    "// available here (use one of these exact names, do not invent):\n" +
      "// Enroll(t Tile) error\n" +
      "// Bands() []LodBand",
    "the composed Go candidate block is byte-exact: // header + one //-prefixed signature per line"
  );
  for (const line of nonEmptyLines(block)) {
    assert.ok(line.startsWith("// "), `every line rides Go's token; offending: ${JSON.stringify(line)}`);
    assert.ok(!line.startsWith("#"), `no line ever rides Python's token; offending: ${JSON.stringify(line)}`);
  }
});

gtest("member seam contrast: the SAME members under Python's token render #-prefixed - the compose really keys on the language token, so Go getting // is a decision, not a default accident [surface: lineCommentFor dispatch]", () => {
  const pyBlock = renderFimCandidates(GO_MEMBERS, "", lineCommentFor("python"));
  const pyLines = nonEmptyLines(pyBlock);
  assert.ok(pyLines.length >= 3, "the contrast block renders");
  for (const line of pyLines) {
    assert.ok(line.startsWith("#"), `Python's token drives the prefix; offending: ${JSON.stringify(line)}`);
  }
});

// ---------------------------------------------------------------------------
// Pin 6 - runTestOracle skips honestly for Go (no test rung), mirroring the
// pyoracle blind's absence pin.
// ---------------------------------------------------------------------------

gtest("no rung: GoOracle has no buildTestCommand/parseTestOutput and runTestOracle resolves undefined without spawning, logging the go skip [surface: dispatch-map interfaces 'buildTestCommand optional' + goal 'go vet ... recorded for a future test-file rung only' + the v11 absence precedent]", async () => {
  const oracle = oracleFor("go");
  assert.ok(oracle, "oracleFor('go') resolves");
  assert.strictEqual(oracle.buildTestCommand, undefined, "no Go test rung: buildTestCommand absent (the future test-file rung is parked)");
  assert.strictEqual(oracle.parseTestOutput, undefined, "no Go test rung: parseTestOutput absent");

  const calls = [];
  const lines = [];
  const runCommand = async (cmd) => { calls.push(cmd); return { stdout: "", stderr: "", exitCode: 0 }; };
  const result = await runTestOracle(oracle, "/proj/main.go", "TestSomething", { runCommand, log: (l) => lines.push(l) });
  assert.strictEqual(result, undefined, "no rung -> undefined, never an error");
  assert.strictEqual(calls.length, 0, "runCommand is never invoked: the skip spawns nothing");
  assert.ok(lines.some((l) => /no test rung for go/.test(l)), `the skip line names the missing go rung, got ${JSON.stringify(lines)}`);
});
