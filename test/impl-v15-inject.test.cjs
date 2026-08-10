// Implementer oracle for the v15 argument-type injection: the parts a blind
// contract test cannot reach from outside the pure surface.
//
//   1. The language-id DISPATCH inside argumentTypeNames. The contract says
//      "per-language stop-sets"; only an implementer test can prove WHICH id
//      lands on which set - the whole TS family, and the unmapped fallback.
//   2. The parameter-list SPLIT the type scan rides: a nested paren, a return
//      type carrying parens, a signature with no parens at all.
//   3. narrowToPartial as the shared narrowing rule, so the provider resolves
//      argument types off the same candidate set the block renders.
//   4. The argument-type resolution LADDER and its BOUND. It runs inside the
//      service's 50ms race, so every miss must degrade to the receiver-only
//      block instead of blocking a keystroke, and the number of language-server
//      round trips per keystroke must be capped.
//
// Run: SKIP_LIVE=1 node --test test/impl-v15-inject.test.cjs
// (Hermetic: a fake extractor, no model, no network.)

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod: core, cleanup } = bundleCore(
  "impl-v15-inject",
  `export { argumentTypeNames, narrowToPartial, lineCommentFor, renderFimCandidates } from "../src/core/fimInject";\n` +
  `export { resolveArgTypesInBudget } from "../src/core/argTypeSurface";\n`
);
const { argumentTypeNames, narrowToPartial, resolveArgTypesInBudget } = core;

test.after(cleanup);

const mem = (name, signature, kind = "method") => ({ name, signature, kind });

// ===========================================================================
// 1. Language dispatch. The blind oracle probes one id per language; the
// registry has to route the whole TS family and every unmapped id.
// ===========================================================================

// Each row: an id, a name that IS in the set that id must route to, and a name
// that is std in a DIFFERENT language's set. Getting the dispatch wrong flips
// exactly one of the two assertions.
for (const { languageId, filtered, kept, why } of [
  { languageId: "typescript", filtered: "Buffer", kept: "Cow", why: "the TS set" },
  { languageId: "typescriptreact", filtered: "Buffer", kept: "Cow", why: "TSX rides TS_LANGUAGE_IDS, not the fallback" },
  { languageId: "javascript", filtered: "Buffer", kept: "Cow", why: "JS rides TS_LANGUAGE_IDS" },
  { languageId: "javascriptreact", filtered: "Buffer", kept: "Cow", why: "JSX rides TS_LANGUAGE_IDS" },
  { languageId: "csharp", filtered: "Guid", kept: "Buffer", why: "the C# BCL set" },
  { languageId: "python", filtered: "Coroutine", kept: "Guid", why: "the typing set" },
  { languageId: "rust", filtered: "Cow", kept: "Guid", why: "the Rust std set" },
  // go left the unmapped-fallback set at v23 supersession (its own stop set
  // shipped); the go row is pinned in full by blind-v23-gomembersite.test.cjs.
  { languageId: "java", filtered: "Cow", kept: "Guid", why: "an unmapped id falls back to the Rust set, never to no set at all" },
  { languageId: "", filtered: "Cow", kept: "Guid", why: "an empty id falls back the same way" },
]) {
  test(`argumentTypeNames dispatch (${languageId || "<empty>"}): ${filtered} is filtered and ${kept} survives - ${why}`, () => {
    const members = [mem("a", `take(x: ${filtered}, y: ${kept})`)];
    assert.deepStrictEqual(argumentTypeNames(members, languageId), [kept]);
  });
}

// ===========================================================================
// 2. The parameter split. The contract's "parameter positions only" rests on
// finding the first `(` and its MATCHING `)`; these are the shapes that break a
// naive first-paren-to-first-close or a flat scan.
// ===========================================================================

