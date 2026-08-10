// BLIND contract oracle for session-v30 phase 6: a single uppercase LETTER is a
// generic parameter, not a type, and the cross-file walk must never spend a
// round trip resolving one. Written from a real dogfood log before the
// implementation existed, from the exported surface only, and never edited to
// make an implementation pass.
//
// WHAT THE LOG SHOWED. A repair round on a real Rust repo put this in the
// model's prompt:
//
//     pub struct LruCache<K, V, S = DefaultHasher> {
//         map: HashMap<KeyRef<K>, NonNull<LruEntry<K, V>>, S>,
//         cap: NonZero<usize>,
//         ...
//     }
//
//     struct KeyRef<K> {
//         k: *const K,
//     }
//
//     K
//
// The trailing bare `K` is a type PARAMETER resolved as if it were a type. The
// channel carried `[fngen] pre-fill dropped 17 non-public member(s) from `K``,
// and again from `V` and from `S`, each listing LruCache's own members: the
// definition lookup for a parameter lands somewhere useless, burns a resolver
// round trip, and holds a slot of the type cap that a real collaborator needed.
//
// WHAT IS PINNED HERE. The languages that run on the walk's DEFAULTS are Rust
// and Go, because `shapeHooksFor` answers undefined for both. Those two, plus
// TypeScript through its own hooks, must all agree: a single letter never
// queues, and a multi-letter name that merely starts uppercase (`Kind`, `T1`,
// `Ok`, `Kx`) still does. The over-correction rows matter most. A guard that
// also killed real types would be a worse defect than the one it fixes.
//
// THE SHARPEST ASSERTION IS THE CALL COUNT. Every fixture below counts the
// extractor calls by the word under the cursor, so a row can say no round trip
// was spent on `K` at all, which is the cost the log was complaining about.
// Each no-queue row carries a concrete type in the same field position that
// DOES resolve, so a fixture that resolves nothing cannot fake a pass.
//
// Run: SKIP_LIVE=1 node --test test/blind-v30-p6-genericparams.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v30-p6-genericparams",
  `export { resolveCrossFileShape, shapeHooksFor } from "../src/core/crossFileShape";\n`,
);
const { resolveCrossFileShape, shapeHooksFor } = mod;
test.after(cleanup);

const show = (v) => JSON.stringify(v);

// ===========================================================================
// The fake extractor. It answers from an in-memory table keyed by the word
// under the cursor, which is how a real server behaves: the walk hands it a
// position, not a name. Every call is recorded, so `spent(name)` is the number
// of round trips the walk paid for that word.
// ===========================================================================

const wordAt = (text, cursor) => {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (ch) => /[A-Za-z0-9_$]/.test(ch);
  let start = Math.min(cursor.character, line.length);
  let end = start;
  while (start > 0 && isWord(line[start - 1])) start--;
  while (end < line.length && isWord(line[end])) end++;
  return end > start ? line.slice(start, end) : undefined;
};

