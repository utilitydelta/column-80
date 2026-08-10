// One defect wore three hats. The provider used to judge a RECONSTRUCTION of
// the landed string, assembled from the retained prefix, the prelude it
// composes and the model's ghost, under branch logic. Two of the three premises
// in that reconstruction were false - a leading `.` on the ghost was mistaken
// for the member's own separator and stripped, and `\w` cannot spell `café` -
// and the third, that the widget's range always starts at the separator, was
// asserted and never read.
//
// So this file does not test the premises. It tests the only thing that
// matters: the text the buffer holds after the item lands, computed here from
// the document and the item's own range, with nothing borrowed from the
// provider. Every row that claims a serve names the landed line in full, and
// every row that claims a refusal is paired with a control that must serve.
//
// The gate is switchable per test, because the population these regressions
// live in spans both settings and the two existing v19 files each pin one.

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const TAG = ".impl-v19-landed";
const STUB = path.join(__dirname, `${TAG}-vscode-stub.cjs`);
const REGISTRY_STUB = path.join(__dirname, `${TAG}-registry.ts`);
const entry = path.join(__dirname, `${TAG}.entry.ts`);
const outfile = path.join(__dirname, `${TAG}.bundle.cjs`);
const buildScript = path.join(__dirname, `${TAG}.build.cjs`);

// The gate is read out of a global so one bundle serves both settings. A row
// that only holds at one setting would be a row that never proved which
// mechanism it was measuring.
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
      if (k === "fimAlternatives") { return 1; }
      if (k === "fimMemberGate") { return !!globalThis.__v19LandedGate; }
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
  return (globalThis as any).__v19LandedExtractor;
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
  if (buildError)
    assert.fail(`the bundle does not build: ${String(buildError.stderr || buildError.message).slice(0, 2000)}`);
  return mod;
};

// `endpoint` is a PROPERTY, so it has no arity and the arity leg cannot judge a
// call on it - which is what keeps the `(x)` control a control. `enrollTile`
// takes one argument. `café` and `日本` are the non-ASCII pair. `to`/`toString`
// and `get`/`getAll` are the short-name sibling pairs, where a one-character
// slip in the name check would be invisible against a long name.
const MEMBERS = [
  { name: "enrollTile", kind: "method", signature: "enrollTile(tile: Tile): boolean" },
  { name: "enrollTileTally", kind: "method", signature: "enrollTileTally(a: A, b: B): number" },
  { name: "enqueue", kind: "method", signature: "enqueue(job: Job): void" },
  { name: "endpoint", kind: "property", signature: "endpoint: string" },
  { name: "café", kind: "method", signature: "café(x: X): void" },
  { name: "日本", kind: "method", signature: "日本(x: X): void" },
  { name: "to", kind: "method", signature: "to(): string" },
  { name: "toString", kind: "method", signature: "toString(): string" },
  { name: "get", kind: "method", signature: "get(): V" },
  { name: "getAll", kind: "method", signature: "getAll(): V[]" },
];

const HEAD = "let s: Stripe;\n";
const LINE = 1;

function makePos(line, character) {
  return {
    line,
    character,
    translate(l, c) {
      return makePos(this.line + (l || 0), this.character + (c || 0));
    },
  };
}

function makeDoc(text) {
  const at = (p) => text.split("\n").slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return {
    version: 1,
    languageId: "typescript",
    uri: { toString: () => "file:///impl-v19-landed.ts" },
    get lineCount() {
      return text.split("\n").length;
    },
    lineAt(n) {
      const lines = text.split("\n");
      return { text: lines[n] ?? "", range: { end: makePos(n, (lines[n] ?? "").length) } };
    },
    getText(range) {
      return range ? text.slice(at(range.start), at(range.end)) : text;
    },
    offsetAt: at,
  };
}

