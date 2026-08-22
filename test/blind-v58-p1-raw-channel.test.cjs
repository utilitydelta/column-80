// Blind oracle, session-v58 phase 1 (roadmap item 69, first shape): the
// channel keeps the raw body.
//
// Written against the phase 1 contract ALONE, before the change
// exists. Every row here is expected RED on the branch point and GREEN after
// the phase lands. Nothing in this file was written by reading a reader loop,
// fnGen.ts or fnGenService.ts.
//
// WHAT THIS PINS
//
//   * C1/C2/C3. A 102400-char 500 body reaches the log sink at the transport,
//     not the 400-char bound the toast gets. The logged copy carries the body's
//     HEAD and an elision note, is wider than ERROR_BODY_CHARS by a wide
//     margin, and is no wider than CHANNEL_BODY_CHARS plus the note plus a
//     modest line prefix. A cap that is not substantially larger than the toast
//     budget closes nothing, so the cap's own value is asserted too.
//   * C3 boundary. One under the cap, exactly on it, one over. The one-over row
//     is the only one that proves the cut fires AT the cap: its note must read
//     "[+1 chars elided]" exactly, which no larger convenience size produces.
//   * C4. A 200-char body reaches the channel whole, byte-for-byte, with no
//     note anywhere on the line.
//   * C5, THE ONE THAT MATTERS MOST. The four HTTP-status throw sites are a
//     published surface: fnGenService's channel copy, the toast, and every
//     session-v57 blind row that pins those strings. This phase adds a channel
//     line and rewords NOTHING. `String(err)` is compared byte-for-byte at all
//     four sites, for a short body and an over-budget one. The expected string
//     is DERIVED, never snapshotted: the row makes its own `fetch` against the
//     same server, reads `status`/`statusText` off a real `Response`, and
//     rebuilds the message with the product's own `boundBody`. A changed reason
//     phrase moves the expectation with the product instead of going falsely
//     red.
//   * C6. Each transport built with NO sink, driven through the same 500. It
//     must throw the byte-identical error and must not crash. This is the
//     regression a naive `config.log(...)` on an optional field causes, and
//     three of the four sites are getting that field for the first time in this
//     phase.
//   * C7. The line names the transport and carries the numeric status.
//   * THE HAPPY PATH. A successful request must put no response body on the
//     channel. A diagnostic that fires on every 200 is a worse channel than no
//     diagnostic. Driven with a sentinel token inside the streamed body.
//
// BINDINGS I HAD TO RESOLVE, and how
//
//   * `CHANNEL_BODY_CHARS` and `boundChannel` are named by the contract's seam
//     section but do not exist on the branch point. The entry re-exports
//     errorBound with `export *` rather than by name, because esbuild does not
//     typecheck: a named re-export of a missing symbol builds fine and yields
//     `undefined`, so either form would load. `export *` keeps the failure
//     where it belongs - in a guard assertion - instead of at module load. The
//     cap's VALUE is never guessed; every row reads it from the product.
//   * The channel line's wording is the phase's to craft, so no row matches a
//     literal prefix. Rows locate the line by the body it must carry and then
//     assert the contract's three required parts. See rawLine for why locating
//     by the body's HEAD alone is not enough on the anthropic arm.
//   * The transport's NAME (C7) is matched case-insensitively against the token
//     the throw sites already use: Ollama, Ollama, Anthropic, Cloud. The two
//     ollama sites share a name; the contract requires the transport's name,
//     not the endpoint's, so both accept /ollama/i.
//   * The log sinks: `params.log` for `generateInstruct`, a fifth positional
//     for `pullModel`, `config.log` for both makers. All four from the
//     contract's seam section. On the branch point the extra properties and the
//     extra argument are simply ignored by JS, so these rows go red on "no line
//     captured", which is the right reason.
//   * "Kilobyte-scale" (C2) is bound as `CHANNEL_BODY_CHARS >= 1024` and below
//     a megabyte. The exact value stays the phase's call.
//   * Line COUNT is not pinned. The contract says a line is written; it does
//     not say exactly one, and a retrying transport could honestly write two.
//     Rows assert at least one matching line.
//   * The happy-path row skips the anthropic arm. Building a successful
//     Messages-API SSE stream needs the frame shapes out of the reader loop,
//     which this oracle may not read. Ollama generate, ollama pull and the
//     OpenAI-compat cloud arm cover the principle.
//
// Run: node --test test/blind-v58-p1-raw-channel.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore } = require("./.blind-util.cjs");

