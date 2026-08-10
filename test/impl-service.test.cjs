// Implementer oracle: CompletionService edges beyond the blind contract set —
// truncation boundaries, eviction seen through the service, abort races,
// same-key debounce supersession (surface ruling 1), joiner semantics
// (surface ruling 2). Complements test/blind-service.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-service",
  `export { CompletionService } from "../src/core/completionService";\n`
);
const { CompletionService } = mod;
test.after(cleanup);

const BASE_CONFIG = {
  apiBase: "http://127.0.0.1:1",
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

function makeGenerate(text = "hello()") {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    return { text, ttftMs: 42, totalMs: 99 };
  };
  return { fn, calls };
}

function makeHangingGenerate(text = "hello()") {
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

// ---- truncation boundaries

test("prefix exactly prefixChars long passes through byte-identical", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg({ prefixChars: 10, suffixChars: 5 }), g.fn);
  await svc.complete({ prefix: "0123456789", suffix: "abcde", manual: true });
  assert.strictEqual(g.calls[0].prefix, "0123456789");
  assert.strictEqual(g.calls[0].suffix, "abcde");
  svc.dispose();
});

test("one char over the window drops exactly the first prefix char / last suffix char", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg({ prefixChars: 10, suffixChars: 5 }), g.fn);
  await svc.complete({ prefix: "X0123456789", suffix: "abcdeY", manual: true });
  assert.strictEqual(g.calls[0].prefix, "0123456789");
  assert.strictEqual(g.calls[0].suffix, "abcde");
  svc.dispose();
});

test("prefixChars 0 sends an empty prefix, not the whole document", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg({ prefixChars: 0 }), g.fn);
  await svc.complete({ prefix: "whole document", suffix: "s", manual: true });
  assert.strictEqual(g.calls[0].prefix, "");
  svc.dispose();
});

test("empty prefix and suffix still complete", async () => {
  const g = makeGenerate("start()");
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete({ prefix: "", suffix: "", manual: true });
  assert.strictEqual(out.text, "start()");
  svc.dispose();
});

// ---- cache eviction observed through the service

test("evicted entries go back to the model: capacity 1 alternation calls generate every time", async () => {
  const g = makeGenerate("x()");
  const svc = new CompletionService(cfg({ cacheCapacity: 1 }), g.fn);
  const A = { prefix: "aaa", suffix: ";", manual: true };
  const B = { prefix: "bbb", suffix: ";", manual: true };
  await svc.complete(A); // model, cached
  await svc.complete(B); // model, cached, evicts A
  const again = await svc.complete(A); // A evicted: model again
  assert.strictEqual(again.fromCache, false);
  assert.strictEqual(g.calls.length, 3);
  svc.dispose();
});

test("cache keys are bounded windows: far-context differences beyond the window do not make new entries", async () => {
  // F19: identity is the model's input window, so entries cannot retain or
  // compare document-sized strings. Same window content = same entry.
  const g = makeGenerate("tail()");
  const svc = new CompletionService(cfg({ prefixChars: 10, suffixChars: 5 }), g.fn);
  await svc.complete({ prefix: "AAAA".repeat(50) + "0123456789", suffix: "abcdeZZ", manual: true });
  const second = await svc.complete({ prefix: "BBBB".repeat(50) + "0123456789", suffix: "abcdeQQ", manual: true });
  assert.ok(second, "second resolves");
  assert.strictEqual(second.fromCache, true, "same window content hits regardless of far context");
  assert.strictEqual(g.calls.length, 1);
  svc.dispose();
});

// ---- ruling 1: same-key call during another's debounce wait

test("same-key non-manual call during the older's debounce wait supersedes it; one model call total", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg({ debounceMs: 120 }), g.fn);
  const req = { prefix: "let x = ", suffix: ";\n", manual: false };
  const older = svc.complete(req);
  await sleep(30);
  const newer = svc.complete(req);
  const [o, n] = await Promise.all([older, newer]);
  assert.strictEqual(o, undefined, "older superseded");
  assert.ok(n, "newer completes");
  assert.strictEqual(g.calls.length, 1);
  svc.dispose();
});

