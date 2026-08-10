// Blind oracle: live fn-gen integration, THE phase-2 falsification bar
// (phase2-surface.md "Integration bars (phase 2 falsification)"; goal.md
// falsification bar 2: "Generation escapes the function span even once in
// the integration suite -> feature 2 not done").
//
// Requires ollama at http://localhost:11434 with qwen3-coder:30b pulled.
// Live 30b calls run with numGpu 30 per the carve discipline. Skip with
// SKIP_LIVE=1. Timeouts follow the surface's 4-8s/~150-token warm envelope
// with a 120s first-call model-load budget; there is no latency bar here.
//
// The bar is asserted twice per generation: through byteCompareOutsideSpan
// AND through slice/byte comparisons computed in this file, so a bug in the
// oracle utility cannot vouch for itself.
//
// Run: node --test --test-concurrency=1 test/blind2-integration-live.test.cjs
//      (surface: live phase-2 files join the test:live serial list)

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 120_000;

const API_BASE = "http://localhost:11434";
const MODEL = "qwen3-coder:30b";

const { mod, cleanup } = bundleCore(
  "blind2-integration",
  `export { FnGenService } from "../src/core/fnGenService";
export { spliceSpan, byteCompareOutsideSpan } from "../src/core/span";
export { listModels } from "../src/core/ollama";\n`
);
const { FnGenService, spliceSpan, byteCompareOutsideSpan, listModels } = mod;
test.after(cleanup);

// Full config literal so this suite does not lean on the config stub.
// numGpu 30 is the reference carve [surface: 'Carve discipline'].
const LIVE_CONFIG = {
  apiBase: API_BASE,
  model: MODEL,
  fallbackModel: "qwen2.5-coder:14b-instruct-q4_K_M",
  maxTokens: 512,
  temperature: 0.2,
  numGpu: 30,
};

// Repairbench-style fixture: a small Rust module, target function mid-file
// so both boundary regions are non-empty. Doc comment sits outside the span
// (vscode layer normalizes spans to the declaration head).
const ORIGINAL = `//! Fixture module for the phase-2 boundary bar.

pub fn double(x: i64) -> i64 {
    x * 2
}

/// Returns the sum of the even numbers in \`values\`.
///
/// An empty slice sums to zero.
pub fn sum_even(values: &[i64]) -> i64 {
    unimplemented!()
}

pub fn triple(x: i64) -> i64 {
    x * 3
}
`;
const SPAN_START = ORIGINAL.indexOf("pub fn sum_even");
const SPAN_END = ORIGINAL.indexOf("}", SPAN_START) + 1;
const SPAN = { start: SPAN_START, end: SPAN_END };
const SIGNATURE = "pub fn sum_even(values: &[i64]) -> i64";
const DOC_COMMENT =
  "/// Returns the sum of the even numbers in `values`.\n///\n/// An empty slice sums to zero.";

// The independent half of the bar: boundary equality computed from slices
// and UTF-8 buffers here, never via the module under test.
function assertOutsideByteIdentical(original, result, span) {
  const prefix = original.slice(0, span.start);
  const suffix = original.slice(span.end);
  assert.strictEqual(result.slice(0, span.start), prefix, "independent check: prefix region unchanged");
  assert.strictEqual(result.slice(result.length - suffix.length), suffix, "independent check: suffix region unchanged");
  assert.ok(
    Buffer.from(result.slice(0, span.start), "utf8").equals(Buffer.from(prefix, "utf8")),
    "independent check: prefix bytes identical under UTF-8"
  );
  assert.ok(
    Buffer.from(result.slice(result.length - suffix.length), "utf8").equals(Buffer.from(suffix, "utf8")),
    "independent check: suffix bytes identical under UTF-8"
  );
}

test("precondition: live ollama is up and the fn-gen model is pulled", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const tags = await listModels(API_BASE);
  assert.ok(Array.isArray(tags), "server reachable: listModels returns tags, not undefined");
  assert.ok(tags.includes(MODEL), `${MODEL} must be pulled; got ${JSON.stringify(tags)}`);
});

test("boundary bar: real 30b round trip, splice lands in the span, bytes outside byte-identical by oracle AND independent comparison [surface: 'Boundary bar (goal falsification bar 2)']", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const lines = [];
  const svc = new FnGenService(LIVE_CONFIG, undefined, (l) => lines.push(l));
  try {
    const out = await svc.generate({
      signature: SIGNATURE,
      docComment: DOC_COMMENT,
      languageId: "rust",
      span: SPAN,
    });
    assert.ok(out, "live generation resolves a result");
    assert.ok(out.text.length > 0, "non-empty postprocessed text");
    assert.strictEqual(out.model, MODEL);
    assert.ok(out.ttftMs > 0, "ttftMs measured");
    assert.ok(out.totalMs >= out.ttftMs, "totalMs covers the stream");
    assert.ok(out.text.includes("sum_even"), `a complete function definition names the function; got: ${out.text}`);

    const spliced = spliceSpan(ORIGINAL, SPAN, out.text);
    // Replacement lands exactly in the span.
    assert.strictEqual(spliced, ORIGINAL.slice(0, SPAN.start) + out.text + ORIGINAL.slice(SPAN.end));
    assert.strictEqual(spliced.slice(SPAN.start, SPAN.start + out.text.length), out.text);
    // The bar, both ways.
    assert.strictEqual(byteCompareOutsideSpan(ORIGINAL, spliced, SPAN), true, "oracle: outside the span byte-identical");
    assertOutsideByteIdentical(ORIGINAL, spliced, SPAN);

    const genLines = lines.filter((l) => l.startsWith("[fngen] gen "));
    assert.ok(genLines.length >= 1, `evidence: a [fngen] gen line was emitted, got ${JSON.stringify(lines)}`);
    assert.ok(genLines[0].includes(`span=${SPAN.start}-${SPAN.end}`), `gen line carries the span, got ${genLines[0]}`);
  } finally {
    svc.dispose();
  }
});

test("abort mid-stream resolves undefined and leaves no partial output [surface: pipeline 7 abort + ollama 'No chunk is delivered after the signal aborts']", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const lines = [];
  const svc = new FnGenService(LIVE_CONFIG, undefined, (l) => lines.push(l));
  try {
    const ac = new AbortController();
    const received = [];
    let afterAbort = 0;
    const p = svc.generate(
      {
        signature: SIGNATURE,
        docComment: DOC_COMMENT,
        languageId: "rust",
        span: SPAN,
        onChunk: (c) => {
          if (ac.signal.aborted) {
            afterAbort++;
            return;
          }
          received.push(c);
          ac.abort(); // abort on the first streamed chunk: mid-stream by construction
        },
      },
      ac.signal
    );
    const out = await p;
    assert.strictEqual(out, undefined, "abort is cancellation: resolves undefined, no partial FnGenResult");
    assert.ok(received.length >= 1, "the stream had started before the abort");
    assert.strictEqual(afterAbort, 0, "no chunk delivered after the signal aborted");
    assert.ok(lines.includes("[fngen] aborted"), `evidence: [fngen] aborted logged, got ${JSON.stringify(lines)}`);
  } finally {
    svc.dispose();
  }
});
