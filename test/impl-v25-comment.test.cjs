// Implementer oracle for phase 3 of v25: the two comment rules where they are
// WIRED, which the black-box contract cannot see. The pure table and the two
// predicates are pinned by test/blind-v25-comment.test.cjs; this file covers
// the seams around them.
//
//   A. The scope of rule 1. Which sites get the cut and which one does not, and
//      why the exempt whole-block site is the exception.
//   B. The cut's neighbours in the service pipeline: it runs after the bound
//      and is re-sealed, and it reaches the alternates that can be promoted
//      into the served ghost.
//   C. The evidence the service writes.
//   D. Rule 2 in the provider: it runs BEFORE the service, so going dark costs
//      no model call, and its line fires once per comment line rather than once
//      per keystroke.
//   E. The unmapped language, in both halves.
//   F. Two branches of the scanner the surface doc does not name: a doc opener
//      that is a string literal, and a prefix whose window holds no line start.
//
// Run: SKIP_LIVE=1 node --test test/impl-v25-comment.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

// ===========================================================================
// Harness 1: the core bundle, for the service and the pure module.
// ===========================================================================

const { mod: core, cleanup } = bundleCore(
  "impl-v25-comment",
  `export { CompletionService } from "../src/core/completionService";
export { commentSyntaxFor, cutIntroducedComment, cursorInComment, COMMENT_SCAN_CHARS } from "../src/core/fimComment";\n`
);
const { CompletionService, commentSyntaxFor, cutIntroducedComment, cursorInComment, COMMENT_SCAN_CHARS } = core;
test.after(cleanup);

const BASE_CONFIG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-model",
  maxTokens: 256,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 400,
  suffixChars: 200,
  cacheCapacity: 0, // every call generates: this file is about what a fresh serve does
};

// One request through a service whose generate is a constant. Returns the
// served text, the log lines and the generate params, so a row can assert on
// what was served AND on what the channel said about it.
async function serve(raw, request, configOverrides = {}) {
  const lines = [];
  const calls = [];
  const service = new CompletionService(
    { ...BASE_CONFIG, ...configOverrides },
    async (params) => {
      calls.push(params);
      return { text: raw, ttftMs: 1, totalMs: 2 };
    },
    (line) => lines.push(line)
  );
  const out = await service.complete({ suffix: "", ...request });
  service.dispose();
  return { text: out ? out.text : "", alternates: (out && out.alternates) || [], lines, calls };
}

const cutLines = (lines) => lines.filter((l) => l.includes("the ghost introduced a comment"));

// ###########################################################################
// A. THE SCOPE OF RULE 1.
//
// The rule runs at exactly the sites the bound governs, and the two exemptions
// are exempt for their own reasons. A whole-block site with a resolver is
// licensed to write a body and a real body carries comments, so a "led" cut
// there is a truncation that deletes every line below the comment - "No exempt
// site loses its multi-line output" is a bar of its own. A member site already
// has the opposite answer pinned by v19: `/*x*/enrollTile(tile)` under a widget
// scope is REPAIRED and served, and `. /*c*/ enrollTile(t);` is refused as an
// ambiguous repeat. Cutting first would invert both.
// ###########################################################################

test("a plain site gets the trailing cut", async () => {
  const r = await serve("let x = 1; // one", { prefix: "fn f() {\n    ", languageId: "rust" });
  assert.strictEqual(r.text, "let x = 1;");
  assert.strictEqual(cutLines(r.lines).length, 1);
});

test("a member site is NOT cut: the scoped echo strip and the landed-name guard own that string", async () => {
  const raw = "/*x*/toggle()";
  const r = await serve(raw, {
    prefix: "let s = Switch::new();\ns.",
    languageId: "rust",
    memberSite: true,
    memberPartial: "",
  });
  assert.strictEqual(r.text, raw, "the provider's repair needs the lead intact to consume it");
  assert.strictEqual(cutLines(r.lines).length, 0);
});

test("an EXEMPT whole-block site keeps a comment inside the body it was licensed to write", async () => {
  const body = "\n    let total = 0;\n    // sum the tiles\n    total";
  const r = await serve(body, {
    prefix: "fn total(&self) -> u32 {",
    languageId: "rust",
    wholeBlockSite: true,
    resolveInjection: async () => undefined,
  });
  assert.strictEqual(r.text, body.trimEnd(), "the body survived whole");
  assert.strictEqual(cutLines(r.lines).length, 0, "no cut, so no evidence line");
});

