// The FIM whole-block channel names a macro-generated type once, and only on a
// real answer.
//
// FIM re-walks at every keystroke, so without a dedupe the line would repeat per
// document version. And a references() cancelled by the next edit comes back
// empty: printing that as "no path exists" is a false line, and keying it would
// stop the true line from ever printing.
//
// Drives the provider's own `resolveWholeBlock` over the real resolver; only the
// language server is faked: the def sits inside `newtype_id!(...)`, hover names
// a struct, the outline is empty, and references() answers per call from a
// script.
//
// Run: node --test test/impl-v76-p2-fim-channel.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const TAG = ".impl-v76-p2-fim";
const STUB = path.join(__dirname, `${TAG}-vscode.cjs`);
const ENTRY = path.join(__dirname, `${TAG}.entry.ts`);
const OUT = path.join(__dirname, `${TAG}.bundle.cjs`);
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = {
  Position, Range,
  Uri: { parse: (s) => ({ toString: () => s }) },
  languages: {}, window: {}, commands: {},
  workspace: {
    getConfiguration: () => ({ get: (k, d) => d }),
    textDocuments: [],
    openTextDocument: async (uri) => {
      const text = (globalThis.__v76Files || {})[uri.toString()];
      if (text === undefined) { throw new Error("no such file"); }
      return { getText: () => text };
    },
  },
  InlineCompletionItem: class {}, InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  ThemeColor: class {}, MarkdownString: class {}, EventEmitter: class {},
};\n`,
);
fs.writeFileSync(ENTRY, `export { FimCompletionProvider } from "../src/vscode/completionProvider";\n`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { FimCompletionProvider } = require(OUT);
test.after(() => [STUB, ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

const DOC = "file:///main.rs";
const DEF = "file:///ids.rs";
const USE = "file:///key.rs";
const DOC_TEXT = "fn f(t: TenantId) {\n    \n}\n";
const DEF_TEXT = "macro_rules! newtype_id { ($n:ident) => { pub struct $n(u128); } }\nnewtype_id!(TenantId);\n";
const USE_TEXT = "fn g() { let t = TenantId::new(1); }\n";
const DECL = { uri: DEF, line: 1, character: 12, endLine: 1, endCharacter: 20 };
const PATH_REF = { uri: USE, line: 0, character: 17, endLine: 0, endCharacter: 25 };

// refs: one answer per references() call, the last one repeating.
function fakeExtractor(refs) {
  let n = 0;
  return {
    async definition() {
      return { uri: DEF, range: { startLine: 1, startCharacter: 12 } };
    },
    async hoverSurface() {
      return { signature: "pub struct TenantId(u128)" };
    },
    async membersOfType() {
      return [];
    },
    async references() {
      return refs[Math.min(n++, refs.length - 1)];
    },
    async completeMembers() {
      return [{ name: "new", signature: "new(v: u128) -> TenantId", kind: "function" }];
    },
  };
}

function harness() {
  globalThis.__v76Files = { [DOC]: DOC_TEXT, [DEF]: DEF_TEXT, [USE]: USE_TEXT };
  const lines = [];
  const provider = new FimCompletionProvider(() => ({}), { appendLine: (l) => lines.push(l) });
  const walk = (extractor, version) =>
    provider.resolveWholeBlock(
      { languageId: "rust", version, uri: { toString: () => DOC }, getText: () => DOC_TEXT },
      extractor,
      ["TenantId"],
    );
  const macroLines = () => lines.filter((l) => l.startsWith("[fim] whole-block:") && l.includes("macro-generated"));
  return { walk, macroLines };
}

test("the macro line prints exactly once across two document versions", async () => {
  const h = harness();
  const ex = fakeExtractor([[DECL, PATH_REF]]);
  await h.walk(ex, 1);
  await h.walk(ex, 2);
  const got = h.macroLines();
  assert.equal(got.length, 1, `one line per type, not one per keystroke; got:\n${got.join("\n")}`);
  assert.match(got[0], /`TenantId` is macro-generated/);
  assert.match(got[0], /listed 1 inherent member/);
});

test("an unavailable answer prints nothing, and the later real answer for the same type prints", async () => {
  const h = harness();
  const ex = fakeExtractor([[], [DECL, PATH_REF]]);
  await h.walk(ex, 1);
  assert.deepEqual(h.macroLines(), [], "a cancelled reference search is not evidence of anything");
  await h.walk(ex, 2);
  const got = h.macroLines();
  assert.equal(got.length, 1, `the real answer must still print; got:\n${got.join("\n")}`);
  assert.match(got[0], /listed 1 inherent member/);
});
