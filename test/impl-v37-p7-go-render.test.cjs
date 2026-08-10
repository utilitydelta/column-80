// IMPLEMENTER tests - session-v37 item 7, the Go def elider.
// White-box: written against `goElideDef` / `goElisionLogLine` in
// src/core/goExtraction.ts and `goShapeHooks` in src/core/crossFileShape.ts.
//
// The defect: a gopls type hover is the declaration PLUS the source's own doc
// comments PLUS gopls's `// size=728 (0x2d8), class=768 (0x300)` layout chrome,
// and the product emitted every byte of it. `cobra.Command` hovers at 8363
// bytes, roughly eleven times the per-type budget the rest of this session
// assumes, so one Go candidate could spend the whole injected surface.
//
// THE BAR every row holds: a field line is never cut. An elider that also drops
// surface is a truncator wearing a nicer name, so every row that expects a drop
// carries a CONTROL field in the same fixture that must survive byte for byte,
// and the accounting row proves the three byte classes add up to the whole drop
// with nothing unattributed.
//
// The corpus rows run on test/fixtures/v37-go-hovers.json: REAL gopls hovers,
// captured live from ~/sandbox/v23-corpus (cobra, gin, hugo). They are the
// reason the byte bound below is a measurement rather than a guess.
//
// Run: SKIP_LIVE=1 node --test test/impl-v37-p7-go-render.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v37-p7-go-render",
  `export { goElideDef, goElisionLogLine } from "../src/core/goExtraction";
export {
  goShapeHooks,
  tsShapeHooks,
  csShapeHooks,
  pyShapeHooks,
  shapeHooksFor,
  renderDerivedDef,
  toResolveStruct,
} from "../src/core/crossFileShape";
export { tsRenderDerivedDef } from "../src/core/tsExtraction";\n`,
);
const {
  goElideDef,
  goElisionLogLine,
  goShapeHooks,
  tsShapeHooks,
  csShapeHooks,
  pyShapeHooks,
  shapeHooksFor,
  renderDerivedDef,
  toResolveStruct,
  tsRenderDerivedDef,
} = mod;
test.after(cleanup);

const B = (s) => Buffer.byteLength(s, "utf8");
const CORPUS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "v37-go-hovers.json"), "utf8"),
);

// ===========================================================================
// 1. THE SHAPES. One whole hover in, one whole hover out, asserted as BYTES.
// Every `want` here is written out in full on purpose: a row that asserted a
// substring would pass while the elider quietly ate a field.
// ===========================================================================

