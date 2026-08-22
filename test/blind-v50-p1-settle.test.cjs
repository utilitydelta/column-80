// BLIND ORACLE - session-v50 phase 1, "the settle re-poll gets two bounds".
//
// Binds to the phase-1 contract INCLUDING BOTH AMENDMENTS, and to
// nothing else. The bodies of `membersWithSettle` and `hoverWithSettle` were not
// read and not used to derive a single expectation below; every number in an
// assertion comes out of the contract text or out of this file's own fixtures.
// The src reading was limited to EXPORTED declarations needed to build a fake
// transport a real one would also satisfy: `SurfaceExtractor`,
// `CompletionMember`, `MemberKind` and `SourceCursor` in src/core/extraction.ts,
// and `CrossFileBound`, `CrossFileShape`, `DerivedType`, `SettleAllowance`,
// `freshSettleAllowance` and the `resolveCrossFileShape` parameter list in
// src/core/crossFileShape.ts. The allowance is a CALLER's argument, so its shape
// is part of the facade this contract names.
//
// ---------------------------------------------------------------------------
// TWO WITHDRAWALS, AND WHAT A ROW BINDING A WITHDRAWN CONTRACT MUST DO.
//
// This file was written against the contract's first text and four of its rows
// bound behaviour that was then withdrawn. AMENDMENT 2 withdraws C1-1 whole (the
// no-progress stop was built, then removed), and the first amendment withdraws
// C1-2's worked example. The re-cut rule used below:
//
//   * A withdrawn row is not deleted and is not softened into a comment. It is
//     re-aimed at what is TRUE NOW, so it can still fail.
//   * Its comment records what it used to assert, and the measured evidence that
//     moved it, so the next reader can tell a ruling from a regression.
//   * Where the withdrawal RESTORED older behaviour, the row now guards that
//     behaviour against the withdrawn rule coming back. That makes it a
//     tripwire, not a detector, and the row says which it is.
//
// C1-1 (withdrawn). The stop ended the loop when a re-poll returned the same
// member count and the same signed count. The adversarial review reproduced the
// session-v21 case at its MEASURED shape, recorded under "Measured records" in
// docs/architecture/surface-injection.md: a cold `membersOfType` answering 11
// members with 1 signed in 52ms against a 50ms fan-out budget, warming to 7
// rendered - and the stop fires one poll before the answer the loop exists to
// reach. Measured against the pre-bound code: 3 calls
// and 10 rendered methods with no stop, 2 calls and 0 rendered with it. C1-1b
// below now IS that case.
//
// C1-2's worked example (withdrawn). It ran to a third answer. The walk has
// always stopped re-polling the moment anything renders, which predates this
// session, and extending it would ADD sleep. C1-2a2 now binds the stop-on-render
// behaviour instead.
//
// C1-3 (amended). The allowance is per GESTURE, threaded in by the caller, and
// there are TWO: 120ms for the member re-poll and 600ms for the hover poll. A
// caller that supplies none gets a fresh per-walk allowance, which is what every
// row here that omits the argument exercises.
//
// ---------------------------------------------------------------------------
// THE INSTRUMENT.
//
// One fake extractor, `settleFixture`, used by every row. Two properties make it
// the right instrument for this contract:
//
//   1. It COUNTS `membersOfType` per cursor, keyed by `uri:line:character`. C1-1
//      is stated at the extractor ("called at most twice for such a cursor") and
//      that is exactly where it is observed.
//   2. Its answers are SCRIPTED PER CALL at the same cursor. A server still
//      filling its index answers differently on the second touch of one
//      position; a fixture that cannot do that cannot tell C1-1 (an answer that
//      never changes) from C1-2 (an answer that grows), and those two cases are
//      the whole of the first bound.
//
// Scripts are written per type name, as an array of member arrays. The last
// entry repeats forever, so "answers X every time" is a one-element script and
// "grows, then settles" is a three-element one.
//
// The fixtures are struct-shaped and driven through `shapeHooksFor("rust")`.
// That is a fixture choice, not a claim about Rust: the settle sits in the
// shared walk, so any language exercises it, and the struct hover form is the
// one the walk parses with no language hooks at all. C1-5 freezes Rust's
// RENDERED member surface, and no row here asserts anything about what Rust
// renders beyond what its own fixture puts in.
//
// The construction member is written as a member literally named `constructor`.
// The contract's background case is "the one member that answers cold is the
// constructor, that member is dropped from the rendered list", and every row
// that leans on that has a CONTROL asserting the drop actually happened, so a
// build where that member is NOT dropped turns the control red instead of
// passing the row vacuously.
//
// ---------------------------------------------------------------------------
// WHAT EACH ROW IS FOR. DETECTOR OR TRIPWIRE.
//
// A DETECTOR fails against the pre-bound code (19f1e6f) and passes now: it is
// what proves the phase's change happened. A TRIPWIRE passes on both sides: it
// guards behaviour that must not move, and it is worth nothing as evidence the
// build landed. Every row was run against `git archive 19f1e6f src` to find out
// which it is, rather than being assumed into one column.
//
//   DETECTOR  C1-3b, C1-3c   the member allowance is per walk, not per type.
//   DETECTOR  C1-3e          a caller-supplied allowance is SHARED across walks.
//   DETECTOR  C1-3f          `hoverWithSettle` is bounded per gesture too.
//   DETECTOR  C1-3g          the two allowances are separate budgets.
//   DETECTOR  C1-3h          the minted allowance matches the contract's table.
//   TRIPWIRE  C1-1a, C1-1c   the withdrawn stop is NOT in the build: a stuck
//                            cursor spends its steps until the allowance runs
//                            out. Red if the stop returns, red if the bound
//                            goes away.
//   TRIPWIRE  C1-1b          the review's killshot, the v21 case at its measured
//                            shape. Red only if the stop is reinstated.
//   TRIPWIRE  C1-2a, C1-2a2, C1-2b   the session-v21 case, and stop-on-render.
//   TRIPWIRE  C1-0, C1-3a, C1-3d, C1-4a..C1-4e   the controls, the calibration,
//                            and "nothing else about resolution moves".
//
// The 19f1e6f run, for the record. Six red, and the four rows that came out of a
// withdrawal are green on both sides, which is what a withdrawal that RESTORED
// older behaviour has to look like:
//
//   C1-3b  1211ms  ten stuck types paid 120ms each
//   C1-3c  ten cursors at 4 calls apiece, none of them cut short
//   C1-3e  the supplied allowance is ignored, so all three walks re-poll
//   C1-3f  5445ms  nine hover-less types paid 600ms each
//   C1-3g  the same 5.4s, before the member walk is even reached
//   C1-3h  no `freshSettleAllowance` to mint
//
// Reproduce with:
//   git archive 19f1e6f src | tar -x -C <dir>
//   SKIP_LIVE=1 BLIND_V50_SRC=<dir>/src node --test test/blind-v50-p1-settle.test.cjs
//
// C1-5 (Rust frozen) is the existing suite's job and has no row here.
//
// ---------------------------------------------------------------------------
// HOW THE TIMING ROW IS KEPT HONEST ON A LOADED MACHINE.
//
// C1-3 is a clock claim, so it is observed on the clock. Three defences against
// a flaky or a vacuous number:
//
//   * C1-3a is a CALIBRATION row. It runs the same ten-type graph with answers
//     that render on the first touch, so no settle sleep can fire anywhere, and
//     asserts that walk is far under the bound. If the harness itself were slow,
//     C1-3a goes red first and C1-3b's red means nothing on its own.
//   * The bound in C1-3b is an UPPER bound with wide headroom, not a target. The
//     contract allows 120ms of sleep per walk. The bound is 500ms: 380ms of
//     slack for scheduler jitter, timer overshoot and ten types of walk
//     overhead, which is why a loaded machine does not turn it red on its own.
//     It still discriminates, because the contract's own background puts the
//     un-bounded loop at three re-polls of 40ms per type, so ten stuck types is
//     1200ms of sleep before any work at all.
//   * C1-3c makes the same claim with NO clock in it, by counting calls per
//     cursor. If the two ever disagree, the count row is the one to believe.
//
// C1-3f times the hover loop the same way. Its allowance is 600ms, its bound is
// 1500ms, and the same graph with every hover answering is C1-3a's 10-type walk,
// which lands nowhere near either. The un-bounded shape it discriminates against
// is 12 polls of 50ms per type: nine hover-less collaborators is 5.4s.
//
// Nothing here needs a live language server, so SKIP_LIVE=1 changes nothing.
//
// Run: SKIP_LIVE=1 node --test test/blind-v50-p1-settle.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const show = (v) => JSON.stringify(v);

