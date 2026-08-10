// IMPLEMENTATION oracle for session-v29 phase 2: the reference leg's MAPPING,
// headless. No language server anywhere in this file.
//
// What is proven here and what is deliberately not. The live oracle
// (impl-v29-p2-references-live.test.cjs) proves the five real servers answer;
// what it cannot do is drive them into the shapes that break a mapper, because a
// working server never emits them. So the wire shapes are driven from here: a
// `null` reply (which several servers send instead of `[]`), a non-array, an
// entry with no uri, a range missing an endpoint, coordinates that are not
// numbers, an error reply, a transport that throws.
//
// Three levels, because the leg is three things:
//   1. toReferenceLocations / capReferences, pure, no I/O at all.
//   2. the LSP transports over a FAKE stdio server - a node script that speaks
//      Content-Length framing and replies whatever the case scripts. It logs
//      every request it received, which is the only way to prove
//      `context.includeDeclaration` actually went over the wire rather than
//      being read back out of the same object the test set.
//   3. the TS transport over a FAKE typescript module (the transport's own
//      `opts.ts` injection point), because that one maps a completely different
//      shape - ReferencedSymbol groups - and honors includeDeclaration itself.
//
// Run: node --test test/impl-v29-p2-references.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

const { mod: B, cleanup } = bundleCore(
  "impl-v29-p2-references",
  `export { toReferenceLocations, capReferences } from "../src/core/extraction";
export { PyLspExtractor } from "../src/core/pyLspExtractor";
export { GoLspExtractor } from "../src/core/goLspExtractor";
export { TsLsExtractor } from "../src/core/tsLsExtractor";\n`,
);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v29-p2-"));
test.after(() => {
  cleanup();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const loc = (uri, line, character, endLine, endCharacter) => ({ uri, line, character, endLine, endCharacter });
const wire = (uri, sl, sc, el, ec) => ({ uri, range: { start: { line: sl, character: sc }, end: { line: el, character: ec } } });

// ===========================================================================
// 1. The pure mapper.
// ===========================================================================

test("toReferenceLocations maps a well-formed Location[] verbatim", () => {
  const got = B.toReferenceLocations([wire("file:///a.rs", 1, 2, 1, 8), wire("file:///b.rs", 40, 0, 41, 3)]);
  assert.deepStrictEqual(got, [loc("file:///a.rs", 1, 2, 1, 8), loc("file:///b.rs", 40, 0, 41, 3)]);
});

test("toReferenceLocations reads a null reply as no references, not as a failure", () => {
  // The shape that matters: LSP lets a server answer `null` for "nothing", and
  // several do. A mapper that only handled arrays would throw on the exact case
  // the caller most needs to survive (a first-use symbol).
  assert.deepStrictEqual(B.toReferenceLocations(null), []);
  assert.deepStrictEqual(B.toReferenceLocations(undefined), []);
});

test("toReferenceLocations refuses a non-array reply rather than reaching into it", () => {
  for (const junk of [{ items: [wire("file:///a.rs", 0, 0, 0, 1)] }, "[]", 7, true]) {
    assert.deepStrictEqual(B.toReferenceLocations(junk), [], `reply ${JSON.stringify(junk)}`);
  }
});

test("toReferenceLocations drops a malformed entry and keeps the rest", () => {
  // Dropping, not throwing and not filling in: a reference list is evidence a
  // caller ADDS to a prompt, so a half-parsed entry is worth less than no entry,
  // and a fabricated coordinate sends the caller reading the wrong bytes.
  const got = B.toReferenceLocations([
    wire("file:///good.rs", 3, 4, 3, 9),
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }, // no uri
    { uri: "file:///no-range.rs" },
    { uri: "file:///no-end.rs", range: { start: { line: 1, character: 1 } } },
    { uri: "file:///no-start.rs", range: { end: { line: 1, character: 1 } } },
    { uri: 12, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
    { uri: "file:///nan.rs", range: { start: { line: "1", character: 0 }, end: { line: 1, character: 4 } } },
    null,
    "file:///not-an-object.rs",
    wire("file:///also-good.rs", 9, 0, 9, 5),
  ]);
  assert.deepStrictEqual(got, [loc("file:///good.rs", 3, 4, 3, 9), loc("file:///also-good.rs", 9, 0, 9, 5)]);
});

test("toReferenceLocations truncates to maxResults, keeping the server's order", () => {
  const reply = [0, 1, 2, 3, 4].map((i) => wire(`file:///${i}.rs`, i, 0, i, 1));
  const got = B.toReferenceLocations(reply, 3);
  assert.deepStrictEqual(
    got.map((l) => l.uri),
    ["file:///0.rs", "file:///1.rs", "file:///2.rs"],
  );
});

test("capReferences treats a non-cap as no cap, and never as a cap of zero", () => {
  const three = [loc("file:///a", 0, 0, 0, 1), loc("file:///b", 1, 0, 1, 1), loc("file:///c", 2, 0, 2, 1)];
  // 0 results is never what a caller meant by asking a question, so a
  // non-positive or nonsense cap has to read as "uncapped" rather than "empty".
  for (const cap of [undefined, 0, -1, NaN, Infinity, "2", null]) {
    assert.strictEqual(B.capReferences(three, cap).length, 3, `cap ${String(cap)} must not truncate`);
  }
  assert.strictEqual(B.capReferences(three, 2).length, 2);
  assert.strictEqual(B.capReferences(three, 2.9).length, 2, "a fractional cap floors rather than rounding up past it");
  assert.strictEqual(B.capReferences(three, 99).length, 3, "a cap above the answer is not a pad");
});

// ===========================================================================
// 2. The LSP transports, over a fake stdio server.
// ===========================================================================

// The fake speaks the same framing the transports do and nothing else: it logs
// every request it is handed, answers `initialize`, publishes empty diagnostics
// on didOpen (pyright's readiness gate), and answers textDocument/references out
// of the case's script file. Everything else gets null, which is what a real
// server's unimplemented capability looks like.
const FAKE_SERVER = path.join(scratch, "fake-lsp.js");
fs.writeFileSync(
  FAKE_SERVER,
  `#!/usr/bin/env node
const fs = require("fs");
const script = JSON.parse(fs.readFileSync(process.env.FAKE_LSP_SCRIPT, "utf8"));
const log = process.env.FAKE_LSP_LOG;
let buf = Buffer.alloc(0);
function send(msg) {
  const b = Buffer.from(JSON.stringify(msg));
  process.stdout.write("Content-Length: " + b.length + "\\r\\n\\r\\n");
  process.stdout.write(b);
}
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf("\\r\\n\\r\\n");
    if (sep < 0) return;
    const m = /Content-Length: (\\d+)/i.exec(buf.subarray(0, sep).toString("ascii"));
    if (!m) { buf = buf.subarray(sep + 4); continue; }
    const len = Number(m[1]);
    if (buf.length < sep + 4 + len) return;
    const body = buf.subarray(sep + 4, sep + 4 + len).toString("utf8");
    buf = buf.subarray(sep + 4 + len);
    handle(JSON.parse(body));
  }
});
function handle(msg) {
  fs.appendFileSync(log, JSON.stringify(msg) + "\\n");
  if (msg.method === "initialize") return send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } });
  if (msg.method === "textDocument/didOpen") {
    return send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: msg.params.textDocument.uri, diagnostics: [] } });
  }
  if (msg.method === "textDocument/references") {
    if (script.error) return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: "the server is having a day" } });
    if (script.silent) return;
    return send({ jsonrpc: "2.0", id: msg.id, result: script.result });
  }
  if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: null });
}
`,
);

// The transports spawn `<binary> serve` (go) and `<binary> --stdio` (python), so
// the fake is reached through a shell wrapper that swallows whatever argv the
// transport adds rather than through node directly - `node serve` is not the
// fake server, it is node looking for a file called serve.
const FAKE_BIN = path.join(scratch, "fake-lsp");
fs.writeFileSync(FAKE_BIN, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_SERVER}"\n`);
fs.chmodSync(FAKE_BIN, 0o755);

let caseSeq = 0;
/** Start one transport against a fresh fake server scripted with `script`, with
 *  one document open. Returns the extractor, that document's uri, and a reader
 *  for the reference requests the fake was actually sent. */
async function served(kind, script) {
  const id = `${kind}-${caseSeq++}`;
  const scriptPath = path.join(scratch, `${id}.script.json`);
  const logPath = path.join(scratch, `${id}.log`);
  fs.writeFileSync(scriptPath, JSON.stringify(script));
  fs.writeFileSync(logPath, "");
  process.env.FAKE_LSP_SCRIPT = scriptPath;
  process.env.FAKE_LSP_LOG = logPath;
  const ex =
    kind === "go"
      ? await B.GoLspExtractor.start({ projectRoot: scratch, goplsPath: FAKE_BIN })
      : await B.PyLspExtractor.start({ projectRoot: scratch, serverPath: FAKE_BIN, server: FAKE_BIN });
  const uri = pathToFileURL(path.join(scratch, `${id}.src`)).href;
  ex.openDocument(uri, "one\ntwo\nthree\n");
  const sent = () =>
    fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
  const refRequests = () => sent().filter((m) => m.method === "textDocument/references");
  return { ex, uri, refRequests };
}

const THREE_HITS = [wire("file:///x.go", 1, 0, 1, 4), wire("file:///y.go", 2, 5, 2, 9), wire("file:///z.go", 3, 1, 3, 5)];

for (const kind of ["go", "py"]) {
  test(`${kind}: includeDeclaration is OFF on the wire unless the caller asked for it`, async () => {
    const { ex, uri, refRequests } = await served(kind, { result: THREE_HITS });
    try {
      await ex.references({ uri, line: 1, character: 1 });
      await ex.references({ uri, line: 1, character: 1 }, { includeDeclaration: true });
      await ex.references({ uri, line: 1, character: 1 }, { includeDeclaration: false });
      await ex.references({ uri, line: 1, character: 1 }, { maxResults: 2 });
      const asked = refRequests().map((m) => m.params.context.includeDeclaration);
      // Read off the WIRE, not off the query object: the flag only means
      // anything if the server was told, and a transport that quietly dropped it
      // would pass every assertion made against its own input.
      assert.deepStrictEqual(
        asked,
        [false, true, false, false],
        `the default is false because a declaration is not a usage; got ${JSON.stringify(asked)}`,
      );
      // And the position the server was asked about is the cursor, unmoved.
      assert.deepStrictEqual(refRequests()[0].params.position, { line: 1, character: 1 });
      assert.strictEqual(refRequests()[0].params.textDocument.uri, uri);
    } finally {
      ex.dispose();
    }
  });

  test(`${kind}: maxResults truncates the server's answer, and is never sent as a request parameter`, async () => {
    const { ex, uri, refRequests } = await served(kind, { result: THREE_HITS });
    try {
      const capped = await ex.references({ uri, line: 0, character: 0 }, { maxResults: 2 });
      assert.strictEqual(capped.length, 2);
      assert.deepStrictEqual(capped[0], loc("file:///x.go", 1, 0, 1, 4));
      // The LSP reference request carries no limit, so a transport that put one
      // in the params would be bounding nothing while looking like it bounded
      // something.
      assert.deepStrictEqual(
        Object.keys(refRequests()[0].params).sort(),
        ["context", "position", "textDocument"],
        "the request carries exactly the three LSP params",
      );
    } finally {
      ex.dispose();
    }
  });

  test(`${kind}: a null reply, an error reply and a junk reply all degrade to [] rather than throwing`, async () => {
    for (const [label, script] of [
      ["null", { result: null }],
      ["error", { error: true }],
      ["junk", { result: { items: THREE_HITS } }],
    ]) {
      const { ex, uri } = await served(kind, script);
      try {
        assert.deepStrictEqual(
          await ex.references({ uri, line: 0, character: 0 }),
          [],
          `${label}: the leg never throws - a caller adds usage when it has some and keeps the surface it had when it does not`,
        );
      } finally {
        ex.dispose();
      }
    }
  });

  test(`${kind}: a dead server degrades to [] instead of rejecting the caller`, async () => {
    const { ex, uri } = await served(kind, { result: THREE_HITS });
    ex.dispose();
    // The process is gone; every in-flight and future request fails by name
    // inside the transport. The leg still owes an empty list.
    assert.deepStrictEqual(await ex.references({ uri, line: 0, character: 0 }), []);
  });
}

// ===========================================================================
// 3. The TS transport, over a fake typescript module.
//
// This one maps ReferencedSymbol GROUPS, not Locations, and honors
// includeDeclaration itself: the service always returns the declaration among
// the hits and (measured on typescript 5.9) leaves `isDefinition` undefined on
// every entry of a search started from a use site, so the group's own definition
// span is what identifies it.
// ===========================================================================

const TS_FILE = path.join(scratch, "fake.ts");
const TS_TEXT = "class T {\n  member(): void {}\n}\nconst a = new T().member();\nconst b = new T().member();\n";
const spanOf = (text, occurrence) => {
  let at = -1;
  for (let i = 0; i <= occurrence; i++) {
    at = text.indexOf("member", at + 1);
  }
  return { start: at, length: "member".length };
};

/** A typescript module with exactly the surface TsLsExtractor's constructor,
 *  start() and references() touch. Anything else it reaches for is a change to
 *  the transport, and this stub failing loudly is the point. */
function fakeTs(findReferences, getDefinitionAtPosition) {
  return {
    sys: {
      fileExists: () => false,
      readFile: (f) => (path.resolve(f) === path.resolve(TS_FILE) ? TS_TEXT : undefined),
      readDirectory: () => [],
      directoryExists: () => true,
      getDirectories: () => [],
    },
    parseJsonConfigFileContent: () => ({ fileNames: [], options: {}, errors: [] }),
    ScriptSnapshot: { fromString: (s) => s },
    getDefaultLibFilePath: () => "lib.d.ts",
    createDocumentRegistry: () => ({}),
    createLanguageService: () => ({
      getProgram: () => ({}),
      findReferences,
      // A real ts.LanguageService always has this; the transport reads it to see
      // the declarations an overload set or a merged interface hides inside ONE
      // group, which the group's own definition span cannot name.
      getDefinitionAtPosition: getDefinitionAtPosition ?? (() => []),
      dispose() {},
    }),
  };
}

async function tsExtractor(findReferences, getDefinitionAtPosition) {
  const ex = await B.TsLsExtractor.start({
    projectRoot: scratch,
    ts: fakeTs(findReferences, getDefinitionAtPosition),
  });
  ex.openDocument(pathToFileURL(TS_FILE).href, TS_TEXT);
  return ex;
}

const TS_GROUP = {
  definition: { fileName: TS_FILE, textSpan: spanOf(TS_TEXT, 0) },
  references: [
    { fileName: TS_FILE, textSpan: spanOf(TS_TEXT, 0), isWriteAccess: true },
    { fileName: TS_FILE, textSpan: spanOf(TS_TEXT, 1), isWriteAccess: false },
    { fileName: TS_FILE, textSpan: spanOf(TS_TEXT, 2), isWriteAccess: false },
  ],
};

test("typescript: the declaration is identified by the GROUP's definition span, not by isDefinition", async () => {
  // Every entry here carries isDefinition: undefined, which is what typescript
  // 5.9 really returns from a use-site search. A transport that keyed on the
  // flag would return the declaration as a usage in the default query.
  const ex = await tsExtractor(() => [TS_GROUP]);
  try {
    const uri = pathToFileURL(TS_FILE).href;
    const uses = await ex.references({ uri, line: 3, character: 20 });
    assert.deepStrictEqual(
      uses.map((l) => l.line),
      [3, 4],
      "the declaration on line 1 is dropped; the two call sites remain",
    );
    const all = await ex.references({ uri, line: 3, character: 20 }, { includeDeclaration: true });
    assert.deepStrictEqual(
      all.map((l) => l.line),
      [1, 3, 4],
      "includeDeclaration:true adds the declaration back, in the service's own order",
    );
    assert.deepStrictEqual(uses[0], loc(uri, 3, 18, 3, 24), "the offsets convert to the name token's own range");
  } finally {
    ex.dispose();
  }
});

test("typescript: an entry flagged isDefinition is dropped even when it is not the group's own definition", async () => {
  // The other half of the same rule: a search that spans an interface and its
  // implementers returns a group per declaration, and any entry either source
  // calls a definition is a declaration.
  const ex = await tsExtractor(() => [
    {
      definition: { fileName: TS_FILE, textSpan: spanOf(TS_TEXT, 0) },
      references: [
        { fileName: TS_FILE, textSpan: spanOf(TS_TEXT, 1), isWriteAccess: false, isDefinition: true },
        { fileName: TS_FILE, textSpan: spanOf(TS_TEXT, 2), isWriteAccess: false },
      ],
    },
  ]);
  try {
    const uri = pathToFileURL(TS_FILE).href;
    assert.deepStrictEqual(
      (await ex.references({ uri, line: 4, character: 20 })).map((l) => l.line),
      [4],
    );
  } finally {
    ex.dispose();
  }
});

test("typescript: no references, a service that throws, and a cursor outside the file all degrade to []", async () => {
  const uri = pathToFileURL(TS_FILE).href;
  const empty = await tsExtractor(() => undefined);
  try {
    assert.deepStrictEqual(await empty.references({ uri, line: 3, character: 20 }), []);
  } finally {
    empty.dispose();
  }
  const throwing = await tsExtractor(() => {
    throw new Error("the checker fell over");
  });
  try {
    assert.deepStrictEqual(await throwing.references({ uri, line: 3, character: 20 }), []);
  } finally {
    throwing.dispose();
  }
  const ok = await tsExtractor(() => [TS_GROUP]);
  try {
    // A file the program never heard of: the transport cannot locate the cursor,
    // and an unlocatable cursor is not a question the server can be asked.
    assert.deepStrictEqual(await ok.references({ uri: pathToFileURL(path.join(scratch, "absent.ts")).href, line: 0, character: 0 }), []);
    assert.deepStrictEqual(await ok.references({ uri, line: 999, character: 0 }), []);
  } finally {
    ok.dispose();
  }
  const disposed = await tsExtractor(() => [TS_GROUP]);
  disposed.dispose();
  assert.deepStrictEqual(await disposed.references({ uri, line: 3, character: 20 }), []);
});

test("typescript: maxResults truncates after the service answered", async () => {
  const ex = await tsExtractor(() => [TS_GROUP]);
  try {
    const uri = pathToFileURL(TS_FILE).href;
    assert.strictEqual((await ex.references({ uri, line: 3, character: 20 }, { maxResults: 1 })).length, 1);
    assert.strictEqual((await ex.references({ uri, line: 3, character: 20 }, { maxResults: 1, includeDeclaration: true })).length, 1);
  } finally {
    ex.dispose();
  }
});
