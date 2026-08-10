// Blind oracle: the slice-2 behavioral oracle [slice2-surface.md "Oracles and
// falsification bars" + "The loop"]. Wires the compiler-directed loop from the
// public pieces - generateInstruct (30b) to write bloom_demo, RustOracle to
// cargo-check the splice, classifyHallucination + a headless RaLspExtractor +
// assembleSurfacePayload + assembleRepairPrompt(surface) to inject the crate's
// real surface on a hallucination class, plain assembleRepairPrompt otherwise -
// against the fastbloom fngen-bench fixture. The frozen bar is BEHAVIORAL, not
// typecheck: the crate must COMPILE and `cargo test` (reports_inserted_item_
// present) must PASS within 2 repair rounds (3 generations total), at temp 0.7.
// The injection ROUTE is not frozen (the surface's note); compile+behavior pass
// within the cap is. The [repair] round counter never exceeds 2.
//
// Every cargo/RA run happens on a per-test scratch copy of the committed
// fixture; the repo fixture is read-only donor material [surface: "scratch
// copy"]. Offline: CARGO_NET_OFFLINE=true, deps in the shared cargo registry
// cache. Requires ollama (qwen3-coder:30b, numGpu 30 per the carve) +
// rust-analyzer + cargo. Live only; SKIP_LIVE=1 skips it cleanly.
//
// Run live: node --test --test-concurrency=1 test/blind7-loop-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 600_000; // cold RA index + up to 3 model rounds + cargo builds
const READY_TIMEOUT = 120_000; // generous whenReady per the task
const MAX_REPAIR_ROUNDS = 2; // product invariant 4: never more than 2 rounds

const API_BASE = "http://localhost:11434";
const MODEL = "qwen3-coder:30b";

const { mod, cleanup } = bundleCore(
  "blind7-loop-live",
  `export { classifyHallucination, assembleSurfacePayload, typesNamedIn } from "../src/core/compilerDirected";
export { RaLspExtractor } from "../src/core/raLspClient";
export { renderMemberSignatures } from "../src/core/extraction";
export { RustOracle, runOracleCheck } from "../src/core/compilerOracle";
export { generateInstruct, listModels } from "../src/core/ollama";
export { postprocessInstructOutput } from "../src/core/instructPostprocess";
export { assembleFnGenPrompt } from "../src/core/prompt";
export { assembleRepairPrompt } from "../src/core/repair";\n`
);
const {
  classifyHallucination,
  assembleSurfacePayload,
  typesNamedIn,
  RaLspExtractor,
  renderMemberSignatures,
  RustOracle,
  runOracleCheck,
  generateInstruct,
  listModels,
  postprocessInstructOutput,
  assembleFnGenPrompt,
  assembleRepairPrompt,
} = mod;
test.after(cleanup);

const FIXTURE = path.join(__dirname, "fixtures", "fngen-bench");

// The task the loop is given: the fixture's header signature + doc.
const SIGNATURE = "fn bloom_demo() -> bool";
const DOC = [
  '/// Build a bloom filter sized for roughly 1000 expected items, insert the',
  '/// string "hello" into it, then return whether the filter reports "hello"',
  '/// as present. Use the `fastbloom` crate (already a dependency).',
].join("\n");

const GEN_START = "// GEN-START";
const GEN_END = "// GEN-END";

// Scratch copy per run; the repo fixture is read-only. target/ is gitignored
// and rebuilt offline from the registry cache, so it is skipped for a clean
// build in the scratch dir (same posture as blind6-ra-live).
const scratchCopy = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blind7-loop-"));
  fs.cpSync(FIXTURE, dir, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes("target"),
  });
  return dir;
};

// The real injectable runners for the oracle and for the behavior test.
const realFs = { fileExists: (p) => fs.existsSync(p) };
const realRunner = () => (cmd) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: { ...process.env, CARGO_NET_OFFLINE: "true" } });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, exitCode: code }));
  });

const runCargo = (args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn("cargo", args, { cwd, env: { ...process.env, CARGO_NET_OFFLINE: "true" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code }));
  });

// Overwrite the region between the GEN markers with a generated function body.
const spliceGen = (text, body) => {
  const s = text.indexOf(GEN_START);
  const e = text.indexOf(GEN_END);
  assert.ok(s >= 0 && e > s, "fixture sanity: the GEN-START/GEN-END markers bound the spliced region");
  return text.slice(0, s + GEN_START.length) + "\n" + body + "\n" + text.slice(e);
};

// The current generated function text between the markers (the repair `code`).
const currentGen = (text) => {
  const s = text.indexOf(GEN_START) + GEN_START.length;
  const e = text.indexOf(GEN_END);
  return text.slice(s, e).trim();
};

const generate = (prompt) =>
  generateInstruct({
    apiBase: API_BASE,
    model: MODEL,
    prompt,
    maxTokens: 512,
    temperature: 0.7, // the measured falsification temperature
    numGpu: 30, // reference carve discipline
    signal: new AbortController().signal,
  });

test("precondition: live ollama is up and the fn-gen model is pulled", { skip: SKIP, timeout: LIVE_TIMEOUT }, async () => {
  const tags = await listModels(API_BASE);
  assert.ok(Array.isArray(tags), "server reachable");
  assert.ok(tags.includes(MODEL), `${MODEL} must be pulled; got ${JSON.stringify(tags)}`);
});

