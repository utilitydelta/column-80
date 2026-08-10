// The v29 language gate WHERE IT IS WIRED. The blind file pins the predicate;
// this pins the product behaviour the predicate exists for, which is the half
// that actually costs a model call when it is wrong:
//
//   A. an unserved language reaches no model, and says so once per language
//   B. the setting widens end to end, with no restart, and narrowing says so
//      again rather than going quiet
//   C. a served language is untouched
//   D. an unserved keystroke does not evict a served file's caches
//
// Same idiom as impl-v25-comment.test.cjs: alias `vscode` to a hand-built stub,
// stub the extractor registry through an esbuild plugin. The stub's
// configuration is settable per test, because the whole point of B is what
// happens when it changes under a live provider.
//
// Run: SKIP_LIVE=1 node --test test/impl-v29-p1-provider-gate.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const TAG = ".impl-v29-p1-provider";
const STUB = path.join(__dirname, `${TAG}-vscode-stub.cjs`);
const REGISTRY_STUB = path.join(__dirname, `${TAG}-registry.ts`);
const pEntry = path.join(__dirname, `${TAG}.entry.ts`);
const pOutfile = path.join(__dirname, `${TAG}.bundle.cjs`);
const buildScript = path.join(__dirname, `${TAG}.build.cjs`);

// The stub reads its configuration from a module-level object the tests mutate,
// so one build serves every row and a settings change is a real settings change
// against a live provider instance.
fs.writeFileSync(
  STUB,
  `const state = { fimLanguages: [], enabled: true };
class Position { constructor(line, character) { this.line = line; this.character = character; }
  translate(l, c) { return new Position(this.line + (l || 0), this.character + (c || 0)); } }
class Range { constructor(a, b, c, d) {
  if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
  else { this.start = a; this.end = b; } } }
module.exports = {
  __state: state,
  Position, Range,
  Uri: { parse: (s) => ({ toString: () => s }) },
  languages: {}, window: {}, commands: {},
  workspace: {
    getConfiguration: () => ({ get: (k, d) => {
      if (k === "fimAlternatives") { return 1; }
      if (k === "debounceMs") { return 0; }
      if (k === "fimLanguages") { return state.fimLanguages; }
      if (k === "enabled") { return state.enabled; }
      return d;
    } }),
    textDocuments: [],
    openTextDocument: async () => { throw new Error("no such file"); },
  },
  InlineCompletionItem: class { constructor(text, range) { this.insertText = text; this.range = range; } },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  ThemeColor: class {}, MarkdownString: class {}, EventEmitter: class {},
};\n`,
);

fs.writeFileSync(REGISTRY_STUB, `export function extractorFor(_languageId: string): any { return undefined; }\n`);

fs.writeFileSync(
  pEntry,
  `export { FimCompletionProvider } from "../src/vscode/completionProvider";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";
export { __state } from "vscode";\n`,
);

fs.writeFileSync(
  buildScript,
  `require("esbuild").build({
  entryPoints: [${JSON.stringify(pEntry)}],
  bundle: true, outfile: ${JSON.stringify(pOutfile)}, format: "cjs", platform: "node",
  alias: { vscode: ${JSON.stringify(STUB)} },
  plugins: [{ name: "registry", setup(b) {
    b.onResolve({ filter: /(^|\\/)extractors$/ }, () => ({ path: ${JSON.stringify(REGISTRY_STUB)} }));
  } }],
}).catch((e) => { console.error(e); process.exit(1); });\n`,
);

let buildError;
let pmod = {};
try {
  execFileSync(process.execPath, [buildScript], { stdio: "pipe" });
  pmod = require(pOutfile);
} catch (e) {
  buildError = e;
}

test.after(() => {
  [STUB, REGISTRY_STUB, pEntry, pOutfile, buildScript].forEach((f) => fs.rmSync(f, { force: true }));
});

function makePos(line, character) {
  return { line, character, translate: (l, c) => makePos(line + (l || 0), character + (c || 0)) };
}

