// Regression oracle (live bug 2026-07-15): RaCommandExtractor.definition() must
// return the IDENTIFIER range, not the whole-item range.
//
// rust-analyzer answers textDocument/definition with a LocationLink whenever the
// client advertises definition linkSupport. VS Code advertises it, so the command
// transport receives a LocationLink carrying:
//   - targetRange:          the WHOLE item span — for a doc-commented struct this
//                           STARTS on the `///` doc line (or an attribute), not the
//                           type name.
//   - targetSelectionRange: the identifier token (the type name).
// resolveCrossFileShape hovers at definition().range.start to read a struct's
// fields. If definition() returns targetRange, the hover lands on the doc comment,
// rust-analyzer returns no type hover, and EVERY field resolves empty (fields=0,
// sigLen=0) — the model then gets methods-only surface and punts on field access.
// The headless LSP transport dodged this: it does NOT advertise linkSupport, so RA
// returns a plain Location whose `range` already IS the identifier. So this bug is
// invisible to the LSP-backed live dumps and only bites the command transport on a
// DOC-COMMENTED type. The contract: definition() yields the identifier range for
// BOTH result shapes.
//
// Run: SKIP_LIVE=1 node --test test/blind-v7-definition-selrange.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".blind-v7-defsel-vscode-stub.cjs");
fs.writeFileSync(STUB, `module.exports = { Uri: { parse: (s) => ({ toString: () => s }) }, Position: class {}, commands: {}, workspace: {} };\n`);

const entry = path.join(__dirname, ".blind-v7-defsel.entry.ts");
const outfile = path.join(__dirname, ".blind-v7-defsel.bundle.cjs");
fs.writeFileSync(entry, `export { RaCommandExtractor } from "../src/vscode/raExtractor";\n`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { RaCommandExtractor } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const CURSOR = { uri: "file:///x/consumer.rs", line: 31, character: 34 };
const withDefinition = (definition) => async (command) => {
  if (String(command).toLowerCase().includes("definition")) return definition;
  throw new Error(`unexpected command ${command}`);
};
const range = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });

// A rust-analyzer LocationLink for a doc-commented `pub struct Address` in orders.rs:
// the doc comment sits on line 11, the `pub struct` head on line 12, the identifier
// `Address` starting at char 11 on line 12.
const LOCATION_LINK = {
  targetUri: { toString: () => "file:///x/orders.rs" },
  targetRange: range(11, 0, 16, 1), // whole item: STARTS on the doc-comment line
  targetSelectionRange: range(12, 11, 12, 18), // the identifier token `Address`
};

test("LocationLink -> definition() returns the targetSelectionRange (identifier), NOT targetRange (whole item)", async () => {
  const ext = new RaCommandExtractor(withDefinition(LOCATION_LINK));
  const got = await ext.definition(CURSOR);
  assert.ok(got, "a LocationLink resolves to a definition location");
  assert.strictEqual(got.uri, "file:///x/orders.rs", "uri from targetUri");
  assert.strictEqual(
    got.range.startLine,
    12,
    "range.start must be the IDENTIFIER line (targetSelectionRange), not the doc-comment line 11 (targetRange) — else the resolver hovers on `///` and reads no fields",
  );
  assert.strictEqual(got.range.startCharacter, 11, "range.start char is the identifier token, not column 0 of the item");
});

test("plain Location (no linkSupport / LSP transport shape) still maps through range", async () => {
  const plain = { uri: { toString: () => "file:///x/orders.rs" }, range: range(12, 11, 12, 18) };
  const ext = new RaCommandExtractor(withDefinition(plain));
  const got = await ext.definition(CURSOR);
  assert.ok(got, "a plain Location resolves");
  assert.strictEqual(got.range.startLine, 12, "plain Location range is the identifier already");
  assert.strictEqual(got.range.startCharacter, 11, "plain Location start char preserved");
});

test("absent definition provider still degrades to undefined (unchanged)", async () => {
  const ext = new RaCommandExtractor(withDefinition(undefined));
  assert.strictEqual(await ext.definition(CURSOR), undefined);
});
