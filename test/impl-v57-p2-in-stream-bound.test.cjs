// Implementer oracle, session-v57 phase 2 (roadmap item 63, first string):
// gaps the blind file leaves open.
//
// The blind file proves the four in-200 sites from outside: a 100KB payload is
// cut with a marker, a short one is untouched, and all four land on the same
// budget as the HTTP bodies phase 1 bounded. What it cannot see, because it was
// written against the contract alone:
//   * THE UNTRUSTED WIRE. The fix calls a string function on a field the server
//     controls. `StreamEvent.error` and `PullEvent.error` are TYPED string and
//     nothing validates them, so a server answering `{"error":{"code":500}}`
//     used to interpolate "[object Object]" and now reaches a bound that would
//     throw on a missing .length. Every non-string shape is driven here: object,
//     number, array, boolean. A crash in the stream reader is worse than the
//     100KB toast this phase exists to remove.
//   * THE PROGRESS FRACTION, which shares an event with the bounded string. The
//     percentage is computed from `digest`/`total`/`completed` on the SAME
//     event whose `status` is now cut. A bound applied to the wrong thing, or
//     applied to the event rather than the callback argument, would move the
//     progress bar. Driven with an over-budget status and a real layer set.
//   * THE BOUNDARY, on the in-200 sites. One char under the budget, exactly on
//     it, one over. The one-over row is the only one that proves the cut fires
//     at the budget rather than at some larger convenience size.
//   * THE STREAM STILL WORKS. Bounding sits inside the per-line reader on the
//     hot path. A 200 that carries no error at all must still stream its text
//     out unchanged, and a pull that carries no error must still report its
//     layers.
//   * THE STRUCTURAL PIN. Every read of a server-controlled `error` or `status`
//     that reaches a user surface must go through the bound. A source-text row
//     goes red if one is added back raw.
//
// Run: node --test test/impl-v57-p2-in-stream-bound.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { bundleCore } = require("./.blind-util.cjs");

const SRC = path.join(__dirname, "..", "src", "core");

const core = bundleCore(
  "impl-v57-p2-core",
  `export { generateInstruct, pullModel } from "../src/core/ollama";\n` +
    `export { makeAnthropicInstruct } from "../src/core/anthropicInstruct";\n` +
    `export { ERROR_BODY_CHARS } from "../src/core/errorBound";\n`,
);
const { generateInstruct, pullModel, makeAnthropicInstruct, ERROR_BODY_CHARS } = core.mod;

test.after(() => core.cleanup());

// ---------------------------------------------------------------------------
// Plumbing: a 200 that streams the lines it is given, then ends.
// ---------------------------------------------------------------------------

