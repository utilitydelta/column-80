// BLIND CONTRACT TEST - v20 "the preselect gets a window".
//
// Written from the v20 surface document, never from the code. This file does
// not read src/vscode/completionProvider.ts, src/core/completionService.ts or
// src/core/cache.ts; esbuild resolves them at bundle time only. Every assertion
// below is either a numbered promise of the surface, one of its named
// invariants, or an externally observable property of VS Code.
//
// THESE TESTS ARE EXPECTED RED until v20 ships. Red before green. The 4th
// constructor parameter and PASSIVE_SCOPE_MS do not exist yet, so a provider
// built from today's source ignores the injected timing entirely: expect the
// window, timer and downgrade sections to fail on the CONTRACT, not on the
// build. A build failure here is a harness bug.
//
// What v20 changes, in one line: v19's `b470af7` made a passive preselect leave
// no sticky record, so Escape threw away a ghost the user was looking at. v20
// gives that record a 1500ms window instead of nothing.
//
// What each section pins:
//
//   A. SURVIVAL. A passive preselect survives Escape. The Escape request is
//      still scoped to the preselected member. (v19 served this unscoped; that
//      is the behaviour being replaced, so the v19 blind tests that assert the
//      old answer are expected to go red when this goes green.)
//   B. THE WINDOW. The clock starts at the Escape that first reads the record,
//      not at the widget opening. Inside the window: scoped. At or after the
//      deadline: unscoped, and gone for good.
//   C. NO CLOCK ON A CHOICE. An active selection (the user arrowed) has no
//      deadline at any elapsed time. arrow-Escape-Tab is untouched.
//   D. THE TIMER. A passive serve arms exactly one timer; an active serve arms
//      none. Firing it calls onExpired exactly once, drops the record, and the
//      request that follows arms nothing. No loop.
//   E. THE DOWNGRADE. The re-trigger arrives as Invoke, so the provider spends
//      a one-shot flag to make that ONE request automatic. The request after it
//      reads its own trigger kind again, so a genuine user Invoke still fans
//      out.
//   F. INVARIANTS THAT MUST NOT REGRESS. Version bump, cursor move, leaving the
//      member site, widget reopen as a fresh session, and the no-widget path.
//
// Time is driven entirely through the injected `timing` object. No sleeps, no
// real timers, no wall clock.
//
// Run: SKIP_LIVE=1 node --test test/blind-v20-preselect-window.test.cjs
// (Hermetic: a vscode stub, a stubbed extractor registry, a stubbed generate.
// No model, no network, no real VS Code.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

// ===========================================================================
// Harness. Same idiom as test/blind-v19-sticky-selection.test.cjs: alias
// `vscode` to a hand-built stub, redirect the extractor registry through an
// esbuild plugin (async API, hence the child process), require the bundle.
//
// One difference that matters: the entry re-exports the provider module as a
// NAMESPACE. A named re-export of PASSIVE_SCOPE_MS would fail the bundle while
// the constant does not exist yet, turning a contract failure into a build
// failure and taking every other test down with it.
// ===========================================================================

const TAG = ".blind-v20-preselect";
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
      const over = (globalThis.__v20Config || {});
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
  return (globalThis as any).__v20Extractor;
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

// The promised constant. Read through a namespace so its absence is a contract
// failure with a sentence, not a link error that kills the file. Everything
// else drives the window off the SAME number the provider exports, so a
// deliberate retune of 1500 moves the tests with it.
const PROMISED_MS = 1500;
const windowMs = () => {
  const v = mod.providerModule && mod.providerModule.PASSIVE_SCOPE_MS;
  return typeof v === "number" ? v : PROMISED_MS;
};

test("the passive window is a named exported constant, so a test names it instead of a magic number [surface 'Exported alongside the provider: export const PASSIVE_SCOPE_MS = 1500']", () => {
  need();
  const ns = mod.providerModule || {};
  assert.strictEqual(
    typeof ns.PASSIVE_SCOPE_MS,
    "number",
    `the provider module must export PASSIVE_SCOPE_MS as a number, got ${JSON.stringify(ns.PASSIVE_SCOPE_MS)}`
  );
  assert.strictEqual(
    ns.PASSIVE_SCOPE_MS,
    PROMISED_MS,
    `PASSIVE_SCOPE_MS must be ${PROMISED_MS}, got ${JSON.stringify(ns.PASSIVE_SCOPE_MS)}`
  );
});

// ===========================================================================
// The scenario. Receiver `s`, the user has typed `s.en`, the widget is open.
// Same worked example the v19 blind tests use, so a v19-to-v20 behaviour change
// reads as a change of answer at an identical site.
// ===========================================================================

const SOURCE = "let s: Stripe;\ns.en";
const CURSOR_LINE = 1;
const CURSOR_END = 4; // after `s.en`
const TYPED_PARTIAL = "en";
const PRESELECT = "enrollTile"; // what the widget auto-highlights
const SEPARATOR_CHAR = 1; // the dot in `s.en`

const AUTOMATIC = 1; // vscode.InlineCompletionTriggerKind.Automatic, per the stub
const INVOKE = 0; // vscode.InlineCompletionTriggerKind.Invoke

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

function makePos(line, character) {
  return {
    line,
    character,
    translate(l, c) {
      return makePos(this.line + (l || 0), this.character + (c || 0));
    },
  };
}

// ===========================================================================
// The fake clock. `now` is a number the test moves; `setTimer` records the arm
// and hands back a cancel; `fireDue` runs only the timers whose armed-at plus
// delay has actually been reached, so a test cannot fire a timer early and call
// that a passing expiry.
// ===========================================================================

function makeClock(start = 10_000) {
  const armed = [];
  let now = start;
  let expired = 0;

  const timing = {
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

  return {
    timing,
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
      };
    },
  };
}

const MARK = (p) => `[[partial=${p}]]`;

