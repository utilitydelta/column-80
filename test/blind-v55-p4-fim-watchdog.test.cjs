// Blind oracle, session-v55 phase 4: a hung FIM stream releases single-flight.
// Written from session-v55/contract-phase4.md ALONE, INCLUDING its "Amendment
// before the oracle", which replaces the queue's one-AbortSignal.timeout shape
// with a SILENCE watchdog: armed at the request, re-armed on every chunk.
// Nothing here was written from the fix; only the seam is read (generateFim's
// params, CompletionService's constructor, the fetch/NDJSON shape it drives).
//
// Every row is one numbered item under "What must hold", as amended.
//
// Run: SKIP_LIVE=1 node --test test/blind-v55-p4-fim-watchdog.test.cjs
//
// =============================================================================
// HOW TIME IS CONTROLLED - the one assumption in this file, and a contract hole
// =============================================================================
// The contract fixes the two numbers (60s to the first byte, 20s between
// chunks) and says nothing about how anything shortens them for a test. There
// is no dictated injection point, so guessing a parameter name (`firstByteMs`,
// `stallMs`, a config field, a dep) would spread an invented name through every
// row and rot the moment the implementer picks a different one.
//
// So this file names NOTHING from the fix. It compresses the clock instead:
// `globalThis.setTimeout` / `setInterval` and `AbortSignal.timeout` are wrapped
// so any delay of a PRODUCT scale (>= 1s) is divided by SPEEDUP, while the
// short waits this file's own rig uses pass through untouched. A 60s bound
// therefore fires 600ms into the run and a 20s bound 200ms in, whichever of the
// two plausible mechanisms (a re-armed setTimeout, or a re-created
// AbortSignal.timeout) the fix is built from, and whether or not the bounds end
// up injectable.
//
// Every real-time number below is stated in VIRTUAL milliseconds (what the
// product thinks elapsed) via real()/virtual(), so the rows read against the
// contract's numbers rather than against the compression factor.
//
// The one thing this cannot see is a watchdog built on `node:timers/promises`
// (bundled as an external require, so the global wrapper never sees it). Row
// RIG-1 fails loudly if the wrapper stops being installed at all, but it cannot
// detect that case; it is called out here and in the report instead.
//
// OTHER CONTRACT HOLES, each marked at its row:
//   H1. The contract does not say how a cut SETTLES generateFim - a rejected
//       AbortError, or a resolve carrying the partial text. Both release
//       single-flight, so no row asserts either; the rows assert "settled" plus
//       "the request was cut" (the fetch signal aborted, or the body cancelled).
//   H2. Item 5 says a cut "writes something to the channel" but does not say
//       what. Row 5a asserts only the literal contract (a line appears). Row 5b
//       is an INTERPRETATION of "a silent recovery leaves ... no evidence" and
//       is marked as such: the line should name the silence, because
//       "cancelled mid-request" attributes a dead server to the editor.
//   H3. The contract does not say which of the two bounds applies to a stream
//       that produced only whitespace/keepalive bytes and no token. No row
//       covers it.

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v55-p4",
  `export { generateFim } from "../src/core/ollama";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`,
);
const { generateFim, CompletionService, DEFAULT_FIM_CONFIG } = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// the clock compressor (see the header). Installed once, torn down at the end.
// ---------------------------------------------------------------------------

const SPEEDUP = 100;
const SCALE_FLOOR = 1000; // below this a delay is the rig's own, not a bound

/** virtual ms (what the product thinks elapsed) -> real ms this run waits */
const real = (virtualMs) => virtualMs / SPEEDUP;
/** real ms this run waited -> virtual ms the product thinks elapsed */
const virtual = (realMs) => Math.round(realMs * SPEEDUP);

const scale = (ms) => (typeof ms === "number" && ms >= SCALE_FLOOR ? ms / SPEEDUP : ms);

const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realAbortTimeout = AbortSignal.timeout.bind(AbortSignal);

const wrapTimer = (fn) => {
  const wrapped = function (handler, ms, ...rest) {
    return fn(handler, scale(ms), ...rest);
  };
  // node hangs util.promisify.custom and friends off these; keep them.
  for (const k of Reflect.ownKeys(fn)) {
    if (k === "length" || k === "name" || k === "prototype") continue;
    try {
      wrapped[k] = fn[k];
    } catch {
      /* non-writable, ignore */
    }
  }
  return wrapped;
};

