// Implementer oracle: the deterministic in-span import fix. A generated function
// that uses a resolvable-but-unimported type (`BloomFilter` with no `use`) is
// fixed by rust-analyzer's qualify assist alone - the bare name is rewritten to
// its full path INSIDE the function span, no `use` line, no model round, and the
// crate compiles. This is the "rely on cargo/rust/ast mechanics, not the LLM"
// path for imports; it proves the mechanism end to end against real RA + cargo.
//
// Live: needs rust-analyzer + cargo + the vendored fastbloom. SKIP_LIVE=1 skips.
//
// Run live: node --test --test-concurrency=1 test/impl8-qualify-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 180_000;

const { mod, cleanup } = bundleCore(
  "impl8-qualify",
  `export { RaLspExtractor } from "../src/core/raLspClient";
export { unresolvedNameCursor } from "../src/core/compilerDirected";
export { RustOracle, runOracleCheck } from "../src/core/compilerOracle";\n`
);
const { RaLspExtractor, unresolvedNameCursor, RustOracle, runOracleCheck } = mod;
test.after(cleanup);

const FIXTURE = path.join(__dirname, "fixtures", "fngen-bench");

const scratchCopy = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "impl8-qualify-"));
  fs.cpSync(FIXTURE, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes("target") });
  return dir;
};
const realRunner = () => (cmd) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: { ...process.env, CARGO_NET_OFFLINE: "true" } });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, exitCode: code }));
  });

// Apply a QualifyEdit (single-line rewrite) to source text.
const applyEdit = (text, edit) => {
  const lines = text.split("\n");
  const line = lines[edit.range.startLine];
  lines[edit.range.startLine] =
    line.slice(0, edit.range.startCharacter) + edit.newText + line.slice(edit.range.endCharacter);
  return lines.join("\n");
};

const GEN_START = "// GEN-START";
const GEN_END = "// GEN-END";
// A function using fastbloom types with NO `use` - the realistic case where the
// model wrote correct API calls but omitted the import.
const UNIMPORTED_BODY = [
  "fn bloom_demo() -> bool {",
  "    let mut f = BloomFilter::with_num_bits(1024).expected_items(1000);",
  '    f.insert(&"hello");',
  '    f.contains(&"hello")',
  "}",
].join("\n");

const spliceGen = (text, body) => {
  const s = text.indexOf(GEN_START);
  const e = text.indexOf(GEN_END);
  return text.slice(0, s + GEN_START.length) + "\n" + body + "\n" + text.slice(e);
};

test(
  "an unimported resolvable type is fixed in-span by the qualify assist alone, no `use` line, and the crate compiles",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    process.env.CARGO_NET_OFFLINE = "true";
    const workspaceRoot = scratchCopy();
    const mainPath = path.join(workspaceRoot, "src", "main.rs");
    const uri = pathToFileURL(mainPath).href;

    // Splice the unimported function AND remove the fixture's header `use` so the
    // only path to compilation is the qualify assist.
    let text = fs.readFileSync(mainPath, "utf8").replace("use fastbloom::BloomFilter;\n\n", "");
    text = spliceGen(text, UNIMPORTED_BODY);
    fs.writeFileSync(mainPath, text);

    const oracle = new RustOracle({ fileExists: (p) => fs.existsSync(p) });
    const doCheck = () => runOracleCheck(oracle, mainPath, { runCommand: realRunner(), log: () => {} });

    const extractor = await RaLspExtractor.start({ workspaceRoot });
    try {
      extractor.openDocument(uri, fs.readFileSync(mainPath, "utf8"));
      await extractor.whenReady(120000);

      // Deterministic loop: while an unresolved NAME error exists, qualify it in
      // place. No model, no `use` line. Bounded so a genuinely-unresolvable name
      // (no assist) cannot spin.
      for (let i = 0; i < 6; i++) {
        const check = await doCheck();
        if (check.success) break;
        const nameError = check.diagnostics
          .filter((d) => d.level === "error")
          .map((d) => unresolvedNameCursor(d))
          .find((c) => c !== undefined);
        if (!nameError) break;
        const edit = await extractor.qualifyImport({ uri, ...nameError });
        assert.ok(edit, "rust-analyzer offers a qualify assist for a resolvable unimported name");
        assert.match(edit.newText, /^fastbloom::/, `qualified to the full path, got ${JSON.stringify(edit.newText)}`);
        text = applyEdit(fs.readFileSync(mainPath, "utf8"), edit);
        fs.writeFileSync(mainPath, text);
        extractor.applyEdit(uri, text);
      }

      const finalText = fs.readFileSync(mainPath, "utf8");
      assert.ok(!/\buse fastbloom\b/.test(finalText), "no `use` line was added; the fix stayed in-span");
      assert.match(finalText, /fastbloom::BloomFilter::with_num_bits/, "the type was qualified in place");
      const check = await doCheck();
      assert.strictEqual(check.success, true, "the crate compiles after deterministic qualification, no model round");
    } finally {
      extractor.dispose();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }
);