test("a whole-block site with NO resolver wired is bounded, so it is cut like any plain site", async () => {
  // The exemption is site AND resolver. A site that can never inject keeps no
  // licence to author, and by the same argument no licence to comment.
  const r = await serve("\n    // sum the tiles\n    let total = 0;", {
    prefix: "fn total(&self) -> u32 {",
    languageId: "rust",
    wholeBlockSite: true,
  });
  assert.strictEqual(r.text, "");
  assert.strictEqual(cutLines(r.lines).length, 1);
});

test("a comment-led ghost at a plain site serves nothing at all", async () => {
  const r = await serve("// count the tiles\nlet n = tiles.len();", {
    prefix: "fn f() {\n    ",
    languageId: "rust",
  });
  assert.strictEqual(r.text, "");
  assert.ok(cutLines(r.lines).some((l) => l.includes("(led)")));
});

// ###########################################################################
// B. THE CUT'S NEIGHBOURS IN THE PIPELINE.
// ###########################################################################

test("the cut runs AFTER the bound, on the text the bound already balanced", async () => {
  // The bound sees `foo(a, // note`, finds the paren open and appends its
  // closer past the comment. Run the cut first and the closer would never be
  // needed; run it second and the tail has to be re-sealed. This is the
  // discriminator between the two orders.
  const r = await serve("foo(a, // note", { prefix: "fn f() {\n    ", languageId: "rust" });
  assert.strictEqual(r.text, "foo(a,)");
});

test("the seal re-runs after the cut, so a cut into a dangling tail is retracted", async () => {
  // A trailing cut can leave exactly the tail the safety rule refuses. Without
  // the second seal the served text would end on `+`.
  const r = await serve("let n = a + // note", { prefix: "fn f() {\n    ", languageId: "rust" });
  assert.strictEqual(r.text, "", "a ghost whose only content dangles is refused, not served half");
});

test("the cut reaches the alternates, because an alternate can be promoted into the ghost", async () => {
  const lines = [];
  let call = 0;
  const service = new CompletionService(
    { ...BASE_CONFIG },
    async () => {
      call += 1;
      // The primary is nothing but a comment; the alternate carries code with
      // a comment glued to it. The promotion path serves the alternate.
      return { text: call === 1 ? "// nope" : "let n = 1; // note", ttftMs: 1, totalMs: 2 };
    },
    (l) => lines.push(l)
  );
  const out = await service.complete({
    prefix: "fn f() {\n    ",
    suffix: "",
    languageId: "rust",
    manual: true,
    alternatives: 2,
  });
  service.dispose();
  assert.strictEqual(out.text, "let n = 1;", "the promoted alternate was cut before it was served");
  // ONE line and one count for the keystroke, the discipline the floor takes:
  // a request that cut two candidates and served one cut a comment once as far
  // as the human is concerned. Counting per candidate priced one event as two.
  assert.strictEqual(cutLines(lines).length, 1, `got ${JSON.stringify(cutLines(lines))}`);
});

test("a cache hit is served without the cut, the same discipline the bound already follows", async () => {
  const lines = [];
  let calls = 0;
  const service = new CompletionService(
    { ...BASE_CONFIG, cacheCapacity: 10 },
    async () => {
      calls += 1;
      return { text: "let x = 1; // one", ttftMs: 1, totalMs: 2 };
    },
    (l) => lines.push(l)
  );
  const req = { prefix: "fn f() {\n    ", suffix: "", languageId: "rust" };
  const first = await service.complete(req);
  const second = await service.complete(req);
  service.dispose();
  assert.strictEqual(calls, 1, "the second call hit the cache");
  assert.strictEqual(first.text, "let x = 1;");
  assert.strictEqual(second.text, "let x = 1;", "the stored entry was already cut at the position that minted it");
  assert.strictEqual(cutLines(lines).length, 1, "the hit re-runs nothing and reports nothing");
});

// ###########################################################################
// C. THE EVIDENCE.
// ###########################################################################

