// Evidence must name the SERVER OF A ROUND, not the setting.
//
// Found live, in the human's own channel, on a real generation:
//
//   [fngen] gen model=qwen3-coder:30b        <- wrong; no ollama served this
//   [claude-code] ... model=cli-default      <- right; no --model was sent
//
// The fn-gen line printed the untouched `fnGenModel` setting, which still held
// the local ollama tag because the Claude Code backend deliberately does NOT
// send a model id when the setting reads a local default - the CLI picks for
// itself. So every Claude round was labelled as a qwen round on the one line a
// measurement rig would read to attribute a row.
//
// The phase-2 adversarial review called this out as REASONED; the live log
// promoted it to PROVEN. These rows are the regression fence.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v43-model-label",
  `export { FnGenService } from "../src/core/fnGenService";
export { claudeModelLabel } from "../src/core/claudeCodeInstruct";
export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";\n`
);
const { FnGenService, claudeModelLabel, DEFAULT_FNGEN_CONFIG } = mod;
test.after(cleanup);

const CONFIG = { ...DEFAULT_FNGEN_CONFIG, apiBase: "" };

// A generate fn that answers instantly, so these rows never touch a server.
const canned = async () => ({ text: "fn f() {}", ttftMs: 1, totalMs: 1, doneReason: "stop" });

function capture(modelLabel) {
  const lines = [];
  const service = new FnGenService(CONFIG, canned, (l) => lines.push(l), modelLabel);
  return { service, lines };
}

test("the fn-gen evidence line names the LABEL when one is given, not the config's model", async () => {
  const { service, lines } = capture("cli-default");
  await service.generateRaw("prompt", {});
  const gen = lines.find((l) => l.startsWith("[fngen] gen "));
  assert.ok(gen, `expected an [fngen] gen line, got ${JSON.stringify(lines)}`);
  assert.match(gen, /model=cli-default/, `the round was served by the CLI's own choice: ${gen}`);
  assert.ok(
    !gen.includes(DEFAULT_FNGEN_CONFIG.model),
    `the ollama tag must not appear on a line for a round no ollama served: ${gen}`
  );
  service.dispose();
});

test("modelTag carries the label too, so the repair and refine lines agree with the fn-gen line", () => {
  const { service } = capture("cli-default");
  assert.strictEqual(
    service.modelTag,
    "cli-default",
    "oracleSurface reads modelTag for its [repair] round lines; a disagreeing pair is worse than either alone"
  );
  service.dispose();
});

test("the result's model field is the label, because callers attribute rows with it", async () => {
  const { service } = capture("claude-sonnet-4-5");
  const out = await service.generateRaw("prompt", {});
  assert.strictEqual(out.model, "claude-sonnet-4-5");
  service.dispose();
});

test("with NO label the config's model is used verbatim - every other backend is unchanged", async () => {
  const { service, lines } = capture(undefined);
  await service.generateRaw("prompt", {});
  const gen = lines.find((l) => l.startsWith("[fngen] gen "));
  assert.match(gen, new RegExp(`model=${DEFAULT_FNGEN_CONFIG.model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.strictEqual(service.modelTag, DEFAULT_FNGEN_CONFIG.model);
  service.dispose();
});

// The rule itself, in the one place it is now spelled. The wiring's evidence
// line and the service's label both come from here, so they cannot drift from
// each other - and neither can drift from what the module actually sends.
test("claudeModelLabel: a local ollama tag reads cli-default, a Claude id reads itself", () => {
  assert.strictEqual(claudeModelLabel(DEFAULT_FNGEN_CONFIG.model), "cli-default");
  assert.strictEqual(claudeModelLabel(DEFAULT_FNGEN_CONFIG.fallbackModel), "cli-default");
  assert.strictEqual(claudeModelLabel("qwen2.5-coder:1.5b-base"), "cli-default", "any tag with a colon");
  assert.strictEqual(claudeModelLabel(""), "cli-default", "an emptied setting sends nothing");
  assert.strictEqual(claudeModelLabel("   "), "cli-default");
  assert.strictEqual(claudeModelLabel("claude-sonnet-4-5"), "claude-sonnet-4-5");
  assert.strictEqual(claudeModelLabel("claude-opus-5"), "claude-opus-5");
});
