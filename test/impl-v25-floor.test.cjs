// Implementer oracle for phase 4 of v25: the minimum-length floor and the
// suppression ledger, at the seams the black-box contract cannot see.
// test/blind-v25-floor.test.cjs pins the product behaviour; this file covers
// what the implementation had to decide to deliver it.
//
//   A. The predicate on its own. Both boundaries, both disable switches, and
//      what counts as an alphanumeric character.
//   B. Where the floor sits in the pipeline. It is the LAST filter, so it
//      judges the text the comment cut and the bound already reduced.
//   C. The config seam. A config carrying no floor has no floor, which is what
//      keeps every headless caller that predates the floor unchanged.
//   D. The ledger module: isolation, snapshot semantics, the channel suffix.
//   E. The ledger's wiring. The extension hands the session's ledger to a
//      service it rebuilds on every settings change, so counts have to survive
//      that rebuild - and a service handed nothing must not write to the
//      session's ledger behind its back.
//   F. The in-comment count in the provider, the one suppression that never
//      reaches the service. It counts per suppressed keystroke while its line
//      still prints once per comment line.
//
// Run: SKIP_LIVE=1 node --test test/impl-v25-floor.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const { mod: core, cleanup } = bundleCore(
  "impl-v25-floor",
  `export { CompletionService, belowGhostFloor } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";
export {
  SUPPRESSION_KINDS,
  createSuppressionLedger,
  noteSuppression,
  sessionSuppressions,
} from "../src/core/suppressionLedger";\n`
);
const {
  CompletionService,
  belowGhostFloor,
  DEFAULT_FIM_CONFIG,
  SUPPRESSION_KINDS,
  createSuppressionLedger,
  noteSuppression,
  sessionSuppressions,
} = core;
test.after(cleanup);

// No floor fields: rows that want one add them. Section C is about what this
// absence means.
const BASE_CONFIG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-model",
  maxTokens: 256,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 400,
  suffixChars: 200,
  cacheCapacity: 0,
};
const FLOOR = { minGhostChars: 8, minGhostAlnum: 2 };

const PLAIN = { prefix: "fn f() {\n    let x = ", suffix: "\n}\n", languageId: "rust" };

async function serve(raw, request = {}, config = { ...BASE_CONFIG, ...FLOOR }, ledger) {
  const lines = [];
  const calls = [];
  const service = new CompletionService(
    config,
    async (params) => {
      calls.push(params);
      return { text: raw, ttftMs: 1, totalMs: 2 };
    },
    (l) => lines.push(l),
    ledger
  );
  const out = await service.complete({ ...PLAIN, manual: true, ...request });
  service.dispose();
  return { text: out ? out.text : "", lines, calls };
}

const floorLines = (lines) => lines.filter((l) => l.includes("under the length floor"));

// ###########################################################################
// A. THE PREDICATE.
// ###########################################################################

test("both legs are `at least`: the boundary value passes, one under it fails", () => {
  assert.strictEqual(belowGhostFloor("tileCnt;", 8, 2), false, "exactly eight characters is enough");
  assert.strictEqual(belowGhostFloor("tileCt;", 8, 2), true, "seven is not");
  assert.strictEqual(belowGhostFloor("(a + b);", 8, 2), false, "exactly two alphanumerics is enough");
  assert.strictEqual(belowGhostFloor("(a + 1)!", 8, 2), false);
  assert.strictEqual(belowGhostFloor("((a));;;", 8, 2), true, "one is not");
});

test("the statement finisher is refused by the alphanumeric leg, not by the length leg", () => {
  // `);      });` is eleven characters and zero alphanumerics. Called out in
  // the contract as the case that will look wrong in dogfood: it is a real
  // statement finisher, and it is exactly what JetBrains' numbers exclude.
  assert.strictEqual(belowGhostFloor(");      });", 8, 2), true);
  assert.strictEqual(belowGhostFloor(");      });", 8, 0), false, "the alnum leg alone refuses it");
});

test("an underscore is not alphanumeric, and a non-ASCII letter is", () => {
  // `\w` would get both of these wrong in opposite directions. A ghost of
  // `__(_____);` is punctuation with a name; `café.len()` is real identifier
  // text a French codebase writes all day.
  assert.strictEqual(belowGhostFloor("__(_____);", 8, 2), true);
  assert.strictEqual(belowGhostFloor("café.len()", 8, 2), false);
  assert.strictEqual(belowGhostFloor("日本語です。", 8, 2), true, "six characters is under the length leg");
});

