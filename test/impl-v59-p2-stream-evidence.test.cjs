// session-v59 phase 2: what a STREAM leaves behind (scraps S58-9 and S58-6).
//
// Both halves are about a failure that arrives inside a 200, where no HTTP
// error body ever existed and the transport-level bound never ran.
//
//   S58-9  The local arm coerced its in-stream error field with `String()`.
//          On the shape the wire actually sends - `{"error":{"message":"..."}}`
//          - that renders `[object Object]` and throws the provider's reason
//          away, and on plain JSON carrying a non-callable `toString` it raises
//          a TypeError out of the reader that no marker can classify. The cloud
//          and Anthropic arms were fixed in session-v58 phase 4; the local arm
//          and its pull sibling were not.
//   S58-6  A cut stream discarded the only evidence of how far the server got.
//          A server that died after two tokens and one that died three lines
//          from the closing brace are different faults and produced identical
//          channel output.
//
// Run: node --test test/impl-v59-p2-stream-evidence.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore } = require("./.blind-util.cjs");

const core = bundleCore(
  "impl-v59-p2-stream",
  `export * from "../src/core/errorBound";\n` +
    `export { generateInstruct, generateFim, pullModel } from "../src/core/ollama";\n` +
    `export { makeCloudInstruct } from "../src/core/cloudInstruct";\n`,
);
const { generateInstruct, pullModel, makeCloudInstruct, CHANNEL_BODY_CHARS } = core.mod;
test.after(() => core.cleanup());

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/** A 200 that streams ndjson frames and closes. */
const ndjson = (frames) => (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  res.end(frames.map((f) => JSON.stringify(f) + "\n").join(""));
};

/** A 200 that streams SSE `data:` frames and closes. */
const sse = (payloads) => (_req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(payloads.map((p) => `data: ${typeof p === "string" ? p : JSON.stringify(p)}\n\n`).join(""));
};

const PARAMS = (base, log) => ({
  apiBase: base,
  model: "test-model",
  prompt: "fn add(a: i32, b: i32) -> i32 {\n",
  maxTokens: 64,
  temperature: 0.2,
  signal: new AbortController().signal,
  ...(log ? { log } : {}),
});

