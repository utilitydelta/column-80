// Typing inside a comment must not read the whole document.
//
// The question, from the human, on their own log: does the FIM model run on
// every character press even where nothing may be generated? The model does
// not, and never did - the in-comment refusal is the first thing the provider
// does and it returns before the abort controller, the extractor lookup, the
// config read and the debounce. What it DID do first was materialise the whole
// prefix and the whole suffix, and only then ask whether the cursor is in a
// comment.
//
// What that pair costs: a forced flat copy of the prefix and suffix measures
// 6.5us at 14KB, 261us at 342KB and 896us at 1.4MB in V8, and `getText` builds
// a real string from the editor's piece tree rather than a view.
// `acme_shard/src/shard_wal.rs` is 553KB. The copy inside the running
// editor is not measured here, so these rows pin the WORK REMOVED - characters
// the provider asks for - rather than a latency number, which is also the thing
// a test can hold steady.
//
// Two rows here, and they test different things:
//   A. the CORE property that licenses the change: the comment verdict is
//      invariant to being handed a bounded tail rather than the whole prefix.
//      `cursorInComment` already windows internally, so this is a
//      characterisation test, and it is what makes the caller's change safe.
//   B. the CALLER: at a comment site the provider must not ask the document for
//      more than that bound. Counted in characters actually returned.
//
// Run: SKIP_LIVE=1 node --test test/impl-v28-p6-commentcost.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v28-p6",
  `export { cursorInComment, commentSyntaxFor, COMMENT_SCAN_CHARS, COMMENT_PREFIX_CHARS } from "../src/core/fimComment";\n`,
);
test.after(cleanup);
const { cursorInComment, commentSyntaxFor, COMMENT_SCAN_CHARS, COMMENT_PREFIX_CHARS } = mod;

// The bound the caller is allowed to read. It has to be at least the scan's own
// window, or the bounded prefix would answer a question the full one would not.
test("A0: the caller's bound is at least the scan's own window", () => {
  assert.equal(typeof COMMENT_PREFIX_CHARS, "number", "the bound is a named constant, not a number at a call site");
  assert.ok(
    COMMENT_PREFIX_CHARS >= COMMENT_SCAN_CHARS,
    `a caller that hands less than the scan window changes the verdict; bound ${COMMENT_PREFIX_CHARS} against window ${COMMENT_SCAN_CHARS}`,
  );
});

// Every shape that can make the answer depend on history: an unterminated block
// comment opened far above, a closed one, a `//` inside a string, a doc comment,
// and code with no comment at all. Each is grown past the bound with filler so
// the two readings genuinely differ in input.
const FILLER = "        int x = Compute(alpha, beta) + Gamma.Delta(epsilon);\n";
const SHAPES = [
  { name: "plain code, no comment anywhere", head: "", tail: "        int y = 1;\n        y" },
  { name: "inside a doc comment", head: "", tail: "        /// how many regional tiles (checking band" },
  { name: "inside a line comment", head: "", tail: "        // a note about the band" },
  { name: "inside a block comment opened just above", head: "", tail: "        /* a note\n           still going" },
  {
    name: "a block comment opened BEFORE the bound and never closed",
    head: "        /* opened far above and never closed\n",
    tail: "        still inside it",
  },
  {
    name: "a block comment opened before the bound and CLOSED before the cursor",
    head: "        /* opened far above */\n",
    tail: "        int z = 2;\n        z",
  },
  { name: "a `//` inside a string literal", head: "", tail: '        var s = "http://example.com/"; s' },
  { name: "code directly after a closed block comment", head: "", tail: "        /* note */ int w = 3;\n        w" },
];

for (const shape of SHAPES) {
  test(`A [${shape.name}]: the verdict is the same from the whole prefix and from the bounded tail`, () => {
    const syntax = commentSyntaxFor("csharp");
    const filler = FILLER.repeat(Math.ceil((COMMENT_PREFIX_CHARS * 3) / FILLER.length));
    const whole = shape.head + filler + shape.tail;
    assert.ok(
      whole.length > COMMENT_PREFIX_CHARS,
      "the fixture must be longer than the bound, or this row proves nothing",
    );
    const bounded = whole.slice(-COMMENT_PREFIX_CHARS);

    const full = cursorInComment(whole, syntax);
    const tail = cursorInComment(bounded, syntax);
    assert.deepEqual(
      { inComment: tail.inComment, kind: tail.kind },
      { inComment: full.inComment, kind: full.kind },
      `a bounded read must reach the whole read's verdict, or the caller's saving is bought with a wrong answer.\n  whole: ${JSON.stringify(full)}\n  bounded: ${JSON.stringify(tail)}`,
    );
  });
}

