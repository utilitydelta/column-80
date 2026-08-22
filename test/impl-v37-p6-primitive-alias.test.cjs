// WHITE-BOX rows for session-v37 item 6: a TypeScript alias of a primitive must
// inject its def and NO member list.
//
// THE DEFECT. `type SuppressionKind = "bound-unsafe" | "comment-introduced" |
// "in-comment" | "below-floor"` resolves 48 members and every one of them
// belongs to `String`: `toString(): string`, `charAt(pos: number): string`,
// `fontcolor(color: string): string`, down to `matchAll`. The def line is right;
// the MEMBER list under "real signatures, use these exact names, do not invent"
// is the primitive's prototype. Measured by the primitive-alias spike: the
// member leg costs 1112 bytes against a 161-byte def, so 87% of that candidate's
// block is junk, and 26 of this repo's 55 exported type aliases are that shape.
//
// WHERE THE FIX SITS. In the RENDERER (`tsShapeBlock`), not the walk. The
// prefill admits a candidate to the shape path only when it resolved fields or
// methods, and a primitive alias has no fields, so a walk that returned no
// members would drop the whole block and take the def line with it. Refusing at
// the render keeps the def, which is the half worth having.
//
// THE FIXTURE IS CAPTURED, NOT AUTHORED. test/fixtures/v37-primitive-alias.json
// carries the hover signatures and member lists the real TypeScript language
// service returned for this repo's own types, harvested by that same spike. Rows
// that need a shape this repo does not contain (an alias of an object type, a
// generic alias) are authored and say so.
//
// ANTI-VACUITY. Every row that expects no member list renders a CONTROL type out
// of the same shape in the same assertion, and asserts the control's member list
// IS injected, to the byte. A dead member leg fails those controls.
//
// Run: SKIP_LIVE=1 node --test test/impl-v37-p6-primitive-alias.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "v37-primitive-alias.json"), "utf8"),
).types;

