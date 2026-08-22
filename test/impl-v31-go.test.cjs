// Implementer tests for session-v31 phase 2: the Go leg (src/core/tddGo.ts) and
// the rung plumbing it needed built first (src/core/compilerOracle.ts), written
// alongside the implementation and sitting under the blind oracle blind-v31-go.
//
// What these pin that the contract alone does not:
//   - the FALSE GREEN TRAP, first and hardest: a filter that matched nothing
//     and a build that broke are both package-scoped events and neither may
//     ever be counted as a test result;
//   - the FORGERY the phase 2 adversarial review found, which is why the rung
//     reads `go test -json` and not `-v` text: the generated idiom prints the
//     value under test, so any function returning multi-line text could put a
//     `--- PASS:` line where a text parser read a verdict;
//   - the depth-counted parameter list, which `indexOf(")")` gets wrong on a
//     pointer receiver and on a function-typed parameter;
//   - the three plumbing holes: the exit code reaches the parse, `env` reaches
//     the real spawn, and filterMatchedNothing/environmentError survive the
//     runner into the result object — plus `buildError`, which -json forces,
//     because the compile error moved to stdout and stderr is now EMPTY;
//   - Rust's command bytes and result object do not move.
//
// Section 12 absorbs the surviving attack rows of the review file, which was
// deleted rather than left as a permanent second copy of this suite.
//
// Run: SKIP_LIVE=1 node --test test/impl-v31-go.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v31-go",
  `export { tddLangFor, frameworkFor } from "../src/core/tddLang";\n` +
    `export { goReturnTypeOf, classifyGoTestability, goRenderBlankValue, goExpectedValueSpans, parseGoTestOutput, goPackageClauseOf } from "../src/core/tddGo";\n` +
    `export { runFrameworkTestsAt, runTestOracle, buildTestCommand, parseLibtestOutput, RustOracle } from "../src/core/compilerOracle";\n` +
    `export { GO_SPAWN_ENV } from "../src/core/goOracle";\n`
);
const {
  tddLangFor,
  frameworkFor,
  goReturnTypeOf,
  classifyGoTestability,
  goRenderBlankValue,
  goExpectedValueSpans,
  parseGoTestOutput,
  goPackageClauseOf,
  runFrameworkTestsAt,
  runTestOracle,
  buildTestCommand,
  parseLibtestOutput,
  RustOracle,
  GO_SPAWN_ENV,
} = mod;
test.after(cleanup);

const go = () => tddLangFor("go");
const gotest = () => go().frameworks[0];

// A module at /m holding /m/atlas.go and /m/internal/shard/shard.go.
const MODULE_FILES = ["/m/go.mod", "/m/atlas.go", "/m/internal/shard/shard.go"];
const deps = (files, sources) => ({
  fileExists: (p) => files.includes(p),
  readFile: (p) => (sources ?? {})[p],
});

// ===========================================================================
// 0. THE CAPTURES. Every fixture below is verbatim `go test -json` stdout from
//    go1.26.5 on throwaway modules under the session scratchpad, `Time` fields
//    and all: the parser has to ignore the fields it does not read, and a
//    hand-trimmed fixture would not prove that. The command that produced each
//    one is quoted above it.
// ===========================================================================

const jsonl = (...lines) => lines.map((l) => `${l}\n`).join("");

// $ go test -run '^(TestZero)$' -json .                                 EXIT=0
const GO_JSON_PASS = jsonl(
  String.raw`{"Time":"2026-07-27T17:05:46.983382995+10:00","Action":"start","Package":"probe"}`,
  String.raw`{"Time":"2026-07-27T17:05:46.983439446+10:00","Action":"run","Package":"probe","Test":"TestZero"}`,
  String.raw`{"Time":"2026-07-27T17:05:46.983441226+10:00","Action":"output","Package":"probe","Test":"TestZero","Output":"=== RUN   TestZero\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:46.983446926+10:00","Action":"output","Package":"probe","Test":"TestZero","Output":"--- PASS: TestZero (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:46.983448386+10:00","Action":"pass","Package":"probe","Test":"TestZero","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:05:46.983450916+10:00","Action":"output","Package":"probe","Output":"PASS\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:46.983452276+10:00","Action":"output","Package":"probe","Output":"ok  \tprobe\t0.001s\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:46.983454236+10:00","Action":"pass","Package":"probe","Elapsed":0}`
);

// $ go test -run '^(TestHappy|TestZero)$' -json .                       EXIT=1
const GO_MIXED = jsonl(
  String.raw`{"Time":"2026-07-27T17:05:47.073532936+10:00","Action":"start","Package":"probe"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074760966+10:00","Action":"run","Package":"probe","Test":"TestZero"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074771846+10:00","Action":"output","Package":"probe","Test":"TestZero","Output":"=== RUN   TestZero\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074793886+10:00","Action":"output","Package":"probe","Test":"TestZero","Output":"--- PASS: TestZero (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074795836+10:00","Action":"pass","Package":"probe","Test":"TestZero","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074798817+10:00","Action":"run","Package":"probe","Test":"TestHappy"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074800017+10:00","Action":"output","Package":"probe","Test":"TestHappy","Output":"=== RUN   TestHappy\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074801317+10:00","Action":"output","Package":"probe","Test":"TestHappy","Output":"    atlas_test.go:17: aggregateFanout(3) = 6, want 7\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074803597+10:00","Action":"output","Package":"probe","Test":"TestHappy","Output":"--- FAIL: TestHappy (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074804797+10:00","Action":"fail","Package":"probe","Test":"TestHappy","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074806077+10:00","Action":"output","Package":"probe","Output":"FAIL\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074935778+10:00","Action":"output","Package":"probe","Output":"FAIL\tprobe\t0.001s\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.074941758+10:00","Action":"fail","Package":"probe","Elapsed":0.001}`
);

// $ go test -run '^(TestNoSuchThingZZZ)$' -json .                       EXIT=0
const GO_FILTER_MISS = jsonl(
  String.raw`{"Time":"2026-07-27T17:05:47.116398741+10:00","Action":"start","Package":"probe"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.116455232+10:00","Action":"output","Package":"probe","Output":"testing: warning: no tests to run\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.116459012+10:00","Action":"output","Package":"probe","Output":"PASS\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.116460362+10:00","Action":"output","Package":"probe","Output":"ok  \tprobe\t0.001s [no tests to run]\n"}`,
  String.raw`{"Time":"2026-07-27T17:05:47.116462072+10:00","Action":"pass","Package":"probe","Elapsed":0}`
);

// THE FORGERY the phase 2 review found. Three tests whose OWN OUTPUT carries
// verdict lines for tests that do not exist: a %v of a multi-line return value,
// a t.Log, and a t.Skipf.
// $ go test -count=1 -run '^(TestInjectViaFailure|TestInjectViaLog|TestGreenSkipGhost)$' -json .   EXIT=1
const GO_FORGERY = jsonl(
  String.raw`{"Time":"2026-07-27T17:06:04.777315423+10:00","Action":"start","Package":"probe"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778432373+10:00","Action":"run","Package":"probe","Test":"TestInjectViaFailure"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778453303+10:00","Action":"output","Package":"probe","Test":"TestInjectViaFailure","Output":"=== RUN   TestInjectViaFailure\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778473263+10:00","Action":"output","Package":"probe","Test":"TestInjectViaFailure","Output":"    atlas_test.go:23: multi() = line1\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778475723+10:00","Action":"output","Package":"probe","Test":"TestInjectViaFailure","Output":"        --- PASS: TestPhantom (0.00s), want x\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778480253+10:00","Action":"output","Package":"probe","Test":"TestInjectViaFailure","Output":"--- FAIL: TestInjectViaFailure (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778481693+10:00","Action":"fail","Package":"probe","Test":"TestInjectViaFailure","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778485523+10:00","Action":"run","Package":"probe","Test":"TestInjectViaLog"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778487193+10:00","Action":"output","Package":"probe","Test":"TestInjectViaLog","Output":"=== RUN   TestInjectViaLog\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778488403+10:00","Action":"output","Package":"probe","Test":"TestInjectViaLog","Output":"    atlas_test.go:27: harmless\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778489663+10:00","Action":"output","Package":"probe","Test":"TestInjectViaLog","Output":"        --- PASS: TestFakeGhost (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778490913+10:00","Action":"output","Package":"probe","Test":"TestInjectViaLog","Output":"        === RUN   TestFakeGhost\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778492443+10:00","Action":"output","Package":"probe","Test":"TestInjectViaLog","Output":"--- PASS: TestInjectViaLog (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778493883+10:00","Action":"pass","Package":"probe","Test":"TestInjectViaLog","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778495013+10:00","Action":"run","Package":"probe","Test":"TestGreenSkipGhost"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778495993+10:00","Action":"output","Package":"probe","Test":"TestGreenSkipGhost","Output":"=== RUN   TestGreenSkipGhost\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778497053+10:00","Action":"output","Package":"probe","Test":"TestGreenSkipGhost","Output":"    atlas_test.go:31: skipping: unsupported\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778498353+10:00","Action":"output","Package":"probe","Test":"TestGreenSkipGhost","Output":"        --- PASS: TestFakeGhost (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778499713+10:00","Action":"output","Package":"probe","Test":"TestGreenSkipGhost","Output":"--- SKIP: TestGreenSkipGhost (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778501743+10:00","Action":"skip","Package":"probe","Test":"TestGreenSkipGhost","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778502963+10:00","Action":"output","Package":"probe","Output":"FAIL\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778628454+10:00","Action":"output","Package":"probe","Output":"FAIL\tprobe\t0.001s\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.778641384+10:00","Action":"fail","Package":"probe","Elapsed":0.001}`
);

