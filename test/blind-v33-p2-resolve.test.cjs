// Blind oracle: session-v33 phase 2, the payload path. Written from
// `session-v33/contract.md` ALONE. src/** was never read: esbuild resolves
// `../src/core/contextBlocks` at bundle time only, and every expectation below
// is quoted from a sentence of the contract, named in the test title.
//
// Covered, and nothing else: `ContextBlockStore.resolveForPrompt`'s five-step
// per-entry rule and the order the steps fire in; the re-adoption audit after a
// lapse and its canonical tolerance; the standing ban on content search;
// `markLapsed`, `markDeleted`, `renameUri`; and `toPromptBlocks()` staying what
// it was.
//
// NOT covered here on purpose: `reanchorRange` and `reanchor` (phase 1 has its
// own oracle; phase 1 is used below only as a FIXTURE, to move a range the way
// a real edit would, and never as the thing under assertion), and everything in
// the vscode layer, the panel and the toast (phases 3 and 4).
//
// Expected RED until phase 2 lands: on main the store has no `resolveForPrompt`,
// no `markLapsed`, no `markDeleted` and no `renameUri`, so the bundle guard is
// the single informative failure and the rest skip.
//
// WHAT ACTUALLY HAPPENED, and it weakens this file as evidence, so it is said
// here rather than buried in a report: on the first honest run (2026-07-28) the
// file came back 35 pass / 2 fail, and BOTH failures were bugs in this oracle's
// own fixture, not in the product. Phase 2 was already in the working tree when
// this was written, so these rows were never red-then-green. They pin the
// behaviour and they will catch a regression, but they did not get the chance
// to catch a defect, which is what a blind oracle is for. The two self-inflicted
// reds were a naive `split("\n")` leaving a stray "\r" on the last line of a
// CRLF slice; the store's answer was the correct one and the expectation was
// corrected against the contract's canonical rule, never against the code.
//
// The one sentence that decides every row: "a context block stops being a frozen
// copy of text and becomes a live range over a live document. At generate time
// the model gets what the lines say NOW."
//
// Run: SKIP_LIVE=1 node --test test/blind-v33-p2-resolve.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// ---- bundle: one informative failure if an export is missing, rest skip ----

let mod = null;
let bundleError = null;
let cleanup = () => {};
try {
  const built = bundleCore(
    "blind-v33-p2-resolve",
    `export { ContextBlockStore } from "../src/core/contextBlocks";\n`
  );
  mod = built.mod;
  cleanup = built.cleanup;
  if (typeof mod.ContextBlockStore !== "function") {
    throw new Error("src/core/contextBlocks exports no `ContextBlockStore`");
  }
  // Probe the instance rather than the module, because the phase-2 surface is
  // four methods on the store and a missing one must name itself.
  const probe = new mod.ContextBlockStore();
  const missing = ["resolveForPrompt", "markLapsed", "markDeleted", "toPromptBlocks", "renameUri"].filter(
    (name) => typeof probe[name] !== "function"
  );
  if (missing.length > 0) {
    throw new Error(`ContextBlockStore is missing the phase-2 method(s): ${missing.join(", ")}`);
  }
} catch (err) {
  bundleError = err;
}
test.after(cleanup);

test("bundle: ContextBlockStore carries the phase-2 surface [contract: resolveForPrompt / markLapsed / markDeleted / renameUri / toPromptBlocks]", () => {
  if (bundleError) {
    assert.fail(
      `cannot bundle the phase-2 contract surface, so every other row in this file skipped:\n${bundleError.message}`
    );
  }
});

const skip = bundleError
  ? "core bundle failed; see the bundle test above for the reason"
  : false;
const t = (name, fn) => test(name, { skip }, fn);

const ContextBlockStore = bundleError ? null : mod.ContextBlockStore;

// ---- CALL SHAPES the contract does not state (CONTRACT GAPS) --------------
// The contract gives full signatures for the four phase-2 methods and for
// `ContextBlockEntry`, and none for `add`, `list`, `remove` or subscriber
// registration, though every section below is defined in terms of them. The
// adapters here are the only place this file leans on anything outside the
// contract, and each was settled from the store's own public surface, never by
// reading src/**.
// A1. `store.add({uri, range, text, version})` -> the created entry, and
//     `store.list()` -> the entries in list order.
// A2. `store.remove(id)` -> boolean, per the frozen bar-3 oracle.
// A3. subscriber registration is discovered by probing: the contract says
//     "notifies subscribers" and names no method.

function subscribeTo(store, listener) {
  for (const name of ["subscribe", "onChange", "onDidChange", "onDidChangeBlocks", "onDidChangeEntries"]) {
    if (typeof store[name] === "function") return store[name](listener);
  }
  assert.fail(
    "ContextBlockStore exposes no subscribe-shaped method; the contract says `resolveForPrompt` 'notifies subscribers once if anything changed' but names none (CONTRACT GAP)"
  );
}

// ---- the document fixtures ------------------------------------------------

const URI = "file:///w/live.ts";
const OTHER_URI = "file:///w/other.ts";
const THIRD_URI = "file:///w/third.ts";

