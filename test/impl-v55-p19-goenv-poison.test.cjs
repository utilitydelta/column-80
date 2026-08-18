// SESSION-V55 PHASE 19, queue Q11: the poisoned-GOENV fixtures.
//
// Session-v23's P1 review raised F3 and F7 and both were DEFERRED as scrap
// CONDITIONS rather than tests - "expected closed by the F2 GOENV=off fix,
// re-verify with a poisoned GOENV file". Three years of sessions later they were
// still prose. This file is the re-verification, run against a real `go`.
//
//   F3: `go env -w GOPRIVATE/GONOPROXY` reopens the network under GOPROXY=off
//       (direct VCS dial, proven in v23). The check must refuse LOCALLY with
//       zero network.
//   F7: `go env -w GOTOOLCHAIN/GOOS/GOARCH` reshapes or kills the check. A
//       poisoned GOTOOLCHAIN must leave it unaffected.
//
// EVERY ROW HAS A CONTROL, and the controls are the point. "The poison did
// nothing" is worth nothing unless the same fixture can be shown poisoning
// something - a zero from a rig that cannot make the case fire is a fact about
// the rig. Each row therefore runs the SAME module twice: once through the
// product's own pinned spawn, once with the poisoned file honoured.
//
// The command and the env are the PRODUCT'S, taken from `GoOracle.buildCheckCommand`
// and `GO_SPAWN_ENV`. A re-derived spawn would be a different program from the
// one that ships, and this repo has already had a re-derived mapping invert a
// measurement.
//
// NOT gated on SKIP_LIVE, deliberately. These spawn `go build` on a throwaway
// module with module lookups disabled; they are hermetic, offline and take about
// a second. Session-v55 phase 13 measured what SKIP_LIVE gating costs: its
// dotnet-graded rows run under no npm script at all, and the unit gate was green
// while one of them was red. A row that can run in the gate runs in the gate.
// They skip only when `go` is absent, which is a fact about the box.
//
// Run: node --test test/impl-v55-p19-goenv-poison.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod: core, cleanup } = bundleCore(
  "v55-p19-goenv",
  `export { GoOracle, GO_SPAWN_ENV } from "../src/core/goOracle";\n`,
);
const { GoOracle, GO_SPAWN_ENV } = core;
test.after(() => cleanup());

const GO = (() => {
  const probe = spawnSync("go", ["version"], { encoding: "utf8" });
  return probe.status === 0 ? probe.stdout.trim() : undefined;
})();
const SKIP = GO === undefined ? "no `go` on this box; the poison fixtures need a real toolchain" : false;

/** A throwaway module that REQUIRES a module which cannot resolve without the
 *  network, plus a poisoned `go env -w` file beside it. The import is required
 *  in go.mod on purpose: an unrequired import fails at "not in std" before the
 *  module resolver runs, and then the fixture proves nothing about network reach
 *  (measured while building this file). */
