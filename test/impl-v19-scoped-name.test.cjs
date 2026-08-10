// Phase 1 do-list, the half the blind file structurally cannot see.
//
// `blind-v19-sticky-selection.test.cjs` runs with `fimMemberGate: false` on
// purpose, so a suppression there could never masquerade as a scoping failure.
// Both regressions the triage reproduced live on the gate-ON side of that
// switch:
//
//   - a scoped request served a DIFFERENT member than the widget highlighted,
//     because `ghostRefs` composes `memberPartial + lead` and a real sibling
//     falls out of the composition.
//
// So this file arms the gate and drives the REAL provider, the REAL service and
// the REAL cache. Every claim about a suppression is paired with a control on
// the same landed text, and every claim about a cache hit is paired with a
// model-call count.

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const TAG = ".impl-v19-scoped";
const STUB = path.join(__dirname, `${TAG}-vscode-stub.cjs`);
const REGISTRY_STUB = path.join(__dirname, `${TAG}-registry.ts`);
const entry = path.join(__dirname, `${TAG}.entry.ts`);
const outfile = path.join(__dirname, `${TAG}.bundle.cjs`);
const buildScript = path.join(__dirname, `${TAG}.build.cjs`);

fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; }
  translate(l, c) { return new Position(this.line + (l || 0), this.character + (c || 0)); } }
class Range { constructor(a, b, c, d) {
  if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
  else { this.start = a; this.end = b; } } }
module.exports = {
  Position, Range,
  Uri: { parse: (s) => ({ toString: () => s }) },
  languages: {}, window: {}, commands: {},
  workspace: {
    // The one difference from the blind harness: fimMemberGate is ON, which is
    // the population both phase-1 regressions live in.
    getConfiguration: () => ({ get: (k, d) => {
      if (k === "fimAlternatives") { return 1; }
      if (k === "fimMemberGate") { return true; }
      if (k === "debounceMs") { return 0; }
      return d;
    } }),
    textDocuments: [],
    openTextDocument: async () => { throw new Error("no such file"); },
  },
  InlineCompletionItem: class { constructor(text, range) { this.insertText = text; this.range = range; } },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  ThemeColor: class {}, MarkdownString: class {}, EventEmitter: class {},
};\n`
);

fs.writeFileSync(
  REGISTRY_STUB,
  `export function extractorFor(_languageId: string): any {
  return (globalThis as any).__v19ImplExtractor;
}\n`
);

fs.writeFileSync(
  entry,
  `export { FimCompletionProvider } from "../src/vscode/completionProvider";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";
