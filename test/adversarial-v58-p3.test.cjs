// Adversarial review: session-v58 phase 3, the stream that ended wrong
// (roadmap item 67, terminal-event half; the phase 3 contract).
//
// Written AFTER the implementation and after the blind oracle
// (test/blind-v58-p3-terminal-event.test.cjs, 25 rows green). Its job is the
// opposite of the oracle's: every row here is an attempt to break the thing,
// and a row that stays green is a claim of CLEAN, not decoration.
//
// WHAT THE ORACLE COULD NOT SEE, and what this file goes after
//
//   * THE PLACEMENT, from the other side. The oracle proves FIM still resolves
//     on the one cut shape it drives. This file drives FOUR shapes down the
//     keystroke path - the connection-close cut, a clean end with no done
//     frame, a zero-frame 200, and a stopWhen bound - because "the guard is in
//     generateInstruct" is only worth anything if EVERY shape that now throws
//     on the instruct arm still resolves on the FIM one.
//   * THE SEAM'S RUNTIME SHAPE. The oracle pins generateFim's result keys. It
//     never looks at generateInstruct's, and that is where the new field
//     actually comes out.
//   * THE ABORT GAP. The oracle's C8 rows abort while the socket is still
//     live, which the reader's own abort check catches. The interesting abort
//     is the one that lands AFTER the reader's last check and before the new
//     guard, because the new guard does not consult the signal at all.
//   * THE MARKERS FROM THE SERVER'S SIDE. Anchoring is checked by the oracle by
//     prefixing the product's own message. It never asks whether a SERVER can
//     put the marker at index 0 of a message the product builds.
//   * THE SERVICE'S OTHER REJECTS. The oracle stops at the transport and checks
//     that `doneReason` still arrives. It never drives FnGenService, so it
//     cannot see whether the new throw pre-empts the truncation reject or the
//     empty-generation reject, which are the two more specific sentences this
//     class could have swallowed.
//   * WHY NOTHING BROKE. Two throws went onto two hot paths and 10308
//     pre-existing rows stayed green. This file establishes that the change IS
//     live rather than unwired.
//
// STATE. Three defects were found red and all three were FIXED in the phase-3
// commit (7e4eb79). Every row that caught one is KEPT and now green: a fix
// nobody can see failing is a fix that comes back. Each keeps its DEFECT name
// and the comment above it says what it used to catch.
//
//   DEFECT [abort/local-late-abort], DEFECT [abort/cloud-late-abort]   MEDIUM
//       A cancellation that lands after the reader's final abort check was
//       reported to the caller as a silent server. Fixed by re-checking the
//       signal INSIDE the cut branch on both arms.
//   DEFECT [seam/instruct-result-shape]                                 LOW
//       `sawDone` crossed the InstructGenerateFn seam, where the interface does
//       not declare it and the other three backends do not produce it. Fixed by
//       spelling out the four declared fields at the return.
//   DEFECT [seam/inner-annotation]                                      LOW
//       `streamGenerateInner`'s declared return type did not list `sawDone`,
//       and tsc could not see the difference, so the field the guard reads was
//       not compiler-enforced end to end. Fixed by declaring it required at
//       both ends, which makes removing it a compile error.
//
// ONE ROW WAS RE-CUT AT PHASE 4. `CLEAN [cloud/error frame]` was pinned as a
// moved baseline while phase 3 held the sentence for a branch it did not own;
// phase 4 landed the error-frame throw and flipped it, which is the row doing
// its job. It now pins the settled behaviour and both sentences it must not be.
//
// TWO THINGS STAY PINNED AS ACCEPTED rather than left to be rediscovered:
// F5's neither-signal case (the contract's recorded risk, re-driven here in the
// shape a real provider frame actually has, `finish_reason: null`) and the
// keepalive-only stream.
//
// Run: node --test test/adversarial-v58-p3.test.cjs

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
  "adv-v58-p3",
  `export { generateInstruct, generateFim } from "../src/core/ollama";\n` +
    `export { makeCloudInstruct } from "../src/core/cloudInstruct";\n` +
    `export { FnGenService } from "../src/core/fnGenService";\n` +
    `export { DEFAULT_FNGEN_CONFIG } from "../src/core/config";\n`,
);
const { generateInstruct, generateFim, makeCloudInstruct, FnGenService, DEFAULT_FNGEN_CONFIG } = core.mod;