const SHAPES = [
  {
    what: "the gopls size chrome comes off the header and both fields survive",
    hover: "type Group struct { // size=32 (0x20)\n\tID    string\n\tTitle string\n}",
    want: "type Group struct {\n\tID    string\n\tTitle string\n}",
    chrome: 18,
    prose: 0,
    blank: 0,
    fields: 2,
  },
  {
    what: "chrome on a non-struct declaration: an alias, a typed int and a func type",
    hover: "type FParseErrWhitelist flag.ParseErrorsAllowlist // size=1, class=8",
    want: "type FParseErrWhitelist flag.ParseErrorsAllowlist",
    chrome: 19,
    prose: 0,
    blank: 0,
    fields: 0,
  },
  {
    what: "gopls's waste annotation is chrome too",
    hover: "type CompletionOptions struct { // size=16 (0x10) (25% wasted)\n\tDisableDefaultCmd bool\n}",
    want: "type CompletionOptions struct {\n\tDisableDefaultCmd bool\n}",
    chrome: 31,
    prose: 0,
    blank: 0,
    fields: 1,
  },
  {
    what: "a one-line field doc comment goes; the uncommented control field beside it does not",
    hover:
      "type Cmd struct { // size=32 (0x20)\n" +
      "\t// Short is the short description shown in the 'help' output.\n" +
      "\tShort string\n" +
      "\tGroupID string\n" +
      "}",
    want: "type Cmd struct {\n\tShort string\n\tGroupID string\n}",
    chrome: 18,
    prose: 63,
    blank: 0,
    fields: 2,
  },
  {
    what: "a multi-paragraph doc comment goes whole, blank separators included, and the control field stays",
    hover:
      "type Cmd struct { // size=8\n" +
      "\t// Use is the one-line usage message.\n" +
      "\t// Recommended syntax is as follows:\n" +
      "\t//   [ ] identifies an optional argument.\n" +
      "\t//\n" +
      "\t// Example: add [-F file | -D dir]... [-f format] profile\n" +
      "\tUse string\n" +
      "\n" +
      "\t// Aliases is an array of aliases.\n" +
      "\tAliases []string\n" +
      "\tVersion string\n" +
      "}",
    want: "type Cmd struct {\n\tUse string\n\tAliases []string\n\tVersion string\n}",
    chrome: 10,
    prose: 219,
    blank: 1,
    fields: 3,
  },
  {
    what: "a field with no comment at all is kept verbatim, alignment padding included",
    hover:
      "type Site struct { // size=256 (0x100)\n" +
      "\tstate       siteState\n" +
      "\tconf        *allconfig.Config\n" +
      "\tsiteWrapped page.Site\n" +
      "}",
    want:
      "type Site struct {\n" +
      "\tstate       siteState\n" +
      "\tconf        *allconfig.Config\n" +
      "\tsiteWrapped page.Site\n" +
      "}",
    chrome: 20,
    prose: 0,
    blank: 0,
    fields: 3,
  },
  {
    what: "an embedded struct field is a field: it survives with its pointer and package path",
    hover:
      "type Site struct { // size=256 (0x100)\n" +
      "\t// The owning container.\n" +
      "\th *HugoSites\n" +
      "\n" +
      "\t*deps.Deps\n" +
      "\t*siteLanguageVersionRole\n" +
      "}",
    want: "type Site struct {\n\th *HugoSites\n\n\t*deps.Deps\n\t*siteLanguageVersionRole\n}",
    chrome: 20,
    prose: 26,
    blank: 0,
    fields: 3,
  },
  {
    what: "a field whose TYPE is a func keeps its own commas: no comma-split parse touches this",
    hover:
      "type Command struct { // size=728 (0x2d8), class=768 (0x300)\n" +
      "\t// PersistentPreRunE runs before the command.\n" +
      "\tPersistentPreRunE func(cmd *Command, args []string) error\n" +
      "\tglobNormFunc func(f *flag.FlagSet, name string) flag.NormalizedName\n" +
      "}",
    want:
      "type Command struct {\n" +
      "\tPersistentPreRunE func(cmd *Command, args []string) error\n" +
      "\tglobNormFunc func(f *flag.FlagSet, name string) flag.NormalizedName\n" +
      "}",
    chrome: 39,
    prose: 47,
    blank: 0,
    fields: 2,
  },
  {
    what: "a struct with no fields loses its chrome and keeps its braces",
    hover: "type Nothing struct { // size=0\n}",
    want: "type Nothing struct {\n}",
    chrome: 10,
    prose: 0,
    blank: 0,
    fields: 0,
  },
  {
    what: "a hover with no chrome and no comments comes back BYTE-IDENTICAL",
    hover: "type Error struct {\n\tErr  error\n\tType ErrorType\n\tMeta any\n}",
    want: "type Error struct {\n\tErr  error\n\tType ErrorType\n\tMeta any\n}",
    chrome: 0,
    prose: 0,
    blank: 0,
    fields: 3,
  },
  {
    what: "a trailing comment on a field line goes; the field line does not",
    hover: "type Ctx struct {\n\tIndex int8 // the handler cursor\n\tPath  string\n}",
    want: "type Ctx struct {\n\tIndex int8\n\tPath  string\n}",
    chrome: 0,
    prose: 22,
    blank: 0,
    fields: 2,
  },
  {
    what: "a `//` inside a raw-string struct tag is not a comment: the tag keeps every byte",
    hover: "type Cfg struct {\n\tHome string `json:\"home\" doc:\"see http://x/y\"`\n\tPort int\n}",
    want: "type Cfg struct {\n\tHome string `json:\"home\" doc:\"see http://x/y\"`\n\tPort int\n}",
    chrome: 0,
    prose: 0,
    blank: 0,
    fields: 2,
  },
  {
    what: "a blank line that separates FIELDS survives; only a prose separator is swept",
    hover: "type Paths struct { // size=120 (0x78)\n\tFs  *hugofs.Fs\n\n\tAbsPublishDir string\n}",
    want: "type Paths struct {\n\tFs  *hugofs.Fs\n\n\tAbsPublishDir string\n}",
    chrome: 19,
    prose: 0,
    blank: 0,
    fields: 2,
  },
  {
    what: "a block comment that owns its lines is prose; the field under it is not",
    hover: "type Cfg struct {\n\t/* the port the\n\t   server binds */\n\tPort int\n}",
    want: "type Cfg struct {\n\tPort int\n}",
    chrome: 0,
    prose: 37,
    blank: 0,
    fields: 1,
  },
];

