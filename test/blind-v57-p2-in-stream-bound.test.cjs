// Blind oracle, session-v57 phase 2: "the failure that arrives inside a 200"
// (roadmap item 63, first string). Contract: session-v57/contract-phase2.md,
// including the AMENDED note at its top that adds the Anthropic SSE site.
// Written BEFORE the fix, against the contract only. Nothing in this file reads
// a throw statement, boundBody, safeText, rawText, src/core/errorBound.ts, or
// any function body. Only exported signatures and the wire-format event
// interfaces were read, because the oracle has to write the bytes on the wire.
//
// WHAT THIS FILE PINS, one row per falsification clause:
//   contract 1  the GENERATE path bounds an in-stream error: a 200-status
//               NDJSON stream whose line carries a 100,000-character `error`
//               field must throw a message inside 2048 characters with an
//               elision marker and a dropped-character count. Pinned by row
//               C1 [ollama-generate].
//   contract 2  the PULL path does the same for its own in-stream `error`
//               field. Pinned by row C2 [ollama-pull].
//   contract 3  the PROGRESS string is bounded: a 200-status pull stream whose
//               `status` field is 100,000 characters hands onProgress a string
//               inside 2048 characters with the same marker. Pinned by row
//               C3 [ollama-pull-status].
//   contract 4  a SHORT `error` and a SHORT `status` are untouched: three rows,
//               C4 [ollama-generate], C4 [ollama-pull] and C4
//               [ollama-pull-status], require the ordinary sentence verbatim
//               and no elision marker anywhere in it.
//   contract 5  the ANTHROPIC transport's in-stream SSE `error` frame is
//               bounded too: a 100,000-character message on that frame throws
//               inside 2048 characters with the same marker. Pinned by row
//               C5 [anthropic].
//   contract 6  the four in-200 sites land on the SAME budget and the same
//               marker wording as each other. Pinned by row C6 [four sites
//               agree]. A second row, C6b [in-200 matches HTTP], carries the
//               clause's own sentence "the bound is the same one the HTTP error
//               bodies get" out to the phase-1 site: the same 100KB string sent
//               as a 500 body must survive to exactly the same length.
//   (fires probes, not contract clauses) three rows named FIRES exist only to
//               prove the instrument can produce the case at all. They send a
//               SHORT distinctive string on each of the three paths the
//               contract does not already give a short row to, and require it
//               to reach the caller. A vacuous bound row - one that passes
//               because the server's text was swallowed and never reached
//               anyone - is caught by these, not hidden by them.
//
// THE DRIVE IS BLACK BOX. Every row stands up a real loopback HTTP server that
// answers 200 and writes the stream bytes itself, then points one exported
// entry point at it and reads what came back. `generateInstruct` and
// `pullModel` take the endpoint as `apiBase` / the first argument.
// `makeAnthropicInstruct` is built from the `baseUrl` + `apiKey` pair its
// exported config interface declares and then called as an InstructGenerateFn.
// The server answers every path, so no route knowledge is needed.
//
// BINDINGS THE CONTRACT LEAVES OPEN, resolved and REPORTED:
//   * "THE WHOLE MESSAGE" (contracts 1, 2, 5). Bound to `err.message` on the
//     thrown Error, stringified. Nothing else on the error object is measured.
//   * "THE STRING HANDED TO onProgress" (contract 3). `pullModel`'s exported
//     signature is `(apiBase, model, signal, onProgress)` with
//     `onProgress: (fraction: number | undefined, status: string) => void`, so
//     the SECOND argument is the status string. Every call is recorded and the
//     longest recorded status is the one measured: the oracle cannot know how
//     many times the product chooses to report, only that no reported string
//     may be 100KB wide.
//   * "BOUNDED" (contracts 1, 2, 3, 5). Bound to 2048 characters, the number
//     the contract itself names, applied to the whole message / the whole
//     status string. The oracle cannot see where the server's part ends, so it
//     can only measure the whole.
//   * "AN ELISION MARKER" (all bound clauses). The contract says match a
//     family, not a literal, so this is bound to two things present in the same
//     string: (a) an elision word or ellipsis,
//     /elid|truncat|omitt|trimm|\bcut\b|\bmore\b|\.\.\.|…/i, and (b) a decimal
//     run of 4 or more digits, which at this size can only be a
//     dropped-character count.
//   * KEEPING (b) HONEST (the contract's own instruction, phase 1's
//     discipline). The 100KB payload is a single non-digit character, "x", so
//     no digit can come from it; the loopback base URL, which carries a 5-digit
//     port, is replaced before any digit scan; the model name is
//     "qwen3-coder:30b", whose only digit runs are 1 and 2 long. No row here
//     sends an HTTP error status, so unlike phase 1 there is no status code to
//     exempt from the negative scan.
//   * "THE SAME CUT LENGTH" (contract 6). The oracle is forbidden the number,
//     so the sites are compared against each other on two observables, both
//     derived from the same 100KB payload: (a) the length of the longest
//     surviving run of "x", which is exactly how much of the server's string
//     was kept, and (b) the set of 4-or-more-digit runs left once that x-run is
//     removed, which is the announced drop count. Equal on both means the same
//     budget and the same arithmetic. The marker WORDING is compared as the
//     matched elision word itself, lowercased, because the surrounding prose
//     legitimately differs per site ("pull failed" is not "generate failed").
//   * THE WIRE SHAPES. Ollama NDJSON is one JSON object per line terminated by
//     "\n", per the exported `PullEvent` and the generate path's stream event
//     declaration (`response`, `error`, `done`, `done_reason`). Anthropic is
//     SSE, "data: {json}\n\n", per the `AnthropicEvent` declaration, whose
//     error frame is `{ type: "error", error: { type, message } }`. Content
//     types: application/x-ndjson for both ollama rows, text/event-stream for
//     anthropic.
//   * THE STATUS IS ALWAYS 200. That is the whole point of this phase, and it
//     also means no row can be answered by an HTTP error leg instead of the
//     in-stream leg under test.
//   * THE STREAM IS WRITTEN AND CLOSED IMMEDIATELY. Ollama's generate path
//     documents a bound on SILENCE; a row that sat idle could be answered by
//     that watchdog instead of by the error field. Every row writes its bytes
//     in the first tick and ends the response, so a timeout cannot masquerade
//     as the case under test.
//   * SHORT VALUES (contract 4). "model requires more system memory" for the
//     error field and "pulling manifest" for the status field, the two the
//     contract names by hand. The generate row and the pull row differ only in
//     which entry point reads them.
//   * THE PHRASE EXEMPTION (contract 4). The contract's own example sentence
//     contains the word "more", which is a member of the elision family above.
//     So on the C4 rows the verbatim phrase is removed from the string before
//     the negative marker scan, the same exemption discipline phase 1 used for
//     the status code it required to be present. A marker is the product's own
//     words, so it must still be visible once the server's are taken out. The
//     first draft of this file did not do that and both C4 error rows failed on
//     the server's own sentence: reported because it is also a caution for the
//     fix, a marker worded around "more" is indistinguishable from an ordinary
//     ollama error that says "requires more system memory".
//
// EXPECTED TODAY (pre-fix), and this file is written to be RED:
//   RED   C1, C2, C3, C5, and both C6 rows: nothing on the in-200 paths is
//         bounded yet, so the 100KB is expected to arrive whole, and two sites
//         that both fail to cut cannot be compared for an equal cut.
//   GREEN the three C4 rows and the three FIRES rows: an unbounded path already
//         passes a short value through untouched, and already delivers the
//         server's text to the caller.
//   A RED C4 or FIRES row means something worse than an unfixed bound: either
//         the path never delivers the server's string at all, in which case
//         every bound row above it is vacuous, or the fix mangles ordinary
//         errors.
//
// WHAT THE FIRST RUN ACTUALLY SAID (2026-08-21, pre-fix, 6 pass / 6 fail):
//   RED   C1 [ollama-generate] 100014 chars, prefixed "Ollama error: " and then
//         the whole payload. C2 [ollama-pull] 100000 chars, the payload bare,
//         with no prose of its own at all. C3 [ollama-pull-status] 100000 chars
//         handed straight to onProgress. C5 [anthropic] 100024 chars, prefixed
//         "Anthropic stream error: ". Nothing on any of the four in-200 sites
//         cuts anything today, which is exactly what the phase claims.
//   RED   C6 [four sites agree] and C6b [in-200 matches HTTP], for the right
//         reason each. C6 failed on its own anti-vacuity guard: the four sites
//         DO agree, at 100000 characters kept, and agreeing on being unbounded
//         is not agreeing on a budget. C6b measured the phase-1 leg live and
//         found it in force: the same payload sent as a 500 body came back with
//         400 characters of it kept, against 100000 through the 200. So the
//         comparison in that row is anchored to a real cut, not to another
//         unbounded site.
//   GREEN all three FIRES probes and all three C4 rows. Every one of the four
//         sites genuinely delivers the server's own string to the caller, so no
//         bound row above is vacuous, and a short value is untouched today.
//
// Run: node --test test/blind-v57-p2-in-stream-bound.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { bundleCore } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// The transports, bundled from src/core with no vscode involved.
// ---------------------------------------------------------------------------

