// BLIND ORACLE for session-v55 phase 12 (Q13): the field leg is dark on every
// Rust enum. Bound to the phase-12 contract and to the exported
// facade of `src/core/crossFileShape.ts`. Written before the fix exists.
//
// WHAT WAS READ WHILE WRITING THIS FILE, said plainly, because the discipline is
// worth nothing unspoken. The EXPORTED DECLARATIONS and doc comments of
// `resolveCrossFileShape`, `CrossFileShape`, `CrossFileBound`, `DerivedType`,
// `CrossFileShapeHooks`, `shapeHooksFor`, `renderDerivedDef`, `toResolveStruct`
// and `SurfaceExtractor` - the parameter lists and the shapes, so the walk could
// be called at all. NOT read: the body of `resolveCrossFileShape`, the body of
// `parseStructHoverFields`, the body of `fieldTypeCursor`, or anything in
// `rustHoverRecovery.ts` past its exported names. Every number and every byte
// pinned below was MEASURED by driving the facade, never copied out of a source
// line.
//
// THE DEFECT, in contract terms. The walk builds its type graph from FIELD
// EDGES. On the Rust no-hooks path those edges come from a `name: Type` parse of
// the type's brace body, and no enum variant writes one: `Paid(Receipt)` has no
// colon and its payload sits inside its own parentheses. So an enum contributes
// no edges, its payload types are never ENQUEUED, and the graph stops at one hop
// - in the exact place data-oriented Rust puts its structure. The RENDER half is
// already shipped (session-v38's `recoverElidedSurface` restores the elided
// payload TEXT into the signature) and this phase must not move it.
//
// Run: SKIP_LIVE=1 node --test test/blind-v55-p12-enum-payload.test.cjs
// Nothing here needs a live language server; SKIP_LIVE changes nothing.
//
// ---------------------------------------------------------------------------
// MEASURED STATE OF EVERY ROW BEFORE ANY FIX EXISTS (working tree at 21df62a)
// ---------------------------------------------------------------------------
//
//   GUARD            GREEN   the bundle builds and the fixture can produce the case
//   P12-1a  RED      the third-file payload type `Receipt` is not in `types`
//   P12-1b  RED      ... so it carries no surface of its own
//   P12-1c  RED      ... and the walk never asked the server about it
//   P12-1d  GREEN    the same third-file geometry behind a STRUCT resolves today
//   P12-2   RED      the struct-variant payload `Money` is not enqueued either
//   P12-3a  GREEN    an enum's `DerivedType.fields` is []
//   P12-3b  GREEN    a struct's `fields` are its own, unchanged
//   P12-3c  RE-CUT   `toResolveStruct` yields the enum ITS PAYLOAD EDGES  <-- read P12-3c
//   P12-4a  GREEN    the enum's recovered `signature` bytes
//   P12-4b  GREEN    `renderDerivedDef` of the enum, byte for byte
//   P12-4c  GREEN    `renderDerivedDef` of the root struct, byte for byte
//   P12-5a  GREEN    each hooked language's `parseFields` is its own function
//   P12-5b  GREEN    ... and each returns [] for the Rust enum signature
//   P12-5c  GREEN    C#/TS/Python/Go walk the enum lever and enqueue nothing
//   P12-5d  GREEN    C# and Python's own field legs ARE alive (5c is not vacuous)
//   P12-6a  RED      at the depth frontier a payload name is not DISCLOSED
//   P12-6b  GREEN    the struct frontier control
//   P12-6c  GREEN    N_MAX still bounds a twenty-variant enum (vacuous today)
//   P12-6d  GREEN    B_MAX still bounds the payload fan-out (vacuous today)
//   P12-6e  RED      a payload a cap refused is named nowhere
//   P12-6f  GREEN    no payload buys more than one definition round trip
//   P12-7   RED      an unanchorable payload is silent, not `dropped`
//   P12-7b  GREEN    the unanchorable FIELD control: it does land in `dropped`
//   P12-8a  RED      `enumPayloadsFromSource` is still cited in src/
//   P12-8b  GREEN    `recoverElidedSurface` exists and is exported
//
// P12-8a is red BY DESIGN: the contract's own "Same touch" section says the cite
// at `crossFileShape.ts:91` is wrong today and this phase corrects it.
//
// ---------------------------------------------------------------------------
// FIXTURE FIDELITY, said in full, because this project has paid for a fake shape
// before ("fixture fidelity is not cosmetic").
// ---------------------------------------------------------------------------
//
// 1. THE ENUM HOVER IS THE ELIDED FORM, not a hand-spelled one. rust-analyzer
//    does NOT print an enum's tuple or struct payloads; it prints
//    `Constrained( /* … */ )` and `Leader { /* … */ }`, and no RA setting
//    recovers them. That form is MEASURED - rcgen `BasicConstraints` and the
//    `NodeStatus` capture - and is quoted verbatim in
//    test/blind-v39-p1-hover-recovery.test.cjs, from which
//    the shape here is copied. So the fixture hands the walk the elided hover
//    PLUS the definition file's source and lets the PRODUCT'S OWN recovery
//    restore the payloads. A fixture that spelled `Paid(Receipt)` in the hover
//    would have skipped the one mechanism this phase sits downstream of.
//
//    Consequence worth stating: if rust-analyzer ever stops eliding, the
//    signature arrives spelled and the recovery is a no-op. Row P12-4a would
//    then pin the same bytes by a different route, and nothing else moves - the
//    parse the defect lives in reads the signature either way.
//
// 2. THE THREE FILES ARE THREE FILES. `Order` in order.rs, `PaymentStatus` in
//    status.rs, `Receipt` in receipt.rs, `Money` in money.rs. The root cursor is
//    in a fifth, consumer.rs. Nothing about `Receipt` is reachable from
//    `Order`'s own declaration text, so a one-hop walk provably cannot reach it
//    and P12-1a cannot pass by accident.
//
// 3. THE EXTRACTOR ANSWERS BY THE WORD UNDER THE CURSOR, which is how a real
//    server behaves: the walk hands it a POSITION, not a name. So "the walk
//    never asked" is a claim about the walk. The GUARD row proves the fixture
//    answers `definition` and `hoverSurface` at the cursor that sits on
//    `Receipt` inside the variant line, so a red below is the product's, not the
//    instrument's ("instrument must produce the case").
//
// 4. WHAT IS SYNTHETIC AND SAYS SO. The type names (Order/PaymentStatus/
//    Receipt/Money) are invented; the SHAPES are the corpus's. `#[derive(Debug,
//    Clone)]` above the enum and a doc comment on one variant are there because
//    real declarations carry both and the recovery has to scrub them.
//
// ---------------------------------------------------------------------------
// A CONTRADICTION IN THE CONTRACT, and it is the reason to read P12-3c.
// ---------------------------------------------------------------------------
//
// The contract asks for two things that cannot both hold at the Rust render
// seam:
//
//   item 4/the trap: `DerivedType.fields` must not move, so a payload is a WALK
//     EDGE computed beside `fields` and "consumed only by the enqueue loop and
//     the D_MAX frontier loop".
//   the Falsification: the payload type "reaches the prompt with its own
//     surface, and did not before".
//
// MEASURED at the facade: `toResolveStruct` - the exported adapter the Rust
// data-shape block is rendered through - builds its walkable edge list ONLY
// from `t.fields`. So a payload kept out of `fields`, and kept out of
// `toResolveStruct`, is resolved into `shape.types` and then rendered nowhere:
// the Rust block emits the root's own def plus each def its FIELD edges reach,
// and the API-surface block carries the ROOT type's methods only. Enqueuing
// without touching a renderer therefore buys extractor round trips and zero
// prompt bytes.
//
// This file did NOT resolve that. It pinned today's answer (P12-3c: no edge) so
// the implementer had to make the call out loud, exactly as the contract's trap
// section demands for `fields`.
//
// THE CALL WAS MADE. `contract-phase12.md`'s "Amendment, after the blind oracle"
// rules that the payload IS a render edge, carried on its own optional property
// so `DerivedType.fields` still does not move. P12-3c went red on that fix, that
// red was the declaration, and the row below is its RE-CUT - written by the
// phase-12 adversarial review, applied here at triage, never by the implementer.
// The same text stands as row A1 of `adversarial-v55-p12-enum-payload.test.cjs`.
//
// ---------------------------------------------------------------------------
// AN AMBIGUITY IN THE CONTRACT that P12-2 resolves one way on purpose.
// ---------------------------------------------------------------------------
//
// Contract item 3 says struct-variant payloads (`Refunded { amount: Money }`)
// must be "decided explicitly" and made "a row either way" - and then never
// says which way. It is not derivable from the rest of the document. P12-2
// asserts they DO enqueue, because item 1's stated reason is that data-oriented
// Rust puts its structure in enums, and a struct variant is structure by the
// same argument; and because `Refunded { amount: Money }` is the shape the
// existing `name: Type` parser looks closest to handling, so the half-done
// outcome the contract fears is precisely "tuple yes, struct no". If the
// session rules the other way, P12-2 is the row that must be flipped, with the
// ruling written down.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v55-p12-enum-payload",
  `export {
  resolveCrossFileShape,
  shapeHooksFor,
  renderDerivedDef,
  toResolveStruct,
  parseStructHoverFields,
  recoverElidedSurface,
} from "../src/core/crossFileShape";\n`,
);
const {
  resolveCrossFileShape,
  shapeHooksFor,
  renderDerivedDef,
  toResolveStruct,
  parseStructHoverFields,
  recoverElidedSurface,
} = mod;
test.after(cleanup);

