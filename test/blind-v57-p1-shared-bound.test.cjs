// Blind oracle, session-v57 phase 1: "one bounded error-body budget, three
// transports" (roadmap item 63, first string). Written BEFORE the fix, against
// the phase-1 contract only. Nothing in this file reads safeText, any bound
// constant, any throw statement, or any interpolation site. The three
// transports are driven only
// through their exported entry points and the config shapes those entry points
// declare.
//
// WHAT THIS FILE PINS, one row per falsification clause:
//   contract 1  every one of the three transports BOUNDS the body: a server
//               answering 500 with a 100,000-character body must produce an
//               error message inside 2048 characters. Pinned by the four
//               C1 rows: anthropic, cloud, ollama-generate, ollama-pull.
//   contract 2  the cut is ANNOUNCED: the same four C1 rows require an elision
//               word or ellipsis and a decimal run in the same message.
//   contract 3  the STATUS LINE survives the cut: the same four C1 rows require
//               500 to still be in the message.
//   contract 4  a SHORT body is not touched: the four C4 rows send a few dozen
//               characters and require the distinctive phrase verbatim and no
//               elision marker, on all three transports.
//   contract 5  the REASON PHRASE is bounded too: the four C5 rows answer with
//               a 6000-character HTTP reason phrase and a short body, and
//               require the message to stay inside 2048 characters, on all
//               three transports.
//   contract 6  the OLLAMA transport is unchanged: every row above is run on
//               BOTH ollama paths, generateInstruct and pullModel. Those eight
//               ollama rows are the before-and-after comparison; a red one is a
//               regression against v56, not a new claim.
//
// THE DRIVE IS BLACK BOX. Each row stands up a real loopback HTTP server that
// answers one status, one reason phrase and one body, points a transport at it,
// and reads the rejection. Ollama takes its endpoint as the `apiBase` param
// (generate) or the first argument (pull). Anthropic and Cloud are built by
// their factories, `makeAnthropicInstruct` and `makeCloudInstruct`, from the
// `baseUrl` + `apiKey` pair their exported config interfaces declare, and then
// called as an InstructGenerateFn.
//
// BINDINGS THE CONTRACT LEAVES OPEN, resolved and REPORTED:
//   * "THE WHOLE MESSAGE" (contract 1, 5). Bound to `err.message` on the thrown
//     Error, stringified. That is the string the contract says reaches a VS Code
//     notification. Nothing else on the error object is measured.
//   * "BOUNDED" (contract 1, 5). Bound to 2048 characters, the number the
//     contract itself names, applied to the whole message and not to the body
//     part alone. The oracle cannot see where the body ends, so it can only
//     measure the whole.
//   * "AN ELISION MARKER" (contract 2). The contract says match a family, not a
//     literal, so this is bound to two things present in the same message:
//     (a) an elision word or ellipsis, /elid|truncat|omitt|trimm|\bcut\b|
//     \bmore\b|\.\.\.|…/i, and (b) a decimal run of 4 or more digits, which at
//     this body size can only be a dropped-character count.
//   * KEEPING (b) HONEST (contract's own instruction). The 100KB body is a
//     single non-digit character, "x", so no digit can come from the body; and
//     the loopback base URL, which carries a 5-digit port, is replaced in the
//     message before (b) is scanned. The model name is "qwen3-coder:30b", whose
//     only digit runs are 1 and 2 long. On the short-body rows the literal 500
//     is removed before the negative digit scan, because the status code is
//     required to be there by contract 3.
//   * "THE STATUS LINE SURVIVES" (contract 3). Bound to: the message contains
//     the substring 500. The oracle cannot demand a particular status-line
//     wording without pinning the implementation's prose.
//   * "A SHORT BODY IS NOT TOUCHED" (contract 4). Bound to the precedent's own
//     short body, `{"error":"model qwen3-coder:30b not found, try pulling it
//     first"}`, and to the distinctive phrase "not found, try pulling it first"
//     surviving verbatim. The phrase is chosen so it survives whether a
//     transport interpolates the raw body or extracts the JSON error string:
//     it lives inside the string value either way.
//   * "A 6000-CHARACTER REASON PHRASE" (contract 5). Set with
//     `res.writeHead(500, phrase, headers)`. VERIFIED TRANSMITTED, not assumed:
//     a probe on this box (node v24.12.0) sent phrases of 100, 1000, 6000 and
//     20000 characters and undici's fetch surfaced every one of them intact in
//     `res.statusText`, at full length. Neither node nor undici caps or drops
//     it, so the 6000-character row genuinely fires and the instrument can
//     produce the case. If a future runtime clamps it, this row goes vacuous
//     and the number must be re-checked before the row is believed.
//   * THE STATUS USED. 500 everywhere, which is the only status the contract
//     names. No row uses 4xx, so no row can be answered by a client-side retry
//     or negotiation leg instead of the error path under test.
//   * OLLAMA'S PULL PATH SHAPE. `pullModel(apiBase, model, signal, onProgress)`
//     per its exported signature; onProgress is a no-op sink.
//
// EXPECTED TODAY (pre-fix), and this file is written to be RED:
//   RED   the anthropic and cloud rows for contracts 1, 2, 3 and 5: those two
//         transports bound nothing today.
//   GREEN the anthropic and cloud rows for contract 4: an unbounded message
//         already passes a short body through untouched.
//   GREEN the ollama C1 and C4 rows: v56 bounded that body already. A red one
//         is a regression, not a new claim.
//   UNKNOWN the ollama C5 rows: v56 bounded the BODY. The contract says the
//         reason phrase is a separate, unbounded server-controlled string, so
//         whether ollama already survives a 6000-character reason phrase is not
//         predictable from the contract. Whatever those two rows say is a fact
//         about today, reported either way.
//
// WHAT THE FIRST RUN ACTUALLY SAID (2026-08-21, pre-fix, 8 pass / 4 fail):
//   RED   C1 [anthropic] 102437 chars, C1 [cloud] 102433 chars.
//   RED   C5 [anthropic] 6081 chars, C5 [cloud] 6077 chars.
//   GREEN everything else, including all eight ollama rows.
//   The two UNKNOWN ollama C5 rows came back GREEN and NOT vacuously: a
//   black-box probe confirms ollama does interpolate the reason phrase (a short
//   distinctive phrase comes through in the message), and the 6000-character
//   one comes back cut with a marker inside a 451-character message. So v56's
//   bound already covers both server-controlled strings on the ollama arm, and
//   contract 5 is a genuine pass there rather than an absent leg.
//
// NOT TESTED, and why:
//   * The failure that arrives inside a 200-status stream (an `error` field in
//     the NDJSON body). The contract puts it out of scope for this phase.
//
// Run: node --test test/blind-v57-p1-shared-bound.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// The three transports, bundled from src/core with no vscode involved.
// ---------------------------------------------------------------------------

