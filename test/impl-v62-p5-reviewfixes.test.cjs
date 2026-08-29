// White-box: the phase 3 adversarial findings, fixed (session-v62 phase 5).
//
// Every row here is a falsifier for one triaged finding in
// `session-v62/scraps.md`, "Phase 3 adversarial triage". The adversarial file
// itself is the reviewer's witness and is never edited; this file is the
// implementer's, and it goes one level below each finding to pin the MECHANISM
// rather than the symptom, so the next change to these paths has to keep the
// mechanism rather than merely the string.
//
// ROWS
//   F1  the staleness anchor is captured BEFORE the symbol-provider await
//        1  a keystroke during resolution discards instead of splicing
//        2  `versionAtResolve` is the version the OFFSETS belong to
//        3  the card SAYS it is stale for that same window (it could not before)
//   F3  the strip deletes only what it counts
//        4  a hand-written `// C80 ...` note survives, and is not counted
//        5  a trailing hand-written `// C80` note is not cut off a code line
//        6  what the product plants is still stripped, head and continuation
//        7  deleted == counted, over a region holding both shapes
//        8  the `sourceIndex` line map still names every survivor's origin
//   F5  the consent gate's buttons name a proposal, for all three gestures
//        9  no command title says "generated body"
//       10  the ids the keybindings and menus reference still exist
//   F6  the discard sentence's noun is the request's, and the channel gets why
//       11  fn-gen's discard toast is byte-identical (the default)
//       12  a caller that generates nothing names its own noun
//       13  the sink is handed the reason, so `[critique]` carries it
//       14  fn-gen's own outcome bytes are unmoved by the widened detail
//   F7  15  the wiring site does not call the gesture read-only
//
// Run: node --test test/impl-v62-p5-reviewfixes.test.cjs

const honestyStub = require("./.honesty-stub.cjs");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");
const { bundleWithVscodeStub } = require("./.vscode-stub.cjs");

const readSrc = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

// ---------------------------------------------------------------------------
// Bundles. The pure half, the command over the shared structural stub, and a
// third for `ProposalPresenter` alone, which needs a host richer than the
// shared stub offers (a content provider, tab groups, a workspace edit).
// ---------------------------------------------------------------------------

const core = bundleCore(
  "impl-v62-p5-core",
  `export { planInjection, stripCriticism } from "../src/core/criticizePlan";
export { scoreFunction, DEFAULT_ELEVATION } from "../src/core/criticizeScore";
export { sliceFunction } from "../src/core/criticizeSlice";
export { criticizeLangFor } from "../src/core/criticizeLang";
export { FnGenService } from "../src/core/fnGenService";
export * from "../src/core/criticizeGesture";\n`,
);
const host = bundleWithVscodeStub(
  "impl-v62-p5-host",
  `export { registerCriticize, CRITICIZE_COMMAND_ID } from "../src/vscode/criticize";\n`,
);
test.after(() => {
  core.cleanup();
  host.cleanup();
});

const {
  planInjection,
  stripCriticism,
  scoreFunction,
  DEFAULT_ELEVATION,
  sliceFunction,
  criticizeLangFor,
  critiqueOutcomeLines,
  injectionRegion,
  FnGenService,
} = core.mod;
const RUST = criticizeLangFor("rust");
const vscode = host.vscode;

// ---------------------------------------------------------------------------
// The presenter host. Small, and only as forgiving as `present()` is: the two
// pre-consent guards run before any preview, so a document that moved never
// reaches the diff and the toast under test is the one a human would see.
// ---------------------------------------------------------------------------