// A real TypeScript document. `beta` at 1-based 3..6 is the block in the
// human's example: a function that later grows an `if` block with an
// implementation inside it.
const BASE_LINES = [
  /*  1 */ 'import { foo } from "./foo";',
  /*  2 */ "",
  /*  3 */ "export function beta(x: number): number {",
  /*  4 */ "  const y = foo(x);",
  /*  5 */ "  return y + 1;",
  /*  6 */ "}",
  /*  7 */ "",
  /*  8 */ "export function gamma(): void {",
  /*  9 */ "  beta(2);",
  /* 10 */ "}",
  /* 11 */ "",
  /* 12 */ "export const NAME = 'column-80';",
];

const BETA = { startLine: 3, endLine: 6 };
const GAMMA = { startLine: 8, endLine: 10 };

const docOf = (lines) => lines.join("\n");
// 1-based inclusive, exactly as `ContextBlockEntry.range` is defined.
const sliceOf = (lines, range) => lines.slice(range.startLine - 1, range.endLine).join("\n");
// A document's lines, whichever terminator it uses. Splitting on "\n" alone
// leaves a stray "\r" on the last line of a CRLF slice, which is an artifact of
// the fixture and not a claim about anything.
const linesOf = (text) => text.split(/\r?\n/);

// The canonical rule the contract names for the re-adoption audit: "CRLF
// folded, at most one trailing newline stripped". Reimplemented here so the
// oracle's own expectations are computed from the contract's words rather than
// from whatever the store does.
const canonical = (s) => s.replace(/\r\n/g, "\n").replace(/\n$/, "");

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// A hand-built fake reader. The contract hands over a one-function seam
// precisely so no mocking framework is needed: a Map of uri -> text, a call
// log, and an optional hook for the one row that mutates the store mid-resolve.
function makeReader(initial) {
  const files = new Map(Object.entries(initial || {}));
  const calls = [];
  const reader = {
    files,
    calls,
    onRead: null,
    countFor: (uri) => calls.filter((u) => u === uri).length,
    put(uri, text) {
      files.set(uri, text);
    },
    unlink(uri) {
      files.delete(uri);
    },
    read: async (uri) => {
      calls.push(uri);
      if (reader.onRead) reader.onRead(uri);
      // `undefined` is the contract's "unreadable or gone". Never "".
      return files.has(uri) ? files.get(uri) : undefined;
    },
  };
  return reader;
}

const V1 = 7;
const V2 = 8;

const addBlock = (store, uri, range, lines = BASE_LINES, version = V1) =>
  store.add({ uri, range: { ...range }, text: sliceOf(lines, range), version });

// Shared contract helper: every exclusion row asserts the same three things, so
// a change to what exclusion means is one edit here.
async function assertExcludedWithReason(store, read, entryId, reason, where) {
  const blocks = await store.resolveForPrompt(read);
  const entry = store.list().find((e) => e.id === entryId);
  assert.ok(entry, `${where} -> the entry must survive in the list, only excluded from the prompt`);
  assert.strictEqual(
    entry.lost,
    reason,
    `${where} -> expected lost:${JSON.stringify(reason)}, entry is ${JSON.stringify(entry)}`
  );
  assert.ok(
    !blocks.some((b) => b.uri === entry.uri && b.range.startLine === entry.range.startLine),
    `${where} -> a lost block must be excluded from the projection, got ${JSON.stringify(blocks)}`
  );
  return blocks;
}

// ============================================================================
// resolveForPrompt: the payload path
// ============================================================================

t("THE HUMAN'S CASE: a block over a function that grows an `if` block resolves to the implementation, not to the bytes copied at add time", async () => {
  // Verbatim intent from goal.md, and it is the spec: "it needs to be live -
  // text changes, blocks expanding (eg. add an if {} block and then add
  // implementation inside that block, at model gen time the context injected
  // contains the implementation!)"
  //
  // Phase 1's `reanchor` is used here as a FIXTURE and nothing more: it is how
  // a real edit moves the range, and phase 1's own oracle is what grades it.
  // What is under assertion is only the payload phase 2 produces.
  const store = new ContextBlockStore();
  const block = addBlock(store, URI, BETA);
  const addTimeText = block.text;

  const grown = [...BASE_LINES];
  grown.splice(4, 0, "  if (y > 10) {", "    return y * 2;", "  }");

  // the edit: three lines inserted at 0-based line 4, inside the block.
  store.reanchor(URI, [{ startLine: 4, endLine: 4, endCharacter: 0, newlineCount: 3, endsAtLineStart: true }], V2);

  const reader = makeReader({ [URI]: docOf(grown) });
  const blocks = await store.resolveForPrompt(reader.read);

  assert.strictEqual(blocks.length, 1, "the block is still in the prompt");
  assert.ok(
    blocks[0].text.includes("    return y * 2;"),
    `the model must get the implementation typed inside the if block, got ${JSON.stringify(blocks[0].text)}`
  );
  assert.strictEqual(
    blocks[0].text,
    sliceOf(grown, { startLine: 3, endLine: 9 }),
    "the payload is the whole grown function, exactly as the lines read NOW"
  );
  assert.notStrictEqual(
    blocks[0].text,
    addTimeText,
    "the frozen add-time copy must not be what reaches the model; that is the defect this session exists to remove"
  );
  assert.deepStrictEqual(
    blocks[0].range,
    { startLine: 3, endLine: 9 },
    "and the projection carries the block's current range"
  );
});

