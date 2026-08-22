// Blind oracle: session-v33 phase 4, THE SURFACES. Written from the phase
// contract ALONE (section "What the human sees" in full: the pure-function
// seam, "The panel", "The toast", "The generation"), cross-read against the
// goal for the same section and for "The last call, ruled 2026-07-28". src/**
// was never read, not once: the candidate module paths below come from a
// directory LISTING and esbuild resolves them at bundle time, so nothing in
// this file was informed by an implementation.
//
// Under test, the two pure functions the contract puts in core precisely so the
// panel's decisions are testable without an extension host:
//
//   blockRowShape(entry): { icon: "file" | "error"; color?: string;
//                           description: string; reason?: string }
//   lostToastMessage(entries): string
//
// WHERE THE LINE IS DRAWN, deliberately, between shape and copy.
//
// PINNED EXACTLY, because the contract states them as tokens rather than as
// prose, and a machine on the other side of the seam consumes them: the icon
// names `"file"` and `"error"`, the color `"list.errorForeground"`, and the
// description format `L3-L8` / `L3-L6 (lost)`.
//
// PINNED BY SHAPE ONLY, never by wording: the three lost `reason` sentences and
// every toast sentence. This file asserts that the three reasons EXIST, DIFFER
// from each other and read as sentences rather than as the enum; that a toast
// names every block it took, in the order given; and that n=1 and n=3 are
// different sentences with agreeing grammar. It never asserts what any of those
// sentences SAY. The wording is the human's to rewrite in a UX pass, and an
// oracle that pinned it would go red for a comma and get edited to pass, which
// is how a suite stops being evidence.
//
// Expected RED until phase 4 lands: on main no core module exports either
// function, so the bundle guard is the single informative failure and every
// other row skips. This file was written BEFORE the implementation existed, on
// purpose: the phase-2 oracle arrived green and missed six defects that
// adversarial review then found. A green run here on arrival means the
// sequencing broke and these rows are weak evidence, not strong.
//
// NOT covered here, because a headless pure-function seam cannot express it:
// that the panel actually builds `ThemeIcon(icon, color)` from these answers;
// that the toast carries `Remove` and `Show` actions and that `Remove` clears
// exactly those blocks; that ONE toast fires per change EVENT (the store's
// `report.lost` is the phase-1 oracle's row, and the firing itself is an
// extension-host behaviour); the tooltip PREVIEW of last-known text and its
// cap; in-editor decorations skipping lost blocks; the generate-time warning
// and the `[ctx] lost id=b3 reason=crossed` channel line. Those need the vscode
// layer and belong to a live tier row.
//
// Run: SKIP_LIVE=1 node --test test/blind-v33-p4-surfaces.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

// ---- bundle: one informative failure if an export is missing, rest skip ----
//
// CONTRACT GAP: the contract says these two functions "are pure functions in
// core" and never names the MODULE. The call made here: bundle by export name,
// not by a guessed filename. Every .ts under src/core is a candidate, the
// context-and-panel-shaped names first, and the first module that exports both
// functions wins. Filenames come from a directory listing, not from reading any
// source. Only `src/core` is swept: the contract is explicit that these live in
// core and that "the vscode layer turns their answers into pixels and nothing
// else", so a `blockRowShape` reachable only from `src/vscode` is itself the
// contract break and this guard should say so by failing.

const CORE_DIR = path.join(__dirname, "..", "src", "core");
const EXPORTS = ["blockRowShape", "lostToastMessage"];

function candidateModules() {
  let names = [];
  try {
    names = fs
      .readdirSync(CORE_DIR)
      .filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts"))
      .map((n) => n.slice(0, -3));
  } catch {
    return [];
  }
  const likely = (n) => /context|block|panel|row|toast|surface/i.test(n);
  return [...names.filter(likely).sort(), ...names.filter((n) => !likely(n)).sort()];
}

