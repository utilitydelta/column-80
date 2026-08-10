// Implementer oracles for phase 4B internals the blind suites cannot reach:
// the TS classifier's quoted-name extraction corners, coverage-fallback
// candidate discovery, probe ordering and cache honesty (answered-only, dark
// twin), the strategy-described env reasons, the autosave mtime guard's
// edges, and the injection seam's firm-instruction gate + TS wrong-item
// dedup identity (the 4B close pins).
//
// Run: SKIP_LIVE=1 node --test test/impl-v9-repair.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v9-repair",
  `export { classifyTsHallucination, tsUnresolvedNameCursor, assembleTsWrongItemPayload } from "../src/core/compilerDirected";\n` +
    `export { TsOracle, runOracleCheck } from "../src/core/compilerOracle";\n`,
);
const { classifyTsHallucination, tsUnresolvedNameCursor, assembleTsWrongItemPayload, TsOracle, runOracleCheck } = mod;
test.after(cleanup);

// A second bundle for the injection seam: resolveSurfaceInjection lives in
// src/vscode, so it rides the minimal vscode stub alias (the blind-v6-item1
// precedent, same stub shape as blind-v9-repair's layer A).
const VS_STUB = path.join(__dirname, ".impl-v9-repair-vs-stub.cjs");
fs.writeFileSync(
  VS_STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = { Position, Range, languages: {}, window: {}, workspace: {}, ThemeColor: class {}, MarkdownString: class {} };\n`,
);
const VS_ENTRY = path.join(__dirname, ".impl-v9-repair-vs.entry.ts");
const VS_OUT = path.join(__dirname, ".impl-v9-repair-vs.bundle.cjs");
fs.writeFileSync(
  VS_ENTRY,
  `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";\n` +
    `export { FIRM_INSTRUCTION } from "../src/core/compilerDirected";\n`,
);
esbuild.buildSync({
  entryPoints: [VS_ENTRY],
  bundle: true,
  outfile: VS_OUT,
  format: "cjs",
  platform: "node",
  alias: { vscode: VS_STUB },
});
const { resolveSurfaceInjection, FIRM_INSTRUCTION } = require(VS_OUT);
test.after(() => {
  for (const p of [VS_STUB, VS_ENTRY, VS_OUT]) fs.rmSync(p, { force: true });
});

// ---------------------------------------------------------------------------
// Shared fixtures.
// ---------------------------------------------------------------------------

const mkDiag = (code, message, opts = {}) => ({
  kind: "compile-error",
  level: "error",
  code,
  message,
  spans:
    opts.spans !== undefined
      ? opts.spans
      : [
          {
            fileName: "src/app.ts",
            byteStart: 0,
            byteEnd: 0,
            lineStart: opts.line ?? 3,
            lineEnd: opts.line ?? 3,
            columnStart: opts.col ?? 8,
            columnEnd: opts.col ?? 8,
            isPrimary: true,
          },
        ],
  suggestions: [],
});

// ---------------------------------------------------------------------------
// TS classifier: quoted-name extraction corners.
// ---------------------------------------------------------------------------

test("classifyTsHallucination TS2339: member and receiver from the quoted names, cursor 0-based from the primary span", () => {
  const cls = classifyTsHallucination(mkDiag("TS2339", "Property 'city' does not exist on type 'Order'.", { line: 3, col: 23 }));
  assert.deepStrictEqual(cls, {
    kind: "unresolved-method",
    member: "city",
    type: "Order",
    cursor: { line: 2, character: 22 },
  });
});

test("classifyTsHallucination TS2339: an inline object receiver type survives the lazy match", () => {
  const cls = classifyTsHallucination(mkDiag("TS2339", "Property 'x' does not exist on type '{ a: string; b: number; }'."));
  assert.strictEqual(cls.kind, "unresolved-method");
  assert.strictEqual(cls.member, "x");
  assert.strictEqual(cls.type, "{ a: string; b: number; }");
});

test("classifyTsHallucination TS2551: the did-you-mean tail never leaks into the receiver type", () => {
  const cls = classifyTsHallucination(
    mkDiag("TS2551", "Property 'setTeme' does not exist on type 'ThemeStore'. Did you mean 'setTheme'?"),
  );
  assert.strictEqual(cls.kind, "unresolved-method");
  assert.strictEqual(cls.member, "setTeme");
  assert.strictEqual(cls.type, "ThemeStore");
});

