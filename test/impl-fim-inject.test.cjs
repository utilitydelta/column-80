// Implementer oracle for slice-3 FIM candidate injection (findings 6, 12, 13):
// trigger detection (`.`/`::` member site, fresh position skipped), the
// signature comment block, and the before-the-cursor-line insertion. Pure,
// headless. The de-risk proved the effect (bare 0/6 -> injected 5/6); these lock
// the mechanics.
//
// Run: SKIP_LIVE=1 node --test test/impl-fim-inject.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-fim-inject",
  `export { fimMemberSite, renderFimCandidates, injectBeforeCursorLine, ghostNamesMember } from "../src/core/fimInject";
export { CompletionService } from "../src/core/completionService";
export { createInjectionCache } from "../src/core/fimWholeBlock";
export { postprocess } from "../src/core/postprocess";
export { DOCUMENT_SCHEMES, isDocumentScheme } from "../src/vscode/documentSchemes";\n`
);
const { fimMemberSite, renderFimCandidates, injectBeforeCursorLine, ghostNamesMember, CompletionService, postprocess, createInjectionCache, DOCUMENT_SCHEMES, isDocumentScheme } = mod;
test.after(cleanup);

// ---- fimMemberSite: the trigger char is the selector (finding 12).

for (const { prefix, expected } of [
  { prefix: "let x = foo.", expected: { partial: "" } },
  { prefix: "let x = foo.ba", expected: { partial: "ba" } },
  { prefix: "let x = BloomFilter::", expected: { partial: "" } },
  { prefix: "let x = BloomFilter::wi", expected: { partial: "wi" } },
  { prefix: "a.b().c.", expected: { partial: "" } }, // chained receiver
  { prefix: "let y = ", expected: undefined }, // fresh position: no injection
  { prefix: "let y = foo", expected: undefined }, // a bare identifier is not member access
  { prefix: "x + y", expected: undefined },
  { prefix: "", expected: undefined },
  { prefix: "let x = 1.", expected: undefined }, // float literal, not member access
  { prefix: "for i in 0..", expected: undefined }, // range
  { prefix: "Foo { ..", expected: undefined }, // struct update
  { prefix: "    // call foo.", expected: undefined }, // inside a line comment
  { prefix: "    /// see widget.", expected: undefined }, // doc comment
  { prefix: "let n = 1.0.", expected: undefined }, // method on a float literal: accepted false-negative (digit guard); degrades to plain FIM
]) {
  test(`fimMemberSite(${JSON.stringify(prefix)})`, () => {
    assert.deepStrictEqual(fimMemberSite(prefix), expected);
  });
}

// ---- renderFimCandidates: signatures as comments, narrowed, gated.

const members = (names) => names.map((n) => ({ name: n.name, signature: n.sig, kind: "method", viaTrait: n.trait }));

test("renderFimCandidates renders a header and one signature per line, dropping the no-signature and trait noise", () => {
  const out = renderFimCandidates(members([
    { name: "with_num_bits", sig: "with_num_bits(usize) -> BuilderWithBits" },
    { name: "from_vec", sig: "from_vec(&[u64]) -> BloomFilter" },
    { name: "clone", sig: "clone(&self) -> Self", trait: "Clone" }, // universal trait: dropped
    { name: "bare" }, // no signature: dropped
  ]), "");
  assert.match(out, /use one of these exact names, do not invent/);
  assert.match(out, /^\/\/ with_num_bits\(usize\) -> BuilderWithBits$/m);
  assert.match(out, /^\/\/ from_vec/m);
  assert.ok(!out.includes("clone"), "universal-trait member dropped");
  assert.ok(!out.includes("bare"), "signature-less member dropped");
});

test("renderFimCandidates narrows to the already-typed partial", () => {
  const out = renderFimCandidates(members([
    { name: "with_num_bits", sig: "with_num_bits(usize) -> B" },
    { name: "with_false_pos", sig: "with_false_pos(f64) -> B" },
    { name: "from_vec", sig: "from_vec() -> B" },
  ]), "with");
  assert.match(out, /with_num_bits/);
  assert.match(out, /with_false_pos/);
  assert.ok(!out.includes("from_vec"), "a candidate not matching the partial is excluded");
});

