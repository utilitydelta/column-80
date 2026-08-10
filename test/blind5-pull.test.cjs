// Blind oracle: pullModel + PullProgress (phase5-surface.md "src/core/ollama.ts
// additions: pullModel" + "Never-auto-pull, as a contract"). PullProgress
// monotonicity over synthetic event streams, pullModel HTTP behavior over a
// loopback stub server, and the headless half of never-auto-pull (required
// AbortSignal, no default-argument path). Real /api/pull traffic never happens
// under test [surface: 'Pulls are multi-GB']. Written against the surface doc
// only; never read src/**. Expected red while stubs throw.
//
// The ratify-before-request ordering and offerModelPull-as-sole-caller are the
// structural half, vscode-layer territory, asserted in the impl vscode tests
// per the surface - not blind-testable here.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind5-pull",
  `export { PullProgress, pullModel } from "../src/core/ollama";\n`
);
const { PullProgress, pullModel } = mod;
test.after(cleanup);

const MODEL = "qwen3-coder:30b";

// ---- PullProgress.note: pure state [surface: 'PullProgress.note is pure state']

test("note returns undefined while no layer size is known [surface: 'undefined while no layer size is known']", () => {
  const p = new PullProgress();
  assert.strictEqual(p.note({ status: "pulling manifest" }), undefined);
  assert.strictEqual(p.note({ status: "pulling manifest" }), undefined);
  assert.strictEqual(p.note({ digest: "sha256:aaa" }), undefined, "a digest without a total registers no layer size");
});

test("a digest event with a total registers the layer; fractions are sum-of-completed over sum-of-total [surface: 'a digest event with a total registers (or updates) that layer']", () => {
  const p = new PullProgress();
  assert.strictEqual(p.note({ digest: "sha256:aaa", total: 256 }), 0, "registered with nothing completed yet");
  assert.strictEqual(p.note({ digest: "sha256:aaa", total: 256, completed: 64 }), 64 / 256);
  assert.strictEqual(p.note({ digest: "sha256:aaa", total: 256, completed: 192 }), 192 / 256);
  assert.strictEqual(p.note({ digest: "sha256:aaa", total: 256, completed: 256 }), 1);
});

test("re-noting a digest updates that layer, never duplicates the denominator [surface: '(or updates) that layer's {total, completed}']", () => {
  const p = new PullProgress();
  p.note({ digest: "sha256:aaa", total: 256, completed: 128 });
  p.note({ digest: "sha256:aaa", total: 512, completed: 384 });
  assert.strictEqual(p.note({ digest: "sha256:aaa", total: 512, completed: 512 }), 1, "one layer of 512, fully done; a duplicated layer would cap below 1");
});

test("a new layer mid-pull grows the denominator; the return is clamped monotonic non-decreasing [surface: 'a progress bar must never run backwards']", () => {
  const p = new PullProgress();
  assert.strictEqual(p.note({ digest: "sha256:aaa", total: 256, completed: 192 }), 192 / 256);
  const onNewLayer = p.note({ digest: "sha256:bbb", total: 768, completed: 0 });
  assert.strictEqual(onNewLayer, 192 / 256, `raw 192/1024 would run backwards; got ${onNewLayer}`);
  assert.strictEqual(p.note({ digest: "sha256:bbb", total: 768, completed: 768 }), 960 / 1024, "once the raw sum passes the clamp it reports again");
  assert.strictEqual(p.note({ digest: "sha256:aaa", total: 256, completed: 256 }), 1);
  assert.strictEqual(p.note({ status: "verifying sha256 digest" }), 1, "a status-only event reports the current fraction once layers are known");
});

test("monotonic sweep: over a realistic multi-layer stream every defined return is >= its predecessor [surface: 'clamped monotonic non-decreasing']", () => {
  const p = new PullProgress();
  const stream = [
    { status: "pulling manifest" },
    { status: "pulling sha256:aaa", digest: "sha256:aaa", total: 4096, completed: 0 },
    { status: "pulling sha256:aaa", digest: "sha256:aaa", total: 4096, completed: 1024 },
    { status: "pulling sha256:aaa", digest: "sha256:aaa", total: 4096, completed: 4096 },
    { status: "pulling sha256:bbb", digest: "sha256:bbb", total: 8192, completed: 0 },
    { status: "pulling sha256:bbb", digest: "sha256:bbb", total: 8192, completed: 2048 },
    { status: "pulling sha256:ccc", digest: "sha256:ccc", total: 512, completed: 0 },
    { status: "pulling sha256:bbb", digest: "sha256:bbb", total: 8192, completed: 8192 },
    { status: "pulling sha256:ccc", digest: "sha256:ccc", total: 512, completed: 512 },
    { status: "verifying sha256 digest" },
    { status: "success" },
  ];
  let prev = -Infinity;
  let sawDefined = false;
  for (const evt of stream) {
    const r = p.note(evt);
    if (r === undefined) {
      assert.strictEqual(sawDefined, false, "undefined only before any layer size is known");
      continue;
    }
    sawDefined = true;
    assert.ok(r >= prev, `ran backwards: ${r} after ${prev} on ${JSON.stringify(evt)}`);
    assert.ok(r >= 0 && r <= 1, `fraction in [0,1], got ${r}`);
    prev = r;
  }
  assert.strictEqual(prev, 1, "the fully-pulled stream ends at 1");
});