for (const { what, signature, expected } of [
  {
    what: "a nested paren inside the parameter list does not end it early",
    signature: "register(onDone: (t: Tile) => void, stripe: Stripe): void",
    expected: ["Tile", "Stripe"],
  },
  {
    what: "a return type carrying its own parens stays excluded",
    signature: "make(id: Tile): (s: Stripe) => Atlas",
    expected: ["Tile"],
  },
  {
    what: "a property signature with no parens contributes nothing",
    signature: "TileTally : Tile",
    expected: [],
  },
  {
    what: "an empty parameter list contributes nothing even with a user return type",
    signature: "current(): Atlas",
    expected: [],
  },
  {
    what: "a parameter list left unclosed still reads the types it can see",
    signature: "take(x: Tile",
    expected: ["Tile"],
  },
  {
    what: "a qualified parameter type contributes its last segment only, never the namespace",
    signature: "take(x: Atlas.Stripe): void",
    expected: ["Stripe"],
  },
  {
    what: "a nested generic contributes every non-std argument, outermost first",
    signature: "take(x: Map<Tile, Stripe>): void",
    expected: ["Tile", "Stripe"],
  },
]) {
  test(`argumentTypeNames parameter split: ${what}`, () => {
    assert.deepStrictEqual(argumentTypeNames([mem("m", signature)], "typescript"), expected);
  });
}

// ===========================================================================
// 3. narrowToPartial - the rule the render and the resolver must share.
// ===========================================================================

const NARROW_MEMBERS = [mem("EnrollTile", "EnrollTile(Tile) : bool"), mem("Enroll", "Enroll() : bool"), mem("Reset", "Reset() : void")];

for (const { partial, expected, why } of [
  { partial: "", expected: ["EnrollTile", "Enroll", "Reset"], why: "an empty partial keeps every member, in input order" },
  { partial: "Enroll", expected: ["EnrollTile", "Enroll"], why: "a prefix keeps every member it prefixes, exact match included" },
  { partial: "Res", expected: ["Reset"], why: "a narrowing prefix keeps only its own" },
  { partial: "Zzz", expected: [], why: "a partial matching nothing narrows to nothing" },
  { partial: "enroll", expected: [], why: "narrowing is case SENSITIVE - the server's names are the truth" },
]) {
  test(`narrowToPartial(${JSON.stringify(partial)}): ${why}`, () => {
    assert.deepStrictEqual(narrowToPartial(NARROW_MEMBERS, partial).map((m) => m.name), expected);
  });
}

test("narrowToPartial feeds argumentTypeNames the SAME candidates the block renders - a narrowed-away member's argument type is never resolved", () => {
  const narrowed = narrowToPartial(NARROW_MEMBERS, "Res");
  assert.deepStrictEqual(argumentTypeNames(narrowed, "csharp"), [], "Reset takes nothing, so Tile is not worth a round trip");
  assert.deepStrictEqual(argumentTypeNames(NARROW_MEMBERS, "csharp"), ["Tile"], "and the un-narrowed set still names it");
});

// ===========================================================================
// 4. The argument-type resolution ladder and its bound.
// ===========================================================================

// A document whose text mentions each type in real code, so findTypeAnchor
// anchors it same-file unless the test deliberately omits it.
function makeDoc(languageId, referencedTypes) {
  const text = referencedTypes.map((t) => `let ${t.toLowerCase()}: ${t};`).join("\n");
  return { languageId, uri: { toString: () => "file:///a.ts" }, version: 1, getText: () => text };
}

