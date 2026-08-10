// IMPLEMENTATION rows - session-v48 phases 2 + 3: the window arbitration, the
// refusal, and the dropped edges.
//
// WHITE-BOX, and deliberately so: these rows know that the decision is
// `arbitratePrompt` in src/core/promptBudget.ts (pure, no editor, no config),
// that the numbers come from `fnGenPromptShare` in src/core/prompt.ts, that
// `FnGenService.generate` is where the two meet, that the frontier exemption is
// spelled as an ABSENT `numCtx`, and that `resolvePrefill` hands the service a
// re-render rather than a string to slice. The BLACK-BOX promise is
// test/blind-v48-p2-arbitration.test.cjs, written against contract-phase2.md by
// an oracle that never read the implementation.
//
// Sections:
//   A - the estimate: chars/4, rounded UP, per part, and total on bad input.
//   B - the share: developer + injected + fixed is EXACTLY the prompt's length,
//       for every prompt shape the assembler can produce.
//   C - the pure ladder: exempt / fits / shrink / refuse, its boundary, and
//       that the shrink keeps the LARGEST prefix that fits.
//   D - the fallback split: fence-aware, so a surface with a blank line inside
//       a fence is never cut in half.
//   E - the service seam: the caller's re-render is preferred, the frontier
//       exemption is the absent numCtx, and both frontier service arms delete
//       it because it reaches nothing.
//   F - resolvePrefill's shrink handle: keep(full) is byte-identical to the
//       returned surface, keep(n) narrows the instruction's ONLY list with it.
//   G - phase 3: droppedBy's causes, the per-gesture ledger, the 12-name bound.
//
// Run: SKIP_LIVE=1 node --test test/impl-v48-p2-arbitration.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness. Same mechanics as impl-v48-p1: a structural vscode stub whose
// getConfiguration is driven by a process global, so a row can put a real
// setting in front of the resolver.
// ===========================================================================

const STUB = path.join(__dirname, ".impl-v48-p2-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
  with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(p) {
    const ps = p.start ? p.start : p, pe = p.end ? p.end : p;
    const geS = ps.line > this.start.line || (ps.line === this.start.line && ps.character >= this.start.character);
    const leE = pe.line < this.end.line || (pe.line === this.end.line && pe.character <= this.end.character);
    return geS && leE;
  }
  with(s, e) { return new Range(s || this.start, e || this.end); }
}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection: class extends Range {}, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => {
      const c = globalThis.__V48P2I_CFG__ || {};
      return { get: (k, f) => (c[k] !== undefined ? c[k] : f), has: () => false, inspect: () => undefined, update: async () => {} };
    },
    openTextDocument: (arg) => {
      const files = globalThis.__V48P2I_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".impl-v48-p2.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v48-p2.bundle.cjs");
