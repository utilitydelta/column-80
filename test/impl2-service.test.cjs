// Implementer oracle: FnGenService races and dedup sharp edges the blind set
// cannot see — triple supersede, dispose mid-generate, chunk suppression
// after a derived-signal abort when the generate fn misbehaves, dedup
// leaving an empty result (reject path), and the exact log rounding.
// Complements test/blind2-service.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl2-service",
  `export { FnGenService } from "../src/core/fnGenService";
export { REFERENCE_CARVE_NUM_GPU } from "../src/core/config";\n`
);
const { FnGenService, REFERENCE_CARVE_NUM_GPU } = mod;
test.after(cleanup);

const CFG = {
  apiBase: "http://127.0.0.1:1",
  model: "fake-30b",
  fallbackModel: "fake-14b",
  maxTokens: 64,
  temperature: 0.2,
};

const REQ = { signature: "fn f()", docComment: "/// D.", languageId: "rust" };

function makeGenerate(raw, opts = {}) {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    if (opts.chunks) for (const c of opts.chunks) params.onChunk?.(c);
    return { text: raw, ttftMs: opts.ttftMs ?? 42, totalMs: opts.totalMs ?? 99 };
  };
  return { fn, calls };
}

function makeHangingGenerate(raw = "```\nfn done() {}\n```") {
  const calls = [];
  const waiters = [];
  const releases = [];
  const fn = (params) => {
    calls.push(params);
    waiters.splice(0).forEach((w) => w());
    return new Promise((resolve, reject) => {
      params.signal.addEventListener("abort", () => {
        const e = new Error("The operation was aborted");
        e.name = "AbortError";
        reject(e);
      });
      releases.push(() => resolve({ text: raw, ttftMs: 42, totalMs: 99 }));
    });
  };
  return {
    fn,
    calls,
    called: () => (calls.length ? Promise.resolve() : new Promise((r) => waiters.push(r))),
    release: () => releases.splice(0).forEach((r) => r()),
  };
}

// ---- races

test("triple supersede: three rapid generates, only the newest completes, both older resolve undefined", async () => {
  const lines = [];
  const g = makeHangingGenerate("```\nfn third() {}\n```");
  const svc = new FnGenService(CFG, g.fn, (l) => lines.push(l));
  const p1 = svc.generate({ signature: "fn a()" });
  const p2 = svc.generate({ signature: "fn b()" });
  const p3 = svc.generate({ signature: "fn third()" });
  await sleep(10);
  g.release();
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.strictEqual(r1, undefined);
  assert.strictEqual(r2, undefined);
  assert.strictEqual(r3.text, "fn third() {}");
  assert.strictEqual(g.calls.length, 3, "no join anywhere");
  assert.ok(g.calls[0].signal.aborted && g.calls[1].signal.aborted && !g.calls[2].signal.aborted);
  assert.strictEqual(lines.filter((l) => l === "[fngen] aborted").length, 2);
  svc.dispose();
});

test("dispose mid-generate resolves the in-flight call undefined, then dispose is idempotent", async () => {
  const g = makeHangingGenerate();
  const svc = new FnGenService(CFG, g.fn);
  const p = svc.generate(REQ);
  await g.called();
  svc.dispose();
  svc.dispose(); // second dispose must not throw or double-log
  assert.strictEqual(await p, undefined);
});

test("a caller signal aborted BEFORE the call resolves undefined without touching the generate fn, and still logs the abort", async () => {
  const lines = [];
  const g = makeGenerate("```\nfn x() {}\n```");
  const svc = new FnGenService(CFG, g.fn, (l) => lines.push(l));
  const ac = new AbortController();
  ac.abort();
  assert.strictEqual(await svc.generate(REQ, ac.signal), undefined);
  assert.strictEqual(g.calls.length, 0, "no model call for a dead request");
  assert.ok(lines.includes("[fngen] aborted"), `abort is still an observable outcome, got ${JSON.stringify(lines)}`);
  svc.dispose();
});