t("the text is read at RESOLVE time, not at add time: one unchanged store resolved against two document states answers twice, differently", async () => {
  // The narrower half of the human's ruling, isolated from any range movement:
  // nothing in the store changes between the two resolves, only the document.
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);

  const edited = [...BASE_LINES];
  edited[4] = "  return y + 41;";

  const reader = makeReader({ [URI]: docOf(BASE_LINES) });
  const before = await store.resolveForPrompt(reader.read);
  reader.put(URI, docOf(edited));
  const after = await store.resolveForPrompt(reader.read);

  assert.strictEqual(before[0].text, sliceOf(BASE_LINES, BETA), "the first resolve reads the document as it was");
  assert.strictEqual(after[0].text, sliceOf(edited, BETA), "the second reads it as it is now");
  assert.notStrictEqual(
    after[0].text,
    before[0].text,
    "two generations minutes apart differ because the human typed in between; that is the trade this session makes"
  );
});

t("resolving REFRESHES the entry's cached text, so the panel preview (which cannot await) reads current", async () => {
  // The contract keeps `text` on the entry for exactly two jobs that are not
  // the prompt, and this is one of them: "the panel preview, which must render
  // without an await".
  const store = new ContextBlockStore();
  const block = addBlock(store, URI, BETA);

  const edited = [...BASE_LINES];
  edited[4] = "  return y + 41;";
  const reader = makeReader({ [URI]: docOf(edited) });
  await store.resolveForPrompt(reader.read);

  const entry = store.list().find((e) => e.id === block.id);
  assert.strictEqual(
    entry.text,
    sliceOf(edited, BETA),
    "the entry's last-known slice must be refreshed as a side effect of the resolve"
  );
  assert.strictEqual(
    store.toPromptBlocks()[0].text,
    sliceOf(edited, BETA),
    "so the synchronous last-known projection the panel rides is current too"
  );
});

t("the projection is in list order, and that order is toPromptBlocks() order [contract: 'Order in the panel is order in the prompt']", async () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  addBlock(store, OTHER_URI, { startLine: 1, endLine: 2 });
  addBlock(store, URI, GAMMA);
  addBlock(store, THIRD_URI, { startLine: 12, endLine: 12 });

  const reader = makeReader({
    [URI]: docOf(BASE_LINES),
    [OTHER_URI]: docOf(BASE_LINES),
    [THIRD_URI]: docOf(BASE_LINES),
  });
  const blocks = await store.resolveForPrompt(reader.read);

  assert.deepStrictEqual(
    blocks.map((b) => `${b.uri}#L${b.range.startLine}-L${b.range.endLine}`),
    store.list().map((e) => `${e.uri}#L${e.range.startLine}-L${e.range.endLine}`),
    "the resolver walks the entry list in order"
  );
  assert.deepStrictEqual(
    blocks,
    store.toPromptBlocks(),
    "with every entry healthy and every text just refreshed, the async projection and the sync one agree exactly, shape included"
  );
});

t("BAR 3 under the new payload path: a removed block never reaches the projection", async () => {
  // The frozen product invariant. `test/blind3-bar.test.cjs` proves it over
  // `toPromptBlocks`; this proves the async payload path did not open a hole
  // beside it.
  // Distinct uris, so the read counts below cannot be confused by a store that
  // legitimately memoizes one document across two entries in a single resolve.
  const store = new ContextBlockStore();
  const doomed = addBlock(store, URI, BETA);
  addBlock(store, OTHER_URI, GAMMA);
  const reader = makeReader({ [URI]: docOf(BASE_LINES), [OTHER_URI]: docOf(BASE_LINES) });

  const before = await store.resolveForPrompt(reader.read);
  assert.strictEqual(before.length, 2, "control: both blocks reach the prompt before the removal");

  assert.strictEqual(store.remove(doomed.id), true);
  const after = await store.resolveForPrompt(reader.read);

  assert.deepStrictEqual(after.map((b) => b.uri), [OTHER_URI], "the removed block is gone from the payload");
  assert.ok(
    !after.some((b) => b.text.includes("export function beta")),
    `removed block reached a later prompt: bar 3 broken. got ${JSON.stringify(after)}`
  );
  assert.strictEqual(
    reader.countFor(URI),
    1,
    "and it is not read either: the removed entry's document is touched once, by the resolve that ran before the removal"
  );
});

