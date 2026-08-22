// Blind oracle: the bound, wired (the phase-2 wiring contract).
// Covers goal fixes 1 (the stream half), 2 (the exemption), 5 (the bound's
// share of the evidence) and 6 (the setting goes). Drives CompletionService
// headless with an injected fake generate fn, and drives generateFim against
// an in-process ndjson server so the stream abort is testable without ollama.
//
// Written against the wiring contract, the bound contract and the goal only.
// Never read src/core/ollama.ts, src/core/fimBound.ts,
// src/vscode/completionProvider.ts, nor the logic of
// src/core/completionService.ts. Phase 1's fimBound surface is treated as
// stable and is used to state expectations the wiring must reproduce.
//
// Expected RED until phase 2 lands. Do not stub anything to make it pass.
//
// Run: npm run test:unit

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v25-wiring",
  `export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";
export { generateFim } from "../src/core/ollama";
export { boundContinuation, boundReached, MAX_BOUND_LINES } from "../src/core/fimBound";\n`
);
const {
  CompletionService,
  DEFAULT_FIM_CONFIG,
  generateFim,
  boundContinuation,
  boundReached,
  MAX_BOUND_LINES,
} = mod;
test.after(cleanup);

// No `multiline` key: fix 6 removes it from FimConfig, and a config literal
// that still carried it would hide the removal from every test below.
const BASE_CONFIG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-model",
  maxTokens: 256, // deliberately not 64, so the member-site cap is visible
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 400,
  suffixChars: 200,
  cacheCapacity: 10,
};
const cfg = (o = {}) => ({ ...BASE_CONFIG, ...o });

// Content lines, the bound's own unit: leading and interior blanks never count.
const contentLines = (t) => (t ?? "").split("\n").filter((l) => l.trim() !== "");

// The raw cursor-line prefix, which is what BoundContext.currentLinePrefix is
// specified to carry (NOT scopeAnchor).
const currentLinePrefix = (prefix) => prefix.slice(prefix.lastIndexOf("\n") + 1);

// Immediate fake generate: records the params it was handed.
function makeGenerate(text) {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    return { text, ttftMs: 42, totalMs: 99 };
  };
  return { fn, calls };
}

// A fake generate that honours `stopWhen` the way the stream reader must:
// feed the raw in small pieces, consult the predicate on the ACCUMULATED text
// after each piece, and return only what was fed.
function makeStreamingGenerate(raw, chunkSize = 3) {
  const calls = [];
  const reads = [];
  const fn = async (params) => {
    calls.push(params);
    let acc = "";
    let stopped = false;
    for (let i = 0; i < raw.length; i += chunkSize) {
      acc += raw.slice(i, i + chunkSize);
      if (params.stopWhen && params.stopWhen(acc)) {
        stopped = true;
        break;
      }
    }
    reads.push({ acc, stopped });
    return { text: acc, ttftMs: 1, totalMs: 2, stopped };
  };
  return { fn, calls, reads };
}

// A resolver that answers only after `delayMs`. 0 answers on the microtask
// turn, 120 is well past the 50ms injection race.
function makeResolver(injection, delayMs = 0) {
  const state = { asked: 0 };
  return {
    state,
    fn: async () => {
      state.asked += 1;
      if (delayMs) await sleep(delayMs);
      return injection;
    },
  };
}

const served = (out) => (out && typeof out.text === "string" ? out.text : "");

// ###########################################################################
// 1. A plain site is bounded, and the end-of-terminator-line class is the one
//    a naive mechanism (`toSingleLine`, `stop: ["\n"]`) serves "" for.
//    [contract-wiring "Bars" 1; contract-bound rules 1 and 2]
// ###########################################################################

