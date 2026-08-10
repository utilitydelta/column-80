// White-box wiring proof for session-v29 phase 4: the refine gesture, driven
// through the REAL session entry point (runPostAcceptOracle -> executeSession)
// over a real cargo check of a CLEAN repairbench crate.
//
// The pure decisions are pinned in impl-v29-p4-refine.test.cjs. What lives only
// here is the wiring, and specifically the ORDERING the goal's hard bar
// collides with:
//
//   propose -> human accepts -> save -> re-check -> say so if it broke
//
// goal.md asks for "refused, not proposed", which would need the candidate
// checked BEFORE the consent gate. Both ways to do that break a named product
// invariant (write the candidate to disk = the consented-write invariant; read
// the language server back = the one-way-diagnostics invariant), so the check
// stays where every other check on that page is, and what the build refuses is
// the SILENCE. See the AMENDMENT at the end of session-v29/goal.md.
//
// The extractor and span-surface resolver are stubs: what the real reference
// provider returns against a real server is the live suite's question, and this
// file's is what the session does with an answer.
//
// Run: SKIP_LIVE=1 node --test test/impl-v29-p4-refine-flow.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".impl-v29-p4-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = (globalThis.__v29p4 = globalThis.__v29p4 || { messages: [] });
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  workspace: {
    getConfiguration: () => ({ get: (k, fb) => fb, inspect: () => undefined, update: async () => {} }),
    get textDocuments() { return []; },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    showWarningMessage: async (message) => { state.messages.push({ kind: "warn", message }); },
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); },
    setStatusBarMessage: (message) => { state.messages.push({ kind: "status", message }); return { dispose() {} }; },
  },
  commands: { executeCommand: async () => undefined },
};
`,
);

const entry = path.join(__dirname, ".impl-v29-p4.entry.ts");
const outfile = path.join(__dirname, ".impl-v29-p4.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";
export { FnGenService } from "../src/core/fnGenService";\n`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { runPostAcceptOracle, FnGenService } = require(outfile);
// The stub is BUNDLED into the outfile by the alias, so requiring it here
// would hand back a second module instance with its own state. The bundled
// copy publishes onto globalThis; that is the one the session writes to.
const stubState = globalThis.__v29p4;
test.after(() => [entry, outfile, STUB].forEach((f) => fs.rmSync(f, { force: true })));

const REPAIRBENCH = path.join(__dirname, "fixtures", "repairbench");
const scratchCopy = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `implv29p4-${tag}-`));
  fs.cpSync(REPAIRBENCH, dir, { recursive: true });
  return dir;
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

const fileDocument = (file) => ({
  languageId: "rust",
  // Dirty on purpose: the save calls are what put the re-check's position in
  // the trace, and the hard bar here is an ORDERING claim.
  isDirty: true,
  isClosed: false,
  version: 1,
  uri: { fsPath: file, path: file, scheme: "file", toString: () => "file://" + file },
  getText(range) {
    const t = fs.readFileSync(file, "utf8");
    return range ? t.slice(range.start.offset, range.end.offset) : t;
  },
  positionAt(offset) {
    const t = fs.readFileSync(file, "utf8");
    const before = t.slice(0, offset);
    const nl = before.lastIndexOf("\n");
    return { offset, line: before.split("\n").length - 1, character: offset - nl - 1 };
  },
  lineAt(line) {
    const t = fs.readFileSync(file, "utf8").split("\n")[line] ?? "";
    return { text: t, range: { start: { line, character: 0 }, end: { line, character: t.length } } };
  },
  save: async () => true,
});

const fnResolver = (fnName) => async (document) => {
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
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "",
  };
};

// A trace of what happened, in order. The hard bar is an ORDERING claim, and an
// ordering claim needs a sequence, not a set of flags.
const recordingPresenter = (file, trace, accept = true) => ({
  present: async (req) => {
    trace.push("present");
    if (!accept) {
      return "reject";
    }
    const t = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, t.slice(0, req.span.start) + req.text + t.slice(req.span.end));
    trace.push("write");
    return "accept";
  },
});

const scriptedService = (replyBody) => {
  const prompts = [];
  const service = new FnGenService(
    { apiBase: "http://fake:1", model: "scripted-30b", fallbackModel: "x", maxTokens: 512, temperature: 0.2 },
    async ({ prompt }) => {
      prompts.push(prompt);
      return { text: "```rust\n" + replyBody + "\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" };
    },
  );
  return { service, prompts };
};

// The refine's own reply shapes. `parse_duration` in the clean fixture is a
// match over a suffix; the "restyled" reply is the same behaviour written the
// other way, and the "broken" one calls a method that does not exist.
const RESTYLED = `pub fn parse_duration(s: &str) -> Option<u64> {
    if s.is_empty() {
        return None;
    }
    let (number_str, suffix) = s.split_at(s.len() - 1);
    let number = number_str.parse::<u64>().ok()?;
    let scale = match suffix {
        "s" => 1,
        "m" => 60,
        "h" => 3600,
        _ => return None,
    };
    Some(number * scale)
}`;

