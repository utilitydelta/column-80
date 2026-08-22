// review-v27-tier: ADVERSARIAL rows for phase 2 of session-v27 (tier stamping,
// arm-D empty-partial block, gate integrity, reject-reason line). Written by the
// phase-2 review agent; independent of test/impl-v27-tier.test.cjs.
//
// Every row is an attack that correct code must survive:
// - rust: sortText shapes beyond the two probe values (harvest families
//   7fffffd9..7fffffff and 80000000..8000000b, plus absent/empty/non-string),
//   and keyword/snippet items that carry sortText but must be dropped by KIND
//   before any tier reasoning (the harvest shows keyword items at 7fffffff and
//   500 postfix-snippet items at 80000004).
// - C#: a developer's own Equals/ToString override, resolved and unresolved,
//   plus the structural invariant that makes the fallback safe: a C# member
//   stamped tier 1 NEVER carries a signature, so the arm-D filter cannot
//   remove a rendered C# line.
// - gate: a tier-1 member absent from the block is still accepted by
//   ghostNamesMember (the human typing .clone() when clone is not shown).
// - reject line: empty and CRLF offered text keep the line one-line and honest.
//
// Run: SKIP_LIVE=1 node --test test/review-v27-tier.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".review-v27-tier-vscode-stub.cjs");
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
const entry = path.join(__dirname, ".review-v27-tier.entry.ts");
const outfile = path.join(__dirname, ".review-v27-tier.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { RaCommandExtractor } from "../src/vscode/raExtractor";
export { toCsCompletionMember } from "../src/core/csExtraction";
export { toPyCompletionMember, toPySymbolMember } from "../src/core/pyExtraction";
export { renderFimCandidates, ghostNamesMember } from "../src/core/fimInject";
export { FnGenService } from "../src/core/fnGenService";
export { semanticMembers } from "../src/core/extraction";\n`,
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
  toCsCompletionMember,
  toPyCompletionMember,
  toPySymbolMember,
  renderFimCandidates,
  ghostNamesMember,
  FnGenService,
  semanticMembers,
} = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const CURSOR = { uri: "file:///x/main.rs", line: 5, character: 8 };
// vscode CompletionItemKind values (0-indexed): Method=1, Field=4, Keyword=13,
// Snippet=14. NOT the LSP wire enum.
const VS = { Method: 1, Field: 4, Keyword: 13, Snippet: 14 };

// ---------------------------------------------------------------------------
// TARGET 1: sortText family rule vs what rust-analyzer actually emits.
// The full harvest value space (spike-v27 surface_raw.jsonl, 44 sites) is:
// 7fffffd9 7fffffe6 7fffffeb 7fffffec 7fffffed 7ffffff1 7ffffffa 7ffffffb
// 7fffffff | 80000000 80000001 80000004 80000005 80000006 80000009 8000000a
// 8000000b. No 9-led, no non-hex shape appeared; the rows below cover the
// observed spread plus the degenerate shapes the rule must fail OPEN on.
// ---------------------------------------------------------------------------

test("every harvest sortText value partitions to the measured family", async () => {
  const rows = [
    ["7fffffd9", 0], ["7fffffe6", 0], ["7fffffeb", 0], ["7fffffec", 0],
    ["7fffffed", 0], ["7ffffff1", 0], ["7ffffffa", 0], ["7ffffffb", 0],
    ["7fffffff", 0],
    ["80000000", 1], ["80000001", 1], ["80000004", 1], ["80000005", 1],
    ["80000006", 1], ["80000009", 1], ["8000000a", 1], ["8000000b", 1],
  ];
  const items = rows.map(([sortText], i) => ({
    label: `m_${i}`,
    detail: "fn(&self) -> u64",
    kind: VS.Method,
    sortText,
  }));
  const extractor = new RaCommandExtractor(async () => ({ items }));
  const members = await extractor.completeMembers(CURSOR);
  assert.strictEqual(members.length, rows.length);
  rows.forEach(([sortText, want], i) => {
    assert.strictEqual(members[i].tier, want, `sortText=${sortText}`);
  });
});

test("degenerate sortText shapes fail OPEN to tier 0 (only positive penalty demotes)", async () => {
  const items = [
    { label: "absent", detail: "fn(&self)", kind: VS.Method },
    { label: "empty", detail: "fn(&self)", kind: VS.Method, sortText: "" },
    { label: "numeric", detail: "fn(&self)", kind: VS.Method, sortText: 0x80000000 },
    { label: "spaced", detail: "fn(&self)", kind: VS.Method, sortText: " 80000000" },
  ];
  const extractor = new RaCommandExtractor(async () => ({ items }));
  const members = await extractor.completeMembers(CURSOR);
  for (const m of members) {
    assert.strictEqual(m.tier, 0, `${m.name}: no positive 8-family evidence, must stay own`);
  }
});

test("keyword and snippet items carrying sortText are never tiered in (S30: kept as legal-only, still never rendered)", async () => {
  // The harvest holds keyword items at 7fffffff and 500 postfix snippets at
  // 80000004. If the kind filter ever let them through, a 7fffffff keyword
  // would sit in the OWN tier of an empty-partial block.
  //
  // S30 kept the labels in the ANSWER so the output gate's legal list is
  // complete. The demand above did not move an inch: they carry no tier, no
  // signature, and never reach the surface anything renders from.
  const items = [
    { label: "await", kind: VS.Keyword, sortText: "7fffffff" },
    { label: "match", kind: VS.Snippet, sortText: "80000004", detail: "match expr {}" },
    { label: "real_method", kind: VS.Method, sortText: "7fffffff", detail: "fn(&self) -> u64" },
  ];
  const extractor = new RaCommandExtractor(async () => ({ items }));
  const members = await extractor.completeMembers(CURSOR);
  assert.deepStrictEqual(
    semanticMembers(members).map((m) => m.name),
    ["real_method"],
    "keyword/snippet never become part of the rendered surface regardless of sortText",
  );
  for (const m of members.filter((x) => x.kind === "keyword")) {
    assert.strictEqual(m.tier, undefined, `${m.name}: a legal-only member must carry no tier`);
    assert.strictEqual(m.signature, undefined, `${m.name}: a legal-only member must carry nothing to render`);
  }
});

test("a blanket-impl 8-family item stays DROPPED (tier does not resurrect the impl filter)", async () => {
  const items = [
    { label: "into()", kind: VS.Method, sortText: "80000004", detail: "fn(self) -> T" },
    { label: "own()", kind: VS.Method, sortText: "7fffffff", detail: "fn(&self) -> u64" },
  ];
  const extractor = new RaCommandExtractor(async () => ({ items }));
  const members = await extractor.completeMembers(CURSOR);
  assert.deepStrictEqual(members.map((m) => m.name), ["own"]);
});

// ---------------------------------------------------------------------------
// TARGET 2: C# classifier overreach — the developer's own override.
// ---------------------------------------------------------------------------

test("a RESOLVED own ToString/Equals override stays tier 0 and renders", () => {
  const rows = [
    ["ToString", "string Stripe.ToString()"],
    ["Equals", "bool Stripe.Equals(Stripe? other)"], // IEquatable<T> pattern
    ["GetHashCode", "int Stripe.GetHashCode()"],
  ];
  for (const [label, doc] of rows) {
    const m = toCsCompletionMember(label, doc, "method");
    assert.strictEqual(m.tier, undefined, `${label}: own override must not be demoted`);
    assert.strictEqual(m.signature, doc, `${label}: own override keeps its signature`);
  }
});

test("a user type literally named Object keeps its members own", () => {
  const m = toCsCompletionMember("Value", "int Object.Value { get; }", "field");
  assert.strictEqual(m.tier, undefined, "bare Object is a USER type, not System.Object");
  assert.strictEqual(m.signature, "int Object.Value { get; }");
});

test("an unresolved own override with a pre-resolve detail keeps signature and tier 0", () => {
  // Roslyn items can carry a signature-shaped detail before resolve; the
  // four-name fallback must not fire when ANY signature evidence exists.
  const m = toCsCompletionMember("ToString", undefined, "method", "string Stripe.ToString()");
  assert.strictEqual(m.tier, undefined, "detail evidence beats the name fallback");
  assert.strictEqual(m.signature, "string Stripe.ToString()");
});

test("C# structural invariant: tier 1 implies NO signature, so arm D cannot remove a rendered C# line", () => {
  // The unresolved own-override mis-stamp (Equals with nothing resolved ->
  // tier 1) is claimed harmless because a signatureless member never renders.
  // Pin the implication across the whole input matrix.
  const labels = ["Equals", "GetHashCode", "GetType", "ToString", "AtlasId", "Count"];
  const docs = [
    undefined,
    "bool object.Equals(object? obj)",
    "string Stripe.ToString()",
    "(extension) TResult object.Field<TResult>(string name)",
    "int Stripe.AtlasId { get; set; }",
    "not a signature at all",
  ];
  for (const label of labels) {
    for (const doc of docs) {
      const m = toCsCompletionMember(label, doc, "method");
      if (m.tier === 1) {
        assert.strictEqual(
          m.signature,
          undefined,
          `${label} / ${doc}: a tier-1 C# member with a signature would VANISH from the block`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// TARGET 2 (Python): the dunder stamp and the seam it does not cover.
// ---------------------------------------------------------------------------

test("__init__ is tier 1 through the completion builder; lookalikes stay own", () => {
  assert.strictEqual(toPyCompletionMember("__init__", undefined, "method").tier, 1);
  assert.strictEqual(toPyCompletionMember("__init__extra", undefined, "method").tier, undefined);
  assert.strictEqual(toPyCompletionMember("_init_", undefined, "method").tier, undefined);
});

test("the documentSymbol builder does NOT stamp dunders (known seam, pinned)", () => {
  // toPySymbolMember is outside the phase's stamp; a dunder arriving via the
  // symbol descent carries no tier. Inert today (no tier consumer reads
  // symbol-built members), pinned so a future consumer trips this row.
  const m = toPySymbolMember("__init__", "(self, log_id: int) -> None", "method");
  assert.strictEqual(m.tier, undefined, "symbol path carries no tier stamp today");
});

// ---------------------------------------------------------------------------
// TARGET 3: gate integrity — a member dropped from the block is still legal.
// ---------------------------------------------------------------------------

test("the gate accepts a human typing a member the tier filter hid from the block", async () => {
  // Fixture re-pointed 2026-07-26 (final fix loop): this row originally drove
  // `clone()` with the blanket `-> Self` signature, but the live tuple-site
  // acceptance run graduated the Clone/ToOwned family into the shared
  // BLANKET_IMPLS table, so that shape now drops at the TRANSPORT and never
  // reaches members at all (its own row lives in impl-v27-tier). The
  // invariant this row pins is unchanged and needs a member that stays: an
  // 8-family extension-trait method — dropped from the block by TIER, still
  // in the enforcement set.
  const items = [
    { label: "log_id", kind: VS.Field, sortText: "7fffffd9", detail: "u64" },
    { label: "seal()", kind: VS.Method, sortText: "7fffffff", detail: "fn(&mut self)" },
    { label: "write_events()", kind: VS.Method, sortText: "80000005", detail: "fn(&mut self, &[Event]) -> Result<()>" },
  ];
  const extractor = new RaCommandExtractor(async () => ({ items }));
  const members = await extractor.completeMembers(CURSOR);

  // The enforcement set is built from ALL members (completionProvider.ts:509),
  // never from the block. Mirror that construction here.
  const memberNames = members.map((m) => m.name);
  const block = renderFimCandidates(members, "");
  assert.ok(block !== undefined);
  assert.ok(!block.includes("write_events"), "tier-1 write_events left the block");
  assert.ok(memberNames.includes("write_events"), "write_events still in the enforcement set");
  assert.strictEqual(
    ghostNamesMember("write_events()", "", memberNames),
    true,
    "the gate must accept a completion the block chose not to show",
  );
  assert.strictEqual(ghostNamesMember("writ_events()", "", memberNames), false, "control: inventions still refused");
});

test("an all-tier-1 surface at empty partial renders NO block but the names still gate", () => {
  const members = [
    { name: "clone", signature: "clone(&self) -> Self", kind: "method", tier: 1 },
    { name: "to_owned", signature: "to_owned(&self) -> Self", kind: "method", tier: 1 },
  ];
  assert.strictEqual(renderFimCandidates(members, ""), undefined, "nothing own, nothing shown");
  const names = members.map((m) => m.name);
  assert.strictEqual(ghostNamesMember("clone()", "", names), true, "names travel independently of the block");
});

test("typed partial still narrows: tier-1 clone renders under 'cl', own members under 'se'", () => {
  const members = [
    { name: "clone", signature: "clone(&self) -> Self", kind: "method", tier: 1 },
    { name: "seal", signature: "seal(&mut self)", kind: "method", tier: 0 },
  ];
  const cl = renderFimCandidates(members, "cl");
  assert.ok(cl !== undefined && cl.includes("clone"), "human steering toward clone sees clone");
  const se = renderFimCandidates(members, "se");
  assert.ok(se !== undefined && se.includes("seal") && !se.includes("clone"));
});

// ---------------------------------------------------------------------------
// TARGET 4: reject-reason line edges.
// ---------------------------------------------------------------------------

const SERVICE_CONFIG = {
  apiBase: "http://127.0.0.1:11434",
  model: "qwen2.5-coder:7b-instruct",
  keepAlive: "30m",
  maxPromptBytes: 8192,
  timeoutMs: 1000,
};

test("reject with EMPTY offered text still prints the refusing check on one line", () => {
  const lines = [];
  const service = new FnGenService(SERVICE_CONFIG, async () => ({ text: "", ttftMs: 0, totalMs: 0 }), (l) =>
    lines.push(l),
  );
  service.logOutcome("reject", { refusedBy: "preview-tab-closed", offered: "" });
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /^\[fngen\] outcome=reject refused-by=preview-tab-closed offered=$/);
  assert.ok(!lines[0].includes("\n"), "the evidence stays one line");
});

test("CRLF and long offered text stay one trimmed, capped line", () => {
  const lines = [];
  const service = new FnGenService(SERVICE_CONFIG, async () => ({ text: "", ttftMs: 0, totalMs: 0 }), (l) =>
    lines.push(l),
  );
  service.logOutcome("reject", { refusedBy: "human-gesture", offered: "\r\n  first\r\nsecond" });
  service.logOutcome("reject", { refusedBy: "human-gesture", offered: "x".repeat(400) });
  assert.strictEqual(lines[0], "[fngen] outcome=reject refused-by=human-gesture offered=first");
  assert.ok(lines[1].endsWith("..."), "long offer capped");
  assert.ok(lines[1].length < 260, "capped line stays log-friendly");
  for (const l of lines) {
    assert.ok(!l.includes("\n") && !l.includes("\r"), "no multi-line reject evidence");
  }
});
