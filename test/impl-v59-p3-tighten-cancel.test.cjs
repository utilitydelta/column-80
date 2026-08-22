// Implementer oracle, session-v59 phase 3: the tighten gesture's cancel exists
// (scrap S58-11).
//
// THE DEFECT. `runProposer` builds an `AbortController`, passes its signal to
// the transport, and nothing ever calls `abort()`. The signal is inert: the
// gesture reaches the same server every other gesture reaches, and when that
// server hangs the round is invisible - no status-bar item, no notification -
// and unstoppable. The scrap's own lesson is that a source pin for `new
// AbortController()` proves nothing, because a controller can exist, be passed,
// and be wired to no caller. So every row here drives an ABORT PATH.
//
// THE SECOND HALF, and it is a gate not a nicety. The proposer's catch logged
// every throw as a failed round, and after phase 1 the warn site translates
// that throw into a sentence on screen. A cancelled round therefore told the
// user their work failed. A cancel that stops the round and still warns is the
// defect this phase exists to remove, so "it stopped" and "it said nothing"
// are asserted together, off one drive.
//
// WHAT THE HEAVY ROWS SEE. The product's own `activate`, then a second
// `registerFnGen` over a transport this file holds open - the rig
// `blind-v58-p5-cancel-affordance.test.cjs` established. Both the tighten
// command and `column80.cancelGeneration` come out of the product's own
// registration; nothing here reaches inside the registry or calls `abort`
// itself. The gesture is driven by its command id and stopped by the cancel
// command's id, which is what a user does.
//
// WHAT THE LIGHT ROWS SEE. `tightenDocComment` called directly, so the OUTCOME
// is readable and a control can prove the warning still fires for a real
// failure. Without that control, muting every warning on this surface would
// pass every other row in this file.
//
// ROWS
//   G  [harness]              the bundle builds and the rig came up
//   G  [precondition]         the drive reaches the transport, with a signal
//   1  [the round stops]      the cancel command settles a hung round
//   2  [no failure warning]   and it toasts nothing
//   3  [the channel]          the round is recorded as cancelled, not failed
//   4  [visible, then gone]   the round claims the in-flight item and gives it back
//   5  [nothing was written]  no preview, no write
//   6  [light: abort]         an AbortError at the transport is a cancelled outcome
//   7  [light: CONTROL]       a real failure still warns, once
//   8  [light: forgery]       a server that says "aborted" is still a failure
//
// AT THE BRANCH POINT (before the fix): 5 red, 5 green, and which is which
// matters. RED were 1, 3, 4 and 6 - the round hung 4s past the cancel command,
// no status-bar item was ever claimed, the tighten channel said nothing about a
// cancellation, and row 6 read back the lie verbatim: "Column 80: the model
// could not be reached, so no type names were offered." said to a user who
// stopped the round themselves.
//
// GREEN BY HANGING, and they are not weak for it: 2 and 5. A round that never
// ends toasts nothing and writes nothing, so both pass on the broken product
// while row 1 fails. They are the rows that catch the HALF-FIX - an abort that
// lands and is then reported as a failure - and row 6 proves that half-fix is
// the real failure mode rather than a hypothetical, because that is exactly
// what the branch point did with an AbortError.
//
// Run: node --test test/impl-v59-p3-tighten-cancel.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const esbuild = require("esbuild");
const { ACTIVATION_STUB_SOURCE } = require("./.activation-stub.cjs");

const ROOT = path.join(__dirname, "..");
const TAG = "impl-v59-p3";
const STUB = path.join(__dirname, `.${TAG}.stub.cjs`);
const ENTRY = path.join(__dirname, `.${TAG}.entry.ts`);
const OUTFILE = path.join(__dirname, `.${TAG}.bundle.cjs`);

// The patch. The activation stub's status-bar factory returns a shape that
// records nothing, and row 4 needs to know what was shown; the terminal and
// tab surfaces are what the fn-gen preview path touches on the way past.
const PATCH = `
const st = module.exports.__state;
st.statusBarItems = [];
st.terminals = [];
module.exports.window.createTerminal = (opts) => {
  const t = { opts, sendText() {}, show() {}, dispose() {} };
  st.terminals.push(t);
  return t;
};
module.exports.window.createStatusBarItem = (a, b) => {
  const item = {
    alignment: a, priority: b,
    text: "", tooltip: undefined, command: undefined, name: undefined,
    calls: [],
    show() { this.calls.push("show"); },
    hide() { this.calls.push("hide"); },
    dispose() { this.calls.push("dispose"); },
  };
  st.statusBarItems.push(item);
  return item;
};
st.tabs = [];
module.exports.window.tabGroups = {
  get all() { return st.tabs; },
  activeTabGroup: undefined,
  onDidChangeTabs: () => ({ dispose() {} }),
  close: async () => true,
};
`;