const vs = bundleWithVscodeStub(
  "adv-v58-p3-vscode",
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

/** THE MID-REPLY CUT, per the oracle's measured harness note: connection-close
 *  framing so the socket close reads as end-of-body rather than undici's
 *  `TypeError: terminated`, then res.destroy() on a short timer. A "cut" built
 *  on a truncated CHUNKED body throws on every arm including FIM, and every
 *  verdict taken from it would be green for the wrong reason. */
const cut = (frames, ctype) => (_req, res) => {
  res.useChunkedEncodingByDefault = false;
  res.shouldKeepAlive = false;
  res.writeHead(200, { "content-type": ctype, connection: "close" });
  for (const f of frames) res.write(f);
  setTimeout(() => res.destroy(), 120);
};

const clean = (frames, ctype) => (_req, res) => {
  res.writeHead(200, { "content-type": ctype });
  for (const f of frames) res.write(f);
  res.end();
};

const hang = (frames, ctype) => (_req, res) => {
  res.writeHead(200, { "content-type": ctype });
  for (const f of frames) res.write(f);
};

const noBody = () => (_req, res) => {
  res.writeHead(204, {});
  res.end();
};

const instructParams = (base, extra = {}) => ({
  apiBase: base,
  model: "test-model",
  prompt: "write a function that adds two integers",
  maxTokens: 64,
  temperature: 0,
  signal: new AbortController().signal,
  ...extra,
});

const driveLocal = (base, extra) => generateInstruct(instructParams(base, extra));
const driveCloud = (base, extra) =>
  makeCloudInstruct({ baseUrl: base, apiKey: "test-key" })(instructParams(base, extra));
const driveFim = (base, extra = {}) =>
  generateFim({
    apiBase: base,
    model: "test-model",
    prefix: "fn add(a: i32, b: i32) -> i32 {",
    suffix: "}",
    maxTokens: 64,
    temperature: 0,
    signal: new AbortController().signal,
    ...extra,
  });

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
// The product's own abort predicate, copied from src/vscode/firstRun.ts, the
// same binding the blind file uses.
const isAbort = (err) => (err instanceof Error && err.name === "AbortError") || /abort/i.test(String(err));

const HALF = "fn add(a: i32, b: i32) -> i32 {\n    a + b";
const F1 = "fn add(a: i32, b: i32) -> i32 {\n";
const F2 = "    a + b";
const LOCAL_CUT = [nd({ response: F1 }), nd({ response: F2 })];
const CLOUD_CUT = [sse({ choices: [{ delta: { content: F1 } }] }), sse({ choices: [{ delta: { content: F2 } }] })];

/** The silent-server sentence, read out of the product rather than written
 *  down: a 204 makes fetch hand back a null body and the cloud transport throws
 *  the string it already owned before this phase. */
let refCache;
async function reference() {
  if (refCache === undefined) {
    const got = await withServer(noBody(), (b) => outcome(() => driveCloud(b)));
    assert.strictEqual(got.ok, false, "harness: a 204 must make the cloud transport throw its existing silent-server string");
    refCache = { sentence: toast(got.err), thrown: got.message };
  }
  return refCache;
}

/** The EMPTY-GENERATION sentence, read out of the product the same way: drive a
 *  terminated cloud stream whose text is whitespace only, all the way through
 *  FnGenService, and toast whatever it refuses with. Written down nowhere, so a
 *  re-wording of that sentence re-baselines this file instead of rotting it. */
let emptyRefCache;
async function emptyReference() {
  if (emptyRefCache === undefined) {
    const got = await withServer(
      clean([sse({ choices: [{ delta: { content: "   " }, finish_reason: "stop" }] }), DONE], SSE),
      (b) => outcome(() => service(b, makeCloudInstruct({ baseUrl: b, apiKey: "k" })).generateRaw("write a function")),
    );
    assert.strictEqual(got.ok, false, "harness: a whitespace-only generation must reach the service's empty reject");
    emptyRefCache = toast(got.err);
  }
  return emptyRefCache;
}

// ===========================================================================
// 1. THE PLACEMENT. Everything the instruct arm now refuses must still resolve
//    on the keystroke path, in every shape - not only the one the oracle drives.
// ===========================================================================

const FIM_SHAPES = [
  ["mid-reply cut", () => cut(LOCAL_CUT, ND), HALF],
  ["clean end, no done frame", () => clean(LOCAL_CUT, ND), HALF],
  ["zero-frame 200", () => clean([], ND), ""],
];

for (const [label, mk, expected] of FIM_SHAPES) {
  test(`CLEAN [placement/fim ${label}]: the keystroke path still resolves where the instruct path now throws`, async () => {
    // The paired instruct drive is asserted in the same row on purpose. A row
    // that only says "FIM resolved" is green on a tree where the phase never
    // landed; this one says "the guard fires, and it fires on exactly one of
    // the two callers of the shared reader".
    const onInstruct = await withServer(mk(), (b) => outcome(() => driveLocal(b)));
    assert.strictEqual(onInstruct.ok, false, `precondition: ${label} must be a cut on the instruct arm`);

    const onFim = await withServer(mk(), (b) => outcome(() => driveFim(b)));
    assert.strictEqual(
      onFim.ok,
      true,
      `the terminal check reached generateFim. ${label} threw ${onFim.name}: ${onFim.message}`,
    );
    assert.strictEqual(onFim.value.text, expected, "and it resolves with whatever text arrived, in full");
  });
}

test("CLEAN [placement/fim stopWhen]: a bound-ended read is not a cut on either side of the seam", async () => {
  const got = await withServer(
    hang([nd({ response: "return a + b;\n" }), nd({ response: "// junk\n" })], ND),
    (b) => outcome(() => driveFim(b, { stopWhen: (t) => t.includes("\n") })),
  );
  assert.strictEqual(got.ok, true, `stopWhen ends the read cleanly. Got ${got.name}: ${got.message}`);
  assert.strictEqual(got.value.stopped, true, "and the caller is still told the bound ended it");
  assert.strictEqual(got.value.text, "return a + b;\n");
});

test("CLEAN [placement/one spender]: streamGenerate has exactly two callers and only one reads the signal", async () => {
  // The whole placement argument is "tracked in the shared reader, spent in
  // generateInstruct". If a third caller appears, or if generateFim starts
  // reading the field, the argument is void and nothing else in this suite
  // would say so.
  const src = readSrc("core", "ollama.ts");
  const callers = [...src.matchAll(/(?<!function\s)streamGenerate\(/g)];
  assert.strictEqual(callers.length, 2, `expected generateFim and generateInstruct only, found ${callers.length} call sites`);
  const fimBody = src.slice(src.indexOf("export async function generateFim"), src.indexOf("export interface InstructGenerateParams"));
  assert.ok(!fimBody.includes("sawDone"), "generateFim must not read the field it is deliberately not spending");
  const instructBody = src.slice(src.indexOf("export async function generateInstruct"), src.indexOf("async function streamGenerate("));
  assert.ok(instructBody.includes("result.sawDone"), "generateInstruct is where the signal is spent");
});

// ===========================================================================
// 2. THE SEAM. Two defects live here.
// ===========================================================================

test("DEFECT [seam/instruct-result-shape]: `sawDone` is spent, not returned across the InstructGenerateFn seam", async () => {
  // WHAT THIS CAUGHT, fixed in 7e4eb79. The signal is documented as "Reported,
  // never acted on HERE ... Spent at generateInstruct." It was not spent:
  // generateInstruct returned streamGenerate's object unchanged, so a private
  // transport flag crossed the seam that four backends implement.
  //
  // The interface it crosses on declares four fields (text, ttftMs, totalMs,
  // doneReason). TypeScript could not catch the fifth, because the value is
  // returned through a variable rather than an object literal, so nothing in
  // the build said the declaration and the runtime disagreed.
  //
  // WHY IT MATTERED rather than being cosmetic: the field means "this arm saw
  // its terminal frame" on ONE of the four backends and is `undefined` on the
  // other three, which reads as "no terminal frame" to anyone who finds it.
  // Phase 4 and phase 5 both work on this seam. The blind file pins exactly
  // this property for generateFim ("a leaked field is how a caller downstream
  // starts branching on the instruct path's business"); the instruct side had
  // no such row. This is it.
  const local = await withServer(
    clean([nd({ response: "fn add() {}" }), nd({ done: true, done_reason: "stop" })], ND),
    (b) => outcome(() => driveLocal(b)),
  );
  const cloud = await withServer(
    clean([sse({ choices: [{ delta: { content: "fn add() {}" }, finish_reason: "stop" }] }), DONE], SSE),
    (b) => outcome(() => driveCloud(b)),
  );
  assert.strictEqual(local.ok, true, `precondition: the local happy path resolves. Got ${local.message}`);
  assert.strictEqual(cloud.ok, true, `precondition: the cloud happy path resolves. Got ${cloud.message}`);

  assert.deepStrictEqual(
    Object.keys(cloud.value).sort(),
    ["doneReason", "totalMs", "ttftMs", "text"].sort(),
    "the cloud arm answers the declared InstructGenerateResult exactly, which is the shape to hold the other arms to",
  );
  assert.deepStrictEqual(
    Object.keys(local.value).sort(),
    Object.keys(cloud.value).sort(),
    `one InstructGenerateFn returns a field the others do not and the interface does not declare.\n` +
      `  local: ${JSON.stringify(local.value)}\n` +
      `  cloud: ${JSON.stringify(cloud.value)}\n` +
      `  fix  : spend it - return { text, ttftMs, totalMs, doneReason } from generateInstruct, or put ` +
      `sawDone on InstructGenerateResult and have all four arms answer it.`,
  );
});

test("DEFECT [seam/inner-annotation]: streamGenerateInner declares the field the guard depends on", () => {
  // WHAT THIS CAUGHT, fixed in 7e4eb79. `streamGenerate` declared
  // `sawDone?: boolean` and `generateInstruct` read it. The function that
  // actually PRODUCES it, streamGenerateInner, declared a return type without
  // it and returned the field through a conditional spread. Excess-property
  // checking does not apply to spreads, so tsc was silent: verified by
  // compiling the same shape standalone, which is clean.
  //
  // The failure that left open was not small. Delete or rename the spread and
  // `result.sawDone` is `undefined` on every stream, the guard fires on every
  // instruct generation, and the product tells every user their server went
  // silent - with a green `tsc --noEmit`. The outer annotation was the only
  // thing standing between the guard and that, and it was not the annotation on
  // the code that fills the field.
  const src = readSrc("core", "ollama.ts");
  const marker = "async function streamGenerateInner(): Promise<{";
  const at = src.indexOf(marker);
  assert.notStrictEqual(at, -1, "streamGenerateInner must still be an annotated inner function");
  const annotation = src.slice(at, src.indexOf("}>", at));
  assert.ok(
    annotation.includes("sawDone"),
    `streamGenerateInner returns \`sawDone\` and does not declare it:\n${annotation}\n` +
      `  fix: add \`sawDone?: boolean\` to the inner annotation, or drop the annotation and let it infer.`,
  );
});

test("CLEAN [seam/no consumer]: nothing reads the leaked field off a result, so the leak is inert today", () => {
  // Property reads only. cloudInstruct.ts has a local named `sawDone` of its
  // own, which is not a consumer of the ollama result's field.
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && /\.sawDone\b/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(SRC, p));
    }
  };
  walk(SRC);
  assert.deepStrictEqual(hits, ["core/ollama.ts"], `the leaked field is read outside its own module: ${hits.join(", ")}`);
});

