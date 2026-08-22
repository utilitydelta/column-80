// Blind oracle: CompletionService contract (phase1-surface.md
// "src/core/completionService.ts") plus config defaults ("src/core/config.ts").
// Drives the service headless with an injected fake generate fn, per the
// surface's injectable-generate promise. Written against the surface doc only;
// never read src/**. Expected red while stubs throw "unimplemented" (the
// config-defaults fixture test may already pass).
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-service",
  `export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`
);
const { CompletionService, DEFAULT_FIM_CONFIG } = mod;
test.after(cleanup);

const BASE_CONFIG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-model",
  maxTokens: 64,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 200,
  suffixChars: 100,
  multiline: true,
  cacheCapacity: 10,
};
const cfg = (o = {}) => ({ ...BASE_CONFIG, ...o });

// Immediate fake generate: records params, resolves fixed timings.
function makeGenerate(text = "hello()") {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    return { text, ttftMs: 42, totalMs: 99 };
  };
  return { fn, calls };
}

// Hanging fake generate: resolves only on release(); rejects on abort.
function makeHangingGenerate(text = "hello()") {
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
      releases.push(() => resolve({ text, ttftMs: 42, totalMs: 99 }));
    });
  };
  return {
    fn,
    calls,
    called: () => (calls.length ? Promise.resolve() : new Promise((r) => waiters.push(r))),
    release: () => releases.splice(0).forEach((r) => r()),
  };
}

const REQ = { prefix: "const a = 1;\nlet b = ", suffix: ";\n// end\n", manual: true };

// ---- config defaults (pure fixture; may pass even against stubs)

// v25 amended this frozen assertion, which is not a thing done lightly. The
// `multiline: true` row was removed because the v25 goal's fix 6 repeals the
// setting outright: "Decided: the setting goes. It is user-facing, defaults
// true, and says 'Allow multi-line completions', and after fix 1 it would govern
// nothing except exempt sites." Scope of authorship became a product decision
// rather than a knob, so the field no longer exists to have a default. Every
// other row is untouched, and the implementation was not shaped to this file.
test("DEFAULT_FIM_CONFIG carries every documented default [surface: config 'Defaults']", () => {
  assert.deepStrictEqual(DEFAULT_FIM_CONFIG, {
    apiBase: "http://localhost:11434",
    model: "qwen2.5-coder:1.5b-base",
    maxTokens: 256,
    temperature: 0.01,
    debounceMs: 150,
    prefixChars: 3000,
    suffixChars: 1000,
    cacheCapacity: 100,
    // v25 fix 8 added these two, and the goal is explicit that they ship as
    // config defaults rather than as constants: "Ship the floor as a config
    // default rather than a constant, and count what it suppresses in the
    // channel so the number can be argued with later." JetBrains' numbers.
    // Without these rows this file and blind-v25-floor assert opposite things
    // about the same object, and the frozen set cannot disagree with itself.
    minGhostChars: 8,
    minGhostAlnum: 2,
    logPrompts: false,
  });
});

// ---- end-to-end with injected generate

test("e2e: complete resolves postprocessed text with fromCache:false and the measured timings [surface: service pipeline 5-7]", async () => {
  const g = makeGenerate("hello()");
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete(REQ);
  assert.ok(out, "non-empty completion resolves a result");
  assert.strictEqual(out.text, "hello()");
  assert.strictEqual(out.fromCache, false);
  assert.strictEqual(out.ttftMs, 42, "ttftMs present iff a model call happened");
  assert.strictEqual(out.totalMs, 99);
  svc.dispose();
});

test("e2e: the injected generate receives the truncated pair and the config values plus an AbortSignal [surface: service pipeline 5]", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg(), g.fn);
  await svc.complete(REQ);
  assert.strictEqual(g.calls.length, 1);
  const p = g.calls[0];
  assert.strictEqual(p.prefix, REQ.prefix, "short prefix passes through untruncated");
  assert.strictEqual(p.suffix, REQ.suffix);
  assert.strictEqual(p.apiBase, BASE_CONFIG.apiBase);
  assert.strictEqual(p.model, BASE_CONFIG.model);
  assert.strictEqual(p.maxTokens, BASE_CONFIG.maxTokens);
  assert.strictEqual(p.temperature, BASE_CONFIG.temperature);
  assert.ok(p.signal instanceof AbortSignal, "generate gets an AbortSignal");
  svc.dispose();
});

