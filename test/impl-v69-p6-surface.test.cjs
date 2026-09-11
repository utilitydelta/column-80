// Implementer's tests for session-v69 phase 6: the two things the product says
// once the check can SEE the tests it wrote.
//
// 1. `fileIsCheckable` — will the check for this path actually compile it? The
//    test-authoring gesture asks it about the file it just wrote, which is not
//    the file `runOracleCheck` asks about. It fails OPEN by answering undefined:
//    telling a human their tests are unchecked when they are not is the
//    expensive direction.
// 2. A LIVE TypeScript row, because the whole question is whether a project's
//    `include` happens to cover a `.test.ts` and no fixture can answer that.
//
// The blind half of phase 6 is test/blind-v69-p6-generated-test-errors.test.cjs.
//
// Run: SKIP_LIVE=1 node --test test/impl-v69-p6-surface.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "impl-v69-p6-surface",
    `export { fileIsCheckable, oracleFor } from "../src/core/compilerOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());
const { fileIsCheckable, oracleFor } = mod;

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

test("bundle: fileIsCheckable is exported", () => {
  assert.strictEqual(bundleError, undefined, `bundle failed: ${bundleError}`);
  assert.strictEqual(typeof fileIsCheckable, "function");
});

// A strategy stub. Only the four members fileIsCheckable touches are real.
function stubOracle({ root = "/w/proj", covered = true, exitCode = 0, fallbacks, throws } = {}) {
  return {
    language: "stub",
    checkLabel: "stub check",
    appliesTo: () => true,
    detectCrateRoot: () => root,
    buildCheckCommand: () => ({ command: "x", args: [], cwd: root }),
    parseCheckOutput: () => [],
    checkSuccess: () => true,
    resolveDiagnosticPath: (r, f) => path.join(r, f),
    isAssertionShaped: () => false,
    buildCoverageCommand: (r, project) => ({ command: "probe", args: [project ?? "nearest"], cwd: r }),
    fileCovered: (stdout) => stdout === "covered",
    ...(fallbacks === undefined ? {} : { coverageFallbackProjects: () => fallbacks }),
    __runner: () => {
      if (throws) throw new Error("probe exploded");
      return { stdout: covered ? "covered" : "not-covered", stderr: "", exitCode };
    },
  };
}

const runnerOf = (oracle, seen) => async (cmd) => {
  if (seen) seen.push(cmd.args[0]);
  return oracle.__runner(cmd);
};

gtest("[impl P6] a strategy with no coverage probe answers undefined, not false", async () => {
  const bare = stubOracle();
  delete bare.buildCoverageCommand;
  delete bare.fileCovered;
  assert.strictEqual(await fileIsCheckable(bare, "/w/proj/a.test.ts", { runCommand: runnerOf(bare) }), undefined);
});

gtest("[impl P6] no crate root answers undefined", async () => {
  const o = stubOracle();
  o.detectCrateRoot = () => undefined;
  assert.strictEqual(await fileIsCheckable(o, "/elsewhere/a.test.ts", { runCommand: runnerOf(o) }), undefined);
});

gtest("[impl P6] a covered file answers true", async () => {
  const o = stubOracle({ covered: true });
  assert.strictEqual(await fileIsCheckable(o, "/w/proj/a.test.ts", { runCommand: runnerOf(o) }), true);
});

gtest("[impl P6] a clean probe that does NOT list the file answers false", async () => {
  const o = stubOracle({ covered: false });
  assert.strictEqual(await fileIsCheckable(o, "/w/proj/a.test.ts", { runCommand: runnerOf(o) }), false);
});

gtest("[impl P6] a probe that exits non-zero is UNANSWERABLE, never uncovered", async () => {
  const o = stubOracle({ covered: false, exitCode: 2 });
  assert.strictEqual(
    await fileIsCheckable(o, "/w/proj/a.test.ts", { runCommand: runnerOf(o) }),
    undefined,
    "a crashed probe must not be reported to the human as 'your tests are unchecked'"
  );
});

gtest("[impl P6] a probe that throws is UNANSWERABLE", async () => {
  const o = stubOracle({ throws: true });
  assert.strictEqual(await fileIsCheckable(o, "/w/proj/a.test.ts", { runCommand: runnerOf(o) }), undefined);
});

gtest("[impl P6] the fallback projects are asked before the answer is false", async () => {
  // The solution-shell tsconfig shape: the nearest project lists nothing and a
  // referenced project is what actually compiles the file. Without this every
  // such repo would get a false alarm on every test generation.
  const o = stubOracle({ covered: false, fallbacks: ["/w/proj/tsconfig.app.json"] });
  const seen = [];
  o.__runner = (cmd) => ({
    stdout: cmd.args[0] === "/w/proj/tsconfig.app.json" ? "covered" : "not-covered",
    stderr: "",
    exitCode: 0,
  });
  assert.strictEqual(await fileIsCheckable(o, "/w/proj/a.test.ts", { runCommand: runnerOf(o, seen) }), true);
  assert.deepStrictEqual(seen, ["nearest", "/w/proj/tsconfig.app.json"], "the nearest project is probed first");
});

gtest("[impl P6] no fallback covers it either: false, and every candidate was asked", async () => {
  const o = stubOracle({ covered: false, fallbacks: ["/w/proj/a.json", "/w/proj/b.json"] });
  const seen = [];
  assert.strictEqual(await fileIsCheckable(o, "/w/proj/a.test.ts", { runCommand: runnerOf(o, seen) }), false);
  assert.deepStrictEqual(seen, ["nearest", "/w/proj/a.json", "/w/proj/b.json"]);
});

gtest("[impl P6] a fallback probe that throws makes the whole answer unanswerable", async () => {
  const o = stubOracle({ covered: false, fallbacks: ["/w/proj/a.json"] });
  o.__runner = (cmd) => {
    if (cmd.args[0] !== "nearest") throw new Error("boom");
    return { stdout: "not-covered", stderr: "", exitCode: 0 };
  };
  assert.strictEqual(await fileIsCheckable(o, "/w/proj/a.test.ts", { runCommand: runnerOf(o) }), undefined);
});

// ===========================================================================
// LIVE. The real TypeScript oracle, the real tsc, a real tsconfig. Whether a
// `.test.ts` is compiled is a fact about the project's `include` and nothing
// headless can answer it.
// ===========================================================================

const SKIP_LIVE_TS = process.env.SKIP_LIVE ? "SKIP_LIVE set" : false;
const scratch = [];
test.after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});

/** A throwaway TS project whose node_modules/typescript is a symlink to this
 *  repo's, because the oracle runs the PROJECT'S OWN tsc and walks up for it. */
function tsProject(tag, include) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `c80-v69-p6-${tag}-${crypto.randomBytes(3).toString("hex")}-`));
  scratch.push(dir);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  fs.symlinkSync(path.join(__dirname, "..", "node_modules", "typescript"), path.join(dir, "node_modules", "typescript"), "junction");
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2020", module: "commonjs" }, include }, null, 2)
  );
  fs.writeFileSync(path.join(dir, "src", "lib.ts"), "export function firstEven(xs: number[]): number | undefined {\n  return xs.find((x) => x % 2 === 0);\n}\n");
  fs.writeFileSync(
    path.join(dir, "src", "lib.test.ts"),
    "import { firstEven } from './lib';\nit('works', () => { firstEven([1, 2]); });\n"
  );
  return dir;
}

test("[P6 live] ts: a .test.ts the project INCLUDES is checkable", { skip: SKIP_LIVE_TS }, async () => {
  const dir = tsProject("in", ["src"]);
  const oracle = oracleFor("typescript");
  assert.ok(oracle, "the TS oracle is registered");
  assert.strictEqual(
    await fileIsCheckable(oracle, path.join(dir, "src", "lib.test.ts"), { log: () => {} }),
    true
  );
});

test("[P6 live] ts: a .test.ts the project EXCLUDES is NOT checkable, which is the whole point", { skip: SKIP_LIVE_TS }, async () => {
  // The shape the goal names: "a project whose tests live outside the checked
  // project, or under a separate tsconfig.test.json, would be just as blind as
  // Go". The gesture writes the file anyway and tells the human it is unchecked.
  const dir = tsProject("out", ["src/lib.ts"]);
  const oracle = oracleFor("typescript");
  assert.strictEqual(
    await fileIsCheckable(oracle, path.join(dir, "src", "lib.test.ts"), { log: () => {} }),
    false
  );
  assert.strictEqual(
    await fileIsCheckable(oracle, path.join(dir, "src", "lib.ts"), { log: () => {} }),
    true,
    "and the source file beside it still is, so the probe is discriminating rather than broken"
  );
});