const TERMINATOR_HEAD_SITES = [
  {
    languageId: "rust",
    prefix: "fn f(xs: &[u32]) -> u32 {",
    raw: "\n    let mut n = 0;\n    for x in xs {\n        n += x;\n    }\n    n\n}",
    firstContent: "let mut n = 0;",
  },
  {
    languageId: "csharp",
    prefix: "class C {\n    public int F(int[] xs) {",
    raw: "\n        var n = 0;\n        foreach (var x in xs) {\n            n += x;\n        }\n        return n;\n    }",
    firstContent: "var n = 0;",
  },
  {
    languageId: "typescript",
    prefix: "function f(xs: number[]): number {",
    raw: "\n  let n = 0;\n  for (const x of xs) {\n    n += x;\n  }\n  return n;\n}",
    firstContent: "let n = 0;",
  },
  {
    languageId: "go",
    prefix: "func f(xs []int) int {",
    raw: "\n\tn := 0\n\tfor _, x := range xs {\n\t\tn += x\n\t}\n\treturn n\n}",
    firstContent: "n := 0",
  },
  {
    languageId: "python",
    prefix: "def f(xs):",
    raw: "\n    total = 0\n    for x in xs:\n        total += x\n    return total",
    firstContent: "total = 0",
  },
];

for (const site of TERMINATOR_HEAD_SITES) {
  test(`a long body at an end-of-terminator-line head serves exactly the first CONTENT line, not "" (${site.languageId})`, async () => {
    const g = makeGenerate(site.raw);
    const svc = new CompletionService(cfg(), g.fn);
    const out = await svc.complete({
      prefix: site.prefix,
      suffix: "\n",
      manual: true,
      languageId: site.languageId,
    });
    svc.dispose();
    const text = served(out);
    assert.notStrictEqual(text, "", "the naive bound serves the empty string here at 100 of 100 sites");
    assert.deepStrictEqual(contentLines(text), [contentLines(text)[0]], "one content line, no body");
    assert.strictEqual(contentLines(text)[0].trim(), site.firstContent);
  });

  test(`the ghost's leading blank line survives to the served text, so the ghost still positions itself on the next line (${site.languageId})`, async () => {
    const g = makeGenerate(site.raw);
    const svc = new CompletionService(cfg(), g.fn);
    const out = await svc.complete({
      prefix: site.prefix,
      suffix: "\n",
      manual: true,
      languageId: site.languageId,
    });
    svc.dispose();
    assert.ok(
      served(out).startsWith("\n"),
      `leading blank lines are PRESERVED, got ${JSON.stringify(served(out))}`
    );
  });
}

test("a chained statement is not chopped at the first line: the whole chain to its terminator is served", async () => {
  const prefix = "class C {\n    void M() {\n        var q = items";
  const raw =
    "\n            .Where(x => x.Active)\n            .OrderBy(x => x.Name)\n            .ToList();\nreturn q;";
  const g = makeGenerate(raw);
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete({ prefix, suffix: "\n    }\n}\n", manual: true, languageId: "csharp" });
  svc.dispose();
  const lines = contentLines(served(out));
  assert.strictEqual(lines.length, 3, `the statement bound keeps the chain, got ${JSON.stringify(served(out))}`);
  assert.ok(lines[2].trim().endsWith(".ToList();"), "and stops at the statement's terminator");
  assert.ok(!served(out).includes("return q;"), "nothing past the terminator");
});

test("a short construct at a fresh line is served whole and no further", async () => {
  const prefix = "func f() ([]int, error) {\n\tout, err := load()\n\t";
  const raw = "if err != nil {\n\t\treturn nil, err\n\t}\n\treturn out, nil";
  const g = makeGenerate(raw);
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete({ prefix, suffix: "\n}\n", manual: true, languageId: "go" });
  svc.dispose();
  const lines = contentLines(served(out));
  assert.strictEqual(lines.length, 3, `the construct bound serves the whole if-block, got ${JSON.stringify(served(out))}`);
  assert.ok(!served(out).includes("return out, nil"), "and nothing after the construct closes");
});

test("no plain site is ever served more content lines than the four-line cap", async () => {
  const raw = Array.from({ length: 20 }, (_, i) => `    let v${i} = ${i};`).join("\n");
  for (const languageId of ["rust", "csharp", "typescript", "go", "python"]) {
    const g = makeGenerate("\n" + raw);
    const svc = new CompletionService(cfg(), g.fn);
    const out = await svc.complete({ prefix: "fn f() {", suffix: "\n", manual: true, languageId });
    svc.dispose();
    assert.ok(
      contentLines(served(out)).length <= MAX_BOUND_LINES,
      `${languageId}: ${contentLines(served(out)).length} content lines exceeds the cap`
    );
  }
});