test("a multi-line ghost is judged whole, newlines and indentation included", () => {
  assert.strictEqual(belowGhostFloor("a();\n    b();", 8, 2), false);
});

test("minChars 0 disables the floor entirely, including the alphanumeric leg", () => {
  // The contract's switch: "restores today's behaviour exactly". A `);` still
  // has no alphanumerics, so a floor that kept the second leg alive at 0 would
  // not restore anything.
  assert.strictEqual(belowGhostFloor(");", 0, 2), false);
  assert.strictEqual(belowGhostFloor("", 0, 2), false);
});

test("minAlnum 0 disables its own leg and leaves the length test standing", () => {
  assert.strictEqual(belowGhostFloor(");", 8, 0), true, "still two characters");
  assert.strictEqual(belowGhostFloor(");;;;;;;;", 8, 0), false);
});

test("a negative or absent number reads as off rather than as a floor of NaN", () => {
  // Hand-edited settings.json reaches here as-is. Neither of these may
  // suppress: a floor nobody can explain is worse than no floor.
  assert.strictEqual(belowGhostFloor("n;", -1, 2), false);
  assert.strictEqual(belowGhostFloor("n;", undefined, undefined), false);
  assert.strictEqual(belowGhostFloor("n;", 8, undefined), true, "the length leg still stands alone");
});

// ###########################################################################
// B. WHERE THE FLOOR SITS.
//
// Last of every filter, which is the only position that makes it a statement
// about what the human would have seen.
// ###########################################################################

test("the floor is not applied to a candidate the COMMENT CUT already trimmed", async () => {
  // 27 raw characters, 6 after the cut. Composed, the two rules produce a full
  // suppression neither would produce alone: the cut alone serves `n = 1;`, the
  // floor alone serves all 27. Two ledger counts for one lost completion, and
  // the human is charged for the model's comment rather than for a short ghost.
  const r = await serve("n = 1; // note the tiles ok");
  assert.strictEqual(r.text, "n = 1;", `got ${JSON.stringify(r.lines)}`);
  assert.strictEqual(floorLines(r.lines).length, 0, "the floor did not fire on the cut's remainder");
});

test("a candidate the cut did NOT touch is still judged on what the bound served", async () => {
  // The exemption is the comment cut's own judgement standing in for the
  // floor's, not the floor switching off whenever a comment is anywhere near.
  const r = await serve("x = 1;");
  assert.strictEqual(r.text, "");
  assert.strictEqual(floorLines(r.lines).length, 1, `got ${JSON.stringify(r.lines)}`);
  assert.ok(
    floorLines(r.lines)[0].includes("chars=6"),
    `the line reports the SERVED length: ${floorLines(r.lines)[0]}`
  );
});

test("the floor judges what the BOUND left", async () => {
  const r = await serve("x = 1;\n    tileCount();\n    more();");
  assert.strictEqual(r.text, "", "the bound kept one 6-character line and the floor refused it");
  assert.strictEqual(floorLines(r.lines).length, 1);
});

test("a ghost the bound already emptied is not also counted as below the floor", async () => {
  // Two suppressions for one keystroke would double-price the same lost
  // completion, and the bound's refusal is the one that happened.
  const r = await serve("foo(");
  assert.strictEqual(r.text, "");
  assert.strictEqual(floorLines(r.lines).length, 0, `got ${JSON.stringify(r.lines)}`);
  assert.strictEqual(r.lines.filter((l) => l.includes("no safe cut point")).length, 1);
});

test("a ghost the member gate refused is not counted as below the floor either", async () => {
  const r = await serve("nope()", {
    prefix: "let s = Switch::new();\ns.",
    memberSite: true,
    memberPartial: "",
    resolveInjection: async () => ({ memberNames: ["toggle", "len"] }),
  });
  assert.strictEqual(r.text, "", "the gate refused an invented member");
  assert.strictEqual(floorLines(r.lines).length, 0);
});

test("a below-floor ghost reaches neither the cache nor the caller", async () => {
  const lines = [];
  let calls = 0;
  const service = new CompletionService(
    { ...BASE_CONFIG, ...FLOOR, cacheCapacity: 10 },
    async () => {
      calls += 1;
      return { text: "n1;", ttftMs: 1, totalMs: 2 };
    },
    (l) => lines.push(l)
  );
  const first = await service.complete({ ...PLAIN, manual: true });
  const second = await service.complete({ ...PLAIN, manual: true });
  service.dispose();
  assert.strictEqual(first, undefined);
  assert.strictEqual(second, undefined);
  assert.strictEqual(calls, 2, "nothing was stored, so the second request generated again");
  assert.strictEqual(floorLines(lines).length, 2, "and each keystroke was counted");
});