// ===========================================================================
// HARNESS. The walk, bundled pure. No vscode anywhere on this path.
// ===========================================================================

const ENTRY = path.join(__dirname, ".blind-v50-p1-settle.entry.ts");
const OUT = path.join(__dirname, ".blind-v50-p1-settle.bundle.cjs");

// The subject is normally this working tree's `src`. `BLIND_V50_SRC` repoints it
// at another src ROOT (a `git archive <commit> src | tar -x` of an older build)
// so a row can be run against the pre-bound code and shown to be load-bearing. A
// row that is green on both sides is not a detector, and this is how that is
// found out rather than assumed.
const SRC_ROOT = process.env.BLIND_V50_SRC
  ? path.resolve(process.env.BLIND_V50_SRC)
  : path.join(__dirname, "..", "src");
const SUBJECT = path.join(SRC_ROOT, "core", "crossFileShape");

let WALK = {};
let walkErr;
try {
  // `export *`, not a named list: the settle allowance did not exist before this
  // phase, and an entry that names it cannot BUILD against the pre-bound code.
  // A build failure there would turn every row red at once and prove nothing
  // about any of them. Each row checks for the export it needs itself.
  fs.writeFileSync(ENTRY, `export * from ${JSON.stringify(SUBJECT.split(path.sep).join("/"))};\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node" });
  WALK = require(OUT);
} catch (e) {
  walkErr = e;
}
test.after(() => [ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

// A bundle failure is a LOUD row, never a skip: a file that goes green because
// it could not build the subject is the false green this suite exists to stop.
const wtest = (name, fn) =>
  test(name, (ctx) => {
    if (walkErr) assert.fail(`the crossFileShape bundle did not build: ${walkErr.message}`);
    assert.equal(typeof WALK.resolveCrossFileShape, "function", "resolveCrossFileShape must be exported");
    return fn(ctx);
  });

test("guard: the bundle builds headless and every entry point this file drives is exported", () => {
  if (walkErr) assert.fail(`crossFileShape bundle failed from ${SRC_ROOT}: ${walkErr.message}`);
  for (const n of ["resolveCrossFileShape", "shapeHooksFor"]) {
    assert.equal(typeof WALK[n], "function", `${n} must be exported (bundled from ${SRC_ROOT})`);
  }
});

// ===========================================================================
// THE INSTRUMENT.
// ===========================================================================

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return e > s ? line.slice(s, e) : undefined;
};

const keyOf = (c) => `${c.uri}:${c.line}:${c.character}`;

// Every distinct cursor one operation was asked at, and its call count, in
// FIRST-TOUCH order. Both allowances are spent in resolution order, so this order
// is the order the allowance was offered.
const profileOf = (calls, op) => {
  const seen = [];
  const byKey = new Map();
  for (const c of calls) {
    if (c.op !== op) continue;
    if (!byKey.has(c.key)) {
      byKey.set(c.key, { name: c.word, key: c.key, count: 0 });
      seen.push(byKey.get(c.key));
    }
    byKey.get(c.key).count++;
  }
  return seen;
};

// `files` maps uri -> text. `defs` maps a type name to where a definition
// provider would place it. `hovers` is keyed by type name. `script` is keyed by
// type name and holds the SUCCESSIVE answers `membersOfType` gives at that
// type's cursor; the last entry repeats for every later call at that cursor.
function settleFixture({ files, hovers, defs, script = {} }) {
  const calls = [];
  const memberCalls = new Map(); // cursor key -> count so far
  const record = (op, cursor) => {
    const word = wordAt(files[cursor.uri] ?? "", cursor);
    calls.push({ op, word, key: keyOf(cursor), uri: cursor.uri, line: cursor.line, character: cursor.character });
    return word;
  };
  const extractor = {
    async definition(cursor) {
      const word = record("definition", cursor);
      if (!word || !(word in defs)) return undefined;
      const d = defs[word];
      return {
        uri: d.uri,
        range: {
          startLine: d.line,
          startCharacter: d.character,
          endLine: d.line,
          endCharacter: d.character + word.length,
        },
      };
    },
    async hoverSurface(cursor) {
      const word = record("hover", cursor);
      return word && word in hovers ? { signature: hovers[word] } : undefined;
    },
    async membersOfType(cursor) {
      const word = record("members", cursor);
      const key = keyOf(cursor);
      const n = memberCalls.get(key) ?? 0;
      memberCalls.set(key, n + 1);
      const seq = script[word];
      if (!seq) return [];
      const answer = seq[Math.min(n, seq.length - 1)];
      return (answer ?? []).map((m) => ({ ...m }));
    },
    async completeMembers() {
      return [];
    },
    async example() {
      return undefined;
    },
    async qualifyImport() {
      return undefined;
    },
  };
  return {
    extractor,
    calls,
    openFile: async (uri) => files[uri],
    rootAt(uri, name, line = 0) {
      const text = (files[uri] || "").split("\n")[line] ?? "";
      return { uri, line, character: text.indexOf(name) };
    },
    // How many times `membersOfType` was called at the cursor sitting on `name`.
    // This is C1-1's observable, in the contract's own terms.
    memberCallsFor(name) {
      return calls.filter((c) => c.op === "members" && c.word === name).length;
    },
    memberCallProfile() {
      return profileOf(calls, "members");
    },
    // The same, for the hover poll. C1-3f's allowance is spent in the same
    // resolution order, so this order is the order it was offered.
    hoverCallProfile() {
      return profileOf(calls, "hover");
    },
  };
}

const hooks = () => WALK.shapeHooksFor("rust");
const BOUND = { D_MAX: 2, N_MAX: 24 };
const keys = (shape) => [...shape.types.keys()];
const methodsOf = (shape, name) => shape.types.get(name)?.methods ?? [];
const fieldsOf = (shape, name) =>
  (shape.types.get(name)?.fields ?? []).map((f) => ({ name: f.name, typeName: f.typeName }));
const dump = (shape, f) =>
  `\n  types: ${show(keys(shape))}` +
  `\n  dropped: ${show(shape.dropped)}` +
  `\n  methods: ${show(Object.fromEntries(keys(shape).map((k) => [k, methodsOf(shape, k)])))}` +
  `\n  membersOfType calls per cursor: ${show(f.memberCallProfile().map((p) => `${p.name}@${p.key} x${p.count}`))}` +
  `\n  hoverSurface calls per cursor: ${show(f.hoverCallProfile().map((p) => `${p.name}@${p.key} x${p.count}`))}`;

const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

// Member shorthands. A member with a `signature` is one whose fan-out answered;
// one without is a member still waiting on its hover, which the renderer drops,
// so a set of those renders to nothing.
const signed = (name) => ({ name, kind: "method", signature: `fn ${name}(&self)` });
const bare = (name) => ({ name, kind: "method" });
const ctor = { name: "constructor", kind: "method", signature: "fn constructor(id: u64) -> Self" };

// Ten method names, so a member set of `ctor` plus these is the 11 members with
// 1 signed that the v21 measurement recorded coming back cold (see "Measured
// records" in docs/architecture/surface-injection.md). Used by C1-1b.
const V21_METHODS = ["place", "cancel", "total", "ship", "refund", "price", "tax", "audit", "split", "merge"];

// ---------------------------------------------------------------------------
// FIXTURE A. One type, one cursor. Everything C1-1 and C1-2 need.
// ---------------------------------------------------------------------------

const DEF_URI = "file:///w/app/order.rs";
const USE_URI = "file:///w/app/use.rs";
const A_LINES = [
  /* 0 */ "pub struct Order {",
  /* 1 */ "    pub id: u64,",
  /* 2 */ "}",
];
const A_TEXT = `${A_LINES.join("\n")}\n`;

const oneType = (answers) =>
  settleFixture({
    files: { [DEF_URI]: A_TEXT, [USE_URI]: "fn run(o: &Order) {\n\n}\n" },
    hovers: { Order: A_LINES.join("\n") },
    defs: { Order: { uri: DEF_URI, line: 0, character: A_LINES[0].indexOf("Order") } },
    script: { Order: answers },
  });

// `settle` is the caller's GESTURE allowance, the last parameter of the facade.
// Omitted, the walk mints its own, which is what every row before C1-3e wants.
const runOne = async (answers, settle) => {
  const f = oneType(answers);
  const t0 = process.hrtime.bigint();
  const shape = await WALK.resolveCrossFileShape(
    f.extractor,
    f.rootAt(USE_URI, "Order"),
    BOUND,
    f.openFile,
    hooks(),
    undefined,
    undefined,
    undefined,
    settle,
  );
  return { f, shape, elapsed: ms(t0) };
};

// ---------------------------------------------------------------------------
// FIXTURE B. Ten types, every one of them wanting to re-poll. C1-3 and C1-4.
//
// The root carries nine fields of nine distinct project types; each collaborator
// holds one primitive so the walk stops there. Resolution order is the root
// first, then the fields in declaration order.
// ---------------------------------------------------------------------------

const COLLABS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India"];
const ALL_TYPES = ["Root", ...COLLABS];
const B_URI = "file:///w/app/graph.rs";
const B_LINES = ["pub struct Root {", ...COLLABS.map((c) => `    pub ${c.toLowerCase()}: ${c},`), "}", ""];
for (const c of COLLABS) {
  B_LINES.push(`pub struct ${c} {`, "    pub n: u64,", "}", "");
}
const B_TEXT = `${B_LINES.join("\n")}\n`;
const lineOfStruct = (name) => B_LINES.findIndex((l) => l.startsWith(`pub struct ${name} `));
const hoverOfStruct = (name) => {
  const at = lineOfStruct(name);
  return B_LINES.slice(at, B_LINES.indexOf("}", at) + 1).join("\n");
};

// `hoverless` names get no hover answer at all, ever. That is the shape a type
// whose server has not indexed its file yet presents, and it is what puts the
// walk into the SECOND settle loop. The root is never hoverless in any row here:
// its hover is where the nine fields are read from, so a hoverless root is a
// one-type walk and measures nothing about a graph.
function graphFixture(answersFor, { hoverless = [] } = {}) {
  const hovers = {};
  const defs = {};
  const script = {};
  for (const name of ALL_TYPES) {
    const at = lineOfStruct(name);
    if (!hoverless.includes(name)) hovers[name] = hoverOfStruct(name);
    defs[name] = { uri: B_URI, line: at, character: B_LINES[at].indexOf(name) };
    script[name] = answersFor(name);
  }
  return settleFixture({ files: { [B_URI]: B_TEXT, [USE_URI]: "fn run(r: &Root) {\n\n}\n" }, hovers, defs, script });
}

const runGraph = async (answersFor, { hoverless, settle } = {}) => {
  const f = graphFixture(answersFor, { hoverless });
  const t0 = process.hrtime.bigint();
  const shape = await WALK.resolveCrossFileShape(
    f.extractor,
    f.rootAt(USE_URI, "Root"),
    BOUND,
    f.openFile,
    hooks(),
    undefined,
    undefined,
    undefined,
    settle,
  );
  return { f, shape, elapsed: ms(t0) };
};

// Every type answers the same single unsigned method forever: renders nothing,
// so every one of the ten wants to settle.
const ALWAYS_STUCK = () => [[bare("work")]];
// Every type renders on its first touch, so no settle can fire anywhere. This is
// the calibration walk.
const ALWAYS_READY = () => [[signed("work")]];

const WALK_BOUND_MS = 500;
const CALIBRATION_BOUND_MS = 200;

// ===========================================================================
// C1-0. The instrument reaches the subject.
//
// Without this, every row below could pass by measuring a walk that resolved
// nothing and therefore never settled anything.
// ===========================================================================

wtest("C1-0 CONTROL: the fixture resolves the root and the walk does ask its def cursor for members", async () => {
  const { f, shape } = await runOne([[signed("place")]]);
  assert.ok(shape.types.has("Order"), `the root must resolve, or no row in this file measures anything${dump(shape, f)}`);
  assert.ok(
    f.memberCallsFor("Order") >= 1,
    `\`membersOfType\` must reach the root's def cursor at least once${dump(shape, f)}`,
  );
  assert.ok(
    methodsOf(shape, "Order").some((m) => m.includes("place")),
    `and a signed member must reach the rendered list, or "renders nothing" below means nothing${dump(shape, f)}`,
  );
});