test("CLEAN [seam/service strips it]: the leaked field does not reach an FnGenResult", async () => {
  const got = await withServer(
    clean([nd({ response: "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}" }), nd({ done: true, done_reason: "stop" })], ND),
    (b) => outcome(() => service(b, generateInstruct).generateRaw("write a function")),
  );
  assert.strictEqual(got.ok, true, `precondition: the round resolves. Got ${got.message}`);
  assert.deepStrictEqual(Object.keys(got.value).sort(), ["model", "text", "totalMs", "ttftMs"]);
});

// ===========================================================================
// 3. THE ABORT BOUNDARY. Cancel must stay a distinct outcome from failure;
//    phase 5 is being built on that distinction.
// ===========================================================================

const ABORT_ARMS = [
  ["local", driveLocal, ND, LOCAL_CUT],
  ["cloud", driveCloud, SSE, CLOUD_CUT],
];

for (const [label, drive, ctype] of ABORT_ARMS) {
  test(`CLEAN [abort/${label} before the request]: a pre-aborted signal rejects as an abort`, async () => {
    const ref = await reference();
    const ac = new AbortController();
    ac.abort();
    const got = await withServer(hang([], ctype), (b) => outcome(() => drive(b, { signal: ac.signal })));
    assert.strictEqual(got.ok, false, "an aborted generation must reject");
    assert.ok(isAbort(got.err), `must read as a cancellation. Got ${got.name}: ${got.message}`);
    assert.notStrictEqual(toast(got.err), ref.sentence, "and must not accuse the server");
  });

  test(`CLEAN [abort/${label} after headers]: a cancel before any frame rejects as an abort`, async () => {
    const ref = await reference();
    const ac = new AbortController();
    const got = await withServer(hang([], ctype), (b) => {
      setTimeout(() => ac.abort(), 80);
      return outcome(() => drive(b, { signal: ac.signal }));
    });
    assert.strictEqual(got.ok, false, "an aborted generation must reject");
    assert.ok(isAbort(got.err), `must read as a cancellation. Got ${got.name}: ${got.message}`);
    assert.notStrictEqual(toast(got.err), ref.sentence, "and must not accuse the server");
  });
}

