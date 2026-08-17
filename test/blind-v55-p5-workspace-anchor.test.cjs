// Blind oracle, session-v55 phase 5: the diagnostic anchor is a [workspace]
// manifest, not any ancestor Cargo.toml.
//
// Written from session-v55/contract-phase5.md ALONE, INCLUDING its amendment,
// which strikes item 6 and narrows the fix to ONE function. Nothing here was
// written from the fix. Only the seam was read: the exported signature
// resolveDiagnosticPath(crateRoot, fileName, fileExists?) and the exported
// RustOracle class with its OracleDeps { fileExists } constructor.
//
// Run: SKIP_LIVE=1 node --test test/blind-v55-p5-workspace-anchor.test.cjs
//
// Rows are grouped by the contract item they falsify.
//
// =============================================================================
// THE RULE, and the correction that overrode the contract
// =============================================================================
// The amendment said "anchor at the outermost ancestor manifest that declares
// [workspace]". That is NOT cargo's rule, and it was corrected after the first
// 24 rows were written. Measured against cargo 1.96 with nested workspaces:
//
//   $ cd nest/inner/member && cargo check --message-format=short
//   member/src/lib.rs:1:21: error[E0308] ...   <- relative to the INNER root
//
// So the rule is the NEAREST enclosing manifest that declares [workspace],
// walking up from the crate root; if none declares one, the crate root is the
// anchor. An outermost anchor lands on nest/member/src/lib.rs, a real file the
// crate does not own, which is the same defect class the entry was fixing.
//
// That was hole H2 in the first draft of this file: the contract did not decide
// nested workspaces, and no row could tell the two rules apart. Group L closes
// it. Every other row is compatible with both rules, so none of them moved.
//
// =============================================================================
// THE TWO SEAMS, and how each is pinned
// =============================================================================
// The anchor decision reads two channels: does a Cargo.toml EXIST at a path,
// and does its TEXT declare a workspace (item 7: [workspace.dependencies]
// counts, a [workspace] in a comment does not). Both are injectable:
//
//   resolveDiagnosticPath(crateRoot, fileName, fileExists?, readManifest?)
//   oracleFor("rust", { fileExists, readManifest })   // both forwarded
//
// When this file was first written the second seam did not exist and the
// contract named none, so rather than invent a parameter name every layout was
// materialised as REAL BYTES under mkdtemp with the injected predicate built
// from the same path set. That is still how groups A-J work, and it is why they
// survived the seam landing unchanged.
//
// But agreement by construction pins NEITHER channel: an implementation that
// ignored both parameters and called fs.existsSync/fs.readFileSync directly was
// 24/24 green against groups A-J. Group K therefore makes the two channels
// DISAGREE, one at a time, so each parameter is load-bearing on its own:
//
//   K1, K2  the injected predicate overrules the real disk
//   K3, K4  the injected reader overrules the real bytes
//   N1, N2  the oracle forwards BOTH, not just the predicate
//
// N1 is the shape of a real defect: forwarding only fileExists let a caller
// with a virtual filesystem read manifests off the real disk, and the anchor
// silently inverted.
//
// The rig stays instant and hermetic: a handful of tiny writes under os.tmpdir,
// no cargo, no repo files touched.
//
// OTHER CONTRACT HOLES, each marked at its row:
//   H1. The contract does not say what resolveDiagnosticPath returns when
//       neither the anchored join nor any fallback candidate exists. Rows I1-I4
//       assert only that the walk TERMINATES and yields a string; where a path
//       is asserted, the file exists, so the answer is forced.
//   H3. The contract says nothing about a Cargo.toml that exists but cannot be
//       READ. The implementation deliberately counts it as declaring a
//       workspace; row M1 pins that direction and states why.
//
// =============================================================================

const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const TAG = "blind-v55-p5";
const { mod, cleanup } = bundleCore(
  TAG,
  `export { resolveDiagnosticPath, RustOracle, oracleFor } from "../src/core/compilerOracle";\n`,
);
const { resolveDiagnosticPath, RustOracle, oracleFor } = mod;