const core = bundleCore(
  "blind-v57-p2-core",
  `export { generateInstruct, pullModel } from "../src/core/ollama";\n` +
    `export { makeAnthropicInstruct } from "../src/core/anthropicInstruct";\n`,
);
const { generateInstruct, pullModel, makeAnthropicInstruct } = core.mod;

test.after(() => core.cleanup());

// ---------------------------------------------------------------------------
// The loopback server. Answers 200 on every path and writes the given chunks
// in order, then ends. `status` lets the C6b row reuse it for a 500 body.
// ---------------------------------------------------------------------------

function startServer({ chunks, contentType, status }) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(status || 200, { "content-type": contentType });
      for (const chunk of chunks) {
        res.write(chunk);
      }
      res.end();
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

// 100KB of ONE non-digit character: nothing the payload contributes can be
// mistaken for the dropped-character count, and the surviving run of it is
// exactly how much of the server's string was kept.
const HUGE = "x".repeat(100000);
const HUGE_LEN = HUGE.length;

const SHORT_ERROR = "model requires more system memory";
const SHORT_STATUS = "pulling manifest";

const BOUND = 2048;

const ELISION_WORD = /elid|truncat|omitt|trimm|\bcut\b|\bmore\b|\.\.\.|…/i;
const CUT_COUNT = /\d{4,}/;

