// Blind oracle for session-v66 phase 2 (Escape cancels, nothing-landed ends).
// Written against session-v66/contracts/phase2-gesture.md rules 1..15 on top
// of session-v65/contracts/phase4-gesture.md; nothing here reads src/**.
// Run: SKIP_LIVE=1 node --test test/blind-v66-p2-gesture.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore("blind-v66-p2-gesture", 'export * from "../src/core/dictationGesture";\n');
const { reduce, IDLE } = mod;
test.after(cleanup);

// ---- fixtures (v65 shapes)
const SITE = { uri: "file:///work/a.ts", line: 10 };
const READY = { remote: false, binaryPresent: true, modelPresent: true, recogniserAlive: true, served: true, commentRow: true, inComment: false };
const press = (over = {}) => ({
  type: "press", site: SITE, languageId: "typescript", indentColumns: 4, now: 1000, ghostVisible: false,
  ...over, ready: { ...READY, ...(over.ready || {}) },
});
const firstBuffer = (msSincePress = 62) => ({ type: "first-buffer", msSincePress });
const partial = (text) => ({ type: "partial", text });
const stopped = (pcmBytes, extra = {}) => ({ type: "stopped", pcmBytes, ...extra });
const transcript = (text, decodeMs = 40) => ({ type: "transcript", text, decodeMs });
const intent = (comment = "// Add a bloom filter.", matched = 3, refused = 1) => ({ type: "intent", comment, matched, refused });
const served = (ghost) => ({ type: "served", ghost });
const accepted = () => ({ type: "accepted" });
const dismissed = () => ({ type: "dismissed" });
const edit = (site = SITE) => ({ type: "edit", site });
const cursorMoved = (site = SITE) => ({ type: "cursor-moved", site });
const error = (message = "mic exploded") => ({ type: "error", message });

// ---- fixtures (v66 shapes)
const cancel = (now = 1500) => ({ type: "cancel", now });
const nothingLanded = () => ({ type: "nothing-landed" });
const UNMUTE = { type: "unmute" };
const OFF = { type: "indicator", mode: "off" };
const REFUSE_CANCELLED = { type: "refuse", kind: "cancelled" };
const ABORT = { type: "abort-capture" };
const log = (line) => ({ type: "log", line });

function run(events, from = IDLE) {
  let state = from;
  let last = [];
  for (const ev of events) {
    const out = reduce(state, ev);
    state = out.state;
    last = out.actions;
  }
  return { final: state, last };
}

// Optional fields are spelled absent; a JSON round-trip drops undefined keys.
const plain = (v) => JSON.parse(JSON.stringify(v));
const eqActions = (got, want) => assert.deepStrictEqual(plain(got), plain(want));
const ignored = (type, phase) => [log(`[dictate] ignored ${type} in ${phase}`)];
const types = (actions) => actions.map((a) => a.type);
const after = (n) => `[dictate] cancelled by Escape after ${n}ms`;

// Event sequences that reach each phase from IDLE (v65 events only).
const PATH = {
  idle: [],
  arming: [press()],
  recording: [press(), firstBuffer(62)],
  finalising: [press(), firstBuffer(62), press({ now: 1500 })],
  requesting: [press(), firstBuffer(62), press({ now: 1500 }), stopped(4096), transcript("add a bloom filter")],
  ghost: [press(), firstBuffer(62), press({ now: 1500 }), stopped(4096), transcript("add a bloom filter"), intent(), served(true)],
};
const PHASES = Object.keys(PATH);
const at = (phase) => run(PATH[phase]).final;

// More reachable states than the six canonical ones, for the sweeps.
const REACHABLE = {
  ...PATH,
  "recording with a partial": [...PATH.recording, partial("add a")],
  "finalising with a partial": [...PATH.recording, partial("add a"), press({ now: 1500 })],
  "finalising while decoding": [...PATH.finalising, stopped(4096)],
  "requesting after intent": [...PATH.requesting, intent()],
  "arming by re-record from ghost": [...PATH.ghost, press({ now: 3000 })],
  "ghost after a same-site edit": [...PATH.ghost, edit(SITE)],
};
const NAMES = Object.keys(REACHABLE);
const reach = (name) => run(REACHABLE[name]).final;
const phaseOf = (name) => (PATH[name] ? name : name.split(" ")[0]);