let mod = null;
let bundleError = null;
let resolvedFrom = null;
const cleanups = [];
{
  const candidates = candidateModules();
  const attempts = [];
  // esbuild writes its own formatted errors to stderr at build time, and a
  // candidate sweep produces one block per module that does not export these.
  // Left alone, dozens of expected "no matching export" blocks bury the one
  // assertion message that says what is actually wrong. Silenced for the sweep
  // only; every likely-named failure is quoted into the guard below.
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    for (let i = 0; i < candidates.length; i++) {
      const name = candidates[i];
      const tag = `blind-v33-p4-surfaces-${i}`;
      try {
        const built = bundleCore(
          tag,
          `export { ${EXPORTS.join(", ")} } from "../src/core/${name}";\n`
        );
        cleanups.push(built.cleanup);
        const missing = EXPORTS.filter((e) => typeof built.mod[e] !== "function");
        if (missing.length > 0) {
          throw new Error(`module bundled but ${missing.join(" and ")} is not a function`);
        }
        mod = built.mod;
        resolvedFrom = `src/core/${name}.ts`;
        break;
      } catch (err) {
        // esbuild leaves the entry/outfile behind on a failed build.
        cleanups.push(() => {
          fs.rmSync(path.join(__dirname, `.${tag}.entry.ts`), { force: true });
          fs.rmSync(path.join(__dirname, `.${tag}.bundle.cjs`), { force: true });
        });
        // Only the likely candidates are worth quoting; the rest fail with a
        // boring "no matching export" and would bury the real reason.
        if (/context|block|panel|row|toast|surface/i.test(name)) {
          attempts.push(`  src/core/${name}.ts: ${String(err.message).split("\n")[0]}`);
        }
      }
    }
  } finally {
    process.stderr.write = realWrite;
  }
  if (!mod) {
    bundleError = new Error(
      [
        "no module under src/core exports both `blockRowShape(entry)` and `lostToastMessage(entries)`.",
        'The contract puts both in core: "The DECISIONS below are pure functions in core, so they are',
        'testable without an extension host."',
        attempts.length > 0 ? "Context-named candidates and why each failed:" : "",
        ...attempts,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}
test.after(() => cleanups.forEach((c) => c()));

test('bundle: src/core exports blockRowShape and lostToastMessage [contract: "What the human sees"]', () => {
  if (bundleError) {
    assert.fail(
      `cannot bundle the phase-4 contract surface, so every other row in this file skipped:\n${bundleError.message}`
    );
  }
});

const skip = bundleError ? "core bundle failed; see the bundle test above for the reason" : false;
const t = (name, fn) => test(name, { skip }, fn);

const blockRowShape = bundleError ? null : mod.blockRowShape;
const lostToastMessage = bundleError ? null : mod.lostToastMessage;

// ---- fixtures --------------------------------------------------------------
//
// `ContextBlockEntry` exactly as the contract defines it: five keys on a
// healthy entry, with `lapsed` and `lost` ABSENT rather than present-and-false.
// `mk` therefore takes its optional keys as an explicit overlay so an absent
// key is really absent.

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

let nextId = 0;
function mk(over = {}) {
  nextId += 1;
  const entry = {
    id: `b${nextId}`,
    uri: "file:///w/alpha.ts",
    range: { startLine: 3, endLine: 8 },
    text: "line three\nline four",
    addedAtVersion: 7,
    ...over,
  };
  entry.range = { ...entry.range };
  return entry;
}

const rangeOf = (e) => `L${e.range.startLine}-L${e.range.endLine}`;

// The uris and ranges below are chosen so no block's name or line numbers can
// appear inside another's by accident, which is what makes the substring checks
// in the toast rows honest.
const basename = (uri) => uri.slice(uri.lastIndexOf("/") + 1);

// A toast may render a range as `L3-L8`, `3-8`, or `lines 3-8`. All three carry
// the same two numbers around one dash, so the check normalises the `L` away
// rather than pinning one rendering. Pinning `L3-L8` here would be pinning
// copy, which this file does not do outside the panel description.
const dropLinePrefix = (s) => s.replace(/\bL(?=\d)/g, "");
const rangeToken = (e) => `${e.range.startLine}-${e.range.endLine}`;

const describeShape = (shape) => JSON.stringify(shape);

// ============================================================================
// blockRowShape: the healthy row
// ============================================================================

t("a healthy block renders as a plain file row carrying no warning of any kind", () => {
  // The contract is emphatic about the ABSENCE here, and the goal says why:
  // "Today's flag fires constantly and trains the human to ignore it." So every
  // row below pins what must NOT be there as hard as what must.
  //
  // RULING (CONTRACT AMBIGUITY 1): a `lapsed` entry is included as healthy. The
  // contract's vocabulary says lapsed is "Not yet lost", the icon union has no
  // third member, and the spec sentence reads `"file"` and no color for
  // anything that is not lost. A lapsed block that renders differently would be
  // a warning on a block that is still fine, which is the exact noise this
  // session removes. If phase 4 disagrees, this row is the conversation.
  const ROWS = [
    { name: "a freshly added block", entry: mk() },
    { name: "the same block at version 0", entry: mk({ addedAtVersion: 0 }) },
    {
      name: "a block whose document has been edited hundreds of times",
      entry: mk({ addedAtVersion: 4211 }),
    },
    { name: "a single-line block", entry: mk({ range: { startLine: 4, endLine: 4 } }) },
    {
      name: "a block starting at line 1",
      entry: mk({ range: { startLine: 1, endLine: 2 } }),
    },
    {
      name: "a block whose cached text is stale by many lines: the description follows the RANGE",
      entry: mk({ range: { startLine: 41, endLine: 52 }, text: "one line only" }),
    },
    { name: "a block whose last known text is empty", entry: mk({ text: "" }) },
    {
      name: "a LAPSED but not lost block, whose document merely closed (see RULING above)",
      entry: mk({ lapsed: true }),
    },
  ];

  for (const row of ROWS) {
    const where = `row: ${row.name}`;
    const shape = blockRowShape(row.entry);

    assert.strictEqual(
      typeof shape,
      "object",
      `${where} -> blockRowShape must answer an object, got ${typeof shape}`
    );
    assert.strictEqual(
      shape.icon,
      "file",
      `${where} -> a healthy block takes the file icon, got ${describeShape(shape)}`
    );
    assert.ok(
      !hasOwn(shape, "color") || shape.color === undefined,
      `${where} -> a healthy block carries NO color, got ${describeShape(shape)}`
    );
    assert.strictEqual(
      shape.description,
      rangeOf(row.entry),
      `${where} -> the description is the current line range and nothing else, got ${describeShape(shape)}`
    );
    assert.ok(
      !hasOwn(shape, "reason") || shape.reason === undefined,
      `${where} -> \`reason\` is absent when the block is healthy, got ${describeShape(shape)}`
    );
  }
});

t("there is no stale shape left: no state short of lost produces a warning icon, a warning color, or the word stale", () => {
  // Structurally a different claim from the row above, which pins the positive
  // shape of named cases. This one sweeps the whole state space a healthy entry
  // can occupy and pins the ABSENCE of the v32 rendering, which was
  // ThemeIcon("warning", "list.warningForeground") with a "(stale)"
  // description. The contract: "There is NO stale shape: a healthy block never
  // carries a warning again."
  for (const addedAtVersion of [0, 1, 7, 4211]) {
    for (const lapsed of [false, true]) {
      for (const range of [{ startLine: 3, endLine: 8 }, { startLine: 41, endLine: 52 }]) {
        const entry = mk(lapsed ? { addedAtVersion, range, lapsed: true } : { addedAtVersion, range });
        const where = `version ${addedAtVersion}, ${lapsed ? "lapsed" : "live"}, L${range.startLine}-L${range.endLine}`;
        const shape = blockRowShape(entry);
        const blob = describeShape(shape);

        assert.notStrictEqual(shape.icon, "warning", `${where} -> a warning icon came back: ${blob}`);
        assert.ok(
          !/warn/i.test(blob),
          `${where} -> nothing in a healthy row may mention a warning, got ${blob}`
        );
        assert.ok(
          !/stale/i.test(blob),
          `${where} -> the stale state does not survive this session, got ${blob}`
        );
        assert.ok(
          !/lost/i.test(shape.description),
          `${where} -> a healthy description never says lost, got ${blob}`
        );
      }
    }
  }
});

// ============================================================================
// blockRowShape: the lost row
// ============================================================================

// One entry per LostReason, at a range the panel must keep showing: a lost
// entry "keeps the range and text it had, so the panel can still say where the
// block used to be".
const LOST_ROWS = [
  { reason: "crossed", name: "an edit crossed the block's boundary" },
  { reason: "deleted", name: "the file was deleted or is unreadable" },
  { reason: "lapsed", name: "tracking lapsed and the lines no longer match" },
];

const lostEntry = (reason) => mk({ range: { startLine: 3, endLine: 6 }, lost: reason });

t("a lost block renders red, says it is lost in its description, and carries a reason", () => {
  for (const row of LOST_ROWS) {
    const where = `row: lost reason ${row.reason} (${row.name})`;
    const entry = lostEntry(row.reason);
    const shape = blockRowShape(entry);

    assert.strictEqual(
      shape.icon,
      "error",
      `${where} -> a lost block takes the ERROR icon, not the file icon and not a warning, got ${describeShape(shape)}`
    );
    assert.strictEqual(
      shape.color,
      "list.errorForeground",
      `${where} -> a lost block is tinted list.errorForeground, got ${describeShape(shape)}`
    );
    assert.strictEqual(
      shape.description,
      "L3-L6 (lost)",
      `${where} -> the description is the range the block still occupies plus " (lost)", got ${describeShape(shape)}`
    );
    assert.strictEqual(
      typeof shape.reason,
      "string",
      `${where} -> a lost block carries a reason sentence for the tooltip, got ${describeShape(shape)}`
    );
    assert.ok(
      shape.reason.trim().length > 0,
      `${where} -> the reason is not blank, got ${describeShape(shape)}`
    );
    // Shape, not copy: a tooltip is prose a human reads, so it may not be the
    // raw enum value echoed back. Several words is the weakest test of that.
    assert.notStrictEqual(
      shape.reason.trim(),
      row.reason,
      `${where} -> the reason is a human sentence, not the LostReason code echoed back, got ${describeShape(shape)}`
    );
    assert.ok(
      /\s/.test(shape.reason.trim()),
      `${where} -> the reason reads as a sentence rather than a single token, got ${describeShape(shape)}`
    );
  }
});

t("the three lost reasons are three DIFFERENT sentences, so a tooltip tells the human which one fired", () => {
  // A tooltip that says the same thing for three different causes tells the
  // human nothing, and the contract lists three distinct sentences for exactly
  // that reason. What each one SAYS is copy and is not pinned here.
  const sentences = new Map();
  for (const row of LOST_ROWS) {
    sentences.set(row.reason, blockRowShape(lostEntry(row.reason)).reason);
  }

  const codes = LOST_ROWS.map((r) => r.reason);
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      assert.notStrictEqual(
        sentences.get(codes[i]),
        sentences.get(codes[j]),
        `the ${codes[i]} and ${codes[j]} tooltips are the same sentence (${JSON.stringify(sentences.get(codes[i]))}), so the tooltip cannot tell a human which one fired`
      );
    }
  }
});