let B = {};
let bundleErr;
try {
  fs.writeFileSync(STUB, ACTIVATION_STUB_SOURCE + PATCH);
  fs.writeFileSync(
    ENTRY,
    `export { activate } from "../src/vscode/extension";
export { registerFnGen, buildFnGenService } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { TIGHTEN_COMMAND_ID, tightenDocComment } from "../src/vscode/tightenDocComment";
export { CANCEL_COMMAND } from "../src/vscode/inFlight";
export { __state, Position, Range, Selection, Uri } from "vscode";
`,
  );
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}

// ---------------------------------------------------------------------------
// The fixture. One dictated line comment, over-long and un-tightened, above a
// real function - the same shape the phase-1 rows drive.
// ---------------------------------------------------------------------------

const WROOT = fs.mkdtempSync(path.join(os.tmpdir(), "c80-v59p3-"));
fs.mkdirSync(path.join(WROOT, "src"), { recursive: true });
const FSPATH = path.join(WROOT, "src", "walk.ts");
const SRC =
  "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
  "export function walk(): number {\n" +
  "  return 1;\n" +
  "}\n" +
  "\n";
fs.writeFileSync(FSPATH, SRC);
fs.writeFileSync(
  path.join(WROOT, "package.json"),
  JSON.stringify({ name: "c80-v59p3-fixture", version: "0.0.0" }, null, 2),
);

const REMOTE = "http://ml-box.invalid:11434";
const MODEL = "qwen3-coder:480b";
const MB = 1048576;
const PROBE = { runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }), totalMemBytes: () => 61826 * MB };
const CFG = { apiBase: REMOTE, model: MODEL, fallbackModel: MODEL, maxTokens: 512, temperature: 0.2 };

function makeDoc() {
  const lineStarts = [0];
  for (let i = 0; i < SRC.length; i++) if (SRC[i] === "\n") lineStarts.push(i + 1);
  const offsetAt = (pos) => Math.min((lineStarts[pos.line] ?? SRC.length) + pos.character, SRC.length);
  return {
    languageId: "typescript",
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1,
    lineCount: SRC.split("\n").length,
    fileName: FSPATH,
    uri: { fsPath: FSPATH, path: FSPATH, scheme: "file", toString: () => `file://${FSPATH}`, with() { return this; } },
    getText: (range) => (range ? SRC.slice(offsetAt(range.start), offsetAt(range.end)) : SRC),
    offsetAt,
    positionAt(offset) {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return new B.Position(line, offset - lineStarts[line]);
    },
    lineAt(arg) {
      const n = typeof arg === "number" ? arg : arg.line;
      const text = SRC.split("\n")[n] ?? "";
      const m = text.match(/\S/);
      return {
        lineNumber: n,
        text,
        range: new B.Range(n, 0, n, text.length),
        firstNonWhitespaceCharacterIndex: m ? m.index : text.length,
        isEmptyOrWhitespace: !m,
      };
    },
    save: async () => true,
  };
}

const SYMBOLS = () => [
  { name: "walk", detail: "", kind: 11, range: new B.Range(1, 0, 3, 1), selectionRange: new B.Range(1, 16, 1, 20), children: [] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (predicate, tries = 400) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await sleep(5);
  }
  return false;
};

// ---------------------------------------------------------------------------
// The rig. One activation for the real command table, one instrumented
// re-registration over a transport that never answers on its own.
// ---------------------------------------------------------------------------

const rig = { ready: false, reason: "", channel: [], calls: [] };

