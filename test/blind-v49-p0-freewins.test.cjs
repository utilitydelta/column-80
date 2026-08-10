// BLIND ORACLE - session-v49 phase 0, "the free wins and the baselines".
//
// Binds to session-v49/contract-phase0.md and to nothing else. While writing the
// assertions in this file, src/vscode/fnGen.ts and src/core/crossFileShape.ts
// were never opened, and src/core/csExtraction.ts was opened ONLY far enough to
// read the exported NAME and SIGNATURE of the member-signature rewrite
// (`csQualifyStatics(members, defSignature, defLines)`) - never its body. No
// expectation below was copied out of the product.
//
// WHAT WAS RED WHEN THIS FILE WAS WRITTEN, AND WHY THAT WAS THE POINT.
//
//   * Section P1 (the C# `const` fix) and section P2 (the six deleted-capture
//     rows) were both written against an unbuilt phase 0 and were RED on
//     arrival - three rows each. That was the correct output of the job, not a
//     regression. Phase 0 has since landed and all six are green. A red in
//     either section now IS a regression.
//
//   * The P1a / P1b / P1c rows were green from the start. They pin the existing
//     `static` leg and the conservative direction, so an implementation that
//     over-reaches turns them red rather than quietly qualifying an instance
//     member that is perfectly reachable through an instance.
//
//   * Sections P3 and P4 are TRIPWIRES and have been green throughout. They bind
//     the values the product has right now so the later phase that changes them
//     has something to break. A red there is either a deliberate, documented
//     change or a defect - the failure messages say which.
//
//   * P4e is bound THREE WAYS, per the amendment at the end of
//     contract-phase0.md. The contract's original P4e separated `walk` from
//     not-`walk` only, which left a language moving between `graph` and
//     `signatures` invisible on every P4 row. See the note above the three-way
//     rows for the captured evidence that the three are in fact distinguishable.
//
// HOW THE CHANNEL LINE IS OBSERVED. The contract states which CONCEPTS must and
// must not appear on `[fngen] injected context:`; it does not state how the line
// is spelled. So the concepts are matched by a name-then-number pattern
// (`breadth=6`, `types=24`, `depth=2`, `members=48`, `budget=600tok`), and the
// VOCABULARY of that pattern was calibrated against two sources that are not the
// implementation: test/impl-v48-p1-context-dial.test.cjs row D3, which already
// pins `stop=`, `roots=`, `breadth=`, `types=` and `budget=NNNNtok`, and one
// observation run of the shipped channel to confirm `members=` and `depth=`. The
// EXPECTATIONS - which concepts are required, which are forbidden, and for which
// language - come from the contract alone.
//
// Nothing here needs a live language server, so SKIP_LIVE=1 changes nothing. It
// is accepted and ignored so the file runs identically in CI and by hand.
//
// Run: SKIP_LIVE=1 node --test test/blind-v49-p0-freewins.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const esbuild = require("esbuild");

const show = (v) => JSON.stringify(v);
const ROOT = path.join(__dirname, "..");

// ===========================================================================
// HARNESS A. The C# member-signature rewrite, bundled pure. No vscode, no walk,
// no extractor - which is itself the observable P1d asks for.
// ===========================================================================

const CS_ENTRY = path.join(__dirname, ".blind-v49-p0-cs.entry.ts");
const CS_OUT = path.join(__dirname, ".blind-v49-p0-cs.bundle.cjs");
let CS = {};
let csErr;
try {
  fs.writeFileSync(
    CS_ENTRY,
    `export { csQualifyStatics, csStaticQualifier } from "../src/core/csExtraction";\n`,
  );
  esbuild.buildSync({
    entryPoints: [CS_ENTRY],
    bundle: true,
    outfile: CS_OUT,
    format: "cjs",
    platform: "node",
  });
  CS = require(CS_OUT);
} catch (e) {
  csErr = e;
}

