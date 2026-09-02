// Blind oracle for session-v67 phase 1: the comment site in the dictation
// reducer (src/core/dictationGesture). Written against
// session-v67/contracts/phase1-reducer.md rules 1..9 and invariants I1..I5,
// on top of session-v65/contracts/phase4-gesture.md as amended by
// session-v66/contracts/phase2-gesture.md; nothing here reads src/**.
//
// Run: SKIP_LIVE=1 node --test test/blind-v67-p1-reducer.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// `cleanTranscript` is the contract's named cleaner (rule 5); it is bundled
// beside the reducer so a row can compare the inserted sentence with what the
// cleaner says, instead of re-deriving the cleaning here.
const { mod, cleanup } = bundleCore(
  "blind-v67-p1-reducer",
  'export * from "../src/core/dictationGesture";\nexport { cleanTranscript } from "../src/core/dictation";\n'
);
const { reduce, IDLE, cleanTranscript } = mod;
test.after(cleanup);

// ---- fixtures (the v65 shapes)

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
// The same press with the caret inside a comment.
const pressC = (over = {}) => press({ ...over, ready: { inComment: true, ...(over.ready || {}) } });
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
const cancel = (now = 1500) => ({ type: "cancel", now });
const nothingLanded = () => ({ type: "nothing-landed" });

const log = (line) => ({ type: "log", line });
const UNMUTE = { type: "unmute" };
const OFF = { type: "indicator", mode: "off" };

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

// Optional fields are spelled absent; a JSON round-trip drops undefined keys.
const plain = (v) => JSON.parse(JSON.stringify(v));
const eqActions = (got, want) => assert.deepStrictEqual(plain(got), plain(want));
const ignored = (type, phase) => [log(`[dictate] ignored ${type} in ${phase}`)];
const types = (actions) => actions.map((a) => a.type);
const withoutCommentSite = (state) => {
  const copy = { ...state };
  delete copy.commentSite;
  return plain(copy);
};

// Reachable states on a line site (L) and on a comment site (C). The stop
// press on a comment site carries inComment: true, as the real second press
// would (the caret is still in the comment).
const PATH_L = {
  arming: [press()],
  recording: [press(), firstBuffer(62)],
  "recording with a partial": [press(), firstBuffer(62), partial("add a")],
  finalising: [press(), firstBuffer(62), press({ now: 1500 })],
  "finalising with a partial": [press(), firstBuffer(62), partial("add a"), press({ now: 1500 })],
  "finalising while decoding": [press(), firstBuffer(62), press({ now: 1500 }), stopped(4096)],
};
const PATH_C = {
  arming: [pressC()],
  recording: [pressC(), firstBuffer(62)],
  "recording with a partial": [pressC(), firstBuffer(62), partial("add a")],
  finalising: [pressC(), firstBuffer(62), pressC({ now: 1500 })],
  "finalising with a partial": [pressC(), firstBuffer(62), partial("add a"), pressC({ now: 1500 })],
  "finalising while decoding": [pressC(), firstBuffer(62), pressC({ now: 1500 }), stopped(4096)],
};
const LINE_ONLY = {
  requesting: [...PATH_L.finalising, stopped(4096), transcript("add a bloom filter")],
  "requesting after intent": [...PATH_L.finalising, stopped(4096), transcript("add a bloom filter"), intent()],
  ghost: [...PATH_L.finalising, stopped(4096), transcript("add a bloom filter"), intent(), served(true)],
};
const CAPTURE_NAMES = Object.keys(PATH_C);
const phaseOf = (name) => name.split(" ")[0];
const atL = (name) => run(PATH_L[name] || LINE_ONLY[name]).final;
const atC = (name) => run(PATH_C[name]).final;

test("fixture paths reach every capture phase on both site kinds", () => {
  for (const name of CAPTURE_NAMES) {
    assert.strictEqual(atL(name).phase, phaseOf(name), `line ${name}`);
    assert.strictEqual(atC(name).phase, phaseOf(name), `comment ${name}`);
  }
  for (const name of Object.keys(LINE_ONLY)) assert.strictEqual(atL(name).phase, phaseOf(name), name);
  assert.deepStrictEqual(IDLE, { phase: "idle" });
});

// ---- rule 1: inComment is no longer a refusal input; the other six stand

test("rule 1: inComment true with every other check passing does not refuse", () => {
  const out = reduce(IDLE, pressC());
  assert.strictEqual(out.state.phase, "arming");
  assert.ok(!types(out.actions).includes("refuse"), "no refuse action");
  assert.ok(!out.actions.some((a) => a.type === "log" && /refused/.test(a.line)), "no refused log");
});

const REFUSALS = [
  { ready: { remote: true }, kind: "remote" },
  { ready: { binaryPresent: false }, kind: "binary-missing" },
  { ready: { modelPresent: false }, kind: "model-missing" },
  { ready: { recogniserAlive: false }, kind: "server-down" },
  { ready: { served: false }, kind: "not-served", detail: "typescript" },
  { ready: { commentRow: false }, kind: "no-comment-row", detail: "typescript" },
];

for (const r of REFUSALS) {
  test(`rule 1: ${r.kind} still refuses with the two-action shape, inComment either way`, () => {
    for (const inComment of [false, true]) {
      const out = reduce(IDLE, press({ ready: { ...r.ready, inComment } }));
      assert.deepStrictEqual(out.state, { phase: "idle" }, `inComment=${inComment}`);
      assert.strictEqual(out.actions.length, 2, `inComment=${inComment}`);
      assert.strictEqual(out.actions[0].type, "refuse");
      assert.strictEqual(out.actions[0].kind, r.kind);
      if (r.detail !== undefined) assert.strictEqual(out.actions[0].detail, r.detail);
      assert.deepStrictEqual(out.actions[1], log(`[dictate] refused: ${r.kind}`));
    }
  });
}