export { fimMemberSite } from "../src/core/fimInject";\n`
);

fs.writeFileSync(
  buildScript,
  `require("esbuild").build({
  entryPoints: [${JSON.stringify(entry)}],
  bundle: true, outfile: ${JSON.stringify(outfile)}, format: "cjs", platform: "node",
  alias: { vscode: ${JSON.stringify(STUB)} },
  plugins: [{ name: "registry", setup(b) {
    b.onResolve({ filter: /(^|\\/)extractors$/ }, () => ({ path: ${JSON.stringify(REGISTRY_STUB)} }));
  } }],
}).catch((e) => { console.error(e); process.exit(1); });\n`
);

let buildError;
let mod = {};
try {
  execFileSync(process.execPath, [buildScript], { stdio: "pipe" });
  mod = require(outfile);
} catch (e) {
  buildError = e;
}

test.after(() => {
  [STUB, REGISTRY_STUB, entry, outfile, buildScript].forEach((f) => fs.rmSync(f, { force: true }));
});

const need = () => {
  if (buildError) assert.fail(`the bundle does not build: ${String(buildError.stderr || buildError.message).slice(0, 2000)}`);
  return mod;
};

test("harness: the gate-ON bundle builds and exports the product's own member-site detector [harness guard]", () => {
  const m = need();
  assert.strictEqual(typeof m.FimCompletionProvider, "function");
  assert.strictEqual(typeof m.CompletionService, "function");
  assert.strictEqual(typeof m.fimMemberSite, "function");
});

// ---------------------------------------------------------------------------
// Fixture. `enrollTile` and `enrollTileTally` are the sibling pair the triage
// reproduced against: the second EXTENDS the first, so VS Code's augmentation
// rule passes `.enrollTileTally` for a widget showing `.enrollTile`, and
// `ghostRefs` composes `enrollTile` + `Tally` into a name the gate resolves.
// `enrollTile` takes ONE argument, which is the arity leg's evidence.
// ---------------------------------------------------------------------------

const MEMBERS = [
  { name: "enrollTile", kind: "method", signature: "enrollTile(tile: Tile): boolean" },
  { name: "enrollTileTally", kind: "method", signature: "enrollTileTally(a: A, b: B): number" },
  { name: "enqueue", kind: "method", signature: "enqueue(job: Job): void" },
  { name: "endpoint", kind: "property", signature: "endpoint: string" },
];

const SOURCE = "let s: Stripe;\ns.";
const LINE = 1;
const DOT = 2; // the cursor sits at `s.` with nothing typed

function makeDoc(text, languageId = "typescript") {
  return {
    _text: text,
    version: 1,
    languageId,
    uri: { toString: () => "file:///impl-v19.ts" },
    get lineCount() {
      return this._text.split("\n").length;
    },
    lineAt(line) {
      const lines = this._text.split("\n");
      return { range: { end: makePos(line, (lines[line] || "").length) }, text: lines[line] || "" };
    },
    getText(range) {
      if (!range) return this._text;
      const lines = this._text.split("\n");
      const at = (p) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
      return this._text.slice(at(range.start), at(range.end));
    },
    offsetAt(p) {
      const lines = this._text.split("\n");
      return lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
    },
  };
}

function makePos(line, character) {
  return {
    line,
    character,
    translate(l, c) {
      return makePos(this.line + (l || 0), this.character + (c || 0));
    },
  };
}

// The widget's own replacement range starts AT the separator and runs to the
// cursor, which is why `selectedCompletionInfo.text` carries the leading `.`.
const selectionAt = (text, endChar = DOT) => ({
  text,
  range: { start: makePos(LINE, endChar - (text.length - text.replace(/^[.:]+/, "").length) - (endChar - DOT)), end: makePos(LINE, endChar) },
});

// One provider, one service, one cache, a sequence of requests. `ghost` is
// asked for the text the model returns and is handed the prefix it is
// continuing, so a test can make the model's answer depend on the scope the
// prompt carries - which is what a real scoped generation does.
async function session(steps, ghost) {
  const { FimCompletionProvider, CompletionService, DEFAULT_FIM_CONFIG } = need();

  globalThis.__v19ImplExtractor = {
    async completeMembers() {
      return MEMBERS;
    },
    async membersOfType() {
      return [];
    },
    async definition() {
      return undefined;
    },
  };

  const calls = [];
  const logged = [];
  const service = new CompletionService(
    { ...DEFAULT_FIM_CONFIG, debounceMs: 0, cacheCapacity: 100 },
    async (req) => {
      calls.push(req);
      return { text: ghost(req), ttftMs: 1, totalMs: 2 };
    },
    (line) => logged.push(line)
  );

  const provider = new FimCompletionProvider(
    () => service,
    { appendLine: (line) => logged.push(line) }
  );
  const doc = makeDoc(SOURCE);
  const results = [];

  for (const step of steps) {
    const position = makePos(LINE, step.char ?? DOT);
    const before = calls.length;
    const raw = await provider.provideInlineCompletionItems(
      doc,
      position,
      { triggerKind: step.triggerKind ?? 0, selectedCompletionInfo: step.sci },
      { onCancellationRequested: () => {}, isCancellationRequested: false }
    );
    const items = Array.isArray(raw) ? raw : (raw && raw.items) || [];
    results.push({ items, modelCalls: calls.length - before });
  }

  service.dispose();
  return { results, logged };
}

// What the buffer would read after this item lands, reconstructed from the
// document rather than from anything the provider computed. This is the oracle:
// if it reads the wrong member, the user sees the wrong member.
function landed(item, source = SOURCE) {
  const lines = source.split("\n");
  const at = (p) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return source.slice(0, at(item.range.start)) + String(item.insertText) + source.slice(at(item.range.end));
}

// The member name the landed buffer spells, classified by the product's OWN
// site detector rather than by a regexp this file invented. `fimMemberSite`
// answers for a cursor at the END of its input, so the member is read off the
// LONGEST leading slice of the landed buffer that still classifies as a member
// site - which is the slice ending at the last character of the name.
function landedMember(item) {
  const { fimMemberSite } = need();
  const text = landed(item);
  let found;
  for (let i = 1; i <= text.length; i++) {
    const site = fimMemberSite(text.slice(0, i));
    if (site) {
      found = site.partial;
    }
  }
  return found;
}

// ===========================================================================
// DO-1. No item may name a member other than the scoped one.
// ===========================================================================

test("DO-1. a WALKED cache hit that composes into a sibling is refused, and the same walk scoped to that sibling is still served - the rule is 'never a different member', not 'never walk'", async () => {
  // The entry is authored unscoped at `s.` as `enrollTileTally(a, b)`. A
  // request scoped to `.enrollTile` asks the model to continue a prefix ending
  // in `enrollTile`, which the cache reaches by WALKING that entry ten
  // characters - handing back `Tally(a, b)` with no model call. Composed onto
  // the widget's `.enrollTile` it lands `.enrollTileTally(a, b)`: a member the
  // user did not select, served authoritatively, at zero cost.
  const ghost = () => "enrollTileTally(a, b)";

  const refuse = await session([{ sci: undefined }, { sci: selectionAt(".enrollTile") }], ghost);
  assert.strictEqual(refuse.results[0].items.length, 1, "control sanity: the unscoped author must produce the cache entry");
  assert.strictEqual(refuse.results[1].modelCalls, 0, "control sanity: the second request must be a cache hit, or this test is not exercising the walk");
  assert.deepStrictEqual(
    refuse.results[1].items.map((i) => landed(i)),
    [],
    "a walked hit composing into a sibling must be refused"
  );

  // CONTROL, identical in every respect except which member the widget shows.
  // Same authored entry, same walk, same zero model calls - and now the landed
  // name IS the scoped member, so it must be served. Without this row the test
  // above is satisfied by a rule that simply never walks.
  const keep = await session([{ sci: undefined }, { sci: selectionAt(".enrollTileTally") }], ghost);
  assert.strictEqual(keep.results[1].modelCalls, 0, "the control must reach the same walked hit");
  assert.strictEqual(keep.results[1].items.length, 1, "a walked hit landing the SCOPED member must still be served");
  assert.strictEqual(landed(keep.results[1].items[0]), "let s: Stripe;\ns.enrollTileTally(a, b)");
});

test("DO-1. a FRESH generation that composes into a sibling is refused - the composition never touches the cache, so no cache-walk rule could see it", async () => {
  // Route B from the triage: the model, asked to continue `s.enrollTile`,
  // returns `Tally(a, b)`. `ghostRefs` reads `memberPartial + lead` as
  // `enrollTileTally`, finds it in the resolved member set, and BLESSES it.
  const { results, logged } = await session([{ sci: selectionAt(".enrollTile") }], () => "Tally(a, b)");
  assert.strictEqual(results[0].modelCalls, 1, "control sanity: this row must be a real generation, not a cache hit");
  assert.deepStrictEqual(results[0].items.map((i) => landed(i)), [], "a fresh generation composing into a sibling must be refused");
  assert.ok(
    logged.some((l) => l.includes("widget selected enrollTile")),
    `the refusal must say which member was selected, so a dogfood log can tell it from silence; got ${JSON.stringify(logged)}`
  );

  // CONTROL: the identical shape, one letter different, where the composition
  // yields the SCOPED member instead of a sibling. Served.
  const ok = await session([{ sci: selectionAt(".enrollTile") }], () => "(a)");
  assert.strictEqual(ok.results[0].modelCalls, 1);
  assert.strictEqual(landed(ok.results[0].items[0]), "let s: Stripe;\ns.enrollTile(a)");
});

test("DO-1. the rule holds on the STICKY path, where selectedCompletionInfo is undefined - a rule keyed on the live selection goes inert exactly at the Tab", async () => {
  // Preselect `.enqueue` (the widget's auto-highlight), ARROW to `.enrollTile`,
  // Escape (VS Code re-invokes with no selection at the same position and
  // version), Tab. The arrow is what makes the scope sticky; the last row is the
  // one the user accepts, and it is the row a live-selection rule cannot judge.
  const arrow = [{ sci: selectionAt(".enqueue") }, { sci: selectionAt(".enrollTile") }, { sci: undefined }];
  const { results } = await session(arrow, () => "Tally(a, b)");
  assert.deepStrictEqual(results[2].items.map((i) => landed(i)), [], "the post-Escape item is the one the user Tabs and must be judged");

  const ok = await session(arrow, () => "(a)");
  assert.strictEqual(
    landed(ok.results[2].items[0]),
    "let s: Stripe;\ns.enrollTile(a)",
    "control: the sticky path must still serve a ghost that lands the scoped member"
  );
});

test("DO-1. reopening the widget WITHOUT typing ends the session: the reopen's own preselect governs and the earlier ARROWED member does not come back", async () => {
  // The review's reopen leak. Arrow to enrollTile (active, sticky with no
  // deadline), Escape (serves enrollTile), then re-open the widget at the SAME
  // untouched state - its auto-highlight is enqueue, and the user arrows
  // nowhere. That reopen is a FRESH session, so what it holds is its own
  // passive preselect on its own v20 window. The leak this guards is
  // enrollTile: an active flag that outlived its widget would re-scope the
  // reopen to a member the user chose in a session that has ended.
  const { results } = await session(
    [
      { sci: selectionAt(".enqueue") }, // preselect
      { sci: selectionAt(".enrollTile") }, // arrow -> active, sticky enrollTile
      { sci: undefined }, // Escape: serves enrollTile
      { sci: selectionAt(".enqueue") }, // reopen: preselect enqueue, no arrow
      { sci: undefined }, // Escape: serves the REOPEN's own preselect
    ],
    () => "(a)",
  );
  // The first Escape (index 2) is sticky enrollTile.
  assert.strictEqual(landed(results[2].items[0]), "let s: Stripe;\ns.enrollTile(a)", "the arrowed member is sticky at the first Escape");
  // The reopen's Escape (index 4) lands the reopen's own preselect, and never
  // the previous session's arrowed member. That the reopen's scope is on a
  // 1500ms clock while the arrowed one was not is pinned by
  // test/blind-v20-preselect-window.test.cjs, which injects a clock; this
  // harness has no clock to drive, so it pins WHICH member only.
  const reopened = results[4].items.map((i) => landed(i));
  assert.deepStrictEqual(
    reopened,
    ["let s: Stripe;\ns.enqueue(a)"],
    "the reopen Escape must land the reopen's own preselect enqueue, never the ended session's enrollTile",
  );
});

test("DO-1. the arrowing cache win survives: down to member 3 and back up to member 1 costs no model call, and each serve names the member the widget shows", async () => {
  // Each highlighted member mints its own prompt and its own cache key, so the
  // return trip is only a hit if member 1's entry is still there and still
  // matches. The ghost depends on the prefix, which is what makes a wrong
  // serve detectable: a mis-keyed hit would land the wrong member's arguments.
  const arity = { enrollTile: "(a)", enqueue: "(job)", endpoint: "" };
  const ghost = (req) => {
    const name = Object.keys(arity).find((n) => req.prefix.endsWith(n));
    return arity[name] === "" ? ";" : arity[name];
  };
  const order = [".enrollTile", ".enqueue", ".endpoint", ".enrollTile"];
  const { results } = await session(order.map((text) => ({ sci: selectionAt(text) })), ghost);

  assert.deepStrictEqual(
    results.map((r) => r.modelCalls),
    [1, 1, 1, 0],
    "the return to member 1 must be a cache hit; a non-zero fourth call means arrowing back costs a generation"
  );
  assert.deepStrictEqual(
    results.map((r) => (r.items[0] ? landedMember(r.items[0]) : undefined)),
    ["enrollTile", "enqueue", "endpoint", "enrollTile"],
    "classified with the product's own fimMemberSite: every serve names the member the widget was showing"
  );
});

test("DO-1. a model echoing the selected name is REFUSED where the gate is armed, and where it is dark the echo strip leaves evidence instead of hiding the failure", async () => {
  // A scoped prompt already ends in the member name, so a model that re-writes
  // it has contradicted its own prefix. With the gate armed that failure is
  // visible outright: the ghost is dropped with a reason. Nothing is rescued.
  const { results, logged } = await session([{ sci: selectionAt(".enrollTile") }], () => "enrollTile(a)");
  assert.deepStrictEqual(results[0].items.map((i) => landed(i)), [], "an echoed name must not be rescued into a plausible ghost");
  assert.ok(
    logged.some((l) => l.includes("re-spelled enrollTile")),
    `the echo must be reported as a model failure, not silently normalised; got ${JSON.stringify(logged)}`
  );

  // The echo and the hallucination refusal shared one log line until v19 phase
  // 3, and sharing it made the echo uncountable: a dogfood session could not
  // tell a model that contradicted its own prompt from one that invented a
  // member. Both still refuse; the point is that they now SAY different things.
  // Asserting the two lines differ is what stops a later simplification
  // collapsing them back, which would silently re-close the only route to
  // measuring how often the echo actually happens.
  const invented = await session([{ sci: selectionAt(".enrollTile") }], () => "vaporize(a)");
  assert.deepStrictEqual(invented.results[0].items.map((i) => landed(i)), [], "a hallucinated member is refused too");
  const lineFor = (ls) => ls.find((l) => l.includes("[fim] dropped:"));
  assert.notStrictEqual(
    lineFor(logged),
    lineFor(invented.logged),
    "the echo and the hallucination must be distinguishable in the channel, not one line for two failures"
  );
  assert.ok(
    lineFor(invented.logged).includes("names no resolved member"),
    `the hallucination keeps its own reason; got ${JSON.stringify(invented.logged)}`
  );

  // The strip that survives for the gate-dark configuration cannot launder a
  // sibling. Consuming the echoed `enrollTile` off `enrollTileTally(a, b)`
  // still lands `enrollTileTally`, which the scoped-name check refuses. This is
  // the row separating "spelled twice" from "wrong member".
  const sibling = await session([{ sci: selectionAt(".enrollTile") }], () => "enrollTileTally(a, b)");
  assert.deepStrictEqual(sibling.results[0].items.map((i) => landed(i)), [], "an echoed sibling is still a sibling");

  // CONTROL: the ordinary scoped ghost, which echoes nothing, is served and
  // reports no strip. Without this row the assertions above are satisfied by a
  // rule that refuses everything.
  const plain = await session([{ sci: selectionAt(".enrollTile") }], () => "(a)");
  assert.strictEqual(landed(plain.results[0].items[0]), "let s: Stripe;\ns.enrollTile(a)");
  assert.ok(!plain.logged.some((l) => l.includes("re-wrote")), "an ordinary scoped ghost must not report a strip");
});

// ===========================================================================
// DO-3. The fact the phase-3 echo disposition rests on.
// ===========================================================================

test("DO-3. a pre-widget cache entry still serves at a scoped site, at zero model calls - the walk slices the member name off its head, so no cache population ever needs the gate to strip an echo", async () => {
  // Triage refused the echo at the gate on the strength of this behaviour, and
  // nothing pinned it. The argument: the scoped prefix is BOTH the model prompt
  // and the cache key, so an entry authored before the widget opened is reached
  // by WALKING the name off its head rather than by handing the duplicate to
  // the gate. If a later change to the walk breaks that, the refusal starts
  // dropping serves the base commit makes, and the disposition silently becomes
  // wrong. This test is what says so.
  //
  // Step 1 authors the entry unscoped at `s.`: the model spells the whole
  // member. Step 2 opens the widget on that same member at the same cursor.
  const ghost = () => "enrollTile(tile)";
  const { results, logged } = await session([{ sci: undefined }, { sci: selectionAt(".enrollTile") }], ghost);

  assert.strictEqual(results[0].modelCalls, 1, "step 1 authors the entry, so it must actually generate");
  assert.strictEqual(
    results[1].modelCalls,
    0,
    `the scoped request must be served from the entry authored at \`s.\`, not regenerated; got ${results[1].modelCalls} call(s)`
  );
  assert.deepStrictEqual(
    results[1].items.map((i) => landed(i)),
    ["let s: Stripe;\ns.enrollTile(tile)"],
    "the walked entry lands the member spelled ONCE, which is what makes the gate's echo refusal safe"
  );
  assert.ok(
    !logged.some((l) => l.includes("re-spelled")),
    `a walked pre-widget entry is not an echo and must not be reported as one; got ${JSON.stringify(logged)}`
  );
});
