// Blind oracle for session-v68 phase 4: staged context blocks reach the
// test-authoring prompt [session-v68/contracts/P4-context-blocks.md]. Written
// from the contract alone, WITHOUT READING src/** — not one file, not one grep.
// An oracle that had read the assembler would only restate it, which is the
// exact failure this role exists to prevent.
//
// Surface exercised, all through the public seam:
//   assembleTestGenPrompt, assembleFnGenPrompt,
//   renderContextPrefix, renderContextBlock, SECTION_SEPARATOR  ../src/core/prompt
//   FnGenService                                                ../src/core/fnGenService
// The service is driven headless with an injected generate fn and an injected
// log sink, per test/blind2-service.test.cjs and test/blind-v8-testgen.test.cjs.
// No private import path is used anywhere.
//
// What this file CANNOT reach: rules 5, 11 and 12 (dropping the one block that
// overlaps the resolved function span, keeping the doc-comment block above it)
// live in the VS Code command layer, above the core assembler. A core bundle has
// no document, no resolved span and no channel, so those rows are `test.skip`
// below, named and addressed to a VS Code-tier test. What the core CAN say
// about them is asserted: the assembler drops nothing of its own, so if the drop
// does not happen above it, it does not happen at all.
//
// EXPECTED RED: phase 4 is the missing call. A failing assert is a contract
// finding; a bundling crash or a missing export would be a harness bug instead.
//
// Run: SKIP_LIVE=1 node --test test/blind-v68-testgen-context.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v68-testgen-context",
    `export { assembleTestGenPrompt, assembleFnGenPrompt, renderContextPrefix, renderContextBlock, SECTION_SEPARATOR } from "../src/core/prompt";\n` +
      `export { FnGenService } from "../src/core/fnGenService";\n`
  ));
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

const {
  assembleTestGenPrompt,
  assembleFnGenPrompt,
  renderContextPrefix,
  renderContextBlock,
  SECTION_SEPARATOR,
  FnGenService,
} = mod;

// ===========================================================================
// Fixtures.
// ===========================================================================

const LANG_IDS = ["rust", "go", "typescript", "python", "csharp"];

const SIG = {
  rust: "pub async fn fetch_shard(key: &str) -> Result<Shard, Error>",
  go: "func FetchShard(key string) (Shard, error)",
  typescript: "export async function fetchShard(key: string): Promise<Shard>",
  python: "async def fetch_shard(key: str) -> Shard:",
  csharp: "public static Task<Shard> FetchShardAsync(string key)",
};
const NAME = {
  rust: "Rust",
  go: "Go",
  typescript: "TypeScript",
  python: "Python",
  csharp: "C#",
};

const DOC_SENTINEL = "Fetches a shard by key. DOC_SENTINEL_V68_P4";

// The whole point of the phase, in one fixture: the developer hands over the
// test-function template the product cannot guess. `#[tokio::test]` is not
// discoverable from the signature, and it is not the target's body, which is
// why the block is blind-safe by construction (contract §Why).
const BLOCK_A = {
  uri: "file:///w/tests/template.rs",
  range: { startLine: 1, endLine: 6 },
  text: "#[tokio::test(flavor = \"current_thread\")]\nasync fn template() {\n    // BLOCK_ALPHA_SENTINEL_V68\n}",
};
const BLOCK_B = {
  uri: "file:///w/src/support.rs",
  range: { startLine: 10, endLine: 14 },
  text: "pub fn fixture_shard() -> Shard { /* BLOCK_BETA_SENTINEL_V68 */ }",
};
const BLOCK_C = {
  uri: "file:///w/src/other.rs",
  range: { startLine: 2, endLine: 3 },
  text: "const LIMIT: usize = 7; // BLOCK_GAMMA_SENTINEL_V68",
};
const SENTINELS = ["BLOCK_ALPHA_SENTINEL_V68", "BLOCK_BETA_SENTINEL_V68", "BLOCK_GAMMA_SENTINEL_V68"];

const base = (id, over = {}) => ({
  signature: SIG[id],
  docComment: DOC_SENTINEL,
  languageId: id,
  languageName: NAME[id],
  ...over,
});