test("renderFimCandidates returns undefined when nothing carries a signature", () => {
  assert.strictEqual(renderFimCandidates(members([{ name: "a" }, { name: "b" }]), ""), undefined);
  assert.strictEqual(renderFimCandidates([], ""), undefined);
});

test("renderFimCandidates gates a runaway (too-wide) candidate set", () => {
  const wide = Array.from({ length: 60 }, (_, i) => ({ name: `m${i}`, sig: `m${i}() -> ()` }));
  assert.strictEqual(renderFimCandidates(members(wide), ""), undefined, "over the cap: skip, do not inject a wall");
});

// ---- injectBeforeCursorLine: the block lands above the cursor's line, indented.

test("injectBeforeCursorLine inserts the block before the current line, matching its indentation", () => {
  const prefix = "fn demo() {\n    let filter = BloomFilter::";
  const out = injectBeforeCursorLine(prefix, "// available:\n// with_num_bits(usize) -> B");
  assert.strictEqual(
    out,
    "fn demo() {\n    // available:\n    // with_num_bits(usize) -> B\n    let filter = BloomFilter::",
    "block indented to the cursor line, which stays intact at the end",
  );
});

test("injectBeforeCursorLine handles a single-line prefix (no newline) by inserting at the top", () => {
  const out = injectBeforeCursorLine("foo.", "// bar()");
  assert.strictEqual(out, "// bar()\nfoo.");
});

// ---- CompletionService wiring: the resolved block reaches the generation
// prefix, and only when a generation actually happens.

const FIM_CFG = {
  apiBase: "http://127.0.0.1:1", model: "fake", maxTokens: 32, temperature: 0.01,
  debounceMs: 0, prefixChars: 2000, suffixChars: 500, multiline: true, cacheCapacity: 10,
};

test("CompletionService injects the resolved block into the generation prefix, cursor line intact", async () => {
  let seenPrefix;
  const svc = new CompletionService(FIM_CFG, async (p) => { seenPrefix = p.prefix; return { text: "with_num_bits(1024)", ttftMs: 1, totalMs: 2 }; });
  await svc.complete({
    prefix: "fn f() {\n    let x = BloomFilter::",
    suffix: ";\n}",
    manual: true,
    resolveInjection: async () => "// available:\n// with_num_bits(usize) -> B",
  });
  svc.dispose();
  assert.match(seenPrefix, /\/\/ with_num_bits\(usize\) -> B/, "the candidate block is in the model prefix");
  assert.match(seenPrefix, /BloomFilter::$/, "the cursor's line is untouched at the end");
});

test("CompletionService degrades to the plain prefix when resolveInjection yields undefined", async () => {
  let seenPrefix;
  const svc = new CompletionService(FIM_CFG, async (p) => { seenPrefix = p.prefix; return { text: "y", ttftMs: 1, totalMs: 2 }; });
  await svc.complete({ prefix: "let x = foo.", suffix: ";", manual: true, resolveInjection: async () => undefined });
  svc.dispose();
  assert.strictEqual(seenPrefix, "let x = foo.", "no injection: plain prefix, byte-for-byte");
});

test("CompletionService falls back to plain FIM when the injection query exceeds the deadline (TTFT guard)", async () => {
  let seenPrefix;
  const svc = new CompletionService(FIM_CFG, async (p) => { seenPrefix = p.prefix; return { text: "bar()", ttftMs: 1, totalMs: 2 }; });
  const never = () => new Promise(() => {}); // a cold rust-analyzer that never answers
  const t0 = Date.now();
  const r = await svc.complete({ prefix: "let x = foo.", suffix: ";", manual: true, resolveInjection: never });
  svc.dispose();
  const waited = Date.now() - t0;
  assert.ok(waited >= 40 && waited < 5000, `waited the deadline (~50ms), not forever: ${waited}ms`);
  assert.strictEqual(seenPrefix, "let x = foo.", "past the deadline -> plain prefix, generation still happens");
  assert.ok(r.ttftMs >= 40, "the injection wait is folded into the reported TTFT (honest metric)");
});