const PSTUB = path.join(__dirname, ".impl-v62-p5-presenter.stub.cjs");
const PENTRY = path.join(__dirname, ".impl-v62-p5-presenter.entry.ts");
const POUT = path.join(__dirname, ".impl-v62-p5-presenter.bundle.cjs");
fs.writeFileSync(
  PSTUB,
  `
const state = { messages: [], commands: {}, appliedEdits: [] };
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class WorkspaceEdit { constructor() { this._e = []; } replace(u, r, t) { this._e.push([u, r, t]); } }
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class TabInputTextDiff { constructor(o, m) { this.original = o; this.modified = m; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p, with() { return this; } }),
  from: (parts) => ({ ...parts, fsPath: parts.path, toString: () => parts.scheme + "://" + parts.path + "?" + (parts.query || "") }),
  parse: (s) => ({ fsPath: String(s), path: String(s), scheme: "file", toString: () => String(s), with() { return this; } }),
};
module.exports = {
  __state: state,
  Position, Range, WorkspaceEdit, EventEmitter, TabInputTextDiff, Uri,
  EndOfLine: { LF: 1, CRLF: 2 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Method: 1, Function: 2, Field: 4, Variable: 5, Class: 6, Property: 9, Enum: 12, Constant: 20, Struct: 21 },
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    textDocuments: [],
    applyEdit: async (e) => { state.appliedEdits.push(e); return true; },
  },
  languages: { createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }) },
  window: {
    createOutputChannel: (name) => ({ name, appendLine() {}, append() {}, show() {}, dispose() {} }),
    createTextEditorDecorationType: (o) => ({ o, dispose() {} }),
    visibleTextEditors: [],
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); return undefined; },
    showWarningMessage: async (message) => { state.messages.push({ kind: "warn", message }); return undefined; },
    showErrorMessage: async (message) => { state.messages.push({ kind: "error", message }); return undefined; },
    setStatusBarMessage: (message) => { state.messages.push({ kind: "status", message }); return { dispose() {} }; },
    withProgress: async (o, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    tabGroups: { all: [], activeTabGroup: undefined, onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async () => undefined,
  },
};
`,
);
const vs = require(PSTUB);
let P = {};
let presenterBundleErr;
try {
  fs.writeFileSync(PENTRY, `export { ProposalPresenter } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({
    entryPoints: [PENTRY],
    bundle: true,
    outfile: POUT,
    format: "cjs",
    platform: "node",
    alias: { vscode: PSTUB },
    external: [PSTUB],
  });
  P = require(POUT);
} catch (err) {
  presenterBundleErr = err;
}
test.after(() => [PSTUB, PENTRY, POUT].forEach((f) => fs.rmSync(f, { force: true })));

// ---------------------------------------------------------------------------
// F1. The staleness anchor.
// ---------------------------------------------------------------------------

const METHOD = [
  "use std::time::Instant;",
  "impl Parser {",
  "    /// Parses a header.",
  "    pub fn parse_header(&self, raw: &str, flag: bool) -> Header {",
  "        let started = Instant::now();",
  "        Header::from(raw, started, flag)",
  "    }",
  "}",
].join("\n");

function makeDoc(text, languageId = "rust") {
  const state = { text, version: 1, closed: false };
  const doc = {
    uri: vscode.Uri.parse("file:///p5/p.rs"),
    fileName: "/p5/p.rs",
    languageId,
    eol: 1,
    get version() {
      return state.version;
    },
    get isClosed() {
      return state.closed;
    },
    get lineCount() {
      return state.text.split("\n").length;
    },
    getText: () => state.text,
    positionAt: (off) => {
      const lines = state.text.split("\n");
      let o = 0;
      for (let l = 0; l < lines.length; l++) {
        if (off <= o + lines[l].length) return new vscode.Position(l, off - o);
        o += lines[l].length + 1;
      }
      return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
    },
    offsetAt: (p) => {
      const lines = state.text.split("\n");
      let o = 0;
      for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
      return Math.min(o + p.character, state.text.length);
    },
    lineAt: (arg) => {
      const lines = state.text.split("\n");
      const t = lines[typeof arg === "number" ? arg : arg.line] ?? "";
      const m = t.match(/\S/);
      return {
        text: t,
        range: new vscode.Range(0, 0, 0, t.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m,
      };
    },
  };
  return { doc, state };
}

/** One press of the real command, with an optional keystroke landing INSIDE the
 *  symbol-provider await. That window is the whole finding: the offsets the
 *  provider returns describe the text it saw, and the buffer has already moved
 *  by the time the gesture resumes. */
async function press(source, { duringResolve } = {}) {
  const { doc, state } = makeDoc(source);
  const lines = source.split("\n");
  const headLine = lines.findIndex((l) => /\bpub fn /.test(l)) + 1;
  const endLine = lines.findIndex((l) => l === "    }") + 1;
  let headOffset = 0;
  for (let i = 0; i < headLine - 1; i++) headOffset += lines[i].length + 1;
  headOffset += lines[headLine - 1].search(/\S/);
  let spanEnd = 0;
  for (let i = 0; i < endLine - 1; i++) spanEnd += lines[i].length + 1;
  spanEnd += lines[endLine - 1].length;

  globalThis.__C80_ACTIVE__ = {
    document: doc,
    selection: { active: new vscode.Position(headLine - 1, 0) },
  };
  globalThis.__C80_WARNINGS__ = [];
  globalThis.__C80_COMMANDS__ = {};
  const channel = [];
  const output = {
    name: "p5",
    appendLine: (l) => channel.push(l),
    append() {},
    show() {},
    hide() {},
    clear() {},
    dispose() {},
  };
  const presented = [];
  const presenter = {
    present: async (request) => {
      presented.push(request);
      if (request.document.isClosed) return "discarded";
      if (request.document.version !== request.versionAtResolve) {
        request.outcome = "discarded";
        return "discarded";
      }
      const current = request.document.getText();
      request.spliced =
        current.slice(0, request.span.start) + request.text + current.slice(request.span.end);
      request.outcome = "accept";
      request.service.logOutcome("accept");
      return "accept";
    },
  };
  host.mod.registerCriticize({ subscriptions: [] }, output, {
    resolveFunction: async () => {
      const resolved = {
        span: { start: headOffset, end: spanEnd },
        headOffset,
        signature: lines[headLine - 1].trim(),
        symbolName: "parse_header",
        languageId: "rust",
        kind: "function",
        bodyOnly: false,
        headerIndent: (lines[headLine - 1].match(/^[ \t]*/) ?? [""])[0],
      };
      if (duringResolve !== undefined) {
        await new Promise((r) => setTimeout(r, 1));
        duringResolve(state);
      }
      return resolved;
    },
    tierGate: async () => ({ allowed: false, reason: "tier-disabled" }),
    tierMessage: () => "the hardware tier disables function generation",
    // ANSWER THE HONESTY ROUND. `clock` is a model's judgement since 2026-08-29,
    // so a fixture containing `Instant::now()` no longer produces a clock
    // finding on its own and every row below that asserts one would be measuring
    // an absent model. The stub scripts the verdict the way `answer: () => GOOD`
    // scripts a fix sentence; it is not the deleted name table in disguise, and
    // the model's real judgement is measured in session-v64/rig/honesty.cjs.
    transport: () => async (req) => ({ text: honestyStub.withHonesty({ clock: /Instant::now/ })(req.prompt) }),
    presenter: () => presenter,
  });
  await globalThis.__C80_COMMANDS__[host.mod.CRITICIZE_COMMAND_ID]();
  return { channel, presented, state, doc };
}

/** The keystroke: five characters deleted on a line ABOVE the function, which
 *  is what a developer tidying an import does. Every offset below the edit
 *  shifts left by five, so the head offset lands inside `pub fn`. */
const tidyTheImport = (state) => {
  state.text = state.text.replace("std::time", "time");
  state.version = 2;
};

test("F1 row 1: a keystroke during resolution discards instead of splicing", async () => {
  const run = await press(METHOD, { duringResolve: tidyTheImport });
  assert.equal(run.presented.length, 1, "the gesture still reaches the consent gate");
  assert.notEqual(
    run.presented[0].outcome,
    "accept",
    "the offsets describe a text that no longer exists; this must discard",
  );
  assert.equal(run.presented[0].spliced, undefined, "nothing was spliced");
});

test("F1 row 2: versionAtResolve is the version the OFFSETS belong to", async () => {
  const run = await press(METHOD, { duringResolve: tidyTheImport });
  assert.equal(
    run.presented[0].versionAtResolve,
    1,
    "the span came from version 1's text; stamping version 2 makes every later guard bless it",
  );
  // The CONTROL, so the row cannot pass on a build that stamps a constant: with
  // no keystroke the anchor is still the live version and the proposal applies.
  const quiet = await press(METHOD);
  assert.equal(quiet.presented[0].versionAtResolve, 1);
  assert.equal(quiet.presented[0].outcome, "accept");
  // Was `C80 clock:` until 2026-08-29, when the four honesty dimensions became a
  // model judgement and stopped firing in the synchronous pass (ruling 3, the
  // amendment at the end of session-v64/goal.md). The control needs a planted
  // comment, not a particular dimension.
  assert.ok(String(quiet.presented[0].spliced).includes("C80 bool-param:"), "the quiet press plants");
});

test("F1 row 3: the card says it is stale for the resolution window too", async () => {
  const run = await press(METHOD, { duringResolve: tidyTheImport });
  assert.ok(
    run.channel.some((l) => /\[critique\].*\b1\b.*\b2\b/.test(l) && /version/i.test(l)),
    "the evidence line names the two versions:\n" + run.channel.join("\n"),
  );
  assert.ok(
    run.channel.some((l) => /moved|stale|changed/i.test(l) && l.includes("parse_header")),
    "the card itself must say the file moved out from under it:\n" + run.channel.join("\n"),
  );
});

// ---------------------------------------------------------------------------
// F3. The strip deletes only what it counts.
// ---------------------------------------------------------------------------

/** The exact shape the product emits for `clock`, wrapped at the body indent:
 *  a head carrying the tag and the dimension, then a hanging continuation. */
const PLANTED = [
  "        // C80 clock: hidden wall-clock read. Untestable. Pass it in. No call",
  "        //     sites ride on this signature.",
];

test("F3 row 4: a hand-written `// C80 ...` note survives, and is not counted", () => {
  const lines = ["        // C80 is the column limit we keep to", "        let n = 1;"];
  const got = stripCriticism(lines, "rust");
  assert.deepEqual(got.lines, lines, "the product never wrote this line and must not delete it");
  assert.equal(got.stripped, 0, "and the count already said so");
});