// fn-gen sits behind the vscode module, so it needs the stub-alias bundle.
// Mechanics copied from test/impl-v37-p1-comment-anchor.test.cjs.
const STUB = path.join(__dirname, ".impl-v37-p6-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
module.exports = {
  Position, Range, Selection: Range, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: {}, EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: {},
  workspace: { getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }) },
};
`,
);
const ENTRY = path.join(__dirname, ".impl-v37-p6.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v37-p6.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  [
    `export { isPrimitiveAliasHover } from "../src/core/tsExtraction";`,
    `export { MEMBER_CAP } from "../src/core/extraction";`,
    `export { prefillLangFor, FNGEN_PROFILE } from "../src/vscode/fnGen";`,
    "",
  ].join("\n"),
);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const M = require(OUTFILE);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const { isPrimitiveAliasHover, MEMBER_CAP } = M;
const bytes = (s) => Buffer.byteLength(s, "utf8");
const show = (v) => JSON.stringify(v);

// ===========================================================================
// A. THE PREDICATE. Which hover displays name a type whose members are the
// underlying primitive's and nobody else's.
// ===========================================================================

// [display, primitive-backed?, why]
const PREDICATE_ROWS = [
  // The shapes the fix exists for.
  [FIXTURE.SuppressionKind.signature, true, "captured: this repo's own string-literal union"],
  [FIXTURE.RepairRoundIndex.signature, true, "captured: this repo's own numeric union"],
  ['type Handle = string', true, "alias of bare string"],
  ['type Count = number', true, "alias of bare number"],
  ['type Flag = boolean', true, "alias of bare boolean"],
  ['type Nothing = never', true, "alias of never"],
  ['type Missing = null | undefined', true, "union of the empty primitives"],
  ['type Bits = 1 | 2 | 4 | 8', true, "numeric union"],
  ['type Big = 1n | 2n', true, "bigint literal union"],
  ['type Hex = 0x1f | 0b101 | 1e3 | -2 | .5', true, "every numeric literal spelling"],
  ['type Answer = true | false', true, "boolean literal union"],
  ['type Mixed = "a" | 1 | true', true, "literals of three different primitives"],
  ['type Single = "only"', true, "a one-arm union is still a union"],
  ['export type Exported = "a" | "b"', true, "an export modifier does not change the answer"],
  ['declare type Ambient = "a" | "b"', true, "a declare modifier does not change the answer"],
  ['type Keyed<T> = "a" | "b"', true, "generic alias whose RHS is still a string union"],
  ['type Defaulted<T = string> = "a" | "b"', true, "the `=` inside the generic clause is not the alias `=`"],

  // The quoting cases tsSkipQuoted exists for.
  ['type Piped = "a|b" | "c"', true, "a `|` inside a literal is data, not a union bar"],
  ['type Escaped = "a\\"b" | "c"', true, "an escaped quote does not end the literal"],
  ['type Templated = `id-${string}`', true, "a template literal type is a string"],
  ['type TemplatedUnion = `a-${number}` | "b"', true, "template literal beside a plain literal"],
  ['type Braced = "{" | "}"', true, "a brace inside a literal opens no object body"],

  // The shapes whose members ARE worth injecting.
  [FIXTURE.RustOracleDeps.signature, false, "captured: alias of another NAMED type"],
  [FIXTURE.ReanchorOutcome.signature, false, "captured: discriminated union of object types"],
  [FIXTURE.SymbolRole.signature, false, "captured: one arm is a named type, so the alias is not provably primitive"],
  [FIXTURE.DerivedType.signature, false, "captured: an interface is not an alias"],
  [FIXTURE.CompletionCache.signature, false, "captured: a class is not an alias"],
  ['type Point = { x: number; y: number; }', false, "alias of an object type"],
  ['type Wrapper<T> = { value: T; }', false, "generic alias of an object type"],
  ['type Either = string | { kind: "obj"; }', false, "a union mixing a primitive with an object type"],
  ['type Branded = string & { __brand: "id"; }', false, "an intersection is not a union of primitives"],
  ['type Names = string[]', false, "an array of a primitive is an Array, not a string"],
  ['type Fn = (a: string) => void', false, "a function alias"],
  ['type Keys = keyof Point', false, "keyof is not a literal we can read off the display"],
  ['type Shadow = typeof value', false, "typeof is not a literal we can read off the display"],
  ['enum Color { Red }', false, "an enum is not an alias"],
  ['function build(): string', false, "a function display is not an alias"],
  ['const x: string', false, "a value display is not an alias"],
  ['(type parameter) T in type Order<T>', false, "type-parameter chrome is not an alias"],
  ['type Incomplete', false, "an alias display with no `=` decides nothing"],
  ['type Empty = ', false, "an alias display with an empty RHS decides nothing"],
  ['', false, "the empty display"],
];

test("the predicate reads a primitive-backed alias off the hover display, and nothing else as one", () => {
  for (const [display, expected, why] of PREDICATE_ROWS) {
    assert.equal(
      isPrimitiveAliasHover(display),
      expected,
      `${why}: isPrimitiveAliasHover(${show(display)}) must be ${expected}`,
    );
  }
});

test("the predicate never throws on a malformed or truncated display", () => {
  const junk = [
    undefined, "type", "type X =", 'type X = "unterminated', "type X = {", "type X = <", "type X = |",
    "type X = | |", "type X = `", "type X = ((((", 'type X = "a" |', "type <T> = string",
  ];
  for (const d of junk) {
    assert.doesNotThrow(() => isPrimitiveAliasHover(d), `must survive ${show(d)}`);
  }
});

// ===========================================================================
// B. THE INJECTED BYTES. What the TS renderer puts in the prompt for each shape.
// ===========================================================================

const lang = M.prefillLangFor("typescript");
const FENCE = "```";

// A CrossFileShape carrying every fixture type at once, so a control row is
// always resolvable out of the SAME shape as the row it guards.
const AUTHORED = {
  // This repo declares no alias of an object type and no generic alias, so these
  // two are authored in the language service's own display style (the captured
  // ReanchorOutcome display is the model for the indentation).
  Point: {
    signature: 'type Point = {\n    x: number;\n    y: number;\n}',
    fields: [{ name: "x", typeName: "number" }, { name: "y", typeName: "number" }],
    methods: ["x: number", "y: number"],
  },
  Wrapper: {
    signature: 'type Wrapper<T> = {\n    value: T;\n}',
    fields: [{ name: "value", typeName: "T" }],
    methods: ["value: T"],
  },
  Either: {
    signature: 'type Either = string | {\n    kind: "obj";\n}',
    fields: [],
    methods: ['kind: "obj"'],
  },
  Handle: { signature: "type Handle = string", fields: [], methods: FIXTURE.SuppressionKind.methods },
};

const shape = () => ({
  types: new Map(
    [...Object.entries(FIXTURE), ...Object.entries(AUTHORED)].map(([name, t]) => [
      name,
      {
        name,
        signature: t.signature,
        fields: t.fields,
        methods: t.methods,
        methodsResolved: true,
        defUri: "file:///w/src/core/thing.ts",
      },
    ]),
  ),
  dropped: [],
});

// Render ONE type out of the shared shape, with the product's own budget.
const render = (name, log = () => {}) =>
  lang.renderShapeBlock(
    name,
    shape(),
    { visited: new Set(), remainingChars: M.FNGEN_PROFILE.totalTok * 4 },
    log,
    M.FNGEN_PROFILE,
  );

const defBlock = (name, signature) =>
  `Data shape of \`${name}\` (fields and types, nested):\n${FENCE}ts\n${signature}\n${FENCE}`;

// name -> [expect a member list?, why]
const BYTE_ROWS = [
  ["SuppressionKind", false, "captured string-literal union: 48 String members, none of them its own"],
  ["RepairRoundIndex", false, "captured numeric union: 6 Number members"],
  ["Handle", false, "alias of bare string, carrying the same 48 String members"],
  ["RustOracleDeps", true, "captured alias of a NAMED type: the target's members are the point"],
  ["ReanchorOutcome", true, "captured discriminated union: the common member is real"],
  ["SymbolRole", true, "captured union with a named arm: not provably primitive, so kept"],
  ["DerivedType", true, "captured interface: not an alias at all"],
  ["CompletionCache", true, "captured class: not an alias at all"],
  ["Point", true, "authored alias of an object type"],
  ["Wrapper", true, "authored generic alias of an object type"],
  ["Either", true, "authored union of a primitive and an object type"],
];

test("every candidate injects its def; only a primitive-backed alias loses its member list", () => {
  for (const [name, wantMembers, why] of BYTE_ROWS) {
    const block = render(name);
    assert.ok(block, `${name}: must render a block. ${why}`);
    const t = shape().types.get(name);
    const head = defBlock(name, t.signature);
    assert.ok(
      block.text.startsWith(head),
      `${name}: the def half must lead the block, verbatim. ${why}\ngot:\n${block.text}`,
    );
    const memberLeg = block.text.slice(head.length);
    if (wantMembers) {
      assert.ok(
        memberLeg.includes(`Members of \`${name}\``),
        `${name}: its member list must still be injected. ${why}\ngot:\n${block.text}`,
      );
      assert.ok(
        memberLeg.includes(t.methods[0]),
        `${name}: the first resolved member must be in the injected text. ${why}`,
      );
    } else {
      assert.equal(
        memberLeg,
        "",
        `${name}: the block must be the def and nothing else. ${why}\ngot:\n${block.text}`,
      );
      assert.equal(
        bytes(block.text),
        bytes(head),
        `${name}: the injected bytes must be exactly the def half. ${why}`,
      );
    }
  }
});

// The numbers, as literals: [whole block, def half, member leg]. A structural row
// above still passes for a renderer that changed shape; these do not.
//
// The def half is 66 bytes of header and fence plus the hover, which is the
// arithmetic to check a surprise against: `SuppressionKind`'s hover is 91 bytes
// and its def half is 161, `CompletionCache`'s is 21 and its def half is 91.
const EXPECTED_BYTES = {
  SuppressionKind: [161, 161, 0],
  RepairRoundIndex: [100, 100, 0],
  Handle: [81, 81, 0],
  RustOracleDeps: [246, 101, 145],
  ReanchorOutcome: [379, 248, 131],
  SymbolRole: [1214, 107, 1107],
  DerivedType: [315, 87, 228],
  CompletionCache: [468, 91, 377],
  Point: [213, 106, 107],
  Wrapper: [195, 97, 98],
  Either: [204, 104, 100],
};

test("the injected block is exactly this many bytes, per type", () => {
  for (const [name, [whole, def, members]] of Object.entries(EXPECTED_BYTES)) {
    const block = render(name);
    assert.ok(block, `${name}: must render a block`);
    const head = defBlock(name, shape().types.get(name).signature);
    assert.equal(bytes(head), def, `${name}: def-half bytes`);
    assert.equal(bytes(block.text) - bytes(head), members, `${name}: member-leg bytes\n${block.text}`);
    assert.equal(bytes(block.text), whole, `${name}: injected bytes\n${block.text}`);
  }
});

test("item 6's own row: the member leg was 1112 bytes of String.prototype and is now zero", () => {
  // The SAME 48 members, the SAME renderer, one byte of difference in the input:
  // a hover that says the alias resolves to a named type instead of to string
  // literals. That isolates the predicate as the only cause of the delta.
  const asNamed = shape();
  const t = asNamed.types.get("SuppressionKind");
  asNamed.types.set("SuppressionKind", { ...t, signature: "type SuppressionKind = LedgerKind" });
  const before = lang.renderShapeBlock(
    "SuppressionKind",
    asNamed,
    { visited: new Set(), remainingChars: M.FNGEN_PROFILE.totalTok * 4 },
    () => {},
    M.FNGEN_PROFILE,
  );
  const after = render("SuppressionKind");
  assert.equal(t.methods.length, 48, "fixture precondition: the capture holds 48 members");
  // The def halves differ by the length of the two hovers, so the comparison is
  // member leg to member leg.
  const beforeLeg = before.text.slice(defBlock("SuppressionKind", "type SuppressionKind = LedgerKind").length);
  const afterLeg = after.text.slice(defBlock("SuppressionKind", t.signature).length);
  assert.equal(bytes(beforeLeg), 1112, "the member leg the union used to ship");
  assert.equal(bytes(afterLeg), 0, "and ships now");
  assert.ok(
    beforeLeg.includes("charAt(pos: number): string"),
    "fixture precondition: the leg that used to ship really is String.prototype",
  );
});

// ===========================================================================
// C. THE CHANNEL. A refusal must read as a refusal. A member list that was never
// worth having must not be reported as a truncated surface.
// ===========================================================================

const linesFor = (name) => {
  const log = [];
  render(name, (line) => log.push(line));
  return log;
};

test("a refused member list is logged as a refusal, never as a truncation", () => {
  for (const name of ["SuppressionKind", "RepairRoundIndex", "Handle"]) {
    const lines = linesFor(name);
    const refusal = lines.filter((l) => /refused/.test(l));
    assert.equal(refusal.length, 1, `${name}: exactly one refusal line. got:\n${lines.join("\n")}`);
    assert.match(
      refusal[0],
      new RegExp(`\\\`${name}\\\``),
      `${name}: the refusal must name the type it refused`,
    );
    assert.match(
      refusal[0],
      /prototype/,
      `${name}: the refusal must say WHY, not just that it happened`,
    );
    assert.equal(
      lines.filter((l) => /truncated/.test(l)).length,
      0,
      `${name}: nothing was truncated, so no truncation line. got:\n${lines.join("\n")}`,
    );
  }
});

test("a real truncation still reports itself, and is not called a refusal", () => {
  // CONTROL for the row above: the same 48-member list under a hover that is not
  // a primitive alias still truncates at MEMBER_CAP and still says so.
  const lines = linesFor("SymbolRole");
  const truncation = lines.filter((l) => /truncated/.test(l));
  assert.equal(truncation.length, 1, `a capped member list must log its truncation. got:\n${lines.join("\n")}`);
  assert.match(truncation[0], new RegExp(`kept ${MEMBER_CAP} of 48`), "and say how many it kept");
  assert.equal(lines.filter((l) => /refused/.test(l)).length, 0, "nothing was refused here");
});

test("a member list that fits the cap logs neither a refusal nor a truncation", () => {
  for (const name of ["RustOracleDeps", "DerivedType", "CompletionCache", "Point"]) {
    const lines = linesFor(name).filter((l) => /refused|truncated/.test(l));
    assert.deepEqual(lines, [], `${name}: an ordinary member list is silent on both counts`);
  }
});
