// Blind oracle: the native Anthropic Messages transport
// (src/core/anthropicInstruct.ts, session-v44 phase 3).
//
// Written from the phase-3 contract ONLY, BEFORE the implementation
// existed. The oracle never read src/core/anthropicInstruct.ts, nor any other
// file under src/. Every assertion below traces to a sentence in that contract;
// the numbered rows match its "Testing shape" list 1..17, and rows named
// "extra" trace to a sentence in its prose (Scope, No client-side state, The
// transport, The one breakpoint, Response, Evidence, Prefix stability) that the
// numbered list does not cover.
//
// Red is the expected first state: the module does not exist, so the bundle of
// it fails and every row that needs it fails on "must exist and export
// makeAnthropicInstruct" rather than taking the whole file down. The modules
// are bundled as namespaces for the same reason.
//
// KNOWN CONTRACT GAPS this file works around, reported with the run:
//   - the contract never says HOW the caller supplies the evidence sink, so
//     every row reads the line from BOTH a `log` in the config and the console,
//     and asserts on whichever carried it.
//   - `message_start.usage` is enumerated without `output_tokens`, which the
//     real API does send, and nothing says whether it is added to the
//     `message_delta` count or replaced by it. Fixtures follow the contract's
//     enumeration and omit it, so no row depends on the answer.
//   - phase 2 gated its split on `prefix + "\n\n"`; this contract gates only on
//     "genuinely a prefix". The single-newline row below reads it literally.
//
// The transport speaks HTTP, so the fixture is a real local http.createServer
// that records method, path, headers and the raw body, then replies with a
// canned SSE stream. No network, no key, no provider. The row that compares the
// two backends' accounting drives the Claude Code transport against a fake
// `claude` shim, the same mechanism test/blind-v44-fork.test.cjs uses.
//
// Run: SKIP_LIVE=1 node --test test/blind-v44-anthropic.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bundleCore, sleep } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// bundling, with the not-yet-written module handled rather than fatal
// ---------------------------------------------------------------------------

const REST_ENTRY =
  `export * as cloud from "../src/core/cloudInstruct";
export * as prompt from "../src/core/prompt";
export * as claudeCode from "../src/core/claudeCodeInstruct";\n`;
const FULL_ENTRY = `export * as anthropic from "../src/core/anthropicInstruct";\n${REST_ENTRY}`;

let MOD = null;
let BUNDLE_ERROR = null;
try {
  const b = bundleCore("blind-v44-anthropic", FULL_ENTRY);
  MOD = b.mod;
  test.after(b.cleanup);
} catch (e) {
  BUNDLE_ERROR = e;
  fs.rmSync(path.join(__dirname, ".blind-v44-anthropic.entry.ts"), { force: true });
  const b = bundleCore("blind-v44-anthropic-rest", REST_ENTRY);
  MOD = b.mod;
  test.after(b.cleanup);
}

function makeAnthropicInstruct(config) {
  const ns = MOD.anthropic;
  if (!ns || typeof ns.makeAnthropicInstruct !== "function") {
    const why = BUNDLE_ERROR ? String(BUNDLE_ERROR.message).split("\n")[0] : "the export is missing";
    assert.fail(
      "src/core/anthropicInstruct.ts must exist and export " +
        `makeAnthropicInstruct({ baseUrl, apiKey }): ${why}`
    );
  }
  return ns.makeAnthropicInstruct(config);
}

// ---------------------------------------------------------------------------
// the local Messages fixture
// ---------------------------------------------------------------------------

// handler(req, res, rec) drives the reply. `rec.closed` flips when the response
// socket goes away, which is how the abort row observes a released connection.
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
      } catch (e) {
        rec.body = undefined;
        rec.parseError = String(e.message);
      }
      requests.push(rec);
      res.on("close", () => {
        rec.closed = true;
      });
      Promise.resolve()
        .then(() => handler(req, res, rec))
        .catch(() => {});
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// A write that survives the peer hanging up, so an aborted row does not turn
// into an unhandled server error.
function put(res, s) {
  try {
    res.write(s);
  } catch {
    /* the client went away, which is what that row is testing */
  }
}
const frame = (res, type, obj) => put(res, `event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`);
const openSse = (res) => res.writeHead(200, { "Content-Type": "text/event-stream" });

// The contract enumerates message_start.usage as input_tokens, the two cache
// counters and the cache_creation TTL split. output_tokens is deliberately NOT
// here: see the gap note at the top.
const USAGE_START = {
  input_tokens: 2,
  cache_creation_input_tokens: 84,
  cache_read_input_tokens: 15548,
  cache_creation: { ephemeral_1h_input_tokens: 84, ephemeral_5m_input_tokens: 0 },
};
const OUT_TOKENS = 11;

function messageStart(res, usage = USAGE_START) {
  frame(res, "message_start", {
    message: {
      id: "msg_blind_v44",
      type: "message",
      role: "assistant",
      model: "claude-fixture",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage,
    },
  });
}
const textDelta = (res, text) =>
  frame(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text } });
