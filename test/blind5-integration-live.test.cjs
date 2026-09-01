// Blind oracle: BAR 5, the exact live oracle (phase5-surface.md "Bar 5, the
// exact live oracle"; goal.md falsification bar 5: "Both models resident and a
// mixed FIM/fn-gen alternation triggers an eviction on the reference config ->
// feature 5's carve is wrong").
//
// Per the surface, this file drives /api/generate DIRECTLY with the product's
// documented request shapes (phase-1 FIM body with suffix; phase-2 instruct
// body with options.num_gpu: 30), because the assertions need load_duration
// and the product clients deliberately do not surface it. num_predict 150 and
// a fresh nonce line per fn-gen prompt (prompt-cache defeat) follow the spike.
//
// Requires ollama at http://localhost:11434 with qwen2.5-coder:1.5b-base and
// qwen3-coder:30b pulled. No test here pulls a model. Skip with SKIP_LIVE=1.
// Budget: 6 alternation requests at 150 tokens (30b calls run 4-8s each); the
// test timeout also absorbs a cold warm-phase model load. Joins the test:live
// serial list after the phase-4 files [surface: 'Live files ... append to the
// test:live serial list'].
//
// Run: node --test --test-concurrency=1 test/blind5-integration-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 300_000;

const API_BASE = "http://localhost:11434";
const FIM_MODEL = "qwen2.5-coder:1.5b-base";
const FNGEN_MODEL = "qwen3-coder:30b";
const NS_PER_SEC = 1_000_000_000; // load_duration is nanoseconds

// ---- request shapes (the product's documented bodies)

// Realistic FIM context at the phase-1 default windows (prefix 3000/suffix
// 1000), cursor mid-statement - the phase-1 live oracle's shape.
function codeBlock(i) {
  return (
    `export function task${i}(input: number): number {\n` +
    `  const scaled = input * ${i};\n` +
    `  if (scaled > 100) {\n` +
    `    return scaled - ${i};\n` +
    `  }\n` +
    `  return scaled + ${i};\n` +
    `}\n\n`
  );
}

function fimBody() {
  let prefix = "";
  for (let i = 0; prefix.length < 2900; i++) prefix += codeBlock(i);
  prefix +=
    "export function average(values: number[]): number {\n" +
    "  let total = 0;\n" +
    "  for (const v of values) {\n" +
    "    total += ";
  let suffix = "\n  }\n  return total / values.length;\n}\n\n";
  for (let i = 100; suffix.length < 1000; i++) suffix += codeBlock(i);
  return {
    model: FIM_MODEL,
    prompt: prefix.slice(-3000),
    suffix: suffix.slice(0, 1000),
    stream: true,
    keep_alive: 1800,
    options: { num_predict: 64, temperature: 0.01 },
  };
}

// Phase-2 instruct body with the reference carve. Fresh nonce line per prompt
// defeats the prompt cache; neither the nonce nor num_predict affects
// residency [surface: bar 5 request shapes].
function fnGenBody() {
  return {
    model: FNGEN_MODEL,
    prompt:
      "Implement the function below. Reply with only the complete function definition in a rust code block.\n\n" +
      "```rust\npub fn parse_duration(input: &str) -> Option<u64>\n```\n\n" +
      `// nonce: ${crypto.randomUUID()}\n`,
    stream: true,
    keep_alive: 1800,
    options: { num_predict: 150, temperature: 0.2, num_gpu: 30, num_ctx: 16384 },
  };
}