// ###########################################################################
// C. THE CONFIG SEAM.
// ###########################################################################

test("a config carrying no floor has no floor", async () => {
  // Every headless caller that predates this phase hands a config with no
  // floor fields in it. The service enforces the config it was given rather
  // than a default table it reaches for, so those callers are unchanged.
  const r = await serve("n1;", {}, BASE_CONFIG);
  assert.strictEqual(r.text, "n1;");
  assert.strictEqual(floorLines(r.lines).length, 0);
});

test("the shipped default DOES carry one, so the extension's own service floors by default", async () => {
  const r = await serve("n1;", {}, { ...DEFAULT_FIM_CONFIG, debounceMs: 0, cacheCapacity: 0 });
  assert.strictEqual(r.text, "");
  assert.strictEqual(floorLines(r.lines).length, 1);
});

test("the channel line names the floor in force, so a raised one is readable from the log", async () => {
  const r = await serve("tileCount();", {}, { ...BASE_CONFIG, minGhostChars: 40, minGhostAlnum: 2 });
  assert.strictEqual(r.text, "");
  assert.ok(
    floorLines(r.lines)[0].includes("min=40/2"),
    `the setting in force belongs on the line: ${floorLines(r.lines)[0]}`
  );
});

// ###########################################################################
// D. THE LEDGER MODULE.
// ###########################################################################

test("a fresh ledger starts every kind at zero, and there are exactly four", () => {
  const ledger = createSuppressionLedger();
  assert.deepStrictEqual(ledger.snapshot(), {
    "bound-unsafe": 0,
    "comment-introduced": 0,
    "in-comment": 0,
    "below-floor": 0,
  });
  assert.deepStrictEqual([...SUPPRESSION_KINDS].sort(), Object.keys(ledger.snapshot()).sort());
});

test("two ledgers count independently", () => {
  const a = createSuppressionLedger();
  const b = createSuppressionLedger();
  a.note("below-floor");
  a.note("below-floor");
  b.note("in-comment");
  assert.strictEqual(a.snapshot()["below-floor"], 2);
  assert.strictEqual(b.snapshot()["below-floor"], 0);
});

test("a snapshot is a copy: a caller holding one does not watch it change", () => {
  const ledger = createSuppressionLedger();
  const before = ledger.snapshot();
  ledger.note("bound-unsafe");
  assert.strictEqual(before["bound-unsafe"], 0);
  assert.strictEqual(ledger.snapshot()["bound-unsafe"], 1);
});

test("noteSuppression counts once and returns the channel suffix carrying the total", () => {
  const ledger = createSuppressionLedger();
  assert.strictEqual(noteSuppression(ledger, "in-comment"), " (session in-comment=1)");
  assert.strictEqual(noteSuppression(ledger, "in-comment"), " (session in-comment=2)");
  assert.strictEqual(noteSuppression(ledger, "below-floor"), " (session below-floor=1)");
  assert.strictEqual(ledger.snapshot()["in-comment"], 2, "the suffix is not a second increment");
});

// ###########################################################################
// E. THE LEDGER'S WIRING.
// ###########################################################################

test("a service writes to the ledger it was handed, so counts survive its rebuild", async () => {
  // extension.ts builds a FRESH CompletionService on every settings change and
  // hands it the session's ledger. Without that, changing any setting would
  // zero the numbers at the moment a human is reading them.
  const session = createSuppressionLedger();
  await serve("n1;", {}, { ...BASE_CONFIG, ...FLOOR }, session);
  await serve("n2;", {}, { ...BASE_CONFIG, ...FLOOR }, session);
  assert.strictEqual(session.snapshot()["below-floor"], 2);
});

test("a service handed no ledger does not write to the session's", async () => {
  const before = sessionSuppressions.snapshot();
  await serve("n1;");
  await serve("let n = 1; // note");
  assert.deepStrictEqual(sessionSuppressions.snapshot(), before);
});

test("all three service-side kinds land in one ledger, separately counted", async () => {
  const session = createSuppressionLedger();
  await serve("n1;", {}, { ...BASE_CONFIG, ...FLOOR }, session);
  await serve("let n = 1; // note", {}, { ...BASE_CONFIG, ...FLOOR }, session);
  await serve("foo(", {}, { ...BASE_CONFIG, ...FLOOR }, session);
  assert.deepStrictEqual(session.snapshot(), {
    "bound-unsafe": 1,
    "comment-introduced": 1,
    "in-comment": 0,
    "below-floor": 1,
  });
});