test("F3 row 5: a trailing hand-written `// C80` note is not cut off a code line", () => {
  const lines = ["        let n = 1; // C80 is the column limit we keep to"];
  const got = stripCriticism(lines, "rust");
  assert.deepEqual(got.lines, lines);
  assert.equal(got.stripped, 0);
});

test("F3 row 6: what the product plants is still stripped, head and continuation", () => {
  const got = stripCriticism([...PLANTED, "        let n = 1;"], "rust");
  assert.deepEqual(got.lines, ["        let n = 1;"]);
  assert.equal(got.stripped, 1, "one HEAD, not two lines: a human counts criticisms");
});

test("F3 row 7: deleted == counted, over a region holding both shapes", () => {
  const lines = [
    "    pub fn f(&self, flag: bool) -> u32 {",
    "        // C80 is the column limit we keep to",
    ...PLANTED,
    "        // C80 nesting: a staircase of guards and loops. Nobody can hold this.",
    "        let n = 1;",
    "        n",
    "    }",
  ];
  const got = stripCriticism(lines, "rust");
  const deleted = lines.length - got.lines.length;
  // Two heads went, and one of them carried a continuation, so three lines for
  // two criticisms. The invariant is that every deleted line belongs to a
  // COUNTED head, which is what makes "stripping N stale comments" true.
  assert.equal(got.stripped, 2);
  assert.equal(deleted, 3);
  assert.ok(
    got.lines.includes("        // C80 is the column limit we keep to"),
    "the hand-written note is not one of the three: " + JSON.stringify(got.lines),
  );
});