globalThis.setTimeout = wrapTimer(realSetTimeout);
globalThis.setInterval = wrapTimer(realSetInterval);
AbortSignal.timeout = (ms) => realAbortTimeout(scale(ms));

test.after(() => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.setInterval = realSetInterval;
  AbortSignal.timeout = realAbortTimeout;
});

// Rig waits use the REAL timer directly, so they can never be compressed by a
// future change to SCALE_FLOOR.
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));

// The longest this file will wait for a bound to fire before calling it never.
// 240 virtual seconds: four times the contract's largest bound, so a bound the
// implementer sets generously still lands inside it.
const NEVER_MS = real(240_000);

// ---------------------------------------------------------------------------
// the fetch stub: a Response whose body is a stream this file drives
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

const abortError = () => {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
};

const fetchCalls = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, init = {}) => {
  let ctrl;
  const call = {
    url: String(url),
    signal: init.signal,
    cancelled: false, // the reader was released (reader.cancel())
    lastChunkAt: undefined,
    startedAt: Date.now(),
  };
  // A real ReadableStream, so the product's reader.read()/cancel() behave
  // exactly as they do against undici.
  call.body = new ReadableStream({
    start(c) {
      ctrl = c;
    },
    cancel() {
      call.cancelled = true;
    },
  });
  call.push = (obj) => {
    call.lastChunkAt = Date.now();
    try {
      ctrl.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
    } catch {
      /* already closed or errored: the product cut us */
    }
  };
  call.finish = () => {
    call.push({ response: "", done: true, done_reason: "stop" });
    try {
      ctrl.close();
    } catch {
      /* already closed */
    }
  };
  // "Was this request cut?" - abort of the signal handed to fetch (including a
  // composed one), or release of the body. Either is the product cutting it;
  // the contract does not pick between them, so neither does this file.
  call.wasCut = () => call.cancelled || !!call.signal?.aborted;
  if (init.signal) {
    if (init.signal.aborted) throw abortError();
    // undici errors the body stream when the request aborts; pending reads
    // reject. Without this the rig, not the product, would decide the outcome.
    init.signal.addEventListener("abort", () => {
      try {
        ctrl.error(abortError());
      } catch {
        /* already closed */
      }
    });
  }
  fetchCalls.push(call);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: call.body,
    text: async () => "",
  };
};

test.after(() => {
  globalThis.fetch = realFetch;
});

const resetFetch = () => {
  fetchCalls.length = 0;
};

const waitForCall = async (n) => {
  for (let i = 0; i < 400; i++) {
    if (fetchCalls.length >= n) return fetchCalls[n - 1];
    await sleep(5);
  }
  assert.fail(`timed out waiting for fetch call #${n}; saw ${fetchCalls.length}`);
};

// ---------------------------------------------------------------------------
// settle helpers. Every promise this file creates gets a handler attached the
// instant it exists, so an unhandled rejection can only ever be the product's.
// ---------------------------------------------------------------------------

const NOT_SETTLED = Symbol("not settled");

/** Attaches handlers immediately; resolves { status, value|reason, atMs }. */
const track = (p) => {
  const out = { status: "pending" };
  out.done = p.then(
    (value) => {
      out.status = "fulfilled";
      out.value = value;
      out.atMs = Date.now();
      return out;
    },
    (reason) => {
      out.status = "rejected";
      out.reason = reason;
      out.atMs = Date.now();
      return out;
    },
  );
  return out;
};

/** Waits up to budget for a tracked promise; NOT_SETTLED if it never lands. */
const settleWithin = async (tracked, budgetMs) => {
  const raced = await Promise.race([tracked.done, sleep(budgetMs).then(() => NOT_SETTLED)]);
  return raced === NOT_SETTLED ? NOT_SETTLED : tracked;
};

const unhandled = [];
process.on("unhandledRejection", (reason) => unhandled.push(reason));

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const API = "http://127.0.0.1:9/";