for (const s of SHAPES) {
  test(`elide: ${s.what}`, () => {
    const e = goElideDef(s.hover);
    assert.equal(e.text, s.want, `text mismatch\n--- got ---\n${e.text}\n--- want ---\n${s.want}`);
    assert.equal(e.beforeBytes, B(s.hover), "beforeBytes must be the hover's own byte length");
    assert.equal(e.afterBytes, B(s.want), "afterBytes must be the rendered byte length");
    assert.equal(e.chromeBytes, s.chrome, "gopls chrome bytes");
    assert.equal(e.proseBytes, s.prose, "doc/trailing prose bytes");
    assert.equal(e.blankBytes, s.blank, "blank-separator bytes");
    assert.equal(e.keptBodyLines, s.fields, "field lines kept");
  });
}

test("elide: the three byte classes account for the WHOLE drop, on every shape", () => {
  for (const s of SHAPES) {
    const e = goElideDef(s.hover);
    assert.equal(
      e.chromeBytes + e.proseBytes + e.blankBytes,
      e.beforeBytes - e.afterBytes,
      `unattributed bytes in: ${s.what}`,
    );
  }
});

test("elide: an empty hover is an empty render, not a throw", () => {
  const e = goElideDef("");
  assert.equal(e.text, "");
  assert.equal(e.beforeBytes, 0);
  assert.equal(e.afterBytes, 0);
  assert.equal(e.keptBodyLines, 0);
});

// ===========================================================================
// 2. THE REAL CORPUS. 13 types, hovers captured live from cobra, gin and hugo.
// The numbers are asserted exactly: a change that moves one of them is a
// finding, and it should have to be re-measured rather than re-typed.
// ===========================================================================

const EXPECTED = {
  "cobra.Command": { before: 8363, after: 1944, chrome: 39, prose: 6346, blank: 34, fields: 68 },
  "cobra.CompletionOptions": { before: 705, after: 177, chrome: 31, prose: 497, blank: 0, fields: 5 },
  "cobra.Group": { before: 67, after: 49, chrome: 18, prose: 0, blank: 0, fields: 2 },
  "cobra.FParseErrWhitelist": { before: 68, after: 49, chrome: 19, prose: 0, blank: 0, fields: 0 },
  "cobra.ShellCompDirective": { before: 37, after: 27, chrome: 10, prose: 0, blank: 0, fields: 0 },
  "cobra.PositionalArgs": { before: 69, after: 59, chrome: 10, prose: 0, blank: 0, fields: 0 },
  "gin.Engine": { before: 4255, after: 811, chrome: 39, prose: 3390, blank: 15, fields: 30 },
  "gin.Context": { before: 1042, after: 389, chrome: 20, prose: 626, blank: 7, fields: 17 },
  "gin.RouterGroup": { before: 136, after: 101, chrome: 35, prose: 0, blank: 0, fields: 4 },
  "gin.RouteInfo": { before: 145, after: 110, chrome: 35, prose: 0, blank: 0, fields: 4 },
  "gin.Error": { before: 94, after: 59, chrome: 35, prose: 0, blank: 0, fields: 3 },
  "hugo.Site": { before: 390, after: 343, chrome: 20, prose: 26, blank: 1, fields: 11 },
  "hugo.Paths": { before: 778, after: 205, chrome: 37, prose: 532, blank: 4, fields: 7 },
};

