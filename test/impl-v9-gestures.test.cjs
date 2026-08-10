// Implementer oracles for v9 phase 4A internals the blind gesture suite cannot
// reach from outside the seam: the TS whole-block site detector's edge shapes,
// the TS hover-field parser corners, the mid-line field-type anchor, the TS
// def renderer, the doc-channel scanner, the import/local-type candidate
// scanners, and the per-language hook dispatch through the ONE resolver
// (including the discriminating check that the Rust defaults would MANGLE a TS
// hover - the hooks are load-bearing, not decorative).
//
// Run: SKIP_LIVE=1 node --test test/impl-v9-gestures.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v9-gestures",
  `export { wholeBlockSite, tsWholeBlockSite, tsTypesInPlay, wholeBlockSiteFor } from "../src/core/fimWholeBlock";\n` +
    `export { parseTsHoverFields, tsFieldTypeCursor, tsRenderDerivedDef, tsDocCommentAbove, tsSignatureFromSpanText, tsTypesFromImports, tsLocalTypeDefinitions, TS_LANGUAGE_IDS, TS_STD_TYPE_NAMES } from "../src/core/tsExtraction";\n` +
    `export { resolveCrossFileShape, toResolveStruct, tsShapeHooks, shapeHooksFor, parseStructHoverFields, renderDerivedDef } from "../src/core/crossFileShape";\n`,
);
const {
  wholeBlockSite,
  tsWholeBlockSite,
  tsTypesInPlay,
  wholeBlockSiteFor,
  parseTsHoverFields,
  tsFieldTypeCursor,
  tsRenderDerivedDef,
  tsDocCommentAbove,
  tsSignatureFromSpanText,
  tsTypesFromImports,
  tsLocalTypeDefinitions,
  TS_LANGUAGE_IDS,
  TS_STD_TYPE_NAMES,
  resolveCrossFileShape,
  toResolveStruct,
  tsShapeHooks,
  shapeHooksFor,
} = mod;
test.after(cleanup);

// Position a prefix at the byte just after `after` inside `text`.
const prefixAfter = (text, after) => {
  const idx = text.indexOf(after);
  assert.ok(idx >= 0, `needle missing: ${JSON.stringify(after)}`);
  return text.slice(0, idx + after.length);
};

// ---------------------------------------------------------------------------
// tsWholeBlockSite: engagement is the header's SHAPE, never a keyword-named
// identifier (4A amendment 1). One table per direction, each row naming the
// invariant it proves.
// ---------------------------------------------------------------------------

const ENGAGE_ROWS = [
  {
    why: "function declaration with return annotation",
    text: `export function fill(a: Alias): number {\n  \n}\n`,
    after: "number {\n  ",
    types: ["Alias"],
  },
  {
    why: "arrow with parenthesized params (no fn token anywhere)",
    text: `export const fill = (x: Alias): number => {\n  \n};\n`,
    after: "=> {\n  ",
    types: ["Alias"],
  },
  {
    why: "class method",
    text: `export class Painter {\n  render(a: Alias): number {\n    \n  }\n}\n`,
    after: "number {\n    ",
    types: ["Alias"],
  },
  {
    why: "amendment 1: a parameter NAMED fn still engages (shape, not keyword)",
    text: `export class Runner {\n  process(fn: (a: Alias) => void) {\n    \n  }\n}\n`,
    after: "void) {\n    ",
    types: ["Alias"],
  },
  {
    why: "anonymous function expression",
    text: `const f = function (a: Alias) {\n  \n};\n`,
    after: ") {\n  ",
    types: ["Alias"],
  },
  {
    why: "async generic function: generic clause names and std Promise are excluded",
    text: `async function load<T>(query: Query, mapper: T): Promise<Query> {\n  \n}\n`,
    after: "Promise<Query> {\n  ",
    types: ["Query"],
  },
  {
    why: "callback arrow inside a call still engages on its own params",
    text: `items.map((x: Alias) => {\n  \n});\n`,
    after: "=> {\n  ",
    types: ["Alias"],
  },
  {
    why: "constructor body",
    text: `class Painter {\n  constructor(a: Alias) {\n    \n  }\n}\n`,
    after: "(a: Alias) {\n    ",
    types: ["Alias"],
  },
  {
    why: "object-literal arrow PROPERTY is a value body (statement head const, not type)",
    text: `const obj = {\n  fetch: (o: Order) => {\n    \n  }\n};\n`,
    after: "=> {\n    ",
    types: ["Order"],
  },
  {
    why: "a preceding type statement ends at its `;`: the arrow after it still engages",
    text: `export type Config = { retries: number };\nconst handler = (a: Alias) => {\n  \n};\n`,
    after: "=> {\n  ",
    types: ["Alias"],
  },
  {
    why: "R2-3 guard: a value arrow after a ;-statement inside a function body still engages",
    text: `function setup() {\n  const n = 1;\n  const go = (o: Order) => {\n    \n  };\n}\n`,
    after: "=> {\n    ",
    types: ["Order"],
  },
];

for (const row of ENGAGE_ROWS) {
  test(`tsWholeBlockSite engages: ${row.why}`, () => {
    const site = tsWholeBlockSite(prefixAfter(row.text, row.after));
    assert.ok(site, "the site must engage");
    assert.deepStrictEqual(site.types, row.types);
  });
}

