// ADVERSARIAL REVIEW — session-v50 phase 0, "the enum spelling is a merge".
//
// Subject: the uncommitted working-tree diff against 19f1e6f. This reviewer did
// not write that code. Every row below is EVIDENCE for one claim. [FINE] rows
// record an attack line that found nothing. [RECORD] rows pin a measured fact
// that triage ruled is not this phase's defect to fix, so the fact is guarded
// instead of argued. [FIXED] rows were red, the product tree changed, and they
// stay as the guard that it does not change back.
//
// TRIAGE, 2026-08-11. This file was first cut with six red [DEFECT] rows. All
// six are ruled and the whole file is now green:
//   ROW 1  DEFERRED to phase 2, which decides C#'s edge sources anyway, and
//          unreachable in C# today because Roslyn signs no enum variant. No
//          product guard was added. Re-cut to [RECORD] on the measured fact.
//   ROW 2  the probe COMMENT is fixed; `blind()` is deliberately unchanged,
//          because nulling `signatureRefTypes` would measure a C# that never
//          existed. Re-cut to [RECORD] on what `blind()` really does.
//   ROW 3  DELETED, and ROW 4 with it. Their subject was the blind oracle's own
//   ROW 4  file, which a review file is the wrong home to assert defects in.
//          Both claims are kept in the comment at the gap where they were.
//   ROW 5  FIXED in the product tree: the file-level rig gate is deleted from
//          test/review-v38-p2-fence-runs.test.cjs. Kept permanently: it is the
//          only guard that that file's zero-skip claim holds off-box.
//   ROW 6  FIXED in the product tree: the recorded reason now names
//          `close.len === 3 || close.len === open.len`. Kept.
//
// TWO FINDINGS OF THIS REVIEW HAVE NO ROW HERE and were ruled elsewhere. They
// are findings 7 and 8 of the review, and they are NOT the [FINE] ROW 7 and
// ROW 8 below, which are unrelated attack lines.
//   finding 7, the Go max gate: restated in session-v50/progress.md. The gate
//     is set over the 19 rows that render a member surface, p95 gate 130ms and
//     max gate 130ms, with the hollow `ParseConfigOptions` row excluded and
//     named there.
//   finding 8, spelled variant order against the member cap: deferred in
//     session-v50/scraps.md as S50-1.
//
// Nothing here needs a language server or the private measurement rig, so it
// runs identically on a clean clone. Run:
//   SKIP_LIVE=1 node --test test/review-v50-p0-enummerge.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const walkBundle = bundleCore(
  "review-v50-p0-walk",
  `export { resolveCrossFileShape, pyShapeHooks, csShapeHooks } from "../src/core/crossFileShape";
export { renderMemberSignatures } from "../src/core/extraction";\n`,
);
const fenceBundle = bundleCore(
  "review-v50-p0-fence",
  `export { extractFirstCodeBlock, postprocessInstructOutput } from "../src/core/instructPostprocess";\n`,
);
const W = walkBundle.mod;
const F = fenceBundle.mod;
test.after(() => {
  walkBundle.cleanup();
  fenceBundle.cleanup();
});

const show = (v) => JSON.stringify(v);
const BOUND = { D_MAX: 2, N_MAX: 24 };
const methodsOf = (shape, name) => shape.types.get(name)?.methods ?? [];
const withoutEnumLeg = (hooks) => {
  const copy = { ...hooks };
  delete copy.enumMemberLine;
  return copy;
};

// ---------------------------------------------------------------------------
// A fake transport answering from a table keyed on the word under the cursor,
// the same shape the session-v49/v50 walk fixtures use. `resolveTypeCursorByName`
// is the capability C# needs for its SIGNATURE-edge leg; it is present here
// because the product's C# extractor exposes it.
// ---------------------------------------------------------------------------
const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return e > s ? line.slice(s, e) : undefined;
};