for (const [name, want] of Object.entries(EXPECTED)) {
  test(`corpus [${name}]: the live gopls hover elides to the measured bytes`, () => {
    const row = CORPUS.types[name];
    assert.ok(row, `${name} missing from the fixture`);
    const e = goElideDef(row.hover);
    assert.equal(e.beforeBytes, want.before, "hover bytes");
    assert.equal(e.afterBytes, want.after, "injected bytes");
    assert.equal(e.chromeBytes, want.chrome, "chrome bytes");
    assert.equal(e.proseBytes, want.prose, "prose bytes");
    assert.equal(e.blankBytes, want.blank, "blank-separator bytes");
    assert.equal(e.keptBodyLines, want.fields, "field lines kept");
  });
}

// THE STATED BOUND. 2048 bytes for one injected Go def, held by the worst type
// in three real repos: cobra.Command at 1944. It is a bar on the measurement,
// not a cap in the product - nothing truncates at it. A hover that renders over
// it is a new shape nobody has measured, and this row is where that shows up.
const GO_DEF_BYTE_BOUND = 2048;

test("corpus: cobra.Command injects its field lines and no prose, under the stated 2048-byte bound", () => {
  const e = goElideDef(CORPUS.types["cobra.Command"].hover);
  assert.equal(e.beforeBytes, 8363, "the goal's figure, re-measured live");
  assert.ok(
    e.afterBytes <= GO_DEF_BYTE_BOUND,
    `cobra.Command renders ${e.afterBytes}B, over the ${GO_DEF_BYTE_BOUND}B bound`,
  );
  assert.equal(e.text.includes("//"), false, "no comment survives the render");
  assert.equal(e.text.includes("one-line usage message"), false, "no doc prose survives");
  // The fields the model has to type against, spread across the whole struct.
  for (const field of [
    "\tUse string",
    "\tArgs PositionalArgs",
    "\tRunE func(cmd *Command, args []string) error",
    "\tglobNormFunc func(f *flag.FlagSet, name string) flag.NormalizedName",
    "\tSuggestionsMinimumDistance int",
  ]) {
    assert.ok(e.text.includes(`${field}\n`) || e.text.endsWith(field), `lost field line: ${field}`);
  }
});

test("corpus: every one of the 13 live types renders under the stated bound", () => {
  for (const [name, row] of Object.entries(CORPUS.types)) {
    const e = goElideDef(row.hover);
    assert.ok(e.afterBytes <= GO_DEF_BYTE_BOUND, `${name}: ${e.afterBytes}B over the bound`);
  }
});

// THE ANTI-TRUNCATION ROW. Every line of every real hover that is not a comment
// and not blank must appear in the render, minus its trailing comment. This is
// the row that separates an elision from a cut.
test("corpus: not one field line is dropped, across all 13 live hovers", () => {
  for (const [name, row] of Object.entries(CORPUS.types)) {
    const out = goElideDef(row.hover).text.split("\n");
    for (const line of row.hover.split("\n")) {
      const t = line.trim();
      if (t.length === 0 || t.startsWith("//")) {
        continue;
      }
      const at = line.indexOf("//");
      const wanted = (at >= 0 ? line.slice(0, at).replace(/\s+$/, "") : line);
      assert.ok(out.includes(wanted), `${name}: field line vanished: ${JSON.stringify(wanted)}`);
    }
  }
});

// ===========================================================================
// 3. THE DIAGNOSTIC CHANNEL. The dropped bytes are named, and a reader auditing
// the channel can tell this line from a cap that ate a real surface.
// ===========================================================================

