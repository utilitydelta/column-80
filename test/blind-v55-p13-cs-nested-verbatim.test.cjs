// BLIND ORACLE for session-v55 phase 13 (Q16): a nested `@"…"` inside an
// interpolation hole. Bound to the phase contract and to the two exported, pure
// functions `reindentCsBody` and `dedentCsBody`. Written before the fix exists.
//
// WHAT WAS READ WHILE WRITING THIS FILE, said plainly, because the discipline is
// worth nothing unspoken. `csExtraction.ts`'s EXPORTED signatures and doc
// comments for `reindentCsBody` and `dedentCsBody`, and the eleven-line body of
// each - they are the two callers the contract names and their frozen test
// `(s.verbatim && s.holeDepth === 0) || s.raw > 0` is quoted in the contract
// itself, so nothing was learned there that the contract did not already say.
// NOT read: `advanceCsLineScan`, `skipCsRegularString`, `replyBaseIndent`,
// `dedentToZeroBase`, or the `CsLineScan` type. Every byte and every count
// pinned below was MEASURED by driving the two exported functions and, for the
// values, by running the C# they produce.
//
// THE DEFECT, in contract terms: inside an interpolated verbatim string's `{…}`
// hole, a nested `@"…"` is read with REGULAR string rules. `\` is honoured as an
// escape it does not have, and no state is carried across the line break, so a
// nested verbatim string that spans lines leaves the scan claiming "inside a
// hole". The next line is then classified as CODE and `reindentCsBody` prepends
// `indent` INSIDE a string literal, changing the value the developer wrote.
//
// Run: node --test test/blind-v55-p13-cs-nested-verbatim.test.cjs
//      SKIP_LIVE=1 node --test test/blind-v55-p13-cs-nested-verbatim.test.cjs
//
// ---------------------------------------------------------------------------
// HOW THE 300 CASES ARE GRADED, and why it is not a byte diff
// ---------------------------------------------------------------------------
//
// The defect is a changed VALUE, so the grader is the C# runtime. ONE project,
// ONE build, ONE run:
//
//   * 50 string SHAPES x 6 placement CONTEXTS = 300 cases. Each case is a method
//     BODY, written at column zero exactly as a model emits one, whose last
//     statement returns a string.
//   * Every case is emitted TWICE into the same program. `Before.CaseN` carries
//     the body's own bytes inside a method at column zero - the value the
//     developer wrote. `After.CaseN` carries `reindentCsBody(body, INDENT)`
//     placed in a real `namespace > class > method` nest at the matching
//     12-space column, first line at the cursor and the rest exactly as the
//     function produced them.
//   * `Main` prints `id \t base64(before) \t base64(after)`. A case is WRONG
//     when the two base64 strings differ. Base64 so a value containing newlines,
//     tabs or quotes survives the pipe intact.
//
// "Placed" is literal: the after-copy really sits at column 12 inside two
// enclosing scopes, so `indent` is non-empty for every one of the 300.
//
// A byte diff would be the WRONG grader and this fixture proves it. BEFORE the
// fix, a raw string (`"""`) opened inside a hole had all of its lines shifted by
// the same 12 columns, and a raw string's value is measured from the closing
// delimiter's own column - so its bytes moved and its VALUE did not, a false
// positive under any byte-level grader. The fix FREEZES those lines instead and
// row P13-7a was re-cut at triage to say so. The grader argument is unaffected:
// P13-0c is a code line shifted by 12 columns with no value change, which is the
// same separation of "bytes moved" from "value changed".
//
// ---------------------------------------------------------------------------
// FIXTURE FIDELITY, because this project has paid for a fake shape before
// ---------------------------------------------------------------------------
//
// 1. THE RIG IS PROVEN TO PRODUCE THE CASE BEFORE ANY ZERO IS BELIEVED. Row
//    P13-0b hand-corrupts one control's after-copy by prepending the same
//    12 spaces to a line that sits inside a plain `@"…"` string, and REQUIRES
//    the grader to report a changed value. Row P13-0c hand-corrupts a CODE line
//    the same way and requires the value NOT to change. A rig that cannot fail,
//    or that fails on any whitespace at all, is caught by the pair.
// 2. THE CONTEXTS ARE REAL PLACEMENTS, not decoration: bare, after a local, in
//    an `if` block (which indents the statement by four, so the string interior
//    starts non-zero), after a loop, before a use of the value, and between
//    comments. The defect is context-independent by construction, and the six
//    contexts are what make "nothing else moves" mean something.
// 3. THE VALUE IS ALWAYS RETURNED. No case throws and no case prints from
//    inside itself, so a changed value can only reach the output through the
//    string the method returns.
//
// ---------------------------------------------------------------------------
// MEASURED STATE OF EVERY ROW BEFORE ANY FIX EXISTS (working tree at 21df62a)
// ---------------------------------------------------------------------------
//
//   P13-0a  GREEN   the fixture is 300 cases, 50 shapes x 6 contexts
//   P13-0b  GREEN   POSITIVE CONTROL: the grader sees a hand-made wrong value
//   P13-0c  GREEN   NEGATIVE CONTROL: shifting a code line changes no value
//   P13-1   RED     84 of 300 values change under reindentCsBody   <-- the phase
//   P13-1b  GREEN   the value-wrong set and the byte-wrong set are the SAME 84
//   P13-2a  GREEN   round trip through dedentCsBody is identity, known base
//   P13-2b  GREEN   ... and with the base inferred (`known` omitted)
//   P13-3   GREEN   indent === "" is byte-identical on all 300
//   P13-4a  GREEN   the 192 control cases hash to today's bytes
//   P13-4b  GREEN   ten control bodies pinned byte for byte
//   P13-5   RED     string-interior lines that must be byte-exact, and are not
//   P13-6   RED     ... the same rows expressed per shape, for a readable diff
//   P13-7a  GREEN   item 7, raw `"""` in a hole: bytes move, value does not
//                   (RE-CUT AT TRIAGE after the fix - see the note below)
//   P13-7b  RED     item 7, raw `"""` in a hole CORRUPTS a later `@"…"` string
//   P13-7c  GREEN   item 7, `$"` in a hole is correct today
//   P13-7d  RED     item 7, a hole inside a nested interpolated verbatim
//
// RE-CUT AT TRIAGE, one row. The table above is the pre-fix snapshot and stays
// as measured. P13-7a was GREEN pre-fix by asserting the raw-in-hole lines were
// SHIFTED; the stack fix freezes them, which the row's own failure message named
// in advance as "a stronger fix than the row expected - re-cut the row, do not
// revert". Only that one assertion was false. The row now asserts the freeze -
// content line and closing-delimiter line both byte-exact, the statement after
// them still shifted - and it still asserts the dotnet-graded value is unchanged,
// which is what the row was ever for. Re-cut by triage, not by the implementer.
//
// The dotnet half is one project, one build, one run: 0.93 s wall on this box,
// measured three times, which is why the 302 graded methods live in a single
// program rather than in 302 invocations. A first build against a cold NuGet
// cache will be slower; the row's timeout is 600 s.
//
// P13-1, P13-5, P13-6, P13-7b and P13-7d are the phase's target. They are RED
// now and must be GREEN after. Everything else is GREEN now and must stay
// GREEN - P13-4a in particular is the "nothing else moves" gate and a fix that
// reddens it has changed a body it was never asked to touch.
//
// ---------------------------------------------------------------------------
// THE CONTRACT'S "15 wrong values in 300 placed cases" IS NOT REPRODUCED HERE
// ---------------------------------------------------------------------------
//
// Measured on THIS fixture: 84 of 300. The two numbers are not in conflict and
// neither refutes the other, because a wrong-case COUNT is a property of the
// case population, not of the product. The population behind the 15 does not
// exist: `docs/roadmap.md:1954`, `docs/queue.md:151` and claim C305 of the v53
// register all restate the figure, C305 cites three v16 artifacts as "artifacts
// behind the dotnet run", and none of those three contains the word `verbatim`,
// a case count, or any C# fixture. A repo-wide search for "placed case", "wrong
// values" and "15 of 300" finds only the four prose restatements of the claim.
// So the figure is unfalsifiable as stated and this file does not carry it.
//
// What IS reproducible is the decomposition, and it is the number worth quoting:
// 14 of the 50 shapes are wrong in every one of the 6 contexts, 6 x 14 = 84, and
// the other 36 shapes are right in all 6. The defect is shape-determined and
// context-independent, which is what a scanner bug should look like. The
// value-level count (P13-1, 84) and the byte-level count (P13-5, 84) name the
// SAME 84 cases, which is the strongest available check that the freeze
// declarations in the shape table describe the C# compiler's own reading.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v55-p13",
  `export { reindentCsBody, dedentCsBody } from "../src/core/csExtraction";\n`,
);
const { reindentCsBody, dedentCsBody } = mod;
test.after(cleanup);