test("truncation: prefix keeps its last prefixChars, suffix its first suffixChars [surface: service pipeline 1]", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg({ prefixChars: 200, suffixChars: 100 }), g.fn);
  const prefix = "A".repeat(150) + "B".repeat(100); // 250 chars
  const suffix = "C".repeat(150);
  await svc.complete({ prefix, suffix, manual: true });
  assert.strictEqual(g.calls[0].prefix, "A".repeat(100) + "B".repeat(100), "last 200 of prefix");
  assert.strictEqual(g.calls[0].suffix, "C".repeat(100), "first 100 of suffix");
  svc.dispose();
});

test("postprocess runs on the raw text: leaked stop token trimmed before resolving [surface: service pipeline 6]", async () => {
  const g = makeGenerate("foo();<|endoftext|>junk");
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete(REQ);
  assert.strictEqual(out.text, "foo();");
  svc.dispose();
});

test("postprocess gets the current-line prefix derived from the truncated prefix [surface: pipeline 6 'text after its last newline']", async () => {
  // Cursor line is "  x = " (depth 2). A completion line at depth 0 that is
  // not a block closer must be cut by limitScopeByIndentation.
  const g = makeGenerate("1;\nescape();");
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete({ prefix: "run();\n  x = ", suffix: "\n// end\n", manual: true });
  assert.ok(out, "in-scope first line survives");
  assert.strictEqual(out.text, "1;");
  svc.dispose();
});

test("empty postprocess result resolves undefined and is not cached [surface: pipeline 6 'not cached']", async () => {
  const g = makeGenerate("<|endoftext|>");
  const svc = new CompletionService(cfg(), g.fn);
  assert.strictEqual(await svc.complete(REQ), undefined);
  assert.strictEqual(await svc.complete(REQ), undefined);
  assert.strictEqual(g.calls.length, 2, "second identical call hits the model again, not a cache entry");
  svc.dispose();
});

test("generate failure (server unreachable, model missing) resolves undefined, never rejects [surface: 'complete never rejects']", async () => {
  const svc = new CompletionService(cfg(), async () => {
    throw new Error("connect ECONNREFUSED");
  });
  assert.strictEqual(await svc.complete(REQ), undefined);
  svc.dispose();
});

// ---- cache through the service

test("cache: an identical second call resolves fromCache:true with no ttftMs and no second model call [surface: service pipeline 2]", async () => {
  const g = makeGenerate("hello()");
  const svc = new CompletionService(cfg(), g.fn);
  await svc.complete(REQ);
  const hit = await svc.complete(REQ);
  assert.ok(hit);
  assert.strictEqual(hit.fromCache, true);
  assert.strictEqual(hit.text, "hello()");
  assert.strictEqual(hit.ttftMs, undefined, "ttftMs present iff a model call happened");
  assert.strictEqual(g.calls.length, 1);
  svc.dispose();
});

test("cache: prefix-walk hit while typing through the suggestion, no model call [surface: pipeline 2 'exact or prefix-walk']", async () => {
  const completion = "function add(a, b) { return a + b; }";
  const g = makeGenerate(completion);
  const svc = new CompletionService(cfg(), g.fn);
  const prefix = "const a = 1;\n";
  const suffix = "\n// end\n";
  await svc.complete({ prefix, suffix, manual: true });
  const typed = "function add";
  const hit = await svc.complete({ prefix: prefix + typed, suffix, manual: true });
  assert.ok(hit, "walk hit resolves");
  assert.strictEqual(hit.fromCache, true);
  assert.strictEqual(hit.text, completion.slice(typed.length));
  assert.strictEqual(g.calls.length, 1);
  svc.dispose();
});

test("cache hits skip the debounce: typing through a suggestion must not stutter [surface: pipeline 2 'Cache hits skip the debounce']", async () => {
  const g = makeGenerate("hello()");
  const svc = new CompletionService(cfg({ debounceMs: 400 }), g.fn);
  await svc.complete(REQ); // manual fill
  const t0 = Date.now();
  const hit = await svc.complete({ ...REQ, manual: false });
  const elapsed = Date.now() - t0;
  assert.ok(hit && hit.fromCache, "cache hit");
  assert.ok(elapsed < 200, `cache hit resolved in ${elapsed}ms, must not wait the 400ms debounce`);
  svc.dispose();
});

// ---- debounce

test("debounce: a non-manual call waits debounceMs before the model call [surface: service pipeline 3]", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg({ debounceMs: 150 }), g.fn);
  const t0 = Date.now();
  const out = await svc.complete({ ...REQ, manual: false });
  const elapsed = Date.now() - t0;
  assert.ok(out, "lone call still completes");
  assert.ok(elapsed >= 120, `resolved in ${elapsed}ms, expected the ~150ms debounce wait`);
  svc.dispose();
});

