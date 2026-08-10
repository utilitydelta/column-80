// Blind oracle: the v8 test-authoring surface [P1-surface.md, the three
// exports]. assembleTestGenPrompt renders the contract (signature + doc) and
// encodes the blind-authoring discipline as testable string invariants (no
// reference impl; one parameterized table over rows; few tests; single fenced
// `#[cfg(test)] mod tests` reply; bare #[should_panic]; no mocks; calleeSurface
// as a labelled section). extractTestModule pulls the fenced mod-tests block and
// counts #[test] fns, rejecting the bare-function shape. FnGenService.generateTests
// drives it headless with an injected generate fn (per blind2-service.test.cjs),
// reusing the producer guards but the test-module shape guard. Assertions match
// on STABLE substrings / properties, never exact prompt bytes — the discipline is
// oracled, not the wording. Never read src/**; the functions are stubs, so this
// is expected red.
//
// Run: SKIP_LIVE=1 node --test test/blind-v8-testgen.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v8-testgen",
  `export { assembleTestGenPrompt } from "../src/core/prompt";
export { extractTestModule } from "../src/core/instructPostprocess";
export { FnGenService } from "../src/core/fnGenService";\n`
);
const { assembleTestGenPrompt, extractTestModule, FnGenService } = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// 1. assembleTestGenPrompt — the contract-rendering + discipline invariants.
// ---------------------------------------------------------------------------

// Distinctive sentinels so a leak/absence is greppable in output.
const SIG_SENTINEL = "pub fn add(a: i32, b: i32) -> i32";
const DOC_SENTINEL = "/// Adds two numbers, wrapping on overflow. DOC_VERBATIM_SENTINEL";
const CALLEE_SENTINEL = "impl Widget { pub fn new() -> Widget } CALLEE_BLOCK_SENTINEL";

const FULL_INPUT = {
  signature: SIG_SENTINEL,
  docComment: DOC_SENTINEL,
  calleeSurface: CALLEE_SENTINEL,
  languageId: "rust",
};