// namespace > class > method > body. The after-copy really sits here.
const INDENT = "            ";

// ---------------------------------------------------------------------------
// The 50 shapes. `lines` is the statement list at column zero. `freeze` names
// the line indices (within `lines`) that sit inside a string's TEXT and must
// therefore come back byte-exact - contract items 2 and 6. A shape whose
// item-7 treatment the contract has not settled yet declares no freeze and is
// pinned by the P13-7 rows instead.
// ---------------------------------------------------------------------------

const SHAPES = [
  // ===== controls: nothing opens a string inside an interpolation hole ======
  ["c-plain", [`var s = "hello";`], []],
  ["c-verbatim-single", [`var s = @"C:\\temp\\file.txt";`], []],
  ["c-verbatim-doubled-quote", [`var s = @"say ""hi"" now";`], []],
  ["c-verbatim-2line", [`var s = @"line1`, `line2";`], [1]],
  ["c-verbatim-3line", [`var s = @"line1`, `  line2`, `line3";`], [1, 2]],
  ["c-verbatim-indented-content", [`var s = @"root`, `    child`, `        leaf";`], [1, 2]],
  ["c-verbatim-braces", [`var s = @"{ a }`, `} b {";`], [1]],
  ["c-verbatim-backslash-tail", [`var s = @"C:\\dir\\`, `sub";`], [1]],
  ["c-interp-regular", [`var s = $"n={H.N}";`], []],
  ["c-interp-verbatim-1line", [`var s = $@"n={H.N} end";`], []],
  ["c-interp-verbatim-text-2line", [`var s = $@"a{H.N}b`, `c";`], [1]],
  ["c-interp-verbatim-doubled-braces", [`var s = $@"{{lit}} {H.N}";`], []],
  ["c-interp-verbatim-escaped-quotes-2line", [`var s = $@"a""b`, `c""d{H.N}";`], [1]],
  ["c-hole-spans-lines-code-only", [`var s = $@"a{H.J(`, `"x", "y")}b";`], []],
  ["c-hole-regular-string", [`var s = $@"a{H.Fmt("x")}b";`], []],
  ["c-hole-regular-string-escapes", [`var s = $@"a{H.Fmt("q\\"z")}b";`], []],
  ["c-hole-char-quote", [`var s = $@"a{H.Fmt('"'.ToString())}b";`], []],
  ["c-hole-char-brace", [`var s = $@"a{H.Fmt('}'.ToString())}b";`], []],
  ["c-hole-nested-verbatim-1line", [`var s = $@"a{H.Fmt(@"x")}b";`, `var t = @"p`, `q";`, `s = s + t;`], [2]],
  ["c-hole-nested-verbatim-doubled-1line", [`var s = $@"a{H.Fmt(@"say ""hi""")}b";`, `var t = @"p`, `q";`, `s = s + t;`], [2]],
  ["c-hole-nested-interp-verbatim-1line", [`var s = $@"a{H.Fmt($@"b{H.N}c")}d";`, `var t = @"p`, `q";`, `s = s + t;`], [2]],
  ["c-raw-1line", [`var s = """he said "hi".""";`], []],
  ["c-raw-multi", [`var s = """`, `    alpha`, `    beta`, `    """;`], [1, 2, 3]],
  ["c-raw-multi-quotes", [`var s = """`, `    he said "hi" and {x}`, `    """;`], [1, 2]],
  ["c-raw-interp-multi", [`var s = $"""`, `    n={H.N}`, `    """;`], [1, 2]],
  ["c-raw-multi-then-verbatim-multi", [`var s = """`, `x`, `""";`, `var t = @"p`, `q";`, `s = s + t;`], [1, 2, 4]],
  ["c-line-comment-quote", [`// he said "hi and @" too`, `var s = "after";`], []],
  ["c-block-comment-quote", [`/* @" not a string */`, `var s = "after";`], []],
  ["c-verbatim-after-comment", [`// note`, `var s = @"one`, `two";`], [2]],
  ["c-array-multi", [`var parts = new[]`, `{`, `    "p",`, `    "q",`, `};`, `var s = string.Concat(parts);`], []],
  ["c-verbatim-multi-then-code", [`var s = @"x`, `y";`, `var up = H.Up(s);`, `s = s + up;`], [1]],
  ["c-hole-ternary", [`var s = $@"a{(H.N > 3 ? "big" : "small")}b";`], []],

  // ===== the target family: a string opens INSIDE an interpolation hole =====
  ["t-nested-verbatim-2line", [`var s = $@"a{H.Fmt(@"x`, `Y")}b";`], [1]],
  ["t-nested-verbatim-3line", [`var s = $@"a{H.Fmt(@"x`, `Y`, `Z")}b";`], [1, 2]],
  ["t-nested-verbatim-doubled-quote", [`var s = $@"a{H.Fmt(@"say ""hi""`, `again")}b";`], [1]],
  ["t-nested-verbatim-backslash-tail", [`var s = $@"a{H.Fmt(@"C:\\dir\\`, `sub")}b";`], [1]],
  ["t-nested-verbatim-braces", [`var s = $@"a{H.Fmt(@"{ p }`, `} q {")}b";`], [1]],
  ["t-nested-verbatim-indented", [`var s = $@"a{H.Fmt(@"root`, `    child")}b";`], [1]],
  ["t-nested-interp-verbatim-2line", [`var s = $@"a{H.Fmt($@"b`, `c")}d";`], [1]],
  ["t-nested-interp-verbatim-hole-on-line2", [`var s = $@"a{H.Fmt($@"b`, `{H.N}c")}d";`], [1]],
  ["t-nested-verbatim-1line-backslash-then-verbatim-multi", [`var s = $@"a{H.Fmt(@"C:\\dir\\")}b";`, `var t = @"p`, `q";`, `s = s + t;`], [2]],
  ["t-nested-verbatim-in-nested-hole", [`var s = $@"a{H.Fmt($@"b{H.Fmt(@"c`, `d")}e")}f";`], [1]],
  ["t-nested-verbatim-2line-second-hole", [`var s = $@"a{H.Fmt(@"p`, `q")}m{H.N}n";`], [1]],
  ["t-nested-verbatim-2line-then-verbatim-multi", [`var s = $@"a{H.Fmt(@"x`, `Y")}b";`, `var t = @"p`, `q";`, `s = s + t;`], [1, 3]],
  // item 7's three constructs. `freeze` is deliberately empty on the two whose
  // treatment the contract must still DECLARE; what they do today is pinned by
  // P13-7. The freeze indices that ARE declared below belong to a plain
  // top-level `@"…"` string standing after the construct, which no declaration
  // can put out of scope - that one is contract item 6.
  ["t-raw-in-hole-multi", [`var s = $@"a{H.Fmt("""`, `x`, `""")}b";`], []],
  ["t-raw-in-hole-then-verbatim-multi", [`var s = $@"a{H.Fmt("""`, `x`, `""")}b";`, `var t = @"p`, `q";`, `s = s + t;`], [4]],
  ["t-raw-in-hole-quotes-then-verbatim-multi", [`var s = $@"a{H.Fmt("""`, `he said "hi"`, `""")}b";`, `var t = @"p`, `q";`, `s = s + t;`], [4]],
  ["t-dollar-string-in-hole", [`var s = $@"a{H.Fmt($"x{H.N}")}b";`], []],
  ["t-dollar-string-in-hole-then-verbatim-multi", [`var s = $@"a{H.Fmt($"x{H.N}")}b";`, `var t = @"p`, `q";`, `s = s + t;`], [2]],
  ["t-dollar-string-in-hole-nested-quote-then-verbatim-multi", [`var s = $@"a{H.Fmt($"x{"y"}")}b";`, `var t = @"p`, `q";`, `s = s + t;`], [2]],
];