// Three t.Parallel() tests, two failing, whose output INTERLEAVES.
// $ go test -count=1 -run '^(TestParA|TestParB|TestParC)$' -json .      EXIT=1
const GO_PARALLEL = jsonl(
  String.raw`{"Time":"2026-07-27T17:06:04.680915352+10:00","Action":"start","Package":"probe"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68185916+10:00","Action":"run","Package":"probe","Test":"TestParA"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68187012+10:00","Action":"output","Package":"probe","Test":"TestParA","Output":"=== RUN   TestParA\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68189022+10:00","Action":"output","Package":"probe","Test":"TestParA","Output":"=== PAUSE TestParA\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68189168+10:00","Action":"pause","Package":"probe","Test":"TestParA"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68189334+10:00","Action":"run","Package":"probe","Test":"TestParB"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68189439+10:00","Action":"output","Package":"probe","Test":"TestParB","Output":"=== RUN   TestParB\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.6818959+10:00","Action":"output","Package":"probe","Test":"TestParB","Output":"=== PAUSE TestParB\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68189672+10:00","Action":"pause","Package":"probe","Test":"TestParB"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68189898+10:00","Action":"run","Package":"probe","Test":"TestParC"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68190016+10:00","Action":"output","Package":"probe","Test":"TestParC","Output":"=== RUN   TestParC\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68190143+10:00","Action":"output","Package":"probe","Test":"TestParC","Output":"=== PAUSE TestParC\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68190244+10:00","Action":"pause","Package":"probe","Test":"TestParC"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68190371+10:00","Action":"cont","Package":"probe","Test":"TestParA"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68190495+10:00","Action":"output","Package":"probe","Test":"TestParA","Output":"=== CONT  TestParA\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68190596+10:00","Action":"cont","Package":"probe","Test":"TestParC"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68190683+10:00","Action":"output","Package":"probe","Test":"TestParC","Output":"=== CONT  TestParC\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68190917+10:00","Action":"output","Package":"probe","Test":"TestParC","Output":"    par_test.go:18: C noise\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.68191136+10:00","Action":"output","Package":"probe","Test":"TestParC","Output":"    par_test.go:19: aggregateFanout(2) = 4, want 5\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681918401+10:00","Action":"output","Package":"probe","Test":"TestParC","Output":"--- FAIL: TestParC (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681920351+10:00","Action":"fail","Package":"probe","Test":"TestParC","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681923101+10:00","Action":"output","Package":"probe","Test":"TestParA","Output":"    par_test.go:7: A step one\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681924481+10:00","Action":"output","Package":"probe","Test":"TestParA","Output":"    par_test.go:8: aggregateFanout(3) = 6, want 7\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681926261+10:00","Action":"output","Package":"probe","Test":"TestParA","Output":"--- FAIL: TestParA (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681927361+10:00","Action":"fail","Package":"probe","Test":"TestParA","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681928501+10:00","Action":"cont","Package":"probe","Test":"TestParB"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681929401+10:00","Action":"output","Package":"probe","Test":"TestParB","Output":"=== CONT  TestParB\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681931311+10:00","Action":"output","Package":"probe","Test":"TestParB","Output":"    par_test.go:13: B step one\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681933321+10:00","Action":"output","Package":"probe","Test":"TestParB","Output":"--- PASS: TestParB (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681936871+10:00","Action":"pass","Package":"probe","Test":"TestParB","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:06:04.681938081+10:00","Action":"output","Package":"probe","Output":"FAIL\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.682140372+10:00","Action":"output","Package":"probe","Output":"FAIL\tprobe\t0.001s\n"}`,
  String.raw`{"Time":"2026-07-27T17:06:04.682162653+10:00","Action":"fail","Package":"probe","Elapsed":0.001}`
);

// $ go test -count=1 -run '^(TestGreenSkipGhost)$' -json .              EXIT=0
const GO_SKIP = jsonl(
  String.raw`{"Time":"2026-07-27T17:08:10.173342518+10:00","Action":"start","Package":"probe"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.174693652+10:00","Action":"run","Package":"probe","Test":"TestGreenSkipGhost"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.174704932+10:00","Action":"output","Package":"probe","Test":"TestGreenSkipGhost","Output":"=== RUN   TestGreenSkipGhost\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.174726472+10:00","Action":"output","Package":"probe","Test":"TestGreenSkipGhost","Output":"    atlas_test.go:31: skipping: unsupported\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.174728132+10:00","Action":"output","Package":"probe","Test":"TestGreenSkipGhost","Output":"        --- PASS: TestFakeGhost (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.174731792+10:00","Action":"output","Package":"probe","Test":"TestGreenSkipGhost","Output":"--- SKIP: TestGreenSkipGhost (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.174733902+10:00","Action":"skip","Package":"probe","Test":"TestGreenSkipGhost","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:08:10.174737142+10:00","Action":"output","Package":"probe","Output":"PASS\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.174892384+10:00","Action":"output","Package":"probe","Output":"ok  \tprobe\t0.001s\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.174904894+10:00","Action":"pass","Package":"probe","Elapsed":0.002}`
);

// A type error inside the test file. The compile error is on STDOUT as
// `build-output` events and STDERR IS EMPTY, which is the plumbing change -json
// forces: a parser that reads stderr reports a build failure with no message.
// $ go test -count=1 -run '^(TestBroken)$' -json .                      EXIT=1
const GO_BUILD_FAIL = jsonl(
  String.raw`{"ImportPath":"probe [probe.test]","Action":"build-output","Output":"# probe [probe.test]\n"}`,
  String.raw`{"ImportPath":"probe [probe.test]","Action":"build-output","Output":"./broke_test.go:6:14: cannot use \"nope\" (untyped string constant) as int value in variable declaration\n"}`,
  String.raw`{"ImportPath":"probe [probe.test]","Action":"build-fail"}`,
  String.raw`{"Time":"2026-07-27T17:08:09.96533887+10:00","Action":"start","Package":"probe"}`,
  String.raw`{"Time":"2026-07-27T17:08:09.96538989+10:00","Action":"output","Package":"probe","Output":"FAIL\tprobe [build failed]\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:09.96539433+10:00","Action":"fail","Package":"probe","Elapsed":0,"FailedBuild":"probe [probe.test]"}`
);

// A module requiring cobra with an emptied go.sum and GOPROXY=off. NOT a compile
// error, and the remediation the toolchain prints is `go get`, which this
// product forbids.
// $ go test -count=1 -run '^(TestNameHappy)$' -json .                   EXIT=1
const GO_SETUP_FAILED = jsonl(
  String.raw`{"ImportPath":"github.com/spf13/cobra","Action":"build-output","Output":"# probe4\n"}`,
  String.raw`{"ImportPath":"github.com/spf13/cobra","Action":"build-output","Output":"atlas.go:3:8: missing go.sum entry for module providing package github.com/spf13/cobra (imported by probe4); to add:\n"}`,
  String.raw`{"ImportPath":"github.com/spf13/cobra","Action":"build-output","Output":"\tgo get probe4\n"}`,
  String.raw`{"ImportPath":"github.com/spf13/cobra","Action":"build-fail"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.213431289+10:00","Action":"start","Package":"probe4"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.213452309+10:00","Action":"output","Package":"probe4","Output":"FAIL\tprobe4 [setup failed]\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.213455549+10:00","Action":"fail","Package":"probe4","Elapsed":0,"FailedBuild":"github.com/spf13/cobra"}`
);

// $ go test -count=1 -run '^(TestX)$' -json ./notests                   EXIT=0
const GO_NO_TEST_FILES = jsonl(
  String.raw`{"Time":"2026-07-27T17:08:10.19554184+10:00","Action":"start","Package":"probe/notests"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.195614171+10:00","Action":"output","Package":"probe/notests","Output":"?   \tprobe/notests\t[no test files]\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.195618051+10:00","Action":"skip","Package":"probe/notests","Elapsed":0}`
);