// Streams one /api/generate call; returns TTFT (first non-empty response
// chunk) and the final done line, which carries load_duration.
async function streamGenerate(body) {
  const t0 = performance.now();
  const res = await fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.ok(res.ok, `/api/generate ${res.status} for ${body.model}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let ttftMs;
  let final;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const evt = JSON.parse(line);
      assert.strictEqual(evt.error, undefined, `ollama stream error: ${evt.error}`);
      if (ttftMs === undefined && evt.response) ttftMs = performance.now() - t0;
      if (evt.done) final = evt;
    }
  }
  assert.ok(final, `${body.model}: stream ended with a done line`);
  assert.strictEqual(typeof final.load_duration, "number", "the done line carries load_duration");
  return { ttftMs, final };
}

// The /api/ps residency assertion, run after EVERY request [surface: 'After
// every one of the 8 requests, GET /api/ps and assert over models[]'].
async function assertDualResidency(label) {
  const res = await fetch(`${API_BASE}/api/ps`);
  assert.ok(res.ok, `/api/ps ${res.status}`);
  const models = (await res.json()).models ?? [];
  const names = models.map((m) => m.name);
  const fim = models.find((m) => m.name === FIM_MODEL);
  const fngen = models.find((m) => m.name === FNGEN_MODEL);
  assert.ok(fim, `${label}: ${FIM_MODEL} resident - dual residency held; /api/ps has ${JSON.stringify(names)}`);
  assert.ok(fngen, `${label}: ${FNGEN_MODEL} resident - dual residency held; /api/ps has ${JSON.stringify(names)}`);
  for (const entry of [fim, fngen]) {
    // Field contract verified live 2026-07-11 [surface: '/api/ps field contract'].
    assert.strictEqual(typeof entry.size, "number", `${label}: ${entry.name} carries size`);
    assert.strictEqual(typeof entry.size_vram, "number", `${label}: ${entry.name} carries size_vram`);
    assert.ok("expires_at" in entry, `${label}: ${entry.name} carries expires_at`);
  }
  // Exact equality on the numbers as returned [surface: 'size_vram === size is
  // exact equality']. Anything less means the 1.5b was pushed (partly) to CPU -
  // the worst outcome, because it looks like it works.
  assert.strictEqual(
    fim.size_vram,
    fim.size,
    `${label}: 1.5b must be fully GPU-resident; size_vram=${fim.size_vram} size=${fim.size}`
  );
  // Layer-capped: on GPU, not fully offloaded, not over-allocated.
  assert.ok(
    fngen.size_vram > 0 && fngen.size_vram < fngen.size,
    `${label}: 30b must be layer-capped (0 < size_vram < size); size_vram=${fngen.size_vram} size=${fngen.size}`
  );
}

test("precondition: live ollama is up and BOTH bar-5 models are pulled (never pulled by a test) [surface: 'No test anywhere in the suite pulls a model']", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const res = await fetch(`${API_BASE}/api/tags`);
  assert.ok(res.ok, `/api/tags ${res.status}: is ollama up?`);
  const tags = ((await res.json()).models ?? []).map((m) => m.name);
  assert.ok(tags.includes(FIM_MODEL), `${FIM_MODEL} must be pulled; got ${JSON.stringify(tags)}`);
  assert.ok(tags.includes(FNGEN_MODEL), `${FNGEN_MODEL} must be pulled; got ${JSON.stringify(tags)}`);
});

test("BAR 5: dual residency + zero evictions + FIM < 200ms across 3 FIM/fn-gen alternation cycles on the reference carve [surface: 'Bar 5, the exact live oracle'; goal falsification bar 5]", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  // Warm phase [surface: 'Warm: one 30b fn-gen request, then one 1.5b FIM
  // request']. Residency is asserted after every request including these two;
  // no load_duration bar on warm (the bar is defined post-warm).
  await streamGenerate(fnGenBody());
  await assertDualResidency("after warm fn-gen");
  await streamGenerate(fimBody());
  await assertDualResidency("after warm FIM");

  // Alternation: exactly 3 cycles of (FIM, then fn-gen) = 6 post-warm
  // requests, the spike's shape.
  const evidence = [];
  for (let cycle = 1; cycle <= 3; cycle++) {
    const fim = await streamGenerate(fimBody());
    await assertDualResidency(`cycle ${cycle} after FIM`);
    evidence.push(`c${cycle} fim load=${Math.round(fim.final.load_duration / 1e6)}ms ttft=${Math.round(fim.ttftMs)}ms`);
    // Zero evictions: eviction reloads measured 2000-4600ms, warm loads
    // milliseconds-scale; 1s splits on spike measurements, not taste.
    assert.ok(
      fim.final.load_duration < NS_PER_SEC,
      `cycle ${cycle} FIM: load_duration ${Math.round(fim.final.load_duration / 1e6)}ms >= 1s is an eviction; bar 5 failed (${evidence.join("; ")})`
    );
    // FIM holds under alternation: the phase-1 bar applied during alternation
    // - what the carve is for (proven figure 102-109ms here).
    assert.ok(
      fim.ttftMs < 200,
      `cycle ${cycle} FIM: warm TTFT ${Math.round(fim.ttftMs)}ms must stay < 200ms under alternation (${evidence.join("; ")})`
    );

    const gen = await streamGenerate(fnGenBody());
    await assertDualResidency(`cycle ${cycle} after fn-gen`);
    evidence.push(`c${cycle} fngen load=${Math.round(gen.final.load_duration / 1e6)}ms`);
    assert.ok(
      gen.final.load_duration < NS_PER_SEC,
      `cycle ${cycle} fn-gen: load_duration ${Math.round(gen.final.load_duration / 1e6)}ms >= 1s is an eviction; bar 5 failed (${evidence.join("; ")})`
    );
  }
});
