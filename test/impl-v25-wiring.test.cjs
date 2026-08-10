// Implementer oracle for phase 2 of v25: the seams that carry the bound to a
// keystroke, which the black-box contract cannot see from the outside - where
// the bound sits inside the postprocess pipeline, what the seal is worth after
// a filter has reshaped the text, the exact shape of the evidence the service
// reads, and the stream loop's behaviour around the stopping chunk.
// Complements test/blind-v25-wiring.test.cjs.
//
// Run: SKIP_LIVE=1 node --test test/impl-v25-wiring.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v25-wiring",
  `export { postprocess, postprocessBounded } from "../src/core/postprocess";
export { CompletionService } from "../src/core/completionService";
export { createSuppressionLedger } from "../src/core/suppressionLedger";
export { generateFim } from "../src/core/ollama";\n`
);
const { postprocess, postprocessBounded, CompletionService, createSuppressionLedger, generateFim } = mod;
test.after(cleanup);

const CFG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-model",
  maxTokens: 256,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 400,
  suffixChars: 200,
  cacheCapacity: 10,
};

// ===========================================================================
// A. WHERE THE BOUND SITS IN THE PIPELINE. Two neighbours decide this: the
// echo strip above it and the seal below every filter.
// ===========================================================================

const ECHO_BLOCK = "// available here (use one of these exact names):\n// toggle(): void";

test("the echo strip runs BEFORE the bound, so an echoed line is never a line the bound reports dropping", () => {
  const raw = "\n    let a = bar();\n    // toggle(): void\n    let b = 2;";
  const r = postprocessBounded(raw, {
    suffix: "",
    currentLinePrefix: "",
    multiline: true,
    injectedBlock: ECHO_BLOCK,
    bound: { languageId: "rust", currentLinePrefix: "fn f() {" },
  });
  assert.strictEqual(r.text, "\n    let a = bar();");
  // The count is the discriminator. Run the bound first and it sees four raw
  // lines and reports dropping two; run the strip first and there is only one
  // content line left to bound, so nothing was dropped by the BOUND.
  assert.strictEqual(r.bound.droppedLines, 0, "the echo was gone before the bound counted anything");
});

test("the bound replaces the single-line collapse rather than stacking on it: the leading blank line survives", () => {
  const ctx = {
    suffix: "",
    currentLinePrefix: "",
    multiline: true,
    bound: { languageId: "rust", currentLinePrefix: "fn f() {" },
  };
  const r = postprocessBounded("\n    let n = 0;\n    n += 1;", ctx);
  assert.strictEqual(r.text, "\n    let n = 0;");
  // What toSingleLine would have done to the same text, and the reason it is
  // not the bound's weaker sibling.
  assert.strictEqual(postprocess("\n    let n = 0;\n    n += 1;", { ...ctx, bound: undefined, multiline: false }), "");
});

test("the seal runs after the scope filter: a filter that shortens into a dangling opener refuses rather than serves it", () => {
  // The scope filter cuts at the dedent on line 1, which lands the text on
  // `run(` - the mid-expression cut the compile spike measured at 40 tsc
  // errors becoming 92.
  const raw = "run(\n  a,\n        b,\n    );";
  const ctx = { suffix: "", currentLinePrefix: "        ", multiline: true };
  assert.strictEqual(postprocess(raw, ctx), "run(", "without the bound the pipeline serves the dangling cut");
  const r = postprocessBounded(raw, {
    ...ctx,
    bound: { languageId: "typescript", currentLinePrefix: "        " },
  });
  assert.strictEqual(r.text, "", "no safe line boundary survives the filter, so nothing is served");
});

test("the seal re-balances what a filter cut left open, and the reported appended is the seal's", () => {
  const raw = "run(x\n  a\n        b";
  const r = postprocessBounded(raw, {
    suffix: "",
    currentLinePrefix: "        ",
    multiline: true,
    bound: { languageId: "typescript", currentLinePrefix: "        " },
  });
  assert.strictEqual(r.text, "run(x)", "the scope filter cut to `run(x`; the seal closed the call");
  assert.strictEqual(r.bound.appended, ")");
  assert.strictEqual(r.bound.keptLines, 1);
});