// ---------------------------------------------------------------------------
// The 6 placement contexts. `head` is prepended, `tail` appended, and `indent4`
// says whether the statement itself is nested one level - which shifts the
// string interior lines too, exactly as a model's own output would.
// ---------------------------------------------------------------------------

const CONTEXTS = [
  ["bare", [], [`return s;`], false],
  ["after-local", [`var pre = "p:";`], [`return pre + s;`], false],
  ["in-if", [`if (H.N > 0)`, `{`], [`    return s;`, `}`, `return "";`], true],
  ["after-loop", [`var acc = 0;`, `foreach (var q in new[] { 1, 2 })`, `{`, `    acc += q;`, `}`], [`return s + acc;`], false],
  ["before-use", [], [`var zEnd = s + "/end";`, `return zEnd;`], false],
  ["with-comments", [`// leading`], [`/* trailing */`, `return s;`], false],
];

function buildCases() {
  const out = [];
  for (const [shape, lines, freeze] of SHAPES) {
    for (const [context, head, tail, indent4] of CONTEXTS) {
      const stmt = indent4 ? lines.map((l) => (l === "" ? l : "    " + l)) : lines;
      out.push({
        id: out.length,
        shape,
        context,
        body: [...head, ...stmt, ...tail].join("\n"),
        // freeze indices move by the head's length; the context never inserts a
        // line inside the statement, so the shift is a constant.
        freeze: freeze.map((i) => i + head.length),
      });
    }
  }
  return out;
}