test("fixture paths reach every phase", () => {
  for (const name of NAMES) assert.strictEqual(reach(name).phase, phaseOf(name), name);
  assert.deepStrictEqual(IDLE, { phase: "idle" });
});

// ---- rule 1: cancel in idle is ignored

test("rule 1: cancel in idle is ignored", () => {
  const out = reduce(IDLE, cancel());
  assert.deepStrictEqual(out.state, { phase: "idle" });
  assert.deepStrictEqual(out.actions, ignored("cancel", "idle"));
});

// ---- rule 2: cancel in arming

test("rule 2: cancel in arming aborts before the mic opened", () => {
  for (const name of ["arming", "arming by re-record from ghost"]) {
    const from = reach(name);
    assert.strictEqual(from.phase, "arming", name);
    const out = reduce(from, cancel());
    assert.deepStrictEqual(out.state, { phase: "idle" }, name);
    eqActions(out.actions, [ABORT, UNMUTE, OFF, REFUSE_CANCELLED, log("[dictate] cancelled by Escape before the mic opened")]);
  }
});

// ---- rule 3: cancel in recording, elapsed figure

test("rule 3: cancel in recording aborts with the elapsed ms", () => {
  const from = at("recording");
  assert.strictEqual(from.phase, "recording");
  assert.strictEqual(from.pressedAt, 1000);
  const out = reduce(from, cancel(1500));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  eqActions(out.actions, [ABORT, UNMUTE, OFF, REFUSE_CANCELLED, log(after(500))]);
  const withPartial = reduce(reach("recording with a partial"), cancel(2000));
  assert.deepStrictEqual(withPartial.state, { phase: "idle" });
  assert.strictEqual(withPartial.actions[4].line, after(1000));
});

test("rule 3: the elapsed figure is now minus pressedAt, rounded", () => {
  const from = at("recording");
  // Exact .5 inputs are avoided: the contract does not name the tie rule.
  assert.strictEqual(reduce(from, cancel(1500.4)).actions[4].line, after(500));
  assert.strictEqual(reduce(from, cancel(1500.6)).actions[4].line, after(501));
  assert.strictEqual(reduce(from, cancel(1000)).actions[4].line, after(0));
  assert.strictEqual(reduce(from, cancel(4321)).actions[4].line, after(3321));
});

test("rule 3: 0ms when now is not finite or pressedAt is missing", () => {
  const from = at("recording");
  for (const now of [NaN, Infinity, -Infinity]) {
    const out = reduce(from, cancel(now));
    assert.deepStrictEqual(out.state, { phase: "idle" }, String(now));
    eqActions(out.actions, [ABORT, UNMUTE, OFF, REFUSE_CANCELLED, log(after(0))]);
  }
  const noPress = { ...from };
  delete noPress.pressedAt;
  const out = reduce(noPress, cancel(1500));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  eqActions(out.actions, [ABORT, UNMUTE, OFF, REFUSE_CANCELLED, log(after(0))]);
});

// ---- rule 4: cancel in finalising, and the late stopped/transcript

test("rule 4: cancel in finalising aborts while decoding", () => {
  for (const name of ["finalising", "finalising with a partial", "finalising while decoding"]) {
    const from = reach(name);
    assert.strictEqual(from.phase, "finalising", name);
    const out = reduce(from, cancel());
    assert.deepStrictEqual(out.state, { phase: "idle" }, name);
    eqActions(out.actions, [ABORT, UNMUTE, OFF, REFUSE_CANCELLED, log("[dictate] cancelled by Escape while decoding")]);
  }
});

test("rule 4: a stopped or transcript arriving after the cancel is ignored in idle", () => {
  const cancelled = reduce(reach("finalising while decoding"), cancel()).state;
  for (const ev of [stopped(4096), stopped(0), stopped(0, { failure: "failed" }), transcript("add a bloom filter")]) {
    const out = reduce(cancelled, ev);
    assert.deepStrictEqual(out.state, { phase: "idle" }, ev.type);
    assert.deepStrictEqual(out.actions, ignored(ev.type, "idle"), ev.type);
  }
  const seq = run([stopped(4096), transcript("add a bloom filter")], cancelled);
  assert.deepStrictEqual(seq.final, { phase: "idle" });
  assert.deepStrictEqual(seq.last, ignored("transcript", "idle"));
});