const show = (v) => JSON.stringify(v);
const keys = (shape) => [...shape.types.keys()];
const dump = (shape) =>
  `\n  types:    ${show(keys(shape))}\n  dropped:  ${show(shape.dropped)}\n  frontier: ${show(shape.frontier)}`;

// ===========================================================================
// THE HARNESS. A many-file fake extractor that answers by the WORD UNDER THE
// CURSOR, so every answer is positional the way a language server's is, and
// every call is recorded so a row can say a round trip was never spent.
//
// Copied in shape from test/blind-v30-p6-genericparams.test.cjs, which drives
// the same facade. Widened here to MORE THAN TWO FILES, which is the whole
// point of the falsification fixture.
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

// `files`  uri -> text.  `hovers` name -> hover signature (the ELIDED form for
// a Rust enum; the product restores it).  `defs` name -> { uri, line,
// character }, i.e. where a definition provider would land.  `members` name ->
// CompletionMember[].  `unreadable` uris `openFile` refuses, the cross-crate
// hover-only case.
function fixture({ files, hovers, defs, members = {}, unreadable = new Set() }) {
  const calls = [];
  const textOf = (uri) => files[uri];
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
      const d = defs[word];
      return {
        uri: d.uri,
        range: { startLine: d.line, startCharacter: d.character, endLine: d.line, endCharacter: d.character + word.length },
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
    openFile: async (uri) => (unreadable.has(uri) ? undefined : textOf(uri)),
    // A cursor on the first occurrence of `name` on `line` of `uri`. Used for
    // the root anchor and, in the GUARD, to ask the fixture the same question
    // the walk would ask at a variant line.
    cursorAt(uri, line, name) {
      const text = (files[uri] ?? "").split("\n")[line] ?? "";
      const at = text.indexOf(name);
      assert.ok(at >= 0, `fixture bug: ${uri} line ${line} does not contain ${show(name)}: ${show(text)}`);
      return { uri, line, character: at };
    },
    spent(name) {
      return calls.filter((c) => c.endsWith(`(${name})`)).length;
    },
    spentOn(op, name) {
      return calls.filter((c) => c === `${op}(${name})`).length;
    },
  };
}

// ===========================================================================
// THE FALSIFICATION FIXTURE. Five files. Root type -> enum -> payload, each in
// its own file, so a one-hop walk provably cannot reach the payload.
// ===========================================================================

const CONSUMER = "file:///w/v55p12/consumer.rs";
const ORDER = "file:///w/v55p12/order.rs";
const STATUS = "file:///w/v55p12/status.rs";
const RECEIPT = "file:///w/v55p12/receipt.rs";
const MONEY = "file:///w/v55p12/money.rs";

