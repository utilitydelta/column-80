// Adversarial review of session-v67 phase 1: the comment site in the dictation
// reducer (src/core/dictationGesture.ts). One row per finding, named by finding,
// each naming the source line attacked. Rows marked PROOF pass and pin a claim
// the review checked; the others are red and are the evidence for the finding.
//
// Run: SKIP_LIVE=1 node --test test/review-v67-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore("review-v67-p1", 'export * from "../src/core/dictationGesture";\n');
const { reduce, IDLE } = mod;
test.after(cleanup);

const SITE = { uri: "file:///work/a.ts", line: 10 };
const READY = { remote: false, binaryPresent: true, modelPresent: true, recogniserAlive: true, served: true, commentRow: true, inComment: false };
const press = (over = {}) => ({
  type: "press", site: SITE, languageId: "typescript", indentColumns: 4, now: 1000, ghostVisible: false,
  ...over, ready: { ...READY, ...(over.ready || {}) },
});
const pressC = (over = {}) => press({ ...over, ready: { inComment: true, ...(over.ready || {}) } });
const run = (events, from = IDLE) => events.reduce((s, ev) => reduce(s, ev).state, from);
const types = (actions) => actions.map((a) => a.type);

const commentFinalising = () => run([pressC(), { type: "first-buffer", msSincePress: 62 }, pressC({ now: 1500 }), { type: "stopped", pcmBytes: 4096 }]);
const lineRequesting = () => run([press(), { type: "first-buffer", msSincePress: 62 }, press({ now: 1500 }), { type: "stopped", pcmBytes: 4096 }, { type: "transcript", text: "add a bloom filter", decodeMs: 40 }]);
const lineGhost = () => run([{ type: "intent", comment: "// Add a bloom filter.", matched: 1, refused: 0 }, { type: "served", ghost: true }], lineRequesting());

// F1. dictationGesture.ts:143-154. A re-record from `requesting` onto a comment site emits
// hide-ghost and nothing else about the old gesture. On a line site the new build-intent
// replaces the armed intent (completionProvider.armIntent). A comment site never builds one,
// so the abandoned gesture's intent stays armed with no TTL and rides the next keystroke
// request at its uri:line (takeIntent). Contract rule 3 as written allows this; the hole is
// the contract's. Red by design.
test("F1: re-record from requesting onto a comment site disarms the abandoned intent", () => {
  const out = reduce(lineRequesting(), pressC({ now: 9000 }));
  assert.strictEqual(out.state.commentSite, true);
  assert.ok(types(out.actions).includes("disarm-intent"), `actions: ${types(out.actions).join(", ")}`);
});

// F2. dictationGesture.ts:219-225. Goal ruling 8 orders the record: press, mic and heard
// lines, "comment inserted", "tighten invoked". The reducer puts the heard line AFTER
// insert-comment and tighten, and the adapter executes synchronously (dictation.ts:367), so
// the phase 1 stub already logs insert-comment, tighten, heard. Contract rule 5 pins this
// order, so the contract contradicts the ruling. Red by design.
test("F2: the heard log line precedes insert-comment, as goal ruling 8 orders the record", () => {
  const out = reduce(commentFinalising(), { type: "transcript", text: "add a bloom filter", decodeMs: 40 });
  const ts = types(out.actions);
  const heard = out.actions.findIndex((a) => a.type === "log" && a.line.startsWith("[dictate] heard:"));
  assert.ok(heard >= 0, "no heard line");
  assert.ok(heard < ts.indexOf("insert-comment"), `order: ${ts.join(", ")}`);
});

// F3. dictationGesture.ts:214. The comment branch is guarded on `state.site !== undefined`;
// a finalising state with commentSite and no site falls through to the line branch and emits
// build-intent from a comment-site state, breaching rule 7 and I5. The `intent` handler
// treats a missing site as ignored; this branch should not treat it as a line site.
test("F3: a comment-site finalising state without a site never emits build-intent", () => {
  const out = reduce({ phase: "finalising", commentSite: true, languageId: "typescript", indentColumns: 4 }, { type: "transcript", text: "add a bloom filter", decodeMs: 40 });
  assert.ok(!types(out.actions).includes("build-intent"), `actions: ${types(out.actions).join(", ")}`);
});

