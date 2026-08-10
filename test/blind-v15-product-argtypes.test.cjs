// BLIND ORACLE - v15 P2, the argument-type leg through the PRODUCT transports.
//
// What is under test: the three product transports the extension actually ships
// with - TsCommandExtractor (src/vscode/tsExtractor.ts), CsCommandExtractor
// (src/vscode/csExtractor.ts), PyCommandExtractor (src/vscode/pyExtractor.ts) -
// driven exactly the way real vscode drives them, plus the renderer they feed
// (renderFimCandidates in src/core/fimInject.ts). None of those files is read;
// esbuild resolves them at bundle time only. Written against the contract in
// session-v15/goal.md and session-v15/p2-surface.md.
//
// WHY THIS FILE EXISTS. P2 measured constructor arity from 0/8 to 8/8 in four
// languages, but it measured through the HEADLESS test transports. The product
// transports resolve a type's construction surface by descending
// documentSymbol, and real vscode returns those nodes with `detail: ""`. No
// detail means no signature, and the renderer drops a member with no signature.
// So in the real editor the "to build a Tile:" block is empty or absent, and
// the feature is dark exactly where it was supposed to pay. Every fixture here
// uses the empty-detail shape (the same shape
// test/impl-v9-tsextractor.test.cjs already pins as real vscode) and demands
// arity anyway.
//
// WHAT THE FAKE RUNNER OFFERS. So a fix is not boxed into one strategy, the
// fake answers BOTH of the signature sources a real transport can reach at a
// member's own position: hover (per member line, in that language's real hover
// markdown) and the document text (via the injected text reader). A transport
// that recovers arity from either passes. A transport that reads only `detail`
// fails, which is the bug.
//
// THE SEAM. goal.md build step 1 says to ride the existing `membersOfType`
// seam, so that is what these tests drive. If the fix introduces a different
// primitive for the construction surface, repoint the calls; do not weaken the
// assertion.
//
// EXPECTED RED until the fix lands. Do not relax an assertion to make one pass.
//
// Run: SKIP_LIVE=1 node --test test/blind-v15-product-argtypes.test.cjs
// (Hermetic: fake runners, no vscode, no model, no network.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v15-product-argtypes",
    `export { TsCommandExtractor } from "../src/vscode/tsExtractor";\n` +
      `export { CsCommandExtractor } from "../src/vscode/csExtractor";\n` +
      `export { PyCommandExtractor } from "../src/vscode/pyExtractor";\n` +
      `export { renderFimCandidates, lineCommentFor } from "../src/core/fimInject";\n` +
      `export { INJECTION_DEADLINE_MS } from "../src/core/completionService";\n`
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-v15-product-argtypes.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v15-product-argtypes.bundle.cjs"), { force: true });
  };
}
test.after(() => cleanup());

test("harness: the three product transports and the renderer bundle headless [any red here is a build problem, not a contract failure]", () => {
  if (bundleError) assert.fail(`the bundle does not build: ${bundleError.message}`);
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the harness test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// vscode stand-ins. Coordinates are 0-based line / UTF-16 column.
// SymbolKind here is the VSCODE numbering (0-indexed), which is what the
// command API hands a product transport: Class=4 Method=5 Property=6 Field=7
// Constructor=8 Function=11 Variable=12.
// ---------------------------------------------------------------------------

const SK = { Class: 4, Method: 5, Property: 6, Field: 7, Constructor: 8, Function: 11, Variable: 12 };

const CMD = {
  complete: "vscode.executeCompletionItemProvider",
  hover: "vscode.executeHoverProvider",
  definition: "vscode.executeDefinitionProvider",
  codeAction: "vscode.executeCodeActionProvider",
  docSymbol: "vscode.executeDocumentSymbolProvider",
};

const vr = (sl, sc, el, ec) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });

