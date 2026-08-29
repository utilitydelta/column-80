// White-box: the model-authored review command actually fires (session-v64
// phase 12).
//
// THIS FILE EXISTS BECAUSE OF A SPECIFIC PAST FAILURE. `goShapeHooks` was
// correct, unit tested, and registered nowhere: every test below it passed and
// the leg was dead in the product. A new command with a new round in the middle
// is exactly that shape, so this presses the REAL command through the
// structural `vscode` stub and grades the text handed to the consent gate.
//
// ROWS
//   1  the command is registered under its own id
//   2  a model answer becomes a planted comment above the line it anchored to
//   3  the developer's own diagnostics reach the prompt
//   4  an anchor that names no line plants nothing, and the channel says so
//   5  a dead backend plants nothing and does not pretend the model was quiet
//   6  the two paths do not stack: the rubric's comments are stripped first
//
// Run: SKIP_LIVE=1 node --test test/impl-v64-p12-advise-gesture.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleWithVscodeStub } = require("./.vscode-stub.cjs");

const host = bundleWithVscodeStub(
  "impl-v64-p12-advise",
  `export { registerCriticizeAdvise, CRITICIZE_ADVISE_COMMAND_ID } from "../src/vscode/criticizeAdviseCommand";\n`,
);
test.after(() => host.cleanup());

