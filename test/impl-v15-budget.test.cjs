// Implementer oracle for the v15 injection BUDGET: what the member-site
// resolution closure owes the service when the argument-type leg is slow or
// the receiver block was never going to render.
//
// The receiver's members and the enforcement set (`memberNames`) are resolved
// FIRST and are never forfeit. Everything the argument-type leg adds is
// best-effort: it may be absent, it may never be attempted, and neither
// outcome may cost the member gate — losing the gate turns a hallucinated
// ghost into a shown ghost, which is worse than injecting nothing at all.
//
// These drive the whole provider->service path (real CompletionService, real
// gate, stubbed extractor and model) because the defect only exists in the
// composition: each part is correct alone.
//
// Run: SKIP_LIVE=1 node --test test/impl-v15-budget.test.cjs
// (Hermetic: a vscode stub, a fake extractor, a fake generate, no network.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const STUB = path.join(__dirname, ".impl-v15-budget-vscode-stub.cjs");
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
    // One alternative keeps the fan-out to a single generate call, so a test
    // reads exactly one model prompt.
    getConfiguration: () => ({ get: (k, d) => (k === "fimAlternatives" ? 1 : d) }),
    textDocuments: [],
    // The whole-block walk reads def files through openTextDocument; a test
    // stocks __v15Files with the sources it wants reachable.
    openTextDocument: async (uri) => {
      const text = (globalThis.__v15Files || {})[uri.toString()];
      if (text === undefined) { throw new Error("no such file"); }
      return { getText: () => text };
    },
  },
  InlineCompletionItem: class { constructor(text, range) { this.insertText = text; this.range = range; } },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  ThemeColor: class {}, MarkdownString: class {}, EventEmitter: class {},
};\n`
);

// The extractor REGISTRY is stubbed, not the extractor transport: the test
// needs the provider's own resolution ladder and gate wiring, with a language
// server it can make slow on demand.
const REGISTRY_STUB = path.join(__dirname, ".impl-v15-budget-registry.ts");
fs.writeFileSync(
  REGISTRY_STUB,
  `export function extractorFor(_languageId: string): any {
  return (globalThis as any).__v15Extractor;
}\n`
);

const entry = path.join(__dirname, ".impl-v15-budget.entry.ts");
const outfile = path.join(__dirname, ".impl-v15-budget.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { FimCompletionProvider } from "../src/vscode/completionProvider";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`
);
// Redirecting a RELATIVE import needs an esbuild plugin, and esbuild rejects
// plugins in its synchronous API — so the build runs in a child process, which
// keeps the require below synchronous.
const buildScript = path.join(__dirname, ".impl-v15-budget.build.cjs");
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
const { FimCompletionProvider, CompletionService, DEFAULT_FIM_CONFIG } = require(outfile);