// ---- rule 5: cancel in requesting, and the late served/intent

test("rule 5: cancel in requesting disarms the intent", () => {
  for (const name of ["requesting", "requesting after intent"]) {
    const from = reach(name);
    assert.strictEqual(from.phase, "requesting", name);
    const out = reduce(from, cancel());
    assert.deepStrictEqual(out.state, { phase: "idle" }, name);
    eqActions(out.actions, [{ type: "disarm-intent" }, UNMUTE, OFF, REFUSE_CANCELLED, log("[dictate] cancelled by Escape while requesting")]);
  }
});

test("rule 5: a served or intent arriving after the cancel is ignored in idle", () => {
  const cancelled = reduce(at("requesting"), cancel()).state;
  for (const ev of [served(true), served(false), intent()]) {
    const out = reduce(cancelled, ev);
    assert.deepStrictEqual(out.state, { phase: "idle" }, ev.type);
    assert.deepStrictEqual(out.actions, ignored(ev.type, "idle"), ev.type);
  }
  const seq = run([intent(), served(true)], cancelled);
  assert.deepStrictEqual(seq.final, { phase: "idle" });
  assert.deepStrictEqual(seq.last, ignored("served", "idle"));
});

// ---- rule 6: cancel in ghost is exactly a dismiss

test("rule 6: cancel in ghost is exactly what dismissed does", () => {
  for (const name of ["ghost", "ghost after a same-site edit"]) {
    const from = reach(name);
    assert.strictEqual(from.phase, "ghost", name);
    const out = reduce(from, cancel());
    assert.deepStrictEqual(out.state, { phase: "idle" }, name);
    eqActions(out.actions, [OFF, log("[dictate] ghost dismissed")]);
    assert.deepStrictEqual(plain(out), plain(reduce(from, dismissed())), name);
    assert.ok(!types(out.actions).includes("hide-ghost"), "no hide-ghost");
    assert.ok(!types(out.actions).includes("refuse"), "no refuse");
  }
});

// ---- rule 7: the refuse cancelled action shape

test("rule 7: refuse cancelled is { type, kind } with no detail", () => {
  for (const phase of ["arming", "recording", "finalising", "requesting"]) {
    const out = reduce(at(phase), cancel());
    const refuses = out.actions.filter((a) => a.type === "refuse");
    assert.strictEqual(refuses.length, 1, `${phase}: exactly one refuse`);
    assert.strictEqual(refuses[0].kind, "cancelled", phase);
    assert.strictEqual(refuses[0].detail, undefined, phase);
    assert.deepStrictEqual(Object.keys(plain(refuses[0])).sort(), ["kind", "type"], phase);
  }
});

// ---- rule 8: the state after any cancel is exactly IDLE

test("rule 8: after any cancel the state is exactly { phase: 'idle' }", () => {
  for (const name of NAMES) {
    const out = reduce(reach(name), cancel());
    assert.deepStrictEqual(out.state, { phase: "idle" }, name);
    assert.deepStrictEqual(out.state, IDLE, name);
    assert.deepStrictEqual(Object.keys(out.state), ["phase"], name);
  }
});

// ---- rule 9: nothing-landed in ghost

test("rule 9: nothing-landed in ghost refuses and ends the gesture", () => {
  for (const name of ["ghost", "ghost after a same-site edit"]) {
    const from = reach(name);
    assert.strictEqual(from.phase, "ghost", name);
    const out = reduce(from, nothingLanded());
    assert.deepStrictEqual(out.state, { phase: "idle" }, name);
    eqActions(out.actions, [
      OFF,
      { type: "refuse", kind: "nothing-landed" },
      log("[dictate] nothing landed: no edit arrived on the site after the commit"),
    ]);
    assert.strictEqual(out.actions[1].detail, undefined, name);
  }
});