// ###########################################################################
// 2. stopWhen is handed to the model on plain calls only.
//    [contract-wiring 3 "stopWhen is (t) => boundReached(...) on bounded calls
//     and undefined otherwise"; Bars 5]
// ###########################################################################

test("a plain call hands the model a stop predicate", async () => {
  const g = makeGenerate("\n    let n = 0;\n    more();\n");
  const svc = new CompletionService(cfg(), g.fn);
  await svc.complete({ prefix: "fn f() {", suffix: "\n", manual: true, languageId: "rust" });
  svc.dispose();
  assert.strictEqual(g.calls.length, 1);
  assert.strictEqual(typeof g.calls[0].stopWhen, "function", "bounded calls carry the streaming predicate");
});

test("a member-site call hands the model no stop predicate", async () => {
  const g = makeGenerate("tileTally(1);");
  const svc = new CompletionService(cfg(), g.fn);
  await svc.complete({
    prefix: "let s = store.",
    suffix: ";\n",
    uri: "file:///a.rs",
    manual: true,
    languageId: "rust",
    memberSite: true,
    memberPartial: "",
    memberReceiver: "store",
  });
  svc.dispose();
  assert.strictEqual(g.calls.length, 1);
  assert.strictEqual(g.calls[0].stopWhen, undefined, "member sites are not bounded, so nothing stops their read");
});

test("a whole-block call with a resolver wired hands the model no stop predicate", async () => {
  const g = makeGenerate("\n    let a = t.w;\n    let b = t.h;\n    a * b");
  const r = makeResolver("// members here");
  const svc = new CompletionService(cfg(), g.fn);
  await svc.complete({
    prefix: "fn area(t: Tile) -> u32 {",
    suffix: "\n}\n",
    uri: "file:///a.rs",
    manual: true,
    languageId: "rust",
    wholeBlockSite: true,
    resolveInjection: r.fn,
  });
  svc.dispose();
  assert.strictEqual(g.calls.length, 1);
  assert.strictEqual(g.calls[0].stopWhen, undefined, "an exempt site is not bounded in the stream either");
});

// ###########################################################################
// 3. The stop predicate and the post-hoc bound agree: aborting the read never
//    serves a shorter ghost than the bound specifies.
//    [contract-bound "boundReached" closing property]
// ###########################################################################

const AGREEMENT_CASES = [
  {
    name: "end-of-terminator-line head, rust",
    languageId: "rust",
    prefix: "fn f(xs: &[u32]) -> u32 {",
    raw: "\n    let mut n = 0;\n    for x in xs {\n        n += x;\n    }\n    n\n}",
  },
  {
    name: "chained statement, csharp",
    languageId: "csharp",
    prefix: "class C {\n    void M() {\n        var q = items",
    raw: "\n            .Where(x => x.Active)\n            .OrderBy(x => x.Name)\n            .ToList();\nreturn q;",
  },
  {
    name: "short construct, go",
    languageId: "go",
    prefix: "func f() ([]int, error) {\n\tout, err := load()\n\t",
    raw: "if err != nil {\n\t\treturn nil, err\n\t}\n\treturn out, nil",
  },
];