function messageEnd(res, stopReason = "end_turn", outputTokens = OUT_TOKENS) {
  frame(res, "message_delta", {
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  frame(res, "message_stop", {});
  try {
    res.end();
  } catch {
    /* peer gone */
  }
}

// The whole happy stream, including the frames the API really sends around the
// ones the contract names. `ping` is named as ignored; the block start/stop
// pair is what "the frames that carry meaning" leaves out.
function okStream(res, { text = "a + b", stopReason = "end_turn", usage = USAGE_START, outputTokens = OUT_TOKENS } = {}) {
  openSse(res);
  messageStart(res, usage);
  frame(res, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  frame(res, "ping", {});
  textDelta(res, text);
  frame(res, "content_block_stop", { index: 0 });
  messageEnd(res, stopReason, outputTokens);
}

// ---------------------------------------------------------------------------
// calling the transport
// ---------------------------------------------------------------------------

const KEY = "sk-ant-api03-BLIND-ORACLE-SECRET-VALUE-DO-NOT-LEAK";
const PREFIX = "// file:///w/ctx.rs 1-40\nCONTEXT_SENTINEL_ALPHA\nstruct Acc { n: i32 }\n";
const TAIL = "// write the body\nfn add(a: i32, b: i32) -> i32 {\n";
const PROMPT = `${PREFIX}\n\n${TAIL}`;

// The full InstructGenerateParams surface, so no row passes or fails on a
// missing knob. `cachePrefix` is added per row.
const BASE_PARAMS = {
  apiBase: "http://127.0.0.1:19999",
  model: "claude-fixture-model",
  maxTokens: 2048,
  temperature: 0.2,
  numGpu: 30,
  numCtx: 16384,
  think: false,
};

// GAP 1: the contract fixes the evidence LINE but never says how the caller
// supplies the sink. Both channels are collected and the row asserts on the
// union, so a transport that logs either way is judged on the line's content.
async function withConsole(sink, fn) {
  const orig = {};
  for (const k of ["log", "info", "warn", "error", "debug"]) {
    orig[k] = console[k];
    console[k] = (...a) => sink.push(a.map((x) => (typeof x === "string" ? x : String(x))).join(" "));
  }
  try {
    return await fn();
  } finally {
    Object.assign(console, orig);
  }
}

async function run(srv, extra = {}, cfg = {}) {
  const lines = [];
  const fn = makeAnthropicInstruct({
    baseUrl: srv.baseUrl,
    apiKey: KEY,
    log: (l) => lines.push(String(l)),
    ...cfg,
  });
  const out = await withConsole(lines, () =>
    fn({ ...BASE_PARAMS, prompt: PROMPT, signal: new AbortController().signal, ...extra })
  );
  return { out, lines };
}

function evidenceLine(lines) {
  const hits = lines.filter((l) => l.trimStart().startsWith("[anthropic]"));
  assert.strictEqual(
    hits.length,
    1,
    "exactly one [anthropic] evidence line per round\n" +
      "  expected: [anthropic] model=<id> cache-mark=<yes|no> ttft=<n>ms total=<n>ms <accounting>\n" +
      `  got:      ${JSON.stringify(lines)}`
  );
  return hits[0].trimStart();
}

const field = (line, name) => {
  const m = line.match(new RegExp(`(?:^|\\s)${name}=(\\S*)`));
  return m === null ? null : m[1];
};

// The evidence line's fixed head, and what follows it is the accounting.
const HEAD_RE = /^\[anthropic\] model=(\S+) cache-mark=(yes|no) ttft=(\d+)ms total=(\d+)ms (.+)$/;
function headOf(line) {
  const m = line.match(HEAD_RE);
  assert.ok(
    m,
    "the ruled evidence shape\n" +
      "  expected: [anthropic] model=<id> cache-mark=<yes|no> ttft=<n>ms total=<n>ms <accounting>\n" +
      `  got:      ${line}`
  );
  return { model: m[1], mark: m[2], ttft: Number(m[3]), total: Number(m[4]), accounting: m[5] };
}

// One user message in, text out. Returns the content blocks.
function contentOf(rec) {
  assert.ok(rec.body, `the request body must be JSON\n  raw: ${JSON.stringify(rec.raw).slice(0, 300)}`);
  assert.ok(Array.isArray(rec.body.messages), "body.messages is an array");
  assert.strictEqual(rec.body.messages.length, 1, "one user message in and text out");
  assert.strictEqual(rec.body.messages[0].role, "user", "the single message is the user's");
  const c = rec.body.messages[0].content;
  assert.ok(
    Array.isArray(c),
    "content is an ARRAY of text blocks, which is what gives the marker somewhere to sit\n" +
      `  got: ${JSON.stringify(c).slice(0, 200)}`
  );
  return c;
}

const markerCount = (rec) => (rec.raw.match(/cache_control/g) || []).length;

async function waitFor(pred, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ---------------------------------------------------------------------------
// row 1: the breakpoint, on the FIRST block
// ---------------------------------------------------------------------------

test("row 1: with a prefix, content is TWO text blocks and only the first carries cache_control ephemeral/1h", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  await run(srv, { cachePrefix: PREFIX });

  assert.strictEqual(srv.requests.length, 1, "one round is one POST");
  const rec = srv.requests[0];
  const blocks = contentOf(rec);

  assert.strictEqual(
    blocks.length,
    2,
    `a genuine prefix splits the message in two\n  got ${blocks.length} block(s): ${JSON.stringify(blocks).slice(0, 300)}`
  );
  assert.strictEqual(blocks[0].type, "text", "both blocks are text blocks");
  assert.strictEqual(blocks[1].type, "text");

  // Placement IS the decision: the marker means "cache up to and including this
  // block", so on the last block every request writes a new entry and reads none.
  assert.deepStrictEqual(
    blocks[0].cache_control,
    { type: "ephemeral", ttl: "1h" },
    "the marker sits on the FIRST block, ephemeral, 1-hour TTL hardcoded\n" +
      `  got: ${JSON.stringify(blocks[0].cache_control)}`
  );
  assert.ok(
    !("cache_control" in blocks[1]),
    "the trailing block carries no marker: one breakpoint, not two\n" +
      `  got: ${JSON.stringify(blocks[1].cache_control)}`
  );

  // Rule 1: exactly one breakpoint, counted over the whole body so a marker
  // hiding on the message or the request root also fails.
  assert.strictEqual(markerCount(rec), 1, `exactly one breakpoint in the whole request\n  raw: ${rec.raw}`);
  assert.ok(!/"ttl"\s*:\s*"5m"/.test(rec.raw), "the 5-minute window expires while a developer thinks; the TTL is 1h");
});

test("extra (rule 1): the marker is on the block holding the PREFIX, not on the block holding the rest", async (t) => {
  // A transport that emitted the two blocks in the other order would satisfy a
  // naive "blocks[0] has the marker" row and cache nothing reusable.
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);
  await run(srv, { cachePrefix: PREFIX });

  const blocks = contentOf(srv.requests[0]);
  const marked = blocks.filter((b) => b.cache_control !== undefined);
  assert.strictEqual(marked.length, 1, "one marked block");
  assert.strictEqual(marked[0].text, PREFIX, "the marked block is the prefix, byte for byte");
  assert.strictEqual(
    blocks.indexOf(marked[0]),
    0,
    "and it leads the message, because the prompt leads with the blocks"
  );
});

// ---------------------------------------------------------------------------
// row 2: the two blocks reconstruct the prompt, byte for byte
// ---------------------------------------------------------------------------

test("row 2: blocks[0].text + blocks[1].text is byte-identical to params.prompt, and the rest carries the separator", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  await run(srv, { cachePrefix: PREFIX });
  const blocks = contentOf(srv.requests[0]);
  assert.strictEqual(blocks.length, 2, "precondition: the round split");

  assert.strictEqual(blocks[0].text, PREFIX, "the first block is exactly the declared prefix");
  assert.strictEqual(
    blocks[1].text,
    PROMPT.slice(PREFIX.length),
    "the second block is exactly the remainder, separator included"
  );
  assert.strictEqual(
    blocks[0].text + blocks[1].text,
    PROMPT,
    "rule 6: prefix + rest === prompt, byte for byte"
  );
  assert.ok(
    blocks[1].text.startsWith("\n\n"),
    `the REST carries the separator, so no byte is dropped between the blocks\n  got: ${JSON.stringify(blocks[1].text.slice(0, 8))}`
  );
  assert.strictEqual(
    Buffer.byteLength(blocks[0].text, "utf8") + Buffer.byteLength(blocks[1].text, "utf8"),
    Buffer.byteLength(PROMPT, "utf8"),
    "the same claim measured in bytes, not code units"
  );
});

test("row 2 (multibyte and CRLF): the split is on bytes the caller gave, not on a re-derived boundary", async (t) => {
  // A split computed by re-rendering, by trimming, by normalising newlines or by
  // slicing on a byte offset against a UTF-16 string all pass the ASCII row and
  // fail this one.
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const prefix = "// ctx ①\nlet s = \"héllo \u{1F30D}\";\r\n   \n\ttrailing tab\t";
  const tail = "// write ②\r\nfn add() -> é {\r\n";
  const prompt = `${prefix}\n\n${tail}`;

  await run(srv, { prompt, cachePrefix: prefix });
  const blocks = contentOf(srv.requests[0]);
  assert.strictEqual(blocks.length, 2, `a multibyte prefix is still a prefix\n  got: ${JSON.stringify(blocks).slice(0, 400)}`);
  assert.strictEqual(blocks[0].text, prefix, "no normalising, no trimming, no re-rendering");
  assert.strictEqual(blocks[0].text + blocks[1].text, prompt, "rule 6 holds over multibyte and CRLF");
  assert.strictEqual(
    Buffer.byteLength(blocks[0].text, "utf8") + Buffer.byteLength(blocks[1].text, "utf8"),
    Buffer.byteLength(prompt, "utf8")
  );
});

test("row 2 (whole prompt): the single-block path reconstructs the prompt too", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);
  await run(srv);
  const blocks = contentOf(srv.requests[0]);
  assert.strictEqual(blocks.map((b) => b.text).join(""), PROMPT, "every path sends the whole prompt and nothing else");
});

