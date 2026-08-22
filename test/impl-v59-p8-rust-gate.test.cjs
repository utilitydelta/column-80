// Rust joins the invented-member gate, and `.await` still works.
//
// Rust was the one language carved out of the member-site output gate. The
// reason was real: rust-analyzer serves keyword and postfix completions at a
// `.` site BY DESIGN, the extractor drops those kinds, and gating on the
// remaining list suppressed `.await`. The answer is not to leave Rust dark, it
// is to stop making the gate's LEGAL list and the prompt's RENDERED list the
// same list.
//
// Both directions ship together, or neither does:
//
//   1. an invented member (`s.add_tile_by_morton(...)`, the dogfood capture's
//      own name) is suppressed;
//   2. a ghost completing `.await` on a Future receiver is NOT suppressed.
//
// The fixtures below are LIVE CAPTURE from a real rust-analyzer 2026 build over
// a two-receiver crate (a struct, and the `impl Future` an `async fn` returns),
// resolved through `completionItem/resolve` so every label, kind, detail and
// sortText is the server's own. Two facts from that capture drive the whole
// build, and neither is guessable:
//
//   * a plain `.` site serves 19 postfix SNIPPET items (ref, dbg, match, ...)
//     next to the 6 real members, and no `await` keyword at all;
//   * a Future receiver rewrites EVERY member label as `await.<member>` and
//     serves `await` as a lone KEYWORD item - the one item the extractor
//     dropped, which is exactly how a gated Rust used to eat `.await`.
//
// Run: SKIP_LIVE=1 node --test test/impl-v59-p8-rust-gate.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const TAG = ".impl-v59-p8-rust-gate";
const STUB = path.join(__dirname, `${TAG}-vscode-stub.cjs`);
const REGISTRY_STUB = path.join(__dirname, `${TAG}-registry.ts`);
const entry = path.join(__dirname, `${TAG}.entry.ts`);
const outfile = path.join(__dirname, `${TAG}.bundle.cjs`);
const buildScript = path.join(__dirname, `${TAG}.build.cjs`);

fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; }
  translate(l, c) { return new Position(this.line + (l || 0), this.character + (c || 0)); } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = {
  Position, Range,
  Uri: { parse: (s) => ({ toString: () => s }) },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => {
      if (k === "fimAlternatives") { return 1; }
      if (k === "debounceMs") { return 0; }
      if (k === "fimMemberGate") { return globalThis.__v59GateOn !== false; }
      return d;
    } }),
    textDocuments: [],
    openTextDocument: async () => { throw new Error("no such file"); },
  },
  InlineCompletionItem: class { constructor(text, range) { this.insertText = text; this.range = range; } },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  ThemeColor: class {}, MarkdownString: class {}, EventEmitter: class {},
};\n`,
);

// The REGISTRY is stubbed, never the transport: these rows need the real
// RaCommandExtractor mapping a real rust-analyzer answer, because the mapping
// is half of what is under test.
fs.writeFileSync(
  REGISTRY_STUB,
  `export function extractorFor(_languageId: string): any {
  return (globalThis as any).__v59Extractor;
}\n`,
);

fs.writeFileSync(
  entry,
  `export { FimCompletionProvider } from "../src/vscode/completionProvider";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";
