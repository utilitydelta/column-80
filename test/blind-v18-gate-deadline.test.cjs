// BLIND ORACLE - v18 phase 3 "the gate and the prompt block stop sharing a
// deadline" [the phase-3 surface contract]. Black-box over CompletionService.
// Never reads src/**: the entry re-exports the module and esbuild resolves it
// at bundle time only. Written against the FROZEN CONTRACT, not the code.
//
// The defect being closed, from the live capture: memberSite=true
// injected=false, "[fim] injection skipped: resolver slower than 50ms", and the
// model then wrote `s.insert(&x, &y)` - an invented method. The resolver's work
// HAD been done; its result was dropped because it lost a race that was never
// the gate's. So the site that most needed policing got none.
//
// THE SHAPE THIS PHASE EXISTS FOR, and the backbone of this file (section B): a
// resolver SLOWER than INJECTION_DEADLINE_MS but FASTER than generation. Both
// halves must hold - no block in the prompt, AND the invented member still
// dropped.
//
// Expected RED until phase 3 lands: everything that needs the gate to see a
// late resolution (B, D, F2, I). Expected GREEN today as the regression net:
// C (the prompt is unchanged for every input), E (one resolver call), G
// (cancellation), H (gate absent on a failed/empty resolution, non-member
// sites, no resolver).
//
// HOW THE TIMING TESTS ARE MADE ROBUST. Two rules, applied everywhere:
//   1. "Slower than the deadline" is expressed as sleep(DEADLINE + margin).
//      setTimeout never fires EARLY, so a slow box can only make the resolver
//      later, which is the safe direction. No test asserts a resolver was fast.
//   2. "Faster than generation" is expressed as ORDER, not milliseconds: the
//      fake generate awaits the resolver's own settle promise, so generation
//      provably ends after the resolution arrives on any box, at any speed.
// Only two assertions mention a duration at all (F3 and the hang guards), each
// a deliberately loose upper bound with the reason it is safe written next to
// it.
//
// Run: SKIP_LIVE=1 node --test test/blind-v18-gate-deadline.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore, sleep } = require("./.blind-util.cjs");

// `export *`, never named re-exports: a named re-export of a constant that does
// not exist yet is an esbuild BUILD error, which would collapse every test into
// one harness failure and hide the regression net.
let mod = {};
let cleanup = () => {};
let bundleError;
try {
  const built = bundleCore(
    "blind-v18-gate-deadline",
    `export * from "../src/core/completionService";\n`
  );
  mod = built.mod;
  cleanup = built.cleanup;
} catch (e) {
  bundleError = e;
}
test.after(() => cleanup());

test("harness: src/core/completionService bundles [harness guard - any red here is a build problem, not a contract failure]", () => {
  if (bundleError) assert.fail(`the module does not build: ${bundleError.message}`);
});

const service = (...args) => {
  if (bundleError) assert.fail(`the module does not build: ${bundleError.message}`);
  if (typeof mod.CompletionService !== "function") {
    assert.fail("src/core/completionService exports no CompletionService");
  }
  return new mod.CompletionService(...args);
};

const deadline = () => {
  if (bundleError) assert.fail(`the module does not build: ${bundleError.message}`);
  const d = mod.INJECTION_DEADLINE_MS;
  if (typeof d !== "number" || !(d > 0)) {
    assert.fail(`src/core/completionService exports no usable INJECTION_DEADLINE_MS (got ${JSON.stringify(d)})`);
  }
  return d;
};

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const CFG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-model",
  maxTokens: 64,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 3000,
  suffixChars: 1000,
  multiline: true,
  cacheCapacity: 100,
};

const STORE_MEMBERS = ["aggregateFanouts", "tileTally", "placeOrder"];
// The sentinel is what every prompt assertion looks for. It cannot occur in a
// prompt the resolver did not contribute to.
const SENTINEL = "V18P3_BLOCK_SENTINEL";
const BLOCK =
  `// ${SENTINEL}\n// available here (use one of these exact names, do not invent):\n// tileTally: number`;
const FULL = { block: BLOCK, memberNames: STORE_MEMBERS };
const NAMES_ONLY = { memberNames: STORE_MEMBERS };

// The captured hallucination itself: `insert` is on no member list here.
const INVENTED = "insert(&x, &y)";
const REAL = "tileTally(1)";
const MEMBERSHIP_REASON = "ghost names no resolved member";

const MEMBER_REQ = {
  prefix: "let s = store.",
  suffix: ";\n",
  manual: true,
  memberSite: true,
  memberPartial: "",
  memberReceiver: "store",
};