t("BAR 3, the mechanism: the resolver walks the LIVE list, never one captured before the awaits started", async () => {
  // The contract makes this a mechanism claim and not just an outcome:
  // "`resolveForPrompt` never sees a list captured earlier." The only way to
  // tell a live walk from a snapshot taken at entry is to remove a block WHILE
  // the resolve is suspended on its first await, which the injected reader
  // makes reachable. INTERPRETATION: the contract does not say what a caller
  // mutating the store mid-resolve is owed; this row reads "walks the LIVE
  // list" literally, because that literal reading is the stated reason bar 3
  // survives the move to an async payload.
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  const doomed = addBlock(store, OTHER_URI, GAMMA);

  const reader = makeReader({ [URI]: docOf(BASE_LINES), [OTHER_URI]: docOf(BASE_LINES) });
  reader.onRead = (uri) => {
    if (uri === URI) store.remove(doomed.id);
  };

  const blocks = await store.resolveForPrompt(reader.read);

  assert.deepStrictEqual(
    blocks.map((b) => b.uri),
    [URI],
    `a block removed while the resolve was in flight must not reach the prompt, got ${JSON.stringify(blocks)}`
  );
  assert.strictEqual(reader.countFor(OTHER_URI), 0, "and a removed entry is never read");
});

t("two entries in the same uri both resolve against that one document", async () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  addBlock(store, URI, GAMMA);

  const edited = [...BASE_LINES];
  edited[4] = "  return y + 41;";
  edited[8] = "  beta(99);";
  const reader = makeReader({ [URI]: docOf(edited) });

  const blocks = await store.resolveForPrompt(reader.read);

  assert.strictEqual(blocks[0].text, sliceOf(edited, BETA), "the first block's slice comes from the edited document");
  assert.strictEqual(blocks[1].text, sliceOf(edited, GAMMA), "and so does the second's");
  // INTERPRETATION: the contract says `read(entry.uri)` per entry but does not
  // forbid memoizing a uri within one resolve, so this asserts a range rather
  // than an exact count. The exact per-entry count is pinned on distinct uris
  // in the row below, where no such freedom exists.
  const reads = reader.countFor(URI);
  assert.ok(reads >= 1 && reads <= 2, `expected one read per entry or one memoized read, got ${reads}`);
});

t("read is called once per live entry, and NOT AT ALL for an entry already lost", async () => {
  const store = new ContextBlockStore();
  const alive = addBlock(store, URI, BETA);
  const doomed = addBlock(store, OTHER_URI, GAMMA);

  const reader = makeReader({ [URI]: docOf(BASE_LINES), [OTHER_URI]: docOf(BASE_LINES) });

  // lose the second block through the delete path, which is the cheapest way
  // to reach the `lost` state without leaning on phase 1's classifier.
  store.markDeleted(OTHER_URI);
  reader.calls.length = 0;

  const blocks = await store.resolveForPrompt(reader.read);

  assert.deepStrictEqual(
    reader.calls,
    [URI],
    "step 1 excludes an already-lost entry with NO read attempted, so only the live entry's uri is read"
  );
  assert.deepStrictEqual(blocks.map((b) => b.uri), [URI], "and only the live entry reaches the prompt");
  assert.strictEqual(
    store.list().find((e) => e.id === doomed.id).lost,
    "deleted",
    "the already-lost entry keeps the reason it had; a resolve does not relabel it"
  );
  assert.strictEqual(store.list().find((e) => e.id === alive.id).lost, undefined, "and the live one stays healthy");
});

t("an unreadable file loses the block as `deleted` and never substitutes an empty string", async () => {
  // "Never an empty string in its place, which would silently send an empty
  // section" is the whole reason step 2 exists.
  const store = new ContextBlockStore();
  const gone = addBlock(store, OTHER_URI, GAMMA);
  addBlock(store, URI, BETA);

  const reader = makeReader({ [URI]: docOf(BASE_LINES) }); // OTHER_URI is absent

  const blocks = await assertExcludedWithReason(
    store,
    reader.read,
    gone.id,
    "deleted",
    "read() returned undefined"
  );
  assert.deepStrictEqual(blocks.map((b) => b.uri), [URI], "the surviving block still resolves");
  assert.ok(
    !blocks.some((b) => b.text === ""),
    `an empty section must never be produced in place of a missing file, got ${JSON.stringify(blocks)}`
  );
  assert.strictEqual(
    store.list().find((e) => e.id === gone.id).text,
    sliceOf(BASE_LINES, GAMMA),
    "and its last known text is kept, because the panel still has to show what the block used to be"
  );
});

t("a resolved range with no text in it is not a block: an empty slice is lost as `crossed`", async () => {
  const store = new ContextBlockStore();
  // a range entirely past the end of the document. This is the unambiguous
  // shape of "the slice is empty"; the blank-line shape is the row below.
  const past = store.add({ uri: URI, range: { startLine: 40, endLine: 44 }, text: "gone", version: V1 });
  addBlock(store, URI, BETA);

  const blocks = await assertExcludedWithReason(
    store,
    makeReader({ [URI]: docOf(BASE_LINES) }).read,
    past.id,
    "crossed",
    "the recorded range is past the end of the document"
  );
  assert.strictEqual(blocks.length, 1, "the healthy block alongside it still resolves");
});

t("a range covering only blank lines slices to nothing and is lost as `crossed` too", async () => {
  // INTERPRETATION: the contract says "the slice is empty" and does not say
  // whether that means the empty string or nothing-but-whitespace. This row
  // takes the literal reading, which is the only one the sentence supports: a
  // range over line 2 alone slices to "" under any line-join.
  const store = new ContextBlockStore();
  const blank = store.add({ uri: URI, range: { startLine: 2, endLine: 2 }, text: "", version: V1 });

  await assertExcludedWithReason(
    store,
    makeReader({ [URI]: docOf(BASE_LINES) }).read,
    blank.id,
    "crossed",
    "the range covers one blank line"
  );
});