const CASES = buildCases();
const AFTER = CASES.map((c) => reindentCsBody(c.body, INDENT));

// ---------------------------------------------------------------------------
// P13-0a. The fixture itself.
// ---------------------------------------------------------------------------

test("P13-0a the fixture is 300 placed cases, 50 shapes x 6 contexts", () => {
  assert.equal(SHAPES.length, 50, "shape count");
  assert.equal(CONTEXTS.length, 6, "context count");
  assert.equal(CASES.length, 300, "300 placed cases");
  assert.equal(new Set(SHAPES.map((s) => s[0])).size, 50, "every shape name is distinct");
  // Every case must really be PLACED: the reindent has to have had somewhere to
  // put the indent, i.e. a body of more than one line.
  for (const c of CASES) {
    assert.ok(c.body.split("\n").length >= 2, `${c.shape}/${c.context} is a one-line body, so nothing is placed`);
  }
  // And the freeze declarations must point at real lines.
  for (const c of CASES) {
    const n = c.body.split("\n").length;
    for (const i of c.freeze) assert.ok(i > 0 && i < n, `${c.shape}/${c.context} freeze index ${i} is out of range`);
  }
});

// ---------------------------------------------------------------------------
// The dotnet grader. ONE project, ONE build, ONE run, memoised.
// ---------------------------------------------------------------------------

