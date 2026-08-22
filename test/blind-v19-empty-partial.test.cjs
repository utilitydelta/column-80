// BLIND CONTRACT TEST - v19 phase 3 "empty-partial anchoring".
//
// Written from the phase-3 brief, never from the code. This file does
// not read src/vscode/completionProvider.ts, src/core/completionService.ts,
// src/core/cache.ts or src/core/fimInject.ts; esbuild resolves them at bundle
// time only. Every assertion below is either a promise of the phase or an
// externally observable property of VS Code.
//
// THESE TESTS ARE EXPECTED RED until the phase ships. Red before green.
//
// The site under test is the one phase 1 never covered: the user has typed a
// separator and NOTHING else. `s.` or `s::`. The widget is open, a member is
// highlighted, and there is no common prefix between what the user typed and
// what the widget offers - so nothing VS Code can strip to make a
// cursor-anchored item line up with a widget range that starts back at the
// separator.
//
// What each section pins:
//
//   A. RENDERABILITY. With a selection at an EMPTY partial, the item VS Code
//      receives is one it will actually draw: range identical to
//      selectedCompletionInfo.range, insertText starting with
//      selectedCompletionInfo.text verbatim. An item failing either is dropped
//      silently, which on screen is indistinguishable from no feature at all.
//   B. ESCAPE THEN TAB. The sticky scope survives Escape at an empty partial,
//      and what lands carries the whole member name plus its arguments -
//      because the buffer still reads `s.` and has no prefix to build on.
//   C0. THE SCOPING PREMISE. Generation under a widget selection is scoped:
//      the prompt the model is handed already ends with the highlighted member
//      name. Measured, not assumed, because it is what decides which model
//      outputs count as well behaved at an empty partial - the clean output
//      here is the ARGUMENTS ALONE, and a ghost that re-spells the member name
//      is the model contradicting its own prompt.
//   C. NON-CORRUPTION. The three shapes the brief names - doubled separator,
//      mixed separator run, receiver-deleting item - each name the right member
//      and still wreck the line. An item that does not leave the receiver and
//      exactly ONE separator intact must not be served.
//   D. REGRESSION. The non-empty partial `s.en` that phase 1 already proved
//      keeps behaving as it does. This phase cannot be bought by breaking that.
//
// Run: SKIP_LIVE=1 node --test test/blind-v19-empty-partial.test.cjs
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
// One difference: the stub's configuration reads a global, so a test can flip
// the member gate on. Section C is a SUPPRESSION contract, and a suppression
// cannot be measured with the thing that suppresses turned off.
// ===========================================================================

