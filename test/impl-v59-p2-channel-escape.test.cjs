// session-v59 phase 2: every channel line that carries server text renders as
// exactly one row (scraps S58-2 and S58-3, roadmap item 69's row-forgery half).
//
// THE INVARIANT, stated once and asserted the same way on every surface: one
// `log()` call is one channel row. `OutputChannel.appendLine` renders one row
// per line break, so a surface that interpolates server-controlled text without
// escaping the break set lets the server write its own rows, wearing the
// product's own tags. Phase 1 of session-v58 closed that for `channelBodyLine`
// and nothing else.
//
// THE MEASUREMENT TRAP THIS FILE REFUSES TO FALL INTO, and it is the more
// valuable half of S58-2. A test sink collects one array element per `log()`
// call; the real sink collects one row per break. A row asserting "exactly one
// evidence line" against an array of `log()` calls measures a different thing
// from what the user sees, and passes while the channel shows three. So every
// row here compares `lines.length` (the calls) against `rows.length` (what
// `appendLine` would render), and a forged product tag is planted in the body
// so a failure names the row the server wrote.
//
// REAL SOCKETS, not injected throws. The whole point is what a SERVER can do,
// so each surface is driven through a real `http` server answering a real
// status with a real break-bearing body, through the real transport.
//
// Run: node --test test/impl-v59-p2-channel-escape.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// The break set, built by code point. A raw U+2028 or U+2029 anywhere in a .cjs
// file - inside a comment included - makes the file fail to parse, because JS
// treats both as line terminators.
// ---------------------------------------------------------------------------

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const NEL = String.fromCharCode(0x0085);

const BREAKS = [
  ["LF", "\n"],
  ["CRLF", "\r\n"],
  ["bare CR", "\r"],
  ["U+2028", LS],
  ["U+2029", PS],
  ["U+0085 NEL", NEL],
];

/** What `OutputChannel.appendLine` would render, from what the sink collected.
 *  The pattern is built from escapes rather than written literally, for the
 *  parse reason in the header. */
const RENDER_BREAKS = new RegExp("\\r\\n|[\\n\\r\\u2028\\u2029\\u0085]");
const renderRows = (lines) => lines.flatMap((l) => String(l).split(RENDER_BREAKS));

/** JSON, with the three invisible separators named rather than emitted. */
const show = (s) =>
  JSON.stringify(s).split(LS).join("<U+2028>").split(PS).join("<U+2029>").split(NEL).join("<NEL>");

const core = bundleCore(
  "impl-v59-p2",
  `export { FnGenService } from "../src/core/fnGenService";\n` +
    `export { CompletionService } from "../src/core/completionService";\n` +
    `export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`,
);
const { FnGenService, CompletionService, DEFAULT_FIM_CONFIG } = core.mod;
test.after(() => core.cleanup());

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const plain = (status, body) => (_req, res) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
};

/** A 200 that streams ndjson lines and closes. */
const ndjson = (frames) => (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  res.end(frames.map((f) => JSON.stringify(f) + "\n").join(""));
};

/** A body that ends in a forged product row. The break in the middle is what
 *  the server is buying: without the escape it becomes a row of its own. */
const forgery = (brk, forged) => `{"error":{"message":"real"}}${brk}${forged}`;

/** The shared contract every surface here must hold.
 *
 *  TWO assertions, and the second is not the first restated. Row count catches
 *  any extra row; the forged-row check names WHAT the server wrote, so a
 *  failure reads as the attack it is rather than as an off-by-one. `forged` is
 *  the exact row the body tried to plant - matching the tag alone would match
 *  the product's own legitimate rows, which is a false red. */
function assertOneRowPerCall(lines, forged, where) {
  const rows = renderRows(lines);
  assert.strictEqual(
    rows.length,
    lines.length,
    `${where}: ${lines.length} log() call(s) rendered as ${rows.length} channel row(s). A server ` +
      `chose the difference. Rows: ${show(rows.join(" | "))}`,
  );
  assert.ok(
    !rows.some((r) => r.trim() === forged),
    `${where}: the server wrote the channel row ${show(forged)} itself, wearing one of the ` +
      `product's own tags. Rows: ${show(rows.join(" | "))}`,
  );
}