// bundleCore writes test/.<tag>.bundle.cjs; the termination rows need that path
// to run the walk inside a child process with a hard timeout.
const BUNDLE = path.join(__dirname, `.${TAG}.bundle.cjs`);

// ---------------------------------------------------------------------------
// Rig: one helper, described above. spec maps a relative path to its bytes.
// ---------------------------------------------------------------------------

const madeRoots = [];

function world(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v55p5-"));
  madeRoots.push(root);
  const present = new Set();
  const addAncestors = (abs) => {
    let d = path.dirname(abs);
    for (;;) {
      present.add(d);
      const up = path.dirname(d);
      if (up === d) return;
      d = up;
    }
  };
  for (const [rel, content] of Object.entries(spec)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    present.add(abs);
    addAncestors(abs);
  }
  return {
    root,
    at: (rel) => path.join(root, rel),
    exists: (p) => present.has(p),
    // The real bytes at a materialised path. Groups A-J leave readManifest
    // defaulted, so the product's own default reader sees exactly this.
    read: (p) => (present.has(p) && fs.existsSync(p) ? fs.readFileSync(p, "utf8") : undefined),
  };
}

// Group K onwards: make the two channels disagree, one at a time.
const existsMinus = (w, ...hidden) => {
  const h = new Set(hidden);
  return (p) => !h.has(p) && w.exists(p);
};
const existsPlus = (w, ...extra) => {
  const e = new Set(extra);
  return (p) => e.has(p) || w.exists(p);
};
const readerOver = (w, overrides) => (p) =>
  Object.prototype.hasOwnProperty.call(overrides, p) ? overrides[p] : w.read(p);

test.after(() => {
  for (const r of madeRoots) fs.rmSync(r, { recursive: true, force: true });
  cleanup();
});