// Phase 4 hung the session ledger off this line: the suppression's own count
// rides it, in the style of `session dark sites=N`. The sentence and the kind
// are still pinned exactly; what follows them is the count.
const COUNTED = /^(.*?)( \(session [a-z-]+=\d+\))$/;
function assertCountedLines(actual, expected, kind) {
  assert.strictEqual(actual.length, expected.length, `got ${JSON.stringify(actual)}`);
  actual.forEach((line, i) => {
    const m = COUNTED.exec(line);
    assert.ok(m, `the count rides the line: ${JSON.stringify(line)}`);
    assert.strictEqual(m[1], expected[i]);
    assert.ok(m[2].includes(kind), `and it is the ${kind} count: ${JSON.stringify(line)}`);
  });
}

test("the cut names which kind it was, and `dropped:` only where the human got nothing", async () => {
  // `dropped:` is the shape the whole suppression class greps as, and it has one
  // meaning: the human got nothing. A led cut at the first content line leaves
  // nothing, so it keeps the shape. A trailing cut serves the code in front of
  // the comment, so it takes `trimmed:` - it changed the ghost, it did not
  // suppress it. The count rides both, because both changed what was served.
  const led = await serve("// note\nlet x = 1;", { prefix: "fn f() {\n    ", languageId: "rust" });
  assert.strictEqual(led.text, "");
  assertCountedLines(
    cutLines(led.lines),
    ["[fim] dropped: the ghost introduced a comment (led)"],
    "comment-introduced"
  );
  const trailing = await serve("let x = 1; // note", { prefix: "fn f() {\n    ", languageId: "rust" });
  assert.strictEqual(trailing.text, "let x = 1;");
  assertCountedLines(
    cutLines(trailing.lines),
    ["[fim] trimmed: the ghost introduced a comment (trailing)"],
    "comment-introduced"
  );
});

test("`kept` counts what was SERVED, not what the bound kept before the comment cut", async () => {
  // The cut runs after `postprocessBounded`, so `BoundOutcome.keptLines`
  // describes the bound's own output. A three-line bound whose last two lines
  // are a comment serves one, and a channel number that means something else on
  // some requests is worse than no number.
  // The open paren holds four lines inside the bound, the third of which is a
  // comment; the led cut drops it and everything after, leaving two.
  const r = await serve("x = f(\n        a,\n        // note\n        b)", {
    prefix: "fn f() {\n    ",
    languageId: "typescript",
  });
  assert.strictEqual(r.text, "x = f(\n        a,)");
  const line = r.lines.find((l) => l.includes("[fim] ttft="));
  assert.match(line, /kept=2 /, `kept described the bound's four lines, not the ghost's two: ${line}`);
});

test("a ghost with no comment in it writes no line", async () => {
  const r = await serve("let x = 1;", { prefix: "fn f() {\n    ", languageId: "rust" });
  assert.strictEqual(r.text, "let x = 1;");
  assert.strictEqual(cutLines(r.lines).length, 0);
});

// ###########################################################################
// E1. THE UNMAPPED LANGUAGE, SERVICE HALF. Nothing changes.
// ###########################################################################

test("an unmapped languageId leaves the ghost byte-identical", async () => {
  const raw = "let x = 1; // one";
  const r = await serve(raw, { prefix: "fn f() {\n    ", languageId: "zig" });
  assert.strictEqual(r.text, raw);
  assert.strictEqual(cutLines(r.lines).length, 0);
});

test("a request with no languageId at all is unmapped, not defaulted to the C family", async () => {
  const raw = "let x = 1; // one";
  const r = await serve(raw, { prefix: "fn f() {\n    " });
  assert.strictEqual(r.text, raw);
});

// ###########################################################################
// F. TWO SCANNER BRANCHES THE SURFACE DOC DOES NOT NAME.
// ###########################################################################

test("a python triple quote after code is a string literal, and the # inside it is not a comment", () => {
  const py = commentSyntaxFor("python");
  const r = cutIntroducedComment('msg = """a # b"""', py);
  assert.strictEqual(r.cut, "none");
  assert.strictEqual(r.text, 'msg = """a # b"""');
});