test("classifyTsHallucination TS2305: wrong-item with tsc's module quotes stripped from the specifier", () => {
  const cls = classifyTsHallucination(mkDiag("TS2305", `Module '"./order"' has no exported member 'missingThing'.`));
  assert.strictEqual(cls.kind, "wrong-item");
  assert.strictEqual(cls.crate, "./order");
  assert.strictEqual(cls.item, "missingThing");
  assert.strictEqual(cls.suggestion, undefined);
});

test("classifyTsHallucination TS2724: the did-you-mean suggestion is captured; absent stays undefined", () => {
  const withHint = classifyTsHallucination(
    mkDiag("TS2724", `'"./order"' has no exported member named 'Orderr'. Did you mean 'Order'?`),
  );
  assert.strictEqual(withHint.kind, "wrong-item");
  assert.strictEqual(withHint.crate, "./order");
  assert.strictEqual(withHint.item, "Orderr");
  assert.strictEqual(withHint.suggestion, "Order");
  const noHint = classifyTsHallucination(mkDiag("TS2724", `'"./order"' has no exported member named 'Orderr'.`));
  assert.strictEqual(noHint.kind, "wrong-item");
  assert.strictEqual(noHint.suggestion, undefined);
});

test("classifyTsHallucination: unclassified codes, garbled messages, and span-less diagnostics are undefined", () => {
  assert.strictEqual(classifyTsHallucination(mkDiag("TS2322", "Type 'string' is not assignable to type 'number'.")), undefined);
  assert.strictEqual(classifyTsHallucination(mkDiag("TS2304", "Cannot find name 'soleExport'.")), undefined, "the qualify class never injects");
  assert.strictEqual(classifyTsHallucination(mkDiag("TS2552", "Cannot find name 'themeStor'. Did you mean 'themeStore'?")), undefined);
  assert.strictEqual(classifyTsHallucination(mkDiag("TS2339", "some unexpected wording")), undefined, "no quoted names = no class, never a guess");
  assert.strictEqual(
    classifyTsHallucination(mkDiag("TS2339", "Property 'x' does not exist on type 'Y'.", { spans: [] })),
    undefined,
    "no primary span = nowhere to point the extractor",
  );
});

test("tsUnresolvedNameCursor: TS2304/TS2552 yield the 0-based cursor; other codes and span-less shapes stay undefined", () => {
  assert.deepStrictEqual(
    tsUnresolvedNameCursor(mkDiag("TS2304", "Cannot find name 'soleExport'.", { line: 2, col: 10 })),
    { line: 1, character: 9 },
  );
  assert.deepStrictEqual(
    tsUnresolvedNameCursor(mkDiag("TS2552", "Cannot find name 'themeStor'. Did you mean 'themeStore'?", { line: 2, col: 18 })),
    { line: 1, character: 17 },
  );
  assert.strictEqual(
    tsUnresolvedNameCursor(mkDiag("TS9999", "Cannot find name 'soleExport'.")),
    undefined,
    "the code gates the family - message text alone never qualifies",
  );
  assert.strictEqual(tsUnresolvedNameCursor(mkDiag("TS2304", "Cannot find name 'x'.", { spans: [] })), undefined);
});

test("assembleTsWrongItemPayload names the item, the module, and the compiler's suggestion when present", () => {
  const withHint = assembleTsWrongItemPayload({ item: "Orderr", module: "./order", suggestion: "Order" });
  assert.ok(withHint.includes("`Orderr`"));
  assert.ok(withHint.includes("`./order`"));
  assert.ok(withHint.includes("`Order`"));
  const noHint = assembleTsWrongItemPayload({ item: "missingThing", module: "./order" });
  assert.ok(noHint.includes("`missingThing`"));
  assert.ok(!noHint.includes("suggests"), "no invented suggestion when tsc offered none");
});

// ---------------------------------------------------------------------------
// Coverage fallback: candidate discovery and probe ordering.
// ---------------------------------------------------------------------------

const R = (p) => path.resolve(p);

