// ADVERSARIAL REVIEW - session-v50 phase 1 (`membersWithSettle`, the two bounds).
// RE-CUT after the findings were acted on. Every row is now expected GREEN.
//
// I did not write the code under review. Every row is evidence for one claim in
// the review report. Rows that were DEFECT rows are kept in place, with the
// evidence that made them red, and re-cut against the shipped behaviour: the
// history is the point, so nothing is deleted.
//
// WHAT MOVED IN THE PRODUCT, and which row holds it:
//
//   Finding 1 (HIGH) - the no-progress stop ended the loop when a re-poll
//   returned the same member count and the same signed count. That is the v21
//   case at its MEASURED shape (11 members, 1 signed, twice). ACCEPTED IN FULL:
//   the stop is gone from `membersWithSettle`, the allowance is the only bound.
//   R1 and R1b were red against it and are green now. R1c had recorded that the
//   fingerprint was blind to member identity; its subject is gone, so it is
//   re-cut to record the recovery it used to record the loss of.
//
//   Finding 3 - the allowance was minted per WALK, and `resolvePrefill` drives
//   up to `budget.resolveCap` walks per gesture. ACCEPTED: minted once in
//   `resolvePrefill`, threaded in as `resolveCrossFileShape`'s optional `settle`.
//   R2a records the per-walk multiplication that a caller which OMITS it still
//   gets (by contract). R2b binds the new unit: one allowance, five walks, one
//   120ms spend. R2c binds the product caller, and goes red if a future edit
//   mints one inside the candidate loop again.
//
//   Finding 4 - `hoverWithSettle` was 12 x 50ms per TYPE with no ceiling above
//   it. ACCEPTED: it draws on a 600ms gesture allowance at a 50ms step. R3 binds
//   both halves of that: one type's patience is unchanged, and a gesture cannot
//   spend it twice.
//
// DEFER - Finding 2, accepted as reasoning, NOT acted on, and deliberately not
// tested here. The two rows that hold the v21 contract are frozen blind rows
// owned by other sessions (`test/blind-v21-p3b.test.cjs` §1b `soleConstructor()`,
// `test/impl-v21-p3b.test.cjs` F2 `cold`) and this file does not touch them.
// Both model the cold answer as a set of ONE member, so the warm answer
// necessarily changes the COUNT, and any count-based stop passes them. The
// measurement they were written from is not that shape:
// `docs/architecture/surface-injection.md` ("The cold cross-file walk") records
// a cold `membersOfType` answering ELEVEN members with ONE signed in 52ms
// against the 50ms hover fan-out budget, warming to 7 rendered. The count is
// complete from the first answer, because documentSymbol is cheap; the
// SIGNATURES are what the fan-out fills. Whoever owns those rows should re-cut
// their cold answer at 11 members / 1 signed and their warm answer at the same
// 11 with the rest signed. Until then those two rows cannot see a regression in
// the loop they exist to protect, and R1 here is the only row that can.
//
// DEFER - Finding 5, accepted, and the fix is in the latency-baseline probe,
// which this file does not own. What is already done there: `--cold` sets the
// per-open settle to 0 and skips the off-clock `openFile(r.uri)` before each
// row. What the probe must ALSO stop doing before a `--cold` run can produce
// the loop's case:
//   1. `assertAlive` runs `membersOfType(gateCursor)` before EVERY row, and
//      `gateCursor` is roots[0]'s own cursor (built at the same line the pre-run
//      gate uses). So roots[0]'s file has had documentSymbol computed off the
//      clock before its own row starts, and row 1 is warm by construction. Cold
//      mode needs a gate cursor in a file that is not among the timed roots, or
//      it must drop roots[0] from the row set.
//   2. `rootsFrom(..., perFile = 3)` takes three roots per file, so rows 2 and 3
//      over a file are warmed by row 1. Cold mode needs perFile = 1.
//   3. `makeOpener`'s `opened` Set lives for the whole run, so a file some
//      earlier row's walk DISCOVERED is warm when a later row names it as root.
//      Cold mode should skip a row whose uri is already in `opened`, or run one
//      row per process.
// Findings 6, 7 and 8 are phase 4's business and are not tested here.
//
// The subject is driven exactly as the blind oracle drives it: the pure
// `resolveCrossFileShape` facade, bundled headless, with a scripted extractor
// that can answer differently on successive calls at the same cursor. No vscode.
//
// Run: SKIP_LIVE=1 node --test test/review-v50-p1-settle.test.cjs
//
// DETECTOR PROOF. `REVIEW_V50_SRC=<dir>` points the bundle at another checkout's
// `src` (`git archive <rev> src | tar -x` into a scratch dir), so every row can
// be run against an older or a mutated tree and the ones that go red there are
// proven load-bearing. Unset, it is this repo's `src` and nothing about the run
// changes. Two trees were run, and the second is needed because the first cannot
// carry the finding-1 defect:
//
//   19f1e6f (the last commit, before this phase): R2b, R2c, R3, R4 and R5 red.
//   R1, R1b and R1c GREEN, and that is correct - the no-progress stop never
//   existed on that tree. It lived only in the phase's own working build, which
//   is not in git, so those three rows are proved against a MUTANT instead: the
//   shipped `membersWithSettle` with the count/signed-count stop pasted back in.
//   All three go red on it (2 member calls where the row requires 3), R5 goes
//   red with it, and every other row stays green.
//
// Rows that are green on all three trees are not detectors and say so: both R0
// controls and R2a.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const SRC = process.env.REVIEW_V50_SRC ?? path.join(__dirname, "..", "src");
const ENTRY = path.join(__dirname, ".review-v50-p1-settle.entry.ts");
const OUT = path.join(__dirname, ".review-v50-p1-settle.bundle.cjs");
let WALK = {};
let walkErr;
try {
  // `export *`, not a named re-export: a name this phase ADDED must be missing
  // at runtime on an older tree, not a build failure that reddens every row.
  fs.writeFileSync(ENTRY, `export * from ${JSON.stringify(path.join(SRC, "core/crossFileShape"))};\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node" });
  WALK = require(OUT);
} catch (e) {
  walkErr = e;
}
test.after(() => [ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

// A bundle failure is a loud row, never a skip.
const wtest = (name, fn) =>
  test(name, (ctx) => {
    if (walkErr) assert.fail(`the crossFileShape bundle did not build: ${walkErr.message}`);
    assert.equal(typeof WALK.resolveCrossFileShape, "function", "resolveCrossFileShape must be exported");
    return fn(ctx);
  });

// ===========================================================================
// INSTRUMENT - same shape as the blind oracle's, written independently here so
// this file stands alone if that one is re-cut.
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
const show = (v) => JSON.stringify(v);
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

function fixture({ files, hovers, defs, script = {} }) {
  const calls = [];
  const memberCalls = new Map();
  const record = (op, cursor) => {
    const word = wordAt(files[cursor.uri] ?? "", cursor);
    calls.push({ op, word, key: keyOf(cursor) });
    return word;
  };
  const extractor = {
    async definition(cursor) {
      const word = record("definition", cursor);
      if (!word || !(word in defs)) return undefined;
      const d = defs[word];
      return {
        uri: d.uri,
        range: { startLine: d.line, startCharacter: d.character, endLine: d.line, endCharacter: d.character + word.length },
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
      return (seq[Math.min(n, seq.length - 1)] ?? []).map((m) => ({ ...m }));
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
    memberCallsFor(name) {
      return calls.filter((c) => c.op === "members" && c.word === name).length;
    },
    hoverCallsFor(name) {
      return calls.filter((c) => c.op === "hover" && c.word === name).length;
    },
    profile() {
      const seen = [];
      const byKey = new Map();
      for (const c of calls) {
        if (c.op !== "members") continue;
        if (!byKey.has(c.key)) {
          byKey.set(c.key, { name: c.word, count: 0 });
          seen.push(byKey.get(c.key));
        }
        byKey.get(c.key).count++;
      }
      return seen.map((p) => `${p.name} x${p.count}`);
    },
  };
}

const hooks = () => WALK.shapeHooksFor("rust");
const BOUND = { D_MAX: 2, N_MAX: 24 };
const methodsOf = (shape, name) => shape.types.get(name)?.methods ?? [];
const dump = (shape, f) =>
  `\n  types: ${show([...shape.types.keys()])}` +
  `\n  methods: ${show(Object.fromEntries([...shape.types.keys()].map((k) => [k, methodsOf(shape, k)])))}` +
  `\n  membersOfType per cursor: ${show(f.profile())}`;

const signed = (name) => ({ name, kind: "method", signature: `fn ${name}(&self)` });
const bare = (name) => ({ name, kind: "method" });
// The construction member: signed, and dropped by `renderMethods` by design.
// This is the member that is the sole survivor in the session-v21 case.
const ctor = { name: "constructor", kind: "method", signature: "fn constructor(id: u64) -> Self" };

// --- one type, one cursor -------------------------------------------------

const DEF_URI = "file:///w/app/order.rs";
const USE_URI = "file:///w/app/use.rs";
const A_LINES = ["pub struct Order {", "    pub id: u64,", "}"];
const A_TEXT = `${A_LINES.join("\n")}\n`;

const orderFixture = (answers) =>
  fixture({
    files: { [DEF_URI]: A_TEXT, [USE_URI]: "fn run(o: &Order) {\n\n}\n" },
    hovers: { Order: A_LINES.join("\n") },
    defs: { Order: { uri: DEF_URI, line: 0, character: A_LINES[0].indexOf("Order") } },
    script: { Order: answers },
  });

// `settle` is the ninth argument. Passed, the walk spends a shared gesture
// allowance; omitted, it mints its own, which is the documented single-walk case.
const walkOrder = (f, settle) =>
  WALK.resolveCrossFileShape(f.extractor, f.rootAt(USE_URI, "Order"), BOUND, f.openFile, hooks(), undefined, undefined, undefined, settle);

const runOne = async (answers, settle) => {
  const f = orderFixture(answers);
  const t0 = process.hrtime.bigint();
  const shape = await walkOrder(f, settle);
  return { f, shape, elapsed: ms(t0) };
};

// --- a root plus N collaborators, all in one file --------------------------

const G_URI = "file:///w/app/graph.rs";
function graph(collabs, { hoverFor = () => true, answersFor = () => [[bare("work")]] } = {}) {
  const lines = ["pub struct Root {", ...collabs.map((c) => `    pub ${c.toLowerCase()}: ${c},`), "}", ""];
  for (const c of collabs) lines.push(`pub struct ${c} {`, "    pub n: u64,", "}", "");
  const text = `${lines.join("\n")}\n`;
  const lineOf = (name) => lines.findIndex((l) => l.startsWith(`pub struct ${name} `));
  const hoverOf = (name) => {
    const at = lineOf(name);
    return lines.slice(at, lines.indexOf("}", at) + 1).join("\n");
  };
  const hovers = {};
  const defs = {};
  const script = {};
  for (const name of ["Root", ...collabs]) {
    const at = lineOf(name);
    if (hoverFor(name)) hovers[name] = hoverOf(name);
    defs[name] = { uri: G_URI, line: at, character: lines[at].indexOf(name) };
    script[name] = answersFor(name);
  }
  return fixture({ files: { [G_URI]: text, [USE_URI]: "fn run(r: &Root) {\n\n}\n" }, hovers, defs, script });
}

const runGraph = async (f, settle) => {
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
  return { shape, elapsed: ms(t0) };
};

// ===========================================================================
// R0. CONTROL. Without these, every row below could pass on a walk that
// resolved nothing. Both are green on either side of the fix: a control is not
// a detector and is not meant to be.
// ===========================================================================

wtest("R0 CONTROL: the fixture resolves the root, asks its def cursor for members, and renders a signed one", async () => {
  const { f, shape } = await runOne([[signed("place")]]);
  assert.ok(shape.types.has("Order"), `the root must resolve${dump(shape, f)}`);
  assert.equal(f.memberCallsFor("Order"), 1, `a set that renders is never re-polled${dump(shape, f)}`);
  assert.ok(methodsOf(shape, "Order").some((m) => m.includes("place")), `a signed member renders${dump(shape, f)}`);
});

wtest("R0 CONTROL: a set that grows on the second answer still recovers", async () => {
  const { f, shape } = await runOne([[ctor], [ctor, signed("place")]]);
  assert.ok(methodsOf(shape, "Order").some((m) => m.includes("place")), `the grown answer renders${dump(shape, f)}`);
});

// ===========================================================================
// R1. THE NO-PROGRESS STOP KILLED THE CASE THE LOOP WAS KEPT FOR. FIXED: the
// stop is gone, and these rows now hold the recovery it broke.
//
// The session-v21 case is not a hypothesis. It was MEASURED in the v21 spike
// (`docs/architecture/surface-injection.md`, "The cold cross-file walk"):
//
//   "`membersOfType` on the first walk over a just-opened def file answers 11
//    members with 1 signed in 52ms, against the 50ms fan-out budget. The single
//    ask that lands is `__init__` ... The same walk warm renders 7 of 11."
//
// ELEVEN members, ONE signed. The member COUNT is whatever documentSymbol says
// and it is complete from the first answer; what is missing is the SIGNATURES,
// which the hover fan-out fills against a wall-clock budget
// (`HOVER_FANOUT_BUDGET_MS`). A server that is still cold answers the same 11/1
// again, because the budget cuts it again - and 11/1 == 11/1 was the removed
// no-progress fingerprint, so the walk stopped one poll before the answer the
// loop exists to reach.
//
// AGAINST THE BUILD THAT CARRIED THE STOP, which is what the review was run on,
// R1 measured 2 member calls and 0 of 10 methods rendered where the unbounded
// loop had made 3 calls and rendered 10. Re-measured here against the mutant
// described in the header: all three rows stop at 2 calls and render nothing.
// They are the detector for a count-based stop coming back.
// ===========================================================================

const eleven_one = [ctor, ...Array.from({ length: 10 }, (_, i) => bare(`render${i}`))];
const eleven_warm = [ctor, ...Array.from({ length: 10 }, (_, i) => signed(`render${i}`))];

wtest("R1 [RECORD] the MEASURED v21 shape (11 members, 1 signed, twice) reaches the warm third answer", async () => {
  const { f, shape } = await runOne([eleven_one, eleven_one, eleven_warm]);
  assert.ok(shape.types.has("Order"), `CONTROL - the root must resolve${dump(shape, f)}`);
  const rendered = methodsOf(shape, "Order");
  assert.equal(
    f.memberCallsFor("Order"),
    3,
    `the cold fan-out signed only the constructor on the first TWO answers, which is what a wall-clock ` +
      `fan-out budget does to a cold server. Two identical 11/1 answers must NOT end the walk: the third ` +
      `answer is the one the loop exists to reach.${dump(shape, f)}`,
  );
  assert.ok(
    rendered.length >= 10,
    `all ten warm methods must render; got ${rendered.length}${dump(shape, f)}`,
  );
});

wtest("R1b [RECORD] the cold-file race (`[]`, `[]`, then the members) survives the second empty answer", async () => {
  // The loop's own comment, still in the file: "membersOfType right after a
  // cold-file didOpen can return [] before RA has the documentSymbol ready (the
  // cold-file race) ... retry briefly". Two empty answers is 0/0 == 0/0, which
  // the removed stop read as no progress, leaving a one-step retry window.
  const { f, shape } = await runOne([[], [], [signed("place"), signed("cancel")]]);
  assert.ok(shape.types.has("Order"), `CONTROL - the root must resolve${dump(shape, f)}`);
  assert.equal(f.memberCallsFor("Order"), 3, `the empty answers must not end the retry window${dump(shape, f)}`);
  assert.equal(
    methodsOf(shape, "Order").length,
    2,
    `a server that answers empty twice and fills on the third poll is the documented cold-file race${dump(shape, f)}`,
  );
});

wtest("R1c [RECORD] two answers with identical counts and NO members in common still reach the third", async () => {
  // The row that recorded the removed fingerprint being blind to member
  // IDENTITY: answer 1 and answer 2 shared nothing but their two numbers, and
  // the walk read that as "no progress" and stopped with nothing. There is no
  // fingerprint left to be blind, so the row now records the recovery.
  const { f, shape } = await runOne([
    [ctor],
    [{ name: "Order", kind: "method", signature: "fn Order() -> Self" }],
    [ctor, signed("place")],
  ]);
  assert.equal(f.memberCallsFor("Order"), 3, `the identical-count answers must not end the walk${dump(shape, f)}`);
  assert.ok(methodsOf(shape, "Order").some((m) => m.includes("place")), `and the third answer renders${dump(shape, f)}`);
});

// ===========================================================================
// R2. THE ALLOWANCE WAS PER WALK AND fnGen DRIVES MANY WALKS PER PROMPT.
// FIXED: minted once per gesture and threaded in.
//
// `resolvePrefill` calls `resolveCrossFileShape` once per admitted candidate,
// inside `for (const type of candidates)`, bounded by `budget.resolveCap` - 8 at
// the install default, up to 32 at the frontier stop. Before the fix each call
// minted its own `{remainingMs: 120}`, so the PROMPT's ceiling was
// resolveCap x 120ms and every individual walk still looked well behaved.
//
// AGAINST 19f1e6f R2b finds no mintable allowance at all and R2c finds zero
// mints in `resolvePrefill`. Both are also the detector for a mint sliding back
// inside the candidate loop.
// ===========================================================================

// A cursor whose answer keeps CHANGING and never renders spends the whole
// member allowance: three 40ms steps.
const growing = [[bare("a")], [bare("a"), bare("b")], [bare("a"), bare("b"), bare("c")], [bare("a"), bare("b"), bare("c"), bare("d")]];

wtest("R2a [RECORD] a caller that OMITS the allowance still gets a fresh one per walk: five walks, five spends", async () => {
  // The contract's own single-walk case (C1-3d), and the shape `resolvePrefill`
  // had before the fix. Green on both sides of the fix by design: it records the
  // multiplication, it does not detect it.
  const t0 = process.hrtime.bigint();
  const perWalk = [];
  for (let i = 0; i < 5; i++) {
    const { elapsed } = await runOne(growing);
    perWalk.push(Math.round(elapsed));
  }
  const total = ms(t0);
  assert.ok(
    total > 500,
    `five allowance-less walks must cost five allowances; took ${total.toFixed(0)}ms, per-walk ${show(perWalk)}`,
  );
  assert.ok(perWalk.every((e) => e >= 110), `each walk spent its own full 120ms allowance; per-walk ms: ${show(perWalk)}`);
});

wtest("R2b [RECORD] ONE allowance threaded through five walks is spent once, and walks 2-5 never re-poll", async () => {
  // The new unit. This row goes red if a future edit mints an allowance per walk
  // again, whatever it is called.
  assert.equal(typeof WALK.freshSettleAllowance, "function", "the gesture allowance must be mintable by the caller");
  const settle = WALK.freshSettleAllowance();
  const t0 = process.hrtime.bigint();
  const calls = [];
  for (let i = 0; i < 5; i++) {
    const { f } = await runOne(growing, settle);
    calls.push(f.memberCallsFor("Order"));
  }
  const total = ms(t0);
  assert.deepStrictEqual(
    calls,
    [4, 1, 1, 1, 1],
    `the first walk spends the gesture's 120ms and every later walk takes its first answer as it stands. ` +
      `member calls per walk: ${show(calls)}`,
  );
  assert.ok(
    total < 400,
    `five walks sharing one allowance must cost ONE allowance, not five. Took ${total.toFixed(0)}ms with member ` +
      `calls ${show(calls)}`,
  );
});