// One provider, one service, a sequence of steps. A step may move the clock,
// fire due timers, edit the document, and then issue a request. The generate
// stub echoes the memberPartial that reached it back through the ghost, so the
// scope is readable off the ITEM even when a cache answers without a second
// generate call - what matters is the partial the generation layer worked from.
async function session(steps, opts = {}) {
  const { ghost, config, omitTiming, startNow, generateMs, cacheCapacity } = opts;
  const { FimCompletionProvider, CompletionService, DEFAULT_FIM_CONFIG } = need();

  globalThis.__v20Config = config || {};
  globalThis.__v20Extractor = {
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
  const clock = makeClock(startNow);
  const service = new CompletionService(
    // A row that measures GENERATION has to turn the cache off. The
    // widget-open request and the Escape after it share one scoped prefix, so
    // the Escape is normally a cache hit and never calls the model at all -
    // which is a real and welcome property, and useless for a row whose whole
    // subject is what a slow model does to the window.
    { ...DEFAULT_FIM_CONFIG, ...(config || {}), debounceMs: 0, cacheCapacity: cacheCapacity ?? 100 },
    async () => {
      // A model that takes real time. The clock moves DURING the call and due
      // timers fire while it is in flight, which is what a real 1.5s window and
      // a real slow generation do to each other. Nothing else in this file
      // moves the clock inside a request.
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
  // The 3rd parameter (onWidgetMemberSite) stays undefined: v20 adds the 4th,
  // and a test that could not skip the 3rd would be testing the wrong thing.
  const provider = omitTiming
    ? new FimCompletionProvider(() => spy, output)
    : new FimCompletionProvider(() => spy, output, undefined, clock.timing);

  const doc = makeDoc(SOURCE);
  const results = [];

  for (const step of steps) {
    // The extension's own edit hook, wired to the provider in production. It
    // runs BEFORE the clock, because that is the real order: the edit lands,
    // then time passes, then whatever timer survived the edit fires. A step
    // names the uri it fires for, so a row can prove that another file's edit
    // leaves this file's window alone.
    if (step.docChanged !== undefined) {
      provider.onDocumentChanged(step.docChanged === true ? doc.uri.toString() : step.docChanged);
    }
    // The extension's cursor hook, same idiom: `[line, character]`, or a
    // `[uri, line, character]` triple when the row is about another file.
    if (step.cursorMoved !== undefined) {
      const m = step.cursorMoved;
      const [uri, line, character] = m.length === 3 ? m : [doc.uri.toString(), m[0], m[1]];
      provider.onCursorMoved(uri, line, character);
    }
    if (step.advanceMs) clock.advance(step.advanceMs);
    if (step.fire) clock.fireDue();
    if (step.editTo !== undefined) doc.edit(step.editTo);
    if (step.request === false) {
      results.push({ items: [], calls: [], version: doc.version, timers: clock.snapshot() });
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
    results.push({ items, calls: recorded.slice(before), version: doc.version, timers: clock.snapshot() });
  }

  service.dispose();
  globalThis.__v20Config = {};
  return { results, recorded, clock };
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

// The two shapes every scoping assertion reduces to.
const open = (member) => ({ sci: selectionAt(member) });
const escape = (extra = {}) => ({ sci: undefined, ...extra });

// ===========================================================================
// A. SURVIVAL. Promise 1. The widget auto-opens on `.`, auto-highlights its
// first member, and the developer presses Escape to get the widget out of the
// way. In v19 that Escape threw the scoped ghost away. In v20 it keeps it.
// ===========================================================================

test("A. a passive preselect survives Escape: open the widget, do NOT arrow, press Escape, and the request is still scoped to the preselected member [surface promise 1]", async () => {
  await table(
    [
      { name: "preselect `.enrollTile`, then Escape", member: "enrollTile" },
      { name: "preselect `.enqueue`, then Escape", member: "enqueue" },
      { name: "preselect `.endpoint`, then Escape", member: "endpoint" },
      { name: "preselect `.len` - a member the typed prefix does not even match", member: "len" },
    ],
    async (row) => {
      const { results } = await session([open(row.member), escape()]);
      assert.strictEqual(
        servedPartial(results[1]),
        row.member,
        `the Escape after a passive preselect must stay scoped to ${JSON.stringify(row.member)}, got ${JSON.stringify(servedPartial(results[1]))} (v19 served the unscoped typed partial ${JSON.stringify(TYPED_PARTIAL)} here; v20 replaces that)`
      );
    }
  );
});

test("A. the surviving preselect is what reaches the generation layer, not just what the item echoes: memberPartial is the preselected member's BARE name [surface 'the memberPartial reaching the generation layer is the highlighted member's BARE name']", async () => {
  const { results } = await session([open(PRESELECT), escape()]);
  const call = results[1].calls[0];
  assert.ok(call, "the Escape request never reached the service, so nothing was scoped or unscoped");
  assert.strictEqual(
    call.memberPartial,
    PRESELECT,
    `memberPartial on the Escape request must be ${JSON.stringify(PRESELECT)}, got ${JSON.stringify(call.memberPartial)}`
  );
  assert.strictEqual(call.memberSite, true, "an Escape at a member site is still a member site");
});

test("A. the surviving preselect serves an item at all: an Escape that scopes but surfaces nothing leaves the user with nothing to Tab, which is the defect v20 exists to fix [surface promise 1 'the item it serves lands that member']", async () => {
  const { results } = await session([open(PRESELECT), escape()], { ghost: () => "rollTile(tile);" });
  assert.ok(
    results[1].items.length > 0,
    "the Escape request surfaced no item at all, so there is nothing to Tab"
  );
});

// ===========================================================================
// B. THE WINDOW. Promise 2. The clock starts at the Escape that first READS the
// record, not at the widget opening. What the deadline bounds is how long an
// unchosen member holds the ghost after the user stopped interacting.
// ===========================================================================

test("B. the window boundary is inside/at/after: unselected requests before the deadline stay scoped, the first one AT or after it is unscoped to the user's own typed partial [surface promise 2 'the first one at or after the deadline is UNSCOPED']", async () => {
  const W = windowMs();
  await table(
    [
      { name: "elapsed 0ms - the same instant as the first Escape", elapsed: 0, scoped: true },
      { name: "elapsed 1ms", elapsed: 1, scoped: true },
      { name: `elapsed ${W - 1}ms - the last instant inside the window`, elapsed: W - 1, scoped: true },
      { name: `elapsed ${W}ms - exactly the deadline, which is OUTSIDE`, elapsed: W, scoped: false },
      { name: `elapsed ${W + 1}ms`, elapsed: W + 1, scoped: false },
      { name: `elapsed ${W * 10}ms - long gone`, elapsed: W * 10, scoped: false },
    ],
    async (row) => {
      const { results } = await session([open(PRESELECT), escape(), escape({ advanceMs: row.elapsed })]);
      assert.strictEqual(
        servedPartial(results[1]),
        PRESELECT,
        `harness guard: the first Escape must be scoped for the window to mean anything, got ${JSON.stringify(servedPartial(results[1]))}`
      );
      const expect = row.scoped ? PRESELECT : TYPED_PARTIAL;
      assert.strictEqual(
        servedPartial(results[2]),
        expect,
        `${row.elapsed}ms after the first Escape the request must be ${row.scoped ? "SCOPED" : "UNSCOPED"} (${JSON.stringify(expect)}), got ${JSON.stringify(servedPartial(results[2]))} - the window is ${W}ms measured from the first Escape`
      );
    }
  );
});

test("B. the clock starts at the Escape, not at the widget opening: reading the widget for ten windows and only then escaping is still scoped [goal 'The clock starts at the Escape, not at the widget opening']", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    { request: false, advanceMs: W * 10, fire: true },
    escape(),
  ]);
  assert.strictEqual(
    results[1].timers.expired,
    0,
    `no window is open while the widget still is, so onExpired must not have fired, got ${results[1].timers.expired} call(s)`
  );
  assert.strictEqual(
    servedPartial(results[2]),
    PRESELECT,
    `the user is allowed to read the widget for as long as they like: the first Escape must still be scoped to ${JSON.stringify(PRESELECT)}, got ${JSON.stringify(servedPartial(results[2]))}`
  );
});

test("B. expiry is permanent: once the deadline has passed and a request came back unscoped, a later request does not resurrect the record [surface promise 2 'Once expired the record is gone']", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ advanceMs: W }),
    escape(),
    escape(),
  ]);
  const after = results.slice(2).map(servedPartial);
  assert.deepStrictEqual(
    after,
    [TYPED_PARTIAL, TYPED_PARTIAL, TYPED_PARTIAL],
    `every request from the deadline onwards must read the typed partial ${JSON.stringify(TYPED_PARTIAL)}, got ${JSON.stringify(after)} - a scope that comes back is a scope that never expired`
  );
});

