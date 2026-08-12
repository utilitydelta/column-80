// Blind oracle: cloud instruct client contract (src/core/cloudInstruct.ts).
// Drives makeCloudInstruct against an in-process fake server that speaks the
// OpenAI-compatible SSE chat-completions stream, so the call shape, streaming
// semantics, and error/abort contract are testable without a real provider or
// an API key. Written against the InstructGenerateFn seam the local ollama
// client also fills; the two must stay interchangeable.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-cloud-instruct",
  `export { makeCloudInstruct, CLOUD_PROVIDERS, OPENAI_COMPATIBLE } from "../src/core/cloudInstruct";\n`
);
const { makeCloudInstruct, CLOUD_PROVIDERS, OPENAI_COMPATIBLE } = mod;
test.after(cleanup);

// handler(req, res, body) drives the response. Returns { baseUrl, requests }.
function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// One OpenAI-style SSE frame per delta object, then the [DONE] sentinel.
function sse(res, frames) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

const contentFrame = (content, finish_reason = null) => ({
  choices: [{ delta: content ? { content } : {}, finish_reason }],
});

const PARAMS = {
  apiBase: "unused-for-cloud",
  model: "some-frontier-model",
  prompt: "// write the body\nfn add(a: i32, b: i32) -> i32",
  maxTokens: 512,
  temperature: 0.2,
};

const run = (baseUrl, extra = {}) =>
  makeCloudInstruct({ baseUrl, apiKey: "sk-test-key" })({
    ...PARAMS,
    signal: new AbortController().signal,
    ...extra,
  });

test("call shape: one POST to /chat/completions with Bearer auth and the OpenAI body [seam: InstructGenerateFn over chat-completions]", async (t) => {
  const srv = await startServer((req, res) => sse(res, [contentFrame("a + b", "stop")]));
  t.after(srv.close);

  await run(srv.baseUrl);

  assert.strictEqual(srv.requests.length, 1, "exactly one request");
  const { method, url, headers, body } = srv.requests[0];
  assert.strictEqual(method, "POST");
  assert.strictEqual(url, "/v1/chat/completions", "path hangs off the base URL");
  assert.strictEqual(headers.authorization, "Bearer sk-test-key", "key travels as a Bearer token");
  assert.strictEqual(body.model, PARAMS.model);
  assert.strictEqual(body.stream, true);
  assert.strictEqual(body.max_tokens, 512);
  assert.strictEqual(body.temperature, 0.2);
  assert.deepStrictEqual(body.messages, [{ role: "user", content: PARAMS.prompt }], "prompt is one user turn, no system message");
});

test("base URL with a path is preserved: gemini-style /v1beta/openai keeps its path [surface: compat endpoints]", async (t) => {
  const srv = await startServer((req, res) => sse(res, [contentFrame("x", "stop")]));
  t.after(srv.close);
  // Simulate a nested base by pointing at /v1beta/openai on the fake host.
  const nested = srv.baseUrl.replace(/\/v1$/, "/v1beta/openai");
  await makeCloudInstruct({ baseUrl: nested, apiKey: "k" })({ ...PARAMS, signal: new AbortController().signal });
  assert.strictEqual(srv.requests[0].url, "/v1beta/openai/chat/completions");
});

test("streaming: content deltas concatenate; ttftMs at first non-empty; totalMs after the stream; onChunk sees each delta", async (t) => {
  const srv = await startServer(async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify(contentFrame(""))}\n\n`); // empty delta: not TTFT
    await sleep(60);
    res.write(`data: ${JSON.stringify(contentFrame("hel"))}\n\n`);
    res.write(`data: ${JSON.stringify(contentFrame("lo"))}\n\n`);
    await sleep(30);
    res.write(`data: ${JSON.stringify(contentFrame("", "stop"))}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
  t.after(srv.close);

  const chunks = [];
  const out = await run(srv.baseUrl, { onChunk: (c) => chunks.push(c) });
  assert.strictEqual(out.text, "hello", "text is the concatenation of content deltas");
  assert.deepStrictEqual(chunks, ["hel", "lo"], "onChunk gets non-empty deltas in order");
  assert.ok(out.ttftMs >= 40, `ttftMs measured at first non-empty delta, got ${out.ttftMs}`);
  assert.ok(out.totalMs >= out.ttftMs + 20, `totalMs after the stream, got ${out.totalMs}`);
});

test("finish_reason length maps onto doneReason 'length' so the fn-gen truncation guard fires [invariant: one guard, both backends]", async (t) => {
  const srv = await startServer((req, res) => sse(res, [contentFrame("half a fn", "length")]));
  t.after(srv.close);

  const out = await run(srv.baseUrl);
  assert.strictEqual(out.doneReason, "length");
});