// $ go test -count=1 -run '^(TestSubs)$' -json .                        EXIT=1
const GO_SUBTESTS = jsonl(
  String.raw`{"Time":"2026-07-27T17:08:10.076348219+10:00","Action":"start","Package":"probe"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.07747764+10:00","Action":"run","Package":"probe","Test":"TestSubs"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.07749448+10:00","Action":"output","Package":"probe","Test":"TestSubs","Output":"=== RUN   TestSubs\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077512951+10:00","Action":"run","Package":"probe","Test":"TestSubs/sub_case"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077514701+10:00","Action":"output","Package":"probe","Test":"TestSubs/sub_case","Output":"=== RUN   TestSubs/sub_case\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077518711+10:00","Action":"output","Package":"probe","Test":"TestSubs/sub_case","Output":"    sub_test.go:6: nope: 1\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077522711+10:00","Action":"output","Package":"probe","Test":"TestSubs/sub_case","Output":"--- FAIL: TestSubs/sub_case (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077524221+10:00","Action":"fail","Package":"probe","Test":"TestSubs/sub_case","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077527111+10:00","Action":"run","Package":"probe","Test":"TestSubs/ok_case"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077528261+10:00","Action":"output","Package":"probe","Test":"TestSubs/ok_case","Output":"=== RUN   TestSubs/ok_case\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077530191+10:00","Action":"output","Package":"probe","Test":"TestSubs/ok_case","Output":"--- PASS: TestSubs/ok_case (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077531511+10:00","Action":"pass","Package":"probe","Test":"TestSubs/ok_case","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077532891+10:00","Action":"output","Package":"probe","Test":"TestSubs","Output":"--- FAIL: TestSubs (0.00s)\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077534511+10:00","Action":"fail","Package":"probe","Test":"TestSubs","Elapsed":0}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077535661+10:00","Action":"output","Package":"probe","Output":"FAIL\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077669932+10:00","Action":"output","Package":"probe","Output":"FAIL\tprobe\t0.001s\n"}`,
  String.raw`{"Time":"2026-07-27T17:08:10.077680952+10:00","Action":"fail","Package":"probe","Elapsed":0.001}`
);

// ===========================================================================
// 1. THE FALSE GREEN, and the FORGERY the phase 2 review found. Both are why
//    the rung reads `-json` and not `-v` text: a verdict is an Action carrying a
//    Test field, and a forged one can only ever land inside an Output string
//    attributed to the test that printed it.
// ===========================================================================

test("THE TRAP: a filter that matched nothing is package-scoped events only, and none is a case", () => {
  const p = parseGoTestOutput(GO_FILTER_MISS, "", 0);
  assert.strictEqual(p.passed, 0, "the bare `PASS` line is a package-scoped OUTPUT event, not a verdict");
  assert.strictEqual(p.failed, 0);
  assert.strictEqual(p.ignored, 0);
  assert.deepStrictEqual(p.cases, [], "no event carried a Test field, so there are no cases");
  assert.strictEqual(p.ran, false);
});

test("THE TRAP, at the guard it protects: a filter miss cannot be a green", async () => {
  const runner = fakeRunner(GO_FILTER_MISS, "", 0);
  const res = await runFrameworkTestsAt(gotest(), placement(), ["TestNoSuchThingZZZ"], { runCommand: runner });
  assert.strictEqual(res.success, false, "executed>0 is the only thing between the human and a green that ran nothing");
  assert.strictEqual(res.passed + res.failed, 0);
});

test("filterMatchedNothing is DERIVED FROM STRUCTURE: a package `pass` with zero Test-tagged events", () => {
  assert.strictEqual(parseGoTestOutput(GO_FILTER_MISS, "", 0).filterMatchedNothing, true);
  assert.strictEqual(
    parseGoTestOutput(GO_MIXED, "", 1).filterMatchedNothing,
    undefined,
    "a real run plainly matched something"
  );
});

test("the `[no tests to run]` TEXT is no longer a tell, so a failure message cannot forge one", () => {
  // The review found the old text tell matched unanchored against BOTH streams
  // with no `ran` gate: a failing test whose message contained the literal string
  // set filterMatchedNothing on a run that plainly matched something.
  const forged = jsonl(
    String.raw`{"Action":"run","Package":"probe","Test":"TestRenderHappy"}`,
    String.raw`{"Action":"output","Package":"probe","Test":"TestRenderHappy","Output":"    atlas_test.go:9: Render() = ok probe 0.001s [no tests to run], want banner\n"}`,
    String.raw`{"Action":"fail","Package":"probe","Test":"TestRenderHappy","Elapsed":0}`,
    String.raw`{"Action":"fail","Package":"probe","Elapsed":0.001}`
  );
  const p = parseGoTestOutput(forged, "", 1);
  assert.strictEqual(p.filterMatchedNothing, undefined);
  assert.strictEqual(p.failed, 1);
});

test("THE FORGERY: a verdict line inside a test's own OUTPUT is data, never a case", () => {
  const p = parseGoTestOutput(GO_FORGERY, "", 1);
  assert.deepStrictEqual(
    p.cases.map((c) => `${c.outcome}:${c.name}`),
    ["fail:TestInjectViaFailure", "pass:TestInjectViaLog", "ignored:TestGreenSkipGhost"],
    "three tests ran; TestPhantom and TestFakeGhost do not exist"
  );
  assert.strictEqual(p.passed, 1, "the two forged `--- PASS:` lines sit inside Output strings");
  assert.strictEqual(p.failed, 1);
  assert.ok(
    !p.failures.some((f) => f.name === "TestPhantom"),
    "the human must never be shown a failure for a test that is not in their file"
  );
});

test("THE FORGERY, at the guard: a forged PASS cannot make a green", async () => {
  const res = await runFrameworkTestsAt(gotest(), placement(), ["TestGreenSkipGhost"], {
    runCommand: fakeRunner(GO_SKIP, "", 0),
  });
  assert.strictEqual(
    res.success,
    false,
    "the only `--- PASS:` in this run came from a t.Skipf message; the one real test SKIPPED"
  );
});

test("the forged text still reaches the human, attributed to the test that PRINTED it", () => {
  const p = parseGoTestOutput(GO_FORGERY, "", 1);
  assert.deepStrictEqual(p.failures, [
    {
      name: "TestInjectViaFailure",
      message: "    atlas_test.go:23: multi() = line1\n        --- PASS: TestPhantom (0.00s), want x",
    },
  ]);
});

// ===========================================================================
// 2. The parse
// ===========================================================================

test("a mixed run: one case per TERMINAL ACTION carrying a Test field", () => {
  const p = parseGoTestOutput(GO_MIXED, "", 1);
  assert.strictEqual(p.ran, true);
  assert.deepStrictEqual(p.cases, [
    { name: "TestZero", outcome: "pass" },
    { name: "TestHappy", outcome: "fail" },
  ]);
  assert.strictEqual(p.passed, 1);
  assert.strictEqual(p.failed, 1);
  assert.strictEqual(p.ignored, 0);
  assert.strictEqual(p.casesComplete, true, "-json emits an event for every case, passing ones included");
});

test("the failure detail is this test's OWN output events, its two framing lines dropped", () => {
  const p = parseGoTestOutput(GO_MIXED, "", 1);
  assert.deepStrictEqual(p.failures, [
    { name: "TestHappy", message: "    atlas_test.go:17: aggregateFanout(3) = 6, want 7" },
  ]);
});

test("the package-scoped FAIL output events are the package verdict, not two more failing tests", () => {
  assert.strictEqual(parseGoTestOutput(GO_MIXED, "", 1).failed, 1);
});

test("t.Parallel interleaving cannot cross-contaminate a failure: every event names its own test", () => {
  const p = parseGoTestOutput(GO_PARALLEL, "", 1);
  assert.deepStrictEqual(p.cases.map((c) => c.name), ["TestParC", "TestParA", "TestParB"]);
  const c = p.failures.find((f) => f.name === "TestParC");
  assert.ok(
    !c.message.includes("A step one") && !c.message.includes("TestParA"),
    `TestParC's detail must not carry TestParA's output; got:\n${c.message}`
  );
  assert.strictEqual(c.message, "    par_test.go:18: C noise\n    par_test.go:19: aggregateFanout(2) = 4, want 5");
  assert.strictEqual(
    p.failures.find((f) => f.name === "TestParA").message,
    "    par_test.go:7: A step one\n    par_test.go:8: aggregateFanout(3) = 6, want 7"
  );
});

test("a SKIP is ignored, not passed, and a skip-only run is not a green", async () => {
  const p = parseGoTestOutput(GO_SKIP, "", 0);
  assert.strictEqual(p.ignored, 1);
  assert.strictEqual(p.passed, 0);
  assert.strictEqual(p.ran, true, "it ran; it just did not execute an assertion");
  const res = await runFrameworkTestsAt(gotest(), placement(), ["TestGreenSkipGhost"], {
    runCommand: fakeRunner(GO_SKIP, "", 0),
  });
  assert.strictEqual(res.success, false, "nothing executed, so nothing is proven");
});

test("a green is a green: every named test passed and at least one executed", async () => {
  const res = await runFrameworkTestsAt(gotest(), placement(), ["TestZero"], {
    runCommand: fakeRunner(GO_JSON_PASS, "", 0),
  });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.passed, 1);
});

test("a build failure takes its message from STDOUT, because -json leaves stderr EMPTY", async () => {
  const p = parseGoTestOutput(GO_BUILD_FAIL, "", 1);
  assert.strictEqual(p.ran, false);
  assert.strictEqual(p.passed + p.failed + p.ignored, 0);
  assert.strictEqual(p.filterMatchedNothing, undefined, "the build failed; the filter was never applied");
  assert.strictEqual(p.environmentError, undefined, "a compile error IS a compile error");
  assert.strictEqual(
    p.buildError,
    '# probe [probe.test]\n./broke_test.go:6:14: cannot use "nope" (untyped string constant) as int value in variable declaration'
  );
  const res = await runFrameworkTestsAt(gotest(), placement(), ["TestBroken"], {
    runCommand: fakeRunner(GO_BUILD_FAIL, "", 1),
  });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.buildError, p.buildError, "reading stderr here would report a build failure with no message");
});