function fixture({ files, hovers, defs, members, byName = false }) {
  const extractor = {
    async definition(cursor) {
      const w = wordAt(files[cursor.uri] ?? "", cursor);
      if (!w || !(w in defs)) return undefined;
      const d = defs[w];
      return {
        uri: d.uri,
        range: { startLine: d.line, startCharacter: d.character, endLine: d.line, endCharacter: d.character + w.length },
      };
    },
    async hoverSurface(cursor) {
      const w = wordAt(files[cursor.uri] ?? "", cursor);
      return w && w in hovers ? { signature: hovers[w] } : undefined;
    },
    async membersOfType(cursor) {
      const w = wordAt(files[cursor.uri] ?? "", cursor);
      return (members[w] ?? []).map((m) => ({ ...m }));
    },
    async completeMembers() {
      return [];
    },
    async example() {
      return undefined;
    },
    async qualifyImport() {
      return undefined;
    },
  };
  if (byName) {
    extractor.resolveTypeCursorByName = async (name) => {
      if (!(name in defs)) return undefined;
      const d = defs[name];
      return { uri: d.uri, line: d.line, character: d.character };
    };
  }
  return { extractor, openFile: async (uri) => files[uri] };
}

// ===========================================================================
// THE C# FIXTURE. A Roslyn enum whose variants are signature-less (the shape
// csShapeHooks documents) and which carries ONE signed member naming a
// collaborator. `Palette` is reachable from `LodBand` ONLY through the rendered
// member string, because `csSignatureRefTypes` mines the `methods` array.
// ===========================================================================
const CS_URI = "file:///repo/Atlas/LodBand.cs";
const CS_CONSUMER = "file:///repo/Atlas/Renderer.cs";
const CS_LINES = [
  /*  0 */ "namespace Atlas;",
  /*  1 */ "",
  /*  2 */ "public enum LodBand",
  /*  3 */ "{",
  /*  4 */ "    CONTINENTAL,",
  /*  5 */ "    REGIONAL,",
  /*  6 */ "}",
  /*  7 */ "",
  /*  8 */ "public class Palette",
  /*  9 */ "{",
  /* 10 */ "    public int Count { get; }",
  /* 11 */ "}",
];
const CS_FILES = {
  [CS_URI]: `${CS_LINES.join("\n")}\n`,
  [CS_CONSUMER]: "void Paint(LodBand band) { }\n",
};
const CS_MEMBERS = {
  LodBand: [
    { name: "CONTINENTAL", kind: "field" },
    { name: "REGIONAL", kind: "field" },
    { name: "Blend", kind: "method", signature: "Palette Blend(Palette other)" },
  ],
  Palette: [{ name: "Count", kind: "field", signature: "int Count { get; }" }],
};
const csShape = async (hooks) => {
  const f = fixture({
    files: CS_FILES,
    hovers: { LodBand: "enum Atlas.LodBand", Palette: "class Atlas.Palette" },
    defs: {
      LodBand: { uri: CS_URI, line: 2, character: CS_LINES[2].indexOf("LodBand") },
      Palette: { uri: CS_URI, line: 8, character: CS_LINES[8].indexOf("Palette") },
    },
    members: CS_MEMBERS,
    byName: true,
  });
  return WALK(f, hooks, "LodBand", CS_CONSUMER, "void Paint(".length);
};
const WALK = (f, hooks, rootName, uri, character) =>
  W.resolveCrossFileShape(f.extractor, { uri, line: 0, character }, BOUND, f.openFile, hooks, rootName);

