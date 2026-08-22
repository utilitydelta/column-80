// Blind oracle: the Go oracle's LIVE falsification rung (the v23 goal,
// GoOracle + falsification bar). REAL `go build -o /dev/null ./...` against
// throwaway modules in temp dirs, through the oracle's own buildCheckCommand /
// parseCheckOutput / checkSuccess / coverage pair, plus one runOracleCheck
// end-to-end pass over the real spawn seam. This reaches what the headless
// round-trip cannot: real receiver-named messages, the real killshot pair
// (byte-identical tree + the broken non-main package going red), the real
// unearned greens, the three cold-state remediations with a poisoned proxy
// proving zero network, and the real go.work refusal.
//
// Rung 1 is GROUND TRUTH (independent of GoOracle): real go build output has
// the stderr/`# pkg`/file:line:col shape the headless fixtures assume. It
// passes whether or not GoOracle exists. Rung 2 is oracle-driven: RED until
// src/core/goOracle.ts lands.
//
// Toolchain: /home/utilitydelta/.local/go/bin is prepended to PATH for every
// spawn. GOPROXY=off rides the oracle's own env pins, so nothing downloads;
// the vendoring fixture uses a local `replace` so `go mod vendor` is offline
// too. Skip with SKIP_LIVE, or automatically when no go binary is present.
//
// Run: node --test test/blind-v23-gooracle-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const GO_BIN_DIR = "/home/utilitydelta/.local/go/bin";
// Every spawn (direct and via runOracleCheck, which inherits process.env)
// sees the scratchpad toolchain first.
process.env.PATH = `${GO_BIN_DIR}:${process.env.PATH || ""}`;

const goPresent =
  fs.existsSync(path.join(GO_BIN_DIR, "go")) ||
  spawnSync("go", ["version"], { encoding: "utf8" }).status === 0;
const SKIP = process.env.SKIP_LIVE
  ? "SKIP_LIVE set"
  : !goPresent
    ? `go binary absent (looked in ${GO_BIN_DIR} and on PATH) - install Go 1.26 to run the live rung`
    : false;
const LIVE_TIMEOUT = 120_000;

// A stray GOWORK in the shell would flip every fixture into the workspace
// refusal; the walk cases below assume it is unset. The refusal test sets it
// per-case through real go.work files, not env.
const SAVED_GOWORK = process.env.GOWORK;
delete process.env.GOWORK;
test.after(() => {
  if (SAVED_GOWORK !== undefined) process.env.GOWORK = SAVED_GOWORK;
});