// ===========================================================================
// C1-1. WITHDRAWN by AMENDMENT 2. The no-progress stop is not in the build.
//
// It said: "If a re-poll returns the same member COUNT and the same SIGNED-member
// count as the answer before it, the walk stops re-polling that cursor", counted
// at the extractor as at most two calls. It was built, and the adversarial review
// showed it kills the one case the loop exists for (see the header, and C1-1b).
//
// These three rows are re-aimed at what is true instead: a cursor whose answer
// never moves spends its steps until the ALLOWANCE runs out, and nothing else
// ends it early. They still fail in both directions - red if the stop comes back
// (too few calls), red if the bound goes away (too many calls, too much clock).
//
// The step and the allowance are the contract's own numbers (AMENDMENT 2's
// table): 40ms a step, 120ms per gesture. A cursor that never renders can
// therefore be re-polled 3 times, which is 4 calls at that cursor, and that is
// the ceiling these rows assert. Nothing here reads a source constant.
// ===========================================================================

const MEMBER_STEP_MS = 40; // AMENDMENT 2's table.
const MEMBER_ALLOWANCE_MS = 120; // AMENDMENT 2's table.
const MAX_MEMBER_CALLS = 1 + MEMBER_ALLOWANCE_MS / MEMBER_STEP_MS;
const ONE_TYPE_BOUND_MS = 400; // 120ms of allowance plus wide headroom.