async function buildRig() {
  if (bundleErr) {
    rig.reason = `the bundle did not build: ${bundleErr}`;
    return;
  }
  const st = B.__state;
  st.config = { apiBase: REMOTE, fnGenModel: MODEL, repairEnabled: true };
  st.commands = {};
  st.statusBarItems = [];
  st.messages = [];
  st.outputLines = [];
  st.executeCalls = [];
  st.commandHandlers = { "vscode.executeDocumentSymbolProvider": () => st.symbols };
  const doc = makeDoc();
  st.textDocuments = [doc];
  st.symbols = SYMBOLS();

  const activateContext = {
    subscriptions: [],
    globalState: { get: () => undefined, update: async () => {} },
    workspaceState: { get: () => undefined, update: async () => {} },
    extensionUri: { fsPath: "/ext", toString: () => "file:///ext" },
    globalStorageUri: { fsPath: path.join(WROOT, ".storage") },
  };
  await B.activate(activateContext);
  // The reachability probe against the .invalid host settles before the rows
  // read the command table.
  await sleep(250);
  rig.afterActivate = Object.keys(st.commands).slice();

  const output = {
    appendLine: (l) => rig.channel.push(String(l)),
    append() {},
    replace() {},
    show() {},
    hide() {},
    clear() {},
    dispose() {},
  };
  // A transport that accepts the request and never answers - the hung server,
  // reproduced. It rejects only when its own signal aborts, so a settled round
  // is proof the abort travelled.
  const generateFn = async (params) => {
    const call = { signal: params.signal, settled: false };
    call.promise = new Promise((res, rej) => {
      call.resolve = (v) => {
        call.settled = true;
        res(v);
      };
      call.reject = (e) => {
        call.settled = true;
        rej(e);
      };
    });
    if (params.signal !== undefined) {
      params.signal.addEventListener("abort", () =>
        call.reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
      );
    }
    rig.calls.push(call);
    return call.promise;
  };
  let built;
  B.registerFnGen({ subscriptions: [], globalStorageUri: { fsPath: path.join(WROOT, ".storage") } }, output, new B.ContextBlockStore(() => {}), {
    buildService: async (out, log) => {
      built = await B.buildFnGenService(out, log, PROBE, { listModels: async () => [MODEL] });
      try {
        built.service.dispose();
      } catch {
        /* teardown only */
      }
      built = { ...built, service: new B.FnGenService(CFG, generateFn, log) };
      return built;
    },
    listModels: async () => [MODEL],
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
  });
  const up = await waitFor(() => typeof st.commands[B.TIGHTEN_COMMAND_ID] === "function" && built !== undefined);
  if (!up) {
    rig.reason = `the instrumented gestures never registered; commands: ${JSON.stringify(Object.keys(st.commands))}`;
    return;
  }
  // The cursor sits IN the comment. Anywhere else and the gesture refuses
  // before it ever reaches a model.
  const at = new B.Position(0, 20);
  const selection = new B.Range(at, at);
  selection.active = at;
  selection.anchor = at;
  st.activeTextEditor = {
    document: doc,
    viewColumn: 1,
    options: { tabSize: 2, insertSpaces: true },
    selection,
    insertSnippet: async () => true,
    revealRange: () => {},
    edit: async (cb) => {
      cb({ replace() {}, insert() {}, delete() {} });
      return true;
    },
  };
  rig.ready = true;
}

/** Status-bar items whose click target is the cancel command, and whether the
 *  last thing done to them was `show`. */
const cancelItems = () =>
  (B.__state?.statusBarItems ?? []).filter((i) => {
    const c = i.command;
    return c === B.CANCEL_COMMAND || (c && typeof c === "object" && c.command === B.CANCEL_COMMAND);
  });
const isVisible = (i) => i.calls[i.calls.length - 1] === "show";

// ---------------------------------------------------------------------------
// THE ONE DRIVE. Start the gesture, wait until the transport holds the round,
// press cancel, and record everything before anything else can touch it.
// ---------------------------------------------------------------------------

const drive = { done: false, reason: "" };

async function runDrive() {
  await buildRig();
  if (!rig.ready) {
    drive.reason = rig.reason;
    return;
  }
  const st = B.__state;
  st.messages.length = 0;
  st.executeCalls.length = 0;
  rig.channel.length = 0;
  rig.calls.length = 0;

  const gesture = st.commands[B.TIGHTEN_COMMAND_ID]();
  let outcome;
  const settledFlag = gesture.then(
    (v) => {
      outcome = v;
      return "settled";
    },
    (e) => {
      outcome = e;
      return "threw";
    },
  );
  drive.reached = await waitFor(() => rig.calls.length > 0);
  drive.signal = drive.reached ? rig.calls[0].signal : undefined;
  drive.itemVisibleDuring = cancelItems().some(isVisible);
  drive.textDuring = cancelItems().map((i) => i.text);

  await st.commands[B.CANCEL_COMMAND]();

  drive.settled = await Promise.race([settledFlag, sleep(4000).then(() => "hung")]);
  // Snapshot BEFORE anything is force-settled below: a toast that arrives
  // afterwards belongs to the teardown, not to the cancel.
  drive.warns = st.messages.filter((m) => m.kind === "warn" || m.kind === "error").map((m) => m.message);
  drive.channel = rig.channel.slice();
  drive.executed = st.executeCalls.map((c) => c.id);
  drive.itemVisibleAfter = cancelItems().some(isVisible);
  drive.threw = outcome;
  drive.done = true;

  // Teardown: a round the product never stopped would otherwise hold the
  // process open, and a hung suite is a worse report than a red row.
  for (const call of rig.calls) {
    if (!call.settled) call.reject(Object.assign(new Error("harness teardown"), { name: "AbortError" }));
  }
  await Promise.race([gesture.catch(() => {}), sleep(2000)]);
}