const fimParams = (over = {}) => ({
  apiBase: API,
  model: "fake-fim",
  prefix: "const a = 1;\nlet b = ",
  suffix: ";\n// end\n",
  maxTokens: 64,
  temperature: 0.01,
  signal: new AbortController().signal,
  ...over,
});

const cfg = (over = {}) => ({
  ...DEFAULT_FIM_CONFIG,
  apiBase: API,
  model: "fake-fim",
  debounceMs: 0,
  ...over,
});

const REQ = { prefix: "const a = 1;\nlet b = ", suffix: ";\n// end\n", manual: true };
const OTHER_REQ = { prefix: "const zzz = 9;\nlet q = ", suffix: ";\n// other\n", manual: true };

const channel = () => {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
};

// ===========================================================================
// RIG rows. Without these a red below could be the rig's fault, and a green
// could be vacuous.
// ===========================================================================

test("RIG-1: the clock compressor scales product-scale delays and leaves rig waits alone", async () => {
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 20_000)); // 20 virtual seconds
  const scaled = Date.now() - t0;
  assert.ok(
    scaled < real(20_000) * 4 + 60,
    `a 20s setTimeout must be compressed to about ${real(20_000)}ms, took ${scaled}ms - the wrapper is not installed`,
  );

  const t1 = Date.now();
  const sig = AbortSignal.timeout(60_000); // 60 virtual seconds
  await new Promise((r) => sig.addEventListener("abort", r));
  const scaledSignal = Date.now() - t1;
  assert.ok(
    scaledSignal < real(60_000) * 4 + 60,
    `AbortSignal.timeout(60s) must be compressed to about ${real(60_000)}ms, took ${scaledSignal}ms`,
  );

  const t2 = Date.now();
  await new Promise((r) => setTimeout(r, 40)); // rig scale: untouched
  assert.ok(Date.now() - t2 >= 35, "a sub-second wait is NOT compressed, so the rig's own waits stay honest");
});

test("RIG-2: a healthy stream through the fetch stub resolves generateFim with the whole text", async () => {
  resetFetch();
  const run = track(generateFim(fimParams()));
  const call = await waitForCall(1);
  call.push({ response: "hello" });
  call.push({ response: "()" });
  call.finish();

  const landed = await settleWithin(run, NEVER_MS);
  assert.notStrictEqual(landed, NOT_SETTLED, "the stub must be able to complete a request at all");
  assert.strictEqual(landed.status, "fulfilled", `a healthy stream resolves, got ${String(landed.reason)}`);
  assert.strictEqual(landed.value.text, "hello()", "the stub's NDJSON reaches the product intact");
  assert.strictEqual(call.wasCut(), false, "and a healthy stream is not cut");
});

// ===========================================================================
// Item 1 (amended, silence 1): NO FIRST BYTE.
// The server accepted the connection and sent nothing. Cut at the first-byte
// bound. RED today: ollama.ts has no timers at all, so this hangs forever.
// H1: no assertion on WHICH way it settles.
// ===========================================================================

test("item 1: a stream that never yields a first byte is cut at a bound, not left hanging", async () => {
  resetFetch();
  const t0 = Date.now();
  const run = track(generateFim(fimParams()));
  const call = await waitForCall(1);
  // never push, never close: an accepted connection that goes silent

  const landed = await settleWithin(run, NEVER_MS);
  assert.notStrictEqual(
    landed,
    NOT_SETTLED,
    `a silent stream must be cut; ${virtual(NEVER_MS)} virtual ms passed with no first byte and generateFim never settled`,
  );
  assert.strictEqual(call.wasCut(), true, "the request itself is cut (signal aborted or body released), not merely abandoned");
  assert.ok(
    virtual(landed.atMs - t0) >= 30_000,
    `the first-byte bound must stay generous - a cold model load is legitimate - but it fired after ${virtual(landed.atMs - t0)} virtual ms`,
  );
});

// ===========================================================================
// Item 2 (amended, silence 2): a STALL MID-STREAM, timed from the LAST chunk.
// Two legs in one row, because "from the last chunk" is only observable as a
// comparison: leg A stalls immediately, leg B streams for a while first. If the
// bound were measured from the request, B's cut would land sooner after its
// last chunk than A's does. RED today.
// ===========================================================================

