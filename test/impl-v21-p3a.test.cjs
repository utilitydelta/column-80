// IMPLEMENTATION tests for the phase 3a member surface: the edges the blind
// contract set cannot see from outside.
//
//   - csDeclaringType's parse, over the Roslyn signature shapes the blind
//     fixtures do NOT carry (tuple returns, nested generics, namespace-qualified
//     declaring types, text that is not a signature at all). A parse that
//     answers "object" for a real member deletes that member's line, so the
//     interesting direction is FALSE POSITIVES.
//   - csPreResolveSignature's guard: a `detail` that does not declare this
//     member is refused rather than injected as its signature.
//   - the word-based-fallback evidence: it appears ONLY when the answer held
//     nothing semantic, and never displaces a real member set.
//
// Run: SKIP_LIVE=1 node --test test/impl-v21-p3a.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v21-p3a",
  `export * as cs from "../src/core/csExtraction";\n` +
    `export * as extraction from "../src/core/extraction";\n` +
    `export * as csx from "../src/vscode/csExtractor";\n`,
);
test.after(() => cleanup());

const { cs, extraction, csx } = mod;

// ---------------------------------------------------------------------------
// csDeclaringType
// ---------------------------------------------------------------------------

for (const { name, signature, expected } of [
  { name: "an object universal member", signature: "bool object.Equals(object? obj) (+ 1 overload)", expected: "object" },
  { name: "an extension declared on object", signature: "(extension) TResult object.Field<TResult>(string name)", expected: "object" },
  { name: "an extension declared on a specific generic type", signature: "(extension) IQueryable<Tile> IQueryable<Tile>.WhereLod(int lod)", expected: "IQueryable<Tile>" },
  { name: "a property with accessors", signature: "int Stripe.AtlasId { get; set; }", expected: "Stripe" },
  { name: "a member whose RETURN type is object", signature: "object Stripe.Payload { get; }", expected: "Stripe" },
  { name: "a member taking an object PARAMETER", signature: "void Stripe.Add(object item)", expected: "Stripe" },
  { name: "an override of Equals on a real type", signature: "bool Stripe.Equals(object? obj)", expected: "Stripe" },
  { name: "a namespace-qualified declaring type", signature: "string Atlas.Tiling.Stripe.Describe()", expected: "Atlas.Tiling.Stripe" },
  { name: "a nested generic return type", signature: "Dictionary<int, List<Tile>> Stripe.ByLod()", expected: "Stripe" },
  { name: "a parameterless method", signature: "int Stripe.Count()", expected: "Stripe" },
  { name: "text that is not a signature", signature: "Some prose about the member.", expected: undefined },
  { name: "a bare member name", signature: "AtlasId", expected: undefined },
  { name: "no signature at all", signature: undefined, expected: undefined },
]) {
  test(`csDeclaringType: ${name}`, () => {
    assert.strictEqual(cs.csDeclaringType(signature), expected);
  });
}

test("csDeclaringType never mistakes an object RETURN TYPE or PARAMETER for the declaring type - a false positive deletes a real member's line", () => {
  const realMembers = [
    "object Stripe.Payload { get; set; }",
    "object? Stripe.Find(string key)",
    "void Stripe.Add(object item)",
    "bool Stripe.Equals(object? obj)",
    "List<object> Stripe.Boxed { get; }",
  ];
  for (const signature of realMembers) {
    assert.strictEqual(
      cs.isCsObjectDeclaredMember(signature),
      false,
      `${JSON.stringify(signature)} is declared on Stripe, not on object`,
    );
  }
});

test("isCsObjectDeclaredMember accepts the keyword Roslyn renders and the fully qualified CLR spelling", () => {
  for (const signature of ["string object.ToString()", "string System.Object.ToString()"]) {
    assert.strictEqual(cs.isCsObjectDeclaredMember(signature), true, signature);
  }
});

test("a user type NAMED Object keeps its members - Roslyn renders System.Object as the keyword, so a capitalised `Object.` is somebody's own type and filtering it deletes a real property's line", () => {
  for (const signature of [
    "int Object.Count { get; set; }",
    "string Object.Describe()",
    "int MyNs.Object.Count { get; set; }",
  ]) {
    assert.strictEqual(cs.isCsObjectDeclaredMember(signature), false, signature);
  }
});

// ---------------------------------------------------------------------------
// csPreResolveSignature
// ---------------------------------------------------------------------------

