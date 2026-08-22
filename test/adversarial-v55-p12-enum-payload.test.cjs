// ADVERSARIAL REVIEW of session-v55 phase 12 (Q13): the Rust enum payload edge.
//
// Every row here was MEASURED by running the facade. Where a row says "before",
// the before-value was measured against a git worktree at HEAD e3792fa (the
// phase-11 close, i.e. the tree without the phase-12 diff) with the identical
// fixture, and the number is pinned as a literal because the worktree is not a
// durable artifact. Every row's ASSERTION is about the CURRENT build, so no row
// depends on that worktree existing.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v55-p12-enum-payload.test.cjs
//
// SHIPPING BOUNDS ARE USED, not invented ones. `fnGen.ts:1582` CROSS_FILE_BOUND
// = { D_MAX: 2, N_MAX: 12 } is the Rust gather bound (Rust does NOT set
// `gatherBreadth`, so no B_MAX is passed - see A5), and `fnGen.ts:1567`
// DATASHAPE_BOUNDS = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX } is what
// `walkDataShape` renders under. A re-derived bound has inverted a measurement
// in this project before ("harness must use the product mapping").

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "adversarial-v55-p12",
  `export {
  resolveCrossFileShape,
  shapeHooksFor,
  renderDerivedDef,
  toResolveStruct,
  parseEnumVariantPayloads,
} from "../src/core/crossFileShape";
export { recoverElidedSurface } from "../src/core/rustHoverRecovery";
export { walkDataShape } from "../src/core/dataShape";\n`,
);
const {
  resolveCrossFileShape,
  shapeHooksFor,
  toResolveStruct,
  parseEnumVariantPayloads,
  recoverElidedSurface,
  walkDataShape,
} = mod;
test.after(cleanup);

const GATHER = { D_MAX: 2, N_MAX: 12 }; // fnGen.ts:1582, verbatim
const RENDER = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 800 }; // fnGen.ts:1567 shape

const show = (v) => JSON.stringify(v);

// A positional fake extractor: it answers by the WORD UNDER THE CURSOR, so a
// claim about "the walk asked" is a claim about the walk. Same shape as the
// blind oracle's, so the two files measure the same product through the same
// door.
const wordAt = (text, cursor) => {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (ch) => /[A-Za-z0-9_$]/.test(ch);
  let start = Math.min(cursor.character, line.length);
  let end = start;
  while (start > 0 && isWord(line[start - 1])) start--;
  while (end < line.length && isWord(line[end])) end++;
  return end > start ? line.slice(start, end) : undefined;
};