const testGen = (id, over = {}) => assembleTestGenPrompt(base(id, over));
const fnGen = (id, over = {}) => assembleFnGenPrompt(base(id, over));

// A failure that does not print the prompt is a failure you cannot act on.
const withPrompt = (id, p, why) => `${id}: ${why}\n---- PROMPT ----\n${p}\n---- END ----`;

test("bundle: the P4 surface builds and exports the assemblers, the ONE renderer and the separator [P4 'Surface under contract']", () => {
  assert.strictEqual(bundleError, undefined, `the bundle failed, so every row below is a harness error rather than a contract finding: ${bundleError}`);
  assert.strictEqual(typeof assembleTestGenPrompt, "function", "assembleTestGenPrompt(input) => string");
  assert.strictEqual(typeof assembleFnGenPrompt, "function", "assembleFnGenPrompt(input) => string");
  assert.strictEqual(typeof renderContextPrefix, "function", "renderContextPrefix(blocks) => string: rule 1's single source of the block bytes");
  assert.strictEqual(typeof renderContextBlock, "function", "renderContextBlock(block) => string");
  assert.strictEqual(typeof SECTION_SEPARATOR, "string", "SECTION_SEPARATOR is the ruled joint between the prefix and the body");
  assert.strictEqual(typeof FnGenService, "function", "FnGenService is the request-level surface for rules 3, 4 and 13");
});

// ===========================================================================
// Rule 1 / property 8. Same bytes, same order, same place.
// ===========================================================================

test("[P4 §1+§8 same place] with one block staged, the test-gen prompt STARTS with exactly renderContextPrefix([block]) + SECTION_SEPARATOR", () => {
  for (const id of LANG_IDS) {
    const head = renderContextPrefix([BLOCK_A]) + SECTION_SEPARATOR;
    const p = testGen(id, { contextBlocks: [BLOCK_A] });
    assert.ok(
      p.startsWith(head),
      withPrompt(id, p, `the prompt does not open with the rendered prefix and the ruled separator\n  expected head: ${JSON.stringify(head.slice(0, 300))}\n  got:           ${JSON.stringify(p.slice(0, 300))}`)
    );
  }
});

test("[P4 §1+§8 same bytes] the staged block renders through the ONE renderer: the prefix carries renderContextBlock(block) verbatim", () => {
  const prefix = renderContextPrefix([BLOCK_A]);
  assert.ok(
    prefix.includes(renderContextBlock(BLOCK_A)),
    `renderContextPrefix must render each block through renderContextBlock, or two renderings can differ by a byte\n  prefix: ${JSON.stringify(prefix)}`
  );
  for (const id of LANG_IDS) {
    const p = testGen(id, { contextBlocks: [BLOCK_A] });
    assert.ok(
      p.includes(renderContextBlock(BLOCK_A)),
      withPrompt(id, p, "the test-gen prompt does not carry the block's own rendered bytes")
    );
  }
});

test("[P4 §1 same bytes as fn-gen] the same block renders byte-identically into the test-gen prompt and the fn-gen prompt", () => {
  const head = renderContextPrefix([BLOCK_A, BLOCK_B]) + SECTION_SEPARATOR;
  for (const id of LANG_IDS) {
    const t = testGen(id, { contextBlocks: [BLOCK_A, BLOCK_B] });
    const f = fnGen(id, { contextBlocks: [BLOCK_A, BLOCK_B] });
    assert.ok(f.startsWith(head), withPrompt(id, f, "the fn-gen prompt is the established reference and no longer opens with the prefix; this row cannot judge test-gen against it"));
    assert.strictEqual(
      t.slice(0, head.length),
      f.slice(0, head.length),
      `${id}: the test-gen and fn-gen prompts render the SAME blocks differently. One byte of difference turns every Claude Code fork into a whole-prompt round (rule 1).\n  test-gen head: ${JSON.stringify(t.slice(0, head.length))}\n  fn-gen head:   ${JSON.stringify(f.slice(0, head.length))}`
    );
  }
});