wtest("R2c [RECORD] the product's gesture caller mints the allowance ONCE, outside the candidate loop", async () => {
  // A source row, because the caller is `resolvePrefill` and it cannot be driven
  // headless. It binds the seam the fix turns on: one mint, before the loop, and
  // the loop passes it down. Red on a tree without the allowance, and red again
  // if a mint moves inside `for (const type of candidates)`.
  const src = fs.readFileSync(path.join(SRC, "vscode/fnGen.ts"), "utf8");
  const mints = [...src.matchAll(/freshSettleAllowance\(\)/g)].map((m) => m.index);
  assert.equal(mints.length, 1, `resolvePrefill must mint exactly one gesture allowance; found ${mints.length}`);
  const loopAt = src.indexOf("for (const type of candidates)");
  assert.ok(loopAt > 0, "the candidate loop must still be findable in fnGen.ts");
  assert.ok(
    mints[0] < loopAt,
    `the allowance is minted INSIDE the candidate loop, so every candidate gets a fresh one and the gesture ` +
      `ceiling is resolveCap x 120ms again`,
  );
  const call = src.indexOf("resolveCrossFileShape(", loopAt);
  assert.ok(call > 0, "the loop must still call resolveCrossFileShape");
  assert.ok(
    src.slice(call, call + 1200).includes("settleAllowance"),
    "the walk in the candidate loop must be handed the gesture's allowance",
  );
});