for (const c of AGREEMENT_CASES) {
  test(`the ghost served from a stopped read equals the bound of the whole raw (${c.name})`, async () => {
    const g = makeStreamingGenerate(c.raw);
    const svc = new CompletionService(cfg(), g.fn);
    const out = await svc.complete({ prefix: c.prefix, suffix: "\n", manual: true, languageId: c.languageId });
    svc.dispose();
    const whole = boundContinuation(c.raw, {
      languageId: c.languageId,
      currentLinePrefix: currentLinePrefix(c.prefix),
    });
    assert.strictEqual(
      served(out),
      whole.text,
      "the stream abort and the post-hoc bound must agree, or the abort is a correctness bug"
    );
  });

  test(`the read ends before the model's output runs out (${c.name})`, async () => {
    const g = makeStreamingGenerate(c.raw);
    const svc = new CompletionService(cfg(), g.fn);
    await svc.complete({ prefix: c.prefix, suffix: "\n", manual: true, languageId: c.languageId });
    svc.dispose();
    assert.strictEqual(g.reads.length, 1);
    assert.strictEqual(g.reads[0].stopped, true, "the predicate ended the read");
    assert.ok(
      g.reads[0].acc.length < c.raw.length,
      `the read stopped short: ${g.reads[0].acc.length} of ${c.raw.length} chars`
    );
  });

  test(`the predicate the service passes is the bound's own streaming predicate (${c.name})`, async () => {
    const g = makeGenerate(c.raw);
    const svc = new CompletionService(cfg(), g.fn);
    await svc.complete({ prefix: c.prefix, suffix: "\n", manual: true, languageId: c.languageId });
    svc.dispose();
    const stopWhen = g.calls[0].stopWhen;
    assert.strictEqual(typeof stopWhen, "function");
    const ctx = { languageId: c.languageId, currentLinePrefix: currentLinePrefix(c.prefix) };
    for (let i = 1; i <= c.raw.length; i += 1) {
      const partial = c.raw.slice(0, i);
      assert.strictEqual(
        stopWhen(partial),
        boundReached(partial, ctx),
        `disagrees with boundReached at prefix ${JSON.stringify(partial)}`
      );
    }
  });
}

// ###########################################################################
// 4. The exemption keys on the SITE plus a wired resolver, never on the
//    injection having resolved.
//    [contract-wiring 2; Bars 2 and 3]
// ###########################################################################

const WB_PREFIX = "struct Tile { w: u32, h: u32 }\n\nfn area(t: Tile) -> u32 {";
const WB_RAW = "\n    let a = t.w;\n    let b = t.h;\n    let c = a + b;\n    a * b";

async function wholeBlockGhost(resolveInjection) {
  const g = makeGenerate(WB_RAW);
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete({
    prefix: WB_PREFIX,
    suffix: "\n}\n",
    uri: "file:///a.rs",
    manual: true,
    languageId: "rust",
    wholeBlockSite: true,
    ...(resolveInjection ? { resolveInjection } : {}),
  });
  svc.dispose();
  return { out, calls: g.calls };
}

test("a whole-block site with a resolver wired authors multi-line output", async () => {
  const { out } = await wholeBlockGhost(makeResolver("// members here").fn);
  assert.ok(
    contentLines(served(out)).length > 1,
    `the exemption must survive the bound, got ${JSON.stringify(served(out))}`
  );
});

test("a whole-block site keeps its multi-line output when the resolver misses the injection race", async () => {
  const r = makeResolver("// members here", 120); // well past the 50ms race
  const { out } = await wholeBlockGhost(r.fn);
  assert.strictEqual(r.state.asked, 1, "the resolver was asked");
  assert.ok(
    contentLines(served(out)).length > 1,
    `a cold language server must not silently clamp the site, got ${JSON.stringify(served(out))}`
  );
});

test("a whole-block site keeps its multi-line output when the resolver answers with nothing", async () => {
  const { out } = await wholeBlockGhost(makeResolver(undefined).fn);
  assert.ok(
    contentLines(served(out)).length > 1,
    `the exemption is decided from the request, not from the injection, got ${JSON.stringify(served(out))}`
  );
});

test("a whole-block site with no resolver wired is bounded like any other plain site", async () => {
  const { out } = await wholeBlockGhost(undefined);
  assert.strictEqual(
    contentLines(served(out)).length,
    1,
    `a site that can never inject keeps no licence to author, got ${JSON.stringify(served(out))}`
  );
});

test("a resolver at a site that is NOT a whole-block site does not buy an exemption", async () => {
  const g = makeGenerate(WB_RAW);
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete({
    prefix: WB_PREFIX,
    suffix: "\n}\n",
    uri: "file:///a.rs",
    manual: true,
    languageId: "rust",
    resolveInjection: makeResolver("// members here").fn,
  });
  svc.dispose();
  assert.strictEqual(contentLines(served(out)).length, 1, "the exemption needs the site, not just a resolver");
});

// ###########################################################################
// 5. The member-site pipeline is byte-identically unchanged.
//    [contract-wiring 2 closing paragraph; Bars 4]
// ###########################################################################

