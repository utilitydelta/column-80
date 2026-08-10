// BLIND ORACLE - session-v35 item 3 / docs/roadmap.md item 26: a diagnostic that
// CLASSIFIED and then resolved NOTHING must fall through to the harvest pass.
//
// Black-box. The body of `resolveSurfaceInjection` was NOT read. What was read, to
// build a harness that can express the precondition at all: the exported signature
// of `resolveSurfaceInjection`, the `RepairSurfaceLang` / `CrateResolution` type
// declarations, `rustMemberBlock` (so the fake can starve the member leg through
// the two hooks it actually calls, `example` and `completeMembers`, while still
// answering the harvest's `hoverSurface` / `definition` / `membersOfType`), and the
// E0433 classifier branch in src/core/compilerDirected.ts (so the fixture really
// does classify instead of silently being an unclassified diagnostic, which would
// make every row below vacuous). Harness mechanics are copied from
// test/review-v34-harvest.test.cjs and test/blind-v34-diagnostic-harvest.test.cjs.
//
// THE CONTRACT, and nothing else:
//
//   C1. When a classified diagnostic's member leg resolves nothing, the diagnostic
//       FALLS THROUGH to the harvest pass rather than ending with no surface.
//   C2. The harvest's discipline is unchanged: a harvested name still has to
//       RESOLVE before a byte is injected. A fall-through whose harvested names
//       resolve to nothing injects nothing.
//   C3. Ordering is unchanged. Harvested blocks still come AFTER every classified
//       block, so a compiler-named receiver still wins the surface cap over a
//       harvested name.
//   C4. The reporting must not lie. Every "no surface" reason for a fall-through
//       must NOT claim that no classifier rule matched, because one did; it must
//       carry the classified leg's own account (its class and the type or crate it
//       named). A diagnostic that genuinely had no rule must still report that no
//       rule matched.
//   C5. A fall-through that DOES harvest a surface must not also be reported as
//       having produced no surface.
//   C6. No regression: a diagnostic with no classifier rule still harvests exactly
//       as before, and a classified diagnostic whose member leg DOES resolve still
//       injects its classified block and is not harvested twice.
//
// THE CAPTURE this is built on, verbatim from the session-v35 report:
//   error[E0433]: cannot find `EcdsaKeyPair` in `rcgen`
// classified `wrong-item` on crate `rcgen`; the member leg resolved nothing for
// `rcgen`; the round went out `[repair] surface EMPTY` with `EcdsaKeyPair` sitting
// in the message.
//
// WHERE THE CONTRACT IS SILENT it is said so at the row. Nothing here pins block
// wording; rows read the payload structurally (a backticked header with a fence
// under it) or assert only on presence and relative order.
//
// Run: SKIP_LIVE=1 node --test test/blind-v35-harvest-fallthrough.test.cjs
// Add V35_DEBUG=1 to print every row's channel and payload, green rows included.

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness: minimal vscode stub + esbuild alias, then require the CJS bundle.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v35-fallthrough-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s), scheme: "file" });
module.exports = {
  Position, Range, ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  languages: {}, window: {},
  commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__V35_FILES__ || {};
      const key = typeof arg === "string" ? arg : (arg && arg.toString ? arg.toString() : String(arg));
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v35-fallthrough.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v35-fallthrough.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";
export { classifyHallucination, harvestDiagnosticTypes } from "../src/core/compilerDirected";
`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

// A broken bundle must be ONE loud failure, never a wall of TypeErrors that could
// be mistaken for contract failures.
test("bundle guard: the resolver and the classifier build headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.strictEqual(typeof B.resolveSurfaceInjection, "function");
  assert.strictEqual(typeof B.classifyHallucination, "function");
  assert.strictEqual(typeof B.harvestDiagnosticTypes, "function");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

// ===========================================================================
// The fixture: the captured shape. A generated file that reaches for an item the
// crate does not export, with the invented item's name spelled in the source (the
// harvest anchors a name at its occurrence in the document, so a name the file
// never spells has no cursor - see the `NeverHeardOf` row).
// ===========================================================================

const URI = "file:///work/proj/src/certs.rs";
const SRC = `use rcgen::CertificateParams;
use crate::pki::SigningKey;

pub fn issue(seed: &[u8]) -> Vec<u8> {
    let pair = rcgen::EcdsaKeyPair::from_seed(seed);
    pair.serialize_der()
}
`;

const NAMES = {
  EcdsaKeyPair: {
    defUri: "file:///work/proj/src/pki_keypair.rs",
    hover: "pub struct EcdsaKeyPair { pub der: Vec<u8>, pub alg: &'static str }",
    members: [
      { name: "der", kind: "field", signature: "der: Vec<u8>" },
      { name: "alg", kind: "field", signature: "alg: &'static str" },
    ],
  },
  SigningKey: {
    defUri: "file:///work/proj/src/pki_signing.rs",
    hover: "pub struct SigningKey { pub bytes: [u8; 32] }",
    members: [{ name: "bytes", kind: "field", signature: "bytes: [u8; 32]" }],
  },
};

// `rcgen` IS an installed dependency and `EcdsaKeyPair` is not a cfg-gated module
// of it, which is exactly the disambiguation that makes the captured E0433 a
// wrong-item rather than a needs-feature or a plain-repair local path.
const RESOLUTION = { isInstalledCrate: (c) => c === "rcgen", gatingFeature: () => undefined };

// ---------------------------------------------------------------------------

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

function makeDoc(text, uriStr, languageId) {
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
    languageId,
    uri: { toString: () => uriStr, fsPath: uriStr, path: uriStr, scheme: "file" },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

// THE SEAM. `rustMemberBlock` consults exactly two hooks - `example` and
// `completeMembers` - and the harvest consults `hoverSurface` / `definition` /
// `membersOfType`. So `memberLeg` controls whether the CLASSIFIED leg resolves,
// independently of whether the HARVEST resolves. Default: the member leg resolves
// nothing, which is the captured `rcgen` behaviour.
//
// CURSOR-FAITHFUL, the blind-v7 discipline: a name resolves only when the cursor
// sits on that name's own token, because that is how rust-analyzer behaves. A row
// that reds because the fake could not answer is told apart from a contract
// failure by the recorded HOVER-ASKED / DEF-ASKED lists in the failure output.
function makeExtractor(files, names, memberLeg) {
  const asked = { hover: [], definition: [], example: [], completeMembers: [], membersOfType: [] };
  const nameAt = (c) => {
    const w = wordAt(files[c && c.uri], c);
    return w && names[w] ? w : undefined;
  };
  return {
    asked,
    hoverSurface: async (c) => {
      const n = nameAt(c);
      asked.hover.push(n || wordAt(files[c && c.uri], c) || "(nothing)");
      return n ? { signature: names[n].hover } : undefined;
    },
    definition: async (c) => {
      const n = nameAt(c);
      asked.definition.push(n || "(nothing)");
      return n
        ? { uri: names[n].defUri, range: { startLine: 0, startCharacter: 11, endLine: 0, endCharacter: 11 + n.length }, line: 0, character: 11 }
        : undefined;
    },
    membersOfType: async (c) => {
      asked.membersOfType.push(`${c && c.uri}:${c && c.line}`);
      const w = wordAt(files[c && c.uri], c);
      if (w && names[w]) return names[w].members;
      const byDef = Object.entries(names).find(([, rec]) => rec.defUri === (c && c.uri));
      return byDef ? byDef[1].members : [];
    },
    completeMembers: async (c) => {
      asked.completeMembers.push(`${c && c.line}:${c && c.character}`);
      return memberLeg && memberLeg.completeMembers ? memberLeg.completeMembers(c) : [];
    },
    example: async (c, prefer) => {
      asked.example.push(String(prefer));
      return memberLeg && memberLeg.example ? memberLeg.example(c, prefer) : undefined;
    },
    qualifyImport: async () => undefined,
  };
}

const spanOn = (src, fileName, lineIdx, token, label, isPrimary = true) => {
  const lineText = src.split("\n")[lineIdx];
  const col = lineText.indexOf(token);
  assert.ok(col >= 0, `fixture bug: ${JSON.stringify(token)} not on ${JSON.stringify(lineText)}`);
  const off = src.split("\n").slice(0, lineIdx).reduce((a, l) => a + l.length + 1, 0);
  return {
    fileName,
    byteStart: off + col,
    byteEnd: off + col + token.length,
    lineStart: lineIdx + 1,
    lineEnd: lineIdx + 1,
    columnStart: col + 1,
    columnEnd: col + 1 + token.length,
    isPrimary,
    ...(label === undefined ? {} : { label }),
  };
};
const span = (lineIdx, token, label) => spanOn(SRC, "src/certs.rs", lineIdx, token, label);

const diag = (code, message, spans) => ({
  kind: "compile-error",
  level: "error",
  code,
  message,
  spans: Array.isArray(spans) ? spans : [spans],
  suggestions: [],
  rendered: `error[${code}]: ${message}`,
});

async function run(diagnostics, opt = {}) {
  const { uri = URI, src = SRC, names = NAMES, memberLeg, catalog, resolution, localDefs, opts } = opt;
  const defFiles = {};
  for (const rec of Object.values(names)) defFiles[rec.defUri] = `${rec.hover}\n`;
  const files = { ...defFiles, [uri]: src };
  const ext = makeExtractor(files, names, memberLeg);
  const logs = [];
  globalThis.__V35_FILES__ = files;
  let out;
  try {
    out = await B.resolveSurfaceInjection(ext, makeDoc(src, uri, "rust"), diagnostics, (l) => logs.push(String(l)), catalog, resolution, localDefs, opts);
  } finally {
    delete globalThis.__V35_FILES__;
  }
  const text = (typeof out === "string" ? out : out && out.surface) || "";
  const r = { out, text, logs, asked: ext.asked };
  if (process.env.V35_DEBUG) console.log(dump(r));
  return r;
}

const dump = (r) =>
  `\n  HOVER-ASKED=${JSON.stringify(r.asked.hover)}\n  DEF-ASKED=${JSON.stringify(r.asked.definition)}` +
  `\n  EXAMPLE-ASKED=${JSON.stringify(r.asked.example)}\n  COMPLETE-ASKED=${JSON.stringify(r.asked.completeMembers)}` +
  `\n  LOGS=${JSON.stringify(r.logs, null, 1)}\n  PAYLOAD:\n${r.text || "(none)"}`;

// Block headers in payload order: a line carrying a backticked identifier with a
// fence opening within two lines. Nothing about block WORDING is pinned - the
// contract says nothing about wording, only about order.
function blockHeadersInOrder(payload) {
  const lines = (payload || "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(lines[i]);
    if (!m) continue;
    if (!(lines[i + 1] || "").startsWith("```") && !(lines[i + 2] || "").startsWith("```")) continue;
    out.push(m[1]);
  }
  return out;
}

// The captured diagnostic, verbatim.
const CAPTURE = () => diag("E0433", "cannot find `EcdsaKeyPair` in `rcgen`", span(4, "EcdsaKeyPair"));
// A diagnostic the classifier has NO rule for (the population item 2 already served).
const NO_RULE = () => diag("E0063", "missing field `bytes` in initializer of `SigningKey`", span(1, "SigningKey"));

const linesFor = (r, code) => r.logs.filter((l) => l.includes(code));
const emptyLine = (r) => r.logs.find((l) => l.includes("surface EMPTY"));

// ===========================================================================
// PRECONDITIONS. Without these every row below could pass vacuously: if the
// capture did not classify it would merely be an unclassified diagnostic taking
// the v34 path, and the fall-through would never be exercised at all.
// ===========================================================================

btest("PRE-1: the captured E0433 really does classify - wrong-item naming crate `rcgen`", () => {
  const c = B.classifyHallucination(CAPTURE(), RESOLUTION);
  assert.ok(c, `the capture must CLASSIFY for this file to be about fall-through at all; got ${JSON.stringify(c)}`);
  assert.strictEqual(c.kind, "wrong-item", `got ${JSON.stringify(c)}`);
  assert.strictEqual(c.crate, "rcgen", `the member leg's subject is the crate; got ${JSON.stringify(c)}`);
});