const BROKEN = `pub fn parse_duration(s: &str) -> Option<u64> {
    let number = s.parse_the_number();
    Some(number)
}`;

// An extractor with the reference leg, answering with call sites in ANOTHER
// file of the same crate (lib.rs), which is what a real provider does for a
// helper this crate uses.
const refExtractor = (hitsFor) => ({
  completeMembers: async () => [],
  example: async () => undefined,
  membersOfType: async () => [],
  references: async (cursor) => hitsFor(cursor),
});

const drive = async ({
  manualRefine = true,
  reply = RESTYLED,
  accept = true,
  extractor,
  spanSurface = false,
} = {}) => {
  const crate = scratchCopy("drive");
  try {
    const file = path.join(crate, "src", "task1.rs");
    const lib = path.join(crate, "src", "lib.rs");
    const t = fs.readFileSync(file, "utf8");
    const start = t.indexOf("pub fn parse_duration");
    const end = t.indexOf("\n}", start) + 2;
    const { service, prompts } = scriptedService(reply);
    const out = output();
    const trace = [];
    const presenter = recordingPresenter(file, trace, accept);
    stubState.messages.length = 0;
    const ctx = {
      document: fileDocument(file),
      landedSpan: { start, end },
      source: "fngen",
      service,
      output: out,
      presenter,
      resolveFunction: fnResolver("parse_duration"),
      repairTierGate: { allowed: true },
      manualRefine,
      extractor:
        extractor === undefined
          ? refExtractor(() => [
              { uri: "file://" + lib, line: 2, character: 4, endLine: 2, endCharacter: 8 },
            ])
          : extractor,
    };
    if (spanSurface) {
      ctx.resolveSpanSurface = async (_ex, _doc, _resolved, _log, opts) => {
        opts.onDisclosed?.([{ name: "Foo", members: ["bar"], complete: false }]);
        return "API surface for `Foo`:\n```\nbar()\n```";
      };
    }
    const wrapped = { ...ctx, document: { ...ctx.document, save: async () => { trace.push("save"); return true; } } };
    await runPostAcceptOracle(wrapped);
    return { prompts, out, trace, messages: [...stubState.messages], crate, file };
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
};

const CARGO_TIMEOUT = 240000;
const line = (out, needle) => out.lines.find((l) => l.includes(needle));

// ------------------------------------------------------------ the gesture

test(
  "a clean build on the MANUAL gesture spends a refine round, and says whose budget it is",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { prompts, out } = await drive();
    assert.equal(prompts.length, 1, `one refine round; lines: ${JSON.stringify(out.lines)}`);
    assert.ok(line(out, "[repair] surface why=clean"), "the repair session still ends at clean");
    const budgetLine = line(out, "separate from the 2-round repair cap");
    assert.ok(budgetLine, `the budget owes its own name; lines: ${JSON.stringify(out.lines)}`);
    assert.ok(budgetLine.includes("budget=1 round"));
    assert.ok(line(out, "[repair] refine round 1/1"), "the round names its own cap, not 1/2");
  },
);

// The identity claim. A silent version of this gesture is a prompt-identity
// change, which is why it is a flag the manual command alone sets.
test(
  "the automatic post-accept path on a clean build still ends silently at why=clean",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { prompts, out, messages } = await drive({ manualRefine: false });
    assert.equal(prompts.length, 0, `no model call; lines: ${JSON.stringify(out.lines)}`);
    assert.ok(line(out, "[repair] surface why=clean"));
    assert.equal(out.lines.some((l) => l.includes("refine")), false, "not one refine line");
    assert.deepEqual(messages, []);
  },
);

test(
  "the injected windows reach the prompt and the channel, attributably",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { prompts, out } = await drive();
    assert.match(prompts[0], /How this repository already calls `split_at`|How this repository already calls `parse`/);
    assert.ok(line(out, "[repair] refine window "), `each window owes a file and line; lines: ${JSON.stringify(out.lines)}`);
    assert.ok(line(out, "src/lib.rs#L"), "the window line names the file the human can go and read");
    assert.ok(line(out, "[repair] refine targets:"));
  },
);

test(
  "the span's types-in-play ride along, the same leg a repair round leads with",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { prompts, out } = await drive({ spanSurface: true });
    assert.ok(prompts[0].includes("API surface for `Foo`:"), `got:\n${prompts[0]}`);
    assert.ok(line(out, "[repair] refine span surface:"));
  },
);

// ------------------------------------------------------- the honest silences

test(
  "a function whose symbols the repo never calls elsewhere gets a channel line and NO round",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { prompts, out, messages } = await drive({ extractor: refExtractor(() => []) });
    assert.equal(prompts.length, 0, `no round may be spent on nothing; lines: ${JSON.stringify(out.lines)}`);
    assert.ok(line(out, "no usage anywhere for"), `lines: ${JSON.stringify(out.lines)}`);
    assert.ok(messages.some((m) => m.kind === "info"), "a manual gesture that did nothing says so");
  },
);