const MEMBER_REQ = {
  prefix: "let s = store.",
  suffix: ";\n",
  uri: "file:///a.rs",
  manual: true,
  languageId: "rust",
  memberSite: true,
  memberPartial: "",
  memberReceiver: "store",
};

test("a member site still caps the model at 64 tokens regardless of the configured maxTokens", async () => {
  const g = makeGenerate("tileTally(1);");
  const svc = new CompletionService(cfg({ maxTokens: 256 }), g.fn);
  await svc.complete({ ...MEMBER_REQ });
  svc.dispose();
  assert.strictEqual(g.calls[0].maxTokens, 64, "MEMBER_SITE_MAX_TOKENS is unchanged by the bound");
});

test("a member site still collapses a multi-line reply to one line", async () => {
  const g = makeGenerate("tileTally(1);\nlet other = 2;\nmore();");
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete({ ...MEMBER_REQ });
  svc.dispose();
  assert.strictEqual(
    contentLines(served(out)).length,
    1,
    `member sites force single line, and the bound must not become a second bound here, got ${JSON.stringify(served(out))}`
  );
});

test("a member site still refuses a ghost naming a member that was never resolved", async () => {
  const g = makeGenerate("insert(&x, &y)");
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete({
    ...MEMBER_REQ,
    resolveInjection: async () => ({ memberNames: ["tileTally", "rehome", "len"] }),
  });
  svc.dispose();
  assert.strictEqual(served(out), "", "the invented member is still dropped by the output gate");
});

test("a member site still serves a ghost naming a resolved member", async () => {
  const g = makeGenerate("tileTally(1)");
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete({
    ...MEMBER_REQ,
    resolveInjection: async () => ({ memberNames: ["tileTally", "rehome", "len"] }),
  });
  svc.dispose();
  assert.strictEqual(served(out), "tileTally(1)", "the gate is membership, and it still passes a real member");
});

// ###########################################################################
// 6. Every suppression says so in the channel, and records a COUNT.
//    [contract-wiring 5; goal fix 5]
// ###########################################################################

function capture() {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
}

const fimLines = (lines) => lines.filter((l) => l.startsWith("[fim]"));

test("a bounded serve reports the rule it applied and how many content lines it dropped", async () => {
  const site = TERMINATOR_HEAD_SITES[0];
  const c = capture();
  const g = makeGenerate(site.raw);
  const svc = new CompletionService(cfg(), g.fn, c.log);
  await svc.complete({ prefix: site.prefix, suffix: "\n", manual: true, languageId: site.languageId });
  svc.dispose();

  const evidence = fimLines(c.lines).filter((l) => /bound=/.test(l) && /dropped=\d+/.test(l));
  assert.strictEqual(evidence.length, 1, `one bound evidence line, got ${JSON.stringify(c.lines)}`);
  assert.ok(/kept=\d+/.test(evidence[0]), `the line reports what it kept too: ${evidence[0]}`);

  const expected = boundContinuation(site.raw, {
    languageId: site.languageId,
    currentLinePrefix: currentLinePrefix(site.prefix),
  });
  assert.strictEqual(
    Number(/dropped=(\d+)/.exec(evidence[0])[1]),
    expected.droppedLines,
    "dropped is the bound's own content-line count, which is what the next dogfood report greps for"
  );
  assert.ok(/bound=[a-z]+/.test(evidence[0]), `the rule that decided the cut is named: ${evidence[0]}`);
});

test("the bound's evidence records counts, never the text it dropped", async () => {
  const site = TERMINATOR_HEAD_SITES[0];
  const c = capture();
  const g = makeGenerate(site.raw);
  const svc = new CompletionService(cfg(), g.fn, c.log);
  await svc.complete({ prefix: site.prefix, suffix: "\n", manual: true, languageId: site.languageId });
  svc.dispose();
  for (const line of c.lines) {
    assert.ok(!line.includes("for x in xs"), `dropped text leaked into the channel: ${line}`);
    assert.ok(!line.includes("n += x"), `dropped text leaked into the channel: ${line}`);
  }
});

