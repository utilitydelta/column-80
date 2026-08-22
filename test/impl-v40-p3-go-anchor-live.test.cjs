// LIVE check — session-v40 item 2, the anchor leg:
// GoLspExtractor.resolveTypeCursorByName against a REAL gopls, over the REAL
// cobra checkout used by item 3's own rig (~/sandbox/v23-corpus/cobra). This
// is the one part of the anchor leg the goal's scout pass asks to prove live
// rather than with a fixture (the goal's "SPIKED, by running" note under
// item 2): the shape of a real workspace/symbol response — containerName as a
// real Go import PATH, kind 23 for a struct, kind 5 for a named non-struct
// type (`type ShellCompDirective int`) — is gopls's own, not this repo's to
// assert from a hand-built fixture.
//
// READ-ONLY. Every request here is workspace/symbol or documentSymbol;
// nothing opens a document for editing, nothing writes, nothing calls
// `go build`. Safe to run alongside another process building the same
// checkout, unlike test/impl-v40-p2-go-rig-live.test.cjs (which splices).
//
// Skips (never fails) when SKIP_LIVE is set or gopls/the corpus isn't
// present, same discipline as the other Go live tests.
//
// Run: node --test test/impl-v40-p3-go-anchor-live.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { bundleCore } = require("./.blind-util.cjs");

const GOPLS = "/home/utilitydelta/go/bin/gopls";
const GO_BIN_DIR = "/home/utilitydelta/.local/go/bin";
process.env.PATH = `${GO_BIN_DIR}:${process.env.PATH || ""}`;

const goPresent = fs.existsSync(path.join(GO_BIN_DIR, "go"));
const goplsPresent = fs.existsSync(GOPLS);
const CORPUS = path.join(os.homedir(), "sandbox", "v23-corpus");
const CORPUS_ROOT = path.join(CORPUS, "cobra");
const corpusPresent = fs.existsSync(path.join(CORPUS_ROOT, "go.mod"));

const SKIP =
  process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1"
  : !goPresent ? `no go toolchain at ${GO_BIN_DIR}`
  : !goplsPresent ? `gopls not found at ${GOPLS}`
  : !corpusPresent ? `no cobra checkout at ${CORPUS_ROOT}`
  : false;

if (SKIP) {
  test(`GoLspExtractor.resolveTypeCursorByName live checks (SKIPPED: ${SKIP})`, () => {});
} else {
  const { mod: B, cleanup } = bundleCore(
    "v40-p3-go-anchor-live",
    `export { GoLspExtractor } from "../src/core/goLspExtractor";
export { goTypesFromQualifiedUsage } from "../src/core/repairTypes";\n`,
  );
  test.after(cleanup);

  const LIVE_TIMEOUT = 120_000;
  let ex;
  test.before(async () => {
    ex = await B.GoLspExtractor.start({ projectRoot: CORPUS_ROOT, goplsPath: GOPLS });
    await ex.whenReady();
  });
  test.after(() => ex?.dispose());

  test(
    "live: resolveTypeCursorByName('Command') anchors the real struct, kind 23, command.go:53",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const cursor = await ex.resolveTypeCursorByName("Command");
      assert.ok(cursor, "expected a cursor, got undefined");
      assert.match(cursor.uri, /command\.go$/);
      // 0-indexed: command.go's `type Command struct {` is line 54 in a 1-
      // indexed editor, matching the goal's own scout note (command.go:53).
      assert.equal(cursor.line, 53);
      const text = fs.readFileSync(cursor.uri.replace(/^file:\/\//, ""), "utf8");
      const lineText = text.split("\n")[cursor.line];
      assert.equal(lineText.slice(cursor.character, cursor.character + "Command".length), "Command");
    },
  );

  test(
    "live: resolveTypeCursorByName('ShellCompDirective') anchors a named non-struct type (`type X int`)",
    { timeout: LIVE_TIMEOUT },
    async () => {
      // The kind the goal's build note flags as unconfirmed: does gopls report
      // a `type ShellCompDirective int` declaration the same way it reports a
      // struct? Measured here rather than assumed — it does not (kind 5,
      // "Class", not kind 23 "Struct"), which is exactly why
      // goLspSymbolRole already treats both as role "container" (goExtraction.ts).
      const cursor = await ex.resolveTypeCursorByName("ShellCompDirective");
      assert.ok(cursor, "expected a cursor, got undefined");
      assert.match(cursor.uri, /completions\.go$/);
      const text = fs.readFileSync(cursor.uri.replace(/^file:\/\//, ""), "utf8");
      const lineText = text.split("\n")[cursor.line];
      assert.match(lineText, /^type ShellCompDirective int/);
    },
  );

  test(
    "live: a name with no exact-name type declaration resolves to undefined, never a guess",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const cursor = await ex.resolveTypeCursorByName("ThisTypeDoesNotExistAnywhereInCobra");
      assert.equal(cursor, undefined);
    },
  );

  test(
    "live: end-to-end composition — a candidate ONLY the new qualified-usage leg would surface, anchored " +
      "via resolveTypeCursorByName with no other anchor available (session-v40 item 2's part 1 + part 2)",
    { timeout: LIVE_TIMEOUT },
    async () => {
      // A synthetic caller file: `ShellCompDirective` is named nowhere but a
      // real `cobra.`-qualified body reference, so the four PRE-existing
      // candidate tiers (signature/doc/comment/local) find nothing — only
      // goTypesFromQualifiedUsage does, per this file's own import block.
      const fullText = 'package caller\n\nimport (\n\t"github.com/spf13/cobra"\n)\n';
      const span = "func run() {\n\tvar d cobra.ShellCompDirective\n\t_ = d\n}";
      const mined = B.goTypesFromQualifiedUsage("func run()", undefined, span, fullText);
      assert.deepEqual(mined, ["ShellCompDirective"], "part 2 must be the one surfacing this name");

      // No text anchor exists for it anywhere in the (synthetic) caller file —
      // goFindTypeReference's span/local-def legs would both come back empty,
      // which is exactly the case the fnGen.ts:1810 fallback exists for. So
      // the ONLY path to a def cursor is part 1's resolveTypeCursorByName.
      const cursor = await ex.resolveTypeCursorByName(mined[0]);
      assert.ok(cursor, "part 1 must anchor the name part 2 surfaced");
      assert.match(cursor.uri, /completions\.go$/);
    },
  );
}