test("coverageFallbackProjects: references first (file and directory forms), then siblings, deduped, existing only", () => {
  const root = "/mono/app";
  const files = new Set([
    R("/mono/app/tsconfig.json"),
    R("/mono/app/tsconfig.app.json"),
    R("/mono/app/tsconfig.node.json"),
    R("/mono/shared/tsconfig.json"),
  ]);
  const oracle = new TsOracle({
    fileExists: (p) => files.has(R(p)),
    readFile: (p) =>
      R(p) === R("/mono/app/tsconfig.json")
        ? JSON.stringify({
            files: [],
            references: [
              { path: "./tsconfig.app.json" },
              { path: "../shared" },
              { path: "./tsconfig.gone.json" },
            ],
          })
        : undefined,
    readDir: (dir) =>
      R(dir) === R(root) ? ["tsconfig.json", "tsconfig.node.json", "tsconfig.app.json", "src", "package.json"] : [],
  });
  assert.deepStrictEqual(oracle.coverageFallbackProjects(root), [
    R("/mono/app/tsconfig.app.json"),
    R("/mono/shared/tsconfig.json"),
    R("/mono/app/tsconfig.node.json"),
  ]);
});

test("coverageFallbackProjects: JSONC references (comments, trailing commas) parse; the nearest tsconfig.json never lists itself", () => {
  const root = "/p";
  const files = new Set([R("/p/tsconfig.json"), R("/p/tsconfig.app.json")]);
  const oracle = new TsOracle({
    fileExists: (p) => files.has(R(p)),
    readFile: () =>
      `{\n  // the vite shell\n  "files": [], /* nothing loads here */\n  "references": [\n    { "path": "./tsconfig.app.json" },\n  ],\n}\n`,
    readDir: () => ["tsconfig.json"],
  });
  assert.deepStrictEqual(oracle.coverageFallbackProjects(root), [R("/p/tsconfig.app.json")]);
});

test("coverageFallbackProjects: an unparseable tsconfig yields no references, siblings still probe-able", () => {
  const root = "/p2";
  const files = new Set([R("/p2/tsconfig.json"), R("/p2/tsconfig.server.json")]);
  const oracle = new TsOracle({
    fileExists: (p) => files.has(R(p)),
    readFile: () => "{ not json at all",
    readDir: () => ["tsconfig.server.json", "tsconfig.json"],
  });
  assert.deepStrictEqual(oracle.coverageFallbackProjects(root), [R("/p2/tsconfig.server.json")]);
});

// A virtual project whose nearest probe answers not-covered and whose two
// fallback candidates both exist; the transcript proves ordering.
const fallbackFixture = (tag) => {
  const root = `/fb-${tag}`;
  const file = `${root}/server/main.ts`;
  const cfg = (name) => R(`${root}/${name}`);
  const files = new Set([
    cfg("tsconfig.json"),
    cfg("tsconfig.a.json"),
    cfg("tsconfig.b.json"),
    R(`${root}/node_modules/typescript/bin/tsc`),
  ]);
  const oracle = new TsOracle({
    fileExists: (p) => files.has(R(p)),
    readFile: (p) => (R(p) === cfg("tsconfig.json") ? JSON.stringify({ include: ["src"] }) : undefined),
    readDir: (dir) => (R(dir) === R(root) ? ["tsconfig.a.json", "tsconfig.b.json", "tsconfig.json"] : []),
  });
  return { root, file, cfg, oracle };
};

const pTarget = (cmd) => cmd.args[cmd.args.indexOf("-p") + 1];
const isProbe = (cmd) => cmd.args.includes("--listFilesOnly");

test("fallback probe ordering: nearest first, candidates in discovery order, probing STOPS at the first winner", async () => {
  const F = fallbackFixture("order");
  const calls = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    if (isProbe(cmd)) {
      return { stdout: pTarget(cmd) === F.cfg("tsconfig.a.json") ? F.file + "\n" : "", exitCode: 0 };
    }
    return { stdout: "", exitCode: 0 };
  };
  const result = await runOracleCheck(F.oracle, F.file, { runCommand });
  assert.ok(result && result.success === true);
  assert.deepStrictEqual(
    calls.map((c) => [isProbe(c) ? "probe" : "check", pTarget(c)]),
    [
      ["probe", F.root],
      ["probe", F.cfg("tsconfig.a.json")],
      ["check", F.cfg("tsconfig.a.json")],
    ],
    "tsconfig.b.json is never probed once a wins, and the check targets the winner",
  );
});