test("blind authoring: an explicit directive NOT to write/assume/infer a reference implementation [P1 §1 'Blind authoring']", () => {
  const p = assembleTestGenPrompt(FULL_INPUT);
  const blindDirective = /(do not|don't|never|without)[\s\S]{0,80}implementation/i;
  assert.ok(blindDirective.test(p), "prompt must forbid inventing a reference implementation");
  assert.ok(/implementation/i.test(p), "the word 'implementation' anchors the blind directive");
});

test("renders the contract: the signature appears in the prompt [P1 §1 'Renders the contract']", () => {
  const p = assembleTestGenPrompt(FULL_INPUT);
  assert.ok(p.includes(SIG_SENTINEL), "the target signature is rendered into the prompt");
});

test("doc comment rendered verbatim when present [P1 §1 'contains the doc comment verbatim when present']", () => {
  const p = assembleTestGenPrompt(FULL_INPUT);
  assert.ok(p.includes(DOC_SENTINEL), "the doc comment is reproduced verbatim");
});

test("no docComment -> no doc section, still valid (signature + blind directive survive) [P1 §1 'No doc -> no doc section']", () => {
  const p = assembleTestGenPrompt({ signature: SIG_SENTINEL, languageId: "rust" });
  assert.ok(!p.includes("DOC_VERBATIM_SENTINEL"), "no doc supplied -> no doc content leaks in");
  assert.ok(p.includes(SIG_SENTINEL), "the prompt is still valid: signature present");
  assert.ok(/(do not|don't|never|without)[\s\S]{0,80}implementation/i.test(p), "blind directive still present without a doc");
});

test("a SINGLE #[test] fn, one assert per case — NOT split across fns, NOT looped over a table [P1 §1 'One test fn, one assert per case']", () => {
  const p = assembleTestGenPrompt(FULL_INPUT);
  assert.ok(/single\s+`?#\[test\]/i.test(p), "the prompt instructs a single #[test] fn holding the cases");
  assert.ok(/one\s+`?assert_eq!.*line per case/is.test(p), "one assert line per case, not one fn per case");
  // The blank-value tabstop core blanks each assert's 2nd argument; a data
  // table hides the expected values where the blanker cannot reach them, so the
  // table/loop shape is explicitly forbidden here (the shipped contradiction fix).
  assert.ok(/(never|not|no).{0,40}(table|loop)/is.test(p), "the prompt forbids looping over a table of rows");
  assert.ok(/inline/i.test(p), "each expected value is written inline as the assert's 2nd argument");
});

test("~5 cases named — the sweet spot, batches degrade the impl [P1 §1 'About five cases', finding 4]", () => {
  const p = assembleTestGenPrompt(FULL_INPUT);
  assert.ok(/five/i.test(p), "the prompt names the ~5 case sweet spot");
});

test("no fabricated panics — a #[should_panic] only when the contract EXPLICITLY says so, never via unsafe [P1 §1 'No invented panics']", () => {
  const p = assembleTestGenPrompt(FULL_INPUT);
  assert.ok(/unsafe/i.test(p) && /(never|not|no).{0,40}unsafe/is.test(p), "the prompt forbids forcing a panic with unsafe/raw pointers");
  assert.ok(/(only if|explicit).{0,60}panic/is.test(p), "should_panic is gated on the contract explicitly stating a panic");
});

test("reply shape: a single fenced `#[cfg(test)] mod tests` block, nothing outside [P1 §1 'Reply shape']", () => {
  const p = assembleTestGenPrompt(FULL_INPUT);
  assert.ok(/mod tests/.test(p), "reply-shape instruction names the `mod tests` block");
  assert.ok(/cfg\(test\)/.test(p), "reply-shape instruction names #[cfg(test)]");
});

test("bare #[should_panic] instructed; the expected=\"...\" form is restricted/forbidden [P1 §1 '#[should_panic] bare only']", () => {
  const p = assembleTestGenPrompt(FULL_INPUT);
  assert.ok(/should_panic/i.test(p), "the prompt names #[should_panic]");
  // The doc supplied quotes no panic message, so the expected=... form must be
  // called out as forbidden/restricted. Match the restriction however phrased.
  assert.ok(/expected/i.test(p), "the prompt addresses the should_panic(expected=...) form");
  assert.ok(
    /(never|not|avoid|don't|do not|only|unless|no)[\s\S]{0,80}expected/i.test(p) ||
      /expected[\s\S]{0,80}(unless|only|never|not|avoid)/i.test(p),
    "the expected=... form is restricted (forbidden unless the contract quotes the message)"
  );
});

test("no mocks — prefer the real collaborator over inventing a fake [P1 §1 'No mocks', finding 7]", () => {
  const p = assembleTestGenPrompt(FULL_INPUT);
  assert.ok(/mock/i.test(p), "the prompt addresses mocks");
  assert.ok(/real/i.test(p), "the prompt prefers the real collaborator");
});

test("calleeSurface renders as a visible labelled section when present [P1 §1 'calleeSurface when present']", () => {
  const p = assembleTestGenPrompt(FULL_INPUT);
  assert.ok(p.includes(CALLEE_SENTINEL), "the resolved collaborator surface is rendered when present");
});

test("calleeSurface absent -> not rendered, and undefined is byte-identical to omitting the field [P1 §1 'absent = none']", () => {
  const omitted = assembleTestGenPrompt({ signature: SIG_SENTINEL, docComment: DOC_SENTINEL, languageId: "rust" });
  assert.ok(!omitted.includes("CALLEE_BLOCK_SENTINEL"), "no calleeSurface -> no collaborator section leaks in");
  assert.strictEqual(
    assembleTestGenPrompt({ signature: SIG_SENTINEL, docComment: DOC_SENTINEL, calleeSurface: undefined, languageId: "rust" }),
    omitted,
    "calleeSurface: undefined degrades to the no-calleeSurface prompt, byte-for-byte"
  );
});

test("deterministic: same input -> same bytes [P1 §1 'Deterministic (same input -> same bytes)']", () => {
  assert.strictEqual(assembleTestGenPrompt(FULL_INPUT), assembleTestGenPrompt(FULL_INPUT));
  const minimal = { signature: SIG_SENTINEL, languageId: "rust" };
  assert.strictEqual(assembleTestGenPrompt(minimal), assembleTestGenPrompt(minimal));
});

// ---------------------------------------------------------------------------
// 2. extractTestModule — the fenced mod-tests extractor + the bare-fn guard.
// ---------------------------------------------------------------------------

const MOD_3 = `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_positive() { assert_eq!(add(1, 2), 3); }

    #[test]
    fn adds_zero() { assert_eq!(add(0, 0), 0); }

    #[test]
    fn adds_negative() { assert_eq!(add(-1, -1), -2); }
}`;

const replyBackticks = (body, tag = "rust") => "Here are the tests:\n\n```" + tag + "\n" + body + "\n```\n\nHope that helps.";
const replyTildes = (body, tag = "rust") => "Sure:\n\n~~~" + tag + "\n" + body + "\n~~~\n";

test("extracts the fenced mod-tests block from a reply with prose around it; testCount = 3 [P1 §2 'Extracts the first fenced code block']", () => {
  const out = extractTestModule(replyBackticks(MOD_3));
  assert.ok(out, "a well-formed mod tests reply extracts to a value");
  assert.strictEqual(out.testCount, 3, "testCount counts the three #[test] fns [P1 §2 'count of #[test] attributes']");
  assert.ok(/mod tests/.test(out.text), "text is the extracted mod block");
  assert.ok(!out.text.includes("```"), "text is the fenced content, fences stripped");
  assert.ok(!out.text.includes("Here are the tests"), "surrounding prose is not part of the extracted text");
});

test("tolerates ~~~ fences [P1 §2 'same fence rules ... ``` or ~~~']", () => {
  const out = extractTestModule(replyTildes(MOD_3));
  assert.ok(out, "a ~~~-fenced mod tests reply extracts");
  assert.strictEqual(out.testCount, 3, "testCount still counts under ~~~ fences");
  assert.ok(!out.text.includes("~~~"), "the ~~~ fence is stripped from text");
});

test("undefined when there is no complete fenced block [P1 §2 'undefined when: no complete fenced block']", () => {
  assert.strictEqual(extractTestModule("Here is the module, no fence:\n" + MOD_3), undefined);
});

test("undefined for a bare-function reply: no mod / no #[test] — the guard extractRequestedFunction can't provide [P1 §2 'The single-function shape ... is REJECTED']", () => {
  assert.strictEqual(extractTestModule(replyBackticks("pub fn foo() -> i32 { 42 }")), undefined);
});

test("undefined for a mod block with zero #[test] fns [P1 §2 'OR no #[test] fn']", () => {
  assert.strictEqual(extractTestModule(replyBackticks("mod tests {\n    fn helper() -> i32 { 1 }\n}")), undefined);
});

test("undefined for a fenced block that has #[test] but no mod wrapper [P1 §2 'the block has no mod wrapper']", () => {
  assert.strictEqual(extractTestModule(replyBackticks("#[test]\nfn t() { assert!(true); }")), undefined);
});

test("never throws on garbage; unparseable -> undefined [P1 §2 'Never throws on garbage']", () => {
  const garbage = ["", "   ", "```", "```rust\nunterminated fence", "~~~\n\n", "no code at all, just prose", "```\n```"];
  for (const g of garbage) {
    let out;
    assert.doesNotThrow(() => {
      out = extractTestModule(g);
    }, `extractTestModule must not throw on ${JSON.stringify(g)}`);
    assert.strictEqual(out, undefined, `garbage ${JSON.stringify(g)} -> undefined`);
  }
});

// ---------------------------------------------------------------------------
// 3. FnGenService.generateTests — headless, injected generate fn (blind2 shape).
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-30b",
  fallbackModel: "fake-14b",
  maxTokens: 128,
  temperature: 0.2,
};
const cfg = (o = {}) => ({ ...BASE_CONFIG, ...o });

const TESTGEN_REQ = {
  signature: SIG_SENTINEL,
  docComment: DOC_SENTINEL,
  calleeSurface: CALLEE_SENTINEL,
  languageId: "rust",
};

// Injected fake generate: records params, returns a fixed raw reply + timings.
function makeGenerate(raw, extra = {}) {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    if (params.onChunk) params.onChunk(raw);
    return { text: raw, ttftMs: 42, totalMs: 99, ...extra };
  };
  return { fn, calls };
}

const VALID_REPLY = replyBackticks(MOD_3);

test("valid mod-tests reply -> resolves { text, model, ttftMs, totalMs }, text = the extracted module [P1 §3 'Returns { text, model, ttftMs, totalMs }']", async () => {
  const g = makeGenerate(VALID_REPLY);
  const svc = new FnGenService(cfg(), g.fn);
  const out = await svc.generateTests(TESTGEN_REQ);
  assert.ok(out, "a valid test-module reply resolves a result");
  assert.strictEqual(out.model, "fake-30b", "result carries the serving model");
  assert.strictEqual(out.ttftMs, 42, "result carries ttftMs");
  assert.strictEqual(out.totalMs, 99, "result carries totalMs");
  assert.strictEqual(out.text, extractTestModule(VALID_REPLY).text, "text is exactly the extracted mod tests block");
  assert.ok(/mod tests/.test(out.text) && !out.text.includes("```"), "text is the fenced mod content, fences stripped");
  svc.dispose();
});

test("the assembled prompt reaches the injected generateFn, carrying the blind directive [P1 §3 'Assembles via assembleTestGenPrompt']", async () => {
  const g = makeGenerate(VALID_REPLY);
  const svc = new FnGenService(cfg(), g.fn);
  await svc.generateTests(TESTGEN_REQ);
  assert.strictEqual(g.calls.length, 1, "generateFn was called once");
  const sent = g.calls[0].prompt;
  const expected = assembleTestGenPrompt({
    signature: TESTGEN_REQ.signature,
    docComment: TESTGEN_REQ.docComment,
    calleeSurface: TESTGEN_REQ.calleeSurface,
    languageId: TESTGEN_REQ.languageId,
  });
  assert.strictEqual(sent, expected, "the model receives exactly the assembleTestGenPrompt output");
  assert.ok(/(do not|don't|never|without)[\s\S]{0,80}implementation/i.test(sent), "what the model was sent carries the blind directive");
  assert.ok(sent.includes(SIG_SENTINEL), "what the model was sent renders the signature");
  svc.dispose();
});

test("a bare-function reply (fails extractTestModule) -> REJECTS with a 'test module' error [P1 §3 'not a mod tests block -> throws']", async () => {
  const g = makeGenerate(replyBackticks("pub fn add(a: i32, b: i32) -> i32 { a + b }"));
  const svc = new FnGenService(cfg(), g.fn);
  await assert.rejects(
    svc.generateTests(TESTGEN_REQ),
    (err) => err instanceof Error && /test module/i.test(err.message),
    "a reply with no test module throws 'generation does not contain a test module ...'"
  );
  svc.dispose();
});

test("test-module generation gets its own larger num_predict, not the single-function maxTokens [P1 §3 'test budget']", async () => {
  const g = makeGenerate(VALID_REPLY);
  const svc = new FnGenService(cfg({ maxTokens: 128, testMaxTokens: 999 }), g.fn);
  await svc.generateTests(TESTGEN_REQ);
  assert.strictEqual(g.calls[0].maxTokens, 999, "generateTests requests testMaxTokens, not the single-function maxTokens");
  svc.dispose();
});

test("testMaxTokens absent -> falls back to maxTokens (older/injected configs do not crash) [P1 §3 'test budget fallback']", async () => {
  const g = makeGenerate(VALID_REPLY);
  const svc = new FnGenService(cfg({ maxTokens: 128 }), g.fn); // no testMaxTokens on BASE_CONFIG
  await svc.generateTests(TESTGEN_REQ);
  assert.strictEqual(g.calls[0].maxTokens, 128, "the test shape falls back to maxTokens when testMaxTokens is unset");
  svc.dispose();
});

test("truncation message reports the TEST budget num_predict, not maxTokens [P1 §3 'test budget in error']", async () => {
  const g = makeGenerate(VALID_REPLY, { doneReason: "length" });
  const svc = new FnGenService(cfg({ maxTokens: 128, testMaxTokens: 999 }), g.fn);
  await assert.rejects(
    svc.generateTests(TESTGEN_REQ),
    (err) => err instanceof Error && /num_predict=999/.test(err.message),
    "a length-truncated test generation names the test budget in its error"
  );
  svc.dispose();
});

test("done_reason=length -> throws (producer guard, same as generate) [P1 §3 'done_reason=length -> throw']", async () => {
  const g = makeGenerate(VALID_REPLY, { doneReason: "length" });
  const svc = new FnGenService(cfg(), g.fn);
  await assert.rejects(
    svc.generateTests(TESTGEN_REQ),
    (err) => err instanceof Error,
    "a length-truncated generation is rejected even if the body looks like a module"
  );
  svc.dispose();
});

test("empty reply -> throws (empty after postprocess guard) [P1 §3 'empty after postprocess -> throw']", async () => {
  const g = makeGenerate(" \n\t\n");
  const svc = new FnGenService(cfg(), g.fn);
  await assert.rejects(
    svc.generateTests(TESTGEN_REQ),
    (err) => err instanceof Error,
    "an empty generation is rejected"
  );
  svc.dispose();
});
