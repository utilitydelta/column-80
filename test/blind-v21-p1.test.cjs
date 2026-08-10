// BLIND CONTRACT TEST - v21 phase 1, items 1 and 2.
//
// Written from session-v21/surface-p1.md and nothing else. This file does not
// read src/vscode/completionProvider.ts, src/core/completionService.ts or
// src/vscode/extension.ts; esbuild resolves them at bundle time only. Every
// assertion below is a clause of that surface, one of its named invariants, or
// an externally observable property of VS Code.
//
// THESE TESTS ARE EXPECTED RED until v21 phase 1 ships. Red before green. The
// surface introduces no new exported symbol, so nothing here should fail to
// BUILD: a build failure is a harness bug, not a contract failure.
//
// What each section pins:
//
//   A. NO IDENTIFIER, NO SCOPE. A widget selection whose identifier run is
//      empty (`[Symbol]` at a TypeScript `.` site) forms no scope at all. Four
//      observables, one per bullet of contract item 1: no `[fim] scoped to`
//      line, an unmodified generation prefix, no sticky record and no timer,
//      and a request indistinguishable from the widget-closed one.
//   B. THE INVARIANT THAT MUST NOT REGRESS. Every selection that forms a scope
//      today still does: `.enrollTile`, the bare `enrollTile`, the
//      snippet-shaped `rehome_by_lod(by_lod)`, and the non-ASCII `café`.
//   C. THE ALTERNATES SPREAD. The extras sample at 0.9 then 1.1 and the primary
//      keeps the configured temperature; one generation on the single and
//      automatic paths; a hot configured temperature floors the rungs; more
//      extras than rungs repeats the last rung and never produces undefined.
//
// Command ordering (contract item 3) lives in
// test/blind-v21-p1-commands.test.cjs, which needs an activated extension and
// a different harness. Contract item 4 is a change to an existing gesture test
// and is deliberately not covered here.
//
// Run: SKIP_LIVE=1 node --test test/blind-v21-p1.test.cjs
// (Hermetic: a vscode stub, a stubbed extractor registry, a stubbed generate.
// No model, no network, no real VS Code.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

// ===========================================================================
// Harness. The idiom of test/blind-v20-preselect-window.test.cjs: alias
// `vscode` to a hand-built stub, redirect the extractor registry through an
// esbuild plugin (async API, hence the child process), require the bundle. The
// provider module is re-exported as a NAMESPACE so a symbol that does not
// exist cannot turn a contract failure into a link error.
// ===========================================================================

