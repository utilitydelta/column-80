// Blind oracle: the minimum-length floor and the suppression ledger
// (the phase-4 floor contract). Covers goal fix 8 and the counting
// half of goal fix 5.
//
// Written against the floor contract, the fix 5 / fix 8 / Bars sections of the
// goal, and the JetBrains full-line-completion notes only.
// Never read src/core/fimBound.ts, src/core/fimComment.ts, src/vscode/*, nor
// the logic of src/core/config.ts or src/core/completionService.ts - only their
// exported type surfaces, so the requests and configs below are well formed.
//
// Harness copied from test/blind-v25-wiring.test.cjs: CompletionService driven
// headless with an injected fake generate fn and a captured log.
//
// Expected RED until phase 4 lands. Do not stub anything to make it pass.
//
// Run: npm run test:unit

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v25-floor",
  `export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`
);
const { CompletionService, DEFAULT_FIM_CONFIG } = mod;
test.after(cleanup);

// The floor's own numbers are written out rather than spread from
// DEFAULT_FIM_CONFIG: a test that inherited the default could not tell a
// shipped 8 from a shipped 3.
const BASE_CONFIG = {
  apiBase: "http://127.0.0.1:1", // never reached: generate is injected
  model: "fake-model",
  maxTokens: 256,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 400,
  suffixChars: 200,
  cacheCapacity: 10,
  minGhostChars: 8,
  minGhostAlnum: 2,
};
const cfg = (o = {}) => ({ ...BASE_CONFIG, ...o });

const served = (out) => (out && typeof out.text === "string" ? out.text : "");
const alnum = (s) => (s.match(/[0-9A-Za-z]/g) || []).length;

// Immediate fake generate: records the params it was handed.
function makeGenerate(text) {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    return { text, ttftMs: 42, totalMs: 99 };
  };
  return { fn, calls };
}

function capture() {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
}

// The count rides the suppression's own line, in the style of the existing
// `session dark sites=N` counter (contract-floor 2). LOOSE on wording - the
// only things fixed by the contract are the SuppressionKind token and the
// `name=N` shape - and STRICT on the number that follows.
const FLOOR_COUNT = /(?:below[-_ ]?)?floor\s*=\s*(\d+)/i;
const BOUND_UNSAFE_COUNT = /bound[-_ ]?unsafe\s*=\s*(\d+)/i;

// The running session total is the LAST one the channel reported.
function sessionCount(lines, re) {
  let last;
  for (const l of lines) {
    const m = re.exec(l);
    if (m) last = Number(m[1]);
  }
  return last;
}

const countingLines = (lines, re) => lines.filter((l) => re.test(l));

// A plain mid-line site: the ghost is exactly the raw, so the character count
// under test is unambiguous.
const PLAIN = { prefix: "fn f() {\n    let x = ", suffix: "\n}\n", languageId: "rust" };

async function completeOnce(request, config = cfg(), log) {
  const g = makeGenerate(request.raw);
  const svc = new CompletionService(config, g.fn, log);
  const { raw, ...req } = request;
  const out = await svc.complete({ manual: true, ...req });
  svc.dispose();
  return { text: served(out), calls: g.calls };
}

const plainGhost = (raw, config, log) => completeOnce({ ...PLAIN, raw }, config, log);

// ###########################################################################
// 1. The shipped numbers are JetBrains' numbers.
//    [contract-floor 1; jetbrains-flcc "Worth stealing" 2]
// ###########################################################################

test("the shipped defaults carry a floor of eight characters and two alphanumerics", () => {
  assert.strictEqual(
    DEFAULT_FIM_CONFIG.minGhostChars,
    8,
    `the floor ships on by default at JetBrains' number, got ${JSON.stringify(DEFAULT_FIM_CONFIG)}`
  );
  assert.strictEqual(
    DEFAULT_FIM_CONFIG.minGhostAlnum,
    2,
    `and their second number, got ${JSON.stringify(DEFAULT_FIM_CONFIG)}`
  );
});