// ===========================================================================
// R3. THE OTHER SLEEP LOOP IN THE SAME FUNCTION WAS UNBOUNDED. FIXED: it draws
// on a 600ms gesture allowance at a 50ms step.
//
// `hoverWithSettle` polled TWELVE times at 50ms - 600ms per type, per walk, with
// no allowance and nothing above it, so a gesture resolving 8 candidates could
// sleep 4.8s there while the phase spent its whole budget bounding 120ms. The
// probe could not even see it: `latency-baseline.cjs` computes
// `sleep = row_ms - server - opens*250` and prints the residual as
// `SLEEP(settle re-poll)`, so hover sleep was reported as member re-poll sleep.
//
// AGAINST 19f1e6f this row measures 12 polls for EVERY collaborator, 36 in the
// one walk, and the walk takes 1814ms. It is the detector for that returning.
// ===========================================================================

wtest("R3 [RECORD] three hover-less collaborators share ONE 600ms hover allowance: first type patient, rest not", async () => {
  const collabs = ["Alpha", "Bravo", "Charlie"];
  const f = graph(collabs, {
    // The ROOT hovers (so its fields parse and the collaborators are reached);
    // the collaborators' defs resolve but their hover never answers.
    hoverFor: (name) => name === "Root",
    answersFor: () => [[signed("work")]],
  });
  const { shape, elapsed } = await runGraph(f);
  assert.ok(shape.types.has("Root"), `CONTROL - the root must resolve${dump(shape, f)}`);
  assert.equal([...shape.types.keys()].length, 4, `CONTROL - all four types are reached${dump(shape, f)}`);
  const polls = collabs.map((c) => f.hoverCallsFor(c));
  assert.equal(
    Math.max(...polls),
    12,
    `ONE TYPE'S PATIENCE IS UNCHANGED: the first collaborator to need it still gets all twelve polls. ` +
      `hover polls per collaborator: ${show(polls)}${dump(shape, f)}`,
  );
  assert.equal(
    polls.reduce((a, b) => a + b, 0),
    14,
    `and the gesture cannot spend that patience twice: after the allowance is gone every later type asks ` +
      `once and moves on. hover polls per collaborator: ${show(polls)}${dump(shape, f)}`,
  );
  assert.ok(
    elapsed > 500 && elapsed < 900,
    `the walk must cost ONE hover allowance, not three. Took ${elapsed.toFixed(0)}ms with polls ` +
      `${show(polls)}${dump(shape, f)}`,
  );
});

