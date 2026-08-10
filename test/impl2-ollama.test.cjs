// Implementer oracle: generateInstruct stream mechanics the blind set cannot
// pin down — JSON lines split across TCP reads, several lines in one read
// with an abort fired inside an earlier line's onChunk, a done line that
// still carries response text, empty-chunk delivery policy, and malformed
// stream lines. Complements test/blind2-ollama.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl2-ollama",
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

const PARAMS = {
  model: "m",
  prompt: "p",
  maxTokens: 32,
  temperature: 0.1,
};

test("a JSON line split across two TCP writes reassembles into one chunk", async (t) => {
  const line = JSON.stringify({ response: "hello world" }) + "\n";
  const srv = await startServer(async (req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(line.slice(0, 9));
    await sleep(20);
    res.write(line.slice(9));
    res.write(JSON.stringify({ response: "", done: true }) + "\n");
    res.end();
  });
  t.after(srv.close);

  const received = [];
  const out = await generateInstruct({
    ...PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    onChunk: (c) => received.push(c),
  });
  assert.strictEqual(out.text, "hello world");
  assert.deepStrictEqual(received, ["hello world"], "partial JSON is never surfaced as a chunk");
});

test("empty response chunks are not delivered to onChunk at all (delivery policy is: non-empty only)", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    for (const l of [{ response: "" }, { response: "a" }, { response: "" }, { response: "b" }, { response: "", done: true }]) {
      res.write(JSON.stringify(l) + "\n");
    }
    res.end();
  });
  t.after(srv.close);

  const received = [];
  const out = await generateInstruct({
    ...PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    onChunk: (c) => received.push(c),
  });
  assert.deepStrictEqual(received, ["a", "b"]);
  assert.strictEqual(out.text, "ab");
});

test("abort inside onChunk stops delivery for LATER lines of the SAME read batch", async (t) => {
  // All three content lines arrive in one TCP write; the first delivery
  // aborts. Without a per-line signal check the remaining buffered lines
  // would still be delivered.
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(
      JSON.stringify({ response: "one" }) + "\n" +
      JSON.stringify({ response: "two" }) + "\n" +
      JSON.stringify({ response: "three" }) + "\n"
    );
    // Keep the stream open so only the abort can end the request.
  });
  t.after(srv.close);

  const ac = new AbortController();
  const received = [];
  await assert.rejects(
    generateInstruct({
      ...PARAMS,
      apiBase: srv.apiBase,
      signal: ac.signal,
      onChunk: (c) => {
        received.push(c);
        ac.abort();
      },
    }),
    (err) => /abort/i.test(String(err.name) + String(err.message))
  );
  assert.deepStrictEqual(received, ["one"], "batch siblings after the aborting chunk are suppressed");
});

test("a done line that carries response text still contributes that text and sets totalMs", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ response: "head " }) + "\n");
    res.write(JSON.stringify({ response: "tail", done: true }) + "\n");
    res.end();
  });
  t.after(srv.close);

  const received = [];
  const out = await generateInstruct({
    ...PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    onChunk: (c) => received.push(c),
  });
  assert.strictEqual(out.text, "head tail");
  assert.deepStrictEqual(received, ["head ", "tail"]);
  assert.ok(out.totalMs >= 0);
});

test("stream with no content chunks at all resolves empty text with fallback timings, never NaN", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ response: "", done: true }) + "\n");
    res.end();
  });
  t.after(srv.close);

  const out = await generateInstruct({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal });
  assert.strictEqual(out.text, "");
  assert.ok(Number.isFinite(out.ttftMs) && out.ttftMs >= 0);
  assert.ok(Number.isFinite(out.totalMs) && out.totalMs >= out.ttftMs);
});

test("a malformed (non-JSON) stream line rejects instead of silently dropping data", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write("this is not json\n");
    res.end();
  });
  t.after(srv.close);

  await assert.rejects(generateInstruct({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal }));
});

test("options.num_gpu key is entirely absent from the wire when numGpu is unset (not present-as-null)", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ response: "x", done: true }) + "\n");
    res.end();
  });
  t.after(srv.close);

  await generateInstruct({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(srv.requests[0].body.options, "num_gpu"), false);
});

test("apiBase with a trailing slash resolves to the same /api/generate path", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ response: "x", done: true }) + "\n");
    res.end();
  });
  t.after(srv.close);

  await generateInstruct({ ...PARAMS, apiBase: srv.apiBase + "/", signal: new AbortController().signal });
  assert.strictEqual(srv.requests[0].url, "/api/generate");
});

// ---- P2-F4: done_reason surfacing (truncation detection needs it)

test("P2-F4: done_reason from the done line is surfaced as doneReason on the result", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ response: "fn f() {" }) + "\n");
    res.write(JSON.stringify({ response: "", done: true, done_reason: "length" }) + "\n");
    res.end();
  });
  t.after(srv.close);

  const out = await generateInstruct({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal });
  assert.strictEqual(out.doneReason, "length");
});

test("P2-F4: a normal stop leaves doneReason as the server's value ('stop'), absent field as undefined", async (t) => {
  let call = 0;
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ response: "x" }) + "\n");
    res.write(JSON.stringify(call++ === 0 ? { response: "", done: true, done_reason: "stop" } : { response: "", done: true }) + "\n");
    res.end();
  });
  t.after(srv.close);

  const first = await generateInstruct({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal });
  assert.strictEqual(first.doneReason, "stop");
  const second = await generateInstruct({ ...PARAMS, apiBase: srv.apiBase, signal: new AbortController().signal });
  assert.strictEqual(second.doneReason, undefined);
});