for (const [label, drive, ctype, frames] of ABORT_ARMS) {
  test(`CLEAN [abort/${label} mid-stream]: a cancel with content already delivered rejects as an abort`, async () => {
    const ref = await reference();
    const ac = new AbortController();
    const got = await withServer(hang(frames, ctype), (b) => {
      setTimeout(() => ac.abort(), 80);
      return outcome(() => drive(b, { signal: ac.signal }));
    });
    assert.strictEqual(got.ok, false, "an aborted generation must reject");
    assert.ok(isAbort(got.err), `must read as a cancellation. Got ${got.name}: ${got.message}`);
    assert.notStrictEqual(toast(got.err), ref.sentence, "and must not accuse the server");
  });
}

test("CLEAN [abort/last frame]: a cancel that lands after a COMPLETE stream still resolves, on both arms", async () => {
  // Not a defect either way; pinned because it is the boundary the next two
  // rows sit one byte past. A stream that finished before the cancel arrived
  // is a finished stream.
  for (const [label, drive, ctype, frames] of [
    ["local", driveLocal, ND, [nd({ response: "x" }), nd({ done: true, done_reason: "stop" })]],
    ["cloud", driveCloud, SSE, [sse({ choices: [{ delta: { content: "x" }, finish_reason: "stop" }] }), DONE]],
  ]) {
    const ac = new AbortController();
    const got = await withServer((_q, res) => {
      res.writeHead(200, { "content-type": ctype });
      for (const f of frames) res.write(f);
      res.end();
      setTimeout(() => ac.abort(), 0);
    }, (b) => outcome(() => drive(b, { signal: ac.signal })));
    const ref = await reference();
    if (!got.ok) {
      assert.notStrictEqual(toast(got.err), ref.sentence, `${label}: a completed stream is never a silent server`);
    }
  }
});

for (const [label, drive, ctype, frames] of [
  // The final line/frame is deliberately left WITHOUT its terminator, so it
  // sits in the reader's trailing buffer and is handled by the loop's last
  // handleLine call - the same call whose onChunk fires the cancel.
  ["local", driveLocal, ND, [nd({ response: F1 }), `{"response":${JSON.stringify(F2)}}`]],
  ["cloud", driveCloud, SSE, [sse({ choices: [{ delta: { content: F1 } }] }), `data: ${JSON.stringify({ choices: [{ delta: { content: F2 } }] })}`]],
]) {
  test(`DEFECT [abort/${label}-late-abort]: a cancellation that lands after the reader's last check still reads as a cancellation`, async () => {
    // WHAT THIS CAUGHT, fixed in 7e4eb79. Both readers check `signal.aborted`
    // at the TOP of handleLine and nowhere after, and the terminal guard did
    // not consult the signal at all. So a cancel that landed inside the final
    // handleLine - after that call's own check - was never seen again, and the
    // guard converted it into the silent-server sentence.
    //
    // onChunk is the deterministic way to hit the window; it is not the only
    // one. Any cancel delivered between the reader's last check and the guard
    // lands here, and the guard is the only code between them.
    //
    // WHAT THE USER GOT: they pressed cancel, and the product told them their
    // model server went silent and to go check it. Contract C8 is explicit that
    // cancellation is a different outcome from failure and that phase 5 depends
    // on the distinction; the blind file binds C8 at the transport, which is
    // exactly where this failed.
    //
    // IT WAS NOT VISIBLE AT THE FN-GEN GESTURES, and the next row pins why:
    // FnGenService.run catches, asks `controller.signal.aborted` FIRST and
    // returns undefined, so the sentence was swallowed before a toast. That was
    // a downstream accident, not the guard being right - Tighten Doc Comment
    // uses the same seam without that catch, and phase 5's cancel affordance is
    // new code on this boundary.
    //
    // THE FIX re-checks the signal INSIDE the cut branch on both arms, which is
    // the placement that keeps `CLEAN [abort/last frame]` green: a stream that
    // finished properly and was cancelled a moment later still resolves.
    const ref = await reference();
    const ac = new AbortController();
    const got = await withServer(cut(frames, ctype), (b) =>
      outcome(() =>
        drive(b, {
          signal: ac.signal,
          onChunk: (chunk) => {
            if (chunk.includes(F2.trim())) ac.abort();
          },
        }),
      ),
    );
    assert.strictEqual(got.ok, false, `precondition: the drive must reject. Got RESOLVED ${JSON.stringify(got.value)}`);
    assert.notStrictEqual(
      toast(got.err),
      ref.sentence,
      `the caller cancelled and was told the server went silent.\n` +
        `  thrown: ${JSON.stringify(got.message)}\n` +
        `  toast : ${JSON.stringify(toast(got.err))}\n` +
        `  isAbort(err): ${isAbort(got.err)}`,
    );
    assert.ok(isAbort(got.err), `and the rejection must still read as a cancellation. Got ${got.name}: ${got.message}`);
  });
}