const TAG = ".blind-v21-p1";
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
  languages: {}, window: {},
  commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => {
      const over = (globalThis.__v21Config || {});
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
  return (globalThis as any).__v21Extractor;
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

// ===========================================================================
// The scenario. Receiver `s` on a TypeScript document. Two sites, because the
// surface's own capture is at a bare `.` and the biting evidence is at a site
// with something typed:
//
//   TYPED  `s.en` - typed partial "en", so an empty scope is DISTINGUISHABLE
//          from the unscoped request.
//   BARE   `s.`   - typed partial "", the site the langs arm actually captured
//          `[Symbol]` at.
// ===========================================================================

const TYPED_SOURCE = "let s: Stripe;\ns.en";
const TYPED_CHAR = 4; // after `s.en`
const TYPED_PARTIAL = "en";

const BARE_SOURCE = "let s: Stripe;\ns.";
const BARE_CHAR = 2; // after `s.`

const CURSOR_LINE = 1;
const SEPARATOR_CHAR = 1; // the dot in `s.en`

const AUTOMATIC = 1; // vscode.InlineCompletionTriggerKind.Automatic, per the stub

const MEMBERS = [
  { name: "enrollTile", signature: "enrollTile(Tile) : bool", kind: "method" },
  { name: "enqueue", signature: "enqueue(Job) : void", kind: "method" },
  { name: "endpoint", signature: "endpoint() : string", kind: "method" },
];

// A widget selection: the label VS Code highlighted, and the range it would
// replace. TypeScript's `[Symbol]` item replaces the separator too, which is
// why the captured log reads `range widget`.
const selection = (text, startChar, endChar) => ({
  text,
  range: {
    start: { line: CURSOR_LINE, character: startChar },
    end: { line: CURSOR_LINE, character: endChar },
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

// The fake clock, verbatim in behaviour from the v20 blind files: `now` is a
// number the test moves, `setTimer` records the arm. Nothing in this file
// needs to FIRE a timer - what item 1 promises is that none is ever armed.
function makeClock(start = 10_000) {
  const armed = [];
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

  return {
    hooks,
    advance(ms) {
      now += ms;
    },
    snapshot() {
      return {
        armed: armed.length,
        pending: armed.filter((r) => !r.fired && !r.cancelled).length,
        delays: armed.map((r) => r.ms),
        expired,
      };
    },
  };
}

const MARK = (p) => `[[partial=${p}]]`;

// One provider, one service, a sequence of steps. The generate stub echoes the
// memberPartial that reached it back through the ghost, so the scope is
// readable off the ITEM even when a cache answers without a second call.
async function session(steps, opts = {}) {
  const { ghost, config, source, char, languageId } = opts;
  const { FimCompletionProvider, CompletionService, DEFAULT_FIM_CONFIG } = need();

  globalThis.__v21Config = config || {};
  globalThis.__v21Extractor = {
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
  const lines = [];
  const clock = makeClock();
  const service = new CompletionService(
    { ...DEFAULT_FIM_CONFIG, ...(config || {}), debounceMs: 0, cacheCapacity: opts.cacheCapacity ?? 0 },
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
        return (o) => {
          recorded.push(o);
          return t.complete(o);
        };
      }
      const v = Reflect.get(t, p, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });

  const output = { appendLine: (l) => lines.push(String(l)) };
  const provider = new FimCompletionProvider(() => spy, output, undefined, clock.hooks);

  const doc = makeDoc(source ?? TYPED_SOURCE, languageId);
  const results = [];

  for (const step of steps) {
    const before = recorded.length;
    const beforeLines = lines.length;
    const position = makePos(step.line ?? CURSOR_LINE, step.char ?? char ?? TYPED_CHAR);
    const raw = await provider.provideInlineCompletionItems(
      doc,
      position,
      { triggerKind: step.triggerKind ?? AUTOMATIC, selectedCompletionInfo: step.sci },
      { onCancellationRequested: () => {}, isCancellationRequested: false }
    );
    const items = Array.isArray(raw) ? raw : (raw && raw.items) || [];
    results.push({
      items,
      calls: recorded.slice(before),
      lines: lines.slice(beforeLines),
      timers: clock.snapshot(),
    });
  }

  service.dispose();
  globalThis.__v21Config = {};
  return { results, recorded, lines, clock };
}

const lastPartial = (recorded) => {
  const last = recorded[recorded.length - 1];
  return last && typeof last.memberPartial === "string" ? last.memberPartial : String(last && last.memberPartial);
};

function servedPartial(result) {
  const item = result.items[0];
  if (!item) return undefined;
  const m = /\[\[partial=([^\]]*)\]\]/.exec(String(item.insertText));
  return m ? m[1] : `NO-MARKER(${JSON.stringify(String(item.insertText))})`;
}

// The three `[fim]` lines the evidence taxonomy names. `invoked` is
// unconditional; `scoped to` is the line item 1 says must not appear.
const scopedLines = (ls) => ls.filter((l) => /^\[fim\]\s*scoped to\b/.test(l));
const invokedLines = (ls) => ls.filter((l) => /^\[fim\]\s*invoked\b/.test(l));

// The shape of the request the service sees, minus anything that cannot be
// compared across two independent runs.
const shape = (call) =>
  call && {
    prefix: call.prefix,
    suffix: call.suffix,
    memberPartial: call.memberPartial,
    memberSite: call.memberSite,
    memberReceiver: call.memberReceiver,
    manual: call.manual,
    alternatives: call.alternatives,
  };

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
// A. NO IDENTIFIER, NO SCOPE. Contract item 1. TypeScript's member list at a
// `.` site includes `[Symbol]`. The identifier run out of that label is empty,
// and an empty scope goes out on the request while the landed-name guard
// compares every candidate against "".
//
// Every label below has an empty run under the surface's own rule: strip
// leading separators (`.`, `::`), then take a run of ID_Continue plus `$`.
// ===========================================================================

const EMPTY_RUN_LABELS = [
  { name: "`[Symbol]` - the capture from the langs arm", text: "[Symbol]" },
  { name: "`[Symbol.iterator]` - the same item, fully spelled", text: "[Symbol.iterator]" },
  { name: "`[index: string]` - an index signature", text: "[index: string]" },
  { name: "`.` - the separator and nothing else", text: "." },
  { name: "`::` - a separator that is stripped to nothing", text: "::" },
  { name: "`.[Symbol]` - a separator in front of the bracket", text: ".[Symbol]" },
  { name: '`"quoted"` - a string-keyed member', text: '"quoted"' },
];

// The two range shapes VS Code hands back at a member site: one that swallows
// the separator (what a `[Symbol]` item does, because it deletes the dot) and
// one anchored at the cursor. Neither may form a scope.
const rangesFor = (endChar) => [
  { name: "range over the separator and the typed run", start: SEPARATOR_CHAR, end: endChar },
  { name: "range anchored at the cursor", start: endChar, end: endChar },
];

test("A1. a selection with an empty identifier run writes NO `[fim] scoped to` line, while the unconditional `[fim] invoked` line is still written [surface item 1 'No `[fim] scoped to ...` line is written. The `[fim] invoked` line still is; it is unconditional']", async () => {
  const rows = [];
  for (const label of EMPTY_RUN_LABELS) {
    for (const site of [
      { site: "`s.en`", source: TYPED_SOURCE, char: TYPED_CHAR },
      { site: "`s.`", source: BARE_SOURCE, char: BARE_CHAR },
    ]) {
      for (const r of rangesFor(site.char)) {
        rows.push({ name: `${label.name} at ${site.site}, ${r.name}`, label, site, r });
      }
    }
  }
  await table(rows, async (row) => {
    const { results } = await session([{ sci: selection(row.label.text, row.r.start, row.r.end) }], {
      source: row.site.source,
      char: row.site.char,
    });
    assert.strictEqual(
      invokedLines(results[0].lines).length,
      1,
      `harness guard: the provider must write exactly one unconditional \`[fim] invoked\` line per call, got ${JSON.stringify(results[0].lines)}`
    );
    assert.deepStrictEqual(
      scopedLines(results[0].lines),
      [],
      `a selection whose identifier run is empty forms NO scope, so no \`scoped to\` line may be written; got ${JSON.stringify(scopedLines(results[0].lines))} out of ${JSON.stringify(results[0].lines)}`
    );
  });
});

test("A2. the generation prefix is the buffer's own, unmodified: nothing is spliced for a selection that yields no identifier [surface item 1 'The generation prefix is the buffer's own prefix, unmodified. Nothing is spliced']", async () => {
  await table(
    [
      { name: "`[Symbol]` at `s.en`", text: "[Symbol]", source: TYPED_SOURCE, char: TYPED_CHAR },
      { name: "`[Symbol]` at `s.`", text: "[Symbol]", source: BARE_SOURCE, char: BARE_CHAR },
      { name: "`[index: string]` at `s.en`", text: "[index: string]", source: TYPED_SOURCE, char: TYPED_CHAR },
      { name: "`.` at `s.`", text: ".", source: BARE_SOURCE, char: BARE_CHAR },
    ],
    async (row) => {
      const { results: base } = await session([{ sci: undefined }], { source: row.source, char: row.char });
      const control = base[0].calls[0];
      assert.ok(control, "control sanity: the widget-closed request must reach the service");

      const { results } = await session([{ sci: selection(row.text, SEPARATOR_CHAR, row.char) }], {
        source: row.source,
        char: row.char,
      });
      const call = results[0].calls[0];
      assert.ok(call, "the request never reached the service, so no prefix was formed at all");
      assert.strictEqual(
        call.prefix,
        control.prefix,
        `the prefix must be the buffer's own, byte for byte; the widget-closed control ends ${JSON.stringify(String(control.prefix).slice(-24))} and this one ends ${JSON.stringify(String(call.prefix).slice(-24))} - a difference is a splice of a member that was never named`
      );
    }
  );
});

test("A3. the whole request is indistinguishable from the widget-closed one at the same cursor: same prefix, suffix, partial, site and receiver [surface item 1 'The request behaves exactly as it does when the widget is closed at that same cursor']", async () => {
  await table(
    [
      { name: "`[Symbol]` at `s.en` - the typed partial is `en`, so an empty scope shows up here", text: "[Symbol]", source: TYPED_SOURCE, char: TYPED_CHAR },
      { name: "`[Symbol]` at `s.`", text: "[Symbol]", source: BARE_SOURCE, char: BARE_CHAR },
      { name: "`[Symbol.iterator]` at `s.en`", text: "[Symbol.iterator]", source: TYPED_SOURCE, char: TYPED_CHAR },
      { name: "`::` at `s.en`", text: "::", source: TYPED_SOURCE, char: TYPED_CHAR },
    ],
    async (row) => {
      const { results: base } = await session([{ sci: undefined }], { source: row.source, char: row.char });
      const control = shape(base[0].calls[0]);
      assert.ok(control, "control sanity: the widget-closed request must reach the service");

      const { results } = await session([{ sci: selection(row.text, SEPARATOR_CHAR, row.char) }], {
        source: row.source,
        char: row.char,
      });
      const call = shape(results[0].calls[0]);
      assert.ok(call, "the request never reached the service");
      assert.deepStrictEqual(
        call,
        control,
        `a selection that yields no identifier must leave the request exactly as the widget-closed one, control ${JSON.stringify(control)}, got ${JSON.stringify(call)} - a memberPartial of "" is a scope named nothing, which is what item 1 removes`
      );
    }
  );
});

test("A4. no sticky record is armed, so the Escape that follows is the ordinary unscoped request and no expiry timer exists [surface item 1 'No sticky record is armed, so the passive-preselect window does not open and no expiry timer arms']", async () => {
  await table(
    [
      { name: "`[Symbol]` at `s.en`", text: "[Symbol]", source: TYPED_SOURCE, char: TYPED_CHAR, expect: TYPED_PARTIAL },
      { name: "`[Symbol.iterator]` at `s.en`", text: "[Symbol.iterator]", source: TYPED_SOURCE, char: TYPED_CHAR, expect: TYPED_PARTIAL },
      { name: "`[index: string]` at `s.en`", text: "[index: string]", source: TYPED_SOURCE, char: TYPED_CHAR, expect: TYPED_PARTIAL },
      { name: "`[Symbol]` at `s.`", text: "[Symbol]", source: BARE_SOURCE, char: BARE_CHAR, expect: "" },
    ],
    async (row) => {
      // Open the widget on the empty-run item, then Escape at the same state.
      const { results } = await session(
        [{ sci: selection(row.text, SEPARATOR_CHAR, row.char) }, { sci: undefined }],
        { source: row.source, char: row.char }
      );
      const call = results[1].calls[0];
      assert.ok(call, "the Escape request never reached the service");
      assert.strictEqual(
        call.memberPartial,
        row.expect,
        `nothing was scoped, so the Escape reads the buffer's own partial ${JSON.stringify(row.expect)}, got ${JSON.stringify(call.memberPartial)} - anything else is a sticky record for a member that was never named`
      );
      assert.strictEqual(
        results[1].timers.armed,
        0,
        `no scope was formed, so no passive window may open: ${results[1].timers.armed} timer(s) armed with delays ${JSON.stringify(results[1].timers.delays)}`
      );
      assert.strictEqual(
        results[1].timers.expired,
        0,
        `and nothing may expire, got ${results[1].timers.expired} onExpired call(s)`
      );
      assert.deepStrictEqual(
        scopedLines(results[0].lines.concat(results[1].lines)),
        [],
        `neither request may write a \`scoped to\` line, got ${JSON.stringify(scopedLines(results[0].lines.concat(results[1].lines)))}`
      );
    }
  );
});

// ===========================================================================
// B. THE INVARIANT THAT MUST NOT REGRESS. "This is one predicate on the empty
// case, not a re-reading of the name." Every selection that forms a scope
// today still forms one. The observable is the line the empty case must not
// write, carrying the member the run yields.
// ===========================================================================

test("B. every selection that yields a NON-empty identifier run still scopes, and still names the member it read [surface item 1 'enrollTile, .enrollTile, ::rehome_by_lod(by_lod) and café all yield a non-empty run and are unaffected']", async () => {
  await table(
    [
      { name: "`.enrollTile` - a leading separator stripped off a plain member", text: ".enrollTile", source: TYPED_SOURCE, char: TYPED_CHAR, member: "enrollTile" },
      { name: "`enrollTile` - the bare label, no separator at all", text: "enrollTile", source: TYPED_SOURCE, char: TYPED_CHAR, member: "enrollTile" },
      { name: "`.rehome_by_lod(by_lod)` - a snippet-shaped label, the run stops at `(`", text: ".rehome_by_lod(by_lod)", source: "let s: Stripe;\ns.re", char: 4, member: "rehome_by_lod" },
      { name: "`.café` - non-ASCII ID_Continue", text: ".café", source: "let s: Stripe;\ns.ca", char: 4, member: "café" },
    ],
    async (row) => {
      const { results } = await session([{ sci: selection(row.text, SEPARATOR_CHAR, row.char) }], {
        source: row.source,
        char: row.char,
      });
      const scoped = scopedLines(results[0].lines);
      assert.strictEqual(
        scoped.length,
        1,
        `this selection yields the non-empty run ${JSON.stringify(row.member)}, so exactly one \`[fim] scoped to\` line belongs here; got ${JSON.stringify(scoped)} out of ${JSON.stringify(results[0].lines)} - item 1 is one predicate on the EMPTY case and must not narrow this`
      );
      assert.ok(
        scoped[0].includes(row.member),
        `the scope must name ${JSON.stringify(row.member)}, got ${JSON.stringify(scoped[0])}`
      );
    }
  );
});

test("B. the scoped member is what reaches the generation layer, not just what the log says [surface item 1 - the invariant is about the SCOPE, and the scope is what goes out on the request]", async () => {
  await table(
    [
      { name: "`.enrollTile`", text: ".enrollTile", member: "enrollTile" },
      { name: "`enrollTile`", text: "enrollTile", member: "enrollTile" },
    ],
    async (row) => {
      const { results } = await session([{ sci: selection(row.text, SEPARATOR_CHAR, TYPED_CHAR) }]);
      const call = results[0].calls[0];
      assert.ok(call, "the widget-open request never reached the service");
      assert.strictEqual(
        call.memberPartial,
        row.member,
        `the scoped request must carry the member's bare name ${JSON.stringify(row.member)}, got ${JSON.stringify(call.memberPartial)}`
      );
    }
  );
});

test("B. an empty run and a non-empty run at the SAME site answer differently: this is the whole of item 1 in one row [surface item 1 - the predicate separates exactly these two]", async () => {
  const { results: empty } = await session([{ sci: selection("[Symbol]", SEPARATOR_CHAR, TYPED_CHAR) }]);
  const { results: named } = await session([{ sci: selection(".enrollTile", SEPARATOR_CHAR, TYPED_CHAR) }]);
  assert.strictEqual(
    empty[0].calls[0] && empty[0].calls[0].memberPartial,
    TYPED_PARTIAL,
    `\`[Symbol]\` forms no scope, so the request reads the typed partial ${JSON.stringify(TYPED_PARTIAL)}, got ${JSON.stringify(empty[0].calls[0] && empty[0].calls[0].memberPartial)}`
  );
  assert.strictEqual(
    named[0].calls[0] && named[0].calls[0].memberPartial,
    "enrollTile",
    `\`.enrollTile\` at the same site still scopes, got ${JSON.stringify(named[0].calls[0] && named[0].calls[0].memberPartial)}`
  );
});

// ===========================================================================
// C. THE ALTERNATES SPREAD. Contract item 2. The extras sample at a SPREAD
// (0.9, then 1.1), not a single floor; the primary keeps the configured
// temperature untouched. Driven straight through the service's public
// complete() with a generator that captures every call's parameters.
// ===========================================================================

const LADDER = [0.9, 1.1];
const ALT_PREFIX = "const x = foo.";

// A generator that records the temperature of every call, in call order, and
// returns a distinct text each time so dedup cannot swallow an extra.
function capturingGenerator() {
  const calls = [];
  let i = 0;
  return {
    calls,
    fn: async (params) => {
      calls.push({ temperature: params && params.temperature });
      i += 1;
      // `barTile${i}()` rather than v21's original `bar${i}()`: see the note on
      // the same rename in C5 below. Six characters is under the v25 fix 8
      // length floor that now sits on DEFAULT_FIM_CONFIG, and every row here
      // builds on that default. The fixture's length was never the subject of
      // any assertion in this file; its DISTINCTNESS is, and that is unchanged.
      return { text: `barTile${i}()`, ttftMs: 1, totalMs: 2 };
    },
  };
}

async function fanOut({ temperature, alternatives, manual = true }) {
  const { CompletionService, DEFAULT_FIM_CONFIG } = need();
  const g = capturingGenerator();
  const svc = new CompletionService(
    { ...DEFAULT_FIM_CONFIG, temperature, debounceMs: 0, cacheCapacity: 100 },
    g.fn,
    () => {}
  );
  const req = { prefix: ALT_PREFIX, suffix: "", manual };
  if (alternatives !== undefined) req.alternatives = alternatives;
  const out = await svc.complete(req);
  svc.dispose();
  return { temps: g.calls.map((c) => c.temperature), out };
}

test("C1. `alternatives: 3` issues three generations: the configured temperature, 0.9 and 1.1, with the extras positional against the ladder [surface item 2 'Their temperatures are the configured one, 0.9, and 1.1. Order of the extras against the ladder is positional, not incidental']", async () => {
  const CONFIGURED = 0.01;
  const { temps } = await fanOut({ temperature: CONFIGURED, alternatives: 3 });
  assert.strictEqual(
    temps.length,
    3,
    `\`alternatives: 3\` must issue exactly three generations, got ${temps.length} (${JSON.stringify(temps)})`
  );
  assert.deepStrictEqual(
    temps.slice().sort((a, b) => a - b),
    [CONFIGURED, ...LADDER],
    `the three generations must run at ${JSON.stringify([CONFIGURED, ...LADDER])}, got ${JSON.stringify(temps)} - a single floor of max(config, 0.7) is the behaviour item 2 replaces`
  );
  assert.strictEqual(
    temps.filter((t) => t === CONFIGURED).length,
    1,
    `exactly one generation - the primary - keeps the configured temperature ${CONFIGURED}, got ${JSON.stringify(temps)}`
  );
  // The extras in the order they were issued, with the primary removed. The
  // primary is not necessarily first in the call log (extras launch before it
  // is awaited), so the ladder is read off the extras alone.
  const extras = temps.filter((t) => t !== CONFIGURED);
  assert.deepStrictEqual(
    extras,
    LADDER,
    `the extras must climb the ladder in order - first ${LADDER[0]}, then ${LADDER[1]} - got ${JSON.stringify(extras)}`
  );
});

test("C1. the primary keeps the configured temperature whatever it is: the spread is bought on the extras, never on the primary [surface item 2 'The primary keeps the configured temperature untouched' - and raising it measured 55.8% to 44.2%]", async () => {
  await table(
    [
      { name: "0.01 - the measured cold primary", t: 0.01 },
      { name: "0.05", t: 0.05 },
      { name: "0.2 - the shipped default for other rungs", t: 0.2 },
    ],
    async (row) => {
      const { temps } = await fanOut({ temperature: row.t, alternatives: 3 });
      assert.strictEqual(
        temps.filter((x) => x === row.t).length,
        1,
        `exactly one generation must run at the configured ${row.t}, got ${JSON.stringify(temps)}`
      );
    }
  );
});

test("C2. one generation on the single and automatic paths, at the configured temperature: nothing changes off the fan-out [surface item 2 '`alternatives: 1` (and no `alternatives` at all) issues exactly one generation ... Nothing changes on the automatic path']", async () => {
  const CONFIGURED = 0.01;
  await table(
    [
      { name: "`alternatives: 1`", alternatives: 1, manual: true },
      { name: "no `alternatives` key at all", alternatives: undefined, manual: true },
      { name: "`alternatives: 0`", alternatives: 0, manual: true },
      { name: "the automatic path with `alternatives: 3`", alternatives: 3, manual: false },
    ],
    async (row) => {
      const { temps } = await fanOut({ temperature: CONFIGURED, alternatives: row.alternatives, manual: row.manual });
      assert.deepStrictEqual(
        temps,
        [CONFIGURED],
        `exactly one generation at the configured ${CONFIGURED} belongs here, got ${JSON.stringify(temps)} - a ladder that reaches this path spends model time a keystroke never asked for`
      );
    }
  );
});

test("C3. a configured temperature above a ladder rung FLOORS that rung: the extras are never colder than the primary [surface item 2 'At `temperature: 1.5`, all three run at 1.5']", async () => {
  await table(
    [
      { name: "1.5 - above both rungs, so all three run at 1.5", t: 1.5, expect: [1.5, 1.5, 1.5] },
      { name: "1.1 - exactly the top rung", t: 1.1, expect: [1.1, 1.1, 1.1] },
      { name: "1.0 - above the first rung, below the second", t: 1.0, expect: [1.0, 1.0, 1.1] },
      { name: "0.9 - exactly the first rung", t: 0.9, expect: [0.9, 0.9, 1.1] },
    ],
    async (row) => {
      const { temps } = await fanOut({ temperature: row.t, alternatives: 3 });
      assert.deepStrictEqual(
        temps.slice().sort((a, b) => a - b),
        row.expect,
        `at a configured ${row.t} the three generations must run at ${JSON.stringify(row.expect)}, got ${JSON.stringify(temps)}`
      );
      assert.ok(
        temps.every((x) => x >= row.t),
        `no generation may be COLDER than the configured ${row.t}, got ${JSON.stringify(temps)}`
      );
    }
  );
});

test("C4. more extras than ladder rungs is allowed and produces no undefined temperature: the ladder extends by repeating its last rung [surface item 2 'The ladder extends by repeating its last rung']", async () => {
  const CONFIGURED = 0.01;
  await table(
    [
      { name: "`alternatives: 4` - one rung past the end", n: 4, extras: [0.9, 1.1, 1.1] },
      { name: "`alternatives: 5`", n: 5, extras: [0.9, 1.1, 1.1, 1.1] },
      { name: "`alternatives: 8`", n: 8, extras: [0.9, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1] },
    ],
    async (row) => {
      const { temps } = await fanOut({ temperature: CONFIGURED, alternatives: row.n });
      assert.strictEqual(
        temps.length,
        row.n,
        `\`alternatives: ${row.n}\` must issue ${row.n} generations, got ${temps.length} (${JSON.stringify(temps)})`
      );
      assert.ok(
        temps.every((t) => typeof t === "number" && Number.isFinite(t)),
        `every generation must carry a real temperature; got ${JSON.stringify(temps)} - an undefined rung is the ladder running off its end`
      );
      assert.deepStrictEqual(
        temps.filter((t) => t !== CONFIGURED),
        row.extras,
        `past the end of the ladder the last rung repeats: expected extras ${JSON.stringify(row.extras)}, got ${JSON.stringify(temps.filter((t) => t !== CONFIGURED))}`
      );
    }
  );
});

test("C5. everything else about the fan-out is unchanged: a failed extra costs one option and the call still returns, and distinct extras still survive dedup [surface item 2 'Everything else about the fan-out is unchanged']", async () => {
  const { CompletionService, DEFAULT_FIM_CONFIG } = need();

  // Distinct texts: the fan-out still yields alternates.
  const good = await fanOut({ temperature: 0.01, alternatives: 3 });
  assert.strictEqual(
    (good.out.alternates ?? []).length,
    2,
    `three distinct generations must leave two alternates, got ${JSON.stringify(good.out.alternates)}`
  );

  // One extra throws. The primary still answers and the call does not reject.
  // The extra is picked by temperature rather than by call index: at a
  // configured 0.01 every extra is hotter than the primary under the floor
  // behaviour AND under the ladder, so this row does not depend on which
  // rung an implementation chose or on the order the calls are logged in.
  const CONFIGURED = 0.01;
  let n = 0;
  let killed = false;
  const svc = new CompletionService(
    { ...DEFAULT_FIM_CONFIG, temperature: CONFIGURED, debounceMs: 0, cacheCapacity: 100 },
    async (params) => {
      n += 1;
      if (!killed && params && params.temperature !== CONFIGURED) {
        killed = true;
        throw new Error("the first extra died");
      }
      // `barTile${n}()` rather than v21's original `bar${n}()`, which was six
      // characters. This row builds on DEFAULT_FIM_CONFIG, and v25 fix 8 put a
      // minimum-length floor (8 characters, 2 alphanumerics) on that default,
      // so a six-character ghost is now refused and the row died on the
      // refusal rather than on anything about the fan-out. The fixture's length
      // was never the subject: C5 asserts a failed extra costs one option and
      // that distinct extras survive dedup, and both still read the same.
      return { text: `barTile${n}()`, ttftMs: 1, totalMs: 2 };
    },
    () => {}
  );
  const out = await svc.complete({ prefix: ALT_PREFIX, suffix: "", manual: true, alternatives: 3 });
  svc.dispose();
  assert.ok(
    out && typeof out.text === "string" && out.text.length > 0,
    `a failed extra costs one option, not the call: got ${JSON.stringify(out)}`
  );
  assert.strictEqual(
    (out.alternates ?? []).length,
    1,
    `one of two extras died, so exactly one alternate survives, got ${JSON.stringify(out.alternates)}`
  );
});