// ===========================================================================
// A. [fngen] request failed - src/core/fnGenService.ts
//
// SIX log calls carry this head; only ONE of them can carry server text. The
// other five interpolate a `msg` this repo authored (a truncation reject, a
// missing test module, a code-fence line, a missing requested function, an
// empty generation), and group D pins one of those as untouched. Escaping all
// six would have been a blanket wrap over five strings that cannot forge
// anything.
// ===========================================================================

const FNGEN_CFG = (base) => ({
  apiBase: base,
  model: "test-model",
  fallbackModel: "test-small",
  maxTokens: 64,
  testMaxTokens: 256,
  temperature: 0.2,
});

for (const [label, brk] of BREAKS) {
  test(`[fngen] a 500 body carrying ${label} cannot write its own channel row`, async () => {
    const FORGED = "[fngen] ttft=1ms total=2ms len=99";
    const srv = await serve(plain(500, forgery(brk, FORGED)));
    const lines = [];
    try {
      const svc = new FnGenService(FNGEN_CFG(srv.base), undefined, (l) => lines.push(String(l)));
      await assert.rejects(
        svc.generate({ signature: "fn add(a: i32, b: i32) -> i32", languageId: "rust" }),
        "precondition: the 500 reaches the service's catch",
      );
    } finally {
      await srv.close();
    }
    assert.ok(
      lines.some((l) => l.startsWith("[fngen] request failed:")),
      `precondition: the failure line was written. Got ${show(lines.join(" | "))}`,
    );
    assertOneRowPerCall(lines, FORGED, "[fngen] request failed");
  });
}

// ===========================================================================
// B. [fim] - src/core/completionService.ts
//
// THE ROW THAT FOUND A SITE NOBODY HAD NAMED. The work this file belongs to
// listed two `[fim] request failed` sites, the per-run catch and the method's
// outer catch. Driven through a real socket, an ollama 500 reaches neither
// pair: the per-run catch logs and aborts its own controller, so the outer
// catch reads the signal as aborted and falls through to `noGhost`, which
// interpolates the same thrown message under a THIRD head (`[fim] no ghost:`).
// That is where the forged row came out. A reading of the two named lines would
// have shipped with the hole open.
//
// `noGhost` is now escaped at the function rather than at that one caller: it is
// the choke point the shape is named for, and every other caller passes a
// constant the escape leaves untouched.
// ===========================================================================

for (const [label, brk] of BREAKS) {
  test(`[fim] a 500 body carrying ${label} cannot write its own channel row`, async () => {
    const FORGED = "[fim] ghost=served len=42";
    const srv = await serve(plain(500, forgery(brk, FORGED)));
    const lines = [];
    try {
      const svc = new CompletionService(
        { ...DEFAULT_FIM_CONFIG, apiBase: srv.base, debounceMs: 0 },
        undefined,
        (l) => lines.push(String(l)),
      );
      const out = await svc.complete({ prefix: "let total = ", suffix: ";\n", manual: true });
      assert.strictEqual(out, undefined, "precondition: a failed generation produces no ghost");
      svc.dispose();
    } finally {
      await srv.close();
    }
    assert.ok(
      lines.some((l) => l.startsWith("[fim] request failed:")),
      `precondition: the failure line was written. Got ${show(lines.join(" | "))}`,
    );
    assertOneRowPerCall(lines, FORGED, "[fim] request failed");
  });
}

// ===========================================================================
// C. [carve] pull failed - src/vscode/firstRun.ts
//
// The only surface here whose sink is a REAL OutputChannel in production. The
// real `offerModelPull`, the real `pullModel`, a real 500. The vscode stub
// pattern is lifted from test/adversarial-v58-p1.test.cjs, which needs the same
// three things the shared stub has none of: a ratified click, a progress host
// and a cancellation token.
// ===========================================================================