test("chunk suppression is the service's own: a generate fn that keeps streaming after abort cannot reach the request's onChunk", async () => {
  // Misbehaving generate fn: ignores its signal for chunk delivery.
  let deliver;
  const fn = (params) =>
    new Promise((_resolve, reject) => {
      deliver = (c) => params.onChunk?.(c);
      params.signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
  const svc = new FnGenService(CFG, fn);
  const ac = new AbortController();
  const received = [];
  const p = svc.generate({ ...REQ, onChunk: (c) => received.push(c) }, ac.signal);
  await sleep(5);
  deliver("before");
  ac.abort();
  deliver("after"); // the misbehaving fn streams on; the wrapper must drop this
  assert.strictEqual(await p, undefined);
  assert.deepStrictEqual(received, ["before"]);
  svc.dispose();
});

test("no onChunk on the request means the generate fn receives none: no silent observer is injected", async () => {
  const g = makeGenerate("```\nfn x() {}\n```");
  const svc = new FnGenService(CFG, g.fn);
  await svc.generate({ signature: "fn x()" });
  assert.strictEqual(g.calls[0].onChunk, undefined);
  svc.dispose();
});

// ---- dedup sharp edges

test("RULING: output that is exactly the doc comment dedups to empty and takes the reject path", async () => {
  const lines = [];
  const g = makeGenerate("```rust\n/// D.\n```");
  const svc = new FnGenService(CFG, g.fn, (l) => lines.push(l));
  await assert.rejects(svc.generate(REQ), /empty/i);
  assert.ok(
    lines.includes("[fngen] ttft=42ms total=99ms len=0 (dropped: empty after postprocess)"),
    `dropped line present, got ${JSON.stringify(lines)}`
  );
  svc.dispose();
});

// The two dedup-mechanics tests below run through generateRaw WITHOUT a
// signature: generate() always carries one, and the fn guard would trim the
// same leading lines dedup handles, masking whether dedup itself still
// works. generateRaw with no signature is the guard-free path (headless
// callers own their material) and pins dedup pure.

test("P2-F8: dedup is newline-anchored — an extended doc line passes through whole, no fragment stripping", async () => {
  // "/// D.suffix" starts with the doc comment "/// D." but the character
  // after the match is not a newline: the model extended the doc line, it
  // did not re-type the comment. Stripping here left a junk fragment at
  // the top of the span before the fix; the reply must pass through whole.
  const g = makeGenerate("```\n/// D.suffix\nfn f() {}\n```");
  const svc = new FnGenService(CFG, g.fn);
  const out = await svc.generateRaw("p", { docComment: "/// D." });
  assert.strictEqual(out.text, "/// D.suffix\nfn f() {}");
  svc.dispose();
});

test("dedup strips exactly ONE newline: doc comment + blank line keeps the blank line", async () => {
  const g = makeGenerate("```\n/// D.\n\nfn f() {}\n```");
  const svc = new FnGenService(CFG, g.fn);
  const out = await svc.generateRaw("p", { docComment: "/// D." });
  assert.strictEqual(out.text, "\nfn f() {}");
  svc.dispose();
});

test("empty-string docComment never dedups (non-empty guard), and reaches the prompt as a present field", async () => {
  const g = makeGenerate("```\nfn f() {}\n```");
  const svc = new FnGenService(CFG, g.fn);
  const out = await svc.generate({ signature: "fn f()", docComment: "" });
  assert.strictEqual(out.text, "fn f() {}");
  svc.dispose();
});

// ---- the fn guard: the reply is held to the requested function
// (rust-scratch finding: a reply prepending `use std::io;` spliced the use
// line INSIDE the fn span; the boundary math held, the material lied)

test("a use line above the fn is trimmed, with trim evidence; only the function resolves", async () => {
  const lines = [];
  const g = makeGenerate("```rust\nuse std::io;\n\nfn f() {\n    io();\n}\n```");
  const svc = new FnGenService(CFG, g.fn, (l) => lines.push(l));
  const out = await svc.generate({ signature: "fn f()" });
  assert.strictEqual(out.text, "fn f() {\n    io();\n}");
  assert.ok(
    lines.includes("[fngen] trimmed to the requested function: linesBefore=1 linesAfter=0"),
    `trim evidence line, got ${JSON.stringify(lines)}`
  );
  svc.dispose();
});

test("a trailing helper fn after the closing brace is trimmed, never spliced", async () => {
  const g = makeGenerate("```rust\nfn f() {\n    x();\n}\n\nfn helper() {\n    y();\n}\n```");
  const svc = new FnGenService(CFG, g.fn);
  const out = await svc.generate({ signature: "fn f()" });
  assert.strictEqual(out.text, "fn f() {\n    x();\n}");
  svc.dispose();
});

test("a reply without the requested function rejects with evidence, never material to splice", async () => {
  const lines = [];
  const g = makeGenerate("```rust\nfn something_else() {\n    x();\n}\n```");
  const svc = new FnGenService(CFG, g.fn, (l) => lines.push(l));
  await assert.rejects(svc.generate({ signature: "fn f()" }), /requested function/);
  assert.ok(
    lines.some((l) => l.startsWith("[fngen] request failed:") && /requested function/.test(l)),
    `reject evidence line, got ${JSON.stringify(lines)}`
  );
  svc.dispose();
});

test("generateRaw with a signature applies the same guard: the repair path cannot dodge it", async () => {
  const g = makeGenerate("```rust\nuse std::io;\nfn f() {\n    io();\n}\n```");
  const svc = new FnGenService(CFG, g.fn);
  const out = await svc.generateRaw("repair prompt", { signature: "fn f()" });
  assert.strictEqual(out.text, "fn f() {\n    io();\n}");
  svc.dispose();
});

// The repair and refine rounds reach a Python docstring target through
// generateRaw with a body-only PROMPT. Without the flag the head-anchored trim
// runs anyway, refuses every obedient reply, and the round dies with "generation
// does not contain the requested function" - so those two gestures could never
// repair a documented Python function at all. generate() has always passed it;
// generateRaw dropped it, which is the same drift the placement dispatcher was
// built to kill, one record over.
test("generateRaw bodyOnly: an obedient body-only reply survives the head-anchored trim", async () => {
  const g = makeGenerate("```python\n    return a + b\n```");
  const svc = new FnGenService(CFG, g.fn);
  const out = await svc.generateRaw("repair prompt", {
    signature: "def add(self, a, b):",
    bodyOnly: true,
  });
  assert.strictEqual(out.text, "    return a + b");
  svc.dispose();
});

test("generateRaw without bodyOnly still holds a headless reply to the guard", async () => {
  const g = makeGenerate("```python\n    return a + b\n```");
  const svc = new FnGenService(CFG, g.fn);
  await assert.rejects(
    svc.generateRaw("repair prompt", { signature: "def add(self, a, b):" }),
    /requested function/,
    "the guard is exempted by the request flag, never by the reply's shape",
  );
  svc.dispose();
});

test("on the signature-bearing path an extended doc line is cut as preamble: the P2-F8 pass-through-whole compromise no longer reaches the span", async () => {
  const g = makeGenerate("```\n/// D.suffix\nfn f() {}\n```");
  const svc = new FnGenService(CFG, g.fn);
  const out = await svc.generate(REQ);
  assert.strictEqual(out.text, "fn f() {}");
  svc.dispose();
});

// ---- log formats

test("float client timings are rounded to integer ms in the log line but returned untouched in the result", async () => {
  const lines = [];
  const g = makeGenerate("```\nfn f() {}\n```", { ttftMs: 42.4, totalMs: 99.6 });
  const svc = new FnGenService(CFG, g.fn, (l) => lines.push(l));
  const out = await svc.generate({ signature: "fn f()" });
  assert.ok(lines.includes("[fngen] ttft=42ms total=100ms len=9"), `got ${JSON.stringify(lines)}`);
  assert.strictEqual(out.ttftMs, 42.4);
  assert.strictEqual(out.totalMs, 99.6);
  svc.dispose();
});

test("request-failed line uses String(err): a message-bearing Error renders as 'Error: <msg>'", async () => {
  const lines = [];
  const svc = new FnGenService(
    CFG,
    async () => {
      throw new Error("boom");
    },
    (l) => lines.push(l)
  );
  await assert.rejects(svc.generate(REQ), /boom/);
  assert.ok(lines.includes("[fngen] request failed: Error: boom"), `got ${JSON.stringify(lines)}`);
  svc.dispose();
});

test("gen line counts blocks from the request, not the prompt: zero-length block list logs blocks=0", async () => {
  const lines = [];
  const g = makeGenerate("```\nfn f() {}\n```");
  const svc = new FnGenService(CFG, g.fn, (l) => lines.push(l));
  await svc.generate({ signature: "fn f()", contextBlocks: [] });
  assert.ok(lines.some((l) => l.startsWith("[fngen] gen ") && l.includes("blocks=0") && l.endsWith("span=-")));
  svc.dispose();
});

// ---- P2-F4: truncation and fence contamination are failures, never spliced

test("P2-F4 probe: done_reason length rejects as truncated with [fngen] evidence — truncation garbage never resolves", async () => {
  // The reviewer's probe shape: num_predict exhausted mid-function, raw
  // reply is an unclosed fence plus a half statement.
  const lines = [];
  const fn = async () => ({ text: "```rust\nfn f() {\n    let x =", ttftMs: 5, totalMs: 9, doneReason: "length" });
  const svc = new FnGenService(CFG, fn, (l) => lines.push(l));
  await assert.rejects(svc.generate(REQ), /truncat/i);
  assert.ok(
    lines.some((l) => l.startsWith("[fngen] ") && /truncat/i.test(l)),
    `truncation evidence line, got ${JSON.stringify(lines)}`
  );
  svc.dispose();
});

test("P2-F4: an unclosed fence without done_reason still never lands a fence line in resolved text (fence-contamination reject)", async () => {
  const lines = [];
  const fn = async () => ({ text: "```rust\nfn f() { 1 }", ttftMs: 5, totalMs: 9 });
  const svc = new FnGenService(CFG, fn, (l) => lines.push(l));
  await assert.rejects(svc.generate(REQ), /fence/i);
  assert.ok(
    lines.some((l) => l.startsWith("[fngen] ") && /fence/i.test(l)),
    `fence evidence line, got ${JSON.stringify(lines)}`
  );
  svc.dispose();
});

test("P2-F4: a clean stop with doneReason 'stop' resolves normally — only 'length' is truncation", async () => {
  const fn = async () => ({ text: "```rust\nfn f() { 1 }\n```", ttftMs: 5, totalMs: 9, doneReason: "stop" });
  const svc = new FnGenService(CFG, fn);
  const out = await svc.generate(REQ);
  assert.strictEqual(out.text, "fn f() { 1 }");
  svc.dispose();
});

// ---- P2-F14: outcome token vocabulary

test("P2-F14: logOutcome carries the third token for system discards, distinct from human reject", () => {
  const lines = [];
  const svc = new FnGenService(CFG, makeGenerate("```\nfn f() {}\n```").fn, (l) => lines.push(l));
  svc.logOutcome("accept");
  svc.logOutcome("reject");
  svc.logOutcome("discarded");
  assert.deepStrictEqual(lines, ["[fngen] outcome=accept", "[fngen] outcome=reject", "[fngen] outcome=discarded"]);
  svc.dispose();
});

// ---- P2-F12: one carve value, shared by product and proof

test("P2-F12: the reference carve constant exists and is the spike-proven value the live suite and editor path both run", () => {
  assert.strictEqual(REFERENCE_CARVE_NUM_GPU, 30);
});

// ---- P2-F18: tilde fence contamination rejects like backtick contamination

test("P2-F18 probe: an unclosed tilde fence never lands a fence line in resolved text", async () => {
  const lines = [];
  const fn = async () => ({ text: "~~~rust\nfn f() { 1 }", ttftMs: 5, totalMs: 9 });
  const svc = new FnGenService(CFG, fn, (l) => lines.push(l));
  await assert.rejects(svc.generate(REQ), /fence/i);
  assert.ok(lines.some((l) => l.startsWith("[fngen] ") && /fence/i.test(l)));
  svc.dispose();
});