btest("PRE-2: the harvest can see `EcdsaKeyPair` in the capture's own message", () => {
  const names = B.harvestDiagnosticTypes(CAPTURE());
  assert.ok(
    names.includes("EcdsaKeyPair"),
    `the whole defect is that this name was sitting in the message unused; got ${JSON.stringify(names)}`,
  );
});

btest("PRE-3: the member leg is genuinely starved - it is asked for `rcgen` and answers nothing", async () => {
  const r = await run([CAPTURE()], { resolution: RESOLUTION });
  assert.ok(
    r.asked.example.length + r.asked.completeMembers.length > 0,
    `the classified member leg must have RUN and failed, not been skipped${dump(r)}`,
  );
  assert.ok(
    !/API surface for `rcgen`/.test(r.text) && !/Members of `rcgen`/.test(r.text),
    `precondition broken: the member leg resolved something for rcgen after all${dump(r)}`,
  );
});

// ===========================================================================
// C1. THE FALL-THROUGH ITSELF.
// ===========================================================================

btest("C1-a: the captured fall-through injects the harvested name instead of going out empty", async () => {
  const r = await run([CAPTURE()], { resolution: RESOLUTION });
  assert.notStrictEqual(
    r.text,
    "",
    `a classified diagnostic whose member leg resolved nothing must reach the harvest, not end with ` +
      `no surface. This is the captured round that went out \`surface EMPTY\` with EcdsaKeyPair in ` +
      `the message.${dump(r)}`,
  );
  assert.ok(
    /EcdsaKeyPair/.test(r.text),
    `the surface must carry the harvested name the diagnostic itself supplied${dump(r)}`,
  );
});