const REFUSE_ROWS = [
  {
    why: "non-empty body (content before the cursor)",
    text: `function fill(a: Alias): number {\n  const x = 1;\n  \n}\n`,
    after: "x = 1;\n  ",
  },
  {
    why: "mid-expression blank line (enclosing body has content)",
    text: `function outer(fn: (a: Alias) => void): number {\n  fn(seed);\n  const total = merge(\n  \n  );\n}\n`,
    after: "merge(\n  ",
  },
  {
    why: "cursor on an identifier named fn (round-1 false-fire class)",
    text: `function outer(fn: (a: Alias) => void): number {\n  fn\n}\n`,
    after: "number {\n  fn",
  },
  {
    why: "if block is control flow, not a body",
    text: `function f(a: Alias) {\n  if (a.ok(Alias)) {\n    \n  }\n}\n`,
    after: "ok(Alias)) {\n    ",
  },
  {
    why: "for block is control flow",
    text: `function f(list: Alias[]) {\n  for (const a of list.filter(Boolean) as Alias[]) {\n    \n  }\n}\n`,
    after: "Alias[]) {\n    ",
  },
  {
    why: "while block is control flow",
    text: `function f(a: Alias) {\n  while (a.next(Alias)) {\n    \n  }\n}\n`,
    after: "next(Alias)) {\n    ",
  },
  {
    why: "switch block is control flow",
    text: `function f(a: Alias) {\n  switch (a.kind(Alias)) {\n    \n  }\n}\n`,
    after: "kind(Alias)) {\n    ",
  },
  {
    why: "object literal is not a body",
    text: `const cfg: Alias = {\n  \n};\n`,
    after: "= {\n  ",
  },
  {
    why: "class body is not a function body",
    text: `export class Painter {\n  \n}\n`,
    after: "Painter {\n  ",
  },
  {
    why: "typeless params yield no user type: honest dark",
    text: `function fill(a, b) {\n  \n}\n`,
    after: "(a, b) {\n  ",
  },
  {
    why: "std-only types yield no user type",
    text: `function fill(p: Promise<string>): Map<string, number> {\n  \n}\n`,
    after: "number> {\n  ",
  },
  {
    why: "no enclosing brace",
    text: `const x = 1;\n\n`,
    after: "1;\n",
  },
  {
    why: "M-2 case 1: type-level arrow object literal is a TYPE brace, not a body",
    text: `type Handler = (a: Alias) => {\n  \n};\n`,
    after: "=> {\n  ",
  },
  {
    why: "M-2 case 1: exported type alias arrow refuses too (modifier skipped)",
    text: `export type Handler = (a: Alias) => {\n  \n};\n`,
    after: "=> {\n  ",
  },
  {
    why: "M-2 case 1: arrow-typed interface property is a TYPE brace",
    text: `interface Api { fetch: (o: Order) => {\n  \n} }\n`,
    after: "=> {\n  ",
  },
  {
    why: "M-2 case 2: mixin class header (`extends Name(Base) {`) opens a class body",
    text: `class Painted extends WithAlias(Alias) {\n  \n}\n`,
    after: "(Alias) {\n  ",
  },
  {
    why: "M-2 case 2: anonymous mixin (`new (class extends Base(Order) {`) refuses",
    text: `const P = new (class extends Base(Order) {\n  \n});\n`,
    after: "(Order) {\n  ",
  },
  {
    why: "M-2 case 3: `for await (...) {` is control flow (name scan passes await to for)",
    text: `async function drain(stream: AsyncIterable<Order>) {\n  for await (const o of stream as AsyncIterable<Order>) {\n    \n  }\n}\n`,
    after: "as AsyncIterable<Order>) {\n    ",
  },
  {
    why: "R2-3: arrow property AFTER a ;-terminated member inside an interface body is type-level",
    text: `interface Api {\n  fetch: (o: Order) => void;\n  process: (o: Order) => {\n  \n}\n}\n`,
    after: "process: (o: Order) => {\n  ",
  },
  {
    why: "R2-3: a `satisfies` type literal is type-level, not a body",
    text: `const cfg = base satisfies {\n  handle: (o: Order) => {\n  \n}\n};\n`,
    after: "handle: (o: Order) => {\n  ",
  },
];

for (const row of REFUSE_ROWS) {
  test(`tsWholeBlockSite refuses: ${row.why}`, () => {
    assert.strictEqual(tsWholeBlockSite(prefixAfter(row.text, row.after)), undefined);
  });
}

// ---------------------------------------------------------------------------
// wholeBlockSiteFor: the dispatch registry. Rust keeps ITS detector; TS ids get
// the TS one; everything else is dark.
// ---------------------------------------------------------------------------

test("wholeBlockSiteFor: rust -> wholeBlockSite, TS ids -> tsWholeBlockSite, others -> undefined", () => {
  assert.strictEqual(wholeBlockSiteFor("rust"), wholeBlockSite);
  for (const id of TS_LANGUAGE_IDS) {
    assert.strictEqual(wholeBlockSiteFor(id), tsWholeBlockSite, id);
  }
  // v11 phase 4: python now resolves its own detector (pyWholeBlockSite).
  assert.strictEqual(typeof wholeBlockSiteFor("python"), "function", "python");
  for (const id of ["plaintext", ""]) {
    assert.strictEqual(wholeBlockSiteFor(id), undefined, id || "(empty)");
  }
});

test("tsTypesInPlay: std, generic-clause, and single-letter names excluded; first-seen order", () => {
  const generics = new Set(["T", "Row"]);
  assert.deepStrictEqual(
    tsTypesInPlay("(o: Order, rows: Array<Row>, t: T, c: Customer, o2: Order): Promise<Order>", generics),
    ["Order", "Customer"],
  );
});

// ---------------------------------------------------------------------------
// parseTsHoverFields: quickinfo corners. Rows name their invariant.
// ---------------------------------------------------------------------------