// `defs` maps a name to the position of its declaration in the def file, which
// is what a definition provider returns. A name absent from `defs` resolves to
// nothing, the same as a server that cannot place it.
function fixture({ consumerUri, defUri, consumerText, defText, hovers, members = {}, defs }) {
  const calls = [];
  const textOf = (uri) => (uri === consumerUri ? consumerText : uri === defUri ? defText : undefined);
  const at = (cursor, op) => {
    const word = wordAt(textOf(cursor.uri) ?? "", cursor);
    calls.push(`${op}(${word})`);
    return word;
  };
  const extractor = {
    async definition(cursor) {
      const word = at(cursor, "definition");
      if (!word || !(word in defs)) {
        return undefined;
      }
      const { line, character } = defs[word];
      return {
        uri: defUri,
        range: { startLine: line, startCharacter: character, endLine: line, endCharacter: character + word.length },
      };
    },
    async hoverSurface(cursor) {
      const word = at(cursor, "hover");
      return word && word in hovers ? { signature: hovers[word] } : undefined;
    },
    async membersOfType(cursor) {
      const word = at(cursor, "members");
      return (members[word] ?? []).map((m) => ({ ...m }));
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
  return {
    extractor,
    calls,
    openFile: async (uri) => textOf(uri),
    // The cursor on the first occurrence of `name` in the consumer's signature
    // line, which is the anchor a caller holds.
    rootAt(name, line = 0) {
      const text = consumerText.split("\n")[line] ?? "";
      return { uri: consumerUri, line, character: text.indexOf(name) };
    },
    spent(name) {
      return calls.filter((c) => c.endsWith(`(${name})`)).length;
    },
  };
}

const keys = (shape) => [...shape.types.keys()];

// ===========================================================================
// 0. THE PREMISE. Rust and Go have no hooks, so they run on the walk's
// defaults. Every row below that says "the defaults" depends on this, and a
// hooks table that quietly grew a Rust or Go entry would make those rows
// measure something else.
//
// PARTLY SUPERSEDED 2026-08-02, session-v37 item 7. Go now HAS hooks, and this
// row did its job: it is the row that caught the change, exactly as its comment
// said it would.
//
// Go was injecting a struct hover byte for byte, gopls chrome and every field's
// prose comment included. `cobra.Command` shipped at 8363 bytes, roughly eleven
// times the per-type budget, so one Go candidate could spend the whole injected
// surface. `goShapeHooks` fixes it at 1944 bytes with every field line kept.
//
// The premise this row DEFENDS still holds, which is why it is amended rather
// than deleted. Those hooks change `renderDef` and nothing else: `parseHoverFields`
// stays the Rust default, so the field leg every row below depends on is
// untouched, and rows 6 and 8 pass `shapeHooksFor("go")` through rather than
// asserting it is undefined, and both stay green. The assertion is therefore
// narrowed to what the file actually needs, that Go still runs the DEFAULT field
// parser, instead of the broader claim that Go has no hooks at all.
test("0 premise [AMENDED 2026-08-02]: rust runs on the walk's DEFAULTS, and go still uses the default FIELD parser", () => {
  assert.equal(shapeHooksFor("rust"), undefined, "rust has no hooks, so the defaults are its behaviour");
  const go = shapeHooksFor("go");
  assert.equal(typeof go, "object", "go now brings hooks, for renderDef only (session-v37 item 7)");
  // The claim that matters: Go did not adopt another language's field parser on
  // its way to getting a renderer. If it had, every row below measuring "the
  // defaults" would be measuring that language instead.
  for (const id of ["typescript", "csharp", "python"]) {
    assert.notEqual(
      go.parseHoverFields,
      shapeHooksFor(id).parseHoverFields,
      `go's field parser must not be ${id}'s; the hooks are for renderDef only`,
    );
  }
  for (const id of ["typescript", "csharp", "python"]) {
    assert.equal(typeof shapeHooksFor(id), "object", `${id} brings its own hooks`);
  }
});

// ===========================================================================
// 1. RUST, THE CAPTURED SHAPE. The root is the struct from the log, with the
// parameters where the log had them and one concrete collaborator (`KeyRef`)
// standing in the same field. `K`, `V` and `S` all have definitions and hovers
// in the table, so the walk CAN reach them: it must choose not to.
// ===========================================================================

const RUST_CONSUMER_URI = "file:///w/v30p6/consumer.rs";
const RUST_DEF_URI = "file:///w/v30p6/lru.rs";
const RUST_DEF_LINES = [
  "pub struct LruCache<K, V, S = DefaultHasher> {",
  "    map: HashMap<KeyRef<K>, V, S>,",
  "    marker: Marker,",
  "}",
  "",
  "pub struct KeyRef<K> {",
  "    k: *const K,",
  "}",
  "",
  "pub struct Marker {",
  "    tag: u64,",
  "}",
];
const RUST_DEF = `${RUST_DEF_LINES.join("\n")}\n`;
const RUST_CONSUMER = "fn read_cache(c: &LruCache) {\n\n}\n";

// A parameter's def position is where the server would place it: the type
// parameter's own declaration in the generic list. Its hover is what
// rust-analyzer renders there. Both exist so that "the walk never asked" is a
// claim about the walk, not about a table with a hole in it.
const RUST_DEFS = {
  LruCache: { line: 0, character: RUST_DEF_LINES[0].indexOf("LruCache") },
  KeyRef: { line: 5, character: RUST_DEF_LINES[5].indexOf("KeyRef") },
  Marker: { line: 9, character: RUST_DEF_LINES[9].indexOf("Marker") },
  K: { line: 0, character: RUST_DEF_LINES[0].indexOf("K,") },
  V: { line: 0, character: RUST_DEF_LINES[0].indexOf("V,") },
  S: { line: 0, character: RUST_DEF_LINES[0].indexOf("S =") },
};
const RUST_HOVERS = {
  LruCache: "pub struct LruCache<K, V, S = DefaultHasher> { map: HashMap<KeyRef<K>, V, S>, marker: Marker }",
  KeyRef: "pub struct KeyRef<K> { k: *const K }",
  Marker: "pub struct Marker { tag: u64 }",
  K: "K",
  V: "V",
  S: "S",
};
// The 17 members the log said were filtered off `K`: LruCache's own, which is
// what the server answers at a parameter's position. If the walk queues `K`,
// this is the wrong-type payload it carries.
const LRU_MEMBERS = Array.from({ length: 17 }, (_, i) => ({
  name: `lru_member_${i}`,
  signature: `lru_member_${i}(&self) -> u64`,
  kind: "method",
}));

const rustFixture = () =>
  fixture({
    consumerUri: RUST_CONSUMER_URI,
    defUri: RUST_DEF_URI,
    consumerText: RUST_CONSUMER,
    defText: RUST_DEF,
    hovers: RUST_HOVERS,
    defs: RUST_DEFS,
    members: { LruCache: LRU_MEMBERS, K: LRU_MEMBERS, V: LRU_MEMBERS, S: LRU_MEMBERS },
  });

const RUST_BOUND = { D_MAX: 3, N_MAX: 12 };

test("1 [rust]: the parameters of `HashMap<KeyRef<K>, V, S>` are never types in the shape", async () => {
  const f = rustFixture();
  const shape = await resolveCrossFileShape(f.extractor, f.rootAt("LruCache"), RUST_BOUND, f.openFile);
  for (const parameter of ["K", "V", "S"]) {
    assert.ok(
      !shape.types.has(parameter),
      `\`${parameter}\` is a type parameter of LruCache, not a type. It resolves to nothing a caller can use and holds a slot of the type cap. Got ${show(keys(shape))}`,
    );
  }
});

test("1 [rust]: and no round trip is spent finding that out", async () => {
  const f = rustFixture();
  await resolveCrossFileShape(f.extractor, f.rootAt("LruCache"), RUST_BOUND, f.openFile);
  for (const parameter of ["K", "V", "S"]) {
    assert.equal(
      f.spent(parameter),
      0,
      `the cost is the point: a letter is decidable from the name alone, so the walk must never ask the server about \`${parameter}\`. Calls: ${show(f.calls)}`,
    );
  }
});

test("2 [rust]: the CONCRETE types beside the parameters still resolve", async () => {
  const f = rustFixture();
  const shape = await resolveCrossFileShape(f.extractor, f.rootAt("LruCache"), RUST_BOUND, f.openFile);
  assert.ok(shape.types.has("LruCache"), `the root resolves; got ${show(keys(shape))}`);
  assert.ok(
    shape.types.has("KeyRef"),
    `KeyRef sits INSIDE the same generic argument list as K and is a real struct. A guard that took it too would be a worse defect than the one it fixes. Got ${show(keys(shape))}`,
  );
  assert.ok(f.spent("KeyRef") > 0, `and it was reached by asking the server, not by luck; calls ${show(f.calls)}`);
  assert.deepEqual(
    shape.types.get("KeyRef").fields,
    [{ name: "k", typeName: "*const K" }],
    "KeyRef keeps its own field verbatim, parameter and all - the guard is about what gets QUEUED, not about rewriting a signature",
  );
});

test("3 [rust]: a bare single-letter field type never queues, and its concrete sibling does", async () => {
  const defLines = ["pub struct Slot<V> {", "    value: V,", "    key: KeyRef,", "}", "", "pub struct KeyRef {", "    hash: u64,", "}"];
  const f = fixture({
    consumerUri: "file:///w/v30p6/slot-consumer.rs",
    defUri: "file:///w/v30p6/slot.rs",
    consumerText: "fn read_slot(s: &Slot) {\n\n}\n",
    defText: `${defLines.join("\n")}\n`,
    hovers: { Slot: "pub struct Slot<V> { value: V, key: KeyRef }", KeyRef: "pub struct KeyRef { hash: u64 }", V: "V" },
    defs: {
      Slot: { line: 0, character: defLines[0].indexOf("Slot") },
      KeyRef: { line: 5, character: defLines[5].indexOf("KeyRef") },
      V: { line: 0, character: defLines[0].indexOf("V>") },
    },
  });
  const shape = await resolveCrossFileShape(f.extractor, f.rootAt("Slot"), RUST_BOUND, f.openFile);
  assert.ok(!shape.types.has("V"), `a field typed with the parameter itself is the plainest form of the defect; got ${show(keys(shape))}`);
  assert.equal(f.spent("V"), 0, `no round trip either; calls ${show(f.calls)}`);
  assert.ok(shape.types.has("KeyRef"), `the field beside it is a real type and must still walk; got ${show(keys(shape))}`);
});

// ===========================================================================
// 4. THE OVER-CORRECTION GUARD, and the row that matters most. Uppercase is
// not the signal. LENGTH is. `Kind`, `T1`, `Ok` and `Kx` all start with a
// capital and none of them is a type parameter; a rule reading "starts
// uppercase and looks generic" silently empties the shape graph, and no log
// line says so.
//
// `Vec` is deliberately not in this row for Rust: it is filtered as a STD name
// long before any parameter rule sees it, so it would prove nothing here. It
// gets its row under TypeScript below, where it is an ordinary local name.
// ===========================================================================

test("4 [rust]: multi-letter names that start uppercase are types, not parameters", async () => {
  const defLines = [
    "pub struct Holder {",
    "    kind: Kind,",
    "    t1: T1,",
    "    ok: Ok,",
    "    kx: Kx,",
    "}",
    "",
    "pub struct Kind { a: u8 }",
    "pub struct T1 { b: u8 }",
    "pub struct Ok { c: u8 }",
    "pub struct Kx { d: u8 }",
  ];
  const named = { Kind: 7, T1: 8, Ok: 9, Kx: 10 };
  const f = fixture({
    consumerUri: "file:///w/v30p6/holder-consumer.rs",
    defUri: "file:///w/v30p6/holder.rs",
    consumerText: "fn read_holder(h: &Holder) {\n\n}\n",
    defText: `${defLines.join("\n")}\n`,
    hovers: {
      Holder: "pub struct Holder { kind: Kind, t1: T1, ok: Ok, kx: Kx }",
      Kind: "pub struct Kind { a: u8 }",
      T1: "pub struct T1 { b: u8 }",
      Ok: "pub struct Ok { c: u8 }",
      Kx: "pub struct Kx { d: u8 }",
    },
    defs: {
      Holder: { line: 0, character: defLines[0].indexOf("Holder") },
      ...Object.fromEntries(Object.entries(named).map(([n, l]) => [n, { line: l, character: defLines[l].indexOf(n) }])),
    },
  });
  const shape = await resolveCrossFileShape(f.extractor, f.rootAt("Holder"), { D_MAX: 3, N_MAX: 20 }, f.openFile);
  for (const name of Object.keys(named)) {
    assert.ok(
      shape.types.has(name),
      `\`${name}\` is two characters or more and names a real struct. A guard that reads the capital instead of the length takes the whole shape graph with it. Got ${show(keys(shape))}`,
    );
  }
});

// ===========================================================================
// 5. `dropped` IS FOR A TYPE THE WALK GAVE UP ON, not for a name that was
// never a type. The consumer prints it as `data-shape walk <T> dropped N:
// ...`, which is a report that a cap or a refusal cost the caller a real
// collaborator. A parameter costs nothing, so naming it there turns a clean
// walk into a log line about a loss that did not happen.
//
// The row is written as PARITY rather than as a preference: TypeScript already
// decides single letters through its own hooks, and whatever it reports, the
// defaults must report the same. A file that pinned only Rust could be made
// green by a rule the two languages disagree about.
// ===========================================================================

test("5 [rust]: a skipped parameter is not reported as `dropped` either", async () => {
  const f = rustFixture();
  const shape = await resolveCrossFileShape(f.extractor, f.rootAt("LruCache"), RUST_BOUND, f.openFile);
  for (const parameter of ["K", "V", "S"]) {
    assert.ok(
      !shape.dropped.includes(parameter),
      `\`dropped\` names collaborators the walk could not deliver. A parameter was never one, so it is neither in types nor in dropped. Got ${show(shape.dropped)}`,
    );
  }
});

// ===========================================================================
// 6. GO, through `shapeHooksFor("go")` being undefined. Same claim as row 1,
// on the same defaults.
//
// OBSERVED WHILE WRITING THIS FILE, stated because it changes what the row can
// prove: the shared field parser reads NO fields out of a Go struct hover
// (`type Cache struct { head *KeyRef }` has no `name: type` form to split), so
// nothing at all is queued from a Go struct, parameter or otherwise. The row
// stands as the ratchet the phase names, and it cannot carry a concrete
// control the way the Rust rows do, because Go has no field edge to walk.
// ===========================================================================

const GO_DEF_LINES = [
  "type Cache[K comparable, V any] struct {",
  "\thead *KeyRef",
  "\titem V",
  "}",
  "",
  "type KeyRef struct {",
  "\tHash uint64",
  "}",
];

const goFixture = () =>
  fixture({
    consumerUri: "file:///w/v30p6/consumer.go",
    defUri: "file:///w/v30p6/cache.go",
    consumerText: "func read(c *Cache) {\n\n}\n",
    defText: `${GO_DEF_LINES.join("\n")}\n`,
    hovers: {
      Cache: "type Cache[K comparable, V any] struct { head *KeyRef; item V }",
      KeyRef: "type KeyRef struct { Hash uint64 }",
      K: "type parameter K comparable",
      V: "type parameter V any",
    },
    defs: {
      Cache: { line: 0, character: GO_DEF_LINES[0].indexOf("Cache") },
      KeyRef: { line: 5, character: GO_DEF_LINES[5].indexOf("KeyRef") },
      K: { line: 0, character: GO_DEF_LINES[0].indexOf("K comparable") },
      V: { line: 0, character: GO_DEF_LINES[0].indexOf("V any") },
    },
    members: {
      Cache: [
        { name: "Get", signature: "func (c *Cache[K, V]) Get(k K) (V, bool)", kind: "method" },
        { name: "Ref", signature: "func (c *Cache[K, V]) Ref() *KeyRef", kind: "method" },
      ],
      K: LRU_MEMBERS,
      V: LRU_MEMBERS,
    },
  });

test("6 [go]: a type parameter of a generic struct is never a type in the shape, and costs no round trip", async () => {
  const f = goFixture();
  const shape = await resolveCrossFileShape(f.extractor, f.rootAt("Cache"), RUST_BOUND, f.openFile, shapeHooksFor("go"));
  assert.ok(shape.types.has("Cache"), `fixture precondition: the root resolves; got ${show(keys(shape))}`);
  for (const parameter of ["K", "V"]) {
    assert.ok(!shape.types.has(parameter), `\`${parameter}\` is a Go type parameter; got ${show(keys(shape))}`);
    assert.equal(f.spent(parameter), 0, `and nothing was asked about it; calls ${show(f.calls)}`);
    assert.ok(!shape.dropped.includes(parameter), `nor is it a loss to report; got ${show(shape.dropped)}`);
  }
});

// ===========================================================================
// 7. TYPESCRIPT, UNCHANGED. It already decides this through its own hooks, and
// the phase must not disturb it. This is also the parity anchor row 5 argues
// from: the two languages must agree on where a skipped parameter is NOT.
// ===========================================================================

const TS_DEF_LINES = [
  "export type Order<K> = { key: K; ref: KeyRef; kind: Kind };",
  "",
  "export type KeyRef = { hash: number };",
  "export type Kind = { tag: string };",
];

test("7 [typescript]: a single-letter parameter still never queues, and its siblings still do", async () => {
  const f = fixture({
    consumerUri: "file:///w/v30p6/consumer.ts",
    defUri: "file:///w/v30p6/domain.ts",
    // The function's own name never contains a fixture type name, or the root
    // cursor lands inside it and the row measures nothing.
    consumerText: "export function read(o: Order): number {\n\n}\n",
    defText: `${TS_DEF_LINES.join("\n")}\n`,
    hovers: {
      Order: "type Order<K> = { key: K; ref: KeyRef; kind: Kind }",
      KeyRef: "type KeyRef = { hash: number }",
      Kind: "type Kind = { tag: string }",
      // What tsserver actually renders at a type parameter: quickinfo chrome,
      // never a definition. Injecting it is the TS form of the same defect.
      K: "(type parameter) K in type Order<K>",
    },
    defs: {
      Order: { line: 0, character: TS_DEF_LINES[0].indexOf("Order") },
      KeyRef: { line: 2, character: TS_DEF_LINES[2].indexOf("KeyRef") },
      Kind: { line: 3, character: TS_DEF_LINES[3].indexOf("Kind") },
      K: { line: 0, character: TS_DEF_LINES[0].indexOf("<K>") + 1 },
    },
  });
  const shape = await resolveCrossFileShape(f.extractor, f.rootAt("Order"), RUST_BOUND, f.openFile, shapeHooksFor("typescript"));
  assert.deepEqual(keys(shape).sort(), ["KeyRef", "Kind", "Order"], `only the real types; got ${show(keys(shape))}`);
  assert.equal(f.spent("K"), 0, `no chrome hover was ever paid for; calls ${show(f.calls)}`);
  assert.ok(!shape.dropped.includes("K"), `and a skipped parameter is not a reported loss; got ${show(shape.dropped)}`);
});

test("7 [typescript]: `Kind`, `Vec`, `T1` and `Ok` are ordinary types and still walk", async () => {
  const defLines = [
    "export type Holder = { kind: Kind; vec: Vec; t1: T1; ok: Ok };",
    "",
    "export type Kind = { tag: string };",
    "export type Vec = { n: number };",
    "export type T1 = { n: number };",
    "export type Ok = { n: number };",
  ];
  const named = { Kind: 2, Vec: 3, T1: 4, Ok: 5 };
  const f = fixture({
    consumerUri: "file:///w/v30p6/holder-consumer.ts",
    defUri: "file:///w/v30p6/holder.ts",
    consumerText: "export function read(h: Holder): number {\n\n}\n",
    defText: `${defLines.join("\n")}\n`,
    hovers: {
      Holder: "type Holder = { kind: Kind; vec: Vec; t1: T1; ok: Ok }",
      Kind: "type Kind = { tag: string }",
      Vec: "type Vec = { n: number }",
      T1: "type T1 = { n: number }",
      Ok: "type Ok = { n: number }",
    },
    defs: {
      Holder: { line: 0, character: defLines[0].indexOf("Holder") },
      ...Object.fromEntries(Object.entries(named).map(([n, l]) => [n, { line: l, character: defLines[l].indexOf(n) }])),
    },
  });
  const shape = await resolveCrossFileShape(f.extractor, f.rootAt("Holder"), { D_MAX: 3, N_MAX: 20 }, f.openFile, shapeHooksFor("typescript"));
  for (const name of Object.keys(named)) {
    assert.ok(shape.types.has(name), `\`${name}\` is a local type here, not a parameter; got ${show(keys(shape))}`);
  }
});

// ===========================================================================
// 8. THE ROOT IS A SINGLE LETTER. A root is HANDED to the walk, not queued by
// it, so the phase's rule does not reach it and this row pins no preference.
// It pins the one thing that is not a preference: the walk must not crash, and
// must return a well-formed shape whatever it decides.
//
// OBSERVED at the time of writing, on all three of rust, go and typescript:
// the walk emits a type named `K`, its signature is the hover text `K`, and it
// carries whatever the server answered at that position, which in the captured
// log was LruCache's own 17 members. That is byte for byte the block the human
// saw, so the leak the dogfood log recorded enters HERE, on the root side, and
// not through the field queue rows 1 to 6 cover. Recorded, not asserted.
// ===========================================================================

const singleLetterRoot = (languageId, hooks) => async () => {
  const defLines = ["pub struct LruCache<K, V> {", "    cap: usize,", "}"];
  const f = fixture({
    consumerUri: `file:///w/v30p6/root-consumer.${languageId}`,
    defUri: `file:///w/v30p6/root-def.${languageId}`,
    consumerText: "fn read(x: &K) {\n\n}\n",
    defText: `${defLines.join("\n")}\n`,
    hovers: { K: "K" },
    defs: { K: { line: 0, character: defLines[0].indexOf("K") } },
    members: { K: LRU_MEMBERS },
  });
  const shape = await resolveCrossFileShape(f.extractor, f.rootAt("K"), { D_MAX: 2, N_MAX: 6 }, f.openFile, hooks);
  assert.ok(shape && shape.types instanceof Map, `a shape is always returned, never a throw; got ${show(shape)}`);
  assert.ok(Array.isArray(shape.dropped), "and `dropped` is always a list, even when the root itself was refused");
  for (const derived of shape.types.values()) {
    assert.equal(typeof derived.name, "string", "every emitted type is well formed");
    assert.ok(Array.isArray(derived.fields) && Array.isArray(derived.methods), `fields and methods are lists; got ${show(derived)}`);
  }
};

test("8 [rust]: a single-letter ROOT resolves to a well-formed shape and never throws", singleLetterRoot("rs", undefined));
test("8 [go]: the same, on the go defaults", singleLetterRoot("go", shapeHooksFor("go")));
test("8 [typescript]: the same, through the ts hooks", singleLetterRoot("ts", shapeHooksFor("typescript")));
