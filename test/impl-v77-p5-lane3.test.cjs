"use strict";
// session-v77 phase 5, lane 3: the shared toast builders and the generation-side
// text rows (review-p5b M13, M16, M18, M19, M28, M29, L16-L18).
//
// Run: node --test test/impl-v77-p5-lane3.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v77-p5-lane3",
  `export { countOf, noFunctionAtCursorToast } from "../src/vscode/toastText";
export { languageName, unsupportedLanguageToast } from "../src/core/languageName";
export { translateServiceReject, TIGHTEN_VOICE } from "../src/vscode/failureToast";
export { ClaudeCodeError } from "../src/core/claudeCodeInstruct";
export { arbitratePrompt, promptRefusalMessage, promptRefusalChannelLine } from "../src/core/promptBudget";
export { computeTier } from "../src/core/tiers";
`,
);
test.after(cleanup);

test("L18: a count reads as a count, never as 'test(s)'", () => {
  const rows = [
    [0, "test", undefined, "0 tests"],
    [1, "test", undefined, "1 test"],
    [2, "blank value", undefined, "2 blank values"],
    [1, "match", "matches", "1 match"],
    [3, "match", "matches", "3 matches"],
  ];
  for (const [n, noun, plural, want] of rows) {
    assert.strictEqual(mod.countOf(n, noun, plural), want, `row ${n} ${noun}`);
  }
});

test("M28: one unsupported-language shape, naming the language a person knows", () => {
  const rows = [
    ["typescriptreact", "Column 80: Run TDD Tests does not work in TypeScript React files. It works in Rust and Go."],
    ["plaintext", "Column 80: Run TDD Tests does not work in plain text files. It works in Rust and Go."],
    ["zig", "Column 80: Run TDD Tests does not work in zig files. It works in Rust and Go."],
  ];
  for (const [id, want] of rows) {
    assert.strictEqual(mod.unsupportedLanguageToast("Run TDD Tests", id, "Rust and Go"), want, id);
  }
});

test("M29: the cursor refusal has one shape and still names which command wanted a function", () => {
  const commands = ["Generate Function Body", "Repair Function Body", "Generate Tests (TDD)", "Run TDD Tests", "Run Covering Tests"];
  const msgs = commands.map((c) => mod.noFunctionAtCursorToast(c));
  assert.strictEqual(new Set(msgs).size, commands.length, "no two commands share a string");
  for (const [i, m] of msgs.entries()) {
    assert.strictEqual(m, `Column 80: ${commands[i]} needs the cursor inside a function.`);
  }
  assert.strictEqual(
    mod.noFunctionAtCursorToast("Generate Function Body", true),
    "Column 80: Generate Function Body needs the cursor inside a function or on a type declaration.",
  );
});

test("M18: the window refusal toast carries no token counts; the channel line keeps them", () => {
  const base = { windowed: true, numCtx: 8192, maxTokens: 2048, developerTok: 0, fixedTok: 0, injectedBlocks: 0, injectedTokFor: () => 0 };
  const rows = [
    ["developer blocks, no injection", { developerTok: 9000 }, "Remove a context block."],
    ["fixed share alone overflows", { fixedTok: 9000 }, "Even without context blocks it is too long"],
  ];
  for (const [label, over, wantFragment] of rows) {
    const d = mod.arbitratePrompt({ ...base, ...over });
    assert.strictEqual(d.verdict, "refuse", label);
    const msg = mod.promptRefusalMessage(d);
    assert.ok(msg.startsWith("Column 80: this function and its context are too long for the model, so nothing was generated. "), `${label}: ${msg}`);
    assert.ok(msg.includes(wantFragment), `${label}: ${msg}`);
    assert.doesNotMatch(msg, /\d{3,}|tokens/, `${label}: no figure on the toast: ${msg}`);
    const line = mod.promptRefusalChannelLine(d);
    assert.ok(line.includes(String(d.totalTok)) && line.includes(String(d.availableTok)), `${label}: ${line}`);
  }
});

test("M13: a small GPU is told the floor in GB, not its own MB figure", () => {
  const rows = [
    [8192, "Function generation is disabled: this GPU has under 12GB of VRAM. Set column80.fnGenProvider to use a cloud model or Claude Code."],
    [undefined, "Function generation is disabled: no usable GPU was found, and it needs 12GB of VRAM. Set column80.fnGenProvider to use a cloud model or Claude Code."],
  ];
  for (const [vram, want] of rows) {
    assert.strictEqual(mod.computeTier(vram, 32768).message, want, `vram=${vram}`);
  }
});

test("M19 + M16: Claude Code toasts quote commands with double quotes, and Tighten names what it lost", () => {
  const rows = [
    ["logged-out", "Column 80: Claude Code is not logged in, so identifiers were not marked. Run \"claude\" in a terminal, then \"/login\", and try again."],
    ["timeout", "Column 80: Claude Code did not answer in time, so identifiers were not marked. Try again, or check that \"claude\" still responds in a terminal."],
  ];
  for (const [reason, want] of rows) {
    const msg = mod.translateServiceReject(new mod.ClaudeCodeError(reason, "x"), mod.TIGHTEN_VOICE);
    assert.strictEqual(msg, want, reason);
    assert.ok(!msg.includes("`"), `${reason}: a toast does not render backticks: ${msg}`);
  }
});