const HOVER_ROWS = [
  {
    why: "one-line object type alias, semicolon-separated",
    sig: "type Order = { reference: string; placedBy: Customer }",
    fields: [
      { name: "reference", typeName: "string" },
      { name: "placedBy", typeName: "Customer" },
    ],
  },
  {
    why: "comma separators are accepted too",
    sig: "type P = { x: number, y: number }",
    fields: [
      { name: "x", typeName: "number" },
      { name: "y", typeName: "number" },
    ],
  },
  {
    why: "multiline braced display, newline-separated members",
    sig: "interface Order {\n  reference: string\n  placedBy: Customer\n}",
    fields: [
      { name: "reference", typeName: "string" },
      { name: "placedBy", typeName: "Customer" },
    ],
  },
  {
    why: "optional and readonly modifiers strip to the plain field",
    sig: "type O = { readonly id: string; note?: string }",
    fields: [
      { name: "id", typeName: "string" },
      { name: "note", typeName: "string" },
    ],
  },
  {
    why: "a nested object type stays ONE field with the type as written",
    sig: "type C = { retry: { max: number; delayMs: number }; name: string }",
    fields: [
      { name: "retry", typeName: "{ max: number; delayMs: number }" },
      { name: "name", typeName: "string" },
    ],
  },
  {
    why: "method members are not field edges",
    sig: "type S = { theme: string; setTheme(t: string): void }",
    fields: [{ name: "theme", typeName: "string" }],
  },
  {
    why: "generic field types keep their arguments as written",
    sig: "type B = { rows: Map<string, Row[]> }",
    fields: [{ name: "rows", typeName: "Map<string, Row[]>" }],
  },
  // The four m-5 mangle shapes, hover texts validated verbatim against
  // typescript 5.9.3 quickinfo (displayPartsToString of getQuickInfoAtPosition
  // on each alias name). PASS: the located body is the type's OWN object
  // literal or none. FAIL: the naive first-`{`/last-`}` span fabricates or
  // loses fields.
  {
    why: "m-5 conditional type: the extends clause fabricates no field edge",
    sig: "type IsStr<T> = T extends {\n    kind: string;\n} ? true : false",
    fields: [],
  },
  {
    why: "m-5 union of object arms: no single shape, degrade over a mangled arm",
    sig: "type X = {\n    a: Foo;\n} | {\n    b: Bar;\n}",
    fields: [],
  },
  {
    why: "m-5 default generic param: its brace is skipped and the REAL body's field survives",
    sig: "type G<T = { x: number; }> = {\n    real: Widget;\n}",
    fields: [{ name: "real", typeName: "Widget" }],
  },
  {
    why: "m-5 function alias: the braced return type fabricates no fields",
    sig: "type H = (req: Req) => {\n    status: number;\n}",
    fields: [],
  },
  { why: "bodyless interface hover degrades to no fields", sig: "interface Order", fields: [] },
  { why: "bodyless class hover degrades", sig: "class ThemeStore", fields: [] },
  { why: "enum hover degrades", sig: "enum Color", fields: [] },
  { why: "undefined degrades", sig: undefined, fields: [] },
];

for (const row of HOVER_ROWS) {
  test(`parseTsHoverFields: ${row.why}`, () => {
    assert.deepStrictEqual(parseTsHoverFields(row.sig), row.fields);
  });
}

// ---------------------------------------------------------------------------
// tsFieldTypeCursor: the mid-line anchor for the recursive hop.
// ---------------------------------------------------------------------------

test("tsFieldTypeCursor anchors the field's own type token mid-line (several members per line)", () => {
  const lines = ["export type Order = { reference: string; placedBy: Customer };"];
  const cur = tsFieldTypeCursor(lines, { open: 0, close: 0 }, "placedBy", "Customer");
  assert.ok(cur, "anchor found");
  assert.strictEqual(lines[cur.line].slice(cur.character, cur.character + "Customer".length), "Customer");
});

test("tsFieldTypeCursor: multiline interface body anchors on the field's own line", () => {
  const lines = ["interface Order {", "  reference: string;", "  placedBy: Customer;", "}"];
  const cur = tsFieldTypeCursor(lines, { open: 0, close: 3 }, "placedBy", "Customer");
  assert.deepStrictEqual(cur && { line: cur.line }, { line: 2 });
});

test("tsFieldTypeCursor: a field-name SUBSTRING never matches (userid vs id)", () => {
  // MULTI-LINE on purpose (m-8): with the fields on separate lines, a regex
  // whose prefix guard is dropped matches `id:` INSIDE `userid:` on the wrong
  // line and stops there (candidate not on that line) - this pin goes red.
  // The round-1 single-line fixture masked that: the weakened match still
  // found the candidate later on the same line. (`userid`, not `orderId`: the
  // substring must match case-sensitively for the pin to discriminate.)
  const lines = ["type T = {", "  userid: Token,", "  id: Ident", "};"];
  const cur = tsFieldTypeCursor(lines, { open: 0, close: 3 }, "id", "Ident");
  assert.ok(cur, "the real `id` field anchors");
  assert.strictEqual(cur.line, 2, "the anchor sits on the `id` line, never inside `userid`");
  assert.strictEqual(lines[cur.line].slice(cur.character, cur.character + "Ident".length), "Ident");
});

test("tsFieldTypeCursor: missing field or off-line candidate is a stop edge (undefined)", () => {
  const lines = ["type T = { a: X };"];
  assert.strictEqual(tsFieldTypeCursor(lines, { open: 0, close: 0 }, "b", "X"), undefined);
  assert.strictEqual(tsFieldTypeCursor(lines, { open: 0, close: 0 }, "a", "Y"), undefined);
});

