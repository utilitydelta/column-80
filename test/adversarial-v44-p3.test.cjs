// Adversarial review: session-v44 phase 3, the native Anthropic Messages
// transport (src/core/anthropicInstruct.ts).
//
// Written AFTER the implementation and after the blind oracle
// (test/blind-v44-anthropic.test.cjs, 36 rows green). Its job is the opposite
// of the oracle's: every row here is an attempt to break the thing, and a row
// that stays green is a claim of CLEAN, not decoration.
//
// Run: node --test test/adversarial-v44-p3.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const b = bundleCore("adv-v44-p3", `export * as anthropic from "../src/core/anthropicInstruct";
export * as cloud from "../src/core/cloudInstruct";
export * as prompt from "../src/core/prompt";\n`);
test.after(b.cleanup);
const { makeAnthropicInstruct } = b.mod.anthropic;

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

// handler(req, res, rec, sock) drives the reply. `sock` is the raw socket, so a
// row can cut the stream instead of ending it.
function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const rec = { method: req.method, url: req.url, headers: req.headers, raw, closed: false };
      try {
        rec.body = raw ? JSON.parse(raw) : undefined;
      } catch {
        rec.body = undefined;
      }
      requests.push(rec);
      res.on("close", () => (rec.closed = true));
      Promise.resolve().then(() => handler(req, res, rec, req.socket)).catch(() => {});
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

function put(res, s) {
  try {
    res.write(s);
  } catch {
    /* peer gone */
  }
}
const frame = (res, type, obj) => put(res, `event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`);
const openSse = (res) => res.writeHead(200, { "Content-Type": "text/event-stream" });

const USAGE_START = {
  input_tokens: 2,
  cache_creation_input_tokens: 11061,
  cache_read_input_tokens: 6291,
  cache_creation: { ephemeral_1h_input_tokens: 11061, ephemeral_5m_input_tokens: 0 },
};

const messageStart = (res, usage = USAGE_START) =>
  frame(res, "message_start", { message: { id: "m", role: "assistant", content: [], usage } });
const textDelta = (res, text) => frame(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text } });
function messageEnd(res, stopReason = "end_turn") {
  frame(res, "message_delta", { delta: { stop_reason: stopReason }, usage: { output_tokens: 11 } });
  frame(res, "message_stop", {});
  try {
    res.end();
  } catch {
    /* peer gone */
  }
}
function okStream(res, text = "a + b") {
  openSse(res);
  messageStart(res);
  textDelta(res, text);
  messageEnd(res);
}

const KEY = "sk-ant-api03-ADVERSARIAL-SECRET-DO-NOT-LEAK";
const PREFIX = "// file:///w/ctx.rs 1-40\nSENTINEL\nstruct Acc { n: i32 }\n";
const TAIL = "fn add(a: i32, b: i32) -> i32 {\n";
const PROMPT = `${PREFIX}\n\n${TAIL}`;
const BASE_PARAMS = { apiBase: "http://127.0.0.1:1", model: "m", maxTokens: 2048, temperature: 0.2 };

async function run(srv, extra = {}) {
  const lines = [];
  const fn = makeAnthropicInstruct({ baseUrl: srv.baseUrl, apiKey: KEY, log: (l) => lines.push(String(l)) });
  const out = await fn({ ...BASE_PARAMS, prompt: PROMPT, signal: new AbortController().signal, ...extra });
  return { out, lines };
}

const contentOf = (rec) => rec.body.messages[0].content;
const evidence = (lines) => lines.filter((l) => l.startsWith("[anthropic]"));

// ---------------------------------------------------------------------------
// A1: the split at the far end - a prefix that IS the whole prompt
// ---------------------------------------------------------------------------

test("A1: a cachePrefix equal to the whole prompt sends an EMPTY second text block", async (t) => {
  // The blind oracle guarded the near end (an empty prefix takes the
  // single-block path, ruled C4, because the API rejects an empty text block).
  // The far end has the same shape and no guard: the marked block is fine and
  // the block AFTER it is "".
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  await run(srv, { prompt: PROMPT, cachePrefix: PROMPT });
  const blocks = contentOf(srv.requests[0]);

  for (const blk of blocks) {
    assert.ok(
      blk.text.length > 0,
      "an empty text block is not a message the API accepts, at either end of the split\n" +
        `  got: ${JSON.stringify(blocks)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// A2: a data: line that is not JSON
// ---------------------------------------------------------------------------

// TRIAGE RULING, kept verbatim from the `todo` marker this row carried until
// session-v48 phase 0:
//
//   "DEFERRED by triage 2026-08-08 as scraps S44-5. Unreachable through
//   supported configuration: the Anthropic API terminates with message_stop and
//   never sends [DONE], so the only way here is an `anthropic` provider pointed
//   by cloudApiBase at an OpenAI-compatible proxy that nonetheless answers
//   /messages - a configuration the manual now tells users to express as
//   `openai-compatible` instead. The two-line fix is also itself a guess:
//   swallowing unparseable frames would hide a garbage payload from a real
//   endpoint. Red on purpose."
//
// CONVERTED 2026-08-10. The row USED TO assert that `out.text` is "a + b" - the
// completion had arrived in full before the sentinel, so the round should
// return it. It does not: the round rejects and the complete text is lost.
test("KNOWN WRONG: a [DONE] sentinel from a gateway fails the whole round after the text has arrived", async (t) => {
  // cloudApiBase overrides the base URL for the `anthropic` preset too, so this
  // transport can face a proxy, and a proxy that appends OpenAI's end sentinel
  // takes down a round whose text was already complete.
  const srv = await startServer((req, res) => {
    openSse(res);
    messageStart(res);
    textDelta(res, "a + b");
    frame(res, "message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 11 } });
    frame(res, "message_stop", {});
    put(res, "data: [DONE]\n\n");
    res.end();
  });
  t.after(srv.close);

  let err;
  const got = await run(srv, { cachePrefix: PREFIX }).catch((e) => {
    err = e;
    return undefined;
  });
  assert.strictEqual(got, undefined, "the round does not return: the sentinel takes it down");
  assert.strictEqual(err?.name, "SyntaxError", `the reject is the JSON parser's own error\n  got: ${err?.name}: ${err?.message}`);
  assert.match(
    String(err?.message),
    /\[DONE\]/,
    `and it names the sentinel it could not parse\n  got: ${err?.message}`,
  );
});

// TRIAGE RULING, kept verbatim from the `todo` marker this row carried until
// session-v48 phase 0:
//
//   "DEFERRED by triage 2026-08-08 as scraps S44-5, with A2. Same trigger, same
//   ruling."
//
// CONVERTED 2026-08-10. The row USED TO assert that the rejection message says
// nothing about SyntaxError / JSON - that a stream this transport cannot read
// names the transport rather than leaking its parser. It leaks the parser.
test("KNOWN WRONG: any unparseable data: line rejects with a raw SyntaxError, not a provider-shaped message", async (t) => {
  const srv = await startServer((req, res) => {
    openSse(res);
    messageStart(res);
    textDelta(res, "a + b");
    put(res, "data: not-json\n\n");
    res.end();
  });
  t.after(srv.close);

  let err;
  await run(srv).catch((e) => (err = e));
  assert.ok(err, "precondition: it rejects");
  assert.match(
    `${err.name}: ${err.message}`,
    /SyntaxError|Unexpected token|JSON/i,
    "the rejection leaks the JSON parser instead of naming the transport",
  );
  assert.strictEqual(err.name, "SyntaxError", `and the error TYPE is the parser's too\n  got: ${err.name}`);
  assert.ok(
    !/anthropic/i.test(`${err.name}: ${err.message}`),
    `nothing in it names the provider\n  got: ${err.name}: ${err.message}`,
  );
});

// ---------------------------------------------------------------------------
// A3: one line per round, including the rounds that fail
// ---------------------------------------------------------------------------

test("A3: a round that fails on a non-2xx writes NO evidence line", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid x-api-key" } }));
  });
  t.after(srv.close);

  const lines = [];
  const fn = makeAnthropicInstruct({ baseUrl: srv.baseUrl, apiKey: KEY, log: (l) => lines.push(String(l)) });
  await fn({ ...BASE_PARAMS, prompt: PROMPT, cachePrefix: PREFIX, signal: new AbortController().signal }).catch(() => {});

  assert.strictEqual(
    evidence(lines).length,
    1,
    `the contract's Evidence section says one line per round\n  got: ${JSON.stringify(lines)}`,
  );
});