test("F3 row 8: the sourceIndex line map still names every survivor's origin", () => {
  const lines = [
    "    pub fn f(&self) -> u32 {",
    "        // C80 is the column limit we keep to",
    ...PLANTED,
    "        let n = 1;",
    "    }",
  ];
  const got = stripCriticism(lines, "rust");
  assert.equal(got.sourceIndex.length, got.lines.length, "one index per surviving line");
  for (let i = 0; i < got.lines.length; i++) {
    assert.equal(
      got.lines[i],
      lines[got.sourceIndex[i]],
      `the map must point at the line it kept (index ${i})`,
    );
  }
  // Strictly increasing, or the map is not a map: two survivors claiming one
  // origin would put two findings on one document line.
  for (let i = 1; i < got.sourceIndex.length; i++) {
    assert.ok(got.sourceIndex[i] > got.sourceIndex[i - 1], "indices ascend");
  }
});

test("F3 row 9: the planner still replaces rather than stacks on a second press", () => {
  const lines = [
    "impl P {",
    "    /// Doc.",
    "    pub fn f(&self, flag: bool) -> u32 {",
    "        // C80 is the column limit we keep to",
    "        let n = 1;",
    "        n",
    "    }",
    "}",
  ];
  const text = lines.join("\n");
  const unit = sliceFunction(lines, 3, 7, "f", RUST);
  assert.ok(unit !== undefined);
  const card = scoreFunction(unit, RUST, DEFAULT_ELEVATION);
  let head = 0;
  for (let i = 0; i < 2; i++) head += lines[i].length + 1;
  head += lines[2].search(/\S/);
  let end = 0;
  for (let i = 0; i < 6; i++) end += lines[i].length + 1;
  end += lines[6].length;
  const region = injectionRegion(text, head, end, "rust");
  const plan = planInjection(region.lines, region.startLine, card, DEFAULT_ELEVATION);
  assert.ok(plan.planted > 0, "the fixture flags something, or the row proves nothing");
  assert.equal(plan.stripped, 0, "nothing the product wrote is in this region");
  assert.ok(
    plan.text.includes("// C80 is the column limit we keep to"),
    "the developer's own note is still there after the plan:\n" + plan.text,
  );
});