// ---------------------------------------------------------------------------
// tsRenderDerivedDef: verbatim hover wins; synthesis is TS syntax and honest
// on signature-less fields.
// ---------------------------------------------------------------------------

test("tsRenderDerivedDef: a resolved hover signature is emitted verbatim", () => {
  const t = { name: "Order", signature: "type Order = { a: string }", fields: [], methods: [], methodsResolved: true };
  assert.strictEqual(tsRenderDerivedDef(t), "type Order = { a: string }");
});

test("tsRenderDerivedDef: hover miss synthesizes interface syntax; a typeless field stays name-only (never invented)", () => {
  const t = {
    name: "Order",
    signature: "",
    fields: [
      { name: "reference", typeName: "string" },
      { name: "mystery", typeName: "" },
    ],
    methods: [],
    methodsResolved: false,
  };
  assert.strictEqual(tsRenderDerivedDef(t), "interface Order {\n  reference: string;\n  mystery;\n}");
});

// ---------------------------------------------------------------------------
// tsDocCommentAbove: the amendment-3 doc channel scanner.
// ---------------------------------------------------------------------------

const docFrom = (text, headNeedle) => {
  const lines = text.split("\n");
  const head = lines.findIndex((l) => l.includes(headNeedle));
  assert.ok(head >= 0, "head line present");
  return tsDocCommentAbove((n) => lines[n] ?? "", head);
};

test("tsDocCommentAbove: a multi-line JSDoc block immediately above is returned whole", () => {
  const text = `import x from "./x";\n\n/**\n * Reads the total.\n * @param o the order\n */\nexport function readOrder(o: Order) {}\n`;
  assert.strictEqual(docFrom(text, "export function"), "/**\n * Reads the total.\n * @param o the order\n */");
});

test("tsDocCommentAbove: a one-line JSDoc is returned", () => {
  const text = `/** Reads the order total. */\nexport function readOrder() {}\n`;
  assert.strictEqual(docFrom(text, "export function"), "/** Reads the order total. */");
});

test("tsDocCommentAbove: a contiguous // run is returned; the run stops at a blank line", () => {
  const text = `// far away\n\n// close line one\n// close line two\nfunction f() {}\n`;
  assert.strictEqual(docFrom(text, "function f"), "// close line one\n// close line two");
});

const DOC_NONE_ROWS = [
  { why: "blank line between doc and head", text: `/** doc */\n\nfunction f() {}\n` },
  { why: "no comment above", text: `const a = 1;\nfunction f() {}\n` },
  { why: "head at the top of the file", text: `function f() {}\n` },
  { why: "a trailing block comment on a code line is not a doc", text: `const a = 1; /* note */\nfunction f() {}\n` },
  // n-10: a // run of ONLY tool-directive lines is machine config, never the doc.
  { why: "n-10: a lone eslint pragma is not a doc", text: `// eslint-disable-next-line no-console\nfunction f() {}\n` },
  { why: "n-10: a run of mixed pragmas (ts/prettier/biome) is not a doc", text: `// @ts-expect-error legacy\n// prettier-ignore\n// biome-ignore lint: legacy\nfunction f() {}\n` },
];

for (const row of DOC_NONE_ROWS) {
  test(`tsDocCommentAbove: ${row.why} -> undefined`, () => {
    assert.strictEqual(docFrom(row.text, "function f"), undefined);
  });
}

test("tsDocCommentAbove n-10 restraint: a MIXED run (prose + pragma) stays a doc, and a JSDoc mentioning eslint is untouched", () => {
  const mixed = `// Computes the total.\n// eslint-disable-next-line no-console\nfunction f() {}\n`;
  assert.strictEqual(docFrom(mixed, "function f"), "// Computes the total.\n// eslint-disable-next-line no-console");
  const jsdoc = `/** eslint would flag this; kept anyway. */\nfunction f() {}\n`;
  assert.strictEqual(docFrom(jsdoc, "function f"), "/** eslint would flag this; kept anyway. */");
});

// ---------------------------------------------------------------------------
// tsSignatureFromSpanText (M-4): the depth-aware TS declaration head. The Rust
// signatureFromSpanText is v1-frozen and cuts at the first `{`; the TS sibling
// must survive exactly the braces that are NOT the body.
// ---------------------------------------------------------------------------

const SIG_ROWS = [
  {
    why: "destructured parameter braces survive (the React Panel shape)",
    span: `export function Panel({ title, count }: Props): string {\n  return title;\n}`,
    head: "export function Panel({ title, count }: Props): string",
  },
  {
    why: "braced return annotation survives",
    span: `function totals(o: Order): { total: number } {\n  return { total: 1 };\n}`,
    head: "function totals(o: Order): { total: number }",
  },
  {
    why: "union arms with braces survive",
    span: `function pick(o: Order): { a: A } | { b: B } {\n  return x;\n}`,
    head: "function pick(o: Order): { a: A } | { b: B }",
  },
  {
    why: "generic extends-constraint braces survive",
    span: `function keep<T extends { id: string }>(t: T): T {\n  return t;\n}`,
    head: "function keep<T extends { id: string }>(t: T): T",
  },
  {
    why: "intersection arm braces survive",
    span: `function tag(o: Order): Named & { id: string } {\n  return o;\n}`,
    head: "function tag(o: Order): Named & { id: string }",
  },
  {
    why: "a simple signature is byte-identical to the v1 slice (snapshot-safe)",
    span: `export function readOrder(o: Order): number {\n\n}`,
    head: "export function readOrder(o: Order): number",
  },
  {
    why: "R2-1: braces inside a generic argument survive (Promise<{...}>)",
    span: `async function load(): Promise<{ ok: boolean }> {\n  return { ok: true };\n}`,
    head: "async function load(): Promise<{ ok: boolean }>",
  },
  {
    why: "R2-1: braces after a generic-argument comma survive (Record<K, {...}>)",
    span: `function index(o: Order): Record<string, { a: string }> {\n  return {};\n}`,
    head: "function index(o: Order): Record<string, { a: string }>",
  },
  {
    why: "R2-1: braces in a generic default survive (<T = {...}>)",
    span: `function make<T = { x: number }>(seed: T): T {\n  return seed;\n}`,
    head: "function make<T = { x: number }>(seed: T): T",
  },
  {
    why: "an arrow head cuts at its body brace",
    span: `const f = (a: Alias): number => {\n  return 1;\n};`,
    head: "const f = (a: Alias): number =>",
  },
  {
    why: "a bodyless (ambient/overload) span falls back to the first line",
    span: `declare function f(a: A): B;`,
    head: "declare function f(a: A): B;",
  },
];