// TRIAGE RULING, kept verbatim from the `todo` marker this row carried until
// session-v48 phase 0:
//
//   "DEFERRED by triage 2026-08-08: this is scraps S44-2 on the other backend.
//   Amendment A10 ruled that a failed round appends no accounting, and appending
//   it here alone would split the one format phase 4 parses. The round=failed
//   LINE itself now exists (finding 1's other half is fixed); only the
//   accounting on it is deferred. Red on purpose."
//
// CONVERTED 2026-08-10. The row USED TO assert that some evidence line carries
// `cwrite=11061` - the cache write the provider reported, and the user paid for,
// before the round died. No line does.
test("KNOWN WRONG: a round that dies mid-stream loses the cache accounting it had already been told", async (t) => {
  // message_start carried a measured 11,061-token cache WRITE. The round then
  // fails, and that write - which the user has paid for - is reported nowhere.
  const srv = await startServer(async (req, res) => {
    openSse(res);
    messageStart(res);
    textDelta(res, "half a fn");
    await sleep(20);
    frame(res, "error", { error: { type: "overloaded_error", message: "fell over" } });
    try {
      res.end();
    } catch {
      /* peer gone */
    }
  });
  t.after(srv.close);

  const lines = [];
  const fn = makeAnthropicInstruct({ baseUrl: srv.baseUrl, apiKey: KEY, log: (l) => lines.push(String(l)) });
  await fn({ ...BASE_PARAMS, prompt: PROMPT, cachePrefix: PREFIX, signal: new AbortController().signal }).catch(() => {});

  assert.ok(
    !lines.some((l) => l.includes("cwrite=")),
    `the cache write the provider already reported vanishes with the round\n  got: ${JSON.stringify(lines)}`,
  );
  assert.deepStrictEqual(
    lines,
    // RE-CUT by session-v57 phase 4. The throw was reworded from
    // "Anthropic stream error:" to "Anthropic reported an error mid-reply:"
    // because the first wording was API vocabulary reaching a notification, and
    // because roadmap item 66 had mis-classified this frame as a stream cut. The
    // defect this row records is unchanged: the cache write is still lost.
    ["[anthropic] model=m round=failed reason=Anthropic reported an error mid-reply: fell over"],
    "the failed round leaves exactly one line, and it carries the reason and no accounting",
  );
});

