// Blind oracle: FnGenService contract (phase2-surface.md
// "src/core/fnGenService.ts") plus the fn-gen config defaults
// ("src/core/config.ts (additions)"). Drives the service headless with an
// injected fake generate fn per the surface's injectable-generate promise;
// assembleFnGenPrompt is bundled alongside to cross-check the prompt the
// service hands the model. Written against the surface doc only; never read
// src/**. Expected red while stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind2-service",
  `export { FnGenService } from "../src/core/fnGenService";
export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";
export { assembleFnGenPrompt } from "../src/core/prompt";\n`
);
const { FnGenService, DEFAULT_FNGEN_CONFIG, assembleFnGenPrompt } = mod;
test.after(cleanup);

const BASE_CONFIG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-30b",
  fallbackModel: "fake-14b",
  maxTokens: 128,
  temperature: 0.2,
};
const cfg = (o = {}) => ({ ...BASE_CONFIG, ...o });

const REQ = {
  signature: "fn add(a: i32, b: i32) -> i32",
  docComment: "/// Adds two numbers.",
  languageId: "rust",
};

// Immediate fake generate: records params, optionally streams chunks first.
function makeGenerate(raw = "```rust\nfn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n```", chunks) {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    if (chunks && params.onChunk) for (const c of chunks) params.onChunk(c);
    return { text: raw, ttftMs: 42, totalMs: 99 };
  };
  return { fn, calls };
}