const dotnetPresent = spawnSync("dotnet", ["--version"], { encoding: "utf8" }).status === 0;
const SKIP = process.env.SKIP_LIVE
  ? "SKIP_LIVE set"
  : !dotnetPresent
    ? "no dotnet SDK on PATH"
    : false;

// Two extra pairs beyond the 300, ids 900 and 901: the rig's own controls.
// 900: a plain multi-line `@"…"` whose interior line is hand-shifted. The value
//      MUST change - if it does not, this grader cannot see the defect at all.
// 901: the same body with a CODE line hand-shifted. The value must NOT change.
const PC_BODY = [`var s = @"line1`, `line2";`, `return s;`].join("\n");
const PC_WRONG = [`var s = @"line1`, INDENT + `line2";`, INDENT + `return s;`].join("\n");
const PC_RIGHT = [`var s = @"line1`, `line2";`, INDENT + `return s;`].join("\n");

function csProgram() {
  const method = (cls, id, body) => {
    const lines = body.split("\n");
    const rest = lines.slice(1);
    return [
      `        public static string ${cls}${id}()`,
      `        {`,
      lines[0],
      ...rest,
      `        }`,
    ].join("\n");
  };
  // The before-copy sits at column zero inside its method: C# does not care,
  // and it is the developer's own bytes, untouched.
  const beforeM = CASES.map((c) => method("Case", c.id, c.body)).join("\n");
  // The after-copy is really placed: first line at the cursor column, the rest
  // exactly as reindentCsBody produced them.
  const afterM = CASES.map((c, i) => method("Case", c.id, INDENT + AFTER[i])).join("\n");
  const pcBefore = [method("Case", 900, PC_BODY), method("Case", 901, PC_BODY)].join("\n");
  const pcAfter = [method("Case", 900, INDENT + PC_WRONG), method("Case", 901, INDENT + PC_RIGHT)].join("\n");
  const calls = [...CASES.map((c) => c.id), 900, 901]
    .map((id) => `            Emit(${id}, Before.Case${id}(), After.Case${id}());`)
    .join("\n");
  return `using System;
using System.Text;

namespace Cases
{
    public static class H
    {
        public static int N = 7;
        public static string Fmt(string x) => "<" + x + ">";
        public static string Up(string x) => x.ToUpperInvariant();
        public static string J(string a, string b) => a + "|" + b;
    }

    public static class Before
    {
${beforeM}
${pcBefore}
    }

    public static class After
    {
${afterM}
${pcAfter}
    }

    public static class Program
    {
        static void Emit(int id, string b, string a)
        {
            Console.WriteLine(id + "\\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(b)) + "\\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(a)));
        }

        public static void Main()
        {
${calls}
        }
    }
}
`;
}

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>disable</Nullable>
    <LangVersion>latest</LangVersion>
    <AssemblyName>p</AssemblyName>
    <RootNamespace>Cases</RootNamespace>
    <StartupObject>Cases.Program</StartupObject>
  </PropertyGroup>