test("`[setup failed]` is an ENVIRONMENT error, not a compile error", async () => {
  const p = parseGoTestOutput(GO_SETUP_FAILED, "", 1);
  assert.strictEqual(p.ran, false);
  assert.strictEqual(p.buildError, undefined, "nothing the human wrote failed to compile");
  assert.match(p.environmentError, /missing go\.sum entry/);
  const res = await runFrameworkTestsAt(gotest(), placement(), ["TestNameHappy"], {
    runCommand: fakeRunner(GO_SETUP_FAILED, "", 1),
  });
  assert.strictEqual(res.buildError, undefined, "`the tests did not compile` is the wrong sentence for a cold cache");
  assert.match(res.environmentError, /missing go\.sum entry/);
});

test("a setup failure must NOT set filterMatchedNothing: same structure, different action", () => {
  // The trap: a setup failure is ALSO "a package-level terminal action with zero
  // Test-tagged events". A filter miss ends `Action: "pass"` at exit 0; a setup
  // failure ends `Action: "fail"` at exit 1 with FailedBuild set. Requiring the
  // terminal action to be `pass` is the whole distinguisher, and without it a
  // human with a cold module cache is told their filter matched nothing.
  assert.strictEqual(parseGoTestOutput(GO_SETUP_FAILED, "", 1).filterMatchedNothing, undefined);
  assert.strictEqual(parseGoTestOutput(GO_BUILD_FAIL, "", 1).filterMatchedNothing, undefined);
});

test("the `go get` the toolchain prints never reaches the human: this product forbids running it", () => {
  const detail = parseGoTestOutput(GO_SETUP_FAILED, "", 1).environmentError;
  assert.ok(!/go get/.test(detail), `the remediation must be stripped, not relayed; got:\n${detail}`);
  assert.ok(!/to add:?\s*$/.test(detail), "and the clause that introduced it must not be left dangling");
});

test("subtests are their own cases under their full slashed name (tolerance, not a feature)", () => {
  const p = parseGoTestOutput(GO_SUBTESTS, "", 1);
  assert.deepStrictEqual(
    p.cases.map((c) => `${c.name}:${c.outcome}`),
    ["TestSubs/sub_case:fail", "TestSubs/ok_case:pass", "TestSubs:fail"]
  );
  assert.strictEqual(
    p.failures.find((f) => f.name === "TestSubs/sub_case").message,
    "    sub_test.go:6: nope: 1",
    "each subtest's output is attributed to it by the Test field, so nothing has to be inferred"
  );
});

test("a line that is not JSON is SKIPPED, never thrown on", () => {
  for (const junk of [
    "",
    " ",
    "not json at all",
    "{",
    "{}",
    "[1,2,3]",
    "null",
    // The OLD text format, which this parser deliberately no longer reads.
    "=== RUN   TestX\n--- PASS: TestX (0.00s)\nPASS\nok  \tprobe\t0.001s\n",
  ]) {
    const p = parseGoTestOutput(junk, "", 0);
    assert.strictEqual(p.passed + p.failed + p.ignored, 0, `no counts from ${JSON.stringify(junk)}`);
    assert.strictEqual(p.ran, false, `did not run, for ${JSON.stringify(junk)}`);
  }
});

test("a garbage line BETWEEN good events costs only itself", () => {
  const withJunk = GO_MIXED.replace(
    String.raw`{"Time":"2026-07-27T17:05:47.074806077+10:00","Action":"output","Package":"probe","Output":"FAIL\n"}`,
    "go: downloading something\n{ not json"
  );
  assert.deepStrictEqual(parseGoTestOutput(withJunk, "", 1).cases, parseGoTestOutput(GO_MIXED, "", 1).cases);
});

test("CRLF output parses the same as LF", () => {
  assert.deepStrictEqual(parseGoTestOutput(GO_MIXED.replace(/\n/g, "\r\n"), "", 1), parseGoTestOutput(GO_MIXED, "", 1));
});

// ===========================================================================
// 3. The command
// ===========================================================================

const placement = (over) => ({
  targetPath: "/m/atlas_test.go",
  exists: false,
  mode: "sibling-file",
  runRoot: "/m",
  packageArg: ".",
  packageName: "probe",
  ...over,
});

test("the command is `go test -run '^(A|B)$' -json <pkg>` from the module root", () => {
  const cmd = gotest().buildCommand(placement(), ["TestA", "TestB"]);
  assert.strictEqual(cmd.command, "go");
  assert.deepStrictEqual(cmd.args, ["test", "-run", "^(TestA|TestB)$", "-json", "."]);
  assert.strictEqual(cmd.cwd, "/m");
});

test("-json is not optional, and it REPLACES -v", () => {
  const args = gotest().buildCommand(placement(), ["TestA"]).args;
  assert.ok(args.includes("-json"), "the text format is forgeable by the code under test");
  assert.ok(!args.includes("-v"), "-json emits the same per-test output, so -v is redundant");
});

test("the filter is anchored, which is what stops a superset name being blamed on this function", () => {
  // Measured: unanchored, TestAggregateFanoutHappy also selects
  // TestAggregateFanoutHappyPath.
  const args = gotest().buildCommand(placement(), ["TestAggregateFanoutHappy"]).args;
  assert.strictEqual(args[2], "^(TestAggregateFanoutHappy)$");
});

test("names are regex-escaped, because -run takes a REGEX and a name is data", () => {
  assert.strictEqual(gotest().buildCommand(placement(), ["Test_A.B"]).args[2], "^(Test_A\\.B)$");
});

test("the package argument rides along, so a nested package is scoped without changing cwd", () => {
  const cmd = gotest().buildCommand(placement({ packageArg: "./internal/shard" }), ["TestA"]);
  assert.deepStrictEqual(cmd.args, ["test", "-run", "^(TestA)$", "-json", "./internal/shard"]);
  assert.strictEqual(cmd.cwd, "/m", "go test runs from the MODULE root and scopes by argument");
});

test("the rung spawns with GoOracle's env, so it and the check agree about GOFLAGS and the network", () => {
  assert.deepStrictEqual(gotest().buildCommand(placement(), ["TestA"]).env, GO_SPAWN_ENV);
  assert.strictEqual(GO_SPAWN_ENV.GOPROXY, "off", "and offline is one of the things they agree about");
});

test("an empty test-name list is refused, never spelled `-run '^()$'`", () => {
  assert.throws(() => gotest().buildCommand(placement(), []), /empty filter/);
  assert.throws(() => gotest().buildCommand(placement(), [""]), /empty filter/);
});

test("the runner refuses an empty name list upstream of the builder as well", async () => {
  const lines = [];
  const res = await runFrameworkTestsAt(gotest(), placement(), [], {
    log: (l) => lines.push(l),
    runCommand: fakeRunner("", "", 0),
  });
  assert.strictEqual(res, undefined, "no command is spawned at all");
  assert.match(lines.join("\n"), /no test names/);
});

// ===========================================================================
// 4. The plumbing: the three holes phase 1 left
// ===========================================================================

function fakeRunner(stdout, stderr, exitCode) {
  const fn = async (cmd) => {
    fn.last = cmd;
    fn.seen = { stdout, stderr, exitCode };
    return { stdout, stderr, exitCode };
  };
  return fn;
}

test("HOLE 1: the exit code reaches the parse, which CompilerOracle.parseTestOutput(stdout) never could", async () => {
  const seen = [];
  const framework = {
    id: "probe",
    buildCommand: () => ({ command: "x", args: [], cwd: "/m" }),
    parseOutput: (stdout, stderr, exitCode) => {
      seen.push({ stdout, stderr, exitCode });
      return { ran: false, cases: [], failures: [], passed: 0, failed: 0, ignored: 0, casesComplete: true };
    },
  };
  await runFrameworkTestsAt(framework, placement(), ["TestA"], { runCommand: fakeRunner("out", "err", 8) });
  assert.deepStrictEqual(seen, [{ stdout: "out", stderr: "err", exitCode: 8 }], "C# MTP signals a filter miss with exactly this");
});

test("HOLE 2: env reaches the REAL spawn, merged over the parent environment", async () => {
  // No injected runCommand: this drives the shipped spawn. node is the one
  // interpreter guaranteed present, and it reports back what it was given.
  const framework = {
    id: "probe",
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "process.stdout.write((process.env.COLUMN80_PROBE||'-') + ':' + (process.env.PATH ? 'inherited' : 'clobbered'))"],
      cwd: process.cwd(),
      env: { COLUMN80_PROBE: "reached" },
    }),
    parseOutput: (stdout) => ({ ran: true, cases: [], failures: [], passed: 1, failed: 0, ignored: 0, casesComplete: true, environmentError: stdout }),
  };
  const res = await runFrameworkTestsAt(framework, placement(), ["TestA"], {});
  assert.strictEqual(res.environmentError, "reached:inherited", "the env is MERGED, not substituted");
});

test("HOLE 3: filterMatchedNothing survives the runner into the result object", async () => {
  const res = await runFrameworkTestsAt(gotest(), placement(), ["TestNope"], { runCommand: fakeRunner(GO_FILTER_MISS, "", 0) });
  assert.strictEqual(res.filterMatchedNothing, true);
  assert.strictEqual(res.buildError, undefined, "a filter miss is NOT `the tests did not compile`");
  assert.strictEqual(res.ran, false);
});