// ---- pullModel over a loopback stub [surface: 'pullModel's HTTP behavior over a loopback stub server']

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
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, requests, base: `http://127.0.0.1:${server.address().port}` })
    )
  );
}

const ndjson = (res, events) => {
  res.writeHead(200, { "content-type": "application/x-ndjson" });
  for (const evt of events) res.write(JSON.stringify(evt) + "\n");
  res.end();
};

test("call shape: one POST to {apiBase}/api/pull with body {model, stream:true} [surface: 'Call shape']", async (t) => {
  const srv = await startServer((req, res) => ndjson(res, [{ status: "success" }]));
  t.after(() => srv.server.close());
  await pullModel(srv.base, MODEL, new AbortController().signal, () => {});
  assert.strictEqual(srv.requests.length, 1, "exactly one request");
  assert.strictEqual(srv.requests[0].method, "POST");
  assert.strictEqual(srv.requests[0].url, "/api/pull");
  assert.deepStrictEqual(srv.requests[0].body, { model: MODEL, stream: true });
});

test("every event feeds onProgress(progress.note(evt), evt.status ?? '') in stream order [surface: 'Every event is fed to onProgress']", async (t) => {
  const srv = await startServer((req, res) =>
    ndjson(res, [
      { status: "pulling manifest" },
      { status: "pulling sha256:aaa", digest: "sha256:aaa", total: 1024, completed: 0 },
      { status: "pulling sha256:aaa", digest: "sha256:aaa", total: 1024, completed: 512 },
      { digest: "sha256:aaa", total: 1024, completed: 1024 }, // no status field
      { status: "verifying sha256 digest" },
      { status: "success" },
    ])
  );
  t.after(() => srv.server.close());
  const calls = [];
  await pullModel(srv.base, MODEL, new AbortController().signal, (fraction, status) => calls.push([fraction, status]));
  assert.deepStrictEqual(calls, [
    [undefined, "pulling manifest"],
    [0, "pulling sha256:aaa"],
    [0.5, "pulling sha256:aaa"],
    [1, ""], // status absent -> "" [surface: 'evt.status ?? ""']
    [1, "verifying sha256 digest"],
    [1, "success"],
  ]);
});

test("fractions over the wire never run backwards when a layer appears mid-pull [surface: PullProgress clamp, driven through pullModel]", async (t) => {
  const srv = await startServer((req, res) =>
    ndjson(res, [
      { status: "pulling sha256:aaa", digest: "sha256:aaa", total: 256, completed: 224 },
      { status: "pulling sha256:bbb", digest: "sha256:bbb", total: 768, completed: 0 },
      { status: "pulling sha256:bbb", digest: "sha256:bbb", total: 768, completed: 768 },
      { status: "pulling sha256:aaa", digest: "sha256:aaa", total: 256, completed: 256 },
      { status: "success" },
    ])
  );
  t.after(() => srv.server.close());
  const fractions = [];
  await pullModel(srv.base, MODEL, new AbortController().signal, (fraction) => {
    if (fraction !== undefined) fractions.push(fraction);
  });
  for (let i = 1; i < fractions.length; i++) {
    assert.ok(fractions[i] >= fractions[i - 1], `progress ran backwards: ${fractions.join(", ")}`);
  }
  assert.strictEqual(fractions[fractions.length - 1], 1);
});

test("non-2xx rejects with an Error carrying the status [surface: 'Non-2xx rejects with an Error carrying the status']", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(404);
    res.end("model not found");
  });
  t.after(() => srv.server.close());
  await assert.rejects(
    pullModel(srv.base, MODEL, new AbortController().signal, () => {}),
    (err) => /404/.test(String(err.message) + String(err.status ?? "")),
    "the 404 is visible on the rejection"
  );
});

test("an event with error rejects with that text [surface: 'an event with error rejects with that text']", async (t) => {
  const srv = await startServer((req, res) =>
    ndjson(res, [
      { status: "pulling manifest" },
      { error: "pull model manifest: file does not exist" },
    ])
  );
  t.after(() => srv.server.close());
  await assert.rejects(
    pullModel(srv.base, MODEL, new AbortController().signal, () => {}),
    (err) => String(err.message).includes("pull model manifest: file does not exist")
  );
});

test("abort via the signal rejects with an abort error mid-stream [surface: 'abort via signal rejects with an abort error']", async (t) => {
  let liveRes;
  const srv = await startServer((req, res) => {
    liveRes = res;
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(JSON.stringify({ status: "pulling manifest" }) + "\n");
    // hold the stream open; the abort must end it
  });
  t.after(() => {
    if (liveRes) liveRes.destroy();
    srv.server.close();
  });
  const ac = new AbortController();
  const p = pullModel(srv.base, MODEL, ac.signal, (fraction, status) => {
    if (status === "pulling manifest") setImmediate(() => ac.abort());
  });
  await assert.rejects(p, (err) => /abort/i.test(String(err.name) + String(err.message)));
});

test("headless never-auto-pull half: the AbortSignal is required, no default-argument path [surface: 'pullModel takes a required AbortSignal and has no default-argument path']", () => {
  // Function.length counts parameters before the first default; a defaulted
  // signal (the silent-pull escape hatch) would shrink it below 4.
  assert.strictEqual(pullModel.length, 4);
});