test("rule 1: the six refusals keep their order, and inComment does not join the order", () => {
  for (let i = 0; i < REFUSALS.length; i++) {
    for (let j = i + 1; j < REFUSALS.length; j++) {
      for (const inComment of [false, true]) {
        const out = reduce(IDLE, press({ ready: { ...REFUSALS[i].ready, ...REFUSALS[j].ready, inComment } }));
        assert.strictEqual(out.actions[0].kind, REFUSALS[i].kind, `${REFUSALS[i].kind}+${REFUSALS[j].kind} inComment=${inComment}`);
        assert.strictEqual(out.state.phase, "idle");
      }
    }
  }
});

test("rule 1: refuse never carries the retired in-comment kind", () => {
  const keys = ["remote", "binaryPresent", "modelPresent", "recogniserAlive", "served", "commentRow"];
  // Every subset of the six checks failing, with inComment true.
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    const ready = { inComment: true };
    keys.forEach((k, i) => { if (mask & (1 << i)) ready[k] = !READY[k]; });
    const out = reduce(IDLE, press({ ready }));
    for (const a of out.actions) {
      if (a.type === "refuse") assert.notStrictEqual(a.kind, "in-comment", `mask ${mask}`);
      if (a.type === "log") assert.ok(!/in-comment/.test(a.line), `mask ${mask}: ${a.line}`);
    }
    if (mask === 0) assert.strictEqual(out.state.phase, "arming", "nothing failing arms");
    else assert.strictEqual(out.state.phase, "idle", `mask ${mask} refuses`);
  }
});

// ---- rule 2: the arming press on a comment site

test("rule 2: idle press on a comment site arms with commentSite true and nothing else new", () => {
  const out = reduce(IDLE, pressC({ now: 1234, indentColumns: 8, languageId: "go", site: OTHER_URI }));
  assert.deepStrictEqual(plain(out.state), {
    phase: "arming",
    site: OTHER_URI,
    languageId: "go",
    indentColumns: 8,
    pressedAt: 1234,
    commentSite: true,
  });
  assert.strictEqual(out.state.commentSite, true);
  assert.strictEqual(out.state.partial, undefined);
  assert.strictEqual(out.state.heard, undefined);
  assert.strictEqual(out.state.firstBufferMs, undefined);
});

test("rule 2: comment-site action order without a ghost showing, with the (comment) suffix", () => {
  const out = reduce(IDLE, pressC());
  eqActions(out.actions, [
    { type: "mute" },
    { type: "start-capture" },
    { type: "indicator", mode: "armed" },
    log("[dictate] press at file:///work/a.ts:10 (comment)"),
  ]);
});

test("rule 2: hide-ghost leads on a comment site when ghostVisible", () => {
  const out = reduce(IDLE, pressC({ ghostVisible: true }));
  eqActions(out.actions, [
    { type: "hide-ghost" },
    { type: "mute" },
    { type: "start-capture" },
    { type: "indicator", mode: "armed" },
    log("[dictate] press at file:///work/a.ts:10 (comment)"),
  ]);
});

test("rule 2: inComment false or absent arms with NO commentSite key and the old log line", () => {
  const withFalse = reduce(IDLE, press({ ready: { inComment: false } }));
  const absent = press();
  delete absent.ready.inComment;
  const withAbsent = reduce(IDLE, absent);
  for (const [label, out] of [["false", withFalse], ["absent", withAbsent]]) {
    assert.strictEqual(out.state.phase, "arming", label);
    assert.ok(!("commentSite" in out.state), `${label}: commentSite key present`);
    assert.deepStrictEqual(plain(out.state), { phase: "arming", site: SITE, languageId: "typescript", indentColumns: 4, pressedAt: 1000 }, label);
    eqActions(out.actions, [
      { type: "mute" },
      { type: "start-capture" },
      { type: "indicator", mode: "armed" },
      log("[dictate] press at file:///work/a.ts:10"),
    ]);
  }
  assert.deepStrictEqual(plain(withFalse), plain(withAbsent));
});

test("rule 2: a comment-site press differs from a line-site press only by commentSite and the log suffix", () => {
  const c = reduce(IDLE, pressC());
  const l = reduce(IDLE, press());
  assert.deepStrictEqual(withoutCommentSite(c.state), plain(l.state));
  assert.strictEqual(c.actions.length, l.actions.length);
  for (let i = 0; i < l.actions.length - 1; i++) assert.deepStrictEqual(plain(c.actions[i]), plain(l.actions[i]), `action ${i}`);
  assert.strictEqual(c.actions[c.actions.length - 1].line, `${l.actions[l.actions.length - 1].line} (comment)`);
});

// ---- rule 3: re-record from ghost or requesting reads inComment

// AMENDED 2026-09-03 (review F1): a re-record from requesting emits disarm-intent before hide-ghost, on any site kind; from ghost it does not.
const RERECORD_PREFIX = (name) => (name.startsWith("requesting") ? [{ type: "disarm-intent" }, { type: "hide-ghost" }] : [{ type: "hide-ghost" }]);

for (const name of ["ghost", "requesting", "requesting after intent"]) {
  test(`rule 3: re-record press from ${name} with inComment true arms a comment site`, () => {
    const from = atL(name);
    const out = reduce(from, pressC({ now: 9000, ghostVisible: false, site: OTHER_LINE, languageId: "rust", indentColumns: 2 }));
    assert.deepStrictEqual(plain(out.state), {
      phase: "arming",
      site: OTHER_LINE,
      languageId: "rust",
      indentColumns: 2,
      pressedAt: 9000,
      commentSite: true,
    });
    eqActions(out.actions, [
      ...RERECORD_PREFIX(name),
      { type: "mute" },
      { type: "start-capture" },
      { type: "indicator", mode: "armed" },
      log("[dictate] press at file:///work/a.ts:11 (comment) (re-record)"),
    ]);
  });

  test(`rule 3: re-record press from ${name} with inComment false has no commentSite key`, () => {
    const out = reduce(atL(name), press({ now: 9000, site: OTHER_LINE }));
    assert.strictEqual(out.state.phase, "arming");
    assert.ok(!("commentSite" in out.state));
    eqActions(out.actions, [
      ...RERECORD_PREFIX(name),
      { type: "mute" },
      { type: "start-capture" },
      { type: "indicator", mode: "armed" },
      log("[dictate] press at file:///work/a.ts:11 (re-record)"),
    ]);
  });
}

