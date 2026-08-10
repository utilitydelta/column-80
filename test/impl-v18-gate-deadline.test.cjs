// Implementer oracle: the edges of the gate/block deadline decoupling that the
// blind contract set cannot see from outside - the abort window the late wait
// opens, where the wait's cost is reported, and the race-outcome reporting that
// replaced a wall-clock re-read. Complements test/blind-v18-gate-deadline.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v18-gate-deadline",
  `export { CompletionService, INJECTION_DEADLINE_MS, GATE_DEADLINE_MS } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`
);
const { CompletionService, INJECTION_DEADLINE_MS, GATE_DEADLINE_MS, DEFAULT_FIM_CONFIG } = mod;
test.after(cleanup);

const MEMBERS = ["enroll_tile", "len", "iter"];
// The live capture's own hallucination: an invented method and two invented
// variables, served ungated at f617cfa.
const INVENTED = "insert(&x, &y);";
const cfg = (o = {}) => ({ ...DEFAULT_FIM_CONFIG, debounceMs: 0, ...o });

// A member-site request. `resolve` is the resolver; `genMs` how long the model
// takes. Returns what was served plus the channel.
function member({ resolve, genMs = 100, text = INVENTED }) {
  const lines = [];
  const svc = new CompletionService(
    cfg(),
    async () => {
      await sleep(genMs);
      return { text, ttftMs: 1, totalMs: genMs };
    },
    (l) => lines.push(l)
  );
  const request = {
    prefix: "let mut s = Stripe::new();\ns.",
    suffix: "\n",
    uri: "file:///a.rs",
    memberSite: true,
    memberPartial: "",
    memberReceiver: "s",
    resolveInjection: resolve,
  };
  return { svc, request, lines };
}

test("the deadlines are separate constants and the gate's is the larger one", () => {
  assert.strictEqual(INJECTION_DEADLINE_MS, 50, "the block's deadline must not move; tuning it is banned");
  assert.ok(GATE_DEADLINE_MS > INJECTION_DEADLINE_MS, "the gate's bound is its own and larger");
  assert.ok(GATE_DEADLINE_MS < 1000, "and stays under a second");
});

test("an abort inside the gate's wait serves nothing, and ends the wait rather than riding it out", async () => {
  // The window this phase created. Round 1 proved that without an abort check
  // the call returned the ungated ghost, and without a cancellable wait it sat
  // for the full bound first. A resolver that never answers isolates both: only
  // the abort can end this wait.
  const { svc, request } = member({ resolve: () => new Promise(() => {}) });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 150);
  const started = Date.now();
  const out = await svc.complete(request, ac.signal);
  const elapsed = Date.now() - started;
  svc.dispose();
  assert.strictEqual(out, undefined, "an aborted call serves nothing, gated or not");
  // Generous: the abort lands at 150ms and the bound is GATE_DEADLINE_MS past
  // generation. Anything below that bound proves the abort ended the wait.
  assert.ok(
    elapsed < 150 + GATE_DEADLINE_MS,
    `the abort must end the wait, not be noticed after it (elapsed ${elapsed}ms)`
  );
});

test("the control: with no abort the same hung resolver serves the ungated ghost", async () => {
  // Without this the test above passes against a service that suppresses
  // everything, and proves nothing about the abort.
  const { svc, request } = member({ resolve: () => new Promise(() => {}) });
  const out = await svc.complete(request);
  svc.dispose();
  assert.strictEqual(out?.text, INVENTED, "no resolution is no gate, so the ghost is served");
});

test("the gate's wait is reported, and is kept out of time-to-first-token", async () => {
  // ttft means what it says. The gate's wait begins after generation returns, so
  // folding it in would report a first token arriving later than it did - but it
  // is real wall clock inside complete() and has to appear somewhere.
  const { svc, request, lines } = member({
    resolve: async () => {
      await sleep(INJECTION_DEADLINE_MS + 120);
      return { memberNames: MEMBERS };
    },
    genMs: 10,
    text: "enroll_tile(t);",
  });
  const out = await svc.complete(request);
  svc.dispose();
  assert.strictEqual(out?.text, "enroll_tile(t);", "precondition: a real member survives the late gate");
  assert.ok(out.ttftMs < 100, `ttft must not absorb the post-generation wait, got ${out.ttftMs}ms`);
  assert.ok(out.totalMs >= 100, `but the total must include it, got ${out.totalMs}ms`);
  const line = lines.find((l) => l.startsWith("[fim] ttft="));
  assert.match(line, /gateWait=\d+ms/, "and the channel names it, or it hides on slow hardware");
});