const ndjson = (obj) => `${JSON.stringify(obj)}\n`;
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

const strip = (s, base) => String(s).split(base).join("<base>");
const shown = (s) =>
  s.length > 400 ? `${s.slice(0, 400)}... [${s.length} chars total]` : s;

/** How much of the 100KB payload survived: the longest run of "x". */
const keptRun = (s) => {
  const runs = String(s).match(/x+/g);
  return runs ? Math.max(...runs.map((r) => r.length)) : 0;
};

/** The announced drop counts, with the payload's own run taken out first. */
const countsIn = (s, base) =>
  (strip(s, base).replace(/x+/g, "").match(/\d{4,}/g) || []).sort();

/** The marker word actually used, for the same-wording comparison. */
const markerWord = (s, base) => {
  const m = ELISION_WORD.exec(strip(s, base));
  return m ? m[0].toLowerCase() : undefined;
};

// ---------------------------------------------------------------------------
// The four in-200 sites, plus the phase-1 HTTP site for the C6b comparison.
// Each returns { base, err, statuses }.
// ---------------------------------------------------------------------------

const instructParams = (apiBase) => ({
  apiBase,
  model: MODEL,
  prompt: "write a function that adds two numbers",
  maxTokens: 64,
  temperature: 0.2,
  signal: new AbortController().signal,
});

async function run(spec, drive) {
  const srv = await startServer(spec);
  const statuses = [];
  try {
    await drive(srv.base, statuses);
    return { base: srv.base, err: undefined, statuses };
  } catch (err) {
    return { base: srv.base, err, statuses };
  } finally {
    srv.server.close();
  }
}

/** Generate path, 200 NDJSON, one line carrying `error`. */
const generateError = (value) =>
  run(
    { chunks: [ndjson({ error: value })], contentType: "application/x-ndjson" },
    (base) => generateInstruct(instructParams(base)),
  );

/** Pull path, 200 NDJSON, one line carrying `error`. */
const pullError = (value) =>
  run(
    { chunks: [ndjson({ error: value })], contentType: "application/x-ndjson" },
    (base, statuses) =>
      pullModel(base, MODEL, new AbortController().signal, (_f, s) => statuses.push(String(s))),
  );