test("CompletionService does NOT cache a degraded (no-injection) completion at an injectable site", async () => {
  let calls = 0;
  const svc = new CompletionService(FIM_CFG, async () => { calls++; return { text: "y", ttftMs: 1, totalMs: 2 }; });
  const req = () => ({ prefix: "let x = foo.", suffix: ";", manual: true, resolveInjection: async () => undefined });
  await svc.complete(req());
  await svc.complete(req());
  svc.dispose();
  assert.strictEqual(calls, 2, "a cold-RA degrade is not cached, so a warm revisit re-generates instead of serving the guess");
});

test("CompletionService constrains a member-site completion to single-line and capped tokens", async () => {
  let seenMax;
  const cfg = { ...FIM_CFG, maxTokens: 256, multiline: true };
  // A base model running away into a fabricated block after the injected comments.
  const svc = new CompletionService(cfg, async (p) => { seenMax = p.maxTokens; return { text: "num_bits(1024)\n}\n\nfn fake() {}", ttftMs: 1, totalMs: 2 }; });
  const r = await svc.complete({ prefix: "let f = BloomFilter::with", suffix: "\n}", manual: true, memberSite: true });
  svc.dispose();
  assert.ok(seenMax <= 64, `member-site tokens capped: ${seenMax}`);
  assert.ok(!r.text.includes("\n"), "member-site completion is single-line, so the runaway is truncated");
  assert.ok(!r.text.includes("fake"), "the fabricated trailing function is dropped");
});

test("CompletionService leaves a non-member completion on the full token budget, and the v25 bound is what shortens it", async () => {
  let seenMax;
  const cfg = { ...FIM_CFG, maxTokens: 256 };
  const svc = new CompletionService(cfg, async (p) => { seenMax = p.maxTokens; return { text: "line_one\nline_two", ttftMs: 1, totalMs: 2 }; });
  const r = await svc.complete({ prefix: "let x = ", suffix: "", manual: true });
  svc.dispose();
  assert.strictEqual(seenMax, 256, "a non-member site keeps the full token budget");
  // Was "multi-line is preserved" before v25. A plain site is bounded now, and
  // the budget and the bound are separate mechanisms: the cap stays 256 and the
  // stream stop is what ends the read.
  assert.strictEqual(r.text, "line_one", "a plain site serves one syntactic unit");
});

test("CompletionService DOES cache when injection succeeded (normal caching preserved)", async () => {
  let calls = 0;
  const svc = new CompletionService(FIM_CFG, async () => { calls++; return { text: "with_num_bits(1024)", ttftMs: 1, totalMs: 2 }; });
  const req = () => ({ prefix: "let x = BloomFilter::", suffix: ";", manual: true, resolveInjection: async () => "// available:\n// with_num_bits(usize) -> B" });
  await svc.complete(req());
  const second = await svc.complete(req());
  svc.dispose();
  assert.strictEqual(calls, 1, "the injected completion is cached; the second identical call is a hit");
  assert.strictEqual(second.fromCache, true);
});

// ---- injection echo: the synthetic block must never survive into the ghost.

const ECHO_BLOCK = [
  "// available here (use one of these exact names, do not invent):",
  '// theme: "light" | "dark"',
  "// isDark: boolean",
  "// toggle(): void",
  '// setTheme(theme: "light" | "dark"): void',
].join("\n");
const ECHO_CTX = { suffix: "", currentLinePrefix: "  store.", multiline: false, injectedBlock: ECHO_BLOCK };

test("postprocess cuts the completion at an echoed injection header (the dogfood capture)", () => {
  const raw = "theme; // available here (use one of these exact names, do not invent):";
  assert.strictEqual(postprocess(raw, ECHO_CTX), "theme;");
});

test("postprocess cuts at an echoed candidate line too, and an echo-only completion drops to empty", () => {
  assert.strictEqual(postprocess('toggle(); // toggle(): void', ECHO_CTX), "toggle();");
  assert.strictEqual(postprocess("// available here (use one of these exact names, do not invent):", ECHO_CTX), "");
});

test("postprocess without an injected block never strips comments (the field is optional; plain FIM untouched)", () => {
  const raw = "theme; // the current theme";
  assert.strictEqual(postprocess(raw, { suffix: "", currentLinePrefix: "  store.", multiline: false }), raw);
  assert.strictEqual(postprocess(raw, ECHO_CTX), raw, "a comment NOT from the block survives even with a block present");
});