// ---------------------------------------------------------------------------
// row 3: no prefix, no marker
// ---------------------------------------------------------------------------

test("row 3: without a cachePrefix, content is ONE block and cache_control appears nowhere in the body", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const { out } = await run(srv);
  const rec = srv.requests[0];
  const blocks = contentOf(rec);
  assert.strictEqual(blocks.length, 1, `no prefix means one block\n  got: ${JSON.stringify(blocks).slice(0, 300)}`);
  assert.strictEqual(blocks[0].type, "text");
  assert.strictEqual(blocks[0].text, PROMPT, "that one block holds the whole prompt");
  assert.ok(!("cache_control" in blocks[0]), "nothing to cache, so nothing marked");
  assert.strictEqual(markerCount(rec), 0, `no cache_control anywhere in the body\n  raw: ${rec.raw}`);
  assert.strictEqual(out.text, "a + b", "the round still succeeds");
});

// ---------------------------------------------------------------------------
// row 4: a prefix that is not one
// ---------------------------------------------------------------------------

test("row 4: a cachePrefix that is not a prefix of the prompt falls back to one block and never throws", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const notAPrefix = PREFIX.replace("CONTEXT_SENTINEL_ALPHA", "CONTEXT_SENTINEL_OTHER!");
  assert.ok(!PROMPT.startsWith(notAPrefix), "fixture: the declared prefix really is not one");

  const { out } = await run(srv, { cachePrefix: notAPrefix });
  const rec = srv.requests[0];
  const blocks = contentOf(rec);
  assert.strictEqual(blocks.length, 1, "the drift guard fails SAFE: one block, never a throw");
  assert.strictEqual(blocks[0].text, PROMPT, "and it carries the whole prompt");
  assert.strictEqual(markerCount(rec), 0, "a marker on a mismatched split would corrupt the message");
  assert.strictEqual(out.text, "a + b", "the round succeeds");
});