// AMENDED 2026-09-03 (review F1): the disarm-intent leads the requesting re-record whatever ghostVisible says; ghost never emits it.
test("rule 3: re-record from requesting leads with disarm-intent then exactly one hide-ghost; from ghost no disarm-intent", () => {
  for (const ghostVisible of [true, false]) {
    for (const mk of [press, pressC]) {
      const req = reduce(atL("requesting"), mk({ now: 9000, ghostVisible }));
      assert.deepStrictEqual(types(req.actions).slice(0, 2), ["disarm-intent", "hide-ghost"], `requesting ghostVisible=${ghostVisible}`);
      assert.strictEqual(req.actions.filter((a) => a.type === "hide-ghost").length, 1);
      assert.strictEqual(req.actions.filter((a) => a.type === "disarm-intent").length, 1);
      const gh = reduce(atL("ghost"), mk({ now: 9000, ghostVisible }));
      assert.strictEqual(gh.actions[0].type, "hide-ghost", `ghost ghostVisible=${ghostVisible}`);
      assert.ok(!types(gh.actions).includes("disarm-intent"), `ghost ghostVisible=${ghostVisible}: disarm-intent`);
      assert.strictEqual(gh.actions.filter((a) => a.type === "hide-ghost").length, 1);
    }
  }
});

test("rule 3: the re-record with ghostVisible true still emits exactly one hide-ghost on a comment site", () => {
  const out = reduce(atL("ghost"), pressC({ now: 9000, ghostVisible: true }));
  assert.strictEqual(out.actions.filter((a) => a.type === "hide-ghost").length, 1);
  assert.strictEqual(out.actions[0].type, "hide-ghost");
  assert.strictEqual(out.state.commentSite, true);
  assert.strictEqual(out.actions[out.actions.length - 1].line, "[dictate] press at file:///work/a.ts:10 (comment) (re-record)");
});

// ---- rule 4: the capture phases behave exactly as on a line site

// Every event the capture phases see, the press-as-cancel (arming), the
// press-as-stop (recording) and the ignored press (finalising) included.
const CAPTURE_EVENTS = [
  press({ now: 1500 }),
  press({ now: 1500, ghostVisible: true }),
  firstBuffer(62),
  partial("add a  bloom"),
  partial("   "),
  stopped(4096),
  stopped(1),
  stopped(0),
  stopped(0, { failure: "no-device", stderr: "ALSA: no default device" }),
  stopped(99999, { failure: "device-denied" }),
  stopped(1024, { failure: "binary-missing" }),
  stopped(0, { failure: "failed" }),
  error("mic exploded"),
  cancel(1500),
  cancel(NaN),
  { type: "cancel" },
  intent(),
  served(true),
  served(false),
  accepted(),
  dismissed(),
  nothingLanded(),
  edit(SITE),
  edit(OTHER_LINE),
  cursorMoved(OTHER_URI),
];

for (const name of CAPTURE_NAMES) {
  test(`rule 4: in ${name}, every event answers as on a line site, commentSite aside`, () => {
    const fromC = atC(name);
    const fromL = atL(name);
    assert.strictEqual(fromC.commentSite, true, `${name}: fixture lost commentSite`);
    assert.deepStrictEqual(withoutCommentSite(fromC), plain(fromL), `${name}: fixtures differ beyond commentSite`);
    for (const ev of CAPTURE_EVENTS) {
      const label = `${name} <- ${ev.type}${ev.failure ? ` ${ev.failure}` : ""}${ev.type === "stopped" ? ` ${ev.pcmBytes}` : ""}`;
      if (ev.type === "transcript") continue;
      const c = reduce(fromC, ev);
      const l = reduce(fromL, ev);
      assert.deepStrictEqual(withoutCommentSite(c.state), plain(l.state), `${label}: state`);
      assert.deepStrictEqual(plain(c.actions), plain(l.actions), `${label}: actions`);
      if (c.state.phase === "idle") {
        assert.deepStrictEqual(c.state, { phase: "idle" }, `${label}: idle result is not IDLE`);
      } else {
        assert.strictEqual(c.state.commentSite, true, `${label}: commentSite dropped in ${c.state.phase}`);
      }
    }
  });
}

test("rule 4: commentSite is kept through arming -> recording -> finalising and while decoding", () => {
  const r = run([pressC(), firstBuffer(62), partial("add a"), partial("add a bloom"), pressC({ now: 1500 }), stopped(4096)]);
  assert.deepStrictEqual(r.states.map((s) => s.phase), ["arming", "recording", "recording", "recording", "finalising", "finalising"]);
  for (const [i, s] of r.states.entries()) assert.strictEqual(s.commentSite, true, `step ${i}`);
  assert.strictEqual(r.final.partial, "add a bloom");
  assert.strictEqual(r.final.heard, undefined);
});

test("rule 4: the stop press does not read readiness on either site kind", () => {
  for (const [label, from] of [["comment", atC("recording")], ["line", atL("recording")]]) {
    const a = reduce(from, press({ now: 1500, ready: { inComment: true } }));
    const b = reduce(from, press({ now: 1500, ready: { inComment: false } }));
    const c = reduce(from, press({ now: 1500, ready: { served: false, inComment: true } }));
    assert.strictEqual(a.state.phase, "finalising", label);
    assert.deepStrictEqual(plain(a), plain(b), `${label}: inComment on the stop press changed the answer`);
    assert.deepStrictEqual(plain(a), plain(c), `${label}: readiness on the stop press changed the answer`);
    assert.strictEqual(a.state.commentSite === true, label === "comment", label);
  }
});

