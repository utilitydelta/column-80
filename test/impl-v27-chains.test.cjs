// impl-v27-chains: phase-3 implementation rows. The blind oracle
// (test/blind-v27-chains.test.cjs, frozen) owns the chainSurface facade
// contract; these rows pin what the oracle cannot see:
//   * Rust transport PARITY (review-p2 finding 1): the product (vscode
//     command) and headless (raw LSP) transports stamp the same tier and read
//     the same eager signature from the SAME raw wire item.
//   * the C# warm's Object exclusion: a warm that includes the resolved
//     Object statics must leave a user's signatureless Equals unfilled
//     (wrong-substitution + the tier-1-implies-no-signature invariant).
//   * the warm transport primitive: resolveAllMembers reaches the provider
//     order's tail (Where<> at position 113 of 115, measure-chains.md) and
//     degrades to [] on a dead runner.
//
// Run: SKIP_LIVE=1 node --test test/impl-v27-chains.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// Minimal vscode stub (impl-v27-tier pattern): enough that the vscode-layer
// transports resolve; every test drives an injected fake runner.
const STUB = path.join(__dirname, ".impl-v27-chains-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
module.exports = {
  Uri: { parse: (s) => ({ toString: () => s }), from: (o) => ({ toString: () => JSON.stringify(o) }) },
  Position: class { constructor(line, character) { this.line = line; this.character = character; } },
  Range: class { constructor(start, end) { this.start = start; this.end = end; } },
  commands: { executeCommand: async () => undefined },
  workspace: { textDocuments: [] },
};
`,
);

const entry = path.join(__dirname, ".impl-v27-chains.entry.ts");
const outfile = path.join(__dirname, ".impl-v27-chains.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { RaCommandExtractor } from "../src/vscode/raExtractor";
export { CsCommandExtractor, CHAIN_WARM_RESOLVE_CAP } from "../src/vscode/csExtractor";
export { RaLspExtractor } from "../src/core/raLspClient";
export { raSortTextTier, raEagerDetail } from "../src/core/extraction";
export { createChainCache, absorbChainSurface, absorbCsWarmSurface, fillMissingSignatures } from "../src/core/chainSurface";
export { csReceiverType } from "../src/core/csExtraction";
export { renderFimCandidates } from "../src/core/fimInject";
export { FimCompletionProvider } from "../src/vscode/completionProvider";\n`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const {
  RaCommandExtractor,
  CsCommandExtractor,
  CHAIN_WARM_RESOLVE_CAP,
  RaLspExtractor,
  createChainCache,
  absorbChainSurface,
  absorbCsWarmSurface,
  fillMissingSignatures,
  csReceiverType,
  renderFimCandidates,
  FimCompletionProvider,
} = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const CURSOR = { uri: "file:///x/main.rs", line: 10, character: 4 };

// Drive the headless transport's private completion mapping directly: TS
// `private` is compile-time only, and the mapping reads nothing off `this`,
// so the prototype method over a raw wire answer is exactly the code path a
// live rust-analyzer reply takes, minus the process.
const lspMap = (items) => RaLspExtractor.prototype["mapCompletion"].call(null, { items });

const vscodeMap = async (items) => {
  const extractor = new RaCommandExtractor(async () => ({ items }));
  return extractor.completeMembers(CURSOR);
};

// ---------------------------------------------------------------------------
// Rust transport parity (review-p2 finding 1). The SAME raw wire item goes
// through both transports. kind 2 reads as a member on both (vscode Function,
// LSP Method) so one literal serves both mappings; the parity claim is about
// tier and signature, which must not depend on the transport.
// ---------------------------------------------------------------------------

test("parity: both Rust transports stamp the same tier from the same raw wire item", async () => {
  const items = [
    // 7-family, type-matched boosted (the run-1 mispartition trap).
    { label: "advance_visible_position", detail: "fn(&mut self, u64)", kind: 2, sortText: "7fffffd9" },
    // 8-family, non-blanket needs-import shape (an extension-trait method the
    // server penalized; NOT one of the blanket into/try_into/type_id forms).
    { label: "write_events", detail: "fn(&mut self, &[Event]) -> Result<()>", kind: 2, sortText: "80000005" },
  ];
  const product = await vscodeMap(items);
  const headless = lspMap(items);
  assert.strictEqual(product.length, 2);
  assert.strictEqual(headless.length, 2);
  for (let i = 0; i < items.length; i++) {
    assert.strictEqual(
      product[i].tier,
      headless[i].tier,
      `${items[i].label}: the two transports must stamp the same tier (sortText=${items[i].sortText})`,
    );
    assert.strictEqual(
      product[i].signature,
      headless[i].signature,
      `${items[i].label}: the two transports must render the same signature`,
    );
  }
  assert.strictEqual(product[0].tier, 0, "7fffffd9 is the boosted own family");
  assert.strictEqual(product[1].tier, 1, "80000005 is the penalized family");
});

test("parity (triage-p3 finding 4): defaults-carrying descriptions strip and blanket impls drop, both transports", async () => {
  const items = [
    // The reviewer's widened class: a description-only item whose signature
    // carries a printed default. At 4168d8e both transports produced no
    // signature; after the eager fallback the product stripped and the
    // headless served `Global` raw. Both halves now shared.
    { label: "into_boxed_slice", labelDetails: { description: "fn(self) -> Box<[T], Global>" }, kind: 2, sortText: "7fffffff" },
    // A blanket impl: the product dropped it, the headless used to serve it
    // tier-stamped.
    { label: "into", detail: "fn(self) -> T", kind: 2, sortText: "80000000" },
    // A defaults-carrying `detail` (the pre-existing half of the divergence).
    { label: "split_off", detail: "fn(&mut self, usize) -> Vec<T, Global>", kind: 2, sortText: "7fffffff" },
  ];
  const product = await vscodeMap(items);
  const headless = lspMap(items);
  assert.deepStrictEqual(
    product.map((m) => ({ name: m.name, signature: m.signature, tier: m.tier })),
    headless.map((m) => ({ name: m.name, signature: m.signature, tier: m.tier })),
    "the two transports must agree member for member on the widened fixture classes",
  );
  assert.deepStrictEqual(
    product.map((m) => m.name),
    ["into_boxed_slice", "split_off"],
    "the blanket `into` drops on both transports",
  );
  assert.strictEqual(product[0].signature, "into_boxed_slice(self) -> Box<[T]>", "the printed Global default strips");
  assert.strictEqual(product[1].signature, "split_off(&mut self, usize) -> Vec<T>", "the detail-side default strips too");
});

// ---------------------------------------------------------------------------
// Rust eager-signature fallback: an unresolved item carrying its signature in
// labelDetails.description and NO detail (every Iterator method at
// `tiles.iter().`, measure-chains.md) yields a signatured member on both
// transports.
// ---------------------------------------------------------------------------

test("rust fallback: labelDetails.description serves as the signature when detail is absent, both transports", async () => {
  const items = [
    { label: "filter", labelDetails: { description: "fn(self, P) -> Filter<Self, P>" }, kind: 2, sortText: "7fffffff" },
    { label: "map", labelDetails: { description: "fn(self, F) -> Map<Self, F>" }, kind: 2, sortText: "7fffffff" },
    // detail still wins when both are present.
    { label: "take", detail: "fn(self, usize) -> Take<Self>", labelDetails: { description: "IGNORED" }, kind: 2, sortText: "7fffffff" },
  ];
  for (const members of [await vscodeMap(items), lspMap(items)]) {
    assert.strictEqual(members[0].signature, "filter(self, P) -> Filter<Self, P>", "description-only item must render");
    assert.strictEqual(members[1].signature, "map(self, F) -> Map<Self, F>", "description-only item must render");
    assert.strictEqual(members[2].signature, "take(self, usize) -> Take<Self>", "detail must win over description");
  }
});

// ---------------------------------------------------------------------------
// C# warm: Object statics never enter the cache. The pinned row from the
// triage gate: after a warm INCLUDING the resolved Object statics, a
// signatureless Equals comes back still signatureless.
// ---------------------------------------------------------------------------

test("warm exclusion: an absorbed Object static never fills a signatureless Equals", () => {
  const cache = createChainCache();
  const absorbed = absorbCsWarmSurface(cache, [
    { name: "Equals", kind: "method", signature: "bool object.Equals(object? objA, object? objB)" },
    { name: "ReferenceEquals", kind: "method", signature: "bool object.ReferenceEquals(object? objA, object? objB)" },
    {
      name: "Where<>",
      kind: "method",
      signature:
        "(extension) IEnumerable<TSource> IEnumerable<TSource>.Where<TSource>(Func<TSource, bool> predicate)",
    },
  ]);
  assert.strictEqual(absorbed, 1, "only the non-Object signature enters the cache");
  const out = fillMissingSignatures(
    [
      { name: "Equals", kind: "method" },
      { name: "Where<>", kind: "method" },
    ],
    cache,
    "csharp",
  );
  assert.strictEqual(
    out[0].signature,
    undefined,
    "a user's starved Equals must stay signatureless: a static object.Equals fill is a wrong signature, and tier 1 must keep implying no signature",
  );
  assert.ok(out[1].signature !== undefined, "the chain verb still fills (the exclusion is surgical)");
});

// ---------------------------------------------------------------------------
// The warm transport primitive.
// ---------------------------------------------------------------------------

test("resolveAllMembers resolves past the provider order's tail and maps like completeMembers", async () => {
  let seen;
  const items = [
    { label: "Add", kind: 1, documentation: "void List<Tile>.Add(Tile item)" },
    {
      label: "Where<>",
      kind: 1,
      documentation:
        "(extension) IEnumerable<TSource> IEnumerable<TSource>.Where<TSource>(Func<TSource, bool> predicate)",
    },
    // A resolved Object static: the builder withholds its signature, so even
    // before the absorb-side exclusion it can never carry one into the cache.
    { label: "GetType", kind: 1, documentation: "Type object.GetType()" },
  ];
  const extractor = new CsCommandExtractor(async (_command, _cursor, opts) => {
    seen = opts?.resolveCount;
    return { items };
  });
  const members = await extractor.resolveAllMembers({ uri: "file:///x/A.cs", line: 3, character: 14 });
  assert.ok(
    typeof seen === "number" && seen >= 115,
    `the warm's resolveCount (${seen}) must cover the measured provider order (115 headless, 123 live)`,
  );
  assert.strictEqual(members.length, 3);
  assert.ok(members[1].signature?.includes("Func<TSource, bool>"), "the tail verb comes back signatured");
  assert.strictEqual(members[2].signature, undefined, "an Object-declared signature is withheld at mapping");
});

test("resolveAllMembers degrades to [] on a throwing runner - a background warm has nobody to tell", async () => {
  const extractor = new CsCommandExtractor(async () => {
    throw new Error("Roslyn is down");
  });
  assert.deepStrictEqual(await extractor.resolveAllMembers({ uri: "file:///x/A.cs", line: 0, character: 0 }), []);
});

// ---------------------------------------------------------------------------
// The Clone/ToOwned blanket family (final fix loop, live tuple-site
// acceptance): rust-analyzer serves the family with 7-LED sortText at the
// live receiver — its top relevance family — so the tier keeps them and the
// signature-anchored blanket table is the classifier that must drop them.
// ---------------------------------------------------------------------------

// The live-observed signatures, verbatim from the dogfood log.
const CLONE_FAMILY_ITEMS = [
  { label: "clone()", detail: "fn(&self) -> Self", kind: 2, sortText: "7fffffd9" },
  { label: "to_owned()", detail: "fn(&self) -> <Self as ToOwned>::Owned", kind: 2, sortText: "7fffffff" },
  { label: "clone_from()", detail: "fn(&mut self, &Self)", kind: 2, sortText: "7fffffff" },
  { label: "clone_into()", detail: "fn(&self, &mut <Self as ToOwned>::Owned)", kind: 2, sortText: "7fffffff" },
];

test("live shapes: the four Clone/ToOwned members drop from members on BOTH transports; a user's own clone survives", async () => {
  const items = [
    ...CLONE_FAMILY_ITEMS,
    // The discriminator control: a user's OWN method named clone with a
    // different signature must survive the name collision and render.
    { label: "reopen", detail: "fn(&self) -> LogHandle", kind: 2, sortText: "7fffffff" },
    { label: "clone", detail: "fn(&self) -> LogHandle", kind: 2, sortText: "7fffffff" },
  ];
  for (const [transport, members] of [
    ["product", await vscodeMap(items)],
    ["headless", lspMap(items)],
  ]) {
    assert.deepStrictEqual(
      members.map((m) => m.name),
      ["reopen", "clone"],
      `${transport}: the blanket family drops, the user's clone(&self) -> LogHandle stays`,
    );
    assert.strictEqual(
      members[1].signature,
      "clone(&self) -> LogHandle",
      `${transport}: the surviving clone renders its own signature`,
    );
  }
});

test("live 16-member tuple-site fixture: the block reduces to own members, log_id present, clone family absent", async () => {
  // The dogfood block led clone, to_owned, clone_from, clone_into across 16
  // lines. Same surface through the product transport now: 12 own members
  // survive, the family is gone before the renderer ever sees it.
  const F = 4; // vscode Field
  const M = 1; // vscode Method
  const items = [
    ...CLONE_FAMILY_ITEMS.map((i) => ({ ...i, kind: M })),
    { label: "log_id", detail: "u64", kind: F, sortText: "7fffffd9" },
    { label: "read", detail: "u64", kind: F, sortText: "7fffffd9" },
    { label: "write", detail: "u64", kind: F, sortText: "7fffffd9" },
    { label: "file_len", detail: "u64", kind: F, sortText: "7fffffd9" },
    { label: "advance_visible_position()", detail: "fn(&mut self, u64)", kind: M, sortText: "7fffffff" },
    { label: "set_read_cursor()", detail: "fn(&mut self, u64)", kind: M, sortText: "7fffffff" },
    { label: "set_write_cursor()", detail: "fn(&mut self, u64)", kind: M, sortText: "7fffffff" },
    { label: "mark_dirty()", detail: "fn(&mut self)", kind: M, sortText: "7fffffff" },
    { label: "flush_len()", detail: "fn(&self) -> u64", kind: M, sortText: "7fffffff" },
    { label: "segment_path()", detail: "fn(&self) -> PathBuf", kind: M, sortText: "7fffffff" },
    { label: "is_sealed()", detail: "fn(&self) -> bool", kind: M, sortText: "7fffffff" },
    { label: "seal()", detail: "fn(&mut self)", kind: M, sortText: "7fffffff" },
  ];
  assert.strictEqual(items.length, 16, "the live surface was 16 lines");
  const members = await vscodeMap(items);
  assert.strictEqual(members.length, 12, "the four blanket members drop at the transport");
  const rendered = renderFimCandidates(members, "");
  assert.ok(rendered !== undefined, "the own-member block renders");
  assert.match(rendered, /log_id: u64/, "log_id-class members lead the surface");
  for (const name of ["clone", "to_owned"]) {
    assert.ok(!rendered.includes(name), `${name} must be absent from the block`);
  }
  const firstLine = rendered.split("\n")[1];
  assert.match(firstLine, /log_id/, "the block leads with the receiver's own surface, never clone");
});

// ---------------------------------------------------------------------------
// Receiver-type derivation (triage-p3 finding 1): majority non-object
// declaring type over the site's natively-resolved signatures; tie or none
// means undefined, which the provider reads as no fill and no warm.
// ---------------------------------------------------------------------------

test("csReceiverType: majority declaring type wins; tie and no-evidence yield undefined", () => {
  const stripeHead = [
    { name: "Add", kind: "method", signature: "void List<Stripe>.Add(Stripe item)" },
    { name: "AddRange", kind: "method", signature: "void List<Stripe>.AddRange(IEnumerable<Stripe> collection)" },
    { name: "Capacity", kind: "field", signature: "int List<Stripe>.Capacity { get; set; }" },
    // An extension head declares on IEnumerable<Stripe>; it loses the vote.
    {
      name: "Any<>",
      kind: "method",
      signature: "(extension) bool IEnumerable<Stripe>.Any<Stripe>()",
    },
    // Object-declared and signatureless members carry no vote at all.
    { name: "GetType", kind: "method", signature: "Type object.GetType()" },
    { name: "Where<>", kind: "method" },
  ];
  assert.strictEqual(csReceiverType(stripeHead), "List<Stripe>", "the instance majority names the receiver");

  const tied = [
    { name: "A", kind: "method", signature: "void List<Tile>.A()" },
    { name: "B", kind: "method", signature: "void List<Stripe>.B()" },
  ];
  assert.strictEqual(csReceiverType(tied), undefined, "a tie is no answer, never a guess");

  const starved = [
    { name: "Where<>", kind: "method" },
    { name: "GetType", kind: "method", signature: "Type object.GetType()" },
  ];
  assert.strictEqual(csReceiverType(starved), undefined, "object-declared plus starved members derive nothing");
  assert.strictEqual(csReceiverType([]), undefined, "an empty surface derives nothing");
});

// ---------------------------------------------------------------------------
// Kind guard (triage-p3 finding 7): the stripped-name key collapses Count the
// property and Count<> the method; the entry's kind refuses the cross-fill.
// ---------------------------------------------------------------------------

test("kind guard: Count the property can never fill Count<> the method", () => {
  const cache = createChainCache();
  const NS = "csharp\0List<Tile>";
  // Provider order at the measured site: the property absorbs first (index
  // 27), the method's absorb is then first-wins-skipped (index 28).
  absorbChainSurface(cache, NS, [
    { name: "Count", kind: "field", signature: "int List<Tile>.Count { get; }" },
    { name: "Count<>", kind: "method", signature: "(extension) int IEnumerable<Tile>.Count<Tile>()" },
  ]);
  const out = fillMissingSignatures(
    [
      { name: "Count<>", kind: "method" },
      { name: "Count", kind: "field" },
    ],
    cache,
    NS,
  );
  assert.strictEqual(
    out[0].signature,
    undefined,
    "the starved method must not receive the property getter's signature",
  );
  assert.strictEqual(out[1].signature, "int List<Tile>.Count { get; }", "the property still fills the property");
});

// ---------------------------------------------------------------------------
// Warm lifecycle (triage-p3 findings 2, 3, 8): key release on failure and on
// a stale document version, and the cap evidence line. Driven through the
// provider's own private method - TS private is compile-time only, and every
// collaborator is injected.
// ---------------------------------------------------------------------------

const NS_TILE = "csharp\0List<Tile>";
const warmHarness = () => {
  const lines = [];
  const provider = new FimCompletionProvider(
    () => {
      throw new Error("service must not be touched by the warm");
    },
    { appendLine: (l) => lines.push(l) },
  );
  const cursor = { uri: "file:///x/A.cs", line: 3, character: 14 };
  return { provider, lines, cursor, warm: (extractor, doc) => provider["warmChainSurface"](extractor, doc, cursor, NS_TILE) };
};

test("warm lifecycle: a failed warm releases its key so the type can retry", async () => {
  const { provider, warm } = warmHarness();
  let calls = 0;
  const failing = {
    resolveAllMembers: async () => {
      calls++;
      throw new Error("resolve blew up past the transport's own catch");
    },
  };
  const doc = { version: 7, isClosed: false };
  await warm(failing, doc);
  assert.strictEqual(calls, 1);
  assert.ok(!provider["chainWarmedSites"].has(NS_TILE), "the key must be released on failure");
  await warm(failing, doc);
  assert.strictEqual(calls, 2, "the released key must allow a retry at the same type");
});

test("warm lifecycle: a stale document version absorbs nothing, releases the key, and says so once", async () => {
  const { provider, lines, warm } = warmHarness();
  const doc = { version: 1, isClosed: false };
  const extractor = {
    resolveAllMembers: async () => {
      doc.version = 2; // the buffer moved while the resolve was queued
      return [{ name: "Where<>", kind: "method", signature: "(extension) bool IEnumerable<Tile>.Where<Tile>()" }];
    },
  };
  await warm(extractor, doc);
  assert.ok(!provider["chainWarmedSites"].has(NS_TILE), "a stale-version skip must release the key");
  assert.strictEqual(
    fillMissingSignatures([{ name: "Where<>", kind: "method" }], provider["chainCache"], NS_TILE)[0].signature,
    undefined,
    "nothing from the stale resolve may enter the cache",
  );
  assert.strictEqual(lines.filter((l) => l.includes("skipped, the document changed")).length, 1);
});

test("warm lifecycle: success keeps the key, absorbs under the namespace, and logs the cap on a too-wide surface", async () => {
  const { provider, lines, warm } = warmHarness();
  const wide = Array.from({ length: 170 }, (_, i) => ({
    name: `M${String(i).padStart(3, "0")}`,
    kind: "method",
    signature: `void List<Tile>.M${String(i).padStart(3, "0")}()`,
  }));
  await warm({ resolveAllMembers: async () => wide }, { version: 3, isClosed: false });
  assert.ok(provider["chainWarmedSites"].has(NS_TILE), "a successful (even capped) warm keeps its key");
  assert.strictEqual(
    fillMissingSignatures([{ name: "M169", kind: "method" }], provider["chainCache"], NS_TILE)[0].signature,
    "void List<Tile>.M169()",
    "the absorb landed under the derived namespace",
  );
  const line = lines.find((l) => l.startsWith("[fim] chain warm for List<Tile>:"));
  assert.ok(line !== undefined, `the warm must log under the TYPE name; got: ${lines.join(" | ")}`);
  assert.ok(
    line.includes(`capped at ${CHAIN_WARM_RESOLVE_CAP} of 170`),
    `the truncation evidence line is finding 8's widening trigger; got: ${line}`,
  );
});
