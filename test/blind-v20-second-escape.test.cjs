// BLIND CONTRACT TEST - v20 phase 2, "the second Escape is the fast revert".
//
// Written from the phase 2 surface document (with the phase 1 surface and goal
// as the contract it must not break), never from
// the code. This file does not read src/vscode/completionProvider.ts,
// src/vscode/extension.ts or src/core/completionService.ts; esbuild resolves
// them at bundle time only. Every assertion below is a clause of the phase 2
// surface, one of its invariants, or a phase 1 promise phase 2 must preserve.
//
// THESE TESTS ARE EXPECTED RED until phase 2 ships. Red before green.
// `dropScope()`, `onScopedGhost` and `REAL_SCOPE_HOOKS` do not exist yet, so
// the sections below must fail on the CONTRACT and never on the build: a
// missing method is reported as a sentence, not a TypeError, and the renamed
// export is read through a namespace so its absence cannot kill the file. A
// build failure here is a harness bug.
//
// The gesture, in three keystrokes: `.` opens the widget and auto-highlights a
// member; Escape closes the widget and keeps the ghost scoped (phase 1); a
// SECOND Escape drops the scope and swaps in the provider's own unscoped
// completion immediately, instead of waiting out the 1500ms window.
//
// What each section pins:
//
//   A. THE RETURN VALUE. `dropScope()` is true when a sticky scope was held and
//      false when none was, because the keybinding needs to tell a real
//      dismissal from a stale one and fall back to the editor's own Escape.
//   B. THE DROP. After dropScope() the next request at the same state is
//      unscoped - for a PASSIVE preselect and, the point of the feature, for an
//      ACTIVE arrowed scope, which has no deadline and previously could only be
//      escaped by typing.
//   C. THE TIMER. dropScope() cancels the pending expiry: nothing left armed,
//      no onExpired afterwards.
//   D. THE DOWNGRADE. The re-render dropScope() provokes arrives as Invoke and
//      must be dispatched as automatic; it reuses the expiry's one-shot flag,
//      so the request after it honours a genuine Invoke again.
//   E. THE CONTEXT KEY. onScopedGhost fires true only for a STICKY-scoped ghost
//      (record + widget closed), false when the record is gone or the serve is
//      unscoped, and only on a CHANGE. A widget-open serve reports nothing: the
//      widget owns Escape at that moment.
//   F. PHASE 1 REGRESSION NET. The window, the fixed deadline, the timer, the
//      edit hook and arrow-Escape-Tab, plus the renamed exports.
//
// Time is driven entirely through the injected hooks. No sleeps, no real
// timers, no wall clock.
//
// Run: SKIP_LIVE=1 node --test test/blind-v20-second-escape.test.cjs
// (Hermetic: a vscode stub, a stubbed extractor registry, a stubbed generate.
// No model, no network, no real VS Code.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

// ===========================================================================
// Harness. Same idiom as test/blind-v20-preselect-window.test.cjs: alias
// `vscode` to a hand-built stub, redirect the extractor registry through an
// esbuild plugin (async API, hence the child process), require the bundle. The
// entry re-exports the provider module as a NAMESPACE so that a named
// re-export of a not-yet-existing symbol cannot turn a contract failure into a
// build failure that takes every other test down with it.
// ===========================================================================