for (const { name, label, detail, expected } of [
  { name: "a signature naming the member is taken", label: "AtlasId", detail: "int Stripe.AtlasId { get; set; }", expected: "int Stripe.AtlasId { get; set; }" },
  { name: "detail that does not name the member is refused", label: "AtlasId", detail: "Atlas.Tiling", expected: undefined },
  { name: "detail equal to the bare name says nothing", label: "AtlasId", detail: "AtlasId", expected: undefined },
  { name: "a name embedded in a longer identifier does not count", label: "Field", detail: "int Stripe.FieldMappings { get; set; }", expected: undefined },
  { name: "absent detail", label: "AtlasId", detail: undefined, expected: undefined },
]) {
  test(`csPreResolveSignature: ${name}`, () => {
    assert.strictEqual(cs.csPreResolveSignature(label, detail), expected);
  });
}

test("toCsCompletionMember prefers the RESOLVED documentation over the pre-resolve detail, and keeps the name when it drops an object member's signature", () => {
  const resolved = cs.toCsCompletionMember("Count", "int Stripe.Count()\r\nHow many.", "method", "stale detail");
  assert.strictEqual(resolved.signature, "int Stripe.Count()");

  const filtered = cs.toCsCompletionMember("ToString", "string object.ToString()\r\nprose", "method", undefined);
  assert.strictEqual(filtered.name, "ToString", "the name always reaches the enforcement gate");
  assert.strictEqual(filtered.signature, undefined, "an object-declared member carries no rendered line");
});

// ---------------------------------------------------------------------------
// renderFieldSignature
// ---------------------------------------------------------------------------

for (const { name, member, detail, expected } of [
  { name: "a plain type", member: "seed", detail: "u64", expected: "seed: u64" },
  { name: "a function type stays data-shaped", member: "on_tick", detail: "fn(u64) -> bool", expected: "on_tick: fn(u64) -> bool" },
  { name: "surrounding whitespace is trimmed", member: "seed", detail: "  u64  ", expected: "seed: u64" },
  { name: "an empty type is no type", member: "seed", detail: "   ", expected: undefined },
  { name: "no type at all", member: "seed", detail: undefined, expected: undefined },
]) {
  test(`renderFieldSignature: ${name}`, () => {
    assert.strictEqual(extraction.renderFieldSignature(member, detail), expected);
  });
}

// ---------------------------------------------------------------------------
// The word-based-fallback evidence, through the C# transport.
// ---------------------------------------------------------------------------

const FILE_URI = "file:///fake/app/Caller.cs";
const BUFFER = ["class C {", "  void M(Stripe s) {", "    s.", "  }", "}", ""].join("\n");
const CURSOR = { uri: FILE_URI, line: 2, character: 6 };
const readBuffer = (uri) => (uri === FILE_URI ? BUFFER : undefined);
const K_TEXT = 0;
const K_METHOD = 1;
const K_KEYWORD = 13;

const extractorOver = (items) => {
  const run = async (command) =>
    command === "vscode.executeCompletionItemProvider" ? { isIncomplete: false, items } : undefined;
  return new csx.CsCommandExtractor(run, readBuffer);
};

test("an answer made entirely of the editor's word-based fallback comes back as `text` evidence, not as an empty set", async () => {
  const members = await extractorOver([
    { label: "foo", kind: K_TEXT },
    { label: "namespace", kind: K_TEXT },
  ]).completeMembers(CURSOR);
  assert.deepStrictEqual(
    members.map((m) => [m.name, m.kind, m.signature]),
    [
      ["foo", "text", undefined],
      ["namespace", "text", undefined],
    ],
  );
  assert.deepStrictEqual(extraction.semanticMembers(members), [], "and none of it is the receiver's surface");
});

test("a fallback item never displaces a real member set, and never joins one", async () => {
  const members = await extractorOver([
    { label: "foo", kind: K_TEXT },
    { label: "EnrollTile", kind: K_METHOD, detail: "bool Stripe.EnrollTile(Tile tile)" },
  ]).completeMembers(CURSOR);
  assert.deepStrictEqual(members.map((m) => m.name), ["EnrollTile"]);
});

test("a genuinely empty answer stays empty - `[]` keeps meaning the receiver resolved to nothing", async () => {
  assert.deepStrictEqual(await extractorOver([]).completeMembers(CURSOR), []);
  assert.deepStrictEqual(
    await extractorOver([{ label: "if", kind: K_KEYWORD }]).completeMembers(CURSOR),
    [],
    "a keyword-only answer is not the word-based fallback and proves nothing about the server",
  );
});