export { RaCommandExtractor } from "../src/vscode/raExtractor";
export { RaLspExtractor } from "../src/core/raLspClient";
export { semanticMembers } from "../src/core/extraction";
export { memberSiteLegalNames, ghostNamesMember } from "../src/core/fimInject";\n`,
);

fs.writeFileSync(
  buildScript,
  `require("esbuild").build({
  entryPoints: [${JSON.stringify(entry)}],
  bundle: true, outfile: ${JSON.stringify(outfile)}, format: "cjs", platform: "node",
  alias: { vscode: ${JSON.stringify(STUB)} },
  plugins: [{ name: "registry", setup(b) {
    b.onResolve({ filter: /(^|\\/)extractors$/ }, () => ({ path: ${JSON.stringify(REGISTRY_STUB)} }));
  } }],
}).catch((e) => { console.error(e); process.exit(1); });\n`,
);

execFileSync(process.execPath, [buildScript], { stdio: "pipe" });
const {
  FimCompletionProvider,
  CompletionService,
  DEFAULT_FIM_CONFIG,
  RaCommandExtractor,
  RaLspExtractor,
  semanticMembers,
  memberSiteLegalNames,
  ghostNamesMember,
} = require(outfile);

test.after(() => {
  [STUB, REGISTRY_STUB, entry, outfile, buildScript].forEach((f) => fs.rmSync(f, { force: true }));
});

// ---------------------------------------------------------------------------
// The live capture. LSP wire kinds (1-indexed: Method 2, Field 5, Keyword 14,
// Snippet 15). vscode's enum numbers the same concepts one lower, so the two
// transports read the SAME capture through their own offset.
// ---------------------------------------------------------------------------

const LSP = { Method: 2, Field: 5, Keyword: 14, Snippet: 15 };
const toVscodeKind = (kind) => kind - 1;

// 19 postfix snippets, identical at both captured sites.
const POSTFIX_LABELS = [
  "ref", "refm", "deref", "ok", "pinbox", "arc", "some", "err", "rc", "box",
  "dbg", "dbgr", "call", "let", "letm", "match", "unsafe", "const", "return",
];
const POSTFIX = [
  ["ref", "&expr"],
  ["refm", "&mut expr"],
  ["deref", "*expr"],
  ["ok", "Wrap the expression in a `Result::Ok`"],
  ["pinbox", "Put the expression into a pinned `Box`"],
  ["arc", "Put the expression into an `Arc`"],
  ["some", "Wrap the expression in an `Option::Some`"],
  ["err", "Wrap the expression in a `Result::Err`"],
  ["rc", "Put the expression into an `Rc`"],
  ["box", "Box::new(expr)"],
  ["dbg", "dbg!(expr)"],
  ["dbgr", "dbg!(&expr)"],
  ["call", "function(expr)"],
  ["let", "let"],
  ["letm", "let mut"],
  ["match", "match expr {}"],
  ["unsafe", "unsafe {}"],
  ["const", "const {}"],
  ["return", "return expr"],
].map(([label, detail]) => ({ label, detail, kind: LSP.Snippet, sortText: "80000004" }));

// `s.` where s: Store. 25 items.
const PLAIN_SITE = [
  { label: "alpha_code", detail: "u64", kind: LSP.Field, sortText: "7fffffff" },
  { label: "insert(…)", detail: "fn(&mut self, u64) -> bool", kind: LSP.Method, sortText: "7fffffff" },
  { label: "try_into()", detail: "fn(self) -> Result<T, <Self as TryInto<T>>::Error>", kind: LSP.Method, sortText: "80000004" },
  { label: "tile_tally()", detail: "fn(&self) -> usize", kind: LSP.Method, sortText: "7fffffff" },
  { label: "into()", detail: "fn(self) -> T", kind: LSP.Method, sortText: "80000004" },
  { label: "try_rehome(…)", detail: "fn(&mut self, u64) -> bool", kind: LSP.Method, sortText: "7fffffff" },
  ...POSTFIX,
];

// `fut.` where fut is the `impl Future` an `async fn load_store() -> Store`
// returns. 28 items: every member relabelled `await.<member>` and demoted to
// the 8-family, plus the lone `await` keyword, plus the Future's OWN blanket
// members, plus the same 19 postfix snippets.
const FUTURE_SITE = [
  { label: "await", detail: "expr.await", kind: LSP.Keyword, sortText: "7fffffff" },
  { label: "await.alpha_code", detail: "u64", kind: LSP.Field, sortText: "80000006" },
  { label: "await.insert(…)", detail: "fn(&mut self, u64) -> bool", kind: LSP.Method, sortText: "80000006" },
  { label: "await.try_into()", detail: "fn(self) -> Result<T, <Self as TryInto<T>>::Error>", kind: LSP.Method, sortText: "8000000b" },
  { label: "await.tile_tally()", detail: "fn(&self) -> usize", kind: LSP.Method, sortText: "80000006" },
  { label: "await.into()", detail: "fn(self) -> T", kind: LSP.Method, sortText: "8000000b" },
  { label: "await.try_rehome(…)", detail: "fn(&mut self, u64) -> bool", kind: LSP.Method, sortText: "80000006" },
  { label: "try_into()", detail: "fn(self) -> Result<T, <Self as TryInto<T>>::Error>", kind: LSP.Method, sortText: "80000004" },
  { label: "into()", detail: "fn(self) -> T", kind: LSP.Method, sortText: "80000004" },
  ...POSTFIX,
];

const asVscodeItems = (items) => items.map((i) => ({ ...i, kind: toVscodeKind(i.kind) }));

// The vscode command transport: the product path. Every command other than
// completion degrades, exactly as it does when no provider answers.
function commandExtractor(items) {
  return new RaCommandExtractor(async (command) =>
    command === "vscode.executeCompletionItemProvider" ? { items: asVscodeItems(items) } : undefined,
  );
}

// ---------------------------------------------------------------------------
// The product path: real provider, real service, real transport mapping.
// ---------------------------------------------------------------------------

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

const PLAIN_PREFIX = "let mut s = Store::new();\ns.";
const FUTURE_PREFIX = "let fut = load_store();\nfut.";

async function fire({ ghost, items, prefix = PLAIN_PREFIX, gateOn = true }) {
  globalThis.__v59GateOn = gateOn;
  globalThis.__v59Extractor = commandExtractor(items);
  const prompts = [];
  const service = new CompletionService({ ...DEFAULT_FIM_CONFIG, debounceMs: 0 }, async (params) => {
    prompts.push(params.prefix);
    return { text: ghost, ttftMs: 1, totalMs: 2 };
  });
  const provider = new FimCompletionProvider(() => service, { appendLine: () => {} });
  const { doc, position } = makeCursorDoc("rust", prefix);
  const shown = await provider.provideInlineCompletionItems(
    doc,
    position,
    { triggerKind: 0 },
    { onCancellationRequested: () => {}, isCancellationRequested: false },
  );
  service.dispose();
  return { shown, prompts };
}

// ===========================================================================
// Direction 1: an invented Rust member is suppressed.
// ===========================================================================

test("DIRECTION 1: the dogfood capture's own invented name is struck at a Rust member site", async () => {
  const { shown } = await fire({ ghost: "add_tile_by_morton(morton, tile);", items: PLAIN_SITE });
  assert.strictEqual(
    shown,
    undefined,
    "add_tile_by_morton appears nowhere in the receiver's 25-item answer; Rust must strike it like the other four languages",
  );
});

test("DIRECTION 1: a later invented access on the same receiver is struck too", async () => {
  const { shown } = await fire({ ghost: "insert(7); s.add_tile_by_morton(m);", items: PLAIN_SITE });
  assert.strictEqual(shown, undefined, "the receiver travels, so the gate reads past the leading identifier in Rust too");
});

// ===========================================================================
// Direction 2: `.await` still works. This is the regression that turned the
// gate off last time. A build that only ships direction 1 ships that defect
// again.
// ===========================================================================

test("DIRECTION 2: `.await` on a Future receiver survives the gate", async () => {
  const { shown } = await fire({ ghost: "await;", items: FUTURE_SITE, prefix: FUTURE_PREFIX });
  assert.ok(shown && shown.length === 1, "a bare `.await` is the completion this gate ate last time");
  assert.strictEqual(shown[0].insertText, "await;");
});

test("DIRECTION 2: `.await` chained into a real member survives", async () => {
  const { shown } = await fire({ ghost: "await.insert(7);", items: FUTURE_SITE, prefix: FUTURE_PREFIX });
  assert.ok(shown && shown.length === 1, "rust-analyzer's OWN label for this site is `await.insert(…)`");
  assert.strictEqual(shown[0].insertText, "await.insert(7);");
});

test("DIRECTION 2: an invented member is still struck ON a Future receiver", async () => {
  const { shown } = await fire({ ghost: "add_tile_by_morton(m);", items: FUTURE_SITE, prefix: FUTURE_PREFIX });
  assert.strictEqual(shown, undefined, "widening for `await` must not open the receiver up to anything else");
});

// The reach the gate does NOT have, pinned so it is not mistaken for one it
// does: `ghostRefs` judges the LEADING identifier and every later
// `receiver.NAME`, so a ghost that awaits first and invents second
// (`await.add_tile_by_morton(...)`) is judged on `await` alone and survives.
// That is the gate's shape in all five languages, not something the legal
// list widened - the same ghost written `s.insert(1).bogus()` survives in C#
// for the same reason. Recorded as residue, not fixed here: reading a dotted
// lead as one reference would put `foo.bar` against a TS legal list that
// holds only `foo`, and false-suppress four languages to catch one.
test("KNOWN REACH LIMIT: a ghost that awaits first and invents second is judged on `await` alone", async () => {
  const { shown } = await fire({ ghost: "await.add_tile_by_morton(m);", items: FUTURE_SITE, prefix: FUTURE_PREFIX });
  assert.ok(
    shown && shown[0].insertText === "await.add_tile_by_morton(m);",
    "not a defect this phase introduced, and not one it claims to have closed",
  );
});

// ===========================================================================
// The two lists are different lists. The gate's is complete; the prompt's is
// callable-only.
// ===========================================================================

test("the postfix surface is LEGAL but never RENDERED", async () => {
  const { shown, prompts } = await fire({ ghost: "match s { _ => () }", items: PLAIN_SITE });
  assert.ok(shown && shown.length === 1, "postfix `match` is a completion rust-analyzer itself offered at this site");

  const block = prompts[0];
  for (const label of POSTFIX_LABELS) {
    assert.ok(
      !block.includes(`// ${label}`),
      `the prompt must stay callable-only: ${label} is a postfix snippet, not a member the model can call`,
    );
  }
  assert.ok(block.includes("insert(&mut self, u64) -> bool"), "the real members still render");
  assert.ok(block.includes("alpha_code: u64"), "the field still renders");
});