// Needles are LINE-ANCHORED (dogfood-day m4): an echo is a completion line's
// entire trimmed tail, never a substring. A genuine comment merely EXTENDING
// a needle is real prose, and cutting at it lost the code after it.

test("a genuine comment extending a short needle survives whole (the substring false positive, killed)", () => {
  const block = "// available here (use one of these exact names, do not invent):\n// x: T";
  const raw = "value = this.x; // x: Type registry entry, see docs";
  assert.strictEqual(postprocess(raw, { suffix: "", currentLinePrefix: "  ", multiline: false, injectedBlock: block }), raw);
});

test("a multiline ghost re-stating a type line INSIDE a longer comment keeps the code after it", () => {
  const block = "// types in play:\n// Tile { x: u32, y: u32 }";
  const ghost = "let t = Tile { x: 0, y: 0 };\n// Tile { x: u32, y: u32 } is the morton cell\nreturn t;";
  assert.strictEqual(
    postprocess(ghost, { suffix: "", currentLinePrefix: "", multiline: true, injectedBlock: block }),
    ghost,
    "the needle is not the line's whole tail, so the trailing return survives"
  );
});

test("an exact echoed line on a later line still cuts at that line's boundary", () => {
  const block = "// available here (use one of these exact names, do not invent):\n// toggle(): void";
  const ghost = "toggle();\n// toggle(): void\nreturn;";
  assert.strictEqual(postprocess(ghost, { suffix: "", currentLinePrefix: "", multiline: true, injectedBlock: block }), "toggle();");
});

// ---- manual-trigger alternatives: fan-out, dedupe, and the automatic-path freeze.

