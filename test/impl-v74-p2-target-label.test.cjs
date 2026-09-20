// Implementer oracle, session-v74 phase 2: the target label, white-box.
//
// The blind file binds session-v74/contracts/p2-target-label.md. What it cannot
// see from the contract alone:
//   * the ROUTING order inside targetLabel. bodyOnly wins over kind, exactly as
//     the instruction router above it does, so a Python body-only round on a
//     `class` kind says "documented header", not "class";
//   * the gate is on a TRUTHY injectedSurface, so the empty string behaves as
//     absent and matches the section push that already guards that way;
//   * the label is charged to `fixed`, never to `injected`, so a shrinking
//     surface can never shrink the sentence that explains it;
//   * the real prompt the human's failure came out of: the captured bytes plus
//     this label, reproduced through the shipping assembler.
//
// Run: SKIP_LIVE=1 node --test test/impl-v74-p2-target-label.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v74-p2",
  `export { assembleFnGenPrompt, assembleTestGenPrompt, fnGenPromptShare, targetLabel, SECTION_SEPARATOR } from "../src/core/prompt";\n`
);
const { assembleFnGenPrompt, assembleTestGenPrompt, fnGenPromptShare, targetLabel, SECTION_SEPARATOR } = mod;
test.after(cleanup);

const SURFACE = "API surface for `Thing` (real signatures, use these exact names, do not invent):\n```\nfoo() -> u8\n```";
const BASE = { signature: "fn widen(n: i32) -> i64", docComment: "/// Widens.", languageId: "rust" };

// ---- the gate

test("[IMPL-V74-P2 1] an EMPTY injected surface is absent: no label, and no extra section", () => {
  assert.equal(targetLabel({ ...BASE, injectedSurface: "" }), undefined);
  const withEmpty = assembleFnGenPrompt({ ...BASE, injectedSurface: "" });
  const without = assembleFnGenPrompt({ ...BASE });
  assert.equal(withEmpty, without);
});

test("[IMPL-V74-P2 2] the label appears only once the surface is non-empty", () => {
  assert.equal(targetLabel({ ...BASE }), undefined);
  assert.ok(targetLabel({ ...BASE, injectedSurface: SURFACE }));
});

// ---- routing order

test("[IMPL-V74-P2 3] bodyOnly wins over kind, exactly as the instruction router does", () => {
  const label = targetLabel({ ...BASE, languageId: "python", kind: "class", bodyOnly: true, injectedSurface: SURFACE });
  assert.equal(
    label,
    "The documented header to implement a body for is below, after the reference material above. Write that one body."
  );
});

test("[IMPL-V74-P2 4] kind `function` and an omitted kind both read as a function", () => {
  const omitted = targetLabel({ ...BASE, injectedSurface: SURFACE });
  const explicit = targetLabel({ ...BASE, kind: "function", injectedSurface: SURFACE });
  assert.equal(omitted, explicit);
  assert.equal(
    omitted,
    "The function to implement is below, after the reference material above. Write that one function."
  );
});

test("[IMPL-V74-P2 5] every type kind takes its own noun in both sentences", () => {
  for (const kind of ["struct", "enum", "class", "interface"]) {
    const label = targetLabel({ ...BASE, kind, injectedSurface: SURFACE });
    assert.equal(
      label,
      `The ${kind} to complete is below, after the reference material above. Complete that one ${kind}.`,
      kind
    );
  }
});

// ---- placement and accounting