test("keptLines counts the FINAL text, and blank lines are not content", () => {
  const r = postprocessBounded("\n\n  x = 1;\n  y = 2;", {
    suffix: "",
    currentLinePrefix: "",
    multiline: true,
    bound: { languageId: "typescript", currentLinePrefix: "if (a) {" },
  });
  assert.strictEqual(r.text, "\n\n  x = 1;");
  assert.strictEqual(r.bound.keptLines, 1, "two leading blanks position the ghost; they are not content");
});

test("no bound in the context means no bound in the result, and the string face is unchanged", () => {
  const ctx = { suffix: "", currentLinePrefix: "", multiline: true };
  const raw = "a();\nb();\nc();";
  const r = postprocessBounded(raw, ctx);
  assert.strictEqual(r.bound, undefined, "nothing to report when nothing was bounded");
  assert.strictEqual(r.text, raw);
  assert.strictEqual(postprocess(raw, ctx), r.text, "postprocess is the string face of the same pipeline");
});

test("a refusal reports refusedUnsafe with the lines it dropped, and serves nothing", () => {
  const r = postprocessBounded("foo(", {
    suffix: "",
    currentLinePrefix: "",
    multiline: true,
    bound: { languageId: "typescript", currentLinePrefix: "  const v = " },
  });
  assert.strictEqual(r.text, "");
  assert.strictEqual(r.bound.refusedUnsafe, true);
  assert.strictEqual(r.bound.rule, "empty");
});

// ===========================================================================
// B. THE SERVICE SEAM. What the request alone decides, and what reaches the
// generate call.
// ===========================================================================

function capture(text) {
  const params = [];
  const lines = [];
  const fn = async (p) => {
    params.push(p);
    return { text, ttftMs: 1, totalMs: 2 };
  };
  return { fn, params, lines, log: (l) => lines.push(l) };
}

test("stopWhen is an ABSENT key at a member site, not an undefined one", async () => {
  const g = capture("bits(1)");
  const svc = new CompletionService(CFG, g.fn);
  await svc.complete({ prefix: "let x = foo.", suffix: "", manual: true, memberSite: true, languageId: "rust" });
  svc.dispose();
  assert.strictEqual("stopWhen" in g.params[0], false, "an exempt call's params are the shape they always were");
});

test("stopWhen is an absent key at an exempt whole-block site too", async () => {
  const g = capture("\n    let a = 1;\n    let b = 2;");
  const svc = new CompletionService(CFG, g.fn);
  await svc.complete({
    prefix: "fn area(t: Tile) -> u32 {",
    suffix: "\n}",
    manual: true,
    wholeBlockSite: true,
    languageId: "rust",
    resolveInjection: async () => "// types in play:\n// Tile { w: u32 }",
  });
  svc.dispose();
  assert.strictEqual("stopWhen" in g.params[0], false);
});

test("the member-site single-line collapse survives the removal of the multiline setting", async () => {
  const g = capture("num_bits(1024)\n}\n\nfn fake() {}");
  // A stray `multiline` on the config object must govern nothing: the flag is
  // computed from the request now.
  const svc = new CompletionService({ ...CFG, multiline: true }, g.fn);
  const out = await svc.complete({ prefix: "let f = B::with", suffix: "\n}", manual: true, memberSite: true });
  svc.dispose();
  assert.strictEqual(out.text, "num_bits(1024)");
  assert.ok(g.params[0].maxTokens <= 64, "and the 64-token cap with it");
});

test("the bound reads the RAW cursor line, not the indentation scopeAnchor substitutes on a blank one", async () => {
  // python, cursor on a blank indented line inside a def. The construct's own
  // level is the CURSOR's column (4), so `    return None` at column 4 closes
  // it after three lines. scopeAnchor would hand the bound "" instead, the
  // dedent would never be seen, and the cap would serve a fourth line.
  const g = capture("match cmd:\n        case 1:\n            a = 1\n    return None");
  const svc = new CompletionService(CFG, g.fn);
  const out = await svc.complete({
    prefix: "def f(cmd):\n    ",
    suffix: "\n",
    manual: true,
    languageId: "python",
  });
  svc.dispose();
  assert.strictEqual(out.text, "match cmd:\n        case 1:\n            a = 1");
});

test("the evidence line carries the rule, the counts and nothing the model wrote", async () => {
  const g = capture("\n    let n = 0;\n    let m = 1;\n    let o = 2;");
  const svc = new CompletionService(CFG, g.fn, g.log);
  await svc.complete({ prefix: "fn f() {", suffix: "\n}", manual: true, languageId: "rust" });
  svc.dispose();
  const line = g.lines.find((l) => l.includes("bound="));
  assert.match(line, /bound=line kept=1 dropped=2 appended=0/);
  assert.ok(!line.includes("let m"), "a dropped line is a count, never the text");
});