test("a cursor inside a mid-line triple-quoted string is in a literal, not in a docstring", () => {
  // Only a doc opener at the start of a content line is prose. Anything else is
  // an ordinary string, and being inside one is not one of the three kinds, so
  // the answer is serve.
  const py = commentSyntaxFor("python");
  assert.strictEqual(cursorInComment('msg = """hello ', py).inComment, false);
  assert.strictEqual(cursorInComment('def f():\n    """hello ', py).inComment, true);
});

test("a prefix whose whole window holds no line start refuses to answer rather than guess", () => {
  const ts = commentSyntaxFor("typescript");
  // One line longer than the window, ending inside a string that contains `//`.
  // With no line start to scan from, a fragment beginning mid-literal would
  // read that `//` as a comment and go dark on real code.
  const long = `const s = "${"x".repeat(COMMENT_SCAN_CHARS + 200)}// still a string`;
  const at = cursorInComment(long, ts);
  assert.strictEqual(at.inComment, false);
  assert.strictEqual(at.windowExhausted, true);
});

test("a language with no block and no doc row never reports exhaustion, however long the prefix", () => {
  // Truncation can only hide a construct that spans lines. Ruby has neither, so
  // the cursor's own line decides and there is nothing left to be unsure about.
  const ruby = commentSyntaxFor("ruby");
  const long = "puts 1\n".repeat(COMMENT_SCAN_CHARS) + "puts 2";
  assert.deepStrictEqual(cursorInComment(long, ruby), { inComment: false, windowExhausted: false });
  const ts = commentSyntaxFor("typescript");
  assert.strictEqual(cursorInComment("f(1);\n".repeat(COMMENT_SCAN_CHARS) + "f(2);", ts).windowExhausted, true);
});

// ===========================================================================
// Harness 2: the provider, for rule 2. Same idiom as the v20/v21 provider
// tests - alias `vscode` to a hand-built stub, stub the extractor registry
// through an esbuild plugin (async API, hence the child process).
// ===========================================================================

const TAG = ".impl-v25-comment-provider";
const STUB = path.join(__dirname, `${TAG}-vscode-stub.cjs`);
const REGISTRY_STUB = path.join(__dirname, `${TAG}-registry.ts`);
const pEntry = path.join(__dirname, `${TAG}.entry.ts`);
const pOutfile = path.join(__dirname, `${TAG}.bundle.cjs`);
const buildScript = path.join(__dirname, `${TAG}.build.cjs`);

fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; }
  translate(l, c) { return new Position(this.line + (l || 0), this.character + (c || 0)); } }
class Range { constructor(a, b, c, d) {
  if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
  else { this.start = a; this.end = b; } } }
module.exports = {
  Position, Range,
  Uri: { parse: (s) => ({ toString: () => s }) },
  languages: {}, window: {}, commands: {},
  workspace: {
    getConfiguration: () => ({ get: (k, d) => {
      if (k === "fimAlternatives") { return 1; }
      if (k === "debounceMs") { return 0; }
      // v29: FIM serves code only, and zig is not one of the five. The E2 row
      // below is about a language with no COMMENT row, which since v29 can only
      // be reached through this widening setting - so the fixture widens.
      // Harmless to every other row here: they all use served languages.
      if (k === "fimLanguages") { return ["zig"]; }
      return d;
    } }),
    textDocuments: [],
    openTextDocument: async () => { throw new Error("no such file"); },
  },
  InlineCompletionItem: class { constructor(text, range) { this.insertText = text; this.range = range; } },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  ThemeColor: class {}, MarkdownString: class {}, EventEmitter: class {},
};\n`
);

// No extractor: this file is about the comment gate, and an injection resolver
// would only add noise to the channel it reads.
fs.writeFileSync(REGISTRY_STUB, `export function extractorFor(_languageId: string): any { return undefined; }\n`);

fs.writeFileSync(
  pEntry,
  `export { FimCompletionProvider } from "../src/vscode/completionProvider";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`
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
}).catch((e) => { console.error(e); process.exit(1); });\n`
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