test("a real member call is not over-refused - the 0-of-196 false-suppression trap", async () => {
  for (const ghost of ["insert(7);", "tile_tally()", "try_rehome(id);", "alpha_code"]) {
    const { shown } = await fire({ ghost, items: PLAIN_SITE });
    assert.ok(shown && shown[0].insertText === ghost, `${ghost} is a real member of the captured receiver`);
  }
});

test("the kill switch still covers Rust: fimMemberGate off shows the invention", async () => {
  const { shown } = await fire({ ghost: "add_tile_by_morton(m);", items: PLAIN_SITE, gateOn: false });
  assert.ok(shown && shown[0].insertText === "add_tile_by_morton(m);", "column80.fimMemberGate is the SHARED switch; Rust gets no second one");
});

// ===========================================================================
// The arming rule is unchanged: positive evidence only. A keyword/postfix-only
// answer is not a member surface, and must not arm a gate whose legal list
// would then be 20 postfix names.
// ===========================================================================

test("a keyword/postfix-ONLY answer arms nothing", async () => {
  const items = [{ label: "await", detail: "expr.await", kind: LSP.Keyword, sortText: "7fffffff" }, ...POSTFIX];
  const { shown } = await fire({ ghost: "add_tile_by_morton(m);", items });
  assert.ok(
    shown && shown[0].insertText === "add_tile_by_morton(m);",
    "no member bound, no evidence, no suppression - suppressing on absence of evidence is the measured footgun",
  );
});