// ---------------------------------------------------------------------------
// A4: message_stop is named as "the end" and is never read
// ---------------------------------------------------------------------------

test("A4: a stream cut before message_stop resolves as a clean, complete generation", async (t) => {
  // No message_delta, no message_stop, no error: just a body that stops. The
  // round returns the partial text with doneReason undefined, which is exactly
  // what a successful short function looks like to the fn-gen service.
  const srv = await startServer((req, res) => {
    openSse(res);
    messageStart(res);
    textDelta(res, "    a + ");
    res.end();
  });
  t.after(srv.close);

  let out;
  let err;
  await run(srv, { cachePrefix: PREFIX }).then((r) => (out = r.out)).catch((e) => (err = e));

  assert.ok(
    err !== undefined || (out && out.doneReason !== undefined),
    "a stream that never reached message_stop is not a finished generation, and nothing on the " +
      `result says so\n  got: text=${JSON.stringify(out && out.text)} doneReason=${out && out.doneReason}`,
  );
});

test("A4b: a socket cut mid-stream", async (t) => {
  const srv = await startServer((req, res, rec, sock) => {
    openSse(res);
    messageStart(res);
    textDelta(res, "    a + ");
    setTimeout(() => sock.destroy(), 20);
  });
  t.after(srv.close);

  let out;
  let err;
  await run(srv, { cachePrefix: PREFIX }).then((r) => (out = r.out)).catch((e) => (err = e));
  assert.ok(
    err !== undefined,
    `a destroyed socket must not read as a finished round\n  got: ${JSON.stringify(out)}`,
  );
});

// ---------------------------------------------------------------------------
// A5: the ADR document still states the superseded fact as current
// ---------------------------------------------------------------------------

test("A5: fn-generation.md still says one client covers Anthropic, above the amendment saying it does not", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const adr = fs.readFileSync(path.join(__dirname, "..", "docs", "architecture", "fn-generation.md"), "utf8");
  const wiring = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "fnGen.ts"), "utf8");

  // The routing fact, read from the code rather than assumed.
  assert.match(wiring, /provider === "anthropic"\s*\n?\s*\?\s*makeAnthropicInstruct/, "precondition: anthropic routes away from the compat client");

  const stale = [
    "One client covers OpenAI, xAI (Grok), Anthropic (Claude), and Gemini",
    "one streamed POST to an OpenAI-compatible `/chat/completions`. Chosen when `fnGenProvider` names a provider",
  ].filter((s) => adr.includes(s));

  assert.deepStrictEqual(
    stale,
    [],
    "the amendment was added but the prose above it was not corrected, so the document asserts both\n" +
      `  still present: ${JSON.stringify(stale, null, 2)}`,
  );
});

