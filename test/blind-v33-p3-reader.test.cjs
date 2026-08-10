// Blind oracle: session-v33 phase 3, THE READER. Written from
// `session-v33/contract.md` ALONE (section "The reader", plus "Events the
// vscode layer must subscribe to"). src/** was never read, not once: the
// candidate module paths below come from a directory LISTING and esbuild
// resolves them at bundle time, so nothing in this file was informed by an
// implementation.
//
// Under test: `makeBlockReader(deps)`, the two-function seam the contract
// specifies so the reader is unit-testable headless and never imports `vscode`:
//
//   makeBlockReader(deps): (uri: string) => Promise<string | undefined>
//   deps.openDocuments():       readonly { uri: string; getText(): string }[]
//   deps.openTextDocument(uri): Promise<{ getText(): string }>
//
// The bundle below deliberately does NOT alias a vscode stub, unlike
// blind6-command-adapter. That is not an oversight: "never imports vscode" is a
// contract rule, and an unaliased esbuild bundle is the cheapest honest test of
// it. A reader that reaches for `vscode` fails to resolve and the bundle guard
// says so by name.
//
// The fakes are hand-built with call counters, per the contract handing over a
// two-function seam precisely so no mocking framework is needed.
//
// Expected RED until phase 3 lands: on main there is no reader module at all,
// so the bundle guard is the single informative failure and every other row
// skips. This file was written BEFORE the implementation existed, on purpose:
// the phase-2 oracle arrived green and missed six defects that adversarial
// review then found. A green run here on arrival means the sequencing broke.
//
// NOT covered here, because a headless two-function seam cannot express it:
// which vscode API fills each dep (`workspace.textDocuments`,
// `workspace.openTextDocument`), that opening a closed document does not SHOW
// it (only provable in an extension host; the closest headless proxy is the
// "touches nothing beyond the seam" row below), and every store/panel/toast
// behaviour, which belongs to the phase-1, phase-2 and phase-4 oracles.
//
// Run: SKIP_LIVE=1 node --test test/blind-v33-p3-reader.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

// ---- bundle: one informative failure if the export is missing, rest skip ----
//
// CONTRACT GAP: the contract says the reader "ships as `makeBlockReader(deps)`
// in its own module" under `src/vscode/` and never names the FILE. The call
// made here: bundle by export name, not by a guessed filename. Every .ts under
// src/vscode is a candidate, reader-ish names first, and the first one that
// exports `makeBlockReader` wins. Filenames come from a directory listing, not
// from reading any source.

const VSCODE_DIR = path.join(__dirname, "..", "src", "vscode");

function candidateModules() {
  let names = [];
  try {
    names = fs
      .readdirSync(VSCODE_DIR)
      .filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts"))
      .map((n) => n.slice(0, -3));
  } catch {
    return [];
  }
  const readerish = (n) => /read/i.test(n);
  return [...names.filter(readerish).sort(), ...names.filter((n) => !readerish(n)).sort()];
}