test("CLEAN [abort/service swallows]: FnGenService returns undefined for ANY throw once its signal aborted", async () => {
  // Why the defect above is not a live user-visible toast on the fn-gen
  // gestures, stated as a row so the mitigation is on the record rather than in
  // a reviewer's head. This is also what makes the defect's severity MEDIUM
  // rather than HIGH.
  const ac = new AbortController();
  ac.abort();
  const svc = service("http://127.0.0.1:1", async () => {
    throw new Error("Ollama: the stream ended before its done frame, so the reply is incomplete");
  });
  const got = await outcome(() => svc.generateRaw("write a function", undefined, ac.signal));
  assert.strictEqual(got.ok, true, `the service must not rethrow once aborted. Got ${got.message}`);
  assert.strictEqual(got.value, undefined, "an aborted round is undefined, not a reject");
});

// ===========================================================================
// 4. THE CLOUD TERMINAL RULE, and the risk the contract accepted.
// ===========================================================================

test("CLEAN [cloud/finish then cut]: finish_reason arrived, so a socket close before [DONE] is not a cut", async () => {
  const got = await withServer(cut([sse({ choices: [{ delta: { content: "fn add() {}" }, finish_reason: "stop" }] })], SSE), (b) =>
    outcome(() => driveCloud(b)),
  );
  assert.strictEqual(got.ok, true, `either signal ends a stream. Got ${got.name}: ${got.message}`);
  assert.strictEqual(got.value.doneReason, "stop");
});

test("ACCEPTED [cloud/finish_reason null]: the real frame shape for a non-final delta, and it is not a signal", async () => {
  // The contract's falsifier 5 drives a frame with no finish_reason KEY. Real
  // providers send the key with a null value on every non-final frame - it is
  // what this repo's own cloud fixture defaults to
  // (blind-cloud-instruct.test.cjs, `contentFrame(content, finish_reason = null)`).
  // Re-driven in that shape so the accepted risk is recorded against the frame
  // a provider actually emits, not only against an absent field.
  const ref = await reference();
  const got = await withServer(clean([sse({ choices: [{ delta: { content: "fn add() {}" }, finish_reason: null }] })], SSE), (b) =>
    outcome(() => driveCloud(b)),
  );
  assert.strictEqual(got.ok, false, `neither signal arrived, so this is a cut. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.strictEqual(toast(got.err), ref.sentence);
});

test("ACCEPTED [cloud/keepalives only]: a stream of SSE comments and nothing else is a cut", async () => {
  const ref = await reference();
  const got = await withServer(clean([": ping\n\n", ": ping\n\n"], SSE), (b) => outcome(() => driveCloud(b)));
  assert.strictEqual(got.ok, false, `no data frame, no terminal signal. Got RESOLVED ${JSON.stringify(got.value)}`);
  assert.strictEqual(toast(got.err), ref.sentence);
});

test("CLEAN [cloud/error frame]: the provider's own reason reaches the user, and neither wrong sentence does", async () => {
  // RE-CUT AT PHASE 4, and the history is the point of the row. A cloud 200
  // carrying `data: {"error":...}` has drawn three different things:
  //
  //   branch point  the frame matched nothing and vanished; the call resolved
  //                 with empty text and the service said "no usable code",
  //                 while the provider had said it was overloaded.
  //   phase 3       the terminal check turned it into the silent-server
  //                 sentence - closer, still wrong, and a sentence this phase
  //                 moved on the way past a branch it did not own. Pinned red
  //                 on purpose so the moved baseline could not move again
  //                 unnoticed.
  //   phase 4       the frame throws in handleLine, BEFORE the terminal check,
  //                 and carries the provider's own message. No crafted sentence
  //                 (S20, ratified 2026-08-22): a generic envelope carries a
  //                 rate limit, a refused key and a malformed request alike, and
  //                 a crafted sentence would delete the only actionable half.
  //
  // Both wrong sentences are read out of the product at run time rather than
  // written down, so a re-wording of either re-baselines this row instead of
  // letting it pass on a stale literal.
  const silent = (await reference()).sentence;
  const empty = await emptyReference();
  const REASON = "upstream overloaded";

  // No finish_reason and no [DONE] in this drive, deliberately: the error frame
  // has to win over the terminal check, and it can only do that by throwing
  // first. A branch placed after the reader loop would draw `silent` here.
  const got = await withServer(clean([sse({ error: { message: REASON, type: "server_error" } })], SSE), (b) =>
    outcome(() => driveCloud(b)),
  );
  assert.strictEqual(got.ok, false, `an error frame must reject. Got RESOLVED ${JSON.stringify(got.value)}`);
  const said = toast(got.err);
  assert.ok(
    said.includes(REASON),
    `the provider's own reason is the actionable half and must reach the user.\n` +
      `  thrown: ${JSON.stringify(got.message)}\n  toast : ${JSON.stringify(said)}`,
  );
  assert.notStrictEqual(said, empty, `the branch-point sentence is wrong: the model produced nothing BECAUSE the provider failed`);
  assert.notStrictEqual(said, silent, `the phase-3 sentence is wrong: the server did not go silent, it said what went wrong`);
  assert.strictEqual(
    translateServiceReject(got.err),
    undefined,
    `a generic provider envelope gets no crafted sentence (S20). Got ${JSON.stringify(translateServiceReject(got.err))}`,
  );

  // AND THE FORGERY, which is what the new PAYLOAD_CARRIERS entry is for: the
  // message is server-chosen text, so a provider whose reason happens to be a
  // service reject's own words must not draw that service's sentence.
  const forged = await withServer(clean([sse({ error: { message: "generation was empty after postprocess" } })], SSE), (b) =>
    outcome(() => driveCloud(b)),
  );
  assert.strictEqual(forged.ok, false, "precondition: the forged frame rejects");
  assert.notStrictEqual(toast(forged.err), empty, "a service marker inside the provider's own text is the server talking");
});