// ============================================================================
// re-adoption after a lapse
// ============================================================================

// Rows differing only in the bytes the reopened document holds. The audit
// either adopts or loses, and the failure message names the row.
const AUDIT_ROWS = [
  {
    name: "byte-identical text at the recorded range adopts",
    // the document came back exactly as it went away.
    docText: () => docOf(BASE_LINES),
    cachedText: () => sliceOf(BASE_LINES, BETA),
    adopt: true,
  },
  {
    name: "a CRLF-vs-LF difference ALONE must not lose a block, because CRLF is folded",
    docText: () => BASE_LINES.join("\r\n"),
    cachedText: () => sliceOf(BASE_LINES, BETA),
    adopt: true,
  },
  {
    name: "one trailing newline on the cached text is stripped, so it still adopts",
    docText: () => docOf(BASE_LINES),
    cachedText: () => `${sliceOf(BASE_LINES, BETA)}\n`,
    adopt: true,
  },
  {
    name: "CRLF folding and the trailing newline together still adopt",
    docText: () => BASE_LINES.join("\r\n"),
    cachedText: () => `${sliceOf(BASE_LINES, BETA)}\r\n`,
    adopt: true,
  },
  {
    name: "TWO trailing newlines is a real difference, because at most ONE is stripped",
    docText: () => docOf(BASE_LINES),
    cachedText: () => `${sliceOf(BASE_LINES, BETA)}\n\n`,
    adopt: false,
  },
  {
    name: "different bytes at the recorded range lose the block",
    docText: () => {
      const other = [...BASE_LINES];
      other[3] = "  const y = somethingElseEntirely(x);";
      return docOf(other);
    },
    cachedText: () => sliceOf(BASE_LINES, BETA),
    adopt: false,
  },
  {
    name: "the same lines in a different ORDER is a difference, not a match",
    docText: () => {
      const other = [...BASE_LINES];
      const swap = other[3];
      other[3] = other[4];
      other[4] = swap;
      return docOf(other);
    },
    cachedText: () => sliceOf(BASE_LINES, BETA),
    adopt: false,
  },
];

for (const row of AUDIT_ROWS) {
  t(`re-adoption audit: ${row.name} [contract: "compare it to entry.text under the same canonical rule isStale leg 2 uses"]`, async () => {
    const where = `row: ${row.name}`;
    const store = new ContextBlockStore();
    const entry = store.add({ uri: URI, range: { ...BETA }, text: row.cachedText(), version: V1 });
    assert.strictEqual(store.markLapsed(URI), 1, `${where} -> the close marked one live entry`);

    const docText = row.docText();
    const blocks = await store.resolveForPrompt(makeReader({ [URI]: docText }).read);
    const after = store.list()[0];

    if (!row.adopt) {
      assert.strictEqual(
        after.lost,
        "lapsed",
        `${where} -> expected lost:"lapsed", entry is ${JSON.stringify(after)}`
      );
      assert.deepStrictEqual(blocks, [], `${where} -> a failed audit excludes the block`);
      return;
    }

    assert.strictEqual(
      after.lost,
      undefined,
      `${where} -> the audit matched, so the block must survive, entry is ${JSON.stringify(after)}`
    );
    assert.strictEqual(
      hasOwn(after, "lapsed"),
      false,
      `${where} -> an adopted entry is healthy again, and lapsed is ABSENT on a healthy entry, not present-and-false`
    );
    assert.strictEqual(blocks.length, 1, `${where} -> and the adopted block appears in the projection`);
    // INTERPRETATION: the contract does not say whether a refreshed `text`
    // keeps the document's CRLF terminators or folds them, so both sides are
    // compared under the canonical rule and this row does not decide it.
    assert.strictEqual(
      canonical(blocks[0].text),
      canonical(sliceOf(linesOf(docText), BETA)),
      `${where} -> the payload is the live slice, carried on to step 5`
    );
    assert.strictEqual(entry.id, after.id, `${where} -> the entry is repaired in place, not replaced`);
  });
}

t("BANNED, and it must stay banned: a block whose text MOVED in the reopened document is lost, never found at its new home", async () => {
  // "No content SEARCH, in either direction, ever. Re-adoption checks the
  // recorded range and nothing else. A block that moved while nobody was
  // watching is lost, not hunted for."
  const store = new ContextBlockStore();
  const entry = addBlock(store, URI, BETA);
  store.markLapsed(URI);

  // the block's exact four lines now live at 1-based 8..11 instead of 3..6.
  const moved = [
    'import { foo } from "./foo";',
    "",
    "export function gamma(): void {",
    "  beta(2);",
    "}",
    "",
    "",
    ...BASE_LINES.slice(2, 6),
    "",
    "export const NAME = 'column-80';",
  ];
  assert.strictEqual(
    sliceOf(moved, { startLine: 8, endLine: 11 }),
    entry.text,
    "fixture check: the block's text really is present, just somewhere else"
  );

  const blocks = await store.resolveForPrompt(makeReader({ [URI]: docOf(moved) }).read);
  const after = store.list()[0];

  assert.strictEqual(after.lost, "lapsed", "the audit checks the recorded range and nothing else");
  assert.deepStrictEqual(
    after.range,
    { ...BETA },
    "and the range must NOT be re-pointed at the text's new home; that is the search this session bans"
  );
  assert.deepStrictEqual(blocks, [], "nothing reaches the prompt");
});