let mod = null;
let bundleError = null;
let resolvedFrom = null;
const cleanups = [];
{
  const candidates = candidateModules();
  const attempts = [];
  // esbuild writes its own formatted errors to stderr at build time, and a
  // candidate sweep produces one block per file that does not export the
  // reader. Left alone, a dozen expected "Could not resolve vscode" blocks bury
  // the one assertion message that says what is actually wrong. Silenced for
  // the sweep only; every reader-named failure is quoted into the guard below.
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    for (let i = 0; i < candidates.length; i++) {
      const name = candidates[i];
      const tag = `blind-v33-p3-reader-${i}`;
      try {
        const built = bundleCore(tag, `export { makeBlockReader } from "../src/vscode/${name}";\n`);
        cleanups.push(built.cleanup);
        if (typeof built.mod.makeBlockReader !== "function") {
          throw new Error("module bundled but `makeBlockReader` is not a function");
        }
        mod = built.mod;
        resolvedFrom = `src/vscode/${name}.ts`;
        break;
      } catch (err) {
        // esbuild leaves the entry/outfile behind on a failed build.
        cleanups.push(() => {
          fs.rmSync(path.join(__dirname, `.${tag}.entry.ts`), { force: true });
          fs.rmSync(path.join(__dirname, `.${tag}.bundle.cjs`), { force: true });
        });
        // Only the reader-ish candidates are worth quoting; the rest fail with a
        // boring "no matching export" and would bury the real reason.
        if (/read/i.test(name)) attempts.push(`  src/vscode/${name}.ts: ${String(err.message).split("\n")[0]}`);
      }
    }
  } finally {
    process.stderr.write = realWrite;
  }
  if (!mod) {
    bundleError = new Error(
      [
        "no module under src/vscode exports `makeBlockReader(deps)`.",
        "The contract puts the reader in its own module there, importing NO vscode,",
        "so this bundle carries no vscode stub: a reader that imports vscode fails",
        "to resolve here and that failure is itself the contract break.",
        attempts.length > 0 ? "Reader-named candidates and why each failed:" : "",
        ...attempts,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}
test.after(() => cleanups.forEach((c) => c()));

test("bundle: src/vscode exports `makeBlockReader(deps)` and it imports no vscode [contract: The reader]", () => {
  if (bundleError) {
    assert.fail(`cannot bundle the reader, so every other row in this file skipped:\n${bundleError.message}`);
  }
});

const skip = bundleError ? "reader bundle failed; see the bundle test above for the reason" : false;
const t = (name, fn) => test(name, { skip }, fn);
const makeBlockReader = bundleError ? null : mod.makeBlockReader;

// ---- hand-built fakes with call counters -----------------------------------

// Outcome descriptors for deps.openTextDocument. Named rather than inlined so
// a row reads as the situation it models, not as plumbing.
const resolvesTo = (text) => ({ kind: "resolve", text });
const rejectsWith = (reason) => ({ kind: "reject", reason });
const throwsSync = (reason) => ({ kind: "throwSync", reason });

// Records every property read that is not part of the declared seam. The reader
// is handed exactly two functions; anything else it reaches for (showTextDocument,
// a window, a cache) is a contract break. Violations are RECORDED, never thrown,
// because a throw inside the reader could be swallowed by its own catch and would
// then look like an unrelated `undefined`.
function guarded(target, allowed, violations, label) {
  return new Proxy(target, {
    get(obj, prop, recv) {
      if (typeof prop === "string" && prop !== "then" && !allowed.includes(prop)) {
        violations.push(`${label}.${prop}`);
      }
      return Reflect.get(obj, prop, recv);
    },
  });
}

// config.open:   [{ uri, text }] where text is a string or a () => string
// config.onOpen: (uri) => resolvesTo/rejectsWith/throwsSync; default rejects,
//                so a row asserting "never opened" fails loudly if it was.
function makeDeps(config = {}) {
  const calls = { openDocuments: 0, openTextDocument: [], getTextOpen: [], getTextOpened: [] };
  const violations = [];

  const openDocs = (config.open || []).map((d) =>
    guarded(
      {
        uri: d.uri,
        getText: () => {
          calls.getTextOpen.push(d.uri);
          return typeof d.text === "function" ? d.text() : d.text;
        },
      },
      ["uri", "getText"],
      violations,
      `openDocument(${d.uri})`
    )
  );

  const deps = {
    openDocuments: () => {
      calls.openDocuments++;
      return config.openDocuments ? config.openDocuments() : openDocs;
    },
    openTextDocument: (uri) => {
      calls.openTextDocument.push(uri);
      const outcome = config.onOpen
        ? config.onOpen(uri)
        : rejectsWith(new Error(`fake: openTextDocument(${uri}) was not expected in this row`));
      if (outcome.kind === "throwSync") throw outcome.reason;
      if (outcome.kind === "reject") return Promise.reject(outcome.reason);
      return Promise.resolve(
        guarded(
          {
            getText: () => {
              calls.getTextOpened.push(uri);
              return typeof outcome.text === "function" ? outcome.text() : outcome.text;
            },
          },
          ["getText"],
          violations,
          `openedDocument(${uri})`
        )
      );
    },
  };

  return {
    calls,
    violations,
    deps: guarded(deps, ["openDocuments", "openTextDocument"], violations, "deps"),
  };
}

const URI = "file:///w/src/main.ts";

// ---- the seam's shape -------------------------------------------------------

t("makeBlockReader hands back a one-argument async read and touches no dep until it is called", async () => {
  const { deps, calls } = makeDeps({ open: [{ uri: URI, text: "live" }] });
  const read = makeBlockReader(deps);
  assert.strictEqual(typeof read, "function", `makeBlockReader(deps) (from ${resolvedFrom}) returns the read function`);
  assert.strictEqual(calls.openDocuments, 0, "construction must not snapshot the open-document list");
  assert.strictEqual(calls.openTextDocument.length, 0, "construction must not open anything");

  const pending = read(URI);
  assert.ok(pending && typeof pending.then === "function", "read(uri) returns a Promise");
  assert.strictEqual(await pending, "live");
});

// ---- an OPEN document wins over opening one, matched on the uri STRING ------

t("the open document whose uri STRING matches exactly wins, and nothing else does", async () => {
  // Data-only rows: same structure, different open-list shapes and uri strings.
  // `from` is which source the contract says must answer.
  const rows = [
    { name: "the only open document is the target", open: ["file:///w/a.ts"], target: "file:///w/a.ts", from: "open" },
    {
      name: "the target is the LAST of three open documents",
      open: ["file:///w/a.ts", "file:///w/b.ts", "file:///w/c.ts"],
      target: "file:///w/c.ts",
      from: "open",
    },
    {
      name: "the target is in the MIDDLE, so a naive first-element read fails here",
      open: ["file:///w/a.ts", "file:///w/b.ts", "file:///w/c.ts"],
      target: "file:///w/b.ts",
      from: "open",
    },
    {
      name: "percent-encoded space in the uri, matched byte for byte",
      open: ["file:///w/my%20notes.md"],
      target: "file:///w/my%20notes.md",
      from: "open",
    },
    { name: "an untitled-scheme document is still just a uri string", open: ["untitled:Untitled-1"], target: "untitled:Untitled-1", from: "open" },
    { name: "nothing open at all", open: [], target: "file:///w/a.ts", from: "opened" },
    {
      name: "a different file is open, not the target",
      open: ["file:///w/other.ts"],
      target: "file:///w/a.ts",
      from: "opened",
    },
    {
      name: "same path, different case: exact-string matching says no",
      open: ["file:///w/A.ts"],
      target: "file:///w/a.ts",
      from: "opened",
    },
    {
      name: "same path with a trailing slash: exact-string matching says no",
      open: ["file:///w/a.ts/"],
      target: "file:///w/a.ts",
      from: "opened",
    },
    {
      name: "the decoded form of an encoded open uri: exact-string matching says no",
      open: ["file:///w/my%20notes.md"],
      target: "file:///w/my notes.md",
      from: "opened",
    },
  ];

  for (const row of rows) {
    const { deps, calls } = makeDeps({
      open: row.open.map((uri) => ({ uri, text: `OPEN:${uri}` })),
      onOpen: (uri) => resolvesTo(`OPENED:${uri}`),
    });
    const got = await makeBlockReader(deps)(row.target);

    if (row.from === "open") {
      assert.strictEqual(got, `OPEN:${row.target}`, `row "${row.name}": the OPEN document's text must win`);
      assert.deepStrictEqual(
        calls.openTextDocument,
        [],
        `row "${row.name}": an open document must never be re-opened via openTextDocument`
      );
    } else {
      assert.strictEqual(
        got,
        `OPENED:${row.target}`,
        `row "${row.name}": no open document matches this uri string, so the reader must open it`
      );
      assert.deepStrictEqual(
        calls.openTextDocument,
        [row.target],
        `row "${row.name}": opened exactly once, with the uri string as given`
      );
      assert.deepStrictEqual(calls.getTextOpen, [], `row "${row.name}": no non-matching open document may be read`);
    }
  }
});

t("UNSAVED EDITS COUNT: the open document's getText() is the answer, whatever is on disk", async () => {
  // The case the whole session exists for. The human adds a block over a
  // function, types an `if` block into it, fills the body, and generates. None
  // of that is on disk. The disk text below is what a reader that opens the
  // file instead of asking the open document would return, and it is wrong.
  const onDisk = "fn total() {\n}\n";
  const inEditor = "fn total() {\n    if ready {\n        emit(rows)\n    }\n}\n";
  const { deps, calls } = makeDeps({
    open: [{ uri: URI, text: inEditor }],
    onOpen: () => resolvesTo(onDisk),
  });

  const got = await makeBlockReader(deps)(URI);
  assert.strictEqual(got, inEditor, "the reader must return the buffer's text, including edits never saved");
  assert.notStrictEqual(got, onDisk, "returning the on-disk text is the exact defect this session removes");
  assert.deepStrictEqual(calls.openTextDocument, [], "the disk must not even be consulted for an open document");
});

// ---- a CLOSED document is opened, read, and not shown -----------------------

t("a closed document is read via openTextDocument(uri) then getText(), once each", async () => {
  const { deps, calls } = makeDeps({ open: [], onOpen: () => resolvesTo("from disk") });
  const got = await makeBlockReader(deps)(URI);

  assert.strictEqual(got, "from disk", "the opened document's getText() is the answer");
  assert.deepStrictEqual(calls.openTextDocument, [URI], "openTextDocument called exactly once, with the uri unchanged");
  assert.deepStrictEqual(calls.getTextOpened, [URI], "getText() called exactly once on the opened document");
  assert.ok(calls.openDocuments >= 1, "the reader must consult the open list before deciding to open");
});

t("the reader touches nothing beyond the two-function seam, so it cannot be showing a document", async () => {
  // The contract's "reads without showing" is an extension-host property. The
  // headless proxy for it: the reader is handed exactly two functions and one
  // `getText`, and any other property it reaches for is recorded here.
  const openCase = makeDeps({ open: [{ uri: URI, text: "x" }] });
  await makeBlockReader(openCase.deps)(URI);
  assert.deepStrictEqual(openCase.violations, [], "open path reached outside the declared seam");

  const closedCase = makeDeps({ open: [], onOpen: () => resolvesTo("y") });
  await makeBlockReader(closedCase.deps)(URI);
  assert.deepStrictEqual(closedCase.violations, [], "closed path reached outside the declared seam");
});

// ---- unreadable is `undefined`, never "" and never a throw -----------------

t("openTextDocument failing yields undefined: never a thrown error, never an empty string", async () => {
  // THE ROW THAT MATTERS MOST HERE. An empty string in place of `undefined`
  // sends an empty section to the model, silently; the store's step 2 turns
  // `undefined` into `lost:"deleted"` and excludes the block instead.
  // Data-only rows: every shape a failed open takes.
  const rows = [
    { name: "rejects with a vscode-shaped Error (the deleted-file shape)", outcome: rejectsWith(new Error("cannot open file:///w/gone.ts")) },
    { name: "rejects with a bare string", outcome: rejectsWith("EntryNotFound (FileSystemError)") },
    { name: "rejects with undefined", outcome: rejectsWith(undefined) },
    { name: "rejects with a falsy empty string", outcome: rejectsWith("") },
    { name: "throws SYNCHRONOUSLY before returning a promise", outcome: throwsSync(new Error("uri parse failed")) },
  ];

  for (const row of rows) {
    const { deps } = makeDeps({ open: [], onOpen: () => row.outcome });
    let got;
    try {
      got = await makeBlockReader(deps)(URI);
    } catch (err) {
      assert.fail(`row "${row.name}": the reader threw instead of returning undefined (${String(err)})`);
    }
    assert.strictEqual(got, undefined, `row "${row.name}": an unreadable document must read as undefined`);
    assert.notStrictEqual(got, "", `row "${row.name}": an empty string would silently send an empty section`);
  }
});

t("a malformed uri that cannot be parsed yields undefined", async () => {
  // CONTRACT GAP: the seam takes a uri STRING and the reader owns no vscode.Uri,
  // so "cannot even be parsed" can only surface as the open call failing. The
  // call made here: the fake fails the way `vscode.Uri.parse` does, and the row
  // asserts the RETURN only. It deliberately does not assert whether
  // openTextDocument was called, because a reader that rejects junk before
  // calling is equally correct.
  const rows = [
    { name: "empty string", uri: "" },
    { name: "no scheme at all", uri: "not a uri" },
    { name: "colons only", uri: "::::" },
    { name: "a lone scheme separator", uri: "file://" },
    { name: "a raw windows path, never a uri", uri: "C:\\w\\main.ts" },
  ];

  for (const row of rows) {
    const { deps } = makeDeps({ open: [], onOpen: () => throwsSync(new TypeError(`invalid uri: ${row.uri}`)) });
    let got;
    try {
      got = await makeBlockReader(deps)(row.uri);
    } catch (err) {
      assert.fail(`row "${row.name}": a malformed uri must not throw out of the reader (${String(err)})`);
    }
    assert.strictEqual(got, undefined, `row "${row.name}": a malformed uri reads as undefined`);
  }
});

t("an empty document and an unreadable one are two different answers, not one", async () => {
  // Pin both directions. Collapsing "" into undefined loses a legitimately
  // empty file's block for no reason; collapsing undefined into "" sends an
  // empty section to the model, which the contract bans outright.
  const openEmpty = makeDeps({ open: [{ uri: URI, text: "" }] });
  const fromOpen = await makeBlockReader(openEmpty.deps)(URI);
  assert.strictEqual(fromOpen, "", "an OPEN document whose getText() is empty reads as the empty string");
  assert.notStrictEqual(fromOpen, undefined, "an empty open document is readable, so it is not undefined");

  const closedEmpty = makeDeps({ open: [], onOpen: () => resolvesTo("") });
  const fromOpened = await makeBlockReader(closedEmpty.deps)(URI);
  assert.strictEqual(fromOpened, "", "an OPENED document whose getText() is empty reads as the empty string");
  assert.notStrictEqual(fromOpened, undefined, "an empty file on disk is readable, so it is not undefined");

  const unreadable = makeDeps({ open: [], onOpen: () => rejectsWith(new Error("gone")) });
  const fromFailure = await makeBlockReader(unreadable.deps)(URI);
  assert.strictEqual(fromFailure, undefined, "an unreadable document reads as undefined");
  assert.notStrictEqual(fromFailure, "", "an unreadable document must never read as the empty string");

  assert.notStrictEqual(fromOpen, fromFailure, "empty and unreadable must stay distinguishable by the caller");
});

// ---- statelessness: two calls are two reads --------------------------------

t("STATELESS on the closed path: two reads of one uri are two openTextDocument calls", async () => {
  let generation = 0;
  const { deps, calls } = makeDeps({ open: [], onOpen: () => resolvesTo(() => `disk v${++generation}`) });
  const read = makeBlockReader(deps);

  assert.strictEqual(await read(URI), "disk v1");
  assert.strictEqual(await read(URI), "disk v2", "a cached first answer would repeat v1");
  assert.deepStrictEqual(calls.openTextDocument, [URI, URI], "openTextDocument called once per read, no memo across reads");
  assert.deepStrictEqual(calls.getTextOpened, [URI, URI], "getText() called once per read");
});

t("STATELESS on the open path: the second read sees an edit made between the two calls", async () => {
  let text = "before";
  const { deps, calls } = makeDeps({ open: [{ uri: URI, text: () => text }] });
  const read = makeBlockReader(deps);

  assert.strictEqual(await read(URI), "before");
  text = "after"; // the human typed
  assert.strictEqual(await read(URI), "after", "a cache would hand the model what the lines said a keystroke ago");
  assert.strictEqual(calls.openDocuments, 2, "the open-document list is re-consulted per read");
  assert.deepStrictEqual(calls.getTextOpen, [URI, URI], "getText() called once per read, never memoized");
});

t("STATELESS across lifetimes: a document open on the first read and closed by the second falls through to openTextDocument", async () => {
  let isOpen = true;
  const openDoc = { uri: URI, getText: () => "buffer text" };
  const { deps, calls } = makeDeps({
    openDocuments: () => (isOpen ? [openDoc] : []),
    onOpen: () => resolvesTo("disk text"),
  });
  const read = makeBlockReader(deps);

  assert.strictEqual(await read(URI), "buffer text");
  assert.deepStrictEqual(calls.openTextDocument, [], "the first read had an open document and must not open one");

  isOpen = false; // the human closed the tab; markLapsed fires elsewhere
  assert.strictEqual(await read(URI), "disk text", "a remembered open document would keep answering after the tab closed");
  assert.deepStrictEqual(calls.openTextDocument, [URI], "the second read opens it, exactly once");
});