const PKG = (name) => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n`;
const WS = (...members) =>
  `[workspace]\nresolver = "2"\nmembers = [${members.map((m) => `"${m}"`).join(", ")}]\n`;
const RS = 'pub fn f() -> i32 { "not an i32" }\n';

// ===========================================================================
// GROUP A: today's CORRECT behaviour. These are green now and must stay green.
// ===========================================================================

test("A1 an absolute fileName is returned unchanged, no walk, no anchor", () => {
  const w = world({
    "ws/Cargo.toml": WS("member"),
    "ws/member/Cargo.toml": PKG("member"),
    "ws/member/src/lib.rs": RS,
  });
  const abs = w.at("ws/member/src/lib.rs");
  assert.strictEqual(
    resolveDiagnosticPath(w.at("ws/member"), abs, w.exists),
    abs,
    "cargo already gave an absolute path; the anchor rule must not rewrite it",
  );
});

test("A2 the downward fallback still places a file the anchor cannot", () => {
  // Workspace member, but the diagnostic arrived crate-relative. The anchored
  // join (workspace root + src/lib.rs) does not exist; the fallback must still
  // find the member's file rather than return a path to nothing.
  const w = world({
    "ws/Cargo.toml": WS("member"),
    "ws/member/Cargo.toml": PKG("member"),
    "ws/member/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("ws/member"), "src/lib.rs", w.exists),
    w.at("ws/member/src/lib.rs"),
    "the existing fallback for shapes the anchor cannot place must survive the fix",
  );
});

// ===========================================================================
// GROUP B: item 2, falsification 1. A real workspace still anchors at its root.
// The amendment measured this against cargo 1.96: from inside the member, cargo
// emits "member/src/lib.rs", workspace-relative. The upward walk is NEEDED.
// ===========================================================================

test("B1 a member under a [workspace] root anchors at the workspace root", () => {
  const w = world({
    "ws/Cargo.toml": WS("member"),
    "ws/member/Cargo.toml": PKG("member"),
    "ws/member/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("ws/member"), "member/src/lib.rs", w.exists),
    w.at("ws/member/src/lib.rs"),
    "cargo emits workspace-relative paths from inside a member; anchoring at the member would lose the file",
  );
});

// ===========================================================================
// GROUP C: item 1, falsification 2. THE DEFECT. A plain [package] ancestor is
// walked past, not stopped at. From inside such a crate cargo emits
// CRATE-relative paths, so the outermost-manifest proxy is wrong.
// ===========================================================================

test("C1 a plain [package] ancestor owning the same relative file must not steal the diagnostic", () => {
  // The nasty half the amendment measured: /outer has its own src/lib.rs at the
  // same relative path as /outer/inner's. A wrong anchor does not miss, it hits
  // a DIFFERENT REAL FILE.
  const w = world({
    "outer/Cargo.toml": PKG("outer"),
    "outer/src/lib.rs": "// outer's own file, an innocent bystander\n",
    "outer/inner/Cargo.toml": PKG("inner"),
    "outer/inner/src/lib.rs": RS,
  });
  const got = resolveDiagnosticPath(w.at("outer/inner"), "src/lib.rs", w.exists);
  assert.notStrictEqual(
    got,
    w.at("outer/src/lib.rs"),
    "anchoring at the plain [package] ancestor attributes the error to a different real file, " +
      "which repair will then read and can rewrite. A miss would have been safer than this: " +
      "losing repair costs a feature, editing the wrong source file costs the user's code.",
  );
  assert.strictEqual(
    got,
    w.at("outer/inner/src/lib.rs"),
    "the diagnostic came from inside the nested crate and is crate-relative",
  );
});

test("C2 a plain [package] ancestor with no colliding file still resolves to the crate", () => {
  const w = world({
    "outer/Cargo.toml": PKG("outer"),
    "outer/inner/Cargo.toml": PKG("inner"),
    "outer/inner/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("outer/inner"), "src/lib.rs", w.exists),
    w.at("outer/inner/src/lib.rs"),
    "the benign half of the defect: this happens to work today and must not break",
  );
});

test("C3 two stacked [package] ancestors are both walked past", () => {
  const w = world({
    "a/Cargo.toml": PKG("a"),
    "a/src/lib.rs": "// a's own file\n",
    "a/b/Cargo.toml": PKG("b"),
    "a/b/c/Cargo.toml": PKG("c"),
    "a/b/c/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("a/b/c"), "src/lib.rs", w.exists),
    w.at("a/b/c/src/lib.rs"),
    "no depth of plain [package] nesting makes an ancestor a workspace root",
  );
});

// ===========================================================================
// GROUP D: falsification 3. A [package] ancestor which is itself under a
// [workspace] root. The workspace root is the anchor, the [package] between is
// not.
// ===========================================================================

test("D1 a crate under a [package] ancestor under a [workspace] root anchors at the workspace", () => {
  const w = world({
    "ws/Cargo.toml": WS("outer/inner"),
    "ws/outer/Cargo.toml": PKG("outer"),
    "ws/outer/inner/Cargo.toml": PKG("inner"),
    "ws/outer/inner/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("ws/outer/inner"), "outer/inner/src/lib.rs", w.exists),
    w.at("ws/outer/inner/src/lib.rs"),
    "the member is inside the workspace, so cargo's path is workspace-relative",
  );
});

test("D2 the anchor is a WORKSPACE, not merely the outermost manifest", () => {
  // A plain [package] sits ABOVE the workspace root and owns a file at the same
  // workspace-relative path. There is one workspace here, so nearest and
  // outermost agree; group L is what separates those two rules.
  const w = world({
    "top/Cargo.toml": PKG("top"),
    "top/outer/inner/src/lib.rs": "// top's own file at the same relative path\n",
    "top/ws/Cargo.toml": WS("outer/inner"),
    "top/ws/outer/Cargo.toml": PKG("outer"),
    "top/ws/outer/inner/Cargo.toml": PKG("inner"),
    "top/ws/outer/inner/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("top/ws/outer/inner"), "outer/inner/src/lib.rs", w.exists),
    w.at("top/ws/outer/inner/src/lib.rs"),
    "walking to the topmost Cargo.toml lands outside the workspace and hits a different real file",
  );
});

// ===========================================================================
// GROUP E: item 3, falsification 4. The standalone crate, most first-run users.
// ===========================================================================

test("E1 a standalone crate with nothing above it anchors at its own root", () => {
  const w = world({
    "solo/Cargo.toml": PKG("solo"),
    "solo/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("solo"), "src/lib.rs", w.exists),
    w.at("solo/src/lib.rs"),
    "no workspace anywhere above means the crate root is the anchor",
  );
});

// ===========================================================================
// GROUP F: item 4, falsification 5. A virtual manifest ([workspace], no
// [package]) is the normal multi-crate layout and must be found.
// ===========================================================================

test("F1 a virtual [workspace] manifest anchors even under a plain [package] ancestor", () => {
  const w = world({
    "top/Cargo.toml": PKG("top"),
    "top/m/src/lib.rs": "// top's own file at the same relative path\n",
    "top/vws/Cargo.toml": WS("m"),
    "top/vws/m/Cargo.toml": PKG("m"),
    "top/vws/m/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("top/vws/m"), "m/src/lib.rs", w.exists),
    w.at("top/vws/m/src/lib.rs"),
    "a manifest with no [package] is still a workspace root, and the [package] above it is not",
  );
});

test("F2 a virtual [workspace] with nothing above it anchors at itself", () => {
  const w = world({
    "vws/Cargo.toml": WS("m"),
    "vws/m/Cargo.toml": PKG("m"),
    "vws/m/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("vws/m"), "m/src/lib.rs", w.exists),
    w.at("vws/m/src/lib.rs"),
    "the plain multi-crate layout",
  );
});

// ===========================================================================
// GROUP G: item 5, falsification 6. A manifest carrying BOTH [package] and
// [workspace] is the root crate of a workspace. It anchors, and is not walked
// past just because it has a [package].
// ===========================================================================

test("G1 a crate whose OWN manifest carries both tables anchors at itself", () => {
  const w = world({
    "pkg/Cargo.toml": PKG("pkg"),
    "pkg/src/lib.rs": "// the ancestor's own file at the same relative path\n",
    "pkg/both/Cargo.toml": WS("sub") + "\n" + PKG("both"),
    "pkg/both/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("pkg/both"), "src/lib.rs", w.exists),
    w.at("pkg/both/src/lib.rs"),
    "the crate declares its own workspace; nothing above it can be the anchor",
  );
});

test("G2 a member under a both-tables root crate anchors at that root", () => {
  const w = world({
    "pkg/Cargo.toml": PKG("pkg"),
    "pkg/member/src/lib.rs": "// the ancestor's own file at the same relative path\n",
    "pkg/rc/Cargo.toml": WS("member") + "\n" + PKG("rc"),
    "pkg/rc/member/Cargo.toml": PKG("member"),
    "pkg/rc/member/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("pkg/rc/member"), "member/src/lib.rs", w.exists),
    w.at("pkg/rc/member/src/lib.rs"),
    "a [workspace] table is not disqualified by a [package] sitting beside it",
  );
});

// ===========================================================================
// GROUP H: item 7. [workspace] is detected from TOML, not from prose.
// Every row here needs the manifest's CONTENT (see the assumption block above).
// ===========================================================================

test("H1 [workspace.dependencies] counts as declaring a workspace", () => {
  const w = world({
    "top/Cargo.toml": PKG("top"),
    "top/m/src/lib.rs": "// top's own file at the same relative path\n",
    "top/wd/Cargo.toml": `[workspace.dependencies]\nserde = "1"\n`,
    "top/wd/m/Cargo.toml": PKG("m"),
    "top/wd/m/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("top/wd/m"), "m/src/lib.rs", w.exists),
    w.at("top/wd/m/src/lib.rs"),
    "a [workspace.<sub>] table header declares the workspace table; matching only a bare [workspace] line misses it",
  );
});

test("H2 [workspace.package] counts as declaring a workspace", () => {
  const w = world({
    "top/Cargo.toml": PKG("top"),
    "top/m/src/lib.rs": "// top's own file at the same relative path\n",
    "top/wp/Cargo.toml": `[workspace.package]\nedition = "2021"\nversion = "0.1.0"\n`,
    "top/wp/m/Cargo.toml": PKG("m"),
    "top/wp/m/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("top/wp/m"), "m/src/lib.rs", w.exists),
    w.at("top/wp/m/src/lib.rs"),
    "same as H1 with the other common workspace sub-table",
  );
});

test("H3 [workspace] inside a # comment does NOT declare a workspace", () => {
  const w = world({
    "cm/Cargo.toml": `# this crate is not a workspace: [workspace] lives one level up\n${PKG("cm")}`,
    "cm/src/lib.rs": "// cm's own file at the same relative path\n",
    "cm/inner/Cargo.toml": PKG("inner"),
    "cm/inner/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("cm/inner"), "src/lib.rs", w.exists),
    w.at("cm/inner/src/lib.rs"),
    "an unanchored substring search for [workspace] promotes a comment into a workspace root and steals a real file",
  );
});