const CONSUMER_LINES = ["pub fn settle(order: &Order) {", "", "}", ""];
const ORDER_LINES = ["pub struct Order {", "    pub id: u64,", "    pub status: PaymentStatus,", "}", ""];
// The enum's own declaration, with the two things a real one carries and the
// recovery has to scrub: an attribute above it and a doc comment inside it.
const STATUS_LINES = [
  "#[derive(Debug, Clone)]",
  "pub enum PaymentStatus {",
  "    /// Nothing has been received against this order yet.",
  "    Unpaid,",
  "    Paid(Receipt),",
  "    Refunded { amount: Money },",
  "}",
  "",
];
const RECEIPT_LINES = ["pub struct Receipt {", "    pub reference: String,", "    pub cents: u64,", "}", ""];
const MONEY_LINES = ["pub struct Money {", "    pub minor_units: i64,", "}", ""];

// rust-analyzer's real enum hover: the payloads are ELIDED. See fidelity note 1.
const HOVER_PAYMENT_STATUS = [
  "pub enum PaymentStatus {",
  "    Unpaid,",
  "    Paid( /* … */ ),",
  "    Refunded { /* … */ },",
  "}",
].join("\n");

const RUST_FILES = {
  [CONSUMER]: CONSUMER_LINES.join("\n"),
  [ORDER]: ORDER_LINES.join("\n"),
  [STATUS]: STATUS_LINES.join("\n"),
  [RECEIPT]: RECEIPT_LINES.join("\n"),
  [MONEY]: MONEY_LINES.join("\n"),
};

const RUST_HOVERS = {
  Order: ["pub struct Order {", "    pub id: u64,", "    pub status: PaymentStatus,", "}"].join("\n"),
  PaymentStatus: HOVER_PAYMENT_STATUS,
  Receipt: ["pub struct Receipt {", "    pub reference: String,", "    pub cents: u64,", "}"].join("\n"),
  Money: ["pub struct Money {", "    pub minor_units: i64,", "}"].join("\n"),
};

const RUST_DEFS = {
  Order: { uri: ORDER, line: 0, character: ORDER_LINES[0].indexOf("Order") },
  PaymentStatus: { uri: STATUS, line: 1, character: STATUS_LINES[1].indexOf("PaymentStatus") },
  Receipt: { uri: RECEIPT, line: 0, character: RECEIPT_LINES[0].indexOf("Receipt") },
  Money: { uri: MONEY, line: 0, character: MONEY_LINES[0].indexOf("Money") },
};

// A method on the payload, so "carries its own surface" can mean fields AND
// methods rather than a bare key in a map.
const RUST_MEMBERS = {
  Receipt: [{ name: "reference_text", kind: "method", signature: "reference_text(&self) -> &str" }],
  Money: [{ name: "as_major", kind: "method", signature: "as_major(&self) -> f64" }],
};

const rustFixture = (over = {}) =>
  fixture({ files: RUST_FILES, hovers: RUST_HOVERS, defs: RUST_DEFS, members: RUST_MEMBERS, ...over });

const rootSite = () => ({ uri: CONSUMER, line: 0, character: CONSUMER_LINES[0].indexOf("Order") });

// D_MAX 3 is two hops past the enum, so nothing below is stopped by depth
// unless a row means it to be. N_MAX 12 is far above the fixture's five names.
const OPEN_BOUND = { D_MAX: 3, N_MAX: 12 };

const walkRust = async (f, bound = OPEN_BOUND) =>
  resolveCrossFileShape(f.extractor, rootSite(), bound, f.openFile);

// ===========================================================================
// GUARD. Nothing below means anything if the bundle did not build, or if the
// FIXTURE cannot produce the case. A zero from a rig that cannot make the case
// fire is a fact about the rig.
// ===========================================================================

test("GUARD: the facade is exported, and the fixture can produce the case it is about to measure", async () => {
  for (const [name, fn] of Object.entries({
    resolveCrossFileShape,
    shapeHooksFor,
    renderDerivedDef,
    toResolveStruct,
    parseStructHoverFields,
    recoverElidedSurface,
  })) {
    assert.equal(typeof fn, "function", `${name} must be exported from src/core/crossFileShape`);
  }

  // The enum's payload sits at status.rs line 4, `    Paid(Receipt),`. If the
  // walk ever anchors a cursor on that `Receipt` token, THIS is what the
  // fixture answers. Both must be real, or P12-1a would be red for the
  // instrument's reason rather than the product's.
  const f = rustFixture();
  const variantCursor = f.cursorAt(STATUS, 4, "Receipt");
  const def = await f.extractor.definition(variantCursor);
  assert.ok(def, "the fixture must resolve `Receipt` at the variant line, or the red rows below prove nothing");
  assert.equal(def.uri, RECEIPT, `and it must resolve to the THIRD file; got ${show(def.uri)}`);
  const hov = await f.extractor.hoverSurface(f.cursorAt(RECEIPT, 0, "Receipt"));
  assert.ok(hov && hov.signature.includes("reference"), "the fixture must hover `Receipt` with a real body");

  // And the same for the struct variant's payload at line 5.
  const moneyDef = await f.extractor.definition(f.cursorAt(STATUS, 5, "Money"));
  assert.ok(moneyDef && moneyDef.uri === MONEY, "the fixture must resolve `Money` at the struct-variant line");

  // The three files really are three files.
  assert.notEqual(RUST_DEFS.Order.uri, RUST_DEFS.PaymentStatus.uri, "root and enum must not share a file");
  assert.notEqual(RUST_DEFS.PaymentStatus.uri, RUST_DEFS.Receipt.uri, "enum and payload must not share a file");
  assert.equal(RUST_FILES[ORDER].includes("Receipt"), false, "order.rs must not name Receipt: a one-hop walk must be unable to reach it");
});

// ===========================================================================
// P12-1. THE FALSIFICATION. Contract item 1, and the whole of what is left.
// RED before the fix.
// ===========================================================================

test("P12-1a: a Rust enum's tuple-variant payload type is resolved, from a THIRD file", async () => {
  const f = rustFixture();
  const shape = await walkRust(f);
  assert.ok(
    shape.types.has("Receipt"),
    `\`PaymentStatus::Paid(Receipt)\` names \`Receipt\` and the walk must enqueue it. It is declared in ` +
      `receipt.rs, which order.rs never mentions, so one hop cannot reach it and nothing but the enum ` +
      `edge can put it here.${dump(shape)}`,
  );
});

