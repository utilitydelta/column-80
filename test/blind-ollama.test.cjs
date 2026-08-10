// Blind oracle: ollama client contract (phase1-surface.md "src/core/ollama.ts").
// Drives generateFim/listModels against an in-process fake HTTP server that
// speaks ollama's newline-delimited JSON, so the promised call shape and
// streaming semantics are testable without a live model. Written against the
// surface doc only; never read src/**. Expected red while stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-ollama",
  `export { generateFim, listModels } from "../src/core/ollama";\n`
);
const { generateFim, listModels } = mod;
test.after(cleanup);

// Starts a fake server; handler(req, res, body) drives the response.
// Returns { apiBase, requests, close }.
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
  model: "qwen2.5-coder:1.5b-base",
  prefix: "function add(a, b) {\n  return ",
  suffix: ";\n}\n",
  maxTokens: 64,
  temperature: 0.01,
};

test("generateFim call shape: one POST to /api/generate with the promised JSON body, prompt is the raw prefix [surface: ollama 'Call shape' + 'No raw: true']", async (t) => {
  const srv = await startServer((req, res) =>
    ndjson(res, [{ response: "a + b" }, { response: "", done: true }])
  );
  t.after(srv.close);

  await generateFim({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal });

  assert.strictEqual(srv.requests.length, 1, "exactly one request");
  const { method, url, body } = srv.requests[0];
  assert.strictEqual(method, "POST");
  assert.strictEqual(url, "/api/generate");
  assert.strictEqual(body.model, PARAMS.model);
  assert.strictEqual(body.prompt, PARAMS.prefix, "prompt is the prefix, untemplated");
  assert.strictEqual(body.suffix, PARAMS.suffix);
  assert.strictEqual(body.stream, true);
  assert.strictEqual(body.keep_alive, 1800);
  assert.deepStrictEqual(body.options, { num_predict: 64, temperature: 0.01 });
  assert.ok(!body.prompt.includes("<|fim"), "client never builds FIM template tokens");
  assert.strictEqual(body.raw, undefined, "no raw: true");
});

test("generateFim streaming: text concatenates chunks; ttftMs at first non-empty chunk; totalMs at done [surface: ollama 'Streaming semantics']", async (t) => {
  const srv = await startServer(async (req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ response: "" }) + "\n"); // empty chunk: not TTFT
    await sleep(60);
    res.write(JSON.stringify({ response: "hel" }) + "\n");
    res.write(JSON.stringify({ response: "lo" }) + "\n");
    await sleep(30);
    res.write(JSON.stringify({ response: "", done: true }) + "\n");
    res.end();
  });
  t.after(srv.close);

  const out = await generateFim({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal });
  assert.strictEqual(out.text, "hello", "text is the concatenation of response chunks");
  assert.ok(out.ttftMs >= 40, `ttftMs measured at first non-empty chunk, got ${out.ttftMs}`);
  assert.ok(out.totalMs >= out.ttftMs + 20, `totalMs at done line, got ${out.totalMs}`);
});

test("generateFim rejects on non-2xx with the status or error text in the message [surface: ollama 'Errors']", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "boom" }));
  });
  t.after(srv.close);

  await assert.rejects(
    generateFim({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal }),
    (err) => err instanceof Error && /500|boom/.test(err.message)
  );
});

test("generateFim rejects when a streamed line carries an ollama error field [surface: ollama 'or an ollama error field rejects']", async (t) => {
  const srv = await startServer((req, res) =>
    ndjson(res, [{ error: "model 'nope' not found" }])
  );
  t.after(srv.close);

  await assert.rejects(
    generateFim({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal }),
    (err) => err instanceof Error && err.message.includes("model 'nope' not found")
  );
});

test("generateFim abort via signal rejects with an abort error [surface: ollama 'Abort via signal rejects with an abort error']", async (t) => {
  // Server starts streaming but never finishes.
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ response: "hel" }) + "\n");
    // no done, no end
  });
  t.after(srv.close);

  const ac = new AbortController();
  const p = generateFim({ ...PARAMS, apiBase: srv.apiBase, signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, (err) => /abort/i.test(String(err.name) + String(err.message)));
});

test("listModels returns the installed model tags from GET /api/tags [surface: ollama listModels]", async (t) => {
  const srv = await startServer((req, res) => {
    assert.strictEqual(req.method, "GET");
    assert.strictEqual(req.url, "/api/tags");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "m1:latest" }, { name: "m2:7b" }] }));
  });
  t.after(srv.close);

  const tags = await listModels(srv.apiBase);
  assert.ok(Array.isArray(tags));
  assert.ok(tags.includes("m1:latest") && tags.includes("m2:7b"));
});

test("listModels returns undefined (never throws) on non-2xx [surface: 'returns undefined (never throws)']", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(503);
    res.end("down");
  });
  t.after(srv.close);

  assert.strictEqual(await listModels(srv.apiBase), undefined);
});

test("listModels returns undefined (never throws) when the server is unreachable [surface: 'one call answers both']", async () => {
  assert.strictEqual(await listModels("http://127.0.0.1:1"), undefined);
});
