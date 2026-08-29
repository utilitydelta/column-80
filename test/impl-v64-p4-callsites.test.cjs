// White-box: the two call-hierarchy legs of the context bundle (session-v64
// phase 4), driven through the structural `vscode` stub against REAL files on
// disk.
//
// WHAT THESE LEGS ARE FOR. `blastRadius` already walks callers and keeps a
// COUNT, and `6 call sites ride on this signature` is the weakest form of the
// evidence: three lines reading `warm_fs_metadata(lod, shard)` ARE the
// transposition argument. `callSiteLines` keeps the lines. `calleeDocs` looks
// the other way, and it exists under a constraint the phase 5 spike measured
// rather than guessed: pointed at a real Rust workspace, the goal's own example
// function returned 18 callees, every one of them `std`, 13,249 bytes of
// standard-library rustdoc and nothing about the codebase. The workspace filter
// is the leg.
//
// THE FILES ARE REAL. `makeLineReader` reads from disk when no document is
// open, so a fixture that faked the read would grade the fake. These write into
// a temp directory and delete it.
//
// ROWS
//    1  a caller's `fromRanges` become real trimmed call LINES
//    2  a caller invoked twice contributes both call lines
//    3  the path is workspace-relative, never absolute
//    4  the cap holds, and it is the cap the prompt declares
//    5  a caller with no `fromRanges` contributes nothing: a declaration line
//       is not a call site
//    6  a server that places no root degrades to no lines, and never throws
//    7  a thrown provider degrades to no lines, and names itself
//    8  an unreadable caller file drops that site rather than the pass
//    9  callees are filtered TO THE WORKSPACE
//   10  an all-external callee list is EMPTY, not a header with nothing under it
//   11  a callee's doc comment comes back with it
//   12  an undocumented in-workspace callee still comes back, named
//   13  the callee cap holds
//   14  the function under review is not its own callee
//
// Run: SKIP_LIVE=1 node --test test/impl-v64-p4-callsites.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bundleWithVscodeStub } = require("./.vscode-stub.cjs");

const host = bundleWithVscodeStub(
  "impl-v64-p4-callsites",
  `export { callSiteLines, calleeDocs } from "../src/vscode/callHierarchy";
export { FIX_CALLEE_CAP, FIX_CALL_SITE_CAP } from "../src/core/criticizeFix";
export { criticizeLangFor } from "../src/core/criticizeLang";\n`,
);

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v64-p4-"));
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v64-p4-out-"));

test.after(() => {
  host.cleanup();
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.rmSync(OUTSIDE, { recursive: true, force: true });
});