test("P12-1b: and it carries its OWN surface, not just a name in the map", async () => {
  const f = rustFixture();
  const shape = await walkRust(f);
  const receipt = shape.types.get("Receipt");
  assert.ok(receipt, `precondition: P12-1a.${dump(shape)}`);
  assert.deepEqual(
    receipt.fields,
    [
      { name: "reference", typeName: "String" },
      { name: "cents", typeName: "u64" },
    ],
    "the payload's own fields must be derived, the same as any other collaborator's",
  );
  assert.deepEqual(receipt.methods, ["reference_text(&self) -> &str"], "and its own methods");
  assert.equal(receipt.defUri, RECEIPT, "and it must know which file it came from, for the import hint");
});

test("P12-1c: and the walk got there by ASKING, at a cursor on the variant line", async () => {
  const f = rustFixture();
  await walkRust(f);
  assert.ok(
    f.spentOn("definition", "Receipt") > 0,
    `the payload edge needs an anchor: the walk must put a cursor on the \`Receipt\` token inside ` +
      `\`Paid(Receipt),\` and ask the server. "Parsed but never anchored" is not a fix. Calls: ${show(f.calls)}`,
  );
});

// The control that makes P12-1a a statement about ENUMS. Identical geometry -
// three files, two hops - with a STRUCT where the enum was. GREEN today.
test("P12-1d CONTROL: the same third-file geometry behind a STRUCT resolves today", async () => {
  const A = "file:///w/v55p12c/consumer.rs";
  const B = "file:///w/v55p12c/order.rs";
  const C = "file:///w/v55p12c/detail.rs";
  const D = "file:///w/v55p12c/receipt.rs";
  const aL = ["pub fn settle(order: &Order) {", "", "}", ""];
  const bL = ["pub struct Order {", "    pub detail: PaymentDetail,", "}", ""];
  const cL = ["pub struct PaymentDetail {", "    pub slip: Receipt,", "}", ""];
  const dL = ["pub struct Receipt {", "    pub reference: String,", "}", ""];
  const f = fixture({
    files: { [A]: aL.join("\n"), [B]: bL.join("\n"), [C]: cL.join("\n"), [D]: dL.join("\n") },
    hovers: {
      Order: "pub struct Order {\n    pub detail: PaymentDetail,\n}",
      PaymentDetail: "pub struct PaymentDetail {\n    pub slip: Receipt,\n}",
      Receipt: "pub struct Receipt {\n    pub reference: String,\n}",
    },
    defs: {
      Order: { uri: B, line: 0, character: bL[0].indexOf("Order") },
      PaymentDetail: { uri: C, line: 0, character: cL[0].indexOf("PaymentDetail") },
      Receipt: { uri: D, line: 0, character: dL[0].indexOf("Receipt") },
    },
  });
  const shape = await resolveCrossFileShape(
    f.extractor,
    { uri: A, line: 0, character: aL[0].indexOf("Order") },
    OPEN_BOUND,
    f.openFile,
  );
  assert.deepEqual(
    keys(shape),
    ["Order", "PaymentDetail", "Receipt"],
    `the walk crosses two files and reaches a third-file type when the middle node is a STRUCT. If this ` +
      `row is red the fixture geometry is broken and every red above is meaningless.${dump(shape)}`,
  );
});

// ===========================================================================
// P12-2. STRUCT-VARIANT PAYLOADS. Contract item 3, which demands an explicit
// answer and does not give one. This file answers "they enqueue too" and says
// so in the header. RED before the fix.
// ===========================================================================

test("P12-2: a struct-variant payload type enqueues as well [CONTRACT ITEM 3 - see header]", async () => {
  const f = rustFixture();
  const shape = await walkRust(f);
  assert.ok(
    shape.types.has("Money"),
    `\`Refunded { amount: Money }\` is structure by exactly the argument item 1 makes for \`Paid(Receipt)\`, ` +
      `and it is the shape the existing \`name: Type\` parser looks closest to handling - so "tuple yes, ` +
      `struct no" is the half-done outcome contract item 3 exists to prevent. IF THE SESSION RULES THE ` +
      `OTHER WAY, flip this row and write the ruling down; do not delete it.${dump(shape)}`,
  );
  const money = shape.types.get("Money");
  if (money) {
    assert.deepEqual(money.fields, [{ name: "minor_units", typeName: "i64" }], "and it carries its own surface");
  }
});

// ===========================================================================
// P12-3. `DerivedType.fields` DOES NOT MOVE. Contract item 4 and its trap: a
// payload is a WALK EDGE, not a field, because ~20 sites read `fields` and at
// least two of them are shape-path admission gates. GREEN today, and a fix that
// stuffs payloads into `fields` has to declare itself here.
// ===========================================================================

test("P12-3a: an enum's `fields` is empty, and stays empty", async () => {
  const f = rustFixture();
  const shape = await walkRust(f);
  const status = shape.types.get("PaymentStatus");
  assert.ok(status, `precondition: the enum itself must resolve.${dump(shape)}`);
  assert.deepEqual(
    status.fields,
    [],
    `\`DerivedType.fields\` is read at roughly twenty sites, including the two shape-path admission gates ` +
      `(\`derived.methods.length > 0 || derived.fields.length > 0 || admitsEmptyShape\`). An enum that ` +
      `starts carrying entries reaches the prompt through a DIFFERENT DOOR than session-v38's enum gate, ` +
      `and every shed/narrowing set changes with it. If the fix means to do that, it must declare it and ` +
      `pin every site the contract lists - one row each.`,
  );
});

test("P12-3b: a struct's `fields` are its own, unchanged", async () => {
  const f = rustFixture();
  const shape = await walkRust(f);
  assert.deepEqual(
    shape.types.get("Order").fields,
    [
      { name: "id", typeName: "u64" },
      { name: "status", typeName: "PaymentStatus" },
    ],
    "the root struct's field parse must not move a byte: this phase is about an edge an enum does not have",
  );
});