// A provider over a document, with the generate call counted. Cursor positions
// are given as [line, character]; each request is issued in order against the
// same provider so the once-per-site counter is exercised across keystrokes.
//
// The fixture ghost clears the shipped length floor (8 characters, 2
// alphanumeric), because this service runs on DEFAULT_FIM_CONFIG and the floor
// ships on. The old `n = 1;` was six characters, so every row here that asserts
// a ghost WAS served would be asserting against a suppression it is not about.
// Nothing in this file reads the ghost's text.
async function provide(text, languageId, cursors, ghost = "tileCount();") {
  if (buildError) {
    assert.fail(`the provider bundle does not build: ${String(buildError.stderr || buildError.message).slice(0, 2000)}`);
  }
  const lines = [];
  const generated = [];
  const service = new pmod.CompletionService(
    { ...pmod.DEFAULT_FIM_CONFIG, debounceMs: 0, cacheCapacity: 0 },
    async (params) => {
      generated.push(params);
      return { text: ghost, ttftMs: 1, totalMs: 2 };
    },
    (l) => lines.push(l)
  );
  const provider = new pmod.FimCompletionProvider(() => service, { appendLine: (l) => lines.push(l) });
  const doc = makeDoc(text, languageId);
  const results = [];
  for (const [line, character] of cursors) {
    results.push(
      await provider.provideInlineCompletionItems(
        doc,
        makePos(line, character),
        { triggerKind: 1, selectedCompletionInfo: undefined },
        { isCancellationRequested: false, onCancellationRequested: () => {} }
      )
    );
  }
  service.dispose();
  return { results, lines, generated };
}

const darkLines = (lines) => lines.filter((l) => l.includes("the cursor is inside a"));

// ###########################################################################
// D. RULE 2 IN THE PROVIDER.
// ###########################################################################

test("harness: the provider bundle builds [red here is a build problem, not a contract failure]", () => {
  if (buildError) {
    assert.fail(String(buildError.stderr || buildError.message).slice(0, 2000));
  }
  assert.strictEqual(typeof pmod.FimCompletionProvider, "function");
});

test("a cursor inside a line comment serves nothing AND costs no model call", async () => {
  const r = await provide("fn f() {\n    // count the\n}", "rust", [[1, 17]]);
  assert.strictEqual(r.results[0], undefined);
  assert.strictEqual(r.generated.length, 0, "going dark must not reach the model");
  assertCountedLines(darkLines(r.lines), ["[fim] no ghost: the cursor is inside a line comment"], "in-comment");
});

test("a cursor inside a block comment names the block kind", async () => {
  const r = await provide("/* the tile grid\n   is ", "rust", [[1, 6]]);
  assert.strictEqual(r.results[0], undefined);
  assertCountedLines(darkLines(r.lines), ["[fim] no ghost: the cursor is inside a block comment"], "in-comment");
});

test("a cursor inside a python docstring names the doc kind", async () => {
  const r = await provide('def f():\n    """Return the ', "python", [[1, 18]]);
  assert.strictEqual(r.results[0], undefined);
  assertCountedLines(darkLines(r.lines), ["[fim] no ghost: the cursor is inside a doc comment"], "in-comment");
});

test("the line fires once per comment LINE, not once per keystroke", async () => {
  // Typing along a comment moves the column on every character. A key carrying
  // the column would put this back to one line per keystroke, which is the
  // thing the counter exists to stop.
  const r = await provide("fn f() {\n    // count the tiles\n}", "rust", [
    [1, 8],
    [1, 12],
    [1, 16],
    [1, 21],
  ]);
  assert.deepStrictEqual(r.results, [undefined, undefined, undefined, undefined]);
  assert.strictEqual(darkLines(r.lines).length, 1);
});

test("a second comment line is a second site and says so", async () => {
  const r = await provide("// one\n// two\n", "rust", [
    [0, 6],
    [1, 6],
  ]);
  assert.strictEqual(darkLines(r.lines).length, 2);
});

test("a cursor before the comment on its own line still serves", async () => {
  const r = await provide("let x = 1; // note\n", "rust", [[0, 5]]);
  assert.ok(Array.isArray(r.results[0]) && r.results[0].length === 1, "a ghost was served");
  assert.strictEqual(darkLines(r.lines).length, 0);
  assert.strictEqual(r.generated.length, 1);
});

test("a comment marker inside a string on the cursor line does not go dark", async () => {
  const r = await provide('let s = "// not a comment"; ', "rust", [[0, 28]]);
  assert.ok(Array.isArray(r.results[0]));
  assert.strictEqual(darkLines(r.lines).length, 0);
});

