// BLIND ORACLE - session-v50 phase 0, "the enum spelling is a merge".
//
// Binds to the phase 0 contract and to nothing else. While writing the
// assertions in this file the BODY of src/core/crossFileShape.ts was never
// opened, and src/vscode/fnGen.ts was never opened at all. The only src reads
// were type declarations, far enough to build a fixture a real transport would
// also satisfy:
//
//   * src/core/extraction.ts - `SourceCursor`, `MemberKind`, `CompletionMember`,
//     the method list of `SurfaceExtractor`.
//   * the head of src/core/crossFileShape.ts - `DerivedType`, `CrossFileBound`,
//     `CrossFileShape`, `CrossFileShapeHooks`. Declarations only; the hook
//     objects and the walk itself were not read.
//
// No expectation below was copied out of the product.
//
// ---------------------------------------------------------------------------
// WHERE THE RIGHT-HAND SIDES COME FROM, GIVEN AN ORACLE MAY NOT INVENT A RENDER.
//
// C0-2 is written in the language of a DIFFERENCE: a member the hook does not
// spell "contributes exactly the line it would have contributed had the enum leg
// not fired at all. Same text, byte for byte." That has a left-hand side the
// oracle can produce without knowing the render: run the identical fixture twice
// against the SAME hooks object with `enumMemberLine` removed, and diff. Every
// row below that talks about a rendered line for an ordinary member is bound
// that way, so none of them can be wrong about a render they never state.
//
// The spelled lines have the same treatment. Which members a hook speaks for,
// and what it spells them, is the hook's own published answer:
// `pyShapeHooks.enumMemberLine(member, typeName, signature, defLines)`. This file
// asks it, and then requires the walk to agree with it. That is the contract's
// "every member the hook spells contributes its spelled line" stated without a
// single hardcoded string.
//
// The one hardcoded shape in the file is `LodBand.<variant>`, which is the
// contract's own worked text (C0-1: "`LodBand.CONTINENTAL` and `LodBand.REGIONAL`
// appear"; C0-3: "still renders `LodBand.CONTINENTAL` per variant"), quoted from
// the contract and not from the code. Three rows bind it: C0-3's enum row, C0-1's
// signed row, and C0-4's order row. Those three bind the contract text rather
// than the hook's answer on purpose, so that a hook which declines to speak fails
// them instead of excusing them. C0-4 also cross-checks that where the hook DOES
// speak it agrees with that text, so the two families cannot drift apart.
//
// ---------------------------------------------------------------------------
// WHAT IS EXPECTED TO BE RED ON ARRIVAL, AND WHY THAT IS THE JOB.
//
// The merge is not built yet. These rows are written against the contract, not
// against the working tree, so a red here is the correct output of a blind
// oracle and not a regression:
//
//   * every C0-1 row - the enum's own method surviving the variant spelling.
//   * the C0-2 rows that run on the ENUM fixture: the spelled-lines row, the
//     unspelled-lines-survive-byte-for-byte row, and the never-fewer-lines row.
//   * the C0-4 order row, which cannot pass until the merge exists to order.
//
// These are TRIPWIRES and were green when written. A red in any of them is
// over-reach - phase 0 moving something it promised not to move:
//
//   * C0-2's "a hook that spells nothing leaves the list byte-identical" rows,
//     in both forms (no hook at all, and a hook that answers undefined to
//     everything), plus the plain-Python-class row.
//   * both C0-3 rows: the C# enum still spells its variants, and the C# class
//     still renders its members with no `Widget.` spelling anywhere.
//
// C0-5 is a ruling about two other test files. It is not bound here.
//
// ---------------------------------------------------------------------------
// WHAT THE FIRST RUN ACTUALLY FOUND, 2026-08-11. THE BUILD GOT THERE FIRST.
//
// All rows came back GREEN against the working tree, including every row listed
// above as expected-red. src/core/crossFileShape.ts was written minutes after
// contract-phase0.md and before this file ran. The merge had already landed.
//
// A green oracle that was written to be red is worth nothing until it is shown to
// be load-bearing, so every row is also run against COMMIT 00cf79c ("session-v48:
// the context dial, the window guard, and the end of the known-red set"), the tip
// of session-v48 and the last commit before session-v50. Method: `git archive
// 00cf79c src | tar -x` into a scratch tree, then this same file with its one
// entry-point import repointed at that tree, nothing else changed.
//
// ---------------------------------------------------------------------------
// THE RE-CUT, AFTER AN ADVERSARIAL REVIEW FOUND TWO ROWS WRONG.
//
// DEFECT A. C0-2 (2) used to require EVERY leg-absent line to survive the leg
// firing. That is stronger than bullet 2, which is about the members the hook
// does NOT spell, and on the signed transport shape it is the OPPOSITE of C0-1:
// `CONTINENTAL: Literal[0]` renders with the leg absent and C0-1 forbids it once
// the leg fires. The row now splits the leg-absent rendering by asking the hook
// which members it speaks for, and requires exactly the other members' lines to
// survive byte for byte. See `pySplitBare`.
//
// DEFECT B. "No raw variant signature leaks" ran on a fixture whose variants
// carried no signature, so the forbidden strings were absent whatever the walk
// did. It is now on the signed fixture and proves itself in place: the leg-absent
// run must CONTAIN each forbidden string before the hooked run is forbidden it.
//
// THE FIXTURE THOSE TWO DEFECTS SHARED. The signature-less variant shape is not
// what the product's Python transport produces. PY_SIGNED_ENUM_MEMBERS is now the
// primary fixture and C0-1 has a row that exercises all three of its bullets
// there. The signature-less shape is kept as the degenerate case, and no negative
// row is bound to it.
//
// ---------------------------------------------------------------------------
// MEASURED AT 00cf79c, ON THIS RE-CUT FILE. 6 of 13 fail.
//
//   RED, and each red is the contract's own sentence:
//     C0-1 (SIGNED)   methods(LodBand) is ["CONTINENTAL: Literal[0]",
//                     "REGIONAL: Literal[1]","describe(self) -> str"]. The
//                     spelling never happens and the raw variant signatures are
//                     in the prompt.
//     C0-1 (merge)    on the signature-less fixture, methods(LodBand) is
//                     ["describe(self) -> str"]: no `LodBand.CONTINENTAL`.
//     C0-1 (no leak)  red for the raw signatures above. This is the row's
//                     detector direction: it fails when the enum leg does not
//                     fire.
//     C0-2 (1)        the hook spells LodBand.CONTINENTAL and LodBand.REGIONAL
//                     and the walk emits neither.
//     C0-2 (2) signed the hook speaks for no member of the signed fixture at all.
//     C0-4            hooked is the three raw lines; the two spelled lines that
//                     must come first are absent.
//
//   TWO CORRECTIONS TO THE FIRST RUN'S NOTES, which did not reproduce:
//     1. The first run recorded 00cf79c's hooked list as ["LodBand.CONTINENTAL",
//        "LodBand.REGIONAL"] with `describe` deleted. It is not. At 00cf79c the
//        enum leg does not fire on this fixture at all, so `describe` survives
//        and the VARIANTS are the missing thing. The defect the baseline actually
//        shows is a spelling that never happens, not a spelling that eats a line.
//     2. The first run recorded C0-2 (4), the count row, as red at 00cf79c on
//        PY_METHOD_HEAVY. It is green there, with the variant signed or
//        signature-less, and for the same reason: nothing is replaced because
//        nothing is spelled. A count is a weak witness and this is what that
//        weakness looks like.
//
//   GREEN ON BOTH SIDES, and why each is kept:
//     C0-2 (2) signature-less   green because the baseline leg never fires, so
//                               nothing is dropped. Kept as the degenerate-shape
//                               half of the re-cut: it is the shape the old row
//                               was written against, its controls all pass, and
//                               dropping it would trade coverage away rather than
//                               fix it.
//     C0-2 (3) x2, C0-3 x2      TRIPWIRES. They were never detectors. A red in
//                               any of them is phase 0 moving something it
//                               promised not to move.
//     C0-2 (4)                  a weak witness, see correction 2. Kept because it
//                               is the only row that states the "never goes DOWN"
//                               bullet as a bullet, and it will catch a future
//                               merge that trades lines rather than adding them.
//     guard                     the bundle row. Its job is to make a build
//                               failure loud instead of a false green.
//
// Nothing in this file needs a live language server, so SKIP_LIVE=1 changes
// nothing about what runs.
//
// Run: SKIP_LIVE=1 node --test test/blind-v50-p0-enummerge.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const show = (v) => JSON.stringify(v);