wtest("C1-1a [was: `[]` costs ONE re-poll]: an empty answer that stays empty spends the allowance, not one step", async () => {
  // WITHDRAWN ASSERTION: this row used to require at most 2 calls here, because
  // the second answer returned the same 0 members and the same 0 signed as the
  // first. AMENDMENT 2 withdrew the whole stop. What is bound now is the bound
  // that survived: the loop keeps asking, and the allowance is what ends it.
  const { f, shape, elapsed } = await runOne([[]]);
  assert.ok(shape.types.has("Order"), `CONTROL - the root must still resolve${dump(shape, f)}`);
  const n = f.memberCallsFor("Order");
  assert.ok(
    n > 2,
    `the no-progress stop is WITHDRAWN and an identical answer must not end the loop. \`membersOfType\` was ` +
      `called ${n} times at this cursor; 2 is the withdrawn behaviour coming back.${dump(shape, f)}`,
  );
  assert.ok(
    n <= MAX_MEMBER_CALLS,
    `and ${MEMBER_ALLOWANCE_MS}ms at ${MEMBER_STEP_MS}ms a step is ${MAX_MEMBER_CALLS} calls at one cursor. ` +
      `It was asked ${n} times, so something is spending sleep the allowance did not grant.${dump(shape, f)}`,
  );
  assert.ok(
    elapsed < ONE_TYPE_BOUND_MS,
    `one stuck cursor took ${elapsed.toFixed(1)}ms against a ${MEMBER_ALLOWANCE_MS}ms allowance${dump(shape, f)}`,
  );
});

wtest("C1-1b [was: 1 signed constructor costs ONE re-poll]: the v21 case at its MEASURED shape still recovers", async () => {
  // THE ROW THE WITHDRAWAL IS ABOUT. This used to assert at most 2 calls for a
  // cursor whose answer never changed, and the review showed that rule cannot
  // tell "never changes" from "not warm yet".
  //
  // Recorded under "Measured records" in docs/architecture/surface-injection.md:
  // a cold `membersOfType` answered 11 members with 1 signed in 52ms against a
  // 50ms fan-out budget, and warmed to a rendered
  // set. The MEMBER count is complete from the first answer because
  // documentSymbol is cheap; the SIGNATURES are what is missing, and a server
  // still cold 40ms later is cut by the same wall clock and answers 11/1 again.
  // The withdrawn stop fires on that second identical answer, one poll before the
  // warm one. Measured against the pre-bound code: 3 calls and 10 rendered
  // methods without the stop, 2 calls and 0 rendered with it.
  //
  // So the fixture is that shape: 11 members with 1 signed, TWICE, then warm.
  const cold = [ctor, ...V21_METHODS.map(bare)];
  const warm = [ctor, ...V21_METHODS.map(signed)];
  const { f, shape } = await runOne([cold, cold, warm]);
  assert.ok(shape.types.has("Order"), `CONTROL - the root must still resolve${dump(shape, f)}`);
  assert.equal(cold.length, 11, `CONTROL - the recorded shape is 11 members`);
  assert.equal(cold.filter((m) => m.signature).length, 1, `CONTROL - with 1 signed`);
  const n = f.memberCallsFor("Order");
  assert.ok(
    n >= 3,
    `two identical cold answers must not end the loop: the third is the warm one. \`membersOfType\` was ` +
      `called ${n} times, which is the withdrawn stop firing one poll early.${dump(shape, f)}`,
  );
  const rendered = methodsOf(shape, "Order");
  assert.equal(
    rendered.length,
    V21_METHODS.length,
    `every warm method must reach the block. A stop on the second identical answer renders NONE of them and ` +
      `a ${V21_METHODS.length}-method type reads as a type with none.${dump(shape, f)}`,
  );
});

