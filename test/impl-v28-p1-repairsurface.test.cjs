// White-box wiring proof for session-v28 phase 1: a repair round's surface is
// the SPAN's types-in-play plus the diagnostic-keyed blocks, closed by ONE firm
// instruction, and the model's reply is gated on what was disclosed.
//
// Drives the REAL repair session (runPostAcceptOracle -> executeSession) over a
// real cargo check of a broken repairbench function, with a scripted
// FnGenService that captures the prompt it is handed. Borrowed harness shape:
// blind-repair-livecontext.test.cjs, which drives the same entry point.
//
// The extractor and the span-surface resolver are stubs here on purpose. What
// this file proves is the ASSEMBLY and the GATE, which are the parts that live
// in oracleSurface.ts; that the real resolver finds real types is the live
// test's job (impl-v28-p1-repair-live.test.cjs) and the blind contract set's.
//
// Run: SKIP_LIVE=1 node --test test/impl-v28-p1-repairsurface.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".impl-v28-p1-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { messages: [] };
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
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    showWarningMessage: async (message) => { state.messages.push({ kind: "warn", message }); },
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); },
    setStatusBarMessage: () => ({ dispose() {} }),
  },
  commands: { executeCommand: async () => undefined },
};
`,
);

const entry = path.join(__dirname, ".impl-v28-p1.entry.ts");
const outfile = path.join(__dirname, ".impl-v28-p1.bundle.cjs");
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
test.after(() => [entry, outfile, STUB].forEach((f) => fs.rmSync(f, { force: true })));

const REPAIRBENCH = path.join(__dirname, "fixtures", "repairbench");
const scratchCopy = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `implv28-${tag}-`));
  fs.cpSync(REPAIRBENCH, dir, { recursive: true });
  return dir;
};

// The same one-token breakage the context oracle uses: task1 stops compiling
// inside `parse_duration` and nowhere else, so the round is in span.
const breakParseDuration = (crate) => {
  const file = path.join(crate, "src", "task1.rs");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
  return file;
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

const fileDocument = (file) => ({
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
  };
};

// Records what the presenter was asked to show. A refused round must never
// reach it: the whole point of the gate is that the human is not shown a
// proposal built out of names the surface said do not exist.
const recordingPresenter = (file, accept = true) => {
  const shown = [];
  return {
    shown,
    present: async (req) => {
      shown.push(req.text);
      if (!accept) {
        return "reject";
      }
      const t = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, t.slice(0, req.span.start) + req.text + t.slice(req.span.end));
      return "accept";
    },
  };
};

const scriptedService = (reply) => {
  const prompts = [];
  const service = new FnGenService(
    { apiBase: "http://fake:1", model: "scripted-30b", fallbackModel: "x", maxTokens: 512, temperature: 0.2 },
    async ({ prompt }) => {
      prompts.push(prompt);
      return { text: "```rust\n" + reply + "\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" };
    },
  );
  return { service, prompts };
};

// A span surface exactly as `resolvePrefill` hands one back with
// omitInstruction: blocks only, plus the disclosed types reported separately.
const SPAN_SURFACE_BLOCK =
  "API surface for `Tile` (real signatures, use these exact names, do not invent):\n" +
  "```\nband(&self) -> LodBand\nlod(&self) -> u32\n```";
// `complete` claims the list is every name the type can answer to. A class is
// never that (nested types, extension members, generic statics), so Tile says
// false; an enum's variants are the whole set, so LodBand says true.
const DISCLOSED = [
  { name: "Tile", members: ["band", "lod"], complete: false },
  { name: "LodBand", members: ["Continental", "Municipal", "Parcel", "Regional"], complete: true },
];

// The fixed body, so an ungated round completes cleanly and the file compiles.
const fixedBody = (file, start, end) =>
  fs.readFileSync(file, "utf8").slice(start, end).replace('"s" => Some("thirty"),', '"s" => Some(number),');

// The invention the capture left in the human's file: a disclosed TYPE name
// written as if it were a member of a value. Spliced into an otherwise correct
// body so the round is refused for the invention and nothing else.
const inventionBody = (file, start, end) =>
  fixedBody(file, start, end).replace(
    "    match suffix {",
    "    let _band = suffix.LodBand;\n    match suffix {",
  );