const TAG = ".blind-v20-second-escape";
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
    // The output gate is OFF: this file is about which partial is REQUESTED and
    // when the record dies, and a live gate would let a suppression masquerade
    // as a scoping failure.
    getConfiguration: () => ({ get: (k, d) => {
      const over = (globalThis.__v20sConfig || {});
      if (Object.prototype.hasOwnProperty.call(over, k)) { return over[k]; }
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
  return (globalThis as any).__v20sExtractor;
}\n`
);

fs.writeFileSync(
  entry,
  `export * as providerModule from "../src/vscode/completionProvider";
export { FimCompletionProvider } from "../src/vscode/completionProvider";
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

const need = () => {
  if (buildError) {
    assert.fail(`the bundle does not build: ${String(buildError.stderr || buildError.message).slice(0, 2000)}`);
  }
  return mod;
};

test("harness: the provider, the service and the config all bundle [harness guard - red here is a build problem, not a contract failure]", () => {
  need();
  assert.strictEqual(typeof mod.FimCompletionProvider, "function", "no FimCompletionProvider export");
  assert.strictEqual(typeof mod.CompletionService, "function", "no CompletionService export");
});

// The promised constants, read through the namespace so their absence is a
// contract failure with a sentence rather than a link error.
const PROMISED_MS = 1500;
const windowMs = () => {
  const v = mod.providerModule && mod.providerModule.PASSIVE_SCOPE_MS;
  return typeof v === "number" ? v : PROMISED_MS;
};

// ===========================================================================
// The scenario. Receiver `s`, the user has typed `s.en`, the widget is open.
// The same worked example the phase 1 blind file uses, so a phase 1 to phase 2
// behaviour change reads as a change of answer at an identical site.
// ===========================================================================

const SOURCE = "let s: Stripe;\ns.en";
const CURSOR_LINE = 1;
const CURSOR_END = 4; // after `s.en`
const TYPED_PARTIAL = "en";
const PRESELECT = "enrollTile"; // what the widget auto-highlights
const ARROWED = "enqueue"; // what the user arrows to, making the session ACTIVE
const SEPARATOR_CHAR = 1; // the dot in `s.en`

const AUTOMATIC = 1; // vscode.InlineCompletionTriggerKind.Automatic, per the stub
const INVOKE = 0; // vscode.InlineCompletionTriggerKind.Invoke

// Reported instead of throwing when the method the surface promises is absent,
// so phase 2's not-yet-existing surface fails as a sentence.
const NO_METHOD = "<the provider exposes no dropScope() method>";

const MEMBERS = [
  { name: "enrollTile", signature: "enrollTile(Tile) : bool", kind: "method" },
  { name: "enqueue", signature: "enqueue(Job) : void", kind: "method" },
  { name: "endpoint", signature: "endpoint() : string", kind: "method" },
  { name: "len", signature: "len() : int", kind: "method" },
];

const selectionAt = (member, line = CURSOR_LINE, endChar = CURSOR_END) => ({
  text: `.${member}`,
  range: {
    start: { line, character: SEPARATOR_CHAR },
    end: { line, character: endChar },
  },
});

function makePos(line, character) {
  return {
    line,
    character,
    translate(l, c) {
      return makePos(this.line + (l || 0), this.character + (c || 0));
    },
  };
}

// A document whose text and version are mutable, so an edit is a real version
// bump on the object identity VS Code would hand back.
function makeDoc(text, languageId = "typescript") {
  return {
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
}

// ===========================================================================
// The fake hooks. `now` is a number the test moves; `setTimer` records the arm
// and hands back a cancel; `fireDue` runs only the timers whose armed-at plus
// delay has actually been reached, so a test cannot fire a timer early and call
// that a passing expiry. `onScopedGhost` appends every reported visibility, in
// order: the whole point of section E is the SEQUENCE, not the last value.
// ===========================================================================

function makeHooks(start = 10_000, opts = {}) {
  const armed = [];
  const scoped = [];
  let now = start;
  let expired = 0;

  const hooks = {
    now: () => now,
    setTimer(ms, fn) {
      const rec = { ms, fn, armedAt: now, fired: false, cancelled: false };
      armed.push(rec);
      return () => {
        rec.cancelled = true;
      };
    },
    onExpired() {
      expired += 1;
    },
  };
  // A provider constructed with hooks that LACK onScopedGhost must behave
  // exactly as it does with them; `omitScopedGhost` is how that row is built.
  if (!opts.omitScopedGhost) {
    hooks.onScopedGhost = (visible) => {
      scoped.push(visible);
    };
  }

  return {
    hooks,
    advance(ms) {
      now += ms;
    },
    // A copy, because a fired callback may arm the next timer.
    fireDue() {
      for (const rec of armed.slice()) {
        if (rec.fired || rec.cancelled) continue;
        if (rec.armedAt + rec.ms > now) continue;
        rec.fired = true;
        rec.fn();
      }
    },
    snapshot() {
      return {
        now,
        armed: armed.length,
        pending: armed.filter((r) => !r.fired && !r.cancelled).length,
        fired: armed.filter((r) => r.fired).length,
        cancelled: armed.filter((r) => r.cancelled).length,
        delays: armed.map((r) => r.ms),
        expired,
        scoped: scoped.slice(),
      };
    },
  };
}

const MARK = (p) => `[[partial=${p}]]`;

// One provider, one service, a sequence of steps. A step may move the clock,
// fire due timers, edit the document, call dropScope(), and then issue a
// request. The generate stub echoes the memberPartial that reached it back
// through the ghost, so the scope is readable off the ITEM even when a cache
// answers without a second generate call.
async function session(steps, opts = {}) {
  const { ghost, config, omitTiming, omitScopedGhost, startNow, generateMs, cacheCapacity } = opts;
  const { FimCompletionProvider, CompletionService, DEFAULT_FIM_CONFIG } = need();

  globalThis.__v20sConfig = config || {};
  globalThis.__v20sExtractor = {
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
  const clock = makeHooks(startNow, { omitScopedGhost });
  const service = new CompletionService(
    { ...DEFAULT_FIM_CONFIG, ...(config || {}), debounceMs: 0, cacheCapacity: cacheCapacity ?? 100 },
    async () => {
      if (generateMs) {
        clock.advance(generateMs);
        clock.fireDue();
      }
      return {
        text: ghost ? ghost(recorded[recorded.length - 1]) : MARK(lastPartial(recorded)),
        ttftMs: 1,
        totalMs: generateMs || 2,
      };
    },
    () => {}
  );

  // A recording proxy rather than a fake service: the real service still does
  // the real work, and only the call the contract talks about is observed.
  const spy = new Proxy(service, {
    get(t, p) {
      if (p === "complete") {
        return (o) => {
          recorded.push(o);
          return t.complete(o);
        };
      }
      const v = Reflect.get(t, p, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });

  const output = { appendLine: () => {} };
  const provider = omitTiming
    ? new FimCompletionProvider(() => spy, output)
    : new FimCompletionProvider(() => spy, output, undefined, clock.hooks);

  const doc = makeDoc(SOURCE);
  const results = [];

  for (const step of steps) {
    if (step.docChanged !== undefined) {
      provider.onDocumentChanged(step.docChanged === true ? doc.uri.toString() : step.docChanged);
    }
    if (step.cursorMoved !== undefined) {
      const m = step.cursorMoved;
      const [uri, line, character] = m.length === 3 ? m : [doc.uri.toString(), m[0], m[1]];
      provider.onCursorMoved(uri, line, character);
    }
    if (step.advanceMs) clock.advance(step.advanceMs);
    if (step.fire) clock.fireDue();
    if (step.editTo !== undefined) doc.edit(step.editTo);

    // The command's half of the gesture. It runs LAST before the request,
    // because that is the real order: the developer presses Escape, the
    // provider drops the scope, and only then does the editor re-render.
    let dropped;
    for (let i = 0; i < (step.dropScope || 0); i += 1) {
      dropped = typeof provider.dropScope === "function" ? provider.dropScope() : NO_METHOD;
      if (step.dropScopeCalls) step.dropScopeCalls.push(dropped);
    }

    if (step.request === false) {
      results.push({ items: [], calls: [], dropped, version: doc.version, timers: clock.snapshot() });
      continue;
    }

    const position = makePos(step.line ?? CURSOR_LINE, step.char ?? CURSOR_END);
    const before = recorded.length;
    const raw = await provider.provideInlineCompletionItems(
      doc,
      position,
      { triggerKind: step.triggerKind ?? AUTOMATIC, selectedCompletionInfo: step.sci },
      { onCancellationRequested: () => {}, isCancellationRequested: false }
    );
    const items = Array.isArray(raw) ? raw : (raw && raw.items) || [];
    results.push({ items, calls: recorded.slice(before), dropped, version: doc.version, timers: clock.snapshot() });
  }

  service.dispose();
  globalThis.__v20sConfig = {};
  return { results, recorded, clock, provider };
}

const lastPartial = (recorded) => {
  const last = recorded[recorded.length - 1];
  return last && typeof last.memberPartial === "string" ? last.memberPartial : String(last && last.memberPartial);
};

// The partial the generation layer worked from, read out of the ghost the
// provider surfaced. Undefined when nothing was surfaced at all.
function servedPartial(result) {
  const item = result.items[0];
  if (!item) return undefined;
  const m = /\[\[partial=([^\]]*)\]\]/.exec(String(item.insertText));
  return m ? m[1] : `NO-MARKER(${JSON.stringify(String(item.insertText))})`;
}

// Table runner: one body, many cases, every failure reported together and each
// one named. A table that fails without case identity proves nothing.
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

// The shapes every step in this file reduces to.
const open = (member) => ({ sci: selectionAt(member) });
const escape = (extra = {}) => ({ sci: undefined, ...extra });
const drop = (extra = {}) => ({ sci: undefined, dropScope: 1, ...extra });

// The two ways a sticky record is made: the widget picks one (passive) or the
// user arrows to another (active). Both are droppable, and the active one is
// the case with no other way out.
const PASSIVE_STEPS = [open(PRESELECT), escape()];
const ACTIVE_STEPS = [open(PRESELECT), open(ARROWED), escape()];

// ===========================================================================
// A. THE RETURN VALUE. The keybinding is gated on a context key, and a context
// key can be stale. `dropScope()` returning false is how the command knows to
// fall through to `editor.action.inlineSuggest.hide` and give the developer the
// ordinary Escape they actually pressed.
// ===========================================================================

test("A. dropScope() returns true exactly when a sticky scope was held, and false when there is nothing to drop [surface 'Returns true when there was one, so the caller can tell a real dismissal from a stale keybinding']", async () => {
  const W = windowMs();
  await table(
    [
      { name: "passive preselect, Escape, then the second Escape", steps: PASSIVE_STEPS, expect: true },
      { name: "arrowed ACTIVE scope, Escape, then the second Escape", steps: ACTIVE_STEPS, expect: true },
      { name: "virgin provider - no widget was ever opened", steps: [], expect: false },
      { name: "a plain unscoped request and nothing else", steps: [escape()], expect: false },
      { name: "after the passive window already expired", steps: [...PASSIVE_STEPS, escape({ advanceMs: W, fire: true })], expect: false },
      { name: "after a document edit already killed the record", steps: [...PASSIVE_STEPS, escape({ editTo: SOURCE })], expect: false },
      { name: "after a cursor move already killed the record", steps: [...ACTIVE_STEPS, escape({ cursorMoved: [CURSOR_LINE, CURSOR_END + 6] })], expect: false },
    ],
    async (row) => {
      const { results } = await session([...row.steps, drop({ request: false })]);
      const got = results[results.length - 1].dropped;
      assert.strictEqual(
        got,
        row.expect,
        `dropScope() must return ${row.expect} here, got ${JSON.stringify(got)}${got === NO_METHOD ? "" : ` - ${row.expect ? "a real dismissal reported as stale sends the editor down the hide path and the ghost vanishes instead of reverting" : "a stale keybinding reported as a real dismissal swallows the developer's Escape"}`}`
      );
    }
  );
});

test("A. a second dropScope() with nothing left to drop returns false: the third Escape is the developer asking for the ordinary one [surface 'by then there is no scope left, so the key does its ordinary thing']", async () => {
  const calls = [];
  await session([...PASSIVE_STEPS, { sci: undefined, dropScope: 2, dropScopeCalls: calls, request: false }]);
  assert.deepStrictEqual(
    calls,
    [true, false],
    `two dropScope() calls in a row must report [true, false], got ${JSON.stringify(calls)} - a second true tells the command a scope was dismissed that never existed, and the developer's third Escape does nothing`
  );
});

test("A. dropScope() on a virgin provider changes nothing: the request that follows is the ordinary unscoped one, with no timer and no scoped-ghost report [surface invariant 'dropScope() on a provider holding nothing returns false and changes no state']", async () => {
  const { results } = await session([drop({ request: false }), escape(), escape()]);
  const got = results.slice(1).map(servedPartial);
  assert.deepStrictEqual(
    got,
    [TYPED_PARTIAL, TYPED_PARTIAL],
    `dropping nothing must leave the provider exactly as it was, so both requests read ${JSON.stringify(TYPED_PARTIAL)}, got ${JSON.stringify(got)}`
  );
  const t = results[2].timers;
  assert.strictEqual(t.armed, 0, `no widget and no scope means no timer, got ${t.armed} armed`);
  assert.strictEqual(t.expired, 0, `no scope means no expiry, got ${t.expired} onExpired call(s)`);
  assert.deepStrictEqual(t.scoped, [], `nothing was ever scoped, so onScopedGhost must not have been called at all, got ${JSON.stringify(t.scoped)}`);
});

// ===========================================================================
// B. THE DROP. Waiting out 1500ms is the slow way back to the generic ghost.
// This is the fast way, and for an ACTIVE scope it is the ONLY way that is not
// typing: an arrowed choice carries no deadline by design.
// ===========================================================================

test("B. after dropScope() the next request at the same state is unscoped, for a passive preselect AND for an arrowed ACTIVE scope [surface 'It applies to ANY sticky scope, passive or active']", async () => {
  await table(
    [
      { name: "PASSIVE preselect, dropped before its window closed", steps: PASSIVE_STEPS, scopedTo: PRESELECT },
      { name: "ACTIVE arrowed scope, which has no deadline at all", steps: ACTIVE_STEPS, scopedTo: ARROWED },
    ],
    async (row) => {
      const { results } = await session([...row.steps, drop()]);
      assert.strictEqual(
        servedPartial(results[row.steps.length - 1]),
        row.scopedTo,
        `harness guard: the first Escape must be scoped to ${JSON.stringify(row.scopedTo)} or there is nothing to drop, got ${JSON.stringify(servedPartial(results[row.steps.length - 1]))}`
      );
      assert.strictEqual(
        servedPartial(results[results.length - 1]),
        TYPED_PARTIAL,
        `after dropScope() the request at the same state must be unscoped to the typed partial ${JSON.stringify(TYPED_PARTIAL)}, got ${JSON.stringify(servedPartial(results[results.length - 1]))} - for the active case this is the developer's only escape hatch short of typing`
      );
    }
  );
});

test("B. the drop is permanent, not a one-request suppression: every later request at that state stays unscoped [surface 'the scope is dropped', not muted]", async () => {
  const W = windowMs();
  const { results } = await session([...ACTIVE_STEPS, drop(), escape(), escape({ advanceMs: W * 4 })]);
  const after = results.slice(3).map(servedPartial);
  assert.deepStrictEqual(
    after,
    [TYPED_PARTIAL, TYPED_PARTIAL, TYPED_PARTIAL],
    `a dropped scope must not come back, expected three unscoped requests, got ${JSON.stringify(after)}`
  );
});

test("B. the dropped-through request is indistinguishable from one on a provider that saw no widget: same memberPartial, same site, same receiver [surface 'replaced by the provider's own unscoped completion']", async () => {
  const { results: controlResults } = await session([escape()]);
  const control = controlResults[0].calls[0];
  assert.ok(control, "control sanity: an unselected request must reach the service");

  const { results } = await session([...PASSIVE_STEPS, drop()]);
  const call = results[results.length - 1].calls[0];
  assert.ok(call, "the request after dropScope() never reached the service");
  assert.deepStrictEqual(
    { memberPartial: call.memberPartial, memberSite: call.memberSite, memberReceiver: call.memberReceiver },
    { memberPartial: control.memberPartial, memberSite: control.memberSite, memberReceiver: control.memberReceiver },
    `after dropScope() the request must look exactly like one on a virgin provider, control ${JSON.stringify({ memberPartial: control.memberPartial, memberSite: control.memberSite, memberReceiver: control.memberReceiver })}`
  );
});

test("B. the drop still serves an item: a second Escape that scopes nothing AND surfaces nothing is just the editor's hide, which is the behaviour being replaced [surface 'the ghost is replaced, immediately, by the provider's own unscoped completion']", async () => {
  const { results } = await session([...PASSIVE_STEPS, drop()], { ghost: () => "endpoint();" });
  assert.ok(
    results[results.length - 1].items.length > 0,
    "the request after dropScope() surfaced no item, so the developer got a hide instead of a revert"
  );
});

// ===========================================================================
// C. THE TIMER. dropScope() gets the developer to the same place the expiry
// would have, sooner. The expiry that was already armed must not still fire:
// it would ask the editor to re-render for a record that is already gone.
// ===========================================================================

test("C. dropScope() cancels the pending expiry: nothing left armed and no onExpired however far the clock is swept [surface 'no expiry timer is left armed']", async () => {
  const W = windowMs();
  const { results } = await session([
    ...PASSIVE_STEPS,
    drop({ request: false }),
    { request: false, advanceMs: W * 10, fire: true },
    escape(),
  ]);
  assert.strictEqual(results[1].timers.pending, 1, `harness guard: a passive Escape must arm the window before dropScope() can cancel it, got ${results[1].timers.pending} pending`);
  assert.strictEqual(
    results[2].timers.pending,
    0,
    `dropScope() must cancel the armed window, not merely ignore it when it fires: ${results[2].timers.pending} still pending`
  );
  assert.strictEqual(
    results[3].timers.expired,
    0,
    `no onExpired may follow a dropScope(): it fired ${results[3].timers.expired} time(s), so the editor was asked to re-render for a record the developer had already dismissed`
  );
  assert.strictEqual(
    servedPartial(results[4]),
    TYPED_PARTIAL,
    `and the state is the dropped one, got ${JSON.stringify(servedPartial(results[4]))}`
  );
});

test("C. the request following a dropScope() arms no new timer: the unscoped serve has no window to open, so there is no loop [surface promise 4 - a timer is armed only when a PASSIVE scope is served]", async () => {
  const W = windowMs();
  const { results } = await session([...PASSIVE_STEPS, drop(), escape(), { request: false, advanceMs: W * 4, fire: true }]);
  assert.strictEqual(
    results[2].timers.pending,
    0,
    `the drop's own re-render must arm nothing, got ${results[2].timers.pending} pending (delays ${JSON.stringify(results[2].timers.delays)})`
  );
  assert.strictEqual(results[3].timers.pending, 0, `and the request after it must arm nothing either, got ${results[3].timers.pending} pending`);
  assert.strictEqual(results[4].timers.expired, 0, `sweeping the clock afterwards must find nothing to fire, got ${results[4].timers.expired} onExpired call(s)`);
});

// Amended under the human design call 2026-07-26
// (docs/architecture/vscode-layer.md, "Measured records"): the window is
// uniform, so an arrowed scope's post-close serve DOES arm the one-shot, and
// the second Escape cancels it exactly as it does a preselect's. The original
// row ("nothing was armed") pinned the void indefinite hold.
test("C. dropping an arrowed scope cancels its window like any other: one timer armed at the serve, none pending after the drop, nothing ever expires [uniform window]", async () => {
  const W = windowMs();
  const { results } = await session([...ACTIVE_STEPS, drop(), { request: false, advanceMs: W * 4, fire: true }]);
  assert.strictEqual(results[2].timers.armed, 1, `the arrowed scope's serve arms its uniform window, got ${results[2].timers.armed} armed`);
  assert.strictEqual(results[4].timers.pending, 0, `the drop must cancel it, not merely ignore it: ${results[4].timers.pending} still pending`);
  assert.strictEqual(results[4].timers.expired, 0, `and nothing expires after the drop, got ${results[4].timers.expired} onExpired call(s)`);
});

// ===========================================================================
// D. THE DOWNGRADE. `editor.action.inlineSuggest.trigger` arrives as
// InlineCompletionTriggerKind.Invoke, which the service reads as manual:
// debounce bypassed, an alternatives fan-out. dropScope() disowns the
// re-render it provokes by spending the SAME one-shot flag the expiry uses.
// ===========================================================================

const dispatch = (call) => ({ manual: call && call.manual, alternatives: call && call.alternatives });

test("D. the request following dropScope() is dispatched as AUTOMATIC even though it arrives as Invoke: the drop disowns the re-render it provoked [surface 'Also disowns the re-render it is about to provoke, the same way an expiry does']", async () => {
  const { results: base } = await session([escape({ triggerKind: AUTOMATIC })]);
  const control = dispatch(base[0].calls[0]);
  assert.ok(base[0].calls[0], "control sanity: an automatic request must reach the service");

  await table(
    [
      { name: "passive preselect dropped", steps: PASSIVE_STEPS },
      { name: "arrowed ACTIVE scope dropped", steps: ACTIVE_STEPS },
    ],
    async (row) => {
      const { results } = await session([...row.steps, drop({ triggerKind: INVOKE })]);
      const call = results[results.length - 1].calls[0];
      assert.ok(call, "the re-render request never reached the service");
      assert.notStrictEqual(call.manual, true, `the re-render the drop provoked must be automatic, but the service saw manual=${JSON.stringify(call.manual)}`);
      assert.deepStrictEqual(
        dispatch(call),
        control,
        `the drop's re-render must reach the service looking exactly like an automatic request ${JSON.stringify(control)}, got ${JSON.stringify(dispatch(call))} - otherwise every second Escape costs a full alternatives fan-out`
      );
    }
  );
});

test("D. the flag dropScope() spends is ONE-SHOT: the request after the re-render honours a genuine user Invoke again [surface invariant 'It reuses the same one-shot' the expiry uses]", async () => {
  const { results: base } = await session([escape({ triggerKind: INVOKE })]);
  const genuine = dispatch(base[0].calls[0]);
  assert.strictEqual(genuine.manual, true, `control sanity: an Invoke on a virgin provider must reach the service as manual, got ${JSON.stringify(genuine)}`);

  const { results } = await session([
    ...PASSIVE_STEPS,
    drop({ triggerKind: INVOKE }), // the re-render, downgraded
    escape({ triggerKind: INVOKE }), // the developer hitting the manual-trigger key
  ]);
  const first = results[2].calls[0];
  assert.ok(first, "the drop's own re-render never reached the service");
  assert.notStrictEqual(
    first.manual,
    true,
    `harness guard: the flag must actually be spent on the drop's re-render before its one-shot-ness means anything, but the service saw manual=${JSON.stringify(first.manual)}`
  );
  const call = results[results.length - 1].calls[0];
  assert.ok(call, "the second Invoke never reached the service");
  assert.deepStrictEqual(
    dispatch(call),
    genuine,
    `the flag is consumed by ONE request: the next Invoke must dispatch like a genuine user invoke ${JSON.stringify(genuine)}, got ${JSON.stringify(dispatch(call))} - a permanent downgrade silently kills the alternatives fan-out`
  );
});

test("D. a dropScope() that returned false arms no downgrade: a stale keybinding must not eat the next genuine Invoke [surface 'dropScope() on a provider holding nothing ... changes no state']", async () => {
  const { results: base } = await session([escape({ triggerKind: INVOKE })]);
  const genuine = dispatch(base[0].calls[0]);

  const { results } = await session([drop({ triggerKind: INVOKE })]);
  assert.strictEqual(results[0].dropped, false, `harness guard: dropScope() on a virgin provider must return false, got ${JSON.stringify(results[0].dropped)}`);
  const call = results[0].calls[0];
  assert.ok(call, "the Invoke never reached the service");
  assert.deepStrictEqual(
    dispatch(call),
    genuine,
    `nothing was dropped, so nothing was disowned: this Invoke must stay manual like ${JSON.stringify(genuine)}, got ${JSON.stringify(dispatch(call))}`
  );
});

// ===========================================================================
// E. THE CONTEXT KEY. `column80.scopedGhost` gates the Escape keybinding. It is
// driven by onScopedGhost, which reports a CHANGE in whether a STICKY-scoped
// ghost is on screen. Sticky means the record with the widget CLOSED: while the
// widget is open the widget owns Escape, and the first Escape has to keep
// closing it rather than dropping the scope.
// ===========================================================================

const scopedCalls = (result) => result.timers.scoped;

test("E. onScopedGhost fires true when a sticky-scoped ghost is served and false when it goes away, in that order and once each [surface 'true when a request just served one, false when the record is gone']", async () => {
  const W = windowMs();
  await table(
    [
      {
        name: "passive preselect, then the window expires and the re-render serves unscoped",
        steps: [...PASSIVE_STEPS, escape({ advanceMs: W, fire: true, triggerKind: INVOKE })],
      },
      {
        name: "passive preselect, then the second Escape drops it",
        steps: [...PASSIVE_STEPS, drop()],
      },
      {
        name: "arrowed ACTIVE scope, then the second Escape drops it",
        steps: [...ACTIVE_STEPS, drop()],
      },
      {
        name: "passive preselect, then a document edit kills the record",
        steps: [...PASSIVE_STEPS, escape({ editTo: SOURCE })],
      },
    ],
    async (row) => {
      const { results } = await session(row.steps);
      const got = scopedCalls(results[results.length - 1]);
      assert.deepStrictEqual(
        got,
        [true, false],
        `the context key must go true when the sticky ghost appears and false when it goes, got ${JSON.stringify(got)} - a key stuck true leaves Escape bound to a command with nothing to drop, and a key stuck false means the second Escape never reaches the provider`
      );
    }
  );
});

test("E. onScopedGhost fires only on a CHANGE: a run of identical states produces no run of calls [surface 'Fired only on a CHANGE, never on every request']", async () => {
  const W = windowMs();
  await table(
    [
      {
        name: "four scoped requests inside one window",
        steps: [open(PRESELECT), escape(), escape(), escape(), escape()],
        expect: [true],
      },
      {
        name: "three unscoped requests and no widget at all",
        steps: [escape(), escape(), escape()],
        expect: [],
      },
      {
        name: "scoped, dropped, then three more unscoped requests",
        steps: [...PASSIVE_STEPS, drop(), escape(), escape()],
        expect: [true, false],
      },
      {
        name: `scoped, expired, and swept ${W * 3}ms further with more requests`,
        steps: [...PASSIVE_STEPS, escape({ advanceMs: W, fire: true }), escape({ advanceMs: W * 3, fire: true }), escape()],
        expect: [true, false],
      },
    ],
    async (row) => {
      const { results } = await session(row.steps);
      const got = scopedCalls(results[results.length - 1]);
      assert.deepStrictEqual(
        got,
        row.expect,
        `expected the exact call sequence ${JSON.stringify(row.expect)}, got ${JSON.stringify(got)} (${got.length} call(s)) - firing per request makes every keystroke a context-key write`
      );
    }
  );
});

// Rewritten under TRIAGE authority 2026-07-26, triage-p1.md loop-2 ruling,
// goal.md triage amendment: the key means scope-in-force; the widget's
// ownership of the first Escape is enforced by !suggestWidgetVisible in the
// when-clause (row H).
test("E. a scope taken while the widget is OPEN arms the key exactly once, at the request that creates the record; arrowing adds no further transitions [goal.md triage amendment: the key means scope-in-force]", async () => {
  await table(
    [
      { name: "the widget's first auto-highlight", steps: [open(PRESELECT)] },
      { name: "the developer arrowing through three members", steps: [open(PRESELECT), open(ARROWED), open("endpoint")] },
    ],
    async (row) => {
      const { results } = await session(row.steps, { ghost: () => `${ARROWED}(job);` });
      const got = scopedCalls(results[results.length - 1]);
      assert.deepStrictEqual(
        got,
        [true],
        `the key arms once, at the request that creates the record, and arrowing must add no further transitions - each arrow replaces the record within one event and the mirror syncs post-event, so the key never dips; got ${JSON.stringify(got)}`
      );
    }
  );
});

// Rewritten under TRIAGE authority 2026-07-26, triage-p1.md loop-2 ruling,
// goal.md triage amendment: the key means scope-in-force; the widget's
// ownership of the first Escape is enforced by !suggestWidgetVisible in the
// when-clause (row H).
test("E. the key arms exactly once, at the first widget-open request: neither the arrow nor the Escape adds a transition [goal.md triage amendment: the key means scope-in-force]", async () => {
  const { results } = await session([open(PRESELECT), open(ARROWED), escape()]);
  assert.deepStrictEqual(
    scopedCalls(results[0]),
    [true],
    `the single true fires at the first widget-open request, where the record is created, got ${JSON.stringify(scopedCalls(results[0]))}`
  );
  assert.deepStrictEqual(
    scopedCalls(results[2]),
    [true],
    `exactly one transition for the whole open-arrow-Escape run: the arrow and the Escape hold the scope, they do not re-arm it; got ${JSON.stringify(scopedCalls(results[2]))}`
  );
});

test("E. onScopedGhost is optional: a provider given hooks without it still scopes, still drops, and still reverts [surface invariant 'onScopedGhost is optional. A provider constructed without it behaves exactly as it does today']", async () => {
  const W = windowMs();
  const { results } = await session([...PASSIVE_STEPS, drop(), escape()], { omitScopedGhost: true });
  assert.strictEqual(servedPartial(results[1]), PRESELECT, `the passive Escape must still be scoped to ${JSON.stringify(PRESELECT)}, got ${JSON.stringify(servedPartial(results[1]))}`);
  assert.strictEqual(results[2].dropped, true, `dropScope() must still report the dismissal without the hook, got ${JSON.stringify(results[2].dropped)}`);
  assert.strictEqual(servedPartial(results[2]), TYPED_PARTIAL, `and the re-render must still be unscoped, got ${JSON.stringify(servedPartial(results[2]))}`);
  assert.strictEqual(results[3].timers.pending, 0, `the window must still be cancelled, got ${results[3].timers.pending} pending`);
  assert.ok(W > 0, "harness guard: the window constant must be a positive number");
});

test("E. omitting the hooks object entirely still works: no onScopedGhost, no injected clock, and the drop still reverts the ghost [surface phase 1 'Omitting timing must leave production behaviour intact']", async () => {
  const { results } = await session([...PASSIVE_STEPS, drop()], { omitTiming: true });
  assert.strictEqual(servedPartial(results[1]), PRESELECT, `with default hooks the passive Escape must still be scoped, got ${JSON.stringify(servedPartial(results[1]))}`);
  assert.strictEqual(results[2].dropped, true, `dropScope() must work on a provider built with no hooks at all, got ${JSON.stringify(results[2].dropped)}`);
  assert.strictEqual(servedPartial(results[2]), TYPED_PARTIAL, `and the request after it must be unscoped, got ${JSON.stringify(servedPartial(results[2]))}`);
});

// ===========================================================================
// F. PHASE 1 REGRESSION NET. Not the whole phase 1 file: the load-bearing few.
// If this section is the only thing red, the second Escape was bought by
// breaking the window it was built on top of.
// ===========================================================================

test("F. the renamed hooks export is the VALUE the extension wires: REAL_SCOPE_HOOKS exists, is shaped like the interface, and the old REAL_TIMING name is gone [surface 'ScopeTiming is renamed ScopeHooks ... REAL_TIMING is renamed REAL_SCOPE_HOOKS']", () => {
  need();
  const ns = mod.providerModule || {};
  // Types vanish at bundle time, so the interface rename cannot be asserted
  // directly. The exported VALUE is the observable half of it.
  assert.ok(
    ns.REAL_SCOPE_HOOKS && typeof ns.REAL_SCOPE_HOOKS === "object",
    `the provider module must export REAL_SCOPE_HOOKS, got ${JSON.stringify(ns.REAL_SCOPE_HOOKS)} - extension.ts spreads it to build the production hooks`
  );
  const h = ns.REAL_SCOPE_HOOKS || {};
  assert.deepStrictEqual(
    { now: typeof h.now, setTimer: typeof h.setTimer, onExpired: typeof h.onExpired },
    { now: "function", setTimer: "function", onExpired: "function" },
    `REAL_SCOPE_HOOKS must carry the real clock, the real timer and the default expiry callback, got ${JSON.stringify({ now: typeof h.now, setTimer: typeof h.setTimer, onExpired: typeof h.onExpired })}`
  );
  assert.strictEqual(
    ns.REAL_TIMING,
    undefined,
    `REAL_TIMING was RENAMED, not duplicated: leaving both exported leaves two default-hook objects for a future edit to drift apart, got ${JSON.stringify(ns.REAL_TIMING)}`
  );
});

test("F. PASSIVE_SCOPE_MS is still the named exported constant phase 1 promised [surface phase 1 'export const PASSIVE_SCOPE_MS = 1500'] (regression net)", () => {
  need();
  const ns = mod.providerModule || {};
  assert.strictEqual(typeof ns.PASSIVE_SCOPE_MS, "number", `the provider module must export PASSIVE_SCOPE_MS as a number, got ${JSON.stringify(ns.PASSIVE_SCOPE_MS)}`);
  assert.strictEqual(ns.PASSIVE_SCOPE_MS, PROMISED_MS, `PASSIVE_SCOPE_MS must be ${PROMISED_MS}, got ${JSON.stringify(ns.PASSIVE_SCOPE_MS)}`);
});

test("F. the passive window still bounds the scope: inside it scoped, at or after the deadline unscoped [surface phase 1 promise 2] (regression net)", async () => {
  const W = windowMs();
  await table(
    [
      { name: "the same instant as the first Escape", elapsed: 0, scoped: true },
      { name: `${W - 1}ms - the last instant inside the window`, elapsed: W - 1, scoped: true },
      { name: `${W}ms - exactly the deadline, which is OUTSIDE`, elapsed: W, scoped: false },
      { name: `${W * 10}ms - long gone`, elapsed: W * 10, scoped: false },
    ],
    async (row) => {
      const { results } = await session([...PASSIVE_STEPS, escape({ advanceMs: row.elapsed })]);
      const expect = row.scoped ? PRESELECT : TYPED_PARTIAL;
      assert.strictEqual(
        servedPartial(results[2]),
        expect,
        `${row.elapsed}ms after the first Escape the request must be ${row.scoped ? "SCOPED" : "UNSCOPED"} (${JSON.stringify(expect)}), got ${JSON.stringify(servedPartial(results[2]))}`
      );
    }
  );
});

// Amended under the human design call 2026-07-26
// (docs/architecture/vscode-layer.md, "Measured records"): the window is
// uniform. Arrow-Escape-Tab is untouched INSIDE the 1.5s window; past it the
// arrowed scope reverts like a preselect. The original row pinned the void
// indefinite hold ("survives any elapsed time").
test("F. arrow-Escape-Tab holds inside the uniform window and reverts past it [journeys/member-dot-flow.md, decided 2026-07-26]", async () => {
  const W = windowMs();
  const { results } = await session([
    ...ACTIVE_STEPS,
    escape({ advanceMs: W - 1 }),
    { request: false, advanceMs: 1, fire: true },
    escape(),
  ]);
  assert.strictEqual(
    servedPartial(results[3]),
    ARROWED,
    `inside the window the arrowed member still governs, so Tab can take it; got ${JSON.stringify(servedPartial(results[3]))}`
  );
  assert.strictEqual(
    results[4].timers.expired,
    1,
    `at the deadline the window closes exactly once, got ${results[4].timers.expired} call(s)`
  );
  assert.strictEqual(
    servedPartial(results[5]),
    TYPED_PARTIAL,
    `and the request after it is the unscoped revert, got ${JSON.stringify(servedPartial(results[5]))}`
  );
});

test("F. the expiry path still works end to end: one timer armed for the full window, one onExpired, and the re-render comes back unscoped [surface phase 1 promise 4] (regression net)", async () => {
  const W = windowMs();
  const { results } = await session([...PASSIVE_STEPS, escape({ advanceMs: W, fire: true, triggerKind: INVOKE }), escape()]);
  assert.deepStrictEqual(
    results[1].timers.delays,
    [W],
    `exactly one timer, for the full ${W}ms window, armed at the passive serve; got ${JSON.stringify(results[1].timers.delays)}`
  );
  assert.strictEqual(results[2].timers.expired, 1, `onExpired must fire exactly once, got ${results[2].timers.expired}`);
  assert.strictEqual(servedPartial(results[2]), TYPED_PARTIAL, `the re-triggered request is the unscoped one that swaps the ghost, got ${JSON.stringify(servedPartial(results[2]))}`);
  assert.strictEqual(results[3].timers.pending, 0, `nothing may be armed after the expiry or the provider loops, got ${results[3].timers.pending} pending`);
});

test("F. a document edit still kills the record outright, passive or active, before any deadline or drop is consulted [surface phase 1 invariant] (regression net)", async () => {
  await table(
    [
      { name: "PASSIVE record, killed well inside its window", steps: PASSIVE_STEPS },
      { name: "ACTIVE record, which has no window at all", steps: ACTIVE_STEPS },
    ],
    async (row) => {
      const { results } = await session([...row.steps, escape({ editTo: SOURCE })]);
      const last = results[results.length - 1];
      assert.strictEqual(
        servedPartial(last),
        TYPED_PARTIAL,
        `after a version bump the request must be unscoped (${JSON.stringify(TYPED_PARTIAL)}), got ${JSON.stringify(servedPartial(last))} - a scope that survives an edit puts a stale member into fresh text`
      );
      assert.notStrictEqual(last.version, results[results.length - 2].version, "harness guard: the edit must actually have bumped the version");
    }
  );
});

test("F. the open-widget ghost is still scoped to the highlight and still carries the widget range [surface phase 1 invariant - VS Code's augmentation rule] (regression net)", async () => {
  const sci = selectionAt(ARROWED);
  const { results } = await session([{ sci }], { ghost: () => `${ARROWED}(job);` });
  const item = results[0].items[0];
  assert.ok(item, "no item was returned at all, so there is nothing for VS Code to draw");
  const r = item.range;
  assert.deepStrictEqual(
    r && { startLine: r.start.line, startChar: r.start.character, endLine: r.end.line, endChar: r.end.character },
    { startLine: sci.range.start.line, startChar: sci.range.start.character, endLine: sci.range.end.line, endChar: sci.range.end.character },
    "an item served while the widget is open must carry the widget range or VS Code drops it silently"
  );
  assert.ok(String(item.insertText).startsWith(sci.text), `insertText must extend the widget text ${JSON.stringify(sci.text)}, got ${JSON.stringify(String(item.insertText))}`);
});

// ===========================================================================
// G. Added by the implementer under triage D9 and D10, after a review round
// found the state below reachable from the command palette and found two
// context-key transitions that no assertion pinned.
// ===========================================================================

test("G. a dismissal taken while the widget is open leaves no ACTIVE flag behind: the reopen at that state is refused outright, and never becomes a deadline-free permanent scope [b470af7's invariant, which a scope dismissal must not undo]", async () => {
  const W = windowMs();
  // Arrow to a member (the session is now ACTIVE), dismiss the scope with the
  // widget still up, then re-open at the same untouched state. Two things must
  // hold. The reopen must not inherit `active`, which would make it permanent.
  // And under the refusal rule it must not scope at all: the developer said no
  // at this state. Far past the window, still unscoped, proves both at once -
  // an inherited active flag would still be serving the member.
  const steps = [
    open(PRESELECT),
    open(ARROWED), // the arrow: this session is ACTIVE
    { dropScope: 1, request: false }, // the dismissal, widget still up
    open(PRESELECT), // the widget's own pick again, same untouched state
    escape(),
    escape({ advanceMs: W * 4 }),
  ];
  const { results } = await session(steps, { cacheCapacity: 0 });
  assert.strictEqual(
    servedPartial(results[4]),
    TYPED_PARTIAL,
    `the reopen after a dismissal is refused at that state, so its Escape is unscoped; got ${JSON.stringify(servedPartial(results[4]))}`
  );
  assert.strictEqual(
    servedPartial(results[5]),
    TYPED_PARTIAL,
    `and far past the window it is still unscoped; got ${JSON.stringify(servedPartial(results[5]))} - a member still being served here is an active flag that outlived its widget`
  );
});

test("G. the context key goes false on a path that issues NO further request: a cursor move away is the last thing that happens, and a key left true fires the binding against a scope that is gone [surface 'false when the record is gone']", async () => {
  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ cursorMoved: [CURSOR_LINE, CURSOR_END + 6], request: false }),
  ]);
  assert.deepStrictEqual(
    results[2].timers.scoped,
    [true, false],
    `the scoped-ghost signal must read [true, false] once the record is gone, got ${JSON.stringify(results[2].timers.scoped)} - stuck true means the developer's next Escape re-triggers where they wanted a dismissal`
  );
});

// Rewritten by the v26 implementer, 2026-07-26. The old row pinned the key
// going FALSE at a zero-items scoped serve - which disarmed the second Escape
// in exactly the state that needs it, half of the wedge session-v26 removes
// (goal.md fix direction 3). The key now arms on scope-in-force with the
// widget closed, served or not, so the fast revert stays reachable; the drop
// itself is what lowers it.
test("G. a scoped request that serves NOTHING keeps the key ARMED: the scope is still in force, so the second Escape stays reachable and is what lowers it [v26 fix (b); supersedes 'serving nothing reports the ghost gone']", async () => {
  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape(),
    drop({ request: false }),
  ], {
    // The FIRST scoped Escape serves cleanly, so the signal goes true. The
    // second returns a ghost naming a SIBLING, which the landed-name guard
    // refuses, so nothing reaches the screen - and the scope is STILL in
    // force, so the signal holds.
    ghost: (() => {
      let n = 0;
      // Calls 0 and 1 are the widget-open request and the first Escape; only
      // the LAST one returns the sibling-naming ghost the guard refuses.
      return () => (n++ < 2 ? "(a);" : "Tally(a, b)");
    })(),
    cacheCapacity: 0,
  });
  assert.strictEqual(results[2].items.length, 0, "harness guard: the sibling-naming ghost must be refused, or this row measures nothing");
  assert.deepStrictEqual(
    results[2].timers.scoped,
    [true],
    `a zero-items serve under a live scope must leave the key armed, got ${JSON.stringify(results[2].timers.scoped)} - a false here makes the second Escape unreachable exactly where the ghost starved`
  );
  assert.strictEqual(results[3].dropped, true, "and the second Escape reaches the scope the key was armed for");
  assert.deepStrictEqual(
    results[3].timers.scoped,
    [true, false],
    `the drop is what lowers the key, got ${JSON.stringify(results[3].timers.scoped)}`
  );
});