wtest("C1-1c [was: 1 UNSIGNED method costs ONE re-poll]: a permanently stuck cursor is cut by the CLOCK, not by a rule", async () => {
  // WITHDRAWN ASSERTION: at most 2 calls, on the reasoning that a second
  // identical answer proves the wait will not pay. It does not - see C1-1b - and
  // the stop is gone. The measurement that motivated it stands and is not
  // withdrawn: Go, 32 re-polled cursors, every one answering identically all four
  // times, 0 recovering a signed member. What pays that cost down is the
  // allowance, and that is what this row now holds.
  const { f, shape, elapsed } = await runOne([[bare("flush")]]);
  assert.ok(shape.types.has("Order"), `CONTROL - the root must still resolve${dump(shape, f)}`);
  assert.deepEqual(
    methodsOf(shape, "Order"),
    [],
    `CONTROL - an unsigned member must render to nothing, or this cursor never had a reason to re-poll${dump(shape, f)}`,
  );
  const n = f.memberCallsFor("Order");
  assert.ok(
    n > 2,
    `\`membersOfType\` was called ${n} times at a cursor whose answer never moved. The stop that made that ` +
      `2 is withdrawn.${dump(shape, f)}`,
  );
  assert.ok(
    elapsed >= MEMBER_STEP_MS,
    `CONTROL - a cursor that renders nothing must actually sleep, or this row times a loop it never entered. ` +
      `The walk took ${elapsed.toFixed(1)}ms.${dump(shape, f)}`,
  );
  assert.ok(
    elapsed < ONE_TYPE_BOUND_MS,
    `and it must stop at the allowance: ${elapsed.toFixed(1)}ms against ${MEMBER_ALLOWANCE_MS}ms granted, ` +
      `after ${n} calls.${dump(shape, f)}`,
  );
});

// ===========================================================================
// C1-2. A changing answer still gets its re-polls. EXPECTED GREEN.
//
// The session-v21 case. These rows pin behaviour the first bound must not
// break; a red here is a regression, never a supersession.
// ===========================================================================

wtest("C1-2a: the session-v21 case - a first answer that renders nothing gets its re-poll, and the grown set renders", async () => {
  // The minimal form of the contract's worked example, and the one the loop was
  // built for: answer 1 is the construction member alone, signed, so nothing
  // renders; answer 2 adds two signed methods. Both of those must reach the
  // block.
  const grown = ["place", "cancel"];
  const { f, shape } = await runOne([[ctor], [ctor, ...grown.map(signed)]]);
  assert.ok(shape.types.has("Order"), `CONTROL - the root must resolve${dump(shape, f)}`);
  const n = f.memberCallsFor("Order");
  assert.ok(
    n >= 2,
    `a first answer that renders nothing must buy at least one re-poll, or the session-v21 case the loop ` +
      `exists for is gone. \`membersOfType\` was called ${n} times.${dump(shape, f)}`,
  );
  const rendered = methodsOf(shape, "Order");
  for (const name of grown) {
    assert.ok(
      rendered.some((m) => m.includes(name)),
      `${show(name)} arrived on a later answer and must be in the rendered list. A walk that settles on the ` +
        `FIRST answer reads a method-bearing type as a type with none.${dump(shape, f)}`,
    );
  }
});

wtest("C1-2a2 [was: the worked example in full]: once a set RENDERS anything, the walk takes it and stops asking", async () => {
  // WITHDRAWN ASSERTION: this row transcribed C1-2's worked example - "First
  // answer: only the construction member, signed. Second: two more signed
  // methods. Third: the full set. The rendered member list is the full set" - and
  // required all five of the third answer's methods to render.
  //
  // The first amendment withdrew that example as a contract defect. The walk has
  // always stopped re-polling the moment anything renders at all, which is older
  // than this session and outside the two bounds the phase was asked to build,
  // and extending it would ADD sleep, which is the opposite of the phase. C1-2 is
  // corrected to: a re-poll continues while nothing renders AND the answer keeps
  // changing; once a member set renders anything, the walk takes it.
  //
  // So the same three-answer fixture now binds the corrected rule. The second
  // answer is what renders, the third is never asked for, and the cursor costs
  // exactly two calls. This still fails in both directions: red if the walk
  // settles on the first answer (nothing rendered), red if it keeps polling
  // while the answer changes (the withdrawn wording, and more sleep).
  const second = ["place", "cancel"];
  const thirdOnly = ["total", "ship", "refund"];
  const { f, shape } = await runOne([
    [ctor],
    [ctor, ...second.map(signed)],
    [ctor, ...second.map(signed), ...thirdOnly.map(signed)],
  ]);
  assert.ok(shape.types.has("Order"), `CONTROL - the root must resolve${dump(shape, f)}`);
  const rendered = methodsOf(shape, "Order");
  assert.equal(
    rendered.length,
    second.length,
    `the second answer is the first one that renders anything, so it is the one the walk takes: ` +
      `${show(rendered)}${dump(shape, f)}`,
  );
  for (const name of second) {
    assert.ok(
      rendered.some((m) => m.includes(name)),
      `${show(name)} arrived on the answer that first rendered and must be in the list${dump(shape, f)}`,
    );
  }
  for (const name of thirdOnly) {
    assert.ok(
      !rendered.some((m) => m.includes(name)),
      `${show(name)} only exists on a THIRD answer. Reaching it means the walk kept re-polling a cursor that ` +
        `had already rendered, which is sleep this phase exists to remove.${dump(shape, f)}`,
    );
  }
  assert.equal(
    f.memberCallsFor("Order"),
    2,
    `and it must cost exactly the two calls that implies${dump(shape, f)}`,
  );
});