const stallLeg = async (chunkGaps) => {
  resetFetch();
  const run = track(generateFim(fimParams()));
  const call = await waitForCall(1);
  call.push({ response: "x" });
  for (const gap of chunkGaps) {
    await sleep(gap);
    call.push({ response: "y" });
  }
  const lastChunkAt = call.lastChunkAt;
  const landed = await settleWithin(run, NEVER_MS);
  return { landed, call, lastChunkAt };
};

test("item 2: a stall mid-stream is cut, and the bound runs from the LAST chunk, not from the request", async () => {
  // Leg A: one chunk, then silence. Baseline for how long the stall bound is.
  const a = await stallLeg([]);
  assert.notStrictEqual(a.landed, NOT_SETTLED, "a stream that stops producing must be cut");
  assert.strictEqual(a.call.wasCut(), true, "the stalled request is cut");
  const boundA = a.landed.atMs - a.lastChunkAt;
  assert.ok(
    virtual(boundA) <= 60_000,
    `a mid-stream stall is a dead connection, not a thinking model; cut took ${virtual(boundA)} virtual ms after the last chunk`,
  );

  // Leg B: chunks 5 virtual seconds apart for 15 virtual seconds, THEN silence.
  // Every gap is inside the stall bound, so nothing here may be cut early; the
  // cut must land the same distance after B's last chunk as it did after A's.
  const b = await stallLeg([real(5_000), real(5_000), real(5_000)]);
  assert.notStrictEqual(b.landed, NOT_SETTLED, "the stall after a healthy run must still be cut");
  const boundB = b.landed.atMs - b.lastChunkAt;
  assert.ok(
    boundB >= boundA * 0.6,
    `the watchdog must RE-ARM on every chunk: after A's single chunk the cut came ${virtual(boundA)} virtual ms later, ` +
      `after B's last chunk only ${virtual(boundB)} - B's clock was still running from the request`,
  );
});

// ===========================================================================
// Item 3: A HEALTHY STREAM IS UNTOUCHED. The row that must not go red.
// This stream runs for 100 VIRTUAL SECONDS - past the 60s first-byte bound and
// past any total-duration cap at or below that - while never going quiet for
// more than 5 virtual seconds. A single AbortSignal.timeout measured from the
// request, which is the fix shape the amendment rejects, fails here.
// GREEN today (there is no watchdog) and must stay green.
// ===========================================================================

test("item 3: a slow but healthy stream running 100 virtual seconds is NOT cut (a total-duration cap fails this row)", async () => {
  resetFetch();
  const t0 = Date.now();
  const run = track(generateFim(fimParams()));
  const call = await waitForCall(1);

  const CHUNKS = 20;
  const GAP = real(5_000); // 5 virtual seconds between tokens: comfortably alive
  let expected = "";
  for (let i = 0; i < CHUNKS; i++) {
    call.push({ response: "tok" });
    expected += "tok";
    await sleep(GAP);
  }
  call.finish();

  const landed = await settleWithin(run, NEVER_MS);
  const elapsed = virtual(Date.now() - t0);
  assert.ok(
    elapsed >= 90_000,
    `the rig must actually outrun a 60s total cap for this row to bind; it only ran ${elapsed} virtual ms`,
  );
  assert.notStrictEqual(landed, NOT_SETTLED, "a healthy stream finishes");
  assert.strictEqual(
    landed.status,
    "fulfilled",
    `a healthy stream that takes ${elapsed} virtual ms must still resolve, got ${String(landed.reason)}`,
  );
  assert.strictEqual(
    landed.value.text,
    expected,
    "every chunk survives: a slow-but-working model must not be truncated by the hang fix",
  );
  assert.strictEqual(
    call.wasCut(),
    false,
    "and nothing aborted it - the bound is on SILENCE, never on how long the whole stream takes",
  );
});

// ===========================================================================
// Item 1, at the level the queue entry is actually about: SINGLE-FLIGHT.
// Driven through CompletionService with the REAL generateFim (no injected
// generate fn), because the defect is a same-key caller joining a dead promise.
// RED today: the first complete() never settles, so the second one joins it.
// ===========================================================================

