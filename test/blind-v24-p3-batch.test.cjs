// BLIND ORACLE — session-v24 phase 3, the four batched fixes.
// Written from the phase-3 surface document (17 numbered items) and the goal's
// §3/§5/§6/§7 ALONE. Nothing here has read
// src/vscode/fnGen.ts, src/vscode/oracleSurface.ts, src/core/fnGenService.ts,
// src/core/punt.ts, src/core/prompt.ts or any extraction/reindent module; the
// esbuild bundles resolve them at bundle time only and every assertion is made
// on an OUTPUT (an assembled string, a returned value, a channel line, a
// window message, a package.json field).
//
// RED BY DESIGN. The four fixes do not exist yet. What is pinned:
//
//   Fix 3 — the punt retry keeps the prompt it is retrying (items 1-5).
//     assembleAntiPuntReprompt must carry the ORIGINAL prompt byte-for-byte
//     (item 1), the model's own punt text (item 2) and the firm instruction as
//     an ADDITION (item 3). Items 4 (retry prompt size logged) and 5 (exactly
//     one extra generation) are observed end to end at the one seam every
//     generation crosses — a fake in-process Ollama — in harness D.
//
//   Fix 5 — Rust gets the re-indent leg (items 6-9). The TypeScript leg
//     (reindentTsBody) is the control: the SAME case table runs through it and
//     is green, which proves the expectation is the shipped contract and not
//     this file's invention.
//
//   Fix 6 — failure is told to the human (items 10-14), over a fake vscode
//     window. Item 14 is the trap: a run that notifies unconditionally passes
//     "it notifies on failure", so the success row and the cancellation row
//     assert ZERO window messages on the same harness.
//
//   Fix 7 — the bodyOnly trim exemption (items 15-17), through the generation
//     service with an injected generate fn.
//
// GREEN NOW AND AFTER, on purpose (the regression bars):
//   * item 7  — a top-level Rust target is a byte-for-byte no-op. Asserted
//     through whichever leg exists: today there is no Rust leg, so identity
//     holds trivially; after the fix it must hold through reindentRustBody with
//     indent "". Either way the bar is the same sentence and it never goes red.
//   * item 16 — every non-body-only reply shape keeps the trim unchanged. The
//     expected values were CAPTURED by running the current code. The sharpest
//     row is the python non-bodyOnly obedient-body reply, which must still
//     reject: an implementation that exempts "replies with no declaration head"
//     instead of "requests with bodyOnly set" turns that row red.
//   * item 13 — the channel evidence stays. Captured from the current build.
//   * item 14 — no notification where nothing failed.
//
// NAME TOLERANCE, stated because it is a real assumption. Two contract items
// need an input the current signature does not have:
//   - fix 3 item 1 needs the original prompt to reach assembleAntiPuntReprompt.
//     The FIELD NAME is not part of the external contract, so the input carries
//     a SUPERSET of the plausible carriers (originalPrompt/basePrompt/prompt/
//     firstPrompt/previousPrompt) plus the INGREDIENTS under the names
//     assembleFnGenPrompt already uses (contextBlocks/injectedSurface/...), so
//     an implementation that re-assembles rather than passes through also
//     passes. The assertion is on the output either way.
//   - fix 5 needs a Rust re-indent export. Every src/core module whose name
//     could plausibly host it is probed and the first `reindent*` export found
//     is the leg under test. If the implementer names it something with no
//     `reindent` prefix, these rows must be re-pointed — report that, do not
//     weaken the assertion.
//
// Run: SKIP_LIVE=1 node --test test/blind-v24-p3-batch.test.cjs
// (Hermetic apart from item 11, which runs REAL cargo over a scratch copy of
//  test/fixtures/repairbench — the impl4-vscode recipe. No model, no
//  network: the "Ollama" in harness D is in-process.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("node:http");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const REPO = path.join(__dirname, "..");

// ===========================================================================
// Bundle A — the pure core: punt assembly, prompt assembly, the generation
// service, and the TypeScript re-indent leg used as the control for fix 5.
// ===========================================================================

let A = {};
let aErr;
let aCleanup = () => {};
try {
  ({ mod: A, cleanup: aCleanup } = bundleCore(
    "blind-v24-p3-core",
    `export { looksLikePunt, assembleAntiPuntReprompt, NO_PUNT_INSTRUCTION, noPuntInstructionFor } from "../src/core/punt";
export { assembleFnGenPrompt } from "../src/core/prompt";
export { FnGenService } from "../src/core/fnGenService";
export { reindentTsBody } from "../src/core/tsExtraction";\n`,
  ));
} catch (e) {
  aErr = e;
}
test.after(() => aCleanup());

const {
  assembleAntiPuntReprompt,
  NO_PUNT_INSTRUCTION,
  noPuntInstructionFor,
  assembleFnGenPrompt,
  FnGenService,
  reindentTsBody,
} = A;

test("harness guard: the pure core bundle builds headless", () => {
  if (aErr) assert.fail(`core bundle failed: ${aErr.message}`);
});
const atest = (name, fn) =>
  test(name, (ctx) => (aErr ? ctx.skip("core bundle failed; see the harness guard") : fn(ctx)));

// ===========================================================================
// FIX 3 — the punt retry keeps the prompt it is retrying (items 1, 2, 3).
// Items 4 and 5 are end-to-end; they live in harness D.
// ===========================================================================

const P3_SIG = "fn expire_stale(&mut self, now: Instant) -> usize";
const P3_DOC = "/// Drop every cached segment whose deadline has passed.";
const P3_LANG = "rust";
const P3_BLOCK = {
  uri: "file:///proj/src/log_segments_cache.rs",
  range: { startLine: 40, endLine: 52 },
  text: "impl LogSegmentsCache {\n    fn wal_seq(&self) -> (u64, u64) {\n        (self.lo, self.hi)\n    }\n}",
};
const P3_SURFACE =
  "`LogSegmentsCache`\n```rust\npub struct LogSegmentsCache { active_file: RefCell<File> }\nfn wal_seq(&self) -> (u64, u64)\n```";
// The model's own punt, carrying the diagnosis that died in the channel.
const P3_PUNTED =
  "fn expire_stale(&mut self, now: Instant) -> usize {\n" +
  "    // we don't have access to the actual cache state here\n" +
  "    todo!()\n" +
  "}";

const p3Original = () =>
  assembleFnGenPrompt({
    signature: P3_SIG,
    docComment: P3_DOC,
    languageId: P3_LANG,
    contextBlocks: [P3_BLOCK],
    injectedSurface: P3_SURFACE,
  });

// One call, many assertions: the reprompt input carries both the assembled
// original (under every plausible carrier name) and its ingredients.
const p3Reprompt = () => {
  const original = p3Original();
  return assembleAntiPuntReprompt({
    signature: P3_SIG,
    docComment: P3_DOC,
    languageId: P3_LANG,
    punted: P3_PUNTED,
    contextBlocks: [P3_BLOCK],
    injectedSurface: P3_SURFACE,
    originalPrompt: original,
    basePrompt: original,
    prompt: original,
    firstPrompt: original,
    previousPrompt: original,
  });
};