btest("C1-b: the fall-through's round is not reported EMPTY", async () => {
  const r = await run([CAPTURE()], { resolution: RESOLUTION });
  assert.strictEqual(
    emptyLine(r),
    undefined,
    `the round produced a surface, so nothing may claim every eligible diagnostic produced none${dump(r)}`,
  );
});

btest("C1-c: the fall-through's injected line is attributed to the harvest and to its own code", async () => {
  const r = await run([CAPTURE()], { resolution: RESOLUTION });
  const injected = r.logs.filter((l) => l.includes("injected") && l.includes("EcdsaKeyPair"));
  assert.ok(injected.length > 0, `no injected line names the harvested type${dump(r)}`);
  // The contract does not fix this wording. What it does imply is that the reader
  // can tell WHICH diagnostic bought the block, since the point of item 3 is that
  // this diagnostic stops being invisible.
  assert.ok(
    injected.some((l) => l.includes("E0433")),
    `the injected line must name the diagnostic it came from${dump(r)}`,
  );
});

btest("C1-d: the fall-through is not crate-only - an unresolved-method whose member leg dries up also harvests", async () => {
  // Same defect shape on a TYPE rather than a crate: E0599 classifies
  // unresolved-method on `SigningKey`, the member leg (completeMembers, then
  // example) answers nothing, and the diagnostic names `SigningKey`.
  const d = diag("E0599", "no method named `sign` found for struct `SigningKey` in the current scope", span(1, "SigningKey"));
  assert.strictEqual(B.classifyHallucination(d, RESOLUTION).kind, "unresolved-method", "precondition: it classifies");
  const r = await run([d], { resolution: RESOLUTION });
  assert.ok(
    /SigningKey/.test(r.text) && r.text !== "",
    `C1 is about "a classified diagnostic's member leg resolves nothing", not about one class${dump(r)}`,
  );
});