// ===========================================================================
// R4. ORDER. The root really is first, and that is the starvation.
//
// The contract says the allowance is spent "in resolution order, so the root
// type gets first call on it" (C1-3). It is, and on a COLD start - the only
// state in which the loop's case exists - the root's own three steps consume the
// whole walk allowance and every collaborator takes its first answer with no
// re-poll at all. With the no-progress stop gone the root can spend it faster,
// not slower: nothing ends its re-polling early any more. The loop is, in
// practice, a ROOT-ONLY loop, and that is the trade this phase made.
//
// AGAINST 19f1e6f every collaborator takes 4 member calls of its own and the
// walk costs 485ms, so this row is also the detector for the allowance going
// away.
// ===========================================================================

wtest("R4 [RECORD] a root that spends the allowance leaves every collaborator with exactly ONE members call", async () => {
  const collabs = ["Alpha", "Bravo", "Charlie"];
  const f = graph(collabs, { answersFor: (name) => (name === "Root" ? growing : [[bare("cold")]]) });
  const { shape, elapsed } = await runGraph(f);
  assert.equal(f.memberCallsFor("Root"), 4, `the root took all three steps${dump(shape, f)}`);
  for (const c of collabs) {
    assert.equal(
      f.memberCallsFor(c),
      1,
      `${c} never got a re-poll: the root had already spent the walk's 120ms. On a cold start every ` +
        `collaborator is in exactly the state the loop exists for.${dump(shape, f)}`,
    );
  }
  assert.ok(elapsed < 300, `and the walk is fast, which is the trade being recorded: ${elapsed.toFixed(0)}ms`);
});