// ---- ruling 2: joiner shares the initiator's result object

test("single-flight joiner receives the identical result object (fromCache false, timings present)", async () => {
  const g = makeHangingGenerate("joined()");
  const svc = new CompletionService(cfg(), g.fn);
  const req = { prefix: "p", suffix: "s", manual: true };
  const c1 = svc.complete(req);
  await g.called();
  const c2 = svc.complete(req);
  await sleep(10);
  g.release();
  const [r1, r2] = await Promise.all([c1, c2]);
  assert.strictEqual(r1, r2, "same object, not a copy");
  assert.strictEqual(r2.fromCache, false);
  assert.strictEqual(r2.ttftMs, 42);
  svc.dispose();
});

test("single-flight joiners of an empty-postprocess result all resolve undefined", async () => {
  const g = makeHangingGenerate("<|endoftext|>");
  const svc = new CompletionService(cfg(), g.fn);
  const req = { prefix: "p", suffix: "s", manual: true };
  const c1 = svc.complete(req);
  await g.called();
  const c2 = svc.complete(req);
  await sleep(10);
  g.release();
  assert.deepStrictEqual(await Promise.all([c1, c2]), [undefined, undefined]);
  assert.strictEqual(g.calls.length, 1);
  svc.dispose();
});

// ---- abort races

test("external signal abort during the model call resolves undefined and aborts the request", async () => {
  const g = makeHangingGenerate();
  const svc = new CompletionService(cfg(), g.fn);
  const ac = new AbortController();
  const p = svc.complete({ prefix: "p", suffix: "s", manual: true }, ac.signal);
  await g.called();
  ac.abort();
  assert.strictEqual(await p, undefined);
  assert.ok(g.calls[0].signal.aborted);
  svc.dispose();
});

test("signal already aborted before the call resolves undefined without touching the pipeline", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg(), g.fn);
  const ac = new AbortController();
  ac.abort();
  assert.strictEqual(await svc.complete({ prefix: "p", suffix: "s", manual: true }, ac.signal), undefined);
  assert.strictEqual(g.calls.length, 0);
  svc.dispose();
});

test("an aborted round trip is not cached: the next identical call goes to the model", async () => {
  const g = makeHangingGenerate("real()");
  const svc = new CompletionService(cfg(), g.fn);
  const ac = new AbortController();
  const first = svc.complete({ prefix: "p", suffix: "s", manual: true }, ac.signal);
  await g.called();
  ac.abort();
  assert.strictEqual(await first, undefined);
  const second = svc.complete({ prefix: "p", suffix: "s", manual: true });
  await sleep(10);
  g.release();
  const out = await second;
  assert.ok(out, "second attempt completes");
  assert.strictEqual(out.fromCache, false);
  assert.strictEqual(g.calls.length, 2);
  svc.dispose();
});

test("dispose during the debounce wait resolves undefined without a model call", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg({ debounceMs: 150 }), g.fn);
  const p = svc.complete({ prefix: "p", suffix: "s", manual: false });
  await sleep(20);
  svc.dispose();
  assert.strictEqual(await p, undefined);
  assert.strictEqual(g.calls.length, 0);
});

// ---- generate result already aborted race: late resolution after abort is dropped

test("a generate that resolves despite an abort is discarded, not cached", async () => {
  // Generate ignores the abort signal and resolves anyway — the service must
  // still drop the result because its controller was aborted.
  const calls = [];
  let release;
  const fn = (params) => {
    calls.push(params);
    return new Promise((resolve) => {
      release = () => resolve({ text: "stale()", ttftMs: 1, totalMs: 2 });
    });
  };
  const svc = new CompletionService(cfg(), fn);
  const ac = new AbortController();
  const p = svc.complete({ prefix: "p", suffix: "s", manual: true }, ac.signal);
  await sleep(10);
  ac.abort();
  release();
  assert.strictEqual(await p, undefined, "late result dropped");
  assert.strictEqual(calls.length, 1);
  svc.dispose();
});