// ===========================================================================
// H. The contribution itself, read out of package.json. The keybinding is on
// Escape, the most overloaded key in the editor, and its `when` clause is the
// only thing standing between this feature and a developer who cannot leave
// insert mode. VS Code has no fall-through: a binding that wins simply wins,
// so every state this must not steal has to be named here.
// ===========================================================================

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

// Rewritten under TRIAGE authority 2026-07-26, triage-p1.md loop-2 ruling,
// goal.md triage amendment: `inlineSuggestionVisible` is removed (it was
// false in exactly the ghost-less states the second Escape exists for) and
// `!parameterHintsVisible` is its containment. The impl manifest pin owns the
// absence assertion; this row pins the terms that must be PRESENT.
const REQUIRED_WHEN = [
  "editorTextFocus",
  "!suggestWidgetVisible",
  "column80.scopedGhost",
  "!findWidgetVisible",
  "!editorHasSelection",
  "!editorHoverVisible",
  "!referenceSearchVisible",
  "!vim.active",
  "!inSnippetMode",
  "!editorHasMultipleSelections",
  "!inlineChatVisible",
  "!editorReadonly",
  "!inDebugRepl",
  "!parameterHintsVisible",
];

test("H. the dismissal is bound to Escape, and its `when` clause names every state it must not steal [triage D8 - VS Code has no fall-through, so an unguarded state is a stolen key]", async () => {
  const binding = (manifest.contributes.keybindings || []).find((k) => k.command === "column80.dismissScopedGhost");
  assert.ok(binding, "no keybinding contributes column80.dismissScopedGhost, so the second Escape does nothing");
  assert.strictEqual(binding.key, "escape", `the gesture is the second Escape, got ${JSON.stringify(binding.key)}`);
  await table(
    REQUIRED_WHEN.map((term) => ({ name: term, term })),
    async (row) => {
      const terms = String(binding.when).split("&&").map((t) => t.trim());
      assert.ok(
        terms.includes(row.term),
        `the when clause must carry ${JSON.stringify(row.term)}, or Escape is stolen in that state; clause is ${JSON.stringify(binding.when)}`
      );
    }
  );
});