// ===========================================================================
// HARNESS B. `resolvePrefill` and the exported language table, bundled headless
// against a structural vscode stub. Mechanics copied from
// test/blind-v48-p1-context-dial.test.cjs; the output channel is a REAL object
// because resolvePrefill leaves background work in flight and a straggler that
// logs into `{}` throws after the row that started it has ended.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v49-p0-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
  with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(p) {
    const ps = p.start ? p.start : p, pe = p.end ? p.end : p;
    const geS = ps.line > this.start.line || (ps.line === this.start.line && ps.character >= this.start.character);
    const leE = pe.line < this.end.line || (pe.line === this.end.line && pe.character <= this.end.character);
    return geS && leE;
  }
  with(s, e) { return new Range(s || this.start, e || this.end); }
}
class Selection extends Range {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {},
  window: {
    createOutputChannel: () => ({ name: "column80", append(){}, appendLine(){}, replace(){}, clear(){}, show(){}, hide(){}, dispose(){} }),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    withProgress: async (_o, t) => t({ report(){} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose(){} }) }),
  },
  commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({
      get: (k, f) => {
        const c = globalThis.__V49_CFG__ || {};
        return Object.prototype.hasOwnProperty.call(c, k) ? c[k] : f;
      },
      has: () => false, inspect: () => undefined, update: async () => {},
    }),
    openTextDocument: (arg) =>
      Promise.resolve({ uri: mkUri(keyOf(arg)), getText: () => (globalThis.__V49_FILES__ || {})[keyOf(arg)] }),
  },
};
`,
);

const FN_ENTRY = path.join(__dirname, ".blind-v49-p0-fn.entry.ts");
const FN_OUT = path.join(__dirname, ".blind-v49-p0-fn.bundle.cjs");
let FN = {};
let fnErr;
try {
  fs.writeFileSync(FN_ENTRY, `export { resolvePrefill, prefillLangFor } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({
    entryPoints: [FN_ENTRY],
    bundle: true,
    outfile: FN_OUT,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  FN = require(FN_OUT);
} catch (e) {
  fnErr = e;
}
const V = (() => {
  try {
    return require(STUB);
  } catch {
    return undefined;
  }
})();

test.after(() => [CS_ENTRY, CS_OUT, STUB, FN_ENTRY, FN_OUT].forEach((f) => fs.rmSync(f, { force: true })));

// A bundle failure is a LOUD row, never a skip: a file that goes green because
// it could not build the subject is the false green this suite exists to stop.
const cstest = (name, fn) =>
  test(name, (ctx) => {
    if (csErr) assert.fail(`the csExtraction bundle did not build: ${csErr.message}`);
    assert.equal(typeof CS.csQualifyStatics, "function", "csQualifyStatics must be exported from src/core/csExtraction");
    return fn(ctx);
  });
const fntest = (name, fn) =>
  test(name, (ctx) => {
    if (fnErr) assert.fail(`the fnGen bundle did not build: ${fnErr.message}`);
    assert.equal(typeof FN.resolvePrefill, "function", "resolvePrefill must be exported from src/vscode/fnGen");
    assert.equal(typeof FN.prefillLangFor, "function", "prefillLangFor must be exported from src/vscode/fnGen");
    return fn(ctx);
  });

test("guard: both bundles build headless", () => {
  if (csErr) assert.fail(`csExtraction bundle failed: ${csErr.message}`);
  if (fnErr) assert.fail(`fnGen bundle failed: ${fnErr.message}`);
  for (const n of ["csQualifyStatics", "csStaticQualifier"]) {
    assert.equal(typeof CS[n], "function", `${n} must be exported from src/core/csExtraction`);
  }
  for (const n of ["resolvePrefill", "prefillLangFor"]) {
    assert.equal(typeof FN[n], "function", `${n} must be exported from src/vscode/fnGen`);
  }
});

// ===========================================================================
// P1. A C# `const` member is spelled through its type, exactly as a `static`
// one is.
//
// EXPECTED RED TODAY on every row that asserts a const member comes back
// qualified. The rest of the section is green and is what stops the fix from
// over-reaching.
//
// The contract's own worked example, verbatim:
//     source:    public const string SITE_PARTITION = "SitePartition";
//     renders:   ContosoConstants.SITE_PARTITION : string
//     not:       SITE_PARTITION : string
// ===========================================================================

const TYPE = "ContosoConstants";
const DEF_SIG = `class ${TYPE}`;
const QUAL = `${TYPE}.`;

// One def source, all the P1 cases in it, so every row runs against a member
// list where the qualifier is demonstrably available. The line index IS the
// member's `declLine`.
const DEF_LINES = [
  /* 0 */ `public static class ${TYPE}`,
  /* 1 */ "{",
  /* 2 */ '    public const string SITE_PARTITION = "SitePartition";',
  /* 3 */ '    public static readonly string CACHE_KEY = "cache";',
  /* 4 */ "    public int constantCount;",
  /* 5 */ "    public string Constants;",
  /* 6 */ "    public int MyConstValue;",
  /* 7 */ "    public int staticLabel;",
  /* 8 */ "    public int StaticCount;",
  /* 9 */ "    public int PlainField;",
  /* 10 */ '    public const string ALREADY_QUALIFIED = "x";',
  /* 11 */ "}",
];

const member = (name, signature, declLine) => ({
  name,
  kind: "field",
  signature,
  ...(declLine === undefined ? {} : { declLine }),
});

const sigOf = (out, name) => {
  const m = out.find((x) => x.name === name);
  assert.ok(m, `the rewrite dropped the member ${show(name)} entirely; it returned ${show(out.map((x) => x.name))}`);
  return m.signature;
};

// Every P1 row calls through here, so every row gets the same anti-vacuity
// guard: the rewrite returned one member per input member, every signature is a
// non-empty string, and - the row that gives the rest teeth - the plain `static`
// member in the same call DID come back qualified. A `const` row that finds
// nothing qualified is measuring a dead call, not a defect.
function rewrite(members, label) {
  const before = members.map((m) => ({ ...m }));
  const out = CS.csQualifyStatics(members, DEF_SIG, DEF_LINES);
  assert.ok(Array.isArray(out), `${label}: the rewrite must answer an array, got ${show(out)}`);
  assert.equal(out.length, members.length, `${label}: one member out per member in; got ${show(out.map((m) => m.name))}`);
  for (const m of out) {
    assert.equal(typeof m.signature, "string", `${label}: ${show(m.name)} came back with no signature: ${show(m)}`);
    assert.ok(m.signature.length > 0, `${label}: ${show(m.name)} came back with an EMPTY signature`);
  }
  assert.deepEqual(
    members.map((m) => ({ ...m })),
    before,
    `${label}: the rewrite mutated its input member list. P1c says a member left alone is left "exactly as it was"`,
  );
  return out;
}

const CONTROL_STATIC = member("CACHE_KEY", "CACHE_KEY : string", 3);

// --- The headline promise ---------------------------------------------------

cstest("P1: a `const` member is qualified by its type, in the contract's own worked example", () => {
  const out = rewrite([member("SITE_PARTITION", "SITE_PARTITION : string", 2), CONTROL_STATIC], "P1 headline");
  assert.equal(
    sigOf(out, "CACHE_KEY"),
    `${QUAL}CACHE_KEY : string`,
    "CONTROL - the plain `static` member in this very call must be qualified, or the `const` assertion " +
      "below would be measuring a rewrite that never ran",
  );
  assert.equal(
    sigOf(out, "SITE_PARTITION"),
    `${QUAL}SITE_PARTITION : string`,
    `a C# \`const\` is implicitly static and cannot be reached through an instance, so rendering it bare ` +
      `under a header that says "use these exact names, do not invent" ships a spelling that does not ` +
      `compile. Shipped in phase 0; a red here now is a regression`,
  );
});

cstest("P1: a `const` gets EXACTLY the spelling a `static` gets - same qualifier, not a second one", () => {
  // "in the same spelling a `static` member already gets". Bound as an equality
  // between the two legs rather than against a literal, so the two can never
  // drift apart even if the qualifier's own spelling is changed deliberately.
  const out = rewrite(
    [member("SITE_PARTITION", "SITE_PARTITION : string", 2), member("CACHE_KEY", "SITE_PARTITION : string", 3)],
    "P1 same-spelling",
  );
  const staticSig = sigOf(out, "CACHE_KEY");
  assert.notEqual(staticSig, "SITE_PARTITION : string", "CONTROL - the static leg must have rewritten something");
  assert.equal(
    sigOf(out, "SITE_PARTITION"),
    staticSig,
    "the const leg and the static leg must produce the identical spelling from the identical input signature. " +
      "Shipped in phase 0; a red here now is a regression",
  );
});

cstest("P1: the scout's real class - 26 members, 23 const and 3 static, all 26 come back qualified", () => {
  // The measured defect, at its measured size: "Measured live on the scout's
  // real class `ContosoConstants`: 26 members, 3 qualified, 23 left bare."
  const lines = [`public static class ${TYPE}`, "{"];
  const members = [];
  for (let i = 0; i < 23; i++) {
    const n = `CONST_MEMBER_${String(i).padStart(2, "0")}`;
    lines.push(`    public const string ${n} = "v${i}";`);
    members.push(member(n, `${n} : string`, lines.length - 1));
  }
  for (let i = 0; i < 3; i++) {
    const n = `StaticMember${i}`;
    lines.push(`    public static readonly int ${n} = ${i};`);
    members.push(member(n, `${n} : int`, lines.length - 1));
  }
  lines.push("}");
  const out = CS.csQualifyStatics(members, DEF_SIG, lines);
  assert.equal(out.length, 26, `CONTROL - 26 members in, 26 out; got ${out.length}`);
  const qualified = out.filter((m) => m.signature.startsWith(QUAL));
  assert.equal(
    out.filter((m) => /^Static/.test(m.name) && m.signature.startsWith(QUAL)).length,
    3,
    "CONTROL - the three `static` members must be qualified today; if they are not, this whole row is " +
      "measuring a dead call rather than the const hole",
  );
  assert.equal(
    qualified.length,
    26,
    `all 26 members must render callably. Today 3 are qualified and 23 are left bare; ` +
      `this call qualified ${qualified.length}. Bare: ` +
      show(out.filter((m) => !m.signature.startsWith(QUAL)).map((m) => m.signature)) +
      `. Shipped in phase 0; a red here now is a regression`,
  );
});

// --- P1a. The existing static leg does not move -----------------------------

cstest("P1a: every member qualified today is still qualified, in the same spelling - this change may only ADD", () => {
  const out = rewrite([CONTROL_STATIC, member("PlainField", "PlainField : int", 9)], "P1a");
  assert.equal(sigOf(out, "CACHE_KEY"), `${QUAL}CACHE_KEY : string`, "the `static` leg must not move");
  assert.equal(
    sigOf(out, "PlainField"),
    "PlainField : int",
    "and an ordinary instance field must stay bare - it IS reachable through an instance",
  );
});

// --- P1b. `const` is a WORD, not a substring --------------------------------

for (const [name, sig, line] of [
  ["constantCount", "constantCount : int", 4],
  ["Constants", "Constants : string", 5],
  ["MyConstValue", "MyConstValue : int", 6],
  // The mirror the contract names: the `static` rule already holds to this and
  // the `const` rule must not be looser.
  ["staticLabel", "staticLabel : int", 7],
  ["StaticCount", "StaticCount : int", 8],
]) {
  cstest(`P1b: \`${name}\` contains the modifier only inside a longer identifier, so it renders BARE`, () => {
    const out = rewrite([member(name, sig, line), CONTROL_STATIC], `P1b ${name}`);
    assert.equal(
      sigOf(out, "CACHE_KEY"),
      `${QUAL}CACHE_KEY : string`,
      "CONTROL - a real `static` member in the SAME call must be qualified. Without this the row below " +
        "would pass against a rewrite that qualified nothing at all",
    );
    assert.equal(
      sigOf(out, name),
      sig,
      `${show(DEF_LINES[line])} declares an ORDINARY member. A rule that reads \`const\` or \`static\` as a ` +
        `substring rather than a word makes an instance member un-callable through an instance, which is ` +
        `the same defect P1 closes, arriving from the other direction`,
    );
  });
}

// --- P1c. The conservative direction is unchanged ---------------------------

for (const [why, m] of [
  ["no declaration line at all", member("SITE_PARTITION", "SITE_PARTITION : string", undefined)],
  ["a declaration line past the end of the def source", member("SITE_PARTITION", "SITE_PARTITION : string", 9999)],
  ["a negative declaration line", member("SITE_PARTITION", "SITE_PARTITION : string", -1)],
  ["a declaration line that does not mention the member's own name", member("SITE_PARTITION", "SITE_PARTITION : string", 1)],
]) {
  cstest(`P1c: ${why} leaves the member exactly as it was - absence of evidence changes nothing`, () => {
    const out = rewrite([m, CONTROL_STATIC], `P1c ${why}`);
    assert.equal(
      sigOf(out, "CACHE_KEY"),
      `${QUAL}CACHE_KEY : string`,
      "CONTROL - the qualifier was available and the rewrite did run in this call",
    );
    assert.equal(
      sigOf(out, "SITE_PARTITION"),
      "SITE_PARTITION : string",
      `the member's declaration could not be read (${why}), so it must be left exactly as it was. Guessing ` +
        `here produces a qualified name that may not compile`,
    );
  });
}

cstest("P1c: a signature that already starts with its own qualifier is not qualified twice", () => {
  const already = `${QUAL}ALREADY_QUALIFIED : string`;
  const out = rewrite([member("ALREADY_QUALIFIED", already, 10), CONTROL_STATIC], "P1c already-qualified");
  assert.equal(
    sigOf(out, "CACHE_KEY"),
    `${QUAL}CACHE_KEY : string`,
    "CONTROL - the rewrite did run in this call",
  );
  assert.equal(
    sigOf(out, "ALREADY_QUALIFIED"),
    already,
    `line 10 is a \`const\` declaration and the signature already carries its owner, so the result must be ` +
      `unchanged. ${show(`${QUAL}${QUAL}ALREADY_QUALIFIED : string`)} is not a name that exists`,
  );
});

// --- P1d. It is independent of every walk -----------------------------------

cstest("P1d: the property is measurable on a member list alone - no walk, no extractor, no server", () => {
  // Everything this section drives is a pure call over (members, def signature,
  // def lines). There is no data-shape walk in the picture and no vscode: the
  // csExtraction bundle above is built with no `vscode` alias at all and would
  // fail to build if the path reached one. What is left to assert here is that
  // the answer depends on nothing else: same input, same output, twice, and the
  // input list is not consumed.
  const input = [member("SITE_PARTITION", "SITE_PARTITION : string", 2), CONTROL_STATIC];
  const first = CS.csQualifyStatics(input, DEF_SIG, DEF_LINES).map((m) => m.signature);
  const second = CS.csQualifyStatics(input, DEF_SIG, DEF_LINES).map((m) => m.signature);
  assert.ok(first.length === 2 && first.every((s) => typeof s === "string" && s.length > 0), `CONTROL - the call produced signatures; got ${show(first)}`);
  assert.deepEqual(second, first, "two identical calls must answer identically - nothing outside the arguments may reach this");
  assert.deepEqual(
    input.map((m) => m.signature),
    ["SITE_PARTITION : string", "CACHE_KEY : string"],
    "and the input member list is not rewritten in place",
  );
});

// ===========================================================================
// P2. The six rows whose capture data was permanently deleted are gone.
//
// EXPECTED RED TODAY: those six rows are still in the file.
//
// Bound on the FILE'S OWN SOURCE rather than on a run, deliberately. Those six
// rows skip on a missing capture, and on a machine where the capture is missing
// a run-based check would go green the moment the rows stopped executing -
// including on a machine with no measurement rig at all, where the whole file
// collapses to one skipped row. A source check has the same answer everywhere.
// ===========================================================================

const V38 = path.join(__dirname, "review-v38-p2-fence-runs.test.cjs");

// Every `test("...")` title in a file. Single, double and template quotes, with
// escapes, so a title carrying an apostrophe is not truncated.
function testTitles(src) {
  const out = [];
  const re = /\btest\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[2]);
  return out;
}

