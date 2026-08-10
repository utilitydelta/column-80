// LIVE oracle (v13): does the REAL fn-gen model obey the body-only instruction?
// Fork A's whole correctness rests on the model returning ONLY the body below a
// preserved docstring — never re-declaring the header or re-typing the docstring.
// No unit test can prove that (they feed hand-written replies); this rung drives
// the real model through FnGenService.generate with bodyOnly:true and MEASURES
// the reply. It is RED if the model disobeys — which is the signal that a guard
// (the strip we dropped, or a full-span fallback) is actually needed. If it
// stays green across the cases, the dropped strip was dead weight.
//
// Requires ollama at http://localhost:11434 with the fn-gen instruct model
// (qwen3-coder:30b) pulled, on the reference box. Skip with SKIP_LIVE=1.
//
// Run: npm test  /  npm run test:live
// (This file is NOT in the test:live serial list yet — run it explicitly on the
//  box: `node --test test/impl-v13-bodyonly-live.test.cjs`.)

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const API_BASE = "http://localhost:11434";

const { mod, cleanup } = bundleCore(
  "impl-v13-bodyonly-live",
  `export { FnGenService } from "../src/core/fnGenService";\n` +
    `export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";\n` +
    `export { listModels } from "../src/core/ollama";\n`,
);
const { FnGenService, DEFAULT_FNGEN_CONFIG, listModels } = mod;
test.after(cleanup);

const MODEL = DEFAULT_FNGEN_CONFIG.model;

test("precondition: live ollama is up and the fn-gen model is pulled", { skip: SKIP }, async () => {
  const tags = await listModels(API_BASE);
  assert.ok(Array.isArray(tags), "server reachable");
  assert.ok(tags.includes(MODEL), `${MODEL} must be pulled`);
});

// A body-only request: header + cleaned docstring shown, model asked for the body.
const CASES = [
  {
    name: "documented function",
    symbol: "parse_order",
    signature: "def parse_order(data: bytes) -> dict:",
    docComment: "Parse the wire header, then read each length-prefixed line item into a dict keyed by sku.",
    headerRe: /(?:^|\n)\s*(?:async\s+)?def\s+parse_order\b/,
  },
  {
    name: "documented class",
    symbol: "ServerConfig",
    signature: "class ServerConfig:",
    docComment: "Server configuration: the bind address, the port, and whether TLS is enabled.",
    headerRe: /(?:^|\n)\s*class\s+ServerConfig\b/,
  },
];

for (const c of CASES) {
  test(`body-only obedience: ${c.name} — the reply is the body only (no re-declared header, no repeated docstring)`, { skip: SKIP }, async () => {
    const service = new FnGenService({ ...DEFAULT_FNGEN_CONFIG, temperature: 0.1 });
    const ac = new AbortController();
    const result = await service.generate(
      { signature: c.signature, docComment: c.docComment, languageId: "python", bodyOnly: true },
      ac.signal,
    );
    assert.ok(result && typeof result.text === "string" && result.text.trim() !== "", "the model produced a non-empty body");
    const body = result.text;
    // The reply must NOT re-declare the target header (that would splice a
    // duplicate def/class below the preserved one).
    assert.ok(!c.headerRe.test(body), `the reply re-declared the header — a guard IS needed. REPLY:\n${body}`);
    // The reply must NOT re-type the docstring (a few distinctive words of it).
    const docWords = c.docComment.split(/\s+/).filter((w) => w.length > 4).slice(0, 4);
    for (const w of docWords) {
      assert.ok(!new RegExp(`"""[\\s\\S]*${w}`).test(body), `the reply re-typed the docstring (word "${w}") — the human's words could be paraphrased. REPLY:\n${body}`);
    }
  });
}