// ---------------------------------------------------------------------------
// ROW 1 [RECORD]. The merge feeds C#'s SIGNATURE edge, so it is on the walk and
// not only on the render. Measured here, not argued.
//
// The claim as it was first cut: contract-phase0.md "Not in this phase" says
// "Phase 0 changes how an already-resolved member list is RENDERED, and nothing
// else", and C# has a second edge source, `csSignatureRefTypes`, fed the very
// `methods` array the merge lengthens (crossFileShape.ts, `signatureRefTypes(methods)`
// in the emit loop). At 19f1e6f an enum's `methods` was the variant spelling
// alone and mined nothing; after the merge every surviving member signature is
// mined, so the walk anchors types it did not anchor.
//
// TRIAGE RULING (2026-08-11): DEFERRED to phase 2, which is deciding C#'s edge
// sources anyway, and unreachable in C# today because Roslyn signs no enum
// variant. With every member unsigned, `variantLines` covers the whole list and
// the merge is a no-op for C#. No product guard was added, deliberately. Phase 2
// owns the decision. This row is demoted to the measurement so that a phase-2
// edit lands on a stated fact rather than on a blank.
//
// THE FACT, measured on this fixture, where `Palette` is reachable from
// `LodBand` ONLY through the rendered member string:
//   merge         types ["LodBand","Palette"]  dropped ["CONTINENTAL","REGIONAL","Blend","Count"]
//   no enum leg   types ["LodBand","Palette"]  dropped ["Blend","Count"]
// The reached TYPE SET under the merge is the no-enum-leg set: the merge hands
// the mine the same signed member a build with no spelling leg would hand it.
// The `dropped` log is where the two differ: the merge mines the spelled
// variant lines as well, and their names are recorded as unanchorable.
// ---------------------------------------------------------------------------
test("[RECORD] the merged list feeds `csSignatureRefTypes`, and its reached type set is the no-enum-leg set", async () => {
  const merged = await csShape(W.csShapeHooks);
  const baseline = await csShape(withoutEnumLeg(W.csShapeHooks));
  const types = [...merged.types.keys()];
  assert.ok(
    methodsOf(merged, "LodBand").includes("Palette Blend(Palette other)"),
    `CONTROL - the merge must keep the signed member, or the mine has nothing to chew. ` +
      `methods=${show(methodsOf(merged, "LodBand"))}`,
  );
  assert.deepEqual(
    types,
    ["LodBand", "Palette"],
    `\`Palette\` is named by no field and by no hover here: the only path to it is ` +
      `\`csSignatureRefTypes\` mining the member line the merge kept. types=${show(types)}`,
  );
  assert.deepEqual(
    types,
    [...baseline.types.keys()],
    `the merge must reach exactly what a build with no enum leg reaches, no more. merge=${show(types)} ` +
      `no-enum-leg=${show([...baseline.types.keys()])}`,
  );
  assert.deepEqual(
    merged.dropped,
    ["CONTINENTAL", "REGIONAL", "Blend", "Count"],
    `the spelled variant lines are mined too, and their names land in the drop log. merge=` +
      `${show(merged.dropped)} no-enum-leg=${show(baseline.dropped)}`,
  );
  assert.deepEqual(
    baseline.dropped,
    ["Blend", "Count"],
    `CONTROL - the baseline must NOT carry the variant names, or the difference above is not the merge's. ` +
      `no-enum-leg=${show(baseline.dropped)}`,
  );
});

// ---------------------------------------------------------------------------
// ROW 2 [RECORD]. What the probe's `--dark` arm really blinds for C#.
//
// `session-v50/probe/latency-baseline.cjs` (goal item 2, progress.md item 2):
//   const blind = (hooks) => (DARK ? { ...hooks, parseFields: () => [], fieldTypeCursor: () => undefined } : hooks);
// The claim as it was first cut: the probe's comment said a dark run has "no
// candidate queued, so the walk reaches the root type and stops", and that is
// false for C#, which has TWO edge sources. `blind()` nulls the field one and
// leaves `signatureRefTypes` untouched, so a dark C# row still resolves
// collaborators and still pays their `definition`/`hoverSurface`/`membersOfType`
// calls inside the timed region.
//
// TRIAGE RULING (2026-08-11): the probe COMMENT is fixed. `blind()` itself is
// deliberately NOT changed, because nulling `signatureRefTypes` would blind an edge C#
// has had since long before the field leg, so the dark arm would measure a C#
// that never existed, and the arm's whole job is to price the field leg against
// the language as it was. The dark C# left-hand side stays what it is.
//
// So this row stops arguing and pins the property instead, measured on the same
// fixture, with no read of the gitignored probe file: with `parseFields` and
// `fieldTypeCursor` nulled exactly as `blind()` nulls them, a C# walk still
// reaches BOTH types. A later edit to `blind()` moves this row.
// ---------------------------------------------------------------------------
test("[RECORD] `blind()` nulls only C#'s field leg, so a dark C# walk still reaches the signature-edge type", async () => {
  const dark = { ...W.csShapeHooks, parseFields: () => [], fieldTypeCursor: () => undefined };
  const darkTypes = [...(await csShape(dark)).types.keys()];
  const litTypes = [...(await csShape(W.csShapeHooks)).types.keys()];
  assert.deepEqual(
    darkTypes,
    ["LodBand", "Palette"],
    `with the field leg nulled the way \`blind()\` nulls it, C#'s signature edge is untouched and the walk ` +
      `goes past the root. dark=${show(darkTypes)}`,
  );
  assert.deepEqual(
    darkTypes,
    litTypes,
    `CONTROL - blinding the field leg must cost this fixture nothing, or \`Palette\` was not reached through ` +
      `the signature edge. dark=${show(darkTypes)} lit=${show(litTypes)}`,
  );
});

