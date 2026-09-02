// Blind oracle for session-v65 phase 4: the dictation gesture as a pure
// reducer (src/core/dictationGesture). Written against
// session-v65/contracts/phase4-gesture.md only; nothing here reads src/**.
// Rows bind rules 1..30 of the contract and sweep the four invariants over
// hand-built and seeded-random event sequences.
//
// Run: SKIP_LIVE=1 node --test test/blind-v65-p4-gesture.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v65-p4-gesture",
  'export * from "../src/core/dictationGesture";\n'
);
const { reduce, IDLE } = mod;
test.after(cleanup);

// ---- fixtures

const SITE = { uri: "file:///work/a.ts", line: 10 };
const OTHER_LINE = { uri: "file:///work/a.ts", line: 11 };
const OTHER_URI = { uri: "file:///work/b.ts", line: 10 };
const READY = {
  remote: false,
  binaryPresent: true,
  modelPresent: true,
  recogniserAlive: true,
  served: true,
  commentRow: true,
  inComment: false,
};

const press = (over = {}) => ({
  type: "press",
  site: SITE,
  languageId: "typescript",
  indentColumns: 4,
  now: 1000,
  ghostVisible: false,
  ...over,
  ready: { ...READY, ...(over.ready || {}) },
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

// Threads events through reduce. states[i] and actions[i] are the result of
// event i; `final` is the last state (or `from` when there are no events).
function run(events, from = IDLE) {
  const states = [];
  const actions = [];
  let state = from;
  for (const ev of events) {
    const out = reduce(state, ev);
    state = out.state;
    states.push(out.state);
    actions.push(out.actions);
  }
  return { states, actions, final: state, last: actions[actions.length - 1] };
}

// The contract lists optional fields (`detail`, `text`) as absent, not as
// `undefined`. A JSON round-trip drops undefined-valued keys so a deep
// comparison does not fail on that spelling difference.
const plain = (v) => JSON.parse(JSON.stringify(v));
const eqActions = (got, want) => assert.deepStrictEqual(plain(got), plain(want));
const ignored = (type, phase) => [{ type: "log", line: `[dictate] ignored ${type} in ${phase}` }];

// Event sequences that reach each phase from IDLE.
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

test("fixture paths reach every phase", () => {
  for (const phase of PHASES) assert.strictEqual(at(phase).phase, phase, phase);
  assert.deepStrictEqual(IDLE, { phase: "idle" });
});

test("reduce does not mutate the state it is given", () => {
  const before = JSON.stringify(IDLE);
  reduce(IDLE, press());
  assert.strictEqual(JSON.stringify(IDLE), before);
  const rec = at("recording");
  const snap = JSON.stringify(rec);
  reduce(rec, partial("hello"));
  reduce(rec, press({ now: 1500 }));
  assert.strictEqual(JSON.stringify(rec), snap);
});

// ---- rule 1: readiness refusals, in order, first failure wins

const REFUSALS = [
  { ready: { remote: true }, kind: "remote" },
  { ready: { binaryPresent: false }, kind: "binary-missing" },
  { ready: { modelPresent: false }, kind: "model-missing" },
  { ready: { recogniserAlive: false }, kind: "server-down" },
  { ready: { served: false }, kind: "not-served", detail: "typescript" },
  { ready: { commentRow: false }, kind: "no-comment-row", detail: "typescript" },
  { ready: { inComment: true }, kind: "in-comment" },
];

for (const r of REFUSALS) {
  test(`rule 1: ${r.kind} refuses and stays idle`, () => {
    const out = reduce(IDLE, press({ ready: r.ready }));
    assert.deepStrictEqual(out.state, { phase: "idle" });
    assert.strictEqual(out.actions.length, 2);
    assert.strictEqual(out.actions[0].type, "refuse");
    assert.strictEqual(out.actions[0].kind, r.kind);
    if (r.detail !== undefined) assert.strictEqual(out.actions[0].detail, r.detail);
    assert.deepStrictEqual(out.actions[1], { type: "log", line: `[dictate] refused: ${r.kind}` });
  });
}

test("rule 1: two failures refuse the FIRST in contract order", () => {
  for (let i = 0; i < REFUSALS.length; i++) {
    for (let j = i + 1; j < REFUSALS.length; j++) {
      const out = reduce(IDLE, press({ ready: { ...REFUSALS[i].ready, ...REFUSALS[j].ready } }));
      assert.strictEqual(out.actions[0].kind, REFUSALS[i].kind, `${REFUSALS[i].kind}+${REFUSALS[j].kind}`);
      assert.strictEqual(out.state.phase, "idle");
    }
  }
});

test("rule 1: everything failing refuses remote", () => {
  const out = reduce(IDLE, press({
    ready: { remote: true, binaryPresent: false, modelPresent: false, recogniserAlive: false, served: false, commentRow: false, inComment: true },
  }));
  eqActions(out.actions, [{ type: "refuse", kind: "remote" }, { type: "log", line: "[dictate] refused: remote" }]);
});

test("rule 1: binary-missing carries ready.platform as detail", () => {
  const out = reduce(IDLE, press({ ready: { binaryPresent: false, platform: "linux-arm64" } }));
  eqActions(out.actions, [
    { type: "refuse", kind: "binary-missing", detail: "linux-arm64" },
    { type: "log", line: "[dictate] refused: binary-missing" },
  ]);
});

test("rule 1: binary-missing without platform reads unknown", () => {
  // "absent means `unknown`": read as detail === "unknown".
  const out = reduce(IDLE, press({ ready: { binaryPresent: false } }));
  assert.strictEqual(out.actions[0].kind, "binary-missing");
  assert.strictEqual(out.actions[0].detail, "unknown");
});

test("rule 1: not-served and no-comment-row detail is the languageId of the press", () => {
  const a = reduce(IDLE, press({ languageId: "rust", ready: { served: false } }));
  assert.strictEqual(a.actions[0].detail, "rust");
  const b = reduce(IDLE, press({ languageId: "python", ready: { commentRow: false } }));
  assert.strictEqual(b.actions[0].detail, "python");
});

test("rule 1: a refusal in idle produces no capture, mute or indicator action", () => {
  for (const r of REFUSALS) {
    const out = reduce(IDLE, press({ ready: r.ready, ghostVisible: true }));
    assert.deepStrictEqual(out.actions.map((a) => a.type), ["refuse", "log"], r.kind);
  }
});

// ---- rule 2: the arming press

test("rule 2: idle press arms with the site, language, indent and pressedAt", () => {
  const out = reduce(IDLE, press({ now: 1234, indentColumns: 8, languageId: "go" }));
  assert.strictEqual(out.state.phase, "arming");
  assert.deepStrictEqual(out.state.site, SITE);
  assert.strictEqual(out.state.languageId, "go");
  assert.strictEqual(out.state.indentColumns, 8);
  assert.strictEqual(out.state.pressedAt, 1234);
  assert.strictEqual(out.state.partial, undefined);
  assert.strictEqual(out.state.heard, undefined);
  assert.strictEqual(out.state.firstBufferMs, undefined);
});

test("rule 2: action order without a ghost showing", () => {
  const out = reduce(IDLE, press());
  eqActions(out.actions, [
    { type: "mute" },
    { type: "start-capture" },
    { type: "indicator", mode: "armed" },
    { type: "log", line: "[dictate] press at file:///work/a.ts:10" },
  ]);
});

test("rule 2: hide-ghost leads when ghostVisible", () => {
  const out = reduce(IDLE, press({ ghostVisible: true }));
  eqActions(out.actions, [
    { type: "hide-ghost" },
    { type: "mute" },
    { type: "start-capture" },
    { type: "indicator", mode: "armed" },
    { type: "log", line: "[dictate] press at file:///work/a.ts:10" },
  ]);
});

// ---- rule 3: re-record from ghost and requesting

for (const phase of ["ghost", "requesting"]) {
  test(`rule 3: press in ${phase} re-records, hide-ghost first even when ghostVisible is false`, () => {
    const from = at(phase);
    const out = reduce(from, press({ now: 9000, ghostVisible: false, site: OTHER_LINE, languageId: "rust", indentColumns: 2 }));
    assert.strictEqual(out.state.phase, "arming");
    assert.deepStrictEqual(out.state.site, OTHER_LINE);
    assert.strictEqual(out.state.languageId, "rust");
    assert.strictEqual(out.state.indentColumns, 2);
    assert.strictEqual(out.state.pressedAt, 9000);
    assert.strictEqual(out.state.partial, undefined);
    assert.strictEqual(out.state.heard, undefined);
    eqActions(out.actions, [
      { type: "hide-ghost" },
      { type: "mute" },
      { type: "start-capture" },
      { type: "indicator", mode: "armed" },
      { type: "log", line: "[dictate] press at file:///work/a.ts:11 (re-record)" },
    ]);
  });

  test(`rule 3: press in ${phase} with ghostVisible true still emits exactly one hide-ghost`, () => {
    const out = reduce(at(phase), press({ now: 9000, ghostVisible: true }));
    assert.strictEqual(out.actions.filter((a) => a.type === "hide-ghost").length, 1);
    assert.strictEqual(out.actions[0].type, "hide-ghost");
    assert.ok(out.actions[out.actions.length - 1].line.endsWith(" (re-record)"));
  });
}

test("rule 3: readiness is not re-checked on a re-record press", () => {
  // Rule 1 is scoped to idle; a failing readiness in ghost still re-records.
  // Careful reading: the contract lists no refusal outside idle.
  const out = reduce(at("ghost"), press({ now: 9000, ready: { served: false } }));
  assert.strictEqual(out.state.phase, "arming");
  assert.strictEqual(out.actions[0].type, "hide-ghost");
});

// ---- rule 4, 5, 6: press in the capture phases

test("rule 4: press in arming cancels before the mic opened", () => {
  const out = reduce(at("arming"), press({ now: 1100 }));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  eqActions(out.actions, [
    { type: "abort-capture" },
    { type: "unmute" },
    { type: "indicator", mode: "off" },
    { type: "log", line: "[dictate] cancelled before the mic opened" },
  ]);
});

test("rule 5: press in recording stops and goes to finalising", () => {
  const rec = run([press({ now: 1000 }), firstBuffer(62), partial("add a  bloom filter")]).final;
  const out = reduce(rec, press({ now: 1500 }));
  assert.strictEqual(out.state.phase, "finalising");
  assert.deepStrictEqual(out.state.site, SITE);
  assert.strictEqual(out.state.languageId, "typescript");
  assert.strictEqual(out.state.indentColumns, 4);
  assert.strictEqual(out.state.heard, undefined);
  assert.strictEqual(out.state.partial, "add a bloom filter");
  eqActions(out.actions, [
    { type: "stop-capture" },
    { type: "indicator", mode: "thinking" },
    { type: "log", line: "[dictate] stop after 500ms" },
  ]);
});

test("rule 5: the stop log is now minus pressedAt as an int", () => {
  const rec = run([press({ now: 20000 }), firstBuffer(30)]).final;
  const out = reduce(rec, press({ now: 23456 }));
  assert.deepStrictEqual(out.actions[2], { type: "log", line: "[dictate] stop after 3456ms" });
});

test("rule 6: press in finalising is ignored", () => {
  const from = at("finalising");
  const out = reduce(from, press({ now: 1600 }));
  assert.deepStrictEqual(out.state, from);
  assert.deepStrictEqual(out.actions, ignored("press", "finalising"));
});

// ---- rule 7, 8: first-buffer

test("rule 7: first-buffer in arming goes live with an empty text", () => {
  const out = reduce(at("arming"), firstBuffer(62));
  assert.strictEqual(out.state.phase, "recording");
  assert.strictEqual(out.state.firstBufferMs, 62);
  assert.deepStrictEqual(out.state.site, SITE);
  assert.strictEqual(out.state.pressedAt, 1000);
  eqActions(out.actions, [
    { type: "indicator", mode: "live", text: "" },
    { type: "log", line: "[dictate] mic live press-to-first-buffer=62ms" },
  ]);
});

test("rule 8: first-buffer elsewhere is ignored", () => {
  for (const phase of PHASES.filter((p) => p !== "arming")) {
    const from = at(phase);
    const out = reduce(from, firstBuffer(62));
    assert.deepStrictEqual(out.state, from, phase);
    assert.deepStrictEqual(out.actions, ignored("first-buffer", phase), phase);
  }
});

// ---- rule 9, 10: partial

test("rule 9: partial in recording trims and collapses whitespace", () => {
  const out = reduce(at("recording"), partial("  add   a\tbloom\n filter  "));
  assert.strictEqual(out.state.phase, "recording");
  assert.strictEqual(out.state.partial, "add a bloom filter");
  eqActions(out.actions, [{ type: "indicator", mode: "live", text: "add a bloom filter" }]);
});

test("rule 9: a later partial replaces the earlier one", () => {
  const r = run([...PATH.recording, partial("add a"), partial("add a bloom")]);
  assert.strictEqual(r.final.partial, "add a bloom");
  eqActions(r.last, [{ type: "indicator", mode: "live", text: "add a bloom" }]);
});

test("rule 9: an empty partial still updates to the empty string", () => {
  const r = run([...PATH.recording, partial("add a"), partial("   ")]);
  assert.strictEqual(r.final.partial, "");
  eqActions(r.last, [{ type: "indicator", mode: "live", text: "" }]);
});

test("rule 10: partial elsewhere is ignored", () => {
  for (const phase of PHASES.filter((p) => p !== "recording")) {
    const from = at(phase);
    const out = reduce(from, partial("hello"));
    assert.deepStrictEqual(out.state, from, phase);
    assert.deepStrictEqual(out.actions, ignored("partial", phase), phase);
  }
});

// ---- rule 11..15: stopped

test("rule 11: stopped with a failure in finalising, stderr as detail", () => {
  const out = reduce(at("finalising"), stopped(0, { failure: "no-device", stderr: "ALSA: no default device" }));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  eqActions(out.actions, [
    { type: "unmute" },
    { type: "indicator", mode: "off" },
    { type: "refuse", kind: "no-device", detail: "ALSA: no default device" },
    { type: "log", line: "[dictate] capture failed: no-device" },
  ]);
});

test("rule 11: stopped with a failure and no stderr has no detail", () => {
  for (const failure of ["binary-missing", "no-device", "device-denied", "failed"]) {
    const out = reduce(at("finalising"), stopped(1024, { failure }));
    assert.strictEqual(out.state.phase, "idle", failure);
    eqActions(out.actions, [
      { type: "unmute" },
      { type: "indicator", mode: "off" },
      { type: "refuse", kind: failure },
      { type: "log", line: `[dictate] capture failed: ${failure}` },
    ]);
  }
});

test("rule 11: a failure wins over non-zero pcmBytes", () => {
  const out = reduce(at("finalising"), stopped(99999, { failure: "device-denied" }));
  assert.strictEqual(out.state.phase, "idle");
  assert.strictEqual(out.actions[2].kind, "device-denied");
  assert.ok(!out.actions.some((a) => a.type === "transcribe"));
});

test("rule 12: stopped with zero bytes and no failure refuses empty-transcript", () => {
  const out = reduce(at("finalising"), stopped(0));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  eqActions(out.actions, [
    { type: "unmute" },
    { type: "indicator", mode: "off" },
    { type: "refuse", kind: "empty-transcript" },
    { type: "log", line: "[dictate] no audio captured" },
  ]);
});

test("rule 13: stopped with audio in finalising transcribes and keeps the state", () => {
  const from = at("finalising");
  const out = reduce(from, stopped(4096));
  assert.deepStrictEqual(out.state, from);
  eqActions(out.actions, [{ type: "transcribe" }]);
});

test("rule 13: one byte of audio is audio", () => {
  const out = reduce(at("finalising"), stopped(1));
  assert.strictEqual(out.state.phase, "finalising");
  eqActions(out.actions, [{ type: "transcribe" }]);
});

for (const phase of ["arming", "recording"]) {
  test(`rule 14: stopped in ${phase} with a failure is the child dying`, () => {
    const out = reduce(at(phase), stopped(0, { failure: "device-denied", stderr: "denied" }));
    assert.deepStrictEqual(out.state, { phase: "idle" });
    eqActions(out.actions, [
      { type: "unmute" },
      { type: "indicator", mode: "off" },
      { type: "refuse", kind: "device-denied", detail: "denied" },
      { type: "log", line: "[dictate] capture failed: device-denied" },
    ]);
  });

  test(`rule 14: stopped in ${phase} without a failure refuses failed`, () => {
    const out = reduce(at(phase), stopped(4096));
    assert.deepStrictEqual(out.state, { phase: "idle" });
    eqActions(out.actions, [
      { type: "unmute" },
      { type: "indicator", mode: "off" },
      { type: "refuse", kind: "failed" },
      { type: "log", line: "[dictate] capture failed: failed" },
    ]);
  });
}

test("rule 15: stopped in idle, requesting and ghost is ignored", () => {
  for (const phase of ["idle", "requesting", "ghost"]) {
    const from = at(phase);
    const out = reduce(from, stopped(0, { failure: "failed" }));
    assert.deepStrictEqual(out.state, from, phase);
    assert.deepStrictEqual(out.actions, ignored("stopped", phase), phase);
  }
});

// ---- rule 16, 17: transcript

test("rule 16: a clean transcript moves to requesting with the cleaned sentence", () => {
  const out = reduce(at("finalising"), transcript("add a bloom filter", 40));
  assert.strictEqual(out.state.phase, "requesting");
  assert.strictEqual(out.state.heard, "Add a bloom filter.");
  assert.deepStrictEqual(out.state.site, SITE);
  assert.strictEqual(out.state.languageId, "typescript");
  assert.strictEqual(out.state.indentColumns, 4);
  eqActions(out.actions, [
    { type: "unmute" },
    { type: "indicator", mode: "heard", text: "Add a bloom filter." },
    { type: "log", line: "[dictate] heard: Add a bloom filter. (decode=40ms)" },
    { type: "build-intent", sentence: "Add a bloom filter.", languageId: "typescript", indentColumns: 4 },
  ]);
});

test("rule 16: an already terminated, capitalised sentence passes through unchanged", () => {
  const out = reduce(at("finalising"), transcript("Add a bloom filter.", 7));
  assert.strictEqual(out.state.heard, "Add a bloom filter.");
  assert.deepStrictEqual(out.actions[2], { type: "log", line: "[dictate] heard: Add a bloom filter. (decode=7ms)" });
});

test("rule 16: stripped tokens appear in the log tail", () => {
  const out = reduce(at("finalising"), transcript("um, add a bloom filter [BLANK_AUDIO]", 40));
  assert.strictEqual(out.state.phase, "requesting");
  assert.strictEqual(out.state.heard, "Add a bloom filter.");
  const log = out.actions[2];
  assert.strictEqual(log.type, "log");
  assert.ok(log.line.startsWith("[dictate] heard: Add a bloom filter. (decode=40ms, stripped: "), log.line);
  assert.ok(log.line.endsWith(")"), log.line);
  assert.ok(/stripped: .*um/.test(log.line), log.line);
  assert.ok(/stripped: .*BLANK_AUDIO/.test(log.line), log.line);
  assert.deepStrictEqual(out.actions[3], { type: "build-intent", sentence: "Add a bloom filter.", languageId: "typescript", indentColumns: 4 });
});

test("rule 16: build-intent carries the language and indent of the press", () => {
  const fin = run([press({ languageId: "python", indentColumns: 8 }), firstBuffer(10), press({ now: 2000 })]).final;
  const out = reduce(fin, transcript("return early"));
  assert.deepStrictEqual(out.actions[3], { type: "build-intent", sentence: "Return early.", languageId: "python", indentColumns: 8 });
});

test("rule 16: an empty transcript refuses empty-transcript", () => {
  const out = reduce(at("finalising"), transcript("", 40));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  eqActions(out.actions, [
    { type: "unmute" },
    { type: "indicator", mode: "off" },
    { type: "refuse", kind: "empty-transcript" },
    { type: "log", line: "[dictate] heard nothing (decode=40ms)" },
  ]);
});

test("rule 16: a transcript that is only noise tokens is heard nothing", () => {
  const out = reduce(at("finalising"), transcript(" [BLANK_AUDIO] ", 12));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  assert.strictEqual(out.actions[2].kind, "empty-transcript");
  assert.deepStrictEqual(out.actions[3], { type: "log", line: "[dictate] heard nothing (decode=12ms)" });
});

test("rule 17: transcript elsewhere is ignored", () => {
  for (const phase of PHASES.filter((p) => p !== "finalising")) {
    const from = at(phase);
    const out = reduce(from, transcript("add a bloom filter"));
    assert.deepStrictEqual(out.state, from, phase);
    assert.deepStrictEqual(out.actions, ignored("transcript", phase), phase);
  }
});

// ---- rule 18, 19: intent

test("rule 18: intent in requesting triggers the FIM at the press site", () => {
  const from = at("requesting");
  const out = reduce(from, intent("// Add a bloom filter.", 3, 1));
  assert.deepStrictEqual(out.state, from);
  eqActions(out.actions, [
    { type: "trigger-fim", site: SITE, comment: "// Add a bloom filter." },
    { type: "log", line: "[dictate] intent matched=3 refused=1" },
  ]);
});

test("rule 18: the intent rides on the site of the press, not a later caret", () => {
  const seq = [...PATH.recording, cursorMoved(OTHER_LINE), press({ now: 1500 }), stopped(10), transcript("do it"), intent("# Do it.", 0, 0)];
  const r = run(seq);
  eqActions(r.last, [
    { type: "trigger-fim", site: SITE, comment: "# Do it." },
    { type: "log", line: "[dictate] intent matched=0 refused=0" },
  ]);
});

test("rule 19: intent elsewhere is ignored", () => {
  for (const phase of PHASES.filter((p) => p !== "requesting")) {
    const from = at(phase);
    const out = reduce(from, intent());
    assert.deepStrictEqual(out.state, from, phase);
    assert.deepStrictEqual(out.actions, ignored("intent", phase), phase);
  }
});

// ---- rule 20..22: served

test("rule 20: served with a ghost moves to ghost keeping heard and site", () => {
  const from = at("requesting");
  const out = reduce(from, served(true));
  assert.strictEqual(out.state.phase, "ghost");
  assert.strictEqual(out.state.heard, from.heard);
  assert.strictEqual(out.state.heard, "Add a bloom filter.");
  assert.deepStrictEqual(out.state.site, SITE);
  eqActions(out.actions, [{ type: "log", line: "[dictate] ghost served" }]);
});

test("rule 21: served without a ghost ends in idle", () => {
  const out = reduce(at("requesting"), served(false));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  eqActions(out.actions, [
    { type: "indicator", mode: "off" },
    { type: "log", line: "[dictate] no ghost for the intent" },
  ]);
});

test("rule 22: served elsewhere is ignored", () => {
  for (const phase of PHASES.filter((p) => p !== "requesting")) {
    const from = at(phase);
    for (const ghost of [true, false]) {
      const out = reduce(from, served(ghost));
      assert.deepStrictEqual(out.state, from, phase);
      assert.deepStrictEqual(out.actions, ignored("served", phase), phase);
    }
  }
});

// ---- rule 23..25: accepted, dismissed

test("rule 23: accepted in ghost ends it", () => {
  const out = reduce(at("ghost"), accepted());
  assert.deepStrictEqual(out.state, { phase: "idle" });
  eqActions(out.actions, [
    { type: "indicator", mode: "off" },
    { type: "log", line: "[dictate] ghost accepted" },
  ]);
});

test("rule 23: dismissed in ghost ends it", () => {
  const out = reduce(at("ghost"), dismissed());
  assert.deepStrictEqual(out.state, { phase: "idle" });
  eqActions(out.actions, [
    { type: "indicator", mode: "off" },
    { type: "log", line: "[dictate] ghost dismissed" },
  ]);
});

test("rule 24: dismissed in requesting ends it the same way", () => {
  const out = reduce(at("requesting"), dismissed());
  assert.deepStrictEqual(out.state, { phase: "idle" });
  eqActions(out.actions, [
    { type: "indicator", mode: "off" },
    { type: "log", line: "[dictate] ghost dismissed" },
  ]);
});

test("rule 24: accepted in requesting is ignored", () => {
  const from = at("requesting");
  const out = reduce(from, accepted());
  assert.deepStrictEqual(out.state, from);
  assert.deepStrictEqual(out.actions, ignored("accepted", "requesting"));
});

test("rule 25: accepted and dismissed elsewhere are ignored", () => {
  for (const phase of ["idle", "arming", "recording", "finalising"]) {
    const from = at(phase);
    for (const ev of [accepted(), dismissed()]) {
      const out = reduce(from, ev);
      assert.deepStrictEqual(out.state, from, `${ev.type} in ${phase}`);
      assert.deepStrictEqual(out.actions, ignored(ev.type, phase), `${ev.type} in ${phase}`);
    }
  }
});

// ---- rule 26..28: edit, cursor-moved

for (const phase of ["ghost", "requesting"]) {
  for (const mk of [edit, cursorMoved]) {
    const type = mk().type;
    test(`rule 26: ${type} on a different line in ${phase} leaves the site`, () => {
      const out = reduce(at(phase), mk(OTHER_LINE));
      assert.deepStrictEqual(out.state, { phase: "idle" });
      eqActions(out.actions, [
        { type: "indicator", mode: "off" },
        { type: "log", line: "[dictate] site left" },
      ]);
    });

    test(`rule 26: ${type} in a different uri in ${phase} leaves the site`, () => {
      const out = reduce(at(phase), mk(OTHER_URI));
      assert.deepStrictEqual(out.state, { phase: "idle" });
      eqActions(out.actions, [
        { type: "indicator", mode: "off" },
        { type: "log", line: "[dictate] site left" },
      ]);
    });

    test(`rule 26: ${type} on the same site in ${phase} is ignored`, () => {
      const from = at(phase);
      // A fresh object with equal fields: the comparison is by uri and line.
      const out = reduce(from, mk({ uri: SITE.uri, line: SITE.line }));
      assert.deepStrictEqual(out.state, from);
      assert.deepStrictEqual(out.actions, ignored(type, phase));
    });
  }
}

test("rule 26 then 23: an accept lands as a same-line edit first, then accepted", () => {
  const r = run([...PATH.ghost, edit(SITE), accepted()]);
  assert.deepStrictEqual(r.states[r.states.length - 2].phase, "ghost");
  assert.deepStrictEqual(r.final, { phase: "idle" });
  eqActions(r.last, [{ type: "indicator", mode: "off" }, { type: "log", line: "[dictate] ghost accepted" }]);
});

test("rule 27: edit and cursor-moved during capture are ignored, mic stays open", () => {
  for (const phase of ["arming", "recording", "finalising"]) {
    const from = at(phase);
    for (const mk of [edit, cursorMoved]) {
      for (const site of [SITE, OTHER_LINE, OTHER_URI]) {
        const out = reduce(from, mk(site));
        assert.deepStrictEqual(out.state, from, `${mk().type} in ${phase}`);
        assert.deepStrictEqual(out.actions, ignored(mk().type, phase), `${mk().type} in ${phase}`);
      }
    }
  }
});

test("rule 28: edit and cursor-moved in idle are ignored", () => {
  for (const mk of [edit, cursorMoved]) {
    const out = reduce(IDLE, mk(OTHER_URI));
    assert.deepStrictEqual(out.state, { phase: "idle" });
    assert.deepStrictEqual(out.actions, ignored(mk().type, "idle"));
  }
});

// ---- rule 29, 30: error

for (const phase of ["arming", "recording", "finalising"]) {
  test(`rule 29: error in ${phase} aborts the capture`, () => {
    const out = reduce(at(phase), error("mic exploded"));
    assert.deepStrictEqual(out.state, { phase: "idle" });
    eqActions(out.actions, [
      { type: "abort-capture" },
      { type: "unmute" },
      { type: "indicator", mode: "off" },
      { type: "refuse", kind: "failed", detail: "mic exploded" },
      { type: "log", line: "[dictate] error: mic exploded" },
    ]);
  });
}

for (const phase of ["requesting", "ghost"]) {
  test(`rule 29: error in ${phase} has no abort-capture`, () => {
    const out = reduce(at(phase), error("server gone"));
    assert.deepStrictEqual(out.state, { phase: "idle" });
    eqActions(out.actions, [
      { type: "unmute" },
      { type: "indicator", mode: "off" },
      { type: "refuse", kind: "failed", detail: "server gone" },
      { type: "log", line: "[dictate] error: server gone" },
    ]);
  });
}

test("rule 30: error in idle only logs", () => {
  const out = reduce(IDLE, error("late failure"));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  eqActions(out.actions, [{ type: "log", line: "[dictate] error: late failure" }]);
});

// ---- malformed input (contract preamble)

test("malformed: undefined state returns IDLE and no actions", () => {
  assert.deepStrictEqual(reduce(undefined, press()), { state: { phase: "idle" }, actions: [] });
});

test("malformed: null event returns IDLE and no actions", () => {
  assert.deepStrictEqual(reduce(at("recording"), null), { state: { phase: "idle" }, actions: [] });
});

test("malformed: unknown event type returns IDLE and no actions", () => {
  assert.deepStrictEqual(reduce(at("ghost"), { type: "bogus" }), { state: { phase: "idle" }, actions: [] });
});

test("malformed: non-object state and event", () => {
  assert.deepStrictEqual(reduce("arming", press()), { state: { phase: "idle" }, actions: [] });
  assert.deepStrictEqual(reduce(IDLE, 42), { state: { phase: "idle" }, actions: [] });
  assert.deepStrictEqual(reduce(null, null), { state: { phase: "idle" }, actions: [] });
  assert.deepStrictEqual(reduce(IDLE, "press"), { state: { phase: "idle" }, actions: [] });
});

test("malformed: an event with no type at all", () => {
  assert.deepStrictEqual(reduce(IDLE, {}), { state: { phase: "idle" }, actions: [] });
  assert.deepStrictEqual(reduce(IDLE, { site: SITE }), { state: { phase: "idle" }, actions: [] });
});

test("ignored line format is exactly '[dictate] ignored <type> in <phase>'", () => {
  const out = reduce(at("recording"), intent());
  assert.deepStrictEqual(out.actions, [{ type: "log", line: "[dictate] ignored intent in recording" }]);
  assert.strictEqual(out.actions.length, 1);
});

// ---- whole-journey rows

test("journey: press, talk, press, transcribe, intent, ghost, accept", () => {
  const r = run([
    press({ now: 1000, ghostVisible: false }),
    firstBuffer(62),
    partial("add"),
    partial("add a bloom"),
    press({ now: 2500 }),
    stopped(8192),
    transcript("add a bloom filter", 90),
    intent("// Add a bloom filter.", 2, 0),
    served(true),
    edit(SITE),
    accepted(),
  ]);
  assert.deepStrictEqual(r.states.map((s) => s.phase), [
    "arming", "recording", "recording", "recording", "finalising", "finalising", "requesting", "requesting", "ghost", "ghost", "idle",
  ]);
  const types = r.actions.flat().map((a) => a.type);
  assert.deepStrictEqual(types.filter((t) => t === "start-capture").length, 1);
  assert.deepStrictEqual(types.filter((t) => t === "stop-capture").length, 1);
  assert.deepStrictEqual(types.filter((t) => t === "unmute").length, 1);
  assert.deepStrictEqual(types.filter((t) => t === "mute").length, 1);
  assert.deepStrictEqual(r.final, { phase: "idle" });
});

test("journey: second press while a ghost shows dismisses it and re-records", () => {
  const r = run([...PATH.ghost, press({ now: 5000, ghostVisible: true }), firstBuffer(40), press({ now: 5600 }), stopped(100), transcript("try again")]);
  assert.strictEqual(r.final.phase, "requesting");
  assert.strictEqual(r.final.heard, "Try again.");
  assert.strictEqual(r.final.partial, undefined);
  const rerecord = r.actions[PATH.ghost.length];
  assert.strictEqual(rerecord[0].type, "hide-ghost");
  assert.strictEqual(rerecord.filter((a) => a.type === "hide-ghost").length, 1);
  assert.deepStrictEqual(r.actions[PATH.ghost.length + 2][2], { type: "log", line: "[dictate] stop after 600ms" });
});

// ---- invariant sweeps

const CAPTURE = new Set(["arming", "recording", "finalising"]);

// Applies the four sweep invariants to one step. `tracker` carries the
// open-capture flag across steps for the third invariant.
const KNOWN_TYPES = new Set(["press", "first-buffer", "partial", "stopped", "transcript", "intent", "served", "accepted", "dismissed", "edit", "cursor-moved", "error"]);
const isMalformed = (ev) => !ev || typeof ev !== "object" || !KNOWN_TYPES.has(ev.type);

function checkStep(prev, next, actions, tracker, label, ev) {
  // The contract's malformed rule forgets everything ({ IDLE, [] }), so the
  // invariants are stated over well-formed events only; a malformed step just
  // has to answer as the preamble says, and the adapter's capture is treated
  // as gone.
  if (isMalformed(ev)) {
    assert.deepStrictEqual({ state: next, actions }, { state: { phase: "idle" }, actions: [] }, `${label}: malformed answer`);
    tracker.open = false;
    return;
  }
  const types = actions.map((a) => a.type);
  // Invariant 1: start-capture only when the state moves to arming.
  if (types.includes("start-capture")) {
    assert.strictEqual(next.phase, "arming", `${label}: start-capture without arming`);
  }
  // Invariant 2: a capture phase back to idle carries unmute once and the
  // indicator ends off; finalising to requesting carries unmute once and the
  // indicator goes heard.
  const unmutes = types.filter((t) => t === "unmute").length;
  const indicators = actions.filter((a) => a.type === "indicator");
  if (CAPTURE.has(prev.phase) && next.phase === "idle") {
    assert.strictEqual(unmutes, 1, `${label}: ${prev.phase}->idle unmute count`);
    assert.ok(indicators.length > 0, `${label}: ${prev.phase}->idle without an indicator`);
    assert.strictEqual(indicators[indicators.length - 1].mode, "off", `${label}: ${prev.phase}->idle indicator`);
  }
  if (prev.phase === "finalising" && next.phase === "requesting") {
    assert.strictEqual(unmutes, 1, `${label}: finalising->requesting unmute count`);
    assert.ok(indicators.some((i) => i.mode === "heard"), `${label}: no heard indicator`);
    assert.ok(!indicators.some((i) => i.mode === "off"), `${label}: indicator off on the way to requesting`);
  }
  // Invariant 3: no two start-capture without a stop or abort between them.
  // Careful reading: a `stopped` event consumed in a capture phase (rule 14,
  // the child died) closes the capture too; nothing is left to stop.
  if (ev.type === "stopped" && CAPTURE.has(prev.phase) && next.phase === "idle") tracker.open = false;
  for (const t of types) {
    if (t === "start-capture") {
      assert.strictEqual(tracker.open, false, `${label}: second start-capture without stop/abort`);
      tracker.open = true;
    } else if (t === "stop-capture" || t === "abort-capture") {
      tracker.open = false;
    }
  }
  // Invariant 4: heard only in requesting/ghost; partial only from recording
  // on until requesting (careful reading: allowed in recording, finalising and
  // requesting; never in idle, arming or ghost).
  if (next.heard !== undefined) {
    assert.ok(["requesting", "ghost"].includes(next.phase), `${label}: heard set in ${next.phase}`);
  }
  if (next.partial !== undefined) {
    assert.ok(["recording", "finalising", "requesting"].includes(next.phase), `${label}: partial set in ${next.phase}`);
  }
  // Preamble: reduce answers with a well-formed result.
  assert.ok(next && typeof next === "object" && typeof next.phase === "string", `${label}: bad state`);
  assert.ok(Array.isArray(actions), `${label}: actions not an array`);
  for (const a of actions) assert.strictEqual(typeof a.type, "string", `${label}: action without type`);
}

// `events` is an array, or a function of the current phase for random walks.
function sweep(events, label, from = IDLE, steps = events.length) {
  const tracker = { open: false };
  let state = from;
  for (let i = 0; i < steps; i++) {
    const ev = typeof events === "function" ? events(state.phase) : events[i];
    let out;
    assert.doesNotThrow(() => { out = reduce(state, ev); }, `${label} step ${i}: reduce threw`);
    checkStep(state, out.state, out.actions, tracker, `${label} step ${i} (${ev && ev.type} in ${state.phase})`, ev);
    state = out.state;
  }
  return state;
}

test("sweep: hand-built sequences hold the invariants", () => {
  const seqs = {
    happy: [...PATH.ghost, accepted()],
    cancelBeforeMic: [press(), press({ now: 1100 }), press({ now: 1200 }), firstBuffer(5), press({ now: 1300 }), stopped(0)],
    childDies: [press(), firstBuffer(5), stopped(0, { failure: "no-device" }), press({ now: 2000 }), stopped(0)],
    noGhost: [...PATH.requesting, intent(), served(false), press({ now: 3000 })],
    rerecordTwice: [...PATH.ghost, press({ now: 4000, ghostVisible: true }), firstBuffer(3), press({ now: 4300 }), stopped(50), transcript("again"), press({ now: 5000 }), firstBuffer(2), press({ now: 5100 }), stopped(50), transcript("and again"), intent(), served(true), dismissed()],
    errorsEverywhere: PHASES.flatMap((p) => [...PATH[p], error("boom")]),
    siteLeft: [...PATH.ghost, cursorMoved(OTHER_LINE), ...PATH.requesting, edit(OTHER_URI)],
    heardNothing: [...PATH.finalising, stopped(10), transcript("  ", 3), ...PATH.finalising, stopped(0)],
    noise: PHASES.flatMap((p) => [...PATH[p], firstBuffer(1), partial("x"), intent(), served(true), accepted(), dismissed(), edit(SITE), cursorMoved(SITE), error("e")]),
  };
  for (const [name, seq] of Object.entries(seqs)) sweep(seq, name);
});

// Seeded LCG so a failure is reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Uniform over every event type most of the time; the rest of the time an
// event the contract makes applicable in `phase`, so the walk actually
// reaches requesting and ghost instead of resetting forever.
const APPLICABLE = {
  idle: ["press"],
  arming: ["first-buffer"],
  recording: ["partial", "press"],
  finalising: ["stopped-audio", "transcript"],
  requesting: ["intent", "served"],
  ghost: ["accepted", "dismissed", "press", "edit"],
};

function randomEvent(rand, clock, phase = "idle") {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const kinds = ["press", "first-buffer", "partial", "stopped", "transcript", "intent", "served", "accepted", "dismissed", "edit", "cursor-moved", "error", "malformed"];
  const kind = rand() < 0.6 ? pick(APPLICABLE[phase]) : pick(kinds);
  const sites = [SITE, OTHER_LINE, OTHER_URI];
  switch (kind) {
    case "press": {
      const ready = { ...READY };
      if (rand() < 0.15) {
        const key = pick(["remote", "binaryPresent", "modelPresent", "recogniserAlive", "served", "commentRow", "inComment"]);
        ready[key] = !ready[key];
      }
      clock.now += Math.floor(rand() * 2000);
      return press({ now: clock.now, ghostVisible: rand() < 0.5, site: pick(sites), languageId: pick(["typescript", "rust", "go"]), indentColumns: Math.floor(rand() * 9), ready });
    }
    case "stopped-audio": return stopped(1 + Math.floor(rand() * 100000));
    case "first-buffer": return firstBuffer(Math.floor(rand() * 500));
    case "partial": return partial(pick(["", "  ", "add", "add a  bloom", "\tfilter\n"]));
    case "stopped": {
      const failure = rand() < 0.3 ? pick(["binary-missing", "no-device", "device-denied", "failed"]) : undefined;
      const extra = {};
      if (failure) extra.failure = failure;
      if (rand() < 0.5) extra.stderr = "stderr text";
      return stopped(rand() < 0.3 ? 0 : Math.floor(rand() * 100000), extra);
    }
    case "transcript": return transcript(pick(["", "  ", "[BLANK_AUDIO]", "add a bloom filter", "um, return early", "Use a mutex."]), Math.floor(rand() * 300));
    case "intent": return intent("// x", Math.floor(rand() * 5), Math.floor(rand() * 5));
    case "served": return served(rand() < 0.5);
    case "accepted": return accepted();
    case "dismissed": return dismissed();
    case "edit": return edit(pick(sites));
    case "cursor-moved": return cursorMoved(pick(sites));
    case "error": return error(pick(["boom", "server gone"]));
    default: return pick([null, undefined, 7, "press", {}, { type: "bogus" }, { type: 3 }]);
  }
}

for (const seed of [1, 42, 2026]) {
  test(`sweep: 2000 seeded random steps (seed ${seed}) hold the invariants`, () => {
    const rand = rng(seed);
    const clock = { now: 0 };
    const visited = new Set();
    const tracker = { open: false };
    let state = IDLE;
    for (let i = 0; i < 2000; i++) {
      const ev = randomEvent(rand, clock, state.phase);
      let out;
      assert.doesNotThrow(() => { out = reduce(state, ev); }, `seed ${seed} step ${i}: reduce threw`);
      checkStep(state, out.state, out.actions, tracker, `seed ${seed} step ${i} (${ev && ev.type} in ${state.phase})`, ev);
      // Preamble: an ignored event returns the same state.
      if (out.actions.length === 1 && out.actions[0].type === "log" && /^\[dictate\] ignored /.test(out.actions[0].line)) {
        assert.deepStrictEqual(out.state, state, `seed ${seed} step ${i}: ignored event changed the state`);
        assert.strictEqual(out.actions[0].line, `[dictate] ignored ${ev.type} in ${state.phase}`);
      }
      state = out.state;
      visited.add(state.phase);
    }
    // The generator must actually exercise the machine, or the sweep is hollow.
    assert.strictEqual(visited.size, 6, `seed ${seed}: only visited ${[...visited].join(",")}`);
  });
}

test("sweep: random steps from every phase as the starting state", () => {
  const rand = rng(7);
  for (const phase of PHASES) {
    const clock = { now: 10000 };
    sweep((p) => randomEvent(rand, clock, p), `from ${phase}`, at(phase), 300);
  }
});