test("B. the expired request is the ordinary unscoped one, not a special case: its memberPartial and memberSite match a virgin provider that saw no widget at all [surface promise 2 'exactly as if no widget had ever opened']", async () => {
  const W = windowMs();
  const { results: controlResults } = await session([escape()]);
  const control = controlResults[0].calls[0];
  assert.ok(control, "control sanity: an unselected request must reach the service");

  const { results } = await session([open(PRESELECT), escape(), escape({ advanceMs: W })]);
  const call = results[2].calls[0];
  assert.ok(call, "the post-deadline request never reached the service");
  assert.deepStrictEqual(
    { memberPartial: call.memberPartial, memberSite: call.memberSite, memberReceiver: call.memberReceiver },
    { memberPartial: control.memberPartial, memberSite: control.memberSite, memberReceiver: control.memberReceiver },
    `after the window closes the request must be indistinguishable from one on a provider that never saw a widget, control ${JSON.stringify({ memberPartial: control.memberPartial, memberSite: control.memberSite, memberReceiver: control.memberReceiver })}`
  );
});

// ===========================================================================
// C. THE CHOICE RIDES THE SAME CLOCK. Originally "no clock on a choice"
// (v20's promise 3, the indefinite active hold). Amended under the human
// design call 2026-07-26 (`docs/architecture/vscode-layer.md`, "The member-dot
// journey, and the uniform window"): the 1.5 second window is UNIFORM -
// "Escape keeps the ghost from whatever the last one was run", preselected or
// arrowed, and the window elapsing reruns unconstrained either way.
// Arrow-Escape-Tab is untouched INSIDE the window; the indefinite hold is void.
// ===========================================================================

test("C. an arrowed choice rides the uniform window: inside it scoped, at or past the deadline unscoped [journeys/member-dot-flow.md, decided 2026-07-26]", async () => {
  const W = windowMs();
  await table(
    [
      { name: "no wait at all", elapsed: 0, scoped: true },
      { name: `${W - 1}ms, the last instant inside the window`, elapsed: W - 1, scoped: true },
      { name: `${W}ms, exactly the deadline, which is OUTSIDE`, elapsed: W, scoped: false },
      { name: `${W * 100}ms, two and a half minutes`, elapsed: W * 100, scoped: false },
    ],
    async (row) => {
      const { results } = await session([
        open(PRESELECT),
        open("enqueue"), // the arrow: a DIFFERENT member, so the session goes active
        escape(),
        escape({ advanceMs: row.elapsed }),
      ]);
      const expect = row.scoped ? "enqueue" : TYPED_PARTIAL;
      assert.strictEqual(
        servedPartial(results[3]),
        expect,
        `${row.elapsed}ms after the Escape's serve an arrowed member must be ${row.scoped ? "SCOPED" : "UNSCOPED"} (${JSON.stringify(expect)}), got ${JSON.stringify(servedPartial(results[3]))} - the window is uniform across preselects and choices`
      );
    }
  );
});

test("C. arrowing back to the first item is still a choice of THAT member, on the same uniform window [amended 2026-07-26, journeys/member-dot-flow.md; 'still has no deadline' is void]", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    open("enqueue"),
    open(PRESELECT),
    escape(),
    escape({ advanceMs: W - 1 }),
    escape({ advanceMs: 1 }),
  ]);
  assert.strictEqual(
    servedPartial(results[4]),
    PRESELECT,
    `the arrowed-back member governs inside its window, got ${JSON.stringify(servedPartial(results[4]))}`
  );
  assert.strictEqual(
    servedPartial(results[5]),
    TYPED_PARTIAL,
    `and at the deadline it reverts like any other record, got ${JSON.stringify(servedPartial(results[5]))}`
  );
});

// ===========================================================================
// D. THE TIMER. Promise 4. Nothing re-invokes the provider on a bare timeout,
// so a deadline alone would leave the scoped ghost on screen forever. The
// passive serve arms a timer; firing it drops the record and calls onExpired so
// the editor can re-render. An active serve arms nothing, and the request after
// the expiry arms nothing either, so there is no loop.
// ===========================================================================