// ---- F1: cache keying survives window truncation

test("typing through a suggestion in a document longer than prefixChars keeps hitting the cache", async () => {
  const completion = "function add(a, b) { return a + b; }";
  const g = makeGenerate(completion);
  const svc = new CompletionService(cfg({ prefixChars: 100, suffixChars: 50 }), g.fn);
  // Document prefix well over the window: every keystroke shifts the
  // truncated window's start, which the cache keying must survive.
  const docPrefix = "x".repeat(300) + "\nseed();\n";
  const suffix = "\n// end\n";
  const first = await svc.complete({ prefix: docPrefix, suffix, manual: true });
  assert.strictEqual(first.text, completion);
  for (const typedLen of [1, 5, 12]) {
    const hit = await svc.complete({ prefix: docPrefix + completion.slice(0, typedLen), suffix, manual: true });
    assert.ok(hit, `hit after typing ${typedLen} chars`);
    assert.strictEqual(hit.fromCache, true, `fromCache after ${typedLen} typed chars`);
    assert.strictEqual(hit.text, completion.slice(typedLen));
  }
  assert.strictEqual(g.calls.length, 1, "zero generate calls while typing through");
  svc.dispose();
});

test("the model call still receives the truncated pair when cache keys are untruncated", async () => {
  const g = makeGenerate();
  const svc = new CompletionService(cfg({ prefixChars: 10, suffixChars: 5 }), g.fn);
  await svc.complete({ prefix: "LONGHEAD-0123456789", suffix: "abcdeTAIL", manual: true });
  assert.strictEqual(g.calls[0].prefix, "0123456789");
  assert.strictEqual(g.calls[0].suffix, "abcde");
  svc.dispose();
});

// ---- F5: no silent round trips

test("a round trip whose postprocess result is empty still emits a [fim] evidence line", async () => {
  const lines = [];
  const g = makeGenerate("<|endoftext|>");
  const svc = new CompletionService(cfg(), g.fn, (l) => lines.push(l));
  assert.strictEqual(await svc.complete({ prefix: "p", suffix: "s", manual: true }), undefined);
  const evidence = lines.filter((l) => l.startsWith("[fim]") && l.includes("42") && l.includes("99"));
  assert.strictEqual(evidence.length, 1, `empty round trip must log ttft/total, got: ${JSON.stringify(lines)}`);
  svc.dispose();
});

// ---- F6a: blank-line scope anchor

test("cursor at column 0 on a blank line inside a block still scope-limits to the block", async () => {
  const g = makeGenerate("finish(step);\nfunction escape() {");
  const svc = new CompletionService(cfg(), g.fn);
  // Cursor on the empty line after "  a();": currentLinePrefix is blank, so
  // the scope anchor must fall back to the nearest non-blank line above.
  const out = await svc.complete({ prefix: "function f() {\n  a();\n", suffix: "\n}\n", manual: true });
  assert.ok(out, "in-scope first line survives");
  assert.strictEqual(out.text, "finish(step);", "top-level escape line cut via the fallback anchor");
  svc.dispose();
});

// ---- F9: joiner abort honored

test("a single-flight joiner whose signal aborts resolves undefined; the initiator is unaffected", async () => {
  const g = makeHangingGenerate("shared()");
  const svc = new CompletionService(cfg(), g.fn);
  const req = { prefix: "p", suffix: "s", manual: true };
  const c1 = svc.complete(req);
  await g.called();
  const ac = new AbortController();
  const c2 = svc.complete(req, ac.signal);
  await sleep(10);
  ac.abort();
  await sleep(10);
  g.release();
  const [r1, r2] = await Promise.all([c1, c2]);
  assert.ok(r1, "initiator completes");
  assert.strictEqual(r1.text, "shared()");
  assert.strictEqual(r2, undefined, "aborted joiner resolves undefined");
  assert.ok(!g.calls[0].signal.aborted, "initiator's request was not aborted by the joiner");
  svc.dispose();
});