test("P2: no row in review-v38-p2-fence-runs.test.cjs is titled CANNOT RUN any more", () => {
  assert.ok(fs.existsSync(V38), `${V38} must exist - P2 is about six rows inside it, not about deleting it`);
  const src = fs.readFileSync(V38, "utf8");
  const titles = testTitles(src);
  // Anti-vacuity first. "Nothing else in that file changes, and the file still
  // runs": a file that was emptied, renamed away or reduced to a stub would
  // satisfy "no CANNOT RUN titles" while destroying the nine rows that still
  // carry evidence.
  assert.ok(
    titles.length >= 10,
    `the file must still register its other rows. It carries 16 \`test(\` titles today, 6 of them CANNOT ` +
      `RUN, so 10 must survive; this read found ${titles.length}: ${show(titles)}`,
  );
  const cannot = titles.filter((t) => /CANNOT RUN/.test(t));
  assert.deepEqual(
    cannot,
    [],
    `these rows score two capture files deleted on 2026-08-10 and confirmed unrecoverable from every ` +
      `checkout, every git history and every dangling object on this box. A row that can never run is ` +
      `not a test. Phase 0 removed them; a red here now means they came back. Still present:\n  - ` +
      cannot.join("\n  - "),
  );
});

test("P2: exactly six rows go, and the other ten stay", () => {
  assert.ok(fs.existsSync(V38), `${V38} must exist`);
  const titles = testTitles(fs.readFileSync(V38, "utf8"));
  assert.equal(
    titles.length,
    10,
    `"The suite's registered-row count drops by exactly the number removed" and "nothing else in that ` +
      `file changes". The file carried 16 \`test(\` rows on 2026-08-10 (a count taken from the file as it ` +
      `then stood), six of them titled CANNOT RUN, so exactly 10 must remain. Found ${titles.length}:\n  - ` +
      titles.join("\n  - "),
  );
  // The ten that stay are not interchangeable with ten new ones: spot-check the
  // three families by name so a wholesale rewrite cannot pass this row.
  for (const marker of ["[FINE]", "KNOWN WRONG", "SUPERSEDED"]) {
    assert.ok(
      titles.some((t) => t.includes(marker)),
      `the surviving rows must still include the ${show(marker)} family; got ${show(titles)}`,
    );
  }
});

