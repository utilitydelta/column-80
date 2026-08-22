// Adversarial review: session-v58 phase 4, the cloud error frame (roadmap item
// 67, third hole; contract at session-v58/contract-phase4.md).
//
// Written AFTER the implementation and after the blind oracle
// (test/blind-v58-p4-cloud-error-frame.test.cjs, 26 rows green). Its job is the
// opposite of the oracle's: every row here is an attempt to break the thing,
// and a row that stays green is a claim of CLEAN, not decoration.
//
// WHAT THE ORACLE COULD NOT SEE, and what this file goes after
//
//   * THE UNTRUSTED WIRE, PAST THE FIVE SHAPES IT DROVE. The oracle drove a
//     string, a number, an array, null and an object with no message, and
//     asserted only "does not crash" - it explicitly declined to assert that
//     the payload survives, on a parity argument. That decision is what this
//     file tests: three of those shapes lose the provider's reason, and JSON
//     alone can build a value that makes `String()` THROW, which is the one
//     outcome the oracle's own F7 assertion forbids and did not have a case
//     for.
//   * THE ORDER, FROM BOTH SIDES. The oracle proves the error wins over phase
//     3's terminal check. It never asks what happens when one frame carries an
//     error AND a content delta AND a finish_reason, whether onChunk fires for
//     text the caller will never be allowed to keep, or whether a frame after
//     `[DONE]` can still throw away a finished generation.
//   * FALSY ERROR VALUES. `if (evt.error)` is a truthiness test on a field the
//     wire controls. `null` must not fire (compat servers put `"error": null`
//     on ordinary frames); `""`, `0` and `false` do not fire either, and the
//     hole item 67 closed is still open underneath them.
//   * S20'S OWN MEASUREMENT, REPEATED ON THIS ARM. The ruling was won by
//     driving four different provider failures through one envelope and showing
//     one crafted sentence was wrong for three of them. The oracle drives one
//     message. This file drives four and checks each user reads their own cause.
//   * THE FORGERY TABLE, WHOLE. The oracle forges two markers. This file reads
//     every marker out of `SERVICE_REJECT_TOASTS` in the source and forges all
//     of them, so a marker added later without a payload-carrier thought is
//     caught here rather than in the field.
//   * THE DIALECT LEARN. `postChat` retries. Nothing anywhere drives a learn
//     that succeeds into a stream that then fails in-band.
//   * THE PARITY CLAIM. The commit says the two arms speak word-for-word the
//     same shape. Checked at the source AND behaviourally, on the three payload
//     shapes where the `??` chain can disagree.
//
// STATE. Four defects found, all one root cause, all FIXED in the phase-4
// commit. Every row that caught one is KEPT and now green: a fix nobody can see
// failing is a fix that comes back. Each keeps its DEFECT name and says what it
// used to catch.
//
// The root cause was the value coercion at the throw. `String(evt.error?.message
// ?? evt.error?.type ?? "unknown")` assumed the field was an object whose
// `message` was a string, while the comment above it said the opposite ("the
// wire is untrusted, so nothing guarantees this is an object or that `message`
// is a string").
//
//   DEFECT [wire/string envelope]                 MEDIUM
//       `{"error":"upstream overloaded"}` told the user "unknown".
//   DEFECT [wire/empty message shadows type]      MEDIUM
//       `??` treats "" as present, so an empty message hid a named `type`.
//   DEFECT [wire/String throws]                   MEDIUM
//       Plain JSON can make `String()` raise a TypeError out of the reader.
//   DEFECT [wire/object renders [object Object]]  LOW
//       A nested message rendered as filler.
//
// A FIFTH was found in the FIX for those four, after triage had ruled, and is
// also fixed and kept green:
//
//   DEFECT [wire/a blank primitive came back in quotes]  LOW
//       `providerReason` refused a blank value as absent and then handed it
//       back through the JSON fallback in quotes. Two rules in one helper that
//       disagreed - the same shape as the four above, where a comment and the
//       code beneath it disagreed. Reachable on the Anthropic arm, whose branch
//       does not test the field's truthiness.
//
// THE FIX is `providerReason` in `src/core/errorBound.ts`, read through
// `boundBody` at BOTH in-stream sites. It lands on the Anthropic arm too, and
// the parity rows at the foot of this file are why: they assert the two arms
// say byte-identical things, so fixing one arm alone turns them red. Parity
// with the worked example is parity of SHAPE - that arm carried the identical
// coercion bug, so "copy the worked example" copied a defect.
//
// ONE ROW WAS RE-CUT. `[wire/a message that starts with a break ...]` was first
// filed as an ACCEPTED loss and triage overruled it: the artefact it accepted
// was the same one this file filed a DEFECT for. It now pins the reason
// reaching the toast, and pins beside it the multi-line bound that genuinely
// does not change.
//
// NOT FIXED, DEFERRED AS S58-9: `src/core/ollama.ts:450` does
// `String(evt.error)` and carries this defect class one arm over - the same
// crash and the same `[object Object]` loss.
//
// Run: node --test test/adversarial-v58-p4.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { bundleCore } = require("./.blind-util.cjs");
const { bundleWithVscodeStub } = require("./.vscode-stub.cjs");

const SRC = path.join(__dirname, "..", "src");
const readSrc = (...p) => fs.readFileSync(path.join(SRC, ...p), "utf8");

const core = bundleCore(
  "adv-v58-p4",
  `export { generateInstruct } from "../src/core/ollama";\n` +
    `export { makeCloudInstruct } from "../src/core/cloudInstruct";\n` +
    `export { makeAnthropicInstruct } from "../src/core/anthropicInstruct";\n` +
    `export { FnGenService } from "../src/core/fnGenService";\n` +
    `export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";\n`,
);
const { generateInstruct, makeCloudInstruct, makeAnthropicInstruct, FnGenService, DEFAULT_FNGEN_CONFIG } = core.mod;

const vs = bundleWithVscodeStub(
  "adv-v58-p4-vscode",
  `export { generationFailedToast, translateServiceReject } from "../src/vscode/fnGen";\n`,
);
const { generationFailedToast, translateServiceReject } = vs.mod;

test.after(() => {
  core.cleanup();
  vs.cleanup();
});

// ---------------------------------------------------------------------------
// Plumbing. Real loopback sockets; nothing here stubs fetch.
// ---------------------------------------------------------------------------