// ============================================================================
// blockRowShape: what the description is a function of
// ============================================================================

t("the row description is a function of the entry's CURRENT range and of nothing else", () => {
  // "Description is the current line range, L3-L8, and it moves as the block
  // does." The block moves on every keystroke above it, so a description
  // computed from the text, the version, or any remembered earlier range is the
  // defect this row exists to catch.
  const moved = [
    { startLine: 3, endLine: 8 },
    { startLine: 4, endLine: 9 },
    { startLine: 4, endLine: 11 },
    { startLine: 120, endLine: 120 },
  ];
  const seen = [];
  for (const range of moved) {
    const shape = blockRowShape(mk({ range }));
    assert.strictEqual(
      shape.description,
      `L${range.startLine}-L${range.endLine}`,
      `after the block moved to L${range.startLine}-L${range.endLine} the description reads ${JSON.stringify(shape.description)}`
    );
    seen.push(shape.description);
  }
  assert.strictEqual(new Set(seen).size, moved.length, "four different ranges must read four different ways");

  // and the converse: everything that is NOT the range leaves it alone.
  const base = blockRowShape(mk({ range: { startLine: 41, endLine: 52 } })).description;
  for (const over of [
    { text: "" },
    { text: "completely different text\nover two lines" },
    { addedAtVersion: 0 },
    { addedAtVersion: 999999 },
    { id: "b98" },
    { uri: "file:///elsewhere/zeta.ts" },
  ]) {
    const shape = blockRowShape(mk({ range: { startLine: 41, endLine: 52 }, ...over }));
    assert.strictEqual(
      shape.description,
      base,
      `changing ${JSON.stringify(over)} changed the description to ${JSON.stringify(shape.description)}; only the range may`
    );
  }
});