test("rule 4: every idle result from a comment-site capture phase is exactly IDLE", () => {
  const exits = [
    ["arming", press({ now: 1100 })],
    ["arming", stopped(0, { failure: "no-device" })],
    ["arming", error("boom")],
    ["arming", cancel(1100)],
    ["recording", stopped(4096)],
    ["recording", error("boom")],
    ["recording", cancel(2000)],
    ["finalising", stopped(0)],
    ["finalising", stopped(0, { failure: "failed" })],
    ["finalising", error("boom")],
    ["finalising", cancel(2000)],
    ["finalising", transcript("")],
    ["finalising", transcript("add a bloom filter")],
  ];
  for (const [name, ev] of exits) {
    const out = reduce(atC(name), ev);
    assert.deepStrictEqual(out.state, { phase: "idle" }, `${name} <- ${ev.type}`);
    assert.deepStrictEqual(Object.keys(out.state), ["phase"], `${name} <- ${ev.type}: extra keys`);
  }
});

// ---- rule 5: transcript on a comment site inserts and tightens

test("rule 5: transcript in finalising on a comment site inserts, tightens and goes idle", () => {
  const out = reduce(atC("finalising"), transcript("add a bloom filter", 40));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  assert.deepStrictEqual(out.state, IDLE);
  // AMENDED 2026-09-03 (review F2): the heard indicator and log precede the insert and the tighten.
  assert.deepStrictEqual(plain(out.actions), [
    { type: "unmute" },
    { type: "indicator", mode: "heard", text: "Add a bloom filter." },
    { type: "log", line: "[dictate] heard: Add a bloom filter. (decode=40ms)" },
    { type: "insert-comment", site: SITE, sentence: "Add a bloom filter." },
    { type: "tighten", site: SITE },
  ]);
  assert.strictEqual(out.actions.length, 5);
});

// AMENDED 2026-09-03 (review F3): a finalising comment-site state with no site is ignored, never the line branch.
test("rule 5: finalising with commentSite true and no site ignores the transcript with the generic line", () => {
  const from = { ...atC("finalising") };
  delete from.site;
  assert.strictEqual(from.phase, "finalising");
  assert.strictEqual(from.commentSite, true);
  // CONTRACT AMBIGUITY: F3 says the site-less finalising state "is ignored"
  // without scoping by text. The literal reading covers an empty transcript
  // too; an implementation that refuses empty-transcript before it looks for
  // the site would answer idle on "" and pass only the first text. The
  // literal reading is asserted.
  for (const text of ["add a bloom filter", ""]) {
    const out = reduce(from, transcript(text, 40));
    assert.deepStrictEqual(out.state, from, JSON.stringify(text));
    assert.deepStrictEqual(out.actions, ignored("transcript", "finalising"), JSON.stringify(text));
    assert.ok(!types(out.actions).some((t) => COMMENT_ACTIONS.has(t) || INTENT_ACTIONS.has(t)), JSON.stringify(text));
  }
});

test("rule 5: the insert site is the site of the press, not a later caret", () => {
  const fin = run([pressC({ site: OTHER_URI }), firstBuffer(62), cursorMoved(OTHER_LINE), partial("do it"), pressC({ now: 1500, site: OTHER_LINE }), stopped(10)]).final;
  assert.strictEqual(fin.phase, "finalising");
  const out = reduce(fin, transcript("do it", 5));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  // AMENDED 2026-09-03 (review F2): heard indicator and log before the insert.
  assert.deepStrictEqual(plain(out.actions), [
    { type: "unmute" },
    { type: "indicator", mode: "heard", text: "Do it." },
    { type: "log", line: "[dictate] heard: Do it. (decode=5ms)" },
    { type: "insert-comment", site: OTHER_URI, sentence: "Do it." },
    { type: "tighten", site: OTHER_URI },
  ]);
});

test("rule 5: transcript while decoding (after stopped with audio) inserts the same way", () => {
  for (const name of ["finalising", "finalising with a partial", "finalising while decoding"]) {
    const out = reduce(atC(name), transcript("Use a mutex.", 12));
    assert.deepStrictEqual(out.state, { phase: "idle" }, name);
    // AMENDED 2026-09-03 (review F2): the amended order.
    assert.deepStrictEqual(types(out.actions), ["unmute", "indicator", "log", "insert-comment", "tighten"], name);
    assert.strictEqual(out.actions[3].sentence, "Use a mutex.", name);
    assert.deepStrictEqual(plain(out.actions[4]), { type: "tighten", site: SITE }, name);
  }
});

test("rule 5: the sentence and the log line are what the line site would say, no build-intent", () => {
  const cases = ["add a bloom filter", "Add a bloom filter.", "um, add a bloom filter [BLANK_AUDIO]", "return early", "  try   again  "];
  for (const text of cases) {
    const c = reduce(atC("finalising"), transcript(text, 40));
    const l = reduce(atL("finalising"), transcript(text, 40));
    assert.strictEqual(l.state.phase, "requesting", `${text}: line fixture`);
    const buildIntent = l.actions.find((a) => a.type === "build-intent");
    assert.ok(buildIntent, `${text}: line site built no intent`);
    // AMENDED 2026-09-03 (review F2): indices follow the amended order (indicator 1, log 2, insert 3).
    assert.strictEqual(c.actions[3].sentence, buildIntent.sentence, `${text}: sentence differs from the line site`);
    assert.strictEqual(c.actions[1].text, buildIntent.sentence, `${text}: indicator text`);
    assert.strictEqual(c.actions[2].line, l.actions.find((a) => a.type === "log").line, `${text}: log line differs from the line site`);
    assert.ok(!types(c.actions).includes("build-intent"), `${text}: build-intent on a comment site`);
    assert.strictEqual(c.state.heard, undefined, `${text}: heard kept`);
  }
});