test("debounce: a newer call cancels the older, which resolves undefined and never reaches the model [surface: pipeline 3]", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg({ debounceMs: 150 }), g.fn);
  const older = svc.complete({ prefix: "let a = ", suffix: ";\n", manual: false });
  await sleep(30);
  const newer = svc.complete({ prefix: "let ab = ", suffix: ";\n", manual: false });
  const [o, n] = await Promise.all([older, newer]);
  assert.strictEqual(o, undefined, "older call cancelled");
  assert.ok(n, "newer call completes");
  assert.strictEqual(g.calls.length, 1, "older never reached the model");
  assert.strictEqual(g.calls[0].prefix, "let ab = ", "the surviving call is the newer one");
  svc.dispose();
});

test("debounce: manual: true skips the wait entirely [surface: pipeline 3 'manual: true skips the wait']", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg({ debounceMs: 400 }), g.fn);
  const t0 = Date.now();
  const out = await svc.complete({ ...REQ, manual: true });
  const elapsed = Date.now() - t0;
  assert.ok(out);
  assert.ok(elapsed < 200, `manual call resolved in ${elapsed}ms, must not wait 400ms`);
  svc.dispose();
});

test("debounce: aborting the signal during the wait resolves undefined without a model call [surface: pipeline 3]", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg({ debounceMs: 200 }), g.fn);
  const ac = new AbortController();
  const p = svc.complete({ ...REQ, manual: false }, ac.signal);
  setTimeout(() => ac.abort(), 30);
  assert.strictEqual(await p, undefined);
  assert.strictEqual(g.calls.length, 0);
  svc.dispose();
});

// ---- single-flight

test("single-flight: a same-key concurrent call joins the in-flight request; generate runs once [surface: service pipeline 4]", async () => {
  const g = makeHangingGenerate("joined()");
  const svc = new CompletionService(cfg(), g.fn);
  const c1 = svc.complete(REQ);
  await g.called();
  const c2 = svc.complete(REQ);
  await sleep(20); // let c2 reach the in-flight join before releasing
  g.release();
  const [r1, r2] = await Promise.all([c1, c2]);
  assert.ok(r1 && r2, "both resolve");
  assert.strictEqual(r1.text, "joined()");
  assert.strictEqual(r2.text, "joined()", "both resolve with the same result");
  assert.strictEqual(g.calls.length, 1, "generate called once, not twice");
  svc.dispose();
});

test("single-flight: a different-key call aborts the in-flight request, which resolves undefined [surface: service pipeline 4]", async () => {
  const g = makeHangingGenerate("second()");
  const svc = new CompletionService(cfg(), g.fn);
  const c1 = svc.complete({ prefix: "let a = ", suffix: ";\n", manual: true });
  await g.called();
  const c2 = svc.complete({ prefix: "let zz = ", suffix: ";\n", manual: true });
  await sleep(20);
  g.release(); // resolves whichever request is still live
  const [r1, r2] = await Promise.all([c1, c2]);
  assert.strictEqual(r1, undefined, "aborted in-flight call resolves undefined");
  assert.ok(r2, "replacement call completes");
  assert.strictEqual(r2.text, "second()");
  assert.strictEqual(g.calls.length, 2);
  assert.ok(g.calls[0].signal.aborted, "first request's signal was aborted");
  svc.dispose();
});

// ---- dispose

test("dispose aborts in-flight work and makes subsequent complete calls resolve undefined [surface: 'dispose aborts any in-flight request']", async () => {
  const g = makeHangingGenerate();
  const svc = new CompletionService(cfg(), g.fn);
  const inflight = svc.complete(REQ);
  await g.called();
  svc.dispose();
  assert.strictEqual(await inflight, undefined, "in-flight call resolved undefined");
  assert.ok(g.calls[0].signal.aborted, "in-flight request aborted");
  assert.strictEqual(await svc.complete(REQ), undefined, "post-dispose calls resolve undefined");
});

// ---- logging evidence

test("logging: a model round trip emits one [fim] line with TTFT and total ms; a cache hit emits a [fim] hit line [surface: 'Logging']", async () => {
  const lines = [];
  const g = makeGenerate("hello()");
  const svc = new CompletionService(cfg(), g.fn, (l) => lines.push(l));
  await svc.complete(REQ);
  const roundTrip = lines.filter((l) => l.startsWith("[fim]") && l.includes("42") && l.includes("99"));
  assert.strictEqual(roundTrip.length, 1, `one [fim] line with ttft 42 and total 99, got: ${JSON.stringify(lines)}`);

  const before = lines.length;
  await svc.complete(REQ); // cache hit
  const hitLines = lines.slice(before).filter((l) => l.startsWith("[fim]") && /hit|cache/i.test(l));
  assert.ok(hitLines.length >= 1, `cache hit must emit a [fim] line marking the hit, got: ${JSON.stringify(lines.slice(before))}`);
  svc.dispose();
});