test(
  "the function's OWN call sites are not evidence of its own style",
  { timeout: CARGO_TIMEOUT },
  async () => {
    // Every hit lands inside the span being rewritten, which is what a real
    // provider returns for a symbol only this function uses.
    const { prompts, out } = await drive({
      extractor: refExtractor((cursor) => [
        { uri: cursor.uri, line: cursor.line, character: cursor.character, endLine: cursor.line, endCharacter: cursor.character + 3 },
      ]),
    });
    assert.equal(prompts.length, 0, `lines: ${JSON.stringify(out.lines)}`);
    // The two silences are said differently since the phase-4 review: this one
    // FOUND references and cut no window from them, and borrowing the "no usage
    // anywhere" words contradicted the `hits=` lines printed just above it.
    assert.ok(line(out, "no window could be cut from them"), JSON.stringify(out.lines));
    assert.ok(!line(out, "no usage anywhere for"), "a hit that was found is not an absent one");
  },
);

test(
  "a transport with no reference leg is skipped with the reason, never faked",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { prompts, out } = await drive({
      extractor: { completeMembers: async () => [], example: async () => undefined, membersOfType: async () => [] },
    });
    assert.equal(prompts.length, 0);
    assert.ok(line(out, "has no reference leg"), `lines: ${JSON.stringify(out.lines)}`);
  },
);

test(
  "a reply identical to the input is not shown as a diff of nothing",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const clean = fs.readFileSync(path.join(REPAIRBENCH, "src", "task1.rs"), "utf8");
    const start = clean.indexOf("pub fn parse_duration");
    const body = clean.slice(start, clean.indexOf("\n}", start) + 2);
    const { out, trace } = await drive({ reply: body });
    assert.ok(line(out, "returned the function unchanged"), `lines: ${JSON.stringify(out.lines)}`);
    assert.ok(line(out, "result=unchanged"));
    assert.equal(trace.includes("present"), false, "nothing to accept means nothing to show");
  },
);


test(
  "a disclosed surface is closed by ONE firm instruction naming it, the same rule repair follows",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { prompts } = await drive({ spanSurface: true });
    const p = prompts[0];
    assert.ok(p.includes("API surface for `Foo`:"), `got:\n${p}`);
    // An API surface with no instruction over it is decoration; an instruction
    // scoped to one type while another block sits above it cannot be obeyed and
    // satisfied at once, which is why there is exactly one.
    assert.equal(p.split("Call ONLY methods and constructors").length - 1, 1, `got:\n${p}`);
    assert.ok(p.includes("`Foo`"));
  },
);

test(
  "a surface that disclosed nothing gets no instruction pointing at it",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { prompts } = await drive();
    assert.equal(prompts[0].includes("Call ONLY methods and constructors"), false);
  },
);

// ---------------------------------------------------------- the hard bar

test(
  "the ordering is propose, accept, save, re-check: the consent gate is never behind a check",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { trace, out } = await drive();
    const present = trace.indexOf("present");
    assert.ok(present >= 0, `lines: ${JSON.stringify(out.lines)}`);
    // The save that precedes the re-check comes AFTER the proposal was shown.
    // Anything else would mean a candidate reached disk without consent.
    assert.ok(trace.lastIndexOf("save") > present, `trace: ${JSON.stringify(trace)}`);
    assert.ok(trace.indexOf("write") > present);
    assert.ok(line(out, "[repair] refine outcome round=1 result=clean"));
  },
);

test(
  "a refine that introduced an error is loud on the channel AND in a warning naming the count, the first error, and undo",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { out, messages, prompts } = await drive({ reply: BROKEN });
    assert.equal(prompts.length, 1, "exactly one round, and no repair round chasing it");
    const loud = line(out, "[repair] refine INTRODUCED");
    assert.ok(loud, `lines: ${JSON.stringify(out.lines)}`);
    assert.ok(line(out, "result=introduced-errors="));
    const warn = messages.find((m) => m.kind === "warn");
    assert.ok(warn, `a warning is owed; messages: ${JSON.stringify(messages)}`);
    assert.match(warn.message, /introduced 1 error that (were|was) not there before|introduced \d+ errors? that were not there before/);
    assert.match(warn.message, /parse_the_number/);
    assert.match(warn.message, /[Uu]ndo/);
  },
);

test(
  "a refine that broke the build does not spend the compiler's repair rounds cleaning up",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { out, prompts } = await drive({ reply: BROKEN });
    assert.equal(prompts.length, 1);
    assert.equal(
      out.lines.some((l) => /^\[repair\] decision round=/.test(l)),
      false,
      `no repair decision may follow a refine; lines: ${JSON.stringify(out.lines)}`,
    );
  },
);

test(
  "a rejected refine writes nothing and says so",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { out, trace } = await drive({ accept: false });
    assert.ok(line(out, "result=rejected"), `lines: ${JSON.stringify(out.lines)}`);
    assert.equal(trace.includes("write"), false);
  },
);