test("rule 5: the inserted sentence is what cleanTranscript says", () => {
  const cases = [
    ["add a bloom filter", "Add a bloom filter."],
    ["Add a bloom filter.", "Add a bloom filter."],
    ["um, add a bloom filter [BLANK_AUDIO]", "Add a bloom filter."],
    ["return early", "Return early."],
    ["  try   again  ", "Try again."],
  ];
  for (const [text, want] of cases) {
    const cleaned = cleanTranscript(text);
    assert.strictEqual(cleaned.sentence, want, `${text}: the cleaner itself`);
    const out = reduce(atC("finalising"), transcript(text, 40));
    // AMENDED 2026-09-03 (review F2): the insert is action 3 in the amended order.
    assert.strictEqual(out.actions[3].type, "insert-comment", text);
    assert.strictEqual(out.actions[3].sentence, cleaned.sentence, text);
    assert.strictEqual(out.actions[3].sentence, want, text);
  }
});

test("rule 5: stripped tokens appear in the log tail on a comment site", () => {
  const out = reduce(atC("finalising"), transcript("um, add a bloom filter [BLANK_AUDIO]", 40));
  assert.deepStrictEqual(out.state, { phase: "idle" });
  // AMENDED 2026-09-03 (review F2): the log is action 2 in the amended order.
  const line = out.actions[2];
  assert.strictEqual(line.type, "log");
  assert.ok(line.line.startsWith("[dictate] heard: Add a bloom filter. (decode=40ms, stripped: "), line.line);
  assert.ok(line.line.endsWith(")"), line.line);
  assert.ok(/stripped: .*um/.test(line.line), line.line);
  assert.ok(/stripped: .*BLANK_AUDIO/.test(line.line), line.line);
  const stripped = cleanTranscript("um, add a bloom filter [BLANK_AUDIO]").stripped;
  assert.ok(stripped.length >= 2, "the cleaner strips both markers");
  assert.strictEqual(line.line, `[dictate] heard: Add a bloom filter. (decode=40ms, stripped: ${stripped.join(", ")})`);
});

test("rule 5: an empty transcript on a comment site refuses exactly as rule 16, no insert", () => {
  for (const [text, decodeMs] of [["", 40], ["   ", 3], [" [BLANK_AUDIO] ", 12]]) {
    const c = reduce(atC("finalising"), transcript(text, decodeMs));
    assert.deepStrictEqual(c.state, { phase: "idle" }, JSON.stringify(text));
    eqActions(c.actions, [
      UNMUTE,
      OFF,
      { type: "refuse", kind: "empty-transcript" },
      log(`[dictate] heard nothing (decode=${decodeMs}ms)`),
    ]);
    assert.deepStrictEqual(plain(c), plain(reduce(atL("finalising"), transcript(text, decodeMs))), `${JSON.stringify(text)}: differs from the line site`);
  }
});

test("rule 5: after the insert the state is idle and the intent events are ignored as in idle", () => {
  const idle = reduce(atC("finalising"), transcript("add a bloom filter")).state;
  for (const ev of [intent(), served(true), served(false), accepted(), dismissed(), nothingLanded(), edit(SITE), edit(OTHER_LINE), cursorMoved(OTHER_URI), stopped(4096), transcript("again"), firstBuffer(1), partial("x"), cancel()]) {
    const out = reduce(idle, ev);
    assert.deepStrictEqual(out.state, { phase: "idle" }, ev.type);
    assert.deepStrictEqual(out.actions, ignored(ev.type, "idle"), ev.type);
  }
  const err = reduce(idle, error("late"));
  assert.deepStrictEqual(err.state, { phase: "idle" });
  assert.deepStrictEqual(err.actions, [log("[dictate] error: late")]);
});

test("rule 5: a press after the insert opens a new take exactly as a press from IDLE does", () => {
  const idle = reduce(atC("finalising"), transcript("add a bloom filter")).state;
  for (const mk of [press, pressC]) {
    const a = reduce(idle, mk({ now: 5000 }));
    const b = reduce(IDLE, mk({ now: 5000 }));
    assert.deepStrictEqual(plain(a), plain(b));
    assert.strictEqual(a.state.phase, "arming");
  }
});

// ---- rule 6: the line site is unchanged

test("rule 6: transcript on a line site still goes to requesting with build-intent", () => {
  const out = reduce(atL("finalising"), transcript("add a bloom filter", 40));
  assert.strictEqual(out.state.phase, "requesting");
  assert.strictEqual(out.state.heard, "Add a bloom filter.");
  assert.ok(!("commentSite" in out.state));
  eqActions(out.actions, [
    UNMUTE,
    { type: "indicator", mode: "heard", text: "Add a bloom filter." },
    log("[dictate] heard: Add a bloom filter. (decode=40ms)"),
    { type: "build-intent", sentence: "Add a bloom filter.", languageId: "typescript", indentColumns: 4 },
  ]);
  assert.ok(!types(out.actions).includes("insert-comment"));
  assert.ok(!types(out.actions).includes("tighten"));
});

test("rule 6: the whole line-site journey carries no commentSite key at any step", () => {
  const r = run([...LINE_ONLY.ghost, edit(SITE), accepted()]);
  for (const [i, s] of r.states.entries()) assert.ok(!("commentSite" in s), `step ${i} (${s.phase})`);
  assert.deepStrictEqual(r.final, { phase: "idle" });
});

// ---- rule 7 and 8: the banned actions, enumerated

const INTENT_ACTIONS = new Set(["build-intent", "trigger-fim", "disarm-intent"]);
const COMMENT_ACTIONS = new Set(["insert-comment", "tighten"]);