// ###########################################################################
// 2. The length leg, pinned in both directions. One character decides whether
//    a human ever sees the ghost, so both sides of the boundary are asserted.
//    [contract-floor 1]
// ###########################################################################

test("a ghost one character short of the floor is not served", async () => {
  const raw = "total1;"; // 7 characters, 6 alphanumeric
  assert.strictEqual(raw.length, 7);
  assert.ok(alnum(raw) >= 2);
  const { text } = await plainGhost(raw);
  assert.strictEqual(text, "", `a seven-character ghost costs a review for almost nothing, got ${JSON.stringify(text)}`);
});

test("a ghost of exactly the floor length is served", async () => {
  const raw = "totals1;"; // 8 characters, 7 alphanumeric
  assert.strictEqual(raw.length, 8);
  assert.ok(alnum(raw) >= 2);
  const { text } = await plainGhost(raw);
  assert.strictEqual(text, raw, "the floor is a minimum, not an exclusive bound");
});

// ###########################################################################
// 3. The alphanumeric leg, isolated: same site, same shape, one character
//    apart, every case comfortably past the length floor.
//    [contract-floor 1 "at least eight symbols with two or more alphanumeric"]
// ###########################################################################

const SPREAD = { prefix: "function f() {\n  g", suffix: "\n}\n", languageId: "typescript" };

test("a long enough ghost with no alphanumeric characters is not served", async () => {
  const raw = "(...[]);"; // 8 characters, 0 alphanumeric
  assert.strictEqual(raw.length, 8);
  assert.strictEqual(alnum(raw), 0);
  const { text } = await completeOnce({ ...SPREAD, raw });
  assert.strictEqual(text, "", `punctuation alone is not a suggestion, got ${JSON.stringify(text)}`);
});

test("a long enough ghost with one alphanumeric character is not served", async () => {
  const raw = "(...[0]);"; // 9 characters, 1 alphanumeric
  assert.strictEqual(raw.length, 9);
  assert.strictEqual(alnum(raw), 1);
  const { text } = await completeOnce({ ...SPREAD, raw });
  assert.strictEqual(text, "", `one alphanumeric is under the floor, got ${JSON.stringify(text)}`);
});

test("a long enough ghost with exactly two alphanumeric characters is served", async () => {
  const raw = "(...[0,1]);"; // 11 characters, 2 alphanumeric
  assert.strictEqual(raw.length, 11);
  assert.strictEqual(alnum(raw), 2);
  const { text } = await completeOnce({ ...SPREAD, raw });
  assert.strictEqual(text, raw, "two is the minimum, and the minimum passes");
});

// ###########################################################################
// 4. The named bar: the statement finisher is suppressed at the default, and
//    the channel says so with a running count.
//    [contract-floor Bars 3 - the case that will look wrong in dogfood]
// ###########################################################################

const FINISHER = { prefix: "fn f() {\n    println!(\"hi\"", suffix: "\n}\n", languageId: "rust" };

test("the statement finisher `);` is suppressed at the shipped default", async () => {
  const { text } = await completeOnce({ ...FINISHER, raw: ");" });
  assert.strictEqual(
    text,
    "",
    `two characters and no alphanumerics is exactly what JetBrains' numbers exclude, got ${JSON.stringify(text)}`
  );
});

test("suppressing the statement finisher is reported on the channel with a count", async () => {
  const c = capture();
  await completeOnce({ ...FINISHER, raw: ");" }, cfg(), c.log);
  const reported = c.lines.filter((l) => l.startsWith("[fim]") && /floor/i.test(l));
  assert.ok(
    reported.length >= 1,
    `a suppression the human cannot see must be findable in the only instrument this product has, got ${JSON.stringify(c.lines)}`
  );
  assert.strictEqual(
    sessionCount(c.lines, FLOOR_COUNT),
    1,
    `the count rides the suppression's own line, got ${JSON.stringify(c.lines)}`
  );
});