test("P12-3c [RE-CUT by the phase-12 review, applied at triage]: the enum's variant payloads ARE walkable render edges, and `fields` still does not move", async () => {
  const f = rustFixture();
  const shape = await walkRust(f);
  const status = toResolveStruct(shape)("PaymentStatus");
  assert.ok(status, `precondition: the enum must adapt at all.${dump(shape)}`);
  // THE RULING (contract-phase12.md, "Amendment, after the blind oracle"). This
  // adapter is the ONE seam `walkDataShape` takes its walkable edges from, so a
  // payload kept out of it is resolved and rendered nowhere: round trips bought,
  // zero prompt bytes delivered. MEASURED: 9 extractor calls before the phase,
  // 15 after, with a byte-identical block. `name` is the VARIANT name, not a
  // field name, and it is pinned so a later consumer that reads
  // `StructResolution.fields[].name` expecting a field finds this row first.
  assert.deepEqual(
    status.fields,
    [
      { name: "Paid", typeName: "Receipt", isLocal: true },
      { name: "Refunded", typeName: "Money", isLocal: true },
    ],
    "the payload must reach the render's edge list, or the phase buys round trips and no prompt bytes",
  );
  // The other half of the amendment, deliberately in the same row: the ruling is
  // "a render edge", NOT "a field". ~20 sites read `DerivedType.fields`, two of
  // them the shape-path admission gates at fnGen.ts:1812 and fnGen.ts:3654.
  assert.deepEqual(
    shape.types.get("PaymentStatus").fields,
    [],
    "`DerivedType.fields` must stay empty for an enum: the payload rides its own optional property",
  );
});

// ===========================================================================
// P12-4. THE RENDERED BYTES DO NOT MOVE. Contract item 5. GREEN today, pinned
// byte for byte, MEASURED from the facade before any fix existed.
// ===========================================================================

const ENUM_SIGNATURE_BYTES = [
  "pub enum PaymentStatus {",
  "    Unpaid,",
  "    Paid(Receipt),",
  "    Refunded { amount: Money },",
  "}",
].join("\n");

const ORDER_SIGNATURE_BYTES = ["pub struct Order {", "    pub id: u64,", "    pub status: PaymentStatus,", "}"].join("\n");

test("P12-4a: the enum's recovered signature is byte-identical (session-v38's render, untouched)", async () => {
  const f = rustFixture();
  const shape = await walkRust(f);
  assert.equal(
    shape.types.get("PaymentStatus").signature,
    ENUM_SIGNATURE_BYTES,
    "rust-analyzer elided both payloads and `recoverElidedSurface` restored them from status.rs. That is " +
      "session-v38's work and this phase must not move one byte of it",
  );
});

test("P12-4b: `renderDerivedDef` of the enum is byte-identical", async () => {
  const f = rustFixture();
  const shape = await walkRust(f);
  assert.equal(renderDerivedDef(shape.types.get("PaymentStatus")), ENUM_SIGNATURE_BYTES);
});

test("P12-4c: `renderDerivedDef` of the root struct is byte-identical", async () => {
  const f = rustFixture();
  const shape = await walkRust(f);
  assert.equal(renderDerivedDef(shape.types.get("Order")), ORDER_SIGNATURE_BYTES);
});

// The recovery, driven directly at the same seam the walk drives it, so a
// regression in it is told apart from a regression in the walk.
test("P12-4d: `recoverElidedSurface` on this exact hover and source is byte-identical", () => {
  assert.equal(recoverElidedSurface(HOVER_PAYMENT_STATUS, STATUS_LINES.join("\n")), ENUM_SIGNATURE_BYTES);
});

// ===========================================================================
// P12-5. THE FOUR HOOKED LANGUAGES ARE UNTOUCHED. Contract item 6: this is the
// Rust no-hooks path only. GREEN today and must stay green.
//
// THE LEVER, copied from test/blind-v38-p1-enum-render.test.cjs section D: feed
// each hooked language the EXACT signature that will admit under Rust. That is
// the only input that tells a Rust-gated fix from a language-blind one.
// ===========================================================================

const HOOKED = ["typescript", "csharp", "python", "go"];

test("P12-5a: each hooked language brings its OWN field parser, not the Rust default", () => {
  assert.equal(shapeHooksFor("rust"), undefined, "rust has no hooks, so the walk's defaults are its behaviour");
  for (const id of HOOKED) {
    const hooks = shapeHooksFor(id);
    assert.equal(typeof hooks, "object", `${id} must bring hooks`);
    assert.equal(typeof hooks.parseFields, "function", `${id} must have a real field parser`);
    assert.notEqual(
      hooks.parseFields,
      parseStructHoverFields,
      `${id} must not share the Rust default parser: a change to it would then be a change to ${id}`,
    );
    assert.equal(typeof hooks.fieldTypeCursor, "function", `${id} must have its own field anchor too`);
  }
});

test("P12-5b: and each returns [] for a Rust enum signature, before and after", () => {
  for (const id of HOOKED) {
    assert.deepEqual(
      shapeHooksFor(id).parseFields(ENUM_SIGNATURE_BYTES, [], ENUM_SIGNATURE_BYTES.split("\n")),
      [],
      `${id} must derive nothing from a Rust enum declaration. This is the lever: the exact bytes that ` +
        `will produce payload edges under Rust must produce none here`,
    );
  }
});