const core = bundleCore(
  "blind-v58-p1-core",
  // `export *` on purpose - see BINDINGS above.
  `export * from "../src/core/errorBound";\n` +
    `export { generateInstruct, pullModel } from "../src/core/ollama";\n` +
    `export { makeAnthropicInstruct } from "../src/core/anthropicInstruct";\n` +
    `export { makeCloudInstruct } from "../src/core/cloudInstruct";\n`,
);
const {
  ERROR_BODY_CHARS,
  boundBody,
  CHANNEL_BODY_CHARS,
  boundChannel,
  generateInstruct,
  pullModel,
  makeAnthropicInstruct,
  makeCloudInstruct,
} = core.mod;

test.after(() => core.cleanup());

// ---------------------------------------------------------------------------
// The seam guard. CHANNEL_BODY_CHARS' value is the phase's to pick; this file
// never invents a fallback. Rows that need the cap call requireSeam() first so
// they fail with this sentence rather than on a TypeError against undefined.
// ---------------------------------------------------------------------------

const SEAM_MISSING =
  "errorBound.ts must export CHANNEL_BODY_CHARS (number) and boundChannel(body) - " +
  "the seam the contract fixes so an oracle does not have to guess the sink's name. " +
  `Got CHANNEL_BODY_CHARS=${String(CHANNEL_BODY_CHARS)}, boundChannel=${typeof boundChannel}.`;

const seamOk = typeof CHANNEL_BODY_CHARS === "number" && typeof boundChannel === "function";

function requireSeam() {
  assert.ok(seamOk, SEAM_MISSING);
}

test("C2 [seam]: errorBound exports a channel cap and a channel bound", () => {
  requireSeam();
  assert.ok(
    CHANNEL_BODY_CHARS > ERROR_BODY_CHARS,
    `the channel cap (${CHANNEL_BODY_CHARS}) must be strictly larger than the toast budget (${ERROR_BODY_CHARS})`,
  );
  assert.ok(
    CHANNEL_BODY_CHARS >= 1024,
    `C2 says kilobyte-scale; a cap of ${CHANNEL_BODY_CHARS} is still toast-scale and closes nothing`,
  );
  assert.ok(
    CHANNEL_BODY_CHARS < 1024 * 1024,
    `the channel is a UI surface; a cap of ${CHANNEL_BODY_CHARS} is not a cap`,
  );
});

test("C3 [seam]: boundChannel is boundBody's sibling at the channel cap", () => {
  requireSeam();
  const short = "y".repeat(CHANNEL_BODY_CHARS - 1);
  assert.strictEqual(boundChannel(short), short, "a body inside the cap passes through verbatim");
  const exact = "y".repeat(CHANNEL_BODY_CHARS);
  assert.strictEqual(boundChannel(exact), exact, "a body exactly at the cap is not cut");
  const over = "y".repeat(CHANNEL_BODY_CHARS + 1);
  assert.strictEqual(
    boundChannel(over),
    `${"y".repeat(CHANNEL_BODY_CHARS)} [+1 chars elided]`,
    "one char over the cap keeps the cap's worth and uses boundBody's own note shape",
  );
});

// ---------------------------------------------------------------------------
// Plumbing. One catch-all server so no row has to know a transport's path.
// ---------------------------------------------------------------------------