atest("item 1: the regeneration prompt carries the ORIGINAL prompt byte-for-byte, in the same order", () => {
  const original = p3Original();
  const out = p3Reprompt();
  assert.ok(
    out.includes(original),
    "the retry must be the original prompt PLUS the anti-punt material, not a fresh minimal prompt.\n" +
      `original (${original.length} chars):\n${original}\n\n--- reprompt (${out.length} chars):\n${out}`,
  );
});

// Graded diagnosis for item 1: which of the original's pieces survived.
const P3_PIECES = [
  ["the context block text", P3_BLOCK.text],
  ["the context block header uri", P3_BLOCK.uri],
  ["the injected surface", P3_SURFACE],
  ["the doc comment", P3_DOC],
  ["the signature", P3_SIG],
];
for (const [label, piece] of P3_PIECES) {
  atest(`item 1 (piece): the retry keeps ${label}`, () => {
    const out = p3Reprompt();
    assert.ok(out.includes(piece), `${label} was dropped from the retry. REPROMPT:\n${out}`);
  });
}

atest("item 2: the model's own punt text rides the retry, diagnosis included", () => {
  const out = p3Reprompt();
  assert.ok(
    out.includes("we don't have access to the actual cache state"),
    `the punt text's diagnosis is the most useful thing attempt 1 produced; it must not die in the channel. REPROMPT:\n${out}`,
  );
});

atest("item 3: the firm instruction is APPENDED, not substituted (both the original and the directive are present)", () => {
  const original = p3Original();
  const firm = typeof noPuntInstructionFor === "function" ? noPuntInstructionFor(P3_LANG) : NO_PUNT_INSTRUCTION;
  const out = p3Reprompt();
  assert.ok(out.includes(firm), `the firm no-stub directive must be present. REPROMPT:\n${out}`);
  assert.ok(
    out.includes(original),
    "substitution is the defect: the directive replaced the prompt instead of being added to it",
  );
});

// ===========================================================================
// FIX 5 — the Rust re-indent leg (items 6, 7, 8). Item 9 is the Python
// plain-function dispatch; see the note at the end of this section.
// ===========================================================================

// Probe every src/core module that could host the Rust leg. Modules are found
// by FILENAME (never by reading source); the first `reindent*` export in any of
// them is the leg under test.
const RUST_HOST_FILES = ["extraction.ts", "rustExtraction.ts", "rsExtraction.ts"].filter((f) =>
  fs.existsSync(path.join(REPO, "src", "core", f)),
);
let rustLeg;
let rustLegName;
let rustProbeErr;
let rustProbeCleanup = () => {};
try {
  const entry = RUST_HOST_FILES.map((f, i) => `export * as m${i} from "../src/core/${f.replace(/\.ts$/, "")}";`).join("\n") + "\n";
  const probe = bundleCore("blind-v24-p3-rustleg", entry);
  rustProbeCleanup = probe.cleanup;
  for (const ns of Object.keys(probe.mod)) {
    for (const key of Object.keys(probe.mod[ns] || {})) {
      if (/^reindent/i.test(key) && typeof probe.mod[ns][key] === "function") {
        rustLeg = probe.mod[ns][key];
        rustLegName = key;
        break;
      }
    }
    if (rustLeg) break;
  }
} catch (e) {
  rustProbeErr = e;
}
test.after(() => rustProbeCleanup());

test("harness guard: the Rust-host modules bundle headless", () => {
  if (rustProbeErr) assert.fail(`rust-leg probe bundle failed: ${rustProbeErr.message}`);
});

const MISSING_LEG =
  `no Rust re-indent leg is exported from ${RUST_HOST_FILES.join("/")} ` +
  `(expected a sibling of reindentTsBody/reindentCsBody/reindentPyBody, e.g. reindentRustBody)`;

// The contract, restated from the TypeScript leg and PROVEN against it below:
// line 1 is kept (it lands after the existing indent), every later non-empty
// line gets `indent` prepended, empty lines are untouched, and lines inside a
// string literal are byte-exact.
const shifted = (text, indent) =>
  text
    .split("\n")
    .map((l, i) => (i === 0 || l === "" ? l : indent + l))
    .join("\n");

// --- the control: the same expectation, through the shipped TypeScript leg ---

const TS_BODY = "function f(a: number): number {\n  const n = a * 2;\n\n  return n;\n}";
const TS_TEMPLATE = "function f(): string {\n  const s = `line1\nline2`;\n  return s;\n}";

atest("control (TypeScript leg): a nested target shifts every line but the first [proves the expectation is the shipped contract]", () => {
  assert.strictEqual(reindentTsBody(TS_BODY, "    "), shifted(TS_BODY, "    "));
});
atest("control (TypeScript leg): indent '' is byte-identical", () => {
  assert.strictEqual(reindentTsBody(TS_BODY, ""), TS_BODY);
});
atest("control (TypeScript leg): a template-literal interior line is never shifted", () => {
  const out = reindentTsBody(TS_TEMPLATE, "    ");
  assert.ok(out.includes("\nline2`;"), `the string interior moved. OUT:\n${out}`);
});

// --- the Rust leg ------------------------------------------------------------

const RUST_BODY =
  "fn expire_stale(&mut self, now: Instant) -> usize {\n" +
  "    let mut n = 0;\n" +
  "\n" +
  "    for seg in self.segments.iter() {\n" +
  "        n += 1;\n" +
  "    }\n" +
  "    n\n" +
  "}";

atest("item 6: a Rust reply is re-indented to the span's anchor depth, same contract as the TypeScript leg", () => {
  assert.ok(rustLeg, MISSING_LEG);
  assert.strictEqual(
    rustLeg(RUST_BODY, "    "),
    shifted(RUST_BODY, "    "),
    `${rustLegName} must shift every line but the first by the anchor indent`,
  );
});

atest("item 6 (blank lines): an empty line inside a re-indented Rust body stays empty, never whitespace", () => {
  assert.ok(rustLeg, MISSING_LEG);
  assert.ok(
    rustLeg(RUST_BODY, "    ").split("\n").includes(""),
    "a blank body line must not gain trailing whitespace",
  );
});

// item 7 — GREEN NOW AND AFTER. Today no leg exists, so identity holds; after
// the fix it must hold through the leg with indent "". One sentence, one bar.
const rustIdentity = (text) => (rustLeg ? rustLeg(text, "") : text);
for (const [label, text] of [
  ["a free function", RUST_BODY],
  ["an impl block", "impl Cache {\n    fn len(&self) -> usize {\n        self.n\n    }\n}"],
]) {
  test(`item 7 (regression bar): a top-level Rust target is a byte-for-byte no-op — ${label}`, () => {
    assert.strictEqual(rustIdentity(text), text, "a top-level target must not move by a single byte");
  });
}

const RUST_RAW_STRING =
  'fn sql(&self) -> &str {\n' +
  '    let q = r#"SELECT seq\nFROM wal\nWHERE lo > 0"#;\n' +
  "    q\n" +
  "}";
const RUST_MULTILINE_STRING =
  'fn banner(&self) -> String {\n' +
  '    let b = "first\nsecond";\n' +
  "    b.to_string()\n" +
  "}";

