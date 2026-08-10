// BLIND CONTRACT TEST - v19 phase 1 "sticky selection scoping".
//
// Written from the promised surface, never from the code. This file does not
// read src/vscode/completionProvider.ts, src/core/completionService.ts or
// src/core/cache.ts; esbuild resolves them at bundle time only. Everything
// asserted below is either a promise of the phase or an externally observable
// property of VS Code.
//
// THESE TESTS ARE EXPECTED RED until the feature ships. Red before green.
//
// The behaviour under test, as VS Code presents it:
//
//   - `context.selectedCompletionInfo` is `{ range, text }` for the item
//     highlighted in the native suggest widget, or undefined.
//   - `.text` INCLUDES the leading separator (".enrollTile"), and `.range`
//     starts AT the separator, not after it.
//   - VS Code re-invokes the provider when the highlighted item changes, and
//     once more with selectedCompletionInfo UNDEFINED when the user presses
//     Escape - same position, same document version. That last re-invocation
//     is measured, not assumed, and is the whole reason stickiness exists.
//
// What each section pins:
//
//   A. SCOPING. With a selection in force at a member site, the memberPartial
//      reaching the generation/gate layer is the highlighted member's BARE
//      name, not what the user typed.
//   B. STICKINESS. Amended by v20. A passive preselect - a widget session's
//      FIRST highlight, the one the widget auto-picked - DOES survive Escape,
//      for 1500ms measured from that Escape. An ACTIVE selection (an arrow to a
//      DIFFERENT member) is sticky with no deadline, so arrow, Escape, Tab
//      lands the member the user chose however long they take.
//   C. EXPIRY. A document edit or a cursor move kills the sticky scope, and
//      the next unselected request is unscoped - proven against a control run
//      on a virgin provider rather than against a hardcoded guess at "today".
//   D. ITEM SHAPE. With a selection in force, every item carries
//      `range` === selectedCompletionInfo.range and an insertText that starts
//      with selectedCompletionInfo.text. VS Code silently drops items failing
//      either, so an unshaped item is an invisible completion.
//   E. INERTNESS. With no selection ever, behaviour is unchanged. The
//      regression guard: this feature must not touch ordinary typing.
//
// Run: SKIP_LIVE=1 node --test test/blind-v19-sticky-selection.test.cjs
// (Hermetic: a vscode stub, a stubbed extractor registry, a stubbed generate.
// No model, no network, no real VS Code.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

// ===========================================================================
// Harness. Same idiom as test/impl-v15-gate.test.cjs: alias `vscode` to a
// hand-built stub, redirect the extractor registry through an esbuild plugin
// (which needs the async API, hence the child process), require the bundle.
// ===========================================================================