// Amended under the human design call 2026-07-26
// (`docs/architecture/vscode-layer.md`, "The member-dot journey, and the
// uniform window"): the window is uniform, so an arrowed scope's post-close
// serve arms the same one-shot a preselect's does.
test("D. serving a scope post-close arms exactly one timer, preselected or arrowed [uniform window; formerly 'an ACTIVE serve arms none']", async () => {
  await table(
    [
      { name: "passive preselect then Escape", steps: [open(PRESELECT), escape()], pending: 1 },
      { name: "preselect, arrow to a different member, then Escape", steps: [open(PRESELECT), open("enqueue"), escape()], pending: 1 },
    ],
    async (row) => {
      const { results } = await session(row.steps);
      const timers = results[results.length - 1].timers;
      assert.strictEqual(
        timers.pending,
        row.pending,
        `expected ${row.pending} pending timer(s) after this run, got ${timers.pending} (armed ${timers.armed}, cancelled ${timers.cancelled}, delays ${JSON.stringify(timers.delays)})`
      );
      assert.strictEqual(
        timers.expired,
        0,
        `no timer has fired yet, so onExpired must not have been called, got ${timers.expired}`
      );
    }
  );
});

test("D. a second in-window passive serve does not stack timers: at most one is ever pending, because a re-arm without a cancel is a leak and a second onExpired [surface promise 4 'a one-shot timer']", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ advanceMs: Math.floor(W / 3) }),
    escape({ advanceMs: Math.floor(W / 3) }),
  ]);
  for (let i = 1; i < results.length; i += 1) {
    const t = results[i].timers;
    assert.ok(
      t.pending <= 1,
      `after request ${i + 1} there were ${t.pending} pending timers; only one window is open at a time (armed ${t.armed}, cancelled ${t.cancelled})`
    );
  }
});

test("D. the armed timer fires onExpired exactly once and does not fire again on a later sweep [surface promise 4 'calls timing.onExpired() exactly once']", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    escape(),
    { request: false, advanceMs: W, fire: true },
    { request: false, advanceMs: W * 5, fire: true },
  ]);
  assert.strictEqual(
    results[2].timers.expired,
    1,
    `firing the due timer must call onExpired exactly once, got ${results[2].timers.expired} (armed ${results[2].timers.armed}, delays ${JSON.stringify(results[2].timers.delays)})`
  );
  assert.strictEqual(
    results[3].timers.expired,
    1,
    `a second sweep must not re-fire a one-shot timer, onExpired total is now ${results[3].timers.expired}`
  );
});

// Retitled and tightened by the implementer under triage D2. The original name
// claimed a "remaining window", which nothing in the contract or the code ever
// computes: the timer is armed once, for the FULL window, on the same request
// that stamps the deadline. The old assertion was the interval (0, W], which a
// 1ms timer would have satisfied. Strictly stronger than what it replaced.
test("D. the armed delay is the FULL window, because the timer is armed on the same request that stamps the deadline [surface promise 4 'a one-shot timer is armed']", async () => {
  const W = windowMs();
  const { results } = await session([open(PRESELECT), escape()]);
  const delays = results[1].timers.delays;
  assert.ok(delays.length > 0, `no timer was armed at all when a passive scope was served, so the ghost would sit on screen forever`);
  assert.deepStrictEqual(
    delays,
    [W],
    `exactly one timer must be armed, for the full ${W}ms window, got ${JSON.stringify(delays)}`
  );
});

// Added by the implementer under triage D1. The surface promises that a
// document edit kills the record outright; the TIMER does not go through a
// request, so without an edit hook it survives the edit and re-renders against
// a state that is gone. Accepting a widget item is such an edit, so this is a
// first-class gesture rather than a corner.
// Added by the implementer under triage D5. The edit half of the invariant is
// the test below; this is the cursor half. A cursor move provokes no request at
// all, so nothing else would ever tell the provider the site it holds is behind
// the user, and the timer would re-render wherever they navigated to.
test("D. a cursor move kills the pending timer: the record is gone and nothing fires at the site the user left [surface invariant 'A document edit (version bump) or a cursor move kills the sticky record outright, passive or active']", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ cursorMoved: [CURSOR_LINE, CURSOR_END + 6], advanceMs: W * 4, fire: true, request: false }),
    escape(),
  ]);
  assert.strictEqual(results[1].timers.pending, 1, "a passive Escape must arm the window before the cursor move can cancel it");
  assert.strictEqual(
    results[2].timers.expired,
    0,
    `a cursor move must cancel the window: onExpired fired ${results[2].timers.expired} times, so the editor was asked to re-render at a site the user had already left`
  );
  assert.strictEqual(results[2].timers.pending, 0, `the timer must be cancelled, not merely ignored: ${results[2].timers.pending} still pending`);
  assert.strictEqual(
    servedPartial(results[3]),
    TYPED_PARTIAL,
    `after the move the scope is gone, so a request back at the original state is unscoped, got ${JSON.stringify(servedPartial(results[3]))}`
  );
});

test("D. a cursor event at the record's OWN position is not a move: arrowing the widget moves no cursor and the Escape lands at the position the record was taken at [surface - only a DIFFERENT state kills the record]", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ cursorMoved: [CURSOR_LINE, CURSOR_END] }),
    escape({ advanceMs: W, fire: true, request: false }),
  ]);
  assert.strictEqual(
    servedPartial(results[2]),
    PRESELECT,
    `a same-position cursor event must leave the window intact, got ${JSON.stringify(servedPartial(results[2]))} - an unconditional drop here deletes the feature`
  );
  assert.strictEqual(
    results[3].timers.expired,
    1,
    `and the window still closes on schedule: onExpired fired ${results[3].timers.expired} times at the deadline, expected 1`
  );
});

test("D. a cursor move in ANOTHER file is not a cursor move: the selection-change event fires for every visible editor, and a background one must not kill the scope in the file being typed in [triage D12]", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ cursorMoved: ["file:///elsewhere.ts", 9, 9] }),
    escape({ advanceMs: W, fire: true, request: false }),
  ]);
  assert.strictEqual(
    servedPartial(results[2]),
    PRESELECT,
    `a cursor move in another editor must leave this scope alone, got ${JSON.stringify(servedPartial(results[2]))}`
  );
  assert.strictEqual(
    results[3].timers.expired,
    1,
    `and the window still closes on its own schedule: onExpired fired ${results[3].timers.expired} times, expected 1`
  );
});

