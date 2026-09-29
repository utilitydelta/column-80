// session-v76 C1: a rust-analyzer completion detail that starts with a function
// qualifier still maps to a member WITH a signature, on both transports.
// `async` and `unsafe` change how a caller writes the call, so they stay in the
// rendered line; `const` changes nothing for a caller and is dropped.
//
// Run: node --test test/impl-v76-p2-qualified-fn.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// raExtractor imports vscode for its runner factory only; the class under test
// never touches it, so an empty stub is enough.
const STUB = path.join(__dirname, ".impl-v76-p2-qfn-vscode.cjs");
const ENTRY = path.join(__dirname, ".impl-v76-p2-qfn.entry.ts");
const OUT = path.join(__dirname, ".impl-v76-p2-qfn.bundle.cjs");
fs.writeFileSync(STUB, "module.exports = {};\n");
fs.writeFileSync(
  ENTRY,
  `export { toCompletionMember, parseMemberLabel, renderMemberSignatures } from "../src/core/extraction";
export { RaCommandExtractor } from "../src/vscode/raExtractor";\n`,
);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { toCompletionMember, parseMemberLabel, renderMemberSignatures, RaCommandExtractor } = require(OUT);
test.after(() => [STUB, ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

const ROWS = [
  // [label, detail, kind, expected signature]
  ["level", "fn(&self) -> u32", "method", "level(&self) -> u32"],
  ["new", "const fn(u128) -> TenantId", "function", "new(u128) -> TenantId"],
  ["get", "const fn(self) -> u128", "method", "get(self) -> u128"],
  ["level_unchecked", "unsafe fn(&self) -> u32", "method", "unsafe level_unchecked(&self) -> u32"],
  ["settle", "async fn(&self) -> u32", "method", "async settle(&self) -> u32"],
  ["from_raw", "const unsafe fn(u32) -> Gauge", "function", "unsafe from_raw(u32) -> Gauge"],
  ["both", "async unsafe fn(&self)", "method", "async unsafe both(&self)"],
  // Not a function detail: no signature, as before.
  ["SENTINEL", "pub const SENTINEL: Self", "method", undefined],
  ["constant", "const u32", "function", undefined],
  ["fnord", "fnord", "method", undefined],
];

test("a qualified fn detail keeps its signature; async and unsafe stay visible", () => {
  for (const [label, detail, kind, want] of ROWS) {
    const m = toCompletionMember(label, detail, kind);
    assert.strictEqual(m.signature, want, `row ${label} / ${JSON.stringify(detail)}`);
  }
});

test("the rendered surface carries the qualified members instead of dropping them", () => {
  const members = ROWS.slice(0, 7).map(([l, d, k]) => toCompletionMember(l, d, k));
  const lines = renderMemberSignatures(members).split("\n");
  assert.deepStrictEqual(lines, ROWS.slice(0, 7).map((r) => r[3]));
});

test("trait provenance parses from both label forms rust-analyzer prints", () => {
  const rows = [
    ["clone(as Clone)", "clone", "Clone"],
    ["fmt(use std::fmt::Debug)", "fmt", "Debug"],
    ["hash(…)(use std::hash::Hash)", "hash", "Hash"],
    ["new(…)", "new", undefined],
    ["get", "get", undefined],
  ];
  for (const [label, name, via] of rows) {
    assert.deepStrictEqual(parseMemberLabel(label), via === undefined ? { name } : { name, viaTrait: via }, label);
  }
});

// The VS Code host's rust-analyzer puts the trait in the label OBJECT's `detail`
// (`{ label: "clone", detail: "(as Clone)" }`), measured on the host tier over
// the fixture crate. The product transport has to read it there or every trait
// member looks inherent.
test("product transport reads trait provenance off the label object", async () => {
  const items = [
    { label: { label: "new", description: "const fn(u128) -> TenantId" }, kind: 2, detail: "const fn(u128) -> TenantId", sortText: "7fffffc5" },
    { label: { label: "eq", detail: "(as PartialEq)", description: "fn(&self, &Rhs) -> bool" }, kind: 1, detail: "fn(&self, &Rhs) -> bool", sortText: "80000000" },
    { label: { label: "SENTINEL", detail: " = TenantId(0)", description: "pub const SENTINEL: Self" }, kind: 20, detail: "pub const SENTINEL: Self", sortText: "7ffffff6" },
    { label: { label: "fmt", detail: "(use std::fmt::Debug)", description: "fn(&self, &mut Formatter<'_>) -> Result<(), Error>" }, kind: 1, detail: "fn(&self, &mut Formatter<'_>) -> Result<(), Error>", sortText: "80000007" },
  ];
  const ex = new RaCommandExtractor(async () => ({ items }));
  const got = (await ex.completeMembers({ uri: "file:///k.rs", line: 0, character: 0 })).map((m) => [m.name, m.viaTrait, m.signature]);
  assert.deepStrictEqual(got, [
    ["new", undefined, "new(u128) -> TenantId"],
    ["eq", "PartialEq", "eq(&self, &Rhs) -> bool"],
    ["SENTINEL", undefined, undefined],
    ["fmt", "Debug", "fmt(&self, &mut Formatter<'_>) -> Result<(), Error>"],
  ]);
});