test("a serve cut short by the bound rather than by the model finishing says so", async () => {
  const c = capture();
  const g = makeStreamingGenerate(TERMINATOR_HEAD_SITES[0].raw);
  const svc = new CompletionService(cfg(), g.fn, c.log);
  await svc.complete({
    prefix: TERMINATOR_HEAD_SITES[0].prefix,
    suffix: "\n",
    manual: true,
    languageId: "rust",
  });
  svc.dispose();
  assert.ok(
    fimLines(c.lines).some((l) => /stopped=true/.test(l)),
    `the latency win is only visible if the stop is recorded, got ${JSON.stringify(c.lines)}`
  );
});

test("a refusal with no safe cut point is reported on the dropped channel", async () => {
  const c = capture();
  const g = makeGenerate("foo(");
  const svc = new CompletionService(cfg(), g.fn, c.log);
  const out = await svc.complete({
    prefix: "fn f() {\n    let x = ",
    suffix: "\n}\n",
    manual: true,
    languageId: "rust",
  });
  svc.dispose();
  assert.strictEqual(served(out), "", "no safe cut point means no ghost");
  assert.ok(
    c.lines.some((l) => l.startsWith("[fim] dropped:")),
    `the whole suppression class greps as one, got ${JSON.stringify(c.lines)}`
  );
});

test("an exempt whole-block serve is attributable as exempt, not as the bound failing", async () => {
  const c = capture();
  const g = makeGenerate(WB_RAW);
  const svc = new CompletionService(cfg(), g.fn, c.log);
  await svc.complete({
    prefix: WB_PREFIX,
    suffix: "\n}\n",
    uri: "file:///a.rs",
    manual: true,
    languageId: "rust",
    wholeBlockSite: true,
    resolveInjection: makeResolver("// members here").fn,
  });
  svc.dispose();
  assert.ok(
    fimLines(c.lines).some((l) => /exempt/i.test(l)),
    `a multi-line ghost at a whole-block site must be attributable, got ${JSON.stringify(c.lines)}`
  );
});

// ###########################################################################
// 7. `column80.multiline` is gone (fix 6).
//    [contract-wiring 4]
// ###########################################################################

test("the FIM config defaults no longer carry a multiline field", () => {
  assert.ok(
    !Object.prototype.hasOwnProperty.call(DEFAULT_FIM_CONFIG, "multiline"),
    `a boolean that no longer does what it says is worse than no boolean, got ${JSON.stringify(DEFAULT_FIM_CONFIG)}`
  );
  assert.strictEqual(DEFAULT_FIM_CONFIG.multiline, undefined);
});

test("a config with no multiline field drives the service", async () => {
  const g = makeGenerate("\n    let n = 0;\n    more();\n");
  const svc = new CompletionService({ ...DEFAULT_FIM_CONFIG, debounceMs: 0 }, g.fn);
  const out = await svc.complete({ prefix: "fn f() {", suffix: "\n", manual: true, languageId: "rust" });
  svc.dispose();
  assert.strictEqual(g.calls.length, 1, "the model was called");
  assert.notStrictEqual(served(out), "", "and a ghost was served");
});

// ###########################################################################
// 8. The bound dispatches on the request's languageId.
//    [contract-wiring 2 "languageId?: string"; contract-bound rule 3 table]
//
//    NOTE, and it is a judgement call: for brace-balanced raws the construct
//    rule and the statement rule cut at the same place, so "bounds
//    differently" is asserted twice - once on the RULE the evidence line
//    names (go takes `if err != nil` as a construct, typescript does not have
//    that opener), and once on served length using `try:`, where the tables
//    genuinely diverge (python has `try`, go does not).
// ###########################################################################

const GO_CONSTRUCT_PREFIX = "func f() ([]int, error) {\n\tout, err := load()\n\t";
const GO_CONSTRUCT_RAW = "if err != nil {\n\t\treturn nil, err\n\t}\n\treturn out, nil";