wtest("C1-2b: progress in the SIGNED count alone, with the member count unchanged, still counts as progress", async () => {
  // "The change may be in the member count or in the signed count. Either counts
  // as progress." Two members on every answer; on the first neither is signed,
  // so nothing renders; on the second both are.
  const { f, shape } = await runOne([[bare("place"), bare("cancel")], [signed("place"), signed("cancel")]]);
  assert.ok(shape.types.has("Order"), `CONTROL - the root must resolve${dump(shape, f)}`);
  assert.ok(
    f.memberCallsFor("Order") >= 2,
    `the first answer rendered nothing and a re-poll could still sign it, so it must be re-polled${dump(shape, f)}`,
  );
  const rendered = methodsOf(shape, "Order");
  for (const name of ["place", "cancel"]) {
    assert.ok(
      rendered.some((m) => m.includes(name)),
      `the member count never moved, only the signed count did, and that is progress. ${show(name)} is ` +
        `missing from the rendered list.${dump(shape, f)}`,
    );
  }
});

// ===========================================================================
// C1-3, AS AMENDED. The allowance is per GESTURE, and there are two of them.
//
// The original text said per WALK. AMENDMENT 2 widens it: `resolvePrefill`
// drives up to `budget.resolveCap` walks per prompt, 8 at the install default
// and 32 at the frontier stop, so an allowance minted per walk multiplies by that
// count. It is minted once per gesture and threaded in by the caller. A caller
// that omits it gets a fresh per-walk allowance, which is the single-walk case
// and the probe's, and that is what C1-3a..C1-3d exercise.
//
// The amendment also adds a SECOND loop and a second allowance:
//
//   loop                 step    one type's old cost   gesture allowance now
//   membersWithSettle    40ms    120ms                 120ms
//   hoverWithSettle      50ms    600ms                 600ms
//
// C1-3e..C1-3h bind the amended half.
// ===========================================================================

wtest("C1-3a CALIBRATION: the same ten-type graph with nothing to settle is far under the bound", async () => {
  const { f, shape, elapsed } = await runGraph(ALWAYS_READY);
  assert.equal(
    keys(shape).length,
    ALL_TYPES.length,
    `CONTROL - the walk must reach all ${ALL_TYPES.length} types, or this calibrates a smaller walk than the ` +
      `one C1-3b times${dump(shape, f)}`,
  );
  for (const name of ALL_TYPES) {
    assert.equal(
      f.memberCallsFor(name),
      1,
      `${show(name)} rendered on its first answer, so nothing may re-poll it; it was asked ` +
        `${f.memberCallsFor(name)} times${dump(shape, f)}`,
    );
  }
  assert.ok(
    elapsed < CALIBRATION_BOUND_MS,
    `the harness plus ten types of walk took ${elapsed.toFixed(1)}ms with ZERO sleeping. If this is red, ` +
      `C1-3b's number is about this machine and not about the allowance.${dump(shape, f)}`,
  );
});

wtest("C1-3b: a walk over ten re-polling types sleeps at most one type's worth in TOTAL", async () => {
  const { f, shape, elapsed } = await runGraph(ALWAYS_STUCK);
  assert.equal(
    keys(shape).length,
    ALL_TYPES.length,
    `CONTROL - all ${ALL_TYPES.length} types must be reached, or this walk did less work than the calibration ` +
      `one and the two times are not comparable${dump(shape, f)}`,
  );
  assert.ok(
    elapsed < WALK_BOUND_MS,
    `ten types each wanting to settle took ${elapsed.toFixed(1)}ms. One type's worth of sleep, 120ms, is the ` +
      `WHOLE walk's allowance and not each type's. The bound asserted here is ${WALK_BOUND_MS}ms, which is ` +
      `that allowance plus wide headroom for a loaded machine.${dump(shape, f)}`,
  );
});

wtest("C1-3c: once the allowance is spent, later types take their FIRST answer and do not re-poll", async () => {
  // The same claim as C1-3b with no clock in it. The allowance is spent in
  // resolution order, so the profile below is in first-touch order and the root
  // is its first entry.
  const { f, shape } = await runGraph(ALWAYS_STUCK);
  const profile = f.memberCallProfile();
  assert.equal(
    profile.length,
    ALL_TYPES.length,
    `CONTROL - one member cursor per type: ${show(profile.map((p) => p.name))}${dump(shape, f)}`,
  );
  assert.equal(
    profile[0].name,
    "Root",
    `CONTROL - the root must be the first cursor asked, or "resolution order" is not what this row reads${dump(shape, f)}`,
  );
  assert.ok(
    profile[0].count >= 2,
    `"spent in resolution order, so the root type gets first call on it": the root rendered nothing, so it ` +
      `must get its re-poll. It got ${profile[0].count} call(s).${dump(shape, f)}`,
  );
  const exhausted = profile.filter((p) => p.count === 1);
  assert.ok(
    exhausted.length > 0,
    `ten types all wanting to settle cannot all get one. With the allowance shared across the walk, the later ` +
      `ones must take their first answer and stop. Calls per cursor, in resolution order: ` +
      `${show(profile.map((p) => `${p.name} x${p.count}`))}${dump(shape, f)}`,
  );
  assert.equal(
    profile[profile.length - 1].count,
    1,
    `and the LAST cursor in resolution order is the one the allowance cannot possibly still cover; it got ` +
      `${profile[profile.length - 1].count} calls${dump(shape, f)}`,
  );
});