const driven = runDrive();

test.after(() => {
  for (const f of [STUB, ENTRY, OUTFILE]) fs.rmSync(f, { force: true });
  fs.rmSync(WROOT, { recursive: true, force: true });
});

const heavy = (name, fn) =>
  test(name, async (ctx) => {
    await driven;
    if (!drive.done) return ctx.skip(`the rig never drove the gesture: ${drive.reason}`);
    return fn(ctx);
  });

const show = (v) => JSON.stringify(v);

test("G [harness]: the bundle builds, the extension activates, and both commands are registered", async () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.stack || bundleErr.message}`);
  await driven;
  assert.ok(rig.ready, `the rig must come up or every row below is vacuous: ${rig.reason}`);
  assert.ok(
    rig.afterActivate.includes(B.CANCEL_COMMAND),
    `the product's own activate must register ${B.CANCEL_COMMAND}: ${show(rig.afterActivate)}`,
  );
  assert.ok(
    typeof B.__state.commands[B.TIGHTEN_COMMAND_ID] === "function",
    `${B.TIGHTEN_COMMAND_ID} must be registered`,
  );
});

heavy("G [precondition]: the gesture reaches the transport, holding a signal", () => {
  assert.ok(drive.reached, "the drive never reached the model round, so nothing below is about cancellation");
  assert.ok(
    drive.signal !== undefined && typeof drive.signal.addEventListener === "function",
    "the round must carry an AbortSignal, or there is nothing for a cancel to travel down",
  );
});

heavy("row 1 [the round stops]: the cancel command ends a round the server never answers", () => {
  assert.strictEqual(
    drive.settled,
    "settled",
    "row 1: pressing Cancel Generation must stop a hung tighten round. The transport answers only when its " +
      "own signal aborts, so a round still pending 4s after the command means nothing called abort() - the " +
      "controller in runProposer is wired to no caller (scrap S58-11)",
  );
});

heavy("row 2 [no failure warning]: work the user stopped is never reported as a failure", () => {
  assert.deepStrictEqual(
    drive.warns,
    [],
    "row 2: a cancelled round must toast nothing. This is the half a cancel that merely stops does not " +
      "fix: the proposer's catch treats every throw as a failed round, so the user who pressed Cancel is " +
      "told the model could not be reached",
  );
});

heavy("row 3 [the channel]: the round is recorded as cancelled, not as a proposer failure", () => {
  // The GESTURE's own line, not the registry's. `cancelAll` writes `[cancel]
  // ...` whatever happens, including "nothing in flight", so a bare /cancel/i
  // over the whole channel passes on a round that was never stopped at all.
  assert.ok(
    drive.channel.some((l) => /^\[tighten\].*cancel/i.test(l)),
    `row 3: the tighten channel must say the round was cancelled: ${show(drive.channel.filter((l) => l.startsWith("[tighten]")))}`,
  );
  assert.ok(
    !drive.channel.some((l) => /the proposer round failed/.test(l)),
    `row 3: and it must not ALSO record it as a failure: ${show(drive.channel.filter((l) => /proposer/.test(l)))}`,
  );
});

heavy("row 4 [visible, then gone]: the round claims the in-flight item and gives it back", () => {
  assert.ok(
    drive.itemVisibleDuring,
    "row 4: a tighten round in flight must be visible in the status bar - that is what makes it cancellable " +
      "at all, and a hung round with nothing on screen is the state the affordance exists for",
  );
  assert.ok(
    drive.textDuring.some((t) => /tighten/i.test(t)),
    `row 4: the item must name what is running: ${show(drive.textDuring)}`,
  );
  assert.strictEqual(
    drive.itemVisibleAfter,
    false,
    "row 4: the claim must be released in a finally, so the item retires when the round ends",
  );
});