for (const [label, text, interior] of [
  ["a raw string r#\"...\"#", RUST_RAW_STRING, "\nFROM wal\n"],
  ["a multi-line \"...\" literal", RUST_MULTILINE_STRING, "\nsecond\";"],
]) {
  // The contract is PREPEND (item 6's control), so a `let` line already at four
  // spaces lands at four PLUS the anchor indent. Called with four, expected at
  // eight. An earlier draft called with eight and expected eight, which no
  // conforming implementation could satisfy.
  atest(`item 8: string-literal aware — ${label} is never shifted`, () => {
    assert.ok(rustLeg, MISSING_LEG);
    const out = rustLeg(text, "    ");
    assert.ok(out.includes(interior), `a line INSIDE the string literal was shifted. OUT:\n${out}`);
    assert.ok(out.includes("\n        let "), `the code line opening the string must still be re-indented. OUT:\n${out}`);
  });
}

// item 9 — the Python plain-function (no docstring, kind=function) path. The
// pure helper it needs (reindentPyBody) already exists and is already pinned by
// impl-v12-py-nested-splice; the gap is purely the DISPATCH inside fnGen.ts,
// which has no exported seam. It IS observable end to end all the same: the
// proposal presenter writes the spliced document into a content provider under
// its own URI scheme before opening the diff, and a stub can read that document
// back. Item 9 is driven there, in harness D. (An earlier draft of this file
// looked only at editor.edit / insertSnippet / setDecorations, saw nothing, and
// wrongly recorded the item as untestable — acceptance is a later gesture, and
// the proposal surface is not the acceptance surface.)

// ===========================================================================
// FIX 7 — the bodyOnly trim collision (items 15, 16) and the test:live list
// (item 17).
// ===========================================================================

const SVC_CFG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-30b",
  fallbackModel: "fake-14b",
  maxTokens: 128,
  temperature: 0.2,
};
const svcWith = (raw) => {
  const calls = [];
  const svc = new FnGenService(SVC_CFG, async (p) => {
    calls.push(p);
    return { text: raw, ttftMs: 1, totalMs: 2, doneReason: "stop" };
  });
  return { svc, calls };
};

const PY_BODY_ONLY_REQ = {
  signature: "def parse_order(data: bytes) -> dict:",
  docComment: "Parse the wire header, then read each length-prefixed line item.",
  languageId: "python",
};
const PY_OBEDIENT_BODY = "```python\nitems = {}\nfor line in data.splitlines():\n    items[line] = 1\nreturn items\n```";

atest("item 15: a body-only request is EXEMPT from the declaration-head trim — an obedient reply is not rejected", async () => {
  const { svc } = svcWith(PY_OBEDIENT_BODY);
  let out;
  try {
    out = await svc.generate({ ...PY_BODY_ONLY_REQ, bodyOnly: true });
  } catch (e) {
    svc.dispose();
    assert.fail(
      "an obedient body-only reply carries no declaration head; the trim must not reject it. " +
        `Rejected with: ${e.message}`,
    );
  }
  svc.dispose();
  assert.ok(out && typeof out.text === "string", "a body-only request resolves with the body");
  assert.ok(out.text.includes("return items"), `the body must survive intact, got:\n${out.text}`);
  assert.ok(!/def\s+parse_order/.test(out.text), "the body-only reply must not gain a declaration head");
});

// item 16 — GREEN NOW AND AFTER. Expected values captured from the current
// build; this is an exemption, not a removal.
const TRIM_KEPT = [
  {
    name: "a preamble use line above the fn is trimmed",
    req: { signature: "fn f()" },
    raw: "```rust\nuse std::io;\n\nfn f() {\n    io();\n}\n```",
    text: "fn f() {\n    io();\n}",
  },
  {
    name: "a trailing helper fn after the closing brace is trimmed",
    req: { signature: "fn f()" },
    raw: "```rust\nfn f() {\n    x();\n}\n\nfn helper() {\n    y();\n}\n```",
    text: "fn f() {\n    x();\n}",
  },
  {
    name: "bodyOnly:false is byte-identical to omitting it",
    req: { signature: "fn f()", bodyOnly: false },
    raw: "```rust\nuse std::io;\n\nfn f() {\n    io();\n}\n```",
    text: "fn f() {\n    io();\n}",
  },
];
for (const c of TRIM_KEPT) {
  atest(`item 16 (regression bar): ${c.name}`, async () => {
    const { svc } = svcWith(c.raw);
    const out = await svc.generate(c.req);
    svc.dispose();
    assert.strictEqual(out.text, c.text, "the trim must be unchanged for every non-body-only shape");
  });
}

atest("item 16 (regression bar): a reply without the requested function still rejects", async () => {
  const { svc } = svcWith("```rust\nfn something_else() {\n    x();\n}\n```");
  await assert.rejects(svc.generate({ signature: "fn f()" }), /requested function/);
  svc.dispose();
});

// The sharp one: the exemption is keyed on the REQUEST flag, not on the reply
// shape. An implementation that admits any head-less reply fails here.
atest("item 16 (regression bar, sharp): the SAME head-less reply still rejects when bodyOnly is not set", async () => {
  const { svc } = svcWith(PY_OBEDIENT_BODY);
  await assert.rejects(
    svc.generate(PY_BODY_ONLY_REQ),
    /requested function/,
    "the trim is what stops extra top-level items landing inside a span; only the flag may exempt it",
  );
  svc.dispose();
});

// item 17 — the test:live list. Order is contract, so the whole list is pinned:
// today's order, unchanged, with exactly one new entry appended at the END.
const LIVE_ORDER_TODAY = [
  "test/blind-integration-live.test.cjs",
  "test/impl-integration-live.test.cjs",
  "test/blind2-integration-live.test.cjs",
  "test/impl2-integration-live.test.cjs",
  "test/blind4-integration-live.test.cjs",
  "test/impl4-integration-live.test.cjs",
  "test/blind5-integration-live.test.cjs",
  "test/impl5-integration-live.test.cjs",
  "test/blind6-ra-live.test.cjs",
  "test/blind7-loop-live.test.cjs",
  "test/impl8-qualify-live.test.cjs",
  "test/impl-v3-structgen-live.test.cjs",
  "test/impl-v8-testrung-live.test.cjs",
  "test/blind-v10-oracle-live.test.cjs",
  "test/impl-v10-oracle-live.test.cjs",
  "test/blind-v10-extractor-live.test.cjs",
  "test/impl-v10-csextractor-live.test.cjs",
  "test/blind-v10-gestures-live.test.cjs",
  "test/blind-goalmd-csworkspacesymbol-live.test.cjs",
  "test/blind-goalmd-csusing-live.test.cjs",
  "test/blind-goalmd-csrecursiveshape-live.test.cjs",
];

test("item 17: impl-v13-bodyonly-live joins test:live, appended at the END, with the existing order untouched", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  const live = String(pkg.scripts["test:live"] || "");
  const files = live.split(/\s+/).filter((t) => t.endsWith(".test.cjs"));
  assert.deepStrictEqual(
    files,
    [...LIVE_ORDER_TODAY, "test/impl-v13-bodyonly-live.test.cjs"],
    "the list's order is contract (a warm serial context); the new file is appended, nothing is reordered",
  );
});

// ===========================================================================
// Harness C — FIX 6 item 11: a repair that gives up tells the human.
// The impl4-vscode recipe: runPostAcceptOracle bundled against a stub vscode,
// REAL cargo over a scratch copy of repairbench, a scripted model reply through
// the real FnGenService, a recording presenter standing in for the consent
// gate. Source "fngen" gets exactly one self-repair round, so a reply that does
// not fix the error ends the table with why=route-exhausted — the give-up the
// human was never told about.
// ===========================================================================