test("fallback: a rejecting candidate probe is logged and skipped, the NEXT candidate still wins", async () => {
  const F = fallbackFixture("reject");
  const calls = [];
  const lines = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    if (isProbe(cmd)) {
      if (pTarget(cmd) === F.cfg("tsconfig.a.json")) {
        throw new Error("spawn EGONE");
      }
      return { stdout: pTarget(cmd) === F.cfg("tsconfig.b.json") ? F.file + "\n" : "", exitCode: 0 };
    }
    return { stdout: "", exitCode: 0 };
  };
  const result = await runOracleCheck(F.oracle, F.file, { runCommand, log: (l) => lines.push(l) });
  assert.ok(result && result.success === true, "b still resolves the verdict");
  assert.strictEqual(pTarget(calls[calls.length - 1]), F.cfg("tsconfig.b.json"), "the check targets b");
  assert.ok(
    lines.some((l) => l.includes("coverage fallback probe failed") && l.includes("tsconfig.a.json")),
    `the rejected candidate leaves evidence; got ${JSON.stringify(lines)}`,
  );
});

test("fallback not-covered: envReason names the nearest tsconfig AND every probed fallback; no check spawns", async () => {
  const F = fallbackFixture("dark");
  const calls = [];
  const reasons = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    return { stdout: "", exitCode: 0 };
  };
  const result = await runOracleCheck(F.oracle, F.file, { runCommand, envReason: (r) => reasons.push(r) });
  assert.strictEqual(result, undefined);
  assert.ok(calls.every(isProbe), "the check never spawned");
  assert.strictEqual(reasons.length, 1);
  assert.ok(reasons[0].includes(path.join(F.root, "tsconfig.json")), reasons[0]);
  assert.ok(reasons[0].includes(F.cfg("tsconfig.a.json")) && reasons[0].includes(F.cfg("tsconfig.b.json")), reasons[0]);
  assert.ok(reasons[0].includes(F.file), "the reason names the file");
});

test("covered path: envReason never fires on a healthy check, failed or clean", async () => {
  const F = fallbackFixture("healthy");
  const reasons = [];
  const runCommand = async (cmd) =>
    isProbe(cmd)
      ? { stdout: F.file + "\n", exitCode: 0 }
      : { stdout: "server/main.ts(1,1): error TS2322: x\n", exitCode: 2 };
  const result = await runOracleCheck(F.oracle, F.file, { runCommand, envReason: (r) => reasons.push(r) });
  assert.ok(result && result.success === false && result.diagnostics.length === 1);
  assert.deepStrictEqual(reasons, [], "a failing check with diagnostics is failing CODE, not a broken env");
});

// ---------------------------------------------------------------------------
// Strategy-described env reasons.
// ---------------------------------------------------------------------------

test("describeMissingRoot: no tsconfig anywhere names the file; tsconfig without typescript names the project dir and the walk", () => {
  const bare = new TsOracle({ fileExists: () => false });
  assert.strictEqual(bare.describeMissingRoot("/w/src/app.ts"), "no tsconfig.json above /w/src/app.ts");
  const noTs = new TsOracle({ fileExists: (p) => R(p) === R("/w/tsconfig.json") });
  const reason = noTs.describeMissingRoot("/w/src/app.ts");
  assert.ok(reason.includes("/w"), reason);
  assert.match(reason, /typescript/i);
  const healthy = new TsOracle({
    fileExists: (p) => R(p) === R("/w/tsconfig.json") || R(p) === R("/w/node_modules/typescript/bin/tsc"),
  });
  assert.strictEqual(healthy.describeMissingRoot("/w/src/app.ts"), undefined, "a resolvable root has nothing to explain");
});

test("describeCheckFailure carries the exit code and the first-stderr-line evidence", () => {
  const oracle = new TsOracle();
  assert.strictEqual(
    oracle.describeCheckFailure(1, "BOOM: it broke"),
    "project tsc crashed (exit 1): BOOM: it broke",
  );
  assert.strictEqual(oracle.describeCheckFailure(2), "project tsc crashed (exit 2)");
});