// ===========================================================================
// C2. THE HARVEST'S DISCIPLINE IS UNCHANGED.
// ===========================================================================

btest("C2-a: a fall-through whose harvested names resolve to nothing injects nothing", async () => {
  // Nothing in the workspace resolves: hover and definition both answer undefined
  // at every cursor. The name is still harvested, and still must buy no bytes.
  const r = await run([CAPTURE()], { resolution: RESOLUTION, names: {} });
  assert.strictEqual(
    r.text,
    "",
    `an unresolved harvested name may not invent a block. Falling through must not weaken the ` +
      `rule that a name RESOLVES before a byte is injected.${dump(r)}`,
  );
});

btest("C2-b: and that round IS reported empty, naming its code", async () => {
  const r = await run([CAPTURE()], { resolution: RESOLUTION, names: {} });
  const line = emptyLine(r);
  assert.ok(line, `the round bought nothing and must say so${dump(r)}`);
  assert.ok(line.includes("E0433"), `the EMPTY line must name the code that bought nothing${dump(r)}`);
});

btest("C2-c: no block is fabricated for the harvested name when it did not resolve", async () => {
  const r = await run([CAPTURE()], { resolution: RESOLUTION, names: {} });
  assert.deepStrictEqual(
    blockHeadersInOrder(r.text),
    [],
    `a fall-through must not synthesize a shape for a name that resolved to nothing${dump(r)}`,
  );
});