if (host.error) {
  test("harness sanity: the host bundle must build", () => {
    assert.fail(`the vscode bundle did not build: ${host.error}`);
  });
} else {
  const vscode = host.vscode;

  const SOURCE = [
    "const seen: Map<string, number> = new Map();",
    "/** Records the hit. */",
    "export function touch(key: string, warm: boolean): boolean {",
    "  const now = Date.now();",
    "  const first = !seen.has(key);",
    "  seen.set(key, now);",
    "  return first;",
    "}",
  ].join("\n");

  function makeDoc(text, languageId = "typescript") {
    const lines = text.split("\n");
    return {
      uri: { fsPath: "/tmp/advise.ts", toString: () => "file:///tmp/advise.ts", scheme: "file" },
      languageId,
      version: 1,
      lineCount: lines.length,
      getText: () => text,
      lineAt: (i) => ({ text: lines[i] }),
      positionAt: (offset) => {
        let seenChars = 0;
        for (let i = 0; i < lines.length; i++) {
          if (seenChars + lines[i].length >= offset) return new vscode.Position(i, offset - seenChars);
          seenChars += lines[i].length + 1;
        }
        return new vscode.Position(lines.length - 1, 0);
      },
      offsetAt: (pos) => {
        let out = 0;
        for (let i = 0; i < pos.line; i++) out += lines[i].length + 1;
        return out + pos.character;
      },
    };
  }

  async function press({ answer, diagnostics = [], tierGate, source = SOURCE } = {}) {
    const doc = makeDoc(source);
    const lines = source.split("\n");
    const headLine = lines.findIndex((l) => /\bfunction\s+\w+/.test(l)) + 1;
    let headOffset = 0;
    for (let i = 0; i < headLine - 1; i++) headOffset += lines[i].length + 1;
    headOffset += lines[headLine - 1].search(/\S/);

    globalThis.__C80_ACTIVE__ = { document: doc, selection: { active: new vscode.Position(headLine - 1, 0) } };
    globalThis.__C80_WARNINGS__ = [];
    globalThis.__C80_COMMANDS__ = {};
    globalThis.__C80_CALL_ROOTS__ = {};
    globalThis.__C80_OUTGOING__ = {};
    globalThis.__C80_DIAGNOSTICS__ = diagnostics;

    const channel = [];
    const output = { name: "advise", appendLine: (l) => channel.push(l), append() {}, show() {}, hide() {}, clear() {}, dispose() {} };
    const presented = [];
    const prompts = [];

    host.mod.registerCriticizeAdvise({ subscriptions: [] }, output, {
      resolveFunction: async () => ({
        span: { start: headOffset, end: source.length },
        headOffset,
        signature: lines[headLine - 1].trim(),
        symbolName: "touch",
        languageId: "typescript",
        kind: "function",
        bodyOnly: false,
        headerIndent: "",
      }),
      tierGate: async () => tierGate ?? { allowed: true },
      tierMessage: () => "the hardware tier disables function generation",
      transport: () => async (req) => {
        prompts.push(req.prompt);
        return { text: answer ? answer(req.prompt) : '{"blocks":[]}' };
      },
      presenter: () => ({
        present: async (request) => {
          presented.push(request);
          return "reject";
        },
      }),
    });
    await globalThis.__C80_COMMANDS__[host.mod.CRITICIZE_ADVISE_COMMAND_ID]();
    return { channel, presented, prompts };
  }

  const planted = (run) => {
    assert.strictEqual(run.presented.length, 1, `expected one proposal, got ${run.presented.length}`);
    return run.presented[0].text;
  };

  test("1: the command registers under its own id, distinct from the rubric's", () => {
    assert.strictEqual(host.mod.CRITICIZE_ADVISE_COMMAND_ID, "column80.reviewFunctionModel");
    assert.notStrictEqual(host.mod.CRITICIZE_ADVISE_COMMAND_ID, "column80.criticizeFunction");
  });

  test("2: a model answer becomes a comment planted above the line it anchored to", async () => {
    const run = await press({
      answer: () =>
        JSON.stringify({
          blocks: [
            { dimension: "clock", anchor: "const now = Date.now();", text: "Pass the instant in as a parameter." },
          ],
        }),
    });
    const text = planted(run);
    const at = text.split("\n").findIndex((l) => l.includes("const now = Date.now();"));
    assert.ok(at > 0, `the anchored line is missing from the proposal:\n${text}`);
    assert.ok(
      text.split("\n")[at - 1].includes("C80 clock:"),
      `the comment is not directly above its anchor:\n${text}`,
    );
    assert.ok(text.includes("Pass the instant in as a parameter."), "the model's own words must land");
  });

  test("3: the developer's own diagnostics reach the prompt, with their rule id", async () => {
    const run = await press({
      diagnostics: [
        {
          range: { start: { line: 3, character: 2 } },
          severity: vscode.DiagnosticSeverity.Warning,
          source: "ts",
          code: "6133",
          message: "'now' is declared but its value is never read.",
        },
      ],
      answer: () => '{"blocks":[]}',
    });
    assert.strictEqual(run.prompts.length, 1, "exactly one model round");
    assert.ok(run.prompts[0].includes("6133"), `the diagnostic's rule id never reached the prompt:\n${run.prompts[0]}`);
    assert.ok(
      run.prompts[0].includes("'now' is declared but its value is never read."),
      "the diagnostic's message never reached the prompt",
    );
    assert.ok(
      run.channel.some((l) => l.includes("1 diagnostic(s) from the developer's tools")),
      `the channel did not report the evidence it carried:\n${run.channel.join("\n")}`,
    );
  });

  test("4: an anchor naming no line plants nothing, and the channel says which anchor missed", async () => {
    const run = await press({
      answer: () =>
        JSON.stringify({
          blocks: [{ dimension: "clock", anchor: "const now = SomethingElse.now();", text: "Pass it in." }],
        }),
    });
    assert.strictEqual(run.presented.length, 0, "a block that matched no line must not reach the consent gate");
    assert.ok(
      run.channel.some((l) => l.includes("block dropped") && l.includes("SomethingElse")),
      `the channel did not name the dropped anchor:\n${run.channel.join("\n")}`,
    );
    assert.ok(
      run.channel.some((l) => l.includes("not one of them named a line")),
      "an answered-and-missed round must not read as a model that had nothing to say",
    );
  });

  test("5: a dead backend plants nothing and does not read as a quiet model", async () => {
    const run = await press({
      answer: () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
      },
    });
    assert.strictEqual(run.presented.length, 0, "nothing may be proposed when no answer arrived");
    assert.ok(
      run.channel.some((l) => l.includes("got no answer") && l.includes("ECONNREFUSED")),
      `the outage did not name itself:\n${run.channel.join("\n")}`,
    );
    assert.strictEqual(
      run.channel.some((l) => l.includes("nothing to say")),
      false,
      "an outage was spelled as a model with nothing to say, which is the defect phase 1 closed",
    );
  });

  test("6: the two paths do not stack - a rubric comment already in the file is stripped first", async () => {
    const withRubric = [
      "const seen: Map<string, number> = new Map();",
      "/** Records the hit. */",
      "export function touch(key: string, warm: boolean): boolean {",
      "  // C80 clock: hidden wall-clock read. Untestable. Pass it in.",
      "  const now = Date.now();",
      "  const first = !seen.has(key);",
      "  seen.set(key, now);",
      "  return first;",
      "}",
    ].join("\n");
    const run = await press({
      source: withRubric,
      answer: () =>
        JSON.stringify({
          blocks: [{ dimension: "clock", anchor: "const now = Date.now();", text: "Take the clock as a parameter." }],
        }),
    });
    const text = planted(run);
    assert.strictEqual(
      text.split("\n").filter((l) => l.includes("C80 clock:")).length,
      1,
      `the two paths stacked their comments:\n${text}`,
    );
    assert.ok(text.includes("Take the clock as a parameter."), "the model's comment is the one that survived");
    assert.strictEqual(
      text.includes("hidden wall-clock read"),
      false,
      "the rubric's earlier comment was not stripped",
    );
  });
}