test("item 1 (single-flight): after a hung request is cut, a new SAME-KEY call issues a fresh request", async () => {
  resetFetch();
  const svc = new CompletionService(cfg(), undefined, channel().log);
  try {
    const first = track(svc.complete(REQ));
    const call1 = await waitForCall(1);
    // silence forever: the hang the entry describes

    const firstLanded = await settleWithin(first, NEVER_MS);
    assert.notStrictEqual(
      firstLanded,
      NOT_SETTLED,
      "the hung completion must settle at the bound - while it is pending, single-flight is pinned",
    );
    assert.strictEqual(firstLanded.status, "fulfilled", "the service swallows the cut rather than rejecting at its caller");
    assert.strictEqual(firstLanded.value, undefined, "a cut request serves no ghost");
    assert.strictEqual(call1.wasCut(), true, "the dead request was cut, not left holding the connection");

    // The same key again: this is the user typing the same character back, or
    // simply asking again. It must NOT join the corpse.
    const second = track(svc.complete(REQ));
    const secondLanded = await settleWithin(second, NEVER_MS);
    assert.strictEqual(
      fetchCalls.length,
      2,
      "a same-key call after the bound must be a FRESH request; joining the dead promise leaves this at 1",
    );
    assert.notStrictEqual(secondLanded, NOT_SETTLED, "and the second call is not wedged behind the first");
  } finally {
    svc.dispose();
  }
});

// ===========================================================================
// Item 6: the EXISTING abort path still works, and composes with the bound.
// A key change must abort the loser immediately - not at the watchdog's bound -
// and must not turn into a double abort or a rejection at the caller.
// GREEN today; it is the regression guard on the composition.
// ===========================================================================

test("item 6: a key change still aborts the loser at once, well inside the bound, and both callers settle cleanly", async () => {
  resetFetch();
  const svc = new CompletionService(cfg(), undefined, channel().log);
  try {
    const first = track(svc.complete(REQ));
    const call1 = await waitForCall(1);
    const t0 = Date.now();

    const second = track(svc.complete(OTHER_REQ)); // DIFFERENT key: displaces it
    const call2 = await waitForCall(2);

    for (let i = 0; i < 200 && !call1.wasCut(); i++) await sleep(5);
    const cutAfter = virtual(Date.now() - t0);
    assert.strictEqual(call1.wasCut(), true, "the displaced request is aborted");
    assert.ok(
      cutAfter < 10_000,
      `the key-change abort is immediate, not the watchdog's job; it took ${cutAfter} virtual ms`,
    );

    const firstLanded = await settleWithin(first, NEVER_MS);
    assert.notStrictEqual(firstLanded, NOT_SETTLED, "the displaced caller settles");
    assert.strictEqual(firstLanded.status, "fulfilled", "and settles as a no-ghost, not as a rejection in the host");
    assert.strictEqual(firstLanded.value, undefined);

    call2.push({ response: "survivor()" });
    call2.finish();
    const secondLanded = await settleWithin(second, NEVER_MS);
    assert.notStrictEqual(secondLanded, NOT_SETTLED, "the winner is unaffected by the loser's abort");
    assert.strictEqual(secondLanded.status, "fulfilled", `the winner resolves, got ${String(secondLanded.reason)}`);
  } finally {
    svc.dispose();
  }
});

// ===========================================================================
// Item 5: the cut is OBSERVABLE. The channel is CompletionService's log fn.
// H2: 5a is the contract's literal claim; 5b is this oracle's reading of "a
// silent recovery leaves the user with a FIM that sometimes does not work and
// no evidence" and is flagged as an interpretation, not a dictated string.
// ===========================================================================

const cutThroughService = async () => {
  resetFetch();
  const ch = channel();
  const svc = new CompletionService(cfg(), undefined, ch.log);
  const run = track(svc.complete(REQ));
  await waitForCall(1);
  const landed = await settleWithin(run, NEVER_MS);
  svc.dispose();
  return { ch, landed };
};