const EVERY_EVENT = [
  ...CAPTURE_EVENTS,
  press({ now: 1500, ready: { served: false } }),
  pressC({ now: 1500 }),
  transcript(""),
  transcript("add a bloom filter"),
  transcript("um, add a bloom filter [BLANK_AUDIO]"),
  transcript("[BLANK_AUDIO]"),
];

test("rule 7: no comment-site state, for any event, emits build-intent, trigger-fim or disarm-intent", () => {
  const states = CAPTURE_NAMES.map((n) => [n, atC(n)]);
  states.push(["re-record arming", reduce(atL("ghost"), pressC({ now: 9000 })).state]);
  for (const [name, from] of states) {
    assert.strictEqual(from.commentSite, true, name);
    for (const ev of EVERY_EVENT) {
      const out = reduce(from, ev);
      for (const t of types(out.actions)) assert.ok(!INTENT_ACTIONS.has(t), `${name} <- ${ev.type}: emitted ${t}`);
      assert.ok(!["requesting", "ghost"].includes(out.state.phase), `${name} <- ${ev.type}: reached ${out.state.phase}`);
    }
  }
});

test("rule 8: insert-comment and tighten come only from finalising on a comment site, together, in order, once", () => {
  const states = [
    ...CAPTURE_NAMES.map((n) => [`comment ${n}`, atC(n)]),
    ...CAPTURE_NAMES.map((n) => [`line ${n}`, atL(n)]),
    ...Object.keys(LINE_ONLY).map((n) => [`line ${n}`, atL(n)]),
    ["idle", IDLE],
  ];
  for (const [name, from] of states) {
    for (const ev of EVERY_EVENT) {
      const out = reduce(from, ev);
      const ts = types(out.actions);
      const inserts = ts.filter((t) => t === "insert-comment").length;
      const tightens = ts.filter((t) => t === "tighten").length;
      const label = `${name} <- ${ev.type}${ev.type === "transcript" ? ` ${JSON.stringify(ev.text)}` : ""}`;
      const expected = from.commentSite === true && from.phase === "finalising" && ev.type === "transcript" && cleanTranscript(ev.text).sentence !== "";
      assert.strictEqual(inserts, expected ? 1 : 0, `${label}: insert-comment count`);
      assert.strictEqual(tightens, expected ? 1 : 0, `${label}: tighten count`);
      if (expected) assert.strictEqual(ts.indexOf("tighten"), ts.indexOf("insert-comment") + 1, `${label}: tighten not right after insert-comment`);
    }
  }
});

test("rule 8: one comment-site gesture emits exactly one insert-comment and one tighten across its whole life", () => {
  const r = run([
    pressC({ now: 1000 }),
    firstBuffer(62),
    partial("add"),
    partial("add a bloom"),
    cursorMoved(OTHER_LINE),
    pressC({ now: 2500 }),
    edit(OTHER_LINE),
    stopped(8192),
    transcript("add a bloom filter", 90),
    intent(),
    served(true),
    accepted(),
  ]);
  assert.deepStrictEqual(r.states.map((s) => s.phase), [
    "arming", "recording", "recording", "recording", "recording", "finalising", "finalising", "finalising", "idle", "idle", "idle", "idle",
  ]);
  const flat = r.actions.flat();
  const ts = types(flat);
  assert.strictEqual(ts.filter((t) => t === "insert-comment").length, 1);
  assert.strictEqual(ts.filter((t) => t === "tighten").length, 1);
  assert.strictEqual(ts.filter((t) => t === "start-capture").length, 1);
  assert.strictEqual(ts.filter((t) => t === "stop-capture").length, 1);
  assert.strictEqual(ts.filter((t) => t === "mute").length, 1);
  assert.strictEqual(ts.filter((t) => t === "unmute").length, 1);
  assert.ok(!ts.some((t) => INTENT_ACTIONS.has(t)), "an intent action leaked");
  assert.ok(!ts.includes("transcribe") || ts.filter((t) => t === "transcribe").length === 1, "transcribe count");
  assert.deepStrictEqual(r.final, { phase: "idle" });
});

// ---- rule 9: malformed input is unchanged

test("rule 9: malformed events and states answer { IDLE, [] } on a comment site too", () => {
  for (const name of CAPTURE_NAMES) {
    const from = atC(name);
    for (const ev of [null, undefined, 7, "press", {}, { type: "bogus" }, { type: 3 }, { site: SITE }]) {
      assert.deepStrictEqual(reduce(from, ev), { state: { phase: "idle" }, actions: [] }, `${name} <- ${JSON.stringify(ev)}`);
    }
  }
  assert.deepStrictEqual(reduce(undefined, pressC()), { state: { phase: "idle" }, actions: [] });
  assert.deepStrictEqual(reduce(null, pressC()), { state: { phase: "idle" }, actions: [] });
  assert.deepStrictEqual(reduce("arming", pressC()), { state: { phase: "idle" }, actions: [] });
});

test("rule 9: a comment-site press never mutates the state it is given", () => {
  const before = JSON.stringify(IDLE);
  reduce(IDLE, pressC());
  assert.strictEqual(JSON.stringify(IDLE), before);
  const fin = atC("finalising");
  const snap = JSON.stringify(fin);
  reduce(fin, transcript("add a bloom filter"));
  reduce(fin, cancel());
  assert.strictEqual(JSON.stringify(fin), snap);
});

// ---- the sweep: I1..I5 with inComment true half the time

const CAPTURE = new Set(["arming", "recording", "finalising"]);
const KNOWN_TYPES = new Set(["press", "first-buffer", "partial", "stopped", "transcript", "intent", "served", "accepted", "dismissed", "edit", "cursor-moved", "error", "cancel", "nothing-landed"]);
const isMalformed = (ev) => !ev || typeof ev !== "object" || !KNOWN_TYPES.has(ev.type);