/** Pull path, 200 NDJSON, a progress line carrying `status`, then success. */
const pullStatus = (value) =>
  run(
    {
      chunks: [ndjson({ status: value }), ndjson({ status: "success" })],
      contentType: "application/x-ndjson",
    },
    (base, statuses) =>
      pullModel(base, MODEL, new AbortController().signal, (_f, s) => statuses.push(String(s))),
  );

/** Anthropic path, 200 SSE, one `error` frame. */
const anthropicError = (value) =>
  run(
    {
      chunks: [sse({ type: "error", error: { type: "overloaded_error", message: value } })],
      contentType: "text/event-stream",
    },
    (base) => makeAnthropicInstruct({ baseUrl: base, apiKey: API_KEY })(instructParams(base)),
  );

/** Phase 1's site, for C6b only: the same payload as a 500 HTTP body. */
const httpBody = (value) =>
  run(
    { chunks: [value], contentType: "application/json", status: 500 },
    (base) => generateInstruct(instructParams(base)),
  );

function messageOf(label, cap) {
  assert.ok(
    cap.err,
    `${label}: the server put a failure inside the 200, so the call must reject and give the oracle a message to measure. It RESOLVED instead. Every bound row on this path is vacuous until that is explained.`,
  );
  return String(cap.err && cap.err.message !== undefined ? cap.err.message : cap.err);
}

function longestStatus(label, cap) {
  assert.ok(
    cap.statuses.length > 0,
    `${label}: onProgress was never called, so no status string reached the caller and the bound row on this path is vacuous.`,
  );
  return cap.statuses.reduce((a, b) => (b.length > a.length ? b : a));
}

/** The shared assertion behind contracts 1, 2, 3 and 5. */
function assertBounded(clause, label, value, base) {
  const scan = strip(value, base);
  assert.ok(
    value.length <= BOUND,
    `${clause} (${label}): a 200-status stream carrying a ${HUGE_LEN}-character value must reach the caller as at most ${BOUND} characters. It is ${value.length} chars. Head: ${shown(value)}`,
  );
  assert.ok(
    !value.includes(HUGE),
    `${clause} (${label}): the whole ${HUGE_LEN}-character value is still there verbatim.`,
  );
  assert.ok(
    ELISION_WORD.test(scan),
    `${clause} (${label}): the cut must carry "an elision marker". No elision word or ellipsis found. Got: ${shown(value)}`,
  );
  assert.ok(
    CUT_COUNT.test(scan),
    `${clause} (${label}): the marker must carry "a decimal count of what was dropped" (~${HUGE_LEN} here), so a run of 4 or more digits must appear once the loopback base URL is replaced. None found. Got: ${shown(scan)}`,
  );
}

/** The shared assertion behind contract 4. The verbatim phrase is REMOVED
 *  before the negative scan, the same exemption discipline phase 1 used for the
 *  status code: the contract's own example sentence, "model requires more
 *  system memory", contains the word "more", which is a member of the elision
 *  family. A marker has to be the product's own words, so it must still be
 *  visible once the server's words are taken out. */
function assertUntouched(label, value, base, phrase) {
  const scan = strip(value, base).split(phrase).join("");
  assert.ok(
    value.includes(phrase),
    `contract 4 (${label}): "A short error and a short status are untouched. Each reaches the caller verbatim with no elision marker." ${JSON.stringify(phrase)} is not there. Got: ${shown(value)}`,
  );
  assert.ok(
    !ELISION_WORD.test(scan),
    `contract 4 (${label}): nothing was long enough to cut, yet an elision word or ellipsis appears. Got: ${shown(value)}`,
  );
  assert.ok(
    !CUT_COUNT.test(scan),
    `contract 4 (${label}): nothing was cut, so no dropped-character count may appear. Got: ${shown(scan)}`,
  );
}

// ===========================================================================
// FIRES probes. Not contract clauses. They exist so that no bound row below can
// pass or fail for the wrong reason: each one proves the server's own text
// travels this path and reaches the caller at all.
// ===========================================================================