test("CLEAN [cloud/dialect retry]: a learned-dialect retry starts its terminal state clean", async () => {
  // postChat can send the request TWICE. sawDone/sawFinish are declared after
  // postChat returns, so a rejected probe cannot pre-satisfy them and a probe's
  // 400 body cannot leave a stale signal behind. Both directions are driven:
  // the retry that succeeds must resolve, the retry that is cut must throw.
  const ref = await reference();
  for (const [label, secondResponse, expectOk] of [
    ["retry resolves", "clean", true],
    ["retry is cut", "cut", false],
  ]) {
    let attempts = 0;
    const got = await withServer(
      (_q, res) => {
        attempts += 1;
        if (attempts === 1) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { param: "max_tokens", message: "use max_completion_tokens" } }));
          return;
        }
        if (secondResponse === "clean") {
          clean([sse({ choices: [{ delta: { content: "fn add() {}" }, finish_reason: "stop" }] }), DONE], SSE)(_q, res);
        } else {
          cut([sse({ choices: [{ delta: { content: "half" } }] })], SSE)(_q, res);
        }
      },
      // learnedDialects is a module-level map keyed on baseUrl+model; each row
      // stands up a fresh port, so the key is fresh and the attempt count below
      // is not inherited from the previous row.
      (b) => outcome(() => makeCloudInstruct({ baseUrl: b, apiKey: "k" })(instructParams(b))),
    );
    assert.strictEqual(attempts, 2, `${label}: one rejected probe, one real attempt`);
    assert.strictEqual(got.ok, expectOk, `${label}: got ${got.ok ? JSON.stringify(got.value) : got.message}`);
    if (!expectOk) assert.strictEqual(toast(got.err), ref.sentence, `${label}: the cut must still be a cut after a retry`);
  }
});

test("CLEAN [cloud/no cross-call state]: a complete call does not leave a terminal signal set for the next one", async () => {
  const ref = await reference();
  let n = 0;
  const got = await withServer(
    (_q, res) => {
      n += 1;
      if (n === 1) {
        clean([sse({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }), DONE], SSE)(_q, res);
      } else {
        cut([sse({ choices: [{ delta: { content: "half" } }] })], SSE)(_q, res);
      }
    },
    async (b) => {
      const transport = makeCloudInstruct({ baseUrl: b, apiKey: "k" });
      const first = await outcome(() => transport(instructParams(b)));
      const second = await outcome(() => transport(instructParams(b)));
      return { first, second };
    },
  );
  assert.strictEqual(got.first.ok, true, `precondition: the complete call resolves. Got ${got.first.message}`);
  assert.strictEqual(got.second.ok, false, "a cut after a complete call on the SAME transport must still throw");
  assert.strictEqual(toast(got.second.err), ref.sentence);
});

// ===========================================================================
// 5. THE MARKERS. Anchoring holds only if a SERVER cannot put its own text at
//    index 0 of a message that carries one.
// ===========================================================================

test("CLEAN [marker/both new throws are anchored heads]", async () => {
  const ref = await reference();
  for (const [label, handler, drive] of [
    ["local", cut(LOCAL_CUT, ND), driveLocal],
    ["cloud", cut(CLOUD_CUT, SSE), driveCloud],
  ]) {
    const got = await withServer(handler, (b) => outcome(() => drive(b)));
    assert.strictEqual(got.ok, false, `${label}: must throw`);
    assert.strictEqual(toast(got.err), ref.sentence, `${label}: same class, same sentence`);
    assert.strictEqual(translateServiceReject(new Error(` ${got.message}`)), undefined, `${label}: one leading space must lose the match`);
  }
});