test.after(() => {
  [STUB, REGISTRY_STUB, entry, outfile, buildScript].forEach((f) => fs.rmSync(f, { force: true }));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mem = (name, signature, kind = "method") => ({ name, signature, kind });

// The measured scenario: a receiver whose member takes a type the model has to
// construct, and whose arity it gets wrong without the argument type's surface.
const RECEIVER_MEMBERS = [mem("EnrollTile", "EnrollTile(Tile) : bool")];
const TILE_MEMBERS = [mem("Tile", "Tile(int mortonCode, int lod)", "constructor")];

function makeDoc(languageId, text) {
  const lines = text.split("\n");
  return {
    languageId,
    version: 1,
    lineCount: lines.length,
    uri: { toString: () => "file:///a.ts" },
    getText: (range) => (range ? text.slice(0, text.length) : text),
    lineAt: (n) => ({ range: { end: { line: n, character: lines[n].length } } }),
    offsetAt: () => text.length,
  };
}

// The provider reads the prefix as getText(0,0 .. position) and the suffix as
// getText(position .. eof); a cursor at the very end makes both trivially the
// whole text and the empty string.
// `wholeReadCostMs` pins the cost of the WHOLE-document read (getText with no
// range) to wall clock rather than to the machine's string throughput, so a
// test about a synchronous prologue measures the same prologue everywhere. The
// ranged read the provider makes for the prefix is untouched: it happens before
// the injection window opens and is not part of what the budget covers.
function makeCursorDoc(languageId, prefix, wholeReadCostMs = 0) {
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
    getText: (range) => {
      if (range !== undefined) {
        return range.start.line === 0 && range.start.character === 0 ? prefix : "";
      }
      const until = Date.now() + wholeReadCostMs;
      while (Date.now() < until) {
        /* a large document does not read for free, and it does not yield while it reads */
      }
      return prefix;
    },
    lineAt: (n) => ({ range: { end: { line: n, character: (lines[n] ?? "").length } } }),
    offsetAt: () => prefix.length,
  };
  return { doc, position };
}

// Records what the model was actually given, which is the only honest witness
// that the receiver block survived the argument-type leg.
function makeGenerate(text) {
  const prompts = [];
  return {
    prompts,
    fn: async (params) => {
      prompts.push(params.prefix);
      return { text, ttftMs: 1, totalMs: 2 };
    },
  };
}

// A full fire through provideInlineCompletionItems: the real service, the real
// 50ms race, the real member gate.
async function fire({ languageId = "typescript", prefix, extractor, ghost, wholeReadCostMs = 0 }) {
  globalThis.__v15Extractor = extractor;
  const generate = makeGenerate(ghost);
  const service = new CompletionService(
    { ...DEFAULT_FIM_CONFIG, debounceMs: 0 },
    generate.fn,
  );
  const provider = new FimCompletionProvider(() => service, { appendLine: () => {} });
  const { doc, position } = makeCursorDoc(languageId, prefix, wholeReadCostMs);
  const items = await provider.provideInlineCompletionItems(
    doc,
    position,
    { triggerKind: 0 },
    { onCancellationRequested: () => {}, isCancellationRequested: false },
  );
  service.dispose();
  return { items, prompts: generate.prompts };
}

// A fake extractor whose argument-type leg (membersOfType) can be made
// arbitrarily slow, which is the whole point: the receiver leg is fast and
// must never wait behind it.
function makeExtractor({ receiver = RECEIVER_MEMBERS, argMembers = TILE_MEMBERS, argDelayMs = 0 } = {}) {
  const calls = { completeMembers: 0, membersOfType: 0 };
  return {
    calls,
    async completeMembers() {
      calls.completeMembers++;
      return receiver;
    },
    // The reference-to-definition hop the argument-type leg now makes. It is
    // deliberately free here: `argDelayMs` models the members read, which is the
    // call this file's budget assertions are about.
    async definition() {
      return { uri: "file:///tile-def.ts", range: { startLine: 0, startCharacter: 6, endLine: 12, endCharacter: 1 } };
    },
    async membersOfType() {
      calls.membersOfType++;
      await sleep(argDelayMs);
      return argMembers;
    },
  };
}

// The document mentions Tile in code so the same-file anchor resolves without a
// workspace-symbol leg.
const PREFIX = "let tile: Tile;\nlet stripe: Stripe;\nstripe.";

// ===========================================================================
// 1. The argument-type leg gets its own sub-budget. The receiver's block and
// its memberNames are resolved before it and are never forfeit to it.
// ===========================================================================

test("a SLOW argument-type leg still delivers the receiver block AND the member gate: the hallucinated ghost is dropped", async () => {
  const extractor = makeExtractor({ argDelayMs: 200 });
  // `Enroll(` is a proper prefix of `EnrollTile` followed by a non-identifier
  // char - a finished, invented name. The gate exists to drop exactly this.
  const { items, prompts } = await fire({ prefix: PREFIX, extractor, ghost: "Enroll(tile)" });

  assert.strictEqual(prompts.length, 1, "one generation happened");
  assert.ok(
    prompts[0].includes("use one of these exact names"),
    "the receiver-only block reached the model despite the slow argument-type leg",
  );
  assert.ok(prompts[0].includes("EnrollTile(Tile) : bool"), "with the receiver's member signatures");
  assert.ok(
    !prompts[0].includes("to build a Tile:"),
    "and WITHOUT the argument-type section, which did not resolve in budget",
  );
  // A gated-away ghost leaves nothing to show, so the provider yields no item
  // at all. A SHOWN `Enroll(tile)` here is the gate never having run.
  assert.strictEqual(
    items,
    undefined,
    "memberNames travelled, so the gate ran and dropped the hallucination",
  );
});

test("a FAST argument-type leg still produces the `to build a X:` section", async () => {
  const extractor = makeExtractor({ argDelayMs: 5 });
  const { prompts } = await fire({ prefix: PREFIX, extractor, ghost: "EnrollTile(new Tile(1, 2))" });
  assert.ok(prompts[0].includes("to build a Tile:"), "the measured arity fix is intact");
  assert.ok(prompts[0].includes("Tile(int mortonCode, int lod)"), "with the constructor's real arity");
});

// ===========================================================================
// 2. The sub-budget must be charged the leg's own SYNCHRONOUS prologue.
// resolveArgTypes reads the whole document and scans it for a type anchor
// before it ever awaits, so a budget whose clock starts after that work has
// already run overruns the service's injection deadline by the size of the
// prologue. On a large document that is enough to lose the whole injection —
// and with it memberNames, which silently switches the hallucination gate off.
// ===========================================================================

// ~6MB, with the anchor type near the top: the anchor scan still makes one full
// pass looking for an import line, and that pass plus the document read is the
// prologue that must be charged against the budget rather than added to it.
const BIG_PREFIX = (() => {
  const filler = "const pad = 0; padding so the anchor scan is a full pass\n";
  const repeats = Math.ceil(6_000_000 / filler.length);
  return `let tile: Tile;\n${filler.repeat(repeats)}let stripe: Stripe;\nstripe.`;
})();

// Comfortably over the deadline margin (so a budget timed from after the
// prologue always overruns) and comfortably under the budget itself (so a
// budget timed from before it always lands), leaving neither verdict to the
// machine's mood.
const BIG_READ_MS = 25;

// Intermittent by nature: the overrun depends on how the prologue lands against
// the deadline, so one run proves nothing either way.
const BIG_RUNS = 12;

test(`a slow argument-type leg on a ~6MB document keeps the receiver block and the member gate across ${BIG_RUNS} runs`, async () => {
  const failures = [];
  for (let run = 0; run < BIG_RUNS; run++) {
    const extractor = makeExtractor({ argDelayMs: 200 });
    const { items, prompts } = await fire({
      prefix: BIG_PREFIX,
      extractor,
      ghost: "Enroll(tile)",
      wholeReadCostMs: BIG_READ_MS,
    });
    const problems = [];
    if (!prompts[0].includes("use one of these exact names")) {
      problems.push("the receiver block never reached the model");
    }
    if (!prompts[0].includes("EnrollTile(Tile) : bool")) {
      problems.push("the receiver's member signatures were lost");
    }
    if (prompts[0].includes("to build a Tile:")) {
      problems.push("a 200ms leg landed inside a sub-50ms budget");
    }
    if (items !== undefined) {
      problems.push("memberNames was lost, so the gate never ran and the hallucination is shown");
    }
    if (problems.length > 0) {
      failures.push(`run ${run}: ${problems.join("; ")}`);
    }
  }
  assert.deepStrictEqual(failures, [], `every run must degrade to the receiver-only block:\n${failures.join("\n")}`);
});

// ===========================================================================
// 3. The receiver block is rendered BEFORE argument types are resolved. A
// receiver set the render throws away must cost zero language-server round
// trips - and must still carry the enforcement set.
// ===========================================================================

// A runaway set - far wider than one receiver's surface, so the render throws
// it away whole rather than truncating it, and every argument-type round trip
// spent on it buys nothing.
const RUNAWAY_RECEIVER = Array.from({ length: 60 }, (_, i) => mem(`Take${i}`, `Take${i}(Tile) : void`));

test("a runaway receiver set resolves NO argument types, and the member gate still fires", async () => {
  const extractor = makeExtractor({ receiver: RUNAWAY_RECEIVER });
  const { items, prompts } = await fire({ prefix: PREFIX, extractor, ghost: "Enroll(tile)" });

  assert.strictEqual(
    extractor.calls.membersOfType,
    0,
    "no block will render, so the argument-type leg must not be paid for at all",
  );
  assert.ok(!prompts[0].includes("use one of these exact names"), "and nothing was injected");
  assert.strictEqual(
    items,
    undefined,
    "memberNames still travelled without a block, so the gate dropped the hallucination",
  );
});

// ===========================================================================
// 4. The whole-block renderer's comment token follows the document's language.
// A `//` block in a .py buffer is a syntax error at exactly the sites the
// whole-block gesture fires.
// ===========================================================================

// A whole-block resolution needs a def file to walk into, a hover for the
// type's shape and a member list for its methods. Minimal but real: the
// provider's own ladder runs, only the language server is faked.
function makeShapeExtractor(defUri) {
  return {
    async completeMembers() {
      return [];
    },
    async definition() {
      return { uri: defUri, range: { startLine: 0, startCharacter: 6 } };
    },
    async hoverSurface() {
      return { signature: "class Stripe" };
    },
    async membersOfType() {
      return [mem("enroll_tile", "enroll_tile(self, tile: Tile) -> bool")];
    },
  };
}

async function wholeBlockFor(languageId, docText, defUri, defText) {
  globalThis.__v15Files = { [`file:///a.${languageId}`]: docText, [defUri]: defText };
  const doc = {
    languageId,
    version: 1,
    uri: { toString: () => `file:///a.${languageId}` },
    getText: () => docText,
  };
  const provider = new FimCompletionProvider(() => ({}), { appendLine: () => {} });
  return provider.resolveWholeBlock(doc, makeShapeExtractor(defUri), ["Stripe"]);
}

test("a whole-block injection resolved for a PYTHON document is commented with `#`, never `//`", async () => {
  const block = await wholeBlockFor(
    "python",
    "from atlas import Stripe\n",
    "file:///atlas.py",
    "class Stripe:\n    def enroll_tile(self, tile): ...\n",
  );
  assert.ok(block !== undefined, "the walk resolved something to inject");
  assert.ok(!block.includes("//"), `a Python buffer must receive no // comment; got:\n${block}`);
  for (const line of block.split("\n")) {
    assert.ok(line.startsWith("#"), `every line is a Python comment; got ${JSON.stringify(line)}`);
  }
});

test("a whole-block injection for RUST is unchanged - still `//` on every line", async () => {
  const block = await wholeBlockFor(
    "rust",
    "use atlas::Stripe;\n",
    "file:///atlas.rs",
    "pub struct Stripe { pub id: u32 }\n",
  );
  assert.ok(block !== undefined, "the walk resolved something to inject");
  for (const line of block.split("\n")) {
    assert.ok(line.startsWith("//"), `every line stays a C-family comment; got ${JSON.stringify(line)}`);
  }
});