</Project>
`;

let GRADED = null;
function grade() {
  if (GRADED) return GRADED;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v55-p13-"));
  try {
    fs.writeFileSync(path.join(dir, "Program.cs"), csProgram());
    fs.writeFileSync(path.join(dir, "p.csproj"), CSPROJ);
    const t0 = Date.now();
    const run = spawnSync("dotnet", ["run", "--project", path.join(dir, "p.csproj")], {
      encoding: "utf8",
      cwd: dir,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_NOLOGO: "1",
        DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
      },
    });
    const ms = Date.now() - t0;
    assert.equal(
      run.status,
      0,
      `dotnet run failed (${run.status}); the fixture must COMPILE before it can grade\n${(run.stdout || "").slice(-4000)}\n${(run.stderr || "").slice(-2000)}`,
    );
    const values = new Map();
    for (const line of run.stdout.trim().split("\n")) {
      const [id, before, after] = line.split("\t");
      if (id === undefined || after === undefined) continue;
      values.set(Number(id), { before, after });
    }
    console.log(`[P13] dotnet build+run of ${values.size} graded methods: ${ms} ms`);
    GRADED = { values, ms };
    return GRADED;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// P13-0b / P13-0c. The rig can produce the case. "Instrument must produce the
// case": a zero from a rig that cannot make the case fire is a fact about the
// rig, so this runs BEFORE the count is believed.
// ---------------------------------------------------------------------------

test("P13-0b POSITIVE CONTROL: a hand-shifted line inside @\"…\" IS graded wrong", { skip: SKIP, timeout: 600_000 }, () => {
  const g = grade();
  const pc = g.values.get(900);
  assert.ok(pc, "the positive control did not reach the output");
  assert.notEqual(
    pc.before,
    pc.after,
    "the grader did not notice 12 spaces prepended inside a verbatim string - it cannot see the defect at all, and every zero it reports is a fact about the rig",
  );
});

test("P13-0c NEGATIVE CONTROL: a hand-shifted CODE line changes no value", { skip: SKIP, timeout: 600_000 }, () => {
  const g = grade();
  const pc = g.values.get(901);
  assert.ok(pc, "the negative control did not reach the output");
  assert.equal(pc.before, pc.after, "indenting a code line must not change any value; this grader is diffing bytes, not values");
});

// ---------------------------------------------------------------------------
// P13-1. THE PHASE. 300 placed cases, graded by running the C#.
// ---------------------------------------------------------------------------

test("P13-1 every one of the 300 placed cases keeps its value through reindentCsBody", { skip: SKIP, timeout: 600_000 }, () => {
  const g = grade();
  assert.equal(g.values.size, 302, "300 cases plus the two rig controls must all reach the output");
  const wrong = [];
  for (const c of CASES) {
    const v = g.values.get(c.id);
    assert.ok(v, `case ${c.id} (${c.shape}/${c.context}) produced no output`);
    if (v.before !== v.after) wrong.push(c);
  }
  const byShape = new Map();
  for (const c of wrong) byShape.set(c.shape, (byShape.get(c.shape) || 0) + 1);
  const detail = [...byShape.entries()].map(([s, n]) => `  ${s}: ${n}/6`).join("\n");
  const sample = wrong[0]
    ? `\nfirst wrong case ${wrong[0].id} (${wrong[0].shape}/${wrong[0].context}):\n--- written ---\n${wrong[0].body}\n--- after reindent ---\n${AFTER[wrong[0].id]}\n--- value written ---\n${JSON.stringify(Buffer.from(g.values.get(wrong[0].id).before, "base64").toString("utf8"))}\n--- value after ---\n${JSON.stringify(Buffer.from(g.values.get(wrong[0].id).after, "base64").toString("utf8"))}`
    : "";
  assert.equal(
    wrong.length,
    0,
    `${wrong.length} of 300 placed cases changed VALUE, across ${byShape.size} shapes:\n${detail}${sample}`,
  );
});

test("P13-1b the C# compiler agrees with the shape table: same cases wrong both ways", { skip: SKIP, timeout: 600_000 }, () => {
  const g = grade();
  const byValue = new Set();
  const byBytes = new Set();
  for (let i = 0; i < CASES.length; i++) {
    const v = g.values.get(CASES[i].id);
    if (v.before !== v.after) byValue.add(CASES[i].id);
    if (frozenViolations(CASES[i], AFTER[i]).length) byBytes.add(CASES[i].id);
  }
  // The `freeze` column of the shape table is a hand declaration of which lines
  // the C# compiler treats as string TEXT. If it were wrong anywhere, a case
  // would appear in one set and not the other. Both sets are empty after the
  // fix, so this row is an equality that holds in both worlds - and today it is
  // the check that the 84 is not an artefact of my own reading of C#.
  const only = (a, b) => [...a].filter((x) => !b.has(x)).map((id) => `${CASES[id].shape}/${CASES[id].context}`);
  assert.deepEqual(only(byValue, byBytes), [], "a case changed VALUE but the shape table declared no frozen line for it");
  assert.deepEqual(only(byBytes, byValue), [], "a case moved a declared-frozen line and yet its value survived; the declaration is wrong, or the shift was uniform");
});

// ---------------------------------------------------------------------------
// P13-2. Contract item 4: the two directions still agree. The round trip is
// identity on every case, including every wrong one.
// ---------------------------------------------------------------------------

test("P13-2a round trip with the known base is identity on all 300", () => {
  const bad = [];
  for (let i = 0; i < CASES.length; i++) {
    if (dedentCsBody(AFTER[i], INDENT) !== CASES[i].body) bad.push(CASES[i]);
  }
  assert.deepEqual(bad.map((c) => `${c.shape}/${c.context}`), [], "dedentCsBody(reindentCsBody(x, indent), indent) must be x");
});

test("P13-2b round trip with the base inferred is identity on all 300", () => {
  const bad = [];
  for (let i = 0; i < CASES.length; i++) {
    if (dedentCsBody(AFTER[i]) !== CASES[i].body) bad.push(CASES[i]);
  }
  assert.deepEqual(bad.map((c) => `${c.shape}/${c.context}`), [], "dedentCsBody(reindentCsBody(x, indent)) must be x with `known` omitted too");
});

// ---------------------------------------------------------------------------
// P13-3. Contract item 5: an empty indent is byte-identical.
// ---------------------------------------------------------------------------

test("P13-3 indent === \"\" returns the input byte for byte on all 300", () => {
  const bad = [];
  for (const c of CASES) {
    if (reindentCsBody(c.body, "") !== c.body) bad.push(`${c.shape}/${c.context}`);
  }
  assert.deepEqual(bad, [], "the empty-indent early return must not be disturbed");
});

// ---------------------------------------------------------------------------
// P13-4. Contract item 6: nothing else moves. The 192 control cases keep
// today's bytes exactly.
// ---------------------------------------------------------------------------

const CONTROL_IDS = CASES.filter((c) => c.shape.startsWith("c-")).map((c) => c.id);

test("P13-4a the 192 control cases re-indent to today's bytes, hashed", () => {
  assert.equal(CONTROL_IDS.length, 192, "32 control shapes x 6 contexts");
  const h = crypto.createHash("sha256");
  for (const id of CONTROL_IDS) h.update(`${CASES[id].shape}/${CASES[id].context}\u0000${AFTER[id]}\u0001`);
  const got = h.digest("hex");
  assert.equal(
    got,
    "92286951b7c081177b466296d2738563c0aef974b74aae31615d1dd59f564704",
    `a body with no string opening inside an interpolation hole re-indented differently than it does today; got ${got}. If this reddens with a fix, the fix moved a body it was never asked to touch`,
  );
});

const PIN = {
  "c-verbatim-2line/bare": [`var s = @"line1`, `line2";`, INDENT + `return s;`],
  "c-verbatim-3line/bare": [`var s = @"line1`, `  line2`, `line3";`, INDENT + `return s;`],
  "c-hole-spans-lines-code-only/bare": [`var s = $@"a{H.J(`, INDENT + `"x", "y")}b";`, INDENT + `return s;`],
  "c-interp-verbatim-text-2line/bare": [`var s = $@"a{H.N}b`, `c";`, INDENT + `return s;`],
  "c-hole-nested-verbatim-1line/bare": [`var s = $@"a{H.Fmt(@"x")}b";`, INDENT + `var t = @"p`, `q";`, INDENT + `s = s + t;`, INDENT + `return s;`],
  "c-hole-nested-verbatim-doubled-1line/bare": [`var s = $@"a{H.Fmt(@"say ""hi""")}b";`, INDENT + `var t = @"p`, `q";`, INDENT + `s = s + t;`, INDENT + `return s;`],
  "c-raw-multi/bare": [`var s = """`, `    alpha`, `    beta`, `    """;`, INDENT + `return s;`],
  "c-raw-multi-then-verbatim-multi/bare": [`var s = """`, `x`, `""";`, INDENT + `var t = @"p`, `q";`, INDENT + `s = s + t;`, INDENT + `return s;`],
  "c-verbatim-after-comment/bare": [`// note`, INDENT + `var s = @"one`, `two";`, INDENT + `return s;`],
  "c-array-multi/bare": [
    `var parts = new[]`,
    INDENT + `{`,
    INDENT + `    "p",`,
    INDENT + `    "q",`,
    INDENT + `};`,
    INDENT + `var s = string.Concat(parts);`,
    INDENT + `return s;`,
  ],
};

test("P13-4b ten control bodies pinned byte for byte", () => {
  for (const [key, want] of Object.entries(PIN)) {
    const c = CASES.find((x) => `${x.shape}/${x.context}` === key);
    assert.ok(c, `pin ${key} names no case`);
    assert.equal(AFTER[c.id], want.join("\n"), `${key} re-indented differently`);
  }
});

// ---------------------------------------------------------------------------
// P13-5 / P13-6. Contract item 2: a line whose start is inside a string's TEXT
// is byte-exact. This is the same defect at the byte level, and it is the row
// that still runs when dotnet is unavailable or SKIP_LIVE is set.
// ---------------------------------------------------------------------------

function frozenViolations(c, after) {
  const src = c.body.split("\n");
  const out = after.split("\n");
  const bad = [];
  for (const i of c.freeze) {
    if (out[i] !== src[i]) bad.push({ line: i, was: src[i], now: out[i] });
  }
  return bad;
}

test("P13-5 every line inside a string's TEXT comes back byte-exact", () => {
  const offenders = [];
  for (let i = 0; i < CASES.length; i++) {
    const bad = frozenViolations(CASES[i], AFTER[i]);
    if (bad.length) offenders.push(`${CASES[i].shape}/${CASES[i].context} line ${bad[0].line}: ${JSON.stringify(bad[0].was)} -> ${JSON.stringify(bad[0].now)}`);
  }
  assert.equal(
    offenders.length,
    0,
    `${offenders.length} cases moved a line that is a string's own value:\n${offenders.slice(0, 12).join("\n")}${offenders.length > 12 ? `\n... and ${offenders.length - 12} more` : ""}`,
  );
});

test("P13-6 per shape: the nested-verbatim family freezes its continuation lines", () => {
  const byShape = [];
  for (const [shape, , freeze] of SHAPES) {
    if (freeze.length === 0) continue;
    const cs = CASES.filter((c) => c.shape === shape);
    const broken = cs.filter((c) => frozenViolations(c, AFTER[c.id]).length > 0);
    if (broken.length) byShape.push(`${shape}: ${broken.length}/6 contexts`);
  }
  assert.deepEqual(byShape, [], "these shapes re-indent inside a string literal");
});

// ---------------------------------------------------------------------------
// P13-7. Contract item 7's three constructs, MEASURED. Each row pins what the
// construct does today so the contract's "handled or out of scope" declaration
// is made against a fact rather than a guess.
// ---------------------------------------------------------------------------

const caseOf = (shape, context) => CASES.find((c) => c.shape === shape && c.context === context);

test("P13-7a item 7 (i): a raw \"\"\" opened in a hole is FROZEN, and keeps its VALUE", { skip: SKIP, timeout: 600_000 }, () => {
  const g = grade();
  const c = caseOf("t-raw-in-hole-multi", "bare");
  const src = c.body.split("\n");
  const out = AFTER[c.id].split("\n");
  // The construct is HANDLED now, not lucky. Every line of the raw string comes
  // back byte-exact - its content AND its closing delimiter - exactly as a
  // top-level raw string's lines already did.
  assert.equal(out[1], src[1], "the raw string's content line is frozen");
  assert.equal(out[2], src[2], "the raw string's closing-delimiter line is frozen");
  // Code around it still moves, so this is not a whole-body no-op.
  assert.equal(out[3], INDENT + src[3], "the statement after the string is code and shifts");
  assert.notEqual(AFTER[c.id], c.body, "the body as a whole is not returned unchanged");
  // And the VALUE survives, now BECAUSE the closing delimiter did not move: a
  // raw string measures its own indentation from that delimiter. Before the fix
  // it survived only because every line moved by the same amount.
  const v = g.values.get(c.id);
  assert.equal(v.before, v.after, "a frozen raw string keeps its value");
});

test("P13-7b item 7 (i): ... but it CORRUPTS a plain @\"…\" string standing after it", { skip: SKIP, timeout: 600_000 }, () => {
  const g = grade();
  for (const shape of ["t-raw-in-hole-then-verbatim-multi", "t-raw-in-hole-quotes-then-verbatim-multi"]) {
    for (const [context] of CONTEXTS) {
      const c = caseOf(shape, context);
      const v = g.values.get(c.id);
      assert.equal(
        v.before,
        v.after,
        `${shape}/${context}: a later, unrelated verbatim string lost its value. Whatever the contract declares about a raw string inside a hole, contract item 6 does not let it damage the next literal`,
      );
    }
  }
});

test("P13-7c item 7 (ii): a $\"…\" regular interpolated string in a hole is correct today", { skip: SKIP, timeout: 600_000 }, () => {
  const g = grade();
  for (const shape of ["t-dollar-string-in-hole", "t-dollar-string-in-hole-then-verbatim-multi", "t-dollar-string-in-hole-nested-quote-then-verbatim-multi"]) {
    for (const [context] of CONTEXTS) {
      const c = caseOf(shape, context);
      const v = g.values.get(c.id);
      assert.equal(v.before, v.after, `${shape}/${context} changed value`);
    }
  }
  // And the reason it is correct: a regular string cannot span a line, so the
  // hole is closed before the line break and no state has to survive it. The
  // frozen line after it is proof the scan is still in step.
  const c = caseOf("t-dollar-string-in-hole-then-verbatim-multi", "bare");
  assert.deepEqual(frozenViolations(c, AFTER[c.id]), [], "the following verbatim string's interior stayed byte-exact");
});

test("P13-7d item 7 (iii): a hole inside a nested interpolated verbatim string", { skip: SKIP, timeout: 600_000 }, () => {
  const g = grade();
  for (const shape of ["t-nested-interp-verbatim-hole-on-line2", "t-nested-verbatim-in-nested-hole"]) {
    for (const [context] of CONTEXTS) {
      const c = caseOf(shape, context);
      const v = g.values.get(c.id);
      assert.equal(
        v.before,
        v.after,
        `${shape}/${context}: $@"a{$@"b\n{c}"}" - the contract may declare arbitrary nesting out of scope, but ONE level of it is the shape the flag pair is supposed to cover`,
      );
    }
  }
});

// The byte-level half of P13-7d, so the construct is still witnessed when
// dotnet is unavailable.
test("P13-7d-bytes item 7 (iii) without dotnet: the nested interpolated verbatim's text line", () => {
  for (const shape of ["t-nested-interp-verbatim-hole-on-line2", "t-nested-verbatim-in-nested-hole"]) {
    const c = caseOf(shape, "bare");
    assert.deepEqual(
      frozenViolations(c, AFTER[c.id]).map((b) => `line ${b.line}: ${JSON.stringify(b.was)} -> ${JSON.stringify(b.now)}`),
      [],
      `${shape} moved a line that is a nested interpolated verbatim string's own text`,
    );
  }
});