test("HOLE 3: environmentError survives too, and also stops the compile-error message", async () => {
  const framework = {
    id: "probe",
    buildCommand: () => ({ command: "x", args: [], cwd: "/m" }),
    parseOutput: () => ({
      ran: false,
      cases: [],
      failures: [],
      passed: 0,
      failed: 0,
      ignored: 0,
      casesComplete: false,
      environmentError: "the .NET 9 runtime is not installed",
    }),
  };
  const res = await runFrameworkTestsAt(framework, placement(), ["TestA"], { runCommand: fakeRunner("", "boom", 1) });
  assert.strictEqual(res.environmentError, "the .NET 9 runtime is not installed");
  assert.strictEqual(res.buildError, undefined, "nothing failed to compile, so nothing says it did");
  assert.strictEqual(res.casesComplete, false, "and the C# fidelity limit rides along for phase 5");
});

test("a red is still a red: a failing run reports through the framework path unchanged", async () => {
  const res = await runFrameworkTestsAt(gotest(), placement(), ["TestAggregateFanoutHappy", "TestAggregateFanoutZero"], {
    runCommand: fakeRunner(GO_MIXED, "", 1),
  });
  assert.strictEqual(res.ran, true);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.passed, 1);
  assert.strictEqual(res.failed, 1);
  assert.strictEqual(res.crateRoot, "/m");
  assert.strictEqual(res.buildError, undefined);
});

test("a prewarm flag on the framework path is IGNORED, because there is no prewarm command to build", async () => {
  // The prewarm verdict is "exit 0 is a warm cache". On a real test run that
  // would turn a filter matching nothing into a green.
  const lines = [];
  const res = await runFrameworkTestsAt(gotest(), placement(), ["TestNope"], {
    noRun: true,
    log: (l) => lines.push(l),
    runCommand: fakeRunner(GO_FILTER_MISS, "", 0),
  });
  assert.strictEqual(res.success, false);
  assert.match(lines.join("\n"), /prewarm ignored/);
});

test("BYTE-FROZEN: the Rust rung's command and result are untouched by the Go plumbing", async () => {
  // "Untouched by the plumbing" is the claim, and it is an equivalence: the
  // Rust rung must equal the shipped buildTestCommand, whatever that builds.
  // The literal below carries the `--` separator because the Q3 fix moved it
  // there (cargo takes one positional; libtest takes many), and `--exact`
  // because item 59 scoped the rung to the test it names. Neither move is the
  // Go work — the second assertion is the one that says so.
  const LIBTEST = "\nrunning 1 test\ntest tests::a ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";
  const runner = fakeRunner(LIBTEST, "", 0);
  const oracle = new RustOracle({ fileExists: (p) => p === "/w/Cargo.toml" });
  const res = await runTestOracle(oracle, "/w/src/lib.rs", ["tests::a"], { runCommand: runner });
  assert.deepStrictEqual(runner.last, { command: "cargo", args: ["test", "--lib", "--", "--exact", "tests::a"], cwd: "/w" });
  assert.deepStrictEqual(runner.last, buildTestCommand("/w", ["tests::a"]));
  assert.strictEqual(res.filterMatchedNothing, undefined, "Rust has no positive filter-miss tell, a fact not an omission");
  assert.strictEqual(res.environmentError, undefined);
  assert.strictEqual(res.casesComplete, undefined, "the shipped stdout-only parse says nothing about completeness");
  assert.deepStrictEqual(
    { ran: res.ran, success: res.success, passed: res.passed, failed: res.failed, ignored: res.ignored, cases: res.cases },
    { ran: true, success: true, passed: 1, failed: 0, ignored: 0, cases: parseLibtestOutput(LIBTEST).cases }
  );
});

// ===========================================================================
// 5. Placement
// ===========================================================================

test("the tests go in foo_test.go beside foo.go, run from the module root", () => {
  const r = go().placementFor("/m/atlas.go", "aggregateFanout", deps(MODULE_FILES, { "/m/atlas.go": "package probe\n" }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.placement.targetPath, path.join("/m", "atlas_test.go"));
  assert.strictEqual(r.placement.mode, "sibling-file");
  assert.strictEqual(r.placement.runRoot, "/m");
  assert.strictEqual(r.placement.exists, false, "no atlas_test.go on this disk yet");
});

test("packageArg is `.` at the module root and a forward-slashed relative path below it", () => {
  const at = (p) => go().placementFor(p, "f", deps(MODULE_FILES, {})).placement.packageArg;
  assert.strictEqual(at("/m/atlas.go"), ".");
  assert.strictEqual(at("/m/internal/shard/shard.go"), "./internal/shard");
});

test("importLine is undefined: the generated file declares the SAME package and needs no import", () => {
  const r = go().placementFor("/m/atlas.go", "f", deps(MODULE_FILES, { "/m/atlas.go": "package probe\n" }));
  assert.strictEqual(r.placement.importLine, undefined);
});

test("the package name comes from the SOURCE file's package line, never the directory name", () => {
  const r = go().placementFor(
    "/m/internal/shard/shard.go",
    "f",
    deps(MODULE_FILES, { "/m/internal/shard/shard.go": "// Package sharding ...\npackage sharding\n" })
  );
  assert.strictEqual(r.placement.packageName, "sharding", "the directory is `shard` and the package is `sharding`");
});

test("`exists` is whether the sibling is already on disk", () => {
  const r = go().placementFor("/m/atlas.go", "f", deps([...MODULE_FILES, "/m/atlas_test.go"], {}));
  assert.strictEqual(r.placement.exists, true);
});

test("a file already named foo_test.go targets ITSELF, and the MODE says so", () => {
  const r = go().placementFor("/m/atlas_test.go", "f", deps([...MODULE_FILES, "/m/atlas_test.go"], {}));
  assert.strictEqual(r.placement.targetPath, "/m/atlas_test.go", "never foo_test_test.go");
  assert.strictEqual(
    r.placement.mode,
    "same-file",
    "`sibling-file` over a target equal to the source is a lie about the target: a consumer that " +
      "opens the sibling would open the file it is already reading from"
  );
});

test("no go.mod is an honest refusal naming what is missing, and never a created go.mod", () => {
  const r = go().placementFor("/elsewhere/atlas.go", "f", deps([], {}));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refusal.reason, "no-project-root");
  assert.match(r.refusal.detail, /go\.mod/);
});

test("a go.work workspace refuses too, and the refusal SAYS go.work so the human stops hunting for a go.mod", () => {
  // Inherited from the check, not new here: GoOracle.detectCrateRoot returns
  // undefined for a module inside a workspace.
  const r = go().placementFor("/m/atlas.go", "f", deps([...MODULE_FILES, "/m/go.work"], {}));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refusal.reason, "no-project-root");
  assert.match(r.refusal.detail, /go\.work/);
});

test("goPackageClauseOf reads the clause structurally, not the first `package` word it sees", () => {
  assert.strictEqual(goPackageClauseOf("/* package wrong */\npackage right\n"), "right");
  assert.strictEqual(goPackageClauseOf('const s = "package wrong"\npackage right\n'), "right");
  assert.strictEqual(goPackageClauseOf("package main\n"), "main");
  assert.strictEqual(goPackageClauseOf("// no clause here\n"), undefined);
});

// ===========================================================================
// 6. The framework list
// ===========================================================================

test("gotest is always detected: `testing` is in the standard library, so there is nothing to look for", () => {
  const f = frameworkFor(go(), "/m", { fileExists: () => false });
  assert.strictEqual(f.ok, true);
  assert.strictEqual(f.framework.id, "gotest");
});

test("Go registers exactly one framework, which is why it is the only leg that cannot be honest-dark", () => {
  assert.strictEqual(go().frameworks.length, 1);
  assert.strictEqual(go().frameworks[0].displayName, "go test (testing)");
});

// ===========================================================================
// 7. returnTypeOf
// ===========================================================================

test("returnTypeOf: the contract's table, row for row", () => {
  const rows = [
    ["func f(a int) int {", "int"],
    ["func f(a int) (int, error)", "(int, error)"],
    ["func f(a int) (n int, err error)", "(n int, err error)"],
    ["func f(a int)", undefined],
    ["func f(a int) {", undefined],
    ["func (s *Shard) M(a int) string", "string"],
    ["func f(a func(int) int) string", "string"],
  ];
  for (const [sig, want] of rows) {
    assert.strictEqual(goReturnTypeOf(sig), want, sig);
  }
});

test("returnTypeOf DEPTH-COUNTS the parameter list, which is the whole reason it is not a regex", () => {
  // indexOf(")") lands on the receiver's close paren here...
  assert.strictEqual(goReturnTypeOf("func (s *Shard) M(a int) string"), "string");
  // ...and on the inner function type's here.
  assert.strictEqual(goReturnTypeOf("func f(a func(int) (int, error)) []byte"), "[]byte");
  assert.strictEqual(goReturnTypeOf("func f(m map[string]func() int) bool"), "bool");
});

test("returnTypeOf handles type parameters and a generic receiver", () => {
  assert.strictEqual(goReturnTypeOf("func Map[T any, U any](s []T, f func(T) U) []U"), "[]U");
  assert.strictEqual(goReturnTypeOf("func (c *Cache[K, V]) Get(k K) (V, bool)"), "(V, bool)");
});