const TAG = ".blind-v19-empty";
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
    getConfiguration: () => ({ get: (k, d) => {
      const over = (globalThis.__v19Config || {});
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

// ===========================================================================
// The scenario. Receiver `s`, the user has typed the separator and stopped.
// The widget highlights a member. Two separator kinds, same shape.
// ===========================================================================

const HIGHLIGHTED = "enrollTile";
const ARGS = "(tile);";

const MEMBERS = [
  { name: "enrollTile", signature: "enrollTile(Tile) : bool", kind: "method" },
  { name: "enqueue", signature: "enqueue(Job) : void", kind: "method" },
  { name: "endpoint", signature: "endpoint() : string", kind: "method" },
  { name: "len", signature: "len() : int", kind: "method" },
];

// `s.` and `s::` are both `s` plus a separator, so the separator always starts
// at character 1 and the cursor sits at 1 + separator.length.
const SITES = [
  { sep: ".", label: "`.` separator, buffer reads `s.`" },
  { sep: "::", label: "`::` separator, buffer reads `s::`" },
];

const siteOf = (sep, partial = "") => ({
  sep,
  partial,
  line: `s${sep}${partial}`,
  source: `let s: Stripe;\ns${sep}${partial}`,
  sepChar: 1,
  cursorChar: 1 + sep.length + partial.length,
});

const selectionAt = (site, member = HIGHLIGHTED) => ({
  text: `${site.sep}${member}`,
  range: {
    start: { line: 1, character: site.sepChar },
    end: { line: 1, character: site.cursorChar },
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

// The line the buffer would read once VS Code applies this item. That is the
// only thing the user sees, and the only honest place to judge corruption:
// which range the provider chose and which text it paired with the range are
// implementation, the resulting line is the contract.
function landedLine(site, item) {
  const text = String(item.insertText);
  const r = item.range;
  const from = r && r.start ? r.start.character : site.cursorChar;
  const to = r && r.end ? r.end.character : site.cursorChar;
  return site.line.slice(0, from) + text + site.line.slice(to);
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
      return {
        text: lines[n] ?? "",
        range: { start: { line: n, character: 0 }, end: { line: n, character: len } },
      };
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

const MARK = (p) => `[[partial=${p}]]`;

// The v20 passive window, in ms. Named `PASSIVE_SCOPE_MS` on the provider
// module; spelled out here because this file's entry re-exports named symbols
// and a constant that does not exist yet would fail the bundle, taking every
// test in the file down with a build error instead of a contract failure.
const PASSIVE_WINDOW_MS = 1500;

// A fake clock for the 4th constructor parameter. Only `now` has to move: the
// scope-or-no-scope decision is taken when the request arrives, so an
// unselected request issued past the deadline reads unscoped without any timer
// firing. The armed timer, its `onExpired` callback and the re-trigger
// downgrade are pinned in test/blind-v20-preselect-window.test.cjs, which
// drives the same injected object. Nothing here sleeps.
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

// One provider, one service, a sequence of requests. `ghost` is the RAW model
// output; the provider owns everything that happens to it afterwards, which is
// exactly what these tests are judging. With no ghost supplied the stub echoes
// the memberPartial that reached it, so the scope is readable off the item even
// when a cache answers without a second generate call.
// A `clock` may be supplied to drive the v20 passive window; omitting it builds
// the provider exactly as before, on the real clock.
async function session(site, steps, { ghost, config, clock } = {}) {
  const { FimCompletionProvider, CompletionService, DEFAULT_FIM_CONFIG } = need();

  globalThis.__v19Config = config || {};
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
  // The generation request as the model layer receives it. Section C's whole
  // disposition rests on what `prefix` ends with here, so it is observed rather
  // than assumed.
  const genRequests = [];
  const service = new CompletionService(
    { ...DEFAULT_FIM_CONFIG, ...(config || {}), debounceMs: 0, cacheCapacity: 100 },
    async (req) => {
      genRequests.push(req);
      return {
        text: ghost ? ghost(recorded[recorded.length - 1]) : MARK(lastPartial(recorded)),
        ttftMs: 1,
        totalMs: 2,
      };
    },
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
  const doc = makeDoc(site.source);
  const results = [];

  for (const step of steps) {
    if (step.advanceMs && clock) clock.advance(step.advanceMs);
    const position = makePos(1, step.char ?? site.cursorChar);
    const before = recorded.length;
    const raw = await provider.provideInlineCompletionItems(
      doc,
      position,
      { triggerKind: step.triggerKind ?? 0, selectedCompletionInfo: step.sci },
      { onCancellationRequested: () => {}, isCancellationRequested: false }
    );
    const items = Array.isArray(raw) ? raw : (raw && raw.items) || [];
    results.push({ items, calls: recorded.slice(before), version: doc.version });
  }

  service.dispose();
  globalThis.__v19Config = {};
  return { results, recorded, genRequests };
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

// ===========================================================================
// A. RENDERABILITY AT AN EMPTY PARTIAL. Promise 1 of the brief. VS Code draws
// an inline item only when its range matches the widget's range AND its
// insertText starts with the widget's text verbatim. At an empty partial there
// is no shared prefix to close the gap, so a cursor-anchored item is dropped
// with no diagnostic - the user sees nothing and there is nothing to debug.
// ===========================================================================

test("A. at an empty partial with a member highlighted, an item is returned at all - a provider that returns nothing here has silently conceded the site [phase 3 promise 1 'the ghost renders']", async () => {
  await table(
    SITES.flatMap((s) =>
      ["enrollTile", "enqueue", "len"].map((member) => ({
        name: `${s.label}, highlighting \`${s.sep}${member}\``,
        sep: s.sep,
        member,
      }))
    ),
    async (row) => {
      const site = siteOf(row.sep);
      const { results } = await session(site, [{ sci: selectionAt(site, row.member) }], {
        ghost: () => `${row.member}${ARGS}`,
      });
      assert.ok(results[0].items.length > 0, "no item was returned, so there is nothing for VS Code to draw");
    }
  );
});

test("A. every item served at an empty partial carries range === selectedCompletionInfo.range: a cursor-anchored range cannot align with a widget range that starts at the separator, and VS Code drops the mismatch [phase 3 promise 1 + 'VS Code renders an inline item only when its range matches the widget's range']", async () => {
  await table(
    SITES.flatMap((s) =>
      ["enrollTile", "len"].map((member) => ({
        name: `${s.label}, highlighting \`${s.sep}${member}\``,
        sep: s.sep,
        member,
      }))
    ),
    async (row) => {
      const site = siteOf(row.sep);
      const sci = selectionAt(site, row.member);
      const { results } = await session(site, [{ sci }], { ghost: () => `${row.member}${ARGS}` });
      const items = results[0].items;
      assert.ok(items.length > 0, "no item was returned at all");
      for (const item of items) {
        assert.deepStrictEqual(
          coords(item.range),
          coords(sci.range),
          `item range must equal the widget range ${JSON.stringify(coords(sci.range))}, got ${JSON.stringify(coords(item.range))} - VS Code drops this item and shows nothing`
        );
      }
    }
  );
});

test("A. every insertText served at an empty partial starts with selectedCompletionInfo.text VERBATIM, separator included - at an empty partial there is no common prefix for VS Code to strip [phase 3 promise 1 + 'its insertText starts with the widget's text verbatim']", async () => {
  await table(
    SITES.flatMap((s) =>
      ["enrollTile", "enqueue", "len"].map((member) => ({
        name: `${s.label}, highlighting \`${s.sep}${member}\``,
        sep: s.sep,
        member,
      }))
    ),
    async (row) => {
      const site = siteOf(row.sep);
      const sci = selectionAt(site, row.member);
      const { results } = await session(site, [{ sci }], { ghost: () => `${row.member}${ARGS}` });
      const items = results[0].items;
      assert.ok(items.length > 0, "no item was returned at all");
      for (const item of items) {
        const text = String(item.insertText);
        assert.ok(
          text.startsWith(sci.text),
          `insertText must start with ${JSON.stringify(sci.text)}, got ${JSON.stringify(text)}`
        );
      }
    }
  );
});

test("A. the item that renders also lands the right line: applying it leaves the receiver, exactly one separator and the highlighted member [phase 3 promise 1 - rendering an item that corrupts the line is not a win]", async () => {
  await table(
    SITES.map((s) => ({ name: s.label, sep: s.sep })),
    async (row) => {
      const site = siteOf(row.sep);
      const sci = selectionAt(site);
      const { results } = await session(site, [{ sci }], { ghost: () => `${HIGHLIGHTED}${ARGS}` });
      const items = results[0].items;
      assert.ok(items.length > 0, "no item was returned at all");
      assert.strictEqual(
        landedLine(site, items[0]),
        `s${row.sep}${HIGHLIGHTED}${ARGS}`,
        `the applied line must read ${JSON.stringify(`s${row.sep}${HIGHLIGHTED}${ARGS}`)}, got ${JSON.stringify(landedLine(site, items[0]))}`
      );
    }
  );
});

// ===========================================================================
// B. ESCAPE THEN TAB AT AN EMPTY PARTIAL. Promise 2. The buffer still reads
// `s.`, so the user has typed no prefix for the accepted text to build on. The
// whole member name plus its arguments has to be in what lands, and the scope
// taken from the widget has to survive the Escape re-invocation that arrives
// with selectedCompletionInfo undefined.
// ===========================================================================

test("B. the sticky scope survives Escape at an EMPTY partial: the unselected re-invocation is still scoped to the highlighted member, not to the empty string [phase 3 promise 2 + 'VS Code re-invokes the provider with selectedCompletionInfo undefined on Escape']", async () => {
  await table(
    SITES.flatMap((s) =>
      ["enrollTile", "enqueue", "len"].map((member) => ({
        name: `${s.label}, arrowed to \`${s.sep}${member}\` then Escape`,
        sep: s.sep,
        member,
      }))
    ),
    async (row) => {
      const site = siteOf(row.sep);
      // A single selection is a passive preselect and holds the scope only for
      // the v20 window; an ACTIVE arrow to a DIFFERENT member is what makes it
      // hold with no deadline, which is what this row is about. Arrow off
      // `endpoint` (a member none of these rows target) onto row.member.
      const preselect = row.member === "endpoint" ? "enrollTile" : "endpoint";
      const { results } = await session(site, [
        { sci: selectionAt(site, preselect) },
        { sci: selectionAt(site, row.member) },
        { sci: undefined },
      ]);
      assert.strictEqual(
        servedPartial(results[2]),
        row.member,
        `the Escape re-invocation after an arrow must stay scoped to ${JSON.stringify(row.member)}, got ${JSON.stringify(servedPartial(results[2]))} (unscoped at an empty partial would be "")`
      );
    }
  );
});

test("B. a passive preselect at an empty partial survives Escape for 1500ms and then stops: no arrow, Escape, and the request is still SCOPED to the preselected member; at the deadline the same request is unscoped to the empty partial [v20 surface promises 1 and 2]", async () => {
  await table(
    SITES.flatMap((s) =>
      ["enrollTile", "endpoint", "len"].map((member) => ({
        name: `${s.label}, preselect \`${s.sep}${member}\` then Escape (no arrow)`,
        sep: s.sep,
        member,
      }))
    ),
    async (row) => {
      const site = siteOf(row.sep);
      const clock = fakeClock();
      const { results } = await session(
        site,
        [
          { sci: selectionAt(site, row.member) },
          // The Escape. This request opens the window.
          { sci: undefined },
          // Same state, same request, the window has closed.
          { sci: undefined, advanceMs: PASSIVE_WINDOW_MS },
        ],
        { clock }
      );
      assert.strictEqual(
        servedPartial(results[1]),
        row.member,
        `the Escape after a preselect must stay scoped to ${JSON.stringify(row.member)} - at an empty partial there is no typed prefix to fall back on, so an unscoped request is the whole ghost thrown away; got ${JSON.stringify(servedPartial(results[1]))} ("" is the v19 answer this replaces)`
      );
      assert.strictEqual(
        servedPartial(results[2]),
        "",
        `${PASSIVE_WINDOW_MS}ms after that Escape the passive scope is gone and the request reads the empty partial again, got ${JSON.stringify(servedPartial(results[2]))} - a passive scope with no deadline holds an unchosen member forever`
      );
    }
  );
});

test("B. what lands after Escape carries the FULL member name plus its arguments: the buffer reads `s.` and has no prefix, so a ghost of just the arguments accepts to a broken line [phase 3 promise 2 'the accepted text carries the whole member name plus its arguments']", async () => {
  await table(
    SITES.map((s) => ({ name: s.label, sep: s.sep })),
    async (row) => {
      const site = siteOf(row.sep);
      // Establish a genuine sticky scope before Escape: preselect a DIFFERENT
      // member, arrow to the highlighted one, then Escape. A lone preselect is
      // passive and drops, so this must model an active selection.
      const { results } = await session(site, [
        { sci: selectionAt(site, "endpoint") },
        { sci: selectionAt(site) },
        { sci: undefined },
      ], {
        ghost: () => `${HIGHLIGHTED}${ARGS}`,
      });
      const item = results[2].items[0];
      assert.ok(item, "the Escape re-invocation surfaced no item at all, so Tab lands nothing");
      assert.strictEqual(
        landedLine(site, item),
        `s${row.sep}${HIGHLIGHTED}${ARGS}`,
        `Tab must land ${JSON.stringify(`s${row.sep}${HIGHLIGHTED}${ARGS}`)}, got ${JSON.stringify(landedLine(site, item))}`
      );
    }
  );
});

test("B. Escape at an empty partial does not resurrect the typed partial: two consecutive unselected requests both stay on the chosen member [phase 3 promise 2 - VS Code's re-invocation count is not the provider's to control]", async () => {
  const site = siteOf(".");
  // Active selection: arrow off `enrollTile` onto `endpoint` so a real sticky
  // scope exists, then the two Escapes. A lone preselect would set no scope.
  const { results } = await session(site, [
    { sci: selectionAt(site, "enrollTile") },
    { sci: selectionAt(site, "endpoint") },
    { sci: undefined },
    { sci: undefined },
  ]);
  const got = results.slice(2).map(servedPartial);
  assert.deepStrictEqual(
    got,
    ["endpoint", "endpoint"],
    `both post-Escape requests must stay scoped to the chosen member, got ${JSON.stringify(got)}`
  );
});

// ===========================================================================
// C0. THE SCOPING PREMISE. Generation under a widget selection is SCOPED: the
// prompt handed to the model is not the buffer, it is the buffer with the
// highlighted member name already appended. That single fact decides what
// counts as a well-behaved model output at an empty partial, and every judgment
// in section C rests on it, so it is measured here rather than assumed.
//
// Nothing else in the suite pins it. Sections A, B and D read the SHAPE of what
// comes back; only this section reads what went out.
//
// The consequence, spelled out because it is easy to get backwards: at buffer
// `s.` with `.enrollTile` highlighted, a model handed a prompt ending
// `s.enrollTile` and returning `enrollTile(tile);` has re-spelled the tail of
// its own prompt. That is a model failure, not a clean completion. The clean
// output at this site is the ARGUMENTS ALONE.
// ===========================================================================

test("C0. generation under a widget selection is scoped: the prefix reaching the service ends with the separator and the highlighted member name, at an empty partial and a non-empty one alike [the premise section C's judgments rest on]", async () => {
  await table(
    SITES.flatMap((s) =>
      ["", "en"].flatMap((partial) =>
        ["enrollTile", "endpoint"].map((member) => ({
          name: `${s.label}, typed ${JSON.stringify(partial)}, highlighting \`${s.sep}${member}\``,
          sep: s.sep,
          partial,
          member,
        }))
      )
    ),
    async (row) => {
      const site = siteOf(row.sep, row.partial);
      const { recorded } = await session(site, [{ sci: selectionAt(site, row.member) }], {
        ghost: () => `${ARGS}`,
        config: GATE_ON,
      });
      const call = recorded[0];
      assert.ok(call, "the provider never reached the service");
      assert.strictEqual(
        String(call.prefix).slice(-(row.sep.length + row.member.length + 1)),
        `s${row.sep}${row.member}`,
        `the scoped prefix must end ${JSON.stringify(`s${row.sep}${row.member}`)}, got tail ${JSON.stringify(String(call.prefix).slice(-24))}`
      );
      assert.strictEqual(
        call.memberPartial,
        row.member,
        `the request must be scoped to the highlighted member, got ${JSON.stringify(call.memberPartial)}`
      );
    }
  );
});

test("C0. the scoping reaches the MODEL, not just the service: the prompt the generation layer is handed ends with the highlighted member name, so re-spelling that name is the model contradicting its own prompt [the premise, at the layer the model actually sees]", async () => {
  await table(
    SITES.flatMap((s) =>
      ["", "en"].map((partial) => ({
        name: `${s.label}, typed ${JSON.stringify(partial)}, highlighting \`${s.sep}${HIGHLIGHTED}\``,
        sep: s.sep,
        partial,
      }))
    ),
    async (row) => {
      const site = siteOf(row.sep, row.partial);
      const { genRequests } = await session(site, [{ sci: selectionAt(site) }], {
        ghost: () => `${ARGS}`,
        config: GATE_ON,
      });
      assert.ok(genRequests.length > 0, "the model layer was never reached");
      const prompt = String(genRequests[0] && genRequests[0].prefix);
      assert.ok(
        prompt.endsWith(`s${row.sep}${HIGHLIGHTED}`),
        `the model prompt must end ${JSON.stringify(`s${row.sep}${HIGHLIGHTED}`)}, got tail ${JSON.stringify(prompt.slice(-32))}`
      );
    }
  );
});

// ===========================================================================
// C. NON-CORRUPTION. The premise phase 3 owns. Phase 1's landed-name check
// strips a leading separator run unconditionally and floors its scan at a
// column derived from the typed partial's length. At an empty partial that
// length is zero, and the three shapes below each name the RIGHT member while
// wrecking the line - so a name-only check waves them all through.
//
// These are raw model outputs, not hand-built items: the provider owns what
// happens to model text, and the contract is judged on the line the user ends
// up with. The member gate is ON, because a suppression contract cannot be
// measured with the thing that suppresses turned off.
// ===========================================================================

// `fimMemberGate` ships default TRUE, so gate-on is the shipping configuration.
// Sections A, B and D leave it off, matching the phase 1 blind test, so a
// shaping failure there cannot be a suppression wearing a disguise.
const GATE_ON = { fimMemberGate: true };

// Each ghost names `enrollTile` and each, if served naively, leaves a line the
// user did not ask for. Naive here means concatenated at the cursor, which is
// the shape phase 1 ships at every non-empty partial.
const CORRUPTING = (sep) => [
  {
    name: `doubled separator: model respells \`${sep}\` and the buffer already has one`,
    ghost: `${sep}${HIGHLIGHTED}${ARGS}`,
    corrupt: `s${sep}${sep}${HIGHLIGHTED}${ARGS}`,
  },
  {
    name: "mixed separator run: model respells the OTHER separator kind",
    ghost: `${sep === "." ? "::" : "."}${HIGHLIGHTED}${ARGS}`,
    corrupt: `s${sep}${sep === "." ? "::" : "."}${HIGHLIGHTED}${ARGS}`,
  },
  {
    name: "receiver-restating: model re-emits `s` and the buffer already has it",
    ghost: `s${sep}${HIGHLIGHTED}${ARGS}`,
    corrupt: `s${sep}s${sep}${HIGHLIGHTED}${ARGS}`,
  },
];

const CLEAN = (sep) => `s${sep}${HIGHLIGHTED}${ARGS}`;

// The gate is a setting, and a corrupting line is corrupting either way. Both
// settings are in the table so a pass cannot come from one of them being lucky.
const GATES = [
  { gate: "on", config: GATE_ON },
  { gate: "off", config: {} },
];

test("C. an item that names the right member but does not leave the receiver and exactly ONE separator intact is not served: doubled separator, mixed separator run and receiver-restating model output are each either suppressed or repaired, never passed through [phase 3 'the contract is that an item which does not leave the receiver and exactly one separator intact is not served']", async () => {
  await table(
    SITES.flatMap((s) =>
      GATES.flatMap((g) =>
        CORRUPTING(s.sep).map((c) => ({
          name: `${s.label}, gate ${g.gate} - ${c.name}`,
          sep: s.sep,
          config: g.config,
          ghost: c.ghost,
          corrupt: c.corrupt,
        }))
      )
    ),
    async (row) => {
      const site = siteOf(row.sep);
      const { results } = await session(site, [{ sci: selectionAt(site) }], {
        ghost: () => row.ghost,
        config: row.config,
      });
      const items = results[0].items;
      if (items.length === 0) return; // suppressed outright, which satisfies the contract
      const landed = landedLine(site, items[0]);
      assert.notStrictEqual(landed, row.corrupt, `the corrupting line ${JSON.stringify(row.corrupt)} was served verbatim`);
      assert.strictEqual(
        landed,
        CLEAN(row.sep),
        `an item served here must land ${JSON.stringify(CLEAN(row.sep))}, got ${JSON.stringify(landed)}`
      );
    }
  );
});

test("C. no served item deletes the receiver: its range never starts left of the separator, and the applied line still opens with `s` [phase 3 'a receiver-deleting item (the line loses `s` and reads `.enrollTile(a)`)']", async () => {
  await table(
    SITES.flatMap((s) =>
      // The first is the well-behaved scoped ghost, so this row is not vacuous
      // at gate ON even though the rest are refused outright.
      [ARGS, `${HIGHLIGHTED}${ARGS}`, `${s.sep}${HIGHLIGHTED}${ARGS}`, `s${s.sep}${HIGHLIGHTED}${ARGS}`].map((ghost, i) => ({
        name: `${s.label} - model output #${i + 1} ${JSON.stringify(ghost)}`,
        sep: s.sep,
        ghost,
      }))
    ),
    async (row) => {
      const site = siteOf(row.sep);
      const { results } = await session(site, [{ sci: selectionAt(site) }], {
        ghost: () => row.ghost,
        config: GATE_ON,
      });
      const items = results[0].items;
      if (items.length === 0) return;
      for (const item of items) {
        const start = item.range && item.range.start ? item.range.start.character : site.cursorChar;
        assert.ok(
          start >= site.sepChar,
          `a served item must not reach back over the receiver: range starts at character ${start}, the separator is at ${site.sepChar}`
        );
        assert.ok(
          landedLine(site, item).startsWith("s"),
          `the applied line must still open with the receiver, got ${JSON.stringify(landedLine(site, item))}`
        );
      }
    }
  );
});

test("C. exactly one separator survives: the applied line contains no `..`, no `::.`, no `.::` and no doubled `::` [phase 3 - each corrupting shape names the right member and still wrecks the line]", async () => {
  await table(
    SITES.flatMap((s) =>
      CORRUPTING(s.sep)
        // The clean output at a SCOPED site is the arguments alone - see C0.
        // `enrollTile(tile);` would be the model echoing its own prompt tail,
        // which is refused, and a refused ghost passes this row vacuously.
        .concat([{ name: "well-behaved model output", ghost: ARGS }])
        .map((c) => ({ name: `${s.label} - ${c.name}`, sep: s.sep, ghost: c.ghost }))
    ),
    async (row) => {
      const site = siteOf(row.sep);
      const { results } = await session(site, [{ sci: selectionAt(site) }], {
        ghost: () => row.ghost,
        config: GATE_ON,
      });
      const items = results[0].items;
      if (items.length === 0) return;
      const landed = landedLine(site, items[0]);
      const run = /^s([.:]+)/.exec(landed);
      assert.ok(run, `the applied line must open with the receiver and a separator, got ${JSON.stringify(landed)}`);
      assert.strictEqual(
        run[1],
        row.sep,
        `exactly one ${JSON.stringify(row.sep)} must survive, got the run ${JSON.stringify(run[1])} in ${JSON.stringify(landed)}`
      );
    }
  );
});

// The two rows below are one contract read from both sides, and C0 is what
// tells them apart.
//
// This row was originally written with the ghost `enrollTile(tile);` and the
// claim that it was "clean model output". C0 shows it is not: the prompt that
// produced it already ended `s.enrollTile`, so that ghost is the model
// re-spelling its own prompt tail. The intent of the row - that suppression
// cannot be a blanket - was right, and it survives on the ghost the premise
// actually makes clean, which is the arguments alone.
//
// The row is deliberately stronger than a bare `items.length > 0`. A suppressed
// serve, an item anchored somewhere other than the widget range, and an item
// that loses the receiver or the member name each turn it red.

test("C. suppression is not a blanket: a WELL-BEHAVED scoped model output at an empty partial is served, renders and lands, so `nothing is served` cannot be the phase's answer to corruption [phase 3 promises 1 and 3 read together, with the clean ghost C0 defines]", async () => {
  await table(
    SITES.flatMap((s) =>
      // All one argument, because `enrollTile(Tile) : bool` takes one and a
      // wrong-arity ghost is refused by a different contract than this row's.
      ["(a)", "(tile);", "(this.tile);"].map((ghost) => ({
        name: `${s.label}, well-behaved ghost ${JSON.stringify(ghost)}`,
        sep: s.sep,
        ghost,
      }))
    ),
    async (row) => {
      const site = siteOf(row.sep);
      const sci = selectionAt(site);
      const { results } = await session(site, [{ sci }], {
        ghost: () => row.ghost,
        config: GATE_ON,
      });
      const items = results[0].items;
      assert.ok(
        items.length > 0,
        `a well-behaved scoped ghost ${JSON.stringify(row.ghost)} was suppressed, which fixes corruption by deleting the feature`
      );
      const item = items[0];
      assert.deepStrictEqual(
        coords(item.range),
        coords(sci.range),
        `a served item must carry the widget range or VS Code draws nothing, got ${JSON.stringify(coords(item.range))}`
      );
      assert.strictEqual(
        landedLine(site, item),
        `s${row.sep}${HIGHLIGHTED}${row.ghost}`,
        `the applied line must read ${JSON.stringify(`s${row.sep}${HIGHLIGHTED}${row.ghost}`)}, got ${JSON.stringify(landedLine(site, item))}`
      );
    }
  );
});

test("C. the other side of the same contract: a scoped ghost that re-spells the member name its own prompt already ends with is REFUSED, not laundered - stripping the echo would let a sibling like `enrollTileTally(a, b)` compose into a real member [triage-p3 Q1; the refusal is the only signal the model contradicted its prompt]", async () => {
  await table(
    SITES.flatMap((s) =>
      [`${HIGHLIGHTED}${ARGS}`, `${HIGHLIGHTED}(a)`].map((ghost) => ({
        name: `${s.label}, echoing ghost ${JSON.stringify(ghost)}`,
        sep: s.sep,
        ghost,
      }))
    ),
    async (row) => {
      const site = siteOf(row.sep);
      const { results } = await session(site, [{ sci: selectionAt(site) }], {
        ghost: () => row.ghost,
        config: GATE_ON,
      });
      const items = results[0].items;
      if (items.length === 0) return; // refused, which is the contract
      assert.fail(
        `an echoing ghost was served as ${JSON.stringify(landedLine(site, items[0]))}; if the echo is stripped at the gate then a sibling ghost with the scope name on its head is laundered into a real member`
      );
    }
  );
});

// ===========================================================================
// D. REGRESSION. `s.en` is the site phase 1 already proved. Everything here
// passes today. If this section goes red, phase 3 was bought by breaking the
// case phase 1 paid for.
// ===========================================================================

test("D. a NON-empty partial still scopes to the highlighted member and still renders: range === the widget range, insertText starts with the widget text [phase 1's promise, unchanged by phase 3] (regression net)", async () => {
  await table(
    SITES.flatMap((s) =>
      ["enrollTile", "enqueue"].map((member) => ({
        name: `${s.label.replace("s.`", "s.en`")} - typed \`en\`, highlighting \`${s.sep}${member}\``,
        sep: s.sep,
        member,
      }))
    ),
    async (row) => {
      const site = siteOf(row.sep, "en");
      const sci = selectionAt(site, row.member);
      const { results } = await session(site, [{ sci }], { ghost: () => `${row.member}${ARGS}` });
      const call = results[0].calls[0];
      assert.ok(call, "the provider never reached the service");
      assert.strictEqual(call.memberPartial, row.member, `memberPartial must be the bare highlighted name, got ${JSON.stringify(call.memberPartial)}`);
      const item = results[0].items[0];
      assert.ok(item, "no item was returned at a non-empty partial, which is a phase 1 regression");
      assert.deepStrictEqual(coords(item.range), coords(sci.range), "item range must still equal the widget range");
      assert.ok(
        String(item.insertText).startsWith(sci.text),
        `insertText must still start with ${JSON.stringify(sci.text)}, got ${JSON.stringify(String(item.insertText))}`
      );
    }
  );
});

test("D. a NON-empty partial with no selection is still unscoped and cursor-anchored: ordinary typing is untouched [phase 1's inertness guard] (regression net)", async () => {
  await table(
    [
      { name: "`s.en` - two characters typed", partial: "en", expect: "en" },
      { name: "`s.e` - one character typed", partial: "e", expect: "e" },
    ],
    async (row) => {
      const site = siteOf(".", row.partial);
      const { results } = await session(site, [{ sci: undefined }]);
      const call = results[0].calls[0];
      assert.ok(call, "the provider never reached the service");
      assert.strictEqual(call.memberPartial, row.expect, `expected the typed partial ${JSON.stringify(row.expect)}, got ${JSON.stringify(call.memberPartial)}`);
      assert.strictEqual(call.memberSite, true, "still a member site");
      assert.strictEqual(call.memberReceiver, "s", "the receiver is still parsed and threaded");
    }
  );
});

test("D. an EMPTY partial with no selection and no sticky scope is unchanged: still a member site, still an empty partial, still the receiver [phase 3 must not move the unselected empty-partial baseline] (regression net)", async () => {
  await table(
    SITES.map((s) => ({ name: s.label, sep: s.sep })),
    async (row) => {
      const site = siteOf(row.sep);
      const { results } = await session(site, [{ sci: undefined }]);
      const call = results[0].calls[0];
      assert.ok(call, "the provider never reached the service");
      assert.strictEqual(call.memberSite, true, "`s` plus a separator is a member site");
      assert.strictEqual(call.memberPartial, "", `an unselected empty partial stays empty, got ${JSON.stringify(call.memberPartial)}`);
      assert.strictEqual(call.memberReceiver, "s", "the receiver is still parsed and threaded");
    }
  );
});