// ===========================================================================
// HARNESS. The walk and the two hooks under test, bundled pure. No vscode on
// this path. Shape copied from test/blind-v49-p1-go-fields.test.cjs.
// ===========================================================================

const ENTRY = path.join(__dirname, ".blind-v50-p0-enummerge.entry.ts");
const OUT = path.join(__dirname, ".blind-v50-p0-enummerge.bundle.cjs");
let WALK = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { resolveCrossFileShape, pyShapeHooks, csShapeHooks } from "../src/core/crossFileShape";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node" });
  WALK = require(OUT);
} catch (e) {
  bundleErr = e;
}
test.after(() => [ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

// A bundle failure is a LOUD row, never a skip: a file that goes green because
// it could not build its subject is the false green this suite exists to stop.
const wtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) assert.fail(`the crossFileShape bundle did not build: ${bundleErr.message}`);
    assert.equal(typeof WALK.resolveCrossFileShape, "function", "resolveCrossFileShape must be exported");
    return fn(ctx);
  });

test("guard: the bundle builds headless and every entry point this file drives is exported", () => {
  if (bundleErr) assert.fail(`crossFileShape bundle failed: ${bundleErr.message}`);
  assert.equal(typeof WALK.resolveCrossFileShape, "function", "resolveCrossFileShape must be exported");
  for (const h of ["pyShapeHooks", "csShapeHooks"]) {
    assert.equal(typeof WALK[h], "object", `${h} must be exported from src/core/crossFileShape`);
    assert.equal(typeof WALK[h].enumMemberLine, "function", `${h}.enumMemberLine is the hook C0-1..C0-4 are about`);
  }
});

// ===========================================================================
// THE FIXTURE. A fake transport answering from an in-memory table keyed by the
// word under the cursor, which is how a real server behaves: the walk hands it a
// position, not a name. Same shape as the session-v49 walk fixture.
// ===========================================================================

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return e > s ? line.slice(s, e) : undefined;
};