test("item 5a: a hung request that is cut writes something to the channel", async () => {
  const { ch, landed } = await cutThroughService();
  assert.notStrictEqual(landed, NOT_SETTLED, "precondition: the hang was cut at all");
  assert.ok(
    ch.lines.length > 0,
    "a silent recovery is the failure mode item 5 names: the cut must leave evidence on the channel",
  );
});

test("item 5b [INTERPRETATION, see H2]: the channel line names the SILENCE, not a bare cancellation", async () => {
  const { ch, landed } = await cutThroughService();
  assert.notStrictEqual(landed, NOT_SETTLED, "precondition: the hang was cut at all");
  const NAMES_SILENCE = /timed out|timeout|stall|silen|watchdog|no first byte|no bytes|no response/i;
  assert.ok(
    ch.lines.some((l) => NAMES_SILENCE.test(l)),
    `the line must attribute the cut to a silent server; a bare "cancelled"/"request failed" points a dogfood ` +
      `session at the editor when the cause was a dead stream. Got: ${JSON.stringify(ch.lines)}`,
  );
});

// ===========================================================================
// The numbers: the two bounds are DIFFERENT, and the first-byte one is the
// generous one. Straight out of the amendment ("the numbers differ because the
// waits are different"). Bands, not equalities: the contract's justification -
// a cold model load is legitimate, a mid-stream gap is a dead connection - is
// what is pinned, not 60000 and 20000 to the millisecond.
// ===========================================================================

test("the numbers: the first-byte bound is materially larger than the stall bound", async () => {
  resetFetch();
  const t0 = Date.now();
  const silent = track(generateFim(fimParams()));
  await waitForCall(1);
  const silentLanded = await settleWithin(silent, NEVER_MS);
  assert.notStrictEqual(silentLanded, NOT_SETTLED, "precondition: the first-byte bound fires");
  const firstByte = virtual(silentLanded.atMs - t0);

  const a = await stallLeg([]);
  assert.notStrictEqual(a.landed, NOT_SETTLED, "precondition: the stall bound fires");
  const stall = virtual(a.landed.atMs - a.lastChunkAt);

  assert.ok(
    firstByte >= stall * 1.5,
    `two distinct silences, two numbers: waiting for a model to load must be given more room than a gap ` +
      `mid-generation. first-byte=${firstByte} virtual ms, stall=${stall} virtual ms`,
  );
  assert.ok(
    firstByte >= 30_000,
    `the first-byte bound must survive a cold model load on a shared server; it is ${firstByte} virtual ms`,
  );
  assert.ok(
    stall <= 60_000,
    `once tokens flow a gap this long is a dead connection, not a slow model; the stall bound is ${stall} virtual ms`,
  );
});

// ===========================================================================
// Item 7: NO UNHANDLED REJECTION, EVER. An aborted fetch rejects; nothing may
// let it escape. Runs last so it also sees whatever every row above shook out.
// Each abort source gets its OWN service, so this row never depends on the fix
// existing - it is green today and is the guard that the fix keeps it that way.
// ===========================================================================

test("item 7: no unhandled rejection escapes - not from the bound, not from a key change, not from dispose", async () => {
  // (a) cut by the bound: nobody but the service awaits the hung generation.
  resetFetch();
  const byBound = new CompletionService(cfg(), undefined, channel().log);
  const hung = track(byBound.complete(REQ));
  await waitForCall(1);
  await settleWithin(hung, NEVER_MS);
  byBound.dispose();

  // (b) cut by a key change, on a fresh service so the join in (a) cannot
  //     swallow the second call while the fix is missing.
  resetFetch();
  const byKey = new CompletionService(cfg(), undefined, channel().log);
  const displaced = track(byKey.complete(REQ));
  await waitForCall(1);
  const winner = track(byKey.complete(OTHER_REQ));
  await waitForCall(2);
  await settleWithin(displaced, NEVER_MS);

  // (c) cut by dispose, mid-flight, with the winner still streaming.
  byKey.dispose();
  await settleWithin(winner, NEVER_MS);

  // Give the loop the turns an unhandledRejection needs to be reported.
  await sleep(100);
  assert.deepStrictEqual(
    unhandled.map(String),
    [],
    "an abort rejection that escapes turns a recoverable hang into a visible error in the extension host",
  );
});