const VS_TAG = "impl-v59-p2-vs";
const vsStub = path.join(__dirname, `.${VS_TAG}.stub.cjs`);
const vsEntry = path.join(__dirname, `.${VS_TAG}.entry.ts`);
const vsOut = path.join(__dirname, `.${VS_TAG}.bundle.cjs`);
let VS = {};
let vsErr;
try {
  const { STUB_SOURCE } = require("./.vscode-stub.cjs");
  fs.writeFileSync(
    vsStub,
    `${STUB_SOURCE}
module.exports.ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
module.exports.window.showInformationMessage = async () => globalThis.__C80_INFO_ANSWER__;
module.exports.window.withProgress = async (_opts, task) =>
  task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
`,
  );
  fs.writeFileSync(vsEntry, `export { offerModelPull } from "../src/vscode/firstRun";\n`);
  esbuild.buildSync({
    entryPoints: [vsEntry],
    bundle: true,
    outfile: vsOut,
    format: "cjs",
    platform: "node",
    alias: { vscode: vsStub },
    external: [vsStub],
  });
  VS = require(vsOut);
} catch (e) {
  vsErr = e;
}
test.after(() => {
  for (const f of [vsStub, vsEntry, vsOut]) fs.rmSync(f, { force: true });
});

for (const [label, brk] of BREAKS) {
  test(`[carve] a 500 body carrying ${label} cannot write its own channel row`, async () => {
    if (vsErr) {
      assert.fail(`the vscode bundle did not build: ${vsErr}`);
    }
    const FORGED = "[carve] pull done model=evil ms=1";
    globalThis.__C80_INFO_ANSWER__ = "Download";
    globalThis.__C80_WARNINGS__ = [];
    const srv = await serve(plain(500, forgery(brk, FORGED)));
    const lines = [];
    const output = { appendLine: (l) => lines.push(String(l)), append() {}, show() {}, clear() {}, dispose() {} };
    try {
      const landed = await VS.offerModelPull(srv.base, "some-model", output, "the tier needs this model");
      assert.strictEqual(landed, false, "precondition: a failed pull reports the model as not landed");
    } finally {
      await srv.close();
      globalThis.__C80_INFO_ANSWER__ = undefined;
    }
    assert.ok(
      lines.some((l) => l.startsWith("[carve] pull failed")),
      `precondition: the failure line was written. Got ${show(lines.join(" | "))}`,
    );
    assertOneRowPerCall(lines, FORGED, "[carve] pull failed");
  });
}

// ===========================================================================
// D. The five product-authored `msg` sites stay byte-identical.
//
// The escape is applied where server text is interpolated, not at every line
// that shares the `[fngen] request failed` head. This row drives one of the
// five - the num_predict truncation reject - through a real 200 stream and pins
// the line whole. A blanket wrap would not change this string (there is nothing
// in it to escape), so what this row really guards is the reject's own wording,
// which fnGen.ts SERVICE_REJECT_TOASTS matches on.
// ===========================================================================

test("[fngen] a product-authored reject line is unchanged by the escape", async () => {
  const srv = await serve(
    ndjson([{ response: "fn add(a: i32, b: i32) -> i32 { a + b }" }, { done: true, done_reason: "length" }]),
  );
  const lines = [];
  try {
    const svc = new FnGenService(FNGEN_CFG(srv.base), undefined, (l) => lines.push(String(l)));
    await assert.rejects(svc.generate({ signature: "fn add(a: i32, b: i32) -> i32", languageId: "rust" }));
  } finally {
    await srv.close();
  }
  assert.ok(
    lines.includes("[fngen] request failed: generation truncated at num_predict=64 (done_reason=length)"),
    `the truncation reject's line must be byte-identical: ${show(lines.join(" | "))}`,
  );
});