// The widget's range and text are NOT one shape, and building only one is why
// three regressions passed six green suites before a review caught them.
// Measured against real servers, ten rows, four languages, two states:
//
//   - `dot`    TypeScript at an EMPTY partial: the range covers the separator
//              and the text carries it (`.enrollTile`). One row of the ten.
//   - `insert` C#, Python and Rust at an empty partial: an EMPTY range at the
//              cursor, and a BARE name. Three rows.
//   - `typed`  all four at a non-empty partial: the range covers only what was
//              typed, never the separator, and the text is a bare name. Six
//              rows, TypeScript included - it changes shape between its own two
//              states.
//
// `line` is `s.<typed>`, so the separator is character 1 and the name starts at
// character 2. A row that matters runs at all three via SHAPES.
const SHAPES = {
  // TypeScript at an empty partial: the range covers the separator and the text
  // carries it. One row of the ten measured.
  dot: {
    line: "s.",
    sci: (widgetText) => ({
      text: widgetText,
      range: { start: makePos(LINE, 1), end: makePos(LINE, 2) },
    }),
  },
  // C#, Python and Rust at an empty partial: an EMPTY range at the cursor, and
  // a bare name with no separator. Three rows.
  insert: {
    line: "s.",
    sci: (widgetText) => ({
      text: widgetText.replace(/^[.:]+/, ""),
      range: { start: makePos(LINE, 2), end: makePos(LINE, 2) },
    }),
  },
  // All four at a NON-empty partial: the range covers only what was typed,
  // never the separator, and the text is a bare name. Six rows, TypeScript
  // included - it changes shape between its own two states. This row carries a
  // real typed partial, which is what makes it distinct from `insert`: at an
  // empty partial the two are byte-identical, and a first attempt at this
  // helper shipped exactly that and claimed three shapes while delivering two.
  typed: {
    line: "s.enr",
    sci: (widgetText) => ({
      text: widgetText.replace(/^[.:]+/, ""),
      range: { start: makePos(LINE, 2), end: makePos(LINE, 5) },
    }),
  },
};

const SHAPE_NAMES = Object.keys(SHAPES);

// The default keeps the dot-covering range so existing rows read as they did.
// Rows exercising the landed-name check iterate SHAPE_NAMES instead.
const selection = (widgetText, cursorChar) => ({
  text: widgetText,
  range: { start: makePos(LINE, 1), end: makePos(LINE, cursorChar) },
});