test("[P4 §1 same place] adding blocks is a PURE PREPEND: prefix + separator + the byte-identical block-free prompt", () => {
  // The only way a file written before the change can assert "byte-identical to
  // today": the prompt WITH blocks must decompose into the prefix and the prompt
  // WITHOUT. Anything else means the blocks moved a byte of the instruction.
  for (const id of LANG_IDS) {
    const withBlocks = testGen(id, { contextBlocks: [BLOCK_A, BLOCK_B] });
    const without = testGen(id);
    assert.strictEqual(
      withBlocks,
      `${renderContextPrefix([BLOCK_A, BLOCK_B])}${SECTION_SEPARATOR}${without}`,
      withPrompt(id, withBlocks, "staging blocks did more than prepend the prefix: it changed the instruction bytes too")
    );
  }
});

test("[P4 §1 the blocks are the HEAD and nothing else] no block byte survives past the prefix", () => {
  for (const id of LANG_IDS) {
    const head = renderContextPrefix([BLOCK_A, BLOCK_B]) + SECTION_SEPARATOR;
    const p = testGen(id, { contextBlocks: [BLOCK_A, BLOCK_B] });
    const rest = p.slice(head.length);
    for (const s of ["BLOCK_ALPHA_SENTINEL_V68", "BLOCK_BETA_SENTINEL_V68"]) {
      assert.ok(
        !rest.includes(s),
        withPrompt(id, p, `${s} appears AFTER the prefix, so the blocks are rendered twice or in the wrong place`)
      );
    }
  }
});

// ===========================================================================
// Rule 2 / property 9. Absent or empty is byte-identical to today.
// ===========================================================================

test("[P4 §2+§9 absent, undefined and [] are one prompt] three-way byte identity in all five languages", () => {
  for (const id of LANG_IDS) {
    const absent = testGen(id);
    const undef = testGen(id, { contextBlocks: undefined });
    const empty = testGen(id, { contextBlocks: [] });
    assert.strictEqual(undef, absent, `${id}: contextBlocks: undefined moved a byte against omitting the field entirely`);
    assert.strictEqual(empty, absent, `${id}: contextBlocks: [] moved a byte against omitting the field entirely`);
  }
});

test("[P4 §2+§9 no blocks, no context section] no Context label and no block bytes reach a block-free prompt", () => {
  for (const id of LANG_IDS) {
    for (const input of [{}, { contextBlocks: undefined }, { contextBlocks: [] }]) {
      const p = testGen(id, input);
      assert.ok(
        !/^Context:/m.test(p),
        withPrompt(id, p, `a context section appears with no blocks staged (input ${JSON.stringify(input)}); rule 7 says nothing is auto-staged`)
      );
      for (const s of SENTINELS) {
        assert.ok(!p.includes(s), withPrompt(id, p, `${s} leaked into a prompt that staged no blocks`));
      }
    }
  }
});

test("[P4 §2 the renderer's own empty cases] renderContextPrefix([]) and renderContextPrefix(undefined) are the empty string", () => {
  assert.strictEqual(renderContextPrefix([]), "", "no blocks renders no bytes, or the separator alone would shift every block-free prompt");
  assert.strictEqual(renderContextPrefix(undefined), "", "an absent list renders no bytes");
});

// ===========================================================================
// Property 10 + rule 6. Staged order.
// ===========================================================================

test("[P4 §10 staged order] two blocks render in the order they were staged, and reordering changes the bytes", () => {
  for (const id of LANG_IDS) {
    const p = testGen(id, { contextBlocks: [BLOCK_A, BLOCK_B] });
    const a = p.indexOf("BLOCK_ALPHA_SENTINEL_V68");
    const b = p.indexOf("BLOCK_BETA_SENTINEL_V68");
    assert.ok(a >= 0 && b >= 0, withPrompt(id, p, "both staged blocks must be present before their order can be judged"));
    assert.ok(a < b, withPrompt(id, p, "the second staged block renders before the first"));
    const reversed = testGen(id, { contextBlocks: [BLOCK_B, BLOCK_A] });
    assert.notStrictEqual(
      reversed,
      p,
      `${id}: reversing the staged order produced identical bytes, so the panel's order is not the prompt's order`
    );
  }
});