function serveAll(handler) {
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

const errorServer = (body, status = 500) =>
  serveAll((_req, res) => {
    res.writeHead(status, { "Content-Type": "text/plain" });
    res.end(body);
  });

const streamServer = (lines, contentType) =>
  serveAll((_req, res) => {
    res.writeHead(200, { "Content-Type": contentType });
    for (const line of lines) {
      res.write(line);
    }
    res.end();
  });

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

/** What the transport's own `fetch` sees, read off a real Response against the
 *  same server. C5's expectation is built from this, never from a snapshot. */
async function probe(base) {
  const res = await fetch(`${base}/probe`);
  return { status: res.status, statusText: res.statusText, body: await res.text() };
}

async function caught(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

// The four HTTP-status sites. `drive` takes an optional sink; on the branch
// point the extra field / extra argument is ignored, which is the red state.
const ARMS = [
  {
    name: "ollama-generate",
    who: /ollama/i,
    expect: (p) => `Ollama ${p.status} ${boundBody(p.statusText)}: ${boundBody(p.body)}`,
    drive: (base, log) => generateInstruct({ ...PARAMS(base), log }),
  },
  {
    name: "ollama-pull",
    who: /ollama/i,
    expect: (p) => `Ollama ${p.status} ${boundBody(p.statusText)}: ${boundBody(p.body)}`,
    drive: (base, log) =>
      pullModel(base, "test-model", new AbortController().signal, () => undefined, log),
  },
  {
    name: "anthropic",
    who: /anthropic/i,
    expect: (p) => `Anthropic ${p.status} ${boundBody(p.statusText)}: ${boundBody(p.body)}`,
    drive: (base, log) => makeAnthropicInstruct({ baseUrl: base, apiKey: "k", log })(PARAMS(base)),
  },
  {
    name: "cloud",
    who: /cloud/i,
    expect: (p) => `Cloud ${p.status} ${boundBody(p.statusText)}: ${boundBody(p.body)}`,
    drive: (base, log) => makeCloudInstruct({ baseUrl: base, apiKey: "k", log })(PARAMS(base)),
  },
];

/** Drives one arm against a 500 carrying `body`, returns the error and every
 *  line the sink received. */
async function drive500(arm, body) {
  const srv = await errorServer(body);
  const lines = [];
  try {
    const p = await probe(srv.base);
    const err = await caught(() => arm.drive(srv.base, (line) => lines.push(String(line))));
    return { err, lines, probed: p };
  } finally {
    await srv.close();
  }
}

/** The channel line, located by the body's own head rather than by a wording
 *  this oracle is not allowed to know.
 *
 *  THE ECHO, and it took two goes to exclude. The anthropic arm already owns a
 *  sink and already writes a `round=failed reason=<the thrown message>` line on
 *  this path. A locator that only looks for the body's head matches that echo,
 *  and C4/C7 then pass against a tree with no raw-body line in it at all -
 *  caught exactly that way while writing this file. Two independent guards,
 *  because the echo appears in two regimes:
 *    * the echo is COMPLETE - then it contains the thrown message in full, and
 *      a candidate that does is the echo, not the diagnostic;
 *    * the echo is SHORTENED, which is what anthropic's line actually does -
 *      then it holds the head but not the body's tail, and a candidate must
 *      carry `boundChannel(body)` entire, which is precisely what C3/C4 say the
 *      channel line carries.
 *  Neither guard can exclude a real raw-body line: it holds the whole bounded
 *  body and not the `Anthropic 500 <reason>: ` prefix the throw puts in front. */
function rawLine(lines, body, err) {
  const want = seamOk ? boundChannel(body) : body.slice(0, 80);
  const echo = err instanceof Error ? err.message : undefined;
  const hits = lines.filter((l) => l.includes(want) && !(echo && l.includes(echo)));
  assert.ok(
    hits.length >= 1,
    "C1: no logged line carries the server's body. The transport must write the raw body to its " +
      `log sink at the moment it arrives, before the bound builds the throw. Sink saw ${lines.length} ` +
      `line(s), none of them a raw-body line: ${JSON.stringify(lines.map((l) => l.slice(0, 160)))}`,
  );
  return hits[0];
}

const HUGE = "x".repeat(102400);
const SHORT = "s".repeat(200);
// Over the toast budget, inside the channel cap. The only size at which the two
// surfaces MUST disagree and neither carries a note.
const MID = "m".repeat(2000);
const NOTE = /\[\+\d+ chars elided\]/;

// ---------------------------------------------------------------------------
// C1 / C2 / C3. The 102400-char body from the contract's own measurement.
// ---------------------------------------------------------------------------

for (const arm of ARMS) {
  test(`C1 [${arm.name}]: a 102400-char 500 body reaches the channel, not the 400-char bound`, async () => {
    requireSeam();
    const { err, lines } = await drive500(arm, HUGE);
    assert.ok(err !== undefined, "the arm must still throw");
    const line = rawLine(lines, HUGE, err);

    // C1: the head of what the server actually sent.
    assert.ok(line.includes(HUGE.slice(0, 400)), "the line carries the body's head");
    // C3: and it says it cut.
    assert.ok(
      NOTE.test(line),
      `C3: a body over the cap must carry boundBody's elision note, got: ${line.slice(-200)}`,
    );
    // C2: substantially wider than the toast's copy. The toast's whole message
    // is a few hundred chars; a channel line that size closes nothing.
    assert.ok(
      line.length > ERROR_BODY_CHARS * 2,
      `C2: the channel copy (${line.length} chars) is no wider than the toast's ${ERROR_BODY_CHARS}-char ` +
        "bound doubled. The contract's whole failure is that both surfaces got the same 400 chars.",
    );
    // ...and still capped. Note plus a generous allowance for the line's own
    // prefix (transport name, status, whatever wording the phase picks).
    assert.ok(
      line.length <= CHANNEL_BODY_CHARS + 296,
      `C2: the channel copy (${line.length} chars) exceeds the cap (${CHANNEL_BODY_CHARS}) plus the note ` +
        "and a 256-char line prefix. The channel is a UI surface; a megabyte of HTML must not land in it.",
    );
    // The precise form the seam promises.
    assert.ok(
      line.includes(boundChannel(HUGE)),
      "the logged body is exactly boundChannel(body) - the seam's own function, at the seam's own cap",
    );
  });
}

// ---------------------------------------------------------------------------
// C4. A short body is untouched.
// ---------------------------------------------------------------------------

for (const arm of ARMS) {
  test(`C4 [${arm.name}]: a 200-char body is logged whole with no note`, async () => {
    requireSeam();
    const { err, lines } = await drive500(arm, SHORT);
    assert.ok(err !== undefined, "the arm must still throw");
    const line = rawLine(lines, SHORT, err);
    assert.ok(line.includes(SHORT), "C4: a body inside the cap reaches the channel byte-for-byte");
    assert.ok(
      !NOTE.test(line),
      `C4: a body inside the cap must carry NO elision note, or a short body and a cut one cannot be ` +
        `told apart: ${line}`,
    );
  });
}

// ---------------------------------------------------------------------------
// C1 + C4 together, at the only size where the two surfaces MUST disagree and
// neither carries a note: over the toast budget, inside the channel cap. A
// 200-char body cannot tell a channel line apart from an echo of the toast,
// because at that size the two are the same string. This one can.
// ---------------------------------------------------------------------------

for (const arm of ARMS) {
  test(`C1 [${arm.name}]: 2000 chars - the toast is cut, the channel is whole`, async () => {
    requireSeam();
    const { err, lines } = await drive500(arm, MID);
    assert.ok(err !== undefined, "the arm must still throw");
    assert.ok(NOTE.test(err.message), "the throw is cut at the toast budget");
    assert.ok(
      !err.message.includes(MID),
      "the throw cannot carry all 2000 chars - that is the bound the toast depends on",
    );
    const line = rawLine(lines, MID, err);
    assert.ok(
      line.includes(MID),
      `C1/C4: the channel holds the whole 2000-char body. This is the phase: "The full message is in ` +
        `the output channel" is only true if the channel outranks the toast. Got ${line.length} chars.`,
    );
    assert.ok(!NOTE.test(line), `C4: 2000 is inside the ${CHANNEL_BODY_CHARS}-char cap, so no note`);
  });
}

// ---------------------------------------------------------------------------
// C3 boundary. One under, exactly on, one over. The one-over row is the proof.
// ---------------------------------------------------------------------------

for (const arm of ARMS) {
  for (const [label, delta, cut] of [
    ["one under", -1, false],
    ["exactly on", 0, false],
    ["one over", 1, true],
  ]) {
    test(`C3 [${arm.name}]: ${label} the cap: ${cut ? "cut" : "verbatim"}`, async () => {
      requireSeam();
      const body = "q".repeat(CHANNEL_BODY_CHARS + delta);
      const { err, lines } = await drive500(arm, body);
      const line = rawLine(lines, body, err);
      assert.strictEqual(
        NOTE.test(line),
        cut,
        `a body of ${body.length} against a cap of ${CHANNEL_BODY_CHARS} must ${cut ? "" : "NOT "}be cut`,
      );
      if (cut) {
        assert.ok(
          line.includes(" [+1 chars elided]"),
          "one char over the cap drops exactly one char. Any other count means the cut fires at some " +
            `size other than ${CHANNEL_BODY_CHARS}: ${line.slice(-120)}`,
        );
      } else {
        assert.ok(line.includes(body), "a body at or inside the cap survives verbatim");
      }
    });
  }
}

// ---------------------------------------------------------------------------
// C5. The toast does not move. Derived, not snapshotted.
// ---------------------------------------------------------------------------

for (const arm of ARMS) {
  for (const [label, body] of [
    ["a short body", SHORT],
    ["an over-budget body", HUGE],
  ]) {
    test(`C5 [${arm.name}]: String(err) is byte-identical to the branch point, ${label}`, async () => {
      const { err, lines, probed } = await drive500(arm, body);
      assert.ok(err !== undefined, "the arm must still throw");
      const want = arm.expect(probed);
      assert.strictEqual(
        err.message,
        want,
        "C5: this phase adds a channel line and rewords nothing. The throw site's string is the " +
          "toast, the channel copy at fnGenService, and every session-v57 blind row that pins it.",
      );
      assert.strictEqual(String(err), `Error: ${want}`, "and String(err) with it - that is the copy the channel takes");
      // The bound is what the toast gets; the raw body is what the channel gets.
      // Proving both at once is the whole point of the phase.
      if (body.length > ERROR_BODY_CHARS) {
        assert.ok(NOTE.test(err.message), "the throw stays bounded at the toast budget");
        assert.ok(
          err.message.length < 1024,
          `the throw must not grow to channel width, got ${err.message.length} chars`,
        );
      }
      void lines;
    });
  }
}

// ---------------------------------------------------------------------------
// C6. No sink, no crash. Three of the four sites get their sink in this phase;
// a bare `config.log(...)` on an optional field is a TypeError here.
// ---------------------------------------------------------------------------

for (const arm of ARMS) {
  for (const [label, body] of [
    ["a short body", SHORT],
    ["an over-budget body", HUGE],
  ]) {
    test(`C6 [${arm.name}]: no log sink, ${label}: same error, no crash`, async () => {
      const srv = await errorServer(body);
      try {
        const probed = await probe(srv.base);
        const err = await caught(() => arm.drive(srv.base, undefined));
        assert.ok(err !== undefined, "the arm must still throw");
        assert.ok(
          !/is not a function|Cannot read propert|undefined is not/.test(String(err)),
          `C6: the raw-body log is a best-effort diagnostic, never a dependency: ${String(err)}`,
        );
        assert.strictEqual(
          err.message,
          arm.expect(probed),
          "C6: a transport with no sink throws exactly what it always threw",
        );
      } finally {
        await srv.close();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// C7. The line is findable in a channel full of [fngen] lines.
// ---------------------------------------------------------------------------

for (const arm of ARMS) {
  test(`C7 [${arm.name}]: the channel line names the transport and carries the status`, async () => {
    requireSeam();
    const { err, lines } = await drive500(arm, SHORT);
    const line = rawLine(lines, SHORT, err);
    assert.ok(
      arm.who.test(line),
      `C7: the line must name the transport (${arm.who}) so a support case can find it: ${line.slice(0, 200)}`,
    );
    assert.ok(
      /\b500\b/.test(line),
      `C7: the line must carry the numeric status: ${line.slice(0, 200)}`,
    );
  });
}

test("C7 [status]: the logged status is the server's, not a constant", async () => {
  requireSeam();
  const srv = await errorServer(SHORT, 503);
  const lines = [];
  let err;
  try {
    err = await caught(() =>
      generateInstruct({ ...PARAMS(srv.base), log: (line) => lines.push(String(line)) }),
    );
  } finally {
    await srv.close();
  }
  const line = rawLine(lines, SHORT, err);
  assert.ok(/\b503\b/.test(line), `the line must carry 503, not a hardcoded 500: ${line.slice(0, 200)}`);
});

// ---------------------------------------------------------------------------
// THE HAPPY PATH. A successful response body must not land on the channel.
// ---------------------------------------------------------------------------

const SENTINEL = "ZZTOP-SENTINEL-9f2c";

const HAPPY = [
  {
    name: "ollama-generate",
    lines: [ndjson({ response: SENTINEL }), ndjson({ done: true, done_reason: "stop" })],
    contentType: "application/x-ndjson",
    drive: (base, log) => generateInstruct({ ...PARAMS(base), log }),
  },
  {
    name: "ollama-pull",
    lines: [ndjson({ status: SENTINEL }), ndjson({ status: "success" })],
    contentType: "application/x-ndjson",
    drive: (base, log) =>
      pullModel(base, "test-model", new AbortController().signal, () => undefined, log),
  },
  {
    name: "cloud",
    lines: [
      sse({ choices: [{ delta: { content: SENTINEL } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ],
    contentType: "text/event-stream",
    drive: (base, log) => makeCloudInstruct({ baseUrl: base, apiKey: "k", log })(PARAMS(base)),
  },
];

for (const arm of HAPPY) {
  test(`happy path [${arm.name}]: a successful request logs no raw response body`, async () => {
    const srv = await streamServer(arm.lines, arm.contentType);
    const logged = [];
    try {
      await arm.drive(srv.base, (line) => logged.push(String(line)));
    } finally {
      await srv.close();
    }
    const polluted = logged.filter((l) => l.includes(SENTINEL));
    assert.deepStrictEqual(
      polluted,
      [],
      "the raw-body diagnostic fires on a non-ok response only. A line per successful generation " +
        "makes the channel unreadable, which costs more than it buys.",
    );
  });
}