test("H4 [workspace] inside a string does NOT declare a workspace", () => {
  const w = world({
    // The literal sits at the start of a line inside a multi-line string, so a
    // line-anchored regex is fooled just as an unanchored one is.
    "st/Cargo.toml":
      `[package]\nname = "st"\nversion = "0.1.0"\ndescription = """\n` +
      `[workspace] members are documented here, this manifest declares none\n"""\n`,
    "st/src/lib.rs": "// st's own file at the same relative path\n",
    "st/inner/Cargo.toml": PKG("inner"),
    "st/inner/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("st/inner"), "src/lib.rs", w.exists),
    w.at("st/inner/src/lib.rs"),
    "the detection reads TOML, not text that happens to contain the word",
  );
});

// ===========================================================================
// GROUP I: item 8. The walk terminates.
//
// A non-terminating synchronous walk cannot be interrupted from the same
// thread, so a hang here would hang the whole suite rather than fail a row.
// These four shapes therefore run inside a child process under a hard timeout:
// a hang becomes a clean failed assertion with a message.
// ===========================================================================

let terminationRun;
function termination() {
  if (terminationRun) return terminationRun;
  const script = `
    const { resolveDiagnosticPath } = require(${JSON.stringify(BUNDLE)});
    const only = (...ps) => { const s = new Set(ps); return (p) => s.has(p); };
    const out = {};
    out.relative = resolveDiagnosticPath("relative/crate", "src/lib.rs", only("relative/crate/src/lib.rs"));
    out.slash = resolveDiagnosticPath("/", "src/lib.rs", only("/src/lib.rs"));
    out.slashEmpty = resolveDiagnosticPath("/", "src/lib.rs", only());
    out.dot = resolveDiagnosticPath(".", "src/lib.rs", only());
    process.stdout.write(JSON.stringify(out));
  `;
  let raw;
  try {
    raw = execFileSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      timeout: 15000,
    });
  } catch (err) {
    terminationRun = { failed: `${err.code || ""} ${err.message}`.trim() };
    return terminationRun;
  }
  terminationRun = { out: JSON.parse(raw) };
  return terminationRun;
}

