"use strict";

// session-v77 phase 4, lane 4: the behaviour rows of the journey re-trace for Tighten Doc
// Comment, Review Function and Model Context. Each row drives the registered command (or the
// exported facade) through the shared activation stub and fails on the code before its fix.
//
// Run: node --test test/impl-v77-p4-lane4.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleActivation } = require("./.activation-stub.cjs");

const built = bundleActivation(
  "impl-v77-p4-lane4",
  `export { registerTightenDocComment, tightenDocComment } from "../src/vscode/tightenDocComment";
export { registerCriticizeAdvise, CRITICIZE_ADVISE_COMMAND_ID } from "../src/vscode/criticizeAdviseCommand";
export { ProposalPresenter } from "../src/vscode/fnGen";
export { registerContextPanel } from "../src/vscode/contextPanel";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { proposalTitle } from "../src/core/criticizeGesture";
export { HttpStatusError } from "../src/core/errorBound";
export { translateServiceReject } from "../src/vscode/failureToast";
export { window } from "vscode";
import * as raw from "vscode";
// The stub's Uri is a plain object and contextPanel tests \`instanceof vscode.Uri\`.
export function makeUriAClass(): void {
  const old = (raw as any).Uri;
  class Uri {}
  Object.assign(Uri, old);
  (require("vscode") as any).Uri = Uri;
}\n`,
);
const B = built.mod;
const { __state, window, Position } = B;
test.after(() => built.cleanup());
B.makeUriAClass();

const statusMessages = [];
window.setStatusBarMessage = (text) => {
  statusMessages.push(String(text));
  return { dispose() {} };
};