// The command handler returns nothing, so the OUTCOME is not readable at this
// layer - row 6 reads it. What is readable here is what the developer would
// have seen: a diff preview, and a channel line claiming a write.
heavy("row 5 [nothing was written]: a cancelled round opens no preview and writes nothing", () => {
  assert.ok(
    !drive.executed.includes("vscode.diff"),
    `row 5: a cancelled gesture must not go on to ask the developer about a diff: ${show(drive.executed)}`,
  );
  assert.ok(
    !drive.channel.some((l) => /^\[tighten\] applied/.test(l)),
    `row 5: and it must not write: ${show(drive.channel.filter((l) => l.startsWith("[tighten]")))}`,
  );
});

// ---------------------------------------------------------------------------
// The light rows. `tightenDocComment` directly, so the outcome is readable and
// the control can prove the warning still fires for a real failure.
// ---------------------------------------------------------------------------

function lightDoc() {
  const text = SRC;
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return {
    languageId: "typescript",
    version: 1,
    isClosed: false,
    eol: 1,
    uri: { toString: () => `file://${FSPATH}`, fsPath: FSPATH, path: FSPATH },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (l) => ({ text: lines[typeof l === "number" ? l : l.line] ?? "" }),
  };
}

/** One invocation whose proposer round throws `err`. Every other seam is inert.
 *  The review is COUNTED: a cancelled round must not go on to ask about a diff,
 *  and a failed one must. */
async function driveLight(err) {
  const warnings = [];
  let reviews = 0;
  const wiring = {
    presenter: { confirmDiff: async () => "accept" },
    resolveFunction: async () => ({ languageId: "typescript", symbolName: "walk" }),
    resolvePrefill: async () => undefined,
    prefillLangFor: () => ({ localTypeDefs: () => new Map(), typeReference: () => undefined }),
    extractorFor: () => undefined,
    transport: () => async () => {
      throw err;
    },
    modelTag: () => "test-model",
  };
  const deps = {
    querySymbols: async () => [],
    fileExists: () => false,
    readFile: () => undefined,
    workspaceRoot: () => WROOT,
    config: () => ({ apiBase: REMOTE, model: MODEL, fallbackModel: MODEL, maxTokens: 2048, temperature: 0, numCtx: 16384 }),
    windowed: () => true,
    review: async () => {
      reviews++;
      return [];
    },
    applyEdit: async () => true,
    warn: (m) => warnings.push(m),
  };
  const lines = [];
  const outcome = await B.tightenDocComment(lightDoc(), { line: 0, character: 20 }, (l) => lines.push(String(l)), wiring, deps);
  return { outcome, warnings, reviews, lines };
}

const light = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the harness row");
    return fn(ctx);
  });

light("row 6 [light: abort]: an AbortError at the transport is a cancelled outcome, silently", async () => {
  const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  const got = await driveLight(abort);
  // The warning FIRST, because it is the lie: at the branch point this row's
  // red reads "the model could not be reached", said to a user who stopped the
  // round themselves.
  assert.deepStrictEqual(got.warnings, [], "row 6: a cancel says nothing on screen");
  assert.strictEqual(got.outcome?.status, "cancelled", `row 6: got ${show(got.outcome)}`);
  assert.strictEqual(got.reviews, 0, "row 6: a cancelled round does not go on to offer a diff");
});

light("row 7 [light: CONTROL]: a real failure still warns exactly once, and the gesture carries on", async () => {
  // The control that stops row 2 being satisfied by deleting the warn call.
  const got = await driveLight(new Error("server unreachable"));
  assert.strictEqual(got.warnings.length, 1, `row 7: a failed round still warns: ${show(got.warnings)}`);
  assert.notStrictEqual(got.outcome?.status, "cancelled", "row 7: a failure is not a cancellation");
  assert.strictEqual(got.reviews, 1, "row 7: the re-wrap needs no model, so the review still happens");
});

// The other side of `isCancellation`: a SERVER whose message merely mentions an
// abort is a failure, and silencing it would hide a real one (session-v57 scrap
// S57-3, the `/abort/i` bug this must not copy).
light("row 8 [light: forgery]: a server error that says 'aborted' is still a failure", async () => {
  const got = await driveLight(new Error("upstream aborted the request"));
  assert.strictEqual(got.warnings.length, 1, `row 8: got ${show(got.warnings)}`);
  assert.notStrictEqual(got.outcome?.status, "cancelled", "row 8: the NAME is the signal, never the message");
});