// The same lever through the WHOLE walk, not just the parser, because a fix can
// land in the enqueue loop rather than in `parseFields`.
for (const lang of HOOKED) {
  test(`P12-5c [${lang}]: the whole walk over that enum enqueues nothing new`, async () => {
    const ext = { typescript: "ts", csharp: "cs", python: "py", go: "go" }[lang];
    const C = `file:///w/v55p12h/consumer.${ext}`;
    const A = `file:///w/v55p12h/status.${ext}`;
    const B = `file:///w/v55p12h/payloads.${ext}`;
    const cL = ["fn use_it(s: PaymentStatus) {", "", "}", ""];
    const aL = ENUM_SIGNATURE_BYTES.split("\n").concat([""]);
    const bL = ["pub struct Receipt { pub v: u64 }", "pub struct Money { pub v: i64 }", ""];
    const f = fixture({
      files: { [C]: cL.join("\n"), [A]: aL.join("\n"), [B]: bL.join("\n") },
      hovers: {
        PaymentStatus: ENUM_SIGNATURE_BYTES,
        Receipt: "pub struct Receipt { pub v: u64 }",
        Money: "pub struct Money { pub v: i64 }",
      },
      defs: {
        PaymentStatus: { uri: A, line: 0, character: aL[0].indexOf("PaymentStatus") },
        Receipt: { uri: B, line: 0, character: bL[0].indexOf("Receipt") },
        Money: { uri: B, line: 1, character: bL[1].indexOf("Money") },
      },
    });
    const shape = await resolveCrossFileShape(
      f.extractor,
      { uri: C, line: 0, character: cL[0].indexOf("PaymentStatus") },
      OPEN_BOUND,
      f.openFile,
      shapeHooksFor(lang),
    );
    assert.deepEqual(
      keys(shape),
      ["PaymentStatus"],
      `${lang} must not gain a payload edge. Contract item 6: byte-identical outputs for all four.${dump(shape)}`,
    );
    assert.deepEqual(shape.types.get("PaymentStatus").fields, [], `${lang}'s \`fields\` must not move either`);
    assert.equal(f.spent("Receipt"), 0, `${lang} must not spend a round trip on the payload; calls ${show(f.calls)}`);
  });
}

// P12-5c would pass on a language whose field leg was dead. These two prove it
// is not: C# and Python DO resolve a cross-file collaborator off their own
// member-derived fields, so "nothing was enqueued" is a fact about the enum.
test("P12-5d CONTROL: C#'s and Python's own field legs are alive", async () => {
  {
    const C = "file:///w/v55p12l/Consumer.cs";
    const A = "file:///w/v55p12l/Order.cs";
    const B = "file:///w/v55p12l/Receipt.cs";
    const cL = ["void Settle(Order o) {", "", "}", ""];
    const aL = ["namespace Contoso.Billing;", "public sealed class Order", "{", "    public Receipt Slip { get; set; }", "}", ""];
    const bL = ["namespace Contoso.Billing;", "public sealed class Receipt", "{", "    public long Cents { get; set; }", "}", ""];
    const f = fixture({
      files: { [C]: cL.join("\n"), [A]: aL.join("\n"), [B]: bL.join("\n") },
      hovers: { Order: "class Contoso.Billing.Order", Receipt: "class Contoso.Billing.Receipt" },
      defs: {
        Order: { uri: A, line: 1, character: aL[1].indexOf("Order") },
        Receipt: { uri: B, line: 1, character: bL[1].indexOf("Receipt") },
      },
      members: {
        Order: [{ name: "Slip", kind: "field", signature: "Slip : Receipt" }],
        Receipt: [{ name: "Cents", kind: "field", signature: "Cents : long" }],
      },
    });
    const shape = await resolveCrossFileShape(
      f.extractor,
      { uri: C, line: 0, character: cL[0].indexOf("Order") },
      OPEN_BOUND,
      f.openFile,
      shapeHooksFor("csharp"),
    );
    assert.deepEqual(keys(shape), ["Order", "Receipt"], `C#'s field leg must reach a cross-file type.${dump(shape)}`);
  }
  {
    const C = "file:///w/v55p12l/consumer.py";
    const A = "file:///w/v55p12l/order.py";
    const B = "file:///w/v55p12l/receipt.py";
    const cL = ["def settle(o: Order) -> None:", "    pass", ""];
    const aL = ["class Order:", "    slip: Receipt", "    ident: int", ""];
    const bL = ["class Receipt:", "    cents: int", ""];
    const f = fixture({
      files: { [C]: cL.join("\n"), [A]: aL.join("\n"), [B]: bL.join("\n") },
      hovers: { Order: "(class) Order", Receipt: "(class) Receipt" },
      defs: {
        Order: { uri: A, line: 0, character: aL[0].indexOf("Order") },
        Receipt: { uri: B, line: 0, character: bL[0].indexOf("Receipt") },
      },
      members: {
        Order: [{ name: "slip", kind: "field", signature: "slip: Receipt" }],
        Receipt: [{ name: "cents", kind: "field", signature: "cents: int" }],
      },
    });
    const shape = await resolveCrossFileShape(
      f.extractor,
      { uri: C, line: 0, character: cL[0].indexOf("Order") },
      OPEN_BOUND,
      f.openFile,
      shapeHooksFor("python"),
    );
    assert.deepEqual(keys(shape), ["Order", "Receipt"], `Python's field leg must reach a cross-file type.${dump(shape)}`);
  }
});

// ===========================================================================
// P12-6. THE BOUNDS STILL BIND. Contract item 7. A payload edge is subject to
// D_MAX, N_MAX and B_MAX exactly as a field edge is, and at D_MAX a payload name
// is DISCLOSED (frontier) rather than walked.
//
// Two of these rows are VACUOUS TODAY and say so: an enum contributes no edges,
// so "the caps still bind" is trivially true. They are here because they stop
// being trivial the moment the fix lands, which is the only moment they matter.
// ===========================================================================

// A wide enum: `count` tuple variants, each with its own payload type, each in
// the payload file. Everything else is the falsification fixture.
function wideEnumFixture(count) {
  const C = "file:///w/v55p12w/consumer.rs";
  const A = "file:///w/v55p12w/order.rs";
  const S = "file:///w/v55p12w/status.rs";
  const P = "file:///w/v55p12w/payloads.rs";
  const names = Array.from({ length: count }, (_, i) => `Payload${String(i).padStart(2, "0")}`);
  const cL = ["pub fn settle(order: &Order) {", "", "}", ""];
  const aL = ["pub struct Order {", "    pub status: WideStatus,", "}", ""];
  const sL = ["pub enum WideStatus {", ...names.map((n, i) => `    Variant${String(i).padStart(2, "0")}(${n}),`), "}", ""];
  const pL = [...names.map((n) => `pub struct ${n} { pub v: u64 }`), ""];
  const hovers = {
    Order: "pub struct Order {\n    pub status: WideStatus,\n}",
    WideStatus: sL.slice(0, -1).join("\n"),
  };
  const defs = {
    Order: { uri: A, line: 0, character: aL[0].indexOf("Order") },
    WideStatus: { uri: S, line: 0, character: sL[0].indexOf("WideStatus") },
  };
  names.forEach((n, i) => {
    hovers[n] = `pub struct ${n} { pub v: u64 }`;
    defs[n] = { uri: P, line: i, character: pL[i].indexOf(n) };
  });
  const f = fixture({
    files: { [C]: cL.join("\n"), [A]: aL.join("\n"), [S]: sL.join("\n"), [P]: pL.join("\n") },
    hovers,
    defs,
  });
  return { f, names, root: { uri: C, line: 0, character: cL[0].indexOf("Order") } };
}