test(
  "behavioral oracle: the compiler-directed loop converges the fastbloom builder task to COMPILE + behavior pass within 2 repair rounds at temp 0.7",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    process.env.CARGO_NET_OFFLINE = "true";

    const workspaceRoot = scratchCopy();
    const mainPath = path.join(workspaceRoot, "src", "main.rs");
    const uri = pathToFileURL(mainPath).href;

    const oracle = new RustOracle(realFs);
    const doCheck = () => runOracleCheck(oracle, mainPath, { runCommand: realRunner(), log: () => {} });

    const extractor = await RaLspExtractor.start({ workspaceRoot });
    try {
      extractor.openDocument(uri, fs.readFileSync(mainPath, "utf8"));
      await extractor.whenReady(READY_TIMEOUT);

      // ---- Round-1 pre-fill: resolve the types the signature/doc name up
      // front. The fastbloom task names only the crate in prose, so pre-fill is
      // empty and the loop starts blind - finding 7's proven path.
      const preFillTypes = typesNamedIn(SIGNATURE, DOC);
      let injectedSurface = "";
      for (const typeName of preFillTypes) {
        // No `::` cursor exists before a generation; the honest degrade is to
        // leave pre-fill empty when a type cannot be resolved to a site.
        void typeName;
      }

      // ---- Generation 1 (blind): assembleFnGenPrompt + 30b, splice, check.
      const genPrompt = assembleFnGenPrompt({
        signature: SIGNATURE,
        docComment: DOC,
        languageId: "rust",
        injectedSurface,
      });
      const firstBody = postprocessInstructOutput((await generate(genPrompt)).text);
      assert.ok(firstBody, "generation 1 produced a function body");
      fs.writeFileSync(mainPath, spliceGen(fs.readFileSync(mainPath, "utf8"), firstBody));
      extractor.applyEdit(uri, fs.readFileSync(mainPath, "utf8"));

      let checkResult = await doCheck();
      assert.ok(checkResult, "the oracle resolved a crate root and ran");

      // ---- Repair loop, capped at 2 rounds. On a hallucination class, resolve
      // the crate's real surface (example else signatures) and inject it via
      // assembleRepairPrompt(surface); otherwise plain v1 repair.
      let round = 0;
      while (!checkResult.success && round < MAX_REPAIR_ROUNDS) {
        round++;
        assert.ok(round <= MAX_REPAIR_ROUNDS, `cap invariant: a round beyond ${MAX_REPAIR_ROUNDS} happened (round=${round})`);

        const errors = checkResult.diagnostics.filter((d) => d.level === "error");

        let surface = "";
        let hallucination;
        for (const d of errors) {
          const cls = classifyHallucination(d);
          if (cls) {
            hallucination = cls;
            break;
          }
        }
        if (hallucination && hallucination.kind !== "unresolved-crate") {
          const cursor = { uri, line: hallucination.cursor.line, character: hallucination.cursor.character };
          const typeOrCrate = hallucination.type ?? hallucination.crate;
          let example;
          let signatures;
          try {
            example = await extractor.example(cursor);
          } catch {
            example = undefined;
          }
          if (!example) {
            try {
              const members = await extractor.completeMembers(cursor);
              if (members && members.length > 0) {
                signatures = renderMemberSignatures(members);
              }
            } catch {
              signatures = undefined;
            }
          }
          surface = assembleSurfacePayload({ typeOrCrate, example, signatures });
        }

        const code = currentGen(fs.readFileSync(mainPath, "utf8"));
        const repairInput = { languageId: "rust", docComment: DOC, code, diagnostics: errors };
        const prompt = surface
          ? assembleRepairPrompt({ ...repairInput, surface })
          : assembleRepairPrompt(repairInput);

        const fixed = postprocessInstructOutput((await generate(prompt)).text);
        if (fixed) {
          fs.writeFileSync(mainPath, spliceGen(fs.readFileSync(mainPath, "utf8"), fixed));
          extractor.applyEdit(uri, fs.readFileSync(mainPath, "utf8"));
        }
        // Wave semantics: re-check after every splice, never assume clean.
        checkResult = await doCheck();
      }

      // ---- Frozen behavioral bar: compile AND behavior pass within the cap.
      assert.ok(round <= MAX_REPAIR_ROUNDS, `cap invariant preserved: roundsUsed=${round} never exceeds ${MAX_REPAIR_ROUNDS}`);
      assert.strictEqual(checkResult.success, true, `the crate must COMPILE within ${MAX_REPAIR_ROUNDS} repair rounds (roundsUsed=${round})`);

      const testRun = await runCargo(["test"], workspaceRoot);
      assert.strictEqual(testRun.exitCode, 0, `behavior bar: cargo test must pass (reports_inserted_item_present)\n${testRun.stdout}\n${testRun.stderr}`);
      assert.match(testRun.stdout, /reports_inserted_item_present/, "the committed behavior test ran");
      assert.ok(/test result: ok\./.test(testRun.stdout), "cargo test reported ok, not a compiles-but-wrong pass");
    } finally {
      extractor.dispose();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }
);