test("a joiner whose signal is already aborted at join time resolves undefined immediately", async () => {
  const g = makeHangingGenerate("shared()");
  const svc = new CompletionService(cfg(), g.fn);
  const req = { prefix: "p", suffix: "s", manual: true };
  const c1 = svc.complete(req);
  await g.called();
  const ac = new AbortController();
  ac.abort();
  const r2 = await svc.complete(req, ac.signal);
  assert.strictEqual(r2, undefined);
  g.release();
  assert.ok(await c1, "initiator still completes");
  svc.dispose();
});

// ---- F19: memory and lookup cost bounded independent of document size

test("2MB document: walk hits while typing through still work with bounded keys", async () => {
  const completion = "function add(a, b) { return a + b; }";
  const g = makeGenerate(completion);
  const svc = new CompletionService(cfg({ prefixChars: 200, suffixChars: 100 }), g.fn);
  const bigDoc = "const filler = 1;\n".repeat(120000); // ~2MB
  const suffix = "\n// end\n";
  const first = await svc.complete({ prefix: bigDoc + "seed();\n", suffix, manual: true });
  assert.strictEqual(first.text, completion);
  for (const typedLen of [1, 7, 20]) {
    const hit = await svc.complete({ prefix: bigDoc + "seed();\n" + completion.slice(0, typedLen), suffix, manual: true });
    assert.ok(hit && hit.fromCache, `walk hit at ${typedLen} typed chars on a 2MB doc`);
    assert.strictEqual(hit.text, completion.slice(typedLen));
  }
  assert.strictEqual(g.calls.length, 1, "zero extra generate calls");
  svc.dispose();
});

test("2MB document: miss-path lookup cost is bounded (no document-sized work per call)", async () => {
  // The budget is absolute and it is 5ms, and both of those were arrived at the
  // hard way. Measured, over three local runs: a healthy 2MB call is 0.73-0.82ms
  // and a small-document call is 0.042ms. That is an 18x ratio WHEN NOTHING IS
  // WRONG, because the small-doc figure is fixed overhead and nearly zero, so a
  // ratio test compares against noise. A 10x ratio budget was tried and it failed
  // on exactly that. The separation this row actually has is absolute: the
  // regression it catches slices the whole document per call and measured ~13ms,
  // against well under 1ms healthy. 5ms sits between them with real headroom on
  // both sides, including the 2.06ms a loaded CI runner produced.
  // The concatenation is built OUTSIDE the timed region, per call. Building
  // `doc + probe${i}` is itself document-sized work, and with it inside the
  // timer the row measured its own string handling: on CI that read 2.06ms
  // against a 0.14ms small-doc baseline, a 15x ratio with a bounded product
  // underneath it. The claim is about what the SERVICE does with a large
  // prefix, so only the call is timed.
  const timeMisses = async (doc, tag) => {
    const g = makeGenerate("x()");
    const svc = new CompletionService(cfg({ prefixChars: 3000, suffixChars: 1000 }), g.fn);
    await svc.complete({ prefix: doc + "warm", suffix: ";", manual: true }); // JIT + string warm
    let total = 0n;
    for (let i = 0; i < 50; i++) {
      const prefix = doc + `probe${i}${tag} = `;
      const t = process.hrtime.bigint();
      await svc.complete({ prefix, suffix: ";", manual: true });
      total += process.hrtime.bigint() - t;
    }
    const avg = Number(total) / 1e6 / 50;
    svc.dispose();
    return avg;
  };

  const smallAvg = await timeMisses("const filler = 1;\n".repeat(20), "s");
  const bigAvg = await timeMisses("const filler = 1;\n".repeat(120000), "b"); // ~2MB

  assert.ok(
    bigAvg < 5,
    `2MB miss-path ${bigAvg.toFixed(2)}ms/call must be bounded (< 5ms); ` +
      `small-doc baseline was ${smallAvg.toFixed(2)}ms/call, and the regression this catches is ~13ms`
  );
});