const C_STUB = path.join(__dirname, ".blind-v24-p3-c-stub.cjs");
fs.writeFileSync(
  C_STUB,
  `
const path = require("path");
const state = { config: {}, visibleTextEditors: [], collections: [], messages: [] };
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  translate(dl, dc) { return new Position(this.line + (dl || 0), this.character + (dc || 0)); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } appendMarkdown(t) { this.blocks.push(t); } }
class InlineCompletionItem { constructor(insertText, range) { this.insertText = insertText; this.range = range; } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  joinPath: (base, ...segs) => Uri.file(path.join(base.fsPath, ...segs)),
  parse: (s) => ({ raw: s, toString: () => s }),
};
const say = (kind) => async (message, ...actions) => { state.messages.push({ kind, message, actions }); return undefined; };
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, InlineCompletionItem, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  workspace: {
    getConfiguration: () => ({ get: (key, fallback) => (key in state.config ? state.config[key] : fallback) }),
    textDocuments: [],
    applyEdit: async () => true,
    openTextDocument: async () => ({ getText: () => "" }),
  },
  languages: {
    createDiagnosticCollection: (name) => {
      const c = { name, sets: [], set(uri, list) { this.sets.push({ uri: String(uri), list }); }, delete() {}, clear() {}, dispose() {} };
      state.collections.push(c);
      return c;
    },
  },
  commands: { executeCommand: async () => undefined, registerCommand: () => ({ dispose() {} }) },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.visibleTextEditors; },
    showWarningMessage: say("warn"),
    showInformationMessage: say("info"),
    showErrorMessage: say("error"),
    setStatusBarMessage: () => ({ dispose() {} }),
    withProgress: async (opts, task) => task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }),
    showTextDocument: async () => ({ document: { getText: () => "" }, setDecorations() {}, revealRange() {} }),
  },
};
`,
);

const C_ENTRY = path.join(__dirname, ".blind-v24-p3-c.entry.ts");
const C_OUT = path.join(__dirname, ".blind-v24-p3-c.bundle.cjs");
let C = {};
let cErr;
try {
  fs.writeFileSync(
    C_ENTRY,
    `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";
export { FnGenService } from "../src/core/fnGenService";
export { __state } from "vscode";\n`,
  );
  esbuild.buildSync({ entryPoints: [C_ENTRY], bundle: true, outfile: C_OUT, format: "cjs", platform: "node", alias: { vscode: C_STUB } });
  C = require(C_OUT);
} catch (e) {
  cErr = e;
}
test.after(() => [C_STUB, C_ENTRY, C_OUT].forEach((f) => fs.rmSync(f, { force: true })));

test("harness guard: the repair-surface bundle builds against the vscode stub", () => {
  if (cErr) assert.fail(`repair-surface bundle failed: ${cErr.message}`);
});

const REPAIRBENCH = path.join(REPO, "test", "fixtures", "repairbench");

const cFileDocument = (file) => ({
  languageId: "rust",
  isDirty: false,
  isClosed: false,
  version: 1,
  uri: { fsPath: file, path: file, scheme: "file", toString: () => "file://" + file },
  getText(range) {
    const t = fs.readFileSync(file, "utf8");
    return range ? t.slice(range.start.offset, range.end.offset) : t;
  },
  positionAt(offset) {
    const t = fs.readFileSync(file, "utf8");
    return { offset, line: t.slice(0, offset).split("\n").length - 1 };
  },
  lineAt(line) {
    const t = fs.readFileSync(file, "utf8").split("\n")[line] ?? "";
    return { text: t, range: { start: { line, character: 0 }, end: { line, character: t.length } } };
  },
  save: async () => true,
});

const cFnResolver = (fnName) => async (document) => {
  const t = document.getText();
  const start = t.indexOf(`pub fn ${fnName}`);
  if (start < 0) return undefined;
  const end = t.indexOf("\n}", start) + 2;
  return {
    span: { start, end },
    signature: t.slice(start, t.indexOf("{", start)).trimEnd(),
    docComment: undefined,
    symbolName: fnName,
    languageId: "rust",
  };
};

// One run: break parse_duration, let the single fngen self-repair round splice a
// reply that is DIFFERENT but still wrong, and let the table end.
let giveUpRun;
const runRepairGiveUp = () =>
  (giveUpRun ||= (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v24-p3-"));
    fs.cpSync(REPAIRBENCH, dir, { recursive: true });
    const file = path.join(dir, "src", "task1.rs");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
    const lines = [];
    const prompts = [];
    const service = new C.FnGenService(
      { apiBase: "http://fake:1", model: "scripted-30b", fallbackModel: "x", maxTokens: 512, temperature: 0.2 },
      async ({ prompt }) => {
        prompts.push(prompt);
        const t = fs.readFileSync(file, "utf8");
        const s = t.indexOf("pub fn parse_duration");
        const e = t.indexOf("\n}", s) + 2;
        // Still an E0308, different bytes: a genuine failed repair, not a no-op.
        return { text: "```rust\n" + t.slice(s, e).replace('Some("thirty")', 'Some("forty")') + "\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" };
      },
    );
    C.__state.config = { repairEnabled: true };
    C.__state.messages.length = 0;
    try {
      const t = fs.readFileSync(file, "utf8");
      const s = t.indexOf("pub fn parse_duration");
      const e = t.indexOf("\n}", s) + 2;
      await C.runPostAcceptOracle({
        document: cFileDocument(file),
        landedSpan: { start: s, end: e },
        source: "fngen",
        service,
        output: { appendLine: (l) => lines.push(l) },
        presenter: {
          present: async (req) => {
            const cur = fs.readFileSync(file, "utf8");
            fs.writeFileSync(file, cur.slice(0, req.span.start) + req.text + cur.slice(req.span.end));
            return "accept";
          },
        },
        resolveFunction: cFnResolver("parse_duration"),
        repairTierGate: { allowed: true },
      });
      return { lines, prompts, messages: C.__state.messages.slice() };
    } finally {
      service.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  })());

const ctest = (name, fn) =>
  test(name, { timeout: 300000 }, (ctx) => (cErr ? ctx.skip("repair-surface bundle failed") : fn(ctx)));

ctest("harness guard: the give-up path is genuinely reached (one round, then route-exhausted)", async () => {
  const { lines, prompts } = await runRepairGiveUp();
  assert.strictEqual(prompts.length, 1, `fngen gets exactly one self-repair round, got ${prompts.length}; lines=${JSON.stringify(lines)}`);
  assert.ok(
    lines.some((l) => /^\[repair\] surface why=route-exhausted errors=\d+/.test(l)),
    `the table must end route-exhausted for this fixture, got ${JSON.stringify(lines)}`,
  );
});

ctest("item 11 + 12: a repair that gives up tells the HUMAN — a window message, not just a channel line", async () => {
  const { messages, lines } = await runRepairGiveUp();
  assert.ok(
    messages.length > 0,
    `route-exhausted left broken code in the buffer and said nothing. The human reads prose, not channels. CHANNEL:\n${lines.join("\n")}`,
  );
});