function makeDoc(text, languageId = "typescript", uri = "file:///w/v77/walk.ts") {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new Position(lines.length - 1, 0);
  };
  return {
    languageId,
    version: 1,
    isClosed: false,
    eol: 1,
    lineCount: lines.length,
    uri: { toString: () => uri, fsPath: uri.replace(/^file:\/\//, ""), path: uri.replace(/^file:\/\//, ""), scheme: "file" },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (l) => ({ text: lines[typeof l === "number" ? l : l.line] ?? "" }),
  };
}

const warns = () => __state.messages.filter((m) => m.kind === "warn");
const warnTexts = () => warns().map((m) => m.message);

// ------------------------------------------------------------------- Tighten

// Short enough that the re-wrap changes nothing.
const WRAPPED = "// keeps the cache\nexport function walk() {}\n";
const THREE_WORDS = "export function walk() {\n  just three words\n}\n";

function tightenWiring({ gate = { allowed: true }, transport, presenter } = {}) {
  return {
    presenter: presenter ?? { confirmDiff: async () => "accept" },
    resolveFunction: async () => undefined,
    resolvePrefill: async () => undefined,
    prefillLangFor: () => ({ localTypeDefs: () => new Map(), typeReference: () => undefined }),
    extractorFor: () => undefined,
    transport: () => transport ?? (async () => ({ text: "" })),
    modelTag: () => "test-model",
    tierGate: async () => gate,
    tierMessage: () => "Function generation is disabled: no usable GPU detected. It needs at least 12GB of VRAM.",
  };
}

const tightenDeps = () => ({
  querySymbols: async () => [],
  fileExists: () => false,
  readFile: () => undefined,
  workspaceRoot: () => "/w",
  config: () => ({ apiBase: "http://127.0.0.1:1/", model: "m", fallbackModel: "m", maxTokens: 2048, temperature: 0, numCtx: 16384 }),
  windowed: () => true,
  applyEdit: async () => true,
});

const TIGHTEN_CASES = [
  // session-v77 R2: a closed tier no longer refuses; on a wrapped comment it ends at "nothing".
  { name: "a closed tier", wiring: () => tightenWiring({ gate: { allowed: false, reason: "tier-disabled" } }), text: WRAPPED, line: 0, channel: "[tighten] nothing" },
  { name: "an unresolved tier", wiring: () => tightenWiring({ gate: { allowed: false, reason: "tier-unresolved" } }), text: WRAPPED, line: 0, channel: "[tighten] refused:" },
  { name: "a three-word line", wiring: () => tightenWiring(), text: THREE_WORDS, line: 1, channel: "[tighten] refused:" },
  { name: "an already-wrapped comment", wiring: () => tightenWiring(), text: WRAPPED, line: 0, channel: "[tighten] nothing" },
];

async function pressTighten(row, args) {
  __state.messages = [];
  __state.commands = {};
  const lines = [];
  B.registerTightenDocComment({ subscriptions: [] }, { appendLine: (l) => lines.push(String(l)) }, row.wiring(), tightenDeps());
  const document = makeDoc(row.text);
  __state.activeTextEditor = { document, selection: { active: new Position(row.line, 4) }, options: { tabSize: 4 } };
  try {
    await (args === undefined ? __state.commands["column80.tightenDocComment"]() : __state.commands["column80.tightenDocComment"](args));
  } finally {
    __state.activeTextEditor = undefined;
  }
  return { lines, warns: warnTexts() };
}

for (const row of TIGHTEN_CASES) {
  test(`Q5: Tighten run by dictation on ${row.name} warns nobody and says why on the channel`, async () => {
    const got = await pressTighten(row, { source: "dictation" });
    assert.deepEqual(got.warns, [], `a user who only dictated was warned: ${JSON.stringify(got.warns)}`);
    assert.ok(got.lines.some((l) => l.startsWith(row.channel)), `no ${row.channel} line:\n${got.lines.join("\n")}`);
  });
  test(`Q5 control: Tighten from the palette on ${row.name} still warns once`, async () => {
    const got = await pressTighten(row);
    assert.equal(got.warns.length, 1, JSON.stringify(got.warns));
  });
}

test("DG23: a proposer failure on an already-wrapped comment is one warning, not two", async () => {
  __state.messages = [];
  const warned = [];
  const wiring = tightenWiring({
    transport: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1");
    },
  });
  const result = await B.tightenDocComment(makeDoc(WRAPPED), new Position(0, 4), () => {}, wiring, {
    ...tightenDeps(),
    review: async () => [],
    warn: (m) => warned.push(m),
  });
  assert.equal(result.status, "nothing");
  assert.equal(warned.length, 1, JSON.stringify(warned));
  assert.ok(!/names no type to mark/.test(warned[0]), warned[0]);
});

// Two short sentences that say the same thing: one restatement row, on one line short enough
// that the re-wrap leaves it as it is.
const RESTATED = "// Walk drops old cache keys fast. Walk drops old cache keys fast.\nexport function walk() {}\n";

test("NG2: unticking every row on an already-wrapped comment opens no diff and says nothing", async () => {
  __state.messages = [];
  const confirmed = [];
  const presenter = {
    confirmDiff: async (req) => {
      confirmed.push(req);
      return "accept";
    },
  };
  const originalPick = window.showQuickPick;
  let picked = 0;
  window.showQuickPick = async (items) => {
    picked = items.length;
    return [];
  };
  try {
    const doc = makeDoc(RESTATED);
    const lines = [];
    const result = await B.tightenDocComment(doc, new Position(0, 4), (l) => lines.push(l), tightenWiring({ presenter }), tightenDeps());
    assert.ok(picked > 0, `precondition: the review offered at least one row. Channel:\n${lines.join("\n")}`);
    assert.deepEqual(confirmed, [], "an empty diff was opened for a pick that changes nothing");
    assert.equal(result.status, "cancelled");
    assert.deepEqual(warnTexts(), []);
  } finally {
    window.showQuickPick = originalPick;
  }
});

