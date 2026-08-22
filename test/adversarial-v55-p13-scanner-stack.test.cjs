// ADVERSARIAL REVIEW, session-v55 phase 13 (Q16). Evidence for the review of the
// `advanceCsLineScan` flag-set -> context-STACK change in `src/core/csExtraction.ts`.
//
// Every row here was produced by RUNNING something: `dotnet` (10.0.110) over C#
// this file emits, or a differential fuzz against the pre-change scanner taken
// from the git blob rather than retyped.
//
// Run: node --test test/adversarial-v55-p13-scanner-stack.test.cjs
//      SKIP_LIVE=1 node --test test/adversarial-v55-p13-scanner-stack.test.cjs
//
// ---------------------------------------------------------------------------
// WHY THE OLD SCANNER IS BUNDLED FROM GIT AND NOT TRANSCRIBED
// ---------------------------------------------------------------------------
// The differential rows need the PRE-change behaviour. `git show HEAD:...` of
// `csExtraction.ts` is dropped into a copy of `src/`, bundled, and required, so
// the comparison runs the real prior implementation. A hand transcription was
// written first and cross-checked against this blob over 300000 random bodies
// with zero mismatches; the blob is what ships here because it cannot drift.
//
// ---------------------------------------------------------------------------
// THE P13-7a RULING (row A13-1)
// ---------------------------------------------------------------------------
// `blind-v55-p13-cs-nested-verbatim.test.cjs` row P13-7a pinned pre-fix
// behaviour for a raw `"""` opened inside an interpolation hole: "moves its
// bytes and keeps its VALUE". The fix FREEZES those lines. The row's own
// message authorises a re-cut and this file supplies it, verified: the value is
// preserved, and preserved for a BETTER reason than before. A raw string
// measures its indentation from its CLOSING delimiter, and the closing
// delimiter's line is frozen along with the content lines, because the scan is
// still carrying the raw context when it classifies that line. So the thing
// that decides the value never moves. Before the fix the value survived only
// because every line moved by the same amount.
//
// The exact replacement row text is in the block comment above A13-1.
//
// ---------------------------------------------------------------------------
// WHAT WAS ATTACKED AND HELD (the numbers, all measured below)
// ---------------------------------------------------------------------------
//   A13-2  216 placed cases (36 shapes x 6 contexts), graded by dotnet:
//          0 values wrong under the new scanner, 54 wrong under the old.
//   A13-3  1.2M random control-shaped bodies over 6 opener configurations: the
//          freeze mask diverges from the old scanner on an exact, pinned count
//          per configuration. Was a blanket "they agree on every line", then a
//          `$"` boundary that turned out to be a fact about the token list.
//   A13-4  the ONE freeze-losing divergence in 400000 mixed random bodies,
//          pinned - and dotnet REJECTS that body, so it is not C#.
//   A13-5  200000 reindent/dedent round trips, known base and inferred: identity.
//   A13-6  pathological input: 13 shapes including 10k lines, a 200k-char line,
//          a 5000-quote run and 200-deep nesting. No throw, no hang.
//
// ---------------------------------------------------------------------------
// THE PRE-EXISTING DEFECTS THIS PHASE FOUND, CLOSED BY SESSION-v59 PHASE 5
// ---------------------------------------------------------------------------
// All were filed as roadmap item 60 and the rows below were INVERTED to pin the
// fix. The rows asserting the defect are gone on purpose; a row that goes red
// because the defect came back is the point.
//
//   A13-7  a raw INTERPOLATED string (`$"""`) whose hole holds a run of >= fence
//          quotes: the scan closed the raw string early and `reindentCsBody`
//          emitted C# THAT DID NOT COMPILE (CS8999). `CsStrCtx` now carries a
//          raw string's `$` count and a real hole depth. A13-7b covers the other
//          half: a hole that spans lines.
//   A13-8  a `@"..."` inside a `$"..."` (non-verbatim interpolated) hole was not
//          modelled at all, so the quote count desynchronised and a later
//          string's value changed. `$"` is now on the one shared opener list and
//          pushes a tracked context. A13-8b is the same shape at statement level,
//          where it was triaged.
//   A13-10 a `//` or `/* */` inside a hole was not read, so a quote written in
//          the comment opened a context the compiler never sees. Giving `$"` an
//          opener and raw strings real holes carried that gap into the shapes
//          where real C# writes a multi-line interpolation, and CS8999 came
//          back. Comments are read inside a hole now. A13-10b pins which shapes
//          this was a REGRESSION in and which were already broken.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const REPO = path.join(__dirname, "..");
const INDENT = "            "; // namespace > class > method > body

const { mod, cleanup } = bundleCore(
  "adversarial-v55-p13",
  `export { reindentCsBody, dedentCsBody } from "../src/core/csExtraction";\n`,
);
const { reindentCsBody, dedentCsBody } = mod;