// ===========================================================================
// THE PYTHON FIXTURE, IN THE PRODUCT'S OWN TRANSPORT SHAPE.
//
// goal.md phase 0 item 1 and the code comment both state the fact this fixture
// encodes: "the product's Python transport backfills every member's signature
// from a hover, so its variants arrive WITH signatures". That is why the old
// `methods.length === 0` gate never fired in the product. So a variant here
// carries `CONTINENTAL: Literal[0]`, which is the exact string goal.md quotes.
// ===========================================================================
const PY_URI = "file:///repo/atlas/_core.py";
const PY_CONSUMER = "file:///repo/atlas/render.py";
const PY_LINES = [
  /* 0 */ "from enum import IntEnum",
  /* 1 */ "",
  /* 2 */ "class LodBand(IntEnum):",
  /* 3 */ "    CONTINENTAL = 0",
  /* 4 */ "    REGIONAL = 1",
  /* 5 */ "",
  /* 6 */ "    def describe(self) -> str:",
  /* 7 */ "        return self.name.lower()",
];
const PY_FILES = {
  [PY_URI]: `${PY_LINES.join("\n")}\n`,
  [PY_CONSUMER]: "def paint(band: LodBand) -> None:\n    pass\n",
};
// SIGNED: what the product's transport hands the walk.
const PY_SIGNED = [
  { name: "CONTINENTAL", kind: "field", signature: "CONTINENTAL: Literal[0]" },
  { name: "REGIONAL", kind: "field", signature: "REGIONAL: Literal[1]" },
  { name: "describe", kind: "method", signature: "describe(self) -> str" },
];
const pyShape = async (members, hooks) => {
  const f = fixture({
    files: PY_FILES,
    hovers: { LodBand: "(class) LodBand" },
    defs: { LodBand: { uri: PY_URI, line: 2, character: PY_LINES[2].indexOf("LodBand") } },
    members: { LodBand: members },
  });
  return WALK(f, hooks, "LodBand", PY_CONSUMER, "def paint(band: ".length);
};