test("[P4 §6+§10 staged order] three blocks keep their order, and every one of them reaches the prompt", () => {
  for (const id of LANG_IDS) {
    const p = testGen(id, { contextBlocks: [BLOCK_C, BLOCK_A, BLOCK_B] });
    const idx = ["BLOCK_GAMMA_SENTINEL_V68", "BLOCK_ALPHA_SENTINEL_V68", "BLOCK_BETA_SENTINEL_V68"].map((s) => p.indexOf(s));
    assert.ok(idx.every((i) => i >= 0), withPrompt(id, p, `a staged block is missing entirely: ${JSON.stringify(idx)}`));
    assert.deepStrictEqual(
      idx.slice().sort((x, y) => x - y),
      idx,
      withPrompt(id, p, `the staged order [gamma, alpha, beta] renders as ${JSON.stringify(idx)}`)
    );
  }
});

// ===========================================================================
// Rule 7 + what the core CAN say about rules 5, 11 and 12.
// ===========================================================================

test("[P4 §7 nothing is auto-staged] the blocks in the prompt are exactly the blocks handed in, with nothing added", () => {
  for (const id of LANG_IDS) {
    const one = testGen(id, { contextBlocks: [BLOCK_A] });
    assert.ok(!one.includes("BLOCK_BETA_SENTINEL_V68") && !one.includes("BLOCK_GAMMA_SENTINEL_V68"), withPrompt(id, one, "a block nobody staged appeared"));
    assert.strictEqual(
      one,
      `${renderContextPrefix([BLOCK_A])}${SECTION_SEPARATOR}${testGen(id)}`,
      withPrompt(id, one, "the one staged block is not the whole of what was prepended; this phase adds no scraping")
    );
  }
});

test("[P4 §5 the drop cannot live here] the core assembler drops NOTHING of its own, so an overlapping block must be dropped above it", () => {
  // Rule 5's drop is decidable only against the resolved span, in the document
  // the gesture resolved it in — neither of which the assembler is handed. This
  // row pins the consequence: hand the assembler a block that IS the target's
  // own body and it renders it. That is correct here and it is the reason the
  // drop is a command-layer obligation, not an assembler one.
  const bodyBlock = {
    uri: "file:///w/src/target.rs",
    range: { startLine: 40, endLine: 48 },
    text: "pub async fn fetch_shard(key: &str) -> Result<Shard, Error> {\n    // TARGET_BODY_SENTINEL_V68\n    todo!()\n}",
  };
  const p = testGen("rust", { contextBlocks: [bodyBlock] });
  assert.ok(
    p.includes("TARGET_BODY_SENTINEL_V68"),
    withPrompt("rust", p, "the assembler filtered a block on its own. It has no span and no document, so any filtering it does is a guess, and the real rule-5 drop would then be invisible above it")
  );
  assert.strictEqual(
    p,
    `${renderContextPrefix([bodyBlock])}${SECTION_SEPARATOR}${testGen("rust")}`,
    "the assembler is a pure prepend for every block it is handed, including this one"
  );
});

test.skip("[P4 §5+§11 VS CODE TIER] a block whose URI is the target document and whose lines OVERLAP the resolved span is dropped, and the reason is said out loud on the channel and in the progress surface", () => {
  // Unreachable from a core bundle: needs a real document, a resolved function
  // span and the extension's output channel. Belongs in a VS Code-tier test
  // driving column80.generateTests (the test/blind-v31-wiring.test.cjs shape).
});

test.skip("[P4 §11 VS CODE TIER] overlap is INCLUSIVE on both ends: a block covering one line of the body is dropped", () => {
  // Same tier. The boundary cases (block ends on the span's first line; block
  // starts on the span's last line) are the ones worth driving there.
});

test.skip("[P4 §12 VS CODE TIER] a block covering only the doc comment ABOVE the span is KEPT, and a block in ANOTHER document is never dropped by rule 5", () => {
  // Same tier, and the mirror of the row above: the drop must be narrow.
});