ctest("item 11: the give-up message says how many errors remain and what the first one is", async () => {
  const { messages, lines } = await runRepairGiveUp();
  const all = messages.map((m) => m.message).join("\n");
  assert.ok(messages.length > 0, `no user-visible message at all. CHANNEL:\n${lines.join("\n")}`);
  assert.match(all, /\b1\b/, `the message must carry the remaining error count. MESSAGES:\n${all}`);
  assert.ok(
    /mismatched types/i.test(all) || /E0308/.test(all),
    `the message must carry the first diagnostic. MESSAGES:\n${all}`,
  );
});

ctest("item 13 (regression bar): the channel evidence stays — the surface line is unchanged", async () => {
  const { lines } = await runRepairGiveUp();
  assert.ok(
    lines.includes("[repair] surface why=route-exhausted errors=1 warnings=0"),
    `these are additions, not replacements, got ${JSON.stringify(lines)}`,
  );
});

// ===========================================================================
// Harness D — the whole extension activated against a stub vscode with a fake
// in-process Ollama (the blind-v9-gestures / blind-derust-punt pattern). This
// is the one seam every generation crosses, and the only place the window
// surface, the channel and the model call count can be read together.
// Covers fix 3 items 4 and 5, and fix 6 items 10, 12, 13 and 14.
// ===========================================================================

const D_STUB = path.join(__dirname, ".blind-v24-p3-d-stub.cjs");
fs.writeFileSync(
  D_STUB,
  `
const state = {
  config: {}, messages: [], commands: {}, executeCalls: [], commandHandlers: {},
  outputLines: [], inlineProviders: [], contentProviders: {},
  textDocuments: [], visibleTextEditors: [], activeTextEditor: undefined,
  collections: [],
};
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
  with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(p) {
    const s = this.start, e = this.end;
    const ps = p.start ? p.start : p;
    const pe = p.end ? p.end : p;
    const geS = ps.line > s.line || (ps.line === s.line && ps.character >= s.character);
    const leE = pe.line < e.line || (pe.line === e.line && pe.character <= e.character);
    return geS && leE;
  }
  with(start, end) { return new Range(start || this.start, end || this.end); }
  intersection() { return undefined; }
  union(o) { return o; }
}
class Selection extends Range {
  constructor(a, b, c, d) { super(a, b, c, d); this.anchor = this.start; this.active = this.end; this.isReversed = false; }
}
class WorkspaceEdit {
  constructor() { this._entries = []; }
  replace(uri, range, text) { this._entries.push([uri, [{ range, newText: text }]]); }
  insert(uri, pos, text) { this._entries.push([uri, [{ range: new Range(pos, pos), newText: text }]]); }
  entries() { return this._entries; }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString {
  constructor(value) { this.value = value || ""; this.isTrusted = false; }
  appendCodeblock(t, lang) { this.value += "\\n\`\`\`" + (lang || "") + "\\n" + t + "\\n\`\`\`\\n"; }
  appendMarkdown(t) { this.value += t; }
  appendText(t) { this.value += t; }
}
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class SnippetString { constructor(value) { this.value = value || ""; } appendText(t) { this.value += t; return this; } appendTabstop() { return this; } }
class InlineCompletionItem { constructor(insertText, range, command) { this.insertText = insertText; this.range = range; this.command = command; } }
class InlineCompletionList { constructor(items) { this.items = items; } }
class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }
class Location { constructor(uri, rangeOrPos) { this.uri = uri; this.range = rangeOrPos; } }
class Hover { constructor(contents, range) { this.contents = Array.isArray(contents) ? contents : [contents]; this.range = range; } }
class RelativePattern { constructor(base, pattern) { this.base = base; this.pattern = pattern; } }
class CancellationTokenSource {
  constructor() { this.token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }; }
  cancel() { this.token.isCancellationRequested = true; }
  dispose() {}
}
const mkUri = (full, fsPath) => ({
  scheme: full.includes("://") ? full.slice(0, full.indexOf("://")) : "file",
  fsPath, path: fsPath, query: "", fragment: "",
  toString: () => full,
  with() { return this; },
  toJSON() { return full; },
});
const Uri = {
  file: (p) => mkUri("file://" + p, p),
  parse: (s) => mkUri(String(s), String(s).replace(/^[a-zA-Z+-]+:\\/\\//, "")),
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
  from: (c) => {
    const full =
      (c.scheme || "file") + "://" + (c.authority || "") + (c.path || "") +
      (c.query ? "?" + c.query : "") + (c.fragment ? "#" + c.fragment : "");
    const u = mkUri(full, c.path || "");
    u.scheme = c.scheme || "file";
    u.query = c.query || "";
    u.fragment = c.fragment || "";
    return u;
  },
};
const disposable = () => ({ dispose() {} });
module.exports = {
  __state: state,
  version: "1.85.0",
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString,
  Diagnostic, SnippetString, InlineCompletionItem, InlineCompletionList, TreeItem,
  Location, Hover, RelativePattern, CancellationTokenSource, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5,
    Class: 6, Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13,
    Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19, Constant: 20,
    Struct: 21, Event: 22, Operator: 23, TypeParameter: 24 },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EndOfLine: { LF: 1, CRLF: 2 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  CodeActionKind: { QuickFix: { value: "quickfix" }, Refactor: { value: "refactor" } },
  workspace: {
    getConfiguration: (section) => ({
      get: (key, fallback) => {
        if (key in state.config) return state.config[key];
        const full = section ? section + "." + key : key;
        if (full in state.config) return state.config[full];
        return fallback;
      },
      has: (key) => key in state.config,
      inspect: () => undefined,
      update: async () => {},
    }),
    onDidChangeConfiguration: () => disposable(),
    onDidChangeTextDocument: () => disposable(),
    onDidOpenTextDocument: () => disposable(),
    onDidCloseTextDocument: () => disposable(),
    onDidRenameFiles: () => disposable(),
    onDidDeleteFiles: () => disposable(),
    onDidSaveTextDocument: () => disposable(),
    registerTextDocumentContentProvider: (scheme, provider) => {
      state.contentProviders[scheme] = provider;
      return disposable();
    },
    get textDocuments() { return state.textDocuments; },
    openTextDocument: async (arg) => {
      const key = typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg);
      const docs = globalThis.__V24P3_DOCS__ || {};
      if (docs[key]) return docs[key];
      const scheme = key.includes("://") ? key.slice(0, key.indexOf("://")) : "file";
      const provider = state.contentProviders[scheme];
      const text = provider ? await provider.provideTextDocumentContent(typeof arg === "string" ? Uri.parse(arg) : arg) : "";
      const lines = String(text || "").split("\\n");
      return {
        uri: typeof arg === "string" ? Uri.parse(arg) : arg,
        languageId: "plaintext", version: 1, lineCount: lines.length,
        getText: () => text || "",
        lineAt: (n) => { const i = typeof n === "number" ? n : n.line; const t = lines[i] || ""; return { lineNumber: i, text: t, firstNonWhitespaceCharacterIndex: 0, isEmptyOrWhitespace: t.trim() === "", range: new Range(i, 0, i, t.length) }; },
        offsetAt: () => 0, positionAt: () => new Position(0, 0), save: async () => true,
      };
    },
    applyEdit: async () => true,
    get workspaceFolders() { return [{ uri: Uri.file("/proj"), name: "proj", index: 0 }]; },
    asRelativePath: (u) => String(u),
    createFileSystemWatcher: () => ({ onDidChange: () => disposable(), onDidCreate: () => disposable(), onDidDelete: () => disposable(), dispose() {} }),
    fs: { stat: async () => ({ type: 1 }), readFile: async () => new Uint8Array() },
  },
  languages: {
    createDiagnosticCollection: (name) => {
      const c = { name, set() {}, delete() {}, clear() {}, dispose() {} };
      state.collections.push(c);
      return c;
    },
    registerInlineCompletionItemProvider: (selector, provider) => {
      state.inlineProviders.push({ selector, provider });
      return disposable();
    },
    registerCodeActionsProvider: () => disposable(),
    registerCodeLensProvider: () => disposable(),
    registerHoverProvider: () => disposable(),
    getDiagnostics: () => [],
    onDidChangeDiagnostics: () => disposable(),
    setLanguageConfiguration: () => disposable(),
  },
  window: {
    createOutputChannel: (name) => ({
      name,
      appendLine: (l) => state.outputLines.push(l),
      append: (l) => state.outputLines.push(l),
      replace() {}, show() {}, hide() {}, clear() {}, dispose() {},
    }),
    createStatusBarItem: () => ({ text: "", tooltip: "", command: undefined, backgroundColor: undefined, show() {}, hide() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.visibleTextEditors; },
    get activeTextEditor() { return state.activeTextEditor; },
    onDidChangeActiveTextEditor: () => disposable(),
    onDidChangeTextEditorSelection: () => disposable(),
    onDidChangeVisibleTextEditors: () => disposable(),
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return undefined; },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return undefined; },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    showQuickPick: async () => undefined,
    withProgress: async (opts, task) => {
      const cancelled = !!globalThis.__V24P3_CANCEL__;
      const token = {
        get isCancellationRequested() { return !!globalThis.__V24P3_CANCEL__; },
        onCancellationRequested: (fn) => { if (cancelled) setTimeout(() => { try { fn(); } catch {} }, 0); return disposable(); },
      };
      return task({ report: () => {} }, token);
    },
    setStatusBarMessage: () => disposable(),
    showTextDocument: async (docOrUri) => {
      const document = docOrUri && typeof docOrUri.getText === "function" ? docOrUri : { uri: docOrUri, getText: () => "", languageId: "plaintext", version: 1 };
      return { document, selection: new Selection(new Position(0, 0), new Position(0, 0)), options: {}, viewColumn: 1, edit: async () => true, insertSnippet: async () => true, setDecorations() {}, revealRange() {} };
    },
    tabGroups: { all: [], onDidChangeTabs: () => disposable(), close: async () => {} },
    createTreeView: () => ({ dispose() {}, onDidChangeSelection: () => disposable(), onDidChangeVisibility: () => disposable(), reveal: async () => {} }),
    registerTreeDataProvider: () => disposable(),
    registerWebviewViewProvider: () => disposable(),
    activeColorTheme: { kind: 1 },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return disposable(); },
    executeCommand: async (id, ...args) => {
      state.executeCalls.push({ id, args });
      const h = state.commandHandlers[id];
      if (h) return h(...args);
      if (state.commands[id]) return state.commands[id](...args);
      return undefined;
    },
    getCommands: async () => Object.keys(state.commands),
  },
  env: { appName: "stub", machineId: "stub", clipboard: { writeText: async () => {} }, openExternal: async () => true },
  extensions: { getExtension: () => undefined, all: [] },
};
`
);