// ===========================================================================
// C3. ORDERING AND THE CAP.
// ===========================================================================

btest("C3-a: a harvested block comes AFTER a classified block even when the fall-through is the FIRST diagnostic", async () => {
  // The fall-through is eligible[0]. If the harvest ran inline at its position the
  // harvested block would lead the payload.
  const methodMiss = diag("E0599", "no method named `sign` found for struct `SigningKey` in the current scope", span(5, "serialize_der"));
  const r = await run([CAPTURE(), methodMiss], {
    resolution: RESOLUTION,
    memberLeg: { completeMembers: (c) => (c && c.line === 5 ? [{ name: "sign_der", kind: "method", signature: "fn sign_der(&self) -> Vec<u8>" }] : []) },
  });
  const order = blockHeadersInOrder(r.text);
  assert.ok(order.includes("SigningKey"), `precondition: the classified block resolved${dump(r)}`);
  assert.ok(order.includes("EcdsaKeyPair"), `precondition: the fall-through harvested${dump(r)}`);
  assert.ok(
    order.indexOf("SigningKey") < order.indexOf("EcdsaKeyPair"),
    `harvested blocks come after every classified block. ORDER=${JSON.stringify(order)}${dump(r)}`,
  );
});

btest("C3-b: under the surface cap the four compiler-named receivers keep every slot and the harvested name is the one dropped", async () => {
  const CAPSRC = `use rcgen::CertificateParams;
use crate::pki::Alpha;
use crate::pki::Beta;
use crate::pki::Gamma;
use crate::pki::Delta;

pub fn issue(seed: &[u8]) -> Vec<u8> {
    let pair = rcgen::EcdsaKeyPair::from_seed(seed);
    pair.serialize_der()
}
`;
  const capNames = {};
  for (const n of ["Alpha", "Beta", "Gamma", "Delta", "EcdsaKeyPair"]) {
    capNames[n] = {
      defUri: `file:///work/proj/src/t_${n.toLowerCase()}.rs`,
      hover: `pub struct ${n} { pub slot: u32 }`,
      members: [{ name: "slot", kind: "field", signature: "slot: u32" }],
    };
  }
  const cspan = (line, tok) => spanOn(CAPSRC, "src/certs.rs", line, tok);
  const four = ["Alpha", "Beta", "Gamma", "Delta"].map((n, i) =>
    diag("E0599", `no method named \`nope\` found for struct \`${n}\` in the current scope`, cspan(i + 1, n)),
  );
  // The fall-through leads the list again, so an inline harvest would take slot 1.
  const r = await run([diag("E0433", "cannot find `EcdsaKeyPair` in `rcgen`", cspan(7, "EcdsaKeyPair")), ...four], {
    src: CAPSRC,
    names: capNames,
    resolution: RESOLUTION,
    memberLeg: { completeMembers: (c) => (c && c.line >= 1 && c.line <= 4 ? [{ name: "ok", kind: "method", signature: "fn ok(&self) -> bool" }] : []) },
  });
  const order = blockHeadersInOrder(r.text);
  for (const n of ["Alpha", "Beta", "Gamma", "Delta"]) {
    assert.ok(order.includes(n), `the compiler-named receiver ${n} lost its slot to a harvested name. ORDER=${JSON.stringify(order)}${dump(r)}`);
  }
  assert.ok(
    !order.includes("EcdsaKeyPair"),
    `with four compiler-named receivers the cap is full; the harvested name must be the one that ` +
      `gives way. ORDER=${JSON.stringify(order)}${dump(r)}`,
  );
});