test("describeCheckFailure: a spawn REJECTION (negative sentinel) says the spawn failed - no process exited, no invented exit code", () => {
  const oracle = new TsOracle();
  const rejection = oracle.describeCheckFailure(-1, "Error: spawn ENOENT");
  assert.ok(!rejection.includes("exit -1"), `no exit code ever existed; got: ${rejection}`);
  assert.ok(!/crashed \(exit/.test(rejection), `a rejection is not a crash-with-code; got: ${rejection}`);
  assert.match(rejection, /spawn/i, `the wording names the spawn failure; got: ${rejection}`);
  assert.ok(rejection.includes("Error: spawn ENOENT"), "the real evidence string survives");
  assert.strictEqual(oracle.describeCheckFailure(-1), "project tsc could not be spawned", "evidence-less rejection stays clean");
});

// ---------------------------------------------------------------------------
// Autosave mtime guard edges.
// ---------------------------------------------------------------------------

const SRC = 'const label: string = "task";\nconst count: number = label;\n';
const TWO_DIAGS =
  "src/app.ts(2,7): error TS2322: Type 'string' is not assignable to type 'number'.\n" +
  "src/app.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n";

const guardParse = ({ mtime, checkStart, stdout = TWO_DIAGS }) => {
  const lines = [];
  const oracle = new TsOracle({
    readFile: (p) => (p === path.join("/proj", "src", "app.ts") ? SRC : undefined),
    statMtimeMs: () => mtime,
    log: (l) => lines.push(l),
  });
  const diags = oracle.parseCheckOutput(stdout, "/proj", checkStart);
  return { diags, lines };
};

test("guard: an mtime in the SAME integer millisecond as check start never fires (fractional stat precision)", () => {
  const { diags, lines } = guardParse({ mtime: 1000.9, checkStart: 1000 });
  assert.strictEqual(diags[0].spans[0].byteStart, 36, "real offsets kept");
  assert.ok(!lines.some((l) => l.includes("content changed since check")), JSON.stringify(lines));
});

test("guard: an older file keeps real offsets and stays quiet", () => {
  const { diags, lines } = guardParse({ mtime: 500, checkStart: 1000 });
  assert.strictEqual(diags[0].spans[0].byteStart, 36);
  assert.strictEqual(diags[1].spans[0].byteStart, 6);
  assert.deepStrictEqual(lines, []);
});

test("guard: a newer file sentinels EVERY span in it, line/col kept, exactly ONE channel line per file", () => {
  const { diags, lines } = guardParse({ mtime: 2001, checkStart: 1000 });
  assert.strictEqual(diags[0].spans[0].byteStart, -1);
  assert.strictEqual(diags[0].spans[0].byteEnd, -1);
  assert.strictEqual(diags[1].spans[0].byteStart, -1);
  assert.strictEqual(diags[0].spans[0].lineStart, 2, "line/col survive the sentinel");
  assert.strictEqual(diags[0].spans[0].columnStart, 7);
  assert.strictEqual(
    lines.filter((l) => l.includes("content changed since check; offsets skipped")).length,
    1,
    `one guard line per distinct file per parse; got ${JSON.stringify(lines)}`,
  );
});

test("guard: an unstat-able file (mtime undefined) trusts the read and keeps offsets", () => {
  const { diags, lines } = guardParse({ mtime: undefined, checkStart: 1000 });
  assert.strictEqual(diags[0].spans[0].byteStart, 36);
  assert.ok(!lines.some((l) => l.includes("content changed since check")));
});

test("guard: a direct parse call without a check-start time never consults the guard", () => {
  let statted = 0;
  const oracle = new TsOracle({
    readFile: () => SRC,
    statMtimeMs: () => {
      statted++;
      return Number.MAX_SAFE_INTEGER;
    },
  });
  const diags = oracle.parseCheckOutput(TWO_DIAGS, "/proj");
  assert.strictEqual(diags[0].spans[0].byteStart, 36);
  assert.strictEqual(statted, 0, "no checkStartMs, no stat");
});

test("guard: an unreadable file keeps the unreadable log path, never the guard line", () => {
  const lines = [];
  const oracle = new TsOracle({
    readFile: () => undefined,
    statMtimeMs: () => Number.MAX_SAFE_INTEGER,
    log: (l) => lines.push(l),
  });
  const [d] = oracle.parseCheckOutput(TWO_DIAGS, "/proj", 1000);
  assert.strictEqual(d.spans[0].byteStart, -1);
  assert.ok(lines.some((l) => l.includes("parse skipped byte offsets: unreadable")));
  assert.ok(!lines.some((l) => l.includes("content changed since check")));
});

// ---------------------------------------------------------------------------
// Coverage cache honesty (4B close: MAJOR-2 pins, MINOR-5). Both invariants
// were mutation-proven gaps in the review: the code was correct, nothing
// pinned it.
// ---------------------------------------------------------------------------

test("cache: a failed-open (unanswered) probe is NEVER cached - the next accept re-probes, and its answered not-covered goes dark", async () => {
  const F = fallbackFixture("m3pin");
  const calls = [];
  let probeMode = "crash";
  const runCommand = async (cmd) => {
    calls.push(cmd);
    if (isProbe(cmd)) {
      if (probeMode === "crash") throw new Error("EAGAIN: transient toolchain crash");
      return { stdout: "", exitCode: 0 };
    }
    return { stdout: "", exitCode: 0 };
  };
  const first = await runOracleCheck(F.oracle, F.file, { runCommand });
  assert.ok(first && first.success === true, "the crashed probe fails OPEN: the first accept still gets its check");
  assert.strictEqual(calls.filter((c) => !isProbe(c)).length, 1, "exactly one check spawned on the fail-open");
  probeMode = "answer";
  const before = calls.length;
  const second = await runOracleCheck(F.oracle, F.file, { runCommand });
  assert.ok(calls.slice(before).some(isProbe), "the failed-open assumption was never cached: the next accept re-probes");
  assert.strictEqual(second, undefined, "the healed probe's answered not-covered goes dark - no excluded file greens forever");
  assert.strictEqual(calls.filter((c) => !isProbe(c)).length, 1, "the dark verdict spawns no second check");
});

test("cache: a fallback candidate ANSWERS only on exit 0 - a crashed sibling printing `error TS` on stdout never fakes coverage", async () => {
  const F = fallbackFixture("m4pin");
  const calls = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    if (!isProbe(cmd)) {
      return { stdout: "", exitCode: 0 };
    }
    if (pTarget(cmd) === F.cfg("tsconfig.a.json")) {
      // The broken-sibling shape: a non-zero exit whose stdout would satisfy
      // fileCovered's old-tsc fail-open branch if the exit gate were dropped.
      return { stdout: 'error TS6306: Referenced project must have setting "composite": true.\n', exitCode: 2 };
    }
    return { stdout: "", exitCode: 0 };
  };
  const result = await runOracleCheck(F.oracle, F.file, { runCommand });
  assert.strictEqual(result, undefined, "the non-zero candidate is rejected: honest dark, never a winner");
  assert.ok(calls.every(isProbe), "no check ever spawns toward the broken sibling");
});