// Hanging fake generate: resolves only on release(); rejects on abort.
// Default raw matches REQ.signature so a released REQ round passes the
// fn guard.
function makeHangingGenerate(raw = "```\nfn add(a: i32, b: i32) -> i32 { 1 }\n```") {
  const calls = [];
  const waiters = [];
  const releases = [];
  const fn = (params) => {
    calls.push(params);
    waiters.splice(0).forEach((w) => w());
    return new Promise((resolve, reject) => {
      if (params.signal) {
        params.signal.addEventListener("abort", () => {
          const e = new Error("The operation was aborted");
          e.name = "AbortError";
          reject(e);
        });
      }
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

// ---- config defaults [surface: config 'Defaults']

test("DEFAULT_FNGEN_CONFIG carries every documented default, numGpu unset", () => {
  assert.strictEqual(DEFAULT_FNGEN_CONFIG.apiBase, "http://localhost:11434");
  assert.strictEqual(DEFAULT_FNGEN_CONFIG.model, "qwen3-coder:30b");
  assert.strictEqual(DEFAULT_FNGEN_CONFIG.fallbackModel, "qwen2.5-coder:14b-instruct-q4_K_M");
  assert.strictEqual(DEFAULT_FNGEN_CONFIG.maxTokens, 2048);
  assert.strictEqual(DEFAULT_FNGEN_CONFIG.testMaxTokens, 8192);
  assert.strictEqual(DEFAULT_FNGEN_CONFIG.temperature, 0.2);
  assert.strictEqual(DEFAULT_FNGEN_CONFIG.numGpu, undefined);
});

// ---- pipeline: prompt and forwarded params [surface: fnGenService pipeline 1 + 3]

test("generate hands generateFn the assembled prompt and the config values, with a signal, numGpu absent when unset", async () => {
  const g = makeGenerate();
  const svc = new FnGenService(cfg(), g.fn);
  await svc.generate(REQ);
  assert.strictEqual(g.calls.length, 1);
  const p = g.calls[0];
  const expectedPrompt = assembleFnGenPrompt({
    signature: REQ.signature,
    docComment: REQ.docComment,
    contextBlocks: [],
    languageId: REQ.languageId,
  });
  assert.strictEqual(p.prompt, expectedPrompt, "pipeline step 1: assembleFnGenPrompt with contextBlocks ?? []");
  assert.strictEqual(p.apiBase, BASE_CONFIG.apiBase);
  assert.strictEqual(p.model, BASE_CONFIG.model);
  assert.strictEqual(p.maxTokens, BASE_CONFIG.maxTokens);
  assert.strictEqual(p.temperature, BASE_CONFIG.temperature);
  assert.strictEqual(p.numGpu, undefined, "numGpu forwarded only when set");
  assert.ok(p.signal instanceof AbortSignal, "generateFn gets a derived signal");
  svc.dispose();
});

test("numGpu from config is forwarded when set [surface: pipeline 3 'config.numGpu (when set)']", async () => {
  const g = makeGenerate();
  const svc = new FnGenService(cfg({ numGpu: 30 }), g.fn);
  await svc.generate(REQ);
  assert.strictEqual(g.calls[0].numGpu, 30);
  svc.dispose();
});

test("context blocks pass through in order to the prompt [surface: pipeline 1]", async () => {
  const blocks = [
    { uri: "file:///a.rs", range: { startLine: 1, endLine: 2 }, text: "aaa" },
    { uri: "file:///b.rs", range: { startLine: 3, endLine: 4 }, text: "bbb" },
  ];
  const g = makeGenerate();
  const svc = new FnGenService(cfg(), g.fn);
  await svc.generate({ ...REQ, contextBlocks: blocks });
  assert.strictEqual(
    g.calls[0].prompt,
    assembleFnGenPrompt({ signature: REQ.signature, docComment: REQ.docComment, contextBlocks: blocks, languageId: REQ.languageId })
  );
  svc.dispose();
});

// ---- result shape and postprocess [surface: pipeline 4 + 7]

test("non-empty round trip resolves postprocessed text with the serving model and timings", async () => {
  const g = makeGenerate("```rust\nfn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n```");
  const svc = new FnGenService(cfg(), g.fn);
  const out = await svc.generate({ signature: REQ.signature, languageId: "rust" });
  assert.deepStrictEqual(out, {
    text: "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}",
    model: "fake-30b",
    ttftMs: 42,
    totalMs: 99,
  });
  svc.dispose();
});

// ---- doc-comment dedup [surface: pipeline 5]

test("doc-comment dedup: a re-typed doc comment prefix and one following newline are removed", async () => {
  const g = makeGenerate("```rust\n/// Adds two numbers.\nfn add() -> i32 { 1 }\n```");
  const svc = new FnGenService(cfg(), g.fn);
  const out = await svc.generate(REQ);
  assert.strictEqual(out.text, "fn add() -> i32 { 1 }");
  svc.dispose();
});

test("doc-comment dedup handles a multi-line doc comment", async () => {
  const doc = "/// Adds.\n/// Wraps on overflow.";
  const g = makeGenerate("```rust\n/// Adds.\n/// Wraps on overflow.\nfn add() -> i32 { 1 }\n```");
  const svc = new FnGenService(cfg(), g.fn);
  const out = await svc.generate({ ...REQ, docComment: doc });
  assert.strictEqual(out.text, "fn add() -> i32 { 1 }");
  svc.dispose();
});

// The two dedup-gating tests run through generateRaw without a signature:
// generate() always carries one, and its fn guard trims the same leading
// comment lines, which would mask what dedup did or did not do.

test("no dedup without a docComment on the request", async () => {
  const g = makeGenerate("```rust\n/// Adds two numbers.\nfn add() -> i32 { 1 }\n```");
  const svc = new FnGenService(cfg(), g.fn);
  const out = await svc.generateRaw("p", {});
  assert.strictEqual(out.text, "/// Adds two numbers.\nfn add() -> i32 { 1 }");
  svc.dispose();
});

test("no dedup when the text does not start with exactly the doc comment", async () => {
  const g = makeGenerate("```rust\n// different comment\nfn add() -> i32 { 1 }\n```");
  const svc = new FnGenService(cfg(), g.fn);
  const out = await svc.generateRaw("p", { docComment: REQ.docComment });
  assert.strictEqual(out.text, "// different comment\nfn add() -> i32 { 1 }");
  svc.dispose();
});

// ---- evidence lines [surface: pipeline 2 + 6, '[fngen] log line formats, complete list']

test("gen evidence line is exact and emitted before the model call: model, UTF-8 promptBytes, blocks, span", async () => {
  const blocks = [
    { uri: "file:///a.rs", range: { startLine: 1, endLine: 1 }, text: "café" }, // multi-byte: bytes != chars
    { uri: "file:///b.rs", range: { startLine: 2, endLine: 2 }, text: "bbb" },
  ];
  const lines = [];
  const g = makeHangingGenerate();
  const svc = new FnGenService(cfg(), g.fn, (l) => lines.push(l));
  const p = svc.generate({ ...REQ, contextBlocks: blocks, span: { start: 5, end: 10 } });
  await g.called();
  const prompt = assembleFnGenPrompt({ signature: REQ.signature, docComment: REQ.docComment, contextBlocks: blocks, languageId: REQ.languageId });
  const expected = `[fngen] gen model=fake-30b promptBytes=${Buffer.byteLength(prompt, "utf8")} blocks=2 span=5-10`;
  assert.ok(lines.includes(expected), `expected ${JSON.stringify(expected)} before the model resolves, got ${JSON.stringify(lines)}`);
  g.release();
  await p;
  svc.dispose();
});

test("gen evidence line renders a lone dash when the request carries no span", async () => {
  const lines = [];
  const g = makeGenerate();
  const svc = new FnGenService(cfg(), g.fn, (l) => lines.push(l));
  await svc.generate({ signature: REQ.signature, languageId: "rust" });
  const prompt = assembleFnGenPrompt({ signature: REQ.signature, contextBlocks: [], languageId: "rust" });
  const expected = `[fngen] gen model=fake-30b promptBytes=${Buffer.byteLength(prompt, "utf8")} blocks=0 span=-`;
  assert.ok(lines.includes(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(lines)}`);
  svc.dispose();
});

test("completion evidence line is exact: ttft, total, final text length", async () => {
  const lines = [];
  const g = makeGenerate("```rust\nfn f() {}\n```");
  const svc = new FnGenService(cfg(), g.fn, (l) => lines.push(l));
  const out = await svc.generate({ signature: "fn f()", languageId: "rust" });
  const expected = `[fngen] ttft=42ms total=99ms len=${out.text.length}`;
  assert.ok(lines.includes(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(lines)}`);
  svc.dispose();
});

// ---- empty after postprocess [surface: pipeline 7 'empty after postprocess']

test("empty after postprocess rejects with an error containing 'empty' and logs the dropped line", async () => {
  const lines = [];
  const g = makeGenerate(" \n\t\n");
  const svc = new FnGenService(cfg(), g.fn, (l) => lines.push(l));
  await assert.rejects(
    svc.generate(REQ),
    (err) => err instanceof Error && /empty/i.test(err.message)
  );
  const expected = "[fngen] ttft=42ms total=99ms len=0 (dropped: empty after postprocess)";
  assert.ok(lines.includes(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(lines)}`);
  svc.dispose();
});

// ---- abort semantics [surface: pipeline 7 'abort ... resolves undefined', 'Abort is cancellation, never an error']

test("caller-signal abort resolves undefined and logs [fngen] aborted", async () => {
  const lines = [];
  const g = makeHangingGenerate();
  const svc = new FnGenService(cfg(), g.fn, (l) => lines.push(l));
  const ac = new AbortController();
  const p = svc.generate(REQ, ac.signal);
  await g.called();
  ac.abort();
  assert.strictEqual(await p, undefined);
  assert.ok(g.calls[0].signal.aborted, "the derived signal aborted with the caller's");
  assert.ok(lines.includes("[fngen] aborted"), `expected "[fngen] aborted", got ${JSON.stringify(lines)}`);
  svc.dispose();
});

test("newest wins: a second generate aborts the in-flight one, which resolves undefined; the new call proceeds [surface: 'Concurrency: newest wins, no join']", async () => {
  const lines = [];
  const g = makeHangingGenerate("```\nfn second() {}\n```");
  const svc = new FnGenService(cfg(), g.fn, (l) => lines.push(l));
  const first = svc.generate({ signature: "fn first()", languageId: "rust" });
  await g.called();
  const second = svc.generate({ signature: "fn second()", languageId: "rust" });
  await sleep(20);
  g.release(); // resolves whichever request is still live
  const [r1, r2] = await Promise.all([first, second]);
  assert.strictEqual(r1, undefined, "superseded call resolves undefined");
  assert.ok(r2, "newest call completes");
  assert.strictEqual(r2.text, "fn second() {}");
  assert.strictEqual(g.calls.length, 2, "no join: both calls reached generateFn");
  assert.ok(g.calls[0].signal.aborted, "in-flight request aborted");
  assert.ok(lines.includes("[fngen] aborted"), "supersede logs the abort");
  svc.dispose();
});

// ---- failure semantics [surface: pipeline 7 'server/model failure ... rejects with the error']

test("generateFn failure rejects (deliberately unlike FIM) and logs [fngen] request failed", async () => {
  const lines = [];
  const svc = new FnGenService(
    cfg(),
    async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    },
    (l) => lines.push(l)
  );
  await assert.rejects(svc.generate(REQ), (err) => err instanceof Error && err.message.includes("ECONNREFUSED"));
  const failLines = lines.filter((l) => l.startsWith("[fngen] request failed:") && l.includes("ECONNREFUSED"));
  assert.strictEqual(failLines.length, 1, `one request-failed line, got ${JSON.stringify(lines)}`);
  svc.dispose();
});

// ---- dispose [surface: 'dispose aborts any in-flight generation']

test("dispose aborts in-flight work; subsequent generate calls resolve undefined", async () => {
  const g = makeHangingGenerate();
  const svc = new FnGenService(cfg(), g.fn);
  const inflight = svc.generate(REQ);
  await g.called();
  svc.dispose();
  assert.strictEqual(await inflight, undefined, "in-flight generation resolved undefined");
  assert.ok(g.calls[0].signal.aborted);
  assert.strictEqual(await svc.generate(REQ), undefined, "post-dispose generate resolves undefined");
});

// ---- streaming forwarding [surface: pipeline 3 'the request's onChunk forwarded']

test("request onChunk is forwarded: chunks arrive in order and assemble into the raw reply", async () => {
  const chunks = ["```rust\nfn f()", " {}\n", "```"];
  const g = makeGenerate(chunks.join(""), chunks);
  const svc = new FnGenService(cfg(), g.fn);
  const received = [];
  const out = await svc.generate({ signature: "fn f()", languageId: "rust", onChunk: (c) => received.push(c) });
  assert.deepStrictEqual(received, chunks, "raw chunks in arrival order, before postprocessing");
  assert.strictEqual(received.join(""), chunks.join(""), "chunks assemble into the raw reply");
  assert.strictEqual(out.text, "fn f() {}", "resolved text is the postprocessed reply, not the raw stream");
  svc.dispose();
});

// ---- logOutcome [surface: 'logOutcome emits ... never throws and is a no-op without a log fn']

test("logOutcome emits the exact outcome lines", () => {
  const lines = [];
  const svc = new FnGenService(cfg(), makeGenerate().fn, (l) => lines.push(l));
  svc.logOutcome("accept");
  svc.logOutcome("reject");
  assert.deepStrictEqual(lines, ["[fngen] outcome=accept", "[fngen] outcome=reject"]);
  svc.dispose();
});

test("logOutcome without a log fn is a no-op that never throws", () => {
  const svc = new FnGenService(cfg(), makeGenerate().fn);
  assert.doesNotThrow(() => {
    svc.logOutcome("accept");
    svc.logOutcome("reject");
  });
  svc.dispose();
});