// ===========================================================================
// C4. THE REPORTING MUST NOT LIE.
// ===========================================================================

btest("C4-a: no reason for the fall-through claims that no classifier rule matched", async () => {
  const r = await run([CAPTURE()], { resolution: RESOLUTION, names: {} });
  const mine = linesFor(r, "E0433").filter((l) => l.includes("surface none"));
  assert.ok(mine.length > 0, `the fall-through bought nothing and must leave a reason${dump(r)}`);
  for (const l of mine) {
    assert.ok(
      !/classifier rule matched/.test(l),
      `a rule DID match (wrong-item on rcgen); this line tells the reader the opposite and sends ` +
        `them to write a classifier rule that already exists. LINE=${JSON.stringify(l)}${dump(r)}`,
    );
  }
});

btest("C4-b: the fall-through's reason carries the classified leg's own account - its class and its crate", async () => {
  const r = await run([CAPTURE()], { resolution: RESOLUTION, names: {} });
  const mine = linesFor(r, "E0433").filter((l) => l.includes("surface none"));
  assert.ok(
    mine.some((l) => l.includes("wrong-item")),
    `some reason must name the class that matched. LINES=${JSON.stringify(mine, null, 1)}${dump(r)}`,
  );
  assert.ok(
    mine.some((l) => l.includes("rcgen")),
    `some reason must name the crate the classified leg went looking for, which is the fact that ` +
      `tells the reader the member leg is where it dried up. LINES=${JSON.stringify(mine, null, 1)}${dump(r)}`,
  );
  // Plain-words implication of "carry the classified leg's OWN account": the class
  // and the subject belong on one line, not scattered across two, or the reader
  // cannot tell which leg named which.
  assert.ok(
    mine.some((l) => l.includes("wrong-item") && l.includes("rcgen")),
    `the class and the crate it named must appear together. LINES=${JSON.stringify(mine, null, 1)}${dump(r)}`,
  );
});

btest("C4-c: the reason is honest on the terminal-steer path too, where the harvest never runs", async () => {
  // A later unresolved-crate returns the installed-crate catalog and the harvest
  // pass never gets to run. The fall-through still owes a reason, and it still may
  // not claim no rule matched.
  const steer = diag("E0433", "use of undeclared crate or module `chrono`", span(5, "pair"));
  const r = await run([CAPTURE(), steer], { resolution: RESOLUTION, catalog: "Installed crates: rcgen, serde." });
  assert.strictEqual(r.text, "Installed crates: rcgen, serde.", `precondition: the catalog is the payload${dump(r)}`);
  const mine = r.logs.filter((l) => l.includes("surface none") && l.includes("E0433") && !l.includes("chrono"));
  assert.ok(mine.length > 0, `the fall-through must not go silent when a terminal steer returns first${dump(r)}`);
  for (const l of mine) {
    assert.ok(!/classifier rule matched/.test(l), `LINE=${JSON.stringify(l)}${dump(r)}`);
  }
  assert.ok(
    mine.some((l) => l.includes("wrong-item") && l.includes("rcgen")),
    `LINES=${JSON.stringify(mine, null, 1)}${dump(r)}`,
  );
});