// --- the PRE-change scanner, bundled from the git blob -----------------------
// Pinned to the COMMIT, not to HEAD: HEAD stops being the pre-change scanner
// the moment this phase commits, and a differential row that quietly compares a
// thing to itself is worse than one that fails.
const OLD_COMMIT = "1bb7897f1b4330795f2369f45a215d34bdc395be";
const OLD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "adv-v55-p13-old-"));
fs.cpSync(path.join(REPO, "src"), path.join(OLD_DIR, "src"), { recursive: true });
const blob = spawnSync("git", ["-C", REPO, "cat-file", "-p", `${OLD_COMMIT}:src/core/csExtraction.ts`], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
if (blob.status !== 0) {
  // Loud, not skipped: without the blob every differential row below is vacuous.
  throw new Error(`cannot read ${OLD_COMMIT}:src/core/csExtraction.ts - the differential rows have no baseline\n${blob.stderr}`);
}
fs.writeFileSync(path.join(OLD_DIR, "src/core/csExtraction.ts"), blob.stdout);
fs.writeFileSync(
  path.join(OLD_DIR, "entry.ts"),
  `export { reindentCsBody, dedentCsBody } from "./src/core/csExtraction";\n`,
);
esbuild.buildSync({
  entryPoints: [path.join(OLD_DIR, "entry.ts")],
  bundle: true,
  outfile: path.join(OLD_DIR, "b.cjs"),
  format: "cjs",
  platform: "node",
});
const OLD = require(path.join(OLD_DIR, "b.cjs"));

test.after(() => {
  cleanup();
  fs.rmSync(OLD_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The dotnet grader. ONE project, ONE build, ONE run, memoised: the same shape
// the blind oracle uses, extended to carry the OLD copy alongside the new so a
// value that moves can be attributed.
// ---------------------------------------------------------------------------

const dotnetPresent = spawnSync("dotnet", ["--version"], { encoding: "utf8" }).status === 0;
const SKIP = process.env.SKIP_LIVE ? "SKIP_LIVE set" : !dotnetPresent ? "no dotnet SDK on PATH" : false;

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>disable</Nullable>
    <LangVersion>latest</LangVersion>
    <AssemblyName>p</AssemblyName>
  </PropertyGroup>
</Project>
`;

function method(cls, id, body) {
  return [`        public static string ${cls}${id}()`, `        {`, ...body.split("\n"), `        }`].join("\n");
}

function csProgram(cases) {
  const before = cases.map((c) => method("Case", c.id, c.body)).join("\n");
  const nu = cases.map((c) => method("Case", c.id, INDENT + reindentCsBody(c.body, INDENT))).join("\n");
  const ol = cases.map((c) => method("Case", c.id, INDENT + OLD.reindentCsBody(c.body, INDENT))).join("\n");
  const calls = cases
    .map((c) => `            Emit(${c.id}, Before.Case${c.id}(), NewA.Case${c.id}(), OldA.Case${c.id}());`)
    .join("\n");
  return `using System;
using System.Text;
namespace Cases {
  public static class H { public static int N = 7;
    public static string Fmt(string x) => "<" + x + ">";
    public static string Up(string x) => x.ToUpperInvariant();
    public static string J(string a, string b) => a + "|" + b; }
  public static class Before {
${before}
  }
  public static class NewA {
${nu}
  }
  public static class OldA {
${ol}
  }
  public static class Program {
    static void Emit(int id, string b, string n, string o) {
      Console.WriteLine(id + "\\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(b)) + "\\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(n)) + "\\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(o)));
    }
    public static void Main() {
${calls}
    }
  }
}
`;
}

/** Compile+run a C# source; returns { status, stdout, stderr }. */
function dotnetRun(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adv-v55-p13-"));
  try {
    fs.writeFileSync(path.join(dir, "Program.cs"), source);
    fs.writeFileSync(path.join(dir, "p.csproj"), CSPROJ);
    const r = spawnSync("dotnet", ["run", "--project", path.join(dir, "p.csproj")], {
      encoding: "utf8",
      cwd: dir,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
    });
    return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The graded population: 36 shapes x 6 placement contexts = 216 placed cases.
// Statement lists only; the context supplies the head, the tail and the extra
// four columns for the nested one. `s` always holds the value under test.
// ---------------------------------------------------------------------------

const SHAPES = [
  // --- a raw string opened INSIDE an interpolation hole (the P13-7a subject) --
  ["R1-raw-hole-col0", [`var s = $@"a{H.Fmt("""`, `x`, `""")}b";`]],
  ["R2-raw-hole-indented", [`var s = $@"a{H.Fmt("""`, `    x`, `    """)}b";`]],
  ["R3-raw-hole-deeper-content", [`var s = $@"a{H.Fmt("""`, `        x`, `    """)}b";`]],
  ["R4-raw-hole-fence4", [`var s = $@"a{H.Fmt(""""`, `    he """ said`, `    """")}b";`]],
  ["R5-raw-hole-quotes", [`var s = $@"a{H.Fmt("""`, `    he said "hi"`, `    """)}b";`]],
  ["R6-raw-hole-then-verbatim", [`var s = $@"a{H.Fmt("""`, `    x`, `    """)}b";`, `var t6 = @"p`, `q";`, `s = s + t6;`]],
  ["R7-raw-interp-in-hole", [`var s = $@"a{H.Fmt($"""`, `    n={H.N}`, `    """)}b";`]],
  ["R8-raw-hole-then-code-line", [`var s = $@"a{H.J("""`, `    x`, `    """,`, `    "y")}b";`]],
  ["R9-raw-hole-multiline-value", [`var s = $@"a{H.Fmt("""`, `    one`, `      two`, `    three`, `    """)}b";`]],
  ["R10-raw-hole-tab-indent", [`var s = $@"a{H.Fmt("""`, `\tx`, `\t""")}b";`]],
  ["R11-raw-hole-opener-line-frozen", [`var s = $@"a`, `{H.Fmt("""`, `    x`, `    """)}b";`]],
  ["R12-raw-hole-two-in-a-row", [`var s = $@"a{H.Fmt("""`, `    x`, `    """)}b{H.Fmt("""`, `    y`, `    """)}c";`]],
  // --- constructs that were already CORRECT: the fix must not redden them -----
  ["C1-dollar-in-hole", [`var s = $@"a{H.Fmt($"x{H.N}")}b";`, `var t1 = @"p`, `q";`, `s = s + t1;`]],
  ["C2-dollar-in-hole-nested-quote", [`var s = $@"a{H.Fmt($"x{"y"}")}b";`, `var t2 = @"p`, `q";`, `s = s + t2;`]],
  ["C3-char-quote-in-hole", [`var s = $@"a{H.Fmt('"'.ToString())}b";`, `var t3 = @"p`, `q";`, `s = s + t3;`]],
  ["C4-char-brace-in-hole", [`var s = $@"a{H.Fmt('}'.ToString())}b";`, `var t4 = @"p`, `q";`, `s = s + t4;`]],
  ["C5-char-escaped-quote-in-hole", [`var s = $@"a{H.Fmt('\\''.ToString())}b";`, `var t5 = @"p`, `q";`, `s = s + t5;`]],
  ["C6-double-brace-escapes", [`var s = $@"{{lit}} {H.N}`, `second {{x}} line";`]],
  ["C7-brace-in-nested-string", [`var s = $@"a{H.Fmt("x}y{z")}b";`, `var t7 = @"p`, `q";`, `s = s + t7;`]],
  ["C8-doubled-quote-in-verbatim", [`var s = @"say ""hi""`, `and ""bye""";`]],
  ["C9-block-comment-spanning", [`/* a comment`, `   with @" and """ inside`, `*/`, `var s = @"p`, `q";`]],
  ["C10-line-comment-quotes", [`// he said "hi and @" too`, `var s = @"p`, `q";`]],
  ["C11-block-comment-in-hole-backslash", [`var s = $@"a{H.Fmt(/* @"C:\\" */ "x")}b";`, `var t8 = @"p`, `q";`, `s = s + t8;`]],
  ["C12-line-comment-in-multiline-hole", [`var s = $@"a{H.J(`, `    "x", // note with @" and a }`, `    "y")}b";`, `var t9 = @"p`, `q";`, `s = s + t9;`]],
  ["C13-block-comment-in-hole-unpaired", [`var s = $@"a{H.Fmt(/* opener @" here */ "x")}b";`, `var ta = @"p`, `q";`, `s = s + ta;`]],
  ["C14-hole-spans-lines-code-only", [`var s = $@"a{H.J(`, `"x", "y")}b";`]],
  ["C15-verbatim-interp-text-2line", [`var s = $@"a{H.N}b`, `c";`]],
  ["C16-raw-toplevel", [`var s = """`, `    alpha`, `    beta`, `    """;`]],
  ["C17-verbatim-backslash-tail", [`var s = @"C:\\dir\\`, `sub";`]],
  ["C18-hole-ternary", [`var s = $@"a{(H.N > 3 ? "big" : "small")}b`, `tail";`]],
  // --- the fix's own family, at depths the flag pair could not hold ----------
  ["N1-nested-verbatim-2line", [`var s = $@"a{H.Fmt(@"x`, `Y")}b";`]],
  ["N2-nested-verbatim-backslash", [`var s = $@"a{H.Fmt(@"C:\\dir\\`, `sub")}b";`]],
  ["N3-nested-interp-verbatim-hole", [`var s = $@"a{H.Fmt($@"b`, `{H.N}c")}d";`]],
  ["N4-three-levels", [`var s = $@"a{H.Fmt($@"b{H.Fmt(@"c`, `d")}e")}f";`]],
  ["N5-nested-verbatim-doubled", [`var s = $@"a{H.Fmt(@"say ""hi""`, `again")}b";`]],
  ["N6-four-levels", [`var s = $@"a{H.Fmt($@"b{H.Fmt($@"c{H.Fmt(@"d`, `e")}f")}g")}h";`]],
];

const CONTEXTS = [
  ["bare", [], [`return s;`], false],
  ["after-local", [`var pre = "p:";`], [`return pre + s;`], false],
  ["in-if", [`if (H.N > 0)`, `{`], [`    return s;`, `}`, `return "";`], true],
  ["after-loop", [`var acc = 0;`, `foreach (var q in new[] { 1, 2 })`, `{`, `    acc += q;`, `}`], [`return s + acc;`], false],
  ["before-use", [], [`var zEnd = s + "/end";`, `return zEnd;`], false],
  ["with-comments", [`// leading`], [`/* trailing */`, `return s;`], false],
];

const CASES = [];
for (const [shape, lines] of SHAPES) {
  for (const [context, head, tail, indent4] of CONTEXTS) {
    const stmt = indent4 ? lines.map((l) => (l === "" ? l : "    " + l)) : lines;
    CASES.push({ id: CASES.length, shape, context, body: [...head, ...stmt, ...tail].join("\n") });
  }
}

let GRADED = null;
function grade() {
  if (GRADED) return GRADED;
  const t0 = Date.now();
  const r = dotnetRun(csProgram(CASES));
  assert.equal(
    r.status,
    0,
    `the graded fixture must COMPILE before it can grade\n${r.stdout.slice(-4000)}\n${r.stderr.slice(-2000)}`,
  );
  const values = new Map();
  for (const line of r.stdout.trim().split("\n")) {
    const [id, before, nu, ol] = line.split("\t");
    if (ol === undefined) continue;
    values.set(Number(id), { before, nu, ol });
  }
  console.log(`[A13] dotnet build+run of ${values.size * 3} graded methods: ${Date.now() - t0} ms`);
  GRADED = values;
  return GRADED;
}

// ---------------------------------------------------------------------------
// A13-1. THE P13-7a RULING. Re-cut, and here is the row.
//
// Replace `blind-v55-p13-cs-nested-verbatim.test.cjs:609-621` with EXACTLY the
// text below. It was pasted into a COPY of the blind file and run: 17 of 17
// green, dotnet included. The blind file itself was not touched.
//
// test("P13-7a item 7 (i): a raw \"\"\" opened in a hole is FROZEN, and keeps its VALUE", { skip: SKIP, timeout: 600_000 }, () => {
//   const g = grade();
//   const c = caseOf("t-raw-in-hole-multi", "bare");
//   const src = c.body.split("\n");
//   const out = AFTER[c.id].split("\n");
//   // The construct is HANDLED now, not lucky. Every line of the raw string comes
//   // back byte-exact - its content AND its closing delimiter - exactly as a
//   // top-level raw string's lines already did.
//   assert.equal(out[1], src[1], "the raw string's content line is frozen");
//   assert.equal(out[2], src[2], "the raw string's closing-delimiter line is frozen");
//   // Code around it still moves, so this is not a whole-body no-op.
//   assert.equal(out[3], INDENT + src[3], "the statement after the string is code and shifts");
//   assert.notEqual(AFTER[c.id], c.body, "the body as a whole is not returned unchanged");
//   // And the VALUE survives, now BECAUSE the closing delimiter did not move: a
//   // raw string measures its own indentation from that delimiter. Before the fix
//   // it survived only because every line moved by the same amount.
//   const v = g.values.get(c.id);
//   assert.equal(v.before, v.after, "a frozen raw string keeps its value");
// });
//
// The row below is the same assertions run here, so the ruling is not a
// suggestion someone has to take on trust.
// ---------------------------------------------------------------------------

test("A13-1 P13-7a re-cut: a raw \"\"\" in a hole is frozen to its closing delimiter, and the value holds", { skip: SKIP, timeout: 600_000 }, () => {
  const values = grade();
  const c = CASES.find((x) => x.shape === "R1-raw-hole-col0" && x.context === "bare");
  const src = c.body.split("\n");
  const out = reindentCsBody(c.body, INDENT).split("\n");
  assert.equal(out[1], src[1], "the raw string's content line is frozen");
  assert.equal(out[2], src[2], "the raw string's CLOSING-DELIMITER line is frozen - this is what decides the value");
  assert.equal(out[3], INDENT + src[3], "the statement after the string is code and shifts");
  assert.notEqual(out.join("\n"), c.body, "the body as a whole is not returned unchanged");
  const v = values.get(c.id);
  assert.equal(v.before, v.nu, "the frozen raw string keeps its value");
  // ... and it is not a one-shape accident: every raw-in-hole shape, in every
  // context, with the closing delimiter at column 0, at 4, at a tab, with the
  // content deeper than the closer, at fence 4, and with the opener line itself
  // frozen inside the enclosing string's text.
  const raw = CASES.filter((x) => x.shape.startsWith("R"));
  assert.equal(raw.length, 72, "12 raw-in-hole shapes x 6 contexts");
  const wrong = raw.filter((x) => values.get(x.id).before !== values.get(x.id).nu);
  assert.deepEqual(wrong.map((x) => `${x.shape}/${x.context}`), [], "raw-in-hole values that moved");
  for (const x of raw) {
    const s = x.body.split("\n");
    const o = reindentCsBody(x.body, INDENT).split("\n");
    for (let n = 0; n < s.length; n++) {
      assert.ok(o[n] === s[n] || o[n] === INDENT + s[n], `${x.shape}/${x.context} line ${n} is neither frozen nor shifted by exactly the indent`);
    }
  }
});

// ---------------------------------------------------------------------------
// A13-2. Nothing else moves, and the constructs that were already right are
// still right. 216 placed cases, graded by the C# runtime.
// ---------------------------------------------------------------------------

test("A13-2 216 placed cases: the new scanner changes no value, the old one changed 54", { skip: SKIP, timeout: 600_000 }, () => {
  const values = grade();
  assert.equal(CASES.length, 216, "36 shapes x 6 contexts");
  assert.equal(values.size, 216, "every case reached the output");
  const newWrong = CASES.filter((c) => values.get(c.id).before !== values.get(c.id).nu);
  assert.deepEqual(newWrong.map((c) => `${c.shape}/${c.context}`), [], "values the NEW scanner changes");
  const oldWrong = CASES.filter((c) => values.get(c.id).before !== values.get(c.id).ol);
  assert.equal(oldWrong.length, 54, "values the OLD scanner changed, for scale");
  // Every one of the 54 is in a family the phase set out to fix; no control moved.
  const families = [...new Set(oldWrong.map((c) => c.shape))].sort();
  assert.deepEqual(families, [
    "C11-block-comment-in-hole-backslash",
    "C13-block-comment-in-hole-unpaired",
    "N1-nested-verbatim-2line",
    "N2-nested-verbatim-backslash",
    "N3-nested-interp-verbatim-hole",
    "N4-three-levels",
    "N5-nested-verbatim-doubled",
    "N6-four-levels",
    "R6-raw-hole-then-verbatim",
  ], "the shapes the fix moved");
});

// ---------------------------------------------------------------------------
// A13-3. "Nothing else moves", mechanically. 1.2M random bodies over six
// opener configurations, differential against the pre-phase-13 scanner.
//
// The row began as a blanket "the two freeze masks never disagree". Item 60
// deliberately falsified that, and the first re-cut replaced it with a BOUNDARY:
// "every divergence carries `$"`, none is outside it", plus a `> 0` count. Both
// halves were wrong, and an adversarial review drove both:
//
//   - `> 0` accepts any count from 1 to the whole population. A mutant deleting
//     the `$"`-still-open pop from `advanceCsLineScan` diverges on 75% MORE
//     bodies and passed the row verbatim. A characterisation row that does not
//     pin its number is decoration.
//   - the `$"` boundary was a fact about THIS TOKEN LIST, not about the scanner.
//     It held only because `JUNK` had no bare `@`, no bare `$`, and none of
//     `$$`/`@@`/`$@`/`@$`, the sigil runs that open a context with no `$"` in
//     the body at all. Those six tokens are in the list now, which is why the
//     `(none)` and `@"` configs have non-zero counts below where they used to
//     read as clean.
//
// So the row pins the COUNTS, per configuration, exactly. Every number here was
// measured, and a scanner change of any kind moves one of them. Two properties
// they carry that prose cannot: the `"""` config's zero says a plain raw string
// is untouched, and the `$"""` count says the item 60 fix is still present.
//
// What the population still cannot reach, stated rather than implied: bodies
// whose junk holds a `"""` run are dropped by the filter below, so a raw string
// opened by the JUNK rather than by the config prefix is out of scope. Those
// belong to A13-2, which grades them against dotnet.
//
// Legality is not this row's job — the population is random junk. Whether the
// changed shapes are still CORRECT is graded by dotnet in A13-2 and A13-7/8/10.
// ---------------------------------------------------------------------------

function frozenMask(reindent, lines) {
  const out = reindent(lines.join("\n"), "\t\t").split("\n");
  // A frozen line comes back byte-identical; a code line always gains the
  // indent, which is non-empty. Line 0 and blank lines carry no signal.
  return lines.map((l, n) => (n === 0 || l.trim() === "" ? null : out[n] === l));
}

function mulberry(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The last six were added by the session-v59 fix round. Without them no body can
// hold a sigil run that opens a context on its own, which is the whole reason
// the row's old `$"` boundary looked clean.
const JUNK = ['"', '""', "'", "\\", "{", "}", "{{", "}}", "//", "/*", "*/", "a", "x;", '\\"', '$"', "(", ")", ",", ";", " ", "\\'", "b", "@", "$", "$$", "@@", "$@", "@$"];

// Divergences per opener configuration, measured. `checked` is the same for
// every config because the filter reads the JUNK only, never the prefix.
const A13_3_CHECKED_PER_CONFIG = 192_650;
const A13_3_DIVERGENCES = { "(none)": 856, '@"': 211, '$@"': 1005, '@$"': 1005, '"""': 0, '$"""': 60_951 };
const A13_3_DIVERGENCES_WITHOUT_DOLLAR_QUOTE = 435;

test("A13-3 1.2M control-shaped bodies: the freeze mask diverges on exactly these counts", () => {
  const configs = ["", '@"', '$@"', '@$"', '"""', '$"""'];
  const checked = {};
  const diverged = {};
  let withoutDollarQuote = 0;
  for (const prefix of configs) {
    const key = prefix === "" ? "(none)" : prefix;
    checked[key] = 0;
    diverged[key] = 0;
    for (let seed = 0; seed < 200_000; seed++) {
      const r = mulberry(seed ^ 0x9e37);
      const nl = 2 + Math.floor(r() * 3);
      const junk = [];
      for (let k = 0; k < nl; k++) {
        let s = "";
        const m = 1 + Math.floor(r() * 5);
        for (let j = 0; j < m; j++) s += JUNK[Math.floor(r() * JUNK.length)];
        junk.push(s);
      }
      // A run of three quotes opens a raw string, and a raw string opened inside
      // a hole is precisely what item 60 changed. Those bodies belong to A13-2,
      // not here. The config's own prefix is exempt: it is the opener under
      // test, not junk.
      if (junk.some((j) => j.includes('"""'))) continue;
      const lines = ["var z = 1;", prefix + junk[0], ...junk.slice(1)];
      checked[key]++;
      const a = frozenMask(OLD.reindentCsBody, lines);
      const b = frozenMask(reindentCsBody, lines);
      let moved = false;
      for (let n = 1; n < lines.length; n++) {
        if (b[n] === null) continue;
        if (b[n] !== a[n]) moved = true;
      }
      if (!moved) continue;
      diverged[key]++;
      if (!lines.join("\n").includes('$"')) withoutDollarQuote++;
    }
  }
  for (const key of Object.keys(A13_3_DIVERGENCES)) {
    assert.strictEqual(checked[key], A13_3_CHECKED_PER_CONFIG, `config ${key}: the population itself changed, so its count is not comparable`);
  }
  assert.deepStrictEqual(
    diverged,
    A13_3_DIVERGENCES,
    "the freeze mask diverges from the pre-phase-13 scanner on a different set of bodies than the one measured; re-measure before re-pinning, and say what moved it",
  );
  assert.strictEqual(
    withoutDollarQuote,
    A13_3_DIVERGENCES_WITHOUT_DOLLAR_QUOTE,
    'divergences carrying no `$"` at all - the count the row used to claim was zero',
  );
});

// ---------------------------------------------------------------------------
// A13-4. The one divergence in the OTHER direction, found in 400000 random
// bodies drawn from the full token set: a line the old scanner froze and the
// new one does not. It is pinned here, and dotnet is asked whether it is C#.
// ---------------------------------------------------------------------------

const FREEZE_LOSS = [`var z = 1;`, `)@$"',{{{`, `@"\\"{{(`, `$@"}$"},*/`, `a`, `\\"x; ({`].join("\n");

test("A13-4 the one freeze-losing body in 400000: the new scanner shifts line 4 where the old froze it", () => {
  const lines = FREEZE_LOSS.split("\n");
  const a = frozenMask(OLD.reindentCsBody, lines);
  const b = frozenMask(reindentCsBody, lines);
  assert.equal(a[4], true, "the old scanner froze line 4");
  assert.equal(b[4], false, "the new scanner treats it as code");
  // The scans are out of step from there on, so the divergence carries into the
  // tail: lines 1-3 still agree, and everything from 4 down does not.
  for (let n = 1; n <= 3; n++) assert.equal(b[n], a[n], `line ${n} should still agree`);
  assert.deepEqual(
    lines.map((_, n) => (n < 1 || b[n] === null ? null : b[n] === a[n])),
    [null, true, true, true, false, false],
    "which lines agree",
  );
});

test("A13-4b ... and that body is not C#: the compiler rejects it, so the divergence costs nothing", { skip: SKIP, timeout: 600_000 }, () => {
  const src = `using System;
class H { public static int N = 7; public static string Fmt(string x) => x; }
class Program {
  static string A() {
${FREEZE_LOSS}
    return "";
  }
  public static void Main() { Console.WriteLine(A()); }
}
`;
  const r = dotnetRun(src);
  assert.notEqual(r.status, 0, "the body compiled, which would make the divergence real");
  assert.match(r.stdout + r.stderr, /CS8086/, "a '}' character must be escaped (by doubling) in an interpolated string");
});

// ---------------------------------------------------------------------------
// A13-5. Contract item 4: the two directions agree. 200000 round trips.
// ---------------------------------------------------------------------------

const TOK = ['"', '""', '"""', '@"', '$@"', '@$"', '$"', "'", "\\", "{", "}", "{{", "}}", "//", "/*", "*/", "a", "x;", '\\"', "(", ")", ",", ";", " "];

test("A13-5 200000 reindent/dedent round trips are identity, with the base known and inferred", () => {
  let n = 0;
  for (let seed = 0; seed < 100_000; seed++) {
    const r = mulberry(seed ^ 0xabcd);
    const nl = 2 + Math.floor(r() * 4);
    const lines = ["var z = 1;"];
    for (let k = 0; k < nl; k++) {
      let s = "";
      const m = 1 + Math.floor(r() * 6);
      for (let j = 0; j < m; j++) s += TOK[Math.floor(r() * TOK.length)];
      lines.push(s);
    }
    const body = lines.join("\n");
    const placed = INDENT + reindentCsBody(body, INDENT);
    assert.equal(dedentCsBody(placed, INDENT), body, `known base: ${JSON.stringify(body)}`);
    assert.equal(dedentCsBody(placed), body, `inferred base: ${JSON.stringify(body)}`);
    n += 2;
  }
  assert.equal(n, 200_000);
});

test("A13-5b contract item 5: indent === \"\" is byte-identical on all 216 placed cases", () => {
  for (const c of CASES) {
    assert.equal(reindentCsBody(c.body, ""), c.body, `${c.shape}/${c.context}`);
  }
});

// ---------------------------------------------------------------------------
// A13-6. The scan must never throw and never hang.
// ---------------------------------------------------------------------------

test("A13-6 pathological input: 13 shapes, no throw and no hang", () => {
  const cases = {
    "unterminated verbatim": [`var s = @"open`, `more`, `return s;`],
    "unterminated raw": [`var s = """`, `x`, `return s;`],
    "unterminated verbatim inside a hole": [`var s = $@"a{H.Fmt(@"x`, `Y`, `return s;`],
    "closing brace with no hole open": [`}}}}}}`, `var s = "x";`],
    "closing-brace storm inside a hole": [`var s = $@"a{`, `}}}}}}}}}}}}`, `return s;`],
    "lone quotes": [`"`, `"`, `"`],
    "backslash storm": [`\\\\\\\\`, `var s = "x";`],
    "200-deep nesting": [Array.from({ length: 200 }, () => `$@"{`).join(""), `x`, `return "";`],
    "10k unterminated lines": Array.from({ length: 10_000 }, (_, i) => `var v${i} = @"a`),
    "10k closed lines": Array.from({ length: 10_000 }, (_, i) => `var v${i} = "a";`),
    "200k-char line": [`var s = "${"x".repeat(200_000)}";`, `return s;`],
    "5000-quote run": [`"`.repeat(5000), `x`],
    "stray carriage returns": [`var s = @"a\r`, `b";\r`, `return s;`],
  };
  const t0 = Date.now();
  for (const [name, lines] of Object.entries(cases)) {
    const body = lines.join("\n");
    const placed = reindentCsBody(body, INDENT);
    dedentCsBody(placed, INDENT);
    assert.equal(typeof placed, "string", name);
  }
  const ms = Date.now() - t0;
  assert.ok(ms < 10_000, `the whole set took ${ms} ms; a hang or a quadratic blow-up would show here`);
});

// ---------------------------------------------------------------------------
// A13-7. INVERTED by session-v59 phase 5 (roadmap item 60, queue Q16b). The row
// used to pin the DEFECT and its byte-identity with the pre-phase-13 scanner:
// `CsStrCtx` pinned `holeDepth: 0` for `kind: "raw"`, so a hole inside
// `$"""…"""` was scanned as string TEXT, `csRawClose` took the run of `>= fence`
// quotes inside the hole as the close, and `reindentCsBody` shifted the real
// closing-delimiter line away from its content. CS8999 out of compilable in.
//
// The scanner now carries a raw string's `$` count and tracks its holes, so the
// row pins the fix instead: the literal comes back byte-exact, the bytes DIVERGE
// from the old scanner (equality here would mean the fix was reverted), and
// dotnet compiles AND runs the output to the same value as the input.
// ---------------------------------------------------------------------------

const RAW_INTERP_HOLE = [`var s = H.Fmt($"""`, `    a{@"say ""hi"""}b`, `    """);`, `return s;`].join("\n");

test("A13-7 a raw-interpolated hole holding a quote run: the literal is frozen, and the output compiles to the same value", { skip: SKIP, timeout: 600_000 }, () => {
  const nu = reindentCsBody(RAW_INTERP_HOLE, INDENT);
  assert.notEqual(nu, OLD.reindentCsBody(RAW_INTERP_HOLE, INDENT), "the old scanner's bytes came back, so the Q16b fix is gone");
  const src = RAW_INTERP_HOLE.split("\n");
  const out = nu.split("\n");
  assert.equal(out[1], src[1], "the content line is frozen");
  assert.equal(out[2], src[2], "the closing delimiter is frozen WITH it - this is the whole CS8999 fix");
  assert.equal(out[3], INDENT + src[3], "code after the literal still moves, so this is not a whole-body freeze");
  const wrap = (body) => `using System;
using System.Text;
class H { public static int N = 7; public static string Fmt(string x) => x; }
class Program {
  static string Before() {
${RAW_INTERP_HOLE}
  }
  static string After() {
${body}
  }
  public static void Main() {
    Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(Before())));
    Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(After())));
  }
}
`;
  const r = dotnetRun(wrap(INDENT + nu));
  assert.equal(r.status, 0, `the re-indented output must COMPILE; CS8999 here is the defect back\n${r.stdout.slice(-3000)}${r.stderr.slice(-2000)}`);
  assert.doesNotMatch(r.stdout + r.stderr, /CS8999/, "the raw literal's lines disagree on their leading whitespace again");
  const [before, after] = r.stdout.trim().split("\n");
  assert.equal(after, before, "the re-indent changed the string's value");
});

// ---------------------------------------------------------------------------
// A13-7b. The other half of a raw string's `$` count, and the reason a hole line
// is CODE rather than frozen: a line that BEGINS inside a `$"""` hole is exempt
// from the closing delimiter's whitespace rule, so shifting it is legal and
// value-preserving. Measured on dotnet 10.0.111 before the row was written - the
// same body at two different hole columns compiles to one value.
// ---------------------------------------------------------------------------

const RAW_HOLE_SPANS = [`var s = $"""`, `    head {H.J(`, `"x", "y")} tail`, `    """;`, `return s;`].join("\n");

test("A13-7b a $\"\"\" hole that spans lines: the hole's line is code and moves, the text lines do not", { skip: SKIP, timeout: 600_000 }, () => {
  const nu = reindentCsBody(RAW_HOLE_SPANS, INDENT);
  const src = RAW_HOLE_SPANS.split("\n");
  const out = nu.split("\n");
  assert.equal(out[1], src[1], "the text line that OPENS the hole is frozen");
  assert.equal(out[2], INDENT + src[2], "the line that BEGINS inside the hole is code and shifts");
  assert.equal(out[3], src[3], "the closing delimiter is frozen");
  const prog = `using System;
using System.Text;
class H { public static int N = 7;
  public static string Fmt(string x) => "<" + x + ">";
  public static string J(string a, string b) => a + "|" + b; }
class Program {
  static string Before() {
${RAW_HOLE_SPANS}
  }
  static string After() {
${INDENT + nu}
  }
  public static void Main() {
    Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(Before())));
    Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(After())));
  }
}
`;
  const r = dotnetRun(prog);
  assert.equal(r.status, 0, `both bodies must compile\n${r.stdout.slice(-3000)}${r.stderr.slice(-2000)}`);
  const [before, after] = r.stdout.trim().split("\n");
  assert.equal(after, before, "shifting the hole's line changed the string's value");
});

// ---------------------------------------------------------------------------
// A13-7c. The `$` COUNT, which is the part of the raw fix nothing else reaches:
// with two dollars a hole opens on a run of TWO braces and a lone `{` is literal
// text. dotnet rejects `{{` as an escape at one dollar (CS9006), so the count has
// to be carried rather than assumed.
//
// The shape is chosen so a scanner that ignores the count FAILS here, which the
// first cut of this row did not do: `a{b` opens a phantom hole at one dollar, the
// brace arithmetic never returns to zero, and the closing-delimiter line is
// classified as code and shifted - CS8999 again. Verified by mutation: clamping
// `dollars` to 1 reddens this row and nothing else in the file.
// ---------------------------------------------------------------------------

const RAW_TWO_DOLLARS = [`var s = H.Fmt($$"""`, `    a{b {{H.N}} c`, `    """);`, `return s;`].join("\n");

test("A13-7c a $$\"\"\" raw string: the hole needs two braces, and the literal's lines stay frozen", { skip: SKIP, timeout: 600_000 }, () => {
  const nu = reindentCsBody(RAW_TWO_DOLLARS, INDENT);
  const src = RAW_TWO_DOLLARS.split("\n");
  const out = nu.split("\n");
  assert.equal(out[1], src[1], "the content line holding the hole is frozen");
  assert.equal(out[2], src[2], "the closing delimiter is frozen with it");
  assert.equal(out[3], INDENT + src[3], "the statement after the literal is code and shifts");
  const prog = `using System;
using System.Text;
class H { public static int N = 7;
  public static string Fmt(string x) => "<" + x + ">";
  public static string J(string a, string b) => a + "|" + b; }
class Program {
  static string Before() {
${RAW_TWO_DOLLARS}
  }
  static string After() {
${INDENT + nu}
  }
  public static void Main() {
    Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(Before())));
    Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(After())));
  }
}
`;
  const r = dotnetRun(prog);
  assert.equal(r.status, 0, `both bodies must compile\n${r.stdout.slice(-3000)}${r.stderr.slice(-2000)}`);
  const [before, after] = r.stdout.trim().split("\n");
  assert.equal(after, before, "the re-indent changed a two-dollar raw string's value");
});

// ---------------------------------------------------------------------------
// A13-8. INVERTED by session-v59 phase 5 (roadmap item 60, queue Q16c). The row
// used to pin the DEFECT: `$"` had no opener, so it was scanned as a plain
// regular string, the scan stopped at the OPENING quote of a `@"` inside its
// hole, the quote count desynchronised, and a later line sitting in a real
// `$@"…"` string's TEXT was shifted and lost its value.
//
// `$"` is now a tracked context with its own holes, so the row pins the fix: the
// bytes DIVERGE from the old scanner, the line inside the string's text is
// frozen, and dotnet runs both bodies to the SAME value.
// ---------------------------------------------------------------------------

const DOLLAR_HOLE = [
  `var s = H.J(H.J($"x{@"say ""hi"""}", $"x{@"p\\q"}"), $@"a{@"say ""hi"""}b`,
  `c");`,
  `return s;`,
].join("\n");

test("A13-8 a verbatim string inside a $\"...\" hole no longer desynchronises the quote count", { skip: SKIP, timeout: 600_000 }, () => {
  const nu = reindentCsBody(DOLLAR_HOLE, INDENT);
  assert.notEqual(nu, OLD.reindentCsBody(DOLLAR_HOLE, INDENT), "the old scanner's bytes came back, so the Q16c fix is gone");
  const src = DOLLAR_HOLE.split("\n");
  assert.equal(nu.split("\n")[1], src[1], "line 1 is inside the $@\"...\" string's TEXT and is now frozen");
  const prog = `using System;
using System.Text;
class H { public static int N = 7;
  public static string Fmt(string x) => "<" + x + ">";
  public static string J(string a, string b) => a + "|" + b; }
class Program {
  static string Before() {
${DOLLAR_HOLE}
  }
  static string After() {
${INDENT + nu}
  }
  public static void Main() {
    Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(Before())));
    Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(After())));
  }
}
`;
  const r = dotnetRun(prog);
  assert.equal(r.status, 0, `the reproducer must compile\n${r.stdout.slice(-3000)}${r.stderr.slice(-2000)}`);
  const [before, after] = r.stdout.trim().split("\n");
  assert.equal(after, before, "the re-indent still moves this value");
});

// ---------------------------------------------------------------------------
// A13-8b. The same desync at STATEMENT level, which is where it was triaged: the
// missing `$"` opener is in the one shared opener list, so a `@"` inside a `$"`
// hole loses the count whether or not an outer string is open. A second physical
// line inside the `@"…"` proves the count, because only a scan that is still
// inside a string freezes it.
// ---------------------------------------------------------------------------

const DOLLAR_TOPLEVEL = [`var s = $"a{@"p`, `q"}b";`, `var t = @"x`, `y";`, `return H.J(s, t);`].join("\n");

test("A13-8b a $\"…\" hole at statement level keeps the quote count, so the string after it holds its value", { skip: SKIP, timeout: 600_000 }, () => {
  const nu = reindentCsBody(DOLLAR_TOPLEVEL, INDENT);
  assert.notEqual(nu, OLD.reindentCsBody(DOLLAR_TOPLEVEL, INDENT), "the old scanner's bytes came back, so the Q16c fix is gone");
  const src = DOLLAR_TOPLEVEL.split("\n");
  const out = nu.split("\n");
  assert.equal(out[1], src[1], "line 1 sits in the @\"…\" text inside the hole and is frozen");
  assert.equal(out[3], src[3], "line 3 sits in the LATER @\"…\" text and is frozen");
  assert.equal(out[4], INDENT + src[4], "the statement after both strings is code and shifts");
  const prog = `using System;
using System.Text;
class H { public static int N = 7;
  public static string Fmt(string x) => "<" + x + ">";
  public static string J(string a, string b) => a + "|" + b; }
class Program {
  static string Before() {
${DOLLAR_TOPLEVEL}
  }
  static string After() {
${INDENT + nu}
  }
  public static void Main() {
    Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(Before())));
    Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(After())));
  }
}
`;
  const r = dotnetRun(prog);
  assert.equal(r.status, 0, `both bodies must compile\n${r.stdout.slice(-3000)}${r.stderr.slice(-2000)}`);
  const [before, after] = r.stdout.trim().split("\n");
  assert.equal(after, before, "the re-indent moved a value after a $\"…\" hole");
});

// ---------------------------------------------------------------------------
// A13-9. The one behaviour change on input that is NOT legal C#: a string left
// open inside a hole now freezes the rest of the body, where before the tail
// was shifted. Consistent with what an unterminated `@"` at statement level has
// always done, and pinned here so the change is on the record rather than
// discovered by a truncated model reply.
// ---------------------------------------------------------------------------

test("A13-9 a string left OPEN inside a hole now freezes the tail; at statement level that was already true", () => {
  const inHole = [`var s = $@"a{H.Fmt(@"x`, `var t = 1;`, `return s;`].join("\n");
  const atTop = [`var s = @"x`, `var t = 1;`, `return s;`].join("\n");
  assert.equal(reindentCsBody(inHole, INDENT), inHole, "the new scanner freezes the tail after an unterminated string in a hole");
  assert.notEqual(OLD.reindentCsBody(inHole, INDENT), inHole, "the old scanner shifted it");
  assert.equal(reindentCsBody(atTop, INDENT), atTop, "at statement level the freeze is not new");
  assert.equal(OLD.reindentCsBody(atTop, INDENT), atTop, "... the old scanner did the same");
});

// ---------------------------------------------------------------------------
// A13-10. A COMMENT INSIDE AN INTERPOLATION HOLE.
//
// The scanner used to read `//` and `/* */` at statement level only, on the
// stated ground that a comment "cannot legally appear inside an interpolation
// hole". dotnet 10.0.111 disproves that: every body in the table below compiles
// and runs, in all three hole kinds. C# 11 allows newlines in every
// interpolation, and a hole is C# code, so it takes C# comments.
//
// The cost of not reading them is a quote character the compiler never sees:
// an `@"` or a `"""` written inside a comment opens a phantom string context
// that never closes, and from there the freeze mask is wrong for the rest of
// the body. Two distinct damages, and a row that grades VALUES alone sees only
// the first:
//
//   - the phantom swallows the real closing delimiter's line, so a raw string's
//     content and its delimiter are re-indented by different amounts: CS8999,
//     compilable input to uncompilable output;
//   - the phantom freezes everything below it, so a real `@"…"` further down
//     never opens and its continuation line takes the indent: the value moves.
//
// The table is graded on both, plus the tail: the statement after the literal
// is ordinary code and must still shift. A body whose tail stopped moving is
// the "frozen from here down" failure, which preserves every value and loses
// all indentation below - invisible to a value-only grade.
//
// Each `expect` was taken from dotnet before the row was written.
// ---------------------------------------------------------------------------

// `old` is what the PRE-phase-13 scanner does with the same body, measured, and
// it is the reason this table cannot be fed to `csProgram`: two of the five old
// outputs do not compile, so the three-copy program has no build.
const COMMENT_IN_HOLE = [
  {
    name: "raw hole, line comment holding @\"",
    expect: "head x|y tail",
    frozen: [1, 4], // the raw string's first content line, and its delimiter
    old: "same",
    lines: [`var s = $"""`, `    head {H.J(`, `"x", // @"oops`, `"y")} tail`, `    """;`, `return s;`],
  },
  {
    name: "raw hole, line comment holding a fence run",
    expect: "head x|y tail",
    frozen: [1, 4],
    old: "cs8999", // the fence run closed the raw string early in BOTH scanners
    lines: [`var s = $"""`, `    head {H.J(`, `"x", // """oops`, `"y")} tail`, `    """;`, `return s;`],
  },
  {
    name: "$\" hole, line comment holding @\"",
    expect: "xa|p\nqy",
    frozen: [3], // the second line of the real @"p\nq"
    old: "same",
    lines: [`var s = $"x{H.J(`, `    "a", // note @"oops`, `    @"p`, `q")}y";`, `return s;`],
  },
  {
    name: "$\" hole, block comment holding @\"",
    expect: "xa|p\nqy",
    frozen: [3],
    old: "same",
    lines: [`var s = $"x{H.J(`, `    "a", /* note @"oops */`, `    @"p`, `q")}y";`, `return s;`],
  },
  {
    name: "$@\" hole, line comment holding @\"",
    expect: "xa|p\nqy",
    frozen: [3],
    old: "moved", // verbatim holes were tracked all along, so this one predates phase 5
    lines: [`var s = $@"x{H.J(`, `    "a", // note @"oops`, `    @"p`, `q")}y";`, `return s;`],
  },
];

/** One C# program holding `pairs.length` before/after method pairs, each printing
 *  its two values base64. Separate from `csProgram` because that one always
 *  carries a THIRD copy from the old scanner, and an old copy that does not
 *  compile takes the whole build down with it. */
function pairProgram(pairs) {
  return `using System;
using System.Text;
namespace Cases {
  public static class H { public static string J(string a, string b) => a + "|" + b; }
  public static class Before {
${pairs.map((p, id) => method("Case", id, p.body)).join("\n")}
  }
  public static class After {
${pairs.map((p, id) => method("Case", id, INDENT + p.out)).join("\n")}
  }
  public static class Program {
    public static void Main() {
${pairs
  .map(
    (_, id) =>
      `      Console.WriteLine(${id} + "\\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(Before.Case${id}())) + "\\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(After.Case${id}())));`,
  )
  .join("\n")}
    }
  }
}
`;
}

/** id -> { before, after }, decoded, from a `pairProgram` run. */
function pairValues(stdout) {
  const dec = (b) => Buffer.from(b, "base64").toString("utf8");
  const out = new Map();
  for (const line of stdout.trim().split("\n")) {
    const [id, before, after] = line.split("\t");
    if (after === undefined) continue;
    out.set(Number(id), { before: dec(before), after: dec(after) });
  }
  return out;
}

test("A13-10 a comment inside a hole hides its quotes: the output compiles, the tail still moves", { skip: SKIP, timeout: 600_000 }, () => {
  const pairs = [];
  for (const c of COMMENT_IN_HOLE) {
    const body = c.lines.join("\n");
    const out = reindentCsBody(body, INDENT);
    const got = out.split("\n");
    assert.equal(got.length, c.lines.length, `${c.name}: line count`);
    assert.equal(
      got[c.lines.length - 1],
      INDENT + c.lines[c.lines.length - 1],
      `${c.name}: a phantom string opened in the comment froze the tail, so everything below lost its indent`,
    );
    for (const f of c.frozen) {
      assert.equal(got[f], c.lines[f], `${c.name}: line ${f} is string TEXT and must come back byte-exact`);
    }
    pairs.push({ body, out });
  }
  const r = dotnetRun(pairProgram(pairs));
  assert.equal(
    r.status,
    0,
    `every re-indented body must COMPILE; CS8999 is the raw delimiter re-indented away from its content\n${r.stdout.slice(-4000)}\n${r.stderr.slice(-4000)}`,
  );
  assert.doesNotMatch(r.stdout + r.stderr, /CS8999/, "a raw literal's lines disagree on their leading whitespace");
  const values = pairValues(r.stdout);
  assert.equal(values.size, COMMENT_IN_HOLE.length, "every case reached the output");
  for (const [n, c] of COMMENT_IN_HOLE.entries()) {
    assert.equal(values.get(n).before, c.expect, `${c.name}: the FIXTURE does not hold the value the row was written against`);
    assert.equal(values.get(n).after, c.expect, `${c.name}: the re-indent changed the string's value`);
  }
});

// ---------------------------------------------------------------------------
// A13-10b. The attribution, measured rather than asserted in prose. Three of the
// five bodies were CORRECT under the pre-phase-13 scanner and went wrong when
// phase 5 gave `$"` an opener and made a raw string's holes real; two were
// already broken, because a verbatim string's holes were tracked all along and a
// fence run inside a raw hole closed the string early in both scanners.
//
// So the regression is real and its blast radius is three shapes, not five. That
// number is what the commit message and S24 are allowed to say.
// ---------------------------------------------------------------------------

test("A13-10b comment-in-hole: 3 of 5 shapes are a phase-5 regression, 2 were already broken", { skip: SKIP, timeout: 600_000 }, () => {
  const ok = COMMENT_IN_HOLE.filter((c) => c.old !== "cs8999");
  const r = dotnetRun(pairProgram(ok.map((c) => ({ body: c.lines.join("\n"), out: OLD.reindentCsBody(c.lines.join("\n"), INDENT) }))));
  assert.equal(r.status, 0, `the old scanner's output for these shapes still compiles\n${r.stdout.slice(-4000)}\n${r.stderr.slice(-4000)}`);
  const values = pairValues(r.stdout);
  const outcome = new Map(ok.map((c, n) => [c.name, values.get(n).after === values.get(n).before ? "same" : "moved"]));
  for (const c of COMMENT_IN_HOLE) {
    if (c.old === "cs8999") continue;
    assert.equal(outcome.get(c.name), c.old, `${c.name}: what the PRE-phase-13 scanner did with this body`);
  }
  // The two the old scanner could not compile either, one at a time so the
  // failure is attributable to a body rather than to the batch.
  for (const c of COMMENT_IN_HOLE.filter((x) => x.old === "cs8999")) {
    const body = c.lines.join("\n");
    const bad = dotnetRun(pairProgram([{ body, out: OLD.reindentCsBody(body, INDENT) }]));
    assert.notEqual(bad.status, 0, `${c.name}: the old scanner's output was supposed to be the PRE-EXISTING CS8999`);
    assert.match(bad.stdout + bad.stderr, /CS8999/, `${c.name}: rejected, but not for the whitespace rule`);
  }
});