if (host.error) {
  test("harness sanity: the host bundle must build", () => {
    assert.fail(`bundleWithVscodeStub failed: ${host.error && host.error.message}`);
  });
} else {
  const vscode = host.vscode;
  const { callSiteLines, calleeDocs, FIX_CALLEE_CAP, FIX_CALL_SITE_CAP, criticizeLangFor } = host.mod;
  const RUST = criticizeLangFor("rust");

  function write(dir, rel, lines) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, lines.join("\n"), "utf8");
    return full;
  }

  /** A `CallHierarchyItem` as the two providers hand one back. */
  function item(fsPath, name, declLine) {
    return {
      name,
      uri: vscode.Uri.file(fsPath),
      range: new vscode.Range(declLine, 0, declLine + 3, 1),
      selectionRange: new vscode.Range(declLine, 0, declLine, name.length),
    };
  }

  /** The document the gesture is invoked on. Only its uri is read here. */
  function targetDoc(fsPath) {
    return {
      uri: vscode.Uri.file(fsPath),
      fileName: fsPath,
      languageId: "rust",
      getText: () => "",
    };
  }

  /**
   * Arms the stub: one prepared root for the target document, and the incoming
   * or outgoing answer keyed by that root's name.
   */
  function arm({ root, incoming, outgoing, workspace = ROOT }) {
    globalThis.__C80_WS_ROOT__ = workspace;
    globalThis.__C80_CALL_ROOTS__ = root === undefined ? {} : { [root.uri.toString()]: [root] };
    globalThis.__C80_INCOMING__ = incoming ? { [root.name]: incoming } : {};
    globalThis.__C80_OUTGOING__ = outgoing ? { [root.name]: outgoing } : {};
  }

  const AT = new vscode.Position(4, 0);

  // -------------------------------------------------------------------------
  // Upstream: the call lines.
  // -------------------------------------------------------------------------

  const TARGET = write(ROOT, "src/warm.rs", [
    "pub fn warm_fs_metadata(root: &Path, shard: u64, lod: u64) -> u64 {",
    "    0",
    "}",
  ]);
  const CALLER = write(ROOT, "src/startup.rs", [
    "pub fn startup() -> u64 {",
    "    let a = warm_fs_metadata(&p, lod, shard);",
    "    let b = warm_fs_metadata(&p, shard, lod);",
    "    a + b",
    "}",
  ]);

  const rootItem = () => item(TARGET, "warm_fs_metadata", 0);

  test("1: a caller's fromRanges come back as the real, trimmed call lines", async () => {
    arm({
      root: rootItem(),
      incoming: [{ from: item(CALLER, "startup", 0), fromRanges: [new vscode.Range(1, 12, 1, 28)] }],
    });
    const sites = await callSiteLines(targetDoc(TARGET), AT, FIX_CALL_SITE_CAP);
    assert.strictEqual(sites.length, 1);
    assert.strictEqual(sites[0].text, "let a = warm_fs_metadata(&p, lod, shard);");
    assert.strictEqual(sites[0].line, 2, "the line is 1-based, the way every document line on a card is");
  });

  test("2: a caller that invokes the target twice contributes both call lines", async () => {
    // The evidence for a transposition argument is the two lines side by side.
    // An incoming call names the CALLER; `fromRanges` are the calls inside it,
    // and keeping one per caller would throw the second one away.
    arm({
      root: rootItem(),
      incoming: [
        {
          from: item(CALLER, "startup", 0),
          fromRanges: [new vscode.Range(1, 12, 1, 28), new vscode.Range(2, 12, 2, 28)],
        },
      ],
    });
    const sites = await callSiteLines(targetDoc(TARGET), AT, FIX_CALL_SITE_CAP);
    assert.deepStrictEqual(
      sites.map((s) => s.line),
      [2, 3],
    );
    assert.match(sites[1].text, /shard, lod/);
  });

  test("3: the path is workspace-relative, so the prompt spends no characters on /home", async () => {
    arm({
      root: rootItem(),
      incoming: [{ from: item(CALLER, "startup", 0), fromRanges: [new vscode.Range(1, 12, 1, 28)] }],
    });
    const sites = await callSiteLines(targetDoc(TARGET), AT, FIX_CALL_SITE_CAP);
    assert.strictEqual(sites[0].file, "src/startup.rs");
    assert.strictEqual(
      path.isAbsolute(sites[0].file),
      false,
      "an absolute path spends prompt budget on the machine the developer is sitting at",
    );
  });

  test("4: the cap holds, and every line past it is dropped rather than truncated", async () => {
    const many = [];
    const lines = [];
    for (let i = 0; i < 20; i++) lines.push(`    warm_fs_metadata(&p, ${i}, ${i});`);
    const wide = write(ROOT, "src/many.rs", ["pub fn many() {", ...lines, "}"]);
    for (let i = 0; i < 20; i++) many.push(new vscode.Range(i + 1, 4, i + 1, 20));
    arm({ root: rootItem(), incoming: [{ from: item(wide, "many", 0), fromRanges: many }] });
    const sites = await callSiteLines(targetDoc(TARGET), AT, FIX_CALL_SITE_CAP);
    assert.strictEqual(sites.length, FIX_CALL_SITE_CAP);
  });

  test("5: a caller with no fromRanges contributes nothing, because a declaration is not a call", async () => {
    arm({ root: rootItem(), incoming: [{ from: item(CALLER, "startup", 0), fromRanges: [] }] });
    const sites = await callSiteLines(targetDoc(TARGET), AT, FIX_CALL_SITE_CAP);
    assert.deepStrictEqual(
      sites,
      [],
      "printing the caller's own declaration line as a call site would put a sentence in front of "
        + "the model that is not true of the code",
    );
  });

  test("6: a server that places no root degrades to no lines and says so", async () => {
    arm({ root: undefined });
    globalThis.__C80_CALL_ROOTS__ = {};
    const channel = [];
    const sites = await callSiteLines(targetDoc(TARGET), AT, FIX_CALL_SITE_CAP, (l) => channel.push(l));
    assert.deepStrictEqual(sites, []);
    assert.ok(channel.some((l) => l.includes("prepareCallHierarchy")), `nothing named the cause:\n${channel.join("\n")}`);
  });

  test("7: a thrown incoming-calls provider degrades to no lines and names itself", async () => {
    arm({ root: rootItem() });
    globalThis.__C80_INCOMING__ = {
      get warm_fs_metadata() {
        throw new Error("the server went away");
      },
    };
    const channel = [];
    let sites;
    await assert.doesNotReject(async () => {
      sites = await callSiteLines(targetDoc(TARGET), AT, FIX_CALL_SITE_CAP, (l) => channel.push(l));
    });
    assert.deepStrictEqual(sites, []);
    assert.ok(
      channel.some((l) => l.includes("the server went away")),
      `the transport's own message never reached the channel:\n${channel.join("\n")}`,
    );
  });

  test("8: an unreadable caller file drops that site, not the whole pass", async () => {
    arm({
      root: rootItem(),
      incoming: [
        { from: item(path.join(ROOT, "src/gone.rs"), "gone", 0), fromRanges: [new vscode.Range(1, 0, 1, 5)] },
        { from: item(CALLER, "startup", 0), fromRanges: [new vscode.Range(1, 12, 1, 28)] },
      ],
    });
    const sites = await callSiteLines(targetDoc(TARGET), AT, FIX_CALL_SITE_CAP);
    assert.strictEqual(sites.length, 1, "the readable caller must survive the unreadable one");
    assert.strictEqual(sites[0].file, "src/startup.rs");
  });

  // -------------------------------------------------------------------------
  // Downstream: the callees, and the filter that is the whole leg.
  // -------------------------------------------------------------------------

  const CALLEE = write(ROOT, "src/atlas.rs", [
    "/// Enrolls the tile at the given lod.",
    "pub fn enroll_tile(lod: u64) -> u64 {",
    "    0",
    "}",
    "pub fn bare_helper() -> u64 {",
    "    0",
    "}",
  ]);
  const EXTERNAL = write(OUTSIDE, "std/fs.rs", [
    "/// Returns an iterator over the entries within a directory.",
    "pub fn read_dir(path: &Path) -> u64 {",
    "    0",
    "}",
  ]);

  test("9: a callee outside the workspace is dropped, and the in-workspace one is kept", async () => {
    // 70 callees against 22 on a real repository. Standard-library rustdoc is
    // training data the model already has, and every byte of it crowds out the
    // type shapes and call lines arms C and D earned.
    arm({
      root: rootItem(),
      outgoing: [
        { to: item(EXTERNAL, "read_dir", 1), fromRanges: [] },
        { to: item(CALLEE, "enroll_tile", 1), fromRanges: [] },
      ],
    });
    const callees = await calleeDocs(targetDoc(TARGET), AT, FIX_CALLEE_CAP, RUST);
    assert.deepStrictEqual(callees.map((c) => c.name), ["enroll_tile"]);
  });

  test("10: a function whose callees are ALL external hands back an empty list, and names the zero", async () => {
    arm({ root: rootItem(), outgoing: [{ to: item(EXTERNAL, "read_dir", 1), fromRanges: [] }] });
    const channel = [];
    const callees = await calleeDocs(targetDoc(TARGET), AT, FIX_CALLEE_CAP, RUST, (l) => channel.push(l));
    assert.deepStrictEqual(
      callees,
      [],
      "an empty array is what makes `buildFixPrompt` emit no block at all; a header with nothing "
        + "under it reads as a measurement of an empty answer rather than as an absence",
    );
    assert.ok(
      channel.some((l) => l.includes("outside the workspace")),
      `a zero from a filter is a fact worth reading, and nothing said it:\n${channel.join("\n")}`,
    );
  });

  test("11: an in-workspace callee comes back with its doc comment", async () => {
    arm({ root: rootItem(), outgoing: [{ to: item(CALLEE, "enroll_tile", 1), fromRanges: [] }] });
    const callees = await calleeDocs(targetDoc(TARGET), AT, FIX_CALLEE_CAP, RUST);
    assert.strictEqual(callees[0].doc, "Enrolls the tile at the given lod.");
  });

  test("12: an undocumented in-workspace callee is still returned, named", async () => {
    // Rust documents 30.7% to 41.5% of its declarations on real code and
    // TypeScript 2.5%, so dropping the undocumented would empty the leg on the
    // language where the name is worth the most.
    arm({ root: rootItem(), outgoing: [{ to: item(CALLEE, "bare_helper", 4), fromRanges: [] }] });
    const callees = await calleeDocs(targetDoc(TARGET), AT, FIX_CALLEE_CAP, RUST);
    assert.strictEqual(callees.length, 1);
    assert.strictEqual(callees[0].name, "bare_helper");
    assert.strictEqual(callees[0].doc, "", "an undocumented callee carries an empty doc, not a missing entry");
    // AND ITS SIGNATURE, added 2026-08-29 for the model-authored review path.
    // The doc is empty on 97.5% of TypeScript callees and on most Rust ones; the
    // DECLARATION LINE is present for all of them and is most of what a caller
    // needs to know about a callee it cannot see the body of.
    assert.ok(
      typeof callees[0].signature === "string" && callees[0].signature.includes("bare_helper"),
      `the callee's declaration line must ride along: ${JSON.stringify(callees[0])}`,
    );
  });

  test("13: the callee cap holds", async () => {
    const outgoing = [];
    for (let i = 0; i < 20; i++) {
      const f = write(ROOT, `src/c${i}.rs`, ["/// A callee.", `pub fn callee_${i}() {}`]);
      outgoing.push({ to: item(f, `callee_${i}`, 1), fromRanges: [] });
    }
    arm({ root: rootItem(), outgoing });
    const callees = await calleeDocs(targetDoc(TARGET), AT, FIX_CALLEE_CAP, RUST);
    assert.strictEqual(callees.length, FIX_CALLEE_CAP);
  });

  test("14: a recursive function is not its own callee", async () => {
    // The cap is six. Handing one slot back to the function under review, whose
    // doc comment the prompt already carries in full, spends it on nothing.
    arm({
      root: rootItem(),
      outgoing: [
        { to: item(TARGET, "warm_fs_metadata", 0), fromRanges: [] },
        { to: item(CALLEE, "enroll_tile", 1), fromRanges: [] },
      ],
    });
    const callees = await calleeDocs(targetDoc(TARGET), AT, FIX_CALLEE_CAP, RUST);
    assert.deepStrictEqual(callees.map((c) => c.name), ["enroll_tile"]);
  });
}