// Counting fake generate. `waitFor`, when supplied, is awaited INSIDE the model
// call: that is how "the resolver is faster than generation" is expressed as an
// ordering rather than as a race between two timers.
function makeGenerate(texts, waitFor) {
  const list = Array.isArray(texts) ? texts : [texts];
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    if (waitFor) await waitFor();
    return { text: list[Math.min(calls.length - 1, list.length - 1)], ttftMs: 1, totalMs: 2 };
  };
  return { fn, calls };
}

// A resolver that answers `injection` only after `delayMs`. Counts asks and
// exposes a promise that settles when it has answered.
function makeResolver(injection, delayMs) {
  const state = { asked: 0, answeredAt: 0 };
  let release;
  const answered = new Promise((r) => (release = r));
  const fn = async () => {
    state.asked += 1;
    if (delayMs) await sleep(delayMs);
    state.answeredAt = Date.now();
    release();
    return injection;
  };
  // Bounded: if the service never asks, generation must not hang the test.
  return { fn, state, settled: () => Promise.race([answered, sleep(4000)]) };
}

// Fails rather than hangs. Every bound here is far above any plausible
// implementation timing; they exist to turn "it hangs" into a readable red.
const within = async (ms, promise, what) => {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: did not settle within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timer);
  }
};

const hitLine = (lines) => {
  const found = lines.filter((l) => l.startsWith("[fim] cache hit"));
  assert.strictEqual(found.length, 1, `expected exactly one "[fim] cache hit" line, got ${JSON.stringify(lines)}`);
  return found[0];
};

const fields = (line) =>
  Object.fromEntries([...line.matchAll(/([A-Za-z][A-Za-z0-9]*)=(\S+)/g)].map((m) => [m[1], m[2]]));

// ===========================================================================
// A. THE TWO BOUNDS ARE SEPARATE CONSTANTS [surface: "The gate's wait is
//    bounded, and the bound is its own" + "What must NOT change:
//    INJECTION_DEADLINE_MS keeps its current value"].
// ===========================================================================

test("A1. INJECTION_DEADLINE_MS is still exported and still a positive number - this phase tunes no timing constant [surface: 'INJECTION_DEADLINE_MS does not change, and no existing constant changes']", () => {
  const d = deadline();
  assert.ok(Number.isFinite(d) && d > 0, `expected a positive finite deadline, got ${JSON.stringify(d)}`);
});

// The bound's NAME is not in the surface, only that it is "a separate exported
// constant, not INJECTION_DEADLINE_MS and not derived from it". So this reads
// the module's own exports rather than guessing a name: any other numeric
// millisecond constant satisfies the contract, and the value must be larger.
test("A2. the gate's wait has its OWN exported bound: a separate numeric constant, distinct from INJECTION_DEADLINE_MS and larger than it [surface: 'A separate exported constant, not INJECTION_DEADLINE_MS and not derived from it']", () => {
  const d = deadline();
  const candidates = Object.keys(mod).filter(
    (k) => k !== "INJECTION_DEADLINE_MS" && typeof mod[k] === "number" && /MS$/.test(k)
  );
  assert.ok(
    candidates.length > 0,
    `src/core/completionService exports no second millisecond constant for the gate's wait; exported numbers: ${JSON.stringify(
      Object.keys(mod).filter((k) => typeof mod[k] === "number")
    )}`
  );
  const larger = candidates.filter((k) => mod[k] > d);
  assert.ok(
    larger.length > 0,
    `the gate's bound must be LARGER than the injection deadline (${d}ms); candidates were ${JSON.stringify(
      candidates.map((k) => `${k}=${mod[k]}`)
    )}`
  );
});

// ===========================================================================
// B. THE CENTRAL CASE - the shape this phase exists for, and one no current
//    test produces [surface: "The shape this phase exists for"]. The resolver
//    is slower than INJECTION_DEADLINE_MS (a sleep strictly longer than it, so
//    a slow box can only make it later) and faster than generation (the model
//    call awaits the resolution, so the ordering holds at any speed).
//
//    BOTH halves are asserted every time: the prompt did not get the block,
//    AND the invented member was still dropped.
// ===========================================================================

