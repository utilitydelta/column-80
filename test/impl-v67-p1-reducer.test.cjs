// White-box rows for session-v67 phase 1: the comment site in the dictation
// reducer (src/core/dictationGesture). The blind oracle
// (test/blind-v67-p1-reducer.test.cjs) pins the contract from outside; these
// rows pin what it cannot see: that every non-idle transition is a spread that
// keeps `commentSite`, that the re-record path reads the NEW press's readiness
// and not the old state's, and that `refusalFor` runs its six checks in the
// ruled order with `inComment` gone from the list.
//
// Run: SKIP_LIVE=1 node --test test/impl-v67-p1-reducer.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v67-p1-reducer",
  'export * from "../src/core/dictationGesture";\n'
);
const { reduce, IDLE } = mod;
test.after(cleanup);

const SITE = { uri: "file:///work/a.ts", line: 10 };
const OTHER_LINE = { uri: "file:///work/a.ts", line: 11 };
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
const pressC = (over = {}) => press({ ...over, ready: { inComment: true, ...(over.ready || {}) } });
const plain = (v) => JSON.parse(JSON.stringify(v));
const types = (actions) => actions.map((a) => a.type);

function run(events, from = IDLE) {
  const states = [];
  let state = from;
  for (const ev of events) {
    const out = reduce(state, ev);
    state = out.state;
    states.push(state);
  }
  return { states, final: state };
}

// ---- the state spread keeps commentSite

// Every transition that stays out of idle is `{ ...state, ... }` on the
// previous state, so a key the previous state carried survives. The rows name
// each such transition and the key it must keep.
const KEEPING = [
  ["first-buffer in arming", [pressC()], { type: "first-buffer", msSincePress: 62 }, "recording"],
  ["partial in recording", [pressC(), { type: "first-buffer", msSincePress: 62 }], { type: "partial", text: "add a" }, "recording"],
  ["stop press in recording", [pressC(), { type: "first-buffer", msSincePress: 62 }], press({ now: 1500 }), "finalising"],
  ["stopped with audio in finalising", [pressC(), { type: "first-buffer", msSincePress: 62 }, press({ now: 1500 })], { type: "stopped", pcmBytes: 4096 }, "finalising"],
  ["ignored event in recording", [pressC(), { type: "first-buffer", msSincePress: 62 }], { type: "served", ghost: true }, "recording"],
  ["ignored event in finalising", [pressC(), { type: "first-buffer", msSincePress: 62 }, press({ now: 1500 })], { type: "intent", comment: "// x", matched: 0, refused: 0 }, "finalising"],
];

for (const [name, path, ev, phase] of KEEPING) {
  test(`spread keeps commentSite: ${name}`, () => {
    const from = run(path).final;
    assert.strictEqual(from.commentSite, true, "fixture");
    const out = reduce(from, ev);
    assert.strictEqual(out.state.phase, phase);
    assert.strictEqual(out.state.commentSite, true);
  });
}

test("the stop press keeps commentSite from the STATE, not from the stop press's readiness", () => {
  const from = run([pressC(), { type: "first-buffer", msSincePress: 62 }]).final;
  const out = reduce(from, press({ now: 1500, ready: { inComment: false } }));
  assert.strictEqual(out.state.phase, "finalising");
  assert.strictEqual(out.state.commentSite, true);
  const line = run([press(), { type: "first-buffer", msSincePress: 62 }]).final;
  const outL = reduce(line, press({ now: 1500, ready: { inComment: true } }));
  assert.strictEqual(outL.state.phase, "finalising");
  assert.ok(!("commentSite" in outL.state), "a line site does not become a comment site at the stop press");
});

test("a line-site arming state carries no commentSite key at all, not commentSite: false", () => {
  const out = reduce(IDLE, press());
  assert.ok(!Object.prototype.hasOwnProperty.call(out.state, "commentSite"));
  assert.deepStrictEqual(Object.keys(out.state).sort(), ["indentColumns", "languageId", "phase", "pressedAt", "site"]);
});

// ---- the re-record path reads the new press

test("re-record from a line-site ghost onto a comment site: the new state is a comment site", () => {
  const ghost = run([
    press(),
    { type: "first-buffer", msSincePress: 62 },
    press({ now: 1500 }),
    { type: "stopped", pcmBytes: 4096 },
    { type: "transcript", text: "add a bloom filter", decodeMs: 40 },
    { type: "intent", comment: "// Add a bloom filter.", matched: 1, refused: 0 },
    { type: "served", ghost: true },
  ]).final;
  assert.strictEqual(ghost.phase, "ghost");
  assert.ok(!("commentSite" in ghost));
  const out = reduce(ghost, pressC({ now: 9000, site: OTHER_LINE }));
  assert.deepStrictEqual(plain(out.state), {
    phase: "arming",
    site: OTHER_LINE,
    languageId: "typescript",
    indentColumns: 4,
    pressedAt: 9000,
    commentSite: true,
  });
  assert.strictEqual(out.actions[out.actions.length - 1].line, "[dictate] press at file:///work/a.ts:11 (comment) (re-record)");
  assert.ok(!types(out.actions).includes("disarm-intent"), "a ghost holds no armed intent");
});

const lineRequesting = () => run([
  press(),
  { type: "first-buffer", msSincePress: 62 },
  press({ now: 1500 }),
  { type: "stopped", pcmBytes: 4096 },
  { type: "transcript", text: "add a bloom filter", decodeMs: 40 },
]).final;