let mod = {};
let cleanupBundle = () => {};
let bundleError;
try {
  ({ mod, cleanup: cleanupBundle } = bundleCore(
    "blind-v23-gooracle-live",
    `export { GoOracle } from "../src/core/goOracle";\n` +
      `export { oracleFor, runOracleCheck } from "../src/core/compilerOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.GoOracle !== "function") {
  bundleError = new Error("the bundle built but exports no GoOracle class");
}
test.after(() => cleanupBundle());

const { GoOracle, oracleFor, runOracleCheck } = mod;

const scratch = [];
test.after(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });

const GO_MOD = "module x\n\ngo 1.26\n";

const writeModule = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v23-live-"));
  scratch.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
};

// Process env under, command env over: exactly the merge the runner performs.
// `extraProcessEnv` poisons the PROCESS side (e.g. an unreachable GOPROXY) to
// prove the command's own pins win and nothing touches the network.
const spawnEnv = (cmdEnv, extraProcessEnv = {}) => ({ ...process.env, ...extraProcessEnv, ...(cmdEnv || {}) });

const spawnGo = (args, cwd, extraProcessEnv = {}) =>
  spawnSync("go", args, { cwd, env: spawnEnv({ GOPROXY: "off", GOWORK: "off" }, extraProcessEnv), encoding: "utf8", timeout: LIVE_TIMEOUT });

// The oracle-driven check: spawn the oracle's own pinned command, feed the
// stderr stream (the command's own flag says that is where diagnostics live)
// to parseCheckOutput, and collect BOTH accepted text channels.
const runCheck = (oracle, root, extraProcessEnv = {}) => {
  const cmd = oracle.buildCheckCommand(root);
  const r = spawnSync(cmd.command, cmd.args, { cwd: cmd.cwd, env: spawnEnv(cmd.env, extraProcessEnv), encoding: "utf8", timeout: LIVE_TIMEOUT });
  assert.strictEqual(r.error, undefined, `the check spawned (${cmd.command} ${cmd.args.join(" ")}): ${r.error}`);
  const text = r.stderr || "";
  const diags = oracle.parseCheckOutput(text, root, Date.now() + 3_600_000);
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) || "";
  const described = typeof oracle.describeCheckFailure === "function" ? oracle.describeCheckFailure(r.status ?? 1, firstLine) || "" : "";
  const combined = diags.map((d) => d.message).join("\n") + "\n" + described;
  return { r, text, diags, combined, success: oracle.checkSuccess(r.stdout || "", r.status ?? 0) };
};

const snapshotTree = (root) => {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(path.relative(root, p), crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"));
    }
  };
  walk(root);
  return out;
};

const notImplemented = () => {
  if (bundleError) assert.fail(`the surface is not implemented yet: ${bundleError.message}`);
};

// The diagnostic's span must resolve to a real file at the module root.
const assertResolvable = (oracle, root, diag, expectRel, label) => {
  assert.ok(diag.spans && diag.spans.length >= 1, `${label}: the diagnostic carries a span`);
  const resolved = oracle.resolveDiagnosticPath(root, diag.spans[0].fileName);
  assert.ok(path.isAbsolute(resolved), `${label}: resolveDiagnosticPath yields an absolute path, got ${JSON.stringify(resolved)}`);
  assert.strictEqual(path.resolve(resolved), path.resolve(root, expectRel), `${label}: the path resolves to the real fixture file`);
  assert.ok(fs.existsSync(resolved), `${label}: the resolved file exists on disk`);
};

// The four-classes fixture, classes a/b/d in one main package. Class c lives
// in its own module: an unresolvable import aborts that package's type-check.
const ABD_MAIN = `package main

import "strings"

type Widget struct {
	Size int
}

func (w *Widget) Resize(n int) {
	w.Size = n
}

func main() {
	w := &Widget{}
	w.Resizee(3)
	_ = conjuredValue
	var b strings.Builder
	b.Grow(4)
	b.Finalise()
}
`;

// ---------------------------------------------------------------------------
// Rung 1: ground truth. Passes with no GoOracle - proves the output shape the
// headless fixtures were authored against, and warms GOCACHE for the rest.
// ---------------------------------------------------------------------------

test(
  "live ground-truth: go build -o /dev/null ./... writes diagnostics to STDERR as `# pkg` + file:line:col lines, stdout empty, exit 1 [surface: the parse contract of record + the stderr flag's premise]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  () => {
    const root = writeModule({ "go.mod": GO_MOD, "main.go": ABD_MAIN });
    const r = spawnGo(["build", "-o", "/dev/null", "./..."], root);
    assert.strictEqual(r.status, 1, `compile errors exit 1, got ${r.status} (stderr ${JSON.stringify((r.stderr || "").slice(0, 300))})`);
    assert.strictEqual(r.stdout, "", "stdout stays empty: everything rides stderr");
    assert.ok(/(^|\n)# x(\n|$)/.test(r.stderr), `the package header line is present, got ${JSON.stringify(r.stderr.slice(0, 200))}`);
    assert.ok(/(^|\n)(\.\/)?main\.go:\d+:\d+: /.test(r.stderr), `diagnostic lines are path:line:col: message, got ${JSON.stringify(r.stderr.slice(0, 300))}`);
    assert.ok(/has no field or method Resizee/.test(r.stderr), "the missing-member message is receiver-shaped");
    assert.ok(/undefined: conjuredValue/.test(r.stderr), "the undefined-name message is present");
    assert.ok(/type strings\.Builder has no field or method Finalise/.test(r.stderr), "the stdlib wrong-member message names the receiver type");
  }
);

// ---------------------------------------------------------------------------
// Rung 2: oracle-driven. RED until src/core/goOracle.ts lands.
// ---------------------------------------------------------------------------

test(
  "live: hallucination classes a/b/d parse from real output with absolute-resolvable paths and receiver-named messages [surface: falsification bar 'all four hallucination classes ... correct paths at a real module root']",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  () => {
    notImplemented();
    const root = writeModule({ "go.mod": GO_MOD, "main.go": ABD_MAIN });
    const oracle = new GoOracle();
    assert.strictEqual(oracle.detectCrateRoot(path.join(root, "main.go")), root, "the real go.mod places the file");
    const { success, diags } = runCheck(oracle, root);
    assert.strictEqual(success, false, "three hallucinations -> the verdict is red");

    const member = diags.find((d) => /has no field or method Resizee/.test(d.message));
    assert.ok(member, `class (a) missing method on a local type surfaced; got ${JSON.stringify(diags.map((d) => d.message))}`);
    assert.ok(member.message.includes("Widget"), "the message names the local receiver type");
    assert.strictEqual(member.kind, "compile-error");
    assertResolvable(oracle, root, member, "main.go", "class a");

    const undef = diags.find((d) => /undefined: conjuredValue/.test(d.message));
    assert.ok(undef, "class (b) undefined top-level name surfaced");
    assertResolvable(oracle, root, undef, "main.go", "class b");

    const stdlib = diags.find((d) => /strings\.Builder has no field or method Finalise/.test(d.message));
    assert.ok(stdlib, "class (d) wrong member on an imported stdlib type surfaced, receiver-type-named");
    assertResolvable(oracle, root, stdlib, "main.go", "class d");
  }
);

test(
  "live: class c + cold-state 1 - a package not in go.mod fails with 'no required module provides package' + the go get remediation, and NO network fetch (poisoned process GOPROXY never consulted) [surface: falsification bar 'surface the remediation, never run it' + the offline invariant]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  () => {
    notImplemented();
    const root = writeModule({
      "go.mod": GO_MOD,
      "main.go": 'package main\n\nimport "example.com/absent/pkg"\n\nfunc main() {\n\tpkg.Do()\n}\n',
    });
    const oracle = new GoOracle();
    // The process env points GOPROXY at a dead socket. If the oracle's own
    // env pin did not win, go would surface a connection error instead of
    // the honest remediation - and would have touched the network.
    const { success, text, diags, combined } = runCheck(oracle, root, { GOPROXY: "http://127.0.0.1:1" });
    assert.strictEqual(success, false, "the missing module is a failed check");
    assert.ok(/no required module provides package/.test(combined), `the honest message surfaces through the accepted channels, got ${JSON.stringify(combined.slice(0, 400))}`);
    assert.ok(/go get/.test(combined), `the go get remediation is surfaced (never run), got ${JSON.stringify(combined.slice(0, 400))}`);
    assert.ok(!/127\.0\.0\.1:1|connection refused|proxyconnect|dial tcp/i.test(text), `no proxy was consulted: the failure text is the remediation shape, not a network error; got ${JSON.stringify(text.slice(0, 400))}`);
    const diag = diags.find((d) => /no required module provides package/.test(d.message));
    assert.ok(diag, "the file-positioned import error arrives as a Diagnostic");
    assertResolvable(oracle, root, diag, "main.go", "class c");
  }
);

test(
  "live killshot 1: a module with exactly one main package is BYTE-IDENTICAL after a check - no binary dropped [surface: goal 'bare go build ./... drops a binary into the tree']",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  () => {
    notImplemented();
    const root = writeModule({ "go.mod": GO_MOD, "main.go": "package main\n\nfunc main() {}\n" });
    const before = snapshotTree(root);
    const oracle = new GoOracle();
    const { success, r } = runCheck(oracle, root);
    assert.strictEqual(r.status, 0, `the clean main package builds, stderr ${JSON.stringify((r.stderr || "").slice(0, 300))}`);
    assert.strictEqual(success, true, "exit 0 -> earned green");
    const after = snapshotTree(root);
    assert.deepStrictEqual([...after.keys()].sort(), [...before.keys()].sort(), `the file SET is unchanged (a dropped binary would appear here), got ${JSON.stringify([...after.keys()])}`);
    for (const [rel, hash] of before) {
      assert.strictEqual(after.get(rel), hash, `${rel} is byte-identical after the check`);
    }
  }
);

test(
  "live killshot 2: a broken NON-main package beside a clean main goes red - the case `-o <dir>` silently skips [surface: goal 'golang/go#37378 - the debate's killshot']",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  () => {
    notImplemented();
    const root = writeModule({
      "go.mod": GO_MOD,
      "main.go": "package main\n\nfunc main() {}\n",
      "lib/lib.go": "package lib\n\ntype Widget struct {\n\tSize int\n}\n\nfunc Bad() {\n\tvar w Widget\n\tw.Nope()\n}\n",
    });
    const oracle = new GoOracle();
    const { success, diags } = runCheck(oracle, root);
    assert.strictEqual(success, false, "the broken library package fails the whole-module check (the unearned green -o <dir> would have given)");
    const diag = diags.find((d) => /has no field or method Nope/.test(d.message));
    assert.ok(diag, `the library diagnostic surfaced, got ${JSON.stringify(diags.map((d) => d.message))}`);
    assertResolvable(oracle, root, diag, path.join("lib", "lib.go"), "killshot 2");
  }
);

test(
  "live: runOracleCheck end to end over the real spawn seam - probe, check, stderr diagnostics, red verdict [surface: the falsification bar's real-module-root run]",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  async () => {
    notImplemented();
    const root = writeModule({
      "go.mod": GO_MOD,
      "main.go": "package main\n\nfunc main() {}\n",
      "lib/lib.go": "package lib\n\ntype Widget struct {\n\tSize int\n}\n\nfunc Bad() {\n\tvar w Widget\n\tw.Nope()\n}\n",
    });
    const oracle = oracleFor("go") || new GoOracle();
    assert.strictEqual(oracle.language, "go", "oracleFor('go') resolves the Go strategy");
    const lines = [];
    const result = await runOracleCheck(oracle, path.join(root, "lib", "lib.go"), { log: (l) => lines.push(l) });
    assert.ok(result, `a real result resolves (logs: ${JSON.stringify(lines)})`);
    assert.strictEqual(result.success, false, "the broken package fails the verdict end to end");
    assert.strictEqual(path.resolve(result.crateRoot), path.resolve(root), "the crate root is the go.mod dir");
    assert.ok(result.diagnostics.some((d) => /has no field or method Nope/.test(d.message)), `the stderr diagnostics rode through the real runner, got ${JSON.stringify(result.diagnostics.map((d) => d.message))}`);
  }
);

test(
  "live unearned greens: //go:build ignore and a broken _test.go both build GREEN, and the coverage probe reports both not covered [surface: falsification bar 'both caught by the coverage probe']",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  () => {
    notImplemented();
    const root = writeModule({
      "go.mod": GO_MOD,
      "main.go": "package main\n\nfunc main() {}\n",
      "ignored.go": "//go:build ignore\n\npackage main\n\ntype Gauge struct {\n\tV int\n}\n\nfunc broken() {\n\tvar g Gauge\n\tg.Calibrate()\n}\n",
      "main_test.go": "package main\n\nimport \"testing\"\n\nfunc TestBroken(t *testing.T) {\n\tcompletelyUndefinedHelper()\n}\n",
    });
    const oracle = new GoOracle();
    const { success, r } = runCheck(oracle, root);
    assert.strictEqual(r.status, 0, `go build never sees the ignored file or the _test.go: exit 0, stderr ${JSON.stringify((r.stderr || "").slice(0, 300))}`);
    assert.strictEqual(success, true, "the green is real for what the check LOADED - the probe is what refuses trusting it for the excluded files");

    const cov = oracle.buildCoverageCommand(root);
    const pr = spawnSync(cov.command, cov.args, { cwd: cov.cwd, env: spawnEnv(cov.env), encoding: "utf8", timeout: LIVE_TIMEOUT });
    assert.strictEqual(pr.status, 0, `the probe ran, stderr ${JSON.stringify((pr.stderr || "").slice(0, 300))}`);
    assert.strictEqual(oracle.fileCovered(pr.stdout, root, path.join(root, "main.go")), true, "the compiled main.go is covered");
    assert.strictEqual(oracle.fileCovered(pr.stdout, root, path.join(root, "ignored.go")), false, "the //go:build ignore file with the hallucinated member is NOT covered: its green is unearned");
    assert.strictEqual(oracle.fileCovered(pr.stdout, root, path.join(root, "main_test.go")), false, "the broken _test.go is NOT covered: go build ignores _test.go entirely");
  }
);

test(
  "live cold-state 2: go.mod + go.sum present but the module cache empty -> the honest missing-cache/go.sum-shaped failure, never a silent download [surface: goal 'GOPROXY=off closes the residual go.sum-present cold-cache hole']",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  () => {
    notImplemented();
    const fakeHash = "h1:" + "A".repeat(43) + "=";
    const root = writeModule({
      "go.mod": "module x\n\ngo 1.26\n\nrequire example.com/dep v1.0.0\n",
      "go.sum": `example.com/dep v1.0.0 ${fakeHash}\nexample.com/dep v1.0.0/go.mod ${fakeHash}\n`,
      "main.go": 'package main\n\nimport "example.com/dep"\n\nfunc main() {\n\tdep.Do()\n}\n',
    });
    const modcache = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v23-modcache-"));
    scratch.push(modcache);
    const oracle = new GoOracle();
    // Fresh empty GOMODCACHE + a poisoned process GOPROXY: a silent download
    // would either fill the cache or die on the dead proxy.
    const { success, text, combined } = runCheck(oracle, root, { GOMODCACHE: modcache, GOPROXY: "http://127.0.0.1:1" });
    assert.strictEqual(success, false, "the cold cache is a failed check, not a silent fetch");
    assert.ok(
      /GOPROXY=off|lookup disabled|missing go\.sum|module cache|go mod download/i.test(combined),
      `the failure is the honest missing-cache/go.sum remediation shape, got ${JSON.stringify(combined.slice(0, 400))}`
    );
    assert.ok(!/127\.0\.0\.1:1|connection refused|proxyconnect|dial tcp/i.test(text), `the dead proxy was never consulted, got ${JSON.stringify(text.slice(0, 400))}`);
    assert.ok(!fs.existsSync(path.join(modcache, "example.com")), "nothing was downloaded into the fresh cache");
  }
);

test(
  "live cold-state 3: vendoring - a broken vendor tree surfaces 'inconsistent vendoring' through the accepted channels; a restored vendor tree checks clean [surface: goal 'a vendor/ dir auto-flips the go command to vendor mode']",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  () => {
    notImplemented();
    const root = writeModule({
      "go.mod": "module x\n\ngo 1.26\n\nrequire example.com/dep v0.0.0\n\nreplace example.com/dep => ./depsrc\n",
      "main.go": 'package main\n\nimport "example.com/dep"\n\nfunc main() {\n\tdep.Do()\n}\n',
      "depsrc/go.mod": "module example.com/dep\n\ngo 1.26\n",
      "depsrc/dep.go": "package dep\n\nfunc Do() {}\n",
    });
    // Fixture prep, not oracle behavior: vendor from the local replace (offline).
    const vend = spawnGo(["mod", "vendor"], root);
    assert.strictEqual(vend.status, 0, `go mod vendor prepared the fixture, stderr ${JSON.stringify((vend.stderr || "").slice(0, 300))}`);
    const modulesTxt = path.join(root, "vendor", "modules.txt");
    assert.ok(fs.existsSync(modulesTxt), "the vendor tree exists");

    const oracle = new GoOracle();
    fs.rmSync(modulesTxt);
    const broken = runCheck(oracle, root);
    assert.strictEqual(broken.success, false, "a vendor/ dir without modules.txt is a failed check, never a shrug");
    assert.ok(/inconsistent vendoring/i.test(broken.combined), `the inconsistent-vendoring text surfaces through diagnostics or describeCheckFailure, got ${JSON.stringify(broken.combined.slice(0, 400))} (raw stderr ${JSON.stringify(broken.text.slice(0, 200))})`);

    const revend = spawnGo(["mod", "vendor"], root);
    assert.strictEqual(revend.status, 0, `go mod vendor restored the tree, stderr ${JSON.stringify((revend.stderr || "").slice(0, 300))}`);
    const restored = runCheck(oracle, root);
    assert.strictEqual(restored.success, true, `the restored vendor tree checks clean, got ${JSON.stringify(restored.text.slice(0, 300))}`);
  }
);

test(
  "live: a real go.work parent over a real module -> detectCrateRoot undefined + the plain workspace refusal [surface: falsification bar 'a go.work parent makes check/repair refuse plainly']",
  { skip: SKIP, timeout: LIVE_TIMEOUT },
  () => {
    notImplemented();
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v23-ws-"));
    scratch.push(ws);
    fs.mkdirSync(path.join(ws, "mod"));
    fs.writeFileSync(path.join(ws, "go.work"), "go 1.26\n\nuse ./mod\n");
    fs.writeFileSync(path.join(ws, "mod", "go.mod"), GO_MOD);
    const file = path.join(ws, "mod", "main.go");
    fs.writeFileSync(file, "package main\n\nfunc main() {}\n");

    const oracle = new GoOracle();
    assert.strictEqual(oracle.detectCrateRoot(file), undefined, "the module under a real go.work is refused, not resolved to a root the workspace would silently reshape");
    const reason = oracle.describeMissingRoot && oracle.describeMissingRoot(file);
    assert.ok(typeof reason === "string" && reason.includes("workspace mode, not supported yet"), `the refusal is plain and pinned, got ${JSON.stringify(reason)}`);
  }
);