t("step 2 fires before step 3: a lapsed block in a file that is now unreadable is `deleted`, not `lapsed`", async () => {
  const store = new ContextBlockStore();
  const entry = addBlock(store, URI, BETA);
  store.markLapsed(URI);

  await assertExcludedWithReason(
    store,
    makeReader({}).read,
    entry.id,
    "deleted",
    "lapsed entry, read() returned undefined"
  );
});

t("step 3 fires before step 4: a lapsed block whose recorded range now slices to nothing is `lapsed`, not `crossed`", async () => {
  // The audit runs first, and comparing "" to a four-line function is a
  // difference, so the reason the human is told is that tracking lapsed.
  const store = new ContextBlockStore();
  const entry = store.add({ uri: URI, range: { startLine: 40, endLine: 44 }, text: sliceOf(BASE_LINES, BETA), version: V1 });
  store.markLapsed(URI);

  await assertExcludedWithReason(
    store,
    makeReader({ [URI]: docOf(BASE_LINES) }).read,
    entry.id,
    "lapsed",
    "lapsed entry whose range is past the end of the document"
  );
});

t("step 1 fires before everything: a block that is BOTH lapsed and already lost keeps the reason it had and is never read", async () => {
  const store = new ContextBlockStore();
  const entry = addBlock(store, URI, BETA);
  store.markLapsed(URI);
  store.markDeleted(URI);

  const reader = makeReader({ [URI]: docOf(BASE_LINES) });
  const blocks = await store.resolveForPrompt(reader.read);

  assert.deepStrictEqual(blocks, [], "a lost block is excluded");
  assert.deepStrictEqual(reader.calls, [], "with no read attempted at all");
  assert.strictEqual(store.list().find((e) => e.id === entry.id).lost, "deleted", "and the reason is not rewritten");
});

t("an adopted block is audited once: the next resolve reads it live like any healthy block, even though the text has since changed", async () => {
  // The audit is a re-entry gate, not a permanent freeze. Once adopted, the
  // block is back on live semantics, which is the point of the session.
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  store.markLapsed(URI);

  const reader = makeReader({ [URI]: docOf(BASE_LINES) });
  const first = await store.resolveForPrompt(reader.read);
  assert.strictEqual(first.length, 1, "control: the audit matched and adopted");

  const edited = [...BASE_LINES];
  edited[4] = "  return y + 41;";
  reader.put(URI, docOf(edited));
  const second = await store.resolveForPrompt(reader.read);

  assert.strictEqual(
    second.length,
    1,
    "an adopted block must not be re-audited against its old text; text is SUPPOSED to change now"
  );
  assert.strictEqual(second[0].text, sliceOf(edited, BETA), "and it resolves live");
});

// ============================================================================
// markLapsed
// ============================================================================

t("markLapsed marks every live entry in the uri, counts them, and skips the ones already lost", async () => {
  const store = new ContextBlockStore();
  const a = addBlock(store, URI, BETA);
  const b = addBlock(store, URI, GAMMA);
  const gone = store.add({ uri: URI, range: { startLine: 40, endLine: 41 }, text: "past the end", version: V1 });
  const elsewhere = addBlock(store, OTHER_URI, BETA);

  // lose the third block first, through the resolver rather than markLapsed.
  await store.resolveForPrompt(makeReader({ [URI]: docOf(BASE_LINES), [OTHER_URI]: docOf(BASE_LINES) }).read);
  assert.strictEqual(store.list().find((e) => e.id === gone.id).lost, "crossed", "fixture check: the third entry is lost");

  const marked = store.markLapsed(URI);

  assert.strictEqual(marked, 2, "two live entries in this uri gained lapsed; the lost one is skipped");
  const byId = new Map(store.list().map((e) => [e.id, e]));
  assert.strictEqual(byId.get(a.id).lapsed, true, "the first live entry is lapsed");
  assert.strictEqual(byId.get(b.id).lapsed, true, "and the second");
  assert.strictEqual(hasOwn(byId.get(gone.id), "lapsed"), false, "an already-lost entry is not marked lapsed as well");
  assert.strictEqual(hasOwn(byId.get(elsewhere.id), "lapsed"), false, "and another uri's entry is untouched");
});

t("markLapsed is idempotent: marking twice changes nothing the second time and notifies once", async () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  addBlock(store, URI, GAMMA);
  let notifications = 0;
  subscribeTo(store, () => {
    notifications += 1;
  });

  const first = store.markLapsed(URI);
  const snapshot = JSON.parse(JSON.stringify(store.list()));
  const second = store.markLapsed(URI);

  assert.strictEqual(first, 2, "the first call marks both live entries");
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(store.list())),
    snapshot,
    "the second call changes nothing about the entries"
  );
  assert.strictEqual(notifications, 1, "and it is one notification in total, not one per call");
  // INTERPRETATION: the contract says "Returns how many" and "marking twice
  // changes nothing the second time". A count of 2 on a call that changed
  // nothing and notified nobody would be the return value contradicting the
  // notification, so this reads the count as entries that GAINED lapsed.
  assert.strictEqual(second, 0, "nothing gained lapsed on the second call, so the count is 0 (CONTRACT GAP, named)");
});