test("FIRES [ollama-generate]: an in-stream error on a 200 rejects, and the server's own words reach the caller", async () => {
  const cap = await generateError(SHORT_ERROR);
  const msg = messageOf("FIRES ollama-generate", cap);
  assert.ok(
    msg.includes(SHORT_ERROR),
    `INSTRUMENT: the generate path rejected but the server's error text is not in the message, so contract 1's row cannot observe the server's string. Got: ${shown(msg)}`,
  );
});

test("FIRES [ollama-pull]: an in-stream error on a 200 rejects, and the server's own words reach the caller", async () => {
  const cap = await pullError(SHORT_ERROR);
  const msg = messageOf("FIRES ollama-pull", cap);
  assert.ok(
    msg.includes(SHORT_ERROR),
    `INSTRUMENT: the pull path rejected but the server's error text is not in the message, so contract 2's row cannot observe the server's string. Got: ${shown(msg)}`,
  );
});

test("FIRES [anthropic]: an in-stream SSE error frame on a 200 rejects, and the server's own words reach the caller", async () => {
  const cap = await anthropicError(SHORT_ERROR);
  const msg = messageOf("FIRES anthropic", cap);
  assert.ok(
    msg.includes(SHORT_ERROR),
    `INSTRUMENT: the anthropic path rejected but the frame's message text is not in the error, so contract 5's row cannot observe the server's string. Got: ${shown(msg)}`,
  );
});

// ===========================================================================
// Contract 1: the generate path bounds an in-stream error.
// ===========================================================================

test(`C1 [ollama-generate]: a 200 NDJSON stream with a ${HUGE_LEN}-char error field throws inside ${BOUND} chars, with an elision marker`, async () => {
  const cap = await generateError(HUGE);
  const msg = messageOf("C1 ollama-generate", cap);
  assertBounded("contract 1", "ollama-generate", msg, cap.base);
});

// ===========================================================================
// Contract 2: the pull path bounds its own in-stream error.
// ===========================================================================

test(`C2 [ollama-pull]: a 200 NDJSON pull stream with a ${HUGE_LEN}-char error field throws inside ${BOUND} chars, with an elision marker`, async () => {
  const cap = await pullError(HUGE);
  const msg = messageOf("C2 ollama-pull", cap);
  assertBounded("contract 2", "ollama-pull", msg, cap.base);
});

// ===========================================================================
// Contract 3: the progress string is bounded.
// ===========================================================================

test(`C3 [ollama-pull-status]: a 200 NDJSON pull stream with a ${HUGE_LEN}-char status field hands onProgress at most ${BOUND} chars, with an elision marker`, async () => {
  const cap = await pullStatus(HUGE);
  assert.ok(
    !cap.err,
    `C3 ollama-pull-status: the stream carries only progress lines and a success line, so the pull must not reject. It threw: ${shown(String(cap.err && cap.err.message))}`,
  );
  const status = longestStatus("C3 ollama-pull-status", cap);
  assertBounded("contract 3", "ollama-pull-status", status, cap.base);
});

// ===========================================================================
// Contract 4: a short error and a short status are untouched.
// ===========================================================================

test("C4 [ollama-generate]: a short in-stream error reaches the caller verbatim, with no elision marker", async () => {
  const cap = await generateError(SHORT_ERROR);
  const msg = messageOf("C4 ollama-generate", cap);
  assertUntouched("ollama-generate", msg, cap.base, SHORT_ERROR);
});

test("C4 [ollama-pull]: a short in-stream error reaches the caller verbatim, with no elision marker", async () => {
  const cap = await pullError(SHORT_ERROR);
  const msg = messageOf("C4 ollama-pull", cap);
  assertUntouched("ollama-pull", msg, cap.base, SHORT_ERROR);
});

test("C4 [ollama-pull-status]: a short status reaches onProgress verbatim, with no elision marker", async () => {
  const cap = await pullStatus(SHORT_STATUS);
  assert.ok(
    !cap.err,
    `C4 ollama-pull-status: an ordinary progress stream must not reject. It threw: ${shown(String(cap.err && cap.err.message))}`,
  );
  assert.ok(
    cap.statuses.includes(SHORT_STATUS),
    `contract 4 (ollama-pull-status): "The bound must not mangle ... an ordinary 'pulling manifest' progress line." onProgress never received ${JSON.stringify(SHORT_STATUS)}. It received: ${shown(JSON.stringify(cap.statuses))}`,
  );
  assertUntouched("ollama-pull-status", SHORT_STATUS, cap.base, SHORT_STATUS);
});