// A fake extractor recording every call, so a test can assert the number of
// language-server round trips a keystroke paid for.
function makeExtractor(opts = {}) {
  const calls = { membersOfType: [], byName: [], definition: [] };
  const extractor = {
    calls,
    async completeMembers() {
      return [];
    },
    // A text anchor is where the type is MENTIONED. Turning that into the type's
    // DEFINITION is a real language-server round trip, and the fake has to make
    // it, or it is not modelling the transport it stands in for. Answering the
    // anchor position back would model the exact bug this leg had.
    async definition(cursor) {
      calls.definition.push(cursor);
      if (opts.definitionThrows) {
        throw new Error("definition blew up");
      }
      // Distinct per anchor. Every type resolving to ONE definition would make
      // the cursor useless as an identifier, and the per-type cases below key
      // their behaviour on exactly that.
      return opts.definition
        ? opts.definition(cursor)
        : {
            uri: `file:///def-${cursor.line}-${cursor.character}.cs`,
            range: { startLine: cursor.line, startCharacter: cursor.character, endLine: cursor.line + 9, endCharacter: 1 },
          };
    },
    async membersOfType(cursor) {
      calls.membersOfType.push(cursor);
      if (opts.membersThrows) {
        throw new Error("resolver blew up");
      }
      return opts.members ? opts.members(cursor) : [mem("Tile", "Tile(int mortonCode, int lod)", "constructor")];
    },
  };
  if (opts.byName !== undefined) {
    extractor.resolveTypeCursorByName = async (name) => {
      calls.byName.push(name);
      if (opts.byNameThrows) {
        throw new Error("workspace symbol blew up");
      }
      return opts.byName(name);
    };
  }
  return extractor;
}

// A budget far past any keystroke window: these cases grade the resolution
// LADDER, and a deadline racing them would make them time-dependent. The budget
// behaviour itself is graded in impl-v16-argtype-budget.test.cjs.
const NO_BUDGET_PRESSURE_MS = 60000;
const resolve = (doc, extractor, members) =>
  resolveArgTypesInBudget(
    extractor,
    { uri: doc.uri.toString(), languageId: doc.languageId, text: doc.getText() },
    members,
    NO_BUDGET_PRESSURE_MS,
  );

const TAKES_TILE = [mem("EnrollTile", "EnrollTile(Tile) : bool")];

test("resolveArgTypes: a type anchored in the SAME FILE resolves off that anchor and never pays the workspace-symbol leg", async () => {
  const extractor = makeExtractor({ byName: () => ({ uri: "file:///b.cs", line: 9, character: 0 }) });
  const out = await resolve(makeDoc("csharp", ["Tile"]), extractor, TAKES_TILE);
  assert.deepStrictEqual(out.map((a) => a.name), ["Tile"]);
  assert.strictEqual(out[0].members[0].signature, "Tile(int mortonCode, int lod)");
  assert.strictEqual(extractor.calls.byName.length, 0, "the same-file anchor short-circuits the fallback leg");
  assert.strictEqual(extractor.calls.membersOfType.length, 1);
});

test("resolveArgTypes: a type NOT referenced in the document falls to the workspace-symbol leg - the cross-project collaborator case", async () => {
  const extractor = makeExtractor({ byName: () => ({ uri: "file:///b.cs", line: 9, character: 4 }) });
  const out = await resolve(makeDoc("csharp", []), extractor, TAKES_TILE);
  assert.deepStrictEqual(out.map((a) => a.name), ["Tile"]);
  assert.deepStrictEqual(extractor.calls.byName, ["Tile"]);
  assert.deepStrictEqual(extractor.calls.membersOfType, [{ uri: "file:///b.cs", line: 9, character: 4 }]);
});

// Every way the ladder can miss. All of them must yield the empty surface -
// the completion then carries today's receiver-only block, never an error.
for (const { what, doc, extractor, expectMembersOfType } of [
  {
    what: "no same-file anchor and the extractor has no workspace-symbol leg at all (Rust/TS/Python today)",
    doc: () => makeDoc("typescript", []),
    extractor: () => makeExtractor({}),
    expectMembersOfType: 0,
  },
  {
    what: "no same-file anchor and the workspace-symbol leg resolves nothing",
    doc: () => makeDoc("csharp", []),
    extractor: () => makeExtractor({ byName: () => undefined }),
    expectMembersOfType: 0,
  },
  {
    what: "the workspace-symbol leg THROWS",
    doc: () => makeDoc("csharp", []),
    extractor: () => makeExtractor({ byName: () => undefined, byNameThrows: true }),
    expectMembersOfType: 0,
  },
  {
    what: "membersOfType THROWS on the anchored type",
    doc: () => makeDoc("csharp", ["Tile"]),
    extractor: () => makeExtractor({ membersThrows: true }),
    expectMembersOfType: 1,
  },
  {
    what: "membersOfType resolves an EMPTY member set - no bare 'to build a Tile:' section",
    doc: () => makeDoc("csharp", ["Tile"]),
    extractor: () => makeExtractor({ members: () => [] }),
    expectMembersOfType: 1,
  },
]) {
  test(`resolveArgTypes degrades to the receiver-only block when ${what}`, async () => {
    const ex = extractor();
    const out = await resolve(doc(), ex, TAKES_TILE);
    assert.deepStrictEqual(out, [], "a miss contributes nothing and throws nothing");
    assert.strictEqual(ex.calls.membersOfType.length, expectMembersOfType);
  });
}