btest("C4-d: a diagnostic that genuinely had NO rule still reports that no rule matched", async () => {
  const d = NO_RULE();
  assert.strictEqual(B.classifyHallucination(d, RESOLUTION), undefined, "precondition: the classifier has no rule for this one");
  const r = await run([d], { resolution: RESOLUTION, names: {} });
  const mine = linesFor(r, "E0063").filter((l) => l.includes("surface none"));
  assert.ok(mine.length > 0, `it bought nothing and must say so${dump(r)}`);
  assert.ok(
    mine.some((l) => /classifier rule matched/.test(l)),
    `the honest claim for this population is unchanged: no rule matched. Widening the reason for ` +
      `fall-throughs must not delete it. LINES=${JSON.stringify(mine, null, 1)}${dump(r)}`,
  );
});

btest("C4-e: and it still reports that on the terminal-steer path", async () => {
  const steer = diag("E0433", "use of undeclared crate or module `chrono`", span(5, "pair"));
  const r = await run([NO_RULE(), steer], { resolution: RESOLUTION, catalog: "Installed crates: rcgen, serde." });
  const mine = linesFor(r, "E0063");
  assert.ok(mine.length > 0, `silence here is the failure item 3 exists to close${dump(r)}`);
  assert.ok(
    mine.some((l) => /classifier rule matched/.test(l)),
    `LINES=${JSON.stringify(mine, null, 1)}${dump(r)}`,
  );
});

btest("C4-f: a classified diagnostic with no member leg at all is not reported as unclassified either", async () => {
  // Where the contract is SILENT: arity-mismatch never calls a member leg, so it
  // is not a "member leg resolved nothing" fall-through. But C4's plain words are
  // about every no-surface reason for a diagnostic that DID classify, so the same
  // prohibition applies - a reader must not be told no rule matched here.
  const d = diag("E0061", "this method takes 3 arguments but 1 argument was supplied", span(5, "serialize_der"));
  assert.strictEqual(B.classifyHallucination(d, RESOLUTION).kind, "arity-mismatch", "precondition: it classifies");
  const r = await run([d], { resolution: RESOLUTION, names: {} });
  const mine = linesFor(r, "E0061");
  assert.ok(mine.length > 0, `it produced no surface and must leave an account${dump(r)}`);
  for (const l of mine) {
    assert.ok(!/classifier rule matched/.test(l), `LINE=${JSON.stringify(l)}${dump(r)}`);
  }
  assert.ok(
    r.logs.some((l) => l.includes("arity-mismatch")),
    `the class that matched must be on the channel${dump(r)}`,
  );
});

// ===========================================================================
// C5. A FALL-THROUGH THAT HARVESTS IS NOT ALSO REPORTED AS EMPTY-HANDED.
// ===========================================================================

btest("C5-a: the successful fall-through gets no diagnostic-level no-surface verdict", async () => {
  const r = await run([CAPTURE()], { resolution: RESOLUTION });
  const verdicts = linesFor(r, "E0433").filter((l) => l.includes("surface none"));
  assert.deepStrictEqual(
    verdicts,
    [],
    `this diagnostic bought a block; reporting it as having produced no surface is the opposite ` +
      `diagnosis for whoever reads the channel looking for the next rule to write.${dump(r)}`,
  );
});