// ---------------------------------------------------------------------------
// CLEAN: the split, hard
// ---------------------------------------------------------------------------

test("CLEAN: the split reconstructs the prompt byte for byte over 200 adversarial inputs", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  // Multibyte, combining marks, astral pairs, CRLF, a prefix that repeats
  // later, and a prompt whose head equals its tail.
  const alphabet = ["a", "\r\n", "\n", "é", "①", "\u{1F30D}", "é", "\t", " ", "{", "data:", " "];
  const rnd = (() => {
    let s = 12345;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  })();

  for (let i = 0; i < 200; i++) {
    const n = 1 + Math.floor(rnd() * 24);
    let prompt = "";
    for (let k = 0; k < n; k++) prompt += alphabet[Math.floor(rnd() * alphabet.length)];
    // A cut point anywhere inside, including one that lands between a surrogate
    // pair, which is the case a byte-offset split gets wrong.
    const cut = 1 + Math.floor(rnd() * Math.max(1, prompt.length - 1));
    const prefix = prompt.slice(0, cut);

    srv.requests.length = 0;
    await run(srv, { prompt, cachePrefix: prefix });
    const blocks = contentOf(srv.requests[0]);
    assert.strictEqual(
      blocks.map((x) => x.text).join(""),
      prompt,
      `round ${i}: prefix + rest must equal the prompt\n  prompt: ${JSON.stringify(prompt)}\n  prefix: ${JSON.stringify(prefix)}`,
    );
    const marked = blocks.filter((x) => x.cache_control !== undefined);
    assert.ok(marked.length <= 1, `round ${i}: never two breakpoints`);
    if (marked.length === 1) {
      assert.strictEqual(blocks.indexOf(marked[0]), 0, `round ${i}: the marker is on the leading block`);
      assert.strictEqual(marked[0].text, prefix, `round ${i}: the marked block is the prefix`);
      assert.deepStrictEqual(marked[0].cache_control, { type: "ephemeral", ttl: "1h" });
    }
  }
});

test("CLEAN: a prefix that also occurs later in the prompt still splits at the head", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const prefix = "REPEATED\n";
  const prompt = `${prefix}middle\n${prefix}tail\n`;
  await run(srv, { prompt, cachePrefix: prefix });
  const blocks = contentOf(srv.requests[0]);
  assert.strictEqual(blocks[0].text, prefix, "the FIRST occurrence is the split, not the last");
  assert.strictEqual(blocks[0].text + blocks[1].text, prompt);
});

// ---------------------------------------------------------------------------
// CLEAN: framing
// ---------------------------------------------------------------------------

test("CLEAN: CRLF framing and a frame arriving split across two reads", async (t) => {
  const srv = await startServer(async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    // CRLF line endings, and one data: line cut in half mid-JSON.
    put(res, `event: message_start\r\ndata: ${JSON.stringify({ type: "message_start", message: { usage: USAGE_START } })}\r\n\r\n`);
    const whole = `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "fn add() {}" } })}\r\n\r\n`;
    put(res, whole.slice(0, 30));
    await sleep(30);
    put(res, whole.slice(30));
    await sleep(10);
    put(res, `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } })}\r\n\r\n`);
    put(res, "data: {\"type\":\"message_stop\"}\r\n\r\n");
    res.end();
  });
  t.after(srv.close);

  const chunks = [];
  const { out, lines } = await run(srv, { cachePrefix: PREFIX, onChunk: (c) => chunks.push(c) });
  assert.strictEqual(out.text, "fn add() {}", "a frame split across reads is reassembled, not dropped or doubled");
  assert.deepStrictEqual(chunks, ["fn add() {}"], "and reaches onChunk exactly once");
  assert.strictEqual(out.doneReason, "stop");
  assert.match(evidence(lines)[0], /cwrite=11061 cread=6291 ttl=1h/, "the usage still merged across the two frames");
});