// The contract's own written example. Whichever leg fires - the generation is
// eleven characters, what survives the bound need not be - it must not reach a
// human, and it must be priced.
test("the contract's dogfood example `);      });` never reaches the human", async () => {
  const raw = ");      });";
  assert.strictEqual(alnum(raw), 0, "no alphanumeric characters anywhere in it");
  const c = capture();
  const { text } = await completeOnce(
    { prefix: "function f() {\n  run(() => {\n    step(1", suffix: "\n}\n", languageId: "typescript", raw },
    cfg(),
    c.log
  );
  assert.strictEqual(text, "", `got ${JSON.stringify(text)}`);
  assert.strictEqual(sessionCount(c.lines, FLOOR_COUNT), 1, `and it is priced, got ${JSON.stringify(c.lines)}`);
});

// ###########################################################################
// 5. Scope. The floor runs exactly where the bound runs: plain sites only.
//    A member-site ghost is a short identifier policed by resolved evidence,
//    and an eight-character floor there would suppress most of what the
//    injection leg exists to produce.
//    [contract-floor 1 "Scope: PLAIN sites only"; Bars 1]
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
  resolveInjection: async () => ({ memberNames: ["len", "tileTally", "rehome"] }),
};

test("a three-character member completion is served", async () => {
  const g = makeGenerate("len");
  const svc = new CompletionService(cfg(), g.fn);
  const out = await svc.complete({ ...MEMBER_REQ });
  svc.dispose();
  assert.strictEqual(
    served(out),
    "len",
    `member sites are policed by resolved evidence, not by length, got ${JSON.stringify(served(out))}`
  );
});

test("a member site never reports a floor suppression", async () => {
  const c = capture();
  const g = makeGenerate("len");
  const svc = new CompletionService(cfg(), g.fn, c.log);
  await svc.complete({ ...MEMBER_REQ });
  svc.dispose();
  assert.strictEqual(
    sessionCount(c.lines, FLOOR_COUNT),
    undefined,
    `the floor must not even be consulted at a member site, got ${JSON.stringify(c.lines)}`
  );
});

// The same site and the same raw, twice: the ONLY difference is whether a
// resolver is wired, which is what decides the exemption (contract-wiring 2).
const WB = {
  prefix: "struct Tile { w: u32, h: u32 }\n\nfn area(t: Tile) -> u32 {",
  suffix: "\n}\n",
  uri: "file:///a.rs",
  manual: true,
  languageId: "rust",
  wholeBlockSite: true,
};
const WB_RAW = "\n    x;"; // 7 characters, 1 alphanumeric: under BOTH legs

async function wholeBlockGhost(resolveInjection, log) {
  const g = makeGenerate(WB_RAW);
  const svc = new CompletionService(cfg(), g.fn, log);
  const out = await svc.complete({ ...WB, ...(resolveInjection ? { resolveInjection } : {}) });
  svc.dispose();
  return served(out);
}

test("a short ghost at an exempt whole-block site is served", async () => {
  assert.ok(WB_RAW.length < 8 && alnum(WB_RAW) < 2, "the fixture is under both legs of the floor");
  const text = await wholeBlockGhost(async () => "// members here");
  assert.strictEqual(
    text,
    WB_RAW,
    `an exempt site has a human gesture behind it, which is the evidence the floor substitutes for, got ${JSON.stringify(text)}`
  );
});

test("an exempt whole-block site never reports a floor suppression", async () => {
  const c = capture();
  await wholeBlockGhost(async () => "// members here", c.log);
  assert.strictEqual(
    sessionCount(c.lines, FLOOR_COUNT),
    undefined,
    `got ${JSON.stringify(c.lines)}`
  );
});

test("the same short ghost at a whole-block site with no resolver wired is suppressed", async () => {
  const c = capture();
  const text = await wholeBlockGhost(undefined, c.log);
  assert.strictEqual(
    text,
    "",
    `a site that can never inject is not exempt, so the floor applies, got ${JSON.stringify(text)}`
  );
  assert.strictEqual(
    sessionCount(c.lines, FLOOR_COUNT),
    1,
    `and the suppression is attributed to the floor, got ${JSON.stringify(c.lines)}`
  );
});