// ===========================================================================
// Contract 5: the Anthropic transport's in-stream SSE error frame.
// ===========================================================================

test(`C5 [anthropic]: a 200 SSE stream with a ${HUGE_LEN}-char error frame message throws inside ${BOUND} chars, with an elision marker`, async () => {
  const cap = await anthropicError(HUGE);
  const msg = messageOf("C5 anthropic", cap);
  assertBounded("contract 5", "anthropic", msg, cap.base);
});

// ===========================================================================
// Contract 6: the four in-200 sites agree with each other, and with the HTTP
// error body phase 1 already bound.
// ===========================================================================

test("C6 [four sites agree]: all four in-200 sites keep the same amount of the payload, announce the same count, and use the same marker word", async () => {
  const gen = await generateError(HUGE);
  const pull = await pullError(HUGE);
  const prog = await pullStatus(HUGE);
  const anth = await anthropicError(HUGE);

  const sites = [
    { label: "ollama-generate", value: messageOf("C6 ollama-generate", gen), base: gen.base },
    { label: "ollama-pull", value: messageOf("C6 ollama-pull", pull), base: pull.base },
    {
      label: "ollama-pull-status",
      value: longestStatus("C6 ollama-pull-status", prog),
      base: prog.base,
    },
    { label: "anthropic", value: messageOf("C6 anthropic", anth), base: anth.base },
  ];

  const kept = sites.map((s) => ({ label: s.label, n: keptRun(s.value) }));
  const shape = (list) => list.map((k) => `${k.label}=${k.n}`).join(", ");
  assert.ok(
    kept.every((k) => k.n === kept[0].n),
    `contract 6: "A caller cannot tell, from the size of the result, whether a failure arrived as an HTTP error status or inside a 200 ... these sites must land on the same budget." The amount of the ${HUGE_LEN}-character payload each site kept differs: ${shape(kept)}`,
  );
  assert.ok(
    kept[0].n < HUGE_LEN,
    `contract 6: every site kept the whole ${HUGE_LEN}-character payload, so they agree only because none of them cuts. That is agreement on being unbounded, not on a budget.`,
  );

  const counts = sites.map((s) => ({ label: s.label, c: countsIn(s.value, s.base).join("|") }));
  assert.ok(
    counts.every((c) => c.c === counts[0].c),
    `contract 6: the announced dropped-character counts differ between sites: ${counts.map((c) => `${c.label}=[${c.c}]`).join(", ")}`,
  );

  const words = sites.map((s) => ({ label: s.label, w: markerWord(s.value, s.base) }));
  assert.ok(
    words.every((w) => w.w !== undefined && w.w === words[0].w),
    `contract 6: "the same marker wording". The elision word differs between sites: ${words.map((w) => `${w.label}=${w.w}`).join(", ")}`,
  );
});

test("C6b [in-200 matches HTTP]: an in-200 failure keeps exactly as much of the payload as the same payload sent as an HTTP error body", async () => {
  const http500 = await httpBody(HUGE);
  const inStream = await generateError(HUGE);

  const httpMsg = messageOf("C6b http-500-body", http500);
  const streamMsg = messageOf("C6b ollama-generate-in-200", inStream);

  const a = keptRun(httpMsg);
  const b = keptRun(streamMsg);
  assert.ok(
    a < HUGE_LEN,
    `C6b: the HTTP-500 leg kept the whole ${HUGE_LEN}-character body, so the phase-1 bound this row compares against is not in force and the comparison means nothing.`,
  );
  assert.strictEqual(
    b,
    a,
    `contract 6: "The bound is the same one the HTTP error bodies get. A caller cannot tell, from the size of the result, whether a failure arrived as an HTTP error status or inside a 200." The HTTP-500 body kept ${a} characters of the payload, the in-200 error field kept ${b}.`,
  );
  assert.strictEqual(
    markerWord(streamMsg, inStream.base),
    markerWord(httpMsg, http500.base),
    `contract 6: "the same marker wording" as the HTTP error bodies. HTTP-500 used ${markerWord(httpMsg, http500.base)}, the in-200 path used ${markerWord(streamMsg, inStream.base)}.`,
  );
});