btest("C5-b: two harvested names, one resolving, still counts as a surface for the diagnostic", async () => {
  // rustc's span label names a second type the workspace has never heard of. One
  // name resolves, one cannot. The per-NAME miss is fair to log; a verdict that the
  // DIAGNOSTIC produced no surface is not, because it did.
  const d = diag("E0433", "cannot find `EcdsaKeyPair` in `rcgen`", span(4, "EcdsaKeyPair", "expected `NeverHeardOf`, found `EcdsaKeyPair`"));
  const r = await run([d], { resolution: RESOLUTION });
  assert.ok(/EcdsaKeyPair/.test(r.text), `precondition: one name resolved${dump(r)}`);
  assert.strictEqual(emptyLine(r), undefined, `the round bought bytes${dump(r)}`);
  const falseVerdict = linesFor(r, "E0433").filter(
    (l) => l.includes("surface none") && (/no harvested name added a surface/.test(l) || /classifier rule matched/.test(l) || /member leg resolved nothing/.test(l)),
  );
  assert.deepStrictEqual(
    falseVerdict,
    [],
    `a per-name miss is fine; a diagnostic-level verdict is not - this diagnostic DID add a ` +
      `surface. LINES=${JSON.stringify(falseVerdict, null, 1)}${dump(r)}`,
  );
});

// ===========================================================================
// C6. NO REGRESSION FOR THE POPULATION THAT ALREADY WORKED.
// ===========================================================================

btest("C6-a: a diagnostic with no classifier rule still harvests exactly as before", async () => {
  const r = await run([NO_RULE()], { resolution: RESOLUTION });
  assert.ok(/SigningKey/.test(r.text), `the v34 harvest population must be untouched${dump(r)}`);
  assert.ok(
    r.logs.some((l) => l.includes("injected") && l.includes("SigningKey")),
    `and it must still be attributed to the harvest${dump(r)}`,
  );
  assert.strictEqual(emptyLine(r), undefined, `it bought a surface${dump(r)}`);
});

btest("C6-b: a classified diagnostic whose member leg DOES resolve still injects its classified block", async () => {
  const r = await run([CAPTURE()], {
    resolution: RESOLUTION,
    memberLeg: { completeMembers: () => [{ name: "generate", kind: "method", signature: "fn generate(alg: &Alg) -> KeyPair" }] },
  });
  assert.ok(
    blockHeadersInOrder(r.text).includes("rcgen"),
    `the classified crate block is the whole point of the classifier leg${dump(r)}`,
  );
  assert.ok(
    r.logs.some((l) => l.includes("injected") && l.includes("wrong-item") && l.includes("rcgen")),
    `and the channel still attributes it to the class that matched${dump(r)}`,
  );
});

btest("C6-c: ...and is NOT harvested a second time", async () => {
  const r = await run([CAPTURE()], {
    resolution: RESOLUTION,
    memberLeg: { completeMembers: () => [{ name: "generate", kind: "method", signature: "fn generate(alg: &Alg) -> KeyPair" }] },
  });
  assert.ok(
    !r.logs.some((l) => l.includes("injected") && l.includes("harvest")),
    `the fall-through is a FALL-through: a member leg that resolved must not also spend a slot ` +
      `on the harvest.${dump(r)}`,
  );
  assert.deepStrictEqual(
    blockHeadersInOrder(r.text),
    ["rcgen"],
    `exactly one block, the classified one${dump(r)}`,
  );
});

btest("C6-d: a resolving member leg does not even ask the harvest's resolvers", async () => {
  // Plain-words implication of "not harvested twice": the round trip is not spent
  // either. This is the cost side of the same claim and the cheapest way to see a
  // harvest that ran and was then discarded.
  const r = await run([CAPTURE()], {
    resolution: RESOLUTION,
    memberLeg: { completeMembers: () => [{ name: "generate", kind: "method", signature: "fn generate(alg: &Alg) -> KeyPair" }] },
  });
  assert.deepStrictEqual(
    r.asked.hover,
    [],
    `the harvest's hover round trip was spent on a diagnostic that already had its block${dump(r)}`,
  );
});