function terminationOut() {
  const r = termination();
  assert.ok(
    !r.failed,
    `the upward walk did not terminate (or crashed) within 15s: ${r.failed}`,
  );
  return r.out;
}

test("I1 a relative crateRoot terminates", () => {
  assert.strictEqual(
    terminationOut().relative,
    path.join("relative/crate", "src/lib.rs"),
    "dirname of a relative path reaches '.' and stays there; the walk must notice the fixed point",
  );
});

test("I2 crateRoot '/' terminates", () => {
  assert.strictEqual(
    terminationOut().slash,
    "/src/lib.rs",
    "dirname('/') is '/'; the walk must notice the fixed point",
  );
});

test("I3 crateRoot '/' with nothing on disk terminates and returns a string", () => {
  // H1: the contract does not say WHAT comes back when nothing exists, only
  // that the walk terminates. Assert the shape, not the value.
  assert.strictEqual(typeof terminationOut().slashEmpty, "string");
});

test("I4 crateRoot '.' terminates and returns a string", () => {
  assert.strictEqual(typeof terminationOut().dot, "string");
});

// ===========================================================================
// GROUP K: the two seams are load-bearing INDEPENDENTLY.
//
// Groups A-J build the predicate from the same paths they materialise, so the
// two channels agree and neither is pinned: an implementation that ignored both
// parameters and hit the real filesystem passes all of them. Each row here puts
// the injected channel in direct conflict with the disk and demands the
// injected one win.
// ===========================================================================