// ###########################################################################
// 6. The number is arguable, so it is configuration. Zero restores today's
//    behaviour exactly.
//    [contract-floor 1; Bars 2]
// ###########################################################################

test("a floor of zero serves the statement finisher unchanged", async () => {
  const { text } = await completeOnce({ ...FINISHER, raw: ");" }, cfg({ minGhostChars: 0 }));
  assert.strictEqual(text, ");", `zero disables the floor ENTIRELY, both legs, got ${JSON.stringify(text)}`);
});

test("a floor of zero serves a three-character ghost unchanged", async () => {
  const { text } = await plainGhost("n1;", cfg({ minGhostChars: 0 }));
  assert.strictEqual(text, "n1;", `got ${JSON.stringify(text)}`);
});

test("a floor of zero reports no floor suppressions at all", async () => {
  const c = capture();
  await plainGhost("n1;", cfg({ minGhostChars: 0 }), c.log);
  assert.strictEqual(
    sessionCount(c.lines, FLOOR_COUNT),
    undefined,
    `a disabled floor must not count what it did not suppress, got ${JSON.stringify(c.lines)}`
  );
});

test("a raised floor suppresses a ghost the default would have served", async () => {
  const raw = "totalCount1;"; // 12 characters: over the default, under 20
  const atDefault = await plainGhost(raw);
  assert.strictEqual(atDefault.text, raw, "served at the shipped default");
  const raised = await plainGhost(raw, cfg({ minGhostChars: 20 }));
  assert.strictEqual(raised.text, "", "the floor is a setting, not a constant");
});

// ###########################################################################
// 7. The floor is measured on the SERVED text, after every other filter, so
//    what it judges is what the human would have seen.
//    [contract-floor 1 closing paragraph]
//
//    Same site, same total generation length; only the ORDER of the lines
//    differs, so the only thing that can decide these two cases apart is
//    whether the floor read the raw or the served text.
// ###########################################################################

const HEAD = { prefix: "fn f() {", suffix: "\n", languageId: "rust" };

test("a long generation whose served ghost falls under the floor is suppressed", async () => {
  const raw = "\n    x;\n    let total = 0;\n    more();";
  assert.ok(raw.length > 8 && alnum(raw) > 2, "the raw generation clears the floor comfortably");
  const c = capture();
  const { text } = await completeOnce({ ...HEAD, raw }, cfg(), c.log);
  assert.strictEqual(
    text,
    "",
    `the floor judges what survives the bound, not what the model produced, got ${JSON.stringify(text)}`
  );
  assert.strictEqual(sessionCount(c.lines, FLOOR_COUNT), 1, `got ${JSON.stringify(c.lines)}`);
});

test("a long generation whose served ghost clears the floor is served", async () => {
  const raw = "\n    let total = 0;\n    x;\n    more();";
  const { text } = await completeOnce({ ...HEAD, raw });
  assert.ok(
    text.includes("let total = 0;"),
    `the same site with the same raw length must serve when the SERVED text clears the floor, got ${JSON.stringify(text)}`
  );
});

// ###########################################################################
// 8. The ledger: session-scoped counts, one per kind, one increment per event.
//    [contract-floor 2; Bars 4]
// ###########################################################################

const LEDGER_SITES = [
  { prefix: "fn f() {\n    let a = ", raw: "n1;" },
  { prefix: "fn f() {\n    let b = ", raw: "n2;" },
  { prefix: "fn f() {\n    let c = ", raw: "n3;" },
];

test("a suppression count accumulates over the life of one service", async () => {
  const c = capture();
  let text = "";
  const generate = async () => ({ text, ttftMs: 1, totalMs: 2 });
  const svc = new CompletionService(cfg(), generate, c.log);

  const counts = [];
  for (const site of LEDGER_SITES) {
    text = site.raw;
    await svc.complete({ prefix: site.prefix, suffix: "\n}\n", manual: true, languageId: "rust" });
    counts.push(sessionCount(c.lines, FLOOR_COUNT));
  }
  svc.dispose();

  assert.deepStrictEqual(
    counts,
    [1, 2, 3],
    `a count answers "how often does this fire", which needs the session, not the request, got ${JSON.stringify(c.lines)}`
  );
});