test("resolveArgTypes: one type's failure does not suppress the next - the ladder is per-type, not all-or-nothing", async () => {
  const extractor = makeExtractor({
    members: (cursor) => {
      if (cursor.line === 0) {
        throw new Error("Tile is unreadable");
      }
      return [mem("Stripe", "Stripe(string atlasId)", "constructor")];
    },
  });
  const out = await resolve(
    makeDoc("csharp", ["Tile", "Stripe"]),
    extractor,
    [mem("Enroll", "Enroll(Tile, Stripe) : bool")]
  );
  assert.deepStrictEqual(out.map((a) => a.name), ["Stripe"], "the survivor still renders");
  assert.strictEqual(extractor.calls.membersOfType.length, 2, "and the failure did not abort the loop");
});

test("resolveArgTypes: a member set naming many argument types is CAPPED - a keystroke pays a bounded number of round trips", async () => {
  const names = ["Tile", "Stripe", "Atlas", "Cohort", "Ledger", "Parcel"];
  const extractor = makeExtractor({});
  const out = await resolve(
    makeDoc("csharp", names),
    extractor,
    names.map((n, i) => mem(`Take${i}`, `Take${i}(${n}) : void`))
  );
  assert.ok(
    extractor.calls.membersOfType.length < names.length,
    `the cap must bite before the whole list resolves; paid ${extractor.calls.membersOfType.length} of ${names.length}`
  );
  assert.strictEqual(out.length, extractor.calls.membersOfType.length, "every resolved type renders");
  assert.deepStrictEqual(
    out.map((a) => a.name),
    names.slice(0, out.length),
    "the cap keeps the FIRST-named types - first appearance is the closest to the cursor's call"
  );
});

test("resolveArgTypes: a receiver whose members take no user types pays ZERO round trips", async () => {
  const extractor = makeExtractor({});
  const out = await resolve(
    makeDoc("csharp", ["Tile"]),
    extractor,
    [mem("AggregateFanout", "AggregateFanout() : int"), mem("Reset", "Reset(Guid) : void")]
  );
  assert.deepStrictEqual(out, []);
  assert.strictEqual(extractor.calls.membersOfType.length, 0, "int and Guid are std; neither is worth a query");
});

test("resolveArgTypes (python): anchoring uses the PYTHON anchor, so a `#` comment mention is not an anchor", async () => {
  const doc = { languageId: "python", uri: { toString: () => "file:///a.py" }, version: 1, getText: () => "# Tile is described here\n" };
  const extractor = makeExtractor({});
  const out = await resolve(doc, extractor, [mem("enroll_tile", "enroll_tile(self, tile: Tile) -> bool")]);
  assert.deepStrictEqual(out, [], "a comment-only mention resolves nothing rather than anchoring on prose");
  assert.strictEqual(extractor.calls.membersOfType.length, 0);
});

// ===========================================================================
// 5. Rust's non-constructible names, decided by POSITION. A trait bound, a
// closure trait and `Self` read as PascalCase user types to a flat scan, so
// they take the scarce slots and — worse — render a `to build a X:` header over
// members that build no such thing, directly under a header demanding exact
// names. Position is what tells them apart: a NAME list cannot, because
// `Item`, `Error` and `Display` are ordinary user type names too, and dropping
// those defeats the injection for exactly the types it exists to serve.
// ===========================================================================