const TAG = ".blind-v19-sticky";
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
    // One alternative keeps the fan-out to a single generate call. The output
    // gate is OFF: this phase is about which partial is REQUESTED, and a live
    // gate would let a suppression masquerade as a scoping failure.
    getConfiguration: () => ({ get: (k, d) => {
      if (k === "fimAlternatives") { return 1; }
      if (k === "fimMemberGate") { return false; }
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

// The extractor REGISTRY is stubbed, not the transport. A member site with
// resolvable members is the only site where a suggest widget appears at all.
fs.writeFileSync(
  REGISTRY_STUB,
  `export function extractorFor(_languageId: string): any {
  return (globalThis as any).__v19Extractor;
}\n`
);

fs.writeFileSync(
  entry,
  `export { FimCompletionProvider } from "../src/vscode/completionProvider";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`
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

test("harness: the provider, the service and the config all bundle [harness guard - red here is a build problem, not a contract failure]", () => {
  if (buildError) assert.fail(`the bundle does not build: ${String(buildError.stderr || buildError.message).slice(0, 2000)}`);
  assert.strictEqual(typeof mod.FimCompletionProvider, "function", "no FimCompletionProvider export");
  assert.strictEqual(typeof mod.CompletionService, "function", "no CompletionService export");
});

const need = () => {
  if (buildError) assert.fail(`the bundle does not build: ${String(buildError.stderr || buildError.message).slice(0, 2000)}`);
  return mod;
};

// ===========================================================================
// The scenario. Receiver `s`, the user has typed `s.en`, and the widget is
// highlighting `.enrollTile` - the worked example from the contract.
// ===========================================================================

const SOURCE = "let s: Stripe;\ns.en";
const CURSOR_LINE = 1;
const CURSOR_END = 4; // after `s.en`
const TYPED_PARTIAL = "en";
const HIGHLIGHTED = "enrollTile";
const SELECTED_TEXT = `.${HIGHLIGHTED}`;
// The range starts AT the separator: `s.en` is characters 0..4 of line 1, so
// the dot is character 1.
const SEPARATOR_CHAR = 1;

const MEMBERS = [
  { name: "enrollTile", signature: "enrollTile(Tile) : bool", kind: "method" },
  { name: "enqueue", signature: "enqueue(Job) : void", kind: "method" },
  { name: "endpoint", signature: "endpoint() : string", kind: "method" },
  { name: "len", signature: "len() : int", kind: "method" },
];

const selectionAt = (text, line = CURSOR_LINE, endChar = CURSOR_END) => ({
  text,
  range: {
    start: { line, character: SEPARATOR_CHAR },
    end: { line, character: endChar },
  },
});

// Coordinates only. The bundle carries its OWN copy of the stub's Range class
// (esbuild inlines the alias), so a prototype-sensitive deepStrictEqual would
// report a mismatch that is an artefact of bundling, not a contract failure.
const coords = (r) =>
  r == null
    ? null
    : {
        startLine: r.start && r.start.line,
        startChar: r.start && r.start.character,
        endLine: r.end && r.end.line,
        endChar: r.end && r.end.character,
      };

// A document whose text and version are mutable, so an edit is a real version
// bump on the same object identity VS Code would hand back.
function makeDoc(text, languageId = "typescript") {
  const doc = {
    languageId,
    version: 1,
    _text: text,
    get lineCount() {
      return this._text.split("\n").length;
    },
    uri: { toString: () => `file:///a.${languageId}` },
    _offset(p) {
      const lines = this._text.split("\n");
      const line = Math.max(0, Math.min(p.line, lines.length - 1));
      let n = 0;
      for (let i = 0; i < line; i += 1) n += lines[i].length + 1;
      return n + Math.max(0, Math.min(p.character, lines[line].length));
    },
    getText(range) {
      if (range == null) return this._text;
      return this._text.slice(this._offset(range.start), this._offset(range.end));
    },
    lineAt(n) {
      const lines = this._text.split("\n");
      const len = (lines[n] ?? "").length;
      return { text: lines[n] ?? "", range: { start: { line: n, character: 0 }, end: { line: n, character: len } } };
    },
    offsetAt(p) {
      return this._offset(p);
    },
    positionAt(o) {
      const lines = this._text.split("\n");
      let rem = o;
      for (let i = 0; i < lines.length; i += 1) {
        if (rem <= lines[i].length) return makePos(i, rem);
        rem -= lines[i].length + 1;
      }
      return makePos(lines.length - 1, (lines[lines.length - 1] ?? "").length);
    },
    edit(newText) {
      this._text = newText;
      this.version += 1;
    },
  };
  return doc;
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

const MARK = (p) => `[[partial=${p}]]`;

// The v20 passive window, in ms. Named `PASSIVE_SCOPE_MS` on the provider
// module; spelled out here because this file's entry re-exports named symbols
// and a constant that does not exist yet would fail the bundle, turning a
// contract failure into a build failure for every test in the file.
const PASSIVE_WINDOW_MS = 1500;

// A fake clock for the 4th constructor parameter. Only `now` has to move: the
// surface decides scope-or-no-scope when the request arrives, so an unselected
// request issued after the clock has passed the deadline reads unscoped without
// any timer firing. The armed timer, its `onExpired` callback and the
// re-trigger downgrade are pinned in test/blind-v20-preselect-window.test.cjs,
// which drives the same injected object. Nothing here sleeps.
function fakeClock(start = 10_000) {
  let now = start;
  return {
    timing: {
      now: () => now,
      setTimer: () => () => {},
      onExpired: () => {},
    },
    advance(ms) {
      now += ms;
    },
  };
}

// One provider, one service, a sequence of requests. The generate stub echoes
// the memberPartial that reached it back through the ghost, so the partial is
// observable in the ITEM even if a cache serves the second request without
// calling the service again - which is the honest reading of the contract:
// what matters is the partial the generation layer worked from.
// A `clock` may be supplied to drive the v20 passive window; omitting it builds
// the provider exactly as before, on the real clock.
async function session(steps, { ghost, clock } = {}) {
  const { FimCompletionProvider, CompletionService, DEFAULT_FIM_CONFIG } = need();

  globalThis.__v19Extractor = {
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

  const recorded = [];
  const service = new CompletionService(
    { ...DEFAULT_FIM_CONFIG, debounceMs: 0, cacheCapacity: 100 },
    async () => ({
      text: ghost ? ghost(recorded[recorded.length - 1]) : MARK(lastPartial(recorded)),
      ttftMs: 1,
      totalMs: 2,
    }),
    () => {}
  );

  // A recording proxy rather than a fake service: the real service still does
  // the real work, and only the call the contract talks about is observed.
  const spy = new Proxy(service, {
    get(t, p) {
      if (p === "complete") {
        return (opts) => {
          recorded.push(opts);
          return t.complete(opts);
        };
      }
      const v = Reflect.get(t, p, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });

  const provider = new FimCompletionProvider(
    () => spy,
    { appendLine: () => {} },
    undefined,
    clock && clock.timing
  );
  const doc = makeDoc(SOURCE);
  const results = [];

  for (const step of steps) {
    if (step.advanceMs && clock) clock.advance(step.advanceMs);
    if (step.editTo !== undefined) doc.edit(step.editTo);
    const position = makePos(step.line ?? CURSOR_LINE, step.char ?? CURSOR_END);
    const before = recorded.length;
    const raw = await provider.provideInlineCompletionItems(
      doc,
      position,
      { triggerKind: step.triggerKind ?? 0, selectedCompletionInfo: step.sci },
      { onCancellationRequested: () => {}, isCancellationRequested: false }
    );
    const items = Array.isArray(raw) ? raw : (raw && raw.items) || [];
    results.push({
      items,
      calls: recorded.slice(before),
      version: doc.version,
      position,
    });
  }

  service.dispose();
  return { results, recorded };
}

const lastPartial = (recorded) => {
  const last = recorded[recorded.length - 1];
  return last && typeof last.memberPartial === "string" ? last.memberPartial : String(last && last.memberPartial);
};

// The partial the generation layer worked from, read out of the ghost the
// provider surfaced. Returns undefined when nothing was surfaced at all.
function servedPartial(result) {
  const item = result.items[0];
  if (!item) return undefined;
  const m = /\[\[partial=([^\]]*)\]\]/.exec(String(item.insertText));
  return m ? m[1] : `NO-MARKER(${JSON.stringify(String(item.insertText))})`;
}

// Table runner: one body, many cases, every failure reported together.
const table = async (rows, run) => {
  const bad = [];
  for (const row of rows) {
    try {
      await run(row);
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
  }
  if (bad.length) assert.fail(`${bad.length}/${rows.length} cases failed:\n  - ${bad.join("\n  - ")}`);
};

// ===========================================================================
// A. SCOPING. A selection in force scopes the request to the highlighted
// member. The partial reaching the generation/gate layer is the BARE name -
// no leading `.`, no leading `::` - and it is the widget's choice, not the
// user's keystrokes.
// ===========================================================================

test("A. a selected completion scopes the request to the highlighted member: the memberPartial reaching the service is the BARE name, never the typed prefix and never the separator [contract 1 'Scoping']", async () => {
  await table(
    [
      { name: "`.enrollTile` highlighted over typed `en`", text: ".enrollTile", expect: "enrollTile" },
      { name: "`.enqueue` highlighted over typed `en` - a DIFFERENT member of the same prefix", text: ".enqueue", expect: "enqueue" },
      { name: "`.endpoint` highlighted over typed `en`", text: ".endpoint", expect: "endpoint" },
      { name: "`.len` highlighted - a member the typed prefix does not even match", text: ".len", expect: "len" },
      { name: "`::enrollTile` - the C-family separator is stripped the same way", text: "::enrollTile", expect: "enrollTile" },
    ],
    async (row) => {
      const { results } = await session([{ sci: selectionAt(row.text) }]);
      const call = results[0].calls[0];
      assert.ok(call, "the provider never reached the service at all, so nothing was scoped");
      assert.strictEqual(
        call.memberPartial,
        row.expect,
        `memberPartial must be the highlighted member's bare name ${JSON.stringify(row.expect)}, got ${JSON.stringify(call.memberPartial)} (typed prefix was ${JSON.stringify(TYPED_PARTIAL)})`
      );
      assert.strictEqual(call.memberSite, true, "a selected completion at a member site is still a member site");
    }
  );
});

test("A. the scope survives the round trip: the ghost the provider surfaces was generated from the highlighted member, not from the typed prefix [contract 1 'Scoping']", async () => {
  const { results } = await session([{ sci: selectionAt(SELECTED_TEXT) }]);
  assert.strictEqual(
    servedPartial(results[0]),
    HIGHLIGHTED,
    `the surfaced completion must have been generated under partial ${JSON.stringify(HIGHLIGHTED)}, got ${JSON.stringify(servedPartial(results[0]))}`
  );
});

test("A. arrowing through the widget re-scopes each time: three consecutive invocations, three different highlighted members, three different partials [contract: VS Code re-invokes the provider whenever the highlighted item changes]", async () => {
  const { results } = await session([
    { sci: selectionAt(".enrollTile") },
    { sci: selectionAt(".enqueue") },
    { sci: selectionAt(".endpoint") },
  ]);
  const got = results.map(servedPartial);
  assert.deepStrictEqual(
    got,
    ["enrollTile", "enqueue", "endpoint"],
    `each re-invocation must be scoped to the member highlighted at that moment, got ${JSON.stringify(got)}`
  );
});

// ===========================================================================
// B. STICKINESS ACROSS ESCAPE, as v20 amends it. Both kinds of selection are
// sticky now; what separates them is how long.
//
//   - A widget session's FIRST highlight is a PASSIVE preselect (the widget
//     auto-picked it). It survives Escape, so the ghost the user is reaching
//     for is still there to Tab, and it expires 1500ms after the Escape that
//     first read it. After that the site is unscoped again.
//   - A selection whose text DIFFERS from the session's first is an arrow: the
//     session goes ACTIVE and the scope has no deadline at all. arrow, Escape,
//     Tab is the product's core gesture and carries no clock.
//
// v19 gave the passive preselect nothing, which threw away a complete, correct
// ghost the developer was looking at. v20 gives it a window instead.
// ===========================================================================

// --- The passive rows: a preselect survives Escape, on a 1500ms clock. ---

test("B. a passive preselect survives Escape for 1500ms and then stops: open the widget, do NOT arrow, press Escape, and that request is SCOPED to the preselected member; the next unselected request at the deadline is unscoped again [v20 surface promises 1 and 2]", async () => {
  await table(
    [
      { name: "preselect `.enrollTile` (the alphabetical auto-highlight), then Escape", text: ".enrollTile", member: "enrollTile" },
      { name: "preselect `.enqueue`, then Escape", text: ".enqueue", member: "enqueue" },
      { name: "preselect `.len`, then Escape", text: ".len", member: "len" },
    ],
    async (row) => {
      const clock = fakeClock();
      const { results } = await session(
        [
          { sci: selectionAt(row.text) },
          // The Escape. This is the request that opens the window.
          { sci: undefined },
          // Same state, same widget-less request, but the window has closed.
          { sci: undefined, advanceMs: PASSIVE_WINDOW_MS },
        ],
        { clock }
      );
      assert.strictEqual(
        servedPartial(results[1]),
        row.member,
        `the Escape after a preselect must keep the ghost scoped to ${JSON.stringify(row.member)} so there is something to Tab, got ${JSON.stringify(servedPartial(results[1]))} (${JSON.stringify(TYPED_PARTIAL)} is the v19 answer this replaces)`
      );
      assert.strictEqual(
        servedPartial(results[2]),
        TYPED_PARTIAL,
        `${PASSIVE_WINDOW_MS}ms after that Escape the passive scope is gone and the request must read the typed partial ${JSON.stringify(TYPED_PARTIAL)}, got ${JSON.stringify(servedPartial(results[2]))} - a passive scope with no deadline is v20's own failure mode`
      );
    }
  );
});

test("B. an unchanged repeat selection is still PASSIVE: two identical selections then Escape is scoped, and gone at the deadline; an arrow picks WHICH member the record holds, on the same uniform window [amended 2026-07-26, journeys/member-dot-flow.md]", async () => {
  await table(
    [
      { name: "`.enrollTile` preselected twice", text: ".enrollTile", member: "enrollTile", arrowTo: ".enqueue", arrowed: "enqueue" },
      { name: "`.len` preselected twice", text: ".len", member: "len", arrowTo: ".endpoint", arrowed: "endpoint" },
    ],
    async (row) => {
      const passiveClock = fakeClock();
      const passive = await session(
        [
          { sci: selectionAt(row.text) },
          { sci: selectionAt(row.text) },
          { sci: undefined },
          { sci: undefined, advanceMs: PASSIVE_WINDOW_MS },
        ],
        { clock: passiveClock }
      );
      assert.strictEqual(
        servedPartial(passive.results[2]),
        row.member,
        `a repeat of the same highlight is still the widget's preselect, and the Escape after it is scoped to ${JSON.stringify(row.member)}, got ${JSON.stringify(servedPartial(passive.results[2]))}`
      );
      assert.strictEqual(
        servedPartial(passive.results[3]),
        TYPED_PARTIAL,
        `a repeat is not an arrow, so the scope it leaves is on the ${PASSIVE_WINDOW_MS}ms clock and must be gone by the deadline (expected ${JSON.stringify(TYPED_PARTIAL)}), got ${JSON.stringify(servedPartial(passive.results[3]))}`
      );

      // Amended under the human design call 2026-07-26
      // (session-v26/journeys/member-dot-flow.md): the 1.5s window is
      // UNIFORM, so the arrowed session is on the same clock and the old
      // contrast ("still scoped at the same elapsed time") is void. What the
      // arrow still earns is WHICH member the record holds: inside the
      // window the arrowed member governs, not the repeat's preselect.
      const activeClock = fakeClock();
      const active = await session(
        [
          { sci: selectionAt(row.text) },
          { sci: selectionAt(row.arrowTo) },
          { sci: undefined },
          { sci: undefined, advanceMs: PASSIVE_WINDOW_MS - 1 },
          { sci: undefined, advanceMs: 1 },
        ],
        { clock: activeClock }
      );
      assert.strictEqual(
        servedPartial(active.results[3]),
        row.arrowed,
        `inside the window the arrowed member still governs: expected ${JSON.stringify(row.arrowed)}, got ${JSON.stringify(servedPartial(active.results[3]))}`
      );
      assert.strictEqual(
        servedPartial(active.results[4]),
        TYPED_PARTIAL,
        `and at the deadline the arrowed scope reverts on the same uniform clock, got ${JSON.stringify(servedPartial(active.results[4]))}`
      );
    }
  );
});

// --- The active rows: an arrow to a different member makes the scope sticky. ---

test("B. an active selection becomes sticky across Escape: preselect one member, arrow to a DIFFERENT member, and the unselected Escape request stays scoped to the arrowed member - this is arrow, Escape, Tab [surface: [preselect X, arrow Y, Escape] -> sticky Y]", async () => {
  await table(
    [
      { name: "preselect `.enqueue`, arrow to `.enrollTile`, Escape", preselect: ".enqueue", target: ".enrollTile", expect: "enrollTile" },
      { name: "preselect `.enrollTile`, arrow to `.enqueue`, Escape", preselect: ".enrollTile", target: ".enqueue", expect: "enqueue" },
      { name: "preselect `.enrollTile`, arrow to `.len`, Escape", preselect: ".enrollTile", target: ".len", expect: "len" },
    ],
    async (row) => {
      const { results } = await session([
        { sci: selectionAt(row.preselect) },
        { sci: selectionAt(row.target) },
        { sci: undefined },
      ]);
      assert.strictEqual(
        servedPartial(results[2]),
        row.expect,
        `the Escape re-invocation after an arrow must stay scoped to the arrowed member ${JSON.stringify(row.expect)}, got ${JSON.stringify(servedPartial(results[2]))} (unscoped would be ${JSON.stringify(TYPED_PARTIAL)})`
      );
    }
  );
});

test("B. stickiness tracks the LAST highlight, not the first: arrowing past two members and escaping lands on the second [surface: [preselect X, arrow Y, Escape] -> sticky Y]", async () => {
  const { results } = await session([
    { sci: selectionAt(".enrollTile") },
    { sci: selectionAt(".endpoint") },
    { sci: undefined },
  ]);
  assert.strictEqual(
    servedPartial(results[2]),
    "endpoint",
    `the sticky scope must be the last member highlighted before Escape, got ${JSON.stringify(servedPartial(results[2]))}`
  );
});

test("B. arrowing back to the first item after the session went active is a real choice: preselect X, arrow Y, arrow back to X, then Escape stays sticky to X [surface: [preselect X, arrow Y, arrow X, Escape] -> sticky X]", async () => {
  const { results } = await session([
    { sci: selectionAt(".enrollTile") },
    { sci: selectionAt(".enqueue") },
    { sci: selectionAt(".enrollTile") },
    { sci: undefined },
  ]);
  assert.strictEqual(
    servedPartial(results[3]),
    "enrollTile",
    `once the session went active, landing back on the first member is a chosen member and must be sticky, got ${JSON.stringify(servedPartial(results[3]))} (the passive-preselect rule must not fire on a second visit)`
  );
});

test("B. an active sticky scope is not a one-shot: after an arrow, two consecutive unselected requests at the same position and version are both scoped [contract 2 - VS Code's re-invocation count is not something the provider controls]", async () => {
  const { results } = await session([
    { sci: selectionAt(".enqueue") },
    { sci: selectionAt(SELECTED_TEXT) },
    { sci: undefined },
    { sci: undefined },
  ]);
  const got = results.slice(2).map(servedPartial);
  assert.deepStrictEqual(
    got,
    [HIGHLIGHTED, HIGHLIGHTED],
    `both post-Escape requests must stay scoped to the arrowed member, got ${JSON.stringify(got)}`
  );
});

test("B. active stickiness does not depend on the trigger kind: an Automatic Escape re-invocation after an arrow is scoped exactly as an Invoke one is [contract 2 - the contract conditions on position and version, and says nothing about trigger kind]", async () => {
  const { results } = await session([
    { sci: selectionAt(".enqueue"), triggerKind: 0 },
    { sci: selectionAt(SELECTED_TEXT), triggerKind: 0 },
    { sci: undefined, triggerKind: 1 },
  ]);
  assert.strictEqual(
    servedPartial(results[2]),
    HIGHLIGHTED,
    `an Automatic re-invocation after an active selection must be sticky too, got ${JSON.stringify(servedPartial(results[2]))}`
  );
});

// ===========================================================================
// C. EXPIRY. The sticky scope must not outlive the state it was taken in. A
// document edit or a cursor move makes an unselected request unscoped, exactly
// as it is today.
//
// "Exactly as today" is measured, never guessed: every expiry case is compared
// against a CONTROL - the identical request on a virgin provider that has seen
// no selection at all. If the baseline moves, the control moves with it.
// ===========================================================================

async function control(step) {
  const { results } = await session([step]);
  return servedPartial(results[0]);
}

test("C. a document edit expires the sticky scope: after the version changes, an unselected request is unscoped and matches the no-selection control exactly [contract 3 'Expiry' - a document edit]", async () => {
  const baseline = await control({ sci: undefined, editTo: "let s: Stripe;\ns.en" });
  assert.strictEqual(baseline, TYPED_PARTIAL, `control sanity: an unscoped request should work from the typed partial, got ${JSON.stringify(baseline)}`);

  const { results } = await session([
    // An ACTIVE session first (preselect, then arrow to a different member),
    // so a real sticky scope exists for the edit to expire. A lone preselect
    // sets no scope, and the expiry would prove nothing.
    { sci: selectionAt(".enqueue") },
    { sci: selectionAt(SELECTED_TEXT) },
    // Same text, new version. An edit is an edit even when it lands back on
    // the same characters, and the contract conditions on the VERSION.
    { sci: undefined, editTo: "let s: Stripe;\ns.en" },
  ]);
  assert.strictEqual(
    servedPartial(results[2]),
    baseline,
    `after an edit the request must be unscoped (${JSON.stringify(baseline)}), got ${JSON.stringify(servedPartial(results[2]))} - a scope that survives an edit puts a stale member into fresh text`
  );
  assert.notStrictEqual(results[2].version, results[1].version, "harness guard: the edit must actually have bumped the version");
});

test("C. an edit that changes the typed partial expires the scope AND re-derives from the new text [contract 3 - the point of expiry is that the new text governs]", async () => {
  const { results } = await session([
    { sci: selectionAt(".enqueue") },
    { sci: selectionAt(SELECTED_TEXT) },
    { sci: undefined, editTo: "let s: Stripe;\ns.le", char: 4 },
  ]);
  assert.strictEqual(
    servedPartial(results[2]),
    "le",
    `after typing on, the partial must come from the document, got ${JSON.stringify(servedPartial(results[2]))}`
  );
});

test("C. a cursor move expires the sticky scope: an unselected request at a different position is unscoped and matches the control at that position [contract 3 'Expiry' - the cursor moving to a different position]", async () => {
  await table(
    [
      { name: "cursor back one character, `s.e`", char: 3, expect: "e" },
      { name: "cursor back two characters, `s.`", char: 2, expect: "" },
    ],
    async (row) => {
      const baseline = await control({ sci: undefined, char: row.char });
      assert.strictEqual(baseline, row.expect, `control sanity at char ${row.char}: expected ${JSON.stringify(row.expect)}, got ${JSON.stringify(baseline)}`);

      const { results } = await session([
        { sci: selectionAt(".enqueue") },
        { sci: selectionAt(SELECTED_TEXT) },
        { sci: undefined, char: row.char },
      ]);
      assert.strictEqual(
        servedPartial(results[2]),
        baseline,
        `moving the cursor must drop the scope (expected ${JSON.stringify(baseline)}), got ${JSON.stringify(servedPartial(results[2]))}`
      );
    }
  );
});

test("C. expiry is permanent, not a skipped beat: once an edit has killed the scope, returning to the original position does NOT resurrect it [contract 3 - a scope that comes back is a scope that never expired]", async () => {
  const baseline = await control({ sci: undefined });
  const { results } = await session([
    { sci: selectionAt(".enqueue") },
    { sci: selectionAt(SELECTED_TEXT) },
    { sci: undefined, editTo: "let s: Stripe;\ns.en" },
    { sci: undefined },
  ]);
  assert.strictEqual(
    servedPartial(results[3]),
    baseline,
    `the scope was expired by the edit and must stay expired, got ${JSON.stringify(servedPartial(results[3]))}`
  );
});

// ===========================================================================
// D. ITEM SHAPE. VS Code silently DROPS an inline item whose range does not
// match the selected item's range, or whose text does not extend the selected
// item's text. An item that fails either is an invisible completion, which is
// indistinguishable from the feature not working.
// ===========================================================================

test("D. with a selection in force, every returned item carries range === selectedCompletionInfo.range - VS Code drops items that start anywhere else [contract 4 'Item shape']", async () => {
  await table(
    [
      { name: "`.enrollTile`", text: ".enrollTile" },
      { name: "`.enqueue`", text: ".enqueue" },
      { name: "`.len`", text: ".len" },
    ],
    async (row) => {
      const sci = selectionAt(row.text);
      const { results } = await session([{ sci }], { ghost: () => `${row.text.replace(/^[.:]+/, "")}(tile);` });
      const items = results[0].items;
      assert.ok(items.length > 0, "no item was returned at all, so there is nothing for VS Code to show");
      for (const item of items) {
        assert.deepStrictEqual(
          coords(item.range),
          coords(sci.range),
          `item range must equal the selected range ${JSON.stringify(coords(sci.range))}, got ${JSON.stringify(coords(item.range))}`
        );
      }
    }
  );
});

test("D. with a selection in force, every returned insertText STARTS WITH selectedCompletionInfo.text, separator included - VS Code drops items that do not extend the selected item [contract 4 'Item shape']", async () => {
  await table(
    [
      { name: "`.enrollTile` extended by a call", text: ".enrollTile", ghost: "enrollTile(tile);" },
      { name: "`.enqueue` extended by a call", text: ".enqueue", ghost: "enqueue(job);" },
      { name: "`.len` extended by an empty call", text: ".len", ghost: "len();" },
      { name: "`::enrollTile` - the `::` separator is part of the text that must be carried", text: "::enrollTile", ghost: "enrollTile(tile);" },
    ],
    async (row) => {
      const sci = selectionAt(row.text);
      const { results } = await session([{ sci }], { ghost: () => row.ghost });
      const items = results[0].items;
      assert.ok(items.length > 0, "no item was returned at all");
      for (const item of items) {
        const text = String(item.insertText);
        assert.ok(
          text.startsWith(row.text),
          `insertText must start with the selected text ${JSON.stringify(row.text)}, got ${JSON.stringify(text)}`
        );
      }
    }
  );
});

test("D. with NO selection and no sticky scope, the item is anchored at the cursor exactly as today - the selected-item shape must not leak onto ordinary requests [contract 4 'When selectedCompletionInfo is undefined ... anchored at the cursor']", async () => {
  const { results } = await session([{ sci: undefined }], { ghost: () => "rollTile(tile);" });
  const item = results[0].items[0];
  assert.ok(item, "no item was returned at all");
  const r = coords(item.range);
  if (r !== null) {
    assert.deepStrictEqual(
      { line: r.startLine, character: r.startChar },
      { line: CURSOR_LINE, character: CURSOR_END },
      `an unselected item must be anchored at the cursor, got range start ${JSON.stringify({ line: r.startLine, character: r.startChar })}`
    );
  }
  assert.strictEqual(
    String(item.insertText),
    "rollTile(tile);",
    `an unselected item carries the raw ghost, got ${JSON.stringify(String(item.insertText))}`
  );
});

test("D. a STICKY request carries the ordinary cursor-anchored shape, because selectedCompletionInfo is gone and there is no range to match [contract 4 - the shape rule is conditioned on selectedCompletionInfo being DEFINED, and on Escape it is not]", async () => {
  const { results } = await session([
    { sci: selectionAt(".enqueue") },
    { sci: selectionAt(SELECTED_TEXT) },
    { sci: undefined },
  ], {
    ghost: () => "rollTile(tile);",
  });
  const item = results[2].items[0];
  assert.ok(item, "the sticky request returned no item at all, which is the failure the phase exists to prevent");
  const r = coords(item.range);
  if (r !== null) {
    assert.deepStrictEqual(
      { line: r.startLine, character: r.startChar },
      { line: CURSOR_LINE, character: CURSOR_END },
      `the widget is dismissed, so the item anchors at the cursor; got ${JSON.stringify({ line: r.startLine, character: r.startChar })}`
    );
  }
});

// ===========================================================================
// E. INERTNESS. The regression guard. With selectedCompletionInfo never
// defined and no sticky scope in force, nothing about today's behaviour moves.
// If this section is the only thing red, the feature is not inert.
// ===========================================================================

test("E. with no selection ever, the memberPartial is the typed one at every position - ordinary typing is untouched [contract 5 'No selection, no change'] (regression net)", async () => {
  await table(
    [
      { name: "`s.en` - two characters typed", char: 4, expect: "en" },
      { name: "`s.e` - one character typed", char: 3, expect: "e" },
      { name: "`s.` - nothing typed after the separator", char: 2, expect: "" },
    ],
    async (row) => {
      const { results } = await session([{ sci: undefined, char: row.char }]);
      const call = results[0].calls[0];
      assert.ok(call, "the provider never reached the service");
      assert.strictEqual(
        call.memberPartial,
        row.expect,
        `expected the typed partial ${JSON.stringify(row.expect)}, got ${JSON.stringify(call.memberPartial)}`
      );
      assert.strictEqual(call.memberSite, true, "still a member site");
      assert.strictEqual(call.memberReceiver, "s", "the receiver is still parsed and threaded, unchanged");
    }
  );
});

test("E. a long unselected run never accumulates a scope: five consecutive requests, all unscoped, all identical to the first [contract 5 - the feature must be inert on ordinary typing] (regression net)", async () => {
  const { results } = await session([
    { sci: undefined },
    { sci: undefined },
    { sci: undefined },
    { sci: undefined },
    { sci: undefined },
  ]);
  const got = results.map(servedPartial);
  assert.deepStrictEqual(
    got,
    [TYPED_PARTIAL, TYPED_PARTIAL, TYPED_PARTIAL, TYPED_PARTIAL, TYPED_PARTIAL],
    `no request may become scoped without a selection ever having been seen, got ${JSON.stringify(got)}`
  );
});

test("E. a selection at a NON-member site scopes nothing: there is no member to be sticky about, and the partial stays empty [contract 1 - the promise is scoped to a member site] (regression net)", async () => {
  const { results } = await session([{ sci: selectionAt(".enrollTile", 0, 14), line: 0, char: 14 }]);
  const call = results[0].calls[0];
  assert.ok(call, "the provider never reached the service");
  assert.strictEqual(call.memberSite, false, "`let s: Stripe;` is not a member site");
  // Whether that is spelled "" or undefined is today's business and not a
  // promise of this phase. What the phase promises is that a selection cannot
  // put a member name there when there is no member site to scope.
  assert.ok(
    !call.memberPartial,
    `a non-member site must carry no member partial, got ${JSON.stringify(call.memberPartial)}`
  );
});