async function caught(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

// ===========================================================================
// S58-9. The local arm's in-stream error field.
//
// THE SHAPE THAT MATTERS is the middle row: `{"error":{"message":"..."}}` is
// not hostile and is not exotic. It is what a provider sends, and `String()`
// rendered it `[object Object]` - the reason discarded on the one surface that
// had it.
// ===========================================================================

const WIRE_SHAPES = [
  {
    label: "an object carrying the provider's message",
    value: { message: "upstream overloaded" },
    want: "upstream overloaded",
  },
  { label: "a bare string envelope", value: "model not loaded", want: "model not loaded" },
  { label: "an object naming only a type", value: { type: "rate_limit_exceeded" }, want: "rate_limit_exceeded" },
];

for (const { label, value, want } of WIRE_SHAPES) {
  test(`[ollama generate] an in-stream error, ${label}, keeps the provider's own reason`, async () => {
    const srv = await serve(ndjson([{ error: value }]));
    let err;
    try {
      err = await caught(() => generateInstruct(PARAMS(srv.base)));
    } finally {
      await srv.close();
    }
    assert.ok(err, "the stream must still fail");
    assert.ok(
      String(err.message).includes(want),
      `the provider said ${JSON.stringify(want)} and the failure must carry it, not a placeholder. ` +
        `Got: ${JSON.stringify(err.message)}`,
    );
  });

  test(`[ollama pull] an in-stream error, ${label}, keeps the provider's own reason`, async () => {
    const srv = await serve(ndjson([{ error: value }]));
    let err;
    try {
      err = await caught(() =>
        pullModel(srv.base, "test-model", new AbortController().signal, () => undefined),
      );
    } finally {
      await srv.close();
    }
    assert.ok(err, "the pull must still fail");
    assert.ok(
      String(err.message).includes(want),
      `the pull path shares the site and must move with it. Got: ${JSON.stringify(err.message)}`,
    );
  });
}

// The crash. Plain JSON, no prototype games: ToPrimitive finds a non-callable
// `toString`, falls to `Object.prototype.valueOf`, gets an object back and
// raises. That TypeError escapes the reader carrying no marker, so the toast
// translation cannot see it and the catch-all puts JS internals on screen.
for (const [arm, drive] of [
  ["generate", (base) => generateInstruct(PARAMS(base))],
  ["pull", (base) => pullModel(base, "test-model", new AbortController().signal, () => undefined)],
]) {
  test(`[ollama ${arm}] an in-stream error whose toString is not callable does not crash the reader`, async () => {
    const srv = await serve(ndjson([{ error: { toString: 1, message: "the real reason" } }]));
    let err;
    try {
      err = await caught(() => drive(srv.base));
    } finally {
      await srv.close();
    }
    assert.ok(err, "the stream must still fail");
    assert.ok(
      !/Cannot convert object to primitive/.test(String(err.message)),
      `String() on the wire's own shape threw out of the reader: ${JSON.stringify(err.message)}`,
    );
    assert.ok(
      String(err.message).includes("the real reason"),
      `and the provider's reason must survive it: ${JSON.stringify(err.message)}`,
    );
  });
}

// ===========================================================================
// S58-6. A cut stream logs how far it got.
//
// INSTRUCT ONLY. The FIM reader shares `streamGenerate`, and a per-keystroke
// channel write of partial ghosts is a different cost question - the same
// boundary S58-1 draws.
// ===========================================================================

const PARTIAL = "fn add(a: i32, b: i32) -> i32 {\n    let total = a\n";

test("[ollama instruct] a stream cut mid-reply puts the partial reply on the channel", async () => {
  const srv = await serve(ndjson([{ response: PARTIAL }]));
  const lines = [];
  let err;
  try {
    err = await caught(() => generateInstruct(PARAMS(srv.base, (l) => lines.push(String(l)))));
  } finally {
    await srv.close();
  }
  assert.ok(
    /stream ended before its done frame/.test(String(err && err.message)),
    `precondition: this is the cut-stream throw. Got: ${err && err.message}`,
  );
  const cut = lines.find((l) => l.startsWith("[cut-stream]"));
  assert.ok(cut, `the partial reply must reach the channel. Lines: ${JSON.stringify(lines)}`);
  assert.ok(cut.includes(String(PARTIAL.length)), `and the line states how much arrived: ${cut}`);
  assert.ok(
    cut.includes("let total = a"),
    `a support reader must be able to tell a server that died after two tokens from one that died ` +
      `three lines from the closing brace: ${cut}`,
  );
});

test("[cloud instruct] a stream cut mid-reply puts the partial reply on the channel", async () => {
  const srv = await serve(sse([{ choices: [{ delta: { content: PARTIAL } }] }]));
  const lines = [];
  let err;
  try {
    const fn = makeCloudInstruct({ baseUrl: srv.base, apiKey: "sk-x", log: (l) => lines.push(String(l)) });
    err = await caught(() => fn(PARAMS(srv.base)));
  } finally {
    await srv.close();
  }
  assert.ok(
    /stream ended before any terminal signal/.test(String(err && err.message)),
    `precondition: this is the cut-stream throw. Got: ${err && err.message}`,
  );
  const cut = lines.find((l) => l.startsWith("[cut-stream]"));
  assert.ok(cut, `the partial reply must reach the channel. Lines: ${JSON.stringify(lines)}`);
  assert.ok(cut.includes("let total = a"), `and it carries what arrived: ${cut}`);
});

// THE ZERO CASE, which is the most diagnostic one and the easiest to leave out.
// A server that answered 200 and then said nothing at all is a different fault
// from one that got halfway, and a line only written when there is text to
// write cannot tell them apart.
test("[ollama instruct] a stream cut before any token still says so", async () => {
  const srv = await serve(ndjson([]));
  const lines = [];
  try {
    await caught(() => generateInstruct(PARAMS(srv.base, (l) => lines.push(String(l)))));
  } finally {
    await srv.close();
  }
  const cut = lines.find((l) => l.startsWith("[cut-stream]"));
  assert.ok(cut, `a cut with nothing banked is still evidence. Lines: ${JSON.stringify(lines)}`);
  assert.ok(/\(0 chars\)/.test(cut), `and it says the server sent nothing: ${cut}`);
});

// ONE ROW, whatever the model wrote. The partial reply is model output, so it
// can carry line breaks by construction - far more readily than an error body
// can. Unescaped it would be the row forgery of S58-2 with a bigger payload.
test("[ollama instruct] a partial reply carrying breaks is still one channel row", async () => {
  const FORGED = "[fngen] ttft=1ms total=2ms len=99";
  const srv = await serve(ndjson([{ response: `fn add() {\r${FORGED}` }]));
  const lines = [];
  try {
    await caught(() => generateInstruct(PARAMS(srv.base, (l) => lines.push(String(l)))));
  } finally {
    await srv.close();
  }
  assert.ok(
    lines.some((l) => l.startsWith("[cut-stream]")),
    "precondition: the line this row is about was written. Without it the row passes on an empty " +
      "array and proves nothing.",
  );
  const rows = lines.flatMap((l) => l.split(new RegExp("\\r\\n|[\\n\\r\\u2028\\u2029\\u0085]")));
  assert.strictEqual(
    rows.length,
    lines.length,
    `${lines.length} log() call(s) rendered as ${rows.length} rows: ${JSON.stringify(rows)}`,
  );
  assert.ok(
    !rows.some((r) => r.trim() === FORGED),
    `the model's reply wrote its own channel row: ${JSON.stringify(rows)}`,
  );
});

// THE CAP. `boundChannel` is reused rather than a second number invented, so
// there is one answer to "how much of the server's words does the channel
// keep". The elision marker is what tells a cut copy from a whole one.
test("[ollama instruct] an oversized partial reply is capped and says so", async () => {
  const HUGE = "x".repeat(CHANNEL_BODY_CHARS + 500);
  const srv = await serve(ndjson([{ response: HUGE }]));
  const lines = [];
  try {
    await caught(() => generateInstruct(PARAMS(srv.base, (l) => lines.push(String(l)))));
  } finally {
    await srv.close();
  }
  const cut = lines.find((l) => l.startsWith("[cut-stream]"));
  assert.ok(cut, "the line must be written");
  assert.ok(/chars elided\]$/.test(cut), `an oversized reply is cut and the marker says so: ${cut.slice(-80)}`);
  assert.ok(
    cut.length < CHANNEL_BODY_CHARS + 200,
    `and the cap actually bounds the row, got ${cut.length} chars`,
  );
});
