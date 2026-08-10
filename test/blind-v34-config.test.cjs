// Blind oracle: the serving-window and reasoning config the v34 scout left
// uncommitted (session-v34/goal.md, "Already changed, uncommitted, needs
// ratifying or reverting"). That section is the whole contract for this file:
// maxTokens 2048, testMaxTokens 8192, numCtx 16384, and a `think` field,
// because ollama's unset default of 2048 bounds prompt and generation together
// and a model that reasons by default spends the answer's budget on the trace.
//
// Black box only. Nothing here reads src/core/config.ts, src/core/ollama.ts or
// src/vscode/config.ts; esbuild resolves them at bundle time. Anything the
// contract does not state is not tested.
//
// Run: SKIP_LIVE=1 node --test test/blind-v34-config.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { bundleCore } = require("./.blind-util.cjs");
const { bundleWithVscodeStub } = require("./.vscode-stub.cjs");

const core = bundleCore(
  "blind-v34-config",
  `export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";
export { generateInstruct } from "../src/core/ollama";\n`
);
const { DEFAULT_FNGEN_CONFIG, generateInstruct } = core.mod;

const vs = bundleWithVscodeStub(
  "blind-v34-vscode",
  `export { readFnGenConfig } from "../src/vscode/config";\n`
);
const { readFnGenConfig } = vs.mod;

test.after(() => {
  core.cleanup();
  vs.cleanup();
});

// ---- fake ollama, same in-process NDJSON server the phase-2 ollama oracle uses

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
  prompt: "Implement the function below.\n\nfn add(a: i32, b: i32) -> i32",
  maxTokens: 2048,
  temperature: 0.2,
};

// Runs one generation against the fake server and hands back the request body.
async function bodyFor(t, extra) {
  const srv = await startServer((req, res) =>
    ndjson(res, [{ response: "fn add" }, { response: "", done: true }])
  );
  t.after(srv.close);
  await generateInstruct({
    ...PARAMS,
    ...extra,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
  });
  assert.equal(srv.requests.length, 1, "exactly one request");
  return srv.requests[0].body;
}

// ---- defaults [contract: "maxTokens 512 to 2048 and testMaxTokens 2048 to 8192",
//      "numCtx: 16384, which had never been set at all"]

// 512 output tokens rejected every one of the 15 truncated generations, and an
// unset num_ctx capped three prompts carrying 12.9KB, 13.1KB and 15.0KB of
// surface at 2050 prompt tokens without saying so. These three numbers are the
// whole ratification, so pin them.
test("DEFAULT_FNGEN_CONFIG carries the raised budgets and the explicit context window", () => {
  assert.equal(DEFAULT_FNGEN_CONFIG.maxTokens, 2048);
  assert.equal(DEFAULT_FNGEN_CONFIG.testMaxTokens, 8192);
  assert.equal(DEFAULT_FNGEN_CONFIG.numCtx, 16384);
});

// ---- num_ctx on the wire [contract: ollama's default is 2048 and it bounds the
//      prompt AND the generation together]

// An absent num_ctx is not a neutral default, it is silent truncation at 2048.
// So the value has to reach the request body, under ollama's own option name.
test("generateInstruct sends num_ctx in options when numCtx is set", async (t) => {
  const body = await bodyFor(t, { numCtx: 16384 });
  assert.equal(body.options.num_ctx, 16384);
});

// The mirror row. A caller that passes no numCtx must not have a num_ctx key
// invented for it, and the value must not land somewhere ollama ignores.
test("generateInstruct omits num_ctx entirely when numCtx is unset", async (t) => {
  const body = await bodyFor(t, {});
  assert.ok(!("num_ctx" in body.options), `num_ctx must be key-absent, got options ${JSON.stringify(body.options)}`);
});

// ---- think on the wire [contract: "`think` config field. qwen3.6:27b reasons by
//      default and spent all 2048 output tokens on the trace"]

// think is an ollama request field, not a sampling option. Put it in options and
// ollama drops it, the model reasons anyway, and every generation comes back
// truncated with no code in it.
test("generateInstruct sends think at the top level of the body, not inside options", async (t) => {
  const body = await bodyFor(t, { think: true });
  assert.equal(body.think, true);
  assert.ok(!("think" in body.options), `think belongs at the top level, got options ${JSON.stringify(body.options)}`);
});

// The row that matters. think: false is the value that stops the reasoning
// trace eating the answer's budget, and it is exactly the value a truthiness
// guard drops on the floor.
test("think: false survives to the request body", async (t) => {
  const body = await bodyFor(t, { think: false });
  assert.ok("think" in body, `think: false must reach the body, got ${JSON.stringify(body)}`);
  assert.equal(body.think, false);
});

test("generateInstruct omits think entirely when it is unset", async (t) => {
  const body = await bodyFor(t, {});
  assert.ok(!("think" in body), `think must be key-absent when unset, got ${JSON.stringify(body)}`);
});

// ---- the output budget still travels [contract: maxTokens is the generation half
//      of the same window]

test("num_predict equals the maxTokens passed", async (t) => {
  const body = await bodyFor(t, { maxTokens: 8192 });
  assert.equal(body.options.num_predict, 8192);
});

// ---- the settings layer [contract: the config the product actually builds is the
//      one that has to carry these]

// A default that never reaches readFnGenConfig's output is a default that never
// reaches ollama, and the silent 2048 comes straight back.
test("readFnGenConfig propagates numCtx into the config it returns", () => {
  assert.equal(vs.error, undefined, `bundle failed: ${vs.error && vs.error.message}`);
  assert.equal(readFnGenConfig().numCtx, 16384);
});

// Repo discipline: an unset optional field is KEY-ABSENT, not value-undefined.
// Configs are compared with deepStrictEqual, which tells the two apart, so a
// stray `think: undefined` breaks equality rows elsewhere.
test("readFnGenConfig leaves think key-absent when nothing configures it", () => {
  assert.equal(vs.error, undefined, `bundle failed: ${vs.error && vs.error.message}`);
  const config = readFnGenConfig();
  assert.ok(!("think" in config), `key-absent discipline: got ${JSON.stringify(config)}`);
});