test("P2: the file still runs, still passes, and nothing in it begins to skip on CANNOT RUN", () => {
  assert.ok(fs.existsSync(V38), `${V38} must exist`);
  // NODE_TEST_CONTEXT is inherited and makes node refuse to start a nested test
  // run ("run() is being called recursively"), which would leave this row
  // failing on the harness rather than on the subject. Strip it.
  const env = { ...process.env, SKIP_LIVE: "1", CI: "1" };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", path.relative(ROOT, V38)],
    { cwd: ROOT, encoding: "utf8", timeout: 300000, env },
  );
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const num = (label) => {
    const m = new RegExp(`^# ${label} (\\d+)$`, "m").exec(out);
    return m ? Number(m[1]) : undefined;
  };
  const tests = num("tests");
  const fail = num("fail");
  const pass = num("pass");
  const tail = out.split("\n").slice(-30).join("\n");
  assert.ok(tests !== undefined && fail !== undefined && pass !== undefined, `the child run produced no TAP summary:\n${tail}`);
  assert.ok(tests > 0, `CONTROL - the child run must have registered rows, got ${tests}:\n${tail}`);
  assert.equal(fail, 0, `the file must still PASS after the six rows are removed. ${fail} row(s) failed:\n${tail}`);
  assert.ok(pass > 0, `CONTROL - and at least one row must actually have run, not merely been skipped:\n${tail}`);
  const cannot = out.split("\n").filter((l) => /^(ok|not ok)\b/.test(l) && /CANNOT RUN/.test(l));
  assert.deepEqual(
    cannot,
    [],
    `no row titled CANNOT RUN may be registered by the run. Phase 0 removed them; a red here means they came back:\n  ` +
      cannot.join("\n  "),
  );
});

// ===========================================================================
// P3 (TRIPWIRE). Which of the dial's structural numbers reach each language,
// TODAY.
//
// GREEN today, on purpose. This row exists so that the phase which lights a
// field walk in C#, Go or Python has something to break.
// ===========================================================================

// The contract's table, transcribed. Nothing below reads a value from anywhere
// else.
//
// RE-CUT 2026-08-10, session-v49 phase 1. `go` moved `signatures` -> `walk`.
// What lit it: a Go field parser that reads the struct body out of a gopls
// hover, so `parseHoverFields` stops returning [] for Go, `DerivedType.fields`
// stops being empty, and the data-shape walk finally has edges to follow. Go
// went from one type and no edge of any kind to a real graph. The channel line
// moved in the SAME COMMIT, which is why the three agreement rows below stayed
// green through it - they compare the two halves against each other, not
// against this table, so a coordinated move is invisible to them by design and
// only this row and the P4b/P4c split had to be re-cut.
//
// Previous value, for the record: go was `signatures` from session-v48 until
// this re-cut, alongside python.
const REACH = {
  rust: "walk",
  typescript: "walk",
  csharp: "graph",
  // Was `signatures` until 2026-08-10; see the note above.
  go: "walk",
  // NOTE, and it is a real weakening: python is now the ONLY `signatures`
  // language, and csharp has always been the only `graph` one. A singleton
  // class has no same-reach PAIR, so the partition row can only check its line
  // against the OTHER classes' lines. Rewording a singleton's clause into
  // something new and still-distinct turns nothing red. Reported as a residue
  // rather than patched, because the fix is another language, not another
  // assertion.
  python: "signatures",
};
const LANGS = Object.keys(REACH);