const ND = "application/x-ndjson";
const SSE = "text/event-stream";
const nd = (o) => `${JSON.stringify(o)}\n`;
const sse = (o) => `data: ${JSON.stringify(o)}\n\n`;
const DONE = "data: [DONE]\n\n";
const errFrame = (message, type = "server_error") => sse({ error: { message, type } });

function serve(handler) {
  const server = http.createServer(handler);
  const sockets = new Set();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () =>
          new Promise((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

async function withServer(handler, fn) {
  const srv = await serve(handler);
  try {
    return await fn(srv.base);
  } finally {
    await srv.close();
  }
}

const clean = (frames, ctype) => (_req, res) => {
  res.writeHead(200, { "content-type": ctype });
  for (const f of frames) res.write(f);
  res.end();
};

/** THE MID-REPLY CUT, per the phase-3 harness note: connection-close framing so
 *  the socket close reads as end-of-body rather than undici's
 *  `TypeError: terminated`, then res.destroy() on a short timer. */
const cut = (frames, ctype) => (_req, res) => {
  res.useChunkedEncodingByDefault = false;
  res.shouldKeepAlive = false;
  res.writeHead(200, { "content-type": ctype, connection: "close" });
  for (const f of frames) res.write(f);
  setTimeout(() => res.destroy(), 120);
};

const noBody = () => (_req, res) => {
  res.writeHead(204, {});
  res.end();
};

const cloudParams = (base, extra = {}) => ({
  apiBase: base,
  model: "test-model",
  prompt: "write a function that adds two integers",
  maxTokens: 64,
  temperature: 0,
  signal: new AbortController().signal,
  ...extra,
});

const driveCloud = (base, extra) => makeCloudInstruct({ baseUrl: base, apiKey: "k" })(cloudParams(base, extra));
const driveLocal = (base, extra) => generateInstruct(cloudParams(base, extra));
const driveAnthropic = (base, extra) =>
  makeAnthropicInstruct({ baseUrl: base, apiKey: "k" })(cloudParams(base, extra));

async function outcome(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return {
      ok: false,
      err,
      name: err instanceof Error ? err.name : "",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

const GESTURE = "function generation";
const toast = (err) => generationFailedToast(err, GESTURE);
const short = (s) => (typeof s === "string" && s.length > 240 ? `${s.slice(0, 240)}... (${s.length} chars)` : s);
// The product's own abort predicate, copied from src/vscode/firstRun.ts - the
// same binding the phase-3 files use.
const isAbort = (err) => (err instanceof Error && err.name === "AbortError") || /abort/i.test(String(err));

function service(base, generateFn, log) {
  return new FnGenService({ ...DEFAULT_FNGEN_CONFIG, apiBase: base, model: "test-model" }, generateFn, log ?? (() => {}));
}

const PROVIDER_MSG = "upstream overloaded";
const F1 = "fn add(a: i32, b: i32) -> i32 {\n";
const F2 = "    a + b";

/** The silent-server sentence and the empty-generation sentence, both read OUT
 *  OF THE PRODUCT rather than written down, so a re-wording re-baselines this
 *  file instead of rotting it. A 204 makes fetch hand back a null body, which
 *  is the transport's own pre-phase-4 throw; a whitespace-only generation
 *  reaches the service's empty reject. */
let refCache;
async function references() {
  if (refCache === undefined) {
    const silent = await withServer(noBody(), (b) => outcome(() => driveCloud(b)));
    assert.strictEqual(silent.ok, false, "harness: a 204 must make the cloud transport throw its silent-server string");
    const empty = await withServer(clean([sse({ choices: [{ delta: { content: "   " }, finish_reason: "stop" }] }), DONE], SSE), (b) =>
      outcome(() => service(b, makeCloudInstruct({ baseUrl: b, apiKey: "k" })).generateRaw("write a function")),
    );
    assert.strictEqual(empty.ok, false, "harness: a whitespace-only generation must reach the service's empty reject");
    refCache = { silent: toast(silent.err), silentThrow: silent.message, empty: toast(empty.err) };
    assert.notStrictEqual(refCache.silent, refCache.empty, "harness: the two wrong sentences must be distinct");
  }
  return refCache;
}

// ===========================================================================
// 1. THE ORDER INSIDE handleLine. Established from outside, then attacked.
//
//    Source order, for the record: abort check, SSE framing skip, `[DONE]`
//    (returns), JSON.parse, THE ERROR BRANCH, choices/content, finish_reason.
// ===========================================================================

test("CLEAN [order/DONE cannot reach the error branch]: the sentinel returns before any parse", async () => {
  // `data: [DONE]` is compared as a raw string and returns, so it never reaches
  // JSON.parse and cannot carry an `error` field into the new branch. The
  // adjacent shape - a JSON string that spells the sentinel - parses to a
  // string, whose `.error` is undefined, so it does not fire either.
  const doneOnly = await withServer(clean([DONE], SSE), (b) => outcome(() => driveCloud(b)));
  assert.strictEqual(doneOnly.ok, true, `a lone [DONE] is a terminated empty stream. Got ${doneOnly.message}`);
  assert.strictEqual(doneOnly.value.text, "");

  const ref = await references();
  const quoted = await withServer(clean([`data: ${JSON.stringify("[DONE]")}\n\n`], SSE), (b) => outcome(() => driveCloud(b)));
  assert.strictEqual(quoted.ok, false, "a quoted sentinel is not the sentinel, and nothing terminated this stream");
  assert.strictEqual(
    toast(quoted.err),
    ref.silent,
    `a JSON string payload must fall through to phase 3's check, not into the error branch. Got ${JSON.stringify(short(toast(quoted.err)))}`,
  );
});

test("CLEAN [order/error beats content in the same frame]: no chunk is handed to the caller", async () => {
  // The branch sits BEFORE the choices read, which is the placement that
  // matters here: a frame carrying an error AND a content delta must not fire
  // onChunk. onChunk is what paints a preview, so text from a failed stream
  // reaching it would put a proposal on screen for a generation that throws.
  const chunks = [];
  const got = await withServer(
    clean([sse({ error: { message: PROVIDER_MSG }, choices: [{ delta: { content: "TEXT" }, finish_reason: "stop" }] }), DONE], SSE),
    (b) => outcome(() => driveCloud(b, { onChunk: (c) => chunks.push(c) })),
  );
  assert.strictEqual(got.ok, false, `an error frame is not a generation, whatever else rides with it. Got ${JSON.stringify(got.value)}`);
  assert.ok(got.message.includes(PROVIDER_MSG), `the error's reason is the throw. Got ${JSON.stringify(short(got.message))}`);
  assert.deepStrictEqual(chunks, [], "content from a frame that also carried an error was streamed to the caller");
  assert.ok(!got.message.includes("TEXT"), "the dropped content must not ride into the failure message");
});

test("CLEAN [order/error beats a finish_reason already banked]: a later frame still throws", async () => {
  // The other side of the same question. finish_reason arrived on an EARLIER
  // frame, so phase 3's terminal check is satisfied and the stream would
  // otherwise resolve; the error frame behind it must still win.
  const got = await withServer(
    clean([sse({ choices: [{ delta: { content: F1 }, finish_reason: "stop" }] }), errFrame(PROVIDER_MSG)], SSE),
    (b) => outcome(() => driveCloud(b)),
  );
  assert.strictEqual(got.ok, false, `a terminated stream that then reports an error is a failure. Got ${JSON.stringify(got.value)}`);
  assert.ok(toast(got.err).includes(PROVIDER_MSG), `the provider's reason reaches the screen. Got ${JSON.stringify(short(toast(got.err)))}`);
  assert.ok(!got.message.includes(F1.trim()), "the banked text must not ride into the failure message");
});

test("ACCEPTED [order/error after [DONE] discards a finished generation]: pinned, not fixed", async () => {
  // A complete generation - content, finish_reason, [DONE] - followed by a
  // trailing error frame throws the whole thing away. The reader keeps reading
  // after the sentinel, so the branch fires on the trailing frame.
  //
  // ACCEPTED rather than filed. Refusing is the conservative half: a provider
  // that says "error" after saying "done" has said something is wrong with the
  // reply, and proposing a body on top of that is the worse failure. Pinned
  // because it is a behaviour nothing else in the tree states, and because a
  // provider that emits a keepalive-shaped error trailer would lose every
  // generation to it.
  const got = await withServer(
    clean([sse({ choices: [{ delta: { content: "fn add() {}" }, finish_reason: "stop" }] }), DONE, errFrame("late boom")], SSE),
    (b) => outcome(() => driveCloud(b)),
  );
  assert.strictEqual(got.ok, false, `pinning today's behaviour: the trailing error wins. Got ${JSON.stringify(got.value)}`);
  assert.ok(got.message.includes("late boom"), `and it is the trailing frame's reason. Got ${JSON.stringify(short(got.message))}`);
});

test("CLEAN [order/cancel still beats the error frame]: the abort check runs first", async () => {
  // handleLine asks the signal before anything else, and that ordering is load
  // bearing: cancellation is a different outcome from failure, so a user who
  // pressed cancel must not be handed a provider error toast.
  const ac = new AbortController();
  ac.abort();
  const got = await withServer(clean([errFrame(PROVIDER_MSG)], SSE), (b) => outcome(() => driveCloud(b, { signal: ac.signal })));
  assert.strictEqual(got.ok, false, "an aborted drive does not resolve");
  assert.ok(isAbort(got.err), `a cancelled generation reads as an abort, not as a provider error. Got ${got.name}: ${JSON.stringify(short(got.message))}`);
});

test("CLEAN [order/error frame in the trailing buffer]: a frame with no trailing newline still fires", async () => {
  // The reader flushes `buffer` through handleLine after the loop. An error
  // frame written without its terminating blank line only exists on that path.
  const got = await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": SSE });
      res.end(`data: ${JSON.stringify({ error: { message: PROVIDER_MSG } })}`);
    },
    (b) => outcome(() => driveCloud(b)),
  );
  assert.strictEqual(got.ok, false, `the trailing flush must see the frame. Got ${JSON.stringify(got.value)}`);
  assert.ok(got.message.includes(PROVIDER_MSG), `and read its reason. Got ${JSON.stringify(short(got.message))}`);
});

// ===========================================================================
// 2. THE UNTRUSTED WIRE. The `error` field is typed only by us, and the comment
//    at the throw says so in as many words. Four rows below are RED: the
//    coercion does not hold up its half of that comment.
// ===========================================================================

test("DEFECT [wire/string envelope]: {\"error\":\"upstream overloaded\"} tells the user \"unknown\"", async () => {
  // The `??` chain reads `.message` and `.type` off whatever arrived. On a
  // STRING envelope both are undefined, so the provider's entire reason is
  // replaced by the literal "unknown" - the exact symptom item 67 exists to
  // close ("the provider said WHY it failed and the user is never told"), one
  // wire shape over.
  //
  // Not hypothetical for THIS client, which is documented as "any other
  // OpenAI-compatible server (OpenRouter, Groq, DeepSeek, a local vLLM)" - a
  // population that does not agree on the envelope. And the sibling site the
  // comment cites as its precedent, `ollama.ts:450`, does `String(evt.error)`
  // and therefore KEEPS a string payload; only this arm throws it away.
  //
  // The oracle drove this shape and asserted only "does not crash", on the
  // grounds that demanding the payload survive would contradict the Anthropic
  // shape it was told to copy. That is a defence of the wording, not of the
  // outcome: the parity ruling (S20) is about crafted sentences, and nothing in
  // it says a provider's message may be discarded. C2 is the binding clause.
  //
  // FIXED by `providerReason`, which reads the value ITSELF as a scalar before
  // it looks for `.message`. Kept green so the fix cannot quietly come undone.
  const got = await withServer(clean([sse({ error: PROVIDER_MSG })], SSE), (b) => outcome(() => driveCloud(b)));
  assert.strictEqual(got.ok, false, `the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.ok(
    toast(got.err).includes(PROVIDER_MSG),
    `C2: "the provider's own message survives to the screen". It did not.\n` +
      `  thrown : ${JSON.stringify(short(got.message))}\n` +
      `  toast  : ${JSON.stringify(short(toast(got.err)))}`,
  );
});

test("DEFECT [wire/empty message shadows type]: a named cause is discarded by an empty message", async () => {
  // `??` is nullish-coalescing, so `message: ""` is PRESENT and the `.type`
  // fallback never runs. The provider named its failure - "rate_limit_exceeded"
  // - and the user reads a sentence that ends in a bare colon.
  //
  // The `?? "unknown"` tail shows the intent was a fallback chain. An empty
  // string is the one value where the chain stopped on nothing.
  //
  // FIXED by `providerReason`, whose scalar read treats empty and
  // whitespace-only as ABSENT, so the `.type` fallback runs.
  const got = await withServer(
    clean([sse({ error: { message: "", type: "rate_limit_exceeded" } })], SSE),
    (b) => outcome(() => driveCloud(b)),
  );
  assert.strictEqual(got.ok, false, `the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  const t = toast(got.err);
  assert.ok(
    t.includes("rate_limit_exceeded"),
    `the only cause the provider named must reach the screen; the message field was empty.\n` +
      `  thrown : ${JSON.stringify(short(got.message))}\n  toast  : ${JSON.stringify(short(t))}`,
  );
  assert.ok(
    !/mid-reply:\s*\./.test(t),
    `and the sentence must not end on a dangling colon. Got ${JSON.stringify(short(t))}`,
  );
});

test("DEFECT [wire/String throws]: a JSON message value can make String() raise a TypeError", async () => {
  // `{"error":{"message":{"toString":1}}}` - plain JSON, no prototype games.
  // ToPrimitive finds an own `toString` that is not callable, falls to
  // Object.prototype.valueOf, gets an object back, and throws
  // `TypeError: Cannot convert object to primitive value` INSIDE handleLine.
  //
  // That TypeError is what reaches the user: the catch-all renders it, so the
  // notification reads "function generation failed - Cannot convert object to
  // primitive value", which is a JS internals string, from the one site whose
  // comment claims `String()` is the discipline that makes this field safe.
  //
  // The blind oracle's F7 rows assert exactly this ("a malformed error field
  // must not crash the reader", `!["TypeError", ...].includes(got.name)`). It
  // had no case that could produce one; this is that case.
  //
  // FIXED by `providerReason`, which never calls `String()` on a non-primitive
  // and falls back to a guarded `JSON.stringify`.
  const got = await withServer(clean([sse({ error: { message: { toString: 1 } } })], SSE), (b) => outcome(() => driveCloud(b)));
  assert.strictEqual(got.ok, false, `the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.ok(
    !["TypeError", "RangeError", "ReferenceError"].includes(got.name),
    `a malformed error field must not crash the reader. Got ${got.name}: ${JSON.stringify(short(got.message))}`,
  );
  assert.ok(
    got.message.startsWith("Cloud "),
    `C4: the marker is at index 0. A throw raised by the coercion carries no marker at all, so the toast ` +
      `table cannot see it and the catch-all renders JS internals. Got ${JSON.stringify(short(got.message))}`,
  );
});

test("DEFECT [wire/object renders [object Object]]: a non-string message becomes filler", async () => {
  // The mild face of the same coercion. Some compat surfaces nest their detail
  // ({"error":{"message":{"detail":"..."}}}) and the user read the default
  // Object stringification, which says nothing at all.
  //
  // FIXED by `providerReason`'s JSON fallback, which carries the field names.
  const got = await withServer(
    clean([sse({ error: { message: { detail: "quota exhausted", code: 429 } } })], SSE),
    (b) => outcome(() => driveCloud(b)),
  );
  assert.strictEqual(got.ok, false, `the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  const t = toast(got.err);
  assert.ok(
    !t.includes("[object Object]"),
    `"[object Object]" reached a notification. Got ${JSON.stringify(short(t))}`,
  );
});

test("ACCEPTED [wire/falsy error values do not fire]: null is right, \"\" and 0 leave the hole open", async () => {
  // `if (evt.error)` is a truthiness test. That is CORRECT for null, which is
  // the common case by far: OpenAI-compatible servers put `"error": null` on
  // ordinary frames, and a `!== undefined` test would turn every one of them
  // into a failed generation. It also means `""`, `0` and `false` are silently
  // ignored, and for those the pre-phase-4 hole is exactly as it was: the
  // stream resolves empty and the user is told the model produced nothing.
  //
  // ACCEPTED rather than filed: nothing has watched a provider send a falsy
  // non-null error, and the fix (`evt.error !== undefined && evt.error !==
  // null`) buys that edge at the cost of a rule that reads less obviously.
  // What firing would buy is also nothing a user can read - measured through
  // the helper, `""`, `0` and `false` render as `""`, `0` and `false`, which is
  // one contentless sentence swapped for another. Pinned so the reasoning is
  // not rediscovered.
  const ref = await references();
  for (const field of [null, false, 0, ""]) {
    const got = await withServer(clean([sse({ error: field }), DONE], SSE), (b) => outcome(() => driveCloud(b)));
    assert.strictEqual(
      got.ok,
      true,
      `pinning today's behaviour for ${JSON.stringify(field)}: the branch does not fire. Got ${got.name}: ${got.message}`,
    );
    assert.strictEqual(got.value.text, "", `and the caller gets an empty generation for ${JSON.stringify(field)}`);
  }
  // The null case is the one that must never change: a normal frame carrying
  // content alongside `"error": null` is a working provider.
  const normal = await withServer(
    clean([sse({ error: null, choices: [{ delta: { content: "fn add() {}" }, finish_reason: "stop" }] }), DONE], SSE),
    (b) => outcome(() => driveCloud(b)),
  );
  assert.strictEqual(normal.ok, true, `"error": null on an ordinary frame must not fail the generation. Got ${normal.message}`);
  assert.strictEqual(normal.value.text, "fn add() {}");
  assert.ok(ref.silent.length > 0);
});

test("CLEAN [wire/a message that starts with a break still reaches the toast]", async () => {
  // RE-CUT. This row was first written as an ACCEPTED loss: `boundBody` does not
  // escape line breaks - only the CHANNEL line does - so a provider message
  // beginning with a newline pushed its own text onto line 2, the toast's
  // first-line rule kept only the head, and the user read
  // "Cloud reported an error mid-reply:" and nothing.
  //
  // Triage overruled the accept, and it was right to: that is the SAME
  // user-visible artefact this file filed `DEFECT [wire/empty message shadows
  // type]` for, and accepting one while filing the other is incoherent. The
  // cost was one `.trim()` that was already going into `providerReason`'s
  // scalar read, so a leading break is now treated as the absence of a break
  // rather than as content.
  //
  // WHAT DOES NOT CHANGE, pinned below so nobody reads this row as a promise it
  // does not make: a genuinely multi-line provider message still loses
  // everything past line one. That is the universal toast bound - a
  // notification is one line - and the channel pointer is what makes it honest.
  const lines = [];
  const got = await withServer(clean([errFrame("\nrate limit exceeded")], SSE), (b) =>
    outcome(() => service(b, makeCloudInstruct({ baseUrl: b, apiKey: "k" }), (l) => lines.push(String(l))).generateRaw("write a function")),
  );
  assert.strictEqual(got.ok, false, "the drive must throw");
  const t = toast(got.err);
  assert.ok(
    t.includes("rate limit exceeded"),
    `a break in front of the reason is not a reason to drop the reason. Got ${JSON.stringify(short(t))}`,
  );
  assert.ok(!t.includes("\n"), `and the notification is still one line. Got ${JSON.stringify(short(t))}`);
  assert.ok(
    lines.some((l) => l.includes("rate limit exceeded")),
    `the channel pointer must be a true promise - the full message has to be in the channel. Got ${JSON.stringify(lines)}`,
  );

  // The settled multi-line behaviour, in the same row so the two cannot drift
  // apart: line one on the toast, the whole message in the channel.
  const multi = [];
  const long = await withServer(clean([errFrame("rate limit exceeded\nretry after 60s")], SSE), (b) =>
    outcome(() => service(b, makeCloudInstruct({ baseUrl: b, apiKey: "k" }), (l) => multi.push(String(l))).generateRaw("write a function")),
  );
  assert.strictEqual(long.ok, false, "the drive must throw");
  const lt = toast(long.err);
  assert.ok(lt.includes("rate limit exceeded"), `line one reaches the toast. Got ${JSON.stringify(short(lt))}`);
  assert.ok(!lt.includes("retry after 60s"), `line two does not, by design. Got ${JSON.stringify(short(lt))}`);
  assert.ok(
    multi.some((l) => l.includes("retry after 60s")),
    `and line two is in the channel the toast points at. Got ${JSON.stringify(multi)}`,
  );
});

test("DEFECT [wire/a blank primitive came back in quotes]: the JSON fallback is for structures only", async () => {
  // FOUND AFTER TRIAGE HAD ALREADY RULED, in the fix for the four defects above
  // rather than in the code they were filed against.
  //
  // `providerReason` held two rules that disagreed with each other: "blank
  // means absent" (`scalar` refuses empty and whitespace-only) and "a structure
  // renders as JSON rather than [object Object]". A blank PRIMITIVE satisfied
  // both - `scalar` refused it, then `JSON.stringify` handed it straight back
  // in quotes - so a whitespace-only `error` reached the screen as `"  "`, the
  // helper contradicting its own documented rule. That is the same shape as the
  // defect cluster this file filed: a comment and the code beneath it
  // disagreeing, with the code winning in front of a user.
  //
  // ON THE ANTHROPIC ARM, because that is where it is reachable. The cloud
  // branch is `if (evt.error)`, which a blank primitive never passes; the
  // Anthropic branch fires on `evt.type === "error"` whatever `error` holds, so
  // `{"type":"error","error":"   "}` is the live case. The two arms share the
  // helper, so this row guards both.
  const blanks = ["", "   ", "\n", "\t "];
  for (const blank of blanks) {
    const got = await withServer(
      clean([`event: error\ndata: ${JSON.stringify({ type: "error", error: blank })}\n\n`], SSE),
      (b) => outcome(() => driveAnthropic(b)),
    );
    assert.strictEqual(got.ok, false, `${JSON.stringify(blank)}: the drive must throw`);
    const t = toast(got.err);
    assert.ok(
      !/"\s*"/.test(t),
      `a value the blank rule refused came back through the JSON fallback in quotes. ` +
        `Sent ${JSON.stringify(blank)}, toast ${JSON.stringify(short(t))}`,
    );
    assert.ok(
      t.includes("unknown"),
      `a blank reason is the absence of a reason, and the generic sentence is what says so. ` +
        `Sent ${JSON.stringify(blank)}, toast ${JSON.stringify(short(t))}`,
    );
    assert.ok(!t.includes("\n"), `${JSON.stringify(blank)}: a notification is one line`);
    assert.strictEqual(translateServiceReject(got.err), undefined, `${JSON.stringify(blank)}: no crafted sentence`);
  }

  // THE RULE'S EDGE, pinned in the same row so the fix cannot be over-applied.
  // A blank inside a STRUCTURE still renders as the structure, and that is a
  // deliberate call rather than a missed case: `{"message":""}` tells the
  // reader the provider sent an envelope and left it empty, which is a
  // different fact from having sent no envelope at all. Reviewed and not
  // disputed - the distinction is real and the cost is one pair of braces on a
  // sentence that would otherwise say nothing either way.
  const structured = await withServer(
    clean([`event: error\ndata: ${JSON.stringify({ type: "error", error: { message: "" } })}\n\n`], SSE),
    (b) => outcome(() => driveAnthropic(b)),
  );
  assert.strictEqual(structured.ok, false, "the drive must throw");
  assert.ok(
    toast(structured.err).includes(`{"message":""}`),
    `an empty message INSIDE an envelope still shows the envelope. Got ${JSON.stringify(short(toast(structured.err)))}`,
  );
  // And an envelope with nothing in it at all has no more to show than the
  // generic sentence, so it does not get braces either.
  const bare = await withServer(
    clean([`event: error\ndata: ${JSON.stringify({ type: "error", error: {} })}\n\n`], SSE),
    (b) => outcome(() => driveAnthropic(b)),
  );
  assert.strictEqual(bare.ok, false, "the drive must throw");
  assert.ok(
    toast(bare.err).includes("unknown") && !toast(bare.err).includes("{}"),
    `an empty structure says no more than the generic sentence. Got ${JSON.stringify(short(toast(bare.err)))}`,
  );
});

test("CLEAN [wire/other malformed shapes are bounded and one line]", async () => {
  // The rest of the hostile set: no crash, one line, and the fixed head still
  // at index 0 so the toast table can see the throw.
  for (const field of [429, [{ message: "m" }], {}, { message: null }, { type: 123 }, { message: true }, true]) {
    const got = await withServer(clean([sse({ error: field })], SSE), (b) => outcome(() => driveCloud(b)));
    assert.strictEqual(got.ok, false, `${JSON.stringify(field)} must throw rather than resolve`);
    assert.strictEqual(got.name, "Error", `${JSON.stringify(field)} produced ${got.name}: ${short(got.message)}`);
    assert.ok(got.message.startsWith("Cloud reported an error mid-reply:"), `${JSON.stringify(field)}: head at index 0`);
    const t = toast(got.err);
    assert.ok(!t.includes("\n"), `${JSON.stringify(field)}: a notification is one line`);
    assert.strictEqual(translateServiceReject(got.err), undefined, `${JSON.stringify(field)}: no crafted sentence`);
  }
});

test("CLEAN [wire/100KB message is bounded before the toast]", async () => {
  const got = await withServer(clean([errFrame("x".repeat(100000))], SSE), (b) => outcome(() => driveCloud(b)));
  assert.strictEqual(got.ok, false, "the drive must throw");
  assert.ok(got.message.length < 600, `the throw is bounded. Got ${got.message.length} chars`);
  assert.ok(/elided/.test(got.message), `and says it was cut. Got ${JSON.stringify(short(got.message))}`);
  // The bound is applied to the PAYLOAD, not to the whole string, so the head
  // survives the cut and the throw stays anchorable.
  assert.ok(got.message.startsWith("Cloud reported an error mid-reply:"), "the head survives the bound");
});

// ===========================================================================
// 3. S20'S OWN MEASUREMENT, ON THIS ARM. The ruling was won by driving four
//    different failures through one envelope. Repeat it.
// ===========================================================================

test("CLEAN [s20/four failures, four causes]: each user reads their own reason", async () => {
  const ref = await references();
  const failures = [
    ["rate limit", "Rate limit reached for gpt-4o in organization org-abc on tokens per min"],
    ["refused key", "Incorrect API key provided: sk-***. You can find your API key at https://platform.openai.com/account/api-keys"],
    ["content filter", "The response was filtered due to the prompt triggering the content management policy"],
    ["quota exhausted", "You exceeded your current quota, please check your plan and billing details"],
  ];
  const seen = new Set();
  for (const [label, message] of failures) {
    const got = await withServer(clean([errFrame(message)], SSE), (b) => outcome(() => driveCloud(b)));
    assert.strictEqual(got.ok, false, `${label}: the drive must throw`);
    const t = toast(got.err);
    // firstLine cuts nothing here: every message above is one line.
    assert.ok(t.includes(message), `${label}: the provider's own cause must reach the screen. Got ${JSON.stringify(short(t))}`);
    assert.notStrictEqual(t, ref.silent, `${label}: not the silent-server sentence`);
    assert.notStrictEqual(t, ref.empty, `${label}: not the empty-generation sentence`);
    assert.strictEqual(translateServiceReject(got.err), undefined, `${label}: no crafted sentence stands in for it`);
    seen.add(t);
  }
  assert.strictEqual(
    seen.size,
    failures.length,
    "S20's finding, restated: one crafted sentence for this envelope is the wrong cause for three of these " +
      `four. Four drives must produce four different sentences. Got ${seen.size}`,
  );
});

// ===========================================================================
// 4. THE FORGERY ROUTE, over the WHOLE table rather than two samples.
// ===========================================================================

/** Every marker string in SERVICE_REJECT_TOASTS, read out of the source. A
 *  marker added later without a payload-carrier thought is caught by this row
 *  rather than in the field. */
function serviceMarkers() {
  const src = readSrc("vscode", "fnGen.ts");
  const start = src.indexOf("const SERVICE_REJECT_TOASTS");
  assert.ok(start > 0, "harness: SERVICE_REJECT_TOASTS moved or was renamed");
  const end = src.indexOf("\n];", start);
  assert.ok(end > start, "harness: could not find the end of the table");
  const block = src.slice(start, end);
  const markers = [];
  for (const arr of block.matchAll(/markers:\s*\[([\s\S]*?)\]/g)) {
    for (const m of arr[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) markers.push(JSON.parse(`"${m[1]}"`));
  }
  assert.ok(markers.length >= 10, `harness: expected the whole marker table, found ${markers.length}`);
  return markers;
}

test("CLEAN [forgery/every service marker as the provider's text]: none of them draws its sentence", async () => {
  const markers = serviceMarkers();
  for (const marker of markers) {
    const got = await withServer(clean([errFrame(marker)], SSE), (b) => outcome(() => driveCloud(b)));
    assert.strictEqual(got.ok, false, `${JSON.stringify(marker)}: the drive must throw`);
    assert.strictEqual(
      translateServiceReject(got.err),
      undefined,
      `a service marker chosen by the SERVER drew its crafted sentence. Marker ${JSON.stringify(marker)}, ` +
        `toast ${JSON.stringify(short(toast(got.err)))}`,
    );
    assert.ok(
      toast(got.err).includes(marker),
      `and the provider's own text, whatever it says, reaches the screen. Got ${JSON.stringify(short(toast(got.err)))}`,
    );
  }
});

test("CLEAN [forgery/the anchored pass cannot be entered]: nothing gets in front of the head", async () => {
  // The anchored pass runs FIRST, before the payload guard, and matches with
  // startsWith. The only way into it is to make the whole thrown string BEGIN
  // with an anchored marker, and the head is a template literal at index 0, so
  // there is no input that can precede it. Driven anyway, with the markers and
  // with leading whitespace and breaks in front of the payload.
  const ref = await references();
  const attempts = [
    ref.silentThrow,
    "Cloud: the stream ended before any terminal signal, so the reply is incomplete",
    "Cloud: response has no body",
    "\nCloud: response has no body",
    "\rCloud: response has no body",
    "   Cloud: response has no body",
  ];
  for (const forged of attempts) {
    const got = await withServer(clean([errFrame(forged)], SSE), (b) => outcome(() => driveCloud(b)));
    assert.strictEqual(got.ok, false, `${JSON.stringify(forged)}: the drive must throw`);
    assert.ok(
      got.message.startsWith("Cloud reported an error mid-reply:"),
      `the head is the product's, at index 0. Got ${JSON.stringify(short(got.message))}`,
    );
    assert.notStrictEqual(
      toast(got.err),
      ref.silent,
      `a provider whose error text is an anchored marker drew that row's sentence. Sent ${JSON.stringify(forged)}`,
    );
  }
});

test("CLEAN [forgery/the head is a payload carrier both ways]: listed explicitly and under the prefix", async () => {
  // PAYLOAD_CARRIERS now holds both "Cloud reported an error mid-reply:" and
  // the broader "Cloud ". The duplication is deliberate (the diff says so), and
  // what matters is that removing either one leaves the route shut. Checked
  // structurally, because behaviour cannot tell the two entries apart.
  const src = readSrc("vscode", "fnGen.ts");
  const start = src.indexOf("const PAYLOAD_CARRIERS");
  const block = src.slice(start, src.indexOf("\n];", start));
  const heads = [...block.matchAll(/^\s*"((?:[^"\\]|\\.)*)",/gm)].map((m) => JSON.parse(`"${m[1]}"`));
  const covering = heads.filter((h) => "Cloud reported an error mid-reply: anything".startsWith(h));
  assert.deepStrictEqual(
    covering.sort(),
    ["Cloud ", "Cloud reported an error mid-reply:"],
    `both entries must cover the new head, so neither is load bearing alone. Got ${JSON.stringify(covering)}`,
  );
});

// ===========================================================================
// 5. PHASE 3 MUST BE UNDAMAGED. Its whole clause set, re-driven through the new
//    code, including the arm phase 4 did not touch.
// ===========================================================================

const PHASE3_RESOLVE = [
  ["both signals", [sse({ choices: [{ delta: { content: F1 + F2 } }] }), sse({ choices: [{ delta: {}, finish_reason: "stop" }] }), DONE], F1 + F2, "stop"],
  ["finish_reason, no DONE", [sse({ choices: [{ delta: { content: F1 } }] }), sse({ choices: [{ delta: {}, finish_reason: "length" }] })], F1, "length"],
  ["DONE, no finish_reason", [sse({ choices: [{ delta: { content: F1 } }] }), DONE], F1, undefined],
];

for (const [label, frames, text, doneReason] of PHASE3_RESOLVE) {
  test(`CLEAN [phase3/${label}]: a stream with no error frame is untouched`, async () => {
    const got = await withServer(clean(frames, SSE), (b) => outcome(() => driveCloud(b)));
    assert.strictEqual(got.ok, true, `phase 3's tolerance must hold. Got ${got.name}: ${got.message}`);
    assert.strictEqual(got.value.text, text);
    assert.strictEqual(got.value.doneReason, doneReason);
  });
}

test("CLEAN [phase3/genuine cut still says silent server]", async () => {
  const ref = await references();
  const got = await withServer(cut([sse({ choices: [{ delta: { content: F1 } }] }), sse({ choices: [{ delta: { content: F2 } }] })], SSE), (b) =>
    outcome(() => driveCloud(b)),
  );
  assert.strictEqual(got.ok, false, `two deltas and a dead socket is still a cut. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.strictEqual(toast(got.err), ref.silent, `and still the silent-server sentence. Got ${JSON.stringify(short(toast(got.err)))}`);
});

test("CLEAN [phase3/late abort still reads as a cancel]", async () => {
  // Phase 3's own DEFECT row, re-driven: a cancel landing after the reader's
  // final signal check must not be reported as a silent server, and the error
  // branch must not have moved the guard that fixes it.
  const ac = new AbortController();
  const got = await withServer(cut([sse({ choices: [{ delta: { content: F1 } }] }), sse({ choices: [{ delta: { content: F2 } }] })], SSE), (b) =>
    outcome(() =>
      driveCloud(b, {
        signal: ac.signal,
        onChunk: (chunk) => {
          if (chunk.includes(F2.trim())) ac.abort();
        },
      }),
    ),
  );
  assert.strictEqual(got.ok, false, "an aborted drive does not resolve");
  assert.ok(isAbort(got.err), `a cancel is not a failure. Got ${got.name}: ${JSON.stringify(short(got.message))}`);
});

test("CLEAN [phase3/the local arm is untouched]: ollama still cuts and still resolves", async () => {
  const ref = await references();
  const cutGot = await withServer(cut([nd({ response: F1 }), nd({ response: F2 })], ND), (b) => outcome(() => driveLocal(b)));
  assert.strictEqual(cutGot.ok, false, `the local cut must still throw. Got RESOLVED ${JSON.stringify(cutGot.value)}`);
  assert.strictEqual(toast(cutGot.err), ref.silent, "one event, one sentence, across the arms");
  const okGot = await withServer(clean([nd({ response: F1 }), nd({ done: true, done_reason: "stop" })], ND), (b) => outcome(() => driveLocal(b)));
  assert.strictEqual(okGot.ok, true, `a terminated local stream still resolves. Got ${okGot.message}`);
  assert.strictEqual(okGot.value.text, F1);
});

// ===========================================================================
// 6. THE EMPTY-GENERATION ROW MUST STAY REACHABLE. It is a real failure with a
//    specific sentence, and both phase 3's guard and phase 4's branch sit
//    upstream of it.
// ===========================================================================

test("CLEAN [empty/the service's own reject is still reached]: end to end, through FnGenService", async () => {
  const ref = await references();
  const got = await withServer(clean([sse({ choices: [{ delta: { content: "" }, finish_reason: "stop" }] }), DONE], SSE), (b) =>
    outcome(() => service(b, makeCloudInstruct({ baseUrl: b, apiKey: "k" })).generateRaw("write a function")),
  );
  assert.strictEqual(got.ok, false, `an empty generation is still a reject. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.strictEqual(
    toast(got.err),
    ref.empty,
    `a cloud stream that completes properly with no text must still draw the service's empty sentence.\n` +
      `  thrown : ${JSON.stringify(short(got.message))}\n  toast  : ${JSON.stringify(short(toast(got.err)))}`,
  );
});

// ===========================================================================
// 7. THE DIALECT LEARN. postChat retries; nothing else drives a learn that
//    succeeds into a stream that then fails in-band.
// ===========================================================================

test("CLEAN [learn/an error frame after a successful dialect retry]", async () => {
  // Round 1 is a 400 naming max_tokens, which the client adapts to
  // max_completion_tokens. Round 2 is a 200 whose stream carries the error
  // frame. The provider's in-stream reason must be what the user reads - not
  // the 400's body, and not the silent-server sentence - and the learn must not
  // re-fire on it.
  const ref = await references();
  const bodies = [];
  const got = await withServer(
    (req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        bodies.push(JSON.parse(raw));
        if (bodies.length === 1) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens'", param: "max_tokens" } }));
          return;
        }
        res.writeHead(200, { "content-type": SSE });
        res.end(errFrame(PROVIDER_MSG));
      });
    },
    (b) => outcome(() => driveCloud(b)),
  );
  assert.strictEqual(bodies.length, 2, `the learn must run exactly once. Sent ${bodies.length} requests`);
  assert.ok("max_tokens" in bodies[0] && "max_completion_tokens" in bodies[1], "the dialect narrowed between the two rounds");
  assert.strictEqual(got.ok, false, `the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.ok(
    toast(got.err).includes(PROVIDER_MSG),
    `the in-stream reason is what the user reads, not the 400 that taught the dialect.\n  toast: ${JSON.stringify(short(toast(got.err)))}`,
  );
  assert.notStrictEqual(toast(got.err), ref.silent, "and not the silent-server sentence");
  assert.ok(!toast(got.err).includes("max_tokens"), "the learn's own 400 body must not ride into the toast");
});

test("CLEAN [learn/a 400 the client cannot adapt to is unaffected by the new branch]", async () => {
  // The other half: a 400 whose error body is NOT a dialect quirk still throws
  // the HTTP failure, with one request sent. The new branch reads `error` on
  // frames inside a 200 and must not reach this document.
  const seen = [];
  const got = await withServer(
    (req, res) => {
      seen.push(req.url);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Incorrect API key provided", type: "invalid_request_error" } }));
    },
    (b) => outcome(() => driveCloud(b)),
  );
  assert.strictEqual(seen.length, 1, `an unadaptable 400 is sent once. Got ${seen.length}`);
  assert.strictEqual(got.ok, false, "an unadaptable 400 throws");
  assert.ok(got.message.includes("Incorrect API key provided"), `and keeps the provider's own text. Got ${JSON.stringify(short(got.message))}`);
  assert.ok(!got.message.startsWith("Cloud reported an error mid-reply:"), "the in-stream head must not be worn by an HTTP failure");
});

// ===========================================================================
// 8. C7's ADMITTED GAP. The contract names two shapes as not-handled. One of
//    them works, by accident, and accidental correctness breaks silently.
// ===========================================================================

test("ACCEPTED [c7/event: error works by accident]: the DATA line carries the field the branch reads", async () => {
  // The contract calls the `event: error` SSE form out of scope. It works
  // anyway: the `event:` line is skipped as framing, and the `data:` line that
  // follows carries an `error` object, which is precisely what the new branch
  // tests. Nothing named this shape, nothing asserts it, and the accident is
  // one field rename away from vanishing - hence pinned here.
  const payload = { type: "error", error: { type: "overloaded_error", message: PROVIDER_MSG } };
  const got = await withServer(clean([`event: error\ndata: ${JSON.stringify(payload)}\n\n`], SSE), (b) => outcome(() => driveCloud(b)));
  assert.strictEqual(got.ok, false, `the drive must throw. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.ok(toast(got.err).includes(PROVIDER_MSG), `and by accident the reason reaches the screen. Got ${JSON.stringify(short(toast(got.err)))}`);

  // The limit of the accident, and why it is worth writing down: the same SSE
  // form with the envelope only in the `event:` name - a data line carrying
  // `{"type":"error"}` and nothing else - falls straight through to phase 3.
  const ref = await references();
  const bare = await withServer(clean([`event: error\ndata: ${JSON.stringify({ type: "error" })}\n\n`], SSE), (b) => outcome(() => driveCloud(b)));
  assert.strictEqual(bare.ok, false, "the drive must throw");
  assert.strictEqual(
    toast(bare.err),
    ref.silent,
    `pinning the gap: without an \`error\` field the shape is invisible to phase 4. Got ${JSON.stringify(short(toast(bare.err)))}`,
  );
});

test("ACCEPTED [c7/the dropped connection is still a silent server]", async () => {
  const ref = await references();
  const got = await withServer(cut([sse({ choices: [{ delta: { content: F1 } }] })], SSE), (b) => outcome(() => driveCloud(b)));
  assert.strictEqual(got.ok, false, "the drive must throw");
  assert.strictEqual(toast(got.err), ref.silent, "the second out-of-scope shape, pinned rather than assumed absent");
});

// ===========================================================================
// 9. THE PARITY CLAIM. "Word-for-word the Anthropic arm's shape."
// ===========================================================================

test("CLEAN [parity/the two throws are byte-identical past the provider name]", async () => {
  const cloudLine = /`Cloud reported an error mid-reply: \$\{[^`]*`/.exec(readSrc("core", "cloudInstruct.ts"));
  const anthLine = /`Anthropic reported an error mid-reply: \$\{[^`]*`/.exec(readSrc("core", "anthropicInstruct.ts"));
  assert.ok(cloudLine && anthLine, "harness: both throw sites must be found in the source");
  assert.strictEqual(
    cloudLine[0].replace("Cloud ", "NAME "),
    anthLine[0].replace("Anthropic ", "NAME "),
    "the commit claims these are word for word the same shape",
  );
});

test("CLEAN [parity/the arms agree on every payload shape the ?? chain can split on]", async () => {
  // Source equality is not behaviour: the two arms reach their throws from
  // different tests (`evt.error` vs `evt.type === "error"`). Driven on the three
  // shapes where the fallback chain can disagree, plus the ordinary one.
  const shapes = [
    ["message and type", { message: PROVIDER_MSG, type: "server_error" }],
    ["type only", { type: "overloaded_error" }],
    ["neither", {}],
    ["empty message with a type", { message: "", type: "rate_limit_error" }],
  ];
  for (const [label, error] of shapes) {
    const cloudGot = await withServer(clean([sse({ error })], SSE), (b) => outcome(() => driveCloud(b)));
    const anthGot = await withServer(
      clean([`event: error\ndata: ${JSON.stringify({ type: "error", error })}\n\n`], SSE),
      (b) => outcome(() => driveAnthropic(b)),
    );
    assert.strictEqual(cloudGot.ok, false, `${label}: the cloud arm must throw`);
    assert.strictEqual(anthGot.ok, false, `${label}: the Anthropic arm must throw. Got ${JSON.stringify(anthGot.value)}`);
    assert.strictEqual(
      cloudGot.message.replace(/^Cloud /, "NAME "),
      anthGot.message.replace(/^Anthropic /, "NAME "),
      `${label}: the two arms must say the same thing.\n  cloud     : ${JSON.stringify(short(cloudGot.message))}\n` +
        `  anthropic : ${JSON.stringify(short(anthGot.message))}`,
    );
  }
});