test("a stopped read says so on the same line, and an unstopped one does not", async () => {
  const stopped = { text: "\n    let n = 0;", ttftMs: 1, totalMs: 2, stopped: true };
  const runOut = { text: "\n    let n = 0;", ttftMs: 1, totalMs: 2 };
  const lineFor = async (result) => {
    const lines = [];
    const svc = new CompletionService(CFG, async () => result, (l) => lines.push(l));
    await svc.complete({ prefix: "fn f() {", suffix: "\n}", manual: true, languageId: "rust" });
    svc.dispose();
    return lines.find((l) => l.includes("bound="));
  };
  assert.match(await lineFor(stopped), /stopped=true/);
  assert.ok(!(await lineFor(runOut)).includes("stopped"), "a read that ran out is not a read the bound cut");
});

// ===========================================================================
// C. THE STREAM LOOP around the stopping chunk. The blind set pins the
// contract; these are the branches.
// ===========================================================================

function startNdjson(lines, { batch = false } = {}) {
  const state = { requests: [] };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      state.requests.push(raw ? JSON.parse(raw) : undefined);
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      if (batch) {
        // Every line in ONE write, so the client's read carries them all and
        // the stop has to end the loop over a batch it already holds.
        res.write(lines.map((l) => JSON.stringify(l) + "\n").join(""));
        res.end();
        return;
      }
      let i = 0;
      const tick = () => {
        if (res.destroyed || res.writableEnded) return;
        if (i >= lines.length) {
          res.end();
          return;
        }
        res.write(JSON.stringify(lines[i]) + "\n");
        i += 1;
        setTimeout(tick, 5);
      };
      tick();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        apiBase: `http://127.0.0.1:${server.address().port}`,
        state,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const PARAMS = { model: "m", prefix: "p", suffix: "s", maxTokens: 64, temperature: 0.01 };

test("a stop inside a batched read abandons the rest of that batch", async (t) => {
  const srv = await startNdjson(
    [{ response: "a();\n" }, { response: "b();\n" }, { response: "c();\n" }, { response: "", done: true }],
    { batch: true }
  );
  t.after(srv.close);
  const r = await generateFim({
    ...PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    stopWhen: (t2) => t2.includes("\n"),
  });
  assert.strictEqual(r.text, "a();\n", "siblings already in the buffer are not appended after the stop");
  assert.strictEqual(r.stopped, true);
});

test("the predicate is not consulted on an empty chunk", async (t) => {
  const srv = await startNdjson([{ response: "" }, { response: "x" }, { response: "", done: true }]);
  t.after(srv.close);
  const seen = [];
  const r = await generateFim({
    ...PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    stopWhen: (t2) => {
      seen.push(t2);
      return false;
    },
  });
  assert.deepStrictEqual(seen, ["x"], "one consult, for the one non-empty chunk");
  assert.strictEqual(r.text, "x");
  assert.strictEqual("stopped" in r, false, "a read that finished is not a read that was stopped");
});

test("a model that finishes on the same line it delivers is never reported as cut short", async (t) => {
  const srv = await startNdjson([{ response: "a();\n", done: true }]);
  t.after(srv.close);
  const r = await generateFim({
    ...PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    stopWhen: () => true,
  });
  assert.strictEqual(r.text, "a();\n");
  assert.strictEqual("stopped" in r, false, "the model got there first; `stopped` would misattribute the win");
});

test("totalMs is the clock at the stop, not at a done line that never came", async (t) => {
  const srv = await startNdjson([
    { response: "a();\n" },
    { response: "b();\n" },
    { response: "c();\n" },
    { response: "", done: true },
  ]);
  t.after(srv.close);
  const started = Date.now();
  const r = await generateFim({
    ...PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    stopWhen: (t2) => t2.includes("\n"),
  });
  const waited = Date.now() - started;
  assert.strictEqual(r.text, "a();\n");
  assert.ok(r.totalMs <= waited + 1, `totalMs (${r.totalMs}) is wall clock inside the call (${waited}ms)`);
  assert.ok(r.ttftMs <= r.totalMs, "ttft can never land after total");
});

// ===========================================================================
// FINAL REVIEW FINDING 5. The extras launch BEFORE the primary is awaited, so
// a request whose primary the safety rule refuses can promote an alternate and
// serve. Everything the channel said about that keystroke came off the primary:
// `bound=empty dropped=1` beside a served 19-character ghost, and a
// `bound-unsafe` counted for a keystroke the human got a completion from.
// `kept=` was already recomputed from the served text for this class of reason;
// the other three fields were not.
// ===========================================================================

// The scripted generate is consumed in CALL order, and the service launches the
// extras before the primary - so with three entries the LAST is the primary's.
function fanOut(texts, ledger) {
  const logs = [];
  let i = 0;
  const svc = new CompletionService(
    { ...CFG, cacheCapacity: 0 },
    async () => ({ text: texts[Math.min(i++, texts.length - 1)], ttftMs: 1, totalMs: 2 }),
    (l) => logs.push(l),
    ledger
  );
  return { svc, logs };
}

const REFUSED_PRIMARY = ["let x = compute(a);\n", "let y = foo(\n", "let z = bar(\n"];
const FAN_REQUEST = { prefix: "fn f() {\n    ", suffix: "", languageId: "rust", manual: true, alternatives: 3 };

test("finding 5: the evidence line describes the generation that was SERVED", async () => {
  const { svc, logs } = fanOut(REFUSED_PRIMARY);
  const r = await svc.complete(FAN_REQUEST);
  svc.dispose();
  assert.strictEqual(r.text, "let x = compute(a);", "an alternate was promoted");
  const line = logs.find((l) => l.startsWith("[fim] ttft="));
  assert.ok(/bound=line/.test(line), `the promoted alternate's own rule: ${line}`);
  assert.ok(!/bound=empty/.test(line), `the primary's rule on a served ghost: ${line}`);
  assert.ok(/ dropped=0 appended=0/.test(line), `and its own counts: ${line}`);
});

test("finding 5: a refused candidate the request served past is on the record, uncounted", async () => {
  const ledger = createSuppressionLedger();
  const { svc, logs } = fanOut(REFUSED_PRIMARY, ledger);
  await svc.complete(FAN_REQUEST);
  svc.dispose();
  // Two candidates dangle on an open paren: the primary and one alternate. The
  // alternate's refusal used to be silent, because the alternates ran through
  // `postprocess`, which discards `BoundOutcome`.
  const refusals = logs.filter((l) => l.includes("no safe cut point"));
  assert.strictEqual(refusals.length, 2, `got ${JSON.stringify(logs)}`);
  assert.ok(refusals.every((l) => l.startsWith("[fim] refused:")), `dropped: means the human got nothing: ${refusals}`);
  assert.strictEqual(
    ledger.snapshot()["bound-unsafe"],
    0,
    "a keystroke that served a ghost lost nothing to the safety rule"
  );
});

test("finding 5: when nothing is served the count comes back, once for the request", async () => {
  const ledger = createSuppressionLedger();
  const { svc, logs } = fanOut(["let y = foo(\n", "let z = bar(\n", "let w = baz(\n"], ledger);
  const r = await svc.complete(FAN_REQUEST);
  svc.dispose();
  assert.strictEqual(r, undefined, "every candidate dangled");
  const refusals = logs.filter((l) => l.includes("no safe cut point"));
  assert.strictEqual(refusals.length, 3, `one line per candidate: ${JSON.stringify(logs)}`);
  assert.ok(refusals.every((l) => l.startsWith("[fim] dropped:")));
  // ONE count, the discipline the floor already takes: a fan-out asking for
  // three candidates and refusing all three is one completion the human did not
  // get, and counting per candidate would price it as three.
  assert.strictEqual(ledger.snapshot()["bound-unsafe"], 1);
});

test("finding 5: the single-shot path is unchanged - a refused primary is a dropped keystroke", async () => {
  const ledger = createSuppressionLedger();
  const { svc, logs } = fanOut(["let z = bar(\n"], ledger);
  const r = await svc.complete({ prefix: "fn f() {\n    ", suffix: "", languageId: "rust" });
  svc.dispose();
  assert.strictEqual(r, undefined);
  assert.strictEqual(logs.filter((l) => l.startsWith("[fim] dropped: no safe cut point")).length, 1);
  assert.strictEqual(ledger.snapshot()["bound-unsafe"], 1);
});