wtest("C1-3d: each walk starts with a FULL allowance - two sequential walks do not share one", async () => {
  // The growth fixture needs its re-polls to reach the full set. Run it twice in
  // a row through separate fixtures. A walk-scoped allowance gives the second
  // walk the same answer as the first; an allowance that survives a walk starves
  // it.
  const full = ["place", "cancel", "total"];
  const script = [[ctor], [ctor, signed("place")], [ctor, ...full.map(signed)]];
  const first = await runOne(script);
  const second = await runOne(script);
  const renderedOf = (r) => methodsOf(r.shape, "Order");
  assert.ok(
    renderedOf(first).length > 0,
    `CONTROL - the first walk must reach the grown set, or this compares two empties${dump(first.shape, first.f)}`,
  );
  assert.deepEqual(
    renderedOf(second),
    renderedOf(first),
    `the second walk rendered a different member list from the first on identical input. An allowance that ` +
      `survives a walk makes the product's answer depend on how many walks ran before it.` +
      `${dump(second.shape, second.f)}`,
  );
  assert.equal(
    second.f.memberCallsFor("Order"),
    first.f.memberCallsFor("Order"),
    `and it must cost the same: ${first.f.memberCallsFor("Order")} calls, then ${second.f.memberCallsFor("Order")}`,
  );
});

// ---------------------------------------------------------------------------
// The amended half of C1-3. A caller-supplied allowance, and the hover loop.
//
// The allowance object is written out of the amendment's own table rather than
// taken from the product, so these rows keep working against a build that has no
// such export at all - which is how they are shown to be load-bearing. C1-3h is
// the row that checks the product's own mint against the same table.
// ---------------------------------------------------------------------------

const HOVER_STEP_MS = 50; // AMENDMENT 2's table.
const HOVER_ALLOWANCE_MS = 600; // AMENDMENT 2's table.
const HOVER_WALK_BOUND_MS = 1500; // 600ms of allowance plus wide headroom.
const gestureAllowance = () => ({ memberMs: MEMBER_ALLOWANCE_MS, hoverMs: HOVER_ALLOWANCE_MS });

wtest("C1-3e: an allowance SUPPLIED by the caller is one gesture's, spent across every walk in it", async () => {
  // "It is minted once per gesture and threaded in." `resolvePrefill` drives up
  // to `resolveCap` walks per prompt, 8 at the install default. Three walks over
  // the same stuck cursor stand in for three of those: the first spends the
  // member allowance, and the rest must take their first answer and stop.
  //
  // C1-3d is the complement and both must hold: OMIT the argument and every walk
  // mints its own.
  const allowance = gestureAllowance();
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await runOne([[bare("work")]], allowance));
  const counts = runs.map((r) => r.f.memberCallsFor("Order"));
  assert.ok(
    counts[0] > 1,
    `CONTROL - the first walk in the gesture must get its re-polls, or the allowance was empty on arrival and ` +
      `the rest of this row is vacuous. Calls per walk: ${show(counts)}`,
  );
  assert.equal(
    counts[1],
    1,
    `the second walk in the same gesture must take its first answer and not re-poll: the first walk spent the ` +
      `${MEMBER_ALLOWANCE_MS}ms. Calls per walk: ${show(counts)}${dump(runs[1].shape, runs[1].f)}`,
  );
  assert.equal(counts[2], 1, `and so must the third. Calls per walk: ${show(counts)}`);
  for (const r of runs) {
    assert.ok(
      r.shape.types.has("Order"),
      `CONTROL - a starved walk still resolves and is not dropped${dump(r.shape, r.f)}`,
    );
  }
  const spent = runs[1].elapsed + runs[2].elapsed;
  assert.ok(
    spent < ONE_TYPE_BOUND_MS,
    `and the walks after the allowance is gone must not sleep: they took ${spent.toFixed(1)}ms between them`,
  );
});

wtest("C1-3f: the HOVER poll draws on a gesture allowance too, so a fat graph cannot multiply it", async () => {
  // The second sleep loop, directly above the one the phase was sent to bound:
  // 12 polls at 50ms, 600ms per TYPE, with no ceiling above it. Nine
  // collaborators whose hover never answers is 5.4s of it, and the amendment's
  // own example is a gesture resolving 8 candidates spending 4.8s.
  //
  // The root keeps its hover, because that is where the nine fields come from.
  // Every type's members render on the first touch, so the MEMBER loop cannot
  // contribute a millisecond here and the clock below is the hover loop's alone.
  const { f, shape, elapsed } = await runGraph(ALWAYS_READY, { hoverless: COLLABS });
  assert.equal(
    keys(shape).length,
    ALL_TYPES.length,
    `CONTROL - all ${ALL_TYPES.length} types must still be reached: a type whose hover never answers is not ` +
      `dropped by this phase${dump(shape, f)}`,
  );
  const hoverProfile = f.hoverCallProfile().filter((p) => COLLABS.includes(p.name));
  assert.equal(
    hoverProfile.length,
    COLLABS.length,
    `CONTROL - every collaborator must be hovered: ${show(hoverProfile.map((p) => `${p.name} x${p.count}`))}`,
  );
  assert.ok(
    hoverProfile[0].count > 1,
    `CONTROL - the FIRST hover-less type must actually enter the poll, or this row times a loop it never ` +
      `reached and its bound means nothing. ${show(hoverProfile.map((p) => `${p.name} x${p.count}`))}`,
  );
  const cheap = hoverProfile.filter((p) => p.count === 1);
  assert.ok(
    cheap.length > 0,
    `${COLLABS.length} hover-less types cannot each have ${HOVER_ALLOWANCE_MS}ms. Once the gesture's hover ` +
      `allowance is spent the rest take their first answer: ` +
      `${show(hoverProfile.map((p) => `${p.name} x${p.count}`))}`,
  );
  assert.equal(
    hoverProfile[hoverProfile.length - 1].count,
    1,
    `and the LAST one in resolution order is the one the allowance cannot still cover: ` +
      `${show(hoverProfile.map((p) => `${p.name} x${p.count}`))}`,
  );
  assert.ok(
    elapsed < HOVER_WALK_BOUND_MS,
    `${COLLABS.length} hover-less types took ${elapsed.toFixed(1)}ms. At ${HOVER_STEP_MS}ms a step with no ` +
      `ceiling that is ${HOVER_ALLOWANCE_MS}ms each; the gesture gets ${HOVER_ALLOWANCE_MS}ms in total.` +
      `${dump(shape, f)}`,
  );
});