test("D. a cursor move kills an ACTIVE record too: the invariant is unconditional, and a fix written passive-only would leave the user's own choice behind at a site they have left [surface invariant 'passive or active']", async () => {
  const { results } = await session([
    open(PRESELECT),
    open("endpoint"), // the arrow: this session is now active, no deadline
    escape(),
    escape({ cursorMoved: [CURSOR_LINE, CURSOR_END + 6] }),
    escape(),
  ]);
  assert.strictEqual(servedPartial(results[2]), "endpoint", "control: the arrowed member is sticky at the Escape");
  assert.strictEqual(
    servedPartial(results[4]),
    TYPED_PARTIAL,
    `after a cursor move the active record must be gone too, got ${JSON.stringify(servedPartial(results[4]))}`
  );
});

test("D. an edit in the record's own file kills the pending timer too: no onExpired, no re-render, nothing left to fire [surface invariant 'A document edit (version bump) or a cursor move kills the sticky record outright' - the edit half]", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    escape(),
    // The edit hook alone, with no request behind it: this is the state the
    // user is in between accepting an item and the editor asking for anything.
    escape({ docChanged: true, advanceMs: W * 4, fire: true, request: false }),
    escape(),
  ]);
  assert.strictEqual(results[1].timers.pending, 1, "a passive Escape must arm the window before the edit can cancel it");
  assert.strictEqual(
    results[2].timers.expired,
    0,
    `an edit in the record's own file must cancel the window: onExpired fired ${results[2].timers.expired} times, so the editor was asked to re-render for a record the edit had already killed`
  );
  assert.strictEqual(
    results[2].timers.pending,
    0,
    `the timer must be cancelled by the edit, not merely ignored when it fires: ${results[2].timers.pending} still pending`
  );
  assert.strictEqual(
    servedPartial(results[3]),
    TYPED_PARTIAL,
    `after the edit the scope is gone, so the next request is the ordinary unscoped one, got ${JSON.stringify(servedPartial(results[3]))}`
  );
});

// Added by the implementer under triage D4. The window is time the developer
// spends looking at a ghost, so it cannot start before the ghost exists. A
// clock started when the REQUEST starts is spent on generation instead, and on
// slow hardware it can be spent entirely: the timer fires inside the Escape's
// own model call and the feature delivers nothing.
test("D. the window starts when the item is RETURNED, not when the request starts: generation inside the window does not eat it [surface promise 2 'the clock starts at that first unselected request' - and the request is not over until it serves]", async () => {
  const W = windowMs();
  const G = 1200;
  // Escape, with the model taking 1200ms of the 1500ms window.
  const { results } = await session(
    [open(PRESELECT), escape(), escape({ advanceMs: W - 1, fire: true }), escape({ advanceMs: 1, fire: true, request: false })],
    { generateMs: G, cacheCapacity: 0 },
  );
  assert.strictEqual(
    servedPartial(results[1]),
    PRESELECT,
    `the Escape must serve the preselected member even when generation took ${G}ms, got ${JSON.stringify(servedPartial(results[1]))}`
  );
  assert.deepStrictEqual(
    results[1].timers.delays,
    [W],
    `exactly one timer, for the full window, armed at the serve; got ${JSON.stringify(results[1].timers.delays)}`
  );
  assert.strictEqual(
    servedPartial(results[2]),
    PRESELECT,
    `one millisecond short of the deadline MEASURED FROM THE SERVE, the scope must still hold; got ${JSON.stringify(servedPartial(results[2]))} (a clock started at the request would have expired ${G}ms ago)`
  );
  assert.strictEqual(
    results[3].timers.expired,
    1,
    `at the deadline measured from the serve, onExpired must have fired exactly once, got ${results[3].timers.expired}`
  );
});

test("D. a generation LONGER than the window still delivers the ghost: the timer cannot fire inside the model call that produced it [surface promise 1 - the Escape serves the preselected member]", async () => {
  const W = windowMs();
  const { results } = await session([open(PRESELECT), escape()], { generateMs: W + 300, cacheCapacity: 0 });
  assert.strictEqual(
    servedPartial(results[1]),
    PRESELECT,
    `a generation of ${W + 300}ms must still serve the scoped ghost, got ${JSON.stringify(servedPartial(results[1]))}`
  );
  assert.strictEqual(
    results[1].timers.expired,
    0,
    `the window cannot have closed before the ghost it measures was on screen: onExpired fired ${results[1].timers.expired} times by the time the item was returned`
  );
});

// Rewritten under TRIAGE authority 2026-07-26, triage-p1.md, goal.md
// amendment: the scoped attempt gets its one post-close serve. This
// supersedes both the original row ("a request that serves NOTHING opens no
// window", which pinned the wedge) and the implementer's 2026-07-26 rewrite
// (drop at the first post-close REQUEST, which review-p1.md proved forecloses
// the v20 window for snippet members - the go tier's CONTROL row caught it
// live). The ratified shape: the Escape request stays scoped and gets its one
// serve; when that serve yields zero, the record drops THERE and the machine
// actively requests the unscoped re-render, whose request goes out unscoped
// and serves. No window timer ever arms in this class.
test("D. a never-served record's post-close attempt stays scoped; its zero serve drops the record, requests the hand-back re-render, and never arms a window [goal.md triage amendment 2026-07-26]", async () => {
  // A ghost naming a sibling of the scoped member is refused by the landed-name
  // guard, open or closed, so this record can never serve.
  const { results } = await session([open(PRESELECT), escape(), escape()], {
    ghost: () => "Tally(a, b)",
    cacheCapacity: 0,
  });
  assert.strictEqual(results[0].items.length, 0, "harness guard: the widget-open ghost must be refused, so the record never serves");
  const attempt = results[1].calls[0];
  assert.ok(attempt, "the Escape request never reached the service");
  assert.strictEqual(
    attempt.memberPartial,
    PRESELECT,
    `the post-close attempt keeps the scope (${JSON.stringify(PRESELECT)}), got ${JSON.stringify(attempt.memberPartial)} - dropping before the attempt deletes the v20 window for every snippet member`
  );
  assert.strictEqual(results[1].items.length, 0, "the attempt's serve is zero: everything was refused under the scope");
  assert.strictEqual(
    results[1].timers.expired,
    1,
    `the zero serve must actively request the unscoped re-render (onExpired), got ${results[1].timers.expired} call(s) - nothing else re-invokes the provider, so a silent drop is the wedge back again`
  );
  const rerendered = results[2].calls[0];
  assert.ok(rerendered, "the re-render request never reached the service");
  assert.strictEqual(
    rerendered.memberPartial,
    TYPED_PARTIAL,
    `the re-render goes out unscoped to ${JSON.stringify(TYPED_PARTIAL)}, got ${JSON.stringify(rerendered.memberPartial)}`
  );
  assert.ok(results[2].items.length > 0, "and serves the unscoped completion - the hand-back");
  assert.strictEqual(
    results[2].timers.armed,
    0,
    `no window may ever arm for a record that never served: ${results[2].timers.armed} timer(s) armed`
  );
});