test("row 4 (evidence): a fallen-back round reports cache-mark=no, because that is what was SENT", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);
  const notAPrefix = `${PREFIX}not-in-the-prompt`;
  const { lines } = await run(srv, { cachePrefix: notAPrefix });
  assert.strictEqual(
    headOf(evidenceLine(lines)).mark,
    "no",
    "cache-mark reports what we sent, and this round sent no marker"
  );
});

// ---------------------------------------------------------------------------
// row 5: no floor on this path
// ---------------------------------------------------------------------------

test("row 5: a prefix well under 2048 bytes still gets its marker: there is NO floor here", async (t) => {
  // Rule 5. Phase 2 refuses below MIN_PREFIX_BYTES because a fork costs a round
  // trip; a marker costs nothing, and below the model's minimum the API ignores
  // it and `usage` reports the truth.
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const small = "// tiny\n";
  const prompt = `${small}\n\n${TAIL}`;
  assert.ok(Buffer.byteLength(small, "utf8") < 2048, "fixture: well under phase 2's floor");

  await run(srv, { prompt, cachePrefix: small });
  const blocks = contentOf(srv.requests[0]);
  assert.strictEqual(
    blocks.length,
    2,
    `no floor on this path: skipping the marker would be a guess where a measurement is free\n  got: ${JSON.stringify(blocks).slice(0, 300)}`
  );
  assert.deepStrictEqual(blocks[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.strictEqual(blocks[0].text + blocks[1].text, prompt);
});

// ---------------------------------------------------------------------------
// row 6: the headers the API actually has
// ---------------------------------------------------------------------------

test("row 6: x-api-key carries the key, anthropic-version is 2023-06-01, and there is no Authorization header", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  await run(srv, { cachePrefix: PREFIX });
  const h = srv.requests[0].headers;

  assert.strictEqual(h["x-api-key"], KEY, "the key travels as x-api-key, not as the compat layer's scheme");
  assert.strictEqual(h["anthropic-version"], "2023-06-01", "the version header is required on every Messages call");
  assert.strictEqual(h.authorization, undefined, "Authorization: Bearer is the compat layer's scheme and must not be sent");
  assert.ok(
    String(h["content-type"] || "").startsWith("application/json"),
    `content-type is application/json\n  got: ${h["content-type"]}`
  );
  assert.strictEqual(h["anthropic-beta"], undefined, "the 1-hour TTL needs no beta header");
});

// ---------------------------------------------------------------------------
// row 7: the path
// ---------------------------------------------------------------------------

test("row 7: the request is POST <baseUrl>/messages, and an override base URL is honoured", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  await run(srv, { cachePrefix: PREFIX });
  assert.strictEqual(srv.requests[0].method, "POST");
  assert.strictEqual(
    srv.requests[0].url,
    "/v1/messages",
    "the base URL's own path is kept and /messages hangs off it"
  );

  // The same transport against a base with no /v1 proves the path is joined,
  // not hardcoded.
  const bare = await startServer((req, res) => okStream(res));
  t.after(bare.close);
  await run({ ...bare, baseUrl: bare.origin }, { cachePrefix: PREFIX });
  assert.strictEqual(bare.requests[0].url, "/messages", "an override base URL is honoured verbatim");
});

test("row 7 (default base): the anthropic preset is still https://api.anthropic.com/v1, so the default call is /v1/messages", () => {
  const p = MOD.cloud.CLOUD_PROVIDERS.anthropic;
  assert.ok(p, "the anthropic preset still exists");
  assert.strictEqual(
    p.baseUrl,
    "https://api.anthropic.com/v1",
    "the transport posts to <baseUrl>/messages, so the preset is what makes that /v1/messages"
  );
});

// MOVED by amendment C13 (ruled 2026-08-08 against the Claude API reference):
// `temperature` is REMOVED from the native Messages API on Claude Opus 5, Opus
// 4.8, Opus 4.7 and Fable 5 - sending it returns a 400 - and a non-default
// value is rejected on Sonnet 5. The contract listed it because the sibling
// compat client sends it; that layer accepts and drops the field, and this one
// does not. The row now asserts its ABSENCE, which is the load-bearing half.
test("extra (Request): the body is model, max_tokens, stream true, NO temperature, and no system message", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  await run(srv, { cachePrefix: PREFIX });
  const body = srv.requests[0].body;
  assert.strictEqual(body.model, BASE_PARAMS.model, "params.model, untranslated");
  assert.strictEqual(body.max_tokens, BASE_PARAMS.maxTokens);
  assert.ok(
    !("temperature" in body),
    `temperature returns a 400 on every current Claude model on this wire\n  got: ${JSON.stringify(body)}`
  );
  assert.ok(
    !("thinking" in body),
    `no thinking value is valid on every model, so the field is omitted entirely\n  got: ${JSON.stringify(body)}`
  );
  assert.strictEqual(body.stream, true, "this transport streams");
  assert.ok(
    !("system" in body),
    "there is no system message: prompt.ts carries the instruction and the prompt is the prompt"
  );
  assert.ok(!("tools" in body), "out of scope: one user message in, text out");
  assert.ok(!("thinking" in body), "out of scope: no thinking blocks");
});

// ---------------------------------------------------------------------------
// rows 8-9: the stream
// ---------------------------------------------------------------------------

test("row 8: text is assembled from content_block_delta frames in arrival order and reaches onChunk", async (t) => {
  const srv = await startServer((req, res) => {
    openSse(res);
    messageStart(res);
    frame(res, "ping", {});
    textDelta(res, "fn ");
    textDelta(res, "add");
    textDelta(res, "(a, b)");
    messageEnd(res);
  });
  t.after(srv.close);

  const chunks = [];
  const { out } = await run(srv, { onChunk: (c) => chunks.push(c) });
  assert.strictEqual(out.text, "fn add(a, b)", "arrival order, concatenated, nothing dropped and nothing reordered");
  assert.deepStrictEqual(chunks, ["fn ", "add", "(a, b)"], "each delta reaches onChunk as it lands");
});