t("markLapsed on a uri with no entries marks nothing and is silent", () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  let notifications = 0;
  subscribeTo(store, () => {
    notifications += 1;
  });

  assert.strictEqual(store.markLapsed("file:///w/never-added.ts"), 0, "no entries to mark");
  assert.strictEqual(notifications, 0, "so nobody is notified");
});

// ============================================================================
// markDeleted
// ============================================================================

t("markDeleted loses every live entry in the uri and returns them in list order", async () => {
  const store = new ContextBlockStore();
  const first = addBlock(store, URI, BETA);
  const elsewhere = addBlock(store, OTHER_URI, BETA);
  const second = addBlock(store, URI, GAMMA);

  const reported = store.markDeleted(URI);

  assert.ok(Array.isArray(reported), "markDeleted returns the entries it lost");
  assert.deepStrictEqual(
    reported.map((e) => e.id),
    [first.id, second.id],
    "in list order, and the other uri's entry is not among them"
  );
  for (const entry of reported) {
    assert.strictEqual(entry.lost, "deleted", "the file was deleted, so that is the reason");
  }
  assert.deepStrictEqual(
    store.list().map((e) => e.id),
    [first.id, elsewhere.id, second.id],
    "list position is preserved: the entries are marked in place, not removed"
  );
  assert.strictEqual(store.list()[1].lost, undefined, "the other uri's entry stays healthy");
  assert.strictEqual(
    store.list()[0].text,
    first.text,
    "and a lost entry keeps its last known text, so the panel can still show what it was"
  );
});

t("markDeleted does not re-report an entry that was already lost", async () => {
  const store = new ContextBlockStore();
  const first = addBlock(store, URI, BETA);
  const second = addBlock(store, URI, GAMMA);

  const firstPass = store.markDeleted(URI);
  assert.deepStrictEqual(firstPass.map((e) => e.id), [first.id, second.id], "control: both go on the first pass");

  const secondPass = store.markDeleted(URI);
  assert.deepStrictEqual(secondPass, [], "a second delete event re-reports nobody");
  assert.deepStrictEqual(
    store.list().map((e) => e.lost),
    ["deleted", "deleted"],
    "and the entries keep the reason they already had"
  );
});

t("markDeleted leaves a lapsed entry's reason as `deleted`, because the file is what went away", async () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  store.markLapsed(URI);

  const reported = store.markDeleted(URI);

  assert.strictEqual(reported.length, 1, "a lapsed entry is still live, so it is lost by the delete");
  assert.strictEqual(reported[0].lost, "deleted", "and the reason is the delete that just happened");
});

// ============================================================================
// renameUri
// ============================================================================

t("renameUri moves a block's address and not its health, across all three health states at once", async () => {
  // The renamed uri deliberately holds one LAPSED entry, one LOST entry and
  // one HEALTHY entry, because the contract's claim is about every one of them:
  // "Range, text, id, list position and lost/lapsed state are untouched."
  const store = new ContextBlockStore();
  const willLapse = addBlock(store, URI, BETA);
  const willBeLost = store.add({ uri: URI, range: { startLine: 40, endLine: 41 }, text: "past the end", version: V1 });

  await store.resolveForPrompt(makeReader({ [URI]: docOf(BASE_LINES) }).read);
  assert.strictEqual(store.list()[1].lost, "crossed", "fixture check: the second entry is lost");
  assert.strictEqual(store.markLapsed(URI), 1, "fixture check: only the live entry lapses");

  // added AFTER the lapse, so it is the healthy one.
  const healthy = addBlock(store, URI, GAMMA);
  const untouched = addBlock(store, OTHER_URI, GAMMA);
  const before = JSON.parse(JSON.stringify(store.list()));

  const moved = store.renameUri(URI, THIRD_URI);

  assert.strictEqual(moved, 3, "every entry whose uri was `from` gets `to`, and the count says how many");
  const after = store.list();
  assert.deepStrictEqual(
    after.map((e) => e.uri),
    [THIRD_URI, THIRD_URI, THIRD_URI, OTHER_URI],
    "the three follow the file; the entry in another file does not"
  );
  assert.deepStrictEqual(
    after.map((e) => e.id),
    [willLapse.id, willBeLost.id, healthy.id, untouched.id],
    "ids and list position survive the rename"
  );
  assert.strictEqual(after[0].lapsed, true, "the lapsed entry is still lapsed at its new address");
  assert.strictEqual(after[1].lost, "crossed", "the lost entry is still lost, with the reason it had");
  assert.strictEqual(hasOwn(after[2], "lost"), false, "and the healthy one did not catch anything on the way");
  assert.deepStrictEqual(
    after.map((e) => ({ ...e, uri: null })),
    before.map((e) => ({ ...e, uri: null })),
    "range, text, version and lost/lapsed state are all untouched: a rename moves an address, not a health state"
  );
});