function walkFixture({ files, hovers, members = {}, defs }) {
  const calls = [];
  const record = (op, cursor) => {
    const word = wordAt(files[cursor.uri] ?? "", cursor);
    calls.push({ op, word, uri: cursor.uri, line: cursor.line, character: cursor.character });
    return word;
  };
  const extractor = {
    async definition(cursor) {
      const word = record("definition", cursor);
      if (!word || !(word in defs)) return undefined;
      const d = defs[word];
      return {
        uri: d.uri,
        range: {
          startLine: d.line,
          startCharacter: d.character,
          endLine: d.line,
          endCharacter: d.character + word.length,
        },
      };
    },
    async hoverSurface(cursor) {
      const word = record("hover", cursor);
      return word && word in hovers ? { signature: hovers[word] } : undefined;
    },
    async membersOfType(cursor) {
      const word = record("members", cursor);
      return (members[word] ?? []).map((m) => ({ ...m }));
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
  return {
    extractor,
    calls,
    openFile: async (uri) => files[uri],
    rootAt(uri, name, line = 0) {
      const text = (files[uri] || "").split("\n")[line] ?? "";
      return { uri, line, character: text.indexOf(name) };
    },
  };
}

// Generous bounds, so no row below is bounded by the fixture rather than by the
// property it is testing. Phase 0 changes a RENDER; depth and breadth are not
// its subject.
const BOUND = { D_MAX: 2, N_MAX: 24 };

const methodsOf = (shape, name) => shape.types.get(name)?.methods ?? [];
const dump = (label, shape, name) =>
  `\n  [${label}] types: ${show([...shape.types.keys()])}` +
  `\n  [${label}] methods(${name}): ${show(methodsOf(shape, name))}` +
  `\n  [${label}] dropped: ${show(shape.dropped)}`;

// The two hook variants every "byte for byte" row is measured against. Neither
// invents a render: they are the SAME hooks object the product ships, with the
// one hook under test removed or silenced.
const withoutEnumLeg = (hooks) => {
  const copy = { ...hooks };
  delete copy.enumMemberLine;
  return copy;
};
const spellsNothing = (hooks) => ({ ...hooks, enumMemberLine: () => undefined });

// ===========================================================================
// THE PYTHON ENUM. The contract's worked example: `class LodBand(IntEnum):` with
// two data members and one ordinary callable.
//
// The transport shape is pyright's, as the contract states it: the class hovers
// as `(class) LodBand` whether or not it is an Enum (which is why the hook reads
// the declaring source instead), variants resolve with NO signature, and the
// method arrives WITH one, "as the product's Python transport always supplies
// one".
// ===========================================================================

const PY_URI = "file:///repo/atlas/_core.py";
const PY_CONSUMER = "file:///repo/atlas/render.py";
const PY_LINES = [
  /*  0 */ "from enum import IntEnum",
  /*  1 */ "",
  /*  2 */ "class LodBand(IntEnum):",
  /*  3 */ "    CONTINENTAL = 0",
  /*  4 */ "    REGIONAL = 1",
  /*  5 */ "",
  /*  6 */ "    def describe(self) -> str:",
  /*  7 */ "        return self.name.lower()",
  /*  8 */ "",
  /*  9 */ "    def label(self) -> str:",
  /* 10 */ "        return self.describe().title()",
  /* 11 */ "",
  /* 12 */ "class StripeSummary:",
  /* 13 */ "    aggregate: int",
  /* 14 */ "",
  /* 15 */ "    def total(self) -> int:",
  /* 16 */ "        return self.aggregate",
];
const PY_TEXT = `${PY_LINES.join("\n")}\n`;

const DESCRIBE_SIG = "describe(self) -> str";
const LABEL_SIG = "label(self) -> str";

// The variant signatures pyright hands back for an IntEnum member. C0-1 names
// `CONTINENTAL: Literal[0]` itself, as the thing that must NOT reach the list.
const CONTINENTAL_SIG = "CONTINENTAL: Literal[0]";
const REGIONAL_SIG = "REGIONAL: Literal[1]";

// THE SIGNED SHAPE, and the primary fixture of this file. The contract says the
// product's Python transport always supplies a signature, and it says so about
// the members generally, not about callables alone. A variant therefore arrives
// carrying `CONTINENTAL: Literal[0]`, which is exactly the line C0-1 forbids
// from appearing once the spelling has fired. Every row that can run here runs
// here.
const PY_SIGNED_ENUM_MEMBERS = [
  { name: "CONTINENTAL", kind: "field", signature: CONTINENTAL_SIG },
  { name: "REGIONAL", kind: "field", signature: REGIONAL_SIG },
  { name: "describe", kind: "method", signature: DESCRIBE_SIG },
];

// THE SIGNATURE-LESS SHAPE, kept only as the degenerate case. A transport that
// hands back a variant with nothing on it is not what the product sees, and a
// negative row bound here is vacuous: the forbidden text cannot appear because
// nothing ever supplied it. Rows that assert a POSITIVE property may still use
// it; rows that forbid a string may not.
//
// Member ORDER here is declaration order. C0-4's row uses a different order on
// purpose; see its own fixture.
const PY_ENUM_MEMBERS = [
  { name: "CONTINENTAL", kind: "field" },
  { name: "REGIONAL", kind: "field" },
  { name: "describe", kind: "method", signature: DESCRIBE_SIG },
];

// ONE variant and TWO callables, so that a replacement makes the list SHORTER
// rather than longer. C0-2's fourth bullet needs this: on the balanced fixture
// above, a replacement swaps one rendered line for two spelled ones and the
// count goes UP while a member is being destroyed, so a count row measured there
// passes while the defect is live.
const PY_METHOD_HEAVY = [
  { name: "CONTINENTAL", kind: "field", signature: CONTINENTAL_SIG },
  { name: "describe", kind: "method", signature: DESCRIBE_SIG },
  { name: "label", kind: "method", signature: LABEL_SIG },
];

function pyFixture(members) {
  return walkFixture({
    files: {
      [PY_URI]: PY_TEXT,
      [PY_CONSUMER]: "def paint(band: LodBand, s: StripeSummary) -> None:\n    pass\n",
    },
    hovers: { LodBand: "(class) LodBand", StripeSummary: "(class) StripeSummary" },
    defs: {
      LodBand: { uri: PY_URI, line: 2, character: PY_LINES[2].indexOf("LodBand") },
      StripeSummary: { uri: PY_URI, line: 12, character: PY_LINES[12].indexOf("StripeSummary") },
    },
    members,
  });
}

const pyShape = async (rootName, members, hooks) => {
  const f = pyFixture(members);
  const shape = await WALK.resolveCrossFileShape(
    f.extractor,
    f.rootAt(PY_CONSUMER, rootName),
    BOUND,
    f.openFile,
    hooks,
    rootName,
  );
  return { f, shape };
};

const pyEnumShape = (hooks, members = PY_ENUM_MEMBERS) => pyShape("LodBand", { LodBand: members }, hooks);

// The hook's OWN answer for a member of this fixture. Every "the hook spells it"
// assertion below is measured against this call rather than against a string
// this file chose.
const pySpells = (member, typeName = "LodBand") =>
  WALK.pyShapeHooks.enumMemberLine(member, typeName, `(class) ${typeName}`, PY_LINES);

// C0-2's second bullet is about the members the hook does NOT spell, and only
// those. Bullet 2 says nothing about what happens to a SPELLED member's old
// line, and C0-1 says the spelled member's old line (`CONTINENTAL: Literal[0]`)
// must be gone, so a row that requires every leg-absent line to survive is
// asserting the opposite of the contract on the shape the product actually has.
//
// This splits the leg-absent rendering into the two groups the contract names,
// and it does so without stating what any rendered line looks like:
//
//   * WHICH members the hook speaks for is the hook's own published answer.
//   * WHAT the spoken-for members render to with the leg absent comes from a
//     second leg-absent walk driven with only those members, so the lines to
//     subtract are the product's, not this file's.
//   * `survivors` is therefore the full leg-absent rendering minus the
//     spoken-for members' share: exactly "the line it would have contributed had
//     the enum leg not fired at all", for exactly the members bullet 2 covers,
//     taken byte for byte off the full-fixture run.
async function pySplitBare(members) {
  const spoken = members.filter((m) => typeof pySpells(m) === "string");
  const unspoken = members.filter((m) => typeof pySpells(m) !== "string");
  const bare = await pyEnumShape(withoutEnumLeg(WALK.pyShapeHooks), members);
  const full = methodsOf(bare.shape, "LodBand");
  let spokenOnly = [];
  if (spoken.length > 0) {
    const s = await pyEnumShape(withoutEnumLeg(WALK.pyShapeHooks), spoken);
    spokenOnly = methodsOf(s.shape, "LodBand");
  }
  return { spoken, unspoken, bare, full, spokenOnly, survivors: full.filter((l) => !spokenOnly.includes(l)) };
}

// ===========================================================================
// C0-1. An enum's own methods survive the variant spelling.
//
// EXPECTED RED. This is the black-box statement of the defect.
// ===========================================================================

wtest("C0-1 (SIGNED transport): all three bullets hold at once on the shape the product actually has", async () => {
  // The whole C0-1 claim, on the signed fixture: the two spelled variants, the
  // method's rendered line with the transport's signature unchanged, and no raw
  // variant signature anywhere. Each of the three is anti-vacuity-checked
  // against the same fixture with the enum leg removed, so none of them can pass
  // because the fixture never offered the thing being asked about.
  const { shape } = await pyEnumShape(WALK.pyShapeHooks, PY_SIGNED_ENUM_MEMBERS);
  assert.ok(shape.types.has("LodBand"), `CONTROL - the root must resolve at all${dump("hooked", shape, "LodBand")}`);
  const lines = methodsOf(shape, "LodBand");
  const split = await pySplitBare(PY_SIGNED_ENUM_MEMBERS);

  // Bullet 1, bound to the contract's own worked text: "`LodBand.CONTINENTAL`
  // and `LodBand.REGIONAL` appear." Those two strings are quoted out of C0-1,
  // not out of the product, which is the same licence C0-3's row takes. Binding
  // the literal rather than the hook's answer matters here: it keeps the row a
  // statement about the MEMBER LIST, so a hook that declines to speak for a
  // signed variant fails this row instead of excusing it.
  for (const want of ["LodBand.CONTINENTAL", "LodBand.REGIONAL"]) {
    assert.ok(
      lines.includes(want),
      `${show(want)} is missing from the member list. The transport signed its variants, which is the shape the ` +
        `product's Python transport actually produces, and C0-1 asks for the spelling on exactly that shape. ` +
        `The hook answered ${show(PY_SIGNED_ENUM_MEMBERS.map((m) => [m.name, pySpells(m)]))}` +
        dump("hooked", shape, "LodBand"),
    );
  }

  // Bullet 2. The rendered line for `describe`, with the signature the transport
  // gave it, unchanged. `survivors` is the leg-absent text for the members the
  // hook does not speak for, taken off the product's own leg-absent run.
  assert.ok(
    split.survivors.length > 0,
    `CONTROL - with the leg absent the members the hook does not spell must render something, or "unchanged" is ` +
      `a claim about an empty set${dump("no-hook", split.bare.shape, "LodBand")}`,
  );
  assert.ok(
    split.survivors.some((l) => l.includes(DESCRIBE_SIG)),
    `CONTROL - and that text must be \`describe\`'s${dump("no-hook", split.bare.shape, "LodBand")}`,
  );
  assert.deepEqual(
    split.survivors.filter((l) => !lines.includes(l)),
    [],
    `\`describe\` was deleted from the prompt by the act of spelling the variants. This is the defect C0-1 ` +
      `states: the variant spelling REPLACES the whole rendered list instead of merging into it.` +
      dump("no-hook", split.bare.shape, "LodBand") +
      dump("hooked", shape, "LodBand"),
  );

  // Bullet 3. Neither `CONTINENTAL: Literal[0]` nor any other raw variant
  // signature appears. The transport supplied both strings and the leg-absent
  // run renders them, so this is a live forbidding and not an absent one.
  for (const bad of [CONTINENTAL_SIG, REGIONAL_SIG]) {
    assert.ok(
      split.full.some((l) => l.includes(bad)),
      `CONTROL - ${show(bad)} must be present with the enum leg absent, or forbidding it proves nothing` +
        dump("no-hook", split.bare.shape, "LodBand"),
    );
    assert.equal(
      lines.some((l) => l.includes(bad)),
      false,
      `${show(bad)} is a raw variant signature. A caller reaches a variant as \`LodBand.CONTINENTAL\`, never by ` +
        `that spelling${dump("hooked", shape, "LodBand")}`,
    );
  }
});

wtest("C0-1: both data variants AND the method's own rendered line are in one member list", async () => {
  const { shape } = await pyEnumShape(WALK.pyShapeHooks);
  assert.ok(shape.types.has("LodBand"), `CONTROL - the root must resolve at all${dump("hooked", shape, "LodBand")}`);
  const lines = methodsOf(shape, "LodBand");

  // The variants, spelled the way the hook itself spells them.
  for (const name of ["CONTINENTAL", "REGIONAL"]) {
    const spelled = pySpells({ name, kind: "field" });
    assert.ok(
      typeof spelled === "string",
      `CONTROL - pyShapeHooks.enumMemberLine must speak for ${show(name)} on a \`class LodBand(IntEnum):\` ` +
        `source, or this row has no subject. It answered ${show(spelled)}`,
    );
    assert.ok(
      lines.includes(spelled),
      `the variant line ${show(spelled)} is missing from the member list${dump("hooked", shape, "LodBand")}`,
    );
  }

  // And the method, with the signature the transport gave it, unchanged.
  const kept = lines.filter((l) => l.includes(DESCRIBE_SIG));
  assert.ok(
    kept.length > 0,
    `\`describe\` was deleted from the prompt by the act of spelling the variants. The transport supplied ` +
      `${show(DESCRIBE_SIG)} and no rendered line carries it. This is the defect C0-1 states: the variant ` +
      `spelling REPLACES the whole rendered list instead of merging into it.${dump("hooked", shape, "LodBand")}`,
  );
});

wtest("C0-1: no raw variant signature and no bare variant name leak in, on the SIGNED fixture", async () => {
  // RE-CUT. This row used to run on the signature-less fixture, where the
  // forbidden strings are absent no matter what the walk does, because nothing
  // ever supplied them. It was green with the enum leg removed entirely. It now
  // runs where the transport hands the variants their signatures, and it proves
  // itself in place: the leg-absent run must CONTAIN each forbidden string, and
  // the hooked run must not. A row like that fails the moment the enum leg stops
  // firing, which is what a detector has to do.
  const { shape } = await pyEnumShape(WALK.pyShapeHooks, PY_SIGNED_ENUM_MEMBERS);
  const lines = methodsOf(shape, "LodBand");
  const bare = await pyEnumShape(withoutEnumLeg(WALK.pyShapeHooks), PY_SIGNED_ENUM_MEMBERS);
  const bareLines = methodsOf(bare.shape, "LodBand");

  for (const bad of [CONTINENTAL_SIG, REGIONAL_SIG]) {
    assert.ok(
      bareLines.some((l) => l.includes(bad)),
      `CONTROL - the transport supplied ${show(bad)} and the leg-absent walk must render it. If it does not, ` +
        `this row is forbidding a string the fixture never produced${dump("no-hook", bare.shape, "LodBand")}`,
    );
    assert.equal(
      lines.some((l) => l.includes(bad)),
      false,
      `${show(bad)} is a raw variant signature. A caller reaches a variant as \`LodBand.CONTINENTAL\`, never ` +
        `by that spelling${dump("hooked", shape, "LodBand")}`,
    );
  }
  for (const name of ["CONTINENTAL", "REGIONAL"]) {
    assert.equal(
      lines.includes(name),
      false,
      `the bare name ${show(name)} is on its own line. The variant spelling is what makes it reachable; the ` +
        `bare name is the thing the spelling exists to replace${dump("hooked", shape, "LodBand")}`,
    );
  }
});

// ===========================================================================
// C0-2. The spelling is a merge, not a replacement, and it never drops a line.
//
// Bullets 1, 2 and 4 run on the enum fixture and are EXPECTED RED. Bullet 3 (a
// hook that spells nothing) is a TRIPWIRE and was green when written.
// ===========================================================================

wtest("C0-2 (1): every member the hook spells contributes its spelled line", async () => {
  const { shape } = await pyEnumShape(WALK.pyShapeHooks);
  const lines = methodsOf(shape, "LodBand");
  const spoken = PY_ENUM_MEMBERS.map((m) => ({ m, line: pySpells(m) })).filter((x) => typeof x.line === "string");
  assert.ok(
    spoken.length > 0,
    `CONTROL - the hook must speak for at least one member of this fixture, or the row is vacuous. Answers: ` +
      show(PY_ENUM_MEMBERS.map((m) => [m.name, pySpells(m)])),
  );
  const missing = spoken.filter((x) => !lines.includes(x.line)).map((x) => x.line);
  assert.deepEqual(
    missing,
    [],
    `the hook spells these and the walk did not emit them${dump("hooked", shape, "LodBand")}`,
  );
});

// RE-CUT. The old form of this row required EVERY leg-absent line to survive,
// which is a stronger property than bullet 2 states and is false on the signed
// shape: `CONTINENTAL: Literal[0]` renders with the leg absent, and C0-1 forbids
// it once the leg fires. Bullet 2 covers the members the hook does NOT spell,
// and `pySplitBare` asks the hook which those are.
//
// Cut once per transport shape, as two rows rather than one loop, so each shape
// reports its own verdict instead of the first failure hiding the second.
const c0_2_survivors = (label, members, spellingIsRequired) =>
  wtest(`C0-2 (2) [${label}]: the members the hook does NOT spell keep the exact lines they had with the leg absent`, async () => {
    const split = await pySplitBare(members);
    const hooked = await pyEnumShape(WALK.pyShapeHooks, members);
    const after = methodsOf(hooked.shape, "LodBand");
    const answers = show(members.map((m) => [m.name, pySpells(m)]));

    // ANTI-VACUITY. The hook must speak for something and must NOT speak for
    // something, and the members it does not speak for must render with the leg
    // absent. Without all three, "the same text survives" is a claim about an
    // empty set. The first of the three is a contract demand rather than a
    // fixture convenience on the signed shape: C0-1 names `LodBand.CONTINENTAL`
    // on exactly this fixture, so a hook that stays silent here is already
    // failing C0-1 and this row says so rather than passing vacuously.
    assert.ok(
      split.spoken.length > 0,
      spellingIsRequired
        ? `the hook speaks for no member of the SIGNED fixture, so nothing gets spelled and C0-1's ` +
          `\`LodBand.CONTINENTAL\` cannot appear. Answers: ${answers}`
        : `CONTROL - the hook must speak for at least one member, or the split has nothing to remove. ` +
          `Answers: ${answers}`,
    );
    assert.ok(
      split.unspoken.length > 0,
      `CONTROL - the hook must NOT speak for at least one member, or this row has no subject. Answers: ${answers}`,
    );
    assert.ok(
      split.survivors.length > 0,
      `CONTROL - with \`enumMemberLine\` removed the walk must still render the members the hook does not spell. ` +
        `It rendered nothing for them${dump("no-hook", split.bare.shape, "LodBand")}`,
    );
    assert.ok(
      split.survivors.some((l) => l.includes(DESCRIBE_SIG)),
      `CONTROL - and \`describe\`, which the transport handed a signature, must be among them` +
        dump("no-hook", split.bare.shape, "LodBand"),
    );

    const lost = split.survivors.filter((l) => !after.includes(l));
    assert.deepEqual(
      lost,
      [],
      `these lines belong to members the hook does not spell, they rendered with the enum leg absent, and they ` +
        `do not survive it firing. "Same text, byte for byte" means the leg may ADD; for a member it does not ` +
        `speak for it may never rewrite or remove.` +
        `\n  [no-hook] all members: ${show(split.full)}` +
        `\n  [no-hook] spoken-for members only: ${show(split.spokenOnly)}` +
        `\n  [no-hook] so the lines bullet 2 covers: ${show(split.survivors)}` +
        `\n  [hooked] ${show(after)}`,
    );
  });

// The shape the product actually has.
c0_2_survivors("signed variants", PY_SIGNED_ENUM_MEMBERS, true);
// The degenerate shape, kept so the re-cut does not trade the old coverage away.
// Here the split is a no-op: a signature-less variant renders nothing with the
// leg absent, so there is nothing to subtract and every leg-absent line is a
// line bullet 2 covers.
c0_2_survivors("signature-less variants", PY_ENUM_MEMBERS, false);

wtest("C0-2 (3): a hook that spells NOTHING leaves the member list byte-identical, in both forms", async () => {
  // TRIPWIRE, green when written. Two forms, because a merge could be written so
  // that the presence of the hook alone changes the path even when it answers
  // undefined to every member.
  const absent = await pyEnumShape(withoutEnumLeg(WALK.pyShapeHooks));
  const silent = await pyEnumShape(spellsNothing(WALK.pyShapeHooks));
  const a = methodsOf(absent.shape, "LodBand");
  const s = methodsOf(silent.shape, "LodBand");
  assert.ok(a.length > 0, `CONTROL - the no-hook rendering must not be empty${dump("absent", absent.shape, "LodBand")}`);
  assert.deepEqual(
    s,
    a,
    `a hook whose \`enumMemberLine\` answers undefined for every member must be indistinguishable from no hook ` +
      `at all` + dump("absent", absent.shape, "LodBand") + dump("silent", silent.shape, "LodBand"),
  );
});

wtest("C0-2 (3): a NON-enum Python class is byte-identical with the real hook and with none", async () => {
  // TRIPWIRE, green when written. `StripeSummary` names no Enum base, so the
  // hook recognises none of its members and the merge must change nothing. This
  // is the bullet's "every non-enum type in every language", in the language
  // whose hook reads the declaring source.
  const members = {
    StripeSummary: [
      { name: "aggregate", kind: "field" },
      { name: "total", kind: "method", signature: "total(self) -> int" },
    ],
  };
  const hooked = await pyShape("StripeSummary", members, WALK.pyShapeHooks);
  const bare = await pyShape("StripeSummary", members, withoutEnumLeg(WALK.pyShapeHooks));
  const h = methodsOf(hooked.shape, "StripeSummary");
  const b = methodsOf(bare.shape, "StripeSummary");
  assert.ok(
    b.length > 0,
    `CONTROL - the plain class must render something with the leg absent${dump("no-hook", bare.shape, "StripeSummary")}`,
  );
  assert.deepEqual(
    h,
    b,
    `the hook recognises nothing here, so the merge must change nothing` +
      dump("no-hook", bare.shape, "StripeSummary") +
      dump("hooked", hooked.shape, "StripeSummary"),
  );
  assert.equal(
    h.some((l) => l.startsWith("StripeSummary.")),
    false,
    `and no member may be spelled through its type: \`StripeSummary\` declares no Enum base${show(h)}`,
  );
});

wtest("C0-2 (4): the rendered line count never goes DOWN when the enum leg fires", async () => {
  // Measured on the METHOD-HEAVY fixture. See PY_METHOD_HEAVY: on a type with as
  // many variants as callables a replacement can still leave the count level or
  // higher, so a count row bound there reports green while members are being
  // destroyed. One variant against two callables is the shape that makes the
  // count itself the witness.
  const hooked = await pyEnumShape(WALK.pyShapeHooks, PY_METHOD_HEAVY);
  const bare = await pyEnumShape(withoutEnumLeg(WALK.pyShapeHooks), PY_METHOD_HEAVY);
  const after = methodsOf(hooked.shape, "LodBand").length;
  const before = methodsOf(bare.shape, "LodBand").length;
  assert.ok(
    before >= 2,
    `CONTROL - the leg-absent rendering must carry both callables, or the comparison has no room to go down` +
      dump("no-hook", bare.shape, "LodBand"),
  );
  assert.ok(
    after >= before,
    `the leg fired and the list got SHORTER: ${before} lines without it, ${after} with it. A spelling that ` +
      `costs the developer a member is worse than one that never ran` +
      dump("no-hook", bare.shape, "LodBand") +
      dump("hooked", hooked.shape, "LodBand"),
  );
});

// ===========================================================================
// C0-3. C# is covered by the same gate. Both rows are TRIPWIRES and were green
// when written: the point of the section is that the shared fix did not move C#.
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
  /*  8 */ "public class Widget",
  /*  9 */ "{",
  /* 10 */ "    public int Width { get; }",
  /* 11 */ "    public void Resize(int width, int height) { }",
  /* 12 */ "}",
];
const CS_TEXT = `${CS_LINES.join("\n")}\n`;

function csFixture(members) {
  return walkFixture({
    files: {
      [CS_URI]: CS_TEXT,
      [CS_CONSUMER]: "void Paint(LodBand band, Widget widget) { }\n",
    },
    // Roslyn's hover form, as the contract quotes it.
    hovers: { LodBand: "enum Atlas.LodBand", Widget: "class Atlas.Widget" },
    defs: {
      LodBand: { uri: CS_URI, line: 2, character: CS_LINES[2].indexOf("LodBand") },
      Widget: { uri: CS_URI, line: 8, character: CS_LINES[8].indexOf("Widget") },
    },
    members,
  });
}

const csShape = async (rootName, members, hooks) => {
  const f = csFixture(members);
  const shape = await WALK.resolveCrossFileShape(
    f.extractor,
    f.rootAt(CS_CONSUMER, rootName),
    BOUND,
    f.openFile,
    hooks,
    rootName,
  );
  return { f, shape };
};

wtest("C0-3: a Roslyn enum still renders LodBand.<variant> per variant, and nothing else appears", async () => {
  const members = {
    LodBand: [
      { name: "CONTINENTAL", kind: "field" },
      { name: "REGIONAL", kind: "field" },
    ],
  };
  const { shape } = await csShape("LodBand", members, WALK.csShapeHooks);
  assert.ok(shape.types.has("LodBand"), `CONTROL - the root must resolve${dump("hooked", shape, "LodBand")}`);
  const lines = methodsOf(shape, "LodBand");
  // The contract's own worked text, quoted from the contract.
  for (const want of ["LodBand.CONTINENTAL", "LodBand.REGIONAL"]) {
    assert.ok(lines.includes(want), `${show(want)} is missing${dump("hooked", shape, "LodBand")}`);
  }
  assert.equal(
    lines.length,
    2,
    `a C# enum declares no methods, so exactly the two variant lines are expected and nothing else` +
      dump("hooked", shape, "LodBand"),
  );
});

wtest("C0-3: a C# CLASS renders its member lines and grows no Widget.<member> spelling", async () => {
  const members = {
    Widget: [
      { name: "Width", kind: "field", signature: "int Width { get; }" },
      { name: "Resize", kind: "method", signature: "void Resize(int width, int height)" },
    ],
  };
  const hooked = await csShape("Widget", members, WALK.csShapeHooks);
  const bare = await csShape("Widget", members, withoutEnumLeg(WALK.csShapeHooks));
  const h = methodsOf(hooked.shape, "Widget");
  const b = methodsOf(bare.shape, "Widget");
  assert.ok(b.length > 0, `CONTROL - the class must render something with the leg absent${dump("no-hook", bare.shape, "Widget")}`);
  for (const sig of ["int Width { get; }", "void Resize(int width, int height)"]) {
    assert.ok(
      h.some((l) => l.includes(sig)),
      `the member line for ${show(sig)} must be rendered${dump("hooked", hooked.shape, "Widget")}`,
    );
  }
  assert.equal(
    h.some((l) => l.startsWith("Widget.")),
    false,
    `\`class Atlas.Widget\` is not an enum, so the hook recognises nothing and no member may be spelled ` +
      `through its type${dump("hooked", hooked.shape, "Widget")}`,
  );
  assert.deepEqual(
    h,
    b,
    `the hook recognises nothing here, so the merge must change nothing` +
      dump("no-hook", bare.shape, "Widget") +
      dump("hooked", hooked.shape, "Widget"),
  );
});

// ===========================================================================
// C0-4. Order is stable and stated: spelled variant lines first in member order,
// surviving rendered lines after, in member order.
//
// EXPECTED RED. The member order in this fixture INTERLEAVES the method between
// the two variants, so "variants first" and "member order" cannot both be
// satisfied by an accident of the input.
// ===========================================================================

// Signed, like every other enum fixture that can be: the survivors are worked
// out by the same split C0-2 (2) uses, so the raw variant lines are not mistaken
// for lines that must be placed after the spelling.
const PY_INTERLEAVED = [
  { name: "REGIONAL", kind: "field", signature: REGIONAL_SIG },
  { name: "describe", kind: "method", signature: DESCRIBE_SIG },
  { name: "CONTINENTAL", kind: "field", signature: CONTINENTAL_SIG },
];

wtest("C0-4: the spelled lines come first in member order, the survivors follow in member order", async () => {
  const { shape } = await pyEnumShape(WALK.pyShapeHooks, PY_INTERLEAVED);
  const lines = methodsOf(shape, "LodBand");

  // The spelled lines, in member order, in the contract's own worked spelling
  // (`LodBand.CONTINENTAL`, quoted from C0-1 and C0-3). Bound to the contract
  // text rather than to the hook's answer for the same reason C0-1's signed row
  // is: a hook that stays silent on a signed variant must fail this row, not
  // excuse it.
  const spelled = PY_INTERLEAVED.filter((m) => m.kind === "field").map((m) => `LodBand.${m.name}`);
  assert.deepEqual(spelled, ["LodBand.REGIONAL", "LodBand.CONTINENTAL"], "CONTROL - the fixture's own member order");
  // Cross-check: where the hook does speak, it must agree with that text, so
  // this row and the hook-derived rows cannot drift apart silently.
  for (const m of PY_INTERLEAVED.filter((x) => x.kind === "field")) {
    const answer = pySpells(m);
    if (typeof answer === "string") {
      assert.equal(
        answer,
        `LodBand.${m.name}`,
        `the hook spells ${show(m.name)} as ${show(answer)}, the contract writes \`LodBand.${m.name}\``,
      );
    }
  }

  const split = await pySplitBare(PY_INTERLEAVED);
  assert.ok(
    split.survivors.length > 0,
    `CONTROL - there must be a surviving line to place after the spelled ones` +
      dump("no-hook", split.bare.shape, "LodBand"),
  );

  assert.deepEqual(
    lines,
    [...spelled, ...split.survivors],
    `the stated order is: every spelled variant line, in member order, then every surviving rendered line, in ` +
      `member order. Member order here is ${show(PY_INTERLEAVED.map((m) => m.name))}` +
      `\n  [no-hook] all members: ${show(split.full)}` +
      `\n  [no-hook] spoken-for members only: ${show(split.spokenOnly)}` +
      `\n  [no-hook] so the survivors: ${show(split.survivors)}` +
      dump("hooked", shape, "LodBand"),
  );
});
