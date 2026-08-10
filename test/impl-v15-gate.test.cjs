// Implementer oracle for the v15 output gate: what a black-box test of the
// four pure functions cannot see from outside.
//
//   1. memberReceiverName - the provider's one parse of the prefix, and the
//      only reason a receiver ever reaches the gate.
//   2. The SERVICE wiring: the receiver and the argument-type signatures must
//      both travel, and each must be what decides the verdict. A gate that
//      silently receives neither still passes every pure-function test.
//   3. Alternate promotion: a primary the NEW gates reject must still yield to
//      a surviving alternate, or the gate turns a cycled gesture into silence.
//   4. column80.fimMemberGate as the single kill switch for BOTH gates.
//   5. The member-site single-line collapse, which decides what shape of ghost
//      the receiver leg ever sees in production.
//
// Run: SKIP_LIVE=1 node --test test/impl-v15-gate.test.cjs
// (Hermetic: a vscode stub, a fake extractor, a fake generate, no network.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const STUB = path.join(__dirname, ".impl-v15-gate-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; }
  translate(l, c) { return new Position(this.line + l, this.character + c); } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = {
  Position, Range,
  Uri: { parse: (s) => ({ toString: () => s }) },
  languages: {}, window: {}, commands: {},
  workspace: {
    // One alternative keeps the fan-out to a single generate call. The gate
    // switch reads a test-controlled global so the kill switch is exercised
    // through the same config read production uses.
    getConfiguration: () => ({ get: (k, d) => {
      if (k === "fimAlternatives") { return 1; }
      if (k === "fimMemberGate") { return globalThis.__v15GateOn !== false; }
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

// The extractor REGISTRY is stubbed, not the transport: these tests need the
// provider's own gate wiring with a language server they control.
const REGISTRY_STUB = path.join(__dirname, ".impl-v15-gate-registry.ts");
fs.writeFileSync(
  REGISTRY_STUB,
  `export function extractorFor(_languageId: string): any {
  return (globalThis as any).__v15GateExtractor;
}\n`
);

const entry = path.join(__dirname, ".impl-v15-gate.entry.ts");
const outfile = path.join(__dirname, ".impl-v15-gate.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { FimCompletionProvider } from "../src/vscode/completionProvider";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";
export { memberReceiverName } from "../src/core/fimInject";\n`
);
// Redirecting a RELATIVE import needs an esbuild plugin, and esbuild rejects
// plugins in its synchronous API - so the build runs in a child process, which
// keeps the require below synchronous.
const buildScript = path.join(__dirname, ".impl-v15-gate.build.cjs");
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
execFileSync(process.execPath, [buildScript], { stdio: "inherit" });
const { FimCompletionProvider, CompletionService, DEFAULT_FIM_CONFIG, memberReceiverName } = require(outfile);

test.after(() => {
  [STUB, REGISTRY_STUB, entry, outfile, buildScript].forEach((f) => fs.rmSync(f, { force: true }));
});

const mem = (name, signature, kind = "method") => ({ name, signature, kind });

// The measured scenario: a receiver whose member takes a type the model must
// construct, and the constructor arity it got wrong 8/8 without that surface.
const RECEIVER_MEMBERS = [mem("EnrollTile", "EnrollTile(Tile) : bool"), mem("AggregateFanout", "AggregateFanout() : int")];
const TILE_MEMBERS = [mem("Tile", "Tile(int mortonCode, int lod)", "constructor")];
const MEMBER_NAMES = RECEIVER_MEMBERS.map((m) => m.name);

// ===========================================================================
// 1. memberReceiverName: the provider's single parse of the prefix.
// ===========================================================================

test("memberReceiverName names the identifier the site hangs off, and declines every receiver it cannot name", () => {
  const cases = [
    ["let x = stripe.", "stripe"],
    ["let x = stripe.Enro", "stripe"],
    ["atlas.stripe.", "stripe", "the LAST path segment owns the members, not the first"],
    ["atlas.stripe.Enro", "stripe"],
    ["let x = Tile::", "Tile", "the C-family scope operator names a receiver too"],
    ["let x = Tile::wi", "Tile"],
    ["  self.", "self"],
    ["_private$1.", "_private$1"],
    ["build().", undefined, "a call result has no name to match later in the ghost"],
    ["items[0].", undefined, "nor does a subscript"],
    ["let x = 1.", undefined],
    [".", undefined],
    ["", undefined],
    ["no site here", undefined],
  ];
  const bad = [];
  for (const [prefix, expected, why] of cases) {
    const got = memberReceiverName(prefix);
    if (got !== expected) {
      bad.push(`${JSON.stringify(prefix)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}${why ? ` (${why})` : ""}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

// ===========================================================================
// 2. The service wiring. Each leg is proven by its ABSENCE changing the
// verdict: a gate handed nothing still passes every pure-function test.
// ===========================================================================

const CFG = {
  apiBase: "http://x",
  model: "m",
  maxTokens: 64,
  temperature: 0.01,
  debounceMs: 0,
  prefixChars: 3000,
  suffixChars: 1000,
  multiline: true,
  cacheCapacity: 100,
};

const generator = (texts) => {
  let i = 0;
  return async () => {
    const text = texts[Math.min(i, texts.length - 1)];
    i += 1;
    return { text, ttftMs: 1, totalMs: 2 };
  };
};

// One member-site completion through the real service, with whatever the
// provider would have threaded supplied directly.
async function serve({ ghosts, injection, receiver, alternatives, lines = [] }) {
  const service = new CompletionService(CFG, generator(ghosts), (l) => lines.push(l));
  const out = await service.complete({
    prefix: "let stripe: Stripe;\nstripe.",
    suffix: "",
    manual: true,
    alternatives,
    memberSite: true,
    memberPartial: "",
    memberReceiver: receiver,
    resolveInjection: async () => injection,
  });
  service.dispose();
  return out;
}

// A single line, because a member site generates single-line by construction
// (see section 5). Line one names a real member, then invents a second.
const SAME_LINE_INVENTION = "EnrollTile(tile); stripe.Enroll(tile);";

test("the receiver reaches the gate: a second invented member access is dropped WITH the receiver and shown WITHOUT it", async () => {
  const injection = { memberNames: MEMBER_NAMES };

  const gated = await serve({ ghosts: [SAME_LINE_INVENTION], injection, receiver: "stripe" });
  assert.strictEqual(gated, undefined, "stripe.Enroll is a hallucination and the whole ghost goes with it");

  const ungated = await serve({ ghosts: [SAME_LINE_INVENTION], injection, receiver: undefined });
  assert.ok(ungated && ungated.text === SAME_LINE_INVENTION, "no receiver threaded, no reach past the leading identifier - which is what makes the threading load-bearing");
});

test("a correct call is untouched by the gate", async () => {
  const ghost = "EnrollTile(new Tile(1, 0));";
  const out = await serve({ ghosts: [ghost], injection: { memberNames: MEMBER_NAMES }, receiver: "stripe" });
  assert.ok(out && out.text === ghost, "the whole point is that this one survives");
});

test("alternate promotion still works when the membership gate rejected the primary", async () => {
  const out = await serve({
    ghosts: ["Vaporize();", "AggregateFanout();", "stripe.Enroll(tile);"],
    injection: { memberNames: MEMBER_NAMES },
    receiver: "stripe",
    alternatives: 3,
  });
  assert.ok(out, "a surviving alternate must be promoted, not swallowed with the primary");
  assert.strictEqual(out.text, "AggregateFanout();", "the invented primary yielded to the valid alternate");
  assert.strictEqual(out.alternates, undefined, "and the name-rejected alternate died with it");
});

test("no resolution means no gate at all: nothing fires when the injection never landed", async () => {
  const out = await serve({ ghosts: ["EnrollTile(new Tile(1));"], injection: undefined, receiver: "stripe" });
  assert.ok(out && out.text === "EnrollTile(new Tile(1));", "a lost race knows nothing and suppresses nothing");
});

// ===========================================================================
// 3. The provider->service path: the receiver and the signatures are things
// the PROVIDER has to build. These fire the real composition.
// ===========================================================================

function makeCursorDoc(languageId, prefix) {
  const lines = prefix.split("\n");
  const position = {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
    translate(l, c) {
      return { line: this.line + l, character: this.character + c };
    },
  };
  const doc = {
    languageId,
    version: 1,
    lineCount: lines.length,
    uri: { toString: () => `file:///a.${languageId}` },
    getText: (range) =>
      range === undefined || (range.start.line === 0 && range.start.character === 0) ? prefix : "",
    lineAt: (n) => ({ range: { end: { line: n, character: (lines[n] ?? "").length } } }),
    offsetAt: () => prefix.length,
  };
  return { doc, position };
}

const PREFIX = "let tile: Tile;\nlet stripe: Stripe;\nstripe.";

async function fire({ ghost, gateOn = true, receiver = RECEIVER_MEMBERS, argMembers = TILE_MEMBERS }) {
  globalThis.__v15GateOn = gateOn;
  globalThis.__v15GateExtractor = {
    async completeMembers() {
      return receiver;
    },
    async membersOfType() {
      return argMembers;
    },
    // `definition`, not `definitionOf`. The misspelling meant this fake never
    // implemented the primitive at all, so it silently modelled a transport that
    // cannot turn a type reference into a type definition.
    async definition() {
      return { uri: "file:///b.ts", range: { startLine: 0, startCharacter: 0, endLine: 9, endCharacter: 1 } };
    },
  };
  const prompts = [];
  const service = new CompletionService({ ...DEFAULT_FIM_CONFIG, debounceMs: 0 }, async (params) => {
    prompts.push(params.prefix);
    return { text: ghost, ttftMs: 1, totalMs: 2 };
  });
  const provider = new FimCompletionProvider(() => service, { appendLine: () => {} });
  const { doc, position } = makeCursorDoc("typescript", PREFIX);
  const items = await provider.provideInlineCompletionItems(
    doc,
    position,
    { triggerKind: 0 },
    { onCancellationRequested: () => {}, isCancellationRequested: false },
  );
  service.dispose();
  return { items, prompts };
}

test("the provider does not over-refuse a real member call: it is shown", async () => {
  const { items } = await fire({ ghost: "EnrollTile(new Tile(1, 0))" });
  assert.ok(items && items.length === 1, "dropping this would cost a real accept");
  assert.strictEqual(items[0].insertText, "EnrollTile(new Tile(1, 0))");
});

test("the provider threads the receiver it parsed from the prefix: a later stripe.NAME invention is dropped", async () => {
  const { items } = await fire({ ghost: SAME_LINE_INVENTION });
  assert.strictEqual(items, undefined, "the gate reached past the leading identifier because the receiver travelled");
});

test("column80.fimMemberGate off disables the gate, and the injection block still reaches the model", async () => {
  // The switch gates the OUTPUT only. A hallucinated member is shown untouched
  // with the gate off, and the construction block still goes into the prompt
  // regardless - that is generation signal, not gate evidence.
  const built = await fire({ ghost: "EnrollTile(new Tile(1))", gateOn: false });
  assert.ok(built.items && built.items[0].insertText === "EnrollTile(new Tile(1))", "the gate is off");
  assert.ok(
    built.prompts[0].includes("to build a Tile:"),
    "and the switch gates the OUTPUT only - the injection block still goes to the model",
  );

  const names = await fire({ ghost: SAME_LINE_INVENTION, gateOn: false });
  assert.ok(names.items && names.items[0].insertText === SAME_LINE_INVENTION, "the name gate is off too");
});

// ===========================================================================
// 4. What shape of ghost the gate actually sees. A member site generates
// SINGLE-LINE by construction, so the receiver leg's multi-line reach is a
// backstop rather than the common path. Pinned because a future multiline
// change at member sites would silently change what the gate is for.
// ===========================================================================

test("a member site collapses a multi-line generation to one line BEFORE the gate, so the gate judges the surviving line", async () => {
  const multi = "EnrollTile(new Tile(1, 0));\nstripe.Enroll(new Tile(2, 0));";
  const { items } = await fire({ ghost: multi });
  assert.ok(items && items.length === 1, "the first line is correct and survives");
  assert.strictEqual(
    items[0].insertText,
    "EnrollTile(new Tile(1, 0));",
    "the invented second line never reached the gate: the member-site single-line cap had already removed it",
  );
});