test("one keystroke that refuses four candidates is one event", async () => {
  // The alternates are judged because any of them can be promoted into the
  // served ghost, but a fan-out is still one completion the human did not get.
  const session = createSuppressionLedger();
  const lines = [];
  let n = 0;
  const service = new CompletionService(
    { ...BASE_CONFIG, ...FLOOR },
    async () => {
      n += 1;
      return { text: `n${n};`, ttftMs: 1, totalMs: 2 };
    },
    (l) => lines.push(l),
    session
  );
  const out = await service.complete({ ...PLAIN, manual: true, alternatives: 4 });
  service.dispose();
  assert.strictEqual(out, undefined);
  assert.strictEqual(session.snapshot()["below-floor"], 1);
  assert.strictEqual(floorLines(lines).length, 1);
  assert.ok(floorLines(lines)[0].includes("alts=3"), `the refused extras are visible: ${floorLines(lines)[0]}`);
});

// ===========================================================================
// Harness 2: the provider, for the one suppression that never reaches the
// service. Copied from test/impl-v25-comment.test.cjs (same vscode stub, same
// dark extractor registry).
// ===========================================================================

const TAG = ".impl-v25-floor-provider";
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

fs.writeFileSync(REGISTRY_STUB, `export function extractorFor(_languageId: string): any { return undefined; }\n`);

