// Loop 2 adversarial review of the v76 macro-member memo.
//
// The memo lives in a WeakMap keyed on the extractor object, and the contract
// (amendment 1) reads "one ask per type per extractor (server session)". These
// rows drive the PRODUCT registry (`extractorFor` in src/vscode/extractors.ts)
// under a vscode stub and ask whether the memo holds across two FIM keystrokes
// and across an edit to a file that is not the def file.
//
// Run: node --test test/review-v76-p2b.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const tag = "review-v76-p2b";
const entry = path.join(__dirname, `.${tag}.entry.ts`);
const stub = path.join(__dirname, `.${tag}.vscode-stub.cjs`);
const outfile = path.join(__dirname, `.${tag}.bundle.cjs`);

// A vscode stub whose executeCommand is swapped per row.
fs.writeFileSync(
  stub,
  `class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(s, e) { this.start = s; this.end = e; } }
const state = (globalThis.__v76p2bState ??= { handler: async () => undefined });
module.exports = {
  __state: state,
  Position, Range,
  Uri: { parse: (s) => ({ toString: () => s, fsPath: s }) },
  commands: { executeCommand: (...a) => state.handler(...a) },
  workspace: { textDocuments: [], getConfiguration: () => ({ get: () => undefined }) },
};
`,
);
fs.writeFileSync(
  entry,
  `export { extractorFor } from "../src/vscode/extractors";
export { macroMembersViaPath } from "../src/core/macroMembers";
`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: stub },
});
const mod = require(outfile);
const vscode = require(stub);
test.after(() => {
  for (const f of [entry, stub, outfile]) fs.rmSync(f, { force: true });
});

const DEF = "file:///ids.rs";
const USE = "file:///key.rs";
const DEF_CURSOR = { uri: DEF, line: 0, character: 12 };
const loc = (uri, line, s, e) => ({
  uri: { toString: () => uri },
  range: { start: { line, character: s }, end: { line, character: e } },
});

function world(members, def = DEF) {
  const calls = { references: 0, completion: 0 };
  const files = { [def]: "newtype_id!(TenantId);\n", [USE]: "fn f() { let t = TenantId::new(1); }\n" };
  vscode.__state.handler = async (command) => {
    if (command === "vscode.executeReferenceProvider") {
      calls.references++;
      return [loc(def, 0, 12, 20), loc(USE, 0, 17, 25)];
    }
    if (command === "vscode.executeCompletionItemProvider") {
      calls.completion++;
      return { items: members.map((n) => ({ label: n, detail: `const fn() -> u128`, kind: 1 })) };
    }
    return undefined;
  };
  return { calls, files, openFile: async (u) => files[u] };
}

test("two FIM keystrokes on the product transport make one references() ask, not two", async () => {
  const w = world(["new", "get"]);
  // What completionProvider.ts:569 does on each keystroke.
  const first = await mod.macroMembersViaPath(mod.extractorFor("rust"), DEF_CURSOR, "TenantId", w.openFile);
  assert.ok(first.pathAt, "the first keystroke found the path");
  await mod.macroMembersViaPath(mod.extractorFor("rust"), DEF_CURSOR, "TenantId", w.openFile);
  assert.equal(
    w.calls.references,
    1,
    "extractorFor builds a fresh RaCommandExtractor per call, so the WeakMap memo never hits across keystrokes",
  );
});

// Amendment 2: every memo entry expires after 30s. Inside the window a stale
// answer is allowed and costs no asks; at 30s the next walk re-asks and serves
// what the server lists now. Its own def uri, so a memo shared across rows
// (one Rust extractor per host) cannot leak row 1's entry in here.
test("a method added to the macro body in another file is seen once the 30s window ends", async () => {
  const def = "file:///ids-stale.rs";
  const cursor = { ...DEF_CURSOR, uri: def };
  let clock = 1_000_000;
  const now = () => clock;
  const w = world(["new", "get"], def);
  const ex = mod.extractorFor("rust");
  await mod.macroMembersViaPath(ex, cursor, "TenantId", w.openFile, now);
  assert.deepEqual(w.calls, { references: 1, completion: 1 }, "the first walk asks once each");

  // The macro_rules! body lives in macros.rs; the def file is unchanged.
  const w2 = world(["new", "get", "added"], def);
  clock += 29_999;
  const inside = await mod.macroMembersViaPath(ex, cursor, "TenantId", w2.openFile, now);
  assert.deepEqual(inside.members.map((m) => m.name).sort(), ["get", "new"], "inside the window the memo answers");
  assert.deepEqual(w2.calls, { references: 0, completion: 0 }, "a memo hit inside the window makes zero asks");

  clock += 1; // exactly 30s after the entry was written
  const after = await mod.macroMembersViaPath(ex, cursor, "TenantId", w2.openFile, now);
  assert.deepEqual(w2.calls, { references: 1, completion: 1 }, "at 30s the entry has expired and the walk re-asks");
  assert.deepEqual(
    after.members.map((m) => m.name).sort(),
    ["added", "get", "new"],
    "after expiry the walk serves the members the server lists now",
  );
});