const core = bundleCore(
  "blind-v57-p1-core",
  `export { generateInstruct, pullModel } from "../src/core/ollama";\n` +
    `export { makeAnthropicInstruct } from "../src/core/anthropicInstruct";\n` +
    `export { makeCloudInstruct } from "../src/core/cloudInstruct";\n`,
);
const { generateInstruct, pullModel, makeAnthropicInstruct, makeCloudInstruct } = core.mod;

test.after(() => core.cleanup());

// ---------------------------------------------------------------------------
// The loopback server: answers every request with one status, one reason
// phrase and one body. `reason` undefined leaves node's default phrase.
// ---------------------------------------------------------------------------

function startServer({ status, body, contentType, reason }) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const headers = { "content-type": contentType || "text/plain" };
      if (reason === undefined) {
        res.writeHead(status, headers);
      } else {
        res.writeHead(status, reason, headers);
      }
      res.end(body);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

const MODEL = "qwen3-coder:30b";
const API_KEY = "sk-blind-oracle-not-a-real-key";

// 100KB of ONE non-digit character: nothing the body contributes can be
// mistaken for the dropped-character count.
const HUGE = "x".repeat(100 * 1024);
const HUGE_LEN = HUGE.length;

// A few dozen characters, the precedent's shape.
const SHORT = '{"error":"model qwen3-coder:30b not found, try pulling it first"}';
const SHORT_PHRASE = "not found, try pulling it first";

// 6000 characters of reason phrase, verified transmitted end to end.
const LONG_REASON = "R".repeat(6000);
const LONG_REASON_LEN = LONG_REASON.length;

const BOUND = 2048;

const ELISION_WORD = /elid|truncat|omitt|trimm|\bcut\b|\bmore\b|\.\.\.|…/i;
const CUT_COUNT = /\d{4,}/;

const strip = (msg, base) => String(msg).split(base).join("<base>");
const shown = (msg) =>
  msg.length > 400 ? `${msg.slice(0, 400)}... [${msg.length} chars total]` : msg;

// ---------------------------------------------------------------------------
// The four arms. Each stands up a server, drives one transport at it, and
// returns { base, err }.
// ---------------------------------------------------------------------------

const instructParams = (apiBase) => ({
  apiBase,
  model: MODEL,
  prompt: "write a function that adds two numbers",
  maxTokens: 64,
  temperature: 0.2,
  signal: new AbortController().signal,
});

async function capture(spec, drive) {
  const srv = await startServer(spec);
  try {
    await drive(srv.base);
    return { base: srv.base, err: undefined };
  } catch (err) {
    return { base: srv.base, err };
  } finally {
    srv.server.close();
  }
}

const ARMS = [
  {
    label: "ollama-generate",
    contentType: "application/json",
    drive: (base) => generateInstruct(instructParams(base)),
  },
  {
    label: "ollama-pull",
    contentType: "application/x-ndjson",
    drive: (base) => pullModel(base, MODEL, new AbortController().signal, () => {}),
  },
  {
    label: "anthropic",
    contentType: "application/json",
    drive: (base) => {
      const fn = makeAnthropicInstruct({ baseUrl: base, apiKey: API_KEY });
      return fn(instructParams(base));
    },
  },
  {
    label: "cloud",
    contentType: "application/json",
    drive: (base) => {
      const fn = makeCloudInstruct({ baseUrl: base, apiKey: API_KEY });
      return fn(instructParams(base));
    },
  },
];