test("K1 the injected fileExists overrules the disk: a hidden manifest is not an anchor", () => {
  const w = world({
    "outer/Cargo.toml": WS("inner"),
    "outer/src/lib.rs": "// outer's own file at the same relative path\n",
    "outer/inner/Cargo.toml": PKG("inner"),
    "outer/inner/src/lib.rs": RS,
  });
  // The manifest is really there. The caller's world says it is not.
  const hidden = existsMinus(w, w.at("outer/Cargo.toml"));
  assert.strictEqual(
    resolveDiagnosticPath(w.at("outer/inner"), "src/lib.rs", hidden),
    w.at("outer/inner/src/lib.rs"),
    "calling fs.existsSync instead of the injected predicate sees a workspace the caller says is absent, and steals a real file",
  );
});

test("K2 the injected fileExists overrules the disk: a manifest only the caller knows about IS an anchor", () => {
  const w = world({
    "ghost/m/Cargo.toml": PKG("m"),
    "ghost/m/src/lib.rs": RS,
    "ghost/m/m/src/lib.rs": "// what a crate-root anchor would land on\n",
  });
  // ghost/Cargo.toml exists in the caller's world only; its bytes come from the
  // caller too, so both channels are exercised in the same direction.
  const ghostManifest = w.at("ghost/Cargo.toml");
  assert.strictEqual(
    resolveDiagnosticPath(
      w.at("ghost/m"),
      "m/src/lib.rs",
      existsPlus(w, ghostManifest),
      readerOver(w, { [ghostManifest]: WS("m") }),
    ),
    w.at("ghost/m/src/lib.rs"),
    "the walk must run in the caller's filesystem, not the process's",
  );
});

test("K3 the injected readManifest overrules the real bytes: disk says [workspace], caller says [package]", () => {
  const w = world({
    "outer/Cargo.toml": WS("inner"),
    "outer/src/lib.rs": "// outer's own file at the same relative path\n",
    "outer/inner/Cargo.toml": PKG("inner"),
    "outer/inner/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(
      w.at("outer/inner"),
      "src/lib.rs",
      w.exists,
      readerOver(w, { [w.at("outer/Cargo.toml")]: PKG("outer") }),
    ),
    w.at("outer/inner/src/lib.rs"),
    "reading the manifest with fs.readFileSync instead of the injected reader anchors on a workspace the caller does not have",
  );
});

test("K4 the injected readManifest overrules the real bytes: disk says [package], caller says [workspace]", () => {
  const w = world({
    "outer/Cargo.toml": PKG("outer"),
    "outer/inner/Cargo.toml": PKG("inner"),
    "outer/inner/src/lib.rs": RS,
    "outer/inner/inner/src/lib.rs": "// what a crate-root anchor would land on\n",
  });
  assert.strictEqual(
    resolveDiagnosticPath(
      w.at("outer/inner"),
      "inner/src/lib.rs",
      w.exists,
      readerOver(w, { [w.at("outer/Cargo.toml")]: WS("inner") }),
    ),
    w.at("outer/inner/src/lib.rs"),
    "the other direction of K3: the caller's bytes must be able to CREATE a workspace, not only remove one",
  );
});