test("returnTypeOf does not mistake a struct or interface type literal for the body brace", () => {
  assert.strictEqual(goReturnTypeOf("func f() struct{ A int } {"), "struct{ A int }");
  assert.strictEqual(goReturnTypeOf("func f() map[string]struct{} {"), "map[string]struct{}");
});

test("returnTypeOf answers undefined rather than guessing on text that is not a func declaration", () => {
  for (const junk of ["", "aggregateFanout(3)", "type T struct{}", "var x = 1"]) {
    assert.strictEqual(goReturnTypeOf(junk), undefined, junk);
  }
});

// ===========================================================================
// 8. Testability
// ===========================================================================

const DOC = "// AggregateFanout returns the fan-out of n.";

test("precedence is fixed, so the reported reason is stable: async -> io -> needs-fixture -> underspecified", () => {
  // Every one of these trips more than one leg; the FIRST is what is reported.
  assert.strictEqual(classifyGoTestability("func (s *Shard) F(c chan int, r io.Reader) int", DOC).reason, "async");
  assert.strictEqual(classifyGoTestability("func (s *Shard) F(r io.Reader) int", DOC).reason, "io");
  assert.strictEqual(classifyGoTestability("func (s *Shard) F(n int)", DOC).reason, "needs-fixture");
  assert.strictEqual(classifyGoTestability("func F(n int)", DOC).reason, "underspecified");
});

test("async is a channel or a context, because Go has no async keyword", () => {
  assert.strictEqual(classifyGoTestability("func F(c chan int) int", DOC).reason, "async");
  assert.strictEqual(classifyGoTestability("func F(c <-chan int) int", DOC).reason, "async");
  assert.strictEqual(classifyGoTestability("func F(ctx context.Context, n int) int", DOC).reason, "async");
  assert.strictEqual(classifyGoTestability("func F(n int) int", DOC).testable, true, "a goroutine in the BODY is invisible here, and that is an accepted residual");
});

test("io covers os, net, io, bufio AND http — net/http imports as `http` and it was 10 measured survivors", () => {
  for (const sig of [
    "func F(f *os.File) int",
    "func F(c net.Conn) int",
    "func F(r io.Reader) int",
    "func F(s *bufio.Scanner) int",
    "func F(w http.ResponseWriter) int",
    "func F(r *http.Request) int",
  ]) {
    assert.strictEqual(classifyGoTestability(sig, DOC).reason, "io", sig);
  }
});

test("the io markers are word-bounded, so a package whose name merely ends in one is not io", () => {
  assert.strictEqual(classifyGoTestability("func F(r bio.Reader) int", DOC).testable, true);
  assert.strictEqual(classifyGoTestability("func F(p myos.Path) int", DOC).testable, true);
});

test("a receiver is needs-fixture, Go's largest refusal at 60.6% of cobra and gin", () => {
  assert.strictEqual(classifyGoTestability("func (s *Shard) M(a int) string", DOC).reason, "needs-fixture");
  assert.strictEqual(classifyGoTestability("func (s Shard) M(a int) string", DOC).reason, "needs-fixture");
  assert.strictEqual(classifyGoTestability("func M(s Shard, a int) string", DOC).testable, true, "a plain func taking the same type is not a fixture problem");
});

test("`not-exported` must NEVER fire for Go: the _test.go sibling sees unexported names", () => {
  for (const sig of ["func rpad(s string, n int) string", "func safeUint16(n int) uint16", "func Exported(n int) int"]) {
    assert.notStrictEqual(classifyGoTestability(sig, DOC).reason, "not-exported", sig);
  }
  assert.strictEqual(classifyGoTestability("func rpad(s string, padding int) string", DOC).testable, true, "unexported is a first-class target here");
});

test("no doc comment is underspecified; Go's name-first convention is NOT required", () => {
  assert.strictEqual(classifyGoTestability("func F(n int) int", undefined).reason, "underspecified");
  assert.strictEqual(classifyGoTestability("func F(n int) int", "   ").reason, "underspecified");
  assert.strictEqual(
    classifyGoTestability("func F(n int) int", "// Returns the fan-out. Does not start with the name.").testable,
    true,
    "a comment that does not open with the function name is still a contract"
  );
});

test("(T, error) is TESTABLE; three or more results is not", () => {
  assert.strictEqual(classifyGoTestability("func F(n int) (int, error)", DOC).testable, true);
  assert.strictEqual(classifyGoTestability("func F(n int) (n2 int, err error)", DOC).testable, true);
  const three = classifyGoTestability("func F(n int) (int, string, error)", DOC);
  assert.strictEqual(three.reason, "underspecified");
  assert.match(three.detail, /3 return values/);
});

test("no return value is underspecified: there is nothing to assert", () => {
  assert.strictEqual(classifyGoTestability("func F(n int)", DOC).detail, "no return value to assert — side-effect only");
});

// ===========================================================================
// 9. Blank values
// ===========================================================================

test("blank values: the contract's table, row for row", () => {
  const rows = [
    ["int", "${1}", 1],
    ["uint64", "${1}", 1],
    ["float64", "${1}", 1],
    ["string", "${1}", 1],
    ["bool", "${1}", 1],
    ["byte", "${1}", 1],
    ["rune", "${1}", 1],
    ["[]string", "[]string{${1:/* string */}}", 1],
    ["map[string]int", "map[string]int{${1:/* string, int */}}", 1],
    ["[3]int", "[3]int{${1}, ${2}, ${3}}", 3],
    ["*Shard", "${1:/* *Shard */}", 1],
    ["Manifest", "${1:/* Manifest */}", 1],
    ["error", "${1:/* error */}", 1],
  ];
  for (const [ty, rhs, holes] of rows) {
    assert.deepStrictEqual(goRenderBlankValue(ty), { rhs, holes }, ty);
  }
});

test("(T, error) renders the T by the rules and then the error as its own hole", () => {
  assert.deepStrictEqual(goRenderBlankValue("(int, error)"), { rhs: "${1}, ${2:/* error */}", holes: 2 });
  assert.deepStrictEqual(goRenderBlankValue("([]byte, error)"), { rhs: "[]byte{${1:/* byte */}}, ${2:/* error */}", holes: 2 });
});

test("named results are treated BY POSITION, the name dropped and the type rendered", () => {
  assert.deepStrictEqual(goRenderBlankValue("(n int, err error)"), { rhs: "${1}, ${2:/* error */}", holes: 2 });
});

test("startHole numbers holes across a whole module, so two assertions never collide", () => {
  assert.deepStrictEqual(goRenderBlankValue("(int, error)", { startHole: 5 }), { rhs: "${5}, ${6:/* error */}", holes: 2 });
});

test("a type hint with a snippet metacharacter is escaped, or it closes the placeholder early", () => {
  assert.deepStrictEqual(goRenderBlankValue("map[string]struct{}"), {
    // `{` is safe inside a placeholder and is left alone; the `}` is the one
    // that would close it early.
    rhs: "map[string]struct{}{${1:/* string, struct{\\} */}}",
    holes: 1,
  });
});

test("a fixed-length array scaffolds its length, which the TYPE determines; a slice does not", () => {
  assert.strictEqual(goRenderBlankValue("[2]string").holes, 2);
  assert.strictEqual(goRenderBlankValue("[]string").holes, 1, "how many elements is contract-determined and stays one hole");
});

test("a fixed array is CAPPED, because a snippet the human cannot Tab through is not a gesture", () => {
  assert.deepStrictEqual(goRenderBlankValue("[8]byte").holes, 8, "at the cap, still scaffolded");
  const big = goRenderBlankValue("[65536]byte");
  assert.strictEqual(big.holes, 1, "past the cap it collapses to one hinted hole, the way a slice does");
  assert.strictEqual(big.rhs, "[65536]byte{${1:/* byte */}}");
  assert.ok(goRenderBlankValue("[1000000]byte").rhs.length < 200, "and no 10.9 MB snippet is ever built");
});

test("a RUN of grouped names shares the type of the next typed element, the way Go's parser reads it", () => {
  // `func f() (a, b int)` is ordinary Go and both results are int. Corpus:
  // (scaleX, scaleY float64), (truth, ok bool), (location, context string),
  // seven such lists across cobra, gin and hugo.
  assert.deepStrictEqual(goRenderBlankValue("(a, b int)"), { rhs: "${1}, ${2}", holes: 2 });
  assert.deepStrictEqual(goRenderBlankValue("(scaleX, scaleY float64)"), { rhs: "${1}, ${2}", holes: 2 });
  assert.deepStrictEqual(goRenderBlankValue("(truth, ok bool)"), { rhs: "${1}, ${2}", holes: 2 });
  assert.deepStrictEqual(goRenderBlankValue("(a, b int, c string)"), { rhs: "${1}, ${2}, ${3}", holes: 3 });
  assert.deepStrictEqual(goRenderBlankValue("(v, err *Shard)"), {
    rhs: "${1:/* *Shard */}, ${2:/* *Shard */}",
    holes: 2,
  });
  assert.deepStrictEqual(
    goRenderBlankValue("(int, error)"),
    { rhs: "${1}, ${2:/* error */}", holes: 2 },
    "an UNNAMED list is the same shape with no typed element ever arriving, and must not regress"
  );
});