let M;
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    [
      `export { assembleFnGenPrompt, fnGenPromptShare, SECTION_SEPARATOR } from "../src/core/prompt";`,
      `export { arbitratePrompt, availablePromptTok, countNonAsciiChars, estimatePromptTok, estimateTextTok,`,
      `  isPromptWindowError, joinInjectedUnits, promptRefusalChannelLine, promptRefusalMessage,`,
      `  promptShrinkChannelLine, splitInjectedUnits, PROMPT_ASCII_CHARS_PER_TOK,`,
      `  PROMPT_NON_ASCII_TOK_PER_CHAR, PROMPT_TEMPLATE_TOK } from "../src/core/promptBudget";`,
      `export { FnGenService } from "../src/core/fnGenService";`,
      `export { walkDataShape } from "../src/core/dataShape";`,
      `export { resolvePrefill } from "../src/vscode/fnGen";`,
      `export { readFnGenConfig } from "../src/vscode/config";`,
      `export { buildFnGenService } from "../src/vscode/fnGen";`,
      "",
    ].join("\n"),
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  M = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
const V = (() => { try { return require(STUB); } catch { return undefined; } })();
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("bundle guard: every seam these rows bind to builds headless", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  for (const n of ["arbitratePrompt", "fnGenPromptShare", "FnGenService", "resolvePrefill", "splitInjectedUnits"]) {
    assert.equal(typeof M[n], "function", `${n} must be exported`);
  }
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

const NUM_CTX = 16384;
const MAX_TOKENS = 2048;
const AVAILABLE = NUM_CTX - MAX_TOKENS;

// ===========================================================================
// A. THE ESTIMATE.
// ===========================================================================

// CHANGED by the adversarial-review D6 loop-back. These three rows pinned
// chars/4 (`PROMPT_CHARS_PER_TOK === 4`, `estimatePromptTok(400) === 100`).
// Review D6 measured that 4 UNDER-estimates - the one direction the contract
// forbids - on dense source (nearer 3 chars/token than 4) and catastrophically
// on non-ASCII text (a CJK prompt of 25355 UTF-16 units is ~25k real tokens and
// estimated 6339). The rate is now 3 chars/token for ASCII and a whole token per
// non-ASCII unit, so the rows assert the new arithmetic.
btest("A1: the proxy is ASCII chars/3, chosen to survive dense source rather than prose", () => {
  assert.equal(M.PROMPT_ASCII_CHARS_PER_TOK, 3);
  assert.equal(M.PROMPT_NON_ASCII_TOK_PER_CHAR, 1);
  assert.equal(M.estimatePromptTok(400), 134);
});

btest("A2: it rounds UP, because under-estimating is the one direction the contract forbids", () => {
  // A truncation ollama performs in silence is unrecoverable; a refusal says so.
  assert.equal(M.estimatePromptTok(1), 1, "one character still costs a token");
  assert.equal(M.estimatePromptTok(4), 2);
  assert.equal(M.estimatePromptTok(301), 101);
});

btest("A3: rounding each part separately can only over-state the total, never under-state it", () => {
  // The property the arbitration relies on: sum(ceil(part/3)) >= ceil(sum/3).
  for (const parts of [[1, 1, 1], [3, 3, 3], [1000, 999, 7], [0, 0, 1], [4093, 4094, 4095]]) {
    const perPart = parts.reduce((n, p) => n + M.estimatePromptTok(p), 0);
    const whole = Math.ceil(parts.reduce((a, b) => a + b, 0) / 3);
    assert.ok(perPart >= whole, `${JSON.stringify(parts)}: per-part ${perPart} < whole ${whole}`);
  }
});

// ADDED by the D6 loop-back.
btest("A6 [D6]: a non-ASCII character costs a whole token, not a quarter of one", () => {
  // Measured in the review: an ASCII, a CJK and an emoji prompt of the SAME
  // 25355 UTF-16 units estimated identically, while a Qwen-class BPE encodes CJK
  // at roughly one token per character. Same length, very different cost.
  const ascii = "a".repeat(300);
  const cjk = "数".repeat(300);
  assert.equal(M.estimateTextTok(ascii), 100);
  assert.equal(M.estimateTextTok(cjk), 300, "one token per CJK character, not 100");
  assert.ok(M.estimateTextTok(cjk) > M.estimateTextTok(ascii), "same length must NOT mean same estimate");
  // An astral character is two UTF-16 units and is charged two tokens. Over, not
  // under - which is the safe direction.
  assert.equal(M.estimateTextTok("🙂"), 2);
  assert.equal(M.countNonAsciiChars("aé漢"), 2);
});

btest("A7 [D6]: a length-only estimate charges the ASCII rate, so a caller holding the text must use estimateTextTok", () => {
  const cjk = "数".repeat(300);
  assert.equal(M.estimatePromptTok(cjk.length), 100, "a bare length cannot see the characters");
  assert.equal(M.estimateTextTok(cjk), 300, "and this is why nothing on the prompt path passes a bare length");
  // Rubbish non-ASCII counts are clamped, never believed.
  assert.equal(M.estimatePromptTok(300, 9999), 300);
  assert.equal(M.estimatePromptTok(300, -5), 100);
  assert.equal(M.estimatePromptTok(300, NaN), 100);
});

btest("A8 [D6]: the chat template allowance is charged to `fixed` by the service, not by the ladder", async () => {
  // The prompt STRING does not contain the template - the server's Modelfile
  // wraps the turn - so no character count can see it. The ladder stays pure
  // arithmetic over the numbers it is handed; the service adds the allowance.
  assert.ok(M.PROMPT_TEMPLATE_TOK > 0, "an allowance of zero is the old under-estimate with a name");
  assert.ok(M.PROMPT_TEMPLATE_TOK < AVAILABLE / 100, "and it must be far too small to refuse a real prompt");
  // Driven: a prompt padded to EXACTLY fill the window on the character
  // estimate alone. It fits without the allowance and is refused with it, so the
  // allowance is demonstrably charged rather than merely exported.
  const block = bigBlock(0, 40000);
  const probe = M.fnGenPromptShare({ signature: SIG, languageId: "rust", contextBlocks: [block] });
  const devTok = M.estimatePromptTok(probe.developerChars, probe.developerNonAscii);
  const fixedTok = M.estimatePromptTok(probe.fixedChars, probe.fixedNonAscii);
  const padTok = AVAILABLE - devTok - fixedTok;
  assert.ok(padTok > 0, `fixture bug: the unpadded prompt must be under the window (${devTok + fixedTok} vs ${AVAILABLE})`);
  // A multiple of 3 ASCII characters moves the estimate by exactly padTok. The
  // pad keeps the block's trailing newline, because the renderer adds one to a
  // block that lost it and that lone character is the difference between this
  // fixture landing on the boundary and one past it.
  const exact = { ...block, text: block.text + "d".repeat(padTok * 3 - 1) + "\n" };
  const filled = M.fnGenPromptShare({ signature: SIG, languageId: "rust", contextBlocks: [exact] });
  assert.equal(
    M.estimatePromptTok(filled.developerChars, filled.developerNonAscii) +
      M.estimatePromptTok(filled.fixedChars, filled.fixedNonAscii),
    AVAILABLE,
    "fixture: the characters alone exactly fill the window",
  );
  const r = await runService(svcCfg(), { signature: SIG, languageId: "rust", contextBlocks: [exact] });
  assert.equal(r.calls.length, 0, "the template allowance is what tips this one over");
  assert.ok(M.isPromptWindowError(r.error));
});

btest("A4: total on rubbish - a negative, a NaN and an Infinity all answer without throwing", () => {
  assert.equal(M.estimatePromptTok(-100), 0);
  assert.equal(M.estimatePromptTok(NaN), 0);
  assert.equal(M.estimatePromptTok(Infinity), 0, "a non-finite size is not a token count");
  assert.equal(M.availablePromptTok(NaN, NaN), 0);
});

btest("A5: the window is numCtx - maxTokens, and it floors at zero rather than going negative", () => {
  assert.equal(M.availablePromptTok(NUM_CTX, MAX_TOKENS), AVAILABLE);
  assert.equal(M.availablePromptTok(16384, 64000), 0, "a frontier ceiling against a local window is not a negative budget");
});

// ===========================================================================
// B. THE SHARE. It is EXACT on characters; chars/4 is the only proxy.
// ===========================================================================

const BLOCK = (i, n = 40) => ({
  uri: `file:///work/b${i}.rs`,
  range: { startLine: 1, endLine: 3 },
  text: `// block ${i}\nfn b${i}() { ${"x".repeat(n)} }\n`,
});
const SURFACE = "Data shape of `Root` (fields and types, nested):\n```rust\npub struct Root { a: u32 }\n```";

const SHAPES = [
  { signature: "fn f()" },
  { signature: "fn f()", docComment: "/// doc" },
  { signature: "fn f()", docComment: "/// doc", languageId: "rust" },
  { signature: "fn f()", contextBlocks: [BLOCK(0)] },
  { signature: "fn f()", contextBlocks: [BLOCK(0), BLOCK(1), BLOCK(2)] },
  { signature: "fn f()", injectedSurface: SURFACE },
  { signature: "fn f()", contextBlocks: [BLOCK(0)], injectedSurface: SURFACE, noPunt: true, languageId: "rust" },
  { signature: "class C", kind: "class", languageId: "typescript", injectedSurface: SURFACE },
  { signature: "def f():", bodyOnly: true, languageId: "python", docComment: '"""d"""' },
  { signature: "fn f()", localSymbols: ["A", "B"], scaffoldComments: ["step 1", "step 2"], languageId: "rust" },
  { signature: "fn f()", contextBlocks: [BLOCK(0)], localSymbols: ["A"], scaffoldComments: ["s"], injectedSurface: SURFACE, kind: "enum", languageId: "rust" },
];

for (const [i, input] of SHAPES.entries()) {
  btest(`B${i + 1}: the three shares sum to EXACTLY the assembled prompt's length`, () => {
    const s = M.fnGenPromptShare(input);
    const prompt = M.assembleFnGenPrompt(input);
    assert.equal(
      s.developerChars + s.injectedChars + s.fixedChars,
      prompt.length,
      `share must account for every byte of the prompt: ${JSON.stringify(s)} vs ${prompt.length}`,
    );
  });
}

btest("B12: the developer share is exactly the rendered context blocks, and grows only with them", () => {
  const base = M.fnGenPromptShare({ signature: "fn f()" });
  const one = M.fnGenPromptShare({ signature: "fn f()", contextBlocks: [BLOCK(0)] });
  const two = M.fnGenPromptShare({ signature: "fn f()", contextBlocks: [BLOCK(0), BLOCK(1)] });
  assert.equal(base.developerChars, 0);
  assert.ok(one.developerChars > 0);
  assert.ok(two.developerChars > one.developerChars);
  assert.equal(one.injectedChars, 0, "no surface means no injected share");
  // Separators are charged to fixed, so adding a block moves fixed too - by the
  // separator alone, never by the block's bytes.
  assert.equal(two.fixedChars - one.fixedChars, M.SECTION_SEPARATOR.length);
});

btest("B13: the injected share is exactly the surface string handed in", () => {
  const s = M.fnGenPromptShare({ signature: "fn f()", injectedSurface: SURFACE });
  assert.equal(s.injectedChars, SURFACE.length);
});

btest("B14: counting a prompt never changes it - the assembler is untouched by the share", () => {
  for (const input of SHAPES) {
    const before = M.assembleFnGenPrompt(input);
    M.fnGenPromptShare(input);
    assert.equal(M.assembleFnGenPrompt(input), before, "assembly must be deterministic across a counting pass");
  }
});

// ===========================================================================
// C. THE PURE LADDER.
// ===========================================================================

const arb = (o = {}) =>
  M.arbitratePrompt({
    windowed: true,
    numCtx: NUM_CTX,
    maxTokens: MAX_TOKENS,
    developerTok: 0,
    fixedTok: 0,
    injectedBlocks: 0,
    injectedTokFor: () => 0,
    ...o,
  });

// Blocks of a fixed size, so a row can say exactly how many must survive.
const linear = (perBlock) => (keep) => keep * perBlock;

btest("C1 [rung 1]: not windowed decides nothing at all - no numbers come back to be printed", () => {
  const d = M.arbitratePrompt({
    windowed: false,
    numCtx: NUM_CTX,
    maxTokens: MAX_TOKENS,
    developerTok: 999999,
    fixedTok: 999999,
    injectedBlocks: 10,
    injectedTokFor: () => { throw new Error("the frontier path must not take an estimate"); },
  });
  assert.deepEqual(d, { verdict: "exempt" });
});

btest("C2 [rung 2]: everything fitting is `fits`, and it reports the whole injected surface", () => {
  const d = arb({ developerTok: 100, fixedTok: 50, injectedBlocks: 4, injectedTokFor: linear(10) });
  assert.equal(d.verdict, "fits");
  assert.equal(d.injectedTok, 40);
  assert.equal(d.totalTok, 190);
  assert.equal(d.availableTok, AVAILABLE);
});

btest("C3 [rung 2]: the boundary is inclusive - exactly filling the window fits", () => {
  const d = arb({ developerTok: AVAILABLE - 1, fixedTok: 1, injectedBlocks: 0, injectedTokFor: () => 0 });
  assert.equal(d.verdict, "fits", "'<= available' is the contract's own comparison");
  assert.equal(arb({ developerTok: AVAILABLE, fixedTok: 1 }).verdict, "refuse", "one token past it is not");
});

btest("C4 [rung 3]: a shrink keeps the LARGEST prefix that fits, not the first one it tries", () => {
  // 10 blocks of 1000 against 14336 - 4336 = 10000 available for injection.
  const d = arb({ developerTok: 4000, fixedTok: 336, injectedBlocks: 20, injectedTokFor: linear(1000) });
  assert.equal(d.verdict, "shrink");
  assert.equal(d.keptBlocks, 10, "10 x 1000 = 10000 exactly fills what is left");
  assert.equal(d.droppedBlocks, 10);
  assert.equal(d.injectedTokBefore, 20000);
  assert.equal(d.injectedTok, 10000);
  assert.equal(d.totalTok, AVAILABLE);
});

btest("C5 [rung 3]: the developer's share and the fixed part are byte-for-byte the same before and after", () => {
  const d = arb({ developerTok: 4000, fixedTok: 336, injectedBlocks: 20, injectedTokFor: linear(1000) });
  assert.equal(d.developerTok, 4000, "theirs shrinks nothing");
  assert.equal(d.fixedTok, 336, "the gesture is meaningless without the fixed part");
});

btest("C6 [rung 3]: a shrink all the way to ZERO injected types is still a shrink, not a refusal", () => {
  const d = arb({ developerTok: AVAILABLE, fixedTok: 0, injectedBlocks: 3, injectedTokFor: linear(1) });
  assert.equal(d.verdict, "shrink");
  assert.equal(d.keptBlocks, 0);
  assert.equal(d.injectedTok, 0);
});

btest("C7 [rung 4]: refusing is decided on developer + fixed alone - what our share was does not enter it", () => {
  const d = arb({ developerTok: AVAILABLE, fixedTok: 1, injectedBlocks: 5, injectedTokFor: linear(100) });
  assert.equal(d.verdict, "refuse");
  assert.equal(d.injectedTok, 0, "at refusal time our share IS zero and the numbers must say so");
  assert.equal(d.droppedBlocks, 5);
  assert.equal(d.injectedTokDropped, 500, "and what we gave up is carried, so the message can be honest about it");
  assert.equal(d.totalTok, AVAILABLE + 1, "the total quoted is the one that did not fit at zero injection");
});

btest("C8 [rung 4]: with no injection to give up at all, the refusal still reports a zero share", () => {
  const d = arb({ developerTok: AVAILABLE + 5, fixedTok: 0, injectedBlocks: 0, injectedTokFor: () => 0 });
  assert.equal(d.verdict, "refuse");
  assert.equal(d.injectedTok, 0);
  assert.equal(d.injectedTokDropped, 0);
});

btest("C9: the message and the channel line quote the SAME arithmetic", () => {
  const d = arb({ developerTok: AVAILABLE + 5, fixedTok: 0, injectedBlocks: 2, injectedTokFor: linear(100) });
  const msg = M.promptRefusalMessage(d);
  const line = M.promptRefusalChannelLine(d);
  for (const n of [d.totalTok, d.availableTok, d.developerTok]) {
    assert.ok(msg.includes(String(n)), `the message must carry ${n}: ${msg}`);
    assert.ok(line.includes(String(n)), `the channel line must carry ${n}: ${line}`);
  }
  assert.ok(msg.startsWith("Column 80: "), "the product's refusal voice");
  assert.ok(line.startsWith("[fngen] "), "the channel's own register");
});

btest("C10: the shrink line names the before, the after, and that their context survived", () => {
  const d = arb({ developerTok: 4000, fixedTok: 336, injectedBlocks: 20, injectedTokFor: linear(1000) });
  const line = M.promptShrinkChannelLine(d);
  assert.match(line, /kept 10 of 20/);
  assert.match(line, /~20000 -> ~10000 tok/);
  assert.match(line, /preserved/);
});

// ===========================================================================
// D. THE FALLBACK SPLIT. Only a caller with no re-render reaches it, and its
// one job is to cut where a cut is safe.
// ===========================================================================

btest("D1: a surface of N blank-line-separated blocks splits into N units and joins back byte-identical", () => {
  const units = ["one\n```rust\na\n```", "two\n```rust\nb\n```", "three"];
  const surface = units.join(M.SECTION_SEPARATOR);
  assert.deepEqual(M.splitInjectedUnits(surface), units);
  assert.equal(M.joinInjectedUnits(M.splitInjectedUnits(surface)), surface);
});

btest("D2: a blank line INSIDE a fence never cuts - this is why it is not surface.split('\\n\\n')", () => {
  // The real shape: a data-shape block joins several struct defs with a blank
  // line inside ONE fence. A naive split hands the model half a code fence.
  const block =
    "Data shape of `Root` (fields and types, nested):\n```rust\npub struct Root { a: A }\n\npub struct A { b: u32 }\n```";
  const surface = [block, "Members of `Root`:\n```rust\nfn go()\n```"].join(M.SECTION_SEPARATOR);
  const units = M.splitInjectedUnits(surface);
  assert.equal(units.length, 2, `a fenced blank line must not end a unit: ${JSON.stringify(units)}`);
  assert.equal(units[0], block);
  for (const u of units) {
    assert.equal((u.match(/```/g) || []).length % 2, 0, `every unit must have balanced fences: ${JSON.stringify(u)}`);
  }
});

btest("D3: nothing to split answers an empty list, and joining nothing answers undefined", () => {
  assert.deepEqual(M.splitInjectedUnits(undefined), []);
  assert.deepEqual(M.splitInjectedUnits(""), []);
  assert.equal(M.joinInjectedUnits([]), undefined, "zero injection is an ABSENT section, not an empty one");
});

// ===========================================================================
// E. THE SERVICE SEAM.
// ===========================================================================

const RAW = "```rust\npub fn build(p0: Root) -> u32 {\n    0\n}\n```";
// The signature RAW answers, so a row that reaches the model gets a result
// rather than the pipeline's "not the requested function" guard.
const SIG = "pub fn build(p0: Root) -> u32";
const svcCfg = (o = {}) => ({ apiBase: "http://127.0.0.1:1", model: "fake-30b", maxTokens: MAX_TOKENS, temperature: 0.2, numCtx: NUM_CTX, ...o });
const bigBlock = (i, chars) => ({
  uri: `file:///work/dev${i}.rs`,
  range: { startLine: 0, endLine: 1 },
  text: `// DEV${i}\npub const PAD${i}: &str = "${"d".repeat(Math.max(0, chars - 40))}";\n`,
});
const injBlock = (i) => "Data shape of `T" + i + "` (fields and types, nested):\n```rust\npub struct T" + i + " { s" + i + ": u32 }\n```";

async function runService(cfg, req) {
  const calls = [];
  const logs = [];
  const gen = async (p) => {
    calls.push(p);
    if (p.onChunk) p.onChunk("");
    return { text: RAW, ttftMs: 1, totalMs: 2 };
  };
  const svc = new M.FnGenService(cfg, gen, (l) => logs.push(String(l)));
  let result;
  let error;
  try {
    result = await svc.generate(req);
  } catch (e) {
    error = e;
  }
  svc.dispose();
  return { calls, logs, result, error, prompt: calls.length ? String(calls[0].prompt) : undefined };
}

// The context size CHANGED in the D6 loop-back: 56000 chars was chosen against
// the old chars/4 estimate to land just over the line, and at the new ASCII
// chars/3 rate the same block refuses outright instead of shrinking. 40000
// keeps the row's shape - over the line at full injection, comfortably under it
// with the injection given up - at the rate the product now uses.
btest("E1: the caller's own re-render is preferred over the split - the handle is CALLED, not ignored", async () => {
  const asked = [];
  const blocks = Array.from({ length: 40 }, (_, i) => injBlock(i));
  const r = await runService(
    svcCfg(),
    {
      signature: SIG,
      languageId: "rust",
      contextBlocks: [bigBlock(0, 40000)],
      injectedSurface: blocks.join("\n\n"),
      injectedShrink: {
        blocks: 40,
        keep: (n) => {
          asked.push(n);
          // A DIFFERENT string from any prefix of the surface, so a row can
          // prove the service used the re-render and not string surgery.
          return n === 0 ? undefined : `RERENDER(${n})`;
        },
      },
    },
  );
  assert.ok(asked.length > 0, "the service must ask the caller to re-render rather than slicing the string");
  assert.ok(r.prompt !== undefined, "this case shrinks rather than refuses");
  assert.match(r.prompt, /RERENDER\(\d+\)/, `the re-rendered surface is what reached the prompt:\n${r.prompt.slice(0, 400)}`);
});

btest("E2: no re-render handle means the fence-aware split does the shrinking", async () => {
  const blocks = Array.from({ length: 400 }, (_, i) => injBlock(i));
  const surface = blocks.join("\n\n");
  const r = await runService(svcCfg(), {
    signature: SIG,
    languageId: "rust",
    contextBlocks: [bigBlock(0, 40000)],
    injectedSurface: surface,
  });
  assert.ok(r.calls.length === 1, "it shrinks rather than refuses");
  const kept = (r.prompt.match(/pub struct T\d+ \{/g) || []).length;
  assert.ok(kept > 0 && kept < 400, `a prefix of the blocks survives, got ${kept} of 400`);
  assert.ok(r.prompt.includes(blocks[0]), "the first block is kept whole, never cut mid-fence");
  assert.equal((r.prompt.match(/```/g) || []).length % 2, 0, "the prompt's fences stay balanced");
});

btest("E3: THE FRONTIER EXEMPTION IS AN ABSENT numCtx - the whole path is skipped, nothing is estimated", async () => {
  const surface = Array.from({ length: 400 }, (_, i) => injBlock(i)).join("\n\n");
  const asked = [];
  const r = await runService(svcCfg({ numCtx: undefined, maxTokens: 64000 }), {
    signature: SIG,
    languageId: "rust",
    contextBlocks: [bigBlock(0, 90000)],
    injectedSurface: surface,
    injectedShrink: { blocks: 400, keep: (n) => { asked.push(n); return undefined; } },
  });
  assert.equal(r.calls.length, 1, "no local window means no refusal is possible");
  assert.deepEqual(asked, [], "no estimate is taken, so the shrink handle is never touched");
  assert.ok(r.prompt.includes(surface), "the surface is assembled exactly as it is today");
  assert.deepEqual(r.logs.filter((l) => /window|shrink|shrunk|refus/i.test(l)), []);
});

btest("E4: a refusal throws a structurally-recognisable error and calls nothing", async () => {
  const r = await runService(svcCfg(), {
    signature: SIG,
    languageId: "rust",
    contextBlocks: Array.from({ length: 20 }, (_, i) => bigBlock(i, 4000)),
  });
  assert.equal(r.calls.length, 0, "no model call");
  assert.equal(r.result, undefined, "nothing to write to a buffer");
  assert.ok(M.isPromptWindowError(r.error), "the refusal must be recognisable across a bundle seam, never by instanceof");
  assert.equal(r.error.arbitration.verdict, "refuse", "and it carries the numbers, so no caller re-derives them");
});

btest("E5: `undefined` still means aborted on this path - a refusal is never confusable with a cancellation", async () => {
  // The reason the refusal throws instead of returning undefined.
  const r = await runService(svcCfg(), { signature: SIG, languageId: "rust" });
  assert.equal(r.error, undefined);
  assert.equal(r.calls.length, 1);
});

btest("E6: both frontier service arms DELETE numCtx, which is what exempts them", async () => {
  // White-box, and load-bearing: `num_ctx` reaches nothing on either transport
  // (both modules document it as dead), and since phase 2 its absence is the
  // exemption signal. Leaving it set would refuse a frontier prompt against a
  // 16384-token window the backend does not have.
  for (const provider of ["anthropic", "claude-code"]) {
    globalThis.__V48P2I_CFG__ = { fnGenProvider: provider, cloudApiKey: "k", cloudApiBase: "https://example.invalid" };
    try {
      const built = await M.buildFnGenService({ appendLine() {} }, () => {}, undefined, { storagePath: undefined });
      assert.equal(built.config.numCtx, undefined, `${provider}: numCtx must not survive onto a frontier config`);
    } finally {
      delete globalThis.__V48P2I_CFG__;
    }
  }
});

btest("E7: a local config keeps its numCtx, so the guard is armed on the path that needs it", () => {
  globalThis.__V48P2I_CFG__ = {};
  try {
    assert.equal(M.readFnGenConfig().numCtx, NUM_CTX);
  } finally {
    delete globalThis.__V48P2I_CFG__;
  }
});

// ===========================================================================
// F. resolvePrefill's SHRINK HANDLE.
// ===========================================================================

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new V.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new V.Position(lines.length - 1, 0);
  };
  return { uri: { toString: () => uriStr }, offsetAt, positionAt, getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text) };
}
const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};
function makeExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    const on = [...known].filter((t) => new RegExp(`\\b${t}\\b`).test(line));
    return on.length === 1 ? on[0] : undefined;
  };
  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => { const t = typeAtCursor(c.uri, c); return t ? defLocFor(t) : undefined; },
    hoverSurface: async (c) => { const t = typeAtCursor(c.uri, c); const h = t ? defTypes[t].hover : undefined; return h ? { signature: h } : undefined; },
    membersOfType: async () => [],
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

const WS = "file:///work/v48p2impl";

// A target naming SEVERAL root types, so the prefill renders several blocks and
// a shrink has something to drop.
async function prefillRoots(nRoots, nFields, stop) {
  const roots = Array.from({ length: nRoots }, (_, i) => `Root${String(i).padStart(2, "0")}`);
  const files = {};
  const defTypes = {};
  for (const [ri, root] of roots.entries()) {
    const subs = Array.from({ length: nFields }, (_, i) => `${root}Sub${String(i).padStart(2, "0")}`);
    const def = `pub struct ${root} {\n${subs.map((s, i) => `    pub field_${i}: ${s},`).join("\n")}\n}\n`;
    const u = `${WS}/root${ri}.rs`;
    files[u] = def;
    defTypes[root] = { uri: u, hover: def.trim() };
    for (const s of subs) {
      const su = `${WS}/${s.toLowerCase()}.rs`;
      files[su] = `pub struct ${s} { pub slot_number_field: u32, pub label_for_the_slot: String }\n`;
      defTypes[s] = { uri: su, hover: `pub struct ${s} {\n    pub slot_number_field: u32,\n    pub label_for_the_slot: String,\n}` };
    }
  }
  const mainUri = `${WS}/main.rs`;
  const signature = `pub fn build(${roots.map((r, i) => `p${i}: ${r}`).join(", ")}) -> u32`;
  const src = `/// Build the thing.\n${signature} {\n    todo!()\n}\n`;
  files[mainUri] = src;
  const record = {
    span: { start: src.indexOf(signature), end: src.length - 1 },
    signature,
    docComment: "Build the thing.",
    symbolName: "build",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
  };
  const logs = [];
  let surface;
  globalThis.__V48P2I_FILES__ = files;
  globalThis.__V48P2I_CFG__ = stop ? { injectedContext: stop } : {};
  let text;
  try {
    text = await M.resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, mainUri), record, (l) => logs.push(String(l)), {
      onSurface: (s) => { surface = s; },
    });
  } finally {
    delete globalThis.__V48P2I_FILES__;
    delete globalThis.__V48P2I_CFG__;
  }
  return { text: text || "", logs, surface, roots };
}

let F_RUN;
const prefill4 = async () => (F_RUN = F_RUN || prefillRoots(4, 3));

btest("F1: keep(all) is BYTE-IDENTICAL to what resolvePrefill returned - the fits case re-renders nothing new", async () => {
  const r = await prefill4();
  assert.ok(r.surface, "onSurface must fire once with the finished surface");
  assert.equal(r.surface.text, r.text, "the handle's own text is the returned surface");
  assert.equal(r.surface.keep(r.surface.blocks), r.text, "and re-rendering at full size reproduces it exactly");
});

btest("F2: the block count is the number of injected type blocks, and it matches the channel's own count", async () => {
  const r = await prefill4();
  assert.ok(r.surface.blocks > 1, `this fixture must render several blocks, got ${r.surface.blocks}`);
  const line = r.logs.find((l) => /pre-fill injected types=/.test(l));
  assert.equal(line, `[fngen] pre-fill injected types=${r.surface.blocks}`, "the droppable unit IS the injected type block");
});

btest("F3: keep(n) drops from the TAIL - the receiver-first ordering decides what survives", async () => {
  const r = await prefill4();
  const full = r.surface.text;
  const one = r.surface.keep(1);
  assert.ok(one.length < full.length, "one block is smaller than all of them");
  assert.ok(full.startsWith(one.slice(0, 40)), "the surviving prefix is the FIRST block, not an arbitrary one");
});

btest("F4: a shrink narrows the payload's own ONLY list - it never names a type the shrink removed", async () => {
  const r = await prefill4();
  // The firm instruction names every rendered type. A block dropped from the
  // payload must lose its place in that sentence, or the prompt points the
  // model at a surface that is no longer in it.
  const typesIn = (s) => [...String(s).matchAll(/pub struct (\w+)/g)].map((m) => m[1]);
  const namedIn = (s) => typesIn(s).filter((t) => String(s).includes("`" + t + "`"));
  const full = r.surface.text;
  const one = r.surface.keep(1);
  const goneFromFull = typesIn(full).filter((t) => !typesIn(one).includes(t));
  assert.ok(goneFromFull.length > 0, "fixture precondition: keep(1) must actually drop types");
  for (const t of goneFromFull) {
    assert.ok(!namedIn(one).includes(t), `the instruction still claims \`${t}\`, whose block was dropped:\n${one}`);
  }
});

btest("F5: keep(0) is undefined, not an empty string - zero injection is an ABSENT section", async () => {
  const r = await prefill4();
  assert.equal(r.surface.keep(0), undefined);
});

// ===========================================================================
// G. PHASE 3 - THE DROPPED EDGES.
// ===========================================================================

btest("G1: droppedBy names the CAP for each dropped type, and it is parallel to `dropped`", () => {
  const BOUNDS = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 2000 };
  const kids = Array.from({ length: 20 }, (_, i) => `Kid${String(i).padStart(2, "0")}`);
  const map = new Map();
  map.set("Root", {
    def: "pub struct Root { " + kids.map((k, i) => `f${i}: ${k}`).join(", ") + " }",
    fields: kids.map((k, i) => ({ name: `f${i}`, typeName: k, isLocal: true })),
  });
  for (const k of kids) map.set(k, { def: `pub struct ${k} { slot: u32 }`, fields: [] });
  const out = M.walkDataShape("Root", (t) => map.get(t), BOUNDS);
  assert.deepEqual(out.droppedBy.map((d) => d.name), out.dropped, "the two lists are the same names in the same order");
  assert.ok(out.dropped.length > 0);
  // B_MAX=4 stops the 5th child onward at the ROOT's fan-out; nothing here can
  // reach N_MAX first, because only 4 children are ever enqueued.
  for (const d of out.droppedBy) {
    assert.equal(d.cause, "breadth", `a 20-wide root against B_MAX=4 drops on breadth, got ${d.cause} for ${d.name}`);
  }
});

btest("G2: a render budget too small to hold a def is reported as `budget`, not as a structural cap", () => {
  const map = new Map();
  map.set("Root", { def: "pub struct Root {\n" + "    padding_field_with_a_long_name: u32,\n".repeat(40) + "}", fields: [] });
  const out = M.walkDataShape("Root", (t) => map.get(t), { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 4 });
  assert.ok(out.dropped.includes("Root"), "a def past the render budget is dropped entirely");
  assert.equal(out.droppedBy.find((d) => d.name === "Root").cause, "budget");
});

btest("G3: the shared ledger collects across walks, and a later walk that EMITS a name clears it", () => {
  const ledger = new Map();
  const shared = { visited: new Set(), remainingChars: 100000, droppedBy: ledger };
  const wide = new Map();
  const kids = Array.from({ length: 10 }, (_, i) => `K${i}`);
  wide.set("A", {
    def: "pub struct A { " + kids.map((k, i) => `f${i}: ${k}`).join(", ") + " }",
    fields: kids.map((k, i) => ({ name: `f${i}`, typeName: k, isLocal: true })),
  });
  for (const k of kids) wide.set(k, { def: `pub struct ${k} { s: u32 }`, fields: [] });
  M.walkDataShape("A", (t) => wide.get(t), { D_MAX: 2, B_MAX: 2, N_MAX: 6, TOK_MAX: 2000 }, shared);
  const droppedFirst = [...ledger.keys()];
  assert.ok(droppedFirst.length > 0, "the first walk drops the tail of A's fan-out");
  // A second walk rooted AT one of those dropped names emits it, so the ledger
  // must let it go: the developer is owed the types that reached no block
  // anywhere in the prompt, not a list of near misses.
  const victim = droppedFirst[0];
  M.walkDataShape(victim, (t) => wide.get(t), { D_MAX: 2, B_MAX: 2, N_MAX: 6, TOK_MAX: 2000 }, shared);
  assert.ok(!ledger.has(victim), `${victim} rendered in a later walk and must leave the ledger`);
});

btest("G4: no shared ledger means the walk records nothing - the FIM path pays for none of this", () => {
  const shared = { visited: new Set(), remainingChars: 100000 };
  const map = new Map();
  map.set("Root", { def: "pub struct Root { a: A, b: B }", fields: [{ name: "a", typeName: "A", isLocal: true }, { name: "b", typeName: "B", isLocal: true }] });
  map.set("A", { def: "pub struct A { s: u32 }", fields: [] });
  map.set("B", { def: "pub struct B { s: u32 }", fields: [] });
  const out = M.walkDataShape("Root", (t) => map.get(t), { D_MAX: 2, B_MAX: 1, N_MAX: 6, TOK_MAX: 2000 }, shared);
  assert.ok(out.dropped.length > 0, "it still REPORTS the drop on the result");
  assert.equal(shared.droppedBy, undefined, "it just does not write a ledger nobody asked for");
});

btest("G5: the per-gesture line names the types, the cap that dropped them, and the stop to raise", async () => {
  const r = await prefillRoots(1, 30, "small");
  const line = r.logs.find((l) => /injected context dropped/.test(l));
  assert.ok(line, `a starved stop must be visible: ${JSON.stringify(r.logs)}`);
  assert.match(line, /dropped 2[0-9] type\(s\) entirely at the `small` stop/, line);
  assert.match(line, /breadth cap 6/, "the cap AND its value, so the developer knows what raising it buys");
  assert.match(line, /column80\.injectedContext/, "and the dial that moves it");
});

btest("G6: the NAMES are bounded and the COUNT is not - a 30-wide graph does not bury the channel", async () => {
  const r = await prefillRoots(1, 30, "small");
  const line = r.logs.find((l) => /injected context dropped/.test(l));
  const named = (line.match(/Root00Sub\d+ \(/g) || []).length;
  assert.equal(named, 12, "twelve names is a line a human still reads");
  assert.match(line, /and \d+ more/, "and the rest are counted, never silently gone");
});

btest("G7: raising the stop is legible - the same graph drops fewer types and injects more", async () => {
  const small = await prefillRoots(1, 30, "small");
  const large = await prefillRoots(1, 30, "large");
  const count = (r) => Number(/dropped (\d+) type\(s\) entirely/.exec(r.logs.find((l) => /injected context dropped/.test(l)) || "")?.[1] ?? 0);
  assert.ok(count(large) < count(small), `large must starve less than small: ${count(large)} vs ${count(small)}`);
  assert.ok(large.text.length > small.text.length, "and inject more");
});

btest("G8: a walk that dropped nothing adds no line - empty stays silent", async () => {
  const r = await prefillRoots(1, 2, "small");
  assert.equal(r.logs.find((l) => /injected context dropped/.test(l)), undefined, JSON.stringify(r.logs));
});