test("P5A-7: unticking every row opens no diff even when the document changed under the pick list", async () => {
  // A format-on-save or another extension edits the file while the pick is open. "Nothing
  // changes" is decided against the text Tighten read, not the live document: comparing with
  // the live text opened an empty diff that showed the user's own change reverted.
  __state.messages = [];
  const confirmed = [];
  const presenter = {
    confirmDiff: async (req) => {
      confirmed.push(req);
      return "accept";
    },
  };
  const doc = makeDoc(RESTATED);
  const originalPick = window.showQuickPick;
  window.showQuickPick = async () => {
    const changed = RESTATED + "// added by a formatter\n";
    doc.getText = () => changed;
    return [];
  };
  try {
    const result = await B.tightenDocComment(doc, new Position(0, 4), () => {}, tightenWiring({ presenter }), tightenDeps());
    assert.deepEqual(confirmed, [], "an empty diff was opened against a document that changed under the pick");
    assert.equal(result.status, "cancelled");
  } finally {
    window.showQuickPick = originalPick;
  }
});

// ------------------------------------------------------------- Review Function

const SOURCE = [
  "/** Records the hit. */",
  "export function touch(key: string, warm: boolean): boolean {",
  "  const now = Date.now();",
  "  return now > 0;",
  "}",
].join("\n");

async function pressReview({ transport, presenter, docVersion } = {}) {
  __state.messages = [];
  __state.commands = {};
  const lines = [];
  const doc = makeDoc(SOURCE);
  if (docVersion !== undefined) Object.defineProperty(doc, "version", { get: docVersion });
  const headOffset = SOURCE.indexOf("export function");
  let controller;
  B.registerCriticizeAdvise({ subscriptions: [] }, { appendLine: (l) => lines.push(String(l)) }, {
    resolveFunction: async () => ({
      span: { start: headOffset, end: SOURCE.length },
      headOffset,
      signature: "export function touch(key: string, warm: boolean): boolean {",
      symbolName: "touch",
      languageId: "typescript",
      kind: "function",
      bodyOnly: false,
      headerIndent: "",
    }),
    tierGate: async () => ({ allowed: true }),
    tierMessage: () => undefined,
    transport: () => (req) => transport(req, controller),
    inFlight: () => ({
      begin: (_label, c) => {
        controller = c;
        return { release() {} };
      },
    }),
    presenter: () => presenter ?? { present: async () => "reject" },
  });
  __state.activeTextEditor = { document: doc, selection: { active: new Position(1, 0) }, options: { tabSize: 4 } };
  try {
    await __state.commands[B.CRITICIZE_ADVISE_COMMAND_ID]();
  } finally {
    __state.activeTextEditor = undefined;
  }
  return { lines, warns: warnTexts() };
}

test("DG12: a Review Function the user cancelled is not reported as a model with no answer", async () => {
  const got = await pressReview({
    transport: async (_req, controller) => {
      controller.abort();
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      throw err;
    },
  });
  assert.deepEqual(got.warns, [], JSON.stringify(got.warns));
  assert.ok(got.lines.some((l) => /cancelled/.test(l)), got.lines.join("\n"));
});

test("DG12 control: a transport failure with no cancel still warns", async () => {
  const got = await pressReview({
    transport: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1");
    },
  });
  assert.equal(got.warns.length, 1, JSON.stringify(got.warns));
  assert.doesNotMatch(got.warns[0], /no usable answer/, "the model was never reached, so it gave no answer at all");
});

