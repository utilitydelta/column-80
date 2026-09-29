// Phase 5 final adversarial review of session-v76 (whole working-tree change).
//
// Rows that FAIL state a defect; rows that pass are evidence that a suspected
// defect is not there. Each row names its finding number in the review report.
//
// Run: node --test --test-concurrency=1 test/review-v76-p5.test.cjs
// The live row needs rust-analyzer on PATH (skips without it, SKIP_LIVE=1 skips).

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

const { mod: core, cleanup } = bundleCore(
  "review-v76-p5-core",
  `export { RaLspExtractor } from "../src/core/raLspClient";
export { resolveCrossFileShape } from "../src/core/crossFileShape";
export { renderMemberSignature } from "../src/core/extraction";
export { memberNameOf } from "../src/core/repairGate";\n`,
);
test.after(() => cleanup());


// ---------------------------------------------------------------------------
// Finding 2 (evidence, passes): the leading `async `/`unsafe ` on a rendered
// member does not break the parsers that read rendered member lines.
test("F2: memberNameOf reads the name past a kept qualifier", () => {
  assert.equal(core.renderMemberSignature("settle", "async fn(&self) -> u32"), "async settle(&self) -> u32");
  assert.equal(core.memberNameOf("async settle(&self) -> u32"), "settle");
  assert.equal(core.memberNameOf("unsafe from_raw(u32) -> Self"), "from_raw");
});

// ---------------------------------------------------------------------------
// Finding 4 (LOW, live): a HAND-WRITTEN struct wrapped in a pass-through macro
// (the `pin_project!` / `cfg_if!` shape) with its `impl` outside the macro.
// The gate calls it macro-generated and the channel says its members are
// unknown, while documentSymbol lists `impl Wrapped { make, x }` in the same
// file. Not a regression (HEAD rendered nothing either, after spending 120ms of
// settle on it), but the words are wrong and the members are one outline away.
const SKIP_LIVE = process.env.SKIP_LIVE === "1";
const raOnPath = (() => {
  try {
    execFileSync("rust-analyzer", ["--version"], { timeout: 30_000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("F4: a wrapped hand-written struct with an outside impl keeps its outline members", { timeout: 300_000, todo: "S76-7" }, async (ctx) => {
  if (SKIP_LIVE) return ctx.skip("SKIP_LIVE=1");
  if (!raOnPath) return ctx.skip("rust-analyzer not on PATH");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-v76-p5-"));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "review-v76-p5-target-"));
  fs.mkdirSync(path.join(root, "src"));
  const src = {
    "Cargo.toml": '[package]\nname = "p5probe"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\n',
    "src/lib.rs": "#[macro_export]\nmacro_rules! wrap { ($($t:tt)*) => { $($t)* } }\npub mod a;\npub mod b;\n",
    "src/a.rs":
      "crate::wrap! {\n    pub struct Wrapped {\n        pub x: u32,\n    }\n}\n\nimpl Wrapped {\n    pub fn make() -> Self {\n        Wrapped { x: 1 }\n    }\n    pub fn x(&self) -> u32 {\n        self.x\n    }\n}\n\npub struct Plain {\n    pub w: Wrapped,\n}\n",
    "src/b.rs": "use crate::a::Plain;\n\npub fn f(p: Plain) -> u32 {\n    p.w.x()\n}\n",
  };
  for (const [f, t] of Object.entries(src)) fs.writeFileSync(path.join(root, f), t);
  const files = {};
  for (const f of ["src/lib.rs", "src/a.rs", "src/b.rs"]) files[pathToFileURL(path.join(root, f)).href] = src[f];
  const saved = process.env.CARGO_TARGET_DIR;
  process.env.CARGO_TARGET_DIR = target;
  let ex;
  try {
    ex = await core.RaLspExtractor.start({ workspaceRoot: root });
    for (const [u, t] of Object.entries(files)) ex.openDocument(u, t);
    await ex.whenReady(240_000);
    const bUri = pathToFileURL(path.join(root, "src/b.rs")).href;
    const aUri = pathToFileURL(path.join(root, "src/a.rs")).href;
    const line = src["src/b.rs"].split("\n").findIndex((l) => l.includes("p: Plain"));
    const site = { uri: bUri, line, character: src["src/b.rs"].split("\n")[line].indexOf("Plain") + 1 };
    const shape = await core.resolveCrossFileShape(ex, site, { D_MAX: 2, N_MAX: 8 }, async (u) => files[u]);
    const outline = await ex.documentSymbolsForTest(aUri);
    const implKids = (outline.find((s) => s.name === "impl Wrapped")?.children ?? []).map((c) => c.name);
    assert.ok(shape.types.has("Wrapped"), "readiness: the walk must reach Wrapped");
    assert.deepEqual(implKids, ["make", "x"], "readiness: the outline must list the hand-written impl");
    const methods = shape.types.get("Wrapped").methods;
    assert.ok(
      methods.some((m) => /^make\(/.test(m)),
      `Wrapped rendered methods ${JSON.stringify(methods)} while the outline lists impl Wrapped { ${implKids.join(", ")} }; ` +
        `macroGenerated=${JSON.stringify(shape.macroGenerated)}`,
    );
  } finally {
    if (saved === undefined) delete process.env.CARGO_TARGET_DIR;
    else process.env.CARGO_TARGET_DIR = saved;
    try {
      ex && ex.dispose();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});