// ===========================================================================
// 10. The expected-value locator
// ===========================================================================

const spansOf = (text) => goExpectedValueSpans(text).map((s) => text.slice(s.start, s.end));

test("the expected value is the right-hand side of `want :=`, and nothing else", () => {
  const src = `func TestA(t *testing.T) {
	got := aggregateFanout(3)
	want := 7
	if got != want {
		t.Errorf("aggregateFanout(3) = %v, want %v", got, want)
	}
}`;
  assert.deepStrictEqual(spansOf(src), ["7"]);
});

test("it must never match `got :=`, which is the CALL UNDER TEST", () => {
  assert.deepStrictEqual(spansOf("\tgot := aggregateFanout(3)\n\twant := 7\n"), ["7"]);
});

test("a `want` inside a string, a comment or a raw backtick string is not an assignment", () => {
  assert.deepStrictEqual(spansOf('\ts := "want := 1"\n\twant := 7\n'), ["7"]);
  assert.deepStrictEqual(spansOf("\t// want := 1\n\twant := 7\n"), ["7"]);
  assert.deepStrictEqual(spansOf("\t/* want := 1 */\n\twant := 7\n"), ["7"]);
  assert.deepStrictEqual(spansOf("\ts := `want := 1\\n`\n\twant := 7\n"), ["7"], "a backslash is NOT an escape in a Go raw string");
});

test("a struct FIELD named want is not an assignment: one colon is not `:=`", () => {
  assert.deepStrictEqual(spansOf("\tc := cfg{\n\t\twant: 1,\n\t}\n\twant := 7\n"), ["7"]);
});

test("`wantErr` is a different identifier and is left alone", () => {
  assert.deepStrictEqual(spansOf("\twantErr := true\n\twant := 7\n"), ["7"]);
});

test("the multi-assign form is not the generated shape and is refused rather than half-blanked", () => {
  // Blanking the wrong half of `got, want := f(), 7` would delete the call.
  assert.deepStrictEqual(spansOf("\tgot, want := aggregateFanout(3), 7\n"), []);
});

test("a value spanning several lines is captured whole", () => {
  const src = "\twant := []int{\n\t\t1,\n\t\t2,\n\t}\n\tif true {}\n";
  assert.deepStrictEqual(spansOf(src), ["[]int{\n\t\t1,\n\t\t2,\n\t}"]);
});

test("a trailing comment is not part of the expected value", () => {
  assert.deepStrictEqual(spansOf("\twant := 7 // the answer\n"), ["7"]);
});

test("a value continued onto the next line is ONE value: Go's own semicolon-insertion rule", () => {
  // gofmt-clean and go-vet-clean, verified on go1.26.5. Blanking half of it
  // leaves the model's second operand in the human's buffer AND a syntax error
  // behind it, which is the blank-value invariant partially inverted.
  const src =
    "func TestRenderHappy(t *testing.T) {\n" +
    "\tgot := Render()\n" +
    '\twant := "aaaaaaaaaaaaaaaaaaaa" +\n' +
    '\t\t"bbbbbbbbbbbbbbbbbbbb"\n' +
    "\tif got != want {\n" +
    '\t\tt.Errorf("Render() = %v, want %v", got, want)\n' +
    "\t}\n" +
    "}\n";
  assert.deepStrictEqual(spansOf(src), ['"aaaaaaaaaaaaaaaaaaaa" +\n\t\t"bbbbbbbbbbbbbbbbbbbb"']);
});

test("a line ending in a VALUE still ends the statement, so the next line is never swallowed", () => {
  assert.deepStrictEqual(spansOf("\twant := 7\n\tgot := f()\n"), ["7"]);
  assert.deepStrictEqual(spansOf("\twant := []int{1}\n\tgot := f()\n"), ["[]int{1}"]);
  assert.deepStrictEqual(spansOf("\twant := f(1)\n\tx()\n"), ["f(1)"]);
});

test("several assertions give several spans, ascending and non-overlapping", () => {
  const src = "\twant := 1\n\tx()\n\twant := 2\n";
  const spans = goExpectedValueSpans(src);
  assert.strictEqual(spans.length, 2);
  assert.ok(spans[0].end <= spans[1].start, "blankTestModule's slice loop needs ascending, disjoint spans");
});

// ===========================================================================
// 11. Names, markers, scaffold
// ===========================================================================

test("a test name go test would silently IGNORE is rejected at generation time", () => {
  assert.strictEqual(go().testNameIsValid("TestAggregateFanout"), true);
  assert.strictEqual(go().testNameIsValid("Test_helper"), true);
  assert.strictEqual(go().testNameIsValid("Testaggregate"), false, "lowercase after Test: go test never runs it");
  assert.strictEqual(go().testNameIsValid("TestingThing"), false);
  assert.strictEqual(go().testNameIsValid("aggregateTest"), false);
});

test("generatedTestNames reads `func TestX` out of the marked region and nothing outside it", () => {
  const file = `package probe

import "testing"

func TestHandWritten(t *testing.T) {}

// column80-tests:aggregateFanout:begin
func TestAggregateFanoutHappy(t *testing.T) {}
func TestAggregateFanoutZero(t *testing.T) {}
// column80-tests:aggregateFanout:end
`;
  assert.deepStrictEqual(go().generatedTestNames(file, "aggregateFanout"), [
    "TestAggregateFanoutHappy",
    "TestAggregateFanoutZero",
  ]);
  assert.deepStrictEqual(go().generatedTestNames(file, "other"), [], "another function's marker matches nothing");
  assert.deepStrictEqual(go().generatedTestNames("package probe\n", "aggregateFanout"), []);
});

test("the marker prefix is Go's line comment, shared with the scaffold so the two cannot drift", () => {
  assert.strictEqual(go().markerPrefix, "//");
  const plan = go().scaffold({ existingText: "", generatedTests: "func TestA(t *testing.T) {}", markerId: "f", placement: placement() });
  assert.deepStrictEqual(go().generatedTestNames(plan.text, "f"), ["TestA"], "what scaffold writes is what generatedTestNames reads");
});

const GENERATED = "func TestAggregateFanoutHappy(t *testing.T) {\n\tgot := aggregateFanout(3)\n\twant := 7\n}";

test("a new file is the whole text: the source's package, the testing import, then the marked region", () => {
  const plan = go().scaffold({ existingText: "", generatedTests: GENERATED, markerId: "aggregateFanout", placement: placement() });
  assert.strictEqual(plan.start, 0);
  assert.strictEqual(plan.end, 0);
  assert.strictEqual(
    plan.text,
    `package probe

import "testing"

// column80-tests:aggregateFanout:begin
${GENERATED}
// column80-tests:aggregateFanout:end
`
  );
});

test("the new file's package is the SOURCE's, and an ABSENT one is a refusal, never a guess", () => {
  const withName = go().scaffold({ existingText: "", generatedTests: "func TestA(t *testing.T) {}", markerId: "f", placement: placement({ packageName: "sharding" }) });
  assert.match(withName.text, /^package sharding\n/);
  // The directory basename was the old fallback and it is wrong twice over.
  // `go-scratch` gives `package go-scratch`, which go vet reads as `expected
  // 'IDENT', found 'go'`; and the two genuinely differ once in cobra and 31
  // times in hugo, mostly `package main` under a differently named directory.
  assert.throws(
    () =>
      go().scaffold({
        existingText: "",
        generatedTests: "func TestA(t *testing.T) {}",
        markerId: "f",
        placement: placement({ packageName: undefined, targetPath: "/m/go-scratch/a_test.go" }),
      }),
    /package clause was not resolved/
  );
  assert.throws(
    () =>
      go().scaffold({
        existingText: "",
        generatedTests: "func TestA(t *testing.T) {}",
        markerId: "f",
        placement: placement({ packageName: "go-scratch" }),
      }),
    /cannot be guessed/,
    "and a packageName that is not a legal Go identifier is refused rather than written out"
  );
});

test("a target file with content but NO package clause gets the clause, not a bare import", () => {
  // go vet on the old output: `expected 'package', found 'import'`. A Go file
  // that cannot compile is not a scaffold.
  const plan = go().scaffold({
    existingText: "// TODO write tests\n",
    generatedTests: "func TestGen(t *testing.T) {}",
    markerId: "x",
    placement: placement({ exists: true }),
  });
  assert.match(plan.text, /^package probe\n/);
  assert.match(plan.text, /import "testing"/);
  assert.match(plan.text, /\/\/ TODO write tests/, "and the human's line survives");
});

test("regenerating replaces EXACTLY the marked region and touches nothing else", () => {
  const existing = `package probe

import "testing"

func TestHandWritten(t *testing.T) {}

// column80-tests:f:begin
func TestOld(t *testing.T) {}
// column80-tests:f:end
`;
  const plan = go().scaffold({ existingText: existing, generatedTests: "func TestNew(t *testing.T) {}", markerId: "f", placement: placement({ exists: true }) });
  assert.strictEqual(plan.mode, "replace-generated");
  const after = existing.slice(0, plan.start) + plan.text + existing.slice(plan.end);
  assert.match(after, /func TestHandWritten/, "the developer's own test is never clobbered");
  assert.match(after, /func TestNew/);
  assert.doesNotMatch(after, /func TestOld/);
});