// Added by the implementer under triage D6. Every pre-existing row issues ONE
// in-window serve, so a re-arming implementation and a sliding-window
// implementation both passed. These two issue more than one.
test("D. the window is FIXED, not re-armed: a second serve inside it arms no second timer and moves no deadline [surface promise 4 'a one-shot timer']", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ advanceMs: Math.floor(W / 2) }),
    escape({ advanceMs: W, fire: true, request: false }),
  ]);
  assert.strictEqual(
    servedPartial(results[2]),
    PRESELECT,
    `half a window in, the scope must still hold, got ${JSON.stringify(servedPartial(results[2]))}`
  );
  // CUMULATIVE across the whole run, not the snapshot after the first Escape:
  // a per-serve re-arm is invisible in the snapshot and shows up only here.
  assert.strictEqual(
    results[3].timers.armed,
    1,
    `one window means one timer for the whole run, got ${results[3].timers.armed} armed with delays ${JSON.stringify(results[3].timers.delays)}`
  );
  assert.strictEqual(
    results[3].timers.expired,
    1,
    `and it closes exactly once, got ${results[3].timers.expired}`
  );
});

test("D. the deadline is FIXED, not sliding: serving inside the window does not push it out, so a busy site still reverts on schedule [surface promise 2 - the clock starts at the Escape, once]", async () => {
  const W = windowMs();
  // The timer is never fired here on purpose: the READ path is what expires the
  // record, so this measures the deadline itself rather than the timer.
  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ advanceMs: Math.floor((2 * W) / 3) }),
    escape({ advanceMs: Math.floor(W / 3) + 1 }),
  ]);
  assert.deepStrictEqual(
    [servedPartial(results[1]), servedPartial(results[2]), servedPartial(results[3])],
    [PRESELECT, PRESELECT, TYPED_PARTIAL],
    "two serves inside the window then one past it: a re-stamped deadline would keep the third scoped, which is the revert never happening for a developer who keeps requesting"
  );
});

test("D. an edit in ANOTHER file leaves the window alone: the hook is keyed on the record's own uri, not on any edit anywhere [surface invariant - only the record's own state kills it]", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ docChanged: "file:///elsewhere.ts" }),
    escape({ advanceMs: W, fire: true, request: false }),
  ]);
  assert.strictEqual(
    servedPartial(results[2]),
    PRESELECT,
    `another file's edit must not touch this window: expected the scope to hold, got ${JSON.stringify(servedPartial(results[2]))}`
  );
  assert.strictEqual(
    results[3].timers.expired,
    1,
    `another file's edit must not cancel this window either: onExpired fired ${results[3].timers.expired} times at the deadline, expected 1`
  );
});

test("D. when the timer fires the record is DROPPED and the request that follows arms nothing: no loop [surface promise 4 'it must not arm again off the request that follows the expiry']", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ advanceMs: W, fire: true, triggerKind: INVOKE }),
    escape(),
  ]);
  assert.strictEqual(
    results[2].timers.expired,
    1,
    `the re-render request should follow exactly one onExpired, got ${results[2].timers.expired}`
  );
  assert.strictEqual(
    servedPartial(results[2]),
    TYPED_PARTIAL,
    `the re-triggered request is the unscoped one that swaps the ghost, expected ${JSON.stringify(TYPED_PARTIAL)}, got ${JSON.stringify(servedPartial(results[2]))}`
  );
  assert.strictEqual(
    results[2].timers.pending,
    0,
    `the request after the expiry must arm no timer or the provider loops forever, got ${results[2].timers.pending} pending`
  );
  assert.strictEqual(
    results[3].timers.pending,
    0,
    `and the one after that must arm nothing either, got ${results[3].timers.pending} pending`
  );
  assert.strictEqual(
    results[3].timers.expired,
    1,
    `onExpired must stay at one call for the whole run, got ${results[3].timers.expired}`
  );
});

// Amended under the human design call 2026-07-26
// (`docs/architecture/vscode-layer.md`, "The member-dot journey, and the
// uniform window"): an arrowed scope expires by timer exactly like a preselect
// - one onExpired, then the unscoped revert. The original row ("never expires
// by timer") pinned the void indefinite hold.
test("D. an arrowed scope expires by timer like any other: one onExpired at the deadline, and the request after it is unscoped [uniform window]", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    open("enqueue"),
    escape(),
    { request: false, advanceMs: W * 10, fire: true },
    escape(),
  ]);
  assert.strictEqual(
    results[3].timers.expired,
    1,
    `the arrowed scope's window closes by timer exactly once, got ${results[3].timers.expired} call(s)`
  );
  assert.strictEqual(
    servedPartial(results[4]),
    TYPED_PARTIAL,
    `and the request after the expiry is the unscoped revert, got ${JSON.stringify(servedPartial(results[4]))}`
  );
});

test("D. omitting the timing parameter leaves production behaviour intact: the provider still constructs, still scopes a passive Escape, and never touches the test clock [surface 'Omitting timing must leave production behaviour intact']", async () => {
  const { results } = await session([open(PRESELECT), escape()], { omitTiming: true });
  assert.strictEqual(
    servedPartial(results[1]),
    PRESELECT,
    `with default timing the passive Escape must still be scoped to ${JSON.stringify(PRESELECT)}, got ${JSON.stringify(servedPartial(results[1]))}`
  );
  assert.strictEqual(results[1].timers.expired, 0, "the injected clock was not supplied, so it must see nothing");
  assert.strictEqual(results[1].timers.armed, 0, "the injected clock was not supplied, so it must see nothing");
});