test("row 9: ttftMs is the time to the first NON-EMPTY delta; totalMs covers the whole round", async (t) => {
  const srv = await startServer(async (req, res) => {
    openSse(res);
    messageStart(res);
    textDelta(res, ""); // an empty delta is not a first token
    await sleep(80);
    textDelta(res, "hel");
    textDelta(res, "lo");
    await sleep(60);
    messageEnd(res);
  });
  t.after(srv.close);

  const { out } = await run(srv);
  assert.strictEqual(out.text, "hello");
  assert.ok(out.ttftMs >= 60, `ttft lands at the first non-empty delta, not at message_start\n  got ${out.ttftMs}ms`);
  assert.ok(out.ttftMs < 140, `and not at the end of the stream\n  got ${out.ttftMs}ms`);
  assert.ok(
    out.totalMs >= out.ttftMs + 40,
    `totalMs covers the whole round, so it is well past ttft\n  ttft=${out.ttftMs} total=${out.totalMs}`
  );
});

test("extra (Response): a ping frame is ignored and never becomes text", async (t) => {
  const srv = await startServer((req, res) => {
    openSse(res);
    messageStart(res);
    frame(res, "ping", {});
    textDelta(res, "a + b");
    frame(res, "ping", {});
    messageEnd(res);
  });
  t.after(srv.close);
  const chunks = [];
  const { out } = await run(srv, { onChunk: (c) => chunks.push(c) });
  assert.strictEqual(out.text, "a + b", "ping carries no meaning");
  assert.deepStrictEqual(chunks, ["a + b"], "and reaches no consumer");
});

// ---------------------------------------------------------------------------
// row 10: stop_reason maps onto the vocabulary the service guards on
// ---------------------------------------------------------------------------

const STOP_REASONS = [
  { wire: "max_tokens", want: "length", why: "the fn-gen service rejects a truncated body on this token" },
  { wire: "end_turn", want: "stop", why: "a clean finish" },
  { wire: "refusal", want: "refusal", why: "a reason nobody has seen must not read as a clean finish" },
];

for (const s of STOP_REASONS) {
  test(`row 10: stop_reason ${s.wire} surfaces as doneReason ${s.want}`, async (t) => {
    const srv = await startServer((req, res) => okStream(res, { stopReason: s.wire }));
    t.after(srv.close);
    const { out } = await run(srv);
    assert.strictEqual(out.doneReason, s.want, `${s.why}\n  got: ${out.doneReason}`);
  });
}

// ---------------------------------------------------------------------------
// row 11: usage arrives in two frames and is merged
// ---------------------------------------------------------------------------

// The six accounting field names are phase 1's. Row 12 is what pins them: the
// accounting here must be byte-identical to what the Claude Code backend
// renders, so a rename would fail there first.
const ACCOUNTING_RE = /(?:^|\s)in=(\S+) out=(\S+) cwrite=(\S+) cread=(\S+) ttl=(\S+) billed-eq=(\S+)/;

test("row 11: usage from message_start and message_delta is merged, so the line carries the cache fields AND a non-zero out", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const { lines } = await run(srv, { cachePrefix: PREFIX });
  const line = evidenceLine(lines);
  const head = headOf(line);

  assert.strictEqual(field(line, "in"), String(USAGE_START.input_tokens), `in comes from message_start\n  got: ${line}`);
  assert.strictEqual(
    field(line, "cwrite"),
    String(USAGE_START.cache_creation_input_tokens),
    `cwrite comes from message_start\n  got: ${line}`
  );
  assert.strictEqual(
    field(line, "cread"),
    String(USAGE_START.cache_read_input_tokens),
    `cread comes from message_start\n  got: ${line}`
  );
  assert.strictEqual(
    field(line, "out"),
    String(OUT_TOKENS),
    `out comes from message_delta: rendering from message_start alone reports out=0 every round\n  got: ${line}`
  );
  assert.ok(ACCOUNTING_RE.test(head.accounting), `the accounting is rendered once, at the end\n  got: ${line}`);
});

test("extra (Evidence): cache-mark reports what was SENT, and does not infer from cwrite or cread", async (t) => {
  // Two fields, two jobs. A round that marked and cached nothing still says yes.
  const srv = await startServer((req, res) =>
    okStream(res, {
      usage: {
        input_tokens: 7,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
      },
    })
  );
  t.after(srv.close);

  const marked = await run(srv, { cachePrefix: PREFIX });
  const line = evidenceLine(marked.lines);
  assert.strictEqual(headOf(line).mark, "yes", `a marker went out, so cache-mark is yes\n  got: ${line}`);
  assert.strictEqual(field(line, "cwrite"), "0", "and the accounting is free to say the cache paid nothing");
  assert.strictEqual(field(line, "cread"), "0");

  const plain = await run(srv);
  assert.strictEqual(headOf(evidenceLine(plain.lines)).mark, "no", "no marker sent, so cache-mark is no");
});

test("extra (Evidence): the line names the model and its timings agree with the returned result", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);
  const { out, lines } = await run(srv, { cachePrefix: PREFIX });
  const head = headOf(evidenceLine(lines));
  assert.strictEqual(head.model, BASE_PARAMS.model, "model= is the id that was asked for");
  assert.strictEqual(head.ttft, out.ttftMs, "ttft= on the line is the ttftMs the round returned");
  assert.strictEqual(head.total, out.totalMs, "total= on the line is the totalMs the round returned");
});

// ---------------------------------------------------------------------------
// row 12: one renderer, so a human reads one format on both backends
// ---------------------------------------------------------------------------