fs.writeFileSync(
  pEntry,
  `export { FimCompletionProvider } from "../src/vscode/completionProvider";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";
export { sessionSuppressions } from "../src/core/suppressionLedger";\n`
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

async function provide(text, languageId, cursors, ghost = "tileCount();") {
  if (buildError) {
    assert.fail(`the provider bundle does not build: ${String(buildError.stderr || buildError.message).slice(0, 2000)}`);
  }
  const lines = [];
  const service = new pmod.CompletionService(
    { ...pmod.DEFAULT_FIM_CONFIG, debounceMs: 0, cacheCapacity: 0 },
    async () => ({ text: ghost, ttftMs: 1, totalMs: 2 }),
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
  return { results, lines };
}

// ###########################################################################
// F. THE IN-COMMENT COUNT.
// ###########################################################################

test("harness: the provider bundle builds [red here is a build problem, not a contract failure]", () => {
  if (buildError) {
    assert.fail(String(buildError.stderr || buildError.message).slice(0, 2000));
  }
  assert.strictEqual(typeof pmod.FimCompletionProvider, "function");
});

test("the in-comment line carries the session count", async () => {
  const before = pmod.sessionSuppressions.snapshot()["in-comment"];
  const r = await provide("fn f() {\n    // count the\n}", "rust", [[1, 17]]);
  const dark = r.lines.filter((l) => l.includes("the cursor is inside a"));
  assert.strictEqual(dark.length, 1);
  assert.ok(
    dark[0].endsWith(`(session in-comment=${before + 1})`),
    `the count rides the suppression's own line: ${dark[0]}`
  );
});

test("the count moves per suppressed keystroke while the line still prints once per comment line", async () => {
  // The two answer different questions. The line says which comment lines went
  // dark; the count says how many completions the rule cost, which is the
  // number phase 6 prices. So the count runs ahead of the lines, on purpose.
  const before = pmod.sessionSuppressions.snapshot()["in-comment"];
  const r = await provide("fn f() {\n    // count the tiles\n}", "rust", [
    [1, 8],
    [1, 12],
    [1, 16],
    [1, 21],
  ]);
  assert.deepStrictEqual(r.results, [undefined, undefined, undefined, undefined]);
  assert.strictEqual(r.lines.filter((l) => l.includes("the cursor is inside a")).length, 1);
  assert.strictEqual(pmod.sessionSuppressions.snapshot()["in-comment"], before + 4);
});

test("the provider counts into the SAME ledger the extension hands the service", async () => {
  // One ledger, four kinds. A provider counting into a private map would make
  // the phase-6 measurement two measurements that cannot be added up.
  const before = pmod.sessionSuppressions.snapshot();
  const service = new pmod.CompletionService(
    { ...pmod.DEFAULT_FIM_CONFIG, debounceMs: 0, cacheCapacity: 0 },
    async () => ({ text: "n1;", ttftMs: 1, totalMs: 2 }),
    () => {},
    pmod.sessionSuppressions
  );
  await service.complete({ ...PLAIN, manual: true });
  service.dispose();
  await provide("// one\n", "rust", [[0, 6]]);
  const after = pmod.sessionSuppressions.snapshot();
  assert.strictEqual(after["below-floor"], before["below-floor"] + 1);
  assert.strictEqual(after["in-comment"], before["in-comment"] + 1);
});

test("a served ghost inside no comment adds nothing to the in-comment count", async () => {
  const before = pmod.sessionSuppressions.snapshot()["in-comment"];
  const r = await provide("let x = 1; // note\n", "rust", [[0, 5]]);
  assert.ok(Array.isArray(r.results[0]) && r.results[0].length === 1, "a ghost was served");
  assert.strictEqual(pmod.sessionSuppressions.snapshot()["in-comment"], before);
});

// ###########################################################################
// FINAL REVIEW FINDING 1. The floor and the declaration bound were written 24
// minutes apart and never measured together. The bound makes a declaration head
// serve the rest of the SIGNATURE and stop, so the ghost there is `) {`,
// `Self {`, `self):` - and the floor refuses exactly that shape. The number the
// floor's default was justified with came off `verify-phase2.json`, a run of a
// pipeline that no longer existed by the time the floor shipped.
// ###########################################################################

test("finding 1: a ghost ending on a block opener is exempt from both legs", () => {
  assert.strictEqual(belowGhostFloor(") {", 8, 2), false, "go, the closing line of a multi-line signature");
  assert.strictEqual(belowGhostFloor(" {", 8, 2), false, "rust `Self {`");
  assert.strictEqual(belowGhostFloor("self):", 8, 2), false, "python's declaration leg");
});

test("finding 1: and the exemption does not open the floor to short punctuation", () => {
  // The refused population of the shipped run, all of it still refused.
  for (const ghost of ["vec![];", "e.code;", "Get()", ");", "false", "+ 9 * 4"]) {
    assert.strictEqual(belowGhostFloor(ghost, 8, 2), true, `${ghost} is no longer refused`);
  }
  // `{` only where the served text left it open, `:` because rule 5 lets that
  // tail stand only at a Python declaration head.
  assert.strictEqual(belowGhostFloor("f() {}", 8, 2), true, "a closed block is not an open one");
});

test("finding 1: minChars 0 still disables the floor before the exemption is reached", () => {
  assert.strictEqual(belowGhostFloor(") {", 0, 2), false);
  assert.strictEqual(belowGhostFloor("no", 0, 2), false);
});

test("finding 1: the go and rust signature ghosts reach the human", async () => {
  const go = await serve(") {\n", {
    prefix: "func handle(w http.ResponseWriter, r *http.Request",
    suffix: "",
    languageId: "go",
  });
  assert.strictEqual(go.text, ") {");
  assert.strictEqual(floorLines(go.lines).length, 0);
  const rust = await serve(" {\n", { prefix: "        Self", suffix: "", languageId: "rust" });
  assert.strictEqual(rust.text, " {");
  assert.strictEqual(floorLines(rust.lines).length, 0);
});

test("finding 1: the default's justification is re-derived from the run that has the bound", () => {
  // The number quoted in `belowGhostFloor`, `src/vscode/config.ts` and the
  // user-facing `package.json` description. `verify-decl.json` is the shipped
  // run of the post-finding-8 pipeline, so it is the only file that can price
  // this floor. Without the exemption it is 17 of 710 (2.4%) with 9 of them
  // matching the developer's own next line, which is not a floor, it is a
  // regression.
  //
  // Read from test/fixtures/, NOT from session-v25/. `session*/` is gitignored,
  // so this row passed on the machine that ran the harness and died with ENOENT
  // in every clone - which is where it matters, because a clone is what CI and a
  // contributor have. The fixture carries the two fields this row reads (`ghost`
  // and `correct`) for all 750 records in order; 51K instead of 514K, and every
  // assertion below is unchanged. The full run stays in the session folder.
  const file = path.join(__dirname, "fixtures", "v25-verify-decl.slim.json");
  const served = JSON.parse(fs.readFileSync(file, "utf8")).filter((r) => r.ghost);
  const tripped = served.filter((r) => belowGhostFloor(r.ghost, 8, 2));
  assert.strictEqual(served.length, 710);
  assert.strictEqual(tripped.length, 7, `refused ${JSON.stringify(tripped.map((r) => r.ghost))}`);
  assert.strictEqual(
    tripped.filter((r) => r.correct > 0).length,
    0,
    "a refusal matched what the developer went on to write"
  );
});
