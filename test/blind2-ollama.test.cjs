// Blind oracle: instruct-generate client contract (phase2-surface.md
// "src/core/ollama.ts (additions)"). Drives generateInstruct against an
// in-process fake server speaking ollama's newline-delimited JSON, same
// pattern as the phase-1 blind-ollama set. Written against the surface doc
// only; never read src/**. Expected red while stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind2-ollama",
  `export { generateInstruct } from "../src/core/ollama";\n`
);
const { generateInstruct } = mod;
test.after(cleanup);

function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, url: req.url, body });
      handler(req, res, body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        apiBase: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function ndjson(res, lines) {
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  for (const l of lines) res.write(JSON.stringify(l) + "\n");
  res.end();
}

const PARAMS = {
  model: "qwen3-coder:30b",
  prompt: "Implement the function below.\n\n```rust\nfn add(a: i32, b: i32) -> i32\n```",
  maxTokens: 512,
  temperature: 0.2,
};

test("call shape without numGpu: one POST to /api/generate, prompt verbatim, num_gpu absent, no suffix/raw/system [surface: ollama 'Call shape' + 'num_gpu appears in options only when numGpu is set']", async (t) => {
  const srv = await startServer((req, res) =>
    ndjson(res, [{ response: "fn add" }, { response: "", done: true }])
  );
  t.after(srv.close);

  await generateInstruct({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal });

  assert.strictEqual(srv.requests.length, 1, "exactly one request");
  const { method, url, body } = srv.requests[0];
  assert.strictEqual(method, "POST");
  assert.strictEqual(url, "/api/generate");
  assert.strictEqual(body.model, PARAMS.model);
  assert.strictEqual(body.prompt, PARAMS.prompt, "prompt passes through untouched; the chat template is ollama's job");
  assert.strictEqual(body.stream, true);
  assert.strictEqual(body.keep_alive, 1800);
  assert.deepStrictEqual(body.options, { num_predict: 512, temperature: 0.2 }, "options carries exactly num_predict and temperature when numGpu unset");
  assert.strictEqual(body.suffix, undefined, "no suffix: that flips ollama into FIM templating");
  assert.strictEqual(body.raw, undefined, "no raw");
  assert.strictEqual(body.system, undefined, "no system field");
});

test("call shape with numGpu: options carries num_gpu [surface: ollama additions body listing]", async (t) => {
  const srv = await startServer((req, res) =>
    ndjson(res, [{ response: "x" }, { response: "", done: true }])
  );
  t.after(srv.close);

  await generateInstruct({ ...PARAMS, apiBase: srv.apiBase, numGpu: 30, signal: new AbortController().signal });
  assert.deepStrictEqual(srv.requests[0].body.options, { num_predict: 512, temperature: 0.2, num_gpu: 30 });
});

test("streaming: text concatenates response chunks; ttftMs at first non-empty chunk; totalMs at the done line [surface: 'Streaming, timing, and errors follow the phase-1 generateFim contract exactly']", async (t) => {
  const srv = await startServer(async (req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ response: "" }) + "\n"); // empty chunk: not TTFT
    await sleep(60);
    res.write(JSON.stringify({ response: "fn ad" }) + "\n");
    res.write(JSON.stringify({ response: "d()" }) + "\n");
    await sleep(30);
    res.write(JSON.stringify({ response: "", done: true }) + "\n");
    res.end();
  });
  t.after(srv.close);

  const out = await generateInstruct({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal });
  assert.strictEqual(out.text, "fn add()");
  assert.ok(out.ttftMs >= 40, `ttftMs at first non-empty chunk, got ${out.ttftMs}`);
  assert.ok(out.totalMs >= out.ttftMs + 20, `totalMs at done line, got ${out.totalMs}`);
});

test("onChunk receives every raw content chunk in arrival order; their concatenation equals text [surface: ollama 'onChunk, when given']", async (t) => {
  const srv = await startServer((req, res) =>
    ndjson(res, [
      { response: "fn " },
      { response: "main" },
      { response: "() {}" },
      { response: "", done: true },
    ])
  );
  t.after(srv.close);

  const received = [];
  const out = await generateInstruct({
    ...PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    onChunk: (c) => received.push(c),
  });
  // Whether empty chunks are delivered is unspecified; assert on the
  // non-empty sequence and on the promised concatenation identity.
  assert.deepStrictEqual(received.filter((c) => c !== ""), ["fn ", "main", "() {}"]);
  assert.strictEqual(received.join(""), out.text, "concatenation of delivered chunks equals text");
});

test("non-2xx rejects with the status or error text in the message [surface: phase-1 error contract]", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "boom" }));
  });
  t.after(srv.close);

  await assert.rejects(
    generateInstruct({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal }),
    (err) => err instanceof Error && /500|boom/.test(err.message)
  );
});

test("a streamed ollama error field rejects with that text [surface: phase-1 error contract]", async (t) => {
  const srv = await startServer((req, res) => ndjson(res, [{ error: "model 'nope' not found" }]));
  t.after(srv.close);

  await assert.rejects(
    generateInstruct({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal }),
    (err) => err instanceof Error && err.message.includes("model 'nope' not found")
  );
});

test("abort rejects with an abort error and no chunk is delivered after the signal aborts [surface: ollama 'No chunk is delivered after the signal aborts']", async (t) => {
  let timer;
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ response: "first" }) + "\n");
    timer = setInterval(() => {
      try {
        res.write(JSON.stringify({ response: "more" }) + "\n");
      } catch {
        clearInterval(timer);
      }
    }, 15);
    res.on("close", () => clearInterval(timer));
  });
  t.after(() => {
    clearInterval(timer);
    return srv.close();
  });

  const ac = new AbortController();
  const received = [];
  const p = generateInstruct({
    ...PARAMS,
    apiBase: srv.apiBase,
    signal: ac.signal,
    onChunk: (c) => {
      assert.strictEqual(ac.signal.aborted, false, "chunk delivered after abort");
      received.push(c);
      if (received.length === 1) ac.abort();
    },
  });
  await assert.rejects(p, (err) => /abort/i.test(String(err.name) + String(err.message)));
  const countAtReject = received.length;
  await sleep(120); // server keeps streaming; nothing more may arrive
  assert.strictEqual(received.length, countAtReject, "no chunk after the rejection either");
});