// ---- rule 10: nothing-landed elsewhere is ignored

test("rule 10: nothing-landed in every other phase is ignored", () => {
  for (const name of NAMES) {
    const from = reach(name);
    if (from.phase === "ghost") continue;
    const out = reduce(from, nothingLanded());
    assert.deepStrictEqual(out.state, from, name);
    assert.deepStrictEqual(out.actions, ignored("nothing-landed", from.phase), name);
  }
});

// ---- rule 11: the sweep, cancel then every event that idle ignores

// Every v65 event idle ignores (v65 rules 8, 10, 15, 17, 19, 22, 25, 28), plus
// the two new events idle ignores (rules 1 and 10 of this contract). `press`
// is rule 13 below; `error` in idle logs its own line (v65 rule 30).
const IDLE_IGNORES = [
  firstBuffer(62), partial("hello"), stopped(4096), stopped(0), stopped(0, { failure: "failed" }),
  transcript("add a bloom filter"), intent(), served(true), served(false), accepted(), dismissed(),
  edit(SITE), edit({ uri: "file:///work/b.ts", line: 3 }), cursorMoved(SITE),
  cursorMoved({ uri: "file:///work/a.ts", line: 11 }), cancel(), nothingLanded(),
];

test("rule 11: from every reachable state, cancel then each event stays IDLE with only the ignored log", () => {
  for (const name of NAMES) {
    const cancelled = reduce(reach(name), cancel()).state;
    assert.deepStrictEqual(cancelled, { phase: "idle" }, name);
    for (const ev of IDLE_IGNORES) {
      const out = reduce(cancelled, ev);
      assert.deepStrictEqual(out.state, { phase: "idle" }, `${name} then ${ev.type}`);
      assert.deepStrictEqual(out.actions, [log(`[dictate] ignored ${ev.type} in idle`)], `${name} then ${ev.type}`);
    }
  }
});

test("rule 11: cancel then the rest of the take's events, in delivery order, stays IDLE", () => {
  const tails = {
    arming: [firstBuffer(62), partial("x"), stopped(4096), transcript("add a bloom filter"), intent(), served(true), accepted()],
    recording: [partial("x"), stopped(4096), transcript("add a bloom filter"), intent(), served(true), accepted()],
    finalising: [stopped(4096), transcript("add a bloom filter"), intent(), served(true), accepted()],
    requesting: [intent(), served(true), accepted()],
    ghost: [accepted(), dismissed()],
  };
  for (const [phase, tail] of Object.entries(tails)) {
    let state = reduce(at(phase), cancel()).state;
    for (const ev of tail) {
      const out = reduce(state, ev);
      assert.deepStrictEqual(out.state, { phase: "idle" }, `${phase} then ${ev.type}`);
      assert.deepStrictEqual(out.actions, ignored(ev.type, "idle"), `${phase} then ${ev.type}`);
      state = out.state;
    }
  }
});

test("rule 11: error after a cancel only logs, as idle does (v65 rule 30)", () => {
  for (const phase of PHASES) {
    const out = reduce(reduce(at(phase), cancel()).state, error("late"));
    assert.deepStrictEqual(out.state, { phase: "idle" }, phase);
    assert.deepStrictEqual(out.actions, [log("[dictate] error: late")], phase);
  }
});

// ---- rule 12: cancel never emits capture, mute or generation actions

test("rule 12: cancel never emits trigger-fim, transcribe, build-intent, start-capture, mute or stop-capture", () => {
  const banned = ["trigger-fim", "transcribe", "build-intent", "start-capture", "mute", "stop-capture"];
  for (const name of NAMES) {
    for (const now of [1500, undefined, NaN, "1500"]) {
      const out = reduce(reach(name), { type: "cancel", now });
      for (const t of types(out.actions)) assert.ok(!banned.includes(t), `${name} (now=${now}): emitted ${t}`);
    }
  }
});

// ---- rule 13: a press after a cancel is a press from idle