const D_ENTRY = path.join(__dirname, ".blind-v24-p3-d.entry.ts");
const D_OUT = path.join(__dirname, ".blind-v24-p3-d.bundle.cjs");
let D = {};
let dErr;
try {
  fs.writeFileSync(
    D_ENTRY,
    `export { activate } from "../src/vscode/extension";
export { __state, Position, Range, Selection, Uri } from "vscode";\n`,
  );
  esbuild.buildSync({ entryPoints: [D_ENTRY], bundle: true, outfile: D_OUT, format: "cjs", platform: "node", alias: { vscode: D_STUB } });
  D = require(D_OUT);
  if (typeof D.activate !== "function") throw new Error("the bundle built but exports no activate function");
} catch (e) {
  dErr = e;
}
test.after(() => [D_STUB, D_ENTRY, D_OUT].forEach((f) => fs.rmSync(f, { force: true })));

test("harness guard: the extension bundle builds and activates against the stub", async () => {
  if (dErr) assert.fail(`the surface is not buildable: ${dErr.message}`);
  await dHarness();
});

const dtest = (name, fn) =>
  test(name, (ctx) => (dErr ? ctx.skip("extension bundle failed; see the harness guard") : fn(ctx)));

const MODELS = ["fake-fim", "fake-30b", "fake-14b"];
function startServer() {
  const srv = { requests: [], replyFor: null };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = { raw };
      }
      srv.requests.push({ method: req.method, url: req.url, body });
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: MODELS.map((name) => ({ name, model: name })) }));
        return;
      }
      if (req.url === "/api/generate") {
        const text = (srv.replyFor && srv.replyFor(body)) || "0";
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(JSON.stringify({ response: text }) + "\n");
        res.write(JSON.stringify({ response: "", done: true, done_reason: "stop" }) + "\n");
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      srv.apiBase = `http://127.0.0.1:${server.address().port}`;
      srv.close = () => new Promise((r) => server.close(r));
      resolve(srv);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (predicate, tries = 200) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await sleep(25);
  }
  return false;
};

let dHarnessP;
let dSrv;
const dHarness = () =>
  (dHarnessP ||= (async () => {
    if (dErr) throw dErr;
    dSrv = await startServer();
    D.__state.config = {
      enabled: true,
      apiBase: dSrv.apiBase,
      fimModel: "fake-fim",
      fnGenModel: "fake-30b",
      fnGenFallbackModel: "fake-14b",
      fnGenProvider: "ollama",
      cloudApiKey: "",
      cloudApiBase: "",
      hardwareTier: "16gb-large-ram",
      maxTokens: 128,
      temperature: 0.01,
      debounceMs: 0,
      prefixChars: 3000,
      suffixChars: 1000,
      multiline: true,
      repairEnabled: false,
      compilerDirectedInjection: true,
    };
    const mem = { get: (k, f) => f, update: async () => {}, keys: () => [], setKeysForSync() {} };
    await D.activate({
      subscriptions: [],
      globalState: mem,
      workspaceState: mem,
      secrets: { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) },
      extensionUri: D.Uri.file("/ext"),
      extensionPath: "/ext",
      extensionMode: 1,
      asAbsolutePath: (p) => "/ext/" + p,
      globalStorageUri: D.Uri.file("/tmp/blind-v24-p3-storage"),
      logUri: D.Uri.file("/tmp/blind-v24-p3-log"),
      environmentVariableCollection: { replace() {}, append() {}, prepend() {}, clear() {} },
    });
    await waitFor(() => typeof D.__state.commands["column80.generateFunction"] === "function");
    await waitFor(() => D.__state.outputLines.some((l) => l.includes("tier=")));
    return dSrv;
  })());

test.after(async () => {
  try {
    if (dSrv) await dSrv.close();
  } catch {}
});