const drive = async ({ reply, spanSurface, accept = true }) => {
  const crate = scratchCopy("drive");
  try {
    const file = breakParseDuration(crate);
    const t = fs.readFileSync(file, "utf8");
    const start = t.indexOf("pub fn parse_duration");
    const end = t.indexOf("\n}", start) + 2;
    const { service, prompts } = scriptedService(reply(file, start, end));
    const out = output();
    const presenter = recordingPresenter(file, accept);
    const ctx = {
      document: fileDocument(file),
      landedSpan: { start, end },
      source: "fim",
      service,
      output: out,
      presenter,
      resolveFunction: fnResolver("parse_duration"),
      repairTierGate: { allowed: true },
      extractor: { completeMembers: async () => [], example: async () => undefined, membersOfType: async () => [] },
    };
    if (spanSurface) {
      ctx.resolveSpanSurface = async (_extractor, _doc, _resolved, _log, opts) => {
        opts.onDisclosed?.(DISCLOSED);
        return SPAN_SURFACE_BLOCK;
      };
    }
    await runPostAcceptOracle(ctx);
    return { prompts, out, presenter };
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
};

const CARGO_TIMEOUT = 180000;

test(
  "the span's types-in-play are logged and their surface leads the repair prompt",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { prompts, out } = await drive({ reply: fixedBody, spanSurface: true });
    assert.ok(prompts.length > 0, `a repair round must have fired; lines: ${JSON.stringify(out.lines)}`);
    const typesLine = out.lines.find((l) => l.startsWith("[repair] span types-in-play:"));
    assert.ok(typesLine, `the round owes a types-in-play line; lines: ${JSON.stringify(out.lines)}`);
    assert.ok(
      prompts[0].includes(SPAN_SURFACE_BLOCK),
      `the span surface must reach the prompt, got:\n${prompts[0]}`,
    );
  },
);

test(
  "one firm instruction closes the whole surface, naming every disclosed type",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { prompts } = await drive({ reply: fixedBody, spanSurface: true });
    const prompt = prompts[0];
    const opens = prompt.split("Call ONLY methods and constructors").length - 1;
    assert.equal(
      opens,
      1,
      `two instructions in one prompt contradict each other about what the model may call; got:\n${prompt}`,
    );
    assert.ok(prompt.includes("`Tile`"), `the instruction must name Tile; got:\n${prompt}`);
    assert.ok(
      prompt.includes("`LodBand`"),
      `an instruction that names one disclosed type while another type's block sits above it is the capture-A failure; got:\n${prompt}`,
    );
  },
);

test(
  "a reply naming a disclosed type as a member of a value is refused, and never reaches the human",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { out, presenter } = await drive({ reply: inventionBody, spanSurface: true });
    const refused = out.lines.find((l) => /^\[repair\] round \d refused: /.test(l));
    assert.ok(refused, `the invention must be refused with a reason; lines: ${JSON.stringify(out.lines)}`);
    assert.ok(refused.includes("LodBand"), `the reason must name what was refused; got ${refused}`);
    assert.ok(
      out.lines.some((l) => /^\[repair\] outcome round=\d result=refused$/.test(l)),
      `a refusal is a round outcome and owes its outcome line; lines: ${JSON.stringify(out.lines)}`,
    );
    assert.equal(
      presenter.shown.length,
      0,
      "a refused repair must never reach the consent gate: the human is not asked to review names the surface says do not exist",
    );
  },
);

test(
  "a correct reply is not refused, and the round completes through the consent gate",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { out, presenter } = await drive({ reply: fixedBody, spanSurface: true });
    assert.ok(
      !out.lines.some((l) => /^\[repair\] round \d refused: /.test(l)),
      `a repair that contradicts nothing must pass the gate; lines: ${JSON.stringify(out.lines)}`,
    );
    assert.equal(presenter.shown.length, 1, "the corrected body is proposed exactly once");
  },
);

test(
  "with no span-surface resolver injected the round is the pre-v28 shape: no span line, no surface",
  { timeout: CARGO_TIMEOUT },
  async () => {
    const { prompts, out } = await drive({ reply: fixedBody, spanSurface: false });
    assert.ok(prompts.length > 0, `a repair round must still fire; lines: ${JSON.stringify(out.lines)}`);
    assert.ok(
      !prompts[0].includes("Call ONLY methods and constructors"),
      `an unresolved surface may never produce an instruction pointing at one; got:\n${prompts[0]}`,
    );
    assert.ok(
      !prompts[0].includes(SPAN_SURFACE_BLOCK),
      "the span surface cannot appear when no resolver was injected",
    );
  },
);