async function ruleFor(languageId, prefix, raw) {
  const c = capture();
  const g = makeGenerate(raw);
  const svc = new CompletionService(cfg(), g.fn, c.log);
  const out = await svc.complete({ prefix, suffix: "\n}\n", manual: true, languageId });
  svc.dispose();
  const line = fimLines(c.lines).find((l) => /bound=/.test(l));
  assert.ok(line, `${languageId}: no bound evidence line in ${JSON.stringify(c.lines)}`);
  return { rule: /bound=([a-z]+)/.exec(line)[1], text: served(out) };
}

test("go takes `if err != nil {` as a construct", async () => {
  const go = await ruleFor("go", GO_CONSTRUCT_PREFIX, GO_CONSTRUCT_RAW);
  assert.strictEqual(go.rule, "construct", "`if err != nil` is in go's opener table");
});

test("a language without that opener does not take the same text as a construct", async () => {
  const ts = await ruleFor("typescript", GO_CONSTRUCT_PREFIX, GO_CONSTRUCT_RAW);
  assert.notStrictEqual(ts.rule, "construct", "typescript's table is switch/try, so this is a statement");
});

test("the same raw at the same site is bounded to different lengths in python and go", async () => {
  const prefix = "def f():\n    ";
  const raw = "try:\n        risky()\n    except E:\n        handle()\n    return 1";

  const runFor = async (languageId) => {
    const g = makeGenerate(raw);
    const svc = new CompletionService(cfg(), g.fn);
    const out = await svc.complete({ prefix, suffix: "\n", manual: true, languageId });
    svc.dispose();
    return contentLines(served(out)).length;
  };

  const py = await runFor("python");
  const go = await runFor("go");
  assert.ok(py >= 2, `python takes \`try\` as a construct opener, got ${py} content lines`);
  assert.ok(go < py, `go has no \`try\` opener, so it bounds shorter: python ${py}, go ${go}`);
});

test("a request with no languageId still serves a bounded ghost under the C-family rules", async () => {
  const g = makeGenerate("\n    let n = 0;\n    for (;;) {}\n    return n;\n");
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete({ prefix: "function f() {", suffix: "\n", manual: true });
  svc.dispose();
  assert.strictEqual(contentLines(served(out)).length, 1, "an unmapped language gets the C-family rules");
});

// ###########################################################################
// The stream abort itself, against an in-process ndjson server.
// [contract-wiring 1]
//
// Hermetic: http.createServer on 127.0.0.1, so it runs under SKIP_LIVE too.
// ###########################################################################

const OLLAMA_PARAMS = {
  model: "qwen2.5-coder:1.5b-base",
  prefix: "fn f() {",
  suffix: "\n}\n",
  maxTokens: 64,
  temperature: 0.01,
};