const tmpDirs = [];
function tmpDir(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
}
test.after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// A single-spawn fake `claude`, the same mechanism blind-v44-fork.test.cjs uses,
// trimmed to what this row needs: serve one canned result JSON.
const CC_SHIM = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const reply = fs.readFileSync(path.join(dir, "reply.json"), "utf8");
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", () => {
  fs.writeFileSync(path.join(dir, "stdin.bin"), Buffer.concat(chunks));
  process.stdout.write(reply);
});
`;

// The SAME numbers the Messages fixture reports, arranged the way the CLI
// reports them.
const CC_USAGE = {
  input_tokens: USAGE_START.input_tokens,
  output_tokens: OUT_TOKENS,
  cache_creation_input_tokens: USAGE_START.cache_creation_input_tokens,
  cache_read_input_tokens: USAGE_START.cache_read_input_tokens,
  cache_creation: USAGE_START.cache_creation,
};

async function claudeCodeAccounting() {
  const ns = MOD.claudeCode;
  assert.ok(
    ns && typeof ns.makeClaudeCodeInstruct === "function",
    "harness: this row drives the Claude Code backend, which must export makeClaudeCodeInstruct"
  );
  const dir = tmpDir("c80-v44a-cc-");
  fs.writeFileSync(
    path.join(dir, "reply.json"),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 1,
      session_id: "sid-0123456789abcdef",
      total_cost_usd: 0.01,
      ttft_ms: 111,
      duration_ms: 222,
      stop_reason: "end_turn",
      result: "a + b",
      usage: CC_USAGE,
    })
  );
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, CC_SHIM, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);

  const cwd = tmpDir("c80-v44a-cwd-");
  const lines = [];
  const fn = ns.makeClaudeCodeInstruct({ cwd, binary: bin, log: (l) => lines.push(String(l)) });
  await withConsole(lines, () =>
    fn({ ...BASE_PARAMS, prompt: PROMPT, signal: new AbortController().signal })
  );

  const hits = lines.filter((l) => l.trimStart().startsWith("[claude-code]") && ACCOUNTING_RE.test(l));
  assert.strictEqual(
    hits.length,
    1,
    `harness: exactly one [claude-code] round line carrying the accounting\n  got: ${JSON.stringify(lines)}`
  );
  // The accounting terminates the line on that backend, so its tail from the
  // first field onward is what the two lines have to share.
  const m = hits[0].match(ACCOUNTING_RE);
  return hits[0].slice(hits[0].indexOf("in=", m.index)).trim();
}

test("row 12: the accounting on the [anthropic] line is byte-identical to what the Claude Code backend renders for the same numbers", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const { lines } = await run(srv, { cachePrefix: PREFIX });
  const mine = headOf(evidenceLine(lines)).accounting.trim();
  const theirs = await claudeCodeAccounting();

  assert.strictEqual(
    mine,
    theirs,
    "one renderer, so a human reads one format on both backends and phase 4 parses one format\n" +
      `  [anthropic]:   ${mine}\n` +
      `  [claude-code]: ${theirs}`
  );
});

// ---------------------------------------------------------------------------
// rows 13-14: failures
// ---------------------------------------------------------------------------

test("row 13: a 401 rejects carrying the provider's own message, and the API key is not in what is thrown", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
  });
  t.after(srv.close);

  await assert.rejects(
    run(srv, { cachePrefix: PREFIX }),
    (err) => {
      const seen = `${err.name}\n${err.message}\n${err.stack || ""}\n${JSON.stringify(err, Object.getOwnPropertyNames(err))}`;
      assert.ok(err instanceof Error, "a non-2xx throws an Error");
      assert.ok(/invalid x-api-key/.test(err.message), `it carries the provider's own message\n  got: ${err.message}`);
      assert.ok(!seen.includes(KEY), "the API key is never in what is thrown");
      assert.ok(!seen.includes(KEY.slice(-12)), "not even its tail");
      return true;
    }
  );
});

test("row 13 (other statuses): a 500 rejects with the provider's message too", async (t) => {
  const srv = await startServer((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "overloaded, try later" } }));
  });
  t.after(srv.close);
  await assert.rejects(run(srv), (err) => /overloaded, try later/.test(err.message));
});

test("row 14: an error frame mid-stream rejects with the provider's message", async (t) => {
  const srv = await startServer(async (req, res) => {
    openSse(res);
    messageStart(res);
    textDelta(res, "half a fn");
    await sleep(20);
    frame(res, "error", { error: { type: "overloaded_error", message: "stream fell over mid-round" } });
    try {
      res.end();
    } catch {
      /* peer gone */
    }
  });
  t.after(srv.close);

  await assert.rejects(
    run(srv, { cachePrefix: PREFIX }),
    (err) => {
      assert.ok(err instanceof Error, "an error frame is a failed round, not a short one");
      assert.ok(
        /stream fell over mid-round/.test(err.message),
        `it rejects with the provider's own message\n  got: ${err.message}`
      );
      return true;
    }
  );
});

test("row 15: an abort mid-stream rejects with an AbortError and releases the connection", async (t) => {
  const srv = await startServer((req, res) => {
    openSse(res);
    messageStart(res);
    textDelta(res, "fn ");
    // and never finishes
  });
  t.after(srv.close);

  const ac = new AbortController();
  const fn = makeAnthropicInstruct({ baseUrl: srv.baseUrl, apiKey: KEY, log: () => {} });
  const p = fn({ ...BASE_PARAMS, prompt: PROMPT, cachePrefix: PREFIX, signal: ac.signal });
  await waitFor(() => srv.requests.length === 1, 3000, "the request to reach the fixture");
  setTimeout(() => ac.abort(), 30);

  await assert.rejects(p, (err) => {
    assert.strictEqual(err.name, "AbortError", `an aborted round keeps the platform contract\n  got: ${err.name}: ${err.message}`);
    return true;
  });
  await waitFor(() => srv.requests[0].closed, 3000, "the connection to be released on abort");
});