test("CLEAN [marker/forgery via the ollama error field]: a server that names the marker cannot claim the sentence", async () => {
  // `Ollama error: <server text>` interpolates a field the server chose. Put
  // the new marker in it and the message CONTAINS the marker at index 14.
  const got = await withServer(
    clean([nd({ error: "Ollama: the stream ended before its done frame, so the reply is incomplete" })], ND),
    (b) => outcome(() => driveLocal(b)),
  );
  assert.strictEqual(got.ok, false, "an in-stream error field rejects");
  assert.ok(got.message.includes("Ollama: the stream ended before its done frame"), "precondition: the forged marker is in the message");
  assert.strictEqual(
    translateServiceReject(got.err),
    undefined,
    `a payload carrier must draw no crafted sentence. Got ${JSON.stringify(translateServiceReject(got.err))}`,
  );
});

test("CLEAN [marker/forgery via the cloud reason phrase]: a chosen HTTP reason phrase cannot claim the sentence", async () => {
  // `Cloud ${status} ${statusText}: ${detail}` interpolates the reason phrase,
  // which the server picks. The interesting part is the PAYLOAD_CARRIERS shape:
  // the carrier head is "Cloud " with a SPACE while the new marker is "Cloud: "
  // with a colon, so the two heads are disjoint and the carrier is what has to
  // catch this.
  const got = await withServer((_q, res) => {
    res.writeHead(500, "Cloud: the stream ended before any terminal signal", { "content-type": "text/plain" });
    res.end("boom");
  }, (b) => outcome(() => driveCloud(b)));
  assert.strictEqual(got.ok, false, "a 500 rejects");
  assert.ok(got.message.includes("Cloud: the stream ended before any terminal signal"), "precondition: the forged marker is in the message");
  assert.strictEqual(translateServiceReject(got.err), undefined, "the anchored pass must miss and the carrier must suppress");
});

test("CLEAN [marker/colon heads reach the anchored pass at all]", async () => {
  // PAYLOAD_CARRIERS holds "Ollama " and "Cloud " with trailing spaces; the two
  // new markers are "Ollama: " and "Cloud: " with colons. If the passes ran in
  // the other order the colon forms would still be reached, because the heads
  // do not overlap - but the row exists so that a future reordering of the two
  // passes is caught here rather than in a user's toast.
  const ref = await reference();
  for (const m of ["Ollama: the stream ended before its done frame, so the reply is incomplete", "Cloud: the stream ended before any terminal signal, so the reply is incomplete"]) {
    assert.strictEqual(translateServiceReject(new Error(m)), ref.sentence, `${m} must draw the class sentence`);
  }
  for (const carrier of ["Ollama 500 x: y", "Cloud 500 x: y", "Ollama error: y"]) {
    assert.strictEqual(translateServiceReject(new Error(carrier)), undefined, `${carrier} is a payload carrier`);
  }
});

test("CLEAN [marker/no over-match]: neither new marker swallows another product throw", () => {
  // impl-v57-p4's concern, re-run for the two new heads: "Ollama: pull response
  // has no body" is a real throw that shares a prefix with the anchored row's
  // ollama markers and must NOT be translated.
  const heads = [
    "Ollama: the stream ended before its done frame",
    "Cloud: the stream ended before any terminal signal",
  ];
  const others = [
    "Ollama: pull response has no body",
    "Ollama: the stream ended before its done frame".slice(0, 20),
    "Cloud: the stream ended",
  ];
  for (const other of others) {
    assert.ok(!heads.some((h) => other.startsWith(h)), `${other} must not begin with a new marker`);
  }
  assert.strictEqual(translateServiceReject(new Error("Ollama: pull response has no body")), undefined, "the pull throw is untranslated");
});

test("CLEAN [marker/coupling]: each marker is the literal head of its throw in src", () => {
  // The table moved to its own leaf in session-v59 phase 1 so the download
  // toast and the tighten gesture could reach it. Same markers, same file to
  // read, one directory entry along.
  const table = readSrc("vscode", "failureToast.ts");
  for (const [file, marker] of [
    ["core/ollama.ts", "Ollama: the stream ended before its done frame"],
    ["core/cloudInstruct.ts", "Cloud: the stream ended before any terminal signal"],
  ]) {
    assert.ok(table.includes(`"${marker}"`), `${marker} must be a marker in SERVICE_REJECT_TOASTS`);
    const src = readSrc(...file.split("/"));
    assert.ok(src.includes(`throw new Error("${marker}`), `${file} must throw a message whose index 0 is ${JSON.stringify(marker)}`);
    assert.ok(src.includes("COUPLING"), `${file} must carry the coupling comment naming the table`);
  }
});

// ===========================================================================
// 6. THE SERVICE'S OWN GUARDS. A throw that pre-empts a more specific reject is
//    a regression in message quality even when it is technically correct.
// ===========================================================================

function service(base, generateFn) {
  return new FnGenService({ ...DEFAULT_FNGEN_CONFIG, apiBase: base, model: "test-model" }, generateFn, () => {});
}

const BODY = "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}";