test("cache: an ANSWERED dark verdict is cached beside the winners - a repeat accept issues ZERO probes and keeps the evidence", async () => {
  const F = fallbackFixture("darkcache");
  const calls = [];
  const reasons = [];
  const lines = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    return { stdout: "", exitCode: 0 };
  };
  const opts = { runCommand, envReason: (r) => reasons.push(r), log: (l) => lines.push(l) };
  const first = await runOracleCheck(F.oracle, F.file, opts);
  assert.strictEqual(first, undefined);
  const spawnsAfterFirst = calls.length;
  assert.ok(spawnsAfterFirst >= 3, `nearest + both fallback candidates probed once; got ${spawnsAfterFirst}`);
  const second = await runOracleCheck(F.oracle, F.file, opts);
  assert.strictEqual(second, undefined);
  assert.strictEqual(calls.length, spawnsAfterFirst, "ZERO spawns on the repeat accept of a cached-dark file");
  assert.strictEqual(reasons.length, 2, "the repeat accept still surfaces the honest reason");
  assert.ok(
    reasons[1].includes(F.cfg("tsconfig.a.json")) && reasons[1].includes(F.cfg("tsconfig.b.json")),
    `the cached reason still names every probed config; got ${reasons[1]}`,
  );
  assert.ok(
    lines.some((l) => l.includes("is not an input of") && l.includes("(cached)")),
    `the repeat skip line says it answered from cache; got ${JSON.stringify(lines)}`,
  );
});

test("cache: a dark verdict with an UNANSWERED fallback probe is NOT cached - the next accept re-probes", async () => {
  const F = fallbackFixture("darkuncached");
  const calls = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    if (isProbe(cmd) && pTarget(cmd) === F.cfg("tsconfig.a.json")) {
      throw new Error("spawn EAGAIN");
    }
    return { stdout: "", exitCode: 0 };
  };
  const first = await runOracleCheck(F.oracle, F.file, { runCommand });
  assert.strictEqual(first, undefined, "the crashed candidate cannot cover, the rest answered not-covered: dark");
  const before = calls.length;
  const second = await runOracleCheck(F.oracle, F.file, { runCommand });
  assert.strictEqual(second, undefined);
  assert.ok(calls.length > before, "an unanswered probe means the dark verdict re-probes next accept, never caches");
});