// ============================================================================
// lostToastMessage
// ============================================================================

const TOAST_BLOCKS = [
  mk({ uri: "file:///w/alpha.ts", range: { startLine: 3, endLine: 8 }, lost: "crossed" }),
  mk({ uri: "file:///w/beta.ts", range: { startLine: 41, endLine: 52 }, lost: "crossed" }),
  mk({ uri: "file:///w/gamma.rs", range: { startLine: 117, endLine: 119 }, lost: "deleted" }),
  mk({ uri: "file:///w/delta.py", range: { startLine: 204, endLine: 260 }, lost: "lapsed" }),
  mk({ uri: "file:///w/epsilon.go", range: { startLine: 71, endLine: 73 }, lost: "crossed" }),
];

// A block is named "as its tree row reads (file label plus line range)". The
// file label may be a basename, a relative path or a full path, and every one
// of those CONTAINS the basename, so the basename is the pin that survives all
// three. Same idea for the range, normalised for the `L` prefix.
function assertNames(message, entry, where) {
  assert.ok(
    message.includes(basename(entry.uri)),
    `${where} -> the message never names ${basename(entry.uri)}: ${JSON.stringify(message)}`
  );
  assert.ok(
    dropLinePrefix(message).includes(rangeToken(entry)),
    `${where} -> the message never gives ${basename(entry.uri)}'s line range ${rangeOf(entry)}: ${JSON.stringify(message)}`
  );
}