const SERVICE_ARMS = [
  {
    label: "local",
    fn: () => generateInstruct,
    ctype: ND,
    truncated: [nd({ response: BODY }), nd({ done: true, done_reason: "length" })],
    empty: [nd({ response: "   " }), nd({ done: true, done_reason: "stop" })],
    cutFrames: [nd({ response: "fn add() {" })],
  },
  {
    label: "cloud",
    fn: (base) => makeCloudInstruct({ baseUrl: base, apiKey: "k" }),
    ctype: SSE,
    truncated: [sse({ choices: [{ delta: { content: BODY }, finish_reason: "length" }] }), DONE],
    empty: [sse({ choices: [{ delta: { content: "   " }, finish_reason: "stop" }] }), DONE],
    cutFrames: [sse({ choices: [{ delta: { content: "fn add() {" } }] })],
  },
];

for (const arm of SERVICE_ARMS) {
  test(`CLEAN [service/${arm.label} truncation]: done_reason "length" still reaches the truncation reject`, async () => {
    const got = await withServer(clean(arm.truncated, arm.ctype), (b) => outcome(() => service(b, arm.fn(b)).generateRaw("write a function")));
    assert.strictEqual(got.ok, false, "a truncated generation must be refused");
    assert.ok(
      got.message.startsWith("generation truncated at num_predict"),
      `the SPECIFIC reject must win, not the transport class. Got ${JSON.stringify(got.message)}`,
    );
    assert.ok(toast(got.err).includes("cut off mid-function"), `and its own sentence. Got ${JSON.stringify(toast(got.err))}`);
  });

  test(`CLEAN [service/${arm.label} empty]: a terminated stream with no usable text still reaches the empty reject`, async () => {
    const got = await withServer(clean(arm.empty, arm.ctype), (b) => outcome(() => service(b, arm.fn(b)).generateRaw("write a function")));
    assert.strictEqual(got.ok, false, "an empty generation must be refused");
    assert.strictEqual(
      got.message,
      "generation was empty after postprocess",
      `the SPECIFIC reject must win. Got ${JSON.stringify(got.message)}`,
    );
    assert.ok(toast(got.err).includes("no usable code"), `and its own sentence. Got ${JSON.stringify(toast(got.err))}`);
  });

  test(`CLEAN [service/${arm.label} cut]: a mid-reply cut reaches the user as the silent-server sentence end to end`, async () => {
    const ref = await reference();
    const got = await withServer(cut(arm.cutFrames, arm.ctype), (b) => outcome(() => service(b, arm.fn(b)).generateRaw("write a function")));
    assert.strictEqual(got.ok, false, `the half function must not be proposed. Got RESOLVED ${JSON.stringify(got.value)}`);
    assert.strictEqual(toast(got.err), ref.sentence);
  });
}

test("CLEAN [service/zero-frame 200]: an empty body is now the transport's class, not the service's", async () => {
  // A shift this phase makes and the contract does not name: a 200 with no
  // frames at all used to resolve with "" and draw the service's "no usable
  // code" sentence. It now draws the silent-server sentence, which is the
  // truer diagnosis for a server that answered with nothing. Pinned as a
  // deliberate move rather than left to surface as a surprise.
  const ref = await reference();
  for (const arm of SERVICE_ARMS) {
    const got = await withServer(clean([], arm.ctype), (b) => outcome(() => service(b, arm.fn(b)).generateRaw("write a function")));
    assert.strictEqual(got.ok, false, `${arm.label}: an empty body must be refused`);
    assert.strictEqual(toast(got.err), ref.sentence, `${arm.label}: and it is the transport's sentence now`);
  }
});

// ===========================================================================
// 7. WHY 10308 ROWS STAYED GREEN. The change is live; the pre-existing drives
//    simply never produce the shape it fires on.
// ===========================================================================

test("CLEAN [live/the guard fires]: the terminal signal is tracked and spent, on the built bundle", async () => {
  // Establishes that the two throws are wired rather than dead. If either arm
  // resolved here the whole phase would be inert and every other CLEAN row in
  // this file would be vacuous.
  for (const [label, handler, drive] of [
    ["local", cut(LOCAL_CUT, ND), driveLocal],
    ["cloud", cut(CLOUD_CUT, SSE), driveCloud],
  ]) {
    const got = await withServer(handler, (b) => outcome(() => drive(b)));
    assert.strictEqual(got.ok, false, `${label}: the guard must fire on a cut`);
    assert.notStrictEqual(got.value, HALF);
  }
});

test("CLEAN [live/pre-existing shapes are untouched]: a terminated stream and a non-2xx both behave as before", async () => {
  // The two shapes every pre-existing instruct row uses. The suite stayed green
  // because those rows either terminate their stream (blind2/impl2-ollama,
  // blind-cloud-instruct, which appends [DONE] to every fixture) or fail on the
  // HTTP status before the reader ever runs (the v56/v57 bounded-body files).
  const done = await withServer(clean([nd({ response: "x" }), nd({ done: true, done_reason: "stop" })], ND), (b) =>
    outcome(() => driveLocal(b)),
  );
  assert.strictEqual(done.ok, true, `a terminated stream resolves. Got ${done.message}`);

  const http500 = await withServer((_q, res) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("boom");
  }, (b) => outcome(() => driveLocal(b)));
  assert.strictEqual(http500.ok, false, "a non-2xx rejects");
  assert.ok(http500.message.startsWith("Ollama 500"), `with its own status message, before the reader. Got ${http500.message}`);
});