// ---------------------------------------------------------------------------
// Injection seam (4B close: MAJOR-1 firm-instruction gate, MINOR-4 TS
// wrong-item dedup identity). Driven through the bundled
// resolveSurfaceInjection with synthetic diagnostics - the classifier reads
// only code + quoted names, pinned real-tsc-shaped above.
// ---------------------------------------------------------------------------

// The blind-v9-repair makeHeadlessDoc, trimmed: a document fake carrying the
// languageId the seam dispatches on.
function makeDoc(text, languageId) {
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + pos.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return {
    uri: { toString: () => "file:///seam/src/app.ts", fsPath: "/seam/src/app.ts", scheme: "file" },
    fileName: "/seam/src/app.ts",
    languageId,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const seamExtractor = (answers = {}) => ({
  example: async () => undefined,
  completeMembers: async () => answers.completeMembers ?? [],
  hoverSurface: async () => undefined,
  membersOfType: async () => [],
  definition: async () => undefined,
  qualifyImport: async () => undefined,
});

const TS2305_MSG = (item) => `Module '"./order"' has no exported member '${item}'.`;
const SEAM_SRC = 'import { missA, missB } from "./order";\nexport const m = missA;\n';

test("seam: a steer-only TS wrong-item payload carries NO firm instruction - there is no surface for it to govern", async () => {
  const doc = makeDoc(SEAM_SRC, "typescript");
  const out = await resolveSurfaceInjection(
    seamExtractor(),
    doc,
    [mkDiag("TS2305", TS2305_MSG("missA"), { line: 1, col: 10 })],
    () => {},
  );
  assert.strictEqual(
    out,
    assembleTsWrongItemPayload({ item: "missA", module: "./order" }),
    "the payload is EXACTLY the steer: no fence, no instruction, nothing else",
  );
  assert.ok(!out.includes(FIRM_INSTRUCTION), "the instruction governs an injected API surface; a steer-only payload has none");
  assert.ok(!out.includes("Call ONLY"), "the review's captured instruction line is dead");
});

test("seam: a MIXED payload (wrong-item steer + real member surface) keeps the one shared firm instruction", async () => {
  const doc = makeDoc(SEAM_SRC, "typescript");
  const ext = seamExtractor({
    completeMembers: [{ name: "total", signature: "total(): number", kind: "method" }],
  });
  const out = await resolveSurfaceInjection(
    ext,
    doc,
    [
      mkDiag("TS2305", TS2305_MSG("missA"), { line: 1, col: 10 }),
      mkDiag("TS2339", "Property 'city' does not exist on type 'Order'.", { line: 2, col: 18 }),
    ],
    () => {},
  );
  assert.ok(out.includes("missA"), `the steer rides along; got: ${out}`);
  assert.ok(out.includes("total(): number"), `the member surface renders; got: ${out}`);
  assert.ok(out.endsWith(FIRM_INSTRUCTION), "the member surface earns the one shared instruction");
});

test("seam: two TS2305s from the SAME module both render their steers - the TS dedup identity carries the item", async () => {
  const doc = makeDoc(SEAM_SRC, "typescript");
  const logs = [];
  const out = await resolveSurfaceInjection(
    seamExtractor(),
    doc,
    [
      mkDiag("TS2305", TS2305_MSG("missA"), { line: 1, col: 10 }),
      mkDiag("TS2305", TS2305_MSG("missB"), { line: 1, col: 17 }),
    ],
    (l) => logs.push(l),
  );
  const steerA = assembleTsWrongItemPayload({ item: "missA", module: "./order" });
  const steerB = assembleTsWrongItemPayload({ item: "missB", module: "./order" });
  assert.strictEqual(out, `${steerA}\n\n${steerB}`, "both steers render, still instruction-free (steers only)");
  assert.strictEqual(
    logs.filter((l) => l.includes("surface injected class=wrong-item")).length,
    2,
    `one evidence line per steer; got ${JSON.stringify(logs)}`,
  );
  // The SAME item twice still dedups to one steer: the identity gained the
  // item, not span noise.
  const dup = await resolveSurfaceInjection(
    seamExtractor(),
    doc,
    [
      mkDiag("TS2305", TS2305_MSG("missA"), { line: 1, col: 10 }),
      mkDiag("TS2305", TS2305_MSG("missA"), { line: 2, col: 18 }),
    ],
    () => {},
  );
  assert.strictEqual(dup, steerA, "a repeated item is one steer");
});