// ---------------------------------------------------------------------------
// F5. The consent gate's buttons.
// ---------------------------------------------------------------------------

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const commandTitle = (id) => pkg.contributes.commands.find((c) => c.command === id)?.title;

test("F5 row 10: no proposal command title names a generated body", () => {
  for (const id of ["column80.proposalAccept", "column80.proposalReject"]) {
    const title = commandTitle(id);
    assert.equal(typeof title, "string", `${id} must still be contributed`);
    assert.ok(title.length > 0, `${id} needs a title`);
    assert.ok(
      !/generat/i.test(title),
      `three gestures share this button and one of them generates nothing: "${title}"`,
    );
  }
});

test("F5 row 11: every surface that references the ids still finds them", () => {
  const contributed = new Set(pkg.contributes.commands.map((c) => c.command));
  const referenced = [
    ...pkg.contributes.keybindings.map((k) => k.command),
    ...Object.values(pkg.contributes.menus).flat().map((m) => m.command),
  ].filter((id) => id === "column80.proposalAccept" || id === "column80.proposalReject");
  assert.ok(referenced.length >= 6, "the two ids ride a keybinding, a title menu and the palette");
  for (const id of referenced) {
    assert.ok(contributed.has(id), `${id} is referenced but not contributed`);
  }
});

// ---------------------------------------------------------------------------
// F6. The discard sentence's noun, and the reason on the channel.
// ---------------------------------------------------------------------------

const ptest = (name, fn) =>
  test(name, (ctx) => (presenterBundleErr ? ctx.skip(String(presenterBundleErr)) : fn(ctx)));

const DISCARD_TEXT = "pub fn f() -> u32 {\n    0\n}\n";

/** A document that MOVED before the preview: the pre-consent guard, which is
 *  the one discard a headless host can reach without a diff tab. */
async function driveMovedDocument(extra) {
  vs.__state.messages.length = 0;
  const doc = {
    languageId: "rust",
    eol: 1,
    version: 2,
    isClosed: false,
    uri: vs.Uri.file("/mem/target.rs"),
    getText: () => DISCARD_TEXT,
    positionAt: (o) => ({ line: 0, character: o, offset: o }),
    offsetAt: (p) => p.offset ?? p.character,
  };
  const outcomes = [];
  const outcome = await new P.ProposalPresenter({ subscriptions: [] }).present({
    document: doc,
    span: { start: 0, end: DISCARD_TEXT.length - 1 },
    versionAtResolve: 1,
    title: "f: preview",
    text: "pub fn f() -> u32 {\n    1\n}",
    service: { logOutcome: (o, detail) => outcomes.push([o, detail]) },
    ...extra,
  });
  const warns = vs.__state.messages.filter((m) => m.kind === "warn").map((m) => m.message);
  vs.__state.messages.length = 0;
  return { outcome, warns, outcomes };
}