test("finish_reason stop passes through untranslated", async (t) => {
  const srv = await startServer((req, res) => sse(res, [contentFrame("done", "stop")]));
  t.after(srv.close);
  const out = await run(srv.baseUrl);
  assert.strictEqual(out.doneReason, "stop");
});

test("rejects on non-2xx with the status and the provider's error body [actionable: invalid key / unknown model]", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid api key" } }));
  });
  t.after(srv.close);

  await assert.rejects(run(srv.baseUrl), (err) => err instanceof Error && /401/.test(err.message) && /invalid api key/.test(err.message));
});

// gpt-5 / o-series reject `max_tokens` and `temperature`. The client must learn
// that from the 400 rather than from a model-id list, and must not lose the
// generation over it.
const unsupported = (res, param, code) => {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: {
        message: `Unsupported parameter: '${param}' is not supported with this model.`,
        type: "invalid_request_error",
        param,
        code,
      },
    })
  );
};

test("400 naming max_tokens is retried as max_completion_tokens [surface: gpt-5 / o-series]", async (t) => {
  const srv = await startServer((req, res, body) => {
    if ("max_tokens" in body) return unsupported(res, "max_tokens", "unsupported_parameter");
    sse(res, [contentFrame("a + b", "stop")]);
  });
  t.after(srv.close);

  const out = await run(srv.baseUrl, { model: "reasoning-era-model" });
  assert.strictEqual(out.text, "a + b", "the generation survives the renamed param");
  assert.strictEqual(srv.requests.length, 2, "one rejected probe, one accepted request");
  const retry = srv.requests[1].body;
  assert.strictEqual(retry.max_completion_tokens, 512);
  assert.ok(!("max_tokens" in retry), "the old name is gone, not duplicated");
});

test("400 naming temperature drops it and retries [surface: models that pin their own sampling]", async (t) => {
  const srv = await startServer((req, res, body) => {
    if ("temperature" in body) return unsupported(res, "temperature", "unsupported_value");
    sse(res, [contentFrame("body", "stop")]);
  });
  t.after(srv.close);

  const out = await run(srv.baseUrl, { model: "fixed-sampling-model" });
  assert.strictEqual(out.text, "body");
  assert.ok(!("temperature" in srv.requests[1].body), "temperature left to the provider default");
});

test("both quirks at once are learned in sequence, then remembered for later calls [cost: one probe, paid once]", async (t) => {
  const srv = await startServer((req, res, body) => {
    if ("max_tokens" in body) return unsupported(res, "max_tokens", "unsupported_parameter");
    if ("temperature" in body) return unsupported(res, "temperature", "unsupported_value");
    sse(res, [contentFrame("ok", "stop")]);
  });
  t.after(srv.close);

  const model = `learned-model-${Date.now()}`;
  assert.strictEqual((await run(srv.baseUrl, { model })).text, "ok");
  assert.strictEqual(srv.requests.length, 3, "two rejections, then the accepted shape");

  assert.strictEqual((await run(srv.baseUrl, { model })).text, "ok");
  assert.strictEqual(srv.requests.length, 4, "the second call goes out in the learned shape directly");
});

test("a 400 this client cannot adapt to is raised, not retried [invariant: no blind retry loop]", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "model not found", param: "model" } }));
  });
  t.after(srv.close);

  await assert.rejects(run(srv.baseUrl), (err) => /400/.test(err.message) && /model not found/.test(err.message));
  assert.strictEqual(srv.requests.length, 1, "exactly one attempt");
});

test("abort via signal rejects with an abort error", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify(contentFrame("hel"))}\n\n`);
    // never finishes
  });
  t.after(srv.close);

  const ac = new AbortController();
  const p = makeCloudInstruct({ baseUrl: srv.baseUrl, apiKey: "k" })({ ...PARAMS, signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, (err) => /abort/i.test(String(err.name) + String(err.message)));
});

test("provider presets carry a base URL and no model id (ids stay the user's setting)", () => {
  for (const id of ["openai", "anthropic", "xai", "gemini"]) {
    const p = CLOUD_PROVIDERS[id];
    assert.ok(p && /^https:\/\//.test(p.baseUrl), `${id} has an https base URL`);
    assert.ok(!("defaultModel" in p) && !("model" in p), `${id} pins no model id`);
  }
  assert.strictEqual(OPENAI_COMPATIBLE, "openai-compatible");
});