test("B1. THE CENTRAL CASE: a resolver slower than the injection deadline but faster than generation contributes NOTHING to the prompt and STILL gates - `insert(&x, &y)` is dropped, which is exactly the completion the live capture shipped [surface: 'The shape this phase exists for' + 'a new state becomes reachable and is the point of the phase']", async () => {
  const d = deadline();
  const lines = [];
  const r = makeResolver(FULL, d + 100); // strictly past the deadline, always
  const g = makeGenerate([INVENTED], r.settled); // generation ends after the resolution
  const svc = service(CFG, g.fn, (l) => lines.push(l));

  const out = await within(6000, svc.complete({ ...MEMBER_REQ, resolveInjection: r.fn }), "complete");

  // Half 1: the prompt is untouched. The block lost the injection race and must
  // stay lost - this phase is a decoupling, not a longer injection deadline.
  assert.strictEqual(g.calls.length, 1, "the model was called exactly once");
  assert.ok(
    !g.calls[0].prefix.includes(SENTINEL),
    `the late block must NOT reach the prompt; got prefix ${JSON.stringify(g.calls[0].prefix)}`
  );
  // Half 2: the gate ran anyway, on evidence that arrived after the deadline.
  assert.strictEqual(
    out,
    undefined,
    `the invented member must be suppressed even though the block never reached the prompt; got ${JSON.stringify(out)} - this IS the captured defect`
  );
  assert.ok(
    lines.some((l) => l.includes(MEMBERSHIP_REASON)),
    `and the gate must say so: expected a line containing ${JSON.stringify(MEMBERSHIP_REASON)}, got ${JSON.stringify(lines)}`
  );
  assert.strictEqual(r.state.asked, 1, "and the whole thing cost one resolver query");
  svc.dispose();
});

test("B2. the same late resolution passes a ghost that names a REAL member - the late gate polices, it does not blanket-suppress [surface: 'The gate takes the resolver's evidence whenever it arrives']", async () => {
  const d = deadline();
  const r = makeResolver(FULL, d + 100);
  const g = makeGenerate([REAL], r.settled);
  const svc = service(CFG, g.fn);
  const out = await within(6000, svc.complete({ ...MEMBER_REQ, resolveInjection: r.fn }), "complete");
  assert.ok(out, "a real member must still be served");
  assert.strictEqual(out.text, REAL, "and byte-for-byte");
  assert.ok(!g.calls[0].prefix.includes(SENTINEL), "with the block still absent from the prompt");
  svc.dispose();
});

test("B3. names WITHOUT a block, arriving late, still gate - the gate needs names, not an injected block [surface: 'The gate takes the resolver's evidence whenever it arrives']", async () => {
  const d = deadline();
  const r = makeResolver(NAMES_ONLY, d + 100);
  const g = makeGenerate([INVENTED], r.settled);
  const svc = service(CFG, g.fn);
  const out = await within(6000, svc.complete({ ...MEMBER_REQ, resolveInjection: r.fn }), "complete");
  assert.strictEqual(out, undefined, `late names alone must gate; got ${JSON.stringify(out)}`);
  svc.dispose();
});

test("B4. the control: the SAME invented ghost with the SAME resolver answering INSIDE the deadline is dropped too - the phase closes the gap between the two timings, it does not change what the gate decides [surface: 'This is a decoupling, not a tuning']", async () => {
  const g = makeGenerate([INVENTED]);
  const svc = service(CFG, g.fn);
  const out = await within(6000, svc.complete({ ...MEMBER_REQ, resolveInjection: async () => FULL }), "complete");
  assert.strictEqual(out, undefined, `an invented member is dropped when the resolver is fast; got ${JSON.stringify(out)}`);
  assert.ok(g.calls[0].prefix.includes(SENTINEL), "precondition: a fast resolver DOES reach the prompt");
  svc.dispose();
});

// ===========================================================================
// C. THE PROMPT IS UNCHANGED FOR EVERY INPUT [surface: "The prompt block is
//    unchanged" + "What must NOT change: the prompt, for every input"]. The
//    prompt is read directly off the injected generate fn's params, never
//    inferred from an outcome. THIS IS THE REGRESSION NET - expected green.
// ===========================================================================

// Runs one completion and hands back the prefix the model actually saw.
const promptFor = async (opts) => {
  const g = makeGenerate([REAL]);
  const svc = service(CFG, g.fn);
  const req = { ...MEMBER_REQ };
  if ("resolveInjection" in opts) req.resolveInjection = opts.resolveInjection;
  if ("memberSite" in opts) req.memberSite = opts.memberSite;
  await within(6000, svc.complete(req), "complete");
  svc.dispose();
  assert.strictEqual(g.calls.length, 1, "exactly one model call");
  return g.calls[0].prefix;
};