for (const row of SIG_ROWS) {
  test(`tsSignatureFromSpanText: ${row.why}`, () => {
    assert.strictEqual(tsSignatureFromSpanText(row.span), row.head);
  });
}

// ---------------------------------------------------------------------------
// Candidate scanners.
// ---------------------------------------------------------------------------

test("tsTypesFromImports: named/default/namespace/type imports contribute; std names and module paths do not", () => {
  // The module paths carry PascalCase words NOT in any clause (m-8): a scan
  // that reads past `from` leaks OrderUtils/WidgetKit/Grid and goes red here.
  const src = [
    `import { Order, Customer } from "./OrderUtils";`,
    `import type { Token } from "@scope/WidgetKit";`,
    `import Big from "./Big.css";`,
    `import * as NS from "./ns";`,
    `import {`,
    `  Split,`,
    `  Wrapped,`,
    `} from "./components/Grid/wide";`,
    `import { Promise as P } from "./fake";`,
    `const NotAnImport = 1;`,
  ].join("\n");
  assert.deepStrictEqual(tsTypesFromImports(src), ["Order", "Customer", "Token", "Big", "NS", "Split", "Wrapped", "P"]);
});

test("tsLocalTypeDefinitions: module-scope interface/class/enum/type anchor at their name; nested and commented ones do not", () => {
  const src = [
    `// interface Commented`,
    `export interface Shape { a: string }`,
    `type Alias = { b: number };`,
    `export abstract class Painter {}`,
    `const enum Mode { A }`,
    `function f() {`,
    `  interface Inner { c: string }`,
    `}`,
  ].join("\n");
  const defs = tsLocalTypeDefinitions(src);
  assert.deepStrictEqual([...defs.keys()].sort(), ["Alias", "Mode", "Painter", "Shape"]);
  assert.ok(!defs.has("Inner"), "nested declarations never anchor");
  assert.ok(!defs.has("Commented"), "comment lines never anchor");
  const shape = defs.get("Shape");
  assert.strictEqual(src.split("\n")[shape.line].slice(shape.character, shape.character + 5), "Shape");
});

// ---------------------------------------------------------------------------
// Hook dispatch through the ONE resolver. The discriminating check: the SAME
// fixture resolved with tsShapeHooks parses the TS hover correctly and hops to
// the nested type; with the Rust defaults the comma-split MANGLES the fields
// and the line-anchored hop fails. The hooks are load-bearing.
// ---------------------------------------------------------------------------

const CONSUMER_URI = "file:///p/consumer.ts";
const DOMAIN_URI = "file:///p/domain.ts";
const CONSUMER = `import { Order } from "./domain";\n\nexport function readOrder(o: Order): number {\n\n}\n`;
const DOMAIN = `export type Order = { reference: string; placedBy: Customer };\n\nexport type Customer = { displayName: string };\n`;
const HOVERS = {
  Order: "type Order = { reference: string; placedBy: Customer }",
  Customer: "type Customer = { displayName: string }",
};