const TRIPWIRE = (lang, was, now) =>
  `\n` +
  `  ==> TRIPWIRE. ${lang} moved in the phase-0 reach table: it was ${show(was)} and is now ${show(now)}.\n` +
  `  A language moving in this table is a DELIBERATE change. It belongs in the SAME COMMIT as the leg\n` +
  `  that lights it - the field walk, the graph edge, whatever raised the language's reach - and this\n` +
  `  row is re-cut in that commit with the new value and a one-line note saying which leg did it.\n` +
  `  If you are reading this red and no such leg is in your diff, it is a DEFECT, not a re-baseline.\n` +
  `  Do not re-cut it to green. Find what moved the classification and why.`;

fntest("P3 TRIPWIRE: the exported language table classifies each language's dial reach at today's values", () => {
  const got = {};
  for (const lang of LANGS) {
    const entry = FN.prefillLangFor(lang);
    assert.ok(entry, `prefillLangFor(${show(lang)}) must answer a language entry`);
    assert.ok(
      "dialReach" in entry,
      `the language entry for ${show(lang)} carries no \`dialReach\`. The contract says the classification ` +
        `is observable "through its exported language table", and goal.md names the field. Keys present: ` +
        show(Object.keys(entry)),
    );
    got[lang] = entry.dialReach;
  }
  for (const lang of LANGS) {
    assert.equal(
      got[lang],
      REACH[lang],
      `${lang}: dialReach must be ${show(REACH[lang])}, got ${show(got[lang])}.` + TRIPWIRE(lang, REACH[lang], got[lang]),
    );
  }
  // And nothing outside the three known classifications, so a fourth value
  // invented by a later phase is seen here rather than silently absorbed.
  const vocab = new Set(["walk", "graph", "signatures"]);
  for (const lang of LANGS) {
    assert.ok(vocab.has(got[lang]), `${lang}: ${show(got[lang])} is not one of ${show([...vocab])}`);
  }
});

// ===========================================================================
// P4 (TRIPWIRE). The channel line tells the truth about what a stop bought.
//
// GREEN today. The clause this pins prints on every Go, Python and C# gesture,
// and a field walk makes it false on the product's own channel.
// ===========================================================================

const WS = "file:///work/v49p0";
const CANDIDATES = ["Cand00", "Cand01", "Cand02"];

// Five minimal, REAL-shaped fixtures. Copied in structure from
// test/blind-v48-p1-context-dial.test.cjs; only the member surface is thinner,
// because P4 reads a channel line and not a render.
const FIXTURES = {
  rust: {
    ext: "rs",
    symbol: "build",
    docLine: "/// Build the thing.",
    signature: (n) => `pub fn build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`,
    body: "    todo!()\n}",
    bodyIndent: "    ",
    def: (t) => `pub struct ${t} { pub slot_number_field: u32, pub label_for_the_slot: String }\n`,
    hover: (t) => `pub struct ${t} {\n    pub slot_number_field: u32,\n    pub label_for_the_slot: String,\n}`,
    members: () => [{ name: "compute0", kind: "method", signature: "pub fn compute0(&self, a: u32) -> u32" }],
  },
  typescript: {
    ext: "ts",
    symbol: "build",
    docLine: "/** Build the thing. */",
    signature: (n) => `export function build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}): number`,
    body: "  throw new Error();\n}",
    bodyIndent: "  ",
    def: (t) => `export class ${t} { slotNumberField: number = 0; labelForTheSlot: string = ""; }\n`,
    hover: (t) => `class ${t}`,
    members: () => [{ name: "compute0", kind: "method", signature: "compute0(a: number): number" }],
  },
  csharp: {
    // PascalCase method name, as every real C# method has.
    ext: "cs",
    symbol: "Build",
    docLine: "/// <summary>Build the thing.</summary>",
    signature: (n) => `public uint Build(${n.map((t, i) => `${t} p${i}`).join(", ")})`,
    body: "    throw new NotImplementedException();\n}",
    bodyIndent: "    ",
    def: (t) => `public class ${t} { public uint SlotNumberField; public string LabelForTheSlot; }\n`,
    hover: (t) => `class ${t}`,
    members: () => [{ name: "Compute0", kind: "method", signature: "public uint Compute0(uint a)" }],
  },
  python: {
    ext: "py",
    symbol: "build",
    docLine: '"""Build the thing."""',
    signature: (n) => `def build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> int:`,
    body: "    raise NotImplementedError",
    bodyIndent: "    ",
    def: (t) => `class ${t}:\n    slot_number_field: int = 0\n    label_for_the_slot: str = ""\n`,
    hover: (t) => `class ${t}`,
    members: () => [{ name: "compute0", kind: "method", signature: "def compute0(self, a: int) -> int" }],
  },
  go: {
    ext: "go",
    symbol: "Build",
    docLine: "// Build the thing.",
    signature: (n) => `func Build(${n.map((t, i) => `p${i} ${t}`).join(", ")}) uint32`,
    body: '\tpanic("todo")\n}',
    bodyIndent: "\t",
    def: (t) => `type ${t} struct { SlotNumberField uint32; LabelForTheSlot string }\n`,
    hover: (t) => `type ${t} struct`,
    members: (t) => [{ name: "Compute0", kind: "method", signature: `func (r *${t}) Compute0(a uint32) uint32` }],
  },
};

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new V.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new V.Position(Math.max(lines.length - 1, 0), 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

function makeExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    const on = [...new Set(line.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])].filter((x) => known.has(x));
    return on.length === 1 ? on[0] : undefined;
  };
  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (c) => {
      const t = typeAtCursor(c.uri, c);
      const h = t ? defTypes[t].hover : undefined;
      return h ? { signature: h } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return (t && defTypes[t].members) || [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

const PREFIX = "[fngen] injected context:";

async function gesture(languageId) {
  const F = FIXTURES[languageId];
  const mainUri = `${WS}/main.${F.ext}`;
  const signature = F.signature(CANDIDATES);
  const src =
    languageId === "python"
      ? `${signature}\n    ${F.docLine}\n${F.body}\n`
      : `${F.docLine}\n${signature} {\n${F.body}\n`;
  const files = { [mainUri]: src };
  const defTypes = {};
  for (const t of CANDIDATES) {
    const uri = `${WS}/${t.toLowerCase()}.${F.ext}`;
    files[uri] = F.def(t);
    defTypes[t] = { uri, hover: F.hover(t), members: F.members(t) };
  }
  const record = {
    span: { start: src.indexOf(signature), end: src.length - 1 },
    signature,
    docComment: "Build the thing.",
    symbolName: F.symbol,
    languageId,
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: F.bodyIndent,
  };
  const logs = [];
  // MERGED, never deleted: resolvePrefill leaves background work in flight and a
  // straggler that finds the file map gone reports as an unhandled rejection
  // after the row that started it ended.
  globalThis.__V49_FILES__ = { ...(globalThis.__V49_FILES__ || {}), ...files };
  const out = await FN.resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, mainUri), record, (l) => logs.push(String(l)));
  return { text: out || "", logs, lines: logs.filter((l) => l.includes(PREFIX)) };
}