function makeDoc(text, uriStr, languageId) {
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + pos.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new D.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new D.Position(lines.length - 1, lines[lines.length - 1].length);
  };
  return {
    uri: D.Uri.parse(uriStr),
    fileName: uriStr.replace(/^file:\/\//, ""),
    languageId,
    version: 1,
    isDirty: false,
    isUntitled: false,
    isClosed: false,
    eol: 1,
    lineCount: lines.length,
    save: async () => true,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (arg) => {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = lines[n] ?? "";
      const m = t.match(/\S/);
      return {
        lineNumber: n,
        text: t,
        range: new D.Range(n, 0, n, t.length),
        rangeIncludingLineBreak: new D.Range(n, 0, n + 1, 0),
        firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m,
      };
    },
    getWordRangeAtPosition: (pos) => {
      const t = lines[pos.line] ?? "";
      const isWord = (c) => /[A-Za-z0-9_$]/.test(c);
      let s = Math.min(pos.character, t.length);
      let e = s;
      while (s > 0 && isWord(t[s - 1])) s--;
      while (e < t.length && isWord(t[e])) e++;
      return e > s ? new D.Range(pos.line, s, pos.line, e) : undefined;
    },
  };
}

const makeEditor = (doc, pos) => ({
  document: doc,
  selection: new D.Selection(pos, pos),
  selections: [new D.Selection(pos, pos)],
  options: { tabSize: 4, insertSpaces: true },
  viewColumn: 1,
  edit: async (cb) => {
    const b = {
      replace: (range, text) => globalThis.__V24P3_EDITS__.push({ via: "editor.edit", range, text }),
      insert: (pos2, text) => globalThis.__V24P3_EDITS__.push({ via: "editor.edit", range: pos2, text }),
      delete: () => {},
    };
    try {
      cb(b);
    } catch {}
    return true;
  },
  insertSnippet: async (s) => {
    globalThis.__V24P3_EDITS__.push({ via: "insertSnippet", text: s && s.value !== undefined ? s.value : String(s) });
    return true;
  },
  setDecorations(type, ranges) {
    globalThis.__V24P3_EDITS__.push({ via: "setDecorations", text: JSON.stringify({ type: type && type.opts, ranges }) });
  },
  revealRange() {},
});

const posOf = (text, needle) => {
  const idx = text.indexOf(needle);
  assert.ok(idx >= 0, `fixture needle not found: ${JSON.stringify(needle)}`);
  const before = text.slice(0, idx);
  const line = (before.match(/\n/g) || []).length;
  return new D.Position(line, idx - (before.lastIndexOf("\n") + 1));
};
const vr = (sl, sc, el, ec) => new D.Range(sl, sc, el, ec);
const dsym = (name, kind, range, selectionRange, children = [], detail = "") => ({ name, detail, kind, range, selectionRange, children });
const emptyHandlers = (symbols) => ({
  "vscode.executeDocumentSymbolProvider": () => symbols,
  "vscode.executeDefinitionProvider": () => undefined,
  "vscode.executeHoverProvider": () => undefined,
  "vscode.executeCompletionItemProvider": () => undefined,
  "vscode.executeCodeActionProvider": () => undefined,
});

const genRequests = () => dSrv.requests.filter((r) => r.url === "/api/generate");

// Drive one fn-gen gesture to quiescence. Returns everything observable.
async function driveFnGen({ doc, cursor, symbols, uri, reply, cancel = false, settleMs = 600 }) {
  await dHarness();
  D.__state.commandHandlers = emptyHandlers(symbols);
  D.__state.messages.length = 0;
  D.__state.executeCalls.length = 0;
  D.__state.outputLines.length = 0;
  globalThis.__V24P3_DOCS__ = { [uri]: doc };
  globalThis.__V24P3_EDITS__ = [];
  globalThis.__V24P3_CANCEL__ = cancel;
  const editor = makeEditor(doc, cursor);
  D.__state.activeTextEditor = editor;
  D.__state.textDocuments = [doc];
  D.__state.visibleTextEditors = [editor];
  dSrv.requests.length = 0;
  dSrv.replyFor = reply;
  const cmd = D.__state.commands["column80.generateFunction"];
  assert.strictEqual(typeof cmd, "function", "column80.generateFunction must be registered");
  const status = { settled: false, error: undefined };
  Promise.resolve()
    .then(() => cmd())
    .then(
      () => (status.settled = true),
      (e) => {
        status.error = e;
        status.settled = true;
      },
    );
  await waitFor(() => status.settled, 40);
  await sleep(settleMs);
  globalThis.__V24P3_CANCEL__ = false;
  return {
    status,
    prompts: genRequests().map((r) => r.body.prompt),
    messages: D.__state.messages.slice(),
    lines: D.__state.outputLines.slice(),
    edits: globalThis.__V24P3_EDITS__.slice(),
  };
}

const RUST_URI = "file:///proj/src/log_segments_cache.rs";
const rustFixture = () => {
  const text = "fn total_mass(w: &Widget) -> u64 {\n\n}\n";
  const sig = posOf(text, "fn total_mass");
  const nameCh = text.split("\n")[sig.line].indexOf("total_mass");
  const doc = makeDoc(text, RUST_URI, "rust");
  return {
    doc,
    uri: RUST_URI,
    cursor: new D.Position(sig.line + 1, 0),
    symbols: [dsym("total_mass", 11, vr(sig.line, 0, sig.line + 2, 1), vr(sig.line, nameCh, sig.line, nameCh + "total_mass".length))],
  };
};

const PUNT_DIAGNOSIS = "we do not have access to the actual widget dimensions";
const rustPuntReply = () =>
  "```rust\nfn total_mass(w: &Widget) -> u64 {\n    // " + PUNT_DIAGNOSIS + "\n    todo!()\n}\n```";
const rustGoodReply = () => "```rust\nfn total_mass(w: &Widget) -> u64 {\n    w.mass\n}\n```";

// --- scenario 1: the double punt (fix 3 items 4/5, fix 6 items 10/12/13) ----

// The capture's shape: both attempts punt, and today the run ends by presenting
// the stub and (in the capture) outcome=reject, with nothing said. The human is
// owed the reason SOMEWHERE on that run, so after the second stub settles this
// also fires the reject gesture and keeps collecting: an implementation that
// speaks at the punt AND one that speaks at the reject both pass, and today's
// silence at both points is the red. (Item 14's silence bars are driven on
// their own runs, which are never rejected, so there is no contradiction.)
let doublePuntRun;
const doublePunt = () =>
  (doublePuntRun ||= (async () => {
    const fix = rustFixture();
    const r = await driveFnGen({ ...fix, reply: rustPuntReply, settleMs: 900 });
    if (r.messages.length === 0) {
      const reject = D.__state.commands["column80.proposalReject"];
      if (typeof reject === "function") {
        try {
          await reject();
        } catch {}
        await sleep(300);
        r.messages = D.__state.messages.slice();
        r.lines = D.__state.outputLines.slice();
      }
    }
    return r;
  })());

dtest("harness guard: a stub reply reaches the punt circle-back (a second model request)", async () => {
  const r = await doublePunt();
  assert.ok(
    r.prompts.length >= 2,
    `the punt circle-back must fire for this fixture, got ${r.prompts.length} request(s); lines=${JSON.stringify(r.lines.slice(-8))}`,
  );
});