function poisonedModule(envFileBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c80-goenv-"));
  fs.mkdirSync(path.join(dir, "m"));
  fs.writeFileSync(
    path.join(dir, "m", "go.mod"),
    "module example.com/m\n\ngo 1.21\n\nrequire fake-host.invalid/pkg v1.0.0\n",
  );
  fs.writeFileSync(
    path.join(dir, "m", "main.go"),
    'package main\n\nimport "fake-host.invalid/pkg"\n\nfunc main() { pkg.Do() }\n',
  );
  fs.writeFileSync(path.join(dir, "env"), envFileBody);
  return { root: path.join(dir, "m"), envFile: path.join(dir, "env"), dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** A throwaway module with NO external requirement, for the rows where network
 *  reach is not the question and module resolution would otherwise answer first. */
function localModule(envFileBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c80-goenv-"));
  fs.mkdirSync(path.join(dir, "m"));
  fs.writeFileSync(path.join(dir, "m", "go.mod"), "module example.com/m\n\ngo 1.21\n");
  fs.writeFileSync(path.join(dir, "m", "main.go"), "package main\n\nfunc main() {}\n");
  fs.writeFileSync(path.join(dir, "env"), envFileBody);
  return { root: path.join(dir, "m"), envFile: path.join(dir, "env"), dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Run the PRODUCT's check command. `overrides` maps an env key to a value, or
 *  to `undefined` to DELETE it.
 *
 *  Deleting matters and cost an hour: `go` treats a variable that is present but
 *  EMPTY as set, so a control that passed `GOPROXY: ""` and `GOFLAGS: ""` kept
 *  overriding the very poisoned file it was trying to honour, and every control
 *  came back looking like the pinned run. A control that cannot fire is the
 *  failure mode this whole file exists to avoid, so it is deleted, not blanked. */
function runCheck(root, overrides = {}) {
  const cmd = new GoOracle().buildCheckCommand(root);
  const env = {
    ...process.env,
    // A private module cache per run: a warm cache would answer a question the
    // network was supposed to be asked, and the row would pass for the wrong
    // reason.
    GOMODCACHE: path.join(root, "..", "modcache"),
    ...cmd.env,
  };
  // The user's own shell may export any of these; the fixture owns them here.
  for (const k of ["GOFLAGS", "GOPRIVATE", "GONOPROXY", "GOTOOLCHAIN", "GONOSUMDB", "GOSUMDB"]) {
    delete env[k];
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete env[k];
    } else {
      env[k] = v;
    }
  }
  const res = spawnSync(cmd.program ?? "go", cmd.args, {
    cwd: cmd.cwd ?? root,
    encoding: "utf8",
    timeout: 90_000,
    env,
  });
  return `${res.stdout ?? ""}${res.stderr ?? ""}`;
}

const DIALED = /downloading|dial tcp|lookup |https fetch|no such host|i\/o timeout|connection refused|proxy\.golang\.org/i;

test("the product pins GOENV=off in the spawn env at all [precondition: without this every row below is vacuous]", () => {
  assert.equal(GO_SPAWN_ENV.GOENV, "off", "GOENV=off is the F2 fix these two conditions were deferred against");
  assert.equal(GO_SPAWN_ENV.GOPROXY, "off");
  const cmd = new GoOracle().buildCheckCommand("/m");
  assert.equal(cmd.env.GOENV, "off", "and the built command must carry it, not just the constant");
});

test("F3: a poisoned GOPRIVATE/GONOPROXY does NOT reopen the network - the check refuses locally", { skip: SKIP }, () => {
  // `-mod=mod` is in the poisoned file on purpose and is not padding: with the
  // default `-mod=readonly` the go command refuses to update go.sum and errors
  // LOCALLY before it ever reaches the network, so the control could not dial
  // and the row would have proved nothing. A real `go env -w` file carries
  // several knobs; this is one of them.
  const f = poisonedModule("GOPRIVATE=fake-host.invalid/*\nGONOPROXY=fake-host.invalid/*\nGOSUMDB=off\nGOFLAGS=-mod=mod\n");
  try {
    // THE CONTROL FIRST, so a green pinned row can never be a rig that cannot
    // fire. `GOENV` pointed at the poisoned file, and the proxy pin lifted the
    // way `go env -w GOPRIVATE` lifts it for a matching path.
    const control = runCheck(f.root, { GOENV: f.envFile, GOPROXY: undefined });
    assert.match(
      control,
      DIALED,
      `the fixture must be able to reach the network when the poison is honoured, or this pair proves nothing. Got: ${control}`,
    );

    // THE PRODUCT'S OWN SPAWN. Same module, same poisoned file on disk, GOENV=off.
    const pinned = runCheck(f.root);
    assert.doesNotMatch(
      pinned,
      DIALED,
      `GOENV=off must close the channel GOPRIVATE reopens; the check reached the network: ${pinned}`,
    );
    assert.match(
      pinned,
      /missing go\.sum entry|module lookups disabled|cannot find module/i,
      `and it must refuse LOCALLY with a real verdict rather than silently succeeding: ${pinned}`,
    );
  } finally {
    f.dispose();
  }
});

test("F7: a poisoned GOTOOLCHAIN does NOT reshape the check - no toolchain switch is attempted", { skip: SKIP }, () => {
  const f = poisonedModule("GOTOOLCHAIN=go1.25.0\n");
  try {
    const control = runCheck(f.root, { GOENV: f.envFile });
    assert.match(
      control,
      /go1\.25\.0/,
      `the fixture must be able to make the toolchain knob bite, or this pair proves nothing. Got: ${control}`,
    );

    const pinned = runCheck(f.root);
    assert.doesNotMatch(
      pinned,
      /go1\.25\.0|toolchain not available|switching to go/i,
      `GOENV=off must leave the toolchain alone; the check tried to switch: ${pinned}`,
    );
    assert.match(
      pinned,
      /missing go\.sum entry|module lookups disabled|cannot find module/i,
      `and it must still reach a real verdict on the module: ${pinned}`,
    );
  } finally {
    f.dispose();
  }
});

test("F7b: a poisoned GOFLAGS does not reach the check either, which is the knob the divergence line names", { skip: SKIP }, () => {
  // A LOCAL-ONLY module for this one. The other two rows need an unresolvable
  // import to make network reach observable, but that import fails at module
  // resolution BEFORE any file is compiled, so a build tag would never be
  // reached and the control could not fire. Measured while building this file.
  const f = localModule("GOFLAGS=-tags=column80_poison\n");
  try {
    // `-tags` is observable without the network: a file behind the tag either
    // compiles into the build or does not.
    fs.writeFileSync(
      path.join(f.root, "tagged.go"),
      "//go:build column80_poison\n\npackage main\n\nvar poisonWasApplied = undefinedIdentifierProvingTheTagWasHonoured\n",
    );
    const control = runCheck(f.root, { GOENV: f.envFile });
    assert.match(
      control,
      /undefinedIdentifierProvingTheTagWasHonoured|undefined: undefinedIdentifier/i,
      `the fixture must be able to make GOFLAGS bite. Got: ${control}`,
    );

    const pinned = runCheck(f.root);
    assert.doesNotMatch(
      pinned,
      /undefinedIdentifierProvingTheTagWasHonoured/,
      `GOENV=off must drop the user's GOFLAGS; the tagged file compiled: ${pinned}`,
    );
    assert.equal(pinned.trim(), "", `and a module with no tag applied must build clean: ${pinned}`);
  } finally {
    f.dispose();
  }
});