const ALT_CFG = {
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
const altGen = (texts) => {
  const calls = [];
  let i = 0;
  return {
    calls,
    fn: async (params) => {
      calls.push({ temperature: params.temperature });
      const text = texts[Math.min(i, texts.length - 1)];
      i += 1;
      return { text, ttftMs: 1, totalMs: 2 };
    },
  };
};
const ALT_REQ = { prefix: "const x = foo.", suffix: "", manual: true, alternatives: 3 };

// v21 moved the extras off a single 0.7 floor onto a 0.9/1.1 SPREAD: measured
// on the extras ladder at a 0.01 primary, best-of-3 goes from 11.6pp ahead of
// the primary to 16.3pp ahead, and the primary does not move. Raising the
// primary instead costs it 11.6pp, so only the ladder changed.
test("manual alternatives=3: three concurrent runs, primary keeps config temperature, extras spread across the ladder, distinct texts cycle", async () => {
  const g = altGen(["bar()", "baz()", "qux()"]);
  const svc = new CompletionService(ALT_CFG, g.fn);
  const out = await svc.complete(ALT_REQ);
  assert.strictEqual(g.calls.length, 3, "one primary + two extras");
  assert.strictEqual(g.calls.filter((c) => c.temperature === 0.01).length, 1, "exactly one run at config temperature");
  assert.deepStrictEqual(
    g.calls.map((c) => c.temperature).sort((a, b) => a - b),
    [0.01, 0.9, 1.1],
    "the extras spread rather than sharing one floor",
  );
  assert.ok(out.text.length > 0);
  assert.strictEqual((out.alternates ?? []).length, 2, "both distinct extras survive");
});

test("duplicate extras dedupe away; an all-identical fan-out returns a single suggestion", async () => {
  const g = altGen(["bar()", "bar()", "bar()"]);
  const svc = new CompletionService(ALT_CFG, g.fn);
  const out = await svc.complete(ALT_REQ);
  assert.strictEqual(out.text, "bar()");
  assert.strictEqual(out.alternates, undefined, "no alternates key when nothing distinct survived");
});

test("the automatic path never fans out, whatever the config asks for", async () => {
  const g = altGen(["bar()"]);
  const svc = new CompletionService(ALT_CFG, g.fn);
  const out = await svc.complete({ prefix: "const x = foo.", suffix: "", manual: false, alternatives: 3 });
  assert.strictEqual(g.calls.length, 1, "one model call on the automatic path");
  assert.strictEqual(out.alternates, undefined);
});

test("manual alternatives bypass the cache read: a cached single text cannot cycle", async () => {
  const g = altGen(["bar()", "baz()", "qux()"]);
  const svc = new CompletionService(ALT_CFG, g.fn);
  await svc.complete({ prefix: "const x = foo.", suffix: "", manual: true });
  assert.strictEqual(g.calls.length, 1, "first manual single-shot generated and cached");
  const out = await svc.complete(ALT_REQ);
  assert.strictEqual(out.fromCache, false, "the multi-suggestion gesture generates fresh");
  assert.strictEqual(g.calls.length, 4, "three fresh runs despite the warm cache");
});

// ---- cross-file staleness: a foreign edit evicts, the file's own edit does not.
// Dogfood capture: a member renamed in OrdersStore.ts left mvvm.ts's cached
// ghost offering the OLD name.

test("onDocumentChanged(foreign) evicts the cached completion; the next call regenerates", async () => {
  const g = altGen(["bar()"]);
  const svc = new CompletionService(ALT_CFG, g.fn);
  const req = { prefix: "const x = foo.", suffix: "", manual: true, uri: "file:///mvvm.ts" };
  await svc.complete(req);
  assert.strictEqual(g.calls.length, 1);
  svc.onDocumentChanged("file:///OrdersStore.ts");
  const out = await svc.complete(req);
  assert.strictEqual(out.fromCache, false, "the stale entry died with the foreign edit");
  assert.strictEqual(g.calls.length, 2, "regenerated against the changed world");
});

test("onDocumentChanged(same file) keeps the entry: typing-through stays warm", async () => {
  const g = altGen(["bar()"]);
  const svc = new CompletionService(ALT_CFG, g.fn);
  const req = { prefix: "const x = foo.", suffix: "", manual: true, uri: "file:///mvvm.ts" };
  await svc.complete(req);
  svc.onDocumentChanged("file:///mvvm.ts");
  const out = await svc.complete(req);
  assert.strictEqual(out.fromCache, true, "same-file edits are the prefix-walk's business, not eviction's");
  assert.strictEqual(g.calls.length, 1);
});

test("injection cache retainOnly: foreign blocks die, the edited file's own entry survives", () => {
  const cache = createInjectionCache();
  cache.set("file:///a.ts", 1, "// block a");
  cache.set("file:///b.ts", 3, "// block b");
  cache.retainOnly("file:///a.ts");
  assert.strictEqual(cache.get("file:///a.ts", 1), "// block a");
  assert.strictEqual(cache.get("file:///b.ts", 3), undefined, "the foreign block is gone");
});

// ---- the member-site output gate: "use one of these exact names" ENFORCED.
// Dogfood capture: `fanout ${store.` ghosted `fanout}` - a word echoed from
// the adjacent template prose - while the resolved members held
// aggregateFanouts. The gate drops what the candidate list cannot name.

const STORE_MEMBERS = ["aggregateFanouts", "busiestBand", "clearOrders", "orders", "placeOrder", "tileTally"];

test("ghostNamesMember: the dogfood capture is inconsistent; real members, partial continuations, and punctuation are consistent", () => {
  assert.strictEqual(ghostNamesMember("fanout}`;", "", STORE_MEMBERS), false, "the invented fanout");
  assert.strictEqual(ghostNamesMember("aggregateFanouts}", "", STORE_MEMBERS), true);
  assert.strictEqual(ghostNamesMember("regateFanouts}", "agg", STORE_MEMBERS), true, "typed partial + ghost lead prefix a member");
  assert.strictEqual(ghostNamesMember("Fanouts}", "aggregate", STORE_MEMBERS), true);
  assert.strictEqual(ghostNamesMember("}`;", "", STORE_MEMBERS), true, "no identifier added: punctuation continues the expression");
  assert.strictEqual(ghostNamesMember("anything", "", []), false, "empty member set: every identifier is an invention");

  // Dogfood capture (C#): at `stripe.` the model ghosted the COMPLETE wrong call
  // `Enroll(1);`. `Enroll` is a proper PREFIX of the real member `EnrollTile`, so
  // a prefix match kept the hallucination; a terminated identifier must match a
  // member EXACTLY.
  const STRIPE = ["EnrollTile", "AggregateFanout", "PartitionByLod", "TileTally", "Summarize"];
  assert.strictEqual(ghostNamesMember("Enroll(1);", "", STRIPE), false, "a completed call `Enroll(` that only PREFIXES `EnrollTile` is a hallucination");
  assert.strictEqual(ghostNamesMember("EnrollTile(t);", "", STRIPE), true, "the real member as a completed call is kept");
  assert.strictEqual(ghostNamesMember("ollTile(t);", "Enr", STRIPE), true, "typed `Enr` + ghost completing to EnrollTile is kept");
  assert.strictEqual(ghostNamesMember("Enroll", "", STRIPE), true, "still typing (no terminator): a prefix of EnrollTile stays a live completion");
});

test("the service gate drops an inconsistent member-site ghost and logs the drop", async () => {
  const g = altGen(["fanout}`;"]);
  const lines = [];
  const svc = new CompletionService(ALT_CFG, g.fn, (l) => lines.push(l));
  const out = await svc.complete({
    prefix: "  return `fanout ${store.",
    suffix: "`;\n}",
    manual: true,
    memberSite: true,
    resolveInjection: async () => ({ block: "// available here (use one of these exact names, do not invent):\n// tileTally: number", memberNames: STORE_MEMBERS }),
  });
  assert.strictEqual(out, undefined, "silence beats the invented member");
  assert.ok(lines.some((l) => l.includes("ghost names no resolved member")), `evidence line, got ${JSON.stringify(lines)}`);
});

test("the gate passes a ghost naming a real member; names-only resolution (no block) still gates", async () => {
  const ok = altGen(["tileTally}"]);
  const svcOk = new CompletionService(ALT_CFG, ok.fn);
  const passed = await svcOk.complete({
    prefix: "x = store.",
    suffix: "",
    manual: true,
    memberSite: true,
    resolveInjection: async () => ({ memberNames: STORE_MEMBERS }),
  });
  assert.strictEqual(passed.text, "tileTally}");
  const bad = altGen(["fanout}"]);
  const svcBad = new CompletionService(ALT_CFG, bad.fn);
  const dropped = await svcBad.complete({
    prefix: "x = store.",
    suffix: "",
    manual: true,
    memberSite: true,
    resolveInjection: async () => ({ memberNames: STORE_MEMBERS }),
  });
  assert.strictEqual(dropped, undefined, "no block rendered, but the names still gate the output");
});

test("no resolution, no gate: a lost race keeps the current honest-guess behavior", async () => {
  const g = altGen(["fanout}"]);
  const svc = new CompletionService(ALT_CFG, g.fn);
  const out = await svc.complete({
    prefix: "x = store.",
    suffix: "",
    manual: true,
    memberSite: true,
    resolveInjection: async () => undefined,
  });
  assert.strictEqual(out.text, "fanout}", "we know nothing, so we suppress nothing");
});

test("alternates ride the same gate: invented alternates die, a valid alternate can replace a dropped primary", async () => {
  const g = altGen(["fanout}", "tileTally}", "madeUp()"]);
  const svc = new CompletionService(ALT_CFG, g.fn);
  const out = await svc.complete({
    prefix: "x = store.",
    suffix: "",
    manual: true,
    alternatives: 3,
    memberSite: true,
    resolveInjection: async () => ({ memberNames: STORE_MEMBERS }),
  });
  assert.strictEqual(out.text, "tileTally}", "the valid alternate was promoted over the dropped primary");
  assert.strictEqual(out.alternates, undefined, "the invented alternate died too");
});

test("the gate is member-site-scoped: whole-block resolutions (bare string, memberSite false) pass multiline ghosts untouched", async () => {
  const g = altGen(["  const t = tileFromMorton(42, 3);\n  return t.subtendedChildren().length;"]);
  const svc = new CompletionService(ALT_CFG, g.fn);
  const out = await svc.complete({
    prefix: "export function count(): number {\n",
    suffix: "\n}",
    manual: true,
    memberSite: false,
    // The site this request always described, now stated: a whole-block site
    // with a resolver wired is exempt from the v25 bound, which is what keeps
    // the ghost multi-line for the gate to be shown NOT touching.
    wholeBlockSite: true,
    resolveInjection: async () => "// types in play:\n// Tile { subtendedChildren(): Tile[] }",
  });
  assert.ok(out && out.text.includes("subtendedChildren"), "the whole-block ghost survives whole");
});

test("the gate never fires when memberSite is false, even if names were somehow present", async () => {
  const g = altGen(["fanout()"]);
  const svc = new CompletionService(ALT_CFG, g.fn);
  const out = await svc.complete({
    prefix: "const x = compute",
    suffix: "",
    manual: true,
    memberSite: false,
    resolveInjection: async () => ({ memberNames: ["somethingElse"] }),
  });
  assert.ok(out && out.text === "fanout()", "no member site, no enforcement - whatever names rode along");
});

// ---- eviction scheme allowlist (dogfood-day M1): eviction fires for exactly
// the schemes the provider registers - the only schemes that can mint entries.
// Dogfood capture: 20 commit-box keystrokes (scheme vscode-scm) paid 19 cache
// misses at a warm site under the old one-scheme denylist.

test("isDocumentScheme: the provider's own schemes pass, every other event source never evicts", () => {
  assert.deepStrictEqual([...DOCUMENT_SCHEMES], ["file", "untitled", "vscode-notebook-cell"], "ONE pinned list");
  for (const scheme of DOCUMENT_SCHEMES) {
    assert.strictEqual(isDocumentScheme(scheme), true, scheme);
  }
  for (const scheme of [
    "vscode-scm",
    "comment",
    "vscode-interactive-input",
    "vscode-chat-code-block",
    "debug",
    "search-editor",
    "output",
    "git",
  ]) {
    assert.strictEqual(isDocumentScheme(scheme), false, `${scheme} must not evict`);
  }
});

test("a commit-box keystroke stream leaves warm caches warm (the 1-hit/19-miss capture, killed)", async () => {
  const g = altGen(["bar()"]);
  const svc = new CompletionService(ALT_CFG, g.fn);
  const inj = createInjectionCache();
  const req = { prefix: "const x = foo.", suffix: "", manual: true, uri: "file:///a.ts" };
  await svc.complete(req);
  inj.set("file:///a.ts", 1, "// block a");
  // The extension listener's shape against the shared predicate: an SCM
  // keystroke never reaches the eviction calls.
  const onEdit = (scheme, path) => {
    if (isDocumentScheme(scheme)) {
      svc.onDocumentChanged(`${scheme}://${path}`);
      inj.retainOnly(`${scheme}://${path}`);
    }
  };
  for (let i = 0; i < 20; i++) {
    onEdit("vscode-scm", "scm0/input");
  }
  const out = await svc.complete(req);
  assert.strictEqual(out.fromCache, true, "20 commit-box keystrokes later, still a hit");
  assert.strictEqual(inj.get("file:///a.ts", 1), "// block a", "the injection block survived too");
  assert.strictEqual(g.calls.length, 1, "one model call total");
  // and a REAL foreign edit still evicts through the same predicate
  onEdit("file", "/b.ts");
  assert.strictEqual(inj.get("file:///a.ts", 1), undefined, "a real document edit keeps evicting");
});

// ---- fan-out settlement (dogfood-day m7): the primary's failure aborts the
// extras instead of orphaning them against a warm server slot.

test("a failing primary aborts the extras: no orphaned generations, and the failure still logs as a failure", async () => {
  let extraSignal;
  const gen = async (params) => {
    if (params.temperature === 0.01) {
      throw new Error("server fell over");
    }
    extraSignal = params.signal;
    // an extra that only settles when aborted: exactly the orphan shape
    return new Promise((resolve) => {
      params.signal.addEventListener("abort", () => resolve({ text: "orphan()", ttftMs: 1, totalMs: 1 }), {
        once: true,
      });
    });
  };
  const lines = [];
  const svc = new CompletionService(ALT_CFG, gen, (l) => lines.push(l));
  const out = await svc.complete(ALT_REQ);
  assert.strictEqual(out, undefined, "the primary's failure fails the call");
  assert.ok(extraSignal && extraSignal.aborted, "the extras' shared signal fired: nothing keeps generating");
  assert.ok(
    lines.some((l) => l.includes("request failed")),
    `the failure logs as a failure, not silence: ${JSON.stringify(lines)}`
  );
});