test("C1. a resolver that BEATS the injection deadline still injects: the block is in the prefix the model was handed [surface: 'A block is injected if and only if the resolver produced one AND beat INJECTION_DEADLINE_MS']", async () => {
  const prefix = await promptFor({ resolveInjection: async () => FULL });
  assert.ok(prefix.includes(SENTINEL), `expected the block in the prompt, got ${JSON.stringify(prefix)}`);
});

test("C2. a resolver that MISSES the injection deadline produces a prompt BYTE-IDENTICAL to the no-resolver prompt - a late block contributes nothing, exactly as today [surface: 'A resolver that answers at 80ms contributes nothing to the prompt ... exactly as today']", async () => {
  const d = deadline();
  const late = await promptFor({ resolveInjection: async () => { await sleep(d + 100); return FULL; } });
  // `resolveInjection` deliberately ABSENT, not undefined: an explicitly passed
  // undefined is treated as absent by a default parameter, which has produced
  // falsely-green results in this session.
  const none = await promptFor({});
  assert.ok(!late.includes(SENTINEL), `a late block must not reach the prompt, got ${JSON.stringify(late)}`);
  assert.strictEqual(
    late,
    none,
    "the prompt built around a late resolver must be byte-identical to the prompt built with no resolver at all"
  );
});