function makeDoc(text, languageId) {
  return {
    languageId,
    version: 1,
    uri: { toString: () => `file:///a.${languageId}` },
    get lineCount() {
      return text.split("\n").length;
    },
    _offset(p) {
      const lines = text.split("\n");
      const line = Math.max(0, Math.min(p.line, lines.length - 1));
      let n = 0;
      for (let i = 0; i < line; i += 1) n += lines[i].length + 1;
      return n + Math.max(0, Math.min(p.character, lines[line].length));
    },
    getText(range) {
      return range == null ? text : text.slice(this._offset(range.start), this._offset(range.end));
    },
    lineAt(n) {
      const lines = text.split("\n");
      const len = (lines[n] ?? "").length;
      return { text: lines[n] ?? "", range: { start: { line: n, character: 0 }, end: { line: n, character: len } } };
    },
    offsetAt(p) {
      return this._offset(p);
    },
  };
}

// One provider across a whole row's requests, because "once per session" and
// "after the setting changed" are both properties of an instance that lives.
function newProvider() {
  const lines = [];
  const generated = [];
  const service = new pmod.CompletionService(
    { ...pmod.DEFAULT_FIM_CONFIG, debounceMs: 0, cacheCapacity: 0 },
    async (params) => {
      generated.push(params);
      return { text: "tileCount();", ttftMs: 1, totalMs: 2 };
    },
    (l) => lines.push(l),
  );
  const provider = new pmod.FimCompletionProvider(() => service, { appendLine: (l) => lines.push(l) });
  const ask = (text, languageId, line, character) =>
    provider.provideInlineCompletionItems(
      makeDoc(text, languageId),
      makePos(line, character),
      { triggerKind: 1, selectedCompletionInfo: undefined },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
  return { provider, service, lines, generated, ask };
}

const unservedLines = (lines) => lines.filter((l) => l.includes("is not code Column 80 understands"));

test("harness: the provider bundle builds [red here is a build problem, not a contract failure]", () => {
  if (buildError) {
    assert.fail(String(buildError.stderr || buildError.message).slice(0, 2000));
  }
  assert.equal(typeof pmod.FimCompletionProvider, "function");
});

test("A: a markdown keystroke reaches no model at all", async () => {
  pmod.__state.fimLanguages = [];
  const h = newProvider();
  const r = await h.ask("# The tile grid\n\nEvery tile carries ", "markdown", 2, 19);
  assert.equal(r, undefined);
  assert.equal(h.generated.length, 0, "prose must not cost a model call");
  h.service.dispose();
});

test("A: the refusal is one line per language, not one per keystroke", async () => {
  pmod.__state.fimLanguages = [];
  const h = newProvider();
  for (let i = 0; i < 12; i++) {
    await h.ask("some prose here", "markdown", 0, 5 + i);
  }
  assert.equal(unservedLines(h.lines).length, 1);
  assert.ok(unservedLines(h.lines)[0].includes("markdown"));
  assert.ok(
    unservedLines(h.lines)[0].includes("column80.fimLanguages"),
    "the line names the way out, or a human reads it as the extension being broken",
  );
  h.service.dispose();
});

test("A: an unserved language never writes the per-invocation invoked line", async () => {
  // The line's own rule is that it comes first; this is the one exception, and
  // it is the reason the refusal above is once per language rather than once
  // per keystroke.
  pmod.__state.fimLanguages = [];
  const h = newProvider();
  await h.ask("prose", "plaintext", 0, 3);
  assert.equal(h.lines.filter((l) => l.includes("[fim] invoked")).length, 0);
  h.service.dispose();
});

test("A: each unserved language gets its own line", async () => {
  pmod.__state.fimLanguages = [];
  const h = newProvider();
  for (const id of ["markdown", "yaml", "json", "plaintext"]) {
    await h.ask("some text", id, 0, 4);
    await h.ask("some text", id, 0, 5);
  }
  assert.equal(unservedLines(h.lines).length, 4);
  h.service.dispose();
});

test("C: a served language still generates", async () => {
  pmod.__state.fimLanguages = [];
  const h = newProvider();
  const r = await h.ask("fn f() {\n    let n = ", "rust", 1, 12);
  assert.ok(Array.isArray(r) && r.length >= 1, "rust must be untouched by the gate");
  assert.equal(h.generated.length, 1);
  h.service.dispose();
});

test("B: the setting widens end to end, with no restart", async () => {
  const h = newProvider();
  pmod.__state.fimLanguages = [];
  assert.equal(await h.ask("int main() { int n = ", "cpp", 0, 21), undefined);
  assert.equal(h.generated.length, 0);

  pmod.__state.fimLanguages = ["cpp"];
  const r = await h.ask("int main() { int n = ", "cpp", 0, 21);
  assert.ok(Array.isArray(r) && r.length >= 1, "the same live provider must serve after the widening");
  assert.equal(h.generated.length, 1);
  h.service.dispose();
});

test("B: narrowing the setting again says so, rather than going quiet", async () => {
  // A human who removes cpp from the list and finds no ghost and no channel
  // line has a feature that stopped working with no evidence at all. The
  // once-per-language key carries the setting for exactly this.
  const h = newProvider();
  pmod.__state.fimLanguages = [];
  await h.ask("int n = ", "cpp", 0, 8);
  assert.equal(unservedLines(h.lines).length, 1);

  pmod.__state.fimLanguages = ["cpp"];
  await h.ask("int n = ", "cpp", 0, 8);

  pmod.__state.fimLanguages = [];
  await h.ask("int n = ", "cpp", 0, 8);
  assert.equal(unservedLines(h.lines).length, 2, "the second narrowing must be on the record");
  h.service.dispose();
});

test("B: a widened language with no comment row is served, and the lost protection is on the channel", async () => {
  // The owner's rule has two halves and this is the one state where the product
  // serves the first and cannot promise the second. Serving is the deliberate
  // choice (the human named the language); the gap being silent would not be.
  pmod.__state.fimLanguages = ["zig"];
  const h = newProvider();
  const r = await h.ask("const n = ", "zig", 0, 10);
  assert.ok(Array.isArray(r) && r.length >= 1);
  const dark = h.lines.filter((l) => l.includes("comment rules dark"));
  assert.equal(dark.length, 1);
  assert.ok(dark[0].includes("zig"));
  assert.ok(
    dark[0].includes("in-comment refusal cannot run"),
    `the line must say what it costs: ${dark[0]}`,
  );
  h.service.dispose();
});

// D. The eviction guard. `canMintEntries` is the predicate the change hook in
// extension.ts asks; it is vscode-free precisely so this can be a real test
// rather than a bundled extension host.
const { mod: schemes, cleanup: schemesCleanup } = require("./.blind-util.cjs").bundleCore(
  "impl-v29-p1-schemes",
  `export { canMintEntries, isDocumentScheme } from "../src/vscode/documentSchemes";`,
);
test.after(schemesCleanup);

const none = () => [];

test("D: a markdown edit cannot mint an entry, so it must not evict one", () => {
  // Without the language half a paragraph of prose wipes every other file's
  // entries per keystroke, which is the defect the scheme allowlist was written
  // against, arriving through the door v29 opened.
  assert.equal(schemes.canMintEntries("file", "markdown", none), false);
  assert.equal(schemes.canMintEntries("file", "json", none), false);
  assert.equal(schemes.canMintEntries("file", "yaml", none), false);
});

test("D: a real code edit still evicts", () => {
  for (const id of ["rust", "csharp", "python", "go", "typescript"]) {
    assert.equal(schemes.canMintEntries("file", id, none), true, id);
  }
  assert.equal(schemes.canMintEntries("untitled", "rust", none), true);
});

test("D: the scheme half still refuses, whatever the language says", () => {
  assert.equal(schemes.canMintEntries("vscode-scm", "rust", none), false);
  assert.equal(schemes.canMintEntries("output", "rust", none), false);
});

test("D: a widened language mints, and the config read is lazy", () => {
  let reads = 0;
  const extra = () => {
    reads += 1;
    return ["cpp"];
  };
  assert.equal(schemes.canMintEntries("file", "cpp", extra), true);
  assert.equal(reads, 1);
  // A keystroke in real code must not pay a configuration read here: the
  // default set answers first.
  reads = 0;
  assert.equal(schemes.canMintEntries("file", "rust", extra), true);
  assert.equal(reads, 0, "a served language read configuration it did not need");
  // Nor must a non-document scheme, which is refused before either half.
  assert.equal(schemes.canMintEntries("vscode-scm", "cpp", extra), false);
  assert.equal(reads, 0);
});