t("one toast is ONE message naming every block the event took, however many that was", () => {
  for (const n of [1, 2, 3, 5]) {
    const entries = TOAST_BLOCKS.slice(0, n);
    const where = `row: ${n} lost block${n === 1 ? "" : "s"}`;
    const message = lostToastMessage(entries);

    assert.strictEqual(
      typeof message,
      "string",
      `${where} -> lostToastMessage answers ONE string however many blocks it took, got ${typeof message} (${JSON.stringify(message)})`
    );
    assert.ok(message.trim().length > 0, `${where} -> the message is not blank`);
    for (const entry of entries) assertNames(message, entry, where);
  }
});

t("the blocks are named in the order they were given, because order in the panel is order everywhere", () => {
  const forward = TOAST_BLOCKS.slice(0, 3);
  const backward = [...forward].reverse();

  for (const [label, entries] of [["list order", forward], ["reversed", backward]]) {
    const message = lostToastMessage(entries);
    const positions = entries.map((e) => message.indexOf(basename(e.uri)));
    for (let i = 1; i < positions.length; i++) {
      assert.ok(
        positions[i] > positions[i - 1],
        `${label}: ${basename(entries[i].uri)} should be named after ${basename(entries[i - 1].uri)}, got ${JSON.stringify(message)}`
      );
    }
  }
});

t("one lost block and three lost blocks produce different sentences", () => {
  const one = lostToastMessage(TOAST_BLOCKS.slice(0, 1));
  const three = lostToastMessage(TOAST_BLOCKS.slice(0, 3));
  assert.notStrictEqual(
    one,
    three,
    `losing one block and losing three produced the identical sentence ${JSON.stringify(one)}; the contract wants them different`
  );
});

t("a single lost block does not read as a list of one", () => {
  // This is the row that catches "1 blocks were lost". Two independent checks,
  // both about grammar and structure rather than about wording:
  //
  // 1. NUMBER AGREEMENT. Wherever the message pairs a digit with one of the
  //    nouns this feature can be about, the noun's plurality must match the
  //    digit. This is the named bug, exactly.
  // 2. THE SINGULAR FRAME IS ITS OWN FRAME. Strip the block names out of the
  //    n=1 message and out of the n=3 message. If what is left is identical,
  //    the singular sentence is the plural sentence with a one-item list poured
  //    into it, which is what "neither is built by string-concatenating a list"
  //    forbids.
  const NOUN = /\b(\d+)\s+(context\s+)?(blocks?|files?|entries|entry|items?|ranges?)\b/gi;

  for (const n of [1, 2, 3]) {
    const entries = TOAST_BLOCKS.slice(0, n);
    const message = lostToastMessage(entries);
    for (const match of message.matchAll(NOUN)) {
      const count = Number(match[1]);
      const noun = match[3].toLowerCase();
      const plural = noun.endsWith("s") || noun === "entries";
      assert.strictEqual(
        plural,
        count !== 1,
        `n=${n}: the message says ${JSON.stringify(match[0])}, which does not agree in number: ${JSON.stringify(message)}`
      );
    }
  }

  const strip = (message, entries) => {
    let out = dropLinePrefix(message);
    for (const entry of entries) {
      out = out.split(basename(entry.uri)).join("");
      out = out.split(rangeToken(entry)).join("");
    }
    return out.replace(/\s+/g, " ").trim();
  };

  const one = TOAST_BLOCKS.slice(0, 1);
  const three = TOAST_BLOCKS.slice(0, 3);
  assert.notStrictEqual(
    strip(lostToastMessage(one), one),
    strip(lostToastMessage(three), three),
    `with the block names removed, the one-block sentence and the three-block sentence are the same frame, so the singular reads as a list of one: ${JSON.stringify(lostToastMessage(one))}`
  );
});

// ============================================================================
// both functions
// ============================================================================

t("both surfaces are pure: neither mutates the entry it is handed", () => {
  // The contract calls them "pure functions in core". The panel repaints on
  // every keystroke, so a surface function that wrote to an entry would be
  // writing to the store from the render path.
  const entries = [mk(), mk({ lapsed: true }), lostEntry("crossed"), lostEntry("deleted")];
  const before = JSON.parse(JSON.stringify(entries));

  for (const entry of entries) blockRowShape(entry);
  lostToastMessage(entries);

  assert.deepStrictEqual(entries, before, "an entry was mutated by a surface function");
});