t("renameUri notifies once if anything moved, and not at all if nothing did", () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  addBlock(store, URI, GAMMA);
  let notifications = 0;
  subscribeTo(store, () => {
    notifications += 1;
  });

  assert.strictEqual(store.renameUri("file:///w/never-added.ts", THIRD_URI), 0, "no entry carries that uri");
  assert.strictEqual(notifications, 0, "so the rename is silent");

  assert.strictEqual(store.renameUri(URI, THIRD_URI), 2, "both entries follow the file");
  assert.strictEqual(notifications, 1, "two entries moved in one rename, and that is ONE notification");
});

t("a renamed block resolves against its NEW uri, and the old one is never read again", async () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  store.renameUri(URI, THIRD_URI);

  const reader = makeReader({ [THIRD_URI]: docOf(BASE_LINES) }); // the old uri is gone
  const blocks = await store.resolveForPrompt(reader.read);

  assert.deepStrictEqual(reader.calls, [THIRD_URI], "the resolver asks for the new address");
  assert.strictEqual(blocks.length, 1, "so the block survives the rename instead of being orphaned");
  assert.strictEqual(blocks[0].uri, THIRD_URI, "and the projection carries the new uri");
});

// ============================================================================
// toPromptBlocks() is unchanged
// ============================================================================

t("toPromptBlocks stays synchronous and stays last-known: it never awaits and never re-reads a document", () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  addBlock(store, OTHER_URI, GAMMA);

  const blocks = store.toPromptBlocks();

  assert.ok(Array.isArray(blocks), "a plain array, not a promise");
  assert.strictEqual(typeof blocks.then, "undefined", "toPromptBlocks must not become async");
  assert.deepStrictEqual(
    blocks,
    [
      { uri: URI, range: { ...BETA }, text: sliceOf(BASE_LINES, BETA) },
      { uri: OTHER_URI, range: { ...GAMMA }, text: sliceOf(BASE_LINES, GAMMA) },
    ],
    "same {uri, range, text} projection, in list order, from the last known slice"
  );
});

t("toPromptBlocks projects the WHOLE list, lost entries included, because it is the last-known view and not the payload", async () => {
  // INTERPRETATION, and it is the one place the two projections deliberately
  // disagree: the contract says toPromptBlocks is "the same ... projection of
  // the whole list" and unchanged, while `resolveForPrompt` is the path that
  // excludes lost blocks. Filtering the sync projection would be a change, and
  // "unchanged" is the word the contract uses.
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  addBlock(store, OTHER_URI, GAMMA);
  store.markDeleted(OTHER_URI);

  const sync = store.toPromptBlocks();
  const resolved = await store.resolveForPrompt(makeReader({ [URI]: docOf(BASE_LINES) }).read);

  assert.strictEqual(sync.length, 2, "the sync projection still covers the whole list");
  assert.strictEqual(resolved.length, 1, "while the payload path drops the lost block");
});

// ============================================================================
// notification
// ============================================================================

t("resolveForPrompt notifies once when the resolve changed something, and not at all when it did not", async () => {
  const store = new ContextBlockStore();
  addBlock(store, URI, BETA);
  addBlock(store, URI, GAMMA);
  let notifications = 0;
  subscribeTo(store, () => {
    notifications += 1;
  });

  const reader = makeReader({ [URI]: docOf(BASE_LINES) });

  // INTERPRETATION: the contract says "notifies once if anything changed" and
  // does not enumerate what counts. This reads it as the entries: a resolve
  // that refreshes no cached text, clears no lapse and loses nothing changed
  // nothing, and the panel has no reason to repaint.
  await store.resolveForPrompt(reader.read);
  assert.strictEqual(notifications, 0, "the document matches every cached slice, so nothing changed");

  const edited = [...BASE_LINES];
  edited[4] = "  return y + 41;";
  reader.put(URI, docOf(edited));
  await store.resolveForPrompt(reader.read);
  assert.strictEqual(notifications, 1, "one entry's text was refreshed, and that is ONE notification");

  await store.resolveForPrompt(reader.read);
  assert.strictEqual(notifications, 1, "resolving the same document again changes nothing and is silent");
});

t("a resolve that only loses blocks still notifies once, because those rows have to repaint red", async () => {
  // The isolating case: no text is refreshed by this resolve at all, so a store
  // that only notified on a refresh would still pass the row above.
  const store = new ContextBlockStore();
  addBlock(store, OTHER_URI, BETA);
  addBlock(store, OTHER_URI, GAMMA);
  let notifications = 0;
  subscribeTo(store, () => {
    notifications += 1;
  });

  const blocks = await store.resolveForPrompt(makeReader({}).read); // the file is gone

  assert.deepStrictEqual(blocks, [], "both blocks are lost");
  assert.deepStrictEqual(
    store.list().map((e) => e.lost),
    ["deleted", "deleted"],
    "with the deleted reason",
  );
  assert.strictEqual(notifications, 1, "two losses in one resolve is one notification, not two and not zero");
});