// "carries a NUMBER for this concept": the concept's own word, then at most a
// couple of separator characters, then a digit. `breadth=6` and `depth=2` match;
// `breadth, total types and depth buy nothing` does not, which is exactly the
// distinction P4d draws between naming a concept and printing its value.
const carriesNumber = (line, word) => new RegExp(`\\b${word}\\b[^A-Za-z0-9]{0,3}\\d`, "i").test(line);
const namesConcept = (line, word) => new RegExp(`\\b${word}\\b`, "i").test(line);
// The "buys nothing" clause: it names all three inert concepts, says they buy
// nothing, and gives a reason.
function buysNothingClause(line) {
  const m = /\bbuys?\s+nothing\b/i.exec(line || "");
  if (!m) return undefined;
  const reason = line.slice(m.index + m[0].length);
  return { at: m.index, reason };
}

const dump = (lang, r) =>
  `\n  language=${lang}` +
  `\n  injected-context lines (${r.lines.length}):\n    ${r.lines.join("\n    ") || "(none)"}` +
  `\n  all channel lines: ${show(r.logs)}` +
  `\n  payload bytes=${Buffer.byteLength(r.text, "utf8")}`;

const P4_TRIPWIRE =
  `\n` +
  `  ==> TRIPWIRE. The SHAPE of this language's \`${PREFIX}\` line changed.\n` +
  `  That line is what a developer reads to learn what their setting bought, and this project reads its\n` +
  `  own channel as evidence. A language whose line changes shape is a DELIBERATE change and belongs in\n` +
  `  the SAME COMMIT as the leg that lights it: the moment a field walk reaches C#, Go or Python, the\n` +
  `  "buys nothing" clause becomes a lie on every gesture in that language, and this row is re-cut there.\n` +
  `  If you are reading this red and no such leg is in your diff, it is a DEFECT, not a re-baseline.\n` +
  `  Do not re-cut it to green.`;

// --- P4a --------------------------------------------------------------------

for (const lang of LANGS) {
  fntest(`P4a [${lang}]: exactly ONE \`${PREFIX}\` line per fn-gen gesture - not zero, not two`, async () => {
    const r = await gesture(lang);
    assert.ok(r.logs.length > 0, `CONTROL - the gesture must have said something on the channel at all${dump(lang, r)}`);
    assert.equal(
      r.lines.length,
      1,
      `"Once per fn-gen gesture, the product logs one line naming the stop in force and what it bought FOR ` +
        `THAT LANGUAGE." Got ${r.lines.length}${dump(lang, r)}` + P4_TRIPWIRE,
    );
  });
}

// --- P4b / P4c / P4d --------------------------------------------------------

for (const lang of LANGS) {
  const walk = REACH[lang] === "walk";
  fntest(
    `P4${walk ? "b" : "c"} [${lang}]: a ${show(REACH[lang])} language's line ${walk ? "carries" : "omits"} the structural numbers`,
    async () => {
      const r = await gesture(lang);
      assert.equal(r.lines.length, 1, `CONTROL - exactly one line to read${dump(lang, r)}`);
      const line = r.lines[0];

      // What EVERY language's line must carry, whatever its reach. The stop is
      // a NAME, so it is matched as a name; the other three are numbers.
      assert.ok(
        /\bstop\b[^A-Za-z0-9]{0,3}(shipped|small|medium|large|frontier)\b/.test(line),
        `${lang}: the line must name the stop in force. Line:\n    ${line}${P4_TRIPWIRE}`,
      );
      for (const [what, word] of [["the root cap", "roots?"], ["a token budget", "budget"], ["a member cap", "members?"]]) {
        assert.ok(
          carriesNumber(line, word),
          `${lang}: the line must carry ${what}. Line:\n    ${line}${P4_TRIPWIRE}`,
        );
      }

      const structural = [["a breadth number", "breadth"], ["a total-types number", "types"], ["a depth number", "depth"]];
      if (walk) {
        // P4b.
        for (const [what, word] of structural) {
          assert.ok(
            carriesNumber(line, word),
            `${lang} reaches ${show("walk")}, so its line must carry ${what} - the structural numbers are what ` +
              `the dial buys it. Line:\n    ${line}${P4_TRIPWIRE}`,
          );
        }
        assert.equal(
          buysNothingClause(line),
          undefined,
          `${lang} reaches ${show("walk")}, so its line must carry NO clause saying anything buys nothing. ` +
            `Line:\n    ${line}${P4_TRIPWIRE}`,
        );
      } else {
        // P4c + P4d. The concept must be NAMED and its value must not be printed.
        for (const [what, word] of structural) {
          assert.equal(
            carriesNumber(line, word),
            false,
            `P4d: ${lang} does not reach ${show("walk")}, so ${what} must never be printed as a VALUE. A reader ` +
              `must not be able to quote it off this line; \`breadth=48 (inert)\` is the defect this rule ` +
              `closes. Line:\n    ${line}${P4_TRIPWIRE}`,
          );
          assert.ok(
            namesConcept(line, word),
            `P4c: ${lang}'s line must still NAME ${what.replace(/^an? /, "")} in the clause that says it buys ` +
              `nothing. Naming the concept is required; printing its value is not. Line:\n    ${line}${P4_TRIPWIRE}`,
          );
        }
        const clause = buysNothingClause(line);
        assert.ok(
          clause,
          `${lang} reaches ${show(REACH[lang])}, so its line must END with a clause naming breadth, total types ` +
            `and depth as buying nothing in this language. Without it the line reports a stop the developer ` +
            `paid for and stays silent about the three numbers it did not spend. Line:\n    ${line}${P4_TRIPWIRE}`,
        );
        const sep = /[-–—:]|\bbecause\b|\bsince\b/.exec(clause.reason);
        assert.ok(
          sep && clause.reason.slice(sep.index + sep[0].length).trim().length >= 20,
          `${lang}: the clause must come "with a reason", not a bare "buys nothing". What followed the phrase: ` +
            `${show(clause.reason)}. Line:\n    ${line}${P4_TRIPWIRE}`,
        );
        // "It ENDS with a clause": every number the stop DID buy is printed
        // before the clause starts, and nothing numeric follows it.
        const lastNumber = [...line.matchAll(/[A-Za-z][A-Za-z ]*=\s*\d+/g)].pop();
        assert.ok(lastNumber, `CONTROL - the line must print at least one number at all. Line:\n    ${line}`);
        assert.ok(
          clause.at > lastNumber.index,
          `${lang}: the clause must END the line, after the numbers the stop did buy. The last printed number ` +
            `(${show(lastNumber[0])}) sits at character ${lastNumber.index} and the clause starts at ` +
            `${clause.at}. Line:\n    ${line}${P4_TRIPWIRE}`,
        );
      }
    },
  );
}

