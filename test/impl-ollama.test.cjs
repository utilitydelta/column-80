// Implementer oracle: ollama client stream-parsing edges beyond the blind
// contract set — chunk boundaries that split or batch NDJSON lines, a final
// line with no trailing newline, apiBase normalization, tag filtering.
// Complements test/blind-ollama.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-ollama",
  `export { generateFim, listModels } from "../src/core/ollama";\n`
);
const { generateFim, listModels } = mod;
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
  prefix: "p",
  suffix: "s",
  maxTokens: 8,
  temperature: 0,
};
const withBase = (apiBase) => ({ ...PARAMS, apiBase, signal: new AbortController().signal });

test("final done line without a trailing newline is still parsed", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ response: "ok" }) + "\n");
    res.end(JSON.stringify({ response: "", done: true })); // no \n
  });
  t.after(srv.close);
  const out = await generateFim(withBase(srv.apiBase));
  assert.strictEqual(out.text, "ok");
  assert.ok(out.totalMs >= 0, "done line honored for totalMs");
});

test("several NDJSON lines arriving in one TCP chunk all count", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end(
      JSON.stringify({ response: "a" }) + "\n" +
      JSON.stringify({ response: "b" }) + "\n" +
      JSON.stringify({ response: "c", done: true }) + "\n"
    );
  });
  t.after(srv.close);
  const out = await generateFim(withBase(srv.apiBase));
  assert.strictEqual(out.text, "abc");
});

test("a JSON line split across TCP chunks reassembles", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    const line = JSON.stringify({ response: "spanning" }) + "\n";
    res.write(line.slice(0, 10));
    setTimeout(() => {
      res.write(line.slice(10));
      res.end(JSON.stringify({ response: "", done: true }) + "\n");
    }, 20);
  });
  t.after(srv.close);
  const out = await generateFim(withBase(srv.apiBase));
  assert.strictEqual(out.text, "spanning");
});

test("apiBase with a trailing slash resolves to the same endpoint", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end(JSON.stringify({ response: "x", done: true }) + "\n");
  });
  t.after(srv.close);
  await generateFim(withBase(srv.apiBase + "/"));
  assert.strictEqual(srv.requests[0].url, "/api/generate");
});

test("done:true carried on a content line still counts that content", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end(JSON.stringify({ response: "tail", done: true }) + "\n");
  });
  t.after(srv.close);
  const out = await generateFim(withBase(srv.apiBase));
  assert.strictEqual(out.text, "tail");
  assert.ok(out.ttftMs <= out.totalMs);
});

test("listModels drops entries with missing or empty names", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "good:1b" }, {}, { name: "" }] }));
  });
  t.after(srv.close);
  assert.deepStrictEqual(await listModels(srv.apiBase), ["good:1b"]);
});

test("listModels returns undefined on malformed JSON, never throws", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("not json");
  });
  t.after(srv.close);
  assert.strictEqual(await listModels(srv.apiBase), undefined);
});