// ===========================================================================
// E. THE DOWNGRADE. Promise 5. `editor.action.inlineSuggest.trigger` arrives as
// InlineCompletionTriggerKind.Invoke, which the service reads as manual:
// debounce bypassed, alternatives fanned out. The provider spends a one-shot
// flag on the next request so the re-render costs one generation, not three.
// The flag is one-shot, so a genuine user Invoke right after still fans out.
// ===========================================================================

// The two fields the surface names on the request the service sees.
const dispatch = (call) => ({ manual: call && call.manual, alternatives: call && call.alternatives });

test("E. after onExpired the next request is treated as automatic even when it arrives as Invoke: the service sees the same dispatch shape as an ordinary automatic request [surface promise 5 'manual false and no alternatives']", async () => {
  const W = windowMs();
  const { results: base } = await session([escape({ triggerKind: AUTOMATIC })]);
  const control = dispatch(base[0].calls[0]);
  assert.ok(base[0].calls[0], "control sanity: an automatic request must reach the service");

  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ advanceMs: W, fire: true, triggerKind: INVOKE }),
  ]);
  const call = results[2].calls[0];
  assert.ok(call, "the re-triggered request never reached the service");
  assert.strictEqual(results[2].timers.expired, 1, "harness guard: the downgrade only applies after onExpired fired");
  assert.notStrictEqual(
    call.manual,
    true,
    `the request following onExpired must be downgraded to automatic, but the service saw manual=${JSON.stringify(call.manual)}`
  );
  assert.deepStrictEqual(
    dispatch(call),
    control,
    `the re-triggered Invoke must reach the service looking exactly like an automatic request ${JSON.stringify(control)}, got ${JSON.stringify(dispatch(call))} - otherwise the re-render costs a full alternatives fan-out`
  );
});

test("E. the downgrade flag is ONE-SHOT: the request after the downgraded one reads its own trigger kind, so a genuine user Invoke still fans out [surface promise 5 'the request after that reads its own trigger kind normally']", async () => {
  const W = windowMs();
  const { results: base } = await session([escape({ triggerKind: INVOKE })]);
  const genuine = dispatch(base[0].calls[0]);
  assert.strictEqual(
    genuine.manual,
    true,
    `control sanity: an Invoke on a virgin provider must reach the service as manual, got ${JSON.stringify(genuine)}`
  );

  const { results } = await session([
    open(PRESELECT),
    escape(),
    escape({ advanceMs: W, fire: true, triggerKind: INVOKE }), // the re-render, downgraded
    escape({ triggerKind: INVOKE }), // the user hitting the manual-trigger key
  ]);
  const call = results[3].calls[0];
  assert.ok(call, "the second Invoke never reached the service");
  assert.deepStrictEqual(
    dispatch(call),
    genuine,
    `the flag is consumed by ONE request: the next Invoke must dispatch like a genuine user invoke ${JSON.stringify(genuine)}, got ${JSON.stringify(dispatch(call))}`
  );
});

test("E. the downgrade is not armed before it is needed: an Invoke that arrives with no expiry behind it is manual, so the flag cannot be a permanent mute [surface promise 5 - the flag is set when the re-trigger fires, not at construction]", async () => {
  const { results } = await session([open(PRESELECT), escape({ triggerKind: INVOKE })]);
  const call = results[1].calls[0];
  assert.ok(call, "the Escape request never reached the service");
  assert.strictEqual(
    call.manual,
    true,
    `no onExpired has fired, so this Invoke must stay manual, got manual=${JSON.stringify(call.manual)}`
  );
});

// ===========================================================================
// F. INVARIANTS THAT MUST NOT REGRESS. Everything v19 already paid for. If this
// section is the only thing red, v20 was bought by breaking what worked.
// ===========================================================================

async function control(step) {
  const { results } = await session([step]);
  return servedPartial(results[0]);
}

test("F. a document edit kills the record outright, passive or active, before any deadline is consulted [surface invariant 'A document edit (version bump) ... kills the sticky record outright']", async () => {
  const baseline = await control(escape({ editTo: SOURCE }));
  assert.strictEqual(baseline, TYPED_PARTIAL, `control sanity: an unscoped request reads the typed partial, got ${JSON.stringify(baseline)}`);

  await table(
    [
      { name: "PASSIVE record, killed well inside its window", steps: [open(PRESELECT), escape()] },
      { name: "ACTIVE record, which has no window at all", steps: [open(PRESELECT), open("enqueue"), escape()] },
    ],
    async (row) => {
      const { results } = await session([...row.steps, escape({ editTo: SOURCE })]);
      const last = results[results.length - 1];
      assert.strictEqual(
        servedPartial(last),
        baseline,
        `after a version bump the request must be unscoped (${JSON.stringify(baseline)}), got ${JSON.stringify(servedPartial(last))} - a scope that survives an edit puts a stale member into fresh text`
      );
      assert.notStrictEqual(last.version, results[results.length - 2].version, "harness guard: the edit must actually have bumped the version");
    }
  );
});

test("F. an edit that changes the typed text re-derives the partial from the document, not from the dead record [surface invariant - the new text governs]", async () => {
  const { results } = await session([open(PRESELECT), escape(), escape({ editTo: "let s: Stripe;\ns.le" })]);
  assert.strictEqual(
    servedPartial(results[2]),
    "le",
    `after typing on, the partial must come from the buffer, got ${JSON.stringify(servedPartial(results[2]))}`
  );
});

test("F. a cursor move kills the record outright, passive or active [surface invariant 'or a cursor move kills the sticky record outright']", async () => {
  await table(
    [
      { name: "passive, cursor back one character to `s.e`", steps: [open(PRESELECT), escape()], char: 3, expect: "e" },
      { name: "passive, cursor back two characters to `s.`", steps: [open(PRESELECT), escape()], char: 2, expect: "" },
      { name: "active, cursor back one character to `s.e`", steps: [open(PRESELECT), open("enqueue"), escape()], char: 3, expect: "e" },
    ],
    async (row) => {
      const baseline = await control(escape({ char: row.char }));
      assert.strictEqual(baseline, row.expect, `control sanity at char ${row.char}: expected ${JSON.stringify(row.expect)}, got ${JSON.stringify(baseline)}`);

      const { results } = await session([...row.steps, escape({ char: row.char })]);
      const last = results[results.length - 1];
      assert.strictEqual(
        servedPartial(last),
        baseline,
        `moving the cursor must drop the record (expected ${JSON.stringify(baseline)}), got ${JSON.stringify(servedPartial(last))}`
      );
    }
  );
});