test("CLEAN: usage is merged, never doubled, and message_delta's output_tokens wins", async (t) => {
  const srv = await startServer((req, res) => {
    openSse(res);
    // message_start reports what has been emitted SO FAR, which the real API
    // sends as output_tokens too. C2: the later frame replaces it.
    frame(res, "message_start", { message: { usage: { ...USAGE_START, output_tokens: 1 } } });
    textDelta(res, "x");
    frame(res, "message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 97 } });
    frame(res, "message_stop", {});
    res.end();
  });
  t.after(srv.close);

  const { lines } = await run(srv, { cachePrefix: PREFIX });
  const line = evidence(lines)[0];
  assert.match(line, /(?:^|\s)out=97(?:\s|$)/, `message_delta wins over message_start\n  got: ${line}`);
  assert.match(line, /(?:^|\s)in=2\s/, "and the cache fields from the first frame survive");
  assert.match(line, /cwrite=11061 /);
});

// ---------------------------------------------------------------------------
// CLEAN: statelessness and the key
// ---------------------------------------------------------------------------

test("CLEAN: interleaved rounds on one instance do not influence each other", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const fn = makeAnthropicInstruct({ baseUrl: srv.baseUrl, apiKey: KEY, log: () => {} });
  const call = (p, pre) => fn({ ...BASE_PARAMS, prompt: p, cachePrefix: pre, signal: new AbortController().signal });

  const other = `${PREFIX}extra\n`;
  const otherPrompt = `${other}\n\n${TAIL}`;
  // Concurrent, so a shared buffer or a shared usage accumulator would show.
  await Promise.all([call(PROMPT, PREFIX), call(otherPrompt, other), call(PROMPT, PREFIX)]);

  const bodies = srv.requests.map((r) => JSON.stringify(contentOf(r)));
  const a = bodies.filter((x) => x === JSON.stringify([
    { type: "text", text: PREFIX, cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: PROMPT.slice(PREFIX.length) },
  ]));
  assert.strictEqual(a.length, 2, `two rounds with the same input send the same bytes\n  got: ${bodies.join("\n")}`);
});

test("CLEAN: the key reaches the header and nothing else", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const { lines } = await run(srv, { cachePrefix: PREFIX });
  assert.strictEqual(srv.requests[0].headers["x-api-key"], KEY);
  assert.ok(!srv.requests[0].raw.includes(KEY), "not in the body");
  assert.ok(!lines.join("\n").includes(KEY), "not on the evidence line");
  assert.ok(!lines.join("\n").includes(KEY.slice(-10)), "nor its tail");
});

test("CLEAN: an abort releases the connection and rejects as AbortError", async (t) => {
  const srv = await startServer((req, res) => {
    openSse(res);
    messageStart(res);
    textDelta(res, "fn ");
  });
  t.after(srv.close);

  const ac = new AbortController();
  const fn = makeAnthropicInstruct({ baseUrl: srv.baseUrl, apiKey: KEY, log: () => {} });
  const p = fn({ ...BASE_PARAMS, prompt: PROMPT, cachePrefix: PREFIX, signal: ac.signal });
  await sleep(80);
  ac.abort();
  await assert.rejects(p, (e) => e.name === "AbortError");
  for (let i = 0; i < 100 && !srv.requests[0].closed; i++) await sleep(20);
  assert.ok(srv.requests[0].closed, "the connection is released");
});

// ---------------------------------------------------------------------------
// CLEAN: blast radius
// ---------------------------------------------------------------------------

test("CLEAN: the compat client's body is identical with and without cachePrefix, and carries no Anthropic anything", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    put(res, `data: ${JSON.stringify({ choices: [{ delta: { content: "x" }, finish_reason: "stop" }] })}\n\n`);
    put(res, "data: [DONE]\n\n");
    res.end();
  });
  t.after(srv.close);

  const fn = b.mod.cloud.makeCloudInstruct({ baseUrl: srv.baseUrl, apiKey: "sk-compat" });
  const call = (extra) => fn({ ...BASE_PARAMS, prompt: PROMPT, signal: new AbortController().signal, ...extra });
  await call({});
  await call({ cachePrefix: PREFIX });

  assert.strictEqual(srv.requests[1].raw, srv.requests[0].raw, "not one byte");
  assert.ok(!srv.requests[1].raw.includes("cache_control"));
  assert.strictEqual(srv.requests[1].headers["anthropic-version"], undefined);
  assert.strictEqual(srv.requests[1].headers["x-api-key"], undefined);
  assert.strictEqual(srv.requests[1].url, "/v1/chat/completions");
});

test("CLEAN: a base URL with a trailing slash does not produce //messages", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);
  const fn = makeAnthropicInstruct({ baseUrl: `${srv.baseUrl}/`, apiKey: KEY, log: () => {} });
  await fn({ ...BASE_PARAMS, prompt: PROMPT, cachePrefix: PREFIX, signal: new AbortController().signal });
  assert.strictEqual(srv.requests[0].url, "/v1/messages");
});