function messageOf(label, cap) {
  assert.ok(
    cap.err,
    `${label}: a 500 must reject, so the oracle has a message to measure. The call resolved instead.`,
  );
  return String(cap.err && cap.err.message !== undefined ? cap.err.message : cap.err);
}

// ===========================================================================
// Contracts 1, 2, 3: a 100KB body is bounded, the cut is announced, the status
// survives. Contract 6 folds in: both ollama paths are arms here.
// ===========================================================================

for (const arm of ARMS) {
  test(`C1 [${arm.label}]: 500 with a 100KB body yields a message inside ${BOUND} chars, with an elision marker, status preserved`, async () => {
    const cap = await capture(
      { status: 500, body: HUGE, contentType: arm.contentType },
      arm.drive,
    );
    const msg = messageOf(arm.label, cap);
    const scan = strip(msg, cap.base);

    assert.ok(
      msg.length <= BOUND,
      `contract 1 (${arm.label}): "Every one of the three transports bounds the body. A server that answers 500 with a 100,000-character body must produce an error message that is small: an outside bound of ${BOUND} characters on the whole message". ` +
        `The message is ${msg.length} chars. Head: ${shown(msg)}`,
    );
    assert.ok(
      !msg.includes(HUGE),
      `contract 1 (${arm.label}): the whole ${HUGE_LEN}-character body is still inside the message verbatim.`,
    );
    assert.ok(
      ELISION_WORD.test(scan),
      `contract 2 (${arm.label}): "The cut is announced. A message whose body was cut carries an elision marker ... an elision word or ellipsis". None found. Got: ${shown(msg)}`,
    );
    assert.ok(
      CUT_COUNT.test(scan),
      `contract 2 (${arm.label}): "... and a decimal number" stating how many characters were dropped (~${HUGE_LEN} here), so a run of 4 or more digits must appear once the loopback base URL is replaced. None found. Got: ${shown(scan)}`,
    );
    assert.ok(
      /500/.test(msg),
      `contract 3 (${arm.label}): "The status line survives the cut. The message still names the status code (500)". No 500 in the message. Got: ${shown(msg)}`,
    );
  });
}

// ===========================================================================
// Contract 4: a short body is not touched. The bound must not mangle an
// ordinary "model not found" error.
// ===========================================================================

for (const arm of ARMS) {
  test(`C4 [${arm.label}]: a SHORT body reaches the message verbatim, with no elision marker`, async () => {
    const cap = await capture(
      { status: 500, body: SHORT, contentType: arm.contentType },
      arm.drive,
    );
    const msg = messageOf(arm.label, cap);
    const scan = strip(msg, cap.base);

    assert.ok(
      msg.includes(SHORT_PHRASE),
      `contract 4 (${arm.label}): "A body of a few dozen characters reaches the message verbatim ... The bound must not mangle an ordinary model-not-found error". The phrase ${JSON.stringify(SHORT_PHRASE)} is not in the message. Got: ${shown(msg)}`,
    );
    assert.ok(
      !ELISION_WORD.test(scan),
      `contract 4 (${arm.label}): "the message carries no elision marker". Nothing was cut, yet an elision word or ellipsis appears. Got: ${shown(msg)}`,
    );
    assert.ok(
      !CUT_COUNT.test(scan.replace(/500/g, "")),
      `contract 4 (${arm.label}): nothing was cut, so no dropped-character count may appear. Got: ${shown(scan)}`,
    );
  });
}

// ===========================================================================
// Contract 5: the reason phrase is bounded too. 6000 characters of HTTP reason
// phrase plus a short body must still land inside the bound.
// ===========================================================================

for (const arm of ARMS) {
  test(`C5 [${arm.label}]: a ${LONG_REASON_LEN}-char reason phrase with a short body still yields a message inside ${BOUND} chars`, async () => {
    const cap = await capture(
      { status: 500, body: SHORT, contentType: arm.contentType, reason: LONG_REASON },
      arm.drive,
    );
    const msg = messageOf(arm.label, cap);

    assert.ok(
      msg.length <= BOUND,
      `contract 5 (${arm.label}): "The reason phrase is bounded too, on all three. Node puts no ceiling on the HTTP reason phrase. A server answering with a ${LONG_REASON_LEN}-character reason phrase and a short body must still produce a message inside the ${BOUND}-character bound". ` +
        `The message is ${msg.length} chars. Head: ${shown(msg)}`,
    );
    assert.ok(
      !msg.includes(LONG_REASON),
      `contract 5 (${arm.label}): the whole ${LONG_REASON_LEN}-character reason phrase is still inside the message verbatim.`,
    );
  });
}