test("P12-6a: at the depth frontier a payload name is DISCLOSED, not walked", async () => {
  // Order at depth 0, PaymentStatus at depth 1 == D_MAX. Its payloads must join
  // `frontier` (the walk never asked) rather than the queue.
  const f = rustFixture();
  const shape = await walkRust(f, { D_MAX: 1, N_MAX: 12 });
  assert.ok(shape.types.has("PaymentStatus"), `precondition: the enum sits AT the frontier.${dump(shape)}`);
  assert.ok(!shape.types.has("Receipt"), `precondition: D_MAX must stop the walk here.${dump(shape)}`);
  assert.ok(
    (shape.frontier ?? []).includes("Receipt"),
    `contract item 7: the same disclosure-not-reach rule fields already follow. The enum at D_MAX names ` +
      `\`Receipt\` and the caller must be told the walk chose not to expand it - "the walk expanded ` +
      `everything it saw" and "the walk saw nothing" have to stay different answers.${dump(shape)}`,
  );
  assert.equal(f.spent("Receipt"), 0, `and disclosing it must cost no round trip; calls ${show(f.calls)}`);
});

test("P12-6b CONTROL: a FIELD at the depth frontier is disclosed today", async () => {
  const A = "file:///w/v55p12f/consumer.rs";
  const B = "file:///w/v55p12f/a.rs";
  const C = "file:///w/v55p12f/b.rs";
  const aL = ["pub fn go(r: &Root) {", "", "}", ""];
  const bL = ["pub struct Root {", "    pub mid: Mid,", "}", "", "pub struct Mid {", "    pub leaf: Leaf,", "}", ""];
  const cL = ["pub struct Leaf {", "    pub n: u64,", "}", ""];
  const f = fixture({
    files: { [A]: aL.join("\n"), [B]: bL.join("\n"), [C]: cL.join("\n") },
    hovers: {
      Root: "pub struct Root {\n    pub mid: Mid,\n}",
      Mid: "pub struct Mid {\n    pub leaf: Leaf,\n}",
      Leaf: "pub struct Leaf {\n    pub n: u64,\n}",
    },
    defs: {
      Root: { uri: B, line: 0, character: bL[0].indexOf("Root") },
      Mid: { uri: B, line: 4, character: bL[4].indexOf("Mid") },
      Leaf: { uri: C, line: 0, character: cL[0].indexOf("Leaf") },
    },
  });
  const shape = await resolveCrossFileShape(f.extractor, { uri: A, line: 0, character: aL[0].indexOf("Root") }, { D_MAX: 1, N_MAX: 12 }, f.openFile);
  assert.deepEqual(keys(shape), ["Root", "Mid"], `the depth bound stops the walk.${dump(shape)}`);
  assert.deepEqual(
    shape.frontier,
    ["Leaf"],
    `this is the behaviour P12-6a asks an enum payload to join. If THIS row is red the mechanism moved, ` +
      `not the enum leg.${dump(shape)}`,
  );
});

test("P12-6c: N_MAX still bounds a twenty-variant enum [VACUOUS TODAY, load-bearing after the fix]", async () => {
  const { f, root } = wideEnumFixture(20);
  const N_MAX = 6;
  const shape = await resolveCrossFileShape(f.extractor, root, { D_MAX: 3, N_MAX }, f.openFile);
  assert.ok(
    shape.types.size <= N_MAX,
    `an enum with twenty variants must not be able to spend the walk: payload edges take the same N_MAX ` +
      `as field edges.${dump(shape)}`,
  );
});

test("P12-6d: B_MAX still bounds the per-node payload fan-out [VACUOUS TODAY, load-bearing after the fix]", async () => {
  const { f, names, root } = wideEnumFixture(5);
  const B_MAX = 2;
  const shape = await resolveCrossFileShape(f.extractor, root, { D_MAX: 3, N_MAX: 20, B_MAX }, f.openFile);
  const emitted = names.filter((n) => shape.types.has(n));
  assert.ok(
    emitted.length <= B_MAX,
    `the enum is ONE node and B_MAX is its per-node fan-out. Emitted ${show(emitted)} off a cap of ` +
      `${B_MAX}.${dump(shape)}`,
  );
});

test("P12-6e: a payload a cap refused is NAMED, never silent", async () => {
  const { f, names, root } = wideEnumFixture(5);
  const B_MAX = 2;
  const shape = await resolveCrossFileShape(f.extractor, root, { D_MAX: 3, N_MAX: 20, B_MAX }, f.openFile);
  const accounted = new Set([...keys(shape), ...shape.dropped, ...(shape.frontier ?? [])]);
  const silent = names.filter((n) => !accounted.has(n));
  assert.deepEqual(
    silent,
    [],
    `contract item 8 and the resolver's own promise: a reachable type that is not emitted is reported. ` +
      `These payload types were named by the enum, refused by the walk, and appear in neither \`types\`, ` +
      `\`dropped\` nor \`frontier\`.${dump(shape)}`,
  );
});

test("P12-6f: no payload type buys more than one definition round trip", async () => {
  const { f, names, root } = wideEnumFixture(5);
  await resolveCrossFileShape(f.extractor, root, { D_MAX: 3, N_MAX: 20 }, f.openFile);
  for (const n of names) {
    assert.ok(
      f.spentOn("definition", n) <= 1,
      `the walk must not re-anchor a payload it has already placed. \`${n}\` cost ` +
        `${f.spentOn("definition", n)} definition calls; calls ${show(f.calls)}`,
    );
  }
});

// ===========================================================================
// P12-7. AN UNANCHORABLE PAYLOAD IS REPORTED. Contract item 8.
//
// THE FIXTURE, AND ITS HONESTY. The hover spells `Paid(Receipt)` while the
// declaration line spells `Paid(u64)`, so the payload NAME is known and no
// cursor can be put on it. That divergence is synthetic, and it is the same
// synthetic mechanism as the measured FIELD control in P12-7b, which is the
// point: the two must behave alike. Real declarations that produce it: a
// macro-generated enum whose source carries only the invocation, and a
// `#[cfg]`-gated payload whose indexed form differs from the text on the box.
// ===========================================================================