test("C3. the whole prompt matrix in one place: only a resolution that beat the deadline changes the prompt, and every other input yields the same bytes [surface: 'The prompt, for every input. A test that compares the generated prefix before and after this change must find no difference']", async () => {
  const d = deadline();
  const none = await promptFor({});
  const rows = [
    { name: "no resolver at all", opts: {}, injects: false },
    { name: "resolver answers immediately with a block", opts: { resolveInjection: async () => FULL }, injects: true },
    { name: "resolver answers immediately with names only - nothing to inject", opts: { resolveInjection: async () => NAMES_ONLY }, injects: false },
    { name: "resolver answers past the deadline with a block", opts: { resolveInjection: async () => { await sleep(d + 100); return FULL; } }, injects: false },
    { name: "resolver answers past the deadline with names only", opts: { resolveInjection: async () => { await sleep(d + 100); return NAMES_ONLY; } }, injects: false },
    { name: "resolver throws", opts: { resolveInjection: async () => { throw new Error("rust-analyzer exploded"); } }, injects: false },
    { name: "resolver resolves undefined", opts: { resolveInjection: async () => undefined }, injects: false },
    { name: "resolver hangs past the deadline and never answers", opts: { resolveInjection: () => new Promise(() => {}) }, injects: false },
  ];
  const bad = [];
  for (const row of rows) {
    try {
      const prefix = await promptFor(row.opts);
      if (row.injects) {
        assert.ok(prefix.includes(SENTINEL), `expected the block in the prompt, got ${JSON.stringify(prefix)}`);
        assert.notStrictEqual(prefix, none, "an injected prompt must differ from the un-injected one");
      } else {
        assert.strictEqual(prefix, none, `expected the prompt to be byte-identical to the no-resolver prompt, got ${JSON.stringify(prefix)}`);
      }
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
  }
  if (bad.length) assert.fail(`${bad.length}/${rows.length} cases failed:\n  - ${bad.join("\n  - ")}`);
});

test("C4. the two log lines keep their current meaning and conditions: a resolver that beats the deadline logs the injection, one that misses it logs the skip - and the skip line is still emitted in the very case where the gate now runs [surface: 'The [fim] injected candidates and [fim] injection skipped: resolver slower than Nms lines keep their current meaning and conditions']", async () => {
  const d = deadline();

  const fastLines = [];
  const fast = service(CFG, makeGenerate([REAL]).fn, (l) => fastLines.push(l));
  await within(6000, fast.complete({ ...MEMBER_REQ, resolveInjection: async () => FULL }), "fast complete");
  fast.dispose();
  assert.ok(
    fastLines.some((l) => l.includes("injected candidates")),
    `a resolver inside the deadline logs the injection, got ${JSON.stringify(fastLines)}`
  );
  assert.ok(
    !fastLines.some((l) => l.includes("injection skipped")),
    `and does not log a skip, got ${JSON.stringify(fastLines)}`
  );

  const slowLines = [];
  const r = makeResolver(FULL, d + 100);
  const slow = service(CFG, makeGenerate([REAL], r.settled).fn, (l) => slowLines.push(l));
  await within(6000, slow.complete({ ...MEMBER_REQ, resolveInjection: r.fn }), "slow complete");
  slow.dispose();
  assert.ok(
    slowLines.some((l) => l.includes("injection skipped")),
    `a resolver past the deadline still logs the skip, got ${JSON.stringify(slowLines)}`
  );
  assert.ok(
    !slowLines.some((l) => l.includes("injected candidates")),
    `and must not claim an injection it did not make, got ${JSON.stringify(slowLines)}`
  );
});

// ===========================================================================
// D. THE NEW REACHABLE STATE: injected:false with the gate LIVE [surface: 'So a
//    new state becomes reachable and is the point of the phase']. Observed
//    through the phase-1 provenance on the `[fim] cache hit` line, which is the
//    only channel a black-box consumer has for what was recorded about the
//    authoring site.
// ===========================================================================

test("D1. a completion authored under a LATE resolution records injected=false with gated=true - the prompt was not helped and the output was still policed [surface: 'injected: false with the gate LIVE. The prompt was not helped, and the output is still policed']", async () => {
  const d = deadline();
  const lines = [];
  const r = makeResolver(FULL, d + 100);
  const g = makeGenerate([REAL], r.settled);
  const svc = service(CFG, g.fn, (l) => lines.push(l));
  const req = () => ({ ...MEMBER_REQ, resolveInjection: r.fn });

  const first = await within(6000, svc.complete(req()), "first complete");
  assert.ok(first && first.text === REAL, `precondition: the real member is served, got ${JSON.stringify(first)}`);

  lines.length = 0;
  const second = await within(6000, svc.complete(req()), "second complete");
  assert.ok(second, "the gate-grounded completion must be cache-eligible: names the gate ran on ground it");
  assert.strictEqual(second.fromCache, true, `expected a cache hit, got ${JSON.stringify(second)}`);
  assert.strictEqual(g.calls.length, 1, "no second model call");
  const f = fields(hitLine(lines));
  assert.strictEqual(f.memberSite, "true", "authored at a member site");
  assert.strictEqual(f.injected, "false", "the block never reached the prompt");
  assert.strictEqual(
    f.gated,
    "true",
    `the gate ran on the late evidence - injected=false with gated=true is the state this phase makes reachable; got the line ${JSON.stringify(hitLine(lines))}`
  );
  svc.dispose();
});

// ===========================================================================
// E. ONE RESOLVER CALL PER GENERATION [surface: "The resolver is called exactly
//    once per generation ... Two consumers share one promise; they do not each
//    ask"]. Counting is the only way to tell a shared promise from a second
//    query that happens to return the same thing. Expected GREEN today, and the
//    row that stops the fix being "just ask again before the gate".
// ===========================================================================

test("E1. one generation asks the resolver exactly ONCE, whether it beats the deadline or misses it - the prompt and the gate share one promise, they do not each ask [surface: 'It was one language-server query per generation before and must stay one']", async () => {
  const d = deadline();
  const bad = [];
  const rows = [
    { name: "resolver inside the deadline", delay: 0, injection: FULL },
    { name: "resolver past the deadline (the shared-promise case)", delay: d + 100, injection: FULL },
    { name: "resolver past the deadline, names only", delay: d + 100, injection: NAMES_ONLY },
    { name: "resolver past the deadline, produced nothing", delay: d + 100, injection: undefined },
  ];
  for (const row of rows) {
    const r = makeResolver(row.injection, row.delay);
    const g = makeGenerate([REAL], row.delay ? r.settled : undefined);
    const svc = service(CFG, g.fn);
    try {
      await within(6000, svc.complete({ ...MEMBER_REQ, resolveInjection: r.fn }), "complete");
      assert.strictEqual(g.calls.length, 1, `expected one generation, got ${g.calls.length}`);
      assert.strictEqual(
        r.state.asked,
        1,
        `expected exactly 1 resolver query for 1 generation, got ${r.state.asked} - a second query is a second language-server round trip on the keystroke path`
      );
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
    svc.dispose();
  }
  if (bad.length) assert.fail(`${bad.length}/${rows.length} cases failed:\n  - ${bad.join("\n  - ")}`);
});

// ===========================================================================
// F. THE GATE'S WAIT IS BOUNDED, AND COSTS NOTHING WHEN IT NEED NOT WAIT
//    [surface: "The gate's wait is bounded, and the bound is its own" + "It
//    costs nothing when the resolver already answered"].
// ===========================================================================

test("F1. a resolver that NEVER resolves does not hang the completion: complete() still returns, with no evidence and therefore no gate [surface: 'its job is to stop a hung language server hanging the completion']", async () => {
  const g = makeGenerate([INVENTED]);
  const svc = service(CFG, g.fn);
  // No assumption about the bound's VALUE: the guard below is far above any
  // plausible bound for a wait whose only job is to unstick a hung server, so
  // it distinguishes "bounded" from "hangs", which is what the contract says.
  const out = await within(
    8000,
    svc.complete({ ...MEMBER_REQ, resolveInjection: () => new Promise(() => {}) }),
    "complete against a hung resolver"
  );
  assert.ok(out, "the completion must still be returned; a hung language server may not hang the keystroke");
  assert.strictEqual(out.text, INVENTED, "and with no evidence there is no gate, so nothing is suppressed");
  svc.dispose();
});

test("F2. the gate waits for a resolution that arrives AFTER generation has already finished: generation is instant here, so the only way the invented member is dropped is a wait that outlives the model call [surface: 'Before the gate runs, the service awaits the resolver's outstanding promise under a SEPARATE and larger bound']", async () => {
  const d = deadline();
  const r = makeResolver(FULL, d + 100);
  // No waitFor: the model returns immediately, well before the resolver.
  const g = makeGenerate([INVENTED]);
  const svc = service(CFG, g.fn);
  const out = await within(6000, svc.complete({ ...MEMBER_REQ, resolveInjection: r.fn }), "complete");
  assert.strictEqual(
    out,
    undefined,
    `the gate must await the outstanding resolution rather than run without it; got ${JSON.stringify(out)}`
  );
  assert.ok(!g.calls[0].prefix.includes(SENTINEL), "and the prompt is still untouched");
  svc.dispose();
});

test("F3. an already-answered resolver adds no wait: awaiting a settled promise is not a delay [surface: 'It costs nothing when the resolver already answered ... add no measurable wait']", async () => {
  const g = makeGenerate([REAL]);
  const svc = service(CFG, g.fn);
  const t0 = Date.now();
  const out = await within(6000, svc.complete({ ...MEMBER_REQ, resolveInjection: async () => FULL }), "complete");
  const elapsed = Date.now() - t0;
  assert.ok(out, "the completion is served");
  // A loose bound, and safe because everything in this call is immediate: the
  // resolver answers synchronously-ish, generation is a resolved promise, and
  // debounceMs is 0. Anything close to a second here means the gate is waiting
  // on something it already has. 400ms leaves an enormous margin for a loaded
  // CI box while still failing an implementation that waits out a bound.
  assert.ok(
    elapsed < 400,
    `an already-settled resolution must not cost a wait; the call took ${elapsed}ms`
  );
  svc.dispose();
});

// ===========================================================================
// G. CANCELLATION [surface: "Cancellation is respected"]. An aborted request
//    does not wait for the resolver, and returns without a completion.
// ===========================================================================

test("G1. an aborted request does not wait for the resolver: with a resolver that never answers, an abort returns the call without a completion [surface: 'An aborted request does not wait for the resolver ... the call returns without a completion, as an aborted call does today']", async () => {
  const g = makeGenerate([REAL]);
  const svc = service(CFG, g.fn);
  const ac = new AbortController();
  const p = svc.complete(
    { ...MEMBER_REQ, resolveInjection: () => new Promise(() => {}) },
    ac.signal
  );
  setTimeout(() => ac.abort(), 20);
  const out = await within(8000, p, "aborted complete");
  assert.strictEqual(out, undefined, `an aborted call returns without a completion, got ${JSON.stringify(out)}`);
  svc.dispose();
});

test("G2. dispose during a pending resolution also returns the call without a completion - the wait is cancellable, not merely bounded [surface: 'Cancellation is respected']", async () => {
  const g = makeGenerate([REAL]);
  const svc = service(CFG, g.fn);
  const p = svc.complete({ ...MEMBER_REQ, resolveInjection: () => new Promise(() => {}) });
  setTimeout(() => svc.dispose(), 20);
  const out = await within(8000, p, "disposed complete");
  assert.strictEqual(out, undefined, `a disposed call returns without a completion, got ${JSON.stringify(out)}`);
});

// ===========================================================================
// H. NO RESOLUTION, NO GATE - unchanged [surface: "A resolver that fails or
//    produces nothing leaves the gate absent, exactly as today" + "What must
//    NOT change: non-member sites, and requests with no resolver"]. THIS IS THE
//    REGRESSION NET - expected green today and green after.
// ===========================================================================

const noGateRows = [
  { name: "the resolver THROWS", make: () => async () => { throw new Error("rust-analyzer exploded"); } },
  // No synchronous-throw row: `resolveInjection` is typed `() => Promise<...>`,
  // so a resolver that throws before returning a promise is outside the
  // contract, and today's service returns no completion for it.
  { name: "the resolver resolves undefined", make: () => async () => undefined },
  { name: "the resolver rejects", make: () => () => Promise.reject(new Error("nope")) },
  { name: "the resolver answers an EMPTY injection", make: () => async () => ({}) },
  { name: "the resolver throws LATE, past the injection deadline", make: (d) => async () => { await sleep(d + 100); throw new Error("late boom"); } },
  { name: "the resolver resolves undefined LATE, past the injection deadline", make: (d) => async () => { await sleep(d + 100); return undefined; } },
  { name: "the resolver answers an EMPTY injection LATE", make: (d) => async () => { await sleep(d + 100); return {}; } },
];

test("H1. a resolver that fails or produces nothing leaves the gate ABSENT - the invented member is SERVED, whether the failure is early or late; this phase makes the gate wait for evidence, it does not invent it [surface: 'A resolver that fails or produces nothing leaves the gate absent, exactly as today ... No resolution, no gate is unchanged']", async () => {
  const d = deadline();
  const bad = [];
  for (const row of noGateRows) {
    const g = makeGenerate([INVENTED]);
    const svc = service(CFG, g.fn);
    try {
      const out = await within(6000, svc.complete({ ...MEMBER_REQ, resolveInjection: row.make(d) }), "complete");
      assert.ok(out, `expected the ghost served with no gate, got ${JSON.stringify(out)}`);
      assert.strictEqual(out.text, INVENTED, "served byte-for-byte: there is no evidence to police it with");
      assert.ok(!g.calls[0].prefix.includes(SENTINEL), "and nothing reached the prompt");
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
    svc.dispose();
  }
  if (bad.length) assert.fail(`${bad.length}/${noGateRows.length} cases failed:\n  - ${bad.join("\n  - ")}`);
});

test("H2. a request with NO resolver at all is unchanged: nothing injected, no gate, the ghost served - and the argument is passed by ABSENCE, never as an explicit undefined [surface: 'What must NOT change: non-member sites, and requests with no resolver, behave exactly as today']", async () => {
  const g = makeGenerate([INVENTED]);
  const svc = service(CFG, g.fn);
  const req = { ...MEMBER_REQ };
  assert.ok(!("resolveInjection" in req), "the request genuinely carries no resolver key");
  const out = await within(6000, svc.complete(req), "complete");
  assert.ok(out && out.text === INVENTED, `no resolver means no gate, got ${JSON.stringify(out)}`);
  assert.ok(!g.calls[0].prefix.includes(SENTINEL), "and no block");
  svc.dispose();
});

test("H3. a NON-member site is unchanged, even with a late resolver: nothing is gated there and the prompt is the plain one [surface: 'What must NOT change: non-member sites ... behave exactly as today']", async () => {
  const d = deadline();
  const NON_MEMBER = { prefix: "const a = 1;\nlet b = ", suffix: ";\n", manual: true };
  const bad = [];
  const rows = [
    { name: "no resolver", opts: {} },
    { name: "resolver inside the deadline", opts: { resolveInjection: async () => FULL } },
    { name: "resolver past the deadline", opts: { resolveInjection: async () => { await sleep(d + 100); return FULL; } } },
  ];
  for (const row of rows) {
    const g = makeGenerate([INVENTED]);
    const svc = service(CFG, g.fn);
    try {
      const req = { ...NON_MEMBER };
      if ("resolveInjection" in row.opts) req.resolveInjection = row.opts.resolveInjection;
      const out = await within(6000, svc.complete(req), "complete");
      assert.ok(out, `a non-member site is never gated, got ${JSON.stringify(out)}`);
      assert.strictEqual(out.text, INVENTED, "the ghost is served untouched at a non-member site");
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
    svc.dispose();
  }
  if (bad.length) assert.fail(`${bad.length}/${rows.length} cases failed:\n  - ${bad.join("\n  - ")}`);
});

// ===========================================================================
// I. THE MEMO READS THE AWAITED OUTCOME [surface: "The memo must read the
//    awaited outcome"]. The memo is per document and per member site; the walk
//    refusal reads it. Written from the RACED outcome, a slow-but-productive
//    resolver is recorded as dark, which suppresses the walk refusal on the
//    next keystroke on the strength of evidence that DID arrive.
//
//    Script (the H-section idiom of blind-v18-cache-provenance): author a
//    plain-site ghost, then two member-site keystrokes. Keystroke 1's refusal
//    is live either way. Keystroke 2 is the discriminator: with the memo
//    written from the AWAITED outcome it is refused; with the memo written from
//    the raced outcome the document reads dark and the plain-site ghost is
//    served warm into a member position.
// ===========================================================================

const I_PREFIX = "const a = 1;\nlet b = ";
const I_SUFFIX = ";\n";
const I_GHOST = "tileTally(1)"; // authored at a plain statement site
const I_URI = "file:///i.ts";

const memberRead = (svc, typed, resolveInjection) =>
  svc.complete({
    prefix: I_PREFIX + typed,
    suffix: I_SUFFIX,
    manual: true,
    memberSite: true,
    memberPartial: "",
    memberReceiver: "store",
    resolveInjection,
    uri: I_URI,
  });

test("I1. a SLOW BUT PRODUCTIVE resolver is not recorded as dark: the walk refusal stays live on the following keystroke, because the evidence did in fact arrive [surface: 'It must be written from the awaited outcome instead. Otherwise this phase makes the common case - slow but productive - be recorded as dark']", async () => {
  const d = deadline();
  const g = makeGenerate([I_GHOST, "REGEN-1", "REGEN-2", "REGEN-3"]);
  const svc = service(CFG, g.fn);
  const slowNames = async () => { await sleep(d + 100); return NAMES_ONLY; };

  const seed = await within(6000, svc.complete({ prefix: I_PREFIX, suffix: I_SUFFIX, manual: true, uri: I_URI }), "seed");
  assert.ok(seed && seed.text === I_GHOST, `precondition: the plain-site ghost was authored and cached, got ${JSON.stringify(seed)}`);
  assert.strictEqual(g.calls.length, 1);

  // Keystroke 1: no prior outcome for this document, so the refusal is live and
  // the model is called. That generation consults the slow resolver, which DOES
  // produce names - late.
  const k1 = await within(6000, memberRead(svc, "tileTa", slowNames), "keystroke 1");
  assert.strictEqual(g.calls.length, 2, "precondition: with no prior outcome the first member-site keystroke is refused");
  assert.ok(!k1 || k1.fromCache === false, `precondition: keystroke 1 is not a cache hit, got ${JSON.stringify(k1)}`);

  // Keystroke 2, the discriminator. "REGEN-1" is not a continuation of the "l"
  // typed here, so keystroke 1's own entry cannot walk-serve it; the only thing
  // that could serve this warm is a wrongly-suppressed refusal reaching the
  // plain-site ghost.
  const k2 = await within(6000, memberRead(svc, "tileTal", slowNames), "keystroke 2");
  assert.strictEqual(
    g.calls.length,
    3,
    "a slow but productive resolver produced names, so the document is NOT dark and the walk refusal must still fire; serving here suppresses the refusal on the strength of evidence that did arrive"
  );
  assert.ok(!k2 || k2.fromCache === false, `keystroke 2 must not be served from the walk, got ${JSON.stringify(k2)}`);
  svc.dispose();
});

test("I2. the control for I1: a resolver that is slow AND unproductive IS dark, so the refusal is suppressed on the following keystroke - what the memo records is the awaited OUTCOME, not the lateness [surface: 'The memo's other properties are unchanged' + 'No resolution, no gate']", async () => {
  const d = deadline();
  const g = makeGenerate([I_GHOST, "REGEN-1", "REGEN-2"]);
  const svc = service(CFG, g.fn);
  const slowDark = async () => { await sleep(d + 100); return undefined; };

  const seed = await within(6000, svc.complete({ prefix: I_PREFIX, suffix: I_SUFFIX, manual: true, uri: I_URI }), "seed");
  assert.ok(seed && seed.text === I_GHOST, "precondition: the plain-site ghost was authored and cached");

  const k1 = await within(6000, memberRead(svc, "tileTa", slowDark), "keystroke 1");
  assert.strictEqual(g.calls.length, 2, "precondition: the first member-site keystroke is refused");
  assert.ok(!k1 || k1.fromCache === false, `precondition: keystroke 1 is not a cache hit, got ${JSON.stringify(k1)}`);

  const k2 = await within(6000, memberRead(svc, "tileTal", slowDark), "keystroke 2");
  assert.ok(k2, "a genuinely dark document suppresses the refusal and the walk serves");
  assert.strictEqual(k2.fromCache, true, `expected the walk to serve, got ${JSON.stringify(k2)}`);
  assert.strictEqual(k2.text, I_GHOST.slice("tileTal".length), "walk offset applied");
  assert.strictEqual(g.calls.length, 2, "no model call: the suppression is the loop-breaker and must survive this phase");
  svc.dispose();
});