dtest("item 5 (regression bar): a retry costs EXACTLY one extra generation — no new round, no loop", async () => {
  const r = await doublePunt();
  assert.strictEqual(r.prompts.length, 2, `one initial generation plus one retry, got ${r.prompts.length}`);
});

dtest("item 1 (end to end): the retry prompt contains the original prompt it is retrying", async () => {
  const r = await doublePunt();
  assert.ok(r.prompts.length >= 2, "the circle-back must have fired");
  assert.ok(
    r.prompts[1].includes(r.prompts[0]),
    `the retry collapsed the prompt: original=${r.prompts[0].length} bytes, retry=${r.prompts[1].length} bytes.\nRETRY:\n${r.prompts[1]}`,
  );
});

dtest("item 4: the retry's prompt size is logged, so a collapse is visible if it recurs", async () => {
  const r = await doublePunt();
  const sized = r.lines.filter((l) => /promptBytes=\d+/.test(l));
  assert.ok(
    sized.length >= 2,
    `every generation's prompt size must be on the channel, including the retry's; got ${sized.length} line(s): ${JSON.stringify(r.lines.filter((l) => l.startsWith("[fngen]")))}`,
  );
});

dtest("item 10 + 12: a rejected generation tells the human, and the reason is the punt's own diagnosis", async () => {
  const r = await doublePunt();
  assert.ok(
    r.messages.length > 0,
    `a double punt ended with nothing shown to the human. CHANNEL:\n${r.lines.join("\n")}`,
  );
  const all = r.messages.map((m) => m.message).join("\n");
  assert.ok(
    all.includes(PUNT_DIAGNOSIS),
    `the human must see the model's own diagnosis, not a generic failure string. MESSAGES:\n${all}`,
  );
});

dtest("item 13 (regression bar): the channel evidence for the punt stays", async () => {
  const r = await doublePunt();
  assert.ok(
    r.lines.some((l) => /punt/i.test(l)),
    `these are additions, not replacements; the punt evidence must still be on the channel, got ${JSON.stringify(r.lines.filter((l) => l.startsWith("[fngen]")))}`,
  );
});

// --- scenario 2 and 3: silence stays silent (item 14) -----------------------

dtest("item 14 (regression bar): a successful generation shows the human NOTHING", async () => {
  const fix = rustFixture();
  const r = await driveFnGen({ ...fix, reply: rustGoodReply });
  assert.deepStrictEqual(
    r.messages.map((m) => `${m.kind}: ${m.message}`),
    [],
    "no notification on a path where nothing failed — an implementation that notifies unconditionally fails here",
  );
});

dtest("item 14 (regression bar): a cancelled generation shows the human NOTHING — cancellation is the human's own gesture", async () => {
  const fix = rustFixture();
  const r = await driveFnGen({ ...fix, reply: rustGoodReply, cancel: true });
  // Harness guard, green today: the run really did take the cancellation path,
  // so this row can never degrade into a duplicate of the success row.
  assert.ok(
    r.lines.some((l) => /abort|cancel/i.test(l)),
    `the cancellation path was not reached, so this row proves nothing. CHANNEL:\n${r.lines.join("\n")}`,
  );
  assert.deepStrictEqual(
    r.messages.map((m) => `${m.kind}: ${m.message}`),
    [],
    "a cancellation is not a failure and must never be reported as one",
  );
});

// --- item 9: the Python plain-function dispatch, through the presenter seam --
//
// THE SEAM. The proposal presenter writes the spliced document into a
// TextDocumentContentProvider registered under its own URI scheme, then opens a
// diff against that URI. Both halves are observable from a stub: the stub
// records every registered provider by scheme and every executeCommand call
// with its arguments, so any argument whose scheme has a provider can be read
// back as the text the human is about to be shown. (editor.edit / insertSnippet
// / setDecorations record nothing here — acceptance is a later gesture — which
// is what an earlier draft of this file mistook for "no seam exists".)
const proposedDocuments = async () => {
  const texts = [];
  for (const call of D.__state.executeCalls) {
    for (const arg of call.args || []) {
      const scheme = arg && arg.scheme;
      const provider = scheme && D.__state.contentProviders[scheme];
      if (!provider) continue;
      let text;
      try {
        text = await provider.provideTextDocumentContent(arg);
      } catch {
        continue;
      }
      if (typeof text === "string" && text !== "") texts.push(text);
    }
  }
  return texts;
};

const PY_NESTED_URI = "file:///proj/src/cache.py";
const pyNestedFixture = () => {
  const text = "class Cache:\n    def total(self, key):\n        \n";
  const clsSig = posOf(text, "class Cache");
  const mSig = posOf(text, "    def total");
  const doc = makeDoc(text, PY_NESTED_URI, "python");
  const method = dsym("total", 5, vr(mSig.line, 4, mSig.line + 1, 8), vr(mSig.line, 8, mSig.line, 8 + "total".length));
  return {
    doc,
    uri: PY_NESTED_URI,
    cursor: new D.Position(mSig.line + 1, 8),
    symbols: [dsym("Cache", 4, vr(clsSig.line, 0, mSig.line + 1, 8), vr(clsSig.line, 6, clsSig.line, 6 + "Cache".length), [method])],
  };
};

const PY_TOP_URI = "file:///proj/src/totals.py";
const pyTopFixture = () => {
  const text = "def total(key):\n    \n";
  const sig = posOf(text, "def total");
  const doc = makeDoc(text, PY_TOP_URI, "python");
  return {
    doc,
    uri: PY_TOP_URI,
    cursor: new D.Position(sig.line + 1, 4),
    symbols: [dsym("total", 11, vr(sig.line, 0, sig.line + 1, 4), vr(sig.line, 4, sig.line, 4 + "total".length))],
  };
};

const proposedFor = async (fixture, reply) => {
  await driveFnGen({ ...fixture(), reply: () => reply });
  const docs = await proposedDocuments();
  assert.ok(
    docs.length > 0,
    `the presenter wrote nothing to a content provider; the seam was not reached. executeCalls=${JSON.stringify(D.__state.executeCalls.map((c) => c.id))}`,
  );
  return docs.join("\n=====\n");
};

dtest("item 9: a nested no-docstring Python function is proposed at the span's anchor depth, not at column 0", async () => {
  const proposed = await proposedFor(pyNestedFixture, "```python\ndef total(self, key):\n    return self.items[key]\n```");
  assert.ok(
    proposed.includes("\n    def total(self, key):\n        return self.items[key]"),
    `the plain (no-docstring, kind=function) Python path must be re-indented like the other legs. PROPOSED:\n${proposed}`,
  );
  assert.ok(
    !proposed.includes("\n    return self.items[key]"),
    `the body landed at the header's own depth — the un-reindented shape. PROPOSED:\n${proposed}`,
  );
});

dtest("item 9 (regression bar): a top-level Python function is proposed byte-for-byte, no shift", async () => {
  const proposed = await proposedFor(pyTopFixture, "```python\ndef total(key):\n    return items[key]\n```");
  assert.ok(
    proposed.includes("def total(key):\n    return items[key]"),
    `a top-level target must not move by a single byte. PROPOSED:\n${proposed}`,
  );
  assert.ok(!proposed.includes("\n        return items[key]"), `the top-level body gained indentation. PROPOSED:\n${proposed}`);
});
