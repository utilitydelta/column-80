// SESSION-V55 PHASE 23, queue Q9: the shared vscode activation stub, and the
// first finding it unblocks.
//
// Session-v21 deferred S11 and S13 on one sentence each: a test that drives
// `activate`'s wiring needs its own copy of the ~400-line activation stub, and
// there is no shared helper. `test/.activation-stub.cjs` is that helper.
//
// TWO ROWS, and the second is the point. A refactor whose only evidence is
// "the suite still passes" is a weak signal, which the session goal says out
// loud. So this file also writes the regression S11 asked for and never got -
// that is the falsification a pure extraction cannot supply.
//
// Run: SKIP_LIVE=1 node --test test/impl-v55-p23-activation-stub.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { ACTIVATION_STUB_SOURCE, bundleActivation } = require("./.activation-stub.cjs");

// ---------------------------------------------------------------------------
// 1. THE DRIFT GUARD. The helper is a COPY of the stub inside a frozen blind
//    file, because `AGENTS.md` forbids editing that file and the two therefore
//    cannot be unified by deleting one. A copy nobody checks is a fork; this is
//    the check.
// ---------------------------------------------------------------------------

test("the shared stub is byte-identical to the copy in the frozen blind file", () => {
  const src = fs.readFileSync(path.join(__dirname, "blind-v21-p1-commands.test.cjs"), "utf8");
  const OPEN = "fs.writeFileSync(\n  STUB,\n  `";
  const at = src.indexOf(OPEN);
  assert.ok(at > 0, "the blind file must still write its stub as one template literal; if this moved, re-derive the slice rather than deleting the row");
  // Evaluated as a TEMPLATE, which is how the blind file writes it: the raw
  // slice still carries `\\` where the written file carries `\`, and comparing
  // raw text would fail on 13 characters that are identical on disk.
  const raw = src.slice(at + OPEN.length, src.indexOf("`\n);", at + OPEN.length));
  const body = new Function("return `" + raw + "`")();
  assert.equal(
    ACTIVATION_STUB_SOURCE,
    body,
    "the shared activation stub has drifted from the blind file's copy. They are the same stub on purpose: fix the shared one to match, or if the blind file's stub genuinely changed, copy it across in the same commit",
  );
  assert.ok(body.length > 10_000, `precondition: this is the ~400-line activation stub, got ${body.length} chars`);
});

// ---------------------------------------------------------------------------
// 2. THE HELPER ACTUALLY ACTIVATES THE PRODUCT. A stub module that is never
//    bundled is a 400-line string, not a helper. This row is what makes the
//    extraction non-dead: the product's own `activate`, through the shared stub,
//    registering the wiring S11 and S13 exist to observe.
//
//    WHAT IT DELIBERATELY DOES NOT DO IS S11's ROW, and that is a CORRECTION to
//    what session-v21 recorded. S11 and S13 both say they are blocked on "a
//    third copy of the ~400-line activation stub" and that extracting it "is the
//    change that pays for both". Measured here: it is not. The stub gets you an
//    activated extension; S11's assertion needs a scoped ghost to have been
//    SERVED first, which takes `blind-v21-p1-commands.test.cjs`'s ~200-line
//    drive - a fake ollama, a fake document, a provider invoked twice with and
//    without a selected completion. Without a served scope the dismissal command
//    takes its no-scope branch (blind row C: "it hides and returns"), so a row
//    written on the stub alone asserts nothing about the rejecting-hide fix.
//    Filed as S55-26. The blocker was half-diagnosed, and this file is where
//    that shows up rather than three sessions from now.
// ---------------------------------------------------------------------------

const built = bundleActivation("v55p23");
test.after(() => built.cleanup());
const { activate, __state } = built.mod;

test("the shared stub activates the real extension and produces the wiring S11 and S13 need to reach", async () => {
  __state.config = {};
  __state.commands = {};
  __state.executeCalls = [];
  __state.commandHandlers = {};
  __state.inlineProviders = [];
  const context = {
    subscriptions: [],
    globalState: { get: () => undefined, update: async () => {} },
    workspaceState: { get: () => undefined, update: async () => {} },
    extensionUri: { fsPath: "/ext", toString: () => "file:///ext" },
  };
  await activate(context);

  assert.equal(
    typeof __state.commands["column80.dismissScopedGhost"],
    "function",
    `activation must register the dismissal command - this is S11's entry point. Registered: ${JSON.stringify(Object.keys(__state.commands))}`,
  );
  assert.ok(
    __state.inlineProviders.length >= 1,
    "activation must register an inline completion provider - this is what a drive would need to serve a scoped ghost through",
  );
  assert.ok(context.subscriptions.length > 0, "and activation must have registered disposables against the context it was given");
});