test("H. the dismissal is hidden from the command palette: invoked outside its gesture it acts on state the developer cannot see [triage D9 - and every other internal command here is already gated]", () => {
  const gated = new Set((manifest.contributes.menus?.commandPalette || []).filter((m) => m.when === "false").map((m) => m.command));
  assert.ok(
    gated.has("column80.dismissScopedGhost"),
    `column80.dismissScopedGhost must carry a commandPalette entry with when "false"; gated commands are ${JSON.stringify([...gated])}`
  );
});

// ===========================================================================
// I. The dismissal has to STICK. Dogfooding found the widget re-opening
// moments after a second Escape and handing the ghost straight back to the
// member just refused, so the gesture flickered and settled where it started.
// A dismissal is refused-at-this-state, not merely dropped-once.
// ===========================================================================

test("I. a widget that re-opens after a dismissal does not re-take the ghost: the preselect at the refused state is not sticky, so the Escape after it is unscoped [dogfood 2026-07-22 - the dismissal flickered and came back]", async () => {
  const { results } = await session([
    open(PRESELECT),
    escape(), // the scoped ghost the developer is looking at
    { dropScope: 1, request: false }, // the second Escape
    open(PRESELECT), // the widget re-opens on its own, same member, same state
    escape(),
  ], { cacheCapacity: 0 });
  assert.strictEqual(
    results[3].calls[0] && results[3].calls[0].memberPartial,
    TYPED_PARTIAL,
    `the re-opened widget at a refused state must not scope the request either: the model has to work on what the developer wants, not on the member they refused; got ${JSON.stringify(results[3].calls[0] && results[3].calls[0].memberPartial)}`
  );
  assert.strictEqual(
    servedPartial(results[4]),
    TYPED_PARTIAL,
    `after a dismissal the re-opened widget's preselect must not survive its own Escape, got ${JSON.stringify(servedPartial(results[4]))} - that is the ghost the developer just refused coming back`
  );
});