// ===========================================================================
// GROUP L: the NEAREST workspace wins, not the outermost.
//
// This overrides the contract amendment, which said outermost. Measured against
// cargo 1.96: from inside a member of a nested workspace, cargo emits a path
// relative to the INNER workspace root. See the header.
//
// These are the rows the first draft of this file was missing. Nothing in the
// suite could tell the two rules apart, and the outermost rule lands on a real
// file the crate does not own, which is the defect the entry set out to fix.
// ===========================================================================

test("L1 stacked workspaces: the inner one is the anchor, even when the outer owns the same relative path", () => {
  const w = world({
    "nest/Cargo.toml": `[workspace]\nresolver = "2"\nmembers = ["member"]\nexclude = ["inner"]\n`,
    "nest/member/src/lib.rs": "// the OUTER workspace's own file, not this crate's\n",
    "nest/inner/Cargo.toml": WS("member"),
    "nest/inner/member/Cargo.toml": PKG("member"),
    "nest/inner/member/src/lib.rs": RS,
  });
  const got = resolveDiagnosticPath(w.at("nest/inner/member"), "member/src/lib.rs", w.exists);
  assert.notStrictEqual(
    got,
    w.at("nest/member/src/lib.rs"),
    "an outermost anchor attributes the error to a different real file, the same defect class as C1: repair reads and can rewrite the wrong source",
  );
  assert.strictEqual(
    got,
    w.at("nest/inner/member/src/lib.rs"),
    "cargo 1.96, run from inside the member, emits a path relative to the INNER workspace root",
  );
});

test("L2 the nearest workspace wins with a plain [package] between it and the crate", () => {
  const w = world({
    "nest/Cargo.toml": `[workspace]\nresolver = "2"\nmembers = ["pkg/member"]\nexclude = ["inner"]\n`,
    "nest/pkg/member/src/lib.rs": "// the OUTER workspace's own file, not this crate's\n",
    "nest/inner/Cargo.toml": WS("pkg/member"),
    "nest/inner/pkg/Cargo.toml": PKG("pkg"),
    "nest/inner/pkg/member/Cargo.toml": PKG("member"),
    "nest/inner/pkg/member/src/lib.rs": RS,
  });
  assert.strictEqual(
    resolveDiagnosticPath(w.at("nest/inner/pkg/member"), "pkg/member/src/lib.rs", w.exists),
    w.at("nest/inner/pkg/member/src/lib.rs"),
    "the walk keeps going past [package] ancestors (group C) but STOPS at the first workspace it meets",
  );
});

// ===========================================================================
// GROUP M: a manifest that exists but cannot be read counts as declaring a
// workspace.
// ===========================================================================

test("M1 an unreadable manifest is treated as a workspace root, not as absent", () => {
  const w = world({
    "ws/Cargo.toml": WS("member"),
    "ws/member/Cargo.toml": PKG("member"),
    "ws/member/src/lib.rs": RS,
    "ws/member/member/src/lib.rs": "// what a crate-root anchor would land on\n",
  });
  assert.strictEqual(
    resolveDiagnosticPath(
      w.at("ws/member"),
      "member/src/lib.rs",
      w.exists,
      readerOver(w, { [w.at("ws/Cargo.toml")]: undefined }),
    ),
    w.at("ws/member/src/lib.rs"),
    "deliberate direction on unknowable input: the pre-Q6 code only stat'd the manifest, so answering " +
      "'not a workspace' here would regress a real workspace with an unreadable root back into the " +
      "P4-F12 collision, where a foreign root's error becomes eligible and the member's function goes to the model",
  );
});

// ===========================================================================
// GROUP N: the oracle forwards BOTH seams, not just the predicate.
//
// The CompilerOracle interface exposes resolveDiagnosticPath with both
// parameters optional, so a caller that constructed the oracle with deps and
// then calls the method with two arguments must still get its own world. These
// rows call it with two arguments on purpose.
// ===========================================================================