function streamServer(lines, contentType = "application/x-ndjson") {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": contentType });
    for (const line of lines) {
      res.write(line);
    }
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const ndjson = (obj) => `${JSON.stringify(obj)}\n`;
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

const PARAMS = (base) => ({
  apiBase: base,
  model: "test-model",
  prompt: "write a function",
  maxTokens: 64,
  temperature: 0,
  signal: new AbortController().signal,
});

async function throwsFrom(fn) {
  try {
    await fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// THE UNTRUSTED WIRE. The field is typed string; the server is not bound by
// the type. Nothing here may throw a TypeError out of the stream reader.
// ---------------------------------------------------------------------------

const HUGE = "x".repeat(ERROR_BODY_CHARS * 250);

const NON_STRINGS = [
  ["an object", { code: 500, detail: HUGE }],
  ["a number", 42],
  // AN ARRAY IS THE SHAPE THAT MATTERS. It has a .length, so it passes the
  // budget check untouched if the coercion is dropped, and the template then
  // stringifies the whole thing. "fails cleanly" would report success on the
  // exact 100KB state this phase exists to remove, so width is asserted too.
  ["an array", [HUGE, HUGE]],
  ["a boolean", true],
];

function assertBounded(msg, label, value) {
  const payload = JSON.stringify(value);
  if (payload.length <= ERROR_BODY_CHARS) {
    return;
  }
  assert.ok(
    msg.length <= 2048,
    `a non-string error field (${label}) must be bounded like any other, got ${msg.length} chars. ` +
      "An array has a .length, so it slips past a budget check applied before the coercion.",
  );
}

for (const [label, value] of NON_STRINGS) {
  test(`untrusted wire [generate] a non-string error field, ${label}, fails cleanly`, async () => {
    const srv = await streamServer([ndjson({ error: value })]);
    try {
      const msg = await throwsFrom(() => generateInstruct(PARAMS(srv.base)));
      assert.ok(msg !== undefined, "the stream must still fail, not swallow the error");
      assert.ok(
        !/is not a function|Cannot read propert|undefined/.test(msg),
        `the reader must not crash on a shape the server chose: ${msg}`,
      );
      assert.ok(msg.startsWith("Ollama error:"), `the failure keeps its own wording: ${msg}`);
      assertBounded(msg, label, value);
    } finally {
      await srv.close();
    }
  });

  test(`untrusted wire [pull] a non-string error field, ${label}, fails cleanly`, async () => {
    const srv = await streamServer([ndjson({ error: value })]);
    try {
      const msg = await throwsFrom(() =>
        pullModel(srv.base, "test-model", new AbortController().signal, () => undefined),
      );
      assert.ok(msg !== undefined, "the pull must still fail");
      assert.ok(
        !/is not a function|Cannot read propert/.test(msg),
        `the reader must not crash on a shape the server chose: ${msg}`,
      );
      assertBounded(msg, label, value);
    } finally {
      await srv.close();
    }
  });
}

test("untrusted wire [pull] a non-string status field does not crash the progress callback", async () => {
  const srv = await streamServer([
    ndjson({ status: { phase: "pulling" }, digest: "sha:1", total: 100, completed: 50 }),
    ndjson({ status: "success" }),
  ]);
  const seen = [];
  try {
    await pullModel(srv.base, "test-model", new AbortController().signal, (f, s) => seen.push([f, s]));
  } finally {
    await srv.close();
  }
  assert.ok(seen.length >= 1, "progress must still be reported");
  for (const [, s] of seen) {
    assert.strictEqual(typeof s, "string", "the callback's status argument must always be a string");
  }
});

// ---------------------------------------------------------------------------
// THE PROGRESS FRACTION. It rides the same event as the bounded status.
// ---------------------------------------------------------------------------

test("the bound cuts the status and leaves the progress fraction exact", async () => {
  const long = "s".repeat(ERROR_BODY_CHARS * 250);
  const srv = await streamServer([
    ndjson({ status: long, digest: "sha:a", total: 200, completed: 50 }),
    ndjson({ status: long, digest: "sha:b", total: 200, completed: 150 }),
  ]);
  const seen = [];
  try {
    await pullModel(srv.base, "test-model", new AbortController().signal, (f, s) => seen.push([f, s]));
  } finally {
    await srv.close();
  }
  assert.strictEqual(seen.length, 2);
  // 50/200, then (50+150)/400. The bound must not touch either.
  assert.strictEqual(seen[0][0], 0.25, "first fraction");
  assert.strictEqual(seen[1][0], 0.5, "second fraction");
  for (const [, s] of seen) {
    assert.ok(s.length <= 2048, `the status must be bounded, got ${s.length}`);
    assert.ok(/elided/.test(s), "and must say it was cut");
  }
});

// ---------------------------------------------------------------------------
// THE BOUNDARY, on the in-200 sites.
// ---------------------------------------------------------------------------

const IN_200_ARMS = [
  {
    name: "ollama-generate",
    drive: async (base) => throwsFrom(() => generateInstruct(PARAMS(base))),
    lines: (payload) => [ndjson({ error: payload })],
  },
  {
    name: "ollama-pull",
    drive: async (base) =>
      throwsFrom(() => pullModel(base, "test-model", new AbortController().signal, () => undefined)),
    lines: (payload) => [ndjson({ error: payload })],
  },
  {
    name: "anthropic-sse",
    drive: async (base) =>
      throwsFrom(() => makeAnthropicInstruct({ baseUrl: base, apiKey: "k" })(PARAMS(base))),
    lines: (payload) => [sse({ type: "error", error: { type: "overloaded_error", message: payload } })],
    contentType: "text/event-stream",
  },
];

for (const arm of IN_200_ARMS) {
  for (const [label, size, cut] of [
    ["one under", ERROR_BODY_CHARS - 1, false],
    ["exactly on", ERROR_BODY_CHARS, false],
    ["one over", ERROR_BODY_CHARS + 1, true],
  ]) {
    test(`boundary [${arm.name}] ${label} the budget: ${cut ? "cut" : "verbatim"}`, async () => {
      const payload = "q".repeat(size);
      const srv = await streamServer(arm.lines(payload), arm.contentType);
      try {
        const msg = await arm.drive(srv.base);
        assert.ok(msg !== undefined, "the arm must throw");
        assert.strictEqual(
          /elided/.test(msg),
          cut,
          `a payload of ${size} against a budget of ${ERROR_BODY_CHARS} must ${cut ? "" : "NOT "}be cut`,
        );
        if (!cut) {
          assert.ok(msg.includes(payload), "a payload inside the budget survives verbatim");
        }
      } finally {
        await srv.close();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// THE STREAM STILL WORKS. The bound sits in the per-line reader.
// ---------------------------------------------------------------------------

test("a clean 200 generate stream still returns its text, unchanged", async () => {
  const srv = await streamServer([
    ndjson({ response: "fn main" }),
    ndjson({ response: "() {}" }),
    ndjson({ done: true, done_reason: "stop" }),
  ]);
  try {
    const out = await generateInstruct(PARAMS(srv.base));
    assert.strictEqual(out.text, "fn main() {}");
  } finally {
    await srv.close();
  }
});

test("a clean 200 pull stream still reports its layers", async () => {
  const srv = await streamServer([
    ndjson({ status: "pulling manifest" }),
    ndjson({ status: "pulling", digest: "sha:a", total: 400, completed: 100 }),
    ndjson({ status: "success" }),
  ]);
  const seen = [];
  try {
    await pullModel(srv.base, "test-model", new AbortController().signal, (f, s) => seen.push([f, s]));
  } finally {
    await srv.close();
  }
  assert.deepStrictEqual(
    seen,
    [
      [undefined, "pulling manifest"],
      [0.25, "pulling"],
      [0.25, "success"],
    ],
    "an ordinary pull is byte-identical to what it was before the bound",
  );
});

// ---------------------------------------------------------------------------
// THE STRUCTURAL PIN.
// ---------------------------------------------------------------------------

test("every in-200 server string that reaches a user surface goes through the bound", () => {
  const ollama = fs.readFileSync(path.join(SRC, "ollama.ts"), "utf8");
  const anthropic = fs.readFileSync(path.join(SRC, "anthropicInstruct.ts"), "utf8");
  for (const [file, src, raw] of [
    ["ollama.ts", ollama, ["`Ollama error: ${evt.error}`", "throw new Error(evt.error)", "progress.note(evt), evt.status"]],
    ["anthropicInstruct.ts", anthropic, ["${evt.error?.message ?? evt.error?.type ?? \"unknown\"}"]],
  ]) {
    for (const form of raw) {
      assert.ok(
        !src.includes(form),
        `${file} must not interpolate ${JSON.stringify(form)} raw. A failure inside a 200 never ` +
          "passes through an HTTP error body, so the transport-level bound never sees it, and the " +
          "string is one line, which is how a toast bounded to one line came to be 100KB wide.",
      );
    }
  }
  // RE-READ, session-v59 phase 2. The count used to be three - the generate
  // error, the pull error, and the pull status - all coerced with `String()`.
  // The two ERROR sites now take `providerReason` for the reason the anthropic
  // note below gives, which is the same fix one arm over (scrap S58-9), so the
  // `String()` count is one and the shape of what is asserted has to say which
  // site is which rather than count them all together.
  //
  // WHAT THIS ROW IS ABOUT IS UNCHANGED: every in-200 server string that
  // reaches a user surface passes a bound. It is now pinned per site, which is
  // stricter than the total ever was - a swap that moved a site from one
  // coercion to the other used to keep the count at three.
  assert.strictEqual(
    (ollama.match(/boundBody\(providerReason\(evt\.error\)\)/g) ?? []).length,
    2,
    "ollama.ts's two in-200 ERROR sites - the generate reader and the pull reader - both bound the " +
      "provider's own reason. The pull path shares the generate path's coercion and moves with it.",
  );
  assert.strictEqual(
    (ollama.match(/boundBody\(String\(/g) ?? []).length,
    1,
    "the pull STATUS phrase is the one site left on String(): it is a progress message rather than " +
      "an error, so `providerReason`'s message/type chain has nothing to read. It is still bounded.",
  );
  // session-v58 phase 4: the coercion inside the bound moved from
  // `String(evt.error?.message ?? evt.error?.type ?? "unknown")` to
  // `providerReason(evt.error)`, because the old chain assumed a shape the wire
  // does not guarantee - it lost the reason entirely on a string envelope, let
  // an empty `message` hide a named `type`, and could make `String()` itself
  // throw a TypeError out of the reader. What this row pins is unchanged and is
  // the reason it exists: the frame's payload reaches the screen BOUNDED.
  assert.ok(
    /boundBody\(providerReason\(evt\.error\)\)/.test(anthropic),
    "anthropicInstruct.ts must bound its SSE error frame. A later phase gives this site a translated " +
      "sentence, and a translation is not a bound: a marker reworded out of the table would put the " +
      "whole payload back on the screen.",
  );
});