function fixture({ files, hovers, defs, members = {} }) {
  const calls = [];
  const at = (cursor, op) => {
    const w = wordAt(files[cursor.uri] ?? "", cursor);
    calls.push(`${op}(${w})`);
    return w;
  };
  const extractor = {
    async definition(c) {
      const w = at(c, "definition");
      if (!w || !(w in defs)) return undefined;
      const d = defs[w];
      return {
        uri: d.uri,
        range: { startLine: d.line, startCharacter: d.character, endLine: d.line, endCharacter: d.character + w.length },
      };
    },
    async hoverSurface(c) {
      const w = at(c, "hover");
      return w && w in hovers ? { signature: hovers[w] } : undefined;
    },
    async membersOfType(c) {
      const w = at(c, "members");
      return (members[w] ?? []).map((m) => ({ ...m }));
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
  return { extractor, calls, openFile: async (uri) => files[uri] };
}

const spent = (f, op, name) => f.calls.filter((c) => c === `${op}(${name})`).length;

// ===========================================================================
// THE RE-CUT OF P12-3c.
//
// The blind oracle's P12-3c pinned "an enum yields NO walkable render edge" and
// its own header says that if the ruling is "the payload IS a render edge" the
// row goes red and THAT RED IS THE DECLARATION, to be re-cut by the review or by
// triage and never by the implementer. The phase-12 contract's
// amendment makes that ruling. This review CONFIRMS it: the payload is a render
// edge, `DerivedType.fields` does not move, and the row below is the replacement
// text. It is written here rather than into the blind file, which the review may
// not edit.
// ===========================================================================

const CONSUMER = "file:///w/v55p12a/consumer.rs";
const ORDER = "file:///w/v55p12a/order.rs";
const STATUS = "file:///w/v55p12a/status.rs";
const RECEIPT = "file:///w/v55p12a/receipt.rs";
const MONEY = "file:///w/v55p12a/money.rs";

const BASE_FILES = {
  [CONSUMER]: "pub fn settle(order: &Order) {\n\n}\n",
  [ORDER]: "pub struct Order {\n    pub id: u64,\n    pub status: PaymentStatus,\n}\n",
  [STATUS]:
    "#[derive(Debug, Clone)]\npub enum PaymentStatus {\n    /// Nothing has been received yet.\n    Unpaid,\n    Paid(Receipt),\n    Refunded { amount: Money },\n}\n",
  [RECEIPT]: "pub struct Receipt {\n    pub reference: String,\n}\n",
  [MONEY]: "pub struct Money {\n    pub minor_units: i64,\n}\n",
};
// rust-analyzer's real enum hover ELIDES both payloads; the product's own
// `recoverElidedSurface` restores them. Same fidelity rule the blind file states.
const BASE_HOVERS = {
  Order: "pub struct Order {\n    pub id: u64,\n    pub status: PaymentStatus,\n}",
  PaymentStatus: "pub enum PaymentStatus {\n    Unpaid,\n    Paid( /* … */ ),\n    Refunded { /* … */ },\n}",
  Receipt: "pub struct Receipt {\n    pub reference: String,\n}",
  Money: "pub struct Money {\n    pub minor_units: i64,\n}",
};
const BASE_DEFS = {
  Order: { uri: ORDER, line: 0, character: 11 },
  PaymentStatus: { uri: STATUS, line: 1, character: 9 },
  Receipt: { uri: RECEIPT, line: 0, character: 11 },
  Money: { uri: MONEY, line: 0, character: 11 },
};
const ROOT = { uri: CONSUMER, line: 0, character: "pub fn settle(order: &".length };

const base = (over = {}) => fixture({ files: BASE_FILES, hovers: BASE_HOVERS, defs: BASE_DEFS, ...over });
const walkBase = (f, bound = GATHER) => resolveCrossFileShape(f.extractor, ROOT, bound, f.openFile);

test("GUARD: the fixture reaches the enum and the enum's payload files at all", async () => {
  const f = base();
  const shape = await walkBase(f);
  assert.ok(shape.types.has("Order"), `the root must resolve: ${show([...shape.types.keys()])}`);
  assert.ok(shape.types.has("PaymentStatus"), `the enum must resolve: ${show([...shape.types.keys()])}`);
  assert.equal(
    BASE_FILES[ORDER].includes("Receipt"),
    false,
    "order.rs must not name Receipt, or a one-hop walk could reach it and every row below proves nothing",
  );
});

test("A1 [P12-3c RE-CUT]: the enum's variant payloads ARE walkable render edges, and `fields` still does not move", async () => {
  const f = base();
  const shape = await walkBase(f);
  const status = toResolveStruct(shape)("PaymentStatus");
  assert.ok(status, "precondition: the enum must adapt at all");
  // THE RULING. `toResolveStruct` is the one seam `walkDataShape` takes its
  // walkable edges from, so a payload resolved into `shape.types` and left out
  // here buys extractor round trips and zero prompt bytes. The contract's
  // amendment rules that the payload IS a render edge; this is that ruling as a
  // row. `name` is the VARIANT name, not a field name - the one surprising byte,
  // pinned so a future consumer that reads `StructResolution.fields[].name`
  // expecting a field finds this row first.
  assert.deepEqual(
    status.fields,
    [
      { name: "Paid", typeName: "Receipt", isLocal: true },
      { name: "Refunded", typeName: "Money", isLocal: true },
    ],
    "the payload must reach the render's edge list, or the phase buys round trips and no prompt bytes",
  );
  // AND THE OTHER HALF OF THE AMENDMENT, in the same row on purpose: the ruling
  // is "a render edge", NOT "a field". ~20 sites read `DerivedType.fields`,
  // two of them the shape-path admission gates at fnGen.ts:1812 and :3654.
  assert.deepEqual(
    shape.types.get("PaymentStatus").fields,
    [],
    "`DerivedType.fields` must stay empty for an enum: the payload rides its own optional property",
  );
});

// ===========================================================================
// A2. ITEM 5, THE CONVERSE. A Rust STRUCT-only walk did not move a byte.
// ===========================================================================

const S_FILES = {
  "file:///w/v55p12s/c.rs": "pub fn go(o: &Order) {\n\n}\n",
  "file:///w/v55p12s/o.rs": "pub struct Order {\n    pub id: u64,\n    pub who: Customer,\n}\n",
  "file:///w/v55p12s/cu.rs": "pub struct Customer {\n    pub addr: Address,\n}\n",
  "file:///w/v55p12s/a.rs": "pub struct Address {\n    pub city: String,\n}\n",
};
const S_HOVERS = {
  Order: "pub struct Order {\n    pub id: u64,\n    pub who: Customer,\n}",
  Customer: "pub struct Customer {\n    pub addr: Address,\n}",
  Address: "pub struct Address {\n    pub city: String,\n}",
};
const S_DEFS = {
  Order: { uri: "file:///w/v55p12s/o.rs", line: 0, character: 11 },
  Customer: { uri: "file:///w/v55p12s/cu.rs", line: 0, character: 11 },
  Address: { uri: "file:///w/v55p12s/a.rs", line: 0, character: 11 },
};

test("A2: a Rust STRUCT-only walk emits the same bytes, the same drops and the same round trips as before the phase", async () => {
  const f = fixture({ files: S_FILES, hovers: S_HOVERS, defs: S_DEFS });
  const shape = await resolveCrossFileShape(
    f.extractor,
    { uri: "file:///w/v55p12s/c.rs", line: 0, character: 14 },
    GATHER,
    f.openFile,
  );
  const walk = walkDataShape("Order", toResolveStruct(shape), RENDER);
  // MEASURED at HEAD e3792fa (no phase-12 diff) with this exact fixture:
  // block, shape keys, drop list and the 12-call extractor trace were all
  // byte-identical to what is pinned here.
  assert.equal(
    walk.block,
    "pub struct Order {\n    pub id: u64,\n    pub who: Customer,\n}\n\n" +
      "pub struct Customer {\n    pub addr: Address,\n}\n\n" +
      "pub struct Address {\n    pub city: String,\n}",
    "a struct-only Rust walk must not move a byte: no signature here matches `enum <Name>`",
  );
  assert.deepEqual([...shape.types.keys()], ["Order", "Customer", "Address"]);
  assert.deepEqual(shape.dropped, []);
  assert.equal(f.calls.length, 12, `round trips must not move on a struct-only walk: ${show(f.calls)}`);
  assert.equal(
    shape.types.get("Order").variantPayloads,
    undefined,
    "the new property must be ABSENT, not empty, on every type that is not a payload-carrying enum",
  );
});

// ===========================================================================
// A3. ITEM 5, THE OTHER SIDE. Exactly what an enum-carrying walk now emits that
// it did not before - named in bytes, and priced in round trips.
// ===========================================================================

test("A3: an enum-carrying walk appends the payload defs, and buys six more round trips to do it", async () => {
  const f = base();
  const shape = await walkBase(f);
  const walk = walkDataShape("Order", toResolveStruct(shape), RENDER);
  const BEFORE_BLOCK =
    "pub struct Order {\n    pub id: u64,\n    pub status: PaymentStatus,\n}\n\n" +
    "pub enum PaymentStatus {\n    Unpaid,\n    Paid(Receipt),\n    Refunded { amount: Money },\n}";
  // MEASURED at HEAD e3792fa: block === BEFORE_BLOCK, types === [Order,
  // PaymentStatus], 9 extractor calls. The delta is entirely APPENDED - the
  // root's def and the enum's own recovered def are untouched, which is what
  // keeps session-v38's render out of this phase.
  assert.ok(walk.block.startsWith(BEFORE_BLOCK), "the pre-phase bytes must still be the PREFIX, unedited");
  assert.equal(
    walk.block.slice(BEFORE_BLOCK.length),
    "\n\npub struct Receipt {\n    pub reference: String,\n}\n\npub struct Money {\n    pub minor_units: i64,\n}",
    "and these are the ONLY new bytes: the two payload defs, in variant order",
  );
  assert.deepEqual([...shape.types.keys()], ["Order", "PaymentStatus", "Receipt", "Money"]);
  assert.equal(f.calls.length, 15, `9 round trips before the phase, 15 after: ${show(f.calls)}`);
});

// ===========================================================================
// A4. THE BOUNDS DEFECT. Contract item 7 says an enum with twenty variants must
// not be able to spend the walk. At TEN it evicts a plain struct collaborator
// from the shape and from the rendered block.
// ===========================================================================

const N_WIDE = 10;
const WIDE = (() => {
  const names = Array.from({ length: N_WIDE }, (_, i) => `Pay${i}`);
  const files = {
    "file:///w/v55p12w/c.rs": "pub fn go(o: &Order) {\n\n}\n",
    "file:///w/v55p12w/o.rs": "pub struct Order {\n    pub st: Status,\n    pub cust: Customer,\n}\n",
    "file:///w/v55p12w/s.rs": "pub enum Status {\n" + names.map((n) => `    V${n}(${n}),`).join("\n") + "\n}\n",
    "file:///w/v55p12w/cu.rs": "pub struct Customer {\n    pub addr: Address,\n}\n",
    "file:///w/v55p12w/a.rs": "pub struct Address {\n    pub city: String,\n}\n",
  };
  const hovers = {
    Order: "pub struct Order {\n    pub st: Status,\n    pub cust: Customer,\n}",
    Status: "pub enum Status {\n" + names.map((n) => `    V${n}( /* … */ ),`).join("\n") + "\n}",
    Customer: "pub struct Customer {\n    pub addr: Address,\n}",
    Address: "pub struct Address {\n    pub city: String,\n}",
  };
  const defs = {
    Order: { uri: "file:///w/v55p12w/o.rs", line: 0, character: 11 },
    Status: { uri: "file:///w/v55p12w/s.rs", line: 0, character: 9 },
    Customer: { uri: "file:///w/v55p12w/cu.rs", line: 0, character: 11 },
    Address: { uri: "file:///w/v55p12w/a.rs", line: 0, character: 11 },
  };
  for (const n of names) {
    const u = `file:///w/v55p12w/${n}.rs`;
    files[u] = `pub struct ${n} {\n    pub v: u64,\n}\n`;
    hovers[n] = `pub struct ${n} {\n    pub v: u64,\n}`;
    defs[n] = { uri: u, line: 0, character: 11 };
  }
  return { files, hovers, defs };
})();

test("A4 [DEFECT, HIGH]: a ten-variant enum evicts a plain struct collaborator from the shape", async () => {
  const f = fixture(WIDE);
  const shape = await resolveCrossFileShape(
    f.extractor,
    { uri: "file:///w/v55p12w/c.rs", line: 0, character: 14 },
    GATHER,
    f.openFile,
  );
  const walk = walkDataShape("Order", toResolveStruct(shape), RENDER);
  // `Order.cust: Customer` and `Customer.addr: Address` is an ordinary
  // struct-field chain that has nothing to do with this phase. MEASURED at HEAD
  // e3792fa with this fixture: types = [Order, Status, Customer, Address],
  // dropped = [], rendered = all four, 15 extractor calls.
  assert.equal(
    shape.types.has("Address"),
    false,
    "MEASURED REGRESSION: `Address` resolved before this phase and does not now - the enum's ten payload " +
      "edges fill N_MAX=12 at depth 2 and starve the struct chain behind a sibling field. It is REPORTED " +
      "(contract item 8 holds), but it is prompt bytes a Rust developer used to get and no longer does.",
  );
  assert.ok(shape.dropped.includes("Address"), `the eviction must at least be named: ${show(shape.dropped)}`);
  assert.equal(
    walk.defs.some((d) => d.name === "Address"),
    false,
    "and it is gone from the rendered block too, not merely from the gather",
  );
  assert.equal(f.calls.length, 39, `15 round trips before the phase, 39 after: ${f.calls.length}`);
});

// The SAME fixture with the wide type spelled as a plain STRUCT instead of an
// enum. Nothing in it touches this phase, so it measures the walk's own
// behaviour, at HEAD and after, identically.
const WIDE_STRUCT = (() => {
  const names = Array.from({ length: N_WIDE }, (_, i) => `Pay${i}`);
  const body = "pub struct Status {\n" + names.map((n, i) => `    pub f${i}: ${n},`).join("\n") + "\n}\n";
  return {
    ...WIDE,
    files: { ...WIDE.files, "file:///w/v55p12w/s.rs": body },
    hovers: { ...WIDE.hovers, Status: body.trimEnd() },
    defs: { ...WIDE.defs, Status: { uri: "file:///w/v55p12w/s.rs", line: 0, character: 11 } },
  };
})();

test("A4b [TRIAGE RULING on A4]: a wide plain STRUCT starves the same collaborator, at the same cost, with no enum anywhere", async () => {
  // A4 is real and it is not this phase's mechanism. Measured here: replace the
  // ten-variant enum with a ten-FIELD struct - no payload edge exists, the phase
  // is not on the path - and the walk produces A4's outcome byte for byte. So
  // N_MAX=12 starvation under a breadth-uncapped FIFO gather is what the Rust
  // walk already does to ANY wide type, and 39 round trips is that bound's own
  // ceiling (3 per emitted type plus 3, at 12 types), not a new worst case this
  // phase raised. What phase 12 changed is that an enum now behaves like a wide
  // struct - which is queue entry Q13's whole request. The fix for the
  // starvation is `gatherBreadth` (A5b), and it is a Rust-wide bound change with
  // its own red, not part of this entry.
  const f = fixture(WIDE_STRUCT);
  const site = { uri: "file:///w/v55p12w/c.rs", line: 0, character: 14 };
  const shape = await resolveCrossFileShape(f.extractor, site, GATHER, f.openFile);
  const walk = walkDataShape("Order", toResolveStruct(shape), RENDER);
  assert.equal(shape.types.has("Address"), false, "the plain struct evicts `Address` from the shape too");
  assert.ok(shape.dropped.includes("Address"), `and reports it the same way: ${show(shape.dropped)}`);
  assert.equal(walk.defs.some((d) => d.name === "Address"), false, "and out of the rendered block the same way");
  assert.equal(f.calls.length, 39, `the same round-trip ceiling with no enum on the path: ${f.calls.length}`);

  // And the eviction is FIRST-COME on the root's field order, not "an enum beats
  // a struct": swap `Order`'s two fields and `Address` survives in both shapes.
  const swapped = fixture({
    ...WIDE,
    files: {
      ...WIDE.files,
      "file:///w/v55p12w/o.rs": "pub struct Order {\n    pub cust: Customer,\n    pub st: Status,\n}\n",
    },
    hovers: { ...WIDE.hovers, Order: "pub struct Order {\n    pub cust: Customer,\n    pub st: Status,\n}" },
  });
  const sShape = await resolveCrossFileShape(swapped.extractor, site, GATHER, swapped.openFile);
  assert.equal(sShape.types.has("Address"), true, "with `cust` declared first the struct chain takes the slots");
  assert.ok(
    walkDataShape("Order", toResolveStruct(sShape), RENDER).defs.some((d) => d.name === "Address"),
    "and it renders",
  );
});

test("A5 [DEFECT, MEDIUM]: the Rust gather has no B_MAX, so six of the ten payloads are unspendable by the render", async () => {
  const f = fixture(WIDE);
  const shape = await resolveCrossFileShape(
    f.extractor,
    { uri: "file:///w/v55p12w/c.rs", line: 0, character: 14 },
    GATHER,
    f.openFile,
  );
  const walk = walkDataShape("Order", toResolveStruct(shape), RENDER);
  // `CrossFileBound.B_MAX` is OPT-IN and only `GO_PREFILL_LANG` sets
  // `gatherBreadth: true` (fnGen.ts:5200, :5248). So the Rust gather resolves
  // every payload candidate, while `walkDataShape` takes at most B_MAX=4
  // distinct local edges PER NODE. The gap is exactly the waste session-v51
  // phase 2 built B_MAX to remove (measured 31 of 117 on the Go corpus); the
  // payload leg reintroduces it on Rust.
  const gathered = [...shape.types.keys()].filter((n) => n.startsWith("Pay"));
  const rendered = walk.defs.map((d) => d.name).filter((n) => n.startsWith("Pay"));
  assert.equal(gathered.length, 9, `payload types the gather paid for: ${show(gathered)}`);
  assert.equal(
    rendered.length,
    3,
    `payload types the render could use: ${show(rendered)}. Each of the other ${gathered.length - rendered.length} ` +
      `bought a definition(), a hover, a file open and a documentSymbol that nothing downstream can spend.`,
  );
  assert.ok(
    walk.dropped.filter((n) => n.startsWith("Pay")).length > 0,
    `the render's own breadth cap must be visibly refusing them: ${show(walk.dropped)}`,
  );
});

// ===========================================================================
// A6. THE ANCHOR'S REACH. `parseEnumVariantPayloads` reads the RECOVERED
// SIGNATURE, which the recovery normalises to one line per variant.
// `variantPayloadCursor` reads the RAW DEFINITION SOURCE, which does not.
// ===========================================================================

const multiline = (statusSrc) => ({
  files: {
    ...BASE_FILES,
    [STATUS]: statusSrc,
  },
  hovers: BASE_HOVERS,
  defs: BASE_DEFS,
});

test("A6 [WAS A DEFECT, RE-CUT at triage]: a multi-line STRUCT variant now anchors its payload", async () => {
  // rustfmt writes exactly this the moment a struct variant carries more than a
  // line's worth of fields (`struct_variant_width`, default 35), and it is the
  // ordinary shape for a wide payload. The review measured it as a hole: the
  // PARSE was fine (the recovery folds the variant to one line and the parser
  // lifts `Money` out of it) and the ANCHOR read the raw source, where the
  // declaration line carries only the brace. Triage ruled DO: `variantPayloadCursor`
  // now scans the variant's own delimiter SPAN instead of its first line. This
  // row was green on the broken behaviour, went red on the fix, and is re-cut
  // here - the session's `KNOWN WRONG` rule.
  const src =
    "#[derive(Debug, Clone)]\npub enum PaymentStatus {\n    Unpaid,\n    Paid(Receipt),\n    Refunded {\n        amount: Money,\n    },\n}\n";
  const f = fixture(multiline(src));
  const shape = await walkBase(f);
  assert.deepEqual(
    parseEnumVariantPayloads(recoverElidedSurface(BASE_HOVERS.PaymentStatus, src)),
    [
      { name: "Paid", typeName: "Receipt" },
      { name: "Refunded", typeName: "amount: Money" },
    ],
    "the parse was never the problem - this row is about the ANCHOR",
  );
  assert.equal(shape.types.has("Money"), true, "the multi-line struct variant's payload is walked, not dropped");
  assert.ok(!shape.dropped.includes("Money"), `and it is not in the drop list: ${show(shape.dropped)}`);
  assert.equal(spent(f, "definition", "Money"), 1, "anchored exactly once, on the line that spells it");
  assert.ok(shape.types.has("Receipt"), "the single-line variant on the same enum still works");
});

test("A6b [RE-CUT at triage]: the same on a multi-line TUPLE variant, and each variant anchors inside its OWN span", async () => {
  const src =
    "#[derive(Debug, Clone)]\npub enum PaymentStatus {\n    Unpaid,\n    Paid(\n        Receipt,\n    ),\n    Refunded { amount: Money },\n}\n";
  const f = fixture(multiline(src));
  const shape = await walkBase(f);
  assert.equal(shape.types.has("Receipt"), true, "the multi-line tuple variant's payload anchors too");
  assert.ok(shape.types.has("Money"), "and the single-line struct variant beside it still resolves");
  // The two variants are in the opposite order to A6, so between them the rows
  // show the scan starting and stopping inside the right variant either way.
  assert.deepEqual(shape.dropped, [], `nothing dropped: ${show(shape.dropped)}`);
});

// ===========================================================================
// WHAT WAS ATTACKED AND FOUND SOUND. These rows exist so a later change cannot
// break them quietly.
// ===========================================================================

test("A7 SOUND: a type reached as BOTH a root field and an enum payload is resolved once, rendered once", async () => {
  const files = {
    "file:///w/v55p12d/c.rs": "pub fn go(o: &Order) {\n\n}\n",
    "file:///w/v55p12d/o.rs": "pub struct Order {\n    pub st: Status,\n    pub slip: Receipt,\n}\n",
    "file:///w/v55p12d/s.rs": "pub enum Status {\n    Paid(Receipt),\n}\n",
    "file:///w/v55p12d/r.rs": "pub struct Receipt {\n    pub reference: String,\n}\n",
  };
  const hovers = {
    Order: "pub struct Order {\n    pub st: Status,\n    pub slip: Receipt,\n}",
    Status: "pub enum Status {\n    Paid( /* … */ ),\n}",
    Receipt: "pub struct Receipt {\n    pub reference: String,\n}",
  };
  const defs = {
    Order: { uri: "file:///w/v55p12d/o.rs", line: 0, character: 11 },
    Status: { uri: "file:///w/v55p12d/s.rs", line: 0, character: 9 },
    Receipt: { uri: "file:///w/v55p12d/r.rs", line: 0, character: 11 },
  };
  const f = fixture({ files, hovers, defs });
  const shape = await resolveCrossFileShape(
    f.extractor,
    { uri: "file:///w/v55p12d/c.rs", line: 0, character: 14 },
    GATHER,
    f.openFile,
  );
  const walk = walkDataShape("Order", toResolveStruct(shape), RENDER);
  assert.equal(spent(f, "definition", "Receipt"), 1, `no double round trip: ${show(f.calls)}`);
  assert.equal(spent(f, "hover", "Receipt"), 1, "and one hover");
  assert.equal(walk.defs.filter((d) => d.name === "Receipt").length, 1, "and one rendered def");
  assert.deepEqual([...shape.types.keys()], ["Order", "Status", "Receipt"]);
});

test("A8 SOUND: the recovery normalises attributes, doc comments and line breaks away before the parser sees them", async () => {
  // The parser cannot read `#[serde(...)]` or a doc comment carrying a comma -
  // ATTACKED and confirmed at the function directly. It never has to: on the
  // Rust no-hooks path the string it is handed is the RECOVERED signature, and
  // `recoverElidedSurface` rebuilds each variant from scrubbed source into the
  // hover's own one-line-per-variant form.
  assert.deepEqual(
    parseEnumVariantPayloads("pub enum E {\n    #[serde(rename = \"p\")]\n    Paid(Receipt),\n}"),
    [],
    "the parser alone cannot read an attributed variant - documented, so the guard below is the load-bearing one",
  );
  const hover = "pub enum E {\n    Paid( /* … */ ),\n    Unpaid,\n}";
  for (const [tag, src] of [
    ["attribute", 'pub enum E {\n    #[serde(rename = "paid")]\n    Paid(Receipt),\n    Unpaid,\n}\n'],
    ["cfg gate", 'pub enum E {\n    #[cfg(feature = "pay")]\n    Paid(Receipt),\n    Unpaid,\n}\n'],
    ["doc comment carrying a comma", "pub enum E {\n    /// Set when money lands, and only then.\n    Paid(Receipt),\n    Unpaid,\n}\n"],
  ]) {
    assert.deepEqual(
      parseEnumVariantPayloads(recoverElidedSurface(hover, src)),
      [{ name: "Paid", typeName: "Receipt" }],
      `${tag}: the recovery must hand the parser a clean one-line variant`,
    );
  }
});

test("A9 SOUND: a REFUSED recovery leaves the elision marker, and the marker names no candidate type", async () => {
  // When the recovery cannot prove the answer it returns the hover byte for
  // byte, so the parser sees `Paid( /* … */ )`. It yields a payload whose text
  // is the marker, and `candidateTypesOf` finds no PascalCase name in it - so
  // the walk asks nobody anything. A junk edge here would buy a definition()
  // round trip on a comment.
  assert.deepEqual(
    parseEnumVariantPayloads("pub enum E {\n    Paid( /* … */ ),\n    Refunded { /* … */ },\n}"),
    [
      { name: "Paid", typeName: "/* … */" },
      { name: "Refunded", typeName: "/* … */" },
    ],
    "the parse is honest about what it saw",
  );
  const f = base({ files: { ...BASE_FILES, [STATUS]: "pub enum PaymentStatus {\n}\n" } });
  const shape = await walkBase(f);
  assert.equal(spent(f, "definition", undefined), 0, "and no cursor is ever anchored on a comment");
  assert.deepEqual(shape.dropped, [], `nothing is dropped for a marker either: ${show(shape.dropped)}`);
});

test("A10 SOUND: nothing but a Rust enum declaration reaches the new parse", async () => {
  for (const [tag, sig] of [
    ["a struct", "pub struct Order {\n    pub id: u64,\n    pub who: Customer,\n}"],
    ["a tuple struct", "pub struct Wrapper(Receipt);"],
    ["a trait", "pub trait Validate {\n    fn check(&self) -> Result<(), Error>;\n}"],
    ["a type alias", "pub type Cache = HashMap<String, Receipt>;"],
    ["a C-like enum", "pub enum Mode {\n    Fast,\n    Slow,\n}"],
    ["a struct whose private-fields comment names an enum", "pub struct Filter {\n    /* private fields: bits, an enum Mode */\n}"],
    ["a TypeScript enum", "enum Color {\n    Red = 0,\n    Green = 1,\n}"],
    ["a Go struct", "type Conn struct {\n    Addr net.Addr\n}"],
    ["a Python enum class", "class Color(Enum):\n    RED = 1"],
    ["a fn signature naming an enum", "pub fn choose(m: Mode) -> Receipt"],
  ]) {
    assert.deepEqual(parseEnumVariantPayloads(sig), [], `${tag} must yield no payload edge`);
  }
  assert.deepEqual(parseEnumVariantPayloads(undefined), [], "and undefined is not a crash");
  assert.deepEqual(parseEnumVariantPayloads(""), [], "nor is empty");
});

test("A11 SOUND: a generic payload is a type PARAMETER, not an edge", async () => {
  const files = {
    ...BASE_FILES,
    [STATUS]: "pub enum PaymentStatus<T, E> {\n    Ok(T),\n    Err(E),\n}\n",
  };
  const hovers = { ...BASE_HOVERS, PaymentStatus: "pub enum PaymentStatus<T, E> {\n    Ok(T),\n    Err(E),\n}" };
  const f = fixture({ files, hovers, defs: { ...BASE_DEFS, PaymentStatus: { uri: STATUS, line: 0, character: 9 } } });
  const shape = await resolveCrossFileShape(f.extractor, ROOT, GATHER, f.openFile);
  assert.deepEqual([...shape.types.keys()], ["Order", "PaymentStatus"]);
  assert.deepEqual(shape.dropped, [], "`skipCandidate` refuses T and E BEFORE the anchor, so they are not drops either");
});

test("A12 SOUND: at the depth frontier the payload is DISCLOSED, not walked", async () => {
  const f = base();
  const shape = await resolveCrossFileShape(f.extractor, ROOT, { D_MAX: 1, N_MAX: 12 }, f.openFile);
  assert.deepEqual([...shape.types.keys()], ["Order", "PaymentStatus"]);
  assert.deepEqual(shape.frontier, ["Receipt", "Money"], "the bound reports them rather than reaching them");
  assert.equal(spent(f, "definition", "Receipt"), 0, "and buys no round trip doing it");
  // MEASURED at HEAD e3792fa: `shape.frontier` was undefined here - the enum
  // disclosed nothing at all, which is the gap contract item 8 says was bigger
  // than the contract stated.
});

test("A13 SOUND: the four hooked languages never compute a payload, and their walk is unmoved", async () => {
  // The guard is `hooks === undefined`, and `shapeHooksFor` returns hooks for
  // every id `fimLanguages.ts:50` serves except rust. This row proves the
  // property the guard is FOR: no hooked walk carries `variantPayloads`, and
  // `toResolveStruct` therefore adds no edge for one.
  for (const lang of ["typescript", "typescriptreact", "javascript", "csharp", "python", "go"]) {
    const hooks = shapeHooksFor(lang);
    assert.notEqual(hooks, undefined, `${lang} must have hooks, or it takes the Rust path`);
    const f = base();
    const shape = await resolveCrossFileShape(f.extractor, ROOT, GATHER, f.openFile, hooks);
    for (const t of shape.types.values()) {
      assert.equal(t.variantPayloads, undefined, `${lang}: no type may carry variantPayloads`);
      const res = toResolveStruct(shape, hooks)(t.name);
      assert.deepEqual(
        res.fields.map((x) => x.typeName),
        (shape.types.get(t.name).fields ?? []).flatMap((x) => res.fields.filter((y) => y.name === x.name).map((y) => y.typeName)),
        `${lang}: every render edge must come from \`fields\` and nothing else`,
      );
    }
  }
  assert.equal(shapeHooksFor("rust"), undefined, "and rust is the one no-hooks language the guard is about");
});

test("A5b: `gatherBreadth` would recover the wasted round trips and the evicted type, at zero cost in rendered bytes", async () => {
  // NOT a fix, a measurement, so the session can price the remedy rather than
  // guess it. The ONLY change is passing the render's own B_MAX into the gather
  // bound - what `RUST_PREFILL_LANG.gatherBreadth = true` would do through
  // `prefillGatherBound` (fnGen.ts:5248), exactly as Go already does.
  const site = { uri: "file:///w/v55p12w/c.rs", line: 0, character: 14 };
  const capped = fixture(WIDE);
  const cShape = await resolveCrossFileShape(capped.extractor, site, { ...GATHER, B_MAX: 4 }, capped.openFile);
  const cWalk = walkDataShape("Order", toResolveStruct(cShape), RENDER);

  const uncapped = fixture(WIDE);
  const uShape = await resolveCrossFileShape(uncapped.extractor, site, GATHER, uncapped.openFile);
  const uWalk = walkDataShape("Order", toResolveStruct(uShape), RENDER);

  assert.equal(cWalk.block, uWalk.block, "the rendered block is IDENTICAL, so the cap costs the model nothing");
  assert.ok(
    capped.calls.length < uncapped.calls.length,
    `and it costs the language server less: ${capped.calls.length} round trips against ${uncapped.calls.length}`,
  );
  assert.equal(cShape.types.has("Address"), true, "the evicted struct is back IN THE SHAPE under the cap");
  // What it does NOT fix, and this is the part that needs a session ruling:
  // `Address` still does not RENDER, because the render's own N_MAX=6 is now
  // spent on payload defs. The rendered-byte loss in A4 is a consequence of the
  // amendment's ruling itself, not of how the ruling was implemented.
  assert.equal(
    cWalk.defs.some((d) => d.name === "Address"),
    false,
    "the render N_MAX is still spent on payloads - A4's byte loss survives the cap",
  );
});