// session-v77 phase 5 H2: a model that was never reached is not a model that answered badly.
const REVIEW_VOICE = { consequence: "so nothing was changed", retry: "try again" };
const throwing = (err) => async () => {
  throw err;
};
const H2_ROWS = [
  {
    name: "a local Ollama that refuses the connection offers to start it",
    transport: throwing(Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" })),
    want: () => ({ message: "Column 80: the Ollama server is not answering, so Review Function could not run.", actions: ["Start ollama serve"] }),
  },
  {
    name: "a refused key gets the class sentence every model surface gives",
    transport: throwing(new B.HttpStatusError("ollama", 401, "Ollama 401 unauthorized")),
    want: () => ({ message: B.translateServiceReject(new B.HttpStatusError("ollama", 401, "Ollama 401 unauthorized"), REVIEW_VOICE), actions: [] }),
  },
  {
    name: "an unclassified failure says the ask failed and shows its first line",
    transport: throwing(new Error("model 'm' not found")),
    want: () => ({ message: "Column 80: Review Function could not ask the model (model 'm' not found), so nothing was changed.", actions: [] }),
  },
  {
    name: "an empty answer is an answer the product could not read",
    transport: async () => ({ text: "" }),
    want: () => ({ message: "Column 80: Review Function could not read the model's answer, so nothing was changed. Try again.", actions: [] }),
  },
];
for (const row of H2_ROWS) {
  test(`H2: Review Function, ${row.name}`, async () => {
    await pressReview({ transport: row.transport });
    const got = warns().map((m) => ({ message: m.message, actions: m.actions }));
    assert.deepEqual(got, [row.want()]);
  });
}

test("DG16: a Review whose file changed before the diff says so on screen", async () => {
  let reads = 0;
  const presenter = new B.ProposalPresenter({ subscriptions: [] });
  const got = await pressReview({
    transport: async () => ({
      text: JSON.stringify({ blocks: [{ dimension: "clock", anchor: "const now = Date.now();", text: "Pass the instant in." }] }),
    }),
    presenter,
    // The first read is the version the review resolved against; every later one has moved.
    docVersion: () => (reads++ === 0 ? 1 : 2),
  });
  assert.equal(got.warns.length, 1, `${JSON.stringify(got.warns)}\n${got.lines.join("\n")}`);
  assert.match(got.warns[0], /review was ready/);
  assert.ok(got.lines.some((l) => /discarded/.test(l)), `the channel lost the discard:\n${got.lines.join("\n")}`);
});

// --------------------------------------------------------------- Model Context

test("DG34: Add File to Model Context confirms the add on the status bar", async () => {
  __state.messages = [];
  __state.commands = {};
  statusMessages.length = 0;
  const store = new B.ContextBlockStore(() => {});
  B.registerContextPanel({ subscriptions: [] }, store);
  const doc = makeDoc("export const answer = 42;\n", "typescript", "file:///w/v77/answer.ts");
  __state.activeTextEditor = { document: doc, selection: { active: new Position(0, 0) }, selections: [], options: { tabSize: 4 } };
  try {
    await __state.commands["column80.contextAddFile"]();
  } finally {
    __state.activeTextEditor = undefined;
  }
  assert.equal(store.list().length, 1, "precondition: the file was added");
  const ctx = statusMessages.filter((m) => m.includes("Model Context"));
  assert.equal(ctx.length, 1, JSON.stringify(statusMessages));
  assert.match(ctx[0], /answer\.ts/);
});

test("DG34 control: an empty file adds nothing and confirms nothing", async () => {
  __state.messages = [];
  __state.commands = {};
  statusMessages.length = 0;
  const store = new B.ContextBlockStore(() => {});
  B.registerContextPanel({ subscriptions: [] }, store);
  __state.activeTextEditor = { document: makeDoc(""), selection: { active: new Position(0, 0) }, selections: [], options: {} };
  try {
    await __state.commands["column80.contextAddFile"]();
  } finally {
    __state.activeTextEditor = undefined;
  }
  assert.equal(store.list().length, 0);
  assert.deepEqual(statusMessages.filter((m) => m.includes("Model Context")), []);
  assert.equal(warns().length, 1);
});

// --------------------------------------------------------------------- Criticize

test("DG3: a Criticize diff that only strips old comments is titled for what it does", () => {
  assert.equal(B.proposalTitle("walk", 0), "walk: remove old Criticize comments (preview)");
  assert.equal(B.proposalTitle("walk", 2), "walk: Criticize (preview)");
});