for (const { signature, expected, why } of [
  // Still filtered: the bound positions.
  {
    signature: "extend(&mut self, tiles: impl IntoIterator<Item = Tile>)",
    expected: ["Tile"],
    why: "an impl bound and an associated-type BINDING both drop; only the bound-to type survives",
  },
  {
    signature: "each(&self, f: impl FnMut(&Tile))",
    expected: ["Tile"],
    why: "a closure trait is a bound, not a type to build",
  },
  {
    signature: "name(&mut self, n: impl Into<String>)",
    expected: [],
    why: "Into is in bound position and String is std - nothing here is worth a round trip",
  },
  {
    signature: "merge(&mut self, other: Self) -> Self",
    expected: [],
    why: "Self is a reserved word, never a user type; resolving it renders the receiver under a false header",
  },
  {
    signature: "boxed(&self, b: Box<dyn Renderer>)",
    expected: [],
    why: "a dyn bound names a trait object the caller satisfies with some other type",
  },
  // No longer filtered: the same names OUTSIDE bound position are the user's
  // own types, and the phase exists to inject exactly these.
  {
    signature: "add(&mut self, i: Item, t: Tile)",
    expected: ["Item", "Tile"],
    why: "a user type called Item in a plain parameter position is constructible",
  },
  {
    signature: "fail(&self, e: Error)",
    expected: ["Error"],
    why: "a user type called Error is constructible; only the trait bound was not",
  },
  {
    signature: "show(&self, d: Display)",
    expected: ["Display"],
    why: "a user type called Display is constructible; only the trait bound was not",
  },
]) {
  test(`argumentTypeNames (rust): ${signature} -> [${expected}] - ${why}`, () => {
    assert.deepStrictEqual(argumentTypeNames([mem("m", signature)], "rust"), expected);
  });
}

test("the Rust position rules are ARGUMENT-scope only: ordinary user types still resolve", () => {
  assert.deepStrictEqual(
    argumentTypeNames([mem("enroll", "enroll(&mut self, t: Tile, s: Stripe)")], "rust"),
    ["Tile", "Stripe"],
    "the position rules must not swallow ordinary user types",
  );
});

// `impl`/`dyn` are Rust keywords. A language that falls through the registry
// (Go, Java, C++) must not have its parameter types judged by a Rust grammar.
for (const { languageId, why } of [
  { languageId: "go", why: "an unmapped id" },
  { languageId: "", why: "an empty id" },
]) {
  test(`argumentTypeNames (${languageId || "<empty>"}): ${why} inherits no trait filtering - every user type in a parameter position survives`, () => {
    assert.deepStrictEqual(
      argumentTypeNames([mem("m", "take(impl Renderer, dyn Drawable, Item, Error, Display, Self)")], languageId),
      ["Renderer", "Drawable", "Item", "Error", "Display", "Self"],
    );
  });
}

// ===========================================================================
// 6. An argument type that resolves back to the RECEIVER. `Stripe.Merge(Stripe)`
// is common, and rendering it says the receiver's own methods construct it.
// ===========================================================================

test("resolveArgTypes drops an argument type whose members ARE the receiver's, and the block carries no false `to build a Stripe:`", async () => {
  const receiver = [mem("Merge", "Merge(Stripe) : void"), mem("EnrollTile", "EnrollTile(Tile) : bool")];
  const extractor = makeExtractor({
    // Line 0 anchors Stripe, line 1 anchors Tile (see makeDoc's one-per-line text).
    members: (cursor) => (cursor.line === 0 ? receiver : [mem("Tile", "Tile(int mortonCode, int lod)", "constructor")]),
  });
  const argTypes = await resolve(makeDoc("csharp", ["Stripe", "Tile"]), extractor, receiver);

  assert.deepStrictEqual(argTypes.map((a) => a.name), ["Tile"], "the self-referential type is skipped");
  const block = core.renderFimCandidates(receiver, "", "//", argTypes);
  assert.ok(!block.includes("to build a Stripe:"), `no false header; got:\n${block}`);
  assert.ok(block.includes("to build a Tile:"), "and the real argument type still renders");
  assert.strictEqual(
    block.split("\n").filter((l) => l.includes("Merge(Stripe)")).length,
    1,
    "the receiver's own member lines appear exactly once",
  );
});

