// Implementer oracle, session-v57 phase 1 (roadmap item 63, second string):
// gaps the blind file leaves open.
//
// The blind file proves the three transports from outside: a 100KB body is cut
// with a marker, a short body is untouched, a 6000-char reason phrase cannot
// escape. What it cannot see, because it was written against the contract
// alone:
//   * THE BUDGET IS ONE BUDGET. The blind file bounds at 2048, a ceiling all
//     three would pass at wildly different sizes. Here the three transports are
//     driven with the SAME body and their messages compared, so an arm that
//     kept a private budget goes red rather than passing under the ceiling.
//   * THE BOUNDARY, ON THE NEW ARMS. One char under the budget, exactly on it,
//     one char over. The one-over row is the only one that proves the cut fires
//     at the budget rather than at some larger convenience size.
//   * THE MARKER'S ARITHMETIC, ON THE NEW ARMS. The stated count is checked
//     against the chars actually dropped.
//   * MULTI-BYTE AT THE CUT POINT, ON THE NEW ARMS. The cut is aimed straight
//     at a surrogate pair and the message scanned for an orphaned half.
//   * THE DIALECT-LEARNING LEG, which is the hazard this phase created. The
//     cloud transport JSON-parses its own 400 to learn whether the provider
//     wants `max_tokens` or `max_completion_tokens`. Reading that body through
//     the BOUNDED reader would hand the parse a truncated document with an
//     elision marker glued on, and the learning would silently stop working.
//     Driven with an over-budget 400 body: the retry must still go out in the
//     learned dialect.
//   * THE STRUCTURAL PIN. The point of the phase is that the bound exists
//     ONCE. A source-text row goes red if any transport grows a private
//     `safeText` again, and another goes red if the leaf grows an import (the
//     cycle trap session-v56 hit with toastText).
//   * THE DEGENERATE BODIES. Empty, and unreadable. An empty body may not be
//     rewritten into a marker, and a body whose text() rejects must be NAMED
//     rather than left blank. The unreadable case is pinned on the leaf rather
//     than through three socket-destroying servers: after this phase there is
//     exactly one reader per kind, so the leaf row covers all three arms by
//     construction.
//
// Run: node --test test/impl-v57-p1-shared-bound.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { bundleCore } = require("./.blind-util.cjs");

const SRC = path.join(__dirname, "..", "src", "core");

const core = bundleCore(
  "impl-v57-p1-core",
  `export { generateInstruct, pullModel } from "../src/core/ollama";\n` +
    `export { makeAnthropicInstruct } from "../src/core/anthropicInstruct";\n` +
    `export { makeCloudInstruct } from "../src/core/cloudInstruct";\n` +
    `export { boundBody, safeText, rawText, ERROR_BODY_CHARS } from "../src/core/errorBound";\n`,
);
const {
  generateInstruct,
  pullModel,
  makeAnthropicInstruct,
  makeCloudInstruct,
  boundBody,
  safeText,
  rawText,
  ERROR_BODY_CHARS,
} = core.mod;

test.after(() => core.cleanup());

// ---------------------------------------------------------------------------
// Server plumbing. One handler, one port, closed per row.
// ---------------------------------------------------------------------------

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const answer = (status, body, reason) => (_req, res) => {
  if (reason === undefined) {
    res.writeHead(status, { "Content-Type": "text/plain" });
  } else {
    res.writeHead(status, reason, { "Content-Type": "text/plain" });
  }
  res.end(body);
};

const PARAMS = (base) => ({
  apiBase: base,
  model: "test-model",
  prompt: "write a function",
  maxTokens: 64,
  temperature: 0,
  signal: new AbortController().signal,
});