ptest("F6 row 12: fn-gen's discard toast is byte-identical, because it is the default", async () => {
  const got = await driveMovedDocument({});
  assert.equal(got.outcome, "discarded");
  assert.deepEqual(got.warns, [
    "Column 80: generation discarded — the document changed during generation.",
  ]);
});

ptest("F6 row 13: a caller that generates nothing names its own noun", async () => {
  const got = await driveMovedDocument({ discardNoun: "proposal" });
  assert.deepEqual(got.warns, [
    "Column 80: proposal discarded — the document changed during generation.",
  ]);
  assert.ok(
    !got.warns.some((w) => /generation discarded/i.test(w)),
    "the one gesture that generates nothing must not be told its generation was discarded",
  );
  // WHAT THIS ROW DOES NOT CLAIM. The five REASONS are still shared prose and
  // one of them says "during generation". Those strings are fn-gen's pinned
  // toast bytes (`impl-v56-p3` and `impl-v59-p1` match them whole), so the noun
  // is the half that moved and the reason is recorded residue, not an oversight.
});

ptest("F6 row 14: the sink is handed the reason, not a bare outcome", async () => {
  const got = await driveMovedDocument({ discardNoun: "proposal" });
  assert.equal(got.outcomes.length, 1);
  const [outcome, detail] = got.outcomes[0];
  assert.equal(outcome, "discarded");
  assert.ok(
    detail !== undefined && /the document changed during generation/.test(JSON.stringify(detail)),
    "the reason must reach the sink, or it exists nowhere but the toast: " + JSON.stringify(detail),
  );
  // And criticize's own sink renders it, so the channel carries the reason
  // beside the token readers match whole.
  const lines = critiqueOutcomeLines(outcome, detail);
  assert.ok(
    lines.some((l) => l.includes("the document changed during generation")),
    "the [critique] channel says why: " + JSON.stringify(lines),
  );
  assert.ok(
    lines.includes("[critique] outcome=discarded"),
    "and the outcome token still stands alone on its line: " + JSON.stringify(lines),
  );
});

test("F6 row 15: fn-gen's own outcome bytes are unmoved by the widened detail", () => {
  const lines = [];
  const svc = new FnGenService({ apiBase: "http://127.0.0.1:1", model: "m" }, undefined, (l) =>
    lines.push(l),
  );
  svc.logOutcome("accept");
  svc.logOutcome("reject", { refusedBy: "human-gesture", offered: "fn f() {}" });
  svc.logOutcome("discarded");
  // The product-prose reason: fn-gen's surface pinned this as a BARE outcome
  // line, and the widened detail must not add a row to it.
  svc.logOutcome("discarded", { discardedWhy: "the document changed during generation" });
  // The one reason fn-gen did not author still gets its own line.
  svc.logOutcome("discarded", { discardedBecause: "the preview could not be opened" });
  assert.deepEqual(lines, [
    "[fngen] outcome=accept",
    "[fngen] outcome=reject refused-by=human-gesture offered=fn f() {}",
    "[fngen] outcome=discarded",
    "[fngen] outcome=discarded",
    "[fngen] discarded: the preview could not be opened",
    "[fngen] outcome=discarded",
  ]);
  svc.dispose();
});

// ---------------------------------------------------------------------------
// F7. The wiring site.
// ---------------------------------------------------------------------------

test("F7 row 16: the wiring site does not call the gesture read-only", () => {
  const source = readSrc("vscode", "extension.ts");
  const at = source.indexOf("registerCriticize(context");
  assert.ok(at > 0, "the call site must exist for this row to mean anything");
  const preamble = source.slice(Math.max(0, at - 800), at);
  assert.ok(!/READ ONLY/i.test(preamble), "the gesture writes, through the one presenter");
  assert.ok(
    /propos/i.test(preamble),
    "and the comment above the call should say what it does instead",
  );
});