// One provider, one service, one cache, a sequence of requests against a fixed
// buffer. `line` is the cursor line's text and the cursor sits at its end.
async function session({ line, gate, steps, ghost }) {
  const { FimCompletionProvider, CompletionService, DEFAULT_FIM_CONFIG } = need();
  globalThis.__v19LandedGate = !!gate;
  globalThis.__v19LandedExtractor = {
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

  const source = HEAD + line;
  const cursor = makePos(LINE, line.length);
  const logged = [];
  const calls = [];
  const service = new CompletionService(
    { ...DEFAULT_FIM_CONFIG, debounceMs: 0, cacheCapacity: 100 },
    async (req) => {
      calls.push(req);
      return { text: ghost(req), ttftMs: 1, totalMs: 2 };
    },
    (l) => logged.push(l)
  );
  const provider = new FimCompletionProvider(() => service, { appendLine: (l) => logged.push(l) });
  const doc = makeDoc(source);
  const results = [];

  for (const step of steps) {
    const before = calls.length;
    const raw = await provider.provideInlineCompletionItems(
      doc,
      cursor,
      { triggerKind: 0, selectedCompletionInfo: step },
      { onCancellationRequested: () => {}, isCancellationRequested: false }
    );
    const items = Array.isArray(raw) ? raw : (raw && raw.items) || [];
    results.push({ items, modelCalls: calls.length - before, landed: items.map((i) => landed(i, source)) });
  }

  service.dispose();
  return { results, logged, source };
}

// The oracle. What the buffer reads after the item lands, applied here the way
// VS Code applies it - replace the item's range with its text - using nothing
// the provider computed.
function landed(item, source) {
  const lines = source.split("\n");
  const at = (p) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return source.slice(0, at(item.range.start)) + String(item.insertText) + source.slice(at(item.range.end));
}

// A single widget selection is a PASSIVE preselect under the v19 preselect rule
// (the widget auto-highlights its first member), so it never becomes sticky. Any
// test that needs a sticky, post-Escape scope must first ARROW off a preselect.
// `arrowTo` models that: a throwaway preselect of a different member at the same
// document state, then the real selection (the arrow, which is what makes the
// scope stick), then the Escape. The target sits at WIDGET_ROW, the Escape at
// STICKY_ROW. The preselect name shares nothing with any target, so the arrow off
// it always registers.
const arrowTo = (targetSci) => {
  const sep = (/^[.:?\s]*/.exec(targetSci.text) ?? [""])[0];
  const preselect = { text: `${sep}zqxPreselect`, range: targetSci.range };
  return [preselect, targetSci, undefined];
};
const OPEN_THEN_ESCAPE = (widgetText, cursorChar) => arrowTo(selection(widgetText, cursorChar));
const WIDGET_ROW = 1;
const STICKY_ROW = 2;

const BOTH_GATES = [
  { name: "gate ON", gate: true },
  { name: "gate OFF", gate: false },
];

// ===========================================================================
// DO-A. The item is judged on the string the buffer will hold.
// ===========================================================================

test("DO-A. a scoped ghost that CONTINUES the fully-typed member - `.trim()`, `.length`, `::foo()` - is served on the row the user Tabs, at both gate settings", async () => {
  // The regression: with `endpoint` already spelled in the buffer, the ghost
  // opens with the separator of the NEXT access. Judging a reconstruction, the
  // provider mistook that separator for the member's own and spliced
  // `endpoint` onto `trim`. Every chained continuation and every property
  // access followed by a call is in this population, and the drop was silent.
  for (const { name, gate } of BOTH_GATES) {
    for (const g of [".trim()", ".length", "::foo()"]) {
      const { results } = await session({
        line: "s.endpoint",
        gate,
        steps: OPEN_THEN_ESCAPE(".endpoint", 10),
        ghost: () => g,
      });
      assert.deepStrictEqual(
        results[STICKY_ROW].landed,
        [`let s: Stripe;\ns.endpoint${g}`],
        `${name}: the post-Escape row must serve ${JSON.stringify(g)} and land it verbatim`
      );
      assert.deepStrictEqual(
        results[WIDGET_ROW].landed,
        [`let s: Stripe;\ns.endpoint${g}`],
        `${name}: and the widget-open row must agree with it, or the two rows disagree about the same edit`
      );
    }
  }
});

test("DO-A. controls for the continuation rows: a plain call still serves, and one keystroke earlier still serves - the fix is not 'serve everything'", async () => {
  for (const { name, gate } of BOTH_GATES) {
    const call = await session({
      line: "s.endpoint",
      gate,
      steps: OPEN_THEN_ESCAPE(".endpoint", 10),
      ghost: () => "(x)",
    });
    assert.deepStrictEqual(call.results[STICKY_ROW].landed, ["let s: Stripe;\ns.endpoint(x)"], `${name}: (x)`);

    // One keystroke earlier the member is NOT fully typed, so the ghost has to
    // carry the missing `t` as well as the continuation. This row was green
    // before the fix, and it has to stay green after it.
    const early = await session({
      line: "s.endpoin",
      gate,
      steps: OPEN_THEN_ESCAPE(".endpoint", 9),
      ghost: () => ".trim()",
    });
    assert.deepStrictEqual(
      early.results[STICKY_ROW].landed,
      ["let s: Stripe;\ns.endpoint.trim()"],
      `${name}: the one-keystroke-earlier row must still serve and still complete the name`
    );
  }
});

test("DO-A. a member name outside ASCII is served on both rows and at both gate settings - `\\w` is not what an identifier is made of", async () => {
  // `café` sits at `s.ca` because the site detector's partial is ASCII, so a
  // fully-typed `café` is not a member site at all - base behaviour, and not
  // this diff's to fix. `日本` has no ASCII head, so it sits at the bare dot.
  const rows = [
    { member: "café", line: "s.ca", cursor: 4 },
    { member: "日本", line: "s.", cursor: 2 },
  ];
  for (const { name, gate } of BOTH_GATES) {
    for (const row of rows) {
      const { results } = await session({
        line: row.line,
        gate,
        steps: OPEN_THEN_ESCAPE(`.${row.member}`, row.cursor),
        ghost: () => "(x)",
      });
      for (const at of [WIDGET_ROW, STICKY_ROW]) {
        assert.deepStrictEqual(
          results[at].landed,
          [`let s: Stripe;\ns.${row.member}(x)`],
          `${name}: ${row.member} on ${at === WIDGET_ROW ? "the widget-open" : "the sticky"} row`
        );
      }
    }
  }
});

test("DO-A. a SHORT sibling name is still refused on both rows and at both gate settings - serving the rows above by weakening the identity check would show up here", async () => {
  // The sibling pairs the round-1 refusals used are long, so a check that
  // matched a prefix, or dropped a trailing character, would still look right
  // on them. `to` against `toString` and `get` against `getAll` have no slack.
  const rows = [
    { scope: "to", ghost: "String()", sibling: "toString" },
    { scope: "get", ghost: "All()", sibling: "getAll" },
  ];
  for (const { name, gate } of BOTH_GATES) {
    for (const row of rows) {
      const { results, logged } = await session({
        line: "s.",
        gate,
        steps: OPEN_THEN_ESCAPE(`.${row.scope}`, 2),
        ghost: () => row.ghost,
      });
      for (const at of [WIDGET_ROW, STICKY_ROW]) {
        assert.deepStrictEqual(
          results[at].landed,
          [],
          `${name}: a scope of ${row.scope} must never land ${row.sibling}`
        );
      }
      assert.ok(
        logged.some((l) => l.includes(`widget selected ${row.scope}`)),
        `${name}: the refusal must name the selected member; got ${JSON.stringify(logged)}`
      );

      // CONTROL. The same landed line, reached under a scope of the sibling
      // itself, must be SERVED. Without this the row above is satisfied by a
      // rule that refuses everything short.
      const ok = await session({
        line: "s.",
        gate,
        steps: OPEN_THEN_ESCAPE(`.${row.sibling}`, 2),
        ghost: () => "()",
      });
      assert.deepStrictEqual(
        ok.results[STICKY_ROW].landed,
        [`let s: Stripe;\ns.${row.sibling}()`],
        `${name}: control - a scope of ${row.sibling} must serve ${row.sibling}()`
      );
    }
  }
});

test("DO-A. an insert-style widget range that does not cover the typed partial is refused rather than blessed - the premise the old reconstruction asserted and never read", async () => {
  // Closes the deferred S6. The reconstruction hard-coded the retained prefix
  // to empty whenever the widget supplied a range, on the premise that the
  // range starts at the separator. Reading the document instead needs no
  // premise: the range says what it replaces, and here it replaces nothing, so
  // `en` stands and the line lands `s.enenrollTile(a)`.
  for (const { name, gate } of BOTH_GATES) {
    const atCursor = { text: "enrollTile", range: { start: makePos(LINE, 4), end: makePos(LINE, 4) } };
    const { results, logged } = await session({
      line: "s.en",
      gate,
      steps: [atCursor],
      ghost: () => "(a)",
    });
    assert.deepStrictEqual(
      results[0].landed,
      [],
      `${name}: an item landing a duplicated fragment must not be served`
    );
    assert.ok(
      logged.some((l) => l.includes("would land enenrollTile")),
      `${name}: and it must say what it would have landed; got ${JSON.stringify(logged)}`
    );
  }
});


test("DO-A. unscoped typing-through is untouched: three ghosts at `s.enroll` with no selection ever, at both gate settings", async () => {
  // The whole landed-name check is gated on a scope being in force. This row is
  // the inertness net: if reading the document ever leaks onto an ordinary
  // keystroke, it shows up here first.
  for (const { name, gate } of BOTH_GATES) {
    for (const g of ["Tile(tile)", ".trim()", "(x)"]) {
      const { results } = await session({ line: "s.enroll", gate, steps: [undefined], ghost: () => g });
      assert.deepStrictEqual(
        results[0].landed,
        [`let s: Stripe;\ns.enroll${g}`],
        `${name}: unscoped ${JSON.stringify(g)} must be served exactly as written`
      );
    }
  }
});

// ===========================================================================
// DO-B. A scoped composition must not spell the member name twice.
// ===========================================================================

test("DO-B. a ghost re-spelling the member name after leading whitespace or a leading comment is repaired to spell it once, and says so, at both gate settings", async () => {
  // The provider composes `.enrollTile` ahead of the ghost. Both mechanisms
  // that would have caught a re-spelling were anchored at index 0, so one
  // leading space was enough to land `s.enrollTile enrollTile(tile)` with not
  // one line logged. Broken text and silence is the pairing the whole
  // scoped-name check exists to prevent.
  for (const { name, gate } of BOTH_GATES) {
    for (const g of [" enrollTile(tile)", "/*x*/enrollTile(tile)", "  \tenrollTile(tile)"]) {
      const { results, logged } = await session({
        line: "s.en",
        gate,
        steps: OPEN_THEN_ESCAPE(".enrollTile", 4),
        ghost: () => g,
      });
      for (const at of [WIDGET_ROW, STICKY_ROW]) {
        assert.deepStrictEqual(
          results[at].landed,
          ["let s: Stripe;\ns.enrollTile(tile)"],
          `${name}: ${JSON.stringify(g)} must land the member spelled once`
        );
      }
      assert.ok(
        logged.some((l) => l.includes("re-wrote enrollTile of enrollTile")),
        `${name}: the repair must leave evidence, or it hides a model failure from a dogfood log; got ${JSON.stringify(logged)}`
      );
    }
  }
});

test("DO-B. the three controls are unmoved: `(tile)` is not stripped, `rollTile(tile)` behaves as before, `enrollTile(tile)` behaves as before", async () => {
  for (const { name, gate } of BOTH_GATES) {
    // `(tile)` opens with a paren, which is neither a suffix of the name at
    // index 0 nor a lead. If the lead ran over arbitrary punctuation, `tile)`
    // would be tested against the whole name and this row would still hold -
    // but the row is cheap and it is the shape every ordinary call takes.
    const plain = await session({
      line: "s.en",
      gate,
      steps: OPEN_THEN_ESCAPE(".enrollTile", 4),
      ghost: () => "(tile)",
    });
    assert.deepStrictEqual(
      plain.results[STICKY_ROW].landed,
      ["let s: Stripe;\ns.enrollTile(tile)"],
      `${name}: (tile)`
    );
    assert.ok(
      !plain.logged.some((l) => l.includes("re-wrote")),
      `${name}: nothing was re-written, so nothing may be logged; got ${JSON.stringify(plain.logged)}`
    );

    // A suffix echo, and the whole name. Both were already caught at index 0,
    // and at gate ON both are dropped upstream by the gate composing
    // `memberPartial` onto the ghost's leading identifier. Pinned at the landed
    // string so the reason a row is empty is never guessed at.
    for (const g of ["rollTile(tile)", "enrollTile(tile)"]) {
      const echo = await session({
        line: "s.en",
        gate,
        steps: OPEN_THEN_ESCAPE(".enrollTile", 4),
        ghost: () => g,
      });
      assert.deepStrictEqual(
        echo.results[STICKY_ROW].landed,
        gate ? [] : ["let s: Stripe;\ns.enrollTile(tile)"],
        `${name}: ${g}`
      );
    }
  }
});

test("DO-B. leading whitespace alone consumes nothing: the lead is skipped only to look for an echo, never rendered away", async () => {
  // The cost of anchoring past whitespace would be a lead that disappears
  // whether or not it was hiding a repeat. It does not: with no echo behind it
  // the space is the model's own output and survives.
  for (const { name, gate } of BOTH_GATES) {
    const { results, logged } = await session({
      line: "s.en",
      gate,
      steps: OPEN_THEN_ESCAPE(".enrollTile", 4),
      ghost: () => " = tile",
    });
    assert.deepStrictEqual(
      results[STICKY_ROW].landed,
      ["let s: Stripe;\ns.enrollTile = tile"],
      `${name}: a lead with no echo behind it must be rendered verbatim`
    );
    assert.ok(
      !logged.some((l) => l.includes("re-wrote")),
      `${name}: and nothing may be reported as an echo; got ${JSON.stringify(logged)}`
    );
  }
});

// ===========================================================================
// DO-C. Past a lead, only the WHOLE name is an echo.
// ===========================================================================

test("DO-C. a whitespace-led ghost opening with a PROPER SUFFIX of the member name is ordinary continuation and is rendered verbatim, at both gate settings", async () => {
  // The regression: anchoring the echo check past the lead without also
  // narrowing the match left every ` as string` and ` m + n` being hunted for a
  // suffix of the member name, and a suffix runs down to ONE character. A
  // coincidence between the member's last letter and the continuation's first
  // was then enough to
  // either eat a character of the model's text or drop the serve outright -
  // `s.endpoint` + ` point()` landing `s.endpoint()`, `s.sum` + ` m + n`
  // landing `s.sum + n`. Authoritative-looking wrong output is the exact
  // failure this phase exists to prevent, one token to the right of where it
  // was first caught.
  //
  // Every row here lands wrong text under a suffix-matching past-lead anchor.
  // The last is the isolation control: the SAME ghost against a member whose
  // last letter does not match,
  // which must serve verbatim in every build and so proves the other rows are
  // measuring the match and not the lead.
  const ROWS = [
    // suffix `point`, several characters, the row that was reported and carried
    ["endpoint", ".endpoint", " point()"],
    // suffix `int`
    ["endpoint", ".endpoint", " int i = 0"],
    // suffix `t`, one character: the member's LAST letter is the ghost's first
    ["endpoint", ".endpoint", " to string"],
    // suffix `e`, one character, a different member and a different keyword
    ["enqueue", ".enqueue", " else 0"],
    // isolation: `enrollTile` ends in `e`, and no suffix of it opens with `t`
    ["enrollTile", ".enrollTile", " to string"],
  ];
  for (const { name, gate } of BOTH_GATES) {
    for (const [member, widgetText, g] of ROWS) {
      const { results, logged } = await session({
        line: "s.en",
        gate,
        steps: OPEN_THEN_ESCAPE(widgetText, 4),
        ghost: () => g,
      });
      for (const at of [WIDGET_ROW, STICKY_ROW]) {
        assert.deepStrictEqual(
          results[at].landed,
          [`let s: Stripe;\ns.${member}${g}`],
          `${name}: ${member} + ${JSON.stringify(g)} must render the model's text verbatim`
        );
      }
      assert.ok(
        !logged.some((l) => l.includes("re-wrote")),
        `${name}: nothing was an echo, so nothing may be reported as one; got ${JSON.stringify(logged)}`
      );
    }
  }
});

test("DO-B. a ghost whose first line is blank never reaches the strip at all - postprocess truncates a member-site completion to one line", async () => {
  // Why the lead stops at a newline is belt-and-braces rather than a measured
  // population: the pipeline drops this shape before the provider composes
  // anything. Pinned so that if postprocess ever starts passing multi-line
  // member completions through, the reader knows the lead's newline bound is
  // the thing standing between `enrollTile` and an `enrollTile(tile)` that the
  // model wrote on line two of its own accord.
  for (const { name, gate } of BOTH_GATES) {
    const { results } = await session({
      line: "s.en",
      gate,
      steps: OPEN_THEN_ESCAPE(".enrollTile", 4),
      ghost: () => "\n  enrollTile(tile)",
    });
    assert.deepStrictEqual(results[STICKY_ROW].landed, [], `${name}: nothing survives postprocess`);
  }
});


// ===========================================================================
// The backstop, across every measured widget-range shape and both rows.
//
// The review that found the truncation defects named why they got through: this
// file built ONE of the three shapes a real server produces. The first attempt
// at closing that built two and claimed three, because `insert` and `typed` are
// byte-identical until the typed shape carries a real partial.
// ===========================================================================

// One step list per shape: the widget row, then the sticky row after Escape.
// Each shape carries its own `line`, because that is what makes `insert` and
// `typed` distinct: at an empty partial they are byte-identical, and a first
// attempt at this helper shipped exactly that while claiming three shapes.
const shapeSteps = (shape, widgetText) => arrowTo(SHAPES[shape].sci(widgetText));

test("the ambiguous repeat is refused at EVERY measured range shape, on BOTH rows and BOTH gates - a re-spelling and a legitimate chain are one string, so the shape drops rather than being guessed at", async () => {
  // Every ghost here would land `s<sep>NAME<sep>NAME`. Refusing costs a genuine
  // `node.next.next`; serving costs a plausible wrong line, and a wrong line
  // that looks right is the failure this project ranks worst.
  const repeats = [
    ".enrollTile(t);",
    ". enrollTile(t);",
    ". /*c*/ enrollTile(t);",
    "?.enrollTile(t);",
    "::enrollTile(t);",
    "enrollTile.enrollTile(t);",
    ".enrollTile.push(a);",
    ".enrollTile = null;",
  ];
  for (const { name, gate } of BOTH_GATES) {
    for (const shape of SHAPE_NAMES) {
      for (const ghost of repeats) {
        const { results } = await session({
          line: SHAPES[shape].line,
          gate,
          steps: shapeSteps(shape, ".enrollTile"),
          ghost: () => ghost,
        });
        for (const row of [WIDGET_ROW, STICKY_ROW]) {
          assert.deepStrictEqual(
            results[row].landed,
            [],
            `${name}, ${shape} shape, row ${row}, ghost ${JSON.stringify(ghost)}: an ambiguous repeat must serve nothing`
          );
        }
      }
    }
  }
});

test("an optional-chaining BUFFER is covered too, not just an optional-chaining ghost - `s?.` is an ordinary member site and both separator spellings reach it", async () => {
  // The row that settled the severity argument in review round 2: at `s?.` the
  // `.` spelling was already refused while the `?.` spelling landed
  // `s?.enrollTile?.enrollTile(t);`. Whichever spelling the model picks has to
  // land in the same place.
  for (const ghost of [".enrollTile(t);", "?.enrollTile(t);"]) {
    const { results } = await session({
      line: "s?.",
      gate: false,
      steps: arrowTo({ text: ".enrollTile", range: { start: makePos(LINE, 2), end: makePos(LINE, 3) } }),
      ghost: () => ghost,
    });
    for (const row of [WIDGET_ROW, STICKY_ROW]) {
      assert.deepStrictEqual(
        results[row].landed,
        [],
        `s?. buffer, row ${row}, ghost ${JSON.stringify(ghost)}: both spellings must refuse`
      );
    }
  }
});

test("the neighbourhood does NOT move: an ordinary scoped ghost still serves at every shape and both rows", async () => {
  // Without this the rows above are satisfied by a rule that refuses
  // everything, which is the failure mode a suppression test invites.
  for (const shape of SHAPE_NAMES) {
    const { results } = await session({
      line: SHAPES[shape].line,
      gate: false,
      steps: shapeSteps(shape, ".enrollTile"),
      ghost: () => "(t);",
    });
    for (const row of [WIDGET_ROW, STICKY_ROW]) {
      assert.strictEqual(
        results[row].landed.length,
        1,
        `${shape} shape, row ${row}: a well-behaved scoped ghost must still be served`
      );
      assert.match(
        results[row].landed[0],
        /s\??\.enrollTile\(t\);/,
        `${shape} shape, row ${row}: and it must land the member spelled once`
      );
    }
  }
});

test("the twice-spelled refusal reaches NON-ASCII names in BOTH directions - `\\b` is ASCII and would have missed every one of them", async () => {
  for (const name of ["café", "日本"]) {
    const repeat = await session({
      line: "s.",
      gate: false,
      steps: shapeSteps("dot", `.${name}`),
      ghost: () => `.${name}(x);`,
    });
    assert.deepStrictEqual(
      repeat.results[WIDGET_ROW].landed,
      [],
      `${name}: the repeat must be refused, exactly as an ASCII name is`
    );
  }
  // The other direction, which the previous version of this test claimed in a
  // comment and never asserted: a SIBLING whose name merely starts with the
  // member's is not a repeat and must be served. Without it the rows above are
  // satisfied by a rule that refuses any name-shaped tail.
  const sibling = await session({
    line: "s.",
    gate: false,
    steps: shapeSteps("dot", ".café"),
    ghost: () => "(x);",
  });
  assert.strictEqual(
    sibling.results[WIDGET_ROW].landed.length,
    1,
    "a well-behaved non-ASCII scoped ghost must serve"
  );
});

test("`separatorOk` is pinned: a bare widget text against a separator-covering range must not land `senrollTile(t);`", async () => {
  // This guard was unreachable by every one of 3186 tests until this row.
  // Forcing it true has to turn this red, which is what makes it a guard rather
  // than dead code. The shape: the widget's range covers the separator, so the
  // item replaces it, but the text carries no separator to put back.
  const { results, logged } = await session({
    line: "s.",
    gate: false,
    steps: arrowTo({ text: "enrollTile", range: { start: makePos(LINE, 1), end: makePos(LINE, 2) } }),
    ghost: () => "(t);",
  });
  assert.deepStrictEqual(
    results[WIDGET_ROW].landed,
    [],
    "an item that eats the separator would land `senrollTile(t);`, which names the right member and is not the right line"
  );
  assert.ok(
    logged.some((l) => l.includes("separator")),
    `the refusal names the separator run; got ${JSON.stringify(logged.filter((l) => l.includes("dropped")))}`
  );
});

test("a JS/TS PRIVATE FIELD scope does not disarm the guards - `#` is a comment to the pipeline's masker and a lead-tolerant strip ate the whole name", async () => {
  // Round 3's finding, and it was caused by round 2's fix. `maskNonCode` treats
  // `#` as a line comment in every language because Python needs it to, so a
  // lead-TOLERANT separator strip applied to the widget text `.#count` consumed
  // the `#` and everything after it. `scope.name` became `""`, and three guards
  // failed at once: the snippet check flipped, the landed-name comparison
  // became `"" !== ""`, and the twice-spelled test matched an empty name.
  //
  // Both rows below were SERVED by that build. Row 1 is the wrong-member class
  // phase 1 exists to prevent; row 2 is the ambiguous repeat round 2 closed.
  for (const ghost of ["Total + 1;", ".#count + 1;"]) {
    const { results } = await session({
      line: "this.",
      gate: false,
      steps: arrowTo({ text: ".#count", range: { start: makePos(LINE, 4), end: makePos(LINE, 5) } }),
      ghost: () => ghost,
    });
    for (const row of [WIDGET_ROW, STICKY_ROW]) {
      assert.deepStrictEqual(
        results[row].landed,
        [],
        `private field, row ${row}, ghost ${JSON.stringify(ghost)}: must not serve`
      );
    }
  }
});

// v21 item 12: a widget selection that names no member forms no scope at all,
// rather than a scope named "". `#count` and `@class` read EMPTY through the
// identifier run for the same reason `[Symbol]` does, and they are the opposite
// case - both are real members the user can arrow to and Tab. Dropping their
// scope serves an unscoped ghost at a site the guards were refusing, which is
// the wrong-member class this whole file exists to prevent.
test("a C# ESCAPED IDENTIFIER holds a scope like any other member - `@class` reads empty through the identifier run and is still a member", async () => {
  for (const ghost of ["Total + 1;", ".@class + 1;"]) {
    const { results } = await session({
      line: "this.",
      gate: false,
      steps: arrowTo({ text: ".@class", range: { start: makePos(LINE, 4), end: makePos(LINE, 5) } }),
      ghost: () => ghost,
    });
    for (const row of [WIDGET_ROW, STICKY_ROW]) {
      assert.deepStrictEqual(
        results[row].landed,
        [],
        `escaped identifier, row ${row}, ghost ${JSON.stringify(ghost)}: must not serve`
      );
    }
  }
});

test("a TERNARY colon is not a separator, so an ordinary conditional is served rather than read as the name spelled twice", async () => {
  // A lone `:` was briefly in the shared separator run. It made
  // `let v = c ? s.name : name;` look like `s.name` followed by a separator and
  // `name` again, and the backstop refused ordinary code. `::` is matched as a
  // pair; a lone `:` is not a separator.
  const { results } = await session({
    line: "let v = c ? s.",
    gate: false,
    steps: arrowTo({ text: ".name", range: { start: makePos(LINE, 13), end: makePos(LINE, 14) } }),
    ghost: () => " : name;",
  });
  assert.deepStrictEqual(
    results[WIDGET_ROW].landed,
    ["let s: Stripe;\nlet v = c ? s.name : name;"],
    "a ternary branch that happens to repeat the member name is not a re-spelling"
  );
});