function checkStep(prev, next, actions, tracker, label, ev) {
  if (isMalformed(ev)) {
    assert.deepStrictEqual({ state: next, actions }, { state: { phase: "idle" }, actions: [] }, `${label}: malformed answer`);
    tracker.open = false;
    return;
  }
  const ts = types(actions);
  // I1: start-capture only when the state moves to arming.
  if (ts.includes("start-capture")) assert.strictEqual(next.phase, "arming", `${label}: start-capture without arming`);
  // I2: a capture phase back to idle carries unmute once and ends off, except
  // (a) finalising -> requesting (unmute once, heard) and (b) finalising ->
  // idle through rule 5 on a comment site (unmute once, heard, insert then
  // tighten). Whether (b) applies is decided by the cleaner, not by what the
  // reducer emitted, so a reducer that skips the insert is caught.
  const unmutes = ts.filter((t) => t === "unmute").length;
  const indicators = actions.filter((a) => a.type === "indicator");
  const insertPath = prev.phase === "finalising" && prev.commentSite === true && ev.type === "transcript" && cleanTranscript(ev.text).sentence !== "";
  if (CAPTURE.has(prev.phase) && next.phase === "idle") {
    assert.strictEqual(unmutes, 1, `${label}: ${prev.phase}->idle unmute count`);
    assert.ok(indicators.length > 0, `${label}: ${prev.phase}->idle without an indicator`);
    if (insertPath) {
      assert.strictEqual(indicators[indicators.length - 1].mode, "heard", `${label}: rule 5 indicator`);
      assert.ok(!indicators.some((i) => i.mode === "off"), `${label}: indicator off on the rule 5 path`);
      const i = ts.indexOf("insert-comment");
      assert.ok(i >= 0, `${label}: rule 5 path without insert-comment`);
      assert.strictEqual(ts[i + 1], "tighten", `${label}: tighten not right after insert-comment`);
      // AMENDED 2026-09-03 (review F2): unmute precedes the insert; heard indicator and log come before it too.
      assert.ok(ts.indexOf("unmute") < i, `${label}: insert-comment before unmute`);
      assert.deepStrictEqual(ts, ["unmute", "indicator", "log", "insert-comment", "tighten"], `${label}: rule 5 action list`);
    } else {
      assert.strictEqual(indicators[indicators.length - 1].mode, "off", `${label}: ${prev.phase}->idle indicator`);
      assert.ok(!ts.includes("insert-comment"), `${label}: insert-comment off the rule 5 path`);
    }
  } else if (insertPath) {
    assert.fail(`${label}: rule 5 transcript did not go finalising->idle (went ${next.phase})`);
  }
  if (prev.phase === "finalising" && next.phase === "requesting") {
    assert.strictEqual(prev.commentSite, undefined, `${label}: comment site reached requesting`);
    assert.strictEqual(unmutes, 1, `${label}: finalising->requesting unmute count`);
    assert.ok(indicators.some((i) => i.mode === "heard"), `${label}: no heard indicator`);
    assert.ok(!indicators.some((i) => i.mode === "off"), `${label}: indicator off on the way to requesting`);
  }
  // I3: no two start-capture without a stop or abort between them. A stopped
  // consumed in a capture phase closes the capture too (rule 14).
  if (ev.type === "stopped" && CAPTURE.has(prev.phase) && next.phase === "idle") tracker.open = false;
  for (const t of ts) {
    if (t === "start-capture") {
      assert.strictEqual(tracker.open, false, `${label}: second start-capture without stop/abort`);
      tracker.open = true;
    } else if (t === "stop-capture" || t === "abort-capture") {
      tracker.open = false;
    }
  }
  // I4: heard only in requesting/ghost; partial only recording..requesting.
  if (next.heard !== undefined) assert.ok(["requesting", "ghost"].includes(next.phase), `${label}: heard set in ${next.phase}`);
  if (next.partial !== undefined) assert.ok(["recording", "finalising", "requesting"].includes(next.phase), `${label}: partial set in ${next.phase}`);
  // I5: insert-comment excludes the intent actions and needs a comment-site
  // previous state; a comment-site previous state never emits them at all
  // (rule 7); insert-comment and tighten travel together (rule 8).
  if (ts.includes("insert-comment")) {
    for (const t of ts) assert.ok(!INTENT_ACTIONS.has(t), `${label}: insert-comment beside ${t}`);
    assert.strictEqual(prev.commentSite, true, `${label}: insert-comment from a state without commentSite`);
  }
  if (prev.commentSite === true) {
    for (const t of ts) assert.ok(!INTENT_ACTIONS.has(t), `${label}: comment site emitted ${t}`);
  }
  assert.strictEqual(ts.includes("insert-comment"), ts.includes("tighten"), `${label}: insert-comment and tighten not together`);
  // The commentSite key: only `true`, only in a capture phase, never in idle.
  if ("commentSite" in next) {
    assert.strictEqual(next.commentSite, true, `${label}: commentSite is ${next.commentSite}`);
    assert.ok(CAPTURE.has(next.phase), `${label}: commentSite in ${next.phase}`);
  }
  if (next.phase === "idle") assert.deepStrictEqual(next, { phase: "idle" }, `${label}: idle with extra keys`);
  // A capture phase keeps the key it had (rule 4); the key is only born on a
  // press from idle, ghost or requesting.
  if (CAPTURE.has(prev.phase) && CAPTURE.has(next.phase)) {
    assert.strictEqual(next.commentSite, prev.commentSite, `${label}: commentSite changed inside the capture phases`);
  }
  // Preamble: a well-formed result.
  assert.ok(next && typeof next === "object" && typeof next.phase === "string", `${label}: bad state`);
  assert.ok(Array.isArray(actions), `${label}: actions not an array`);
  for (const a of actions) assert.strictEqual(typeof a.type, "string", `${label}: action without type`);
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const APPLICABLE = {
  idle: ["press"],
  arming: ["first-buffer"],
  recording: ["partial", "press"],
  finalising: ["stopped-audio", "transcript"],
  requesting: ["intent", "served"],
  ghost: ["accepted", "dismissed", "press", "edit"],
};

// As the v65 generator, with inComment true half the time on a press and the
// two v66 events in the mix.
function randomEvent(rand, clock, phase = "idle") {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const kinds = ["press", "first-buffer", "partial", "stopped", "transcript", "intent", "served", "accepted", "dismissed", "edit", "cursor-moved", "error", "cancel", "nothing-landed", "malformed"];
  const kind = rand() < 0.6 ? pick(APPLICABLE[phase]) : pick(kinds);
  const sites = [SITE, OTHER_LINE, OTHER_URI];
  switch (kind) {
    case "press": {
      const ready = { ...READY, inComment: rand() < 0.5 };
      if (rand() < 0.15) {
        const key = pick(["remote", "binaryPresent", "modelPresent", "recogniserAlive", "served", "commentRow"]);
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
    case "cancel": { clock.now += Math.floor(rand() * 2000); return cancel(rand() < 0.9 ? clock.now : NaN); }
    case "nothing-landed": return nothingLanded();
    default: return pick([null, undefined, 7, "press", {}, { type: "bogus" }, { type: 3 }]);
  }
}

for (const seed of [1, 42, 2026]) {
  test(`rule 7: 2000 seeded random steps (seed ${seed}), inComment half the time, hold I1..I5`, () => {
    const rand = rng(seed);
    const clock = { now: 0 };
    const visited = new Set();
    const tracker = { open: false };
    let commentArms = 0;
    let inserts = 0;
    let state = IDLE;
    for (let i = 0; i < 2000; i++) {
      const ev = randomEvent(rand, clock, state.phase);
      let out;
      assert.doesNotThrow(() => { out = reduce(state, ev); }, `seed ${seed} step ${i}: reduce threw`);
      const label = `seed ${seed} step ${i} (${ev && ev.type} in ${state.phase}${state.commentSite ? " (comment)" : ""})`;
      checkStep(state, out.state, out.actions, tracker, label, ev);
      if (out.actions.length === 1 && out.actions[0].type === "log" && /^\[dictate\] ignored /.test(out.actions[0].line)) {
        assert.deepStrictEqual(out.state, state, `${label}: ignored event changed the state`);
        assert.strictEqual(out.actions[0].line, `[dictate] ignored ${ev.type} in ${state.phase}`);
      }
      if (out.state.phase === "arming" && out.state.commentSite === true) commentArms++;
      if (types(out.actions).includes("insert-comment")) inserts++;
      state = out.state;
      visited.add(state.phase);
    }
    // The generator must reach every phase and drive the comment site to its
    // insert, or the sweep is hollow.
    assert.strictEqual(visited.size, 6, `seed ${seed}: only visited ${[...visited].join(",")}`);
    assert.ok(commentArms >= 20, `seed ${seed}: only ${commentArms} comment-site arms`);
    assert.ok(inserts >= 5, `seed ${seed}: only ${inserts} inserts`);
  });
}

test("rule 7: random steps from every comment-site and line-site state as the start", () => {
  const rand = rng(7);
  const starts = [
    ...CAPTURE_NAMES.map((n) => [`comment ${n}`, atC(n)]),
    ...CAPTURE_NAMES.map((n) => [`line ${n}`, atL(n)]),
    ...Object.keys(LINE_ONLY).map((n) => [`line ${n}`, atL(n)]),
  ];
  for (const [name, from] of starts) {
    const clock = { now: 10000 };
    const tracker = { open: ["arming", "recording"].includes(from.phase) };
    let state = from;
    for (let i = 0; i < 300; i++) {
      const ev = randomEvent(rand, clock, state.phase);
      let out;
      assert.doesNotThrow(() => { out = reduce(state, ev); }, `from ${name} step ${i}: reduce threw`);
      checkStep(state, out.state, out.actions, tracker, `from ${name} step ${i} (${ev && ev.type} in ${state.phase})`, ev);
      state = out.state;
    }
  }
});

test("rule 7: hand-built comment-site sequences hold the invariants", () => {
  const seqs = {
    happyComment: [...PATH_C.finalising, stopped(4096), transcript("add a bloom filter")],
    cancelBeforeMic: [pressC(), pressC({ now: 1100 }), pressC({ now: 1200 }), firstBuffer(5), pressC({ now: 1300 }), stopped(0)],
    childDies: [pressC(), firstBuffer(5), stopped(0, { failure: "no-device" }), pressC({ now: 2000 }), stopped(0)],
    escapeEverywhere: CAPTURE_NAMES.flatMap((n) => [...PATH_C[n], cancel(9000)]),
    errorsEverywhere: CAPTURE_NAMES.flatMap((n) => [...PATH_C[n], error("boom")]),
    heardNothing: [...PATH_C.finalising, stopped(10), transcript("  ", 3), ...PATH_C.finalising, stopped(0)],
    lineThenComment: [...LINE_ONLY.ghost, pressC({ now: 4000, ghostVisible: true }), firstBuffer(3), pressC({ now: 4300 }), stopped(50), transcript("again"), press({ now: 5000 }), firstBuffer(2), press({ now: 5100 }), stopped(50), transcript("and again"), intent(), served(true), dismissed()],
    noise: CAPTURE_NAMES.flatMap((n) => [...PATH_C[n], firstBuffer(1), partial("x"), intent(), served(true), accepted(), dismissed(), nothingLanded(), edit(SITE), cursorMoved(SITE), error("e")]),
  };
  for (const [name, seq] of Object.entries(seqs)) {
    const tracker = { open: false };
    let state = IDLE;
    seq.forEach((ev, i) => {
      const out = reduce(state, ev);
      checkStep(state, out.state, out.actions, tracker, `${name} step ${i} (${ev.type} in ${state.phase})`, ev);
      state = out.state;
    });
  }
});
