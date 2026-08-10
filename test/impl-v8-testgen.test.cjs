// Implementer tests for P1 (on top of the blind oracle blind-v8-testgen): the two
// triaged review fixes, proven with the internals visible.
//   D1 — the test-module path strips a leading <think> block before extraction,
//        so a `<think>` reasoning block carrying a fenced `mod tests` DECOY is not
//        extracted as the deliverable (the pass the goal reserves thinking-on for).
//   D2 — extractTestModule detects the `mod` wrapper and counts `#[test]` on
//        comment/string-NEUTRALIZED text, so Rust prose ("mod foo" in a comment,
//        a `#[test]` in a doc line) neither passes the wrapper guard nor inflates
//        the count. The returned text is still the original block.
//
// Run: SKIP_LIVE=1 node --test test/impl-v8-testgen.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v8-testgen",
  `export { extractTestModule, stripLeadingThink } from "../src/core/instructPostprocess";
export { FnGenService } from "../src/core/fnGenService";\n`
);
const { extractTestModule, stripLeadingThink, FnGenService } = mod;
test.after(cleanup);

const fence = (body, tag = "rust") => "```" + tag + "\n" + body + "\n```";
const REAL_MOD = `#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn happy() { assert_eq!(add(1, 2), 3); }
    #[test]
    fn edge() { assert_eq!(add(0, 0), 0); }
}`;

// ---- D1: stripLeadingThink ------------------------------------------------

test("stripLeadingThink drops a leading <think>…</think> and keeps the rest", () => {
  assert.strictEqual(stripLeadingThink("<think>reasoning</think>\nANSWER"), "\nANSWER");
});

test("stripLeadingThink drops the WHOLE reply on an unclosed <think> (thought never lands)", () => {
  assert.strictEqual(stripLeadingThink("<think>reasoning with no close\nANSWER"), "");
});

test("stripLeadingThink passes a reply with no leading think tag through verbatim", () => {
  const r = "```rust\nmod tests {}\n```";
  assert.strictEqual(stripLeadingThink(r), r);
});

// ---- D2: comment/string neutralization in extractTestModule ---------------

test("D2: a bare #[test] set whose COMMENT mentions `mod foo` is still rejected (no real wrapper)", () => {
  const reply = fence(`// we could wrap these in mod foo but won't
#[test]
fn t() { assert!(true); }`);
  assert.strictEqual(extractTestModule(reply), undefined, "a `mod` in a comment must not satisfy the wrapper guard");
});

test("D2: a bare #[test] set whose STRING literal contains `mod bar` is still rejected", () => {
  const reply = fence(`#[test]
fn t() { let s = "mod bar {}"; assert_eq!(s.len(), 10); }`);
  assert.strictEqual(extractTestModule(reply), undefined, "a `mod` inside a string literal must not satisfy the wrapper guard");
});

test("D2: testCount ignores a `#[test]` sitting in a comment inside a real module", () => {
  const reply = fence(`mod tests {
    // a stray #[test] mention in prose
    #[test]
    fn only_real() { assert!(true); }
}`);
  const out = extractTestModule(reply);
  assert.ok(out, "the real module extracts");
  assert.strictEqual(out.testCount, 1, "the commented #[test] is not counted");
});

test("D2: the returned text is the ORIGINAL block, comments intact (neutralization is scan-only)", () => {
  const body = `mod tests {
    // keep this comment
    #[test]
    fn t() { assert!(true); }
}`;
  const out = extractTestModule(fence(body));
  assert.ok(out);
  assert.ok(out.text.includes("// keep this comment"), "neutralization must not mutate the returned text");
  assert.strictEqual(out.text, body, "text is the exact fenced content");
});

// ---- D1 end-to-end through generateTests ----------------------------------

const CONFIG = { apiBase: "http://127.0.0.1:1", model: "fake-30b", maxTokens: 128, temperature: 0.2 };
const makeGen = (raw) => async (p) => {
  if (p.onChunk) p.onChunk(raw);
  return { text: raw, ttftMs: 1, totalMs: 2 };
};
const REQ = { signature: "pub fn add(a: i32, b: i32) -> i32", docComment: "/// Adds.", languageId: "rust" };

test("D1: generateTests ignores a fenced `mod tests` DECOY inside <think> and extracts the real answer after </think>", async () => {
  const decoy = `#[cfg(test)]
mod tests {
    #[test]
    fn decoy() { assert_eq!(add(2, 2), 5); }
}`;
  const reply = "<think>Let me draft: " + fence(decoy) + "\nNo, wrong.</think>\n\nHere is the answer:\n\n" + fence(REAL_MOD);
  const svc = new FnGenService(CONFIG, makeGen(reply));
  const out = await svc.generateTests(REQ);
  assert.ok(out, "resolves a module");
  assert.ok(out.text.includes("fn happy") && out.text.includes("fn edge"), "extracted the REAL module after </think>");
  assert.ok(!out.text.includes("decoy"), "the <think> decoy module was not extracted");
  svc.dispose();
});