// PROOF. dictationGesture.ts:141-158, 214-236. A comment-site gesture can never reach
// requesting or ghost through the reducer, and no idle state carries the key, so the
// accepted / dismissed / nothing-landed lines cannot lie about a comment site.
test("PROOF: no comment-site state reaches requesting or ghost, and idle never carries commentSite", () => {
  const events = [
    pressC({ now: 2000 }), press({ now: 2000 }), { type: "first-buffer", msSincePress: 62 }, { type: "partial", text: "add" },
    { type: "stopped", pcmBytes: 4096 }, { type: "stopped", pcmBytes: 0 }, { type: "stopped", pcmBytes: 0, failure: "no-device" },
    { type: "transcript", text: "add a bloom filter", decodeMs: 40 }, { type: "transcript", text: "um", decodeMs: 40 },
    { type: "intent", comment: "// x.", matched: 0, refused: 0 }, { type: "served", ghost: true }, { type: "served", ghost: false },
    { type: "accepted" }, { type: "dismissed" }, { type: "edit", site: SITE }, { type: "cursor-moved", site: { uri: SITE.uri, line: 3 } },
    { type: "error", message: "x" }, { type: "cancel", now: 3000 }, { type: "nothing-landed" },
  ];
  let frontier = [reduce(IDLE, pressC()).state];
  const seen = new Set();
  while (frontier.length > 0) {
    const next = [];
    for (const s of frontier) {
      for (const ev of events) {
        const out = reduce(s, ev).state;
        const key = JSON.stringify(out);
        if (out.phase === "idle") assert.ok(!("commentSite" in out), `idle with commentSite after ${ev.type}: ${key}`);
        if (out.commentSite === true) assert.ok(out.phase !== "requesting" && out.phase !== "ghost", `comment site in ${out.phase} after ${ev.type}`);
        if (out.commentSite === true && !seen.has(key)) {
          seen.add(key);
          next.push(out);
        }
      }
    }
    frontier = next;
  }
  assert.ok(seen.size >= 3, `explored ${seen.size} comment-site states`);
});

// PROOF. dictationGesture.ts:143-158. A re-record from a line-site ghost onto a comment site
// starts clean: hide-ghost first, no heard, no partial, a fresh site.
test("PROOF: re-record from a line-site ghost onto a comment site leaves no heard or partial behind", () => {
  const out = reduce(lineGhost(), pressC({ now: 9000, ghostVisible: true, site: { uri: SITE.uri, line: 12 } }));
  assert.strictEqual(types(out.actions)[0], "hide-ghost");
  assert.strictEqual(types(out.actions).filter((t) => t === "hide-ghost").length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.state)), {
    phase: "arming", site: { uri: SITE.uri, line: 12 }, languageId: "typescript", indentColumns: 4, pressedAt: 9000, commentSite: true,
  });
  assert.strictEqual(out.actions[out.actions.length - 1].line, `[dictate] press at ${SITE.uri}:12 (comment) (re-record)`);
});

// PROOF. dictationGesture.ts:210-212. An empty transcript on a comment site unmutes once,
// ends off, refuses empty-transcript, inserts nothing.
test("PROOF: empty transcript on a comment site unmutes once, indicator off, no insert", () => {
  const out = reduce(commentFinalising(), { type: "transcript", text: "um, uh", decodeMs: 40 });
  const ts = types(out.actions);
  assert.deepStrictEqual(out.state, { phase: "idle" });
  assert.strictEqual(ts.filter((t) => t === "unmute").length, 1);
  assert.deepStrictEqual(out.actions.filter((a) => a.type === "indicator").pop(), { type: "indicator", mode: "off" });
  assert.ok(!ts.includes("insert-comment") && !ts.includes("tighten"), ts.join(", "));
  assert.deepStrictEqual(out.actions.find((a) => a.type === "refuse"), { type: "refuse", kind: "empty-transcript" });
});
