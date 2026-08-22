// session-v59 phase 2 fix round: the accept/reject ACCOUNTING line, the pull
// progress phrase, and the one-line claim in `providerReason`'s docblock.
//
// Phase 2 escaped every channel line it could find that interpolates server
// text and counted three local first-line cutters. There is a fourth,
// `firstOfferedLine` in `src/core/fnGenService.ts`, and it feeds
// `[fngen] outcome=...`. That line is not a diagnostic: it is the accept/reject
// ACCOUNTING every capture and every rig run counts. A model that can plant
// `[fngen] outcome=accept` in its own generated body inflates the accept rate
// of every measurement this repo takes.
//
// REAL SOCKETS, and for this file that is the whole claim. Handing
// `firstOfferedLine` a crafted string proves a string function splits on the
// wrong set; driving a real ndjson 200 whose `response` carries the break
// proves a MODEL can do it, through the real postprocess, on the real path
// `src/vscode/fnGen.ts` takes to `logOutcome`.
//
// Run: node --test test/impl-v59-p2fix-outcome-row.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
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

/** What `OutputChannel.appendLine` would render, from what the sink collected. */
const RENDER_BREAKS = new RegExp("\\r\\n|[\\n\\r\\u2028\\u2029\\u0085]");
const renderRows = (lines) => lines.flatMap((l) => String(l).split(RENDER_BREAKS));

/** JSON, with the three invisible separators named rather than emitted. */
const show = (s) =>
  JSON.stringify(s).split(LS).join("<U+2028>").split(PS).join("<U+2029>").split(NEL).join("<NEL>");

const core = bundleCore(
  "impl-v59-p2fix",
  `export { FnGenService } from "../src/core/fnGenService";\n` +
    `export { pullModel } from "../src/core/ollama";\n` +
    `export { providerReason, escapeBreaks } from "../src/core/errorBound";\n`,
);
const { FnGenService, pullModel, providerReason, escapeBreaks } = core.mod;
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

/** A 200 that streams ndjson lines and closes. */
const ndjson = (frames) => (_req, res) => {
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  res.end(frames.map((f) => JSON.stringify(f) + "\n").join(""));
};

// ===========================================================================
// A. [fngen] outcome=... - the accept/reject accounting line.
//
// The forged row is `[fngen] outcome=accept`, chosen because it is the exact
// token the rig and the capture triage count. Row count catches any extra row;
// the forged-row check names WHAT the model wrote, so a failure reads as the
// attack it is.
//
// THE FORGED ROW SITS INSIDE THE FUNCTION BODY, and the first cut of this file
// had it trailing the closing brace instead. Driven, that shape cannot produce
// the case for LF or CRLF: the postprocess drops everything after the function
// it extracted, so the offered text never carried the break and the row was
// asserting a fact about the postprocess. Inside the body the break survives
// into `offered` on all six, which is what makes the table one instrument
// rather than four live rows and two vacuous ones. LF and CRLF stay green
// throughout - the cut on `"\n"` already defended those two, and their rows are
// here to keep it that way.
//
// THE PRECONDITION IS ABOUT RENDER ROWS, NOT ABOUT THE BYTES SENT, for the
// CRLF row: the postprocess normalises the model's CRLF to LF, so the offered
// text never holds the exact two characters the server wrote. What has to be
// true for the row to mean anything is that the offered text still spans more
// than one channel row and still carries the forged token - which it does.
// ===========================================================================

const FNGEN_CFG = (base) => ({
  apiBase: base,
  model: "test-model",
  fallbackModel: "test-small",
  maxTokens: 64,
  testMaxTokens: 256,
  temperature: 0.2,
});

const FORGED_OUTCOME = "[fngen] outcome=accept";

for (const [label, brk] of BREAKS) {
  test(`[fngen] outcome: a generated body carrying ${label} cannot write its own accounting row`, async () => {
    const generated = `fn add(a: i32, b: i32) -> i32 {${brk}${FORGED_OUTCOME}${brk}    a + b${brk}}`;
    const srv = await serve(ndjson([{ response: generated }, { done: true }]));
    const lines = [];
    let offered;
    try {
      const svc = new FnGenService(FNGEN_CFG(srv.base), undefined, (l) => lines.push(String(l)));
      const out = await svc.generate({ signature: "fn add(a: i32, b: i32) -> i32", languageId: "rust" });
      offered = out.text;
      // The generation's own log lines are not the surface under test; the
      // accounting line is. Drop them so a row count means one thing.
      lines.length = 0;
      svc.logOutcome("reject", { refusedBy: "human-gesture", offered });
    } finally {
      await srv.close();
    }
    assert.ok(
      renderRows([offered]).length > 1 && offered.includes(FORGED_OUTCOME),
      `PRECONDITION: the model's ${label} must reach the offered text as a RENDER break carrying ` +
        `its forged row, or this row measures the postprocess and not the accounting line. ` +
        `Offered: ${show(offered)}`,
    );
    assert.strictEqual(lines.length, 1, `precondition: one log() call. Got ${show(lines.join(" | "))}`);
    const rows = renderRows(lines);
    assert.strictEqual(
      rows.length,
      lines.length,
      `[fngen] outcome: ${lines.length} log() call(s) rendered as ${rows.length} channel row(s). ` +
        `The MODEL chose the difference. Rows: ${show(rows.join(" | "))}`,
    );
    assert.ok(
      !rows.some((r) => r.trim() === FORGED_OUTCOME),
      `[fngen] outcome: the model wrote the accounting row ${show(FORGED_OUTCOME)} itself, which ` +
        `inflates the accept count of every capture and rig run. Rows: ${show(rows.join(" | "))}`,
    );
  });
}