// Streams one JSON object per chunk, `delayMs` apart, so each chunk lands as
// its own read on the client. Records what the server managed to write and
// whether the client went away before the stream finished.
function startNdjsonServer(chunks, { delayMs = 10, finish = true } = {}) {
  const state = { written: 0, finished: false, clientGone: false, requests: [] };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      state.requests.push({ url: req.url, body: raw ? JSON.parse(raw) : undefined });
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.on("close", () => {
        if (!state.finished) state.clientGone = true;
      });
      let i = 0;
      const tick = () => {
        if (res.destroyed || res.writableEnded) return;
        if (i < chunks.length) {
          res.write(JSON.stringify({ response: chunks[i] }) + "\n");
          i += 1;
          state.written = i;
          setTimeout(tick, delayMs);
          return;
        }
        if (finish) {
          state.finished = true;
          res.write(JSON.stringify({ response: "", done: true }) + "\n");
          res.end();
        }
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

// A non-empty chunk in the middle is empty on purpose: the predicate is
// consulted only after a non-empty response chunk.
const STREAM_CHUNKS = ["let ", "x", "", " = 1;", "\n", "let y = 2;", "\n", "let z = 3;\n"];
const stopAtFirstNewline = (recorded) => (t) => {
  recorded.push(t);
  return /\S/.test(t) && t.includes("\n");
};

test("the stop predicate sees the accumulated text after each non-empty chunk", async (t) => {
  const srv = await startNdjsonServer(STREAM_CHUNKS);
  t.after(srv.close);
  const recorded = [];
  await generateFim({
    ...OLLAMA_PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    stopWhen: stopAtFirstNewline(recorded),
  });

  assert.ok(recorded.length >= 2, `consulted per chunk, not once at the end: ${JSON.stringify(recorded)}`);
  const whole = STREAM_CHUNKS.join("");
  for (let i = 0; i < recorded.length; i += 1) {
    assert.ok(whole.startsWith(recorded[i]), `call ${i} is not a prefix of the stream: ${JSON.stringify(recorded[i])}`);
    if (i > 0) {
      assert.ok(
        recorded[i].length > recorded[i - 1].length,
        `accumulated text must grow strictly; an empty chunk must not re-consult: ${JSON.stringify(recorded)}`
      );
    }
  }
});

test("the text returned is exactly what was read up to the stop", async (t) => {
  const srv = await startNdjsonServer(STREAM_CHUNKS);
  t.after(srv.close);
  const recorded = [];
  const out = await generateFim({
    ...OLLAMA_PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    stopWhen: stopAtFirstNewline(recorded),
  });
  assert.strictEqual(out.text, recorded[recorded.length - 1], "the text read so far IS the result");
  assert.strictEqual(out.text, "let x = 1;\n");
  assert.ok(!out.text.includes("let y"), "nothing generated after the stop is served");
});

test("a stopped read resolves rather than rejecting, and says it was stopped", async (t) => {
  const srv = await startNdjsonServer(STREAM_CHUNKS);
  t.after(srv.close);
  const out = await generateFim({
    ...OLLAMA_PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    stopWhen: stopAtFirstNewline([]),
  });
  assert.strictEqual(out.stopped, true, "a clean end, not an abort");
  assert.ok(typeof out.ttftMs === "number" && typeof out.totalMs === "number", "timings still reported");
});

test("stopping the read releases the connection so the server stops generating", async (t) => {
  const srv = await startNdjsonServer(STREAM_CHUNKS, { delayMs: 20 });
  t.after(srv.close);
  await generateFim({
    ...OLLAMA_PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    stopWhen: stopAtFirstNewline([]),
  });
  for (let i = 0; i < 100 && !srv.state.clientGone; i += 1) await sleep(10);
  assert.strictEqual(srv.state.clientGone, true, "the release IS the latency win; without it ollama keeps generating");
  assert.ok(
    srv.state.written < STREAM_CHUNKS.length,
    `the server never got to write the whole stream, wrote ${srv.state.written} of ${STREAM_CHUNKS.length}`
  );
});

test("the bound is never expressed as an ollama stop list", async (t) => {
  const srv = await startNdjsonServer(STREAM_CHUNKS);
  t.after(srv.close);
  await generateFim({
    ...OLLAMA_PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
    stopWhen: stopAtFirstNewline([]),
  });
  const { body } = srv.state.requests[0];
  assert.strictEqual(body.options.stop, undefined, "a user stop list REPLACES qwen's own FIM specials");
  assert.deepStrictEqual(body.options, { num_predict: 64, temperature: 0.01 });
});

test("without a stop predicate the read is unchanged: the whole stream, no stop, no early release", async (t) => {
  const srv = await startNdjsonServer(STREAM_CHUNKS, { delayMs: 2 });
  t.after(srv.close);
  const out = await generateFim({
    ...OLLAMA_PARAMS,
    apiBase: srv.apiBase,
    signal: new AbortController().signal,
  });
  assert.strictEqual(out.text, STREAM_CHUNKS.join(""), "every chunk is read");
  assert.ok(!out.stopped, `stopped is falsy when the model finished, got ${JSON.stringify(out.stopped)}`);
  assert.strictEqual(srv.state.finished, true, "the server reached its done line");
  assert.strictEqual(srv.state.clientGone, false, "no early disconnect");
});

test("a real abort still rejects, with or without a stop predicate", async (t) => {
  const srv = await startNdjsonServer(["hel"], { delayMs: 10, finish: false });
  t.after(srv.close);
  const ac = new AbortController();
  const p = generateFim({
    ...OLLAMA_PARAMS,
    apiBase: srv.apiBase,
    signal: ac.signal,
    stopWhen: () => false,
  });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, (err) => /abort/i.test(String(err.name) + String(err.message)));
});