test("N1 oracleFor('rust', { fileExists, readManifest }) forwards the READER", () => {
  const w = world({
    "outer/Cargo.toml": WS("inner"),
    "outer/src/lib.rs": "// outer's own file at the same relative path\n",
    "outer/inner/Cargo.toml": PKG("inner"),
    "outer/inner/src/lib.rs": RS,
  });
  const oracle = oracleFor("rust", {
    fileExists: w.exists,
    readManifest: readerOver(w, { [w.at("outer/Cargo.toml")]: PKG("outer") }),
  });
  assert.ok(oracle, "oracleFor('rust') must return a strategy");
  assert.strictEqual(
    oracle.resolveDiagnosticPath(w.at("outer/inner"), "src/lib.rs"),
    w.at("outer/inner/src/lib.rs"),
    "forwarding only fileExists leaves the anchor reading manifests off the real disk, and it inverts silently: " +
      "the predicate says one world, the bytes say another, and nothing reports the mismatch",
  );
});

test("N2 oracleFor('rust', { fileExists }) forwards the PREDICATE", () => {
  const w = world({
    "outer/Cargo.toml": WS("inner"),
    "outer/src/lib.rs": "// outer's own file at the same relative path\n",
    "outer/inner/Cargo.toml": PKG("inner"),
    "outer/inner/src/lib.rs": RS,
  });
  const oracle = oracleFor("rust", { fileExists: existsMinus(w, w.at("outer/Cargo.toml")) });
  assert.ok(oracle, "oracleFor('rust') must return a strategy");
  assert.strictEqual(
    oracle.resolveDiagnosticPath(w.at("outer/inner"), "src/lib.rs"),
    w.at("outer/inner/src/lib.rs"),
    "the constructor's predicate must reach the anchor walk, not just detectCrateRoot",
  );
});

// ===========================================================================
// GROUP J: REGRESSION GUARDS for detectCrateRoot. NOT IN SCOPE for this fix.
//
// The contract's amendment is explicit: detectCrateRoot takes the NEAREST
// manifest and that is CORRECT. It deliberately scopes a check to the touched
// workspace member rather than the whole workspace. Item 6, which said both
// walks move together, is STRUCK.
//
// These rows exist so that a later session cannot "finish the job" by applying
// the workspace rule here too. If one of these turns red, the change under it
// is a regression, not progress: it would walk past the crate's own manifest
// and check the whole workspace on every keystroke in a member.
// ===========================================================================

const oracle = (exists) => new RustOracle({ fileExists: exists });

test("J1 GUARD detectCrateRoot returns the NEAREST manifest, not a workspace root", () => {
  const w = world({
    "ws/Cargo.toml": WS("member"),
    "ws/member/Cargo.toml": PKG("member"),
    "ws/member/src/lib.rs": RS,
  });
  assert.strictEqual(
    oracle(w.exists).detectCrateRoot(w.at("ws/member/src/lib.rs")),
    w.at("ws/member"),
    "member scoping is deliberate; returning the workspace root here is the regression this row guards",
  );
});

test("J2 GUARD detectCrateRoot stops at a plain [package] ancestor's child, the crate's own root", () => {
  const w = world({
    "outer/Cargo.toml": PKG("outer"),
    "outer/inner/Cargo.toml": PKG("inner"),
    "outer/inner/src/lib.rs": RS,
  });
  assert.strictEqual(
    oracle(w.exists).detectCrateRoot(w.at("outer/inner/src/lib.rs")),
    w.at("outer/inner"),
    "requiring [workspace] here would walk past the crate's own manifest and break member scoping",
  );
});

test("J3 GUARD detectCrateRoot returns undefined when there is no manifest at all", () => {
  const w = world({ "loose/src/lib.rs": RS });
  assert.strictEqual(
    oracle(w.exists).detectCrateRoot(w.at("loose/src/lib.rs")),
    undefined,
    "a file outside any crate has no root, and the walk terminates saying so",
  );
});