wtest("C1-3g: the two allowances are separate budgets - spending the hover one does not starve the member one", async () => {
  // "There are TWO of them", with two different numbers, because they bound two
  // different loops. One gesture allowance object, drained of its hover half by a
  // graph of hover-less types, then handed to a walk that needs the member half.
  const allowance = gestureAllowance();
  const hoverWalk = await runGraph(ALWAYS_READY, { hoverless: COLLABS, settle: allowance });
  assert.ok(
    hoverWalk.elapsed < HOVER_WALK_BOUND_MS,
    `CONTROL - the hover walk must be bounded, or the gesture never got past it: ` +
      `${hoverWalk.elapsed.toFixed(1)}ms${dump(hoverWalk.shape, hoverWalk.f)}`,
  );
  const memberWalk = await runOne([[ctor], [ctor, signed("place")]], allowance);
  assert.ok(
    memberWalk.f.memberCallsFor("Order") >= 2,
    `the hover poll spent the gesture's hover allowance and left the member one alone. This walk rendered ` +
      `nothing on its first answer and must still get its re-poll; it was asked ` +
      `${memberWalk.f.memberCallsFor("Order")} times.${dump(memberWalk.shape, memberWalk.f)}`,
  );
  assert.ok(
    methodsOf(memberWalk.shape, "Order").some((m) => m.includes("place")),
    `and the member that arrived on the second answer must render${dump(memberWalk.shape, memberWalk.f)}`,
  );
});

wtest("C1-3h: the allowance the product mints for a caller that supplies none matches the contract's table", async () => {
  // The two numbers, at the one place a caller can read them. Any caller that
  // omits the argument gets this, so a build that quietly moves 120 or 600 moves
  // every gesture's patience with it. This row exists to make that loud.
  assert.equal(
    typeof WALK.freshSettleAllowance,
    "function",
    `a gesture allowance has to be mintable by the caller that threads it through its walks, or "minted once ` +
      `per gesture" has no API. Exports seen: ${show(Object.keys(WALK).sort())}`,
  );
  assert.deepEqual(
    WALK.freshSettleAllowance(),
    { memberMs: MEMBER_ALLOWANCE_MS, hoverMs: HOVER_ALLOWANCE_MS },
    `AMENDMENT 2's table: ${MEMBER_STEP_MS}ms a step and ${MEMBER_ALLOWANCE_MS}ms per gesture for the member ` +
      `re-poll, ${HOVER_STEP_MS}ms a step and ${HOVER_ALLOWANCE_MS}ms per gesture for the hover poll`,
  );
});

// ===========================================================================
// C1-4. Nothing else about resolution moves. EXPECTED GREEN.
// ===========================================================================

wtest("C1-4a: the FIRST membersOfType call is never skipped, whatever the allowance says", async () => {
  const { f, shape } = await runGraph(ALWAYS_STUCK);
  for (const name of ALL_TYPES) {
    assert.ok(
      f.memberCallsFor(name) >= 1,
      `${show(name)} was reached by the walk and never asked for its members. An allowance that can cut the ` +
        `FIRST ask does not bound a re-poll, it deletes the surface.${dump(shape, f)}`,
    );
  }
});

wtest("C1-4b: a type whose re-polls are cut short is EMITTED with what it had, not dropped", async () => {
  // Every type here renders nothing however many times it is asked. Under a
  // spent allowance the later ones get one answer and no more, and the contract
  // is explicit that this must not become a drop.
  const { f, shape } = await runGraph(ALWAYS_STUCK);
  for (const name of ALL_TYPES) {
    assert.ok(
      shape.types.has(name),
      `${show(name)} left the walk entirely. "They still resolve, still render whatever that answer gives, ` +
        `and are not dropped."${dump(shape, f)}`,
    );
    assert.equal(
      shape.dropped.includes(name),
      false,
      `${show(name)} was reported as dropped. A cut-short re-poll is not a drop, and reporting it as one ` +
        `sends the reader hunting for a resolution failure that did not happen.${dump(shape, f)}`,
    );
  }
});

wtest("C1-4c: a type whose re-polls are cut short still RENDERS what its one answer gave", async () => {
  // The root's first answer renders nothing and its later ones do; every
  // collaborator's FIRST answer already renders. Whatever the allowance does to
  // the collaborators' re-polls, their one answer must still reach the block.
  const { f, shape } = await runGraph((name) => (name === "Root" ? [[ctor], [ctor, signed("place")]] : [[signed("work")]]));
  for (const name of COLLABS) {
    assert.ok(
      methodsOf(shape, name).some((m) => m.includes("work")),
      `${show(name)} answered a signed member on its first touch and it did not render. The allowance bounds ` +
        `the RE-poll, not the answer.${dump(shape, f)}`,
    );
  }
});

wtest("C1-4d: fields, ordering and which types the walk reaches are all unchanged", async () => {
  // Everything in this row is derivable from the fixture alone: the nine fields
  // the root declares, in the order it declares them, and the ten types those
  // fields reach. Nothing here was read out of the product.
  const { f, shape } = await runGraph(ALWAYS_STUCK);
  assert.deepEqual(
    keys(shape).sort(),
    [...ALL_TYPES].sort(),
    `the walk must reach exactly the root and its nine field types${dump(shape, f)}`,
  );
  assert.deepEqual(
    fieldsOf(shape, "Root").map((x) => x.name),
    COLLABS.map((c) => c.toLowerCase()),
    `the root's nine fields, in declaration order${dump(shape, f)}`,
  );
  assert.deepEqual(
    fieldsOf(shape, "Root").map((x) => x.typeName),
    COLLABS,
    `and each with the type as written${dump(shape, f)}`,
  );
  for (const c of COLLABS) {
    assert.deepEqual(
      fieldsOf(shape, c).map((x) => x.name),
      ["n"],
      `${show(c)} declares one field and the walk must still read it${dump(shape, f)}`,
    );
  }
});

wtest("C1-4e: member ORDER inside a type follows the answer, and no member is invented or lost", async () => {
  const names = ["place", "cancel", "total", "ship"];
  const { f, shape } = await runOne([[ctor, ...names.map(signed)]]);
  const rendered = methodsOf(shape, "Order");
  assert.equal(
    rendered.length,
    names.length,
    `four signed methods plus a construction member the renderer drops: ${show(rendered)}${dump(shape, f)}`,
  );
  assert.deepEqual(
    names.map((n) => rendered.findIndex((m) => m.includes(n))),
    names.map((_, i) => i),
    `the rendered order must be the order the answer gave: ${show(rendered)}${dump(shape, f)}`,
  );
});