test.skip("[P4 §6 VS CODE TIER] order is preserved among the blocks that survive the rule-5 drop", () => {
  // Core-side order is asserted above; survivor order needs the drop, which
  // needs the command layer.
});

// ===========================================================================
// Rules 3, 4 and property 13, through FnGenService.generateTests.
// ===========================================================================

const NUM_CTX = 16384;
const TEST_MAX = 12000;
const AVAILABLE = NUM_CTX - TEST_MAX; // rule 4: the ceiling stays testMaxTokens

const cfg = (o = {}) => ({
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-30b",
  fallbackModel: "fake-14b",
  maxTokens: 128,
  temperature: 0.2,
  ...o,
});

const MOD_TESTS = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetches() { assert_eq!(1, 1); }
}`;
const VALID_REPLY = "Here are the tests:\n\n```rust\n" + MOD_TESTS + "\n```\n";

const REQ = {
  signature: SIG.rust,
  docComment: DOC_SENTINEL,
  languageId: "rust",
  languageName: "Rust",
};

// Injected generate + injected log sink: the two channels a headless oracle has.
function rig(config = cfg(), raw = VALID_REPLY) {
  const calls = [];
  const lines = [];
  const svc = new FnGenService(
    config,
    async (params) => {
      calls.push(params);
      if (params.onChunk) params.onChunk(raw);
      return { text: raw, ttftMs: 1, totalMs: 2, doneReason: "stop" };
    },
    (l) => lines.push(String(l))
  );
  return { svc, calls, lines };
}

test("[P4 §3 the prefix is the CACHE PREFIX] generateTests forwards renderContextPrefix(blocks), and forwards nothing when nothing is staged", async () => {
  const withBlocks = rig();
  await withBlocks.svc.generateTests({ ...REQ, contextBlocks: [BLOCK_A, BLOCK_B] });
  assert.strictEqual(withBlocks.calls.length, 1, "one generateTests, one call to the transport");
  assert.strictEqual(
    withBlocks.calls[0].cachePrefix,
    renderContextPrefix([BLOCK_A, BLOCK_B]),
    `test authoring must reach the same fork session as generation, or every test round pays for the whole prompt again\n  got: ${JSON.stringify(withBlocks.calls[0].cachePrefix)}`
  );
  assert.ok(
    withBlocks.calls[0].prompt.startsWith(`${withBlocks.calls[0].cachePrefix}${SECTION_SEPARATOR}`),
    `the forwarded prefix must really be the stable head of what was assembled\n  prompt: ${JSON.stringify(withBlocks.calls[0].prompt.slice(0, 300))}`
  );
  withBlocks.svc.dispose();

  const bare = rig();
  await bare.svc.generateTests({ ...REQ });
  assert.strictEqual(bare.calls[0].cachePrefix, undefined, "no blocks means no stable head, which is a single-shot round");
  bare.svc.dispose();

  const empty = rig();
  await empty.svc.generateTests({ ...REQ, contextBlocks: [] });
  assert.strictEqual(empty.calls[0].cachePrefix, undefined, "an empty block list is the same nothing as no block list");
  empty.svc.dispose();
});

test("[P4 §1 through the service] what the model is SENT is the prefix, the separator, and the block-free test prompt", async () => {
  const withBlocks = rig();
  await withBlocks.svc.generateTests({ ...REQ, contextBlocks: [BLOCK_A] });
  const bare = rig();
  await bare.svc.generateTests({ ...REQ });
  assert.strictEqual(
    withBlocks.calls[0].prompt,
    `${renderContextPrefix([BLOCK_A])}${SECTION_SEPARATOR}${bare.calls[0].prompt}`,
    `the request-level path must prepend the same bytes the assembler does, and change nothing else\n---- SENT ----\n${withBlocks.calls[0].prompt}\n---- END ----`
  );
  assert.ok(
    withBlocks.calls[0].prompt.includes("BLOCK_ALPHA_SENTINEL_V68"),
    `the staged template never reached the model at all:\n${withBlocks.calls[0].prompt}`
  );
  withBlocks.svc.dispose();
  bare.svc.dispose();
});

test("[P4 §3 the channel must not lie] the test-gen evidence line reports the real block COUNT, never a dash, when blocks are staged", async () => {
  const r = rig();
  await r.svc.generateTests({ ...REQ, contextBlocks: [BLOCK_A, BLOCK_B] });
  const labelled = r.lines.filter((l) => /blocks=/.test(l));
  assert.ok(labelled.length > 0, `no evidence line carries a blocks label at all: ${JSON.stringify(r.lines)}`);
  for (const l of labelled) {
    const m = l.match(/blocks=([^\s]+)/);
    assert.strictEqual(
      m[1],
      "2",
      `the channel says blocks=${m[1]} while two blocks rode into the prompt, so the evidence trail lies about what was sent: ${JSON.stringify(l)}`
    );
  }
  r.svc.dispose();

  const bare = rig();
  await bare.svc.generateTests({ ...REQ });
  for (const l of bare.lines.filter((x) => /blocks=/.test(x))) {
    const m = l.match(/blocks=([^\s]+)/);
    assert.strictEqual(m[1], "0", `no blocks staged, so the count is 0, not ${JSON.stringify(m[1])}: ${JSON.stringify(l)}`);
  }
  bare.svc.dispose();
});

// A block that is unquestionably over a 4384-token window and unquestionably
// under a 16256-token one, in plain ASCII so no estimator's non-ASCII margin
// decides the row.
const HUGE_BLOCK = {
  uri: "file:///w/notes.rs",
  range: { startLine: 1, endLine: 2 },
  text: "// developer notes\npub const NOTES: &str = \"" + "n".repeat(30000) + "\";\n",
};

const refusalEvidence = (r, err) => {
  const lines = r.lines.filter((l) => /refus|does not fit|context window/i.test(l));
  return { lines, message: err ? String(err && err.message ? err.message : err) : "" };
};

test("[P4 §4+§13 the window refusal still fires with blocks staged] it refuses by NAME, calls no model, and does not throw something opaque", async () => {
  const r = rig(cfg({ numCtx: NUM_CTX, testMaxTokens: TEST_MAX }));
  let err;
  try {
    await r.svc.generateTests({ ...REQ, contextBlocks: [HUGE_BLOCK] });
  } catch (e) {
    err = e;
  }
  const ev = refusalEvidence(r, err);
  const all = ev.lines.join("\n") + "\n" + ev.message;

  assert.strictEqual(
    r.calls.length,
    0,
    `an unfittable prompt must make NO model call; the transport was handed ${r.calls.length}. Channel: ${JSON.stringify(r.lines)}`
  );
  assert.ok(
    ev.lines.length > 0 || /does not fit|context window/i.test(ev.message),
    `nothing on the channel and nothing in the error says the prompt was refused for the window.\n  channel: ${JSON.stringify(r.lines)}\n  error:   ${JSON.stringify(ev.message)}`
  );
  if (err) {
    assert.ok(
      err instanceof Error && /does not fit|context window|window/i.test(err.message),
      `the refusal reached the caller as something opaque rather than as the named window failure: ${JSON.stringify(ev.message)}`
    );
  }
  assert.match(
    all,
    new RegExp(String(AVAILABLE)),
    `rule 4: the ceiling for a test module is testMaxTokens, so the refusal must price the prompt against ${AVAILABLE} = ${NUM_CTX} - ${TEST_MAX} and say so.\n  channel: ${JSON.stringify(r.lines)}\n  error:   ${JSON.stringify(ev.message)}`
  );
  r.svc.dispose();
});

test("[P4 §3 the window check must be handed the REAL prefix] the same request FITS without the block and is refused with it", async () => {
  // The falsifier for passing "" to the window check: if the blocks are not
  // priced, staging 30k characters changes nothing and this row's second half
  // sails through.
  const fits = rig(cfg({ numCtx: NUM_CTX, testMaxTokens: TEST_MAX }));
  await fits.svc.generateTests({ ...REQ });
  assert.strictEqual(fits.calls.length, 1, `the block-free test prompt must FIT ${AVAILABLE} tokens, or this row cannot attribute the refusal to the block: ${JSON.stringify(fits.lines)}`);
  fits.svc.dispose();

  const refused = rig(cfg({ numCtx: NUM_CTX, testMaxTokens: TEST_MAX }));
  await refused.svc.generateTests({ ...REQ, contextBlocks: [HUGE_BLOCK] }).catch(() => {});
  assert.strictEqual(
    refused.calls.length,
    0,
    "the staged block was not priced into the window check, so an over-window prompt went to the model"
  );
  refused.svc.dispose();
});

test("[P4 §4 the window is still testMaxTokens] the SAME staged block fits when only maxTokens is reserved and is refused when testMaxTokens is", async () => {
  const generous = rig(cfg({ numCtx: NUM_CTX, maxTokens: 128 })); // no testMaxTokens: falls back to maxTokens
  await generous.svc.generateTests({ ...REQ, contextBlocks: [HUGE_BLOCK] }).catch(() => {});
  assert.strictEqual(
    generous.calls.length,
    1,
    `with testMaxTokens unset the ceiling falls back to maxTokens=128, leaving ${NUM_CTX - 128} tokens, which this block fits inside: ${JSON.stringify(generous.lines)}`
  );
  generous.svc.dispose();

  const tight = rig(cfg({ numCtx: NUM_CTX, maxTokens: 128, testMaxTokens: TEST_MAX }));
  await tight.svc.generateTests({ ...REQ, contextBlocks: [HUGE_BLOCK] }).catch(() => {});
  assert.strictEqual(
    tight.calls.length,
    0,
    `a test module reserves testMaxTokens=${TEST_MAX}, leaving ${AVAILABLE}, and this block does not fit it: ${JSON.stringify(tight.lines)}`
  );
  tight.svc.dispose();
});

// ===========================================================================
// Property 14. Determinism.
// ===========================================================================

test("[P4 §14 deterministic] same input, same bytes: no blocks, one block, two blocks, five languages", () => {
  for (const id of LANG_IDS) {
    for (const blocks of [undefined, [], [BLOCK_A], [BLOCK_A, BLOCK_B], [BLOCK_C, BLOCK_A, BLOCK_B]]) {
      const input = base(id, { contextBlocks: blocks });
      assert.strictEqual(
        assembleTestGenPrompt(input),
        assembleTestGenPrompt(input),
        `${id}: assembling the same input twice produced different bytes with ${blocks ? blocks.length : "no"} block(s)`
      );
    }
  }
});

test("[P4 §14 deterministic] renderContextPrefix is a pure function of the block bytes", () => {
  const a = renderContextPrefix([BLOCK_A, BLOCK_B]);
  assert.strictEqual(a, renderContextPrefix([BLOCK_A, BLOCK_B]), "same blocks, same bytes, every time");
  assert.notStrictEqual(renderContextPrefix([BLOCK_B, BLOCK_A]), a, "reordering the blocks changes the bytes");
  assert.notStrictEqual(renderContextPrefix([BLOCK_A]), a, "removing a block changes the bytes");
  assert.notStrictEqual(
    renderContextPrefix([{ ...BLOCK_A, text: `${BLOCK_A.text}!` }, BLOCK_B]),
    a,
    "an edit inside a staged range changes the bytes"
  );
});

test("[P4 §14 deterministic] the assembled prompt does not drift between two services handed the same request", async () => {
  const one = rig();
  await one.svc.generateTests({ ...REQ, contextBlocks: [BLOCK_A, BLOCK_B] });
  const two = rig();
  await two.svc.generateTests({ ...REQ, contextBlocks: [BLOCK_A, BLOCK_B] });
  assert.strictEqual(one.calls[0].prompt, two.calls[0].prompt, "two identical requests produced different prompts");
  assert.strictEqual(one.calls[0].cachePrefix, two.calls[0].cachePrefix, "two identical requests produced different cache prefixes");
  one.svc.dispose();
  two.svc.dispose();
});
