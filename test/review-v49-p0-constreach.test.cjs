// ADVERSARIAL REVIEW - session-v49 phase 0, the C# `const` widening.
//
// Drives `csQualifyStatics` over REAL C# declaration-line shapes that the blind
// oracle's fixture does not contain, hunting for lines the widened word test now
// qualifies and must not, and for `const` members it still leaves bare.
//
// Run: SKIP_LIVE=1 CI=1 node --test test/review-v49-p0-constreach.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, ".review-v49-const.entry.ts");
const OUT = path.join(__dirname, ".review-v49-const.bundle.cjs");
fs.writeFileSync(ENTRY, `export { csQualifyStatics } from "../src/core/csExtraction";\n`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node" });
const { csQualifyStatics } = require(OUT);
test.after(() => [ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

const HOVER = "class Holder";
const QUAL = "Holder.";

// One member per line, `declLine` = the index of its own line, exactly as the
// Roslyn documentSymbol leg supplies it.
function run(lines, name, signature, declLine) {
  const out = csQualifyStatics([{ name, kind: "field", signature, declLine }], HOVER, lines);
  return out[0].signature;
}

// A qualifier is only produced when the member is judged instance-unreachable.
const qualified = (sig) => sig.startsWith(QUAL);

// --- Cases the fix must catch (under-qualification) --------------------------

const MUST_QUALIFY = [
  ["plain const", `    public const string SITE = "x";`, "SITE", "SITE : string"],
  ["private const", `    private const int MAX = 5;`, "MAX", "MAX : int"],
  ["protected internal const", `    protected internal const double PI2 = 6.28;`, "PI2", "PI2 : double"],
  ["const at column 0", `const string TOP = "x";`, "TOP", "TOP : string"],
  ["const with a tab indent", `\tpublic const int T = 1;`, "T", "T : int"],
  ["new const (hiding a base const)", `    public new const int N = 2;`, "N", "N : int"],
  // Two declarators on one line: BOTH are const members and both must qualify.
  ["multi-declarator A", `    public const int A = 1, B = 2;`, "A", "A : int"],
  ["multi-declarator B", `    public const int A = 1, B = 2;`, "B", "B : int"],
];

for (const [why, line, name, sig] of MUST_QUALIFY) {
  test(`const reach: ${why} must be qualified`, () => {
    assert.equal(run([line], name, sig, 0), `${QUAL}${sig}`, `line: ${line}`);
  });
}

// --- Cases the fix must NOT catch (over-qualification) -----------------------
//
// Every line here declares a member that IS reachable through an instance.
// Qualifying it renders `Holder.field` for something that is not static, which
// is the same "does not compile" defect P1 closes, arriving from the other side.

const MUST_STAY_BARE = [
  // P1b's own family, for the control.
  ["longer identifier, lower", `    public int constantCount;`, "constantCount", "constantCount : int"],
  ["longer identifier, cased", `    public string Constants;`, "Constants", "Constants : string"],

  // THE NEW SURFACE. `const` is an ordinary English word and it now reaches
  // whatever a declaration line happens to carry - a string literal, a comment,
  // an attribute argument. `static` almost never appears in C# prose; `const`
  // does.
  ["`const` inside a string initializer", `    public string Sql = "select const from t";`, "Sql", "Sql : string"],
  [
    "`const` inside a doc/trailing comment on the decl line",
    `    public int Timeout = 30; // const in the C sense, not the C# one`,
    "Timeout",
    "Timeout : int",
  ],
  [
    "`const` inside an attribute argument on the decl line",
    `    [Description("a const value")] public int Weight;`,
    "Weight",
    "Weight : int",
  ],
  // A single-line member body that declares a LOCAL constant. The local is not a
  // member; the method it sits in is an ordinary instance method.
  [
    "a LOCAL const inside a single-line instance method body",
    `    private void Log(string m) { const string prefix = "log: "; Write(prefix + m); }`,
    "Log",
    "Log(string m) : void",
  ],
  [
    "a LOCAL const inside a single-line instance property body",
    `    public string Tag { get { const string t = "t"; return t; } }`,
    "Tag",
    "Tag : string",
  ],
];

for (const [why, line, name, sig] of MUST_STAY_BARE) {
  test(`const reach: ${why} must stay BARE`, () => {
    const got = run([line], name, sig, 0);
    assert.equal(
      qualified(got),
      false,
      `the member is reachable through an instance, so \`${QUAL}${name}\` does not compile.\n` +
        `  line:   ${line}\n  member: ${name}\n  got:    ${got}`,
    );
  });
}

// --- The verbatim identifier ------------------------------------------------

test("const reach: `@const` is an identifier, not the modifier", () => {
  const line = `    public int @const;`;
  const got = run([line], "const", "const : int", 0);
  assert.equal(qualified(got), false, `line: ${line}, got: ${got}`);
});

// --- CONTROL. The static leg on the same lines -------------------------------

test("CONTROL: the same shapes decided by `static` behave identically", () => {
  // If `static` in a string literal is ALREADY qualified today, then the string
  // hazard is pre-existing and `const` only widens its reach; if it is not, the
  // hazard is new. This row records which.
  const staticInString = run(
    [`    public string Sql = "select static from t";`],
    "Sql",
    "Sql : string",
    0,
  );
  const constInString = run([`    public string Sql = "select const from t";`], "Sql", "Sql : string", 0);
  assert.equal(
    qualified(staticInString),
    qualified(constInString),
    `the two modifiers must be read by the same rule.\n  static-in-string -> ${staticInString}\n  const-in-string  -> ${constInString}`,
  );
});

// --- ROUND 2. The `{` cut added by the phase-0 fix ---------------------------
//
// The fix erases everything from the first `{` onward, on the reasoning that a
// modifier always precedes the member's body or accessor list. That holds for a
// member declared on its own line. It does not hold when the member shares a
// line with its CONTAINER's opening brace, which is how a single-line type is
// written.

const SINGLE_LINE_CASES = [
  ["a single-line class body", `public static class Holder { public const int A = 1; }`, "A", "A : int"],
  ["a single-line struct body", `public struct Holder { public const string S = "x"; }`, "S", "S : string"],
  [
    "a static member sharing the container's brace line",
    `public class Holder { public static int Count = 0; }`,
    "Count",
    "Count : int",
  ],
];

for (const [why, line, name, sig] of SINGLE_LINE_CASES) {
  test(`const reach ROUND 2: ${why} must still be qualified`, () => {
    const got = run([line], name, sig, 0);
    assert.equal(
      got,
      `${QUAL}${sig}`,
      `the member IS a const/static and is not reachable through an instance, so leaving it bare ships the ` +
        `original P1 defect.\n  line: ${line}\n  got:  ${got}`,
    );
  });
}

test("const reach ROUND 2: an accessor list on a real static property is still read", () => {
  const line = `    public static int Total { get; set; }`;
  assert.equal(run([line], "Total", "Total : int", 0), `${QUAL}Total : int`, `line: ${line}`);
});