const unanchorableFixture = () => {
  const C = "file:///w/v55p12u/consumer.rs";
  const A = "file:///w/v55p12u/order.rs";
  const S = "file:///w/v55p12u/status.rs";
  const R = "file:///w/v55p12u/receipt.rs";
  const cL = ["pub fn settle(order: &Order) {", "", "}", ""];
  const aL = ["pub struct Order {", "    pub status: PaymentStatus,", "}", ""];
  // The declaration the walk can read. It does NOT spell `Receipt` anywhere.
  const sL = ["pub enum PaymentStatus {", "    Unpaid,", "    Paid(u64),", "}", ""];
  const rL = ["pub struct Receipt {", "    pub reference: String,", "}", ""];
  const f = fixture({
    files: { [C]: cL.join("\n"), [A]: aL.join("\n"), [S]: sL.join("\n"), [R]: rL.join("\n") },
    hovers: {
      Order: "pub struct Order {\n    pub status: PaymentStatus,\n}",
      // Already spelled, so the recovery is a no-op and cannot reconcile it.
      PaymentStatus: "pub enum PaymentStatus {\n    Unpaid,\n    Paid(Receipt),\n}",
      Receipt: "pub struct Receipt {\n    pub reference: String,\n}",
    },
    defs: {
      Order: { uri: A, line: 0, character: aL[0].indexOf("Order") },
      PaymentStatus: { uri: S, line: 0, character: sL[0].indexOf("PaymentStatus") },
      Receipt: { uri: R, line: 0, character: rL[0].indexOf("Receipt") },
    },
  });
  return { f, root: { uri: C, line: 0, character: cL[0].indexOf("Order") } };
};

test("P12-7: a payload the walk cannot anchor lands in `dropped`, never silent", async () => {
  const { f, root } = unanchorableFixture();
  const shape = await resolveCrossFileShape(f.extractor, root, OPEN_BOUND, f.openFile);
  assert.ok(!shape.types.has("Receipt"), `precondition: it must not resolve, there is no cursor to put on it.${dump(shape)}`);
  assert.ok(
    shape.dropped.includes("Receipt"),
    `the signature names \`Receipt\` and the model will read it. A payload the walk could not anchor is ` +
      `exactly a field whose type token is not on its line, and that is recorded. "Parsed but never ` +
      `anchored" must at least be SAID.${dump(shape)}`,
  );
});

test("P12-7b CONTROL: an unanchorable FIELD does land in `dropped` today", async () => {
  const C = "file:///w/v55p12u2/consumer.rs";
  const A = "file:///w/v55p12u2/order.rs";
  const R = "file:///w/v55p12u2/receipt.rs";
  const cL = ["pub fn settle(order: &Order) {", "", "}", ""];
  // The hover claims `slip: Receipt`; the declaration line spells `u64`.
  const aL = ["pub struct Order {", "    pub slip: u64,", "}", ""];
  const rL = ["pub struct Receipt {", "    pub reference: String,", "}", ""];
  const f = fixture({
    files: { [C]: cL.join("\n"), [A]: aL.join("\n"), [R]: rL.join("\n") },
    hovers: {
      Order: "pub struct Order {\n    pub slip: Receipt,\n}",
      Receipt: "pub struct Receipt {\n    pub reference: String,\n}",
    },
    defs: {
      Order: { uri: A, line: 0, character: aL[0].indexOf("Order") },
      Receipt: { uri: R, line: 0, character: rL[0].indexOf("Receipt") },
    },
  });
  const shape = await resolveCrossFileShape(f.extractor, { uri: C, line: 0, character: cL[0].indexOf("Order") }, OPEN_BOUND, f.openFile);
  assert.deepEqual(
    shape.dropped,
    ["Receipt"],
    `this is the behaviour P12-7 asks a payload to join. If THIS row is red the reporting mechanism moved, ` +
      `not the enum leg.${dump(shape)}`,
  );
});

// ===========================================================================
// P12-8. THE STALE CITE. The contract's "Same touch" section: the comment at
// `crossFileShape.ts:91` names `enumPayloadsFromSource`, a symbol that exists
// nowhere. The real function is `recoverElidedSurface` in rustHoverRecovery.ts.
//
// The one pair of rows here that reads the repo rather than driving the facade,
// because a cite is a fact about the text. It greps for a NAME; it reads no
// implementation.
// ===========================================================================

const SRC_DIR = path.join(__dirname, "..", "src");

const tsFilesUnder = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...tsFilesUnder(p));
    } else if (e.name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
};

test("P12-8a: `enumPayloadsFromSource` is cited nowhere in src/ [RED TODAY, by the contract's own reading]", () => {
  const hits = [];
  for (const file of tsFilesUnder(SRC_DIR)) {
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (line.includes("enumPayloadsFromSource")) {
          hits.push(`${path.relative(SRC_DIR, file)}:${i + 1}`);
        }
      });
  }
  assert.deepEqual(
    hits,
    [],
    `the symbol exists nowhere in src/, so every cite of it sends a reader hunting for a function that ` +
      `was never written. Fix the cite to name \`recoverElidedSurface\`; do not invent a function to ` +
      `match the comment. Cited at: ${show(hits)}`,
  );
});

test("P12-8b: `recoverElidedSurface` is the function that actually does the work, and it is exported", () => {
  assert.equal(
    typeof recoverElidedSurface,
    "function",
    "the correction names `recoverElidedSurface`, re-exported from src/core/crossFileShape - a cite is " +
      "only a correction if the thing it names exists",
  );
  const hits = tsFilesUnder(SRC_DIR).filter((f) => fs.readFileSync(f, "utf8").includes("recoverElidedSurface"));
  assert.ok(
    hits.some((f) => path.basename(f) === "rustHoverRecovery.ts"),
    `and it lives in rustHoverRecovery.ts, which is what the corrected cite must point at; found in ` +
      `${show(hits.map((f) => path.relative(SRC_DIR, f)))}`,
  );
});