// --- P4e. The row that matters most ----------------------------------------
//
// THE TWO-WAY VERSION WAS NOT ENOUGH, and the amendment at the end of
// contract-phase0.md records why. P4e as written binds `walk` against
// not-`walk`, so a phase that promotes python from `signatures` to `graph`
// moves the P3 table and leaves every P4 row green - the silent-channel failure
// this whole section exists to prevent, in a session that is about to move
// exactly those values. The two rows after the original bind all THREE
// classifications.
//
// CAPTURED 2026-08-10, off the shipped channel at the `small` stop, and quoted
// here so a reader can see what the rows below are separating. These are the
// only byte-frozen strings in this file and NOTHING asserts them literally; the
// rows derive their expectations from the five languages' own lines at run time.
//
//   walk       rust, typescript
//     ... roots=8 breadth=6 types=24 budget=600tok members=48 (depth=2, resolve cap=16, provenance cap=24)
//   graph      csharp
//     ... members=48 (...); breadth, total types and depth buy nothing in this language - it has
//     no data-shape walk, and the shared budget cuts its collaborator graph off before the
//     gather's own caps can bite
//   signatures python, go
//     ... members=48 (...); breadth, total types and depth buy nothing in this language - it
//     renders member signatures only, with no data-shape walk and no graph edges, so the budget
//     reaches it through the member cap alone
//
// So the three-way distinction IS observable on the line: `graph` names a
// collaborator graph cut off by the shared budget, `signatures` names member
// signatures with no graph edges, and `walk` carries the numbers and no clause
// at all. (Go was in the `signatures` group when that was captured. It moved to
// `walk` on 2026-08-10; see the note on the REACH table above.)
//
// THE FIRST REAL TRIP, AND WHAT IT PROVED. Phase 1 moved go `signatures` ->
// `walk`. Exactly two rows went red - the P3 table and `P4c [go]`, which caught
// go's line printing a breadth number while go was still declared non-`walk` -
// and BOTH of the rows below stayed green, because the leg moved the reach and
// the channel line in the same commit. That is the intended division of labour:
// the two rows below say the two halves agree with EACH OTHER, so they are
// silent on a coordinated move and loud on a half-move, and the P3 table above
// is the row that says the agreed-on value is the one that was signed off. A
// build that had moved only one half would have turned these red instead.

// The line's SHAPE: its text with every run of digits collapsed, so two
// languages that differ only in the numbers their caps resolved to still count
// as the same shape. Shape is what carries the classification; the numbers
// carry the stop.
const shapeOf = (line) => String(line).replace(/\d+/g, "#");
// Words worth discriminating on. Four letters or more, so `the`, `it`, `and`
// and the punctuation cannot pass as a distinguishing mechanism.
const wordsOf = (shape) => new Set((shape.toLowerCase().match(/[a-z]{4,}/g) || []));
const minus = (a, b) => [...a].filter((w) => !b.has(w));

fntest("P4e TRIPWIRE: a language's declared reach and the SHAPE of its channel line are the same fact told twice", async () => {
  // "A language whose reach says `walk` and whose line carries the 'buys
  // nothing' clause, or the reverse, is a defect regardless of which half is
  // right." Bound directly - neither half is compared to the contract's table
  // here, only to the OTHER half - so a build that moves one and forgets the
  // other turns red even if it moved the one it meant to move.
  const rows = [];
  for (const lang of LANGS) {
    const r = await gesture(lang);
    assert.equal(r.lines.length, 1, `CONTROL - ${lang} must log exactly one line to read${dump(lang, r)}`);
    const line = r.lines[0];
    const entry = FN.prefillLangFor(lang);
    assert.ok(entry && "dialReach" in entry, `CONTROL - ${lang} must expose a dialReach to compare against`);
    rows.push({
      lang,
      reach: entry.dialReach,
      structural: ["breadth", "types", "depth"].filter((w) => carriesNumber(line, w)),
      clause: buysNothingClause(line) !== undefined,
      line,
    });
  }
  const table = rows
    .map((x) => `    ${x.lang.padEnd(11)} reach=${String(x.reach).padEnd(11)} structural-numbers=${show(x.structural)} buys-nothing-clause=${x.clause}\n      ${x.line}`)
    .join("\n");
  // CONTROL: the two halves must not be trivially constant, or "they agree" is
  // satisfied by a product that says the same thing about every language.
  assert.ok(new Set(rows.map((x) => x.reach)).size > 1, `CONTROL - the reach classification must actually vary across languages\n${table}`);
  assert.ok(new Set(rows.map((x) => x.clause)).size > 1, `CONTROL - the line shape must actually vary across languages\n${table}`);

  for (const x of rows) {
    const isWalk = x.reach === "walk";
    assert.equal(
      x.structural.length === 3,
      isWalk,
      `${x.lang}: dialReach says ${show(x.reach)} but its channel line carries ${x.structural.length} of the ` +
        `three structural numbers (${show(x.structural)}). These are the same fact told twice and they ` +
        `disagree.\n${table}${P4_TRIPWIRE}`,
    );
    assert.equal(
      x.clause,
      !isWalk,
      `${x.lang}: dialReach says ${show(x.reach)} but the "buys nothing" clause is ${x.clause ? "PRESENT" : "ABSENT"}. ` +
        `A language that reaches \`walk\` must not tell a developer the structural numbers bought nothing, and a ` +
        `language that does not reach \`walk\` must say so. Whichever half is right, the pair is a defect.\n` +
        `${table}${P4_TRIPWIRE}`,
    );
    assert.equal(
      x.structural.length === 3 || x.structural.length === 0,
      true,
      `${x.lang}: the line carries SOME of the structural numbers (${show(x.structural)}) and not others. ` +
        `The two shapes P4 allows are all three or none.\n${table}${P4_TRIPWIRE}`,
    );
  }
});