function fakeTsExtractor() {
  const wordAt = (text, c) => {
    const line = text.split("\n")[c.line] ?? "";
    const isW = (ch) => /[A-Za-z0-9_$]/.test(ch);
    let s = Math.min(c.character, line.length);
    let e = s;
    while (s > 0 && isW(line[s - 1])) s--;
    while (e < line.length && isW(line[e])) e++;
    return e > s ? line.slice(s, e) : undefined;
  };
  const textOf = (uri) => (uri === CONSUMER_URI ? CONSUMER : uri === DOMAIN_URI ? DOMAIN : undefined);
  return {
    async definition(cursor) {
      const text = textOf(cursor.uri);
      const w = text && wordAt(text, cursor);
      if (!w || !(w in HOVERS)) {
        return undefined;
      }
      const lines = DOMAIN.split("\n");
      const ln = lines.findIndex((l) => new RegExp(`\\btype ${w}\\b`).test(l));
      const ch = lines[ln].indexOf(w);
      return { uri: DOMAIN_URI, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + w.length } };
    },
    async hoverSurface(cursor) {
      const text = textOf(cursor.uri);
      const w = text && wordAt(text, cursor);
      return w && w in HOVERS ? { signature: HOVERS[w] } : undefined;
    },
    async membersOfType() {
      return [];
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
}

const orderRefCursor = () => {
  const lines = CONSUMER.split("\n");
  const ln = lines.findIndex((l) => l.includes("(o: Order)"));
  return { uri: CONSUMER_URI, line: ln, character: lines[ln].indexOf("Order", lines[ln].indexOf("(o:")) };
};

const openFile = async (u) => (u === CONSUMER_URI ? CONSUMER : u === DOMAIN_URI ? DOMAIN : undefined);

test("resolveCrossFileShape + tsShapeHooks: TS hover fields parse and the nested hop lands (Order -> Customer)", async () => {
  const shape = await resolveCrossFileShape(fakeTsExtractor(), orderRefCursor(), { D_MAX: 2, N_MAX: 12 }, openFile, tsShapeHooks);
  assert.deepStrictEqual([...shape.types.keys()], ["Order", "Customer"]);
  assert.deepStrictEqual(shape.types.get("Order").fields, [
    { name: "reference", typeName: "string" },
    { name: "placedBy", typeName: "Customer" },
  ]);
  assert.deepStrictEqual(shape.types.get("Customer").fields, [{ name: "displayName", typeName: "string" }]);
  assert.deepStrictEqual(shape.dropped, []);
  // The bridge renders through the TS hook: hover verbatim, walkable edge.
  const res = toResolveStruct(shape, tsShapeHooks)("Order");
  assert.strictEqual(res.def, HOVERS.Order);
  assert.deepStrictEqual(res.fields, [{ name: "placedBy", typeName: "Customer", isLocal: true }]);
});

test("DISCRIMINATOR: the same fixture WITHOUT hooks (Rust defaults) mangles the TS hover and never hops", async () => {
  const shape = await resolveCrossFileShape(fakeTsExtractor(), orderRefCursor(), { D_MAX: 2, N_MAX: 12 }, openFile);
  const order = shape.types.get("Order");
  assert.ok(order, "the root still resolves (definition/hover are language-neutral)");
  // The Rust comma-split reads the whole `;`-separated body as ONE field.
  assert.deepStrictEqual(order.fields, [{ name: "reference", typeName: "string; placedBy: Customer" }]);
  assert.ok(!shape.types.has("Customer"), "the nested hop cannot land through the Rust line-anchored field cursor");
});

// ---------------------------------------------------------------------------
// M-1: type-parameter descent must never inject tsserver chrome. A generic
// alias (`type Order<X> = { items: X[]; ... }`) queues its param from the
// field type; the REAL tsserver hover for it is `(type parameter) X in type
// Order<X>` - quickinfo chrome, not a def. Single letters never queue
// (skipCandidate); a multi-letter param queues but its chrome hover is
// refused (refuseHover) and lands in `dropped`, never in a def.
// ---------------------------------------------------------------------------

function fakeGenericTsExtractor(param) {
  const domain = `export type Order<${param}> = { items: ${param}[]; placedBy: Customer };\n\nexport type Customer = { displayName: string };\n`;
  const hovers = {
    Order: `type Order<${param}> = { items: ${param}[]; placedBy: Customer }`,
    Customer: "type Customer = { displayName: string }",
    [param]: `(type parameter) ${param} in type Order<${param}>`,
  };
  const dLines = domain.split("\n");
  const defs = {
    Order: { line: 0, ch: dLines[0].indexOf("Order") },
    [param]: { line: 0, ch: dLines[0].indexOf(`<${param}>`) + 1 },
    Customer: { line: 2, ch: dLines[2].indexOf("Customer") },
  };
  const consumer = `import { Order } from "./domain";\n\nexport function readOrder(o: Order<string>): number {\n\n}\n`;
  const textOf = (uri) => (uri === CONSUMER_URI ? consumer : uri === DOMAIN_URI ? domain : undefined);
  const wordAt = (text, c) => {
    const line = text.split("\n")[c.line] ?? "";
    const isW = (ch) => /[A-Za-z0-9_$]/.test(ch);
    let s = Math.min(c.character, line.length);
    let e = s;
    while (s > 0 && isW(line[s - 1])) s--;
    while (e < line.length && isW(line[e])) e++;
    return e > s ? line.slice(s, e) : undefined;
  };
  const cLines = consumer.split("\n");
  const rootLn = cLines.findIndex((l) => l.includes("o: Order"));
  return {
    root: { uri: CONSUMER_URI, line: rootLn, character: cLines[rootLn].indexOf("Order", cLines[rootLn].indexOf("o:")) },
    openFile: async (u) => textOf(u),
    extractor: {
      async definition(cursor) {
        const text = textOf(cursor.uri);
        const w = text && wordAt(text, cursor);
        if (!w || !(w in defs)) {
          return undefined;
        }
        const { line, ch } = defs[w];
        return { uri: DOMAIN_URI, range: { startLine: line, startCharacter: ch, endLine: line, endCharacter: ch + w.length } };
      },
      async hoverSurface(cursor) {
        const text = textOf(cursor.uri);
        const w = text && wordAt(text, cursor);
        return w && w in hovers ? { signature: hovers[w] } : undefined;
      },
      async membersOfType() {
        return [];
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
    },
  };
}

test("M-1: a single-letter type param never queues - no chrome def, no drop noise", async () => {
  const { extractor, root, openFile } = fakeGenericTsExtractor("T");
  const shape = await resolveCrossFileShape(extractor, root, { D_MAX: 2, N_MAX: 12 }, openFile, tsShapeHooks);
  assert.deepStrictEqual([...shape.types.keys()], ["Order", "Customer"]);
  assert.deepStrictEqual(shape.dropped, []);
  for (const t of shape.types.values()) {
    assert.ok(!toResolveStruct(shape, tsShapeHooks)(t.name).def.includes("(type parameter)"), t.name);
  }
});

test("M-1: a multi-letter type param's chrome hover is REFUSED - a stop edge in dropped, never a def", async () => {
  const { extractor, root, openFile } = fakeGenericTsExtractor("TRow");
  const shape = await resolveCrossFileShape(extractor, root, { D_MAX: 2, N_MAX: 12 }, openFile, tsShapeHooks);
  assert.deepStrictEqual([...shape.types.keys()], ["Order", "Customer"]);
  assert.ok(!shape.types.has("TRow"), "the type parameter is never emitted");
  assert.ok(shape.dropped.includes("TRow"), "the refused hop is recorded, never silent");
});

test("shapeHooksFor: TS ids get the TS hooks; rust and unknown ids keep the Rust defaults (undefined)", () => {
  for (const id of TS_LANGUAGE_IDS) {
    assert.strictEqual(shapeHooksFor(id), tsShapeHooks, id);
  }
  // v11 phase 4: python now has its own signatures-only hooks (pyShapeHooks),
  // like csharp — so only rust and unknown ids keep the Rust defaults (undefined).
  assert.notStrictEqual(shapeHooksFor("python"), undefined, "python resolves its own hooks");
  for (const id of ["rust", ""]) {
    assert.strictEqual(shapeHooksFor(id), undefined, id || "(empty)");
  }
});

test("TS_STD_TYPE_NAMES: the walk-stop set names the common lib types and no user-shaped ones", () => {
  for (const name of ["Promise", "Array", "Map", "Record", "Date", "Buffer"]) {
    assert.ok(TS_STD_TYPE_NAMES.has(name), name);
  }
  for (const name of ["Order", "ThemeStore", "Alias"]) {
    assert.ok(!TS_STD_TYPE_NAMES.has(name), name);
  }
});

// ---------------------------------------------------------------------------
// The vscode-layer mechanisms of M-3 and M-4 (resolveFunctionAtCursor) and
// M-1's candidate path (tsPrioritizedTypes): a stub-aliased bundle, the
// impl-v3-structgen pattern. Real TS navtree shape: the symbol range INCLUDES
// decorators and EXCLUDES the JSDoc, so decorator trivia used to defeat the
// docComment===undefined guard and the doc never reached the channel.
// ---------------------------------------------------------------------------

const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const VS_STUB = path.join(__dirname, ".impl-v9-gestures-stub.cjs");
fs.writeFileSync(
  VS_STUB,
  `
const state = { symbols: undefined };
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b) { this.start = a; this.end = b; }
  contains(p) {
    const afterStart = p.line > this.start.line || (p.line === this.start.line && p.character >= this.start.character);
    const beforeEnd = p.line < this.end.line || (p.line === this.end.line && p.character <= this.end.character);
    return afterStart && beforeEnd;
  }
}
class EventEmitter { constructor(){ this.h=[]; } get event(){ return (fn)=>{ this.h.push(fn); return {dispose(){}}; }; } fire(){} dispose(){} }
module.exports = {
  __state: state, Position, Range, EventEmitter,
  WorkspaceEdit: class { replace() {} },
  Uri: { from: (o) => ({ ...o, toString: () => o.scheme + "://" + o.path }), parse: (s) => ({ toString: () => s, fsPath: s }) },
  SymbolKind: { Method: 5, Function: 11, Class: 4 },
  ProgressLocation: { Window: 10 },
  TabInputTextDiff: class {},
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, inspect: () => undefined, update: async () => {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return []; },
    applyEdit: async () => true,
  },
  window: {
    activeTextEditor: undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    withProgress: async (o, t) => t({ report(){} }),
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }) },
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async (id) => (id === "vscode.executeDocumentSymbolProvider" ? state.symbols : undefined),
  },
};
`,
);
const vsEntry = path.join(__dirname, ".impl-v9-gestures-vs.entry.ts");
const vsOut = path.join(__dirname, ".impl-v9-gestures-vs.bundle.cjs");
fs.writeFileSync(
  vsEntry,
  `export { resolveFunctionAtCursor, tsPrioritizedTypes } from "../src/vscode/fnGen";\n` +
    `export { Position, Range, SymbolKind, __state } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [vsEntry], bundle: true, outfile: vsOut, format: "cjs", platform: "node", alias: { vscode: VS_STUB } });
const vsMod = require(vsOut);
test.after(() => {
  for (const f of [VS_STUB, vsEntry, vsOut]) fs.rmSync(f, { force: true });
});

function makeTsDoc(text, languageId) {
  const lineStart = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStart.push(i + 1);
  const offsetOf = (line, character) => lineStart[line] + character;
  return {
    languageId,
    version: 1,
    uri: { path: "/x.ts", toString: () => "file:///x.ts" },
    getText(range) {
      if (!range) return text;
      return text.slice(offsetOf(range.start.line, range.start.character), offsetOf(range.end.line, range.end.character));
    },
    offsetAt(pos) { return offsetOf(pos.line, pos.character); },
    positionAt(off) {
      let line = 0;
      while (line + 1 < lineStart.length && lineStart[line + 1] <= off) line++;
      return new vsMod.Position(line, off - lineStart[line]);
    },
    lineAt(line) {
      const t = text.split("\n")[line] ?? "";
      return { text: t, firstNonWhitespaceCharacterIndex: t.length - t.trimStart().length };
    },
  };
}
const tsPosAt = (text, off) => {
  const pre = text.slice(0, off);
  const line = pre.split("\n").length - 1;
  return new vsMod.Position(line, off - (pre.lastIndexOf("\n") + 1));
};
const tsRangeFor = (text, s, e) => new vsMod.Range(tsPosAt(text, s), tsPosAt(text, e));

const DECORATED = `class Svc {\n  /** Doc for method. DOC_SENTINEL */\n  @traced()\n  run(a: number): number {\n    return a;\n  }\n}\n`;

function decoratedSymbols(t) {
  const decOff = t.indexOf("@traced");
  const endOff = t.indexOf("}", t.indexOf("return")) + 1;
  const nameOff = t.indexOf("run(");
  return [
    {
      name: "Svc", kind: vsMod.SymbolKind.Class,
      range: tsRangeFor(t, t.indexOf("class Svc"), t.lastIndexOf("}") + 1),
      selectionRange: tsRangeFor(t, t.indexOf("Svc"), t.indexOf("Svc") + 3),
      children: [
        {
          name: "run", kind: vsMod.SymbolKind.Method,
          range: tsRangeFor(t, decOff, endOff), // decorator IN range, JSDoc OUT
          selectionRange: tsRangeFor(t, nameOff, nameOff + 3),
          children: [],
        },
      ],
    },
  ];
}

test("R2-2: a MULTILINE-argument decorator between JSDoc and method no longer eats the doc", async () => {
  const t = `class Svc {\n  /** Doc for method. DOC_SENTINEL */\n  @traced({\n    role: "admin",\n  })\n  run(a: number): number {\n    return a;\n  }\n}\n`;
  vsMod.__state.symbols = decoratedSymbols(t);
  const doc = makeTsDoc(t, "typescript");
  const r = await vsMod.resolveFunctionAtCursor(doc, tsPosAt(t, t.indexOf("return") + 2), false);
  assert.ok(r, "resolves");
  assert.ok(r.docComment !== undefined && r.docComment.includes("DOC_SENTINEL"), `the doc survives interior decorator lines, got ${JSON.stringify(r.docComment)}`);
});

test("M-3: decorator trivia no longer eats the JSDoc - the doc reaches docComment, decorators kept below it", async () => {
  vsMod.__state.symbols = decoratedSymbols(DECORATED);
  const doc = makeTsDoc(DECORATED, "typescript");
  const r = await vsMod.resolveFunctionAtCursor(doc, tsPosAt(DECORATED, DECORATED.indexOf("return") + 2), false);
  assert.ok(r, "resolves");
  assert.ok(r.docComment !== undefined && r.docComment.includes("DOC_SENTINEL"), `the human's doc reaches the channel, got ${JSON.stringify(r.docComment)}`);
  assert.ok(r.docComment.includes("@traced()"), "the decorator stays in the channel too");
  assert.strictEqual(r.signature, "run(a: number): number", "the span still starts at the declaration head");
});

test("M-3 restraint: a decorated method with NO doc above keeps its decorator trivia unchanged", async () => {
  const src = DECORATED.replace("  /** Doc for method. DOC_SENTINEL */\n", "");
  vsMod.__state.symbols = decoratedSymbols(src);
  const doc = makeTsDoc(src, "typescript");
  const r = await vsMod.resolveFunctionAtCursor(doc, tsPosAt(src, src.indexOf("return") + 2), false);
  assert.ok(r);
  assert.strictEqual(r.docComment && r.docComment.trim(), "@traced()");
});

test("M-4 at the seam: a TS document's resolved signature is the depth-aware head (destructured params survive)", async () => {
  const src = `export function Panel({ title, count }: Props): string {\n  return title;\n}\n`;
  const nameOff = src.indexOf("Panel");
  vsMod.__state.symbols = [
    {
      name: "Panel", kind: vsMod.SymbolKind.Function,
      range: tsRangeFor(src, 0, src.indexOf("\n}") + 2),
      selectionRange: tsRangeFor(src, nameOff, nameOff + 5),
      children: [],
    },
  ];
  const doc = makeTsDoc(src, "typescriptreact");
  const r = await vsMod.resolveFunctionAtCursor(doc, tsPosAt(src, src.indexOf("return") + 2), false);
  assert.ok(r);
  assert.strictEqual(r.signature, "export function Panel({ title, count }: Props): string");
});

test("M-1 candidate path: tsPrioritizedTypes filters bare single-letter names (a generic param is never a candidate)", () => {
  const out = vsMod.tsPrioritizedTypes("export function tally<T>(o: Order<T>): number", undefined, "", new Set());
  assert.deepStrictEqual(out, ["Order"]);
});

// ---------------------------------------------------------------------------
// The construction member does not leak into "Members of X". `derived.methods`
// feeds a header that tells the model these are names to type, and a
// `constructor Order(...)` line under it invites `o.constructor(...)`, which is
// Object.prototype and not the class. The same line under the "to build a X:"
// header is exactly right, which is why the member set keeps the constructor
// and the consumer drops it.
// ---------------------------------------------------------------------------

function fakeCtorMemberExtractor() {
  const base = fakeTsExtractor();
  return {
    ...base,
    async membersOfType() {
      return [
        { name: "constructor", kind: "method", signature: "constructor Order(reference: string): Order" },
        { name: "total", kind: "method", signature: "total(): number" },
        { name: "reference", kind: "field", signature: "reference: string" },
      ];
    },
  };
}

test("Members of X: the constructor is filtered at the consumer, the other methods survive", async () => {
  const shape = await resolveCrossFileShape(
    fakeCtorMemberExtractor(),
    orderRefCursor(),
    { D_MAX: 2, N_MAX: 12 },
    openFile,
    tsShapeHooks,
  );
  const methods = shape.types.get("Order").methods;
  assert.deepStrictEqual(
    methods.filter((l) => /(^|\W)constructor(\W|$)/.test(l)),
    [],
    `no line under "Members of X (use these exact names)" may be the constructor; got ${JSON.stringify(methods)}`,
  );
  assert.ok(
    methods.some((l) => l.includes("total()")),
    `the filter must remove ONLY the constructor; got ${JSON.stringify(methods)}`,
  );
});