test("I. an ARROW after a dismissal overrides the refusal: the user choosing a member is never suppressed by an earlier Escape [the refusal is about the widget guessing, not about the user picking]", async () => {
  const { results } = await session([
    open(PRESELECT),
    escape(),
    { dropScope: 1, request: false },
    open(PRESELECT), // the reopen, still refused
    open(ARROWED), // and now the user arrows: a real choice
    escape(),
  ], { cacheCapacity: 0 });
  assert.strictEqual(
    servedPartial(results[5]),
    ARROWED,
    `an arrowed member after a dismissal must be sticky, got ${JSON.stringify(servedPartial(results[5]))} - a refusal that outlives a deliberate choice is worse than no refusal`
  );
});

test("I. the refusal is bound to the STATE it was taken at: the same member preselected at a different cursor is sticky as ever [a dismissal here says nothing about anywhere else]", async () => {
  const site = { char: CURSOR_END };
  const { results } = await session([
    { ...open(PRESELECT), ...site },
    { ...escape(), ...site },
    { dropScope: 1, request: false },
    // A different column: a different member site, and a state the developer
    // never refused anything at.
    { sci: selectionAt(PRESELECT, CURSOR_LINE, CURSOR_END - 1), char: CURSOR_END - 1 },
    { ...escape(), char: CURSOR_END - 1 },
  ], { cacheCapacity: 0 });
  assert.strictEqual(
    servedPartial(results[4]),
    PRESELECT,
    `a preselect at an unrefused state must still be sticky, got ${JSON.stringify(servedPartial(results[4]))}`
  );
});