test("channel: the line names the byte count, the split and the surviving field lines", () => {
  const e = goElideDef(CORPUS.types["cobra.Command"].hover);
  const line = goElisionLogLine("Command", e);
  assert.ok(line.includes("`Command`"), "names the type");
  assert.ok(line.includes("6419B"), "names the total dropped bytes");
  assert.ok(line.includes("8363B -> 1944B"), "names before and after");
  assert.ok(line.includes("chrome 39B"), "names the chrome bytes");
  assert.ok(line.includes("101 comment line(s) 6346B"), "names the prose bytes and lines");
  assert.ok(line.includes("blank separators 34B"), "names the blank-separator bytes");
  assert.ok(line.includes("all 68 field line(s) kept, none cut"), "says nothing was cut");
});

test("channel: the elision line never says `truncated` - that word belongs to the caps", () => {
  for (const [name, row] of Object.entries(CORPUS.types)) {
    const line = goElisionLogLine(name, goElideDef(row.hover));
    assert.equal(/truncat/i.test(line), false, `${name}: the elision line reads as a truncation`);
    assert.ok(/\bkept\b/.test(line) && /\belided\b/.test(line), `${name}: the line must say what it did`);
  }
});

// ===========================================================================
// 4. THE OTHER FOUR LANGUAGES DO NOT MOVE. Go used to run the Rust default
// renderer; taking it off that path must not perturb the path. The same hover
// text - one the Go rule WOULD elide by 57 bytes - through all five renderers.
// ===========================================================================

const SHARED = "type Group struct { // size=32 (0x20)\n\t// ID is the group id.\n\tID string\n}";

test("renderers: Rust, TypeScript, C# and Python return the hover byte for byte; only Go elides", () => {
  const t = { name: "Group", signature: SHARED, fields: [], methods: [], methodsResolved: true };
  assert.equal(renderDerivedDef(t), SHARED, "the Rust default renderer moved");
  assert.equal(tsRenderDerivedDef(t), SHARED, "the TypeScript renderer moved");
  assert.equal(csShapeHooks.renderDef(t), SHARED, "the C# renderer moved");
  assert.equal(pyShapeHooks.renderDef(t), SHARED, "the Python renderer moved");
  assert.equal(goShapeHooks.renderDef(t), "type Group struct {\n\tID string\n}");
  assert.equal(B(SHARED) - B(goShapeHooks.renderDef(t)), 42, "the Go drop, in bytes");
});

test("registry: go now dispatches to goShapeHooks and every other id is where it was", () => {
  assert.equal(shapeHooksFor("go"), goShapeHooks);
  assert.equal(shapeHooksFor("typescript"), tsShapeHooks);
  assert.equal(shapeHooksFor("typescriptreact"), tsShapeHooks);
  assert.equal(shapeHooksFor("javascript"), tsShapeHooks);
  assert.equal(shapeHooksFor("csharp"), csShapeHooks);
  assert.equal(shapeHooksFor("python"), pyShapeHooks);
  assert.equal(shapeHooksFor("rust"), undefined, "Rust still runs the no-hooks defaults");
  assert.equal(shapeHooksFor("golang"), undefined, "only the `go` language id dispatches");
});

test("registry: the Go hooks now parse Go fields, and bring nothing else", () => {
  // RE-CUT 2026-08-10 (session-v49 phase 1), and this row asked for it in its
  // own words. It used to assert `parseHoverFields(...) === []` under the title
  // "the Go hooks keep the field leg on the Rust defaults", with the comment:
  // "a hooks object that started parsing Go fields would change the walk, which
  // is a different change with its own measurement." Session-v49 IS that change
  // and it carries that measurement, so this is a supersession by content and
  // not a row bent to go green.
  //
  // What it asserts now is the same shape of claim, inverted: the field leg is
  // LIT, and nothing else about the Go hooks moved with it.
  const fields = goShapeHooks.parseFields(CORPUS.types["cobra.Command"].hover, [], []);
  assert.equal(fields.length, 66, "cobra.Command declares 66 fields in its captured hover");
  assert.deepEqual(fields.slice(0, 3), [
    { name: "Use", typeName: "string" },
    { name: "Aliases", typeName: "[]string" },
    { name: "SuggestFor", typeName: "[]string" },
  ]);
  // A Go type that is NOT a struct still yields nothing, which is what keeps the
  // parser from claiming a shape it cannot read: `FParseErrWhitelist` is a map
  // type, `ShellCompDirective` an int type, `PositionalArgs` a func type.
  for (const name of ["cobra.FParseErrWhitelist", "cobra.ShellCompDirective", "cobra.PositionalArgs"]) {
    assert.deepEqual(goShapeHooks.parseFields(CORPUS.types[name].hover, [], []), [], `${name} is not a struct`);
  }
  assert.equal(goShapeHooks.refuseHover, undefined);
  assert.equal(goShapeHooks.signatureRefTypes, undefined);
  assert.equal(goShapeHooks.enumMemberLine, undefined);
  assert.equal(goShapeHooks.rewriteMembers, undefined);
});