// ===========================================================================
// The reference-is-not-the-definition regression, at the seam the provider
// actually owns. The blind identity suite composes its own resolution and so
// cannot see this; without the rows below the fix is unverified.
//
// Observed in a real C# dogfood run: the anchor for `Tile` landed on
// `Tile tile = Cartography.TileFromMorton(42, 3);` inside a helper class, that
// REFERENCE cursor went straight to membersOfType, and the helper class's own
// methods came back and were rendered under `to build a Tile:`. The model then
// invented a function matching the shape of the names it was shown.
// ===========================================================================

// The site file holds the helper class and merely MENTIONS Tile. Tile lives in
// its own file. The two member sets share no name, so which one was reached is
// always decidable.
const HELPER_MEMBERS = [
  mem("TileSite", "TileSite() : int"),
  mem("StripeMutatorSite", "StripeMutatorSite() : bool"),
  mem("FreshSite", "FreshSite() : int"),
];
const TILE_DEF_URI = "file:///atlas.cs";
const TILE_OWN_MEMBERS = [mem("Tile", "Tile(int mortonCode, int lod)", "constructor")];

// Answers by FILE, the way a language server does: ask the site file and you get
// the helper class, ask Tile's file and you get Tile.
const byFile = (cursor) => (cursor.uri === TILE_DEF_URI ? TILE_OWN_MEMBERS : HELPER_MEMBERS);

test("resolveArgTypes resolves the type REFERENCE to its DEFINITION before reading members, so the enclosing helper class is never returned as Tile", async () => {
  const extractor = makeExtractor({
    members: byFile,
    definition: () => ({ uri: TILE_DEF_URI, range: { startLine: 4, startCharacter: 13, endLine: 40, endCharacter: 1 } }),
  });
  const out = await resolve(makeDoc("csharp", ["Tile"]), extractor, TAKES_TILE);

  assert.strictEqual(extractor.calls.definition.length, 1, "the anchor must be resolved through definition(), not used as a def cursor");
  assert.deepStrictEqual(
    extractor.calls.membersOfType.map((c) => c.uri),
    [TILE_DEF_URI],
    "members must be read from Tile's OWN file; reading the site file is the wrong-block bug",
  );
  assert.deepStrictEqual(out.map((a) => a.name), ["Tile"]);
  assert.deepStrictEqual(
    out[0].members.map((m) => m.name),
    ["Tile"],
    "and the surface is Tile's constructor, never the helper class's functions",
  );
});

test("a helper name can never reach the rendered block through the argument-type leg", async () => {
  const extractor = makeExtractor({
    members: byFile,
    definition: () => ({ uri: TILE_DEF_URI, range: { startLine: 4, startCharacter: 13, endLine: 40, endCharacter: 1 } }),
  });
  const out = await resolve(makeDoc("csharp", ["Tile"]), extractor, TAKES_TILE);
  const block = core.renderFimCandidates(TAKES_TILE, "", "//", out) ?? "";
  for (const helper of HELPER_MEMBERS.map((m) => m.name)) {
    assert.ok(!block.includes(helper), `${helper} belongs to the helper class and must not appear:\n${block}`);
  }
  assert.ok(block.includes("to build a Tile:"), "the honest section still renders");
});

test("when the definition cannot be resolved the type is DROPPED, never read off the reference", async () => {
  const extractor = makeExtractor({ members: byFile, definition: () => undefined });
  const out = await resolve(makeDoc("csharp", ["Tile"]), extractor, TAKES_TILE);
  assert.deepStrictEqual(out, [], "no definition means no surface; falling back to the reference is what produced the wrong block");
  assert.strictEqual(extractor.calls.membersOfType.length, 0, "and nothing was read at all");
});
