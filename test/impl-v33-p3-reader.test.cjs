// White-box tests for the reader (session-v33 phase 3).
//
// The blind oracle in `blind-v33-p3-reader.test.cjs` pins the contract: an open
// document wins, a closed one is opened, unreadable is `undefined` and never "",
// and nothing is cached. This file covers what the contract does not say and the
// implementation had to decide anyway, which is where a later edit can quietly
// change behaviour with every contract row still green:
//
//  - the whole read sits inside ONE catch, so a throw from any of the three
//    calls (openDocuments, openTextDocument, either getText) is `undefined`
//    rather than an exception escaping into `resolveForPrompt`'s walk;
//  - the open list is consulted exactly once per read, and the FIRST match wins;
//  - the open check runs BEFORE the open call, provably, not just observably.
//
// Run: SKIP_LIVE=1 node --test test/impl-v33-p3-reader.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v33-p3-reader",
  `export { makeBlockReader } from "../src/vscode/blockReader";`,
);
test.after(cleanup);

const { makeBlockReader } = mod;

const URI = "file:///w/src/main.rs";
const doc = (uri, text) => ({ uri, getText: () => text });

// ---- the single catch: no call in the read may throw out of it --------------

test("an OPEN document whose getText() throws reads as undefined, not as an exception", async () => {
  // Not a contract row, because the contract's fakes never throw here. It is
  // still reachable: a document the editor disposed between the list scan and
  // the read is exactly this shape, and an exception escaping here would abort
  // the whole generation over one block.
  const deps = {
    openDocuments: () => [
      {
        uri: URI,
        getText: () => {
          throw new Error("document disposed");
        },
      },
    ],
    openTextDocument: () => Promise.reject(new Error("must not be reached")),
  };
  assert.strictEqual(await makeBlockReader(deps)(URI), undefined);
});

test("openDocuments() itself throwing reads as undefined", async () => {
  let opened = 0;
  const deps = {
    openDocuments: () => {
      throw new Error("host is shutting down");
    },
    openTextDocument: () => {
      opened++;
      return Promise.resolve({ getText: () => "from disk" });
    },
  };
  assert.strictEqual(await makeBlockReader(deps)(URI), undefined);
  assert.strictEqual(opened, 0, "a failed list scan must not fall through to opening the file");
});

test("an OPENED document whose getText() throws reads as undefined", async () => {
  const deps = {
    openDocuments: () => [],
    openTextDocument: () =>
      Promise.resolve({
        getText: () => {
          throw new Error("decode failed");
        },
      }),
  };
  assert.strictEqual(await makeBlockReader(deps)(URI), undefined);
});

test("openTextDocument resolving to null or a document with no getText reads as undefined", async () => {
  // Both are TypeErrors at the call, so this pins that the catch is around the
  // getText call and not only around the await.
  for (const resolved of [null, undefined, {}, { getText: "not a function" }]) {
    const deps = { openDocuments: () => [], openTextDocument: () => Promise.resolve(resolved) };
    assert.strictEqual(
      await makeBlockReader(deps)(URI),
      undefined,
      `openTextDocument resolving to ${JSON.stringify(resolved) ?? String(resolved)}`,
    );
  }
});

// ---- how the open list is scanned ------------------------------------------

test("the FIRST open document matching the uri wins, and no later duplicate is read", async () => {
  // VS Code does not hand out two documents for one uri, so this is not a
  // contract row. It pins the scan's shape: `find`, not a filter-and-last or an
  // accumulate, so a future edit cannot silently start preferring the last.
  const reads = [];
  const track = (uri, text, tag) => ({
    uri,
    getText: () => {
      reads.push(tag);
      return text;
    },
  });
  const deps = {
    openDocuments: () => [track(URI, "first", "first"), track(URI, "second", "second")],
    openTextDocument: () => Promise.reject(new Error("must not be reached")),
  };
  assert.strictEqual(await makeBlockReader(deps)(URI), "first");
  assert.deepStrictEqual(reads, ["first"], "exactly one open document is read per read");
});