// --- P4e THREE WAYS. The amendment's rows. ----------------------------------

// One gesture per language, reduced to (declared reach, line shape). Both rows
// below read this and neither of them knows what any reach is CALLED beyond the
// string the product hands back, nor what any line SAYS beyond its own text.
async function reachShapes() {
  const rows = [];
  for (const lang of LANGS) {
    const r = await gesture(lang);
    assert.equal(r.lines.length, 1, `CONTROL - ${lang} must log exactly one injected-context line${dump(lang, r)}`);
    const entry = FN.prefillLangFor(lang);
    assert.ok(entry && "dialReach" in entry, `CONTROL - ${lang} must expose a dialReach to compare against`);
    rows.push({ lang, reach: entry.dialReach, line: r.lines[0], shape: shapeOf(r.lines[0]) });
  }
  return rows;
}
const shapeTable = (rows) =>
  rows.map((x) => `    ${x.lang.padEnd(11)} reach=${String(x.reach).padEnd(11)}\n      ${x.line}`).join("\n");

fntest("P4e THREE WAYS: a `walk` line, a `graph` line and a `signatures` line are mutually distinguishable by their own text", async () => {
  const rows = await reachShapes();
  const byReach = new Map();
  for (const x of rows) if (!byReach.has(x.reach)) byReach.set(x.reach, x);
  const table = shapeTable(rows);
  // CONTROL. Three classifications must actually be in play, or "the three are
  // distinguishable" is a claim about a set with fewer than three members and
  // this row proves nothing. If a later phase collapses the table to two
  // classifications this row is the one that says so.
  assert.ok(
    byReach.size >= 3,
    `CONTROL - the five languages must span at least three distinct reach classifications for this row to ` +
      `have a subject; they span ${show([...byReach.keys()])}\n${table}${P4_TRIPWIRE}`,
  );
  const classes = [...byReach.values()];
  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      const a = classes[i];
      const b = classes[j];
      assert.notEqual(
        a.shape,
        b.shape,
        `a ${show(a.reach)} language (${a.lang}) and a ${show(b.reach)} language (${b.lang}) print the SAME ` +
          `line shape. The channel is where a developer learns what their setting bought, so two ` +
          `classifications that read identically mean one of them is being reported as the other.\n${table}` +
          P4_TRIPWIRE,
      );
      // Distinct is not enough on its own: distinct-only-in-the-numbers would
      // satisfy it and would be a difference in what the stop resolved to, not
      // in what the language reaches. At least one four-letter-or-longer word
      // must separate them, so the prose names a different MECHANISM.
      const aOnly = minus(wordsOf(a.shape), wordsOf(b.shape));
      const bOnly = minus(wordsOf(b.shape), wordsOf(a.shape));
      assert.ok(
        aOnly.length + bOnly.length > 0,
        `${show(a.reach)} (${a.lang}) and ${show(b.reach)} (${b.lang}) differ, but not by a single word - ` +
          `only by punctuation or by the numbers the stop resolved to. The two classifications must be ` +
          `separated by the prose naming a different mechanism.\n${table}${P4_TRIPWIRE}`,
      );
    }
  }
});

fntest("P4e THREE WAYS: the partition of languages by line shape IS the partition by declared reach", async () => {
  // The tripwire the two-way version was missing, and the reason it is written
  // as a PARTITION rather than as a per-language expectation: it needs no list
  // of which reach each language has and no idea what any of them are called.
  // It says only that two languages read the same on the channel exactly when
  // they are classified the same, and that is what breaks in every direction
  // this session can break it:
  //
  //   * python promoted to `graph` and the line left alone -> python still
  //     reads like go while their reaches differ -> RED here;
  //   * python's line rewritten and `dialReach` left alone -> python reads
  //     unlike go while their reaches agree -> RED here;
  //   * both moved together -> GREEN here and RED on the P3 table, which is the
  //     deliberate, re-cut-with-the-leg case.
  const rows = await reachShapes();
  const table = shapeTable(rows);
  assert.ok(new Set(rows.map((x) => x.reach)).size > 1, `CONTROL - reach must vary across languages\n${table}`);
  assert.ok(new Set(rows.map((x) => x.shape)).size > 1, `CONTROL - line shape must vary across languages\n${table}`);
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      const sameReach = a.reach === b.reach;
      const sameShape = a.shape === b.shape;
      if (sameReach === sameShape) continue;
      assert.fail(
        sameReach
          ? `${a.lang} and ${b.lang} are BOTH classified ${show(a.reach)}, but their channel lines have ` +
              `different shapes. One of them is telling a developer something about its reach that the other, ` +
              `identically classified, is not.\n${table}${P4_TRIPWIRE}`
          : `${a.lang} is classified ${show(a.reach)} and ${b.lang} is classified ${show(b.reach)}, and yet ` +
              `their channel lines are IDENTICAL in shape. One of the two moved and its line did not follow. ` +
              `This is the exact silent failure the amendment to contract-phase0.md P4e was written for: the ` +
              `reach table moved, the channel kept printing the old story, and without this row nothing ` +
              `anywhere turned red.\n${table}${P4_TRIPWIRE}`,
      );
    }
  }
});