test("[fngen] outcome: the reject line still carries the offered signature", async () => {
  const lines = [];
  const svc = new FnGenService(FNGEN_CFG("http://127.0.0.1:1"), undefined, (l) => lines.push(String(l)));
  svc.logOutcome("reject", { refusedBy: "human-gesture", offered: "\r\n  fn add(a: i32) -> i32\r\nbody" });
  assert.strictEqual(lines[0], "[fngen] outcome=reject refused-by=human-gesture offered=fn add(a: i32) -> i32");
});

// ===========================================================================
// B. The pull's STATUS phrase - src/core/ollama.ts.
//
// `String(evt.status)` on a JSON.parse product THROWS: `{"toString":1}` gives
// ToPrimitive a non-callable `toString`, it falls to `Object.prototype.valueOf`,
// gets an object back and raises. The throw escapes `handleLine`, the read
// loop, `pullModel` and the `withProgress` callback into `offerModelPull`'s
// catch carrying no marker the translation table can classify - the exact
// outcome the sibling `evt.error` fix closed four lines up.
//
// MID-PULL, not at the first frame, because the fault the user meets is a
// download that dies after it started.
// ===========================================================================

const PULL_STATUS_SHAPES = [
  ["a non-callable toString", { toString: 1 }, '{"toString":1}'],
  ["a nested message", { message: "pulling manifest" }, '{"message":"pulling manifest"}'],
  ["an array", ["pulling", "manifest"], '["pulling","manifest"]'],
  ["a number", 7, "7"],
];

for (const [label, status, rendered] of PULL_STATUS_SHAPES) {
  test(`pull progress: a STATUS phrase that is ${label} neither crashes nor renders a placeholder`, async () => {
    const phrases = [];
    const srv = await serve(
      ndjson([{ status: "pulling manifest" }, { status }, { status: "verifying sha256 digest" }, { status: "success" }]),
    );
    try {
      await pullModel(srv.base, "some-model", new AbortController().signal, (_f, s) => phrases.push(s));
    } finally {
      await srv.close();
    }
    assert.deepStrictEqual(phrases, ["pulling manifest", rendered, "verifying sha256 digest", "success"], phrases.join(" | "));
  });
}

test("pull progress: an absent status is still the empty phrase", async () => {
  const phrases = [];
  const srv = await serve(ndjson([{ digest: "sha256:aa", total: 100, completed: 50 }, { status: "success" }]));
  try {
    await pullModel(srv.base, "some-model", new AbortController().signal, (_f, s) => phrases.push(s));
  } finally {
    await srv.close();
  }
  assert.deepStrictEqual(phrases, ["", "success"]);
});

// ===========================================================================
// C. `providerReason`'s JSON fallback is NOT one line.
//
// The docblock said it is, on the ground that `JSON.stringify` escapes line
// breaks. It escapes LF and CR and leaves U+2028, U+2029 and NEL alone. No row
// is forged today because every consumer escapes or cuts on the full five-break
// set - the WRITTEN INVARIANT is what was wrong, and it is the sentence a
// future caller relaxes on.
// ===========================================================================

test("providerReason's JSON fallback carries the separators JSON.stringify does not escape", () => {
  const reason = providerReason({ detail: `a${LS}b${PS}c${NEL}d` });
  assert.strictEqual(renderRows([reason]).length, 4, `expected four rendered rows from ${show(reason)}`);
  assert.strictEqual(renderRows([escapeBreaks(reason)]).length, 1, "the sink's escape is what makes it one row");
});

test("providerReason's LF and CR really are escaped by JSON.stringify", () => {
  const reason = providerReason({ detail: "a\nb\rc" });
  assert.strictEqual(renderRows([reason]).length, 1);
});