test("a new service starts its own count", async () => {
  const first = capture();
  await plainGhost("n1;", cfg(), first.log);
  const second = capture();
  await plainGhost("n1;", cfg(), second.log);
  assert.strictEqual(sessionCount(first.lines, FLOOR_COUNT), 1);
  assert.strictEqual(
    sessionCount(second.lines, FLOOR_COUNT),
    1,
    "session-scoped means it resets with the session, got a total that outlived its service"
  );
});

test("each suppression kind carries its own count rather than sharing one", async () => {
  const c = capture();
  let text = "";
  const generate = async () => ({ text, ttftMs: 1, totalMs: 2 });
  const svc = new CompletionService(cfg(), generate, c.log);

  // Two floor suppressions.
  text = "n1;";
  await svc.complete({ prefix: LEDGER_SITES[0].prefix, suffix: "\n}\n", manual: true, languageId: "rust" });
  text = "n2;";
  await svc.complete({ prefix: LEDGER_SITES[1].prefix, suffix: "\n}\n", manual: true, languageId: "rust" });

  // One suppression of a different kind: the bound found no safe cut point.
  text = "foo(";
  const out = await svc.complete({
    prefix: "fn f() {\n    let d = ",
    suffix: "\n}\n",
    manual: true,
    languageId: "rust",
  });
  svc.dispose();

  assert.strictEqual(served(out), "", "no safe cut point means no ghost");
  assert.strictEqual(
    sessionCount(c.lines, FLOOR_COUNT),
    2,
    `the floor counted only what the floor suppressed, got ${JSON.stringify(c.lines)}`
  );
  assert.strictEqual(
    sessionCount(c.lines, BOUND_UNSAFE_COUNT),
    1,
    `each of the four suppressions is priced separately or none of them can be priced, got ${JSON.stringify(c.lines)}`
  );
});

test("one request that trips the floor moves the count by exactly one", async () => {
  const c = capture();
  await plainGhost("n1;", cfg(), c.log);
  assert.strictEqual(sessionCount(c.lines, FLOOR_COUNT), 1, `got ${JSON.stringify(c.lines)}`);
  assert.strictEqual(
    countingLines(c.lines, FLOOR_COUNT).length,
    1,
    `one event is one line: the primary and the alternates path must not both count it, got ${JSON.stringify(c.lines)}`
  );
});

test("asking for alternates does not multiply the count for one request", async () => {
  const c = capture();
  const g = makeGenerate("n1;");
  const svc = new CompletionService(cfg(), g.fn, c.log);
  const out = await svc.complete({
    prefix: LEDGER_SITES[0].prefix,
    suffix: "\n}\n",
    manual: true,
    languageId: "rust",
    alternatives: 3,
  });
  svc.dispose();
  assert.strictEqual(served(out), "", "every candidate is under the floor, so nothing is served");
  assert.strictEqual(
    sessionCount(c.lines, FLOOR_COUNT),
    1,
    `the keystroke is the event, not the candidate, got ${JSON.stringify(c.lines)}`
  );
});

test("a served ghost adds nothing to the floor's count", async () => {
  const c = capture();
  let text = "";
  const generate = async () => ({ text, ttftMs: 1, totalMs: 2 });
  const svc = new CompletionService(cfg(), generate, c.log);

  text = "totalCount1;";
  const ok = await svc.complete({ prefix: LEDGER_SITES[0].prefix, suffix: "\n}\n", manual: true, languageId: "rust" });
  text = "n2;";
  await svc.complete({ prefix: LEDGER_SITES[1].prefix, suffix: "\n}\n", manual: true, languageId: "rust" });
  svc.dispose();

  assert.strictEqual(served(ok), "totalCount1;", "the long ghost was served");
  assert.strictEqual(
    sessionCount(c.lines, FLOOR_COUNT),
    1,
    `only the suppression counts, got ${JSON.stringify(c.lines)}`
  );
});