// ---------------------------------------------------------------------------
// ROW 3 AND ROW 4 ARE DELETED (triage, 2026-08-11). Both asserted a defect in
// test/blind-v50-p0-enummerge.test.cjs, the blind oracle's own file. A review
// file is the wrong home for that guard: the oracle is being re-cut by another
// agent, and a row here would either duplicate its fix or go stale against it.
// The claims are kept, because a deletion in this repo records what was lost.
//
// WHAT ROW 3 ASSERTED [MEDIUM]. The oracle implements contract C0-2 bullet 2 as
// "every line rendered with the leg absent survives the leg firing"
// (`const lost = before.filter((l) => !after.includes(l)); assert.deepEqual(lost, [])`).
// The contract states something narrower: every member the hook does NOT spell
// keeps its line. The two are the same statement only on the oracle's fixture,
// whose variants carry no signature and so render nothing with the leg absent.
// On the product's transport they conflict, because C0-1 requires that
// `CONTINENTAL: Literal[0]` not appear and that line is exactly what the
// leg-absent rendering produces. Measured on the working tree, signed variants:
//   no-hook  ["CONTINENTAL: Literal[0]","REGIONAL: Literal[1]","describe(self) -> str"]
//   hooked   ["LodBand.CONTINENTAL","LodBand.REGIONAL","describe(self) -> str"]
// The product is right and the oracle's row is what breaks. ROW 8 below still
// runs on the signed shape, so the product side of this claim keeps a guard.
//
// WHAT ROW 4 ASSERTED [LOW]. The oracle's C0-1 row forbids the string
// `CONTINENTAL: Literal[0]` on a fixture whose unsigned variants cannot produce
// it by any path, including with the enum leg removed entirely. A guard whose
// predicate holds under the negation of the behaviour it guards discriminates
// nothing. Vacuous in the same way, and for the same reason (an unsigned
// headless transport), as the old `methods.length === 0` proxy the phase is
// removing. It becomes load-bearing only on a SIGNED member list.
//
// The unsigned fixture list this file kept for ROW 4 went with the rows.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ROW 5 [FIXED, was DEFECT MEDIUM]. `review-v38-p2-fence-runs.test.cjs` reports
// zero skips on a box with no private measurement rig. NOW it does.
//
// contract-phase0.md C0-5: "The file reports no skips afterwards", and the
// file's own comment: "This file now reports zero skips, which is what its own
// first paragraph has always claimed." When this row was first cut both were
// true only on a box WITH the rig: the file still early-returned on
// `RIG_PRESENT`, so off-box it registered one skipped row and ran none of its
// nine, while not one of the nine touched the rig any more. The gate is now
// deleted from that file, and this row is what holds it deleted. It is kept
// permanently: it is the only guard anywhere that the zero-skip claim holds
// off-box, and the box that runs the suite is usually the box with the rig, so
// nothing else would notice a new gate.
//
// The method is the one that found the defect: run the file in a child with the
// rig reported absent, and read the counts off its own TAP summary. Source text
// alone would only say the current spelling of the gate is gone.
// ---------------------------------------------------------------------------
test("[FIXED] review-v38-p2 runs all nine of its rows with the private rig absent, and skips none", () => {
  const target = path.join(__dirname, "review-v38-p2-fence-runs.test.cjs");
  const rigPresent = path.join(__dirname, ".rig-present.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v50-rigless-"));
  const stub = path.join(dir, "no-rig.cjs");
  // The rig detector is `fs.existsSync(session-complxity-research/spikes)`, so
  // making that one path answer false is the whole simulation of a clean clone.
  // The second patch renames the child's esbuild bundle tag: the suite runs test
  // FILES in parallel, and the child bundles the same tag the real file does, so
  // without this the two would write and delete each other's scratch bundle.
  fs.writeFileSync(
    stub,
    'const fs = require("fs");\n' +
      "const real = fs.existsSync.bind(fs);\n" +
      'fs.existsSync = (p) => (String(p).includes("session-complxity-research") ? false : real(p));\n' +
      'const Module = require("module");\n' +
      "const origRequire = Module.prototype.require;\n" +
      "Module.prototype.require = function (id) {\n" +
      "  const m = origRequire.apply(this, arguments);\n" +
      '  if (/\\.blind-util\\.cjs$/.test(id) && m && typeof m.bundleCore === "function") {\n' +
      "    return { ...m, bundleCore: (tag, src) => m.bundleCore(tag + '.rigless-probe-' + process.pid, src) };\n" +
      "  }\n" +
      "  return m;\n" +
      "};\n",
  );
  // NODE_TEST_CONTEXT is set in this process because we ARE a test file, and an
  // inherited copy makes the child refuse to run files ("called recursively").
  const childEnv = { ...process.env, SKIP_LIVE: "1" };
  delete childEnv.NODE_TEST_CONTEXT;
  const run = (args) =>
    spawnSync(process.execPath, args, {
      cwd: path.join(__dirname, ".."),
      env: childEnv,
      encoding: "utf8",
      timeout: 120000,
    });
  try {
    const probe = run(["--require", stub, "-e", `process.stdout.write(String(require(${JSON.stringify(rigPresent)}).RIG_PRESENT))`]);
    assert.equal(
      probe.stdout.trim(),
      "false",
      `CONTROL - the stub must actually turn the rig off, or this row proves nothing. stdout=` +
        `${show(probe.stdout)} stderr=${show(probe.stderr)}`,
    );
    const res = run(["--test", "--test-reporter=tap", "--require", stub, target]);
    const out = `${res.stdout}${res.stderr}`;
    const count = (label) => {
      const m = new RegExp(`^# ${label} (\\d+)$`, "m").exec(out);
      assert.ok(m, `CONTROL - no "# ${label}" line in the child's TAP summary. output=${show(out.slice(-2000))}`);
      return Number(m[1]);
    };
    assert.equal(count("skipped"), 0, `a rig-less box must skip nothing in that file. output=${show(out.slice(-2000))}`);
    assert.equal(count("fail"), 0, `a rig-less box must fail nothing in that file. output=${show(out.slice(-2000))}`);
    assert.equal(count("tests"), 9, `the file's nine rows must all register. output=${show(out.slice(-2000))}`);
    assert.equal(count("pass"), 9, `and all nine must pass without the rig. output=${show(out.slice(-2000))}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ROW 6 [FIXED, was DEFECT LOW]. The recorded reason for the deleted 4/3 row
// names the mechanism that actually refutes it.
//
// When this row was first cut, the comment left where that row had been said the
// claim "was REFUTED by the shipped code the same way ROW 6's was, through the
// loop-back that stops a longer run closing a shorter opener". The OUTCOME was
// right. Reconstructed to the shape the comment states (fences ["````rust",
// "```"], a complete function between them), the shipped code extracts the block
// whole and the fence guard does not refuse it, in all three framings checked
// (bare, prose before, prose before and after). The MECHANISM was not: a run-3
// closes a run-4 opener through `close.len === 3 || close.len === open.len` in
// `extractFirstCodeBlock`, and the rule the comment named runs in the OTHER
// direction. The deleted row can never be re-derived, so its recorded reason is
// the whole surviving record of it.
//
// The comment now names `close.len === 3 || close.len === open.len` and says
// explicitly that it is the opposite direction to the run-3 block rule. This row
// stays as the guard on that record: it pins BOTH directions against the shipped
// code, and checks the record still cites the clause that decides them.
// ---------------------------------------------------------------------------
test("[FIXED] the deleted 4/3 row's recorded reason cites the clause that really admits a 4/3 reply", () => {
  const fenceGuardRefuses = (text) => text.split("\n").some((line) => /^(```|~~~)/.test(line.trim()));
  const body = ["fn snapshot(&self) -> Snapshot {", "    self.inner.lock().snapshot()", "}"].join("\n");
  const reply43 = "````rust\n" + body + "\n```\n";
  const reply34 = "```rust\n" + body + "\n````\n";

  // The outcome half of the recorded claim, and it holds.
  assert.equal(
    fenceGuardRefuses(F.postprocessInstructOutput(reply43)),
    false,
    `CONTROL - the recorded outcome ("refuted by the shipped code") must be true, or this row is arguing ` +
      `with the wrong half. postprocess=${show(F.postprocessInstructOutput(reply43))}`,
  );
  // The named rule, in the direction it actually runs: a LONGER run does not
  // close a SHORTER opener, so this one is never extracted.
  assert.equal(
    F.extractFirstCodeBlock(reply34),
    undefined,
    `CONTROL - the rule the comment names must be real: an open-3 block is not closed by a run-4 line`,
  );
  // The clause that DOES decide a 4/3 reply, in the direction it runs: a shorter
  // run closes a longer opener, so the block comes out whole.
  assert.equal(
    F.extractFirstCodeBlock(reply43),
    body,
    `a bare run-3 line closes a run-4 opener through \`close.len === 3 || close.len === open.len\`, so the ` +
      `4/3 reply extracts whole and never reaches the fence guard. Got ${show(F.extractFirstCodeBlock(reply43))}`,
  );
  const record = fs.readFileSync(path.join(__dirname, "review-v38-p2-fence-runs.test.cjs"), "utf8");
  assert.ok(
    record.includes("close.len === 3 || close.len === open.len"),
    `the deleted 4/3 row can never be re-derived, so the comment left at its gap is the whole surviving ` +
      `record of it, and it has to name the clause that refutes it. That clause is missing from ` +
      `review-v38-p2-fence-runs.test.cjs`,
  );
});

// ---------------------------------------------------------------------------
// ROW 7 [FINE]. THE SUBSET ATTACK FOUND NOTHING, and this row keeps it that way.
//
// The merge now calls `renderMethods` on a SUBSET of the members (the ones the
// hook declined). If that function had any cross-member state — a cap, a
// dedupe, a "first N", a join that a neighbour can perturb — a survivor's line
// would depend on who else was in the list. It does not: the construction
// filter is per member (`isConstructionMember(m.name, typeName)`) and
// `renderMemberSignatures` is a per-member filter/map/join. Checked over 200
// random member sets: rendering the subset gives each survivor byte-identically
// the line rendering the whole set gave it, in the same relative order.
// ---------------------------------------------------------------------------
test("[FINE] rendering a SUBSET gives every survivor the same line, in the same order, as rendering the whole set", () => {
  const render = W.renderMemberSignatures;
  const rnd = (n) => Math.floor(Math.random() * n);
  const KINDS = ["method", "function", "field", "property", "other"];
  const SIGS = [undefined, "", "do(x: int) -> str", "value: int", "constructor(a: A)", "LodBand(x: int)"];
  const TRAITS = [undefined, "Clone", "Debug", "MyTrait"];
  for (let iter = 0; iter < 200; iter++) {
    const typeName = "LodBand";
    const members = [];
    for (let i = 0, n = rnd(9); i < n; i++) {
      const m = { name: ["a", "b", "constructor", "__init__", typeName, "describe"][rnd(6)], kind: KINDS[rnd(KINDS.length)] };
      const s = SIGS[rnd(SIGS.length)];
      if (s !== undefined) m.signature = s;
      const t = TRAITS[rnd(TRAITS.length)];
      if (t !== undefined) m.viaTrait = t;
      members.push(m);
    }
    const keep = members.filter(() => Math.random() < 0.5);
    // `renderMethods`, reproduced: the construction filter then the shared
    // signature renderer. Copied rather than imported because the product's is
    // module-private.
    const linesOf = (ms) => {
      const joined = render(ms.filter((m) => !(m.name === "constructor" || m.name === "__init__" || m.name === typeName)));
      return joined.length > 0 ? joined.split("\n").filter((l) => l.length > 0) : [];
    };
    // COMPOSITIONALITY is the property that makes a subset safe: the lines of a
    // list are the concatenation of the lines of its members taken one at a
    // time. Anything cross-member (a cap, a dedupe, a first-N) breaks this.
    assert.deepEqual(
      linesOf(members),
      members.flatMap((m) => linesOf([m])),
      `whole-set rendering is not per-member for members=${show(members)}`,
    );
    assert.deepEqual(
      linesOf(keep),
      keep.flatMap((m) => linesOf([m])),
      `subset rendering diverged for members=${show(members)} keep=${show(keep)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// ROW 8 [FINE]. THE DUPLICATE ATTACK FOUND NOTHING. Each member lands in exactly
// one of the two buckets, so no member can contribute both a spelled line and a
// rendered one. Checked on the shape most likely to break it: a signed variant
// list, where the member has a renderable line AND a spelling.
// ---------------------------------------------------------------------------
test("[FINE] no member is both spelled and rendered - the merge emits one line per member, never two", async () => {
  const hooked = methodsOf(await pyShape(PY_SIGNED, W.pyShapeHooks), "LodBand");
  assert.deepEqual(
    hooked,
    ["LodBand.CONTINENTAL", "LodBand.REGIONAL", "describe(self) -> str"],
    `a spelled member must not also contribute its rendered line, and a rendered member must not also be ` +
      `spelled. Got ${show(hooked)}`,
  );
  assert.equal(new Set(hooked).size, hooked.length, `no duplicate line: ${show(hooked)}`);
});