test("rule 13: a press after a cancel opens a new take exactly as a press from idle does", () => {
  const fromIdle = reduce(IDLE, press({ now: 5000 }));
  assert.strictEqual(fromIdle.state.phase, "arming");
  for (const name of NAMES) {
    const out = reduce(reduce(reach(name), cancel()).state, press({ now: 5000 }));
    assert.deepStrictEqual(plain(out), plain(fromIdle), name);
    assert.strictEqual(out.state.pressedAt, 5000, name);
    assert.strictEqual(out.state.heard, undefined, name);
    assert.strictEqual(out.state.partial, undefined, name);
  }
});

test("rule 13: the press after a cancel honours ghostVisible and readiness like idle", () => {
  const cancelled = reduce(at("ghost"), cancel()).state;
  const withGhost = reduce(cancelled, press({ ghostVisible: true }));
  assert.deepStrictEqual(plain(withGhost), plain(reduce(IDLE, press({ ghostVisible: true }))));
  assert.strictEqual(withGhost.actions[0].type, "hide-ghost");
  assert.strictEqual(withGhost.actions[withGhost.actions.length - 1].line, "[dictate] press at file:///work/a.ts:10");
  const refused = reduce(reduce(at("recording"), cancel()).state, press({ ready: { served: false } }));
  assert.deepStrictEqual(plain(refused), plain(reduce(IDLE, press({ ready: { served: false } }))));
  assert.deepStrictEqual(refused.state, { phase: "idle" });
  assert.strictEqual(refused.actions[0].kind, "not-served");
});

// ---- rule 14: nothing-landed never touches the ghost, the capture or the mute

test("rule 14: nothing-landed never emits hide-ghost, abort-capture or unmute", () => {
  const banned = ["hide-ghost", "abort-capture", "unmute"];
  for (const name of NAMES) {
    const out = reduce(reach(name), nothingLanded());
    for (const t of types(out.actions)) assert.ok(!banned.includes(t), `${name}: emitted ${t}`);
  }
});

// ---- rule 15: a malformed cancel still cancels

test("rule 15: cancel with no now still cancels in every phase", () => {
  const lines = {
    arming: "[dictate] cancelled by Escape before the mic opened",
    recording: after(0), // `now` is absent, so it is not finite: 0ms
    finalising: "[dictate] cancelled by Escape while decoding",
    requesting: "[dictate] cancelled by Escape while requesting",
  };
  for (const [phase, line] of Object.entries(lines)) {
    const out = reduce(at(phase), { type: "cancel" });
    assert.deepStrictEqual(out.state, { phase: "idle" }, phase);
    eqActions(out.actions, [phase === "requesting" ? { type: "disarm-intent" } : ABORT, UNMUTE, OFF, REFUSE_CANCELLED, log(line)]);
  }
  const ghost = reduce(at("ghost"), { type: "cancel" });
  assert.deepStrictEqual(ghost.state, { phase: "idle" });
  eqActions(ghost.actions, [OFF, log("[dictate] ghost dismissed")]);
  assert.deepStrictEqual(reduce(IDLE, { type: "cancel" }), { state: { phase: "idle" }, actions: ignored("cancel", "idle") });
});

test("rule 15: cancel with now a string still cancels", () => {
  for (const phase of ["arming", "finalising", "requesting", "ghost"]) {
    const out = reduce(at(phase), { type: "cancel", now: "1500" });
    assert.deepStrictEqual(out.state, { phase: "idle" }, phase);
    assert.deepStrictEqual(plain(out), plain(reduce(at(phase), cancel(1500))), phase);
  }
  const out = reduce(at("recording"), { type: "cancel", now: "1500" });
  assert.deepStrictEqual(out.state, { phase: "idle" });
  assert.deepStrictEqual(types(out.actions), ["abort-capture", "unmute", "indicator", "refuse", "log"]);
  assert.match(out.actions[4].line, /^\[dictate\] cancelled by Escape after \d+ms$/);
  // CONTRACT AMBIGUITY: rule 3 says 0ms when `now` is not finite and rule 15
  // says a string `now` "only feeds the elapsed figure". A string is not a
  // finite number, so the literal reading is 0ms; a coercing implementation
  // would print 500ms. The most literal reading is asserted.
  assert.strictEqual(out.actions[4].line, after(0));
});