test("the open list is consulted exactly once per read, on both paths", async () => {
  // Twice would be free here and wrong under `resolveForPrompt`, which reads
  // once per live entry: a second scan per read doubles the cost the scout
  // measured and gives the two halves of one read two different answers.
  for (const openPath of [true, false]) {
    let scans = 0;
    const deps = {
      openDocuments: () => {
        scans++;
        return openPath ? [doc(URI, "buffer")] : [];
      },
      openTextDocument: () => Promise.resolve({ getText: () => "disk" }),
    };
    await makeBlockReader(deps)(URI);
    assert.strictEqual(scans, 1, `${openPath ? "open" : "closed"} path scans the list once`);
  }
});

test("the open check runs BEFORE the open call: a matching open document answers even when opening would throw", async () => {
  // The ordering the blind oracle can only infer from call counts. Here opening
  // is a landmine: if the reader opened first, or opened as well, this row
  // returns undefined instead of the buffer.
  const deps = {
    openDocuments: () => [doc(URI, "unsaved edits")],
    openTextDocument: () => {
      throw new Error("this file does not exist on disk yet");
    },
  };
  assert.strictEqual(await makeBlockReader(deps)(URI), "unsaved edits");
});

test("an empty open list goes straight to opening, with the uri string unchanged", async () => {
  const asked = [];
  const deps = {
    openDocuments: () => [],
    openTextDocument: (uri) => {
      asked.push(uri);
      return Promise.resolve({ getText: () => "from disk" });
    },
  };
  // Untitled and percent-encoded forms travel through untouched: the reader
  // owns no uri parser, so it can neither normalize nor corrupt them.
  const uris = [URI, "untitled:Untitled-1", "file:///w/my%20notes.md"];
  for (const uri of uris) {
    assert.strictEqual(await makeBlockReader(deps)(uri), "from disk");
  }
  assert.deepStrictEqual(asked, uris);
});

// ---- statelessness, from the other side ------------------------------------

test("two readers over one deps object share nothing, and neither holds the deps' answers", async () => {
  let text = "v1";
  const deps = { openDocuments: () => [doc(URI, text)], openTextDocument: () => Promise.reject(new Error("no")) };
  const a = makeBlockReader(deps);
  const b = makeBlockReader(deps);

  assert.strictEqual(await a(URI), "v1");
  text = "v2";
  assert.strictEqual(await b(URI), "v2", "the second reader must not see the first reader's answer");
  assert.strictEqual(await a(URI), "v2", "and the first must not see its own");
});

test("a read of one uri never answers for another, however many reads came before", async () => {
  const deps = {
    openDocuments: () => [doc("file:///w/a.rs", "A"), doc("file:///w/b.rs", "B")],
    openTextDocument: (uri) => Promise.resolve({ getText: () => `disk:${uri}` }),
  };
  const read = makeBlockReader(deps);
  assert.strictEqual(await read("file:///w/a.rs"), "A");
  assert.strictEqual(await read("file:///w/b.rs"), "B");
  assert.strictEqual(await read("file:///w/c.rs"), "disk:file:///w/c.rs");
  assert.strictEqual(await read("file:///w/a.rs"), "A", "a later read of a is still a");
});

// ---- the seam's own shape ---------------------------------------------------

test("makeBlockReader returns a fresh single-argument function and reads nothing at construction", async () => {
  let scans = 0;
  const deps = {
    openDocuments: () => {
      scans++;
      return [];
    },
    openTextDocument: () => Promise.resolve({ getText: () => "" }),
  };
  const first = makeBlockReader(deps);
  const second = makeBlockReader(deps);
  assert.notStrictEqual(first, second, "each call builds its own read");
  assert.strictEqual(first.length, 1, "the read takes the uri and nothing else");
  assert.strictEqual(scans, 0, "construction reads nothing");
});
