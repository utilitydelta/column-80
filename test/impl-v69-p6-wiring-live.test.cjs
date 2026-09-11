// Phase 6's WIRING, at the layer the human actually meets it.
//
// `generatedTestErrors` has 26 blind rows and they prove the function. They
// prove nothing about whether anything CALLS it — this repo has already shipped
// a correct helper that was registered nowhere, and a facade that never saw the
// fix behind it. So this drives the real `runPostAcceptOracle` against a real
// cargo crate whose generated-test region does not compile, through a stub
// vscode that records every message, and reads what the human would have been
// told.
//
// The recipe is Harness C from blind-v24-p3-batch.test.cjs: the real surface
// bundled against a stub vscode, real cargo, a scripted model that must never be
// called (every error is out of span, so no round is eligible).
//
// Run: node --test test/impl-v69-p6-wiring-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const esbuild = require("esbuild");

const SKIP = process.env.SKIP_LIVE
  ? "SKIP_LIVE set"
  : spawnSync("cargo", ["--version"], { encoding: "utf8" }).status === 0
    ? false
    : "cargo absent";

const STUB = path.join(__dirname, ".impl-v69-p6-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const path = require("path");
const state = { config: {}, visibleTextEditors: [], collections: [], messages: [], status: [] };
class Position { constructor(line, character) { this.line = line; this.character = character; } translate(dl, dc) { return new Position(this.line + (dl || 0), this.character + (dc || 0)); } }
class Range { constructor(a, b, c, d) { if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); } else { this.start = a; this.end = b; } } }
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
  languages: { createDiagnosticCollection: (name) => { const c = { name, set() {}, delete() {}, clear() {}, dispose() {} }; state.collections.push(c); return c; } },
  commands: { executeCommand: async () => undefined, registerCommand: () => ({ dispose() {} }) },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.visibleTextEditors; },
    showWarningMessage: say("warn"),
    showInformationMessage: say("info"),
    showErrorMessage: say("error"),
    setStatusBarMessage: (m) => { state.status.push(m); return { dispose() {} }; },
    withProgress: async (opts, task) => task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }),
    showTextDocument: async () => ({ document: { getText: () => "" }, setDecorations() {}, revealRange() {} }),
  },
};
`,
);

const ENTRY = path.join(__dirname, ".impl-v69-p6-wiring.entry.ts");
const OUT = path.join(__dirname, ".impl-v69-p6-wiring.bundle.cjs");
let M = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";
export { FnGenService } from "../src/core/fnGenService";
export { __state } from "vscode";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
  M = require(OUT);
} catch (e) {
  bundleErr = e;
}
test.after(() => [STUB, ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

test("harness guard: the repair surface bundles against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`);
});

const scratch = [];
test.after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});

// A crate whose `first_even` is fine and whose GENERATED TEST REGION is not. The
// markers are the product's own format, written by hand so the fixture does not
// depend on the authoring gesture having run.
const LIB = `pub fn first_even(xs: &[i32]) -> Option<i32> {
    xs.iter().copied().find(|x| x % 2 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    // column80-tests:first_even:begin
    #[test]
    fn first_even_test() {
        assert_eq!(first_even(&[1, 2, 3]), 2);
    }
    // column80-tests:first_even:end
}
`;

// The SAME broken assertion, moved OUT of the marked region. Same errors, same
// file, and none of them ours.
const LIB_UNMARKED = LIB.replace("    // column80-tests:first_even:begin\n", "").replace(
  "    // column80-tests:first_even:end\n",
  "",
);

function crate(tag, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `c80-v69-p6w-${tag}-${crypto.randomBytes(3).toString("hex")}-`));
  scratch.push(dir);
  fs.writeFileSync(path.join(dir, "Cargo.toml"), `[package]\nname = "p6w"\nversion = "0.1.0"\nedition = "2021"\n[workspace]\n`);
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "lib.rs"), body);
  return path.join(dir, "src", "lib.rs");
}