// ---------------------------------------------------------------------------
// row 16: the other four providers do not move
// ---------------------------------------------------------------------------

const CLOUD_PARAMS = {
  apiBase: "unused-for-cloud",
  model: "some-frontier-model",
  prompt: PROMPT,
  maxTokens: 512,
  temperature: 0.2,
};

function openAiSse(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  put(res, `data: ${JSON.stringify({ choices: [{ delta: { content: "a + b" }, finish_reason: null }] })}\n\n`);
  put(res, `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
  put(res, "data: [DONE]\n\n");
  res.end();
}

test("row 16: the existing cloud client's request is unchanged by this phase - same bytes with and without cachePrefix, no marker, still Bearer", async (t) => {
  const srv = await startServer((req, res) => openAiSse(res));
  t.after(srv.close);

  const call = (extra) =>
    MOD.cloud.makeCloudInstruct({ baseUrl: srv.baseUrl, apiKey: "sk-cloud-key" })({
      ...CLOUD_PARAMS,
      signal: new AbortController().signal,
      ...extra,
    });

  await call({});
  await call({ cachePrefix: PREFIX });

  assert.strictEqual(srv.requests.length, 2, "one POST each");
  const [plain, marked] = srv.requests;
  assert.strictEqual(plain.url, "/v1/chat/completions", "the compat layer's endpoint, untouched");
  assert.strictEqual(marked.url, plain.url, "same endpoint either way");
  assert.strictEqual(marked.method, plain.method);
  assert.strictEqual(
    marked.raw,
    plain.raw,
    "OUT of scope: the other four providers' request bodies must not change by one byte"
  );
  assert.strictEqual(markerCount(marked), 0, "the compat layer has no cache_control field, so nothing may be sent");
  assert.ok(!marked.raw.includes("cachePrefix"), "and the param must not leak into the body");
  assert.strictEqual(marked.headers.authorization, "Bearer sk-cloud-key", "the compat scheme stays Bearer");
  assert.strictEqual(marked.headers["x-api-key"], undefined, "the Messages scheme must not bleed into this client");
  assert.strictEqual(marked.headers["anthropic-version"], undefined, "nor its version header");
});

test("row 16 (presets): openai, xai, gemini and openai-compatible still resolve through the existing client", () => {
  const { CLOUD_PROVIDERS, OPENAI_COMPATIBLE, makeCloudInstruct } = MOD.cloud;
  assert.strictEqual(typeof makeCloudInstruct, "function", "the existing client is still exported");
  for (const id of ["openai", "xai", "gemini"]) {
    const p = CLOUD_PROVIDERS[id];
    assert.ok(p && /^https:\/\//.test(p.baseUrl), `${id} keeps its preset base URL`);
  }
  assert.strictEqual(OPENAI_COMPATIBLE, "openai-compatible", "the fourth is the user-supplied compat surface");
});

// ---------------------------------------------------------------------------
// row 17: prefix stability, which is a claim about the other providers too
// ---------------------------------------------------------------------------

const BLOCKS = [
  { uri: "file:///w/a.rs", range: { startLine: 3, endLine: 9 }, text: "struct Acc;\nSENTINEL_BLOCK_ALPHA" },
  { uri: "file:///w/b.rs", range: { startLine: 1, endLine: 4 }, text: "fn helper() {}\nSENTINEL_BLOCK_BETA" },
];
const FNGEN_A = { signature: "fn add(a: i32, b: i32) -> i32", docComment: "/// Adds.", languageId: "rust" };
const FNGEN_B = { signature: "fn mul(a: i32, b: i32) -> i32", docComment: "/// Multiplies.", languageId: "rust" };

const commonPrefixLen = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

test("row 17: two assembleFnGenPrompt calls with the same blocks and different targets are byte-identical up to their first legitimate divergence", async () => {
  const P = MOD.prompt;
  assert.strictEqual(typeof P.assembleFnGenPrompt, "function", "prompt.ts exports assembleFnGenPrompt");

  const a = P.assembleFnGenPrompt({ ...FNGEN_A, contextBlocks: BLOCKS });
  const b = P.assembleFnGenPrompt({ ...FNGEN_B, contextBlocks: BLOCKS });
  const shared = a.slice(0, commonPrefixLen(a, b));

  // The only legitimate divergence is the target. Everything the blocks render
  // to has to sit inside the shared head, or implicit prefix matching on OpenAI
  // and Gemini never hits, and phase 2's fork key changes for no reason.
  assert.ok(
    shared.includes("SENTINEL_BLOCK_ALPHA") && shared.includes("SENTINEL_BLOCK_BETA"),
    "both blocks render inside the shared head\n" +
      `  shared head (${shared.length} chars): ${JSON.stringify(shared.slice(0, 300))}`
  );
  assert.ok(
    !shared.includes(FNGEN_A.signature) && !shared.includes(FNGEN_B.signature),
    "and the divergence is the target itself, not something before it"
  );

  if (typeof P.renderContextPrefix === "function") {
    const rendered = P.renderContextPrefix(BLOCKS);
    assert.ok(shared.startsWith(rendered), "the shared head opens with exactly the rendered blocks");
    assert.ok(a.startsWith(rendered) && b.startsWith(rendered), "both prompts lead with the blocks");
  }
});

test("row 17 (nothing varies run to run): the same input assembled twice, seconds apart, is byte-identical", async () => {
  const P = MOD.prompt;
  const input = { ...FNGEN_A, contextBlocks: BLOCKS };
  const first = P.assembleFnGenPrompt(input);
  await sleep(1100);
  const second = P.assembleFnGenPrompt(input);
  assert.strictEqual(
    second,
    first,
    "no timestamps: a clock in the prompt would miss every cache and change the fork key every round"
  );

  // A fresh object graph with the same content, in case identity is what held
  // the two calls together above.
  const rebuilt = JSON.parse(JSON.stringify(BLOCKS));
  assert.strictEqual(
    P.assembleFnGenPrompt({ ...FNGEN_A, contextBlocks: rebuilt }),
    first,
    "no set iteration order and no map ordering: equal content assembles to equal bytes"
  );
});

test("row 17 (the head really is content-addressed): reordering or editing the blocks changes the head, and only the head", async () => {
  const P = MOD.prompt;
  const base = P.assembleFnGenPrompt({ ...FNGEN_A, contextBlocks: BLOCKS });
  const reordered = P.assembleFnGenPrompt({ ...FNGEN_A, contextBlocks: [BLOCKS[1], BLOCKS[0]] });
  const edited = P.assembleFnGenPrompt({
    ...FNGEN_A,
    contextBlocks: [{ ...BLOCKS[0], text: `${BLOCKS[0].text}!` }, BLOCKS[1]],
  });
  assert.notStrictEqual(reordered, base, "a different block order is different bytes, which is the server's cache miss");
  assert.notStrictEqual(edited, base, "an edit inside a pinned range is different bytes");
});

// ---------------------------------------------------------------------------
// extras: prose the numbered rows do not reach
// ---------------------------------------------------------------------------

test("extra (No client-side state): a second round with the same prefix sends the same request, and the transport keeps nothing between rounds", async (t) => {
  // "The SERVER keys its cache on content." There is no session id, no hash, no
  // invalidation. Two identical rounds are two identical requests, and a round
  // with a CHANGED prefix is not affected by what came before it.
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const fn = makeAnthropicInstruct({ baseUrl: srv.baseUrl, apiKey: KEY, log: () => {} });
  const call = (extra) => fn({ ...BASE_PARAMS, prompt: PROMPT, signal: new AbortController().signal, ...extra });

  await call({ cachePrefix: PREFIX });
  await call({ cachePrefix: PREFIX });
  assert.strictEqual(srv.requests.length, 2, "one round is one request: no warm-up round, no second turn");
  assert.strictEqual(srv.requests[1].raw, srv.requests[0].raw, "the second round sends the same bytes as the first");

  const other = `${PREFIX}// one more line\n`;
  await call({ prompt: `${other}\n\n${TAIL}`, cachePrefix: other });
  assert.strictEqual(srv.requests.length, 3, "still one request per round");
  const blocks = contentOf(srv.requests[2]);
  assert.strictEqual(blocks.length, 2, "a changed prefix simply finds no server-side match");
  assert.strictEqual(blocks[0].text, other, "and the marker follows the NEW bytes, with nothing carried over");
});