async function messageFrom(fn) {
  try {
    await fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  assert.fail("expected the transport to throw");
}

// The three arms, each reduced to "point it at this base and make it fail".
const ARMS = [
  {
    name: "ollama-generate",
    drive: (base) => messageFrom(() => generateInstruct(PARAMS(base))),
  },
  {
    name: "ollama-pull",
    drive: (base) =>
      messageFrom(() => pullModel(base, "test-model", new AbortController().signal, () => undefined)),
  },
  {
    name: "anthropic",
    drive: (base) =>
      messageFrom(() => makeAnthropicInstruct({ baseUrl: base, apiKey: "k" })(PARAMS(base))),
  },
  {
    name: "cloud",
    drive: (base) => messageFrom(() => makeCloudInstruct({ baseUrl: base, apiKey: "k" })(PARAMS(base))),
  },
];

// ---------------------------------------------------------------------------
// One budget, not four. The same body through every arm; the bodies the four
// messages carry must be cut to the same length.
// ---------------------------------------------------------------------------

test("one budget: the same over-budget body is cut to the same length on every transport", async () => {
  const body = "z".repeat(ERROR_BODY_CHARS * 10);
  const kept = [];
  for (const arm of ARMS) {
    const srv = await serve(answer(500, body));
    try {
      const msg = await arm.drive(srv.base);
      const run = /z+/.exec(msg);
      assert.ok(run, `[${arm.name}] the message carries none of the body: ${msg.slice(0, 200)}`);
      kept.push({ name: arm.name, len: run[0].length });
    } finally {
      await srv.close();
    }
  }
  const sizes = new Set(kept.map((k) => k.len));
  assert.strictEqual(
    sizes.size,
    1,
    `every transport must land on ONE budget, got ${JSON.stringify(kept)}. An arm with a private ` +
      "number passes the blind file's 2048 ceiling and still drifts.",
  );
  assert.strictEqual([...sizes][0], ERROR_BODY_CHARS);
});

// ---------------------------------------------------------------------------
// The boundary, on the two arms the blind file could only prove at 100KB.
// ---------------------------------------------------------------------------

for (const arm of ARMS.filter((a) => a.name === "anthropic" || a.name === "cloud")) {
  for (const [label, size, cut] of [
    ["one under", ERROR_BODY_CHARS - 1, false],
    ["exactly on", ERROR_BODY_CHARS, false],
    ["one over", ERROR_BODY_CHARS + 1, true],
  ]) {
    test(`boundary [${arm.name}] ${label} the budget: ${cut ? "cut" : "verbatim"}`, async () => {
      const body = "q".repeat(size);
      const srv = await serve(answer(500, body));
      try {
        const msg = await arm.drive(srv.base);
        const marked = /elided/.test(msg);
        assert.strictEqual(
          marked,
          cut,
          `a body of ${size} against a budget of ${ERROR_BODY_CHARS} must ${cut ? "" : "NOT "}be cut: ` +
            msg.slice(0, 200),
        );
        if (!cut) {
          assert.ok(msg.includes(body), "a body inside the budget must survive verbatim");
        }
      } finally {
        await srv.close();
      }
    });
  }

  test(`marker arithmetic [${arm.name}]: the stated count equals the chars actually dropped`, async () => {
    const total = ERROR_BODY_CHARS * 7 + 13;
    const body = "q".repeat(total);
    const srv = await serve(answer(500, body));
    try {
      const msg = await arm.drive(srv.base);
      const m = /q+ \[\+(\d+) chars elided\]/.exec(msg);
      assert.ok(m, `no marker in: ${msg.slice(0, 300)}`);
      const keptLen = /q+/.exec(msg)[0].length;
      assert.strictEqual(
        Number(m[1]) + keptLen,
        total,
        "the marker must state the chars actually dropped, not a guess",
      );
    } finally {
      await srv.close();
    }
  });

  test(`surrogate pair [${arm.name}]: the cut never leaves an orphaned half`, async () => {
    // A pair straddling the budget: the last kept code unit would be a HIGH
    // surrogate if the cut were taken naively.
    const body = "a".repeat(ERROR_BODY_CHARS - 1) + "\u{1F600}" + "b".repeat(50);
    const srv = await serve(answer(500, body));
    try {
      const msg = await arm.drive(srv.base);
      // Without this the row is vacuous: an UNBOUNDED message carries the pair
      // intact, so the scan below would report success on the exact state this
      // phase exists to fix.
      assert.ok(/elided/.test(msg), `the body must actually have been cut: ${msg.slice(0, 200)}`);
      for (let i = 0; i < msg.length; i++) {
        const c = msg.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          const next = msg.charCodeAt(i + 1);
          assert.ok(next >= 0xdc00 && next <= 0xdfff, `orphaned high surrogate at ${i}`);
        }
        if (c >= 0xdc00 && c <= 0xdfff) {
          const prev = msg.charCodeAt(i - 1);
          assert.ok(prev >= 0xd800 && prev <= 0xdbff, `orphaned low surrogate at ${i}`);
        }
      }
    } finally {
      await srv.close();
    }
  });
}

// ---------------------------------------------------------------------------
// The degenerate bodies, on the two new arms.
// ---------------------------------------------------------------------------

for (const arm of ARMS.filter((a) => a.name === "anthropic" || a.name === "cloud")) {
  test(`degenerate [${arm.name}]: an empty body neither crashes nor invents text`, async () => {
    const srv = await serve(answer(500, ""));
    try {
      const msg = await arm.drive(srv.base);
      assert.ok(msg.includes("500"), `status must survive an empty body: ${msg}`);
      assert.ok(!/elided/.test(msg), "an empty body is not a cut body");
    } finally {
      await srv.close();
    }
  });
}

// ---------------------------------------------------------------------------
// THE HAZARD THIS PHASE CREATED. cloudInstruct parses its own 400 to learn the
// provider's token parameter. If that read were bounded, an over-budget 400
// body would parse as garbage and the learning would stop.
// ---------------------------------------------------------------------------