test("an existing file that already imports testing is APPENDED to, with no duplicate import", () => {
  const existing = 'package probe\n\nimport (\n\t"fmt"\n\t"testing"\n)\n\nfunc TestHandWritten(t *testing.T) {}\n';
  const plan = go().scaffold({ existingText: existing, generatedTests: GENERATED, markerId: "f", placement: placement({ exists: true }) });
  assert.strictEqual(plan.mode, "extend-existing");
  assert.strictEqual(plan.start, existing.length, "an append, so the human's file is untouched above it");
  const after = existing.slice(0, plan.start) + plan.text;
  assert.strictEqual(after.match(/"testing"/g).length, 1, "an import block that already has testing must not gain a duplicate");
  assert.match(after, /column80-tests:f:begin/);
});

test("an existing file MISSING the testing import gains it in the import block, because Go forbids a late import", () => {
  const existing = 'package probe\n\nimport (\n\t"fmt"\n)\n\nfunc helper() {}\n';
  const plan = go().scaffold({ existingText: existing, generatedTests: GENERATED, markerId: "f", placement: placement({ exists: true }) });
  assert.strictEqual(plan.mode, "extend-existing");
  assert.strictEqual(plan.start, 0, "the import is above and the region below, and a plan is ONE contiguous edit");
  assert.strictEqual(plan.end, existing.length);
  assert.match(plan.text, /import \(\n\t"fmt"\n\t"testing"\n\)/);
  assert.match(plan.text, /func helper\(\) \{\}/, "and everything the human wrote survives");
  assert.match(plan.text, /column80-tests:f:end/);
});

test("a single-spec import gains a second import declaration rather than a broken block", () => {
  const existing = 'package probe\n\nimport "fmt"\n\nfunc helper() {}\n';
  const plan = go().scaffold({ existingText: existing, generatedTests: GENERATED, markerId: "f", placement: placement({ exists: true }) });
  assert.match(plan.text, /import "fmt"\nimport "testing"/);
});

test("a file with no imports at all gains one after the package clause", () => {
  const existing = "package probe\n\nfunc helper() {}\n";
  const plan = go().scaffold({ existingText: existing, generatedTests: GENERATED, markerId: "f", placement: placement({ exists: true }) });
  assert.match(plan.text, /^package probe\n\nimport "testing"\n/);
});

test("the model's indentation is normalized: Go's top-level funcs sit at column 0", () => {
  const plan = go().scaffold({
    existingText: "",
    generatedTests: "    func TestA(t *testing.T) {\n        x := 1\n    }",
    markerId: "f",
    placement: placement(),
  });
  assert.match(plan.text, /\nfunc TestA\(t \*testing\.T\) \{\n    x := 1\n\}\n/);
});

// ===========================================================================
// 12. ABSORBED FROM THE PHASE 2 ADVERSARIAL REVIEW.
//
// `test/review-v31-phase2.test.cjs` was the reviewer's evidence file. Its
// findings are fixed above and its surviving attack rows live here, so there is
// no second permanent file duplicating this suite and no red file nobody can
// explain. The four rows the loop DEFERRED are `test.skip` below, each naming
// the trigger that un-defers it.
//
// Two of the reviewer's rows are NOT carried over. The Rust byte-freeze
// differential built a bundle from the newest commit predating this phase via
// `git archive` + esbuild, which stops working once the phase is 40 commits
// back; `blind-v8-testrung` and the BYTE-FROZEN row in section 4 are the
// standing pins, and the differential did its job as a one-shot proof.
// ===========================================================================

test("returnTypeOf survives the review's harder signatures", () => {
  const rows = [
    ["func F[T int|string](a T) T {", "T"],
    ["func F(a ...func() error) error {", "error"],
    ["func F(\n\ta int,\n\tb string,\n) (int, error) {", "(int, error)"],
    ["func F() <-chan int {", "<-chan int"],
    ["func F() func(int) (int, error) {", "func(int) (int, error)"],
    ["func Map[K comparable, V any](m map[K]V) []V {", "[]V"],
    ["func (s *Shard[T]) M(a int) string {", "string"],
    ["func F(a int)", undefined],
  ];
  for (const [sig, want] of rows) {
    assert.strictEqual(goReturnTypeOf(sig), want, sig);
  }
});

test("the locator survives the review's literal-profile attacks", () => {
  const BT = String.fromCharCode(96);
  assert.deepStrictEqual(
    spansOf(`func T() {\n\tp := ${BT}C:\\${BT}\n\twant := 7\n}\n`),
    ["7"],
    "a raw string ending in a backslash: the backslash is not an escape"
  );
  assert.deepStrictEqual(
    spansOf(`func T() {\n\ts := ${BT}\nwant := 999\n${BT}\n\twant := 7\n}\n`),
    ["7"],
    "a `want :=` inside a raw string is text"
  );
  assert.deepStrictEqual(
    spansOf(`func T() {\n\ts := ${BT}/*${BT}\n\twant := 7\n}\n`),
    ["7"],
    "an unterminated /* inside a raw string opens no comment"
  );
  assert.deepStrictEqual(
    spansOf("func T() {\n\t/* outer /* inner */\n\twant := 7\n}\n"),
    ["7"],
    "Go's block comments do not nest"
  );
  assert.deepStrictEqual(
    spansOf("func T() {\n\tgot := cfg.want\n\twant := 7\n}\n"),
    ["7"],
    "`cfg.want` is a field read, not an assignment"
  );
});

test("the env the rung pins reaches a REAL child merged over the parent, not substituted", async () => {
  const framework = {
    id: "probe",
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "process.stdout.write(JSON.stringify(process.env))"],
      cwd: process.cwd(),
      env: { ...GO_SPAWN_ENV },
    }),
    parseOutput: (stdout) => ({
      ran: true,
      cases: [],
      failures: [],
      passed: 1,
      failed: 0,
      ignored: 0,
      casesComplete: true,
      environmentError: stdout,
    }),
  };
  const res = await runFrameworkTestsAt(framework, placement(), ["TestA"], {});
  const e = JSON.parse(res.environmentError);
  assert.strictEqual(e.GOPROXY, "off");
  assert.strictEqual(e.GOWORK, "off");
  assert.strictEqual(e.GOENV, "off");
  assert.strictEqual(typeof e.PATH, "string", "PATH must survive the merge or `go` is unfindable");
  assert.strictEqual(e.HOME, process.env.HOME, "HOME must survive or GOCACHE and GOMODCACHE relocate");
});

// --- DEFERRED to phase 6, each with its trigger ----------------------------

test.skip(
  "DEFERRED to phase 6 (fnGen wiring): a whole-file rewrite wears the `extend-existing` mode",
  () => {
    // The shipped Rust consumer gates a preview on `mode === "replace-generated"`
    // alone, so a plan spanning the whole file under `extend-existing` would
    // reach the buffer with no diff and no review. Unreachable until the Go leg
    // is wired into fnGen, which is phase 6's item; the fix belongs with the
    // consumer that reads the mode, not with the producer alone.
    const existing = 'package probe\n\nimport (\n\t"fmt"\n)\n\nfunc TestHuman(t *testing.T) {}\n';
    const plan = go().scaffold({
      existingText: existing,
      generatedTests: "func TestGen(t *testing.T) {}",
      markerId: "f",
      placement: placement({ exists: true }),
    });
    assert.ok(!(plan.start === 0 && plan.end === existing.length) || plan.mode !== "extend-existing");
  }
);

test.skip("DEFERRED to phase 6 (fnGen wiring): Go has no zero-spans floor", () => {
  // The model is told to write `want :=`. When it writes `var want = 7` instead
  // there is no span, and nothing in the Go leg reports zero spans as a refusal
  // the way Rust's holes===0 floor does — so the model's guess would ship
  // verbatim. The floor lives in the gesture that consumes the spans.
  assert.deepStrictEqual(spansOf("func T() {\n\tgot := f()\n\tvar want = 7\n\tif got != want {}\n}\n"), ["7"]);
});

test.skip("DEFERRED to phase 6 (shared runRung plumbing, under the Rust freeze): `[no test files]`", async () => {
  // `[no test files]` ends `Action: "skip"` at package level with exit 0, and
  // filterMatchedNothing deliberately requires `pass` so a setup failure cannot
  // claim it. So this run has no tell, `ran` is false, and runRung falls back to
  // stderr — which -json leaves EMPTY, giving an empty-string buildError that a
  // consumer testing `buildError !== undefined` renders as "the tests did not
  // compile" with no message. The fix is in the shared runRung fallback, which
  // Rust's byte-freeze pins.
  const res = await runFrameworkTestsAt(gotest(), placement(), ["TestX"], {
    runCommand: fakeRunner(GO_NO_TEST_FILES, "", 0),
  });
  assert.strictEqual(res.success, false, "nothing ran, so no green");
  assert.strictEqual(res.buildError, undefined);
});

test.skip("DEFERRED to phase 6 (nit): a comment between the parameter list and the return type", () => {
  // `func F(a int) /* the widened count */ int` carries the comment into the
  // type, so renderBlankValue emits a hint the human cannot read. Legal Go,
  // never seen in the corpus, and cosmetic: the hole is still one hole.
  assert.strictEqual(goReturnTypeOf("func F(a int) /* the widened count */ int {"), "int");
});
