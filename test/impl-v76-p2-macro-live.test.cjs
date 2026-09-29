// session-v76 C1-C3, live: the headless rust-analyzer transport over the
// macro-ID fixture crate. A macro-generated type gets its members from
// completion at an existing `Type::` path, with signatures, and one with no
// path is reported with none. Nothing is edited: no didChange reaches the
// server from the walk.
//
// Live only; SKIP_LIVE=1 skips it. Runs on a scratch copy so rust-analyzer's
// target/ never lands in the repo fixture.
//
// Run: node --test test/impl-v76-p2-macro-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const FIXTURE = path.join(__dirname, "fixtures", "extraction-macro-ids");

const { mod, cleanup } = bundleCore(
  "impl-v76-p2-macro-live",
  `export { RaLspExtractor } from "../src/core/raLspClient";
export { resolveCrossFileShape } from "../src/core/crossFileShape";\n`,
);
test.after(cleanup);

test("live: macro members arrive with signatures, GhostId has none, nothing is edited", { skip: SKIP, timeout: 240_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v76-p2-"));
  fs.cpSync(FIXTURE, dir, { recursive: true, filter: (s) => !s.split(path.sep).includes("target") });
  const ra = await mod.RaLspExtractor.start({ workspaceRoot: dir });
  const uriOf = (f) => pathToFileURL(path.join(dir, "src", f)).href;
  const opened = new Map();
  const openFile = async (uri) => {
    if (!opened.has(uri)) {
      const p = new URL(uri).pathname;
      if (!fs.existsSync(p)) return undefined;
      const text = fs.readFileSync(p, "utf8");
      ra.openDocument(uri, text);
      opened.set(uri, text);
    }
    return opened.get(uri);
  };
  try {
    for (const f of ["lib.rs", "ids.rs", "key.rs", "plain.rs"]) await openFile(uriOf(f));
    await ra.whenReady();
    // Warm: the index answers an existing path before the walk is timed.
    const key = opened.get(uriOf("key.rs")).split("\n");
    const pathLine = key.findIndex((l) => l.includes("TenantId::new(1)"));
    const pathAt = { uri: uriOf("key.rs"), line: pathLine, character: key[pathLine].indexOf("TenantId::") + 10 };
    const site = await ra.completeMembers(pathAt);
    assert.ok(site.some((m) => m.name === "new"), JSON.stringify(site));
    // C1 at the member site: the `const fn` members carry signatures.
    const signed = Object.fromEntries(site.filter((m) => m.viaTrait === undefined).map((m) => [m.name, m.signature]));
    assert.strictEqual(signed.new, "new(u128) -> TenantId");
    assert.strictEqual(signed.get, "get(self) -> u128");
    assert.strictEqual(signed.is_sentinel, "is_sentinel(self) -> bool");

    const sent = [];
    const request = ra.request.bind(ra);
    ra.request = (method, params) => {
      sent.push(method);
      return request(method, params);
    };
    const notify = ra.notify.bind(ra);
    ra.notify = (method, params) => {
      sent.push(method);
      return notify(method, params);
    };
    const rootLine = key.findIndex((l) => l.startsWith("pub struct StreamKey"));
    const shape = await mod.resolveCrossFileShape(
      ra,
      { uri: uriOf("key.rs"), line: rootLine, character: key[rootLine].indexOf("StreamKey") },
      { D_MAX: 2, N_MAX: 8 },
      openFile,
    );
    for (const t of ["TenantId", "StreamId"]) {
      // Server order, which is not declaration order; the set is the contract.
      assert.deepStrictEqual(
        [...(shape.types.get(t)?.methods ?? [])].sort(),
        ["get(self) -> u128", "is_sentinel(self) -> bool", `new(u128) -> ${t}`],
        `${t}: ${JSON.stringify([...shape.types.values()])}`,
      );
    }
    const ghost = (shape.macroGenerated ?? []).find((n) => n.type === "GhostId");
    assert.ok(ghost && ghost.pathAt === undefined, JSON.stringify(shape.macroGenerated));
    assert.strictEqual(sent.filter((m) => m === "textDocument/completion").length, 2, sent.join(","));
    assert.strictEqual(sent.filter((m) => m === "textDocument/didChange").length, 0, sent.join(","));
  } finally {
    ra.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
