// Blind oracle: the Run TDD Tests refusal when the function has NO marked
// region, reported live against 2.3.0 on a real Rust file
// (celeriant_shard/src/fetch_catchup_entries.rs, 8 hand-written `#[test]` fns,
// no `column80-tests:` fence anywhere in the repo).
//
// THE DEFECT: the sentence offered exactly one exit, "run Generate Tests (TDD)
// first". On a function that already has hand-written tests that is wrong
// advice. The developer does not want tests written; they want the ones they
// have run, and the gesture that does it shipped in this same release without
// the refusal ever naming it.
//
// `fnGen.ts` imports vscode and cannot be bundled, so this binds as SOURCE-LEVEL
// assertions over the file text, the idiom adversarial-v60-p2 already uses.
//
// Run: SKIP_LIVE=1 node --test test/blind-v60-tddrung-deadend.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const fnGen = fs.readFileSync(path.join(SRC, "vscode", "fnGen.ts"), "utf8");
const covering = fs.readFileSync(path.join(SRC, "core", "coveringTestRun.ts"), "utf8");

/** The `column80.runTddTests` registration, comments stripped: a WHY comment
 *  quoting the old sentence must not read as the old sentence still shipping. */
function tddRungCode() {
  const at = fnGen.indexOf('vscode.commands.registerCommand("column80.runTddTests"');
  assert.ok(at !== -1, "the Run TDD Tests command must still live in fnGen.ts");
  return fnGen
    .slice(at, at + 9000)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/** EXACTLY the `if (testNames.length === 0) { ... }` block, by brace matching.
 *
 *  A fixed-width window was tried first and it is the trap this repo has a name
 *  for. On the pre-change source a 1400-character slice ran straight past the
 *  branch and picked up an `output.appendLine` belonging to a different refusal,
 *  so the channel row below went GREEN against the very source it was written to
 *  falsify. A row that cannot fail pins nothing. */
function emptyFenceBranch() {
  const code = tddRungCode();
  const at = code.indexOf("testNames.length === 0");
  assert.ok(at !== -1, "the empty-selection branch must still exist");
  const open = code.indexOf("{", at);
  assert.ok(open !== -1, "the branch must have a body");
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) {
        return code.slice(open, i + 1);
      }
    }
  }
  throw new Error("unbalanced braces in the empty-selection branch");
}

test("the empty-fence refusal names the gesture that CAN run the developer's own tests", () => {
  assert.ok(
    /Run Covering Tests/.test(emptyFenceBranch()),
    "a developer whose function has hand-written tests is told to GENERATE tests, and the one gesture that would have run theirs is never mentioned",
  );
});

test("Generate Tests stays on offer: the fence is still the way to get a ratified suite", () => {
  assert.ok(
    /Generate Tests \(TDD\)/.test(emptyFenceBranch()),
    "naming the sibling must ADD an exit, never replace the one that was there",
  );
});

test("the alternative is withheld in languages where the sibling refuses", () => {
  // TypeScript and JavaScript have a TDD leg and no covering-test leg, so
  // pointing a TS developer at Run Covering Tests sends them to a second
  // refusal. That is a worse dead end than the one being fixed.
  const branch = emptyFenceBranch();
  assert.ok(
    /coveringTestPlan\(/.test(branch),
    "the branch must ASK whether the sibling is registered for this language rather than assuming it is",
  );
  assert.ok(
    /undefined/.test(branch),
    "an undefined plan is how coveringTestPlan says the language has no leg, and the branch must handle it",
  );
  // The premise the row rests on: coveringTestPlan really does answer undefined
  // for a language with a TDD leg but no covering leg.
  assert.ok(
    /RUN_TESTS_LANGS\[input\.languageId\]/.test(covering) && /langScope === undefined/.test(covering),
    "coveringTestPlan must still gate on RUN_TESTS_LANGS, or the check above proves nothing",
  );
  const table = covering.slice(covering.indexOf("RUN_TESTS_LANGS"), covering.indexOf("RUN_TESTS_LANGS") + 1800);
  assert.ok(
    !/^\s*typescript:/m.test(table),
    "TypeScript must still be absent from RUN_TESTS_LANGS, or this row is pinning a case that cannot happen",
  );
});

test("the refusal reaches the output channel, not only a dismissable toast", () => {
  assert.ok(
    /output\.appendLine\(/.test(emptyFenceBranch()),
    "every other refusal on this rung writes its reason to the channel; a state refusal that leaves no record is the one the developer cannot go back and read",
  );
});