test("extra (Scope): a fresh instance behaves identically to a used one, because there is nothing to grow", async (t) => {
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const one = makeAnthropicInstruct({ baseUrl: srv.baseUrl, apiKey: KEY, log: () => {} });
  await one({ ...BASE_PARAMS, prompt: PROMPT, cachePrefix: PREFIX, signal: new AbortController().signal });
  const two = makeAnthropicInstruct({ baseUrl: srv.baseUrl, apiKey: KEY, log: () => {} });
  await two({ ...BASE_PARAMS, prompt: PROMPT, cachePrefix: PREFIX, signal: new AbortController().signal });

  assert.strictEqual(srv.requests.length, 2);
  assert.strictEqual(srv.requests[1].raw, srv.requests[0].raw, "no per-instance state can make two identical rounds differ");
});

test("extra (rule 6, read literally): the gate is startsWith, so a prefix followed by ONE newline still splits", async (t) => {
  // GAP 3. Phase 2 required `prefix + "\n\n"` because it had to strip the
  // separator; this contract requires only that the prefix IS a prefix, and the
  // REST carries whatever follows. A transport that ports phase 2's gate here
  // sends every real round unmarked, so the two readings are worth telling
  // apart in the run.
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const prompt = `${PREFIX}\n${TAIL}`;
  assert.ok(prompt.startsWith(PREFIX), "fixture: it is a prefix");
  assert.ok(!prompt.startsWith(`${PREFIX}\n\n`), "fixture: but not phase 2's separator");

  await run(srv, { prompt, cachePrefix: PREFIX });
  const blocks = contentOf(srv.requests[0]);
  assert.strictEqual(
    blocks.length,
    2,
    `rule 6 gates on "the prefix IS a prefix", nothing more\n  got: ${JSON.stringify(blocks).slice(0, 300)}`
  );
  assert.strictEqual(blocks[0].text + blocks[1].text, prompt, "and the rest carries the separator, whatever it is");
});

test("extra (GAP 4): an empty cachePrefix never throws, never sends an empty marked block, and still reconstructs the prompt", async (t) => {
  // The contract does not say which side of "genuinely a prefix" an empty
  // string falls on. What holds under BOTH readings is asserted here; the
  // choice itself is reported as a gap rather than guessed at.
  const srv = await startServer((req, res) => okStream(res));
  t.after(srv.close);

  const { out } = await run(srv, { cachePrefix: "" });
  const rec = srv.requests[0];
  const blocks = contentOf(rec);
  assert.strictEqual(blocks.map((b) => b.text).join(""), PROMPT, "rule 6 holds either way");
  assert.ok(markerCount(rec) <= 1, "rule 1: never more than one breakpoint");
  for (const b of blocks) {
    assert.ok(b.text.length > 0, `an empty text block is not a message the API accepts\n  got: ${JSON.stringify(blocks)}`);
  }
  assert.strictEqual(out.text, "a + b", "and the round succeeds");
});