test("F. leaving the member site clears everything: a request at a non-member site drops the record, and coming back does not restore it [surface invariant 'Leaving the member site ... clears everything']", async () => {
  await table(
    [
      { name: "passive record", steps: [open(PRESELECT), escape()] },
      { name: "active record", steps: [open(PRESELECT), open("enqueue"), escape()] },
    ],
    async (row) => {
      const { results } = await session([
        ...row.steps,
        // `let s: Stripe;` is line 0, and character 14 is its end. No member site.
        escape({ line: 0, char: 14 }),
        escape(),
      ]);
      const away = results[results.length - 2].calls[0];
      assert.ok(away, "the non-member-site request never reached the service");
      assert.strictEqual(away.memberSite, false, "harness guard: `let s: Stripe;` is not a member site");
      assert.strictEqual(
        servedPartial(results[results.length - 1]),
        TYPED_PARTIAL,
        `after leaving the member site the record is gone, so the return request must be unscoped to ${JSON.stringify(TYPED_PARTIAL)}, got ${JSON.stringify(servedPartial(results[results.length - 1]))}`
      );
    }
  );
});

test("F. a REOPENED widget is a fresh session with a fresh window: the second Escape's clock restarts, so a passive scope survives past the first session's deadline [surface invariant 'a FRESH session ... gets a fresh window']", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    escape(), // session 1's clock starts here
    { request: false, advanceMs: W - 1 },
    open(PRESELECT), // the widget reopens at the same untouched state
    escape(), // session 2's clock starts here
    escape({ advanceMs: W - 1 }), // W*2-2 after the first Escape, but only W-1 after the second
  ]);
  assert.strictEqual(
    servedPartial(results[5]),
    PRESELECT,
    `the reopened widget gets its OWN window, so this request is ${W - 1}ms into it and must be scoped to ${JSON.stringify(PRESELECT)}, got ${JSON.stringify(servedPartial(results[5]))}`
  );
});

test("F. a REOPENED widget does not inherit the previous session's ACTIVE flag: its auto-highlight is passive again and expires on schedule [surface invariant 'rather than inheriting the previous session's active flag']", async () => {
  const W = windowMs();
  const { results } = await session([
    open(PRESELECT),
    open("enqueue"), // session 1 goes ACTIVE
    escape(),
    open("enqueue"), // the widget reopens; this first highlight is PASSIVE again
    escape(),
    escape({ advanceMs: W }),
  ]);
  assert.strictEqual(
    servedPartial(results[4]),
    "enqueue",
    `harness guard: the reopened session's Escape is scoped inside its window, got ${JSON.stringify(servedPartial(results[4]))}`
  );
  assert.strictEqual(
    servedPartial(results[5]),
    TYPED_PARTIAL,
    `the reopened session is passive, so ${W}ms after its Escape the record is gone and the request reads ${JSON.stringify(TYPED_PARTIAL)}, got ${JSON.stringify(servedPartial(results[5]))} - inheriting the old active flag would keep it scoped forever`
  );
});

test("F. with no widget ever involved nothing changes: no timers armed, no onExpired, no scoping, at every position [surface invariant 'With no widget ever involved, behaviour is unchanged'] (regression net)", async () => {
  await table(
    [
      { name: "`s.en` - two characters typed", char: 4, expect: "en" },
      { name: "`s.e` - one character typed", char: 3, expect: "e" },
      { name: "`s.` - nothing typed after the separator", char: 2, expect: "" },
    ],
    async (row) => {
      const W = windowMs();
      const { results } = await session([
        escape({ char: row.char }),
        escape({ char: row.char, advanceMs: W * 3, fire: true }),
        escape({ char: row.char }),
      ]);
      const got = results.map(servedPartial);
      assert.deepStrictEqual(
        got,
        [row.expect, row.expect, row.expect],
        `no request may become scoped without a widget ever having opened, got ${JSON.stringify(got)}`
      );
      const timers = results[2].timers;
      assert.strictEqual(timers.armed, 0, `no widget means no timer, got ${timers.armed} armed (delays ${JSON.stringify(timers.delays)})`);
      assert.strictEqual(timers.expired, 0, `no widget means no onExpired, got ${timers.expired} call(s)`);
      const call = results[0].calls[0];
      assert.ok(call, "the provider never reached the service");
      assert.strictEqual(call.memberSite, true, "still a member site");
      assert.strictEqual(call.memberReceiver, "s", "the receiver is still parsed and threaded, unchanged");
    }
  );
});

test("F. the open-widget ghost is still scoped to the highlight either way: while the widget is open the item carries the widget range and extends the widget text [surface invariant 'The open-widget ghost is still scoped to the highlight' - VS Code's augmentation rule] (regression net)", async () => {
  await table(
    [
      { name: "`.enrollTile` highlighted", member: "enrollTile" },
      { name: "`.enqueue` highlighted", member: "enqueue" },
      { name: "`.len` highlighted", member: "len" },
    ],
    async (row) => {
      const sci = selectionAt(row.member);
      const { results } = await session([{ sci }], { ghost: () => `${row.member}(tile);` });
      const item = results[0].items[0];
      assert.ok(item, "no item was returned at all, so there is nothing for VS Code to draw");
      const r = item.range;
      assert.deepStrictEqual(
        r && { startLine: r.start.line, startChar: r.start.character, endLine: r.end.line, endChar: r.end.character },
        { startLine: sci.range.start.line, startChar: sci.range.start.character, endLine: sci.range.end.line, endChar: sci.range.end.character },
        `an item served while the widget is open must carry the widget range or VS Code drops it silently`
      );
      assert.ok(
        String(item.insertText).startsWith(sci.text),
        `insertText must extend the widget text ${JSON.stringify(sci.text)}, got ${JSON.stringify(String(item.insertText))}`
      );
    }
  );
});