test("no gate wait, no gateWait field: a resolver that beat the block's deadline costs nothing extra", async () => {
  const { svc, request, lines } = member({
    resolve: async () => ({ block: "// cands\n", memberNames: MEMBERS }),
    text: "enroll_tile(t);",
  });
  await svc.complete(request);
  svc.dispose();
  const line = lines.find((l) => l.startsWith("[fim] ttft="));
  assert.doesNotMatch(line, /gateWait=/, "a wait that did not happen must not be reported");
});

// The skip line is gated on which side of the race won, not on a re-read of the
// wall clock. A resolver answering `undefined` in microseconds has not been
// skipped for slowness, and an elapsed time rounding to just under the deadline
// does not mean the deadline was met.
const SKIP_LINE = [
  {
    why: "a resolver that answers undefined immediately was not skipped for being slow",
    resolve: async () => undefined,
    skipped: false,
  },
  {
    why: "a resolver that misses the deadline was",
    resolve: async () => {
      await sleep(INJECTION_DEADLINE_MS + 120);
      return { memberNames: MEMBERS };
    },
    skipped: true,
  },
  {
    why: "and a resolver that throws immediately was not",
    resolve: async () => {
      throw new Error("cold server");
    },
    skipped: false,
  },
];

for (const c of SKIP_LINE) {
  test(`the injection-skipped line reads the race outcome: ${c.why}`, async () => {
    const { svc, request, lines } = member({ resolve: c.resolve, genMs: 5 });
    await svc.complete(request);
    svc.dispose();
    const skipped = lines.some((l) => l.includes("injection skipped"));
    assert.strictEqual(skipped, c.skipped, lines.join("\n"));
  });
}

test("the skipped line does not flake: 40 runs of a resolver sitting just past the deadline", async () => {
  // This was a real flake. The condition used to re-read the wall clock, so an
  // elapsed time landing on 49 suppressed the line for an event that did miss.
  let missing = 0;
  for (let i = 0; i < 40; i++) {
    const { svc, request, lines } = member({
      resolve: async () => {
        await sleep(INJECTION_DEADLINE_MS + 5);
        return { memberNames: MEMBERS };
      },
      genMs: 1,
      text: "enroll_tile(t);",
    });
    await svc.complete(request);
    svc.dispose();
    if (!lines.some((l) => l.includes("injection skipped"))) {
      missing++;
    }
  }
  assert.strictEqual(missing, 0, `the line must fire on every miss, missed ${missing} of 40`);
});

test("a late gate polices the alternates too, not just the primary", async () => {
  // The manual fan-out is where an invented member would otherwise survive in
  // the cycle list even after the primary was dropped.
  const texts = [INVENTED, "vaporize(q);", "enroll_tile(t);"];
  let i = 0;
  const svc = new CompletionService(cfg(), async () => {
    await sleep(60);
    return { text: texts[Math.min(i++, texts.length - 1)], ttftMs: 1, totalMs: 60 };
  });
  const out = await svc.complete({
    prefix: "let mut s = Stripe::new();\ns.",
    suffix: "\n",
    manual: true,
    alternatives: 3,
    memberSite: true,
    memberPartial: "",
    memberReceiver: "s",
    resolveInjection: async () => {
      await sleep(INJECTION_DEADLINE_MS + 10);
      return { memberNames: MEMBERS };
    },
  });
  svc.dispose();
  assert.strictEqual(out?.text, "enroll_tile(t);", "the one real member is promoted");
  for (const alt of out.alternates ?? []) {
    assert.ok(MEMBERS.some((m) => alt.startsWith(m)), `an invented alternate survived the late gate: ${alt}`);
  }
});