test("A: a prefix shorter than the bound is handed over whole, and reads the same", () => {
  const syntax = commentSyntaxFor("csharp");
  const short = "class C {\n    /// a doc comment being typed";
  assert.ok(short.length < COMMENT_PREFIX_CHARS, "fixture guard");
  assert.deepEqual(cursorInComment(short.slice(-COMMENT_PREFIX_CHARS), syntax), cursorInComment(short, syntax));
});

// ===========================================================================
// B. THE CALLER. At a comment site the provider must not ask the document for
// more text than the bound. Counted in characters actually handed back, which
// is the thing the measurement priced: `getText` materialises a real string
// from VS Code's piece tree, and a 553KB file pays for every character of it on
// every keystroke.
// ===========================================================================

const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".impl-v28-p6-provider-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = {
  Position, Range,
  Uri: { parse: (s) => ({ toString: () => String(s) }), file: (s) => ({ toString: () => String(s) }) },
  workspace: { getConfiguration: () => ({ get: (k, fb) => fb }) },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  InlineCompletionTriggerKind: { Automatic: 0, Invoke: 1 },
};
`,
);
const ENTRY = path.join(__dirname, ".impl-v28-p6-provider.entry.ts");
const OUT = path.join(__dirname, ".impl-v28-p6-provider.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { FimCompletionProvider } from "../src/vscode/completionProvider";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`,
);
let providerBundleError;
let P = {};
try {
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
  P = require(OUT);
} catch (e) {
  providerBundleError = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

// A document that counts what it hands back. Nothing else about it is new: the
// shape is the one the v21 provider oracles already use.
function countingDoc(text, languageId) {
  let served = 0;
  const lines = text.split("\n");
  const offsetOf = (p) => {
    const line = Math.max(0, Math.min(p.line, lines.length - 1));
    let n = 0;
    for (let i = 0; i < line; i += 1) n += lines[i].length + 1;
    return n + Math.max(0, Math.min(p.character, lines[line].length));
  };
  return {
    languageId,
    version: 1,
    get lineCount() { return lines.length; },
    uri: { toString: () => "file:///cost.cs" },
    get served() { return served; },
    getText(range) {
      const out = range == null ? text : text.slice(offsetOf(range.start), offsetOf(range.end));
      served += out.length;
      return out;
    },
    lineAt(n) {
      const t = lines[n] ?? "";
      return { text: t, range: { start: new V.Position(n, 0), end: new V.Position(n, t.length) } };
    },
    offsetAt: offsetOf,
    positionAt(o) {
      let rem = o;
      for (let i = 0; i < lines.length; i += 1) {
        if (rem <= lines[i].length) return new V.Position(i, rem);
        rem -= lines[i].length + 1;
      }
      return new V.Position(lines.length - 1, (lines[lines.length - 1] ?? "").length);
    },
  };
}

const bigFile = (tail) => {
  const filler = "        int x = Compute(alpha, beta) + Gamma.Delta(epsilon);\n".repeat(4000);
  return "namespace N;\nclass C\n{\n" + filler + tail;
};

const drive = async (doc, line, character) => {
  const service = new P.CompletionService(
    { ...P.DEFAULT_FIM_CONFIG, debounceMs: 0 },
    async () => ({ text: "", ttftMs: 1, totalMs: 2 }),
    () => {},
  );
  const provider = new P.FimCompletionProvider(() => service, { appendLine: () => {} });
  await provider.provideInlineCompletionItems(
    doc,
    new V.Position(line, character),
    { triggerKind: 0, selectedCompletionInfo: undefined },
    { onCancellationRequested: () => {}, isCancellationRequested: false },
  );
  service.dispose();
};

test("bundle guard: the provider builds headless against the vscode stub", () => {
  if (providerBundleError) assert.fail(`bundle failed: ${providerBundleError.message}`);
});

test("B: a keystroke inside a doc comment reads a bounded tail, not the document", async (ctx) => {
  if (providerBundleError) return ctx.skip("bundle failed; see the guard");
  const text = bigFile("        /// how many regional tiles (checking band");
  const doc = countingDoc(text, "csharp");
  const last = text.split("\n").length - 1;
  await drive(doc, last, text.split("\n")[last].length);
  assert.ok(
    doc.served <= COMMENT_PREFIX_CHARS + 200,
    `the refusal needs the tail of the line, not ${(text.length / 1024).toFixed(0)}KB of history; it read ${doc.served} characters against a bound of ${COMMENT_PREFIX_CHARS}`,
  );
});

test("B: a keystroke in CODE still reads what the prompt needs", async (ctx) => {
  if (providerBundleError) return ctx.skip("bundle failed; see the guard");
  const text = bigFile("        int y = 1;\n        y");
  const doc = countingDoc(text, "csharp");
  const last = text.split("\n").length - 1;
  await drive(doc, last, text.split("\n")[last].length);
  assert.ok(
    doc.served > COMMENT_PREFIX_CHARS,
    `a real site still assembles a prompt from the document; it read only ${doc.served}`,
  );
});