test("[IMPL-V74-P2 6] the label is the second-last section, the surface the third-last", () => {
  const input = { ...BASE, injectedSurface: SURFACE };
  const sections = assembleFnGenPrompt(input).split(SECTION_SEPARATOR);
  assert.equal(sections[sections.length - 2], targetLabel(input));
  assert.equal(sections[sections.length - 3], SURFACE);
  assert.match(sections[sections.length - 1], /^```rust\n/);
});

test("[IMPL-V74-P2 7] the label is charged to `fixed`, never to `injected`", () => {
  const input = { ...BASE, injectedSurface: SURFACE };
  const withLabel = fnGenPromptShare(input);
  // Same input with the surface removed: the injected charge goes to zero and
  // the label goes with it, so the DELTA on `fixed` is the label plus one
  // separator, and `injected` never carried a character of it.
  const bare = fnGenPromptShare({ ...BASE });
  assert.equal(withLabel.injectedChars, SURFACE.length);
  assert.equal(bare.injectedChars, 0);
  assert.equal(
    withLabel.fixedChars - bare.fixedChars,
    targetLabel(input).length + 2 * SECTION_SEPARATOR.length
  );
});

test("[IMPL-V74-P2 8] the share arithmetic stays exact with the label present", () => {
  for (const input of [
    { ...BASE, injectedSurface: SURFACE },
    { ...BASE, injectedSurface: SURFACE, kind: "struct" },
    { ...BASE, injectedSurface: SURFACE, bodyOnly: true },
    { ...BASE, injectedSurface: SURFACE, scaffoldComments: ["do the thing"], localSymbols: ["Thing"] },
    {
      ...BASE,
      injectedSurface: SURFACE,
      contextBlocks: [{ uri: "file:///a.rs", range: { startLine: 1, endLine: 2 }, text: "fn a() {}" }],
    },
  ]) {
    const s = fnGenPromptShare(input);
    assert.equal(
      s.developerChars + s.injectedChars + s.fixedChars,
      assembleFnGenPrompt(input).length,
      JSON.stringify(input.kind ?? input.bodyOnly ?? "plain")
    );
  }
});

// ---- the test-gen half did NOT ship (session-v74 scraps D1)

test("[IMPL-V74-P2 9] assembleTestGenPrompt keeps its unlabelled target block", () => {
  const prompt = assembleTestGenPrompt({ ...BASE, calleeSurface: "pub struct P;" });
  assert.equal(/ is below\./.test(prompt), false, "a label shipped on the test-gen path by accident");
});

// ---- the real prompt

test("[IMPL-V74-P2 10] the captured prompt plus the label is what the assembler now renders", () => {
  const file = path.join(__dirname, "..", "session-v74", "spikes", "prompt.txt");
  if (!fs.existsSync(file)) {
    return; // spikes are gitignored; a no-op on a clean checkout
  }
  const captured = fs.readFileSync(file, "utf8").replace(/\n+$/, "");
  const secs = captured.split(SECTION_SEPARATOR);
  const target = secs[secs.length - 1].split("\n");
  const input = {
    signature: target.find((l) => !l.startsWith("///") && !l.startsWith("```")),
    docComment: target.filter((l) => l.startsWith("///")).join("\n"),
    languageId: "rust",
    injectedSurface: secs.slice(1, secs.length - 1).join(SECTION_SEPARATOR),
    noPunt: true,
  };
  const now = assembleFnGenPrompt(input);
  const label = targetLabel(input);
  assert.ok(label);
  assert.equal(now.replace(`${label}${SECTION_SEPARATOR}`, ""), captured);
});

// ---- what the label must NOT say (adversarial review, phase 2 findings 1 and 2)

test("[IMPL-V74-P2 11] the label names no header above it and forbids nothing", () => {
  // Both halves were measured defects, not style. Naming "data shapes and API
  // surfaces" is false on Rust's example-fallback leg, whose surface renders
  // only `Usage example for ...`. Forbidding implementation "from them" bans
  // the target on the motivating prompt itself, where the enclosing type's own
  // API surface lists the target's signature.
  for (const shape of [{}, { kind: "struct" }, { kind: "enum" }, { kind: "class" }, { kind: "interface" }, { bodyOnly: true }]) {
    const label = targetLabel({ ...BASE, ...shape, injectedSurface: SURFACE });
    assert.equal(/data shapes|API surface|Data shape/.test(label), false, JSON.stringify(shape));
    assert.equal(/do not|don't|never/i.test(label), false, JSON.stringify(shape));
  }
});

test("[IMPL-V74-P2 12] the label survives a surface that renders neither named header", () => {
  // The example-only surface the review produced through the product's own
  // resolvePrefill. The label has to be true of THIS prompt too.
  const exampleOnly =
    "Usage example for `HexWriter` (from its docs, this compiles):\n```rust\nlet w = HexWriter::new();\n```";
  const label = targetLabel({ ...BASE, injectedSurface: exampleOnly });
  const prompt = assembleFnGenPrompt({ ...BASE, injectedSurface: exampleOnly });
  assert.ok(label);
  assert.equal(prompt.includes("Data shape of"), false);
  assert.equal(prompt.includes("API surface for"), false);
  // Everything the label claims is in the prompt: reference material above, the
  // target below it, and nothing else asserted.
  const sections = prompt.split(SECTION_SEPARATOR);
  assert.equal(sections[sections.length - 2], label);
  assert.equal(sections[sections.length - 3], exampleOnly);
});