test("a rust attribute is not a comment, which is the regression maskSpans would have caused", async () => {
  const r = await provide("#[derive(Debug)]\nstruct T { ", "rust", [[1, 11]]);
  assert.ok(Array.isArray(r.results[0]), "#[derive] must not read as a comment opener");
  assert.strictEqual(darkLines(r.lines).length, 0);
});

// ###########################################################################
// E2. THE UNMAPPED LANGUAGE, PROVIDER HALF.
//
// v29 narrowed what reaches here. FIM serves code only, and the five languages
// it serves by default all have a comment row, so the comment rules can only go
// dark in a language a human added to `column80.fimLanguages`. That is what the
// stub above widens, and it is the whole remaining population of this rule.
// ###########################################################################

test("an unmapped WIDENED language says so ONCE per session and then changes nothing", async () => {
  const r = await provide("// this looks like a comment\n", "zig", [
    [0, 20],
    [0, 24],
  ]);
  assert.ok(Array.isArray(r.results[0]), "the rule does not run, so the ghost still serves");
  assert.ok(Array.isArray(r.results[1]));
  const dark = r.lines.filter((l) => l.includes("comment rules dark"));
  assert.strictEqual(dark.length, 1, "one line per session");
  assert.ok(dark[0].includes("zig"), `the line names the languageId: ${dark[0]}`);
});

// ###########################################################################
// FINAL REVIEW FINDING 4. `nextComment` skips string and char literals and
// knows nothing about a JavaScript regex literal, and `/\/\//` contains a
// literal `//`. Both rules read it as a comment, and the worse symptom is the
// one this module's own header calls the cost it exists to control: the
// provider going dark on real code, with no model call and a channel line
// claiming the cursor is inside a line comment.
// ###########################################################################

const TS = commentSyntaxFor("typescript");

test("finding 4: a regex containing // does not put the cursor in a comment", () => {
  const at = cursorInComment("const parts = s.split(/\\/\\//); const n = ", TS);
  assert.strictEqual(at.inComment, false, JSON.stringify(at));
  assert.strictEqual(at.windowExhausted, false);
});

test("finding 4: and the cut does not truncate the literal", () => {
  assert.strictEqual(cutIntroducedComment('url.replace(/\\/\\//g, "/");', TS).cut, "none");
  assert.strictEqual(cutIntroducedComment("const re = /a\\/\\/b/;", TS).cut, "none");
});

test("finding 4: the test is the character BEFORE, so a real comment is still one", () => {
  // The escape of `\/` and the closing slash of the literal are the two
  // characters that precede a `//` inside a regex. No real opener has one.
  assert.strictEqual(cutIntroducedComment("let x = 1; // note", TS).cut, "trailing");
  assert.strictEqual(cutIntroducedComment("// note", TS).cut, "led");
  assert.strictEqual(cutIntroducedComment("/// doc", TS).cut, "led", "`///` opens at its FIRST slash");
  assert.strictEqual(cursorInComment("x(); // still in it", TS).inComment, true);
  assert.strictEqual(cursorInComment("/// doc, still in it", TS).inComment, true);
});

test("finding 4: the whole ghost survives the pipeline, closers included", async () => {
  // The bracket scan skips line comments too, from the same table, so before
  // this the `)` inside the regex line was never seen to close and rule 6 bolted
  // a second one on before the cut ate the rest.
  const r = await serve('url.replace(/\\/\\//g, "/");', {
    prefix: "function f() {\n  ",
    languageId: "typescript",
  });
  assert.strictEqual(r.text, 'url.replace(/\\/\\//g, "/");');
  assert.strictEqual(cutLines(r.lines).length, 0, `got ${JSON.stringify(r.lines)}`);
});

test("finding 4: `#` and `--` rows are returned unjudged, having no regex literal", () => {
  assert.strictEqual(cutIntroducedComment("n = 1  # note", commentSyntaxFor("python")).cut, "trailing");
  assert.strictEqual(cutIntroducedComment("n = 1 -- note", commentSyntaxFor("lua")).cut, "trailing");
  // Python's `//` is floor division, and its comment token is `#`, so the
  // guard never sees it.
  assert.strictEqual(cutIntroducedComment("n = a // b", commentSyntaxFor("python")).cut, "none");
});