// ===========================================================================
// R5. THE ALLOWANCE, NOT THE STOP, IS WHAT BOUNDS THE WALK.
//
// This was the row that argued the no-progress stop bought almost nothing the
// allowance did not, read off the shipped after-side: every row at the 120ms
// ceiling (`ConnConfig` 122ms, `Config` 125ms, `ConnectError` 121ms,
// `FallbackConfig` 130ms) was bound by the ALLOWANCE, and the stop only moved
// rows already under it. The stop is now gone, and the row is re-cut to hold
// what remains: the allowance alone is a ceiling that does not grow with the
// graph. Nine stuck cursors cost one allowance.
//
// AGAINST 19f1e6f the same nine cursors take 4 member calls EACH and the walk
// costs 1092ms, which is the 9 x 3 x 40ms this phase was sent to kill. Against
// the stop mutant it reads [2,1,1,...]: the stop makes the numbers smaller here
// and, per R1, at the cost of the case the loop is for.
// ===========================================================================

wtest("R5 [RECORD] nine stuck cursors cost ONE allowance: the ceiling does not scale with the graph", async () => {
  const collabs = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
  const f = graph(collabs, { answersFor: () => [[bare("cold")]] });
  const { shape, elapsed } = await runGraph(f);
  assert.equal([...shape.types.keys()].length, 9, `CONTROL - nine types${dump(shape, f)}`);
  const counts = ["Root", ...collabs].map((n) => f.memberCallsFor(n));
  assert.deepStrictEqual(
    counts,
    [4, 1, 1, 1, 1, 1, 1, 1, 1],
    `the root spends the gesture's three steps and every other stuck cursor takes what it has${dump(shape, f)}`,
  );
  assert.ok(
    elapsed >= 110 && elapsed < 400,
    `the walk sleeps its 120ms once, not once per stuck cursor. Took ${elapsed.toFixed(0)}ms${dump(shape, f)}`,
  );
});