test("re-record from requesting leads with disarm-intent, then hide-ghost, on either site kind", () => {
  for (const [label, ev] of [["comment", pressC({ now: 9000 })], ["line", press({ now: 9000 })]]) {
    const out = reduce(lineRequesting(), ev);
    assert.strictEqual(out.state.phase, "arming", label);
    assert.deepStrictEqual(types(out.actions), ["disarm-intent", "hide-ghost", "mute", "start-capture", "indicator", "log"], label);
    assert.strictEqual(out.actions.filter((a) => a.type === "disarm-intent").length, 1, label);
  }
});

test("a comment-site finalising state with no site is ignored on transcript, never the line branch", () => {
  const state = { phase: "finalising", commentSite: true, languageId: "typescript", indentColumns: 4 };
  for (const text of ["add a bloom filter", "", "   ", "[BLANK_AUDIO]"]) {
    const out = reduce(state, { type: "transcript", text, decodeMs: 40 });
    assert.strictEqual(out.state, state, JSON.stringify(text));
    assert.deepStrictEqual(plain(out.actions), [{ type: "log", line: "[dictate] ignored transcript in finalising" }], JSON.stringify(text));
  }
});

test("transcript on a comment site: unmute, heard indicator, heard line, insert, tighten", () => {
  const fin = run([pressC(), { type: "first-buffer", msSincePress: 62 }, pressC({ now: 1500 }), { type: "stopped", pcmBytes: 4096 }]).final;
  const out = reduce(fin, { type: "transcript", text: "add a bloom filter", decodeMs: 40 });
  assert.deepStrictEqual(out.state, { phase: "idle" });
  assert.deepStrictEqual(plain(out.actions), [
    { type: "unmute" },
    { type: "indicator", mode: "heard", text: "Add a bloom filter." },
    { type: "log", line: "[dictate] heard: Add a bloom filter. (decode=40ms)" },
    { type: "insert-comment", site: SITE, sentence: "Add a bloom filter." },
    { type: "tighten", site: SITE },
  ]);
});

test("re-record does not run readiness: a failing check with inComment true still arms a comment site", () => {
  const requesting = run([
    press(),
    { type: "first-buffer", msSincePress: 62 },
    press({ now: 1500 }),
    { type: "stopped", pcmBytes: 4096 },
    { type: "transcript", text: "add a bloom filter", decodeMs: 40 },
  ]).final;
  assert.strictEqual(requesting.phase, "requesting");
  const out = reduce(requesting, pressC({ now: 9000, ready: { served: false } }));
  assert.strictEqual(out.state.phase, "arming");
  assert.strictEqual(out.actions[0].type, "disarm-intent");
  assert.strictEqual(out.state.commentSite, true);
  assert.ok(!types(out.actions).includes("refuse"));
});

test("a comment-site gesture's heard sentence is never carried: the second gesture starts clean", () => {
  const first = run([
    pressC(),
    { type: "first-buffer", msSincePress: 62 },
    pressC({ now: 1500 }),
    { type: "stopped", pcmBytes: 4096 },
    { type: "transcript", text: "add a bloom filter", decodeMs: 40 },
  ]).final;
  assert.deepStrictEqual(first, { phase: "idle" });
  const second = reduce(first, press({ now: 5000 }));
  assert.deepStrictEqual(plain(second.state), { phase: "arming", site: SITE, languageId: "typescript", indentColumns: 4, pressedAt: 5000 });
});

// ---- refusalFor: six checks, ruled order, inComment absent

const ORDER = ["remote", "binary-missing", "model-missing", "server-down", "not-served", "no-comment-row"];
const FAILING = {
  remote: { remote: true },
  "binary-missing": { binaryPresent: false },
  "model-missing": { modelPresent: false },
  "server-down": { recogniserAlive: false },
  "not-served": { served: false },
  "no-comment-row": { commentRow: false },
};

test("refusalFor: all six failing reports the first in the ruled order, whatever inComment says", () => {
  for (const inComment of [false, true, undefined]) {
    let ready = { inComment };
    for (const kind of ORDER) ready = { ...ready, ...FAILING[kind] };
    const out = reduce(IDLE, press({ ready }));
    assert.strictEqual(out.actions[0].kind, "remote", `inComment=${inComment}`);
  }
});

test("refusalFor: peeling the failures off one by one walks the ruled order and ends in arming", () => {
  for (const inComment of [false, true]) {
    for (let i = 0; i < ORDER.length; i++) {
      let ready = { inComment };
      for (const kind of ORDER.slice(i)) ready = { ...ready, ...FAILING[kind] };
      const out = reduce(IDLE, press({ ready }));
      assert.strictEqual(out.actions[0].kind, ORDER[i], `inComment=${inComment} from ${ORDER[i]}`);
    }
    const out = reduce(IDLE, press({ ready: { inComment } }));
    assert.strictEqual(out.state.phase, "arming", `inComment=${inComment} nothing failing`);
    assert.strictEqual(out.state.commentSite, inComment ? true : undefined);
  }
});

test("refusalFor: a truthy non-boolean inComment marks the site, a falsy one does not, neither refuses", () => {
  for (const [value, marks] of [[1, true], ["yes", true], [0, false], ["", false], [null, false]]) {
    const out = reduce(IDLE, press({ ready: { inComment: value } }));
    assert.strictEqual(out.state.phase, "arming", `inComment=${JSON.stringify(value)}`);
    assert.strictEqual(out.state.commentSite === true, marks, `inComment=${JSON.stringify(value)}`);
    if (marks) assert.strictEqual(out.state.commentSite, true, "the key is the literal true, not the readiness value");
  }
});

test("refusalFor: a press with a null readiness refuses binary-missing, not in-comment", () => {
  const out = reduce(IDLE, { ...press(), ready: null });
  assert.strictEqual(out.actions[0].type, "refuse");
  assert.strictEqual(out.actions[0].kind, "binary-missing");
  assert.strictEqual(out.actions[0].detail, "unknown");
});