// ===========================================================================
// The legal list itself, and the transport that has to carry it.
// ===========================================================================

test("the transport keeps the dropped labels as members that never render", async () => {
  const answer = await commandExtractor(PLAIN_SITE).completeMembers({ uri: "file:///a.rs", line: 1, character: 2 });
  const rendered = semanticMembers(answer);
  assert.deepStrictEqual(
    rendered.map((m) => m.name),
    ["alpha_code", "insert", "tile_tally", "try_rehome"],
    "the RENDERED surface is unchanged: 4 real members, blanket into/try_into dropped, no keyword or postfix",
  );
  assert.deepStrictEqual(
    answer.filter((m) => m.kind === "keyword").map((m) => m.name),
    POSTFIX_LABELS,
    "the 19 postfix labels ride along as never-rendered members",
  );
  for (const m of answer) {
    if (m.kind === "keyword") {
      assert.strictEqual(m.signature, undefined, "a never-rendered member must carry no signature to render");
    }
  }
});

test("a Future receiver's legal list holds the names a caller can actually write", async () => {
  const answer = await commandExtractor(FUTURE_SITE).completeMembers({ uri: "file:///a.rs", line: 1, character: 4 });
  const legal = memberSiteLegalNames(semanticMembers(answer), answer);
  assert.ok(legal.includes("await"), "127 relabelled members and one keyword: without `await` the gate rejects every real ghost");
  assert.ok(legal.includes("await.insert"), "the server's own label is writable as-is");
  assert.ok(legal.includes("insert"), "and so is the bare member, once the expression is awaited");
  assert.ok(!legal.includes("add_tile_by_morton"), "widening is not surrender");
});

test("legal names never renames or reorders the rendered list", async () => {
  const answer = await commandExtractor(PLAIN_SITE).completeMembers({ uri: "file:///a.rs", line: 1, character: 2 });
  const rendered = semanticMembers(answer);
  const legal = memberSiteLegalNames(rendered, answer);
  assert.deepStrictEqual(
    legal.slice(0, rendered.length),
    rendered.map((m) => m.name),
    "the rendered names lead the legal list, in order: the legal list only ever ADDS",
  );
  assert.strictEqual(new Set(legal).size, legal.length, "no duplicates - a legal list is a set");
});

test("the gate reads the legal list, not the rendered one", () => {
  const rendered = [{ name: "insert", kind: "method" }];
  const answer = [...rendered, { name: "await", kind: "keyword" }];
  const legal = memberSiteLegalNames(rendered, answer);
  assert.strictEqual(ghostNamesMember("await;", "", legal, "fut"), true, "the whole point of the second list");
  assert.strictEqual(ghostNamesMember("await;", "", rendered.map((m) => m.name), "fut"), false, "and the whole reason Rust was dark");
});

// ===========================================================================
// Transport parity (triage-p3 finding 4): the product and headless transports
// must keep producing the same members from the same wire item, legal-only
// members included.
// ===========================================================================

test("parity: both Rust transports carry the same legal list", async () => {
  for (const items of [PLAIN_SITE, FUTURE_SITE]) {
    const product = await commandExtractor(items).completeMembers({ uri: "file:///a.rs", line: 1, character: 2 });
    const headless = RaLspExtractor.prototype["mapCompletion"].call(null, { items });
    assert.deepStrictEqual(
      product.map((m) => ({ name: m.name, kind: m.kind })),
      headless.map((m) => ({ name: m.name, kind: m.kind })),
      "a transport that drops the keyword surface gates differently from one that keeps it",
    );
  }
});