test("dialect learning survives an OVER-BUDGET 400 body: the retry carries max_completion_tokens", async () => {
  const bodies = [];
  // The complaint is real OpenAI shape, then padded past the budget with a
  // field the parser ignores. Under a bounded read this document would arrive
  // truncated mid-string with " [+N chars elided]" on the end and fail to
  // parse, so the retry would never change dialect.
  const complaint = JSON.stringify({
    error: {
      message: "Unsupported parameter: 'max_tokens' is not supported with this model.",
      type: "invalid_request_error",
      param: "max_tokens",
      code: "unsupported_parameter",
      echo: "p".repeat(ERROR_BODY_CHARS * 3),
    },
  });
  assert.ok(complaint.length > ERROR_BODY_CHARS, "the row is worthless unless the body is over budget");

  const srv = await serve((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      if (bodies.length === 1) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(complaint);
        return;
      }
      // Second request: answer the stream so the call completes cleanly.
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n` +
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  try {
    await makeCloudInstruct({ baseUrl: srv.base, apiKey: "k" })(PARAMS(srv.base));
  } finally {
    await srv.close();
  }

  assert.strictEqual(bodies.length, 2, "the 400 must be retried in a learned dialect, not surfaced");
  assert.ok("max_tokens" in bodies[0], "the first attempt goes out in the old dialect");
  assert.ok(
    "max_completion_tokens" in bodies[1],
    "the retry must carry the LEARNED parameter. If it does not, the 400 body was read through the " +
      "bound and the JSON parse that learns the dialect saw a truncated document.",
  );
});

test("an over-budget 400 that teaches nothing is still SURFACED bounded", async () => {
  // The other half of the same seam: when adaptDialect declines, the body is
  // thrown, and THAT string is the one the user sees. It must be bounded even
  // though the read was not.
  const body = "w".repeat(ERROR_BODY_CHARS * 20);
  const srv = await serve(answer(400, body));
  try {
    const msg = await messageFrom(() =>
      makeCloudInstruct({ baseUrl: srv.base, apiKey: "k" })(PARAMS(srv.base)),
    );
    assert.ok(msg.length <= 2048, `an unlearnable 400 must still be bounded, got ${msg.length}`);
    assert.ok(/elided/.test(msg), `and must say it was cut: ${msg.slice(0, 200)}`);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// The structural pins. The phase's whole point is ONE copy, in a LEAF.
// ---------------------------------------------------------------------------

test("one copy: no transport carries a private safeText or boundBody", () => {
  for (const file of ["ollama.ts", "anthropicInstruct.ts", "cloudInstruct.ts"]) {
    const src = fs.readFileSync(path.join(SRC, file), "utf8");
    // Three forms, because a re-introduction will not necessarily copy the one
    // that was deleted: a bare declaration, an exported one, and an arrow bound
    // to a const. The `from "./errorBound"` assertion below cannot stand in for
    // this one, since a private copy can sit happily beside the import.
    assert.ok(
      !/^\s*(export\s+)?(async\s+)?function\s+(safeText|boundBody|rawText)\b/m.test(src) &&
        !/^\s*(export\s+)?const\s+(safeText|boundBody|rawText)\s*=/m.test(src),
      `${file} must import the bound from errorBound.ts, not define its own. Three private copies ` +
        "is the defect roadmap item 63 names: session-v56 fixed one of them and the other two " +
        "shipped a 100KB toast for another three months.",
    );
    assert.ok(
      /from "\.\/errorBound"/.test(src),
      `${file} must import ./errorBound`,
    );
  }
});

test("the leaf is a leaf: errorBound.ts imports nothing", () => {
  const src = fs.readFileSync(path.join(SRC, "errorBound.ts"), "utf8");
  assert.ok(
    !/^\s*import\b/m.test(src),
    "errorBound.ts must import nothing. Three transports depend on it; an edge out of it is the " +
      "import cycle session-v56 hit when it moved firstLine into toastText.ts.",
  );
});

test("boundBody is pure: it neither reads nor rewrites a value inside the budget", () => {
  const inside = "x".repeat(ERROR_BODY_CHARS);
  assert.strictEqual(boundBody(inside), inside);
  assert.strictEqual(boundBody(""), "");
  assert.strictEqual(boundBody("{}"), "{}");
});

test("an unreadable body is NAMED, not left blank, through either reader", async () => {
  // The shape a truncated response produces: the headers promised a body, the
  // socket died before it arrived, and text() rejects. Driven on the leaf,
  // which after this phase is the only reader all three transports have.
  const torn = { text: () => Promise.reject(new Error("terminated")) };
  assert.strictEqual(await safeText(torn), "<no body>");
  assert.strictEqual(await rawText(torn), "<no body>");
  // And the empty body is a DIFFERENT case: it is readable, and reads empty.
  const blank = { text: () => Promise.resolve("") };
  assert.strictEqual(await safeText(blank), "");
  assert.strictEqual(await rawText(blank), "");
});