const documentOf = (file) => ({
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

const resolverFor = (name) => async (document) => {
  const t = document.getText();
  const start = t.indexOf(`pub fn ${name}`);
  if (start < 0) return undefined;
  const end = t.indexOf("\n}", start) + 2;
  return { span: { start, end }, signature: t.slice(start, t.indexOf("{", start)).trimEnd(), symbolName: name, languageId: "rust" };
};

async function press(file, { manualRefine = true } = {}) {
  const lines = [];
  const prompts = [];
  const service = new M.FnGenService(
    { apiBase: "http://fake:1", model: "scripted", fallbackModel: "x", maxTokens: 512, temperature: 0.2 },
    async ({ prompt }) => {
      prompts.push(prompt);
      throw new Error("the model must not be called: every error is out of span");
    },
  );
  M.__state.config = { repairEnabled: true };
  M.__state.messages.length = 0;
  M.__state.status.length = 0;
  const document = documentOf(file);
  const resolved = await resolverFor("first_even")(document);
  try {
    await M.runPostAcceptOracle({
      document,
      landedSpan: resolved.span,
      source: "fngen",
      service,
      output: { appendLine: (l) => lines.push(l) },
      presenter: { present: async () => "reject" },
      resolveFunction: resolverFor("first_even"),
      repairTierGate: { allowed: true },
      manualRefine,
    });
  } finally {
    service.dispose();
  }
  return { lines, prompts, messages: M.__state.messages.slice(), status: M.__state.status.slice() };
}

const ltest = (name, fn) =>
  test(name, { skip: SKIP, timeout: 300000 }, (ctx) => (bundleErr ? ctx.skip("bundle failed") : fn(ctx)));

ltest("harness guard: the fixture really is red, and no model round is eligible", async () => {
  const r = await press(crate("guard", LIB));
  assert.strictEqual(r.prompts.length, 0, `no eligible in-span error, so no model call; lines=${r.lines.join("\n")}`);
  assert.ok(
    r.lines.some((l) => /^\[oracle\] check done .*errors=[1-9]/.test(l)),
    `the widened check must SEE the broken test. LINES:\n${r.lines.join("\n")}`,
  );
});

ltest("[P6 wiring] the human is TOLD the tests Column 80 wrote do not compile", async () => {
  const r = await press(crate("ours", LIB));
  const said = r.messages.map((m) => m.message).join("\n");
  assert.ok(r.messages.length > 0, `no user-visible message at all. CHANNEL:\n${r.lines.join("\n")}`);
  assert.match(said, /generated for first_even|generated tests for first_even|tests it generated for first_even/i);
  assert.ok(/E0308|mismatched types/i.test(said), `the message carries the first diagnostic. MESSAGES:\n${said}`);
  assert.ok(
    /not the tests|Generate Tests again/i.test(said),
    `and says what this gesture will NOT do about it. MESSAGES:\n${said}`,
  );
});

ltest("[P6 wiring] the channel carries the count, the file and the diagnostic whole", async () => {
  const r = await press(crate("channel", LIB));
  const line = r.lines.find((l) => l.includes("the generated tests for first_even do not compile"));
  assert.ok(line, `the durable record is missing. CHANNEL:\n${r.lines.join("\n")}`);
  assert.match(line, /lib\.rs/);
  assert.ok(
    r.lines.some((l) => /mismatched types|E0308/.test(l)),
    `the diagnostic itself reaches the channel, not only the toast. CHANNEL:\n${r.lines.join("\n")}`,
  );
});

ltest("[P6 wiring] the general out-of-span note is NOT also shown for the same press", async () => {
  const r = await press(crate("once", LIB));
  assert.deepStrictEqual(
    r.status.filter((s) => /remains? outside the touched span/.test(s)),
    [],
    "one sentence about one situation; the vaguer note would be about the same errors",
  );
});

ltest("[P6 wiring] the SAME errors outside the marked region get the general note, not ours", async () => {
  // The falsification. Without this row the test above passes for a product that
  // says "your generated tests are broken" about every out-of-span error.
  const r = await press(crate("theirs", LIB_UNMARKED));
  const said = r.messages.map((m) => m.message).join("\n");
  assert.ok(!/generated/i.test(said), `these are not ours and must not be claimed. MESSAGES:\n${said}`);
  assert.ok(
    r.status.some((s) => /remains? outside the touched span/.test(s)),
    `the general note is what this case gets. STATUS:\n${r.status.join("\n")}`,
  );
});

ltest("[P6 wiring] an AUTOMATIC post-accept check stays quiet about it", async () => {
  const r = await press(crate("auto", LIB), { manualRefine: false });
  const said = r.messages.map((m) => m.message).join("\n");
  assert.ok(
    !/generated for first_even/i.test(said),
    `an automatic check finding older generated tests broken has no business interrupting. MESSAGES:\n${said}`,
  );
});

ltest("[P6 wiring] a manual press says why the refine and the covering tests were skipped", async () => {
  const r = await press(crate("skip", LIB));
  assert.ok(
    r.lines.some((l) => /the refine and the covering tests were both skipped/.test(l)),
    `the skip was silent before phase 6, and a press that did nothing right looks like a press that did nothing. CHANNEL:\n${r.lines.join("\n")}`,
  );
});