// ===========================================================================
// 5. THE QUALIFIER-AWARE skipCandidate. The Go standard library declares 186
// single-letter structs; the single-letter default would drop every one. The
// field leg that would reach this is dark today, which is exactly why the guard
// is written now: the door opens on someone else's change.
// ===========================================================================

const SKIP = [
  { name: "T", fieldType: "*testing.T", skip: false, why: "a package-qualified std type is a real type" },
  { name: "B", fieldType: "*testing.B", skip: false, why: "testing.B is a struct, not a parameter" },
  { name: "T", fieldType: "[]T", skip: true, why: "a bare single letter in a slice is a type parameter" },
  { name: "T", fieldType: "*Node[T]", skip: true, why: "a bare single letter in a generic argument list" },
  { name: "K", fieldType: "map[K]V", skip: true, why: "both map parameters are parameters" },
  { name: "T", fieldType: "map[string]*testing.T", skip: false, why: "qualified inside a map value" },
  { name: "T", fieldType: undefined, skip: true, why: "no field type to check: the safe answer is the default" },
  { name: "Node", fieldType: "*Node[T]", skip: false, why: "a multi-letter name is never a parameter" },
  { name: "T1", fieldType: "[]T1", skip: false, why: "single LETTER, deliberately not `short`" },
];

for (const s of SKIP) {
  test(`skipCandidate [go]: ${s.name} in ${s.fieldType ?? "(no field type)"} - ${s.why}`, () => {
    assert.equal(goShapeHooks.skipCandidate(s.name, s.fieldType), s.skip);
  });
}

test("skipCandidate [ts]: the new second argument does not move the TypeScript rule", () => {
  assert.equal(tsShapeHooks.skipCandidate("T"), true);
  assert.equal(tsShapeHooks.skipCandidate("T", "*testing.T"), true, "TS ignores the field type, as before");
  assert.equal(tsShapeHooks.skipCandidate("Order"), false);
  assert.equal(tsShapeHooks.skipCandidate("Order", "Order<T>"), false);
});

// ===========================================================================
// 6. THE WIRING. The elided text is what the injected def actually is, not
// something only this test can see.
// ===========================================================================

const shapeOf = (name, signature) => ({
  types: new Map([[name, { name, signature, fields: [], methods: [], methodsResolved: true }]]),
  dropped: [],
});

test("wiring: toResolveStruct with the Go hooks emits the elided def", () => {
  const hover = CORPUS.types["gin.Engine"].hover;
  const def = toResolveStruct(shapeOf("Engine", hover), goShapeHooks)("Engine").def;
  assert.equal(def, goElideDef(hover).text);
  assert.equal(B(def), 811);
});

test("wiring: without the Go hooks the same shape still emits the whole hover", () => {
  const hover = CORPUS.types["gin.Engine"].hover;
  assert.equal(toResolveStruct(shapeOf("Engine", hover))("Engine").def, hover);
});

test("wiring: a hover-less Go type names itself and claims nothing about its shape", () => {
  const def = toResolveStruct(shapeOf("Engine", ""), goShapeHooks)("Engine").def;
  assert.equal(def, "type Engine");
});