// The real vscode documentSymbol node. `detail` is PER-LANGUAGE, not universal:
// tsserver and Pylance send the EMPTY STRING and carry no signature, which is
// the bug this file exists for, while Roslyn sends the member's signature in its
// own descent dialect ("Tile(int, int)", "MortonCode : int"). The C# nodes below
// carry that captured dialect; every other node defaults to empty.
const dsym = (name, kind, range, children = [], detail = "") => ({
  name,
  detail,
  kind,
  range,
  selectionRange: vr(range.start.line, range.start.character, range.start.line, range.start.character + 1),
  children,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake command runner: per-command handlers, calls recorded, optional per-call
// delay so the latency contract can be measured.
const runnerFor = (handlers, delayMs = 0) => {
  const calls = [];
  const run = async (command, cursor, opts) => {
    calls.push({ command, cursor, opts });
    if (delayMs > 0) await sleep(delayMs);
    const h = handlers[command];
    if (h === undefined) return undefined;
    return typeof h === "function" ? h(cursor, opts) : h;
  };
  return { run, calls };
};

const hoverAnswer = (md) => [{ contents: [{ value: md }] }];

// ---------------------------------------------------------------------------
// Arity, read out of whatever signature string the transport produces. The
// contract is a parameter COUNT, not a particular rendering, so this counts
// top-level commas in the first balanced parameter list and drops the implicit
// receiver. A member that names Tile but carries no parameter list scores -1,
// which is the dark case.
// ---------------------------------------------------------------------------

const IMPLICIT_RECEIVER = /^(&\s*mut\s+self|&\s*self|self)\b/;

function paramCount(signature) {
  if (typeof signature !== "string") return -1;
  const open = signature.indexOf("(");
  if (open < 0) return -1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < signature.length; i++) {
    const c = signature[i];
    if (c === "(" || c === "<" || c === "[") depth++;
    else if (c === ")" || c === ">" || c === "]") {
      depth--;
      if (depth === 0 && c === ")") {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return -1;
  const inner = signature.slice(open + 1, close);
  const parts = [];
  let d = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(" || c === "<" || c === "[") d++;
    else if (c === ")" || c === ">" || c === "]") d--;
    else if (c === "," && d === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0 && !IMPLICIT_RECEIVER.test(p)).length;
}

// ---------------------------------------------------------------------------
// The scenario, in three languages. A Stripe receiver whose EnrollTile takes a
// Tile, and a Tile whose constructor takes TWO arguments - the second one the
// 1.5b dropped 8/8 in the scout. `new Tile(1)` must be unwritable from the
// block this produces.
// ---------------------------------------------------------------------------

const mem = (name, signature, kind = "method") => ({ name, signature, kind });

const TS_SOURCE = [
  "export class Tile {",
  "  mortonCode: number;",
  "  lod: number;",
  "  constructor(mortonCode: number, lod: number) {",
  "    this.mortonCode = mortonCode;",
  "    this.lod = lod;",
  "  }",
  "  key(): string { return `${this.mortonCode}:${this.lod}`; }",
  "  parent(): Tile { return new Tile(this.mortonCode >> 2, this.lod - 1); }",
  "  child(index: number): Tile { return new Tile(index, this.lod + 1); }",
  "  distanceTo(other: Tile): number { return other.lod - this.lod; }",
  "}",
  "",
].join("\n");

const CS_SOURCE = [
  "public class Tile",
  "{",
  "    public int MortonCode;",
  "    public int Lod;",
  "    public Tile(int mortonCode, int lod)",
  "    {",
  "        MortonCode = mortonCode;",
  "        Lod = lod;",
  "    }",
  "    public string Key() => $\"{MortonCode}:{Lod}\";",
  "    public Tile Parent() => new Tile(MortonCode >> 2, Lod - 1);",
  "    public Tile Child(int index) => new Tile(index, Lod + 1);",
  "    public int DistanceTo(Tile other) => other.Lod - Lod;",
  "}",
  "",
].join("\n");

const PY_SOURCE = [
  "class Tile:",
  "    def __init__(self, morton_code: int, lod: int) -> None:",
  "        self.morton_code = morton_code",
  "        self.lod = lod",
  "",
  "    def key(self) -> str:",
  "        return f\"{self.morton_code}:{self.lod}\"",
  "",
  "    def parent(self) -> \"Tile\":",
  "        return Tile(self.morton_code >> 2, self.lod - 1)",
  "",
  "    def child(self, index: int) -> \"Tile\":",
  "        return Tile(index, self.lod + 1)",
  "",
  "    def distance_to(self, other: \"Tile\") -> int:",
  "        return other.lod - self.lod",
  "",
].join("\n");

const LANGS = [
  {
    id: "typescript",
    extractor: "TsCommandExtractor",
    uri: "file:///fake/ws/tile.ts",
    source: TS_SOURCE,
    // The constructor is spelled `constructor` in TypeScript.
    ctorName: "constructor",
    // The cursor on the type's own name token, which is what a caller resolving
    // an argument type by name lands on.
    defCursor: { line: 0, character: 14 },
    symbols: [
      dsym("Tile", SK.Class, vr(0, 0, 11, 1), [
        dsym("mortonCode", SK.Property, vr(1, 2, 1, 22)),
        dsym("lod", SK.Property, vr(2, 2, 2, 15)),
        dsym("constructor", SK.Constructor, vr(3, 2, 6, 3)),
        dsym("key", SK.Method, vr(7, 2, 7, 60)),
        dsym("parent", SK.Method, vr(8, 2, 8, 72)),
        dsym("child", SK.Method, vr(9, 2, 9, 68)),
        dsym("distanceTo", SK.Method, vr(10, 2, 10, 66)),
      ]),
    ],
    // Real TS quickinfo markdown, per member line.
    hoverByLine: {
      1: "```typescript\n(property) Tile.mortonCode: number\n```",
      2: "```typescript\n(property) Tile.lod: number\n```",
      3: "```typescript\nconstructor Tile(mortonCode: number, lod: number): Tile\n```",
      7: "```typescript\n(method) Tile.key(): string\n```",
      8: "```typescript\n(method) Tile.parent(): Tile\n```",
      9: "```typescript\n(method) Tile.child(index: number): Tile\n```",
      10: "```typescript\n(method) Tile.distanceTo(other: Tile): number\n```",
    },
    receiver: [
      mem("enrollTile", "enrollTile(tile: Tile): boolean"),
      mem("aggregateFanout", "aggregateFanout(): number"),
    ],
  },
  {
    id: "csharp",
    extractor: "CsCommandExtractor",
    uri: "file:///fake/ws/Tile.cs",
    source: CS_SOURCE,
    // In C# the constructor is a method named the same as the type.
    ctorName: "Tile",
    defCursor: { line: 0, character: 13 },
    symbols: [
      dsym("Tile", SK.Class, vr(0, 0, 13, 1), [
        dsym("MortonCode", SK.Field, vr(2, 4, 2, 27), [], "MortonCode : int"),
        dsym("Lod", SK.Field, vr(3, 4, 3, 20), [], "Lod : int"),
        dsym("Tile", SK.Constructor, vr(4, 4, 8, 5), [], "Tile(int, int)"),
        dsym("Key", SK.Method, vr(9, 4, 9, 54), [], "Key() : string"),
        dsym("Parent", SK.Method, vr(10, 4, 10, 62), [], "Parent() : Tile"),
        dsym("Child", SK.Method, vr(11, 4, 11, 60), [], "Child(int) : Tile"),
        dsym("DistanceTo", SK.Method, vr(12, 4, 12, 56), [], "DistanceTo(Tile) : int"),
      ]),
    ],
    hoverByLine: {
      2: "```csharp\nint Tile.MortonCode\n```",
      3: "```csharp\nint Tile.Lod\n```",
      4: "```csharp\nTile.Tile(int mortonCode, int lod)\n```",
      9: "```csharp\nstring Tile.Key()\n```",
      10: "```csharp\nTile Tile.Parent()\n```",
      11: "```csharp\nTile Tile.Child(int index)\n```",
      12: "```csharp\nint Tile.DistanceTo(Tile other)\n```",
    },
    receiver: [
      mem("EnrollTile", "EnrollTile(Tile) : bool"),
      mem("AggregateFanout", "AggregateFanout() : int"),
    ],
  },
  {
    id: "python",
    extractor: "PyCommandExtractor",
    uri: "file:///fake/ws/tile.py",
    source: PY_SOURCE,
    // In Python the constructor is __init__.
    ctorName: "__init__",
    defCursor: { line: 0, character: 7 },
    symbols: [
      dsym("Tile", SK.Class, vr(0, 0, 15, 38), [
        dsym("__init__", SK.Method, vr(1, 4, 3, 21), [
          dsym("morton_code", SK.Variable, vr(2, 8, 2, 29)),
          dsym("lod", SK.Variable, vr(3, 8, 3, 16)),
        ]),
        dsym("key", SK.Method, vr(5, 4, 6, 46)),
        dsym("parent", SK.Method, vr(8, 4, 9, 56)),
        dsym("child", SK.Method, vr(11, 4, 12, 40)),
        dsym("distance_to", SK.Method, vr(14, 4, 15, 36)),
      ]),
    ],
    hoverByLine: {
      // Captured from Pylance in a real extension host, not written from an
      // assumption about the shape: the kind annotation, the explicit `self`
      // with Pylance's `Self@Tile` UI notation, and the pretty-print across
      // five lines are all what the server actually sends.
      1: "```python\n(method) def __init__(\n    self: Self@Tile,\n    morton_code: int,\n    lod: int\n) -> None\n```",
      5: "```python\ndef key(self) -> str\n```",
      8: "```python\ndef parent(self) -> Tile\n```",
      11: "```python\ndef child(self, index: int) -> Tile\n```",
      14: "```python\ndef distance_to(self, other: Tile) -> int\n```",
    },
    receiver: [
      mem("enroll_tile", "enroll_tile(self, tile: Tile) -> bool"),
      mem("aggregate_fanout", "aggregate_fanout(self) -> int"),
    ],
  },
];

const CTOR_ARITY = 2; // Tile(mortonCode, lod) - the dropped second argument is the whole bug.

// Build the pair of injected dependencies a product transport takes: the
// command runner and the text reader. Both signature sources are live.
function transportFor(lang, { symbols, delayMs = 0, hover = true } = {}) {
  const handlers = {
    [CMD.docSymbol]: symbols === undefined ? lang.symbols : symbols,
  };
  if (hover) {
    handlers[CMD.hover] = (cursor) => {
      const md = lang.hoverByLine[cursor.line];
      return md === undefined ? undefined : hoverAnswer(md);
    };
  }
  const { run, calls } = runnerFor(handlers, delayMs);
  const readText = (uri) => (uri === lang.uri ? lang.source : undefined);
  const Ctor = mod[lang.extractor];
  return { extractor: new Ctor(run, readText), calls, run, readText };
}

const cursorAt = (lang, pos) => ({ uri: lang.uri, line: pos.line, character: pos.character });
const byName = (members, name) => members.find((m) => m.name === name);
const lines = (block) => String(block).split("\n");

// The receiver-only block: what the injection must fall back to whenever the
// argument type cannot be resolved honestly.
function receiverOnly(lang) {
  return mod.renderFimCandidates(lang.receiver, "", mod.lineCommentFor(lang.id));
}

function blockWithArgType(lang, members) {
  return mod.renderFimCandidates(lang.receiver, "", mod.lineCommentFor(lang.id), [
    { name: "Tile", members },
  ]);
}

// ===========================================================================
// 1. The dark case itself: empty-detail documentSymbol must still yield ARITY.
// [goal.md "Resolve the argument types' constructors at a member site"]
// ===========================================================================

for (const lang of LANGS) {
  gtest(`${lang.id}: membersOfType over a REAL vscode documentSymbol tree (detail: "") returns a construction surface that carries signatures, not bare names [the measured-in-headless / dark-in-product gap]`, async () => {
    const { extractor } = transportFor(lang);
    const members = await extractor.membersOfType(cursorAt(lang, lang.defCursor));
    assert.ok(Array.isArray(members) && members.length > 0, `the Tile definition resolves to members, got ${JSON.stringify(members)}`);
    const signed = members.filter((m) => typeof m.signature === "string" && m.signature.length > 0);
    assert.ok(
      signed.length > 0,
      `at least one member must carry a signature, or the renderer drops the whole block and the argument-type leg is dark; got ${JSON.stringify(members)}`
    );
  });

  gtest(`${lang.id}: the CONSTRUCTOR (${lang.ctorName}) survives membersOfType and carries its full arity - a block that names Tile without saying it takes ${CTOR_ARITY} arguments is the dark case [goal.md "constructor arity 0/8"]`, async () => {
    const { extractor } = transportFor(lang);
    const members = await extractor.membersOfType(cursorAt(lang, lang.defCursor));
    const ctor = byName(members, lang.ctorName);
    assert.ok(
      ctor,
      `the member carrying construction arity must reach the block; expected ${JSON.stringify(lang.ctorName)}, got ${JSON.stringify(members.map((m) => m.name))}`
    );
    assert.ok(
      typeof ctor.signature === "string" && ctor.signature.length > 0,
      `the constructor must carry a signature, not a bare name; got ${JSON.stringify(ctor)}`
    );
    assert.strictEqual(
      paramCount(ctor.signature),
      CTOR_ARITY,
      `the constructor's signature must state ${CTOR_ARITY} parameters so \`new Tile(1)\` is unwritable from it; got ${JSON.stringify(ctor.signature)}`
    );
  });

  gtest(`${lang.id}: end to end, the injected block carries "to build a Tile:" and a ${CTOR_ARITY}-argument constructor line [p2-surface §2 rendering order]`, async () => {
    const { extractor } = transportFor(lang);
    const members = await extractor.membersOfType(cursorAt(lang, lang.defCursor));
    const block = blockWithArgType(lang, members);
    assert.ok(block !== undefined, "the receiver carries signatures, so a block must render");
    const prefix = mod.lineCommentFor(lang.id);
    const ls = lines(block);
    const iBuild = ls.indexOf(`${prefix} to build a Tile:`);
    assert.ok(iBuild >= 0, `the argument-type section must be present, not silently empty:\n${block}`);
    const after = ls.slice(iBuild + 1).map((l) => l.slice(prefix.length + 1));
    assert.ok(
      after.some((l) => paramCount(l) === CTOR_ARITY),
      `a line under "to build a Tile:" must state the constructor's ${CTOR_ARITY} arguments:\n${block}`
    );
  });
}

// ===========================================================================
// 2. Honest degradation. When the language server genuinely has nothing, the
// block falls back to receiver-only and invents no constructor and no arity.
// [goal.md "a constructor that does not resolve in budget degrades to today's
// behaviour" + p2-surface "argTypes alone never rescues"]
// ===========================================================================

for (const lang of LANGS) {
  for (const { why, symbols } of [
    { why: "the language server answers nothing", symbols: null },
    { why: "the language server answers an empty symbol list", symbols: [] },
    { why: "the language server answers a non-symbol shape", symbols: { not: "symbols" } },
  ]) {
    gtest(`${lang.id}: degradation - when ${why}, the block is EXACTLY the receiver-only block; no constructor and no arity is invented`, async () => {
      const { extractor } = transportFor(lang, { symbols, hover: false });
      const members = await extractor.membersOfType(cursorAt(lang, lang.defCursor));
      assert.deepStrictEqual(members, [], `an unresolvable type yields no members, never a guess; got ${JSON.stringify(members)}`);
      const block = blockWithArgType(lang, members);
      assert.strictEqual(
        block,
        receiverOnly(lang),
        `an unresolved argument type must leave the receiver-only block byte-identical:\n${block}`
      );
      assert.ok(!String(block).includes("to build a"), `no bare or fabricated construction section:\n${block}`);
    });
  }

  gtest(`${lang.id}: degradation - a cursor that lands on no type at all resolves to no members and falls back to the receiver-only block`, async () => {
    const { extractor } = transportFor(lang);
    // Far past the end of the fixture: nothing encloses it.
    const members = await extractor.membersOfType({ uri: lang.uri, line: 400, character: 0 });
    assert.deepStrictEqual(members, [], `nothing encloses the cursor, so nothing is claimed; got ${JSON.stringify(members)}`);
    assert.strictEqual(blockWithArgType(lang, members), receiverOnly(lang), "the fallback is today's behaviour, unchanged");
  });
}

// ===========================================================================
// 3. The latency contract. The argument-type leg rides a sub-budget of the
// injection deadline. Buying signatures by blowing that budget is not a fix.
// [goal.md "the 50ms injection race" + "never blocks a keystroke"]
// ===========================================================================

const PER_CALL_MS = 15; // one round trip to a language server, in the fixture

for (const lang of LANGS) {
  gtest(`${lang.id}: latency - an argument-type resolution that NEVER returns still yields the receiver-only block, and never throws [degrade, do not block the keystroke]`, async () => {
    const never = async () => new Promise(() => {});
    const Ctor = mod[lang.extractor];
    const extractor = new Ctor(never, (uri) => (uri === lang.uri ? lang.source : undefined));
    const pending = extractor.membersOfType(cursorAt(lang, lang.defCursor));
    // The consumer races the resolution against its sub-budget; a hung server
    // must lose that race rather than hang the completion.
    const raced = await Promise.race([pending.then((m) => m).catch(() => []), sleep(60).then(() => "timeout")]);
    assert.strictEqual(raced, "timeout", "a hung language server must not resolve the leg; the race is the whole safety net");
    const block = blockWithArgType(lang, []);
    assert.strictEqual(block, receiverOnly(lang), "a timed-out argument type degrades to the receiver-only block");
    pending.catch(() => {});
  });

  gtest(`${lang.id}: latency - resolving the construction surface fans out, it does not serialize one round trip per member; the whole call fits the injection deadline`, async () => {
    const { extractor, calls } = transportFor(lang, { delayMs: PER_CALL_MS });
    const startedAt = Date.now();
    const members = await extractor.membersOfType(cursorAt(lang, lang.defCursor));
    const elapsed = Date.now() - startedAt;
    assert.ok(members.length > 0, "the fixture resolves members; this test is about how long that took");
    assert.ok(
      elapsed < mod.INJECTION_DEADLINE_MS,
      `the construction surface must resolve inside the injection deadline (${mod.INJECTION_DEADLINE_MS}ms); ` +
        `took ${elapsed}ms over ${calls.length} language-server calls at ${PER_CALL_MS}ms each, which is a serialized per-member fetch`
    );
  });
}
